using System.Collections;
using System.Collections.Concurrent;
using System.Data;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen360 patron görünümü (uygulama 1.5, 03.10.2026).
///
/// <para>
/// Yönetim → Patron Görünümü'nde seçilen kişiler mobil uygulamada şirket
/// geneli yönetim ekranlarını görüyor: canlı okutma, şubeler, norm kadro,
/// başvurular, onaylar, Biçen Kart ve İK özetleri. Sözleşme
/// <c>patron-sozlesme.md</c>; alan adları oradakiyle birebir.
/// </para>
///
/// <para>
/// Kimlik doğrulama <see cref="MobilController"/> ile aynı: mobil jeton
/// (rol "Personel"), jetondaki sicil ve cihaz, cihaz kaydıyla oturum
/// denetimi. Üstüne her uçta <see cref="PatronServisi.PatronMu"/> soruluyor;
/// listede olmayan herkes 403 alıyor.
/// </para>
///
/// <para>
/// <b>Hesaplar yeniden yazılmadı.</b> Her sayı panelde aynı sayıyı üreten
/// kaynaktan geliyor: norm kadro HavuzController.NormRapor'dan, okutma
/// kuralları PersonelController/OkutmaVeriHazirlayici'dan, onay kararı
/// OnayKarariServisi'nden, kart formülleri BicenKartRaporController'dan.
/// Panel ucunun çıktısı başka bir biçimdeyse uç, sahte bir "genel müdür
/// yardımcısı" kimliğiyle ve yalnızca OKUMA için kendi kapsamında
/// çağrılıyor (<see cref="Cagir{TC}"/>): ekranı patron görüyor ama sayı
/// panelin sayısı. Panelin sayısı ile patronun gördüğü sayı ayrışırsa
/// hangisinin doğru olduğu tartışması hiç bitmezdi.
/// </para>
///
/// <para>
/// Hız: patron ekranları hep şirket genelini istiyor ve aynı veriyi bütün
/// patronlar görüyor. Ağır hesaplar (okutma, norm, başvuru özetleri, kart)
/// 30 saniye sunucu belleğinde paylaşılıyor (<see cref="PatronOnbellegi"/>);
/// onay ya da not yazılınca ilgili kayıtlar siliniyor. Özet ekranının
/// bölümleri paralel hazırlanıyor ve biri hata verirse yalnızca o bölüm
/// boş (null) dönüyor.
/// </para>
///
/// <para>
/// Gizlilik: kimlik numarası, personel ücreti, adres ve etik bildirimin
/// içeriği/bildireni hiçbir uçtan dönmüyor. Telefon yalnızca şube
/// müdürü (<c>mudurTel</c>) ve personel kartında. Onay kartındaki ücret,
/// panelde onaylayanın gördüğü işe alım ücretidir (karar onun üzerine
/// veriliyor); çalışanların ücreti değil.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Personel")]
public partial class PatronMobilController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly PatronServisi _patron;
    private readonly AyarServisi _ayar;
    private readonly YoneticiBulucu _yonetici;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<PatronMobilController> _kayit;

    public PatronMobilController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        PatronServisi patron,
        AyarServisi ayar,
        YoneticiBulucu yonetici,
        GuvenlikGunlugu gunluk,
        IServiceProvider saglayici,
        ILogger<PatronMobilController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _patron = patron;
        _ayar = ayar;
        _yonetici = yonetici;
        _gunluk = gunluk;
        _saglayici = saglayici;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Sabitler ve küçük yardımcılar                                         */
    /* ==================================================================== */

    private static readonly CultureInfo Tr = new("tr-TR");

    /// <summary>Liste uçlarında en çok satır (sözleşme)</summary>
    private const int ListeSiniri = 100;

    /// <summary>Okutma akışında en çok satır (sözleşme)</summary>
    private const int AkisSiniri = 30;

    /// <summary>Arama sonucunda her grupta en çok satır (sözleşme)</summary>
    private const int AramaSiniri = 15;

    /// <summary>
    /// Vardiya başlangıcından sonra bu kadar içinde gelen geç sayılmaz.
    /// Panelde geç kalma kuralı yok; kapıdan girip telefonu çıkarana kadar
    /// geçen birkaç dakika "geç" listesini anlamsız kalabalıklaştırıyordu.
    /// </summary>
    private static readonly TimeSpan GecKalmaPayi = TimeSpan.FromMinutes(5);

    /// <summary>
    /// "Okutması düşük şube" uyarısı bu saatten önce üretilmiyor: sabah
    /// erken saatte öğle vardiyası henüz gelmediği için her şube %75'in
    /// altında görünür ve uyarı anlamını yitirir.
    /// </summary>
    private static int OkutmaUyarisiSaati => Parametre.Sayi("okutma.patronUyariSaati");

    /// <summary>İşlemsiz başvuru sınırı (gün) — sözleşmedeki "3+ gün"</summary>
    private const int IslemsizGun = 3;

    private static readonly string[] GunAdlari = { "Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt" };

    private static readonly string[] AyKisa =
        { "Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara" };

    private static string K(string s) => (s ?? "").Trim();

    private static bool Esit(string a, string b) =>
        string.Equals(K(a), K(b), StringComparison.OrdinalIgnoreCase);

    private static string Ust(string s) => K(s).ToUpper(Tr);

    private static string Kucuk(string s) => K(s).ToLower(Tr);

    private static string Rakam(string s) => new((s ?? "").Where(char.IsDigit).ToArray());

    private static string Ad(PersonelKaydi p) => $"{p.Ad} {p.Soyad}".Trim();

    private static string Saat(DateTime? t) =>
        t?.ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary>Sözleşmedeki yerel ISO biçimi (saniyeye kadar, saat dilimi eki yok)</summary>
    private static string Iso(DateTime? t) =>
        t?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    /// <summary>Ondalığın sondaki sıfırlarını atar: 41,0 → 41; 0,5 kalır.</summary>
    private static decimal N(decimal d) => d / 1.0000000000000000000000000000m;

    /// <summary>
    /// Norm doluluğu (%): normdaki yerlerin dolu olanı = (norm − eksik) ÷ norm.
    /// Mevcut ÷ norm kullanılmıyor: bir pozisyondaki fazla başka pozisyonun
    /// eksiğini kapatıyor gibi görünüyordu (761,5 norm / 760,5 mevcut "%100").
    /// Aşağı yuvarlanıyor; eksik varken %100 görünmesin.
    /// </summary>
    private static decimal? Doluluk(decimal norm, decimal eksik) =>
        norm <= 0 ? null : Math.Floor(Math.Max(0m, norm - eksik) / norm * 1000m) / 10m;

    private static string Tl(decimal d) => d.ToString("N0", Tr) + " TL";

    private static string Adet(decimal d) => N(d).ToString("0.#", Tr);

    /// <summary>Virgüllü bölüm listesinin ilki ("Kasiyer, Manav" → "Kasiyer")</summary>
    private static string IlkBolum(string bolumler) =>
        K((bolumler ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault());

    /// <summary>"11 gün önce" gibi göreli süre</summary>
    private static string Sure(DateTime t)
    {
        var simdi = DateTime.Now;
        var fark = simdi - t;

        if (fark.TotalMinutes < 1) return "az önce";
        if (fark.TotalMinutes < 60) return $"{(int)fark.TotalMinutes} dk önce";
        if (t.Date == simdi.Date) return $"{(int)fark.TotalHours} saat önce";
        if (t.Date == simdi.Date.AddDays(-1)) return "dün";

        return $"{(simdi.Date - t.Date).Days} gün önce";
    }

    /// <summary>"bugün 09:12", "dün 21:14", "3 gün önce"</summary>
    private static string GunSaat(DateTime t)
    {
        var bugun = DateTime.Today;

        if (t.Date == bugun) return $"bugün {Saat(t)}";
        if (t.Date == bugun.AddDays(-1)) return $"dün {Saat(t)}";

        return $"{(bugun - t.Date).Days} gün önce";
    }

    /// <summary>
    /// Bölüm hatası bütün yanıtı düşürmesin: hata günlüğe yazılır, bölüm
    /// null döner (sözleşme: "veri yoksa alan null; uç hata vermemeli").
    /// </summary>
    private T Guvenli<T>(string bolum, Func<T> uret) where T : class
    {
        try
        {
            return uret();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron görünümü: {Bolum} hazırlanamadı", bolum);
            return null;
        }
    }

    private Task<T> Paralel<T>(string bolum, Func<T> uret) where T : class =>
        Task.Run(() => Guvenli(bolum, uret));

    /* ==================================================================== */
    /* Kimlik ve yetki                                                       */
    /* ==================================================================== */

    /* JetonCoz / OturumGecerli / Kendisi: MobilController'daki ile aynı
       kural. Orada private; 5700 satırlık controller'ı bu iş için
       değiştirmek yerine kısa kopyası burada. Biri değişirse diğeri de
       değişmeli. */

    /// <summary>Jetondan sicil ve cihaz: "personel:14721|cihaz-abc"</summary>
    private (string kod, string cihaz) JetonCoz()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return ("", "");

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? (govde, "") : (govde[..i], govde[(i + 1)..]);
    }

    /// <summary>Başka telefondan giriş yapıldıysa ya da çıkış yapıldıysa oturum geçersiz.</summary>
    private bool OturumGecerli(IDbConnection db)
    {
        var (kod, cihaz) = JetonCoz();

        if (string.IsNullOrWhiteSpace(kod)) return false;

        /* Eski jetonlarda cihaz yok; geriye dönük kabul edilir */
        if (string.IsNullOrWhiteSpace(cihaz)) return true;

        var kayit = db.QueryFirstOrDefault(@"
SELECT cihaz_id AS cihazId, oturum_acik AS oturumAcik
FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod", new { kod });

        if (kayit is null) return true;

        /* Kalıcı kimliğe taşınan kayıtta eski jeton kısa süre kabul edilir (26.10.2026) */
        return (bool)kayit.oturumAcik &&
               CihazKimligi.Uyusuyor(db, kod, (string)kayit.cihazId, cihaz);
    }

    private PersonelKaydi Kendisi()
    {
        var kod = JetonCoz().kod;

        if (string.IsNullOrWhiteSpace(kod)) return null;

        using (var db = _vt.Baglanti())
        {
            if (!OturumGecerli(db)) return null;
        }

        return _kaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => string.Equals(K(x.PersonelKodu), kod, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Oturum ve patron yetkisi. Patron listesi 30 saniye bellekte: listeden
    /// çıkarılan kişinin erişimi en geç yarım dakikada kapanıyor, karşılığında
    /// her istek KRY_PATRON'a gitmiyor. Oturum denetimi önbelleğe alınmıyor.
    /// </summary>
    private (PersonelKaydi Kisi, IActionResult Red) Yetki()
    {
        var p = Kendisi();

        if (p is null)
            return (null, Unauthorized(new { hata = "Oturumunuz sona erdi." }));

        var kod = K(p.PersonelKodu);
        var kimlik = K(p.KimlikNo);

        var patron = PatronOnbellegi.Al($"yetki|{kod}|{kimlik}",
            () => (object)_patron.PatronMu(kod, kimlik));

        if (!(bool)patron)
            return (null, StatusCode(403, new { hata = "Patron görünümü yetkiniz yok." }));

        return (p, null);
    }

    /// <summary>
    /// Kararda ve notta görünen imza: "Ad Soyad (Biçen360)". Kolonlar 50
    /// karakter; ad kısaltılıyor ki kaynak eki hiç kesilmesin. Duyuruda
    /// ek " (Yönetim)", sınır 60 (KRY_MOBIL_DUYURU.gonderen).
    /// </summary>
    private static string Imza(PersonelKaydi p, string ek = " (Biçen360)", int sinir = 50)
    {
        var ad = Ad(p);

        if (ad.Length > sinir - ek.Length) ad = ad[..(sinir - ek.Length)].Trim();

        return ad + ek;
    }

    /* ==================================================================== */
    /* Fotoğraf adresleri (ek sözleşme 1)                                    */
    /* ==================================================================== */

    /// <summary>
    /// Personel fotoğrafının göreli adresi; fotoğrafı yoksa null. Sürüm
    /// eki (panelden yeni fotoğraf yüklenince değişir) uygulamanın
    /// önbelleğindeki eski fotoğrafı geçersiz kılıyor.
    /// </summary>
    private static string PersonelFoto(PersonelKaydi p)
    {
        if (p is null || !p.ResimVar || string.IsNullOrWhiteSpace(p.PersonelKodu)) return null;

        var kod = K(p.PersonelKodu);
        var imza = FotoImzasi.Sorgu("P", kod);

        return $"/api/PatronMobil/Foto/Personel/{Uri.EscapeDataString(kod)}?v={p.ResimSurumu}" +
               (imza.Length > 0 ? "&" + imza : "");
    }

    /// <summary>
    /// Başvuru fotoğrafının göreli adresi; formda fotoğraf yoksa null.
    /// İmzalı (<see cref="FotoImzasi"/>): jeton iletilmese de açılır.
    /// </summary>
    private static string BasvuruFoto(int id, bool fotoVar)
    {
        if (!fotoVar) return null;

        var imza = FotoImzasi.Sorgu("B", id.ToString(CultureInfo.InvariantCulture));

        return $"/api/PatronMobil/Foto/Basvuru/{id}" + (imza.Length > 0 ? "?" + imza : "");
    }

    /// <summary>
    /// Başvuruda fotoğraf var mı: panel listesindeki kural (kayıtta yazılan
    /// bayrak, eski kayıtlarda fotoğraf özeti). veri_json okunmuyor;
    /// fotoğrafın base64'ü satır başına yüzlerce KB.
    /// </summary>
    private const string FotoVarSql =
        "CAST(ISNULL(b.fotograf_var, CASE WHEN b.fotograf_ozeti IS NOT NULL THEN 1 ELSE 0 END) AS BIT)";

    /* ==================================================================== */
    /* Panel uçlarını okuma amaçlı çağırma                                   */
    /* ==================================================================== */

    /// <summary>
    /// Panel uçlarının çağrıldığı kimlik: genel müdür yardımcısı. Bu rolde
    /// şube/bölge kısıtı yok, şirket geneli görünüyor. Yalnızca OKUMA
    /// uçlarında kullanılıyor; yazan tek işlem (onay) kimlik kurgulamadan
    /// OnayKarariServisi ile yapılıyor.
    /// </summary>
    private static ClaimsPrincipal OkumaKimligi() =>
        new(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.Name, "Biçen360 Patron Görünümü"),
            new Claim(ClaimTypes.Role, Roller.GenelMudurYardimcisi),
            new Claim("adSoyad", "Biçen360 Patron Görünümü")
        }, "Bicen360Patron"));

    /// <summary>
    /// Panel controller'ını kendi DI kapsamında kurar ve verilen işi yaptırır.
    /// Ayrı kapsam: özet bölümleri paralel çalışıyor; scoped servislerin
    /// aynı örneği iki iş parçacığında paylaşılmasın.
    /// </summary>
    private T Kapsamda<TC, T>(Func<TC, T> is_) where TC : ControllerBase
    {
        using var kapsam = _saglayici.CreateScope();

        var c = ActivatorUtilities.CreateInstance<TC>(kapsam.ServiceProvider);

        c.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                RequestServices = kapsam.ServiceProvider,
                User = OkumaKimligi()
            }
        };

        return is_(c);
    }

    /// <summary>Panel ucunu çağırır; başarılıysa yanıt gövdesi, değilse null.</summary>
    private object Cagir<TC>(Func<TC, IActionResult> eylem) where TC : ControllerBase =>
        Kapsamda<TC, object>(c => eylem(c) is ObjectResult o && (o.StatusCode ?? 200) is >= 200 and < 300
            ? o.Value
            : null);

    /// <summary>Anonim yanıt nesnesinden alan okur.</summary>
    private static object Alan(object nesne, string ad)
    {
        if (nesne is null) return null;

        /* Dapper satırı (dynamic) sözlük gibi okunur */
        if (nesne is IDictionary<string, object> satir)
            return satir.TryGetValue(ad, out var deger) ? deger : null;

        return nesne.GetType().GetProperty(ad)?.GetValue(nesne);
    }

    private static decimal Ondalik(object x) =>
        x is null || x is DBNull ? 0m : Convert.ToDecimal(x, CultureInfo.InvariantCulture);

    private static decimal? OndalikMi(object x) =>
        x is null || x is DBNull ? null : Convert.ToDecimal(x, CultureInfo.InvariantCulture);

    private static int Tam(object x) =>
        x is null || x is DBNull ? 0 : Convert.ToInt32(x, CultureInfo.InvariantCulture);

    private static IEnumerable<object> Dizi(object x) =>
        (x is IEnumerable e && x is not string) ? e.Cast<object>() : Enumerable.Empty<object>();

    /* ==================================================================== */
    /* Veri kümesi: birimler (şube tanımı, bölge, personel → şube)           */
    /* ==================================================================== */

    private sealed record SubeTanim(string Kod, string Ad, string Tur, string Bolge, bool Satis);

    private sealed class BirimVerisi
    {
        public List<SubeTanim> Subeler = new();
        public Dictionary<string, SubeTanim> KodIle = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Mikro iş grubu adı → şube kodu</summary>
        public Dictionary<string, string> BirimKod = new(StringComparer.OrdinalIgnoreCase);

        public List<string> Bolgeler = new();
        public List<YoneticiEslesme> Eslesmeler = new();

        public string KodBul(string mikroBirim) =>
            BirimKod.TryGetValue(K(mikroBirim), out var kod) ? kod : null;

        public SubeTanim Tanim(string kod) =>
            kod is not null && KodIle.TryGetValue(kod, out var t) ? t : null;
    }

    /// <summary>
    /// Satış birimi mi: birim türü boş, "Şube" ya da "Mağaza". Merkez, depo
    /// gibi birimler şube sıralamasına girmiyor.
    /// </summary>
    private static bool SatisBirimi(string tur)
    {
        var t = Ust(tur);
        return t.Length == 0 || t.Contains("ŞUBE") || t.Contains("MAĞAZA");
    }

    /// <summary>
    /// Şube listesi ve personelin hangi şubeye sayılacağı.
    ///
    /// <para>
    /// Şubeler norm raporundaki gibi: Yönetim → Şubeler'deki tanımlar,
    /// "Norm raporunda gizle" işaretliler hariç, kadroda olup tanımda
    /// olmayan kodlar "Tanımsız" olarak. Bölge, bölge tanımından (şube
    /// kodu ya da adıyla yazılmış olabilir); yoksa null.
    /// </para>
    ///
    /// <para>
    /// Personel → şube eşleştirmesi norm kadronun "mevcut" sayımındaki
    /// kuralla (HavuzController.SubeKoduCozucu); orada bulunamazsa genel
    /// şube benzerliği (PersonelKaynagiServisi.SubeUyuyor). Böylece şube
    /// satırında içeride görünen kişi ile mevcut sayılan kişi aynı.
    /// </para>
    /// </summary>
    private BirimVerisi Birimler() => PatronOnbellegi.Al("birim", () =>
    {
        var ayar = _ayar.FormOku();
        var personelAyar = _ayar.PersonelOku();

        List<Kadro> kadrolar;

        using (var db = _vt.Baglanti())
        {
            kadrolar = db.Query<Kadro>(@"
SELECT bolum AS Bolum, LTRIM(RTRIM(sube_kodu)) AS SubeKodu, sube_adi AS SubeAdi
FROM KRY_KADRO
WHERE aktif = 1 AND sube_kodu IS NOT NULL AND LTRIM(RTRIM(sube_kodu)) <> ''").ToList();
        }

        var tanimli = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

        var gizli = tanimli
            .Where(x => x.NormRaporundaGizle)
            .Select(x => K(x.Kod))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var bolgeler = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => !string.IsNullOrWhiteSpace(b.Ad))
            .ToList();

        string BolgeBul(string kod, string ad) =>
            bolgeler.FirstOrDefault(b => (b.Subeler ?? new List<string>())
                .Any(x => Esit(x, kod) || (!string.IsNullOrWhiteSpace(ad) && Esit(x, ad))))?.Ad;

        var subeler = tanimli
            .Where(x => !x.NormRaporundaGizle)
            .Select(x => new SubeTanim(
                K(x.Kod),
                string.IsNullOrWhiteSpace(x.Ad) ? K(x.Kod) : K(x.Ad),
                string.IsNullOrWhiteSpace(x.Tur) ? "Şube" : x.Tur,
                BolgeBul(x.Kod, x.Ad),
                SatisBirimi(x.Tur)))
            .ToList();

        /* Kadroda olup tanımda olmayan kodlar (NormRapor'daki gibi) */
        foreach (var g in kadrolar.GroupBy(k => k.SubeKodu, StringComparer.OrdinalIgnoreCase))
        {
            if (gizli.Contains(g.Key) || tanimli.Any(t => Esit(t.Kod, g.Key))) continue;

            var ad = g.Select(x => K(x.SubeAdi)).FirstOrDefault(x => x.Length > 0) ?? g.Key;

            subeler.Add(new SubeTanim(g.Key, ad, "Tanımsız", BolgeBul(g.Key, ad), false));
        }

        var veri = new BirimVerisi
        {
            Subeler = subeler.OrderBy(x => x.Ad, StringComparer.Create(Tr, true)).ToList(),
            Bolgeler = bolgeler.Select(b => K(b.Ad)).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            Eslesmeler = ayar.UyumYoneticiEslesme ?? new List<YoneticiEslesme>()
        };

        foreach (var s in veri.Subeler) veri.KodIle.TryAdd(s.Kod, s);

        var cozucu = HavuzController.SubeKoduCozucu(kadrolar, personelAyar);

        foreach (var birim in _kaynak.TumPersonelleriGetir()
                     .Select(p => K(p.Sube))
                     .Where(x => x.Length > 0)
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var kod = cozucu(birim)
                      ?? veri.Subeler.FirstOrDefault(t =>
                          PersonelKaynagiServisi.SubeUyuyor(personelAyar, birim, t.Ad, t.Kod))?.Kod;

            if (kod is not null) veri.BirimKod[birim] = kod;
        }

        return veri;
    });

    /* ==================================================================== */
    /* Veri kümesi: canlı okutma                                             */
    /* ==================================================================== */

    private sealed class Kisi
    {
        public PersonelKaydi P;
        public string Kod;
        public string SubeKodu;
        public string SubeAdi;

        /// <summary>magaza · cikti · izin · rapor · yok (panelin "Bugün" sütunu)</summary>
        public string Durum;

        /// <summary>magaza: son giriş; cikti: son hareket</summary>
        public DateTime? Saat;

        public bool Iceride;
        public bool Okuttu;
        public bool Beklenen;

        /// <summary>Panelin okutma raporundaki "Okutmadı" (aşağıdaki not)</summary>
        public bool OkutmadiMi;
        public bool GecKaldi;
        public DateTime? IlkGiris;
    }

    private sealed record Hareket(Kisi Kisi, DateTime Zaman, bool Giris, string Kaynak);

    private sealed class CanliVeri
    {
        public DateTime Zaman;
        public List<Kisi> Kisiler = new();
        public Dictionary<string, Kisi> KodIle = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Bugünkü hareketler, yeniden eskiye</summary>
        public List<Hareket> Bugun = new();

        /// <summary>Bugün için vardiya planı girilmiş mi (geç kalan ölçülebilir mi)</summary>
        public bool PlanVar;
    }

    /// <summary>
    /// Bugünkü okutma durumu, kişi kişi.
    ///
    /// <para>
    /// Kural panelle aynı:
    /// <list type="bullet">
    /// <item>Hareketler iCard (kimlik no) + Biçen360 okutmaları (sicil),
    /// dünden bugüne (PersonelController.IcerdekiPersonel).</item>
    /// <item>İçeride: son hareket giriş ve 16 saatten yeni
    /// (PersonelController.IcerideSayilmaSuresi, GirisMi).</item>
    /// <item>Durum sırası Personeller sayfasının "Bugün" sütunundaki gibi:
    /// mağazada → raporlu → izinli (Izin/Durum: bugün çıkış ile dönüş
    /// arasında) → bugün okutup çıkmış → okutma yok.</item>
    /// </list>
    /// </para>
    ///
    /// <para>
    /// <b>Beklenen</b> (panelde karşılığı yok, burada tanımlandı): bugün
    /// okutmuş ya da içeride olan herkes + okutma raporunun "çalışma günü"
    /// kuralına göre (OkutmaVeriHazirlayici.IzinliOlmayanlar: haftalık izin
    /// günü, vardiya planında izin, resmî tatil hariç) bugün çalışması
    /// beklenen, izinli/raporlu/okutmadan muaf olmayan çalışanlar.
    /// </para>
    ///
    /// <para>
    /// <b>Okutmadı</b>: beklenen olup bugün hiç okutmamış ve içeride
    /// olmayanlar. Sözleşmedeki "beklenen − içeride" yerine bu: öğleden sonra
    /// sabahçılar çıkınca "beklenen − içeride" okutmuş insanları da
    /// "okutmadı" sayıyordu. Okutmayanlar listesi ve şube oranı da aynı
    /// tanımla.
    /// </para>
    ///
    /// <para>
    /// <b>Geç kalan</b>: bugün vardiya planı (KRY_VARDIYA_PLAN + şablon
    /// başlangıcı) olup ilk girişi başlangıçtan 5 dakikadan sonra olanlar.
    /// Bugün kimse için plan yoksa ölçü yok, null.
    /// </para>
    /// </summary>
    private CanliVeri Canli() => PatronOnbellegi.Al("canli", () =>
    {
        var simdi = DateTime.Now;
        var bugun = simdi.Date;
        var birim = Birimler();

        var aktifler = _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .ToList();

        var veri = new CanliVeri { Zaman = simdi };

        foreach (var p in aktifler)
        {
            var kod = birim.KodBul(p.Sube);

            var kisi = new Kisi
            {
                P = p,
                Kod = K(p.PersonelKodu),
                SubeKodu = kod,
                SubeAdi = birim.Tanim(kod)?.Ad ?? K(p.Sube)
            };

            veri.Kisiler.Add(kisi);
            veri.KodIle.TryAdd(kisi.Kod, kisi);
        }

        var kimlikIle = new Dictionary<string, Kisi>(StringComparer.Ordinal);

        foreach (var k in veri.Kisiler)
        {
            var kimlik = Rakam(k.P.KimlikNo);
            if (kimlik.Length == 11) kimlikIle.TryAdd(kimlik, k);
        }

        /* ---------------------------------------------------- hareketler */
        var hareketler = new List<Hareket>();

        try
        {
            using var gecis = _vt.GecisBaglantisi();

            foreach (var x in gecis.Query<(string Kimlik, DateTime? Zaman, string Yon)>(@"
SELECT LTRIM(RTRIM(CONVERT(NVARCHAR(30), p.RegistrationNumber))) AS kimlik,
       t.TransitionDateTime AS zaman,
       CAST(t.Direction AS NVARCHAR(20)) AS yon
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) >= CAST(DATEADD(day, -1, GETDATE()) AS DATE)
  AND p.RegistrationNumber IS NOT NULL", commandTimeout: 60))
            {
                if (x.Zaman is not DateTime z) continue;
                if (!kimlikIle.TryGetValue(Rakam(x.Kimlik), out var kisi)) continue;

                hareketler.Add(new Hareket(kisi, z, PersonelController.GirisMi(x.Yon), MobilOkutmaKaynagi.ICard));
            }
        }
        catch (Exception hata)
        {
            /* iCard kapalıysa uygulama okutmalarıyla devam (panelle aynı) */
            _kayit.LogWarning(hata, "Patron görünümü: iCard hareketleri alınamadı");
        }

        foreach (var m in MobilOkutmaKaynagi.Aralik(_vt, bugun.AddDays(-1), bugun, kayit: _kayit))
        {
            if (veri.KodIle.TryGetValue(K(m.PersonelKodu), out var kisi))
                hareketler.Add(new Hareket(kisi, m.Zaman, PersonelController.GirisMi(m.Tur), m.Kaynak));
        }

        /* --------------------------------------------- izin, rapor, muaf */
        HashSet<string> izinde;

        using (var db = _vt.Baglanti())
        {
            /* Izin/Durum ile aynı: bugün çıkış ile dönüş arasında */
            izinde = db.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(personel_kodu)) FROM KRY_IZIN
WHERE iptal = 0
  AND CAST(SYSDATETIME() AS DATE) BETWEEN cikis_tarihi AND donus_tarihi")
                .Select(K)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        var plan = new Dictionary<string, TimeSpan>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.Baglanti();

            foreach (var x in db.Query<(string Kod, TimeSpan Baslangic)>(@"
SELECT LTRIM(RTRIM(p.personel_kodu)) AS kod, s.baslangic
FROM KRY_VARDIYA_PLAN p
    INNER JOIN KRY_VARDIYA_SABLON s ON s.id = p.sablon_id
WHERE p.gun = @bugun AND p.tur NOT IN (N'izin', N'off')", new { bugun }))
            {
                if (!plan.TryGetValue(x.Kod, out var mevcut) || x.Baslangic < mevcut)
                    plan[x.Kod] = x.Baslangic;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron görünümü: vardiya planı okunamadı");
        }

        veri.PlanVar = plan.Count > 0;

        var raporlu = new RaporluServisi(_vt).Bugun(bugun);
        var muaf = OkutmaKurallari.MuafKodlari(_vt, bugun, bugun);


        /* ------------------------------------------------- kişi durumu */
        var sinir = simdi - PersonelController.IcerideSayilmaSuresi;

        var kisiHareketleri = hareketler
            .GroupBy(h => h.Kisi)
            .ToDictionary(g => g.Key, g => g.OrderBy(h => h.Zaman).ToList());

        foreach (var k in veri.Kisiler)
        {
            kisiHareketleri.TryGetValue(k, out var kendi);
            kendi ??= new List<Hareket>();

            var son = kendi.LastOrDefault();
            var bugunku = kendi.Where(h => h.Zaman.Date == bugun).ToList();

            k.Iceride = son is not null && son.Giris && son.Zaman >= sinir;
            k.Okuttu = bugunku.Count > 0;
            k.IlkGiris = bugunku.Where(h => h.Giris).Select(h => (DateTime?)h.Zaman).FirstOrDefault();

            var rp = raporlu.ContainsKey(RaporluServisi.Anahtar(k.Kod));
            var iz = izinde.Contains(k.Kod);

            if (k.Iceride)
            {
                k.Durum = "magaza";
                k.Saat = son.Zaman;
            }
            else if (rp) k.Durum = "rapor";
            else if (iz) k.Durum = "izin";
            else if (son is not null && son.Zaman.Date == bugun)
            {
                k.Durum = "cikti";
                k.Saat = son.Zaman;
            }
            else k.Durum = "yok";

            /* Okutmadı / beklenen panelin Günlük QR Okutma Raporu ile
               birebir (03.10.2026): çalışan herkes; bugün hiç okutmamış,
               raporlu ve okutmadan muaf olmayan "okutmadı" sayılıyor.
               İlk sürümde izinliler ve o gün çalışma günü olmayanlar da
               düşülüyordu; panel 195 derken burada 100 görünüyordu ve iki
               ekran birbirini tutmuyordu. İzinliler ayrıca "İzinli"
               satırında da görünüyor (raporda olduğu gibi). */
            var muafMi = !rp && muaf.Contains(OkutmaKurallari.Anahtar(k.Kod));

            k.OkutmadiMi = !k.Okuttu && !rp && !muafMi;
            k.Beklenen = k.Okuttu || (!rp && !muafMi);

            if (k.IlkGiris is DateTime ilk && plan.TryGetValue(k.Kod, out var basla))
                k.GecKaldi = ilk > bugun + basla + GecKalmaPayi;
        }

        veri.Bugun = hareketler
            .Where(h => h.Zaman.Date == bugun)
            .OrderByDescending(h => h.Zaman)
            .ToList();

        return veri;
    });

    private sealed record CanliOzet(int Beklenen, int Iceride, int Okutmadi, int Izinli, int Raporlu, int? GecKalan)
    {
        /// <summary>Okutma oranı: beklenenlerden okutmuş (ya da içeride) olanların yüzdesi</summary>
        public int? Oran => Beklenen > 0
            ? (int)Math.Round((Beklenen - Okutmadi) * 100.0 / Beklenen)
            : null;
    }

    private static CanliOzet Topla(IEnumerable<Kisi> kisiler, bool planVar)
    {
        var l = kisiler as IList<Kisi> ?? kisiler.ToList();

        return new CanliOzet(
            l.Count(x => x.Beklenen),
            l.Count(x => x.Iceride),
            l.Count(x => x.OkutmadiMi),
            l.Count(x => x.Durum == "izin"),
            l.Count(x => x.Durum == "rapor"),
            planVar ? l.Count(x => x.GecKaldi) : null);
    }

    /// <summary>Saat saat işe geliş: kişinin bugünkü ilk girişinin saati</summary>
    private static List<object[]> Saatlik(IEnumerable<Kisi> kisiler) =>
        kisiler
            .Where(k => k.IlkGiris.HasValue)
            .GroupBy(k => k.IlkGiris.Value.Hour)
            .OrderBy(g => g.Key)
            .Select(g => new object[] { g.Key.ToString("00"), g.Count() })
            .ToList();

    /// <summary>Ekip satırı (Sube.ekip, Ara.personel)</summary>
    private static object EkipSatiri(Kisi k) => new
    {
        kod = k.Kod,
        ad = Ad(k.P),
        poz = K(k.P.Pozisyon),
        sube = k.SubeAdi,
        durum = k.Durum,
        saat = Saat(k.Saat),
        fotoUrl = PersonelFoto(k.P)
    };

    private static readonly Dictionary<string, int> DurumSirasi = new()
    {
        ["yok"] = 0, ["magaza"] = 1, ["cikti"] = 2, ["izin"] = 3, ["rapor"] = 4
    };

    /* ==================================================================== */
    /* Veri kümesi: norm kadro                                               */
    /* ==================================================================== */

    private sealed class NormVeri
    {
        public List<SubeNormRaporu> Satirlar = new();

        /// <summary>Kadro satırları (senkrondan sonra), şube kartındaki pozisyon listesi için</summary>
        public List<Kadro> Kadro = new();
    }

    /// <summary>
    /// Norm kadro: panelin Norm Kadro Raporu ucu (HavuzController.NormRapor)
    /// aynen çağrılıyor. Ekran her açıldığında Mikro'dan "mevcut"u
    /// tazeliyor; burada da öyle (en çok 30 saniyede bir). Eksik, fazla ve
    /// "kaç gündür" o raporun satırlarından.
    /// </summary>
    private NormVeri Norm() => PatronOnbellegi.Al("norm", () =>
    {
        var rapor = Cagir<HavuzController>(c => c.NormRapor(null))
                    ?? throw new InvalidOperationException("Norm raporu alınamadı.");

        var veri = new NormVeri
        {
            Satirlar = Alan(rapor, "satirlar") as List<SubeNormRaporu> ?? new List<SubeNormRaporu>()
        };

        using var db = _vt.Baglanti();

        veri.Kadro = db.Query<Kadro>(@"
SELECT bolum AS Bolum, LTRIM(RTRIM(ISNULL(sube_kodu, ''))) AS SubeKodu, sube_adi AS SubeAdi,
       ISNULL(norm, 0) AS Norm, ISNULL(mevcut, 0) AS Mevcut,
       CASE WHEN eksik_baslangic IS NULL THEN 0
            ELSE DATEDIFF(day, eksik_baslangic, SYSDATETIME()) END AS EksikGun
FROM KRY_KADRO
WHERE aktif = 1").ToList();

        return veri;
    });

    /* ==================================================================== */
    /* Veri kümesi: şube satırları                                           */
    /* ==================================================================== */

    private sealed class SubeSatiri
    {
        public SubeTanim T;
        public string Mudur;
        public string MudurTel;

        /// <summary>Müdürün sicili (duyuru hedefi "şube müdürleri" için)</summary>
        public string MudurKodu;
        public SubeNormRaporu Norm;
        public CanliOzet Canli;

        public decimal? NormDegeri => Norm is null ? null : N(Norm.Norm);
        public decimal? Mevcut => Norm is null ? null : N(Norm.Mevcut);
        public decimal? Eksik => Norm is null ? null : N(Norm.Eksikler.Sum(x => x.Adet));
        public decimal? Fazla => Norm is null ? null : N(Norm.Fazlalar.Sum(x => x.Adet));

        /// <summary>GET Subeler satırı (sözleşme)</summary>
        public object Disari() => new
        {
            ad = T.Ad,
            bolge = T.Bolge,
            mudur = Mudur,
            norm = NormDegeri,
            mevcut = Mevcut,
            eksik = Eksik,
            fazla = Fazla,
            iceride = Canli?.Iceride,
            beklenen = Canli?.Beklenen,
            okutmadi = Canli?.Okutmadi,
            izinli = Canli?.Izinli,
            raporlu = Canli?.Raporlu,
            oran = Canli?.Oran
        };
    }

    /// <summary>
    /// Şube satırları: tanım + norm + canlı + müdür. Kaynaklardan biri
    /// okunamazsa o alanlar null kalıyor, liste yine dönüyor. Müdür,
    /// panelin uyum değerlendirmesinde kullandığı kuralla
    /// (YoneticiBulucu.MagazaYoneticisi) bulunuyor; elle eşleştirmeler bir
    /// kez okunup bütün şubelerde kullanılıyor.
    /// </summary>
    private List<SubeSatiri> SubeSatirlari() => PatronOnbellegi.Al("subeler", () =>
    {
        var birim = Birimler();
        var canli = Guvenli("canlı okutma", Canli);
        var norm = Guvenli("norm kadro", Norm);

        var aktifler = canli?.Kisiler.Select(k => k.P).ToList()
                       ?? _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        var subeKisileri = canli?.Kisiler
            .Where(k => k.SubeKodu is not null)
            .GroupBy(k => k.SubeKodu, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        /* Müdürü bulmak için şubenin Mikro'daki birim adı: o şubeye
           sayılan personelde en sık geçen ad */
        var mikroAdi = aktifler
            .Select(p => (Kod: birim.KodBul(p.Sube), Birim: K(p.Sube)))
            .Where(x => x.Kod is not null)
            .GroupBy(x => x.Kod, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(x => x.Birim, StringComparer.OrdinalIgnoreCase)
                      .OrderByDescending(x => x.Count()).First().Key,
                StringComparer.OrdinalIgnoreCase);

        var satirlar = new List<SubeSatiri>();

        foreach (var t in birim.Subeler)
        {
            var satir = new SubeSatiri
            {
                T = t,
                Norm = norm?.Satirlar.FirstOrDefault(s => Esit(s.SubeKodu, t.Kod))
            };

            if (subeKisileri is not null)
                satir.Canli = Topla(
                    subeKisileri.TryGetValue(t.Kod, out var kisiler) ? kisiler : new List<Kisi>(),
                    canli.PlanVar);

            if (mikroAdi.TryGetValue(t.Kod, out var mikro))
            {
                try
                {
                    var (ad, tel) = _yonetici.MagazaYoneticisi(aktifler, mikro, null, birim.Eslesmeler);
                    satir.Mudur = ad;
                    satir.MudurTel = tel is null ? null : "0" + tel;

                    /* Bulucu ad ve telefon veriyor; sicil aynı ad (ve
                       telefon) ile, önce o şubede aranıyor. Elle eşleştirilen
                       müdür başka bir birimde kayıtlı olabilir. */
                    if (!string.IsNullOrWhiteSpace(ad))
                        satir.MudurKodu = aktifler
                            .Where(x => Ad(x) == ad
                                        && (tel is null || YoneticiBulucu.TelefonSadelestir(x.Telefon) == tel))
                            .OrderByDescending(x => Esit(birim.KodBul(x.Sube), t.Kod))
                            .Select(x => K(x.PersonelKodu))
                            .FirstOrDefault();
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Patron görünümü: {Sube} müdürü bulunamadı", t.Ad);
                }
            }

            satirlar.Add(satir);
        }

        return satirlar;
    });

    /// <summary>Şube adı, kodu ya da Mikro birim adıyla şube satırı</summary>
    private SubeSatiri SubeBul(string ad)
    {
        var aranan = K(ad);
        if (aranan.Length == 0) return null;

        var satirlar = SubeSatirlari();

        return satirlar.FirstOrDefault(s => Ust(s.T.Ad) == Ust(aranan))
               ?? satirlar.FirstOrDefault(s => Esit(s.T.Kod, aranan))
               ?? satirlar.FirstOrDefault(s =>
                   PersonelKaynagiServisi.BirimAnahtari(s.T.Ad) == PersonelKaynagiServisi.BirimAnahtari(aranan));
    }

    /* ==================================================================== */
    /* Veri kümesi: onaylar                                                  */
    /* ==================================================================== */

    private sealed class OnayKaydi
    {
        public int Id { get; set; }
        public string Tur { get; set; }
        public string Baslik { get; set; }
        public string Ozet { get; set; }
        public int? BasvuruId { get; set; }
        public string SubeAdi { get; set; }
        public DateTime IstekTarihi { get; set; }
        public string IsteyenAdSoyad { get; set; }
        public string AdSoyad { get; set; }
        public DateTime? IseGirisTarihi { get; set; }
        public decimal? AnlasilanUcret { get; set; }
        public decimal? YolUcreti { get; set; }
        public string TalepUcret { get; set; }
        public string Bolum { get; set; }
        public string BasvuruSube { get; set; }
        public bool BasvuruFoto { get; set; }

        /// <summary>Mikro'dan gelen rotasyonda (PersonelDegisimServisi) personelin sicili</summary>
        public string PersonelKodu { get; set; }
    }

    private sealed class SonNot
    {
        public int BasvuruId { get; set; }
        public string Metin { get; set; }
        public string Kisi { get; set; }
    }

    private sealed class OnayVeri
    {
        public List<object> Liste = new();
        public List<(string Tur, int Adet)> Turler = new();

        /// <summary>Liste ile aynı sırada talep tarihleri (aralıkla süzmek için, 1.6)</summary>
        public List<DateTime> Tarihler = new();
    }

    private static string TurKodu(string tur) => tur switch
    {
        OnayTuru.IseAlim => "ise",
        OnayTuru.NormKadro => "norm",
        OnayTuru.Rotasyon => "rot",
        _ => Kucuk(tur)
    };

    /// <summary>"Ayşe Kaya · YENİ İŞE ALIM" başlığındaki işlem türünü okunur yazar</summary>
    private static string IslemAdi(string baslik)
    {
        var i = (baslik ?? "").LastIndexOf(" · ", StringComparison.Ordinal);
        var islem = i < 0 ? "" : Ust(baslik[(i + 3)..]);

        return islem switch
        {
            "YENİ İŞE ALIM" => "Yeni işe alım",
            "ESKİ ÇALIŞAN DÖNÜŞÜ" => "Eski çalışan dönüşü",
            "ROTASYON" => "Rotasyon",
            "" => "İşe alım",
            _ => K(baslik[(i + 3)..])
        };
    }

    /// <summary>
    /// Bekleyen onaylar: panelin onay bildirimindeki (BasvuruController.
    /// OnayBekleyenler) kayıtlar, şube kısıtı olmadan; ayrıca Biçen Kart
    /// puan yükleme talepleri (panel: Puan Onayları). Puan talepleri eksi
    /// kimlikle (-talepId) geliyor; POST Onay/{id} eksi kimlikte panelin
    /// Admin kararıyla aynı kodu çalıştırıyor (BicenKartPuanController).
    /// Mobil "puan" türünü 1.5'ten beri tanıyor: güncelleme gerekmiyor.
    /// </summary>
    private OnayVeri Onaylar() => PatronOnbellegi.Al("onay", () =>
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query<OnayKaydi>($@"
SELECT o.id AS Id, o.tur AS Tur, o.baslik AS Baslik, o.ozet AS Ozet,
       o.basvuru_id AS BasvuruId, o.sube_adi AS SubeAdi, o.istek_tarihi AS IstekTarihi,
       ISNULL(k.ad_soyad, o.isteyen) AS IsteyenAdSoyad,
       b.ad_soyad AS AdSoyad, b.ise_giris_tarihi AS IseGirisTarihi,
       b.anlasilan_ucret AS AnlasilanUcret, b.yol_ucreti AS YolUcreti,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS TalepUcret,
       ISNULL(NULLIF(b.ise_giris_bolum, N''), b.bolumler) AS Bolum,
       b.sube_adi AS BasvuruSube,
       {FotoVarSql} AS BasvuruFoto,
       JSON_VALUE(o.veri_json, '$.personelKodu') AS PersonelKodu
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.isteyen
LEFT JOIN KRY_BASVURULAR b ON b.id = o.basvuru_id
WHERE o.durum = @bekliyor
ORDER BY o.istek_tarihi", new { bekliyor = OnayDurumu.Bekliyor }).ToList();

        /* Başvurunun son notu: onaylayanın göreceği "Görüşme olumlu — X" */
        var notlar = new Dictionary<int, SonNot>();

        foreach (var parca in kayitlar.Where(x => x.BasvuruId is not null)
                     .Select(x => x.BasvuruId.Value).Distinct().Chunk(1500))
        {
            foreach (var n in db.Query<SonNot>(@"
SELECT n.basvuru_id AS BasvuruId, n.metin AS Metin, ISNULL(n.ad_soyad, n.kullanici) AS Kisi
FROM KRY_BASVURU_NOT n
WHERE n.id IN (SELECT MAX(x.id) FROM KRY_BASVURU_NOT x
               WHERE x.basvuru_id IN @parca GROUP BY x.basvuru_id)", new { parca }))
                notlar[n.BasvuruId] = n;
        }

        var skalalar = _ayar.MaasOku().Skalalar ?? new List<MaasSkalasi>();

        /* Rotasyonu Mikro'dan gelen personelin fotoğrafı için */
        var personelIle = kayitlar.Any(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            ? _kaynak.TumPersonelleriGetir()
                .GroupBy(x => K(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Durum == 1).First(), StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, PersonelKaydi>();

        var veri = new OnayVeri
        {
            Turler = kayitlar
                .GroupBy(x => TurKodu(x.Tur))
                .Select(g => (g.Key, g.Count()))
                .ToList()
        };

        foreach (var o in kayitlar)
        {
            var bilgi = new List<string[]>();
            string uyari = null;
            string baslik;
            string alt;

            if (o.Tur == OnayTuru.IseAlim)
            {
                var poz = IlkBolum(o.Bolum);

                baslik = K(o.AdSoyad) is { Length: > 0 } ad ? ad : K(o.Baslik);
                alt = string.Join(" · ", new[] { poz, K(o.BasvuruSube ?? o.SubeAdi), IslemAdi(o.Baslik) }
                    .Where(x => x.Length > 0));

                if (o.IseGirisTarihi is DateTime giris)
                    bilgi.Add(new[] { "Giriş", giris.ToString("dd.MM.yyyy", Tr) });

                /* Panelde onaylayanın gördüğü ücret alanları (OnayBildirimi):
                   anlaşılan, adayın talebi, yol. Skala karşılaştırması
                   panelin işe alım ekranındaki skalaBul ile aynı eşleşme. */
                if (o.AnlasilanUcret is decimal ucret && ucret > 0)
                {
                    var skala = skalalar.FirstOrDefault(s => Ust(s.Bolum) == Ust(poz));
                    var durum = "";

                    if (skala is not null && (skala.AltSinir > 0 || skala.UstSinir > 0))
                    {
                        if (skala.UstSinir > 0 && ucret > skala.UstSinir)
                        {
                            durum = " · skala üstünde";
                            uyari = $"Ücret skalanın {Tl(ucret - skala.UstSinir)} üzerinde";
                        }
                        else if (skala.AltSinir > 0 && ucret < skala.AltSinir)
                        {
                            durum = " · skala altında";
                            uyari = $"Ücret skalanın {Tl(skala.AltSinir - ucret)} altında";
                        }
                        else durum = " · skala içinde";
                    }

                    bilgi.Add(new[] { "Ücret", Tl(ucret) + durum });
                }

                if (decimal.TryParse(K(o.TalepUcret), NumberStyles.Number, CultureInfo.InvariantCulture, out var talep)
                    && talep > 0)
                    bilgi.Add(new[] { "Talep", Tl(talep) });

                if (o.YolUcreti is decimal yol && yol > 0)
                    bilgi.Add(new[] { "Yol", Tl(yol) });
            }
            else if (o.Tur == OnayTuru.Rotasyon)
            {
                baslik = K(o.AdSoyad) is { Length: > 0 } ad ? ad : K(o.Baslik);
                alt = K(o.Ozet);

                if (!string.IsNullOrWhiteSpace(o.Bolum))
                    bilgi.Add(new[] { "Pozisyon", IlkBolum(o.Bolum) });
            }
            else
            {
                baslik = K(o.Baslik);
                alt = K(o.Ozet);

                if (!string.IsNullOrWhiteSpace(o.SubeAdi))
                    bilgi.Add(new[] { "Birim", K(o.SubeAdi) });
            }

            bilgi.Add(new[] { "Gönderen", K(o.IsteyenAdSoyad) });

            string not = null;

            if (o.BasvuruId is int bid && notlar.TryGetValue(bid, out var n) && !string.IsNullOrWhiteSpace(n.Metin))
            {
                var metin = K(n.Metin);
                if (metin.Length > 200) metin = metin[..200] + "…";
                not = string.IsNullOrWhiteSpace(n.Kisi) ? metin : $"{metin} — {K(n.Kisi)}";
            }

            /* Fotoğraf: işe alım ve rotasyonda aday (başvuru formu) ya da
               personel (Mikro); norm kadroda kişi yok */
            string fotoUrl = null;

            if (o.Tur is OnayTuru.IseAlim or OnayTuru.Rotasyon)
            {
                if (o.BasvuruId is int fid && o.BasvuruFoto) fotoUrl = BasvuruFoto(fid, true);
                else if (!string.IsNullOrWhiteSpace(o.PersonelKodu) && personelIle.TryGetValue(K(o.PersonelKodu), out var pk))
                    fotoUrl = PersonelFoto(pk);
            }

            veri.Tarihler.Add(o.IstekTarihi);

            veri.Liste.Add(new
            {
                id = o.Id,
                tur = TurKodu(o.Tur),
                baslik,
                alt,
                bilgi,
                uyari,
                not,
                sure = Sure(o.IstekTarihi),
                basvuruId = o.BasvuruId,
                olusturma = Iso(o.IstekTarihi),
                fotoUrl
            });
        }

        PuanTalepleriniEkle(db, veri);

        return veri;
    });

    /// <summary>Bekleyen Biçen Kart puan yükleme talepleri onay listesine (talep tarihine göre sıralı)</summary>
    private static void PuanTalepleriniEkle(IDbConnection db, OnayVeri veri)
    {
        List<dynamic> talepler;

        try
        {
            talepler = db.Query(@"
SELECT t.id, t.tur, t.aciklama, t.dosya_adi AS dosyaAdi, t.son_kullanim AS sonKullanim,
       ISNULL(t.kart_sayisi, 0) AS kartSayisi, ISNULL(t.toplam_puan, 0) AS toplamPuan,
       ISNULL(t.talep_eden_ad, t.talep_eden) AS talepEden, t.olusturma, t.hata,
       (SELECT MIN(puan) FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS enAz,
       (SELECT MAX(puan) FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS enCok,
       (SELECT TOP 1 ad_soyad FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id ORDER BY s.puan DESC) AS ilkKisi
FROM KRY_PUAN_TALEP t
WHERE t.durum = N'bekliyor'
ORDER BY t.olusturma").ToList();
        }
        catch
        {
            return; /* puan tablosu yoksa onay listesi yine gelsin */
        }

        if (talepler.Count == 0) return;

        var ekler = new List<(DateTime Tarih, object Kayit)>();

        foreach (var t in talepler)
        {
            var tarih = (DateTime)t.olusturma;
            var kisi = (int)t.kartSayisi;
            var toplam = (decimal)t.toplamPuan;
            decimal? enAz = t.enAz is null ? null : Convert.ToDecimal(t.enAz);
            decimal? enCok = t.enCok is null ? null : Convert.ToDecimal(t.enCok);

            var bilgi = new List<string[]>
            {
                new[] { "Toplam", Tl(toplam) },
                new[] { "Kişi", kisi.ToString(Tr) },
            };

            if (enAz is decimal a && enCok is decimal c)
                bilgi.Add(new[] { "Kişi başı", a == c ? Tl(a) : $"{Tl(a)} – {Tl(c)}" });

            if (t.sonKullanim is DateTime sk)
                bilgi.Add(new[] { "Son kullanma", sk.ToString("dd.MM.yyyy", Tr) });

            if (!string.IsNullOrWhiteSpace((string)t.dosyaAdi))
                bilgi.Add(new[] { "Dosya", K((string)t.dosyaAdi) });

            bilgi.Add(new[] { "Gönderen", K((string)t.talepEden) });

            var ilk = K((string)t.ilkKisi);

            ekler.Add((tarih, new
            {
                id = -(int)t.id,
                tur = "puan",
                baslik = K((string)t.aciklama) is { Length: > 0 } ad ? ad : "Biçen Kart puan yükleme",
                alt = $"Biçen Kart yükleme · {kisi} kişi · {Tl(toplam)}",
                bilgi,
                uyari = string.IsNullOrWhiteSpace((string)t.hata)
                    ? null
                    : "Önceki onay denemesinde puanlar yazılamadı; tekrar onaylanabilir",
                not = ilk.Length == 0 ? null : kisi > 1 ? $"{ilk} ve {kisi - 1} kişi daha" : ilk,
                sure = Sure(tarih),
                basvuruId = (int?)null,
                olusturma = Iso(tarih),
                fotoUrl = (string)null
            }));
        }

        /* Talep tarihine göre mevcut listeyle birleştir */
        var tum = veri.Liste.Select((x, i) => (Tarih: veri.Tarihler[i], Kayit: x))
            .Concat(ekler)
            .OrderBy(x => x.Tarih)
            .ToList();

        veri.Liste = tum.Select(x => x.Kayit).ToList();
        veri.Tarihler = tum.Select(x => x.Tarih).ToList();
        veri.Turler.Add(("puan", talepler.Count));
    }

    /* ==================================================================== */
    /* Veri kümesi: başvuru özetleri                                         */
    /* ==================================================================== */

    /// <summary>
    /// Kartlarla aynı taban (BasvuruController.Ozet): arşivlenenler hariç,
    /// aynı kimlikle yapılmış eski başvurular düşülüp yalnızca en yenisi.
    /// </summary>
    private static readonly string BasvuruTabani = @"
FROM KRY_BASVURULAR b
WHERE " + Servisler.BasvuruTabani.Kosul("b");

    /// <summary>Sonuçlanmamış (süreçteki) başvuru koşulu — panel listesinin varsayılanı</summary>
    private const string Surecte = "b.durum NOT IN (N'Olumlu', N'İşe Alındı', N'Olumsuz')";

    private sealed class BasvuruVeri
    {
        public Dictionary<DateTime, int> Gunluk = new();
        public List<(string Durum, int Adet)> Durumlar = new();
        public int Islemsiz;
        public int? EnEskiGun;
        public double? OrtSureGun;
        public int BuAyAlinan;

        public int Gun(DateTime g) => Gunluk.TryGetValue(g.Date, out var a) ? a : 0;
    }

    /// <summary>
    /// Başvuru sayıları tek seferde (QueryMultiple):
    /// son 14 günün günlük sayıları, süreçteki durum dağılımı (+ bu ay işe
    /// alınan), 3+ gündür işlemsiz olanlar ve son 90 günde işe alınanların
    /// başvurudan işe alıma ortalama süresi.
    /// <para>
    /// İşlemsiz: panel listesindeki "son işlemden bu yana" ile aynı
    /// (guncelleme, yoksa başvuru tarihi). Ortalama süre: panelin Dağılım
    /// penceresindeki "işe alım" süresi (ilk "İşe Alındı" hareketine kadar),
    /// güncel tempoyu göstersin diye son 90 günle.
    /// </para>
    /// </summary>
    private BasvuruVeri Basvurular() => PatronOnbellegi.Al("basvuru", () =>
    {
        var bugun = DateTime.Today;
        var ayBas = new DateTime(bugun.Year, bugun.Month, 1);

        using var db = _vt.Baglanti();

        using var cok = db.QueryMultiple($@"
SELECT CAST(b.olusturma AS DATE) AS gun, COUNT(*) AS adet
{BasvuruTabani}
  AND b.olusturma >= @bas14
GROUP BY CAST(b.olusturma AS DATE);

SELECT b.durum AS durum, COUNT(*) AS adet
{BasvuruTabani}
  AND (b.durum NOT IN (N'Olumsuz', N'İşe Alındı')
       OR (b.durum = N'İşe Alındı' AND b.ise_giris_tarihi >= @ayBas AND b.ise_giris_tarihi < @ayBit))
GROUP BY b.durum;

SELECT COUNT(*) AS adet,
       MAX(DATEDIFF(day, ISNULL(b.guncelleme, b.olusturma), SYSDATETIME())) AS enEski
{BasvuruTabani}
  AND {Surecte}
  AND DATEDIFF(day, ISNULL(b.guncelleme, b.olusturma), SYSDATETIME()) >= @islemsiz;

SELECT AVG(DATEDIFF(minute, b.olusturma, h.tarih) / 1440.0)
FROM KRY_BASVURULAR b
    INNER JOIN (SELECT basvuru_id, MIN(tarih) AS tarih
                FROM KRY_BASVURU_HAREKET
                WHERE durum = N'İşe Alındı'
                GROUP BY basvuru_id) h ON h.basvuru_id = b.id
WHERE ISNULL(b.arsiv, 0) = 0
  AND h.tarih >= @bas90 AND h.tarih >= b.olusturma;",
            new
            {
                bas14 = bugun.AddDays(-13),
                ayBas,
                ayBit = ayBas.AddMonths(1),
                islemsiz = IslemsizGun,
                bas90 = bugun.AddDays(-90)
            }, commandTimeout: 60);

        var veri = new BasvuruVeri
        {
            Gunluk = cok.Read<(DateTime Gun, int Adet)>().ToDictionary(x => x.Gun.Date, x => x.Adet),
            Durumlar = cok.Read<(string Durum, int Adet)>().ToList()
        };

        var islemsiz = cok.ReadFirstOrDefault<(int Adet, int? EnEski)>();
        veri.Islemsiz = islemsiz.Adet;
        veri.EnEskiGun = islemsiz.Adet > 0 ? islemsiz.EnEski : null;

        var ort = cok.ReadFirstOrDefault<decimal?>();
        veri.OrtSureGun = ort is decimal d ? Math.Round((double)d, 1) : null;

        veri.BuAyAlinan = veri.Durumlar.Where(x => x.Durum == Durumlar.IseAlindi).Sum(x => x.Adet);

        return veri;
    });

    /// <summary>Daha önce çalışıp ayrılmış kimlikler (panel listesindeki "Eski çalışan" süzgeci)</summary>
    private HashSet<string> EskiKimlikler() =>
        _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum != 1 && !string.IsNullOrWhiteSpace(x.KimlikNo))
            .Select(x => K(x.KimlikNo))
            .ToHashSet(StringComparer.Ordinal);

    private sealed class AdaySatiri
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public string Durum { get; set; }
        public string Sube { get; set; }
        public string Bolum { get; set; }
        public string Kimlik { get; set; }
        public int Gun { get; set; }
        public int Islemsiz { get; set; }
        public bool Foto { get; set; }
    }

    /// <summary>
    /// Başvuru listesi satırları. Görünürlük panel listesiyle aynı: durum
    /// ya da arama yoksa sonuçlanmışlar (Olumlu, İşe Alındı, Olumsuz)
    /// gösterilmez. "islemsiz" durumu 3+ gündür işlem görmemiş süreçteki
    /// başvurular, en eskisi önce. Kimlik numarası yalnızca "eski çalışan"
    /// eşleştirmesi için okunur, dışarı verilmez.
    /// </summary>
    /// <para>
    /// Aralık verilirse (1.6) yalnızca o aralıkta gelen başvurular
    /// (başvuru tarihine göre); görünürlük kuralı aynı.
    /// </para>
    private List<object> AdayListesi(string durum, string ara, int sinir, Aralik aralik = null) =>
        PatronOnbellegi.Al($"bliste|{K(durum)}|{K(ara)}|{sinir}|{aralik?.Anahtar}", () =>
        {
            var islemsiz = string.Equals(K(durum), "islemsiz", StringComparison.OrdinalIgnoreCase);
            var durumDegeri = islemsiz || string.IsNullOrWhiteSpace(durum) ? null : K(durum);
            var arama = string.IsNullOrWhiteSpace(ara) ? null : K(ara);

            using var db = _vt.Baglanti();

            var satirlar = db.Query<AdaySatiri>($@"
SELECT TOP (@sinir) b.id AS Id, b.ad_soyad AS Ad, b.durum AS Durum, b.sube_adi AS Sube,
       ISNULL(NULLIF(b.ise_giris_bolum, N''), b.bolumler) AS Bolum,
       b.kimlik_no AS Kimlik,
       DATEDIFF(day, b.olusturma, SYSDATETIME()) AS Gun,
       DATEDIFF(day, ISNULL(b.guncelleme, b.olusturma), SYSDATETIME()) AS Islemsiz,
       {FotoVarSql} AS Foto
{BasvuruTabani}
  AND (@islemsiz = 0 OR ({Surecte}
       AND DATEDIFF(day, ISNULL(b.guncelleme, b.olusturma), SYSDATETIME()) >= @gunSiniri))
  AND (@durum IS NULL OR b.durum = @durum)
  AND (@durum IS NOT NULL OR @islemsiz = 1 OR @ara IS NOT NULL OR {Surecte})
  AND (@ara IS NULL OR b.ad_soyad LIKE @kalip OR b.basvuru_no LIKE @kalip
       OR b.bolumler LIKE @kalip OR b.sube_adi LIKE @kalip)
  AND (@bas IS NULL OR (b.olusturma >= @bas AND b.olusturma < @bitSonra))
ORDER BY CASE WHEN @islemsiz = 1
              THEN DATEDIFF(day, ISNULL(b.guncelleme, b.olusturma), SYSDATETIME()) END DESC,
         b.id DESC",
                new
                {
                    sinir,
                    islemsiz = islemsiz ? 1 : 0,
                    gunSiniri = IslemsizGun,
                    durum = durumDegeri,
                    ara = arama,
                    kalip = $"%{arama}%",
                    bas = aralik?.Bas,
                    bitSonra = aralik?.BitSonrasi
                }, commandTimeout: 60).ToList();

            HashSet<string> eskiler;

            try
            {
                eskiler = EskiKimlikler();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron görünümü: eski çalışan eşleştirmesi yapılamadı");
                eskiler = new HashSet<string>();
            }

            return satirlar.Select(x => (object)new
            {
                id = x.Id,
                ad = K(x.Ad),
                durum = x.Durum,
                sube = K(x.Sube),
                poz = IlkBolum(x.Bolum),
                /* İşlemsiz görünümünde son işlemden bu yana geçen gün */
                gun = islemsiz ? x.Islemsiz : x.Gun,
                eskiCalisan = !string.IsNullOrWhiteSpace(x.Kimlik) && eskiler.Contains(K(x.Kimlik)),
                fotoUrl = BasvuruFoto(x.Id, x.Foto)
            }).ToList();
        });

    /* ==================================================================== */
    /* Veri kümesi: Biçen Kart                                               */
    /* ==================================================================== */

    private sealed class KartBugunVeri
    {
        public decimal BugunHarcama;
        public int AktifKart;
        public int? UygulamaOrani;
        public List<object> Subeler = new();
        public List<object> SonIslemler = new();
    }

    private sealed class KartGenelVeri
    {
        public decimal ToplamBakiye;
        public decimal AyYuklenen;
        public decimal AyHarcanan;
        public List<object> Gunluk = new();
    }

    /// <summary>
    /// Bugünkü kart hareketleri. Kart kümesi (panelde eşleşmiş personel
    /// kartları), geçici tablo ve harcama formülü Kart Raporları ekranıyla
    /// aynı (BicenKartRaporController.Kartlar / KartTablosuylaAc / HARCAMA).
    /// <para>
    /// aktifKart: sahibi çalışmaya devam eden eşleşmiş kart. uygulamaOrani:
    /// Biçen Kart sayfasındaki oran — kartı eşleşmiş çalışanların tüm
    /// çalışanlara yüzdesi.
    /// </para>
    /// </summary>
    private KartBugunVeri KartBugun() => PatronOnbellegi.Al("kartBugun", () =>
        Kapsamda<BicenKartRaporController, KartBugunVeri>(rapor =>
        {
            var sahipler = rapor.Kartlar();
            var veri = new KartBugunVeri { AktifKart = sahipler.Values.Count(s => s.Aktif) };

            var calisanlar = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();
            var kartliSiciller = sahipler.Values.Select(s => K(s.Sicil)).ToHashSet(StringComparer.OrdinalIgnoreCase);

            veri.UygulamaOrani = calisanlar.Count > 0
                ? (int)Math.Round(calisanlar.Count(p => kartliSiciller.Contains(K(p.PersonelKodu))) * 100.0 / calisanlar.Count)
                : null;

            if (sahipler.Count == 0) return veri;

            var giftKart = rapor.HttpContext.RequestServices.GetRequiredService<GiftKartServisi>();

            using var pos = rapor.KartTablosuylaAc(sahipler.Keys);

            const string h = BicenKartRaporController.HAREKET;
            const string harcama = BicenKartRaporController.HARCAMA;

            using var cok = pos.QueryMultiple($@"
SELECT SUM({harcama})
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bugun;

SELECT h.SubeId AS subeId, SUM({harcama}) AS tutar
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bugun
GROUP BY h.SubeId;

SELECT TOP {AkisSiniri} h.Tarih AS tarih, CONVERT(VARCHAR(20), h.KartNo) AS kartNo, {harcama} AS tutar
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bugun
ORDER BY h.Tarih DESC;", new { bugun = DateTime.Today }, commandTimeout: 120);

            veri.BugunHarcama = N(Ondalik(cok.ReadFirstOrDefault<decimal?>()));

            veri.Subeler = cok.Read()
                .Select(x => new
                {
                    ad = giftKart.SubeAdiBul((object)x.subeId) ?? "Şube belirsiz",
                    tutar = N(Ondalik((object)x.tutar))
                })
                .OrderByDescending(x => x.tutar)
                .Cast<object>()
                .ToList();

            veri.SonIslemler = cok.Read()
                .Select(x =>
                {
                    var no = K((string)x.kartNo);
                    sahipler.TryGetValue(no, out var s);

                    return (object)new
                    {
                        ad = s?.AdSoyad,
                        sube = s?.Sube,
                        tutar = N(Ondalik((object)x.tutar)),
                        saat = Saat((DateTime?)x.tarih),
                        kartSon4 = KartAyrilan.SonDort(no)
                    };
                })
                .ToList();

            return veri;
        }));

    /// <summary>
    /// Bakiye ve aylık hareket: Kart Raporları ekranının formülleriyle
    /// (PARTI = Posback dbo.PuanBakiye kuralı; yükleme = işlem tipi 3,
    /// panelin aylık tablosundaki "yükleme" sütunu; harcama = HARCAMA).
    /// Kart başına satır yerine doğrudan toplam alınıyor.
    /// </summary>
    private KartGenelVeri KartGenel() => PatronOnbellegi.Al("kartGenel", () =>
        Kapsamda<BicenKartRaporController, KartGenelVeri>(rapor =>
        {
            var sahipler = rapor.Kartlar();
            var veri = new KartGenelVeri();

            if (sahipler.Count == 0) return veri;

            using var pos = rapor.KartTablosuylaAc(sahipler.Keys);

            const string h = BicenKartRaporController.HAREKET;
            const string harcama = BicenKartRaporController.HARCAMA;
            const string parti = BicenKartRaporController.PARTI;

            var bugun = DateTime.Today;

            using var cok = pos.QueryMultiple($@"
SELECT SUM(CASE WHEN {parti} THEN h.Puan - h.EksiPuan ELSE 0 END)
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo;

SELECT SUM(CASE WHEN h.IslemTipi = 3 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS yuklenen,
       SUM(CASE WHEN h.IslemTipi = 2 THEN {harcama} ELSE 0 END) AS harcanan
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.Tarih >= @ayBas AND h.IslemTipi IN (2, 3);

SELECT CAST(h.Tarih AS DATE) AS gun, SUM({harcama}) AS tutar
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bas14
GROUP BY CAST(h.Tarih AS DATE);",
                new
                {
                    kod = rapor.PuanKodu,
                    ayBas = new DateTime(bugun.Year, bugun.Month, 1),
                    bas14 = bugun.AddDays(-13)
                }, commandTimeout: 180);

            veri.ToplamBakiye = N(Ondalik(cok.ReadFirstOrDefault<decimal?>()));

            var ay = cok.ReadFirstOrDefault();
            veri.AyYuklenen = N(Ondalik((object)ay?.yuklenen));
            veri.AyHarcanan = N(Ondalik((object)ay?.harcanan));

            var gunler = cok.Read().ToDictionary(x => ((DateTime)x.gun).Date, x => Ondalik((object)x.tutar));

            veri.Gunluk = Enumerable.Range(0, 14)
                .Select(i => bugun.AddDays(-13 + i))
                .Select(g => (object)new { gun = g.Day.ToString("00"), tutar = N(gunler.GetValueOrDefault(g)) })
                .ToList();

            return veri;
        }));

    /// <summary>
    /// Ayrılan personele gönderilen kart bağlantıları: Biçen Kart → Ayrılan
    /// Personel → Takip ekranının özeti (tüm dönemler).
    /// </summary>
    private object KartBaglanti() => PatronOnbellegi.Al("kartBaglanti", () =>
    {
        var takip = Cagir<BicenKartController>(c => c.AyrilanTakip(null, null, null))
                    ?? throw new InvalidOperationException("Bağlantı takibi alınamadı.");

        var ozet = Alan(takip, "ozet");

        return (object)new
        {
            gonderildi = Tam(Alan(ozet, "gonderildi")),
            kullandi = Tam(Alan(ozet, "kullanmayaBasladi")),
            suresiDoldu = Tam(Alan(ozet, "suresiDoldu"))
        };
    });

    /// <summary>Bekleyen Biçen Kart puan yükleme talepleri (panel: Puan Onayları)</summary>
    private object PuanOnay() => PatronOnbellegi.Al("kartPuan", () =>
    {
        using var db = _vt.Baglanti();

        var bekleyenler = db.Query<(string Aciklama, decimal ToplamPuan, int KartSayisi)>(@"
SELECT aciklama, ISNULL(toplam_puan, 0), ISNULL(kart_sayisi, 0)
FROM KRY_PUAN_TALEP
WHERE durum = N'bekliyor'
ORDER BY olusturma").ToList();

        if (bekleyenler.Count == 0) return (object)new { adet = 0, aciklama = (string)null };

        var ilk = bekleyenler[0];

        var aciklama = string.Join(" · ", new[]
        {
            K(ilk.Aciklama),
            $"{ilk.ToplamPuan.ToString("N0", Tr)} puan",
            $"{ilk.KartSayisi} kişi"
        }.Where(x => x.Length > 0));

        if (bekleyenler.Count > 1) aciklama += $" · +{bekleyenler.Count - 1} talep daha";

        return (object)new { adet = bekleyenler.Count, aciklama };
    });

    /* ==================================================================== */
    /* Veri kümesi: sirkülasyon, etik, performans, izin                      */
    /* ==================================================================== */

    private sealed class SirkulasyonVeri
    {
        public int AyGiris;
        public int AyCikis;
        public double Oran;
        public double YillikOran;
        public List<(DateTime Ay, int Giris, int Cikis)> Aylar = new();
        public List<object> Nedenler = new();
        public int? Ilk90Orani;
    }

    /// <summary>
    /// Sirkülasyon: oranlar ve çıkış nedenleri panelin Sirkülasyon ekranından
    /// (PersonelController.Sirkulasyon): bu ay için aylık devir oranı, son bir
    /// yıl için yıllık devir oranı ve neden dağılımı. Aylık seri (son 12 ay
    /// giriş/çıkış) ve "ilk 90 günde ayrılan" oranı panelde yok; aynı
    /// personel listesinden (giriş/çıkış tarihi) sayılıyor.
    /// </summary>
    private SirkulasyonVeri Sirkulasyon() => PatronOnbellegi.Al("sirk", () =>
    {
        var bugun = DateTime.Today;
        var ayBas = new DateTime(bugun.Year, bugun.Month, 1);

        var buAy = Cagir<PersonelController>(c => c.Sirkulasyon(ayBas, bugun))
                   ?? throw new InvalidOperationException("Aylık sirkülasyon alınamadı.");

        var yillik = Cagir<PersonelController>(c => c.Sirkulasyon(bugun.AddYears(-1), bugun))
                     ?? throw new InvalidOperationException("Yıllık sirkülasyon alınamadı.");

        var veri = new SirkulasyonVeri
        {
            AyGiris = Tam(Alan(buAy, "giren")),
            AyCikis = Tam(Alan(buAy, "cikan")),
            Oran = Convert.ToDouble(Ondalik(Alan(buAy, "devirOrani"))),
            YillikOran = Convert.ToDouble(Ondalik(Alan(yillik, "yillikDevir"))),
            Nedenler = Dizi(Alan(yillik, "sebepler"))
                .Select(x => (object)new { neden = (string)Alan(x, "sebep"), adet = Tam(Alan(x, "adet")) })
                .Take(10)
                .ToList()
        };

        var tumu = _kaynak.TumPersonelleriGetir();

        for (var i = 11; i >= 0; i--)
        {
            var bas = ayBas.AddMonths(-i);
            var bit = bas.AddMonths(1);

            veri.Aylar.Add((
                bas,
                tumu.Count(p => p.GirisTarihi >= bas && p.GirisTarihi < bit && p.GirisTarihi <= bugun.AddDays(1)),
                tumu.Count(p => p.CikisTarihi >= bas && p.CikisTarihi < bit && p.CikisTarihi < bugun.AddDays(1))));
        }

        /* Son bir yılda ayrılanlardan ilk 90 gününü doldurmadan gidenler */
        var cikanlar = tumu
            .Where(p => p.CikisTarihi >= bugun.AddYears(-1) && p.CikisTarihi < bugun.AddDays(1))
            .ToList();

        veri.Ilk90Orani = cikanlar.Count > 0
            ? (int)Math.Round(cikanlar.Count(p => p.CalismaGunu >= 0 && p.CalismaGunu < 90) * 100.0 / cikanlar.Count)
            : null;

        return veri;
    });

    private static readonly Dictionary<string, string> EtikDurumAdi = new()
    {
        ["alindi"] = "Yeni",
        ["inceleniyor"] = "İnceleniyor",
        ["ek_bilgi"] = "Ek bilgi bekleniyor",
        ["sonuclandi"] = "Sonuçlandı",
        ["kapandi"] = "Kapandı"
    };

    private sealed class EtikVeri
    {
        public int Yeni;
        public int Acik;
        public DateTime? SonYeni;
        public List<object> Son = new();
    }

    /// <summary>
    /// Etik hat: yalnızca sayılar ve son bildirimlerin türü / durumu / tarihi.
    /// Açıklama, şube, bildiren ve ekler bilerek okunmuyor bile.
    /// </summary>
    private EtikVeri Etik() => PatronOnbellegi.Al("etik", () =>
    {
        using var db = _vt.Baglanti();

        using var cok = db.QueryMultiple(@"
SELECT SUM(CASE WHEN durum = N'alindi' THEN 1 ELSE 0 END) AS yeni,
       SUM(CASE WHEN durum IN (N'alindi', N'inceleniyor', N'ek_bilgi') THEN 1 ELSE 0 END) AS acik,
       MAX(CASE WHEN durum = N'alindi' THEN olusturma END) AS sonYeni
FROM KRY_ETIK;

SELECT TOP 5 tur, durum, olusturma FROM KRY_ETIK ORDER BY olusturma DESC;");

        var sayi = cok.ReadFirstOrDefault();

        var veri = new EtikVeri
        {
            Yeni = Tam((object)sayi?.yeni),
            Acik = Tam((object)sayi?.acik),
            SonYeni = (DateTime?)sayi?.sonYeni
        };

        veri.Son = cok.Read()
            .Select(x => (object)new
            {
                baslik = (string)x.tur,
                durum = EtikDurumAdi.GetValueOrDefault(K((string)x.durum)) ?? (string)x.durum,
                tarih = Iso((DateTime?)x.olusturma)
            })
            .ToList();

        return veri;
    });

    /// <summary>
    /// Performans: panelin performans karşılaştırma ucu (PerformansController
    /// .Ozet, en son dönem). Şube puanı = o şubedeki kişilerin mağaza
    /// performansı ortalaması. Veri yoksa null.
    /// </summary>
    private object Performans() => PerformansDonemi(null, null);

    /// <summary>Belirli ayın performansı (aralık: aralığın bittiği ay, 1.6); null/null en son dönem.</summary>
    private object PerformansDonemi(int? donemYil, int? donemAy) => PatronOnbellegi.Al($"perf|{donemYil}|{donemAy}", () =>
    {
        var ozet = Cagir<PerformansController>(c => c.Ozet(donemYil, donemAy, null));

        var kayitlar = Dizi(Alan(ozet, "kayitlar"))
            .Select(x => (Sube: K(Alan(x, "subeAdi") as string), Puan: OndalikMi(Alan(x, "magazaToplam"))))
            .Where(x => x.Puan.HasValue)
            .ToList();

        if (kayitlar.Count == 0) return null;

        var yil = Tam(Alan(ozet, "yil"));
        var ay = Tam(Alan(ozet, "ay"));

        return (object)new
        {
            donem = ay is >= 1 and <= 12
                ? $"{CultureInfo.GetCultureInfo("tr-TR").DateTimeFormat.GetMonthName(ay)} {yil}"
                : yil.ToString(),
            ortalama = Math.Round(kayitlar.Average(x => x.Puan.Value), 1),
            subeler = kayitlar
                .Where(x => x.Sube.Length > 0)
                .GroupBy(x => x.Sube, StringComparer.OrdinalIgnoreCase)
                .Select(g => new { ad = g.Key, puan = Math.Round(g.Average(x => x.Puan.Value), 1) })
                .OrderByDescending(x => x.puan)
                .Take(ListeSiniri)
                .ToList()
        };
    });

    /// <summary>
    /// Önümüzdeki 7 gün, gün gün izinli kişi sayısı (Izin/Durum'daki gibi
    /// çıkış ile dönüş arası; yalnızca çalışanlar).
    /// </summary>
    private List<object[]> YediGunIzin() => PatronOnbellegi.Al("izin7", () =>
    {
        var bugun = DateTime.Today;
        var son = bugun.AddDays(6);

        var calisanlar = _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .Select(x => K(x.PersonelKodu))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        using var db = _vt.Baglanti();

        var izinler = db.Query<(string Kod, DateTime? Cikis, DateTime? Donus)>(@"
SELECT LTRIM(RTRIM(personel_kodu)), cikis_tarihi, donus_tarihi
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @son AND donus_tarihi >= @bugun",
                new { bugun, son })
            .Where(x => x.Cikis.HasValue && x.Donus.HasValue && calisanlar.Contains(K(x.Kod)))
            .ToList();

        return Enumerable.Range(0, 7)
            .Select(i => bugun.AddDays(i))
            .Select(g => new object[]
            {
                GunAdlari[(int)g.DayOfWeek],
                izinler.Where(x => x.Cikis.Value.Date <= g && x.Donus.Value.Date >= g)
                    .Select(x => x.Kod)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count()
            })
            .ToList();
    });

    /* ==================================================================== */
    /* GET Ozet                                                              */
    /* ==================================================================== */

    /// <summary>
    /// Ana ekran. Bölümler paralel hazırlanıyor; biri okunamazsa yalnızca o
    /// bölüm null. Şirket geneli kısım 30 saniye paylaşılıyor; kişiye özel
    /// iki alan (ek sözleşme 1-2) her istekte üstüne ekleniyor:
    /// <c>ben</c> (giriş yapan patronun adı ve fotoğrafı) ve
    /// <c>sayfalar</c> (sunucu tanımlı WebView sayfaları, <see cref="SayfaTanimlari"/>).
    /// <para>
    /// <c>bas</c>/<c>bit</c> verilirse (1.6) zamana bağlı bölümler o aralık
    /// için (<see cref="AralikOzet"/>); verilmezse yanıt eskisiyle aynı.
    /// </para>
    /// </summary>
    [HttpGet("Ozet")]
    public async Task<IActionResult> Ozet([FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        /* Patron görünümünü açtığı an (Yönetim → Patron Görünümü'nde "son giriş") */
        _patron.GirisYaz(p.PersonelKodu);

        var ortak = aralik is not null
            ? await AralikOzet(aralik)
            : PatronOnbellegi.Dene("ozet", out var hazir) ? hazir : await OrtakOzet();

        /* Paylaşılan nesne değiştirilmiyor; alanları yeni bir sözlüğe
           kopyalanıp kişiye özel alanlar ona ekleniyor */
        var yanit = ortak.GetType().GetProperties()
            .ToDictionary(x => x.Name, x => x.GetValue(ortak));

        yanit["ben"] = new { ad = Ad(p), fotoUrl = PersonelFoto(p) };
        yanit["sayfalar"] = Guvenli("sayfalar", () => Sayfalar(p)) ?? new List<object>();

        return Ok(yanit);
    }

    /// <summary>Özet'in bütün patronlar için aynı olan kısmı</summary>
    private async Task<object> OrtakOzet()
    {
        var tCanli = Paralel("canlı okutma", Canli);
        var tNorm = Paralel("norm kadro", Norm);
        var tOnay = Paralel("onaylar", Onaylar);
        var tBasvuru = Paralel("başvurular", Basvurular);
        var tKart = Paralel("Biçen Kart", KartBugun);
        var tSirk = Paralel("sirkülasyon", Sirkulasyon);
        var tEtik = Paralel("etik hat", Etik);

        await Task.WhenAll(tCanli, tNorm, tOnay, tBasvuru, tKart, tSirk, tEtik);

        var canli = tCanli.Result;
        var norm = tNorm.Result;
        var onay = tOnay.Result;
        var basvuru = tBasvuru.Result;
        var kart = tKart.Result;
        var sirk = tSirk.Result;
        var etik = tEtik.Result;

        /* Şube satırları canlı ve norm verisini önbellekten alıyor */
        var subeler = await Paralel("şubeler", SubeSatirlari);
        var birim = Guvenli("birimler", Birimler);

        int? calisan = canli?.Kisiler.Count
                       ?? Guvenli("personel", () => (object)_kaynak.TumPersonelleriGetir().Count(x => x.Durum == 1)) as int?;

        /* ------------------------------------------------------- canlı */
        object canliBolum = null;

        if (canli is not null)
        {
            var o = Topla(canli.Kisiler, canli.PlanVar);
            var son = canli.Bugun.FirstOrDefault();

            canliBolum = new
            {
                beklenen = o.Beklenen,
                iceride = o.Iceride,
                okutmadi = o.Okutmadi,
                izinli = o.Izinli,
                raporlu = o.Raporlu,
                gecKalan = o.GecKalan,
                sonOkutma = son is null ? null : new { saat = Saat(son.Zaman), sube = son.Kisi.SubeAdi }
            };
        }

        /* ------------------------------------------------------- norm */
        object normBolum = null;

        if (norm is not null)
        {
            normBolum = new
            {
                norm = N(norm.Satirlar.Sum(x => x.Norm)),
                mevcut = N(norm.Satirlar.Sum(x => x.Mevcut)),
                eksik = N(norm.Satirlar.Sum(x => x.Eksikler.Sum(e => e.Adet))),
                fazla = N(norm.Satirlar.Sum(x => x.Fazlalar.Sum(e => e.Adet))),
                doluluk = Doluluk(norm.Satirlar.Sum(x => x.Norm), norm.Satirlar.Sum(x => x.Eksikler.Sum(e => e.Adet))),
                eksikSube = norm.Satirlar.Count(x => !string.IsNullOrWhiteSpace(x.SubeKodu) && x.Eksikler.Count > 0)
            };
        }

        /* ---------------------------------------------------- başvuru */
        object basvuruBolum = null;

        if (basvuru is not null)
        {
            var bugun = DateTime.Today;

            basvuruBolum = new
            {
                bugun = basvuru.Gun(bugun),
                dun = basvuru.Gun(bugun.AddDays(-1)),
                /* Son 7 gün ve ondan önceki 7 gün (yarım hafta ile tam hafta kıyaslanmasın) */
                hafta = Enumerable.Range(0, 7).Sum(i => basvuru.Gun(bugun.AddDays(-i))),
                gecenHafta = Enumerable.Range(7, 7).Sum(i => basvuru.Gun(bugun.AddDays(-i))),
                son7 = Enumerable.Range(0, 7).Select(i => basvuru.Gun(bugun.AddDays(-6 + i))).ToList(),
                islemsiz = basvuru.Islemsiz,
                enEskiGun = basvuru.EnEskiGun
            };
        }

        /* ------------------------------------------------------ dikkat */
        var dikkat = new List<object>();

        if (subeler is not null && DateTime.Now.Hour >= OkutmaUyarisiSaati)
        {
            foreach (var s in subeler
                         .Where(x => x.T.Satis && x.Canli is { Beklenen: >= 3 } && x.Canli.Oran < 75)
                         .OrderBy(x => x.Canli.Oran)
                         .Take(2))
            {
                dikkat.Add(new
                {
                    tur = "okutma",
                    baslik = $"{s.T.Ad}: okutma %{s.Canli.Oran}",
                    alt = $"{s.Canli.Okutmadi} kişi henüz okutmadı"
                          + (string.IsNullOrWhiteSpace(s.Mudur) ? "" : $" · Md. {s.Mudur}"),
                    hedef = new { ekran = "sube", p = s.T.Ad }
                });
            }
        }

        if (norm is not null)
        {
            var enUzun = norm.Satirlar
                .Where(x => !string.IsNullOrWhiteSpace(x.SubeKodu))
                .SelectMany(x => x.Eksikler.Select(e => (Sube: x.SubeAdi, Eksik: e)))
                .OrderByDescending(x => x.Eksik.Gun)
                .ThenByDescending(x => x.Eksik.Adet)
                .FirstOrDefault();

            if (enUzun.Eksik is not null)
            {
                dikkat.Add(new
                {
                    tur = "kadro",
                    baslik = $"{enUzun.Sube}: {Adet(enUzun.Eksik.Adet)} {Kucuk(enUzun.Eksik.Bolum)} eksik",
                    alt = enUzun.Eksik.Gun > 0 ? $"{enUzun.Eksik.Gun} gündür doldurulamadı" : "Yeni açıldı",
                    hedef = new { ekran = "sube", p = enUzun.Sube }
                });
            }
        }

        if (basvuru is { Islemsiz: > 0 })
        {
            dikkat.Add(new
            {
                tur = "basvuru",
                baslik = $"{basvuru.Islemsiz} başvuru {IslemsizGun}+ gündür işlemsiz",
                alt = $"En eskisi {basvuru.EnEskiGun} gün",
                hedef = new { ekran = "basvurular", p = "islemsiz" }
            });
        }

        if (etik is { Yeni: > 0 })
        {
            dikkat.Add(new
            {
                tur = "etik",
                baslik = $"Etik hatta {etik.Yeni} yeni bildirim",
                alt = etik.SonYeni is DateTime t ? GunSaat(t) : null,
                hedef = new { ekran = "ik", p = (string)null }
            });
        }

        var veri = new
        {
            zaman = Iso(DateTime.Now),
            calisan,
            birimSayisi = birim?.Subeler.Count(x => x.Satis),
            canli = canliBolum,
            onay = onay is null
                ? null
                : new
                {
                    toplam = onay.Turler.Sum(x => x.Adet),
                    turler = onay.Turler.Select(x => new { tur = x.Tur, adet = x.Adet }).ToList()
                },
            norm = normBolum,
            basvuru = basvuruBolum,
            kart = kart is null ? null : new { bugunHarcama = kart.BugunHarcama, aktifKart = kart.AktifKart },
            sirkulasyon = sirk is null
                ? null
                : new
                {
                    ayGiris = sirk.AyGiris,
                    ayCikis = sirk.AyCikis,
                    oran = sirk.Oran,
                    /* Son 6 ayın çıkış sayıları, eskiden yeniye */
                    son6 = sirk.Aylar.Skip(6).Select(x => x.Cikis).ToList()
                },
            dikkat = dikkat.Take(5).ToList(),
            subeSirasi = subeler?
                .Where(x => x.T.Satis)
                .OrderByDescending(x => x.Canli?.Oran ?? -1)
                .ThenBy(x => x.T.Ad, StringComparer.Create(Tr, true))
                .Take(40)
                .Select(x => new
                {
                    ad = x.T.Ad,
                    bolge = x.T.Bolge,
                    oran = x.Canli?.Oran,
                    iceride = x.Canli?.Iceride,
                    beklenen = x.Canli?.Beklenen,
                    mevcut = x.Mevcut,
                    norm = x.NormDegeri
                })
                .ToList()
        };

        PatronOnbellegi.Koy("ozet", veri);

        return veri;
    }

    /* ==================================================================== */
    /* GET Subeler, GET Sube                                                 */
    /* ==================================================================== */

    [HttpGet("Subeler")]
    public IActionResult Subeler([FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        if (aralik is not null) return SubelerAralik(aralik);

        var satirlar = Guvenli("şubeler", SubeSatirlari) ?? new List<SubeSatiri>();
        var birim = Guvenli("birimler", Birimler);

        return Ok(new
        {
            bolgeler = birim?.Bolgeler ?? new List<string>(),
            subeler = satirlar.Select(x => x.Disari()).ToList()
        });
    }

    [HttpGet("Sube")]
    public IActionResult Sube([FromQuery] string ad, [FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        var s = Guvenli("şube", () => SubeBul(ad));

        if (s is null) return NotFound(new { hata = "Şube bulunamadı." });

        if (aralik is not null) return SubeAralik(aralik, s);

        var canli = Guvenli("canlı okutma", Canli);
        var norm = Guvenli("norm kadro", Norm);

        var kisiler = canli?.Kisiler
            .Where(k => Esit(k.SubeKodu, s.T.Kod))
            .ToList() ?? new List<Kisi>();

        return Ok(new
        {
            ad = s.T.Ad,
            bolge = s.T.Bolge,
            mudur = s.Mudur,
            mudurTel = s.MudurTel,
            norm = s.NormDegeri,
            mevcut = s.Mevcut,
            eksik = s.Eksik,
            iceride = s.Canli?.Iceride,
            beklenen = s.Canli?.Beklenen,
            oran = s.Canli?.Oran,
            saatlik = Saatlik(kisiler),
            kadro = norm?.Kadro
                .Where(k => Esit(k.SubeKodu, s.T.Kod))
                .Select(k => new
                {
                    poz = K(k.Bolum),
                    norm = N(k.Norm),
                    mevcut = N(k.Mevcut),
                    eksik = N(Math.Max(0, k.Norm - k.Mevcut)),
                    gun = k.Norm > k.Mevcut && k.EksikGun > 0 ? (int?)k.EksikGun : null
                })
                .OrderByDescending(k => k.eksik)
                .ThenBy(k => k.poz, StringComparer.Create(Tr, true))
                .ToList(),
            ekip = kisiler
                .OrderBy(k => DurumSirasi.GetValueOrDefault(k.Durum, 9))
                .ThenBy(k => Ad(k.P), StringComparer.Create(Tr, true))
                .Take(ListeSiniri)
                .Select(EkipSatiri)
                .ToList()
        });
    }

    /* ==================================================================== */
    /* GET Onaylar, POST Onay/{id}                                           */
    /* ==================================================================== */

    [HttpGet("Onaylar")]
    public IActionResult OnayListesi([FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        if (aralik is not null) return OnaylarAralik(aralik, p);

        var bekleyen = Guvenli("onaylar", Onaylar);
        var imza = Imza(p);

        /* Bu kişinin son 30 kararı: kararlar imzasıyla yazılıyor */
        var verilenler = Guvenli("verilen kararlar", () => PatronOnbellegi.Al($"verilen|{imza}", () =>
        {
            using var db = _vt.Baglanti();

            return db.Query<(int Id, string Tur, string Baslik, string AdSoyad, string Durum, string Not, DateTime? Tarih)>(@"
SELECT TOP 30 x.id, x.tur, x.baslik, x.ad_soyad, x.durum, x.onay_notu, x.onay_tarihi
FROM (
    SELECT o.id, o.tur, o.baslik, b.ad_soyad, o.durum, o.onay_notu, o.onay_tarihi
    FROM KRY_ONAY o
    LEFT JOIN KRY_BASVURULAR b ON b.id = o.basvuru_id
    WHERE o.onaylayan = @imza AND o.durum IN (@onay, @red)
    UNION ALL
    /* Biçen Kart puan talepleri (patron kararı) */
    SELECT -t.id, N'puan', t.aciklama, NULL,
           CASE WHEN t.durum = N'onaylandi' THEN @onay ELSE @red END, t.red_sebebi, t.karar_tarihi
    FROM KRY_PUAN_TALEP t
    WHERE t.karar_veren = @imza AND t.durum IN (N'onaylandi', N'reddedildi')
) x
ORDER BY x.onay_tarihi DESC",
                    new { imza, onay = OnayDurumu.Onaylandi, red = OnayDurumu.Reddedildi })
                .Select(x => (object)new
                {
                    id = x.Id,
                    tur = TurKodu(x.Tur),
                    baslik = x.Tur == OnayTuru.NormKadro || string.IsNullOrWhiteSpace(x.AdSoyad)
                        ? K(x.Baslik)
                        : K(x.AdSoyad),
                    sonuc = x.Durum == OnayDurumu.Onaylandi ? "onay" : "red",
                    not = string.IsNullOrWhiteSpace(x.Not) ? null : K(x.Not),
                    saat = x.Tarih?.ToString("dd.MM HH:mm", Tr)
                })
                .ToList();
        }));

        /* Avans talepleri (07.10.2026): yalnızca akışta bu kişinin adımındakiler */
        var avanslar = Guvenli("avans onayları", () => AvansOnaylari(p)) ?? new();

        /* İzin talepleri ve fazla mesai (09.10.2026): org şemasına göre bu kişide bekleyenler */
        var talepler = Guvenli("izin ve fazla mesai onayları", () => PersonelTalepOnaylari(p)) ?? new();

        return Ok(new
        {
            onaylar = avanslar.Select(x => x.Kayit)
                .Concat(talepler.Select(x => x.Kayit))
                .Concat(bekleyen?.Liste ?? new List<object>())
                .Take(ListeSiniri).ToList(),
            verilenler = verilenler ?? new List<object>()
        });
    }

    /// <summary>Avans kimliği: puan talepleri eksi kimlikle geliyor, avans bu ofsetle</summary>
    internal const int AvansKimlik = 1_000_000_000;

    /// <summary>
    /// Avans onay akışında (Ayarlar Merkezi › Onay akışları) bu kişinin
    /// sicilinin bulunduğu adımda bekleyen talepler. Kimlik -(1e9 + id);
    /// 1.5 bilmediği türü "Onay" diye gösteriyor, onay/red aynı uçtan.
    /// </summary>
    private List<(DateTime Tarih, object Kayit)> AvansOnaylari(PersonelKaydi p)
    {
        /* Zinciri olan talepler (08.10.2026, Avans onay tablosu): adımın
           onaylayanları talebe yazılı. Zinciri olmayan eski talepler genel
           akıştaki sicille. */
        var eski = AvansOnayZinciri.EskiAdimlar()
            .Select((x, i) => (x, i))
            .Where(t => AvansOnayZinciri.SicilYetkili(t.x, p.PersonelKodu))
            .Select(t => t.i)
            .ToHashSet();

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT id, ad_soyad AS adSoyad, sube, pozisyon, tutar, taksit, onay_tutar AS onayTutar, onay_taksit AS onayTaksit,
       neden, aciklama, ara_not AS araNot, olusturma, ISNULL(asama, 0) AS asama, zincir, personel_kodu AS kod
FROM KRY_AVANS
WHERE durum = N'bekliyor'
ORDER BY olusturma").ToList()
            .Where(x =>
            {
                var z = AvansOnayZinciri.Oku((string)x.zincir);
                if (z is null) return eski.Contains((int)x.asama);
                return AvansOnayZinciri.SicilYetkili(AvansOnayZinciri.AdimAl(z.Adimlar, (int)x.asama), p.PersonelKodu)
                       && K((string)x.kod).TrimStart('0') != K(p.PersonelKodu).TrimStart('0');
            })
            .ToList();

        if (satirlar.Count == 0) return new();

        var hazirRed = AvansController.RedGerekceleriOku(db);

        return satirlar.Select(x =>
        {
            var tutar = (decimal)(x.onayTutar ?? x.tutar);
            var taksit = (int)(x.onayTaksit ?? x.taksit);
            var tarih = (DateTime)x.olusturma;

            var bilgi = new List<string[]>
            {
                new[] { "Tutar", Tl(tutar) + ((decimal?)x.onayTutar is decimal ot && ot != (decimal)x.tutar ? $" (istenen {Tl((decimal)x.tutar)})" : "") },
                new[] { "Taksit", taksit == 1 ? "tek seferde" : $"{taksit} taksit" },
            };

            if (!string.IsNullOrWhiteSpace((string)x.sube)) bilgi.Add(new[] { "Birim", K((string)x.sube) });
            if (!string.IsNullOrWhiteSpace((string)x.pozisyon)) bilgi.Add(new[] { "Pozisyon", K((string)x.pozisyon) });
            if (!string.IsNullOrWhiteSpace((string)x.neden)) bilgi.Add(new[] { "Neden", K((string)x.neden) });

            /* 15.10.2026: İK / yönetim adı görünmez */
            var ara = K(KararEtiketi.Maskele(((string)x.araNot ?? "").Split('\n')[0]));
            var aciklama = K((string)x.aciklama);

            return (tarih, (object)new
            {
                id = -(AvansKimlik + (int)x.id),
                tur = "avans",
                /* 1.8: ret sayfasındaki hazır gerekçeler (Yönetim › Avans kuralları) */
                hazirRed,
                baslik = K((string)x.adSoyad),
                alt = $"Avans talebi · {Tl(tutar)}" + (taksit > 1 ? $" · {taksit} taksit" : ""),
                bilgi,
                uyari = ara.Length == 0 ? null : ara,
                not = aciklama.Length == 0 ? null : aciklama,
                sure = Sure(tarih),
                basvuruId = (int?)null,
                olusturma = Iso(tarih),
                fotoUrl = (string)null
            });
        }).ToList();
    }

    /// <summary>Avans kararı: panelde aynı kod (AvansController.KararUygula)</summary>
    private async Task<IActionResult> AvansKarari(int avansId, bool onay, string not, PersonelKaydi p)
    {
        if (!onay && not.Length < 3)
            return BadRequest(new { hata = "Reddetme sebebini yazınız." });

        var imza = Imza(p);
        var avans = HttpContext.RequestServices.GetRequiredService<AvansController>();
        avans.ControllerContext = ControllerContext;

        var sonuc = await avans.DisaridanKarar(avansId, onay, not, imza, p.PersonelKodu);

        if (sonuc is ObjectResult or && (or.StatusCode ?? 200) >= 400)
        {
            var hata = or.Value?.GetType().GetProperty("hata")?.GetValue(or.Value) as string ?? "Karar kaydedilemedi.";
            return StatusCode(or.StatusCode ?? 400, new { hata });
        }

        _gunluk.Yaz("PATRON AVANS KARARI", IstemciAdresi.Bul(HttpContext),
            $"{imza} ({K(p.PersonelKodu)}) → avans #{avansId} · {(onay ? "onay" : "red")}");

        string sonraki = null;
        if (sonuc is ObjectResult ok && ok.Value is not null)
            sonraki = ok.Value.GetType().GetProperty("sonrakiAdim")?.GetValue(ok.Value) as string;

        return Ok(new
        {
            basarili = true,
            mesaj = sonraki is not null
                ? $"Kararınız kaydedildi; talep {sonraki} onayına geçti."
                : onay ? "Avans talebi onaylandı." : "Avans talebi reddedildi."
        });
    }

    /// <summary>
    /// Onay ya da red. Panelde genel müdür yardımcısının kararıyla aynı
    /// kod çalışıyor (OnayKarariServisi): başvuru durumu, hareket kaydı,
    /// norm kadro güncellemesi, rotasyonda birimi geri alma ve isteyene
    /// bildirim. Karar veren olarak "Ad Soyad (Biçen360)" yazılıyor.
    /// <para>
    /// Neden controller'ı sahte kimlikle çağırmak yerine servis: o yolda
    /// patron için bir GMY kimliği kurgulanacak, panelin yetki denetimi
    /// (onay yetkisi) sahte rolle geçilecekti. Servis yetkiyi çağırana
    /// bırakıyor; burada yetki patron listesi.
    /// </para>
    /// </summary>
    [HttpPost("Onay/{id:int}")]
    public async Task<IActionResult> OnayVer(int id, [FromBody] PatronOnayGirdi girdi)
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        var onay = girdi?.Onay ?? false;
        var not = K(girdi?.Not);

        if (!onay && not.Length == 0)
            return BadRequest(new { hata = "Reddederken gerekçe yazınız." });

        if (not.Length > 500)
            return BadRequest(new { hata = "Not en fazla 500 karakter olabilir." });

        /* İzin ve fazla mesai (09.10.2026): personel görünümündeki İzin Onayları ile aynı karar */
        if (id <= -IzinKimlik) return await PersonelTalepKarari(id, onay, not, p);
        if (id <= -AvansKimlik) return await AvansKarari(-id - AvansKimlik, onay, not, p);
        if (id < 0) return await PuanKarari(-id, onay, not, p);

        string tur;

        using (var db = _vt.Baglanti())
        {
            tur = db.ExecuteScalar<string>("SELECT tur FROM KRY_ONAY WHERE id = @id", new { id });
        }

        if (tur is null) return NotFound(new { hata = "Onay kaydı bulunamadı." });

        var imza = Imza(p);

        var sonuc = OnayKarariServisi.Uygula(_vt, id, onay, not.Length == 0 ? null : not, imza, imza);

        if (sonuc.Kod == 404) return NotFound(new { hata = sonuc.Hata });
        if (sonuc.Kod != 200) return BadRequest(new { hata = sonuc.Hata });

        _gunluk.Yaz("PATRON ONAY KARARI", IstemciAdresi.Bul(HttpContext),
            $"{imza} ({K(p.PersonelKodu)}) → #{id} {tur} · {(onay ? "onay" : "red")}");

        /* Karar onayları, başvuru sayılarını ve (norm onayında) kadroyu
           değiştiriyor: ilgili önbellek siliniyor ki patron kendi kararını
           hemen görsün. */
        PatronOnbellegi.Temizle("onay", "verilen|", "ozet", "basvuru", "bliste|", "bdetay|", "norm", "subeler");

        var mesaj = (tur, onay) switch
        {
            (OnayTuru.IseAlim, true) => "İşe alım onaylandı.",
            (OnayTuru.IseAlim, false) => "İşe alım reddedildi; aday evrak aşamasına döndü.",
            (OnayTuru.NormKadro, true) => "Norm kadro değişikliği onaylandı.",
            (OnayTuru.NormKadro, false) => "Norm kadro değişikliği reddedildi.",
            (OnayTuru.Rotasyon, true) => "Rotasyon onaylandı.",
            (OnayTuru.Rotasyon, false) => "Rotasyon reddedildi; aday eski birimine döndü.",
            (_, true) => "Onaylandı.",
            _ => "Reddedildi."
        };

        return Ok(new { basarili = true, mesaj });
    }

    /// <summary>
    /// Biçen Kart puan yükleme talebi: panelde Admin'in kararıyla aynı kod.
    /// Onayda puanlar POS'a yazılıyor, talep edene bildirim ve e-posta gidiyor.
    /// </summary>
    private async Task<IActionResult> PuanKarari(int talepId, bool onay, string not, PersonelKaydi p)
    {
        if (!onay && not.Length < 3)
            return BadRequest(new { hata = "Reddetme sebebini yazınız; talep eden bunu görür." });

        var imza = Imza(p);
        var puan = HttpContext.RequestServices.GetRequiredService<BicenKartPuanController>();

        var sonuc = await puan.DisaridanKarar(talepId, onay, not, imza, imza);

        PatronOnbellegi.Temizle("onay", "verilen|", "ozet", "kartPuan", "kart");

        if (sonuc is ObjectResult or && (or.StatusCode ?? 200) >= 400)
        {
            var hata = or.Value?.GetType().GetProperty("hata")?.GetValue(or.Value) as string ?? "Karar kaydedilemedi.";
            return StatusCode(or.StatusCode ?? 400, new { hata });
        }

        _gunluk.Yaz("PATRON PUAN KARARI", IstemciAdresi.Bul(HttpContext),
            $"{imza} ({K(p.PersonelKodu)}) → puan talebi #{talepId} · {(onay ? "onay" : "red")}");

        return Ok(new
        {
            basarili = true,
            mesaj = onay ? "Puan yüklemesi onaylandı; tutarlar kartlara yüklendi." : "Puan yükleme talebi reddedildi."
        });
    }

    /* ==================================================================== */
    /* GET Basvurular, GET Basvuru/{id}, POST Basvuru/{id}/Not               */
    /* ==================================================================== */

    /// <summary>
    /// Sözleşmedeki huni sırası; panelde ara durumlar (Değerlendirmede,
    /// Olumlu) sayısı varsa araya giriyor.
    /// </summary>
    private static readonly string[] HuniSirasi =
    {
        Durumlar.Yeni, Durumlar.Incelendi, Durumlar.Degerlendirmede, Durumlar.GorusmeTalebi,
        Durumlar.Olumlu, Durumlar.EvrakHazirlaniyor, Durumlar.OnayBekliyor, Durumlar.IseAlindi
    };

    private static readonly HashSet<string> HuniHepGorunen = new()
    {
        Durumlar.Yeni, Durumlar.Incelendi, Durumlar.GorusmeTalebi,
        Durumlar.EvrakHazirlaniyor, Durumlar.OnayBekliyor, Durumlar.IseAlindi
    };

    [HttpGet("Basvurular")]
    public IActionResult BasvuruListesi([FromQuery] string durum = null, [FromQuery] string ara = null,
        [FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        if (aralik is not null) return BasvurularAralik(aralik, durum, ara);

        var veri = Guvenli("başvurular", Basvurular);
        var liste = Guvenli("başvuru listesi", () => AdayListesi(durum, ara, ListeSiniri));
        var bugun = DateTime.Today;

        return Ok(new
        {
            bugun = veri?.Gun(bugun),
            ortSureGun = veri?.OrtSureGun,
            buAyAlinan = veri?.BuAyAlinan,
            huni = veri is null
                ? new List<object>()
                : HuniSirasi
                    .Select(d => (Durum: d, Adet: veri.Durumlar.Where(x => x.Durum == d).Sum(x => x.Adet)))
                    .Where(x => x.Adet > 0 || HuniHepGorunen.Contains(x.Durum))
                    .Select(x => (object)new { durum = x.Durum, adet = x.Adet })
                    .ToList(),
            son14 = veri is null
                ? new List<object>()
                : Enumerable.Range(0, 14)
                    .Select(i => bugun.AddDays(-13 + i))
                    .Select(g => (object)new { gun = g.Day.ToString("00"), adet = veri.Gun(g) })
                    .ToList(),
            liste = liste ?? new List<object>()
        });
    }

    private sealed class AdayAyrinti
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public string Durum { get; set; }
        public string Sube { get; set; }
        public string Bolum { get; set; }
        public int Gun { get; set; }
        public string Kimlik { get; set; }
        public string DogumTarihi { get; set; }
        public string Tecrubeler { get; set; }
        public string TalepUcret { get; set; }
        public int? ReferansPuani { get; set; }
        public bool Foto { get; set; }
    }

    /// <summary>Doğum tarihinden yaş (formda "GG.AA.YYYY")</summary>
    private static int? Yas(string dogum)
    {
        var bicimler = new[] { "dd.MM.yyyy", "d.M.yyyy", "yyyy-MM-dd", "yyyy-MM-dd'T'HH:mm:ss" };

        if (!DateTime.TryParseExact(K(dogum), bicimler, Tr, DateTimeStyles.None, out var t)) return null;

        var bugun = DateTime.Today;
        var yas = bugun.Year - t.Year;
        if (t.Date > bugun.AddYears(-yas)) yas--;

        return yas is > 0 and < 100 ? yas : null;
    }

    /// <summary>
    /// İş tecrübesi süresi: panelin aday kartındaki tecrubeYili ile aynı
    /// yaklaşık hesap (giriş ve çıkış yıllarının farkı; çıkış yoksa bu yıl).
    /// </summary>
    private static string Tecrube(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;

        try
        {
            using var belge = JsonDocument.Parse(json);

            if (belge.RootElement.ValueKind != JsonValueKind.Array) return null;

            var isyerleri = belge.RootElement.EnumerateArray().ToList();
            if (isyerleri.Count == 0) return null;

            static int? YilBul(JsonElement e, string alan)
            {
                if (!e.TryGetProperty(alan, out var d) || d.ValueKind != JsonValueKind.String) return null;
                var m = System.Text.RegularExpressions.Regex.Match(d.GetString() ?? "", @"(19|20)\d{2}");
                return m.Success ? int.Parse(m.Value) : null;
            }

            var toplam = 0;
            var bulundu = false;

            foreach (var t in isyerleri)
            {
                if (YilBul(t, "iseGirisTarihi") is not int g) continue;

                var c = YilBul(t, "istenCikisTarihi") ?? DateTime.Today.Year;

                if (c >= g)
                {
                    toplam += c - g;
                    bulundu = true;
                }
            }

            if (!bulundu) return $"{isyerleri.Count} iş yeri";

            return toplam == 0 ? "1 yıldan az" : $"{toplam} yıl";
        }
        catch
        {
            return null;
        }
    }

    [HttpGet("Basvuru/{id:int}")]
    public IActionResult Basvuru(int id)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var veri = PatronOnbellegi.Al($"bdetay|{id}", () =>
        {
            using var db = _vt.Baglanti();

            /* Form verisinin tamamı okunmuyor (fotoğrafın base64'ü var);
               yalnızca gereken alanlar. Kimlik numarası yalnızca eski
               çalışan eşleştirmesi için. */
            var a = db.QueryFirstOrDefault<AdayAyrinti>($@"
SELECT b.id AS Id, b.ad_soyad AS Ad, b.durum AS Durum, b.sube_adi AS Sube,
       ISNULL(NULLIF(b.ise_giris_bolum, N''), b.bolumler) AS Bolum,
       DATEDIFF(day, b.olusturma, SYSDATETIME()) AS Gun,
       b.kimlik_no AS Kimlik,
       JSON_VALUE(b.veri_json, '$.dogumTarihi') AS DogumTarihi,
       JSON_QUERY(b.veri_json, '$.isTecrubesi') AS Tecrubeler,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS TalepUcret,
       (SELECT TOP 1 r.puan FROM KRY_REFERANS r
         WHERE r.basvuru_id = b.id AND r.puan IS NOT NULL
         ORDER BY r.olusturma DESC) AS ReferansPuani,
       {FotoVarSql} AS Foto
FROM KRY_BASVURULAR b
WHERE b.id = @id", new { id });

            if (a is null) return null;

            var notlar = db.Query<(string Metin, string Kisi, DateTime Tarih)>(@"
SELECT metin, ISNULL(ad_soyad, kullanici), tarih
FROM KRY_BASVURU_NOT WHERE basvuru_id = @id ORDER BY id DESC", new { id })
                .Select(n => new { metin = n.Metin, kisi = n.Kisi, tarih = Iso(n.Tarih) })
                .ToList();

            var eskiCalisan = false;

            try
            {
                eskiCalisan = !string.IsNullOrWhiteSpace(a.Kimlik) && EskiKimlikler().Contains(K(a.Kimlik));
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron görünümü: eski çalışan eşleştirmesi yapılamadı");
            }

            string ucretBeklenti = null;

            if (decimal.TryParse(K(a.TalepUcret), NumberStyles.Number, CultureInfo.InvariantCulture, out var u) && u > 0)
                ucretBeklenti = Tl(u);
            else if (!string.IsNullOrWhiteSpace(a.TalepUcret))
                ucretBeklenti = K(a.TalepUcret);

            return (object)new
            {
                id = a.Id,
                ad = K(a.Ad),
                durum = a.Durum,
                sube = K(a.Sube),
                poz = IlkBolum(a.Bolum),
                gun = a.Gun,
                yas = Yas(a.DogumTarihi),
                tecrube = Tecrube(a.Tecrubeler),
                ucretBeklenti,
                referansPuani = a.ReferansPuani,
                eskiCalisan,
                notlar,
                fotoUrl = BasvuruFoto(a.Id, a.Foto)
            };
        });

        return veri is null ? NotFound(new { hata = "Başvuru bulunamadı." }) : Ok(veri);
    }

    /// <summary>Başvuruya not: panelde aynı tabloda, "Ad Soyad (Biçen360)" imzasıyla görünür.</summary>
    [HttpPost("Basvuru/{id:int}/Not")]
    public IActionResult NotEkle(int id, [FromBody] PatronNotGirdi girdi)
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        var metin = K(girdi?.Metin);

        /* Panel ucundaki (BasvuruController.NotEkle) sınırlar */
        if (metin.Length == 0) return BadRequest(new { hata = "Not metni boş olamaz." });
        if (metin.Length > 4000) return BadRequest(new { hata = "Not en fazla 4000 karakter olabilir." });

        using var db = _vt.Baglanti();

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_BASVURULAR WHERE id = @id", new { id }) == 0)
            return NotFound(new { hata = "Başvuru bulunamadı." });

        var imza = Imza(p);

        BasvuruController.NotYaz(db, id, metin, imza, imza);

        PatronOnbellegi.Temizle($"bdetay|{id}", "onay");

        return Ok(new { basarili = true, mesaj = "Not eklendi." });
    }

    /* ==================================================================== */
    /* GET Norm, GET Gecis                                                   */
    /* ==================================================================== */

    [HttpGet("Norm")]
    public IActionResult NormKadro([FromQuery] string bolge = null, [FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        var norm = Guvenli("norm kadro", Norm);
        var subeler = Guvenli("şubeler", SubeSatirlari) ?? new List<SubeSatiri>();
        var birim = Guvenli("birimler", Birimler);

        var bolgeVar = !string.IsNullOrWhiteSpace(bolge);

        bool BolgedeMi(string subeKodu) =>
            !bolgeVar || Esit(birim?.Tanim(subeKodu)?.Bolge, bolge);

        /* Bölge seçilince "Tüm Birimler (genel)" satırı hiçbir bölgeye ait
           olmadığı için dışarıda kalıyor; seçilmezse toplamlar norm
           raporunun toplamlarıyla aynı. */
        var satirlar = norm?.Satirlar
            .Where(x => !bolgeVar || (!string.IsNullOrWhiteSpace(x.SubeKodu) && BolgedeMi(x.SubeKodu)))
            .ToList() ?? new List<SubeNormRaporu>();

        var eksikler = satirlar
            .Where(x => !string.IsNullOrWhiteSpace(x.SubeKodu))
            .SelectMany(x => x.Eksikler.Select(e => (Sube: x.SubeAdi, Eksik: e)))
            .ToList();

        var klasik = new
        {
            norm = norm is null ? (decimal?)null : N(satirlar.Sum(x => x.Norm)),
            mevcut = norm is null ? (decimal?)null : N(satirlar.Sum(x => x.Mevcut)),
            eksik = norm is null ? (decimal?)null : N(satirlar.Sum(x => x.Eksikler.Sum(e => e.Adet))),
            fazla = norm is null ? (decimal?)null : N(satirlar.Sum(x => x.Fazlalar.Sum(e => e.Adet))),
            doluluk = norm is null ? null : Doluluk(satirlar.Sum(x => x.Norm), satirlar.Sum(x => x.Eksikler.Sum(e => e.Adet))),
            raporlu = norm is null ? (int?)null : satirlar.Sum(x => x.Raporlu),
            /* Pozisyon bazında fazla (1.6 ekranı) */
            fazlaPozisyonlar = satirlar
                .Where(x => !string.IsNullOrWhiteSpace(x.SubeKodu))
                .SelectMany(x => x.Fazlalar.Select(e => (Sube: x.SubeAdi, Fazla: e)))
                .GroupBy(x => K(x.Fazla.Bolum), StringComparer.Create(Tr, true))
                .Select(g => new
                {
                    poz = g.Key,
                    adet = N(g.Sum(x => x.Fazla.Adet)),
                    subeler = g.Select(x => x.Sube).Distinct().ToList()
                })
                .OrderByDescending(x => x.adet)
                .Take(ListeSiniri)
                .ToList(),
            pozisyonlar = eksikler
                .GroupBy(x => K(x.Eksik.Bolum), StringComparer.Create(Tr, true))
                .Select(g => new
                {
                    poz = g.Key,
                    adet = N(g.Sum(x => x.Eksik.Adet)),
                    subeler = g.Select(x => x.Sube).Distinct().ToList()
                })
                .OrderByDescending(x => x.adet)
                .Take(ListeSiniri)
                .ToList(),
            uzunBos = eksikler
                .OrderByDescending(x => x.Eksik.Gun)
                .ThenByDescending(x => x.Eksik.Adet)
                .Take(ListeSiniri)
                .Select(x => new
                {
                    sube = x.Sube,
                    poz = K(x.Eksik.Bolum),
                    adet = N(x.Eksik.Adet),
                    gun = x.Eksik.Gun > 0 ? (int?)x.Eksik.Gun : null
                })
                .ToList(),
            subeler = subeler
                .Where(x => !bolgeVar || Esit(x.T.Bolge, bolge))
                .Select(x => x.Disari())
                .ToList()
        };

        /* Aralıkla (1.6): kadro şu an; aralıktaki giriş/çıkış ve şube okutması eklenir */
        return aralik is not null ? NormAralik(aralik, bolge, klasik) : Ok(klasik);
    }

    /// <summary>
    /// Canlı okutma. <c>filtre</c>: bölge adı, şube adı/kodu ya da Mikro
    /// birim adı; boşsa şirket geneli.
    /// </summary>
    [HttpGet("Gecis")]
    public IActionResult Gecis([FromQuery] string filtre = null, [FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        if (aralik is not null) return GecisAralik(aralik, filtre);

        var canli = Guvenli("canlı okutma", Canli);

        if (canli is null)
            return Ok(new
            {
                iceride = (int?)null, okutmadi = (int?)null, gecKalan = (int?)null, beklenen = (int?)null,
                saatlik = new List<object[]>(), akis = new List<object>(), okutmayanlar = new List<object>()
            });

        IEnumerable<Kisi> kisiler = canli.Kisiler;

        if (!string.IsNullOrWhiteSpace(filtre))
        {
            var birim = Birimler();
            var f = K(filtre);

            if (birim.Bolgeler.Any(b => Esit(b, f)))
            {
                kisiler = kisiler.Where(k => Esit(birim.Tanim(k.SubeKodu)?.Bolge, f));
            }
            else
            {
                var sube = Guvenli("şube", () => SubeBul(f));

                kisiler = sube is not null
                    ? kisiler.Where(k => Esit(k.SubeKodu, sube.T.Kod))
                    : kisiler.Where(k => Esit(k.P.Sube, f));
            }
        }

        var liste = kisiler.ToList();
        var kume = liste.ToHashSet();
        var o = Topla(liste, canli.PlanVar);

        return Ok(new
        {
            iceride = o.Iceride,
            okutmadi = o.Okutmadi,
            gecKalan = o.GecKalan,
            beklenen = o.Beklenen,
            saatlik = Saatlik(liste),
            akis = canli.Bugun
                .Where(h => kume.Contains(h.Kisi))
                .Take(AkisSiniri)
                .Select(h => new
                {
                    kod = h.Kisi.Kod,
                    ad = Ad(h.Kisi.P),
                    sube = h.Kisi.SubeAdi,
                    poz = K(h.Kisi.P.Pozisyon),
                    saat = Saat(h.Zaman),
                    giris = h.Giris,
                    kaynak = h.Kaynak,
                    fotoUrl = PersonelFoto(h.Kisi.P)
                })
                .ToList(),
            okutmayanlar = liste
                .Where(k => k.OkutmadiMi)
                .OrderBy(k => k.SubeAdi, StringComparer.Create(Tr, true))
                .ThenBy(k => Ad(k.P), StringComparer.Create(Tr, true))
                .Take(ListeSiniri)
                .Select(k => new { kod = k.Kod, ad = Ad(k.P), sube = k.SubeAdi, poz = K(k.P.Pozisyon), fotoUrl = PersonelFoto(k.P) })
                .ToList()
        });
    }

    /* ==================================================================== */
    /* GET Kart                                                              */
    /* ==================================================================== */

    [HttpGet("Kart")]
    public async Task<IActionResult> Kart([FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        if (aralik is not null) return await KartAralik(aralik);

        var tBugun = Paralel("kart bugün", KartBugun);
        var tGenel = Paralel("kart bakiye", KartGenel);
        var tBaglanti = Paralel("kart bağlantıları", KartBaglanti);
        var tPuan = Paralel("puan onayı", PuanOnay);

        await Task.WhenAll(tBugun, tGenel, tBaglanti, tPuan);

        var bugun = tBugun.Result;
        var genel = tGenel.Result;

        return Ok(new
        {
            toplamBakiye = genel?.ToplamBakiye,
            aktifKart = bugun?.AktifKart,
            uygulamaOrani = bugun?.UygulamaOrani,
            bugunHarcama = bugun?.BugunHarcama,
            ayYuklenen = genel?.AyYuklenen,
            ayHarcanan = genel?.AyHarcanan,
            gunluk = genel?.Gunluk ?? new List<object>(),
            subeler = bugun?.Subeler.Take(ListeSiniri).ToList() ?? new List<object>(),
            baglanti = tBaglanti.Result,
            puanOnay = tPuan.Result,
            sonIslemler = bugun?.SonIslemler ?? new List<object>()
        });
    }

    /* ==================================================================== */
    /* GET Ik                                                                */
    /* ==================================================================== */

    [HttpGet("Ik")]
    public async Task<IActionResult> Ik([FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        if (aralik is not null) return await IkAralik(aralik);

        var tCanli = Paralel("canlı okutma", Canli);
        var tIzin = Paralel("7 günlük izin", YediGunIzin);
        var tSirk = Paralel("sirkülasyon", Sirkulasyon);
        var tEtik = Paralel("etik hat", Etik);
        var tPerf = Paralel("performans", Performans);

        await Task.WhenAll(tCanli, tIzin, tSirk, tEtik, tPerf);

        var canli = tCanli.Result;
        var sirk = tSirk.Result;
        var etik = tEtik.Result;

        List<object> Durumdakiler(string durum) =>
            canli?.Kisiler
                .Where(k => k.Durum == durum)
                .OrderBy(k => k.SubeAdi, StringComparer.Create(Tr, true))
                .ThenBy(k => Ad(k.P), StringComparer.Create(Tr, true))
                .Take(ListeSiniri)
                .Select(k => (object)new
                {
                    kod = k.Kod,
                    ad = Ad(k.P),
                    poz = K(k.P.Pozisyon),
                    sube = k.SubeAdi,
                    durum = k.Durum,
                    saat = (string)null,
                    fotoUrl = PersonelFoto(k.P)
                })
                .ToList() ?? new List<object>();

        return Ok(new
        {
            izinli = Durumdakiler("izin"),
            raporlu = Durumdakiler("rapor"),
            yediGunIzin = tIzin.Result ?? new List<object[]>(),
            sirkulasyon = sirk is null
                ? null
                : new
                {
                    ayGiris = sirk.AyGiris,
                    ayCikis = sirk.AyCikis,
                    yillikOran = sirk.YillikOran,
                    son12 = sirk.Aylar
                        .Select(x => new { ay = AyKisa[x.Ay.Month - 1], giris = x.Giris, cikis = x.Cikis })
                        .ToList(),
                    nedenler = sirk.Nedenler,
                    ilk90Orani = sirk.Ilk90Orani
                },
            etik = etik is null ? null : new { yeni = etik.Yeni, acik = etik.Acik, son = etik.Son },
            performans = tPerf.Result
        });
    }

    /* ==================================================================== */
    /* GET Personel/{kod}                                                    */
    /* ==================================================================== */

    [HttpGet("Personel/{kod}")]
    public IActionResult Personel(string kod)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var aranan = K(kod);

        var p = _kaynak.TumPersonelleriGetir()
            .Where(x => string.Equals(K(x.PersonelKodu), aranan, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.Durum == 1)
            .FirstOrDefault();

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var veri = PatronOnbellegi.Al($"kisi|{aranan}", () =>
        {
            /* İzin bakiyesi: Izin/Durum ve mobil ana sayfadaki hesap
               (hak edilen + devir − kullanılan − planlı) */
            decimal? izinBakiye = null;
            int? kidemGun = null;

            try
            {
                using var db = _vt.Baglanti();

                using var cok = db.QueryMultiple(@"
SELECT baslangic AS hakedilen, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod;

SELECT ISNULL(SUM(CASE WHEN cikis_tarihi <= CAST(SYSDATETIME() AS DATE) THEN gun ELSE 0 END), 0) AS kullanilan,
       ISNULL(SUM(CASE WHEN cikis_tarihi > CAST(SYSDATETIME() AS DATE) THEN gun ELSE 0 END), 0) AS planli
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1;", new { kod = aranan });

                var bakiye = cok.ReadFirstOrDefault();
                var kullanim = cok.ReadFirstOrDefault();

                if (bakiye is not null)
                {
                    izinBakiye = N(Ondalik((object)bakiye.hakedilen) + Ondalik((object)bakiye.devir)
                                   - Ondalik((object)bakiye.aktarilan)
                                   - Ondalik((object)kullanim?.kullanilan) - Ondalik((object)kullanim?.planli));
                }

                /* Kıdem: izin hak edişinin esas aldığı tarih (düzeltme varsa o),
                   mobil profildeki kıdemle aynı */
                if (IzinHakedis.Esas(p.GirisTarihi, IzinHakedis.Getir(db, aranan)) is DateTime esas)
                    kidemGun = Math.Max(0, (DateTime.Today - esas.Date).Days);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron görünümü: {Kod} izin bilgisi okunamadı", aranan);
            }

            /* Son dönem mağaza performansı (panel personel kartıyla aynı uç) */
            decimal? performans = null;

            try
            {
                var perf = Cagir<PerformansController>(c => c.Personel(p.Guid, p.Guid is null ? K(p.KimlikNo) : null));
                var son = Dizi(Alan(perf, "donemler")).FirstOrDefault();

                if (OndalikMi(Alan(son, "magazaToplam")) is decimal puan)
                    performans = Math.Round(puan, 1);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron görünümü: {Kod} performansı okunamadı", aranan);
            }

            return (object)new { izinBakiye, kidemGun, performans };
        });

        var canli = p.Durum == 1 ? Guvenli("canlı okutma", Canli) : null;
        Kisi kisi = null;
        canli?.KodIle.TryGetValue(aranan, out kisi);

        var tel = YoneticiBulucu.TelefonSadelestir(p.Telefon);

        return Ok(new
        {
            kod = K(p.PersonelKodu),
            ad = Ad(p),
            poz = K(p.Pozisyon),
            sube = kisi?.SubeAdi ?? K(p.Sube),
            kidemGun = Alan(veri, "kidemGun"),
            durum = kisi?.Durum,
            saat = Saat(kisi?.Saat),
            izinBakiye = Alan(veri, "izinBakiye"),
            telefon = tel is null ? (Rakam(p.Telefon) is { Length: > 0 } r ? r : null) : "0" + tel,
            performans = Alan(veri, "performans"),
            fotoUrl = PersonelFoto(p)
        });
    }

    /* ==================================================================== */
    /* GET Ara                                                               */
    /* ==================================================================== */

    [HttpGet("Ara")]
    public IActionResult Ara([FromQuery] string q)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var ara = Kucuk(q);

        if (ara.Length < 2)
            return Ok(new { personel = new List<object>(), subeler = new List<object>(), adaylar = new List<object>() });

        var canli = Guvenli("canlı okutma", Canli);

        var personel = canli?.Kisiler
            .Where(k => $"{Ad(k.P)} {k.Kod} {k.SubeAdi} {k.P.Pozisyon}".ToLower(Tr).Contains(ara))
            .OrderBy(k => Ad(k.P), StringComparer.Create(Tr, true))
            .Take(AramaSiniri)
            .Select(EkipSatiri)
            .ToList()
            ?? _kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1 && $"{Ad(x)} {x.PersonelKodu} {x.Sube} {x.Pozisyon}".ToLower(Tr).Contains(ara))
                .Take(AramaSiniri)
                .Select(x => (object)new { kod = K(x.PersonelKodu), ad = Ad(x), poz = K(x.Pozisyon), sube = K(x.Sube), durum = (string)null, saat = (string)null, fotoUrl = PersonelFoto(x) })
                .ToList();

        var subeler = (Guvenli("şubeler", SubeSatirlari) ?? new List<SubeSatiri>())
            .Where(s => Kucuk(s.T.Ad).Contains(ara) || Kucuk(s.T.Kod).Contains(ara))
            .Take(AramaSiniri)
            .Select(s => s.Disari())
            .ToList();

        /* Adaylarda sonuçlanmışlar da aranır (panel aramasıyla aynı) */
        var adaylar = Guvenli("aday arama", () => AdayListesi(null, K(q), AramaSiniri)) ?? new List<object>();

        return Ok(new { personel, subeler, adaylar });
    }
}

/// <summary>POST Onay/{id} gövdesi</summary>
public class PatronOnayGirdi
{
    public bool Onay { get; set; }
    public string Not { get; set; }
}

/// <summary>POST Basvuru/{id}/Not gövdesi</summary>
public class PatronNotGirdi
{
    public string Metin { get; set; }
}

/// <summary>
/// Patron görünümünün paylaşılan önbelleği (30 saniye).
///
/// <para>
/// Bütün patronlar aynı şirket geneli veriyi görüyor; her açılışta okutma,
/// norm ve kart sorgularını yeniden çalıştırmak ekranları yavaşlatıyordu.
/// Aynı anahtar için aynı anda gelen istekler tek hesap bekliyor (anahtar
/// başına kilit); süresi dolan kayıt bir sonraki istekte yenileniyor.
/// Onay ve not yazımı ilgili anahtarları siliyor.
/// </para>
///
/// <para>
/// Değerler paylaşıldığı için çağıranlar onları DEĞİŞTİRMEMELİ; uçlar
/// süzme ve sıralamayı yeni listeler üzerinde yapıyor.
/// </para>
/// </summary>
internal static class PatronOnbellegi
{
    private static readonly TimeSpan Omur = TimeSpan.FromSeconds(30);

    /// <summary>Kayıt; ömrü kayıt başına (geçmiş tarih aralıkları daha uzun saklanıyor, 1.6)</summary>
    private sealed record Kayit(DateTime Zaman, object Deger, TimeSpan Sure);

    private static readonly ConcurrentDictionary<string, Kayit> _kayitlar = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, object> _kilitler = new(StringComparer.Ordinal);

    /// <summary>Taze kayıt varsa verir.</summary>
    public static bool Dene(string anahtar, out object deger)
    {
        if (_kayitlar.TryGetValue(anahtar, out var k) && DateTime.UtcNow - k.Zaman < k.Sure)
        {
            deger = k.Deger;
            return true;
        }

        deger = null;
        return false;
    }

    public static void Koy(string anahtar, object deger) => Koy(anahtar, deger, Omur);

    public static void Koy(string anahtar, object deger, TimeSpan sure)
    {
        Budama();
        _kayitlar[anahtar] = new Kayit(DateTime.UtcNow, deger, sure);
    }

    /// <summary>
    /// Taze kayıt varsa onu, yoksa üretip saklar. Üretim hata verirse
    /// saklanmaz, hata çağırana gider.
    /// </summary>
    public static T Al<T>(string anahtar, Func<T> uret) => Al(anahtar, Omur, uret);

    /// <summary><see cref="Al{T}(string, Func{T})"/>, verilen ömürle.</summary>
    public static T Al<T>(string anahtar, TimeSpan sure, Func<T> uret)
    {
        if (Dene(anahtar, out var d)) return (T)d;

        var kilit = _kilitler.GetOrAdd(anahtar, _ => new object());

        lock (kilit)
        {
            if (Dene(anahtar, out d)) return (T)d;

            var deger = uret();
            Koy(anahtar, deger, sure);

            return deger;
        }
    }

    /// <summary>Verilen öneklerle başlayan bütün kayıtları siler.</summary>
    public static void Temizle(params string[] onekler)
    {
        foreach (var anahtar in _kayitlar.Keys)
        {
            if (onekler.Any(o => anahtar.StartsWith(o, StringComparison.Ordinal)))
                _kayitlar.TryRemove(anahtar, out _);
        }
    }

    /// <summary>
    /// Arama ve kişi anahtarları sınırsız çoğalabilir: kayıt sayısı
    /// büyüyünce süresi geçenler atılıyor.
    /// </summary>
    private static void Budama()
    {
        if (_kayitlar.Count < 500) return;

        var simdi = DateTime.UtcNow;

        foreach (var x in _kayitlar)
        {
            if (simdi - x.Value.Zaman >= x.Value.Sure)
            {
                _kayitlar.TryRemove(x.Key, out _);
                _kilitler.TryRemove(x.Key, out _);
            }
        }
    }
}

using System.Data;
using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Avans talepleri (06.10.2026).
///
/// <para>
/// Akış: personel mobil uygulamadan tutar, taksit sayısı ve ilk kesinti
/// ayını seçerek talep eder → İnsan Kaynakları "Personel Talepleri › Avans"
/// sekmesinde tutarı, taksiti ve ilk kesintiyi değiştirebilir, onaylar ya
/// da açıklamayla reddeder → ödeme yapılınca "ödendi" işaretlenir.
/// Kesintiler her ayın kesinti gününde (varsayılan 5'i) bir önceki ayın
/// maaşından yapılır; taksit tarihi geçince "kesildi" sayılır.
/// </para>
///
/// <para>
/// Üst limit: aylık net maaşın yüzdesi (varsayılan %95). Maaş Yıllık İzin
/// Ücretleri ile aynı kaynaktan: genel merkezde son bordro neti, diğer
/// birimlerde personel kartındaki ücret. Personel maaşını ve limitini
/// görmez; limiti aşınca "Üst limitiniz …" uyarısı alır. Yönetimden
/// "maaşın üzerinde talebe izin ver" açılırsa limit katı kadar istenebilir,
/// bu durumda her taksit limiti aşmayacak kadar taksit zorunlu.
/// </para>
///
/// <para>
/// Maaş ve limit İK panelinde yalnızca ücret alanını görebilen rollere
/// (Yönetim → alan yetkileri) dönüyor; diğer rollerde boş.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class AvansController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly IzinFormuServisi _form;
    private readonly YetkiServisi _yetki;
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<AvansController> _kayit;

    public const string KuralAnahtari = "AVANS_KURAL";

    private static readonly CultureInfo Tr = new("tr-TR");

    public AvansController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim,
        IzinFormuServisi form, YetkiServisi yetki, IServiceProvider saglayici, ILogger<AvansController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _form = form;
        _yetki = yetki;
        _saglayici = saglayici;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Ortak                                                                */
    /* ==================================================================== */

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool PersonelMi => User?.IsInRole("Personel") ?? false;

    private string PanelAdi =>
        User?.FindFirst("adSoyad")?.Value is { Length: > 0 } a ? a : User?.Identity?.Name ?? "İK";

    /// <summary>Avansları yöneten roller: Admin, GMY, İK Yöneticisi, İK.</summary>
    private bool IkYetkili =>
        !PersonelMi && Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    /// <summary>Maaş ve limit görebilir mi (personel kartındaki ücret alanıyla aynı yetki)</summary>
    private bool MaasGorebilir
    {
        get
        {
            try
            {
                return IkYetkili && !_yetki.Gizli(Rol, YetkiServisi.Ucret);
            }
            catch
            {
                return Roller.Temel(Rol) is Roller.Admin;
            }
        }
    }

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? govde : govde[..i];
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string Lira(decimal v) => "₺" + v.ToString("N0", Tr);

    private static string AyYaz(DateTime d) =>
        d.ToString("d MMMM yyyy", Tr);

    /* -------------------------------------------------------------- kural */

    public sealed class AvansKurali
    {
        /// <summary>Modül açık: kapalıyken mobilde yeni talep oluşturulamaz</summary>
        public bool Acik { get; set; } = true;

        /// <summary>Üst limit: aylık net maaşın yüzdesi</summary>
        public int Yuzde { get; set; } = 95;

        /// <summary>Maaşın (limitin) üzerinde talebe izin ver</summary>
        public bool UstuAcik { get; set; }

        /// <summary>Üstü açıksa en fazla limitin kaç katı</summary>
        public int UstCarpan { get; set; } = 2;

        /// <summary>Personelin seçebileceği taksit sayıları</summary>
        public List<int> Taksitler { get; set; } = new() { 1, 2, 3 };

        /// <summary>Takvim yılında en fazla talep (reddedilen ve iptal edilen sayılmaz)</summary>
        public int YillikHak { get; set; } = 2;

        /// <summary>Kesinti günü (ayın)</summary>
        public int KesintiGunu { get; set; } = 5;

        /// <summary>Ödemesi süren avansı olan yeni talep oluşturamaz</summary>
        public bool DevamEngel { get; set; } = true;

        /// <summary>En düşük talep tutarı</summary>
        public decimal EnAzTutar { get; set; } = 500;

        /// <summary>Personelin seçebileceği ilk kesinti ayı sayısı</summary>
        public int IlkKesintiSecenek { get; set; } = 3;

        /// <summary>
        /// Reddederken çıkan hazır gerekçeler (13.10.2026). Mobil onay
        /// ekranlarında ve İK panelinde çip olarak görünür; dokununca
        /// gerekçe kutusuna yazılır.
        /// </summary>
        public List<string> RedGerekceleri { get; set; } = new()
        {
            "Avans kriterlerine uygun değil",
            "Avans hakkı dolmuştur",
        };

        /* Avans bilgilendirmesi (20.10.2026): Biçen360'ta avans ekranı
           açılınca çıkan pencere. Hangi durumlardaki taleplerin
           karşılanacağı Yönetim'den yazılır. */
        public bool BilgiAcik { get; set; } = true;
        public string BilgiBaslik { get; set; } = "Avans talep kuralları";
        public string BilgiMetni { get; set; } =
            "Avans talepleri aşağıdaki durumlarla sınırlıdır. Yalnızca bu kurallara uygun görülen talepler karşılanacaktır.";
        public List<string> KarsilananDurumlar { get; set; } = new()
        {
            "Sağlık sorunları (kendisi ya da birinci derece yakını)",
            "Eğitim giderleri",
            "Zorunlu ev ve kira giderleri",
            "Doğal afet, yangın gibi beklenmedik durumlar",
        };
    }

    /// <summary>Hazır ret gerekçeleri; okunamazsa varsayılanlar</summary>
    internal static List<string> RedGerekceleriOku(IDbConnection db) => KuralOku(db).RedGerekceleri;

    private static readonly JsonSerializerOptions JsonSecenek = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static AvansKurali KuralOku(IDbConnection db)
    {
        try
        {
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a",
                new { a = KuralAnahtari });

            if (!string.IsNullOrWhiteSpace(ham))
                return Duzelt(JsonSerializer.Deserialize<AvansKurali>(ham, JsonSecenek) ?? new AvansKurali());
        }
        catch
        {
            /* Bozuk ayar varsayılana düşer */
        }

        return new AvansKurali();
    }

    private static AvansKurali Duzelt(AvansKurali k)
    {
        k.Yuzde = Math.Clamp(k.Yuzde, 10, 300);
        k.UstCarpan = Math.Clamp(k.UstCarpan, 1, 6);
        k.YillikHak = Math.Clamp(k.YillikHak, 1, 24);
        k.KesintiGunu = Math.Clamp(k.KesintiGunu, 1, 28);
        k.IlkKesintiSecenek = Math.Clamp(k.IlkKesintiSecenek, 1, 6);
        k.EnAzTutar = Math.Max(0, k.EnAzTutar);
        k.Taksitler = (k.Taksitler ?? new List<int>())
            .Where(x => x is >= 1 and <= 24)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        if (k.Taksitler.Count == 0) k.Taksitler.Add(1);

        k.RedGerekceleri = (k.RedGerekceleri ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Select(x => x.Length > 200 ? x[..200] : x)
            .Distinct(StringComparer.CurrentCultureIgnoreCase)
            .Take(12)
            .ToList();

        k.BilgiBaslik = (k.BilgiBaslik ?? "").Trim();
        if (k.BilgiBaslik.Length == 0) k.BilgiBaslik = "Avans talep kuralları";
        if (k.BilgiBaslik.Length > 100) k.BilgiBaslik = k.BilgiBaslik[..100];
        k.BilgiMetni = (k.BilgiMetni ?? "").Trim();
        if (k.BilgiMetni.Length > 1000) k.BilgiMetni = k.BilgiMetni[..1000];
        k.KarsilananDurumlar = (k.KarsilananDurumlar ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Select(x => x.Length > 200 ? x[..200] : x)
            .Distinct(StringComparer.CurrentCultureIgnoreCase)
            .Take(20)
            .ToList();

        return k;
    }

    /* -------------------------------------------------------------- maaş */


    /// <summary>Aylık net maaş; bulunamazsa null. Ortak önbellekten (MaasOnbellegi, 15.10.2026).</summary>
    private decimal? Maas(string sicil)
    {
        try
        {
            var liste = MaasOnbellegi.Getir(_saglayici);
            return liste.TryGetValue(K(sicil), out var m) && m > 0 ? m : null;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Avans: maaşlar okunamadı");
            return null;
        }
    }

    /// <summary>Tek seferde istenebilecek tutar: maaş × yüzde, 100'e aşağı yuvarlı.</summary>
    private static decimal? Limit(decimal? maas, AvansKurali k) =>
        maas is null ? null : Math.Floor(maas.Value * k.Yuzde / 100m / 100m) * 100m;

    /* -------------------------------------------------------- tarihler */

    /// <summary>Ayın kesinti günü (ay kısa ise son gün).</summary>
    private static DateTime KesintiTarihi(int yil, int ay, int gun) =>
        new(yil, ay, Math.Min(gun, DateTime.DaysInMonth(yil, ay)));

    /// <summary>
    /// Seçilebilecek ilk kesinti tarihleri: bugünden en az 7 gün sonraki
    /// ilk kesinti günü ve sonraki aylar.
    /// </summary>
    private static List<DateTime> IlkKesintiSecenekleri(AvansKurali k)
    {
        var sonuc = new List<DateTime>();
        var esik = DateTime.Today.AddDays(7);
        var ay = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

        while (sonuc.Count < k.IlkKesintiSecenek)
        {
            var t = KesintiTarihi(ay.Year, ay.Month, k.KesintiGunu);
            if (t >= esik) sonuc.Add(t);
            ay = ay.AddMonths(1);
        }

        return sonuc;
    }

    /// <summary>Taksit planı: eşit taksitler (tam lira), kuruş ve artan son taksitte.</summary>
    public static List<(int Sira, DateTime Tarih, decimal Tutar)> Plan(decimal tutar, int taksit, DateTime ilk, int kesintiGunu)
    {
        taksit = Math.Max(1, taksit);

        var temel = Math.Floor(tutar / taksit);
        var liste = new List<(int, DateTime, decimal)>();
        var toplam = 0m;

        for (var i = 0; i < taksit; i++)
        {
            var ay = ilk.AddMonths(i);
            var t = KesintiTarihi(ay.Year, ay.Month, kesintiGunu);
            var tt = i == taksit - 1 ? tutar - toplam : temel;
            toplam += tt;
            liste.Add((i + 1, t, tt));
        }

        return liste;
    }

    /* ------------------------------------------------------------ kayıt */

    private sealed class AvansSatiri
    {
        public int Id { get; set; }
        public string PersonelKodu { get; set; }
        public string AdSoyad { get; set; }
        public string Sube { get; set; }
        public string Pozisyon { get; set; }
        public decimal Tutar { get; set; }
        public int Taksit { get; set; }
        public DateTime IlkKesinti { get; set; }
        public string Aciklama { get; set; }
        public string Neden { get; set; }
        public string Durum { get; set; }
        public decimal? OnayTutar { get; set; }
        public int? OnayTaksit { get; set; }
        public DateTime? OnayIlkKesinti { get; set; }
        public string IkNotu { get; set; }
        public string KararVeren { get; set; }
        public DateTime? KararTarihi { get; set; }
        public DateTime? OdemeTarihi { get; set; }
        public string Odeyen { get; set; }
        public string Kaynak { get; set; }
        public bool LimitAsimi { get; set; }
        public DateTime Olusturma { get; set; }
        public int? Asama { get; set; }
        public string AraNot { get; set; }
        public string Zincir { get; set; }

        /// <summary>Onay adımları: talebin zinciri (08.10.2026), yoksa eski genel akış</summary>
        public List<AvansOnayZinciri.Adim> Adimlar => _adimlar ??= AvansOnayZinciri.Adimlari(Zincir);
        private List<AvansOnayZinciri.Adim> _adimlar;
        public AvansOnayZinciri.Adim GecerliAdim => AvansOnayZinciri.AdimAl(Adimlar, Asama);

        public decimal GecerliTutar => OnayTutar ?? Tutar;
        public int GecerliTaksit => OnayTaksit ?? Taksit;
        public DateTime GecerliIlk => OnayIlkKesinti ?? IlkKesinti;
        public bool Onayli => Durum is "onaylandi" or "odendi";
    }

    private const string Secim = @"
SELECT id AS Id, personel_kodu AS PersonelKodu, ad_soyad AS AdSoyad, sube AS Sube, pozisyon AS Pozisyon,
       tutar AS Tutar, taksit AS Taksit, ilk_kesinti AS IlkKesinti, aciklama AS Aciklama, neden AS Neden, durum AS Durum,
       onay_tutar AS OnayTutar, onay_taksit AS OnayTaksit, onay_ilk_kesinti AS OnayIlkKesinti,
       ik_notu AS IkNotu, karar_veren AS KararVeren, karar_tarihi AS KararTarihi,
       odeme_tarihi AS OdemeTarihi, odeyen AS Odeyen, kaynak AS Kaynak, limit_asimi AS LimitAsimi,
       olusturma AS Olusturma, asama AS Asama, ara_not AS AraNot, zincir AS Zincir
FROM KRY_AVANS";

    private sealed class TaksitSatiri
    {
        public int AvansId { get; set; }
        public int Sira { get; set; }
        public DateTime Tarih { get; set; }
        public decimal Tutar { get; set; }
    }

    private static Dictionary<int, List<TaksitSatiri>> Taksitler(IDbConnection db, IEnumerable<int> idler)
    {
        var liste = idler.Distinct().ToList();

        if (liste.Count == 0) return new();

        var sonuc = new Dictionary<int, List<TaksitSatiri>>();

        foreach (var parca in liste.Chunk(900))
            foreach (var t in db.Query<TaksitSatiri>(@"
SELECT avans_id AS AvansId, sira AS Sira, tarih AS Tarih, tutar AS Tutar
FROM KRY_AVANS_TAKSIT WHERE avans_id IN @parca ORDER BY avans_id, sira", new { parca }))
            {
                if (!sonuc.TryGetValue(t.AvansId, out var l)) sonuc[t.AvansId] = l = new List<TaksitSatiri>();
                l.Add(t);
            }

        return sonuc;
    }

    /// <summary>Taksitlerin durumu ve özet: kesilen, kalan, sıradaki.</summary>
    private static object TaksitOzeti(AvansSatiri a, List<TaksitSatiri> taksitler, int kesintiGunu)
    {
        var bugun = DateTime.Today;

        /* Onaylanmamış talepte plan önizleme olarak hesaplanıyor */
        var plan = taksitler is { Count: > 0 }
            ? taksitler.Select(x => (x.Sira, x.Tarih, x.Tutar)).ToList()
            : Plan(a.GecerliTutar, a.GecerliTaksit, a.GecerliIlk, kesintiGunu);

        var onayli = a.Onayli;
        var siradakiBulundu = false;

        var satirlar = plan.Select(p =>
        {
            string durum;

            if (!onayli) durum = "plan";
            else if (p.Item2.Date <= bugun) durum = "kesildi";
            else if (!siradakiBulundu) { durum = "siradaki"; siradakiBulundu = true; }
            else durum = "bekliyor";

            return new { sira = p.Item1, tarih = p.Item2, tutar = p.Item3, durum };
        }).ToList();

        var kesilen = onayli ? satirlar.Where(x => x.durum == "kesildi").Sum(x => x.tutar) : 0m;
        var kalan = onayli ? satirlar.Where(x => x.durum != "kesildi").Sum(x => x.tutar) : 0m;
        var kalanTaksit = onayli ? satirlar.Count(x => x.durum != "kesildi") : 0;
        var siradaki = satirlar.FirstOrDefault(x => x.durum == "siradaki");

        return new
        {
            taksitler = satirlar,
            odenen = kesilen,
            kalan,
            kalanTaksit,
            devamEdiyor = onayli && kalanTaksit > 0,
            siradaki,
            sonKesinti = satirlar.Count > 0 ? satirlar[^1].tarih : (DateTime?)null,
        };
    }

    private static string DurumAdi(AvansSatiri a, bool devam) => a.Durum switch
    {
        "bekliyor" => $"{a.GecerliAdim.Ad} onayında",
        BelgeDurumu => "Belge bekleniyor",
        "reddedildi" => "Reddedildi",
        "iptal" => "İptal edildi",
        "onaylandi" => devam ? "Onaylandı · ödeme bekliyor" : "Kapandı",
        "odendi" => devam ? "Devam ediyor" : "Kapandı",
        _ => a.Durum,
    };

    private static void Hareket(IDbConnection db, int id, string olay, string aciklama, string yapan,
        IDbTransaction islem = null)
    {
        if (olay is { Length: > 200 }) olay = olay[..200];
        if (aciklama is { Length: > 500 }) aciklama = aciklama[..500];

        db.Execute(@"
INSERT INTO KRY_AVANS_HAREKET (avans_id, olay, aciklama, yapan) VALUES (@id, @olay, @aciklama, @yapan)",
            new { id, olay, aciklama, yapan }, islem);
    }

    private static void PlanYaz(IDbConnection db, int id, decimal tutar, int taksit, DateTime ilk, int gun,
        IDbTransaction islem)
    {
        db.Execute("DELETE FROM KRY_AVANS_TAKSIT WHERE avans_id = @id", new { id }, islem);

        foreach (var p in Plan(tutar, taksit, ilk, gun))
            db.Execute(@"
INSERT INTO KRY_AVANS_TAKSIT (avans_id, sira, tarih, tutar) VALUES (@id, @sira, @tarih, @tutar)",
                new { id, sira = p.Sira, tarih = p.Tarih, tutar = p.Tutar }, islem);
    }

    /* ------------------------------------------------- kişinin durumu */

    private sealed record KisiDurumu(
        int BuYil, bool BekleyenVar, AvansSatiri DevamEden, object DevamOzet,
        decimal ToplamAlinan, int ToplamAdet, DateTime? SonAvans, decimal KalanBorc);

    private KisiDurumu Durum(IDbConnection db, string kod, AvansKurali k, int? haricId = null)
    {
        var kayitlar = db.Query<AvansSatiri>(Secim + " WHERE personel_kodu = @kod ORDER BY olusturma DESC",
            new { kod }).Where(x => x.Id != haricId).ToList();

        var taksitler = Taksitler(db, kayitlar.Where(x => x.Onayli).Select(x => x.Id));

        var yil = DateTime.Today.Year;
        var buYil = kayitlar.Count(x => x.Olusturma.Year == yil && x.Durum is not ("reddedildi" or "iptal"));
        var bekleyen = kayitlar.Any(x => x.Durum is "bekliyor" or BelgeDurumu);

        AvansSatiri devam = null;
        object devamOzet = null;
        var kalanBorc = 0m;

        foreach (var a in kayitlar.Where(x => x.Onayli))
        {
            dynamic oz = TaksitOzeti(a, taksitler.GetValueOrDefault(a.Id), k.KesintiGunu);

            if ((bool)oz.devamEdiyor)
            {
                kalanBorc += (decimal)oz.kalan;

                if (devam is null)
                {
                    devam = a;
                    devamOzet = oz;
                }
            }
        }

        var onaylilar = kayitlar.Where(x => x.Onayli).ToList();

        return new KisiDurumu(buYil, bekleyen, devam, devamOzet,
            onaylilar.Sum(x => x.GecerliTutar), onaylilar.Count,
            onaylilar.Count > 0 ? onaylilar.Max(x => x.Olusturma) : null, kalanBorc);
    }

    /* ==================================================================== */
    /* Mobil — personel                                                     */
    /* ==================================================================== */

    /// <summary>
    /// Avanslarım: devam eden avans, taksitler, geçmiş ve yeni talep için
    /// seçenekler. Maaş ve limit DÖNMÜYOR.
    /// </summary>
    [HttpGet("Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Benim()
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kod = ben.PersonelKodu.Trim();

        using var db = _vt.Baglanti();

        BelgeGecisi(db);

        var k = KuralOku(db);
        var d = Durum(db, kod, k);
        var yeni = SurumEnAz(1, 7);

        var kayitlar = db.Query<AvansSatiri>(Secim + " WHERE personel_kodu = @kod ORDER BY olusturma DESC",
            new { kod }).ToList();
        var taksitler = Taksitler(db, kayitlar.Select(x => x.Id));

        string engel = null;

        if (!k.Acik) engel = "Avans talebi şu anda kapalı.";
        else if (d.BekleyenVar) engel = "Onay bekleyen bir avans talebiniz var. Sonuçlanınca yeni talep oluşturabilirsiniz.";
        else if (k.DevamEngel && d.DevamEden is not null)
            engel = "Ödemesi devam eden avansınız var. Son taksit kesildikten sonra yeni talep oluşturabilirsiniz.";
        else if (d.BuYil >= k.YillikHak)
            engel = $"Bu yıl için avans talep hakkınızı kullandınız ({k.YillikHak} talep).";

        return Ok(new
        {
            kural = new
            {
                taksitler = k.Taksitler,
                kesintiGunu = k.KesintiGunu,
                yillikHak = k.YillikHak,
                enAzTutar = k.EnAzTutar,
                ilkKesintiler = IlkKesintiSecenekleri(k),
                nedenler = Nedenler,
                /* Biçen360 1.6 açıklama alanını yalnızca bu listedeki nedenlerde
                   gösterip zorunlu tutuyor: tüm nedenler gidince güncellemesiz
                   her talepte açıklama isteniyor (08.10.2026). */
                nedenAciklamaZorunlu = Nedenler,
                /* 1.7: belge istenen nedenler ve belgenin adı (talep ekranında) */
                belgeliNedenler = BelgeliNedenler,
                belgeAdlari = BelgeliNedenler.ToDictionary(x => x, BelgeAdi),
            },
            /* 1.8: ekran açılınca gösterilen kurallar penceresi */
            bilgilendirme = k.BilgiAcik && ((k.BilgiMetni ?? "").Length > 0 || (k.KarsilananDurumlar?.Count ?? 0) > 0)
                ? new { baslik = k.BilgiBaslik, metin = k.BilgiMetni, maddeler = k.KarsilananDurumlar }
                : null,
            buYil = d.BuYil,
            yeniTalep = engel is null,
            engel,
            devamEden = d.DevamEden is null ? null : new
            {
                id = d.DevamEden.Id,
                tutar = d.DevamEden.GecerliTutar,
                taksit = d.DevamEden.GecerliTaksit,
                olusturma = d.DevamEden.Olusturma,
                ozet = d.DevamOzet,
            },
            avanslar = kayitlar.Select(a =>
            {
                dynamic oz = TaksitOzeti(a, taksitler.GetValueOrDefault(a.Id), k.KesintiGunu);

                return new
                {
                    id = a.Id,
                    tutar = a.GecerliTutar,
                    talepTutar = a.Tutar,
                    taksit = a.GecerliTaksit,
                    talepTaksit = a.Taksit,
                    ilkKesinti = a.GecerliIlk,
                    /* 1.6 "belge" durumunu tanımıyor: bekleyen kartı çıksın,
                       geri çekilebilsin diye "bekliyor" gidiyor; ne beklendiği
                       ana sayfadaki kartta ve durum adında. */
                    durum = a.Durum == BelgeDurumu && !yeni ? "bekliyor" : a.Durum,
                    /* 23.10.2026: personel kimin onayında olduğunu ve kimin karar
                       verdiğini görmez; yalnızca "Onaya gönderildi" ve red sebebi. */
                    durumAdi = a.Durum == BelgeDurumu && !yeni ? "Belge bekleniyor · ana sayfadan yükleyin"
                        : a.Durum == "bekliyor" ? "Onaya gönderildi"
                        : DurumAdi(a, (bool)oz.devamEdiyor),
                    belgeAdi = a.Durum == BelgeDurumu ? BelgeAdi(a.Neden) : null,
                    devamEdiyor = (bool)oz.devamEdiyor,
                    degisti = a.OnayTutar is not null &&
                              (a.OnayTutar != a.Tutar || a.OnayTaksit != a.Taksit || a.OnayIlkKesinti != a.IlkKesinti),
                    ikNotu = a.Durum == "reddedildi" ? a.IkNotu : null,
                    redNedeni = a.Durum == "reddedildi" ? a.IkNotu : null,
                    aciklama = a.Aciklama,
                    neden = a.Neden,
                    olusturma = a.Olusturma,
                    kararTarihi = a.KararTarihi,
                    odemeTarihi = a.OdemeTarihi,
                    ozet = oz,
                };
            }).ToList(),
        });
    }

    public class TalepGirdi
    {
        public decimal Tutar { get; set; }
        public int Taksit { get; set; }
        public DateTime? IlkKesinti { get; set; }
        public string Aciklama { get; set; }
        public string Neden { get; set; }
    }

    /// <summary>
    /// Avans talep nedenleri (07.10.2026). 1.6'da seçmek zorunlu; "Diğer"
    /// seçilince açıklama da zorunlu. 1.5 neden göndermiyor: o sürümden
    /// gelen talepler eskisi gibi alınıyor (yoksa mağaza güncellemesi
    /// yayınlanana kadar avans talebi tamamen kapanırdı).
    /// </summary>
    /// <para>Liste Ayarlar Merkezi › Seçenek listeleri'nden (SecenekListesi, avansNedenleri).</para>
    public static string[] Nedenler => SecenekListesi.Acik("avansNedenleri");

    /// <summary>Açıklaması zorunlu nedenler ("Diğer" her zaman)</summary>
    public static string[] AciklamaZorunluNedenler => SecenekListesi.AciklamaZorunlu("avansNedenleri");

    public const string DigerNeden = "Diğer";

    /// <summary>Neden ve açıklama denetimi; hata yoksa null</summary>
    private static string NedenHatasi(string neden, string aciklama, bool zorunlu)
    {
        if (string.IsNullOrWhiteSpace(neden))
            return zorunlu ? "Avans talep nedenini seçiniz." : null;

        if (!Nedenler.Contains(neden.Trim()))
            return "Avans talep nedenini listeden seçiniz.";

        if (AciklamaZorunluNedenler.Contains(neden.Trim()) && (aciklama ?? "").Trim().Length < 3)
            return neden.Trim() == DigerNeden
                ? "\"Diğer\" seçtiğinizde açıklama yazmanız zorunludur."
                : $"\"{neden.Trim()}\" nedeninde açıklama yazmanız zorunludur.";

        return null;
    }

    /// <summary>Uygulama sürümü en az 1.6 mı (X-Uygulama-Surum başlığı)</summary>
    private bool Surum16()
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();
        if (string.IsNullOrWhiteSpace(ham)) return false;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return false;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a > 1 || (a == 1 && b >= 6);
    }

    /// <summary>
    /// Yeni avans talebi. Limit aşılırsa "Bu tutarda avans talebi
    /// oluşturamazsınız. Üst limitiniz …" — personel maaşını görmüyor.
    /// </summary>
    [HttpPost("Talep")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> Talep([FromBody] TalepGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });
        if (g is null) return BadRequest(new { hata = "Talep okunamadı." });

        var kod = ben.PersonelKodu.Trim();

        using var db = _vt.Baglanti();

        var k = KuralOku(db);
        var d = Durum(db, kod, k);

        if (!k.Acik) return BadRequest(new { hata = "Avans talebi şu anda kapalı." });

        if (d.BekleyenVar)
            return BadRequest(new { hata = "Onay bekleyen bir avans talebiniz var. Sonuçlanınca yeni talep oluşturabilirsiniz." });

        if (k.DevamEngel && d.DevamEden is not null)
            return BadRequest(new { hata = "Ödemesi devam eden avansınız var. Son taksit kesildikten sonra yeni talep oluşturabilirsiniz." });

        if (d.BuYil >= k.YillikHak)
            return BadRequest(new { hata = $"Bu yıl için avans talep hakkınızı kullandınız ({k.YillikHak} talep)." });

        var tutar = Math.Round(g.Tutar, 2);

        if (tutar <= 0) return BadRequest(new { hata = "Talep etmek istediğiniz tutarı yazınız." });

        if (tutar < k.EnAzTutar)
            return BadRequest(new { hata = $"En az {Lira(k.EnAzTutar)} talep edebilirsiniz." });

        if (!k.Taksitler.Contains(g.Taksit))
            return BadRequest(new { hata = "Taksit sayısını seçiniz." });

        var secenekler = IlkKesintiSecenekleri(k);
        var ilk = g.IlkKesinti?.Date ?? secenekler[0];

        if (!secenekler.Contains(ilk))
            return BadRequest(new { hata = "İlk kesinti ayını listeden seçiniz." });

        /* Limit */
        var maas = Maas(kod);
        var limit = Limit(maas, k);
        var limitAsimi = false;

        if (limit is decimal l && l > 0)
        {
            var enFazla = k.UstuAcik ? l * k.UstCarpan : l;

            if (tutar > enFazla)
                return BadRequest(new
                {
                    hata = $"Bu tutarda avans talebi oluşturamazsınız. Üst limitiniz {Lira(enFazla)}.",
                    kod = "limit",
                    ustLimit = enFazla,
                });

            if (tutar > l)
            {
                /* Maaşın üzerinde: her taksit limiti aşmasın */
                var gereken = (int)Math.Ceiling(tutar / l);

                if (g.Taksit < gereken)
                {
                    var uygun = k.Taksitler.Where(x => x >= gereken).ToList();

                    return BadRequest(new
                    {
                        hata = uygun.Count > 0
                            ? $"Bu tutar için en az {gereken} taksit seçmelisiniz."
                            : $"Bu tutarda avans talebi oluşturamazsınız. Üst limitiniz {Lira(l * k.Taksitler.Max())}.",
                        kod = "taksit",
                        enAzTaksit = gereken,
                    });
                }

                limitAsimi = true;
            }
        }
        else
        {
            /* Maaş bulunamadı: talep alınıyor, İK maaşı bilmeden karar vermesin diye işaretli */
            _kayit.LogInformation("Avans: {Kod} için maaş bulunamadı, limit denetimi yapılamadı", kod);
        }

        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length > 500) aciklama = aciklama[..500];

        var neden = string.IsNullOrWhiteSpace(g.Neden) ? null : g.Neden.Trim();

        if (NedenHatasi(neden, aciklama, Surum16()) is string nedenHata)
            return BadRequest(new { hata = nedenHata, kod = "neden" });

        /* Açıklama her talepte zorunlu (08.10.2026). Hata metninde "neden"
           geçiyor: 1.6 bu hatayı açıklama alanının altında gösteriyor. */
        if (aciklama.Length < 3)
            return BadRequest(new { hata = "Avans talep nedeninizi açıklama alanına kısaca yazınız.", kod = "neden" });

        /* Onay zinciri (08.10.2026): Avans onay tablosundan, talebe yazılıyor */
        var zs = _saglayici.GetRequiredService<AvansOnayZinciri>();
        var zincir = zs.Olustur(ben);
        var ilkAdim = zs.Ilerle(zincir, -1, kod, ben.IsGrubu) ?? zincir.Adimlar.Count - 1;
        if (zincir.Adimlar[ilkAdim].Karar == "atlandi") zincir.Adimlar[ilkAdim].Karar = null;

        /* Belge (09.10.2026): nedene göre belge isteniyorsa talep belge gelene
           kadar onaya gitmiyor. 1.5 neden göndermiyor: eskisi gibi. */
        BelgeGecisi(db);
        var belgeAdi = BelgeGerekli(neden) ? BelgeAdi(neden) : null;

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_AVANS (personel_kodu, ad_soyad, sube, pozisyon, tutar, taksit, ilk_kesinti, aciklama, neden,
                       durum, kaynak, limit_asimi, asama, zincir)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @sube, @poz, @tutar, @taksit, @ilk, @aciklama, @neden, @durum, N'mobil', @limitAsimi,
        @asama, @zincir)",
            new
            {
                durum = belgeAdi is null ? "bekliyor" : BelgeDurumu,
                asama = ilkAdim,
                zincir = AvansOnayZinciri.Json(zincir),
                kod,
                ad = $"{ben.Ad} {ben.Soyad}".Trim(),
                sube = ben.IsGrubu,
                poz = ben.Pozisyon,
                tutar,
                taksit = g.Taksit,
                ilk,
                aciklama = aciklama.Length == 0 ? null : aciklama,
                neden,
                limitAsimi,
            });

        Hareket(db, id, "Talep oluşturuldu",
            $"{Lira(tutar)} · {g.Taksit} taksit · ilk kesinti {ilk:dd.MM.yyyy}", $"{ben.Ad} {ben.Soyad}".Trim());

        Hareket(db, id, "Onay sırası", SiraMetni(zincir), "sistem");
        AtlananlariYaz(db, id, zincir.Adimlar, 0, ilkAdim);

        var ozet = $"{Lira(tutar)} · {(g.Taksit == 1 ? "tek seferde" : $"{g.Taksit} taksit")} · ilk kesinti {AyYaz(ilk)}";

        if (belgeAdi is not null)
        {
            Hareket(db, id, "Belge bekleniyor", $"{neden}: {belgeAdi}. Belge yüklenince onaya gider.", "sistem");
            await BelgeKartiAc(db, id, ben, ozet, belgeAdi, bildir: !SurumEnAz(1, 7));

            return Ok(new
            {
                basarili = true,
                id,
                belgeBekleniyor = true,
                belgeAdi,
                /* 1.6 başarı ekranında "{ozet}. İnsan Kaynakları onayladığında…" yazıyor */
                ozet = $"{ozet}. Talebinizin onaya gitmesi için ana sayfadaki karttan belgenizi ({belgeAdi}) yükleyin",
            });
        }

        var talepSatiri = new AvansSatiri { Id = id, AdSoyad = $"{ben.Ad} {ben.Soyad}".Trim(), Tutar = tutar, Taksit = g.Taksit, PersonelKodu = kod };
        await SonrakiAdimaBildir(zincir.Adimlar[ilkAdim], talepSatiri, "yeni talep");

        return Ok(new
        {
            basarili = true,
            id,
            ozet,
        });
    }

    /* ==================================================================== */
    /* Belge (09.10.2026)                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Nedene göre belge: "Belge istenir" işaretli nedende (Ayarlar Merkezi ›
    /// Seçenek listeleri › Avans talep nedenleri) talep bu durumda açılıyor ve
    /// onaycılara gitmiyor. Belge yüklenince "bekliyor"a geçip ilk onaycıya
    /// bildiriliyor.
    /// <para>
    /// 1.6'da talep ekranında dosya alanı yok: talepten sonra ana sayfada
    /// eksik kartı açılıyor (KRY_TALEP_EKSIK, tür avans) ve "Evrakı yükle"
    /// 1.6'nın evrak penceresini açıyor; yükleme IzinTalep/-id/MazeretBelge
    /// üzerinden buraya geliyor (eksi kimlik = avans). 1.7 belgeyi talep
    /// ekranında alıp doğrudan {id}/Belge'ye yüklüyor.
    /// </para>
    /// </summary>
    public const string BelgeDurumu = "belge";

    private const int BelgeSiniri = 15 * 1024 * 1024;

    /// <summary>Belge istenen (açık) nedenler</summary>
    public static string[] BelgeliNedenler =>
        SecenekListesi.Tumu("avansNedenleri").Where(x => x.Acik && x.BelgeGerekli).Select(x => x.Ad).ToArray();

    public static bool BelgeGerekli(string neden) =>
        !string.IsNullOrWhiteSpace(neden) &&
        BelgeliNedenler.Any(x => string.Equals(x, neden.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Nedene uygun belgenin adı (karta ve talep ekranına yazılır)</summary>
    public static string BelgeAdi(string neden)
    {
        var n = (neden ?? "").ToLower(Tr);
        if (n.Contains("sağlık") || n.Contains("hastane") || n.Contains("tedavi")) return "Hastane belgesi / sağlık gideri faturası";
        if (n.Contains("eğitim") || n.Contains("okul")) return "Okul kayıt ya da ödeme belgesi";
        if (n.Contains("kira") || n.Contains("konut")) return "Kira sözleşmesi ya da kira ödeme belgesi";
        if (n.Contains("fatura") || n.Contains("borç")) return "Fatura ya da borç belgesi";
        if (n.Contains("düğün") || n.Contains("nişan") || n.Contains("nikah") || n.Contains("nikâh")) return "Davetiye ya da nikâh belgesi";
        if (n.Contains("eşya")) return "Fatura ya da proforma fatura";
        if (n.Contains("araç") || n.Contains("ulaşım")) return "Araç masrafı belgesi (fatura, servis fişi)";
        if (n.Contains("aile")) return "Durumu gösteren belge";
        return "Talebinizi destekleyen belge";
    }

    private static bool _belgeGecisiYapildi;

    /// <summary>
    /// Avans nedenleri daha önce panelden kaydedildiyse "Belge istenir"
    /// işaretleri boş kayıtlı. İstek (09.10.2026) bütün nedenlerde belge
    /// olduğu için kayıtlı listede bir kez hepsi işaretleniyor; sonra İK
    /// istediğini kaldırabilir.
    /// </summary>
    private static void BelgeGecisi(IDbConnection db)
    {
        if (_belgeGecisiYapildi) return;

        try
        {
            const string isaret = "AVANS_BELGE_GECIS";
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_AYARLAR WHERE anahtar = @a", new { a = isaret }) == 0)
            {
                var listeler = SecenekListesi.TanimlarSozluk();
                if (listeler.TryGetValue("avansNedenleri", out var l) && l is { Count: > 0 })
                {
                    foreach (var x in l) x.BelgeGerekli = true;
                    SecenekListesi.Yaz(listeler);
                }

                db.Execute("INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme) VALUES (@a, N'1', SYSDATETIME())", new { a = isaret });
            }

            _belgeGecisiYapildi = true;
        }
        catch
        {
            /* bir sonraki istekte yeniden denenir */
        }
    }

    /// <summary>Uygulama sürümü en az ana.alt mı (X-Uygulama-Surum)</summary>
    private bool SurumEnAz(int ana, int alt)
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();
        if (string.IsNullOrWhiteSpace(ham)) return false;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return false;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a > ana || (a == ana && b >= alt);
    }

    /// <summary>Ana sayfadaki "belge yükleyin" kartı (talep eksik kaydı)</summary>
    private async Task BelgeKartiAc(IDbConnection db, int id, PersonelKaydi ben, string ozet, string belgeAdi, bool bildir)
    {
        var kod = ben.PersonelKodu.Trim();
        var ad = $"{ben.Ad} {ben.Soyad}".Trim();

        try
        {
            db.Execute(@"
INSERT INTO KRY_TALEP_EKSIK (tur, talep_id, personel_kodu, ad_soyad, hedef_kodu, hedef_ad, talep_ozet, maddeler,
                             aciklama, son_tarih, gonderen, gonderen_ad, jeton_var)
VALUES (N'avans', @id, @kod, @ad, @kod, @ad, @ozet, @madde, @aciklama, @son, N'sistem:belge', N'Biçen360', 1)",
                new
                {
                    id,
                    kod,
                    ad,
                    ozet = ozet.Length > 200 ? ozet[..200] : ozet,
                    madde = belgeAdi,
                    aciklama = "Avans talebiniz belge yüklenince onaya gönderilecek. \"Evrakı yükle\" ile belgenin fotoğrafını çekin ya da PDF seçin; belge türü olarak listedeki ilk seçeneği işaretleyin.",
                    son = DateTime.Today.AddDays(3),
                });
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Avans belge kartı açılamadı ({Id})", id);
        }

        if (!bildir) return;

        try
        {
            await _bildirim.Gonder(kod, "Avans talebiniz için belge bekleniyor",
                $"{belgeAdi} yüklenince talebiniz onaya gider. Ana sayfadaki karta dokunun.", "anasayfa|eksik");
        }
        catch
        {
            /* kart ana sayfada */
        }
    }

    private static void BelgeKartiKapat(IDbConnection db, int id, string not)
    {
        try
        {
            db.Execute(@"
UPDATE KRY_TALEP_EKSIK
SET durum = N'kapandi', kapandi = SYSDATETIME(), tamamlandi = COALESCE(tamamlandi, SYSDATETIME()),
    kapatan = N'Biçen360', kapanis_notu = @not
WHERE tur = N'avans' AND talep_id = @id AND gonderen = N'sistem:belge' AND durum <> N'kapandi'", new { id, not });
        }
        catch
        {
            /* tablo yoksa geçilir */
        }
    }

    /// <summary>
    /// 1.6 evrak penceresinin beklediği nesne (GorevController, eksik kartı).
    /// Kimlik eksi: yükleme ve form adresleri izin uçlarına gidiyor, oradan
    /// buraya yönleniyor. Talep belge durumunda değilse null.
    /// </summary>
    /// <param name="zorla">
    /// 26.10.2026: yöneticinin eksik bildirdiği talep onayda ("bekliyor")
    /// bekliyor; personel yine de belgeyi karttan yükleyebilsin.
    /// </param>
    public static object BelgeNesnesi(IDbConnection db, int id, bool zorla = false)
    {
        var a = db.QueryFirstOrDefault<AvansSatiri>(Secim + " WHERE id = @id", new { id });
        if (a is null) return null;
        if (a.Durum != BelgeDurumu && !(zorla && a.Durum == "bekliyor")) return null;

        var son = a.Olusturma.Date.AddDays(4);
        var kalan = (int)Math.Max(0, Math.Floor((son - DateTime.Now).TotalHours));

        return new
        {
            id = -a.Id,
            tur = "Avans",
            altTur = a.Neden,
            formBekleniyor = false,
            cikis = a.Olusturma,
            donus = a.Olusturma,
            son,
            kalanSaat = kalan,
            gecikti = false,
            tamam = false,
            belgeGerekli = true,
            /* Avansta ıslak imzalı asıl istenmiyor: son adım tamam görünsün */
            asilGonderildi = true,
            gerekenler = new[]
            {
                new { kalem = "destek", ad = BelgeAdi(a.Neden), yuklendi = false, dosyalar = new List<string>() },
            },
        };
    }

    /// <summary>Belgesi beklenen avansın belge adı (1.6 penceresindeki tür seçenekleri için)</summary>
    public static string BelgeAdiBul(IDbConnection db, int id) =>
        BelgeAdi(db.ExecuteScalar<string>("SELECT neden FROM KRY_AVANS WHERE id = @id", new { id }));

    /// <summary>Belge durumunda mı (eksik kartında "Tamamladım" yükleme olmadan kabul edilmesin)</summary>
    public static bool BelgeBekleniyor(IDbConnection db, int id) =>
        db.ExecuteScalar<string>("SELECT durum FROM KRY_AVANS WHERE id = @id", new { id }) == BelgeDurumu;

    /// <summary>Personel: talebin belgesini yükler (1.7)</summary>
    [HttpPost("{id:int}/Belge")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(BelgeSiniri + 512 * 1024)]
    public Task<IActionResult> BelgeYukle(int id, [FromForm] string tur, IFormFile dosya) => BelgeYukleIc(id, dosya, tur);

    /// <summary>Yükleme (1.7 ucu ve 1.6 köprüsü ortak)</summary>
    [NonAction]
    public async Task<IActionResult> BelgeYukleIc(int id, IFormFile dosya, string tur)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });
        if (dosya.Length > BelgeSiniri) return BadRequest(new { hata = "Belge en fazla 15 MB olabilir." });

        using var db = _vt.Baglanti();

        var a = db.QueryFirstOrDefault<AvansSatiri>(Secim + " WHERE id = @id", new { id });
        if (a is null || K(a.PersonelKodu) != K(ben.PersonelKodu)) return NotFound(new { hata = "Talep bulunamadı." });
        if (a.Durum is "reddedildi" or "iptal") return BadRequest(new { hata = "Sonuçlanmış talebe belge yüklenmez." });

        byte[] icerik;
        using (var akis = new MemoryStream())
        {
            await dosya.CopyToAsync(akis);
            icerik = akis.ToArray();
        }

        var tip = BelgeTipi(icerik);
        if (tip is null) return BadRequest(new { hata = "Fotoğraf (JPG, PNG) ya da PDF yükleyiniz." });

        var yapan = $"{ben.Ad} {ben.Soyad}".Trim();
        var belgeTur = string.IsNullOrWhiteSpace(tur) ? BelgeAdi(a.Neden) : tur.Trim();
        if (belgeTur.Length > 150) belgeTur = belgeTur[..150];
        var ad = Path.GetFileName(dosya.FileName ?? "");
        if (ad.Length > 200) ad = ad[^200..];

        var bid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_AVANS_BELGE (avans_id, tur, dosya_adi, tip, boyut, icerik, yukleyen)
OUTPUT INSERTED.id VALUES (@id, @tur, @ad, @tip, @boyut, @icerik, @yapan)",
            new { id, tur = belgeTur, ad, tip, boyut = icerik.Length, icerik, yapan });

        Hareket(db, id, "Belge yüklendi", $"{belgeTur}{(ad.Length > 0 ? $" · {ad}" : "")}", yapan);

        /* Eksik bildirilmiş talepte (İK ya da yönetici, 26.10.2026) belge
           gelince kayıt "tamamlandı"ya geçer; yöneticinin bildirdiğinde haber
           ona, İK'nınkinde İK'ya gider */
        var yoneticiEksikleri = YoneticiEksik.AcikYoneticiKayitlari(db, TalepEksik.Avans, id);
        var ikEksigiVar = false;
        try
        {
            ikEksigiVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_TALEP_EKSIK
WHERE tur = N'avans' AND talep_id = @id AND durum = N'acik'
  AND ISNULL(gonderen, N'') NOT LIKE N'sistem:%' AND ISNULL(gonderen, N'') NOT LIKE N'yonetici:%'", new { id }) > 0;
        }
        catch
        {
            /* tablo yoksa İK eksiği de yok */
        }

        if (TalepEksik.PersonelTamamladi(db, TalepEksik.Avans, id, $"Belge yüklendi: {belgeTur}") > 0)
        {
            var ozet = YoneticiEksik.AvansOzeti(a.Tutar, a.Taksit, a.Olusturma);

            if (yoneticiEksikleri.Count > 0)
                await YoneticiEksik.YoneticiyeHaberVer(db, _bildirim, TalepEksik.Avans, id, yapan, ozet, $"{belgeTur} yüklendi", yoneticiEksikleri);
            else if (ikEksigiVar)
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Eksik belge yüklendi",
                    $"{yapan} · {ozet}: {belgeTur} yüklendi.", "avans");
        }

        var durum = a.Durum;

        if (a.Durum == BelgeDurumu &&
            db.Execute("UPDATE KRY_AVANS SET durum = N'bekliyor', guncelleme = SYSDATETIME() WHERE id = @id AND durum = N'belge'", new { id }) == 1)
        {
            durum = "bekliyor";
            Hareket(db, id, "Onaya gönderildi", $"Belge geldi · {a.GecerliAdim.Ad} onayında", "sistem");
            BelgeKartiKapat(db, id, "Belge yüklendi");
            await SonrakiAdimaBildir(a.GecerliAdim, a, "belgesi yüklendi");
        }

        return Ok(new { basarili = true, id = bid, durum });
    }

    private static string BelgeTipi(byte[] b)
    {
        if (b.Length >= 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') return "application/pdf";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
            return "image/webp";
        return null;
    }

    /// <summary>Belge dosyası: İK ya da belgenin sahibi</summary>
    [HttpGet("Belge/{bid:int}")]
    public IActionResult BelgeGetir(int bid)
    {
        using var db = _vt.Baglanti();

        var b = db.QueryFirstOrDefault(@"
SELECT b.icerik, b.tip, b.dosya_adi, a.personel_kodu, a.zincir FROM KRY_AVANS_BELGE b
JOIN KRY_AVANS a ON a.id = b.avans_id WHERE b.id = @bid", new { bid });

        if (b is null) return NotFound(new { hata = "Belge bulunamadı." });

        /* 26.10.2026: onay zincirindeki yönetici de (karar verdikten sonra da) belgeyi açabilir */
        var zincirde = PersonelMi && AvansOnayZinciri.ZincirdeMi((string)b.zincir, Sicil());

        if (!IkYetkili && !zincirde && !(PersonelMi && K((string)b.personel_kodu) == K(Sicil()))) return Forbid();

        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Cache-Control"] = "private, no-store";
        return File((byte[])b.icerik, (string)b.tip);
    }

    /// <summary>Personel, İK karar vermeden talebini geri çeker.</summary>
    [HttpPost("{id:int}/Iptal")]
    [Authorize(Roles = "Personel")]
    public IActionResult Iptal(int id)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var n = db.Execute(@"
UPDATE KRY_AVANS SET durum = N'iptal', guncelleme = SYSDATETIME()
WHERE id = @id AND personel_kodu = @kod AND durum IN (N'bekliyor', N'belge')",
            new { id, kod = ben.PersonelKodu.Trim() });

        if (n == 0) return BadRequest(new { hata = "Talep geri çekilemedi; İnsan Kaynakları karar vermiş olabilir." });

        BelgeKartiKapat(db, id, "Talep geri çekildi");

        Hareket(db, id, "Personel talebi geri çekti", null, $"{ben.Ad} {ben.Soyad}".Trim());

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* İK paneli                                                            */
    /* ==================================================================== */

    /// <summary>Bekleyen talep sayısı (sekme rozeti)</summary>
    [HttpGet("Sayac")]
    public IActionResult Sayac([FromQuery] string uzman = null)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        var kapsam = UzmanKapsami.Olustur(db, _saglayici.GetRequiredService<AyarServisi>(), Rol,
            User?.Identity?.Name, uzman, kendisi: false);

        /* Sayaç yalnızca bu kullanıcının karar verebileceği adımdakiler (onay zinciri) */
        var temel = Roller.Temel(Rol);

        return Ok(new
        {
            /* Uzman süzgeci: İK uzmanının sayacı kendi şubeleri (07.10.2026) */
            bekleyen = db.Query<AvansSatiri>(Secim + " WHERE durum = N'bekliyor'")
                .Count(x => (kapsam is null || kapsam.Icinde(x.Sube)) && AvansOnayZinciri.PanelYetkili(x.GecerliAdim, temel)),
            odemeBekleyen = db.Query<string>("SELECT sube FROM KRY_AVANS WHERE durum = N'onaylandi'")
                .Count(x => kapsam is null || kapsam.Icinde(x)),
        });
    }

    /// <summary>Avans talepleri listesi: bekleyenler önce.</summary>
    [HttpGet("Liste")]
    public IActionResult Liste([FromQuery] string durum = null, [FromQuery] int gun = 365, [FromQuery] string uzman = null)
    {
        if (!IkYetkili) return Forbid();

        gun = Math.Clamp(gun, 7, 3650);

        using var db = _vt.Baglanti();

        var k = KuralOku(db);
        var maasGor = MaasGorebilir;

        var kayitlar = db.Query<AvansSatiri>(Secim + @"
WHERE (durum IN (N'bekliyor', N'belge', N'onaylandi') OR olusturma >= @sinir)
ORDER BY CASE durum WHEN N'bekliyor' THEN 0 WHEN N'belge' THEN 1 WHEN N'onaylandi' THEN 2 ELSE 3 END, olusturma DESC",
            new { sinir = DateTime.Today.AddDays(-gun) }).ToList();

        if (!string.IsNullOrWhiteSpace(durum))
            kayitlar = kayitlar.Where(x => x.Durum == durum.Trim()).ToList();

        /* Uzman süzgeci (07.10.2026): İK uzmanı önce kendi şubelerini görür */
        var kapsam = UzmanKapsami.Olustur(db, _saglayici.GetRequiredService<AyarServisi>(), Rol,
            User?.Identity?.Name, uzman, kendisi: false);
        if (kapsam is not null) kayitlar = kayitlar.Where(x => kapsam.Icinde(x.Sube)).ToList();

        var taksitler = Taksitler(db, kayitlar.Select(x => x.Id));

        /* Kişi başı geçmiş (bu yıl, toplam, devam eden): tek sorgu */
        var kodlar = kayitlar.Select(x => x.PersonelKodu.Trim()).Distinct().ToList();
        var tumu = new List<AvansSatiri>();

        foreach (var parca in kodlar.Chunk(900))
            tumu.AddRange(db.Query<AvansSatiri>(Secim + " WHERE personel_kodu IN @parca", new { parca }));

        var tumTaksit = Taksitler(db, tumu.Where(x => x.Onayli).Select(x => x.Id));

        var gecmis = tumu.GroupBy(x => K(x.PersonelKodu))
            .ToDictionary(gr => gr.Key, gr =>
            {
                var onayli = gr.Where(x => x.Onayli).ToList();
                var devam = onayli.Select(a => (a, oz: (dynamic)TaksitOzeti(a, tumTaksit.GetValueOrDefault(a.Id), k.KesintiGunu)))
                    .Where(x => (bool)x.oz.devamEdiyor)
                    .ToList();

                return new
                {
                    adet = onayli.Count,
                    toplam = onayli.Sum(x => x.GecerliTutar),
                    buYil = gr.Count(x => x.Olusturma.Year == DateTime.Today.Year && x.Durum is not ("reddedildi" or "iptal")),
                    devamEden = devam.Count,
                    kalanBorc = devam.Sum(x => (decimal)x.oz.kalan),
                    kalanTaksit = devam.Sum(x => (int)x.oz.kalanTaksit),
                };
            });

        return Ok(new
        {
            kapsam = UzmanKapsami.Ozet(kapsam),
            kural = k,
            maasGorunur = maasGor,
            kayitlar = kayitlar.Select(a =>
            {
                dynamic oz = TaksitOzeti(a, taksitler.GetValueOrDefault(a.Id), k.KesintiGunu);
                var maas = maasGor ? Maas(a.PersonelKodu) : null;

                return new
                {
                    id = a.Id,
                    personelKodu = a.PersonelKodu,
                    adSoyad = a.AdSoyad,
                    sube = a.Sube,
                    pozisyon = a.Pozisyon,
                    tutar = a.Tutar,
                    taksit = a.Taksit,
                    ilkKesinti = a.IlkKesinti,
                    onayTutar = a.OnayTutar,
                    onayTaksit = a.OnayTaksit,
                    onayIlkKesinti = a.OnayIlkKesinti,
                    gecerliTutar = a.GecerliTutar,
                    aciklama = a.Aciklama,
                    neden = a.Neden,
                    durum = a.Durum,
                    durumAdi = DurumAdi(a, (bool)oz.devamEdiyor),
                    asama = a.Durum == "bekliyor" ? a.Asama ?? 0 : (int?)null,
                    asamaAdi = a.Durum == "bekliyor" ? a.GecerliAdim.Ad : null,
                    araNot = a.AraNot,
                    kararVerebilir = a.Durum == "bekliyor" && AvansOnayZinciri.PanelYetkili(a.GecerliAdim, Roller.Temel(Rol)),
                    /* Onay sırası (08.10.2026): adımlar, kim onayladı, kimi bekliyor */
                    onaySirasi = a.Zincir is null ? null : SiraOzeti(a),
                    ikAdimi = a.Durum == "bekliyor" && a.GecerliAdim.Tur != AvansOnayZinciri.TurKisi,
                    ikNotu = a.IkNotu,
                    kararVeren = a.KararVeren,
                    kararTarihi = a.KararTarihi,
                    odemeTarihi = a.OdemeTarihi,
                    odeyen = a.Odeyen,
                    kaynak = a.Kaynak,
                    limitAsimi = a.LimitAsimi,
                    olusturma = a.Olusturma,
                    maas,
                    limit = Limit(maas, k),
                    ozet = oz,
                    gecmis = gecmis.GetValueOrDefault(K(a.PersonelKodu)),
                };
            }).ToList(),
        });
    }

    /// <summary>
    /// Avans raporu (08.10.2026): seçilen aralıkta (talep tarihine göre; boşsa
    /// hepsi) kim ne kadar avans almış, kaç taksit ödemiş, kaç taksit kalmış,
    /// kapananlar. Panel Excel'i bundan hazırlıyor. Maaş ve limit dönmüyor.
    /// </summary>
    [HttpGet("Rapor")]
    public IActionResult Rapor([FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        var k = KuralOku(db);
        var b = bas?.Date ?? new DateTime(2000, 1, 1);
        var s = (bit?.Date ?? new DateTime(2100, 1, 1)).AddDays(1);

        var kayitlar = db.Query<AvansSatiri>(Secim + " WHERE olusturma >= @b AND olusturma < @s ORDER BY olusturma",
            new { b, s }).ToList();

        var taksitler = Taksitler(db, kayitlar.Select(x => x.Id));
        var bugun = DateTime.Today;

        return Ok(new
        {
            bas = bas?.Date,
            bit = bit?.Date,
            olusturma = DateTime.Now,
            hazirlayan = PanelAdi,
            kesintiGunu = k.KesintiGunu,
            kayitlar = kayitlar.Select(a =>
            {
                var plan = a.Onayli
                    ? (taksitler.GetValueOrDefault(a.Id) ?? new()).Select(x => (x.Sira, x.Tarih, x.Tutar)).ToList()
                    : new List<(int Sira, DateTime Tarih, decimal Tutar)>();

                var kesilen = plan.Where(x => x.Tarih.Date <= bugun).ToList();
                var kalan = plan.Where(x => x.Tarih.Date > bugun).ToList();
                var kapandi = a.Onayli && plan.Count > 0 && kalan.Count == 0;

                return new
                {
                    id = a.Id,
                    personelKodu = a.PersonelKodu,
                    adSoyad = a.AdSoyad,
                    sube = a.Sube,
                    pozisyon = a.Pozisyon,
                    olusturma = a.Olusturma,
                    neden = a.Neden,
                    aciklama = a.Aciklama,
                    talepTutar = a.Tutar,
                    talepTaksit = a.Taksit,
                    tutar = a.GecerliTutar,
                    taksit = a.GecerliTaksit,
                    ilkKesinti = a.GecerliIlk,
                    sonKesinti = plan.Count > 0 ? plan[^1].Tarih : (DateTime?)null,
                    durum = a.Durum,
                    durumAdi = a.Durum switch
                    {
                        "bekliyor" => $"{a.GecerliAdim.Ad} onayında",
                        "reddedildi" => "Reddedildi",
                        "iptal" => "İptal",
                        _ when kapandi => "Kapandı",
                        "onaylandi" => "Onaylandı · ödeme bekliyor",
                        _ => "Devam ediyor",
                    },
                    onayli = a.Onayli,
                    devamEdiyor = a.Onayli && kalan.Count > 0,
                    kapandi,
                    odenenTaksit = kesilen.Count,
                    kalanTaksit = kalan.Count,
                    kesilenTutar = kesilen.Sum(x => x.Tutar),
                    kalanTutar = kalan.Sum(x => x.Tutar),
                    siradaki = kalan.Count > 0 ? kalan[0].Tarih : (DateTime?)null,
                    odemeTarihi = a.OdemeTarihi,
                    kararVeren = a.KararVeren,
                    kararTarihi = a.KararTarihi,
                    ikNotu = a.IkNotu,
                    kaynak = a.Kaynak,
                    taksitler = plan.Select(x => new { sira = x.Sira, tarih = x.Tarih, tutar = x.Tutar, kesildi = x.Tarih.Date <= bugun }),
                };
            }).ToList(),
        });
    }

    /// <summary>Talebin ayrıntısı: kişinin bütün avansları ve hareketler.</summary>
    [HttpGet("{id:int}")]
    public IActionResult Ayrinti(int id)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        var a = db.QueryFirstOrDefault<AvansSatiri>(Secim + " WHERE id = @id", new { id });

        if (a is null) return NotFound(new { hata = "Talep bulunamadı." });

        var hareketler = db.Query(@"
SELECT olay, aciklama, yapan, zaman FROM KRY_AVANS_HAREKET WHERE avans_id = @id ORDER BY id", new { id }).ToList();

        var belgeler = db.Query(@"
SELECT id, tur, dosya_adi AS dosyaAdi, tip, boyut, yukleyen, tarih FROM KRY_AVANS_BELGE WHERE avans_id = @id ORDER BY id",
            new { id }).ToList();

        return Ok(new
        {
            hareketler,
            personel = PersonelOzeti(db, a.PersonelKodu),
            belgeler,
            belgeAdi = a.Durum == BelgeDurumu || belgeler.Count > 0 ? BelgeAdi(a.Neden) : null,
        });
    }

    /// <summary>Personel kartı › Avans sekmesi.</summary>
    [HttpGet("Personel/{kod}")]
    public IActionResult Personel(string kod)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        return Ok(PersonelOzeti(db, kod));
    }

    private object PersonelOzeti(IDbConnection db, string kod)
    {
        kod = (kod ?? "").Trim();

        var k = KuralOku(db);
        var kodlar = new[] { kod, kod.TrimStart('0') }.Distinct().ToList();

        var kayitlar = db.Query<AvansSatiri>(Secim + " WHERE personel_kodu IN @kodlar ORDER BY olusturma DESC",
            new { kodlar }).ToList();
        var taksitler = Taksitler(db, kayitlar.Select(x => x.Id));
        var d = Durum(db, kayitlar.FirstOrDefault()?.PersonelKodu ?? kod, k);

        var maasGor = MaasGorebilir;
        var maas = maasGor ? Maas(kod) : null;

        return new
        {
            maasGorunur = maasGor,
            maas,
            limit = Limit(maas, k),
            ustLimit = Limit(maas, k) is decimal l && k.UstuAcik ? l * k.UstCarpan : Limit(maas, k),
            buYil = d.BuYil,
            yillikHak = k.YillikHak,
            toplamAdet = d.ToplamAdet,
            toplamAlinan = d.ToplamAlinan,
            sonAvans = d.SonAvans,
            kalanBorc = d.KalanBorc,
            kesintiGunu = k.KesintiGunu,
            devamEden = d.DevamEden is null ? null : new
            {
                id = d.DevamEden.Id,
                tutar = d.DevamEden.GecerliTutar,
                taksit = d.DevamEden.GecerliTaksit,
                ozet = d.DevamOzet,
            },
            avanslar = kayitlar.Select(a =>
            {
                dynamic oz = TaksitOzeti(a, taksitler.GetValueOrDefault(a.Id), k.KesintiGunu);

                return new
                {
                    id = a.Id,
                    tutar = a.GecerliTutar,
                    talepTutar = a.Tutar,
                    taksit = a.GecerliTaksit,
                    ilkKesinti = a.GecerliIlk,
                    durum = a.Durum,
                    durumAdi = DurumAdi(a, (bool)oz.devamEdiyor),
                    olusturma = a.Olusturma,
                    kaynak = a.Kaynak,
                    aciklama = a.Aciklama,
                    neden = a.Neden,
                    ikNotu = a.IkNotu,
                    ozet = oz,
                };
            }).ToList(),
        };
    }

    public class KararGirdi
    {
        public bool Onay { get; set; }
        public decimal? Tutar { get; set; }
        public int? Taksit { get; set; }
        public DateTime? IlkKesinti { get; set; }
        public string Not { get; set; }
    }

    /// <summary>
    /// Panel kararı. Talep onay akışındaki adımda bekliyor (AvansAkisi);
    /// karar yalnızca o adımın rollerine açık (Admin her adımda). Onayda
    /// tutar, taksit ve ilk kesinti değiştirilebilir; değişiklik personele
    /// bildirilir. Onaylanmış avansın planı, ilk taksiti kesilmeden önce
    /// aynı uçla yeniden düzenlenebilir.
    /// </summary>
    [HttpPost("{id:int}/Karar")]
    public async Task<IActionResult> Karar(int id, [FromBody] KararGirdi g)
    {
        if (!IkYetkili) return Forbid();
        if (g is null) return BadRequest(new { hata = "Karar okunamadı." });

        var temel = Roller.Temel(Rol);

        return await KararUygula(id, g, PanelAdi, adim => AvansOnayZinciri.PanelYetkili(adim, temel), duzenlemeIzni: true);
    }

    /// <summary>
    /// Biçen360 patron ekranından karar (genel müdür yardımcısı adımı).
    /// Yetki akıştaki adımın sicil listesi; tutar ve taksit telefonda
    /// değiştirilmiyor, İK'nın son girdiği (ya da personelin istediği) geçerli.
    /// </summary>
    [NonAction]
    public Task<IActionResult> DisaridanKarar(int id, bool onay, string not, string imza, string sicil) =>
        KararUygula(id, new KararGirdi { Onay = onay, Not = not }, imza,
            adim => AvansOnayZinciri.SicilYetkili(adim, sicil), duzenlemeIzni: false);

    private async Task<IActionResult> KararUygula(int id, KararGirdi g, string yapan,
        Func<AvansOnayZinciri.Adim, bool> yetkili, bool duzenlemeIzni)
    {
        using var db = _vt.Baglanti();

        var k = KuralOku(db);
        var a = db.QueryFirstOrDefault<AvansSatiri>(Secim + " WHERE id = @id", new { id });

        if (a is null) return NotFound(new { hata = "Talep bulunamadı." });

        var not = (g.Not ?? "").Trim();
        if (not.Length > 500) not = not[..500];

        var duzenleme = a.Onayli;
        var zincir = AvansOnayZinciri.Oku(a.Zincir);
        var adimlar = zincir?.Adimlar ?? AvansOnayZinciri.EskiAdimlar();
        var asama = Math.Clamp(a.Asama ?? 0, 0, adimlar.Count - 1);
        var adim = adimlar[asama];
        var son = asama >= adimlar.Count - 1;
        var araKarardaBildir = zincir is null
            ? AvansAkisi.Gecerli().AraKarardaBildir
            : _saglayici.GetRequiredService<AvansOnayZinciri>().AyarOku().AraKarardaBildir;

        if (duzenleme)
        {
            if (!duzenlemeIzni) return BadRequest(new { hata = "Bu talep sonuçlanmış." });
            if (!g.Onay) return BadRequest(new { hata = "Onaylanmış avans reddedilemez; gerekirse iptal ediniz." });

            var ilkTaksit = db.ExecuteScalar<DateTime?>(
                "SELECT MIN(tarih) FROM KRY_AVANS_TAKSIT WHERE avans_id = @id", new { id });

            if (ilkTaksit is DateTime it && it.Date <= DateTime.Today)
                return BadRequest(new { hata = "İlk taksit kesildiği için plan değiştirilemez." });
        }
        else if (a.Durum != "bekliyor")
        {
            return BadRequest(new { hata = "Bu talep sonuçlanmış." });
        }
        else if (!yetkili(adim))
        {
            return StatusCode(403, new { hata = $"Bu talep şu an {adim.Ad} onayında; bu adımda karar yetkiniz yok." });
        }

        if (!g.Onay && not.Length < 3)
            return BadRequest(new { hata = "Ret sebebini yazınız; personel bunu görür." });

        /* Yöneticinin eksik bildirimi (26.10.2026) karar verilince kapanır */
        if (!duzenleme) YoneticiEksik.Kapat(db, TalepEksik.Avans, id, $"{(g.Onay ? "Onaylandı" : "Reddedildi")} · {yapan}");

        /* Kararı zincire yaz; sıradaki adım (onaylayanı olmayan ya da aynı
           kişinin onayladığı adım atlanıyor) */
        if (zincir is not null && !duzenleme)
        {
            adim.Karar = g.Onay ? "onay" : "red";
            adim.Kim = Kirp(yapan ?? "", 100);
            adim.Tarih = DateTime.Now;
            adim.Not = not.Length == 0 ? null : not;
        }

        int? sonrakiNo = null;
        if (!duzenleme && !son && (g.Onay ? adim.Onaylarsa : adim.Reddederse) == AvansAkisi.Sonraki)
            sonrakiNo = zincir is null
                ? asama + 1
                : _saglayici.GetRequiredService<AvansOnayZinciri>().Ilerle(zincir, asama, a.PersonelKodu, a.Sube);

        /* Sonraki adıma geçiş: karar bu adımda kesin değil */
        var gecis = sonrakiNo is not null;
        var sonraki = gecis ? adimlar[sonrakiNo.Value] : null;
        var yeniAsama = sonrakiNo ?? asama;
        var zJson = zincir is null ? null : AvansOnayZinciri.Json(zincir);
        var atlananBitis = sonrakiNo ?? adimlar.Count;

        if (!g.Onay)
        {
            if (not.Length < 3)
                return BadRequest(new { hata = gecis
                    ? $"Ret sebebini yazınız; {sonraki.Ad} bunu görür."
                    : "Ret sebebini yazınız; personel bunu görür." });

            if (gecis)
            {
                /* 15.10.2026: İK ve yönetim adı yazılmaz ("İnsan Kaynakları tarafından onaylanmadı") */
                var araNot = Kirp($"{KararEtiketi.Karar(adim.Ad, adim.Tur, yapan, false, Rol)}: {not}" + (string.IsNullOrWhiteSpace(a.AraNot) ? "" : "\n" + a.AraNot), 1000);

                var n = db.Execute(@"
UPDATE KRY_AVANS SET asama = @yeni, ara_not = @araNot, zincir = ISNULL(@z, zincir), guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'bekliyor' AND ISNULL(asama, 0) = @asama",
                    new { id, yeni = yeniAsama, araNot, asama, z = zJson });

                if (n == 0) return Conflict(new { hata = "Talep bu sırada değişti; listeyi yenileyiniz." });

                Hareket(db, id, $"{adim.Ad} reddetti", $"{not} · {sonraki.Ad} onayına gönderildi", yapan);
                AtlananlariYaz(db, id, adimlar, asama + 1, atlananBitis);

                await SonrakiAdimaBildir(sonraki, a, $"{adim.Ad} reddetti; son karar sizde");

                if (araKarardaBildir)
                    await _bildirim.Gonder(a.PersonelKodu, "Avans talebiniz değerlendirmede",
                        $"{Lira(a.Tutar)} tutarındaki avans talebiniz değerlendirmede.", "avans");

                return Ok(new { basarili = true, sonrakiAdim = sonraki.Ad });
            }

            var red = db.Execute(@"
UPDATE KRY_AVANS SET durum = N'reddedildi', ik_notu = @not, karar_veren = @ad, karar_tarihi = SYSDATETIME(),
       zincir = ISNULL(@z, zincir), guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'bekliyor' AND ISNULL(asama, 0) = @asama", new { id, not, ad = yapan, asama, z = zJson });

            if (red == 0) return Conflict(new { hata = "Talep bu sırada değişti; listeyi yenileyiniz." });

            Hareket(db, id, asama > 0 || zincir is not null ? $"{adim.Ad} reddetti · sonuç" : "Reddedildi", not, yapan);
            AtlananlariYaz(db, id, adimlar, asama + 1, atlananBitis);

            await _bildirim.Gonder(a.PersonelKodu, "Avans talebiniz reddedildi",
                $"{Lira(a.Tutar)} tutarındaki avans talebiniz reddedildi: {not}", "avans");

            return Ok(new { basarili = true });
        }

        var tutar = Math.Round(g.Tutar ?? a.GecerliTutar, 2);
        var taksit = g.Taksit ?? a.GecerliTaksit;
        var ilk = (g.IlkKesinti ?? a.GecerliIlk).Date;

        if (tutar <= 0) return BadRequest(new { hata = "Tutar sıfırdan büyük olmalı." });
        if (taksit is < 1 or > 24) return BadRequest(new { hata = "Taksit sayısı 1 ile 24 arasında olmalı." });

        if (g.IlkKesinti is null)
        {
            /* Tarih seçilmediyse (Biçen360, ya da talep bekledi) ilk uygun kesinti ayı */
            ilk = KesintiTarihi(ilk.Year, ilk.Month, k.KesintiGunu);
            for (var i = 0; ilk <= DateTime.Today && i < 24; i++)
                ilk = KesintiTarihi(ilk.AddMonths(1).Year, ilk.AddMonths(1).Month, k.KesintiGunu);
        }

        if (ilk <= DateTime.Today) return BadRequest(new { hata = "İlk kesinti tarihi bugünden sonra olmalı." });

        /* İK günü seçse de kesinti günü kuraldaki gün */
        ilk = KesintiTarihi(ilk.Year, ilk.Month, k.KesintiGunu);

        if (ilk <= DateTime.Today)
            return BadRequest(new { hata = $"Bu ayın kesinti günü ({k.KesintiGunu}) geçti; sonraki ayı seçiniz." });

        if (gecis)
        {
            /* Onay sonraki adıma gidiyor: düzenlenen tutar/taksit saklanır, plan yazılmaz */
            var araNot = Kirp(KararEtiketi.Karar(adim.Ad, adim.Tur, yapan, true, Rol) + (not.Length > 0 ? $": {not}" : "")
                              + (string.IsNullOrWhiteSpace(a.AraNot) ? "" : "\n" + a.AraNot), 1000);

            var n = db.Execute(@"
UPDATE KRY_AVANS SET asama = @yeni, ara_not = @araNot, zincir = ISNULL(@z, zincir),
       onay_tutar = @tutar, onay_taksit = @taksit, onay_ilk_kesinti = @ilk, guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'bekliyor' AND ISNULL(asama, 0) = @asama",
                new { id, yeni = yeniAsama, araNot, tutar, taksit, ilk, asama, z = zJson });

            if (n == 0) return Conflict(new { hata = "Talep bu sırada değişti; listeyi yenileyiniz." });

            Hareket(db, id, $"{adim.Ad} onayladı",
                $"{Lira(tutar)} · {taksit} taksit · ilk kesinti {ilk:dd.MM.yyyy} · {sonraki.Ad} onayına gönderildi"
                + (not.Length > 0 ? $" · {not}" : ""), yapan);
            AtlananlariYaz(db, id, adimlar, asama + 1, atlananBitis);

            await SonrakiAdimaBildir(sonraki, a, $"{adim.Ad} onayladı");

            if (araKarardaBildir)
                await _bildirim.Gonder(a.PersonelKodu, "Avans talebiniz değerlendirmede",
                    $"{Lira(a.Tutar)} tutarındaki avans talebiniz değerlendirmede.", "avans");

            return Ok(new { basarili = true, sonrakiAdim = sonraki.Ad });
        }

        /* Dapper her sorguda bağlantıyı açıp kapatıyor; işlem için açık olmalı
           ("Invalid operation. The connection is closed", 06.10.2026) */
        if (db.State != System.Data.ConnectionState.Open) db.Open();

        using (var islem = db.BeginTransaction())
        {
            /* Aynı anda iki onaylayan (ör. iki bölge müdürü) karar verirse ikincisi düşer */
            var guncellenen = db.Execute(@"
UPDATE KRY_AVANS
SET durum = CASE WHEN durum = N'odendi' THEN N'odendi' ELSE N'onaylandi' END,
    onay_tutar = @tutar, onay_taksit = @taksit, onay_ilk_kesinti = @ilk,
    ik_notu = CASE WHEN @not = N'' THEN ik_notu ELSE @not END,
    karar_veren = @ad, karar_tarihi = SYSDATETIME(), zincir = ISNULL(@z, zincir), guncelleme = SYSDATETIME()
WHERE id = @id AND (@duzenleme = 1 OR (durum = N'bekliyor' AND ISNULL(asama, 0) = @asama))",
                new { id, tutar, taksit, ilk, not, ad = yapan, z = duzenleme ? null : zJson, duzenleme = duzenleme ? 1 : 0, asama }, islem);

            if (guncellenen == 0)
            {
                islem.Rollback();
                return Conflict(new { hata = "Talep bu sırada değişti; listeyi yenileyiniz." });
            }

            PlanYaz(db, id, tutar, taksit, ilk, k.KesintiGunu, islem);

            Hareket(db, id, duzenleme ? "Plan düzenlendi" : asama > 0 || zincir is not null ? $"{adim.Ad} onayladı · sonuç" : "Onaylandı",
                $"{Lira(tutar)} · {taksit} taksit · ilk kesinti {ilk:dd.MM.yyyy}" + (not.Length > 0 ? $" · {not}" : ""),
                yapan, islem);
            if (!duzenleme) AtlananlariYaz(db, id, adimlar, asama + 1, atlananBitis, islem);

            islem.Commit();
        }

        var degisti = tutar != a.Tutar || taksit != a.Taksit || ilk != a.IlkKesinti.Date;

        await _bildirim.Gonder(a.PersonelKodu,
            duzenleme ? "Avans ödeme planınız güncellendi" : "Avans talebiniz onaylandı",
            $"{Lira(tutar)} · {(taksit == 1 ? "tek seferde" : $"{taksit} taksit")} · ilk kesinti {AyYaz(ilk)}"
            + (degisti && !duzenleme ? " (talebiniz düzenlenerek onaylandı)" : "")
            + ". Ayrıntılar Avanslarım ekranında.",
            "avans");

        return Ok(new { basarili = true });
    }

    private static string Kirp(string s, int n) => s.Length > n ? s[..n] : s;

    /// <summary>"Mağaza Müdürü (Ali Veli) → Bölge Müdürü (…) → İnsan Kaynakları → …"</summary>
    private static string SiraMetni(AvansOnayZinciri.Zincir z) =>
        Kirp(string.Join(" → ", z.Adimlar.Select(x =>
            x.Tur == AvansOnayZinciri.TurKisi
                ? $"{x.Ad} ({(x.Adlar.Count == 0 ? "kimse yok" : string.Join(", ", x.Adlar.Take(3)) + (x.Adlar.Count > 3 ? $" +{x.Adlar.Count - 3}" : ""))})"
                : x.Ad)) + $" · kural: {z.Kural}", 500);

    /// <summary>Atlanan adımlar hareket geçmişine</summary>
    private static void AtlananlariYaz(IDbConnection db, int id, List<AvansOnayZinciri.Adim> adimlar, int bas, int bit,
        IDbTransaction islem = null)
    {
        for (var i = Math.Max(0, bas); i < Math.Min(bit, adimlar.Count); i++)
            if (adimlar[i].Karar == "atlandi")
                Hareket(db, id, $"{adimlar[i].Ad} adımı atlandı", adimlar[i].Not, "sistem", islem);
    }

    /// <summary>Panel: onay sırası (adım, onaylayanlar, karar)</summary>
    private static object SiraOzeti(AvansSatiri a)
    {
        var asama = a.Asama ?? 0;
        return a.Adimlar.Select((x, i) => new
        {
            ad = x.Ad,
            tur = x.Tur,
            kisiler = x.Adlar,
            karar = x.Karar,
            kim = x.Kim,
            tarih = x.Tarih,
            not = x.Not,
            simdi = a.Durum == "bekliyor" && i == asama,
        }).ToList();
    }

    /// <summary>
    /// Sonraki adıma bildirim. Kişi adımında onaylayanlara (Biçen360: İzin
    /// Onayları; patron görünümündekiler Onaylar), İK adımında İK rollerine.
    /// </summary>
    private async Task SonrakiAdimaBildir(AvansOnayZinciri.Adim sonraki, AvansSatiri a, string onceki)
    {
        if (sonraki.Tur == AvansOnayZinciri.TurIk)
        {
            try
            {
                var roller = (sonraki.Roller ?? new()).Count > 0 ? sonraki.Roller.ToArray() : new[] { Roller.IK, Roller.IKYoneticisi };
                await _bildirim.RoleGonder(roller, $"Avans talebi {sonraki.Ad} onayında",
                    $"{a.AdSoyad} · {Lira(a.GecerliTutar)} · {onceki}.", "avans");
            }
            catch
            {
                /* panel listesinde görünüyor */
            }
            return;
        }

        var patron = HttpContext?.RequestServices.GetService<PatronServisi>();

        foreach (var sicil in (sonraki.Siciller ?? new()).Distinct())
        {
            try
            {
                var ekran = sonraki.Tur == AvansOnayZinciri.TurEski || (patron?.PatronMu(sicil) ?? false)
                    ? "patron-onaylar" : "izinonay|avans";
                await _bildirim.Gonder(sicil, "Avans talebi onayınızı bekliyor",
                    $"{a.AdSoyad} · {Lira(a.GecerliTutar)} · {onceki}.", ekran);
            }
            catch
            {
                /* Bildirim gidemezse talep yine sırada */
            }
        }
    }

    public class OdemeGirdi
    {
        public DateTime? Tarih { get; set; }
    }

    /// <summary>Ödeme yapıldı.</summary>
    [HttpPost("{id:int}/Odendi")]
    public async Task<IActionResult> Odendi(int id, [FromBody] OdemeGirdi g)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        var a = db.QueryFirstOrDefault<AvansSatiri>(Secim + " WHERE id = @id", new { id });

        if (a is null) return NotFound(new { hata = "Talep bulunamadı." });
        if (a.Durum != "onaylandi") return BadRequest(new { hata = "Yalnızca onaylanmış avans ödendi işaretlenebilir." });

        var tarih = (g?.Tarih ?? DateTime.Today).Date;

        db.Execute(@"
UPDATE KRY_AVANS SET durum = N'odendi', odeme_tarihi = @tarih, odeyen = @ad, guncelleme = SYSDATETIME()
WHERE id = @id", new { id, tarih, ad = PanelAdi });

        Hareket(db, id, "Ödendi", tarih.ToString("dd.MM.yyyy"), PanelAdi);

        await _bildirim.Gonder(a.PersonelKodu, "Avansınız ödendi",
            $"{Lira(a.GecerliTutar)} avansınız hesabınıza ödendi. Kesintiler {AyYaz(a.GecerliIlk)} tarihinde başlar.",
            "avans");

        return Ok(new { basarili = true });
    }

    /// <summary>İK iptali (yanlış girilen kayıt, vazgeçilen avans).</summary>
    [HttpPost("{id:int}/IkIptal")]
    public IActionResult IkIptal(int id, [FromBody] KararGirdi g)
    {
        if (!IkYetkili) return Forbid();

        var not = (g?.Not ?? "").Trim();

        if (not.Length < 3) return BadRequest(new { hata = "İptal sebebini yazınız." });

        using var db = _vt.Baglanti();

        var kesildi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_AVANS_TAKSIT WHERE avans_id = @id AND tarih <= CAST(SYSDATETIME() AS DATE)",
            new { id });

        if (kesildi > 0)
            return BadRequest(new { hata = "Taksiti kesilmiş avans iptal edilemez." });

        var n = db.Execute(@"
UPDATE KRY_AVANS SET durum = N'iptal', ik_notu = @not, guncelleme = SYSDATETIME()
WHERE id = @id AND durum IN (N'bekliyor', N'belge', N'onaylandi', N'odendi')", new { id, not });

        if (n == 0) return BadRequest(new { hata = "Kayıt iptal edilemedi." });

        BelgeKartiKapat(db, id, "İK iptal etti");

        db.Execute("DELETE FROM KRY_AVANS_TAKSIT WHERE avans_id = @id", new { id });
        Hareket(db, id, "İK iptal etti", not, PanelAdi);

        return Ok(new { basarili = true });
    }

    public class EkleGirdi
    {
        public string PersonelKodu { get; set; }
        public decimal Tutar { get; set; }
        public int Taksit { get; set; }
        public DateTime IlkKesinti { get; set; }
        public DateTime? OdemeTarihi { get; set; }
        public string Aciklama { get; set; }
        public string Neden { get; set; }
    }

    /// <summary>
    /// İK'nın elle girdiği avans: sistemden önce verilmiş, kesintisi süren
    /// avanslar ya da mobil dışından gelen talepler. Onaylı (ödendi) olarak
    /// kaydedilir; geçmiş tarihli taksitler kesildi sayılır.
    /// </summary>
    [HttpPost("Ekle")]
    public IActionResult Ekle([FromBody] EkleGirdi g)
    {
        if (!IkYetkili) return Forbid();
        if (g is null) return BadRequest(new { hata = "Bilgiler eksik." });

        var p = _ekip.Kisi(g.PersonelKodu);

        if (p is null) return BadRequest(new { hata = "Personel bulunamadı." });
        if (g.Tutar <= 0) return BadRequest(new { hata = "Tutarı yazınız." });
        if (g.Taksit is < 1 or > 24) return BadRequest(new { hata = "Taksit sayısı 1 ile 24 arasında olmalı." });

        using var db = _vt.Baglanti();

        var k = KuralOku(db);
        var ilk = KesintiTarihi(g.IlkKesinti.Year, g.IlkKesinti.Month, k.KesintiGunu);
        var tutar = Math.Round(g.Tutar, 2);
        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length > 500) aciklama = aciklama[..500];

        /* İK'nın elle girdiği eski avanslarda neden bilinmeyebilir: isteğe bağlı */
        var neden = string.IsNullOrWhiteSpace(g.Neden) ? null : g.Neden.Trim();

        if (NedenHatasi(neden, aciklama, false) is string nedenHata)
            return BadRequest(new { hata = nedenHata });

        int id;

        /* Dapper her sorguda bağlantıyı açıp kapatıyor; işlem için açık olmalı
           ("Invalid operation. The connection is closed", 06.10.2026) */
        if (db.State != System.Data.ConnectionState.Open) db.Open();

        using (var islem = db.BeginTransaction())
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_AVANS (personel_kodu, ad_soyad, sube, pozisyon, tutar, taksit, ilk_kesinti, aciklama, neden, durum,
                       onay_tutar, onay_taksit, onay_ilk_kesinti, karar_veren, karar_tarihi,
                       odeme_tarihi, odeyen, kaynak, olusturma)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @sube, @poz, @tutar, @taksit, @ilk, @aciklama, @neden, N'odendi',
        @tutar, @taksit, @ilk, @ik, SYSDATETIME(), @odeme, @ik, N'ik', @olusturma)",
                new
                {
                    kod = p.PersonelKodu.Trim(),
                    ad = $"{p.Ad} {p.Soyad}".Trim(),
                    sube = p.IsGrubu,
                    poz = p.Pozisyon,
                    tutar,
                    taksit = g.Taksit,
                    ilk,
                    aciklama = aciklama.Length == 0 ? null : aciklama,
                    neden,
                    ik = PanelAdi,
                    odeme = g.OdemeTarihi?.Date,
                    olusturma = g.OdemeTarihi?.Date ?? DateTime.Now,
                }, islem);

            PlanYaz(db, id, tutar, g.Taksit, ilk, k.KesintiGunu, islem);
            Hareket(db, id, "İK elle girdi", $"{Lira(tutar)} · {g.Taksit} taksit · ilk kesinti {ilk:dd.MM.yyyy}",
                PanelAdi, islem);

            islem.Commit();
        }

        return Ok(new { basarili = true, id });
    }

    /// <summary>Doldurulmuş A4 avans talep formu (yazdırmak için).</summary>
    [HttpGet("{id:int}/Form")]
    public IActionResult Form(int id)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        var a = db.QueryFirstOrDefault<AvansSatiri>(Secim + " WHERE id = @id", new { id });

        if (a is null) return NotFound(new { hata = "Talep bulunamadı." });

        var k = KuralOku(db);
        var d = Durum(db, a.PersonelKodu, k, a.Id);
        var p = _ekip.Kisi(a.PersonelKodu);

        var plan = a.Onayli
            ? Taksitler(db, new[] { a.Id }).GetValueOrDefault(a.Id)?.Select(x => (x.Sira, x.Tarih, x.Tutar)).ToList()
            : null;

        string kidem = null;

        if (p is not null)
        {
            var gunSayisi = p.KidemGunu > 0
                ? p.KidemGunu
                : p.GirisTarihi is DateTime gt ? (int)(DateTime.Today - gt.Date).TotalDays : 0;
            var ay = (int)Math.Floor(gunSayisi / 30.4375);
            kidem = ay >= 12 ? $"{ay / 12} yıl {ay % 12} ay" : $"{ay} ay";
        }

        /* Genel müdür yardımcısı (07.10.2026): formdaki onay kutusunda adı
           yazılı. Sicil ayardan (Avans:GmySicil, varsayılan 10664 · EYÜP
           BİÇEN); Mikro'da bulunamazsa kutu ad yazılmadan çıkar. */
        string gmy = null;

        try
        {
            /* Ayarlar Merkezi › Süreler ve sınırlar › Avans (appsettings Avans:GmySicil yedek) */
            var gmySicil = Parametre.Metin("avans.gmySicil");
            var g = _ekip.Kisi(string.IsNullOrWhiteSpace(gmySicil) ? "10664" : gmySicil.Trim());
            if (g is not null) gmy = $"{g.Ad} {g.Soyad}".Trim().ToUpper(Tr);
        }
        catch
        {
            /* Bulunamazsa kutu boş kalır */
        }

        /* Birim yöneticisi: personelin 1. onaylayanı (izin onay tablosu) */
        string yonetici = null;

        try
        {
            if (p is not null && _ekip.Yoneticiler().TryGetValue(K(p.PersonelKodu), out var yon) && yon.Count > 0)
            {
                var y = _ekip.Kisi(yon.First());
                if (y is not null) yonetici = $"{y.Ad} {y.Soyad}".Trim().ToUpper(Tr);
            }
        }
        catch
        {
            /* Yönetici bulunamazsa kutu boş kalır */
        }

        /* Onay zinciri (08.10.2026): formdaki kutular zincirdeki kararlarla */
        var zf = AvansOnayZinciri.Oku(a.Zincir);
        string ikOnaylayan = a.Onayli ? a.KararVeren : null;
        if (zf is not null)
        {
            static string Temiz(string x) => (x ?? "").Replace(" (Biçen360)", "").Trim();
            var ilkOnay = zf.Adimlar.FirstOrDefault(x => x.Tur == AvansOnayZinciri.TurKisi && x.Karar == "onay");
            if (ilkOnay is not null) yonetici = Temiz(ilkOnay.Kim).ToUpper(Tr);
            var ikAdim = zf.Adimlar.LastOrDefault(x => x.Tur == AvansOnayZinciri.TurIk && x.Karar == "onay");
            ikOnaylayan = ikAdim is not null ? Temiz(ikAdim.Kim) : null;
        }

        var html = _form.AvansFormHtml(new AvansFormVerisi
        {
            Id = a.Id,
            Olusturma = a.Olusturma,
            AdSoyad = (a.AdSoyad ?? "").ToUpper(Tr),
            Tc = p?.KimlikNo,
            Sube = a.Sube ?? p?.IsGrubu,
            Gorev = a.Pozisyon ?? p?.Pozisyon,
            Kidem = kidem,
            Telefon = p?.Telefon,
            Tutar = a.Tutar,
            Taksit = a.Taksit,
            IlkKesinti = a.IlkKesinti,
            Aciklama = a.Aciklama,
            Neden = a.Neden,
            OnayTutar = a.OnayTutar,
            OnayTaksit = a.OnayTaksit,
            OnayIlkKesinti = a.OnayIlkKesinti,
            Plan = plan ?? Plan(a.GecerliTutar, a.GecerliTaksit, a.GecerliIlk, k.KesintiGunu),
            BuYilAdet = d.BuYil + (a.Durum is "reddedildi" or "iptal" ? 0 : 1),
            YillikHak = k.YillikHak,
            SonAvans = d.SonAvans,
            DevamEdenVar = d.DevamEden is not null,
            KalanBorc = d.KalanBorc,
            Yonetici = yonetici,
            Gmy = gmy,
            IkOnaylayan = ikOnaylayan,
            KararTarihi = a.KararTarihi,
            KesintiGunu = k.KesintiGunu,
        });

        return Content(html, "text/html; charset=utf-8");
    }

    /* ------------------------------------------------------------ kural */

    [HttpGet("Kural")]
    public IActionResult KuralGetir()
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        return Ok(new { kural = KuralOku(db), ilkKesintiler = IlkKesintiSecenekleri(KuralOku(db)), nedenler = Nedenler, nedenAciklamaZorunlu = AciklamaZorunluNedenler, akis = AvansAkisi.Gecerli() });
    }

    [HttpPost("Kural")]
    public IActionResult KuralKaydet([FromBody] AvansKurali k)
    {
        if (!IkYetkili || Roller.Temel(Rol) is Roller.IK) return Forbid();
        if (k is null) return BadRequest(new { hata = "Ayar okunamadı." });

        k = Duzelt(k);

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = KuralAnahtari, d = JsonSerializer.Serialize(k, JsonSecenek) });

        return Ok(new { basarili = true, kural = k });
    }
}

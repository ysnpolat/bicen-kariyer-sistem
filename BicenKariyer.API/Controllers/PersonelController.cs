using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel listesi.
///
/// Veriler iCardBicen veritabanından yalnızca okunur; bu sistem üzerinden
/// personel kaydı değiştirilmez. Kaynak ve sicil numarası appsettings.json
/// dosyasındaki ConnectionStrings:Personel ve Personel:SicilNo ile belirlenir.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PersonelController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<PersonelController> _kayit;
    private readonly YetkiServisi _yetki;

    private readonly MailServisi _mail;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly YoneticiBulucu _yoneticiBulucu;
    private readonly PersonelDegisimServisi _degisim;
    private readonly AyrilacakPersonelServisi _ayrilacak;

    public PersonelController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        IConfiguration yapilandirma,
        ILogger<PersonelController> kayit,
        YetkiServisi yetki,
        MailServisi mail,
        PersonelKaynagiServisi personelKaynak,
        PersonelDegisimServisi degisim,
        AyrilacakPersonelServisi ayrilacak,
        YoneticiBulucu yoneticiBulucu)
    {
        _vt = vt;
        _ayar = ayar;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
        _yetki = yetki;
        _mail = mail;
        _yoneticiBulucu = yoneticiBulucu;
        _personelKaynak = personelKaynak;
        _degisim = degisim;
        _ayrilacak = ayrilacak;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>Durum değiştirme ve gönderim yetkisi olan roller</summary>
    private bool IslemYapabilir => Roller.IslemYetkisi(Rol);

    /// <summary>İşlemi yapan kullanıcının adı</summary>
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>
    /// Yalnızca fotoğraf yükleyen sınırlı rol. Bu kullanıcılar personelin
    /// ad soyad ve telefon bilgisinden fazlasını göremez.
    /// </summary>
    private bool YalnizcaFotograf => Roller.YalnizcaFotograf(Rol);

    /// <summary>
    /// Sınırlı roller için hassas alanları temizler.
    ///
    /// Verinin sunucuda ayıklanması önemlidir; alanı yalnızca ekranda
    /// gizlemek yeterli değildir, yanıt yine de tarayıcıya ulaşır.
    /// </summary>
    private void AlanlariSinirla(IEnumerable<PersonelKaydi> liste)
    {
        if (YalnizcaFotograf)
        {
            foreach (var kisi in liste)
            {
                kisi.KimlikNo = null;
                kisi.Ucret = null;
                kisi.GirisTarihi = null;
                kisi.CikisTarihi = null;
                kisi.CikisSebebi = null;
                kisi.Pozisyon = null;
            }

            return;
        }

        /* Rol bazlı maskeleme. Sunucuda yapılır: panelde gizlemek
           yeterli değil, ağ isteğine bakan biri veriyi yine görür. */
        var kimlikGizli = _yetki.Gizli(Rol, YetkiServisi.Kimlik);
        var ucretGizli = _yetki.Gizli(Rol, YetkiServisi.Ucret);
        var telefonGizli = _yetki.Gizli(Rol, YetkiServisi.Telefon);

        /* Adres ve doğum tarihi bu listede taşınmıyor; personel kartı
           ayrıntısında maskeleniyor. */
        if (!kimlikGizli && !ucretGizli && !telefonGizli) return;

        foreach (var kisi in liste)
        {
            if (kimlikGizli)
                kisi.KimlikNo = _yetki.KimlikMaskele(Rol, kisi.KimlikNo);

            if (ucretGizli) kisi.Ucret = null;

            if (telefonGizli)
                kisi.Telefon = _yetki.TelefonMaskele(Rol, kisi.Telefon);
        }
    }

    private string[] YetkiliSubeler()
    {
        var ham = User?.FindFirst("subeler")?.Value ?? "";
        return ham.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();
    }

    /* ==================================================================== */
    /* Liste                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Personel kayıtlarını kaynaktan okur ve en güncel çalışma kaydını alır.
    /// </summary>
    private List<PersonelKaydi> PersonelleriGetir()
    {
        var personeller = _personelKaynak.TumPersonelleriGetir();

        /* Mikro'daki değişiklikleri izler. Aralık dolmadıysa hiçbir şey
           yapmaz; yetki süzmesinden ÖNCE çağrılır ki bölge müdürünün
           listesi geçmişi eksik bırakmasın. */
        _degisim.Tara(personeller);

        /* Başvuru fotoğraflarını Mikro'ya aktarır. Ayrı çağrılır: değişiklik
           taraması saatte bir çalışıyor ve fotoğraf aktarımı ona takılınca
           yeni işe alınanların fotoğrafı uzun süre aktarılmıyordu. */
        _degisim.FotograflariAktar(personeller);

        /* Bölge müdürü yalnızca kendi şubelerinin personelini görür.
         *
         * Yetkili şube listesi bölge tanımından geliyor ve orada şube
         * KODLARI duruyor; personel kaydındaki alan ise iş grubu ADI.
         * Önceki sürüm ikisini doğrudan Contains ile karşılaştırıyordu,
         * bu yüzden yalnızca kodu adıyla aynı yazılan birkaç şube
         * tutuyor, geri kalanı sessizce düşüyordu: yedi şubesi olan bir
         * müdür raporda iki şube görüyordu.
         *
         * Çözüm, bölge süzgecinde zaten kullanılan yolu izlemek: kodu
         * ayarlardaki şube tanımından adına çevir, sonra iki tarafı da
         * aynı normalleştirmeden geçirip karşılaştır. */
        if (Rol == Roller.BolgeMuduru)
        {
            var ayar = _ayar.FormOku();
            var tanimlar = ayar.Subeler ?? new List<Sube>();

            var adlar = YetkiliSubeler()
                .Select(k => tanimlar.FirstOrDefault(x =>
                        string.Equals(x.Kod, k, StringComparison.OrdinalIgnoreCase))?.Ad
                    ?? k)
                .Select(BirimAnahtari)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToList();

            personeller = personeller
                .Where(x => adlar.Any(ad => Benziyor(ad, BirimAnahtari(x.Sube))))
                .ToList();
        }

        return personeller;
    }

    [HttpGet]
    public IActionResult Liste(
        [FromQuery] string arama = null,
        [FromQuery] string sube = null,
        [FromQuery] string pozisyon = null,
        [FromQuery] string durum = null,
        /// <summary>Fotoğraf süzgeci: "var" veya "yok"</summary>
        [FromQuery] string resim = null,
        /// <summary>Bu tarihten sonra işe girenler</summary>
        [FromQuery] DateTime? girisBas = null,
        /// <summary>Bu tarihten sonra ayrılanlar</summary>
        [FromQuery] DateTime? cikisBas = null,
        [FromQuery] DateTime? girisBit = null,
        [FromQuery] DateTime? cikisBit = null)
    {
        List<PersonelKaydi> personeller;

        try
        {
            personeller = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Personel listesi alınamadı");

            var sqlHatasi = hata is Microsoft.Data.SqlClient.SqlException;

            return StatusCode(502, new
            {
                hata = sqlHatasi
                    ? "Personel sorgusu çalıştırılamadı."
                    : "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        /* ------------------------------------------------------- süzgeçler */

        if (!string.IsNullOrWhiteSpace(arama))
        {
            var q = arama.Trim();
            /* Türkçe harfe duyarsız (21.10.2026): "şahin" = "SAHIN" = "ŞAHİN" */
            var qs = TrSade(q);
            personeller = personeller
                .Where(x =>
                    TrSade($"{x.Ad} {x.Soyad}").Contains(qs) ||
                    (x.KimlikNo ?? "").Contains(q, StringComparison.OrdinalIgnoreCase) ||
                    (x.PersonelKodu ?? "").Contains(q, StringComparison.OrdinalIgnoreCase) ||
                    (x.Telefon ?? "").Contains(q, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        if (!string.IsNullOrWhiteSpace(sube))
        {
            /* Birebir karşılaştırma yetmiyor: ayarlardaki birim adı ile
               Mikro'daki iş grubu adı Türkçe harflerde ayrışabiliyor
               (Z.MERKEZ BÜRO ↔ Z.MERKEZ BURO). Karşılaştırma öncesi iki
               taraf da sadeleştirilir. */
            var hedef = BirimAnahtari(sube);

            personeller = personeller
                .Where(x => BirimAnahtari(x.Sube) == hedef)
                .ToList();
        }

        if (!string.IsNullOrWhiteSpace(pozisyon))
        {
            personeller = personeller
                .Where(x => string.Equals(x.Pozisyon, pozisyon, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }

        if (resim == "var") personeller = personeller.Where(x => x.ResimVar).ToList();
        if (resim == "yok") personeller = personeller.Where(x => !x.ResimVar).ToList();

        /* Tarih süzgeçleri: belirtilen aralıkta işe giren veya ayrılanlar */
        if (girisBas is not null)
            personeller = personeller
                .Where(x => x.GirisTarihi is not null && x.GirisTarihi >= girisBas.Value.Date)
                .ToList();

        if (girisBit is not null)
            personeller = personeller
                .Where(x => x.GirisTarihi is not null &&
                            x.GirisTarihi <= girisBit.Value.Date.AddDays(1).AddSeconds(-1))
                .ToList();

        if (cikisBas is not null)
            personeller = personeller
                .Where(x => x.CikisTarihi is not null && x.CikisTarihi >= cikisBas.Value.Date)
                .ToList();

        if (cikisBit is not null)
            personeller = personeller
                .Where(x => x.CikisTarihi is not null &&
                            x.CikisTarihi <= cikisBit.Value.Date.AddDays(1).AddSeconds(-1))
                .ToList();

        /* Durum süzgeci en sonda: segmentteki "Çalışan / Ayrılan" sayıları
           öbür süzgeçlerden geçmiş ama durumla daraltılmamış listeden
           sayılır (Personeller sayfası, 02.10.2026). Süzgeçlerin sırası
           sonucu değiştirmiyor. */
        var toplamCalisan = personeller.Count(x => x.Durum == 1);
        var toplamAyrilan = personeller.Count(x => x.Durum != 1);

        if (durum == "calisan") personeller = personeller.Where(x => x.Durum == 1).ToList();
        if (durum == "ayrilan") personeller = personeller.Where(x => x.Durum != 1).ToList();

        /* İşe giriş evrağı eksik çalışanlar: personel kodu → eksik evrak
           adları (03.10.2026). Kimlik maskelenmeden önce eşleştiriliyor;
           yalnızca İK rollerinde. */
        Dictionary<string, List<string>> evrakEksikleri = null;

        if (Roller.IslemYetkisi(Rol))
        {
            var eksikler = HttpContext?.RequestServices
                .GetService<IseGirisEvrakServisi>()?.KimlikEksikleri();

            if (eksikler is { Count: > 0 })
                evrakEksikleri = personeller
                    .Where(x => x.Durum == 1)
                    .Select(x => (x.PersonelKodu, Kimlik: IseGirisEvrakServisi.Kimlik(x.KimlikNo)))
                    .Where(x => x.Kimlik is not null && x.PersonelKodu is not null &&
                                eksikler.TryGetValue(x.Kimlik, out var l) && l.Count > 0)
                    .GroupBy(x => x.PersonelKodu.Trim())
                    .ToDictionary(g => g.Key, g => eksikler[g.First().Kimlik]);
        }

        /* Sınırlı rollerde hassas alanlar sunucuda temizlenir */
        AlanlariSinirla(personeller);

        var (uygulamaKullananlar, belgeSayilari) = HazirlikBilgileri(personeller);

        var raporlular = Raporlular(personeller);

        /* --------------------------------------------------- filtre listeleri */

        var subeler = personeller
            .Select(x => x.Sube)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var pozisyonlar = personeller
            .Select(x => x.Pozisyon)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new
        {
            toplam = personeller.Count,
            calisan = personeller.Count(x => x.Durum == 1),
            ayrilan = personeller.Count(x => x.Durum != 1),
            resimsiz = personeller.Count(x => !x.ResimVar),
            subeSayisi = subeler.Count,
            subeler,
            pozisyonlar,
            /* Personel kodu → yol ücreti (Yönetim → Yol Ücretleri). Excel
               çıktısında maaşın yanına yazılır. Ücret gizli rolde boş. */
            yolUcretleri = YolUcretleri(personeller),
            /* Süzgeçten geçmiş ama durumla daraltılmamış sayılar */
            toplamCalisan,
            toplamAyrilan,
            /* Listede Biçen360 kullanan personelin kodları; okunamazsa null */
            uygulamaKullananlar,
            /* Personel kodu → belge sayısı; belge yetkisi olmayan rolde null */
            belgeSayilari,
            /* Personel kodu → eksik işe giriş evrakları (yalnızca eksiği olanlar) */
            evrakEksikleri,
            /* Bugün raporlu olan çalışanlar: personel kodu → rapor aralığı.
               Fotoğraf görevlisinde null. */
            raporlular,
            personeller = personeller
                .OrderByDescending(x => x.Durum)
                .ThenBy(x => x.Sube)
                .ThenBy(x => x.Ad)
                .ToList()
        });
    }

    /// <summary>
    /// Listedeki personelin yol ücretleri (KRY_PERSONEL_YOL): personel
    /// kodu → tutar.
    ///
    /// <para>
    /// Yol ücreti de ücret sayılır: maaşı göremeyen rol (rol yetkisinde
    /// ücret gizli ya da yalnızca fotoğraf yükleyen) bunu da göremez; boş
    /// sözlük döner. Tablo okunamazsa liste yine çalışır.
    /// </para>
    /// </summary>
    private Dictionary<string, decimal> YolUcretleri(List<PersonelKaydi> personeller)
    {
        var sonuc = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);

        if (YalnizcaFotograf || _yetki.Gizli(Rol, YetkiServisi.Ucret) || personeller.Count == 0)
            return sonuc;

        static string K(string s) => (s ?? "").Trim().TrimStart('0');

        try
        {
            using var db = _vt.Baglanti();

            var kayitlar = db.Query<(string Kod, decimal Tutar)>(
                    "SELECT personel_kodu, tutar FROM KRY_PERSONEL_YOL")
                .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
                .GroupBy(x => K(x.Kod))
                .ToDictionary(g => g.Key, g => g.First().Tutar, StringComparer.OrdinalIgnoreCase);

            if (kayitlar.Count == 0) return sonuc;

            /* Panel personel kodunu olduğu gibi kullanıyor; anahtar o */
            foreach (var p in personeller)
            {
                var kod = (p.PersonelKodu ?? "").Trim();

                if (kod.Length > 0 && kayitlar.TryGetValue(K(kod), out var tutar))
                    sonuc[kod] = tutar;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yol ücretleri okunamadı");
        }

        return sonuc;
    }

    /// <summary>
    /// Listede bugün raporlu olan çalışanlar (03.10.2026): personel kodu →
    /// başlangıç, bitiş (art arda raporlar birleşik) ve kaynak. Rapor
    /// türü burada yok: o özlük bilgisi, yalnızca belge yetkisi olan
    /// rollerde personel kartının Raporlar sekmesinde görünüyor.
    /// </summary>
    private Dictionary<string, object> Raporlular(List<PersonelKaydi> personeller)
    {
        if (YalnizcaFotograf) return null;

        var sonuc = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var bugun = new RaporluServisi(_vt).Bugun(DateTime.Today);

            if (bugun.Count == 0) return sonuc;

            foreach (var p in personeller.Where(x => x.Durum == 1))
            {
                var kod = (p.PersonelKodu ?? "").Trim();

                if (kod.Length == 0 || sonuc.ContainsKey(kod)) continue;

                if (bugun.TryGetValue(RaporluServisi.Anahtar(kod), out var d))
                    sonuc[kod] = new { baslangic = d.Baslangic, bitis = d.Bitis, kaynak = d.Kaynak };
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Raporlu personel okunamadı");
        }

        return sonuc;
    }

    /// <summary>
    /// Personel listesindeki "Hazırlık" simgeleri için: Biçen360 kullananlar
    /// ve kişi başına belge sayısı (02.10.2026).
    ///
    /// <para>
    /// İkisi de tek sorgu: uygulama kullananlar <c>UyumController</c>'daki
    /// ortak okuma, belgeler personel kodu + kimlik numarasına göre
    /// gruplanmış tek bir COUNT. Belge sayısı yalnızca belge ekranına
    /// yetkisi olan rollere (PersonelBelgeController ile aynı) gönderilir.
    /// Okunamayan bölüm null döner; liste yine çalışır.
    /// </para>
    /// </summary>
    private (List<string> Uygulama, Dictionary<string, int> Belge) HazirlikBilgileri(
        List<PersonelKaydi> personeller)
    {
        if (YalnizcaFotograf || personeller.Count == 0)
            return (null, null);

        static string K(string s) => (s ?? "").Trim().TrimStart('0');

        List<string> uygulama = null;
        Dictionary<string, int> belge = null;

        try
        {
            using var db = _vt.Baglanti();

            var kullananlar = UyumController.UygulamaKullananlar(db);

            uygulama = personeller
                .Select(p => (p.PersonelKodu ?? "").Trim())
                .Where(k => k.Length > 0 && kullananlar.Contains(K(k)))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi)
            {
                var gruplar = db.Query<(string Kod, string Kimlik, int Adet)>(@"
SELECT LTRIM(RTRIM(personel_kodu)), LTRIM(RTRIM(kimlik_no)), COUNT(*)
FROM KRY_PERSONEL_BELGE
WHERE silindi = 0
GROUP BY LTRIM(RTRIM(personel_kodu)), LTRIM(RTRIM(kimlik_no))").ToList();

                var kodaGore = gruplar
                    .Where(g => !string.IsNullOrWhiteSpace(g.Kod))
                    .GroupBy(g => K(g.Kod), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

                var kimligeGore = gruplar
                    .Where(g => !string.IsNullOrWhiteSpace(g.Kimlik))
                    .GroupBy(g => g.Kimlik, StringComparer.Ordinal)
                    .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);

                belge = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

                /* Belge ekranı kodu YA DA kimliği tutan belgeleri gösteriyor;
                   sayı da aynı birleşimden: her (kod, kimlik) grubu bir kez. */
                foreach (var p in personeller)
                {
                    var kod = (p.PersonelKodu ?? "").Trim();
                    if (kod.Length == 0 || belge.ContainsKey(kod)) continue;

                    var kimlik = (p.KimlikNo ?? "").Trim();
                    var eslesen = new HashSet<(string, string, int)>();

                    if (kodaGore.TryGetValue(K(kod), out var a)) eslesen.UnionWith(a);
                    if (kimlik.Length == 11 && kimlik.All(char.IsDigit) &&
                        kimligeGore.TryGetValue(kimlik, out var b)) eslesen.UnionWith(b);

                    var adet = eslesen.Sum(x => x.Item3);
                    if (adet > 0) belge[kod] = adet;
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel hazırlık bilgileri okunamadı");
        }

        return (uygulama, belge);
    }

    /* ==================================================================== */
    /* Şube ve pozisyon özetleri                                            */
    /* ==================================================================== */

    /// <summary>
    /// Bağlantı sorunlarını çözmeye yardımcı olacak ayrıntıyı üretir.
    /// İç içe hataların tümü yazılır; asıl sebep genelde en içtekidir.
    /// </summary>
    private static string HataAyrintisi(Exception hata)
    {
        var satirlar = new List<string>();
        var mevcut = hata;

        while (mevcut is not null)
        {
            satirlar.Add($"{mevcut.GetType().Name}: {mevcut.Message}");
            mevcut = mevcut.InnerException;
        }

        return string.Join("\n", satirlar);
    }

    /// <summary>
    /// Personel veritabanı bağlantısını sınar. Sorun olduğunda hangi aşamada
    /// takıldığını gösterir: bağlanma, veritabanı erişimi ve tablo okuma.
    /// </summary>
    [HttpGet("Tani")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult Tani()
    {
        var adimlar = new List<object>();
        var baglantiMetni = _yapilandirma.GetConnectionString("Personel") ?? "";

        // Parola gizlenerek gösterilir
        var gorunen = System.Text.RegularExpressions.Regex.Replace(
            baglantiMetni, @"(?i)(password\s*=)[^;]*", "$1***");

        adimlar.Add(new { adim = "Bağlantı metni", sonuc = gorunen });

        try
        {
            using var db = _vt.PersonelBaglantisi();
            db.Open();

            adimlar.Add(new { adim = "Sunucuya bağlanma", sonuc = "Başarılı" });

            var bilgi = db.QuerySingle<string>(
                "SELECT CONVERT(NVARCHAR(200), @@SERVERNAME) + N' / ' + DB_NAME()");

            adimlar.Add(new { adim = "Sunucu / veritabanı", sonuc = bilgi });

            var tabloVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].sys.tables
WHERE name IN ('PERSONELLER','PERSONEL_IS_GRUP_TANIMLARI','PERSONEL_UNVAN_TANIMLARI')");

            adimlar.Add(new
            {
                adim = "Tablolar",
                sonuc = $"{tabloVar} / 3 tablo görülebiliyor"
            });

            var adet = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER");

            adimlar.Add(new { adim = "Personel kayıt sayısı", sonuc = adet.ToString() });

            /* Asıl sorgunun kendisi de denenir */
            try
            {
                var ornek = db.Query<PersonelKaydi>(@"
SELECT TOP 5
    P.per_kod AS PersonelKodu, P.per_adi AS Ad, P.per_soyadi AS Soyad,
    PIG.ig_adi AS IsGrubu, PUT.un_aciklama AS Pozisyon,
    P.per_giris_tar AS GirisTarihi, P.per_cikis_tar AS CikisTarihi
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    INNER JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod").ToList();

                adimlar.Add(new
                {
                    adim = "Örnek sorgu",
                    sonuc = $"{ornek.Count} satır okundu" +
                            (ornek.Count > 0
                                ? $" · ilk kayıt: {ornek[0].Ad} {ornek[0].Soyad} / " +
                                  $"{ornek[0].IsGrubu} / {ornek[0].Pozisyon}"
                                : "")
                });
            }
            catch (Exception sorguHatasi)
            {
                adimlar.Add(new
                {
                    adim = "Örnek sorgu HATASI",
                    sonuc = HataAyrintisi(sorguHatasi)
                });

                return Ok(new { basarili = false, adimlar });
            }

            return Ok(new { basarili = true, adimlar });
        }
        catch (Exception hata)
        {
            adimlar.Add(new { adim = "HATA", sonuc = HataAyrintisi(hata) });
            return Ok(new { basarili = false, adimlar });
        }
    }

    /* ==================================================================== */
    /* Birim ve pozisyon eşleştirme                                          */
    /* ==================================================================== */

    /// <summary>Türkçe karşılaştırma için metni sadeleştirir</summary>
    private static string Sadelestir(string metin) =>
        PersonelKaynagiServisi.Sadelestir(metin);

    /// <summary>"Sefaköy Şubesi" ile "SEFAKÖY" eşleşsin diye ekleri atar</summary>
    private static string BirimAnahtari(string metin) =>
        PersonelKaynagiServisi.BirimAnahtari(metin);

    /// <summary>Meslek adındaki çalışma biçimi eklerini ayıklar</summary>
    private static string MeslekAnahtari(string metin) =>
        PersonelKaynagiServisi.MeslekAnahtari(metin);

    /// <summary>
    /// Ünvan karşılaştırması. Yalnızca aynı pozisyonlar eşleşir.
    ///
    /// Burada gevşek kural kullanılamaz: "Kasa Şefi" ile "Manav Şefi"
    /// ortak "Şefi" kelimesi yüzünden birbirine karışırdı. Bu yüzden
    /// çalışma biçimi ekleri ayıklandıktan sonra kelimelerin tamamının
    /// aynı olması aranır.
    /// </summary>
    private static bool UnvanBenziyor(string birinci, string ikinci) =>
        PersonelKaynagiServisi.UnvanBenziyor(birinci, ikinci);

    /// <summary>
    /// Birim adı karşılaştırması. Birim adlarında ek sözcükler bulunabildiği
    /// için ("Genel Müdürlük" ile "GENEL MÜDÜRLÜK BÜRO") daha esnek çalışır.
    /// </summary>
    private static bool Benziyor(string birinci, string ikinci) =>
        PersonelKaynagiServisi.Benziyor(birinci, ikinci);

    /// <summary>
    /// Belirli bir birimde, belirli pozisyondaki personeli listeler.
    /// Norm kadro ekranında bir pozisyona tıklandığında kullanılır.
    /// </summary>
    [HttpGet("Birim")]
    public IActionResult Birim(
        [FromQuery] string sube,
        [FromQuery] string pozisyon = null,
        [FromQuery] bool ayrilanlar = false)
    {
        if (string.IsNullOrWhiteSpace(sube))
            return BadRequest(new { hata = "Birim bilgisi gereklidir." });

        List<PersonelKaydi> tumu;

        try
        {
            tumu = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Birim personeli alınamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        var subeAnahtari = BirimAnahtari(sube);
        var personelAyar = _ayar.PersonelOku();
        var formAyar = _ayar.FormOku();

        /* Elle tanımlanmış eşleştirmeler önceliklidir. Kaynak iş grubu bir
           birime bağlanmışsa ad benzerliğine bakılmaz. */
        bool BirimUyuyor(string isGrubu)
        {
            var esleme = personelAyar.IsGrubuEslemeleri
                .FirstOrDefault(e => Benziyor(BirimAnahtari(e.Kaynak), BirimAnahtari(isGrubu)));

            if (esleme is not null)
            {
                var hedefBirim = (formAyar.Subeler ?? new List<Sube>())
                    .FirstOrDefault(x =>
                        string.Equals(x.Kod, esleme.Hedef, StringComparison.OrdinalIgnoreCase));

                var hedefAd = hedefBirim?.Ad ?? esleme.Hedef;

                return Benziyor(BirimAnahtari(hedefAd), subeAnahtari)
                    || string.Equals(esleme.Hedef, sube, StringComparison.OrdinalIgnoreCase);
            }

            return Benziyor(BirimAnahtari(isGrubu), subeAnahtari);
        }

        bool UnvanUyuyor(string unvan, string istenen)
        {
            /* Eşleştirme araması çalışma biçimi ekini de gözetir; aksi
               hâlde düz "KASİYER", "KASİYER PART" kuralına takılırdı. */
            var karsilik = PersonelKaynagiServisi.UnvanKarsiligi(personelAyar, unvan);

            if (!UnvanBenziyor(MeslekAnahtari(karsilik), MeslekAnahtari(istenen)))
                return false;

            /* 'Part time Kasiyer' istendiğinde düz 'KASİYER' listelenmemeli,
               "KASİYER PART" listelenmeli. Norm kadro sayımı da
               (HavuzController) aynı kuralı uygular. */
            return PersonelKaynagiServisi.CalismaBicimiIceriyor(karsilik)
                == PersonelKaynagiServisi.CalismaBicimiIceriyor(istenen);
        }

        var liste = tumu.Where(x => BirimUyuyor(x.IsGrubu)).ToList();

        if (!string.IsNullOrWhiteSpace(pozisyon))
        {
            liste = liste.Where(x => UnvanUyuyor(x.Pozisyon, pozisyon)).ToList();
        }

        if (!ayrilanlar)
            liste = liste.Where(x => x.Durum == 1).ToList();

        /* Eşleşme tutmazsa kullanıcı elle seçebilsin diye kaynaktaki
           iş grubu ve ünvan adları da gönderilir. */
        var isGruplari = tumu
            .Select(x => x.IsGrubu)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var unvanlar = tumu
            .Where(x => BirimUyuyor(x.IsGrubu))
            .Select(x => x.Pozisyon)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new
        {
            sube,
            pozisyon,
            toplam = liste.Count,
            calisan = liste.Count(x => x.Durum == 1),
            /// Birim eşleşti mi? Eşleşmediyse arayüzde uyarı gösterilir
            birimEslesti = tumu.Any(x => BirimUyuyor(x.IsGrubu)),
            isGruplari,
            unvanlar,
            personeller = liste
                .OrderByDescending(x => x.Durum)
                .ThenBy(x => x.Ad)
                .ToList()
        });
    }

    /* ==================================================================== */
    /* Personel detayı                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Bir personelin ayrıntıları: çalışma geçmişi, çıkış sebebi ve fotoğrafı.
    /// Fotoğraf, kartlara yüklenen görselleri tutan mye_ImageData tablosundan
    /// per_Guid ile eşleştirilerek alınır.
    /// </summary>
    /// <summary>
    /// Çıkış tarihi ileri bir güne yazılmış personel.
    ///
    /// <para>
    /// İhbar süresi başlayan personel Mikro'da çıkış tarihi dolduğu anda
    /// "ayrılmış" sayılıp listelerden düşüyordu. Oysa çıkış gününe kadar
    /// çalışıyor, norm kadroda yeri duruyor ve yerine alım planlanması
    /// gerekiyor. Bu uç aradaki kümeyi veriyor.
    /// </para>
    /// </summary>
    [HttpGet("Ayrilacaklar")]
    public IActionResult Ayrilacaklar()
    {
        /* Kimlik ve ücret gibi alanlar dönmüyor; ad, birim ve tarih
           bölge müdürünün de görmesinde sakınca olmayan bilgiler. */
        var liste = _ayrilacak.Listele();

        return Ok(new
        {
            toplam = liste.Count,

            /* Bu hafta çıkacaklar ayrıca veriliyor: norm raporunun üst
               şeridi "acil ilgilenilmesi gerekenler" olarak bunu gösteriyor. */
            buHafta = liste.Count(x => x.KalanGun <= 7),

            personeller = liste
        });
    }

    [HttpGet("Detay")]
    public IActionResult Detay([FromQuery] string kod, [FromServices] KidemBordroServisi kidemBordro)
    {
        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        List<PersonelKaydi> tumu;

        try
        {
            tumu = PersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Personel detayı alınamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        var kisi = tumu.FirstOrDefault(x =>
            string.Equals(x.PersonelKodu?.Trim(), kod.Trim(), StringComparison.OrdinalIgnoreCase));

        if (kisi is null)
            return NotFound(new { hata = "Personel bulunamadı." });

        /* GYRSM / RSM (09.10.2026): kart GYRSM'den (2004BICEN) okunuyor;
           kişinin RSM'de (MikroDesktop_BICEN) kaydı yoksa kartta uyarı
           çıkıyor. RSM yalnızca okunur. Kimlik maskelenmeden önce. */
        object rsm = null;

        if (Roller.IslemYetkisi(Rol))
        {
            try
            {
                rsm = HttpContext?.RequestServices.GetService<MikroSicilServisi>()?.RsmDurumu(kisi.KimlikNo, kisi.PersonelKodu);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "RSM durumu okunamadı");
            }
        }

        /* İşe giriş evrak özeti (03.10.2026): takibi açık personelde eksik
           kalan evraklar kartın üstünde uyarı olarak görünüyor. Kimlik
           maskelenmeden önce okunuyor. */
        object iseGirisEvrak = null;

        if (Roller.IslemYetkisi(Rol) && IseGirisEvrakServisi.Kimlik(kisi.KimlikNo) is { } evrakKimlik)
        {
            try
            {
                var evrakServisi = HttpContext?.RequestServices.GetService<IseGirisEvrakServisi>();

                if (evrakServisi is not null)
                {
                    using var evrakDb = _vt.Baglanti();

                    var takipId = evrakServisi.KimlikTakibi(evrakDb, evrakKimlik);

                    if (takipId is not null)
                        iseGirisEvrak = ((dynamic)evrakServisi.Durum(evrakDb, takipId)).ozet;
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İşe giriş evrak özeti okunamadı");
            }
        }

        /* Rol bazlı maskeleme. Liste ucunda uygulanıyordu ama personel
           kartında atlanmıştı: bölge müdürü listede maskeli gördüğü
           kimlik numarasını karta girince açık görüyordu. */
        AlanlariSinirla(new[] { kisi });

        /* Aynı kimlik numarasına ait tüm çalışma dönemleri */
        var gecmis = string.IsNullOrWhiteSpace(kisi.KimlikNo)
            ? new List<PersonelKaydi> { kisi }
            : tumu
                .Where(x => string.Equals(x.KimlikNo?.Trim(), kisi.KimlikNo.Trim(),
                    StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(x => x.GirisTarihi ?? DateTime.MinValue)
                .ToList();

        /* Fotoğraf: mye_ImageData tablosundaki ilk ikili veri alanı okunur */
        string resim = null;

        if (kisi.Guid is not null)
        {
            try
            {
                using var db = _vt.PersonelBaglantisi();

                var satir = db.QueryFirstOrDefault(@"
SELECT TOP 1 * FROM [MikroDesktop_2004BICEN].dbo.mye_ImageData
WHERE Record_uid = @guid", new { guid = kisi.Guid });

                if (satir is not null)
                {
                    foreach (var alan in (IDictionary<string, object>)satir)
                    {
                        if (alan.Value is byte[] veri && veri.Length > 100)
                        {
                            resim = $"data:image/jpeg;base64,{Convert.ToBase64String(veri)}";
                            break;
                        }
                    }
                }
            }
            catch (Exception hata)
            {
                // Fotoğraf okunamazsa diğer bilgiler yine gösterilir
                _kayit.LogWarning(hata, "Personel fotoğrafı okunamadı");
            }
        }

        /* Personel kartından gösterilecek alanlar okunur.
           Kolon adları sürümlere göre değiştiği için tablo olduğu gibi
           okunup istenen alanlar desenle seçilir. */
        var ekBilgiler = new List<KartBilgisi>();

        try
        {
            using var db = _vt.PersonelBaglantisi();

            var kart = db.QueryFirstOrDefault(@"
SELECT TOP 1 * FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @kod", new { kod = kod.Trim() });

            if (kart is not null)
            {
                /* Yalnızca gösterilmesi istenen alanlar; kolon adları
                   sürümlere göre değişebildiği için desenle eşleştirilir. */
                foreach (var alan in (IDictionary<string, object>)kart)
                {
                    var etiket = KartAlani(alan.Key);
                    if (etiket is null) continue;
                    if (alan.Value is null or byte[] or Guid) continue;

                    var metin = alan.Value switch
                    {
                        DateTime t => t.Year > 1900 ? t.ToString("dd.MM.yyyy") : "",
                        bool b => b ? "Evet" : "Hayır",
                        _ => alan.Value.ToString()?.Trim() ?? ""
                    };

                    if (string.IsNullOrWhiteSpace(metin) || metin == "0") continue;

                    ekBilgiler.Add(new KartBilgisi
                    {
                        Alan = etiket,
                        Deger = metin,
                        Sira = KartSirasi(etiket)
                    });
                }

                /* Adres kolonları tek satırda birleştirilir */
                var adres = AdresBirlestir((IDictionary<string, object>)kart);

                if (!string.IsNullOrWhiteSpace(adres))
                {
                    ekBilgiler.Add(new KartBilgisi
                    {
                        Alan = "Adres",
                        Deger = adres,
                        Sira = KartSirasi("Adres")
                    });
                }

                ekBilgiler = ekBilgiler.OrderBy(x => x.Sira).ToList();
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel kart bilgileri okunamadı");
        }

        /* Ücret, pozisyonun maaş skalasıyla karşılaştırılır */
        object skalaBilgisi = null;

        var skala = (_ayar.MaasOku().Skalalar ?? new List<MaasSkalasi>())
            .FirstOrDefault(x => UnvanBenziyor(MeslekAnahtari(x.Bolum),
                                               MeslekAnahtari(kisi.Pozisyon)));

        if (skala is not null && kisi.Ucret is > 0)
        {
            var durum = "icinde";

            if (skala.UstSinir > 0 && kisi.Ucret > skala.UstSinir) durum = "ust";
            else if (skala.AltSinir > 0 && kisi.Ucret < skala.AltSinir) durum = "alt";

            skalaBilgisi = new
            {
                skala.Bolum,
                skala.AltSinir,
                skala.UstSinir,
                durum
            };
        }

        /* QR geçiş durumu; sistem kapalıysa null döner ve bölüm
           panelde hiç gösterilmez. */
        var gecisDurumu = GecisOzeti(kisi?.KimlikNo, kisi?.PersonelKodu);

        /* Fotoğraf görevlisi yalnızca ad soyad, telefon ve fotoğrafı görür.
           Diğer bölümler yanıta hiç konmaz. */
        if (YalnizcaFotograf)
        {
            AlanlariSinirla(new[] { kisi });

            return Ok(new
            {
                kisi,
                resim,
                skala = (object)null,
                calismaSayisi = 0,
                toplamGun = 0,
                gecmis = new List<object>(),
                ekBilgiler = new List<object>(),
                gecis = (object)null
            });
        }

        /* Başvuru sürecinde İK'nın yazdığı notlar.

           Kişi işe alındıktan sonra da bu notlar değerli: görüşmede ne
           konuşulduğu, hangi şartlarla anlaşıldığı orada yazıyor ve
           personel kartından ulaşılamıyordu. Kimlik numarasıyla eşleştirilir. */
        var basvuruNotlari = new List<object>();

        try
        {
            if (!string.IsNullOrWhiteSpace(kisi.KimlikNo))
            {
                using var notDb = _vt.Baglanti();

                basvuruNotlari = notDb.Query(@"
SELECT n.metin, n.ad_soyad AS adSoyad, n.tarih,
       b.basvuru_no AS basvuruNo, b.id AS basvuruId,
       b.olusturma AS basvuruTarihi
FROM KRY_BASVURU_NOT n
JOIN KRY_BASVURULAR b ON b.id = n.basvuru_id
WHERE b.kimlik_no = @kimlik
ORDER BY n.tarih DESC",
                    new { kimlik = kisi.KimlikNo.Trim() })
                    .Cast<object>()
                    .ToList();
            }
        }
        catch (Exception hata)
        {
            /* Not okunamazsa kartın geri kalanı yine açılmalı */
            _kayit.LogWarning(hata, "Başvuru notları okunamadı");
        }

        /* Çıkış tarihi ileri bir güne yazılmışsa kişi hâlâ çalışıyor ama
           ayrılığı planlanmış demektir. Kartta uyarı olarak gösteriliyor:
           çıkış tarihi ek bilgiler arasında bir satır olarak duruyordu ve
           gözden kaçıyordu. */
        object ayrilacak = null;

        if (kisi.CikisTarihi is DateTime cikis && cikis.Date > DateTime.Today)
            ayrilacak = new
            {
                cikisTarihi = cikis.Date,
                kalanGun = (cikis.Date - DateTime.Today).Days
            };

        /* Kıdem (05.10.2026): bordrodaki bütün girişler (aynı T.C. ile
           açılmış kartlar). Mikro personel kartı yalnızca son girişi
           biliyor; ayrılıp dönen personelde kıdem bunlardan. Bordroya
           ulaşılamazsa kart yine açılır, dönemler gösterilmez. */
        object kidem = null;

        try
        {
            var h = kidemBordro.KisiHesabi(kisi);

            kidem = new
            {
                tarih = kisi.KidemTarihi,
                gun = kisi.KidemGunu,
                kaynak = kisi.KidemKaynak,
                ilkGiris = h?.IlkGiris,
                bosGun = h?.BosGun ?? 0,
                donemler = h?.Donemler.Select(d => new { kod = d.Kod, giris = d.Giris, cikis = d.Cikis }),
                aralar = h?.Aralar.Select(a => new { ayrilis = a.Ayrilis, donus = a.Donus, gun = a.Gun }),
            };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kıdem dönemleri bordrodan okunamadı: {Kod}", kod);

            kidem = new { tarih = kisi.KidemTarihi, gun = kisi.KidemGunu, kaynak = kisi.KidemKaynak };
        }

        /* Yıllık izin hak yüklemeleri (otomatik, yıl dönümünde) ve sonraki yıl dönümü */
        object izinHak = null;

        try
        {
            izinHak = HttpContext.RequestServices.GetRequiredService<IzinHakYuklemeServisi>().Durum(kisi);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin hak yüklemeleri okunamadı: {Kod}", kod);
        }

        return Ok(new
        {
            kisi,
            resim,
            skala = skalaBilgisi,
            kidem,
            izinHak,
            calismaSayisi = gecmis.Select(x => x.PersonelKodu).Distinct().Count(),
            toplamGun = gecmis.Sum(x => x.CalismaGunu),
            gecmis,
            ekBilgiler,
            gecis = gecisDurumu,
            ayrilacak,
            /* Takibi açık personelde işe giriş evrak özeti; yoksa null */
            iseGirisEvrak,
            /* GYRSM'de mevcut (kart buradan); RSM durumu, yetkisizde null */
            rsm,
            basvuruNotlari,

            /* Personel kartındaki "Düzenle" düğmesi (02.10.2026). Rol
               özel olsa da temeline bakılır; asıl denetim yazma ucunda. */
            duzenlenebilir = PersonelMikroController.Duzenleyebilir(Rol, _yetki),

            /* Yol ücreti kartta gösterilir; ücret gizli rolde boş */
            yolUcreti = YolUcretleri(new List<PersonelKaydi> { kisi })
                .TryGetValue((kisi.PersonelKodu ?? "").Trim(), out var yolTutari)
                ? yolTutari
                : (decimal?)null
        });
    }

    /// <summary>
    /// Tek bir personelin fotoğrafını görsel olarak döndürür.
    ///
    /// Liste ekranlarında her satır kendi görselini ister; böylece sayfa
    /// beklemeden açılır ve tarayıcı görselleri önbelleğe alır.
    /// Görsel etiketleri başlık gönderemediği için belirteç adres satırından
    /// da kabul edilir (Program.cs içinde tanımlıdır).
    /// </summary>
    [HttpGet("Resim")]
    public IActionResult Resim([FromQuery] string kod)
    {
        var veri = ResimBaytlari(_vt, kod, _kayit);

        if (veri is null) return NotFound();

        /* Aynı görsel tekrar istenmesin diye bir gün önbelleklenir */
        Response.Headers["Cache-Control"] = "private, max-age=86400";
        return File(veri, "image/jpeg");
    }

    /// <summary>
    /// Personelin Mikro'daki fotoğrafı (yoksa ya da okunamazsa null).
    /// Biçen360 patron görünümü de aynı fotoğrafı buradan alıyor
    /// (03.10.2026); iki ayrı sorgu zamanla ayrışmasın.
    /// </summary>
    public static byte[] ResimBaytlari(VeritabaniServisi vt, string kod, ILogger kayit)
    {
        if (string.IsNullOrWhiteSpace(kod)) return null;

        try
        {
            using var db = vt.PersonelBaglantisi();

            var satir = db.QueryFirstOrDefault(@"
SELECT TOP 1 I.*
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
JOIN [MikroDesktop_2004BICEN].dbo.mye_ImageData I ON I.Record_uid = P.per_Guid
WHERE LTRIM(RTRIM(P.per_kod)) = @kod", new { kod = kod.Trim() });

            if (satir is null) return null;

            foreach (var alan in (IDictionary<string, object>)satir)
            {
                if (alan.Value is byte[] veri && veri.Length > 100) return veri;
            }
        }
        catch (Exception hata)
        {
            kayit?.LogWarning(hata, "Personel fotoğrafı okunamadı: {Kod}", kod);
        }

        return null;
    }

    /// <summary>Personel kartında gösterilen tek bir bilgi satırı</summary>
    private class KartBilgisi
    {
        public string Alan { get; set; }
        public string Deger { get; set; }
        public int Sira { get; set; }
    }

    /// <summary>
    /// Personel kartında gösterilecek alanlar. Listede olmayan kolonlar
    /// gösterilmez; böylece ekran yalnızca işe yarar bilgiyi taşır.
    /// </summary>
    private static string KartAlani(string ad)
    {
        var kucuk = ad.ToLowerInvariant();

        if (kucuk.Contains("giris_tar")) return "İşe Giriş";
        if (kucuk.Contains("dogum") && kucuk.Contains("tar")) return "Doğum Tarihi";
        if (kucuk.Contains("meslek")) return "Meslek";
        if (kucuk.Contains("yemekkarti")) return "Yemek Kartı";

        return null;
    }

    /// <summary>
    /// Adres parçalarını tek satırda birleştirir.
    ///
    /// Mikro'da adres on ayrı kolona bölünmüştür; hepsini ayrı satır olarak
    /// göstermek kartı okunmaz hâle getirir. Bu yüzden mahalle, cadde, sokak,
    /// bina ve daire bilgisi tek bir okunabilir metne dönüştürülür.
    /// </summary>
    private static string AdresBirlestir(IDictionary<string, object> kart)
    {
        string Al(string kolon)
        {
            foreach (var alan in kart)
            {
                if (!string.Equals(alan.Key, kolon, StringComparison.OrdinalIgnoreCase))
                    continue;

                var deger = alan.Value?.ToString()?.Trim() ?? "";

                return deger == "0" ? "" : deger;
            }

            return "";
        }

        var parcalar = new List<string>();

        void Ekle(string deger, string sonEk = "")
        {
            if (string.IsNullOrWhiteSpace(deger)) return;

            var temiz = deger.Trim();

            /* Kullanıcı zaten 'Mah.' yazdıysa tekrar eklenmez */
            if (sonEk.Length > 0 &&
                !temiz.EndsWith(sonEk, StringComparison.OrdinalIgnoreCase) &&
                !temiz.Contains(sonEk, StringComparison.OrdinalIgnoreCase))
            {
                temiz = $"{temiz} {sonEk}";
            }

            parcalar.Add(temiz);
        }

        Ekle(Al("per_adr_mahalle"), "Mah.");
        Ekle(Al("per_adr_cadde"), "Cad.");
        Ekle(Al("per_adr_sokak"), "Sok.");

        var bina = Al("per_adr_apartman_no");
        var daire = Al("per_adr_daire_no");

        if (!string.IsNullOrWhiteSpace(bina))
            parcalar.Add($"No: {bina}" + (string.IsNullOrWhiteSpace(daire) ? "" : $"/{daire}"));
        else if (!string.IsNullOrWhiteSpace(daire))
            parcalar.Add($"Daire: {daire}");

        Ekle(Al("per_adr_semt"));

        var ilce = Al("per_adr_ilce");
        var il = Al("per_adr_il");

        if (!string.IsNullOrWhiteSpace(ilce) && !string.IsNullOrWhiteSpace(il))
            parcalar.Add($"{ilce} / {il}");
        else
        {
            Ekle(ilce);
            Ekle(il);
        }

        /* Ülke yalnızca Türkiye dışıysa gösterilir */
        var ulke = Al("per_adr_ulke");

        if (!string.IsNullOrWhiteSpace(ulke) &&
            !ulke.Contains("türk", StringComparison.OrdinalIgnoreCase) &&
            !ulke.Contains("turk", StringComparison.OrdinalIgnoreCase))
        {
            parcalar.Add(ulke);
        }

        return string.Join(", ", parcalar);
    }

    /// <summary>Kart alanlarının gösterim sırası</summary>
    private static int KartSirasi(string etiket) => etiket switch
    {
        "İşe Giriş" => 1,
        "Doğum Tarihi" => 2,
        "Meslek" => 3,
        "Yemek Kartı" => 4,
        "Adres" => 8,
        _ => 9
    };

    /// <summary>
    /// Sağ üstteki bölge seçimine göre personeli süzer.
    ///
    /// Mikro kayıtlarında şube kodu yerine iş grubu adı bulunduğu için
    /// eşleştirme birim adı üzerinden yapılır. Seçim yoksa liste olduğu
    /// gibi döner.
    /// </summary>
    private List<PersonelKaydi> BolgeyeGoreSuz(List<PersonelKaydi> liste)
    {
        var rol = User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

        if (!Roller.BolgeSecici(rol)) return liste;

        var secim = Request.Headers["X-Bolge"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(secim)) return liste;

        var bolgeAdlari = secim
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => Uri.UnescapeDataString(x.Trim()))
            .Where(x => x.Length > 0)
            .ToArray();

        if (bolgeAdlari.Length == 0) return liste;

        var ayar = _ayar.FormOku();

        /* Seçilen bölgelerdeki şubelerin adları */
        var subeKodlari = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => bolgeAdlari.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var subeAdlari = subeKodlari
            .Select(k => (ayar.Subeler ?? new List<Sube>())
                .FirstOrDefault(x => string.Equals(x.Kod, k,
                    StringComparison.OrdinalIgnoreCase))?.Ad ?? k)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();

        if (subeAdlari.Count == 0) return new List<PersonelKaydi>();

        return liste
            .Where(x => subeAdlari.Any(ad =>
                Benziyor(BirimAnahtari(ad), BirimAnahtari(x.IsGrubu))))
            .ToList();
    }

    /* ==================================================================== */
    /* QR geçiş hareketleri                                              */
    /* ==================================================================== */

    /// <summary>
    /// Geçiş sistemindeki kişi listesi. Personel eşleştirmesi bu tablodan
    /// yapılır; hangi alanın eşleşme anahtarı olduğunu görmek için kullanılır.
    /// </summary>
    [HttpGet("GecisKisileri")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult GecisKisileri([FromQuery] string ara = null)
    {
        try
        {
            using var db = _vt.GecisBaglantisi();

            /* Persons tablosunun kolonları kuruluma göre değişebilir;
               tamamı döndürülür ki eşleştirme alanı belirlenebilsin. */
            var liste = db.Query(@"
SELECT TOP 20 *
FROM Persons
WHERE @ara IS NULL OR @ara = ''
   OR CAST(PersonId AS NVARCHAR(20)) = @ara",
                new { ara }).ToList();

            return Ok(new { adet = liste.Count, kayitlar = liste });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Geçiş kişileri alınamadı");

            return StatusCode(502, new
            {
                hata = "Geçiş veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }
    }

    /// <summary>
    /// Günlük geçiş raporu: mağaza bazında kim okutmuş, kim okutmamış.
    ///
    /// Çalışan personelin tamamı listelenir; geçiş kaydı olmayanlar ayrıca
    /// işaretlenir. Kartını unutan, izinli olan ya da okutmayı atlayan
    /// personel böylece görünür olur.
    /// </summary>
    [HttpGet("GecisRaporu")]
    public IActionResult GecisRaporu(
        [FromQuery] DateTime? gun,
        [FromQuery] string bolgeler = null)
    {
        var tarih = (gun ?? DateTime.Today).Date;

        var bolgeDizi = string.IsNullOrWhiteSpace(bolgeler)
            ? null
            : bolgeler.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim()).ToArray();

        /* Bu uçta personel listesi zaten PersonelleriGetir() içinde bölge
           müdürünün şubeleriyle sınırlanıyor. Buradaki denetim yalnızca
           şubesi tanımsız hesabı yakalıyor: aksi hâlde rapor boş çıkıyor
           ve sebebi anlaşılmıyordu. */
        if (Rol == Roller.BolgeMuduru)
        {
            if (YetkiliSubeler().Length == 0)
                return BadRequest(new
                {
                    hata = "Hesabınıza şube tanımlanmamış.",
                    ayrinti = "İnsan Kaynakları ile görüşünüz."
                });

            /* Bölge müdüründe bölge seçicisi yok; istemciden gelen bölge
               süzgeci uygulanmaz. */
            bolgeDizi = null;
        }

        List<PersonelKaydi> personeller;

        try
        {
            personeller = BolgeyeGoreSuz(PersonelleriGetir())
                .Where(x => x.Durum == 1)
                .ToList();

            /* Ekrandan seçilen bölgeler */
            if (bolgeDizi is { Length: > 0 })
            {
                var ayar = _ayar.FormOku();

                var adlar = (ayar.Bolgeler ?? new List<BolgeTanimi>())
                    .Where(b => bolgeDizi.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
                    .SelectMany(b => b.Subeler ?? new List<string>())
                    .Select(k => (ayar.Subeler ?? new List<Sube>())
                        .FirstOrDefault(x => string.Equals(x.Kod, k,
                            StringComparison.OrdinalIgnoreCase))?.Ad ?? k)
                    .ToList();

                personeller = personeller
                    .Where(x => adlar.Any(ad =>
                        Benziyor(BirimAnahtari(ad), BirimAnahtari(x.IsGrubu))))
                    .ToList();
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Geçiş raporu için personel alınamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        /* O güne ait tüm hareketler tek sorguda alınır: iCard (kimlik
           numarasıyla) ve Biçen360 uygulaması (sicil ile). */
        Dictionary<string, List<(DateTime Zaman, string Yon, string Kaynak)>> hareketler;
        var icardHata = false;

        try
        {
            using var db = _vt.GecisBaglantisi();

            var satirlar = db.Query(@"
SELECT LTRIM(RTRIM(p.RegistrationNumber)) AS kimlik,
       t.TransitionDateTime AS zaman,
       CAST(t.Direction AS NVARCHAR(20)) AS yon
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) = @tarih
  AND p.RegistrationNumber IS NOT NULL",
                new { tarih }, commandTimeout: 90).ToList();

            hareketler = satirlar
                .Select(x => new
                {
                    kimlik = new string(((string)x.kimlik ?? "")
                        .Where(char.IsDigit).ToArray()),
                    x.zaman,
                    x.yon
                })
                .Where(x => x.kimlik.Length > 0)
                .GroupBy(x => x.kimlik)
                .ToDictionary(
                    g => g.Key,
                    g => g.Select(x => ((DateTime)x.zaman, (string)x.yon, MobilOkutmaKaynagi.ICard)).ToList());
        }
        catch (Exception hata)
        {
            /* iCard kapalıysa rapor uygulama okutmalarıyla devam eder */
            _kayit.LogWarning(hata, "Geçiş raporu için iCard verisi alınamadı");
            hareketler = new();
            icardHata = true;
        }

        /* 26.10.2026: gün resmî tatil mi (KRY_RESMI_TATIL); tatilde okutana rozet */
        (string ad, bool yarim)? resmiTatil = null;
        try
        {
            using var tdb = _vt.Baglanti();
            var t = tdb.QueryFirstOrDefault("SELECT TOP 1 ad, yarim_gun AS yarim FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih = @tarih", new { tarih });
            if (t is not null) resmiTatil = ((string)t.ad, (bool)t.yarim);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Resmî tatil okunamadı");
        }

        /* 26.10.2026: o gün onaylanmış (İK) fazla mesailer, kişi başına */
        var fazlaMesai = new Dictionary<string, List<(string bas, string bit, int dk)>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var fdb = _vt.Baglanti();
            foreach (var f in fdb.Query("SELECT personel_kodu AS kod, baslangic, bitis, sure_dk AS dk FROM KRY_FAZLA_MESAI WHERE tarih = @tarih AND durum = N'onaylandi' ORDER BY baslangic", new { tarih }))
            {
                var k = ((string)f.kod ?? "").Trim().TrimStart('0');
                if (!fazlaMesai.TryGetValue(k, out var l)) fazlaMesai[k] = l = new();
                l.Add(((string)f.baslangic, (string)f.bitis, (int)f.dk));
            }
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Onaylı fazla mesailer okunamadı");
        }

        /* 26.10.2026: o gün onaylı görevlendirmede olanlar (okutmasa da devamsız değil) */
        Dictionary<string, string> gorevdekiler;
        using (var gdb = _vt.Baglanti()) gorevdekiler = GorevlendirmeServisi.Gorevdekiler(gdb, tarih, tarih);

        var mobilHareketler = MobilOkutmaKaynagi.Aralik(_vt, tarih, tarih, kayit: _kayit)
            .GroupBy(x => x.PersonelKodu, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.Select(x => (x.Zaman, x.Tur, x.Kaynak)).ToList(),
                StringComparer.OrdinalIgnoreCase);

        /* Okutmadan muaf personel (Okutma Kuralları): okutmadıysa
           "Okutmadı" değil "Muaf" görünür ve okutmayan sayısına girmez. */
        var muafKodlar = OkutmaKurallari.MuafKodlari(_vt, tarih, tarih);

        /* Raporlu personel (personel kartındaki raporlar ve rapor izinleri):
           okutmadıysa "Okutmadı" değil "Raporlu" görünür, okutmayan
           sayısına girmez. */
        var raporluKodlar = new RaporluServisi(_vt).Kodlar(tarih);

        /* O gün izinli olanlar (haftalık izin günü, vardiya planındaki izin,
           resmî tatil): günlük okutma maili ve patron görünümü bunları
           beklenenlerden çıkarıyor (OkutmaVeriHazirlayici.IzinliOlmayanlar).
           Bu ekran saymadığı için aynı gün için oran mailden düşük çıkıyordu
           (03.10.2026). Okutmadıysa "İzinli" görünür, okutmayana girmez. */
        var beklenenKodlar = new OkutmaVeriHazirlayici(_vt, _ayar)
            .IzinliOlmayanlar(personeller, tarih, tarih)
            .Select(x => (x.PersonelKodu ?? "").Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool IzinliMi(PersonelKaydi k) =>
            !beklenenKodlar.Contains((k.PersonelKodu ?? "").Trim());

        /* Okutmayanın o günkü sebebi (09.10.2026): "İzinli" yerine
           "Haftalık izin", "Yıllık izin", "Raporlu", "Resmî tatil"… */
        Dictionary<string, string> gunNedenleri;
        try { gunNedenleri = new GunNedenServisi(_vt).Gun(personeller, tarih); }
        catch { gunNedenleri = new Dictionary<string, string>(); }

        /* Muaf, raporlu ya da izinli kişi okutma beklenenlere girmez;
           oran mail raporundaki gibi beklenenler üzerinden hesaplanır. */
        bool BeklenmiyorMu(PersonelKaydi k) =>
            muafKodlar.Contains(OkutmaKurallari.Anahtar(k.PersonelKodu))
            || raporluKodlar.Contains(RaporluServisi.Anahtar(k.PersonelKodu))
            || IzinliMi(k);

        /* Mağaza bazında gruplanır */
        var birimler = personeller
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "TANIMSIZ" : x.IsGrubu)
            .Select(g =>
            {
                var kisiler = g.Select(kisi =>
                {
                    /* Eşleştirme Persons.RegistrationNumber ile T.C. kimlik
                       numarası arasında yapılır. Biçim farkı eşleşmeyi
                       bozmasın diye iki taraf da rakamlara indirgenir. */
                    var kimlik = new string((kisi.KimlikNo ?? "")
                        .Where(char.IsDigit).ToArray());

                    var kendi = new List<(DateTime Zaman, string Yon, string Kaynak)>();

                    if (kimlik.Length == 11 && hareketler.TryGetValue(kimlik, out var kart))
                        kendi.AddRange(kart);

                    if (mobilHareketler.TryGetValue((kisi.PersonelKodu ?? "").Trim(), out var mobil))
                        kendi.AddRange(mobil);

                    kendi = kendi.OrderBy(x => x.Zaman).ToList();

                    var girisler = (kendi ?? new())
                        .Where(x => GirisMi(x.Yon))
                        .Select(x => x.Zaman)
                        .ToList();

                    var cikislar = (kendi ?? new())
                        .Where(x => !GirisMi(x.Yon))
                        .Select(x => x.Zaman)
                        .ToList();

                    return new
                    {
                        kisi.PersonelKodu,
                        kisi.Ad,
                        kisi.Soyad,
                        kisi.KimlikNo,
                        kisi.Pozisyon,
                        kisi.GirisTarihi,
                        okuttuMu = kendi.Count > 0,
                        /* Resmî tatilde okutan (çalışan) */
                        tatildeOkuttu = resmiTatil is not null && kendi.Count > 0,
                        /* 26.10.2026: o gün onaylanmış fazla mesai */
                        fazlaMesai = fazlaMesai.TryGetValue((kisi.PersonelKodu ?? "").Trim().TrimStart('0'), out var fml)
                            ? fml.Select(x => new { baslangic = x.bas, bitis = x.bit, sureDk = x.dk }).ToList()
                            : null,
                        /* Onaylı görevlendirme (yer · tür) */
                        gorev = gorevdekiler.GetValueOrDefault((kisi.PersonelKodu ?? "").Trim().TrimStart('0')),
                        gorevde = kendi.Count == 0 && gorevdekiler.ContainsKey((kisi.PersonelKodu ?? "").Trim().TrimStart('0')),
                        muaf = kendi.Count == 0
                               && !raporluKodlar.Contains(RaporluServisi.Anahtar(kisi.PersonelKodu))
                               && muafKodlar.Contains(OkutmaKurallari.Anahtar(kisi.PersonelKodu)),
                        raporlu = kendi.Count == 0
                               && raporluKodlar.Contains(RaporluServisi.Anahtar(kisi.PersonelKodu)),
                        izinli = kendi.Count == 0
                               && !raporluKodlar.Contains(RaporluServisi.Anahtar(kisi.PersonelKodu))
                               && !muafKodlar.Contains(OkutmaKurallari.Anahtar(kisi.PersonelKodu))
                               && IzinliMi(kisi),
                        beklenmiyor = BeklenmiyorMu(kisi)
                                      || (kendi.Count == 0 && gorevdekiler.ContainsKey((kisi.PersonelKodu ?? "").Trim().TrimStart('0'))),
                        neden = kendi.Count > 0 ? null
                            : gorevdekiler.TryGetValue((kisi.PersonelKodu ?? "").Trim().TrimStart('0'), out var gn) ? $"Görevde · {gn}"
                            : raporluKodlar.Contains(RaporluServisi.Anahtar(kisi.PersonelKodu)) ? RaporluServisi.Etiket
                            : muafKodlar.Contains(OkutmaKurallari.Anahtar(kisi.PersonelKodu)) ? "Muaf"
                            : gunNedenleri.GetValueOrDefault(GunNedenServisi.K(kisi.PersonelKodu)),
                        hareketSayisi = kendi.Count,
                        ilkGiris = girisler.Count > 0 ? girisler.Min() : (DateTime?)null,
                        sonCikis = cikislar.Count > 0 ? cikislar.Max() : (DateTime?)null,

                        /* Okutmanın nereden yapıldığı: iCard, Biçen360, Manuel */
                        kaynaklar = kendi.Select(x => x.Kaynak).Distinct().OrderBy(x => x).ToList(),
                        hareketler = kendi.Select(x => new
                        {
                            zaman = x.Zaman,
                            giris = GirisMi(x.Yon),
                            kaynak = x.Kaynak
                        }).ToList(),

                        /* Giriş var ama çıkış yok: QR okutmadan ayrılmış olabilir */
                        eksikCikis = girisler.Count > 0 && cikislar.Count == 0
                    };
                })
                .OrderBy(x => x.okuttuMu ? 2 : x.muaf || x.raporlu || x.izinli || x.gorevde ? 1 : 0)
                .ThenBy(x => x.Ad)
                .ToList();

                /* Beklenen: muaf, raporlu ve izinli olmayanlar. Oran
                   sunucuda bu kümeyle hesaplanır (mail raporuyla aynı);
                   panel önceden okutan / tüm personel diye bölüyordu. */
                var beklenen = kisiler.Count(x => !x.beklenmiyor);
                var beklenenOkutan = kisiler.Count(x => !x.beklenmiyor && x.okuttuMu);

                return new
                {
                    birim = g.Key,
                    toplam = kisiler.Count,
                    okutan = kisiler.Count(x => x.okuttuMu),
                    okutmayan = kisiler.Count(x => !x.okuttuMu && !x.muaf && !x.raporlu && !x.izinli && !x.gorevde),
                    gorevde = kisiler.Count(x => x.gorevde),
                    muaf = kisiler.Count(x => x.muaf),
                    raporlu = kisiler.Count(x => x.raporlu),
                    izinli = kisiler.Count(x => x.izinli),
                    beklenen,
                    beklenenOkutan,
                    oran = beklenen > 0 ? (int)Math.Round(beklenenOkutan * 100.0 / beklenen) : 0,
                    eksikCikis = kisiler.Count(x => x.eksikCikis),
                    tatildeOkutan = kisiler.Count(x => x.tatildeOkuttu),
                    bicen360 = kisiler.Count(x => x.kaynaklar.Contains(MobilOkutmaKaynagi.Bicen360)),
                    icard = kisiler.Count(x => x.kaynaklar.Contains(MobilOkutmaKaynagi.ICard)),
                    kisiler
                };
            })
            .OrderByDescending(x => x.okutmayan)
            .ThenBy(x => x.birim)
            .ToList();

        return Ok(new
        {
            tarih,
            resmiTatil = resmiTatil is null ? null : new { ad = resmiTatil.Value.ad, yarimGun = resmiTatil.Value.yarim },
            tatildeOkutan = birimler.Sum(x => x.tatildeOkutan),
            toplam = birimler.Sum(x => x.toplam),
            okutan = birimler.Sum(x => x.okutan),
            okutmayan = birimler.Sum(x => x.okutmayan),
            muaf = birimler.Sum(x => x.muaf),
            raporlu = birimler.Sum(x => x.raporlu),
            izinli = birimler.Sum(x => x.izinli),
            beklenen = birimler.Sum(x => x.beklenen),
            beklenenOkutan = birimler.Sum(x => x.beklenenOkutan),
            oran = birimler.Sum(x => x.beklenen) > 0
                ? (int)Math.Round(birimler.Sum(x => x.beklenenOkutan) * 100.0 / birimler.Sum(x => x.beklenen))
                : 0,
            hedefOran = OkutmaRaporuServisi.HedefOran,
            eksikCikis = birimler.Sum(x => x.eksikCikis),
            bicen360 = birimler.Sum(x => x.bicen360),
            icard = birimler.Sum(x => x.icard),
            icardUlasilamadi = icardHata,
            birimler
        });
    }

    /// <summary>Okutma aralığı raporu için personel arama (ad, soyad, sicil); en fazla 20 kişi.</summary>
    [HttpGet("OkutmaKisiAra")]
    public IActionResult OkutmaKisiAra([FromQuery] string q)
    {
        var a = (q ?? "").Trim();
        if (a.Length < 2) return Ok(Array.Empty<object>());

        var tr = new System.Globalization.CultureInfo("tr-TR");
        var aranan = TrSade(a);
        var sicilAra = a.TrimStart('0');

        var liste = BolgeyeGoreSuz(PersonelleriGetir())
            .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .Where(x => TrSade($"{x.Ad} {x.Soyad}").Contains(aranan)
                        || (sicilAra.Length > 0 && (x.PersonelKodu ?? "").Trim().TrimStart('0').StartsWith(sicilAra)))
            .OrderByDescending(x => x.Durum == 1)
            .ThenBy(x => x.Ad).ThenBy(x => x.Soyad)
            .Take(20)
            .Select(x => new
            {
                sicil = x.PersonelKodu,
                adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                birim = x.IsGrubu,
                pozisyon = x.Pozisyon,
                calisiyor = x.Durum == 1,
            })
            .ToList();

        return Ok(liste);
    }

    /// <summary>
    /// Tarih aralığında okutmalar (19.10.2026): Raporlar › Günlük QR okutma
    /// › Tarih aralığı. Kişi × gün satırları: o gün okuttu mu, ilk giriş,
    /// son çıkış, süre; okutmadıysa sebebi (izinli, raporlu, muaf).
    /// Süzgeçler: bölgeler, şube (iş grubu), sicil. Aralık en fazla 62 gün.
    /// Günlük rapordaki kurallarla aynı hesap; yalnızca gün gün yapılıyor.
    /// </summary>
    [HttpGet("OkutmaAraligi")]
    public IActionResult OkutmaAraligi(
        [FromQuery] DateTime bas,
        [FromQuery] DateTime bit,
        [FromQuery] string bolgeler = null,
        [FromQuery] string sube = null,
        [FromQuery] string sicil = null)
    {
        bas = bas.Date;
        bit = bit.Date;
        if (bit < bas) (bas, bit) = (bit, bas);
        if (bit > DateTime.Today) bit = DateTime.Today;
        if (bas > bit) return BadRequest(new { hata = "Başlangıç tarihi bugünden ileri olamaz." });
        if ((bit - bas).TotalDays > 61) return BadRequest(new { hata = "En fazla 62 günlük aralık seçilebilir." });

        var bolgeDizi = string.IsNullOrWhiteSpace(bolgeler)
            ? null
            : bolgeler.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()).ToArray();

        if (Rol == Roller.BolgeMuduru)
        {
            if (YetkiliSubeler().Length == 0)
                return BadRequest(new { hata = "Hesabınıza şube tanımlanmamış.", ayrinti = "İnsan Kaynakları ile görüşünüz." });
            bolgeDizi = null;
        }

        static string Sk(string s) => (s ?? "").Trim().TrimStart('0');

        List<PersonelKaydi> personeller;

        try
        {
            /* Aralıkta çalışmış olanlar: bugün çalışanlar ve aralık içinde ayrılanlar */
            personeller = BolgeyeGoreSuz(PersonelleriGetir())
                .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
                .Where(x => x.Durum == 1 || (x.CikisTarihi.HasValue && x.CikisTarihi.Value.Date >= bas))
                .Where(x => !x.GirisTarihi.HasValue || x.GirisTarihi.Value.Date <= bit)
                .ToList();

            if (bolgeDizi is { Length: > 0 })
            {
                var ayar = _ayar.FormOku();
                var adlar = (ayar.Bolgeler ?? new List<BolgeTanimi>())
                    .Where(b => bolgeDizi.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
                    .SelectMany(b => b.Subeler ?? new List<string>())
                    .Select(k => (ayar.Subeler ?? new List<Sube>())
                        .FirstOrDefault(x => string.Equals(x.Kod, k, StringComparison.OrdinalIgnoreCase))?.Ad ?? k)
                    .ToList();

                personeller = personeller
                    .Where(x => adlar.Any(ad => Benziyor(BirimAnahtari(ad), BirimAnahtari(x.IsGrubu))))
                    .ToList();
            }

            if (!string.IsNullOrWhiteSpace(sube))
                personeller = personeller
                    .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), sube.Trim(), StringComparison.OrdinalIgnoreCase))
                    .ToList();

            if (!string.IsNullOrWhiteSpace(sicil))
                personeller = personeller.Where(x => Sk(x.PersonelKodu) == Sk(sicil)).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Okutma aralığı için personel alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı.", ayrinti = HataAyrintisi(hata) });
        }

        /* Aralığın bütün hareketleri tek seferde */
        var kartHareket = new Dictionary<string, List<(DateTime Zaman, string Yon, string Kaynak)>>();
        var icardHata = false;

        try
        {
            using var db = _vt.GecisBaglantisi();
            var satirlar = db.Query(@"
SELECT LTRIM(RTRIM(p.RegistrationNumber)) AS kimlik,
       t.TransitionDateTime AS zaman,
       CAST(t.Direction AS NVARCHAR(20)) AS yon
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE t.TransitionDate >= @bas AND t.TransitionDate < @son
  AND p.RegistrationNumber IS NOT NULL",
                new { bas, son = bit.AddDays(1) }, commandTimeout: 180).ToList();

            foreach (var x in satirlar)
            {
                var kimlik = new string(((string)x.kimlik ?? "").Where(char.IsDigit).ToArray());
                if (kimlik.Length == 0) continue;
                if (!kartHareket.TryGetValue(kimlik, out var l)) kartHareket[kimlik] = l = new();
                l.Add(((DateTime)x.zaman, (string)x.yon, MobilOkutmaKaynagi.ICard));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Okutma aralığı için iCard verisi alınamadı");
            icardHata = true;
        }

        var mobil = MobilOkutmaKaynagi.Aralik(_vt, bas, bit, kayit: _kayit)
            .GroupBy(x => Sk(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(x => (x.Zaman, x.Tur, x.Kaynak)).ToList(), StringComparer.OrdinalIgnoreCase);

        /* Okutmama sebepleri gün gün */
        Dictionary<string, Dictionary<DateTime, string>> nedenler;
        try { nedenler = new GunNedenServisi(_vt).Aralik(personeller, bas, bit, raporDahil: false); }
        catch { nedenler = new(); }

        var raporlu = new Dictionary<DateTime, HashSet<string>>();
        var muaf = new Dictionary<DateTime, HashSet<string>>();
        var raporServis = new RaporluServisi(_vt);
        for (var g = bas; g <= bit; g = g.AddDays(1))
        {
            try { raporlu[g] = raporServis.Kodlar(g); } catch { raporlu[g] = new(); }
            try { muaf[g] = OkutmaKurallari.MuafKodlari(_vt, g, g); } catch { muaf[g] = new(); }
        }

        var detayli = personeller.Count <= 60;
        var satirListesi = new List<object>();
        var kisiOzetleri = new List<object>();

        foreach (var kisi in personeller.OrderBy(x => x.IsGrubu).ThenBy(x => x.Ad).ThenBy(x => x.Soyad))
        {
            var kod = Sk(kisi.PersonelKodu);
            var kimlik = new string((kisi.KimlikNo ?? "").Where(char.IsDigit).ToArray());

            var tum = new List<(DateTime Zaman, string Yon, string Kaynak)>();
            if (kimlik.Length == 11 && kartHareket.TryGetValue(kimlik, out var kart)) tum.AddRange(kart);
            if (mobil.TryGetValue(kod, out var m)) tum.AddRange(m);
            var gunluk = tum.GroupBy(x => x.Zaman.Date).ToDictionary(g => g.Key, g => g.OrderBy(x => x.Zaman).ToList());

            nedenler.TryGetValue(GunNedenServisi.K(kisi.PersonelKodu), out var kisiNeden);

            int beklenen = 0, okutulan = 0, okutmayan = 0, izinli = 0, raporluGun = 0, muafGun = 0, eksikCikis = 0;
            var toplamDakika = 0;

            for (var g = bas; g <= bit; g = g.AddDays(1))
            {
                if (kisi.GirisTarihi.HasValue && g < kisi.GirisTarihi.Value.Date) continue;
                if (kisi.Durum != 1 && kisi.CikisTarihi.HasValue && g > kisi.CikisTarihi.Value.Date) continue;

                gunluk.TryGetValue(g, out var h);
                h ??= new();

                var girisler = h.Where(x => GirisMi(x.Yon)).Select(x => x.Zaman).ToList();
                var cikislar = h.Where(x => !GirisMi(x.Yon)).Select(x => x.Zaman).ToList();
                DateTime? ilk = girisler.Count > 0 ? girisler.Min() : null;
                DateTime? son = cikislar.Count > 0 ? cikislar.Max() : null;
                int? dakika = ilk.HasValue && son.HasValue && son > ilk ? (int)(son.Value - ilk.Value).TotalMinutes : null;

                var r = raporlu[g].Contains(RaporluServisi.Anahtar(kisi.PersonelKodu));
                var mu = muaf[g].Contains(OkutmaKurallari.Anahtar(kisi.PersonelKodu));
                string izinNeden = null;
                kisiNeden?.TryGetValue(g, out izinNeden);

                string durum;
                string neden = null;
                if (h.Count > 0) durum = "okuttu";
                else if (r) { durum = "raporlu"; neden = RaporluServisi.Etiket; }
                else if (mu) { durum = "muaf"; neden = "Muaf"; }
                else if (izinNeden != null) { durum = "izinli"; neden = izinNeden; }
                else durum = "okutmadi";

                var beklenmiyor = r || mu || izinNeden != null;
                if (!beklenmiyor) beklenen++;
                if (h.Count > 0) okutulan++;
                if (durum == "okutmadi") okutmayan++;
                if (durum == "izinli") izinli++;
                if (durum == "raporlu") raporluGun++;
                if (durum == "muaf") muafGun++;
                var eksik = girisler.Count > 0 && cikislar.Count == 0;
                if (eksik) eksikCikis++;
                if (dakika.HasValue) toplamDakika += dakika.Value;

                satirListesi.Add(new
                {
                    tarih = g,
                    sicil = kisi.PersonelKodu,
                    adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                    birim = string.IsNullOrWhiteSpace(kisi.IsGrubu) ? "TANIMSIZ" : kisi.IsGrubu,
                    pozisyon = kisi.Pozisyon,
                    durum,
                    neden,
                    ilkGiris = ilk,
                    sonCikis = son,
                    dakika,
                    eksikCikis = eksik,
                    hareketSayisi = h.Count,
                    kaynaklar = h.Select(x => x.Kaynak).Distinct().OrderBy(x => x).ToList(),
                    hareketler = detayli
                        ? h.Select(x => new { zaman = x.Zaman, giris = GirisMi(x.Yon), kaynak = x.Kaynak }).ToList()
                        : null,
                });
            }

            var beklenenOkutan = beklenen - okutmayan;
            kisiOzetleri.Add(new
            {
                sicil = kisi.PersonelKodu,
                adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                birim = string.IsNullOrWhiteSpace(kisi.IsGrubu) ? "TANIMSIZ" : kisi.IsGrubu,
                pozisyon = kisi.Pozisyon,
                calisiyor = kisi.Durum == 1,
                beklenen,
                okutulan,
                okutmayan,
                izinli,
                raporlu = raporluGun,
                muaf = muafGun,
                eksikCikis,
                toplamDakika,
                oran = beklenen > 0 ? (int)Math.Round(Math.Max(0, beklenenOkutan) * 100.0 / beklenen) : (int?)null,
            });
        }

        return Ok(new
        {
            bas,
            bit,
            gunSayisi = (int)(bit - bas).TotalDays + 1,
            kisiSayisi = personeller.Count,
            hedefOran = OkutmaRaporuServisi.HedefOran,
            icardUlasilamadi = icardHata,
            detayli,
            kisiler = kisiOzetleri,
            satirlar = satirListesi,
        });
    }

    /// <summary>
    /// Günlük rapor görevinin durumu: ayarlar, son gönderim, alıcı sayısı.
    /// Mail gitmediğinde sebebini bulmak içindir.
    /// </summary>
    [HttpGet("RaporGoreviDurum")]
    [Authorize]
    public IActionResult RaporGoreviDurum()
    {
        using var db = _vt.Baglanti();

        var sonGonderim = db.ExecuteScalar<DateTime?>(
            "SELECT deger FROM KRY_SISTEM_DURUM WHERE anahtar = 'OkutmaRaporuSonGonderim'");

        /* Bölge müdürlerinin mail ve bölge alanları dolu mu */
        var kullanicilar = db.Query(@"
SELECT kullanici_adi AS KullaniciAdi, ad_soyad AS AdSoyad, rol AS Rol,
       eposta AS Eposta, bolge AS Bolge, aktif AS Aktif
FROM KRY_KULLANICILAR
WHERE aktif = 1
ORDER BY rol, ad_soyad").ToList();

        var alicilar = kullanicilar
            .Where(k => !string.IsNullOrWhiteSpace((string)k.Eposta)
                     && !string.IsNullOrWhiteSpace((string)k.Bolge))
            .Select(k => new
            {
                k.AdSoyad,
                k.Rol,
                k.Eposta,
                k.Bolge
            })
            .ToList();

        var eksikler = kullanicilar
            .Where(k => string.IsNullOrWhiteSpace((string)k.Eposta)
                     || string.IsNullOrWhiteSpace((string)k.Bolge))
            .Select(k => new
            {
                k.AdSoyad,
                k.Rol,
                epostaVar = !string.IsNullOrWhiteSpace((string)k.Eposta),
                bolgeVar = !string.IsNullOrWhiteSpace((string)k.Bolge)
            })
            .ToList();

        return Ok(new
        {
            acik = _yapilandirma.GetValue("OkutmaRaporu:Acik", false),
            saat = _yapilandirma.GetValue("OkutmaRaporu:Saat", 10),
            genelAlicilar = _yapilandirma
                .GetSection("OkutmaRaporu:GenelAlicilar").Get<string[]>()
                ?? Array.Empty<string>(),
            sonGonderim,
            bugunGonderildi = sonGonderim?.Date == DateTime.Today,
            sunucuSaati = DateTime.Now,
            bolgeAlicilari = alicilar,
            eksikBilgililer = eksikler
        });
    }

    /// <summary>Günlük raporu elle tetikler; görevin çalıştığını sınamak için.</summary>
    [HttpPost("RaporGoreviCalistir")]
    [Authorize(Roles = Roller.Admin)]
    public async Task<IActionResult> RaporGoreviCalistir(
        [FromServices] OkutmaRaporuServisi rapor)
    {
        var dun = DateTime.Today.AddDays(-1);
        var hazirlayici = new OkutmaVeriHazirlayici(_vt, _ayar);

        using var db = _vt.Baglanti();

        var mudurler = db.Query(@"
SELECT ad_soyad AS AdSoyad, eposta AS Eposta, bolge AS Bolge
FROM KRY_KULLANICILAR
WHERE aktif = 1
  AND eposta IS NOT NULL AND LTRIM(RTRIM(eposta)) <> ''
  AND bolge IS NOT NULL AND LTRIM(RTRIM(bolge)) <> ''").ToList();

        var gonderilen = new List<string>();
        var hatalar = new List<string>();

        foreach (var mudur in mudurler)
        {
            var bolgeler = ((string)mudur.Bolge)
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .Where(x => x.Length > 0)
                .ToArray();

            if (bolgeler.Length == 0) continue;

            try
            {
                var veri = hazirlayici.Hazirla(dun, dun, bolgeler);

                if (veri.Magazalar.Count == 0)
                {
                    hatalar.Add($"{mudur.Eposta}: bölgede mağaza bulunamadı");
                    continue;
                }

                await _mail.GonderAsync(
                    new[] { (string)mudur.Eposta },
                    rapor.Konu(veri, false),
                    rapor.Govde(veri, (string)mudur.AdSoyad, false));

                gonderilen.Add((string)mudur.Eposta);
            }
            catch (Exception hata)
            {
                hatalar.Add($"{mudur.Eposta}: {hata.Message}");
            }
        }

        /* Genel alıcılar */
        var genel = _yapilandirma
            .GetSection("OkutmaRaporu:GenelAlicilar").Get<string[]>()
            ?? Array.Empty<string>();

        if (genel.Length > 0)
        {
            try
            {
                var veri = hazirlayici.Hazirla(dun, dun, null);

                await _mail.GonderAsync(genel,
                    rapor.Konu(veri, true), rapor.Govde(veri, null, true));

                gonderilen.AddRange(genel);
            }
            catch (Exception hata)
            {
                hatalar.Add($"genel: {hata.Message}");
            }
        }

        return Ok(new { gonderilen, hatalar, tarih = dun });
    }

    /// <summary>Mail gövdesinin önizlemesi; göndermeden bakmak için.</summary>
    [HttpGet("OkutmaRaporuOnizleme")]
    [Authorize]
    public IActionResult OkutmaRaporuOnizleme(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string bolgeler = null,
        [FromServices] OkutmaRaporuServisi rapor = null)
    {
        var baslangic = (bas ?? DateTime.Today.AddDays(-1)).Date;
        var bitis = (bit ?? baslangic).Date;

        var bolgeDizi = string.IsNullOrWhiteSpace(bolgeler)
            ? null
            : bolgeler.Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim()).ToArray();

        /* Bölge müdüründe bölge seçicisi yok, dolayısıyla panel bu uca
           bölge göndermiyordu ve rapor tüm şubeleri kapsıyordu. Kapsam
           istemciden gelmemeli: jetondaki şube listesi uygulanıyor. */
        string[] subeSiniri = null;

        if (Rol == Roller.BolgeMuduru)
        {
            subeSiniri = YetkiliSubeler();

            if (subeSiniri.Length == 0)
                return Ok(new
                {
                    konu = "",
                    govde = "",
                    ozet = new { Toplam = 0, Okutan = 0, Okutmayan = 0, Oran = 0 },
                    bilgi = "Hesabınıza şube tanımlanmamış. İnsan Kaynakları ile görüşünüz."
                });

            /* Bölge müdürü kendi bölgesini seçemez, süzgeç de uygulanmaz */
            bolgeDizi = null;
        }

        try
        {
            var veri = RaporVerisiHazirla(baslangic, bitis, bolgeDizi, subeSiniri);
            var genel = bolgeDizi is null || bolgeDizi.Length == 0;

            return Ok(new
            {
                konu = rapor.Konu(veri, genel),
                govde = rapor.Govde(veri, null, genel),
                ozet = new { veri.Toplam, veri.Okutan, veri.Okutmayan, veri.Oran, Muaf = veri.MuafSayisi, Raporlu = veri.RaporluSayisi }
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Okutma raporu önizlemesi hazırlanamadı");
            return StatusCode(502, new
            {
                hata = "Rapor hazırlanamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }
    }

    /// <summary>
    /// Okutma raporunu seçilen adreslere gönderir.
    ///
    /// Panelden elle tetiklenir; günlük otomatik gönderim ayrı çalışır.
    /// </summary>
    [HttpPost("OkutmaRaporuGonder")]
    [Authorize]
    public async Task<IActionResult> OkutmaRaporuGonder(
        [FromBody] OkutmaRaporuGirdi girdi,
        [FromServices] OkutmaRaporuServisi rapor)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        var adresler = (girdi?.Adresler ?? new List<string>())
            .Select(x => x?.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x) && x.Contains('@'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (adresler.Count == 0)
            return BadRequest(new { hata = "En az bir geçerli e-posta adresi giriniz." });

        var baslangic = (girdi.Bas ?? DateTime.Today.AddDays(-1)).Date;
        var bitis = (girdi.Bit ?? baslangic).Date;

        var bolgeDizi = girdi.Bolgeler is { Count: > 0 }
            ? girdi.Bolgeler.ToArray()
            : null;

        /* Gönderilen rapor da bölge müdürünün kendi şubeleriyle sınırlı;
           aksi hâlde önizlemede görmediği şubeleri e-postayla alırdı. */
        string[] subeSiniri = null;

        if (Rol == Roller.BolgeMuduru)
        {
            subeSiniri = YetkiliSubeler();

            if (subeSiniri.Length == 0)
                return BadRequest(new { hata = "Hesabınıza şube tanımlanmamış." });

            bolgeDizi = null;
        }

        try
        {
            var veri = RaporVerisiHazirla(baslangic, bitis, bolgeDizi, subeSiniri);
            var genel = bolgeDizi is null || bolgeDizi.Length == 0;

            var konu = rapor.Konu(veri, genel);
            var govde = rapor.Govde(veri, null, genel);

            /* Tek çağrıda tüm alıcılara gönderilir */
            var gonderildi = await _mail.GonderAsync(adresler, konu, govde);

            return Ok(new
            {
                basarili = gonderildi ? adresler.Count : 0,
                toplam = adresler.Count,
                gonderildi
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Okutma raporu gönderilemedi");
            return StatusCode(502, new
            {
                hata = "Rapor gönderilemedi.",
                ayrinti = HataAyrintisi(hata)
            });
        }
    }

    /// <summary>
    /// Rapor verisini hazırlar. Mantık OkutmaVeriHazirlayici sınıfındadır;
    /// günlük mail görevi de aynı sınıfı kullanır.
    /// </summary>
    private OkutmaRaporuServisi.RaporVerisi RaporVerisiHazirla(
        DateTime bas, DateTime bit, string[] bolgeler = null,
        string[] subeler = null)
        => new OkutmaVeriHazirlayici(_vt, _ayar)
            .Hazirla(bas, bit, bolgeler, null, subeler);

    /// <summary>
    /// Personel fotoğrafını Mikro'ya yükler.
    ///
    /// Yazma öncesi mevcut hâl yedeklenir; sorun çıkarsa geri alınabilir.
    /// </summary>
    [HttpPost("ResimYukle")]
    [Authorize]
    public IActionResult ResimYukle(
        [FromBody] ResimYuklemeGirdi girdi,
        [FromServices] MikroResimServisi resimServisi)
    {
        if (!Roller.FotografYukleme(Rol))
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.PersonelKodu))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        if (string.IsNullOrWhiteSpace(girdi.Base64))
            return BadRequest(new { hata = "Görsel verisi gereklidir." });

        /* Personelin Mikro kayıt kimliği bulunur */
        Guid? guid;
        string adSoyad;

        try
        {
            using var db = _vt.PersonelBaglantisi();

            var kisi = db.QueryFirstOrDefault(@"
SELECT per_Guid AS Guid, per_adi AS Ad, per_soyadi AS Soyad
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @kod",
                new { kod = girdi.PersonelKodu.Trim() });

            if (kisi is null)
                return NotFound(new { hata = "Personel bulunamadı." });

            guid = kisi.Guid as Guid?;
            adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Personel kaydı okunamadı");
            return StatusCode(502, new
            {
                hata = "Personel bilgisi okunamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        if (guid is null)
            return BadRequest(new
            {
                hata = "Personelin Mikro kayıt kimliği bulunamadı."
            });

        /* Base64 çözülür */
        byte[] bayt;

        try
        {
            var metin = girdi.Base64;
            var virgul = metin.IndexOf(',');

            if (virgul > 0 && virgul < 100) metin = metin[(virgul + 1)..];

            bayt = Convert.FromBase64String(metin);
        }
        catch
        {
            return BadRequest(new { hata = "Görsel okunamadı." });
        }

        var sonuc = resimServisi.Yaz(
            guid.Value, girdi.PersonelKodu.Trim(), adSoyad, bayt, Kullanici);

        if (!sonuc.Basarili)
            return StatusCode(502, new { hata = sonuc.Mesaj, yedekId = sonuc.YedekId });

        return Ok(new { basarili = true, mesaj = sonuc.Mesaj, yedekId = sonuc.YedekId });
    }

    /// <summary>Fotoğraf yazma geçmişi; geri alma için kullanılır.</summary>
    [HttpGet("ResimGecmisi")]
    [Authorize]
    public IActionResult ResimGecmisi([FromQuery] string kod = null)
    {
        using var db = _vt.Baglanti();

        var kosul = string.IsNullOrWhiteSpace(kod)
            ? ""
            : "WHERE personel_kodu = @kod";

        var liste = db.Query($@"
SELECT TOP 100 id AS id, personel_kodu AS personelKodu,
       personel_adi AS personelAdi, islem AS islem,
       CASE WHEN eski_veri IS NULL THEN 0 ELSE 1 END AS eskiVeriVar,
       geri_alindi AS geriAlindi, geri_alma_tarihi AS geriAlmaTarihi,
       kullanici AS kullanici, olusturma AS olusturma
FROM KRY_RESIM_YEDEK
{kosul}
ORDER BY id DESC", new { kod = kod?.Trim() }).ToList();

        return Ok(liste);
    }

    /// <summary>Bir fotoğraf yükleme işlemini geri alır.</summary>
    [HttpPost("ResimGeriAl/{yedekId:int}")]
    [Authorize]
    public IActionResult ResimGeriAl(
        int yedekId,
        [FromServices] MikroResimServisi resimServisi)
    {
        if (!Roller.FotografYukleme(Rol))
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        var sonuc = resimServisi.GeriAl(yedekId, Kullanici);

        if (!sonuc.Basarili)
            return StatusCode(502, new { hata = sonuc.Mesaj });

        return Ok(new { basarili = true, mesaj = sonuc.Mesaj });
    }

    /// <summary>
    /// Mikro resim tablosunun yapısını gösterir.
    ///
    /// Fotoğraf yazma işlemi için kolon adlarının kesin bilinmesi gerekir;
    /// sürümden sürüme değişebildiği için burada okunur.
    /// </summary>
    [HttpGet("ResimTablosu")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult ResimTablosu()
    {
        try
        {
            using var db = _vt.PersonelBaglantisi();

            var kolonlar = db.Query(@"
SELECT COLUMN_NAME AS ad, DATA_TYPE AS tur,
       IS_NULLABLE AS bosOlabilir, CHARACTER_MAXIMUM_LENGTH AS uzunluk
FROM [MikroDesktop_2004BICEN].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'mye_ImageData'
ORDER BY ORDINAL_POSITION").ToList();

            var kayitSayisi = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].dbo.mye_ImageData");

            /* Örnek bir kayıt: hangi alanların dolu olduğunu görmek için.
               İkili veriler boyutlarıyla gösterilir, içerikleri değil. */
            var ornek = db.QueryFirstOrDefault(@"
SELECT TOP 1 * FROM [MikroDesktop_2004BICEN].dbo.mye_ImageData");

            var ornekOzet = new Dictionary<string, object>();

            if (ornek is not null)
            {
                foreach (var alan in (IDictionary<string, object>)ornek)
                {
                    ornekOzet[alan.Key] = alan.Value switch
                    {
                        byte[] b => $"[ikili veri, {b.Length} bayt]",
                        null => null,
                        _ => alan.Value.ToString()
                    };
                }
            }

            return Ok(new { kayitSayisi, kolonlar, ornek = ornekOzet });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Resim tablosu okunamadı");
            return StatusCode(502, new
            {
                hata = "Tablo yapısı okunamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }
    }

    /// <summary>
    /// QR geçiş bağlantısını sınar.
    ///
    /// Bölüm ekranda görünmediğinde sebebini bulmak içindir: bağlantı mı
    /// kurulamıyor, kişi mi eşleşmiyor, hareket mi yok.
    /// </summary>
    [HttpGet("GecisSinama")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult GecisSinama([FromQuery] string kimlikNo = null)
    {
        var sonuc = new Dictionary<string, object>();

        /* Hangi adrese bağlanmaya çalışıldığı; parola gizlenir */
        var dizge = HttpContext.RequestServices
            .GetService<IConfiguration>()?.GetConnectionString("Gecis") ?? "";

        sonuc["baglantiAdresi"] = System.Text.RegularExpressions.Regex.Replace(
            dizge, @"Password=[^;]*", "Password=***",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

        /* 1) Bağlantı kurulabiliyor mu */
        try
        {
            using var db = _vt.GecisBaglantisi();

            sonuc["baglanti"] = "tamam";
            sonuc["kisiSayisi"] = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM Persons", commandTimeout: 20);

            sonuc["hareketSayisiBugun"] = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM Transitions
WHERE CAST(TransitionDate AS DATE) = CAST(GETDATE() AS DATE)",
                commandTimeout: 20);

            /* Yön alanının hangi biçimde tutulduğu */
            sonuc["yonDegerleri"] = db.Query<string>(@"
SELECT DISTINCT TOP 5 CAST(Direction AS NVARCHAR(20))
FROM Transitions", commandTimeout: 20).ToList();
        }
        catch (Exception hata)
        {
            sonuc["baglanti"] = "HATA";
            sonuc["hata"] = HataAyrintisi(hata);
            return Ok(sonuc);
        }

        /* 2) Kimlik numarası verildiyse eşleşme sınanır */
        if (!string.IsNullOrWhiteSpace(kimlikNo))
        {
            var temiz = new string(kimlikNo.Where(char.IsDigit).ToArray());
            sonuc["aranan"] = temiz;

            var kisiId = GecisKisiNumarasi(temiz);
            sonuc["kisiId"] = kisiId ?? 0;

            if (kisiId is null)
            {
                sonuc["eslesme"] = "BULUNAMADI";

                /* Kayıt biçimi farklı olabilir; örnek değerler gösterilir */
                using var db = _vt.GecisBaglantisi();

                sonuc["ornekKayitNolar"] = db.Query<string>(@"
SELECT TOP 5 RegistrationNumber FROM Persons
WHERE RegistrationNumber IS NOT NULL
  AND LTRIM(RTRIM(RegistrationNumber)) <> ''").ToList();
            }
            else
            {
                sonuc["eslesme"] = "tamam";
                sonuc["ozet"] = GecisOzeti(temiz);
            }
        }

        return Ok(sonuc);
    }

    /// <summary>
    /// Personelin QR geçiş özeti: son yedi günün hareketleri ve o anki
    /// durumu. Eşleşme yoksa ya da sistem kapalıysa null döner.
    /// </summary>
    private object GecisOzeti(string kimlikNo, string personelKodu = null)
    {
        var kisiId = GecisKisiNumarasi(kimlikNo);

        var bas = DateTime.Today.AddDays(-7);
        var bit = DateTime.Today;

        var (hareketler, icardOkundu) = BirlesikHareketler(kisiId, personelKodu, bas, bit);

        /* Ne iCard'da eşleşme ne uygulamada okutma varsa bölüm gizlenir */
        if ((kisiId is null || kisiId <= 0 || !icardOkundu) && hareketler.Count == 0) return null;

        var son = hareketler.OrderByDescending(x => x.GecisZamani).FirstOrDefault();

        var gunler = GunlereAyir(hareketler);

        var (iceride, cikisOkutulmadi) = IcerideDurumu(son);

        return new
        {
            kisiId = kisiId ?? 0,
            icerideMi = iceride,
            cikisOkutulmadi,
            sonHareket = son,
            toplam = hareketler.Count,
            kaynaklar = hareketler.Select(x => x.Kaynak).Distinct().OrderBy(x => x).ToList(),
            gunler
        };
    }

    /// <summary>
    /// iCard ve Biçen360 okutmaları tek listede, kaynağı işaretli. iCard
    /// okunamazsa yalnızca uygulama okutmaları döner.
    /// </summary>
    private (List<GecisHareketi> Hareketler, bool IcardOkundu) BirlesikHareketler(
        int? kisiId, string personelKodu, DateTime bas, DateTime bit)
    {
        var liste = new List<GecisHareketi>();
        var icardOkundu = true;

        if (kisiId is > 0)
        {
            try
            {
                using var db = _vt.GecisBaglantisi();

                var kart = db.Query<GecisHareketi>(
                    "Entegrasyon_GecisHareketleri",
                    new { KisiID = kisiId.Value, IlkTarih = bas.Date, SonTarih = bit.Date },
                    commandType: System.Data.CommandType.StoredProcedure,
                    commandTimeout: 60).ToList();

                kart.ForEach(x => x.Kaynak = MobilOkutmaKaynagi.ICard);
                liste.AddRange(kart);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "iCard geçiş hareketleri alınamadı");
                icardOkundu = false;
            }
        }

        if (!string.IsNullOrWhiteSpace(personelKodu))
        {
            liste.AddRange(MobilOkutmaKaynagi.Aralik(_vt, bas, bit, personelKodu, _kayit)
                .Select(x => new GecisHareketi
                {
                    GecisZamani = x.Zaman,
                    GecisYonu = x.Tur,
                    GecisNoktasi = x.SubeAdi,
                    Kaynak = x.Kaynak,
                }));
        }

        return (liste.OrderBy(x => x.GecisZamani).ToList(), icardOkundu);
    }

    /// <summary>Hareketleri günlere ayırır: ilk giriş, son çıkış, kaynaklar.</summary>
    private static List<object> GunlereAyir(List<GecisHareketi> hareketler)
    {
        return hareketler
            .GroupBy(x => x.GecisZamani.Date)
            .OrderByDescending(g => g.Key)
            .Select(g => (object)new
            {
                tarih = g.Key,
                ilkGiris = g.Where(x => GirisMi(x.GecisYonu))
                    .Select(x => (DateTime?)x.GecisZamani).Min(),
                sonCikis = g.Where(x => !GirisMi(x.GecisYonu))
                    .Select(x => (DateTime?)x.GecisZamani).Max(),
                hareketSayisi = g.Count(),
                kaynaklar = g.Select(x => x.Kaynak).Distinct().OrderBy(x => x).ToList(),
                hareketler = g.OrderBy(x => x.GecisZamani)
                    .Select(x => new
                    {
                        x.Id,
                        x.KisiId,
                        x.GecisZamani,
                        x.GecisYonu,
                        x.GecisNoktasi,
                        x.Kaynak,
                        giris = GirisMi(x.GecisYonu),
                    })
                    .ToList(),
            })
            .ToList();
    }

    /// <summary>
    /// Mikro fotoğraf kaydını çalışan bir örnekle karşılaştırır.
    ///
    /// Fotoğraf tabloya yazıldığı hâlde Mikro'da görünmüyorsa, satırda
    /// doldurulmamış bir alan var demektir. Hangi alan olduğunu bulmak
    /// için bizim yazdığımız satır ile Mikro'nun kendi yazdığı bir satır
    /// yan yana konur. İkili veri kolonları dışarıda bırakılır.
    /// </summary>
    [HttpGet("ResimSina")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult ResimSina([FromQuery] string kod)
    {
        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu veriniz." });

        try
        {
            using var db = _vt.PersonelBaglantisi();

            /* İkili kolonlar hariç tüm kolon adları */
            var kolonlar = db.Query<string>(@"
SELECT COLUMN_NAME
FROM [MikroDesktop_2004BICEN].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'mye_ImageData'
  AND DATA_TYPE NOT IN ('varbinary', 'image', 'binary')
ORDER BY ORDINAL_POSITION").ToList();

            if (kolonlar.Count == 0)
                return Ok(new { hata = "mye_ImageData kolonları okunamadı." });

            var secim = string.Join(", ", kolonlar.Select(x => $"[{x}]"));

            var guid = db.ExecuteScalar<Guid?>(@"
SELECT per_Guid FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @kod", new { kod = kod.Trim() });

            if (guid is null)
                return Ok(new { hata = "Personel ya da Mikro kayıt kimliği bulunamadı." });

            var bizim = db.Query($@"
SELECT TOP 1 {secim}
FROM [MikroDesktop_2004BICEN].dbo.mye_ImageData
WHERE Record_uid = @guid", new { guid }).FirstOrDefault();

            /* Mikro'nun kendi yazdığı, fotoğrafı görünen bir kayıt:
               bizimkinden farklı olan alanlar aradığımız cevap. */
            var ornek = db.Query($@"
SELECT TOP 3 {secim}
FROM [MikroDesktop_2004BICEN].dbo.mye_ImageData
WHERE Record_uid <> @guid
ORDER BY NEWID()", new { guid }).ToList();

            return Ok(new
            {
                personelKodu = kod.Trim(),
                perGuid = guid,
                kolonlar,
                bizimKayit = bizim,
                kayitVarMi = bizim is not null,
                mikroOrnekleri = ornek
            });
        }
        catch (Exception hata)
        {
            return Ok(new { tamam = false, hata = hata.Message });
        }
    }

    /// <summary>
    /// Bir personelin okutma eşleştirmesini adım adım gösterir.
    ///
    /// Rapor "Okutmadı" dediğinde sebebin gerçekten okutmamak mı yoksa
    /// iki sistemdeki numaraların uyuşmaması mı olduğunu ayırt etmek için.
    /// Mikro'daki kimlik ile iCard'daki RegistrationNumber yan yana konur.
    /// </summary>
    [HttpGet("OkutmaSina")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult OkutmaSina([FromQuery] string sicil,
                                    [FromQuery] DateTime? tarih)
    {
        var gun = (tarih ?? DateTime.Today.AddDays(-1)).Date;
        var aranan = (sicil ?? "").Trim();

        if (aranan.Length == 0)
            return BadRequest(new { hata = "Sicil numarası veriniz." });

        dynamic mikro;

        try
        {
            using var db = _vt.PersonelBaglantisi();

            mikro = db.QueryFirstOrDefault(@"
SELECT LTRIM(RTRIM(per_kod)) AS sicil,
       per_adi AS ad, per_soyadi AS soyad,
       Per_TcKimlikNo AS tc
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @sicil", new { sicil = aranan });
        }
        catch (Exception hata)
        {
            return Ok(new { tamam = false, asama = "Mikro", hata = hata.Message });
        }

        if (mikro is null)
            return Ok(new { tamam = false, asama = "Mikro", hata = "Bu sicille personel bulunamadı." });

        var ham = (string)(mikro.tc ?? "");
        var kimlik = new string(ham.Where(char.IsDigit).ToArray());
        var ad = $"{mikro.ad} {mikro.soyad}".Trim();

        try
        {
            using var db = _vt.GecisBaglantisi();

            /* Numaranın iCard'da karşılığı var mı */
            var kisiler = db.Query(@"
SELECT PersonId AS personId, Name AS ad, RegistrationNumber AS numara
FROM Persons
WHERE REPLACE(REPLACE(LTRIM(RTRIM(RegistrationNumber)), ' ', ''), '-', '') = @kimlik",
                new { kimlik }).ToList();

            /* Numara tutmuyorsa ada göre arayıp neyin kayıtlı olduğunu göster */
            var adaGore = new List<object>();

            if (kisiler.Count == 0 && ad.Length > 2)
            {
                var soyad = ((string)(mikro.soyad ?? "")).Trim();

                adaGore = db.Query(@"
SELECT TOP 20 PersonId AS personId, Name AS ad, RegistrationNumber AS numara
FROM Persons
WHERE Name LIKE @desen", new { desen = $"%{soyad}%" })
                    .Select(x => (object)new
                    {
                        personId = x.personId,
                        ad = x.ad,
                        numara = x.numara
                    })
                    .ToList();
            }

            /* O güne ait hareketler */
            var hareket = db.Query(@"
SELECT t.TransitionDateTime AS zaman,
       CAST(t.Direction AS NVARCHAR(20)) AS yon
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) = @gun
  AND REPLACE(REPLACE(LTRIM(RTRIM(p.RegistrationNumber)), ' ', ''), '-', '') = @kimlik
ORDER BY t.TransitionDateTime", new { gun, kimlik }).ToList();

            return Ok(new
            {
                tamam = true,
                gun,
                mikroSicil = (string)mikro.sicil,
                mikroAd = ad,
                mikroTcHam = $"[{ham}]",
                mikroTcSade = kimlik,
                mikroTcUzunluk = kimlik.Length,

                icardKayitSayisi = kisiler.Count,
                icardKayitlar = kisiler,
                icardAdaGore = adaGore,

                hareketSayisi = hareket.Count,
                hareketler = hareket,

                sonuc = kisiler.Count == 0
                    ? "iCard'da bu kimlik numarasıyla kayıt yok. Kart tanımlanmamış ya da numara farklı yazılmış."
                    : hareket.Count == 0
                        ? "Kayıt var ama seçilen günde hareketi yok. Gerçekten okutmamış."
                        : "Kayıt ve hareket var. Rapor bunu okutmuş göstermeli."
            });
        }
        catch (Exception hata)
        {
            return Ok(new { tamam = false, asama = "iCard", hata = hata.Message });
        }
    }

    /// <summary>
    /// O anda içeride olan personelin kimlik numaraları.
    ///
    /// Her personel için ayrı sorgu yapmak yerine tek seferde alınır; liste
    /// ekranında "mağazada" rozetini göstermek için kullanılır.
    /// </summary>
    [HttpGet("IcerdekiPersonel")]
    public IActionResult IcerdekiPersonel()
    {
        try
        {
            /* Her kişinin bugünkü son hareketi alınır; yönü giriş olanlar
               içeride sayılır. iCard kapalıysa yalnızca uygulama okutmaları. */
            var kayitlar = new List<dynamic>();

            try
            {
                using var db = _vt.GecisBaglantisi();

                kayitlar = db.Query(@"
WITH sonlar AS (
    SELECT p.RegistrationNumber AS kimlik,
           t.Direction AS yon,
           t.TransitionDateTime AS zaman,
           ROW_NUMBER() OVER (
               PARTITION BY t.PersonId
               ORDER BY t.TransitionDateTime DESC) AS sira
    FROM Transitions t
        INNER JOIN Persons p ON p.PersonId = t.PersonId
    WHERE CAST(t.TransitionDate AS DATE) >= CAST(DATEADD(day, -1, GETDATE()) AS DATE)
)
SELECT kimlik, yon, zaman
FROM sonlar
WHERE sira = 1", commandTimeout: 60).ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İçerideki personel için iCard verisi alınamadı");
            }

            var sinir = DateTime.Now - IcerideSayilmaSuresi;

            /* Kişinin son hareketi: iCard ve Biçen360 okutmalarından hangisi
               daha yeniyse o. Uygulama okutmaları sicil ile tutulduğu için
               kimlik numarasına personel listesinden çevriliyor. */
            var sonlar = new Dictionary<string, (DateTime Zaman, string Yon)>(StringComparer.Ordinal);

            foreach (var x in kayitlar)
            {
                var kimlik = new string(((string)(x.kimlik?.ToString() ?? "")).Where(char.IsDigit).ToArray());
                if (kimlik.Length != 11 || x.zaman is not DateTime z) continue;

                if (!sonlar.TryGetValue(kimlik, out var mevcut) || z > mevcut.Zaman)
                    sonlar[kimlik] = (z, (string)(x.yon?.ToString()));
            }

            var mobil = MobilOkutmaKaynagi.Aralik(_vt, DateTime.Today.AddDays(-1), DateTime.Today, kayit: _kayit);

            if (mobil.Count > 0)
            {
                var kodKimlik = _personelKaynak.TumPersonelleriGetir()
                    .Where(p => !string.IsNullOrWhiteSpace(p.PersonelKodu))
                    .GroupBy(p => p.PersonelKodu.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(
                        g => g.Key,
                        g => new string((g.OrderByDescending(p => p.Durum == 1).First().KimlikNo ?? "")
                            .Where(char.IsDigit).ToArray()),
                        StringComparer.OrdinalIgnoreCase);

                foreach (var m in mobil)
                {
                    if (!kodKimlik.TryGetValue(m.PersonelKodu, out var kimlik) || kimlik.Length != 11) continue;

                    if (!sonlar.TryGetValue(kimlik, out var mevcut) || m.Zaman > mevcut.Zaman)
                        sonlar[kimlik] = (m.Zaman, m.Tur);
                }
            }

            var icerdekiler = sonlar
                .Where(x => GirisMi(x.Value.Yon) && x.Value.Zaman >= sinir)
                .Select(x => x.Key)
                .ToList();

            /* Personeller listesindeki "Bugün" sütunu için (02.10.2026):
               kimlik → bugünkü son hareketin saati ve içeride mi. Yukarıda
               zaten hesaplanan sözlükten; ek sorgu yok. Gece yarısını
               geçen vardiyada içerideyse dünkü giriş de yazılır. */
            var icerdeKume = icerdekiler.ToHashSet(StringComparer.Ordinal);

            var sonHareketler = sonlar
                .Where(x => x.Value.Zaman.Date == DateTime.Today || icerdeKume.Contains(x.Key))
                .ToDictionary(
                    x => x.Key,
                    x => new { zaman = x.Value.Zaman, iceride = icerdeKume.Contains(x.Key) },
                    StringComparer.Ordinal);

            return Ok(new { adet = icerdekiler.Count, kimlikler = icerdekiler, sonHareketler });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İçerideki personel listesi alınamadı");

            /* Geçiş sistemi kapalıysa liste ekranı çalışmaya devam eder */
            return Ok(new { adet = 0, kimlikler = new List<string>(), hataVar = true });
        }
    }

    /// <summary>
    /// T.C. kimlik numarasından geçiş sistemindeki kişi numarasını bulur.
    /// Eşleşme <c>Persons.RegistrationNumber</c> kolonu üzerinden yapılır.
    /// Bulunamazsa null döner.
    /// </summary>
    private int? GecisKisiNumarasi(string kimlikNo)
    {
        var temiz = new string((kimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (temiz.Length != 11) return null;

        try
        {
            using var db = _vt.GecisBaglantisi();

            return db.ExecuteScalar<int?>(@"
SELECT TOP 1 PersonId
FROM Persons
WHERE LTRIM(RTRIM(RegistrationNumber)) = @kimlik",
                new { kimlik = temiz }, commandTimeout: 20);
        }
        catch (Exception hata)
        {
            /* Geçiş sistemi kapalıysa personel ekranı çalışmaya devam etmeli */
            _kayit.LogWarning(hata, "Geçiş kişi eşleştirmesi yapılamadı");
            return null;
        }
    }

    /// <summary>
    /// Bir personelin QR geçiş hareketleri ve o anki durumu.
    ///
    /// Son hareketin yönüne bakılarak personelin binada olup olmadığı
    /// anlaşılır: son geçiş giriş ise içeride, çıkış ise dışarıdadır.
    /// </summary>
    [HttpGet("Gecisler")]
    public IActionResult Gecisler(
        [FromQuery] int kisiId = 0,
        [FromQuery] string kimlikNo = null,
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] string personelKodu = null)
    {
        /* Kişi numarası verilmediyse kimlik numarasından bulunur */
        if (kisiId <= 0 && !string.IsNullOrWhiteSpace(kimlikNo))
            kisiId = GecisKisiNumarasi(kimlikNo) ?? 0;

        if (kisiId <= 0 && string.IsNullOrWhiteSpace(personelKodu))
            return Ok(new
            {
                eslesmedi = true,
                mesaj = "Bu personel geçiş sisteminde bulunamadı."
            });

        var baslangic = (bas ?? DateTime.Today.AddDays(-7)).Date;
        var bitis = (bit ?? DateTime.Today).Date;

        /* iCard ve Biçen360 okutmaları birlikte, kaynağı işaretli */
        var (hareketler, icardOkundu) = BirlesikHareketler(kisiId, personelKodu, baslangic, bitis);

        if (!icardOkundu && hareketler.Count == 0)
            return StatusCode(502, new { hata = "Geçiş veritabanına ulaşılamadı." });

        var gunler = GunlereAyir(hareketler);

        /* Son hareket giriş ve yakın zamanda ise personel içeride sayılır */
        var son = hareketler.OrderByDescending(x => x.GecisZamani).FirstOrDefault();
        var (iceride, cikisOkutulmadi) = IcerideDurumu(son);

        return Ok(new
        {
            baslangic,
            bitis,
            icerideMi = iceride,
            cikisOkutulmadi,
            sonHareket = son,
            toplam = hareketler.Count,
            kaynaklar = hareketler.Select(x => x.Kaynak).Distinct().OrderBy(x => x).ToList(),
            icardUlasilamadi = !icardOkundu,
            gunler
        });
    }

    /// <summary>
    /// Son girişten sonra bu süre geçtiyse personel artık içeride sayılmaz.
    ///
    /// Eskiden son hareket giriş olan herkes "Mağazada" görünüyordu: çıkışı
    /// okutmayı unutan personel günlerce içeride kalıyordu (ör. cumartesi
    /// sabah girişi, pazartesi hâlâ mağazada). En uzun vardiya ve gece
    /// yarısını aşan vardiyalar düşünülerek 16 saat. Liste ekranı ve
    /// ayrıntı aynı kuralı kullanıyor.
    /// </summary>
    /* internal: patron görünümü (PatronMobilController) "içeride" sayısını
       aynı kuralla hesaplıyor; iki ekranın sayısı ayrışmasın. */
    internal static readonly TimeSpan IcerideSayilmaSuresi = TimeSpan.FromHours(16);

    /// <summary>
    /// Son harekete göre içeride mi; değilse çıkışı okutulmamış bir giriş
    /// mi kaldı (ekranda "çıkış okutulmadı" notu için).
    /// </summary>
    private static (bool Iceride, bool CikisOkutulmadi) IcerideDurumu(GecisHareketi son)
    {
        if (son is null || !GirisMi(son.GecisYonu)) return (false, false);

        var taze = son.GecisZamani >= DateTime.Now - IcerideSayilmaSuresi;

        return (taze, !taze);
    }

    /// <summary>
    /// Geçiş yönünü yorumlar.
    ///
    /// Sistem kurulumuna göre yön 0/1 sayısı ya da "In"/"Giriş" gibi metin
    /// olabilir; her iki biçim de tanınır.
    /// </summary>
    /* internal: patron görünümü de aynı yön yorumunu kullanıyor */
    internal static bool GirisMi(string yon)
    {
        if (string.IsNullOrWhiteSpace(yon)) return false;

        var temiz = yon.Trim().ToLowerInvariant();

        return temiz is "1" or "in" or "giris" or "giriş" or "entry" or "input";
    }

    /// <summary>
    /// Bölge müdürü özet ekranı için ek bilgiler: dün QR okutmayan personel
    /// ve kadro durumu (eksik/fazla).
    /// </summary>
    [HttpGet("BolgeDurum")]
    public IActionResult BolgeDurum([FromQuery] DateTime? gun)
    {
        var tarih = (gun ?? DateTime.Today.AddDays(-1)).Date;

        List<PersonelKaydi> personeller;

        try
        {
            personeller = BolgeyeGoreSuz(PersonelleriGetir())
                .Where(x => x.Durum == 1)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Bölge durumu alınamadı");

            return StatusCode(502, new
            {
                hata = "Personel bilgisi alınamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        /* ------------------------------------------------ QR okutmayanlar */
        var okutanlar = new HashSet<string>(StringComparer.Ordinal);

        try
        {
            using var gecis = _vt.GecisBaglantisi();

            okutanlar = gecis.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(p.RegistrationNumber))
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) = @tarih
  AND p.RegistrationNumber IS NOT NULL",
                new { tarih }, commandTimeout: 90)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.Ordinal);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "QR okutma verisi alınamadı");
        }

        /* Biçen360 uygulamasından okutanlar (sicil ile) */
        var mobilOkutanlar = MobilOkutmaKaynagi.Aralik(_vt, tarih, tarih, kayit: _kayit)
            .Select(x => x.PersonelKodu)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool Okuttu(PersonelKaydi x) =>
            okutanlar.Contains((x.KimlikNo ?? "").Trim())
            || mobilOkutanlar.Contains((x.PersonelKodu ?? "").Trim());

        /* Okutmadan muaf ve o gün raporlu personel okutmayanlar arasında
           sayılmıyor */
        var muafKodlar = OkutmaKurallari.MuafKodlari(_vt, tarih, tarih);
        var raporluKodlar = new RaporluServisi(_vt).Kodlar(tarih);

        bool Muaf(PersonelKaydi x) =>
            !Okuttu(x) && (muafKodlar.Contains(OkutmaKurallari.Anahtar(x.PersonelKodu))
                           || raporluKodlar.Contains(RaporluServisi.Anahtar(x.PersonelKodu)));

        var okutmayanlar = personeller
            .Where(x => !Okuttu(x) && !Muaf(x))
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "TANIMSIZ" : x.IsGrubu)
            .Select(g => new
            {
                magaza = g.Key,
                toplam = personeller.Count(x => x.IsGrubu == g.Key && !Muaf(x)),
                okutmayan = g.Count(),
                kisiler = g.Select(x => new
                {
                    adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    x.Pozisyon
                }).ToList()
            })
            .OrderByDescending(x => x.okutmayan)
            .ToList();

        /* --------------------------------------------------- kadro durumu */
        using var db = _vt.Baglanti();

        var kadrolar = db.Query(@"
SELECT sube_adi AS subeAdi, bolum AS bolum,
       ISNULL(norm, 0) AS norm, ISNULL(mevcut, 0) AS mevcut
FROM KRY_KADRO WHERE aktif = 1").ToList();

        /* Yalnızca kullanıcının görebildiği mağazalar */
        var gorulen = personeller
            .Select(x => x.IsGrubu)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var kadroDurumu = kadrolar
            .Where(k => gorulen.Any(g =>
                BirimAnahtari(g) == BirimAnahtari((string)k.subeAdi)))
            .GroupBy(k => (string)k.subeAdi)
            .Select(g => new
            {
                magaza = g.Key,
                norm = g.Sum(x => (decimal)x.norm),
                mevcut = g.Sum(x => (decimal)x.mevcut),
                fark = g.Sum(x => (decimal)x.mevcut - (decimal)x.norm),

                eksikler = g.Where(x => (decimal)x.mevcut < (decimal)x.norm)
                    .Select(x => new
                    {
                        bolum = (string)x.bolum,
                        adet = (decimal)x.norm - (decimal)x.mevcut
                    }).ToList(),

                fazlalar = g.Where(x => (decimal)x.mevcut > (decimal)x.norm)
                    .Select(x => new
                    {
                        bolum = (string)x.bolum,
                        adet = (decimal)x.mevcut - (decimal)x.norm
                    }).ToList()
            })
            .OrderBy(x => x.fark)
            .ToList();

        return Ok(new
        {
            tarih,
            toplamPersonel = personeller.Count(x => !Muaf(x)),
            okutanSayisi = personeller.Count(Okuttu),
            okutmayanSayisi = personeller.Count(x => !Okuttu(x) && !Muaf(x)),
            muafSayisi = personeller.Count(Muaf),
            okutmayanlar,
            kadroDurumu
        });
    }

    /* ==================================================================== */
    /* Organizasyon şeması                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Organizasyon şeması ve her kutudaki personel sayısı.
    ///
    /// Personel sayısı Mikro'daki ünvan adıyla eşleştirilerek bulunur;
    /// ünvan adları birebir aynı olmayabildiği için sadeleştirilmiş
    /// karşılaştırma yapılır.
    /// </summary>
    [HttpGet("Organizasyon")]
    public IActionResult Organizasyon()
    {
        using var db = _vt.Baglanti();

        var kutular = db.Query<OrgKutu>(@"
SELECT id AS Id, ust_id AS UstId, unvan AS Unvan, renk AS Renk,
       sira AS Sira, magaza_mi AS MagazaMi, aciklama AS Aciklama,
       CAST(ISNULL(izin_onay, 1) AS BIT) AS IzinOnay,
       konum_x AS KonumX, konum_y AS KonumY, genislik AS Genislik
FROM KRY_ORGANIZASYON
WHERE aktif = 1
ORDER BY sira, id").ToList();

        /* Elle yapılmış eşleştirmeler: Mikro ünvanı → kutu */
        var eslesmeler = db.Query(@"
SELECT unvan AS unvan, kutu_id AS kutuId FROM KRY_ORG_ESLESME")
            .Where(x => x.kutuId is not null)
            .ToDictionary(
                x => UnvanAnahtari((string)x.unvan),
                x => (int)x.kutuId);

        /* Kutu kimliğine göre personel sayısı */
        var sayilar = new Dictionary<int, int>();

        try
        {
            var personeller = BolgeyeGoreSuz(PersonelleriGetir())
                .Where(x => x.Durum == 1)
                .ToList();

            foreach (var kisi in personeller)
            {
                var anahtar = UnvanAnahtari(kisi.Pozisyon);

                if (string.IsNullOrWhiteSpace(anahtar)) continue;

                /* Önce elle eşleştirme, yoksa ad benzerliği */
                int? kutuId = eslesmeler.TryGetValue(anahtar, out var e)
                    ? e
                    : kutular.FirstOrDefault(k =>
                        UnvanAnahtari(k.Unvan) == anahtar)?.Id;

                if (kutuId is null) continue;

                sayilar[kutuId.Value] = sayilar.GetValueOrDefault(kutuId.Value) + 1;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Organizasyon personel sayıları alınamadı");
        }

        foreach (var k in kutular)
            k.PersonelSayisi = sayilar.GetValueOrDefault(k.Id);

        return Ok(kutular);
    }

    /// <summary>Bir ünvandaki personelin listesi.</summary>
    [HttpGet("Organizasyon/{id:int}/Personel")]
    public IActionResult OrganizasyonPersonel(int id)
    {
        using var db = _vt.Baglanti();

        var unvan = db.ExecuteScalar<string>(
            "SELECT unvan FROM KRY_ORGANIZASYON WHERE id = @id", new { id });

        if (string.IsNullOrWhiteSpace(unvan))
            return NotFound(new { hata = "Kutu bulunamadı." });

        var anahtar = UnvanAnahtari(unvan);

        /* Bu kutuya elle bağlanmış ünvanlar */
        var elleBagli = db.Query<string>(@"
SELECT unvan FROM KRY_ORG_ESLESME WHERE kutu_id = @id", new { id })
            .Select(UnvanAnahtari)
            .ToHashSet(StringComparer.Ordinal);

        try
        {
            var liste = BolgeyeGoreSuz(PersonelleriGetir())
                .Where(x => x.Durum == 1)
                .Where(x =>
                {
                    var a = UnvanAnahtari(x.Pozisyon);
                    return a == anahtar || elleBagli.Contains(a);
                })
                .OrderBy(x => x.IsGrubu)
                .ThenBy(x => x.Ad)
                .ToList();

            AlanlariSinirla(liste);

            return Ok(new { unvan, adet = liste.Count, kisiler = liste });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Ünvan personeli alınamadı");

            return StatusCode(502, new
            {
                hata = "Personel listesi alınamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }
    }

    /// <summary>
    /// Mikro'daki tüm ünvanlar ve eşleştirme durumları.
    ///
    /// Şemada karşılığı bulunmayan ünvanlar burada görünür; panelden
    /// bir kutuya bağlanabilir.
    /// </summary>
    /// <summary>
    /// Kutu ekler ya da düzenler: ünvan, bağlı olduğu kutu, renk, mağaza
    /// kutusu mu, izin onaylar mı.
    ///
    /// <para>
    /// Şema eskiden yalnızca okunuyordu; kurulumda bir kez yazılıyor ve
    /// değiştirmek için veritabanına girmek gerekiyordu. Artık yıllık izin
    /// onayı bu şemadan yürüdüğü için "kim kime bağlı" panelden
    /// düzenlenebilmeli.
    /// </para>
    ///
    /// <para>
    /// Kutu kendi altına taşınamıyor: döngü, onay zincirinde sonsuz
    /// yukarı çıkma demek.
    /// </para>
    /// </summary>
    [HttpPost("Organizasyon")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult OrganizasyonKaydet([FromBody] OrgKutu girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Unvan))
            return BadRequest(new { hata = "Ünvan giriniz." });

        using var db = _vt.Baglanti();

        if (girdi.UstId is int ust)
        {
            if (girdi.Id > 0 && ust == girdi.Id)
                return BadRequest(new { hata = "Kutu kendine bağlanamaz." });

            /* Döngü denetimi: yeni üstten köke çıkarken bu kutuya
               rastlanırsa kutu kendi altına taşınıyor demektir. */
            var ustler = db.Query("SELECT id, ust_id FROM KRY_ORGANIZASYON WHERE aktif = 1")
                .ToDictionary(x => (int)x.id, x => (int?)x.ust_id);

            var simdi = (int?)ust;
            var adim = 0;

            while (simdi is int k && adim++ < 200)
            {
                if (girdi.Id > 0 && k == girdi.Id)
                    return BadRequest(new { hata = "Kutu kendi altındaki bir kutuya bağlanamaz." });

                simdi = ustler.TryGetValue(k, out var u) ? u : null;
            }
        }

        var renk = new[] { "yesil", "mavi", "turuncu", "kirmizi", "mor", "gri", "bej" }
            .Contains(girdi.Renk ?? "") ? girdi.Renk : "gri";

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_ORGANIZASYON SET
    ust_id = @UstId, unvan = @Unvan, renk = @renk, sira = @Sira,
    magaza_mi = @MagazaMi, izin_onay = @IzinOnay, aciklama = @Aciklama
WHERE id = @Id", new
            {
                girdi.Id, girdi.UstId, Unvan = girdi.Unvan.Trim(), renk, girdi.Sira,
                girdi.MagazaMi, girdi.IzinOnay, girdi.Aciklama
            });
        }
        else
        {
            girdi.Id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_ORGANIZASYON (ust_id, unvan, renk, sira, magaza_mi, izin_onay, aciklama)
OUTPUT INSERTED.id
VALUES (@UstId, @Unvan, @renk, @Sira, @MagazaMi, @IzinOnay, @Aciklama)", new
            {
                girdi.UstId, Unvan = girdi.Unvan.Trim(), renk, girdi.Sira,
                girdi.MagazaMi, girdi.IzinOnay, girdi.Aciklama
            });
        }

        OrgOnayServisi.Unut();

        return Ok(new { basarili = true, id = girdi.Id });
    }

    /// <summary>
    /// Kutuyu kaldırır. Altındaki kutular silinen kutunun üstüne bağlanıyor:
    /// ara bir kademeyi kaldırmak, altındaki bütün ekibi şemadan
    /// düşürmemeli.
    /// </summary>
    /// <summary>
    /// Tuvalde taşınan kutuların konumları.
    ///
    /// Birden çok kutu tek istekte: sürükleme bittiğinde yalnızca taşınan
    /// kutu, otomatik yerleştirmede bütün şema gönderiliyor.
    /// </summary>
    /// <summary>
    /// Ünvan karşılaştırması: tanım tablosundaki ünvan ile personel
    /// kartındaki meslek alanı hangi personelde farklı.
    ///
    /// <para>
    /// Ünvan adı ada göre eşleşen her yerde kullanılıyor: portal grupları,
    /// izin onay tablosu, organizasyon şeması eşleştirmesi ve maaş
    /// skalası. Kaynak değiştirilince hangi adların değiştiğini önceden
    /// görmek gerekiyor; bu uç onu listeliyor.
    /// </para>
    /// </summary>
    [HttpGet("UnvanKarsilastir")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
    public IActionResult UnvanKarsilastir()
    {
        using var db = _vt.PersonelBaglantisi();

        var satirlar = db.Query(@"
SELECT
    LTRIM(RTRIM(ISNULL(PUT.un_aciklama, N'')))                                  AS tanim,
    LTRIM(RTRIM(ISNULL(CAST(P.per_kim_meslek AS NVARCHAR(200)), N'')))          AS meslek,
    COUNT(*)                                                                    AS kisi
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) < 1950)
GROUP BY LTRIM(RTRIM(ISNULL(PUT.un_aciklama, N''))),
         LTRIM(RTRIM(ISNULL(CAST(P.per_kim_meslek AS NVARCHAR(200)), N'')))
ORDER BY COUNT(*) DESC", commandTimeout: 120)
            .Select(x => new
            {
                tanim = (string)x.tanim,
                meslek = (string)x.meslek,
                kisi = (int)x.kisi,
            })
            .ToList();

        return Ok(new
        {
            /* Yeni kaynakta ünvanı değişecek personel: tanım dolu ve
               meslekten farklı */
            farkli = satirlar
                .Where(x => x.tanim.Length > 0 && x.meslek.Length > 0
                            && !string.Equals(x.tanim, x.meslek, StringComparison.OrdinalIgnoreCase))
                .ToList(),

            /* Tanım boş: bunlarda eskisi gibi meslek alanı kullanılacak */
            tanimBos = satirlar.Where(x => x.tanim.Length == 0 && x.meslek.Length > 0).ToList(),

            /* İkisi de boş: ünvanı "Belirtilmemiş" görünen personel */
            ikisiBos = satirlar.Where(x => x.tanim.Length == 0 && x.meslek.Length == 0).Sum(x => x.kisi),

            toplamFarkliKisi = satirlar
                .Where(x => x.tanim.Length > 0 && x.meslek.Length > 0
                            && !string.Equals(x.tanim, x.meslek, StringComparison.OrdinalIgnoreCase))
                .Sum(x => x.kisi),
        });
    }

    [HttpPost("Organizasyon/Konum")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult OrganizasyonKonum([FromBody] List<OrgKonum> girdi)
    {
        if (girdi is null || girdi.Count == 0) return Ok(new { basarili = true });

        using var db = _vt.Baglanti();
        db.Open();

        using var islem = db.BeginTransaction();

        foreach (var k in girdi.Take(1000))
            db.Execute(@"
UPDATE KRY_ORGANIZASYON
SET konum_x = @X, konum_y = @Y, genislik = COALESCE(@Genislik, genislik)
WHERE id = @Id AND aktif = 1",
                new
                {
                    k.Id,
                    X = Math.Clamp(k.X, 0, 20000),
                    Y = Math.Clamp(k.Y, 0, 20000),
                    Genislik = k.Genislik is null ? (int?)null : Math.Clamp(k.Genislik.Value, 80, 1200),
                }, islem);

        islem.Commit();

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Şemayı sıfırlar: bütün kutular pasife alınıyor, elle yapılmış ünvan
    /// eşleştirmeleri siliniyor.
    ///
    /// <para>
    /// Kutular silinmiyor, pasife alınıyor: yanlışlıkla sıfırlanan şema
    /// veritabanından geri getirilebilsin. Şema boşken yıllık izin
    /// talepleri birim ve üst yönetici aşamalarını atlayıp doğrudan
    /// İnsan Kaynakları'na düşer; ekran bunu sıfırlamadan önce söylüyor.
    /// </para>
    /// </summary>
    [HttpPost("Organizasyon/Sifirla")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult OrganizasyonSifirla([FromBody] OrgSifirlaGirdi girdi)
    {
        if (!string.Equals((girdi?.Onay ?? "").Trim(), "SIFIRLA", StringComparison.Ordinal))
            return BadRequest(new { hata = "Onay için SIFIRLA yazınız." });

        using var db = _vt.Baglanti();
        db.Open();

        using var islem = db.BeginTransaction();

        var adet = db.Execute("UPDATE KRY_ORGANIZASYON SET aktif = 0 WHERE aktif = 1", transaction: islem);
        db.Execute("DELETE FROM KRY_ORG_ESLESME", transaction: islem);

        islem.Commit();

        OrgOnayServisi.Unut();

        _kayit.LogWarning("Organizasyon şeması sıfırlandı: {Adet} kutu — {Kullanici}",
            adet, User?.Identity?.Name);

        return Ok(new { basarili = true, adet });
    }

    [HttpDelete("Organizasyon/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult OrganizasyonSil(int id)
    {
        using var db = _vt.Baglanti();

        var ust = db.QueryFirstOrDefault<int?>(
            "SELECT ust_id FROM KRY_ORGANIZASYON WHERE id = @id", new { id });

        db.Execute("UPDATE KRY_ORGANIZASYON SET ust_id = @ust WHERE ust_id = @id AND aktif = 1",
            new { ust, id });

        db.Execute("UPDATE KRY_ORGANIZASYON SET aktif = 0 WHERE id = @id", new { id });

        /* Bu kutuya elle eşlenmiş ünvanlar boşa çıkıyor */
        db.Execute("UPDATE KRY_ORG_ESLESME SET kutu_id = NULL WHERE kutu_id = @id", new { id });

        OrgOnayServisi.Unut();

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Bir personelin yıllık izin onay zinciri: kutusu, birim yöneticisi,
    /// üst yöneticisi. Şemayı düzenlerken sonucu görmek için.
    /// </summary>
    [HttpGet("Organizasyon/OnayZinciri")]
    public IActionResult OnayZinciri([FromQuery] string sicil,
        [FromServices] OrgOnayServisi orgOnay)
    {
        var p = PersonelleriGetir().FirstOrDefault(x =>
            string.Equals((x.PersonelKodu ?? "").Trim(), (sicil ?? "").Trim(), StringComparison.OrdinalIgnoreCase));

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var (birim, ust, birimUnvan, ustUnvan) = orgOnay.Onaylayicilar(p.PersonelKodu, p.Pozisyon, p.IsGrubu);

        object Liste(List<PersonelKaydi> l) =>
            l.Select(x => new { sicil = x.PersonelKodu, adSoyad = $"{x.Ad} {x.Soyad}".Trim(), sube = x.IsGrubu });

        return Ok(new
        {
            personel = new { sicil = p.PersonelKodu, adSoyad = $"{p.Ad} {p.Soyad}".Trim(), pozisyon = p.Pozisyon, sube = p.IsGrubu },
            birimYoneticisi = new { unvan = birimUnvan, kisiler = Liste(birim) },
            ustYonetici = new { unvan = ustUnvan, kisiler = Liste(ust) },
        });
    }

    [HttpGet("OrganizasyonEslesme")]
    public IActionResult OrganizasyonEslesme()
    {
        using var db = _vt.Baglanti();

        var kutular = db.Query<OrgKutu>(@"
SELECT id AS Id, unvan AS Unvan FROM KRY_ORGANIZASYON WHERE aktif = 1
ORDER BY unvan").ToList();

        var elleEslesme = db.Query(@"
SELECT unvan AS unvan, kutu_id AS kutuId FROM KRY_ORG_ESLESME")
            .ToDictionary(x => (string)x.unvan, x => (int?)x.kutuId);

        List<PersonelKaydi> personeller;

        try
        {
            personeller = BolgeyeGoreSuz(PersonelleriGetir())
                .Where(x => x.Durum == 1)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Ünvan listesi alınamadı");

            return StatusCode(502, new
            {
                hata = "Personel listesi alınamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        var unvanlar = personeller
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .GroupBy(x => x.Pozisyon.Trim())
            .Select(g =>
            {
                var anahtar = UnvanAnahtari(g.Key);

                var otomatik = kutular
                    .FirstOrDefault(k => UnvanAnahtari(k.Unvan) == anahtar);

                elleEslesme.TryGetValue(g.Key, out var elle);

                return new
                {
                    unvan = g.Key,
                    kisiSayisi = g.Count(),
                    otomatikKutuId = otomatik?.Id,
                    otomatikKutu = otomatik?.Unvan,
                    elleKutuId = elle,
                    eslesti = otomatik is not null || elle is not null
                };
            })
            .OrderBy(x => x.eslesti)
            .ThenByDescending(x => x.kisiSayisi)
            .ToList();

        return Ok(new
        {
            kutular = kutular.Select(k => new { k.Id, k.Unvan }),
            unvanlar,
            eslesmeyenSayisi = unvanlar.Count(x => !x.eslesti)
        });
    }

    /// <summary>Bir ünvanı bir kutuya bağlar; kutuId boşsa bağ kaldırılır.</summary>
    [HttpPost("OrganizasyonEslesme")]
    public IActionResult OrganizasyonEslesmeKaydet(
        [FromBody] OrgEslesmeGirdi girdi)
    {
        /* Salt okunur rol, koddaki izne bakılmaksızın değişiklik yapamaz */
        if (_yetki.SaltOkunur(Rol) ||
            (!Roller.TamYonetim(Rol) && !Roller.IslemYetkisi(Rol)))
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Unvan))
            return BadRequest(new { hata = "Ünvan gereklidir." });

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_ORG_ESLESME AS h
USING (SELECT @unvan AS unvan) AS k ON h.unvan = k.unvan
WHEN MATCHED THEN
    UPDATE SET kutu_id = @kutuId, kullanici = @kullanici,
               olusturma = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (unvan, kutu_id, kullanici)
    VALUES (@unvan, @kutuId, @kullanici);",
            new
            {
                unvan = girdi.Unvan.Trim(),
                kutuId = girdi.KutuId,
                kullanici = Kullanici
            });

        OrgOnayServisi.Unut();

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Ünvan adını karşılaştırılabilir anahtara indirger.
    ///
    /// Şemadaki ad ile Mikro'daki ad birebir aynı olmayabilir
    /// ("Manav Şefi" / "MANAV ŞEFİ" / "Manav Şefi (Mağaza)").
    /// </summary>
    internal static string UnvanAnahtari(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return "";

        var buyuk = metin.Trim().ToUpperInvariant();

        /* Parantez içi açıklamalar atılır */
        var parantez = buyuk.IndexOf('(');
        if (parantez > 0) buyuk = buyuk[..parantez];

        foreach (var (k, h) in new[]
        {
            ('İ', 'I'), ('Ş', 'S'), ('Ğ', 'G'),
            ('Ü', 'U'), ('Ö', 'O'), ('Ç', 'C')
        })
        {
            buyuk = buyuk.Replace(k, h);
        }

        var temiz = new string(buyuk.Where(char.IsLetterOrDigit).ToArray());

        /* 'Personeli' eki bazı ünvanlarda var, bazısında yok */
        foreach (var ek in new[] { "PERSONELI", "PERSONEL" })
        {
            if (temiz.EndsWith(ek, StringComparison.Ordinal) && temiz.Length > ek.Length)
                return temiz[..^ek.Length];
        }

        return temiz;
    }

    /* ==================================================================== */
    /* Personel takip                                                        */
    /* ==================================================================== */

    /// <summary>Sicil karşılaştırması: baştaki sıfırlar ve boşluklar yok sayılır</summary>
    private static string TakipK(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Takip dönemi adı → anket aşama kodu</summary>
    private static readonly (string Ad, string Kod)[] TakipDonemAdlari =
    {
        ("Oryantasyon", "7g"),
        ("2. Ay", "2a"),
        ("6. Ay", "6a"),
        ("1. Yıl", "1y")
    };

    /// <summary>
    /// Takip dönemleri: pencereler Yönetim → Form Ayarları'ndan gelir
    /// (<c>UyumGonderimServisi.Pencereler</c>); gönderimle aynı tanım.
    /// </summary>
    private (string Ad, int EnAz, int EnFazla)[] TakipDonemleri()
    {
        var aralik = UyumGonderimServisi.Pencereler(_ayar.FormOku());

        return TakipDonemAdlari
            .Select(x => (x.Ad, aralik[x.Kod].enAz, aralik[x.Kod].enFazla))
            .ToArray();
    }

    /// <summary>
    /// Takip görüşmesi zamanı gelen personel.
    ///
    /// İşe girişten sonra 7 gün, 2 ay, 6 ay ve 1 yıl dolduğunda İK'nın
    /// personeli arayıp durumunu öğrenmesi beklenir. Her dönem için bir
    /// tolerans aralığı vardır; o aralıktaki personel listelenir.
    /// Görüşme yapıldığında not eklenir ve dönem tamamlanmış sayılır.
    /// </summary>
    [HttpGet("Takip")]
    public IActionResult Takip()
    {
        List<PersonelKaydi> tumu;

        try
        {
            tumu = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Takip listesi alınamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        /* Tamamlanmış görüşmeler */
        List<dynamic> notlar;

        /* Çalışan anketleri: aynı dönemin anketi gönderilmiş mi, doldurulmuş
           mu, süresi dolmuş mu. Kişi başına en son gönderim geçerli sayılır. */
        List<dynamic> anketler;
        List<dynamic> yoneticiAnketleri;
        var yoneticiDavetleri = new List<dynamic>();
        var kisiYoneticiFormlari =
            new Dictionary<string, UyumController.YoneticiFormu>(StringComparer.OrdinalIgnoreCase);
        HashSet<string> uygulamaKullananlar;

        using (var db = _vt.Baglanti())
        {
            notlar = db.Query(@"
SELECT personel_kodu AS kod, donem AS donem, durum AS durum,
       not_metni AS notMetni, kullanici AS kullanici, tarih AS tarih
FROM KRY_PERSONEL_TAKIP
ORDER BY tarih DESC").ToList();

            anketler = db.Query(@"
SELECT id, personel_kodu AS kod, asama, olusturma, gecerlilik, dolduruldu, puan,
       kanal, hatirlatma
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'calisan' AND personel_kodu IS NOT NULL
ORDER BY olusturma DESC").ToList();

            /* Eski SMS yönetici bağlantısı birim başına giderdi; kişiye
               değil şubeye bağlıdır. Kişinin satırında hangi yöneticiye
               gittiği görünsün diye şube + aşama ile eşlenir. Uygulamadan
               yapılan değerlendirme satırları (kanal = uygulama) yöneticiye
               aittir, şubeye değil; onlar aşağıda kişi bazında okunur. */
            yoneticiAnketleri = db.Query(@"
SELECT sube_adi AS sube, asama, ad_soyad AS adSoyad, telefon,
       olusturma, gecerlilik, dolduruldu, cevaplar_json AS json
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici'
  AND (kanal IS NULL OR kanal <> 'uygulama')
ORDER BY olusturma DESC").ToList();

            /* İK'nın Biçen360'ta yöneticiye açtığı değerlendirmeler (davet
               satırları): kişiye bağlı, doldurulmamış. Liste olusturma DESC;
               kişi + aşama için ilk eşleşen en son açılan. */
            try
            {
                yoneticiDavetleri = db.Query(@"
SELECT personel_kodu AS kod, asama, ad_soyad AS adSoyad, telefon, olusturma, gecerlilik
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND kanal = 'uygulama'
  AND personel_kodu IS NOT NULL AND dolduruldu IS NULL
ORDER BY olusturma DESC").ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Yönetici davetleri okunamadı");
            }

            /* Kişi için doldurulmuş yönetici formu (SMS ya da uygulama) ve
               uygulamayı kullananlar: kanal sütunu ve yöneticinin uygulamadan
               değerlendirip değerlendirmediği buradan çıkar. */
            try { kisiYoneticiFormlari = UyumController.KisiBazindaYoneticiFormlari(db); }
            catch (Exception hata) { _kayit.LogWarning(hata, "Yönetici formları okunamadı"); }

            uygulamaKullananlar = UyumController.UygulamaKullananlar(db);
        }

        /* Personelin yöneticileri (Ekibim'de onu görenler). Değerlendirmeyi
           Biçen360'tan yaparlar. Hesap kişi başına bir kez. */
        var ekip = HttpContext?.RequestServices?.GetService(typeof(EkipServisi)) as EkipServisi;
        var departman = HttpContext?.RequestServices?.GetService(typeof(DepartmanServisi)) as DepartmanServisi;
        var yoneticiBellek = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        List<string> UygulamadakiYoneticileri(string kod)
        {
            var k = TakipK(kod);

            if (yoneticiBellek.TryGetValue(k, out var l)) return l;

            try
            {
                l = ekip is null || departman is null
                    ? new List<string>()
                    : MazeretBelgeGorevi.Yoneticileri(ekip, departman, kod)
                        .Where(x => uygulamaKullananlar.Contains(TakipK(x)))
                        .ToList();
            }
            catch
            {
                l = new List<string>();
            }

            return yoneticiBellek[k] = l;
        }

        string KisiAdi(string sicil)
        {
            try
            {
                var p = ekip?.Kisi(sicil);
                return p is null ? null : $"{p.Ad} {p.Soyad}".Trim();
            }
            catch
            {
                return null;
            }
        }

        /* Takip dönemi adı ile anket aşama kodu arasındaki karşılık */
        static string AsamaKodu(string donem) => donem switch
        {
            "Oryantasyon" => "7g",
            "2. Ay" => "2a",
            "6. Ay" => "6a",
            "1. Yıl" => "1y",
            _ => null
        };

        var calisanlar = tumu.Where(x => x.Durum == 1 && x.GirisTarihi is not null).ToList();
        var donemler = new List<object>();
        var tumDonemler = TakipDonemleri();

        /* Kaçırılan kişinin gireceği sonraki dönem */
        string Sonraki(int gecen) =>
            tumDonemler.Where(d => d.EnAz > gecen).Select(d => $"{d.Ad} · {d.EnAz}. gün").FirstOrDefault();

        foreach (var (ad, enAz, enFazla) in tumDonemler)
        {
            var kisiler = new List<TakipKisisi>();

            foreach (var kisi in calisanlar)
            {
                /* Giriş günü 1. gün sayılır; sayım UyumAnaliz.KacinciGun ile
                   anket gönderimiyle aynı */
                var gecen = UyumAnaliz.KacinciGun(kisi.GirisTarihi!.Value);

                var asamaKoduOn = AsamaKodu(ad);

                /* Pencere dışındaysa yalnızca bir şartla kalır: bu dönem için
                   son 45 günde gönderilmiş ve yanıtlanmamış anketi var. İK
                   yeniden gönderebilsin diye listede tutulur; aksi hâlde
                   pencere kapanınca düşer. */
                var pencereDisi = gecen < enAz || gecen > enFazla;

                if (pencereDisi)
                {
                    var yanitsiz = asamaKoduOn is not null && anketler.Any(a =>
                        string.Equals(((string)a.kod ?? "").Trim(),
                            (kisi.PersonelKodu ?? "").Trim(),
                            StringComparison.OrdinalIgnoreCase) &&
                        (string)a.asama == asamaKoduOn &&
                        a.dolduruldu is null &&
                        (DateTime)a.olusturma >= DateTime.Today.AddDays(-45));

                    if (!yanitsiz) continue;
                }

                var kayit = notlar.FirstOrDefault(n =>
                    string.Equals((string)n.kod, kisi.PersonelKodu,
                        StringComparison.OrdinalIgnoreCase) &&
                    (string)n.donem == ad);

                var asamaKodu = AsamaKodu(ad);

                /* Liste olusturma DESC sıralı; ilk eşleşen en son gönderim */
                var anket = asamaKodu is null ? null : anketler.FirstOrDefault(a =>
                    string.Equals(((string)a.kod ?? "").Trim(),
                        (kisi.PersonelKodu ?? "").Trim(),
                        StringComparison.OrdinalIgnoreCase) &&
                    (string)a.asama == asamaKodu);

                string anketDurumu = null;

                if (anket is not null)
                    anketDurumu = anket.dolduruldu is not null ? "dolduruldu"
                        : (DateTime)anket.gecerlilik < DateTime.Now ? "suresiDoldu"
                        : "bekliyor";

                /* Gönderim yapılmadan da kime gideceği görünsün: İK 'bu
                   şubede müdür var, neden eşleşmemiş' diye bakıyordu.
                   Aynı kural gönderimde kullanılır. */
                var (adayAdi, adayTelefon, adayKaynak) =
                    _yoneticiBulucu.Bul(tumu, kisi.Sube, kisi.Pozisyon);

                /* Yönetici durumu üç kaynaktan, öncelik sırasıyla:

                   1) Bu kişi için doldurulmuş yönetici formu (SMS bağlantısı
                      ya da uygulama). Kişi formun içindeki koddan bulunur.
                   2) İK'nın Biçen360'ta yöneticiye açtığı değerlendirme
                      (davet satırı): açıksa bekliyor, değilse süresi doldu.
                   3) Şubeye giden eski SMS bağlantısı: açıksa bekliyor.
                   4) Yöneticisi Biçen360 kullanıyorsa anket açık oldukça
                      değerlendirme uygulamada bekler.

                   SMS bağlantısı doldurulmuş ama bu kişi o formda yoksa
                   (yönetici şubeden başka birini değerlendirmiş) kişi
                   "doldurdu" sayılmaz; bağlantı açıksa bekliyor, değilse
                   süresi doldu. */
                var yForm = asamaKodu is null ? null
                    : kisiYoneticiFormlari.GetValueOrDefault($"{TakipK(kisi.PersonelKodu)}|{asamaKodu}");

                var yAnket = asamaKodu is null || yForm is not null ? null : yoneticiAnketleri.FirstOrDefault(a =>
                    (string)a.asama == asamaKodu &&
                    string.Equals(((string)a.sube ?? "").Trim(),
                        (kisi.IsGrubu ?? "").Trim(),
                        StringComparison.OrdinalIgnoreCase));

                var uygulamadakiYoneticiler = yForm is null
                    ? UygulamadakiYoneticileri(kisi.PersonelKodu)
                    : new List<string>();

                /* Biçen360'ta bu kişi için yöneticiye açılmış değerlendirme */
                var yDavet = asamaKodu is null || yForm is not null ? null : yoneticiDavetleri.FirstOrDefault(a =>
                    (string)a.asama == asamaKodu &&
                    TakipK((string)a.kod) == TakipK(kisi.PersonelKodu));

                string yDurum = null, yKanal = null, yAdi = null, yTelefon = null;
                DateTime? yGonderim = null, yGecerlilik = null, yDolduruldu = null;

                if (yForm is not null)
                {
                    yDurum = "dolduruldu";
                    yKanal = yForm.Kanal;
                    yAdi = yForm.AdSoyad;
                    yTelefon = yForm.Telefon;
                    yGonderim = yForm.Olusturma;
                    yGecerlilik = yForm.Gecerlilik;
                    yDolduruldu = yForm.Dolduruldu;
                }
                else if (yDavet is not null)
                {
                    /* Kart, davet ya da personelin anketi açık oldukça görünür */
                    var son = (DateTime)yDavet.gecerlilik;

                    if (anket is not null && (DateTime)anket.gecerlilik > son)
                        son = (DateTime)anket.gecerlilik;

                    yDurum = son > DateTime.Now ? "bekliyor" : "suresiDoldu";
                    yKanal = "uygulama";
                    yAdi = (string)yDavet.adSoyad;
                    yTelefon = (string)yDavet.telefon;
                    yGonderim = (DateTime?)yDavet.olusturma;
                    yGecerlilik = son;
                }
                else if (yAnket is not null && yAnket.dolduruldu is null
                         && (DateTime)yAnket.gecerlilik >= DateTime.Now)
                {
                    yDurum = "bekliyor";
                    yKanal = "sms";
                }
                else if (uygulamadakiYoneticiler.Count > 0 && anket is not null)
                {
                    yDurum = (DateTime)anket.gecerlilik > DateTime.Now ? "bekliyor" : "suresiDoldu";
                    yKanal = "uygulama";
                    yAdi = string.Join(", ", uygulamadakiYoneticiler.Select(KisiAdi).Where(x => x is not null));
                    yGonderim = (DateTime?)anket.olusturma;
                    yGecerlilik = (DateTime?)anket.gecerlilik;
                }
                else if (yAnket is not null)
                {
                    yKanal = "sms";

                    var formdakiKodlar = UyumAnaliz.Formlar((string)yAnket.json)
                        .Select(f => f.PersonelKodu)
                        .Where(x => !string.IsNullOrWhiteSpace(x))
                        .ToList();

                    yDurum = yAnket.dolduruldu is not null && formdakiKodlar.Count == 0
                        ? "dolduruldu"
                        : (DateTime)yAnket.gecerlilik < DateTime.Now ? "suresiDoldu"
                        : "bekliyor";
                }
                else if (uygulamadakiYoneticiler.Count > 0)
                {
                    /* Henüz gönderim yok; gönderilince uygulamaya düşer */
                    yKanal = "uygulama";
                    yAdi = string.Join(", ", uygulamadakiYoneticiler.Select(KisiAdi).Where(x => x is not null));
                }

                if (yAnket is not null && yForm is null && yKanal == "sms")
                {
                    yAdi = (string)yAnket.adSoyad;
                    yTelefon = (string)yAnket.telefon;
                    yGonderim = (DateTime?)yAnket.olusturma;
                    yGecerlilik = (DateTime?)yAnket.gecerlilik;
                    yDolduruldu = yDurum == "dolduruldu" ? (DateTime?)yAnket.dolduruldu : null;
                }

                var uygulamada = uygulamaKullananlar.Contains(TakipK(kisi.PersonelKodu));

                /* Kaçırıldı: pencere geçti, anketler artık açık değil ve görüşme
                   notu yok. Bekleyen sayılmaz; zamanı gelince sonraki döneme girer. */
                var kacirildi = pencereDisi && kayit is null
                                && anketDurumu != "bekliyor" && yDurum != "bekliyor";

                kisiler.Add(new TakipKisisi
                {
                    PencereDisi = pencereDisi,
                    Kacirildi = kacirildi,
                    SonrakiDonem = kacirildi ? Sonraki(gecen) : null,
                    YoneticiAnketDurumu = yDurum,
                    YoneticiAdi = string.IsNullOrWhiteSpace(yAdi) ? adayAdi : yAdi,
                    YoneticiTelefon = yAdi is null && yTelefon is null ? adayTelefon : yTelefon,
                    YoneticiKaynak = adayKaynak,
                    YoneticiBulundu = adayTelefon is not null || uygulamadakiYoneticiler.Count > 0
                                      || yForm is not null || yDavet is not null,
                    YoneticiAnketGonderim = yGonderim,
                    YoneticiAnketGecerlilik = yGecerlilik,
                    YoneticiAnketDolduruldu = yDolduruldu,
                    YoneticiKanal = yKanal,
                    YoneticiPuan = yForm?.Puan,
                    UygulamaKullaniyor = uygulamada,
                    /* Eski kayıtlar SMS olarak kalır; gönderilmemişse anket
                       Biçen360'a gidecek */
                    AnketKanal = anket is not null
                        ? ((string)anket.kanal == "uygulama" ? "uygulama" : "sms")
                        : "uygulama",
                    AnketHatirlatma = anket is null ? null : (DateTime?)anket.hatirlatma,
                    AnketDurumu = anketDurumu,
                    AnketGonderim = anket is null ? null : (DateTime?)anket.olusturma,
                    AnketGecerlilik = anket is null ? null : (DateTime?)anket.gecerlilik,
                    AnketDolduruldu = anket is null || anket.dolduruldu is null
                        ? null : (DateTime?)anket.dolduruldu,
                    AnketPuan = anket is null || anket.puan is null
                        ? null : (decimal?)Convert.ToDecimal(anket.puan),
                    PersonelKodu = kisi.PersonelKodu,
                    Ad = kisi.Ad,
                    Soyad = kisi.Soyad,
                    KimlikNo = kisi.KimlikNo,
                    Telefon = kisi.Telefon,
                    IsGrubu = kisi.IsGrubu,
                    Pozisyon = kisi.Pozisyon,
                    GirisTarihi = kisi.GirisTarihi,
                    GecenGun = gecen,
                    /* Hedef güne kalan (eksi ise gün geçmiş demektir) */
                    /* Pencerenin son gününe kalan: 0 ise bugün son gün */
                    KalanGun = enFazla - gecen,
                    Tamamlandi = kayit is not null,
                    NotDurumu = kayit is null ? null : (string)kayit.durum,
                    NotMetni = kayit is null ? null : (string)kayit.notMetni,
                    NotTarihi = kayit is null ? null : (DateTime?)kayit.tarih,
                    NotKullanici = kayit is null ? null : (string)kayit.kullanici
                });
            }

            donemler.Add(new
            {
                donem = ad,
                hedefGun = enFazla,
                enAz,
                enFazla,
                toplam = kisiler.Count(x => !x.Kacirildi),
                bekleyen = kisiler.Count(x => !x.Tamamlandi && !x.Kacirildi),
                kacirilan = kisiler.Count(x => x.Kacirildi),
                kisiler = kisiler.OrderBy(x => x.Kacirildi).ThenBy(x => x.KalanGun).ToList()
            });
        }

        return Ok(new { donemler });
    }

    /// <summary>Takip görüşmesi notu kaydeder.</summary>
    [HttpPost("Takip")]
    public IActionResult TakipKaydet([FromBody] TakipGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.PersonelKodu) ||
            string.IsNullOrWhiteSpace(girdi?.Donem))
        {
            return BadRequest(new { hata = "Personel ve dönem bilgisi gereklidir." });
        }

        using var db = _vt.Baglanti();

        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_PERSONEL_TAKIP
           WHERE personel_kodu = @kod AND donem = @donem)
    UPDATE KRY_PERSONEL_TAKIP
    SET durum = @durum, not_metni = @not, kullanici = @kullanici,
        tarih = SYSDATETIME()
    WHERE personel_kodu = @kod AND donem = @donem
ELSE
    INSERT INTO KRY_PERSONEL_TAKIP
        (personel_kodu, kimlik_no, ad_soyad, donem, durum, not_metni, kullanici)
    VALUES (@kod, @kimlik, @adSoyad, @donem, @durum, @not, @kullanici)",
            new
            {
                kod = girdi.PersonelKodu.Trim(),
                kimlik = girdi.KimlikNo,
                adSoyad = girdi.AdSoyad,
                donem = girdi.Donem,
                durum = string.IsNullOrWhiteSpace(girdi.Durum) ? "Görüşüldü" : girdi.Durum,
                not = girdi.Not,
                kullanici = User?.Identity?.Name ?? "sistem"
            });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Geri dönen personel                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Daha önce çalışıp ayrılmış ve tekrar işe alınmış personel.
    ///
    /// Aynı kişinin farklı personel kodlarıyla açılmış kayıtları kimlik
    /// numarası üzerinden eşleştirilir. Çok kısa aralar (varsayılan 7 günden
    /// az) kayıt düzeltmesi sayılır ve geri dönüş kabul edilmez.
    /// </summary>
    [HttpGet("GeriDonenler")]
    public IActionResult GeriDonenler(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] int minAraGun = 7)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddYears(-1);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        List<PersonelKaydi> tumu;

        try
        {
            tumu = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Geri dönen personel verisi alınamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        bool DonemIcinde(DateTime? tarih) =>
            tarih is not null && tarih >= baslangic && tarih <= bitis;

        /* Kimlik numarası olmayan kayıtlar eşleştirilemez */
        var kimlikli = tumu
            .Where(x => !string.IsNullOrWhiteSpace(x.KimlikNo))
            .ToList();

        var donusler = new List<object>();
        var kimlikler = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var grup in kimlikli.GroupBy(x => x.KimlikNo.Trim()))
        {
            /* Kişinin tüm çalışma dönemleri, girişe göre sıralanır */
            var donemler = grup
                .Where(x => x.GirisTarihi is not null)
                .OrderBy(x => x.GirisTarihi)
                .ToList();

            if (donemler.Count < 2) continue;

            /* Ardışık dönem çiftleri incelenir: önceki çıkış → sonraki giriş */
            for (var i = 1; i < donemler.Count; i++)
            {
                var onceki = donemler[i - 1];
                var yeni = donemler[i];

                if (onceki.CikisTarihi is null) continue;
                if (!DonemIcinde(yeni.GirisTarihi)) continue;

                var araGun = (int)(yeni.GirisTarihi!.Value.Date
                                   - onceki.CikisTarihi.Value.Date).TotalDays;

                // Çok kısa aralar kayıt düzeltmesi sayılır
                if (araGun < minAraGun) continue;

                var ayniBirim = string.Equals(
                    BirimAnahtari(onceki.IsGrubu),
                    BirimAnahtari(yeni.IsGrubu),
                    StringComparison.OrdinalIgnoreCase);

                kimlikler.Add(grup.Key);

                donusler.Add(new
                {
                    kimlikNo = grup.Key,
                    ad = yeni.Ad,
                    soyad = yeni.Soyad,
                    personelKodu = yeni.PersonelKodu,

                    /* Önceki dönem */
                    oncekiKod = onceki.PersonelKodu,
                    oncekiBirim = onceki.IsGrubu,
                    oncekiUnvan = onceki.Pozisyon,
                    oncekiGiris = onceki.GirisTarihi,
                    oncekiCikis = onceki.CikisTarihi,
                    oncekiGun = onceki.CalismaGunu,
                    cikisSebebi = string.IsNullOrWhiteSpace(onceki.CikisSebebi)
                        ? "Belirtilmemiş"
                        : onceki.CikisSebebi,

                    /* Ara */
                    araGun,

                    /* Yeni dönem */
                    yeniBirim = yeni.IsGrubu,
                    yeniUnvan = yeni.Pozisyon,
                    yeniGiris = yeni.GirisTarihi,
                    yeniCikis = yeni.CikisTarihi,
                    yeniGun = yeni.CalismaGunu,
                    ayniBirim,
                    halenCalisiyor = yeni.Durum == 1
                });
            }
        }

        /* Payda: dönemde ayrılan benzersiz kişi sayısı */
        var ayrilanKisi = kimlikli
            .Where(x => DonemIcinde(x.CikisTarihi))
            .Select(x => x.KimlikNo.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();

        var geriDonen = kimlikler.Count;

        /* Dinamik listeden alan okumak yerine ara bir yapı kullanılır */
        var kayitlar = donusler
            .Select(x => (dynamic)x)
            .ToList();

        var halen = kayitlar.Count(x => (bool)x.halenCalisiyor);
        var tekrarAyrilan = kayitlar.Count - halen;
        var ayni = kayitlar.Count(x => (bool)x.ayniBirim);

        /* Çıkış sebebine göre: o sebeple ayrılanların kaçı döndü */
        var sebepler = kimlikli
            .Where(x => DonemIcinde(x.CikisTarihi) || x.CikisTarihi is not null)
            .GroupBy(x => string.IsNullOrWhiteSpace(x.CikisSebebi)
                ? "Belirtilmemiş"
                : x.CikisSebebi)
            .Select(g =>
            {
                var ayrilan = g.Select(x => x.KimlikNo.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase).Count();

                var donen = kayitlar
                    .Where(x => (string)x.cikisSebebi == g.Key)
                    .Select(x => (string)x.kimlikNo)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count();

                return new
                {
                    sebep = g.Key,
                    ayrilan,
                    donen,
                    oran = ayrilan > 0 ? Math.Round(donen * 100.0 / ayrilan, 1) : 0
                };
            })
            .Where(x => x.ayrilan > 0)
            .OrderByDescending(x => x.donen)
            .ToList();

        /* Ara süre bandına göre kalıcılık */
        object Bant(string ad, Func<int, bool> kural)
        {
            var icindekiler = kayitlar.Where(x => kural((int)x.araGun)).ToList();
            var kalici = icindekiler.Count(x => (bool)x.halenCalisiyor);

            return new
            {
                bant = ad,
                kisi = icindekiler.Count,
                kalici,
                oran = icindekiler.Count > 0
                    ? Math.Round(kalici * 100.0 / icindekiler.Count, 1)
                    : 0
            };
        }

        var bantlar = new[]
        {
            Bant("0 – 3 ay", g => g < 90),
            Bant("3 – 6 ay", g => g >= 90 && g < 180),
            Bant("6 ay ve üzeri", g => g >= 180)
        };

        /* Birim bazında geri dönüş */
        var birimler = kimlikli
            .Where(x => DonemIcinde(x.CikisTarihi))
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "Belirtilmemiş" : x.IsGrubu)
            .Select(g =>
            {
                var ayrilan = g.Select(x => x.KimlikNo.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase).Count();

                var donen = kayitlar
                    .Where(x => Benziyor(BirimAnahtari((string)x.oncekiBirim),
                                         BirimAnahtari(g.Key)))
                    .ToList();

                var ayniyaDonen = donen.Count(x => (bool)x.ayniBirim);
                var kalici = donen.Count(x => (bool)x.halenCalisiyor);

                return new
                {
                    birim = g.Key,
                    ayrilan,
                    donen = donen.Count,
                    oran = ayrilan > 0 ? Math.Round(donen.Count * 100.0 / ayrilan, 1) : 0,
                    ayniyaDonen,
                    kalicilik = donen.Count > 0
                        ? Math.Round(kalici * 100.0 / donen.Count, 1)
                        : 0
                };
            })
            .Where(x => x.ayrilan > 0)
            .OrderByDescending(x => x.donen)
            .ToList();

        /* Kıdem karşılaştırması: birinci dönem mi uzun, ikinci dönem mi */
        var birinciOrt = kayitlar.Count > 0
            ? kayitlar.Average(x => (double)(int)x.oncekiGun)
            : 0;

        var ikinciOrt = kayitlar.Count > 0
            ? kayitlar.Average(x => (double)(int)x.yeniGun)
            : 0;

        return Ok(new
        {
            baslangic,
            bitis = bitis.Date,
            minAraGun,

            geriDonen,
            ayrilanKisi,
            geriDonusOrani = ayrilanKisi > 0
                ? Math.Round(geriDonen * 100.0 / ayrilanKisi, 1)
                : 0,

            halenCalisan = halen,
            tekrarAyrilan,
            kalicilikOrani = kayitlar.Count > 0
                ? Math.Round(halen * 100.0 / kayitlar.Count, 1)
                : 0,

            ayniBirimeDonen = ayni,
            farkliBirimeDonen = kayitlar.Count - ayni,

            ortalamaAraGun = kayitlar.Count > 0
                ? (int)Math.Round(kayitlar.Average(x => (double)(int)x.araGun))
                : 0,

            birinciDonemOrtGun = (int)Math.Round(birinciOrt),
            ikinciDonemOrtGun = (int)Math.Round(ikinciOrt),

            sebepler,
            bantlar,
            birimler,
            kayitlar = donusler
        });
    }

    /* ==================================================================== */
    /* Maaş skalası                                                          */
    /* ==================================================================== */

    /// <summary>Pozisyon bazında maaş skalalarını döndürür.</summary>
    [HttpGet("MaasSkala")]
    public IActionResult MaasSkalaOku()
    {
        var ayar = _ayar.MaasOku();
        var form = _ayar.FormOku();

        /* Tanımlı tüm pozisyonlar; skalası olmayanlar da listelenir */
        var pozisyonlar = (form.BirimTurleri ?? new List<BirimTuru>())
            .SelectMany(x => x.Bolumler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new
        {
            ayar.Skalalar,
            ayar.Guncelleme,
            pozisyonlar
        });
    }

    /// <summary>Maaş skalalarını kaydeder (yalnızca yönetici).</summary>
    [HttpPost("MaasSkala")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult MaasSkalaKaydet([FromBody] List<MaasSkalasi> girdiler)
    {
        var temiz = (girdiler ?? new List<MaasSkalasi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Bolum))
            .Where(x => x.AltSinir > 0 || x.UstSinir > 0)
            .Select(x => new MaasSkalasi
            {
                Bolum = x.Bolum.Trim(),
                AltSinir = Math.Max(0, x.AltSinir),
                UstSinir = Math.Max(0, x.UstSinir),
                Aciklama = x.Aciklama
            })
            .ToList();

        _ayar.MaasYaz(new MaasAyarlari { Skalalar = temiz, Guncelleme = DateTime.Now });

        return Ok(new { basarili = true, adet = temiz.Count });
    }

    /// <summary>
    /// Maaşı skalanın dışında kalan personel. Pozisyon bazında gruplanır;
    /// satır açıldığında ilgili kişiler görünür.
    /// </summary>
    [HttpGet("SkalaAsimi")]
    public IActionResult SkalaAsimi()
    {
        var skalalar = _ayar.MaasOku().Skalalar ?? new List<MaasSkalasi>();

        if (skalalar.Count == 0)
            return Ok(new { skalaTanimiVar = false, pozisyonlar = Array.Empty<object>() });

        List<PersonelKaydi> tumu;

        try
        {
            tumu = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Skala aşımı hesaplanamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        /* Yalnızca çalışan ve ücreti tanımlı personel değerlendirilir */
        var calisanlar = tumu
            .Where(x => x.Durum == 1 && x.Ucret is > 0)
            .ToList();

        var pozisyonlar = new List<object>();
        var toplamUstunde = 0;
        var toplamAltinda = 0;
        decimal toplamAsim = 0;

        foreach (var skala in skalalar.OrderBy(x => x.Bolum))
        {
            var kisiler = calisanlar
                .Where(x => UnvanBenziyor(MeslekAnahtari(x.Pozisyon),
                                          MeslekAnahtari(skala.Bolum)))
                .ToList();

            if (kisiler.Count == 0) continue;

            var ustunde = kisiler
                .Where(x => skala.UstSinir > 0 && x.Ucret > skala.UstSinir)
                .ToList();

            var altinda = kisiler
                .Where(x => skala.AltSinir > 0 && x.Ucret < skala.AltSinir)
                .ToList();

            object Kart(PersonelKaydi k, decimal fark) => new
            {
                k.PersonelKodu,
                k.Ad,
                k.Soyad,
                k.IsGrubu,
                k.Pozisyon,
                k.GirisTarihi,
                k.CalismaGunu,
                ucret = k.Ucret,
                fark
            };

            toplamUstunde += ustunde.Count;
            toplamAltinda += altinda.Count;
            toplamAsim += ustunde.Sum(x => (x.Ucret ?? 0) - skala.UstSinir);

            pozisyonlar.Add(new
            {
                bolum = skala.Bolum,
                skala.AltSinir,
                skala.UstSinir,
                kisiSayisi = kisiler.Count,

                ortalamaUcret = Math.Round(kisiler.Average(x => x.Ucret ?? 0), 0),
                enDusuk = kisiler.Min(x => x.Ucret ?? 0),
                enYuksek = kisiler.Max(x => x.Ucret ?? 0),

                ustundeSayi = ustunde.Count,
                altindaSayi = altinda.Count,
                uygunSayi = kisiler.Count - ustunde.Count - altinda.Count,

                /* Üst sınırı aşan toplam tutar: aylık ek yük */
                asimTutari = ustunde.Sum(x => (x.Ucret ?? 0) - skala.UstSinir),

                ustundekiler = ustunde
                    .OrderByDescending(x => x.Ucret)
                    .Select(x => Kart(x, (x.Ucret ?? 0) - skala.UstSinir))
                    .ToList(),

                altindakiler = altinda
                    .OrderBy(x => x.Ucret)
                    .Select(x => Kart(x, skala.AltSinir - (x.Ucret ?? 0)))
                    .ToList()
            });
        }

        return Ok(new
        {
            skalaTanimiVar = true,
            toplamUstunde,
            toplamAltinda,
            toplamAsim = Math.Round(toplamAsim, 0),
            pozisyonlar
        });
    }

    /* ==================================================================== */
    /* Personel sirkülasyonu                                                 */
    /* ==================================================================== */

    /// <summary>
    /// Seçilen dönemde hangi birimden kaç kişi işe girmiş, kaç kişi ayrılmış,
    /// ne kadar süre çalışmışlar ve o birime personel bulmak ne kadar sürüyor.
    ///
    /// Giriş/çıkış bilgisi Mikro'dan, işe alım süresi ise başvuru sisteminden
    /// gelir; ikisi birim adına göre eşleştirilir.
    /// </summary>
    [HttpGet("Sirkulasyon")]
    public IActionResult Sirkulasyon(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddYears(-1);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        List<PersonelKaydi> tumu;

        try
        {
            tumu = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Sirkülasyon verisi alınamadı");
            return StatusCode(502, new
            {
                hata = "Personel veritabanına ulaşılamadı.",
                ayrinti = HataAyrintisi(hata)
            });
        }

        bool DonemIcinde(DateTime? tarih) =>
            tarih is not null && tarih >= baslangic && tarih <= bitis;

        /* Belirli bir tarihte çalışıyor muydu?
           O tarihten önce girmiş ve henüz çıkmamış olmalı. */
        bool OTarihteCalisiyor(PersonelKaydi kisi, DateTime tarih) =>
            kisi.GirisTarihi is not null &&
            kisi.GirisTarihi <= tarih &&
            (kisi.CikisTarihi is null || kisi.CikisTarihi > tarih);

        /* Dönemin kaç ay sürdüğü; yıllık orana çevirmek için kullanılır */
        var donemAy = Math.Max(1.0, (bitis - baslangic).TotalDays / 30.44);

        /* Başvuru sisteminden işe alım süreleri (birim adına göre) */
        var alimSureleri = new List<dynamic>();

        try
        {
            using var db = _vt.Baglanti();

            alimSureleri = db.Query(@"
SELECT sube_adi AS SubeAdi,
       AVG(CAST(ISNULL(doldurma_dakika, doldurma_gun * 1440) AS FLOAT)) AS Dakika,
       COUNT(*) AS Adet
FROM KRY_BASVURULAR
WHERE durum = N'İşe Alındı'
  AND ise_giris_tarihi BETWEEN @bas AND @bit
  AND (doldurma_dakika IS NOT NULL OR doldurma_gun IS NOT NULL)
GROUP BY sube_adi", new { bas = baslangic, bit = bitis }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İşe alım süreleri alınamadı");
        }

        /* ------------------------------------------------------ birim bazında */

        var birimler = tumu
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "Belirtilmemiş" : x.IsGrubu)
            .Select(g =>
            {
                var girenler = g.Where(x => DonemIcinde(x.GirisTarihi)).ToList();
                var cikanlar = g.Where(x => DonemIcinde(x.CikisTarihi)).ToList();
                var mevcut = g.Count(x => x.Durum == 1);

                /* Devir oranı, dönem içindeki ortalama çalışan sayısına
                   bölünür: (dönem başı + dönem sonu) / 2. Kadrosu büyüyen
                   veya küçülen birimlerde bugünkü sayıya bölmek yanıltıcıdır. */
                var donemBasi = g.Count(x => OTarihteCalisiyor(x, baslangic));
                var donemSonu = g.Count(x => OTarihteCalisiyor(x, bitis));

                var ortalamaCalisan = (donemBasi + donemSonu) / 2.0;
                if (ortalamaCalisan <= 0) ortalamaCalisan = mevcut;

                var devir = ortalamaCalisan > 0
                    ? Math.Round(cikanlar.Count * 100.0 / ortalamaCalisan, 1)
                    : 0;

                /* Aynı oranın yıllık karşılığı: dönemler karşılaştırılabilsin */
                var yillikDevir = Math.Round(devir * (12.0 / donemAy), 1);

                var alim = alimSureleri.FirstOrDefault(a =>
                    Benziyor(BirimAnahtari((string)a.SubeAdi), BirimAnahtari(g.Key)));

                return new
                {
                    birim = g.Key,
                    mevcut,
                    giren = girenler.Count,
                    cikan = cikanlar.Count,
                    net = girenler.Count - cikanlar.Count,
                    devirOrani = devir,
                    yillikDevir,
                    donemBasi,
                    donemSonu,
                    ortalamaCalisan = Math.Round(ortalamaCalisan, 1),

                    /* Ayrılanların o birimde ortalama kaç gün çalıştığı */
                    ortalamaCalismaGun = cikanlar.Count > 0
                        ? (int)Math.Round(cikanlar.Average(x => (double)x.CalismaGunu))
                        : 0,

                    enKisaGun = cikanlar.Count > 0 ? cikanlar.Min(x => x.CalismaGunu) : 0,

                    /* İlk yılını doldurmadan ayrılanlar */
                    erkenAyrilan = cikanlar.Count(x => x.CalismaGunu > 0 && x.CalismaGunu < 365),

                    /* En çok ayrılan pozisyonlar */
                    pozisyonlar = cikanlar
                        .GroupBy(x => string.IsNullOrWhiteSpace(x.Pozisyon) ? "Belirtilmemiş" : x.Pozisyon)
                        .Select(p => new { pozisyon = p.Key, adet = p.Count() })
                        .OrderByDescending(p => p.adet)
                        .Take(4)
                        .ToList(),

                    /* Bu birime personel bulmak ne kadar sürüyor */
                    alimDakika = alim is null ? 0 : (int)Math.Round((double)alim.Dakika),
                    alimAdet = alim is null ? 0 : (int)alim.Adet,

                    cikanlar = cikanlar
                        .OrderByDescending(x => x.CikisTarihi)
                        .Select(x => new
                        {
                            x.PersonelKodu,
                            x.Ad,
                            x.Soyad,
                            x.Pozisyon,
                            x.GirisTarihi,
                            x.CikisTarihi,
                            x.CalismaGunu,
                            x.CikisSebebi,
                            x.Durum
                        })
                        .ToList(),

                    /* Dönemde işe başlayanlar da listelenir */
                    girenler = girenler
                        .OrderByDescending(x => x.GirisTarihi)
                        .Select(x => new
                        {
                            x.PersonelKodu,
                            x.Ad,
                            x.Soyad,
                            x.Pozisyon,
                            x.GirisTarihi,
                            x.CikisTarihi,
                            x.CalismaGunu,
                            x.Durum
                        })
                        .ToList()
                };
            })
            .Where(x => x.giren > 0 || x.cikan > 0 || x.mevcut > 0)
            .OrderByDescending(x => x.cikan)
            .ToList();

        /* --------------------------------------------------- pozisyon bazında */

        var pozisyonlar = tumu
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Pozisyon) ? "Belirtilmemiş" : x.Pozisyon)
            .Select(g =>
            {
                var cikanlar = g.Where(x => DonemIcinde(x.CikisTarihi)).ToList();

                var girenler = g.Where(x => DonemIcinde(x.GirisTarihi)).ToList();

                return new
                {
                    pozisyon = g.Key,
                    mevcut = g.Count(x => x.Durum == 1),
                    giren = girenler.Count,
                    cikan = cikanlar.Count,
                    ortalamaCalismaGun = cikanlar.Count > 0
                        ? (int)Math.Round(cikanlar.Average(x => (double)x.CalismaGunu))
                        : 0,
                    erkenAyrilan = cikanlar.Count(x => x.CalismaGunu > 0 && x.CalismaGunu < 365),

                    /* Satır açıldığında görünecek kişiler */
                    cikanlar = cikanlar
                        .OrderByDescending(x => x.CikisTarihi)
                        .Select(x => new
                        {
                            x.PersonelKodu, x.Ad, x.Soyad, x.IsGrubu, x.Pozisyon,
                            x.GirisTarihi, x.CikisTarihi, x.CalismaGunu,
                            x.CikisSebebi, x.Durum
                        })
                        .ToList(),

                    girenler = girenler
                        .OrderByDescending(x => x.GirisTarihi)
                        .Select(x => new
                        {
                            x.PersonelKodu, x.Ad, x.Soyad, x.IsGrubu, x.Pozisyon,
                            x.GirisTarihi, x.CikisTarihi, x.CalismaGunu, x.Durum
                        })
                        .ToList()
                };
            })
            .Where(x => x.giren > 0 || x.cikan > 0)
            .OrderByDescending(x => x.cikan)
            .ToList();

        /* ------------------------------------------------------ çıkış sebepleri */

        var sebepler = tumu
            .Where(x => DonemIcinde(x.CikisTarihi))
            .GroupBy(x => string.IsNullOrWhiteSpace(x.CikisSebebi) ? "Belirtilmemiş" : x.CikisSebebi)
            .Select(g => new
            {
                sebep = g.Key,
                adet = g.Count(),
                kayitlar = g
                    .OrderByDescending(x => x.CikisTarihi)
                    .Select(x => new
                    {
                        x.PersonelKodu, x.Ad, x.Soyad, x.IsGrubu, x.Pozisyon,
                        x.GirisTarihi, x.CikisTarihi, x.CalismaGunu, x.Durum
                    })
                    .ToList()
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        var donemCikan = tumu.Count(x => DonemIcinde(x.CikisTarihi));
        var donemGiren = tumu.Count(x => DonemIcinde(x.GirisTarihi));
        var toplamMevcut = tumu.Count(x => x.Durum == 1);

        var genelBasi = tumu.Count(x => OTarihteCalisiyor(x, baslangic));
        var genelSonu = tumu.Count(x => OTarihteCalisiyor(x, bitis));

        var genelOrtalama = (genelBasi + genelSonu) / 2.0;
        if (genelOrtalama <= 0) genelOrtalama = toplamMevcut;

        return Ok(new
        {
            baslangic,
            bitis = bitis.Date,
            toplamMevcut,
            giren = donemGiren,
            cikan = donemCikan,
            net = donemGiren - donemCikan,
            devirOrani = genelOrtalama > 0
                ? Math.Round(donemCikan * 100.0 / genelOrtalama, 1)
                : 0,
            yillikDevir = genelOrtalama > 0
                ? Math.Round(donemCikan * 100.0 / genelOrtalama * (12.0 / donemAy), 1)
                : 0,
            donemBasiCalisan = genelBasi,
            donemSonuCalisan = genelSonu,
            ortalamaCalisan = Math.Round(genelOrtalama, 1),
            donemAy = Math.Round(donemAy, 1),
            ortalamaCalismaGun = donemCikan > 0
                ? (int)Math.Round(tumu.Where(x => DonemIcinde(x.CikisTarihi))
                    .Average(x => (double)x.CalismaGunu))
                : 0,
            birimler,
            pozisyonlar,
            sebepler
        });
    }

    /* ==================================================================== */
    /* Ad eşleştirmeleri                                                     */
    /* ==================================================================== */

    /// <summary>Kaydedilmiş eşleştirmeleri döndürür.</summary>
    /// <summary>
    /// Bir personelin kaydında yapılan değişikliklerin geçmişi.
    ///
    /// Mikro alan bazlı geçmiş tutmadığı için bu kayıtlar sistemin kendi
    /// karşılaştırmasından gelir: ilk taramadan öncesi ve iki tarama
    /// arasında yapılıp geri alınan değişiklikler görünmez.
    /// </summary>
    /* ==================================================================== */
    /* Sicil kartı eşleştirmeleri                                           */
    /* ==================================================================== */

    /// <summary>Sicil kartı açılırken kullanılacak kod eşleştirmeleri.</summary>
    [HttpGet("SicilAyari")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult SicilAyariOku() => Ok(_ayar.SicilOku());

    /// <summary>
    /// Eşleştirmeleri kaydeder. Yalnızca yönetici: bu kodlar bordroyu
    /// etkiler, yanlış bir değer sessizce yanlış hesaba işler.
    /// </summary>
    [HttpPost("SicilAyari")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult SicilAyariYaz([FromBody] SicilAyari girdi)
    {
        girdi ??= new SicilAyari();

        girdi.Unvanlar = (girdi.Unvanlar ?? new List<SicilUnvani>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Bolum))
            .ToList();

        girdi.Subeler = (girdi.Subeler ?? new List<SicilSubesi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.SubeAdi))
            .ToList();

        _ayar.SicilYaz(girdi);

        _kayit.LogInformation("Sicil kartı eşleştirmeleri güncellendi: {Kullanici}",
            Kullanici);

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Başvuru fotoğraflarını Mikro'ya elle aktarır.
    ///
    /// Aktarım normalde kendiliğinden çalışır; bu uç, yeni bir işe alımdan
    /// hemen sonra beklemek istemeyenler için.
    /// </summary>
    [HttpPost("FotograflariAktar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult FotograflariAktar()
    {
        try
        {
            var personeller = _personelKaynak.TumPersonelleriGetir();

            _degisim.FotograflariAktar(personeller, zorla: true);

            return Ok(new
            {
                basarili = true,
                mesaj = "Aktarım çalıştırıldı. Fotoğrafı olmayan personel için "
                        + "başvuru fotoğrafları Mikro'ya yazıldı."
            });
        }
        catch (Exception hata)
        {
            return StatusCode(500, new
            {
                hata = "Aktarım yapılamadı.",
                ayrinti = hata.Message
            });
        }
    }

    [HttpGet("Gecmis")]
    [Authorize]
    public IActionResult Gecmis([FromQuery] string kod)
    {
        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gerekli." });

        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT TOP 200
       alan            AS alan,
       eski_deger      AS eskiDeger,
       yeni_deger      AS yeniDeger,
       mikro_kullanici AS kullanici,
       tarih           AS tarih
FROM KRY_PERSONEL_DEGISIM
WHERE personel_kodu = @kod
ORDER BY tarih DESC", new { kod = kod.Trim() }).ToList();

        var izlemeBaslangici = db.ExecuteScalar<DateTime?>(
            "SELECT MIN(guncelleme) FROM KRY_PERSONEL_ANLIK");

        return Ok(new { liste, izlemeBaslangici });
    }

    [HttpGet("Eslestirme")]
    public IActionResult EslestirmeOku()
    {
        var ayar = _ayar.PersonelOku();

        List<string> isGruplari = new();
        List<string> unvanlar = new();

        try
        {
            var tumu = BolgeyeGoreSuz(PersonelleriGetir());

            isGruplari = tumu
                .Select(x => x.IsGrubu)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();

            unvanlar = tumu
                .Select(x => x.Pozisyon)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Eşleştirme listeleri alınamadı");
        }

        return Ok(new
        {
            ayar.IsGrubuEslemeleri,
            ayar.UnvanEslemeleri,
            /* Kadro ağırlıkları da döndürülmeli: panel bu uçtan okuduğu
               listeyi geri gönderiyor, eksik dönen alan kaydetmede boş
               listeyle üzerine yazılıp silinir. */
            ayar.Agirliklar,
            isGruplari,
            unvanlar
        });
    }

    /// <summary>Eşleştirmeleri kaydeder (yalnızca yönetici).</summary>
    [HttpPost("Eslestirme")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult EslestirmeKaydet([FromBody] PersonelAyarlari girdi)
    {
        girdi ??= new PersonelAyarlari();

        girdi.IsGrubuEslemeleri = (girdi.IsGrubuEslemeleri ?? new List<AdEslemesi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kaynak) &&
                        !string.IsNullOrWhiteSpace(x.Hedef))
            .ToList();

        girdi.UnvanEslemeleri = (girdi.UnvanEslemeleri ?? new List<AdEslemesi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kaynak) &&
                        !string.IsNullOrWhiteSpace(x.Hedef))
            .ToList();

        /* Kadro ağırlıkları: yalnızca 1 ve 0,5 kabul edilir; başka bir
           değer gönderilirse tam kadroya çekilir. */
        girdi.Agirliklar = (girdi.Agirliklar ?? new List<KadroAgirligi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Bolum))
            .Select(x => new KadroAgirligi
            {
                Bolum = x.Bolum.Trim(),
                Agirlik = x.Agirlik == 0.5m ? 0.5m : 1m
            })
            .ToList();

        _ayar.PersonelYaz(girdi);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Eski çalışanlar                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Daha önce çalışıp ayrılmış personelin kimlik numaraları.
    /// Başvurular ekranında "eski çalışan" işareti için kullanılır.
    /// </summary>
    [HttpGet("EskiCalisanlar")]
    public IActionResult EskiCalisanlar()
    {
        try
        {
            var tumu = BolgeyeGoreSuz(PersonelleriGetir());

            var kayitlar = tumu
                .Where(x => x.Durum != 1)
                .Where(x => !string.IsNullOrWhiteSpace(x.KimlikNo))
                .GroupBy(x => x.KimlikNo.Trim())
                .Select(g =>
                {
                    var son = g.OrderByDescending(x => x.CikisTarihi ?? DateTime.MinValue).First();

                    return new
                    {
                        kimlikNo = g.Key,
                        /* 26.10.2026: başvurudan personel kartını açmak için */
                        personelKodu = son.PersonelKodu,
                        adSoyad = $"{son.Ad} {son.Soyad}".Trim(),
                        sube = son.IsGrubu,
                        pozisyon = son.Pozisyon,
                        girisTarihi = son.GirisTarihi,
                        cikisTarihi = son.CikisTarihi,
                        calismaGunu = son.CalismaGunu,
                        cikisSebebi = son.CikisSebebi,
                        calismaSayisi = g.Select(x => x.PersonelKodu).Distinct().Count()
                    };
                })
                .ToList();

            return Ok(kayitlar);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Eski çalışan listesi alınamadı");
            // Liste alınamazsa başvurular ekranı yine de çalışsın
            return Ok(Array.Empty<object>());
        }
    }

    /// <summary>Şube ve pozisyon bazında personel dağılımı.</summary>
    [HttpGet("Ozet")]
    public IActionResult Ozet()
    {
        List<PersonelKaydi> liste;

        try
        {
            liste = PersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Personel özeti alınamadı");
            return StatusCode(502, new { hata = hata.Message });
        }

        var subeOzet = liste
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Sube) ? "Belirtilmemiş" : x.Sube)
            .Select(g => new
            {
                sube = g.Key,
                toplam = g.Count(),
                calisan = g.Count(x => x.Durum == 1),
                ayrilan = g.Count(x => x.Durum != 1)
            })
            .OrderByDescending(x => x.calisan)
            .ToList();

        var pozisyonOzet = liste
            .Where(x => x.Durum == 1)
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Pozisyon) ? "Belirtilmemiş" : x.Pozisyon)
            .Select(g => new { pozisyon = g.Key, calisan = g.Count() })
            .OrderByDescending(x => x.calisan)
            .ToList();

        return Ok(new { subeOzet, pozisyonOzet });
    }

    /// <summary>Aramada Türkçe harf ve büyük/küçük farkı yok sayılır.</summary>
    internal static string TrSade(string s) =>
        new string((s ?? "").ToLower(new System.Globalization.CultureInfo("tr-TR")).Select(c => c switch
        {
            'ı' => 'i', 'ş' => 's', 'ğ' => 'g', 'ü' => 'u', 'ö' => 'o', 'ç' => 'c', 'â' => 'a', 'î' => 'i', 'û' => 'u',
            _ => c,
        }).ToArray()).Replace("i\u0307", "i");

}

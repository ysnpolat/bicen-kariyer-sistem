using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İşe uyum ve geribildirim anketleri.
///
/// <para>
/// Dört aşama (7. gün, 2. ay, 6. ay, 1. yıl) ve iki taraf var: çalışanın
/// kendi formu ve mağaza müdürünün değerlendirmesi. Her gönderim kişiye ve
/// aşamaya özel bir bağlantı üretir.
/// </para>
///
/// <para>
/// Bağlantılar <b>72 saat</b> geçerlidir. Süre dolduktan sonra açılmaz;
/// yeniden gönderilmesi gerekir. Kısa tutulmasının sebebi, geribildirimin
/// değerlendirme dönemine yakın verilmesi: iki hafta sonra doldurulan bir
/// "ilk hafta" formu artık ilk haftayı ölçmez.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class UyumController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly SmsServisi _sms;
    private readonly AyarServisi _ayar;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly YoneticiBulucu _yonetici;
    private readonly UyumGonderimServisi _gonderim;
    private readonly ILogger<UyumController> _kayit;

    public UyumController(
        VeritabaniServisi vt, SmsServisi sms, AyarServisi ayar,
        PersonelKaynagiServisi personelKaynak, YoneticiBulucu yonetici,
        UyumGonderimServisi gonderim,
        ILogger<UyumController> kayit)
    {
        _vt = vt;
        _sms = sms;
        _ayar = ayar;
        _personelKaynak = personelKaynak;
        _yonetici = yonetici;
        _gonderim = gonderim;
        _kayit = kayit;
    }

    private static string TelefonSadelestir(string ham) =>
        YoneticiBulucu.TelefonSadelestir(ham);

    /// <summary>
    /// Kişi kodu kaydedilmemiş yönetici formlarının kimi değerlendirdiğini
    /// çıkarır: yönetici satırı ile aynı şube ve aşamada, gönderimi ±3 gün
    /// içinde olan çalışan satırlarına bakılır; TEK bir kişi varsa odur.
    /// Birden çok aday varsa tahmin yapılmaz.
    ///
    /// <para>
    /// Eski sürümde yönetici formu kişi seçmeden kaydedilebiliyordu; o
    /// kayıtlarda personelKodu yok. Bu kayıtlar çöp değil — çoğu tek kişilik
    /// gönderimler — bu yüzden güvenle eşlenebilenler eşlenir.
    /// </para>
    /// </summary>
    internal static Dictionary<int, string> YoneticiKisiTahmini(System.Data.IDbConnection db)
    {
        var sonuc = new Dictionary<int, string>();

        try
        {
            var ciftler = db.Query(@"
SELECT y.id AS yoneticiId, LTRIM(RTRIM(c.personel_kodu)) AS kod
FROM KRY_UYUM_ANKET y
JOIN KRY_UYUM_ANKET c
  ON c.tur = 'calisan' AND c.test_mi = 0 AND c.personel_kodu IS NOT NULL
 AND c.sube_adi = y.sube_adi AND c.asama = y.asama
 AND ABS(DATEDIFF(day, c.olusturma, y.olusturma)) <= 3
WHERE y.tur = 'yonetici' AND y.test_mi = 0 AND y.dolduruldu IS NOT NULL
GROUP BY y.id, LTRIM(RTRIM(c.personel_kodu))").ToList();

            foreach (var g in ciftler.GroupBy(x => (int)x.yoneticiId))
            {
                var kodlar = g.Select(x => (string)x.kod)
                              .Where(x => !string.IsNullOrWhiteSpace(x))
                              .Distinct(StringComparer.OrdinalIgnoreCase)
                              .ToList();

                if (kodlar.Count == 1) sonuc[g.Key] = kodlar[0];
            }
        }
        catch
        {
            /* Tahmin yardımcı bilgidir; başarısızsa kayıtlar eşlenmeden kalır */
        }

        return sonuc;
    }

    /// <summary>Sicil karşılaştırması: baştaki sıfırlar ve boşluklar yok sayılır</summary>
    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>
    /// Biçen360 kullanan (bildirim jetonu olan) personelin sicilleri, K
    /// biçiminde. Ölçüt <c>UyumGonderimServisi.UygulamadaMi</c> ile aynı;
    /// liste ekranlarında kişi başına sorgu atmamak için tek seferde okunur.
    /// Tablo okunamazsa boş küme döner.
    /// </summary>
    public static HashSet<string> UygulamaKullananlar(System.Data.IDbConnection db)
    {
        try
        {
            return db.Query<string>(@"
SELECT personel_kodu FROM KRY_MOBIL_JETON
WHERE jeton IS NOT NULL AND jeton <> ''")
                .Select(K)
                .Where(x => x.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    /// <summary>Bir kişi için doldurulmuş yönetici değerlendirmesi</summary>
    public sealed class YoneticiFormu
    {
        public int Id { get; set; }
        public string Asama { get; set; }
        /// <summary>"uygulama" ya da "sms" (eski kayıtlarda boş: sms)</summary>
        public string Kanal { get; set; }
        public string AdSoyad { get; set; }
        public string Telefon { get; set; }
        public string YoneticiKodu { get; set; }
        public string SubeAdi { get; set; }
        public DateTime? Dolduruldu { get; set; }
        public DateTime Olusturma { get; set; }
        public DateTime Gecerlilik { get; set; }
        public double? Puan { get; set; }
    }

    /// <summary>
    /// "K(sicil)|aşama" → o kişi için doldurulmuş en son yönetici formu.
    ///
    /// <para>
    /// Yönetici satırı kişiye değil gönderime aittir: SMS bağlantısında
    /// bir şubenin, uygulamada (GorevController.Degerlendir) bir
    /// yöneticinin bütün değerlendirmeleri tek satırın cevaplar_json
    /// dizisinde birikir. Kimin değerlendirildiği formun içindeki
    /// personelKodu'ndan okunur; kodu olmayan eski kayıtlarda şube/aşama/
    /// tarihten tek aday varsa o sayılır. Telefon, şube ya da görev
    /// alanına bakılmadığı için uygulamadan gelen satırlar da dahildir.
    /// </para>
    /// </summary>
    internal static Dictionary<string, YoneticiFormu> KisiBazindaYoneticiFormlari(
        System.Data.IDbConnection db)
    {
        var sonuc = new Dictionary<string, YoneticiFormu>(StringComparer.OrdinalIgnoreCase);

        var tahmin = YoneticiKisiTahmini(db);

        var satirlar = db.Query(@"
SELECT id, asama, kanal, ad_soyad AS adSoyad, telefon, yonetici_kodu AS yoneticiKodu,
       sube_adi AS subeAdi, dolduruldu, olusturma, gecerlilik, cevaplar_json AS json
FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND dolduruldu IS NOT NULL
  AND cevaplar_json IS NOT NULL").ToList();

        foreach (var r in satirlar)
        {
            foreach (var form in UyumAnaliz.Formlar((string)r.json))
            {
                var kod = form.PersonelKodu;

                if (string.IsNullOrWhiteSpace(kod) && tahmin.TryGetValue((int)r.id, out var t))
                    kod = t;

                if (string.IsNullOrWhiteSpace(kod)) continue;

                var anahtar = $"{K(kod)}|{(string)r.asama}";
                var dolduruldu = (DateTime?)r.dolduruldu;

                if (sonuc.TryGetValue(anahtar, out var mevcut)
                    && (mevcut.Dolduruldu ?? DateTime.MinValue) >= (dolduruldu ?? DateTime.MinValue))
                    continue;

                sonuc[anahtar] = new YoneticiFormu
                {
                    Id = (int)r.id,
                    Asama = (string)r.asama,
                    Kanal = (string)r.kanal == "uygulama" ? "uygulama" : "sms",
                    AdSoyad = (string)r.adSoyad,
                    Telefon = (string)r.telefon,
                    YoneticiKodu = (string)r.yoneticiKodu,
                    SubeAdi = (string)r.subeAdi,
                    Dolduruldu = dolduruldu,
                    Olusturma = (DateTime)r.olusturma,
                    Gecerlilik = (DateTime)r.gecerlilik,
                    Puan = form.Ortalama is null ? null : Math.Round(form.Ortalama.Value, 1)
                };
            }
        }

        return sonuc;
    }

    /// <summary>Yönetici çözümlemesi artık paylaşılan serviste.</summary>
    private (string ad, string telefon) MagazaYoneticisi(
        List<PersonelKaydi> personeller, string sube, string pozisyon = null)
    {
        var (ad, telefon, _) = _yonetici.Bul(personeller, sube, pozisyon);

        return (ad, telefon);
    }

    /// <summary>Aşama pencereleri; tanım UyumGonderimServisi'nde</summary>
    private Dictionary<string, (int enAz, int enFazla)> Aralik =>
        UyumGonderimServisi.Pencereler(_ayar.FormOku());

    private static int GecerlilikSaati => UyumGonderimServisi.GecerlilikSaati;

    private string AdSoyad =>
        User.Claims.FirstOrDefault(x => x.Type == "adSoyad")?.Value
        ?? User.Identity?.Name ?? "";

    private static Dictionary<string, string> AsamaAdi => UyumGonderimServisi.AsamaAdi;

    /* ==================================================================== */
    /* Gönderim                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Test gönderimi: verilen numaraya çalışan ya da yönetici bağlantısı
    /// yollar.
    ///
    /// <para>
    /// Test kayıtları <c>test_mi</c> ile işaretlenir ve raporlara girmez;
    /// aksi hâlde deneme gönderimleri memnuniyet ortalamasını bozardı.
    /// </para>
    /// </summary>
    [HttpPost("TestGonder")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> TestGonder([FromBody] UyumTestGirdi girdi)
    {
        var tur = (girdi?.Tur ?? "").Trim().ToLowerInvariant();
        var asama = (girdi?.Asama ?? "").Trim().ToLowerInvariant();

        if (tur is not ("calisan" or "yonetici"))
            return BadRequest(new { hata = "Tür 'calisan' ya da 'yonetici' olmalı." });

        if (!AsamaAdi.ContainsKey(asama))
            return BadRequest(new { hata = "Aşama 7g, 2a, 6a ya da 1y olmalı." });

        if (string.Equals((girdi?.Kanal ?? "").Trim(), "uygulama", StringComparison.OrdinalIgnoreCase))
            return await UygulamayaTestGonder(tur, asama, girdi);

        var telefon = TelefonSadelestir(girdi?.Telefon);

        if (telefon is null)
            return BadRequest(new { hata = "Geçerli bir cep numarası giriniz (5xxxxxxxxx)." });

        if (!_sms.Etkin)
            return BadRequest(new
            {
                hata = "SMS servisi kapalı.",
                ayrinti = "appsettings.json içindeki Sms bölümünü açmanız gerekiyor."
            });

        using var db = _vt.Baglanti();

        var kod = BenzersizKod(db);

        db.Execute(@"
INSERT INTO KRY_UYUM_ANKET
    (kod, tur, asama, personel_kodu, ad_soyad, sube_adi, gorev, telefon,
     giris_tarihi, gecerlilik, test_mi, gonderen)
VALUES (@kod, @tur, @asama, @personelKodu, @adSoyad, @subeAdi, @gorev, @telefon,
        @girisTarihi, @gecerlilik, 1, @gonderen)",
            new
            {
                kod,
                tur,
                asama,
                personelKodu = girdi.PersonelKodu,
                adSoyad = string.IsNullOrWhiteSpace(girdi.AdSoyad)
                    ? "Test Kullanıcısı" : girdi.AdSoyad.Trim(),
                subeAdi = girdi.SubeAdi,
                gorev = girdi.Gorev,
                telefon,
                girisTarihi = girdi.GirisTarihi,
                gecerlilik = DateTime.Now.AddHours(GecerlilikSaati),
                gonderen = AdSoyad
            });

        var adres = BaglantiAdresi(kod);

        var mesaj = SmsMetni(tur, asama, girdi.AdSoyad, girdi.SubeAdi, kod);

        var sonuc = await _sms.Gonder(telefon, mesaj);

        if (!sonuc.Basarili)
        {
            db.Execute("DELETE FROM KRY_UYUM_ANKET WHERE kod = @kod", new { kod });

            return StatusCode(502, new
            {
                hata = "SMS gönderilemedi.",
                ayrinti = sonuc.Mesaj
            });
        }

        return Ok(new
        {
            tamam = true,
            kod,
            adres,
            gecerlilik = DateTime.Now.AddHours(GecerlilikSaati),
            /* Panelde bağlantı da gösterilir: test ederken SMS beklemek
               yerine doğrudan açmak isteyebilir. */
            not = $"Bağlantı {GecerlilikSaati} saat geçerlidir. Test gönderimleri raporlara girmez."
        });
    }

    /// <summary>
    /// Test anketini Biçen360'a gönderir: verilen sicilin ana sayfasında
    /// çalışan formu "Oryantasyon anketiniz hazır", yönetici formu
    /// "Oryantasyon doldurulması bekleniyor" kartı olarak çıkar ve bildirim
    /// gider. Kayıt test olarak işaretlenir; raporlara ve hatırlatma
    /// görevine girmez.
    /// </summary>
    private async Task<IActionResult> UygulamayaTestGonder(string tur, string asama, UyumTestGirdi girdi)
    {
        var sicil = (girdi.Sicil ?? "").Trim();

        if (sicil.Length == 0)
            return BadRequest(new { hata = "Testin gideceği personelin sicilini yazınız." });

        PersonelKaydi kisi;

        try
        {
            kisi = _personelKaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1)
                .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim().TrimStart('0') == sicil.TrimStart('0'));
        }
        catch
        {
            return StatusCode(503, new { hata = "Personel listesine ulaşılamadı." });
        }

        if (kisi is null)
            return NotFound(new { hata = $"{sicil} sicilli aktif personel bulunamadı." });

        var kod = kisi.PersonelKodu.Trim();
        var adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim();

        using var db = _vt.Baglanti();

        var jetonVar = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod AND jeton IS NOT NULL AND jeton <> ''",
            new { kod }) > 0;

        if (!jetonVar)
            return BadRequest(new
            {
                hata = $"{adSoyad} Biçen360'a giriş yapmamış ya da bildirim izni vermemiş.",
                ayrinti = "Uygulamaya giriş yapıp bildirimlere izin verdikten sonra tekrar deneyiniz."
            });

        /* Görev ekranlarını taşıyan sürümü (1.4) henüz açmamışsa yine
           gönderilir; bildirime güncelleme notu eklenir. */
        var guncellemeNotu = !UyumGonderimServisi.YeniSurumuAcmis(db, kod);

        var baglantiKodu = BenzersizKod(db);
        var gecerlilik = DateTime.Now.AddHours(GecerlilikSaati);

        db.Execute(@"
INSERT INTO KRY_UYUM_ANKET
    (kod, tur, asama, personel_kodu, ad_soyad, sube_adi, gorev, telefon,
     giris_tarihi, gecerlilik, test_mi, gonderen, kanal, yonetici_kodu)
VALUES (@baglantiKodu, @tur, @asama, @personelKodu, @adSoyad, @subeAdi, @gorev, NULL,
        @girisTarihi, @gecerlilik, 1, @gonderen, 'uygulama', @yoneticiKodu)",
            new
            {
                baglantiKodu,
                tur,
                asama,
                /* Çalışan formunda anket kişinin kendisine; yönetici formunda
                   kişi listesi yok, sicil yönetici olarak yazılıyor */
                personelKodu = tur == "calisan" ? kod : null,
                adSoyad,
                subeAdi = kisi.Sube,
                gorev = tur == "calisan" ? kisi.Pozisyon : "uygulama",
                girisTarihi = kisi.GirisTarihi,
                gecerlilik,
                gonderen = AdSoyad,
                yoneticiKodu = tur == "yonetici" ? kod : null,
            });

        var bildirim = HttpContext.RequestServices.GetRequiredService<BildirimServisi>();

        var ek = guncellemeNotu ? UyumGonderimServisi.GuncellemeNotu : "";

        if (tur == "calisan")
            await bildirim.Gonder(kod, "Oryantasyon anketiniz hazır (test)",
                $"{AsamaAdi[asama]} değerlendirmeniz · ana sayfadan doldurabilirsiniz.{ek}", "anasayfa");
        else
            await bildirim.Gonder(kod, "Oryantasyon doldurulması bekleniyor (test)",
                $"Test personeli · {AsamaAdi[asama]} değerlendirmesi. Ana sayfadan doldurabilirsiniz.{ek}", "anasayfa");

        return Ok(new
        {
            tamam = true,
            kod = baglantiKodu,
            kanal = "uygulama",
            adSoyad,
            gecerlilik,
            not = $"{adSoyad} adlı personelin Biçen360 ana sayfasına düştü; bildirim gönderildi. "
                  + (guncellemeNotu
                      ? "Bu sicil Biçen360'ın yeni sürümünü henüz açmamış; bildirime güncelleme notu eklendi. "
                      : "")
                  + $"{GecerlilikSaati} saat açık kalır, test kayıtları raporlara girmez."
        });
    }

    /// <summary>
    /// Test penceresinde uygulamaya gönderim için varsayılan hedef: paneldeki
    /// kullanıcının kendi sicili (Yönetim → Kullanıcılar'daki sicil alanı).
    /// </summary>
    [HttpGet("TestHedef")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult TestHedef()
    {
        using var db = _vt.Baglanti();

        string sicil = null;

        try
        {
            sicil = db.ExecuteScalar<string>(
                "SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi = @ad",
                new { ad = User.Identity?.Name ?? "" });
        }
        catch
        {
            /* Sicil alanı yoksa boş döner; kullanıcı elle yazar */
        }

        sicil = string.IsNullOrWhiteSpace(sicil) ? null : sicil.Trim();

        return Ok(new
        {
            sicil,
            uygulamada = sicil is not null && UyumGonderimServisi.UygulamadaMi(db, sicil)
        });
    }

    /* ==================================================================== */
    /* Toplu gönderim                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Dönemi dolan ve henüz form gönderilmemiş personel.
    ///
    /// <para>
    /// Aynı kişiye aynı aşama için ikinci kez gönderim yapılmaz; daha önce
    /// gönderilmiş olanlar listeye girmez. Böylece toplu gönderim düğmesine
    /// birden çok kez basmak kimseye ikinci bildirim yollamaz.
    /// </para>
    /// </summary>
    [HttpGet("Bekleyenler")]
    [Authorize]
    public IActionResult Bekleyenler([FromQuery] string asama)
    {
        asama = (asama ?? "7g").Trim().ToLowerInvariant();

        if (!Aralik.ContainsKey(asama))
            return BadRequest(new { hata = "Aşama 7g, 2a, 6a ya da 1y olmalı." });

        var (enAz, enFazla) = Aralik[asama];

        List<PersonelKaydi> personeller;

        try
        {
            personeller = _personelKaynak.TumPersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı");
            return Ok(new { asama, kayitlar = new List<object>() });
        }

        using var db = _vt.Baglanti();

        /* Daha önce gönderilmiş olanlar (sınama kayıtları hariç) */
        var gonderilmis = db.Query<string>(@"
SELECT personel_kodu FROM KRY_UYUM_ANKET
WHERE asama = @asama AND tur = 'calisan'
  AND test_mi = 0 AND personel_kodu IS NOT NULL",
            new { asama }).ToHashSet(StringComparer.OrdinalIgnoreCase);

        /* Anket herkese Biçen360'tan gider. Biçen360'a hiç giriş yapmamış
           kişide anket yine açılır ama bildirim gidemez; toplu gönderim
           penceresi onları ayrı sayıyor. */
        var uygulamadakiler = UygulamaKullananlar(db);

        var kayitlar = personeller
            .Where(x => x.Durum == 1 && x.GirisTarihi is not null)
            .Select(x => new
            {
                kisi = x,
                gun = UyumAnaliz.KacinciGun(x.GirisTarihi.Value)
            })
            .Where(x => x.gun >= enAz && x.gun <= enFazla)
            .Where(x => !gonderilmis.Contains((x.kisi.PersonelKodu ?? "").Trim()))
            .OrderBy(x => x.kisi.Sube)
            .ThenBy(x => x.kisi.Ad)
            .Select(x => new
            {
                personelKodu = (x.kisi.PersonelKodu ?? "").Trim(),
                adSoyad = $"{x.kisi.Ad} {x.kisi.Soyad}".Trim(),
                gorev = x.kisi.Pozisyon,
                subeAdi = x.kisi.Sube,
                telefon = x.kisi.Telefon,
                girisTarihi = x.kisi.GirisTarihi,
                x.gun,
                telefonUygun = TelefonSadelestir(x.kisi.Telefon) is not null,
                kanal = "uygulama",
                girisYapmamis = !uygulamadakiler.Contains(K(x.kisi.PersonelKodu))
            })
            .ToList();

        return Ok(new { asama, asamaAdi = AsamaAdi[asama], kayitlar });
    }

    /// <summary>
    /// Seçilen personele toplu gönderim yapar.
    ///
    /// <para>
    /// Çalışan anketi kişi başına Biçen360'a açılır. Yöneticiye yönetici
    /// başına tek bildirim gider; değerlendirmeyi Biçen360'tan yapar.
    /// </para>
    /// </summary>
    /// <summary>
    /// Verilen pencerelerle her aşamada bugün kaç kişinin listeleneceği.
    /// Yönetim ekranında pencereyi düzenlerken etkisi hemen görünsün diye.
    /// </summary>
    [HttpPost("PencereSayimi")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult PencereSayimi([FromBody] Dictionary<string, AsamaPenceresi> pencereler)
    {
        var ayar = new FormAyarlari { UyumPencereleri = pencereler ?? new() };
        var aralik = UyumGonderimServisi.Pencereler(ayar);

        List<PersonelKaydi> personeller;

        try { personeller = _personelKaynak.TumPersonelleriGetir(); }
        catch { personeller = new List<PersonelKaydi>(); }

        var calisanlar = personeller
            .Where(x => x.Durum == 1 && x.GirisTarihi is not null)
            .ToList();

        var sonuc = UyumGonderimServisi.AsamaSirasi.Select(kod =>
        {
            var (enAz, enFazla) = aralik[kod];

            var kisiler = calisanlar
                .Where(x =>
                {
                    var g = UyumAnaliz.KacinciGun(x.GirisTarihi!.Value);
                    return g >= enAz && g <= enFazla;
                })
                .OrderBy(x => x.Sube).ThenBy(x => x.Ad)
                .Select(x => new
                {
                    x.PersonelKodu,
                    adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    sube = x.Sube,
                    gun = UyumAnaliz.KacinciGun(x.GirisTarihi!.Value)
                })
                .ToList();

            return new { asama = kod, asamaAdi = AsamaAdi[kod], enAz, enFazla,
                         adet = kisiler.Count, kisiler = kisiler.Take(30).ToList() };
        }).ToList();

        return Ok(new { sonuc, toplamCalisan = calisanlar.Count });
    }

    [HttpPost("TopluGonder")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> TopluGonder([FromBody] UyumTopluGirdi girdi)
    {
        var asama = (girdi?.Asama ?? "").Trim().ToLowerInvariant();

        if (!Aralik.ContainsKey(asama))
            return BadRequest(new { hata = "Aşama geçersiz." });

        if (girdi.Kisiler is null || girdi.Kisiler.Count == 0)
            return BadRequest(new { hata = "Kişi seçiniz." });

        using var db = _vt.Baglanti();

        /* Anket herkese Biçen360'tan açılır; SMS servisi ve geçerli telefon
           gerekmez. Biçen360'a giriş yapmamış kişide anket yine açılır,
           giriş yapınca görür; ayrıca bildirilir, hata sayılmaz. */
        var gonderilen = 0;
        var atlanan = new List<string>();
        var girisYapmamis = new List<string>();
        var basarili = new List<UyumTopluKisi>();

        foreach (var k in girdi.Kisiler)
        {
            /* Yarışan istekler için son bir denetim: liste çekildikten
               sonra başka biri göndermiş olabilir. */
            var varMi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_UYUM_ANKET
WHERE asama = @asama AND tur = 'calisan' AND test_mi = 0
  AND personel_kodu = @kod", new { asama, kod = k.PersonelKodu });

            if (varMi > 0)
            {
                atlanan.Add($"{k.AdSoyad}: daha önce gönderilmiş");
                continue;
            }

            try
            {
                var s = await CalisanaGonder(db, asama, k.PersonelKodu, k.AdSoyad, k.SubeAdi,
                                             k.Gorev, k.Telefon, k.GirisTarihi);

                if (s.Basarili)
                {
                    gonderilen++;
                    basarili.Add(k);

                    if (s.GirisYok) girisYapmamis.Add(k.AdSoyad);
                }
                else
                    atlanan.Add($"{k.AdSoyad}: {s.Hata ?? "anket açılamadı"}");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Uyum gönderimi başarısız: {Kod}", k.PersonelKodu);
                atlanan.Add($"{k.AdSoyad}: gönderim hatası");
            }
        }

        /* Yöneticiler: değerlendirme Biçen360'ta açılır, yönetici başına
           tek bildirim gider; aynı yöneticiye aynı aşama için günde bir
           kez. Ekibim'de onu gören yönetici de görür. */
        var yoneticiGonderim = 0;
        var yoneticiGirisYapmamis = new List<string>();

        if (girdi.YoneticiyeDeGonder && basarili.Count > 0)
        {
            List<PersonelKaydi> tumPersonel;

            try
            {
                tumPersonel = _personelKaynak.TumPersonelleriGetir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Yönetici araması için personel alınamadı");
                tumPersonel = new List<PersonelKaydi>();
            }

            var kisiler = basarili.Select(k => KisiKaydi(tumPersonel, k)).ToList();

            try
            {
                var y = await _gonderim.YoneticiyeAc(db, asama, kisiler, tumPersonel, AdSoyad, "oryyonetici");

                yoneticiGonderim = y.Hedefler.Count;
                yoneticiGirisYapmamis = y.Hedefler.Where(x => x.GirisYok).Select(x => x.Ad).ToList();

                atlanan.AddRange(y.Bulunamayan.Select(x => $"{x}: yönetici Biçen360'ta bulunamadı"));
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Yönetici gönderimi başarısız: {Asama}", asama);
                atlanan.Add("Yöneticilere gönderilemedi: " + hata.Message);
            }
        }

        return Ok(new { gonderilen, yoneticiGonderim, atlanan, girisYapmamis, yoneticiGirisYapmamis });
    }

    /// <summary>
    /// Toplu gönderimdeki kişinin personel kaydı; listede yoksa (ayrılmış,
    /// liste okunamadı) panelden gelen bilgilerle kurulur.
    /// </summary>
    private static PersonelKaydi KisiKaydi(List<PersonelKaydi> tumPersonel, UyumTopluKisi k) =>
        tumPersonel.FirstOrDefault(x => K(x.PersonelKodu) == K(k.PersonelKodu) && x.Durum == 1)
        ?? new PersonelKaydi
        {
            PersonelKodu = (k.PersonelKodu ?? "").Trim(),
            Ad = k.AdSoyad,
            Soyad = "",
            Sube = k.SubeAdi,
            Pozisyon = k.Gorev,
            Telefon = k.Telefon,
            GirisTarihi = k.GirisTarihi,
            Durum = 1
        };

    /// <summary>
    /// Bir şubede dönemi dolan personel: yöneticinin değerlendireceği kişiler.
    ///
    /// Sınama gönderiminde canlı veri kullanılmaz; örnek kayıtlar döner.
    /// </summary>
    /// <summary>
    /// Son çağrının neden boş döndüğü.
    ///
    /// Liste sessizce boş kalıyordu: yönetici anketi açıyor, kimseyi
    /// göremiyor ve sebebi ancak sunucu günlüğünden anlaşılıyordu.
    /// </summary>
    private string _personelNotu;

    private List<object> DegerlendirilecekPersonel(
        string sube, string asama, bool sinama, string hedef = null,
        DateTime? bagliTarih = null)
    {
        _personelNotu = null;
        if (sinama)
            return new List<object>
            {
                new { personelKodu = "ORNEK-1", adSoyad = "Örnek Personel 1",
                      gorev = "Kasiyer", gun = 8 },
                new { personelKodu = "ORNEK-2", adSoyad = "Örnek Personel 2",
                      gorev = "Manav", gun = 11 }
            };

        try
        {
            var (enAz, enFazla) = Aralik.TryGetValue(asama, out var a) ? a : (0, 9999);

            /* Liste iki kaynağın birleşimi.

               Bir: aynı turda çalışan anketi gönderilmiş kişiler. Kimin
               değerlendirileceği gönderim anında belli ve o kişi gün
               aralığından çıkmış olsa bile yönetici onu görmeli — 7g
               aşaması tam olarak 7. günü kapsadığı için bağlantı ertesi
               gün açıldığında liste boşalıyordu.

               İki: şu anda aralıkta olanlar. Tur gönderildikten sonra
               aralığa giren personel de listeye katılsın.

               Yalnızca birincisine bakmak yeni gireni, yalnızca
               ikincisine bakmak turda gönderileni dışarıda bırakıyordu. */
            var turKodlari = new List<string>();

            if (bagliTarih is DateTime t)
                try
                {
                    using var db = _vt.Baglanti();

                    /* Pencere geniş: aynı tur birkaç güne yayılmış
                       olabiliyor ve sıkı tutmak kişileri düşürüyordu. */
                    turKodlari = db.Query<string>(@"
SELECT DISTINCT personel_kodu FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND asama = @asama AND test_mi = 0
  AND sube_adi = @sube AND personel_kodu IS NOT NULL
  AND olusturma >= DATEADD(day, -15, @t) AND olusturma <= DATEADD(day, 15, @t)",
                        new { asama, sube, t }).ToList();
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Tur kayıtlarından personel okunamadı");
                }

            var tumu = _personelKaynak.TumPersonelleriGetir();

            /* Elemeler ayrı ayrı ölçülüyor: hangi aşamada kimsenin
               kalmadığını bilmeden "personel görünmüyor" şikâyeti
               çözülemiyordu. */
            var subedekiler = tumu
                .Where(x => x.Durum == 1
                            && x.GirisTarihi is not null
                            && EslesmeAnahtari(x.Sube) == EslesmeAnahtari(sube))
                .ToList();

            /* Aralıkta olanlar ya da bu turda anketi gönderilmiş olanlar.

               Gün koşulu tek başına yetmiyor: turda gönderilen kişi
               ertesi gün aralıktan çıkıyor ve yönetici onu göremiyordu.
               Kod listesi boşsa davranış eskisi gibi kalıyor. */
            var aralikta = subedekiler
                .Select(x => new { kisi = x, gun = UyumAnaliz.KacinciGun(x.GirisTarihi.Value) })
                .Where(x => (x.gun >= enAz && x.gun <= enFazla)
                            || turKodlari.Contains((x.kisi.PersonelKodu ?? "").Trim()))
                .ToList();

            var sonuc = aralikta
                .Where(x => hedef == "bolge"
                    ? YoneticiBulucu.MagazaMuduruMu(x.kisi.Pozisyon)
                    : hedef == "magaza"
                        ? !YoneticiBulucu.MagazaMuduruMu(x.kisi.Pozisyon)
                        : true)
                .OrderBy(x => x.kisi.Ad)
                .Select(x => (object)new
                {
                    personelKodu = (x.kisi.PersonelKodu ?? "").Trim(),
                    adSoyad = $"{x.kisi.Ad} {x.kisi.Soyad}".Trim(),
                    gorev = x.kisi.Pozisyon,
                    x.gun
                })
                .ToList();

            if (sonuc.Count == 0)
                _personelNotu = subedekiler.Count == 0
                    ? $"{sube} biriminde işe giriş tarihi olan aktif personel bulunamadı."
                    : aralikta.Count == 0
                        ? $"{sube} biriminde {subedekiler.Count} aktif personel var ama "
                          + $"hiçbiri bu aşamanın gün aralığında değil ({enAz}–{enFazla}. gün) "
                          + "ve bu tur için gönderilmiş anket bulunamadı."
                        : hedef == "bolge"
                            ? "Bu bağlantı bölge müdürüne gönderildi; yalnızca mağaza "
                              + "müdürleri listelenir ve aralıkta mağaza müdürü yok."
                            : "Bu bağlantı mağaza yöneticisine gönderildi; mağaza "
                              + "müdürleri listelenmez ve aralıkta başka personel yok.";

            return sonuc;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Değerlendirilecek personel alınamadı: {Sube}", sube);

            _personelNotu = "Personel listesine ulaşılamadı: " + hata.Message;

            return new List<object>();
        }
    }

    /// <summary>
    /// Eşleştirme anahtarı.
    ///
    /// <para>
    /// <c>PersonelKaynagiServisi.BirimAnahtari</c> Türkçe harfleri olduğu
    /// gibi bırakıyor; ayarlardaki "Z.MERKEZ BÜRO" ile Mikro'daki
    /// "Z.MERKEZ BURO" bu yüzden eşleşmiyordu. Burada harfler de
    /// karşılıklarına indirilir.
    /// </para>
    /// </summary>
    private static string EslesmeAnahtari(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return "";

        var buyuk = metin.Trim().ToUpperInvariant();

        foreach (var (k, h) in new[]
        {
            ('İ', 'I'), ('Ş', 'S'), ('Ğ', 'G'),
            ('Ü', 'U'), ('Ö', 'O'), ('Ç', 'C')
        })
        {
            buyuk = buyuk.Replace(k, h);
        }

        /* Harf ve rakam dışındaki her şey atılır: nokta, boşluk, tire
           iki kaynakta farklı yazılabiliyor. */
        return new string(buyuk.Where(char.IsLetterOrDigit).ToArray());
    }

    /// <summary>
    /// SMS metnini kurar (yalnızca test penceresinde SMS seçilince).
    ///
    /// Şablon Yönetim → Form Ayarları'ndan düzenlenir; boş bırakılırsa
    /// varsayılan metin kullanılır. Bağlantı süresi metne kodda eklenir,
    /// şablonda unutulsa bile alıcı süreyi görür.
    /// </summary>
    private string SmsMetni(string tur, string asama, string adSoyad,
                            string sube, string kod) =>
        _gonderim.SmsMetni(tur, asama, adSoyad, sube, kod);

    /// <summary>Personelin anketini Biçen360'ta açar ve bildirim gönderir (serviste).</summary>
    private Task<UyumGonderimSonucu> CalisanaGonder(
        System.Data.IDbConnection db, string asama,
        string personelKodu, string adSoyad, string subeAdi, string gorev,
        string telefon, DateTime? girisTarihi) =>
        _gonderim.CalisanaGonder(db, asama, personelKodu, adSoyad, subeAdi, gorev,
                                 telefon, girisTarihi, AdSoyad);

    /* ==================================================================== */
    /* Bağlantının açılması (herkese açık)                                  */
    /* ==================================================================== */

    /// <summary>
    /// Bağlantıyı açar. Kimlik doğrulaması yoktur; kodun kendisi anahtardır.
    /// </summary>
    [HttpGet("{kod}")]
    [AllowAnonymous]
    public IActionResult Ac(string kod)
    {
        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT kod, tur, asama, ad_soyad AS adSoyad, sube_adi AS subeAdi, gorev,
       giris_tarihi AS girisTarihi, gecerlilik, dolduruldu, test_mi AS testMi,
       cevaplar_json AS cevaplarJson, olusturma
FROM KRY_UYUM_ANKET WHERE kod = @kod", new { kod = (kod ?? "").Trim() });

        if (kayit is null)
            return NotFound(new { hata = "Bağlantı bulunamadı." });

        if (kayit.dolduruldu is not null)
            return Ok(new { durum = "dolduruldu", kayit.tur, kayit.asama });

        if ((DateTime)kayit.gecerlilik < DateTime.Now)
            return Ok(new
            {
                durum = "suresiDoldu",
                kayit.tur,
                kayit.asama,
                aciklama = "Bu bağlantının süresi dolmuş. Yeni bağlantı için "
                         + "İnsan Kaynakları ile görüşebilirsiniz."
            });

        /* Yönetici formundaki liste önce aynı turda çalışan anketi
           gönderilmiş kişilerden çıkarılır; o da yoksa doldurma anındaki
           gün hesabına düşülür. Yalnızca anlık hesaba bakmak, dar
           pencereli aşamalarda (7g tam olarak 7. gün) bağlantı ertesi gün
           açıldığında listeyi boşaltıyordu. */
        object kisiler = null;

        if ((string)kayit.tur == "yonetici")
            kisiler = DegerlendirilecekPersonel(
                (string)kayit.subeAdi, (string)kayit.asama, kayit.testMi == true,
                (string)kayit.gorev,

                /* Bağlantının oluşturulma tarihi: aynı turda gönderilen
                   çalışan anketleriyle eşleştirmek için. */
                (DateTime?)kayit.olusturma);

        return Ok(new { durum = "acik", kayit, kisiler, personelNotu = _personelNotu });
    }

    /// <summary>Yanıtları kaydeder.</summary>
    [HttpPost("{kod}/Cevap")]
    [AllowAnonymous]
    public IActionResult Cevap(string kod, [FromBody] UyumCevapGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.CevaplarJson))
            return BadRequest(new { hata = "Yanıt bulunamadı." });

        using var db = _vt.Baglanti();

        /* Yönetici formunda bir gönderimde birden çok kişi değerlendirilir;
           her kaydetme öncekinin üzerine yazmak yerine birikir. */
        if (!string.IsNullOrWhiteSpace(girdi.PersonelKodu))
        {
            var mevcut = db.ExecuteScalar<string>(
                "SELECT cevaplar_json FROM KRY_UYUM_ANKET WHERE kod = @kod",
                new { kod = (kod ?? "").Trim() }) ?? "";

            /* Mevcut kayıt gerçek JSON olarak açılır. Önceki sürüm köşeli
               parantezleri metin olarak kırpıp tek parça sayıyordu; aynı
               kişi yeniden değerlendirilince diğer kişilerin formları da
               siliniyordu. */
            var liste = new List<string>();

            if (mevcut.Length > 0)
            {
                try
                {
                    using var kok = System.Text.Json.JsonDocument.Parse(mevcut);

                    if (kok.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array)
                        liste.AddRange(kok.RootElement.EnumerateArray().Select(x => x.GetRawText()));
                    else
                        liste.Add(kok.RootElement.GetRawText());
                }
                catch
                {
                    liste.Add(mevcut);
                }
            }

            var yeniKod = girdi.PersonelKodu.Trim();

            liste.RemoveAll(x =>
            {
                foreach (var f in UyumAnaliz.Formlar(x))
                    if (string.Equals((f.PersonelKodu ?? "").Trim(), yeniKod,
                                      StringComparison.OrdinalIgnoreCase))
                        return true;
                return false;
            });

            liste.Add(girdi.CevaplarJson);

            var birlesik = "[" + string.Join(",", liste.Where(x => x.Length > 0)) + "]";

            var sonuc = db.Execute(@"
UPDATE KRY_UYUM_ANKET
SET cevaplar_json = @cevaplar, puan = @puan, dolduruldu = SYSDATETIME()
WHERE kod = @kod AND gecerlilik >= SYSDATETIME()",
                new { kod = (kod ?? "").Trim(), cevaplar = birlesik, puan = girdi.Puan });

            return sonuc == 0
                ? BadRequest(new { hata = "Bağlantının süresi dolmuş." })
                : Ok(new { tamam = true });
        }

        var etkilenen = db.Execute(@"
UPDATE KRY_UYUM_ANKET
SET cevaplar_json = @cevaplar, puan = @puan, dolduruldu = SYSDATETIME()
WHERE kod = @kod AND dolduruldu IS NULL AND gecerlilik >= SYSDATETIME()",
            new
            {
                kod = (kod ?? "").Trim(),
                cevaplar = girdi.CevaplarJson,
                puan = girdi.Puan
            });

        return etkilenen == 0
            ? BadRequest(new
            {
                hata = "Form kaydedilemedi.",
                ayrinti = "Bağlantının süresi dolmuş ya da form daha önce doldurulmuş."
            })
            : Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Panel: raporlama                                                     */
    /* ==================================================================== */

    /// <summary>
    /// Yönetim özeti: aşama bazında gönderim, tamamlanma ve ortalama puan.
    ///
    /// Sınama kayıtları dışarıda bırakılır; birkaç deneme gönderimi
    /// ortalamaları bozardı.
    /// </summary>
    [HttpGet("Rapor")]
    [Authorize]
    public IActionResult Rapor([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = (bas ?? DateTime.Today.AddMonths(-6)).Date;
        var bitis = (bit ?? DateTime.Today).Date.AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT id, asama, tur, puan, dolduruldu, gecerlilik, sube_adi AS subeAdi,
       ad_soyad AS adSoyad, telefon, olusturma, cevaplar_json AS cevaplarJson,
       personel_kodu AS personelKodu, gorev, kanal
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND olusturma BETWEEN @bas AND @bit",
            new { bas = baslangic, bit = bitis }).ToList();

        /* Aşama kırılımı: her aşamada çalışan ve yönetici ayrı ölçülür,
           çünkü tamamlama oranları belirgin biçimde ayrışıyor. */
        var asamalar = Aralik.Keys.Select(a =>
        {
            var hepsi = satirlar.Where(x => (string)x.asama == a).ToList();

            object Taraf(string tur)
            {
                var kume = hepsi.Where(x => (string)x.tur == tur).ToList();
                var dolu = kume.Where(x => x.dolduruldu is not null).ToList();

                var puanlar = dolu
                    .Where(x => x.puan is not null)
                    .Select(x => (double)Convert.ToDecimal(x.puan))
                    .ToList();

                return new
                {
                    gonderim = kume.Count,
                    tamamlanan = dolu.Count,
                    oran = kume.Count == 0
                        ? 0
                        : (int)Math.Round(dolu.Count * 100.0 / kume.Count),
                    ortalama = puanlar.Count == 0
                        ? (double?)null
                        : Math.Round(puanlar.Average(), 1)
                };
            }

            return new
            {
                asama = a,
                asamaAdi = AsamaAdi[a],
                calisan = Taraf("calisan"),
                yonetici = Taraf("yonetici")
            };
        }).ToList();

        /* Süresi dolmuş ama doldurulmamış olanlar: hatırlatma gerekenler */
        var kacan = satirlar
            .Where(x => x.dolduruldu is null
                        && (DateTime)x.gecerlilik < DateTime.Now)
            .ToList();

        var toplamGonderim = satirlar.Count;
        var toplamTamam = satirlar.Count(x => x.dolduruldu is not null);

        /* Personel kartları: ayrılma bilgisi mağaza ve yönetici
           kırılımlarında da gerektiği için erken okunur. */
        List<PersonelKaydi> personeller;

        try { personeller = _personelKaynak.TumPersonelleriGetir(); }
        catch { personeller = new List<PersonelKaydi>(); }

        var personelHaritasi = personeller
            .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .GroupBy(x => x.PersonelKodu.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(),
                          StringComparer.OrdinalIgnoreCase);

        /* İlk yılında ayrılmış mı: erken ayrılma oranlarının tabanı.
           Ayrılma tarihi yoksa hâlâ çalışıyor demektir. */
        bool ErkenAyrildi(string kod)
        {
            if (string.IsNullOrWhiteSpace(kod)) return false;

            if (!personelHaritasi.TryGetValue(kod.Trim(), out var k)) return false;

            if (k.CikisTarihi is null || k.GirisTarihi is null) return false;

            return (k.CikisTarihi.Value - k.GirisTarihi.Value).TotalDays <= 365;
        }

        /* Bir kümede erken ayrılma yüzdesi; kimse yoksa null döner ki
           ekranda "%0" yerine "—" görünsün. */
        int? ErkenAyrilmaOrani(IEnumerable<string> kodlar)
        {
            var liste = kodlar
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Where(x => personelHaritasi.ContainsKey(x))
                .ToList();

            if (liste.Count == 0) return null;

            return (int)Math.Round(liste.Count(ErkenAyrildi) * 100.0 / liste.Count);
        }

        /* Mağaza kırılımı: yalnızca çalışan formları, tamamlanma ve puan */
        var magazalar = satirlar
            .Where(x => (string)x.tur == "calisan"
                        && !string.IsNullOrWhiteSpace((string)x.subeAdi))
            .GroupBy(x => ((string)x.subeAdi).Trim())
            .Select(g =>
            {
                var dolu = g.Where(x => x.dolduruldu is not null).ToList();

                var puanlar = dolu
                    .Where(x => x.puan is not null)
                    .Select(x => (double)Convert.ToDecimal(x.puan))
                    .ToList();

                /* Aynı mağazanın yönetici formları ayrı ölçülür: çalışanın
                   kendi puanıyla yöneticinin verdiği puan yan yana
                   durmadan mağazayı değerlendirmek yanıltıcı oluyor. */
                var yoneticiPuanlari = satirlar
                    .Where(x => (string)x.tur == "yonetici"
                                && ((string)(x.subeAdi ?? "")).Trim() == g.Key
                                && x.dolduruldu is not null
                                && x.puan is not null)
                    .Select(x => (double)Convert.ToDecimal(x.puan))
                    .ToList();

                var kisiler = g
                    .Select(x => (string)(x.personelKodu ?? ""))
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Select(x => x.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                return new
                {
                    sube = g.Key,
                    gonderim = g.Count(),
                    tamamlanan = dolu.Count,
                    kisiSayisi = kisiler.Count,
                    oran = (int)Math.Round(dolu.Count * 100.0 / g.Count()),
                    ortalama = puanlar.Count == 0
                        ? (double?)null
                        : Math.Round(puanlar.Average(), 1),
                    yoneticiOrt = yoneticiPuanlari.Count == 0
                        ? (double?)null
                        : Math.Round(yoneticiPuanlari.Average(), 1),
                    erkenAyrilma = ErkenAyrilmaOrani(kisiler)
                };
            })
            .OrderBy(x => x.ortalama ?? 99)
            .ToList();

        /* Riskli çalışan sayısı mağazaya işlenir: tek başına ortalama puan,
           birkaç kişinin çok düşük olduğu mağazayı gizleyebiliyor. */
        var riskliler = satirlar
            .Where(x => (string)x.tur == "calisan"
                        && x.dolduruldu is not null
                        && x.puan is not null
                        && (double)Convert.ToDecimal(x.puan) < 3.0)
            .GroupBy(x => ((string)(x.subeAdi ?? "")).Trim())
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

        var magazaListe = magazalar.Select(m => new
        {
            m.sube,
            m.gonderim,
            m.tamamlanan,
            m.kisiSayisi,
            m.oran,
            m.ortalama,
            m.yoneticiOrt,
            m.erkenAyrilma,
            riskli = riskliler.GetValueOrDefault(m.sube)
        }).ToList();

        /* Yönetici karşılaştırması: çalışanın verdiği puan ile yöneticinin
           verdiği puan yan yana. Aradaki fark iki yönde de anlamlı — biri
           çalışan deneyimi sorununa, diğeri değerlendirme kalibrasyonuna
           işaret eder. */
        /* Yönetici karşılaştırması, (şube, yönetici) çifti başına.

           Önceden şube başına tek satır vardı ve ilk yönetici formunun adı
           yazılıyordu; Z.Merkez Büro gibi birden çok departmanı ve
           yöneticisi olan birimde diğerleri görünmüyordu. Şimdi her yönetici
           formu kendi satırında: yöneticinin verdiği puan o formdaki
           kişilerin ortalaması, çalışan memnuniyeti ise yalnızca o kişilerin
           kendi formlarından. Kişi kodları da döner; çekmece bu listeyle
           açılır. */
        var calisanPuanlari = satirlar
            .Where(x => (string)x.tur == "calisan" && x.dolduruldu is not null
                        && x.puan is not null && !string.IsNullOrWhiteSpace((string)x.personelKodu))
            .GroupBy(x => ((string)x.personelKodu).Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key,
                          g => g.Average(x => (double)Convert.ToDecimal(x.puan)),
                          StringComparer.OrdinalIgnoreCase);

        var yoneticiGruplari = new Dictionary<string, (string sube, string ad, string tel,
            List<double> yPuan, HashSet<string> kisiler)>(StringComparer.OrdinalIgnoreCase);

        var raporKisiTahmini = YoneticiKisiTahmini(db);

        /* Yanıt süresi: çalışanın anketinin açılmasından yöneticinin o
           kişiyi değerlendirmesine kadar geçen saat. Yalnızca bilgi
           içindir; genel puana ve duruma etki etmez. Yönetici satırında
           tek bir doldurma zamanı tutulduğu için (bir bağlantıda ya da
           uygulama kaydında birden çok kişi birikir) satırın son doldurma
           zamanı kullanılır. */
        var calisanAcilis = satirlar
            .Where(x => (string)x.tur == "calisan" && !string.IsNullOrWhiteSpace((string)x.personelKodu))
            .GroupBy(x => $"{K((string)x.personelKodu)}|{(string)x.asama}", StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(x => (DateTime)x.olusturma).OrderBy(x => x).ToList(),
                          StringComparer.OrdinalIgnoreCase);

        var grupSureleri = new Dictionary<string, List<double>>(StringComparer.OrdinalIgnoreCase);
        var grupSonKanal = new Dictionary<string, (DateTime zaman, string kanal)>(StringComparer.OrdinalIgnoreCase);

        foreach (var r in satirlar.Where(x => (string)x.tur == "yonetici"
                                              && x.dolduruldu is not null
                                              && !string.IsNullOrWhiteSpace((string)x.subeAdi)))
        {
            var sube = ((string)r.subeAdi).Trim();
            var tel = (string)r.telefon ?? "";
            var kisi2 = personeller.FirstOrDefault(x => TelefonSadelestir(x.Telefon) == tel);
            var ad = kisi2 is not null ? $"{kisi2.Ad} {kisi2.Soyad}".Trim() : (string)r.adSoyad;
            var anahtar = sube + "|" + (tel.Length > 0 ? tel : ad ?? "");
            var doldurma = (DateTime)r.dolduruldu;
            var satirKanal = (string)r.kanal == "uygulama" ? "uygulama" : "sms";

            if (!yoneticiGruplari.TryGetValue(anahtar, out var grup))
                yoneticiGruplari[anahtar] = grup = (sube, ad, tel, new List<double>(), new HashSet<string>(StringComparer.OrdinalIgnoreCase));

            if (!grupSureleri.ContainsKey(anahtar)) grupSureleri[anahtar] = new List<double>();

            /* Kanal: yöneticinin en son değerlendirmesi nereden yapıldıysa */
            if (!grupSonKanal.TryGetValue(anahtar, out var sk) || doldurma > sk.zaman)
                grupSonKanal[anahtar] = (doldurma, satirKanal);

            foreach (var form in UyumAnaliz.Formlar((string)r.cevaplarJson))
            {
                if (form.Ortalama is not null) grup.yPuan.Add(form.Ortalama.Value);

                var fk = form.PersonelKodu;
                if (string.IsNullOrWhiteSpace(fk) && raporKisiTahmini.TryGetValue((int)r.id, out var th))
                    fk = th;
                if (!string.IsNullOrWhiteSpace(fk)) grup.kisiler.Add(fk.Trim());

                /* Aynı kişinin bu aşamadaki, değerlendirmeden önce açılmış
                   en son anketi */
                if (!string.IsNullOrWhiteSpace(fk)
                    && calisanAcilis.TryGetValue($"{K(fk)}|{(string)r.asama}", out var acilislar))
                {
                    var acilis = acilislar.LastOrDefault(x => x <= doldurma);

                    if (acilis != default)
                    {
                        var saat = (doldurma - acilis).TotalHours;

                        if (saat >= 0 && saat <= 24 * 90) grupSureleri[anahtar].Add(saat);
                    }
                }
            }
        }

        /* Yönetici formu hiç gelmemiş şubeler de listede kalsın: çalışan
           puanı ve kimin gideceği görünür */
        foreach (var sube in satirlar
                     .Where(x => (string)x.tur == "calisan" && x.dolduruldu is not null
                                 && !string.IsNullOrWhiteSpace((string)x.subeAdi))
                     .Select(x => ((string)x.subeAdi).Trim())
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (yoneticiGruplari.Keys.Any(k => k.StartsWith(sube + "|", StringComparison.OrdinalIgnoreCase)))
                continue;

            var (ad, _) = MagazaYoneticisi(personeller, sube);
            var kisiler = satirlar
                .Where(x => (string)x.tur == "calisan" && x.dolduruldu is not null
                            && string.Equals(((string)x.subeAdi ?? "").Trim(), sube, StringComparison.OrdinalIgnoreCase)
                            && !string.IsNullOrWhiteSpace((string)x.personelKodu))
                .Select(x => ((string)x.personelKodu).Trim());

            yoneticiGruplari[sube + "|"] = (sube, ad, "", new List<double>(),
                new HashSet<string>(kisiler, StringComparer.OrdinalIgnoreCase));
        }

        var yoneticiler = yoneticiGruplari
            .Select(kv =>
            {
                var g = kv.Value;
                var sureler = grupSureleri.GetValueOrDefault(kv.Key);
                var cList = g.kisiler
                    .Where(calisanPuanlari.ContainsKey)
                    .Select(k => calisanPuanlari[k])
                    .ToList();

                var c = cList.Count == 0 ? (double?)null : Math.Round(cList.Average(), 1);
                var y = g.yPuan.Count == 0 ? (double?)null : Math.Round(g.yPuan.Average(), 1);

                return new
                {
                    sube = g.sube,
                    yonetici = g.ad ?? "—",
                    calisanPuan = c,
                    yoneticiPuan = y,
                    kisiSayisi = g.kisiler.Count,
                    formSayisi = g.yPuan.Count,
                    kisiler = g.kisiler.ToList(),
                    erkenAyrilma = ErkenAyrilmaOrani(g.kisiler),
                    fark = c is null || y is null
                        ? (double?)null
                        : Math.Round(Math.Abs(c.Value - y.Value), 1),
                    /* Fark yönü: çalışan mı düşük veriyor, yönetici mi */
                    yon = c is null || y is null ? ""
                        : c < y ? "calisanDusuk" : "yoneticiDusuk",
                    /* Ortalama yanıt süresi (saat); yalnızca bilgi */
                    yanitSuresi = sureler is null || sureler.Count == 0
                        ? (double?)null
                        : Math.Round(sureler.Average(), 1),
                    /* Son değerlendirmenin kanalı; hiç değerlendirmediyse boş */
                    kanal = grupSonKanal.TryGetValue(kv.Key, out var sonK) ? sonK.kanal : null
                };
            })
            .OrderByDescending(x => x.fark ?? -1)
            .ThenBy(x => x.sube)
            .ThenBy(x => x.yonetici)
            .ToList();

        /* Soru bazında ortalama: hangi konuda güçlüyüz, hangisinde
           zayıfız. Puan ortalaması tek başına bunu söylemiyor. */
        var soruToplam = new Dictionary<string, (double toplam, int adet, string tur)>();

        foreach (var r in satirlar.Where(x => x.dolduruldu is not null))
        {
            try
            {
                using var kok = System.Text.Json.JsonDocument
                    .Parse((string)r.cevaplarJson ?? "{}");

                if (!kok.RootElement.TryGetProperty("sorular", out var dizi)
                    || dizi.ValueKind != System.Text.Json.JsonValueKind.Array)
                    continue;

                foreach (var so in dizi.EnumerateArray())
                {
                    if (!so.TryGetProperty("soru", out var sm)) continue;
                    if (!so.TryGetProperty("yanit", out var ym)) continue;
                    if (ym.ValueKind != System.Text.Json.JsonValueKind.Number) continue;

                    var tur = so.TryGetProperty("tur", out var tm)
                        ? tm.GetString() : "olcek";

                    /* 0–10 ölçeği 5'lik ölçeğe çevrilir ki ortalamalar
                       karşılaştırılabilir olsun */
                    var deger = ym.GetDouble() / (tur == "on" ? 10.0 : 5.0) * 5.0;

                    var ad = sm.GetString() ?? "";

                    if (ad.Length == 0) continue;

                    var anahtar = (string)r.tur + "|" + ad;

                    if (!soruToplam.TryGetValue(anahtar, out var mevcut))
                        mevcut = (0, 0, (string)r.tur);

                    soruToplam[anahtar] =
                        (mevcut.toplam + deger, mevcut.adet + 1, (string)r.tur);
                }
            }
            catch
            {
                /* Bozuk JSON tek formu etkiler, raporu düşürmez */
            }
        }

        var sorular = soruToplam
            .Where(x => x.Value.adet > 0)
            .Select(x => new
            {
                tur = x.Value.tur,
                soru = x.Key[(x.Key.IndexOf('|') + 1)..],
                ortalama = Math.Round(x.Value.toplam / x.Value.adet, 1),
                adet = x.Value.adet
            })
            .OrderBy(x => x.ortalama)
            .ToList();

        /* ================================================================ */
        /* Kişi bazında birleştirme ve serbest metin çözümlemesi            */
        /* ================================================================ */

        /* Aynı çalışanın kendi formu ile yöneticisinin formu ayrı
           satırlarda duruyor. Ayrılma ilişkisi, risk skoru ve alan
           karşılaştırması ancak kişide birleştikten sonra hesaplanabilir. */
        var kisiOzetleri =
            new Dictionary<string, UyumAnaliz.KisiOzeti>(StringComparer.OrdinalIgnoreCase);

        UyumAnaliz.KisiOzeti Ozet(string ham)
        {
            var kod = (ham ?? "").Trim();

            if (kod.Length == 0) return null;

            if (!kisiOzetleri.TryGetValue(kod, out var o))
                kisiOzetleri[kod] = o = new UyumAnaliz.KisiOzeti { PersonelKodu = kod };

            return o;
        }

        var memnunMetinleri = new List<UyumAnaliz.SerbestYanit>();
        var istekMetinleri = new List<UyumAnaliz.SerbestYanit>();
        var gelisimMetinleri = new List<UyumAnaliz.SerbestYanit>();
        var tavsiyePuanlari = new List<double>();
        var ikBildirimleri = new List<object>();

        var alanToplam = new Dictionary<string, UyumAnaliz.AlanToplami>();

        foreach (var r in satirlar.Where(x => x.dolduruldu is not null))
        {
            var tur = (string)r.tur;
            var asama = (string)r.asama ?? "";
            var subeAdi = (string)r.subeAdi;
            var dolduruldu = (DateTime)r.dolduruldu;
            var satirKodu = (string)r.personelKodu;
            var satirAdi = (string)r.adSoyad;
            var satirGorev = (string)r.gorev;

            foreach (var form in UyumAnaliz.Formlar((string)r.cevaplarJson))
            {
                /* Yönetici formunda kişi, gönderim satırında değil formun
                   içinde: bir gönderimde birden çok personel değerlendirilir. */
                var kod = tur == "yonetici" ? form.PersonelKodu : satirKodu;

                if (tur == "yonetici" && string.IsNullOrWhiteSpace(kod)
                    && raporKisiTahmini.TryGetValue((int)r.id, out var kodTahmini))
                    kod = kodTahmini;

                var ozet = Ozet(kod);

                if (ozet is not null)
                {
                    ozet.AdSoyad ??= form.AdSoyad ?? satirAdi;
                    ozet.SubeAdi ??= subeAdi;
                    ozet.Gorev ??= satirGorev;

                    if (ozet.SonForm is null || dolduruldu > ozet.SonForm.Value)
                        ozet.SonForm = dolduruldu;

                    var ort = form.Ortalama;

                    if (ort is not null && asama.Length > 0)
                    {
                        if (tur == "calisan") ozet.CalisanPuan[asama] = ort.Value;
                        else ozet.YoneticiPuan[asama] = ort.Value;
                    }
                }

                foreach (var y in form.Yanitlar)
                {
                    /* Ölçek yanıtları konu alanlarında toplanır: iki tarafın
                       soruları farklı yazıldığı için yan yana koymanın tek
                       yolu ortak alanlar. */
                    if (y.BesTaban is not null)
                    {
                        var alan = UyumAnaliz.Alan(y.Soru);

                        if (alan is not null)
                        {
                            if (!alanToplam.TryGetValue(alan, out var t))
                                alanToplam[alan] = t = new UyumAnaliz.AlanToplami();

                            t.Ekle(tur, y.Soru, y.BesTaban.Value);
                        }
                    }

                    UyumAnaliz.SerbestYanit Serbest() => new()
                    {
                        Metin = y.Metin.Trim(),
                        AdSoyad = form.AdSoyad ?? satirAdi,
                        SubeAdi = subeAdi,
                        AsamaAdi = AsamaAdi.GetValueOrDefault(asama, asama),
                        PersonelKodu = kod
                    };

                    if (tur == "calisan")
                    {
                        if (y.Sayi is not null && UyumAnaliz.TavsiyeSorusu(y.Soru))
                            tavsiyePuanlari.Add(y.Sayi.Value);

                        if (!string.IsNullOrWhiteSpace(y.Metin))
                        {
                            if (UyumAnaliz.MemnunSorusu(y.Soru))
                                memnunMetinleri.Add(Serbest());
                            else if (UyumAnaliz.IstekSorusu(y.Soru))
                                istekMetinleri.Add(Serbest());
                        }

                        if (UyumAnaliz.BeklentiSorusu(y.Soru)
                            && UyumAnaliz.Evet(y.Metin) && ozet is not null)
                            ozet.BeklentiFarki = true;
                    }
                    else if (!string.IsNullOrWhiteSpace(y.Metin)
                             && UyumAnaliz.GelisimSorusu(y.Soru))
                    {
                        gelisimMetinleri.Add(Serbest());
                    }

                    /* İK'ya iletilmek istenen konu: iki tarafta da sorulur
                       ve ikisi de İK'nın bugün ilgilenmesi gereken iş. */
                    if (UyumAnaliz.IkBildirimSorusu(y.Soru) && UyumAnaliz.Evet(y.Metin))
                    {
                        if (ozet is not null) ozet.IkBildirim = true;

                        ikBildirimleri.Add(new
                        {
                            personelKodu = kod,
                            adSoyad = form.AdSoyad ?? satirAdi,
                            subeAdi,
                            gorev = satirGorev,
                            asama,
                            asamaAdi = AsamaAdi.GetValueOrDefault(asama, asama),
                            tur,
                            aciklama = y.Aciklama
                        });
                    }
                }
            }
        }

        var alanlar = UyumAnaliz.AlanSirasi
            .Where(alanToplam.ContainsKey)
            .Select(a => new
            {
                alan = a,
                calisan = alanToplam[a].CalisanOrt,
                yonetici = alanToplam[a].YoneticiOrt,
                adet = alanToplam[a].CalisanAdet + alanToplam[a].YoneticiAdet,
                sorular = alanToplam[a].SoruListesi()
            })
            .ToList();

        /* ---------------------------------------------- ayrılma ilişkisi */

        /* Formdan sonraki altı ay içinde ayrılmış mı. Sistemin en değerli
           çıktısı bu: hangi geribildirim işaretinin gerçekten ayrılmaya
           dönüştüğünü gösteriyor. */
        bool SonrakiAltiAydaAyrildi(UyumAnaliz.KisiOzeti o)
        {
            if (!personelHaritasi.TryGetValue(o.PersonelKodu, out var k)) return false;
            if (k.CikisTarihi is null) return false;
            if (o.SonForm is null) return false;

            var gun = (k.CikisTarihi.Value - o.SonForm.Value).TotalDays;

            return gun >= 0 && gun <= 183;
        }

        object AyrilmaSatiri(string ad, List<UyumAnaliz.KisiOzeti> kume, string tur)
        {
            var ayrilan = kume.Count(SonrakiAltiAydaAyrildi);

            return new
            {
                ad,
                tur,
                kisi = kume.Count,
                ayrilan,
                oran = kume.Count == 0
                    ? (int?)null
                    : (int)Math.Round(ayrilan * 100.0 / kume.Count),
                /* Satıra tıklanınca kümedeki kişiler karne listesinde açılır */
                kisiler = kume.Select(x => x.PersonelKodu).ToList(),
                ayrilanlar = kume.Where(SonrakiAltiAydaAyrildi)
                                 .Select(x => x.PersonelKodu).ToList()
            };
        }

        var tumKisiler = kisiOzetleri.Values
            .Where(x => x.CalisanPuan.Count > 0 || x.YoneticiPuan.Count > 0)
            .ToList();

        var ayrilmaIliskisi = new List<object>
        {
            AyrilmaSatiri(
                "2. ayda yönetici değerlendirmesi 2 ve altında",
                tumKisiler.Where(x => x.YoneticiPuan.TryGetValue("2a", out var v)
                                      && v <= 2).ToList(),
                "risk"),

            AyrilmaSatiri(
                "7. günde beklenti/gerçeklik farkı bildirdi",
                tumKisiler.Where(x => x.BeklentiFarki).ToList(),
                "uyari"),

            AyrilmaSatiri(
                "İK'ya iletilmek istenen konu bildirdi",
                tumKisiler.Where(x => x.IkBildirim).ToList(),
                "uyari"),

            AyrilmaSatiri("Genel ortalama", tumKisiler, "genel"),

            AyrilmaSatiri(
                "Tüm ölçümlerde 4 ve üzeri",
                tumKisiler.Where(x => x.CalisanPuan.Count > 0
                                      && x.CalisanPuan.Values.All(v => v >= 4))
                          .ToList(),
                "iyi")
        };

        /* ------------------------------------------------ geciken formlar */

        /* Süresi dolmuş ve doldurulmamış gönderimler; İK'nın hangi mağazayı
           arayacağını buradan görür. */
        var gecikenler = kacan
            .Where(x => !string.IsNullOrWhiteSpace((string)x.subeAdi))
            .GroupBy(x => new
            {
                sube = ((string)x.subeAdi).Trim(),
                asama = (string)x.asama ?? "",
                tur = (string)x.tur
            })
            .Select(g => new
            {
                g.Key.sube,
                g.Key.asama,
                asamaAdi = AsamaAdi.GetValueOrDefault(g.Key.asama, g.Key.asama),
                g.Key.tur,
                adet = g.Count(),
                gun = (int)g.Max(x => (DateTime.Now - (DateTime)x.gecerlilik).TotalDays)
            })
            .OrderByDescending(x => x.gun)
            .Take(20)
            .ToList();

        /* ---------------------------------------------------- kanal kırılımı */

        /* Çalışan anketi uygulamaya mı düştü, SMS ile mi gitti. Eski
           kayıtlarda kanal boş; o zaman yalnızca SMS vardı. Ortalama süre
           anketin açılmasından doldurulmasına kadar geçen saat. */
        var calisanSatirlari = satirlar.Where(x => (string)x.tur == "calisan").ToList();

        string Kanal(dynamic x) => (string)x.kanal == "uygulama" ? "uygulama" : "sms";

        var kanallar = new[] { "uygulama", "sms" }.Select(kn =>
        {
            var kume = calisanSatirlari.Where(x => Kanal(x) == kn).ToList();
            var dolu = kume.Where(x => x.dolduruldu is not null).ToList();
            var saatler = dolu
                .Select(x => ((DateTime)x.dolduruldu - (DateTime)x.olusturma).TotalHours)
                .Where(x => x >= 0)
                .ToList();

            return new
            {
                kanal = kn,
                gonderim = kume.Count,
                pay = calisanSatirlari.Count == 0
                    ? 0
                    : (int)Math.Round(kume.Count * 100.0 / calisanSatirlari.Count),
                tamamlanan = dolu.Count,
                oran = kume.Count == 0 ? (int?)null : (int)Math.Round(dolu.Count * 100.0 / kume.Count),
                ortalamaSaat = saatler.Count == 0 ? (double?)null : Math.Round(saatler.Average(), 1),
                /* Süresi dolup açılmayanlar */
                kacan = kume.Count(x => x.dolduruldu is null && (DateTime)x.gecerlilik < DateTime.Now)
            };
        }).ToList();

        /* SMS ile anket alıp uygulamayı hiç kurmamış, hâlâ çalışan kişiler */
        var uygulamasiz = 0;

        try
        {
            var jetonlu = db.Query<string>(@"
SELECT personel_kodu FROM KRY_MOBIL_JETON WHERE jeton IS NOT NULL AND jeton <> ''")
                .Select(K)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            uygulamasiz = calisanSatirlari
                .Where(x => Kanal(x) == "sms" && !string.IsNullOrWhiteSpace((string)x.personelKodu))
                .Select(x => ((string)x.personelKodu).Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(k => !jetonlu.Contains(K(k))
                            && personelHaritasi.TryGetValue(k, out var pk) && pk.Durum == 1);
        }
        catch
        {
            /* Jeton tablosu okunamazsa sayı gösterilmez */
        }

        /* Dönem içinde form gönderilmiş ayrı çalışan sayısı */
        var yeniBaslayan = satirlar
            .Where(x => (string)x.tur == "calisan")
            .Select(x => (string)(x.personelKodu ?? ""))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Count();

        /* Önceki eşit uzunluktaki dönem: değişim yönü için */
        var gunSayisi = Math.Max(1, (bitis.Date - baslangic).Days + 1);
        var oncekiBas = baslangic.AddDays(-gunSayisi);

        var onceki = db.Query(@"
SELECT puan, dolduruldu FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'calisan'
  AND olusturma >= @bas AND olusturma < @bit",
            new { bas = oncekiBas, bit = baslangic }).ToList();

        double? OncekiOrt()
        {
            var p = onceki
                .Where(x => x.dolduruldu is not null && x.puan is not null)
                .Select(x => (double)Convert.ToDecimal(x.puan))
                .ToList();

            return p.Count == 0 ? null : Math.Round(p.Average(), 1);
        }

        return Ok(new
        {
            baslangic,
            bitis = bitis.Date,
            sorular,
            oncekiDonem = new
            {
                baslangic = oncekiBas,
                bitis = baslangic.AddDays(-1),
                gonderim = onceki.Count,
                ortalama = OncekiOrt()
            },
            toplamGonderim,
            toplamTamam,
            genelOran = toplamGonderim == 0
                ? 0
                : (int)Math.Round(toplamTamam * 100.0 / toplamGonderim),
            kacanSayi = kacan.Count,
            riskliSayi = riskliler.Values.Sum(),
            yeniBaslayan,
            enps = UyumAnaliz.Enps(tavsiyePuanlari),
            enpsAdet = tavsiyePuanlari.Count,
            alanlar,
            memnunKonulari = UyumAnaliz.KonuDagilimi(memnunMetinleri, "memnun"),
            istekKonulari = UyumAnaliz.KonuDagilimi(istekMetinleri, "istek"),
            gelisimAlanlari = UyumAnaliz.KonuDagilimi(gelisimMetinleri, "gelisim"),
            serbestYanit = new
            {
                memnun = memnunMetinleri.Count,
                istek = istekMetinleri.Count,
                gelisim = gelisimMetinleri.Count
            },
            ikBildirimleri,
            gecikenler,
            ayrilmaIliskisi,
            asamalar,
            magazalar = magazaListe,
            yoneticiler,
            kanallar,
            uygulamasiz
        });
    }

    /// <summary>
    /// Çalışan karneleri: kişi başına dört aşamanın yan yana görünümü.
    ///
    /// <para>
    /// Durum rengi kaba bir işarettir, karar değil: puan düşükse ya da
    /// dönemler arasında belirgin düşüş varsa sarı/kırmızı olur. İK'nın
    /// hangi kişiyle ilgileneceğini seçmesine yarar.
    /// </para>
    /// </summary>
    [HttpGet("Karneler")]
    [Authorize]
    public IActionResult Karneler()
    {
        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       gorev, asama, tur, puan, dolduruldu, cevaplar_json AS cevaplarJson
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND personel_kodu IS NOT NULL AND tur = 'calisan'").ToList();

        /* Yönetici değerlendirmeleri kişi bazında cevaplar_json içinde
           duruyor; karnede görünmesi için oradan çıkarılır. Aksi hâlde
           yönetici formu doldurulduğu hâlde karne boş kalıyordu. */
        var yoneticiPuanlari = new Dictionary<string, Dictionary<string, double>>(StringComparer.OrdinalIgnoreCase);
        var kisiKodlari = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var yoneticiKayitlari = db.Query(@"
SELECT id, asama, cevaplar_json AS cevaplarJson
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND dolduruldu IS NOT NULL").ToList();

        var kisiTahmini = YoneticiKisiTahmini(db);

        foreach (var y in yoneticiKayitlari)
        {
            try
            {
                using var kok = System.Text.Json.JsonDocument
                    .Parse((string)y.cevaplarJson ?? "[]");

                var kayitlar = kok.RootElement.ValueKind
                               == System.Text.Json.JsonValueKind.Array
                    ? kok.RootElement.EnumerateArray().ToList()
                    : new List<System.Text.Json.JsonElement> { kok.RootElement };

                foreach (var el in kayitlar)
                {
                    string kisiKodu = null;

                    if (el.TryGetProperty("personelKodu", out var pk))
                        kisiKodu = pk.ValueKind == System.Text.Json.JsonValueKind.Number
                            ? pk.GetRawText() : pk.GetString();

                    /* Kişi kodu yoksa aynı şube/aşama/tarihten tek aday varsa o */
                    if (string.IsNullOrWhiteSpace(kisiKodu)
                        && kisiTahmini.TryGetValue((int)y.id, out var tahmin))
                        kisiKodu = tahmin;

                    if (string.IsNullOrWhiteSpace(kisiKodu)) continue;

                    if (!el.TryGetProperty("sorular", out var dizi)
                        || dizi.ValueKind != System.Text.Json.JsonValueKind.Array)
                        continue;

                    var toplam = 0.0;
                    var adet = 0;

                    foreach (var so in dizi.EnumerateArray())
                    {
                        if (!so.TryGetProperty("yanit", out var ym)) continue;
                        if (ym.ValueKind != System.Text.Json.JsonValueKind.Number) continue;

                        var tur = so.TryGetProperty("tur", out var tm)
                            ? tm.GetString() : "olcek";

                        toplam += ym.GetDouble() / (tur == "on" ? 10.0 : 5.0) * 5.0;
                        adet++;
                    }

                    if (adet == 0) continue;

                    /* Anahtar baştaki sıfırlar atılarak: uygulamadan gelen
                       değerlendirmede sicil farklı yazılmış olabilir. */
                    kisiKodlari.TryAdd(K(kisiKodu), kisiKodu.Trim());

                    if (!yoneticiPuanlari.TryGetValue(K(kisiKodu), out var kume))
                        yoneticiPuanlari[K(kisiKodu)] = kume = new Dictionary<string, double>();

                    kume[(string)y.asama] = Math.Round(toplam / adet, 1);
                }
            }
            catch
            {
                /* Bozuk kayıt tek formu etkiler */
            }
        }

        /* Yalnızca yönetici değerlendirmesi olan kişiler de karnede
           görünmeli; çalışan formu göndermemiş olabilirler. */
        foreach (var ek in yoneticiPuanlari.Keys)
        {
            if (satirlar.Any(x => string.Equals(K((string)x.personelKodu), ek,
                                                StringComparison.OrdinalIgnoreCase)))
                continue;

            satirlar.Add(new
            {
                personelKodu = kisiKodlari.GetValueOrDefault(ek, ek),
                adSoyad = (string)null,
                subeAdi = (string)null,
                gorev = (string)null,
                asama = (string)null,
                tur = "yonetici",
                puan = (decimal?)null,
                dolduruldu = (DateTime?)null,
                cevaplarJson = (string)null
            });
        }

        var karneler = satirlar
            .GroupBy(x => ((string)x.personelKodu).Trim())
            .Select(g =>
            {
                double? Puan(string a)
                {
                    var k = g.FirstOrDefault(x => (string)x.asama == a
                                                  && x.dolduruldu is not null
                                                  && x.puan is not null);

                    return k is null ? null : (double)Convert.ToDecimal(k.puan);
                }

                var p = Aralik.Keys.Select(Puan).ToList();

                yoneticiPuanlari.TryGetValue(K(g.Key), out var yp);

                var yoneticiP = Aralik.Keys
                    .Select(a => yp is not null && yp.TryGetValue(a, out var v)
                        ? v : (double?)null)
                    .ToList();
                var dolu = p.Where(x => x is not null).Select(x => x.Value).ToList();

                /* Son iki dolu ölçüm arasındaki düşüş; eğilim tek bir
                   ortalamadan daha çok şey söylüyor. */
                double dusus = 0;

                if (dolu.Count >= 2)
                    dusus = dolu[^2] - dolu[^1];

                var son = dolu.Count > 0 ? dolu[^1] : (double?)null;

                /* Çalışan formu yoksa yöneticinin son puanı da durum verir;
                   yalnız yönetici değerlendirmesi olan kişi "veri yok"
                   görünüp yanında risk skoru taşıyordu, çelişkiliydi. */
                var yoneticiDolu = yoneticiP.Where(x => x is not null).Select(x => x.Value).ToList();
                var durumPuani = son ?? (yoneticiDolu.Count > 0 ? yoneticiDolu[^1] : (double?)null);
                var durumKaynagi = son is not null ? "calisan"
                                 : yoneticiDolu.Count > 0 ? "yonetici" : null;

                var durum = durumPuani is null ? "veri yok"
                          : durumPuani < 3.0 || dusus >= 1.0 ? "risk"
                          : durumPuani < 3.8 || dusus >= 0.5 ? "takip"
                          : "iyi";

                var ilk = g.First();

                /* Risk skoru listede de görünmeli: İK sıralamayı buradan
                   yapıyor, tek tek karne açarak değil. */
                var ikBildirim = false;
                var beklentiFarki = false;

                foreach (var r in g.Where(x => x.dolduruldu is not null))
                {
                    foreach (var form in UyumAnaliz.Formlar((string)r.cevaplarJson))
                    {
                        foreach (var y in form.Yanitlar)
                        {
                            if (string.IsNullOrWhiteSpace(y.Metin)) continue;

                            if (UyumAnaliz.IkBildirimSorusu(y.Soru)
                                && UyumAnaliz.Evet(y.Metin)) ikBildirim = true;

                            if (UyumAnaliz.BeklentiSorusu(y.Soru)
                                && UyumAnaliz.Evet(y.Metin)) beklentiFarki = true;
                        }
                    }
                }

                var yDolu = yoneticiP.Where(x => x is not null)
                                     .Select(x => x.Value).ToList();

                var riskSkoru = UyumAnaliz.RiskSkoru(
                    son,
                    dolu.Count >= 2 ? Math.Round(dusus, 1) : (double?)null,
                    yDolu.Count > 0 ? yDolu[^1] : (double?)null,
                    ikBildirim, beklentiFarki);

                /* Çalışanın son puanı ile yöneticinin son puanı arasındaki
                   fark: iki taraf aynı kişiyi çok farklı görüyorsa İK'nın
                   bakması gerekir. */
                var gorusFarki = son is null || yDolu.Count == 0
                    ? (double?)null
                    : Math.Round(Math.Abs(son.Value - yDolu[^1]), 1);

                return new
                {
                    personelKodu = g.Key,
                    adSoyad = (string)ilk.adSoyad,
                    subeAdi = (string)ilk.subeAdi,
                    gorev = (string)ilk.gorev,
                    puanlar = p,
                    yoneticiPuanlar = yoneticiP,
                    son,
                    dusus = Math.Round(dusus, 1),
                    durum,
                    durumKaynagi,
                    riskSkoru,
                    gorusFarki,
                    ikBildirim,
                    beklentiFarki,
                    tamamlanan = g.Count(x => x.dolduruldu is not null)
                };
            })
            .OrderByDescending(x => x.riskSkoru ?? -1)
            .ThenBy(x => x.durum == "risk" ? 0 : x.durum == "takip" ? 1 : 2)
            .ThenBy(x => x.son ?? 9)
            .ToList();

        return Ok(new { karneler });
    }

    /// <summary>
    /// Bir çalışanın yöneticisine değerlendirme bağlantısı gönderir.
    ///
    /// <para>
    /// Toplu gönderimde yönetici bildirimi kendiliğinden gidiyor; bu uç
    /// sonradan göndermek içindir. Yönetici, çalışanın biriminden ve görev
    /// alanından bulunur.
    /// </para>
    /// </summary>
    /// <summary>
    /// Daha önce gönderilmiş ama yanıtlanmamış anketi yeniden gönderir:
    /// çalışana, yöneticisine ya da ikisine. Pencere şartı aranmaz — kişi
    /// pencereden çıkmış olabilir.
    ///
    /// <para>
    /// Çalışan: yeni anket satırı açılır (kanal = uygulama), süre baştan
    /// başlar; eskisi süresi dolana kadar açık kalır. Biçen360 ana sayfası
    /// en yeni açık anketi gösterir. Yönetici: değerlendirme Biçen360'ta
    /// yeniden açılır (<see cref="UyumGonderimServisi.YoneticiyeAc"/>).
    /// SMS gitmez.
    /// </para>
    /// </summary>
    [HttpPost("YenidenGonder")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> YenidenGonder([FromBody] UyumYenidenGirdi girdi)
    {
        var asama = (girdi?.Asama ?? "").Trim().ToLowerInvariant();
        var kod = (girdi?.PersonelKodu ?? "").Trim();

        if (!AsamaAdi.ContainsKey(asama) || kod.Length == 0)
            return BadRequest(new { hata = "Personel ya da aşama geçersiz." });

        if (!girdi.Calisan && !girdi.Yonetici)
            return BadRequest(new { hata = "Kime gönderileceğini seçiniz." });

        List<PersonelKaydi> personeller;

        try { personeller = _personelKaynak.TumPersonelleriGetir(); }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Personel listesi alınamadı.", ayrinti = hata.Message });
        }

        var kisi = personeller.FirstOrDefault(x =>
            string.Equals((x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase));

        if (kisi is null)
            return NotFound(new { hata = "Personel bulunamadı." });

        using var db = _vt.Baglanti();

        var sonuclar = new List<string>();
        var hatalar = new List<string>();
        var notlar = new List<string>();
        var girisYapmamis = new List<string>();
        var adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim();

        if (girdi.Calisan)
        {
            var s = await CalisanaGonder(db, asama, kisi.PersonelKodu.Trim(), adSoyad,
                                         kisi.Sube, kisi.Pozisyon, kisi.Telefon, kisi.GirisTarihi);

            if (!s.Basarili)
                hatalar.Add("Çalışanın anketi açılamadı" + (s.Hata is null ? "." : $": {s.Hata}"));
            else if (s.GirisYok)
            {
                sonuclar.Add($"{adSoyad} (çalışan · anket açıldı)");
                girisYapmamis.Add(adSoyad);
                notlar.Add($"{adSoyad} Biçen360'a giriş yapmamış; bildirim gidemedi, anket giriş yapınca görünecek.");
            }
            else
                sonuclar.Add($"{adSoyad} (çalışan · Biçen360 bildirimi)");
        }

        if (girdi.Yonetici)
        {
            var y = await _gonderim.YoneticiyeAc(db, asama, new[] { kisi }, personeller, AdSoyad);

            YoneticiSonucunuYaz(y, sonuclar, hatalar, notlar, girisYapmamis);
        }

        return Ok(new
        {
            tamam = sonuclar.Count > 0,
            gonderilen = sonuclar,
            hatalar,
            girisYapmamis,
            mesaj = sonuclar.Count > 0
                ? "Gönderildi: " + string.Join(", ", sonuclar)
                  + (hatalar.Count + notlar.Count > 0 ? " · " + string.Join(" ", hatalar.Concat(notlar)) : "")
                : string.Join(" ", hatalar.Concat(notlar))
        });
    }

    /// <summary>
    /// Yönetici sonucunu tek kişilik gönderimlerin yanıtına çevirir.
    /// </summary>
    private static void YoneticiSonucunuYaz(UyumYoneticiSonucu y, List<string> sonuclar,
        List<string> hatalar, List<string> notlar, List<string> girisYapmamis)
    {
        if (y.Degerlendirilmis.Count > 0)
            hatalar.Add("Yönetici bu aşamanın değerlendirmesini zaten yapmış.");
        else if (y.Hedefler.Count == 0)
            hatalar.Add("Yönetici Biçen360'ta bulunamadı.");

        foreach (var h in y.Hedefler)
        {
            if (h.GirisYok)
            {
                sonuclar.Add($"{h.Ad} (yönetici · değerlendirme açıldı)");
                girisYapmamis.Add(h.Ad);
                notlar.Add($"{h.Ad} Biçen360'a giriş yapmamış; bildirim gidemedi, değerlendirme giriş yapınca görünecek.");
            }
            else
                sonuclar.Add($"{h.Ad} (yönetici · Biçen360 bildirimi)");
        }
    }

    /// <summary>
    /// Yanıtsız anketleri toplu yeniden gönderir. Çalışana kişi başına
    /// Biçen360'ta yeni anket; yöneticiye değerlendirme yeniden açılır ve
    /// yönetici başına tek bildirim gider, aynı yöneticiye aynı aşama için
    /// bugün ikinci bildirim gitmez. SMS gitmez.
    /// </summary>
    [HttpPost("YenidenGonderToplu")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> YenidenGonderToplu([FromBody] UyumYenidenTopluGirdi girdi)
    {
        var asama = (girdi?.Asama ?? "").Trim().ToLowerInvariant();

        if (!AsamaAdi.ContainsKey(asama))
            return BadRequest(new { hata = "Aşama geçersiz." });

        var kodlar = (girdi.PersonelKodlari ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (kodlar.Count == 0)
            return BadRequest(new { hata = "Personel seçilmedi." });

        List<PersonelKaydi> personeller;

        try { personeller = _personelKaynak.TumPersonelleriGetir(); }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Personel listesi alınamadı.", ayrinti = hata.Message });
        }

        using var db = _vt.Baglanti();

        var calisanGonderim = 0;
        var yoneticiGonderim = 0;
        var atlanan = new List<string>();
        var girisYapmamis = new List<string>();
        var yoneticiGirisYapmamis = new List<string>();
        var gidenler = new List<PersonelKaydi>();

        foreach (var kod in kodlar)
        {
            var kisi = personeller.FirstOrDefault(x =>
                string.Equals((x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase));

            if (kisi is null) { atlanan.Add($"{kod}: personel bulunamadı"); continue; }

            gidenler.Add(kisi);

            if (!girdi.Calisan) continue;

            var adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim();

            try
            {
                var s = await CalisanaGonder(db, asama, kisi.PersonelKodu.Trim(), adSoyad,
                                             kisi.Sube, kisi.Pozisyon, kisi.Telefon, kisi.GirisTarihi);

                if (s.Basarili)
                {
                    calisanGonderim++;

                    if (s.GirisYok) girisYapmamis.Add(adSoyad);
                }
                else
                    atlanan.Add($"{adSoyad}: {s.Hata ?? "anket açılamadı"}");
            }
            catch (Exception hata)
            {
                atlanan.Add($"{adSoyad}: {hata.Message}");
            }
        }

        if (girdi.Yonetici && gidenler.Count > 0)
        {
            try
            {
                var y = await _gonderim.YoneticiyeAc(db, asama, gidenler, personeller, AdSoyad, "oryyonetici");

                yoneticiGonderim = y.Hedefler.Count;
                yoneticiGirisYapmamis = y.Hedefler.Where(x => x.GirisYok).Select(x => x.Ad).ToList();

                atlanan.AddRange(y.Bulunamayan.Select(x => $"{x}: yönetici Biçen360'ta bulunamadı"));
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Toplu yönetici gönderimi başarısız: {Asama}", asama);
                atlanan.Add("Yöneticilere gönderilemedi: " + hata.Message);
            }
        }

        return Ok(new
        {
            calisanGonderim,
            yoneticiGonderim,
            atlanan,
            girisYapmamis,
            yoneticiGirisYapmamis,
            mesaj = $"{calisanGonderim} çalışana, {yoneticiGonderim} yöneticiye Biçen360'tan gönderildi"
                  + (girisYapmamis.Count + yoneticiGirisYapmamis.Count > 0
                      ? $" · {girisYapmamis.Count + yoneticiGirisYapmamis.Count} kişi Biçen360'a giriş yapmamış"
                      : "")
                  + (atlanan.Count > 0 ? $" · {atlanan.Count} atlandı" : "")
        });
    }

    /// <summary>
    /// Yöneticinin değerlendirmesini Biçen360'ta (yeniden) açar ve
    /// bildirim gönderir. Yönetici paneldeki kurala göre bulunur, telefonu
    /// aktif bir personelle eşleştirilir; bulunamazsa Ekibim'de kişiyi gören
    /// yöneticiler. Hiçbiri yoksa "Yönetici Biçen360'ta bulunamadı". SMS
    /// gitmez.
    /// </summary>
    [HttpPost("YoneticiyeGonder")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> YoneticiyeGonder(
        [FromQuery] string personelKodu, [FromQuery] string asama)
    {
        asama = (asama ?? "").Trim().ToLowerInvariant();

        if (!AsamaAdi.ContainsKey(asama))
            return BadRequest(new { hata = "Aşama geçersiz." });

        List<PersonelKaydi> personeller;

        try { personeller = _personelKaynak.TumPersonelleriGetir(); }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı");
            return BadRequest(new { hata = "Personel listesine ulaşılamadı." });
        }

        var kisi = personeller.FirstOrDefault(x =>
            string.Equals((x.PersonelKodu ?? "").Trim(), (personelKodu ?? "").Trim(),
                          StringComparison.OrdinalIgnoreCase));

        if (kisi is null)
            return NotFound(new { hata = "Personel bulunamadı." });

        using var db = _vt.Baglanti();

        return YoneticiYaniti(await _gonderim.YoneticiyeAc(db, asama, new[] { kisi }, personeller, AdSoyad),
                              kisi, bildirimSozu: "Biçen360 bildirimi gönderildi");
    }

    /// <summary>Tek kişilik yönetici gönderiminin yanıtı</summary>
    private IActionResult YoneticiYaniti(UyumYoneticiSonucu y, PersonelKaydi kisi, string bildirimSozu)
    {
        if (y.Degerlendirilmis.Count > 0)
            return Ok(new { tamam = false, mesaj = "Yönetici bu aşamanın değerlendirmesini zaten yapmış." });

        if (y.Hedefler.Count == 0)
            return BadRequest(new
            {
                hata = "Yönetici Biçen360'ta bulunamadı.",
                ayrinti = $"{kisi.Sube} biriminde yöneticinin cep numarası aktif bir personel kaydıyla "
                          + "eşleşmedi ve Ekibim'de bu personeli gören yönetici yok. Mağaza müdürünün "
                          + "değerlendirmesi için şubeye bağlı bölge müdürü, diğerleri için Form "
                          + "Ayarları'ndaki yönetici eşleştirmesi ya da izin onay tablosu kontrol edilmeli."
            });

        var adlar = string.Join(", ", y.Hedefler.Select(x => x.Ad));
        var girisYok = y.Hedefler.Where(x => x.GirisYok).Select(x => x.Ad).ToList();
        var bugun = y.Hedefler.Where(x => x.BugunBildirildi).Select(x => x.Ad).ToList();

        var mesaj = $"{adlar} için değerlendirme Biçen360'ta açıldı";

        if (y.Hedefler.Any(x => x.Bildirildi)) mesaj += $"; {bildirimSozu}";

        mesaj += ".";

        if (bugun.Count > 0)
            mesaj += $" {string.Join(", ", bugun)} bugün zaten bildirildi.";

        if (girisYok.Count > 0)
            mesaj += $" {string.Join(", ", girisYok)} Biçen360'a giriş yapmamış; bildirim gidemedi, "
                     + "değerlendirme giriş yapınca görünecek.";

        return Ok(new
        {
            tamam = true,
            kanal = "uygulama",
            yonetici = adlar,
            girisYapmamis = girisYok,
            mesaj
        });
    }

    /// <summary>
    /// Oryantasyon hatırlatması (panelde satır menüsü ve karne). SMS gitmez.
    ///
    /// <para>
    /// <b>kime = c</b> (personel): açık anketi varsa personele "Oryantasyon
    /// anketiniz bekliyor" bildirimi gider; aynı kişi ve aşama için günde
    /// bir kez (KRY_GOREV_BILDIRIM anahtarı <c>ikhatirlat|sicil|aşama|gün</c>).
    /// Süresi dolduysa ya da hiç gönderilmediyse yeniden gönderim yapılır
    /// (<see cref="YenidenGonder"/> ile aynı: yeni anket Biçen360'a açılır).
    /// </para>
    ///
    /// <para>
    /// <b>kime = y</b> (yönetici): değerlendirme Biçen360'ta yeniden açılır
    /// ve yöneticiye "Oryantasyon değerlendirmesi bekleniyor" bildirimi
    /// gider (<see cref="YoneticiyeGonder"/> ile aynı yönetici); bildirim
    /// günde bir kez.
    /// </para>
    /// </summary>
    [HttpPost("Hatirlat")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> Hatirlat([FromBody] UyumHatirlatGirdi girdi)
    {
        var asama = (girdi?.Asama ?? "").Trim().ToLowerInvariant();
        var kod = (girdi?.PersonelKodu ?? "").Trim();
        var kime = (girdi?.Kime ?? "").Trim().ToLowerInvariant();

        if (!AsamaAdi.ContainsKey(asama) || kod.Length == 0)
            return BadRequest(new { hata = "Personel ya da aşama geçersiz." });

        if (kime is not ("c" or "y"))
            return BadRequest(new { hata = "Kime: 'c' (personel) ya da 'y' (yönetici) olmalı." });

        using var db = _vt.Baglanti();

        if (kime == "c")
        {
            /* Bu aşamanın en son çalışan anketi */
            var anket = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, ad_soyad AS adSoyad, kanal, gecerlilik, dolduruldu
FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND test_mi = 0 AND asama = @asama AND personel_kodu = @kod
ORDER BY olusturma DESC", new { asama, kod });

            if (anket is not null && anket.dolduruldu is not null)
                return Ok(new { tamam = false, mesaj = "Personel bu aşamanın anketini zaten doldurmuş." });

            /* Açık anket Biçen360 ana sayfasında görünüyor (eski SMS
               kayıtları da); hatırlatma bildirimle yapılır. */
            var acik = anket is not null && (DateTime)anket.gecerlilik > DateTime.Now;

            if (acik)
            {
                var ad = (string)anket.adSoyad ?? kod;

                if (!UyumGonderimServisi.UygulamadaMi(db, kod))
                    return Ok(new
                    {
                        tamam = false,
                        girisYapmamis = new[] { ad },
                        mesaj = $"{ad} Biçen360'a giriş yapmamış; bildirim gönderilemiyor. "
                                + "Anketi giriş yapınca ana sayfasında görecek."
                    });

                if (!MazeretBelgeGorevi.BirKez(db, $"ikhatirlat|{K(kod)}|{asama}|{DateTime.Today:yyyyMMdd}"))
                    return Ok(new
                    {
                        tamam = false,
                        mesaj = $"{ad} adlı personele bugün zaten bildirimle hatırlatıldı."
                    });

                var kalan = Math.Max(1, (int)Math.Ceiling(((DateTime)anket.gecerlilik - DateTime.Now).TotalHours));

                await _gonderim.PersoneleHatirlat(db, kod, "Oryantasyon anketiniz bekliyor",
                    $"{AsamaAdi[asama]} anketiniz · {kalan} saat kaldı. Biçen360 ana sayfasından doldurabilirsiniz.");

                return Ok(new
                {
                    tamam = true,
                    kanal = "uygulama",
                    mesaj = $"{ad} adlı personele Biçen360 bildirimi gönderildi."
                });
            }

            /* Açık anket yok (süresi doldu ya da hiç gönderilmedi):
               Biçen360'a yeni anket */
            return await YenidenGonder(new UyumYenidenGirdi
            {
                PersonelKodu = kod,
                Asama = asama,
                Calisan = true,
                Yonetici = false
            });
        }

        /* ----------------------------------------------------- yönetici */
        List<PersonelKaydi> personeller;

        try { personeller = _personelKaynak.TumPersonelleriGetir(); }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı");
            return BadRequest(new { hata = "Personel listesine ulaşılamadı." });
        }

        var kisi = personeller.FirstOrDefault(x =>
            string.Equals((x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase));

        if (kisi is null)
            return NotFound(new { hata = "Personel bulunamadı." });

        /* Değerlendirme yeniden açılır (süresi dolduysa kart geri gelir);
           bildirim aynı yöneticiye aynı aşama için günde bir kez. */
        var y = await _gonderim.YoneticiyeAc(db, asama, new[] { kisi }, personeller, AdSoyad,
                                             $"ikyhatirlat|{K(kod)}");

        return YoneticiYaniti(y, kisi, bildirimSozu: "Biçen360 bildirimiyle hatırlatıldı");
    }

    /// <summary>
    /// Tek bir çalışanın karne ayrıntısı: personel kartı bilgileri ve
    /// doldurduğu formların tamamı.
    /// </summary>
    [HttpGet("Karne/{personelKodu}")]
    [Authorize]
    public IActionResult Karne(string personelKodu)
    {
        var kod = (personelKodu ?? "").Trim();

        if (kod.Length == 0)
            return BadRequest(new { hata = "Personel kodu veriniz." });

        using var db = _vt.Baglanti();

        var formlar = db.Query(@"
SELECT id, asama, tur, puan, dolduruldu, gecerlilik, olusturma,
       ad_soyad AS adSoyad, sube_adi AS subeAdi, gorev,
       giris_tarihi AS girisTarihi, cevaplar_json AS cevaplarJson,
       kanal, hatirlatma, gonderen, CAST(NULL AS NVARCHAR(30)) AS yoneticiKodu
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND personel_kodu = @kod AND tur = 'calisan'
ORDER BY olusturma", new { kod }).ToList();

        /* Yalnızca çalışan satırları: yöneticinin Biçen360 davet satırında
           da personel_kodu (değerlendirilecek kişi) dolu; o satırlar
           doldurulunca aşağıdaki yönetici formlarına girer.

           Yönetici formunda gönderim satırı mağazaya aittir, personel
           koduna değil: bir gönderimde birden çok kişi değerlendirilir.
           Bu yüzden yukarıdaki sorgu yöneticinin yanıtlarını getirmiyordu
           ve karnede "yöneticisi ne demiş" görünmüyordu. Aşağıda bu
           kişiye ait bölüm ayıklanıp forma çevrilir. */
        var yoneticiSatirlari = db.Query(@"
SELECT id, asama, tur, puan, dolduruldu, gecerlilik, olusturma,
       ad_soyad AS adSoyad, sube_adi AS subeAdi, gorev,
       cevaplar_json AS cevaplarJson, kanal, yonetici_kodu AS yoneticiKodu
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND dolduruldu IS NOT NULL
ORDER BY olusturma").ToList();

        /* 26.10.2026: yöneticiye açılmış ama henüz doldurulmamış davet
           (Biçen360). Karnede "değerlendirme yok" yerine kime gittiği ve
           yanıt beklendiği görünsün. */
        try
        {
            foreach (var d in db.Query(@"
SELECT id, asama, olusturma, gecerlilik, ad_soyad AS adSoyad, sube_adi AS subeAdi, yonetici_kodu AS yoneticiKodu
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND kanal = 'uygulama' AND dolduruldu IS NULL
  AND personel_kodu = @kod
ORDER BY olusturma", new { kod = kod.Trim() }))
                formlar.Add(new
                {
                    id = -(int)d.id,
                    asama = (string)d.asama,
                    tur = "yonetici",
                    puan = (decimal?)null,
                    dolduruldu = (DateTime?)null,
                    gecerlilik = (DateTime?)d.gecerlilik,
                    olusturma = (DateTime?)d.olusturma,
                    adSoyad = (string)d.adSoyad,
                    subeAdi = (string)d.subeAdi,
                    gorev = (string)null,
                    girisTarihi = (DateTime?)null,
                    kanal = "uygulama",
                    hatirlatma = (DateTime?)null,
                    gonderen = (string)null,
                    yoneticiKodu = (string)d.yoneticiKodu,
                    cevaplarJson = (string)null,
                });
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Açık yönetici davetleri okunamadı: {Kod}", kod);
        }

        var kisiTahmini = YoneticiKisiTahmini(db);

        foreach (var y in yoneticiSatirlari)
        {
            foreach (var form in UyumAnaliz.Formlar((string)y.cevaplarJson))
            {
                var formKodu = form.PersonelKodu;

                /* Eski kayıt: kişi kodu yok; şube/aşama/tarihten tek aday
                   bu kişiyse ona bağlanır */
                if (string.IsNullOrWhiteSpace(formKodu)
                    && kisiTahmini.TryGetValue((int)y.id, out var tahmin))
                    formKodu = tahmin;

                if (string.IsNullOrWhiteSpace(formKodu)) continue;

                if (!string.Equals(K(formKodu), K(kod),
                                   StringComparison.OrdinalIgnoreCase)) continue;

                var puanlar = form.Yanitlar
                    .Where(x => x.BesTaban is not null)
                    .Select(x => x.BesTaban.Value)
                    .ToList();

                formlar.Add(new
                {
                    id = -(int)y.id,
                    asama = (string)y.asama,
                    tur = "yonetici",
                    /* Gönderim satırındaki puan bütün kişilerin ortalaması;
                       burada yalnızca bu kişinin puanı gösterilir. */
                    puan = puanlar.Count == 0
                        ? (decimal?)null
                        : (decimal)Math.Round(puanlar.Average(), 1),
                    dolduruldu = (DateTime?)y.dolduruldu,
                    gecerlilik = (DateTime?)y.gecerlilik,
                    olusturma = (DateTime?)y.olusturma,
                    adSoyad = (string)y.adSoyad,
                    subeAdi = (string)y.subeAdi,
                    gorev = (string)y.gorev,
                    girisTarihi = (DateTime?)null,
                    /* Değerlendirme uygulamadan mı SMS bağlantısından mı */
                    kanal = (string)y.kanal == "uygulama" ? "uygulama" : "sms",
                    hatirlatma = (DateTime?)null,
                    gonderen = (string)null,
                    yoneticiKodu = (string)y.yoneticiKodu,
                    /* Yalnızca bu kişinin bölümü: yöneticinin başka
                       personel için verdiği yanıtlar burada görünmemeli. */
                    cevaplarJson = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        personelKodu = kod,
                        sorular = form.Yanitlar.Select(x => new
                        {
                            soru = x.Soru,
                            tur = x.Tur,
                            yanit = x.Sayi is not null
                                ? (object)x.Sayi.Value
                                : x.Metin,
                            aciklama = x.Aciklama
                        })
                    })
                });
            }
        }

        formlar = formlar
            .OrderBy(x => (DateTime?)x.olusturma ?? DateTime.MinValue)
            .ThenBy(x => (string)x.tur)
            .ToList();

        /* Personel kartı Mikro'dan; anket kaydındaki bilgiler gönderim
           anındaki hâli, kart ise güncel durum. İkisi ayrışabilir. */
        object kisi = null;

        try
        {
            var p2 = _personelKaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => string.Equals(K(x.PersonelKodu), K(kod),
                                                   StringComparison.OrdinalIgnoreCase));

            if (p2 is not null)
                kisi = new
                {
                    personelKodu = p2.PersonelKodu,
                    adSoyad = $"{p2.Ad} {p2.Soyad}".Trim(),
                    gorev = p2.Pozisyon,
                    subeAdi = p2.Sube,
                    telefon = p2.Telefon,
                    girisTarihi = p2.GirisTarihi,
                    cikisTarihi = p2.CikisTarihi,
                    calisiyor = p2.Durum == 1,
                    calismaGunu = p2.GirisTarihi is null
                        ? (int?)null
                        : (int)(DateTime.Today - p2.GirisTarihi.Value.Date).TotalDays
                };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel kartı okunamadı: {Kod}", kod);
        }

        /* Yöneticiye gönder düğmesine basmadan önce kimin geleceği
           görünsün: yanlış eşleşme bildirim gittikten sonra fark edilmesin. */
        object yonetici = null;

        try
        {
            var tum = _personelKaynak.TumPersonelleriGetir();

            var p3 = tum.FirstOrDefault(x =>
                string.Equals(K(x.PersonelKodu), K(kod),
                              StringComparison.OrdinalIgnoreCase));

            if (p3 is not null)
            {
                /* 26.10.2026: otomatik gönderimle aynı kaynak (yönetici
                   kuralı + Ekibim yöneticileri). Ünvandan tahmin kişinin
                   kendisini (ör. birim müdürü) yönetici gösteriyordu. */
                string ad = null, telefon = null;
                var kuraldan = false;
                try
                {
                    var hedef = _gonderim.YoneticiHedefleri(db, p3, tum)
                        .FirstOrDefault(x => !string.Equals(K(x.kod), K(p3.PersonelKodu), StringComparison.OrdinalIgnoreCase));
                    if (hedef.kod is not null)
                    {
                        ad = hedef.ad;
                        telefon = string.IsNullOrWhiteSpace(hedef.telefon) ? null : hedef.telefon;
                        kuraldan = true;
                    }
                }
                catch (Exception h)
                {
                    _kayit.LogWarning(h, "Yönetici hedefi bulunamadı: {Kod}", kod);
                }

                if (!kuraldan)
                    (ad, telefon) = MagazaYoneticisi(tum, p3.Sube, p3.Pozisyon);

                /* Tanımlı mı tahmin mi: eşleştirme tablosunda kayıt var mı */
                var eslesmeler = _ayar.FormOku().UyumYoneticiEslesme
                                 ?? new List<YoneticiEslesme>();

                var subeAnahtar = EslesmeAnahtari(p3.Sube);


                var tanimliMi = eslesmeler.Any(e =>
                    EslesmeAnahtari(e.Birim) == subeAnahtar
                    && (string.IsNullOrWhiteSpace(e.Pozisyon)
                        || EslesmeAnahtari(e.Pozisyon)
                           == EslesmeAnahtari(p3.Pozisyon)));

                yonetici = new
                {
                    ad,

                    /* Tanı: eşleşme tutmadığında hangi değerlerin
                       karşılaştırıldığı görünsün. */
                    tani = new
                    {
                        personelBirim = p3.Sube,
                        personelPozisyon = p3.Pozisyon,
                        birimAnahtar = subeAnahtar,
                        tanimSayisi = eslesmeler.Count,
                        tanimlar = eslesmeler.Select(e => new
                        {
                            e.Birim,
                            e.Pozisyon,
                            e.YoneticiKodu,
                            birimAnahtar = EslesmeAnahtari(e.Birim)
                        })
                    },
                    /* Numaranın tamamı gösterilmez; doğru kişi olduğunu
                       anlamaya son dört hane yetiyor. */
                    telefonSon = telefon is null || telefon.Length < 4
                        ? null : telefon[^4..],
                    bulundu = kuraldan || telefon is not null,
                    kaynak = kuraldan || tanimliMi ? "tanımlı" : "tahmin"
                };
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yönetici bulunamadı: {Kod}", kod);
        }

        /* ================================================================ */
        /* Karne çözümlemesi                                                */
        /* ================================================================ */

        /* Ekranda dört aşamanın puanları zaten yan yana duruyor ama İK'nın
           sorduğu soru "kiminle önce ilgileneyim". Aşağıdaki üç çıktı buna
           yanıt veriyor: risk skoru, alan bazında görüş farkı ve özet. */
        var asamaSirasi = Aralik.Keys.ToList();

        var calisanPuan = new Dictionary<string, double>();
        var yoneticiPuan = new Dictionary<string, double>();
        var alanToplam = new Dictionary<string, UyumAnaliz.AlanToplami>();

        var gucluMetinleri = new List<string>();
        var gelisimMetinleri = new List<string>();
        var ikBildirim = false;
        var beklentiFarki = false;

        foreach (var f in formlar.Where(x => x.dolduruldu is not null))
        {
            var tur = (string)f.tur;
            var asama = (string)f.asama ?? "";

            foreach (var form in UyumAnaliz.Formlar((string)f.cevaplarJson))
            {
                /* Yönetici formunda birden çok personel değerlendirilmiş
                   olabilir; yalnızca bu kişinin bölümü alınır. */
                if (tur == "yonetici"
                    && !string.IsNullOrWhiteSpace(form.PersonelKodu)
                    && !string.Equals(K(form.PersonelKodu), K(kod),
                                      StringComparison.OrdinalIgnoreCase))
                    continue;

                var ort = form.Ortalama;

                if (ort is not null && asama.Length > 0)
                {
                    if (tur == "calisan") calisanPuan[asama] = ort.Value;
                    else yoneticiPuan[asama] = ort.Value;
                }

                foreach (var y in form.Yanitlar)
                {
                    if (y.BesTaban is not null)
                    {
                        var alan = UyumAnaliz.Alan(y.Soru);

                        if (alan is not null)
                        {
                            if (!alanToplam.TryGetValue(alan, out var t))
                                alanToplam[alan] = t = new UyumAnaliz.AlanToplami();

                            t.Ekle(tur, y.Soru, y.BesTaban.Value);
                        }
                    }

                    if (!string.IsNullOrWhiteSpace(y.Metin))
                    {
                        if (tur == "yonetici" && UyumAnaliz.GucluSorusu(y.Soru))
                            gucluMetinleri.Add(y.Metin.Trim());

                        if (tur == "yonetici" && UyumAnaliz.GelisimSorusu(y.Soru))
                            gelisimMetinleri.Add(y.Metin.Trim());

                        if (UyumAnaliz.IkBildirimSorusu(y.Soru)
                            && UyumAnaliz.Evet(y.Metin))
                            ikBildirim = true;

                        if (tur == "calisan" && UyumAnaliz.BeklentiSorusu(y.Soru)
                            && UyumAnaliz.Evet(y.Metin))
                            beklentiFarki = true;
                    }
                }
            }
        }

        var farkAnalizi = UyumAnaliz.AlanSirasi
            .Where(alanToplam.ContainsKey)
            .Select(a => new
            {
                alan = a,
                calisan = alanToplam[a].CalisanOrt,
                yonetici = alanToplam[a].YoneticiOrt,
                fark = alanToplam[a].CalisanOrt is null
                       || alanToplam[a].YoneticiOrt is null
                    ? (double?)null
                    : Math.Round(Math.Abs(alanToplam[a].CalisanOrt.Value
                                          - alanToplam[a].YoneticiOrt.Value), 1),
                sorular = alanToplam[a].SoruListesi()
            })
            .ToList();

        var siraliCalisan = asamaSirasi
            .Where(calisanPuan.ContainsKey)
            .Select(a => calisanPuan[a])
            .ToList();

        var sonCalisan = siraliCalisan.Count > 0
            ? siraliCalisan[^1] : (double?)null;

        /* Düşüş yalnızca iki ölçüm varsa anlamlı; tek ölçümde hesaplanmaz */
        var dusus = siraliCalisan.Count >= 2
            ? Math.Round(siraliCalisan[^2] - siraliCalisan[^1], 1)
            : (double?)null;

        var siraliYonetici = asamaSirasi
            .Where(yoneticiPuan.ContainsKey)
            .Select(a => yoneticiPuan[a])
            .ToList();

        var sonYonetici = siraliYonetici.Count > 0
            ? siraliYonetici[^1] : (double?)null;

        var riskSkoru = UyumAnaliz.RiskSkoru(
            sonCalisan, dusus, sonYonetici, ikBildirim, beklentiFarki);

        var analiz = new
        {
            riskSkoru,
            sonCalisan = sonCalisan is null ? null : (double?)Math.Round(sonCalisan.Value, 1),
            sonYonetici = sonYonetici is null ? null : (double?)Math.Round(sonYonetici.Value, 1),
            dusus,
            ikBildirim,
            beklentiFarki,
            farkAnalizi,
            guclu = gucluMetinleri.Count == 0 ? null : string.Join(" · ", gucluMetinleri.Distinct()),
            gelisim = gelisimMetinleri.Count == 0 ? null : string.Join(" · ", gelisimMetinleri.Distinct()),
            asamaPuanlari = asamaSirasi.Select(a => new
            {
                asama = a,
                asamaAdi = AsamaAdi[a],
                calisan = calisanPuan.TryGetValue(a, out var c)
                    ? (double?)Math.Round(c, 1) : null,
                yonetici = yoneticiPuan.TryGetValue(a, out var y2)
                    ? (double?)Math.Round(y2, 1) : null
            }).ToList(),

            /* Aksiyon önerisi skordan türetilir; elle yazılmış sabit metin
               eşikler değiştiğinde gerçeği yansıtmayı bırakırdı. */
            sonrakiAksiyon = riskSkoru is null ? "Veri bekleniyor"
                : riskSkoru >= 60 ? "İK görüşmesi"
                : riskSkoru >= 35 ? "Yakın takip"
                : "Normal takip"
        };

        /* ================================================================ */
        /* Anket ve bildirim geçmişi                                        */
        /* ================================================================ */

        var gecmis = KarneGecmisi(db, kod, formlar);

        return Ok(new { kisi, formlar, yonetici, analiz, gecmis });
    }

    /// <summary>
    /// Kişinin oryantasyon zaman çizelgesi: anketin açılması (kanalıyla),
    /// 24 saat kala hatırlatma, doldurma ya da sürenin dolması, yönetici
    /// değerlendirmesi (kim, ne zaman, hangi kanaldan), yöneticiye giden
    /// bildirimler (KRY_GOREV_BILDIRIM), İK'nın hatırlatmaları ve İK
    /// görüşme notları. Zamana göre sıralı.
    ///
    /// <para>
    /// Her parça ayrı denenir: bir kaynak okunamazsa (tablo yok, kolon yok)
    /// geçmişin geri kalanı yine döner.
    /// </para>
    /// </summary>
    private List<object> KarneGecmisi(System.Data.IDbConnection db, string kod, List<dynamic> formlar)
    {
        var olaylar = new List<(DateTime zaman, string tur, string metin)>();

        string Ad(string a) => AsamaAdi.GetValueOrDefault(a ?? "", a ?? "");
        string Puan(object p) => p is null ? "" : $" · puan {Convert.ToDecimal(p):0.0}".Replace('.', ',');

        var calisanSatirlari = formlar.Where(f => (string)f.tur == "calisan").ToList();

        foreach (var f in calisanSatirlari)
        {
            var asamaAdi = Ad((string)f.asama);
            var uygulama = (string)f.kanal == "uygulama";
            var gonderen = (string)f.gonderen;

            olaylar.Add(((DateTime)f.olusturma, "calisan",
                $"{asamaAdi} anketi açıldı · "
                + (uygulama ? "uygulama bildirimi gönderildi" : "SMS gönderildi")
                + (string.IsNullOrWhiteSpace(gonderen) ? "" : $" · gönderen: {gonderen}")));

            if (f.hatirlatma is DateTime h)
                olaylar.Add((h, "calisan", $"24 saat kala hatırlatma bildirimi gönderildi · {asamaAdi}"));

            if (f.dolduruldu is DateTime d)
                olaylar.Add((d, "calisan", $"Çalışan anketi dolduruldu · {asamaAdi}{Puan(f.puan)}"));
            else if ((DateTime)f.gecerlilik < DateTime.Now)
                olaylar.Add(((DateTime)f.gecerlilik, "uyari",
                    $"{asamaAdi} anketinin süresi doldu; çalışan doldurmadı"));
        }

        foreach (var f in formlar.Where(f => (string)f.tur == "yonetici" && f.dolduruldu is not null))
        {
            var uygulama = (string)f.kanal == "uygulama";

            olaylar.Add(((DateTime)f.dolduruldu, "yonetici",
                $"{(string)f.adSoyad ?? "Yönetici"} değerlendirdi · {Ad((string)f.asama)} · "
                + (uygulama ? "uygulamadan" : "SMS bağlantısından") + Puan(f.puan)));
        }

        /* Şubeye giden SMS yönetici bağlantıları: kişinin anketinin
           açıldığı günlerde aynı şube ve aşamaya gidenler */
        try
        {
            foreach (var f in calisanSatirlari.Where(x => !string.IsNullOrWhiteSpace((string)x.subeAdi)))
            {
                var acilis = (DateTime)f.olusturma;

                foreach (var y in db.Query(@"
SELECT ad_soyad AS adSoyad, olusturma FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND (kanal IS NULL OR kanal <> 'uygulama')
  AND sube_adi = @sube AND asama = @asama
  AND olusturma >= DATEADD(day, -3, @acilis) AND olusturma <= DATEADD(day, 15, @acilis)",
                             new { sube = ((string)f.subeAdi).Trim(), asama = (string)f.asama, acilis }))
                {
                    olaylar.Add(((DateTime)y.olusturma, "bildirim",
                        $"Yöneticisi {(string)y.adSoyad} bilgilendirildi · SMS bağlantısı · {Ad((string)f.asama)}"));
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yönetici SMS geçmişi okunamadı: {Kod}", kod);
        }

        /* Biçen360'ta yöneticiye açılan değerlendirmeler (davet satırları:
           tur = yonetici, kanal = uygulama, personel_kodu = bu kişi) */
        try
        {
            foreach (var y in db.Query(@"
SELECT ad_soyad AS adSoyad, asama, olusturma, gecerlilik, dolduruldu FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND kanal = 'uygulama' AND personel_kodu = @kod",
                         new { kod }))
            {
                olaylar.Add(((DateTime)y.olusturma, "bildirim",
                    $"Yöneticisi {(string)y.adSoyad} için değerlendirme açıldı · Biçen360 bildirimi · {Ad((string)y.asama)}"));

                if (y.dolduruldu is null && (DateTime)y.gecerlilik < DateTime.Now)
                    olaylar.Add(((DateTime)y.gecerlilik, "uyari",
                        $"Yöneticisi {(string)y.adSoyad} {Ad((string)y.asama)} değerlendirmesini süresinde yapmadı"));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yönetici Biçen360 geçmişi okunamadı: {Kod}", kod);
        }

        /* Bir kez giden bildirimler (OryantasyonHatirlatmaGorevi, Biçen360
           ve İK hatırlatmaları) */
        try
        {
            var idler = calisanSatirlari.ToDictionary(x => (int)x.id, x => (string)x.asama);
            var anahtarlar = idler.Keys
                .SelectMany(id => new[] { $"orybasla|{id}", $"oryazal|{id}", $"orytamam|{id}" })
                .ToList();

            var satirlar = db.Query(@"
SELECT anahtar, zaman FROM KRY_GOREV_BILDIRIM
WHERE anahtar IN @anahtarlar
   OR anahtar LIKE @p1 OR anahtar LIKE @p2 OR anahtar LIKE @p3",
                new
                {
                    anahtarlar = anahtarlar.Count == 0 ? new List<string> { "-" } : anahtarlar,
                    p1 = $"oryhatirlat|{K(kod)}|%",
                    p2 = $"ikhatirlat|{K(kod)}|%",
                    p3 = $"ikyhatirlat|{K(kod)}|%"
                });

            foreach (var b in satirlar)
            {
                var anahtar = (string)b.anahtar;
                var zaman = (DateTime)b.zaman;
                var parca = anahtar.Split('|');

                var asamaAdi = parca.Length > 1 && int.TryParse(parca[1], out var id)
                               && idler.TryGetValue(id, out var a) ? Ad(a) : "";

                var metin = parca[0] switch
                {
                    "orybasla" => $"Yöneticisine aşama başladı bildirimi gitti · {asamaAdi} · uygulama bildirimi",
                    "oryazal" => $"Yöneticisine 24 saat kala hatırlatma gitti · {asamaAdi} · uygulama bildirimi",
                    "orytamam" => $"Yöneticisine anketin tamamlandığı bildirildi · {asamaAdi}",
                    "oryhatirlat" => "Yöneticisi uygulamadan hatırlattı · uygulama bildirimi",
                    "ikhatirlat" => $"İK bildirimle hatırlattı · {Ad(parca.ElementAtOrDefault(2))}",
                    "ikyhatirlat" => $"İK yöneticisine bildirimle hatırlattı · {Ad(parca.ElementAtOrDefault(2))}",
                    _ => null
                };

                if (metin is not null)
                    olaylar.Add((zaman, parca[0].StartsWith("ik") ? "ik" : "bildirim", metin));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bildirim geçmişi okunamadı: {Kod}", kod);
        }

        /* İK görüşme notları */
        try
        {
            foreach (var n in db.Query(@"
SELECT donem, durum, not_metni AS notMetni, kullanici, tarih
FROM KRY_PERSONEL_TAKIP WHERE personel_kodu = @kod", new { kod }))
            {
                var not = ((string)n.notMetni ?? "").Trim();

                olaylar.Add(((DateTime)n.tarih, "ik",
                    $"İK görüşme notu · {(string)n.donem}: {(string)n.durum}"
                    + (not.Length > 0 ? $" — {not}" : "")
                    + (string.IsNullOrWhiteSpace((string)n.kullanici) ? "" : $" ({(string)n.kullanici})")));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Görüşme notları okunamadı: {Kod}", kod);
        }

        return olaylar
            .OrderBy(x => x.zaman)
            .Select(x => (object)new { zaman = x.zaman, tur = x.tur, metin = x.metin })
            .ToList();
    }

    /// <summary>
    /// Bir birimdeki doldurulmuş formlar; yönetici formları dahil.
    ///
    /// Yönetici karşılaştırması satırından açılır: karşılaştırmayı gören
    /// kişi yöneticinin ne yanıtladığını da görebilmeli.
    /// </summary>
    [HttpGet("BirimFormlari")]
    [Authorize]
    public IActionResult BirimFormlari([FromQuery] string sube)
    {
        using var db = _vt.Baglanti();

        var formlar = db.Query(@"
SELECT id, asama, tur, puan, dolduruldu, ad_soyad AS adSoyad, gorev,
       personel_kodu AS personelKodu, cevaplar_json AS cevaplarJson, olusturma
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND sube_adi = @sube AND dolduruldu IS NOT NULL
ORDER BY tur DESC, olusturma DESC", new { sube = (sube ?? "").Trim() });

        return Ok(new { sube, formlar });
    }

    /* ==================================================================== */
    /* Panel: gönderim geçmişi                                              */
    /* ==================================================================== */

    /// <summary>Son gönderimler; test kayıtları ayrı işaretlidir.</summary>
    [HttpGet("Gonderimler")]
    [Authorize]
    public IActionResult Gonderimler([FromQuery] bool testDahil = true)
    {
        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT TOP 100 kod, tur, asama, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       telefon, gecerlilik, dolduruldu, puan, test_mi AS testMi,
       gonderen, olusturma,
       CASE WHEN dolduruldu IS NOT NULL THEN 'dolduruldu'
            WHEN gecerlilik < SYSDATETIME() THEN 'suresiDoldu'
            ELSE 'bekliyor' END AS durum
FROM KRY_UYUM_ANKET
WHERE (@testDahil = 1 OR test_mi = 0)
ORDER BY olusturma DESC", new { testDahil }));
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    private string BaglantiAdresi(string kod) => _gonderim.BaglantiAdresi(kod);

    private static string BenzersizKod(System.Data.IDbConnection db) =>
        UyumGonderimServisi.BenzersizKod(db);

}

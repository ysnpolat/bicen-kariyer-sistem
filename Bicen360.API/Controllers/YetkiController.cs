using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Yetki yönetimi.
///
/// Bu uçlara yalnızca "yetki" sayfası açık olan kullanıcı erişir; yetki
/// vermeye yetkili olmak da bir yetki.
///
/// Departman ve kategori tanımları burada değil, Yönetim sayfasında:
/// ayrı işler, ayrı yetki.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class YetkiController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly KapsamServisi _grupKapsam;
    private readonly ILogger<YetkiController> _kayit;

    public YetkiController(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        PersonelServisi personel,
        KapsamServisi grupKapsam,
        ILogger<YetkiController> kayit)
    {
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _grupKapsam = grupKapsam;
        _kayit = kayit;
    }

    private string Ad => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    /* Yetki ekranı Yönetim sayfasının içinde; erişimi de o sayfanın
       yetkisiyle veriliyor. Ayrı bir kod tutmak, kullanıcıya iki yetki
       birden vermeyi gerektiriyordu. */
    private bool Yetkili() => _yetki.SayfaAcik(Ad, Rol, "yonetim");

    /* ==================================================================== */
    /* Katalog ve mevcut tanımlar                                           */
    /* ==================================================================== */

    /// <summary>
    /// Yetki ekranının ihtiyaç duyduğu her şey: sayfa ve modül listesi,
    /// kullanıcılar, roller, pozisyonlar.
    /// </summary>
    [HttpGet("Katalog")]
    public IActionResult KatalogGetir()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kullanicilar = db.Query(@"
SELECT kullanici_adi AS kullaniciAdi, ad_soyad AS adSoyad, rol
FROM KRY_KULLANICILAR
WHERE aktif = 1
ORDER BY ad_soyad").ToList();

        /* Roller kullanıcı tablosundan toplanır: elle liste tutmak, Kariyer
           tarafında yeni rol eklendiğinde burayı geride bırakıyor. */
        var roller = db.Query<string>(@"
SELECT DISTINCT rol FROM KRY_KULLANICILAR WHERE rol IS NOT NULL ORDER BY rol")
            .ToList();

        var pozisyonlar = Pozisyonlar();

        /* Pozisyon grupları: ünvan ünvan yetki vermek, yeni ünvan
           tanımlandığında yetkinin unutulmasına yol açıyordu. */
        var gruplar = new List<string>();

        try
        {
            gruplar = db.Query<string>(@"
SELECT ad FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad").ToList();
        }
        catch
        {
            /* Tablo yoksa grup sekmesi boş kalır, diğerleri çalışır */
        }

        return Ok(new
        {
            sayfalar = Katalog.Sayfalar.Select(x => new
            {
                kod = x.Kod, ad = x.Ad, aciklama = x.Aciklama, simge = x.Simge,
                kaynak = "portal",
            }),

            /* Kaynak bilgisi ekranda satırın nasıl görüneceğini belirliyor:
               İK kodları kilitli gösteriliyor. Eskiden işaretlenebiliyor ama
               hiçbir etkisi olmuyordu; kapatan kişi sebebini aramakla
               vakit kaybediyordu. */
            moduller = Katalog.MobilModuller.Select(x => new
            {
                kod = x.Kod, ad = x.Ad, aciklama = x.Aciklama, simge = x.Simge,
                kaynak = x.Kaynak switch
                {
                    Kaynak.Kariyer => "kariyer",
                    Kaynak.Yetki => "yetki",
                    _ => "portal",
                },
                /* Tanımsızken açık mı (yeni modüller kapalı) */
                varsayilan = x.VarsayilanAcik,
            }),

            kullanicilar,
            roller,
            pozisyonlar
        });
    }

    /* ====================================================================== */
    /* Grup ayarları                                                          */
    /* ====================================================================== */

    /// <summary>
    /// Grubun sorumluluk, kapsam ve onay ayarları ve seçim listeleri.
    ///
    /// Ekran gruba tıklanınca açılıyor. Seçenekler de burada: diğer
    /// gruplar (sorumluluk için), departmanlar (departman kapsamı için).
    /// </summary>
    [HttpGet("GrupAyar/{id:int}")]
    public IActionResult GrupAyar(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var grup = db.QueryFirstOrDefault(
            "SELECT id, ad, pozisyonlar FROM KRY_POZISYON_GRUBU WHERE id = @id", new { id });

        if (grup is null) return NotFound(new { hata = "Grup bulunamadı." });

        var gruplar = db.Query(@"
SELECT id, ad FROM KRY_POZISYON_GRUBU
WHERE aktif = 1 AND id <> @id ORDER BY sira, ad", new { id }).ToList();

        var departmanlar = db.Query(@"
SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList();

        return Ok(new
        {
            grup = new { id = (int)grup.id, ad = (string)grup.ad, pozisyonlar = (string)grup.pozisyonlar },

            /* Tanımsızsa boş ayar dönüyor ve ekranda "eski kural" seçili
               görünüyor: ayar ekranına girmek tek başına davranışı
               değiştirmemeli. */
            ayar = _grupKapsam.Oku(id) ?? new GrupAyari(),
            tanimli = _grupKapsam.Oku(id) is not null,

            secenekler = new { gruplar, departmanlar, bolgeler = _grupKapsam.BolgeAdlari() },
        });
    }

    [HttpPost("GrupAyar/{id:int}")]
    public IActionResult GrupAyarYaz(int id, [FromBody] GrupAyari girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null) return BadRequest(new { hata = "Ayar boş." });

        string[] gecerliKapsam = { "kendi", "sube", "bolge", "departman", "tum" };
        string[] gecerliKademe = { "magaza", "bolge" };

        string Temiz(string d, string[] gecerli) =>
            gecerli.Contains(d ?? "", StringComparer.OrdinalIgnoreCase) ? d.ToLowerInvariant() : null;

        var ayar = new GrupAyari
        {
            /* Grup kendinden sorumlu olamaz: onay akışında kişi kendi
               talebini onaylayabilirdi. */
            SorumluGruplar = (girdi.SorumluGruplar ?? new()).Where(x => x > 0 && x != id).Distinct().ToList(),
            ArizaKapsami = Temiz(girdi.ArizaKapsami, gecerliKapsam),
            EnvanterKapsami = Temiz(girdi.EnvanterKapsami, gecerliKapsam),
            Departmanlar = (girdi.Departmanlar ?? new()).Where(x => x > 0).Distinct().ToList(),
            HaftalikIzinOnay = girdi.HaftalikIzinOnay,
            YillikIzinKademe = Temiz(girdi.YillikIzinKademe, gecerliKademe),
        };

        /* Departman kapsamı seçilip departman seçilmemişse kayıt
           reddediliyor: sessizce hiçbir şey göstermeyen bir ayar olurdu. */
        if ((ayar.ArizaKapsami == "departman" || ayar.EnvanterKapsami == "departman")
            && ayar.Departmanlar.Count == 0)
            return BadRequest(new { hata = "Departman kapsamı için en az bir departman seçiniz." });

        /* Onay yetkisi olup sorumlu grup seçilmemişse de reddediliyor:
           kimin talebini onaylayacağı belirsiz kalırdı. */
        if ((ayar.HaftalikIzinOnay || ayar.YillikIzinKademe is not null)
            && ayar.SorumluGruplar.Count == 0)
            return BadRequest(new { hata = "İzin onayı için sorumlu olduğu grupları seçiniz." });

        _grupKapsam.Yaz(id, ayar, Ad);

        _kayit.LogInformation("Grup ayarı güncellendi: {Grup} — {Yapan}", id, Ad);

        return Ok(new { basarili = true, ayar });
    }

    /// <summary>Kişinin sorumlu olduğu bölgeler; bölge kapsamı bunlarla çalışıyor.</summary>
    [HttpGet("KisiBolge")]
    public IActionResult KisiBolge([FromQuery] string sicil)
    {
        if (!Yetkili()) return Forbid();

        return Ok(new
        {
            secili = _grupKapsam.KisiBolgeleri(sicil),
            bolgeler = _grupKapsam.BolgeAdlari(),
        });
    }

    [HttpPost("KisiBolge")]
    public IActionResult KisiBolgeYaz([FromBody] KisiBolgeGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        var sicil = (girdi?.Sicil ?? "").Trim();

        if (sicil.Length == 0) return BadRequest(new { hata = "Sicil numarası gerekli." });

        _grupKapsam.KisiBolgeleriYaz(sicil, girdi.Bolgeler);

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */
    /* Kişiye özel mobil yetki                                                */
    /* ====================================================================== */

    /// <summary>
    /// Personel arama: sicil numarası ya da ad soyad.
    ///
    /// Kişiye özel yetki vermek için sicil ezberlemek gerekiyordu; ad
    /// soyadın bir parçasını yazmak yetiyor. Eşleşme Türkçe harf ve
    /// büyük-küçük harf farkını gözetmiyor.
    /// </summary>
    [HttpGet("PersonelAra")]
    public IActionResult PersonelAra([FromQuery] string q)
    {
        if (!Yetkili()) return Forbid();

        var aranan = YetkiServisi.Anahtar(q);

        if (aranan.Length < 2) return Ok(new { kayitlar = Array.Empty<object>() });

        var kayitlar = _personel.Liste()
            .Where(x => YetkiServisi.Anahtar(x.Sicil).Contains(aranan)
                     || YetkiServisi.Anahtar(x.AdSoyad).Contains(aranan))
            .OrderBy(x => YetkiServisi.Anahtar(x.Sicil) == aranan ? 0 : 1)
            .ThenBy(x => x.AdSoyad)
            .Take(20)
            .Select(x => new
            {
                sicil = x.Sicil,
                adSoyad = x.AdSoyad,
                pozisyon = x.Pozisyon,
                sube = x.Sube,
            })
            .ToList();

        return Ok(new { kayitlar });
    }

    /// <summary>
    /// Bir personelin mobil yetkileri: grubundan gelen, kişiye özel olan
    /// ve ikisinin sonucu.
    ///
    /// Ekran bunu tek tabloda gösteriyor: gruptan gelen değer soluk,
    /// kişiye özel istisna vurgulu. "Bu kişi neden bu modülü görmüyor"
    /// sorusu buradan cevaplanıyor.
    /// </summary>
    [HttpGet("Kisi")]
    public IActionResult Kisi([FromQuery] string sicil)
    {
        if (!Yetkili()) return Forbid();

        if (string.IsNullOrWhiteSpace(sicil))
            return BadRequest(new { hata = "Sicil numarası gerekli." });

        var kisi = _personel.Getir(sicil.Trim());

        if (kisi is null)
            return NotFound(new { hata = $"\"{sicil}\" sicil numarasıyla personel bulunamadı." });

        var grup = _yetki.GrupAdi(kisi.Pozisyon ?? "");
        var cozum = _yetki.KisiDetaylari(sicil.Trim(), kisi.Pozisyon ?? "");

        return Ok(new
        {
            personel = new
            {
                sicil = sicil.Trim(),
                adSoyad = kisi.AdSoyad,
                pozisyon = kisi.Pozisyon,
                sube = kisi.Sube,
                grup,
            },

            /* Grup yoksa sebebi de veriliyor: kişiye özel satır dışında
               hiçbir yetki uygulanmıyor ve her modül varsayılana düşüyor. */
            grupUyarisi = grup is null
                ? (YetkiServisi.SonGrupHatasi is { Length: > 0 }
                    ? $"Pozisyon grupları okunamadı: {YetkiServisi.SonGrupHatasi}"
                    : $"\"{kisi.Pozisyon}\" ünvanı hiçbir gruba bağlı değil. "
                      + "Bu kişiye yalnızca kişiye özel yetkiler ve varsayılanlar uygulanır.")
                : null,

            moduller = Katalog.MobilModuller.Select(m =>
            {
                var c = cozum[m.Kod];

                return new
                {
                    kod = m.Kod,
                    ad = m.Ad,
                    aciklama = m.Aciklama,
                    kaynak = m.Kaynak switch
                    {
                        Kaynak.Kariyer => "kariyer",
                        Kaynak.Yetki => "yetki",
                        _ => "portal",
                    },
                    grup = c.Grup,
                    kisi = c.Kisi,
                    varsayilan = c.Varsayilan,
                    sonuc = c.Sonuc,
                };
            }),
        });
    }

    /// <summary>
    /// Kişiye özel mobil yetkileri kaydeder.
    ///
    /// <para>
    /// Gruptan gelenle aynı olan değer yazılmıyor: kişi zaten o yetkiyi
    /// grubundan alıyorsa ayrıca "açık" satırı eklemek, ileride grup
    /// değiştiğinde kişinin sessizce geride kalmasına yol açıyordu. Kişiye
    /// özel satır yalnızca gruptan farklı olduğunda anlamlı.
    /// </para>
    /// </summary>
    [HttpPost("Kisi")]
    public IActionResult KisiYaz([FromBody] KisiYetkiGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        var sicil = (girdi?.Sicil ?? "").Trim();

        if (sicil.Length == 0)
            return BadRequest(new { hata = "Sicil numarası gerekli." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return NotFound(new { hata = "Personel bulunamadı." });

        /* Gruptan gelen değerler, kişiye özel satırlar hesaba katılmadan. */
        var temel = _yetki.KisiDetaylari(null, kisi.Pozisyon ?? "");

        var yazilacak = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        foreach (var (kod, deger) in girdi.Yetkiler ?? new Dictionary<string, bool?>())
        {
            if (deger is null || !temel.TryGetValue(kod, out var t)) continue;

            var gruptan = t.Grup ?? t.Varsayilan;

            if (deger.Value != gruptan) yazilacak[kod] = deger.Value;
        }

        _yetki.Yaz(Alan.Mobil, Kapsam.Kullanici, sicil, yazilacak, Ad);

        _kayit.LogInformation(
            "Kişiye özel mobil yetki: {Sicil} — {Adet} istisna", sicil, yazilacak.Count);

        return Ok(new { basarili = true, istisna = yazilacak.Count });
    }

    /* ====================================================================== */
    /* Alt menü                                                               */
    /* ====================================================================== */

    /// <summary>
    /// Mobil uygulamanın altındaki sekmeler.
    ///
    /// <para>
    /// Ayar İK panelindeydi, modül yetkileriyle birlikte buraya taşındı:
    /// hangi modülün kime açık olduğu burada belirleniyorken sekmeyi başka
    /// panelden seçmek, açık olmayan bir modülü sekmeye almaya açıktı.
    /// </para>
    ///
    /// <para>
    /// Ana sayfa ve Diğer sabit; buradaki seçim aradaki sekmeler. En fazla
    /// dört tane: beşinci sekme dar ekranda yazıyı kırpıyor.
    /// </para>
    /// </summary>
    [HttpGet("AltMenu")]
    public IActionResult AltMenu()
    {
        if (!Yetkili()) return Forbid();

        return Ok(new
        {
            secili = AltMenuOku(),
            enFazla = Katalog.AltMenuEnFazla,

            adaylar = Katalog.Ekranlar.Select(x => new
            {
                kod = x.Kod, ad = x.Ad, aciklama = x.Aciklama, simge = x.Simge
            }),
        });
    }

    [HttpPost("AltMenu")]
    public IActionResult AltMenuYaz([FromBody] AltMenuGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        /* Katalogda olmayan kod yazılmıyor: yazım hatası ya da kaldırılmış
           bir modül ayarda ölü satır olarak kalmasın. */
        var secili = (girdi?.AltMenu ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0 && Katalog.Ekranlar.Any(m =>
                string.Equals(m.Kod, x, StringComparison.OrdinalIgnoreCase)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(Katalog.AltMenuEnFazla)
            .ToList();

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE B360_AYAR AS h
USING (SELECT N'mobilAltMenu' AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @deger, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger) VALUES (N'mobilAltMenu', @deger);",
            new { deger = System.Text.Json.JsonSerializer.Serialize(secili) });

        _kayit.LogInformation("Alt menü güncellendi: {Secili}", string.Join(", ", secili));

        return Ok(new { basarili = true, secili });
    }

    /* ==================================================================== */
    /* Ana sayfa kartları                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Mobil ana sayfadaki kartların görünürlüğü.
    ///
    /// Biçen Kartım şeridi ve Bu Ay Mesai kutusu şimdilik kullanılmıyor;
    /// modüller ileride sırayla açılacak. Yetki matrisinden ayrı, tek
    /// anahtarla herkes için kapatılıp açılıyor.
    /// </summary>
    [HttpGet("AnaSayfaKartlari")]
    public IActionResult AnaSayfaKartlari()
    {
        if (!Yetkili()) return Forbid();

        return Ok(new
        {
            kartlar = AnaSayfaKartlariOku(_vt),
            secenekler = ANA_SAYFA_KARTLARI.Select(k => new { kod = k.Kod, ad = k.Ad, aciklama = k.Aciklama }),
        });
    }

    public class AnaSayfaKartGirdi
    {
        public Dictionary<string, bool> Kartlar { get; set; } = new();
    }

    [HttpPost("AnaSayfaKartlari")]
    public IActionResult AnaSayfaKartlariYaz([FromBody] AnaSayfaKartGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        var mevcut = AnaSayfaKartlariOku(_vt);

        foreach (var (kod, acik) in girdi?.Kartlar ?? new())
            if (ANA_SAYFA_KARTLARI.Any(k => k.Kod == kod)) mevcut[kod] = acik;

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE B360_AYAR AS h
USING (SELECT N'mobilAnaSayfaKartlari' AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @deger, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger) VALUES (N'mobilAnaSayfaKartlari', @deger);",
            new { deger = System.Text.Json.JsonSerializer.Serialize(mevcut) });

        _kayit.LogInformation("Ana sayfa kartları güncellendi: {Kartlar}",
            string.Join(", ", mevcut.Select(x => $"{x.Key}={x.Value}")));

        return Ok(new { basarili = true, kartlar = mevcut });
    }

    /// <summary>Ana sayfada gizlenebilen kartlar. Varsayılan: kapalı.</summary>
    public static readonly (string Kod, string Ad, string Aciklama)[] ANA_SAYFA_KARTLARI =
    {
        ("bicenkart", "Biçen Kartım şeridi", "Ana sayfadaki kart bakiyesi ve Öde şeridi (Biçen Kartım ekranıyla birlikte)"),
        ("mesai",     "Bu Ay Mesai kutusu",  "Ana sayfadaki aylık mesai saati özeti"),
        ("prim",      "Son Prim kutusu",     "Ana sayfadaki son prim tutarı (Prim ekranı modül yetkisiyle ayrıca açılır)"),
    };

    /// <summary>Kayıtlı kart ayarı; tanımlı değilse hepsi kapalı.</summary>
    public static Dictionary<string, bool> AnaSayfaKartlariOku(VeritabaniServisi vt)
    {
        var sonuc = ANA_SAYFA_KARTLARI.ToDictionary(k => k.Kod, _ => false);

        try
        {
            using var db = vt.Baglanti();

            var ham = db.ExecuteScalar<string>(
                "SELECT deger FROM B360_AYAR WHERE anahtar = 'mobilAnaSayfaKartlari'");

            if (string.IsNullOrWhiteSpace(ham)) return sonuc;

            var okunan = System.Text.Json.JsonSerializer
                .Deserialize<Dictionary<string, bool>>(ham) ?? new();

            foreach (var (kod, acik) in okunan)
                if (sonuc.ContainsKey(kod)) sonuc[kod] = acik;
        }
        catch
        {
            /* Ayar okunamazsa kartlar kapalı kalır: şimdilik kullanılmıyorlar */
        }

        return sonuc;
    }

    /// <summary>Kayıtlı alt menü; tanımlı değilse varsayılan.</summary>
    private List<string> AltMenuOku()
    {
        try
        {
            using var db = _vt.Baglanti();

            var ham = db.ExecuteScalar<string>(
                "SELECT deger FROM B360_AYAR WHERE anahtar = 'mobilAltMenu'");

            if (string.IsNullOrWhiteSpace(ham))
                return Katalog.AltMenuVarsayilan.ToList();

            var liste = System.Text.Json.JsonSerializer
                .Deserialize<List<string>>(ham) ?? new();

            return liste.Count > 0 ? liste : Katalog.AltMenuVarsayilan.ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Alt menü okunamadı");

            return Katalog.AltMenuVarsayilan.ToList();
        }
    }

    /// <summary>Bir anahtarın tanımlı yetkileri.</summary>
    [HttpGet]
    public IActionResult Getir(
        [FromQuery] string alan,
        [FromQuery] string kapsam,
        [FromQuery] string anahtar)
    {
        if (!Yetkili()) return Forbid();

        if (!Gecerli(alan, kapsam))
            return BadRequest(new { hata = "Geçersiz alan ya da kapsam." });

        return Ok(new { yetkiler = _yetki.Oku(alan, kapsam, anahtar ?? "") });
    }

    /// <summary>Bir anahtarın yetkilerini kaydeder.</summary>
    [HttpPost]
    public IActionResult Kaydet([FromBody] YetkiGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || !Gecerli(girdi.Alan, girdi.Kapsam))
            return BadRequest(new { hata = "Geçersiz alan ya da kapsam." });

        if (string.IsNullOrWhiteSpace(girdi.Anahtar))
            return BadRequest(new { hata = "Kullanıcı, rol ya da pozisyon seçiniz." });

        /* Kendi yetki sayfasını kapatan kullanıcı bir daha açamaz. Bunu
           engellemek, veritabanından elle düzeltmekten iyi. */
        if (girdi.Alan == Alan.Panel &&
            girdi.Kapsam == Kapsam.Kullanici &&
            string.Equals(girdi.Anahtar, Ad, StringComparison.OrdinalIgnoreCase) &&
            girdi.Yetkiler.TryGetValue("yonetim", out var kendi) && !kendi)
        {
            return BadRequest(new
            {
                hata = "Kendi Yönetim sayfası erişiminizi kapatamazsınız."
            });
        }

        _yetki.Yaz(girdi.Alan, girdi.Kapsam, girdi.Anahtar.Trim(), girdi.Yetkiler, Ad);

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Bir alan ve kapsamın bütün tanımları, tek istekte.
    ///
    /// <para>
    /// Yetki ekranı eskiden tek tek seçim yaptırıyordu: bir rolü seç, tabloyu
    /// doldur, kaydet, sonrakine geç. "Hangi görevde hangi modül açık"
    /// sorusunun cevabı hiçbir ekranda bir arada görünmüyordu ve tanım işi
    /// pozisyon sayısı kadar tur atmayı gerektiriyordu. Matris bunun için:
    /// satırlar anahtarlar, sütunlar kodlar.
    /// </para>
    /// </summary>
    [HttpGet("Matris")]
    public IActionResult Matris([FromQuery] string alan, [FromQuery] string kapsam)
    {
        if (!Yetkili()) return Forbid();

        if (!Gecerli(alan, kapsam))
            return BadRequest(new { hata = "Geçersiz alan ya da kapsam." });

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT anahtar, kod, izin FROM B360_YETKI
WHERE alan = @alan AND kapsam = @kapsam", new { alan, kapsam }).ToList();

        return Ok(new { satirlar });
    }

    /// <summary>
    /// Birden çok anahtarın yetkilerini tek seferde kaydeder.
    ///
    /// Matris ekranında bir oturumda onlarca hücre değişiyor; her satır için
    /// ayrı istek, yarısı kaydedilmiş bir ekran bırakma riski taşıyordu.
    /// Yalnızca değişen anahtarlar gönderiliyor.
    /// </summary>
    [HttpPost("Toplu")]
    public IActionResult Toplu([FromBody] TopluYetkiGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || !Gecerli(girdi.Alan, girdi.Kapsam))
            return BadRequest(new { hata = "Geçersiz alan ya da kapsam." });

        var satirlar = (girdi.Satirlar ?? new List<YetkiGirdi>())
            .Where(x => !string.IsNullOrWhiteSpace(x?.Anahtar))
            .ToList();

        if (satirlar.Count == 0)
            return Ok(new { basarili = true, kaydedilen = 0 });

        /* Kendi yetki sayfasını kapatan kullanıcı bir daha açamaz; tek tek
           kaydetmedeki denetimin aynısı burada da gerekiyor. */
        foreach (var satir in satirlar)
        {
            if (girdi.Alan == Alan.Panel &&
                girdi.Kapsam == Kapsam.Kullanici &&
                string.Equals(satir.Anahtar, Ad, StringComparison.OrdinalIgnoreCase) &&
                satir.Yetkiler.TryGetValue("yonetim", out var kendi) && !kendi)
            {
                return BadRequest(new
                {
                    hata = "Kendi Yönetim sayfası erişiminizi kapatamazsınız."
                });
            }
        }

        foreach (var satir in satirlar)
            _yetki.Yaz(girdi.Alan, girdi.Kapsam, satir.Anahtar.Trim(),
                       satir.Yetkiler, Ad);

        return Ok(new { basarili = true, kaydedilen = satirlar.Count });
    }

    /* ==================================================================== */
    /* Pozisyon grupları                                                    */
    /* ==================================================================== */

    /// <summary>
    /// Pozisyon grupları ve seçilebilecek ünvanlar.
    ///
    /// <para>
    /// Gruplar <c>KRY_POZISYON_GRUBU</c> tablosunda; İK paneli ve portal
    /// aynı veritabanını kullandığı için iki taraf da aynı listeyi görüyor.
    /// Tanımı tek yerde tutmak, aynı grubun iki farklı yerde farklı
    /// ünvanlarla oluşmasını engelliyor.
    /// </para>
    /// </summary>
    /* ==================================================================== */
    /* Bölgeler                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Bölgeler, şubeleri ve müdürleri; seçim için personel kartlarındaki
    /// şube adları ve her şubedeki kişi sayısı.
    /// </summary>
    [HttpGet("Bolgeler")]
    public IActionResult Bolgeler()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var bolgeler = db.Query("SELECT id, ad FROM B360_BOLGE WHERE aktif = 1 ORDER BY ad").ToList();
        var subeler = db.Query("SELECT bolge_id AS bolgeId, sube FROM B360_BOLGE_SUBE").ToList();
        var mudurler = db.Query("SELECT bolge_id AS bolgeId, sicil FROM B360_BOLGE_MUDUR").ToList();

        var personel = _personel.Liste();

        var kisiler = personel
            .GroupBy(x => x.Sicil, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var subeSecenekleri = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.Sube) && x.Sube != "Belirtilmemiş")
            .GroupBy(x => x.Sube.Trim())
            .Select(g => new { sube = g.Key, kisi = g.Count() })
            .OrderBy(x => x.sube)
            .ToList();

        return Ok(new
        {
            bolgeler = bolgeler.Select(b => new
            {
                id = (int)b.id,
                ad = (string)b.ad,
                subeler = subeler.Where(x => (int)x.bolgeId == (int)b.id)
                    .Select(x => (string)x.sube).OrderBy(x => x).ToList(),
                mudurler = mudurler.Where(x => (int)x.bolgeId == (int)b.id)
                    .Select(x =>
                    {
                        var sicil = ((string)x.sicil ?? "").Trim();
                        kisiler.TryGetValue(sicil, out var k);

                        return new
                        {
                            sicil,
                            adSoyad = k?.AdSoyad ?? sicil,
                            pozisyon = k?.Pozisyon,
                            aktif = k is not null,
                        };
                    }).ToList(),
            }),
            subeSecenekleri,
        });
    }

    public class BolgeGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public List<string> Subeler { get; set; } = new();
        public List<string> Mudurler { get; set; } = new();
    }

    [HttpPost("Bolge")]
    public IActionResult BolgeKaydet([FromBody] BolgeGirdi g)
    {
        if (!Yetkili()) return Forbid();

        var ad = (g?.Ad ?? "").Trim();

        if (ad.Length == 0) return BadRequest(new { hata = "Bölge adı giriniz." });

        var subeler = (g.Subeler ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var mudurler = (g.Mudurler ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        using var db = _vt.Baglanti();
        db.Open();

        /* Bir şube yalnızca bir bölgede: iki bölgede olursa iki bölge
           müdürü de aynı mağazayı sorumluluğunda sanırdı. */
        var cakisan = db.Query(@"
SELECT S.sube, B.ad FROM B360_BOLGE_SUBE S
    INNER JOIN B360_BOLGE B ON B.id = S.bolge_id AND B.aktif = 1
WHERE S.bolge_id <> @id AND S.sube IN @subeler", new { id = g.Id, subeler })
            .Select(x => $"{(string)x.sube} ({(string)x.ad})")
            .ToList();

        if (subeler.Count > 0 && cakisan.Count > 0)
            return BadRequest(new { hata = "Bu şubeler başka bölgede: " + string.Join(", ", cakisan) });

        using var islem = db.BeginTransaction();

        var id = g.Id;

        if (id > 0)
            db.Execute(@"
UPDATE B360_BOLGE SET ad = @ad, guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id", new { id, ad, yapan = Ad }, islem);
        else
            id = db.ExecuteScalar<int>(@"
INSERT INTO B360_BOLGE (ad, guncelleyen) OUTPUT INSERTED.id VALUES (@ad, @yapan)",
                new { ad, yapan = Ad }, islem);

        db.Execute("DELETE FROM B360_BOLGE_SUBE WHERE bolge_id = @id", new { id }, islem);
        db.Execute("DELETE FROM B360_BOLGE_MUDUR WHERE bolge_id = @id", new { id }, islem);

        foreach (var sube in subeler)
            db.Execute("INSERT INTO B360_BOLGE_SUBE (bolge_id, sube) VALUES (@id, @sube)", new { id, sube }, islem);

        foreach (var sicil in mudurler)
            db.Execute("INSERT INTO B360_BOLGE_MUDUR (bolge_id, sicil) VALUES (@id, @sicil)", new { id, sicil }, islem);

        islem.Commit();

        return Ok(new { basarili = true, id });
    }

    [HttpDelete("Bolge/{id:int}")]
    public IActionResult BolgeSil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        db.Execute("UPDATE B360_BOLGE SET aktif = 0 WHERE id = @id", new { id });
        db.Execute("DELETE FROM B360_BOLGE_SUBE WHERE bolge_id = @id", new { id });
        db.Execute("DELETE FROM B360_BOLGE_MUDUR WHERE bolge_id = @id", new { id });

        return Ok(new { basarili = true });
    }

    [HttpGet("Gruplar")]
    public IActionResult Gruplar()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        List<dynamic> gruplar;

        try
        {
            gruplar = db.Query(@"
SELECT id, ad, aciklama, pozisyonlar, aktif, sira
FROM KRY_POZISYON_GRUBU ORDER BY sira, ad").ToList();
        }
        catch
        {
            /* Tablo henüz kurulmamış olabilir: Kariyer API ilk açılışta
               oluşturuyor. Boş liste dönmek, ekranın hata vermesinden iyi. */
            gruplar = new List<dynamic>();
        }

        return Ok(new { gruplar, pozisyonlar = Pozisyonlar() });
    }

    /// <summary>Grup ekler ya da günceller.</summary>
    /// <summary>
    /// Bir grubun yetkilerini başka gruplara kopyalar.
    ///
    /// <para>
    /// Modül yetkileri (hangi modülü görür, görmez) ve istenirse grup
    /// ayarları (sorumluluk, veri kapsamı, onay). Hedef grubun o alandaki
    /// tanımları kaynağınkiyle değiştiriliyor; ünvanları değişmiyor.
    /// Benzer grupları tek tek tıklayarak kurmak uzun ve hataya açıktı.
    /// </para>
    /// </summary>
    [HttpPost("GrupKopyala")]
    public IActionResult GrupKopyala([FromBody] GrupKopyalaGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || girdi.KaynakId <= 0 || girdi.HedefIdler is null || girdi.HedefIdler.Count == 0)
            return BadRequest(new { hata = "Kaynak ve hedef grup seçiniz." });

        if (!girdi.Moduller && !girdi.Ayarlar)
            return BadRequest(new { hata = "Neyin kopyalanacağını seçiniz." });

        using var db = _vt.Baglanti();

        var gruplar = db.Query<(int id, string ad)>(
                "SELECT id, ad FROM KRY_POZISYON_GRUBU WHERE aktif = 1")
            .ToDictionary(x => x.id, x => (x.ad ?? "").Trim());

        if (!gruplar.TryGetValue(girdi.KaynakId, out var kaynakAd))
            return NotFound(new { hata = "Kaynak grup bulunamadı." });

        var hedefler = girdi.HedefIdler.Distinct()
            .Where(x => x != girdi.KaynakId && gruplar.ContainsKey(x))
            .ToList();

        if (hedefler.Count == 0)
            return BadRequest(new { hata = "Geçerli hedef grup yok." });

        var satirlar = db.Query<(string kod, bool izin)>(@"
SELECT kod, izin FROM B360_YETKI
WHERE alan = 'mobil' AND kapsam = 'grup' AND anahtar = @kaynakAd",
            new { kaynakAd }).ToList();

        var ayar = girdi.Ayarlar
            ? db.ExecuteScalar<string>("SELECT ayar FROM B360_GRUP_AYAR WHERE grup_id = @id",
                new { id = girdi.KaynakId })
            : null;

        db.Open();

        using var islem = db.BeginTransaction();

        foreach (var h in hedefler)
        {
            var hedefAd = gruplar[h];

            if (girdi.Moduller)
            {
                db.Execute(@"
DELETE FROM B360_YETKI WHERE alan = 'mobil' AND kapsam = 'grup' AND anahtar = @hedefAd",
                    new { hedefAd }, islem);

                foreach (var (kod, izin) in satirlar)
                    db.Execute(@"
INSERT INTO B360_YETKI (alan, kapsam, anahtar, kod, izin, guncelleyen)
VALUES ('mobil', 'grup', @hedefAd, @kod, @izin, @yapan)",
                        new { hedefAd, kod, izin, yapan = Ad }, islem);
            }

            if (girdi.Ayarlar)
            {
                db.Execute("DELETE FROM B360_GRUP_AYAR WHERE grup_id = @h", new { h }, islem);

                if (!string.IsNullOrWhiteSpace(ayar))
                    db.Execute(@"
INSERT INTO B360_GRUP_AYAR (grup_id, ayar, guncelleyen) VALUES (@h, @ayar, @yapan)",
                        new { h, ayar, yapan = Ad }, islem);
            }
        }

        islem.Commit();

        return Ok(new { basarili = true, adet = hedefler.Count, modul = satirlar.Count });
    }

    [HttpPost("Grup")]
    public IActionResult GrupKaydet([FromBody] PozisyonGrubuGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Ad))
            return BadRequest(new { hata = "Grup adını giriniz." });

        using var db = _vt.Baglanti();

        var secilenler = (girdi.Pozisyonlar ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var pozisyonlar = string.Join(",", secilenler);

        /* Bir ünvan yalnızca bir grupta olabilir.

           İki grupta birden olursa yetki sırası ilk bulunan gruba göre
           belirleniyor ve hangisinin geçtiği ekrandan anlaşılmıyordu.
           Çakışma kaydetmeden önce söyleniyor; hangi grupta olduğu da
           yazılıyor ki oradan çıkarılabilsin. */
        var digerleri = db.Query(@"
SELECT id, ad, pozisyonlar FROM KRY_POZISYON_GRUBU
WHERE aktif = 1 AND id <> @id", new { id = girdi.Id }).ToList();

        var cakisanlar = new List<string>();

        foreach (var g in digerleri)
        {
            var onlarinki = ((string)g.pozisyonlar ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(YetkiServisi.Anahtar)
                .ToHashSet();

            foreach (var p in secilenler.Where(p => onlarinki.Contains(YetkiServisi.Anahtar(p))))
                cakisanlar.Add($"{p} → {(string)g.ad}");
        }

        /* Taşıma: ünvan önceki grubundan çıkarılıyor. Eskiden önce diğer
           gruba gidip çıkarmak, sonra buraya dönüp eklemek gerekiyordu. */
        if (girdi.Aktif && cakisanlar.Count > 0 && girdi.Tasi)
        {
            var secilenAnahtar = secilenler.Select(YetkiServisi.Anahtar).ToHashSet();

            foreach (var g in digerleri)
            {
                var liste = ((string)g.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();

                var kalan = liste.Where(x => !secilenAnahtar.Contains(YetkiServisi.Anahtar(x))).ToList();

                if (kalan.Count != liste.Count)
                    db.Execute("UPDATE KRY_POZISYON_GRUBU SET pozisyonlar = @p WHERE id = @id",
                        new { p = string.Join(",", kalan), id = (int)g.id });
            }

            cakisanlar.Clear();
        }

        if (girdi.Aktif && cakisanlar.Count > 0)
            return BadRequest(new
            {
                hata = "Bu ünvanlar başka bir grupta: " + string.Join(", ", cakisanlar)
                     + ". Bir ünvan yalnızca bir grupta olabilir; önce diğer gruptan çıkarınız."
            });

        if (girdi.Id > 0)
        {
            /* Grup yetkileri grubun adıyla saklanıyor: ad değişince
               satırlar da yeni ada taşınıyor. Eskiden yeniden adlandırılan
               grubun bütün modül yetkileri sessizce kayboluyordu. */
            var eskiAd = db.ExecuteScalar<string>(
                "SELECT ad FROM KRY_POZISYON_GRUBU WHERE id = @id", new { id = girdi.Id });

            if (!string.IsNullOrWhiteSpace(eskiAd) && eskiAd.Trim() != girdi.Ad.Trim())
                db.Execute(@"
UPDATE B360_YETKI SET anahtar = @yeni
WHERE kapsam = 'grup' AND anahtar = @eski",
                    new { yeni = girdi.Ad.Trim(), eski = eskiAd.Trim() });

            db.Execute(@"
UPDATE KRY_POZISYON_GRUBU
SET ad = @ad, aciklama = @aciklama, pozisyonlar = @pozisyonlar, aktif = @aktif
WHERE id = @id",
                new
                {
                    id = girdi.Id,
                    ad = girdi.Ad.Trim(),
                    aciklama = girdi.Aciklama,
                    pozisyonlar,
                    aktif = girdi.Aktif
                });

            return Ok(new { basarili = true, id = girdi.Id });
        }

        /* Çalışma düzeni alanları (izin günleri, mesai saati) burada
           sorulmuyor; portalın işi yetki. Varsayılanlarla açılıyor ve
           İK paneli o alanları dolduruyor. */
        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_POZISYON_GRUBU (ad, aciklama, pozisyonlar, aktif)
OUTPUT INSERTED.id VALUES (@ad, @aciklama, @pozisyonlar, @aktif)",
            new
            {
                ad = girdi.Ad.Trim(),
                aciklama = girdi.Aciklama,
                pozisyonlar,
                aktif = girdi.Aktif
            });

        return Ok(new { basarili = true, id });
    }

    private static bool Gecerli(string alan, string kapsam)
    {
        if (alan is not (Alan.Panel or Alan.Mobil)) return false;

        /* Mobilde üç katman var: kişi, ünvan ve ünvanın bağlı olduğu grup */
        return alan == Alan.Panel
            ? kapsam is Kapsam.Kullanici or Kapsam.Rol
            : kapsam is Kapsam.Kullanici or Kapsam.Pozisyon or Kapsam.Grup;
    }

    /* ==================================================================== */

    /// <summary>
    /// Pozisyon listesi personel kayıtlarından toplanır.
    ///
    /// <para>
    /// Elle liste tutmak, yeni görev eklendiğinde unutuluyor. Kaynak Kariyer
    /// sistemiyle aynı: ünvan tanımları tablosundan gelen açıklama. Mobil
    /// taraftaki <c>Pozisyon</c> alanı da bu değeri taşıdığı için pozisyon
    /// bazlı yetki eşleşmesi tutuyor.
    /// </para>
    ///
    /// <para>
    /// Çalışıyor olma denetimi çıkış tarihine bakılarak yapılıyor; Mikro'da
    /// boş tarihler 1900 öncesi değerlerle tutulabildiği için eşik 1950.
    /// </para>
    /// </summary>
    /// <summary>
    /// Kontrol listesi hedefleri: pozisyonlar ve şubeler.
    ///
    /// <para>
    /// Liste doğrudan Mikro'dan okunuyor; yetki ekranındaki pozisyon
    /// listesiyle aynı kaynak. Daha önce Kariyer servisine soruluyordu ve
    /// adres yanlış olduğunda sunucu HTML hata sayfası dönüyor, ekranda
    /// "geçersiz JSON" hatası çıkıyordu. Portalın kendi ucu olması bu
    /// bağımlılığı kaldırıyor.
    /// </para>
    /// </summary>
    [HttpGet("ChecklistSecenekleri")]
    public IActionResult ChecklistSecenekleri()
    {
        if (!Yetkili()) return Forbid();

        var pozisyonlar = Pozisyonlar();
        var subeler = new List<string>();
        string uyari = null;

        try
        {
            using var db = _vt.PersonelBaglantisi();

            subeler = db.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(PIG.ig_adi))
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
WHERE LTRIM(RTRIM(ISNULL(PIG.ig_adi, ''))) <> ''
  AND (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) < 1950)",
                commandTimeout: 60)
                .OrderBy(x => x, StringComparer.Create(
                    new System.Globalization.CultureInfo("tr-TR"), true))
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şube listesi alınamadı");

            uyari = "Şube listesine ulaşılamadı: " + hata.Message;
        }

        if (pozisyonlar.Count == 0)
            uyari = (uyari is null ? "" : uyari + " ")
                  + "Pozisyon listesine de ulaşılamadı. Değerleri elle yazabilirsiniz.";

        return Ok(new { pozisyonlar, subeler, uyari });
    }

    private List<string> Pozisyonlar()
    {
        try
        {
            using var db = _vt.PersonelBaglantisi();

            return db.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(ISNULL(NULLIF(LTRIM(RTRIM(CAST(P.per_kim_meslek AS NVARCHAR(200)))), N''), PUT.un_aciklama)))
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE LTRIM(RTRIM(ISNULL(ISNULL(NULLIF(LTRIM(RTRIM(CAST(P.per_kim_meslek AS NVARCHAR(200)))), N''), PUT.un_aciklama), ''))) <> ''
  AND (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) < 1950)",
                commandTimeout: 60)
                .OrderBy(x => x, StringComparer.Create(
                    new System.Globalization.CultureInfo("tr-TR"), true))
                .ToList();
        }
        catch
        {
            /* Personel veritabanına ulaşılamazsa yetki ekranı yine açılsın;
               pozisyon sekmesi boş kalır, kullanıcı ve rol sekmeleri çalışır. */
            return new();
        }
    }
}

/* ========================================================================== */

/// <summary>Matris ekranından gelen toplu kayıt isteği.</summary>
public class TopluYetkiGirdi
{
    /// <summary>"panel" ya da "mobil"</summary>
    public string Alan { get; set; }

    /// <summary>"kullanici", "rol" ya da "pozisyon"</summary>
    public string Kapsam { get; set; }

    /// <summary>Yalnızca değişen anahtarlar gönderilir.</summary>
    public List<YetkiGirdi> Satirlar { get; set; } = new();
}

/// <summary>Portaldan tanımlanan pozisyon grubu.</summary>
public class GrupKopyalaGirdi
{
    public int KaynakId { get; set; }
    public List<int> HedefIdler { get; set; }

    /// <summary>Hangi modülü görür, görmez</summary>
    public bool Moduller { get; set; } = true;

    /// <summary>Sorumluluk, veri kapsamı, onay ayarları</summary>
    public bool Ayarlar { get; set; }
}

public class PozisyonGrubuGirdi
{
    public int Id { get; set; }
    public string Ad { get; set; }
    public string Aciklama { get; set; }

    /// <summary>Mikro'daki ünvan adları.</summary>
    public List<string> Pozisyonlar { get; set; } = new();

    /// <summary>
    /// Başka gruptaki ünvan seçildiyse o gruptan çıkarılıp bu gruba
    /// taşınsın. Kapalıyken çakışma eskisi gibi reddediliyor.
    /// </summary>
    public bool Tasi { get; set; }

    public bool Aktif { get; set; } = true;
}

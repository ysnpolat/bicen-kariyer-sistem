using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/* ==========================================================================
 * Giriş denemesi sınırlayıcı
 * --------------------------------------------------------------------------
 * Panel internete açık olduğunda parola denemesi yapan botları engeller.
 * IP başına belirli süre içinde sınırlı sayıda hatalı deneme kabul edilir.
 * ========================================================================== */

public static class GirisSinirlayici
{
    private const int EnFazlaDeneme = 6;
    private static readonly TimeSpan Pencere = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan Bekleme = TimeSpan.FromMinutes(15);

    private class Kayit
    {
        public int Adet;
        public DateTime IlkDeneme;
        public DateTime? KilitBitis;
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, Kayit>
        _kayitlar = new();

    /// <summary>
    /// Bu adres için kaç hatalı deneme yapıldı?
    /// Doğrulama kutusunun ne zaman gösterileceğini belirlemek için kullanılır.
    /// </summary>
    public static int HataliDenemeSayisi(string ip)
    {
        if (!_kayitlar.TryGetValue(ip, out var k)) return 0;

        /* Pencere dolduysa sayaç sıfırlanmış sayılır */
        if (DateTime.UtcNow - k.IlkDeneme > Pencere) return 0;

        return k.Adet;
    }

    /// <summary>Kilitliyse kalan süreyi saniye olarak verir, değilse null.</summary>
    public static int? KilitliMi(string ip)
    {
        if (!_kayitlar.TryGetValue(ip, out var k)) return null;

        if (k.KilitBitis is { } bitis)
        {
            if (bitis > DateTime.UtcNow)
                return (int)(bitis - DateTime.UtcNow).TotalSeconds;

            _kayitlar.TryRemove(ip, out _);
        }

        return null;
    }

    public static void HataliDeneme(string ip)
    {
        var k = _kayitlar.GetOrAdd(ip, _ => new Kayit { IlkDeneme = DateTime.UtcNow });

        lock (k)
        {
            // Pencere dolduysa sayaç sıfırlanır
            if (DateTime.UtcNow - k.IlkDeneme > Pencere)
            {
                k.Adet = 0;
                k.IlkDeneme = DateTime.UtcNow;
                k.KilitBitis = null;
            }

            k.Adet++;

            if (k.Adet >= EnFazlaDeneme)
                k.KilitBitis = DateTime.UtcNow.Add(Bekleme);
        }
    }

    public static void BasariliGiris(string ip) => _kayitlar.TryRemove(ip, out _);
}

/* ==========================================================================
 * Giriş
 * ========================================================================== */

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly JwtServisi _jwt;
    private readonly GuvenlikGunlugu _gunluk;

    private readonly TurnstileServisi _turnstile;
    private readonly UlkeServisi _ulke;
    private readonly AyarServisi _ayar;

    public AuthController(
        VeritabaniServisi vt,
        JwtServisi jwt,
        GuvenlikGunlugu gunluk,
        TurnstileServisi turnstile,
        UlkeServisi ulke,
        AyarServisi ayar)
    {
        _vt = vt;
        _jwt = jwt;
        _gunluk = gunluk;
        _turnstile = turnstile;
        _ulke = ulke;
        _ayar = ayar;
    }

    /// <summary>
    /// Kaç hatalı denemeden sonra doğrulama istenir.
    ///
    /// İlk denemelerde doğrulama gösterilmez; günlük kullanımda İK ekibini
    /// bekletmemek içindir. Parola yanlış girilmeye başlandığında devreye
    /// girer ve otomatik deneme yapan araçları keser.
    /// </summary>
    private const int DogrulamaEsigi = 2;

    /// <summary>
    /// Giriş ekranının durumu: doğrulama gerekiyor mu, site anahtarı nedir.
    /// Giriş sayfası açılırken çağrılır.
    /// </summary>
    [HttpGet("GirisDurumu")]
    [AllowAnonymous]
    public IActionResult GirisDurumu()
    {
        var ip = Adres();
        var hatali = GirisSinirlayici.HataliDenemeSayisi(ip);

        return Ok(new
        {
            dogrulamaGerekli = _turnstile.Etkin && hatali >= DogrulamaEsigi,
            siteAnahtari = _turnstile.SiteAnahtari,
            hataliDeneme = hatali
        });
    }

    /// <summary>Gerçek istemci adresi; taklit edilebilir başlığa güvenilmez.</summary>
    private string Adres()
    {
        var adres = Servisler.IstemciAdresi.Bul(HttpContext);
        return string.IsNullOrWhiteSpace(adres) ? "bilinmiyor" : adres;
    }

    [HttpPost("Giris")]
    [AllowAnonymous]
    public async Task<IActionResult> Giris([FromBody] GirisGirdi girdi)
    {
        var ip = Adres();

        /* Panel girişi de yurt dışına kapalıdır */
        if (!await _ulke.IzinliMi(ip))
        {
            return StatusCode(403, new
            {
                hata = "Bu bağlantıdan giriş yapılamaz."
            });
        }

        if (GirisSinirlayici.KilitliMi(ip) is { } kalan)
        {
            var dakika = Math.Max(1, kalan / 60);
            return StatusCode(429, new
            {
                hata = $"Çok fazla hatalı giriş denemesi yapıldı. " +
                       $"Lütfen {dakika} dakika sonra tekrar deneyiniz."
            });
        }

        /* Hatalı deneme eşiği aşıldıysa doğrulama zorunludur.
           İlk denemelerde istenmez; günlük kullanım yavaşlamasın. */
        var dogrulamaGerekli =
            _turnstile.Etkin &&
            GirisSinirlayici.HataliDenemeSayisi(ip) >= DogrulamaEsigi;

        if (dogrulamaGerekli &&
            !await _turnstile.DogrulaAsync(girdi?.DogrulamaJetonu, ip))
        {
            return StatusCode(403, new
            {
                hata = "Güvenlik doğrulaması tamamlanamadı.",
                dogrulamaGerekli = true
            });
        }

        if (girdi is null ||
            string.IsNullOrWhiteSpace(girdi.KullaniciAdi) ||
            string.IsNullOrWhiteSpace(girdi.Parola))
        {
            return BadRequest(new { hata = "Kullanıcı adı ve parola zorunludur." });
        }

        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault(@"
SELECT id, kullanici_adi, ad_soyad, rol, aktif, subeler, parola_hash, parola_salt,
       ISNULL(onay_yetkisi, 0) AS onay_yetkisi,
       CAST(ISNULL(ik_erisim, 1) AS BIT) AS ik_erisim
FROM KRY_KULLANICILAR WHERE kullanici_adi = @k", new { k = girdi.KullaniciAdi.Trim() });

        if (kayit is null || !(bool)kayit.aktif)
        {
            GirisSinirlayici.HataliDeneme(ip);
            _gunluk.Yaz("GİRİŞ BAŞARISIZ", ip,
                $"Kullanıcı bulunamadı veya pasif: {girdi.KullaniciAdi}");

            return Unauthorized(new
            {
                hata = "Kullanıcı adı veya parola hatalı.",
                dogrulamaGerekli = _turnstile.Etkin &&
                    GirisSinirlayici.HataliDenemeSayisi(ip) >= DogrulamaEsigi,
                siteAnahtari = _turnstile.SiteAnahtari
            });
        }

        if (!ParolaServisi.Dogrula(girdi.Parola, (string)kayit.parola_hash, (string)kayit.parola_salt))
        {
            GirisSinirlayici.HataliDeneme(ip);
            _gunluk.Yaz("GİRİŞ BAŞARISIZ", ip, $"Parola hatalı: {girdi.KullaniciAdi}");

            return Unauthorized(new
            {
                hata = "Kullanıcı adı veya parola hatalı.",
                dogrulamaGerekli = _turnstile.Etkin &&
                    GirisSinirlayici.HataliDenemeSayisi(ip) >= DogrulamaEsigi,
                siteAnahtari = _turnstile.SiteAnahtari
            });
        }

        /* Portaldan açılıp İK paneli erişimi verilmemiş kullanıcı.

           Parola doğrulandıktan sonra denetleniyor: yanlış parolada
           "erişiminiz yok" demek, kullanıcı adının var olduğunu söylerdi.
           Mesaj nereye gitmesi gerektiğini de söylüyor. */
        if (!(bool)kayit.ik_erisim)
        {
            _gunluk.Yaz("GİRİŞ REDDİ", ip, $"İK paneli erişimi yok: {girdi.KullaniciAdi}");

            return StatusCode(403, new
            {
                hata = "Bu hesabın İK paneline erişimi yok.",
                ayrinti = "Hesabınız yalnızca Biçen360 portalı içindir: portal.bicen.com.tr"
            });
        }

        GirisSinirlayici.BasariliGiris(ip);
        _gunluk.Yaz("GİRİŞ", ip, $"Kullanıcı: {girdi.KullaniciAdi}");

        var kullanici = new Kullanici
        {
            Id = (int)kayit.id,
            KullaniciAdi = (string)kayit.kullanici_adi,
            AdSoyad = (string)kayit.ad_soyad,
            Rol = (string)kayit.rol,
            Subeler = kayit.subeler as string
        };

        var (token, bitis) = _jwt.Uret(kullanici);

        return Ok(new GirisCikti
        {
            Id = kullanici.Id,
            Token = token,
            KullaniciAdi = kullanici.KullaniciAdi,
            AdSoyad = kullanici.AdSoyad,
            Rol = kullanici.Rol,
            GecerlilikSonu = bitis,
            /* Yöneticiler her zaman onaylayabilir; diğerleri için kolon bakılır */
            OnayYetkisi = Roller.OnayYetkisi(kullanici.Rol) ||
                          (kayit.onay_yetkisi is bool oy && oy),

            /* Panelin menüyü ve düğmeleri kısıtlaması için; veri
               maskelemesi zaten sunucuda yapılıyor. */
            Yetki = (_ayar.FormOku().RolYetkileri ?? new Dictionary<string, RolYetkisi>())
                .GetValueOrDefault(kullanici.Rol)
        });
    }

    /// <summary>
    /// Başka bir kullanıcının hesabıyla oturum açar.
    ///
    /// Yalnızca yönetici ve genel müdür yardımcısı kullanabilir. Amaç,
    /// bir kullanıcının ekranı nasıl gördüğünü doğrulamak ve gerektiğinde
    /// onun adına işlem yapabilmektir.
    ///
    /// Oturum bir saatle sınırlıdır, güvenlik günlüğüne yazılır ve yapılan
    /// işlemlerde gerçek kişinin adı görünür.
    /// </summary>
    [HttpPost("KullaniciOl/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult KullaniciOl(int id)
    {
        var gercekKullanici = User?.Identity?.Name ?? "";
        var gercekAdSoyad = User?.FindFirst("adSoyad")?.Value ?? gercekKullanici;

        /* Zaten taklit oturumundaysa yeni bir taklit başlatılamaz */
        if (User?.FindFirst("taklitEden") is not null)
        {
            return BadRequest(new
            {
                hata = "Zaten başka bir kullanıcı olarak görüntülüyorsunuz.",
                ayrinti = "Önce kendi hesabınıza dönünüz."
            });
        }

        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault(@"
SELECT id, kullanici_adi, ad_soyad, rol, aktif, subeler
FROM KRY_KULLANICILAR WHERE id = @id", new { id });

        if (kayit is null)
            return NotFound(new { hata = "Kullanıcı bulunamadı." });

        if (!(bool)kayit.aktif)
            return BadRequest(new { hata = "Bu hesap pasif durumda." });

        if (string.Equals((string)kayit.kullanici_adi, gercekKullanici,
                StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { hata = "Zaten bu hesapla giriş yapmışsınız." });
        }

        var hedef = new Kullanici
        {
            Id = (int)kayit.id,
            KullaniciAdi = (string)kayit.kullanici_adi,
            AdSoyad = (string)kayit.ad_soyad,
            Rol = (string)kayit.rol,
            Subeler = kayit.subeler as string
        };

        var (token, bitis) = _jwt.Uret(hedef, gercekKullanici, gercekAdSoyad);

        _gunluk.Yaz("KULLANICI OLARAK GİRİŞ",
            IstemciAdresi.Bul(HttpContext),
            $"{gercekAdSoyad} → {hedef.AdSoyad} ({hedef.KullaniciAdi}, {hedef.Rol})");

        return Ok(new GirisCikti
        {
            Id = hedef.Id,
            Token = token,
            KullaniciAdi = hedef.KullaniciAdi,
            AdSoyad = hedef.AdSoyad,
            Rol = hedef.Rol,
            GecerlilikSonu = bitis,
            OnayYetkisi = Roller.OnayYetkisi(hedef.Rol),
            TaklitEden = gercekAdSoyad
        });
    }

    [HttpGet("Ben")]
    [Authorize]
    public IActionResult Ben() => Ok(new
    {
        kullaniciAdi = User.Identity?.Name,
        rol = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value,
        adSoyad = User.FindFirst("adSoyad")?.Value
    });

    /// <summary>Oturum açan kullanıcının kendi profil bilgileri.</summary>
    [HttpGet("Profil")]
    [Authorize]
    public IActionResult Profil()
    {
        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault<Kullanici>(@"
SELECT id AS Id, kullanici_adi AS KullaniciAdi, ad_soyad AS AdSoyad,
       eposta AS Eposta, unvan AS Unvan, telefon AS Telefon, bolge AS Bolge,
       subeler AS Subeler, rol AS Rol, aktif AS Aktif,
       imza AS Imza
FROM KRY_KULLANICILAR WHERE kullanici_adi = @k", new { k = User.Identity?.Name });

        if (kayit is null) return NotFound(new { hata = "Kullanıcı bulunamadı." });

        return Ok(kayit);
    }

    /// <summary>
    /// Kullanıcı kendi bilgilerini günceller. Ünvan ve telefon, görüşme davet
    /// mailinde imza olarak adaya gösterilir.
    /// </summary>
    [HttpPost("Profil")]
    [Authorize]
    public IActionResult ProfilKaydet([FromBody] ProfilGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.AdSoyad))
            return BadRequest(new { hata = "Ad soyad zorunludur." });

        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_KULLANICILAR
SET ad_soyad = @adSoyad, eposta = @eposta, unvan = @unvan, telefon = @telefon
WHERE kullanici_adi = @k",
            new
            {
                adSoyad = girdi.AdSoyad.Trim(),
                eposta = girdi.Eposta?.Trim(),
                unvan = girdi.Unvan?.Trim(),
                telefon = girdi.Telefon?.Trim(),
                k = User.Identity?.Name
            });

        if (!string.IsNullOrWhiteSpace(girdi.YeniParola))
        {
            var gucSorunu = ParolaServisi.GucKontrolu(girdi.YeniParola);
            if (gucSorunu is not null) return BadRequest(new { hata = gucSorunu });

            var (hash, salt) = ParolaServisi.Uret(girdi.YeniParola);
            db.Execute(@"
UPDATE KRY_KULLANICILAR SET parola_hash = @h, parola_salt = @s
WHERE kullanici_adi = @k", new { h = hash, s = salt, k = User.Identity?.Name });
        }

        return Ok(new { basarili = true });
    }

    [HttpPost("ParolaDegistir")]
    [Authorize]
    public IActionResult ParolaDegistir([FromBody] GirisGirdi girdi)
    {
        var parolaSorunu = ParolaServisi.GucKontrolu(girdi?.Parola);
        if (parolaSorunu is not null) return BadRequest(new { hata = parolaSorunu });

        var (hash, salt) = ParolaServisi.Uret(girdi.Parola);

        using var db = _vt.Baglanti();
        db.Execute(@"
UPDATE KRY_KULLANICILAR SET parola_hash = @h, parola_salt = @s
WHERE kullanici_adi = @k", new { h = hash, s = salt, k = User.Identity?.Name });

        return Ok(new { basarili = true });
    }
}

/* ==========================================================================
 * Kullanıcı yönetimi (yalnızca Admin)
 * ========================================================================== */

/// <summary>
/// Engellenen IP adresleri. Listedeki adreslerden gelen istekler
/// karşılanmaz. Tek adres veya önek ("24.133.13.") yazılabilir.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin)]
public class KaraListeController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly KaraListeServisi _kara;
    private readonly GuvenlikGunlugu _gunluk;

    public KaraListeController(
        VeritabaniServisi vt,
        KaraListeServisi kara,
        GuvenlikGunlugu gunluk)
    {
        _vt = vt;
        _kara = kara;
        _gunluk = gunluk;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /* ==================================================================== */
    /* SMS sınaması                                                          */
    /* ==================================================================== */

    /// <summary>
    /// SMS bağlantısını sınar: verilen numaraya gerçek bir test SMS'i
    /// gönderir ve sağlayıcının ham yanıtını gösterir.
    ///
    /// Hata dönerse yanıttaki StatusDescription sebebi söyler; kullanıcı
    /// adı/şifre için appsettings.json → Sms bölümüne bakınız.
    /// </summary>
    [HttpGet("SmsSinama")]
    public async Task<IActionResult> SmsSinama(
        [FromQuery] string telefon,
        [FromServices] SmsServisi sms)
    {
        if (string.IsNullOrWhiteSpace(telefon))
            return Ok(new
            {
                etkin = sms.Etkin,
                aciklama = sms.Etkin
                    ? "SMS servisi açık. Sınamak için ?telefon=5xxxxxxxxx ekleyiniz."
                    : "SMS servisi kapalı ya da KullaniciAdi tanımlı değil "
                      + "(appsettings.json → Sms)."
            });

        var sonuc = await sms.Gonder(telefon,
            "Bicen Market SMS baglanti sinamasi. Bu bir test mesajidir.");

        return Ok(new
        {
            basarili = sonuc.Basarili,
            mesaj = sonuc.Mesaj,
            hamYanit = sonuc.HamYanit
        });
    }

    /* ==================================================================== */
    /* Kod sınırı aşan numaralar                                            */
    /* ==================================================================== */

    /// <summary>
    /// Son 24 saatte kod isteyen numaralar; sınıra yaklaşanlar ve aşanlar
    /// üstte. Sınır numara başına 24 saatte 5 istektir.
    ///
    /// Sınırı aşan bir aday gerçekten sıkışmış olabilir (kod ulaşmamış,
    /// yanlış numara girip düzeltmiş olabilir); bu listeden görüp
    /// sıfırlayabilirsiniz.
    /// </summary>
    [HttpGet("KodSiniri")]
    public IActionResult KodSiniri()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT telefon                             AS telefon,
       COUNT(*)                            AS istek,
       SUM(CASE WHEN dogrulandi = 1 THEN 1 ELSE 0 END) AS dogrulanan,
       MAX(olusturma)                      AS sonIstek,
       MAX(gonderen_ip)                    AS adres
FROM KRY_TELEFON_DOGRULAMA
WHERE olusturma > DATEADD(day, -1, SYSDATETIME())
GROUP BY telefon
HAVING COUNT(*) >= 3
ORDER BY COUNT(*) DESC, MAX(olusturma) DESC").ToList();

        return Ok(new { sinir = 5, liste });
    }

    /// <summary>
    /// Bir numaranın günlük kod sayacını sıfırlar: son 24 saatteki
    /// doğrulama kayıtları silinir, numara yeniden kod isteyebilir.
    ///
    /// Doğrulanmış ve henüz kullanılmamış bir kayıt varsa o korunur;
    /// adayın elindeki geçerli kod iptal olmasın.
    /// </summary>
    [HttpPost("KodSiniri/Sifirla")]
    public IActionResult KodSiniriSifirla([FromBody] KodSiniriGirdi girdi)
    {
        var telefon = new string((girdi?.Telefon ?? "").Where(char.IsDigit).ToArray());

        if (telefon.StartsWith("90") && telefon.Length == 12) telefon = telefon[2..];
        if (telefon.StartsWith("0") && telefon.Length == 11) telefon = telefon[1..];

        if (telefon.Length != 10)
            return BadRequest(new { hata = "Geçerli bir telefon numarası giriniz." });

        using var db = _vt.Baglanti();

        var silinen = db.Execute(@"
DELETE FROM KRY_TELEFON_DOGRULAMA
WHERE telefon = @telefon
  AND olusturma > DATEADD(day, -1, SYSDATETIME())
  AND NOT (dogrulandi = 1 AND kullanildi = 0 AND gecerlilik > SYSDATETIME())",
            new { telefon });

        _gunluk.Yaz("KOD SINIRI SIFIRLANDI", IstemciAdresi.Bul(HttpContext),
            $"{telefon} · {silinen} kayıt silindi · {Kullanici}");

        return Ok(new { basarili = true, silinen });
    }

    /* ==================================================================== */
    /* SMS doğrulama kodu havuzu                                            */
    /* ==================================================================== */

    /// <summary>
    /// Havuzun durumu: kalan kod sayısı ve en son yükleme bilgisi.
    /// SMS yalnızca bu havuzdaki kodlarla gönderilir; gönderilen kod
    /// havuzdan silinir, havuz boşsa kod gönderilmez.
    /// </summary>
    [HttpGet("KodHavuzu")]
    public IActionResult KodHavuzu()
    {
        using var db = _vt.Baglanti();

        var ozet = db.QueryFirstOrDefault(@"
SELECT COUNT(*) AS adet,
       MAX(olusturma) AS sonYukleme,
       MIN(kod) AS ilkKod
FROM KRY_KOD_HAVUZU");

        return Ok(new
        {
            adet = (int)(ozet?.adet ?? 0),
            sonYukleme = (DateTime?)ozet?.sonYukleme
        });
    }

    /// <summary>
    /// TXT içeriğinden kod yükler. Her satır bir koddur; boş satırlar,
    /// tekrar edenler ve havuzda zaten bulunanlar atlanır.
    /// </summary>
    [HttpPost("KodHavuzu")]
    public IActionResult KodHavuzuYukle([FromBody] KodHavuzuGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Icerik))
            return BadRequest(new { hata = "Dosya içeriği boş." });

        var kodlar = girdi.Icerik
            .Split(new[] { '\r', '\n', ',', ';', '\t' },
                   StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length is > 0 and <= 20)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (kodlar.Count == 0)
            return BadRequest(new { hata = "Dosyada geçerli kod bulunamadı." });

        using var db = _vt.Baglanti();

        var eklenen = 0;

        foreach (var kod in kodlar)
        {
            /* Aynı kod havuzda zaten varsa atlanır; benzersiz dizin
               ikinci kaydı zaten reddederdi, burada sessizce geçilir. */
            eklenen += db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_KOD_HAVUZU WHERE kod = @kod)
    INSERT INTO KRY_KOD_HAVUZU (kod, yukleyen) VALUES (@kod, @kullanici)",
                new { kod, kullanici = Kullanici });
        }

        var kalan = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_KOD_HAVUZU");

        _gunluk.Yaz("KOD HAVUZU YÜKLEME", IstemciAdresi.Bul(HttpContext),
            $"{eklenen} kod eklendi · toplam {kalan}");

        return Ok(new
        {
            basarili = true,
            okunan = kodlar.Count,
            eklenen,
            atlanan = kodlar.Count - eklenen,
            kalan
        });
    }

    /// <summary>Havuzdaki tüm kodları siler.</summary>
    [HttpDelete("KodHavuzu")]
    public IActionResult KodHavuzuTemizle()
    {
        using var db = _vt.Baglanti();

        var silinen = db.Execute("DELETE FROM KRY_KOD_HAVUZU");

        _gunluk.Yaz("KOD HAVUZU TEMİZLENDİ", IstemciAdresi.Bul(HttpContext),
            $"{silinen} kod silindi");

        return Ok(new { basarili = true, silinen });
    }

    /* ==================================================================== */
    /* İzin verilen e-posta alan adları                                      */
    /* ==================================================================== */

    /// <summary>
    /// İzinli alan adları. Bu listede kayıt varsa yalnızca buradaki
    /// alanlardan başvuru kabul edilir.
    /// </summary>
    [HttpGet("IzinliAlanlar")]
    public IActionResult IzinliAlanlar()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT id AS id, alan AS alan, aciklama AS aciklama, aktif AS aktif,
       ekleyen AS ekleyen, olusturma AS olusturma
FROM KRY_IZINLI_ALAN
ORDER BY aktif DESC, alan").ToList();

        return Ok(liste);
    }

    /// <summary>İzinli alan ekler.</summary>
    [HttpPost("IzinliAlan")]
    public IActionResult IzinliAlanEkle([FromBody] EngelliAlanGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Alan))
            return BadRequest(new { hata = "Alan adı gereklidir." });

        var alan = girdi.Alan.Trim().ToLowerInvariant();

        var at = alan.LastIndexOf('@');
        if (at >= 0) alan = alan[(at + 1)..];

        alan = alan.Trim().TrimStart('.').TrimEnd('.');

        if (alan.Length < 3 || !alan.Contains('.') || alan.Contains(' '))
            return BadRequest(new
            {
                hata = "Geçerli bir alan adı giriniz.",
                ayrinti = "Örnek: @gmail.com ya da gmail.com"
            });

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_IZINLI_ALAN AS h
USING (SELECT @alan AS alan) AS k ON h.alan = k.alan
WHEN MATCHED THEN
    UPDATE SET aktif = 1, aciklama = @aciklama, ekleyen = @ekleyen
WHEN NOT MATCHED THEN
    INSERT (alan, aciklama, ekleyen) VALUES (@alan, @aciklama, @ekleyen);",
            new { alan, aciklama = girdi.Sebep, ekleyen = Kullanici });

        _gunluk.Yaz("İZİNLİ ALAN EKLENDİ", "-", alan + " · " + Kullanici);

        return Ok(new { basarili = true, alan });
    }

    /// <summary>İzinli alanı açar ya da kapatır.</summary>
    [HttpPost("IzinliAlan/{id:int}/Durum")]
    public IActionResult IzinliAlanDurum(int id, [FromQuery] bool aktif)
    {
        using var db = _vt.Baglanti();

        db.Execute("UPDATE KRY_IZINLI_ALAN SET aktif = @aktif WHERE id = @id",
            new { id, aktif });

        return Ok(new { basarili = true });
    }

    /// <summary>İzinli alanı siler.</summary>
    [HttpDelete("IzinliAlan/{id:int}")]
    public IActionResult IzinliAlanSil(int id)
    {
        using var db = _vt.Baglanti();

        var alan = db.ExecuteScalar<string>(
            "SELECT alan FROM KRY_IZINLI_ALAN WHERE id = @id", new { id });

        db.Execute("DELETE FROM KRY_IZINLI_ALAN WHERE id = @id", new { id });

        if (!string.IsNullOrWhiteSpace(alan))
            _gunluk.Yaz("İZİNLİ ALAN SİLİNDİ", "-", alan + " · " + Kullanici);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Engellenen e-posta alan adları                                        */
    /* ==================================================================== */

    /// <summary>Engellenen alan adları; kaç kez iş gördükleriyle birlikte.</summary>
    [HttpGet("EngelliAlanlar")]
    public IActionResult EngelliAlanlar()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT id AS id, alan AS alan, sebep AS sebep,
       engelleme AS engelleme, son_deneme AS sonDeneme,
       aktif AS aktif, ekleyen AS ekleyen, olusturma AS olusturma
FROM KRY_ENGELLI_ALAN
ORDER BY aktif DESC, engelleme DESC, alan").ToList();

        return Ok(liste);
    }

    /// <summary>
    /// Alan adı ekler. @ornek.com, ornek.com ve kisi@ornek.com biçimlerinin
    /// hepsi kabul edilir; alan adına indirgenir.
    /// </summary>
    [HttpPost("EngelliAlan")]
    public IActionResult EngelliAlanEkle([FromBody] EngelliAlanGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Alan))
            return BadRequest(new { hata = "Alan adı gereklidir." });

        var alan = girdi.Alan.Trim().ToLowerInvariant();

        var at = alan.LastIndexOf('@');
        if (at >= 0) alan = alan[(at + 1)..];

        alan = alan.Trim().TrimStart('.').TrimEnd('.');

        if (alan.Length < 3 || !alan.Contains('.') || alan.Contains(' '))
            return BadRequest(new
            {
                hata = "Geçerli bir alan adı giriniz.",
                ayrinti = "Örnek: @ornek.com ya da ornek.com"
            });

        /* Yaygın sağlayıcılar ve şirket adresi korunur; yanlışlıkla
           engellenirse gerçek adayların tamamı kesilir. */
        if (alan is "bicen.com.tr" or "gmail.com" or "hotmail.com"
                 or "outlook.com" or "yahoo.com" or "icloud.com"
                 or "windowslive.com" or "yandex.com")
        {
            return BadRequest(new
            {
                hata = "Bu alan adı engellenemez.",
                ayrinti = "Yaygın sağlayıcılar ve şirket adresi korumalıdır."
            });
        }

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_ENGELLI_ALAN AS h
USING (SELECT @alan AS alan) AS k ON h.alan = k.alan
WHEN MATCHED THEN
    UPDATE SET aktif = 1, sebep = @sebep, ekleyen = @ekleyen
WHEN NOT MATCHED THEN
    INSERT (alan, sebep, ekleyen) VALUES (@alan, @sebep, @ekleyen);",
            new { alan, sebep = girdi.Sebep, ekleyen = Kullanici });

        _gunluk.Yaz("ALAN ENGELLENDİ", "-", alan + " · " + Kullanici);

        return Ok(new { basarili = true, alan });
    }

    /// <summary>Alan adını açar ya da kapatır.</summary>
    [HttpPost("EngelliAlan/{id:int}/Durum")]
    public IActionResult EngelliAlanDurum(int id, [FromQuery] bool aktif)
    {
        using var db = _vt.Baglanti();

        db.Execute("UPDATE KRY_ENGELLI_ALAN SET aktif = @aktif WHERE id = @id",
            new { id, aktif });

        return Ok(new { basarili = true });
    }

    /// <summary>Alan adını listeden siler.</summary>
    [HttpDelete("EngelliAlan/{id:int}")]
    public IActionResult EngelliAlanSil(int id)
    {
        using var db = _vt.Baglanti();

        var alan = db.ExecuteScalar<string>(
            "SELECT alan FROM KRY_ENGELLI_ALAN WHERE id = @id", new { id });

        db.Execute("DELETE FROM KRY_ENGELLI_ALAN WHERE id = @id", new { id });

        if (!string.IsNullOrWhiteSpace(alan))
            _gunluk.Yaz("ALAN ENGELİ KALDIRILDI", "-", alan + " · " + Kullanici);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Adres kara listesi                                                    */
    /* ==================================================================== */

    [HttpGet]
    public IActionResult Liste()
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id AS id, ip AS ip, sebep AS sebep, ekleyen AS ekleyen,
       olusturma AS olusturma, aktif AS aktif
FROM KRY_KARA_LISTE ORDER BY id DESC").ToList();

        return Ok(new { kayitlar });
    }

    [HttpPost]
    public IActionResult Ekle([FromBody] KaraListeGirdi girdi)
    {
        var ip = (girdi?.Ip ?? "").Trim();

        if (string.IsNullOrWhiteSpace(ip))
            return BadRequest(new { hata = "Adres zorunludur." });

        /* Kendi adresinizi engellemek paneli kullanılmaz hâle getirir */
        var benimAdres = IstemciAdresi.Bul(HttpContext);

        if (string.Equals(ip, benimAdres, StringComparison.OrdinalIgnoreCase))
            return BadRequest(new
            {
                hata = "Kendi adresinizi engelleyemezsiniz.",
                ayrinti = $"Şu an {benimAdres} adresinden bağlısınız."
            });

        using var db = _vt.Baglanti();

        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_KARA_LISTE WHERE ip = @ip)
    UPDATE KRY_KARA_LISTE
    SET aktif = 1, sebep = @sebep, ekleyen = @ekleyen, olusturma = SYSDATETIME()
    WHERE ip = @ip
ELSE
    INSERT INTO KRY_KARA_LISTE (ip, sebep, ekleyen)
    VALUES (@ip, @sebep, @ekleyen)",
            new { ip, sebep = girdi.Sebep?.Trim(), ekleyen = Kullanici });

        _kara.OnbellegiBosalt();
        _gunluk.Yaz("KARA LİSTEYE EKLENDİ", ip, $"Ekleyen: {Kullanici}");

        return Ok(new { basarili = true });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Kaldir(int id)
    {
        using var db = _vt.Baglanti();

        var ip = db.ExecuteScalar<string>(
            "SELECT ip FROM KRY_KARA_LISTE WHERE id = @id", new { id });

        db.Execute("DELETE FROM KRY_KARA_LISTE WHERE id = @id", new { id });

        _kara.OnbellegiBosalt();
        _gunluk.Yaz("KARA LİSTEDEN ÇIKARILDI", ip ?? "-", $"Çıkaran: {Kullanici}");

        return Ok(new { basarili = true });
    }
}

/// <summary>
/// Güvenlik günlüğü görüntüleme. Engellenen başvurular, hız sınırı aşımları
/// ve giriş denemeleri buradan izlenir; sunucuya bağlanmaya gerek kalmaz.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin)]
public class GunlukController : ControllerBase
{
    private readonly GuvenlikGunlugu _gunluk;

    public GunlukController(GuvenlikGunlugu gunluk) => _gunluk = gunluk;

    /// <summary>Kayıt bulunan günler.</summary>
    [HttpGet("Gunler")]
    public IActionResult Gunler() => Ok(new { gunler = _gunluk.Gunler() });

    /// <summary>Belirtilen günün kayıtları (en yeniden eskiye).</summary>
    [HttpGet("Kayitlar")]
    public IActionResult Kayitlar([FromQuery] DateTime? gun, [FromQuery] int adet = 500)
    {
        var kayitlar = _gunluk.Oku(gun, Math.Clamp(adet, 10, 2000));

        /* Olay türlerine göre sayılar; ekranın üstündeki özet için */
        var ozet = kayitlar
            .GroupBy(x => x.Olay)
            .Select(g => new { olay = g.Key, adet = g.Count() })
            .OrderByDescending(x => x.adet)
            .ToList();

        /* En çok işlem yapan adresler */
        var adresler = kayitlar
            .Where(x => x.Adres != "-" && !string.IsNullOrWhiteSpace(x.Adres))
            .GroupBy(x => x.Adres)
            .Select(g => new
            {
                adres = g.Key,
                adet = g.Count(),
                olaylar = g.Select(x => x.Olay).Distinct().ToList()
            })
            .OrderByDescending(x => x.adet)
            .Take(20)
            .ToList();

        return Ok(new { kayitlar, ozet, adresler });
    }
}

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin)]
public class KullaniciController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly PortalYetkiServisi _portalYetki;
    private readonly PersonelKaynagiServisi _kaynak;

    public KullaniciController(VeritabaniServisi vt, AyarServisi ayar,
        PortalYetkiServisi portalYetki, PersonelKaynagiServisi kaynak)
    {
        _vt = vt;
        _ayar = ayar;
        _portalYetki = portalYetki;
        _kaynak = kaynak;
    }

    [HttpGet("Liste")]
    public IActionResult Liste()
    {
        using var db = _vt.Baglanti();
        var liste = db.Query<Kullanici>(@"
SELECT id, kullanici_adi AS KullaniciAdi, ad_soyad AS AdSoyad, eposta AS Eposta,
       unvan AS Unvan, telefon AS Telefon, bolge AS Bolge, subeler AS Subeler,
       rol AS Rol, aktif AS Aktif, olusturma AS Olusturma,
       ISNULL(onay_yetkisi, 0) AS OnayYetkisi, sicil AS Sicil,
       mikro_kullanici_no AS MikroKullaniciNo
FROM KRY_KULLANICILAR ORDER BY id").ToList();

        /* Bölge müdürü hesabının Mikro'daki karşılığı (04.10.2026): mağaza
           müdürlerinin izin talebi bu kişiye gidiyor. Eşleşmeyen hesapta
           ekran uyarı gösteriyor; talep o zaman bölge müdürüne gidemez. */
        var eslesmeler = new Dictionary<int, PortalYetkiServisi.PanelBolgeMuduru>();

        try
        {
            PortalYetkiServisi.PanelBolgeMudurleriniUnut();

            foreach (var x in _portalYetki.PanelBolgeMudurleri(_kaynak.TumPersonelleriGetir(), _ayar.FormOku()))
                eslesmeler[x.HesapId] = x;
        }
        catch
        {
            /* Personel listesi okunamazsa eşleşme bilgisi gösterilmez */
        }

        return Ok(liste.Select(k =>
        {
            eslesmeler.TryGetValue(k.Id, out var e);

            return new
            {
                k.Id, k.KullaniciAdi, k.AdSoyad, k.Eposta, k.Unvan, k.Telefon, k.Bolge,
                k.Subeler, k.Rol, k.Aktif, k.Olusturma, k.OnayYetkisi, k.MikroKullaniciNo,
                sicil = string.IsNullOrWhiteSpace(k.Sicil) ? null : k.Sicil.Trim(),
                personelEslesme = e is null ? null : new
                {
                    bulundu = e.Kisi is not null,
                    sicil = e.Kisi?.PersonelKodu?.Trim(),
                    adSoyad = e.Kisi is null ? null : $"{e.Kisi.Ad} {e.Kisi.Soyad}".Trim(),
                    pozisyon = e.Kisi?.Pozisyon,
                    neyle = e.Eslesme,
                    subeSayisi = e.Subeler.Count == 0 ? 0 : e.Subeler.Count
                }
            };
        }));
    }

    [HttpPost("Kaydet")]
    public IActionResult Kaydet([FromBody] KullaniciGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.KullaniciAdi))
            return BadRequest(new { hata = "Kullanıcı adı zorunludur." });

        /* Tanımlı roller merkezî listeden doğrulanır; yeni bir rol
           eklendiğinde burayı güncellemek gerekmez. */
        if (!Roller.Tumu.Contains(girdi.Rol))
            girdi.Rol = Roller.IK;

        /* Bölge seçildiyse yetkili şubeler bölge tanımından alınır;
           bölge seçilmediyse elle seçilen şubeler kullanılır. */
        var subeMetni = SubeleriBelirle(girdi.Bolge, girdi.Subeler, girdi.Rol);

        using var db = _vt.Baglanti();

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_KULLANICILAR
SET ad_soyad = @ad, eposta = @eposta, unvan = @unvan, telefon = @telefon,
    bolge = @bolge, subeler = @subeler, rol = @rol, aktif = @aktif,
    onay_yetkisi = @onayYetkisi, sicil = @sicil, mikro_kullanici_no = @mikro
WHERE id = @id",
                new
                {
                    id = girdi.Id,
                    ad = girdi.AdSoyad,
                    eposta = girdi.Eposta,
                    unvan = girdi.Unvan,
                    telefon = girdi.Telefon,
                    bolge = girdi.Bolge,
                    subeler = subeMetni,
                    rol = girdi.Rol,
                    aktif = girdi.Aktif,
                    onayYetkisi = girdi.OnayYetkisi,
                    sicil = SicilYaz(girdi.Sicil),
                    mikro = MikroNo(girdi.MikroKullaniciNo)
                });

            if (!string.IsNullOrWhiteSpace(girdi.Parola))
            {
                var (h, s) = ParolaServisi.Uret(girdi.Parola);
                db.Execute(
                    "UPDATE KRY_KULLANICILAR SET parola_hash = @h, parola_salt = @s WHERE id = @id",
                    new { h, s, id = girdi.Id });
            }

            PortalYetkiServisi.PanelBolgeMudurleriniUnut();
            IzinOnayKuralServisi.Unut();

            return Ok(new { basarili = true, id = girdi.Id });
        }

        if (string.IsNullOrWhiteSpace(girdi.Parola) || girdi.Parola.Length < 6)
            return BadRequest(new { hata = "Yeni kullanıcı için parola giriniz." });

        if (!string.IsNullOrWhiteSpace(girdi.Parola))
        {
            var gucSorunu = ParolaServisi.GucKontrolu(girdi.Parola);
            if (gucSorunu is not null) return BadRequest(new { hata = gucSorunu });
        }

        var varMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_KULLANICILAR WHERE kullanici_adi = @k",
            new { k = girdi.KullaniciAdi.Trim() });

        if (varMi > 0)
            return BadRequest(new { hata = "Bu kullanıcı adı zaten kayıtlı." });

        var (hash, salt) = ParolaServisi.Uret(girdi.Parola);

        var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_KULLANICILAR
    (kullanici_adi, ad_soyad, eposta, unvan, telefon, bolge, subeler,
     parola_hash, parola_salt, rol, aktif, sicil, mikro_kullanici_no)
OUTPUT INSERTED.id
VALUES (@k, @ad, @eposta, @unvan, @telefon, @bolge, @subeler, @h, @s, @rol, @aktif, @sicil, @mikro)",
            new
            {
                k = girdi.KullaniciAdi.Trim(),
                ad = girdi.AdSoyad,
                eposta = girdi.Eposta,
                unvan = girdi.Unvan,
                telefon = girdi.Telefon,
                bolge = girdi.Bolge,
                subeler = subeMetni,
                h = hash,
                s = salt,
                rol = girdi.Rol,
                aktif = girdi.Aktif,
                sicil = SicilYaz(girdi.Sicil),
                mikro = MikroNo(girdi.MikroKullaniciNo)
            });

        PortalYetkiServisi.PanelBolgeMudurleriniUnut();
        IzinOnayKuralServisi.Unut();

        return Ok(new { basarili = true, id = yeniId });
    }

    private static int? MikroNo(int? no) => no is > 0 and < 100000 ? no : null;

    private static string SicilYaz(string sicil)
    {
        var s = (sicil ?? "").Trim();
        return s.Length == 0 ? null : (s.Length > 30 ? s[..30] : s);
    }

    /// <summary>
    /// Kullanıcı formunda personel seçimi (04.10.2026): hesabı Mikro'daki
    /// personelle eşleştirmek için. Ad, soyad ya da sicille arar; çalışan
    /// personelden en çok 20 kişi.
    /// </summary>
    [HttpGet("PersonelAra")]
    public IActionResult PersonelAra([FromQuery] string q)
    {
        var aranan = (q ?? "").Trim();

        if (aranan.Length < 2) return Ok(Array.Empty<object>());

        var a = PersonelKaynagiServisi.DuzAnahtar(aranan);
        var s = aranan.TrimStart('0');

        var sonuc = _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .Where(x =>
                (s.Length > 0 && (x.PersonelKodu ?? "").Trim().TrimStart('0') == s)
                || (a.Length >= 2 && PersonelKaynagiServisi.DuzAnahtar($"{x.Ad} {x.Soyad}").Contains(a))
                || (a.Length >= 2 && PersonelKaynagiServisi.DuzAnahtar(x.PersonelKodu).StartsWith(a)))
            .OrderBy(x => (x.PersonelKodu ?? "").Trim().TrimStart('0') == s ? 0 : 1)
            .ThenBy(x => x.Ad).ThenBy(x => x.Soyad)
            .Take(20)
            .Select(x => new
            {
                sicil = (x.PersonelKodu ?? "").Trim(),
                adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                pozisyon = x.Pozisyon,
                isYeri = x.IsGrubu,
                telefon = x.Telefon
            });

        return Ok(sonuc);
    }

    /// <summary>
    /// Kullanıcının yetkili şube listesini belirler.
    /// Bölge atanmışsa bölgenin şubeleri, aksi halde elle seçilenler kullanılır.
    /// </summary>
    private string SubeleriBelirle(string bolge, List<string> secilenler, string rol)
    {
        if (!string.IsNullOrWhiteSpace(bolge))
        {
            var subeler = BolgeSubeleri(bolge, _ayar.FormOku());
            if (subeler.Length > 0) return string.Join(",", subeler);
        }

        /* Şube ataması yalnızca şube sınırı olan rollerde anlamlıdır;
           İK uzmanında da bildirim dağıtımı için kullanılır. */
        if (rol != Roller.BolgeMuduru && rol != Roller.IK) return null;

        return string.Join(",", (secilenler ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0));
    }

    /// <summary>
    /// Virgülle ayrılmış bölge listesindeki tüm şubeleri birleştirir.
    /// Aynı şube birden fazla bölgede tanımlıysa bir kez sayılır.
    /// </summary>
    public static string[] BolgeSubeleri(string bolgeMetni, FormAyarlari ayar)
    {
        var adlar = (bolgeMetni ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToList();

        if (adlar.Count == 0) return Array.Empty<string>();

        return (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => adlar.Any(a =>
                string.Equals(a, b.Ad, StringComparison.OrdinalIgnoreCase)))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        using var db = _vt.Baglanti();

        var rol = db.ExecuteScalar<string>(
            "SELECT rol FROM KRY_KULLANICILAR WHERE id = @id", new { id });

        if (rol == Roller.Admin)
        {
            var adminSayisi = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_KULLANICILAR WHERE rol = @r AND aktif = 1",
                new { r = Roller.Admin });

            if (adminSayisi <= 1)
                return BadRequest(new { hata = "Son yönetici kullanıcısı silinemez." });
        }

        db.Execute("DELETE FROM KRY_KULLANICILAR WHERE id = @id", new { id });
        return Ok(new { basarili = true });
    }
}

/* ==========================================================================
 * Ayarlar
 * ========================================================================== */

[ApiController]
[Route("api/[controller]")]
public class AyarController : ControllerBase
{
    /// <summary>Bölge eşitlemesi için ara sınıf</summary>
    private class BolgeliKullanici
    {
        public int Id { get; set; }
        public string Bolge { get; set; }
    }

    private readonly AyarServisi _ayar;
    private readonly MailServisi _mail;
    private readonly VeritabaniServisi _vt;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly BildirimServisi _bildirim;

    public AyarController(
        AyarServisi ayar,
        MailServisi mail,
        VeritabaniServisi vt,
        GuvenlikGunlugu gunluk,
        BildirimServisi bildirim)
    {
        _ayar = ayar;
        _mail = mail;
        _vt = vt;
        _gunluk = gunluk;
        _bildirim = bildirim;
    }

    /// <summary>
    /// Biçen bildirim seslerini telefonda denemek (Yönetim → Mobil test).
    /// tur: onay | genel | kisa.
    /// </summary>
    [HttpPost("BildirimSesiDene")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> BildirimSesiDene([FromBody] SesDenemeGirdi girdi)
    {
        var sicil = (girdi?.Sicil ?? "").Trim();

        if (sicil.Length == 0) return BadRequest(new { hata = "Personel sicilini yazınız." });

        try
        {
            var (jetonVar, sesli, surum) = await _bildirim.SesDene(sicil, (girdi?.Tur ?? "kisa").Trim().ToLowerInvariant());

            if (!jetonVar)
                return BadRequest(new { hata = "Bu sicilde bildirim kaydı yok: Biçen360'a giriş yapıp bildirim izni vermiş olmalı." });

            return Ok(new { basarili = true, sesli, surum });
        }
        catch (Exception hata)
        {
            return BadRequest(new { hata = hata.Message });
        }
    }

    /// <summary>
    /// Aday formunun içeriği. Genel erişime açıktır.
    /// Turnstile site anahtarı da buradan iletilir; anahtar gizli değildir,
    /// sayfaya gömülmek üzere tasarlanmıştır.
    /// </summary>
    /// <summary>
    /// Sol menü sırasını kaydeder. Yalnızca sıra değişir; yetkiler
    /// rollere bağlıdır ve buradan etkilenmez.
    /// </summary>
    [HttpPost("MenuSirasi")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult MenuSirasiYaz([FromBody] MenuSirasiGirdi girdi)
    {
        var ayar = _ayar.FormOku();

        ayar.MenuSirasi = (girdi?.Sira ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        ayar.MenuGruplari = (girdi?.Gruplar ?? new Dictionary<string, string>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Key)
                     && !string.IsNullOrWhiteSpace(x.Value)
                     /* Kendi kendinin altı olamaz */
                     && !string.Equals(x.Key, x.Value, StringComparison.OrdinalIgnoreCase))
            .ToDictionary(x => x.Key.Trim(), x => x.Value.Trim());

        _ayar.Yaz("FORM", ayar);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Roller                                                               */
    /* ==================================================================== */

    /// <summary>
    /// Tanımlı roller: kodda sabit olanlar ve panelden açılanlar.
    ///
    /// <para>
    /// Kullanıcı formundaki rol listesi ve panelin rol adlarını yazdığı
    /// yerler buradan besleniyor; rol eklendiğinde panelde de elle liste
    /// güncellemek gerekmesin diye.
    /// </para>
    /// </summary>
    [HttpGet("Roller")]
    [Authorize]
    public IActionResult RollerOku()
    {
        var ayar = _ayar.FormOku();

        var sabitAdlar = new Dictionary<string, string>
        {
            [Roller.Admin] = "Yönetici",
            [Roller.GenelMudurYardimcisi] = "Genel Müdür Yardımcısı",
            [Roller.IKYoneticisi] = "İK Yöneticisi",
            [Roller.IK] = "İK Uzmanı",
            [Roller.BolgeKoordinatoru] = "Bölge Koordinatörü",
            [Roller.BolgeMuduru] = "Bölge Müdürü",
            [Roller.FotografGorevlisi] = "Fotoğraf Görevlisi",
        };

        var sabitler = Roller.Sabitler.Select(x => new
        {
            kod = x,
            ad = sabitAdlar.TryGetValue(x, out var a) ? a : x,
            ozel = false,
            temel = (string)null,
            aciklama = (string)null,
        });

        var ozeller = (ayar.OzelRoller ?? new List<OzelRol>()).Select(x => new
        {
            kod = x.Kod,
            ad = string.IsNullOrWhiteSpace(x.Ad) ? x.Kod : x.Ad,
            ozel = true,
            temel = Roller.Temel(x.Kod),
            aciklama = x.Aciklama,
        });

        /* Temel olarak seçilebilecekler: yönetici dışındaki sabit roller.
           Yönetici temel alınırsa panelden tam yetkili rol üretilebilirdi. */
        var temeller = Roller.Sabitler
            .Where(x => x != Roller.Admin)
            .Select(x => new
            {
                kod = x,
                ad = sabitAdlar.TryGetValue(x, out var a) ? a : x,
            });

        return Ok(new { roller = sabitler.Concat(ozeller).ToArray(), temeller });
    }

    /// <summary>
    /// Panelden açılan rolleri kaydeder.
    ///
    /// <para>
    /// Gelen liste özel rollerin tamamı sayılıyor: listede olmayan bir rol
    /// silinmiş demektir. Kullanıcısı olan bir rol silinemiyor — silinseydi
    /// o kullanıcılar tanınmayan bir rolle kalır ve hiçbir sayfayı
    /// göremezdi.
    /// </para>
    /// </summary>
    [HttpPost("Roller")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult RollerYaz([FromBody] List<OzelRol> girdi)
    {
        var ayar = _ayar.FormOku();

        var gelen = new List<OzelRol>();
        var kodlar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var ham in girdi ?? new List<OzelRol>())
        {
            var kod = (ham?.Kod ?? "").Trim();
            var ad = (ham?.Ad ?? "").Trim();

            if (kod.Length == 0 || ad.Length == 0)
                return BadRequest(new { hata = "Rol kodu ve adı zorunludur." });

            /* Kod jetona yazılıyor ve yetki süzgeçlerinde karşılaştırılıyor:
               boşluk ve noktalama, eşleşmenin sessizce tutmamasına yol
               açıyordu. */
            if (!kod.All(c => char.IsLetterOrDigit(c) && c < 128))
                return BadRequest(new
                {
                    hata = $"\"{kod}\" geçersiz. Rol kodu yalnızca İngiliz harfleri "
                         + "ve rakamlardan oluşmalı, boşluk içermemeli."
                });

            if (Roller.Sabitler.Contains(kod, StringComparer.OrdinalIgnoreCase))
                return BadRequest(new
                {
                    hata = $"\"{kod}\" kodda tanımlı bir rol; başka bir kod seçiniz."
                });

            if (!kodlar.Add(kod))
                return BadRequest(new { hata = $"\"{kod}\" kodu iki kez geçiyor." });

            var temel = (ham.Temel ?? "").Trim();

            if (!Roller.Sabitler.Contains(temel, StringComparer.OrdinalIgnoreCase)
                || string.Equals(temel, Roller.Admin, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new
                {
                    hata = $"\"{ad}\" rolü için geçerli bir temel rol seçiniz. "
                         + "Yönetici temel alınamaz."
                });

            gelen.Add(new OzelRol
            {
                Kod = kod,
                Ad = ad,
                Temel = temel,
                Aciklama = (ham.Aciklama ?? "").Trim(),
            });
        }

        /* Silinenler: kullanıcısı varsa engelleniyor. */
        var silinen = (ayar.OzelRoller ?? new List<OzelRol>())
            .Select(x => (x.Kod ?? "").Trim())
            .Where(x => x.Length > 0 && !kodlar.Contains(x))
            .ToList();

        if (silinen.Count > 0)
        {
            using var db = _vt.Baglanti();

            var kullanilan = db.Query<string>(@"
SELECT DISTINCT rol FROM KRY_KULLANICILAR WHERE rol IN @roller",
                new { roller = silinen }).ToList();

            if (kullanilan.Count > 0)
                return BadRequest(new
                {
                    hata = "Kullanıcısı olan rol silinemez: "
                         + string.Join(", ", kullanilan)
                         + ". Önce bu kullanıcıların rolünü değiştiriniz."
                });
        }

        ayar.OzelRoller = gelen;

        /* Silinen rolün yetki kaydı da gidiyor: kalırsa aynı kod yeniden
           açıldığında eski ayarla geliyor ve kimse bunu beklemiyor. */
        if (ayar.RolYetkileri is not null)
            foreach (var kod in silinen)
                ayar.RolYetkileri.Remove(kod);

        _ayar.Yaz("FORM", ayar);

        /* Yazdıktan sonra belleğe alınıyor: bir sonraki giriş yeni rolü
           tanısın diye. */
        Roller.OzelRolleriYukle(gelen);

        _gunluk.Yaz("ROL TANIMI", IstemciAdresi.Bul(HttpContext),
            $"{User.Identity?.Name}: {gelen.Count} özel rol kaydedildi"
            + (silinen.Count > 0 ? $", silinen: {string.Join(", ", silinen)}" : ""));

        return Ok(new { basarili = true, adet = gelen.Count });
    }

    /// <summary>
    /// Rol yetkilerini kaydeder. Yalnızca yönetim değiştirebilir:
    /// yanlış bir ayar herkesin erişimini kesebilir.
    /// </summary>
    [HttpPost("RolYetkileri")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult RolYetkileriYaz(
        [FromBody] Dictionary<string, RolYetkisi> girdi)
    {
        var ayar = _ayar.FormOku();

        ayar.RolYetkileri = girdi ?? new Dictionary<string, RolYetkisi>();

        /* Yönetici rolü hiçbir zaman kısıtlanmaz: kilitlenme durumunda
           ayarı düzeltecek biri kalmalı. */
        ayar.RolYetkileri.Remove(Roller.Admin);

        _ayar.Yaz("FORM", ayar);

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Oturumdaki kullanıcının güncel rol yetkisi (21.10.2026). Panel açılışta
    /// ve belirli aralıklarla okuyor: yetki değişince yeniden giriş gerekmiyor.
    /// </summary>
    [HttpGet("Yetkim")]
    [Authorize]
    public IActionResult Yetkim()
    {
        var rol = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
        var y = (_ayar.FormOku().RolYetkileri ?? new Dictionary<string, RolYetkisi>()).GetValueOrDefault(rol);

        Response.Headers.CacheControl = "no-store";
        return Ok(new { rol, yetki = y });
    }

    /// <summary>Rol yetkileri ve düzenlenebilir alanların listesi.</summary>
    [HttpGet("RolYetkileri")]
    [Authorize]
    public IActionResult RolYetkileriOku()
    {
        var ayar = _ayar.FormOku();

        return Ok(new
        {
            yetkiler = ayar.RolYetkileri ?? new Dictionary<string, RolYetkisi>(),

            /* Panelde kutucuk üretmek için: hangi roller ve hangi alanlar.

               Yönetici listede yok: yetkisi kısıtlanamıyor, kısıtlansaydı
               ayarı düzeltecek kimse kalmazdı. Panelden açılan roller
               sabitlerin ardına ekleniyor. */
            roller = new[]
                {
                    new { kod = Roller.GenelMudurYardimcisi, ad = "Genel Müdür Yardımcısı", ozel = false, temel = (string)null, aciklama = (string)null },
                    new { kod = Roller.IKYoneticisi, ad = "İK Yöneticisi", ozel = false, temel = (string)null, aciklama = (string)null },
                    new { kod = Roller.IK, ad = "İK Uzmanı", ozel = false, temel = (string)null, aciklama = (string)null },
                    new { kod = Roller.BolgeMuduru, ad = "Bölge Müdürü", ozel = false, temel = (string)null, aciklama = (string)null },
                    new { kod = Roller.BolgeKoordinatoru, ad = "Bölge Koordinatörü", ozel = false, temel = (string)null, aciklama = (string)null },
                    new { kod = Roller.FotografGorevlisi, ad = "Fotoğraf Görevlisi", ozel = false, temel = (string)null, aciklama = (string)null },
                }
                .Concat((ayar.OzelRoller ?? new List<OzelRol>()).Select(x => new
                {
                    kod = x.Kod,
                    ad = string.IsNullOrWhiteSpace(x.Ad) ? x.Kod : x.Ad,
                    ozel = true,
                    temel = Roller.Temel(x.Kod),
                    aciklama = x.Aciklama,
                }))
                .ToArray(),

            /* Sayfa içi sekmeler: menüyü görebilen ama belirli bir
               bölümü görmemesi gereken roller için. */
            sekmeler = new[]
            {
                new { kod = "cikismulakat.anket", ad = "Çıkış Mülakatı → Anket gönder" },
                new { kod = "cikismulakat.yeni", ad = "Çıkış Mülakatı → Yeni mülakat" },
                new { kod = "yillikizin.giris", ad = "Yıllık İzin → İzin Girişi" },
                new { kod = "yillikizin.aktarim", ad = "Yıllık İzin → Toplu Aktarım" },
                new { kod = "personeller.performans", ad = "Personel Kartı → Performans" },
                new { kod = "personeller.izin", ad = "Personel Kartı → Yıllık İzin" },
                new { kod = "personeller.notlar", ad = "Personel Kartı → Başvuru Notları" },
                new { kod = "basvurular.mulakat", ad = "Başvuru → Eski Çıkış Görüşmesi" },
            },

            alanlar = new[]
            {
                new { kod = "kimlik", ad = "T.C. Kimlik No", aciklama = "Son dört hane görünür" },
                new { kod = "ucret", ad = "Ücret / Maaş", aciklama = "Tamamen gizlenir" },
                new { kod = "adres", ad = "Açık Adres", aciklama = "Semt ve ilçe görünür, sokak gizlenir" },
                new { kod = "telefon", ad = "Telefon", aciklama = "Son dört hane görünür" },
                new { kod = "dogumTarihi", ad = "Doğum Tarihi", aciklama = "Tamamen gizlenir" },
            }
        });
    }

    /// <summary>
    /// Mobil test numarasını kaydeder.
    ///
    /// Yalnızca yönetim değiştirebilir: bu numarayı bilen biri her
    /// personelin verisini görebilir.
    /// </summary>
    [HttpPost("MobilTestTelefon")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult MobilTestTelefonYaz([FromBody] MetinGirdi girdi)
    {
        var temiz = new string((girdi?.Deger ?? "").Where(char.IsDigit).ToArray());

        if (temiz.Length > 0 && temiz.Length != 10)
            return BadRequest(new
            {
                hata = "Telefon numarası on haneli olmalıdır.",
                ayrinti = "Başında sıfır olmadan giriniz. Kapatmak için boş bırakınız."
            });

        var ayar = _ayar.FormOku();

        ayar.MobilTestTelefon = temiz;

        _ayar.Yaz("FORM", ayar);

        _gunluk.Yaz(
            "MOBIL TEST NUMARASI",
            User?.Identity?.Name ?? "-",
            temiz.Length == 0
                ? "Test numarası kaldırıldı."
                : $"Test numarası tanımlandı: {temiz}");

        return Ok(new { basarili = true, tanimli = temiz.Length == 10 });
    }

    [HttpGet("FormGenel")]
    [AllowAnonymous]
    public IActionResult FormGenel(
        [FromServices] TurnstileServisi turnstile)
    {
        var ayar = _ayar.FormOku();

        /* Form ayarları önbelleğe alınmamalı: değişiklik anında geçerli
           olmalı, aksi hâlde kapatılan bir adım günlerce görünmeye
           devam edebiliyor. */
        Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        Response.Headers.Pragma = "no-cache";

        /* Ayarların tamamı döndürülür; site anahtarı ek alan olarak konur.
           Site anahtarı gizli değildir, sayfaya gömülmek üzere tasarlanmıştır.

           Alan adları camelCase olmalı: form "subeler" bekler, "Subeler"
           gelirse listeler boş görünür. */
        var secenek = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        var sozluk = JsonSerializer.SerializeToNode(ayar, secenek)?.AsObject();

        if (sozluk is null) return Ok(ayar);

        sozluk["turnstileSiteAnahtari"] = turnstile.SiteAnahtari;

        /* Form, SMS doğrulama adımını buna göre gösterir. Varsayılan
           kapalı; açmak için TelefonDogrulama:Acik = true yazılır.
           BasvuruController'daki koşulla aynı olmalı, yoksa form adımı
           gizlenirken sunucu kod istemeye devam eder. */
        /* Başvuru formunda SMS doğrulaması kaldırıldı; alan uyumluluk
           için duruyor ve her zaman false döner. */
        sozluk["telefonDogrulama"] = false;

        return Ok(sozluk);
    }

    /// <summary>
    /// Süzgeçte gösterilecek İK uzmanları.
    ///
    /// <para>
    /// İş emri atama ucundan ayrıdır: orası yalnızca atama yetkisi olan
    /// rollere açık ve uzmanlar 403 aldığı için süzgeç boş kalıyordu.
    /// Burada yalnızca ad ve kullanıcı adı döner; iletişim bilgisi yoktur.
    /// </para>
    /// </summary>
    [HttpGet("Uzmanlar")]
    [Authorize]
    public IActionResult Uzmanlar()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT kullanici_adi AS kod, ISNULL(ad_soyad, kullanici_adi) AS ad, rol
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN (N'IK', N'IKYoneticisi')
ORDER BY ad_soyad");

        return Ok(new { uzmanlar = liste });
    }

    [HttpGet("Form")]
    [Authorize]
    public IActionResult Form() => Ok(_ayar.FormOku());

    /// <summary>
    /// Form ayarlarını kaydeder.
    ///
    /// <para>
    /// Gövde tipli bir nesneye değil ham JSON'a bağlanıyor ve yalnızca
    /// gönderilen alanlar yazılıyor. Tipli bağlamada gönderilmeyen her alan
    /// varsayılanına düşüyordu ve bu "boş bırakıldı"dan ayırt edilemiyordu:
    /// Form Ayarları sekmesinden yapılan tek bir değişiklik, o ekranda hiç
    /// görünmeyen sol menü sırasını siliyordu.
    /// </para>
    /// </summary>
    [HttpPost("Form")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult FormKaydet([FromBody] System.Text.Json.JsonElement govde)
    {
        if (govde.ValueKind != System.Text.Json.JsonValueKind.Object)
            return BadRequest(new { hata = "Ayar bilgisi boş." });

        var girdi = _ayar.Birlestir("FORM", _ayar.FormOku(), govde);

        /* Bölge tanımı değiştiyse bölgesi olan tüm kullanıcıların yetkili
           şubeleri yeniden hesaplanır; böylece elle düzeltme gerekmez. */
        using var db = _vt.Baglanti();
        var guncellenen = 0;

        var bolgeliKullanicilar = db.Query<BolgeliKullanici>(@"
SELECT id AS Id, bolge AS Bolge
FROM KRY_KULLANICILAR
WHERE bolge IS NOT NULL AND LTRIM(RTRIM(bolge)) <> ''").ToList();

        foreach (var kullanici in bolgeliKullanicilar)
        {
            var subeMetni = string.Join(",",
                KullaniciController.BolgeSubeleri(kullanici.Bolge, girdi));

            guncellenen += db.Execute(
                "UPDATE KRY_KULLANICILAR SET subeler = @subeler WHERE id = @id",
                new { subeler = subeMetni, id = kullanici.Id });
        }

        /* Bölge → şube değişince mağaza müdürlerinin izin onaylayanı da değişir */
        PortalYetkiServisi.PanelBolgeMudurleriniUnut();
        IzinOnayKuralServisi.Unut();

        return Ok(new { basarili = true, guncellenenKullanici = guncellenen });
    }

    [HttpGet("Mail")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult Mail()
    {
        var ayar = _ayar.MailOku();
        ayar.Parola = string.IsNullOrEmpty(ayar.Parola) ? "" : "********";
        return Ok(ayar);
    }

    [HttpPost("Mail")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult MailKaydet([FromBody] MailAyarlari girdi)
    {
        if (girdi is null) return BadRequest(new { hata = "Ayar bilgisi boş." });

        // Parola alanı maskeli geldiyse mevcut parola korunur.
        if (girdi.Parola == "********")
            girdi.Parola = _ayar.MailOku().Parola;

        _ayar.Yaz("MAIL", girdi);
        return Ok(new { basarili = true });
    }

    [HttpPost("MailTest")]
    [Authorize(Roles = Roller.Admin)]
    public async Task<IActionResult> MailTest([FromBody] MailTestGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.Adres))
            return BadRequest(new { hata = "Test adresi giriniz." });

        var sonuc = await _mail.GonderAsync(
            new[] { girdi.Adres },
            "Biçen Kariyer - Test Maili",
            @"<p>Bu bir test mailidir. Mail ayarlarınız doğru çalışmaktadır.</p>
              <p style='color:#6B7280'>Biçen Market · İnsan Kaynakları</p>");

        return sonuc
            ? Ok(new { basarili = true })
            : BadRequest(new
            {
                hata = string.IsNullOrWhiteSpace(_mail.SonHataMesaji)
                    ? "Mail gönderilemedi. Sunucu ayarlarını kontrol ediniz."
                    : _mail.SonHataMesaji
            });
    }
}

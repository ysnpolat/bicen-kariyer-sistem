using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Panel girişi.
///
/// <para>
/// Kullanıcılar Kariyer sistemiyle ortak: aynı <c>KRY_KULLANICILAR</c>
/// tablosu, aynı kullanıcı adı ve parola. Ayrışan tek şey yetki — bu
/// paneldeki yetkiler <c>B360_YETKI</c> tablosunda tutuluyor ve İK
/// panelindeki yetkilerle hiçbir ilgisi yok.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class GirisController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly JwtServisi _jwt;
    private readonly YetkiServisi _yetki;
    private readonly ILogger<GirisController> _kayit;

    private readonly PanelKullaniciServisi _panelKullanici;

    public GirisController(VeritabaniServisi vt, JwtServisi jwt, YetkiServisi yetki,
                           PanelKullaniciServisi panelKullanici,
                           ILogger<GirisController> kayit)
    {
        _panelKullanici = panelKullanici;
        _vt = vt;
        _jwt = jwt;
        _yetki = yetki;
        _kayit = kayit;
    }

    /// <summary>Şube kullanıcısının şube adı; kilit yoksa null.</summary>
    private string SubeAdi(string kullaniciAdi)
    {
        var k = _panelKullanici.Getir(kullaniciAdi);

        return k.SubeKilitli ? (k.SubeAdi ?? k.SubeKodu) : null;
    }

    private string Adres() =>
        HttpContext.Connection.RemoteIpAddress?.ToString() ?? "bilinmiyor";

    [HttpPost]
    [AllowAnonymous]
    public IActionResult Giris([FromBody] GirisGirdi girdi)
    {
        /* Giriş uçundaki hatalar ayrıca yakalanıyor: burası sistemin ilk
           temas noktası ve çoğu kurulum sorunu (bağlantı, eksik tablo,
           yanlış ayar) ilk kez burada patlıyor. Genel 500 yerine sebebi
           söylemek, sunucu günlüğüne bakmadan çözülmesini sağlıyor. */
        try
        {
            return GirisYap(girdi);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Giriş başarısız");

            return StatusCode(500, new
            {
                hata = "Giriş yapılamadı.",
                ayrinti = hata.Message
            });
        }
    }

    private IActionResult GirisYap(GirisGirdi girdi)
    {
        var ip = Adres();

        if (GirisSinirlayici.KilitliMi(ip) is { } kalan)
            return BadRequest(new
            {
                hata = $"Çok fazla hatalı deneme. {(int)kalan.TotalMinutes + 1} dakika sonra tekrar deneyiniz."
            });

        var kullaniciAdi = (girdi?.KullaniciAdi ?? "").Trim();

        if (kullaniciAdi.Length == 0 || string.IsNullOrEmpty(girdi?.Parola))
            return BadRequest(new { hata = "Kullanıcı adı ve parola giriniz." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, kullanici_adi, ad_soyad, rol, parola_hash, parola_salt, aktif
FROM KRY_KULLANICILAR
WHERE kullanici_adi = @kullaniciAdi", new { kullaniciAdi });

        /* Kullanıcı yok ile parola yanlış aynı mesajı verir: farklı mesaj,
           hangi kullanıcı adlarının var olduğunu söyler. */
        if (kayit is null ||
            !ParolaServisi.Dogrula(girdi.Parola, (string)kayit.parola_hash, (string)kayit.parola_salt))
        {
            GirisSinirlayici.HataliDeneme(ip);
            return Unauthorized(new { hata = "Kullanıcı adı ya da parola hatalı." });
        }

        if (!(bool)kayit.aktif)
            return Unauthorized(new { hata = "Hesabınız kapalı. İnsan Kaynakları ile görüşünüz." });

        var rol = (string)kayit.rol;
        var ad = (string)kayit.kullanici_adi;

        /* Kariyer panelinde yetkili olmak buraya girmeye yetmez. Yetki
           panel bazında ayrı; kimseye kendiliğinden erişim açılmaz. */
        if (!_yetki.PanelAcik(ad, rol))
            return StatusCode(403, new
            {
                hata = "Bu panele erişim yetkiniz tanımlanmamış.",
                ayrinti = "Yetki Yönetimi ekranından bir yönetici tanımlamalı."
            });

        GirisSinirlayici.BasariliGiris(ip);

        var (jeton, bitis) = _jwt.Uret(new Kullanici
        {
            Id = (int)kayit.id,
            KullaniciAdi = ad,
            AdSoyad = (string)kayit.ad_soyad,
            Rol = rol
        });

        return Ok(new GirisCikti
        {
            Id = (int)kayit.id,
            Jeton = jeton,
            KullaniciAdi = ad,
            AdSoyad = (string)kayit.ad_soyad,
            Rol = rol,
            GecerlilikSonu = bitis,
            Sayfalar = _yetki.Sayfalari(ad, rol),
            Sube = SubeAdi(ad),
            PortalRol = YetkiServisi.Adminmi(rol) ? null : _yetki.PortalRolu(ad)?.Ad
        });
    }

    /// <summary>
    /// Oturum tazeleme.
    ///
    /// Panel açıkken yetkisi değiştirilen kullanıcının menüsü, çıkış
    /// yapmadan güncellensin diye var.
    /// </summary>
    [HttpGet("Ben")]
    [Authorize]
    public IActionResult Ben()
    {
        var ad = User.FindFirstValue(ClaimTypes.Name) ?? "";
        var rol = User.FindFirstValue(ClaimTypes.Role) ?? "";

        if (!_yetki.PanelAcik(ad, rol))
            return StatusCode(403, new { hata = "Erişim yetkiniz kaldırılmış." });

        return Ok(new
        {
            kullaniciAdi = ad,
            adSoyad = User.FindFirstValue("adSoyad") ?? "",
            rol,
            sayfalar = _yetki.Sayfalari(ad, rol),
            sube = SubeAdi(ad),
            portalRol = YetkiServisi.Adminmi(rol) ? null : _yetki.PortalRolu(ad)?.Ad
        });
    }
}

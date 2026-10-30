using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Duyuru videoları (12.10.2026).
///
/// <para>
/// İK panelinden duyuruya video yükleniyor; duyurunun "Bağlantı" alanı
/// videonun izleme sayfasıyla doluyor. Mobil uygulama (1.6 dahil) bağlantıyı
/// düğme olarak gösteriyor ve telefonun tarayıcısında açıyor: uygulama
/// güncellemesi gerekmiyor.
/// </para>
///
/// <para>
/// Yükleme 8 MB'lık parçalarla: IIS'te istek sınırı 20 MB ve videolar
/// bundan büyük. İzleme sayfası ve dosya giriş istemiyor (tarayıcı
/// uygulamanın oturumunu taşımıyor); adres 32 haneli rastgele anahtarla
/// tahmin edilemez. Gizli içerik için uygun değil.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DuyuruVideoController : ControllerBase
{
    private const int PARCA = VideoParca.Parca;
    private static Dictionary<string, string> Turler => VideoParca.Turler;

    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<DuyuruVideoController> _kayit;

    public DuyuruVideoController(IWebHostEnvironment ortam, IConfiguration yapilandirma,
        ILogger<DuyuruVideoController> kayit)
    {
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /// <summary>Yardım videolarıyla aynı kök: Belge:Klasor/duyuru-video</summary>
    private string Klasor() => VideoParca.Klasor(_yapilandirma, _ortam);

    /// <summary>Anahtarın tamamlanmış video dosyası; yoksa null.</summary>
    private string Bul(string anahtar) => VideoParca.Bul(Klasor(), anahtar);

    private string IzlemeAdresi(string anahtar)
    {
        /* Ayarla değiştirilebilir (ör. https://kariyer.bicen.com.tr/apiservis) */
        var kok = _yapilandirma["Duyuru:VideoAdresKoku"];
        if (string.IsNullOrWhiteSpace(kok))
            kok = $"{Request.Scheme}://{Request.Host}{Request.PathBase}";

        return $"{kok.TrimEnd('/')}/api/DuyuruVideo/Izle/{anahtar}";
    }

    /* ==================================================================== */
    /* Yükleme (panel)                                                      */
    /* ==================================================================== */

    /// <summary>
    /// Videonun bir parçası. İlk parçada (sira = 0) anahtar boş gelir ve
    /// sunucu üretir; sonrakiler aynı anahtarla sırayla gelir. Son parçada
    /// dosya tamamlanır ve izleme adresi döner.
    /// </summary>
    [HttpPost("Parca")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi)]
    [RequestSizeLimit(PARCA + 2 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = PARCA + 2 * 1024 * 1024)]
    public async Task<IActionResult> Parca(
        [FromForm] string anahtar, [FromForm] int sira, [FromForm] int toplam,
        [FromForm] string dosyaAdi, [FromForm] long boyut, IFormFile parca)
    {
        if (parca is null && Request.HasFormContentType)
            parca = Request.Form.Files.FirstOrDefault();

        var sonuc = await VideoParca.Yaz(Klasor(), anahtar, sira, toplam, dosyaAdi, boyut, parca, 0, 0, _kayit);
        if (!sonuc.Tamam) return StatusCode(sonuc.Kod, sonuc.Govde);
        anahtar = sonuc.Anahtar;

        _kayit.LogInformation("Duyuru videosu yüklendi: {Anahtar} {Ad} ({Boyut} bayt, {Kullanici})",
            anahtar, dosyaAdi, boyut, User?.Identity?.Name);

        return Ok(new { anahtar, tamam = true, izleAdresi = IzlemeAdresi(anahtar) });
    }

    /* ==================================================================== */
    /* İzleme (herkese açık, anahtarla)                                     */
    /* ==================================================================== */

    /// <summary>
    /// Telefonun tarayıcısında açılan sade izleme sayfası. Betik yok;
    /// yalnızca bu sunucudaki video oynayabilir.
    /// </summary>
    [HttpGet("Izle/{anahtar}")]
    [HttpGet("Oynat/{anahtar}")] // v1151 bağlantıları için takma ad
    [AllowAnonymous]
    public IActionResult Izle(string anahtar)
    {
        var yol = Bul(anahtar);

        Response.Headers["Content-Security-Policy"] =
            "default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:";
        Response.Headers["Cache-Control"] = "no-store";

        if (yol is null)
            return new ContentResult
            {
                StatusCode = 404,
                ContentType = "text/html; charset=utf-8",
                Content = Sayfa("<p class=\"yok\">Video bulunamadı ya da kaldırıldı.</p>"),
            };

        var tur = Turler[Path.GetExtension(yol)];
        var kaynak = $"../Dosya/{WebUtility.HtmlEncode(anahtar)}";

        return new ContentResult
        {
            ContentType = "text/html; charset=utf-8",
            Content = Sayfa(
                $"<video controls playsinline preload=\"metadata\"><source src=\"{kaynak}\" type=\"{tur}\">" +
                "Tarayıcınız bu videoyu oynatamıyor.</video>" +
                "<p class=\"not\">Ses için telefonunuzun sessiz modunu kapatınız.</p>"),
        };
    }

    private static string Sayfa(string govde) => $@"<!doctype html>
<html lang=""tr""><head><meta charset=""utf-8"">
<meta name=""viewport"" content=""width=device-width, initial-scale=1, viewport-fit=cover"">
<title>Biçen · Duyuru videosu</title>
<style>
  html,body{{margin:0;background:#111511;color:#f2f5ee;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}}
  main{{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;box-sizing:border-box}}
  .marka{{font-weight:800;letter-spacing:.04em;color:#7cb518}}
  video{{width:100%;max-width:960px;max-height:78vh;background:#000;border-radius:12px}}
  .not{{font-size:13px;color:#a9b3a0;margin:0;text-align:center}}
  .yok{{font-size:16px;text-align:center}}
</style></head>
<body><main><div class=""marka"">BİÇEN · DUYURU</div>{govde}</main></body></html>";

    /// <summary>Video dosyası; ileri sarma için parçalı okuma açık.</summary>
    [HttpGet("Dosya/{anahtar}")]
    [AllowAnonymous]
    public IActionResult Dosya(string anahtar)
    {
        var yol = Bul(anahtar);
        if (yol is null) return NotFound();

        return PhysicalFile(yol, Turler[Path.GetExtension(yol)], enableRangeProcessing: true);
    }
}

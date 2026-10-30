using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Mobil uygulamanın sayfa yardım videoları (29.09.2026).
///
/// <para>
/// Uygulamada her sayfanın başlığında küçük, hareketli bir çiçek ikonu
/// duruyor; dokununca o sayfanın nasıl kullanıldığını anlatan video
/// açılıyor. Video, sayfanın rota adıyla eşleşiyor (<c>Izin</c>,
/// <c>VardiyaPlani</c>…). Yöneticinin ekranı farklı olan sayfalarda ayrı
/// video var: <c>VardiyaPlani.yonetici</c>, <c>Ekibim.yonetici</c>.
/// </para>
///
/// <para>
/// İki kaynak var. Uygulamayla gelen hazır videolar
/// <c>wwwroot/yardim/{kod}.mp4</c> içinde; yayınla birlikte sunucuya
/// gidiyor. İK panelinden yüklenen video bunun yerine geçiyor ve
/// belge klasörünün <c>yardim-video</c> alt klasöründe tutuluyor (yayın
/// wwwroot'u yenilese de kaybolmuyor). Panelden bir sayfanın videosu
/// kapatılabiliyor; o sayfada ikon görünmüyor.
/// </para>
///
/// <para>
/// Veritabanı yok: durum dosyalardan okunuyor. Kapatma, klasördeki
/// <c>{kod}.kapali</c> işaret dosyası.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class YardimVideoController : ControllerBase
{
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<YardimVideoController> _kayit;

    public YardimVideoController(IWebHostEnvironment ortam, IConfiguration yapilandirma,
        ILogger<YardimVideoController> kayit)
    {
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /// <summary>Video eklenebilen sayfalar: mobil rota adı ve paneldeki adı.</summary>
    public static readonly (string Kod, string Ad)[] SAYFALAR =
    {
        ("AnaSayfa", "Ana sayfa"),
        ("Vardiya", "Vardiya · karekod ve manuel giriş-çıkış"),
        ("VardiyaPlani", "Vardiya Planı · personel"),
        ("VardiyaPlani.yonetici", "Vardiya Planı · mağaza müdürü"),
        ("Izin", "Yıllık İzin"),
        ("IzinOnay", "İzin Onayları"),
        ("Performans", "Performansım"),
        ("Duyurular", "Duyurular"),
        ("Ekibim", "Ekibim · personel"),
        ("Ekibim.yonetici", "Ekibim · mağaza müdürü"),
        ("Isler", "İşlerim"),
        ("Checklist", "Kontrol listesi"),
        ("Puantaj", "Puantaj çizelgesi"),
        ("Prim", "Prim"),
        ("Ariza", "Arıza kayıt"),
        ("Envanter", "Envanter"),
        ("FiyatKontrol", "Fiyat kontrol"),
        ("RakipFiyat", "Rakip fiyat"),
        ("Raporlar", "Raporlar"),
        ("Kunye", "Künye analizi"),
        ("EtikHat", "Etik Hat"),
        ("Avans", "Avanslarım"),
        ("Denklestirme", "Denkleştirme · form ve bakiye"),
        ("DenklestirmeOnay", "Denkleştirme onayı · yönetici"),
        ("EkipDegerlendirme", "Dönemsel değerlendirme · ekibini değerlendir"),
        ("Skt", "SKT kontrol"),
        ("Devamsizlik", "Devamsızlık girişi"),
        ("Mesajlar", "Mesajlar"),
        ("Hukuk", "Hukuk masası"),
    };

    private const long EN_BUYUK = 300L * 1024 * 1024;

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool Yetkili =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi or Roller.GenelMudurYardimcisi;

    private static bool GecerliKod(string kod) =>
        !string.IsNullOrWhiteSpace(kod) && SAYFALAR.Any(x => x.Kod == kod);

    /* --------------------------------------------------------- klasörler */

    /// <summary>Panelden yüklenenler: belge klasörü altında, yayından etkilenmez.</summary>
    private string YuklemeKlasoru()
    {
        var ayar = _yapilandirma["Belge:Klasor"];

        var kok = string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(
                string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
                    ? AppContext.BaseDirectory
                    : _ortam.ContentRootPath,
                "personel-belge")
            : ayar.Trim();

        return Path.Combine(kok, "yardim-video");
    }

    /// <summary>Uygulamayla gelen hazır videolar.</summary>
    private string HazirKlasor()
    {
        var web = string.IsNullOrWhiteSpace(_ortam.WebRootPath)
            ? Path.Combine(AppContext.BaseDirectory, "wwwroot")
            : _ortam.WebRootPath;

        return Path.Combine(web, "yardim");
    }

    private sealed record Durum(string Yol, string Kaynak, bool Kapali, long Boyut, DateTime Tarih);

    /// <summary>
    /// Uygulama sürümüne özel hazır video (06.10.2026): <c>{kod}@1.6.mp4</c>
    /// gibi. Telefonun sürümüne eşit ya da küçük en yüksek sürümlü dosya
    /// seçiliyor; yoksa sürümsüz video. Böylece 1.6'da gelen bir düğmeyi
    /// anlatan video, o düğmeyi henüz görmeyen 1.5 kullanıcısına gitmiyor.
    /// </summary>
    private string HazirYolu(string kod, string surum)
    {
        var duz = Path.Combine(HazirKlasor(), kod + ".mp4");

        if (!Version.TryParse((surum ?? "").Trim(), out var istemci)) return duz;

        try
        {
            var aday = Directory.EnumerateFiles(HazirKlasor(), kod + "@*.mp4")
                .Select(y => (Yol: y, Ek: Path.GetFileNameWithoutExtension(y)[(kod.Length + 1)..]))
                .Select(x => (x.Yol, Ok: Version.TryParse(x.Ek, out var v), V: v))
                .Where(x => x.Ok && x.V <= istemci)
                .OrderByDescending(x => x.V)
                .FirstOrDefault();

            return aday.Yol ?? duz;
        }
        catch
        {
            return duz;
        }
    }

    private Durum DurumOku(string kod, string surum = null)
    {
        var yuklenen = Path.Combine(YuklemeKlasoru(), kod + ".mp4");
        var hazir = HazirYolu(kod, surum);
        var kapali = System.IO.File.Exists(Path.Combine(YuklemeKlasoru(), kod + ".kapali"));

        string yol = null, kaynak = null;

        if (System.IO.File.Exists(yuklenen)) { yol = yuklenen; kaynak = "yuklenen"; }
        else if (System.IO.File.Exists(hazir)) { yol = hazir; kaynak = "hazir"; }

        if (yol is null) return new Durum(null, null, kapali, 0, DateTime.MinValue);

        var bilgi = new FileInfo(yol);

        return new Durum(yol, kaynak, kapali, bilgi.Length, bilgi.LastWriteTimeUtc);
    }

    /* ------------------------------------------------------------ mobil */

    /// <summary>
    /// Videosu olan sayfalar ve sürümleri. Sürüm dosyanın değişme anı:
    /// video yenilenince telefon eski kopyayı göstermesin.
    /// </summary>
    [HttpGet("Mobil")]
    public IActionResult Mobil()
    {
        var videolar = new Dictionary<string, long>();

        var danisman = User.IsInRole(HukukController.DanismanRolu);

        foreach (var (kod, _) in SAYFALAR)
        {
            /* Dış hukuk danışmanı yalnız Hukuk masası videosunu görür */
            if (danisman && kod != "Hukuk") continue;

            try
            {
                var d = DurumOku(kod, Request.Headers["X-Uygulama-Surum"].ToString());

                if (d.Yol is not null && !d.Kapali) videolar[kod] = d.Tarih.Ticks / TimeSpan.TicksPerSecond;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Yardım videosu okunamadı: {Kod}", kod);
            }
        }

        return Ok(new { videolar });
    }

    /// <summary>
    /// Video dosyası. Belirteç adres satırından da kabul ediliyor
    /// (Program.cs): telefondaki oynatıcı istek başlığı gönderemiyor.
    /// </summary>
    [HttpGet("Izle/{kod}")]
    public IActionResult Izle(string kod, [FromQuery] string s = null)
    {
        if (!GecerliKod(kod)) return NotFound(new { hata = "Sayfa bulunamadı." });

        /* s: uygulama sürümü (1.6 ve sonrası adrese ekliyor; oynatıcı başlık gönderemiyor) */
        var d = DurumOku(kod, s);

        if (d.Yol is null) return NotFound(new { hata = "Bu sayfanın videosu yok." });

        /* Telefon eski kopyayı saklamasın: her açılışta değişip değişmediği
           sorulur (değişmediyse 304, video yeniden inmez). */
        Response.Headers.CacheControl = "no-cache";

        /* Ileri sarma ve hızlı başlama için parça parça gönderim */
        return PhysicalFile(d.Yol, "video/mp4", enableRangeProcessing: true);
    }

    /* ------------------------------------------------------------ panel */

    [HttpGet]
    public IActionResult Liste()
    {
        if (!Yetkili) return Forbid();

        var sayfalar = SAYFALAR.Select(x =>
        {
            var d = DurumOku(x.Kod);

            return new
            {
                kod = x.Kod,
                ad = x.Ad,
                var = d.Yol is not null,
                kaynak = d.Kaynak,
                kapali = d.Kapali,
                boyut = d.Boyut,
                tarih = d.Yol is null ? (DateTime?)null : d.Tarih.ToLocalTime(),
            };
        }).ToList();

        return Ok(new { sayfalar });
    }

    /// <summary>Sayfanın videosunu yükler ya da değiştirir (yalnızca MP4).</summary>
    [HttpPost("{kod}")]
    [RequestSizeLimit(EN_BUYUK)]
    [RequestFormLimits(MultipartBodyLengthLimit = EN_BUYUK)]
    public async Task<IActionResult> Yukle(string kod, IFormFile dosya)
    {
        if (!Yetkili) return Forbid();

        if (!GecerliKod(kod)) return BadRequest(new { hata = "Geçersiz sayfa." });

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Video seçiniz." });

        if (!string.Equals(Path.GetExtension(dosya.FileName ?? ""), ".mp4", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { hata = "Yalnızca MP4 video yüklenebilir: iPhone ve Android ikisi de oynatabiliyor." });

        var klasor = YuklemeKlasoru();
        var hedef = Path.Combine(klasor, kod + ".mp4");
        var gecici = hedef + ".yukleniyor";

        try
        {
            Directory.CreateDirectory(klasor);

            /* Önce geçici dosyaya: yükleme yarıda kalırsa eski video bozulmasın */
            await using (var akis = new FileStream(gecici, FileMode.Create))
                await dosya.CopyToAsync(akis);

            System.IO.File.Move(gecici, hedef, overwrite: true);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Yardım videosu yazılamadı: {Klasor}", klasor);

            try { if (System.IO.File.Exists(gecici)) System.IO.File.Delete(gecici); } catch { }

            return StatusCode(500, new { hata = $"Video sunucuya yazılamadı ({klasor}). Klasöre yazma izni verilmeli." });
        }

        _kayit.LogInformation("Yardım videosu yüklendi: {Kod} ({Boyut} bayt, {Kullanici})",
            kod, dosya.Length, User?.Identity?.Name);

        return Ok(new { tamam = true });
    }

    /// <summary>Panelden yüklenen videoyu siler; varsa hazır videoya dönülür.</summary>
    [HttpDelete("{kod}")]
    public IActionResult Sil(string kod)
    {
        if (!Yetkili) return Forbid();

        if (!GecerliKod(kod)) return BadRequest(new { hata = "Geçersiz sayfa." });

        var yol = Path.Combine(YuklemeKlasoru(), kod + ".mp4");

        if (System.IO.File.Exists(yol)) System.IO.File.Delete(yol);

        return Ok(new { tamam = true });
    }

    public class DurumGirdi
    {
        public string Kod { get; set; }
        public bool Acik { get; set; }
    }

    /// <summary>Sayfanın videosunu uygulamada gösterir ya da gizler.</summary>
    [HttpPost("Durum")]
    public IActionResult DurumDegistir([FromBody] DurumGirdi g)
    {
        if (!Yetkili) return Forbid();

        if (!GecerliKod(g?.Kod)) return BadRequest(new { hata = "Geçersiz sayfa." });

        var klasor = YuklemeKlasoru();
        var isaret = Path.Combine(klasor, g.Kod + ".kapali");

        try
        {
            Directory.CreateDirectory(klasor);

            if (g.Acik)
            {
                if (System.IO.File.Exists(isaret)) System.IO.File.Delete(isaret);
            }
            else
            {
                System.IO.File.WriteAllText(isaret, DateTime.Now.ToString("O"));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Yardım videosu durumu yazılamadı: {Klasor}", klasor);

            return StatusCode(500, new { hata = $"Ayar yazılamadı ({klasor})." });
        }

        return Ok(new { tamam = true });
    }
}

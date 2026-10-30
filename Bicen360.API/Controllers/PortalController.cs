using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Karşılama sayfası ve portal görünüm ayarları.
///
/// <para>
/// Okuma uçları kimlik istemiyor: karşılama sayfası oturum açmadan
/// görünüyor ve logo, duyuru, iletişim bilgisi zaten herkese açık bilgi.
/// Yazma uçları yönetici yetkisi istiyor.
/// </para>
///
/// <para>
/// Ayarlar anahtar-değer olarak tutuluyor; her alan için sütun açmak,
/// sayfaya bir bölüm eklendiğinde veritabanı göçü gerektiriyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class PortalController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<PortalController> _kayit;

    public PortalController(
        VeritabaniServisi vt,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<PortalController> kayit)
    {
        _vt = vt;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool Duzenleyebilir => Rol is "Admin" or "IKYoneticisi" or "GenelMudurYardimcisi";

    /* ====================================================================== */
    /* Okuma — herkese açık                                                  */
    /* ====================================================================== */

    /// <summary>
    /// Karşılama sayfasının bütün içeriği.
    ///
    /// Tek istekte dönüyor: sayfa açılırken beş ayrı istek atmak, yavaş
    /// bağlantıda bölümlerin sırayla belirmesine yol açıyordu.
    /// </summary>
    [HttpGet("Icerik")]
    [AllowAnonymous]
    public IActionResult Icerik()
    {
        using var db = _vt.Baglanti();

        var ayarlar = Ayarlar(db);

        var gorseller = db.Query(@"
SELECT id, tur, baslik, aciklama, bag, sira
FROM B360_GORSEL WHERE aktif = 1 ORDER BY tur, sira, id").ToList();

        return Ok(new
        {
            baslik = Oku(ayarlar, "baslik", "Biçen360"),
            altBaslik = Oku(ayarlar, "altBaslik", "Biçen Market kurum içi yönetim sistemi"),
            kapakYazisi = Oku(ayarlar, "kapakYazisi", ""),

            /* Kapak ve logo tek görsel olduğu için ayrı uçtan değil
               doğrudan adresle veriliyor; sayfa açılırken istek sayısı
               azalıyor. */
            logo = TekGorsel(gorseller, "logo"),
            kapak = TekGorsel(gorseller, "kapak"),

            slaytlar = gorseller
                .Where(g => (string)g.tur == "slayt")
                .Select(g => new
                {
                    id = (int)g.id,
                    baslik = (string)g.baslik,
                    aciklama = (string)g.aciklama,
                    bag = (string)g.bag,
                    adres = $"/api/Portal/Gorsel/{(int)g.id}"
                }),

            duyurular = Coz(Oku(ayarlar, "duyurular", "[]")),
            ozellikler = Coz(Oku(ayarlar, "ozellikler", "[]")),

            iletisim = new
            {
                adres = Oku(ayarlar, "adres", ""),
                telefon = Oku(ayarlar, "telefon", ""),
                eposta = Oku(ayarlar, "eposta", ""),
                web = Oku(ayarlar, "web", ""),
                calismaSaati = Oku(ayarlar, "calismaSaati", "")
            },

            girisYazisi = Oku(ayarlar, "girisYazisi", ""),
            dipnot = Oku(ayarlar, "dipnot", "")
        });
    }

    /// <summary>
    /// Görseli döndürür.
    ///
    /// Kimlik istemiyor: logo ve kapak zaten karşılama sayfasında herkese
    /// görünüyor ve görsel etiketleri istek başlığı gönderemiyor.
    /// </summary>
    [HttpGet("Gorsel/{id:int}")]
    [AllowAnonymous]
    public IActionResult Gorsel(int id)
    {
        using var db = _vt.Baglanti();

        var dosyaAdi = db.ExecuteScalar<string>(
            "SELECT dosya FROM B360_GORSEL WHERE id = @id", new { id });

        if (string.IsNullOrWhiteSpace(dosyaAdi))
            return NotFound();

        if (dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest();

        /* Yükleme yedek klasöre düşmüş olabilir; ikisine de bakılıyor */
        var yol = Path.Combine(Klasor(), dosyaAdi);

        if (!System.IO.File.Exists(yol))
        {
            var yedek = Path.Combine(
                string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
                    ? AppContext.BaseDirectory
                    : _ortam.ContentRootPath,
                "portal-gorsel",
                dosyaAdi);

            if (!System.IO.File.Exists(yedek)) return NotFound();

            yol = yedek;
        }

        var tur = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            _ => "image/jpeg"
        };

        return PhysicalFile(yol, tur);
    }

    /* ====================================================================== */
    /* Yönetim                                                               */
    /* ====================================================================== */

    /// <summary>Ayarların ham hâli; yönetim ekranı bunu düzenliyor.</summary>
    [HttpGet("Ayarlar")]
    [Authorize]
    public IActionResult AyarlariGetir()
    {
        if (!Duzenleyebilir) return Forbid();

        using var db = _vt.Baglanti();

        var gorseller = db.Query(@"
SELECT id, tur, baslik, aciklama, bag, sira, aktif, ozgun_ad AS ozgunAd
FROM B360_GORSEL ORDER BY tur, sira, id").ToList();

        return Ok(new { ayarlar = Ayarlar(db), gorseller });
    }

    /// <summary>
    /// Ayarları yazar.
    ///
    /// Yalnızca gönderilen anahtarlar güncelleniyor: bütün ayarı yazmak,
    /// bir sekmeden kaydeden kullanıcının diğer sekmedeki değerleri
    /// silmesine yol açardı.
    /// </summary>
    [HttpPost("Ayarlar")]
    [Authorize]
    public IActionResult AyarlariYaz([FromBody] Dictionary<string, string> girdi)
    {
        if (!Duzenleyebilir) return Forbid();

        if (girdi is null || girdi.Count == 0)
            return BadRequest(new { hata = "Kaydedilecek ayar yok." });

        using var db = _vt.Baglanti();

        foreach (var (anahtar, deger) in girdi)
        {
            db.Execute(@"
MERGE B360_AYAR AS h
USING (SELECT @anahtar AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @deger, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger) VALUES (@anahtar, @deger);",
                new { anahtar, deger });
        }

        return Ok(new { basarili = true });
    }

    /// <summary>Görsel yükler.</summary>
    [HttpPost("Gorsel")]
    [Authorize]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> GorselYukle(
        [FromForm] string tur,
        [FromForm] string baslik,
        [FromForm] string aciklama,
        [FromForm] string bag,
        IFormFile dosya)
    {
        if (!Duzenleyebilir) return Forbid();

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Görsel seçilmedi." });

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        if (uzanti is not (".jpg" or ".jpeg" or ".png" or ".webp" or ".svg"))
            return BadRequest(new { hata = "JPG, PNG, WEBP ya da SVG yükleyiniz." });

        var hedefTur = (tur ?? "slayt").Trim().ToLowerInvariant();

        if (hedefTur is not ("logo" or "kapak" or "slayt" or "ozellik"))
            hedefTur = "slayt";

        var diskAdi = $"{hedefTur}_{Guid.NewGuid():N}{uzanti}";

        /* Önce yapılandırılan klasör, olmazsa uygulama klasörünün altı.
           Yapılandırılan yol yazılamadığında yükleme tamamen durmak yerine
           çalışan bir yere düşmeli; adresi yanıtta bildiriliyor ki
           yöneticinin hangi klasörün kullanıldığını bilmesi sağlansın. */
        var adaylar = new List<string> { Klasor() };

        var yedek = Path.Combine(
            string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
                ? AppContext.BaseDirectory
                : _ortam.ContentRootPath,
            "portal-gorsel");

        if (!adaylar.Contains(yedek)) adaylar.Add(yedek);

        string kullanilan = null;
        var hatalar = new List<string>();

        foreach (var klasor in adaylar)
        {
            try
            {
                if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

                await using (var akis = new FileStream(
                    Path.Combine(klasor, diskAdi), FileMode.Create))
                {
                    await dosya.CopyToAsync(akis);
                }

                kullanilan = klasor;
                break;
            }
            catch (Exception hata)
            {
                /* Gerçek istisna metni saklanıyor: 'izin verilmeli' diye
                   tahmin yürüten bir mesaj, sebebi izin olmayan durumlarda
                   saatlerce yanlış yere baktırıyordu. */
                _kayit.LogError(hata, "Portal görseli yazılamadı: {Klasor}", klasor);

                hatalar.Add($"{klasor} → {hata.GetType().Name}: {hata.Message}");

                /* Dosya yarım kalmış olabilir; sıradaki klasöre geçmeden
                   temizleniyor. */
                try
                {
                    var yarim = Path.Combine(klasor, diskAdi);

                    if (System.IO.File.Exists(yarim)) System.IO.File.Delete(yarim);
                }
                catch
                {
                    /* Temizlenemezse yapacak bir şey yok */
                }
            }
        }

        if (kullanilan is null)
            return StatusCode(500, new
            {
                hata = "Görsel sunucuya yazılamadı. " + string.Join(" | ", hatalar)
            });

        using var db = _vt.Baglanti();

        /* Logo ve kapak tek: yenisi yüklendiğinde eskisi pasife alınıyor.
           İki logo aynı anda aktif olduğunda hangisinin görüneceği
           rastgeleleşiyordu. */
        if (hedefTur is "logo" or "kapak")
            db.Execute("UPDATE B360_GORSEL SET aktif = 0 WHERE tur = @hedefTur",
                new { hedefTur });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_GORSEL (tur, dosya, ozgun_ad, baslik, aciklama, bag, sira)
OUTPUT INSERTED.id
VALUES (@hedefTur, @diskAdi, @ozgunAd, @baslik, @aciklama, @bag,
        (SELECT ISNULL(MAX(sira), 0) + 1 FROM B360_GORSEL WHERE tur = @hedefTur))",
            new
            {
                hedefTur,
                diskAdi,
                ozgunAd = dosya.FileName,
                baslik = string.IsNullOrWhiteSpace(baslik) ? null : baslik.Trim(),
                aciklama = string.IsNullOrWhiteSpace(aciklama) ? null : aciklama.Trim(),
                bag = string.IsNullOrWhiteSpace(bag) ? null : bag.Trim()
            });

        return Ok(new { id, adres = $"/api/Portal/Gorsel/{id}" });
    }

    [HttpDelete("Gorsel/{id:int}")]
    [Authorize]
    public IActionResult GorselSil(int id)
    {
        if (!Duzenleyebilir) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute("DELETE FROM B360_GORSEL WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Görsel bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    private static Dictionary<string, string> Ayarlar(System.Data.IDbConnection db)
    {
        try
        {
            return db.Query<(string anahtar, string deger)>(
                "SELECT anahtar, deger FROM B360_AYAR")
                .ToDictionary(x => x.anahtar, x => x.deger,
                    StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            /* Tablo henüz kurulmamışsa varsayılanlarla devam edilir */
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static string Oku(Dictionary<string, string> ayarlar, string anahtar, string varsayilan)
        => ayarlar.TryGetValue(anahtar, out var d) && !string.IsNullOrWhiteSpace(d)
            ? d : varsayilan;

    /// <summary>JSON metni olduğu gibi taşınıyor; ayrıştırma istemcide.</summary>
    private static object Coz(string ham)
    {
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<object>(ham) ?? new List<object>();
        }
        catch
        {
            return new List<object>();
        }
    }

    private static object TekGorsel(List<dynamic> gorseller, string tur)
    {
        var g = gorseller.FirstOrDefault(x => (string)x.tur == tur);

        return g is null ? null : new
        {
            id = (int)g.id,
            adres = $"/api/Portal/Gorsel/{(int)g.id}"
        };
    }

    private string Klasor()
    {
        var ayar = _yapilandirma["Portal:GorselKlasor"];

        if (!string.IsNullOrWhiteSpace(ayar)) return ayar.Trim();

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        return Path.Combine(kok, "portal-gorsel");
    }
}

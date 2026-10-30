using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Eğitim dokümanları.
///
/// <para>
/// İK ve Bilgi Teknolojileri personele video, belge ya da bağlantı
/// paylaşıyor. Bunlar şu ana kadar WhatsApp gruplarında dolaşıyordu: yeni
/// gelen personel hiçbirini görmüyor, eski paylaşımlar akışta kayboluyordu.
/// </para>
///
/// <para>
/// Hedef pozisyon boşsa herkese açık, doluysa yalnızca o ünvanlardakiler
/// görüyor — kasiyere depo eğitimi göstermek listeyi kullanışsız yapıyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class EgitimController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly BildirimServisi _bildirim;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<EgitimController> _kayit;

    public EgitimController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        BildirimServisi bildirim,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<EgitimController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _bildirim = bildirim;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>
    /// Paylaşım yetkisi.
    ///
    /// Bilgi Teknolojileri de paylaşım yapıyor ama panelde ayrı bir rolü
    /// yok; yönetici rolüyle giriyorlar.
    /// </summary>
    private bool Yetkili =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi
            or Roller.GenelMudurYardimcisi;

    private static readonly string[] IzinliUzantilar =
        { ".pdf", ".mp4", ".mov", ".jpg", ".jpeg", ".png", ".doc", ".docx",
          ".xls", ".xlsx", ".ppt", ".pptx" };

    /* ====================================================================== */
    /* Panel                                                                 */
    /* ====================================================================== */

    /// <summary>Tanımlı eğitimler ve okunma sayıları.</summary>
    [HttpGet]
    public IActionResult Listele()
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var egitimler = db.Query(@"
SELECT e.id, e.baslik, e.aciklama, e.tur, e.bolum, e.ozgun_ad AS ozgunAd,
       e.boyut, e.adres, e.pozisyonlar, e.zorunlu, e.aktif, e.sira,
       e.yukleyen, e.olusturma,
       (SELECT COUNT(*) FROM KRY_EGITIM_OKUMA o WHERE o.egitim_id = e.id) AS okuyan
FROM KRY_EGITIM e
ORDER BY e.sira, e.olusturma DESC").ToList();

        var pozisyonlar = new List<string>();

        try
        {
            pozisyonlar = _kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.Pozisyon))
                .Select(x => x.Pozisyon.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ünvan listesi alınamadı");
        }

        return Ok(new { egitimler, pozisyonlar });
    }

    /// <summary>Bir eğitimi kimlerin açtığı.</summary>
    [HttpGet("Okuyanlar/{id:int}")]
    public IActionResult Okuyanlar(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var okuyanlar = db.Query(@"
SELECT personel_kodu AS personelKodu, ad_soyad AS adSoyad, olusturma
FROM KRY_EGITIM_OKUMA WHERE egitim_id = @id ORDER BY olusturma DESC",
            new { id }).ToList();

        return Ok(new { okuyanlar });
    }

    /// <summary>
    /// Eğitim ekler. Dosya ya da bağlantı; ikisinden biri olmalı.
    /// </summary>
    [HttpPost]
    [RequestSizeLimit(524_288_000)]
    public async Task<IActionResult> Ekle(
        [FromForm] string baslik,
        [FromForm] string aciklama,
        [FromForm] string tur,
        [FromForm] string bolum,
        [FromForm] string adres,
        [FromForm] string pozisyonlar,
        [FromForm] bool zorunlu,
        IFormFile dosya)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(baslik))
            return BadRequest(new { hata = "Başlık giriniz." });

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        var baglanti = (adres ?? "").Trim();

        if (dosya is null && baglanti.Length == 0)
            return BadRequest(new
            {
                hata = "Dosya yükleyiniz ya da bir bağlantı adresi giriniz."
            });

        string diskAdi = null;

        if (dosya is not null)
        {
            var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

            if (!IzinliUzantilar.Contains(uzanti))
                return BadRequest(new
                {
                    hata = "Video, PDF, resim, Word, Excel ve sunum dosyaları yüklenebilir."
                });

            var klasor = Klasor();

            diskAdi = $"egitim_{Guid.NewGuid():N}{uzanti}";

            try
            {
                if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

                await using var akis = new FileStream(
                    Path.Combine(klasor, diskAdi), FileMode.Create);

                await dosya.CopyToAsync(akis);
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Eğitim dosyası yazılamadı: {Klasor}", klasor);

                return StatusCode(500, new
                {
                    hata = $"Dosya sunucuya yazılamadı ({klasor}). Klasöre yazma izni verilmeli."
                });
            }
        }

        using var db = _vt.Baglanti();

        var hedef = (pozisyonlar ?? "").Trim();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_EGITIM
    (baslik, aciklama, tur, bolum, dosya, ozgun_ad, boyut, adres,
     pozisyonlar, zorunlu, yukleyen)
OUTPUT INSERTED.id
VALUES (@baslik, @aciklama, @tur, @bolum, @diskAdi, @ozgunAd, @boyut, @adres,
        @hedef, @zorunlu, @yukleyen)",
            new
            {
                baslik = baslik.Trim(),
                aciklama = string.IsNullOrWhiteSpace(aciklama) ? null : aciklama.Trim(),
                tur = string.IsNullOrWhiteSpace(tur) ? "belge" : tur.Trim(),
                bolum = string.IsNullOrWhiteSpace(bolum) ? null : bolum.Trim(),
                diskAdi,
                ozgunAd = dosya?.FileName,
                boyut = dosya?.Length ?? 0,
                adres = baglanti.Length == 0 ? null : baglanti,
                hedef = hedef.Length == 0 ? null : hedef,
                zorunlu,
                yukleyen = Kullanici
            });

        /* Bildirim hedef kitleye: paylaşımın duyurulmaması, dokümanın
           WhatsApp'ta kalmasıyla aynı sonucu veriyordu. */
        await Duyur(baslik.Trim(), hedef);

        return Ok(new { id, tamam = true });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "UPDATE KRY_EGITIM SET aktif = 0 WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Eğitim bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */
    /* Mobil                                                                 */
    /* ====================================================================== */

    /// <summary>Personelin görebileceği eğitimler.</summary>
    [HttpGet("Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Benim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kod = (p.PersonelKodu ?? "").Trim();
        var hedef = PersonelKaynagiServisi.MeslekAnahtari(p.Pozisyon ?? "");

        var ham = db.Query(@"
SELECT e.id, e.baslik, e.aciklama, e.tur, e.bolum, e.ozgun_ad AS ozgunAd,
       e.boyut, e.adres, e.pozisyonlar, e.zorunlu, e.olusturma, e.dosya,
       CASE WHEN EXISTS (SELECT 1 FROM KRY_EGITIM_OKUMA o
                          WHERE o.egitim_id = e.id AND o.personel_kodu = @kod)
            THEN 1 ELSE 0 END AS okundu
FROM KRY_EGITIM e
WHERE e.aktif = 1
ORDER BY e.zorunlu DESC, e.sira, e.olusturma DESC",
            new { kod }).ToList();

        /* Pozisyon süzmesi sunucuda, SQL'de değil: ünvan eşleşmesi
           büyük/küçük harf ve Türkçe karakterden bağımsız yapılmalı ve
           aynı mantık sistemin başka yerlerinde de kullanılıyor. */
        var egitimler = ham
            .Where(e =>
            {
                var liste = ((string)e.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

                return liste.Length == 0 ||
                       liste.Any(x => PersonelKaynagiServisi.MeslekAnahtari(x) == hedef);
            })
            .Select(e => new
            {
                id = (int)e.id,
                baslik = (string)e.baslik,
                aciklama = (string)e.aciklama,
                tur = (string)e.tur,
                bolum = (string)e.bolum,
                ozgunAd = (string)e.ozgunAd,
                boyut = (long)e.boyut,

                /* Bağlantıysa adres doğrudan, dosyaysa açma ucu */
                acilis = string.IsNullOrWhiteSpace((string)e.dosya)
                    ? (string)e.adres
                    : null,

                dosyaVar = !string.IsNullOrWhiteSpace((string)e.dosya),
                zorunlu = (bool)e.zorunlu,
                okundu = (int)e.okundu == 1,
                olusturma = (DateTime)e.olusturma
            })
            .ToList();

        return Ok(new
        {
            egitimler,
            bekleyen = egitimler.Count(x => x.zorunlu && !x.okundu)
        });
    }

    /// <summary>
    /// Eğitim dosyasını açar ve okundu olarak işaretler.
    ///
    /// Belirteç adres satırından da kabul ediliyor (Program.cs): dosya
    /// telefonun tarayıcısında açılıyor ve o istek başlık taşıyamıyor.
    /// </summary>
    [HttpGet("Goster/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult Goster(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var egitim = db.QueryFirstOrDefault(
            "SELECT dosya, adres FROM KRY_EGITIM WHERE id = @id AND aktif = 1",
            new { id });

        if (egitim is null) return NotFound(new { hata = "Eğitim bulunamadı." });

        Okundu(db, id, p);

        var dosyaAdi = (string)egitim.dosya ?? "";

        if (dosyaAdi.Length == 0)
        {
            var adres = (string)egitim.adres;

            return string.IsNullOrWhiteSpace(adres)
                ? NotFound(new { hata = "Eğitim içeriği bulunamadı." })
                : Redirect(adres);
        }

        if (dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest(new { hata = "Geçersiz dosya adı." });

        var yol = DosyaYolu(dosyaAdi);

        if (yol is null)
            return NotFound(new
            {
                hata = "Eğitim dosyası sunucuda bulunamadı.",

                /* Aranan yerler yanıtta: dosyanın hangi klasörde
                   olduğunu bulmak başka türlü mümkün değildi. */
                ayrinti = "Aranan klasörler: "
                        + string.Join(", ", AdayKlasorler().Distinct())
            });

        var tur = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".mp4" => "video/mp4",
            ".mov" => "video/quicktime",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            _ => "application/octet-stream"
        };

        /* enableRangeProcessing: video ileri sarılabilsin; olmadan
           telefondaki oynatıcı dosyanın tamamını indirmeden başlamıyor. */
        return PhysicalFile(yol, tur, enableRangeProcessing: true);
    }

    /// <summary>Bağlantı türü eğitimlerde okundu işareti için.</summary>
    [HttpPost("Okundu/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult OkunduIsaretle(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        Okundu(db, id, p);

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    private static void Okundu(System.Data.IDbConnection db, int id, PersonelKaydi p)
    {
        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_EGITIM_OKUMA
               WHERE egitim_id = @id AND personel_kodu = @kod)
INSERT INTO KRY_EGITIM_OKUMA (egitim_id, personel_kodu, ad_soyad)
VALUES (@id, @kod, @ad)",
            new
            {
                id,
                kod = (p.PersonelKodu ?? "").Trim(),
                ad = $"{p.Ad} {p.Soyad}".Trim()
            });
    }

    private PersonelKaydi Kendisi()
    {
        /* Personel kodu ayrı bir hakta değil, kullanıcı adının içinde:
           "personel:14721|cihaz-abc". */
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return null;

        var kod = ad["personel:".Length..].Split('|')[0];

        try
        {
            return _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim() == kod.Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel bilgisi okunamadı");
            return null;
        }
    }

    /// <summary>Hedef kitleye bildirim gönderir.</summary>
    private async Task Duyur(string baslik, string hedefPozisyonlar)
    {
        try
        {
            var hedef = (hedefPozisyonlar ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(PersonelKaynagiServisi.MeslekAnahtari)
                .ToHashSet();

            var kisiler = _kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1)
                .Where(x => hedef.Count == 0 ||
                            hedef.Contains(PersonelKaynagiServisi.MeslekAnahtari(x.Pozisyon ?? "")))
                .ToList();

            foreach (var k in kisiler)
            {
                await _bildirim.Gonder(
                    (k.PersonelKodu ?? "").Trim(),
                    "Yeni eğitim dokümanı",
                    baslik,
                    "egitim");
            }
        }
        catch (Exception hata)
        {
            /* Bildirim gitmezse eğitim yine listede; duyuru ikincil */
            _kayit.LogWarning(hata, "Eğitim bildirimi gönderilemedi");
        }
    }

    /// <summary>Eğitim dosyalarının klasörü; belgelerle aynı ayardan.</summary>
    /// <summary>
    /// Eğitim dosyasının gerçek yolu.
    ///
    /// <para>
    /// Yapılandırmadaki klasör tek başına yetmiyor: Belge:Klasor ayarı
    /// sonradan eklendiyse daha önce yüklenen dosyalar uygulama
    /// klasöründe kalıyor ve yayınla birlikte silinmediyse orada
    /// duruyor. Bulunamayınca tek bir yere bakıp vazgeçmek, var olan
    /// dosyayı "yok" saymaya yol açıyordu.
    /// </para>
    /// </summary>
    private string DosyaYolu(string dosyaAdi)
    {
        foreach (var klasor in AdayKlasorler())
        {
            var yol = Path.Combine(klasor, dosyaAdi);

            if (System.IO.File.Exists(yol)) return yol;
        }

        return null;
    }

    /// <summary>Eğitim dosyalarının bulunabileceği klasörler, sırayla.</summary>
    private IEnumerable<string> AdayKlasorler()
    {
        yield return Klasor();

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        /* Ayar eklenmeden önce yüklenenler burada */
        yield return Path.Combine(kok, "personel-belge", "egitim");

        /* Alt klasör olmadan yazılmış olanlar */
        var ayar = _yapilandirma["Belge:Klasor"];

        if (!string.IsNullOrWhiteSpace(ayar)) yield return ayar.Trim();

        yield return Path.Combine(kok, "personel-belge");
    }

    private string Klasor()
    {
        var ayar = _yapilandirma["Belge:Klasor"];

        var kok = string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(
                string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
                    ? AppContext.BaseDirectory
                    : _ortam.ContentRootPath,
                "personel-belge")
            : ayar.Trim();

        return Path.Combine(kok, "egitim");
    }
}

using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Ücret pusulaları.
///
/// <para>
/// Her ay personele ayrı ayrı yükleniyor. Personel mobil uygulamadan açıp
/// onaylıyor ya da itiraz ediyor; onay imza yerine geçtiği için zamanı ve
/// nasıl onaylandığı kayda yazılıyor.
/// </para>
///
/// <para>
/// Yedi gün içinde işlem yapılmayan pusula onaylanmış sayılıyor
/// (<see cref="PusulaOtomatikGorevi"/>). Bu, personele yükleme anında
/// bildirilen bir kural; sessizce uygulanan bir varsayılan değil.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PusulaController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly BildirimServisi _bildirim;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<PusulaController> _kayit;

    public PusulaController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        BildirimServisi bildirim,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<PusulaController> kayit)
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

    /// <summary>Ücret bilgisi özlük verisi; bölge müdürü ve koordinatör göremez.</summary>
    private bool Yetkili =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi;

    /// <summary>Personelin işlem yapması için tanınan süre.</summary>
    public static int OnayGunu => Parametre.Sayi("pusula.onayGunu");

    /* ====================================================================== */

    /// <summary>Bir döneme ait pusulalar ve durumları.</summary>
    [HttpGet]
    public IActionResult Listele([FromQuery] string donem, [FromQuery] string ara)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        var pusulalar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, donem,
       ozgun_ad AS ozgunAd, boyut, durum, otomatik, son_gun AS sonGun,
       goruntuleme, onay_tarihi AS onayTarihi,
       itiraz_sebebi AS itirazSebebi, itiraz_metni AS itirazMetni,
       itiraz_tarihi AS itirazTarihi, itiraz_yanit AS itirazYanit,
       yukleyen, olusturma
FROM KRY_PUSULA
WHERE silindi = 0
  AND (@donem IS NULL OR donem = @donem)
  AND (@kalip IS NULL OR ad_soyad LIKE @kalip OR personel_kodu LIKE @kalip)
ORDER BY donem DESC, ad_soyad",
            new { donem = string.IsNullOrWhiteSpace(donem) ? null : donem.Trim(), kalip })
            .ToList();

        /* Hangi dönemlerin yüklendiği üst süzgeç için ayrıca veriliyor */
        var donemler = db.Query<string>(@"
SELECT DISTINCT donem FROM KRY_PUSULA WHERE silindi = 0 ORDER BY donem DESC")
            .ToList();

        return Ok(new
        {
            pusulalar,
            donemler,
            onayGunu = OnayGunu
        });
    }

    /// <summary>
    /// Pusula yükler.
    ///
    /// <para>
    /// Aynı personel ve döneme ikinci bir pusula yüklenirse eskisi
    /// gizleniyor: düzeltilmiş bordronun yanında eski hâlin durması,
    /// personelin hangisini onaylayacağını belirsiz bırakıyordu.
    /// </para>
    /// </summary>
    [HttpPost]
    [RequestSizeLimit(524_288_000)]
    public async Task<IActionResult> Yukle(
        [FromForm] string kod,
        [FromForm] string donem,
        IFormFile dosya)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel seçiniz." });

        if (string.IsNullOrWhiteSpace(donem) || donem.Trim().Length != 7)
            return BadRequest(new { hata = "Dönem 2026-09 biçiminde olmalıdır." });

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Dosya seçilmedi." });

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        /* Yalnızca PDF: pusulanın telefonda açılabilmesi ve yazdırılabilmesi
           gerekiyor, Word belgesi ikisini de zorlaştırıyor. */
        if (uzanti != ".pdf")
            return BadRequest(new { hata = "Ücret pusulası PDF olmalıdır." });

        var kisi = _kaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod.Trim(),
                StringComparison.OrdinalIgnoreCase));

        var klasor = Klasor();
        var diskAdi = $"pusula_{kod.Trim()}_{donem.Trim()}_{Guid.NewGuid():N}.pdf";

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);

            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Pusula yazılamadı: {Klasor}", klasor);

            return StatusCode(500, new
            {
                hata = $"Pusula sunucuya yazılamadı ({klasor}). Klasöre yazma izni verilmeli."
            });
        }

        using var db = _vt.Baglanti();

        /* Aynı dönemin eski pusulası gizleniyor */
        db.Execute(@"
UPDATE KRY_PUSULA SET silindi = 1
WHERE personel_kodu = @kod AND donem = @donem AND silindi = 0",
            new { kod = kod.Trim(), donem = donem.Trim() });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PUSULA
    (personel_kodu, kimlik_no, ad_soyad, donem, dosya, ozgun_ad, boyut,
     son_gun, yukleyen)
OUTPUT INSERTED.id
VALUES (@kod, @kimlik, @adSoyad, @donem, @diskAdi, @ozgunAd, @boyut,
        DATEADD(day, @gun, CAST(SYSDATETIME() AS DATE)), @yukleyen)",
            new
            {
                kod = kod.Trim(),
                kimlik = string.IsNullOrWhiteSpace(kisi?.KimlikNo) ? null : kisi.KimlikNo.Trim(),
                adSoyad = kisi is null ? null : $"{kisi.Ad} {kisi.Soyad}".Trim(),
                donem = donem.Trim(),
                diskAdi,
                ozgunAd = dosya.FileName,
                boyut = dosya.Length,
                gun = OnayGunu,
                yukleyen = Kullanici
            });

        /* Bildirim kayıttan sonra: gönderim başarısız olsa da pusula durmalı */
        await _bildirim.Gonder(
            kod.Trim(),
            "Ücret pusulanız hazır",
            $"{DonemAdi(donem)} dönemine ait ücret pusulanız yüklendi. "
            + $"{OnayGunu} gün içinde inceleyip onaylayınız.",
            "pusula");

        return Ok(new { id, tamam = true });
    }

    /// <summary>Pusulayı panelde açar.</summary>
    [HttpGet("Goster/{id:int}")]
    public IActionResult Goster(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var dosyaAdi = db.ExecuteScalar<string>(
            "SELECT dosya FROM KRY_PUSULA WHERE id = @id AND silindi = 0", new { id });

        if (string.IsNullOrWhiteSpace(dosyaAdi))
            return NotFound(new { hata = "Pusula bulunamadı." });

        if (dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest(new { hata = "Geçersiz dosya adı." });

        var yol = Path.Combine(Klasor(), dosyaAdi);

        if (!System.IO.File.Exists(yol))
            return NotFound(new { hata = "Pusula dosyası sunucuda bulunamadı." });

        return PhysicalFile(yol, "application/pdf");
    }

    /// <summary>
    /// İtiraza yanıt yazar ve pusulayı yeniden beklemeye alır.
    ///
    /// İtiraz kapandığında personelin yeniden onaylaması gerekiyor: İK'nın
    /// açıklamasını okumadan kaydın onaylanmış görünmesi, itirazın
    /// çözüldüğü anlamına gelmiyordu.
    /// </summary>
    [HttpPost("ItirazYanit/{id:int}")]
    public async Task<IActionResult> ItirazYanit(int id, [FromBody] YanitGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(girdi?.Yanit))
            return BadRequest(new { hata = "Yanıt yazınız." });

        using var db = _vt.Baglanti();

        var pusula = db.QueryFirstOrDefault(@"
SELECT personel_kodu AS personelKodu, donem FROM KRY_PUSULA
WHERE id = @id AND silindi = 0", new { id });

        if (pusula is null) return NotFound(new { hata = "Pusula bulunamadı." });

        db.Execute(@"
UPDATE KRY_PUSULA
SET itiraz_yanit = @yanit,
    durum = N'bekliyor',
    son_gun = DATEADD(day, @gun, CAST(SYSDATETIME() AS DATE))
WHERE id = @id",
            new { id, yanit = girdi.Yanit.Trim(), gun = OnayGunu });

        await _bildirim.Gonder(
            (string)pusula.personelKodu,
            "İtirazınız yanıtlandı",
            $"{DonemAdi((string)pusula.donem)} pusulanıza ilişkin itirazınız "
            + "yanıtlandı. Uygulamadan inceleyebilirsiniz.",
            "pusula");

        return Ok(new { basarili = true });
    }

    /// <summary>Pusulayı kaldırır; dosya diskte kalır.</summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (Rol is not (Roller.Admin or Roller.IKYoneticisi)) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "UPDATE KRY_PUSULA SET silindi = 1 WHERE id = @id AND silindi = 0", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Pusula bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    /// <summary>"2026-09" → "Eylül 2026"</summary>
    public static string DonemAdi(string donem)
    {
        if (string.IsNullOrWhiteSpace(donem)) return "";

        return DateTime.TryParse($"{donem.Trim()}-01", out var t)
            ? t.ToString("MMMM yyyy", new System.Globalization.CultureInfo("tr-TR"))
            : donem;
    }

    /// <summary>
    /// Pusulaların durduğu klasör; belgelerle aynı ayardan türetiliyor.
    /// </summary>
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

        return Path.Combine(kok, "pusula");
    }
}

/// <summary>İtiraza yazılan yanıt.</summary>
public class YanitGirdi
{
    public string Yanit { get; set; }
}

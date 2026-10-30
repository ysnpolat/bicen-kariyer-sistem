using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yenilikler penceresinin "okundu" bilgisi.
///
/// <para>
/// Yenilik listesi veritabanında değil, panel kodunun içinde
/// (<c>bicen-kariyer-ik/src/yenilikler/</c>); her kayıt bir numara taşır.
/// Sunucuda kişi başına yalnızca okunan en büyük numara tutulur. Panel
/// girişte bu numarayı alır; kendi listesinde bundan büyük ve kullanıcının
/// yetkisine giren kayıt varsa pencereyi kendiliğinden açar.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class YeniliklerController : ControllerBase
{
    private const string Anahtar = "Yenilikler.SonOkunan";

    private readonly VeritabaniServisi _vt;

    public YeniliklerController(VeritabaniServisi vt) => _vt = vt;

    private string Kullanici => User.Identity?.Name ?? "";

    /// <summary>Kullanıcının okuduğu son yenilik numarası; hiç okumadıysa null.</summary>
    [HttpGet("Okunan")]
    public IActionResult Okunan()
    {
        using var db = _vt.Baglanti();

        var deger = db.ExecuteScalar<string>(
            "SELECT deger FROM KRY_KULLANICI_TERCIH WHERE kullanici = @k AND anahtar = @a",
            new { k = Kullanici, a = Anahtar });

        return Ok(new { no = long.TryParse(deger, out var no) ? no : (long?)null });
    }

    public sealed class OkunanGirdi
    {
        public long No { get; set; }
    }

    /// <summary>
    /// Okunan numarayı yazar. Numara yalnızca ileri gider: eski bir sekme
    /// daha küçük bir numara gönderirse yok sayılır.
    /// </summary>
    [HttpPut("Okunan")]
    public IActionResult OkunanYaz([FromBody] OkunanGirdi girdi)
    {
        if (girdi is null || girdi.No <= 0) return BadRequest(new { hata = "Numara gerekli." });

        /* Başka bir kullanıcı adına açılmış oturumda (taklit) o kişinin
           okundu bilgisi değiştirilmez. */
        if (User.FindFirst("taklitEden") is not null) return Ok(new { tamam = true, atlandi = true });

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_KULLANICI_TERCIH AS h
USING (SELECT @k AS kullanici, @a AS anahtar) AS y
   ON h.kullanici = y.kullanici AND h.anahtar = y.anahtar
WHEN MATCHED AND TRY_CAST(h.deger AS BIGINT) < @no THEN
    UPDATE SET deger = @deger, degisim = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (kullanici, anahtar, deger) VALUES (@k, @a, @deger);",
            new { k = Kullanici, a = Anahtar, no = girdi.No, deger = girdi.No.ToString() });

        return Ok(new { tamam = true });
    }
}

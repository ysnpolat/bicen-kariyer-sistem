using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İşe Al penceresindeki "Mikro'da sicil kartını aç" bölümü ve başvuru
/// kartındaki durum (09.10.2026). Kart yalnızca MikroDesktop_2004BICEN'e
/// açılır; MikroDesktop_BICEN (RSM) salt okunur. Bkz. <see cref="MikroSicilServisi"/>.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class MikroSicilController : ControllerBase
{
    private readonly MikroSicilServisi _sicil;
    private readonly YetkiServisi _yetki;
    private readonly AyarServisi _ayar;
    private readonly VeritabaniServisi _vt;

    public MikroSicilController(MikroSicilServisi sicil, YetkiServisi yetki, AyarServisi ayar, VeritabaniServisi vt)
    {
        _sicil = sicil;
        _yetki = yetki;
        _ayar = ayar;
        _vt = vt;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private bool Yetkili => PersonelMikroController.Duzenleyebilir(Rol, _yetki);

    private IActionResult Yanit(MikroSicilServisi.Sonuc s) =>
        s.Basarili ? Ok(new { mesaj = s.Mesaj, veri = s.Veri }) : StatusCode(s.Durum, new { hata = s.Mesaj });

    /// <summary>Form: başvurudan ön doldurma, Mikro iş grupları ve ünvanları, tahmini sicil no</summary>
    [HttpGet("Hazirla/{basvuruId:int}")]
    public IActionResult Hazirla(int basvuruId)
    {
        if (!Yetkili) return StatusCode(403, new { hata = "Mikro'da sicil açma yetkiniz yok." });

        var personelAyar = _ayar.PersonelOku();
        var birimler = _ayar.FormOku().Subeler ?? new List<Sube>();

        return Yanit(_sicil.Hazirla(basvuruId, Kullanici, birimler,
            unvan => PersonelKaynagiServisi.UnvanKarsiligi(personelAyar, unvan)));
    }

    /// <summary>Başvurunun Mikro sicil isteği</summary>
    [HttpGet("Durum/{basvuruId:int}")]
    public IActionResult Durum(int basvuruId) => Ok(new { kayit = _sicil.Durum(basvuruId) });

    /// <summary>
    /// Yeniden dene / şimdi aç: yalnızca işe alımı onaylanmış başvuruda
    /// (onaysız kart açılmaz).
    /// </summary>
    [HttpPost("{basvuruId:int}/Ac")]
    public IActionResult Ac(int basvuruId)
    {
        if (!Yetkili) return StatusCode(403, new { hata = "Mikro'da sicil açma yetkiniz yok." });

        using (var db = _vt.Baglanti())
        {
            var durum = db.ExecuteScalar<string>("SELECT durum FROM KRY_BASVURULAR WHERE id = @basvuruId", new { basvuruId });
            if (durum is null) return NotFound(new { hata = "Başvuru bulunamadı." });

            if (durum != Durumlar.IseAlindi)
                return BadRequest(new { hata = "Kart, işe alım onaylandıktan sonra açılır." });
        }

        var ad = User?.FindFirst("adSoyad")?.Value;
        return Yanit(_sicil.Ac(basvuruId, string.IsNullOrWhiteSpace(ad) ? Kullanici : $"{ad} ({Kullanici})"));
    }

    /// <summary>Bekleyen ya da hatalı isteği kapatır (kart elle açılacaksa)</summary>
    [HttpPost("{basvuruId:int}/Iptal")]
    public IActionResult Iptal(int basvuruId)
    {
        if (!Yetkili) return StatusCode(403, new { hata = "Yetkiniz yok." });

        using var db = _vt.Baglanti();
        _sicil.Kapat(db, basvuruId, $"Vazgeçildi · {Kullanici}");

        return Ok(new { mesaj = "Mikro sicil isteği kapatıldı.", kayit = _sicil.Durum(basvuruId) });
    }
}

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Kart geçiş sisteminden vardiya tablosuna aktarım.
///
/// Geçmiş veri için elle çalıştırılıyor; günlük aktarım gece kendiliğinden
/// yapılıyor (KartGecisGorevi).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
public class KartGecisController : ControllerBase
{
    private readonly KartGecisAktarimServisi _aktarim;

    public KartGecisController(KartGecisAktarimServisi aktarim)
    {
        _aktarim = aktarim;
    }

    public class AktarGirdi
    {
        public DateTime Baslangic { get; set; }
        public DateTime Bitis { get; set; }

        /// <summary>Aralıktaki kart kayıtları silinip baştan aktarılsın mı.</summary>
        public bool Temizle { get; set; }
    }

    /// <summary>
    /// Verilen aralığı aktarır. Toplu kopyalama sayesinde bir yıla kadar
    /// tek seferde alınabiliyor; daha uzunu yıl yıl çalıştırılıyor.
    /// </summary>
    [HttpPost("Aktar")]
    public IActionResult Aktar([FromBody] AktarGirdi g)
    {
        if (g is null || g.Baslangic == default || g.Bitis == default)
            return BadRequest(new { hata = "Başlangıç ve bitiş tarihi giriniz." });

        if ((g.Bitis.Date - g.Baslangic.Date).TotalDays > 366)
            return BadRequest(new { hata = "Tek seferde en fazla bir yıl aktarılabilir. Yıl yıl çalıştırınız." });

        var s = _aktarim.Aktar(g.Baslangic, g.Bitis, g.Temizle);

        return Ok(new
        {
            basarili = true,
            okunan = s.Okunan,
            eklenen = s.Eklenen,
            zatenVardi = s.Mevcut,
            mobilCakismasi = s.MobilCakismasi,
            eslesmeyenKisi = s.EslesmeyenKisi,
            yonSutunu = s.YonSutunu,
            saatSutunu = s.SaatSutunu,
            sutunlar = s.Sutunlar,
            silinen = s.Silinen,
            eslesmeyenKimlikler = s.EslesmeyenKimlikler,
        });
    }
}

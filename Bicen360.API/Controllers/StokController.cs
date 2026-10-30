using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Bicen360.API.Servisler;

namespace Bicen360.API.Controllers;

/// <summary>
/// Stok yönetimi uçları: sipariş önerisi, sipariş takibi, şubeler arası
/// transfer, raf denetimi, depo durumu, fire analizi ve stok kartı.
///
/// <para>
/// Hepsi salt görüntüleme. Portal veriyi hesaplayıp gösteriyor; sipariş,
/// transfer ve stok düzeltme işlemleri Mikro'da yapılıyor.
/// </para>
///
/// <para>
/// Sorgular ağır olduğu için sonuçlar depo bazında önbellekte tutuluyor;
/// <c>yenile=true</c> ile atlanıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class StokController : ControllerBase
{
    private readonly StokServisi _stok;
    private readonly ILogger<StokController> _kayit;

    public StokController(StokServisi stok, ILogger<StokController> kayit)
    {
        _stok = stok;
        _kayit = kayit;
    }

    /// <summary>Hata mesajını kullanıcıya anlaşılır biçimde döndürür.</summary>
    private IActionResult Calistir(string ad, Func<object> is_)
    {
        try
        {
            return Ok(is_());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Stok sorgusu başarısız: {Ad}", ad);

            return StatusCode(500, new
            {
                hata = "Veri alınamadı.",
                ayrinti = hata.Message.Length > 300 ? hata.Message[..300] : hata.Message,
            });
        }
    }

    [HttpGet("Depolar")]
    public IActionResult Depolar([FromQuery] bool yenile = false) =>
        Calistir("Depolar", () => new
        {
            depolar = _stok.Depolar(yenile).Select(d => new { no = d.No, ad = d.Ad, subeKodu = d.SubeKodu }),
            pusulaDepolari = _stok.Pusula().Depolar,
        });

    [HttpGet("SiparisOnerisi")]
    public IActionResult SiparisOnerisi([FromQuery] int depo, [FromQuery] bool yenile = false) =>
        Calistir("SiparisOnerisi", () => new
        {
            kayitlar = _stok.SiparisOnerisi(depo, yenile),
            hesap = _stok.SonHesap($"oneri:{depo}"),
        });

    [HttpGet("SiparisTakibi")]
    public IActionResult SiparisTakibi([FromQuery] int depo, [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit) =>
        Calistir("SiparisTakibi", () => new
        {
            kayitlar = _stok.SiparisTakibi(depo, bas ?? DateTime.Today.AddDays(-7), bit ?? DateTime.Today),
        });

    [HttpGet("MalGirisleri")]
    public IActionResult MalGirisleri([FromQuery] int depo, [FromQuery] int gun = 3) =>
        Calistir("MalGirisleri", () => new { kayitlar = _stok.MalGirisleri(depo, gun) });

    [HttpGet("Transfer")]
    public IActionResult Transfer([FromQuery] int depo, [FromQuery] string yon = "gelen",
        [FromQuery] bool yenile = false) =>
        Calistir("Transfer", () => new
        {
            kayitlar = _stok.Transfer(depo, yon == "veren" ? "veren" : "gelen", yenile),
            hesap = _stok.SonHesap($"transfer:{depo}:{yon}"),
        });

    [HttpGet("RafDenetimi")]
    public IActionResult RafDenetimi([FromQuery] int depo, [FromQuery] bool yenile = false) =>
        Calistir("RafDenetimi", () => new
        {
            kayitlar = _stok.RafDenetimi(depo, yenile),
            hesap = _stok.SonHesap($"raf:{depo}"),
        });

    [HttpGet("DepoDurum")]
    public IActionResult DepoDurum([FromQuery] int depo, [FromQuery] bool yenile = false) =>
        Calistir("DepoDurum", () => new
        {
            kayitlar = _stok.DepoDurum(depo, yenile),
            hesap = _stok.SonHesap($"depo:{depo}"),
        });

    [HttpGet("Fire")]
    public IActionResult Fire([FromQuery] int depo, [FromQuery] int? yil,
        [FromQuery] bool yenile = false) =>
        Calistir("Fire", () => new
        {
            kayitlar = _stok.Fire(depo, yil ?? DateTime.Today.Year, yenile),
            hesap = _stok.SonHesap($"fire:{depo}:{yil ?? DateTime.Today.Year}"),
        });

    [HttpGet("FireDetay")]
    public IActionResult FireDetay([FromQuery] string stok, [FromQuery] int depo, [FromQuery] int? yil)
    {
        if (string.IsNullOrWhiteSpace(stok)) return BadRequest(new { hata = "Stok kodu giriniz." });

        return Calistir("FireDetay",
            () => new { hareketler = _stok.FireDetay(stok, depo, yil ?? DateTime.Today.Year) });
    }

    [HttpGet("StokKarti")]
    public IActionResult StokKarti([FromQuery] string stok, [FromQuery] int depo)
    {
        if (string.IsNullOrWhiteSpace(stok)) return BadRequest(new { hata = "Stok kodu giriniz." });

        return Calistir("StokKarti", () => new { hareketler = _stok.StokKarti(stok, depo) });
    }

    /// <summary>
    /// Pano: modüllerin özeti. Her biri kendi önbelleğinden okunuyor,
    /// bu yüzden pano açılışı yeni sorgu çalıştırmıyor.
    /// </summary>
    /// <summary>
    /// Pano özeti.
    ///
    /// <para>
    /// Panoyu açmak dört ağır sorguyu birden çalıştırmıyor: hangi
    /// bölümün isteneceği <c>bolum</c> ile veriliyor ve ekran bunları
    /// paralel çağırıyor. Böylece kartlar geldikçe doluyor, kullanıcı
    /// hepsinin bitmesini beklemiyor.
    /// </para>
    /// </summary>
    [HttpGet("Pano")]
    public IActionResult Pano([FromQuery] int depo, [FromQuery] string bolum = "hepsi") =>
        Calistir("Pano", () =>
    {
        var oneri = bolum is "hepsi" or "oneri" ? _stok.SiparisOnerisi(depo) : new List<dynamic>();
        var durum = bolum is "hepsi" or "depo" ? _stok.DepoDurum(depo) : new List<dynamic>();
        var raf = bolum is "hepsi" or "raf" ? _stok.RafDenetimi(depo) : new List<dynamic>();
        var transfer = bolum is "hepsi" or "transfer" ? _stok.Transfer(depo) : new List<dynamic>();

        decimal S(dynamic d, string ad)
        {
            var s = (IDictionary<string, object>)d;
            return s.TryGetValue(ad, out var v) && v is not null
                ? Convert.ToDecimal(v) : 0m;
        }

        string M(dynamic d, string ad)
        {
            var s = (IDictionary<string, object>)d;
            return s.TryGetValue(ad, out var v) ? Convert.ToString(v) ?? "" : "";
        }

        return new
        {
            oneri = new
            {
                toplam = oneri.Count,
                yokSatma = oneri.Count(x => S(x, "sdg") <= 3),
                merkezYok = oneri.Count(x => M(x, "durum") == "SATICIDAN SİPARİŞ"),
                depodan = oneri.Count(x => M(x, "durum") == "DEPODAN SİPARİŞ"),
                yavas = oneri.Count(x => M(x, "durum") is "ÇOK YAVAŞ SATIYOR" or "ÜRÜN HİÇ SATMIYOR"),
                tutar = Math.Round(oneri.Sum(x => S(x, "oneri") * S(x, "fiyat")), 0),

                /* Grafik için: en çok öneri çıkan ilk altı reyon */
                reyonlar = oneri
                    .GroupBy(x => M(x, "anaGrup"))
                    .Where(g => !string.IsNullOrWhiteSpace(g.Key))
                    .Select(g => new { ad = g.Key, adet = g.Count() })
                    .OrderByDescending(x => x.adet)
                    .Take(6)
                    .ToList(),
            },
            depo = new
            {
                kalem = durum.Count,
                deger = Math.Round(durum.Sum(x => S(x, "stok") * S(x, "fiyat")), 0),
                eksi = durum.Count(x => S(x, "stok") < 0),
                hareketsiz = durum.Count(x => S(x, "hareketsizGun") >= 90),
                oluDeger = Math.Round(durum.Where(x => S(x, "hareketsizGun") >= 90)
                                           .Sum(x => S(x, "stok") * S(x, "fiyat")), 0),
            },
            raf = new { toplam = raf.Count },
            transfer = new { toplam = transfer.Count },
            hesap = _stok.SonHesap($"oneri:{depo}"),
        };
    });
}

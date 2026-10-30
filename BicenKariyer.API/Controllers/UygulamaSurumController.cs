using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen360 sürümleri (08.10.2026).
///
/// <para>
/// İK paneli › Yönetim › Uygulama sürümleri: personelin hangi sürümü
/// kullandığı, güncel sürümden eski olanlar ve elle hatırlatma. Mobil uç
/// 1.7 ve sonrasının açılışta sorduğu güncel ve en düşük sürüm.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UygulamaSurumController : ControllerBase
{
    private const string PanelRolleri =
        Roller.Admin + "," + Roller.IK + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi;

    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;

    public UygulamaSurumController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
    }

    private string PanelAdi =>
        User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    private static string Guncel => UygulamaSurumu.Normal(Parametre.Metin("uygulama.guncelSurum"));

    /// <summary>Uygulama açılışı (1.7+): güncel ve en düşük sürüm</summary>
    [HttpGet("Mobil")]
    [AllowAnonymous]
    public IActionResult Mobil() => Ok(new
    {
        guncel = Guncel,
        enDusuk = UygulamaSurumu.Normal(Parametre.Metin("uygulama.enDusukSurum")),
        link = UygulamaSurumu.Link,
        baslik = "Yeni sürüm yayında",
        mesaj = "Biçen360'ın yeni sürümü mağazada. Yeni özellikleri kullanabilmek için uygulamayı güncelleyin.",
    });

    /// <summary>Panel: aktif personelin sürümleri</summary>
    [HttpGet]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Liste()
    {
        var guncel = Guncel;
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT personel_kodu AS kod, surum, platform, son_gorulme AS son, surum_degisim AS degisim,
       hatirlatma_hedef AS hedef, hatirlatma_sayi AS sayi, son_hatirlatma AS sonHatirlatma
FROM KRY_UYGULAMA_SURUM")
            .GroupBy(x => OkutmaBeklenmez.K((string)x.kod), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => (DateTime)x.son).First(),
                StringComparer.OrdinalIgnoreCase);

        var otuzGun = DateTime.Now.AddDays(-30);

        var kisiler = _ekip.Aktifler()
            .Select(p =>
            {
                kayitlar.TryGetValue(OkutmaBeklenmez.K(p.PersonelKodu), out var k);
                string surum = k is null ? null : (string)k.surum ?? "";
                var aktif = k is not null && (DateTime)k.son >= otuzGun;

                return new
                {
                    sicil = p.PersonelKodu.Trim(),
                    adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                    sube = p.IsGrubu?.Trim(),
                    pozisyon = p.Pozisyon,
                    /* null: hiç açmamış · "": 1.5 ya da öncesi */
                    surum,
                    surumAdi = surum is null ? "Kullanmıyor" : surum.Length == 0 ? UygulamaSurumu.Eski : surum,
                    platform = (string)k?.platform,
                    sonGorulme = (DateTime?)k?.son,
                    aktif,
                    eski = surum is not null && UygulamaSurumu.Eskimi(surum, guncel),
                    hatirlatma = (string)k?.hedef == guncel ? (int)k.sayi : 0,
                    sonHatirlatma = (string)k?.hedef == guncel ? (DateTime?)k.sonHatirlatma : null,
                };
            })
            .OrderBy(x => x.surum is null ? 2 : x.eski ? 0 : 1)
            .ThenBy(x => x.sube)
            .ThenBy(x => x.adSoyad)
            .ToList();

        var kullanan = kisiler.Where(x => x.surum is not null).ToList();

        return Ok(new
        {
            guncel,
            hatirlatmaAcik = Parametre.Acik("uygulama.hatirlatma"),
            toplam = kisiler.Count,
            kullanan = kullanan.Count,
            guncelde = kullanan.Count(x => !x.eski),
            eski = kullanan.Count(x => x.eski),
            kullanmiyor = kisiler.Count - kullanan.Count,
            surumler = kullanan
                .GroupBy(x => x.surumAdi)
                .Select(g => new { surum = g.Key, sayi = g.Count(), eski = g.First().eski })
                .OrderByDescending(x => x.surum == UygulamaSurumu.Eski ? "0" : x.surum)
                .ToList(),
            kisiler,
        });
    }

    public class HatirlatGirdi
    {
        public List<string> Siciller { get; set; }
    }

    /// <summary>Panel: seçilenlere (ya da eski sürümdeki herkese) hemen hatırlatma</summary>
    [HttpPost("Hatirlat")]
    [Authorize(Roles = PanelRolleri)]
    public async Task<IActionResult> Hatirlat([FromBody] HatirlatGirdi g)
    {
        var guncel = Guncel;
        if (guncel.Length == 0) return BadRequest(new { hata = "Ayarlar Merkezi'nde güncel sürüm tanımlı değil." });

        using var db = _vt.Baglanti();

        var secili = (g?.Siciller ?? new List<string>())
            .Select(OkutmaBeklenmez.K)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var aktif = _ekip.Aktifler()
            .Select(x => OkutmaBeklenmez.K(x.PersonelKodu))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var hedefler = db.Query("SELECT personel_kodu AS kod, surum FROM KRY_UYGULAMA_SURUM")
            .Where(x => UygulamaSurumu.Eskimi((string)x.surum, guncel))
            .Select(x => ((string)x.kod).Trim())
            .Where(k => aktif.Contains(OkutmaBeklenmez.K(k)))
            .Where(k => secili.Count == 0 || secili.Contains(OkutmaBeklenmez.K(k)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var gonderilen = 0;
        foreach (var kod in hedefler)
        {
            try
            {
                await UygulamaSurumu.Hatirlat(db, _bildirim, kod, guncel, "İnsan Kaynakları");
                gonderilen++;
            }
            catch
            {
                /* biri gönderilemezse diğerleri sürer */
            }
        }

        return Ok(new { gonderilen });
    }
}

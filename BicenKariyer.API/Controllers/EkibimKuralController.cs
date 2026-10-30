using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İK paneli › Ekibim görünürlüğü (09.10.2026). Ayrıntı EkibimKurallari'nda:
/// Biçen360 Ekibim, puantaj çizelgesi ve vardiya planı görünürlüğü ile
/// eklenenler için fazla mesai / rotasyon işlemi; izin onay akışına dokunmuyor.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class EkibimKuralController : ControllerBase
{
    private readonly EkipServisi _ekip;
    private readonly EkibimKurallari _kurallar;

    public EkibimKuralController(EkipServisi ekip, EkibimKurallari kurallar)
    {
        _ekip = ekip;
        _kurallar = kurallar;
    }

    private static string K(string s) => EkibimKurallari.K(s);

    private string PanelAdi =>
        User?.FindFirst("adSoyad")?.Value is { Length: > 0 } a ? a : User?.Identity?.Name ?? "İK";

    private static object Ozet(PersonelKaydi p) => p is null ? null : new
    {
        sicil = p.PersonelKodu.Trim(),
        ad = $"{p.Ad} {p.Soyad}".Trim(),
        pozisyon = p.Pozisyon,
        sube = p.IsGrubu,
    };

    /// <summary>Tanımlı kurallar ve şube listesi</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        var aktifler = _ekip.Aktifler();

        var kurallar = _kurallar.Tumu().Select(k =>
        {
            var p = _ekip.Kisi(k.Sicil);
            return new
            {
                kural = k,
                kisi = Ozet(p) ?? new { sicil = k.Sicil, ad = $"{k.Sicil} (aktif değil)", pozisyon = (string)null, sube = (string)null },
                eklenen = p is null ? 0 : _kurallar.Eklenenler(k, p, aktifler).Count,
            };
        }).ToList();

        var subeler = aktifler
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new { ad = g.Key, kisi = g.Count() })
            .OrderBy(x => x.ad)
            .ToList();

        return Ok(new { kurallar, subeler });
    }

    [HttpGet("KisiAra")]
    public IActionResult KisiAra([FromQuery] string q)
    {
        var tr = new System.Globalization.CultureInfo("tr-TR");
        var t = (q ?? "").Trim().ToLower(tr);
        if (t.Length < 2) return Ok(new List<object>());

        return Ok(_ekip.Aktifler()
            .Where(p => $"{p.Ad} {p.Soyad} {p.PersonelKodu} {p.IsGrubu} {p.Pozisyon}".ToLower(tr).Contains(t))
            .Take(25)
            .Select(Ozet)
            .ToList());
    }

    /// <summary>
    /// Kişinin Ekibim'i: otomatik liste (onay tablosu, departman, bölge),
    /// kayıtlı kural ve kural uygulanınca görünen liste.
    /// </summary>
    [HttpGet("{sicil}")]
    public IActionResult Onizleme(string sicil)
    {
        var p = _ekip.Kisi(sicil);
        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var aktifler = _ekip.Aktifler();
        var bolge = _ekip.BolgePersoneli(p);
        var arkadas = _ekip.EkipArkadaslari(p);

        var varsayilan = bolge
            .Concat(arkadas.Where(x => !bolge.Any(b => K(b.PersonelKodu) == K(x.PersonelKodu))))
            .ToList();

        var sorumlu = _ekip.SorumluOlduklari(p).Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var kural = _kurallar.Bul(p.PersonelKodu);

        return Ok(new
        {
            kisi = Ozet(p),
            bolge = bolge.Count > 0,
            kural,
            varsayilan = varsayilan
                .OrderBy(x => (x.IsGrubu ?? "").Trim()).ThenBy(x => x.Ad).ThenBy(x => x.Soyad)
                .Select(x => new
                {
                    sicil = x.PersonelKodu.Trim(),
                    ad = $"{x.Ad} {x.Soyad}".Trim(),
                    pozisyon = x.Pozisyon,
                    sube = x.IsGrubu,
                    ayrinti = sorumlu.Contains(K(x.PersonelKodu)) || bolge.Any(b => K(b.PersonelKodu) == K(x.PersonelKodu)),
                }),
            puantajKisi = _ekip.SorumluOlduklari(p).Count,
            vardiyaKisi = _ekip.VardiyaKapsami(p).Count,
            ekKisiler = (kural?.EkKisiler ?? new()).Select(s => Ozet(_ekip.Kisi(s)) ?? new { sicil = s, ad = $"{s} (aktif değil)", pozisyon = (string)null, sube = (string)null }),
        });
    }

    public sealed class KaydetGirdi
    {
        public string Sicil { get; set; }
        public List<string> EkKisiler { get; set; }
        public List<string> EkSubeler { get; set; }
        public List<string> Gizlenenler { get; set; }
        public bool YalnizSecilenler { get; set; }
        public bool Ayrinti { get; set; } = true;
        public bool Puantaj { get; set; } = true;
        public bool VardiyaPlani { get; set; } = true;
        public bool Islem { get; set; } = true;
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] KaydetGirdi g)
    {
        var p = _ekip.Kisi(g?.Sicil);
        if (p is null) return BadRequest(new { hata = "Personel seçiniz." });

        static List<string> Temiz(IEnumerable<string> l, int n) =>
            (l ?? Array.Empty<string>()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase).Take(n).ToList();

        var k = new EkibimKurallari.Kural
        {
            Sicil = p.PersonelKodu.Trim(),
            EkKisiler = Temiz(g.EkKisiler, 500).Where(x => K(x) != K(p.PersonelKodu)).ToList(),
            EkSubeler = Temiz(g.EkSubeler, 100),
            Gizlenenler = Temiz(g.Gizlenenler, 500),
            YalnizSecilenler = g.YalnizSecilenler,
            Ayrinti = g.Ayrinti,
            Puantaj = g.Puantaj,
            VardiyaPlani = g.VardiyaPlani,
            Islem = g.Islem,
            Guncelleyen = PanelAdi,
            Guncelleme = DateTime.Now,
        };

        var l = _kurallar.Tumu().Where(x => K(x.Sicil) != K(k.Sicil)).ToList();
        l.Add(k);
        _kurallar.Yaz(l);

        return Ok(new { basarili = true });
    }

    [HttpDelete("{sicil}")]
    public IActionResult Sil(string sicil)
    {
        var l = _kurallar.Tumu().Where(x => K(x.Sicil) != K(sicil)).ToList();
        _kurallar.Yaz(l);
        return Ok(new { basarili = true });
    }
}

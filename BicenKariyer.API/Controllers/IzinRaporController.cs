using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İzin Yönetimi › Rapor ve Kontenjan (07.10.2026).
///
/// <para>
/// Rapor kişi kişi hak ediş, önceki dönemden kullanılmamış devir,
/// kullanılan, planlı ve aylık dağılımı döndürür; toplamları panel
/// hesaplıyor (şube, bölge süzgeci anında). Kontenjan şube × ay
/// tablosunu, ayarı ve elle düzeltmeyi yönetir. Personel tarafı:
/// <c>Mobil/Kontenjan</c> şubesinin önümüzdeki aylardaki boşunu verir.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class IzinRaporController : ControllerBase
{
    private readonly IzinRaporServisi _rapor;
    private readonly IzinKontenjanServisi _kontenjan;
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly DepartmanServisi _departman;
    private readonly BildirimServisi _bildirim;
    private readonly YetkiServisi _yetki;

    public IzinRaporController(IzinRaporServisi rapor, IzinKontenjanServisi kontenjan, VeritabaniServisi vt,
        EkipServisi ekip, DepartmanServisi departman, BildirimServisi bildirim, YetkiServisi yetki)
    {
        _rapor = rapor;
        _kontenjan = kontenjan;
        _vt = vt;
        _ekip = ekip;
        _departman = departman;
        _bildirim = bildirim;
        _yetki = yetki;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private bool PersonelMi => User?.IsInRole("Personel") ?? false;

    private bool Duzenleyebilir =>
        !PersonelMi
        && (Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi or Roller.IK)
        && !_yetki.SaltOkunur(Rol);

    private string PanelAdi => User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return i < 0 ? govde : govde[..i];
    }

    /* ==================================================================== */
    /* Rapor                                                                 */
    /* ==================================================================== */

    [HttpGet]
    public IActionResult Rapor([FromQuery] int? yil = null)
    {
        if (PersonelMi) return Forbid();

        var y = yil is >= 2020 and <= 2100 ? yil.Value : DateTime.Today.Year;

        var kisiler = _rapor.Kisiler(y).Select(k => new
        {
            kod = k.Kod,
            ad = k.Ad,
            sube = k.Sube,
            bolge = k.Bolge,
            gorev = k.Gorev,
            giris = k.Giris,
            hakYok = k.HakYok,
            hak = k.Hak,
            devir = k.Devir,
            toplam = k.Toplam,
            kullanilan = k.Kullanilan,
            planli = k.Planli,
            kalan = k.Kalan,
            donemBasi = k.DonemBasi,
            aylar = k.Aylar,
            plan = k.Plan,
        }).ToList();

        return Ok(new
        {
            yil = y,
            bugunAy = y == DateTime.Today.Year ? DateTime.Today.Month - 1 : (y < DateTime.Today.Year ? 11 : -1),
            kisiler,
            duzenleyebilir = Duzenleyebilir,
        });
    }

    /// <summary>
    /// Dönem raporu (08.10.2026): seçilen tarih aralığında kimin hangi izin
    /// türüne kaç gün çıktığı. Panel Excel'i bundan hazırlıyor (özet, kişi ×
    /// tür, şube × tür, aylık dağılım, ayrıntı).
    /// </summary>
    [HttpGet("Donem")]
    public IActionResult Donem([FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null)
    {
        if (PersonelMi) return Forbid();

        var b = (bas ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1)).Date;
        var s = (bit ?? b.AddMonths(1).AddDays(-1)).Date;

        if (s < b) return BadRequest(new { hata = "Bitiş tarihi başlangıçtan önce olamaz." });
        if ((s - b).TotalDays > 366 * 3) return BadRequest(new { hata = "En fazla 3 yıllık aralık seçilebilir." });

        var satirlar = _rapor.Donem(b, s);

        /* Tanımlı türler (sıralı): Excel sütunları bu sırayla */
        List<string> turler;
        using (var db = _vt.Baglanti())
        {
            try
            {
                turler = db.Query<string>("SELECT ad FROM KRY_IZIN_TURU ORDER BY sira, ad").ToList();
            }
            catch
            {
                turler = new();
            }
        }

        foreach (var t in satirlar.Select(x => x.Tur).Distinct())
            if (!turler.Contains(t, StringComparer.OrdinalIgnoreCase)) turler.Add(t);

        return Ok(new
        {
            bas = b,
            bit = s,
            olusturma = DateTime.Now,
            hazirlayan = PanelAdi,
            turler = turler.Where(t => satirlar.Any(x => string.Equals(x.Tur, t, StringComparison.OrdinalIgnoreCase))).ToList(),
            tumTurler = turler,
            satirlar,
        });
    }

    public class PlanIsteGirdi
    {
        public List<string> Siciller { get; set; }
        public bool Yoneticiye { get; set; } = true;
    }

    /// <summary>
    /// Kullanılmamış hak edişi olanlara “izninizi planlayın” bildirimi
    /// (ve yöneticilerine liste). Aynı kişiye günde bir kez.
    /// </summary>
    [HttpPost("PlanIste")]
    public async Task<IActionResult> PlanIste([FromBody] PlanIsteGirdi g)
    {
        if (!Duzenleyebilir) return StatusCode(403, new { hata = "Yetkiniz yok." });

        var siciller = (g?.Siciller ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().Take(2000).ToList();
        if (siciller.Count == 0) return BadRequest(new { hata = "Kişi seçilmedi." });

        var tablo = _rapor.Kisiler(DateTime.Today.Year).ToDictionary(x => x.Kod.Trim().TrimStart('0'), x => x);

        using var db = _vt.Baglanti();

        var gonderilen = 0;
        var yoneticiListesi = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var s in siciller)
        {
            if (!tablo.TryGetValue(s.Trim().TrimStart('0'), out var k) || k.HakYok || k.Kalan <= 0) continue;
            if (!MazeretBelgeGorevi.BirKez(db, $"izinplan|{k.Kod}|{DateTime.Today:yyyyMMdd}")) continue;

            var metin = $"{k.Kalan:0.#} gün kullanılmamış yıllık izin hak edişiniz var"
                        + (k.Devir > 0 ? $" ({k.Devir:0.#} günü önceki dönemden)" : "")
                        + ". Yıl sonuna kadar Biçen360'tan izninizi planlayınız.";

            await _bildirim.Gonder(k.Kod, "İzninizi planlayın", metin, "izin");
            gonderilen++;

            if (g.Yoneticiye)
            {
                try
                {
                    foreach (var y in MazeretBelgeGorevi.Yoneticileri(_ekip, _departman, k.Kod))
                    {
                        if (!yoneticiListesi.TryGetValue(y, out var l)) yoneticiListesi[y] = l = new();
                        l.Add($"{k.Ad} ({k.Kalan:0.#} gün)");
                    }
                }
                catch
                {
                    /* Yönetici bulunamazsa yalnızca personele */
                }
            }
        }

        foreach (var (y, liste) in yoneticiListesi)
        {
            var ozet = string.Join(", ", liste.Take(4)) + (liste.Count > 4 ? $" ve {liste.Count - 4} kişi daha" : "");
            await _bildirim.Gonder(y, "Ekibinizde planlanmamış izin var", $"{ozet}: kullanılmamış yıllık izin hak edişi. Plan yapmalarını sağlayınız.", "ekibim");
        }

        return Ok(new { gonderilen, yonetici = yoneticiListesi.Count });
    }

    /* ==================================================================== */
    /* Kontenjan                                                             */
    /* ==================================================================== */

    [HttpGet("Kontenjan")]
    public IActionResult Kontenjan([FromQuery] int? yil = null)
    {
        if (PersonelMi) return Forbid();

        var y = yil is >= 2020 and <= 2100 ? yil.Value : DateTime.Today.Year;
        var ayar = _kontenjan.AyarOku();

        var subeler = _kontenjan.Hesapla(y).Select(s => new
        {
            sube = s.Sube,
            bolge = s.Bolge,
            kisi = s.Kisi,
            yillik = s.Yillik,
            muaf = s.Muaf,
            aylar = s.Aylar.Select(h => new
            {
                ay = h.Ay,
                kontenjan = h.Kontenjan,
                otomatik = h.Otomatik,
                elle = h.Elle,
                kapali = h.Kapali,
                kullanilan = h.Kullanilan,
                planli = h.Planli,
                dolu = h.Dolu,
                bos = h.Bos,
            }),
        });

        return Ok(new
        {
            yil = y,
            bugunAy = y == DateTime.Today.Year ? DateTime.Today.Month - 1 : (y < DateTime.Today.Year ? 12 : -1),
            ayar,
            subeler,
            duzenleyebilir = Duzenleyebilir,
        });
    }

    [HttpPost("Kontenjan/Ayar")]
    public IActionResult KontenjanAyar([FromBody] IzinKontenjanAyari a)
    {
        if (!Duzenleyebilir) return StatusCode(403, new { hata = "Yetkiniz yok." });
        if (a is null) return BadRequest(new { hata = "Ayar okunamadı." });

        _kontenjan.AyarYaz(a, PanelAdi);
        return Ok(new { tamam = true, ayar = _kontenjan.AyarOku() });
    }

    public class DuzeltGirdi
    {
        public string Sube { get; set; }
        public int Yil { get; set; }
        public int Ay { get; set; }
        public int? Gun { get; set; }
        public bool Kapali { get; set; }
    }

    [HttpPost("Kontenjan/Duzelt")]
    public IActionResult KontenjanDuzelt([FromBody] DuzeltGirdi g)
    {
        if (!Duzenleyebilir) return StatusCode(403, new { hata = "Yetkiniz yok." });
        if (g is null || string.IsNullOrWhiteSpace(g.Sube) || g.Ay is < 1 or > 12 || g.Yil is < 2020 or > 2100)
            return BadRequest(new { hata = "Şube ve ay seçin." });
        if (g.Gun is < 0 or > 5000) return BadRequest(new { hata = "Gün 0–5000 arası olmalı." });

        _kontenjan.Duzelt(g.Sube.Trim(), g.Yil, g.Ay, g.Gun, g.Kapali, PanelAdi);
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Mobil                                                                 */
    /* ==================================================================== */

    /// <summary>Personelin şubesinde önümüzdeki 6 ayın boş günü (1.6 izin ekranı)</summary>
    [HttpGet("Mobil/Kontenjan")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilKontenjan()
    {
        var p = _ekip.Kisi(Sicil());
        if (p is null) return Unauthorized();

        return Ok(_kontenjan.MobilOzet(p));
    }
}

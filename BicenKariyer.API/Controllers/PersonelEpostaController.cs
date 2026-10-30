using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel e-postaları (13.10.2026).
///
/// <para>
/// Genel merkez ve depodaki personelin listesi ve kendi e-postaları.
/// Adresi girilen kişinin izin / fazla mesai formu İK yerine kendi
/// adresine gider; boş bırakılanınki İK'ya düşmeye devam eder. Şube
/// personeli listelenmez: şubelerde akış değişmiyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PersonelEpostaController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly IzinFormuServisi _form;
    private readonly ILogger<PersonelEpostaController> _kayit;

    public PersonelEpostaController(VeritabaniServisi vt, EkipServisi ekip, IzinFormuServisi form,
        ILogger<PersonelEpostaController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _form = form;
        _kayit = kayit;
    }

    private bool PersonelMi => User?.IsInRole("Personel") ?? false;
    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    private bool IkYetkili =>
        !PersonelMi && Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    /// <summary>Şube dışındaki aktif personel ve e-postaları</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();
        var adresler = PersonelEposta.Tumu(db);
        var ayar = _form.FormAyari();

        var liste = _ekip.Aktifler()
            .Select(p => new { p, hedef = _form.FormHedefi(p, ayar) })
            .Where(x => x.hedef != "sube")
            .Select(x => new
            {
                kod = x.p.PersonelKodu?.Trim(),
                adSoyad = $"{x.p.Ad} {x.p.Soyad}".Trim(),
                birim = x.p.IsGrubu ?? x.p.Sube,
                gorev = x.p.Pozisyon,
                yer = x.hedef == "depo" ? "Depo" : "Genel merkez",
                eposta = adresler.GetValueOrDefault(PersonelEposta.Anahtar(x.p.PersonelKodu)),
            })
            .OrderBy(x => x.yer)
            .ThenBy(x => x.birim)
            .ThenBy(x => x.adSoyad)
            .ToList();

        return Ok(new
        {
            personeller = liste,
            girilen = liste.Count(x => !string.IsNullOrWhiteSpace(x.eposta)),
        });
    }

    public class EpostaGirdi
    {
        public string Kod { get; set; }
        public string Eposta { get; set; }
    }

    /// <summary>Tek kişinin adresi; boş gönderilirse silinir</summary>
    [HttpPost]
    public IActionResult Yaz([FromBody] EpostaGirdi girdi)
    {
        if (!IkYetkili) return Forbid();
        if (string.IsNullOrWhiteSpace(girdi?.Kod)) return BadRequest(new { hata = "Personel seçilmedi." });

        var e = (girdi.Eposta ?? "").Trim();
        if (e.Length > 0 && !PersonelEposta.Gecerli(e))
            return BadRequest(new { hata = $"\"{e}\" geçerli bir e-posta adresi değil." });

        using var db = _vt.Baglanti();
        PersonelEposta.Yaz(db, girdi.Kod, e, Kullanici);

        _kayit.LogInformation("Personel e-postası {Islem}: {Kod} ({Kullanici})", e.Length > 0 ? "yazıldı" : "silindi", girdi.Kod, Kullanici);

        return Ok(new { basarili = true, eposta = e.Length > 0 ? e.ToLowerInvariant() : null });
    }

    /// <summary>
    /// Toplu yapıştırma: her satır "sicil;eposta" (sekme ya da virgül de
    /// olur). Şube personeli ve bulunamayan siciller atlanır, sebebiyle döner.
    /// </summary>
    [HttpPost("Toplu")]
    public IActionResult Toplu([FromBody] List<EpostaGirdi> satirlar)
    {
        if (!IkYetkili) return Forbid();
        if (satirlar is null || satirlar.Count == 0) return BadRequest(new { hata = "Satır yok." });

        using var db = _vt.Baglanti();
        var ayar = _form.FormAyari();

        var yazilan = 0;
        var atlanan = new List<string>();

        foreach (var s in satirlar.Take(2000))
        {
            var kod = (s.Kod ?? "").Trim();
            var e = (s.Eposta ?? "").Trim();

            var p = _ekip.Kisi(kod);
            if (p is null) { atlanan.Add($"{kod}: aktif personel bulunamadı"); continue; }
            if (_form.FormHedefi(p, ayar) == "sube") { atlanan.Add($"{kod} {p.Ad} {p.Soyad}: şube personeli, akış değişmez"); continue; }
            if (!PersonelEposta.Gecerli(e)) { atlanan.Add($"{kod}: \"{e}\" geçerli e-posta değil"); continue; }

            PersonelEposta.Yaz(db, kod, e, Kullanici);
            yazilan++;
        }

        return Ok(new { yazilan, atlanan });
    }
}

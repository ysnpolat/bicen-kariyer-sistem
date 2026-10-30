using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen360 kurulum daveti SMS'i (06.10.2026): ayar, son gönderimler ve
/// elle gönderim. Otomatik gönderim UygulamaDavetGorevi'nde.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class UygulamaDavetController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly SmsServisi _sms;
    private readonly PersonelKaynagiServisi _kaynak;

    public UygulamaDavetController(VeritabaniServisi vt, AyarServisi ayar, SmsServisi sms, PersonelKaynagiServisi kaynak)
    {
        _vt = vt;
        _ayar = ayar;
        _sms = sms;
        _kaynak = kaynak;
    }

    private string Yapan => User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    [HttpGet("Ayar")]
    public IActionResult AyarGetir()
    {
        var a = UygulamaDavetGorevi.AyarOku(_ayar);

        return Ok(new
        {
            acik = a.Acik,
            mesaj = a.Mesaj ?? "",
            varsayilan = UygulamaDavetGorevi.VARSAYILAN_MESAJ,
            link = UygulamaDavetGorevi.LINK,
            baslangic = a.Baslangic,
            smsEtkin = _sms.Etkin,
        });
    }

    public class AyarGirdi
    {
        public bool Acik { get; set; }
        public string Mesaj { get; set; }
    }

    [HttpPost("Ayar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult AyarKaydet([FromBody] AyarGirdi g)
    {
        var mesaj = (g?.Mesaj ?? "").Trim();

        if (mesaj.Length > 600) return BadRequest(new { hata = "Mesaj en fazla 600 karakter olabilir." });

        if (mesaj.Length > 0 && !mesaj.Contains("{link}"))
            return BadRequest(new { hata = "Mesajda {link} olmalı; indirme bağlantısı oraya yazılır." });

        var a = UygulamaDavetGorevi.AyarOku(_ayar);
        a.Acik = g?.Acik ?? true;
        a.Mesaj = mesaj;
        _ayar.Yaz(UygulamaDavetGorevi.AYAR, a);

        return Ok(new { basarili = true });
    }

    [HttpGet("Liste")]
    public IActionResult Liste()
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT TOP 100 id, personel_kodu AS sicil, ad_soyad AS adSoyad, sube, gorev, giris_tarihi AS girisTarihi,
       telefon, durum, hata, gonderen, tarih
FROM KRY_UYGULAMA_DAVET ORDER BY tarih DESC").ToList();

        /* Telefon maskeli: son dört hane */
        return Ok(new
        {
            kayitlar = kayitlar.Select(x => new
            {
                id = (int)x.id,
                sicil = (string)x.sicil,
                adSoyad = (string)x.adSoyad,
                sube = (string)x.sube,
                gorev = (string)x.gorev,
                girisTarihi = (DateTime?)x.girisTarihi,
                telefon = string.IsNullOrEmpty((string)x.telefon) ? null : "••• ••• " + ((string)x.telefon)[^4..],
                durum = (string)x.durum,
                hata = (string)x.hata,
                gonderen = (string)x.gonderen,
                tarih = (DateTime)x.tarih,
            }),
        });
    }

    /// <summary>Elle gönderim (yeniden gönder ya da 7 günü geçmiş işe giriş)</summary>
    [HttpPost("Gonder/{sicil}")]
    public async Task<IActionResult> Gonder(string sicil)
    {
        var kod = (sicil ?? "").Trim();

        var p = _kaynak.TumPersonelleriGetir()
            .Where(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.Durum == 1)
            .FirstOrDefault();

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });
        if (p.Durum != 1) return BadRequest(new { hata = "Personel çalışıyor görünmüyor." });

        using var db = _vt.Baglanti();

        var (ok, hata) = await UygulamaDavetGorevi.Gonder(db, _sms, UygulamaDavetGorevi.AyarOku(_ayar), p, Yapan);

        return ok ? Ok(new { basarili = true }) : BadRequest(new { hata = hata ?? "SMS gönderilemedi." });
    }
}

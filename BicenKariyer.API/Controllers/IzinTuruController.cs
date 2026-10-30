using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İzin türleri: adı, bakiyeden düşüp düşmediği ve süre biçimi.
///
/// <para>
/// Eskiden türler ayarlardaki düz bir ad listesiydi; yarım gün ve saatlik
/// izin yıllık izin talebinin içinde bir seçenekti ve yıllık izin
/// bakiyesinden düşüyordu. Artık her biri kendi türü ve bakiyeden düşüp
/// düşmediği burada belirleniyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class IzinTuruController : ControllerBase
{
    private readonly VeritabaniServisi _vt;

    public IzinTuruController(VeritabaniServisi vt)
    {
        _vt = vt;
    }

    [HttpGet]
    public IActionResult Liste()
    {
        using var db = _vt.Baglanti();

        var turler = db.Query(@"
SELECT id, ad, CAST(bakiyeden_duser AS BIT) AS bakiyedenDuser,
       sure_turu AS sureTuru, aciklama, sira, aktif,
       CAST(belge_gerekli AS BIT) AS belgeGerekli
FROM KRY_IZIN_TURU ORDER BY sira, ad").ToList();

        return Ok(new { turler });
    }

    public class TurGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public bool BakiyedenDuser { get; set; }

        /// <summary>tam | yarim | saat</summary>
        public string SureTuru { get; set; } = "tam";

        public string Aciklama { get; set; }
        public int Sira { get; set; }
        public bool Aktif { get; set; } = true;

        /// <summary>Onaylanınca personel 3 gün içinde belge yükler (mazeret, rapor)</summary>
        public bool BelgeGerekli { get; set; }
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] TurGirdi g)
    {
        var ad = (g?.Ad ?? "").Trim();

        if (ad.Length < 2) return BadRequest(new { hata = "İzin türü adı giriniz." });

        var sure = (g.SureTuru ?? "tam").Trim().ToLowerInvariant();

        if (sure is not ("tam" or "yarim" or "saat"))
            return BadRequest(new { hata = "Süre biçimi tam, yarim ya da saat olmalı." });

        using var db = _vt.Baglanti();

        var cakisan = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_IZIN_TURU WHERE ad = @ad AND id <> @id",
            new { ad, id = g.Id });

        if (cakisan > 0) return BadRequest(new { hata = "Bu adla bir izin türü zaten var." });

        if (g.Id > 0)
            db.Execute(@"
UPDATE KRY_IZIN_TURU
SET ad = @ad, bakiyeden_duser = @duser, sure_turu = @sure, aciklama = @aciklama,
    sira = @sira, aktif = @aktif, belge_gerekli = @belge,
    guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id",
                new { id = g.Id, ad, duser = g.BakiyedenDuser, sure, aciklama = g.Aciklama,
                      sira = g.Sira, aktif = g.Aktif, belge = g.BelgeGerekli, yapan = User?.Identity?.Name });
        else
            db.Execute(@"
INSERT INTO KRY_IZIN_TURU (ad, bakiyeden_duser, sure_turu, aciklama, sira, aktif, belge_gerekli, guncelleyen)
VALUES (@ad, @duser, @sure, @aciklama, @sira, @aktif, @belge, @yapan)",
                new { ad, duser = g.BakiyedenDuser, sure, aciklama = g.Aciklama,
                      sira = g.Sira, aktif = g.Aktif, belge = g.BelgeGerekli, yapan = User?.Identity?.Name });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Tür pasife alınıyor, silinmiyor: geçmiş izin kayıtları türün adını
    /// taşıyor ve silinirse eski kayıtlar anlamsız kalır.
    /// </summary>
    [HttpDelete("{id:int}")]
    public IActionResult Kapat(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute("UPDATE KRY_IZIN_TURU SET aktif = 0 WHERE id = @id", new { id });

        return Ok(new { basarili = true });
    }
}

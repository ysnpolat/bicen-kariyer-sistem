using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Yönetim › Roller (13.10.2026).
///
/// <para>
/// Portal rolü: sayfalar (görür / yönetir), departmanlar (ya da tümü),
/// Raporlar sekmeleri ve tutar yetkisi. Kullanıcıya atama ayrı tabloda;
/// Kariyer'in rol sütunu değişmiyor. Admin rolü burada düzenlenmez.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RolController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly RolServisi _roller;
    private readonly ILogger<RolController> _kayit;

    public RolController(VeritabaniServisi vt, YetkiServisi yetki, RolServisi roller, ILogger<RolController> kayit)
    {
        _vt = vt;
        _yetki = yetki;
        _roller = roller;
        _kayit = kayit;
    }

    private string Ad => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";
    private bool Yetkili() => _yetki.SayfaAcik(Ad, Rol, "yonetim");

    /* Rolün açabileceği sayfalar: "tüm departmanlar" bir sayfa değil,
       rolde kapsam seçimiyle veriliyor. */
    private static IEnumerable<Girdi> RolSayfalari =>
        Katalog.Sayfalar.Where(s => s.Kod != "tum-departmanlar");

    [HttpGet]
    public IActionResult Liste()
    {
        if (!Yetkili()) return Forbid();

        _roller.Sifirla();

        using var db = _vt.Baglanti();

        var kullanicilar = db.Query(@"
SELECT K.kullanici_adi AS kullaniciAdi, K.ad_soyad AS adSoyad, K.rol, K.sicil,
       K.sube_kodu AS subeKodu, K.aktif, R.rol_id AS portalRolId
FROM KRY_KULLANICILAR K
    LEFT JOIN B360_KULLANICI_ROL R ON R.kullanici_adi = K.kullanici_adi
ORDER BY K.aktif DESC, K.ad_soyad").ToList();

        var roller = db.Query(@"
SELECT id, ad, aciklama, tum_departmanlar AS tumDepartmanlar, maliyet
FROM B360_ROL WHERE aktif = 1 ORDER BY ad").ToList();

        var deps = db.Query<(int RolId, int DepId)>("SELECT rol_id, departman_id FROM B360_ROL_DEPARTMAN").ToList();
        var sayfalar = db.Query<(int RolId, string Kod, int Seviye)>("SELECT rol_id, kod, CAST(seviye AS INT) FROM B360_ROL_SAYFA").ToList();
        var raporlar = db.Query<(int RolId, string Rapor)>("SELECT rol_id, rapor FROM B360_ROL_RAPOR").ToList();

        return Ok(new
        {
            roller = roller.Select(r =>
            {
                int id = r.id;
                return new
                {
                    id,
                    ad = (string)r.ad,
                    aciklama = (string)r.aciklama,
                    tumDepartmanlar = (bool)r.tumDepartmanlar,
                    maliyet = (bool)r.maliyet,
                    departmanlar = deps.Where(x => x.RolId == id).Select(x => x.DepId).ToList(),
                    sayfalar = sayfalar.Where(x => x.RolId == id).ToDictionary(x => x.Kod, x => x.Seviye),
                    raporlar = raporlar.Where(x => x.RolId == id).Select(x => x.Rapor).ToList(),
                };
            }),
            kullanicilar,
            katalog = new
            {
                sayfalar = RolSayfalari.Select(s => new
                {
                    kod = s.Kod, ad = s.Ad, aciklama = s.Aciklama,
                    yonetim = RolServisi.YonetimliSayfalar.Contains(s.Kod)
                }),
                raporlar = RolServisi.Raporlar.Select(r => new { kod = r.Kod, ad = r.Ad, sayfa = r.Sayfa, maliyet = r.Maliyet }),
                departmanlar = db.Query("SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList(),
            }
        });
    }

    public class RolGirdi
    {
        public int? Id { get; set; }
        public string Ad { get; set; }
        public string Aciklama { get; set; }
        public bool TumDepartmanlar { get; set; }
        public bool Maliyet { get; set; }
        public List<int> Departmanlar { get; set; }
        public Dictionary<string, int> Sayfalar { get; set; }
        public List<string> Raporlar { get; set; }
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] RolGirdi g)
    {
        if (!Yetkili()) return Forbid();

        var ad = (g?.Ad ?? "").Trim();
        if (ad.Length < 2) return BadRequest(new { hata = "Rol adını yazınız." });
        if (ad.Length > 80) ad = ad[..80];
        if (YetkiServisi.Adminmi(ad)) return BadRequest(new { hata = "Admin rolü düzenlenemez." });

        var gecerliSayfa = RolSayfalari.Select(s => s.Kod).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var sayfalar = (g.Sayfalar ?? new())
            .Where(x => gecerliSayfa.Contains(x.Key) && x.Value > 0)
            .ToDictionary(x => x.Key, x => RolServisi.YonetimliSayfalar.Contains(x.Key) ? Math.Min(x.Value, 2) : 1);

        /* Rapor yalnızca sayfası açıksa; servis maliyeti tutar yetkisi ister */
        var raporlar = (g.Raporlar ?? new())
            .Where(r => RolServisi.Raporlar.Any(x => x.Kod == r && sayfalar.ContainsKey("rapor")
                        && sayfalar.ContainsKey(x.Sayfa) && (!x.Maliyet || g.Maliyet)))
            .Distinct().ToList();

        using var db = _vt.Baglanti();
        db.Open();

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_ROL WHERE ad = @ad AND id <> ISNULL(@id, 0)",
                new { ad, id = g.Id }) > 0)
            return BadRequest(new { hata = $"\"{ad}\" adında bir rol zaten var." });

        var deps = g.TumDepartmanlar
            ? new List<int>()
            : db.Query<int>("SELECT id FROM B360_DEPARTMAN WHERE id IN @d",
                new { d = (g.Departmanlar ?? new()).DefaultIfEmpty(-1).ToList() }).ToList();

        using var tx = db.BeginTransaction();

        int id;
        if (g.Id is int mevcut && mevcut > 0)
        {
            id = mevcut;
            var n = db.Execute(@"
UPDATE B360_ROL SET ad = @ad, aciklama = @aciklama, tum_departmanlar = @tum, maliyet = @maliyet,
       guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id",
                new { id, ad, aciklama = g.Aciklama?.Trim(), tum = g.TumDepartmanlar, maliyet = g.Maliyet, yapan = Ad }, tx);

            if (n == 0) return NotFound(new { hata = "Rol bulunamadı." });

            db.Execute("DELETE FROM B360_ROL_DEPARTMAN WHERE rol_id = @id; DELETE FROM B360_ROL_SAYFA WHERE rol_id = @id; DELETE FROM B360_ROL_RAPOR WHERE rol_id = @id;",
                new { id }, tx);
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ROL (ad, aciklama, tum_departmanlar, maliyet, guncelleyen)
OUTPUT INSERTED.id VALUES (@ad, @aciklama, @tum, @maliyet, @yapan)",
                new { ad, aciklama = g.Aciklama?.Trim(), tum = g.TumDepartmanlar, maliyet = g.Maliyet, yapan = Ad }, tx);
        }

        foreach (var d in deps)
            db.Execute("INSERT INTO B360_ROL_DEPARTMAN (rol_id, departman_id) VALUES (@id, @d)", new { id, d }, tx);
        foreach (var (kod, seviye) in sayfalar)
            db.Execute("INSERT INTO B360_ROL_SAYFA (rol_id, kod, seviye) VALUES (@id, @kod, @seviye)", new { id, kod, seviye }, tx);
        foreach (var r in raporlar)
            db.Execute("INSERT INTO B360_ROL_RAPOR (rol_id, rapor) VALUES (@id, @r)", new { id, r }, tx);

        tx.Commit();
        _roller.Sifirla();

        _kayit.LogInformation("Portal rolü kaydedildi: {Ad} (#{Id}) · {Yapan}", ad, id, Ad);

        return Ok(new { id, basarili = true });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kisi = db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_KULLANICI_ROL WHERE rol_id = @id", new { id });
        if (kisi > 0) return BadRequest(new { hata = $"Bu rolde {kisi} kullanıcı var; önce kullanıcıları çıkarınız." });

        db.Execute("DELETE FROM B360_ROL WHERE id = @id", new { id });
        _roller.Sifirla();

        return Ok(new { basarili = true });
    }

    public class AtamaGirdi
    {
        public string KullaniciAdi { get; set; }
        /// <summary>Boş: kullanıcının portal rolü kaldırılır</summary>
        public int? RolId { get; set; }
    }

    /// <summary>Kullanıcıya portal rolü atar ya da kaldırır.</summary>
    [HttpPost("Ata")]
    public IActionResult Ata([FromBody] AtamaGirdi g)
    {
        if (!Yetkili()) return Forbid();

        var kullanici = (g?.KullaniciAdi ?? "").Trim();
        if (kullanici.Length == 0) return BadRequest(new { hata = "Kullanıcı seçilmedi." });

        using var db = _vt.Baglanti();

        var rol = db.ExecuteScalar<string>("SELECT rol FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici", new { kullanici });
        if (rol is null) return NotFound(new { hata = "Kullanıcı bulunamadı." });
        if (YetkiServisi.Adminmi(rol) && g.RolId is not null)
            return BadRequest(new { hata = "Admin kullanıcıya portal rolü atanmaz; zaten her şeyi görür." });

        db.Execute("DELETE FROM B360_KULLANICI_ROL WHERE kullanici_adi = @kullanici", new { kullanici });

        if (g.RolId is int rolId)
        {
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_ROL WHERE id = @rolId AND aktif = 1", new { rolId }) == 0)
                return NotFound(new { hata = "Rol bulunamadı." });

            db.Execute("INSERT INTO B360_KULLANICI_ROL (kullanici_adi, rol_id, atayan) VALUES (@kullanici, @rolId, @yapan)",
                new { kullanici, rolId, yapan = Ad });
        }

        _roller.Sifirla();

        return Ok(new { basarili = true });
    }
}

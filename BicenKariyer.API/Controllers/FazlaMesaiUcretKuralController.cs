using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Fazla mesai ücret kuralları (15.10.2026, Yönetim › Fazla mesai ücret
/// kuralları): gün türü (normal, hafta tatili, resmi tatil, arife) ve kapsam
/// (iş yeri, pozisyon, kişi) → ücret ya da serbest zaman, çarpan.
/// Ayrıntı: <see cref="FazlaMesaiUcretServisi"/>.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class FazlaMesaiUcretKuralController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly FazlaMesaiUcretServisi _ucret;
    private readonly IzinOnayKuralServisi _izinKural;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly EkipServisi _ekip;

    public FazlaMesaiUcretKuralController(VeritabaniServisi vt, FazlaMesaiUcretServisi ucret, IzinOnayKuralServisi izinKural,
        PersonelKaynagiServisi kaynak, EkipServisi ekip)
    {
        _vt = vt;
        _ucret = ucret;
        _izinKural = izinKural;
        _kaynak = kaynak;
        _ekip = ekip;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool Yazabilir => Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi;

    private string Kim => User?.FindFirst("adSoyad")?.Value is { Length: > 0 } ad ? ad : User?.Identity?.Name ?? "";

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private void Iz(IDbConnection db, string islem)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_AYAR_DEGISIKLIK (bolum, islem, kullanici, basarili)
VALUES (N'fmucret', @islem, @kullanici, 1)",
                new { islem = islem.Length > 200 ? islem[..197] + "…" : islem, kullanici = User?.Identity?.Name ?? "" });
        }
        catch
        {
            /* iz yazılamasa da kayıt geçerli */
        }
    }

    [HttpGet]
    public IActionResult Liste()
    {
        var personel = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();
        var kurallar = _ucret.Kurallar(pasifDahil: true);

        var isYerleri = new List<string>();
        try
        {
            isYerleri.AddRange(_izinKural.Kurallar().Select(k => k.IsYeri));
        }
        catch { /* yalnızca birimler */ }

        isYerleri.AddRange(personel.Select(x => x.IsGrubu).Where(x => !string.IsNullOrWhiteSpace(x)));

        var kisiAdlari = kurallar.Where(k => !string.IsNullOrWhiteSpace(k.Sicil)).Select(k => k.Sicil).Distinct()
            .ToDictionary(s => s, s =>
            {
                var p = personel.FirstOrDefault(x => K(x.PersonelKodu) == K(s));
                return p is null ? null : $"{p.Ad} {p.Soyad}".Trim();
            });

        return Ok(new
        {
            yazabilir = Yazabilir,
            kurallar,
            gunTurleri = FazlaMesaiUcretServisi.GunTurleri.Select(x => new { kod = x.Key, ad = x.Value }),
            pozisyonlar = personel.Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon)).Select(x => x.Pozisyon.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToList(),
            isYerleri = isYerleri.Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToList(),
            kisiAdlari,
            aylikSaat = Parametre.Sayi("fm.aylikSaat"),
            varsayilanYuzde = Parametre.Sayi("fm.zamYuzde"),
        });
    }

    public class KuralGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public string IsYeri { get; set; }
        public string Pozisyon { get; set; }
        public string Sicil { get; set; }
        public string GunTuru { get; set; }
        public string Karsilik { get; set; }
        public decimal Carpan { get; set; }
        public bool Aktif { get; set; } = true;
    }

    private static string Kirp(string s, int n)
    {
        s = (s ?? "").Trim();
        return s.Length > n ? s[..n] : s;
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] KuralGirdi g)
    {
        if (!Yazabilir) return Forbid();
        if (g is null) return BadRequest(new { hata = "Kural okunamadı." });

        if (g.Carpan < 0.5m || g.Carpan > 5m) return BadRequest(new { hata = "Çarpan 0,5 ile 5 arasında olmalı." });

        var gun = FazlaMesaiUcretServisi.GunTurleri.ContainsKey(g.GunTuru ?? "") ? g.GunTuru : FazlaMesaiUcretServisi.Hepsi;
        var karsilik = g.Karsilik == FazlaMesaiUcretServisi.KarsilikIzin ? FazlaMesaiUcretServisi.KarsilikIzin : FazlaMesaiUcretServisi.KarsilikUcret;
        var sicil = new string((g.Sicil ?? "").Where(char.IsLetterOrDigit).Take(20).ToArray());

        var p = new
        {
            g.Id,
            ad = Kirp(g.Ad, 150) is { Length: > 0 } a ? a : null,
            isYeri = Kirp(g.IsYeri, 150) is { Length: > 0 } y ? y : FazlaMesaiUcretServisi.Hepsi,
            pozisyon = Kirp(g.Pozisyon, 150) is { Length: > 0 } z ? z : FazlaMesaiUcretServisi.Hepsi,
            sicil = sicil.Length == 0 ? null : sicil,
            gun,
            karsilik,
            carpan = Math.Round(g.Carpan, 2),
            aktif = g.Aktif,
            kim = Kirp(Kim, 100),
        };

        using var db = _vt.Baglanti();
        int id;

        if (g.Id > 0)
        {
            if (db.Execute(@"
UPDATE KRY_FM_UCRET_KURAL
SET ad = @ad, is_yeri = @isYeri, pozisyon = @pozisyon, sicil = @sicil, gun_turu = @gun, karsilik = @karsilik,
    carpan = @carpan, aktif = @aktif, guncelleyen = @kim, guncelleme = SYSDATETIME()
WHERE id = @Id", p) == 0)
                return NotFound(new { hata = "Kural bulunamadı." });
            id = g.Id;
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_FM_UCRET_KURAL (sira, ad, is_yeri, pozisyon, sicil, gun_turu, karsilik, carpan, aktif, guncelleyen)
OUTPUT INSERTED.id
VALUES ((SELECT ISNULL(MAX(sira), 0) + 10 FROM KRY_FM_UCRET_KURAL), @ad, @isYeri, @pozisyon, @sicil, @gun, @karsilik,
        @carpan, @aktif, @kim)", p);
        }

        FazlaMesaiUcretServisi.Unut();
        Iz(db, $"#{id} {p.sicil ?? p.pozisyon} · {p.isYeri} · {p.gun} → {(karsilik == "izin" ? "serbest zaman" : "ücret")} ×{p.carpan}");

        return Ok(new { basarili = true, id });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yazabilir) return Forbid();

        using var db = _vt.Baglanti();
        var n = db.Execute("DELETE FROM KRY_FM_UCRET_KURAL WHERE id = @id", new { id });
        FazlaMesaiUcretServisi.Unut();
        if (n > 0) Iz(db, $"#{id} silindi");

        return n == 0 ? NotFound(new { hata = "Kural bulunamadı." }) : Ok(new { basarili = true });
    }

    /// <summary>Dene: bu personel bu tarihte bu kadar fazla mesai yaparsa (ücret tutarı dönmez)</summary>
    [HttpGet("Dene")]
    public IActionResult Dene([FromQuery] string personel, [FromQuery] DateTime tarih, [FromQuery] decimal saat = 1)
    {
        var p = _ekip.Kisi((personel ?? "").Trim());
        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var dk = (int)Math.Round(Math.Clamp(saat, 0.25m, 24m) * 60);

        var s = _ucret.Hesapla(
            new[] { new FazlaMesaiUcretServisi.Girdi(1, p.PersonelKodu, p.Pozisyon, p.IsGrubu, tarih.Date, dk) },
            null, ig => _izinKural.IsYeriBul(ig))[1];

        return Ok(new
        {
            personel = new { sicil = K(p.PersonelKodu), ad = $"{p.Ad} {p.Soyad}".Trim(), pozisyon = p.Pozisyon, birim = p.IsGrubu },
            tarih = tarih.Date,
            gunTuru = s.GunTuruAdi,
            tatil = s.TatilAdi,
            karsilik = s.Karsilik,
            carpan = s.Carpan,
            izinDk = s.IzinDk,
            kural = s.Kural,
            dk,
        });
    }
}

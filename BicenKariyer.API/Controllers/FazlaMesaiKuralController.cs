using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Fazla mesai akışı kuralları (14.10.2026, Yönetim › Fazla mesai akışı).
/// Hangi iş yerinde / pozisyonda, kim girerse onay kimlere gider ve form
/// hangi adrese gider. Ayrıntı: <see cref="FazlaMesaiKuralServisi"/>.
/// Değişiklik yeni kayıtlara uygulanır; bekleyen kayıt kendi akışıyla ilerler.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class FazlaMesaiKuralController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly FazlaMesaiKuralServisi _kural;
    private readonly IzinOnayKuralServisi _izinKural;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly EkipServisi _ekip;

    public FazlaMesaiKuralController(VeritabaniServisi vt, FazlaMesaiKuralServisi kural, IzinOnayKuralServisi izinKural,
        PersonelKaynagiServisi kaynak, EkipServisi ekip)
    {
        _vt = vt;
        _kural = kural;
        _izinKural = izinKural;
        _kaynak = kaynak;
        _ekip = ekip;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>İK uzmanı görüntüler; değiştirme Admin, GMY, İK yöneticisi</summary>
    private bool Yazabilir => Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi;

    private string Kim => User?.FindFirst("adSoyad")?.Value is { Length: > 0 } ad ? ad : User?.Identity?.Name ?? "";

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private void Iz(IDbConnection db, string islem)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_AYAR_DEGISIKLIK (bolum, islem, kullanici, basarili)
VALUES (N'fmakis', @islem, @kullanici, 1)",
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
        var kurallar = _kural.Kurallar(pasifDahil: true);
        var personel = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        var pozisyonlar = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .GroupBy(x => x.Pozisyon.Trim())
            .Select(g => new { pozisyon = g.Key, kisi = g.Count() })
            .OrderBy(x => x.pozisyon)
            .ToList();

        /* İş yerleri: izin onay tablosundakiler + birimler */
        var isYerleri = new List<string>();
        try
        {
            isYerleri.AddRange(_izinKural.Kurallar().Select(k => k.IsYeri));
        }
        catch { /* tablo okunamazsa yalnızca birimler */ }

        isYerleri.AddRange(personel.Select(x => x.IsGrubu).Where(x => !string.IsNullOrWhiteSpace(x)));
        isYerleri = isYerleri.Select(x => x.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToList();

        var siciller = kurallar.SelectMany(k => k.Adimlar.Select(a => a.Sicil).Append(k.GirenSicil))
            .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();

        var kisiAdlari = siciller.ToDictionary(s => s, s =>
        {
            var p = personel.FirstOrDefault(x => IzinOnayKuralServisi.AyniSicil(x.PersonelKodu, s));
            return p is null ? null : $"{p.Ad} {p.Soyad}".Trim();
        });

        return Ok(new
        {
            yazabilir = Yazabilir,
            kurallar,
            pozisyonlar,
            isYerleri,
            kisiAdlari,
            sema = FazlaMesaiKuralServisi.SemaUst,
        });
    }

    public class KuralGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public string IsYeri { get; set; }
        public string Pozisyon { get; set; }
        public string Giren { get; set; }
        public string GirenSicil { get; set; }
        public List<AvansOnayZinciri.KuralAdimi> Adimlar { get; set; }
        public string EpostaMod { get; set; }
        public string Eposta { get; set; }
        public bool Aktif { get; set; } = true;
    }

    private static string Kirp(string s, int n)
    {
        s = (s ?? "").Trim();
        return s.Length > n ? s[..n] : s;
    }

    private static string HepsiYaDa(string s)
    {
        s = Kirp(s, 150);
        return s.Length == 0 ? FazlaMesaiKuralServisi.Hepsi : s;
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] KuralGirdi g)
    {
        if (!Yazabilir) return Forbid();
        if (g is null) return BadRequest(new { hata = "Kural okunamadı." });

        var adimlar = FazlaMesaiKuralServisi.Temizle(g.Adimlar);
        var mod = g.EpostaMod is FazlaMesaiKuralServisi.EpostaGiren or FazlaMesaiKuralServisi.EpostaAdres
            ? g.EpostaMod
            : FazlaMesaiKuralServisi.EpostaVarsayilan;

        string eposta = null;
        if (mod == FazlaMesaiKuralServisi.EpostaAdres)
        {
            var l = FazlaMesaiKuralServisi.Ayir(g.Eposta);
            if (l.Count == 0) return BadRequest(new { hata = "Formun gideceği e-posta adresini yazınız." });
            eposta = string.Join("; ", l);
            if (eposta.Length > 500) return BadRequest(new { hata = "E-posta adresleri çok uzun." });
        }

        var girenSicil = new string((g.GirenSicil ?? "").Where(char.IsLetterOrDigit).Take(20).ToArray());

        using var db = _vt.Baglanti();

        var p = new
        {
            g.Id,
            ad = Kirp(g.Ad, 150) is { Length: > 0 } ad ? ad : null,
            isYeri = HepsiYaDa(g.IsYeri),
            pozisyon = HepsiYaDa(g.Pozisyon),
            giren = HepsiYaDa(g.Giren),
            girenSicil = girenSicil.Length == 0 ? null : girenSicil,
            adimlar = FazlaMesaiKuralServisi.AdimlariYaz(adimlar),
            mod,
            eposta,
            aktif = g.Aktif,
            kim = Kirp(Kim, 100),
        };

        int id;

        if (g.Id > 0)
        {
            var n = db.Execute(@"
UPDATE KRY_FM_AKIS_KURAL
SET ad = @ad, is_yeri = @isYeri, pozisyon = @pozisyon, giren = @giren, giren_sicil = @girenSicil,
    adimlar = @adimlar, eposta_mod = @mod, eposta = @eposta, aktif = @aktif,
    guncelleyen = @kim, guncelleme = SYSDATETIME()
WHERE id = @Id", p);
            if (n == 0) return NotFound(new { hata = "Kural bulunamadı." });
            id = g.Id;
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_FM_AKIS_KURAL (sira, ad, is_yeri, pozisyon, giren, giren_sicil, adimlar, eposta_mod, eposta, aktif, guncelleyen)
OUTPUT INSERTED.id
VALUES ((SELECT ISNULL(MAX(sira), 0) + 10 FROM KRY_FM_AKIS_KURAL), @ad, @isYeri, @pozisyon, @giren, @girenSicil,
        @adimlar, @mod, @eposta, @aktif, @kim)", p);
        }

        FazlaMesaiKuralServisi.Unut();

        var ozet = adimlar.Count == 0
            ? "doğrudan İK"
            : string.Join(" → ", adimlar.Select(x => x.Sicil is null ? x.Onay : $"{x.Onay} ({x.Sicil})")) + " → İK";
        Iz(db, $"#{id} {p.isYeri} · {p.pozisyon} · giren {p.girenSicil ?? p.giren}: {ozet}");

        return Ok(new { basarili = true, id });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yazabilir) return Forbid();

        using var db = _vt.Baglanti();
        var n = db.Execute("DELETE FROM KRY_FM_AKIS_KURAL WHERE id = @id", new { id });
        FazlaMesaiKuralServisi.Unut();

        if (n > 0) Iz(db, $"#{id} silindi");

        return n == 0 ? NotFound(new { hata = "Kural bulunamadı." }) : Ok(new { basarili = true });
    }

    public class SiraGirdi
    {
        public List<int> Siralama { get; set; }
    }

    /// <summary>Kuralların sırası: üstteki önce denenir</summary>
    [HttpPost("Sira")]
    public IActionResult Sira([FromBody] SiraGirdi g)
    {
        if (!Yazabilir) return Forbid();

        var l = g?.Siralama ?? new();
        using var db = _vt.Baglanti();

        for (var i = 0; i < l.Count; i++)
            db.Execute("UPDATE KRY_FM_AKIS_KURAL SET sira = @sira WHERE id = @id", new { id = l[i], sira = (i + 1) * 10 });

        FazlaMesaiKuralServisi.Unut();
        Iz(db, "sıra değişti");

        return Ok(new { basarili = true });
    }

    /// <summary>Dene: bu personele bu kişi fazla mesai girerse onay kimlere gider (kayıt açmaz)</summary>
    [HttpGet("Dene")]
    public IActionResult Dene([FromQuery] string personel, [FromQuery] string giren)
    {
        var hedef = _ekip.Kisi((personel ?? "").Trim());
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        var g = _ekip.Kisi((giren ?? "").Trim());
        if (g is null) return NotFound(new { hata = "Giren kişi bulunamadı." });

        var sonuc = _kural.Onizle(g, hedef);

        return Ok(new
        {
            personel = new { sicil = K(hedef.PersonelKodu), ad = $"{hedef.Ad} {hedef.Soyad}".Trim(), hedef.Pozisyon, birim = hedef.IsGrubu, isYeri = _kural.IsYeri(hedef) },
            giren = new { sicil = K(g.PersonelKodu), ad = $"{g.Ad} {g.Soyad}".Trim(), g.Pozisyon },
            kural = sonuc,
            /* Kural tutmazsa eski akış: şemadaki üst yönetici → İK, form birimin adresine */
            eskiAkis = sonuc is null,
        });
    }
}

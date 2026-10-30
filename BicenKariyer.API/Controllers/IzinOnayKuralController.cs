using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yıllık izin onay tablosu: iş yeri + pozisyon → 1. onaylayan.
///
/// <para>
/// İK'nın Excel'de tuttuğu tablo buraya taşındı; düzenleme de buradan.
/// "Kuralı olmayan pozisyonlar" ayrıca listeleniyor: kuralı olmayan
/// pozisyonun talebi 1. onayı atlayıp doğrudan İK'ya düşüyor ve bu,
/// tabloya bakarak fark edilmiyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class IzinOnayKuralController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinOnayKuralServisi _kural;
    private readonly PersonelKaynagiServisi _kaynak;

    public IzinOnayKuralController(VeritabaniServisi vt, IzinOnayKuralServisi kural,
        PersonelKaynagiServisi kaynak)
    {
        _vt = vt;
        _kural = kural;
        _kaynak = kaynak;
    }

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    [HttpGet]
    public IActionResult Liste()
    {
        var kurallar = _kural.Kurallar();

        var personel = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        /* Pozisyon listesi: seçim kutuları için, kaç kişi olduğuyla */
        var pozisyonlar = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .GroupBy(x => x.Pozisyon.Trim())
            .Select(g => new { pozisyon = g.Key, kisi = g.Count() })
            .OrderBy(x => x.pozisyon)
            .ToList();

        /* Kuralı olmayanlar: iş yeri + pozisyon ikilisi bazında */
        var eksikler = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .Where(x => _kural.KuralBul(x.Pozisyon, x.IsGrubu) is null)
            .GroupBy(x => x.Pozisyon.Trim())
            .Select(g => new
            {
                pozisyon = g.Key,
                kisi = g.Count(),
                isYerleri = g.Select(x => x.IsGrubu).Distinct().Take(5).ToList(),
            })
            .OrderByDescending(x => x.kisi)
            .ToList();

        var isYerleri = kurallar.Select(k => k.IsYeri)
            .Append(IzinOnayKuralServisi.Sube)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new { kurallar, pozisyonlar, eksikler, isYerleri });
    }

    public class KuralGirdi
    {
        public int Id { get; set; }
        public string IsYeri { get; set; }
        public string Pozisyon { get; set; }
        public string Onay1 { get; set; }
        public string Onay1Sicil { get; set; }
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] KuralGirdi g)
    {
        var yer = (g?.IsYeri ?? "").Trim();
        var poz = (g?.Pozisyon ?? "").Trim();
        var onay = (g?.Onay1 ?? "").Trim();
        var sicil = string.IsNullOrWhiteSpace(g?.Onay1Sicil) ? null : g.Onay1Sicil.Trim();

        if (yer.Length == 0 || poz.Length == 0 || onay.Length == 0)
            return BadRequest(new { hata = "İş yeri, pozisyon ve 1. onaylayan zorunlu." });

        if (A(poz) == A(onay) && sicil is null)
            return BadRequest(new { hata = "Bir pozisyon kendi iznini onaylayamaz; 1. onaylayan farklı olmalı." });

        using var db = _vt.Baglanti();

        /* Aynı iş yeri + pozisyon için ikinci kural açılmıyor: hangisinin
           geçtiği belirsiz kalırdı. */
        var cakisan = db.Query("SELECT id, is_yeri, pozisyon FROM KRY_IZIN_ONAY_KURAL WHERE aktif = 1 AND id <> @id",
                new { id = g.Id })
            .Any(x => A((string)x.is_yeri) == A(yer) && A((string)x.pozisyon) == A(poz));

        if (cakisan)
            return BadRequest(new { hata = $"{yer} · {poz} için zaten bir kural var." });

        var yapan = User?.Identity?.Name;

        if (g.Id > 0)
            db.Execute(@"
UPDATE KRY_IZIN_ONAY_KURAL
SET is_yeri = @yer, pozisyon = @poz, onay1 = @onay, onay1_sicil = @sicil,
    guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id", new { id = g.Id, yer, poz, onay, sicil, yapan });
        else
            db.Execute(@"
INSERT INTO KRY_IZIN_ONAY_KURAL (is_yeri, pozisyon, onay1, onay1_sicil, guncelleyen)
VALUES (@yer, @poz, @onay, @sicil, @yapan)", new { yer, poz, onay, sicil, yapan });

        IzinOnayKuralServisi.Unut();

        return Ok(new { basarili = true });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute("UPDATE KRY_IZIN_ONAY_KURAL SET aktif = 0 WHERE id = @id", new { id });

        IzinOnayKuralServisi.Unut();

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Bir personelin izin talebi kime gider: tabloyu değiştirmeden önce
    /// sonucu görmek için.
    /// </summary>
    [HttpGet("Dene")]
    public IActionResult Dene([FromQuery] string sicil)
    {
        var p = _kaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => IzinOnayKuralServisi.AyniSicil(x.PersonelKodu, sicil));

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var kural = _kural.KuralBul(p.Pozisyon, p.IsGrubu);
        var (kisiler, unvan) = _kural.Onaylayanlar(p.PersonelKodu, p.Pozisyon, p.IsGrubu);

        return Ok(new
        {
            personel = new { adSoyad = $"{p.Ad} {p.Soyad}".Trim(), p.Pozisyon, isYeri = p.IsGrubu },
            kural,
            onay1 = unvan,
            onaylayanlar = kisiler.Select(x => new
            {
                sicil = x.PersonelKodu, adSoyad = $"{x.Ad} {x.Soyad}".Trim(), x.Pozisyon, isYeri = x.IsGrubu,
            }),
        });
    }
}

using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetim → Patron Görünümü (03.10.2026): Biçen360'ta şirket geneli
/// yönetim ekranlarını görecek kişilerin listesi.
///
/// <para>
/// Listeyi yalnızca Admin ve Genel Müdür Yardımcısı değiştirebiliyor:
/// patron görünümü bütün şubelerin kadro, başvuru, onay ve Biçen Kart
/// verisini açıyor. Her ekleme ve kaldırma güvenlik günlüğüne yazılıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PatronController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly ILogger<PatronController> _kayit;

    public PatronController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        GuvenlikGunlugu gunluk,
        ILogger<PatronController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _gunluk = gunluk;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private bool Yetkili => Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi;

    private static string K(string s) => (s ?? "").Trim();

    /// <summary>Seçili kişiler ve son kaldırılanlar.</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS kod, kimlik_no AS kimlik, ad_soyad AS ad, unvan,
       ekleyen, ekleme, aktif, kaldiran, kaldirma, son_giris AS sonGiris
FROM KRY_PATRON
ORDER BY aktif DESC, ekleme DESC").ToList();

        /* Biçen360'a giriş yapmış mı: bildirim jetonu kaydı olan */
        var uygulamada = new HashSet<string>(
            db.Query<string>(@"
SELECT LTRIM(RTRIM(personel_kodu)) FROM KRY_MOBIL_JETON
WHERE jeton IS NOT NULL AND LEN(jeton) > 0"),
            StringComparer.OrdinalIgnoreCase);

        /* Mikro'daki güncel şube / ünvan / çalışma durumu */
        List<PersonelKaydi> tumu;

        try
        {
            tumu = _kaynak.TumPersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron listesi için Mikro okunamadı");
            tumu = new List<PersonelKaydi>();
        }

        var liste = kayitlar.Select(x =>
        {
            var kod = K((string)x.kod);
            var kimlik = K((string)x.kimlik);

            var m = tumu.FirstOrDefault(p => string.Equals(K(p.PersonelKodu), kod, StringComparison.OrdinalIgnoreCase))
                    ?? (kimlik.Length > 0 ? tumu.Where(p => K(p.KimlikNo) == kimlik).OrderByDescending(p => p.Durum).FirstOrDefault() : null);

            return new
            {
                id = (int)x.id,
                kod,
                ad = m is null ? (string)x.ad : $"{m.Ad} {m.Soyad}".Trim(),
                sube = m?.Sube,
                pozisyon = m?.Pozisyon ?? (string)x.unvan,
                calisiyor = m is not null && m.Durum == 1,
                uygulamada = uygulamada.Contains(kod) || (m is not null && uygulamada.Contains(K(m.PersonelKodu))),
                ekleyen = (string)x.ekleyen,
                ekleme = (DateTime)x.ekleme,
                aktif = (bool)x.aktif,
                kaldiran = (string)x.kaldiran,
                kaldirma = (DateTime?)x.kaldirma,
                sonGiris = (DateTime?)x.sonGiris
            };
        }).ToList();

        return Ok(new
        {
            patronlar = liste.Where(x => x.aktif).ToList(),
            kaldirilanlar = liste.Where(x => !x.aktif).Take(10).ToList()
        });
    }

    /// <summary>Eklenecek kişiyi aramak için: çalışan personel.</summary>
    [HttpGet("Ara")]
    public IActionResult Ara([FromQuery] string q)
    {
        if (!Yetkili) return Forbid();

        var ara = K(q).ToLower(new System.Globalization.CultureInfo("tr-TR"));

        if (ara.Length < 2) return Ok(new { sonuc = Array.Empty<object>() });

        var tr = new System.Globalization.CultureInfo("tr-TR");

        var sonuc = _kaynak.TumPersonelleriGetir()
            .Where(p => p.Durum == 1)
            .Where(p => $"{p.Ad} {p.Soyad} {p.PersonelKodu} {p.Sube} {p.Pozisyon}".ToLower(tr).Contains(ara))
            .Take(20)
            .Select(p => new
            {
                kod = K(p.PersonelKodu),
                ad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = p.Sube,
                pozisyon = p.Pozisyon
            })
            .ToList();

        return Ok(new { sonuc });
    }

    /// <summary>Kişiyi patron görünümüne ekler.</summary>
    [HttpPost]
    public IActionResult Ekle([FromBody] PatronGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        var kod = K(girdi?.Kod);

        if (kod.Length == 0) return BadRequest(new { hata = "Personel seçiniz." });

        var p = _kaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => string.Equals(K(x.PersonelKodu), kod, StringComparison.OrdinalIgnoreCase));

        if (p is null) return NotFound(new { hata = "Personel Mikro'da bulunamadı." });

        if (p.Durum != 1) return BadRequest(new { hata = "Ayrılmış personel eklenemez." });

        using var db = _vt.Baglanti();

        var varMi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_PATRON WHERE aktif = 1 AND LTRIM(RTRIM(personel_kodu)) = @kod",
            new { kod });

        if (varMi > 0) return BadRequest(new { hata = "Bu kişi zaten listede." });

        var adSoyad = $"{p.Ad} {p.Soyad}".Trim();

        db.Execute(@"
INSERT INTO KRY_PATRON (personel_kodu, kimlik_no, ad_soyad, unvan, ekleyen)
VALUES (@kod, @kimlik, @ad, @unvan, @ekleyen)",
            new
            {
                kod,
                kimlik = string.IsNullOrWhiteSpace(p.KimlikNo) ? null : p.KimlikNo.Trim(),
                ad = adSoyad,
                unvan = p.Pozisyon,
                ekleyen = Kullanici
            });

        _gunluk.Yaz("PATRON GÖRÜNÜMÜ EKLENDİ", IstemciAdresi.Bul(HttpContext),
            $"{Kullanici} → {adSoyad} ({kod})");

        return Ok(new { basarili = true });
    }

    /// <summary>Kişiyi listeden kaldırır (iz kalır).</summary>
    [HttpDelete("{id:int}")]
    public IActionResult Kaldir(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(
            "SELECT personel_kodu AS kod, ad_soyad AS ad FROM KRY_PATRON WHERE id = @id AND aktif = 1",
            new { id });

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        db.Execute(@"
UPDATE KRY_PATRON SET aktif = 0, kaldiran = @kullanici, kaldirma = SYSDATETIME()
WHERE id = @id", new { id, kullanici = Kullanici });

        _gunluk.Yaz("PATRON GÖRÜNÜMÜ KALDIRILDI", IstemciAdresi.Bul(HttpContext),
            $"{Kullanici} → {(string)kayit.ad} ({(string)kayit.kod})");

        return Ok(new { basarili = true });
    }
}

public class PatronGirdi
{
    public string Kod { get; set; }
}

using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Görüşme takviminin başvurulardan bağımsız parçaları.
///
/// <para>
/// İki şey tutulur: bir güne yazılan serbest notlar (istenirse belirli bir
/// zamanda hatırlatılır) ve elle oluşturulan görüşmeler. İkincisi başvurusu
/// olmayan kişiler içindir — mağazada çalışan biri ya da dışarıdan biri.
/// </para>
///
/// <para>
/// Notlar kişiye özeldir: herkes kendi notunu görür. Elle görüşmeler ise
/// takvimin ortak parçasıdır, ekip görsün diye herkese açıktır.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TakvimController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<TakvimController> _kayit;

    public TakvimController(VeritabaniServisi vt, ILogger<TakvimController> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";

    private string AdSoyad =>
        User.Claims.FirstOrDefault(x => x.Type == "adSoyad")?.Value ?? Kullanici;

    /* ==================================================================== */
    /* Notlar                                                               */
    /* ==================================================================== */

    /// <summary>Tarih aralığındaki kendi notlarım.</summary>
    [HttpGet("Notlar")]
    public IActionResult Notlar([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = (bas ?? DateTime.Today.AddDays(-30)).Date;
        var bitis = (bit ?? DateTime.Today.AddDays(60)).Date;

        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, gun, baslik, metin, hatirlatma, hatirlatildi,
       basvuru_id AS basvuruId, gorusme_id AS gorusmeId,
       kullanici_ad AS kullaniciAd, olusturma
FROM KRY_TAKVIM_NOT
WHERE kullanici = @kullanici AND gun BETWEEN @bas AND @bit
ORDER BY gun, ISNULL(hatirlatma, olusturma)",
            new { kullanici = Kullanici, bas = baslangic, bit = bitis }));
    }

    /// <summary>Not ekler ya da günceller.</summary>
    [HttpPost("Not")]
    public IActionResult NotKaydet([FromBody] TakvimNotGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Baslik))
            return BadRequest(new { hata = "Not başlığı zorunludur." });

        using var db = _vt.Baglanti();

        if (girdi.Id > 0)
        {
            /* Hatırlatma zamanı değiştiyse not yeniden hatırlatılabilsin */
            var etkilenen = db.Execute(@"
UPDATE KRY_TAKVIM_NOT
SET gun = @gun, baslik = @baslik, metin = @metin,
    hatirlatma = @hatirlatma,
    hatirlatildi = CASE WHEN @hatirlatma IS NULL THEN hatirlatildi
                        WHEN @hatirlatma > SYSDATETIME() THEN 0
                        ELSE hatirlatildi END
WHERE id = @id AND kullanici = @kullanici",
                new
                {
                    id = girdi.Id,
                    gun = girdi.Gun.Date,
                    baslik = girdi.Baslik.Trim(),
                    metin = girdi.Metin,
                    hatirlatma = girdi.Hatirlatma,
                    kullanici = Kullanici
                });

            return etkilenen == 0
                ? NotFound(new { hata = "Not bulunamadı." })
                : Ok(new { id = girdi.Id, tamam = true });
        }

        var yeni = db.ExecuteScalar<int>(@"
INSERT INTO KRY_TAKVIM_NOT
    (gun, baslik, metin, hatirlatma, basvuru_id, gorusme_id,
     kullanici, kullanici_ad)
OUTPUT INSERTED.id
VALUES (@gun, @baslik, @metin, @hatirlatma, @basvuruId, @gorusmeId,
        @kullanici, @kullaniciAd)",
            new
            {
                gun = girdi.Gun.Date,
                baslik = girdi.Baslik.Trim(),
                metin = girdi.Metin,
                hatirlatma = girdi.Hatirlatma,
                basvuruId = girdi.BasvuruId,
                gorusmeId = girdi.GorusmeId,
                kullanici = Kullanici,
                kullaniciAd = AdSoyad
            });

        return Ok(new { id = yeni, tamam = true });
    }

    /// <summary>Notu siler.</summary>
    [HttpDelete("Not/{id:int}")]
    public IActionResult NotSil(int id)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "DELETE FROM KRY_TAKVIM_NOT WHERE id = @id AND kullanici = @k",
            new { id, k = Kullanici });

        return etkilenen == 0
            ? NotFound(new { hata = "Not bulunamadı." })
            : Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Elle oluşturulan görüşmeler                                          */
    /* ==================================================================== */

    /// <summary>Tarih aralığındaki elle oluşturulmuş görüşmeler.</summary>
    [HttpGet("Gorusmeler")]
    public IActionResult Gorusmeler([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = (bas ?? DateTime.Today.AddDays(-30)).Date;
        var bitis = (bit ?? DateTime.Today.AddDays(60)).Date.AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, ad_soyad AS adSoyad, telefon, sube_adi AS subeAdi, gorev, tur,
       personel_kodu AS personelKodu, gorusme_tarihi AS gorusmeTarihi,
       gorusme_yeri AS gorusmeYeri, aciklama, durum, sonuc,
       olusturan_ad AS olusturanAd, olusturma
FROM KRY_MANUEL_GORUSME
WHERE gorusme_tarihi BETWEEN @bas AND @bit
ORDER BY gorusme_tarihi",
            new { bas = baslangic, bit = bitis }));
    }

    /// <summary>Elle görüşme oluşturur ya da günceller.</summary>
    [HttpPost("Gorusme")]
    public IActionResult GorusmeKaydet([FromBody] ManuelGorusmeGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.AdSoyad))
            return BadRequest(new { hata = "Ad soyad zorunludur." });

        if (girdi.GorusmeTarihi == default)
            return BadRequest(new { hata = "Görüşme tarihi zorunludur." });

        using var db = _vt.Baglanti();

        var alanlar = new
        {
            id = girdi.Id,
            adSoyad = girdi.AdSoyad.Trim(),
            telefon = girdi.Telefon,
            subeAdi = girdi.SubeAdi,
            gorev = girdi.Gorev,
            tur = string.IsNullOrWhiteSpace(girdi.Tur) ? "dis" : girdi.Tur,
            personelKodu = girdi.PersonelKodu,
            gorusmeTarihi = girdi.GorusmeTarihi,
            gorusmeYeri = girdi.GorusmeYeri,
            aciklama = girdi.Aciklama,
            durum = string.IsNullOrWhiteSpace(girdi.Durum) ? "Planlandı" : girdi.Durum,
            sonuc = girdi.Sonuc,
            kullanici = Kullanici,
            kullaniciAd = AdSoyad
        };

        if (girdi.Id > 0)
        {
            var etkilenen = db.Execute(@"
UPDATE KRY_MANUEL_GORUSME
SET ad_soyad = @adSoyad, telefon = @telefon, sube_adi = @subeAdi,
    gorev = @gorev, tur = @tur, personel_kodu = @personelKodu,
    gorusme_tarihi = @gorusmeTarihi, gorusme_yeri = @gorusmeYeri,
    aciklama = @aciklama, durum = @durum, sonuc = @sonuc
WHERE id = @id", alanlar);

            return etkilenen == 0
                ? NotFound(new { hata = "Görüşme bulunamadı." })
                : Ok(new { id = girdi.Id, tamam = true });
        }

        var yeni = db.ExecuteScalar<int>(@"
INSERT INTO KRY_MANUEL_GORUSME
    (ad_soyad, telefon, sube_adi, gorev, tur, personel_kodu,
     gorusme_tarihi, gorusme_yeri, aciklama, durum, sonuc,
     olusturan, olusturan_ad)
OUTPUT INSERTED.id
VALUES (@adSoyad, @telefon, @subeAdi, @gorev, @tur, @personelKodu,
        @gorusmeTarihi, @gorusmeYeri, @aciklama, @durum, @sonuc,
        @kullanici, @kullaniciAd)", alanlar);

        return Ok(new { id = yeni, tamam = true });
    }

    /// <summary>Elle görüşmeyi siler.</summary>
    [HttpDelete("Gorusme/{id:int}")]
    public IActionResult GorusmeSil(int id)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "DELETE FROM KRY_MANUEL_GORUSME WHERE id = @id", new { id });

        return etkilenen == 0
            ? NotFound(new { hata = "Görüşme bulunamadı." })
            : Ok(new { tamam = true });
    }
}

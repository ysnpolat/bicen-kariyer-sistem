using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Nöbet takvimi.
///
/// <para>
/// Merkez ofis beş haftada bir cumartesi nöbet tutuyor; sıra Excel'de
/// takip ediliyordu ve kimin ne zaman tutacağı ancak dosyayı açan kişi
/// tarafından biliniyordu. Nöbetçiye bildirim de gitmiyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class NobetController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<NobetController> _kayit;

    public NobetController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        BildirimServisi bildirim,
        ILogger<NobetController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _bildirim = bildirim;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private bool Duzenleyebilir =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi
            or Roller.GenelMudurYardimcisi;

    /* ====================================================================== */

    /// <summary>Bir tarih aralığındaki nöbetler.</summary>
    [HttpGet]
    public IActionResult Listele([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = (bas ?? DateTime.Today.AddMonths(-1)).Date;
        var bitis = (bit ?? DateTime.Today.AddMonths(3)).Date;

        using var db = _vt.Baglanti();

        var nobetler = db.Query(@"
SELECT id, tarih, personel_kodu AS personelKodu, ad_soyad AS adSoyad,
       pozisyon, grup_id AS grupId, aciklama, durum, olusturan, olusturma
FROM KRY_NOBET
WHERE tarih BETWEEN @baslangic AND @bitis
ORDER BY tarih, ad_soyad", new { baslangic, bitis }).ToList();

        var gruplar = db.Query(@"
SELECT id, ad, pozisyonlar FROM KRY_POZISYON_GRUBU
WHERE aktif = 1 ORDER BY sira, ad").ToList();

        return Ok(new { nobetler, gruplar, duzenleyebilir = Duzenleyebilir });
    }

    /// <summary>Personelin kendi nöbetleri; mobil ekran bunu gösteriyor.</summary>
    [HttpGet("Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Benim()
    {
        /* Sicil, mobil jetonun kullanıcı adında kodlu:
           "personel:14721|cihaz-abc". Ayrı bir alan yok. */
        var ad = User?.Identity?.Name ?? "";

        var kod = ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)
            ? ad["personel:".Length..].Split('|')[0]
            : null;

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        /* Geçmiş nöbetler de geliyor ama yalnızca son bir ay: personelin
           ihtiyacı "sırada ben var mıyım", geçmiş arşiv değil. */
        var nobetler = db.Query(@"
SELECT id, tarih, aciklama, durum FROM KRY_NOBET
WHERE personel_kodu = @kod AND tarih >= DATEADD(month, -1, CAST(SYSDATETIME() AS DATE))
ORDER BY tarih", new { kod = kod.Trim() }).ToList();

        return Ok(new { nobetler });
    }

    /// <summary>Tek bir nöbet ekler ya da günceller.</summary>
    [HttpPost]
    public async Task<IActionResult> Kaydet([FromBody] NobetGirdi girdi)
    {
        if (!Duzenleyebilir) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.PersonelKodu))
            return BadRequest(new { hata = "Personel seçiniz." });

        using var db = _vt.Baglanti();

        var kisi = Kisi(girdi.PersonelKodu);

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_NOBET
SET tarih = @tarih, personel_kodu = @kod, ad_soyad = @ad, pozisyon = @pozisyon,
    aciklama = @aciklama, durum = @durum
WHERE id = @id",
                new
                {
                    id = girdi.Id,
                    tarih = girdi.Tarih,
                    kod = girdi.PersonelKodu.Trim(),
                    ad = kisi?.Ad is null ? null : $"{kisi.Ad} {kisi.Soyad}".Trim(),
                    pozisyon = kisi?.Pozisyon,
                    aciklama = girdi.Aciklama,
                    durum = girdi.Durum ?? "planli"
                });

            return Ok(new { basarili = true, id = girdi.Id });
        }

        /* Aynı güne aynı kişi iki kez yazılamaz; tekil dizin zaten
           engelliyor ama hata mesajı anlaşılır olsun. */
        var varMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_NOBET WHERE tarih = @tarih AND personel_kodu = @kod",
            new { tarih = girdi.Tarih, kod = girdi.PersonelKodu.Trim() }) > 0;

        if (varMi)
            return BadRequest(new { hata = "Bu kişi o gün için zaten nöbetçi." });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_NOBET (tarih, personel_kodu, ad_soyad, pozisyon, grup_id,
                       aciklama, durum, olusturan)
OUTPUT INSERTED.id
VALUES (@tarih, @kod, @ad, @pozisyon, @grupId, @aciklama, N'planli', @olusturan)",
            new
            {
                tarih = girdi.Tarih,
                kod = girdi.PersonelKodu.Trim(),
                ad = kisi is null ? null : $"{kisi.Ad} {kisi.Soyad}".Trim(),
                pozisyon = kisi?.Pozisyon,
                grupId = girdi.GrupId,
                aciklama = girdi.Aciklama,
                olusturan = Kullanici
            });

        await Haberdar(girdi.PersonelKodu.Trim(), girdi.Tarih);

        return Ok(new { basarili = true, id });
    }

    /// <summary>
    /// Sırayla nöbet çizelgesi üretir.
    ///
    /// <para>
    /// Gruptaki personel ada göre sıralanıp seçilen gün her <c>periyot</c>
    /// haftada bir tekrarlanacak biçimde dağıtılıyor. Sıra Excel'de elle
    /// tutulduğunda birinin iki kez üst üste nöbet tutması ya da hiç
    /// tutmaması sık oluyordu.
    /// </para>
    ///
    /// <para>
    /// Var olan kayıtların üzerine yazılmıyor: elle yapılmış bir değişikliği
    /// otomatik üretim silmemeli.
    /// </para>
    /// </summary>
    [HttpPost("Uret")]
    public IActionResult Uret([FromBody] UretimGirdi girdi)
    {
        if (!Duzenleyebilir) return Forbid();

        if (girdi is null || girdi.GrupId <= 0)
            return BadRequest(new { hata = "Grup seçiniz." });

        if (girdi.Periyot is < 1 or > 12)
            return BadRequest(new { hata = "Periyot 1 ile 12 hafta arasında olmalı." });

        if (girdi.Hafta is < 1 or > 52)
            return BadRequest(new { hata = "Kaç hafta üretileceğini belirtiniz." });

        using var db = _vt.Baglanti();

        var grup = db.QueryFirstOrDefault(
            "SELECT ad, pozisyonlar FROM KRY_POZISYON_GRUBU WHERE id = @grupId",
            new { grupId = girdi.GrupId });

        if (grup is null) return BadRequest(new { hata = "Grup bulunamadı." });

        var pozisyonlar = ((string)grup.pozisyonlar ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(PersonelKaynagiServisi.MeslekAnahtari)
            .ToHashSet();

        List<PersonelKaydi> kisiler;

        try
        {
            kisiler = _kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1)
                .Where(x => pozisyonlar.Contains(
                    PersonelKaynagiServisi.MeslekAnahtari(x.Pozisyon ?? "")))
                .OrderBy(x => $"{x.Ad} {x.Soyad}")
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Nöbet için personel okunamadı");
            return StatusCode(500, new { hata = "Personel listesi alınamadı." });
        }

        if (kisiler.Count == 0)
            return BadRequest(new { hata = "Grupta çalışan personel yok." });

        /* İlk nöbet günü: başlangıçtan sonraki ilk seçilen gün */
        var gun = girdi.Baslangic.Date;

        while ((int)gun.DayOfWeek != girdi.Gun) gun = gun.AddDays(1);

        var eklenen = 0;
        var atlanan = 0;
        var sira = girdi.BaslangicSirasi is >= 0 ? girdi.BaslangicSirasi : 0;

        for (var h = 0; h < girdi.Hafta; h++)
        {
            var tarih = gun.AddDays(h * 7 * girdi.Periyot);
            var kisi = kisiler[(sira + h) % kisiler.Count];
            var kod = (kisi.PersonelKodu ?? "").Trim();

            var varMi = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_NOBET WHERE tarih = @tarih",
                new { tarih }) > 0;

            if (varMi) { atlanan++; continue; }

            db.Execute(@"
INSERT INTO KRY_NOBET (tarih, personel_kodu, ad_soyad, pozisyon, grup_id,
                       durum, olusturan)
VALUES (@tarih, @kod, @ad, @pozisyon, @grupId, N'planli', @olusturan)",
                new
                {
                    tarih, kod,
                    ad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                    pozisyon = kisi.Pozisyon,
                    grupId = girdi.GrupId,
                    olusturan = Kullanici
                });

            eklenen++;
        }

        return Ok(new
        {
            basarili = true,
            eklenen,
            atlanan,
            bilgi = atlanan > 0
                ? $"{atlanan} tarihte zaten nöbet vardı, üzerine yazılmadı."
                : null
        });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Duzenleyebilir) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute("DELETE FROM KRY_NOBET WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Nöbet bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    private PersonelKaydi Kisi(string kod)
    {
        try
        {
            return _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim() == kod.Trim());
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Nöbetçiye bildirim; kimin ne zaman tutacağı ona da ulaşmalı.</summary>
    private async Task Haberdar(string kod, DateTime tarih)
    {
        try
        {
            await _bildirim.Gonder(
                kod,
                "Nöbet göreviniz var",
                $"{tarih:dd.MM.yyyy} tarihinde nöbetçisiniz.",
                "nobet");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Nöbet bildirimi gönderilemedi: {Kod}", kod);
        }
    }
}

/* ========================================================================== */

public class NobetGirdi
{
    public int Id { get; set; }
    public DateTime Tarih { get; set; }
    public string PersonelKodu { get; set; }
    public int? GrupId { get; set; }
    public string Aciklama { get; set; }

    /// <summary>planli · tamamlandi · degisti</summary>
    public string Durum { get; set; }
}

public class UretimGirdi
{
    public int GrupId { get; set; }
    public DateTime Baslangic { get; set; }

    /// <summary>0=Pazar … 6=Cumartesi</summary>
    public int Gun { get; set; } = 6;

    /// <summary>Kaç haftada bir; merkez ofiste beş.</summary>
    public int Periyot { get; set; } = 5;

    /// <summary>Kaç nöbet üretilecek.</summary>
    public int Hafta { get; set; } = 12;

    /// <summary>Sıraya kaçıncı kişiden başlanacağı.</summary>
    public int BaslangicSirasi { get; set; }
}

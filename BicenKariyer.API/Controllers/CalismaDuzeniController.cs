using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Çalışma düzeni tanımları: resmi tatiller ve pozisyon grupları.
///
/// <para>
/// İkisi de yıllık izin hesabını doğrudan etkiliyor. Resmi tatil ve
/// haftalık izin günleri bakiyeden düşülmemeli; bu bilgi hiçbir yerde
/// tutulmadığı için hesap bütün takvim günlerini sayıyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class CalismaDuzeniController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly ILogger<CalismaDuzeniController> _kayit;

    public CalismaDuzeniController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        ILogger<CalismaDuzeniController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool Duzenleyebilir =>
        Rol is Roller.Admin or Roller.IKYoneticisi or Roller.GenelMudurYardimcisi;

    /* ====================================================================== */
    /* Resmi tatiller                                                        */
    /* ====================================================================== */

    /// <summary>Tanımlı resmi tatiller; yıl verilirse o yıla ait olanlar.</summary>
    [HttpGet("Tatiller")]
    public IActionResult Tatiller([FromQuery] int? yil = null)
    {
        using var db = _vt.Baglanti();

        var tatiller = db.Query(@"
SELECT id, tarih, ad, yarim_gun AS yarimGun, aktif
FROM KRY_RESMI_TATIL
WHERE (@yil IS NULL OR YEAR(tarih) = @yil)
ORDER BY tarih", new { yil }).ToList();

        var yillar = db.Query<int>(
            "SELECT DISTINCT YEAR(tarih) FROM KRY_RESMI_TATIL ORDER BY 1 DESC").ToList();

        return Ok(new { tatiller, yillar, duzenleyebilir = Duzenleyebilir });
    }

    /// <summary>Resmi tatil ekler ya da günceller.</summary>
    [HttpPost("Tatil")]
    public IActionResult TatilKaydet([FromBody] TatilGirdi girdi)
    {
        if (!Duzenleyebilir) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Ad))
            return BadRequest(new { hata = "Tatil adını giriniz." });

        using var db = _vt.Baglanti();

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_RESMI_TATIL
SET tarih = @Tarih, ad = @Ad, yarim_gun = @YarimGun, aktif = @Aktif
WHERE id = @Id", girdi);

            return Ok(new { basarili = true, id = girdi.Id });
        }

        /* Aynı güne ikinci tatil yazılamaz: izin hesabı o günü iki kez
           düşerdi. Var olan kayıt güncelleniyor. */
        var mevcut = db.ExecuteScalar<int?>(
            "SELECT id FROM KRY_RESMI_TATIL WHERE tarih = @tarih",
            new { tarih = girdi.Tarih });

        if (mevcut is int varOlan)
        {
            db.Execute(@"
UPDATE KRY_RESMI_TATIL
SET ad = @ad, yarim_gun = @yarimGun, aktif = 1 WHERE id = @id",
                new { ad = girdi.Ad, yarimGun = girdi.YarimGun, id = varOlan });

            return Ok(new { basarili = true, id = varOlan, guncellendi = true });
        }

        var yeni = db.ExecuteScalar<int>(@"
INSERT INTO KRY_RESMI_TATIL (tarih, ad, yarim_gun, aktif)
OUTPUT INSERTED.id VALUES (@Tarih, @Ad, @YarimGun, @Aktif)", girdi);

        return Ok(new { basarili = true, id = yeni });
    }

    [HttpDelete("Tatil/{id:int}")]
    public IActionResult TatilSil(int id)
    {
        if (!Duzenleyebilir) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute("DELETE FROM KRY_RESMI_TATIL WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Tatil bulunamadı." });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Sabit tarihli millî bayramları bir yıl için ekler.
    ///
    /// Dinî bayramların tarihi her yıl kaydığı için elle giriliyor; sabit
    /// olanları her yıl yeniden yazdırmanın anlamı yok.
    /// </summary>
    [HttpPost("TatilVarsayilan/{yil:int}")]
    public IActionResult TatilVarsayilan(int yil)
    {
        if (!Duzenleyebilir) return Forbid();

        if (yil is < 2020 or > 2100)
            return BadRequest(new { hata = "Yıl geçersiz." });

        var sabitler = new (int Ay, int Gun, string Ad)[]
        {
            (1, 1, "Yılbaşı"),
            (4, 23, "Ulusal Egemenlik ve Çocuk Bayramı"),
            (5, 1, "Emek ve Dayanışma Günü"),
            (5, 19, "Atatürk'ü Anma, Gençlik ve Spor Bayramı"),
            (7, 15, "Demokrasi ve Millî Birlik Günü"),
            (8, 30, "Zafer Bayramı"),
            (10, 29, "Cumhuriyet Bayramı"),
        };

        using var db = _vt.Baglanti();

        var eklenen = 0;

        foreach (var (ay, gun, ad) in sabitler)
        {
            var tarih = new DateTime(yil, ay, gun);

            var varMi = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_RESMI_TATIL WHERE tarih = @tarih", new { tarih }) > 0;

            if (varMi) continue;

            db.Execute(@"
INSERT INTO KRY_RESMI_TATIL (tarih, ad) VALUES (@tarih, @ad)",
                new { tarih, ad });

            eklenen++;
        }

        /* 28 Ekim yarım gün; ayrı ekleniyor çünkü diğerlerinden farklı */
        var arife = new DateTime(yil, 10, 28);

        if (db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_RESMI_TATIL WHERE tarih = @arife", new { arife }) == 0)
        {
            db.Execute(@"
INSERT INTO KRY_RESMI_TATIL (tarih, ad, yarim_gun)
VALUES (@arife, N'Cumhuriyet Bayramı arifesi', 1)", new { arife });

            eklenen++;
        }

        return Ok(new
        {
            basarili = true,
            eklenen,
            bilgi = "Dinî bayramlar her yıl kaydığı için elle eklenmelidir."
        });
    }

    /* ====================================================================== */
    /* Pozisyon grupları                                                     */
    /* ====================================================================== */

    /// <summary>Gruplar ve seçilebilecek ünvanlar.</summary>
    [HttpGet("Gruplar")]
    public IActionResult Gruplar()
    {
        using var db = _vt.Baglanti();

        var gruplar = db.Query(@"
SELECT id, ad, aciklama, pozisyonlar, haftalik_izin AS haftalikIzin,
       izin_gunleri AS izinGunleri, mesai_baslangic AS mesaiBaslangic,
       mesai_bitis AS mesaiBitis, hatirlatma_dakika AS hatirlatmaDakika,
       izin_secebilir AS izinSecebilir, is_atayabilir AS isAtayabilir,
       aktif, sira
FROM KRY_POZISYON_GRUBU ORDER BY sira, ad").ToList();

        /* Ünvan listesi Mikro'dan: elle yazılan ünvan adı eşleşmediğinde
           grup sessizce boşa düşüyordu. */
        var pozisyonlar = new List<string>();

        try
        {
            pozisyonlar = _kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.Pozisyon))
                .Select(x => x.Pozisyon.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ünvan listesi alınamadı");
        }

        return Ok(new { gruplar, pozisyonlar, duzenleyebilir = Duzenleyebilir });
    }

    /// <summary>Grup ekler ya da günceller.</summary>
    [HttpPost("Grup")]
    public IActionResult GrupKaydet([FromBody] GrupGirdi girdi)
    {
        if (!Duzenleyebilir) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Ad))
            return BadRequest(new { hata = "Grup adını giriniz." });

        using var db = _vt.Baglanti();

        var deger = new
        {
            girdi.Id,
            Ad = girdi.Ad.Trim(),
            girdi.Aciklama,

            /* Virgülle saklanıyor; ünvan adlarında virgül geçmiyor */
            Pozisyonlar = string.Join(",", (girdi.Pozisyonlar ?? new List<string>())
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Select(x => x.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)),

            girdi.HaftalikIzin,

            IzinGunleri = string.Join(",", (girdi.IzinGunleri ?? new List<int>())
                .Where(x => x is >= 0 and <= 6)
                .Distinct()
                .OrderBy(x => x)),

            /* Saat '08:30' biçiminde metin: sunucunun saat dilimi ve
               yaz saati değişimleri, zaman tipinde tutulduğunda bu basit
               ayarı gereksiz yere karmaşıklaştırıyordu. */
            MesaiBaslangic = Saat(girdi.MesaiBaslangic),
            MesaiBitis = Saat(girdi.MesaiBitis),
            HatirlatmaDakika = girdi.HatirlatmaDakika is >= 0 and <= 480
                ? girdi.HatirlatmaDakika : 30,

            girdi.IzinSecebilir,
            girdi.IsAtayabilir,

            girdi.Aktif,
            girdi.Sira
        };

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_POZISYON_GRUBU
SET ad = @Ad, aciklama = @Aciklama, pozisyonlar = @Pozisyonlar,
    haftalik_izin = @HaftalikIzin, izin_gunleri = @IzinGunleri,
    mesai_baslangic = @MesaiBaslangic, mesai_bitis = @MesaiBitis,
    hatirlatma_dakika = @HatirlatmaDakika, izin_secebilir = @IzinSecebilir,
    is_atayabilir = @IsAtayabilir, aktif = @Aktif, sira = @Sira
WHERE id = @Id", deger);

            return Ok(new { basarili = true, id = girdi.Id });
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_POZISYON_GRUBU
    (ad, aciklama, pozisyonlar, haftalik_izin, izin_gunleri,
     mesai_baslangic, mesai_bitis, hatirlatma_dakika, izin_secebilir,
     is_atayabilir, aktif, sira)
OUTPUT INSERTED.id
VALUES (@Ad, @Aciklama, @Pozisyonlar, @HaftalikIzin, @IzinGunleri,
        @MesaiBaslangic, @MesaiBitis, @HatirlatmaDakika, @IzinSecebilir,
        @IsAtayabilir, @Aktif, @Sira)",
            deger);

        return Ok(new { basarili = true, id });
    }

    /// <summary>"8:5" → "08:05"; geçersizse null.</summary>
    private static string Saat(string ham)
    {
        if (string.IsNullOrWhiteSpace(ham)) return null;

        var parca = ham.Trim().Split(':');

        if (parca.Length != 2) return null;

        if (!int.TryParse(parca[0], out var s) || !int.TryParse(parca[1], out var d))
            return null;

        if (s is < 0 or > 23 || d is < 0 or > 59) return null;

        return $"{s:00}:{d:00}";
    }

    [HttpDelete("Grup/{id:int}")]
    public IActionResult GrupSil(int id)
    {
        if (!Duzenleyebilir) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "DELETE FROM KRY_POZISYON_GRUBU WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Grup bulunamadı." });

        return Ok(new { basarili = true });
    }
}

/* ========================================================================== */

public class TatilGirdi
{
    public int Id { get; set; }
    public DateTime Tarih { get; set; }
    public string Ad { get; set; }

    /// <summary>Arife günleri; izin hesabında yarım gün düşülür.</summary>
    public bool YarimGun { get; set; }

    public bool Aktif { get; set; } = true;
}

public class GrupGirdi
{
    public int Id { get; set; }
    public string Ad { get; set; }
    public string Aciklama { get; set; }

    /// <summary>Mikro'daki ünvan adları.</summary>
    public List<string> Pozisyonlar { get; set; } = new();

    /// <summary>Haftada kaç gün izin kullanıldığı.</summary>
    public int HaftalikIzin { get; set; } = 1;

    /// <summary>0=Pazar … 6=Cumartesi</summary>
    public List<int> IzinGunleri { get; set; } = new();

    /// <summary>"08:30" biçiminde; boşsa hatırlatma gönderilmez.</summary>
    public string MesaiBaslangic { get; set; }

    public string MesaiBitis { get; set; }

    /// <summary>Mesai başlangıcından kaç dakika sonra hatırlatılacak.</summary>
    public int HatirlatmaDakika { get; set; } = 30;

    /// <summary>
    /// Personel haftalık izin gününü kendisi seçebilir mi.
    ///
    /// İzin günü sabit olan gruplarda kapalı: seçim ekranının çıkması
    /// personeli olmayan bir hakka yönlendiriyordu.
    /// </summary>
    public bool IzinSecebilir { get; set; }

    /// <summary>
    /// Mobil uygulamadan iş emri atayabilir mi.
    ///
    /// Yetki ünvan adından tahmin ediliyordu; ünvanında "müdür" geçmeyen
    /// ama işi atayan kişiler düğmeyi hiç göremiyordu.
    /// </summary>
    public bool IsAtayabilir { get; set; }

    public bool Aktif { get; set; } = true;
    public int Sira { get; set; }
}

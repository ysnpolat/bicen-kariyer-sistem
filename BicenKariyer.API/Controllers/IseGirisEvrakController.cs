using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İşe giriş evrakları (03.10.2026).
///
/// <para>
/// Başvurudan işe alımda istenen evraklar (ikametgâh, sabıka kaydı,
/// sağlık raporu…) tek tek yükleniyor. Aday henüz Mikro'da yokken
/// yüklenen evrak kimlik numarasıyla personel kartına düşüyor; eksik
/// kalanlar kartta "eksik evrak" olarak görünüyor. Eksik evrak işe alımı
/// durdurmuyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class IseGirisEvrakController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly IseGirisEvrakServisi _evrak;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<IseGirisEvrakController> _kayit;

    public IseGirisEvrakController(
        VeritabaniServisi vt,
        IseGirisEvrakServisi evrak,
        PersonelKaynagiServisi kaynak,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<IseGirisEvrakController> kayit)
    {
        _vt = vt;
        _evrak = evrak;
        _kaynak = kaynak;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>Evrak görme/yükleme: personel belgeleriyle aynı roller.</summary>
    private bool Yetkili => Roller.IslemYetkisi(Rol);

    /// <summary>Evrak listesini düzenleme ve başkasının yüklediğini kaldırma.</summary>
    private bool YoneticiMi => Roller.Temel(Rol) is Roller.Admin or Roller.IKYoneticisi;

    private static readonly string[] IzinliUzantilar =
        { ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx", ".txt" };

    /* ==================================================================== */
    /* Tanımlar                                                              */
    /* ==================================================================== */

    [HttpGet("Tanimlar")]
    public IActionResult Tanimlar()
    {
        if (!Yetkili) return Forbid();

        return Ok(new
        {
            evraklar = _evrak.TumTanimlar(),
            kategoriler = BelgeKategorileri.Tumu,
            duzenleyebilir = YoneticiMi
        });
    }

    [HttpPost("Tanimlar")]
    public IActionResult TanimlariKaydet([FromBody] EvrakTanimGirdi girdi)
    {
        if (!YoneticiMi) return Forbid();

        var liste = new List<EvrakTanimi>();
        var kodlar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var t in girdi?.Evraklar ?? new())
        {
            var ad = (t.Ad ?? "").Trim();

            if (ad.Length == 0) continue;

            /* Kod verilmemişse addan üretiliyor; var olan kod hiç
               değişmiyor, yüklenmiş belgeler ona bağlı. */
            var kod = string.IsNullOrWhiteSpace(t.Kod) ? KodUret(ad) : t.Kod.Trim();
            var temel = kod;

            for (var i = 2; !kodlar.Add(kod); i++) kod = $"{temel}_{i}";

            liste.Add(new EvrakTanimi
            {
                Kod = kod.Length > 40 ? kod[..40] : kod,
                Ad = ad.Length > 120 ? ad[..120] : ad,
                Kaynak = Kirp(t.Kaynak, 120),
                Kategori = BelgeKategorileri.Tumu.Contains(t.Kategori) ? t.Kategori : BelgeKategorileri.Ozluk,
                Adet = Math.Clamp(t.Adet, 1, 20),
                Not = Kirp(t.Not, 200),
                Aktif = t.Aktif
            });
        }

        if (liste.Count == 0)
            return BadRequest(new { hata = "En az bir evrak tanımlanmalı." });

        _evrak.TanimlariYaz(liste);

        return Ok(new { basarili = true, evraklar = liste });
    }

    /// <summary>Varsayılan listeye döner (kaydetmeden önizleme için).</summary>
    [HttpGet("Varsayilan")]
    public IActionResult Varsayilan() =>
        Yetkili ? Ok(new { evraklar = IseGirisEvrakAyari.Varsayilan() }) : Forbid();

    /* ==================================================================== */
    /* Durum                                                                 */
    /* ==================================================================== */

    /// <summary>Başvurunun evrak listesi.</summary>
    [HttpGet("Basvuru/{id:int}")]
    public IActionResult Basvuru(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        return Ok(_evrak.Durum(db, _evrak.BasvuruTakibi(db, id)));
    }

    /// <summary>Personelin evrak listesi ve başvuru formları.</summary>
    [HttpGet("Personel")]
    public IActionResult Personel([FromQuery] string kod)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        var kisi = Kisi(kod);
        var kimlik = IseGirisEvrakServisi.Kimlik(kisi?.KimlikNo);

        using var db = _vt.Baglanti();

        var takipId = kimlik is null ? null : _evrak.KimlikTakibi(db, kimlik);

        /* Özlük klasöründeki "Başvuru formu": kişinin kariyer sitesinden
           yaptığı başvurular, en yenisi önce. */
        var basvurular = kimlik is null
            ? new List<object>()
            : db.Query(@"
SELECT TOP 10 id, basvuru_no AS basvuruNo, olusturma, durum, sube_adi AS subeAdi,
       bolumler, ise_giris_bolum AS iseGirisBolum, ise_giris_tarihi AS iseGirisTarihi
FROM KRY_BASVURULAR
WHERE LTRIM(RTRIM(kimlik_no)) = @kimlik
ORDER BY olusturma DESC", new { kimlik }).Cast<object>().ToList();

        return Ok(new
        {
            durum = _evrak.Durum(db, takipId),
            basvurular,
            kimlikVar = kimlik is not null
        });
    }

    /// <summary>
    /// Personel kartından takibi başlatır: başvuru sistemi öncesinde işe
    /// girmiş ya da başvurusu olmayan personel için.
    /// </summary>
    [HttpPost("Baslat")]
    public IActionResult Baslat([FromBody] EvrakHedefGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var (takipId, hata) = TakipAc(db, girdi?.BasvuruId, girdi?.Kod);

        if (hata is not null) return BadRequest(new { hata });

        return Ok(new { basarili = true, takipId });
    }

    /* ==================================================================== */
    /* Yükleme ve işaretleme                                                 */
    /* ==================================================================== */

    /// <summary>Bir evraka bir ya da birden çok dosya yükler.</summary>
    [HttpPost("Yukle")]
    [RequestSizeLimit(209_715_200)]
    public async Task<IActionResult> Yukle(
        [FromForm] int? basvuruId,
        [FromForm] string kod,
        [FromForm] string evrakKodu)
    {
        if (!Yetkili) return Forbid();

        var tanim = _evrak.TumTanimlar().FirstOrDefault(x =>
            string.Equals(x.Kod, (evrakKodu ?? "").Trim(), StringComparison.OrdinalIgnoreCase));

        if (tanim is null) return BadRequest(new { hata = "Evrak tanımı bulunamadı." });

        var dosyalar = Request.HasFormContentType
            ? Request.Form.Files.Where(f => f.Length > 0).ToList()
            : new List<IFormFile>();

        if (dosyalar.Count == 0) return BadRequest(new { hata = "Dosya seçilmedi." });

        if (dosyalar.Count > 10) return BadRequest(new { hata = "Tek seferde en fazla 10 dosya yüklenebilir." });

        foreach (var f in dosyalar)
        {
            var u = Path.GetExtension(f.FileName ?? "").ToLowerInvariant();

            if (!IzinliUzantilar.Contains(u))
                return BadRequest(new
                {
                    hata = $"{f.FileName}: yalnızca PDF, resim, Word, Excel ve metin dosyaları yüklenebilir."
                });

            if (f.Length > 50L * 1024 * 1024)
                return BadRequest(new { hata = $"{f.FileName}: dosya 50 MB'tan büyük olamaz." });
        }

        using var db = _vt.Baglanti();

        var (takipId, hata) = TakipAc(db, basvuruId, kod);

        if (hata is not null) return BadRequest(new { hata });

        var takip = db.QueryFirst(@"
SELECT kimlik_no AS kimlik, basvuru_id AS basvuruId, ad_soyad AS adSoyad
FROM KRY_ISE_GIRIS_TAKIP WHERE id = @takipId", new { takipId });

        /* Personel kodu: karttan yüklendiyse o; adaydan yüklendiyse kimlik
           numarasıyla Mikro'da bulunursa o, yoksa boş (kart kimlikle
           eşleştiriyor). */
        var personelKodu = (kod ?? "").Trim();

        if (personelKodu.Length == 0 && (string)takip.kimlik is { } tk)
        {
            try
            {
                personelKodu = _kaynak.TumPersonelleriGetir()
                    .Where(x => IseGirisEvrakServisi.Kimlik(x.KimlikNo) == tk)
                    .OrderByDescending(x => x.GirisTarihi)
                    .FirstOrDefault()?.PersonelKodu?.Trim() ?? "";
            }
            catch
            {
                /* Mikro'ya ulaşılamazsa kimlikle eşleşmeye kalır */
            }
        }

        var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
        var tur = tanim.Kategori == BelgeKategorileri.Rapor ? "Sağlık Raporu" : "Özlük Evrakı";
        var eklenen = new List<int>();

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);
        }
        catch (Exception h)
        {
            _kayit.LogError(h, "Evrak klasörü oluşturulamadı: {Klasor}", klasor);
            return StatusCode(500, new { hata = $"Belge klasörüne yazılamıyor ({klasor})." });
        }

        var sira = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_PERSONEL_BELGE
WHERE takip_id = @takipId AND evrak_kodu = @ek AND silindi = 0",
            new { takipId, ek = tanim.Kod });

        foreach (var f in dosyalar)
        {
            var uzanti = Path.GetExtension(f.FileName ?? "").ToLowerInvariant();
            var on = personelKodu.Length > 0 ? personelKodu : $"evrak{takipId}";
            var diskAdi = $"{on}_{tanim.Kod}_{Guid.NewGuid():N}{uzanti}";

            try
            {
                await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);
                await f.CopyToAsync(akis);
            }
            catch (Exception h)
            {
                _kayit.LogError(h, "İşe giriş evrakı yazılamadı: {Klasor}", klasor);
                return StatusCode(500, new { hata = $"Belge sunucuya yazılamadı ({klasor})." });
            }

            sira++;

            var baslik = tanim.Adet > 1 || dosyalar.Count > 1 || sira > 1
                ? $"{tanim.Ad} ({sira})"
                : tanim.Ad;

            eklenen.Add(db.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama,
     dosya, ozgun_ad, boyut, yukleyen, personele_acik,
     kategori, evrak_kodu, basvuru_id, takip_id)
OUTPUT INSERTED.id
VALUES (@personelKodu, @kimlik, @adSoyad, @tur, @baslik, @aciklama,
        @diskAdi, @ozgunAd, @boyut, @yukleyen, 0,
        @kategori, @evrakKodu, @basvuruId, @takipId)",
                new
                {
                    personelKodu,
                    kimlik = (string)takip.kimlik,
                    adSoyad = (string)takip.adSoyad,
                    tur,
                    baslik = baslik.Length > 200 ? baslik[..200] : baslik,
                    aciklama = "İşe giriş evrakı" + (string.IsNullOrWhiteSpace(tanim.Kaynak) ? "" : $" · {tanim.Kaynak}"),
                    diskAdi,
                    ozgunAd = f.FileName,
                    boyut = f.Length,
                    yukleyen = Kullanici,
                    kategori = tanim.Kategori,
                    evrakKodu = tanim.Kod,
                    basvuruId = (int?)takip.basvuruId,
                    takipId
                }));
        }

        /* Yüklenen evrak için "Gerekmiyor" işareti kalkıyor */
        db.Execute(@"
DELETE FROM KRY_ISE_GIRIS_EVRAK_DURUM WHERE takip_id = @takipId AND evrak_kodu = @ek",
            new { takipId, ek = tanim.Kod });

        return Ok(new { basarili = true, eklenen, durum = _evrak.Durum(db, takipId) });
    }

    /// <summary>Evrakı "Gerekmiyor" işaretler ya da işareti kaldırır.</summary>
    [HttpPost("Durum")]
    public IActionResult Durum([FromBody] EvrakDurumGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.EvrakKodu))
            return BadRequest(new { hata = "Evrak seçilmedi." });

        using var db = _vt.Baglanti();

        var (takipId, hata) = TakipAc(db, girdi.BasvuruId, girdi.Kod);

        if (hata is not null) return BadRequest(new { hata });

        var ek = girdi.EvrakKodu.Trim();

        db.Execute(@"
DELETE FROM KRY_ISE_GIRIS_EVRAK_DURUM WHERE takip_id = @takipId AND evrak_kodu = @ek",
            new { takipId, ek });

        if (girdi.Gerekmiyor)
            db.Execute(@"
INSERT INTO KRY_ISE_GIRIS_EVRAK_DURUM (takip_id, evrak_kodu, durum, aciklama, guncelleyen)
VALUES (@takipId, @ek, @durum, @aciklama, @kullanici)",
                new
                {
                    takipId,
                    ek,
                    durum = IseGirisEvrakServisi.DurumGerekmiyor,
                    aciklama = Kirp(girdi.Aciklama, 300),
                    kullanici = Kullanici
                });

        return Ok(new { basarili = true, durum = _evrak.Durum(db, takipId) });
    }

    /// <summary>
    /// Yanlış yüklenen evrakı kaldırır. Yükleyen kişi 24 saat içinde
    /// kendi yüklediğini kaldırabiliyor; sonrası İK yöneticisinde.
    /// Kayıt gizleniyor, dosya diskte kalıyor.
    /// </summary>
    [HttpDelete("Belge/{id:int}")]
    public IActionResult BelgeKaldir(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var b = db.QueryFirstOrDefault(@"
SELECT takip_id AS takipId, yukleyen, olusturma FROM KRY_PERSONEL_BELGE
WHERE id = @id AND silindi = 0 AND takip_id IS NOT NULL", new { id });

        if (b is null) return NotFound(new { hata = "Evrak bulunamadı." });

        var kendisi = string.Equals((string)b.yukleyen, Kullanici, StringComparison.OrdinalIgnoreCase)
                      && (DateTime)b.olusturma > DateTime.Now.AddHours(-24);

        if (!YoneticiMi && !kendisi)
            return StatusCode(403, new
            {
                hata = "Yüklediğiniz evrakı 24 saat içinde kaldırabilirsiniz; sonrası için İK yöneticisine başvurunuz."
            });

        db.Execute(@"
UPDATE KRY_PERSONEL_BELGE SET silindi = 1, silen = @silen, silme_tarihi = SYSDATETIME()
WHERE id = @id", new { id, silen = Kullanici });

        return Ok(new { basarili = true, durum = _evrak.Durum(db, (int)b.takipId) });
    }

    /* ==================================================================== */

    /// <summary>Başvuru ya da personel için takibi bulur, yoksa açar.</summary>
    private (int TakipId, string Hata) TakipAc(System.Data.IDbConnection db, int? basvuruId, string kod)
    {
        if (basvuruId is > 0)
        {
            var adet = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_BASVURULAR WHERE id = @basvuruId",
                new { basvuruId });

            if (adet == 0) return (0, "Başvuru bulunamadı.");

            return (_evrak.BasvuruTakibiAc(db, basvuruId.Value, Kullanici), null);
        }

        if (string.IsNullOrWhiteSpace(kod)) return (0, "Başvuru ya da personel belirtilmedi.");

        var kisi = Kisi(kod);

        if (kisi is null) return (0, "Personel bulunamadı.");

        var kimlik = IseGirisEvrakServisi.Kimlik(kisi.KimlikNo);

        if (kimlik is null)
            return (0, "Personelin kimlik numarası Mikro'da kayıtlı değil; evrak takibi kimlik numarasıyla yapılıyor.");

        var mevcut = _evrak.KimlikTakibi(db, kimlik);

        if (mevcut is not null) return (mevcut.Value, null);

        /* Kişinin işe alındığı başvuru varsa takip ona bağlanıyor */
        var basvuru = db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM KRY_BASVURULAR
WHERE LTRIM(RTRIM(kimlik_no)) = @kimlik
  AND durum IN (N'İşe Alındı', N'Onay Bekliyor', N'Evrak Hazırlanıyor')
ORDER BY olusturma DESC", new { kimlik });

        if (basvuru is not null)
            return (_evrak.BasvuruTakibiAc(db, basvuru.Value, Kullanici), null);

        return (_evrak.Ac(db, kimlik, null, $"{kisi.Ad} {kisi.Soyad}".Trim(), Kullanici), null);
    }

    private PersonelKaydi Kisi(string kod)
    {
        try
        {
            return _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod.Trim(),
                    StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Evrak için personel okunamadı");
            return null;
        }
    }

    private static string Kirp(string s, int n)
    {
        s = (s ?? "").Trim();
        return s.Length == 0 ? null : s.Length > n ? s[..n] : s;
    }

    private static string KodUret(string ad)
    {
        var harita = new Dictionary<char, char>
        {
            ['ç'] = 'c', ['ğ'] = 'g', ['ı'] = 'i', ['i'] = 'i', ['ö'] = 'o', ['ş'] = 's', ['ü'] = 'u', ['â'] = 'a'
        };

        var s = new string(ad.ToLower(new System.Globalization.CultureInfo("tr-TR"))
            .Select(c => harita.TryGetValue(c, out var y) ? y : c)
            .Select(c => char.IsLetterOrDigit(c) && c < 128 ? c : '_')
            .ToArray());

        while (s.Contains("__")) s = s.Replace("__", "_");

        s = s.Trim('_');

        return s.Length == 0 ? "evrak" : s.Length > 36 ? s[..36] : s;
    }
}

public class EvrakTanimGirdi
{
    public List<EvrakTanimi> Evraklar { get; set; }
}

public class EvrakHedefGirdi
{
    public int? BasvuruId { get; set; }
    public string Kod { get; set; }
}

public class EvrakDurumGirdi
{
    public int? BasvuruId { get; set; }
    public string Kod { get; set; }
    public string EvrakKodu { get; set; }
    public bool Gerekmiyor { get; set; }
    public string Aciklama { get; set; }
}

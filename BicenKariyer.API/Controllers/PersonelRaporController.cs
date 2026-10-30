using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personelin sağlık raporları (03.10.2026).
///
/// <para>
/// Rapor kaydı tarih aralığı, tür ve açıklamadan oluşuyor; rapor belgesi
/// personel belgeleriyle AYNI yerde (KRY_PERSONEL_BELGE, "Sağlık Raporu"
/// türü) saklanıyor ve kayda <c>belge_id</c> ile bağlanıyor. Böylece belge
/// ayrıca yüklenmeden personelin Belgeler sekmesinde de görünüyor.
/// </para>
///
/// <para>
/// Yetki belgelerle aynı: rapor bir özlük evrakı; bölge müdürü ve
/// koordinatör listede yalnızca "raporlu" bilgisini ve bitiş tarihini
/// görüyor, türünü ve belgesini değil.
/// </para>
///
/// <para>
/// Onaylanan "Hastalık İzni (Rapor)" gibi izinler de listede görünüyor
/// ama salt okunur: onları izin akışı yönetiyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PersonelRaporController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly RaporluServisi _raporlu;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<PersonelRaporController> _kayit;

    public PersonelRaporController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        RaporluServisi raporlu,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<PersonelRaporController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _raporlu = raporlu;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>Personel belgeleriyle aynı roller (PersonelBelgeController.Yetkili)</summary>
    private bool Yetkili =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi;

    /// <summary>Belgeyi kaldırma, belgelerde olduğu gibi yalnızca yöneticide</summary>
    private bool BelgeSilmeYetkisi =>
        Rol is Roller.Admin or Roller.IKYoneticisi;

    private static readonly string[] IzinliUzantilar = { ".pdf", ".jpg", ".jpeg", ".png" };

    /// <summary>Rapor belgesinin üst sınırı: taranmış birkaç sayfa</summary>
    private const long EnBuyukDosya = 50L * 1024 * 1024;

    /// <summary>Belge türü; Belgeler sekmesindeki sabit listeden</summary>
    public const string BelgeTuru = "Sağlık Raporu";

    private static string BelgeBasligi(DateTime bas, DateTime bit) =>
        $"Sağlık raporu · {bas:dd.MM.yyyy}–{bit:dd.MM.yyyy}";

    private static bool Onizlenebilir(string uzanti) =>
        (uzanti ?? "").ToLowerInvariant() is ".pdf" or ".jpg" or ".jpeg" or ".png" or ".txt";

    /* ====================================================================== */
    /* Liste                                                                  */
    /* ====================================================================== */

    /// <summary>
    /// Bir personelin raporları: kart kayıtları ve rapor izinleri, yeniden
    /// eskiye. Bugünkü durum da birlikte döner (kart başlığındaki etiket).
    /// </summary>
    [HttpGet]
    public IActionResult Listele([FromQuery] string kod)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        kod = kod.Trim();
        var kimlik = KimlikBul(kod);

        var raporlar = new List<RaporSatiri>();

        try
        {
            using var db = _vt.Baglanti();

            /* Kart kayıtları: kod ya da kimlik numarası (geri dönüşlerde
               eski dönemin raporları da görünsün) */
            var satirlar = db.Query(@"
SELECT r.id, r.personel_kodu AS kod, r.baslangic, r.bitis, r.gun, r.rapor_turu AS tur,
       r.aciklama, r.olusturan, r.olusturma, r.guncelleyen, r.guncelleme,
       b.id AS belgeId, b.baslik AS belgeBaslik, b.ozgun_ad AS belgeAd,
       b.dosya AS belgeDosya, b.boyut AS belgeBoyut
FROM KRY_PERSONEL_RAPOR r
LEFT JOIN KRY_PERSONEL_BELGE b ON b.id = r.belge_id AND b.silindi = 0
WHERE r.iptal = 0
  AND (LTRIM(RTRIM(r.personel_kodu)) = @kod
       OR (@kimlik IS NOT NULL AND r.kimlik_no = @kimlik))
ORDER BY r.baslangic DESC, r.id DESC",
                new { kod, kimlik }).ToList();

            foreach (var r in satirlar)
                raporlar.Add(new RaporSatiri
                {
                    Id = (int)r.id,
                    PersonelKodu = ((string)r.kod ?? "").Trim(),
                    Baslangic = (DateTime)r.baslangic,
                    Bitis = (DateTime)r.bitis,
                    Gun = (int)r.gun,
                    RaporTuru = (string)r.tur,
                    Aciklama = (string)r.aciklama,
                    Olusturan = (string)r.olusturan,
                    Olusturma = (DateTime)r.olusturma,
                    Guncelleyen = (string)r.guncelleyen,
                    Guncelleme = (DateTime?)r.guncelleme,
                    Kaynak = RaporluServisi.KaynakRapor,
                    SaltOkunur = false,
                    Belge = BelgeOzeti((int?)r.belgeId, (string)r.belgeBaslik, (string)r.belgeAd,
                        (string)r.belgeDosya, (long?)r.belgeBoyut)
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel raporları okunamadı");
        }

        raporlar.AddRange(IzinRaporlari(kod));

        var bugun = _raporlu.Bul(kod, DateTime.Today);

        return Ok(new
        {
            raporlar = raporlar
                .OrderByDescending(x => x.Baslangic)
                .ThenBy(x => x.SaltOkunur)
                .ToList(),
            turler = RaporluServisi.Turler,
            bugun = bugun is null ? null : new
            {
                baslangic = bugun.Baslangic,
                bitis = bugun.Bitis,
                tur = bugun.Tur,
                kaynak = bugun.Kaynak
            },
            belgeSilebilir = BelgeSilmeYetkisi
        });
    }

    /// <summary>
    /// Türünde "Rapor" geçen izinler (onaylanan talepler ve İK'nın girdiği
    /// izinler). Salt okunur; talebe personelin yüklediği mazeret belgesi
    /// varsa bağlantısı da veriliyor.
    /// </summary>
    private List<RaporSatiri> IzinRaporlari(string kod)
    {
        var sonuc = new List<RaporSatiri>();

        try
        {
            using var db = _vt.Baglanti();

            List<dynamic> izinler;

            try
            {
                izinler = db.Query(@"
SELECT i.id, i.personel_kodu AS kod, i.tur, i.cikis_tarihi AS bas,
       CASE WHEN i.baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, i.baslama_tarihi)
            ELSE i.donus_tarihi END AS son,
       i.aciklama, i.giren, i.olusturma,
       t.id AS talepId,
       b.id AS belgeId, b.baslik AS belgeBaslik, b.ozgun_ad AS belgeAd,
       b.dosya AS belgeDosya, b.boyut AS belgeBoyut
FROM KRY_IZIN i
OUTER APPLY (SELECT TOP 1 x.id, x.mb_belge_id FROM KRY_IZIN_TALEP x
             WHERE x.izin_id = i.id ORDER BY x.id DESC) t
LEFT JOIN KRY_PERSONEL_BELGE b ON b.id = t.mb_belge_id AND b.silindi = 0
WHERE i.iptal = 0 AND i.tur LIKE N'%Rapor%'
  AND LTRIM(RTRIM(i.personel_kodu)) = @kod",
                    new { kod }).ToList();
            }
            catch
            {
                /* Talep tablosu eski yapıdaysa (mb_belge_id yok) belgesiz */
                izinler = db.Query(@"
SELECT i.id, i.personel_kodu AS kod, i.tur, i.cikis_tarihi AS bas,
       CASE WHEN i.baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, i.baslama_tarihi)
            ELSE i.donus_tarihi END AS son,
       i.aciklama, i.giren, i.olusturma,
       CAST(NULL AS INT) AS talepId, CAST(NULL AS INT) AS belgeId,
       CAST(NULL AS NVARCHAR(200)) AS belgeBaslik, CAST(NULL AS NVARCHAR(260)) AS belgeAd,
       CAST(NULL AS NVARCHAR(200)) AS belgeDosya, CAST(NULL AS BIGINT) AS belgeBoyut
FROM KRY_IZIN i
WHERE i.iptal = 0 AND i.tur LIKE N'%Rapor%'
  AND LTRIM(RTRIM(i.personel_kodu)) = @kod",
                    new { kod }).ToList();
            }

            foreach (var i in izinler)
            {
                var bas = (DateTime)i.bas;
                var son = (DateTime)i.son;

                sonuc.Add(new RaporSatiri
                {
                    Id = (int)i.id,
                    PersonelKodu = ((string)i.kod ?? "").Trim(),
                    Baslangic = bas,
                    Bitis = son,
                    Gun = (int)(son.Date - bas.Date).TotalDays + 1,
                    RaporTuru = (string)i.tur,
                    Aciklama = (string)i.aciklama,
                    Olusturan = (string)i.giren,
                    Olusturma = (DateTime)i.olusturma,
                    Kaynak = (int?)i.talepId is null ? RaporluServisi.KaynakIzin : RaporluServisi.KaynakTalep,
                    SaltOkunur = true,
                    Belge = BelgeOzeti((int?)i.belgeId, (string)i.belgeBaslik, (string)i.belgeAd,
                        (string)i.belgeDosya, (long?)i.belgeBoyut)
                });
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor izinleri okunamadı");
        }

        return sonuc;
    }

    private static object BelgeOzeti(int? id, string baslik, string ozgunAd, string dosya, long? boyut)
    {
        if (id is null) return null;

        var uzanti = Path.GetExtension(dosya ?? "").ToLowerInvariant();

        return new
        {
            id = id.Value,
            baslik,
            ozgunAd,
            boyut = boyut ?? 0,
            uzanti,
            onizlenebilir = Onizlenebilir(uzanti)
        };
    }

    /* ====================================================================== */
    /* Çakışma uyarıları                                                      */
    /* ====================================================================== */

    /// <summary>
    /// Tarih aralığının başka bir raporla ya da onaylı izinle çakışıp
    /// çakışmadığı. Engellemez; pencerede uyarı olarak gösterilir.
    /// </summary>
    [HttpGet("Cakisma")]
    public IActionResult Cakisma(
        [FromQuery] string kod, [FromQuery] string baslangic, [FromQuery] string bitis,
        [FromQuery] int? haricId = null)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod) || !TarihOku(baslangic, out var bas) || !TarihOku(bitis, out var bit))
            return Ok(new { uyarilar = Array.Empty<string>() });

        return Ok(new { uyarilar = Uyarilar(kod.Trim(), bas, bit, haricId) });
    }

    private List<string> Uyarilar(string kod, DateTime bas, DateTime bit, int? haricId)
    {
        var uyarilar = new List<string>();

        if (bit < bas) return uyarilar;

        var kimlik = KimlikBul(kod);

        try
        {
            using var db = _vt.Baglanti();

            foreach (var r in db.Query(@"
SELECT baslangic, bitis, rapor_turu AS tur FROM KRY_PERSONEL_RAPOR
WHERE iptal = 0 AND id <> @haric
  AND (LTRIM(RTRIM(personel_kodu)) = @kod OR (@kimlik IS NOT NULL AND kimlik_no = @kimlik))
  AND baslangic <= @bit AND bitis >= @bas",
                         new { kod, kimlik, bas, bit, haric = haricId ?? 0 }))
            {
                uyarilar.Add(
                    $"{(DateTime)r.baslangic:dd.MM.yyyy}–{(DateTime)r.bitis:dd.MM.yyyy} tarihli başka bir rapor kaydıyla ({(string)r.tur}) çakışıyor.");
            }
        }
        catch
        {
            /* Tablo yoksa çakışma denetimi yapılmaz */
        }

        try
        {
            using var db = _vt.Baglanti();

            foreach (var i in db.Query(@"
SELECT tur, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son
FROM KRY_IZIN
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) = @kod
  AND cikis_tarihi <= @bit
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @bas",
                         new { kod, bas, bit }))
            {
                var tur = (string)i.tur ?? "İzin";
                var aralik = $"{(DateTime)i.bas:dd.MM.yyyy}–{(DateTime)i.son:dd.MM.yyyy}";

                uyarilar.Add(tur.Contains("Rapor", StringComparison.OrdinalIgnoreCase)
                    ? $"Bu tarihlerde onaylı \"{tur}\" var ({aralik}); aynı rapor izin olarak da girilmiş olabilir."
                    : $"{aralik} tarihli onaylı {tur} ile çakışıyor.");
            }
        }
        catch
        {
            /* İzin tablosu okunamazsa uyarı yok */
        }

        return uyarilar;
    }

    /* ====================================================================== */
    /* Ekle / düzenle / kaldır                                                */
    /* ====================================================================== */

    /// <summary>Rapor ekler; dosya isteğe bağlı.</summary>
    [HttpPost]
    [RequestSizeLimit(60_000_000)]
    public async Task<IActionResult> Ekle(
        [FromForm] string kod,
        [FromForm] string baslangic,
        [FromForm] string bitis,
        [FromForm] string raporTuru,
        [FromForm] string aciklama,
        IFormFile dosya)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        kod = kod.Trim();

        var (bas, bit, tur, tarihHatasi) = Dogrula(baslangic, bitis, raporTuru);
        if (tarihHatasi is not null) return BadRequest(new { hata = tarihHatasi });

        dosya ??= IlkDosya();

        var dosyaHatasi = DosyaDenetle(dosya);
        if (dosyaHatasi is not null) return BadRequest(new { hata = dosyaHatasi });

        var kisi = KisiBul(kod);
        var kimlik = (kisi?.KimlikNo ?? "").Trim();
        var adSoyad = kisi is null ? null : $"{kisi.Ad} {kisi.Soyad}".Trim();

        aciklama = Kisalt(aciklama, 500);

        int? belgeId = null;

        if (dosya is not null)
        {
            var (yeniId, hata) = await BelgeYaz(kod, kimlik, adSoyad, bas, bit, tur, aciklama, dosya);
            if (hata is not null) return StatusCode(500, new { hata });
            belgeId = yeniId;
        }

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_RAPOR
    (personel_kodu, kimlik_no, ad_soyad, baslangic, bitis, rapor_turu, aciklama,
     belge_id, olusturan)
OUTPUT INSERTED.id
VALUES (@kod, @kimlik, @adSoyad, @bas, @bit, @tur, @aciklama, @belgeId, @olusturan)",
            new
            {
                kod,
                kimlik = kimlik.Length > 0 ? kimlik : null,
                adSoyad,
                bas,
                bit,
                tur,
                aciklama,
                belgeId,
                olusturan = Kullanici
            });

        RaporluServisi.Temizle();

        return Ok(new { id, tamam = true, uyarilar = Uyarilar(kod, bas, bit, id) });
    }

    /// <summary>
    /// Raporu düzenler. Yeni dosya gelirse yeni belge yazılır, eskisi
    /// belgelerden kaldırılır (sahipsiz belge kalmasın). <paramref name="belgeKaldir"/>
    /// ile dosya bağı koparılıp belge de kaldırılabilir.
    /// </summary>
    [HttpPost("{id:int}")]
    [RequestSizeLimit(60_000_000)]
    public async Task<IActionResult> Duzenle(
        int id,
        [FromForm] string baslangic,
        [FromForm] string bitis,
        [FromForm] string raporTuru,
        [FromForm] string aciklama,
        [FromForm] bool belgeKaldir,
        IFormFile dosya)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var mevcut = db.QueryFirstOrDefault(@"
SELECT personel_kodu AS kod, kimlik_no AS kimlik, ad_soyad AS adSoyad, belge_id AS belgeId
FROM KRY_PERSONEL_RAPOR WHERE id = @id AND iptal = 0", new { id });

        if (mevcut is null) return NotFound(new { hata = "Rapor bulunamadı." });

        var (bas, bit, tur, tarihHatasi) = Dogrula(baslangic, bitis, raporTuru);
        if (tarihHatasi is not null) return BadRequest(new { hata = tarihHatasi });

        dosya ??= IlkDosya();

        var dosyaHatasi = DosyaDenetle(dosya);
        if (dosyaHatasi is not null) return BadRequest(new { hata = dosyaHatasi });

        var kod = ((string)mevcut.kod ?? "").Trim();
        var eskiBelge = (int?)mevcut.belgeId;
        var yeniBelge = eskiBelge;

        aciklama = Kisalt(aciklama, 500);

        if (dosya is not null)
        {
            var (yeniId, hata) = await BelgeYaz(kod, (string)mevcut.kimlik, (string)mevcut.adSoyad,
                bas, bit, tur, aciklama, dosya);

            if (hata is not null) return StatusCode(500, new { hata });

            yeniBelge = yeniId;
        }
        else if (belgeKaldir)
        {
            yeniBelge = null;
        }

        db.Execute(@"
UPDATE KRY_PERSONEL_RAPOR
SET baslangic = @bas, bitis = @bit, rapor_turu = @tur, aciklama = @aciklama,
    belge_id = @belgeId, guncelleyen = @kisi, guncelleme = SYSDATETIME()
WHERE id = @id",
            new { id, bas, bit, tur, aciklama, belgeId = yeniBelge, kisi = Kullanici });

        /* Değişen ya da kaldırılan belge belgelerden de kaldırılıyor: dosya
           diskte duruyor (belgelerdeki kaldırma gibi), yalnızca listeden
           çıkıyor. Böylece Belgeler sekmesinde sahipsiz "Sağlık raporu"
           kalmıyor. */
        if (eskiBelge is not null && eskiBelge != yeniBelge)
            BelgeKaldir(db, eskiBelge.Value);

        /* Tarih ya da tür değiştiyse aynı belgenin başlığı da güncellensin */
        if (yeniBelge is not null && yeniBelge == eskiBelge)
        {
            db.Execute(@"
UPDATE KRY_PERSONEL_BELGE SET baslik = @baslik, aciklama = @aciklama
WHERE id = @belgeId AND tur = @belgeTuru AND silindi = 0",
                new
                {
                    belgeId = yeniBelge,
                    baslik = BelgeBasligi(bas, bit),
                    aciklama = BelgeAciklamasi(bas, bit, tur, aciklama),
                    belgeTuru = BelgeTuru
                });
        }

        RaporluServisi.Temizle();

        return Ok(new { id, tamam = true, uyarilar = Uyarilar(kod, bas, bit, id) });
    }

    /// <summary>
    /// Raporu kaldırır (iptal işaretlenir, kayıt silinmez). Belge varsayılan
    /// olarak belgelerde kalır; <paramref name="belgeSil"/> ile o da
    /// kaldırılır — bu, belgelerdeki gibi yalnızca yöneticide.
    /// </summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id, [FromQuery] bool belgeSil = false)
    {
        if (!Yetkili) return Forbid();

        if (belgeSil && !BelgeSilmeYetkisi)
            return StatusCode(403, new
            {
                hata = "Belgeyi kaldırma yetkisi yalnızca İK yöneticisinde. Raporu belgeyi bırakarak kaldırabilirsiniz."
            });

        using var db = _vt.Baglanti();

        var belgeId = db.QueryFirstOrDefault<int?>(
            "SELECT belge_id FROM KRY_PERSONEL_RAPOR WHERE id = @id AND iptal = 0", new { id });

        var etkilenen = db.Execute(@"
UPDATE KRY_PERSONEL_RAPOR
SET iptal = 1, guncelleyen = @kisi, guncelleme = SYSDATETIME()
WHERE id = @id AND iptal = 0", new { id, kisi = Kullanici });

        if (etkilenen == 0) return NotFound(new { hata = "Rapor bulunamadı." });

        if (belgeSil && belgeId is not null) BelgeKaldir(db, belgeId.Value);

        RaporluServisi.Temizle();

        return Ok(new { basarili = true, belgeKaldirildi = belgeSil && belgeId is not null });
    }

    /* ====================================================================== */
    /* Yardımcılar                                                            */
    /* ====================================================================== */

    private static bool TarihOku(string metin, out DateTime tarih) =>
        DateTime.TryParseExact((metin ?? "").Trim(), new[] { "yyyy-MM-dd", "dd.MM.yyyy", "yyyy-MM-ddTHH:mm:ss" },
            CultureInfo.InvariantCulture, DateTimeStyles.None, out tarih);

    private static (DateTime Bas, DateTime Bit, string Tur, string Hata) Dogrula(
        string baslangic, string bitis, string raporTuru)
    {
        if (!TarihOku(baslangic, out var bas))
            return (default, default, null, "Rapor başlangıç tarihi giriniz.");

        if (!TarihOku(bitis, out var bit))
            return (default, default, null, "Rapor bitiş tarihi giriniz.");

        bas = bas.Date;
        bit = bit.Date;

        if (bit < bas)
            return (default, default, null, "Bitiş tarihi başlangıç tarihinden önce olamaz.");

        /* Analık raporu dahil bir yılı aşan tek kayıt yazım hatasıdır */
        if ((bit - bas).TotalDays > 366)
            return (default, default, null, "Rapor süresi bir yılı aşamaz; tarihleri kontrol ediniz.");

        /* Kapatılmış tür de kabul (eski kaydın düzenlenmesi) */
        var tur = SecenekListesi.Tumu("raporTurleri").Select(x => x.Ad).FirstOrDefault(x =>
            string.Equals(x, (raporTuru ?? "").Trim(), StringComparison.OrdinalIgnoreCase)) ?? "Diğer";

        return (bas, bit, tur, null);
    }

    private IFormFile IlkDosya() =>
        Request.HasFormContentType ? Request.Form.Files.FirstOrDefault() : null;

    private static string DosyaDenetle(IFormFile dosya)
    {
        if (dosya is null) return null;

        if (dosya.Length == 0) return "Seçilen dosya boş.";

        if (dosya.Length > EnBuyukDosya) return "Rapor belgesi en fazla 50 MB olabilir.";

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        return IzinliUzantilar.Contains(uzanti)
            ? null
            : "Rapor belgesi PDF, JPG ya da PNG olmalı.";
    }

    private static string Kisalt(string metin, int uzunluk)
    {
        var t = (metin ?? "").Trim();
        if (t.Length == 0) return null;
        return t.Length > uzunluk ? t[..uzunluk] : t;
    }

    private static string BelgeAciklamasi(DateTime bas, DateTime bit, string tur, string aciklama)
    {
        var gun = (int)(bit - bas).TotalDays + 1;
        var metin = $"{tur} · {gun} gün";
        return string.IsNullOrWhiteSpace(aciklama) ? metin : $"{metin} · {aciklama}";
    }

    /// <summary>
    /// Dosyayı personel belgeleriyle aynı klasöre ve tabloya yazar
    /// (PersonelBelgeController.Yukle ile aynı adlandırma).
    /// </summary>
    private async Task<(int? Id, string Hata)> BelgeYaz(
        string kod, string kimlik, string adSoyad, DateTime bas, DateTime bit, string tur,
        string aciklama, IFormFile dosya)
    {
        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();
        var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
        var diskAdi = $"{kod}_{Guid.NewGuid():N}{uzanti}";

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);

            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Rapor belgesi yazılamadı: {Klasor}", klasor);

            return (null, $"Belge sunucuya yazılamadı ({klasor}). Klasöre yazma izni verilmeli.");
        }

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama,
     dosya, ozgun_ad, boyut, yukleyen, personele_acik)
OUTPUT INSERTED.id
VALUES (@kod, @kimlik, @adSoyad, @tur, @baslik, @aciklama,
        @diskAdi, @ozgunAd, @boyut, @yukleyen, 0)",
            new
            {
                kod,
                kimlik = string.IsNullOrWhiteSpace(kimlik) ? null : kimlik.Trim(),
                adSoyad,
                tur = BelgeTuru,
                baslik = BelgeBasligi(bas, bit),
                aciklama = BelgeAciklamasi(bas, bit, tur, aciklama),
                diskAdi,
                ozgunAd = dosya.FileName,
                boyut = dosya.Length,
                yukleyen = Kullanici
            });

        return (id, null);
    }

    /// <summary>Belgeyi belgelerdeki gibi kaldırır: kayıt gizlenir, dosya diskte kalır.</summary>
    private void BelgeKaldir(System.Data.IDbConnection db, int belgeId)
    {
        db.Execute(@"
UPDATE KRY_PERSONEL_BELGE
SET silindi = 1, silen = @silen, silme_tarihi = SYSDATETIME()
WHERE id = @id AND silindi = 0", new { id = belgeId, silen = Kullanici });
    }

    private PersonelKaydi KisiBul(string kod)
    {
        try
        {
            return _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod.Trim(),
                    StringComparison.OrdinalIgnoreCase));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor için personel okunamadı");
            return null;
        }
    }

    private string KimlikBul(string kod)
    {
        var kimlik = KisiBul(kod)?.KimlikNo;
        return string.IsNullOrWhiteSpace(kimlik) ? null : kimlik.Trim();
    }
}

/// <summary>Personel kartındaki rapor listesinin satırı</summary>
public class RaporSatiri
{
    public int Id { get; set; }
    public string PersonelKodu { get; set; }
    public DateTime Baslangic { get; set; }
    public DateTime Bitis { get; set; }
    public int Gun { get; set; }
    public string RaporTuru { get; set; }
    public string Aciklama { get; set; }
    public string Olusturan { get; set; }
    public DateTime Olusturma { get; set; }
    public string Guncelleyen { get; set; }
    public DateTime? Guncelleme { get; set; }

    /// <summary>rapor (kart kaydı) · izin (İK'nın girdiği izin) · talep (onaylanan izin talebi)</summary>
    public string Kaynak { get; set; }

    /// <summary>İzinden gelenler kartta düzenlenemez</summary>
    public bool SaltOkunur { get; set; }

    public object Belge { get; set; }
}

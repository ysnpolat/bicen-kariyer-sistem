using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel belgeleri: tutanak, ihtar, savunma, sözleşme gibi evraklar.
///
/// <para>
/// Dosyanın kendisi diskte, künyesi tabloda duruyor. İkili veriyi tabloya
/// koymak yedek boyutunu hızla şişiriyordu.
/// </para>
///
/// <para>
/// Belgeler kimlik numarasıyla da eşleşiyor: personel ayrılıp geri
/// döndüğünde Mikro yeni bir personel kodu veriyor ve eski tutanakları
/// kartında görünmez oluyordu. Kimlik numarası kayıt anında yazıldığı için
/// yeni kartta da listeleniyorlar.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PersonelBelgeController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly BildirimServisi _bildirim;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<PersonelBelgeController> _kayit;

    public PersonelBelgeController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        BildirimServisi bildirim,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<PersonelBelgeController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _bildirim = bildirim;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>
    /// Belge görme ve yükleme yetkisi.
    ///
    /// Tutanak ve ihtar özlük evrakı; bölge müdürü ve koordinatör
    /// personelin kimlik bilgilerini bile göremezken bunları görmemeli.
    /// Fotoğraf görevlisi de yalnızca resim yüklüyor.
    /// </summary>
    private bool Yetkili =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi;

    /// <summary>Silme yalnızca yöneticide: yanlışlıkla kaldırılan tutanak geri gelmiyor.</summary>
    private bool SilmeYetkisi =>
        Rol is Roller.Admin or Roller.IKYoneticisi;

    private static readonly string[] IzinliUzantilar =
        { ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx", ".txt" };

    /// <summary>Dosya uzantısından tarayıcının anlayacağı tür.</summary>
    private static string TurBul(string uzanti) => uzanti.ToLowerInvariant() switch
    {
        ".pdf" => "application/pdf",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".txt" => "text/plain; charset=utf-8",
        ".doc" => "application/msword",
        ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls" => "application/vnd.ms-excel",
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream"
    };

    /// <summary>Önizlenebilir mi; değilse ekranda indirme önerilir.</summary>
    private static bool Onizlenebilir(string uzanti) =>
        uzanti.ToLowerInvariant() is ".pdf" or ".jpg" or ".jpeg" or ".png" or ".txt";

    /* ====================================================================== */

    /// <summary>Bir personelin belgeleri.</summary>
    [HttpGet]
    public IActionResult Listele([FromQuery] string kod)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        using var db = _vt.Baglanti();

        var kimlik = KimlikBul(kod);

        /* Personel kodu ya da kimlik numarası eşleşen belgeler: aynı kişinin
           önceki çalışma dönemindeki evrakları da görünsün. */
        var ham = db.Query(@"
SELECT id, personel_kodu AS personelKodu, tur, baslik, aciklama,
       dosya, ozgun_ad AS ozgunAd, boyut, yukleyen, olusturma,
       personele_acik AS personeleAcik,
       kategori, evrak_kodu AS evrakKodu
FROM KRY_PERSONEL_BELGE
WHERE silindi = 0
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik IS NOT NULL AND kimlik_no = @kimlik))
ORDER BY olusturma DESC",
            new { kod = kod.Trim(), kimlik }).ToList();

        /* Uzantı ve önizlenebilirlik istemciye burada söyleniyor: panel
           "indirmeden bakılabilir mi" kararını dosya adını ayrıştırarak
           vermek zorunda kalmasın. */
        /* Alan adları tek tek yazılıyor: dinamik satırdan ad çıkarımıyla
           anonim tip kurmak derlenmiyor. */
        var belgeler = ham.Select(b =>
        {
            var uzanti = Path.GetExtension((string)b.dosya ?? "").ToLowerInvariant();

            return new
            {
                id = (int)b.id,
                personelKodu = (string)b.personelKodu,
                tur = (string)b.tur,
                baslik = (string)b.baslik,
                aciklama = (string)b.aciklama,
                ozgunAd = (string)b.ozgunAd,
                boyut = (long)b.boyut,
                yukleyen = (string)b.yukleyen,
                olusturma = (DateTime)b.olusturma,
                personeleAcik = (bool)b.personeleAcik,
                /* Klasör (03.10.2026): kategorisi yazılmamış eski belgeler
                   türünden yerleştiriliyor */
                kategori = BelgeKategorileri.Bul((string)b.kategori, (string)b.tur, (string)b.aciklama),
                evrakKodu = (string)b.evrakKodu,
                uzanti,
                onizlenebilir = Onizlenebilir(uzanti)
            };
        }).ToList();

        return Ok(new { belgeler, silebilir = SilmeYetkisi, kategoriler = BelgeKategorileri.Tumu });
    }

    /// <summary>Belge yükler.</summary>
    [HttpPost]
    /* 500 MB: taranmış sözleşme ve toplu tutanak ekleri bu boyuta
       ulaşabiliyor. Program.cs'teki form ve sunucu sınırları da aynı
       değere çekildi; biri eksik kalırsa istek buraya hiç ulaşmıyor. */
    [RequestSizeLimit(524_288_000)]
    public async Task<IActionResult> Yukle(
        [FromForm] string kod,
        [FromForm] string tur,
        [FromForm] string baslik,
        [FromForm] string aciklama,
        [FromForm] bool personeleAcik,
        IFormFile dosya,
        [FromForm] string kategori = null)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(kod))
            return BadRequest(new { hata = "Personel kodu gereklidir." });

        /* Alan adı tutmazsa gövdedeki ilk dosya alınıyor: istemcideki bir
           adlandırma değişikliği yüklemeyi sessizce bozmasın. */
        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Dosya seçilmedi." });

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        if (!IzinliUzantilar.Contains(uzanti))
            return BadRequest(new
            {
                hata = "Yalnızca PDF, resim, Word, Excel ve metin dosyaları yüklenebilir."
            });

        var kisi = _kaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod.Trim(),
                StringComparison.OrdinalIgnoreCase));

        /* Kimlik numarası kayıt anında yazılıyor: personel geri döndüğünde
           Mikro yeni personel kodu veriyor ve eski belgeleri yeni kartında
           görünmez oluyordu. */
        var kimlikNo = (kisi?.KimlikNo ?? "").Trim();

        var klasor = Klasor();

        /* Diskteki ad rastgele: kullanıcının verdiği ad Türkçe karakter,
           boşluk ve yol ayracı içerebiliyor. Özgün ad ayrı sütunda duruyor
           ve indirirken geri veriliyor. */
        var diskAdi = $"{kod.Trim()}_{Guid.NewGuid():N}{uzanti}";

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);

            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Personel belgesi yazılamadı: {Klasor}", klasor);

            return StatusCode(500, new
            {
                hata = $"Belge sunucuya yazılamadı ({klasor}). Klasöre yazma izni verilmeli."
            });
        }

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama,
     dosya, ozgun_ad, boyut, yukleyen, personele_acik, kategori)
OUTPUT INSERTED.id
VALUES (@kod, @kimlik, @adSoyad, @tur, @baslik, @aciklama,
        @diskAdi, @ozgunAd, @boyut, @yukleyen, @personeleAcik, @kategori)",
            new
            {
                kod = kod.Trim(),
                kimlik = kimlikNo.Length > 0 ? kimlikNo : null,
                adSoyad = kisi is null ? null : $"{kisi.Ad} {kisi.Soyad}".Trim(),
                tur = string.IsNullOrWhiteSpace(tur) ? "Diğer" : tur.Trim(),

                /* Başlık boşsa dosya adı kullanılıyor: listede başlıksız
                   satırlar birbirinden ayırt edilemiyordu. */
                baslik = string.IsNullOrWhiteSpace(baslik)
                    ? Path.GetFileNameWithoutExtension(dosya.FileName ?? "Belge")
                    : baslik.Trim(),

                aciklama = string.IsNullOrWhiteSpace(aciklama) ? null : aciklama.Trim(),
                diskAdi,
                ozgunAd = dosya.FileName,
                boyut = dosya.Length,
                yukleyen = Kullanici,
                personeleAcik,
                /* Hangi klasöre yüklendiyse o; seçilmediyse türünden */
                kategori = BelgeKategorileri.Tumu.Contains((kategori ?? "").Trim())
                    ? kategori.Trim()
                    : BelgeKategorileri.Bul(null, tur, aciklama)
            });

        /* Bildirim yalnızca personele açılan belgede: göremeyeceği bir
           evrak için bildirim almak personeli boşuna tedirgin ediyor. */
        if (personeleAcik)
            await _bildirim.Gonder(
            kod.Trim(),
            "Yeni belgeniz var",
            $"{(string.IsNullOrWhiteSpace(tur) ? "Belge" : tur.Trim())} · "
            + $"{(string.IsNullOrWhiteSpace(baslik) ? dosya.FileName : baslik.Trim())}",
            "belge");

        return Ok(new { id, tamam = true });
    }

    /// <summary>
    /// Belgeyi tarayıcıda açar (indirme değil).
    ///
    /// <para>
    /// Belirteç adres satırından da kabul ediliyor (Program.cs): iframe ve
    /// img etiketleri istek başlığı gönderemiyor. Tutanağa bakmak için her
    /// seferinde dosyayı bilgisayara indirmek gereksiz bir adımdı.
    /// </para>
    /// </summary>
    [HttpGet("Onizle/{id:int}")]
    public IActionResult Onizle(int id)
    {
        if (!Yetkili) return Forbid();

        var (yol, dosyaAdi, _, hata) = Dosya(id);

        if (hata is not null) return NotFound(new { hata });

        var uzanti = Path.GetExtension(dosyaAdi);

        /* Önizlenemeyen türde dosya tarayıcıda indirmeye dönüşür; bu da
           kullanıcının beklediği davranış. */
        return PhysicalFile(yol, TurBul(uzanti));
    }

    /// <summary>Belgeyi indirir.</summary>
    [HttpGet("Indir/{id:int}")]
    public IActionResult Indir(int id)
    {
        if (!Yetkili) return Forbid();

        var (yol, dosyaAdi, indirmeAdi, hata) = Dosya(id);

        if (hata is not null) return NotFound(new { hata });

        return PhysicalFile(yol, TurBul(Path.GetExtension(dosyaAdi)), indirmeAdi);
    }

    /// <summary>
    /// Belgenin personele görünürlüğünü değiştirir.
    ///
    /// Açıldığında personele bildirim gidiyor; kapatıldığında sessizce
    /// gizleniyor — "belgeniz kaldırıldı" demek gereksiz soru doğuruyor.
    /// </summary>
    [HttpPost("Gorunurluk/{id:int}")]
    public async Task<IActionResult> Gorunurluk(int id, [FromBody] GorunurlukGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var belge = db.QueryFirstOrDefault(@"
SELECT personel_kodu AS personelKodu, tur, baslik, personele_acik AS acik
FROM KRY_PERSONEL_BELGE WHERE id = @id AND silindi = 0", new { id });

        if (belge is null) return NotFound(new { hata = "Belge bulunamadı." });

        var yeni = girdi?.Acik ?? false;

        db.Execute("UPDATE KRY_PERSONEL_BELGE SET personele_acik = @yeni WHERE id = @id",
            new { id, yeni });

        if (yeni && !(bool)belge.acik)
            await _bildirim.Gonder(
                (string)belge.personelKodu,
                "Yeni belgeniz var",
                $"{(string)belge.tur} · {(string)belge.baslik}",
                "belge");

        return Ok(new { basarili = true, personeleAcik = yeni });
    }

    /// <summary>
    /// Belgeyi kaldırır.
    ///
    /// Kayıt silinmiyor, gizleniyor ve dosya yerinde duruyor: özlük
    /// evrakının yanlışlıkla ya da kasten yok edilmesi geri alınamaz bir
    /// kayıp olurdu.
    /// </summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!SilmeYetkisi) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_PERSONEL_BELGE
SET silindi = 1, silen = @silen, silme_tarihi = SYSDATETIME()
WHERE id = @id AND silindi = 0", new { id, silen = Kullanici });

        if (etkilenen == 0) return NotFound(new { hata = "Belge bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    /// <summary>
    /// Belgenin diskteki yolunu ve indirme adını bulur.
    ///
    /// Önizleme ve indirme aynı denetimlerden geçsin diye ortak:
    /// iki ayrı kopyada yol doğrulaması farklılaşabilirdi.
    /// </summary>
    private (string Yol, string DosyaAdi, string IndirmeAdi, string Hata) Dosya(int id)
    {
        using var db = _vt.Baglanti();

        var belge = db.QueryFirstOrDefault(@"
SELECT dosya, ozgun_ad AS ozgunAd FROM KRY_PERSONEL_BELGE
WHERE id = @id AND silindi = 0", new { id });

        if (belge is null) return (null, null, null, "Belge bulunamadı.");

        var dosyaAdi = (string)belge.dosya ?? "";

        /* Dosya adı tabloda üretildiği için yol ayracı içermez; yine de
           birleştirmeden önce doğrulanıyor. */
        if (dosyaAdi.Length == 0 || dosyaAdi.Contains('/') ||
            dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return (null, null, null, "Geçersiz dosya adı.");

        /* Yapılandırılan klasörde yoksa eski klasöre de bakılıyor: ayar
           sonradan taşındı ve önceki belgeler eski yerde kalmış olabilir. */
        var yol = BelgeKlasoru.Bul(_yapilandirma, _ortam, dosyaAdi);

        if (yol is null)
            return (null, null, null,
                "Belge dosyası sunucuda bulunamadı. Dosya, yayın sırasında silinmiş olabilir; belgeyi yeniden yükleyiniz.");

        var indirmeAdi = string.IsNullOrWhiteSpace((string)belge.ozgunAd)
            ? dosyaAdi
            : (string)belge.ozgunAd;

        return (yol, dosyaAdi, indirmeAdi, null);
    }

    /// <summary>
    /// Belgelerin durduğu klasör.
    ///
    /// Varsayılan uygulama klasörünün altında. IIS'te uygulama havuzunun
    /// kendi klasörüne yazma izni olmayabiliyor; o durumda appsettings
    /// içindeki <c>Belge:Klasor</c> ile izin verilmiş bir yol gösteriliyor.
    /// </summary>
    private string Klasor()
    {
        var ayar = _yapilandirma["Belge:Klasor"];

        if (!string.IsNullOrWhiteSpace(ayar)) return ayar.Trim();

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        return Path.Combine(kok, "personel-belge");
    }

    /// <summary>Personelin kimlik numarası; bulunamazsa null.</summary>
    private string KimlikBul(string kod)
    {
        try
        {
            var kimlik = _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod.Trim(),
                    StringComparison.OrdinalIgnoreCase))
                ?.KimlikNo;

            return string.IsNullOrWhiteSpace(kimlik) ? null : kimlik.Trim();
        }
        catch (Exception hata)
        {
            /* Mikro'ya ulaşılamazsa yalnızca personel koduyla eşleşen
               belgeler listelenir; ekranın tamamen boş kalmasındansa. */
            _kayit.LogWarning(hata, "Belge listesi için kimlik numarası okunamadı");
            return null;
        }
    }
}

/// <summary>Belgenin personele görünürlüğü.</summary>
public class GorunurlukGirdi
{
    public bool Acik { get; set; }
}

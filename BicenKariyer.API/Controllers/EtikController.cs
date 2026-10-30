using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Etik hat.
///
/// <para>
/// Personel yolsuzluk, mobbing, taciz gibi konuları bildiriyor. Anonim
/// bildirimde personel kodu tabloya <em>hiç yazılmıyor</em>: sütunu
/// doldurup ekranda gizlemek, veritabanına erişimi olan herkes için
/// anonimliği ortadan kaldırırdı. Bildiren kişi kaydını takip numarasıyla
/// izliyor.
/// </para>
///
/// <para>
/// Kayıtları yalnızca yetkili roller ve bildirimi yapan kişi görüyor.
/// Bölge müdürü ve mağaza müdürü göremiyor — bildirimlerin çoğu kendi
/// yöneticileri hakkında oluyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class EtikController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly BildirimServisi _bildirim;
    private readonly PatronBildirimServisi _patronBildirim;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly YetkiServisi _yetki;
    private readonly ILogger<EtikController> _kayit;

    public EtikController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        BildirimServisi bildirim,
        PatronBildirimServisi patronBildirim,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        YetkiServisi yetki,
        ILogger<EtikController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _bildirim = bildirim;
        _patronBildirim = patronBildirim;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _yetki = yetki;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";
    private string AdSoyad => User?.FindFirst("adSoyad")?.Value ?? Kullanici;

    /// <summary>
    /// Etik kurul yetkisi.
    ///
    /// <para>
    /// Sabit rol listesi yerine menü yetkisi: hangi rolün bildirimleri
    /// göreceğine kurumun kendisi karar vermeli. Etik bildirimlerin önemli
    /// bir kısmı yönetim zinciri hakkında oluyor ve "hangi yönetici
    /// görebilir" sorusunun cevabı yazılıma gömülemez.
    /// </para>
    ///
    /// <para>
    /// Yönetim → Rol Yetkileri'nde <c>etik</c> menüsü işaretli olan roller
    /// görüyor. Yönetici rolü her sayfayı gördüğü için doğal olarak dahil.
    /// </para>
    /// </summary>
    private bool Kurul =>
        Rol == Roller.Admin || _yetki.MenuAcik(Rol, "etik");

    public static readonly string[] Turler =
    {
        "Yolsuzluk / Usulsüzlük",
        "Hırsızlık / Şirket varlıklarının kötüye kullanılması",
        "Mobbing / Psikolojik taciz",
        "Taciz / Rahatsız edici davranış",
        "Ayrımcılık",
        "Çıkar çatışması",
        "İş güvenliği ihlali",
        "Şirket politikalarına aykırı davranış",
        "Diğer"
    };

    public static readonly string[] Yerler = { "Mağaza", "Depo", "Merkez", "Diğer" };

    private static readonly string[] Durumlar =
        { "alindi", "inceleniyor", "ek_bilgi", "sonuclandi", "kapandi" };

    /* ====================================================================== */
    /* Panel — etik kurul                                                    */
    /* ====================================================================== */

    /// <summary>Bildirim listesi.</summary>
    [HttpGet]
    public IActionResult Listele([FromQuery] string durum = null, [FromQuery] string ara = null)
    {
        if (!Kurul) return Forbid();

        using var db = _vt.Baglanti();

        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        var bildirimler = db.Query(@"
SELECT id, numara, tur, yer, sube_adi AS subeAdi, olay_tarihi AS olayTarihi,
       anonim, ad_soyad AS adSoyad, durum, inceleyen, olusturma, guncelleme,
       (SELECT COUNT(*) FROM KRY_ETIK_EK e WHERE e.etik_id = KRY_ETIK.id) AS ekSayisi
FROM KRY_ETIK
WHERE (@durum IS NULL OR durum = @durum)
  AND (@kalip IS NULL OR numara LIKE @kalip OR tur LIKE @kalip
       OR sube_adi LIKE @kalip OR aciklama LIKE @kalip)
ORDER BY CASE durum WHEN N'alindi' THEN 0 WHEN N'ek_bilgi' THEN 1 ELSE 2 END,
         olusturma DESC",
            new { durum, kalip }).ToList();

        var sayimlar = db.Query(@"
SELECT durum, COUNT(*) AS adet FROM KRY_ETIK GROUP BY durum").ToList();

        return Ok(new { bildirimler, sayimlar, turler = Turler });
    }

    /// <summary>Bildirimin tamamı: açıklama, ekler ve işlem geçmişi.</summary>
    [HttpGet("{id:int}")]
    public IActionResult Detay(int id)
    {
        if (!Kurul) return Forbid();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT id, numara, tur, yer, sube_adi AS subeAdi, olay_tarihi AS olayTarihi,
       aciklama, anonim, ad_soyad AS adSoyad, telefon, durum, inceleyen,
       sonuc, olusturma, guncelleme
FROM KRY_ETIK WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Bildirim bulunamadı." });

        var ekler = db.Query(@"
SELECT id, ozgun_ad AS ozgunAd, boyut FROM KRY_ETIK_EK
WHERE etik_id = @id ORDER BY id", new { id }).ToList();

        var hareketler = db.Query(@"
SELECT durum, metin, bildiren, yapan, olusturma
FROM KRY_ETIK_HAREKET WHERE etik_id = @id ORDER BY olusturma", new { id }).ToList();

        return Ok(new { kayit, ekler, hareketler });
    }

    /// <summary>Durum değiştirir ve gerekirse not düşer.</summary>
    [HttpPost("{id:int}/Durum")]
    public IActionResult DurumYaz(int id, [FromBody] EtikDurumGirdi girdi)
    {
        if (!Kurul) return Forbid();

        if (girdi is null || !Durumlar.Contains(girdi.Durum ?? ""))
            return BadRequest(new { hata = "Geçersiz durum." });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_ETIK
SET durum = @durum, inceleyen = @kim,
    sonuc = CASE WHEN @durum IN (N'sonuclandi', N'kapandi')
                 THEN @not ELSE sonuc END,
    guncelleme = SYSDATETIME()
WHERE id = @id",
            new
            {
                id,
                durum = girdi.Durum,
                kim = AdSoyad,
                not = girdi.Not
            });

        if (etkilenen == 0) return NotFound(new { hata = "Bildirim bulunamadı." });

        db.Execute(@"
INSERT INTO KRY_ETIK_HAREKET (etik_id, durum, metin, bildiren, yapan, gorunur)
VALUES (@id, @durum, @not, 0, @kim, @gorunur)",
            new
            {
                id,
                durum = girdi.Durum,
                not = girdi.Not,
                kim = AdSoyad,

                /* Kurulun kendi arasındaki notu bildirene göstermemek
                   gerekebiliyor; varsayılan görünür. */
                gorunur = girdi.Gorunur
            });

        return Ok(new { basarili = true });
    }

    /// <summary>Bildirim ekini indirir.</summary>
    [HttpGet("Ek/{ekId:int}")]
    public IActionResult Ek(int ekId)
    {
        if (!Kurul) return Forbid();

        using var db = _vt.Baglanti();

        var ek = db.QueryFirstOrDefault(
            "SELECT dosya, ozgun_ad AS ozgunAd FROM KRY_ETIK_EK WHERE id = @ekId",
            new { ekId });

        if (ek is null) return NotFound(new { hata = "Ek bulunamadı." });

        var dosyaAdi = (string)ek.dosya ?? "";

        if (dosyaAdi.Length == 0 || dosyaAdi.Contains('/') ||
            dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest(new { hata = "Geçersiz dosya adı." });

        var yol = Path.Combine(Klasor(), dosyaAdi);

        if (!System.IO.File.Exists(yol))
            return NotFound(new { hata = "Ek dosyası sunucuda bulunamadı." });

        var tur = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            _ => "application/octet-stream"
        };

        return PhysicalFile(yol, tur, (string)ek.ozgunAd ?? dosyaAdi);
    }

    /* ====================================================================== */
    /* Mobil — bildiren                                                      */
    /* ====================================================================== */

    /// <summary>Form seçenekleri.</summary>
    [HttpGet("Secenekler")]
    [Authorize(Roles = "Personel")]
    public IActionResult Secenekler()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        return Ok(new
        {
            turler = Turler,
            yerler = Yerler,
            subeAdi = p.IsGrubu
        });
    }

    /// <summary>
    /// Yeni bildirim.
    ///
    /// <para>
    /// Anonim seçilirse personel kodu, adı ve telefonu hiç kaydedilmiyor.
    /// Takip numarası bildirimden sonra personele veriliyor; kaydı yalnızca
    /// onunla izleyebiliyor.
    /// </para>
    /// </summary>
    [HttpPost]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(524_288_000)]
    public async Task<IActionResult> Ac()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var form = Request.Form;

        var tur = (form["tur"].ToString() ?? "").Trim();
        var aciklama = (form["aciklama"].ToString() ?? "").Trim();

        if (!Turler.Contains(tur))
            return BadRequest(new { hata = "Bildirim türünü seçiniz." });

        if (aciklama.Length < 20)
            return BadRequest(new
            {
                hata = "Olayı biraz daha ayrıntılı anlatınız (en az 20 karakter)."
            });

        var anonim = form["anonim"].ToString() != "false";

        DateTime? olayTarihi = DateTime.TryParse(form["olayTarihi"], out var t)
            ? t.Date : null;

        using var db = _vt.Baglanti();

        var numara = NumaraUret(db);

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_ETIK
    (numara, tur, yer, sube_adi, olay_tarihi, aciklama, anonim,
     personel_kodu, ad_soyad, telefon)
OUTPUT INSERTED.id
VALUES (@numara, @tur, @yer, @sube, @olayTarihi, @aciklama, @anonim,
        @kod, @ad, @telefon)",
            new
            {
                numara,
                tur,
                yer = (form["yer"].ToString() ?? "").Trim(),
                sube = (form["subeAdi"].ToString() ?? "").Trim(),
                olayTarihi,
                aciklama,
                anonim,

                /* Anonimde kimlik alanları hiç yazılmıyor */
                kod = anonim ? null : (p.PersonelKodu ?? "").Trim(),
                ad = anonim ? null : $"{p.Ad} {p.Soyad}".Trim(),
                telefon = anonim ? null : p.Telefon
            });

        /* Ekler: fotoğraf, ekran görüntüsü, belge */
        foreach (var dosya in form.Files)
        {
            if (dosya.Length == 0) continue;

            var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

            if (uzanti is not (".pdf" or ".jpg" or ".jpeg" or ".png" or ".doc"
                or ".docx" or ".xls" or ".xlsx"))
                continue;

            var diskAdi = $"etik_{id}_{Guid.NewGuid():N}{uzanti}";

            try
            {
                var klasor = Klasor();

                if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

                await using (var akis = new FileStream(
                    Path.Combine(klasor, diskAdi), FileMode.Create))
                {
                    await dosya.CopyToAsync(akis);
                }

                db.Execute(@"
INSERT INTO KRY_ETIK_EK (etik_id, dosya, ozgun_ad, boyut)
VALUES (@id, @diskAdi, @ozgunAd, @boyut)",
                    new { id, diskAdi, ozgunAd = dosya.FileName, boyut = dosya.Length });
            }
            catch (Exception hata)
            {
                /* Ek yazılamazsa bildirim yine durmalı: asıl değer
                   açıklamada, dosya destekleyici. */
                _kayit.LogWarning(hata, "Etik bildirimi eki yazılamadı");
            }
        }

        db.Execute(@"
INSERT INTO KRY_ETIK_HAREKET (etik_id, durum, metin, bildiren, yapan)
VALUES (@id, N'alindi', N'Bildirim alındı.', 1, @kim)",
            new { id, kim = anonim ? "Anonim" : $"{p.Ad} {p.Soyad}".Trim() });

        /* Etik kurula haber: bildirim panele bakılmadan bilinmiyordu */
        try
        {
            /* Alıcılar da yetkiden geliyor: bildirimin kime düşeceği ile
               kimin göreceği aynı küme olmalı, yoksa bildirim alan ama
               kaydı açamayan kullanıcı oluyordu. */
            var roller = db.Query<string>(@"
SELECT DISTINCT rol FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IS NOT NULL")
                .Where(r => r == Roller.Admin || _yetki.MenuAcik(r, "etik"))
                .ToList();

            if (roller.Count > 0)
            {
                db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
SELECT kullanici_adi, 'etik', @baslik, @metin
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN @roller",
                    new
                    {
                        roller,
                        baslik = $"Yeni etik bildirimi: {numara}",
                        metin = $"{tur}{(anonim ? " · anonim" : "")}"
                    });

                await _bildirim.RoleGonder(
                    roller.ToArray(),
                    "Yeni etik bildirimi",
                    $"{numara} · {tur}",
                    "etik");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Etik bildirimi duyurulamadı");
        }

        /* Biçen360 patronlarına yalnızca sayı gidiyor (tür, içerik, bildiren
           asla); tercihi açık olanlara, kısa bir toplama süresinden sonra. */
        _patronBildirim.EtikGeldi();

        return Ok(new { numara, id });
    }

    /// <summary>
    /// Personelin kendi bildirimleri.
    ///
    /// Anonim bildirimler burada görünmüyor — kayıtta kimlik yok, dolayısıyla
    /// eşleştirilemez. Personel onları takip numarasıyla sorguluyor.
    /// </summary>
    [HttpGet("Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Benim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var bildirimler = db.Query(@"
SELECT id, numara, tur, durum, olusturma, guncelleme
FROM KRY_ETIK
WHERE anonim = 0 AND personel_kodu = @kod
ORDER BY olusturma DESC",
            new { kod = (p.PersonelKodu ?? "").Trim() }).ToList();

        return Ok(new { bildirimler });
    }

    /// <summary>
    /// Takip numarasıyla sorgulama.
    ///
    /// Anonim bildirimin tek takip yolu bu. Numara bilinmeden kayda
    /// ulaşılamıyor; kimlik bilgisi zaten kayıtta yok.
    /// </summary>
    [HttpGet("Sorgu/{numara}")]
    [Authorize(Roles = "Personel")]
    public IActionResult Sorgu(string numara)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT id, numara, tur, yer, sube_adi AS subeAdi, olay_tarihi AS olayTarihi,
       aciklama, anonim, durum, sonuc, olusturma, guncelleme,
       personel_kodu AS personelKodu
FROM KRY_ETIK WHERE numara = @numara", new { numara = (numara ?? "").Trim() });

        if (kayit is null) return NotFound(new { hata = "Bu numarayla bildirim bulunamadı." });

        /* Kimliğini paylaşarak açılmış bir bildirimi başkası numarayla
           sorgulayamamalı; anonimde zaten sahip bilinmiyor. */
        if (!(bool)kayit.anonim &&
            !string.Equals((string)kayit.personelKodu, (p.PersonelKodu ?? "").Trim(),
                StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { hata = "Bu bildirimi görüntüleme yetkiniz yok." });

        var hareketler = db.Query(@"
SELECT durum, metin, bildiren, olusturma
FROM KRY_ETIK_HAREKET
WHERE etik_id = @id AND gorunur = 1
ORDER BY olusturma", new { id = (int)kayit.id }).ToList();

        return Ok(new
        {
            kayit = new
            {
                numara = (string)kayit.numara,
                tur = (string)kayit.tur,
                yer = (string)kayit.yer,
                subeAdi = (string)kayit.subeAdi,
                olayTarihi = (DateTime?)kayit.olayTarihi,
                aciklama = (string)kayit.aciklama,
                anonim = (bool)kayit.anonim,
                durum = (string)kayit.durum,
                sonuc = (string)kayit.sonuc,
                olusturma = (DateTime)kayit.olusturma
            },
            hareketler
        });
    }

    /// <summary>Bildirime ek bilgi yazar.</summary>
    [HttpPost("Sorgu/{numara}/Mesaj")]
    [Authorize(Roles = "Personel")]
    public IActionResult Mesaj(string numara, [FromBody] EtikMesajGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (string.IsNullOrWhiteSpace(girdi?.Metin))
            return BadRequest(new { hata = "Mesaj yazınız." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT id, anonim, personel_kodu AS personelKodu FROM KRY_ETIK
WHERE numara = @numara", new { numara = (numara ?? "").Trim() });

        if (kayit is null) return NotFound(new { hata = "Bildirim bulunamadı." });

        if (!(bool)kayit.anonim &&
            !string.Equals((string)kayit.personelKodu, (p.PersonelKodu ?? "").Trim(),
                StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { hata = "Bu bildirime yazma yetkiniz yok." });

        db.Execute(@"
INSERT INTO KRY_ETIK_HAREKET (etik_id, metin, bildiren, yapan)
VALUES (@id, @metin, 1, @kim)",
            new
            {
                id = (int)kayit.id,
                metin = girdi.Metin.Trim(),

                /* Anonim bildirimde yazan da anonim kalıyor */
                kim = (bool)kayit.anonim ? "Anonim" : $"{p.Ad} {p.Soyad}".Trim()
            });

        db.Execute("UPDATE KRY_ETIK SET guncelleme = SYSDATETIME() WHERE id = @id",
            new { id = (int)kayit.id });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    /// <summary>
    /// ETH-2026-000184 biçiminde takip numarası.
    ///
    /// Yıl içinde sırayla artıyor; kayıt kimliğini doğrudan vermek, toplam
    /// bildirim sayısını dışarıya söylerdi.
    /// </summary>
    private static string NumaraUret(System.Data.IDbConnection db)
    {
        var yil = DateTime.Today.Year;

        var sonuncu = db.ExecuteScalar<string>(@"
SELECT TOP 1 numara FROM KRY_ETIK
WHERE numara LIKE @kalip ORDER BY numara DESC",
            new { kalip = $"ETH-{yil}-%" });

        var sira = 1;

        if (!string.IsNullOrWhiteSpace(sonuncu))
        {
            var parca = sonuncu.Split('-');

            if (parca.Length == 3 && int.TryParse(parca[2], out var son)) sira = son + 1;
        }

        return $"ETH-{yil}-{sira:000000}";
    }

    private PersonelKaydi Kendisi()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return null;

        var kod = ad["personel:".Length..].Split('|')[0];

        try
        {
            return _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim() == kod.Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel bilgisi okunamadı");
            return null;
        }
    }

    /// <summary>Eklerin klasörü; belgelerle aynı ayardan türetiliyor.</summary>
    private string Klasor()
    {
        var ayar = _yapilandirma["Belge:Klasor"];

        var kok = string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(
                string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
                    ? AppContext.BaseDirectory
                    : _ortam.ContentRootPath,
                "personel-belge")
            : ayar.Trim();

        return Path.Combine(kok, "etik");
    }
}

/* ========================================================================== */

public class EtikDurumGirdi
{
    /// <summary>alindi · inceleniyor · ek_bilgi · sonuclandi · kapandi</summary>
    public string Durum { get; set; }

    public string Not { get; set; }

    /// <summary>Not bildirimi yapana da görünsün mü.</summary>
    public bool Gorunur { get; set; } = true;
}

public class EtikMesajGirdi
{
    public string Metin { get; set; }
}

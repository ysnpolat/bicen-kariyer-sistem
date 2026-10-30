using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İş emirleri.
///
/// <para>
/// Yönetici bir işi bir kişiye atar. Atanan kişi iki türden biri olabilir:
/// panel kullanıcısı (İK ekibi) ya da mağaza personeli (mobil uygulama).
/// Akış ikisinde de aynı olduğu için tek tablo ve tek denetleyici kullanılır.
/// </para>
///
/// <para>
/// Atama yetkisi şimdilik yalnızca yönetici rollerinde. Atanan kişi kendi
/// emrini görür, "gördüm" der ve bitirirken açıklama yazar; bitirince
/// atayana hem panel bildirimi hem e-posta gider.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class IsEmriController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly BildirimServisi _bildirim;
    private readonly MailServisi _mail;
    private readonly ILogger<IsEmriController> _kayit;

    public IsEmriController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        BildirimServisi bildirim,
        MailServisi mail,
        ILogger<IsEmriController> kayit)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _bildirim = bildirim;
        _mail = mail;
        _kayit = kayit;
    }

    /// <summary>Atama yapabilen roller. Şimdilik yalnızca yöneticiler.</summary>
    private const string AtamaYetkisi =
        Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi;

    private string Kullanici =>
        User.Identity?.Name
        ?? User.Claims.FirstOrDefault(x => x.Type == "kullanici")?.Value
        ?? "";

    private string AdSoyad =>
        User.Claims.FirstOrDefault(x => x.Type == "adSoyad")?.Value ?? Kullanici;

    /// <summary>
    /// Mobil oturumdaki personel kodu.
    ///
    /// Kod ayrı bir hakta değil, kullanıcı adının içinde:
    /// <c>personel:14721|cihaz-abc</c>.
    /// </summary>
    private string PersonelKodu()
    {
        var ad = User?.Identity?.Name ?? "";

        return ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)
            ? ad["personel:".Length..].Split('|')[0]
            : "";
    }

    /* ==================================================================== */
    /* Atama                                                                */
    /* ==================================================================== */

    /// <summary>Kime atanabileceğinin listesi: panel kullanıcıları ve personel.</summary>
    [HttpGet("Atanabilecekler")]
    [Authorize(Roles = AtamaYetkisi)]
    public IActionResult Atanabilecekler([FromQuery] string ara)
    {
        var desen = (ara ?? "").Trim();

        using var db = _vt.Baglanti();

        var panel = db.Query(@"
SELECT kullanici_adi AS kod, ad_soyad AS ad, rol
FROM KRY_KULLANICILAR
WHERE aktif = 1
  AND (@desen = '' OR ad_soyad LIKE '%' + @desen + '%'
       OR kullanici_adi LIKE '%' + @desen + '%')
ORDER BY ad_soyad", new { desen })
            .Select(x => new
            {
                tur = "panel",
                kod = (string)x.kod,
                ad = (string)x.ad,
                bilgi = (string)x.rol
            })
            .ToList();

        var personel = new List<object>();

        try
        {
            /* Mağaza personeli Mikro'dan gelir; yalnızca çalışanlar. */
            personel = _personelKaynak.TumPersonelleriGetir()
                .Where(x => desen.Length == 0
                    || $"{x.Ad} {x.Soyad}".Contains(desen, StringComparison.OrdinalIgnoreCase)
                    || (x.PersonelKodu ?? "").Contains(desen, StringComparison.OrdinalIgnoreCase))
                .OrderBy(x => x.Ad)
                .Select(x => (object)new
                {
                    tur = "personel",
                    kod = (x.PersonelKodu ?? "").Trim(),
                    ad = $"{x.Ad} {x.Soyad}".Trim(),
                    bilgi = string.IsNullOrWhiteSpace(x.Pozisyon)
                        ? x.IsGrubu
                        : $"{x.Pozisyon} · {x.IsGrubu}"
                })
                .ToList();
        }
        catch (Exception hata)
        {
            /* Mikro'ya ulaşılamazsa panel kullanıcıları yine listelenir:
               atama tamamen durmasın. */
            _kayit.LogWarning(hata, "Personel listesi alınamadı");
        }

        return Ok(new { panel, personel });
    }

    /// <summary>Yeni iş emri oluşturur.</summary>
    [HttpPost("Ata")]
    [Authorize(Roles = AtamaYetkisi)]
    public async Task<IActionResult> Ata([FromBody] IsEmriGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Baslik))
            return BadRequest(new { hata = "Başlık zorunludur." });

        if (string.IsNullOrWhiteSpace(girdi.AtananKod))
            return BadRequest(new { hata = "Bir kişi seçiniz." });

        var tur = (girdi.AtananTur ?? "").Trim().ToLowerInvariant();

        if (tur is not ("panel" or "personel"))
            return BadRequest(new { hata = "Atanan türü geçersiz." });

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IS_EMRI
    (baslik, aciklama, oncelik, atanan_tur, atanan_kod, atanan_ad,
     atayan, atayan_ad, kaynak_ekran, kaynak_id, kaynak_baslik, son_tarih)
OUTPUT INSERTED.id
VALUES
    (@baslik, @aciklama, @oncelik, @tur, @kod, @ad,
     @atayan, @atayanAd, @ekran, @kaynakId, @kaynakBaslik, @sonTarih)",
            new
            {
                baslik = girdi.Baslik.Trim(),
                aciklama = girdi.Aciklama,
                oncelik = string.IsNullOrWhiteSpace(girdi.Oncelik) ? "Normal" : girdi.Oncelik,
                tur,
                kod = girdi.AtananKod.Trim(),
                ad = girdi.AtananAd,
                atayan = Kullanici,
                atayanAd = AdSoyad,
                ekran = girdi.KaynakEkran,
                kaynakId = girdi.KaynakId,
                kaynakBaslik = girdi.KaynakBaslik,
                sonTarih = girdi.SonTarih
            });

        /* Panel kullanıcısına çan bildirimi, personele mobil bildirim. */
        if (tur == "panel")
        {
            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, 'is_emri', @baslik, @metin)",
                new
                {
                    kullanici = girdi.AtananKod.Trim(),
                    baslik = $"Yeni iş emri: {girdi.Baslik.Trim()}",

                    /* Bildirim tek başına anlaşılır olmalı: kim verdi, hangi
                       kayıtla ilgili, ne yapılacak, ne zamana kadar. */
                    metin = string.Join(" · ", new[]
                        {
                            $"Atayan: {AdSoyad}",
                            string.IsNullOrWhiteSpace(girdi.KaynakBaslik)
                                ? null : $"İlgili kayıt: {girdi.KaynakBaslik}",
                            girdi.SonTarih is null
                                ? null : $"Son tarih: {girdi.SonTarih:dd.MM.yyyy}",
                            (girdi.Oncelik ?? "") == "Acil" ? "ACİL" : null,
                            string.IsNullOrWhiteSpace(girdi.Aciklama)
                                ? null : girdi.Aciklama.Trim()
                        }
                        .Where(x => !string.IsNullOrWhiteSpace(x)))
                });

            /* Panel kullanıcısının telefonu bir personel kaydıyla
               eşleşiyorsa mobil bildirim de gidiyor.

               Panel hesabına atanan iş mobil uygulamanın listesinde
               görünüyor ama bildirim yalnızca çana düşüyordu: kişi
               paneli açmadıkça yeni işten haberi olmuyordu. */
            try
            {
                var telefon = db.ExecuteScalar<string>(@"
SELECT TOP 1 telefon FROM KRY_KULLANICILAR
WHERE aktif = 1 AND kullanici_adi = @kullanici",
                    new { kullanici = girdi.AtananKod.Trim() });

                var rakam = new string((telefon ?? "").Where(char.IsDigit).ToArray());

                if (rakam.Length >= 10)
                {
                    var son10 = rakam[^10..];

                    var kod = _personelKaynak.TumPersonelleriGetir()
                        .FirstOrDefault(x =>
                        {
                            var t = new string((x.Telefon ?? "").Where(char.IsDigit).ToArray());
                            return t.Length >= 10 && t[^10..] == son10 && x.Durum == 1;
                        })?.PersonelKodu;

                    if (!string.IsNullOrWhiteSpace(kod))
                        await _bildirim.Gonder(
                            kod,
                            $"Yeni iş emri — {AdSoyad}",
                            string.IsNullOrWhiteSpace(girdi.KaynakBaslik)
                                ? girdi.Baslik.Trim()
                                : $"{girdi.Baslik.Trim()} ({girdi.KaynakBaslik})",
                            "Isler");
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Panel atamasında mobil bildirim gönderilemedi");
            }
        }
        else
        {
            await _bildirim.Gonder(
                girdi.AtananKod.Trim(),
                $"Yeni iş emri — {AdSoyad}",
                string.IsNullOrWhiteSpace(girdi.KaynakBaslik)
                    ? girdi.Baslik.Trim()
                    : $"{girdi.Baslik.Trim()} ({girdi.KaynakBaslik})",
                "Isler");
        }

        return Ok(new { id, tamam = true });
    }

    /* ==================================================================== */
    /* Listeleme                                                            */
    /* ==================================================================== */

    /// <summary>Panel kullanıcısının kendisine atanan iş emirleri.</summary>
    [HttpGet("Bana")]
    [Authorize]
    public IActionResult Bana([FromQuery] bool tumu = false)
    {
        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, baslik, aciklama, oncelik, atayan_ad AS atayanAd,
       kaynak_ekran AS kaynakEkran, kaynak_id AS kaynakId,
       kaynak_baslik AS kaynakBaslik, durum, son_tarih AS sonTarih,
       goruldu, sonuc, bitis_tarihi AS bitisTarihi, olusturma
FROM KRY_IS_EMRI
WHERE atanan_tur = 'panel' AND atanan_kod = @kod
  AND (@tumu = 1 OR durum <> 'Bitti')
ORDER BY CASE durum WHEN 'Yeni' THEN 0 WHEN 'Görüldü' THEN 1 ELSE 2 END,
         olusturma DESC", new { kod = Kullanici, tumu }));
    }

    /// <summary>Kullanıcının kendi atadığı iş emirleri.</summary>
    [HttpGet("Attiklarim")]
    [Authorize(Roles = AtamaYetkisi)]
    public IActionResult Attiklarim()
    {
        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, baslik, aciklama, oncelik, atanan_tur AS atananTur,
       atanan_ad AS atananAd, kaynak_ekran AS kaynakEkran,
       kaynak_baslik AS kaynakBaslik, durum, son_tarih AS sonTarih,
       goruldu, sonuc, bitiren_ad AS bitirenAd,
       bitis_tarihi AS bitisTarihi, olusturma
FROM KRY_IS_EMRI
WHERE atayan = @kod
ORDER BY olusturma DESC", new { kod = Kullanici }));
    }

    /// <summary>Bir kayda bağlı iş emirleri (başvuru, personel kartı vb.).</summary>
    [HttpGet("Kaynak")]
    [Authorize]
    public IActionResult Kaynak([FromQuery] string ekran, [FromQuery] string kayitId)
    {
        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, baslik, atanan_ad AS atananAd, atayan_ad AS atayanAd,
       durum, olusturma, bitis_tarihi AS bitisTarihi
FROM KRY_IS_EMRI
WHERE kaynak_ekran = @ekran AND kaynak_id = @kayitId
ORDER BY olusturma DESC", new { ekran, kayitId }));
    }

    /// <summary>
    /// Tek bir iş emrinin ayrıntısı.
    ///
    /// Yalnızca emri atayan ya da atanan kişi görebilir; iş emirleri
    /// kişiye özel yazışma sayılır.
    /// </summary>
    [HttpGet("{id:int}")]
    [Authorize]
    public IActionResult Tek(int id)
    {
        using var db = _vt.Baglanti();

        var emir = db.QueryFirstOrDefault(@"
SELECT id, baslik, aciklama, oncelik, atanan_tur AS atananTur,
       atanan_kod AS atananKod, atanan_ad AS atananAd,
       atayan, atayan_ad AS atayanAd,
       kaynak_ekran AS kaynakEkran, kaynak_id AS kaynakId,
       kaynak_baslik AS kaynakBaslik,
       durum, son_tarih AS sonTarih, goruldu, goruldu_tarih AS gorulduTarih,
       sonuc, bitiren_ad AS bitirenAd, bitis_tarihi AS bitisTarihi, olusturma,
       icerik, doldurma, ilerleme, doldurma_tarihi AS doldurmaTarihi
FROM KRY_IS_EMRI WHERE id = @id", new { id });

        if (emir is null) return NotFound(new { hata = "İş emri bulunamadı." });

        var benim = string.Equals((string)emir.atayan, Kullanici, StringComparison.OrdinalIgnoreCase)
            || ((string)emir.atananTur == "panel"
                && string.Equals((string)emir.atananKod, Kullanici, StringComparison.OrdinalIgnoreCase));

        if (!benim) return Forbid();

        return Ok(emir);
    }

    /* ==================================================================== */
    /* İçerik: tablo, kontrol listesi, biçimli metin                       */
    /* ==================================================================== */

    /// <summary>
    /// İş emrinin içeriğini yazar (yalnızca atayan).
    ///
    /// <para>
    /// İçerik blok listesi olarak JSON'da tutuluyor: yapı işten işe
    /// değişiyor ve her blok tipi için tablo açmak, yeni bir tip
    /// eklendiğinde göçe zorluyordu. Doğrulama istemcide; sunucu içeriği
    /// olduğu gibi saklıyor.
    /// </para>
    /// </summary>
    [HttpPost("{id:int}/Icerik")]
    [Authorize]
    public IActionResult IcerikYaz(int id, [FromBody] IsIcerikGirdi girdi)
    {
        using var db = _vt.Baglanti();

        var atayan = db.ExecuteScalar<string>(
            "SELECT atayan FROM KRY_IS_EMRI WHERE id = @id", new { id });

        if (atayan is null) return NotFound(new { hata = "İş emri bulunamadı." });

        /* İçeriği yalnızca işi atan düzenler: atanan kişinin çizelgenin
           kendisini değiştirebilmesi, kilitli sütunların anlamını
           ortadan kaldırırdı. */
        if (!string.Equals(atayan, Kullanici, StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new
            {
                hata = "İçeriği yalnızca işi atan kişi düzenleyebilir."
            });

        db.Execute("UPDATE KRY_IS_EMRI SET icerik = @icerik WHERE id = @id",
            new { id, icerik = girdi?.Icerik });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Atanan kişinin doldurduğu değerler.
    ///
    /// <para>
    /// Özgün içerikten ayrı saklanıyor: iş atayan neyi verdiğini, atanan
    /// neyi doldurduğunu ayrı görebilmeli. İlerleme oranı kaydetme anında
    /// hesaplanıyor; listede her açılışta JSON ayrıştırmak gereksiz.
    /// </para>
    /// </summary>
    [HttpPost("{id:int}/Doldur")]
    [Authorize]
    public IActionResult Doldur(int id, [FromBody] IsDoldurmaGirdi girdi)
    {
        using var db = _vt.Baglanti();

        var emir = db.QueryFirstOrDefault(@"
SELECT atayan, atanan_tur AS atananTur, atanan_kod AS atananKod, durum
FROM KRY_IS_EMRI WHERE id = @id", new { id });

        if (emir is null) return NotFound(new { hata = "İş emri bulunamadı." });

        var atanan = (string)emir.atananTur == "panel"
            ? string.Equals((string)emir.atananKod, Kullanici, StringComparison.OrdinalIgnoreCase)
            : string.Equals((string)emir.atananKod, PersonelKodu(), StringComparison.OrdinalIgnoreCase);

        var kendiIsi = atanan ||
            string.Equals((string)emir.atayan, Kullanici, StringComparison.OrdinalIgnoreCase);

        if (!kendiIsi) return Forbid();

        if ((string)emir.durum == "İptal")
            return BadRequest(new { hata = "İptal edilmiş iş doldurulamaz." });

        db.Execute(@"
UPDATE KRY_IS_EMRI
SET doldurma = @doldurma, ilerleme = @ilerleme, doldurma_tarihi = SYSDATETIME(),

    /* İlk doldurmada iş kendiliğinden 'Devam ediyor' oluyor: personel
       çizelgeyi işaretleyip durumu ayrıca değiştirmeyi unutuyordu. */
    durum = CASE WHEN durum = N'Yeni' THEN N'Devam ediyor' ELSE durum END
WHERE id = @id",
            new
            {
                id,
                doldurma = girdi?.Doldurma,
                ilerleme = girdi?.Ilerleme is >= 0 and <= 100 ? girdi.Ilerleme : 0
            });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Şablonlar                                                            */
    /* ==================================================================== */

    /// <summary>Kayıtlı iş şablonları.</summary>
    [HttpGet("Sablonlar")]
    [Authorize]
    public IActionResult Sablonlar()
    {
        using var db = _vt.Baglanti();

        var sablonlar = db.Query(@"
SELECT id, ad, aciklama, icerik, olusturan, olusturma
FROM KRY_IS_SABLON ORDER BY ad").ToList();

        return Ok(new { sablonlar });
    }

    /// <summary>
    /// İçeriği şablon olarak kaydeder.
    ///
    /// Aynı çizelge her hafta yeniden kuruluyordu; bir kez hazırlanıp
    /// tekrar kullanılabilmeli.
    /// </summary>
    [HttpPost("Sablon")]
    [Authorize]
    public IActionResult SablonKaydet([FromBody] IsSablonGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.Ad))
            return BadRequest(new { hata = "Şablon adı giriniz." });

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IS_SABLON (ad, aciklama, icerik, olusturan)
OUTPUT INSERTED.id VALUES (@ad, @aciklama, @icerik, @olusturan)",
            new
            {
                ad = girdi.Ad.Trim(),
                aciklama = girdi.Aciklama,
                icerik = girdi.Icerik,
                olusturan = Kullanici
            });

        return Ok(new { id, basarili = true });
    }

    [HttpDelete("Sablon/{id:int}")]
    [Authorize]
    public IActionResult SablonSil(int id)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "DELETE FROM KRY_IS_SABLON WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Şablon bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Durum değişiklikleri                                                 */
    /* ==================================================================== */

    /// <summary>Atanan kişi emri gördü.</summary>
    [HttpPost("{id:int}/Gordum")]
    [Authorize]
    public IActionResult Gordum(int id)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_IS_EMRI
SET goruldu = 1, goruldu_tarih = SYSDATETIME(),
    durum = CASE WHEN durum = 'Yeni' THEN 'Görüldü' ELSE durum END
WHERE id = @id AND atanan_tur = 'panel' AND atanan_kod = @kod",
            new { id, kod = Kullanici });

        return etkilenen == 0
            ? NotFound(new { hata = "İş emri bulunamadı." })
            : Ok(new { tamam = true });
    }

    /// <summary>Emri bitirir; açıklama zorunludur.</summary>
    [HttpPost("{id:int}/Bitir")]
    [Authorize]
    public async Task<IActionResult> Bitir(int id, [FromBody] IsEmriBitirGirdi girdi)
    {
        var sonuc = (girdi?.Sonuc ?? "").Trim();

        if (sonuc.Length == 0)
            return BadRequest(new { hata = "Yapılan işi açıklayınız." });

        using var db = _vt.Baglanti();

        var emir = db.QueryFirstOrDefault(@"
SELECT id, baslik, atayan, atayan_ad AS atayanAd, atanan_kod AS atananKod
FROM KRY_IS_EMRI
WHERE id = @id AND atanan_tur = 'panel' AND atanan_kod = @kod AND durum <> 'Bitti'",
            new { id, kod = Kullanici });

        if (emir is null)
            return NotFound(new { hata = "İş emri bulunamadı ya da zaten bitmiş." });

        db.Execute(@"
UPDATE KRY_IS_EMRI
SET durum = 'Bitti', sonuc = @sonuc, bitiren_ad = @ad,
    bitis_tarihi = SYSDATETIME(), goruldu = 1
WHERE id = @id", new { id, sonuc, ad = AdSoyad });

        await AtayanaHaberVer(db, (string)emir.atayan, (string)emir.baslik, AdSoyad, sonuc);

        return Ok(new { tamam = true });
    }

    /// <summary>Atayan kişi emri iptal eder.</summary>
    [HttpPost("{id:int}/Iptal")]
    [Authorize(Roles = AtamaYetkisi)]
    public IActionResult Iptal(int id)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_IS_EMRI SET durum = 'İptal'
WHERE id = @id AND atayan = @kod AND durum <> 'Bitti'",
            new { id, kod = Kullanici });

        return etkilenen == 0
            ? NotFound(new { hata = "İş emri bulunamadı ya da bitmiş." })
            : Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Bildirim                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Bitişte atayana haber verir: panel çanı ve e-posta.
    ///
    /// E-posta gönderilemezse iş emri yine de bitmiş sayılır; bildirim
    /// hatası işin kendisini geri almamalı.
    /// </summary>
    private async Task AtayanaHaberVer(
        System.Data.IDbConnection db,
        string atayan, string baslik, string bitiren, string sonuc)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, 'is_emri_bitti', @baslik, @metin)",
                new
                {
                    kullanici = atayan,
                    baslik = "İş emri tamamlandı",
                    metin = $"{bitiren}: {baslik} — {Kirp(sonuc, 500)}"
                });

            var eposta = db.ExecuteScalar<string>(
                "SELECT eposta FROM KRY_KULLANICILAR WHERE kullanici_adi = @kod",
                new { kod = atayan });

            if (!string.IsNullOrWhiteSpace(eposta))
            {
                await _mail.GonderAsync(
                    new[] { eposta },
                    $"İş emri tamamlandı: {baslik}",
                    $"<p><b>{bitiren}</b> atadığınız iş emrini tamamladı.</p>"
                    + $"<p><b>İş:</b> {baslik}</p>"
                    + $"<p><b>Açıklama:</b><br>{sonuc.Replace("\n", "<br>")}</p>");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İş emri bildirimi gönderilemedi: {Baslik}", baslik);
        }
    }

    private static string Kirp(string metin, int uzunluk) =>
        metin.Length <= uzunluk ? metin : metin[..uzunluk] + "…";
}

/// <summary>İş emrinin blok içeriği (JSON metni).</summary>
public class IsIcerikGirdi
{
    public string Icerik { get; set; }
}

/// <summary>Atananın doldurduğu değerler ve ilerleme oranı.</summary>
public class IsDoldurmaGirdi
{
    public string Doldurma { get; set; }

    /// <summary>İşaretlenen kutucukların yüzdesi; listede çubuk için.</summary>
    public int Ilerleme { get; set; }
}

public class IsSablonGirdi
{
    public string Ad { get; set; }
    public string Aciklama { get; set; }
    public string Icerik { get; set; }
}

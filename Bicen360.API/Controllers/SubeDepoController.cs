using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Şube, depo ve mail ayarları.
///
/// <para>
/// Depo numarası fiyat ve stok sorgusunun temel girdisi; şube açıldığında
/// ya da numara değiştiğinde yeni sürüm yayınlamak yerine panelden
/// giriliyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SubeDepoController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly MailServisi _mail;
    private readonly ILogger<SubeDepoController> _kayit;

    public SubeDepoController(
        VeritabaniServisi vt,
        MailServisi mail,
        ILogger<SubeDepoController> kayit)
    {
        _vt = vt;
        _mail = mail;
        _kayit = kayit;
    }

    private string Rol =>
        User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool Yetkili =>
        Rol is "Admin" or "IKYoneticisi" or "GenelMudurYardimcisi";

    /* ====================================================================== */
    /* Şube ve depo                                                          */
    /* ====================================================================== */

    /// <summary>Tanımlı şubeler ve Mikro'daki depo listesi.</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var subeler = db.Query(@"
SELECT id, sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo,
       eposta, aktif, olusturma
FROM B360_SUBE_DEPO ORDER BY sube_adi, sube_kodu").ToList();

        /* Mikro'daki depolar seçenek olarak veriliyor: numarayı elle
           yazmak, yanlış depoya bağlanan bir şubeyi fark etmeyi
           zorlaştırıyordu. */
        var depolar = new List<dynamic>();

        try
        {
            using var mikro = _vt.MikroBaglantisi();

            depolar = mikro.Query(@"
SELECT dep_no AS no, dep_adi AS ad
FROM DEPOLAR WITH (NOLOCK)
WHERE dep_iptal = 0 ORDER BY dep_no").ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Depo listesi okunamadı");
        }

        return Ok(new { subeler, depolar });
    }

    /// <summary>Şube tanımını kaydeder.</summary>
    [HttpPost]
    public IActionResult Kaydet([FromBody] SubeDepoGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(girdi?.SubeKodu))
            return BadRequest(new { hata = "Şube kodu giriniz." });

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE B360_SUBE_DEPO AS h
USING (SELECT @kod AS sube_kodu) AS k ON h.sube_kodu = k.sube_kodu
WHEN MATCHED THEN UPDATE SET
    sube_adi = @ad, depo_no = @depoNo, eposta = @eposta, aktif = @aktif
WHEN NOT MATCHED THEN
    INSERT (sube_kodu, sube_adi, depo_no, eposta, aktif)
    VALUES (@kod, @ad, @depoNo, @eposta, @aktif);",
            new
            {
                kod = girdi.SubeKodu.Trim(),
                ad = girdi.SubeAdi,
                depoNo = girdi.DepoNo,
                eposta = girdi.Eposta,
                aktif = girdi.Aktif
            });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Seçili şubelerin durumunu topluca değiştirir.
    ///
    /// Otuz dört şubeyi tek tek açıp kapatmak, sezonluk kapanan ya da
    /// yeni açılan mağazalarda uzun bir işti; seçip tek hamlede
    /// değiştirmek gerekiyordu.
    /// </summary>
    [HttpPost("TopluDurum")]
    public IActionResult TopluDurum([FromBody] TopluDurumGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        var kimlikler = (girdi?.Idler ?? new List<int>()).Where(x => x > 0).ToList();

        if (kimlikler.Count == 0)
            return BadRequest(new { hata = "Şube seçilmedi." });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "UPDATE B360_SUBE_DEPO SET aktif = @aktif WHERE id IN @kimlikler",
            new { aktif = girdi.Aktif, kimlikler });

        return Ok(new { basarili = true, etkilenen });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "DELETE FROM B360_SUBE_DEPO WHERE id = @id", new { id });

        if (etkilenen == 0) return NotFound(new { hata = "Kayıt bulunamadı." });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Mikro'daki depoları şube tanımına aktarır.
    ///
    /// Otuz dört şubeyi elle girmek yerine bir kez içe aktarılıyor;
    /// eşleşmeyen ya da adı değişen kayıtlar sonradan düzeltiliyor.
    /// Var olan tanımların üzerine yazılmıyor.
    /// </summary>
    [HttpPost("IceAktar")]
    public IActionResult IceAktar()
    {
        if (!Yetkili) return Forbid();

        List<dynamic> depolar;

        try
        {
            using var mikro = _vt.MikroBaglantisi();

            depolar = mikro.Query(@"
SELECT dep_no AS no, dep_adi AS ad
FROM DEPOLAR WITH (NOLOCK) WHERE dep_iptal = 0").ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Depo listesi okunamadı");

            return StatusCode(500, new { hata = $"Depolar okunamadı. {hata.Message}" });
        }

        using var db = _vt.Baglanti();

        var eklenen = 0;

        foreach (var d in depolar)
        {
            var ad = ((string)d.ad ?? "").Trim();

            if (ad.Length == 0) continue;

            var varMi = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM B360_SUBE_DEPO WHERE sube_kodu = @ad",
                new { ad }) > 0;

            if (varMi) continue;

            db.Execute(@"
INSERT INTO B360_SUBE_DEPO (sube_kodu, sube_adi, depo_no)
VALUES (@ad, @ad, @no)", new { ad, no = (int)d.no });

            eklenen++;
        }

        return Ok(new { eklenen, toplam = depolar.Count });
    }

    /* ====================================================================== */
    /* Mail ayarları                                                         */
    /* ====================================================================== */

    /// <summary>
    /// Mail ayarları.
    ///
    /// Parola geri döndürülmüyor: ekranda gösterilmesi gerekmiyor ve
    /// ayarları görüntüleyen herkesin parolayı okuyabilmesi doğru değil.
    /// </summary>
    [HttpGet("Mail")]
    public IActionResult MailAyarlari()
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var ayarlar = db.Query<(string anahtar, string deger)>(
            "SELECT anahtar, deger FROM B360_AYAR WHERE anahtar LIKE 'mail%'")
            .ToDictionary(x => x.anahtar, x => x.deger,
                StringComparer.OrdinalIgnoreCase);

        string Oku(string a) => ayarlar.TryGetValue(a, out var d) ? d : "";

        return Ok(new
        {
            sunucu = Oku("mailSunucu"),
            port = Oku("mailPort"),
            kullanici = Oku("mailKullanici"),
            parolaVar = !string.IsNullOrWhiteSpace(Oku("mailParola")),
            gonderenAd = Oku("mailGonderenAd"),
            gonderenAdres = Oku("mailGonderenAdres"),
            ssl = Oku("mailSsl") != "false",
            imza = Oku("mailImza")
        });
    }

    /// <summary>Mail ayarlarını yazar.</summary>
    [HttpPost("Mail")]
    public IActionResult MailKaydet([FromBody] MailAyarGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        using var db = _vt.Baglanti();

        void Yaz(string anahtar, string deger)
        {
            /* Boş gönderilen parola var olanı silmiyor: ekran parolayı
               göstermiyor ve her kaydetmede yeniden yazdırmak gereksiz. */
            if (anahtar == "mailParola" && string.IsNullOrWhiteSpace(deger)) return;

            db.Execute(@"
MERGE B360_AYAR AS h
USING (SELECT @anahtar AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @deger, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger) VALUES (@anahtar, @deger);",
                new { anahtar, deger });
        }

        Yaz("mailSunucu", girdi?.Sunucu);
        Yaz("mailPort", girdi?.Port);
        Yaz("mailKullanici", girdi?.Kullanici);
        Yaz("mailParola", girdi?.Parola);
        Yaz("mailGonderenAd", girdi?.GonderenAd);
        Yaz("mailGonderenAdres", girdi?.GonderenAdres);
        Yaz("mailSsl", girdi?.Ssl == false ? "false" : "true");
        Yaz("mailImza", girdi?.Imza);

        return Ok(new { basarili = true });
    }

    /// <summary>Deneme maili gönderir.</summary>
    [HttpPost("Mail/Deneme")]
    public async Task<IActionResult> MailDeneme([FromBody] MailDenemeGirdi girdi)
    {
        if (!Yetkili) return Forbid();

        if (string.IsNullOrWhiteSpace(girdi?.Adres))
            return BadRequest(new { hata = "Deneme adresi giriniz." });

        try
        {
            await _mail.Gonder(
                girdi.Adres.Trim(),
                "Biçen360 deneme maili",
                "<p>Bu bir deneme mesajıdır. Mail ayarları çalışıyor.</p>");

            return Ok(new { basarili = true });
        }
        catch (Exception hata)
        {
            /* Gerçek hata metni gösteriliyor: 'gönderilemedi' demek,
               sunucu adı mı parola mı port mu yanlış sorusunu
               cevapsız bırakıyordu. */
            _kayit.LogError(hata, "Deneme maili gönderilemedi");

            /* İç istisnalar da açılıyor: SMTP hatalarında dış mesaj hep
               "Failure sending mail." oluyor, asıl sebep (sunucu adı
               çözülemedi, bağlantı reddedildi, kimlik doğrulanamadı)
               içeride duruyor ve ekranda hiçbir şey anlatmıyordu. */
            return StatusCode(500, new
            {
                hata = MailServisi.HataMetni(hata),
                ayarlar = _mail.Tani(),
            });
        }
    }

    /// <summary>
    /// Mail tanısı: sunucunun gerçekte hangi ayarları okuduğu.
    ///
    /// "Ayarları girdim ama mail gitmiyor" sorusunun ilk bakılacak yeri.
    /// Parola döndürülmüyor, yalnızca dolu olup olmadığı.
    /// </summary>
    [HttpGet("Mail/Tani")]
    public IActionResult MailTani()
    {
        if (!Yetkili) return Forbid();

        return Ok(_mail.Tani());
    }
}

/* ========================================================================== */

public class SubeDepoGirdi
{
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public int? DepoNo { get; set; }
    public string Eposta { get; set; }
    public bool Aktif { get; set; } = true;
}

public class MailAyarGirdi
{
    public string Sunucu { get; set; }
    public string Port { get; set; }
    public string Kullanici { get; set; }
    public string Parola { get; set; }
    public string GonderenAd { get; set; }
    public string GonderenAdres { get; set; }
    public bool Ssl { get; set; } = true;
    public string Imza { get; set; }
}

public class MailDenemeGirdi
{
    public string Adres { get; set; }
}


public class TopluDurumGirdi
{
    public List<int> Idler { get; set; } = new();
    public bool Aktif { get; set; }
}

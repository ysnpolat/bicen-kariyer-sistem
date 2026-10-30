using System.Security.Claims;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Bicen360.API.Servisler;

namespace Bicen360.API.Controllers;

/// <summary>
/// Portal kullanıcıları.
///
/// <para>
/// Kullanıcılar Kariyer sistemiyle ortak tabloda (KRY_KULLANICILAR): aynı
/// hesap iki panele de girebiliyor. Portaldan açılan kullanıcı için iki
/// ek karar var: İK paneline de girebilsin mi, ve şube kullanıcısıysa
/// hangi şubeye kilitli olsun.
/// </para>
///
/// <para>
/// Sicil girilince kişinin adı, görevi, şubesi, pozisyon grubu ve temsilci
/// olduğu departmanlar personel kaydından geliyor. Elle yazmak hem yavaş
/// hem hataya açıktı; aynı kişi iki farklı adla iki kez açılıyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class KullaniciController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly KapsamServisi _grupKapsam;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly ILogger<KullaniciController> _kayit;

    public KullaniciController(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        PersonelServisi personel,
        KapsamServisi grupKapsam,
        PanelKullaniciServisi panelKullanici,
        ILogger<KullaniciController> kayit)
    {
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _grupKapsam = grupKapsam;
        _panelKullanici = panelKullanici;
        _kayit = kayit;
    }

    private string Ad => User.FindFirstValue(ClaimTypes.Name) ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    /// <summary>Kullanıcı yönetimi Yönetim sayfasının parçası.</summary>
    private bool Yetkili() => _yetki.SayfaAcik(Ad, Rol, "yonetim");

    /* ==================================================================== */
    /* Liste ve seçenekler                                                  */
    /* ==================================================================== */

    [HttpGet]
    public IActionResult Liste()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kullanicilar = db.Query(@"
SELECT K.id, K.kullanici_adi AS kullaniciAdi, K.ad_soyad AS adSoyad, K.eposta,
       K.rol, K.aktif, K.sicil,
       CAST(ISNULL(K.ik_erisim, 1) AS BIT) AS ikErisim,
       K.depo_no AS depoNo, K.sube_kodu AS subeKodu, S.sube_adi AS subeAdi,
       K.olusturma
FROM KRY_KULLANICILAR K
    LEFT JOIN B360_SUBE_DEPO S ON S.sube_kodu = K.sube_kodu
ORDER BY K.aktif DESC, K.ad_soyad").ToList();

        /* Temsilcilikler sicile bağlı: departman temsilcisi tablosu
           personel koduyla tutuluyor. */
        var temsilci = db.Query(@"
SELECT T.personel_kodu AS sicil, D.ad
FROM B360_DEPARTMAN_TEMSILCI T
    INNER JOIN B360_DEPARTMAN D ON D.id = T.departman_id").ToList()
            .GroupBy(x => ((string)x.sicil ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(x => (string)x.ad).ToList(),
                StringComparer.OrdinalIgnoreCase);

        return Ok(new
        {
            kullanicilar = kullanicilar.Select(k => new
            {
                k.id, k.kullaniciAdi, k.adSoyad, k.eposta, k.rol, k.aktif, k.sicil,
                k.ikErisim, k.depoNo, k.subeKodu, k.subeAdi, k.olusturma,
                temsilcilikler = !string.IsNullOrWhiteSpace((string)k.sicil)
                    && temsilci.TryGetValue(((string)k.sicil).Trim(), out var l)
                    ? l : new List<string>(),
            }),
        });
    }

    /// <summary>Form için seçim listeleri.</summary>
    [HttpGet("Secenekler")]
    public IActionResult Secenekler()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        /* Roller: tabloda kullanılanlar ve sabit roller birlikte; yeni
           kurulmuş bir sistemde tablo boşken de seçim yapılabilsin. */
        var sabit = new[]
        {
            "Admin", "IKYoneticisi", "IK", "GenelMudurYardimcisi",
            "BolgeKoordinatoru", "BolgeMuduru", "FotografGorevlisi",
        };

        var roller = db.Query<string>(
                "SELECT DISTINCT rol FROM KRY_KULLANICILAR WHERE rol IS NOT NULL")
            .Concat(sabit)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var departmanlar = db.Query(
            "SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList();

        var subeler = db.Query(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo
FROM B360_SUBE_DEPO
WHERE aktif = 1 AND depo_no IS NOT NULL
ORDER BY depo_no").ToList();

        return Ok(new { roller, departmanlar, subeler });
    }

    /* ==================================================================== */
    /* Sicil ve depo çözümleme                                              */
    /* ==================================================================== */

    /// <summary>
    /// Sicilden kişinin bilgileri: ad, görev, şube, grup, temsilcilikler,
    /// şubesinin depo kodu ve bu sicille açılmış kullanıcı var mı.
    /// </summary>
    [HttpGet("Sicil/{sicil}")]
    public IActionResult Sicil(string sicil)
    {
        if (!Yetkili()) return Forbid();

        sicil = (sicil ?? "").Trim();

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return NotFound(new { hata = $"\"{sicil}\" sicil numarasıyla aktif personel bulunamadı." });

        using var db = _vt.Baglanti();

        var temsilcilikler = db.Query<int>(
            "SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI WHERE personel_kodu = @sicil",
            new { sicil }).ToList();

        /* Şube önerisi: personel kaydındaki iş grubu, şube tanımındaki
           kodla eşleşiyorsa depo kodu da geliyor. Mağaza personeli için
           şube modu tek tıkla açılabilsin. */
        var sube = db.QueryFirstOrDefault(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo
FROM B360_SUBE_DEPO WHERE sube_kodu = @s AND aktif = 1", new { s = kisi.Sube });

        var mevcut = db.QueryFirstOrDefault(@"
SELECT id, kullanici_adi AS kullaniciAdi FROM KRY_KULLANICILAR WHERE sicil = @sicil",
            new { sicil });

        var grup = _grupKapsam.GrupBul(kisi.Pozisyon);

        return Ok(new
        {
            sicil,
            adSoyad = kisi.AdSoyad,
            pozisyon = kisi.Pozisyon,
            sube = kisi.Sube,
            grup = grup?.Ad,
            temsilcilikler,
            onerilenSube = sube,
            mevcutKullanici = mevcut,
        });
    }

    /// <summary>Depo kodundan şube.</summary>
    [HttpGet("Depo/{depoNo:int}")]
    public IActionResult Depo(int depoNo)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var sube = db.QueryFirstOrDefault(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo
FROM B360_SUBE_DEPO WHERE depo_no = @depoNo AND aktif = 1", new { depoNo });

        if (sube is null)
            return NotFound(new
            {
                hata = $"{depoNo} depo koduyla tanımlı şube yok.",
                ayrinti = "Yönetim → Şube ve Mail ekranından şubenin depo kodunu kontrol ediniz."
            });

        return Ok(sube);
    }

    /* ==================================================================== */
    /* Kaydetme                                                             */
    /* ==================================================================== */

    [HttpPost]
    public IActionResult Kaydet([FromBody] KullaniciGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null) return BadRequest(new { hata = "Bilgiler eksik." });

        var kullaniciAdi = (girdi.KullaniciAdi ?? "").Trim();
        var adSoyad = (girdi.AdSoyad ?? "").Trim();
        var sicil = string.IsNullOrWhiteSpace(girdi.Sicil) ? null : girdi.Sicil.Trim();

        if (kullaniciAdi.Length < 3)
            return BadRequest(new { hata = "Kullanıcı adı en az üç karakter olmalıdır." });

        if (adSoyad.Length == 0)
            return BadRequest(new { hata = "Ad soyad giriniz." });

        if (string.IsNullOrWhiteSpace(girdi.Rol))
            return BadRequest(new { hata = "Rol seçiniz." });

        /* Kendini kilitleme: kendi hesabının İK erişimini ya da aktifliğini
           kapatan kişi, geri açamayacağı bir duruma düşüyordu. */
        if (girdi.Id > 0 && string.Equals(kullaniciAdi, Ad, StringComparison.OrdinalIgnoreCase)
            && (!girdi.Aktif || girdi.SubeModu))
            return BadRequest(new { hata = "Kendi hesabınızı pasife alamaz ya da bir şubeye kilitleyemezsiniz." });

        using var db = _vt.Baglanti();

        /* Şube modu: depo kodu şube tanımında olmalı */
        string subeKodu = null;
        int? depoNo = null;

        if (girdi.SubeModu)
        {
            if (girdi.DepoNo is null or <= 0)
                return BadRequest(new { hata = "Şube modu için depo kodu giriniz." });

            subeKodu = db.ExecuteScalar<string>(
                "SELECT sube_kodu FROM B360_SUBE_DEPO WHERE depo_no = @d AND aktif = 1",
                new { d = girdi.DepoNo });

            if (subeKodu is null)
                return BadRequest(new { hata = $"{girdi.DepoNo} depo koduyla tanımlı şube yok." });

            depoNo = girdi.DepoNo;
        }

        /* Aynı kullanıcı adı ve aynı sicille ikinci hesap açılmıyor */
        var cakisan = db.QueryFirstOrDefault(@"
SELECT id, kullanici_adi AS kullaniciAdi, sicil FROM KRY_KULLANICILAR
WHERE (kullanici_adi = @kullaniciAdi OR (@sicil IS NOT NULL AND sicil = @sicil))
  AND id <> @id", new { kullaniciAdi, sicil, id = girdi.Id });

        if (cakisan is not null)
            return BadRequest(new
            {
                hata = string.Equals((string)cakisan.kullaniciAdi, kullaniciAdi, StringComparison.OrdinalIgnoreCase)
                    ? "Bu kullanıcı adı başka bir hesapta kayıtlı."
                    : $"Bu sicille zaten bir hesap var: {(string)cakisan.kullaniciAdi}"
            });

        int id;

        if (girdi.Id > 0)
        {
            var eskiAd = db.ExecuteScalar<string>(
                "SELECT kullanici_adi FROM KRY_KULLANICILAR WHERE id = @id", new { id = girdi.Id });

            if (eskiAd is null) return NotFound(new { hata = "Kullanıcı bulunamadı." });

            db.Execute(@"
UPDATE KRY_KULLANICILAR SET
    kullanici_adi = @kullaniciAdi, ad_soyad = @adSoyad, eposta = @eposta,
    rol = @rol, aktif = @aktif, sicil = @sicil, ik_erisim = @ikErisim,
    depo_no = @depoNo, sube_kodu = @subeKodu
WHERE id = @id", new
            {
                id = girdi.Id, kullaniciAdi, adSoyad, eposta = Bos(girdi.Eposta),
                rol = girdi.Rol.Trim(), aktif = girdi.Aktif, sicil,
                ikErisim = girdi.IkErisim, depoNo, subeKodu,
            });

            if (!string.IsNullOrWhiteSpace(girdi.Parola))
            {
                var sorun = ParolaServisi.GucKontrolu(girdi.Parola);

                if (sorun is not null) return BadRequest(new { hata = sorun });

                var (h, s) = ParolaServisi.Uret(girdi.Parola);

                db.Execute("UPDATE KRY_KULLANICILAR SET parola_hash = @h, parola_salt = @s WHERE id = @id",
                    new { h, s, id = girdi.Id });
            }

            _panelKullanici.Unut(eskiAd);
            id = girdi.Id;
        }
        else
        {
            var sorun = ParolaServisi.GucKontrolu(girdi.Parola);

            if (sorun is not null) return BadRequest(new { hata = sorun });

            var (h, s) = ParolaServisi.Uret(girdi.Parola);

            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_KULLANICILAR
    (kullanici_adi, ad_soyad, eposta, parola_hash, parola_salt, rol, aktif,
     sicil, ik_erisim, depo_no, sube_kodu)
OUTPUT INSERTED.id
VALUES (@kullaniciAdi, @adSoyad, @eposta, @h, @s, @rol, @aktif,
        @sicil, @ikErisim, @depoNo, @subeKodu)", new
            {
                kullaniciAdi, adSoyad, eposta = Bos(girdi.Eposta), h, s,
                rol = girdi.Rol.Trim(), aktif = girdi.Aktif, sicil,
                ikErisim = girdi.IkErisim, depoNo, subeKodu,
            });
        }

        /* Temsilcilikler: yalnızca sicil varsa ve liste gönderildiyse.
           Liste gönderilmemişse dokunulmuyor — başka ekrandan (departman
           formu) verilmiş temsilcilikler bu formun eksik alanı yüzünden
           silinmemeli. */
        if (sicil is not null && girdi.Temsilcilikler is not null)
        {
            db.Open();

            using var islem = db.BeginTransaction();

            db.Execute("DELETE FROM B360_DEPARTMAN_TEMSILCI WHERE personel_kodu = @sicil",
                new { sicil }, islem);

            foreach (var d in girdi.Temsilcilikler.Where(x => x > 0).Distinct())
                db.Execute(@"
INSERT INTO B360_DEPARTMAN_TEMSILCI (departman_id, personel_kodu)
VALUES (@d, @sicil)", new { d, sicil }, islem);

            islem.Commit();
        }

        _panelKullanici.Unut(kullaniciAdi);

        _kayit.LogInformation(
            "Kullanıcı kaydedildi: {Kullanici} (İK: {Ik}, şube: {Sube}) — {Yapan}",
            kullaniciAdi, girdi.IkErisim, subeKodu ?? "-", Ad);

        return Ok(new { basarili = true, id });
    }

    private static string Bos(string d) => string.IsNullOrWhiteSpace(d) ? null : d.Trim();
}

/* ========================================================================== */

public class KullaniciGirdi
{
    public int Id { get; set; }
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Eposta { get; set; }
    public string Rol { get; set; }
    public bool Aktif { get; set; } = true;

    /// <summary>Yeni hesapta zorunlu; düzenlemede boşsa değişmez.</summary>
    public string Parola { get; set; }

    public string Sicil { get; set; }

    /// <summary>İK paneline de girebilsin mi.</summary>
    public bool IkErisim { get; set; }

    /// <summary>Şube kullanıcısı: portalda yalnızca bu şubenin verisini görür.</summary>
    public bool SubeModu { get; set; }
    public int? DepoNo { get; set; }

    /// <summary>Temsilcisi olduğu departmanlar; boş bırakılırsa dokunulmaz.</summary>
    public List<int> Temsilcilikler { get; set; }
}

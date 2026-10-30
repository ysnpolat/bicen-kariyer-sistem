using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Rakip web fiyatları: aracın Excel'ini yükleme ve web ürünlerini bizim
/// stok kartlarımızla eşleştirme (09.10.2026). Bkz. <see cref="RakipWebServisi"/>.
/// Yalnızca panel (Rakip Fiyat sayfası yetkisi).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RakipWebController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly RakipWebServisi _web;
    private readonly ILogger<RakipWebController> _kayit;

    public RakipWebController(VeritabaniServisi vt, YetkiServisi yetki, RakipWebServisi web, ILogger<RakipWebController> kayit)
    {
        _vt = vt;
        _yetki = yetki;
        _web = web;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    private bool Yetkili() =>
        !Kullanici.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)
        && _yetki.SayfaAcik(Kullanici, Rol, "rakipfiyat");

    private string Imza => User.FindFirstValue("adSoyad") is { Length: > 0 } ad ? ad : Kullanici;

    /* ==================================================================== */
    /* Yükleme                                                              */
    /* ==================================================================== */

    [HttpPost("Yukle")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> Yukle(IFormFile dosya)
    {
        if (!Yetkili()) return Forbid();

        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });

        using var bellek = new MemoryStream();
        await dosya.CopyToAsync(bellek);
        var veri = bellek.ToArray();
        var ozet = RakipWebServisi.Ozet(veri);

        var (satirlar, hata) = RakipWebServisi.ExcelOku(new MemoryStream(veri));
        if (hata is not null) return BadRequest(new { hata });
        if (satirlar.Count == 0) return BadRequest(new { hata = "Dosyada ürün satırı yok." });

        using var db = _vt.Baglanti();
        db.Open();

        var onceki = db.QueryFirstOrDefault<DateTime?>(
            "SELECT TOP 1 olusturma FROM B360_RAKIP_WEB_YUKLEME WHERE ozet = @ozet", new { ozet });
        if (onceki is not null)
            return BadRequest(new { hata = $"Bu dosya {onceki:dd.MM.yyyy HH:mm} tarihinde zaten yüklendi." });

        int yuklemeId;
        using (var islem = db.BeginTransaction())
        {
            yuklemeId = db.ExecuteScalar<int>(@"
INSERT INTO B360_RAKIP_WEB_YUKLEME (dosya_adi, ozet, yukleyen, satir)
OUTPUT INSERTED.id VALUES (@ad, @ozet, @yukleyen, @satir)",
                new { ad = dosya.FileName, ozet, yukleyen = Imza, satir = satirlar.Count }, islem);

            foreach (var s in satirlar)
            {
                db.Execute(@"
INSERT INTO B360_RAKIP_WEB
    (yukleme_id, site, site_anahtar, urun_adi, ad_anahtar, link, link_anahtar, fiyat, eski_fiyat, sayfa, okunma)
VALUES (@yuklemeId, @site, @siteAnahtar, @ad, @adAnahtar, @link, @linkAnahtar, @fiyat, @eski, @sayfa, @okunma)",
                    new
                    {
                        yuklemeId,
                        site = s.Firma,
                        siteAnahtar = RakipWebServisi.Anahtar(s.Firma),
                        ad = s.UrunAdi,
                        adAnahtar = RakipWebServisi.Anahtar(s.UrunAdi),
                        link = s.Link,
                        linkAnahtar = RakipWebServisi.LinkAnahtari(s.Link),
                        fiyat = s.Fiyat,
                        eski = s.EskiFiyat,
                        sayfa = s.Sayfa,
                        okunma = s.Okunma,
                    }, islem);
            }

            islem.Commit();
        }

        var eslesen = _web.OtomatikEslestir(db, yuklemeId);
        var kayit = _web.KayitlariUret(db, yuklemeId: yuklemeId);

        /* Önceki eşleştirmelerle tutmayanlar benzerlikle (%95 ve üstü):
           arka planda; yükleme isteği beklemiyor */
        var arkaPlan = _web.OtoBaslat(yuklemeId);

        var durum = db.QueryFirst(@"
SELECT COUNT(*) AS toplam,
       SUM(CASE WHEN W.eslesme_id IS NULL THEN 1 ELSE 0 END) AS bekleyen,
       SUM(CASE WHEN E.yok = 1 THEN 1 ELSE 0 END) AS yok
FROM B360_RAKIP_WEB W LEFT JOIN B360_RAKIP_WEB_ESLESME E ON E.id = W.eslesme_id
WHERE W.yukleme_id = @yuklemeId", new { yuklemeId });

        _kayit.LogInformation("Rakip web fiyatı yüklendi: {Dosya} · {Satir} satır · {Eslesen} otomatik eşleşti · {Yapan}",
            dosya.FileName, satirlar.Count, eslesen, Imza);

        return Ok(new
        {
            yuklemeId,
            satir = satirlar.Count,
            otomatik = eslesen,
            arkaPlan,
            kayit,
            bekleyen = (int)durum.bekleyen,
            yok = (int)(durum.yok ?? 0),
            mesaj = $"{satirlar.Count} ürün yüklendi; {eslesen} tanesi daha önceki eşleştirmelerle eşleşti. "
                  + (arkaPlan ? "Kalanlar ad benzerliğiyle (%95 ve üstü) arka planda eşleştiriliyor." : $"{(int)durum.bekleyen} tanesi eşleştirme bekliyor.")
        });
    }

    [HttpGet("Yuklemeler")]
    public IActionResult Yuklemeler()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        return Ok(db.Query(@"
SELECT TOP 50 U.id, U.dosya_adi AS dosyaAdi, U.yukleyen, U.satir, U.olusturma,
       (SELECT COUNT(*) FROM B360_RAKIP_WEB W WHERE W.yukleme_id = U.id AND W.eslesme_id IS NOT NULL) AS eslesen,
       (SELECT COUNT(DISTINCT W.site) FROM B360_RAKIP_WEB W WHERE W.yukleme_id = U.id) AS siteSayisi
FROM B360_RAKIP_WEB_YUKLEME U ORDER BY U.id DESC").ToList());
    }

    /* ==================================================================== */
    /* Eşleştirme                                                           */
    /* ==================================================================== */

    /// <summary>Siteler ve eşleştirme durumu</summary>
    [HttpGet("Siteler")]
    public IActionResult Siteler()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        return Ok(db.Query(@"
SELECT W.site_anahtar AS anahtar, MAX(W.site) AS site,
       COUNT(DISTINCT CASE WHEN W.eslesme_id IS NULL THEN W.ad_anahtar END) AS bekleyen,
       COUNT(DISTINCT CASE WHEN W.eslesme_id IS NOT NULL THEN W.ad_anahtar END) AS eslesen,
       MAX(W.okunma) AS son
FROM B360_RAKIP_WEB W GROUP BY W.site_anahtar ORDER BY MAX(W.okunma) DESC").ToList());
    }

    /// <summary>Eşleşmeyi bekleyen web ürünleri (site + ad tekil, en son fiyatıyla)</summary>
    [HttpGet("Bekleyenler")]
    public IActionResult Bekleyenler([FromQuery] string site = null, [FromQuery] string ara = null)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        var liste = db.Query(@"
SELECT TOP 1000 X.site_anahtar AS siteAnahtar, X.ad_anahtar AS adAnahtar, X.site, X.urun_adi AS ad,
       X.fiyat, X.eski_fiyat AS eskiFiyat, X.link, X.okunma, X.adet
FROM (
    SELECT W.*, COUNT(*) OVER (PARTITION BY W.site_anahtar, W.ad_anahtar) AS adet,
           ROW_NUMBER() OVER (PARTITION BY W.site_anahtar, W.ad_anahtar ORDER BY W.okunma DESC, W.id DESC) AS sira
    FROM B360_RAKIP_WEB W
    WHERE W.eslesme_id IS NULL
      AND (@site IS NULL OR W.site_anahtar = @site)
      AND (@kalip IS NULL OR W.urun_adi LIKE @kalip)
) X
WHERE X.sira = 1
ORDER BY X.site, X.urun_adi", new { site = string.IsNullOrWhiteSpace(site) ? null : site, kalip }).ToList();

        /* En iyi aday ve puanı (12.10.2026): neyin neden eşleşmediği
           listede görünsün, uygunsa tek tıkla onaylansın. Bellekteki stok
           dizininden; okunamazsa liste adaysız döner. */
        var retler = db.Query<(string Site, string Ad, string Kod)>(
                "SELECT site_anahtar, ad_anahtar, stok_kodu FROM B360_RAKIP_WEB_RED")
            .Select(x => $"{x.Site}|{x.Ad}|{x.Kod}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        string adayHatasi = null;

        var sonuc = liste.Select(x =>
        {
            (string Kod, string Ad, double Puan) bir = default, iki = default;

            if (adayHatasi is null)
                try
                {
                    var l = _web.DizindenAdaylar((string)x.ad, 3)
                        .Where(a => !retler.Contains($"{(string)x.siteAnahtar}|{(string)x.adAnahtar}|{a.Kod}"))
                        .ToList();
                    if (l.Count > 0) bir = l[0];
                    if (l.Count > 1) iki = l[1];
                }
                catch (Exception hata)
                {
                    adayHatasi = hata.Message;
                    _kayit.LogWarning(hata, "Bekleyenler: aday okunamadı");
                }

            return new
            {
                siteAnahtar = (string)x.siteAnahtar,
                adAnahtar = (string)x.adAnahtar,
                site = (string)x.site,
                ad = (string)x.ad,
                fiyat = (decimal)x.fiyat,
                eskiFiyat = (decimal?)x.eskiFiyat,
                link = (string)x.link,
                okunma = (DateTime)x.okunma,
                adet = (int)x.adet,
                adayKod = bir.Kod,
                adayAd = bir.Ad,
                adayPuan = bir.Kod is null ? (double?)null : Math.Round(bir.Puan * 100, 1),
                ikinciPuan = iki.Kod is null ? (double?)null : Math.Round(iki.Puan * 100, 1),
                adayHatasi,
            };
        }).ToList();

        return Ok(sonuc);
    }

    /// <summary>Web ürününe en çok benzeyen stok kartları</summary>
    [HttpGet("Oneri")]
    public IActionResult Oneri([FromQuery] string ad)
    {
        if (!Yetkili()) return Forbid();

        try
        {
            return Ok(_web.Oneriler(ad));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Stok önerisi alınamadı");
            return StatusCode(503, new { hata = $"Mikro'dan stok okunamadı: {hata.Message}" });
        }
    }

    /// <summary>Stok kartı arama: ad, stok kodu ya da barkod</summary>
    [HttpGet("StokAra")]
    public IActionResult StokAra([FromQuery] string q)
    {
        if (!Yetkili()) return Forbid();

        try
        {
            return Ok(_web.StokAra(q));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Stok aranamadı");
            return StatusCode(503, new { hata = $"Mikro'dan stok okunamadı: {hata.Message}" });
        }
    }

    public sealed class EslestirGirdi
    {
        public string SiteAnahtar { get; set; }
        public string AdAnahtar { get; set; }
        public string StokKodu { get; set; }

        /// <summary>Bizde bu ürün yok: bir daha sorulmaz</summary>
        public bool Yok { get; set; }
    }

    /// <summary>
    /// Web ürününü stok kartına bağlar. Aynı site + ad (ya da aynı ürün
    /// linki) bundan sonra kendiliğinden eşleşir; geçmiş yüklemelerdeki
    /// aynı ürün de rakip fiyat kaydına çevrilir.
    /// </summary>
    [HttpPost("Eslestir")]
    public IActionResult Eslestir([FromBody] EslestirGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.SiteAnahtar) || string.IsNullOrWhiteSpace(girdi.AdAnahtar))
            return BadRequest(new { hata = "Web ürünü seçilmedi." });

        if (!girdi.Yok && string.IsNullOrWhiteSpace(girdi.StokKodu))
            return BadRequest(new { hata = "Stok kartı seçiniz." });

        RakipWebServisi.Stok stok = null;
        if (!girdi.Yok)
        {
            try
            {
                stok = _web.StokBilgisi(new[] { girdi.StokKodu }).Values.FirstOrDefault();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Stok okunamadı");
                return StatusCode(503, new { hata = "Mikro'dan stok okunamadı." });
            }

            if (stok is null) return BadRequest(new { hata = "Stok kartı Mikro'da bulunamadı." });
        }

        using var db = _vt.Baglanti();
        db.Open();

        var ornek = db.QueryFirstOrDefault(@"
SELECT TOP 1 urun_adi AS ad, link_anahtar AS link FROM B360_RAKIP_WEB
WHERE site_anahtar = @s AND ad_anahtar = @a ORDER BY okunma DESC",
            new { s = girdi.SiteAnahtar, a = girdi.AdAnahtar });

        if (ornek is null) return NotFound(new { hata = "Web ürünü bulunamadı." });

        /* Aynı ürün için eski eşleşme varsa yerine geçer; otomatik
           eşleşmenin kartı farklıysa ret listesine yazılır */
        var eski = db.Query<int>(
            "SELECT id FROM B360_RAKIP_WEB_ESLESME WHERE site_anahtar = @s AND ad_anahtar = @a",
            new { s = girdi.SiteAnahtar, a = girdi.AdAnahtar }).ToList();
        foreach (var e in eski) EslesmeSilIc(db, e, Imza, girdi.Yok ? null : stok?.StokKodu);

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_RAKIP_WEB_ESLESME (site_anahtar, ad_anahtar, link_anahtar, web_ad, stok_kodu, urun_adi, yok, eslestiren)
OUTPUT INSERTED.id VALUES (@s, @a, @link, @webAd, @stok, @urun, @yok, @kim)",
            new
            {
                s = girdi.SiteAnahtar,
                a = girdi.AdAnahtar,
                link = (string)ornek.link,
                webAd = (string)ornek.ad,
                stok = girdi.Yok ? null : stok.StokKodu,
                urun = girdi.Yok ? null : stok.Ad,
                yok = girdi.Yok,
                kim = Imza,
            });

        _web.OtomatikEslestir(db);
        var kayit = _web.KayitlariUret(db, eslesmeId: id);

        return Ok(new { id, kayit, bizimFiyat = stok?.Fiyat });
    }

    [HttpGet("Eslesmeler")]
    public IActionResult Eslesmeler([FromQuery] string site = null, [FromQuery] string ara = null, [FromQuery] string tur = null)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        return Ok(db.Query(@"
SELECT TOP 1000 E.id, E.site_anahtar AS siteAnahtar,
       (SELECT TOP 1 W.site FROM B360_RAKIP_WEB W WHERE W.site_anahtar = E.site_anahtar) AS site,
       E.web_ad AS webAd, E.stok_kodu AS stokKodu, E.urun_adi AS urunAdi, E.yok, E.eslestiren, E.olusturma,
       E.ad_anahtar AS adAnahtar, E.otomatik, E.puan,
       (SELECT TOP 1 W.eski_fiyat FROM B360_RAKIP_WEB W WHERE W.eslesme_id = E.id ORDER BY W.okunma DESC) AS sonWebEskiFiyat,
       (SELECT TOP 1 W.link FROM B360_RAKIP_WEB W WHERE W.eslesme_id = E.id ORDER BY W.okunma DESC) AS link,
       (SELECT TOP 1 W.okunma FROM B360_RAKIP_WEB W WHERE W.eslesme_id = E.id ORDER BY W.okunma DESC) AS okunma,
       (SELECT COUNT(*) FROM B360_RAKIP_WEB W WHERE W.eslesme_id = E.id) AS adet,
       (SELECT TOP 1 W.fiyat FROM B360_RAKIP_WEB W WHERE W.eslesme_id = E.id ORDER BY W.okunma DESC) AS sonWebFiyat,
       (SELECT TOP 1 R.bizim_fiyat FROM B360_RAKIP_FIYAT R WHERE R.web_eslesme_id = E.id ORDER BY R.olusturma DESC) AS bizimFiyat
FROM B360_RAKIP_WEB_ESLESME E
WHERE (@site IS NULL OR E.site_anahtar = @site)
  AND (@kalip IS NULL OR E.web_ad LIKE @kalip OR E.urun_adi LIKE @kalip OR E.stok_kodu LIKE @kalip)
  AND (@tur IS NULL OR (@tur = 'otomatik' AND E.otomatik = 1) OR (@tur = 'elle' AND E.otomatik = 0 AND E.yok = 0)
       OR (@tur = 'yok' AND E.yok = 1))
ORDER BY E.olusturma DESC", new
        {
            site = string.IsNullOrWhiteSpace(site) ? null : site,
            kalip,
            tur = tur is "otomatik" or "elle" or "yok" ? tur : null
        }).ToList());
    }

    /// <summary>
    /// Yüklemeyi siler: o dosyadaki web fiyatları ve onlardan üretilen rakip
    /// fiyat kayıtları gider. Eşleştirmeler kalır; aynı ürünler yeniden
    /// yüklendiğinde kendiliğinden eşleşir (yanlış okunan dosyayı düzeltip
    /// yeniden yüklemek için).
    /// </summary>
    [HttpDelete("Yukleme/{id:int}")]
    public IActionResult YuklemeSil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        db.Open();
        using var islem = db.BeginTransaction();

        var silinen = db.Execute(@"
DELETE FROM B360_RAKIP_FIYAT
WHERE id IN (SELECT rakip_fiyat_id FROM B360_RAKIP_WEB WHERE yukleme_id = @id AND rakip_fiyat_id IS NOT NULL);", new { id }, islem);

        db.Execute(@"
DELETE FROM B360_RAKIP_WEB WHERE yukleme_id = @id;
DELETE FROM B360_RAKIP_WEB_YUKLEME WHERE id = @id;", new { id }, islem);

        islem.Commit();

        return Ok(new { silindi = true, rakipKaydi = silinen });
    }

    /// <summary>Eşleşmeyi kaldırır: ondan üretilen rakip fiyat kayıtları da silinir</summary>
    [HttpDelete("Eslesme/{id:int}")]
    public IActionResult EslesmeSil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        db.Open();
        EslesmeSilIc(db, id, Imza, null);
        return Ok(new { silindi = true });
    }

    /// <summary>
    /// Benzerlikle otomatik eşleştirme (12.10.2026): eşleşmesi olmayan web
    /// ürünlerinden en çok 600'ü; %95 ve üstü, net kazanan aday varsa.
    /// </summary>
    [HttpPost("OtoEslestir")]
    public IActionResult OtoEslestir([FromQuery] int esik = 95)
    {
        if (!Yetkili()) return Forbid();

        /* Eşik kişi tarafından düşürülebiliyor (en az %70); %95 altı
           eşleştirmeyi yapanın adıyla işaretleniyor */
        var e = Math.Clamp(esik, 70, 100);
        var basladi = _web.OtoBaslat(null, e / 100.0, e >= 95 ? "otomatik" : $"{Imza} · toplu %{e}");
        return Ok(new { basladi, durum = _web.OtoDurumu() });
    }

    /// <summary>Arka plandaki otomatik eşleştirmenin ilerlemesi</summary>
    [HttpGet("OtoEslestir/Durum")]
    public IActionResult OtoDurum()
    {
        if (!Yetkili()) return Forbid();
        return Ok(_web.OtoDurumu());
    }

    /// <summary>
    /// Eşleşmeyi siler. Otomatik açılmış bir eşleşme kaldırılıyorsa (ya da
    /// başka bir karta çevriliyorsa) o kart ret listesine yazılır: aynı web
    /// ürününe bir daha otomatik bağlanmaz.
    /// </summary>
    private static void EslesmeSilIc(System.Data.IDbConnection db, int id, string kim, string yeniStok)
    {
        db.Execute(@"
INSERT INTO B360_RAKIP_WEB_RED (site_anahtar, ad_anahtar, stok_kodu, reddeden)
SELECT site_anahtar, ad_anahtar, stok_kodu, @kim FROM B360_RAKIP_WEB_ESLESME
WHERE id = @id AND otomatik = 1 AND stok_kodu IS NOT NULL
  AND (@yeniStok IS NULL OR stok_kodu <> @yeniStok);", new { id, kim, yeniStok });

        db.Execute(@"
DELETE FROM B360_RAKIP_FIYAT WHERE web_eslesme_id = @id;
UPDATE B360_RAKIP_WEB SET eslesme_id = NULL, rakip_fiyat_id = NULL WHERE eslesme_id = @id;
DELETE FROM B360_RAKIP_WEB_ESLESME WHERE id = @id;", new { id });
    }
}

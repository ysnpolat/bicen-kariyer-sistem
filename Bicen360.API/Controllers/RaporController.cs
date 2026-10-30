using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Raporlar.
///
/// <para>
/// Arıza kayıtları, servis maliyeti, rakip fiyat ve künye özetleri tek
/// denetleyicide: hepsi aynı tarih aralığı ve departman süzgecini
/// kullanıyor ve ayrı ayrı yazmak aynı mantığı dört kez sürdürmek
/// olurdu.
/// </para>
///
/// <para>
/// Kapsam kullanıcıya göre daralıyor: bir departmanın temsilcisi yalnızca
/// kendi departmanının verisini görüyor. Bütün departmanları görme yetkisi
/// olan kullanıcı süzgeçten departman seçebiliyor. Herkese her veriyi
/// açmak, maliyet rakamlarını bütün mağaza sorumlularına göstermek
/// demekti.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RaporController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly RaporKapsami _kapsam;
    private readonly ILogger<RaporController> _kayit;

    public RaporController(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        RaporKapsami kapsam,
        ILogger<RaporController> kayit)
    {
        _vt = vt;
        _yetki = yetki;
        _kapsam = kapsam;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";

    private string Rol =>
        User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>
    /// Kişinin rapor kapsamı: yönetici rolü tümünü, departman temsilcisi
    /// kendi departmanlarını görüyor. Ayrı bir yetki satırı yok; kapsam
    /// zaten tanımlı olan görevlerden çıkarılıyor.
    /// </summary>
    private RaporKapsami.Kapsam Benim => _kapsam.Panel(Kullanici, Rol);

    private bool TumunuGorur => Benim.TumunuGorur;

    /* Raporlar sayfası sekmeleri (13.10.2026): arıza, envanter ve servis
       maliyeti. Rolü olan kullanıcı rolde seçilenleri görür; sunucu da
       yalnızca onları verir. Rakip fiyat ve künye raporları bu sayfadan
       kaldırıldı, uçları kendi sayfa yetkisine bağlandı. */
    private List<string> _izinli;
    private List<string> Izinli => _izinli ??= _kapsam.Raporlari(Kullanici, Rol);
    private bool Izin(string kod) => Izinli.Contains(kod);

    private bool MaliyetGorur => _kapsam.MaliyetGorur(Kullanici, Rol);

    /// <summary>Şube kullanıcısında şube süzgeci kilitli</summary>
    private string SubeKilidi => Benim.Sube;

    /* ====================================================================== */

    /// <summary>
    /// Rapor ekranının açılış verisi: yetki kapsamı ve süzgeç seçenekleri.
    /// </summary>
    [HttpGet("Secenekler")]
    public IActionResult Secenekler()
    {
        if (Izinli.Count == 0) return StatusCode(403, new { hata = "Rapor yetkiniz yok." });

        using var db = _vt.Baglanti();

        var departmanlar = db.Query(@"
SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList();

        var kendi = Benim.Departmanlar;

        return Ok(new
        {
            tumunuGorur = TumunuGorur,

            /* Yetkisi sınırlı kullanıcıya yalnızca kendi departmanları
               listeleniyor: seçemeyeceği bir departmanı süzgeçte görmek
               kafa karıştırıyordu. */
            departmanlar = TumunuGorur
                ? departmanlar
                : departmanlar.Where(d => kendi.Contains((int)d.id)).ToList(),

            subeler = SubeKilidi is not null
                ? new List<string> { SubeKilidi }
                : db.Query<string>(@"
SELECT sube_kodu FROM B360_ARIZA WHERE sube_kodu IS NOT NULL
UNION SELECT sube_kodu FROM B360_ENVANTER WHERE sube_kodu IS NOT NULL
ORDER BY 1").ToList(),

            raporlar = RolServisi.Raporlar.Where(r => Izin(r.Kod)).Select(r => new { kod = r.Kod, ad = r.Ad }),
            maliyet = MaliyetGorur,
            sube = SubeKilidi,
            kapsamAdi = SubeKilidi is not null ? SubeKilidi + " şubesi"
                : TumunuGorur ? "Tüm departmanlar" : string.Join(", ", Benim.DepartmanAdlari)
        });
    }

    /// <summary>
    /// Arıza kayıtları özeti.
    ///
    /// Durum kırılımı, departman ve şube dağılımı, günlük eğilim ve
    /// çözüm süreleri tek istekte dönüyor.
    /// </summary>
    [HttpGet("Ariza")]
    public IActionResult Ariza(
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] int? departmanId = null,
        [FromQuery] string sube = null)
    {
        if (!Izin("ariza")) return Forbid();

        using var db = _vt.Baglanti();

        var (baslangic, bitis) = Aralik(bas, bit);
        var kapsam = Kapsam(db, departmanId);

        if (kapsam is null)
            return StatusCode(403, new { hata = "Bu departmanı görme yetkiniz yok." });

        sube = SubeKilidi ?? Bos(sube);

        var satirlar = db.Query(@"
SELECT a.id, a.baslik, a.durum, a.oncelik, a.sube_kodu AS subeKodu,
       a.acan_adi AS acanAdi, a.atanan_adi AS atananAdi,
       a.olusturma, a.cozum_zamani AS cozumZamani, a.sla_bitis AS slaBitis,
       CASE WHEN @maliyet = 1 THEN a.maliyet END AS maliyet,
       d.ad AS departman, t.ad AS kategori,
       CASE WHEN a.atanan_kodu IS NULL OR a.atanan_kodu = N'' THEN 0 ELSE 1 END AS atandi,
       CASE WHEN a.sla_bitis IS NOT NULL AND a.cozum_zamani IS NOT NULL AND a.cozum_zamani <= a.sla_bitis
            THEN 1 ELSE 0 END AS slaIcinde,
       e.marka, e.model, e.tur AS cihazTuru,

       /* Çözüm süresi saat olarak: rapor ekranında ortalama ve en uzun
          süre buradan hesaplanıyor. */
       CASE WHEN a.cozum_zamani IS NOT NULL
            THEN DATEDIFF(minute, a.olusturma, a.cozum_zamani) / 60.0
       END AS cozumSaati
FROM B360_ARIZA a
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
    LEFT JOIN B360_ARIZA_TUR t ON t.id = a.tur_id
    LEFT JOIN B360_ENVANTER e ON e.id = a.envanter_id
WHERE a.olusturma >= @baslangic AND a.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
ORDER BY a.olusturma DESC",
            new
            {
                baslangic,
                bitis,
                kapsam = kapsam.Count > 0 ? kapsam : new List<int> { -1 },
                hepsi = HepsiMi(kapsam),
                sube,
                maliyet = MaliyetGorur ? 1 : 0
            }).ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            kayitlar = satirlar,
            ozet = ArizaOzeti(satirlar)
        });
    }

    /// <summary>Servis maliyeti özeti.</summary>
    [HttpGet("Maliyet")]
    public IActionResult Maliyet(
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] int? departmanId = null,
        [FromQuery] string sube = null)
    {
        if (!Izin("maliyet")) return Forbid();

        using var db = _vt.Baglanti();

        var (baslangic, bitis) = Aralik(bas, bit);
        var kapsam = Kapsam(db, departmanId);

        if (kapsam is null)
            return StatusCode(403, new { hata = "Bu departmanı görme yetkiniz yok." });

        sube = Bos(sube);

        var kayitlar = db.Query(@"
SELECT f.id, f.form_no AS formNo, f.olusturma, f.mudahale,
       f.parca_tutari AS parcaTutari, f.iscilik, f.toplam,
       f.teknisyen, f.servis_firma AS servisFirma,
       a.id AS arizaId, a.baslik, a.sube_kodu AS subeKodu,
       d.ad AS departman,
       e.marka, e.model, e.tur AS cihazTuru
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
    LEFT JOIN B360_ENVANTER e ON e.id = f.envanter_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
ORDER BY f.olusturma DESC",
            new
            {
                baslangic,
                bitis,
                kapsam = kapsam.Count > 0 ? kapsam : new List<int> { -1 },
                hepsi = HepsiMi(kapsam),
                sube
            }).ToList();

        var parcalar = db.Query(@"
SELECT p.ad, SUM(p.adet) AS adet, SUM(p.tutar) AS tutar
FROM B360_SERVIS_PARCA p
    JOIN B360_SERVIS_FORM f ON f.id = p.form_id
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
GROUP BY p.ad
ORDER BY tutar DESC",
            new
            {
                baslangic,
                bitis,
                kapsam = kapsam.Count > 0 ? kapsam : new List<int> { -1 },
                hepsi = HepsiMi(kapsam),
                sube
            }).ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            kayitlar,
            parcalar,

            ozet = new
            {
                adet = kayitlar.Count,
                toplam = Topla(kayitlar, "toplam"),
                parca = Topla(kayitlar, "parcaTutari"),
                iscilik = Topla(kayitlar, "iscilik")
            }
        });
    }

    /// <summary>
    /// Envanter raporu (13.10.2026): kapsamdaki cihazların durum, tür ve
    /// mağaza dağılımı; garantisi yakında bitenler, bakımı gecikenler,
    /// dönemde en çok arıza açılan cihazlar. Tutarlar yalnızca maliyet
    /// yetkisinde.
    /// </summary>
    [HttpGet("Envanter")]
    public IActionResult Envanter(
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] int? departmanId = null,
        [FromQuery] string sube = null)
    {
        if (!Izin("envanter")) return Forbid();

        using var db = _vt.Baglanti();

        var (baslangic, bitis) = Aralik(bas, bit);
        var kapsam = Kapsam(db, departmanId);

        if (kapsam is null)
            return StatusCode(403, new { hata = "Bu departmanı görme yetkiniz yok." });

        var p = new
        {
            baslangic,
            bitis,
            kapsam = kapsam.Count > 0 ? kapsam : new List<int> { -1 },
            hepsi = HepsiMi(kapsam),
            sube = SubeKilidi ?? Bos(sube),
            maliyet = MaliyetGorur ? 1 : 0
        };

        var cihazlar = db.Query(@"
SELECT e.id, e.tur, e.marka, e.model, e.sube_kodu AS subeKodu, e.durum,
       e.garanti_bitis AS garantiBitis, e.sonraki_bakim AS sonrakiBakim,
       d.ad AS departman,
       CASE WHEN @maliyet = 1 THEN e.alis_bedeli END AS alisBedeli,
       CASE WHEN @maliyet = 1 THEN (SELECT SUM(t.toplam) FROM B360_ENVANTER_TAMIR t
            WHERE t.envanter_id = e.id AND t.tarih >= @baslangic AND t.tarih < @bitis) END AS tamirToplam,
       (SELECT COUNT(*) FROM B360_ARIZA a
         WHERE a.envanter_id = e.id AND a.olusturma >= @baslangic AND a.olusturma < @bitis) AS arizaSayisi
FROM B360_ENVANTER e
    LEFT JOIN B360_DEPARTMAN d ON d.id = e.departman_id
WHERE e.durum <> N'pasif'
  AND (@hepsi = 1 OR e.departman_id IN @kapsam)
  AND (@sube IS NULL OR e.sube_kodu = @sube)
ORDER BY e.tur, e.marka", p).ToList();

        var bugun = DateTime.Today;

        static bool Tarihte(object t, Func<DateTime, bool> f) => t is DateTime d && f(d.Date);

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            cihazlar,
            ozet = new
            {
                toplam = cihazlar.Count,
                aktif = cihazlar.Count(x => (string)x.durum == "aktif"),
                bakimda = cihazlar.Count(x => (string)x.durum == "bakimda"),
                arizali = cihazlar.Count(x => (string)x.durum == "arizali"),
                garantiBitiyor = cihazlar.Count(x => Tarihte((object)x.garantiBitis, d => d >= bugun && d <= bugun.AddDays(90))),
                bakimGecti = cihazlar.Count(x => Tarihte((object)x.sonrakiBakim, d => d < bugun)),
                arizaAcilan = cihazlar.Count(x => (int)x.arizaSayisi > 0),
                alisToplam = MaliyetGorur ? Topla(cihazlar, "alisBedeli") : (decimal?)null,
                tamirToplam = MaliyetGorur ? Topla(cihazlar, "tamirToplam") : (decimal?)null,
            },
            maliyet = MaliyetGorur
        });
    }

    private static string Bos(string d) => string.IsNullOrWhiteSpace(d) ? null : d.Trim();

    /// <summary>Kapsam listesi boşsa ve tümünü görüyorsa (ya da şube kilidi) 1</summary>
    private int HepsiMi(List<int> kapsam) =>
        (kapsam.Count == 0 && TumunuGorur) || SubeKilidi is not null ? 1 : 0;

    /// <summary>Rakip fiyat özeti.</summary>
    [HttpGet("RakipFiyat")]
    public IActionResult RakipFiyat(
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] string sube = null)
    {
        if (!_yetki.SayfaAcik(Kullanici, Rol, "rakipfiyat")) return Forbid();

        using var db = _vt.Baglanti();

        var (baslangic, bitis) = Aralik(bas, bit);
        sube = SubeKilidi ?? Bos(sube);

        var kayitlar = db.Query(@"
SELECT r.id, r.urun_adi AS urunAdi, r.barkod, r.sube_kodu AS subeKodu,
       r.bizim_fiyat AS bizimFiyat, r.rakip_fiyat AS rakipFiyat,
       r.fark, r.fark_yuzde AS farkYuzde, r.olusturma, r.personel_adi AS kaydedenAdi,
       fi.ad AS rakip
FROM B360_RAKIP_FIYAT r
    LEFT JOIN B360_RAKIP_FIRMA fi ON fi.id = r.firma_id
WHERE r.olusturma >= @baslangic AND r.olusturma < @bitis
  AND (@sube IS NULL OR r.sube_kodu = @sube)
ORDER BY r.olusturma DESC",
            new { baslangic, bitis, sube }).ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            kayitlar,

            ozet = new
            {
                adet = kayitlar.Count,

                /* Bizim fiyatımızın yüksek olduğu kayıtlar: hal ekibinin
                   ilk baktığı sayı. */
                pahali = kayitlar.Count(x =>
                    x.bizimFiyat is not null && x.rakipFiyat is not null
                    && (decimal)x.bizimFiyat > (decimal)x.rakipFiyat),

                ucuz = kayitlar.Count(x =>
                    x.bizimFiyat is not null && x.rakipFiyat is not null
                    && (decimal)x.bizimFiyat < (decimal)x.rakipFiyat)
            }
        });
    }

    /// <summary>Künye analizi özeti.</summary>
    [HttpGet("Kunye")]
    public IActionResult Kunye(
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] string sube = null)
    {
        if (!_yetki.SayfaAcik(Kullanici, Rol, "kunye")) return Forbid();

        using var db = _vt.Baglanti();

        var (baslangic, bitis) = Aralik(bas, bit);
        sube = Bos(sube);

        try
        {
            /* Künye kayıtları Kariyer servisinin tablosunda; iki servis aynı
               veritabanını paylaştığı için doğrudan okunuyor. */
            var kayitlar = db.Query(@"
SELECT k.id, k.kunye_no AS kunyeNo, k.urun_adi AS urunAdi, k.uretici,
       k.rakip_isletme AS rakipIsletme, k.rakip_fiyat AS rakipFiyat,
       k.bizim_fiyat AS bizimFiyat, k.fark, k.fark_yuzde AS farkYuzde,
       k.sube_adi AS subeKodu, k.personel_adi AS sorgulayan, k.olusturma
FROM KRY_KUNYE_ANALIZ k
WHERE k.olusturma >= @baslangic AND k.olusturma < @bitis
  AND (@sube IS NULL OR k.sube_adi = @sube)
ORDER BY k.olusturma DESC",
                new { baslangic, bitis, sube }).ToList();

            return Ok(new
            {
                baslangic,
                bitis = bitis.AddDays(-1),
                kayitlar,
                ozet = new
                {
                    adet = kayitlar.Count,
                    pahali = kayitlar.Count(x => x.fark is not null && (decimal)x.fark > 0),
                    ucuz = kayitlar.Count(x => x.fark is not null && (decimal)x.fark < 0)
                }
            });
        }
        catch (Exception hata)
        {
            /* Künye kayıtları dış serviste tutuluyor olabilir; rapor
               ekranı bu yüzden hiç açılmamalı değil. */
            _kayit.LogWarning(hata, "Künye raporu okunamadı");

            return Ok(new
            {
                baslangic,
                bitis = bitis.AddDays(-1),
                kayitlar = new List<object>(),
                ozet = new { adet = 0 },
                uyari = "Künye kayıtlarına ulaşılamadı."
            });
        }
    }

    /* ====================================================================== */

    /// <summary>Varsayılan aralık son otuz gün; bitiş günü dahil.</summary>
    private static (DateTime, DateTime) Aralik(DateTime? bas, DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-29);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1);

        return (baslangic, bitis);
    }

    /// <summary>
    /// Sorgulanacak departman kimlikleri.
    ///
    /// Boş liste ve <c>TumunuGorur</c> birlikteyse bütün departmanlar
    /// demek. Yetkisi olmayan bir departman istenirse null dönüyor ve
    /// çağıran taraf reddediyor.
    /// </summary>
    private List<int> Kapsam(System.Data.IDbConnection db, int? istenen)
    {
        if (TumunuGorur)
            return istenen is int d ? new List<int> { d } : new List<int>();

        var kendi = Benim.Departmanlar;

        if (istenen is int hedef)
            return kendi.Contains(hedef) ? new List<int> { hedef } : null;

        /* Temsilci değilse ve tümünü görme yetkisi yoksa hiçbir şey
           göremiyor; boş kapsam sorguyu sonuçsuz bırakıyor. */
        return kendi.Count > 0 ? kendi : new List<int> { -1 };
    }

    private static decimal Topla(List<dynamic> kayitlar, string alan)
    {
        decimal toplam = 0;

        foreach (var k in kayitlar)
        {
            var deger = ((IDictionary<string, object>)k)[alan];

            if (deger is decimal d) toplam += d;
            else if (deger is double f) toplam += (decimal)f;
        }

        return toplam;
    }

    private static object ArizaOzeti(List<dynamic> kayitlar)
    {
        int Say(params string[] durumlar) =>
            kayitlar.Count(x => durumlar.Contains((string)x.durum ?? ""));

        var cozumler = kayitlar
            .Where(x => x.cozumSaati is not null)
            .Select(x => (double)x.cozumSaati)
            .ToList();

        return new
        {
            toplam = kayitlar.Count,
            acik = Say("acik", "yeni"),
            devam = Say("devam"),
            islemde = Say("devam", "islemde", "atandi"),
            beklemede = Say("beklemede"),
            cozuldu = Say("cozuldu"),
            kapandi = Say("kapandi"),
            iptal = Say("iptal"),

            acil = kayitlar.Count(x => (string)x.oncelik == "acil"),
            atanmamis = kayitlar.Count(x => (int)x.atandi == 0 && !new[] { "cozuldu", "kapandi" }.Contains((string)x.durum ?? "")),
            slaIcinde = kayitlar.Count(x => (int)x.slaIcinde == 1),

            geciken = kayitlar.Count(x =>
                x.slaBitis is not null
                && (DateTime)x.slaBitis < DateTime.Now
                && !new[] { "cozuldu", "kapandi", "iptal" }.Contains((string)x.durum ?? "")),

            ortalamaSaat = cozumler.Count > 0
                ? Math.Round(cozumler.Average(), 1) : (double?)null,

            enUzunSaat = cozumler.Count > 0
                ? Math.Round(cozumler.Max(), 1) : (double?)null,

            maliyet = Topla(kayitlar, "maliyet")
        };
    }
}

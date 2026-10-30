using System.Globalization;
using System.IO.Compression;
using System.Security.Claims;
using System.Xml.Linq;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// SKT kontrol (23.10.2026).
///
/// <para>
/// Her ay her şubeye bir kategori atanıyor (plan); şube personeli Biçen360
/// uygulamasında o kategorinin ürünlerini okutup raftaki son kullanma
/// tarihlerini (parti parti, adetiyle) ya da "ürün yok" giriyor. Bir sonraki
/// ay aynı kategori başka şubeye geçiyor. Eskiden Excel'e elle yazılıp
/// gönderiliyordu.
/// </para>
///
/// <para>
/// Veri: B360_SKT_PLAN (ay · şube · kategori), B360_SKT_PLAN_URUN (planın
/// ürün listesi, Excel'den ya da Mikro'dan), B360_SKT_KONTROL (okutulan
/// ürün; plan ya da serbest), B360_SKT_PARTI (tarih + adet + aksiyon).
/// Portal "SKT Takip" sayfası şube, kategori, ürün ve tarih kırılımında
/// analiz ediyor; veri başka raporlarda da kullanılacak.
/// </para>
///
/// <para>
/// Yetki: mobil modül "skt" (yeni modül, tanımsızken kapalı), portal
/// sayfası "skt".
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SktController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<SktController> _kayit;

    public SktController(VeritabaniServisi vt, YetkiServisi yetki, PersonelServisi personel,
                         BildirimServisi bildirim, ILogger<SktController> kayit)
    {
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _bildirim = bildirim;
        _kayit = kayit;
        Kur(vt, kayit);
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    /// <summary>Kalan gün eşikleri: 0–7 kritik, 8–30 yaklaşıyor</summary>
    public const int Kritik = 7, Yakin = 30;

    /* ==================================================================== */
    /* Tablolar                                                             */
    /* ==================================================================== */

    private static bool _kuruldu;
    private static readonly object _kilit = new();

    private static void Kur(VeritabaniServisi vt, ILogger kayit)
    {
        if (_kuruldu) return;
        lock (_kilit)
        {
            if (_kuruldu) return;
            try
            {
                using var db = vt.Baglanti();
                db.Execute(@"
IF OBJECT_ID('B360_SKT_PLAN') IS NULL
CREATE TABLE B360_SKT_PLAN (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    ay          CHAR(7)        NOT NULL,
    sube        NVARCHAR(100)  NOT NULL,
    kategori    NVARCHAR(200)  NOT NULL,
    aciklama    NVARCHAR(500)  NULL,
    son_gun     DATE           NULL,
    sira        INT            NOT NULL DEFAULT 0,
    olusturan   NVARCHAR(100)  NULL,
    olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    silindi     BIT            NOT NULL DEFAULT 0
);
IF OBJECT_ID('B360_SKT_PLAN_URUN') IS NULL
CREATE TABLE B360_SKT_PLAN_URUN (
    plan_id   INT            NOT NULL,
    stok_kod  NVARCHAR(30)   NOT NULL,
    barkod    NVARCHAR(50)   NULL,
    urun_ad   NVARCHAR(200)  NULL,
    ana_grup  NVARCHAR(100)  NULL,
    kategori  NVARCHAR(100)  NULL,
    CONSTRAINT PK_B360_SKT_PLAN_URUN PRIMARY KEY (plan_id, stok_kod)
);
IF OBJECT_ID('B360_SKT_KONTROL') IS NULL
BEGIN
    CREATE TABLE B360_SKT_KONTROL (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        plan_id        INT            NULL,
        sube           NVARCHAR(100)  NOT NULL,
        stok_kod       NVARCHAR(30)   NOT NULL,
        barkod         NVARCHAR(50)   NULL,
        urun_ad        NVARCHAR(200)  NULL,
        ana_grup       NVARCHAR(100)  NULL,
        kategori       NVARCHAR(100)  NULL,
        tur            VARCHAR(5)     NOT NULL,
        notu           NVARCHAR(500)  NULL,
        personel_kodu  NVARCHAR(30)   NULL,
        personel_ad    NVARCHAR(150)  NULL,
        olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme     DATETIME2      NULL,
        silindi        BIT            NOT NULL DEFAULT 0
    );
    CREATE INDEX IX_B360_SKT_KONTROL_tarih ON B360_SKT_KONTROL(olusturma, sube);
    CREATE INDEX IX_B360_SKT_KONTROL_plan ON B360_SKT_KONTROL(plan_id, stok_kod);
END
IF OBJECT_ID('B360_SKT_PARTI') IS NULL
BEGIN
    CREATE TABLE B360_SKT_PARTI (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        kontrol_id     INT            NOT NULL,
        skt            DATE           NOT NULL,
        adet           INT            NOT NULL,
        aksiyon        NVARCHAR(40)   NULL,
        aksiyon_yapan  NVARCHAR(100)  NULL,
        aksiyon_tarih  DATETIME2      NULL
    );
    CREATE INDEX IX_B360_SKT_PARTI_kontrol ON B360_SKT_PARTI(kontrol_id);
END");
                _kuruldu = true;
            }
            catch (Exception h)
            {
                kayit.LogError(h, "SKT tabloları oluşturulamadı");
            }
        }
    }

    /* ==================================================================== */
    /* Kimlik                                                               */
    /* ==================================================================== */

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";
    private bool Mobil => Kullanici.StartsWith("personel:", StringComparison.OrdinalIgnoreCase);

    private string Sicil
    {
        get
        {
            if (!Mobil) return null;
            var govde = Kullanici["personel:".Length..];
            var i = govde.IndexOf('|');
            return (i < 0 ? govde : govde[..i]).Trim();
        }
    }

    private PersonelServisi.Bilgi Kisi() => Mobil ? _personel.Getir(Sicil) : null;

    /* ------------------------------------------------ şube (23.10.2026) */

    /// <summary>
    /// Fiyat Kontrol'deki gibi: iş grubu bir şubeyle eşleşen personel
    /// yalnız kendi şubesinde çalışır (kilitli). Genel merkez, depo,
    /// bölge müdürü gibi eşleşmeyenler şube seçer; seçim Fiyat Kontrol ile
    /// ortak (B360_SUBE_SECIM).
    /// </summary>
    private (string Sube, bool Kilitli) SktSubesi(PersonelServisi.Bilgi k)
    {
        if (_subeOkundu) return _sktSube;
        _subeOkundu = true;
        var kendi = KendiSubeAdi(k?.Sube);
        if (kendi is not null) return _sktSube = (k.Sube, true);

        try
        {
            using var db = _vt.Baglanti();
            var secim = db.QueryFirstOrDefault(@"
SELECT d.sube_adi AS ad, d.sube_kodu AS kod FROM B360_SUBE_SECIM s
JOIN B360_SUBE_DEPO d ON d.sube_kodu = s.sube_kodu AND d.aktif = 1
WHERE s.kullanici = @Kullanici", new { Kullanici });
            return _sktSube = ((string)secim?.ad ?? (string)secim?.kod, false);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "SKT: şube seçimi okunamadı");
            return _sktSube = (null, false);
        }
    }

    private bool _subeOkundu;
    private (string, bool) _sktSube;

    /// <summary>İş grubu bir şubeyle eşleşiyorsa şubenin adı; merkez vb. ise null.</summary>
    private string KendiSubeAdi(string birim)
    {
        var a = YetkiServisi.Anahtar(birim);
        if (a.Length < 3 || a.Contains("merkez") || a.Contains("belirtilmemis") || a.Contains("depo")) return null;
        try
        {
            using var db = _vt.Baglanti();
            var subeler = db.Query("SELECT sube_kodu AS kod, sube_adi AS ad FROM B360_SUBE_DEPO WHERE aktif = 1").ToList();
            var tam = subeler.FirstOrDefault(x => YetkiServisi.Anahtar((string)x.kod) == a || YetkiServisi.Anahtar((string)x.ad) == a
                                                  || SubeAnahtar((string)x.ad) == SubeAnahtar(birim));
            if (tam is not null) return (string)tam.ad;
            var icerik = subeler.Where(x => new[] { YetkiServisi.Anahtar((string)x.kod), YetkiServisi.Anahtar((string)x.ad) }
                .Any(k => k.Length >= 4 && (a.Contains(k) || k.Contains(a)))).ToList();
            if (icerik.Count == 1) return (string)icerik[0].ad;

            /* Şube tanımında yoksa ama SKT planlarında şube olarak geçiyorsa yine şubededir */
            var an = SubeAnahtar(birim);
            if (db.Query<string>("SELECT DISTINCT sube FROM B360_SKT_PLAN WHERE silindi = 0").Any(x => SubeAnahtar(x) == an))
                return birim;
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "SKT: personel şubesi eşlenemedi");
        }
        return null;
    }

    /// <summary>Seçilebilecek şubeler (kilitli personelde yalnız kendisi).</summary>
    [HttpGet("Mobil/Subeler")]
    public IActionResult MobilSubeler()
    {
        var k = Kisi();
        if (k is null) return Unauthorized();
        if (!MobilYetkili(k)) return StatusCode(403, new { hata = "SKT Kontrol modülü sizin için açık değil." });
        var (sube, kilitli) = SktSubesi(k);
        if (kilitli) return Ok(new { secilen = sube, kilitli = true, subeler = new[] { new { kod = sube, ad = sube } } });

        using var db = _vt.Baglanti();
        var subeler = db.Query("SELECT sube_kodu AS kod, sube_adi AS ad FROM B360_SUBE_DEPO WHERE aktif = 1 ORDER BY sube_adi")
            .Select(x => new { kod = (string)x.kod, ad = (string)x.ad ?? (string)x.kod }).ToList();
        return Ok(new { secilen = sube, kilitli = false, subeler });
    }

    public sealed class SubeSecGirdi
    {
        public string SubeKodu { get; set; }
    }

    [HttpPost("Mobil/Sube")]
    public IActionResult MobilSubeSec([FromBody] SubeSecGirdi g)
    {
        var k = Kisi();
        if (k is null) return Unauthorized();
        if (!MobilYetkili(k)) return StatusCode(403, new { hata = "SKT Kontrol modülü sizin için açık değil." });
        var (sube, kilitli) = SktSubesi(k);
        if (kilitli) return StatusCode(409, new { hata = $"Yalnızca kendi şubeniz ({sube}) için SKT kontrolü yapabilirsiniz." });
        var kod = (g?.SubeKodu ?? "").Trim();
        using var db = _vt.Baglanti();
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SUBE_DEPO WHERE sube_kodu = @kod AND aktif = 1", new { kod }) == 0)
            return BadRequest(new { hata = "Şube bulunamadı." });
        db.Execute(@"
MERGE B360_SUBE_SECIM AS h
USING (SELECT @Kullanici AS kullanici) AS k ON h.kullanici = k.kullanici
WHEN MATCHED THEN UPDATE SET sube_kodu = @kod, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (kullanici, sube_kodu) VALUES (@Kullanici, @kod);", new { Kullanici, kod });
        return Ok(new { tamam = true });
    }

    private bool MobilYetkili(PersonelServisi.Bilgi k) =>
        k is not null && _yetki.Modulleri(Sicil, k.Pozisyon ?? "").Contains("skt");

    private bool PanelYetkili() => !Mobil && _yetki.SayfaAcik(Kullanici, Rol, "skt");

    /// <summary>Şube adı karşılaştırması: "BEYLİKDÜZÜ-2" = "Beylikdüzü 2"</summary>
    public static string SubeAnahtar(string s) =>
        new string((s ?? "")
            .Replace('İ', 'i').Replace('I', 'i')
            .ToLower(Tr)
            .Replace('ı', 'i').Replace('ş', 's').Replace('ğ', 'g')
            .Replace('ü', 'u').Replace('ö', 'o').Replace('ç', 'c')
            .Where(char.IsLetterOrDigit).ToArray())
            .Replace("subesi", "").Replace("sube", "");

    /// <summary>Excel başlığı karşılaştırması (şube kelimesi atılmadan)</summary>
    private static string BaslikAnahtar(string s) =>
        new string((s ?? "")
            .Replace('İ', 'i').Replace('I', 'i')
            .ToLower(Tr)
            .Replace('ı', 'i').Replace('ş', 's').Replace('ğ', 'g')
            .Replace('ü', 'u').Replace('ö', 'o').Replace('ç', 'c')
            .Where(char.IsLetterOrDigit).ToArray());

    private static string Ay(DateTime t) => t.ToString("yyyy-MM");

    public static string Durum(string tur, int? kalan) =>
        tur == "yok" ? "yok" : kalan is null ? "bek" : kalan < 0 ? "gec" : kalan <= Kritik ? "kri" : kalan <= Yakin ? "yak" : "uyg";

    private static readonly string[] DurumSira = { "gec", "kri", "yak", "uyg", "yok" };

    /* ==================================================================== */
    /* Mikro: ürün                                                           */
    /* ==================================================================== */

    public sealed record Urun(string StokKod, string Barkod, string Ad, string AnaGrup, string Kategori);

    private Urun UrunBul(string deger)
    {
        foreach (var aday in FiyatKontrolController.KarekodAdaylari(deger))
        {
            var u = UrunBarkodla(aday);
            if (u is not null) return u;
        }
        return null;
    }

    private Urun UrunBarkodla(string barkod)
    {
        try
        {
            using var db = _vt.MikroBaglantisi();
            dynamic r;
            try
            {
                r = db.QueryFirstOrDefault(@"
SELECT TOP 1 LTRIM(RTRIM(S.sto_kod)) AS kod, S.sto_isim AS ad,
       ISNULL(G.san_isim, '') AS grup, ISNULL(K.ktg_isim, '') AS kat
FROM BARKOD_TANIMLARI B WITH (NOLOCK)
    JOIN STOKLAR S WITH (NOLOCK) ON S.sto_kod = B.bar_stokkodu
    LEFT JOIN STOK_ANA_GRUPLARI G WITH (NOLOCK) ON G.san_kod = S.sto_anagrup_kod
    LEFT JOIN STOK_KATEGORILERI K WITH (NOLOCK) ON K.ktg_kod = S.sto_kategori_kodu
WHERE LTRIM(RTRIM(B.bar_kodu)) = @barkod", new { barkod });
            }
            catch (Microsoft.Data.SqlClient.SqlException)
            {
                /* Grup/kategori tabloları yoksa yalnızca ürün */
                r = db.QueryFirstOrDefault(@"
SELECT TOP 1 LTRIM(RTRIM(S.sto_kod)) AS kod, S.sto_isim AS ad, '' AS grup, '' AS kat
FROM BARKOD_TANIMLARI B WITH (NOLOCK) JOIN STOKLAR S WITH (NOLOCK) ON S.sto_kod = B.bar_stokkodu
WHERE LTRIM(RTRIM(B.bar_kodu)) = @barkod", new { barkod });
            }

            return r is null ? null : new Urun((string)r.kod, barkod, (string)r.ad, (string)r.grup, (string)r.kat);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "SKT: barkod sorgulanamadı {Barkod}", barkod);
            return null;
        }
    }

    /* ==================================================================== */
    /* Mobil                                                                */
    /* ==================================================================== */

    /// <summary>Bu ayın görevi: şubenin planları ve ürünlerin durumu.</summary>
    [HttpGet("Mobil/Gorev")]
    public IActionResult MobilGorev()
    {
        var k = Kisi();
        if (k is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });
        if (!MobilYetkili(k)) return StatusCode(403, new { hata = "SKT Kontrol modülü sizin için açık değil." });

        var (subeAdi, kilitli) = SktSubesi(k);
        if (subeAdi is null)
            return Ok(new { sube = (string)null, kilitli = false, secimGerekli = true, ay = Ay(DateTime.Today),
                esik = new { kritik = Kritik, yakin = Yakin }, planlar = Array.Empty<object>(), sorunlar = Array.Empty<object>() });

        using var db = _vt.Baglanti();
        var ay = Ay(DateTime.Today);
        var anahtar = SubeAnahtar(subeAdi);

        var planlar = db.Query("SELECT * FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay", new { ay })
            .Where(p => SubeAnahtar((string)p.sube) == anahtar)
            .ToList();

        var bugun = DateTime.Today;
        var sonuc = planlar.Select(p =>
        {
            int id = p.id;
            var urunler = db.Query("SELECT * FROM B360_SKT_PLAN_URUN WHERE plan_id = @id ORDER BY urun_ad", new { id }).ToList();
            var kontroller = db.Query(@"
SELECT k.id, k.stok_kod, k.tur, k.notu, k.personel_ad, ISNULL(k.guncelleme, k.olusturma) AS zaman
FROM B360_SKT_KONTROL k WHERE k.plan_id = @id AND k.silindi = 0", new { id })
                .GroupBy(x => ((string)x.stok_kod).Trim())
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => (DateTime)x.zaman).First());
            var partiler = db.Query(@"
SELECT p.kontrol_id, p.skt, p.adet FROM B360_SKT_PARTI p
JOIN B360_SKT_KONTROL k ON k.id = p.kontrol_id WHERE k.plan_id = @id AND k.silindi = 0", new { id })
                .GroupBy(x => (int)x.kontrol_id)
                .ToDictionary(g => g.Key, g => g.Select(x => new { skt = (DateTime)x.skt, adet = (int)x.adet }).OrderBy(x => x.skt).ToList());

            var liste = urunler.Select(u =>
            {
                var kod = ((string)u.stok_kod).Trim();
                kontroller.TryGetValue(kod, out var kt);
                var pl = kt is null ? null : partiler.GetValueOrDefault((int)kt.id);
                var enKotu = kt is null ? "bek"
                    : (string)kt.tur == "yok" ? "yok"
                    : (pl ?? new()).Select(x => Durum("skt", (int)(x.skt - bugun).TotalDays))
                        .OrderBy(x => Array.IndexOf(DurumSira, x)).FirstOrDefault() ?? "uyg";
                return new
                {
                    stokKod = kod,
                    barkod = (string)u.barkod,
                    ad = (string)u.urun_ad,
                    anaGrup = (string)u.ana_grup,
                    kategori = (string)u.kategori,
                    durum = enKotu,
                    tur = (string)kt?.tur,
                    zaman = (DateTime?)kt?.zaman,
                    giren = (string)kt?.personel_ad,
                    not = (string)kt?.notu,
                    partiler = pl,
                };
            }).ToList();

            DateTime? sonGun = p.son_gun;
            return new
            {
                id,
                ay = (string)p.ay,
                kategori = (string)p.kategori,
                aciklama = (string)p.aciklama,
                sonGun = sonGun ?? new DateTime(bugun.Year, bugun.Month, 1).AddMonths(1).AddDays(-1),
                toplam = liste.Count,
                yapilan = liste.Count(x => x.durum != "bek"),
                katilan = kontroller.Values.Select(x => (string)x.personel_ad).Distinct().Count(),
                urunler = liste,
            };
        }).ToList();

        /* Bu ay şubede (plan + serbest) bulunan sorunlar: geçmiş ve 30 gün içinde */
        var ayBasi = new DateTime(bugun.Year, bugun.Month, 1);
        var sorunlar = db.Query(@"
SELECT k.stok_kod, k.urun_ad, k.barkod, k.plan_id, k.sube, p.skt, p.adet
FROM B360_SKT_KONTROL k JOIN B360_SKT_PARTI p ON p.kontrol_id = k.id
WHERE k.silindi = 0 AND k.olusturma >= @ayBasi AND p.skt <= @sinir AND p.aksiyon IS NULL
ORDER BY p.skt", new { ayBasi, sinir = bugun.AddDays(Yakin) })
            .Where(x => SubeAnahtar((string)x.sube) == anahtar)
            .Take(30)
            .Select(x => new
            {
                stokKod = ((string)x.stok_kod).Trim(),
                ad = (string)x.urun_ad,
                barkod = (string)x.barkod,
                planId = (int?)x.plan_id,
                skt = (DateTime)x.skt,
                adet = (int)x.adet,
                kalan = (int)((DateTime)x.skt - bugun).TotalDays,
            })
            .ToList();

        return Ok(new
        {
            sube = subeAdi,
            kilitli,
            secimGerekli = false,
            ay = Ay(bugun),
            esik = new { kritik = Kritik, yakin = Yakin },
            planlar = sonuc,
            sorunlar,
        });
    }

    /// <summary>
    /// Okutulan barkod: ürün, bu ayın planında mı, varsa son kaydı.
    /// Planda değilse uygulama "bu ürün bu ayın kategorisinde değil" der.
    /// </summary>
    [HttpGet("Mobil/Urun")]
    public IActionResult MobilUrun([FromQuery] string barkod, [FromQuery] int? planId)
    {
        var k = Kisi();
        if (k is null) return Unauthorized();
        if (!MobilYetkili(k)) return StatusCode(403, new { hata = "SKT Kontrol modülü sizin için açık değil." });
        if (string.IsNullOrWhiteSpace(barkod)) return BadRequest(new { hata = "Barkod okunamadı." });

        using var db = _vt.Baglanti();

        /* Önce planın listesinde ara: Mikro'ya gitmeden, plan ürünü kesin */
        dynamic plan = null, pu = null;
        if (planId is int pid)
        {
            plan = db.QueryFirstOrDefault("SELECT * FROM B360_SKT_PLAN WHERE id = @pid AND silindi = 0", new { pid });
            if (plan is not null)
                foreach (var aday in FiyatKontrolController.KarekodAdaylari(barkod))
                {
                    pu = db.QueryFirstOrDefault("SELECT * FROM B360_SKT_PLAN_URUN WHERE plan_id = @pid AND LTRIM(RTRIM(barkod)) = @aday", new { pid, aday });
                    if (pu is not null) break;
                }
        }

        Urun urun = pu is not null
            ? new Urun(((string)pu.stok_kod).Trim(), (string)pu.barkod, (string)pu.urun_ad, (string)pu.ana_grup, (string)pu.kategori)
            : UrunBul(barkod);

        if (urun is null)
            return Ok(new { bulundu = false, barkod, hata = "Bu barkod sistemde bulunamadı." });

        var planda = pu is not null || (plan is not null && db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_SKT_PLAN_URUN WHERE plan_id = @pid AND stok_kod = @kod", new { pid = (int)plan.id, kod = urun.StokKod }) > 0);

        object son = null;
        if (planda && plan is not null)
        {
            var kt = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, tur, notu FROM B360_SKT_KONTROL
WHERE plan_id = @pid AND stok_kod = @kod AND silindi = 0 ORDER BY ISNULL(guncelleme, olusturma) DESC",
                new { pid = (int)plan.id, kod = urun.StokKod });
            if (kt is not null)
                son = new
                {
                    tur = (string)kt.tur,
                    not = (string)kt.notu,
                    partiler = db.Query("SELECT skt, adet FROM B360_SKT_PARTI WHERE kontrol_id = @id ORDER BY skt", new { id = (int)kt.id })
                        .Select(x => new { skt = (DateTime)x.skt, adet = (int)x.adet }),
                };
        }

        return Ok(new
        {
            bulundu = true,
            urun = new { stokKod = urun.StokKod, barkod = urun.Barkod, ad = urun.Ad, anaGrup = urun.AnaGrup, kategori = urun.Kategori },
            planda,
            planKategori = (string)plan?.kategori,
            son,
        });
    }

    public class KaydetGirdi
    {
        public int? PlanId { get; set; }
        public string StokKod { get; set; }
        public string Barkod { get; set; }
        public string UrunAd { get; set; }
        public string AnaGrup { get; set; }
        public string Kategori { get; set; }
        /// <summary>skt | yok</summary>
        public string Tur { get; set; }
        public List<PartiGirdi> Partiler { get; set; } = new();
        public string Not { get; set; }
    }

    public class PartiGirdi
    {
        public DateTime Skt { get; set; }
        public int Adet { get; set; }
    }

    /// <summary>
    /// Kontrolü kaydeder. Plan ürününde aynı ayın önceki kaydının yerine
    /// geçer (düzeltme); serbest kontrol her seferinde yeni kayıt.
    /// </summary>
    [HttpPost("Mobil/Kaydet")]
    public async Task<IActionResult> MobilKaydet([FromBody] KaydetGirdi g)
    {
        var k = Kisi();
        if (k is null) return Unauthorized();
        if (!MobilYetkili(k)) return StatusCode(403, new { hata = "SKT Kontrol modülü sizin için açık değil." });
        if (g is null || string.IsNullOrWhiteSpace(g.StokKod)) return BadRequest(new { hata = "Ürün seçilmedi." });

        var tur = g.Tur == "yok" ? "yok" : "skt";
        var partiler = (g.Partiler ?? new()).Where(x => x.Adet > 0 && x.Skt.Year > 2000).ToList();
        if (tur == "skt" && partiler.Count == 0) return BadRequest(new { hata = "En az bir son kullanma tarihi ve adet giriniz." });
        if (partiler.Any(x => x.Skt.Date > DateTime.Today.AddYears(10)))
            return BadRequest(new { hata = "Son kullanma tarihi hatalı görünüyor." });

        var (subeAdi, _) = SktSubesi(k);
        if (subeAdi is null) return BadRequest(new { hata = "Önce şube seçiniz." });

        using var db = _vt.Baglanti();
        int? planId = null;

        if (g.PlanId is int pid)
        {
            var plan = db.QueryFirstOrDefault("SELECT id, sube FROM B360_SKT_PLAN WHERE id = @pid AND silindi = 0", new { pid });
            if (plan is not null && SubeAnahtar((string)plan.sube) == SubeAnahtar(subeAdi)
                && db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SKT_PLAN_URUN WHERE plan_id = @pid AND stok_kod = @kod",
                    new { pid, kod = g.StokKod.Trim() }) > 0)
                planId = pid;
        }

        var notu = string.IsNullOrWhiteSpace(g.Not) ? null : g.Not.Trim()[..Math.Min(500, g.Not.Trim().Length)];
        int kontrolId;

        using (var tx = db.BeginTransactionAc())
        {
            int? mevcut = planId is null ? null : db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM B360_SKT_KONTROL WHERE plan_id = @planId AND stok_kod = @kod AND silindi = 0
ORDER BY ISNULL(guncelleme, olusturma) DESC", new { planId, kod = g.StokKod.Trim() }, tx);

            if (mevcut is int m)
            {
                kontrolId = m;
                db.Execute(@"
UPDATE B360_SKT_KONTROL SET tur = @tur, notu = @notu, personel_kodu = @pk, personel_ad = @pa, guncelleme = SYSDATETIME() WHERE id = @m;
DELETE FROM B360_SKT_PARTI WHERE kontrol_id = @m;",
                    new { tur, notu, pk = Sicil, pa = k.AdSoyad, m }, tx);
            }
            else
            {
                kontrolId = db.ExecuteScalar<int>(@"
INSERT INTO B360_SKT_KONTROL (plan_id, sube, stok_kod, barkod, urun_ad, ana_grup, kategori, tur, notu, personel_kodu, personel_ad)
OUTPUT INSERTED.id
VALUES (@planId, @sube, @kod, @barkod, @ad, @grup, @kat, @tur, @notu, @pk, @pa)",
                    new
                    {
                        planId, sube = subeAdi, kod = g.StokKod.Trim(), barkod = g.Barkod, ad = g.UrunAd,
                        grup = g.AnaGrup, kat = g.Kategori, tur, notu, pk = Sicil, pa = k.AdSoyad,
                    }, tx);
            }

            if (tur == "skt")
                db.Execute("INSERT INTO B360_SKT_PARTI (kontrol_id, skt, adet) VALUES (@kontrolId, @skt, @adet)",
                    partiler.Select(x => new { kontrolId, skt = x.Skt.Date, adet = Math.Min(x.Adet, 99999) }), tx);

            tx.Commit();
        }

        var bugun = DateTime.Today;
        var durum = tur == "yok" ? "yok"
            : partiler.Select(x => Durum("skt", (int)(x.Skt.Date - bugun).TotalDays))
                .OrderBy(x => Array.IndexOf(DurumSira, x)).First();

        /* Geçmiş ya da 0–7 gün: şube müdürüne haber (kendisi değilse) */
        if (durum is "gec" or "kri")
        {
            try
            {
                var anahtar = SubeAnahtar(subeAdi);
                var mudurler = _personel.Liste()
                    .Where(p => SubeAnahtar(p.Sube) == anahtar && p.Sicil != Sicil)
                    .Where(p =>
                    {
                        var a = YetkiServisi.Anahtar(p.Pozisyon);
                        return a.Contains("mudur") && !a.Contains("yardimci");
                    })
                    .Select(p => p.Sicil)
                    .ToList();

                if (mudurler.Count > 0)
                {
                    var en = partiler.OrderBy(x => x.Skt).First();
                    var kalan = (int)(en.Skt.Date - bugun).TotalDays;
                    await _bildirim.CokluGonder(mudurler,
                        durum == "gec" ? "SKT geçmiş ürün" : "SKT'si yaklaşan ürün",
                        $"{g.UrunAd}: {en.Skt:dd.MM.yyyy} ({(kalan < 0 ? $"{-kalan} gün geçti" : $"{kalan} gün kaldı")}), {partiler.Sum(x => x.Adet)} adet. Giren: {k.AdSoyad}",
                        "skt");
                }
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "SKT bildirimi gönderilemedi");
            }
        }

        return Ok(new { id = kontrolId, durum, planda = planId is not null });
    }

    /* ==================================================================== */
    /* Portal: veri ve analiz                                                */
    /* ==================================================================== */

    /// <summary>
    /// Seçilen tarih aralığındaki bütün kontroller, parti başına bir satır
    /// ("ürün yok" kontrolü tek satır). Süzme ve analiz sayfada.
    /// </summary>
    [HttpGet("Veri")]
    public IActionResult Veri([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        if (!PanelYetkili()) return Forbid();

        var b = (bas ?? DateTime.Today.AddDays(1 - DateTime.Today.Day)).Date;
        var s = (bit ?? DateTime.Today).Date.AddDays(1);
        var bugun = DateTime.Today;

        using var db = _vt.Baglanti();
        var satirlar = db.Query(@"
SELECT TOP 50000
    k.id AS kontrolId, k.plan_id AS planId, k.sube, LTRIM(RTRIM(k.stok_kod)) AS stokKod, k.barkod, k.urun_ad AS ad,
    k.ana_grup AS grup, k.kategori AS kat, k.tur, k.notu, k.personel_ad AS kisi,
    ISNULL(k.guncelleme, k.olusturma) AS tarih,
    p.id AS partiId, p.skt, p.adet, p.aksiyon, p.aksiyon_yapan AS aksiyonYapan, p.aksiyon_tarih AS aksiyonTarih
FROM B360_SKT_KONTROL k
    LEFT JOIN B360_SKT_PARTI p ON p.kontrol_id = k.id
WHERE k.silindi = 0 AND ISNULL(k.guncelleme, k.olusturma) >= @b AND ISNULL(k.guncelleme, k.olusturma) < @s
ORDER BY ISNULL(k.guncelleme, k.olusturma) DESC", new { b, s }, commandTimeout: 120)
            .Select(x =>
            {
                DateTime? skt = x.skt;
                int? kalan = skt is null ? null : (int)(skt.Value - bugun).TotalDays;
                return new
                {
                    kontrolId = (int)x.kontrolId,
                    partiId = (int?)x.partiId,
                    planId = (int?)x.planId,
                    kaynak = x.planId is null ? "serbest" : "plan",
                    sube = (string)x.sube,
                    stokKod = (string)x.stokKod,
                    barkod = (string)x.barkod,
                    ad = (string)x.ad,
                    grup = (string)x.grup,
                    kat = (string)x.kat,
                    tur = (string)x.tur,
                    not = (string)x.notu,
                    kisi = (string)x.kisi,
                    tarih = (DateTime)x.tarih,
                    skt,
                    adet = (int?)x.adet,
                    kalan,
                    durum = Durum((string)x.tur, kalan),
                    aksiyon = (string)x.aksiyon,
                    aksiyonYapan = (string)x.aksiyonYapan,
                };
            })
            .ToList();

        return Ok(new { bas = b, bit = s.AddDays(-1), esik = new { kritik = Kritik, yakin = Yakin }, kayitlar = satirlar });
    }

    /// <summary>Ayın planları ve ilerlemesi (şube durumu sekmesi).</summary>
    [HttpGet("Planlar")]
    public IActionResult Planlar([FromQuery] string ay)
    {
        if (!PanelYetkili()) return Forbid();
        ay = string.IsNullOrWhiteSpace(ay) ? Ay(DateTime.Today) : ay.Trim();

        using var db = _vt.Baglanti();
        var planlar = db.Query(@"
SELECT p.id, p.ay, p.sube, p.kategori, p.aciklama, p.son_gun AS sonGun, p.sira,
       (SELECT COUNT(*) FROM B360_SKT_PLAN_URUN u WHERE u.plan_id = p.id) AS urun,
       (SELECT COUNT(DISTINCT k.stok_kod) FROM B360_SKT_KONTROL k WHERE k.plan_id = p.id AND k.silindi = 0
            AND EXISTS (SELECT 1 FROM B360_SKT_PLAN_URUN u WHERE u.plan_id = p.id AND u.stok_kod = k.stok_kod)) AS yapilan,
       (SELECT COUNT(DISTINCT k.personel_kodu) FROM B360_SKT_KONTROL k WHERE k.plan_id = p.id AND k.silindi = 0) AS katilan,
       (SELECT MAX(ISNULL(k.guncelleme, k.olusturma)) FROM B360_SKT_KONTROL k WHERE k.plan_id = p.id AND k.silindi = 0) AS son
FROM B360_SKT_PLAN p
WHERE p.silindi = 0 AND p.ay = @ay
ORDER BY p.sira, p.id", new { ay }).ToList();

        var aylar = db.Query<string>("SELECT DISTINCT ay FROM B360_SKT_PLAN WHERE silindi = 0 ORDER BY ay DESC").ToList();

        /* 26.10.2026: otomatik plan bilgisi (sayfada not olarak) */
        return Ok(new { ay, aylar, planlar, otomatik = new { acik = SktOtomatikPlanGorevi.Acik(HttpContext.RequestServices.GetRequiredService<IConfiguration>()), gun = SktOtomatikPlanGorevi.Gun(HttpContext.RequestServices.GetRequiredService<IConfiguration>()) } });
    }

    /// <summary>Kategori rotasyonu: ay ay hangi kategori hangi şubede (plan sekmesi)</summary>
    [HttpGet("Rotasyon")]
    public IActionResult Rotasyon([FromQuery] string bas, [FromQuery] int ayAdet = 4)
    {
        if (!PanelYetkili()) return Forbid();
        var b = string.IsNullOrWhiteSpace(bas) ? Ay(DateTime.Today.AddMonths(-1)) : bas;
        var ilk = DateTime.ParseExact(b + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var aylar = Enumerable.Range(0, Math.Clamp(ayAdet, 1, 12)).Select(i => Ay(ilk.AddMonths(i))).ToList();

        using var db = _vt.Baglanti();
        var planlar = db.Query("SELECT id, ay, sube, kategori FROM B360_SKT_PLAN WHERE silindi = 0 AND ay IN @aylar", new { aylar })
            .Select(x => new { id = (int)x.id, ay = (string)x.ay, sube = (string)x.sube, kategori = (string)x.kategori });

        return Ok(new { aylar, planlar });
    }

    public class PlanGirdi
    {
        public int? Id { get; set; }
        public string Ay { get; set; }
        public string Sube { get; set; }
        public string Kategori { get; set; }
        public string Aciklama { get; set; }
        public DateTime? SonGun { get; set; }
    }

    [HttpPost("Plan")]
    public IActionResult PlanKaydet([FromBody] PlanGirdi g)
    {
        if (!PanelYetkili()) return Forbid();
        if (g is null || string.IsNullOrWhiteSpace(g.Ay) || g.Ay.Length != 7 || string.IsNullOrWhiteSpace(g.Sube) || string.IsNullOrWhiteSpace(g.Kategori))
            return BadRequest(new { hata = "Ay, şube ve kategori gerekli." });

        using var db = _vt.Baglanti();
        if (g.Id is int id)
        {
            db.Execute(@"UPDATE B360_SKT_PLAN SET ay = @Ay, sube = @Sube, kategori = @Kategori, aciklama = @Aciklama, son_gun = @SonGun WHERE id = @Id",
                new { g.Ay, Sube = g.Sube.Trim(), Kategori = g.Kategori.Trim(), g.Aciklama, g.SonGun, Id = id });
            return Ok(new { id });
        }

        var yeni = db.ExecuteScalar<int>(@"
INSERT INTO B360_SKT_PLAN (ay, sube, kategori, aciklama, son_gun, sira, olusturan) OUTPUT INSERTED.id
VALUES (@Ay, @Sube, @Kategori, @Aciklama, @SonGun, (SELECT ISNULL(MAX(sira), 0) + 1 FROM B360_SKT_PLAN WHERE ay = @Ay), @kim)",
            new { g.Ay, Sube = g.Sube.Trim(), Kategori = g.Kategori.Trim(), g.Aciklama, g.SonGun, kim = Kullanici });
        return Ok(new { id = yeni });
    }

    [HttpDelete("Plan/{id:int}")]
    public IActionResult PlanSil(int id)
    {
        if (!PanelYetkili()) return Forbid();
        using var db = _vt.Baglanti();
        db.Execute("UPDATE B360_SKT_PLAN SET silindi = 1 WHERE id = @id", new { id });
        return Ok(new { basarili = true });
    }

    [HttpGet("Plan/{id:int}/Urunler")]
    public IActionResult PlanUrunleri(int id)
    {
        if (!PanelYetkili()) return Forbid();
        using var db = _vt.Baglanti();
        return Ok(db.Query(@"
SELECT u.stok_kod AS stokKod, u.barkod, u.urun_ad AS ad, u.ana_grup AS grup, u.kategori AS kat,
       (SELECT COUNT(*) FROM B360_SKT_KONTROL k WHERE k.plan_id = u.plan_id AND k.stok_kod = u.stok_kod AND k.silindi = 0) AS kontrol
FROM B360_SKT_PLAN_URUN u WHERE u.plan_id = @id ORDER BY u.ana_grup, u.kategori, u.urun_ad", new { id }));
    }

    public class UrunDegisim
    {
        public List<string> Ekle { get; set; } = new();
        public List<string> Cikar { get; set; } = new();
    }

    /// <summary>Plana barkodla ürün ekler ya da stok koduyla çıkarır.</summary>
    [HttpPost("Plan/{id:int}/Urunler")]
    public IActionResult PlanUrunDegis(int id, [FromBody] UrunDegisim g)
    {
        if (!PanelYetkili()) return Forbid();
        using var db = _vt.Baglanti();
        var bulunamayan = new List<string>();

        foreach (var b in (g?.Ekle ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct())
        {
            var u = UrunBul(b);
            if (u is null) { bulunamayan.Add(b); continue; }
            UrunEkle(db, id, u);
        }

        foreach (var kod in (g?.Cikar ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)))
            db.Execute("DELETE FROM B360_SKT_PLAN_URUN WHERE plan_id = @id AND stok_kod = @kod", new { id, kod = kod.Trim() });

        return Ok(new { basarili = true, bulunamayan });
    }

    private static void UrunEkle(System.Data.IDbConnection db, int planId, Urun u, System.Data.IDbTransaction tx = null) =>
        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM B360_SKT_PLAN_URUN WHERE plan_id = @planId AND stok_kod = @kod)
INSERT INTO B360_SKT_PLAN_URUN (plan_id, stok_kod, barkod, urun_ad, ana_grup, kategori) VALUES (@planId, @kod, @barkod, @ad, @grup, @kat)",
            new { planId, kod = u.StokKod.Trim(), barkod = u.Barkod, ad = u.Ad, grup = u.AnaGrup, kat = u.Kategori }, tx);

    public class DoldurGirdi
    {
        public string AnaGrup { get; set; }
        public List<string> Kategoriler { get; set; } = new();
        public bool Temizle { get; set; }
    }

    /// <summary>Planı Mikro'dan doldurur: ana grup (ve seçilirse kategoriler) altındaki aktif ürünler.</summary>
    [HttpPost("Plan/{id:int}/Doldur")]
    public IActionResult PlanDoldur(int id, [FromBody] DoldurGirdi g)
    {
        if (!PanelYetkili()) return Forbid();
        if (string.IsNullOrWhiteSpace(g?.AnaGrup)) return BadRequest(new { hata = "Ana grup seçiniz." });

        List<Urun> urunler;
        try
        {
            using var m = _vt.MikroBaglantisi();
            var kats = (g.Kategoriler ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToList();
            urunler = m.Query(@"
SELECT TOP 3000 LTRIM(RTRIM(S.sto_kod)) AS kod, S.sto_isim AS ad, G.san_isim AS grup, ISNULL(K.ktg_isim, '') AS kat,
       (SELECT TOP 1 LTRIM(RTRIM(B.bar_kodu)) FROM BARKOD_TANIMLARI B WITH (NOLOCK) WHERE B.bar_stokkodu = S.sto_kod ORDER BY B.bar_master DESC) AS barkod
FROM STOKLAR S WITH (NOLOCK)
    JOIN STOK_ANA_GRUPLARI G WITH (NOLOCK) ON G.san_kod = S.sto_anagrup_kod
    LEFT JOIN STOK_KATEGORILERI K WITH (NOLOCK) ON K.ktg_kod = S.sto_kategori_kodu
WHERE (G.san_isim = @grup OR G.san_kod = @grup)
  AND ISNULL(S.sto_pasif_fl, 0) = 0
  AND (@katYok = 1 OR K.ktg_isim IN @kats OR K.ktg_kod IN @kats)
ORDER BY K.ktg_isim, S.sto_isim", new { grup = g.AnaGrup.Trim(), kats = kats.Count == 0 ? new List<string> { "" } : kats, katYok = kats.Count == 0 ? 1 : 0 },
                commandTimeout: 120)
                .Select(x => new Urun((string)x.kod, (string)x.barkod, (string)x.ad, (string)x.grup, (string)x.kat))
                .ToList();
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "SKT: Mikro'dan ürün listesi alınamadı");
            return StatusCode(502, new { hata = "Mikro'dan ürün listesi alınamadı.", ayrinti = h.Message });
        }

        using var db = _vt.Baglanti();
        if (g.Temizle) db.Execute("DELETE FROM B360_SKT_PLAN_URUN WHERE plan_id = @id", new { id });
        foreach (var u in urunler) UrunEkle(db, id, u);
        return Ok(new { eklenen = urunler.Count });
    }

    /// <summary>
    /// Bir sonraki ayın planı: her kategori listede bir sonraki şubeye
    /// geçer (son şubenin kategorisi ilk şubeye). Ürün listeleri de
    /// kategoriyle birlikte taşınır.
    /// </summary>
    [HttpPost("Plan/Kaydir")]
    public IActionResult PlanKaydir([FromBody] KaydirGirdi g)
    {
        if (!PanelYetkili()) return Forbid();
        if (string.IsNullOrWhiteSpace(g?.KaynakAy) || string.IsNullOrWhiteSpace(g?.HedefAy)) return BadRequest(new { hata = "Ay seçiniz." });

        using var db = _vt.Baglanti();
        var kaynak = db.Query("SELECT * FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay ORDER BY sira, id", new { ay = g.KaynakAy }).ToList();
        if (kaynak.Count == 0) return BadRequest(new { hata = $"{g.KaynakAy} için plan yok." });

        var hedefVar = db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay", new { ay = g.HedefAy });
        if (hedefVar > 0 && !g.Uzerine)
            return Conflict(new { hata = $"{g.HedefAy} için zaten {hedefVar} plan var.", ayrinti = "Üzerine yazmak için onaylayın." });

        var n = KaydirIc(db, g.KaynakAy, g.HedefAy, g.Adim, Kullanici, hedefVar > 0);
        return Ok(new { olusturulan = n });
    }

    /// <summary>
    /// Kaydırmanın kendisi (elle düğme ve otomatik görev ortak). Kaynak
    /// ayın planları sırasıyla dolaşılır; her kategori listede bir sonraki
    /// şubeye geçer, ürün listesiyle birlikte. Böylece bir kategoriyi bu ay
    /// kontrol eden şube onu gelecek ay yapmaz; kategori şubeler arasında
    /// döner ve şube sayısı kadar ayda her şube her kategoriyi bir kez görür.
    /// </summary>
    public static int KaydirIc(System.Data.IDbConnection db, string kaynakAy, string hedefAy, int adim, string kim, bool uzerine)
    {
        var kaynak = db.Query("SELECT * FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay ORDER BY sira, id", new { ay = kaynakAy }).ToList();
        if (kaynak.Count == 0) return 0;

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var tx = db.BeginTransaction();
        if (uzerine) db.Execute("UPDATE B360_SKT_PLAN SET silindi = 1 WHERE ay = @ay AND silindi = 0", new { ay = hedefAy }, tx);

        var n = kaynak.Count;
        var a = adim == 0 ? 1 : adim;
        for (var i = 0; i < n; i++)
        {
            var kat = kaynak[i];
            var hedefSube = (string)kaynak[((i + a) % n + n) % n].sube;
            var yeni = db.ExecuteScalar<int>(@"
INSERT INTO B360_SKT_PLAN (ay, sube, kategori, aciklama, sira, olusturan) OUTPUT INSERTED.id
VALUES (@ay, @sube, @kategori, @aciklama, @sira, @kim)",
                new { ay = hedefAy, sube = hedefSube, kategori = (string)kat.kategori, aciklama = (string)kat.aciklama, sira = i + 1, kim }, tx);
            db.Execute(@"
INSERT INTO B360_SKT_PLAN_URUN (plan_id, stok_kod, barkod, urun_ad, ana_grup, kategori)
SELECT @yeni, stok_kod, barkod, urun_ad, ana_grup, kategori FROM B360_SKT_PLAN_URUN WHERE plan_id = @eski",
                new { yeni, eski = (int)kat.id }, tx);
        }
        tx.Commit();
        return n;
    }

    /* ==================================================================== */
    /* Ana gruplardan aylık plan (26.10.2026)                               */
    /* ==================================================================== */

    /// <summary>
    /// SKT kategorileri Mikro'daki stok ana grupları
    /// (MikroDB_V15_BICEN.dbo.STOK_ANA_GRUPLARI). Skt:HaricAnaGruplar'daki
    /// san_RECno'lar (varsayılan 42,45,46,47) dağıtılmaz.
    /// </summary>
    public static List<(int Rec, string Kod, string Ad)> AnaGruplar(VeritabaniServisi vt, IConfiguration y)
    {
        var haric = (y["Skt:HaricAnaGruplar"] ?? "42,45,46,47")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => int.TryParse(x, out var v) ? v : -1).Where(x => x > 0).ToList();
        using var m = vt.MikroBaglantisi();
        return m.Query<(int, string, string)>(@"
SELECT san_RECno, LTRIM(RTRIM(san_kod)), LTRIM(RTRIM(san_isim))
FROM STOK_ANA_GRUPLARI WITH (NOLOCK)
WHERE ISNULL(san_isim, '') <> ''" + (haric.Count > 0 ? " AND san_RECno NOT IN @haric" : "") + @"
ORDER BY san_RECno", new { haric }).ToList();
    }

    /// <summary>
    /// Ayın planını ana gruplardan kurar. Şubeler (Şube ve Depo ekranındaki
    /// aktif şubeler, kod sırasıyla) ve ana gruplar sabit sırada; ay
    /// ilerledikçe her şube listede bir sonraki ana gruba geçer:
    /// şube i, ay m → grup (i + m) mod G. Böylece bu ay bir grubu kontrol
    /// eden şube gelecek ay başka grubu alır ve G ayda her grubu bir kez
    /// görür. Her planın ürün listesi o ana gruptaki aktif ürünler.
    /// </summary>
    public static (int plan, int urun) AnaGruplardanOlustur(VeritabaniServisi vt, IConfiguration y, string ay, string kim, bool uzerine)
    {
        var gruplar = AnaGruplar(vt, y);
        if (gruplar.Count == 0) return (0, 0);

        using var db = vt.Baglanti();
        var subeler = db.Query<string>("SELECT sube_adi FROM B360_SUBE_DEPO WHERE aktif = 1 AND ISNULL(sube_adi, '') <> '' ORDER BY sube_kodu")
            .Select(x => x.Trim())
            .GroupBy(x => SubeAnahtar(x)).Select(g => g.First()) /* aynı şube iki satırsa bir kez */
            .ToList();
        if (subeler.Count == 0) return (0, 0);

        var t = DateTime.ParseExact(ay + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture);
        var m = t.Year * 12 + t.Month;
        var G = gruplar.Count;

        /* Grupların ürünleri bir kez okunur */
        var urunler = new Dictionary<string, List<Urun>>(StringComparer.OrdinalIgnoreCase);
        using (var mk = vt.MikroBaglantisi())
            foreach (var g in subeler.Select((_, i) => gruplar[((i + m) % G + G) % G]).DistinctBy(x => x.Kod))
                urunler[g.Kod] = mk.Query(@"
SELECT TOP 5000 LTRIM(RTRIM(S.sto_kod)) AS kod, S.sto_isim AS ad, ISNULL(K.ktg_isim, '') AS kat,
       (SELECT TOP 1 LTRIM(RTRIM(B.bar_kodu)) FROM BARKOD_TANIMLARI B WITH (NOLOCK) WHERE B.bar_stokkodu = S.sto_kod ORDER BY B.bar_master DESC) AS barkod
FROM STOKLAR S WITH (NOLOCK)
    LEFT JOIN STOK_KATEGORILERI K WITH (NOLOCK) ON K.ktg_kod = S.sto_kategori_kodu
WHERE S.sto_anagrup_kod = @kod AND ISNULL(S.sto_pasif_fl, 0) = 0
ORDER BY K.ktg_isim, S.sto_isim", new { kod = g.Kod }, commandTimeout: 120)
                    .Select(x => new Urun((string)x.kod, (string)x.barkod, (string)x.ad, g.Ad, (string)x.kat))
                    .ToList();

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var tx = db.BeginTransaction();
        if (uzerine) db.Execute("UPDATE B360_SKT_PLAN SET silindi = 1 WHERE ay = @ay AND silindi = 0", new { ay }, tx);

        var toplamUrun = 0;
        for (var i = 0; i < subeler.Count; i++)
        {
            var g = gruplar[((i + m) % G + G) % G];
            var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_SKT_PLAN (ay, sube, kategori, aciklama, sira, olusturan) OUTPUT INSERTED.id
VALUES (@ay, @sube, @kategori, @aciklama, @sira, @kim)",
                new { ay, sube = subeler[i], kategori = g.Ad, aciklama = "Ana grup " + g.Kod, sira = i + 1, kim }, tx);
            foreach (var u in urunler[g.Kod]) UrunEkle(db, id, u, tx);
            toplamUrun += urunler[g.Kod].Count;
        }
        tx.Commit();
        return (subeler.Count, toplamUrun);
    }

    public class AnaGrupGirdi
    {
        public string Ay { get; set; }
        public bool Uzerine { get; set; }
    }

    /// <summary>Panel: ayın planını ana gruplardan kur (otomatikle aynı kural).</summary>
    [HttpPost("Plan/AnaGruplardan")]
    public IActionResult PlanAnaGruplardan([FromBody] AnaGrupGirdi g)
    {
        if (!PanelYetkili()) return Forbid();
        if (string.IsNullOrWhiteSpace(g?.Ay) || g.Ay.Length != 7) return BadRequest(new { hata = "Ay seçiniz." });
        var y = HttpContext.RequestServices.GetRequiredService<IConfiguration>();

        using (var db = _vt.Baglanti())
        {
            var var_ = db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay", new { ay = g.Ay });
            if (var_ > 0 && !g.Uzerine)
                return Conflict(new { hata = $"{g.Ay} için zaten {var_} plan var.", ayrinti = "Üzerine yazmak için onaylayın." });
        }

        try
        {
            var (plan, urun) = AnaGruplardanOlustur(_vt, y, g.Ay, Kullanici, g.Uzerine);
            if (plan == 0) return BadRequest(new { hata = "Ana grup ya da şube bulunamadı." });
            return Ok(new { olusturulan = plan, urun });
        }
        catch (Exception h)
        {
            _kayit.LogError(h, "SKT: ana gruplardan plan kurulamadı");
            return StatusCode(502, new { hata = "Mikro'dan ana gruplar okunamadı." });
        }
    }

    public class KaydirGirdi
    {
        public string KaynakAy { get; set; }
        public string HedefAy { get; set; }
        public int Adim { get; set; } = 1;
        public bool Uzerine { get; set; }
    }

    /// <summary>
    /// Excel'den içe aktarma (ayın planı). İki biçim tanınıyor; ikisi
    /// birlikte de verilebilir:
    ///  1) Kategori planı: KATEGORİ · AÇIKLAMA · ŞUBELER (ÜRÜN ADET)
    ///  2) Ürün listesi: Stok kodu · Barkod · Stok ismi · Ana Grup · Kategori · Mağaza
    /// Ürün listesindeki her mağaza için plan açılır; kategori adı
    /// 1. biçimden, yoksa ürünlerin en çok geçen ana grubundan.
    /// </summary>
    [HttpPost("Plan/IceAktar")]
    [RequestSizeLimit(30 * 1024 * 1024)]
    public IActionResult IceAktar([FromForm] string ay, [FromForm] bool uzerine, IFormFileCollection dosyalar)
    {
        if (!PanelYetkili()) return Forbid();
        if (string.IsNullOrWhiteSpace(ay) || ay.Length != 7) return BadRequest(new { hata = "Ay seçiniz." });
        var dosyaListesi = (dosyalar?.Count ?? 0) > 0 ? dosyalar.ToList() : Request.Form.Files.ToList();
        if (dosyaListesi.Count == 0) return BadRequest(new { hata = "Excel dosyası seçiniz." });

        var basliklar = new Dictionary<string, (string kategori, string aciklama)>();
        var urunler = new Dictionary<string, Dictionary<string, Urun>>();
        var subeAdlari = new Dictionary<string, string>();
        var uyarilar = new List<string>();

        foreach (var d in dosyaListesi)
        {
            (string ad, List<List<string>> satirlar)[] sayfalar;
            try
            {
                using var akis = d.OpenReadStream();
                sayfalar = XlsxOku(akis);
            }
            catch (Exception h)
            {
                uyarilar.Add($"{d.FileName}: okunamadı ({h.Message})");
                continue;
            }

            /* Aynı dosyada birden çok ürün listesi sayfası varsa (ör. "Sayfa1"
               ve "Ekim"), seçilen ayın adını taşıyan sayfa; yoksa sonuncusu. */
            var ayAdi = BaslikAnahtar(DateTime.ParseExact(ay + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture).ToString("MMMM", Tr));
            var urunSayfalari = sayfalar.Where(x => { var (i2, b2) = BaslikBul(x.satirlar); return i2 >= 0 && b2.Select(BaslikAnahtar).Contains("magaza"); }).ToList();
            var secilenUrun = urunSayfalari.FirstOrDefault(x => BaslikAnahtar(x.ad).Contains(ayAdi)).satirlar ?? urunSayfalari.LastOrDefault().satirlar;
            if (urunSayfalari.Count > 1) uyarilar.Add($"{d.FileName}: {urunSayfalari.Count} ürün listesi sayfası var; \"{(urunSayfalari.FirstOrDefault(x => BaslikAnahtar(x.ad).Contains(ayAdi)).ad ?? urunSayfalari.Last().ad)}\" kullanıldı.");

            foreach (var (_, satirlar) in sayfalar)
            {
                var (bi, b) = BaslikBul(satirlar);
                if (bi < 0) continue;
                if (b.Select(BaslikAnahtar).Contains("magaza") && !ReferenceEquals(satirlar, secilenUrun)) continue;
                int Sutun(params string[] adlar) => b.FindIndex(x => adlar.Any(a => BaslikAnahtar(x) == BaslikAnahtar(a)));

                var cMagaza = Sutun("Mağaza", "Magaza", "Şube");
                var cStok = Sutun("Stok kodu", "Stok Kod", "Stok_kod");
                var cKat = Sutun("KATEGORİ", "Kategori");
                var cSubeler = Sutun("ŞUBELER", "Şubeler", "SUBELER");

                if (cMagaza >= 0 && cStok >= 0)
                {
                    var cBarkod = Sutun("Barkod");
                    var cAd = Sutun("Stok ismi", "Stok_isim", "Ürün");
                    var cGrup = Sutun("Ana Grup", "AnaGrup");
                    foreach (var r in satirlar.Skip(bi + 1))
                    {
                        string H(int c) => c >= 0 && c < r.Count ? (r[c] ?? "").Trim() : "";
                        var sube = H(cMagaza);
                        var stok = H(cStok);
                        if (sube.Length == 0 || stok.Length == 0 || sube.StartsWith("#")) continue;
                        var a = SubeAnahtar(sube);
                        subeAdlari.TryAdd(a, sube);
                        if (!urunler.TryGetValue(a, out var l)) urunler[a] = l = new();
                        l.TryAdd(stok, new Urun(stok, H(cBarkod), H(cAd), H(cGrup), H(cKat)));
                    }
                }
                else if (cKat >= 0 && cSubeler >= 0)
                {
                    var cAcik = Sutun("AÇIKLAMA", "Aciklama");
                    foreach (var r in satirlar.Skip(bi + 1))
                    {
                        string H(int c) => c >= 0 && c < r.Count ? (r[c] ?? "").Trim() : "";
                        var sube = H(cSubeler);
                        var kat = H(cKat);
                        if (sube.Length == 0 || kat.Length == 0 || BaslikAnahtar(kat) == "toplam") continue;
                        var a = SubeAnahtar(sube);
                        subeAdlari.TryAdd(a, sube);
                        basliklar[a] = (kat, H(cAcik));
                    }
                }
            }
        }

        var tumSubeler = basliklar.Keys.Union(urunler.Keys).ToList();
        if (tumSubeler.Count == 0)
            return BadRequest(new { hata = "Dosyada plan bulunamadı.", ayrinti = "Sütunlar: KATEGORİ · AÇIKLAMA · ŞUBELER ya da Stok kodu · Barkod · Stok ismi · Ana Grup · Kategori · Mağaza" });

        using var db = _vt.Baglanti();
        var mevcut = db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay", new { ay });
        if (mevcut > 0 && !uzerine)
            return Conflict(new { hata = $"{ay} için zaten {mevcut} plan var.", ayrinti = "Üzerine yazmak için onaylayın." });

        using var tx = db.BeginTransactionAc();
        if (mevcut > 0) db.Execute("UPDATE B360_SKT_PLAN SET silindi = 1 WHERE ay = @ay AND silindi = 0", new { ay }, tx);

        var sira = 0;
        var urunSayisi = 0;
        foreach (var a in tumSubeler)
        {
            basliklar.TryGetValue(a, out var bs);
            urunler.TryGetValue(a, out var ul);
            /* Kategori adı: ürün listesi varsa en çok geçen ana grup; kategori
               planındaki ad ürünlerle örtüşüyorsa (aynı kelime) o, daha ayrıntılı.
               Örtüşmüyorsa (plan başka aya aitse) uyarı verilir. */
            var urunGrubu = ul?.Values.GroupBy(x => x.AnaGrup).OrderByDescending(x => x.Count()).FirstOrDefault()?.Key;
            string kategori;
            if (ul is null || ul.Count == 0) kategori = string.IsNullOrWhiteSpace(bs.kategori) ? "Kategori" : bs.kategori;
            else if (!string.IsNullOrWhiteSpace(bs.kategori) && Ortusur(bs.kategori, ul.Values)) kategori = bs.kategori;
            else
            {
                kategori = string.IsNullOrWhiteSpace(urunGrubu) ? (bs.kategori ?? "Kategori") : urunGrubu;
                if (!string.IsNullOrWhiteSpace(bs.kategori))
                    uyarilar.Add($"{subeAdlari[a]}: kategori planında \"{bs.kategori}\" yazıyor ama ürün listesi {urunGrubu}; ürün listesine göre alındı.");
            }
            var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_SKT_PLAN (ay, sube, kategori, aciklama, sira, olusturan) OUTPUT INSERTED.id
VALUES (@ay, @sube, @kategori, @aciklama, @sira, @kim)",
                new { ay, sube = subeAdlari[a], kategori, aciklama = string.IsNullOrWhiteSpace(bs.aciklama) ? null : bs.aciklama, sira = ++sira, kim = Kullanici }, tx);
            foreach (var u in ul?.Values ?? Enumerable.Empty<Urun>())
            {
                UrunEkle(db, id, u, tx);
                urunSayisi++;
            }
            if (ul is null) uyarilar.Add($"{subeAdlari[a]}: ürün listesi yok (Mikro'dan doldurabilir ya da ürün ekleyebilirsiniz).");
        }
        tx.Commit();

        return Ok(new { plan = tumSubeler.Count, urun = urunSayisi, uyarilar });
    }

    /// <summary>Kategori adı ile ürünlerin ana grup/kategori adları ortak kelime içeriyor mu</summary>
    private static bool Ortusur(string kategori, IEnumerable<Urun> urunler)
    {
        static IEnumerable<string> Kelimeler(string x) =>
            (x ?? "").Split(new[] { ' ', '-', '+', ',', '/', '&' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(BaslikAnahtar).Where(w => w.Length >= 4).Select(w => w.Length > 6 ? w[..6] : w);
        var k = Kelimeler(kategori).ToHashSet();
        return urunler.Any(u => Kelimeler(u.AnaGrup).Concat(Kelimeler(u.Kategori)).Any(k.Contains));
    }

    private static (int, List<string>) BaslikBul(List<List<string>> satirlar)
    {
        for (var i = 0; i < Math.Min(15, satirlar.Count); i++)
        {
            var r = satirlar[i].Select(x => x ?? "").ToList();
            var a = r.Select(BaslikAnahtar).ToList();
            if ((a.Contains("magaza") && a.Contains("stokkodu")) || (a.Contains("kategori") && a.Contains("subeler")))
                return (i, r);
        }
        return (-1, null);
    }

    /// <summary>Basit .xlsx okuyucu (paket gerektirmez): her sayfa satır × hücre metni.</summary>
    public static (string ad, List<List<string>> satirlar)[] XlsxOku(Stream akis)
    {
        using var ms = new MemoryStream();
        akis.CopyTo(ms);
        ms.Position = 0;
        using var zip = new ZipArchive(ms, ZipArchiveMode.Read);
        XNamespace n = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

        var paylasilan = new List<string>();
        var ss = zip.GetEntry("xl/sharedStrings.xml");
        if (ss is not null)
        {
            using var s = ss.Open();
            paylasilan = XDocument.Load(s).Root!.Elements(n + "si")
                .Select(si => string.Concat(si.Descendants(n + "t").Select(t => t.Value))).ToList();
        }

        /* Sayfa adları: workbook.xml + ilişkiler (sıra kitaptaki gibi) */
        var sira = new List<(string ad, string yol)>();
        try
        {
            XNamespace r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            XNamespace pr = "http://schemas.openxmlformats.org/package/2006/relationships";
            var iliskiler = new Dictionary<string, string>();
            using (var rs = zip.GetEntry("xl/_rels/workbook.xml.rels")!.Open())
                foreach (var x in XDocument.Load(rs).Root!.Elements(pr + "Relationship"))
                    iliskiler[(string)x.Attribute("Id")] = "xl/" + ((string)x.Attribute("Target")).TrimStart('/').Replace("xl/", "");
            using var ws = zip.GetEntry("xl/workbook.xml")!.Open();
            foreach (var sh in XDocument.Load(ws).Descendants(n + "sheet"))
                if (iliskiler.TryGetValue((string)sh.Attribute(r + "id") ?? "", out var yol))
                    sira.Add(((string)sh.Attribute("name") ?? "", yol));
        }
        catch
        {
            sira.Clear();
        }
        if (sira.Count == 0)
            sira = zip.Entries.Where(x => x.FullName.StartsWith("xl/worksheets/sheet", StringComparison.OrdinalIgnoreCase) && x.FullName.EndsWith(".xml"))
                .OrderBy(x => x.FullName.Length).ThenBy(x => x.FullName).Select(x => (x.Name, x.FullName)).ToList();

        var sonuc = new List<(string, List<List<string>>)>();
        foreach (var (sayfaAdi, yol) in sira)
        {
            var e = zip.GetEntry(yol);
            if (e is null) continue;
            using var s = e.Open();
            var doc = XDocument.Load(s);
            var satirlar = new List<List<string>>();
            foreach (var row in doc.Descendants(n + "row"))
            {
                var r = new List<string>();
                foreach (var c in row.Elements(n + "c"))
                {
                    var adres = (string)c.Attribute("r") ?? "";
                    var harf = new string(adres.TakeWhile(char.IsLetter).ToArray());
                    var col = 0;
                    foreach (var h in harf) col = col * 26 + (char.ToUpperInvariant(h) - 'A' + 1);
                    col = Math.Max(col - 1, r.Count);
                    while (r.Count < col) r.Add("");
                    var t = (string)c.Attribute("t");
                    var v = c.Element(n + "v")?.Value;
                    string deger = t switch
                    {
                        "s" => int.TryParse(v, out var i) && i < paylasilan.Count ? paylasilan[i] : "",
                        "inlineStr" => string.Concat(c.Descendants(n + "t").Select(x => x.Value)),
                        _ => v ?? "",
                    };
                    r.Add(deger);
                }
                satirlar.Add(r);
            }
            sonuc.Add((sayfaAdi, satirlar));
        }
        return sonuc.ToArray();
    }

    /* ==================================================================== */
    /* Portal: işlemler                                                       */
    /* ==================================================================== */

    public class AksiyonGirdi
    {
        public int PartiId { get; set; }
        public string Aksiyon { get; set; }
    }

    private static readonly HashSet<string> Aksiyonlar = new(StringComparer.OrdinalIgnoreCase)
    {
        "İndirime alındı", "Başka şubeye transfer", "Tedarikçiye iade", "İmha / fire", "Raftan kaldırıldı",
    };

    [HttpPost("Aksiyon")]
    public IActionResult Aksiyon([FromBody] AksiyonGirdi g)
    {
        if (!PanelYetkili()) return Forbid();
        var a = string.IsNullOrWhiteSpace(g?.Aksiyon) ? null : g.Aksiyon.Trim();
        if (a is not null && !Aksiyonlar.Contains(a)) return BadRequest(new { hata = "Geçersiz aksiyon." });

        using var db = _vt.Baglanti();
        db.Execute(@"UPDATE B360_SKT_PARTI SET aksiyon = @a, aksiyon_yapan = CASE WHEN @a IS NULL THEN NULL ELSE @kim END,
aksiyon_tarih = CASE WHEN @a IS NULL THEN NULL ELSE SYSDATETIME() END WHERE id = @id",
            new { a, kim = User.FindFirstValue("adSoyad") ?? Kullanici, id = g.PartiId });
        return Ok(new { basarili = true });
    }

    public class HatirlatGirdi { public int PlanId { get; set; } }

    /// <summary>Şubedeki modül yetkilisi personele hatırlatma bildirimi.</summary>
    [HttpPost("Hatirlat")]
    public async Task<IActionResult> Hatirlat([FromBody] HatirlatGirdi g)
    {
        if (!PanelYetkili()) return Forbid();
        using var db = _vt.Baglanti();
        var p = db.QueryFirstOrDefault("SELECT * FROM B360_SKT_PLAN WHERE id = @id AND silindi = 0", new { id = g?.PlanId ?? 0 });
        if (p is null) return NotFound(new { hata = "Plan bulunamadı." });

        var anahtar = SubeAnahtar((string)p.sube);
        var kisiler = _personel.Liste()
            .Where(x => SubeAnahtar(x.Sube) == anahtar && _yetki.Modulleri(x.Sicil, x.Pozisyon ?? "").Contains("skt"))
            .Select(x => x.Sicil).ToList();
        if (kisiler.Count == 0) return Ok(new { gonderilen = 0, uyari = "Şubede SKT modülü açık personel bulunamadı." });

        var yapilan = db.ExecuteScalar<int>("SELECT COUNT(DISTINCT stok_kod) FROM B360_SKT_KONTROL WHERE plan_id = @id AND silindi = 0", new { id = (int)p.id });
        var toplam = db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SKT_PLAN_URUN WHERE plan_id = @id", new { id = (int)p.id });

        await _bildirim.CokluGonder(kisiler, "SKT kontrolü hatırlatma",
            $"Bu ayın kategorisi {(string)p.kategori}: {yapilan}/{toplam} ürün kontrol edildi. Lütfen kalan ürünlerin SKT'lerini girin.", "skt");
        return Ok(new { gonderilen = kisiler.Count });
    }

    [HttpGet("Secenekler")]
    public IActionResult Secenekler()
    {
        if (!PanelYetkili()) return Forbid();
        var subeler = _personel.Liste().Select(x => (x.Sube ?? "").Trim()).Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x, StringComparer.Create(Tr, true)).ToList();
        var gruplar = new List<string>();
        try
        {
            using var m = _vt.MikroBaglantisi();
            gruplar = m.Query<string>("SELECT san_isim FROM STOK_ANA_GRUPLARI WITH (NOLOCK) WHERE ISNULL(san_isim, '') <> '' ORDER BY san_isim").ToList();
        }
        catch { /* Mikro yoksa elle yazılır */ }

        return Ok(new { subeler, gruplar, aksiyonlar = Aksiyonlar.ToList(), esik = new { kritik = Kritik, yakin = Yakin } });
    }

    [HttpGet("Kategoriler")]
    public IActionResult Kategoriler([FromQuery] string grup)
    {
        if (!PanelYetkili()) return Forbid();
        try
        {
            using var m = _vt.MikroBaglantisi();
            return Ok(m.Query<string>(@"
SELECT DISTINCT K.ktg_isim FROM STOKLAR S WITH (NOLOCK)
    JOIN STOK_ANA_GRUPLARI G WITH (NOLOCK) ON G.san_kod = S.sto_anagrup_kod
    JOIN STOK_KATEGORILERI K WITH (NOLOCK) ON K.ktg_kod = S.sto_kategori_kodu
WHERE G.san_isim = @grup AND ISNULL(K.ktg_isim, '') <> '' ORDER BY K.ktg_isim", new { grup }, commandTimeout: 60).ToList());
        }
        catch
        {
            return Ok(new List<string>());
        }
    }
}

internal static class SktUzanti
{
    /// <summary>Bağlantıyı açıp işlem başlatır (Dapper kapalı bağlantıda işlem açamıyor).</summary>
    public static System.Data.IDbTransaction BeginTransactionAc(this System.Data.IDbConnection db)
    {
        if (db.State != System.Data.ConnectionState.Open) db.Open();
        return db.BeginTransaction();
    }
}

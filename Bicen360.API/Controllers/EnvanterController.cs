using System.Data;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Mağaza cihazları.
///
/// <para>
/// Arıza kaydında cihaz bu listeden seçiliyor. BiMDM ile bağ kurulmadı:
/// orası yalnızca Honeywell el terminallerini biliyor, buraya kasa,
/// yazıcı, tartı, kamera gibi her şey giriyor.
/// </para>
///
/// <para>
/// <b>Geçmiş ve maliyet (08.10.2026).</b> Tamir, bakım, parça ve
/// kalibrasyon kayıtları kalemleriyle (parça, işçilik, diğer) ve KDV'siyle
/// tutuluyor; arızadan doldurulan servis formları da cihazın geçmişine ve
/// maliyetine katılıyor (kopyası tutulmadan). Notlar, otomatik değişiklik
/// geçmişi, şube / konum geçmişi, planlı aktiviteler ve belgeler ayrı
/// tablolarda.
/// </para>
///
/// <para>
/// <b>Kim neyi görür.</b> Şube kullanıcısı kendi şubesinin cihazlarını
/// görür ama tutar görmez, tamir ve maliyet girmez. Diğer panel
/// kullanıcıları yalnızca sicilinin temsilci olduğu departmanın (cihazın
/// "sorumlu birimi") cihazlarını görür. Admin ve Yetkiler'de "Tüm
/// departmanlar" işaretli hesaplar hepsini.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class EnvanterController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly RaporKapsami _kapsam;
    private readonly ILogger<EnvanterController> _kayit;

    public EnvanterController(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        PanelKullaniciServisi panelKullanici,
        RaporKapsami kapsam,
        ILogger<EnvanterController> kayit)
    {
        _panelKullanici = panelKullanici;
        _kapsam = kapsam;
        _vt = vt;
        _yetki = yetki;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";
    private string AdSoyad => User.FindFirstValue("adSoyad") is { Length: > 0 } a ? a : Kullanici;

    private bool Yetkili() => _yetki.SayfaAcik(Kullanici, Rol, "envanter");

    public static readonly string[] Durumlar = { "aktif", "bakimda", "arizali", "pasif" };

    private static readonly Dictionary<string, string> DurumAdi = new()
    {
        ["aktif"] = "Çalışıyor", ["bakimda"] = "Bakımda", ["arizali"] = "Arızalı", ["pasif"] = "Kullanım dışı",
    };

    public static readonly string[] TamirTurleri = { "tamir", "bakim", "parca", "kalibrasyon" };

    /// <summary>Tamirin nerede olduğu (09.10.2026)</summary>
    public static readonly string[] TamirAsamalari = { "merkezde", "firmada", "tamamlandi" };

    private static readonly Dictionary<string, string> AsamaAdi = new()
    {
        ["merkezde"] = "Merkezde bekliyor", ["firmada"] = "Firmaya gönderildi", ["tamamlandi"] = "Tamamlandı",
    };

    private static readonly Dictionary<string, string> TamirAdi = new()
    {
        ["tamir"] = "Arıza onarımı", ["bakim"] = "Periyodik bakım",
        ["parca"] = "Parça değişimi", ["kalibrasyon"] = "Kalibrasyon / muayene",
    };

    private static readonly CultureInfo Tr = new("tr-TR");
    private static string Lira(decimal v) => "₺" + v.ToString("N0", Tr);

    /* ==================================================================== */
    /* Kapsam                                                               */
    /* ==================================================================== */

    /// <summary>Kullanıcının envanter kapsamı.</summary>
    private sealed record Erisim(string Sube, bool Tumu, List<int> Departmanlar, bool MaliyetIzni = true, bool Duzenler = true)
    {
        /// <summary>Tutarları görür, tamir ve maliyet girer: şube kullanıcısı değil,
        /// portal rolünde "maliyet" kapalı değil (13.10.2026)</summary>
        public bool Maliyet => Sube is null && MaliyetIzni;

        public string Kosul =>
            Sube is not null ? "E.sube_kodu = @kSube"
            : Tumu ? "1 = 1"
            : "E.departman_id IN @kDeps";

        public object Parametre => new
        {
            kSube = Sube,
            kDeps = Departmanlar.Count > 0 ? Departmanlar : new List<int> { 0 },
        };

        public bool DepartmanAcik(int? d) => Tumu || Sube is not null || (d is int x && Departmanlar.Contains(x));
    }

    private Erisim _erisim;

    private Erisim Kapsam()
    {
        if (_erisim is not null) return _erisim;

        /* Şube kullanıcısı (portaldan depo koduyla açılmış): kendi şubesi */
        var k = _panelKullanici.Getir(Kullanici);

        if (k.SubeKilitli) return _erisim = new Erisim(k.SubeKodu.Trim(), false, new List<int>());

        var r = _kapsam.Panel(Kullanici, Rol);

        /* Portal rolü: tutar ve düzenleme yetkisi rolden (13.10.2026) */
        return _erisim = new Erisim(null, r.TumunuGorur, r.Departmanlar ?? new List<int>(),
            _kapsam.MaliyetGorur(Kullanici, Rol), _yetki.SayfaYonetir(Kullanici, Rol, "envanter"));
    }

    private DynamicParameters P(object ek = null)
    {
        var p = new DynamicParameters(Kapsam().Parametre);
        if (ek is not null) p.AddDynamicParams(ek);
        return p;
    }

    /// <summary>Cihaz kullanıcının kapsamında mı</summary>
    private bool Erisilir(IDbConnection db, int id) =>
        db.ExecuteScalar<int>($"SELECT COUNT(*) FROM B360_ENVANTER E WHERE E.id = @id AND {Kapsam().Kosul}",
            P(new { id })) > 0;

    private static IActionResult Yok() => new NotFoundObjectResult(new { hata = "Cihaz bulunamadı." });

    private void Gecmis(IDbConnection db, int id, string metin, string tur = "log", IDbTransaction tx = null) =>
        db.Execute(@"
INSERT INTO B360_ENVANTER_HAREKET (envanter_id, tur, metin, yapan, yapan_adi)
VALUES (@id, @tur, @metin, @yapan, @ad)",
            new { id, tur, metin = metin.Length > 2000 ? metin[..1997] + "…" : metin, yapan = Kullanici, ad = AdSoyad }, tx);

    /* ==================================================================== */
    /* Listeleme                                                            */
    /* ==================================================================== */

    private const string CihazAlanlari = @"
    E.id, E.sube_kodu AS subeKodu, E.tur, E.marka, E.model,
    E.seri_no AS seriNo, E.sicil_no AS sicilNo, E.sahibi, E.konum,
    E.departman_id AS departmanId, E.ust_cihaz_id AS ustCihazId,
    E.tedarikci, E.alis_tarihi AS alisTarihi,
    E.garanti_var AS garantiVar, E.garanti_baslangic AS garantiBaslangic,
    E.garanti_ay AS garantiAy, E.garanti_bitis AS garantiBitis,
    E.garanti_saglayici AS garantiSaglayici, E.garanti_notu AS garantiNotu,
    E.son_bakim AS sonBakim, E.sonraki_bakim AS sonrakiBakim,
    E.bakim_araligi AS bakimAraligi, E.bakim_firmasi AS bakimFirmasi,
    E.bakim_notu AS bakimNotu,
    E.etiketler, E.notlar, E.durum, E.olusturma,
    E.alis_bedeli AS alisBedeli, E.ekonomik_omur AS ekonomikOmur, E.kapak_kirp AS kapakKirp,
    D.ad AS departman,
    LTRIM(RTRIM(ISNULL(U.marka, N'') + N' ' + ISNULL(U.model, N''))) AS ustCihaz";

    /// <summary>
    /// Kapsamdaki cihazlar; tamir sayısı ve maliyet toplamlarıyla.
    ///
    /// <para>
    /// Yeni ekran süzmeyi ve özet sayıları tarayıcıda yapıyor (anında
    /// süzgeç, gruplama). Sorgu parametreleri eski çağıranlar (panelden
    /// arıza açma) için duruyor; <c>durum=aktif</c> "kullanımda" demek.
    /// </para>
    /// </summary>
    [HttpGet]
    public IActionResult Liste(
        [FromQuery] string sube = null,
        [FromQuery] string tur = null,
        [FromQuery] string durum = null,
        [FromQuery] string garanti = null,
        [FromQuery] string ara = null)
    {
        if (!Yetkili()) return Forbid();

        var e = Kapsam();
        using var db = _vt.Baglanti();

        var yil = new DateTime(DateTime.Today.Year, 1, 1);

        var liste = db.Query($@"
SELECT {CihazAlanlari},
    (SELECT COUNT(*) FROM B360_ARIZA A
      WHERE A.envanter_id = E.id AND A.durum NOT IN (N'cozuldu', N'kapandi')) AS acikAriza,
    (SELECT COUNT(*) FROM B360_ARIZA A WHERE A.envanter_id = E.id) AS arizaSayisi,
    (SELECT TOP 1 G.id FROM B360_ENVANTER_GORSEL G
      WHERE G.envanter_id = E.id ORDER BY G.kapak DESC, G.id) AS kapakId,
    (SELECT COUNT(*) FROM B360_ENVANTER_GORSEL G WHERE G.envanter_id = E.id) AS gorselSayisi,
    (SELECT COUNT(*) FROM B360_ENVANTER_BELGE B WHERE B.envanter_id = E.id) AS belgeSayisi,
    (SELECT COUNT(*) FROM B360_ENVANTER_TAMIR T WHERE T.envanter_id = E.id)
      + (SELECT COUNT(*) FROM B360_SERVIS_FORM F WHERE F.envanter_id = E.id) AS tamirSayisi,
    ISNULL((SELECT SUM(CASE WHEN T.garantide = 1 THEN 0 ELSE T.toplam END)
            FROM B360_ENVANTER_TAMIR T WHERE T.envanter_id = E.id), 0)
      + ISNULL((SELECT SUM(F.toplam) FROM B360_SERVIS_FORM F WHERE F.envanter_id = E.id), 0) AS tamirToplam,
    ISNULL((SELECT SUM(CASE WHEN T.garantide = 1 THEN 0 ELSE T.toplam END)
            FROM B360_ENVANTER_TAMIR T WHERE T.envanter_id = E.id AND T.tarih >= @yil), 0)
      + ISNULL((SELECT SUM(F.toplam) FROM B360_SERVIS_FORM F
                WHERE F.envanter_id = E.id AND F.olusturma >= @yil), 0) AS buYilTamir,
    ISNULL((SELECT SUM(T.gun_disi) FROM B360_ENVANTER_TAMIR T WHERE T.envanter_id = E.id), 0) AS gunDisi,
    (SELECT MIN(K.tarih) FROM B360_ENVANTER_AKTIVITE K WHERE K.envanter_id = E.id AND K.bitti = 0) AS siradakiAktivite,
    (SELECT TOP 1 T.asama FROM B360_ENVANTER_TAMIR T
      WHERE T.envanter_id = E.id AND T.asama <> N'tamamlandi' ORDER BY T.id DESC) AS tamirAsama,
    (SELECT TOP 1 T.firma FROM B360_ENVANTER_TAMIR T
      WHERE T.envanter_id = E.id AND T.asama <> N'tamamlandi' ORDER BY T.id DESC) AS tamirFirma
FROM B360_ENVANTER E
    LEFT JOIN B360_DEPARTMAN D ON E.departman_id = D.id
    LEFT JOIN B360_ENVANTER  U ON E.ust_cihaz_id = U.id
WHERE {e.Kosul}
  AND (@sube IS NULL OR E.sube_kodu = @sube)
  AND (@tur IS NULL OR E.tur = @tur)
  AND (@durum IS NULL OR (@durum = N'aktif' AND E.durum <> N'pasif') OR E.durum = @durum)
  AND (@garanti IS NULL
       OR (@garanti = 'var' AND E.garanti_bitis >= CAST(GETDATE() AS DATE))
       OR (@garanti = 'bitti' AND E.garanti_bitis < CAST(GETDATE() AS DATE))
       OR (@garanti = 'yok' AND E.garanti_bitis IS NULL))
  AND (@ara IS NULL OR E.seri_no LIKE @kalip OR E.sicil_no LIKE @kalip
       OR E.marka LIKE @kalip OR E.model LIKE @kalip OR E.tur LIKE @kalip
       OR E.sahibi LIKE @kalip OR E.konum LIKE @kalip)
ORDER BY E.sube_kodu, E.tur, E.marka, E.model",
            P(new { sube = Bos(sube), tur = Bos(tur), durum = Bos(durum), garanti = Bos(garanti), ara = Bos(ara), kalip = $"%{ara}%", yil }))
            .Select(x => (IDictionary<string, object>)x)
            .ToList();

        if (!e.Maliyet)
            foreach (var c in liste)
            {
                c["alisBedeli"] = null;
                c["tamirToplam"] = null;
                c["buYilTamir"] = null;
            }

        return Ok(new { cihazlar = liste, erisim = ErisimBilgisi(db) });
    }

    private object ErisimBilgisi(IDbConnection db)
    {
        var e = Kapsam();

        var adlar = e.Departmanlar.Count == 0
            ? new List<string>()
            : db.Query<string>("SELECT ad FROM B360_DEPARTMAN WHERE id IN @d ORDER BY sira, ad",
                new { d = e.Departmanlar }).ToList();

        return new
        {
            maliyet = e.Maliyet,
            duzenler = e.Duzenler,
            kategoriYonetir = KategoriKapsami.Var,
            tumu = e.Tumu,
            sube = e.Sube,
            departmanlar = e.Departmanlar,
            departmanAdlari = adlar,
        };
    }

    private static string Bos(string d) => string.IsNullOrWhiteSpace(d) ? null : d.Trim();

    /// <summary>
    /// Süzgeç ve form listeleri. Cihaz türleri girilenlerden ve arıza
    /// kategorilerinden toplanıyor; firma önerileri tamir, bakım ve servis
    /// formlarından.
    /// </summary>
    [HttpGet("Secenekler")]
    public IActionResult Secenekler()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var turler = db.Query<string>(CihazTuruSorgusu.Hepsi).ToList();
        var kategoriTurleri = db.Query<string>(CihazTuruSorgusu.Kategoriler).ToList();

        var departmanlar = db.Query(@"
SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList();

        var firmalar = db.Query<string>(@"
SELECT f FROM (
    SELECT LTRIM(RTRIM(firma)) AS f FROM B360_ENVANTER_TAMIR
    UNION SELECT LTRIM(RTRIM(bakim_firmasi)) FROM B360_ENVANTER
    UNION SELECT LTRIM(RTRIM(tedarikci)) FROM B360_ENVANTER
    UNION SELECT LTRIM(RTRIM(servis_firma)) FROM B360_SERVIS_FORM
) x WHERE ISNULL(f, N'') <> N'' ORDER BY f").ToList();

        return Ok(new
        {
            turler,
            kategoriTurleri,
            departmanlar,
            subeler = Kapsam().Sube is { } s ? new List<string> { s } : Subeler(),
            firmalar,
            erisim = ErisimBilgisi(db),
        });
    }

    /* ==================================================================== */
    /* Kategoriler (13.10.2026)                                             */
    /* ==================================================================== */

    /* Departman kendi cihaz kategorilerini açar, düzenler, siler. Cihazın
       türü serbest metin olarak kalıyor; kategori listesi formda öneri
       olarak çıkıyor. Ad değişince o departmanın cihazlarının türü de
       değişiyor. */
    private TanimYetkisi.Kapsam _kategoriKapsami;
    private TanimYetkisi.Kapsam KategoriKapsami =>
        _kategoriKapsami ??= HttpContext.RequestServices.GetRequiredService<TanimYetkisi>().Al(User, "envanter");

    [HttpGet("Kategoriler")]
    public IActionResult Kategoriler()
    {
        if (!Yetkili()) return Forbid();

        var k = KategoriKapsami;
        using var db = _vt.Baglanti();

        var deps = k.Departmanlar.DefaultIfEmpty(-1).ToList();
        var hepsi = k.Hepsi ? 1 : 0;

        var kategoriler = db.Query(@"
SELECT K.id, K.ad, K.departman_id AS departmanId, D.ad AS departman, K.aciklama,
       K.bakim_araligi AS bakimAraligi, K.aktif, K.sira,
       (SELECT COUNT(*) FROM B360_ENVANTER E
         WHERE LTRIM(RTRIM(E.tur)) = LTRIM(RTRIM(K.ad))
           AND (K.departman_id IS NULL OR E.departman_id = K.departman_id)) AS cihazSayisi
FROM B360_ENVANTER_KATEGORI K
    LEFT JOIN B360_DEPARTMAN D ON D.id = K.departman_id
WHERE @hepsi = 1 OR K.departman_id IN @deps OR K.departman_id IS NULL
ORDER BY K.sira, K.ad", new { hepsi, deps }).ToList();

        /* Henüz kategori olarak tanımlanmamış ama cihazlarda kullanılan
           türler: departman bunları tek tıkla kategoriye çevirebilsin */
        var tanimsiz = db.Query(@"
SELECT LTRIM(RTRIM(E.tur)) AS ad, COUNT(*) AS cihazSayisi
FROM B360_ENVANTER E
WHERE LTRIM(RTRIM(ISNULL(E.tur, N''))) <> N''
  AND (@hepsi = 1 OR E.departman_id IN @deps)
  AND NOT EXISTS (SELECT 1 FROM B360_ENVANTER_KATEGORI K WHERE LTRIM(RTRIM(K.ad)) = LTRIM(RTRIM(E.tur)))
GROUP BY LTRIM(RTRIM(E.tur))
ORDER BY 1", new { hepsi, deps }).ToList();

        var departmanlar = db.Query(@"
SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 AND (@hepsi = 1 OR id IN @deps) ORDER BY sira, ad",
            new { hepsi, deps }).ToList();

        return Ok(new
        {
            kategoriler = kategoriler.Select(x => new
            {
                x.id, x.ad, x.departmanId, x.departman, x.aciklama, x.bakimAraligi, x.aktif, x.sira, x.cihazSayisi,
                duzenler = k.Acik((int?)x.departmanId),
            }),
            tanimsiz,
            departmanlar,
            hepsi = k.Hepsi,
            yonetir = k.Var,
        });
    }

    public class KategoriGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public int? DepartmanId { get; set; }
        public string Aciklama { get; set; }
        public int? BakimAraligi { get; set; }
        public bool Aktif { get; set; } = true;
        public int Sira { get; set; }
    }

    [HttpPost("Kategori")]
    public IActionResult KategoriKaydet([FromBody] KategoriGirdi g)
    {
        if (!Yetkili()) return Forbid();

        var k = KategoriKapsami;
        if (!k.Var) return StatusCode(403, new { hata = "Kategori tanımlama yetkiniz yok." });

        var ad = (g?.Ad ?? "").Trim();
        if (ad.Length < 2) return BadRequest(new { hata = "Kategori adını yazınız." });
        if (ad.Length > 100) ad = ad[..100];

        var dep = g.DepartmanId is > 0 ? g.DepartmanId : null;
        if (!k.Acik(dep))
            return BadRequest(new { hata = dep is null ? "Genel kategori tanımlama yetkiniz yok; departmanınızı seçiniz." : "Bu departmana kategori tanımlama yetkiniz yok." });

        if (g.BakimAraligi is < 0 or > 120) return BadRequest(new { hata = "Bakım aralığı 0–120 ay olmalıdır." });

        using var db = _vt.Baglanti();

        if (db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM B360_ENVANTER_KATEGORI
WHERE LTRIM(RTRIM(ad)) = @ad AND id <> @Id AND ISNULL(departman_id, 0) = ISNULL(@dep, 0)", new { ad, g.Id, dep }) > 0)
            return BadRequest(new { hata = $"\"{ad}\" adında bir kategori zaten var." });

        if (g.Id > 0)
        {
            var eski = db.QueryFirstOrDefault("SELECT ad, departman_id AS dep FROM B360_ENVANTER_KATEGORI WHERE id = @Id", new { g.Id });
            if (eski is null) return NotFound(new { hata = "Kategori bulunamadı." });
            if (!k.Acik((int?)eski.dep)) return StatusCode(403, new { hata = "Bu kategoriyi düzenleme yetkiniz yok." });

            db.Execute(@"
UPDATE B360_ENVANTER_KATEGORI
SET ad = @ad, departman_id = @dep, aciklama = @aciklama, bakim_araligi = @BakimAraligi,
    aktif = @Aktif, sira = @Sira, guncelleyen = @yapan
WHERE id = @Id", new { ad, dep, aciklama = g.Aciklama?.Trim(), g.BakimAraligi, g.Aktif, g.Sira, yapan = Kullanici, g.Id });

            /* Ad değiştiyse cihazların türü de değişsin: listede eski ad
               ayrı bir kategori gibi kalmasın */
            var eskiAd = ((string)eski.ad ?? "").Trim();
            if (!string.Equals(eskiAd, ad, StringComparison.Ordinal))
            {
                var n = db.Execute(@"
UPDATE B360_ENVANTER SET tur = @ad
WHERE LTRIM(RTRIM(tur)) = @eskiAd AND (@eskiDep IS NULL OR departman_id = @eskiDep)",
                    new { ad, eskiAd, eskiDep = (int?)eski.dep });

                _kayit.LogInformation("Envanter kategorisi yeniden adlandırıldı: {Eski} → {Yeni} ({N} cihaz) · {Yapan}", eskiAd, ad, n, Kullanici);
            }

            return Ok(new { basarili = true, id = g.Id });
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ENVANTER_KATEGORI (ad, departman_id, aciklama, bakim_araligi, aktif, sira, guncelleyen)
OUTPUT INSERTED.id VALUES (@ad, @dep, @aciklama, @BakimAraligi, @Aktif, @Sira, @yapan)",
            new { ad, dep, aciklama = g.Aciklama?.Trim(), g.BakimAraligi, g.Aktif, g.Sira, yapan = Kullanici });

        return Ok(new { basarili = true, id });
    }

    /// <summary>Cihazı olan kategori silinmez, pasife alınır.</summary>
    [HttpDelete("Kategori/{id:int}")]
    public IActionResult KategoriSil(int id)
    {
        if (!Yetkili()) return Forbid();

        var k = KategoriKapsami;
        using var db = _vt.Baglanti();

        var kat = db.QueryFirstOrDefault("SELECT ad, departman_id AS dep FROM B360_ENVANTER_KATEGORI WHERE id = @id", new { id });
        if (kat is null) return NotFound(new { hata = "Kategori bulunamadı." });
        if (!k.Acik((int?)kat.dep)) return StatusCode(403, new { hata = "Bu kategoriyi silme yetkiniz yok." });

        var cihaz = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM B360_ENVANTER
WHERE LTRIM(RTRIM(tur)) = LTRIM(RTRIM(@ad)) AND (@dep IS NULL OR departman_id = @dep)",
            new { ad = (string)kat.ad, dep = (int?)kat.dep });

        if (cihaz > 0)
        {
            db.Execute("UPDATE B360_ENVANTER_KATEGORI SET aktif = 0 WHERE id = @id", new { id });
            return Ok(new { basarili = true, bilgi = $"Bu kategoride {cihaz} cihaz olduğu için silinmedi, pasife alındı." });
        }

        db.Execute("DELETE FROM B360_ENVANTER_KATEGORI WHERE id = @id", new { id });
        return Ok(new { basarili = true });
    }

    /// <summary>Mağaza listesi (personel kartındaki iş grubu adları).</summary>
    [HttpGet("Subeler")]
    public IActionResult SubeListesi()
    {
        if (!Yetkili()) return Forbid();

        var kilit = Kapsam().Sube;

        return Ok(kilit is null ? Subeler() : new List<string> { kilit });
    }

    /// <summary>
    /// Kaynak Mikro'daki iş grubu tanımları: arıza kaydında mağaza
    /// eşleşmesi personelin iş grubu üzerinden yapılıyor, envanterin de
    /// aynı kaynağı kullanması gerekiyor.
    /// </summary>
    private List<string> Subeler()
    {
        try
        {
            using var db = _vt.PersonelBaglantisi();

            return db.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(PIG.ig_adi))
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
WHERE LTRIM(RTRIM(ISNULL(PIG.ig_adi, ''))) <> ''
  AND (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) < 1950)",
                commandTimeout: 60)
                .OrderBy(x => x, StringComparer.Create(Tr, true))
                .ToList();
        }
        catch
        {
            /* Personel veritabanına ulaşılamazsa ekran yine açılsın */
            return new List<string>();
        }
    }

    /* ==================================================================== */
    /* Ayrıntı                                                              */
    /* ==================================================================== */

    /// <summary>Cihaz, arızaları, tamir geçmişi, notlar, konumlar, aktiviteler, belgeler.</summary>
    [HttpGet("{id:int}")]
    public IActionResult Detay(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        if (!Erisilir(db, id)) return Yok();

        return Ok(DetayCevap(db, id));
    }

    private object DetayCevap(IDbConnection db, int id)
    {
        var e = Kapsam();

        var cihaz = (IDictionary<string, object>)db.QueryFirstOrDefault($@"
SELECT {CihazAlanlari}
FROM B360_ENVANTER E
    LEFT JOIN B360_DEPARTMAN D ON E.departman_id = D.id
    LEFT JOIN B360_ENVANTER  U ON E.ust_cihaz_id = U.id
WHERE E.id = @id", new { id });

        if (!e.Maliyet) cihaz["alisBedeli"] = null;

        var arizalar = db.Query(@"
SELECT A.id, A.baslik, A.akis_ozet AS akisOzet, A.durum, A.oncelik,
       A.olusturma, T.ad AS tur, F.form_no AS formNo,
       CASE WHEN @maliyet = 1 THEN F.toplam END AS servisToplam
FROM B360_ARIZA A
    LEFT JOIN B360_ARIZA_TUR T ON A.tur_id = T.id
    LEFT JOIN B360_SERVIS_FORM F ON F.ariza_id = A.id
WHERE A.envanter_id = @id
ORDER BY A.olusturma DESC", new { id, maliyet = e.Maliyet }).ToList();

        var gorseller = db.Query(@"
SELECT id, ozgun_ad AS ozgunAd, boyut, kapak, olusturma
FROM B360_ENVANTER_GORSEL WHERE envanter_id = @id
ORDER BY kapak DESC, id", new { id }).ToList();

        var tamirler = db.Query(@"
SELECT T.id, T.tarih, T.tur, T.ariza_id AS arizaId, A.baslik AS arizaBaslik,
       T.firma, T.yapan, T.gun_disi AS gunDisi, T.kalemler, T.kdv, T.garantide,
       T.fatura_no AS faturaNo, T.aciklama, T.ara_toplam AS araToplam, T.toplam,
       T.olusturan_adi AS olusturanAdi, T.olusturma, T.asama, T.asama_tarih AS asamaTarih,
       (SELECT COUNT(*) FROM B360_ENVANTER_BELGE B WHERE B.tamir_id = T.id) AS belgeSayisi
FROM B360_ENVANTER_TAMIR T
    LEFT JOIN B360_ARIZA A ON A.id = T.ariza_id
WHERE T.envanter_id = @id
ORDER BY T.tarih DESC, T.id DESC", new { id })
            .Select(x =>
            {
                var d = (IDictionary<string, object>)x;
                var kalemler = KalemOku(d["kalemler"] as string);

                if (!e.Maliyet)
                {
                    foreach (var k in kalemler) k.Birim = 0;
                    d["araToplam"] = null;
                    d["toplam"] = null;
                }

                d["kalemler"] = kalemler.Select(k => new { ad = k.Ad, tip = k.Tip, adet = k.Adet, birim = e.Maliyet ? k.Birim : (decimal?)null });
                return d;
            })
            .ToList();

        var servisFormlari = db.Query(@"
SELECT F.id, F.form_no AS formNo, F.olusturma, F.mudahale, F.yapilan_islem AS yapilanIslem,
       F.tespit, F.teknisyen, F.servis_firma AS servisFirma,
       CASE WHEN @maliyet = 1 THEN F.parca_tutari END AS parcaTutari,
       CASE WHEN @maliyet = 1 THEN F.iscilik END AS iscilik,
       CASE WHEN @maliyet = 1 THEN F.toplam END AS toplam,
       F.olusturan_adi AS olusturanAdi, A.id AS arizaId, A.baslik AS arizaBaslik
FROM B360_SERVIS_FORM F
    LEFT JOIN B360_ARIZA A ON A.id = F.ariza_id
WHERE F.envanter_id = @id
ORDER BY F.olusturma DESC", new { id, maliyet = e.Maliyet }).ToList();

        var hareketler = db.Query(@"
SELECT TOP 300 id, tur, metin, yapan_adi AS yapanAdi, tarih
FROM B360_ENVANTER_HAREKET WHERE envanter_id = @id ORDER BY id DESC", new { id }).ToList();

        var konumlar = db.Query(@"
SELECT id, sube_kodu AS subeKodu, konum, notu, yapan_adi AS yapanAdi, tarih
FROM B360_ENVANTER_KONUM WHERE envanter_id = @id ORDER BY id DESC", new { id }).ToList();

        var aktiviteler = db.Query(@"
SELECT id, tur, tarih, ozet, atanan, olusturan
FROM B360_ENVANTER_AKTIVITE WHERE envanter_id = @id AND bitti = 0 ORDER BY tarih, id", new { id }).ToList();

        /* Şube kullanıcısı fatura görmüyor (tutar içeriyor) */
        var belgeler = db.Query(@"
SELECT id, tur, ozgun_ad AS ozgunAd, boyut, tamir_id AS tamirId, yukleyen, olusturma
FROM B360_ENVANTER_BELGE
WHERE envanter_id = @id AND (@maliyet = 1 OR tur <> N'Fatura')
ORDER BY id DESC", new { id, maliyet = e.Maliyet }).ToList();

        return new
        {
            cihaz, arizalar, gorseller, tamirler, servisFormlari, hareketler,
            konumlar, aktiviteler, belgeler, erisim = ErisimBilgisi(db),
        };
    }

    /* ==================================================================== */
    /* Kaydetme                                                             */
    /* ==================================================================== */

    private static readonly (string Alan, string Ad)[] IzlenenAlanlar =
    {
        ("tur", "Kategori"), ("marka", "Marka"), ("model", "Model"), ("seri_no", "Seri no"),
        ("sicil_no", "Demirbaş no"), ("sahibi", "Zimmetli"), ("konum", "Konum"),
        ("tedarikci", "Tedarikçi"), ("alis_tarihi", "Alış tarihi"), ("alis_bedeli", "Alış bedeli"),
        ("ekonomik_omur", "Ekonomik ömür"), ("garanti_bitis", "Garanti bitişi"),
        ("garanti_saglayici", "Garanti veren"), ("bakim_araligi", "Bakım aralığı"),
        ("bakim_firmasi", "Bakım firması"), ("sonraki_bakim", "Sonraki bakım"),
    };

    private static string Metin(object v) => v switch
    {
        null => "—",
        DateTime t => t.ToString("dd.MM.yyyy"),
        decimal d => Lira(d),
        string s when string.IsNullOrWhiteSpace(s) => "—",
        _ => v.ToString(),
    };

    [HttpPost]
    public IActionResult Kaydet([FromBody] EnvanterGirdi girdi)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        if (girdi is null) return BadRequest(new { hata = "Bilgiler eksik." });

        var e = Kapsam();

        /* Şube kullanıcısı yalnızca kendi şubesine cihaz ekleyip düzenliyor */
        if (e.Sube is not null) girdi.SubeKodu = e.Sube;

        if (string.IsNullOrWhiteSpace(girdi.SubeKodu))
            return BadRequest(new { hata = "Şube seçiniz." });

        if (string.IsNullOrWhiteSpace(girdi.Tur) && string.IsNullOrWhiteSpace(girdi.Marka) &&
            string.IsNullOrWhiteSpace(girdi.Model) && string.IsNullOrWhiteSpace(girdi.SeriNo))
            return BadRequest(new { hata = "Cihazı tanımlayan en az bir alan giriniz (kategori, marka, model ya da seri no)." });

        var durum = string.IsNullOrWhiteSpace(girdi.Durum) ? "aktif" : girdi.Durum.Trim();
        if (!Durumlar.Contains(durum)) return BadRequest(new { hata = "Geçersiz durum." });

        if (girdi.AlisBedeli is < 0) return BadRequest(new { hata = "Alış bedeli eksi olamaz." });
        if (girdi.EkonomikOmur is < 0 or > 600) return BadRequest(new { hata = "Ekonomik ömür 0–600 ay olabilir." });

        using var db = _vt.Baglanti();

        IDictionary<string, object> eski = null;

        if (girdi.Id > 0)
        {
            if (!Erisilir(db, girdi.Id)) return Yok();

            eski = (IDictionary<string, object>)db.QueryFirstOrDefault(
                "SELECT * FROM B360_ENVANTER WHERE id = @Id", new { girdi.Id });
        }

        /* Departman: kendi departmanlarından biri olmalı. Tek departmanı
           olan kullanıcıda seçilmemişse o yazılıyor. */
        int? departman = girdi.DepartmanId > 0 ? girdi.DepartmanId : null;

        if (!e.Tumu && e.Sube is null)
        {
            if (departman is null && e.Departmanlar.Count == 1) departman = e.Departmanlar[0];

            if (departman is null || !e.Departmanlar.Contains(departman.Value))
                return BadRequest(new { hata = "Sorumlu birim olarak kendi departmanınızı seçiniz." });
        }

        /* Şube kullanıcısı departmanı ve alış bedelini değiştiremiyor */
        if (e.Sube is not null && eski is not null)
            departman = eski["departman_id"] as int?;

        var alisBedeli = e.Maliyet ? girdi.AlisBedeli : eski?["alis_bedeli"] as decimal?;

        var garantiBitis = girdi.GarantiBitis;
        if (garantiBitis is null && girdi.GarantiBaslangic is not null && girdi.GarantiAy is > 0)
            garantiBitis = girdi.GarantiBaslangic.Value.AddMonths(girdi.GarantiAy.Value);

        var sonrakiBakim = girdi.SonrakiBakim;
        if (sonrakiBakim is null && girdi.SonBakim is not null && girdi.BakimAraligi is > 0)
            sonrakiBakim = girdi.SonBakim.Value.AddDays(girdi.BakimAraligi.Value);

        /* Aralık değişti ve son bakım belli: sonraki bakım yeniden hesaplanıyor */
        if (eski is not null && girdi.SonBakim is not null && girdi.BakimAraligi is > 0 &&
            (eski["bakim_araligi"] as int?) != girdi.BakimAraligi)
            sonrakiBakim = girdi.SonBakim.Value.AddDays(girdi.BakimAraligi.Value);

        if (girdi.BakimAraligi is null or 0) sonrakiBakim = girdi.SonrakiBakim;

        var deger = new
        {
            girdi.Id,
            SubeKodu = girdi.SubeKodu.Trim(),
            Tur = Bos(girdi.Tur), Marka = Bos(girdi.Marka), Model = Bos(girdi.Model),
            SeriNo = Bos(girdi.SeriNo), SicilNo = Bos(girdi.SicilNo), Sahibi = Bos(girdi.Sahibi), Konum = Bos(girdi.Konum),
            DepartmanId = departman,
            UstCihazId = girdi.UstCihazId > 0 && girdi.UstCihazId != girdi.Id ? girdi.UstCihazId : (int?)null,
            Tedarikci = Bos(girdi.Tedarikci), girdi.AlisTarihi,
            GarantiVar = girdi.GarantiVar || garantiBitis is not null,
            girdi.GarantiBaslangic, girdi.GarantiAy, GarantiBitis = garantiBitis,
            GarantiSaglayici = Bos(girdi.GarantiSaglayici), girdi.GarantiNotu,
            girdi.SonBakim, SonrakiBakim = sonrakiBakim, girdi.BakimAraligi,
            BakimFirmasi = Bos(girdi.BakimFirmasi), girdi.BakimNotu,
            Etiketler = girdi.Etiketler is { Count: > 0 }
                ? string.Join(",", girdi.Etiketler.Select(x => x?.Trim().Replace(",", " ")).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct())
                : null,
            girdi.Notlar,
            Durum = durum,
            AlisBedeli = alisBedeli,
            girdi.EkonomikOmur,
            girdi.KapakKirp,
        };

        db.Open();
        using var tx = db.BeginTransaction();

        int id;

        if (eski is not null)
        {
            id = girdi.Id;

            db.Execute(@"
UPDATE B360_ENVANTER SET
    sube_kodu = @SubeKodu, tur = @Tur, marka = @Marka, model = @Model,
    seri_no = @SeriNo, sicil_no = @SicilNo, sahibi = @Sahibi, konum = @Konum,
    departman_id = @DepartmanId, ust_cihaz_id = @UstCihazId,
    tedarikci = @Tedarikci, alis_tarihi = @AlisTarihi,
    garanti_var = @GarantiVar, garanti_baslangic = @GarantiBaslangic,
    garanti_ay = @GarantiAy, garanti_bitis = @GarantiBitis,
    garanti_saglayici = @GarantiSaglayici, garanti_notu = @GarantiNotu,
    son_bakim = @SonBakim, sonraki_bakim = @SonrakiBakim,
    bakim_araligi = @BakimAraligi, bakim_firmasi = @BakimFirmasi,
    bakim_notu = @BakimNotu,
    etiketler = @Etiketler, notlar = @Notlar, durum = @Durum,
    alis_bedeli = @AlisBedeli, ekonomik_omur = @EkonomikOmur, kapak_kirp = @KapakKirp
WHERE id = @Id", deger, tx);

            var yeni = (IDictionary<string, object>)db.QueryFirstOrDefault(
                "SELECT * FROM B360_ENVANTER WHERE id = @id", new { id }, tx);

            /* Değişiklik geçmişi */
            var ozet = new List<string>();

            if (!Equals(eski["durum"], yeni["durum"]))
                ozet.Add($"Durum: {DurumAdi.GetValueOrDefault((string)eski["durum"], (string)eski["durum"])} → {DurumAdi[(string)yeni["durum"]]}");

            if (!string.Equals(((string)eski["sube_kodu"])?.Trim(), (string)yeni["sube_kodu"], StringComparison.OrdinalIgnoreCase))
            {
                ozet.Add($"Şube: {eski["sube_kodu"]} → {yeni["sube_kodu"]}");
                KonumYaz(db, id, (string)yeni["sube_kodu"], (string)yeni["konum"], "Şube değişti", tx);
            }

            if (!Equals(eski["departman_id"], yeni["departman_id"]))
            {
                var ad = db.ExecuteScalar<string>("SELECT ad FROM B360_DEPARTMAN WHERE id = @d", new { d = yeni["departman_id"] }, tx);
                ozet.Add($"Sorumlu birim: {ad ?? "—"}");
            }

            foreach (var (alan, ad) in IzlenenAlanlar)
            {
                if (alan == "alis_bedeli" && !e.Maliyet) continue;
                var a = eski.TryGetValue(alan, out var x) ? x : null;
                var b = yeni.TryGetValue(alan, out var y) ? y : null;
                if (Metin(a) != Metin(b)) ozet.Add($"{ad}: {Metin(a)} → {Metin(b)}");
            }

            if (!string.Equals((string)eski["etiketler"] ?? "", (string)yeni["etiketler"] ?? ""))
                ozet.Add("Etiketler güncellendi");

            if (ozet.Count > 0) Gecmis(db, id, string.Join(" · ", ozet), tx: tx);
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ENVANTER
    (sube_kodu, tur, marka, model, seri_no, sicil_no, sahibi, konum,
     departman_id, ust_cihaz_id, tedarikci, alis_tarihi,
     garanti_var, garanti_baslangic, garanti_ay, garanti_bitis,
     garanti_saglayici, garanti_notu,
     son_bakim, sonraki_bakim, bakim_araligi, bakim_firmasi, bakim_notu,
     etiketler, notlar, durum, alis_bedeli, ekonomik_omur, kapak_kirp)
OUTPUT INSERTED.id
VALUES
    (@SubeKodu, @Tur, @Marka, @Model, @SeriNo, @SicilNo, @Sahibi, @Konum,
     @DepartmanId, @UstCihazId, @Tedarikci, @AlisTarihi,
     @GarantiVar, @GarantiBaslangic, @GarantiAy, @GarantiBitis,
     @GarantiSaglayici, @GarantiNotu,
     @SonBakim, @SonrakiBakim, @BakimAraligi, @BakimFirmasi, @BakimNotu,
     @Etiketler, @Notlar, @Durum, @AlisBedeli, @EkonomikOmur, @KapakKirp)", deger, tx);

            Gecmis(db, id, "Cihaz oluşturuldu", tx: tx);
            KonumYaz(db, id, deger.SubeKodu, deger.Konum, "İlk kayıt", tx);
        }

        tx.Commit();

        return Ok(new { basarili = true, id, ayrinti = DetayCevap(db, id) });
    }

    private void KonumYaz(IDbConnection db, int id, string sube, string konum, string notu, IDbTransaction tx = null) =>
        db.Execute(@"
INSERT INTO B360_ENVANTER_KONUM (envanter_id, sube_kodu, konum, notu, yapan_adi)
VALUES (@id, @sube, @konum, @notu, @ad)", new { id, sube, konum, notu, ad = AdSoyad }, tx);

    /// <summary>Durumu değiştirir (form üstündeki durum çubuğu, kanban sürükleme).</summary>
    [HttpPost("{id:int}/Durum")]
    public IActionResult DurumDegistir(int id, [FromBody] DurumGirdi girdi)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });
        if (girdi is null || !Durumlar.Contains(girdi.Durum)) return BadRequest(new { hata = "Geçersiz durum." });

        using var db = _vt.Baglanti();
        if (!Erisilir(db, id)) return Yok();

        var eski = db.ExecuteScalar<string>("SELECT durum FROM B360_ENVANTER WHERE id = @id", new { id });

        if (eski != girdi.Durum)
        {
            db.Execute("UPDATE B360_ENVANTER SET durum = @d WHERE id = @id", new { id, d = girdi.Durum });
            Gecmis(db, id, $"Durum: {DurumAdi.GetValueOrDefault(eski, eski)} → {DurumAdi[girdi.Durum]}");
        }

        return Ok(new { basarili = true });
    }

    /// <summary>Başka şubeye taşır; konum geçmişine yazılır.</summary>
    [HttpPost("{id:int}/Tasi")]
    public IActionResult Tasi(int id, [FromBody] TasiGirdi girdi)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });
        if (Kapsam().Sube is not null) return BadRequest(new { hata = "Şube kullanıcısı cihazı başka şubeye taşıyamaz." });
        if (string.IsNullOrWhiteSpace(girdi?.SubeKodu)) return BadRequest(new { hata = "Şube seçiniz." });

        using var db = _vt.Baglanti();
        if (!Erisilir(db, id)) return Yok();

        var eski = db.QueryFirst("SELECT sube_kodu AS sube, konum FROM B360_ENVANTER WHERE id = @id", new { id });
        var sube = girdi.SubeKodu.Trim();
        var konum = Bos(girdi.Konum) ?? (string)eski.konum;

        db.Execute("UPDATE B360_ENVANTER SET sube_kodu = @sube, konum = @konum WHERE id = @id", new { id, sube, konum });
        KonumYaz(db, id, sube, konum, Bos(girdi.Notu) ?? "Transfer");
        Gecmis(db, id, $"Şube: {eski.sube} → {sube}{(Bos(girdi.Notu) is { } n ? " · " + n : "")}");

        return Ok(new { basarili = true });
    }

    /// <summary>Listeden toplu işlem: şubeye taşı, durum değiştir, bakım yapıldı.</summary>
    [HttpPost("Toplu")]
    public IActionResult Toplu([FromBody] TopluGirdi girdi)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        var idler = (girdi?.Idler ?? new List<int>()).Distinct().Take(500).ToList();
        if (idler.Count == 0) return BadRequest(new { hata = "Cihaz seçiniz." });

        var e = Kapsam();

        if (!string.IsNullOrWhiteSpace(girdi.SubeKodu) && e.Sube is not null)
            return BadRequest(new { hata = "Şube kullanıcısı cihazı başka şubeye taşıyamaz." });

        if (!string.IsNullOrWhiteSpace(girdi.Durum) && !Durumlar.Contains(girdi.Durum))
            return BadRequest(new { hata = "Geçersiz durum." });

        if (girdi.Bakim && !e.Maliyet)
            return BadRequest(new { hata = "Bakım kaydını departmanlar girer." });

        using var db = _vt.Baglanti();

        var izinli = db.Query<int>($"SELECT E.id FROM B360_ENVANTER E WHERE E.id IN @idler AND {e.Kosul}",
            P(new { idler })).ToList();

        foreach (var id in izinli)
        {
            if (!string.IsNullOrWhiteSpace(girdi.SubeKodu))
            {
                var sube = girdi.SubeKodu.Trim();
                var eski = db.QueryFirst("SELECT sube_kodu AS sube, konum FROM B360_ENVANTER WHERE id = @id", new { id });

                if (!string.Equals(((string)eski.sube)?.Trim(), sube, StringComparison.OrdinalIgnoreCase))
                {
                    db.Execute("UPDATE B360_ENVANTER SET sube_kodu = @sube WHERE id = @id", new { id, sube });
                    KonumYaz(db, id, sube, (string)eski.konum, "Toplu transfer");
                    Gecmis(db, id, $"Şube: {eski.sube} → {sube} (toplu)");
                }
            }

            if (!string.IsNullOrWhiteSpace(girdi.Durum))
            {
                var eski = db.ExecuteScalar<string>("SELECT durum FROM B360_ENVANTER WHERE id = @id", new { id });

                if (eski != girdi.Durum)
                {
                    db.Execute("UPDATE B360_ENVANTER SET durum = @d WHERE id = @id", new { id, d = girdi.Durum });
                    Gecmis(db, id, $"Durum: {DurumAdi.GetValueOrDefault(eski, eski)} → {DurumAdi[girdi.Durum]} (toplu)");
                }
            }

            if (girdi.Bakim)
            {
                var c = db.QueryFirst("SELECT bakim_firmasi AS firma, bakim_araligi AS aralik FROM B360_ENVANTER WHERE id = @id", new { id });
                var bugun = DateTime.Today;

                db.Execute(@"
INSERT INTO B360_ENVANTER_TAMIR (envanter_id, tarih, tur, firma, yapan, kalemler, kdv, olusturan, olusturan_adi)
VALUES (@id, @bugun, N'bakim', @firma, N'ic', N'[]', 20, @k, @ad)",
                    new { id, bugun, firma = (string)c.firma, k = Kullanici, ad = AdSoyad });

                db.Execute(@"
UPDATE B360_ENVANTER SET son_bakim = @bugun,
    sonraki_bakim = CASE WHEN ISNULL(bakim_araligi, 0) > 0 THEN DATEADD(day, bakim_araligi, @bugun) ELSE sonraki_bakim END
WHERE id = @id", new { id, bugun });

                Gecmis(db, id, "Bakım kaydı girildi (toplu)");
            }
        }

        return Ok(new { basarili = true, adet = izinli.Count });
    }

    /* ==================================================================== */
    /* Tamir, bakım, parça, kalibrasyon                                     */
    /* ==================================================================== */

    public sealed class Kalem
    {
        public string Ad { get; set; }
        public string Tip { get; set; }
        public decimal Adet { get; set; }
        public decimal Birim { get; set; }
    }

    private static readonly JsonSerializerOptions Js = new(JsonSerializerDefaults.Web);

    private static List<Kalem> KalemOku(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();

        try
        {
            return JsonSerializer.Deserialize<List<Kalem>>(json, Js) ?? new();
        }
        catch
        {
            return new();
        }
    }

    /// <summary>
    /// Tamir kaydı ekler ya da düzenler.
    ///
    /// <para>
    /// Tutarlar sunucuda hesaplanıyor (kalemler × KDV). "Garanti
    /// kapsamında" işaretliyse kayıt tutarıyla duruyor ama maliyete
    /// eklenmiyor. <c>DurumGuncelle</c>: arızalı / bakımdaki cihaz
    /// "Çalışıyor" yapılır; bakım ve kalibrasyonda son bakım yazılır,
    /// sonraki bakım aralıktan hesaplanır.
    /// </para>
    /// </summary>
    [HttpPost("{id:int}/Tamir")]
    public IActionResult TamirKaydet(int id, [FromBody] TamirGirdi g)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });
        if (!Kapsam().Maliyet) return BadRequest(new { hata = "Tamir ve maliyet kayıtlarını departmanlar girer." });
        if (g is null) return BadRequest(new { hata = "Bilgiler eksik." });

        if (!TamirTurleri.Contains(g.Tur)) return BadRequest(new { hata = "İş türünü seçiniz." });
        if (g.Tarih is null || g.Tarih > DateTime.Today.AddDays(1)) return BadRequest(new { hata = "Tarih geçersiz." });
        var asama = TamirAsamalari.Contains(g.Asama) ? g.Asama : "tamamlandi";

        /* Merkezde bekleyen cihazın firması henüz belli olmayabilir */
        if (string.IsNullOrWhiteSpace(g.Firma) && asama != "merkezde")
            return BadRequest(new { hata = asama == "firmada" ? "Cihazın gönderildiği firmayı yazınız." : "Servis ya da firma adını yazınız." });
        if (g.Kdv is not (0 or 1 or 10 or 20)) return BadRequest(new { hata = "KDV oranı geçersiz." });
        if (g.GunDisi is < 0 or > 3650) return BadRequest(new { hata = "Hizmet dışı süre geçersiz." });

        var kalemler = (g.Kalemler ?? new List<Kalem>())
            .Where(k => !string.IsNullOrWhiteSpace(k?.Ad) || k?.Birim > 0)
            .Select(k => new Kalem
            {
                Ad = (k.Ad ?? "").Trim() is { Length: > 0 } a ? (a.Length > 200 ? a[..200] : a) : "Kalem",
                Tip = k.Tip is "parca" or "iscilik" or "diger" ? k.Tip : "diger",
                Adet = k.Adet <= 0 ? 1 : Math.Round(k.Adet, 2),
                Birim = Math.Max(0, Math.Round(k.Birim, 2)),
            })
            .ToList();

        if (kalemler.Count > 60) return BadRequest(new { hata = "En fazla 60 kalem girilebilir." });

        var ara = Math.Round(kalemler.Sum(k => k.Adet * k.Birim), 2);
        var toplam = Math.Round(ara * (1 + g.Kdv / 100m), 2);

        using var db = _vt.Baglanti();
        if (!Erisilir(db, id)) return Yok();

        int? arizaId = g.ArizaId is > 0 && db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_ARIZA WHERE id = @a AND envanter_id = @id", new { a = g.ArizaId, id }) > 0
            ? g.ArizaId : null;

        var p = new
        {
            id, tid = g.Id, tarih = g.Tarih.Value.Date, tur = g.Tur, arizaId,
            firma = Bos(g.Firma) is { } fi && fi.Length > 200 ? fi[..200] : Bos(g.Firma), yapan = g.Yapan == "ic" ? "ic" : "dis", gunDisi = g.GunDisi,
            asama,
            kalemler = JsonSerializer.Serialize(kalemler, Js), kdv = g.Kdv, garantide = g.Garantide,
            faturaNo = Bos(g.FaturaNo), aciklama = Bos(g.Aciklama) is { } ac && ac.Length > 2000 ? ac[..2000] : Bos(g.Aciklama),
            ara, toplam, k = Kullanici, ad = AdSoyad,
        };

        db.Open();
        using var tx = db.BeginTransaction();

        int tid;
        string eskiAsama = null;

        if (g.Id > 0)
        {
            eskiAsama = db.ExecuteScalar<string>("SELECT asama FROM B360_ENVANTER_TAMIR WHERE id = @tid AND envanter_id = @id", new { tid = g.Id, id }, tx);

            var n = db.Execute(@"
UPDATE B360_ENVANTER_TAMIR SET tarih = @tarih, tur = @tur, ariza_id = @arizaId, firma = @firma,
    yapan = @yapan, gun_disi = @gunDisi, kalemler = @kalemler, kdv = @kdv, garantide = @garantide,
    fatura_no = @faturaNo, aciklama = @aciklama, ara_toplam = @ara, toplam = @toplam,
    asama_tarih = CASE WHEN asama <> @asama THEN SYSDATETIME() ELSE asama_tarih END, asama = @asama
WHERE id = @tid AND envanter_id = @id", p, tx);

            if (n == 0) return NotFound(new { hata = "Kayıt bulunamadı." });
            tid = g.Id;
        }
        else
        {
            tid = db.ExecuteScalar<int>(@"
INSERT INTO B360_ENVANTER_TAMIR (envanter_id, tarih, tur, ariza_id, firma, yapan, gun_disi, kalemler,
    kdv, garantide, fatura_no, aciklama, ara_toplam, toplam, olusturan, olusturan_adi, asama, asama_tarih)
OUTPUT INSERTED.id
VALUES (@id, @tarih, @tur, @arizaId, @firma, @yapan, @gunDisi, @kalemler,
    @kdv, @garantide, @faturaNo, @aciklama, @ara, @toplam, @k, @ad, @asama, SYSDATETIME())", p, tx);
        }

        if (eskiAsama != asama)
            Gecmis(db, id,
                $"Tamir: {(eskiAsama is null ? "" : $"{AsamaAdi.GetValueOrDefault(eskiAsama, eskiAsama)} → ")}{AsamaAdi[asama]}" +
                (asama == "firmada" && p.firma is { } gf ? $" ({gf})" : ""), tx: tx);

        Gecmis(db, id,
            $"{(g.Id > 0 ? "Tamir kaydı düzenlendi" : "Tamir kaydı eklendi")}: {TamirAdi[g.Tur]} · " +
            (g.Garantide ? "garanti kapsamında" : Lira(toplam)) +
            (p.faturaNo is { } f ? $" ({f})" : ""), tx: tx);

        /* Cihaz merkezde ya da firmadaysa çalışmıyor: "Bakımda" görünsün */
        if (g.DurumGuncelle && asama != "tamamlandi")
        {
            var c = db.QueryFirst<string>("SELECT durum FROM B360_ENVANTER WHERE id = @id", new { id }, tx);

            if (c == "aktif")
            {
                db.Execute("UPDATE B360_ENVANTER SET durum = N'bakimda' WHERE id = @id", new { id }, tx);
                Gecmis(db, id, $"Durum: {DurumAdi[c]} → {DurumAdi["bakimda"]}", tx: tx);
            }
        }
        else if (g.DurumGuncelle)
        {
            var c = db.QueryFirst("SELECT durum, bakim_araligi AS aralik FROM B360_ENVANTER WHERE id = @id", new { id }, tx);

            if ((string)c.durum is "arizali" or "bakimda")
            {
                db.Execute("UPDATE B360_ENVANTER SET durum = N'aktif' WHERE id = @id", new { id }, tx);
                Gecmis(db, id, $"Durum: {DurumAdi[(string)c.durum]} → Çalışıyor", tx: tx);
            }

            if (g.Tur is "bakim" or "kalibrasyon")
            {
                db.Execute(@"
UPDATE B360_ENVANTER SET son_bakim = @tarih,
    sonraki_bakim = CASE WHEN ISNULL(bakim_araligi, 0) > 0 THEN DATEADD(day, bakim_araligi, @tarih) ELSE sonraki_bakim END
WHERE id = @id AND (son_bakim IS NULL OR son_bakim <= @tarih)", new { id, tarih = p.tarih }, tx);
            }
        }

        tx.Commit();

        return Ok(new { id = tid, araToplam = ara, toplam, ayrinti = DetayCevap(db, id) });
    }

    [HttpDelete("Tamir/{tid:int}")]
    public IActionResult TamirSil(int tid)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });
        if (!Kapsam().Maliyet) return Forbid();

        using var db = _vt.Baglanti();

        var t = db.QueryFirstOrDefault("SELECT envanter_id AS id, tur, tarih FROM B360_ENVANTER_TAMIR WHERE id = @tid", new { tid });
        if (t is null || !Erisilir(db, (int)t.id)) return NotFound(new { hata = "Kayıt bulunamadı." });

        foreach (var dosya in db.Query<string>("SELECT dosya FROM B360_ENVANTER_BELGE WHERE tamir_id = @tid", new { tid }))
            DosyaSil(BelgeKlasoru(), dosya);

        db.Execute(@"
DELETE FROM B360_ENVANTER_BELGE WHERE tamir_id = @tid;
DELETE FROM B360_ENVANTER_TAMIR WHERE id = @tid;", new { tid });

        Gecmis(db, (int)t.id, $"Tamir kaydı silindi: {TamirAdi.GetValueOrDefault((string)t.tur, (string)t.tur)} · {((DateTime)t.tarih):dd.MM.yyyy}");

        return Ok(new { basarili = true, ayrinti = DetayCevap(db, (int)t.id) });
    }

    /* ==================================================================== */
    /* Notlar ve aktiviteler                                                */
    /* ==================================================================== */

    [HttpPost("{id:int}/Not")]
    public IActionResult NotEkle(int id, [FromBody] NotGirdi g)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        var metin = (g?.Metin ?? "").Trim();
        if (metin.Length == 0) return BadRequest(new { hata = "Not boş olamaz." });

        using var db = _vt.Baglanti();
        if (!Erisilir(db, id)) return Yok();

        Gecmis(db, id, metin, "not");

        return Ok(new { basarili = true });
    }

    [HttpPost("{id:int}/Aktivite")]
    public IActionResult AktiviteEkle(int id, [FromBody] AktiviteGirdi g)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        if (g is null || string.IsNullOrWhiteSpace(g.Ozet)) return BadRequest(new { hata = "Aktivitenin özetini yazınız." });
        if (g.Tur is not ("bakim" or "ara" or "yap")) return BadRequest(new { hata = "Geçersiz tür." });
        if (g.Tarih is null) return BadRequest(new { hata = "Tarih seçiniz." });

        using var db = _vt.Baglanti();
        if (!Erisilir(db, id)) return Yok();

        var ozet = g.Ozet.Trim();
        if (ozet.Length > 300) ozet = ozet[..300];

        db.Execute(@"
INSERT INTO B360_ENVANTER_AKTIVITE (envanter_id, tur, tarih, ozet, atanan, olusturan)
VALUES (@id, @tur, @tarih, @ozet, @atanan, @ad)",
            new { id, tur = g.Tur, tarih = g.Tarih.Value.Date, ozet, atanan = Bos(g.Atanan), ad = AdSoyad });

        Gecmis(db, id, $"Aktivite planlandı: {ozet} ({g.Tarih.Value:dd.MM.yyyy})");

        return Ok(new { basarili = true });
    }

    [HttpPost("Aktivite/{aid:int}/Bitti")]
    public IActionResult AktiviteBitti(int aid)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        using var db = _vt.Baglanti();

        var a = db.QueryFirstOrDefault("SELECT envanter_id AS id, ozet FROM B360_ENVANTER_AKTIVITE WHERE id = @aid AND bitti = 0", new { aid });
        if (a is null || !Erisilir(db, (int)a.id)) return NotFound(new { hata = "Aktivite bulunamadı." });

        db.Execute("UPDATE B360_ENVANTER_AKTIVITE SET bitti = 1 WHERE id = @aid", new { aid });
        Gecmis(db, (int)a.id, $"Aktivite tamamlandı: {a.ozet}");

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Belgeler                                                             */
    /* ==================================================================== */

    private static readonly string[] BelgeUzantilari =
        { ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx" };

    private static readonly string[] BelgeTurleri =
        { "Fatura", "Garanti belgesi", "Servis formu", "Muayene belgesi", "Sözleşme", "Kullanım kılavuzu", "Fotoğraf", "Diğer" };

    [HttpPost("{id:int}/Belge")]
    [RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> BelgeEkle(int id, IFormFile dosya, [FromForm] string tur, [FromForm] int? tamirId)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });
        if (dosya.Length > 20_000_000) return BadRequest(new { hata = "Belge en fazla 20 MB olabilir." });

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();
        if (!BelgeUzantilari.Contains(uzanti)) return BadRequest(new { hata = "PDF, resim, Word ya da Excel yükleyiniz." });

        tur = BelgeTurleri.Contains(tur) ? tur : "Diğer";
        if (tur == "Fatura" && !Kapsam().Maliyet) return BadRequest(new { hata = "Faturayı departmanlar yükler." });

        using var db = _vt.Baglanti();
        if (!Erisilir(db, id)) return Yok();

        if (tamirId is > 0 && db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM B360_ENVANTER_TAMIR WHERE id = @tamirId AND envanter_id = @id", new { tamirId, id }) == 0)
            tamirId = null;

        var diskAdi = $"belge_{id}_{Guid.NewGuid():N}{uzanti}";
        var klasor = BelgeKlasoru();

        try
        {
            Directory.CreateDirectory(klasor);
            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.CreateNew);
            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Cihaz belgesi yazılamadı: {Klasor}", klasor);
            return StatusCode(500, new { hata = "Belge kaydedilemedi." });
        }

        var ad = Path.GetFileName(dosya.FileName ?? "belge");
        if (ad.Length > 250) ad = ad[^250..];

        var bid = db.ExecuteScalar<int>(@"
INSERT INTO B360_ENVANTER_BELGE (envanter_id, tamir_id, tur, dosya, ozgun_ad, boyut, yukleyen)
OUTPUT INSERTED.id VALUES (@id, @tamirId, @tur, @diskAdi, @ad, @boyut, @y)",
            new { id, tamirId = tamirId > 0 ? tamirId : null, tur, diskAdi, ad, boyut = dosya.Length, y = AdSoyad });

        Gecmis(db, id, $"Belge eklendi: {ad} ({tur})");

        return Ok(new { id = bid });
    }

    /// <summary>Belgeyi döndürür; oturum başlıkla isteniyor, adreste jeton yok.</summary>
    [HttpGet("Belge/{bid:int}")]
    public IActionResult Belge(int bid)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var b = db.QueryFirstOrDefault("SELECT envanter_id AS id, tur, dosya, ozgun_ad AS ad FROM B360_ENVANTER_BELGE WHERE id = @bid", new { bid });
        if (b is null || !Erisilir(db, (int)b.id)) return NotFound(new { hata = "Belge bulunamadı." });
        if ((string)b.tur == "Fatura" && !Kapsam().Maliyet) return NotFound(new { hata = "Belge bulunamadı." });

        var dosya = (string)b.dosya;
        if (dosya.Contains('/') || dosya.Contains('\\') || dosya.Contains("..")) return BadRequest();

        var yol = Path.Combine(BelgeKlasoru(), dosya);
        if (!System.IO.File.Exists(yol)) return NotFound(new { hata = "Belge dosyası bulunamadı." });

        var mime = Path.GetExtension(dosya).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".png" => "image/png",
            ".webp" => "image/webp",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".doc" => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".xls" => "application/vnd.ms-excel",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            _ => "application/octet-stream",
        };

        Response.Headers["X-Content-Type-Options"] = "nosniff";

        return PhysicalFile(yol, mime, (string)b.ad ?? dosya);
    }

    [HttpDelete("Belge/{bid:int}")]
    public IActionResult BelgeSil(int bid)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        using var db = _vt.Baglanti();

        var b = db.QueryFirstOrDefault("SELECT envanter_id AS id, tur, dosya, ozgun_ad AS ad FROM B360_ENVANTER_BELGE WHERE id = @bid", new { bid });
        if (b is null || !Erisilir(db, (int)b.id)) return NotFound(new { hata = "Belge bulunamadı." });
        if ((string)b.tur == "Fatura" && !Kapsam().Maliyet) return Forbid();

        db.Execute("DELETE FROM B360_ENVANTER_BELGE WHERE id = @bid", new { bid });
        DosyaSil(BelgeKlasoru(), (string)b.dosya);
        Gecmis(db, (int)b.id, $"Belge silindi: {b.ad}");

        return Ok(new { basarili = true });
    }

    private void DosyaSil(string klasor, string dosya)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(dosya) || dosya.Contains('/') || dosya.Contains('\\') || dosya.Contains("..")) return;
            var yol = Path.Combine(klasor, dosya);
            if (System.IO.File.Exists(yol)) System.IO.File.Delete(yol);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Dosya silinemedi: {Dosya}", dosya);
        }
    }

    /* ==================================================================== */
    /* Cihaz görselleri                                                     */
    /* ==================================================================== */

    private int? GorselCihazi(IDbConnection db, int gorselId) =>
        db.ExecuteScalar<int?>("SELECT envanter_id FROM B360_ENVANTER_GORSEL WHERE id = @gorselId", new { gorselId });

    /// <summary>Cihaza görsel ekler; ilk görsel kapak olur.</summary>
    [HttpPost("{id:int}/Gorsel")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> GorselEkle(int id, IFormFile dosya)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Görsel seçilmedi." });

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        /* Panodan yapıştırılan görselin adı olmayabiliyor: türünden */
        if (uzanti.Length == 0)
            uzanti = (dosya.ContentType ?? "").ToLowerInvariant() switch
            {
                "image/png" => ".png",
                "image/webp" => ".webp",
                "image/jpeg" or "image/jpg" => ".jpg",
                _ => uzanti,
            };

        if (uzanti is not (".jpg" or ".jpeg" or ".png" or ".webp"))
            return BadRequest(new { hata = "JPG, PNG ya da WEBP yükleyiniz." });

        using var db = _vt.Baglanti();

        if (!Erisilir(db, id)) return Yok();

        var diskAdi = $"cihaz_{id}_{Guid.NewGuid():N}{uzanti}";
        var klasor = Klasor();

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);
            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Cihaz görseli yazılamadı: {Klasor}", klasor);

            return StatusCode(500, new { hata = $"Görsel yazılamadı. {hata.GetType().Name}: {hata.Message}" });
        }

        var ilkMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_ENVANTER_GORSEL WHERE envanter_id = @id", new { id }) == 0;

        var gorselId = db.ExecuteScalar<int>(@"
INSERT INTO B360_ENVANTER_GORSEL (envanter_id, dosya, ozgun_ad, boyut, kapak)
OUTPUT INSERTED.id VALUES (@id, @diskAdi, @ozgunAd, @boyut, @ilkMi)",
            new { id, diskAdi, ozgunAd = dosya.FileName, boyut = dosya.Length, ilkMi });

        return Ok(new { id = gorselId, adres = $"/api/Envanter/Gorsel/{gorselId}" });
    }

    /// <summary>Görseli döndürür. Herkese açık: Biçen360 ve panel img etiketiyle çekiyor.</summary>
    [HttpGet("Gorsel/{gorselId:int}")]
    [AllowAnonymous]
    public IActionResult Gorsel(int gorselId)
    {
        using var db = _vt.Baglanti();

        var dosyaAdi = db.ExecuteScalar<string>(
            "SELECT dosya FROM B360_ENVANTER_GORSEL WHERE id = @gorselId", new { gorselId });

        if (string.IsNullOrWhiteSpace(dosyaAdi)) return NotFound();

        if (dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest();

        var yol = Path.Combine(Klasor(), dosyaAdi);

        if (!System.IO.File.Exists(yol)) return NotFound();

        var tur = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "image/jpeg"
        };

        return PhysicalFile(yol, tur);
    }

    /// <summary>Görseli kapak yapar (tek kapak).</summary>
    [HttpPost("Gorsel/{gorselId:int}/Kapak")]
    public IActionResult Kapak(int gorselId)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        using var db = _vt.Baglanti();

        var cihazId = GorselCihazi(db, gorselId);
        if (cihazId is null || !Erisilir(db, cihazId.Value)) return NotFound(new { hata = "Görsel bulunamadı." });

        db.Execute(@"
UPDATE B360_ENVANTER_GORSEL SET kapak = 0 WHERE envanter_id = @cihazId;
UPDATE B360_ENVANTER_GORSEL SET kapak = 1 WHERE id = @gorselId;",
            new { cihazId, gorselId });

        Gecmis(db, cihazId.Value, "Kapak görseli değişti");

        return Ok(new { basarili = true });
    }

    [HttpDelete("Gorsel/{gorselId:int}")]
    public IActionResult GorselSil(int gorselId)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        using var db = _vt.Baglanti();

        var cihazId = GorselCihazi(db, gorselId);
        if (cihazId is null || !Erisilir(db, cihazId.Value)) return NotFound(new { hata = "Görsel bulunamadı." });

        var g = db.QueryFirst("SELECT dosya, kapak FROM B360_ENVANTER_GORSEL WHERE id = @gorselId", new { gorselId });

        db.Execute("DELETE FROM B360_ENVANTER_GORSEL WHERE id = @gorselId", new { gorselId });
        DosyaSil(Klasor(), (string)g.dosya);

        /* Kapak silindiyse sıradaki görsel kapak olur */
        if ((bool)g.kapak)
            db.Execute(@"
UPDATE B360_ENVANTER_GORSEL SET kapak = 1
WHERE id = (SELECT TOP 1 id FROM B360_ENVANTER_GORSEL WHERE envanter_id = @cihazId ORDER BY id)",
                new { cihazId });

        return Ok(new { basarili = true });
    }

    /// <summary>Cihaz görsellerinin klasörü; portal görselleriyle aynı kök.</summary>
    private string Kok()
    {
        var ayar = _yapilandirma["Portal:GorselKlasor"];

        return string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(
                string.IsNullOrWhiteSpace(_ortam.ContentRootPath) ? AppContext.BaseDirectory : _ortam.ContentRootPath,
                "portal-gorsel")
            : ayar.Trim();
    }

    private string Klasor() => Path.Combine(Kok(), "cihaz");

    private string BelgeKlasoru() => Path.Combine(Kok(), "cihaz-belge");

    /* ==================================================================== */
    /* Silme                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Cihazı kaldırır. Arıza kaydında kullanılmış ya da tamir geçmişi olan
    /// cihaz silinmez, "Kullanım dışı" yapılır: silinseydi eski kayıtların
    /// cihaz bilgisi ve maliyeti boşalırdı.
    /// </summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yetkili()) return Forbid();
        if (!Kapsam().Duzenler) return StatusCode(403, new { hata = "Rolünüz envanteri yalnızca görüntüleyebilir." });

        using var db = _vt.Baglanti();

        if (!Erisilir(db, id)) return Yok();

        var kullanilmis = db.ExecuteScalar<int>(@"
SELECT (SELECT COUNT(*) FROM B360_ARIZA WHERE envanter_id = @id)
     + (SELECT COUNT(*) FROM B360_ENVANTER_TAMIR WHERE envanter_id = @id)
     + (SELECT COUNT(*) FROM B360_SERVIS_FORM WHERE envanter_id = @id)", new { id }) > 0;

        if (kullanilmis)
        {
            db.Execute("UPDATE B360_ENVANTER SET durum = N'pasif' WHERE id = @id", new { id });
            Gecmis(db, id, "Kullanım dışı yapıldı (geçmişi olduğu için silinmedi)");

            return Ok(new { basarili = true, bilgi = "Cihazın arıza ya da tamir geçmişi olduğu için silinmedi, kullanım dışı yapıldı." });
        }

        foreach (var d in db.Query<string>("SELECT dosya FROM B360_ENVANTER_GORSEL WHERE envanter_id = @id", new { id }))
            DosyaSil(Klasor(), d);
        foreach (var d in db.Query<string>("SELECT dosya FROM B360_ENVANTER_BELGE WHERE envanter_id = @id", new { id }))
            DosyaSil(BelgeKlasoru(), d);

        db.Execute(@"
DELETE FROM B360_ENVANTER_GORSEL WHERE envanter_id = @id;
DELETE FROM B360_ENVANTER_BELGE WHERE envanter_id = @id;
DELETE FROM B360_ENVANTER_HAREKET WHERE envanter_id = @id;
DELETE FROM B360_ENVANTER_KONUM WHERE envanter_id = @id;
DELETE FROM B360_ENVANTER_AKTIVITE WHERE envanter_id = @id;
UPDATE B360_ENVANTER SET ust_cihaz_id = NULL WHERE ust_cihaz_id = @id;
DELETE FROM B360_ENVANTER WHERE id = @id;", new { id });

        return Ok(new { basarili = true });
    }
}

/* ========================================================================== */

public class EnvanterGirdi
{
    public int Id { get; set; }
    public string SubeKodu { get; set; }
    public string Tur { get; set; }
    public string Marka { get; set; }
    public string Model { get; set; }
    public string SeriNo { get; set; }

    /// <summary>Kurum demirbaş numarası; seri numarasından ayrı.</summary>
    public string SicilNo { get; set; }

    public string Sahibi { get; set; }
    public string Konum { get; set; }

    /// <summary>Bakımından sorumlu departman ("sorumlu birim").</summary>
    public int DepartmanId { get; set; }

    /// <summary>Bağlı olduğu cihaz (kasa terminali → kasa gibi).</summary>
    public int UstCihazId { get; set; }

    public string Tedarikci { get; set; }
    public DateTime? AlisTarihi { get; set; }

    /// <summary>KDV dahil; şube kullanıcısından gelirse yok sayılır.</summary>
    public decimal? AlisBedeli { get; set; }

    /// <summary>Ay; amortisman (defter değeri) için.</summary>
    public int? EkonomikOmur { get; set; }

    /// <summary>Kapak kutuyu doldursun (kırpılır) ya da sığsın.</summary>
    public bool KapakKirp { get; set; }

    public bool GarantiVar { get; set; }
    public DateTime? GarantiBaslangic { get; set; }
    public int? GarantiAy { get; set; }

    /// <summary>Boş bırakılırsa başlangıç ve süreden hesaplanır.</summary>
    public DateTime? GarantiBitis { get; set; }

    public string GarantiSaglayici { get; set; }
    public string GarantiNotu { get; set; }

    public DateTime? SonBakim { get; set; }

    /// <summary>Boş bırakılırsa son bakım ve aralıktan hesaplanır.</summary>
    public DateTime? SonrakiBakim { get; set; }

    /// <summary>Gün.</summary>
    public int? BakimAraligi { get; set; }

    public string BakimFirmasi { get; set; }
    public string BakimNotu { get; set; }

    public List<string> Etiketler { get; set; } = new();
    public string Notlar { get; set; }
    public string Durum { get; set; } = "aktif";
}

public class DurumGirdi
{
    public string Durum { get; set; }
}

public class TasiGirdi
{
    public string SubeKodu { get; set; }
    public string Konum { get; set; }
    public string Notu { get; set; }
}

public class TopluGirdi
{
    public List<int> Idler { get; set; }
    public string SubeKodu { get; set; }
    public string Durum { get; set; }
    public bool Bakim { get; set; }
}

public class TamirGirdi
{
    public int Id { get; set; }
    public DateTime? Tarih { get; set; }

    /// <summary>tamir · bakim · parca · kalibrasyon</summary>
    public string Tur { get; set; }

    public int? ArizaId { get; set; }
    public string Firma { get; set; }

    /// <summary>ic · dis</summary>
    public string Yapan { get; set; }

    public int GunDisi { get; set; }
    public List<EnvanterController.Kalem> Kalemler { get; set; }
    public int Kdv { get; set; } = 20;
    public bool Garantide { get; set; }
    public string FaturaNo { get; set; }
    public string Aciklama { get; set; }

    /// <summary>Cihazı "Çalışıyor" yap, bakımda son bakımı yaz (aşama bitmediyse "Bakımda")</summary>
    public bool DurumGuncelle { get; set; } = true;

    /// <summary>merkezde · firmada · tamamlandi (09.10.2026)</summary>
    public string Asama { get; set; } = "tamamlandi";
}

public class NotGirdi
{
    public string Metin { get; set; }
}

public class AktiviteGirdi
{
    /// <summary>bakim · ara · yap</summary>
    public string Tur { get; set; }

    public DateTime? Tarih { get; set; }
    public string Ozet { get; set; }
    public string Atanan { get; set; }
}

/// <summary>
/// Cihaz türü listesi: envantere girilen türler ile etkin arıza
/// kategorilerinin birleşimi; arıza kaydında cihazlar bu eşleşmeye göre
/// süzülüyor.
/// </summary>
public static class CihazTuruSorgusu
{
    public const string Kategoriler = @"
SELECT DISTINCT LTRIM(RTRIM(ad)) FROM B360_ARIZA_TUR
WHERE aktif = 1 AND LTRIM(RTRIM(ISNULL(ad, ''))) <> '' ORDER BY 1";

    public const string Hepsi = @"
SELECT t FROM (
    SELECT LTRIM(RTRIM(tur)) AS t FROM B360_ENVANTER
    WHERE LTRIM(RTRIM(ISNULL(tur, ''))) <> ''
    UNION
    SELECT LTRIM(RTRIM(ad)) FROM B360_ENVANTER_KATEGORI WHERE aktif = 1
    UNION
    SELECT LTRIM(RTRIM(ad)) FROM B360_ARIZA_TUR
    WHERE aktif = 1 AND LTRIM(RTRIM(ISNULL(ad, ''))) <> ''
) x ORDER BY t";
}

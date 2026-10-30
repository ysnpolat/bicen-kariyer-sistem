using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Gorunurluk = Bicen360.API.Servisler.ArizaErisimi.Gorunurluk;

namespace Bicen360.API.Controllers;

/// <summary>
/// Arıza kayıtları.
///
/// <para>
/// Kayıt mobilden ya da panelden açılır, departman temsilcileri yönetir.
/// Aynı uçlara iki taraftan da gelinir; kimin ne göreceğini
/// <see cref="ArizaErisimi"/> belirler.
/// </para>
///
/// <para>
/// Kategori (arıza türü) yalnızca sınıflandırma değil, SLA süresini de o
/// taşıyor. Kayıt açılırken kategorinin saatinden bir bitiş zamanı
/// hesaplanıp kaydediliyor. Sonradan hesaplamak, kategori süresi
/// değiştiğinde geçmiş kayıtların gecikme durumunu da değiştirirdi.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ArizaController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly BildirimServisi _bildirim;
    private readonly ArizaAkisServisi _akis;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<ArizaController> _kayit;

    /* Grup ayarı: arıza kayıtlarında görünürlük (Yetkiler → Gruplar) */
    private readonly KapsamServisi _kapsam;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly ArizaErisimi _erisim;

    public ArizaController(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        PersonelServisi personel,
        BildirimServisi bildirim,
        ArizaAkisServisi akis,
        KapsamServisi kapsam,
        PanelKullaniciServisi panelKullanici,
        ArizaErisimi erisim,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<ArizaController> kayit)
    {
        _kapsam = kapsam;
        _panelKullanici = panelKullanici;
        _erisim = erisim;
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _bildirim = bildirim;
        _akis = akis;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Sabitler                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Kaydın yaşam döngüsü.
    ///
    /// "Çözüldü" ile "kapandı" ayrı: ekip işi bitirdiğini söyler, kayıt
    /// doğrulanana kadar kapanmaz. Tek durum olsaydı, çözülmediği hâlde
    /// kapatılan kayıtlar görünmez olurdu.
    /// </summary>
    private static readonly string[] Durumlar =
        { "acik", "devam", "beklemede", "cozuldu", "kapandi" };

    private static readonly string[] Oncelikler =
        { "dusuk", "orta", "yuksek", "acil" };

    /* ==================================================================== */
    /* Kimlik                                                               */
    /* ==================================================================== */

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    private bool Mobil =>
        Kullanici.StartsWith("personel:", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Mobil jetondaki sicil.
    ///
    /// Jeton "personel:14721|cihaz-abc" biçiminde. İstemciden gelen değere
    /// güvenilmez; kim açtıysa o yazılır.
    /// </summary>
    private string Sicil
    {
        get
        {
            if (!Mobil) return null;

            var govde = Kullanici["personel:".Length..];
            var i = govde.IndexOf('|');

            return i < 0 ? govde : govde[..i];
        }
    }

    private PersonelServisi.Bilgi Kisi() => Mobil ? _personel.Getir(Sicil) : null;

    private string YapanAdi() =>
        Kisi()?.AdSoyad ?? User.FindFirstValue("adSoyad") ?? Kullanici;

    /* Erişim ve görünürlük kuralı ArizaErisimi'nde: servis formu da
       aynı kuralı kullanıyor (08.10.2026). */
    private bool Yetkili() => _erisim.Yetkili(User);

    private Gorunurluk KapsamBelirle() => _erisim.Kapsam(User);

    /// <summary>
    /// Görünürlüğün SQL karşılığı.
    ///
    /// <para>
    /// Koşullar VEYA ile bağlanır: bir kişi hem temsilci hem mağaza müdürü
    /// olabiliyor ve kendi açtığı kaydı da görmeli.
    /// </para>
    ///
    /// <para>
    /// <paramref name="kapsam"/> bu birleşimi daraltır. Temsilci için
    /// "departmanıma açılanlar" ile "benim açtıklarım" ayrı sorular ve
    /// karışık tek liste hangisinin ne olduğunu gizliyordu:
    /// </para>
    /// <list type="bullet">
    /// <item><c>departmanim</c> — yalnızca temsilcisi olduğu departmanlar</item>
    /// <item><c>benim</c> — yalnızca kendi açtıkları</item>
    /// <item>boş — görebildiği her şey</item>
    /// </list>
    /// </summary>
    private static string Kosul(Gorunurluk k, string kapsam = null)
    {
        /* Panelden gelen kullanıcının temsilcilik kırılımı yok; kapsam
           yalnızca mobil tarafta anlamlı. */
        if (k.Hepsi) return "1 = 1";

        if (kapsam == "benim") return "A.acan_kodu = @sicil";

        if (kapsam == "departmanim")
            return k.Departmanlar.Count > 0
                ? "A.departman_id IN @departmanlar"
                : "1 = 0";

        var parcalar = new List<string> { "A.acan_kodu = @sicil" };

        if (k.Departmanlar.Count > 0) parcalar.Add("A.departman_id IN @departmanlar");
        if (k.Subeler.Count > 0) parcalar.Add("A.sube_kodu IN @subeler");

        return "(" + string.Join(" OR ", parcalar) + ")";
    }

    private static DynamicParameters Kapsam(Gorunurluk k, object ek = null)
    {
        var p = new DynamicParameters(new
        {
            sicil = k.Sicil,
            departmanlar = k.Departmanlar.Count > 0 ? k.Departmanlar : new List<int> { 0 },
            subeler = k.Subeler.Count > 0 ? k.Subeler : new List<string> { "" }
        });

        if (ek is not null) p.AddDynamicParams(ek);

        return p;
    }

    /* ==================================================================== */
    /* Kayıt açma                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Kayıt açma ekranının ihtiyaç duyduğu listeler.
    ///
    /// Tek uçta toplandı: mobilde üç ayrı istek, ekran açılışını gözle
    /// görülür yavaşlatıyordu.
    /// </summary>
    [HttpGet("Form")]
    public IActionResult Form([FromQuery] string sube = null)
    {
        if (!Yetkili()) return Forbid();

        var kisi = Kisi();

        /* Mobilde kişinin kendi mağazası; panelden mağaza seçilebiliyor */
        var hedefSube = Mobil ? kisi?.Sube : sube;

        using var db = _vt.Baglanti();

        var departmanlar = db.Query(@"
SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList();

        /* 'akisVar': tür seçilince mobilin adım adım soracağı bir akış
           tanımlı mı. Tanımlıysa ekran başlık kutusu yerine soruları
           gösteriyor; olmayan türlerde eski serbest form kalıyor. */
        var turler = db.Query(@"
SELECT T.id, T.ad, T.departman_id AS departmanId, T.sla_saat AS slaSaat,
       T.cihaz_turleri AS cihazTurleri, T.aciklama, T.soru,
       T.akis_zorunlu AS akisZorunlu,
       CASE WHEN EXISTS (SELECT 1 FROM B360_ARIZA_ADIM A
                          WHERE A.tur_id = T.id AND A.aktif = 1)
            THEN 1 ELSE 0 END AS akisVar
FROM B360_ARIZA_TUR T WHERE T.aktif = 1 ORDER BY T.sira, T.ad").ToList();

        /* Cihaz listesi bir mağazayla sınırlı: 34 şubenin tüm envanteri
           telefonda gezilecek bir liste değil ve başka mağazanın cihazına
           arıza açılmamalı. */
        var cihazlar = string.IsNullOrWhiteSpace(hedefSube)
            ? new List<dynamic>()
            : db.Query(@"
SELECT id, tur, marka, model, seri_no AS seriNo, sicil_no AS sicilNo
FROM B360_ENVANTER
WHERE sube_kodu = @sube AND durum <> N'pasif'
ORDER BY tur, marka, model", new { sube = hedefSube }).ToList();

        return Ok(new
        {
            departmanlar,
            turler,
            cihazlar,
            oncelikler = Oncelikler,
            sube = hedefSube,
            acan = kisi?.AdSoyad
        });
    }

    /// <summary>
    /// Bir arıza türünün soru akışı.
    ///
    /// <para>
    /// Ağacın tamamı tek istekte gidiyor. Her adımda sunucuya sormak,
    /// mağazadaki zayıf bağlantıda akışı kullanılamaz hâle getiriyordu;
    /// bir türün adım sayısı da birkaç yüzü geçmiyor.
    /// </para>
    /// </summary>
    [HttpGet("Akis")]
    public IActionResult Akis([FromQuery] int turId)
    {
        if (!Yetkili()) return Forbid();

        if (turId <= 0) return BadRequest(new { hata = "Arıza türü seçiniz." });

        using var db = _vt.Baglanti();

        var tur = db.QueryFirstOrDefault(@"
SELECT id, ad, soru, akis_zorunlu AS akisZorunlu, cihaz_turleri AS cihazTurleri
FROM B360_ARIZA_TUR WHERE id = @turId", new { turId });

        if (tur is null) return NotFound(new { hata = "Arıza türü bulunamadı." });

        var adimlar = _akis.Adimlar(db, turId, yalnizAktif: true);

        return Ok(new
        {
            tur,

            /* İlk seviyenin sorusu türden geliyor; boşsa genel ifade.
               Boş soru ekranda personelin neye cevap verdiğini
               anlamamasına yol açıyordu. */
            soru = ArizaAkisServisi.SoruMetni(null, (string)tur.soru),

            adimlar = _akis.Agac(adimlar)
        });
    }

    /// <summary>Yeni arıza kaydı.</summary>
    [HttpPost]
    public async Task<IActionResult> Ac([FromBody] ArizaGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null) return BadRequest(new { hata = "Kayıt bilgisi boş." });

        if (girdi.DepartmanId <= 0)
            return BadRequest(new { hata = "Departman seçiniz." });

        var kisi = Kisi();

        using var db = _vt.Baglanti();

        var departman = db.QueryFirstOrDefault<string>(
            "SELECT ad FROM B360_DEPARTMAN WHERE id = @id AND aktif = 1",
            new { id = girdi.DepartmanId });

        if (departman is null)
            return BadRequest(new { hata = "Departman bulunamadı." });

        /* SLA bitişi kayıt anında yazılır; kategori süresi sonradan
           değişse bile açık kayıtların hedefi kaymaz. */
        DateTime? slaBitis = null;

        var akis = ArizaAkisServisi.Cozum.Bos();

        if (girdi.TurId > 0)
        {
            var tur = db.QueryFirstOrDefault(@"
SELECT sla_saat AS slaSaat, soru, akis_zorunlu AS akisZorunlu
FROM B360_ARIZA_TUR WHERE id = @id AND aktif = 1", new { id = girdi.TurId });

            if (tur is null)
                return BadRequest(new { hata = "Arıza türü bulunamadı." });

            if ((int)tur.slaSaat > 0) slaBitis = DateTime.Now.AddHours((int)tur.slaSaat);

            /* Seçimler adım kimlikleriyle geliyor; soru ve cevap metinleri
               burada tablodan okunuyor. İstemcinin gönderdiği metne
               güvenilseydi kayıt geçmişi ne yazıldıysa onu kabul ederdi. */
            akis = _akis.Coz(db, girdi.TurId, (string)tur.soru,
                             (bool)tur.akisZorunlu, girdi.Yanitlar);

            if (!akis.Gecerli) return BadRequest(new { hata = akis.Hata });
        }
        else if (girdi.Yanitlar is { Count: > 0 })
        {
            return BadRequest(new { hata = "Soruları yanıtlamak için önce arıza türü seçiniz." });
        }

        /* Başlık: akış varsa özetin kendisi. Personel serbest başlık
           yazdığında hepsi "kasa çalışmıyor" oluyordu ve liste okunmuyordu;
           "Yazarkasa › Fiş yazıcı › Silik çıkarıyor" tek bakışta anlaşılıyor. */
        var baslik = akis.Dolu
            ? Kirp(akis.Ozet, 150)
            : girdi.Baslik?.Trim();

        if (string.IsNullOrWhiteSpace(baslik))
            return BadRequest(new { hata = "Başlık giriniz." });

        /* Öncelik sırası: akıştaki tanım > personelin seçimi > orta.
           Uç bir seçeneğe ("hiç açılmıyor") bağlanan öncelik, personelin
           alışkanlıkla bıraktığı varsayılanı ezmeli. */
        var oncelik =
            !string.IsNullOrWhiteSpace(akis.Oncelik) ? akis.Oncelik
            : Oncelikler.Contains(girdi.Oncelik) ? girdi.Oncelik
            : "orta";

        /* Şube kullanıcısı kaydı yalnızca kendi şubesine açabiliyor */
        var panelKilit = Mobil ? null : _panelKullanici.Getir(Kullanici);

        var sube = Mobil ? kisi?.Sube
                 : panelKilit?.SubeKilitli == true ? panelKilit.SubeKodu
                 : girdi.SubeKodu;

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ARIZA
    (departman_id, tur_id, envanter_id, baslik, aciklama,
     acan_kodu, acan_adi, acan_telefon, sube_kodu, oncelik, sla_bitis,
     adim_id, akis_ozet)
OUTPUT INSERTED.id
VALUES (@DepartmanId, @turId, @envanterId, @baslik, @Aciklama,
        @acan, @acanAdi, @acanTelefon, @sube, @oncelik, @slaBitis,
        @adimId, @akisOzet)",
            new
            {
                girdi.DepartmanId,
                turId = girdi.TurId > 0 ? girdi.TurId : (int?)null,
                envanterId = girdi.EnvanterId > 0 ? girdi.EnvanterId : (int?)null,
                baslik,
                girdi.Aciklama,
                acan = Sicil ?? Kullanici,
                acanAdi = kisi?.AdSoyad ?? User.FindFirstValue("adSoyad"),

                /* Telefon kayıt anında yazılıyor: teknisyen kaydı açan
                   kişiye tek dokunuşla ulaşabilsin diye. Panelden açılan
                   kayıtta personel kaydı olmayabiliyor, o zaman boş. */
                acanTelefon = kisi?.Telefon,

                sube,
                oncelik,
                slaBitis,
                adimId = akis.SonAdimId,
                akisOzet = akis.Dolu ? Kirp(akis.Ozet, 400) : null
            });

        if (akis.Dolu) _akis.Yaz(db, id, akis.Yanitlar);

        db.Execute(@"
INSERT INTO B360_ARIZA_HAREKET (ariza_id, durum, aciklama, yapan)
VALUES (@id, N'acik', @aciklama, @yapan)",
            new
            {
                id,
                aciklama = akis.Dolu ? $"Kayıt açıldı · {Kirp(akis.Ozet, 380)}" : "Kayıt açıldı",
                yapan = YapanAdi()
            });

        /* Kategorinin varsayılan sorumlusu varsa kayıt ona atanıyor.

           Temsilci her kaydı elle üstlenmek zorundaydı; kimsenin almadığı
           kayıt SLA'yı kaçırıyordu. Atama geçmişe ayrı satır olarak
           yazılıyor ki kaydın kime neden gittiği görünsün, sonradan elle
           değiştirilebiliyor. Kişi kendi açtığı kayda atanmıyor. */
        if (girdi.TurId > 0)
        {
            var varsayilan = db.QueryFirstOrDefault(@"
SELECT atanan_kodu AS kod, atanan_adi AS ad FROM B360_ARIZA_TUR WHERE id = @turId",
                new { turId = girdi.TurId });

            var kod = ((string)varsayilan?.kod ?? "").Trim();

            if (kod.Length > 0 && !string.Equals(kod, Sicil ?? "", StringComparison.OrdinalIgnoreCase))
            {
                var ad = (string)varsayilan.ad ?? _personel.Getir(kod)?.AdSoyad ?? kod;

                db.Execute(@"
UPDATE B360_ARIZA SET atanan_kodu = @kod, atanan_adi = @ad WHERE id = @id",
                    new { id, kod, ad });

                db.Execute(@"
INSERT INTO B360_ARIZA_HAREKET (ariza_id, durum, aciklama, yapan)
VALUES (@id, NULL, @aciklama, N'Sistem')",
                    new { id, aciklama = $"Otomatik atandı: {ad} (kategori sorumlusu)" });

                await _bildirim.Gonder(kod, $"Arıza #{id} size atandı", baslik, "Ariza");
            }
        }

        /* Bildirim kayıttan sonra: gönderim başarısız olsa da kayıt durmalı */
        await TemsilcilereHaberVer(db, girdi.DepartmanId, id, baslik, sube, departman);

        return Ok(new { id, durum = "acik", baslik, oncelik, akisOzet = akis.Ozet });
    }

    /// <summary>
    /// Kayda fotoğraf ekler.
    ///
    /// Çok parçalı gönderim; checklist görsellerindeki desenin aynısı.
    /// </summary>
    /// <summary>
    /// Kayda fotoğraf ekler.
    ///
    /// <para>
    /// Kayıt numarası hem yoldan hem gövdeden kabul ediliyor. Yol daha
    /// güvenilir: çok parçalı gövdedeki alan adı istemciden istemciye
    /// değişebiliyor ve tutmadığında istek "Dosya boş" diye
    /// reddediliyordu.
    /// </para>
    /// </summary>
    [HttpPost("Gorsel")]
    [HttpPost("Gorsel/{yolArizaId:int}")]
    [RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> Gorsel(
        int yolArizaId = 0,
        [FromForm] int arizaId = 0,
        IFormFile dosya = null)
    {
        if (!Yetkili()) return Forbid();

        var kayitId = yolArizaId > 0 ? yolArizaId : arizaId;

        if (kayitId <= 0) return BadRequest(new { hata = "Kayıt numarası gelmedi." });

        /* Alan adı tutmazsa gövdedeki ilk dosya alınıyor. Telefon
           tarafındaki "dosya" adına bağlı kalmak, adı değiştiği anda
           fotoğrafların sessizce kaybolmasına yol açıyordu. */
        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Dosya boş ya da gönderilemedi." });

        using var db = _vt.Baglanti();

        var kapsam = KapsamBelirle();

        /* Göremediği bir kayda fotoğraf eklenmemeli */
        var gorur = db.ExecuteScalar<int>($@"
SELECT COUNT(*) FROM B360_ARIZA A WHERE A.id = @kayitId AND {Kosul(kapsam)}",
            Kapsam(kapsam, new { kayitId })) > 0;

        if (!gorur)
            return StatusCode(403, new { hata = "Bu kayda fotoğraf ekleme yetkiniz yok." });

        var klasor = GorselKlasoru();
        var ad = $"{kayitId}_{Guid.NewGuid():N}.jpg";

        /* Yazma hatası ayrıca yakalanıyor: yayın sunucusunda uygulama
           klasörüne yazma izni olmadığında istek genel bir 500 dönüyor ve
           telefonda "yüklenemedi" dışında bir bilgi kalmıyordu. Sebebin
           kendisi hem günlüğe hem yanıta yazılıyor. */
        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(Path.Combine(klasor, ad), FileMode.Create);

            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Arıza görseli yazılamadı: {Klasor}", klasor);

            return StatusCode(500, new
            {
                hata = $"Fotoğraf sunucuya yazılamadı ({klasor}). " +
                       "Klasör yazma izni verilmeli."
            });
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ARIZA_GORSEL (ariza_id, dosya)
OUTPUT INSERTED.id VALUES (@kayitId, @ad)", new { kayitId, ad });

        return Ok(new { id, tamam = true });
    }

    /// <summary>
    /// Görsellerin durduğu klasör.
    ///
    /// <para>
    /// Varsayılan olarak uygulama klasörünün altında. IIS'te uygulama
    /// havuzunun kendi klasörüne yazma izni olmayabiliyor; o durumda
    /// appsettings içindeki <c>Ariza:GorselKlasoru</c> ile izin verilmiş
    /// bir yol gösteriliyor (ör. <c>D:\bicen360\gorseller</c>).
    /// </para>
    ///
    /// <para>
    /// Yazma ve okuma aynı yerden geçiyor: iki ayrı yol hesabı, ayarı
    /// değiştirdikten sonra eski fotoğrafların "süresi dolmuş" görünmesine
    /// yol açardı.
    /// </para>
    /// </summary>
    private string GorselKlasoru()
    {
        var ayar = _yapilandirma["Ariza:GorselKlasoru"];

        return string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(Kok(), "ariza")
            : ayar.Trim();
    }

    private string Kok() =>
        string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

    /* ==================================================================== */
    /* Listeleme                                                            */
    /* ==================================================================== */

    /// <summary>
    /// Görebildiğim kayıtlar ve özet sayılar.
    ///
    /// Süzgeçler tek uçta: panelde durum, öncelik, departman, kategori ve
    /// metin araması aynı listeyi daraltıyor.
    /// </summary>
    [HttpGet("Kayitlarim")]
    public IActionResult Kayitlarim(
        [FromQuery] string durum = null,
        [FromQuery] string oncelik = null,
        [FromQuery] int? departman = null,
        [FromQuery] int? tur = null,
        [FromQuery] string sube = null,
        [FromQuery] bool? geciken = null,
        [FromQuery] string ara = null,
        [FromQuery] string kapsam = null,
        [FromQuery] string gorunum = null)
    {
        if (!Yetkili()) return Forbid();

        var gorunurluk = KapsamBelirle();

        using var db = _vt.Baglanti();

        /* Panel görünümleri (13.10.2026): bana atanan, atanmamış. Atama
           sicille yapılıyor; panel kullanıcısının sicili kullanıcı
           kaydında. */
        var ben = Mobil ? Sicil : db.ExecuteScalar<string>(
            "SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi = @Kullanici", new { Kullanici })?.Trim();

        /* 'geciken': SLA bitişi geçmiş ve hâlâ çözülmemiş kayıtlar.
           Kapanmış kaydın gecikmiş sayılması listeyi kirletiyordu. */
        /* 'aktif': çözülmemiş ve kapanmamış her kayıt.
           Varsayılan süzgeç "acik" iken beklemedeki ve devam eden kayıtlar
           listede görünmüyor, kullanıcı süzgeci kaldırana kadar işin bir
           kısmını kaçırıyordu. Liste artık bununla açılıyor. */
        const string suzgec = @"
  AND (@durum IS NULL
       OR (@durum = N'aktif' AND A.durum NOT IN (N'cozuldu', N'kapandi'))
       OR A.durum = @durum)
  AND (@oncelik IS NULL OR A.oncelik = @oncelik)
  AND (@departman IS NULL OR A.departman_id = @departman)
  AND (@tur IS NULL OR A.tur_id = @tur)
  AND (@sube IS NULL OR A.sube_kodu = @sube)
  AND (@geciken IS NULL
       OR (@geciken = 1 AND A.sla_bitis IS NOT NULL AND A.sla_bitis < SYSDATETIME()
           AND A.durum NOT IN (N'cozuldu', N'kapandi'))
       OR (@geciken = 0 AND (A.sla_bitis IS NULL OR A.sla_bitis >= SYSDATETIME()
           OR A.durum IN (N'cozuldu', N'kapandi'))))
  AND (@ara IS NULL OR A.baslik LIKE @kalip OR A.aciklama LIKE @kalip
       OR A.akis_ozet LIKE @kalip OR A.sube_kodu LIKE @kalip
       OR A.acan_adi LIKE @kalip OR CAST(A.id AS NVARCHAR(20)) = @ara)
  AND (@gorunum IS NULL
       OR (@gorunum = N'bana' AND A.atanan_kodu = @ben AND A.durum NOT IN (N'cozuldu', N'kapandi'))
       OR (@gorunum = N'atanmamis' AND (A.atanan_kodu IS NULL OR A.atanan_kodu = N'')
           AND A.durum NOT IN (N'cozuldu', N'kapandi')))";

        var parametre = Kapsam(gorunurluk, new
        {
            durum = Bos(durum),
            oncelik = Bos(oncelik),
            departman,
            tur,
            sube = Bos(sube),
            geciken,
            ara = Bos(ara),
            kalip = $"%{ara}%",
            gorunum = Bos(gorunum),
            ben = ben ?? "-"
        });

        var liste = db.Query($@"
SELECT
    A.id, A.baslik, A.durum, A.oncelik, A.olusturma, A.sla_bitis AS slaBitis,
    A.sube_kodu AS subeKodu, A.acan_adi AS acanAdi, A.atanan_adi AS atananAdi,
    A.akis_ozet AS akisOzet,
    A.atanan_kodu AS atananKodu, A.departman_id AS departmanId,
    D.ad AS departman,
    T.ad AS tur, T.sla_saat AS slaSaat,
    LTRIM(RTRIM(ISNULL(E.tur, N'') + N' ' + ISNULL(E.marka, N'') + N' ' + ISNULL(E.model, N''))) AS cihaz,
    CASE WHEN A.sla_bitis IS NOT NULL AND A.sla_bitis < SYSDATETIME()
              AND A.durum NOT IN (N'cozuldu', N'kapandi')
         THEN 1 ELSE 0 END AS gecikti,
    (SELECT COUNT(*) FROM B360_ARIZA_GORSEL G
      WHERE G.ariza_id = A.id AND G.silindi = 0) AS gorselSayisi,
    (SELECT COUNT(*) FROM B360_ARIZA_YORUM Y
      WHERE Y.ariza_id = A.id) AS yorumSayisi
FROM B360_ARIZA A
    LEFT JOIN B360_DEPARTMAN D ON A.departman_id = D.id
    LEFT JOIN B360_ARIZA_TUR T ON A.tur_id = T.id
    LEFT JOIN B360_ENVANTER  E ON A.envanter_id = E.id
WHERE {Kosul(gorunurluk, kapsam)}{suzgec}
ORDER BY A.olusturma DESC", parametre).ToList();

        /* Özet, durum süzgecinden bağımsız ama kapsama bağlı: 'kaç açık
           kayıt var" sorusunun cevabı hangi durumun seçili olduğuna göre
           değişmemeli, ama "departmanım" seçiliyken tüm kayıtları sayması
           listeyle çelişirdi. */
        var ozet = db.QueryFirstOrDefault($@"
SELECT
    COUNT(*) AS toplam,
    SUM(CASE WHEN A.durum NOT IN (N'cozuldu', N'kapandi') THEN 1 ELSE 0 END) AS aktif,
    SUM(CASE WHEN A.durum = N'acik' THEN 1 ELSE 0 END) AS acik,
    SUM(CASE WHEN A.durum = N'devam' THEN 1 ELSE 0 END) AS devam,
    SUM(CASE WHEN A.durum = N'beklemede' THEN 1 ELSE 0 END) AS beklemede,
    SUM(CASE WHEN A.durum IN (N'cozuldu', N'kapandi') THEN 1 ELSE 0 END) AS kapali,
    SUM(CASE WHEN A.sla_bitis IS NOT NULL AND A.sla_bitis < SYSDATETIME()
                  AND A.durum NOT IN (N'cozuldu', N'kapandi')
             THEN 1 ELSE 0 END) AS geciken,
    SUM(CASE WHEN (A.atanan_kodu IS NULL OR A.atanan_kodu = N'')
                  AND A.durum NOT IN (N'cozuldu', N'kapandi') THEN 1 ELSE 0 END) AS atanmamis,
    SUM(CASE WHEN A.atanan_kodu = @ben
                  AND A.durum NOT IN (N'cozuldu', N'kapandi') THEN 1 ELSE 0 END) AS bana,
    SUM(CASE WHEN A.durum = N'cozuldu' THEN 1 ELSE 0 END) AS cozuldu,
    AVG(CASE WHEN A.cozum_zamani IS NOT NULL AND A.cozum_zamani >= DATEADD(DAY, -30, SYSDATETIME())
             THEN CAST(DATEDIFF(MINUTE, A.olusturma, A.cozum_zamani) AS FLOAT) / 60.0 END) AS ortCozumSaat
FROM B360_ARIZA A
WHERE {Kosul(gorunurluk, kapsam)}", Kapsam(gorunurluk, new { ben = ben ?? "-" }));

        return Ok(new
        {
            kayitlar = liste,
            ozet,

            /* Mobil ekranda 'yönetebilir miyim' ayrımı için: temsilci durum
               değiştirebiliyor, diğerleri yalnızca izliyor. */
            temsilci = gorunurluk.Hepsi || gorunurluk.Departmanlar.Count > 0,

            /* Kapsam seçeneği yalnızca temsilcide anlamlı; diğer personel
               zaten sadece kendi kayıtlarını görüyor. */
            departmanSayisi = gorunurluk.Departmanlar.Count,

            /* Panel (13.10.2026): yönetim düğmeleri ve kapsam etiketi */
            yonetir = !Mobil && _yetki.SayfaYonetir(Kullanici, Rol, "ariza"),
            /* Arıza türlerini (kendi departmanının) düzenleyebilir mi (13.10.2026) */
            turYonetir = !Mobil && HttpContext.RequestServices.GetRequiredService<TanimYetkisi>().Al(User, "ariza").Var,
            kapsamAdi = Mobil ? null : KapsamAdi(db, gorunurluk)
        });
    }

    /// <summary>Panelde gösterilen kapsam etiketi</summary>
    private string KapsamAdi(System.Data.IDbConnection db, Gorunurluk g)
    {
        if (g.Hepsi) return "Tüm departmanlar";
        if (g.Subeler.Count > 0 && g.Departmanlar.Count == 0) return string.Join(", ", g.Subeler) + " şubesi";
        if (g.Departmanlar.Count == 0) return "Yalnızca açtığınız kayıtlar";

        return string.Join(", ", db.Query<string>(
            "SELECT ad FROM B360_DEPARTMAN WHERE id IN @d ORDER BY sira, ad", new { d = g.Departmanlar }));
    }

    /// <summary>
    /// Kayda atanabilecek kişiler (13.10.2026): departmanın temsilcileri ve
    /// bu departmanı kapsayan portal rolündeki, sicili tanımlı kullanıcılar.
    /// Panelde sicil yazmak yerine listeden seçiliyor.
    /// </summary>
    [HttpGet("Atanabilir")]
    public IActionResult Atanabilir([FromQuery] int? departman = null)
    {
        if (!Yetkili() || Mobil) return Forbid();

        using var db = _vt.Baglanti();

        var kodlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var k in db.Query<string>(@"
SELECT DISTINCT personel_kodu FROM B360_DEPARTMAN_TEMSILCI
WHERE @departman IS NULL OR departman_id = @departman", new { departman }))
            if (!string.IsNullOrWhiteSpace(k)) kodlar[k.Trim()] = "Temsilci";

        var roller = HttpContext.RequestServices.GetRequiredService<RolServisi>();

        foreach (var r in roller.Tumu().Where(r => r.Seviye("ariza") > 0 &&
                     (r.TumDepartmanlar || departman is null || r.Departmanlar.Contains(departman.Value))))
        {
            var kullanicilar = roller.Kullanicilari(r.Id);
            if (kullanicilar.Count == 0) continue;

            foreach (var k in db.Query<string>(
                         "SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi IN @kullanicilar AND sicil IS NOT NULL AND sicil <> ''",
                         new { kullanicilar }))
                kodlar.TryAdd(k.Trim(), r.Ad);
        }

        var liste = kodlar
            .Select(x => new { kod = x.Key, ad = _personel.Getir(x.Key)?.AdSoyad ?? x.Key, kaynak = x.Value })
            .OrderBy(x => x.ad, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
            .ToList();

        return Ok(liste);
    }

    public class TopluGirdi
    {
        public List<int> Idler { get; set; }
        public string Durum { get; set; }
        public string AtananKodu { get; set; }
    }

    /// <summary>
    /// Toplu atama ya da durum (13.10.2026). Çözüldü / kapandı servis formu
    /// istediği için toplu yapılmaz. Yönetemediği kayıt atlanır.
    /// </summary>
    [HttpPost("Toplu")]
    public async Task<IActionResult> Toplu([FromBody] TopluGirdi girdi)
    {
        if (!Yetkili() || Mobil) return Forbid();

        var idler = (girdi?.Idler ?? new List<int>()).Distinct().Take(200).ToList();
        if (idler.Count == 0) return BadRequest(new { hata = "Kayıt seçilmedi." });

        if (girdi.Durum is "cozuldu" or "kapandi")
            return BadRequest(new { hata = "Çözüldü ve Kapandı servis formuyla tek tek yapılır." });

        var yapilan = 0;

        foreach (var id in idler)
        {
            var sonuc = await Guncelle(id, new GuncelleGirdi
            {
                Durum = Bos(girdi.Durum),
                AtananKodu = girdi.AtananKodu,
                Aciklama = "Toplu işlem"
            });

            if (sonuc is OkObjectResult) yapilan++;
        }

        return Ok(new { yapilan, atlanan = idler.Count - yapilan });
    }

    private static string Bos(string d) => string.IsNullOrWhiteSpace(d) ? null : d;

    /// <summary>Sütun sınırını aşan metni keser; uzun akış özetleri için.</summary>
    private static string Kirp(string metin, int uzunluk) =>
        string.IsNullOrWhiteSpace(metin) ? metin
        : metin.Length <= uzunluk ? metin
        : metin[..(uzunluk - 1)] + "…";

    /// <summary>Tek kaydın ayrıntısı: hareket geçmişi, yorumlar, görseller.</summary>
    [HttpGet("{id:int}")]
    public IActionResult Detay(int id)
    {
        if (!Yetkili()) return Forbid();

        var kapsam = KapsamBelirle();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault($@"
SELECT
    A.id, A.baslik, A.aciklama, A.durum, A.oncelik, A.olusturma,
    A.cozum_zamani AS cozumZamani, A.kapanma, A.sla_bitis AS slaBitis,
    A.acan_kodu AS acanKodu, A.acan_adi AS acanAdi,
    A.atanan_kodu AS atananKodu, A.atanan_adi AS atananAdi,
    A.sube_kodu AS subeKodu, A.departman_id AS departmanId, A.tur_id AS turId,
    A.adim_id AS adimId, A.akis_ozet AS akisOzet,
    A.acan_telefon AS acanTelefon,
    D.ad AS departman,
    T.ad AS tur, T.sla_saat AS slaSaat,
    E.id AS cihazId, A.envanter_id AS envanterId, E.tur AS cihazTuru, E.marka AS cihazMarka,
    E.model AS cihazModel, E.seri_no AS cihazSeriNo, E.sicil_no AS cihazSicilNo,
    CASE WHEN A.sla_bitis IS NOT NULL AND A.sla_bitis < SYSDATETIME()
              AND A.durum NOT IN (N'cozuldu', N'kapandi')
         THEN 1 ELSE 0 END AS gecikti
FROM B360_ARIZA A
    LEFT JOIN B360_DEPARTMAN D ON A.departman_id = D.id
    LEFT JOIN B360_ARIZA_TUR T ON A.tur_id = T.id
    LEFT JOIN B360_ENVANTER  E ON A.envanter_id = E.id
WHERE A.id = @id AND {Kosul(kapsam)}", Kapsam(kapsam, new { id }));

        if (kayit is null)
            return NotFound(new { hata = "Kayıt bulunamadı ya da görme yetkiniz yok." });

        /* Telefon sütunu eklenmeden önce açılmış kayıtlar için Mikro'dan
           okunuyor. Yeni kayıtlarda sorulmuyor: kayıt anında yazılan
           numara, personel sonradan ayrılsa bile o gün kimin arandığını
           koruyor. */
        var telefon = (string)kayit.acanTelefon;

        if (string.IsNullOrWhiteSpace(telefon) &&
            !string.IsNullOrWhiteSpace((string)kayit.acanKodu))
            telefon = _personel.Getir((string)kayit.acanKodu)?.Telefon;

        var hareketler = db.Query(@"
SELECT durum, aciklama, yapan, olusturma
FROM B360_ARIZA_HAREKET WHERE ariza_id = @id ORDER BY olusturma", new { id }).ToList();

        /* İç notlar kaydı açana gösterilmez; ekip kendi arasında
           yazışabilsin diye ayrı bir bayrakla tutuluyor. */
        var kapsamDepartmanlari = KapsamBelirle();

        var icNotGorur = !Mobil || kapsamDepartmanlari.Departmanlar.Count > 0;

        var yorumlar = db.Query(@"
SELECT id, metin, ic_not AS icNot, cozum, yazan_adi AS yazanAdi, olusturma
FROM B360_ARIZA_YORUM
WHERE ariza_id = @id AND (@icNotGorur = 1 OR ic_not = 0)
ORDER BY olusturma", new { id, icNotGorur }).ToList();

        var gorseller = db.Query<int>(@"
SELECT id FROM B360_ARIZA_GORSEL
WHERE ariza_id = @id AND silindi = 0 ORDER BY olusturma", new { id }).ToList();

        /* Yanıtlar kaydın kendi kopyasından okunuyor, adım tablosundan
           değil: seçenek adı sonradan değiştirilse bile kaydın ne dediği
           değişmemeli. */
        var yanitlar = _akis.Yanitlar(db, id);

        /* Aynı cihazda daha önce açılmış kayıtlar.
           Tekrar eden arıza, tek tek bakıldığında görünmüyordu: aynı fiş
           yazıcısı üç ayda dört kez bozulduysa cihazın kendisi
           değiştirilmeli, her seferinde yeniden tamir edilmemeli. */
        var cihazGecmisi = kayit.cihazId is null
            ? new List<dynamic>()
            : db.Query(@"
SELECT TOP 6 A.id, A.baslik, A.akis_ozet AS akisOzet, A.durum, A.olusturma
FROM B360_ARIZA A
WHERE A.envanter_id = @cihazId AND A.id <> @id
ORDER BY A.olusturma DESC",
                new { cihazId = (int)kayit.cihazId, id }).ToList();

        return Ok(new
        {
            kayit,
            acanTelefon = telefon,
            hareketler,
            yorumlar,
            gorseller,
            yanitlar,
            cihazGecmisi,
            yonetir = _erisim.Yonetir(User, (int?)kayit.departmanId),
            tutarGorur = !Mobil && HttpContext.RequestServices.GetRequiredService<RaporKapsami>().MaliyetGorur(Kullanici, Rol)
        });
    }

    /// <summary>
    /// Görseli döndürür.
    ///
    /// Mobildeki Image bileşeni başlık gönderemediği için jeton sorgu
    /// olarak da kabul ediliyor; doğrulaması Program.cs'deki olayda.
    /// </summary>
    [HttpGet("Gorsel/{id:int}")]
    public IActionResult GorselGetir(int id)
    {
        if (!Yetkili()) return Forbid();

        var kapsam = KapsamBelirle();

        using var db = _vt.Baglanti();

        var dosya = db.ExecuteScalar<string>($@"
SELECT G.dosya FROM B360_ARIZA_GORSEL G
    INNER JOIN B360_ARIZA A ON G.ariza_id = A.id
WHERE G.id = @id AND G.silindi = 0 AND {Kosul(kapsam)}",
            Kapsam(kapsam, new { id }));

        if (string.IsNullOrWhiteSpace(dosya)) return NotFound();

        var yol = Path.Combine(GorselKlasoru(), dosya);

        if (!System.IO.File.Exists(yol))
            return NotFound(new { hata = "Görselin süresi dolmuş." });

        return PhysicalFile(yol, "image/jpeg");
    }

    /* ==================================================================== */
    /* Güncelleme                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Durum, öncelik, kategori ve atama değişikliği.
    ///
    /// Tek uçta toplandı: panelde bu alanlar aynı formda düzenleniyor ve
    /// her biri için ayrı istek, geçmişe dört ayrı satır düşürüyordu.
    /// </summary>
    [HttpPost("{id:int}/Guncelle")]
    public async Task<IActionResult> Guncelle(int id, [FromBody] GuncelleGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        var kapsam = KapsamBelirle();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT departman_id AS departmanId, acan_kodu AS acanKodu, baslik,
       durum, oncelik
FROM B360_ARIZA WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        /* Yönetme yetkisi görmekten dar: kaydı gören herkes değiştiremez.
           Portal rolünde arıza "yalnız görür" ise yönetmez (13.10.2026). */
        var yonetir = _erisim.Yonetir(User, (int?)kayit.departmanId);

        if (!yonetir) return StatusCode(403, new { hata = "Bu kaydı yönetme yetkiniz yok." });

        var degisiklikler = new List<string>();
        var eskiDurum = (string)kayit.durum;

        if (!string.IsNullOrWhiteSpace(girdi?.Durum) && girdi.Durum != eskiDurum)
        {
            if (!Durumlar.Contains(girdi.Durum))
                return BadRequest(new { hata = "Geçersiz durum." });

            db.Execute(@"
UPDATE B360_ARIZA
SET durum = @durum,
    cozum_zamani = CASE WHEN @durum = N'cozuldu' AND cozum_zamani IS NULL
                        THEN SYSDATETIME() ELSE cozum_zamani END,
    kapanma = CASE WHEN @durum = N'kapandi' THEN SYSDATETIME() ELSE NULL END
WHERE id = @id", new { id, durum = girdi.Durum });

            degisiklikler.Add($"Durum: {DurumAdi(girdi.Durum)}");
        }

        if (!string.IsNullOrWhiteSpace(girdi?.Oncelik) &&
            girdi.Oncelik != (string)kayit.oncelik)
        {
            if (!Oncelikler.Contains(girdi.Oncelik))
                return BadRequest(new { hata = "Geçersiz öncelik." });

            db.Execute("UPDATE B360_ARIZA SET oncelik = @oncelik WHERE id = @id",
                new { id, oncelik = girdi.Oncelik });

            degisiklikler.Add($"Öncelik: {OncelikAdi(girdi.Oncelik)}");
        }

        if (girdi?.TurId is > 0)
        {
            var turAdi = db.ExecuteScalar<string>(
                "SELECT ad FROM B360_ARIZA_TUR WHERE id = @turId", new { girdi.TurId });

            if (turAdi is not null)
            {
                db.Execute("UPDATE B360_ARIZA SET tur_id = @turId WHERE id = @id",
                    new { id, girdi.TurId });

                degisiklikler.Add($"Kategori: {turAdi}");
            }
        }

        if (girdi?.AtananKodu is not null)
        {
            var bos = string.IsNullOrWhiteSpace(girdi.AtananKodu);
            var atanan = bos ? null : _personel.Getir(girdi.AtananKodu);

            db.Execute(@"
UPDATE B360_ARIZA SET atanan_kodu = @kod, atanan_adi = @ad WHERE id = @id",
                new
                {
                    id,
                    kod = bos ? null : girdi.AtananKodu.Trim(),
                    ad = atanan?.AdSoyad
                });

            degisiklikler.Add(bos ? "Atama kaldırıldı" : $"Atandı: {atanan?.AdSoyad ?? girdi.AtananKodu}");

            if (!bos)
                await _bildirim.Gonder(girdi.AtananKodu,
                    $"Arıza #{id} size atandı", (string)kayit.baslik, "Ariza");
        }

        if (degisiklikler.Count == 0 && string.IsNullOrWhiteSpace(girdi?.Aciklama))
            return Ok(new { basarili = true, degisiklik = false });

        db.Execute(@"
INSERT INTO B360_ARIZA_HAREKET (ariza_id, durum, aciklama, yapan)
VALUES (@id, @durum, @aciklama, @yapan)",
            new
            {
                id,
                durum = girdi?.Durum,
                aciklama = string.Join(" · ", degisiklikler
                    .Append(girdi?.Aciklama)
                    .Where(x => !string.IsNullOrWhiteSpace(x))),
                yapan = YapanAdi()
            });

        /* Kaydı açana yalnızca durum değiştiğinde haber verilir; her küçük
           düzenlemede bildirim göndermek, bildirimleri okunmaz yapıyor. */
        if (!string.IsNullOrWhiteSpace(girdi?.Durum) && girdi.Durum != eskiDurum)
            await _bildirim.Gonder((string)kayit.acanKodu,
                $"Arıza #{id} · {DurumAdi(girdi.Durum)}", (string)kayit.baslik, "Ariza");

        return Ok(new { basarili = true, degisiklik = true });
    }

    /// <summary>Kayda yorum ekler.</summary>
    [HttpPost("{id:int}/Yorum")]
    public async Task<IActionResult> Yorum(int id, [FromBody] YorumGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (string.IsNullOrWhiteSpace(girdi?.Metin))
            return BadRequest(new { hata = "Yorum boş olamaz." });

        var kapsam = KapsamBelirle();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault($@"
SELECT A.id, A.acan_kodu AS acanKodu, A.baslik, A.departman_id AS departmanId
FROM B360_ARIZA A WHERE A.id = @id AND {Kosul(kapsam)}",
            Kapsam(kapsam, new { id }));

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        var yonetir = _erisim.Yonetir(User, (int?)kayit.departmanId);

        /* İç not ve çözüm işaretleme yalnızca yönetenlerde: kaydı açan
           kendi kaydını çözülmüş ilan edemez. */
        var icNot = girdi.IcNot && yonetir;
        var cozum = girdi.Cozum && yonetir;

        db.Execute(@"
INSERT INTO B360_ARIZA_YORUM (ariza_id, metin, ic_not, cozum, yazan_kodu, yazan_adi)
VALUES (@id, @metin, @icNot, @cozum, @kod, @ad)",
            new
            {
                id,
                metin = girdi.Metin.Trim(),
                icNot,
                cozum,
                kod = Sicil ?? Kullanici,
                ad = YapanAdi()
            });

        if (cozum)
        {
            db.Execute(@"
UPDATE B360_ARIZA
SET durum = N'cozuldu',
    cozum_zamani = CASE WHEN cozum_zamani IS NULL THEN SYSDATETIME() ELSE cozum_zamani END
WHERE id = @id", new { id });

            db.Execute(@"
INSERT INTO B360_ARIZA_HAREKET (ariza_id, durum, aciklama, yapan)
VALUES (@id, N'cozuldu', N'Çözüm yazıldı', @yapan)",
                new { id, yapan = YapanAdi() });
        }

        /* İç not kaydı açana gitmez; ona bildirim de gitmemeli */
        if (!icNot)
            await _bildirim.Gonder((string)kayit.acanKodu,
                $"Arıza #{id} · yeni yorum", (string)kayit.baslik, "Ariza");

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Kategoriler (okuma)                                                  */
    /* ==================================================================== */

    /// <summary>
    /// Kategori listesi.
    ///
    /// Tanımlama Yönetim sayfasından yapılıyor; burası yalnızca okuma.
    /// Kayıt açma ekranı ve süzgeçler bunu kullanıyor.
    /// </summary>
    [HttpGet("Turler")]
    public IActionResult Turler()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, ad, departman_id AS departmanId, aciklama, sla_saat AS slaSaat,
       cihaz_turleri AS cihazTurleri, aktif, sira
FROM B360_ARIZA_TUR WHERE aktif = 1 ORDER BY sira, ad").ToList());
    }

    /* ==================================================================== */

    private static string DurumAdi(string kod) => kod switch
    {
        "acik" => "Açık",
        "devam" => "Devam ediyor",
        "beklemede" => "Beklemede",
        "cozuldu" => "Çözüldü",
        "kapandi" => "Kapandı",
        _ => kod
    };

    private static string OncelikAdi(string kod) => kod switch
    {
        "dusuk" => "Düşük",
        "orta" => "Orta",
        "yuksek" => "Yüksek",
        "acil" => "Acil",
        _ => kod
    };

    /// <summary>
    /// Departmanın temsilcilerine yeni kaydı bildirir.
    ///
    /// Temsilcisi tanımlı değilse kimseye gitmez; kayıt yine de açılır ve
    /// panelde görünür.
    /// </summary>
    private async Task TemsilcilereHaberVer(System.Data.IDbConnection db,
        int departmanId, int arizaId, string baslik, string sube, string departman)
    {
        var temsilciler = db.Query<string>(
            "SELECT personel_kodu FROM B360_DEPARTMAN_TEMSILCI WHERE departman_id = @departmanId",
            new { departmanId }).ToList();

        var metin = string.IsNullOrWhiteSpace(sube) ? baslik : $"{sube} · {baslik}";

        await _bildirim.CokluGonder(temsilciler,
            $"Yeni arıza kaydı · {departman}", metin, "Ariza");
    }
}

/* ========================================================================== */

public class ArizaGirdi
{
    public int DepartmanId { get; set; }
    public int TurId { get; set; }
    public int EnvanterId { get; set; }
    /// <summary>Akış kullanılan kayıtlarda boş gelir; başlık özetten yazılır.</summary>
    public string Baslik { get; set; }

    public string Aciklama { get; set; }
    public string Oncelik { get; set; }

    /// <summary>Panelden açılırken mağaza seçilir; mobilde kişinin kendi mağazası.</summary>
    public string SubeKodu { get; set; }

    /// <summary>
    /// Soru akışında yapılan seçimler, sırasıyla.
    ///
    /// Yalnızca adım kimliği ve (isteniyorsa) açıklama taşınır; soru ve
    /// cevap metinleri sunucuda tablodan okunur.
    /// </summary>
    public List<AkisYanitGirdi> Yanitlar { get; set; } = new();
}

public class GuncelleGirdi
{
    /// <summary>acik · devam · beklemede · cozuldu · kapandi</summary>
    public string Durum { get; set; }

    /// <summary>dusuk · orta · yuksek · acil</summary>
    public string Oncelik { get; set; }

    public int TurId { get; set; }

    /// <summary>Personel sicil numarası; boş dizi atamayı kaldırır.</summary>
    public string AtananKodu { get; set; }

    public string Aciklama { get; set; }
}

public class YorumGirdi
{
    public string Metin { get; set; }

    /// <summary>Kaydı açana gösterilmez; ekip içi not.</summary>
    public bool IcNot { get; set; }

    /// <summary>İşaretlenirse kayıt "çözüldü" durumuna geçer.</summary>
    public bool Cozum { get; set; }
}

using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Mobil uygulamanın Biçen360 tarafı.
///
/// <para>
/// Uygulama iki API'ye birden soruyor: İK modülleri (vardiya, izin, prim,
/// duyuru, iş emri) Kariyer API'den, bu paneldeki modüller buradan geliyor.
/// İki liste uygulamada birleştiriliyor.
/// </para>
///
/// <para>
/// Neden tek listede toplanmadı: iki API'nin modül kataloğu ayrı yerlerde
/// duruyor ve yetkileri farklı tablolardan okunuyor. Kariyer'in listesini
/// buraya taşımak, İK modüllerinin yetkisini de buraya taşımak demekti; o
/// ayrı bir göç işi.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Personel")]
public class MobilController : ControllerBase
{
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly VeritabaniServisi _vt;
    private readonly RaporKapsami _kapsam;
    private readonly KapsamServisi _grupKapsam;
    private readonly ILogger<MobilController> _kayit;

    public MobilController(
        YetkiServisi yetki,
        PersonelServisi personel,
        VeritabaniServisi vt,
        RaporKapsami kapsam,
        KapsamServisi grupKapsam,
        ILogger<MobilController> kayit)
    {
        _yetki = yetki;
        _personel = personel;
        _vt = vt;
        _kapsam = kapsam;
        _grupKapsam = grupKapsam;
        _kayit = kayit;
    }

    /// <summary>
    /// Envanterde bu kişinin görebileceği cihazlar: şube listesi,
    /// departman listesi ya da hepsi.
    ///
    /// <para>
    /// Sıra: "Envanter · yönetici" yetkisi her şeyi açıyor. Sonra grup
    /// ayarındaki envanter kapsamı (Yetkiler → Gruplar → gruba tıkla).
    /// Ayar yoksa eski kural: departman temsilcisi kendi departmanlarını,
    /// diğerleri kendi şubesini görüyor.
    /// </para>
    ///
    /// <para>
    /// Dört uç (şube listesi, cihaz listesi, arıza geçmişi, etiket okutma)
    /// aynı süzgeci kullanıyor. Eskiden dördünde de kural ayrı ayrı
    /// yazılıydı ve birinde yapılan değişiklik diğerlerinde eksik kalıyordu.
    /// </para>
    ///
    /// <para>
    /// Listeler hiçbir zaman boş dönmüyor: SQL'deki IN boş listeyle
    /// çalışmıyor, eşleşmeyecek bir değer konuyor.
    /// </para>
    /// </summary>
    private (bool Hepsi, List<string> Subeler, List<int> Departmanlar) EnvanterKapsami(
        List<int> temsilciDepartmanlari, bool envanterYoneticisi,
        string sicil, PersonelServisi.Bilgi kisi)
    {
        var bosSube = new List<string> { "#yok#" };
        var bosDepartman = new List<int> { -1 };

        if (envanterYoneticisi) return (true, bosSube, bosDepartman);

        var ayar = _grupKapsam.KisininAyari(kisi?.Pozisyon);

        if (!string.IsNullOrWhiteSpace(ayar?.EnvanterKapsami))
        {
            var c = _grupKapsam.Coz(ayar.EnvanterKapsami, ayar, sicil, kisi?.Sube);

            if (c.Hepsi) return (true, bosSube, bosDepartman);

            var d = temsilciDepartmanlari.Concat(c.Departmanlar).Distinct().ToList();

            /* "Yalnızca kendisi" envanterde zimmet demek değil, şube:
               cihaz kişiye değil mağazaya bağlı. */
            var s = ayar.EnvanterKapsami == "kendi" && !string.IsNullOrWhiteSpace(kisi?.Sube)
                ? new List<string> { kisi.Sube }
                : c.Subeler;

            return (false,
                s.Count > 0 ? s : bosSube,
                d.Count > 0 ? d : bosDepartman);
        }

        if (temsilciDepartmanlari.Count > 0)
            return (false, bosSube, temsilciDepartmanlari);

        return (false,
            string.IsNullOrWhiteSpace(kisi?.Sube) ? bosSube : new List<string> { kisi.Sube },
            bosDepartman);
    }

    /// <summary>
    /// Ekranı Kariyer servisinde olan modüller.
    ///
    /// Yetkileri portalden veriliyor ama menü satırını Kariyer servisi
    /// sunuyor; ikisi birden sunsaydı mobil menüde aynı modül iki kez
    /// çıkardı.
    /// </summary>
    private static readonly HashSet<string> KARIYER_MODULLERI = new()
    {
        "ikrapor", "vardiya", "izin", "prim", "performans",
        "duyuru", "isemri", "checklist", "kunye",
        /* Ekranı 1.6da; sürüm denetimi Kariyer tarafında */
        "avans",
        /* 1.9 (23.10.2026) */
        "mesajlar", "devamsizlik"
    };

    /// <summary>Jetondaki sicil; "personel:14721|cihaz-abc" biçiminden.</summary>
    private string Sicil
    {
        get
        {
            var ad = User.Identity?.Name ?? "";

            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
                return null;

            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');

            return i < 0 ? govde : govde[..i];
        }
    }

    /// <summary>
    /// Cihazı bulunan şubeler ve sayıları.
    ///
    /// <para>
    /// Binlerce cihazı tek listede vermek telefonda kullanılamıyor. Önce
    /// şube seçiliyor, sonra o şubenin cihazları geliyor.
    /// </para>
    ///
    /// <para>
    /// Mağaza personeline tek şube dönüyor; departman temsilcisine
    /// cihazının bulunduğu bütün şubeler. Sahada işe giden teknik ekip
    /// gittiği mağazayı listeden seçiyor.
    /// </para>
    /// </summary>
    [HttpGet("EnvanterSubeleri")]
    public IActionResult EnvanterSubeleri()
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return BadRequest(new { hata = "Personel kaydınız bulunamadı." });

        using var db = _vt.Baglanti();

        var departmanlar = db.Query<int>(@"
SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI
WHERE personel_kodu = @sicil", new { sicil }).ToList();

        /* "Envanter · yönetici" yetkisi olan kişi bütün şubeleri görüyor */
        var envanterYoneticisi = _yetki
            .Modulleri(sicil, kisi.Pozisyon ?? "")
            .Contains("envanter-yonetici");

        var kapsamE = EnvanterKapsami(departmanlar, envanterYoneticisi, sicil, kisi);

        /* Arızalı cihaz sayısı ayrı bir alt tablodan bağlanıyor: toplama
           işlevinin içine alt sorgu koymak SQL Server'da yasak. */
        var subeler = db.Query(@"
SELECT E.sube_kodu AS subeKodu,
       COUNT(*) AS adet,
       SUM(CASE WHEN AR.envanter_id IS NULL THEN 0 ELSE 1 END) AS arizali
FROM B360_ENVANTER E
    LEFT JOIN (
        SELECT DISTINCT envanter_id
        FROM B360_ARIZA
        WHERE envanter_id IS NOT NULL
          AND durum NOT IN (N'cozuldu', N'kapandi')
    ) AR ON AR.envanter_id = E.id
WHERE E.durum <> N'pasif'
  AND (
        @hepsi = 1
        OR E.departman_id IN @departmanlar
        OR E.sube_kodu IN @subeler
      )
GROUP BY E.sube_kodu
ORDER BY E.sube_kodu",
            new
            {
                subeler = kapsamE.Subeler,
                departmanlar = kapsamE.Departmanlar,
                hepsi = kapsamE.Hepsi ? 1 : 0
            }).ToList();

        /* Temsilci olunan departmanların adları: ekranda 'hangi
           departmanın cihazlarını görüyorum" sorusunun cevabı. */
        var departmanAdlari = kapsamE.Hepsi
            ? db.Query<string>(
                "SELECT ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList()
            : !kapsamE.Departmanlar.Any(x => x > 0)
            ? new List<string>()
            : db.Query<string>(
                "SELECT ad FROM B360_DEPARTMAN WHERE id IN @departmanlar ORDER BY ad",
                new { departmanlar = kapsamE.Departmanlar }).ToList();

        /* Kapsam etiketi mobilde davranışı belirliyor: "sube" tek şubeyse
           şube adımını atlatıyor. Bölge kapsamında birden çok şube var ve
           şube listesi mutlaka gösterilmeli. */
        var kapsamEtiketi = kapsamE.Hepsi ? "tumu"
            : kapsamE.Departmanlar.Any(x => x > 0) ? "departman"
            : kapsamE.Subeler.Count(x => x != "#yok#") > 1 ? "bolge"
            : "sube";

        return Ok(new
        {
            subeler,
            kapsam = kapsamEtiketi,
            departmanlar = departmanAdlari,
            sube = kisi.Sube,
            toplam = subeler.Sum(x => (int)x.adet)
        });
    }

    /// <summary>
    /// Personelin görebileceği cihazlar.
    ///
    /// <para>
    /// Kapsam kişinin durumuna göre daralıyor: mağazada çalışan yalnızca
    /// kendi şubesindeki cihazları görüyor. Bir departmanın temsilcisi
    /// olan kişi (bilgi teknolojileri gibi) o departmana bağlı bütün
    /// cihazları görüyor, şubeden bağımsız.
    /// </para>
    ///
    /// <para>
    /// Bütün envanteri herkese açmak, mağaza personelinin otuz dört
    /// şubenin cihazları arasında kendi kasasını aramasına yol açardı;
    /// departman ekibini kendi şubesiyle sınırlamak ise sahada işe
    /// gittiği mağazanın cihazını göremez hâle getirirdi.
    /// </para>
    /// </summary>
    [HttpGet("Envanterim")]
    public IActionResult Envanterim(
        [FromQuery] string sube = null,
        [FromQuery] string ara = null,
        [FromQuery] string tur = null)
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return BadRequest(new { hata = "Personel kaydınız bulunamadı." });

        using var db = _vt.Baglanti();

        /* Temsilcisi olunan departmanlar: boşsa kişi mağaza personeli
           sayılıyor ve yalnızca kendi şubesini görüyor. */
        var departmanlar = db.Query<int>(@"
SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI
WHERE personel_kodu = @sicil", new { sicil }).ToList();

        /* "Envanter · yönetici" yetkisi olan kişi departman ve şube
           sınırı olmadan bütün cihazları görüyor. */
        var envanterYoneticisi = _yetki
            .Modulleri(sicil, kisi.Pozisyon ?? "")
            .Contains("envanter-yonetici");

        var kapsamE = EnvanterKapsami(departmanlar, envanterYoneticisi, sicil, kisi);

        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        var kayitlar = db.Query(@"
SELECT E.id, E.sube_kodu AS subeKodu, E.tur, E.marka, E.model,
       E.seri_no AS seriNo, E.sicil_no AS sicilNo, E.sahibi, E.konum,
       E.durum, E.garanti_bitis AS garantiBitis,
       D.ad AS departman,

       (SELECT COUNT(*) FROM B360_ARIZA A
         WHERE A.envanter_id = E.id
           AND A.durum NOT IN (N'cozuldu', N'kapandi')) AS acikAriza,

       /* Kapanmışlar dahil toplam: aynı cihaz üçüncü kez bozuluyorsa
          listede görünmeli, tamir mi değişim mi kararı buna bakıyor. */
       (SELECT COUNT(*) FROM B360_ARIZA A
         WHERE A.envanter_id = E.id) AS toplamAriza,

       (SELECT TOP 1 G.id FROM B360_ENVANTER_GORSEL G
         WHERE G.envanter_id = E.id
         ORDER BY G.kapak DESC, G.id) AS kapakId
FROM B360_ENVANTER E
    LEFT JOIN B360_DEPARTMAN D ON D.id = E.departman_id
WHERE E.durum <> N'pasif'
  AND (
        /* Yönetici yetkisi: departman ve şube sınırı yok */
        @hepsi = 1
        OR E.departman_id IN @departmanlar
        OR E.sube_kodu IN @subeler
      )
  AND (@secilenSube IS NULL OR E.sube_kodu = @secilenSube)
  AND (@tur IS NULL OR E.tur = @tur)
  AND (@kalip IS NULL OR E.marka LIKE @kalip OR E.model LIKE @kalip
       OR E.seri_no LIKE @kalip OR E.sicil_no LIKE @kalip
       OR E.konum LIKE @kalip OR E.tur LIKE @kalip)
ORDER BY E.sube_kodu, E.tur, E.marka, E.model",
            new
            {
                subeler = kapsamE.Subeler,
                secilenSube = string.IsNullOrWhiteSpace(sube) ? null : sube.Trim(),
                departmanlar = kapsamE.Departmanlar,
                hepsi = kapsamE.Hepsi ? 1 : 0,
                tur = string.IsNullOrWhiteSpace(tur) ? null : tur.Trim(),
                kalip
            }).ToList();

        var turler = kayitlar
            .Select(x => (string)x.tur)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new
        {
            kayitlar,
            turler,

            /* Ekranda kapsamın yazması gerekiyor: personel neden bazı
               cihazları göremediğini sormasın. */
            kapsam = kapsamE.Hepsi ? "tumu"
                   : kapsamE.Departmanlar.Any(x => x > 0) ? "departman"
                   : kapsamE.Subeler.Count(x => x != "#yok#") > 1 ? "bolge"
                   : "sube",
            sube = kisi.Sube
        });
    }

    /// <summary>
    /// Cihazın arıza geçmişi.
    ///
    /// <para>
    /// Kapanmışlar dahil son kayıtlar. Aynı cihazın kaçıncı kez
    /// bozulduğunu görmek, sahada "yine mi bu kasa" sorusunun cevabı ve
    /// tamir mi değişim mi kararını veriyor.
    /// </para>
    ///
    /// <para>
    /// Kapsam listedekiyle aynı: cihaz görülemiyorsa geçmişi de
    /// görülemiyor. Kimlik doğrudan sorguda denetleniyor; ayrı bir
    /// kontrol yazmak iki yerin ayrışmasına açıktı.
    /// </para>
    /// </summary>
    [HttpGet("EnvanterArizalari/{id:int}")]
    public IActionResult EnvanterArizalari(int id)
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return BadRequest(new { hata = "Personel kaydınız bulunamadı." });

        using var db = _vt.Baglanti();

        var departmanlar = db.Query<int>(@"
SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI
WHERE personel_kodu = @sicil", new { sicil }).ToList();

        var envanterYoneticisi = _yetki
            .Modulleri(sicil, kisi.Pozisyon ?? "")
            .Contains("envanter-yonetici");

        var kapsamE = EnvanterKapsami(departmanlar, envanterYoneticisi, sicil, kisi);

        var gorebilir = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM B360_ENVANTER E
WHERE E.id = @id
  AND (
        @hepsi = 1
        OR E.departman_id IN @departmanlar
        OR E.sube_kodu IN @subeler
      )",
            new
            {
                id,
                subeler = kapsamE.Subeler,
                departmanlar = kapsamE.Departmanlar,
                hepsi = kapsamE.Hepsi ? 1 : 0
            }) > 0;

        if (!gorebilir) return Forbid();

        var kayitlar = db.Query(@"
SELECT TOP 8 A.id, A.baslik, A.durum, A.oncelik,
       A.olusturma, A.cozum_zamani AS cozumZamani,
       A.acan_adi AS acanAdi, A.sube_kodu AS subeKodu,
       T.ad AS turAdi
FROM B360_ARIZA A
    LEFT JOIN B360_ARIZA_TUR T ON T.id = A.tur_id
WHERE A.envanter_id = @id
ORDER BY A.olusturma DESC", new { id }).ToList();

        return Ok(new { kayitlar, toplam = kayitlar.Count });
    }

    /// <summary>
    /// Sicil ya da seri numarasından cihaz bulur.
    ///
    /// <para>
    /// Cihazın üzerindeki etiket okutulduğunda çağrılıyor. Numarayı elle
    /// yazmak hem yavaştı hem de bir hanesi yanlış girilince başka bir
    /// cihaza kayıt açılmasına yol açıyordu.
    /// </para>
    ///
    /// <para>
    /// Karekod yalnızca numarayı taşıyor; adres ya da bağlantı değil.
    /// Etiketler yeniden basıldığında adresin değişmesi gerekmesin diye.
    /// </para>
    /// </summary>
    [HttpGet("EnvanterBul")]
    public IActionResult EnvanterBul([FromQuery] string kod)
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var aranan = (kod ?? "").Trim();

        if (aranan.Length < 3)
            return BadRequest(new { hata = "Okunan kod geçersiz." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return BadRequest(new { hata = "Personel kaydınız bulunamadı." });

        using var db = _vt.Baglanti();

        var departmanlar = db.Query<int>(@"
SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI
WHERE personel_kodu = @sicil", new { sicil }).ToList();

        var envanterYoneticisi = _yetki
            .Modulleri(sicil, kisi.Pozisyon ?? "")
            .Contains("envanter-yonetici");

        var kapsamE = EnvanterKapsami(departmanlar, envanterYoneticisi, sicil, kisi);

        var cihaz = db.QueryFirstOrDefault(@"
SELECT TOP 1 E.id, E.sube_kodu AS subeKodu, E.tur, E.marka, E.model,
       E.sicil_no AS sicilNo, E.seri_no AS seriNo, E.sahibi, E.konum,
       E.garanti_bitis AS garantiBitis, D.ad AS departman,

       (SELECT COUNT(*) FROM B360_ARIZA A
         WHERE A.envanter_id = E.id
           AND A.durum NOT IN (N'cozuldu', N'kapandi')) AS acikAriza,

       (SELECT COUNT(*) FROM B360_ARIZA A
         WHERE A.envanter_id = E.id) AS toplamAriza,

       (SELECT TOP 1 G.id FROM B360_ENVANTER_GORSEL G
         WHERE G.envanter_id = E.id
         ORDER BY G.kapak DESC, G.id) AS kapakId
FROM B360_ENVANTER E
    LEFT JOIN B360_DEPARTMAN D ON D.id = E.departman_id
WHERE E.durum <> N'pasif'
  AND (E.sicil_no = @aranan OR E.seri_no = @aranan)
  AND (
        @hepsi = 1
        OR E.departman_id IN @departmanlar
        OR E.sube_kodu IN @subeler
      )",
            new
            {
                aranan,
                subeler = kapsamE.Subeler,
                departmanlar = kapsamE.Departmanlar,
                hepsi = kapsamE.Hepsi ? 1 : 0
            });

        /* Kayıt var ama kapsam dışındaysa da aynı yanıt dönüyor: hangi
           numaraların var olduğunu kapsam dışından öğrenmek gereksiz. */
        if (cihaz is null)
            return Ok(new
            {
                bulundu = false,
                bilgi = $"\"{aranan}\" numaralı cihaz bulunamadı ya da "
                      + "görebileceğiniz cihazlar arasında değil."
            });

        return Ok(new { bulundu = true, cihaz });
    }

    /// <summary>
    /// Mobil rapor özeti.
    ///
    /// <para>
    /// Arıza, maliyet, rakip fiyat ve künye özetleri tek istekte; telefon
    /// dört ayrı istek atıp dört ayrı bekleme göstermemeli. Grafiklerin
    /// hesabı sunucuda yapılıyor ve hazır dilimler dönüyor: ham kayıtları
    /// telefona gönderip orada gruplamak hem yavaş hem de mağaza
    /// hattında pahalı.
    /// </para>
    ///
    /// <para>
    /// Kapsam kişinin görevlerinden çıkarılıyor: bütün departmanların
    /// temsilcisi olan hepsini, birkaçının temsilcisi olan onları görür.
    /// Temsilci değilse arıza ve maliyet boş döner, fiyat ve künye kendi
    /// şubesiyle sınırlanır. Ayrı bir "tümünü gör" yetkisi tutmak, aynı
    /// bilgiyi iki yerde sürdürmek demekti.
    /// </para>
    /// </summary>
    [HttpGet("Rapor")]
    public IActionResult Rapor(
        [FromQuery] int gun = 30,
        [FromQuery] int? departmanId = null,

        /* Serbest tarih aralığı: hazır 7/30/90 gün seçenekleri geçmiş bir
           dönemi incelemeye yetmiyordu. Verilirse gün sayısı yok sayılır. */
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null)
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return BadRequest(new { hata = "Personel kaydınız bulunamadı." });

        var acik = _yetki.Modulleri(sicil, kisi.Pozisyon ?? "");

        if (!acik.Contains("rapor"))
            return StatusCode(403, new { hata = "Raporlar modülüne yetkiniz yok." });

        /* Kapsam ayrı bir yetki satırından değil kişinin görevlerinden:
           bütün departmanların temsilcisi olan hepsini, birkaçının
           temsilcisi olan onları görüyor. */
        var benim = _kapsam.Mobil(sicil, kisi.Sube, acik.Contains("rapor-yonetici"));
        var tumunuGorur = benim.TumunuGorur;

        if (gun is < 1 or > 365) gun = 30;

        using var db = _vt.Baglanti();

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-gun + 1);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1);

        var kendi = benim.Departmanlar;

        /* Sorgulanacak departmanlar */
        List<int> kapsam;

        if (tumunuGorur)
            kapsam = departmanId is int d ? new List<int> { d } : new List<int>();
        else if (departmanId is int istenen)
            kapsam = kendi.Contains(istenen) ? new List<int> { istenen } : new List<int> { -1 };
        else
            kapsam = kendi.Count > 0 ? kendi : new List<int> { -1 };

        var hepsi = kapsam.Count == 0 && tumunuGorur ? 1 : 0;
        var kapsamListesi = kapsam.Count > 0 ? kapsam : new List<int> { -1 };

        /* ------------------------------------------------------- arıza */

        var arizalar = db.Query(@"
SELECT a.durum, a.oncelik, a.sube_kodu AS subeKodu, a.olusturma, a.maliyet,
       a.sla_bitis AS slaBitis, a.cozum_zamani AS cozumZamani,
       d.ad AS departman, e.tur AS cihazTuru
FROM B360_ARIZA a
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
    LEFT JOIN B360_ENVANTER e ON e.id = a.envanter_id
WHERE a.olusturma >= @baslangic AND a.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)",
            new { baslangic, bitis, hepsi, kapsam = kapsamListesi }).ToList();

        int Say(params string[] durumlar) =>
            arizalar.Count(x => durumlar.Contains((string)x.durum ?? ""));

        var cozumler = arizalar
            .Where(x => x.cozumZamani is not null)
            .Select(x => ((DateTime)x.cozumZamani - (DateTime)x.olusturma).TotalHours)
            .ToList();

        List<object> Grupla(IEnumerable<dynamic> kayitlar, string alan, int enCok = 8) =>
            kayitlar
                .GroupBy(x => (string)((IDictionary<string, object>)x)[alan] ?? "—")
                .Select(g => new { ad = g.Key, deger = g.Count() })
                .OrderByDescending(x => x.deger)
                .Take(enCok)
                .Cast<object>()
                .ToList();

        var gunluk = Enumerable.Range(0, gun)
            .Select(i => baslangic.AddDays(i))
            .Select(g => new
            {
                etiket = g.ToString("dd.MM"),
                deger = arizalar.Count(x => ((DateTime)x.olusturma).Date == g)
            })
            .ToList();

        /* ----------------------------------------------------- maliyet */

        var formlar = db.Query(@"
SELECT f.mudahale, f.parca_tutari AS parcaTutari, f.iscilik, f.toplam,
       a.sube_kodu AS subeKodu, d.ad AS departman
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)",
            new { baslangic, bitis, hepsi, kapsam = kapsamListesi }).ToList();

        decimal Topla(IEnumerable<dynamic> k, string alan) =>
            k.Sum(x => ((IDictionary<string, object>)x)[alan] is decimal d ? d : 0m);

        List<object> ToplaGrupla(IEnumerable<dynamic> k, string alan, int enCok = 8) =>
            k.GroupBy(x => (string)((IDictionary<string, object>)x)[alan] ?? "—")
             .Select(g => new { ad = g.Key, deger = Topla(g, "toplam") })
             .OrderByDescending(x => x.deger)
             .Take(enCok)
             .Cast<object>()
             .ToList();

        /* ------------------------------------------- rakip fiyat, künye */

        /* Fiyat ve künye departmana bağlı değil; tümünü görmeyen kişi
           yalnızca kendi şubesini görür. */
        var subeSiniri = tumunuGorur ? null : kisi.Sube;

        var rakip = db.Query(@"
SELECT r.bizim_fiyat AS bizimFiyat, r.rakip_fiyat AS rakipFiyat, r.sube_kodu AS subeKodu,
       fi.ad AS rakip
FROM B360_RAKIP_FIYAT r
    LEFT JOIN B360_RAKIP_FIRMA fi ON fi.id = r.firma_id
WHERE r.olusturma >= @baslangic AND r.olusturma < @bitis
  AND (@sube IS NULL OR r.sube_kodu = @sube)",
            new { baslangic, bitis, sube = subeSiniri }).ToList();

        var kunyeAdet = 0;
        var kunyePahali = 0;
        var kunyeUcuz = 0;

        /* Künye kırılımları: şube, sorgulayan ve rakip işletme. Yalnızca
           sayı göstermek yetmiyordu; hangi şubenin kaç künye okuttuğu ve
           hangi rakibin fiyatlarının karşılaştırıldığı soruluyor. */
        List<object> kunyeSubeler = new();
        List<object> kunyeSorgulayanlar = new();
        List<object> kunyeRakipler = new();

        try
        {
            var kunyeler = db.Query(@"
SELECT fark, sube_adi AS subeAdi, personel_adi AS personelAdi,
       rakip_isletme AS rakipIsletme
FROM KRY_KUNYE_ANALIZ
WHERE olusturma >= @baslangic AND olusturma < @bitis
  AND (@sube IS NULL OR sube_adi = @sube)",
                new { baslangic, bitis, sube = subeSiniri }).ToList();

            kunyeAdet = kunyeler.Count;
            kunyePahali = kunyeler.Count(x => x.fark is decimal f && f > 0);
            kunyeUcuz = kunyeler.Count(x => x.fark is decimal f && f < 0);

            kunyeSubeler = Grupla(kunyeler, "subeAdi", 10);
            kunyeSorgulayanlar = Grupla(kunyeler, "personelAdi", 10);
            kunyeRakipler = Grupla(
                kunyeler.Where(x => x.rakipIsletme is not null), "rakipIsletme", 10);
        }
        catch
        {
            /* Künye tablosu yoksa sıfır kalır; rapor yine açılır */
        }

        var departmanlar = tumunuGorur
            ? db.Query(@"SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList()
            : kendi.Count == 0
                ? new List<dynamic>()
                : db.Query(@"SELECT id, ad FROM B360_DEPARTMAN WHERE id IN @kendi ORDER BY ad",
                    new { kendi }).ToList();

        return Ok(new
        {
            gun,
            tumunuGorur,
            departmanlar,

            ariza = new
            {
                toplam = arizalar.Count,
                acik = Say("acik", "yeni"),
                islemde = Say("islemde", "atandi"),
                beklemede = Say("beklemede"),
                cozuldu = Say("cozuldu"),
                kapandi = Say("kapandi"),
                geciken = arizalar.Count(x =>
                    x.slaBitis is DateTime s && s < DateTime.Now
                    && !new[] { "cozuldu", "kapandi", "iptal" }.Contains((string)x.durum ?? "")),
                ortalamaSaat = cozumler.Count > 0 ? Math.Round(cozumler.Average(), 1) : (double?)null,
                maliyet = Topla(arizalar, "maliyet"),
                gunluk,
                departmanlar = Grupla(arizalar, "departman"),
                subeler = Grupla(arizalar, "subeKodu"),
                cihazlar = Grupla(arizalar.Where(x => x.cihazTuru is not null), "cihazTuru", 6),
                oncelik = new
                {
                    yuksek = arizalar.Count(x => (string)x.oncelik == "yuksek"),
                    orta = arizalar.Count(x => (string)x.oncelik == "orta"),
                    dusuk = arizalar.Count(x => (string)x.oncelik == "dusuk")
                }
            },

            maliyet = new
            {
                adet = formlar.Count,
                toplam = Topla(formlar, "toplam"),
                parca = Topla(formlar, "parcaTutari"),
                iscilik = Topla(formlar, "iscilik"),
                subeler = ToplaGrupla(formlar, "subeKodu"),
                departmanlar = ToplaGrupla(formlar, "departman"),
                mudahale = new
                {
                    uzaktan = formlar.Count(x => (string)x.mudahale == "uzaktan"),
                    yerinde = formlar.Count(x => (string)x.mudahale == "yerinde"),
                    merkezde = formlar.Count(x => (string)x.mudahale == "merkezde")
                }
            },

            rakip = new
            {
                adet = rakip.Count,
                pahali = rakip.Count(x => x.bizimFiyat is decimal b && x.rakipFiyat is decimal r && b > r),
                ucuz = rakip.Count(x => x.bizimFiyat is decimal b && x.rakipFiyat is decimal r && b < r),
                rakipler = Grupla(rakip, "rakip"),
                subeler = Grupla(rakip, "subeKodu")
            },

            kunye = new
            {
                adet = kunyeAdet,
                pahali = kunyePahali,
                ucuz = kunyeUcuz,
                subeler = kunyeSubeler,
                sorgulayanlar = kunyeSorgulayanlar,
                rakipler = kunyeRakipler
            }
        });
    }

    /// <summary>
    /// Rapor kırılımının ayrıntısı.
    ///
    /// <para>
    /// Rapordaki bir satıra dokunulunca o satırı oluşturan kayıtlar
    /// dönüyor. Sayıyı görmek yetmiyor; "on iki arıza" satırının hangi
    /// kayıtlar olduğu soruluyor ve tek tek aramak gerekiyordu.
    /// </para>
    ///
    /// <para>
    /// Kapsam rapor ucuyla aynı: kişi raporda göremediği bir departmanın
    /// ayrıntısını da göremiyor.
    /// </para>
    /// </summary>
    [HttpGet("RaporKirilim")]
    public IActionResult RaporKirilim(
        [FromQuery] string bolum,
        [FromQuery] string alan,
        [FromQuery] string deger,
        [FromQuery] int gun = 30,
        [FromQuery] int? departmanId = null,
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null)
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kisi = _personel.Getir(sicil);

        if (kisi is null)
            return BadRequest(new { hata = "Personel kaydınız bulunamadı." });

        var acik = _yetki.Modulleri(sicil, kisi.Pozisyon ?? "");

        if (!acik.Contains("rapor"))
            return StatusCode(403, new { hata = "Raporlar modülüne yetkiniz yok." });

        if (gun is < 1 or > 365) gun = 30;

        var benim = _kapsam.Mobil(sicil, kisi.Sube, acik.Contains("rapor-yonetici"));

        using var db = _vt.Baglanti();

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-gun + 1);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1);

        var kapsam = benim.TumunuGorur
            ? (departmanId is int d ? new List<int> { d } : new List<int>())
            : benim.Departmanlar;

        var hepsi = kapsam.Count == 0 && benim.TumunuGorur ? 1 : 0;
        var kapsamListesi = kapsam.Count > 0 ? kapsam : new List<int> { -1 };

        /* Süzülecek alan adı listeden seçiliyor: dışarıdan gelen metni
           doğrudan sorguya koymak enjeksiyon riski. */
        var sutun = (bolum, alan) switch
        {
            ("ariza", "departman") => "d.ad",
            ("ariza", "sube") => "a.sube_kodu",
            ("ariza", "durum") => "a.durum",
            ("ariza", "oncelik") => "a.oncelik",
            ("ariza", "cihaz") => "e.tur",

            ("maliyet", "sube") => "a.sube_kodu",
            ("maliyet", "departman") => "d.ad",
            ("maliyet", "mudahale") => "f.mudahale",
            ("maliyet", "cihaz") => "e.tur",

            ("rakip", "rakip") => "fi.ad",
            ("rakip", "sube") => "r.sube_kodu",

            ("kunye", "sube") => "k.sube_adi",
            ("kunye", "sorgulayan") => "k.personel_adi",
            ("kunye", "rakip") => "k.rakip_isletme",

            _ => null
        };

        if (sutun is null)
            return BadRequest(new { hata = "Bu kırılım desteklenmiyor." });

        if (bolum == "ariza")
        {
            var kayitlar = db.Query($@"
SELECT TOP 200 a.id, a.baslik, a.durum, a.oncelik,
       a.sube_kodu AS subeKodu, a.acan_adi AS acanAdi,
       a.atanan_adi AS atananAdi, a.olusturma, a.maliyet,
       d.ad AS departman, e.tur AS cihazTuru, e.marka, e.model
FROM B360_ARIZA a
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
    LEFT JOIN B360_ENVANTER e ON e.id = a.envanter_id
WHERE a.olusturma >= @baslangic AND a.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)
  AND ISNULL({sutun}, N'—') = @deger
ORDER BY a.olusturma DESC",
                new
                {
                    baslangic,
                    bitis,
                    hepsi,
                    kapsam = kapsamListesi,
                    deger = (deger ?? "").Trim()
                }).ToList();

            return Ok(new { kayitlar, adet = kayitlar.Count });
        }

        if (bolum == "maliyet")
        {
            var kayitlar = db.Query($@"
SELECT TOP 200 f.id, f.form_no AS formNo, f.olusturma, f.mudahale,
       f.parca_tutari AS parcaTutari, f.iscilik, f.toplam,
       f.teknisyen, f.servis_firma AS servisFirma,
       a.baslik, a.sube_kodu AS subeKodu, d.ad AS departman,
       e.tur AS cihazTuru, e.marka, e.model
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
    LEFT JOIN B360_ENVANTER e ON e.id = f.envanter_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@hepsi = 1 OR a.departman_id IN @kapsam)
  AND ISNULL({sutun}, N'—') = @deger
ORDER BY f.olusturma DESC",
                new { baslangic, bitis, hepsi, kapsam = kapsamListesi, deger = (deger ?? "").Trim() })
                .ToList();

            return Ok(new { kayitlar, adet = kayitlar.Count });
        }

        /* Rakip fiyat ve künye departmana bağlı değil; yönetici yetkisi
           olmayan kişi yalnızca kendi şubesini görüyor. */
        var subeSiniri = benim.TumunuGorur ? null : kisi.Sube;

        if (bolum == "rakip")
        {
            var kayitlar = db.Query($@"
SELECT TOP 200 r.id, r.urun_adi AS urunAdi, r.barkod,
       r.sube_kodu AS subeKodu, r.bizim_fiyat AS bizimFiyat,
       r.rakip_fiyat AS rakipFiyat, r.fark, r.fark_yuzde AS farkYuzde,
       r.olusturma, r.personel_adi AS kaydedenAdi, fi.ad AS rakip
FROM B360_RAKIP_FIYAT r
    LEFT JOIN B360_RAKIP_FIRMA fi ON fi.id = r.firma_id
WHERE r.olusturma >= @baslangic AND r.olusturma < @bitis
  AND (@sube IS NULL OR r.sube_kodu = @sube)
  AND ISNULL({sutun}, N'—') = @deger
ORDER BY r.olusturma DESC",
                new { baslangic, bitis, sube = subeSiniri, deger = (deger ?? "").Trim() })
                .ToList();

            return Ok(new { kayitlar, adet = kayitlar.Count });
        }

        if (bolum == "kunye")
        {
            try
            {
                var kayitlar = db.Query($@"
SELECT TOP 200 k.id, k.kunye_no AS kunyeNo, k.urun_adi AS urunAdi,
       k.uretici, k.rakip_isletme AS rakipIsletme,
       k.rakip_fiyat AS rakipFiyat, k.bizim_fiyat AS bizimFiyat, k.fark,
       k.sube_adi AS subeKodu, k.personel_adi AS sorgulayan, k.olusturma
FROM KRY_KUNYE_ANALIZ k
WHERE k.olusturma >= @baslangic AND k.olusturma < @bitis
  AND (@sube IS NULL OR k.sube_adi = @sube)
  AND ISNULL({sutun}, N'—') = @deger
ORDER BY k.olusturma DESC",
                    new { baslangic, bitis, sube = subeSiniri, deger = (deger ?? "").Trim() })
                    .ToList();

                return Ok(new { kayitlar, adet = kayitlar.Count });
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Künye kırılımı okunamadı");

                return Ok(new { kayitlar = new List<object>(), adet = 0,
                                uyari = "Künye kayıtlarına ulaşılamadı." });
            }
        }

        return BadRequest(new { hata = "Bu bölüm desteklenmiyor." });
    }

    /// <summary>Kişinin görebileceği Biçen360 modülleri.</summary>
    [HttpGet("Modullerim")]
    public IActionResult Modullerim()
    {
        var sicil = Sicil;

        if (string.IsNullOrWhiteSpace(sicil))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kisi = _personel.Getir(sicil);
        var pozisyon = kisi?.Pozisyon ?? "";

        var acik = _yetki.Modulleri(sicil, pozisyon);

        return Ok(new
        {
            moduller = Katalog.MobilModuller
                .Where(m => acik.Contains(m.Kod))

                /* "-yonetici" ile biten kodlar ekran değil yetki: ilgili
                   modülün kapsamını genişletiyorlar. Menüde satır olarak
                   çıkınca dokunulduğunda açılacak bir ekran olmuyordu. */
                /* Ekran karşılığı olmayan ya da ekranı Kariyer servisinde
                   olan kodlar listeye girmiyor: menüde açılmayan satır
                   çıkar ya da aynı modül iki kez görünürdü. */
                .Where(m => !m.Kod.EndsWith("-yonetici", StringComparison.Ordinal)
                         && !KARIYER_MODULLERI.Contains(m.Kod))
                .Select(m => new
                {
                    kod = m.Kod,
                    ad = m.Ad,
                    aciklama = m.Aciklama,
                    simge = m.Simge
                }),

            gorev = pozisyon,
            sube = kisi?.Sube,

            /* Ana sayfadaki Biçen Kartım şeridi ve Bu Ay Mesai kutusu
               portaldan tek anahtarla açılıp kapatılıyor. */
            anaSayfaKartlari = YetkiController.AnaSayfaKartlariOku(_vt),
        });
    }
}

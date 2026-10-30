using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Kontrol listeleri.
///
/// <para>
/// Yönetici, bölge koordinatörü ya da bölge müdürü bir liste tanımlar ve
/// hedef kitleyi pozisyona göre seçer. O pozisyondaki personel mobil
/// uygulamada listeyi görür: maddeyi işaretler, fotoğraf ekler, yorum yazar.
/// Panelde kimin doldurduğu, hangi mağaza olduğu ve eklenen görseller
/// görünür; yönetici puan ve değerlendirme yazabilir.
/// </para>
///
/// <para>
/// Görseller diskte tutulur ve yedi gün sonra silinir. Kayıtlar durur;
/// yalnızca dosya gider, çünkü hacim hızla büyüyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class ChecklistController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly IWebHostEnvironment _ortam;
    private readonly BildirimServisi _bildirim;
    private readonly AyarServisi _ayar;
    private readonly ILogger<ChecklistController> _kayit;

    public ChecklistController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        IWebHostEnvironment ortam,
        BildirimServisi bildirim,
        AyarServisi ayar,
        ILogger<ChecklistController> kayit)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _ortam = ortam;
        _bildirim = bildirim;
        _ayar = ayar;
        _kayit = kayit;
    }

    /// <summary>
    /// Liste oluşturabilen roller.
    ///
    /// Bölge koordinatörü ve bölge müdürü de burada: sahadaki kontrolü
    /// onlar tanımlıyor, İK'dan geçmesini beklemek işi yavaşlatırdı.
    /// </summary>
    private const string TanimYetkisi =
        Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi
        + "," + Roller.BolgeKoordinatoru + "," + Roller.BolgeMuduru;

    /// <summary>Görüntüleme: tüm panel kullanıcıları.</summary>
    private const string GorumeYetkisi = TanimYetkisi + "," + Roller.IK;

    private string Kullanici => User.Identity?.Name ?? "";

    private string Rol =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>Bölge müdürüne tanımlı şubeler (Yönetim - Kullanicilar).</summary>
    private string[] YetkiliSubeler() =>
        (User?.FindFirst("subeler")?.Value ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

    /// <summary>Bolge muduru yalnizca kendi subelerini gorur.</summary>
    private bool KendiBolgesiyleSinirli => Rol == Roller.BolgeMuduru;

    /// <summary>
    /// Suzme sunucuda yapilir: panelde sutun gizlemek veriyi engellemez,
    /// istek dogrudan da atilabilir.
    /// </summary>
    private bool SubeGorebilir(string sube)
    {
        if (!KendiBolgesiyleSinirli) return true;

        var yetkili = YetkiliSubeler();

        /* Sube tanimi yoksa hicbir sey gormez: bos yetkiyi 'her sey'
           saymak yanlis tarafta hata yapmak olurdu. */
        if (yetkili.Length == 0) return false;

        return yetkili.Any(k =>
            (sube ?? "").Contains(k, StringComparison.OrdinalIgnoreCase));
    }

    private string AdSoyad =>
        User.Claims.FirstOrDefault(x => x.Type == "adSoyad")?.Value ?? Kullanici;

    /// <summary>Görsellerin tutulduğu klasör.</summary>
    private string GorselKlasoru
    {
        get
        {
            var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
                ? AppContext.BaseDirectory
                : _ortam.ContentRootPath;

            var yol = Path.Combine(kok, "checklist");

            if (!Directory.Exists(yol)) Directory.CreateDirectory(yol);

            return yol;
        }
    }

    /* ==================================================================== */
    /* Tanımlar                                                             */
    /* ==================================================================== */

    /// <summary>Tanımlı kontrol listeleri.</summary>
    [HttpGet("Listeler")]
    [Authorize(Roles = GorumeYetkisi)]
    public IActionResult Listeler([FromQuery] bool pasifDahil = false)
    {
        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT c.id, c.baslik, c.aciklama, c.pozisyonlar, c.subeler, c.siklik,
       c.bas_saat AS basSaat, c.bit_saat AS bitSaat, c.aktif,
       c.olusturan_ad AS olusturanAd, c.olusturma,
       (SELECT COUNT(*) FROM KRY_CHECKLIST_MADDE m WHERE m.checklist_id = c.id)
           AS maddeSayisi,
       (SELECT COUNT(*) FROM KRY_CHECKLIST_DOLDURMA d
        WHERE d.checklist_id = c.id AND d.gun = CAST(GETDATE() AS DATE))
           AS bugunDolduran
FROM KRY_CHECKLIST c
WHERE (@pasifDahil = 1 OR c.aktif = 1)
ORDER BY c.aktif DESC, c.olusturma DESC", new { pasifDahil }));
    }

    /// <summary>Bir listenin maddeleriyle birlikte tanımı.</summary>
    [HttpGet("{id:int}")]
    [Authorize(Roles = GorumeYetkisi)]
    public IActionResult Tanim(int id)
    {
        using var db = _vt.Baglanti();

        var liste = db.QueryFirstOrDefault(@"
SELECT id, baslik, aciklama, pozisyonlar, subeler, siklik,
       bas_saat AS basSaat, bit_saat AS bitSaat, aktif,
       olusturan_ad AS olusturanAd, olusturma
FROM KRY_CHECKLIST WHERE id = @id", new { id });

        if (liste is null) return NotFound(new { hata = "Liste bulunamadı." });

        var maddeler = db.Query(@"
SELECT id, sira, soru, gorsel_zorunlu AS gorselZorunlu,
       yorum_zorunlu AS yorumZorunlu
FROM KRY_CHECKLIST_MADDE WHERE checklist_id = @id ORDER BY sira, id",
            new { id });

        return Ok(new { liste, maddeler });
    }

    /// <summary>Liste oluşturur ya da günceller.</summary>
    [HttpPost("Kaydet")]
    [Authorize(Roles = TanimYetkisi)]
    public IActionResult Kaydet([FromBody] ChecklistGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Baslik))
            return BadRequest(new { hata = "Başlık zorunludur." });

        if (girdi.Maddeler is null || girdi.Maddeler.Count == 0)
            return BadRequest(new { hata = "En az bir madde ekleyiniz." });

        using var db = _vt.Baglanti();

        int id;

        if (girdi.Id > 0)
        {
            id = girdi.Id;

            db.Execute(@"
UPDATE KRY_CHECKLIST
SET baslik = @baslik, aciklama = @aciklama, pozisyonlar = @pozisyonlar,
    subeler = @subeler, siklik = @siklik, bas_saat = @basSaat,
    bit_saat = @bitSaat, aktif = @aktif
WHERE id = @id", new
            {
                id,
                baslik = girdi.Baslik.Trim(),
                aciklama = girdi.Aciklama,
                pozisyonlar = Birlestir(girdi.Pozisyonlar),
                subeler = Birlestir(girdi.Subeler),
                siklik = string.IsNullOrWhiteSpace(girdi.Siklik) ? "gunluk" : girdi.Siklik,
                basSaat = girdi.BasSaat,
                bitSaat = girdi.BitSaat,
                aktif = girdi.Aktif
            });

            /* Maddeler yeniden yazılır. Doldurma kayıtları madde kimliğine
               bağlı olduğu için var olanlar korunur, yalnızca listeden
               çıkarılanlar silinir. */
            var kalanlar = girdi.Maddeler.Where(x => x.Id > 0).Select(x => x.Id).ToList();

            db.Execute(@"
DELETE FROM KRY_CHECKLIST_MADDE
WHERE checklist_id = @id AND (@bos = 1 OR id NOT IN @kalanlar)",
                new { id, bos = kalanlar.Count == 0, kalanlar = kalanlar.Count > 0 ? kalanlar : new List<int> { 0 } });
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CHECKLIST
    (baslik, aciklama, pozisyonlar, subeler, siklik, bas_saat, bit_saat,
     aktif, olusturan, olusturan_ad)
OUTPUT INSERTED.id
VALUES (@baslik, @aciklama, @pozisyonlar, @subeler, @siklik, @basSaat,
        @bitSaat, @aktif, @olusturan, @olusturanAd)", new
            {
                baslik = girdi.Baslik.Trim(),
                aciklama = girdi.Aciklama,
                pozisyonlar = Birlestir(girdi.Pozisyonlar),
                subeler = Birlestir(girdi.Subeler),
                siklik = string.IsNullOrWhiteSpace(girdi.Siklik) ? "gunluk" : girdi.Siklik,
                basSaat = girdi.BasSaat,
                bitSaat = girdi.BitSaat,
                aktif = girdi.Aktif,
                olusturan = Kullanici,
                olusturanAd = AdSoyad
            });
        }

        var sira = 0;

        foreach (var m in girdi.Maddeler)
        {
            sira++;

            if (m.Id > 0)
            {
                db.Execute(@"
UPDATE KRY_CHECKLIST_MADDE
SET sira = @sira, soru = @soru, gorsel_zorunlu = @g, yorum_zorunlu = @y
WHERE id = @id AND checklist_id = @liste",
                    new { id = m.Id, liste = id, sira, soru = m.Soru, g = m.GorselZorunlu, y = m.YorumZorunlu });
            }
            else
            {
                db.Execute(@"
INSERT INTO KRY_CHECKLIST_MADDE (checklist_id, sira, soru, gorsel_zorunlu, yorum_zorunlu)
VALUES (@liste, @sira, @soru, @g, @y)",
                    new { liste = id, sira, soru = m.Soru, g = m.GorselZorunlu, y = m.YorumZorunlu });
            }
        }

        return Ok(new { id, tamam = true });
    }

    /// <summary>
    /// Hedef kitle seçenekleri: pozisyonlar ve şubeler.
    ///
    /// Pozisyonlar Mikro'daki ünvanlardan, şubeler iş gruplarından okunur;
    /// elle liste tutmak yerine gerçekte kullanılan değerler gelsin.
    /// </summary>
    /// <summary>
    /// Var olan bir kontrol listesini maddeleriyle birlikte çoğaltır.
    ///
    /// <para>
    /// Benzer listeler her seferinde sıfırdan yazılıyordu: kasap reyonu
    /// listesiyle manav listesi arasında üç madde fark varken yirmi madde
    /// yeniden giriliyor, arada satır atlanıyordu. Kopya pasif açılıyor ki
    /// düzenlenmeden personele düşmesin.
    /// </para>
    /// </summary>
    [HttpPost("{id:int}/Kopyala")]
    [Authorize(Roles = TanimYetkisi)]
    public IActionResult Kopyala(int id)
    {
        using var db = _vt.Baglanti();

        var kaynak = db.QueryFirstOrDefault(@"
SELECT baslik, aciklama, pozisyonlar, subeler, siklik,
       bas_saat AS basSaat, bit_saat AS bitSaat
FROM KRY_CHECKLIST WHERE id = @id", new { id });

        if (kaynak is null) return NotFound(new { hata = "Liste bulunamadı." });

        var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CHECKLIST
    (baslik, aciklama, pozisyonlar, subeler, siklik, bas_saat, bit_saat, aktif)
OUTPUT INSERTED.id
VALUES (@baslik, @aciklama, @pozisyonlar, @subeler, @siklik, @basSaat, @bitSaat, 0)",
            new
            {
                baslik = $"{(string)kaynak.baslik} (kopya)",
                aciklama = (string)kaynak.aciklama,
                pozisyonlar = (string)kaynak.pozisyonlar,
                subeler = (string)kaynak.subeler,
                siklik = (string)kaynak.siklik,
                basSaat = (string)kaynak.basSaat,
                bitSaat = (string)kaynak.bitSaat
            });

        db.Execute(@"
INSERT INTO KRY_CHECKLIST_MADDE
    (checklist_id, sira, soru, gorsel_zorunlu, yorum_zorunlu)
SELECT @yeniId, sira, soru, gorsel_zorunlu, yorum_zorunlu
FROM KRY_CHECKLIST_MADDE WHERE checklist_id = @id ORDER BY sira, id",
            new { id, yeniId });

        return Ok(new { id = yeniId, basarili = true });
    }

    [HttpGet("Secenekler")]
    [Authorize(Roles = GorumeYetkisi)]
    public IActionResult Secenekler()
    {
        var pozisyonlar = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var subeler = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        string uyari = null;

        /* Ana kaynak Mikro personel listesi */
        try
        {
            foreach (var x in _personelKaynak.TumPersonelleriGetir())
            {
                var p = (x.Pozisyon ?? "").Trim();
                var b = (x.IsGrubu ?? "").Trim();

                if (p.Length > 0) pozisyonlar.Add(p);
                if (b.Length > 0) subeler.Add(b);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Checklist seçenekleri personel listesinden alınamadı");

            uyari = $"Personel listesine ulaşılamadı ({hata.Message}). "
                  + "Aşağıdaki seçenekler daha önce tanımlanmış kayıtlardan çıkarıldı; "
                  + "listede olmayan değerleri elle yazabilirsiniz.";
        }

        /* Yerel tanımlardan tamamlama.

           Personel listesi ulaşılamaz olduğunda ekran tamamen boş
           kalıyordu; oysa pozisyon adları zaten pozisyon gruplarında ve
           var olan kontrol listelerinde yazılı. Mikro erişilebilir
           olduğunda da zarar vermiyor: küme yinelenenleri eliyor. */
        try
        {
            using var db = _vt.Baglanti();

            foreach (var ham in db.Query<string>(
                "SELECT pozisyonlar FROM KRY_POZISYON_GRUBU WHERE aktif = 1"))
                foreach (var p in (ham ?? "").Split(',',
                    StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    pozisyonlar.Add(p);

            foreach (var ham in db.Query<string>(
                "SELECT pozisyonlar FROM KRY_CHECKLIST WHERE pozisyonlar IS NOT NULL"))
                foreach (var p in (ham ?? "").Split(',',
                    StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    pozisyonlar.Add(p);

            foreach (var ham in db.Query<string>(
                "SELECT subeler FROM KRY_CHECKLIST WHERE subeler IS NOT NULL"))
                foreach (var b in (ham ?? "").Split(',',
                    StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    subeler.Add(b);

            /* Şube adları doldurma kayıtlarında da geçiyor */
            foreach (var b in db.Query<string>(@"
SELECT DISTINCT sube_adi FROM KRY_CHECKLIST_DOLDURMA WHERE sube_adi IS NOT NULL"))
                if (!string.IsNullOrWhiteSpace(b)) subeler.Add(b.Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yerel seçenekler okunamadı");
        }

        return Ok(new
        {
            pozisyonlar = pozisyonlar.ToList(),
            subeler = subeler.ToList(),
            uyari
        });
    }

    /// <summary>Bir listenin doldurulma kayıtları.</summary>
    [HttpGet("{id:int}/Doldurmalar")]
    [Authorize(Roles = GorumeYetkisi)]
    public IActionResult Doldurmalar(int id, [FromQuery] DateTime? gun)
    {
        var tarih = (gun ?? DateTime.Today).Date;

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT d.id, d.personel_kodu AS personelKodu, d.ad_soyad AS adSoyad,
       d.sube_adi AS subeAdi, d.gorev, d.gun, d.tamamlandi, d.puan,
       d.degerlendirme, d.degerlendiren, d.guncelleme,
       (SELECT COUNT(*) FROM KRY_CHECKLIST_GORSEL g
        WHERE g.doldurma_id = d.id AND g.silindi = 0) AS gorselSayisi,
       (SELECT COUNT(*) FROM KRY_CHECKLIST_CEVAP v
        WHERE v.doldurma_id = d.id AND v.iade = 1) AS iadeSayisi
FROM KRY_CHECKLIST_DOLDURMA d
WHERE d.checklist_id = @id AND d.gun = @tarih
ORDER BY d.sube_adi, d.ad_soyad", new { id, tarih }).ToList();

        /* Şube → bölge eşlemesi Yönetim'deki bölge tanımlarından gelir;
           panel kırılımı bölgeyle başlıyor. */
        var bolgeler = _ayar.FormOku().Bolgeler ?? new List<BolgeTanimi>();

        string BolgeBul(string sube)
        {
            var ad = (sube ?? "").Trim();

            foreach (var b in bolgeler)
            {
                if ((b.Subeler ?? new List<string>())
                    .Any(x => (x ?? "").Trim().Equals(ad, StringComparison.OrdinalIgnoreCase)))
                    return b.Ad;
            }

            return "Bölgesiz";
        }

        return Ok(satirlar
            .Where(d => SubeGorebilir((string)d.subeAdi))
            .Select(d => new
        {
            d.id,
            d.personelKodu,
            d.adSoyad,
            d.subeAdi,
            bolge = BolgeBul((string)d.subeAdi),
            d.gorev,
            d.gun,
            d.tamamlandi,
            d.puan,
            d.degerlendirme,
            d.degerlendiren,
            d.gorselSayisi,
            d.iadeSayisi
        }));
    }

    /// <summary>Bir doldurmanın madde madde cevapları ve görselleri.</summary>
    [HttpGet("Doldurma/{doldurmaId:int}")]
    [Authorize(Roles = GorumeYetkisi)]
    public IActionResult Doldurma(int doldurmaId)
    {
        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT d.id, d.checklist_id AS checklistId, d.ad_soyad AS adSoyad,
       d.sube_adi AS subeAdi, d.gorev, d.gun, d.tamamlandi, d.puan,
       d.degerlendirme, d.degerlendiren, c.baslik
FROM KRY_CHECKLIST_DOLDURMA d
    INNER JOIN KRY_CHECKLIST c ON c.id = d.checklist_id
WHERE d.id = @doldurmaId", new { doldurmaId });

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        if (!SubeGorebilir((string)kayit.subeAdi))
            return Forbid();

        var cevaplar = db.Query(@"
SELECT m.id AS maddeId, m.sira, m.soru, v.cevap, v.yorum,
       v.puan, v.degerlendirme,
       v.iade, v.iade_notu AS iadeNotu, v.iade_eden AS iadeEden
FROM KRY_CHECKLIST_MADDE m
    LEFT JOIN KRY_CHECKLIST_CEVAP v
        ON v.madde_id = m.id AND v.doldurma_id = @doldurmaId
WHERE m.checklist_id = @liste
ORDER BY m.sira, m.id",
            new { doldurmaId, liste = (int)kayit.checklistId });

        var gorseller = db.Query(@"
SELECT id, madde_id AS maddeId, silindi, olusturma
FROM KRY_CHECKLIST_GORSEL
WHERE doldurma_id = @doldurmaId
ORDER BY olusturma", new { doldurmaId });

        return Ok(new { kayit, cevaplar, gorseller });
    }

    /// <summary>Görseli döner. Yedi gün sonra dosya silinmiş olabilir.</summary>
    [HttpGet("Gorsel/{gorselId:int}")]
    [Authorize(Roles = GorumeYetkisi)]
    public IActionResult Gorsel(int gorselId)
    {
        using var db = _vt.Baglanti();

        var dosya = db.ExecuteScalar<string>(
            "SELECT dosya FROM KRY_CHECKLIST_GORSEL WHERE id = @gorselId AND silindi = 0",
            new { gorselId });

        if (string.IsNullOrWhiteSpace(dosya))
            return NotFound(new { hata = "Görsel süresi dolduğu için silinmiş." });

        var yol = Path.Combine(GorselKlasoru, dosya);

        if (!System.IO.File.Exists(yol))
            return NotFound(new { hata = "Görsel bulunamadı." });

        return PhysicalFile(yol, "image/jpeg");
    }

    /// <summary>
    /// Panelden değerlendirme yazar.
    ///
    /// Değerlendirme madde bazındadır: her soruya ayrı puan ve not verilir.
    /// Doldurmanın genel puanı bu puanların ortalamasıdır; ayrıca elle
    /// girilmez, tek bir sayının hangi maddeden geldiği belirsiz kalırdı.
    /// </summary>
    [HttpPost("Doldurma/{doldurmaId:int}/Degerlendir")]
    [Authorize(Roles = TanimYetkisi)]
    public IActionResult Degerlendir(int doldurmaId, [FromBody] ChecklistDegerlendirmeGirdi girdi)
    {
        using var db = _vt.Baglanti();

        foreach (var m in girdi?.Maddeler ?? new List<ChecklistMaddeDegerlendirme>())
        {
            /* Cevap satırı yoksa oluşturulmaz: personel o maddeyi hiç
               cevaplamamışsa değerlendirilecek bir şey de yok. */
            db.Execute(@"
UPDATE KRY_CHECKLIST_CEVAP
SET puan = @puan, degerlendirme = @not
WHERE doldurma_id = @doldurmaId AND madde_id = @maddeId",
                new { doldurmaId, maddeId = m.MaddeId, puan = m.Puan, not = m.Degerlendirme });
        }

        /* Genel puan maddelerin ortalaması */
        var etkilenen = db.Execute(@"
UPDATE KRY_CHECKLIST_DOLDURMA
SET puan = (SELECT AVG(CAST(puan AS FLOAT)) FROM KRY_CHECKLIST_CEVAP
            WHERE doldurma_id = @doldurmaId AND puan IS NOT NULL),
    degerlendirme = @genel,
    degerlendiren = @kim
WHERE id = @doldurmaId",
            new { doldurmaId, genel = girdi?.Degerlendirme, kim = AdSoyad });

        return etkilenen == 0
            ? NotFound(new { hata = "Kayıt bulunamadı." })
            : Ok(new { tamam = true });
    }

    /// <summary>
    /// Bir maddeyi personele iade eder: tekrar yapılmasını ister.
    ///
    /// <para>
    /// Verilen cevap silinmez — personel ne yazdığını görsün ve neyin
    /// beğenilmediğini anlasın. Madde iade işaretli kaldığı sürece doldurma
    /// tamamlanmamış sayılır; personel yeniden cevaplayınca iade kalkar.
    /// </para>
    /// </summary>
    [HttpPost("Doldurma/{doldurmaId:int}/Iade/{maddeId:int}")]
    [Authorize(Roles = TanimYetkisi)]
    public async Task<IActionResult> Iade(
        int doldurmaId, int maddeId, [FromBody] ChecklistIadeGirdi girdi)
    {
        var not = (girdi?.Not ?? "").Trim();

        if (not.Length == 0)
            return BadRequest(new { hata = "Neyin düzeltilmesi gerektiğini yazınız." });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_CHECKLIST_CEVAP
SET iade = 1, iade_notu = @not, iade_eden = @kim
WHERE doldurma_id = @doldurmaId AND madde_id = @maddeId",
            new { doldurmaId, maddeId, not, kim = AdSoyad });

        if (etkilenen == 0)
            return NotFound(new { hata = "Cevap bulunamadı." });

        /* İade edilen madde varken doldurma tamamlanmış sayılmaz */
        db.Execute(@"
UPDATE KRY_CHECKLIST_DOLDURMA SET tamamlandi = 0 WHERE id = @doldurmaId",
            new { doldurmaId });

        /* Personele haber verilir; yoksa iadeden haberi olmaz */
        try
        {
            var bilgi = db.QueryFirstOrDefault(@"
SELECT d.personel_kodu AS kod, c.baslik, m.soru
FROM KRY_CHECKLIST_DOLDURMA d
    INNER JOIN KRY_CHECKLIST c ON c.id = d.checklist_id
    INNER JOIN KRY_CHECKLIST_MADDE m ON m.id = @maddeId
WHERE d.id = @doldurmaId", new { doldurmaId, maddeId });

            if (bilgi is not null)
            {
                await _bildirim.Gonder(
                    (string)bilgi.kod,
                    "Kontrol maddesi tekrar yapılacak",
                    $"{bilgi.baslik} — {bilgi.soru}: {not}",
                    "Checklist");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İade bildirimi gönderilemedi: {Id}", doldurmaId);
        }

        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    private static string Birlestir(List<string> liste) =>
        liste is null || liste.Count == 0
            ? null
            : string.Join(",", liste.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()));
}

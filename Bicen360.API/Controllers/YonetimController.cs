using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Tanım yönetimi: departmanlar, temsilciler ve arıza kategorileri.
///
/// <para>
/// Bu tanımlar arıza kaydı ekranından ayrıldı. Yılda birkaç kez dokunulan
/// listelerdi ve her gün kullanılan kayıt ekranının içinde durmaları hem
/// ekranı kalabalıklaştırıyor hem de yanlışlıkla değiştirilmelerini
/// kolaylaştırıyordu. Ayrı sayfa, ayrı yetki.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class YonetimController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly ArizaAkisServisi _akis;
    private readonly TanimYetkisi _tanim;

    public YonetimController(VeritabaniServisi vt, YetkiServisi yetki,
                             PersonelServisi personel, ArizaAkisServisi akis,
                             TanimYetkisi tanim)
    {
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _akis = akis;
        _tanim = tanim;
    }

    /* Arıza türleri ve soru akışı (13.10.2026): Yönetim'i açabilen hepsini,
       departmanlar yalnızca kendi türlerini düzenler. */
    private TanimYetkisi.Kapsam _turKapsami;
    private TanimYetkisi.Kapsam TurKapsami => _turKapsami ??= _tanim.Al(User, "ariza");

    private bool TurAcik(System.Data.IDbConnection db, int turId)
    {
        if (TurKapsami.Hepsi) return true;
        var dep = db.ExecuteScalar<int?>("SELECT departman_id FROM B360_ARIZA_TUR WHERE id = @turId", new { turId });
        return TurKapsami.Acik(dep);
    }

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    private bool Yetkili() => _yetki.SayfaAcik(Kullanici, Rol, "yonetim");

    /* ==================================================================== */
    /* Departmanlar                                                         */
    /* ==================================================================== */

    /// <summary>
    /// Departmanlar ve temsilcileri.
    ///
    /// Departman tanımları Mikro'daki iş grubu / ünvan yapısından ayrı
    /// tutuluyor: arıza kaydının gideceği yer (Bilgi Teknolojileri, teknik
    /// servis, muhasebe) personelin iş grubu kırılımıyla örtüşmüyor ve
    /// yönlendirme için sabit bir kimlik gerekiyor.
    /// </summary>
    [HttpGet("Departmanlar")]
    public IActionResult Departmanlar()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var liste = db.Query<Departman>(@"
SELECT id AS Id, ad AS Ad, aciklama AS Aciklama, aktif AS Aktif, sira AS Sira
FROM B360_DEPARTMAN ORDER BY sira, ad").ToList();

        var temsilciler = db.Query(@"
SELECT departman_id AS departmanId, personel_kodu AS personelKodu
FROM B360_DEPARTMAN_TEMSILCI").ToList();

        var kayitSayilari = db.Query(@"
SELECT departman_id AS departmanId, COUNT(*) AS sayi
FROM B360_ARIZA GROUP BY departman_id").ToList();

        foreach (var d in liste)
            d.Temsilciler = temsilciler
                .Where(t => (int)t.departmanId == d.Id)
                .Select(t => (string)t.personelKodu)
                .ToList();

        /* Temsilci seçimi için personel listesi de aynı uçta: ekran ikisine
           birden ihtiyaç duyuyor ve ayrı istek açılışı yavaşlatıyordu. */
        var personeller = _personel.Liste().Select(p => new
        {
            sicil = p.Sicil,
            adSoyad = p.AdSoyad,
            pozisyon = p.Pozisyon,
            sube = p.Sube,

            /* Kimlik numarası aramada kullanılıyor: sicili bilmeyen
               kullanıcı adla ya da kimlikle arıyor. Ekranda
               gösterilmiyor, yalnızca eşleştirmede. */
            kimlik = p.Kimlik
        });

        return Ok(new
        {
            departmanlar = liste,
            kayitSayilari,
            personeller,

            /* Liste boşsa sebebi: ekranda "personel bulunamadı" yerine
               gerçek hata yazılsın. */
            personelHatasi = _personel.SonHata
        });
    }

    [HttpPost("Departman")]
    public IActionResult DepartmanKaydet([FromBody] Departman girdi)
    {
        if (!Yetkili()) return Forbid();

        if (string.IsNullOrWhiteSpace(girdi?.Ad))
            return BadRequest(new { hata = "Departman adı giriniz." });

        using var db = _vt.Baglanti();
        db.Open();

        using var islem = db.BeginTransaction();

        int id;

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE B360_DEPARTMAN
SET ad = @Ad, aciklama = @Aciklama, aktif = @Aktif, sira = @Sira
WHERE id = @Id", girdi, islem);

            id = girdi.Id;
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO B360_DEPARTMAN (ad, aciklama, aktif, sira)
VALUES (@Ad, @Aciklama, @Aktif, @Sira);
SELECT CAST(SCOPE_IDENTITY() AS INT);", girdi, islem);
        }

        db.Execute("DELETE FROM B360_DEPARTMAN_TEMSILCI WHERE departman_id = @id",
            new { id }, islem);

        foreach (var kod in (girdi.Temsilciler ?? new()).Distinct())
        {
            if (string.IsNullOrWhiteSpace(kod)) continue;

            db.Execute(@"
INSERT INTO B360_DEPARTMAN_TEMSILCI (departman_id, personel_kodu)
VALUES (@id, @kod)", new { id, kod = kod.Trim() }, islem);
        }

        islem.Commit();

        return Ok(new { basarili = true, id });
    }

    /// <summary>
    /// Departmanı kaldırır.
    ///
    /// Kaydı olan departman silinmez, pasife alınır: silinseydi eski
    /// kayıtların gittiği yer boşalırdı.
    /// </summary>
    [HttpDelete("Departman/{id:int}")]
    public IActionResult DepartmanSil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kullanilmis = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_ARIZA WHERE departman_id = @id", new { id }) > 0;

        if (kullanilmis)
        {
            db.Execute("UPDATE B360_DEPARTMAN SET aktif = 0 WHERE id = @id", new { id });

            return Ok(new
            {
                basarili = true,
                bilgi = "Departmanın arıza kaydı olduğu için silinmedi, pasife alındı."
            });
        }

        db.Execute("DELETE FROM B360_DEPARTMAN WHERE id = @id", new { id });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Arıza kategorileri                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Kategoriler, departmanlar ve envanterdeki cihaz türleri.
    ///
    /// Tek uçta toplandı: kategori formu üçüne birden ihtiyaç duyuyor.
    /// </summary>
    [HttpGet("Kategoriler")]
    public IActionResult Kategoriler()
    {
        if (!TurKapsami.Var) return Forbid();

        using var db = _vt.Baglanti();

        var kategoriler = db.Query(@"
SELECT
    K.id, K.ad, K.departman_id AS departmanId, K.aciklama,
    K.sla_saat AS slaSaat, K.cihaz_turleri AS cihazTurleri,
    K.soru, K.akis_zorunlu AS akisZorunlu,
    K.atanan_kodu AS atananKodu, K.atanan_adi AS atananAdi,
    K.aktif, K.sira,
    D.ad AS departman,
    (SELECT COUNT(*) FROM B360_ARIZA A WHERE A.tur_id = K.id) AS kayitSayisi,
    (SELECT COUNT(*) FROM B360_ARIZA_ADIM S
      WHERE S.tur_id = K.id AND S.aktif = 1) AS adimSayisi
FROM B360_ARIZA_TUR K
    LEFT JOIN B360_DEPARTMAN D ON K.departman_id = D.id
WHERE @hepsi = 1 OR K.departman_id IN @deps
ORDER BY K.sira, K.ad", new { hepsi = TurKapsami.Hepsi ? 1 : 0, deps = TurKapsami.Departmanlar.DefaultIfEmpty(-1).ToList() }).ToList();

        var departmanlar = db.Query(@"
SELECT id, ad FROM B360_DEPARTMAN WHERE aktif = 1 AND (@hepsi = 1 OR id IN @deps) ORDER BY sira, ad",
            new { hepsi = TurKapsami.Hepsi ? 1 : 0, deps = TurKapsami.Departmanlar.DefaultIfEmpty(-1).ToList() }).ToList();

        /* Varsayılan sorumlu seçimi için departman temsilcileri: kategori
           hangi departmana bağlıysa o departmanın temsilcileri listeleniyor.
           Ad soyad personel listesinden. */
        var adlar = _personel.Liste()
            .GroupBy(x => x.Sicil, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var temsilciler = db.Query(@"
SELECT departman_id AS departmanId, personel_kodu AS sicil
FROM B360_DEPARTMAN_TEMSILCI").ToList()
            .Select(t =>
            {
                var sicil = ((string)t.sicil ?? "").Trim();

                adlar.TryGetValue(sicil, out var p);

                return new
                {
                    departmanId = (int)t.departmanId,
                    sicil,
                    adSoyad = p?.AdSoyad ?? sicil,
                    pozisyon = p?.Pozisyon,
                };
            })
            .ToList();

        /* Cihaz türleri elle tanımlanmıyor, envantere girilenlerden
           toplanıyor: iki ayrı liste tutmak, biri güncellenip diğeri
           unutulduğunda eşleşmeyen kategoriler bırakıyordu. */
        var cihazTurleri = db.Query<string>(CihazTuruSorgusu.Hepsi).ToList();

        /* Sorumlu adayları: temsilcilere ek olarak bu departmanı kapsayan
           roldeki kullanıcılar (13.10.2026) */
        var adaylar = _tanim.Adaylar(db, departmanlar.Select(d => (int)d.id))
            .Where(a => !temsilciler.Any(t => t.departmanId == a.DepartmanId
                         && string.Equals(t.sicil, a.Sicil, StringComparison.OrdinalIgnoreCase)))
            .Select(a => new { departmanId = a.DepartmanId, sicil = a.Sicil, adSoyad = a.AdSoyad, pozisyon = a.Pozisyon });

        var depIdleri = departmanlar.Select(d => (int)d.id).ToHashSet();

        return Ok(new
        {
            kategoriler,
            departmanlar,
            cihazTurleri,
            temsilciler = temsilciler.Where(t => TurKapsami.Hepsi || depIdleri.Contains(t.departmanId))
                .Select(t => new { t.departmanId, t.sicil, t.adSoyad, t.pozisyon })
                .Concat(adaylar),
            hepsi = TurKapsami.Hepsi
        });
    }

    [HttpPost("Kategori")]
    public IActionResult KategoriKaydet([FromBody] KategoriGirdi girdi)
    {
        if (!TurKapsami.Var) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Ad))
            return BadRequest(new { hata = "Kategori adı giriniz." });

        if (girdi.SlaSaat is < 1 or > 720)
            return BadRequest(new { hata = "SLA süresi 1 ile 720 saat arasında olmalıdır." });

        var cihazTurleri = girdi.CihazTurleri is { Count: > 0 }
            ? string.Join(",", girdi.CihazTurleri.Select(x => x?.Trim())
                .Where(x => !string.IsNullOrWhiteSpace(x)))
            : null;

        var deger = new
        {
            girdi.Id,
            Ad = girdi.Ad.Trim(),
            DepartmanId = girdi.DepartmanId > 0 ? girdi.DepartmanId : (int?)null,
            girdi.Aciklama,
            girdi.SlaSaat,
            CihazTurleri = cihazTurleri,
            Soru = string.IsNullOrWhiteSpace(girdi.Soru) ? null : girdi.Soru.Trim(),
            girdi.AkisZorunlu,
            girdi.Aktif,
            girdi.Sira,
            AtananKodu = string.IsNullOrWhiteSpace(girdi.AtananKodu) ? null : girdi.AtananKodu.Trim(),

            /* Ad kayıt anında yazılıyor: listede her satır için personel
               veritabanına gitmemek için. */
            AtananAdi = string.IsNullOrWhiteSpace(girdi.AtananKodu)
                ? null
                : _personel.Getir(girdi.AtananKodu.Trim())?.AdSoyad
        };

        using var db = _vt.Baglanti();

        /* Departman kendi türünü düzenler; genel tür yalnızca hepsini
           yönetende */
        if (!TurKapsami.Acik(deger.DepartmanId))
            return BadRequest(new { hata = deger.DepartmanId is null
                ? "Genel tür tanımlama yetkiniz yok; departmanınızı seçiniz."
                : "Bu departmana tür tanımlama yetkiniz yok." });

        if (girdi.Id > 0 && !TurAcik(db, girdi.Id))
            return StatusCode(403, new { hata = "Bu türü düzenleme yetkiniz yok." });

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE B360_ARIZA_TUR
SET ad = @Ad, departman_id = @DepartmanId, aciklama = @Aciklama,
    sla_saat = @SlaSaat, cihaz_turleri = @CihazTurleri,
    soru = @Soru, akis_zorunlu = @AkisZorunlu,
    atanan_kodu = @AtananKodu, atanan_adi = @AtananAdi,
    aktif = @Aktif, sira = @Sira
WHERE id = @Id", deger);

            return Ok(new { basarili = true, id = girdi.Id });
        }

        var varOlan = db.ExecuteScalar<int?>(
            "SELECT id FROM B360_ARIZA_TUR WHERE ad = @Ad", deger);

        if (varOlan is not null)
            return BadRequest(new { hata = "Bu adda bir kategori zaten var." });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ARIZA_TUR
    (ad, departman_id, aciklama, sla_saat, cihaz_turleri, soru, akis_zorunlu,
     atanan_kodu, atanan_adi, aktif, sira)
OUTPUT INSERTED.id
VALUES (@Ad, @DepartmanId, @Aciklama, @SlaSaat, @CihazTurleri, @Soru,
        @AkisZorunlu, @AtananKodu, @AtananAdi, @Aktif, @Sira)",
            deger);

        return Ok(new { basarili = true, id });
    }

    /// <summary>
    /// Kategoriyi kaldırır.
    ///
    /// Kullanılmış kategori silinmez, pasife alınır: silinseydi eski
    /// kayıtların kategorisi ve SLA geçmişi boşalırdı.
    /// </summary>
    [HttpDelete("Kategori/{id:int}")]
    public IActionResult KategoriSil(int id)
    {
        if (!TurKapsami.Var) return Forbid();

        using var db = _vt.Baglanti();

        if (!TurAcik(db, id)) return StatusCode(403, new { hata = "Bu türü silme yetkiniz yok." });

        var kullanilmis = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_ARIZA WHERE tur_id = @id", new { id }) > 0;

        if (kullanilmis)
        {
            db.Execute("UPDATE B360_ARIZA_TUR SET aktif = 0 WHERE id = @id", new { id });

            return Ok(new
            {
                basarili = true,
                bilgi = "Kategorinin kaydı olduğu için silinmedi, pasife alındı."
            });
        }

        db.Execute("DELETE FROM B360_ARIZA_TUR WHERE id = @id", new { id });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Soru akışı                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Bir arıza türünün soru akışı ağacı.
    ///
    /// <para>
    /// Tür listesi de aynı uçta: ekran açılırken hangi türde kaç adım
    /// olduğunu göstermesi gerekiyor ve ayrı istek açılışı yavaşlatıyordu.
    /// </para>
    /// </summary>
    [HttpGet("Akis")]
    public IActionResult Akis([FromQuery] int turId = 0)
    {
        if (!TurKapsami.Var) return Forbid();

        using var db = _vt.Baglanti();

        if (turId > 0 && !TurAcik(db, turId)) return StatusCode(403, new { hata = "Bu türün akışını düzenleme yetkiniz yok." });

        var turler = db.Query(@"
SELECT
    T.id, T.ad, T.soru, T.akis_zorunlu AS akisZorunlu, T.aktif,
    T.cihaz_turleri AS cihazTurleri,
    (SELECT COUNT(*) FROM B360_ARIZA_ADIM S
      WHERE S.tur_id = T.id AND S.aktif = 1) AS adimSayisi
FROM B360_ARIZA_TUR T
WHERE @hepsi = 1 OR T.departman_id IN @deps
ORDER BY T.sira, T.ad", new { hepsi = TurKapsami.Hepsi ? 1 : 0, deps = TurKapsami.Departmanlar.DefaultIfEmpty(-1).ToList() }).ToList();

        /* Cihaz türleri elle tanımlanmıyor, envantere girilenlerden
           toplanıyor: kategorilerdeki desenin aynısı. */
        var cihazTurleri = db.Query<string>(CihazTuruSorgusu.Hepsi).ToList();

        if (turId <= 0)
            return Ok(new { turler, cihazTurleri, adimlar = new List<object>(), tur = (object)null });

        var tur = db.QueryFirstOrDefault(@"
SELECT
    T.id, T.ad, T.soru, T.akis_zorunlu AS akisZorunlu, T.aktif,
    T.cihaz_turleri AS cihazTurleri,
    (SELECT COUNT(*) FROM B360_ARIZA_ADIM S
      WHERE S.tur_id = T.id AND S.aktif = 1) AS adimSayisi
FROM B360_ARIZA_TUR T WHERE T.id = @turId", new { turId });

        if (tur is null) return NotFound(new { hata = "Arıza türü bulunamadı." });

        /* Pasif adımlar da geliyor: yönetim ekranı onları soluk gösterip
           yeniden açılabilmesini sağlıyor. Mobil tarafta yalnızca etkin
           olanlar okunuyor. */
        var adimlar = _akis.Adimlar(db, turId, yalnizAktif: false);

        /* Hangi adım kaç kayıtta kullanılmış: silme uyarısı buna bakıyor */
        var kullanim = db.Query<KullanimSatiri>(@"
SELECT Y.adim_id AS AdimId, COUNT(*) AS Sayi
FROM B360_ARIZA_YANIT Y
    INNER JOIN B360_ARIZA_ADIM S ON Y.adim_id = S.id
WHERE S.tur_id = @turId
GROUP BY Y.adim_id", new { turId })
            .ToDictionary(x => x.AdimId, x => x.Sayi);

        return Ok(new
        {
            turler,
            cihazTurleri,
            tur,
            soru = ArizaAkisServisi.SoruMetni(null, (string)tur.soru),
            adimlar = _akis.Agac(adimlar, kullanim)
        });
    }

    /// <summary>
    /// Türün akış ayarları: ilk sorunun metni ve akışın zorunluluğu.
    ///
    /// Kategori formundan ayrı bir uç: akış ekranından kategoriyi tümüyle
    /// göndermek, orada görünmeyen SLA ve cihaz türü alanlarını
    /// boşaltıyordu.
    /// </summary>
    [HttpPost("AkisAyar")]
    public IActionResult AkisAyar([FromBody] AkisAyarGirdi girdi)
    {
        if (!TurKapsami.Var) return Forbid();

        if (girdi is null || girdi.TurId <= 0)
            return BadRequest(new { hata = "Arıza türü seçiniz." });

        using var db = _vt.Baglanti();

        if (!TurAcik(db, girdi.TurId)) return StatusCode(403, new { hata = "Bu türü düzenleme yetkiniz yok." });

        var etkilenen = db.Execute(@"
UPDATE B360_ARIZA_TUR
SET soru = @Soru, akis_zorunlu = @AkisZorunlu
WHERE id = @TurId",
            new
            {
                girdi.TurId,
                Soru = Bosla(girdi.Soru),
                girdi.AkisZorunlu
            });

        if (etkilenen == 0) return NotFound(new { hata = "Arıza türü bulunamadı." });

        return Ok(new { basarili = true });
    }

    /// <summary>Adım ekler ya da günceller.</summary>
    [HttpPost("Adim")]
    public IActionResult AdimKaydet([FromBody] AdimGirdi girdi)
    {
        if (!TurKapsami.Var) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Ad))
            return BadRequest(new { hata = "Seçenek adını giriniz." });

        if (girdi.TurId <= 0)
            return BadRequest(new { hata = "Arıza türü seçiniz." });

        using var db = _vt.Baglanti();
        if (!TurAcik(db, girdi.TurId)) return StatusCode(403, new { hata = "Bu türün akışını düzenleme yetkiniz yok." });
        if (girdi.Id > 0 && db.ExecuteScalar<int?>("SELECT tur_id FROM B360_ARIZA_ADIM WHERE id = @Id", new { girdi.Id }) is int adimTuru && !TurAcik(db, adimTuru))
            return StatusCode(403, new { hata = "Bu adımı düzenleme yetkiniz yok." });

        var turVar = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_ARIZA_TUR WHERE id = @TurId", girdi) > 0;

        if (!turVar) return BadRequest(new { hata = "Arıza türü bulunamadı." });

        var ustId = girdi.UstId > 0 ? girdi.UstId : (int?)null;

        if (ustId is not null)
        {
            var ustTur = db.ExecuteScalar<int?>(
                "SELECT tur_id FROM B360_ARIZA_ADIM WHERE id = @ustId", new { ustId });

            if (ustTur is null) return BadRequest(new { hata = "Üst adım bulunamadı." });

            /* Bir türün adımı başka türün altına taşınamaz: akış
               yürütülürken zincir tur_id üzerinden doğrulanıyor ve
               karışık ağaç sessizce kırılırdı. */
            if (ustTur.Value != girdi.TurId)
                return BadRequest(new { hata = "Üst adım başka bir arıza türüne ait." });
        }

        /* Kendi altına taşıma: ağaç döngüye girer ve akış sonsuza kadar
           inmeye çalışırdı. */
        if (girdi.Id > 0 && ustId is not null && Soyunda(db, ustId.Value, girdi.Id))
            return BadRequest(new { hata = "Bir adım kendi altına taşınamaz." });

        var deger = new
        {
            girdi.Id,
            girdi.TurId,
            UstId = ustId,
            Ad = girdi.Ad.Trim(),
            Soru = Bosla(girdi.Soru),
            Ipucu = Bosla(girdi.Ipucu),
            girdi.Coklu,
            CihazTuru = Bosla(girdi.CihazTuru),
            girdi.AciklamaIster,

            /* Zorunlu açıklama, açıklama istemeyi de kapsar: ikisini ayrı
               ayrı işaretlemeyi unutmak, kutunun hiç çıkmamasına yol
               açıyordu. */
            AciklamaZorunlu = girdi.AciklamaZorunlu,
            girdi.GorselIster,
            GorselZorunlu = girdi.GorselZorunlu,
            Oncelik = Oncelikler.Contains(girdi.Oncelik ?? "") ? girdi.Oncelik : null,
            girdi.Aktif,
            girdi.Sira
        };

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE B360_ARIZA_ADIM
SET ust_id = @UstId, ad = @Ad, soru = @Soru, ipucu = @Ipucu, coklu = @Coklu,
    cihaz_turu = @CihazTuru, aciklama_ister = @AciklamaIster,
    aciklama_zorunlu = @AciklamaZorunlu, gorsel_ister = @GorselIster,
    gorsel_zorunlu = @GorselZorunlu, oncelik = @Oncelik,
    aktif = @Aktif, sira = @Sira
WHERE id = @Id AND tur_id = @TurId", deger);

            return Ok(new { basarili = true, id = girdi.Id });
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_ARIZA_ADIM
    (tur_id, ust_id, ad, soru, ipucu, coklu, cihaz_turu, aciklama_ister,
     aciklama_zorunlu, gorsel_ister, gorsel_zorunlu, oncelik, aktif, sira)
OUTPUT INSERTED.id
VALUES (@TurId, @UstId, @Ad, @Soru, @Ipucu, @Coklu, @CihazTuru, @AciklamaIster,
        @AciklamaZorunlu, @GorselIster, @GorselZorunlu, @Oncelik, @Aktif, @Sira)",
            deger);

        return Ok(new { basarili = true, id });
    }

    /// <summary>
    /// Aynı seviyeye birden çok seçeneği tek seferde ekler.
    ///
    /// <para>
    /// Bir yazarkasanın donanımları ya da bir donanımın belirtileri onlarca
    /// satır oluyor ve her biri için pencere açıp kapamak tanım işini
    /// caydırıcı hâle getiriyordu. Satır satır yapıştırılan metin burada
    /// seçeneklere çevriliyor; ayrıntılı ayarlar (açıklama, fotoğraf,
    /// öncelik) sonradan tek tek düzenlenebiliyor.
    /// </para>
    ///
    /// <para>
    /// Aynı seviyede aynı adla ikinci bir seçenek eklenmiyor: listeyi
    /// yapıştırıp bir daha yapıştırmak, her seçeneği ikiye katlıyordu.
    /// </para>
    /// </summary>
    [HttpPost("AdimToplu")]
    public IActionResult AdimToplu([FromBody] TopluAdimGirdi girdi)
    {
        if (!TurKapsami.Var) return Forbid();

        if (girdi is null || girdi.TurId <= 0)
            return BadRequest(new { hata = "Arıza türü seçiniz." });

        var adlar = (girdi.Adlar ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Select(x => x.Length > 120 ? x[..120] : x)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (adlar.Count == 0)
            return BadRequest(new { hata = "En az bir seçenek yazınız." });

        var ustId = girdi.UstId > 0 ? girdi.UstId : (int?)null;

        using var db = _vt.Baglanti();
        if (!TurAcik(db, girdi.TurId)) return StatusCode(403, new { hata = "Bu türün akışını düzenleme yetkiniz yok." });

        if (ustId is not null)
        {
            var ustTur = db.ExecuteScalar<int?>(
                "SELECT tur_id FROM B360_ARIZA_ADIM WHERE id = @ustId", new { ustId });

            if (ustTur is null || ustTur.Value != girdi.TurId)
                return BadRequest(new { hata = "Üst adım bulunamadı." });
        }

        var mevcut = db.Query<string>(@"
SELECT ad FROM B360_ARIZA_ADIM
WHERE tur_id = @TurId AND ((@ustId IS NULL AND ust_id IS NULL) OR ust_id = @ustId)",
            new { girdi.TurId, ustId })
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var enBuyukSira = db.ExecuteScalar<int?>(@"
SELECT MAX(sira) FROM B360_ARIZA_ADIM
WHERE tur_id = @TurId AND ((@ustId IS NULL AND ust_id IS NULL) OR ust_id = @ustId)",
            new { girdi.TurId, ustId }) ?? 0;

        var eklenen = 0;

        foreach (var ad in adlar)
        {
            if (mevcut.Contains(ad)) continue;

            enBuyukSira += 1;

            db.Execute(@"
INSERT INTO B360_ARIZA_ADIM (tur_id, ust_id, ad, soru, aktif, sira)
VALUES (@TurId, @ustId, @ad, @soru, 1, @sira)",
                new
                {
                    girdi.TurId,
                    ustId,
                    ad,

                    /* Aynı seviyedeki her seçeneğe aynı alt soru yazılabiliyor:
                       "… nasıl bir sorun yaşıyorsunuz?" gibi kalıp sorular
                       donanım başına tek tek yazılınca unutuluyordu. */
                    soru = Bosla(girdi.AltSoru),
                    sira = enBuyukSira
                });

            eklenen += 1;
        }

        return Ok(new
        {
            basarili = true,
            eklenen,
            atlanan = adlar.Count - eklenen
        });
    }

    /// <summary>
    /// Adımı ve altındakileri kaldırır.
    ///
    /// Kayıtlarda kullanılmışsa silinmiyor, pasife alınıyor: yanıt
    /// satırları metni kendi içinde tutuyor ama silinen bir dalın geri
    /// getirilmesi mümkün olmuyordu.
    /// </summary>
    [HttpDelete("Adim/{id:int}")]
    public IActionResult AdimSil(int id)
    {
        if (!TurKapsami.Var) return Forbid();

        using var db = _vt.Baglanti();
        if (db.ExecuteScalar<int?>("SELECT tur_id FROM B360_ARIZA_ADIM WHERE id = @id", new { id }) is int silTuru && !TurAcik(db, silTuru))
            return StatusCode(403, new { hata = "Bu adımı silme yetkiniz yok." });

        var soy = Soy(db, id);

        var kullanilmis = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_ARIZA_YANIT WHERE adim_id IN @soy",
            new { soy }) > 0;

        if (kullanilmis)
        {
            db.Execute("UPDATE B360_ARIZA_ADIM SET aktif = 0 WHERE id IN @soy",
                new { soy });

            return Ok(new
            {
                basarili = true,
                bilgi = "Adım kayıtlarda kullanıldığı için silinmedi, pasife alındı."
            });
        }

        db.Execute("DELETE FROM B360_ARIZA_ADIM WHERE id IN @soy", new { soy });

        return Ok(new { basarili = true, silinen = soy.Count });
    }

    /// <summary>
    /// Adımı kardeşleri arasında yukarı ya da aşağı taşır.
    ///
    /// Sıra numarasını elle yazdırmak yerine: personelin ekranda göreceği
    /// sıra buradan belirleniyor ve numaraları tek tek düzeltmek her yeni
    /// seçenekte ayrı bir iş çıkarıyordu.
    /// </summary>
    [HttpPost("AdimSira")]
    public IActionResult AdimSira([FromBody] SiraGirdi girdi)
    {
        if (!TurKapsami.Var) return Forbid();

        if (girdi is null || girdi.Id <= 0)
            return BadRequest(new { hata = "Adım seçiniz." });

        using var db = _vt.Baglanti();

        var adim = db.QueryFirstOrDefault<AdimYeri>(
            "SELECT tur_id AS TurId, ust_id AS UstId FROM B360_ARIZA_ADIM WHERE id = @Id",
            girdi);

        if (adim is null) return NotFound(new { hata = "Adım bulunamadı." });
        if (!TurAcik(db, (int)adim.TurId)) return StatusCode(403, new { hata = "Bu adımı düzenleme yetkiniz yok." });

        var kardesler = db.Query<int>(@"
SELECT id FROM B360_ARIZA_ADIM
WHERE tur_id = @turId
  AND ((@ustId IS NULL AND ust_id IS NULL) OR ust_id = @ustId)
ORDER BY sira, ad",
            new { turId = adim.TurId, ustId = adim.UstId }).ToList();

        var yer = kardesler.IndexOf(girdi.Id);
        var hedef = girdi.Yon == "yukari" ? yer - 1 : yer + 1;

        if (yer < 0 || hedef < 0 || hedef >= kardesler.Count)
            return Ok(new { basarili = true, degisiklik = false });

        (kardesler[yer], kardesler[hedef]) = (kardesler[hedef], kardesler[yer]);

        /* Sıra numaraları baştan yazılıyor: eskiden elle girilen değerler
           arasında boşluk ve tekrar olabiliyor, iki adım aynı numarada
           kalınca sıra ada göre kayıyordu. */
        for (var i = 0; i < kardesler.Count; i++)
            db.Execute("UPDATE B360_ARIZA_ADIM SET sira = @sira WHERE id = @id",
                new { sira = i + 1, id = kardesler[i] });

        return Ok(new { basarili = true, degisiklik = true });
    }

    /// <summary>Adım ve altındaki bütün adımların kimlikleri.</summary>
    /// <remarks>
    /// Ağaç bellekte yürünüyor: özyinelemeli SQL (CTE) yerine tek sorgu,
    /// adım sayısı birkaç yüzü geçmediği için yeterli ve okunması kolay.
    /// </remarks>
    private static List<int> Soy(System.Data.IDbConnection db, int id)
    {
        var tumu = db.Query<AdimBagi>(
            "SELECT id AS Id, ust_id AS UstId FROM B360_ARIZA_ADIM").ToList();

        var sonuc = new List<int> { id };
        var sira = new Queue<int>();

        sira.Enqueue(id);

        while (sira.Count > 0)
        {
            var simdiki = sira.Dequeue();

            foreach (var c in tumu.Where(x => x.UstId == simdiki))
            {
                sonuc.Add(c.Id);
                sira.Enqueue(c.Id);
            }
        }

        return sonuc;
    }

    /// <summary>Sıralama için adımın türü ve üstü.</summary>
    private sealed class AdimYeri
    {
        public int TurId { get; set; }
        public int? UstId { get; set; }
    }

    /// <summary>Ağaç yürürken kullanılan iki sütunluk satır.</summary>
    private sealed class AdimBagi
    {
        public int Id { get; set; }
        public int? UstId { get; set; }
    }

    /// <summary>Adım başına kullanım sayısı.</summary>
    private sealed class KullanimSatiri
    {
        public int AdimId { get; set; }
        public int Sayi { get; set; }
    }

    /// <summary>Verilen adım, aranan adımın soyundan mı geliyor.</summary>
    private static bool Soyunda(System.Data.IDbConnection db, int adimId, int aranan) =>
        Soy(db, aranan).Contains(adimId);

    private static string Bosla(string d) =>
        string.IsNullOrWhiteSpace(d) ? null : d.Trim();

    private static readonly string[] Oncelikler =
        { "dusuk", "orta", "yuksek", "acil" };

    /* ==================================================================== */
    /* Rakip firmalar                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Rakip firmalar.
    ///
    /// Fiyat karşılaştırmasında personel bu listeden seçim yapıyor. Serbest
    /// metin bırakılsaydı aynı firma "Çağrı", "ÇAĞRI A.Ş.", "cagri" diye
    /// üç ayrı satır olur ve rapor kırılımı işe yaramazdı.
    /// </summary>
    [HttpGet("RakipFirmalar")]
    public IActionResult RakipFirmalar()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT
    F.id, F.ad, F.aktif, F.sira,
    (SELECT COUNT(*) FROM B360_RAKIP_FIYAT R WHERE R.firma_id = F.id) AS kayitSayisi,
    F.logo_adres AS logoAdres, F.logo_dosya AS logoDosya, F.logo_surum AS logoSurum
FROM B360_RAKIP_FIRMA F
ORDER BY F.sira, F.ad")
            .Select(x => new
            {
                id = (int)x.id,
                ad = (string)x.ad,
                aktif = (bool)x.aktif,
                sira = (int)x.sira,
                kayitSayisi = (int)x.kayitSayisi,
                logoAdres = (string)x.logoAdres,
                /* Bağlantı verildi ama görsel indirilemedi: logo bağlantıdan gösteriliyor */
                logoIndirildi = x.logoDosya is not null,
                logo = RakipLogo.Adres((int)x.id, (int)x.logoSurum, x.logoDosya is not null || x.logoAdres is not null),
            })
            .ToList());
    }

    [HttpPost("RakipFirma")]
    public async Task<IActionResult> RakipFirmaKaydet([FromBody] RakipFirmaGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Ad))
            return BadRequest(new { hata = "Firma adı giriniz." });

        var deger = new { girdi.Id, Ad = girdi.Ad.Trim(), girdi.Aktif, girdi.Sira };

        /* Logo bağlantısı (12.10.2026): null gelirse dokunulmuyor (eski
           panel alanı göndermiyor); boş metin kaldırıyor. */
        string logoAdres = null;
        if (girdi.LogoAdres is not null)
        {
            logoAdres = girdi.LogoAdres.Trim();
            if (logoAdres.Length > 0 && !RakipLogo.AdresGecerli(logoAdres, out _))
                return BadRequest(new { hata = "Logo bağlantısı http:// ya da https:// ile başlamalı." });
            if (logoAdres.Length > 500) return BadRequest(new { hata = "Logo bağlantısı çok uzun." });
        }

        using var db = _vt.Baglanti();

        int id;

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE B360_RAKIP_FIRMA SET ad = @Ad, aktif = @Aktif, sira = @Sira WHERE id = @Id",
                deger);
            id = girdi.Id;
        }
        else
        {
            var varOlan = db.ExecuteScalar<int?>(
                "SELECT id FROM B360_RAKIP_FIRMA WHERE ad = @Ad", deger);

            if (varOlan is not null)
                return BadRequest(new { hata = "Bu adda bir firma zaten var." });

            id = db.ExecuteScalar<int>(@"
INSERT INTO B360_RAKIP_FIRMA (ad, aktif, sira)
OUTPUT INSERTED.id VALUES (@Ad, @Aktif, @Sira)", deger);
        }

        if (girdi.LogoAdres is null) return Ok(new { basarili = true, id });

        var (bilgi, logoHata) = await LogoBaglantisiYaz(db, id, logoAdres);
        return Ok(new { basarili = true, id, bilgi, logoHata });
    }

    /// <summary>
    /// Logo bağlantısını yazar; görseli indirip saklamayı dener. İndirilemezse
    /// bağlantı yine saklanıyor ve logo oradan gösteriliyor.
    /// </summary>
    private async Task<(string Bilgi, string Hata)> LogoBaglantisiYaz(System.Data.IDbConnection db, int id, string adres)
    {
        var yap = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var eski = db.QueryFirstOrDefault("SELECT logo_adres, logo_dosya FROM B360_RAKIP_FIRMA WHERE id = @id", new { id });
        if (eski is null) return (null, "Firma bulunamadı.");

        if (string.IsNullOrEmpty(adres))
        {
            if ((string)eski.logo_adres is null) return (null, null);

            /* Yalnızca bağlantıdan gelen logo kaldırılıyor; yüklenen görsel
               (bağlantısız) duruyor */
            db.Execute(@"
UPDATE B360_RAKIP_FIRMA SET logo_adres = NULL, logo_dosya = NULL, logo_surum = logo_surum + 1 WHERE id = @id", new { id });
            RakipLogo.Sil(yap, (string)eski.logo_dosya);
            return ("Logo kaldırıldı.", null);
        }

        if (string.Equals((string)eski.logo_adres, adres, StringComparison.Ordinal) && (string)eski.logo_dosya is not null)
            return (null, null);

        var (veri, indirmeHata) = await RakipLogo.Indir(
            HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>(), adres);

        string dosya = null;
        string yazmaHata = null;
        if (veri is not null) (dosya, yazmaHata) = await RakipLogo.Yaz(yap, id, veri);

        db.Execute(@"
UPDATE B360_RAKIP_FIRMA SET logo_adres = @adres, logo_dosya = @dosya, logo_surum = logo_surum + 1 WHERE id = @id",
            new { id, adres, dosya });

        if ((string)eski.logo_dosya is not null) RakipLogo.Sil(yap, (string)eski.logo_dosya);

        return dosya is not null
            ? ("Logo indirildi ve kaydedildi.", null)
            : (null, $"{indirmeHata ?? yazmaHata} Bağlantı kaydedildi; logo doğrudan bağlantıdan gösterilecek.");
    }

    /// <summary>Logo görseli yükler (bağlantı yerine)</summary>
    [HttpPost("RakipFirma/{id:int}/Logo")]
    [RequestSizeLimit(4_000_000)]
    public async Task<IActionResult> RakipLogoYukle(int id, IFormFile dosya)
    {
        if (!Yetkili()) return Forbid();

        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Görsel seçilmedi." });
        if (dosya.Length > RakipLogo.EnBuyuk) return BadRequest(new { hata = "Logo en çok 2 MB olabilir." });

        using var db = _vt.Baglanti();
        var eski = db.QueryFirstOrDefault("SELECT logo_dosya FROM B360_RAKIP_FIRMA WHERE id = @id", new { id });
        if (eski is null) return NotFound(new { hata = "Firma bulunamadı." });

        byte[] veri;
        using (var bellek = new MemoryStream())
        {
            await dosya.CopyToAsync(bellek);
            veri = bellek.ToArray();
        }

        var yap = HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var (ad, hata) = await RakipLogo.Yaz(yap, id, veri);
        if (ad is null) return BadRequest(new { hata });

        /* Yüklenen görsel bağlantının yerini alıyor */
        db.Execute(@"
UPDATE B360_RAKIP_FIRMA SET logo_dosya = @ad, logo_adres = NULL, logo_surum = logo_surum + 1 WHERE id = @id",
            new { id, ad });

        RakipLogo.Sil(yap, (string)eski.logo_dosya);

        return Ok(new { basarili = true });
    }

    [HttpDelete("RakipFirma/{id:int}/Logo")]
    public IActionResult RakipLogoSil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();
        var eski = db.QueryFirstOrDefault("SELECT logo_dosya FROM B360_RAKIP_FIRMA WHERE id = @id", new { id });
        if (eski is null) return NotFound(new { hata = "Firma bulunamadı." });

        db.Execute(@"
UPDATE B360_RAKIP_FIRMA SET logo_dosya = NULL, logo_adres = NULL, logo_surum = logo_surum + 1 WHERE id = @id", new { id });

        RakipLogo.Sil(HttpContext.RequestServices.GetRequiredService<IConfiguration>(), (string)eski.logo_dosya);

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Firmayı kaldırır.
    ///
    /// Kaydı olan firma silinmez, pasife alınır: silinseydi eski
    /// karşılaştırmaların kime karşı yapıldığı boşalırdı.
    /// </summary>
    [HttpDelete("RakipFirma/{id:int}")]
    public IActionResult RakipFirmaSil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kullanilmis = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_RAKIP_FIYAT WHERE firma_id = @id", new { id }) > 0;

        if (kullanilmis)
        {
            db.Execute("UPDATE B360_RAKIP_FIRMA SET aktif = 0 WHERE id = @id", new { id });

            return Ok(new
            {
                basarili = true,
                bilgi = "Firmanın kaydı olduğu için silinmedi, pasife alındı."
            });
        }

        db.Execute("DELETE FROM B360_RAKIP_FIRMA WHERE id = @id", new { id });

        return Ok(new { basarili = true });
    }
}

/* ========================================================================== */

public class RakipFirmaGirdi
{
    public int Id { get; set; }
    public string Ad { get; set; }
    public bool Aktif { get; set; } = true;
    public int Sira { get; set; }

    /// <summary>Logo bağlantısı (12.10.2026); null: değiştirme, boş: kaldır</summary>
    public string LogoAdres { get; set; }
}

public class KategoriGirdi
{
    /// <summary>Varsayılan sorumlu: bu kategoride açılan kayıt ona atanır. Boşsa atama yok.</summary>
    public string AtananKodu { get; set; }

    public int Id { get; set; }
    public string Ad { get; set; }

    /// <summary>Boş bırakılırsa kategori tüm departmanlarda kullanılabilir.</summary>
    public int DepartmanId { get; set; }

    public string Aciklama { get; set; }

    /// <summary>Kaydın çözülmesi için hedeflenen süre; gecikme buna göre ölçülür.</summary>
    public int SlaSaat { get; set; } = 72;

    /// <summary>Boş bırakılırsa tüm cihaz türleri için kullanılabilir.</summary>
    public List<string> CihazTurleri { get; set; } = new();

    /// <summary>Soru akışının ilk adımında sorulacak cümle.</summary>
    public string Soru { get; set; }

    /// <summary>Akış sonuna kadar tamamlanmadan kayıt açılamaz.</summary>
    public bool AkisZorunlu { get; set; }

    public bool Aktif { get; set; } = true;
    public int Sira { get; set; }
}

/* ========================================================================== */

/// <summary>Soru akışındaki tek bir adım.</summary>
public class AdimGirdi
{
    public int Id { get; set; }
    public int TurId { get; set; }

    /// <summary>0 ise ilk seviye.</summary>
    public int UstId { get; set; }

    /// <summary>Ekranda görünecek seçenek metni: "Fiş yazıcı".</summary>
    public string Ad { get; set; }

    /// <summary>
    /// Bu seçenek işaretlendikten sonra alt seçenekler sorulurken ekranda
    /// yazacak cümle: "Fiş yazıcınızda nasıl bir sorun yaşıyorsunuz?"
    /// </summary>
    public string Soru { get; set; }

    public string Ipucu { get; set; }

    /// <summary>Alt seçeneklerden birden fazlası işaretlenebilir.</summary>
    public bool Coklu { get; set; }

    /// <summary>Seçilince envanterden bu türde cihaz sorulur.</summary>
    public string CihazTuru { get; set; }

    public bool AciklamaIster { get; set; }
    public bool AciklamaZorunlu { get; set; }
    public bool GorselIster { get; set; }
    public bool GorselZorunlu { get; set; }

    /// <summary>dusuk · orta · yuksek · acil — boşsa personelin seçimi geçerli.</summary>
    public string Oncelik { get; set; }

    public bool Aktif { get; set; } = true;
    public int Sira { get; set; }
}

public class AkisAyarGirdi
{
    public int TurId { get; set; }

    /// <summary>Akışın ilk adımında sorulacak cümle.</summary>
    public string Soru { get; set; }

    /// <summary>Akış sonuna kadar tamamlanmadan kayıt açılamaz.</summary>
    public bool AkisZorunlu { get; set; }
}

public class SiraGirdi
{
    public int Id { get; set; }

    /// <summary>"yukari" ya da "asagi"</summary>
    public string Yon { get; set; }
}

/// <summary>Aynı seviyeye toplu seçenek ekleme.</summary>
public class TopluAdimGirdi
{
    public int TurId { get; set; }

    /// <summary>0 ise ilk seviye.</summary>
    public int UstId { get; set; }

    /// <summary>Satır satır girilen seçenek adları.</summary>
    public List<string> Adlar { get; set; } = new();

    /// <summary>
    /// Eklenen her seçeneğe yazılacak ortak alt soru.
    ///
    /// Boş bırakılabilir; sonradan tek tek düzenlenir.
    /// </summary>
    public string AltSoru { get; set; }
}

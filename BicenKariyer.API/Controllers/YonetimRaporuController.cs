using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetim raporu: seçilen ayda şirkette ne olduğunun tek ekranda özeti.
///
/// <para>
/// Veriler dört ayrı veritabanından gelir — kariyer (onaylar, işe alım,
/// çıkış mülakatları), Mikro (personel), ciro ve geçiş. Her bölüm kendi
/// try bloğunda çalışır: birine ulaşılamazsa diğerleri yine görünür.
/// Tek bir bağlantı sorunu bütün raporu boş bırakmamalı.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class YonetimRaporuController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly YapayZekaServisi _yz;
    private readonly ILogger<YonetimRaporuController> _kayit;

    public YonetimRaporuController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        YapayZekaServisi yz,
        ILogger<YonetimRaporuController> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _yz = yz;
        _kayit = kayit;
    }

    /// <summary>
    /// Rapor yalnızca sistem yöneticisi (1 numaralı kullanıcı) ve yönetici
    /// rolündeki kullanıcılara açıktır.
    /// </summary>
    private bool Yetkili
    {
        get
        {
            var rol = User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

            if (rol is Roller.Admin or Roller.GenelMudurYardimcisi) return true;

            return int.TryParse(
                User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
                out var id) && id == 1;
        }
    }

    [HttpGet]
    public IActionResult Rapor([FromQuery] int? yil = null, [FromQuery] int? ay = null)
    {
        if (!Yetkili)
            return StatusCode(403, new
            {
                hata = "Bu rapor yönetime açıktır."
            });

        var seciliYil = yil ?? DateTime.Today.Year;
        var seciliAy = ay ?? DateTime.Today.Month;

        var bas = new DateTime(seciliYil, seciliAy, 1);
        var bit = bas.AddMonths(1).AddSeconds(-1);

        using var db = _vt.Baglanti();
        var p = new { bas, bit };

        /* ---------------------------------------------------- onaylar */
        var onayOzeti = db.QueryFirstOrDefault(@"
SELECT
    COUNT(*)                                                     AS toplam,
    SUM(CASE WHEN durum = N'Onaylandı' THEN 1 ELSE 0 END)         AS onaylanan,
    SUM(CASE WHEN durum = N'Reddedildi' THEN 1 ELSE 0 END)        AS reddedilen,
    SUM(CASE WHEN durum = N'Bekliyor' THEN 1 ELSE 0 END)          AS bekleyen
FROM KRY_ONAY
WHERE istek_tarihi BETWEEN @bas AND @bit", p);

        /* Tür bazında: hangi konuda kaç istek, kaçı onaylanmış */
        var onayTurleri = db.Query(@"
SELECT tur                                                        AS tur,
       COUNT(*)                                                   AS toplam,
       SUM(CASE WHEN durum = N'Onaylandı' THEN 1 ELSE 0 END)       AS onaylanan,
       SUM(CASE WHEN durum = N'Reddedildi' THEN 1 ELSE 0 END)      AS reddedilen
FROM KRY_ONAY
WHERE istek_tarihi BETWEEN @bas AND @bit
GROUP BY tur
ORDER BY COUNT(*) DESC", p).ToList();

        /* Kim onaya göndermiş, kim karar vermiş */
        var isteyenler = db.Query(@"
SELECT ISNULL(k.ad_soyad, o.isteyen)                              AS kisi,
       COUNT(*)                                                   AS istek,
       SUM(CASE WHEN o.durum = N'Onaylandı' THEN 1 ELSE 0 END)     AS onaylanan,
       SUM(CASE WHEN o.durum = N'Reddedildi' THEN 1 ELSE 0 END)    AS reddedilen
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.isteyen
WHERE o.istek_tarihi BETWEEN @bas AND @bit AND o.isteyen IS NOT NULL
GROUP BY ISNULL(k.ad_soyad, o.isteyen)
ORDER BY COUNT(*) DESC", p).ToList();

        var karariVerenler = db.Query(@"
SELECT ISNULL(k.ad_soyad, o.onaylayan)                            AS kisi,
       COUNT(*)                                                   AS karar,
       SUM(CASE WHEN o.durum = N'Onaylandı' THEN 1 ELSE 0 END)     AS onaylanan,
       SUM(CASE WHEN o.durum = N'Reddedildi' THEN 1 ELSE 0 END)    AS reddedilen
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.onaylayan
WHERE o.onay_tarihi BETWEEN @bas AND @bit AND o.onaylayan IS NOT NULL
GROUP BY ISNULL(k.ad_soyad, o.onaylayan)
ORDER BY COUNT(*) DESC", p).ToList();

        /* Reddedilenler ayrı listelenir: sebebi görmek gerekir */
        var redler = db.Query(@"
SELECT TOP 50 o.tur, o.baslik, o.sube_adi AS subeAdi,
       ISNULL(i.ad_soyad, o.isteyen)    AS isteyen,
       ISNULL(k.ad_soyad, o.onaylayan)  AS onaylayan,
       o.onay_notu                      AS sebep,
       o.onay_tarihi                    AS tarih
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR i ON i.kullanici_adi = o.isteyen
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.onaylayan
WHERE o.durum = N'Reddedildi' AND o.onay_tarihi BETWEEN @bas AND @bit
ORDER BY o.onay_tarihi DESC", p).ToList();

        /* ------------------------------------------- işe alım/pozisyon */
        var pozisyonlar = db.Query(@"
SELECT ISNULL(NULLIF(LTRIM(RTRIM(b.ise_giris_bolum)), ''),
              ISNULL(NULLIF(LTRIM(RTRIM(b.bolumler)), ''), N'Belirtilmemiş')) AS pozisyon,
       COUNT(DISTINCT b.id)                                        AS adet
FROM KRY_BASVURULAR b
WHERE b.durum = N'İşe Alındı'
  AND b.ise_giris_tarihi BETWEEN @bas AND @bit
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(b.ise_giris_bolum)), ''),
                ISNULL(NULLIF(LTRIM(RTRIM(b.bolumler)), ''), N'Belirtilmemiş'))
ORDER BY COUNT(DISTINCT b.id) DESC", p).ToList();

        var subeAlimlari = db.Query(@"
SELECT ISNULL(NULLIF(sube_adi, ''), N'Belirtilmemiş') AS subeAdi,
       COUNT(*)                                       AS adet
FROM KRY_BASVURULAR
WHERE durum = N'İşe Alındı' AND ise_giris_tarihi BETWEEN @bas AND @bit
GROUP BY ISNULL(NULLIF(sube_adi, ''), N'Belirtilmemiş')
ORDER BY COUNT(*) DESC", p).ToList();

        /* Gelen başvuru, Başvurular ve Raporlar sayfalarıyla aynı tabanda
           sayılır (arşiv ve aynı adayın eski başvuruları hariç,
           BasvuruTabani). Önceden bütün satırlar sayılıyor, Raporlar
           sayfasındaki "Toplam başvuru" ile aynı ay için farklı çıkıyordu. */
        var basvuruOzeti = db.QueryFirstOrDefault($@"
SELECT
    (SELECT COUNT(*) FROM KRY_BASVURULAR b
     WHERE b.olusturma BETWEEN @bas AND @bit
       AND {BasvuruTabani.RaporKosul("b")})                             AS gelenBasvuru,
    (SELECT COUNT(*) FROM KRY_BASVURULAR
     WHERE durum = N'İşe Alındı' AND ise_giris_tarihi BETWEEN @bas AND @bit) AS iseAlinan,
    (SELECT COUNT(*) FROM KRY_BASVURULAR
     WHERE durum = N'Olumsuz' AND guncelleme BETWEEN @bas AND @bit) AS olumsuz", p);

        /* --------------------------------------------- çıkış mülakatı */
        var cikisOzeti = db.QueryFirstOrDefault(@"
SELECT COUNT(*) AS adet FROM KRY_CIKIS_MULAKAT
WHERE olusturma BETWEEN @bas AND @bit", p);

        var cikisNedenleri = db.Query(@"
SELECT ISNULL(NULLIF(LTRIM(RTRIM(cikis_nedeni)), ''), N'Belirtilmemiş') AS neden,
       COUNT(*)                                                        AS adet
FROM KRY_CIKIS_MULAKAT
WHERE olusturma BETWEEN @bas AND @bit
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(cikis_nedeni)), ''), N'Belirtilmemiş')
ORDER BY COUNT(*) DESC", p).ToList();

        /* Mülakat özetleri: yorumların toplu görünümü */
        var cikisYorumlari = db.Query(@"
SELECT TOP 60 ad_soyad AS adSoyad, sube_adi AS subeAdi,
       cikis_nedeni AS neden, ozet, uzman_yorumu AS yorum
FROM KRY_CIKIS_MULAKAT
WHERE olusturma BETWEEN @bas AND @bit
ORDER BY olusturma DESC", p).ToList();

        /* ------------------------------------------------ ciro büyümesi */
        object ciroOzeti = null;
        var ciroSubeler = new List<object>();

        try
        {
            using var perf = _vt.PerformansBaglantisi();

            /* Genel oranlar her satırda aynı; ilk satırdan okunur. */
            ciroOzeti = perf.QueryFirstOrDefault(@"
SELECT TOP 1
       c.genel_ciro_buyume            AS ciro,
       c.genel_kar_buyume             AS kar,
       d.musteri_sayisi_buyume_genel  AS musteri,
       d.kisi_basi_ciro_genel         AS kisiBasiCiroGenel
FROM [biDb].[dbo].Magaza_Performans_Ciro c
INNER JOIN [biDb].[dbo].Magaza_Performans_Diger d
        ON c.sube_id = d.sube_id AND c.Yil = d.Yil AND c.Tarih = d.Tarih
WHERE c.Yil = @yil AND c.Tarih = @ay AND c.sube_ciro_buyume IS NOT NULL",
                new { yil = seciliYil, ay = seciliAy });

            /* Şube bazında: kişi başı ciro genel ortalamanın üstünde mi */
            ciroSubeler = perf.Query(@"
SELECT c.sube_adi                AS subeAdi,
       c.sube_ciro_buyume        AS ciro,
       c.sube_kar_buyume         AS kar,
       d.musteri_sayisi_buyume   AS musteri,
       d.kisi_basi_ciro          AS kisiBasiCiro,
       d.kisi_basi_ciro_genel    AS kisiBasiCiroGenel,
       d.calisan_sayisi          AS calisan
FROM [biDb].[dbo].Magaza_Performans_Ciro c
INNER JOIN [biDb].[dbo].Magaza_Performans_Diger d
        ON c.sube_id = d.sube_id AND c.Yil = d.Yil AND c.Tarih = d.Tarih
WHERE c.Yil = @yil AND c.Tarih = @ay AND c.sube_ciro_buyume IS NOT NULL
ORDER BY c.sube_ciro_buyume DESC",
                new { yil = seciliYil, ay = seciliAy }).Cast<object>().ToList();
        }
        catch (Exception hata)
        {
            /* Performans veritabanı tanımlı değilse rapor yine açılmalı */
            _kayit.LogWarning(hata, "Ciro büyümesi okunamadı");
        }

        /* ------------------------------------------- geçiş / okutma */
        object gecisOzeti = null;
        var subeOkutma = new List<object>();
        string gecisHatasi = null;

        try
        {
            using var gecis = _vt.GecisBaglantisi();

            gecisOzeti = gecis.QueryFirstOrDefault(@"
SELECT COUNT(*)                              AS hareket,
       COUNT(DISTINCT t.PersonId)            AS kisi,
       COUNT(DISTINCT CAST(t.TransitionDate AS DATE)) AS gun
FROM Transitions t
WHERE t.TransitionDate BETWEEN @bas AND @bit", p, commandTimeout: 120);

            /* Şube bazlı okutma: geçiş sisteminde kayıtlı personelin
               sicil numaraları alınır, Mikro'daki şube bilgisiyle
               eşleştirilir. İki veritabanı olduğu için bellekte. */
            var okutanlar = gecis.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(p.RegistrationNumber))
FROM Transitions t
INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE t.TransitionDate BETWEEN @bas AND @bit
  AND p.RegistrationNumber IS NOT NULL", p, commandTimeout: 120)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.Ordinal);

            /* Biçen360 uygulamasından okutanlar (sicil ile) */
            var mobilKodlar = MobilOkutmaKaynagi.Aralik(_vt, (DateTime)p.bas, (DateTime)p.bit, kayit: _kayit)
                .Select(x => x.PersonelKodu)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            try
            {
                using var mikro = _vt.PersonelBaglantisi();

                var personeller = mikro.Query(@"
SELECT LTRIM(RTRIM(per_sicil_no)) AS sicil,
       LTRIM(RTRIM(P.Per_TcKimlikNo)) AS kimlik,
       LTRIM(RTRIM(P.per_kod)) AS kod,
       LTRIM(RTRIM(ISNULL(PIG.ig_adi, N'Belirtilmemiş'))) AS sube
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
LEFT JOIN [MikroDesktop_2004BICEN].dbo.PERSONEL_IS_GRUP_TANIMLARI PIG
       ON PIG.ig_kod = P.per_is_grup_kodu
WHERE YEAR(P.per_cikis_tar) <= 1950 OR P.per_cikis_tar IS NULL",
                    commandTimeout: 90).ToList();

                /* Dönemin tamamında okutmadan muaf olanlar beklenenlere girmiyor */
                var muafKodlar = OkutmaKurallari.MuafKodlari(_vt, (DateTime)p.bas, (DateTime)p.bit);

                /* Dönemin tamamında raporlu olanlar da beklenenlere girmiyor */
                var raporluKodlar = new RaporluServisi(_vt).AralikKodlari((DateTime)p.bas, (DateTime)p.bit);

                subeOkutma = personeller
                    .Where(x => !muafKodlar.Contains(OkutmaKurallari.Anahtar((string)x.kod))
                                && !raporluKodlar.Contains(RaporluServisi.Anahtar((string)x.kod)))
                    .GroupBy(x => (string)x.sube)
                    .Select(g => new
                    {
                        subeAdi = g.Key,
                        toplam = g.Count(),
                        okutan = g.Count(x =>
                            okutanlar.Contains((string)x.sicil ?? "")
                            || okutanlar.Contains((string)x.kimlik ?? "")
                            || mobilKodlar.Contains((string)x.kod ?? "")),
                    })
                    .Select(x => new
                    {
                        x.subeAdi,
                        x.toplam,
                        x.okutan,
                        okutmayan = x.toplam - x.okutan,
                        oran = x.toplam > 0
                            ? Math.Round(x.okutan * 100.0 / x.toplam, 1) : 0
                    })
                    .OrderBy(x => x.oran)
                    .Cast<object>()
                    .ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Şube okutma dağılımı çıkarılamadı");
            }
        }
        catch (Exception hata)
        {
            /* Geçiş sistemi kapalıysa raporun geri kalanı yine görünmeli */
            gecisHatasi = hata.Message;
            _kayit.LogWarning(hata, "Geçiş verisi okunamadı");
        }

        return Ok(new
        {
            yil = seciliYil,
            ay = seciliAy,
            ciroOzeti,
            ciroSubeler,
            gecisOzeti,
            subeOkutma,
            gecisHatasi,
            onayOzeti,
            onayTurleri,
            isteyenler,
            karariVerenler,
            redler,
            basvuruOzeti,
            pozisyonlar,
            subeAlimlari,
            cikisOzeti,
            cikisNedenleri,
            cikisYorumlari
        });
    }

    /// <summary>
    /// Çıkış mülakatı yorumlarının yapay zekâ özeti. Ayrı uçta tutulur:
    /// model çağrısı yavaş, rapor onu beklememelidir.
    /// </summary>
    [HttpGet("MulakatOzeti")]
    public async Task<IActionResult> MulakatOzeti(
        [FromQuery] int? yil = null, [FromQuery] int? ay = null)
    {
        if (!Yetkili)
            return StatusCode(403, new { hata = "Bu rapor yönetime açıktır." });

        var seciliYil = yil ?? DateTime.Today.Year;
        var seciliAy = ay ?? DateTime.Today.Month;

        var bas = new DateTime(seciliYil, seciliAy, 1);
        var bit = bas.AddMonths(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT ad_soyad AS adSoyad, sube_adi AS subeAdi, cikis_nedeni AS neden,
       ozet, uzman_yorumu AS yorum
FROM KRY_CIKIS_MULAKAT
WHERE olusturma BETWEEN @bas AND @bit", new { bas, bit }).ToList();

        if (kayitlar.Count == 0)
            return Ok(new { ozet = (string)null, adet = 0 });

        var metin = new System.Text.StringBuilder();

        foreach (var k in kayitlar)
        {
            metin.AppendLine($"{k.subeAdi} · {k.neden}");

            if (!string.IsNullOrWhiteSpace((string)k.ozet))
                metin.AppendLine((string)k.ozet);

            if (!string.IsNullOrWhiteSpace((string)k.yorum))
                metin.AppendLine((string)k.yorum);

            metin.AppendLine();
        }

        try
        {
            var ozet = await _yz.MetinOzetle(metin.ToString(),
                $"""
                 Aşağıda {kayitlar.Count} çıkış mülakatının notları var. Bir
                 yöneticiye bu ayın havasını anlat.

                 EN ÖNEMLİ KURAL: KİŞİ ADI YAZMA.
                 Tek tek kimin ne dediğini anlatma. Ortak konuları çıkar ve
                 her birinin kaç kişide görüldüğünü belirt.

                 Yanlış: Ayşe yöneticisinden memnundu, Mehmet mola
                 saatlerinden şikâyetçiydi.
                 Doğru: İki kişi yöneticiden memnun, üç kişi mola düzeninden
                 şikâyetçi.

                 NASIL YAZ
                 En fazla iki kısa paragraf, düz metin. Başlık, madde işareti
                 ya da numara kullanma.

                 NE YAZ
                 Tekrar eden şikâyetler ve övgüler, kaç kişide görüldüğüyle.
                 Belirli bir şubede yoğunlaşan durum varsa şube adıyla.
                 Sonda bir ya da iki somut öneri.

                 KURALLAR
                 - Yalnızca metinde geçenlere dayan.
                 - Tek kişide görüleni genel eğilim gibi sunma.
                 - Az veri varsa genelleme yapma, bunu söyle.
                 """);

            return Ok(new { ozet, adet = kayitlar.Count });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Mülakat özeti alınamadı");
            return Ok(new { ozet = (string)null, adet = kayitlar.Count });
        }
    }
}

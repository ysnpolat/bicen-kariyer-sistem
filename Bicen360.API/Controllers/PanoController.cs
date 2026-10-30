using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Gösterge paneli.
///
/// <para>
/// Arıza kayıtları ve envanterin özeti tek uçtan geliyor. Her kutu için
/// ayrı istek atmak sayfayı yavaşlatıyor ve sayıların birbirine göre
/// tutarsız anlar yaşamasına yol açıyordu — biri güncellenirken diğeri
/// eski kalıyordu.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PanoController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PanoController> _kayit;
    private readonly YetkiServisi _yetki;
    private readonly RaporKapsami _kapsam;

    public PanoController(VeritabaniServisi vt, ILogger<PanoController> kayit, YetkiServisi yetki, RaporKapsami kapsam)
    {
        _vt = vt;
        _kayit = kayit;
        _yetki = yetki;
        _kapsam = kapsam;
    }

    /// <summary>
    /// Panonun tamamı.
    ///
    /// <para>
    /// <c>birim</c> hangi bölümün panosunun isteneceğini söylüyor. Şimdilik
    /// yalnızca bilgi teknolojileri panosu var; muhasebe ve satın alma
    /// portala katıldığında kendi blokları buraya eklenecek ve her bölüm
    /// kendi ana sayfasını görecek. Bölümü baştan parametre yapmak,
    /// sonradan eklendiğinde istemcinin çağrı biçimini değiştirmek
    /// zorunda kalmasını önlüyor.
    /// </para>
    /// </summary>
    [HttpGet]
    public IActionResult Ozet([FromQuery] int gun = 30, [FromQuery] string birim = null)
    {
        if (gun is < 1 or > 365) gun = 30;

        var kullanici = User.Identity?.Name ?? "";
        var rol = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

        if (!_yetki.SayfaAcik(kullanici, rol, "pano")) return Forbid();

        /* Kapsam (13.10.2026): sayılar ve son kayıtlar kullanıcının
           göreceği departmanlarla (ya da şubesiyle) sınırlı. Önceden bütün
           kayıtlar sayılıyordu. */
        var k = _kapsam.Panel(kullanici, rol);
        var ka = k.Sube is not null ? "a.sube_kodu = @kSube" : k.TumunuGorur ? "1 = 1" : "a.departman_id IN @kDeps";
        var ke = k.Sube is not null ? "e.sube_kodu = @kSube" : k.TumunuGorur ? "1 = 1" : "e.departman_id IN @kDeps";
        var kDeps = k.Departmanlar.Count > 0 ? k.Departmanlar : new List<int> { 0 };
        var kSube = k.Sube;

        var hedefBirim = string.IsNullOrWhiteSpace(birim) ? "bt" : birim.Trim().ToLowerInvariant();

        /* Tanınmayan bölüm istendiğinde boş pano yerine varsayılan
           gösteriliyor: yanlış bir bağlantı, kullanıcıyı bomboş bir
           ekranla bırakmamalı. */
        if (hedefBirim is not ("bt" or "hal" or "muhasebe" or "satinalma"))
            hedefBirim = "bt";

        if (hedefBirim is "muhasebe" or "satinalma")
            return Ok(new
            {
                birim = hedefBirim,
                hazir = false,
                mesaj = "Bu bölümün anasayfası henüz hazırlanmadı."
            });

        using var db = _vt.Baglanti();

        var baslangic = DateTime.Today.AddDays(-gun + 1);

        /* Hal bölümü künye ve rakip fiyatla ilgileniyor; arıza ve envanter
           sayıları onların işine yaramıyor ve ekranı dolduruyordu.

           Bağlantı ve tarih aralığı yukarıda kurulduktan sonra çağrılıyor:
           ikisini de bu metot kullanıyor. */
        if (hedefBirim == "hal") return Ok(HalPanosu(db, baslangic, gun));

        /* Durum sayıları: tek sorguda, sonra istemciye anlaşılır adlarla
           veriliyor. Sıfır olan durumlar da dönüyor ki grafik dilimleri
           veri geldikçe yer değiştirmesin. */
        var durumlar = db.Query<(string durum, int adet)>($@"
SELECT a.durum, COUNT(*) FROM B360_ARIZA a WHERE {ka} GROUP BY a.durum", new { kDeps, kSube })
            .ToDictionary(x => x.durum ?? "", x => x.adet, StringComparer.OrdinalIgnoreCase);

        int Say(params string[] kodlar) =>
            kodlar.Sum(k => durumlar.TryGetValue(k, out var d) ? d : 0);

        /* Departman kırılımı: hangi ekibin üzerinde iş birikmiş */
        var departmanlar = db.Query($@"
SELECT d.ad AS departman,
       SUM(CASE WHEN a.durum NOT IN (N'cozuldu', N'kapandi') THEN 1 ELSE 0 END) AS acik,
       COUNT(*) AS toplam
FROM B360_ARIZA a
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
WHERE a.olusturma >= @baslangic AND {ka}
GROUP BY d.ad
ORDER BY acik DESC", new { baslangic, kDeps, kSube }).ToList();

        /* Şube kırılımı: en çok kayıt açan mağazalar. Yalnızca ilk on;
           otuz dört şubenin tamamı grafikte okunmuyordu. */
        var subeler = db.Query($@"
SELECT TOP 10 ISNULL(a.sube_kodu, N'—') AS sube, COUNT(*) AS adet
FROM B360_ARIZA a
WHERE a.olusturma >= @baslangic AND {ka}
GROUP BY a.sube_kodu
ORDER BY adet DESC", new { baslangic, kDeps, kSube }).ToList();

        /* Günlük eğilim: son gün sayısı kadar, kayıt olmayan günler de
           sıfırla dolduruluyor — grafikte gün atlaması yanıltıcıydı. */
        var ham = db.Query<(DateTime gun, int adet)>($@"
SELECT CAST(a.olusturma AS DATE), COUNT(*)
FROM B360_ARIZA a
WHERE a.olusturma >= @baslangic AND {ka}
GROUP BY CAST(a.olusturma AS DATE)", new { baslangic, kDeps, kSube })
            .ToDictionary(x => x.gun.Date, x => x.adet);

        var egilim = new List<object>();

        for (var g = baslangic; g <= DateTime.Today; g = g.AddDays(1))
            egilim.Add(new
            {
                gun = g,
                adet = ham.TryGetValue(g, out var d) ? d : 0
            });

        /* Geciken kayıtlar: SLA bitişi geçmiş ve hâlâ kapanmamış */
        var geciken = db.ExecuteScalar<int>($@"
SELECT COUNT(*) FROM B360_ARIZA a
WHERE a.sla_bitis IS NOT NULL AND a.sla_bitis < SYSDATETIME()
  AND a.durum NOT IN (N'cozuldu', N'kapandi') AND {ka}", new { kDeps, kSube });

        /* Ortalama çözüm süresi (saat); yalnızca çözülmüş kayıtlar */
        var ortalama = db.ExecuteScalar<double?>($@"
SELECT AVG(CAST(DATEDIFF(minute, a.olusturma, a.cozum_zamani) AS FLOAT)) / 60.0
FROM B360_ARIZA a
WHERE a.cozum_zamani IS NOT NULL AND a.olusturma >= @baslangic AND {ka}",
            new { baslangic, kDeps, kSube });

        /* Son beş kayıt: daha uzun liste, panonun altındaki bloğu
           gereğinden fazla uzatıyor ve ayrıntı için zaten Arıza
           Kayıtları sayfası var. */
        var sonKayitlar = db.Query($@"
SELECT TOP 5 a.id, a.baslik, a.durum, a.oncelik, a.sube_kodu AS subeKodu,
       a.acan_adi AS acanAdi, a.olusturma, d.ad AS departman
FROM B360_ARIZA a
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
WHERE {ka}
ORDER BY a.olusturma DESC", new { kDeps, kSube }).ToList();

        /* ------------------------------------------------------ envanter */

        var envanter = new
        {
            toplam = db.ExecuteScalar<int>($"SELECT COUNT(*) FROM B360_ENVANTER e WHERE e.durum <> N'pasif' AND {ke}", new { kDeps, kSube }),

            /* Garantisi bir ay içinde bitecekler: yenileme kararı için
               tek başına en işe yarar sayı. */
            garantiBitiyor = db.ExecuteScalar<int>($@"
SELECT COUNT(*) FROM B360_ENVANTER e
WHERE e.durum <> N'pasif' AND e.garanti_bitis IS NOT NULL AND {ke}
  AND e.garanti_bitis BETWEEN CAST(SYSDATETIME() AS DATE)
                        AND DATEADD(day, 30, CAST(SYSDATETIME() AS DATE))", new { kDeps, kSube }),

            bakimGecti = db.ExecuteScalar<int>($@"
SELECT COUNT(*) FROM B360_ENVANTER e
WHERE e.durum <> N'pasif' AND e.sonraki_bakim IS NOT NULL AND {ke}
  AND e.sonraki_bakim < CAST(SYSDATETIME() AS DATE)", new { kDeps, kSube }),

            turler = db.Query($@"
SELECT ISNULL(e.tur, N'Belirtilmemiş') AS tur, COUNT(*) AS adet
FROM B360_ENVANTER e WHERE e.durum <> N'pasif' AND {ke}
GROUP BY e.tur ORDER BY adet DESC", new { kDeps, kSube }).ToList()
        };

        return Ok(new
        {
            gun,
            birim = hedefBirim,
            hazir = true,

            ariza = new
            {
                acik = Say("acik", "yeni"),
                islemde = Say("devam", "islemde", "atandi"),
                beklemede = Say("beklemede"),
                cozuldu = Say("cozuldu"),
                kapandi = Say("kapandi"),
                iptal = Say("iptal"),
                toplam = durumlar.Values.Sum(),
                geciken,
                ortalamaSaat = ortalama is null ? (double?)null : Math.Round(ortalama.Value, 1)
            },

            departmanlar,
            subeler,
            egilim,
            sonKayitlar,
            envanter
        });
    }

    /// <summary>
    /// Hal bölümünün anasayfası: künye okutmaları ve rakip fiyat farkları.
    /// </summary>
    private static object HalPanosu(System.Data.IDbConnection db, DateTime baslangic, int gun)
    {
        /* Künye sorguları dış serviste tutuluyor ve portalda bir tablosu
           olmayabiliyor; sayı alınamazsa blok sıfır gösteriyor, pano
           bu yüzden hiç açılmamalı değil. */
        var kunyeToplam = Sayi(db,
            "SELECT COUNT(*) FROM B360_KUNYE_SORGU WHERE olusturma >= @b", baslangic);

        var kunyeBugun = Sayi(db, @"
SELECT COUNT(*) FROM B360_KUNYE_SORGU
WHERE CAST(olusturma AS DATE) = CAST(SYSDATETIME() AS DATE)");

        var fiyatKayit = Sayi(db,
            "SELECT COUNT(*) FROM B360_RAKIP_FIYAT WHERE olusturma >= @b", baslangic);

        /* Bizim fiyatımızın rakipten yüksek olduğu kayıtlar: hal
           ekibinin ilk baktığı sayı bu. */
        var pahali = Sayi(db, @"
SELECT COUNT(*) FROM B360_RAKIP_FIYAT
WHERE olusturma >= @b AND bizim_fiyat IS NOT NULL
  AND bizim_fiyat > rakip_fiyat", baslangic);

        var enCokFark = new List<dynamic>();

        try
        {
            enCokFark = db.Query(@"
SELECT TOP 8 r.urun_adi AS urunAdi, r.barkod, f.ad AS rakipAdi,
       r.bizim_fiyat AS bizimFiyat, r.rakip_fiyat AS rakipFiyat,
       r.fark, r.fark_yuzde AS farkYuzde, r.sube_kodu AS subeKodu,
       r.olusturma
FROM B360_RAKIP_FIYAT r
    LEFT JOIN B360_RAKIP_FIRMA f ON f.id = r.firma_id
WHERE r.olusturma >= @baslangic AND r.bizim_fiyat IS NOT NULL
ORDER BY r.fark DESC", new { baslangic }).ToList();
        }
        catch
        {
            /* Sütun adları farklıysa blok boş kalır; pano yine açılır */
        }

        var sonKunyeler = new List<dynamic>();

        try
        {
            sonKunyeler = db.Query(@"
SELECT TOP 5 kunye_no AS kunyeNo, urun_adi AS urunAdi, sorgulayan,
       olusturma
FROM B360_KUNYE_SORGU ORDER BY olusturma DESC").ToList();
        }
        catch
        {
            /* Aynı gerekçe */
        }

        return new
        {
            birim = "hal",
            hazir = true,
            gun,

            kunye = new { toplam = kunyeToplam, bugun = kunyeBugun },
            rakip = new { kayit = fiyatKayit, pahali },

            enCokFark,
            sonKunyeler
        };
    }

    /// <summary>Tek değerli sayım; sorgu başarısız olursa sıfır.</summary>
    private static int Sayi(System.Data.IDbConnection db, string sorgu, DateTime? b = null)
    {
        try
        {
            return db.ExecuteScalar<int>(sorgu, b is null ? null : new { b });
        }
        catch
        {
            /* Tablo henüz kurulmamış olabilir; pano bu yüzden hiç
               açılmamalı değil. */
            return 0;
        }
    }
}

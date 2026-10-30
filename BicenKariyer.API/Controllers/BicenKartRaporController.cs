using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen Kart › Kart raporları (29.09.2026)
/// ---------------------------------------------------------------------------
/// Personel kartlarının (panelde eşleşmiş kartlar) toplu görünümü: bakiyeler,
/// hangi şubelerde harcandığı, aylık yükleme ve harcama, hiç harcanmayan
/// puanlar, süresi yaklaşan puanlar, son yüklemeler, ayrılmış personelde
/// kalan bakiye.
///
/// <para>
/// Bakiye Posback'in kendi hesabıyla (dbo.PuanBakiye): süresi geçmemiş
/// kazanma/yükleme/devir partilerinde kalan Puan − EksiPuan. Harcama tutarı
/// panelin diğer ekranlarındaki gibi EksiPuan, boşsa Puan.
/// </para>
///
/// <para>
/// Kart listesi sorguya geçici tablo olarak veriliyor (XML ile tek
/// parametre): binlerce kart numarasını IN listesine yazmak SQL Server'ın
/// 2100 parametre sınırına takılıyordu. Geçici tablo PosbackPromosyon
/// içinde, kendi harmanlamasıyla oluşturuluyor; iki veritabanının
/// harmanlaması farklıysa karşılaştırma hata vermesin.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IK + "," + Roller.IKYoneticisi
                 + "," + Roller.GenelMudurYardimcisi)]
public class BicenKartRaporController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly GiftKartServisi _giftKart;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly YetkiServisi _yetki;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<BicenKartRaporController> _kayit;

    /* Sabitler ve kart yardımcıları internal (03.10.2026): patron görünümü
       (PatronMobilController) bugünkü harcamayı ve toplam bakiyeyi aynı kart
       kümesi ve aynı formüllerle hesaplıyor; ikinci bir kopya zamanla
       panelden sapardı. */
    internal const string HAREKET = "[PosbackPromosyon].[dbo].[PuanHareket]";

    /// <summary>Harcama tutarı: EksiPuan, boşsa Puan.</summary>
    internal const string HARCAMA = "ABS(COALESCE(NULLIF(h.EksiPuan, 0), h.Puan, 0))";

    /// <summary>Posback bakiye koşulu (dbo.PuanBakiye ile aynı).</summary>
    internal const string PARTI =
        "h.IslemTipi IN (1, 3, 4) AND h.Puan - h.EksiPuan > 0 AND h.SonKullanimTarihi >= GETDATE() AND h.PuanKodu = @kod";

    public BicenKartRaporController(VeritabaniServisi vt, GiftKartServisi giftKart,
        PersonelKaynagiServisi personelKaynak, YetkiServisi yetki, IConfiguration yapilandirma,
        ILogger<BicenKartRaporController> kayit)
    {
        _vt = vt;
        _giftKart = giftKart;
        _personelKaynak = personelKaynak;
        _yetki = yetki;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    internal int PuanKodu => int.TryParse(_yapilandirma["BicenKart:PuanKodu"], out var k) ? k : 1;

    /* ------------------------------------------------------------ kartlar */

    /// <summary>Kart sahibi. Tc, Excel çıktısı için (rol yetkisine göre maskeli).</summary>
    internal sealed record Sahip(string KartNo, string Sicil, string AdSoyad, string Sube, bool Aktif, string Tc = null);

    /// <summary>Panelde eşleşmiş kartlar ve sahipleri; personel çalışmıyorsa Aktif = false.</summary>
    internal Dictionary<string, Sahip> Kartlar()
    {
        using var db = _vt.Baglanti();

        var eslesme = db.Query(@"
SELECT kart_no AS kart, personel_kodu AS sicil, ad_soyad AS ad, sube_adi AS sube
FROM KRY_KART_ESLESME").ToList();

        HashSet<string> calisanlar = null;

        /* Sicil → TC kimlik no. Ayrılmış personel de dahil: ayrılanda
           kalan bakiye listesinde de TC yazılsın. Sicil karşılaştırması
           baştaki sıfırlara duyarsız. */
        var kimlikler = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        static string K(string s) => (s ?? "").Trim().TrimStart('0');

        try
        {
            var tumu = _personelKaynak.TumPersonelleriGetir();

            calisanlar = tumu
                .Where(x => x.Durum == 1)
                .Select(x => (x.PersonelKodu ?? "").Trim())
                .ToHashSet();

            foreach (var p in tumu
                         .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu) && !string.IsNullOrWhiteSpace(x.KimlikNo))
                         .OrderByDescending(x => x.Durum == 1))
                kimlikler.TryAdd(K(p.PersonelKodu), p.KimlikNo.Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart raporu: personel durumu okunamadı");
        }

        var sonuc = new Dictionary<string, Sahip>();

        foreach (var x in eslesme)
        {
            var kart = ((string)x.kart ?? "").Trim();

            if (kart.Length == 0 || !kart.All(char.IsDigit)) continue;

            var sicil = ((string)x.sicil ?? "").Trim();

            sonuc[kart] = new Sahip(kart, sicil, ((string)x.ad ?? "").Trim(), ((string)x.sube ?? "").Trim(),
                calisanlar is null || calisanlar.Contains(sicil),
                kimlikler.TryGetValue(K(sicil), out var tc) ? _yetki.KimlikMaskele(Rol, tc) : null);
        }

        return sonuc;
    }

    /// <summary>POS bağlantısını açar ve kart listesini #k geçici tablosuna yazar.</summary>
    internal IDbConnection KartTablosuylaAc(IEnumerable<string> kartlar)
    {
        var pos = _vt.PosBaglantisi();
        pos.Open();

        var xml = "<a>" + string.Join("</a><a>", kartlar) + "</a>";

        /* Parametresiz ayrı komut: Dapper parametreli komutu sp_executesql
           ile çalıştırıyor ve orada oluşturulan geçici tablo komut bitince
           siliniyordu ("Invalid object name '#k'"). Parametresiz komut düz
           toplu iş olarak gidiyor; tablo ve USE bağlantı boyunca kalıyor. */
        pos.Execute("USE [PosbackPromosyon];", commandTimeout: 30);

        pos.Execute(@"
IF OBJECT_ID('tempdb..#k') IS NOT NULL DROP TABLE #k;
CREATE TABLE #k (KartNo VARCHAR(20) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY);", commandTimeout: 60);

        /* Doldurma parametreli olabilir: sp_executesql dıştaki geçici tabloyu görüyor */
        pos.Execute(@"
DECLARE @x XML = @xml;

INSERT INTO #k (KartNo)
SELECT DISTINCT n.value('.', 'VARCHAR(20)')
FROM @x.nodes('/a') t(n)
WHERE LEN(n.value('.', 'VARCHAR(20)')) > 0;", new { xml }, commandTimeout: 60);

        return pos;
    }

    /* Dapper satırları dynamic: argümanlar (object) ile veriliyor ki dönüş
       tipi statik kalsın. Dynamic argümanla sonuç da dynamic oluyor ve demet
       (tuple) dönüşümü çalışma anında "Unable to cast ValueTuple" veriyordu. */
    private sealed record AySatiri(DateTime Ay, int Tip, decimal Tutar, int Adet);

    private static decimal D(object x) => x is null ? 0m : Convert.ToDecimal(x);
    private static int I(object x) => x is null ? 0 : Convert.ToInt32(x);

    /* -------------------------------------------------------------- genel */

    /// <summary>Raporun tamamı: özet, kart bazlı değerler, şubeler, aylık hareket, son yüklemeler.</summary>
    [HttpGet]
    public IActionResult Genel([FromQuery] int gun = 90)
    {
        gun = Math.Clamp(gun, 7, 730);

        var sahipler = Kartlar();

        if (sahipler.Count == 0)
            return Ok(new { gun, kartlar = Array.Empty<object>(), subeler = Array.Empty<object>(), aylik = Array.Empty<object>(), sonYuklemeler = Array.Empty<object>() });

        try
        {
            using var pos = KartTablosuylaAc(sahipler.Keys);

            var bas = DateTime.Today.AddDays(-gun);
            var kod = PuanKodu;

            /* Kart bazlı değerler: tek geçişte */
            var kartSatir = pos.Query($@"
SELECT CONVERT(VARCHAR(20), h.KartNo) AS kartNo,
    SUM(CASE WHEN {PARTI} THEN h.Puan - h.EksiPuan ELSE 0 END) AS bakiye,
    SUM(CASE WHEN {PARTI} AND h.SonKullanimTarihi < DATEADD(DAY, 90, GETDATE()) THEN h.Puan - h.EksiPuan ELSE 0 END) AS dolacak,
    MIN(CASE WHEN {PARTI} AND h.SonKullanimTarihi < DATEADD(DAY, 90, GETDATE()) THEN h.SonKullanimTarihi END) AS dolacakTarih,
    MAX(CASE WHEN h.IslemTipi = 2 THEN h.Tarih END) AS sonHarcama,
    SUM(CASE WHEN h.IslemTipi = 2 THEN {HARCAMA} ELSE 0 END) AS toplamHarcama,
    SUM(CASE WHEN h.IslemTipi = 2 AND h.Tarih >= @bas THEN {HARCAMA} ELSE 0 END) AS donemHarcama,
    SUM(CASE WHEN h.IslemTipi = 2 AND h.Tarih >= @bas THEN 1 ELSE 0 END) AS donemHarcamaAdet,
    MAX(CASE WHEN h.IslemTipi IN (1, 3) THEN h.Tarih END) AS sonYukleme,
    SUM(CASE WHEN h.IslemTipi IN (1, 3) THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS toplamYukleme,
    SUM(CASE WHEN h.IslemTipi IN (1, 3) AND h.Tarih >= @bas THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS donemYukleme,
    SUM(CASE WHEN h.IslemTipi = 6 AND h.Tarih >= @bas THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS donemSilme
FROM {HAREKET} h WITH (NOLOCK)
    INNER JOIN #k k ON k.KartNo = h.KartNo
GROUP BY CONVERT(VARCHAR(20), h.KartNo)", new { bas, kod }, commandTimeout: 180)
                .ToDictionary(x => ((string)x.kartNo ?? "").Trim());

            /* Şubelere göre harcama (dönem) */
            var subeler = pos.Query($@"
SELECT h.SubeId AS subeId,
       SUM({HARCAMA}) AS tutar,
       COUNT(*) AS adet,
       COUNT(DISTINCT h.KartNo) AS kart,
       MAX(h.Tarih) AS son
FROM {HAREKET} h WITH (NOLOCK)
    INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bas
GROUP BY h.SubeId", new { bas }, commandTimeout: 120).ToList();

            /* Son 12 ay: ay ve işlem tipine göre */
            var ayBas = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1).AddMonths(-11);

            var aylikHam = pos.Query($@"
SELECT DATEADD(MONTH, DATEDIFF(MONTH, 0, h.Tarih), 0) AS ay,
       h.IslemTipi AS tip,
       SUM(CASE WHEN h.IslemTipi = 2 THEN {HARCAMA} ELSE ABS(ISNULL(h.Puan, 0)) END) AS tutar,
       COUNT(*) AS adet
FROM {HAREKET} h WITH (NOLOCK)
    INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.Tarih >= @ayBas AND h.IslemTipi IN (1, 2, 3, 4, 6, 9)
GROUP BY DATEADD(MONTH, DATEDIFF(MONTH, 0, h.Tarih), 0), h.IslemTipi", new { ayBas }, commandTimeout: 120)
                .Select(x => new AySatiri(
                    Convert.ToDateTime((object)x.ay),
                    Convert.ToInt32((object)x.tip),
                    D((object)x.tutar),
                    Convert.ToInt32((object)x.adet)))
                .ToList();

            /* Son yüklemeler */
            var sonYuklemeler = pos.Query($@"
SELECT TOP 200 h.Tarih AS tarih, CONVERT(VARCHAR(20), h.KartNo) AS kartNo,
       ABS(ISNULL(h.Puan, 0)) AS tutar, h.SonKullanimTarihi AS sonKullanim, h.IslemTipi AS tip
FROM {HAREKET} h WITH (NOLOCK)
    INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi IN (1, 3)
ORDER BY h.Tarih DESC", commandTimeout: 120).ToList();

            /* ------------------------------------------------ birleştirme */

            var kartlar = sahipler.Values.Select(s =>
            {
                kartSatir.TryGetValue(s.KartNo, out var k);

                return new
                {
                    kartNo = s.KartNo,
                    sicil = s.Sicil,
                    tc = s.Tc,
                    adSoyad = s.AdSoyad,
                    sube = s.Sube,
                    aktif = s.Aktif,
                    bakiye = D((object)k?.bakiye),
                    dolacak = D((object)k?.dolacak),
                    dolacakTarih = (DateTime?)k?.dolacakTarih,
                    sonHarcama = (DateTime?)k?.sonHarcama,
                    toplamHarcama = D((object)k?.toplamHarcama),
                    donemHarcama = D((object)k?.donemHarcama),
                    donemHarcamaAdet = I((object)k?.donemHarcamaAdet),
                    sonYukleme = (DateTime?)k?.sonYukleme,
                    toplamYukleme = D((object)k?.toplamYukleme),
                    donemYukleme = D((object)k?.donemYukleme),
                    donemSilme = D((object)k?.donemSilme),
                };
            }).ToList();

            var aylar = Enumerable.Range(0, 12).Select(i => ayBas.AddMonths(i)).ToList();

            decimal AyTop(DateTime ay, params int[] tipler) =>
                aylikHam.Where(x => x.Ay == ay && tipler.Contains(x.Tip)).Sum(x => x.Tutar);

            int AyAdet(DateTime ay, params int[] tipler) =>
                aylikHam.Where(x => x.Ay == ay && tipler.Contains(x.Tip)).Sum(x => x.Adet);

            var aylik = aylar.Select(a => new
            {
                ay = a.ToString("yyyy-MM"),
                yukleme = AyTop(a, 3),
                kazanma = AyTop(a, 1),
                harcama = AyTop(a, 2),
                harcamaAdet = AyAdet(a, 2),
                iade = AyTop(a, 9),
                devir = AyTop(a, 4),
                silme = AyTop(a, 6),
            }).ToList();

            var subeToplam = subeler.Sum(x => D((object)x.tutar));

            return Ok(new
            {
                gun,
                olusturma = DateTime.Now,
                kartlar,
                subeler = subeler
                    .Select(x => new
                    {
                        subeId = Convert.ToString(x.subeId),
                        subeAdi = _giftKart.SubeAdiBul(x.subeId) ?? "Şube belirsiz",
                        tutar = D((object)x.tutar),
                        adet = I((object)x.adet),
                        kart = I((object)x.kart),
                        son = (DateTime?)x.son,
                        pay = subeToplam > 0 ? Math.Round(D((object)x.tutar) * 100m / subeToplam, 1) : 0m,
                    })
                    .OrderByDescending(x => x.tutar)
                    .ToList(),
                aylik,
                sonYuklemeler = sonYuklemeler.Select(x =>
                {
                    var no = ((string)x.kartNo ?? "").Trim();
                    sahipler.TryGetValue(no, out var s);

                    return new
                    {
                        tarih = (DateTime)x.tarih,
                        kartNo = no,
                        adSoyad = s?.AdSoyad,
                        sicil = s?.Sicil,
                        sube = s?.Sube,
                        tutar = D((object)x.tutar),
                        sonKullanim = (DateTime?)x.sonKullanim,
                        tur = I((object)x.tip) == 1 ? "kazanma" : "yükleme",
                    };
                }).ToList(),
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart raporu hazırlanamadı");
            return StatusCode(502, new { hata = "Kart veritabanından rapor alınamadı.", ayrinti = hata.Message });
        }
    }

    /* ------------------------------------------------------------ şube */

    /// <summary>Bir şubede dönem içinde kartla alışveriş yapanlar.</summary>
    [HttpGet("Sube")]
    public IActionResult Sube([FromQuery] string subeId, [FromQuery] int gun = 90)
    {
        gun = Math.Clamp(gun, 7, 730);

        var sahipler = Kartlar();

        if (sahipler.Count == 0) return Ok(new { kartlar = Array.Empty<object>() });

        try
        {
            using var pos = KartTablosuylaAc(sahipler.Keys);

            var bas = DateTime.Today.AddDays(-gun);
            var bos = string.IsNullOrWhiteSpace(subeId);

            var satirlar = pos.Query($@"
SELECT CONVERT(VARCHAR(20), h.KartNo) AS kartNo,
       SUM({HARCAMA}) AS tutar, COUNT(*) AS adet, MAX(h.Tarih) AS son
FROM {HAREKET} h WITH (NOLOCK)
    INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bas
  AND ({(bos ? "h.SubeId IS NULL" : "CONVERT(VARCHAR(20), h.SubeId) = @subeId")})
GROUP BY CONVERT(VARCHAR(20), h.KartNo)
ORDER BY SUM({HARCAMA}) DESC", new { bas, subeId = (subeId ?? "").Trim() }, commandTimeout: 120).ToList();

            return Ok(new
            {
                subeAdi = bos ? "Şube belirsiz" : _giftKart.SubeAdiBul(subeId),
                kartlar = satirlar.Select(x =>
                {
                    var no = ((string)x.kartNo ?? "").Trim();
                    sahipler.TryGetValue(no, out var s);

                    return new
                    {
                        kartNo = no,
                        adSoyad = s?.AdSoyad,
                        sicil = s?.Sicil,
                        sube = s?.Sube,
                        aktif = s?.Aktif ?? true,
                        tutar = D((object)x.tutar),
                        adet = I((object)x.adet),
                        son = (DateTime?)x.son,
                    };
                }).ToList(),
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart raporu (şube) hazırlanamadı");
            return StatusCode(502, new { hata = "Kart veritabanından rapor alınamadı.", ayrinti = hata.Message });
        }
    }

    /* -------------------------------------------------------------- ay */

    /// <summary>Bir ayda kart bazlı yükleme, harcama ve silme.</summary>
    [HttpGet("Ay")]
    public IActionResult Ay([FromQuery] string ay)
    {
        if (!DateTime.TryParseExact((ay ?? "") + "-01", "yyyy-MM-dd", null,
                System.Globalization.DateTimeStyles.None, out var bas))
            return BadRequest(new { hata = "Ay yyyy-MM biçiminde olmalı." });

        var bit = bas.AddMonths(1);

        var sahipler = Kartlar();

        if (sahipler.Count == 0) return Ok(new { kartlar = Array.Empty<object>() });

        try
        {
            using var pos = KartTablosuylaAc(sahipler.Keys);

            var satirlar = pos.Query($@"
SELECT CONVERT(VARCHAR(20), h.KartNo) AS kartNo,
    SUM(CASE WHEN h.IslemTipi = 3 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS yukleme,
    SUM(CASE WHEN h.IslemTipi = 1 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS kazanma,
    SUM(CASE WHEN h.IslemTipi = 2 THEN {HARCAMA} ELSE 0 END) AS harcama,
    SUM(CASE WHEN h.IslemTipi = 2 THEN 1 ELSE 0 END) AS harcamaAdet,
    SUM(CASE WHEN h.IslemTipi = 4 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS devir,
    SUM(CASE WHEN h.IslemTipi = 6 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS silme,
    SUM(CASE WHEN h.IslemTipi = 9 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS iade
FROM {HAREKET} h WITH (NOLOCK)
    INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.Tarih >= @bas AND h.Tarih < @bit AND h.IslemTipi IN (1, 2, 3, 4, 6, 9)
GROUP BY CONVERT(VARCHAR(20), h.KartNo)", new { bas, bit }, commandTimeout: 120).ToList();

            return Ok(new
            {
                ay = bas.ToString("yyyy-MM"),
                kartlar = satirlar.Select(x =>
                {
                    var no = ((string)x.kartNo ?? "").Trim();
                    sahipler.TryGetValue(no, out var s);

                    return new
                    {
                        kartNo = no,
                        adSoyad = s?.AdSoyad,
                        sicil = s?.Sicil,
                        sube = s?.Sube,
                        aktif = s?.Aktif ?? true,
                        yukleme = D((object)x.yukleme),
                        kazanma = D((object)x.kazanma),
                        harcama = D((object)x.harcama),
                        harcamaAdet = I((object)x.harcamaAdet),
                        devir = D((object)x.devir),
                        silme = D((object)x.silme),
                        iade = D((object)x.iade),
                    };
                })
                .OrderByDescending(x => x.harcama + x.yukleme)
                .ToList(),
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart raporu (ay) hazırlanamadı");
            return StatusCode(502, new { hata = "Kart veritabanından rapor alınamadı.", ayrinti = hata.Message });
        }
    }
}

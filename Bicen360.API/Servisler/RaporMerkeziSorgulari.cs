namespace Bicen360.API.Servisler;

/// <summary>
/// Rapor Merkezi sorguları (Mikro).
///
/// <para>
/// Satış tanımı stok modülündeki sorgularla aynı: <c>sth_tip = 1</c>,
/// <c>sth_cins IN (0,1)</c>, <c>sth_evraktip IN (1,4)</c>, iade olmayan
/// satırlar. Müşteri iadesi (<c>sth_tip = 0</c>, <c>sth_normal_iade = 1</c>)
/// cirodan düşülüyor. Fire, fire raporundaki gibi <c>sth_cins IN (4,5,10)</c>.
/// </para>
///
/// <para>
/// Tutarlar: <c>sth_tutar</c> KDV hariç satır tutarı, iskontolar ayrı
/// sütunlarda, KDV <c>sth_vergi</c>'de. Ciro KDV dahil gösteriliyor
/// (net + KDV), brüt kâr KDV hariç net üzerinden.
/// </para>
///
/// <para>
/// Sunucu eski (uyumluluk düzeyi 130 altı): STRING_SPLIT, OPENJSON,
/// TRY_CONVERT, IIF, FORMAT, GROUPING SETS kullanılmıyor.
/// </para>
/// </summary>
public static class RaporMerkeziSorgulari
{
    /// <summary>Satır iskontolarının toplamı.</summary>
    public const string Iskonto =
        "(ISNULL(h.sth_iskonto1,0) + ISNULL(h.sth_iskonto2,0) + ISNULL(h.sth_iskonto3,0)"
        + " + ISNULL(h.sth_iskonto4,0) + ISNULL(h.sth_iskonto5,0) + ISNULL(h.sth_iskonto6,0))";

    /// <summary>Satırın ait olduğu depo: satışta çıkış, iadede giriş deposu.</summary>
    public const string Depo =
        "(CASE WHEN h.sth_tip = 1 THEN h.sth_cikis_depo_no ELSE h.sth_giris_depo_no END)";

    /// <summary>Satış (+1) ya da müşteri iadesi (−1).</summary>
    public const string Yon = "(CASE WHEN h.sth_tip = 1 THEN 1 ELSE -1 END)";

    /// <summary>Satış ve müşteri iadesi satırları.</summary>
    public const string SatisKosulu = @"
      h.sth_cins IN (0,1)
  AND ((h.sth_tip = 1 AND h.sth_normal_iade = 0 AND h.sth_evraktip IN (1,4))
    OR (h.sth_tip = 0 AND h.sth_normal_iade = 1))";

    /// <summary>Fiş anahtarı: evrak seri + sıra (+ tür).</summary>
    public const string Evrak =
        "(CASE WHEN h.sth_tip = 1 THEN CAST(h.sth_evraktip AS VARCHAR(4)) + '|' + ISNULL(h.sth_evrakno_seri,'') + '|' + CAST(h.sth_evrakno_sira AS VARCHAR(12)) END)";

    /* ==================================================================== */
    /* Fiyat ve maliyet                                                     */
    /* ==================================================================== */

    /// <summary>Genel satış fiyatı (liste 1, tüm depolar), en düşük ödeme planı.</summary>
    public const string Fiyat = @"
SELECT kod, fiyat FROM (
  SELECT sfiyat_stokkod AS kod, sfiyat_fiyati AS fiyat,
         ROW_NUMBER() OVER (PARTITION BY sfiyat_stokkod ORDER BY sfiyat_odemeplan) AS sira
  FROM STOK_SATIS_FIYAT_LISTELERI WITH (NOLOCK)
  WHERE sfiyat_listesirano = 1 AND sfiyat_deposirano = 0
) x WHERE sira = 1";

    /// <summary>
    /// Ortalama alış maliyeti: son 365 günün tedarikçi alışları (KDV
    /// hariç, iskonto düşülmüş) ağırlıklı ortalaması. Satış fiyatıyla
    /// tutarsız olanlar (birim farkı) boş sayılıyor.
    /// </summary>
    public const string Maliyet = @"
SELECT sth_stok_kod AS kod,
       SUM(sth_tutar - (ISNULL(sth_iskonto1,0) + ISNULL(sth_iskonto2,0) + ISNULL(sth_iskonto3,0)
                      + ISNULL(sth_iskonto4,0) + ISNULL(sth_iskonto5,0) + ISNULL(sth_iskonto6,0)))
         / NULLIF(SUM(sth_miktar), 0) AS maliyet
FROM STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_tip = 0 AND sth_cins = 0 AND sth_normal_iade = 0
  AND sth_miktar > 0 AND sth_tutar > 0 AND ISNULL(sth_cari_kodu, '') <> ''
  AND sth_tarih >= DATEADD(day, -365, CAST(GETDATE() AS DATE))
GROUP BY sth_stok_kod";

    /// <summary>Bağlantıda yalnızca #f (fiyat) geçici tablosunu kurar.</summary>
    public static readonly string GeciciFiyat = @"
SET NOCOUNT ON;
IF OBJECT_ID('tempdb..#f') IS NOT NULL DROP TABLE #f;
SELECT kod, fiyat INTO #f FROM (" + Fiyat + @") a;
CREATE CLUSTERED INDEX IX_f ON #f(kod);";

    /// <summary>Bağlantıda #f (fiyat) ve #m (maliyet) geçici tablolarını kurar.</summary>
    public static readonly string GeciciTablolar = @"
SET NOCOUNT ON;
IF OBJECT_ID('tempdb..#f') IS NOT NULL DROP TABLE #f;
IF OBJECT_ID('tempdb..#m') IS NOT NULL DROP TABLE #m;

SELECT kod, fiyat INTO #f FROM (" + Fiyat + @") a;
CREATE CLUSTERED INDEX IX_f ON #f(kod);

SELECT m.kod,
       CASE WHEN f.fiyat > 0 AND (m.maliyet > f.fiyat * 1.5 OR m.maliyet < f.fiyat * 0.05)
            THEN NULL ELSE m.maliyet END AS maliyet
INTO #m
FROM (" + Maliyet + @") m LEFT JOIN #f f ON f.kod = m.kod
WHERE m.maliyet IS NOT NULL AND m.maliyet > 0;
CREATE CLUSTERED INDEX IX_m ON #m(kod);";

    /* ==================================================================== */
    /* Günlük küp                                                           */
    /* ==================================================================== */

    /// <summary>Gün × depo × ana grup satış özeti.</summary>
    public static readonly string GrupSatis = @"
SELECT CAST(h.sth_tarih AS DATE) AS gun, " + Depo + @" AS depo,
       ISNULL(s.sto_anagrup_kod, '') AS grup,
       SUM(" + Yon + " * (h.sth_tutar - " + Iskonto + @")) AS net,
       SUM(" + Yon + @" * ISNULL(h.sth_vergi, 0)) AS vergi,
       SUM(CASE WHEN m.maliyet IS NULL THEN 0 ELSE " + Yon + " * (h.sth_tutar - " + Iskonto + @") END) AS netM,
       SUM(CASE WHEN m.maliyet IS NULL THEN 0 ELSE " + Yon + @" * h.sth_miktar * m.maliyet END) AS maliyet,
       SUM(" + Yon + @" * h.sth_miktar) AS miktar,
       COUNT(DISTINCT " + Evrak + @") AS fis
FROM STOK_HAREKETLERI h WITH (NOLOCK)
    INNER JOIN STOKLAR s WITH (NOLOCK) ON s.sto_kod = h.sth_stok_kod
    LEFT JOIN #m m ON m.kod = h.sth_stok_kod
WHERE h.sth_tarih >= @bas AND h.sth_tarih < @bit AND " + SatisKosulu + @"
GROUP BY CAST(h.sth_tarih AS DATE), " + Depo + @", ISNULL(s.sto_anagrup_kod, '')";

    /// <summary>Gün × depo × ana grup fire tutarı (satış fiyatıyla).</summary>
    public static readonly string GrupFire = @"
SELECT CAST(h.sth_tarih AS DATE) AS gun, " + Depo + @" AS depo,
       ISNULL(s.sto_anagrup_kod, '') AS grup,
       SUM((CASE WHEN h.sth_tip = 1 THEN h.sth_miktar ELSE -h.sth_miktar END) * ISNULL(f.fiyat, 0)) AS fire
FROM STOK_HAREKETLERI h WITH (NOLOCK)
    INNER JOIN STOKLAR s WITH (NOLOCK) ON s.sto_kod = h.sth_stok_kod
    LEFT JOIN #f f ON f.kod = h.sth_stok_kod
WHERE h.sth_tarih >= @bas AND h.sth_tarih < @bit
  AND h.sth_cins IN (4,5,10) AND h.sth_tip IN (0,1)
GROUP BY CAST(h.sth_tarih AS DATE), " + Depo + @", ISNULL(s.sto_anagrup_kod, '')";

    /// <summary>
    /// Gün × depo × saat ciro ve fiş. Saat, satırın oluşturulma
    /// zamanından; POS sorgusu tanımlıysa onun yerine o kullanılıyor.
    /// </summary>
    public static readonly string SaatSatis = @"
SELECT CAST(h.sth_tarih AS DATE) AS gun, " + Depo + @" AS depo,
       DATEPART(hour, h.sth_create_date) AS saat,
       SUM(" + Yon + " * (h.sth_tutar - " + Iskonto + @" + ISNULL(h.sth_vergi, 0))) AS ciro,
       COUNT(DISTINCT " + Evrak + @") AS fis
FROM STOK_HAREKETLERI h WITH (NOLOCK)
WHERE h.sth_tarih >= @bas AND h.sth_tarih < @bit AND " + SatisKosulu + @"
GROUP BY CAST(h.sth_tarih AS DATE), " + Depo + @", DATEPART(hour, h.sth_create_date)";

    /* ==================================================================== */
    /* Ürün satışları                                                       */
    /* ==================================================================== */

    /// <summary>Dönemde en çok ciro yapan ürünler. {DEPOLAR} doğrulanmış sayı listesi.</summary>
    public static readonly string UrunSatis = @"
SELECT TOP 2000 h.sth_stok_kod AS kod,
       SUM(" + Yon + @" * h.sth_miktar) AS miktar,
       SUM(" + Yon + " * (h.sth_tutar - " + Iskonto + @")) AS net,
       SUM(" + Yon + " * (h.sth_tutar - " + Iskonto + @" + ISNULL(h.sth_vergi, 0))) AS ciro
FROM STOK_HAREKETLERI h WITH (NOLOCK)
    INNER JOIN STOKLAR s WITH (NOLOCK) ON s.sto_kod = h.sth_stok_kod
WHERE h.sth_tarih >= @bas AND h.sth_tarih < @bit AND " + SatisKosulu + @"
  AND ((h.sth_tip = 1 AND h.sth_cikis_depo_no IN ({DEPOLAR}))
    OR (h.sth_tip = 0 AND h.sth_giris_depo_no IN ({DEPOLAR})))
  AND (@grup IS NULL OR s.sto_anagrup_kod = @grup)
GROUP BY h.sth_stok_kod
ORDER BY SUM(" + Yon + " * (h.sth_tutar - " + Iskonto + @" + ISNULL(h.sth_vergi, 0))) DESC";

    /* ==================================================================== */
    /* Stok kartları ve gruplar                                             */
    /* ==================================================================== */

    public static readonly string Kartlar = @"
SELECT s.sto_kod AS kod, s.sto_isim AS ad, ISNULL(s.sto_anagrup_kod, '') AS grup,
       ISNULL(s.sto_birim1_ad, '') AS birim, b.barkod, f.fiyat, m.maliyet
FROM STOKLAR s WITH (NOLOCK)
    LEFT JOIN (SELECT bar_stokkodu, MIN(bar_kodu) AS barkod FROM BARKOD_TANIMLARI WITH (NOLOCK)
               WHERE bar_master = 1 GROUP BY bar_stokkodu) b ON b.bar_stokkodu = s.sto_kod
    LEFT JOIN #f f ON f.kod = s.sto_kod
    LEFT JOIN #m m ON m.kod = s.sto_kod";

    public const string Gruplar = @"
SELECT san_kod AS kod, san_isim AS ad FROM STOK_ANA_GRUPLARI WITH (NOLOCK) ORDER BY san_isim";

    /* ==================================================================== */
    /* Merkez depo stoğu                                                    */
    /* ==================================================================== */

    /// <summary>
    /// Merkez depoların (100, 103) eldeki stoğu ve son 21 günde şubelere
    /// çıkan miktar. PUSULA'da merkez sütunu yoksa kullanılıyor.
    /// </summary>
    public const string MerkezStok = @"
SELECT sth_stok_kod AS kod,
       SUM(CASE WHEN sth_tip IN (0,2) AND sth_giris_depo_no IN (100,103) THEN sth_miktar ELSE 0 END)
     - SUM(CASE WHEN sth_tip IN (1,2) AND sth_cikis_depo_no IN (100,103) THEN sth_miktar ELSE 0 END) AS miktar,
       SUM(CASE WHEN sth_tip IN (1,2) AND sth_cikis_depo_no IN (100,103)
                 AND NOT (sth_tip = 2 AND sth_giris_depo_no IN (100,103))
                 AND sth_cins NOT IN (4,5,10)
                 AND sth_tarih >= DATEADD(day, -21, CAST(GETDATE() AS DATE))
                THEN sth_miktar ELSE 0 END) AS cikis21
FROM STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_cins NOT IN (9,15)
  AND (sth_giris_depo_no IN (100,103) OR sth_cikis_depo_no IN (100,103))
GROUP BY sth_stok_kod";

    /* ==================================================================== */
    /* Merkez depo transferleri                                             */
    /* ==================================================================== */

    /// <summary>
    /// Son 14 günün merkez depodan şubelere sipariş belgeleri. Durum:
    /// hiç sevk yoksa hazırlanıyor, nakliyesi sürüyorsa yolda, hepsi
    /// teslimse teslim alındı. {SIPARIS_BAG} stok servisindeki gibi.
    /// </summary>
    public const string Transferler = @"
SELECT ISNULL(s.ssip_evrakno_seri, '') AS seri, s.ssip_evrakno_sira AS sira,
       s.ssip_girdepo AS depo, MIN(s.ssip_tarih) AS tarih,
       COUNT(*) AS kalem,
       SUM(s.ssip_miktar * ISNULL(f.fiyat, 0)) AS tutar,
       SUM(CASE WHEN g.sevk = 1 THEN 1 ELSE 0 END) AS sevk,
       SUM(CASE WHEN g.yolda = 1 THEN 1 ELSE 0 END) AS yolda
FROM DEPOLAR_ARASI_SIPARISLER s WITH (NOLOCK)
    LEFT JOIN #f f ON f.kod = s.ssip_stok_kod
    OUTER APPLY (
        SELECT TOP 1 1 AS sevk, CASE WHEN sth.sth_nakliyedurumu = 0 THEN 1 ELSE 0 END AS yolda
        FROM STOK_HAREKETLERI_EK ek WITH (NOLOCK)
            INNER JOIN STOK_HAREKETLERI sth WITH (NOLOCK) ON ek.sthek_related_RECno = sth.sth_RECno
        WHERE {SIPARIS_BAG} = s.ssip_RECno
    ) g
WHERE s.ssip_cikdepo IN (100,103)
  AND s.ssip_tarih >= DATEADD(day, -14, CAST(GETDATE() AS DATE))
GROUP BY ISNULL(s.ssip_evrakno_seri, ''), s.ssip_evrakno_sira, s.ssip_girdepo
ORDER BY MIN(s.ssip_tarih) DESC";

    /* ==================================================================== */
    /* Son kullanma tarihi                                                  */
    /* ==================================================================== */

    /// <summary>
    /// SKT'si 7 gün içinde dolan partiler ve depolardaki kalan miktarları.
    /// Mikro'da parti-lot takibi (PARTILOT) kullanılıyorsa dolu gelir.
    /// </summary>
    public const string Skt = @"
SELECT p.kod, p.parti, p.lot, p.skt, x.depo, SUM(x.miktar) AS miktar
FROM (
    SELECT pl_stokkodu AS kod, pl_partikodu AS parti, pl_lotno AS lot, pl_son_kullanim_tar AS skt
    FROM PARTILOT WITH (NOLOCK)
    WHERE pl_son_kullanim_tar >= CAST(GETDATE() AS DATE)
      AND pl_son_kullanim_tar < DATEADD(day, 8, CAST(GETDATE() AS DATE))
) p
INNER JOIN (
    SELECT sth_stok_kod AS kod, sth_parti_kodu AS parti, sth_lot_no AS lot,
           sth_giris_depo_no AS depo, sth_miktar AS miktar
    FROM STOK_HAREKETLERI WITH (NOLOCK)
    WHERE sth_tip IN (0,2) AND sth_cins NOT IN (9,15) AND ISNULL(sth_parti_kodu, '') <> ''
    UNION ALL
    SELECT sth_stok_kod, sth_parti_kodu, sth_lot_no, sth_cikis_depo_no, -sth_miktar
    FROM STOK_HAREKETLERI WITH (NOLOCK)
    WHERE sth_tip IN (1,2) AND sth_cins NOT IN (9,15) AND ISNULL(sth_parti_kodu, '') <> ''
) x ON x.kod = p.kod AND x.parti = p.parti AND x.lot = p.lot
GROUP BY p.kod, p.parti, p.lot, p.skt, x.depo
HAVING SUM(x.miktar) > 0.001";
}

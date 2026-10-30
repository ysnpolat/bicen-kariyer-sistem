namespace Bicen360.API.Servisler;

/// <summary>
/// Stok sorguları.
///
/// <para>
/// Sorgular Mikro üzerinde çalışıyor ve hepsinde depo numarası elle
/// yazılıydı; burada <c>{DEPO}</c>, <c>{YIL}</c> gibi yer tutucularla
/// parametreli hâle getirildi. Dapper parametresi kullanılamıyor çünkü
/// depo numarası bazı yerlerde alt sorguların içinde ve indeks
/// seçimini etkiliyor; sayı olduğu doğrulandıktan sonra metne
/// gömülüyor (<see cref="StokServisi.Sayi"/>).
/// </para>
///
/// <para>
/// Sorgular ağır: her biri STOK_HAREKETLERI tablosunu tarıyor. Servis
/// katmanı sonuçları önbelleğe alıyor.
/// </para>
/// </summary>
public static class StokSorgulari
{
    /// <summary>Ortak dışlama: sigara-alkol, tadolya ve analiz dışı kategoriler.</summary>
    public const string Haric = @"
NOT (STOKLAR.sto_model_kodu IN ('006')
     OR STOKLAR.sto_anagrup_kod IN ('01','02','28','31','34','26')
     OR STOKLAR.sto_kategori_kodu IN ('34.1','09.7.2','09.10.4','04.15.9'))";

    /* ==================================================================== */
    /* 1 · Sipariş önerisi                                                  */
    /* ==================================================================== */

    public const string SiparisOnerisi = @"
SELECT TOP 500
       [STOK KOD] AS stokKod, [BARKOD] AS barkod, [STOK İSMİ] AS stokIsim,
       [STOK ANAGRUP] AS anaGrup, [STOK KATEGORI] AS kategori,
       [SATICI CARİ ADI] AS satici, [SATIN ALMA] AS satinAlma,
       [GENEL SATIŞ FİYATI] AS fiyat, [ENVANTER] AS envanter,
       [KOLİ İÇİ] AS koli, [PAKET İÇİ] AS paket,
       [MERKEZ DEPODAKİ MİKTAR] AS merkezStok, [KENDİ DEPONDAKİ MİKTAR] AS stok,
       [SATIŞ MİKTARI] AS satis, [SDG] AS sdg,
       [STOK KAÇ GÜN ÖNCE GELDİ] AS girisGun, [STOK KAÇ GÜN ÖNCE SATILDI] AS satisGun,
       [SIPARIS AÇIKLAMA] AS durum,
       (CASE WHEN [MAXİMUM SİPARİŞ ADET] <= 2 AND [KENDİ DEPONDAKİ MİKTAR] <= 3 AND [PAKET İÇİ] > 2
                  THEN [PAKET İÇİ]
             WHEN (([MAXİMUM SİPARİŞ ADET] <= 2 AND [KENDİ DEPONDAKİ MİKTAR] <= 3)
                   OR [MAXİMUM SİPARİŞ ADET] <= 0) AND [KOLİ İÇİ] > 2
                  THEN [KOLİ İÇİ]
             WHEN (([MAXİMUM SİPARİŞ ADET] <= 2 AND [KENDİ DEPONDAKİ MİKTAR] <= 3)
                   OR [MAXİMUM SİPARİŞ ADET] <= 0) AND [KOLİ İÇİ] < 3 AND [PAKET İÇİ] < 3
                  THEN 4
             ELSE [MAXİMUM SİPARİŞ ADET] END) AS oneri
FROM (
  SELECT *,
    (CASE
       WHEN [SIPARIS AÇIKLAMA] = 'SATICIDAN SİPARİŞ' AND (SDG <= 8 OR [KENDİ DEPONDAKİ MİKTAR] <= 3)
            AND [KOLİ İÇİ] > 1 AND (21 - ISNULL(farkgun,0)) > 0
         THEN ROUND(((((([SATIŞ MİKTARI] - ISNULL(G_INS_M,0)) / (21 - ISNULL(farkgun,0)))
              * (15 - SDG) + 6) / [KOLİ İÇİ]) + 0.5), 0) * [KOLİ İÇİ]
       WHEN [SIPARIS AÇIKLAMA] = 'DEPODAN SİPARİŞ' AND (SDG <= 3 OR [KENDİ DEPONDAKİ MİKTAR] <= 3)
            AND [KOLİ İÇİ] > 1 AND (21 - ISNULL(farkgun,0)) > 0
         THEN ROUND((((([SATIŞ MİKTARI] - ISNULL(G_INS_M,0)) / (21 - ISNULL(farkgun,0)))
              * (10 - (CASE WHEN [KENDİ DEPONDAKİ MİKTAR] <= 3 THEN 0 ELSE SDG END)))
              / [KOLİ İÇİ]) + 0.5, 0) * [KOLİ İÇİ]
       WHEN [SIPARIS AÇIKLAMA] = 'SATICIDAN SİPARİŞ' AND (SDG <= 8 OR [KENDİ DEPONDAKİ MİKTAR] <= 3)
            AND [PAKET İÇİ] < 2 AND [KOLİ İÇİ] < 2 AND (21 - ISNULL(farkgun,0)) > 0
         THEN ROUND(((([SATIŞ MİKTARI] - ISNULL(G_INS_M,0)) / (21 - ISNULL(farkgun,0))) * (15 - SDG)), 0)
       WHEN [SIPARIS AÇIKLAMA] = 'DEPODAN SİPARİŞ' AND (SDG <= 5 OR [KENDİ DEPONDAKİ MİKTAR] <= 3)
            AND [PAKET İÇİ] < 2 AND [KOLİ İÇİ] < 2 AND (21 - ISNULL(farkgun,0)) > 0
         THEN ROUND(((([SATIŞ MİKTARI] - ISNULL(G_INS_M,0)) / (21 - ISNULL(farkgun,0)))
              * (10 - (CASE WHEN [KENDİ DEPONDAKİ MİKTAR] <= 3 THEN 0 ELSE SDG END))), 0)
     END) AS [MAXİMUM SİPARİŞ ADET]
  FROM (
    SELECT *,
      (CASE
         WHEN MKD = 1 THEN 'MAL KABULE KAPALI'
         WHEN ([MERKEZ DEPODAKİ MİKTAR] <= 0 AND [STOK SEVK ADRESİ] = 'FİRMA SEVK')
              AND ([KENDİ DEPONDAKİ MİKTAR] <= 3 OR SDG <= 8) AND MKD = 0 THEN 'SATICIDAN SİPARİŞ'
         WHEN ([MERKEZ DEPODAKİ MİKTAR] > 0 OR [STOK SEVK ADRESİ] = 'MERKEZDEPO SEVK')
              AND ([KENDİ DEPONDAKİ MİKTAR] <= 3 OR SDG <= 5) AND MKD = 0 THEN 'DEPODAN SİPARİŞ'
         WHEN [SATIŞ MİKTARI] = 0 AND MKD = 0 AND [KENDİ DEPONDAKİ MİKTAR] > 3 THEN 'ÜRÜN HİÇ SATMIYOR'
         WHEN [SATIŞ MİKTARI] > 0 AND SDG > 100 AND MKD = 0 THEN 'ÇOK YAVAŞ SATIYOR'
         WHEN [KENDİ DEPONDAKİ MİKTAR] < 0 AND MKD = 0 THEN 'STOĞUNUZU DÜZELTİN'
       END) AS [SIPARIS AÇIKLAMA]
    FROM (
      SELECT *,
        [KENDİ DEPONDAKİ MİKTAR] * [GENEL SATIŞ FİYATI] AS [ENVANTER],
        ROUND(CASE WHEN [SATIŞ MİKTARI] > 0
                   THEN ([KENDİ DEPONDAKİ MİKTAR] * 21) / [SATIŞ MİKTARI] ELSE 999 END, 0) AS [SDG]
      FROM (
        SELECT
          STOKLAR.sto_kod AS [STOK KOD],
          ISNULL((SELECT TOP 1 bar_kodu FROM BARKOD_TANIMLARI WITH (NOLOCK, INDEX = NDX_BARKOD_TANIMLARI_03)
                  WHERE bar_stokkodu = STOKLAR.sto_kod AND bar_master = 1), 'MSTR.BRKD.TNMSZ') AS [BARKOD],
          STOK_ANA_GRUPLARI.san_isim AS [STOK ANAGRUP],
          STOK_KATEGORILERI.ktg_isim AS [STOK KATEGORI],
          STOKLAR.sto_isim AS [STOK İSMİ],
          CARI_HESAPLAR.cari_unvan1 AS [SATICI CARİ ADI],
          (SELECT RTRIM(cari_per_adi) + ' ' + RTRIM(cari_per_soyadi)
           FROM CARI_PERSONEL_TANIMLARI WITH (NOLOCK)
           WHERE cari_per_kod = STOKLAR.sto_urun_sorkod) AS [SATIN ALMA],
          ABS(STOKLAR.sto_birim2_katsayi) AS [KOLİ İÇİ],
          ABS(STOKLAR.sto_birim3_katsayi) AS [PAKET İÇİ],
          (CASE WHEN sto_sezon_kodu = 1 THEN 'FİRMA SEVK'
                WHEN sto_sezon_kodu = 0 THEN 'MERKEZDEPO SEVK' ELSE 'TANIMSIZ' END) AS [STOK SEVK ADRESİ],
          (SELECT TOP 1 sfiyat_fiyati FROM STOK_SATIS_FIYAT_LISTELERI
             WITH (NOLOCK, INDEX = NDX_STOK_SATIS_FIYAT_LISTELERI_02)
           WHERE sfiyat_stokkod = STOKLAR.sto_kod AND sfiyat_listesirano = 1 AND sfiyat_deposirano = 0
           ORDER BY sfiyat_odemeplan) AS [GENEL SATIŞ FİYATI],
          ROUND(ISNULL(nn.[MERKEZ DEPODAKİ MİKTAR], 0), 1) AS [MERKEZ DEPODAKİ MİKTAR],
          ROUND(ISNULL(nn.[KENDİ DEPONDAKİ MİKTAR], 0), 1) AS [KENDİ DEPONDAKİ MİKTAR],
          ROUND(ISNULL(zz.[SATIŞ MİKTARI], 0), 1) AS [SATIŞ MİKTARI],
          kgog.[STOK KAÇ GÜN ÖNCE GELDİ], kgos.[STOK KAÇ GÜN ÖNCE SATILDI],
          ISNULL(mk.[MKD], 0) AS [MKD], instt.farkgun, instt.G_INS_M
        FROM STOKLAR WITH (NOLOCK, INDEX = NDX_STOKLAR_03)
          LEFT JOIN STOK_ANA_GRUPLARI ON STOKLAR.sto_anagrup_kod = STOK_ANA_GRUPLARI.san_kod
          LEFT JOIN STOK_KATEGORILERI ON STOKLAR.sto_kategori_kodu = STOK_KATEGORILERI.ktg_kod
          LEFT JOIN CARI_HESAPLAR ON STOKLAR.sto_sat_cari_kod = CARI_HESAPLAR.cari_kod
          LEFT JOIN (
            SELECT sth_stok_kod,
              SUM(CASE WHEN sth_depono IN (103,100) AND sth_giris_cikis = 0 THEN sth_miktar
                       WHEN sth_depono IN (103,100) AND sth_giris_cikis = 1 THEN sth_miktar * -1 END)
                AS [MERKEZ DEPODAKİ MİKTAR],
              SUM(CASE WHEN sth_depono = {DEPO} AND sth_giris_cikis = 0 THEN sth_miktar
                       WHEN sth_depono = {DEPO} AND sth_giris_cikis = 1 THEN sth_miktar * -1 END)
                AS [KENDİ DEPONDAKİ MİKTAR]
            FROM (
              SELECT 0 AS sth_giris_cikis,
                CASE WHEN sth_tip = 0 THEN sth_giris_depo_no WHEN sth_tip = 1 THEN sth_cikis_depo_no
                     WHEN sth_tip = 2 THEN sth_giris_depo_no END AS sth_depono, *
              FROM STOK_HAREKETLERI WITH (NOLOCK) WHERE sth_tip <> 1
              UNION ALL
              SELECT 1 AS sth_giris_cikis, sth_cikis_depo_no AS sth_depono, *
              FROM STOK_HAREKETLERI WITH (NOLOCK) WHERE sth_tip <> 0
            ) h
            WHERE sth_cins NOT IN (9,15) AND sth_depono IN ({DEPO},103,100)
            GROUP BY sth_stok_kod
          ) nn ON STOKLAR.sto_kod = nn.sth_stok_kod
          LEFT JOIN (
            SELECT sth_stok_kod, SUM(CASE WHEN sth_tip = 1 THEN sth_miktar ELSE 0 END) AS [SATIŞ MİKTARI]
            FROM STOK_HAREKETLERI WITH (NOLOCK, INDEX = NDX_STOK_HAREKETLERI_14)
            WHERE sth_tarih <= CAST(GETDATE() AS DATE)
              AND sth_tarih >= DATEADD(d, -21, CAST(GETDATE() AS DATE))
              AND sth_miktar <> 0 AND sth_tip = 1 AND sth_cins IN (1)
              AND sth_evraktip IN (1,4) AND sth_cikis_depo_no = {DEPO}
            GROUP BY sth_stok_kod
          ) zz ON zz.sth_stok_kod = STOKLAR.sto_kod
          LEFT JOIN (
            SELECT sth_stok_kod, CAST(GETDATE() - MAX(sth_tarih) AS INT) AS [STOK KAÇ GÜN ÖNCE GELDİ]
            FROM STOK_HAREKETLERI WITH (NOLOCK, INDEX = NDX_STOK_HAREKETLERI_14)
            WHERE (sth_tip = 0 OR sth_tip = 2) AND sth_giris_depo_no = {DEPO} AND sth_normal_iade = 0
              AND sth_cins NOT IN (9,15,10) AND sth_tarih <= CAST(GETDATE() AS DATE)
            GROUP BY sth_stok_kod
          ) kgog ON kgog.sth_stok_kod = STOKLAR.sto_kod
          LEFT JOIN (
            SELECT sth_stok_kod, CAST(GETDATE() - MAX(sth_tarih) AS INT) AS [STOK KAÇ GÜN ÖNCE SATILDI]
            FROM STOK_HAREKETLERI WITH (NOLOCK, INDEX = NDX_STOK_HAREKETLERI_14)
            WHERE sth_tip = 1 AND sth_cikis_depo_no = {DEPO} AND sth_cins IN (0,1)
              AND sth_normal_iade = 0 AND sth_cins NOT IN (9,15,10)
            GROUP BY sth_stok_kod
          ) kgos ON kgos.sth_stok_kod = STOKLAR.sto_kod
          LEFT JOIN (
            SELECT sdp_depo_kod, ISNULL(sdp_malkabuldursun, 0) AS [MKD]
            FROM STOK_DEPO_DETAYLARI WITH (NOLOCK, INDEX = NDX_STOK_DEPO_DETAYLARI_02)
            WHERE sdp_depo_no = {DEPO}
          ) mk ON mk.sdp_depo_kod = STOKLAR.sto_kod
          LEFT JOIN (
            SELECT fid_stok_kod, SUM(farkgun) AS farkgun, SUM(G_INS_M) AS G_INS_M
            FROM (
              SELECT zz.fid_stok_kod,
                CAST(zz.fid_tarih - dnm.fid_tarihilk AS INT) AS farkgun,
                (SELECT SUM(CASE WHEN sth_tip = 1 THEN sth_miktar ELSE 0 END)
                 FROM STOK_HAREKETLERI WITH (NOLOCK, INDEX = NDX_STOK_HAREKETLERI_14)
                 WHERE sth_miktar <> 0 AND sth_tip = 1 AND sth_normal_iade = 0
                   AND sth_cins IN (1,0) AND sth_evraktip IN (1,4) AND sth_cikis_depo_no = {DEPO}
                   AND sth_cins NOT IN (9,15)
                   AND sth_tarih BETWEEN dnm.fid_tarihilk AND zz.fid_tarih
                   AND sth_stok_kod = zz.fid_stok_kod) AS G_INS_M
              FROM (
                SELECT fid_fiyat_no, fid_stok_kod, fid_depo_no, fid_tarih, fid_belge_no
                FROM STOK_FIYAT_DEGISIKLIKLERI WITH (NOLOCK, INDEX = NDX_STOK_FIYAT_DEGISIKLIKLERI_04)
                WHERE fid_fiyat_deg_neden = 4 AND fid_depo_no = {DEPO}
                  AND fid_tarih BETWEEN DATEADD(d, -21, CAST(GETDATE() AS DATE)) AND CAST(GETDATE() AS DATE)
              ) zz
              OUTER APPLY (
                SELECT TOP 1 CASE WHEN nn.fid_tarih <= DATEADD(d, -21, CAST(GETDATE() AS DATE))
                                  THEN DATEADD(d, -21, CAST(GETDATE() AS DATE)) ELSE nn.fid_tarih END AS fid_tarihilk
                FROM STOK_FIYAT_DEGISIKLIKLERI nn WITH (NOLOCK, INDEX = NDX_STOK_FIYAT_DEGISIKLIKLERI_03)
                WHERE nn.fid_fiyat_deg_neden = 3 AND nn.fid_stok_kod = zz.fid_stok_kod
                  AND nn.fid_tarih <= zz.fid_tarih AND nn.fid_depo_no = zz.fid_depo_no
                  AND nn.fid_belge_no = zz.fid_belge_no
                ORDER BY nn.fid_tarih DESC
              ) dnm
            ) inst
            WHERE G_INS_M > 0
            GROUP BY fid_stok_kod
          ) instt ON instt.fid_stok_kod = STOKLAR.sto_kod
        WHERE " + Haric + @"
      ) t1
    ) t2
    WHERE NOT (MKD = 1 AND [SATIŞ MİKTARI] = 0 AND [MERKEZ DEPODAKİ MİKTAR] <= 0
               AND [KENDİ DEPONDAKİ MİKTAR] = 0)
  ) t3
) t4
WHERE [SIPARIS AÇIKLAMA] IS NOT NULL
ORDER BY CASE WHEN [SIPARIS AÇIKLAMA] LIKE '%SİPARİŞ' THEN 0 ELSE 1 END, [SDG]";

    /* ==================================================================== */
    /* 2 · Depo stok durumu                                                 */
    /* ==================================================================== */

    public const string DepoDurum = @"
SELECT TOP 2000 * FROM (
  SELECT
    STOKLAR.sto_kod AS stokKod,
    ISNULL((SELECT TOP 1 bar_kodu FROM BARKOD_TANIMLARI WITH (NOLOCK, INDEX = NDX_BARKOD_TANIMLARI_03)
            WHERE bar_stokkodu = STOKLAR.sto_kod AND bar_master = 1), 'MSTR.BRKD.TNMSZ') AS barkod,
    STOKLAR.sto_isim AS stokIsim,
    STOK_ANA_GRUPLARI.san_isim AS anaGrup,
    (SELECT TOP 1 cari_unvan1 FROM CARI_HESAPLAR WHERE cari_kod = STOKLAR.sto_sat_cari_kod) AS satici,
    CARI_PERSONEL_TANIMLARI.cari_per_adi AS satinAlma,
    ABS(STOKLAR.sto_birim2_katsayi) AS koli,
    ABS(STOKLAR.sto_birim3_katsayi) AS paket,
    (SELECT TOP 1 sfiyat_fiyati FROM STOK_SATIS_FIYAT_LISTELERI
       WITH (NOLOCK, INDEX = NDX_STOK_SATIS_FIYAT_LISTELERI_02)
     WHERE sfiyat_stokkod = STOKLAR.sto_kod AND sfiyat_listesirano = 1 AND sfiyat_deposirano = 0
     ORDER BY sfiyat_odemeplan) AS fiyat,
    nn.stok, nn.sonHareket,
    DATEDIFF(day, nn.sonHareket, GETDATE()) AS hareketsizGun
  FROM STOKLAR WITH (NOLOCK)
    LEFT JOIN STOK_ANA_GRUPLARI ON STOKLAR.sto_anagrup_kod = STOK_ANA_GRUPLARI.san_kod
    LEFT JOIN CARI_PERSONEL_TANIMLARI WITH (NOLOCK) ON cari_per_kod = STOKLAR.sto_urun_sorkod
    OUTER APPLY (
      SELECT ISNULL(ROUND(SUM(CASE
               WHEN sth_tip = 0 OR (sth_tip = 2 AND sth_giris_depo_no = {DEPO}) THEN sth_miktar
               WHEN sth_tip = 1 OR (sth_tip = 2 AND sth_cikis_depo_no = {DEPO}) THEN -1 * sth_miktar
               ELSE 0 END), 2), 0) AS stok,
             MAX(sth_tarih) AS sonHareket
      FROM STOK_HAREKETLERI WITH (NOLOCK, INDEX = NDX_STOK_HAREKETLERI_14)
      WHERE sth_miktar <> 0 AND sth_stok_kod = STOKLAR.sto_kod AND sth_tarih <= GETDATE()
        AND ((sth_tip = 0 AND sth_giris_depo_no = {DEPO})
          OR (sth_tip = 1 AND sth_cikis_depo_no = {DEPO})
          OR (sth_tip = 2 AND sth_giris_depo_no = {DEPO} AND sth_giris_depo_no <> sth_cikis_depo_no)
          OR (sth_tip = 2 AND sth_cikis_depo_no = {DEPO} AND sth_giris_depo_no <> sth_cikis_depo_no))
        AND sth_cins NOT IN (9,15)
    ) nn
) t
WHERE stok < -0.01 OR stok > 0.01
ORDER BY ABS(stok) * ISNULL(fiyat, 0) DESC";

    /* ==================================================================== */
    /* 3 · Stok kartı ekstresi                                              */
    /* ==================================================================== */

    public const string StokKarti = @"
SELECT TOP 300
  h.sth_tarih AS tarih,
  dbo.fn_StokHarTip(h.sth_giris_cikis) AS tip,
  dbo.fn_StokHarCins(h.sth_cins) AS evrakTuru,
  dbo.fn_DepoIsmi(h.sth_karsi_depono) AS karsiDepo,
  dbo.fn_CarininIsminiBul('', h.sth_cari_kodu) AS firma,
  (CASE WHEN h.sth_giris_cikis = 0 AND h.sth_normal_iade = 0 THEN h.sth_miktar
        WHEN h.sth_giris_cikis = 0 AND h.sth_normal_iade = 1 AND h.sth_cins = 1 THEN h.sth_miktar
        WHEN h.sth_giris_cikis = 0 AND h.sth_normal_iade = 1 AND h.sth_cins <> 1 THEN h.sth_miktar * -1
        ELSE h.sth_miktar * -1 END) AS miktar,
  SUM(CASE WHEN h.sth_giris_cikis = 0 AND h.sth_normal_iade = 0 THEN h.sth_miktar
           WHEN h.sth_giris_cikis = 0 AND h.sth_normal_iade = 1 AND h.sth_cins = 1 THEN h.sth_miktar
           WHEN h.sth_giris_cikis = 0 AND h.sth_normal_iade = 1 AND h.sth_cins <> 1 THEN h.sth_miktar * -1
           ELSE h.sth_miktar * -1 END)
    OVER (ORDER BY h.sth_tarih, h.sth_RECno) AS kalan,
  (CASE WHEN h.sth_miktar <> 0 THEN
     (h.sth_tutar + h.sth_masraf1 + h.sth_masraf2 + h.sth_masraf3 + h.sth_masraf4 + h.sth_vergi
      - h.sth_iskonto1 + h.sth_iskonto2 + h.sth_iskonto3 + h.sth_iskonto4 + h.sth_iskonto5
      + h.sth_iskonto6) / h.sth_miktar ELSE 0 END) AS birimMaliyet,
  h.sth_create_date AS olusturma, h.sth_lastup_user AS sonKullanici
FROM (
  SELECT 0 AS sth_giris_cikis,
    CASE WHEN sth_tip = 0 THEN sth_giris_depo_no WHEN sth_tip = 1 THEN sth_cikis_depo_no
         WHEN sth_tip = 2 THEN sth_giris_depo_no END AS sth_depono,
    CASE WHEN sth_tip = 2 THEN sth_cikis_depo_no ELSE 0 END AS sth_karsi_depono, *
  FROM STOK_HAREKETLERI WITH (NOLOCK)
  WHERE sth_tip <> 1 AND sth_stok_kod = @stok
  UNION ALL
  SELECT 1 AS sth_giris_cikis, sth_cikis_depo_no AS sth_depono, sth_giris_depo_no AS sth_karsi_depono, *
  FROM STOK_HAREKETLERI WITH (NOLOCK)
  WHERE sth_tip <> 0 AND sth_stok_kod = @stok
) h
WHERE h.sth_depono = {DEPO} AND h.sth_cins NOT IN (9,15)
ORDER BY h.sth_tarih DESC, h.sth_RECno DESC";

    /* ==================================================================== */
    /* 4 · Fire ve zayiat                                                   */
    /* ==================================================================== */

    public const string Fire = @"
SELECT [RECETE URUN] AS receteli, [STOK KOD] AS stokKod, barkod, [STOK İSİM] AS stokIsim,
       anaGrup, [SATIŞ FİYATI] AS fiyat,
       ROUND(MAX([TOPLAMMİKTAR]), 2) AS miktar, ROUND(SUM([TOPLAMTUTAR]), 2) AS tutar,
       SUM([1]) AS ay1, SUM([2]) AS ay2, SUM([3]) AS ay3, SUM([4]) AS ay4,
       SUM([5]) AS ay5, SUM([6]) AS ay6, SUM([7]) AS ay7, SUM([8]) AS ay8,
       SUM([9]) AS ay9, SUM([10]) AS ay10, SUM([11]) AS ay11, SUM([12]) AS ay12
FROM (
  SELECT
    STOKLAR.sto_kod AS [STOK KOD], STOKLAR.sto_isim AS [STOK İSİM],
    STOK_ANA_GRUPLARI.san_isim AS anaGrup,
    ISNULL((SELECT TOP 1 bar_kodu FROM BARKOD_TANIMLARI WITH (NOLOCK, INDEX = NDX_BARKOD_TANIMLARI_03)
            WHERE bar_stokkodu = STOKLAR.sto_kod AND bar_master = 1), 'MSTR.BRKD.TNMSZ') AS barkod,
    [TARİH], ISNULL(fiyat.sfiyat_fiyati, 0) AS [SATIŞ FİYATI], [MİKTAR],
    SUM([MİKTAR]) OVER (PARTITION BY STOKLAR.sto_kod) AS [TOPLAMMİKTAR],
    [MİKTAR] * ISNULL(fiyat.sfiyat_fiyati, 0) AS [TOPLAMTUTAR],
    (SELECT TOP 1 1 FROM STOK_SARF_RECETELERI WITH (NOLOCK)
     WHERE sr_recetecinsi = 1 AND (sr_anakod = STOKLAR.sto_kod OR sr_tuketim_kod = STOKLAR.sto_kod))
      AS [RECETE URUN]
  FROM STOKLAR WITH (NOLOCK)
    LEFT JOIN STOK_ANA_GRUPLARI ON STOKLAR.sto_anagrup_kod = STOK_ANA_GRUPLARI.san_kod
    INNER JOIN (
      SELECT sth_stok_kod,
        SUM(CASE WHEN sth_tip = 0 THEN sth_miktar WHEN sth_tip = 1 THEN sth_miktar * -1 END) AS [MİKTAR],
        MONTH(sth_tarih) AS [TARİH]
      FROM (
        SELECT CASE WHEN sth_tip = 0 THEN sth_giris_depo_no WHEN sth_tip = 1 THEN sth_cikis_depo_no
                    WHEN sth_tip = 2 THEN sth_giris_depo_no END AS sth_depono, *
        FROM STOK_HAREKETLERI WITH (NOLOCK) WHERE sth_tip <> 1
        UNION ALL
        SELECT sth_cikis_depo_no AS sth_depono, *
        FROM STOK_HAREKETLERI WITH (NOLOCK) WHERE sth_tip <> 0
      ) h
      WHERE h.sth_cins IN (4,5,10) AND h.sth_depono = {DEPO} AND YEAR(h.sth_tarih) = {YIL}
      GROUP BY sth_stok_kod, MONTH(sth_tarih)
    ) zz ON STOKLAR.sto_kod = zz.sth_stok_kod
    OUTER APPLY (
      SELECT TOP 1 ROUND(sfiyat_fiyati, 2) AS sfiyat_fiyati
      FROM STOK_SATIS_FIYAT_LISTELERI WITH (NOLOCK, INDEX = NDX_STOK_SATIS_FIYAT_LISTELERI_02)
      WHERE sfiyat_deposirano = 0 AND sfiyat_stokkod = STOKLAR.sto_kod
        AND sfiyat_listesirano <= 2 AND sfiyat_fiyati > 0
      ORDER BY sfiyat_listesirano DESC
    ) fiyat
  WHERE " + Haric + @"
) kaynak
PIVOT (SUM([MİKTAR]) FOR [TARİH] IN ([1],[2],[3],[4],[5],[6],[7],[8],[9],[10],[11],[12])) p
GROUP BY [RECETE URUN], [STOK KOD], [STOK İSİM], anaGrup, [SATIŞ FİYATI], barkod
ORDER BY SUM([TOPLAMTUTAR]) DESC";

    /* ==================================================================== */
    /* 5 · Sipariş takibi ve mal girişleri                                  */
    /* ==================================================================== */

    public const string SiparisTakibi = @"
SELECT TOP 500
  s.ssip_RECno AS kayitNo,
  s.ssip_evrakno_seri + CAST(s.ssip_evrakno_sira AS NVARCHAR(10)) AS evrak,
  s.ssip_tarih AS tarih,
  s.ssip_stok_kod AS stokKod,
  STOKLAR.sto_isim AS stokIsim,
  s.ssip_miktar AS istenen,
  ISNULL(g.gelen, 0) AS gelen,
  s.ssip_miktar - ISNULL(g.gelen, 0) AS eksik,
  g.evrakDetay AS gelenEvrak,
  g.nakliye,
  dbo.fn_hmz_depodaki_miktar(s.ssip_stok_kod, 103, s.ssip_tarih) AS merkezStok,
  CASE WHEN s.ssip_cikdepo = 103 THEN 'MERKEZ DEPO'
       ELSE dbo.fn_DepoIsmi(s.ssip_cikdepo) END AS karsiDepo
FROM DEPOLAR_ARASI_SIPARISLER s WITH (NOLOCK)
  INNER JOIN STOKLAR WITH (NOLOCK) ON s.ssip_stok_kod = STOKLAR.sto_kod
  OUTER APPLY (
    SELECT TOP 1
      sth.sth_evrakno_seri + ' - ' + CAST(sth.sth_evrakno_sira AS NVARCHAR(10))
        + ' - ' + CONVERT(NVARCHAR(10), sth.sth_tarih, 103) AS evrakDetay,
      sth.sth_miktar AS gelen,
      CASE WHEN sth.sth_nakliyedurumu = 0 THEN 'yolda' ELSE 'teslim' END AS nakliye
    FROM STOK_HAREKETLERI_EK ek WITH (NOLOCK)
      INNER JOIN STOK_HAREKETLERI sth WITH (NOLOCK) ON ek.sthek_related_RECno = sth.sth_RECno
    WHERE {SIPARIS_BAG} = s.ssip_RECno
  ) g
WHERE s.ssip_girdepo = {DEPO} AND s.ssip_tarih BETWEEN @bas AND @bit
ORDER BY s.ssip_tarih DESC";

    public const string MalGirisleri = @"
SELECT TOP 500
  h.sth_tarih AS tarih, h.sth_stok_kod AS stokKod, STOKLAR.sto_isim AS stokIsim,
  h.sth_miktar AS miktar,
  dbo.fn_StokHarCins(h.sth_cins) AS evrakTuru,
  dbo.fn_DepoIsmi(h.sth_karsi_depono) AS karsiDepo,
  dbo.fn_CarininIsminiBul('', h.sth_cari_kodu) AS firma
FROM (
  SELECT CASE WHEN sth_tip = 0 THEN sth_giris_depo_no ELSE sth_giris_depo_no END AS sth_depono,
         CASE WHEN sth_tip = 2 THEN sth_cikis_depo_no ELSE 0 END AS sth_karsi_depono, *
  FROM STOK_HAREKETLERI WITH (NOLOCK)
  WHERE sth_tip IN (0,2) AND sth_tarih >= DATEADD(day, -@gun, GETDATE())
) h
  INNER JOIN STOKLAR WITH (NOLOCK) ON h.sth_stok_kod = STOKLAR.sto_kod
WHERE h.sth_depono = {DEPO} AND h.sth_cins NOT IN (9,15)
ORDER BY h.sth_tarih DESC";

    /// <summary>
    /// Bir ürünün fire hareketleri: hangi gün, hangi evrakla, ne kadar.
    /// Fire listesindeki toplamın nereden geldiğini görmek için.
    /// </summary>
    public const string FireDetay = @"
SELECT TOP 300
  h.sth_tarih AS tarih,
  dbo.fn_StokHarCins(h.sth_cins) AS evrakTuru,
  h.sth_evrakno_seri + ' - ' + CAST(h.sth_evrakno_sira AS NVARCHAR(10)) AS evrak,
  (CASE WHEN h.sth_tip = 0 THEN h.sth_miktar ELSE h.sth_miktar * -1 END) AS miktar,
  h.sth_aciklama AS aciklama,
  h.sth_create_date AS olusturma,
  h.sth_lastup_user AS kullanici
FROM (
  SELECT CASE WHEN sth_tip = 0 THEN sth_giris_depo_no WHEN sth_tip = 1 THEN sth_cikis_depo_no
              WHEN sth_tip = 2 THEN sth_giris_depo_no END AS sth_depono, *
  FROM STOK_HAREKETLERI WITH (NOLOCK) WHERE sth_tip <> 1 AND sth_stok_kod = @stok
  UNION ALL
  SELECT sth_cikis_depo_no AS sth_depono, *
  FROM STOK_HAREKETLERI WITH (NOLOCK) WHERE sth_tip <> 0 AND sth_stok_kod = @stok
) h
WHERE h.sth_depono = {DEPO} AND h.sth_cins IN (4,5,10) AND YEAR(h.sth_tarih) = {YIL}
ORDER BY h.sth_tarih DESC";

    /// <summary>Palet durumu: OZMerkez'de, ayrı bağlantıdan okunuyor.</summary>
    public const string Paletler = @"
SELECT ref_detay_id AS kayitNo, stok_kodu AS stokKod, palet_barkodu AS palet,
       MAX(tarih) AS tarih,
       CASE WHEN durum = 1 THEN 'Kabul edildi'
            WHEN durum = 0 THEN 'Yolda'
            WHEN durum = 2 THEN 'Teslim alındı' END AS durum
FROM dbo.SEMPA_PALET WITH (NOLOCK)
WHERE depo_no = {DEPO} AND ref_detay_id IN @kayitlar
GROUP BY ref_detay_id, stok_kodu, durum, palet_barkodu";
}

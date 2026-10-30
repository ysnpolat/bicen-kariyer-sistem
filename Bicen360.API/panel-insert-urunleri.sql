/* ==========================================================================
   PANEL_INSERT_URUNLERI — panelin insert kampanya ürünleri (26.10.2026)
   --------------------------------------------------------------------------
   OZ Merkez veritabanında (192.168.0.202) yönetici yetkisiyle çalıştırılır.
   Yapı Biçen Panel belgesindeki ("Biçen360 mobil: Etiket Listesi › İnsert
   Ürünleri") tanımla birebir aynıdır.

   Tabloyu Biçen Panel doldurur (15 dakikada bir silip yeniden yazar);
   Biçen360 yalnız okur. Tablo kurulduktan sonra panelin yazma işi
   çalışmadıkça mobildeki Kampanyalar ekranı boş görünür.
   ========================================================================== */

USE OzMerkez;
GO

IF OBJECT_ID('dbo.PANEL_INSERT_URUNLERI') IS NULL
CREATE TABLE dbo.PANEL_INSERT_URUNLERI (
    depo           INT            NOT NULL,   -- Mikro depo no (başında sıfır yok)
    kampanya_no    INT            NOT NULL,   -- paneldeki kampanya no
    kampanya_adi   NVARCHAR(150)  NOT NULL,
    kampanya_turu  NVARCHAR(40)   NOT NULL,   -- Normal İnsert, Haftanın Ürünü, Tamamla Kazan …
    baslangic      DATETIME       NOT NULL,   -- 00:00 Türkiye saati
    bitis          DATETIME       NOT NULL,   -- 23:59:59 Türkiye saati
    durum          NVARCHAR(20)   NOT NULL,   -- Planlı | Sürüyor | Onay bekliyor
    kare           INT            NOT NULL DEFAULT(1),
    grup_adi       NVARCHAR(150)  NULL,
    stok_kod       NVARCHAR(25)   NOT NULL,
    urun_adi       NVARCHAR(127)  NOT NULL,
    barkod         NVARCHAR(50)   NULL,
    raf_fiyati     DECIMAL(18,2)  NULL,       -- 1. fiyat, etikette çizili
    insert_fiyati  DECIMAL(18,2)  NOT NULL,   -- 2. fiyat (Bicard), etikette basılı
    indirim_yuzde  INT            NULL,
    guncelleme     DATETIME       NOT NULL DEFAULT(GETDATE())
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_PANEL_INSERT_URUNLERI'
                 AND object_id = OBJECT_ID('dbo.PANEL_INSERT_URUNLERI'))
CREATE INDEX IX_PANEL_INSERT_URUNLERI ON dbo.PANEL_INSERT_URUNLERI (depo, kampanya_no);
GO

/* İzinler: panel yazar, Biçen360 okur. Kullanıcı yoksa ilgili satırı
   atlayın; yeni SQL kullanıcısı açılmaz. */
IF USER_ID('panel_terminal') IS NOT NULL
    GRANT SELECT, INSERT, UPDATE, DELETE ON dbo.PANEL_INSERT_URUNLERI TO panel_terminal;
IF USER_ID('rapor') IS NOT NULL
    GRANT SELECT ON dbo.PANEL_INSERT_URUNLERI TO rapor;
GO

/* Deneme satırı (isteğe bağlı): mobilde ekranın çalıştığını görmek için.
   Depo numarasını kendi şubenizinkiyle değiştirin; denemeden sonra silin:
   DELETE FROM dbo.PANEL_INSERT_URUNLERI WHERE kampanya_no = 999999;

INSERT INTO dbo.PANEL_INSERT_URUNLERI
    (depo, kampanya_no, kampanya_adi, kampanya_turu, baslangic, bitis, durum,
     kare, grup_adi, stok_kod, urun_adi, barkod, raf_fiyati, insert_fiyati, indirim_yuzde)
VALUES
    (12, 999999, N'DENEME KAMPANYASI', N'Haftanın Ürünü', '2026-10-26', '2026-11-01 23:59:59', N'Sürüyor',
     1, NULL, N'120.05.0031', N'ACE ÇAMAŞIR SUYU 1 LT', N'8690570543212', 39.95, 29.95, 25);
*/

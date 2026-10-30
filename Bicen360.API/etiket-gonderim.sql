/* ==========================================================================
   ETIKET_GONDERIM — mobilden gönderilen etiket listeleri
   --------------------------------------------------------------------------
   OZ Merkez veritabanında çalıştırılır.

   Portal API açılışta bu tabloyu kendisi kurmayı deniyor; bağlandığı SQL
   kullanıcısının CREATE TABLE yetkisi yoksa bu betik elle çalıştırılmalı.

   Şubedeki etiket programı ("Mobilden" düğmesi) kendi depo numarasıyla
   süzerek okuyor; araya servis konmuyor.
   ========================================================================== */

IF OBJECT_ID('ETIKET_GONDERIM') IS NULL
CREATE TABLE ETIKET_GONDERIM (
    id             INT IDENTITY(1,1) PRIMARY KEY,

    /* Şubenin ekranda göreceği kod: RF-260918-0137 */
    rf_kodu        NVARCHAR(24)   NOT NULL,

    /* Şubeyi bulan alan: etiket programı kendini depo numarasıyla tanıyor,
       şube adıyla değil. Portaldaki Şube ve Depo ekranındaki numara. */
    depo_no        INT            NOT NULL,
    sube_adi       NVARCHAR(120)  NULL,

    gonderen_kodu  NVARCHAR(30)   NULL,
    gonderen_adi   NVARCHAR(200)  NULL,
    aciklama       NVARCHAR(400)  NULL,
    adet           INT            NOT NULL DEFAULT(0),

    /* Barkodlar alt alta: terminal dosyasıyla aynı biçim, masaüstü taraf
       aynı okuma döngüsünü kullanıyor. */
    barkodlar      NVARCHAR(MAX)  NOT NULL,

    /* Şube listeyi etiket programına aldı mı */
    alindi         BIT            NOT NULL DEFAULT(0),
    alan           NVARCHAR(100)  NULL,
    alinma         DATETIME2      NULL,

    olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_ETIKET_GONDERIM'
                 AND object_id = OBJECT_ID('ETIKET_GONDERIM'))
CREATE INDEX IX_ETIKET_GONDERIM ON ETIKET_GONDERIM(depo_no, olusturma DESC);
GO

/* 26.10.2026: İnsert ürünleri. tur = 'insert' ise ayrinti sütununda her
   ürünün insert (basılı) fiyatı, çizili raf fiyatı ve geçerlilik tarihleri
   JSON olarak durur; barkodlar sütunu eskisi gibi doludur.
   Ayrıntı: INSERT-ETIKET.md */
IF COL_LENGTH('ETIKET_GONDERIM', 'tur') IS NULL
    ALTER TABLE ETIKET_GONDERIM ADD tur NVARCHAR(20) NULL;
GO
IF COL_LENGTH('ETIKET_GONDERIM', 'ayrinti') IS NULL
    ALTER TABLE ETIKET_GONDERIM ADD ayrinti NVARCHAR(MAX) NULL;
GO

/* ==========================================================================
   ETIKET_KAYIT — basılan her raf etiketinin kimliği ve basıldığı andaki
   bilgileri (26.10.2026)
   --------------------------------------------------------------------------
   OZ Merkez veritabanında çalıştırılır.

   BiŞube etiket basarken her ürün satırı için buraya bir kayıt ekler ve
   dönen etiket_id'yi karekoda "ID: …" satırı olarak yazar. Mobil Fiyat
   Kontrol karekodu okuyunca bu kaydı bulur, ürünün güncel bilgisiyle
   karşılaştırır ve değişen alanı söyler.

   Portal API ilk kullanımda tabloyu kendisi kurmayı dener; SQL
   kullanıcısının CREATE TABLE yetkisi yoksa bu betik elle çalıştırılır.
   Ayrıntı: ETIKET-KAREKOD.md
   ========================================================================== */

IF OBJECT_ID('ETIKET_KAYIT') IS NULL
CREATE TABLE ETIKET_KAYIT (
    etiket_id            BIGINT IDENTITY(100001,1) PRIMARY KEY,

    /* Şube: etiket programı kendini depo numarasıyla tanıyor */
    depo_no              INT            NOT NULL,
    sube_adi             NVARCHAR(120)  NULL,

    /* Ürün */
    stok_kodu            NVARCHAR(30)   NOT NULL,
    barkod               NVARCHAR(50)   NULL,
    urun_adi             NVARCHAR(200)  NULL,
    birim                NVARCHAR(20)   NULL,

    /* Etikete basılan fiyatlar (KDV dahil, TL).
       fiyat: normal / raf fiyatı (ör. 39,95)
       indirimli_fiyat: etikette indirimli fiyat varsa (BiCard ya da
       kampanya, ör. 29,95); yoksa NULL */
    fiyat                DECIMAL(18,2)  NULL,
    indirimli_fiyat      DECIMAL(18,2)  NULL,
    indirim_turu         NVARCHAR(20)   NULL,   -- bicard | kampanya | NULL
    birim_fiyat          NVARCHAR(40)   NULL,   -- etiketteki "1 KG: 39,95 TL" metni

    /* Diğer etiket bilgileri */
    mensei               NVARCHAR(60)   NULL,   -- TÜRKİYE
    reyon                NVARCHAR(100)  NULL,
    yer_kodu             NVARCHAR(30)   NULL,
    skt                  DATE           NULL,   -- etikette SKT basılıyorsa
    fiyat_degisim_tarihi DATE           NULL,   -- etiketteki FDT
    kampanya_bitis       DATE           NULL,

    /* Basım */
    sablon               NVARCHAR(80)   NULL,   -- A4minietiket32LICIZGILI …
    adet                 INT            NOT NULL DEFAULT(1),
    basan_kullanici      NVARCHAR(100)  NULL,
    bilgisayar           NVARCHAR(60)   NULL,
    kaynak               NVARCHAR(30)   NULL,   -- elle | mobilden | fiyat-degisikligi | uyari
    rf_kodu              NVARCHAR(24)   NULL,   -- mobilden gelen listeden basıldıysa
    basim                DATETIME2      NOT NULL DEFAULT SYSDATETIME(),

    /* Etiket çöpe gittiyse / hatalı basıldıysa */
    iptal                BIT            NOT NULL DEFAULT(0),

    /* İleride eklenecek alanlar için serbest JSON (gramaj, üretici …) */
    ek_json              NVARCHAR(MAX)  NULL
);
GO

/* Aynı ürünün o şubedeki son etiketi: "yenisi basılmış mı" sorusu */
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_ETIKET_KAYIT_URUN'
                 AND object_id = OBJECT_ID('ETIKET_KAYIT'))
CREATE INDEX IX_ETIKET_KAYIT_URUN ON ETIKET_KAYIT(depo_no, stok_kodu, etiket_id DESC);
GO

/* Okutmalar: hangi etiket ne zaman okundu, eskimiş miydi (rapor için) */
IF OBJECT_ID('ETIKET_OKUTMA') IS NULL
CREATE TABLE ETIKET_OKUTMA (
    id             BIGINT IDENTITY(1,1) PRIMARY KEY,
    etiket_id      BIGINT         NOT NULL,
    depo_no        INT            NULL,
    personel_kodu  NVARCHAR(30)   NULL,
    durum          NVARCHAR(20)   NOT NULL,   -- guncel | degisti | yenisi-var
    degisenler     NVARCHAR(400)  NULL,       -- fiyat,indirimli_fiyat,mensei …
    okutma         DATETIME2      NOT NULL DEFAULT SYSDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_ETIKET_OKUTMA'
                 AND object_id = OBJECT_ID('ETIKET_OKUTMA'))
CREATE INDEX IX_ETIKET_OKUTMA ON ETIKET_OKUTMA(depo_no, okutma DESC);
GO

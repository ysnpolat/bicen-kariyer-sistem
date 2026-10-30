/* ==========================================================================
   Biçen360 — tablo kurulumu

   Tablolar biPortal içinde, B360_ önekiyle durur:

       B360_YETKI               Panel ve mobil yetkileri
       B360_DEPARTMAN           Arıza kaydının gideceği departmanlar
       B360_DEPARTMAN_TEMSILCI  Departman temsilcileri
       B360_ENVANTER            Mağaza cihazları
       B360_ARIZA_TUR           Arıza kategorileri ve SLA süreleri
       B360_ARIZA_ADIM          Soru akışı adımları (istenildiği kadar derin)
       B360_ARIZA_YANIT         Kayda verilen akış yanıtları
       B360_ARIZA               Arıza kayıtları
       B360_ARIZA_HAREKET       Durum değişikliği geçmişi
       B360_ARIZA_YORUM         Yorumlar ve iç notlar
       B360_ARIZA_GORSEL        Kayda eklenen fotoğraflar

   Kullanıcılar ayrı bir tabloda değil: KRY_KULLANICILAR Kariyer sistemiyle
   ortak. Ayrışan tek şey yetki.

   API açılışta bu tabloları kendisi oluşturur ve eksik sütunları ekler.
   "CREATE TABLE permission denied" benzeri bir hata alırsanız bu betiği
   çalıştırınız.

   Nasıl çalıştırılır:
     1. SSMS ile bağlanınız:
          Server name : mail.bicen.com.tr,11904
          Login       : sysadmin yetkili bir hesap
     2. Bu dosyayı açıp F5 ile çalıştırınız.
     3. API'yi yeniden başlatınız.

   NOT: Bu betik koddaki tanımlarla aynı tutuluyor. Sütun eklemeleri
   (ALTER TABLE) burada yok; onları API açılışta kendisi yapıyor. Daha
   önce kurulmuş bir veritabanında yalnızca API'yi yeniden başlatmak
   yeterli.
   ========================================================================== */

USE [biPortal];
GO

IF OBJECT_ID('B360_YETKI') IS NULL
CREATE TABLE B360_YETKI (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    alan         VARCHAR(10)   NOT NULL,   /* panel | mobil            */
    kapsam       VARCHAR(12)   NOT NULL,   /* kullanici | rol | pozisyon */
    anahtar      NVARCHAR(100) NOT NULL,   /* kullanıcı adı, rol ya da pozisyon */
    kod          VARCHAR(40)   NOT NULL,   /* sayfa ya da modül kodu   */
    izin         BIT           NOT NULL DEFAULT 1,
    guncelleme   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    guncelleyen  NVARCHAR(100) NULL,
    CONSTRAINT UQ_B360_YETKI UNIQUE (alan, kapsam, anahtar, kod)
);
GO

IF OBJECT_ID('B360_DEPARTMAN') IS NULL
CREATE TABLE B360_DEPARTMAN (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ad         NVARCHAR(80)  NOT NULL UNIQUE,
    aciklama   NVARCHAR(200) NULL,
    aktif      BIT           NOT NULL DEFAULT 1,
    sira       INT           NOT NULL DEFAULT 0,
    olusturma  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO

IF OBJECT_ID('B360_DEPARTMAN_TEMSILCI') IS NULL
CREATE TABLE B360_DEPARTMAN_TEMSILCI (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    departman_id  INT           NOT NULL,
    personel_kodu NVARCHAR(30)  NOT NULL,
    olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_B360_TEMSILCI UNIQUE (departman_id, personel_kodu),
    CONSTRAINT FK_B360_TEMSILCI_DEP FOREIGN KEY (departman_id)
        REFERENCES B360_DEPARTMAN(id) ON DELETE CASCADE
);
GO

IF OBJECT_ID('B360_ENVANTER') IS NULL
CREATE TABLE B360_ENVANTER (
    id                INT IDENTITY(1,1) PRIMARY KEY,
    sube_kodu         NVARCHAR(40)  NOT NULL,
    tur               NVARCHAR(60)  NULL,   /* kasa, terminal, yazıcı, tartı … */
    marka             NVARCHAR(60)  NULL,
    model             NVARCHAR(80)  NULL,
    seri_no           NVARCHAR(80)  NULL,
    sicil_no          NVARCHAR(80)  NULL,   /* kurum demirbaş numarası        */
    sahibi            NVARCHAR(200) NULL,   /* zimmetli personel ya da birim  */
    konum             NVARCHAR(200) NULL,   /* mağaza içinde nerede           */
    departman_id      INT           NULL,   /* bakımından sorumlu departman   */
    ust_cihaz_id      INT           NULL,   /* bağlı olduğu cihaz             */
    tedarikci         NVARCHAR(200) NULL,
    alis_tarihi       DATE          NULL,

    garanti_var       BIT           NOT NULL DEFAULT 0,
    garanti_baslangic DATE          NULL,
    garanti_ay        INT           NULL,
    garanti_bitis     DATE          NULL,
    garanti_saglayici NVARCHAR(200) NULL,
    garanti_notu      NVARCHAR(MAX) NULL,

    son_bakim         DATE          NULL,
    sonraki_bakim     DATE          NULL,
    bakim_araligi     INT           NULL,   /* gün                            */
    bakim_firmasi     NVARCHAR(200) NULL,
    bakim_notu        NVARCHAR(MAX) NULL,

    etiketler         NVARCHAR(400) NULL,   /* virgülle ayrılmış              */
    notlar            NVARCHAR(MAX) NULL,
    durum             NVARCHAR(20)  NOT NULL DEFAULT N'aktif',
    olusturma         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ENVANTER_SUBE')
CREATE INDEX IX_B360_ENVANTER_SUBE ON B360_ENVANTER (sube_kodu, durum);
GO

IF OBJECT_ID('B360_ARIZA_TUR') IS NULL
CREATE TABLE B360_ARIZA_TUR (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    ad            NVARCHAR(80)  NOT NULL UNIQUE,
    departman_id  INT           NULL,   /* boşsa tüm departmanlar kullanır */
    aciklama      NVARCHAR(400) NULL,
    sla_saat      INT           NOT NULL DEFAULT 72,
    cihaz_turleri NVARCHAR(400) NULL,   /* virgülle ayrılmış; boşsa tümü   */
    soru          NVARCHAR(200) NULL,   /* akışın ilk sorusu               */
    akis_zorunlu  BIT           NOT NULL DEFAULT 0,
    aktif         BIT           NOT NULL DEFAULT 1,
    sira          INT           NOT NULL DEFAULT 0
);
GO

/* --------------------------------------------------------------------------
   SORU AKIŞI
   --------------------------------------------------------------------------
   Adımlar tek ağaçta duruyor. "Donanım" ve "soru" için iki ayrı tablo
   denendi ve iki seviyeyle sınırlı kalıyordu; oysa teknik işlerde
   Dolap > Şarküteri > Kapak gibi istenildiği kadar derinleşen kırılımlar
   var.

   Bir düğüm hem seçenek hem de kendi alt seçeneklerinin sorusudur:
   'ad' seçenek metnini ('Fiş yazıcı'), 'soru' ise altındakiler sorulurken
   ekranda yazacak cümleyi tutar ('Fiş yazıcınızda nasıl bir sorun
   yaşıyorsunuz?').
   -------------------------------------------------------------------------- */

IF OBJECT_ID('B360_ARIZA_ADIM') IS NULL
CREATE TABLE B360_ARIZA_ADIM (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    tur_id           INT           NOT NULL,
    ust_id           INT           NULL,   /* NULL = ilk seviye            */
    ad               NVARCHAR(120) NOT NULL,
    soru             NVARCHAR(200) NULL,
    ipucu            NVARCHAR(300) NULL,
    coklu            BIT           NOT NULL DEFAULT 0,
    cihaz_turu       NVARCHAR(60)  NULL,
    aciklama_ister   BIT           NOT NULL DEFAULT 0,
    aciklama_zorunlu BIT           NOT NULL DEFAULT 0,
    gorsel_ister     BIT           NOT NULL DEFAULT 0,
    gorsel_zorunlu   BIT           NOT NULL DEFAULT 0,
    oncelik          NVARCHAR(15)  NULL,
    aktif            BIT           NOT NULL DEFAULT 1,
    sira             INT           NOT NULL DEFAULT 0,
    olusturma        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_ADIM_TUR FOREIGN KEY (tur_id)
        REFERENCES B360_ARIZA_TUR(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ADIM_TUR')
CREATE INDEX IX_B360_ADIM_TUR ON B360_ARIZA_ADIM (tur_id, ust_id, sira);
GO

/* Soru ve cevap metinleri yanıt satırına kopyalanıyor: bir seçeneğin adı
   değişince ya da pasife alınınca geçmiş kayıtların ne dediği
   değişmemeli. */
IF OBJECT_ID('B360_ARIZA_YANIT') IS NULL
CREATE TABLE B360_ARIZA_YANIT (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    ariza_id  INT            NOT NULL,
    adim_id   INT            NULL,
    seviye    INT            NOT NULL DEFAULT 0,
    soru      NVARCHAR(200)  NULL,
    cevap     NVARCHAR(200)  NULL,
    aciklama  NVARCHAR(MAX)  NULL,
    sira      INT            NOT NULL DEFAULT 0,
    CONSTRAINT FK_B360_YANIT_ARIZA FOREIGN KEY (ariza_id)
        REFERENCES B360_ARIZA(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_YANIT_ARIZA')
CREATE INDEX IX_B360_YANIT_ARIZA ON B360_ARIZA_YANIT (ariza_id, sira);
GO

IF OBJECT_ID('B360_ARIZA') IS NULL
CREATE TABLE B360_ARIZA (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    departman_id   INT            NOT NULL,
    tur_id         INT            NULL,
    envanter_id    INT            NULL,
    baslik         NVARCHAR(150)  NOT NULL,
    aciklama       NVARCHAR(MAX)  NULL,

    /* Açan kişi ve mağazası kayıt anında yazılır: personel sonradan
       başka mağazaya geçtiğinde eski kaydın mağazası değişmemeli. */
    acan_kodu      NVARCHAR(30)   NOT NULL,
    acan_adi       NVARCHAR(200)  NULL,
    sube_kodu      NVARCHAR(40)   NULL,

    /* Üzerine alan kişi; panelden atanır */
    atanan_kodu    NVARCHAR(30)   NULL,
    atanan_adi     NVARCHAR(200)  NULL,

    acan_telefon   NVARCHAR(20)   NULL,   /* kayıt anında yazılır */
    oncelik        NVARCHAR(15)   NOT NULL DEFAULT N'orta',
    durum          NVARCHAR(20)   NOT NULL DEFAULT N'acik',

    /* Soru akışında en son seçilen adım ve okunabilir özeti:
       'Yazarkasa › Fiş yazıcı › Silik çıkarıyor'. Yanıt tablosundan her
       listede yeniden kurmak yerine kayda yazılıyor; liste, arama ve
       rapor bu tek sütun üzerinden çalışıyor. */
    adim_id        INT            NULL,
    akis_ozet      NVARCHAR(400)  NULL,

    /* Kategorinin SLA süresinden hesaplanır; gecikme buna göre ölçülür */
    sla_bitis      DATETIME2      NULL,

    olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    cozum_zamani   DATETIME2      NULL,
    kapanma        DATETIME2      NULL,
    CONSTRAINT FK_B360_ARIZA_DEP FOREIGN KEY (departman_id)
        REFERENCES B360_DEPARTMAN(id)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ARIZA_LISTE')
CREATE INDEX IX_B360_ARIZA_LISTE ON B360_ARIZA (departman_id, durum, olusturma DESC);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ARIZA_ACAN')
CREATE INDEX IX_B360_ARIZA_ACAN ON B360_ARIZA (acan_kodu, olusturma DESC);
GO

IF OBJECT_ID('B360_ARIZA_HAREKET') IS NULL
CREATE TABLE B360_ARIZA_HAREKET (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ariza_id   INT            NOT NULL,
    durum      NVARCHAR(20)   NULL,
    aciklama   NVARCHAR(MAX)  NULL,
    yapan      NVARCHAR(200)  NULL,
    olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_HAREKET_ARIZA FOREIGN KEY (ariza_id)
        REFERENCES B360_ARIZA(id) ON DELETE CASCADE
);
GO

IF OBJECT_ID('B360_ARIZA_YORUM') IS NULL
CREATE TABLE B360_ARIZA_YORUM (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ariza_id   INT            NOT NULL,
    metin      NVARCHAR(MAX)  NOT NULL,
    /* İç not kaydı açana gösterilmez; ekip kendi arasında yazışabilsin */
    ic_not     BIT            NOT NULL DEFAULT 0,
    cozum      BIT            NOT NULL DEFAULT 0,
    yazan_kodu NVARCHAR(30)   NULL,
    yazan_adi  NVARCHAR(200)  NULL,
    olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_YORUM_ARIZA FOREIGN KEY (ariza_id)
        REFERENCES B360_ARIZA(id) ON DELETE CASCADE
);
GO

IF OBJECT_ID('B360_ARIZA_GORSEL') IS NULL
CREATE TABLE B360_ARIZA_GORSEL (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ariza_id   INT            NOT NULL,
    dosya      NVARCHAR(200)  NOT NULL,
    silindi    BIT            NOT NULL DEFAULT 0,
    olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_GORSEL_ARIZA FOREIGN KEY (ariza_id)
        REFERENCES B360_ARIZA(id) ON DELETE CASCADE
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_YETKI_ARAMA')
CREATE INDEX IX_B360_YETKI_ARAMA ON B360_YETKI (alan, kapsam, anahtar);
GO

/* ==========================================================================
   İLK YETKİ
   --------------------------------------------------------------------------
   Admin rolündeki kullanıcılar her sayfayı görür; yetki tablosu boşken
   sistemin kimsenin giremediği bir hâlde kalmaması için koda gömülü.

   Admin olmayan birine erişim vermek için (örnek):

       INSERT INTO B360_YETKI (alan, kapsam, anahtar, kod, izin)
       VALUES ('panel', 'kullanici', N'kullanici.adi', 'yonetim', 1);

   Gerisi panelin Yönetim sayfasındaki Yetkiler sekmesinden yapılır.
   ==========================================================================

   KÜNYE TABLOSU
   --------------------------------------------------------------------------
   KRY_KUNYE_ANALIZ yeniden adlandırılmadı ve buraya taşınmadı. Aynı
   veritabanında duruyor, Kariyer API onu kurmaya devam ediyor ve mevcut
   okutma kayıtları olduğu yerde kalıyor.
   ========================================================================== */

/* Denetim
SELECT * FROM B360_YETKI ORDER BY alan, kapsam, anahtar, kod;
SELECT * FROM B360_DEPARTMAN ORDER BY sira, ad;
SELECT * FROM B360_ARIZA_TUR ORDER BY sira, ad;
SELECT COUNT(*) FROM B360_ENVANTER;
SELECT COUNT(*) FROM B360_ARIZA;
*/

using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Bicen360.API.Servisler;

/// <summary>
/// Veritabanı bağlantıları ve açılışta tablo kurulumu.
///
/// <para>
/// Tablolar biPortal içinde, <c>B360_</c> önekiyle durur. Kariyer sistemi
/// <c>KRY_</c> önekini aynı sebeple kullanıyor: aynı veritabanındaki diğer
/// tablolarla çakışma olmasın. Ayrı bir veritabanı açılmadı çünkü kullanıcı
/// tablosu (<c>KRY_KULLANICILAR</c>) iki panel arasında ortak ve HKS de aynı
/// SQL örneğinde duruyor.
/// </para>
/// </summary>
public class VeritabaniServisi
{
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<VeritabaniServisi> _kayit;
    private readonly string _baglanti;

    public VeritabaniServisi(IConfiguration yapilandirma, ILogger<VeritabaniServisi> kayit)
    {
        _yapilandirma = yapilandirma;
        _kayit = kayit;
        _baglanti = yapilandirma.GetConnectionString("Varsayilan");
    }

    /// <summary>biPortal — panelin kendi verisi.</summary>
    public IDbConnection Baglanti() => new SqlConnection(_baglanti);

    /// <summary>Personel kartları (Mikro). Yalnızca okuma.</summary>
    public IDbConnection PersonelBaglantisi() => Ac("Personel");

    /// <summary>Mikro V15 — barkod ve stok kartı. Yalnızca okuma.</summary>
    public IDbConnection MikroBaglantisi() => Ac("Mikro");

    /// <summary>Yazarkasa veritabanı — raf fiyatı. Yalnızca okuma.</summary>
    public IDbConnection PosBaglantisi() => Ac("Pos");

    /// <summary>Hal Kayıt Sistemi — künye verisi. Yalnızca okuma.</summary>
    public IDbConnection HksBaglantisi() => Ac("Hks");

    /// <summary>
    /// OZ Merkez veritabanı.
    ///
    /// Mobilden gönderilen etiket listeleri buraya yazılıyor: şubedeki
    /// etiket programı zaten bu veritabanına bağlı ve listeyi doğrudan
    /// okuyor. Araya servis koymak, her şubeye ayrı kurulum ve anahtar
    /// dağıtmak demekti.
    /// </summary>
    public IDbConnection OzMerkezBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("OzMerkez");

        if (!string.IsNullOrWhiteSpace(adres))
            return new SqlConnection(adres);

        /* Tanımlı değilse varsayılan bağlantının veritabanı adı
           değiştirilerek kullanılıyor.

           OZMerkez, biPortal ile aynı SQL örneğinde duruyor ve aynı
           kullanıcıyla okunuyor. Ayrı satır zorunlu tutulduğunda yayın
           betiği sunucudaki appsettings dosyasını koruduğu için ayar
           hiç geçmiyor ve özellik sessizce çalışmıyordu. Kariyer
           tarafında Tahakkuk bağlantısı da aynı yolu izliyor. */
        var varsayilan = _yapilandirma.GetConnectionString("Varsayilan");

        if (string.IsNullOrWhiteSpace(varsayilan))
            throw new InvalidOperationException(
                "Veritabanı bağlantısı tanımlı değil (ConnectionStrings:Varsayilan).");

        var kurucu = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(varsayilan)
        {
            InitialCatalog = _yapilandirma["OzMerkez:Veritabani"] is { Length: > 0 } ad
                ? ad
                : "OZMerkez",
        };

        return new SqlConnection(kurucu.ConnectionString);
    }

    private IDbConnection Ac(string ad)
    {
        var adres = _yapilandirma.GetConnectionString(ad);

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                $"Veritabanı bağlantısı tanımlı değil (ConnectionStrings:{ad}).");

        return new SqlConnection(adres);
    }

    /* ==================================================================== */
    /* Kurulum                                                              */
    /* ==================================================================== */

    /// <summary>
    /// Eksik tabloları oluşturur.
    ///
    /// Açılışta bir kez çalışır. Yetki yoksa uygulama yine de ayağa kalkar;
    /// tabloları elle kurmak için kurulum.sql dosyası var.
    /// </summary>
    public void Kurulum()
    {
        try
        {
            using var db = Baglanti();

            db.Execute(@"
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
);");

            db.Execute(@"
-- Portal ayarları: karşılama sayfasının içeriği, logo, iletişim bilgileri.
--
-- Tek satır tek anahtar, değer JSON. Her ayar için sütun açmak, karşılama
-- sayfasına bir bölüm eklendiğinde veritabanı göçü gerektiriyordu.
IF OBJECT_ID('B360_AYAR') IS NULL
BEGIN
    CREATE TABLE B360_AYAR (
        anahtar    NVARCHAR(60)   NOT NULL PRIMARY KEY,
        deger      NVARCHAR(MAX)  NULL,
        guncelleme DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Karşılama sayfasında gösterilen görseller: logo, kapak, slayt.
-- Dosya diskte, künyesi burada.
IF OBJECT_ID('B360_GORSEL') IS NULL
BEGIN
    CREATE TABLE B360_GORSEL (
        id        INT IDENTITY(1,1) PRIMARY KEY,

        -- logo · kapak · slayt · ozellik
        tur       NVARCHAR(20)   NOT NULL,

        dosya     NVARCHAR(200)  NOT NULL,
        ozgun_ad  NVARCHAR(260)  NULL,
        baslik    NVARCHAR(200)  NULL,
        aciklama  NVARCHAR(500)  NULL,
        bag       NVARCHAR(400)  NULL,
        sira      INT            NOT NULL DEFAULT(0),
        aktif     BIT            NOT NULL DEFAULT(1),
        olusturma DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_B360_GORSEL_tur ON B360_GORSEL(tur, sira);
END

IF OBJECT_ID('B360_DEPARTMAN') IS NULL
CREATE TABLE B360_DEPARTMAN (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ad         NVARCHAR(80)  NOT NULL UNIQUE,
    aciklama   NVARCHAR(200) NULL,
    aktif      BIT           NOT NULL DEFAULT 1,
    sira       INT           NOT NULL DEFAULT 0,
    olusturma  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);");

            db.Execute(@"
IF OBJECT_ID('B360_DEPARTMAN_TEMSILCI') IS NULL
CREATE TABLE B360_DEPARTMAN_TEMSILCI (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    departman_id  INT           NOT NULL,
    personel_kodu NVARCHAR(30)  NOT NULL,
    olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT UQ_B360_TEMSILCI UNIQUE (departman_id, personel_kodu),
    CONSTRAINT FK_B360_TEMSILCI_DEP FOREIGN KEY (departman_id)
        REFERENCES B360_DEPARTMAN(id) ON DELETE CASCADE
);");

            /* ------------------------------------------------------------ */
            /* Envanter                                                       */
            /* ------------------------------------------------------------ */

            db.Execute(@"
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
);");

            /* Tablo daha önce dar biçimde oluşturulmuş olabilir; eksik
               sütunlar eklenir. Kariyer tarafındaki göç deseninin aynısı:
               veriyi taşımadan şemayı ilerletmek. */
            foreach (var (sutun, tanim) in new[]
                     {
                         ("sicil_no",          "NVARCHAR(80) NULL"),
                         ("sahibi",            "NVARCHAR(200) NULL"),
                         ("konum",             "NVARCHAR(200) NULL"),
                         ("departman_id",      "INT NULL"),
                         ("ust_cihaz_id",      "INT NULL"),
                         ("tedarikci",         "NVARCHAR(200) NULL"),
                         ("alis_tarihi",       "DATE NULL"),
                         ("garanti_var",       "BIT NOT NULL DEFAULT 0"),
                         ("garanti_baslangic", "DATE NULL"),
                         ("garanti_ay",        "INT NULL"),
                         ("garanti_bitis",     "DATE NULL"),
                         ("garanti_saglayici", "NVARCHAR(200) NULL"),
                         ("garanti_notu",      "NVARCHAR(MAX) NULL"),
                         ("son_bakim",         "DATE NULL"),
                         ("sonraki_bakim",     "DATE NULL"),
                         ("bakim_araligi",     "INT NULL"),
                         ("bakim_firmasi",     "NVARCHAR(200) NULL"),
                         ("bakim_notu",        "NVARCHAR(MAX) NULL"),
                         ("etiketler",         "NVARCHAR(400) NULL"),
                         ("notlar",            "NVARCHAR(MAX) NULL"),

                         /* Maliyet (08.10.2026): alış bedeli KDV dahil,
                            ekonomik ömür ay; defter değeri bunlardan. */
                         ("alis_bedeli",       "DECIMAL(18,2) NULL"),
                         ("ekonomik_omur",     "INT NULL"),
                         /* Kapak kutuyu doldursun mu (kırpılır) yoksa sığsın mı */
                         ("kapak_kirp",        "BIT NOT NULL DEFAULT 0"),
                     })
            {
                db.Execute($@"
IF COL_LENGTH('B360_ENVANTER', '{sutun}') IS NULL
    ALTER TABLE B360_ENVANTER ADD {sutun} {tanim};");
            }

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ENVANTER_SUBE')
CREATE INDEX IX_B360_ENVANTER_SUBE ON B360_ENVANTER (sube_kodu, durum);");

            /* Envanter geçmişi (08.10.2026).
               TAMIR: elle girilen tamir, bakım, parça, kalibrasyon kaydı;
                 kalemler JSON [{ad, tip: parca|iscilik|diger, adet, birim}].
                 Servis formları (B360_SERVIS_FORM.envanter_id) ayrıca
                 okunuyor, burada kopyası tutulmuyor.
               HAREKET: notlar ve otomatik değişiklik geçmişi.
               KONUM: şube / konum geçmişi (transferler).
               AKTIVITE: planlanan işler (servisi ara, bakım…).
               BELGE: fatura, garanti belgesi, servis formu taraması.
               Ayrı korunuyor: kurulamazsa sonraki tablolar etkilenmesin. */
            try
            {
            db.Execute(@"
IF OBJECT_ID('B360_ENVANTER_TAMIR') IS NULL
BEGIN
    CREATE TABLE B360_ENVANTER_TAMIR (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        envanter_id   INT            NOT NULL,
        tarih         DATE           NOT NULL,
        tur           NVARCHAR(20)   NOT NULL,
        ariza_id      INT            NULL,
        firma         NVARCHAR(200)  NULL,
        yapan         NVARCHAR(10)   NOT NULL DEFAULT N'dis',
        gun_disi      INT            NOT NULL DEFAULT 0,
        kalemler      NVARCHAR(MAX)  NULL,
        kdv           INT            NOT NULL DEFAULT 20,
        garantide     BIT            NOT NULL DEFAULT 0,
        fatura_no     NVARCHAR(80)   NULL,
        aciklama      NVARCHAR(2000) NULL,
        ara_toplam    DECIMAL(18,2)  NOT NULL DEFAULT 0,
        toplam        DECIMAL(18,2)  NOT NULL DEFAULT 0,
        olusturan     NVARCHAR(100)  NULL,
        olusturan_adi NVARCHAR(150)  NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_B360_ENVANTER_TAMIR ON B360_ENVANTER_TAMIR (envanter_id, tarih);
END

-- Tamir aşaması (09.10.2026): merkezde bekliyor · firmaya gönderildi ·
-- tamamlandı. Eski kayıtlar tamamlanmış sayılıyor.
IF COL_LENGTH('B360_ENVANTER_TAMIR', 'asama') IS NULL
    ALTER TABLE B360_ENVANTER_TAMIR ADD asama NVARCHAR(20) NOT NULL DEFAULT N'tamamlandi';
IF COL_LENGTH('B360_ENVANTER_TAMIR', 'asama_tarih') IS NULL
    ALTER TABLE B360_ENVANTER_TAMIR ADD asama_tarih DATETIME2 NULL;

IF OBJECT_ID('B360_ENVANTER_HAREKET') IS NULL
BEGIN
    CREATE TABLE B360_ENVANTER_HAREKET (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        envanter_id INT            NOT NULL,
        tur         NVARCHAR(10)   NOT NULL,
        metin       NVARCHAR(2000) NOT NULL,
        yapan       NVARCHAR(100)  NULL,
        yapan_adi   NVARCHAR(150)  NULL,
        tarih       DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_B360_ENVANTER_HAREKET ON B360_ENVANTER_HAREKET (envanter_id, id);
END

IF OBJECT_ID('B360_ENVANTER_KONUM') IS NULL
BEGIN
    CREATE TABLE B360_ENVANTER_KONUM (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        envanter_id INT            NOT NULL,
        sube_kodu   NVARCHAR(40)   NOT NULL,
        konum       NVARCHAR(200)  NULL,
        notu        NVARCHAR(300)  NULL,
        yapan_adi   NVARCHAR(150)  NULL,
        tarih       DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_B360_ENVANTER_KONUM ON B360_ENVANTER_KONUM (envanter_id, id);
END

IF OBJECT_ID('B360_ENVANTER_AKTIVITE') IS NULL
BEGIN
    CREATE TABLE B360_ENVANTER_AKTIVITE (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        envanter_id INT            NOT NULL,
        tur         NVARCHAR(10)   NOT NULL,
        tarih       DATE           NOT NULL,
        ozet        NVARCHAR(300)  NOT NULL,
        atanan      NVARCHAR(150)  NULL,
        bitti       BIT            NOT NULL DEFAULT 0,
        olusturan   NVARCHAR(150)  NULL,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_B360_ENVANTER_AKTIVITE ON B360_ENVANTER_AKTIVITE (envanter_id, bitti);
END

IF OBJECT_ID('B360_ENVANTER_BELGE') IS NULL
BEGIN
    CREATE TABLE B360_ENVANTER_BELGE (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        envanter_id INT            NOT NULL,
        tamir_id    INT            NULL,
        tur         NVARCHAR(40)   NOT NULL,
        dosya       NVARCHAR(200)  NOT NULL,
        ozgun_ad    NVARCHAR(260)  NULL,
        boyut       BIGINT         NOT NULL DEFAULT 0,
        yukleyen    NVARCHAR(150)  NULL,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_B360_ENVANTER_BELGE ON B360_ENVANTER_BELGE (envanter_id);
END");
            }
            catch (Exception hata)
            {
                _kayit?.LogWarning(hata, "Envanter geçmiş tabloları kurulamadı");
            }

            /* ------------------------------------------------------------ */
            /* Arıza kategorileri                                             */
            /* ------------------------------------------------------------ */

            db.Execute(@"
-- Cihaz görselleri. Bir cihazın nasıl göründüğünü ve nerede durduğunu
-- yazıyla anlatmak zor; arızada 'hangi cihaz' sorusu fotoğrafla bir
-- bakışta çözülüyor.
-- Teknik servis formu. Arıza çözüldüğünde ne yapıldığı yazıyla kalmıyordu:
-- 'çözüldü' yazan bir kayıt, aynı arıza tekrarladığında hiçbir şey
-- anlatmıyor ve maliyet hiçbir yerde toplanmıyordu.
-- Servis maliyeti arıza kaydında da tutuluyor: raporlar arıza üzerinden
-- alınıyor ve her seferinde forma bağlanmak sorguları ağırlaştırıyordu.
IF OBJECT_ID('B360_ARIZA') IS NOT NULL AND COL_LENGTH('B360_ARIZA', 'maliyet') IS NULL
    ALTER TABLE B360_ARIZA ADD maliyet DECIMAL(18,2) NULL;

-- Şube ↔ depo ve veritabanı eşlemesi.
--
-- Fiyat ve stok merkezdeki Mikro veritabanından depo numarasıyla
-- okunuyor; şubelerin kendi veritabanlarına sunucudan erişilemiyor.
-- Depo eşlemesi koda gömülemez: şube açıldığında ya da depo numarası
-- değiştiğinde yeni sürüm yayınlamak gerekirdi.
IF OBJECT_ID('B360_SUBE_DEPO') IS NULL
BEGIN
    CREATE TABLE B360_SUBE_DEPO (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        sube_kodu    NVARCHAR(40)   NOT NULL,
        sube_adi     NVARCHAR(150)  NULL,

        -- Mikro'daki depo numarası: eldeki stok bununla hesaplanıyor
        depo_no      INT            NULL,

        -- Kullanılmıyor: şubelerin kendi veritabanlarına sunucudan
        -- erişilemediği için fiyat ve stok merkezden okunuyor. Sütun,
        -- ileride bir köprü servisi kurulursa diye duruyor.
        baglanti     NVARCHAR(400)  NULL,

        -- Etiket listesi bu adrese gidiyor
        eposta       NVARCHAR(300)  NULL,

        aktif        BIT            NOT NULL DEFAULT(1),
        olusturma    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_B360_SUBE_DEPO ON B360_SUBE_DEPO(sube_kodu);
END

-- Ürün görselleri. Fiyat sorgulayan personel ürünü adından değil
-- görüntüsünden tanıyor; raf etiketini doğru ürüne takmak bununla
-- kolaylaşıyor.
IF OBJECT_ID('B360_URUN_GORSEL') IS NULL
BEGIN
    CREATE TABLE B360_URUN_GORSEL (
        id         INT IDENTITY(1,1) PRIMARY KEY,

        -- Barkod değil stok kodu: aynı ürünün birden çok barkodu olabiliyor
        stok_kodu  NVARCHAR(40)   NOT NULL,
        dosya      NVARCHAR(200)  NOT NULL,
        ozgun_ad   NVARCHAR(260)  NULL,
        kapak      BIT            NOT NULL DEFAULT(0),
        yukleyen   NVARCHAR(60)   NULL,
        olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_B360_URUN_GORSEL ON B360_URUN_GORSEL(stok_kodu, kapak DESC);
END

-- Portaldan açılan kullanıcılar için ortak kullanıcı tablosuna eklenen
-- alanlar. Aynı tanım Kariyer servisinde de var: hangi servis önce
-- yayınlanırsa sütunları o açıyor. İK erişimi varsayılan açık.
IF OBJECT_ID('KRY_KULLANICILAR') IS NOT NULL
BEGIN
    IF COL_LENGTH('KRY_KULLANICILAR', 'sicil') IS NULL
        ALTER TABLE KRY_KULLANICILAR ADD sicil NVARCHAR(30) NULL;
    IF COL_LENGTH('KRY_KULLANICILAR', 'ik_erisim') IS NULL
        ALTER TABLE KRY_KULLANICILAR ADD ik_erisim BIT NOT NULL DEFAULT(1);
    IF COL_LENGTH('KRY_KULLANICILAR', 'depo_no') IS NULL
        ALTER TABLE KRY_KULLANICILAR ADD depo_no INT NULL;
    IF COL_LENGTH('KRY_KULLANICILAR', 'sube_kodu') IS NULL
        ALTER TABLE KRY_KULLANICILAR ADD sube_kodu NVARCHAR(150) NULL;
END

-- Bölgeler: şubeler ve bölge müdürleri tek yerde.
-- Şube adı personel kartındaki şube (iş grubu) adıyla birebir: listeden
-- seçiliyor, yazım farkı olmuyor. Bölge müdürü değişince yalnızca kişi
-- değiştiriliyor; şubeler bölgede kalıyor. Puantaj, yıllık izin onayı ve
-- bölge kapsamlı ekranlar önce buraya bakıyor.
IF OBJECT_ID('B360_BOLGE') IS NULL
BEGIN
    CREATE TABLE B360_BOLGE (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        ad          NVARCHAR(150)  NOT NULL,
        aktif       BIT            NOT NULL DEFAULT(1),
        guncelleyen NVARCHAR(100)  NULL,
        guncelleme  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE TABLE B360_BOLGE_SUBE (
        bolge_id    INT            NOT NULL,
        sube        NVARCHAR(150)  NOT NULL,
        CONSTRAINT PK_B360_BOLGE_SUBE PRIMARY KEY (bolge_id, sube)
    );

    CREATE TABLE B360_BOLGE_MUDUR (
        bolge_id    INT            NOT NULL,
        sicil       NVARCHAR(30)   NOT NULL,
        CONSTRAINT PK_B360_BOLGE_MUDUR PRIMARY KEY (bolge_id, sicil)
    );
END

-- Grup ayarları: sorumluluk, veri kapsamı, onay kademeleri.
--
-- Modül görünürlüğü B360_YETKI'de; bu tablo, gördüğü modülde neyi
-- görür ve kimin talebini onaylar sorusunun cevabı. Grup kimliğine bağlı:
-- grup adı değiştirildiğinde ayar kaybolmasın. Ayar JSON: yeni bir kapsam
-- eklendiğinde tablo göçü gerekmesin.
IF OBJECT_ID('B360_GRUP_AYAR') IS NULL
BEGIN
    CREATE TABLE B360_GRUP_AYAR (
        grup_id      INT            NOT NULL PRIMARY KEY,
        ayar         NVARCHAR(MAX)  NOT NULL,
        guncelleyen  NVARCHAR(100)  NULL,
        guncelleme   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Kişinin sorumlu olduğu bölgeler.
--
-- Bölge müdürü genelde merkezde oturuyor; kendi iş grubundan bölgesini
-- çıkarmak yanlış bölgeyi verirdi. Tanım yoksa kişinin kendi şubesinin
-- bölgesi kullanılıyor.
IF OBJECT_ID('B360_KISI_BOLGE') IS NULL
BEGIN
    CREATE TABLE B360_KISI_BOLGE (
        sicil   NVARCHAR(30)   NOT NULL,
        bolge   NVARCHAR(100)  NOT NULL,
        CONSTRAINT PK_B360_KISI_BOLGE PRIMARY KEY (sicil, bolge)
    );
END

-- Personelin seçtiği şube. Merkez ofisten sorgulayan kişinin her seferinde
-- şube seçmesi gerekiyordu; seçim burada kalıyor ve değiştirene kadar
-- geçerli.
IF OBJECT_ID('B360_SUBE_SECIM') IS NULL
BEGIN
    CREATE TABLE B360_SUBE_SECIM (
        kullanici  NVARCHAR(60)   NOT NULL PRIMARY KEY,
        sube_kodu  NVARCHAR(40)   NOT NULL,
        guncelleme DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END

IF OBJECT_ID('B360_SERVIS_FORM') IS NULL
BEGIN
    CREATE TABLE B360_SERVIS_FORM (
        id            INT IDENTITY(1,1) PRIMARY KEY,

        -- SRV-2026-000184 biçiminde; mağazaya giden belgede bu numara var
        form_no       NVARCHAR(20)   NOT NULL,

        ariza_id      INT            NOT NULL,

        -- Arızada cihaz seçilmişse form o cihaza da işleniyor
        envanter_id   INT            NULL,

        -- uzaktan · yerinde · merkezde
        mudahale      NVARCHAR(20)   NOT NULL DEFAULT N'yerinde',

        -- Ne olduğu ve ne yapıldığı ayrı: biri sorunun tanımı, diğeri
        -- çözümü ve aynı arıza tekrarladığında ikisi de gerekiyor
        tespit        NVARCHAR(MAX)  NULL,
        yapilan_islem NVARCHAR(MAX)  NULL,

        parca_degisti BIT            NOT NULL DEFAULT(0),
        cihaz_degisti BIT            NOT NULL DEFAULT(0),
        yeni_cihaz    NVARCHAR(200)  NULL,

        -- Parçaların toplamı ile işçilik ayrı tutuluyor: raporda
        -- 'parçaya mı işçiliğe mi gidiyor' sorusu sık soruluyor
        parca_tutari  DECIMAL(18,2)  NOT NULL DEFAULT(0),
        iscilik       DECIMAL(18,2)  NOT NULL DEFAULT(0),
        toplam        DECIMAL(18,2)  NOT NULL DEFAULT(0),

        servis_firma  NVARCHAR(200)  NULL,
        teknisyen     NVARCHAR(200)  NULL,

        baslangic     DATETIME2      NULL,
        bitis         DATETIME2      NULL,

        -- Oluşturulan belge diskte; mağazaya da bu gönderiliyor
        belge         NVARCHAR(200)  NULL,
        mail_gitti    BIT            NOT NULL DEFAULT(0),
        mail_adres    NVARCHAR(300)  NULL,

        olusturan     NVARCHAR(60)   NULL,
        olusturan_adi NVARCHAR(200)  NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_B360_SERVIS_NO ON B360_SERVIS_FORM(form_no);
    CREATE INDEX IX_B360_SERVIS_ARIZA ON B360_SERVIS_FORM(ariza_id);
    CREATE INDEX IX_B360_SERVIS_TARIH ON B360_SERVIS_FORM(olusturma DESC);
END

-- Kullanılan parçalar. Parça başına satır: raporda 'hangi parça kaç kez
-- değişti' sorusu tek satırlık bir metinden çıkarılamıyordu.
IF OBJECT_ID('B360_SERVIS_PARCA') IS NULL
BEGIN
    CREATE TABLE B360_SERVIS_PARCA (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        form_id     INT            NOT NULL,
        ad          NVARCHAR(200)  NOT NULL,
        kod         NVARCHAR(80)   NULL,
        adet        DECIMAL(18,2)  NOT NULL DEFAULT(1),
        birim_fiyat DECIMAL(18,2)  NOT NULL DEFAULT(0),
        tutar       DECIMAL(18,2)  NOT NULL DEFAULT(0),
        notu        NVARCHAR(400)  NULL
    );

    CREATE INDEX IX_B360_SERVIS_PARCA ON B360_SERVIS_PARCA(form_id);
END

IF OBJECT_ID('B360_ENVANTER_GORSEL') IS NULL
BEGIN
    CREATE TABLE B360_ENVANTER_GORSEL (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        envanter_id INT           NOT NULL,
        dosya      NVARCHAR(200)  NOT NULL,
        ozgun_ad   NVARCHAR(260)  NULL,
        boyut      BIGINT         NOT NULL DEFAULT(0),

        -- İlk görsel listede küçük resim olarak kullanılıyor
        kapak      BIT            NOT NULL DEFAULT(0),
        olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_B360_ENV_GORSEL ON B360_ENVANTER_GORSEL(envanter_id, kapak DESC);
END

IF OBJECT_ID('B360_ARIZA_TUR') IS NULL
CREATE TABLE B360_ARIZA_TUR (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    ad            NVARCHAR(80)  NOT NULL UNIQUE,
    departman_id  INT           NULL,   /* boşsa tüm departmanlar kullanır */
    aciklama      NVARCHAR(400) NULL,
    sla_saat      INT           NOT NULL DEFAULT 72,
    cihaz_turleri NVARCHAR(400) NULL,   /* virgülle ayrılmış; boşsa tümü   */
    aktif         BIT           NOT NULL DEFAULT 1,
    sira          INT           NOT NULL DEFAULT 0
);");

            foreach (var (sutun, tanim) in new[]
                     {
                         ("departman_id",  "INT NULL"),
                         ("aciklama",      "NVARCHAR(400) NULL"),
                         ("sla_saat",      "INT NOT NULL DEFAULT 72"),
                         ("cihaz_turleri", "NVARCHAR(400) NULL"),

                         /* Soru akışının ilk adımında sorulacak cümle:
                            "Yazarkasada ne var?" gibi. Boşsa genel bir
                            ifade kullanılıyor. */
                         ("soru",          "NVARCHAR(200) NULL"),

                         /* Akış sonuna kadar tamamlanmadan kayıt açılamaz */
                         ("akis_zorunlu",  "BIT NOT NULL DEFAULT 0"),

                         /* Kategoriye bağlı varsayılan sorumlu: bu
                            kategoride açılan kayıt kendiliğinden ona
                            atanıyor. Temsilcinin her kaydı elle üstlenmesi
                            gerekiyordu ve kimsenin almadığı kayıt SLA'yı
                            kaçırıyordu. */
                         ("atanan_kodu",   "NVARCHAR(30) NULL"),
                         ("atanan_adi",    "NVARCHAR(200) NULL"),
                     })
            {
                db.Execute($@"
IF COL_LENGTH('B360_ARIZA_TUR', '{sutun}') IS NULL
    ALTER TABLE B360_ARIZA_TUR ADD {sutun} {tanim};");
            }

            /* ------------------------------------------------------------ */
            /* Arıza kayıtları                                                */
            /* ------------------------------------------------------------ */

            db.Execute(@"
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

    oncelik        NVARCHAR(15)   NOT NULL DEFAULT N'orta',
    durum          NVARCHAR(20)   NOT NULL DEFAULT N'acik',

    /* Kategorinin SLA süresinden hesaplanır; gecikme buna göre ölçülür */
    sla_bitis      DATETIME2      NULL,

    olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    cozum_zamani   DATETIME2      NULL,
    kapanma        DATETIME2      NULL,
    CONSTRAINT FK_B360_ARIZA_DEP FOREIGN KEY (departman_id)
        REFERENCES B360_DEPARTMAN(id)
);");

            foreach (var (sutun, tanim) in new[]
                     {
                         ("atanan_kodu",  "NVARCHAR(30) NULL"),
                         ("atanan_adi",   "NVARCHAR(200) NULL"),
                         ("oncelik",      "NVARCHAR(15) NOT NULL DEFAULT N'orta'"),
                         ("sla_bitis",    "DATETIME2 NULL"),
                         ("cozum_zamani", "DATETIME2 NULL"),

                         /* Kaydı açan kişinin cep numarası, kayıt anında
                            yazılıyor. Her ayrıntı isteğinde Mikro'ya
                            sormak yerine: personel işten ayrılsa bile
                            teknisyenin o gün kimi aradığı kayıtta kalmalı. */
                         ("acan_telefon", "NVARCHAR(20) NULL"),

                         /* Soru akışında en son seçilen adım */
                         ("adim_id",      "INT NULL"),

                         /* 'Yazarkasa › Fiş yazıcı › Silik çıkarıyor'.
                            Yanıt tablosundan her listede yeniden kurmak
                            yerine kayda yazılıyor: liste, arama ve rapor
                            hep bu tek sütun üzerinden çalışıyor. */
                         ("akis_ozet",    "NVARCHAR(400) NULL"),
                     })
            {
                db.Execute($@"
IF COL_LENGTH('B360_ARIZA', '{sutun}') IS NULL
    ALTER TABLE B360_ARIZA ADD {sutun} {tanim};");
            }

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ARIZA_LISTE')
CREATE INDEX IX_B360_ARIZA_LISTE ON B360_ARIZA (departman_id, durum, olusturma DESC);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ARIZA_ACAN')
CREATE INDEX IX_B360_ARIZA_ACAN ON B360_ARIZA (acan_kodu, olusturma DESC);");

            db.Execute(@"
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
);");

            /* Yorumlar hareket geçmişinden ayrı tutuluyor: hareket 'ne
               oldu"yu, yorum "ne konuşuldu"yu tutuyor. Aynı tabloya
               koymak, geçmişi durum değişiklikleriyle yorumların
               karıştığı okunmaz bir listeye çeviriyordu. */
            db.Execute(@"
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
);");

            db.Execute(@"
IF OBJECT_ID('B360_ARIZA_GORSEL') IS NULL
CREATE TABLE B360_ARIZA_GORSEL (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    ariza_id   INT            NOT NULL,
    dosya      NVARCHAR(200)  NOT NULL,
    silindi    BIT            NOT NULL DEFAULT 0,
    olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_GORSEL_ARIZA FOREIGN KEY (ariza_id)
        REFERENCES B360_ARIZA(id) ON DELETE CASCADE
);");

            /* ------------------------------------------------------------ */
            /* Soru akışı                                                     */
            /* ------------------------------------------------------------ */

            /* Adımlar tek ağaçta: 'donanım' ve 'soru' için iki ayrı tablo
               denendi, iki seviyeyle sınırlı kalıyordu. Oysa teknik işlerde
               Dolap › Şarküteri › Kapak gibi istenildiği kadar derinleşen
               kırılımlar var. Bir düğüm hem seçenek (ad) hem de kendi alt
               seçeneklerinin sorusudur (soru). */
            db.Execute(@"
IF OBJECT_ID('B360_ARIZA_ADIM') IS NULL
CREATE TABLE B360_ARIZA_ADIM (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    tur_id           INT           NOT NULL,
    ust_id           INT           NULL,   /* NULL = ilk seviye            */
    ad               NVARCHAR(120) NOT NULL,   /* seçenek: 'Fiş yazıcı'    */
    soru             NVARCHAR(200) NULL,   /* alt seçenekler sorulurken    */
    ipucu            NVARCHAR(300) NULL,
    coklu            BIT           NOT NULL DEFAULT 0,
    cihaz_turu       NVARCHAR(60)  NULL,   /* envanterden cihaz sordurur   */
    aciklama_ister   BIT           NOT NULL DEFAULT 0,
    aciklama_zorunlu BIT           NOT NULL DEFAULT 0,
    gorsel_ister     BIT           NOT NULL DEFAULT 0,
    gorsel_zorunlu   BIT           NOT NULL DEFAULT 0,
    oncelik          NVARCHAR(15)  NULL,   /* seçilirse kaydın önceliği    */
    aktif            BIT           NOT NULL DEFAULT 1,
    sira             INT           NOT NULL DEFAULT 0,
    olusturma        DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_ADIM_TUR FOREIGN KEY (tur_id)
        REFERENCES B360_ARIZA_TUR(id) ON DELETE CASCADE
);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_ADIM_TUR')
CREATE INDEX IX_B360_ADIM_TUR ON B360_ARIZA_ADIM (tur_id, ust_id, sira);");

            /* Soru ve cevap metinleri yanıt satırına kopyalanıyor: bir
               seçeneğin adı değişince ya da pasife alınınca geçmiş
               kayıtların ne dediği değişmemeli. */
            db.Execute(@"
IF OBJECT_ID('B360_ARIZA_YANIT') IS NULL
CREATE TABLE B360_ARIZA_YANIT (
    id        INT IDENTITY(1,1) PRIMARY KEY,
    ariza_id  INT            NOT NULL,
    adim_id   INT            NULL,   /* adım silinse de yanıt durur */
    seviye    INT            NOT NULL DEFAULT 0,
    soru      NVARCHAR(200)  NULL,
    cevap     NVARCHAR(200)  NULL,
    aciklama  NVARCHAR(MAX)  NULL,
    sira      INT            NOT NULL DEFAULT 0,
    CONSTRAINT FK_B360_YANIT_ARIZA FOREIGN KEY (ariza_id)
        REFERENCES B360_ARIZA(id) ON DELETE CASCADE
);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_YANIT_ARIZA')
CREATE INDEX IX_B360_YANIT_ARIZA ON B360_ARIZA_YANIT (ariza_id, sira);");

            /* ------------------------------------------------------------ */
            /* Rakip fiyat                                                    */
            /* ------------------------------------------------------------ */

            db.Execute(@"
IF OBJECT_ID('B360_RAKIP_FIRMA') IS NULL
CREATE TABLE B360_RAKIP_FIRMA (
    id     INT IDENTITY(1,1) PRIMARY KEY,
    ad     NVARCHAR(120) NOT NULL UNIQUE,
    aktif  BIT           NOT NULL DEFAULT 1,
    sira   INT           NOT NULL DEFAULT 0
);");

            db.Execute(@"
IF OBJECT_ID('B360_RAKIP_FIYAT') IS NULL
CREATE TABLE B360_RAKIP_FIYAT (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    firma_id      INT            NOT NULL,
    barkod        NVARCHAR(60)   NOT NULL,

    /* Stok kodu ve ürün adı okutma anında yazılıyor: barkod sonradan
       başka bir stoka bağlanırsa eski kaydın ürünü değişmemeli. */
    stok_kodu     NVARCHAR(40)   NULL,
    urun_adi      NVARCHAR(200)  NULL,

    rakip_fiyat   DECIMAL(18,2)  NOT NULL,
    bizim_fiyat   DECIMAL(18,2)  NULL,
    fark          DECIMAL(18,2)  NULL,
    fark_yuzde    DECIMAL(9,2)   NULL,

    sube_kodu     NVARCHAR(40)   NULL,
    personel_kodu NVARCHAR(30)   NULL,
    personel_adi  NVARCHAR(200)  NULL,
    not_metni     NVARCHAR(MAX)  NULL,
    olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_RFIYAT_FIRMA FOREIGN KEY (firma_id)
        REFERENCES B360_RAKIP_FIRMA(id)
);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_RFIYAT_TARIH')
CREATE INDEX IX_B360_RFIYAT_TARIH ON B360_RAKIP_FIYAT (olusturma DESC);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_RFIYAT_BARKOD')
CREATE INDEX IX_B360_RFIYAT_BARKOD ON B360_RAKIP_FIYAT (barkod, olusturma DESC);");

            /* Personelin kendi okutma geçmişi (23.10.2026): kişi + id ile hızlı sayfalama */
            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_RFIYAT_PERSONEL')
CREATE INDEX IX_B360_RFIYAT_PERSONEL ON B360_RAKIP_FIYAT (personel_kodu, id DESC)
    INCLUDE (firma_id, olusturma);");

            /* Rakip web fiyatları ve eşleştirme (09.10.2026) */
            db.Execute(@"
IF COL_LENGTH('B360_RAKIP_FIYAT', 'kaynak') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD kaynak NVARCHAR(10) NULL;
IF COL_LENGTH('B360_RAKIP_FIYAT', 'web_link') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD web_link NVARCHAR(1000) NULL;
IF COL_LENGTH('B360_RAKIP_FIYAT', 'web_eslesme_id') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD web_eslesme_id INT NULL;");

            /* Raf ve BiCard fiyatı ayrı (09.10.2026): bizim_fiyat geçerli
               fiyat (BiCard > 0 ise BiCard, değilse raf); raporlar raf
               fiyatıyla da kıyaslıyor. */
            db.Execute(@"
IF COL_LENGTH('B360_RAKIP_FIYAT', 'raf_fiyat') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD raf_fiyat DECIMAL(18,2) NULL;
IF COL_LENGTH('B360_RAKIP_FIYAT', 'bicard_fiyat') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD bicard_fiyat DECIMAL(18,2) NULL;
IF COL_LENGTH('B360_RAKIP_FIYAT', 'fiyat_kurali') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD fiyat_kurali TINYINT NULL;
IF COL_LENGTH('B360_RAKIP_FIYAT', 'rakip_liste_fiyat') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD rakip_liste_fiyat DECIMAL(18,2) NULL;");

            /* Otomatik eşleştirme (12.10.2026): benzerlikle açılan eşleşme
               "otomatik" ve puanıyla işaretli; kişinin kaldırdığı ya da
               değiştirdiği otomatik eşleşme ret listesine yazılıyor. */
            db.Execute(@"
IF COL_LENGTH('B360_RAKIP_WEB_ESLESME', 'otomatik') IS NULL
    ALTER TABLE B360_RAKIP_WEB_ESLESME ADD otomatik BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('B360_RAKIP_WEB_ESLESME', 'puan') IS NULL
    ALTER TABLE B360_RAKIP_WEB_ESLESME ADD puan DECIMAL(5,1) NULL;
IF OBJECT_ID('B360_RAKIP_WEB_RED') IS NULL
CREATE TABLE B360_RAKIP_WEB_RED (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    site_anahtar  NVARCHAR(120) NOT NULL,
    ad_anahtar    NVARCHAR(400) NOT NULL,
    stok_kodu     NVARCHAR(40)  NOT NULL,
    reddeden      NVARCHAR(100) NULL,
    olusturma     DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);");

            /* Rakip logosu (12.10.2026): portaldan bağlantı ya da görsel.
               Bağlantı verilince görsel sunucuya indirilip saklanıyor
               (logo_dosya); indirilemezse bağlantının kendisi kullanılıyor.
               logo_surum önbellek kırıcı: logo değişince artıyor. Sorgu
               ve okutma kayıtları (düzeltme) için güncelleyen/zaman. */
            db.Execute(@"
IF COL_LENGTH('B360_RAKIP_FIRMA', 'logo_adres') IS NULL
    ALTER TABLE B360_RAKIP_FIRMA ADD logo_adres NVARCHAR(500) NULL;
IF COL_LENGTH('B360_RAKIP_FIRMA', 'logo_dosya') IS NULL
    ALTER TABLE B360_RAKIP_FIRMA ADD logo_dosya NVARCHAR(200) NULL;
IF COL_LENGTH('B360_RAKIP_FIRMA', 'logo_surum') IS NULL
    ALTER TABLE B360_RAKIP_FIRMA ADD logo_surum INT NOT NULL DEFAULT 0;
IF COL_LENGTH('B360_RAKIP_FIYAT', 'duzeltme') IS NULL
    ALTER TABLE B360_RAKIP_FIYAT ADD duzeltme DATETIME2 NULL;");

            /* Fiyat Kontrol etiket listesi taslağı (11.10.2026): kişinin
               okuttuğu ama henüz göndermediği liste; uygulama kapansa da
               telefon değişse de kaybolmasın. Kişi başına tek satır. */
            db.Execute(@"
IF OBJECT_ID('B360_ETIKET_TASLAK') IS NULL
CREATE TABLE B360_ETIKET_TASLAK (
    kullanici   NVARCHAR(60)   NOT NULL PRIMARY KEY,
    icerik      NVARCHAR(MAX)  NOT NULL,
    guncelleme  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
);");

            db.Execute(@"
IF OBJECT_ID('B360_RAKIP_WEB_YUKLEME') IS NULL
CREATE TABLE B360_RAKIP_WEB_YUKLEME (
    id         INT IDENTITY(1,1) PRIMARY KEY,
    dosya_adi  NVARCHAR(260) NULL,
    ozet       NVARCHAR(64)  NULL,
    yukleyen   NVARCHAR(100) NULL,
    satir      INT NOT NULL DEFAULT 0,
    olusturma  DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);");

            db.Execute(@"
IF OBJECT_ID('B360_RAKIP_WEB_ESLESME') IS NULL
CREATE TABLE B360_RAKIP_WEB_ESLESME (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    site_anahtar  NVARCHAR(120) NOT NULL,
    ad_anahtar    NVARCHAR(400) NOT NULL,
    link_anahtar  NVARCHAR(450) NULL,
    web_ad        NVARCHAR(400) NULL,
    stok_kodu     NVARCHAR(40)  NULL,
    urun_adi      NVARCHAR(200) NULL,
    yok           BIT NOT NULL DEFAULT 0,
    eslestiren    NVARCHAR(100) NULL,
    olusturma     DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_RWEB_ESLESME_AD')
CREATE INDEX IX_B360_RWEB_ESLESME_AD ON B360_RAKIP_WEB_ESLESME (site_anahtar, ad_anahtar);");

            db.Execute(@"
IF OBJECT_ID('B360_RAKIP_WEB') IS NULL
CREATE TABLE B360_RAKIP_WEB (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    yukleme_id      INT NOT NULL,
    site            NVARCHAR(120) NOT NULL,
    site_anahtar    NVARCHAR(120) NOT NULL,
    urun_adi        NVARCHAR(400) NOT NULL,
    ad_anahtar      NVARCHAR(400) NOT NULL,
    link            NVARCHAR(1000) NULL,
    link_anahtar    NVARCHAR(450) NULL,
    fiyat           DECIMAL(18,2) NOT NULL,
    eski_fiyat      DECIMAL(18,2) NULL,
    sayfa           NVARCHAR(1000) NULL,
    okunma          DATETIME2 NOT NULL,
    eslesme_id      INT NULL,
    rakip_fiyat_id  INT NULL
);");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_RWEB_ANAHTAR')
CREATE INDEX IX_B360_RWEB_ANAHTAR ON B360_RAKIP_WEB (site_anahtar, ad_anahtar);");

            /* Yetki sorguları hep alan + kapsam + anahtar üzerinden geliyor */
            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_B360_YETKI_ARAMA')
CREATE INDEX IX_B360_YETKI_ARAMA ON B360_YETKI (alan, kapsam, anahtar);");

            _kayit.LogInformation("Biçen360 tabloları hazır.");
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata,
                "Tablolar oluşturulamadı. kurulum.sql dosyasını elle çalıştırınız.");
        }
        /* Portal rolleri (13.10.2026). Ayrı blokta: yukarıdaki kurulumun bir
           adımı hata verse de roller kurulabilsin. */
        try
        {
            using var db = Baglanti();

            db.Execute(@"
IF OBJECT_ID('B360_ARIZA') IS NOT NULL AND COL_LENGTH('B360_ARIZA', 'maliyet') IS NULL
    ALTER TABLE B360_ARIZA ADD maliyet DECIMAL(18,2) NULL;

IF OBJECT_ID('B360_ROL') IS NULL
CREATE TABLE B360_ROL (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    ad          NVARCHAR(80)  NOT NULL UNIQUE,
    aciklama    NVARCHAR(300) NULL,
    tum_departmanlar BIT      NOT NULL DEFAULT 0,
    maliyet     BIT           NOT NULL DEFAULT 0,
    aktif       BIT           NOT NULL DEFAULT 1,
    guncelleyen NVARCHAR(100) NULL,
    olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    guncelleme  DATETIME2     NULL
);

IF OBJECT_ID('B360_ROL_DEPARTMAN') IS NULL
CREATE TABLE B360_ROL_DEPARTMAN (
    rol_id       INT NOT NULL,
    departman_id INT NOT NULL,
    CONSTRAINT PK_B360_ROL_DEPARTMAN PRIMARY KEY (rol_id, departman_id),
    CONSTRAINT FK_B360_ROLDEP_ROL FOREIGN KEY (rol_id) REFERENCES B360_ROL(id) ON DELETE CASCADE,
    CONSTRAINT FK_B360_ROLDEP_DEP FOREIGN KEY (departman_id) REFERENCES B360_DEPARTMAN(id) ON DELETE CASCADE
);

IF OBJECT_ID('B360_ROL_SAYFA') IS NULL
CREATE TABLE B360_ROL_SAYFA (
    rol_id  INT          NOT NULL,
    kod     NVARCHAR(50) NOT NULL,
    seviye  TINYINT      NOT NULL DEFAULT 1,
    CONSTRAINT PK_B360_ROL_SAYFA PRIMARY KEY (rol_id, kod),
    CONSTRAINT FK_B360_ROLSAYFA_ROL FOREIGN KEY (rol_id) REFERENCES B360_ROL(id) ON DELETE CASCADE
);

IF OBJECT_ID('B360_ROL_RAPOR') IS NULL
CREATE TABLE B360_ROL_RAPOR (
    rol_id  INT          NOT NULL,
    rapor   NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_B360_ROL_RAPOR PRIMARY KEY (rol_id, rapor),
    CONSTRAINT FK_B360_ROLRAPOR_ROL FOREIGN KEY (rol_id) REFERENCES B360_ROL(id) ON DELETE CASCADE
);

IF OBJECT_ID('B360_ENVANTER_KATEGORI') IS NULL
CREATE TABLE B360_ENVANTER_KATEGORI (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    ad            NVARCHAR(100) NOT NULL,
    departman_id  INT           NULL,
    aciklama      NVARCHAR(300) NULL,
    bakim_araligi INT           NULL,
    aktif         BIT           NOT NULL DEFAULT 1,
    sira          INT           NOT NULL DEFAULT 0,
    guncelleyen   NVARCHAR(100) NULL,
    olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

IF OBJECT_ID('B360_KULLANICI_ROL') IS NULL
CREATE TABLE B360_KULLANICI_ROL (
    kullanici_adi NVARCHAR(100) NOT NULL PRIMARY KEY,
    rol_id        INT           NOT NULL,
    atayan        NVARCHAR(100) NULL,
    tarih         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_B360_KULROL_ROL FOREIGN KEY (rol_id) REFERENCES B360_ROL(id) ON DELETE CASCADE
);");

            _kayit.LogInformation("Portal rol tabloları hazır.");
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Portal rol tabloları oluşturulamadı.");
        }
    }

    /// <summary>
    /// Kariyer sisteminin kullanıcı tablosu var mı.
    ///
    /// Yoksa giriş çalışmaz; açılışta uyarmak, ilk girişte anlaşılmaz bir
    /// hata almaktan iyi.
    /// </summary>
    public bool KullaniciTablosuVar()
    {
        try
        {
            using var db = Baglanti();
            return db.ExecuteScalar<int>(
                "SELECT CASE WHEN OBJECT_ID('KRY_KULLANICILAR') IS NULL THEN 0 ELSE 1 END") == 1;
        }
        catch
        {
            return false;
        }
    }
}

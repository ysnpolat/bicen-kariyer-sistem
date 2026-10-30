using System.Data;
using System.Text.Json;
using Dapper;
using Microsoft.Data.SqlClient;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Uygulama açılışında veritabanını ve tabloları oluşturur,
/// yönetici kullanıcısı ile varsayılan ayarları yazar.
/// </summary>
public class VeritabaniServisi
{
    private readonly string _baglanti;
    private readonly IConfiguration _yapilandirma;

    /// <summary>
    /// Uygulamanın veritabanına kendini tanıttığı ad. Başvuru tablosundaki
    /// koruma tetikleyicisi bu adı arar: SSMS ya da başka bir araçla elle
    /// eklenen başvurular reddedilir.
    /// </summary>
    public const string UygulamaAdi = "BicenKariyerAPI";

    public VeritabaniServisi(IConfiguration yapilandirma)
    {
        _yapilandirma = yapilandirma;

        var adres = yapilandirma.GetConnectionString("Varsayilan");

        /* Bağlantıya uygulama adı eklenir; ayarda zaten varsa dokunulmaz. */
        if (!string.IsNullOrWhiteSpace(adres) &&
            !adres.Contains("Application Name", StringComparison.OrdinalIgnoreCase))
        {
            adres = adres.TrimEnd(';') + $";Application Name={UygulamaAdi}";
        }

        _baglanti = adres;
    }

    public IDbConnection Baglanti() => new SqlConnection(_baglanti);

    /// <summary>
    /// Personel veritabanı (iCardBicen) bağlantısı.
    /// Yalnızca okuma amaçlıdır; personel listesi bu kaynaktan gelir.
    /// </summary>
    public IDbConnection PersonelBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Personel");

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                "Personel veritabanı bağlantısı tanımlı değil (ConnectionStrings:Personel).");

        return new SqlConnection(adres);
    }

    /// <summary>
    /// Bordro (tahakkuk) veritabanı bağlantısı.
    ///
    /// <para>
    /// Ücret hesap pusulası MikroDesktop_BICEN'den okunur; personel listesi
    /// ise MikroDesktop_2004BICEN'de. Aynı sunucuda farklı veritabanları
    /// oldukları için ayrı tanımlanır. <c>ConnectionStrings:Tahakkuk</c>
    /// boşsa personel bağlantısındaki veritabanı adı
    /// <c>Tahakkuk:Veritabani</c> ile değiştirilerek kullanılır — böylece
    /// tek bir ayar satırıyla yönetilebilir.
    /// </para>
    /// </summary>
    public IDbConnection TahakkukBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Tahakkuk");

        if (!string.IsNullOrWhiteSpace(adres)) return new SqlConnection(adres);

        var personel = _yapilandirma.GetConnectionString("Personel");

        if (string.IsNullOrWhiteSpace(personel))
            throw new InvalidOperationException(
                "Tahakkuk veritabanı bağlantısı tanımlı değil "
                + "(ConnectionStrings:Tahakkuk ya da ConnectionStrings:Personel).");

        var veritabani = _yapilandirma["Tahakkuk:Veritabani"];

        if (string.IsNullOrWhiteSpace(veritabani)) veritabani = "MikroDesktop_BICEN";

        var kurucu = new SqlConnectionStringBuilder(personel)
        {
            InitialCatalog = veritabani
        };

        return new SqlConnection(kurucu.ConnectionString);
    }

    /// <summary>
    /// HKS (Hal Kayıt Sistemi) künye veritabanı bağlantısı.
    /// Meyve-sebze künyeleri ve etiketleri burada; rakip fiyat analizi
    /// bu tabloları okur.
    /// </summary>
    public IDbConnection HksBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Hks");

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                "HKS veritabanı bağlantısı tanımlı değil (ConnectionStrings:Hks).");

        return new SqlConnection(adres);
    }

    /// <summary>
    /// Mikro V15 (ciro) veritabanı bağlantısı.
    ///
    /// Günlük şube ciroları buradan okunur. Personel veritabanından farklı
    /// bir sunucu/port kullandığı için ayrı tanımlanır. Yalnızca okuma
    /// amaçlıdır.
    /// </summary>
    public IDbConnection CiroBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Ciro");

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                "Ciro veritabanı bağlantısı tanımlı değil (ConnectionStrings:Ciro).");

        return new SqlConnection(adres);
    }

    /// <summary>
    /// QR geçiş sistemi (iCard) veritabanı bağlantısı.
    /// Personelin giriş çıkış hareketleri buradan okunur; yalnızca okuma.
    /// </summary>
    public IDbConnection GecisBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Gecis");

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                "Geçiş veritabanı bağlantısı tanımlı değil (ConnectionStrings:Gecis).");

        return new SqlConnection(adres);
    }

    /// <summary>
    /// Mağaza performans veritabanı. Personelin dönemsel değerlendirme
    /// puanları ve büyüme oranları buradan okunur; yalnızca okuma yapılır.
    /// Puanlar orada PD_Rapor saklı yordamıyla hesaplanıyor.
    ///
    /// <para>
    /// Sorgular tabloları <c>[biDb].[dbo].</c> tam yoluyla çağırır, bu
    /// yüzden bağlantı biDb ya da PBWEB'e kurulabilir — ikisi aynı sunucuda
    /// ve saklı yordamlar da tam yol kullanıyor.
    /// </para>
    /// </summary>
    public IDbConnection PerformansBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Performans");

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                "Performans veritabanı bağlantısı tanımlı değil (ConnectionStrings:Performans).");

        return new SqlConnection(adres);
    }

    /// <summary>
    /// Yazarkasa (PosBack) veritabanı.
    ///
    /// Ayrı bir sunucu portunda duruyor, o yüzden kendi bağlantı cümlesi
    /// var. Yalnızca PERTT005 tablosu için kullanılır.
    /// </summary>
    public IDbConnection PosBaglantisi()
    {
        var adres = _yapilandirma.GetConnectionString("Pos");

        if (string.IsNullOrWhiteSpace(adres))
            throw new InvalidOperationException(
                "Yazarkasa veritabanı bağlantısı tanımlı değil (ConnectionStrings:Pos).");

        return new SqlConnection(adres);
    }

    /* ---------------------------------------------------------------- kurulum */

    public void Baslat()
    {
        if (!VeritabaniErisilebilir(out var baglantiHatasi))
        {
            // Veritabanı yok veya erişilemiyor: oluşturmayı dene
            VeritabaniOlustur();
        }

        using var db = Baglanti();

        db.Execute(@"
IF OBJECT_ID('KRY_KULLANICILAR') IS NULL
CREATE TABLE KRY_KULLANICILAR (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    kullanici_adi   NVARCHAR(50)  NOT NULL UNIQUE,
    ad_soyad        NVARCHAR(100) NOT NULL,
    eposta          NVARCHAR(150) NULL,
    parola_hash     NVARCHAR(200) NOT NULL,
    parola_salt     NVARCHAR(100) NOT NULL,
    rol             NVARCHAR(20)  NOT NULL DEFAULT 'IK',
    aktif           BIT           NOT NULL DEFAULT 1,
    olusturma       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

IF OBJECT_ID('KRY_BASVURULAR') IS NULL
CREATE TABLE KRY_BASVURULAR (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    basvuru_no          NVARCHAR(30)  NOT NULL,
    ad_soyad            NVARCHAR(150) NOT NULL,
    kimlik_no           NVARCHAR(25)  NOT NULL,
    telefon             NVARCHAR(25)  NOT NULL,
    eposta              NVARCHAR(150) NULL,
    sube_kodu           NVARCHAR(30)  NULL,
    sube_adi            NVARCHAR(120) NULL,
    bolumler            NVARCHAR(500) NULL,
    durum               NVARCHAR(30)  NOT NULL DEFAULT 'Yeni',
    degerlendirme_notu  NVARCHAR(MAX) NULL,
    gorusme_tarihi      DATETIME2     NULL,
    gorusme_yeri        NVARCHAR(200) NULL,
    veri_json           NVARCHAR(MAX) NOT NULL,
    mail_gonderildi     BIT           NOT NULL DEFAULT 0,
    olusturma           DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    guncelleme          DATETIME2     NULL,
    guncelleyen         NVARCHAR(50)  NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_BASVURULAR_KIMLIK')
CREATE INDEX IX_KRY_BASVURULAR_KIMLIK ON KRY_BASVURULAR (kimlik_no, telefon);

IF OBJECT_ID('KRY_BASVURU_HAREKET') IS NULL
CREATE TABLE KRY_BASVURU_HAREKET (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    basvuru_id  INT           NOT NULL,
    durum       NVARCHAR(30)  NOT NULL,
    aciklama    NVARCHAR(MAX) NULL,
    kullanici   NVARCHAR(50)  NULL,
    tarih       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

IF OBJECT_ID('KRY_BASVURU_NOT') IS NULL
CREATE TABLE KRY_BASVURU_NOT (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    basvuru_id  INT           NOT NULL,
    metin       NVARCHAR(MAX) NOT NULL,
    kullanici   NVARCHAR(50)  NULL,
    ad_soyad    NVARCHAR(100) NULL,
    tarih       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_NOT_BASVURU')
CREATE INDEX IX_KRY_NOT_BASVURU ON KRY_BASVURU_NOT (basvuru_id);

IF OBJECT_ID('KRY_KADRO') IS NULL
CREATE TABLE KRY_KADRO (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    bolum       NVARCHAR(120) NOT NULL,
    sube_kodu   NVARCHAR(30)  NULL,
    sube_adi    NVARCHAR(120) NULL,
    hedef       INT           NOT NULL DEFAULT 1,
    aciklama    NVARCHAR(300) NULL,
    aktif       BIT           NOT NULL DEFAULT 1,
    olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

IF OBJECT_ID('KRY_HAVUZ_IHTIYAC') IS NULL
CREATE TABLE KRY_HAVUZ_IHTIYAC (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    bolge       NVARCHAR(120) NOT NULL,
    bolum       NVARCHAR(120) NOT NULL,
    ihtiyac     INT           NOT NULL DEFAULT 0,
    aciklama    NVARCHAR(300) NULL,
    guncelleme  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
);

IF OBJECT_ID('KRY_AYARLAR') IS NULL
CREATE TABLE KRY_AYARLAR (
    anahtar     NVARCHAR(50) PRIMARY KEY,
    deger       NVARCHAR(MAX) NULL,
    guncelleme  DATETIME2 NULL
);");

        /* Bu adımların her biri ayrı korunur: biri hata verirse uygulama
           açılmamazlık etmesin. Tablolar kurulmuş olduğu sürece sistem
           çalışabilir; eksik varsayılan veri sonradan tamamlanabilir. */
        void Guvenli(string ad, Action islem)
        {
            try
            {
                islem();
            }
            catch (Exception hata)
            {
                Console.WriteLine($"[KURULUM UYARISI] {ad}: {hata.Message}");
            }
        }

        Guvenli("Sürüm güncelleme", () => SurumGuncelle(db));
        Guvenli("Yönetici oluşturma", () => YoneticiOlustur(db));
        Guvenli("Varsayılan ayarlar", () => VarsayilanAyarlar(db));
        Guvenli("Organizasyon şeması", () => VarsayilanOrganizasyon(db));
        Guvenli("Engelli alan adları", () => VarsayilanEngelliAlanlar(db));
        Guvenli("Başvuru koruma tetikleyicisi", () => BasvuruKorumasi(db));
        Guvenli("Elle eklenmiş başvuru temizliği", () => ElleEklenenleriTemizle(db));
    }

    /// <summary>
    /// Elle eklendiği anlaşılan başvuruları inceleme ekranına taşır.
    ///
    /// <para>
    /// Ölçüt, oluşturma tarihinin kesirli saniyesinin sıfır olmasıdır:
    /// uygulama bu alanı hiç yazmaz, SYSDATETIME() varsayılanı devreye
    /// girer ve daima mikrosaniye üretir. Elle yazılan bir tarihte kesir
    /// sıfır kalır.
    /// </para>
    ///
    /// <para>
    /// Kayıt silinmez, <c>KRY_AI_ENGELLENEN</c> tablosuna taşınır ve
    /// İnceleme ekranında görünür. Ölçüt güçlü ama kesin değil — veri toplu
    /// aktarılmış olabilir. Orada bakıp gerçekten geçerliyse başvuruyu geri
    /// alabilir, sahteyse silebilirsiniz.
    /// </para>
    /// </summary>
    private static void ElleEklenenleriTemizle(IDbConnection db)
    {
        var adet = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BASVURULAR
WHERE DATEPART(nanosecond, olusturma) = 0");

        if (adet == 0) return;

        db.Execute(@"
INSERT INTO KRY_AI_ENGELLENEN
    (basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
     bolumler, il, ilce, mahalle, veri_json,
     ai_sonuc, ai_gerekce, ai_guven, gonderen_ip, olusturma)
SELECT basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
       bolumler, il, ilce, mahalle, veri_json,
       N'Şüpheli',
       N'Oluşturma tarihinin kesirli saniyesi sıfır: kayıt uygulama üzerinden değil, veritabanına elle eklenmiş görünüyor.',
       0, gonderen_ip, olusturma
FROM KRY_BASVURULAR
WHERE DATEPART(nanosecond, olusturma) = 0;

DELETE FROM KRY_BASVURULAR
WHERE DATEPART(nanosecond, olusturma) = 0;", commandTimeout: 120);

        Console.WriteLine(
            $"[KURULUM] Elle eklendiği anlaşılan {adet} başvuru İnceleme "
            + "ekranına taşındı.");
    }

    /// <summary>
    /// Başvuru tablosuna uygulama dışından ekleme yapılmasını engeller.
    ///
    /// <para>
    /// Tetikleyici, bağlantının uygulama adına bakar. SSMS ya da başka bir
    /// araçla açılan bir oturumdan INSERT denendiğinde işlem geri alınır ve
    /// deneme güvenlik günlüğüne yazılır.
    /// </para>
    ///
    /// <para>
    /// <b>Sınırı bilinmeli:</b> bu koruma kasıtlı bir saldırıya karşı
    /// yeterli değildir — uygulama adı bağlantı dizesinde taklit
    /// edilebilir, sysadmin yetkisi olan biri tetikleyiciyi kapatabilir.
    /// Amacı, elle ya da yanlışlıkla yapılan eklemeleri durdurmak ve
    /// denemeyi kayda geçirmek. Gerçek koruma, uygulama hesabı dışındaki
    /// kullanıcılardan bu tablo üzerindeki INSERT yetkisinin alınmasıdır.
    /// </para>
    /// </summary>
    private static void BasvuruKorumasi(IDbConnection db)
    {
        /* Engellenen denemeler kendi tablosunda tutulur: güvenlik günlüğü
           dosyaya yazıyor ve tetikleyici oradan yazamaz. */
        db.Execute(@"
IF OBJECT_ID('KRY_ENGELLENEN_EKLEME') IS NULL
BEGIN
    CREATE TABLE KRY_ENGELLENEN_EKLEME (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        tablo     NVARCHAR(60)  NOT NULL,
        uygulama  NVARCHAR(150) NULL,
        kullanici NVARCHAR(150) NULL,
        makine    NVARCHAR(150) NULL,
        tarih     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END");

        db.Execute($@"
IF OBJECT_ID('TRG_KRY_BASVURULAR_Koruma') IS NOT NULL
    DROP TRIGGER TRG_KRY_BASVURULAR_Koruma;");

        db.Execute($@"
CREATE TRIGGER TRG_KRY_BASVURULAR_Koruma
ON KRY_BASVURULAR
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;

    /* İki ayrı işaret aranır:

       1. Uygulama adı: bağlantı BicenKariyerAPI değilse ekleme dışarıdandır.

       2. Kesirli saniye: uygulama olusturma alanını hiç yazmaz, SYSDATETIME()
          varsayılanı devreye girer ve mikrosaniye üretir. Elle yazılan
          tarihlerde kesir sıfır kalır (21:22:14.0000000). Bir uygulama
          kaydının tam sıfır kesirle düşmesi on milyonda bir olasılıktır. */
    IF APP_NAME() <> N'{UygulamaAdi}'
       OR EXISTS (SELECT 1 FROM inserted
                  WHERE DATEPART(nanosecond, olusturma) = 0)
    BEGIN
        /* Kayıt, geri alma öncesinde ayrı bir işlemde yazılır; aksi
           hâlde ROLLBACK bu satırı da siler. */
        DECLARE @uygulama NVARCHAR(150) = APP_NAME();
        DECLARE @kullanici NVARCHAR(150) = SUSER_SNAME();
        DECLARE @makine NVARCHAR(150) = HOST_NAME();

        ROLLBACK TRANSACTION;

        INSERT INTO KRY_ENGELLENEN_EKLEME (tablo, uygulama, kullanici, makine)
        VALUES (N'KRY_BASVURULAR', @uygulama, @kullanici, @makine);

        RAISERROR (N'Basvurular yalnizca Bicen Kariyer uygulamasi uzerinden olusturulabilir.', 16, 1);
    END
END;");
    }

    /// <summary>
    /// Hedef veritabanına doğrudan bağlanılabiliyor mu?
    /// Mevcut bir veritabanı kullanılıyorsa master'a hiç dokunulmaz.
    /// </summary>
    private bool VeritabaniErisilebilir(out string hata)
    {
        hata = null;
        try
        {
            using var db = new SqlConnection(_baglanti);
            db.Open();
            return true;
        }
        catch (SqlException ex)
        {
            hata = ex.Message;
            return false;
        }
    }

    /// <summary>
    /// Veritabanı yoksa oluşturur. Oluşturma yetkisi yoksa açıklayıcı bir
    /// hata fırlatır; bu durumda veritabanının elle açılması gerekir.
    /// </summary>
    private void VeritabaniOlustur()
    {
        var kurucu = new SqlConnectionStringBuilder(_baglanti);
        var vtAdi = kurucu.InitialCatalog;
        kurucu.InitialCatalog = "master";

        using var db = new SqlConnection(kurucu.ConnectionString);

        try
        {
            db.Open();
        }
        catch (SqlException hata)
        {
            throw new InvalidOperationException(
                $"SQL Server'a bağlanılamadı ({kurucu.DataSource}). " +
                "appsettings.json içindeki bağlantı cümlesini kontrol ediniz. " +
                $"Sunucu mesajı: {hata.Message}", hata);
        }

        var varMi = db.ExecuteScalar<int>(
            "SELECT CASE WHEN DB_ID(@ad) IS NULL THEN 0 ELSE 1 END", new { ad = vtAdi });

        if (varMi == 1) return;

        try
        {
            db.Execute(@"
DECLARE @sql NVARCHAR(200) = N'CREATE DATABASE [' + @ad + N']';
EXEC sp_executesql @sql;", new { ad = vtAdi });
        }
        catch (SqlException hata) when (hata.Number is 262 or 229 or 15247)
        {
            throw new InvalidOperationException(
                $"'{vtAdi}' veritabanı bulunamadı ve oluşturma yetkiniz yok.\r\n" +
                "Çözüm: SQL Server Management Studio'yu yönetici yetkili bir hesapla " +
                "açıp proje klasöründeki 'kurulum.sql' dosyasını çalıştırınız. " +
                "Ardından API'yi yeniden başlatınız.", hata);
        }
    }

    /// <summary>
    /// Sonradan eklenen kolonları mevcut kurulumlara da uygular.
    /// Her açılışta güvenle çalışır.
    /// </summary>
    private static void SurumGuncelle(IDbConnection db)
    {
        db.Execute(@"
IF COL_LENGTH('KRY_BASVURULAR', 'il') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD il NVARCHAR(60) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'ilce') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD ilce NVARCHAR(80) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'mahalle') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD mahalle NVARCHAR(120) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'kaynak') IS NULL
    /* Adayın başvuruya nasıl yöneldiği: mağaza karekodu, ilan sitesi,
       tanıdık önerisi gibi. Seçenekler panelden yönetiliyor ve sütun
       ayrı tutuluyor: veri_json içinde saklansaydı raporlarda
       gruplanamazdı. */
    ALTER TABLE KRY_BASVURULAR ADD kaynak NVARCHAR(120) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'kaynak_detay') IS NULL
    /* 'Diğer' seçildiğinde adayın yazdığı açıklama */
    ALTER TABLE KRY_BASVURULAR ADD kaynak_detay NVARCHAR(300) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'ise_giris_tarihi') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD ise_giris_tarihi DATETIME2 NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'ise_giris_bolum') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD ise_giris_bolum NVARCHAR(120) NULL;

-- Pozisyonun açıldıktan kaç gün sonra doldurulduğu
IF COL_LENGTH('KRY_BASVURULAR', 'doldurma_gun') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD doldurma_gun INT NULL;

-- Personel takip notları.
-- Oryantasyon, 2. ay, 6. ay ve 1. yıl görüşmelerinde İK'nın aldığı notlar.
IF OBJECT_ID('KRY_PERSONEL_TAKIP') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_TAKIP (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        kimlik_no     NVARCHAR(20)  NULL,
        ad_soyad      NVARCHAR(120) NULL,
        donem         NVARCHAR(30)  NOT NULL,
        durum         NVARCHAR(30)  NOT NULL DEFAULT(N'Görüşüldü'),
        not_metni     NVARCHAR(MAX) NULL,
        kullanici     NVARCHAR(60)  NULL,
        tarih         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_PERSONEL_TAKIP_kod
        ON KRY_PERSONEL_TAKIP(personel_kodu, donem);
END

-- Norm kadro değişiklik geçmişi.
-- Geriye dönük raporlarda o tarihte geçerli olan norm kullanılabilsin diye
-- her değişiklik tarihiyle saklanır.
IF OBJECT_ID('KRY_KADRO_GECMIS') IS NULL
BEGIN
    CREATE TABLE KRY_KADRO_GECMIS (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        sube_kodu    NVARCHAR(30)  NULL,
        sube_adi     NVARCHAR(120) NULL,
        bolum        NVARCHAR(120) NOT NULL,
        eski_norm    DECIMAL(7,1)  NULL,
        yeni_norm    DECIMAL(7,1)  NOT NULL,
        eski_mevcut  DECIMAL(7,1)  NULL,
        yeni_mevcut  DECIMAL(7,1)  NULL,
        gecerli_tarih DATE         NOT NULL,
        kullanici    NVARCHAR(60)  NULL,
        olusturma    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_KADRO_GECMIS_tarih
        ON KRY_KADRO_GECMIS(sube_kodu, gecerli_tarih);
END

-- Onay kayıtları.
-- İşe alım, norm kadro değişikliği ve rotasyon için ortak tablodur;
-- her kaydın türü ve özeti tutulur, böylece onay neyle ilgili olduğu bellidir.
IF OBJECT_ID('KRY_ONAY') IS NULL
BEGIN
    CREATE TABLE KRY_ONAY (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        tur          NVARCHAR(30)  NOT NULL,
        baslik       NVARCHAR(200) NOT NULL,
        ozet         NVARCHAR(900) NULL,
        veri_json    NVARCHAR(MAX) NULL,
        basvuru_id   INT           NULL,
        sube_kodu    NVARCHAR(30)  NULL,
        sube_adi     NVARCHAR(120) NULL,
        durum        NVARCHAR(20)  NOT NULL DEFAULT(N'Bekliyor'),
        isteyen      NVARCHAR(60)  NULL,
        istek_tarihi DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        onaylayan    NVARCHAR(60)  NULL,
        onay_tarihi  DATETIME2     NULL,
        onay_notu    NVARCHAR(500) NULL
    );

    CREATE INDEX IX_KRY_ONAY_durum ON KRY_ONAY(durum, istek_tarihi);
END

-- İsteği gönderen kişi sonucu gördü mü
IF COL_LENGTH('KRY_ONAY', 'bildirim_okundu') IS NULL
    ALTER TABLE KRY_ONAY ADD bildirim_okundu BIT NOT NULL DEFAULT(0);

-- Başvuru fotoğraflarının özeti.
-- Aynı fotoğrafın farklı kimliklerle tekrar gönderilmesi otomatik
-- gönderimin en belirgin işaretidir; bu tablo tekrarları yakalar.
IF COL_LENGTH('KRY_BASVURULAR', 'fotograf_ozeti') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD fotograf_ozeti NVARCHAR(64) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_KRY_BASVURULAR_fotograf')
    CREATE INDEX IX_KRY_BASVURULAR_fotograf
        ON KRY_BASVURULAR(fotograf_ozeti);

-- İK referansları.
-- Adayın formda yazdığı referanslardan ayrıdır: bunlar görüşme sırasında
-- İK tarafından alınan ve aranan referanslardır.
IF OBJECT_ID('KRY_REFERANS') IS NULL
BEGIN
    CREATE TABLE KRY_REFERANS (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        basvuru_id     INT           NOT NULL,
        ad_soyad       NVARCHAR(120) NOT NULL,
        calistigi_yer  NVARCHAR(160) NULL,
        gorev          NVARCHAR(120) NULL,
        telefon        NVARCHAR(30)  NULL,
        yakinlik       NVARCHAR(80)  NULL,

        /* Referans görüşmesi */
        gorusuldu_mu   BIT           NOT NULL DEFAULT(0),
        gorusme_tarihi DATETIME2     NULL,
        gorusme_sonucu NVARCHAR(30)  NULL,
        gorusme_notu   NVARCHAR(MAX) NULL,
        /* 1-10 arası; 5'in altı başvuruyu otomatik olumsuza çeker */
        puan           TINYINT       NULL,

        kullanici      NVARCHAR(60)  NULL,
        olusturma      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        guncelleme     DATETIME2     NULL
    );

    CREATE INDEX IX_KRY_REFERANS_basvuru ON KRY_REFERANS(basvuru_id);
END

-- Mikro'ya yazılan personel fotoğraflarının yedeği.
-- Mikro üretim veritabanıdır; yazma öncesi eski hâl burada saklanır ve
-- gerektiğinde geri alınabilir. Yedek kendi veritabanımızda tutulur, yani
-- Mikro'da bir sorun çıksa bile kayıt kaybolmaz.
IF OBJECT_ID('KRY_RESIM_YEDEK') IS NULL
BEGIN
    CREATE TABLE KRY_RESIM_YEDEK (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu  NVARCHAR(30)  NULL,
        personel_adi   NVARCHAR(120) NULL,
        kayit_guid     UNIQUEIDENTIFIER NULL,

        /* İşlem türü: EKLEME (kayıt yoktu) veya DEGISTIRME (üzerine yazıldı) */
        islem          NVARCHAR(20)  NOT NULL,

        /* Yazmadan önceki hâl; kayıt yoksa NULL */
        eski_veri      VARBINARY(MAX) NULL,
        yeni_veri      VARBINARY(MAX) NULL,

        /* Hangi kolona yazıldığı; Mikro sürümüne göre değişebilir */
        kolon_adi      NVARCHAR(80)  NULL,

        /* Geri alındı mı */
        geri_alindi    BIT           NOT NULL DEFAULT(0),
        geri_alma_tarihi DATETIME2   NULL,

        kullanici      NVARCHAR(60)  NULL,
        olusturma      DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_RESIM_YEDEK_kod ON KRY_RESIM_YEDEK(personel_kodu);
END

-- Form parmak izi: dolgu alanlarının birleşiminden üretilir.
-- Otomatik gönderimler aynı sabit değerleri kullandığı için (aynı adres,
-- kan grubu, eğitim, işe başlama tarihi) bu izler tekrar eder.
IF COL_LENGTH('KRY_BASVURULAR', 'form_izi') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD form_izi NVARCHAR(64) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_BASVURULAR_izi')
    CREATE INDEX IX_KRY_BASVURULAR_izi ON KRY_BASVURULAR(form_izi);

-- Liste sorgularinin veri_json'a dokunmamasi icin ozetlenen bayraklar.
-- veri_json fotografin base64'unu tasidigi icin satir basina yuzlerce KB;
-- havuz ve liste sorgulari her satirda REPLACE(veri_json) LIKE ... ile bu
-- LOB'u tarayinca dakikalar suruyor ve zaman asimina dusuyordu. Bayraklar
-- kayit girisinde doldurulur, eski kayitlar arka planda parti parti
-- tamamlanir (BasvuruBayrakGorevi). NULL = henuz hesaplanmadi.
IF COL_LENGTH('KRY_BASVURULAR', 'engel_var') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD engel_var BIT NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'fotograf_var') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD fotograf_var BIT NULL;


-- Organizasyon şeması.
-- Her satır bir kutudur; ust_id ile bağlanır. Ünvan adı Mikro'daki ünvanla
-- eşleştirilerek o kutunun altındaki personel bulunur.
IF OBJECT_ID('KRY_ORGANIZASYON') IS NULL
BEGIN
    CREATE TABLE KRY_ORGANIZASYON (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        ust_id    INT           NULL,
        unvan     NVARCHAR(120) NOT NULL,

        /* Kutu rengi: yesil, mavi, turuncu, kirmizi, mor, gri, bej */
        renk      NVARCHAR(20)  NOT NULL DEFAULT('gri'),

        /* Aynı seviyedeki sıralama */
        sira      INT           NOT NULL DEFAULT(0),

        /* Mağaza pozisyonu mu; bu kutular her mağazada tekrar eder */
        magaza_mi BIT           NOT NULL DEFAULT(0),

        aciklama  NVARCHAR(300) NULL,
        aktif     BIT           NOT NULL DEFAULT(1),
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_ORGANIZASYON_ust ON KRY_ORGANIZASYON(ust_id, sira);
END

-- İzin onayı: bu kutudaki kişi, altındaki kutulardaki personelin yıllık
-- izin talebini onaylar mı. Yıllık izin, talep edenin kutusundan yukarı
-- çıkılarak ilk onaylayan kutuya (birim yöneticisi), sonra bir üstündeki
-- onaylayan kutuya (üst yönetici) gidiyor. Kurul kutuları onay zincirine
-- girmesin diye sütun açılırken kapatılıyor.
IF COL_LENGTH('KRY_ORGANIZASYON', 'izin_onay') IS NULL
BEGIN
    ALTER TABLE KRY_ORGANIZASYON ADD izin_onay BIT NOT NULL DEFAULT(1);

    EXEC('UPDATE KRY_ORGANIZASYON SET izin_onay = 0
          WHERE unvan IN (N''Yönetim Kurulu'', N''Yönetim Kurulu Başkanı'',
                          N''Danışma Kurulu'', N''İcra Kurulu Başkanı'')');
END

-- Biçen Kart eşleşmesi: hangi kart hangi personelde.
-- Eşleşme eskiden POS tarafındaki telefon alanından çıkarılıyordu; o alan
-- başka süreçlerce değiştirildiğinde kartlar panelde tanımsız görünüyordu.
-- Artık panelden yapılan tanım burada duruyor; POS ve Genius3 yalnızca
-- yazılan taraf.
IF OBJECT_ID('KRY_KART_ESLESME') IS NULL
BEGIN
    CREATE TABLE KRY_KART_ESLESME (
        kart_no       NVARCHAR(50)  NOT NULL PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        eslestiren    NVARCHAR(100) NULL,
        eslesme       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_KART_ESLESME_personel ON KRY_KART_ESLESME(personel_kodu);
END

-- Biçen Kart eşleşme geçmişi (06.10.2026): kart tanımlama, değiştirme,
-- kaldırma. Personel kartında daha önce hangi kart vardı sorusunun
-- cevabı; KRY_KART_ESLESME yalnızca güncel durumu tutuyor.
IF OBJECT_ID('KRY_KART_ESLESME_GECMIS') IS NULL
BEGIN
    CREATE TABLE KRY_KART_ESLESME_GECMIS (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        kart_no       NVARCHAR(50)  NOT NULL,
        islem         NVARCHAR(20)  NOT NULL,
        aciklama      NVARCHAR(300) NULL,
        yapan         NVARCHAR(100) NULL,
        tarih         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_KART_ESLESME_GECMIS_personel ON KRY_KART_ESLESME_GECMIS(personel_kodu, tarih DESC);
END

-- Biçen Kart hareket bildirimleri (29.09.2026): bildirimi gönderilen ya
-- da panelden yazıldığı için ayrıca bildirilmeyecek PuanHareket satırları.
-- PuanHareket kimliği GUID; sırası olmadığı için son kimlik tutulamıyor.
IF OBJECT_ID('KRY_KART_BILDIRILEN') IS NULL
BEGIN
    CREATE TABLE KRY_KART_BILDIRILEN (
        hareket_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        tarih      DATETIME2        NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_KART_BILDIRILEN_tarih ON KRY_KART_BILDIRILEN(tarih);
END

IF OBJECT_ID('KRY_KART_BILDIRIM_DURUM') IS NULL
    CREATE TABLE KRY_KART_BILDIRIM_DURUM (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        baslangic  DATETIME2 NOT NULL
    );

-- Biçen Kart puan yükleme talepleri (29.09.2026). Yükleme önce talep
-- olarak kaydedilir; Admin onaylayınca PuanHareket'e yazılır.
IF OBJECT_ID('KRY_PUAN_TALEP') IS NULL
BEGIN
    CREATE TABLE KRY_PUAN_TALEP (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        tur           NVARCHAR(10)   NOT NULL,          -- tek | toplu
        aciklama      NVARCHAR(300)  NOT NULL,
        dosya_adi     NVARCHAR(200)  NULL,
        son_kullanim  DATE           NOT NULL,
        kart_sayisi   INT            NOT NULL,
        toplam_puan   DECIMAL(18,2)  NOT NULL,
        durum         NVARCHAR(20)   NOT NULL DEFAULT N'bekliyor', -- bekliyor | isleniyor | onaylandi | reddedildi
        talep_eden    NVARCHAR(60)   NOT NULL,
        talep_eden_ad NVARCHAR(120)  NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        karar_veren   NVARCHAR(60)   NULL,
        karar_veren_ad NVARCHAR(120) NULL,
        karar_tarihi  DATETIME2      NULL,
        red_sebebi    NVARCHAR(500)  NULL,
        hata          NVARCHAR(1000) NULL,
        eposta        NVARCHAR(300)  NULL
    );

    CREATE INDEX IX_KRY_PUAN_TALEP_durum ON KRY_PUAN_TALEP(durum, olusturma DESC);
END

IF OBJECT_ID('KRY_PUAN_TALEP_SATIR') IS NULL
BEGIN
    CREATE TABLE KRY_PUAN_TALEP_SATIR (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        talep_id    INT            NOT NULL,
        kart_no     NVARCHAR(50)   NOT NULL,
        sicil       NVARCHAR(30)   NULL,
        ad_soyad    NVARCHAR(120)  NULL,
        sube        NVARCHAR(120)  NULL,
        puan        DECIMAL(18,2)  NOT NULL
    );

    CREATE INDEX IX_KRY_PUAN_TALEP_SATIR_talep ON KRY_PUAN_TALEP_SATIR(talep_id);
END

-- Kartlara yapılan puan işlemleri: onaylanan yükleme, transfer, silme.
-- PuanHareket'te kimin yaptığı yok; panelde kart geçmişi buradan.
IF OBJECT_ID('KRY_PUAN_ISLEM') IS NULL
BEGIN
    CREATE TABLE KRY_PUAN_ISLEM (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        tur         NVARCHAR(20)   NOT NULL,            -- yukleme | transfer | silme
        kart_no     NVARCHAR(50)   NOT NULL,
        hedef_kart  NVARCHAR(50)   NULL,
        puan        DECIMAL(18,2)  NOT NULL,
        aciklama    NVARCHAR(500)  NULL,
        talep_id    INT            NULL,
        yapan       NVARCHAR(60)   NOT NULL,
        yapan_ad    NVARCHAR(120)  NULL,
        tarih       DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_PUAN_ISLEM_kart ON KRY_PUAN_ISLEM(kart_no, tarih DESC);
    CREATE INDEX IX_KRY_PUAN_ISLEM_hedef ON KRY_PUAN_ISLEM(hedef_kart, tarih DESC);
END

-- İzin türleri: adı, bakiyeden düşüp düşmediği ve süre biçimi.
-- Eskiden yalnızca ayarlardaki düz bir ad listesi vardı; yarım gün ve
-- saatlik izin yıllık izin talebinin içinde bir seçenekti ve bakiyeden
-- düşüyordu. Artık her biri kendi türü: yıllık izinden düşmüyor.
IF OBJECT_ID('KRY_IZIN_TURU') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_TURU (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        ad              NVARCHAR(80)  NOT NULL,
        bakiyeden_duser BIT           NOT NULL DEFAULT 0,

        /* tam | yarim | saat — talep ekranında hangi süre biçimi sorulur */
        sure_turu       NVARCHAR(10)  NOT NULL DEFAULT N'tam',
        aciklama        NVARCHAR(200) NULL,
        sira            INT           NOT NULL DEFAULT 0,
        aktif           BIT           NOT NULL DEFAULT 1,
        guncelleyen     NVARCHAR(100) NULL,
        guncelleme      DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    INSERT INTO KRY_IZIN_TURU (ad, bakiyeden_duser, sure_turu, aciklama, sira) VALUES
        (N'Yıllık İzin',     1, N'tam',   N'Yıllık izin bakiyesinden düşer', 10),
        (N'Yarım Gün İzin',  0, N'yarim', N'Bakiyeden düşmez',               20),
        (N'Saatlik İzin',    0, N'saat',  N'Bakiyeden düşmez',               30),
        (N'Ücretsiz İzin',   0, N'tam',   N'Bakiyeden düşmez',               40),
        (N'Mazeret İzni',    0, N'tam',   N'Bakiyeden düşmez',               50);
END

-- Vardiya şablonları: saatleri İK paneli belirliyor, mağaza müdürü
-- yalnızca hangi gün hangi vardiya olduğunu seçiyor. Saatler serbest
-- yazılsaydı her mağaza başka bir düzen kurar, dinlenme süresi denetimi
-- de yapılamazdı.
IF OBJECT_ID('KRY_VARDIYA_SABLON') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_SABLON (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        ad          NVARCHAR(60)  NOT NULL,
        baslangic   TIME          NOT NULL,
        bitis       TIME          NOT NULL,
        renk        NVARCHAR(20)  NOT NULL DEFAULT N'mavi',
        sira        INT           NOT NULL DEFAULT 0,
        aktif       BIT           NOT NULL DEFAULT 1,
        guncelleyen NVARCHAR(100) NULL,
        guncelleme  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    INSERT INTO KRY_VARDIYA_SABLON (ad, baslangic, bitis, renk, sira) VALUES
        (N'Sabahçı', '08:00', '16:00', N'mavi',   10),
        (N'Aracı',   '11:00', '19:00', N'sari',   20),
        (N'Akşamcı', '14:00', '22:00', N'mor',    30);
END

-- Haftalık vardiya planı: kişi + gün. Şablon boşsa tür izin ya da boş.
IF OBJECT_ID('KRY_VARDIYA_PLAN') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_PLAN (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30) NOT NULL,
        gun           DATE         NOT NULL,
        hafta         DATE         NOT NULL,
        sablon_id     INT          NULL,
        tur           NVARCHAR(10) NOT NULL DEFAULT N'vardiya',
        guncelleyen   NVARCHAR(100) NULL,
        guncelleme    DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_KRY_VARDIYA_PLAN UNIQUE (personel_kodu, gun)
    );

    CREATE INDEX IX_KRY_VARDIYA_PLAN_hafta ON KRY_VARDIYA_PLAN(hafta, personel_kodu);
END

-- Haftanın onay durumu: taslak → bekliyor → onay / red.
-- Red sebebi personelden geliyor; müdür günü değiştirip yeniden
-- gönderdiğinde sürüm artıyor.
IF OBJECT_ID('KRY_VARDIYA_PLAN_DURUM') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_PLAN_DURUM (
        personel_kodu NVARCHAR(30)  NOT NULL,
        hafta         DATE          NOT NULL,
        durum         NVARCHAR(10)  NOT NULL DEFAULT N'taslak',
        surum         INT           NOT NULL DEFAULT 0,
        red_neden     NVARCHAR(500) NULL,
        gonderen      NVARCHAR(150) NULL,
        gonderme      DATETIME2     NULL,
        karar         DATETIME2     NULL,
        CONSTRAINT PK_KRY_VARDIYA_PLAN_DURUM PRIMARY KEY (personel_kodu, hafta)
    );
END

-- Tek gün için ret: personel bütün haftayı değil belirli bir günü
-- reddedebiliyor; müdür hangi günün sorun olduğunu görüyor.
IF OBJECT_ID('KRY_VARDIYA_PLAN_DURUM') IS NOT NULL
   AND COL_LENGTH('KRY_VARDIYA_PLAN_DURUM', 'red_gun') IS NULL
    ALTER TABLE KRY_VARDIYA_PLAN_DURUM ADD red_gun DATE NULL;

-- Vardiya türlerinde saat tutulmuyor (28.09.2026): her mağazanın açılış
-- kapanış saati farklı. Tür sınıfı (sabah/aksam/araci/diger) dinlenme
-- uyarısı için tutuluyor. Eski saat kolonları veri kaybı olmasın diye
-- kalıyor, artık okunmuyor.
IF OBJECT_ID('KRY_VARDIYA_SABLON') IS NOT NULL
   AND COL_LENGTH('KRY_VARDIYA_SABLON', 'tip') IS NULL
BEGIN
    ALTER TABLE KRY_VARDIYA_SABLON ADD tip NVARCHAR(10) NULL;
END

IF OBJECT_ID('KRY_VARDIYA_SABLON') IS NOT NULL
   AND COL_LENGTH('KRY_VARDIYA_SABLON', 'baslangic') IS NOT NULL
BEGIN
    DECLARE @sablonKisit SYSNAME, @sablonKomut NVARCHAR(500);

    SELECT @sablonKisit = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('KRY_VARDIYA_SABLON') AND c.name = 'baslangic';

    IF @sablonKisit IS NOT NULL
    BEGIN
        SET @sablonKomut = 'ALTER TABLE KRY_VARDIYA_SABLON DROP CONSTRAINT ' + QUOTENAME(@sablonKisit);
        EXEC sp_executesql @sablonKomut;
    END

    ALTER TABLE KRY_VARDIYA_SABLON ALTER COLUMN baslangic TIME NULL;
END

IF OBJECT_ID('KRY_VARDIYA_SABLON') IS NOT NULL
   AND COL_LENGTH('KRY_VARDIYA_SABLON', 'bitis') IS NOT NULL
BEGIN
    DECLARE @sablonKisit2 SYSNAME, @sablonKomut2 NVARCHAR(500);

    SELECT @sablonKisit2 = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('KRY_VARDIYA_SABLON') AND c.name = 'bitis';

    IF @sablonKisit2 IS NOT NULL
    BEGIN
        SET @sablonKomut2 = 'ALTER TABLE KRY_VARDIYA_SABLON DROP CONSTRAINT ' + QUOTENAME(@sablonKisit2);
        EXEC sp_executesql @sablonKomut2;
    END

    ALTER TABLE KRY_VARDIYA_SABLON ALTER COLUMN bitis TIME NULL;
END

-- Haftalık izin için özel durum bildirimi (28.09.2026): personel yalnızca
-- yöneticinin verdiği izin gününe itiraz edebiliyor; yönetici kabul
-- ederse izin günü taşınıyor.
IF OBJECT_ID('KRY_VARDIYA_OZEL_DURUM') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_OZEL_DURUM (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        hafta         DATE          NOT NULL,
        izin_gun      DATE          NOT NULL,
        talep_gun     DATE          NULL,
        aciklama      NVARCHAR(500) NOT NULL,
        durum         NVARCHAR(10)  NOT NULL DEFAULT N'bekliyor',  -- bekliyor · kabul · red
        karar_veren   NVARCHAR(150) NULL,
        karar_notu    NVARCHAR(500) NULL,
        karar_tarihi  DATETIME2     NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_VARDIYA_OZEL_DURUM ON KRY_VARDIYA_OZEL_DURUM(personel_kodu, hafta, durum);
END

-- Süreç geçmişi: gönderildi, değiştirildi, özel durum.
IF OBJECT_ID('KRY_VARDIYA_PLAN_LOG') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_PLAN_LOG (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        hafta         DATE          NOT NULL,
        olay          NVARCHAR(200) NOT NULL,
        aciklama      NVARCHAR(500) NULL,
        yapan         NVARCHAR(150) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_VARDIYA_PLAN_LOG ON KRY_VARDIYA_PLAN_LOG(personel_kodu, hafta, id);
END

-- Performans ölçütlerinin son bilinen durumu (aldı / almadı / az kaldı).
-- Bildirim yalnızca durum değişince gidiyor; aynı değişiklik ikinci kez
-- bildirilmiyor. Dönem başına ayrı: yeni ayın ilk hesabı bildirim
-- göndermeden yalnızca durumu kaydediyor.
IF OBJECT_ID('KRY_PERFORMANS_DURUM') IS NULL
BEGIN
    CREATE TABLE KRY_PERFORMANS_DURUM (
        personel_kodu NVARCHAR(30)  NOT NULL,
        yil           INT           NOT NULL,
        ay            INT           NOT NULL,
        olcut         NVARCHAR(60)  NOT NULL,
        durum         NVARCHAR(10)  NOT NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_PERFORMANS_DURUM PRIMARY KEY (personel_kodu, yil, ay, olcut)
    );
END

-- Yıllık izin onay tablosu: iş yeri + pozisyon → 1. onaylayan.
-- İK'nın hazırladığı tablodan (POZİSYON YETKİ). 2. onay her zaman İnsan
-- Kaynakları. onay1_sicil doluysa onaylayan belirli bir kişi (aynı
-- ünvanda birden çok genel müdür yardımcısı var).
IF OBJECT_ID('KRY_IZIN_ONAY_KURAL') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_ONAY_KURAL (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        is_yeri      NVARCHAR(100)  NOT NULL,
        pozisyon     NVARCHAR(150)  NOT NULL,
        onay1        NVARCHAR(150)  NOT NULL,
        onay1_sicil  NVARCHAR(30)   NULL,
        aktif        BIT            NOT NULL DEFAULT(1),
        guncelleyen  NVARCHAR(100)  NULL,
        guncelleme   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Şemadaki kutu konumları: serbest tuvalde elle yerleştirme.
-- Boşsa kutu otomatik düzende çiziliyor; hepsi doluysa tuval düzeni.
IF COL_LENGTH('KRY_ORGANIZASYON', 'konum_x') IS NULL
    ALTER TABLE KRY_ORGANIZASYON ADD konum_x INT NULL;
IF COL_LENGTH('KRY_ORGANIZASYON', 'konum_y') IS NULL
    ALTER TABLE KRY_ORGANIZASYON ADD konum_y INT NULL;
IF COL_LENGTH('KRY_ORGANIZASYON', 'genislik') IS NULL
    ALTER TABLE KRY_ORGANIZASYON ADD genislik INT NULL;

-- Ünvan eşleştirmeleri.
-- Mikro'daki ünvan adı şemadaki kutu adıyla birebir aynı olmayabilir.
-- Otomatik eşleşmeyen ünvanlar buradan elle bağlanır.
IF OBJECT_ID('KRY_ORG_ESLESME') IS NULL
BEGIN
    CREATE TABLE KRY_ORG_ESLESME (
        id        INT IDENTITY(1,1) PRIMARY KEY,

        /* Mikro'daki ünvan adı, olduğu gibi */
        unvan     NVARCHAR(160) NOT NULL,

        /* Bağlandığı kutu; NULL ise bilerek eşleştirilmemiş demektir */
        kutu_id   INT           NULL,

        kullanici NVARCHAR(60)  NULL,
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_ORG_ESLESME_unvan ON KRY_ORG_ESLESME(unvan);
END

-- İzin verilen e-posta alan adları.
-- Bu listede kayıt varsa YALNIZCA buradaki alanlardan başvuru kabul edilir;
-- liste boşsa kısıt uygulanmaz ve engelli alan listesi geçerli olur.
IF OBJECT_ID('KRY_IZINLI_ALAN') IS NULL
BEGIN
    CREATE TABLE KRY_IZINLI_ALAN (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        alan      NVARCHAR(160) NOT NULL,
        aciklama  NVARCHAR(200) NULL,
        aktif     BIT           NOT NULL DEFAULT(1),
        ekleyen   NVARCHAR(60)  NULL,
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_IZINLI_ALAN_alan ON KRY_IZINLI_ALAN(alan);
END

-- Engellenen e-posta alan adları.
-- Panelden yönetilir; appsettings'teki liste başlangıç değeri olarak
-- aktarılır. Alt alan adları da kapsanır.
IF OBJECT_ID('KRY_ENGELLI_ALAN') IS NULL
BEGIN
    CREATE TABLE KRY_ENGELLI_ALAN (
        id        INT IDENTITY(1,1) PRIMARY KEY,

        /* protonmail.com biçiminde; başındaki @ kaydedilirken atılır */
        alan      NVARCHAR(160) NOT NULL,

        sebep     NVARCHAR(200) NULL,

        /* Kaç kez engellendiği; işe yarayıp yaramadığını görmek için */
        engelleme INT           NOT NULL DEFAULT(0),
        son_deneme DATETIME2    NULL,

        aktif     BIT           NOT NULL DEFAULT(1),
        ekleyen   NVARCHAR(60)  NULL,
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_ENGELLI_ALAN_alan
        ON KRY_ENGELLI_ALAN(alan);
END

-- Telefon doğrulama kodları.
-- Başvuru gönderilmeden önce adaya SMS ile kod gönderilir; doğrulanmadan
-- form kaydedilmez. Otomatik gönderimlerin her başvuru için gerçek bir
-- telefon hattına erişmesi gerekir.
IF OBJECT_ID('KRY_TELEFON_DOGRULAMA') IS NULL
BEGIN
    CREATE TABLE KRY_TELEFON_DOGRULAMA (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        telefon      NVARCHAR(20)  NOT NULL,

        /* Altı haneli kod */
        kod          NVARCHAR(10)  NOT NULL,

        /* Doğrulama sonrası verilen jeton; başvuruda bu jeton beklenir */
        jeton        NVARCHAR(64)  NULL,

        gecerlilik   DATETIME2     NOT NULL,
        dogrulandi   BIT           NOT NULL DEFAULT(0),
        dogrulanma   DATETIME2     NULL,

        /* Yanlış kod denemesi; belli sayıdan sonra kod geçersiz olur */
        deneme       INT           NOT NULL DEFAULT(0),

        /* Bu jetonla başvuru gönderildi mi; her kod tek başvuru içindir */
        kullanildi   BIT           NOT NULL DEFAULT(0),

        gonderen_ip  NVARCHAR(60)  NULL,
        olusturma    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_TELEFON_DOGRULAMA_telefon
        ON KRY_TELEFON_DOGRULAMA(telefon, id DESC);

    CREATE INDEX IX_KRY_TELEFON_DOGRULAMA_jeton
        ON KRY_TELEFON_DOGRULAMA(jeton);
END

-- Eski e-posta doğrulama tablosu artık kullanılmıyor ama geçmiş kayıtlar
-- için silinmez; yeni kurulumlarda hiç oluşmaz.
IF OBJECT_ID('KRY_EPOSTA_DOGRULAMA') IS NULL
BEGIN
    CREATE TABLE KRY_EPOSTA_DOGRULAMA (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        eposta       NVARCHAR(160) NULL,
        kod          NVARCHAR(10)  NULL,
        jeton        NVARCHAR(64)  NULL,
        gecerlilik   DATETIME2     NULL,
        dogrulandi   BIT           NOT NULL DEFAULT(0),
        dogrulanma   DATETIME2     NULL,
        deneme       INT           NOT NULL DEFAULT(0),
        kullanildi   BIT           NOT NULL DEFAULT(0),
        gonderen_ip  NVARCHAR(60)  NULL,
        olusturma    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Sistem durum bilgileri.
-- Arka plan görevlerinin son çalışma zamanı gibi değerler burada tutulur;
-- bellekte tutulursa uygulama yeniden başladığında kaybolur.
IF OBJECT_ID('KRY_SISTEM_DURUM') IS NULL
BEGIN
    CREATE TABLE KRY_SISTEM_DURUM (
        anahtar   NVARCHAR(60) PRIMARY KEY,
        deger     DATETIME2    NULL,
        metin     NVARCHAR(400) NULL,
        guncelleme DATETIME2   NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Yapay zekânın reddettiği başvurular.
-- Kayıt silinmez, buraya alınır: yanlış bir ret olursa panelden incelenip
-- gerçek başvurulara aktarılabilir.
IF OBJECT_ID('KRY_AI_ENGELLENEN') IS NULL
BEGIN
    CREATE TABLE KRY_AI_ENGELLENEN (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        basvuru_no    NVARCHAR(40)  NULL,
        ad_soyad      NVARCHAR(120) NULL,
        kimlik_no     NVARCHAR(20)  NULL,
        telefon       NVARCHAR(30)  NULL,
        eposta        NVARCHAR(120) NULL,
        sube_kodu     NVARCHAR(30)  NULL,
        sube_adi      NVARCHAR(120) NULL,
        bolumler      NVARCHAR(400) NULL,
        il            NVARCHAR(60)  NULL,
        ilce          NVARCHAR(60)  NULL,
        mahalle       NVARCHAR(120) NULL,
        birim_turu    NVARCHAR(60)  NULL,

        /* Başvurunun tamamı; aktarım için gerekir */
        veri_json     NVARCHAR(MAX) NULL,

        /* Yapay zekânın kararı */
        ai_sonuc      NVARCHAR(30)  NULL,
        ai_gerekce    NVARCHAR(500) NULL,
        ai_guven      INT           NULL,

        gonderen_ip   NVARCHAR(60)  NULL,
        tarayici      NVARCHAR(400) NULL,
        fotograf_ozeti NVARCHAR(64) NULL,
        form_izi      NVARCHAR(64)  NULL,

        /* Panelden incelendi mi */
        incelendi     BIT           NOT NULL DEFAULT(0),
        aktarildi     BIT           NOT NULL DEFAULT(0),
        aktarilan_id  INT           NULL,
        inceleyen     NVARCHAR(60)  NULL,
        inceleme_tarihi DATETIME2   NULL,

        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_AI_ENGELLENEN_durum
        ON KRY_AI_ENGELLENEN(incelendi, id DESC);
END

-- Görülen tüm fotoğraf ve şablon izleri.
-- Başvuru kaydından bağımsızdır: kayıt silinse de iz kalır. Denetim bu
-- tabloya bakar, KRY_BASVURULAR'a değil; böylece silme, NULL kimlik ve
-- biçim farkı gibi durumlardan etkilenmez.
IF OBJECT_ID('KRY_IZ_GECMIS') IS NULL
BEGIN
    CREATE TABLE KRY_IZ_GECMIS (
        id        INT IDENTITY(1,1) PRIMARY KEY,

        /* FOTOGRAF veya SABLON */
        tur       NVARCHAR(20) NOT NULL,
        iz        NVARCHAR(64) NOT NULL,

        /* Bu izle başvuran kimlik numarası */
        kimlik_no NVARCHAR(20) NOT NULL,

        olusturma DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );

    /* Aynı kimlik aynı izle tekrar başvurursa tek satır kalır */
    CREATE UNIQUE INDEX IX_KRY_IZ_GECMIS_tekil
        ON KRY_IZ_GECMIS(tur, iz, kimlik_no);
END

-- Engellenen parmak izleri.
-- Fotoğraf özeti ve form şablonu başvuru kaydından ayrı tutulur; sahte
-- başvurular silinse bile iz kalır ve aynı kalıp tekrar kullanılamaz.
IF OBJECT_ID('KRY_IZ_KARA_LISTE') IS NULL
BEGIN
    CREATE TABLE KRY_IZ_KARA_LISTE (
        id         INT IDENTITY(1,1) PRIMARY KEY,

        /* FOTOGRAF veya SABLON */
        tur        NVARCHAR(20)  NOT NULL,
        iz         NVARCHAR(64)  NOT NULL,

        /* Kaç kez karşılaşıldığı; ısrarlı kalıpları görmek için */
        gorulme    INT           NOT NULL DEFAULT(1),
        son_gorulme DATETIME2    NULL,

        sebep      NVARCHAR(200) NULL,
        ekleyen    NVARCHAR(60)  NULL,
        olusturma  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_IZ_KARA_LISTE_iz
        ON KRY_IZ_KARA_LISTE(tur, iz);
END

-- Engellenen IP adresleri
IF OBJECT_ID('KRY_KARA_LISTE') IS NULL
BEGIN
    CREATE TABLE KRY_KARA_LISTE (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        ip          NVARCHAR(60)  NOT NULL,
        sebep       NVARCHAR(300) NULL,
        ekleyen     NVARCHAR(60)  NULL,
        olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        aktif       BIT           NOT NULL DEFAULT(1)
    );

    CREATE UNIQUE INDEX IX_KRY_KARA_LISTE_ip ON KRY_KARA_LISTE(ip);
END

-- Yönetici tarafından bildirilen adres
IF NOT EXISTS (SELECT 1 FROM KRY_KARA_LISTE WHERE ip = '24.133.13.148')
    INSERT INTO KRY_KARA_LISTE (ip, sebep, ekleyen)
    VALUES ('24.133.13.148', N'Yönetici tarafından engellendi', N'sistem');

-- Aynı pozisyon ve şube için mükerrer kadro satırları temizlenir.
-- Bu satırlar raporlarda toplama girdiği için norm sayıları yanlış çıkıyordu.
-- En eski kayıt korunur, diğerleri silinir.
IF EXISTS (
    SELECT 1 FROM KRY_KADRO
    GROUP BY bolum, ISNULL(sube_kodu, '')
    HAVING COUNT(*) > 1
)
BEGIN
    ;WITH sirali AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY bolum, ISNULL(sube_kodu, '')
                   ORDER BY id
               ) AS sira
        FROM KRY_KADRO
    )
    DELETE FROM KRY_KADRO
    WHERE id IN (SELECT id FROM sirali WHERE sira > 1);
END

-- İşe alım onayı verebilen kullanıcılar
IF COL_LENGTH('KRY_KULLANICILAR', 'onay_yetkisi') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD onay_yetkisi BIT NOT NULL DEFAULT(0);

-- İşe alım onay bilgileri
IF COL_LENGTH('KRY_BASVURULAR', 'onay_durumu') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD onay_durumu NVARCHAR(30) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'onaylayan') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD onaylayan NVARCHAR(60) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'onay_tarihi') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD onay_tarihi DATETIME2 NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'onay_notu') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD onay_notu NVARCHAR(500) NULL;

-- Başvurunun hangi adresten ve hangi tarayıcıyla geldiği.
-- Kötüye kullanım incelemesi için gereklidir.
IF COL_LENGTH('KRY_BASVURULAR', 'gonderen_ip') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD gonderen_ip NVARCHAR(60) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'tarayici') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD tarayici NVARCHAR(300) NULL;

-- Pozisyonun doldurulma süresi dakika cinsinden (gün çözünürlüğü yetersizdi)
IF COL_LENGTH('KRY_BASVURULAR', 'doldurma_dakika') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD doldurma_dakika INT NULL;

-- İşe alım sırasında anlaşılan ücret bilgileri
IF COL_LENGTH('KRY_BASVURULAR', 'anlasilan_ucret') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD anlasilan_ucret DECIMAL(12,2) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'yol_ucreti') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD yol_ucreti DECIMAL(12,2) NULL;

IF COL_LENGTH('KRY_KADRO', 'engelli') IS NULL
    ALTER TABLE KRY_KADRO ADD engelli DECIMAL(7,1) NULL;

IF COL_LENGTH('KRY_KADRO', 'fazla_baslangic') IS NULL
    ALTER TABLE KRY_KADRO ADD fazla_baslangic DATETIME2 NULL;



IF COL_LENGTH('KRY_KADRO', 'eksik_baslangic') IS NULL
    ALTER TABLE KRY_KADRO ADD eksik_baslangic DATETIME2 NULL;

IF COL_LENGTH('KRY_KADRO', 'norm') IS NULL
    ALTER TABLE KRY_KADRO ADD norm DECIMAL(7,1) NULL;

IF COL_LENGTH('KRY_KADRO', 'mevcut') IS NULL
    ALTER TABLE KRY_KADRO ADD mevcut DECIMAL(7,1) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'test_kaydi') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD test_kaydi BIT NOT NULL
        CONSTRAINT DF_KRY_BASVURULAR_TEST DEFAULT 0;

IF COL_LENGTH('KRY_BASVURULAR', 'birim_turu') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD birim_turu NVARCHAR(60) NULL;

IF COL_LENGTH('KRY_KULLANICILAR', 'telefon') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD telefon NVARCHAR(25) NULL;

IF COL_LENGTH('KRY_KULLANICILAR', 'bolge') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD bolge NVARCHAR(500) NULL;

-- Birden fazla bölge atanabilmesi için alan genişletilir
IF COL_LENGTH('KRY_KULLANICILAR', 'bolge') < 1000
    ALTER TABLE KRY_KULLANICILAR ALTER COLUMN bolge NVARCHAR(500) NULL;

IF COL_LENGTH('KRY_KULLANICILAR', 'subeler') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD subeler NVARCHAR(1000) NULL;

IF COL_LENGTH('KRY_KULLANICILAR', 'unvan') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD unvan NVARCHAR(100) NULL;

-- Mikro kullanıcı numarası (09.10.2026): İK uzmanının panelden Mikro'ya
-- yazdığı sicil kartı ve değişiklikler kendi Mikro kullanıcısıyla işlenir.
IF COL_LENGTH('KRY_KULLANICILAR', 'mikro_kullanici_no') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD mikro_kullanici_no INT NULL;

-- İşe Al ekranından Mikro'da sicil kartı açma isteği (09.10.2026).
-- veri_json kart açılınca silinir (IBAN, ücret kuyrukta kalmaz).
IF OBJECT_ID('KRY_MIKRO_SICIL') IS NULL
    CREATE TABLE KRY_MIKRO_SICIL (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        basvuru_id          INT            NOT NULL,
        durum               NVARCHAR(20)   NOT NULL,
        veri_json           NVARCHAR(MAX)  NULL,
        isteyen             NVARCHAR(100)  NULL,
        mikro_kullanici_no  INT            NULL,
        per_kod             NVARCHAR(30)   NULL,
        hata                NVARCHAR(1000) NULL,
        deneme              INT            NOT NULL DEFAULT 0,
        son_deneyen         NVARCHAR(150)  NULL,
        olusturma           DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        acilma              DATETIME2      NULL,
        guncelleme          DATETIME2      NULL
    );
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_MIKRO_SICIL_BASVURU')
    CREATE INDEX IX_KRY_MIKRO_SICIL_BASVURU ON KRY_MIKRO_SICIL (basvuru_id, id);

-- Portaldan açılan kullanıcılar: personel bağlantısı, İK paneli erişimi
-- ve şube kilidi. İK erişimi varsayılan açık: mevcut kullanıcıların
-- hiçbiri bu sütun yüzünden panelden düşmemeli.
IF COL_LENGTH('KRY_KULLANICILAR', 'sicil') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD sicil NVARCHAR(30) NULL;
IF COL_LENGTH('KRY_KULLANICILAR', 'ik_erisim') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD ik_erisim BIT NOT NULL DEFAULT(1);
IF COL_LENGTH('KRY_KULLANICILAR', 'depo_no') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD depo_no INT NULL;
IF COL_LENGTH('KRY_KULLANICILAR', 'sube_kodu') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD sube_kodu NVARCHAR(150) NULL;

-- Referans görüşmesi 1-10 arası puanlanabilir. 5'in altı otomatik
-- olumsuz kararına çekilir (bkz. BasvuruController.ReferansKaydet).
IF COL_LENGTH('KRY_REFERANS', 'puan') IS NULL
    ALTER TABLE KRY_REFERANS ADD puan TINYINT NULL;

-- Yönetim panelinden TXT ile yüklenen doğrulama kodu havuzu.
-- SMS yalnızca buradaki kodlarla gönderilir; gönderilen kod silinir.
IF OBJECT_ID('KRY_KOD_HAVUZU') IS NULL
BEGIN
    CREATE TABLE KRY_KOD_HAVUZU (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        kod        NVARCHAR(20)  NOT NULL,
        olusturma  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        yukleyen   NVARCHAR(60)  NULL
    );

    CREATE UNIQUE INDEX UX_KRY_KOD_HAVUZU_kod ON KRY_KOD_HAVUZU(kod);
END

-- Doğrulamanın kod havuzundan gelip gelmediği. Havuz sistemine geçmeden
-- önce sistemin kendi ürettiği kodlarla yapılmış doğrulamalar 0 kalır ve
-- başvuruda kabul edilmez.
IF COL_LENGTH('KRY_TELEFON_DOGRULAMA', 'havuz') IS NULL
    ALTER TABLE KRY_TELEFON_DOGRULAMA ADD havuz BIT NOT NULL DEFAULT(0);

-- Kullanıcıya özel bildirimler. Onay/red sonucu gibi olaylar buraya yazılır;
-- panel bunları düzenli aralıkla okuyup ekranda gösterir ve bildirim
-- sayfasında listeler.
IF OBJECT_ID('KRY_BILDIRIM') IS NULL
BEGIN
    CREATE TABLE KRY_BILDIRIM (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        kullanici   NVARCHAR(60)  NOT NULL,
        tur         NVARCHAR(30)  NOT NULL,
        baslik      NVARCHAR(200) NOT NULL,
        metin       NVARCHAR(900) NULL,
        basvuru_id  INT           NULL,
        okundu      BIT           NOT NULL DEFAULT(0),
        gosterildi  BIT           NOT NULL DEFAULT(0),
        olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_BILDIRIM_kullanici
        ON KRY_BILDIRIM(kullanici, okundu, olusturma DESC);
END

-- Personel belgeleri: tutanak, ihtar, savunma, sözleşme gibi evraklar.
-- Dosyanın kendisi diskte durur, tabloda yalnızca künyesi tutulur; ikili
-- veriyi tabloya koymak yedek boyutunu hızla şişiriyordu.
--
-- Kayıt personel koduyla değil kimlik numarasıyla da eşleşir: bir personel
-- işten ayrılıp geri döndüğünde Mikro yeni bir personel kodu veriyor ve
-- eski tutanakları kartında görünmez oluyordu.
IF OBJECT_ID('KRY_PERSONEL_BELGE') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_BELGE (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu  NVARCHAR(30)   NOT NULL,
        kimlik_no      NVARCHAR(25)   NULL,
        ad_soyad       NVARCHAR(150)  NULL,
        tur            NVARCHAR(40)   NOT NULL DEFAULT N'Diğer',
        baslik         NVARCHAR(200)  NOT NULL,
        aciklama       NVARCHAR(MAX)  NULL,
        dosya          NVARCHAR(200)  NOT NULL,   /* diskteki ad          */
        ozgun_ad       NVARCHAR(260)  NULL,       /* kullanıcının adı     */
        boyut          BIGINT         NOT NULL DEFAULT(0),
        yukleyen       NVARCHAR(60)   NULL,
        olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        /* Personelin kendi uygulamasında görünsün mü. Varsayılan kapalı:
           tutanak ve ihtar gibi evrakların tamamının personele açılması
           İK'nın kararı olmalı, yükleme anının varsayılanı değil. */
        personele_acik BIT            NOT NULL DEFAULT(0),

        silindi        BIT            NOT NULL DEFAULT(0),
        silen          NVARCHAR(60)   NULL,
        silme_tarihi   DATETIME2      NULL
    );

    CREATE INDEX IX_KRY_PERSONEL_BELGE_kod
        ON KRY_PERSONEL_BELGE(personel_kodu, silindi, olusturma DESC);

    CREATE INDEX IX_KRY_PERSONEL_BELGE_kimlik
        ON KRY_PERSONEL_BELGE(kimlik_no, silindi);
END

-- Belgenin personele gösterilip gösterilmeyeceği. Tutanak ve ihtar gibi
-- evrakların hepsi personele açılmamalı; hangisini göreceğini İK seçiyor.
-- Varsayılan kapalı: yanlışlıkla açılan bir tutanağı geri almak, hiç
-- açılmamış olmasından daha zor.
IF COL_LENGTH('KRY_PERSONEL_BELGE', 'personele_acik') IS NULL
    ALTER TABLE KRY_PERSONEL_BELGE ADD personele_acik BIT NOT NULL DEFAULT(0);

-- Resmi tatiller. Yıllık izin gün sayısı hesaplanırken bu günler
-- düşülmüyor: 1 Mayıs'a denk gelen bir izin haftası personelin
-- bakiyesinden bir gün fazla yiyordu.
--
-- Dinî bayramların tarihi her yıl kaydığı için liste elle giriliyor;
-- sabit tarihli millî bayramlar kurulumda bir kez yazılıyor.
IF OBJECT_ID('KRY_RESMI_TATIL') IS NULL
BEGIN
    CREATE TABLE KRY_RESMI_TATIL (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        tarih     DATE          NOT NULL,
        ad        NVARCHAR(120) NOT NULL,

        /* Arife günleri yarım gün; izin hesabında 0,5 düşülüyor */
        yarim_gun BIT           NOT NULL DEFAULT(0),

        aktif     BIT           NOT NULL DEFAULT(1),
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_RESMI_TATIL_tarih ON KRY_RESMI_TATIL(tarih);
END

-- Pozisyon grupları: ünvanların ortak çalışma düzenine göre kümelenmesi.
--
-- Mağaza personeli haftada bir gün, merkez ofis cumartesi ve pazar izinli.
-- Bu ayrım hiçbir yerde tutulmadığı için izin hesabı herkesi aynı
-- sayıyordu ve haftalık izin günleri de yıllık izinden düşüyordu.
--
-- Aynı gruplar ileride yetki tanımında da kullanılacak: ünvan ünvan yetki
-- vermek yerine grup adına verilecek.
IF OBJECT_ID('KRY_POZISYON_GRUBU') IS NULL
BEGIN
    CREATE TABLE KRY_POZISYON_GRUBU (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        ad            NVARCHAR(80)   NOT NULL,
        aciklama      NVARCHAR(300)  NULL,

        /* Virgülle ayrılmış ünvan adları; Mikro'daki ünvanla eşleşir */
        pozisyonlar   NVARCHAR(MAX)  NULL,

        /* Haftada kaç gün izin kullanıldığı (bilgi amaçlı) */
        haftalik_izin INT            NOT NULL DEFAULT(1),

        /* Haftanın hangi günleri izinli: 0=Pazar … 6=Cumartesi,
           virgülle. Boşsa sabit bir izin günü yok demektir. */
        izin_gunleri  NVARCHAR(30)   NULL,

        aktif         BIT            NOT NULL DEFAULT(1),
        sira          INT            NOT NULL DEFAULT(0),
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_POZISYON_GRUBU_ad ON KRY_POZISYON_GRUBU(ad);
END

-- Eğitim dokümanları. İK ve Bilgi Teknolojileri personele video, belge ya
-- da bağlantı paylaşıyor; şu ana kadar bunlar WhatsApp gruplarında
-- dolaşıyordu ve yeni gelen personel hiçbirini görmüyordu.
--
-- Hedef pozisyon boşsa herkese açık; doluysa yalnızca o ünvanlardakiler
-- görüyor. Kasiyere depo eğitimi göstermek listeyi kullanışsız yapıyordu.
IF OBJECT_ID('KRY_EGITIM') IS NULL
BEGIN
    CREATE TABLE KRY_EGITIM (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        baslik       NVARCHAR(200)  NOT NULL,
        aciklama     NVARCHAR(MAX)  NULL,

        -- video · belge · baglanti
        tur          NVARCHAR(20)   NOT NULL DEFAULT N'belge',

        -- Yükleyen bölüm: Insan Kaynaklari, Bilgi Teknolojileri, ...
        bolum        NVARCHAR(80)   NULL,

        -- Dosya yüklendiyse diskteki adı; bağlantıysa adres
        dosya        NVARCHAR(200)  NULL,
        ozgun_ad     NVARCHAR(260)  NULL,
        boyut        BIGINT         NOT NULL DEFAULT(0),
        adres        NVARCHAR(500)  NULL,

        -- Virgülle ayrılmış ünvanlar; boşsa tüm pozisyonlar
        pozisyonlar  NVARCHAR(MAX)  NULL,

        zorunlu      BIT            NOT NULL DEFAULT(0),
        aktif        BIT            NOT NULL DEFAULT(1),
        sira         INT            NOT NULL DEFAULT(0),

        yukleyen     NVARCHAR(60)   NULL,
        olusturma    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_EGITIM_aktif ON KRY_EGITIM(aktif, sira);
END

-- Personelin hangi eğitimi açtığı. Zorunlu eğitimlerde kimin izlediğini
-- görmek gerekiyor; 'paylaştık' ile 'okundu' ayrı şeyler.
IF OBJECT_ID('KRY_EGITIM_OKUMA') IS NULL
BEGIN
    CREATE TABLE KRY_EGITIM_OKUMA (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        egitim_id     INT          NOT NULL,
        personel_kodu NVARCHAR(30) NOT NULL,
        ad_soyad      NVARCHAR(150) NULL,
        olusturma     DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_EGITIM_OKUMA_tekil
        ON KRY_EGITIM_OKUMA(egitim_id, personel_kodu);
END

-- Etik hat bildirimleri.
--
-- Personel yolsuzluk, mobbing, taciz gibi konuları bildiriyor. Anonim
-- bildirimde personel kodu tabloya hiç yazılmıyor: sütunu doldurup
-- ekranda gizlemek, veritabanına erişimi olan herkes için anonimliği
-- ortadan kaldırırdı. Bildiren kişi kaydını takip numarasıyla izliyor.
IF OBJECT_ID('KRY_ETIK') IS NULL
BEGIN
    CREATE TABLE KRY_ETIK (
        id            INT IDENTITY(1,1) PRIMARY KEY,

        -- ETH-2026-000184 biçiminde; personele verilen takip numarası
        numara        NVARCHAR(20)   NOT NULL,

        tur           NVARCHAR(80)   NOT NULL,
        yer           NVARCHAR(40)   NULL,
        sube_adi      NVARCHAR(150)  NULL,
        olay_tarihi   DATE           NULL,
        aciklama      NVARCHAR(MAX)  NOT NULL,

        anonim        BIT            NOT NULL DEFAULT(1),

        -- Anonim bildirimde NULL kalır; ekranda gizlenmez, hiç yazılmaz
        personel_kodu NVARCHAR(30)   NULL,
        ad_soyad      NVARCHAR(150)  NULL,
        telefon       NVARCHAR(20)   NULL,

        -- alindi · inceleniyor · ek_bilgi · sonuclandi · kapandi
        durum         NVARCHAR(20)   NOT NULL DEFAULT N'alindi',

        inceleyen     NVARCHAR(150)  NULL,
        sonuc         NVARCHAR(MAX)  NULL,

        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_ETIK_numara ON KRY_ETIK(numara);
    CREATE INDEX IX_KRY_ETIK_durum ON KRY_ETIK(durum, olusturma DESC);
END

-- Bildirime eklenen dosyalar
IF OBJECT_ID('KRY_ETIK_EK') IS NULL
BEGIN
    CREATE TABLE KRY_ETIK_EK (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        etik_id    INT            NOT NULL,
        dosya      NVARCHAR(200)  NOT NULL,
        ozgun_ad   NVARCHAR(260)  NULL,
        boyut      BIGINT         NOT NULL DEFAULT(0),
        olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_ETIK_EK_kayit ON KRY_ETIK_EK(etik_id);
END

-- Bildirimin işlem geçmişi: durum değişiklikleri ve yazışma. Anonim
-- bildirimde de personel ek bilgi yazabiliyor; kimlik yine yazılmıyor.
IF OBJECT_ID('KRY_ETIK_HAREKET') IS NULL
BEGIN
    CREATE TABLE KRY_ETIK_HAREKET (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        etik_id    INT            NOT NULL,
        durum      NVARCHAR(20)   NULL,
        metin      NVARCHAR(MAX)  NULL,

        -- true ise bildirimi yapan yazdı; false ise etik kurul
        bildiren   BIT            NOT NULL DEFAULT(0),

        yapan      NVARCHAR(150)  NULL,
        gorunur    BIT            NOT NULL DEFAULT(1),
        olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_ETIK_HAREKET_kayit ON KRY_ETIK_HAREKET(etik_id, olusturma);
END

-- Ücret pusulaları. Her ay personele ayrı ayrı yükleniyor; personel mobil
-- uygulamadan açıp onaylıyor ya da itiraz ediyor.
--
-- Onay bir imza yerine geçtiği için zamanı ve nasıl onaylandığı kayda
-- yazılıyor: elle onay ile süre dolduğu için otomatik onaylanan pusula
-- sonradan ayırt edilebilmeli.
IF OBJECT_ID('KRY_PUSULA') IS NULL
BEGIN
    CREATE TABLE KRY_PUSULA (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu  NVARCHAR(30)   NOT NULL,
        kimlik_no      NVARCHAR(25)   NULL,
        ad_soyad       NVARCHAR(150)  NULL,

        /* 'yyyy-MM' — sıralama ve tekillik bunun üzerinden */
        donem          NVARCHAR(7)    NOT NULL,

        dosya          NVARCHAR(200)  NOT NULL,
        ozgun_ad       NVARCHAR(260)  NULL,
        boyut          BIGINT         NOT NULL DEFAULT(0),

        /* bekliyor · onaylandi · itiraz */
        durum          NVARCHAR(20)   NOT NULL DEFAULT N'bekliyor',

        /* Süre dolduğu için mi onaylandı, personel mi onayladı */
        otomatik       BIT            NOT NULL DEFAULT(0),

        son_gun        DATE           NULL,   /* bu tarihten sonra otomatik */
        goruntuleme    DATETIME2      NULL,   /* ilk açtığı an              */
        onay_tarihi    DATETIME2      NULL,
        itiraz_sebebi  NVARCHAR(100)  NULL,
        itiraz_metni   NVARCHAR(MAX)  NULL,
        itiraz_tarihi  DATETIME2      NULL,
        itiraz_yanit   NVARCHAR(MAX)  NULL,   /* İK'nın dönüşü             */

        yukleyen       NVARCHAR(60)   NULL,
        olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        silindi        BIT            NOT NULL DEFAULT(0)
    );

    CREATE INDEX IX_KRY_PUSULA_personel
        ON KRY_PUSULA(personel_kodu, silindi, donem DESC);

    CREATE INDEX IX_KRY_PUSULA_donem
        ON KRY_PUSULA(donem, durum);
END

-- Mesai saatleri ve vardiya hatırlatması sonradan eklendi.
IF COL_LENGTH('KRY_POZISYON_GRUBU', 'mesai_baslangic') IS NULL
    ALTER TABLE KRY_POZISYON_GRUBU ADD mesai_baslangic NVARCHAR(5) NULL;

IF COL_LENGTH('KRY_POZISYON_GRUBU', 'mesai_bitis') IS NULL
    ALTER TABLE KRY_POZISYON_GRUBU ADD mesai_bitis NVARCHAR(5) NULL;

-- Mesai başlangıcından kaç dakika sonra hatırlatılacağı. Saatinde
-- gönderilen bir hatırlatma, yolda olan personeli de rahatsız ediyordu.
-- Personel haftalık izin gününü kendisi seçebilir mi. Merkez ofisin izin
-- günü sabit (cumartesi, pazar); orada seçim ekranı çıkması personeli
-- olmayan bir hakka yönlendiriyordu.
IF COL_LENGTH('KRY_POZISYON_GRUBU', 'izin_secebilir') IS NULL
    ALTER TABLE KRY_POZISYON_GRUBU ADD izin_secebilir BIT NOT NULL DEFAULT(0);

-- Mobil uygulamadan iş emri atayabilir mi. Ayar dosyasına ünvan listesi
-- yazmak yerine burada: yetki zaten gruplarla yönetiliyor ve sunucudaki
-- dosyayı elle düzenlemek her kurulumda tekrar eden bir iş çıkarıyordu.
IF COL_LENGTH('KRY_POZISYON_GRUBU', 'is_atayabilir') IS NULL
    ALTER TABLE KRY_POZISYON_GRUBU ADD is_atayabilir BIT NOT NULL DEFAULT(0);

IF COL_LENGTH('KRY_POZISYON_GRUBU', 'hatirlatma_dakika') IS NULL
    ALTER TABLE KRY_POZISYON_GRUBU ADD hatirlatma_dakika INT NOT NULL DEFAULT(30);

-- Gönderilen vardiya hatırlatmaları; aynı gün ikinci kez gönderilmesin.
IF OBJECT_ID('KRY_VARDIYA_HATIRLATMA') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_HATIRLATMA (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30) NOT NULL,
        gun           DATE         NOT NULL,
        olusturma     DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_VARDIYA_HATIRLATMA_tekil
        ON KRY_VARDIYA_HATIRLATMA(personel_kodu, gun);
END

-- Sabit saatli vardiya hatırlatması: aynı gün iki hatırlatma (08:40 ve
-- 13:10) olduğu için tekrar denetimi saate göre yapılıyor. Tablo bu
-- satırın hemen üstünde açılıyor; sütun sırası bu yüzden burada.
IF OBJECT_ID('KRY_VARDIYA_HATIRLATMA') IS NOT NULL
   AND COL_LENGTH('KRY_VARDIYA_HATIRLATMA', 'saat') IS NULL
    ALTER TABLE KRY_VARDIYA_HATIRLATMA ADD saat NVARCHAR(5) NULL;

-- Eski tekillik (kişi + gün) günde ikinci hatırlatmayı engelliyordu;
-- yerine kişi + gün + saat. Dizin EXEC ile: yeni sütun aynı toplu
-- işte derlenirken henüz görünmüyor.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_VARDIYA_HATIRLATMA_tekil')
    DROP INDEX IX_KRY_VARDIYA_HATIRLATMA_tekil ON KRY_VARDIYA_HATIRLATMA;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_VARDIYA_HATIRLATMA_saat')
    EXEC('CREATE UNIQUE INDEX IX_KRY_VARDIYA_HATIRLATMA_saat
          ON KRY_VARDIYA_HATIRLATMA(personel_kodu, gun, saat)');

-- Personelin haftalık izin günü.
--
-- Mağaza personeli haftada bir gün izin kullanıyor ama hangi gün olduğu
-- hiçbir yerde tutulmuyordu: o gün karekod okutmayan personel raporda
-- 'okutmadı' diye görünüyordu. Personel günü kendisi seçiyor, mağaza
-- müdürü onaylıyor; onaylanmadan geçerli olmuyor.
--
-- Kişi başına tek satır: geçerli gün ile bekleyen talep aynı kayıtta
-- duruyor. Talep geçmişi ayrı tabloya alınmadı, çünkü İK'nın ihtiyacı
-- 'şu an hangi gün' ile 'bir talep bekliyor mu' sorularından ibaret.
IF OBJECT_ID('KRY_HAFTALIK_IZIN') IS NULL
BEGIN
    CREATE TABLE KRY_HAFTALIK_IZIN (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(150) NULL,
        sube_adi      NVARCHAR(150) NULL,
        pozisyon      NVARCHAR(120) NULL,

        /* Onaylanmış gün: 0=Pazar … 6=Cumartesi. NULL ise henüz yok. */
        gun           INT           NULL,

        /* Onay bekleyen değişiklik talebi */
        talep_gun     INT           NULL,
        talep_tarihi  DATETIME2     NULL,
        talep_notu    NVARCHAR(300) NULL,

        /* bekliyor · onaylandi · reddedildi */
        durum         NVARCHAR(20)  NOT NULL DEFAULT N'bekliyor',

        onay_tarihi   DATETIME2     NULL,
        onaylayan     NVARCHAR(150) NULL,
        red_sebebi    NVARCHAR(300) NULL,

        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_HAFTALIK_IZIN_personel
        ON KRY_HAFTALIK_IZIN(personel_kodu);
END

-- Gönderilen 'izin gününüz değişti mi' uyarıları; aynı gün tekrarlanmasın.
IF OBJECT_ID('KRY_IZINGUN_UYARI') IS NULL
BEGIN
    CREATE TABLE KRY_IZINGUN_UYARI (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30) NOT NULL,
        gun           DATE         NOT NULL,
        olusturma     DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_IZINGUN_UYARI_tekil
        ON KRY_IZINGUN_UYARI(personel_kodu, gun);
END

-- Nöbet takvimi. Merkez ofis beş haftada bir cumartesi nöbet tutuyor;
-- sıra Excel'de takip ediliyordu ve kimin ne zaman tutacağı ancak dosyayı
-- açan kişi tarafından biliniyordu.
IF OBJECT_ID('KRY_NOBET') IS NULL
BEGIN
    CREATE TABLE KRY_NOBET (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        tarih         DATE          NOT NULL,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(150) NULL,
        pozisyon      NVARCHAR(120) NULL,
        grup_id       INT           NULL,
        aciklama      NVARCHAR(300) NULL,

        /* planli · tamamlandi · degisti */
        durum         NVARCHAR(20)  NOT NULL DEFAULT N'planli',

        olusturan     NVARCHAR(60)  NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_NOBET_tarih ON KRY_NOBET(tarih);

    /* Aynı güne aynı kişi iki kez yazılamaz */
    CREATE UNIQUE INDEX IX_KRY_NOBET_tekil ON KRY_NOBET(tarih, personel_kodu);
END

-- İş emri içeriği: tablo, kontrol listesi ve biçimli metin blokları.
--
-- Açıklama düz metindi; bir işi maddelere bölmek, hangi maddenin
-- yapıldığını takip etmek ya da sütunlu bir çizelge vermek mümkün
-- değildi. Bloklar JSON olarak tutuluyor: yapı işten işe değişiyor ve
-- her blok tipi için tablo açmak, yeni bir tip eklendiğinde göçe
-- zorluyordu.
IF COL_LENGTH('KRY_IS_EMRI', 'icerik') IS NULL
    ALTER TABLE KRY_IS_EMRI ADD icerik NVARCHAR(MAX) NULL;

-- Atanan kişinin doldurduğu değerler; özgün içerikten ayrı tutuluyor ki
-- iş atayan neyi verdiğini, atanan neyi doldurduğunu ayrı görebilsin.
IF COL_LENGTH('KRY_IS_EMRI', 'doldurma') IS NULL
    ALTER TABLE KRY_IS_EMRI ADD doldurma NVARCHAR(MAX) NULL;

-- İşaretlenen kutucukların oranı; listede ilerleme çubuğu için. Her
-- açılışta JSON ayrıştırmak yerine kaydetme anında hesaplanıyor.
IF COL_LENGTH('KRY_IS_EMRI', 'ilerleme') IS NULL
    ALTER TABLE KRY_IS_EMRI ADD ilerleme INT NOT NULL DEFAULT(0);

IF COL_LENGTH('KRY_IS_EMRI', 'doldurma_tarihi') IS NULL
    ALTER TABLE KRY_IS_EMRI ADD doldurma_tarihi DATETIME2 NULL;

-- İş şablonları. Aynı çizelge her hafta yeniden kuruluyordu; bir kez
-- hazırlanıp tekrar kullanılabilsin.
IF OBJECT_ID('KRY_IS_SABLON') IS NULL
BEGIN
    CREATE TABLE KRY_IS_SABLON (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        ad         NVARCHAR(150)  NOT NULL,
        aciklama   NVARCHAR(500)  NULL,
        icerik     NVARCHAR(MAX)  NULL,
        olusturan  NVARCHAR(60)   NULL,
        olusturma  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Belge görünürlüğü sonradan eklendi; var olan kurulumlarda sütun yok.
IF COL_LENGTH('KRY_PERSONEL_BELGE', 'personele_acik') IS NULL
    ALTER TABLE KRY_PERSONEL_BELGE ADD personele_acik BIT NOT NULL DEFAULT(0);

-- Çıkış tarihi yaklaşan personel için gönderilen uyarılar. Aynı kişi için
-- aynı çıkış tarihinde ikinci bir bildirim gönderilmesin diye tutulur;
-- görev günde birkaç kez çalışıyor ve İK uzmanının çanı aynı uyarıyla
-- doluyordu.
IF OBJECT_ID('KRY_AYRILIK_UYARI') IS NULL
BEGIN
    CREATE TABLE KRY_AYRILIK_UYARI (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu  NVARCHAR(30)  NOT NULL,
        cikis_tarihi   DATE          NOT NULL,
        kullanici      NVARCHAR(60)  NOT NULL,
        olusturma      DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX IX_KRY_AYRILIK_UYARI_tekil
        ON KRY_AYRILIK_UYARI(personel_kodu, cikis_tarihi, kullanici);
END

-- Arşivleme: başvuru silinmek yerine gizlenir. Kayıt korunur, gerektiğinde
-- geri alınabilir; silinen bir başvurunun nereye gittiği araştırılamıyordu.
IF COL_LENGTH('KRY_BASVURULAR', 'arsiv') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD arsiv BIT NOT NULL DEFAULT(0);

IF COL_LENGTH('KRY_BASVURULAR', 'arsiv_tarihi') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD arsiv_tarihi DATETIME2 NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'arsivleyen') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD arsivleyen NVARCHAR(60) NULL;

-- Çıkış mülakatları: işten ayrılan personelle yapılan görüşme kayıtları.
-- Sorular ve cevaplar JSON olarak tutulur; soru listesi Form Ayarları'ndan
-- değiştirilebildiği için sabit kolon yapısı kurulamaz.
IF OBJECT_ID('KRY_CIKIS_MULAKAT') IS NULL
BEGIN
    CREATE TABLE KRY_CIKIS_MULAKAT (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NULL,
        ad_soyad      NVARCHAR(120) NOT NULL,
        sube_adi      NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,
        giris_tarihi  DATE          NULL,
        cikis_tarihi  DATE          NULL,
        cikis_nedeni  NVARCHAR(80)  NULL,
        sorular_json  NVARCHAR(MAX) NULL,
        uzman_yorumu  NVARCHAR(MAX) NULL,
        kullanici     NVARCHAR(60)  NULL,
        uzman_adi     NVARCHAR(120) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_CIKIS_MULAKAT_tarih
        ON KRY_CIKIS_MULAKAT(olusturma DESC);
END

-- Eski cizelgelerden aktarilan mulakatlar icin ek alanlar.
-- Yonetici yorumu ve IK yorumu ayri tutulur: cizelgede iki ayri sutun
-- ve ikisi farkli bakis acilarini yansitiyor.
IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'yonetici_yorumu') IS NULL
    ALTER TABLE KRY_CIKIS_MULAKAT ADD yonetici_yorumu NVARCHAR(MAX) NULL;

IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'donem') IS NULL
    ALTER TABLE KRY_CIKIS_MULAKAT ADD donem NVARCHAR(40) NULL;

IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'kaynak') IS NULL
    ALTER TABLE KRY_CIKIS_MULAKAT ADD kaynak NVARCHAR(30) NULL;

-- Ayrılma nedeninin ana grubu (29.09.2026): yapay zekâ özetle birlikte
-- seçiyor, panelden elle değiştirilebiliyor. Boşsa panel anahtar kelimeyle
-- grupluyor.
IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'neden_grubu') IS NULL
    ALTER TABLE KRY_CIKIS_MULAKAT ADD neden_grubu NVARCHAR(60) NULL;

-- Cikis nedeni aciklamasi: neden Mikro'daki sabit listeden gelir, aciklama
-- ise uzmanin gorusmede ogrendigi ayrinti. Ikisi ayri tutulur ki rapor
-- nedene gore gruplayabilsin, ayrinti da kaybolmasin.
IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'cikis_nedeni_aciklama') IS NULL
    ALTER TABLE KRY_CIKIS_MULAKAT ADD cikis_nedeni_aciklama NVARCHAR(MAX) NULL;

-- Personel değişiklik izleme.
--
-- Mikro alan bazlı gecmis tutmuyor; yalnizca son degistiren bilgisi var.
-- Bu yüzden her okumada verinin anlık kopyası saklanır ve bir sonraki
-- okumada karşılaştırılır; değişen alanlar KRY_PERSONEL_DEGISIM'e yazılır.
-- Yillik izin: personelin kalan izin gunu ve izin kayitlari.
--
-- Bakiye Mikro'da tutulmuyor; sistem devreye girerken her personelin o
-- anki kalan gunu elle giriliyor, sonrasi burada isleniyor.
IF OBJECT_ID('KRY_IZIN_BAKIYE') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_BAKIYE (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        ad_soyad      NVARCHAR(120) NULL,

        /* Sisteme girilen baslangic bakiyesi. Yarim gunler icin ondalik. */
        baslangic     DECIMAL(6,1)  NOT NULL DEFAULT(0),
        baslangic_tarihi DATETIME2  NOT NULL DEFAULT SYSDATETIME(),
        giren         NVARCHAR(60)  NULL,
        aciklama      NVARCHAR(300) NULL,
        guncelleme    DATETIME2     NULL,
        guncelleyen   NVARCHAR(60)  NULL
    );
END

-- Bakiye iki bilesene ayrildi: bu donem hak edilen ve gecmis yillardan
-- devreden. Tek sayi tutuldugunda hangisinin nereden geldigi kayboluyordu.
IF COL_LENGTH('KRY_IZIN_BAKIYE', 'devir') IS NULL
    ALTER TABLE KRY_IZIN_BAKIYE ADD devir DECIMAL(6,1) NOT NULL DEFAULT(0);

-- Hak edis (kidem) tarihi duzeltmesi: ayrilip tekrar giren personelde
-- Mikro yalnizca son girisi bilir. Ilk giris + calisilmayan ara gunler
-- ya da elle yazilan tarih burada tutulur. ara_donemler JSON dizisi.
IF OBJECT_ID('KRY_IZIN_HAKEDIS') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_HAKEDIS (
        personel_kodu  NVARCHAR(30)  NOT NULL PRIMARY KEY,
        ad_soyad       NVARCHAR(120) NULL,
        hakedis_tarihi DATE          NOT NULL,
        ilk_giris      DATE          NULL,
        ara_donemler   NVARCHAR(MAX) NULL,
        aciklama       NVARCHAR(300) NULL,
        guncelleyen    NVARCHAR(60)  NULL,
        guncelleme     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Yil donumunde otomatik yillik izin hakki yuklemesi (05.10.2026):
-- her (personel, kidem yili) bir kez. Durum: yuklendi | atlandi (IK elle girmis).
IF OBJECT_ID('KRY_IZIN_HAK_YUKLEME') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_HAK_YUKLEME (
        personel_kodu    NVARCHAR(30)   NOT NULL,
        ad_soyad         NVARCHAR(120)  NULL,
        kidem_yili       INT            NOT NULL,
        yildonumu        DATE           NOT NULL,
        gun              DECIMAL(6,1)   NOT NULL,
        onceki_baslangic DECIMAL(6,1)   NULL,
        onceki_devir     DECIMAL(6,1)   NULL,
        yeni_baslangic   DECIMAL(6,1)   NULL,
        yeni_devir       DECIMAL(6,1)   NULL,
        durum            NVARCHAR(20)   NOT NULL,
        olusturma        DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_IZIN_HAK_YUKLEME PRIMARY KEY (personel_kodu, kidem_yili)
    );
END

-- Avans talepleri (06.10.2026): personel mobilden ister, IK tutar/taksit/
-- ilk kesintiyi degistirip onaylar; taksitler ayin kesinti gununde
-- bordrodan kesilir (tarih gecince kesildi sayilir).
IF OBJECT_ID('KRY_AVANS') IS NULL
BEGIN
    CREATE TABLE KRY_AVANS (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu    NVARCHAR(30)   NOT NULL,
        ad_soyad         NVARCHAR(120)  NULL,
        sube             NVARCHAR(150)  NULL,
        pozisyon         NVARCHAR(150)  NULL,
        tutar            DECIMAL(19,2)  NOT NULL,
        taksit           INT            NOT NULL,
        ilk_kesinti      DATE           NOT NULL,
        aciklama         NVARCHAR(500)  NULL,
        durum            NVARCHAR(20)   NOT NULL DEFAULT N'bekliyor',
        onay_tutar       DECIMAL(19,2)  NULL,
        onay_taksit      INT            NULL,
        onay_ilk_kesinti DATE           NULL,
        ik_notu          NVARCHAR(500)  NULL,
        karar_veren      NVARCHAR(120)  NULL,
        karar_tarihi     DATETIME2      NULL,
        odeme_tarihi     DATE           NULL,
        odeyen           NVARCHAR(120)  NULL,
        kaynak           NVARCHAR(20)   NOT NULL DEFAULT N'mobil',
        limit_asimi      BIT            NOT NULL DEFAULT 0,
        olusturma        DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme       DATETIME2      NULL
    );

    CREATE INDEX IX_KRY_AVANS_personel ON KRY_AVANS(personel_kodu, olusturma);
    CREATE INDEX IX_KRY_AVANS_durum ON KRY_AVANS(durum, olusturma);
END

-- Avans talep nedeni (07.10.2026): 1.6'da seçmek zorunlu, Diğer'de açıklama zorunlu
IF COL_LENGTH('KRY_AVANS', 'neden') IS NULL
    ALTER TABLE KRY_AVANS ADD neden NVARCHAR(60) NULL;

-- Rotasyon (şube değişikliği) talebi (07.10.2026): yönetici Biçen360'tan
-- açar, personel yalnızca görür. Yönetici isteğinde bölge müdürü, sonra İK.
IF OBJECT_ID('KRY_ROTASYON_TALEP') IS NULL
BEGIN
    CREATE TABLE KRY_ROTASYON_TALEP (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu   NVARCHAR(30)   NOT NULL,
        ad_soyad        NVARCHAR(120)  NULL,
        sube            NVARCHAR(150)  NULL,
        pozisyon        NVARCHAR(150)  NULL,
        tur             NVARCHAR(20)   NOT NULL,
        aciklama        NVARCHAR(1000) NOT NULL,
        hedefler        NVARCHAR(2000) NOT NULL,
        durum           NVARCHAR(20)   NOT NULL DEFAULT N'ik',
        talep_eden      NVARCHAR(30)   NULL,
        talep_eden_ad   NVARCHAR(120)  NULL,
        bolge_kodlari   NVARCHAR(300)  NULL,
        bolge_kisi      NVARCHAR(150)  NULL,
        bolge_karar     NVARCHAR(20)   NULL,
        bolge_not       NVARCHAR(500)  NULL,
        bolge_tarih     DATETIME2      NULL,
        ik_kisi         NVARCHAR(150)  NULL,
        ik_karar        NVARCHAR(20)   NULL,
        ik_not          NVARCHAR(500)  NULL,
        ik_tarih        DATETIME2      NULL,
        onaylanan_sube  NVARCHAR(150)  NULL,
        mikro_islendi   DATETIME2      NULL,
        mikro_not       NVARCHAR(200)  NULL,
        olusturma       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme      DATETIME2      NULL
    );

    CREATE INDEX IX_KRY_ROTASYON_TALEP_kod ON KRY_ROTASYON_TALEP(personel_kodu, olusturma);
    CREATE INDEX IX_KRY_ROTASYON_TALEP_durum ON KRY_ROTASYON_TALEP(durum, olusturma);
END

-- Avans onay akışı (07.10.2026): talebin bulunduğu adım (0 ilk) ve ara kararlar
IF COL_LENGTH('KRY_AVANS', 'asama') IS NULL
    ALTER TABLE KRY_AVANS ADD asama INT NULL;
IF COL_LENGTH('KRY_AVANS', 'ara_not') IS NULL
    ALTER TABLE KRY_AVANS ADD ara_not NVARCHAR(1000) NULL;

-- Avans onay tablosu (08.10.2026): iş yeri + pozisyon → sırayla onaylar
-- (adimlar: [{onay, sicil}] JSON). Talebe kendi zinciri yazılıyor.
IF COL_LENGTH('KRY_AVANS', 'zincir') IS NULL
    ALTER TABLE KRY_AVANS ADD zincir NVARCHAR(MAX) NULL;

IF OBJECT_ID('KRY_AVANS_ONAY_KURAL') IS NULL
BEGIN
    CREATE TABLE KRY_AVANS_ONAY_KURAL (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        is_yeri      NVARCHAR(100)  NOT NULL,
        pozisyon     NVARCHAR(150)  NOT NULL,
        adimlar      NVARCHAR(2000) NOT NULL,
        aktif        BIT            NOT NULL DEFAULT(1),
        guncelleyen  NVARCHAR(100)  NULL,
        guncelleme   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
END

IF OBJECT_ID('KRY_AVANS_TAKSIT') IS NULL
BEGIN
    CREATE TABLE KRY_AVANS_TAKSIT (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        avans_id  INT            NOT NULL,
        sira      INT            NOT NULL,
        tarih     DATE           NOT NULL,
        tutar     DECIMAL(19,2)  NOT NULL
    );

    CREATE INDEX IX_KRY_AVANS_TAKSIT ON KRY_AVANS_TAKSIT(avans_id, sira);
END

IF OBJECT_ID('KRY_AVANS_HAREKET') IS NULL
BEGIN
    CREATE TABLE KRY_AVANS_HAREKET (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        avans_id  INT            NOT NULL,
        olay      NVARCHAR(200)  NOT NULL,
        aciklama  NVARCHAR(500)  NULL,
        yapan     NVARCHAR(120)  NULL,
        zaman     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_AVANS_HAREKET ON KRY_AVANS_HAREKET(avans_id, id);
END

-- Avans belgesi (09.10.2026): nedene gore istenen belge (hastane belgesi,
-- fatura...). Belge gelene kadar talep durum = 'belge', onaya gitmiyor.
IF OBJECT_ID('KRY_AVANS_BELGE') IS NULL
BEGIN
    CREATE TABLE KRY_AVANS_BELGE (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        avans_id  INT            NOT NULL,
        tur       NVARCHAR(150)  NULL,
        dosya_adi NVARCHAR(200)  NULL,
        tip       NVARCHAR(100)  NOT NULL,
        boyut     INT            NOT NULL,
        icerik    VARBINARY(MAX) NOT NULL,
        yukleyen  NVARCHAR(120)  NULL,
        tarih     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_AVANS_BELGE ON KRY_AVANS_BELGE(avans_id, id);
END

-- Hangi kuralla yuklendi (06.10.2026: Is Kanunu md. 53 sureleri)
IF OBJECT_ID('KRY_IZIN_HAK_YUKLEME') IS NOT NULL
   AND COL_LENGTH('KRY_IZIN_HAK_YUKLEME', 'kural') IS NULL
    ALTER TABLE KRY_IZIN_HAK_YUKLEME ADD kural NVARCHAR(30) NULL;

-- Yillik izin maliyet raporu (05.10.2026): her ay, subenin kalan izin
-- yuku (kisi, kalan gun, net tutar). Ayin son hesabi kalir; gecmis aylar
-- rapordaki aylik sutunlari doldurur.
IF OBJECT_ID('KRY_IZIN_UCRET_ANLIK') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_UCRET_ANLIK (
        yil         INT            NOT NULL,
        ay          INT            NOT NULL,
        sube        NVARCHAR(150)  NOT NULL,
        kisi        INT            NOT NULL,
        gun         DECIMAL(10,1)  NOT NULL,
        tutar       DECIMAL(19,2)  NOT NULL,
        guncelleme  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_IZIN_UCRET_ANLIK PRIMARY KEY (yil, ay, sube)
    );
END

IF OBJECT_ID('KRY_IZIN') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,

        tur           NVARCHAR(40)  NOT NULL DEFAULT(N'Yıllık İzin'),

        cikis_tarihi  DATE          NOT NULL,
        donus_tarihi  DATE          NOT NULL,
        baslama_tarihi DATE         NULL,

        /* Yarim gun icin ondalik; tarih hesabi yarim gunu bilemez,
           kullanici elle degistirebilir. */
        gun           DECIMAL(6,1)  NOT NULL,
        yarim_gun     NVARCHAR(20)  NULL,

        aciklama      NVARCHAR(500) NULL,

        /* Bakiyeden dusen izinler: yillik disindakiler bakiyeyi etkilemez */
        bakiyeden_duser BIT         NOT NULL DEFAULT(1),

        durum         NVARCHAR(20)  NOT NULL DEFAULT(N'Onaylandı'),
        giren         NVARCHAR(60)  NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        iptal         BIT           NOT NULL DEFAULT(0)
    );

    CREATE INDEX IX_KRY_IZIN_personel ON KRY_IZIN(personel_kodu, cikis_tarihi DESC);
    CREATE INDEX IX_KRY_IZIN_tarih ON KRY_IZIN(cikis_tarihi, donus_tarihi);
END

-- Cizelgeden aktarilan kullanilmis izin, bakiyenin parcasi olarak tutulur.
-- Onceden sahte tarihli bir KRY_IZIN kaydi olusturuluyordu; cizelgede tek
-- tek tarihler bulunmadigi icin bu kayitlarin cikis/donus tarihi anlamsizdi
-- ve herkes ayni gun izne cikmis gibi gorunuyordu.
IF COL_LENGTH('KRY_IZIN_BAKIYE', 'aktarilan_kullanim') IS NULL
    ALTER TABLE KRY_IZIN_BAKIYE
        ADD aktarilan_kullanim DECIMAL(6,1) NOT NULL DEFAULT(0);

-- Eski sahte kayitlar bakiyeye tasinir ve silinir.
--
-- Dinamik SQL sart: SQL Server toplu betigi derleme aninda ayristirir ve
-- ustteki ALTER henuz calismadigi icin sutun adi taninmaz. EXEC ile ayri
-- bir toplu is olarak calistirildiginda sutun artik mevcuttur.
IF OBJECT_ID('KRY_IZIN') IS NOT NULL
   AND COL_LENGTH('KRY_IZIN_BAKIYE', 'aktarilan_kullanim') IS NOT NULL
BEGIN
    EXEC(N'
    UPDATE b
    SET b.aktarilan_kullanim = t.toplam
    FROM KRY_IZIN_BAKIYE b
    INNER JOIN (
        SELECT personel_kodu, SUM(gun) AS toplam
        FROM KRY_IZIN
        WHERE tur = N''Geçmiş Kullanım'' AND iptal = 0
        GROUP BY personel_kodu
    ) t ON t.personel_kodu = b.personel_kodu;

    DELETE FROM KRY_IZIN WHERE tur = N''Geçmiş Kullanım'';');
END

-- Saatlik izin: personel birkac saatligine cikip ayni gun donuyor.
-- Gun cinsinden takip anlamsiz oldugu icin saat alanlari ayri tutulur.
IF COL_LENGTH('KRY_IZIN', 'baslangic_saat') IS NULL
    ALTER TABLE KRY_IZIN ADD baslangic_saat NVARCHAR(5) NULL;

IF COL_LENGTH('KRY_IZIN', 'bitis_saat') IS NULL
    ALTER TABLE KRY_IZIN ADD bitis_saat NVARCHAR(5) NULL;

IF COL_LENGTH('KRY_IZIN', 'saat') IS NULL
    ALTER TABLE KRY_IZIN ADD saat DECIMAL(5,2) NULL;

-- ==========================================================================
-- Mobil uygulama
-- ==========================================================================

-- Giris kodlari. Kisa omurlu kayitlardir; eskiler duzenli temizlenir.
IF OBJECT_ID('KRY_MOBIL_KOD') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_KOD (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        kimlik_no     NVARCHAR(11)  NOT NULL,
        telefon       NVARCHAR(15)  NOT NULL,
        kod           NVARCHAR(6)   NOT NULL,
        personel_kodu NVARCHAR(30)  NULL,
        gecerlilik    DATETIME2     NOT NULL,
        kullanildi    BIT           NOT NULL DEFAULT(0),
        deneme        INT           NOT NULL DEFAULT(0),
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_MOBIL_KOD ON KRY_MOBIL_KOD(kimlik_no, kullanildi);
END

-- Bir haftadan eski kodlar tutulmaz
IF OBJECT_ID('KRY_MOBIL_KOD') IS NOT NULL
    DELETE FROM KRY_MOBIL_KOD
    WHERE olusturma < DATEADD(day, -7, SYSDATETIME());

-- Vardiya itirazlari. Okutmayi unutan personel duzeltme talep eder,
-- yoneticisi onaylar. Onaysiz duzeltme kabul edilmez: aksi halde
-- vardiya kaydinin bir anlami kalmaz.
IF OBJECT_ID('KRY_VARDIYA_ITIRAZ') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_ITIRAZ (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,

        tarih         DATE          NOT NULL,
        tur           NVARCHAR(10)  NOT NULL,
        saat          NVARCHAR(5)   NOT NULL,
        sebep         NVARCHAR(500) NOT NULL,

        durum         NVARCHAR(20)  NOT NULL DEFAULT(N'Bekliyor'),
        karar_veren   NVARCHAR(60)  NULL,
        karar_notu    NVARCHAR(500) NULL,
        karar_tarihi  DATETIME2     NULL,

        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        iptal         BIT           NOT NULL DEFAULT(0)
    );

    CREATE INDEX IX_KRY_VARDIYA_ITIRAZ
        ON KRY_VARDIYA_ITIRAZ(durum, olusturma DESC);
END

-- Bildirim jetonlari: telefona anlik bildirim gonderebilmek icin.
IF OBJECT_ID('KRY_MOBIL_JETON') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_JETON (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        jeton         NVARCHAR(200) NOT NULL,
        isletim       NVARCHAR(20)  NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Is emirleri. Yonetici bir isi bir kisiye atar; atanan kisi paneldeki
-- ya da mobil uygulamadaki ekraninda gorur, bitirdiginde aciklama yazar
-- ve atayan kisiye bildirim gider.
--
-- Atanan kisi iki turden biri olabilir: panel kullanicisi (KRY_KULLANICILAR
-- kullanici_adi) ya da magaza personeli (Mikro per_kod). Hangisi oldugu
-- atanan_tur alaninda tutulur; tek tablo iki tur tasir cunku is emrinin
-- akisi ikisinde de aynidir.
IF OBJECT_ID('KRY_IS_EMRI') IS NULL
BEGIN
    CREATE TABLE KRY_IS_EMRI (
        id            INT IDENTITY(1,1) PRIMARY KEY,

        baslik        NVARCHAR(200) NOT NULL,
        aciklama      NVARCHAR(MAX) NULL,
        oncelik       NVARCHAR(20)  NOT NULL DEFAULT('Normal'),

        -- Kime atandi
        atanan_tur    NVARCHAR(10)  NOT NULL,   -- 'panel' | 'personel'
        atanan_kod    NVARCHAR(60)  NOT NULL,   -- kullanici_adi | per_kod
        atanan_ad     NVARCHAR(120) NULL,

        -- Kim atadi
        atayan        NVARCHAR(60)  NOT NULL,
        atayan_ad     NVARCHAR(120) NULL,

        -- Hangi sayfadan atandi: panelde ilgili kayda donebilmek icin
        kaynak_ekran  NVARCHAR(40)  NULL,       -- 'basvuru', 'personel', ...
        kaynak_id     NVARCHAR(60)  NULL,
        kaynak_baslik NVARCHAR(200) NULL,

        durum         NVARCHAR(20)  NOT NULL DEFAULT('Yeni'),
        son_tarih     DATE          NULL,

        -- Bitirirken yazilan aciklama
        sonuc         NVARCHAR(MAX) NULL,
        bitiren_ad    NVARCHAR(120) NULL,

        goruldu       BIT           NOT NULL DEFAULT(0),
        goruldu_tarih DATETIME2     NULL,
        bitis_tarihi  DATETIME2     NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_IS_EMRI_atanan
        ON KRY_IS_EMRI(atanan_tur, atanan_kod, durum, olusturma DESC);

    CREATE INDEX IX_KRY_IS_EMRI_atayan
        ON KRY_IS_EMRI(atayan, olusturma DESC);
END

-- Kontrol listeleri (checklist). Yonetici, bolge koordinatoru ya da bolge
-- muduru bir liste tanimlar; hedef kitle POZISYONA gore secilir (Manav,
-- Kasap ...), istenirse sube ile sinirlanir. Personel mobilden doldurur:
-- madde tiklenir, gorsel eklenir, yorum yazilir.
--
-- Gorseller diskte tutulur ve YEDI GUN sonra silinir; hacim hizla buyuyor
-- (35 sube x madde x fotograf). Kayitlar durur, yalnizca dosya silinir.
IF OBJECT_ID('KRY_CHECKLIST') IS NULL
BEGIN
    CREATE TABLE KRY_CHECKLIST (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        baslik        NVARCHAR(200) NOT NULL,
        aciklama      NVARCHAR(MAX) NULL,

        -- Hedef kitle: virgulle ayrilmis pozisyon adlari. Bos ise herkes.
        pozisyonlar   NVARCHAR(1000) NULL,
        -- Bos ise tum subeler
        subeler       NVARCHAR(1000) NULL,

        -- 'gunluk' | 'haftalik' | 'tek'
        siklik        NVARCHAR(20)  NOT NULL DEFAULT('gunluk'),
        -- Doldurma saat araligi; bos ise gun boyu
        bas_saat      INT           NULL,
        bit_saat      INT           NULL,

        aktif         BIT           NOT NULL DEFAULT(1),
        olusturan     NVARCHAR(60)  NOT NULL,
        olusturan_ad  NVARCHAR(120) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

IF OBJECT_ID('KRY_CHECKLIST_MADDE') IS NULL
BEGIN
    CREATE TABLE KRY_CHECKLIST_MADDE (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        checklist_id  INT           NOT NULL,
        sira          INT           NOT NULL DEFAULT(0),
        soru          NVARCHAR(400) NOT NULL,
        gorsel_zorunlu BIT          NOT NULL DEFAULT(0),
        yorum_zorunlu BIT           NOT NULL DEFAULT(0)
    );

    CREATE INDEX IX_KRY_CHECKLIST_MADDE_liste
        ON KRY_CHECKLIST_MADDE(checklist_id, sira);
END

-- Bir personelin bir listeyi bir gun icin doldurmasi
IF OBJECT_ID('KRY_CHECKLIST_DOLDURMA') IS NULL
BEGIN
    CREATE TABLE KRY_CHECKLIST_DOLDURMA (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        checklist_id  INT           NOT NULL,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,

        gun           DATE          NOT NULL,
        tamamlandi    BIT           NOT NULL DEFAULT(0),

        -- Panelden yapilan degerlendirme
        puan          INT           NULL,
        degerlendirme NVARCHAR(MAX) NULL,
        degerlendiren NVARCHAR(120) NULL,

        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        guncelleme    DATETIME2     NULL
    );

    CREATE UNIQUE INDEX UX_KRY_CHECKLIST_DOLDURMA
        ON KRY_CHECKLIST_DOLDURMA(checklist_id, personel_kodu, gun);
END

IF OBJECT_ID('KRY_CHECKLIST_CEVAP') IS NULL
BEGIN
    CREATE TABLE KRY_CHECKLIST_CEVAP (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        doldurma_id   INT           NOT NULL,
        madde_id      INT           NOT NULL,

        -- 'evet' | 'hayir' | 'uygundegil'
        cevap         NVARCHAR(20)  NULL,
        yorum         NVARCHAR(MAX) NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX UX_KRY_CHECKLIST_CEVAP
        ON KRY_CHECKLIST_CEVAP(doldurma_id, madde_id);
END

IF OBJECT_ID('KRY_CHECKLIST_GORSEL') IS NULL
BEGIN
    CREATE TABLE KRY_CHECKLIST_GORSEL (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        doldurma_id   INT           NOT NULL,
        madde_id      INT           NOT NULL,
        dosya         NVARCHAR(260) NOT NULL,
        silindi       BIT           NOT NULL DEFAULT(0),
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_CHECKLIST_GORSEL_doldurma
        ON KRY_CHECKLIST_GORSEL(doldurma_id, madde_id);
END

-- Degerlendirme madde bazinda yapilir; genel puan bunlarin ortalamasidir.
IF COL_LENGTH('KRY_CHECKLIST_CEVAP', 'puan') IS NULL
    ALTER TABLE KRY_CHECKLIST_CEVAP ADD puan INT NULL;

IF COL_LENGTH('KRY_CHECKLIST_CEVAP', 'degerlendirme') IS NULL
    ALTER TABLE KRY_CHECKLIST_CEVAP ADD degerlendirme NVARCHAR(MAX) NULL;

-- Iade: panelden bir madde begenilmezse tekrar yapilmasi istenir. Cevap
-- silinmez, personel ne yazdigini gorsun; madde yeniden cevaplaninca iade
-- kalkar ve doldurma tekrar tamamlanmis sayilir.
IF COL_LENGTH('KRY_CHECKLIST_CEVAP', 'iade') IS NULL
    ALTER TABLE KRY_CHECKLIST_CEVAP ADD iade BIT NOT NULL DEFAULT(0);

IF COL_LENGTH('KRY_CHECKLIST_CEVAP', 'iade_notu') IS NULL
    ALTER TABLE KRY_CHECKLIST_CEVAP ADD iade_notu NVARCHAR(MAX) NULL;

IF COL_LENGTH('KRY_CHECKLIST_CEVAP', 'iade_eden') IS NULL
    ALTER TABLE KRY_CHECKLIST_CEVAP ADD iade_eden NVARCHAR(120) NULL;

-- Takvim notlari. Gorusme takviminde bir gune yazilan serbest not; istege
-- bagli olarak belirli bir zamanda hatirlatilir. Hatirlatma panel canina
-- bildirim olarak duser.
IF OBJECT_ID('KRY_TAKVIM_NOT') IS NULL
BEGIN
    CREATE TABLE KRY_TAKVIM_NOT (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        gun           DATE          NOT NULL,
        baslik        NVARCHAR(200) NOT NULL,
        metin         NVARCHAR(MAX) NULL,

        -- Hatirlatma zamani; bos ise yalnizca not olarak durur
        hatirlatma    DATETIME2     NULL,
        hatirlatildi  BIT           NOT NULL DEFAULT(0),

        -- Bir basvuruya ya da elle olusturulan gorusmeye baglanabilir
        basvuru_id    INT           NULL,
        gorusme_id    INT           NULL,

        kullanici     NVARCHAR(60)  NOT NULL,
        kullanici_ad  NVARCHAR(120) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_TAKVIM_NOT_gun ON KRY_TAKVIM_NOT(gun, kullanici);
    CREATE INDEX IX_KRY_TAKVIM_NOT_hatirlatma
        ON KRY_TAKVIM_NOT(hatirlatildi, hatirlatma);
END

-- Elle olusturulan gorusmeler. Basvurusu olmayan kisilerle (mevcut personel
-- ya da disaridan biri) planlanan gorusmeler burada tutulur; takvimde
-- basvuru kaynakli gorusmelerle birlikte gosterilir.
IF OBJECT_ID('KRY_MANUEL_GORUSME') IS NULL
BEGIN
    CREATE TABLE KRY_MANUEL_GORUSME (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        ad_soyad      NVARCHAR(120) NOT NULL,
        telefon       NVARCHAR(25)  NULL,
        sube_adi      NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,

        -- 'personel' (bizde calisan) | 'dis' (disaridan)
        tur           NVARCHAR(20)  NOT NULL DEFAULT('dis'),
        personel_kodu NVARCHAR(30)  NULL,

        gorusme_tarihi DATETIME2    NOT NULL,
        gorusme_yeri  NVARCHAR(200) NULL,
        aciklama      NVARCHAR(MAX) NULL,

        -- 'Planlandi' | 'Yapildi' | 'Iptal'
        durum         NVARCHAR(20)  NOT NULL DEFAULT('Planlandı'),
        sonuc         NVARCHAR(MAX) NULL,

        olusturan     NVARCHAR(60)  NOT NULL,
        olusturan_ad  NVARCHAR(120) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_MANUEL_GORUSME_tarih
        ON KRY_MANUEL_GORUSME(gorusme_tarihi);
END

-- Havuzdan cikarma. Adayin durumu Olumlu kalir (gecmisi bozulmasin) ama havuzda
-- gorunmez. Ulasilamayan, vazgecen ya da baska ise giren adaylar havuzu
-- sisirip doluluk oranini yanlis gosteriyordu.
IF COL_LENGTH('KRY_BASVURULAR', 'havuz_cikis_sebep') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD havuz_cikis_sebep NVARCHAR(60) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'havuz_cikis_not') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD havuz_cikis_not NVARCHAR(500) NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'havuz_cikis_tarih') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD havuz_cikis_tarih DATETIME2 NULL;

IF COL_LENGTH('KRY_BASVURULAR', 'havuz_cikaran') IS NULL
    ALTER TABLE KRY_BASVURULAR ADD havuz_cikaran NVARCHAR(120) NULL;

-- Havuz ve liste durum uzerinden suzuyor; indeks kapsadigi kolonlar
-- (arsiv, havuz_cikis_tarih) yukarida eklendigi icin burada kurulur; durum indeksi olmadigi icin
-- her cagri tum tabloyu tariyordu.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_BASVURULAR_durum')
    CREATE INDEX IX_KRY_BASVURULAR_durum
        ON KRY_BASVURULAR(durum, olusturma DESC)
        INCLUDE (sube_kodu, havuz_cikis_tarih, arsiv, kimlik_no);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_BASVURULAR_olusturma')
    CREATE INDEX IX_KRY_BASVURULAR_olusturma
        ON KRY_BASVURULAR(olusturma DESC)
        INCLUDE (durum, sube_kodu, arsiv);

-- Ise uyum ve geribildirim anketleri. Her gonderim bir baglanti uretir;
-- baglanti kisiye ve asamaya ozeldir, KIRK SEKIZ SAAT gecerlidir.
--
-- tur: 'calisan' (personelin kendi formu) | 'yonetici' (magaza mudurunun
-- degerlendirmesi). Yonetici baglantisi tek olup birden fazla personeli
-- kapsayabilir; o yuzden personel_kodu bos olabilir, kapsam sube ile
-- belirlenir.
IF OBJECT_ID('KRY_UYUM_ANKET') IS NULL
BEGIN
    CREATE TABLE KRY_UYUM_ANKET (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        kod           NVARCHAR(20)  NOT NULL UNIQUE,

        tur           NVARCHAR(20)  NOT NULL,
        -- '7g' | '2a' | '6a' | '1y'
        asama         NVARCHAR(10)  NOT NULL,

        personel_kodu NVARCHAR(30)  NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,
        telefon       NVARCHAR(25)  NULL,
        giris_tarihi  DATE          NULL,

        -- Baglanti bu tarihten sonra acilmaz
        gecerlilik    DATETIME2     NOT NULL,

        -- Yanitlar JSON olarak tutulur; sorular surumle degistigi icin
        -- kolon basina alan acmak surdurulebilir degil.
        cevaplar_json NVARCHAR(MAX) NULL,
        puan          DECIMAL(4,2)  NULL,
        dolduruldu    DATETIME2     NULL,

        -- Test gonderimleri raporlara girmez
        test_mi       BIT           NOT NULL DEFAULT(0),

        gonderen      NVARCHAR(120) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_UYUM_ANKET_kisi
        ON KRY_UYUM_ANKET(personel_kodu, asama, tur);
END

-- Kunye analizi. Personel rakip marketteki meyve-sebze kunyesini okutur;
-- rakibin HKS'ye bildirdigi alis fiyati ile bizim ayni cinste son alis
-- fiyatimiz karsilastirilir. Her okutma buraya duser; panelde sube, urun ve
-- tedarikci bazinda raporlanir.
IF OBJECT_ID('KRY_KUNYE_ANALIZ') IS NULL
BEGIN
    CREATE TABLE KRY_KUNYE_ANALIZ (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        kunye_no        NVARCHAR(40)  NOT NULL,
        cins_kod        INT           NULL,
        -- Alanlar genis tutuldu: uretim yeri IL/ILCE/MERKEZ KOYLER
        -- biciminde geliyor, isletme adlari ise tam unvanla.
        urun_adi        NVARCHAR(400) NULL,
        uretici         NVARCHAR(400) NULL,
        uretim_yeri     NVARCHAR(400) NULL,

        -- Kunyeyi bildiren (rakip) isletme ve bildirdigi alis fiyati
        rakip_isletme   NVARCHAR(400) NULL,
        rakip_fiyat     DECIMAL(18,2) NULL,

        -- Bizim ayni cinste son alis fiyatimiz ve hangi kunyeden
        bizim_fiyat     DECIMAL(18,2) NULL,
        bizim_kunye     NVARCHAR(40)  NULL,
        bizim_tarih     DATE          NULL,

        fark            DECIMAL(18,2) NULL,
        fark_yuzde      DECIMAL(9,2)  NULL,

        -- Okutan personel ve subesi
        sube_adi        NVARCHAR(250) NULL,
        mikro_dep_no    INT           NULL,
        personel_kodu   NVARCHAR(30)  NULL,
        personel_adi    NVARCHAR(200) NULL,
        not_metni       NVARCHAR(MAX) NULL,
        olusturma       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_KUNYE_ANALIZ_tarih ON KRY_KUNYE_ANALIZ(olusturma DESC);
    CREATE INDEX IX_KRY_KUNYE_ANALIZ_sube  ON KRY_KUNYE_ANALIZ(sube_adi, olusturma DESC);
END
ELSE
BEGIN
    -- Tablo daha once dar kolonlarla olusturulmus olabilir; genisletilir.
    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'urun_adi') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN urun_adi NVARCHAR(400) NULL;

    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'uretici') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN uretici NVARCHAR(400) NULL;

    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'uretim_yeri') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN uretim_yeri NVARCHAR(400) NULL;

    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'rakip_isletme') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN rakip_isletme NVARCHAR(400) NULL;

    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'sube_adi') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN sube_adi NVARCHAR(250) NULL;

    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'personel_adi') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN personel_adi NVARCHAR(200) NULL;

    IF COL_LENGTH('KRY_KUNYE_ANALIZ', 'not_metni') IS NOT NULL
        ALTER TABLE KRY_KUNYE_ANALIZ ALTER COLUMN not_metni NVARCHAR(MAX) NULL;
END

-- Izin talepleri. Personel uygulamadan olusturur, uc asamada onaylanir:
-- magaza muduru, bolge muduru, insan kaynaklari. Her asama kendi
-- sirasinda gorunur; reddedildiginde aciklama zorunludur.
IF OBJECT_ID('KRY_IZIN_TALEP') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_TALEP (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,

        tur           NVARCHAR(40)  NOT NULL,
        cikis_tarihi  DATE          NOT NULL,
        donus_tarihi  DATE          NOT NULL,
        baslama_tarihi DATE         NULL,
        gun           DECIMAL(6,1)  NOT NULL,

        /* Yarim gun ve saatlik talepler icin */
        yarim_gun     NVARCHAR(20)  NULL,
        baslangic_saat NVARCHAR(5)  NULL,
        bitis_saat    NVARCHAR(5)   NULL,
        saat          DECIMAL(5,2)  NULL,

        aciklama      NVARCHAR(500) NULL,

        /* Bekliyor · Magaza · Bolge · Onaylandi · Reddedildi
           Bekliyor durumu magaza muduru onayini bekliyor demektir. */
        durum         NVARCHAR(20)  NOT NULL DEFAULT(N'Bekliyor'),

        magaza_karar  NVARCHAR(20)  NULL,
        magaza_kisi   NVARCHAR(60)  NULL,
        magaza_not    NVARCHAR(500) NULL,
        magaza_tarih  DATETIME2     NULL,

        bolge_karar   NVARCHAR(20)  NULL,
        bolge_kisi    NVARCHAR(60)  NULL,
        bolge_not     NVARCHAR(500) NULL,
        bolge_tarih   DATETIME2     NULL,

        ik_karar      NVARCHAR(20)  NULL,
        ik_kisi       NVARCHAR(60)  NULL,
        ik_not        NVARCHAR(500) NULL,
        ik_tarih      DATETIME2     NULL,

        /* Onaylandiginda olusan izin kaydi */
        izin_id       INT           NULL,

        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        iptal         BIT           NOT NULL DEFAULT(0)
    );

    CREATE INDEX IX_KRY_IZIN_TALEP_personel
        ON KRY_IZIN_TALEP(personel_kodu, olusturma DESC);

    CREATE INDEX IX_KRY_IZIN_TALEP_durum
        ON KRY_IZIN_TALEP(durum, olusturma DESC);
END

IF COL_LENGTH('KRY_IZIN_TALEP', 'yarim_gun') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD yarim_gun NVARCHAR(20) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'baslangic_saat') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD baslangic_saat NVARCHAR(5) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'bitis_saat') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD bitis_saat NVARCHAR(5) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'saat') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD saat DECIMAL(5,2) NULL;

-- Izin formu: yerine bakacak kisi, formun gonderildigi adres ve
-- son onayda yuklenen imzali belge (KRY_PERSONEL_BELGE.id)
IF COL_LENGTH('KRY_IZIN_TALEP', 'yerine_kodu') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD yerine_kodu NVARCHAR(30) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'yerine_ad') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD yerine_ad NVARCHAR(120) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'form_eposta') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD form_eposta NVARCHAR(400) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'form_gonderim') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD form_gonderim DATETIME2 NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'form_hata') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD form_hata NVARCHAR(500) NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'belge_id') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD belge_id INT NULL;

-- Mazeret izni belgesi: izin onaylaninca personel 3 gun icinde
-- uygulamadan yukler. mb_son doluysa belge isteniyor demektir.
IF COL_LENGTH('KRY_IZIN_TURU', 'belge_gerekli') IS NULL
BEGIN
    ALTER TABLE KRY_IZIN_TURU ADD belge_gerekli BIT NOT NULL DEFAULT 0;
    EXEC(N'UPDATE KRY_IZIN_TURU SET belge_gerekli = 1
           WHERE ad LIKE N''%mazeret%'' OR ad LIKE N''%rapor%''');
END

IF COL_LENGTH('KRY_IZIN_TALEP', 'mb_son') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD mb_son DATETIME2 NULL;

-- Panelden girilen izin (26.10.2026): personelin evrak kartı için onaylı talep kaydı
IF COL_LENGTH('KRY_IZIN_TALEP', 'kaynak') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD kaynak NVARCHAR(10) NULL;

-- Mazeret izni türü (07.10.2026) ve şube personelinde imzalı form şartı:
-- form_sarti = 1 ise birim yöneticisi imzalı form yüklenmeden onaylayamaz
IF COL_LENGTH('KRY_IZIN_TALEP', 'alt_tur') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD alt_tur NVARCHAR(60) NULL;
IF COL_LENGTH('KRY_IZIN_TALEP', 'form_sarti') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD form_sarti BIT NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'mb_belge_id') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD mb_belge_id INT NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'mb_yukleme') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD mb_yukleme DATETIME2 NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'mb_son_gun_bildirim') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD mb_son_gun_bildirim DATETIME2 NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'mb_yonetici_bildirim') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD mb_yonetici_bildirim DATETIME2 NULL;

IF COL_LENGTH('KRY_IZIN_TALEP', 'mb_hatirlatma') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD mb_hatirlatma DATETIME2 NULL;

-- Izin evraki: personelin yukledigi imzali form ve destekleyici belgeler,
-- IK'nin yukledigi islak imzali nihai evrak. kalem: form | destek | ik
IF OBJECT_ID('KRY_IZIN_TALEP_EVRAK') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_TALEP_EVRAK (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        talep_id    INT           NOT NULL,
        belge_id    INT           NOT NULL,
        kalem       NVARCHAR(12)  NOT NULL,
        tur         NVARCHAR(60)  NULL,
        yukleyen    NVARCHAR(100) NULL,
        olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_IZIN_TALEP_EVRAK_talep ON KRY_IZIN_TALEP_EVRAK(talep_id);
END

-- Personel islak imzali aslini IK'ya gonderdigini isaretledi
IF COL_LENGTH('KRY_IZIN_TALEP', 'asil_gonderim') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD asil_gonderim DATETIME2 NULL;

-- IK, evrak gelmeden onayladi (evrak sonra yuklenecek)
IF COL_LENGTH('KRY_IZIN_TALEP', 'evrak_sonra') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD evrak_sonra BIT NOT NULL DEFAULT 0;

-- Izin onay zinciri (26.10.2026): avans onay tablosundaki surec talebe
-- yaziliyor (JSON; IzinOnayZinciri), asama = bulundugu adim (0 ilk).
-- Zinciri olmayan eski talepler eski uc asamali akisla sonuclaniyor.
IF COL_LENGTH('KRY_IZIN_TALEP', 'zincir') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD zincir NVARCHAR(MAX) NULL;
IF COL_LENGTH('KRY_IZIN_TALEP', 'asama') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD asama INT NULL;

-- Oryantasyon uygulamada: kanal (sms | uygulama), 24 saat kala
-- hatirlatmasi ve uygulamadan degerlendiren yoneticinin sicili
-- Uygulamanin gorev ekranlarini (belge, oryantasyon) tasiyan surum en son
-- ne zaman acildi. Eski surumdeki personele anket uygulamaya dusurulmez.
IF COL_LENGTH('KRY_MOBIL_JETON', 'gorev_gorulme') IS NULL
    ALTER TABLE KRY_MOBIL_JETON ADD gorev_gorulme DATETIME2 NULL;

IF COL_LENGTH('KRY_UYUM_ANKET', 'kanal') IS NULL
    ALTER TABLE KRY_UYUM_ANKET ADD kanal NVARCHAR(12) NULL;

IF COL_LENGTH('KRY_UYUM_ANKET', 'hatirlatma') IS NULL
    ALTER TABLE KRY_UYUM_ANKET ADD hatirlatma DATETIME2 NULL;

IF COL_LENGTH('KRY_UYUM_ANKET', 'yonetici_kodu') IS NULL
    ALTER TABLE KRY_UYUM_ANKET ADD yonetici_kodu NVARCHAR(30) NULL;

-- Bir kez gidecek bildirimlerin kaydi (anahtar: konu|kisi|asama...)
IF OBJECT_ID('KRY_GOREV_BILDIRIM') IS NULL
BEGIN
    CREATE TABLE KRY_GOREV_BILDIRIM (
        anahtar  NVARCHAR(160) NOT NULL PRIMARY KEY,
        zaman    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Personel yol ucreti: Excel ile toplu aktarilir (Yonetim > Yol Ucretleri)
IF OBJECT_ID('KRY_PERSONEL_YOL') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_YOL (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        tutar         DECIMAL(12,2) NOT NULL,
        aciklama      NVARCHAR(200) NULL,
        guncelleyen   NVARCHAR(100) NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Personel kiyafet bedeni (18.10.2026): personel kartindan girilir
IF OBJECT_ID('KRY_PERSONEL_BEDEN') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_BEDEN (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        beden         NVARCHAR(20)  NOT NULL,
        guncelleyen   NVARCHAR(100) NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Magaza havuz sistemi (19.10.2026): kampanya urunlerinden subeye hakedis
IF OBJECT_ID('KRY_HAVUZ_KAMPANYA') IS NULL
BEGIN
    CREATE TABLE KRY_HAVUZ_KAMPANYA (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        ad             NVARCHAR(150) NOT NULL,
        stok_kodlari   NVARCHAR(MAX) NULL,
        birim_tutar    DECIMAL(12,4) NOT NULL DEFAULT 0,
        bolge_payi     DECIMAL(5,2)  NOT NULL DEFAULT 0,
        bas            DATE NOT NULL,
        bit            DATE NOT NULL,
        durum          NVARCHAR(20)  NOT NULL DEFAULT N'taslak',
        aciklama       NVARCHAR(500) NULL,
        hesaplama      DATETIME2 NULL,
        olusturan      NVARCHAR(100) NULL,
        olusturma      DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
        kesinlestiren  NVARCHAR(100) NULL,
        kesinlesme     DATETIME2 NULL
    );
END

IF OBJECT_ID('KRY_HAVUZ_HAKEDIS') IS NULL
BEGIN
    CREATE TABLE KRY_HAVUZ_HAKEDIS (
        kampanya_id  INT NOT NULL,
        sube_kodu    NVARCHAR(30)  NOT NULL,
        sube_adi     NVARCHAR(100) NULL,
        miktar       DECIMAL(18,3) NOT NULL DEFAULT 0,
        brut         DECIMAL(14,2) NOT NULL DEFAULT 0,
        bolge_payi   DECIMAL(14,2) NOT NULL DEFAULT 0,
        net          DECIMAL(14,2) NOT NULL DEFAULT 0,
        elle         BIT NOT NULL DEFAULT 0,
        CONSTRAINT PK_KRY_HAVUZ_HAKEDIS PRIMARY KEY (kampanya_id, sube_kodu)
    );
END

IF OBJECT_ID('KRY_HAVUZ_HAREKET') IS NULL
BEGIN
    CREATE TABLE KRY_HAVUZ_HAREKET (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        sube_kodu   NVARCHAR(30)  NOT NULL,
        sube_adi    NVARCHAR(100) NULL,
        tarih       DATE NOT NULL,
        tur         NVARCHAR(20)  NOT NULL,
        tutar       DECIMAL(14,2) NOT NULL,
        aciklama    NVARCHAR(500) NULL,
        kaydeden    NVARCHAR(100) NULL,
        kayit       DATETIME2 NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Havuzdan Bicen Kart dagitimi (19.10.2026): puan talebinin hangi havuzdan geldigi
IF COL_LENGTH('KRY_PUAN_TALEP', 'havuz_kodu') IS NULL
    ALTER TABLE KRY_PUAN_TALEP ADD havuz_kodu NVARCHAR(60) NULL;

-- Kazan-Kazan (20.10.2026): calisanlarin yeni urun onerileri
IF OBJECT_ID('KRY_KK_ONERI') IS NULL
BEGIN
    CREATE TABLE KRY_KK_ONERI (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        aktivite        NVARCHAR(30)   NOT NULL DEFAULT N'yeniurun',
        personel_kodu   NVARCHAR(30)   NOT NULL,
        ad_soyad        NVARCHAR(120)  NULL,
        sube_adi        NVARCHAR(120)  NULL,
        pozisyon        NVARCHAR(120)  NULL,
        urun_adi        NVARCHAR(150)  NOT NULL,
        barkod          VARCHAR(20)    NOT NULL,
        neden           NVARCHAR(1000) NOT NULL,
        gorsel          NVARCHAR(200)  NULL,
        durum           NVARCHAR(20)   NOT NULL DEFAULT N'degerlendiriliyor',
        karar_notu      NVARCHAR(500)  NULL,
        karar_veren     NVARCHAR(100)  NULL,
        karar_tarihi    DATETIME2      NULL,
        stok_kodu       NVARCHAR(30)   NULL,
        satis_baslangic DATE           NULL,
        olcum_bas       DATE           NULL,
        olcum_bit       DATE           NULL,
        olcum_miktar    DECIMAL(18,3)  NULL,
        siralama        INT            NULL,
        urun_sayisi     INT            NULL,
        odul            NVARCHAR(30)   NULL,
        odul_tarihi     DATETIME2      NULL,
        olusturma       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme      DATETIME2      NULL
    );
    CREATE INDEX IX_KRY_KK_ONERI_barkod ON KRY_KK_ONERI(barkod, olusturma DESC);
    CREATE INDEX IX_KRY_KK_ONERI_personel ON KRY_KK_ONERI(personel_kodu, olusturma DESC);
    CREATE INDEX IX_KRY_KK_ONERI_durum ON KRY_KK_ONERI(durum, olusturma DESC);
END

IF OBJECT_ID('KRY_KK_HAREKET') IS NULL
BEGIN
    CREATE TABLE KRY_KK_HAREKET (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        oneri_id    INT           NOT NULL,
        eski_durum  NVARCHAR(20)  NULL,
        yeni_durum  NVARCHAR(20)  NOT NULL,
        aciklama    NVARCHAR(500) NULL,
        yapan       NVARCHAR(100) NULL,
        kaynak      NVARCHAR(30)  NULL,
        zaman       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_KK_HAREKET_oneri ON KRY_KK_HAREKET(oneri_id, zaman);
END

-- Kazan-Kazan satinalma entegrasyonu (20.10.2026): bildirim, teslim, odul kademeleri
IF COL_LENGTH('KRY_KK_HAREKET', 'bildirim_zamani') IS NULL
BEGIN
    ALTER TABLE KRY_KK_HAREKET ADD bildirim_zamani DATETIME2 NULL;
    EXEC('UPDATE KRY_KK_HAREKET SET bildirim_zamani = zaman WHERE bildirim_zamani IS NULL');
END

IF COL_LENGTH('KRY_KK_ONERI', 'teslim_tarihi') IS NULL
    ALTER TABLE KRY_KK_ONERI ADD teslim_tarihi DATETIME2 NULL;

IF COL_LENGTH('KRY_KK_ONERI', 'teslim_eden') IS NULL
    ALTER TABLE KRY_KK_ONERI ADD teslim_eden NVARCHAR(100) NULL;

IF OBJECT_ID('KRY_KK_ODUL_KADEME') IS NULL
BEGIN
    CREATE TABLE KRY_KK_ODUL_KADEME (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        aktivite     NVARCHAR(30)  NOT NULL DEFAULT N'yeniurun',
        sira_sinir   INT           NOT NULL,
        odul         NVARCHAR(30)  NOT NULL,
        aktif        BIT           NOT NULL DEFAULT 1,
        guncelleyen  NVARCHAR(100) NULL,
        guncelleme   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    INSERT INTO KRY_KK_ODUL_KADEME (sira_sinir, odul, guncelleyen) VALUES
        (100, N'Tam Altın', N'kurulum'), (500, N'Yarım Altın', N'kurulum'),
        (1000, N'Çeyrek Altın', N'kurulum'), (2000, N'Gram Altın', N'kurulum');
END

-- Magaza havuzu: hakedisi kim hesapliyor (satinalma ise IK Mikrodan hesapla kapali)
IF COL_LENGTH('KRY_HAVUZ_KAMPANYA', 'hesap_kaynagi') IS NULL
    ALTER TABLE KRY_HAVUZ_KAMPANYA ADD hesap_kaynagi NVARCHAR(20) NULL;

-- Donemsel personel degerlendirmesi (20.10.2026): magaza muduru 3 ayda bir ekibini degerlendirir
IF OBJECT_ID('KRY_DD_SORU') IS NULL
BEGIN
    CREATE TABLE KRY_DD_SORU (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        pozisyon   NVARCHAR(100) NOT NULL,
        sira       INT           NOT NULL DEFAULT 0,
        tur        NVARCHAR(10)  NOT NULL,
        metin      NVARCHAR(300) NOT NULL,
        zorunlu    BIT           NOT NULL DEFAULT 1,
        aktif      BIT           NOT NULL DEFAULT 1,
        olusturma  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_DD_SORU_poz ON KRY_DD_SORU(pozisyon, aktif, sira);
    INSERT INTO KRY_DD_SORU (pozisyon, sira, tur, metin, zorunlu) VALUES
        (N'Genel', 1, N'olcek', N'Müşteri ile iletişim', 1),
        (N'Genel', 2, N'olcek', N'İşini zamanında ve doğru yapma', 1),
        (N'Genel', 3, N'olcek', N'Dakiklik ve işe devamlılık', 1),
        (N'Genel', 4, N'olcek', N'Kurallara ve talimatlara uyum', 1),
        (N'Genel', 5, N'olcek', N'Ekip arkadaşlarıyla uyum', 1),
        (N'Genel', 6, N'acik', N'Güçlü yönleri neler?', 0),
        (N'Genel', 7, N'acik', N'Gelişmesi gereken konular neler?', 0),
        (N'Kasiyer', 1, N'olcek', N'Müşteri ile iletişim', 1),
        (N'Kasiyer', 2, N'olcek', N'Güler yüz ve nezaket', 1),
        (N'Kasiyer', 3, N'olcek', N'Kasa işlemlerinde hız ve doğruluk', 1),
        (N'Kasiyer', 4, N'olcek', N'Kasa farkı / açık kontrolü', 1),
        (N'Kasiyer', 5, N'olcek', N'Dakiklik ve işe devamlılık', 1),
        (N'Kasiyer', 6, N'olcek', N'Ekip arkadaşlarıyla uyum', 1),
        (N'Kasiyer', 7, N'acik', N'Güçlü yönleri neler?', 0),
        (N'Kasiyer', 8, N'acik', N'Gelişmesi gereken konular neler?', 0),
        (N'Reyoner', 1, N'olcek', N'Raf doluluğu ve yüz düzeni', 1),
        (N'Reyoner', 2, N'olcek', N'Fiyat etiketi doğruluğu', 1),
        (N'Reyoner', 3, N'olcek', N'Mal kabul ve depo düzeni', 1),
        (N'Reyoner', 4, N'olcek', N'Müşteriye yardımcı olma', 1),
        (N'Reyoner', 5, N'olcek', N'Ekip arkadaşlarıyla uyum', 1),
        (N'Reyoner', 6, N'acik', N'Güçlü yönleri neler?', 0),
        (N'Reyoner', 7, N'acik', N'Gelişmesi gereken konular neler?', 0),
        (N'Şarküteri', 1, N'olcek', N'Müşteri ile iletişim', 1),
        (N'Şarküteri', 2, N'olcek', N'Hijyen ve gıda güvenliği kurallarına uyum', 1),
        (N'Şarküteri', 3, N'olcek', N'Ürün bilgisi ve doğru tavsiye', 1),
        (N'Şarküteri', 4, N'olcek', N'Kesim, tartım ve etiketlemede doğruluk', 1),
        (N'Şarküteri', 5, N'olcek', N'Reyon düzeni ve teşhir', 1),
        (N'Şarküteri', 6, N'olcek', N'Fire ve SKT takibi', 1),
        (N'Şarküteri', 7, N'acik', N'Güçlü yönleri neler?', 0),
        (N'Şarküteri', 8, N'acik', N'Gelişmesi gereken konular neler?', 0),
        (N'Manav', 1, N'olcek', N'Ürün tazeliği ve ayıklama', 1),
        (N'Manav', 2, N'olcek', N'Reyon düzeni ve teşhir', 1),
        (N'Manav', 3, N'olcek', N'Fire takibi', 1),
        (N'Manav', 4, N'olcek', N'Müşteri ile iletişim', 1),
        (N'Manav', 5, N'olcek', N'Dakiklik ve işe devamlılık', 1),
        (N'Manav', 6, N'acik', N'Güçlü yönleri neler?', 0),
        (N'Manav', 7, N'acik', N'Gelişmesi gereken konular neler?', 0),
        (N'Kasap', 1, N'olcek', N'Hijyen ve gıda güvenliği', 1),
        (N'Kasap', 2, N'olcek', N'Kesim kalitesi ve doğru gramaj', 1),
        (N'Kasap', 3, N'olcek', N'Müşteri ile iletişim', 1),
        (N'Kasap', 4, N'olcek', N'Fire ve soğuk zincir takibi', 1),
        (N'Kasap', 5, N'acik', N'Güçlü yönleri neler?', 0),
        (N'Kasap', 6, N'acik', N'Gelişmesi gereken konular neler?', 0);
END

/* 24.10.2026: dönemsel değerlendirmede tüm sorular zorunlu */
UPDATE KRY_DD_SORU SET zorunlu = 1 WHERE zorunlu = 0;

IF OBJECT_ID('KRY_DD_DEGERLENDIRME') IS NULL
BEGIN
    CREATE TABLE KRY_DD_DEGERLENDIRME (
        id                   INT IDENTITY(1,1) PRIMARY KEY,
        donem                VARCHAR(7)    NOT NULL,
        personel_kodu        NVARCHAR(30)  NOT NULL,
        ad_soyad             NVARCHAR(120) NULL,
        pozisyon             NVARCHAR(120) NULL,
        sube_adi             NVARCHAR(120) NULL,
        degerlendiren_kodu   NVARCHAR(30)  NOT NULL,
        degerlendiren_ad     NVARCHAR(120) NULL,
        degerlendiren_gorev  NVARCHAR(120) NULL,
        genel_puan           TINYINT       NOT NULL,
        soru_ort             DECIMAL(4,2)  NULL,
        genel_aciklama       NVARCHAR(1000) NULL,
        olusturma            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        guncelleme           DATETIME2     NULL,
        CONSTRAINT UQ_KRY_DD_DEGERLENDIRME UNIQUE (donem, personel_kodu)
    );
    CREATE INDEX IX_KRY_DD_DEG_personel ON KRY_DD_DEGERLENDIRME(personel_kodu, donem);
    CREATE INDEX IX_KRY_DD_DEG_sube ON KRY_DD_DEGERLENDIRME(donem, sube_adi);
END

IF COL_LENGTH('KRY_DD_DEGERLENDIRME', 'genel_aciklama') IS NULL
    ALTER TABLE KRY_DD_DEGERLENDIRME ADD genel_aciklama NVARCHAR(1000) NULL;

-- Denklestirme (23.10.2026): fazla calisma x1,5 alacak, eksik calisma borc, denklestirme izni
IF OBJECT_ID('KRY_DENKLESTIRME') IS NULL
BEGIN
    CREATE TABLE KRY_DENKLESTIRME (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu   NVARCHAR(30)   NOT NULL,
        ad_soyad        NVARCHAR(120)  NULL,
        gorev           NVARCHAR(120)  NULL,
        sube            NVARCHAR(120)  NULL,
        tur             NVARCHAR(10)   NOT NULL,
        tarih           DATE           NOT NULL,
        baslangic       NVARCHAR(5)    NOT NULL,
        bitis           NVARCHAR(5)    NOT NULL,
        dk              INT            NOT NULL,
        etki_dk         INT            NOT NULL,
        aciklama        NVARCHAR(500)  NULL,
        durum           NVARCHAR(12)   NOT NULL DEFAULT N'imza',
        belge_dosya     NVARCHAR(200)  NULL,
        belge_tarihi    DATETIME2      NULL,
        yonetici_kodu   NVARCHAR(30)   NULL,
        yonetici_ad     NVARCHAR(200)  NULL,
        yonetici_tarih  DATETIME2      NULL,
        yonetici_not    NVARCHAR(500)  NULL,
        ik_kullanici    NVARCHAR(60)   NULL,
        ik_ad           NVARCHAR(120)  NULL,
        ik_tarih        DATETIME2      NULL,
        ik_not          NVARCHAR(500)  NULL,
        red_nedeni      NVARCHAR(500)  NULL,
        iptal_tarihi    DATETIME2      NULL,
        olusturma       DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_DENKLESTIRME_personel ON KRY_DENKLESTIRME(personel_kodu, durum);
    CREATE INDEX IX_KRY_DENKLESTIRME_durum ON KRY_DENKLESTIRME(durum, id DESC);
END

-- Donemsel degerlendirme kademeleri (23.10.2026): sube / magazaMuduru / bolgeMuduru / depo / depoMuduru
IF COL_LENGTH('KRY_DD_DEGERLENDIRME', 'kapsam') IS NULL
    ALTER TABLE KRY_DD_DEGERLENDIRME ADD kapsam NVARCHAR(20) NULL;

IF OBJECT_ID('KRY_DD_CEVAP') IS NULL
BEGIN
    CREATE TABLE KRY_DD_CEVAP (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        degerlendirme_id  INT            NOT NULL,
        soru_id           INT            NOT NULL,
        soru_metni        NVARCHAR(300)  NULL,
        tur               NVARCHAR(10)   NOT NULL,
        puan              TINYINT        NULL,
        metin             NVARCHAR(1000) NULL
    );
    CREATE INDEX IX_KRY_DD_CEVAP_deg ON KRY_DD_CEVAP(degerlendirme_id);
END

IF OBJECT_ID('KRY_DD_BILDIRIM') IS NULL
BEGIN
    CREATE TABLE KRY_DD_BILDIRIM (
        donem   VARCHAR(7)   NOT NULL,
        anahtar NVARCHAR(30) NOT NULL,
        zaman   DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_DD_BILDIRIM PRIMARY KEY (donem, anahtar)
    );
END

-- Prim hak edisi Bicen Kart yuklemesi (21.10.2026): kaynak, donem, ayrilana otomatik baglanti
IF COL_LENGTH('KRY_PUAN_TALEP', 'kaynak') IS NULL
    ALTER TABLE KRY_PUAN_TALEP ADD kaynak NVARCHAR(20) NULL;
IF COL_LENGTH('KRY_PUAN_TALEP', 'donem') IS NULL
    ALTER TABLE KRY_PUAN_TALEP ADD donem NVARCHAR(7) NULL;
IF COL_LENGTH('KRY_PUAN_TALEP', 'ayrilan_link') IS NULL
    ALTER TABLE KRY_PUAN_TALEP ADD ayrilan_link BIT NOT NULL CONSTRAINT DF_KRY_PUAN_TALEP_ayrilan_link DEFAULT 0;
IF COL_LENGTH('KRY_PUAN_TALEP', 'ayrilan_link_sonuc') IS NULL
    ALTER TABLE KRY_PUAN_TALEP ADD ayrilan_link_sonuc NVARCHAR(500) NULL;

-- Hukuk masasi (24.10.2026): dava dosyalari, sureler, belgeler, resmi yazisma, dis danismanlar
IF OBJECT_ID('KRY_HUK_DOSYA') IS NULL
BEGIN
    CREATE TABLE KRY_HUK_DOSYA (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        dosya_no        NVARCHAR(20)   NOT NULL,
        tur             NVARCHAR(20)   NOT NULL,
        davaci_ad       NVARCHAR(150)  NOT NULL,
        davaci_sicil    NVARCHAR(30)   NULL,
        gorev           NVARCHAR(120)  NULL,
        sube            NVARCHAR(120)  NULL,
        mahkeme         NVARCHAR(200)  NULL,
        esas_no         NVARCHAR(60)   NULL,
        karsi_vekil     NVARCHAR(200)  NULL,
        dava_tarihi     DATE           NULL,
        teblig_tarihi   DATE           NULL,
        asama           NVARCHAR(120)  NULL,
        risk            TINYINT        NOT NULL DEFAULT 1,
        talep_tutar     DECIMAL(18,2)  NULL,
        ozet            NVARCHAR(2000) NULL,
        durum           NVARCHAR(12)   NOT NULL DEFAULT N'acik',
        sonuc           NVARCHAR(500)  NULL,
        kapanis_tarihi  DATE           NULL,
        olusturan       NVARCHAR(80)   NULL,
        olusturma       DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme      DATETIME2      NULL
    );
    CREATE UNIQUE INDEX UX_KRY_HUK_DOSYA_no ON KRY_HUK_DOSYA(dosya_no);
    CREATE INDEX IX_KRY_HUK_DOSYA_durum ON KRY_HUK_DOSYA(durum, id DESC);
END

IF OBJECT_ID('KRY_HUK_OLAY') IS NULL
BEGIN
    CREATE TABLE KRY_HUK_OLAY (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        dosya_id    INT            NOT NULL,
        tur         NVARCHAR(20)   NOT NULL,
        tarih       DATETIME2      NOT NULL,
        baslik      NVARCHAR(200)  NOT NULL,
        aciklama    NVARCHAR(1000) NULL,
        tamam       BIT            NOT NULL DEFAULT 0,
        ekleyen     NVARCHAR(80)   NULL,
        ekleyen_ad  NVARCHAR(150)  NULL,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_HUK_OLAY_dosya ON KRY_HUK_OLAY(dosya_id, tarih);
    CREATE INDEX IX_KRY_HUK_OLAY_tarih ON KRY_HUK_OLAY(tamam, tarih);
END

IF OBJECT_ID('KRY_HUK_BELGE') IS NULL
BEGIN
    CREATE TABLE KRY_HUK_BELGE (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        dosya_id    INT            NULL,
        yazi_id     INT            NULL,
        ad          NVARCHAR(250)  NOT NULL,
        yol         NVARCHAR(400)  NOT NULL,
        icerik_turu NVARCHAR(120)  NULL,
        boyut       BIGINT         NOT NULL DEFAULT 0,
        yukleyen    NVARCHAR(80)   NULL,
        yukleyen_ad NVARCHAR(150)  NULL,
        silindi     BIT            NOT NULL DEFAULT 0,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_HUK_BELGE_dosya ON KRY_HUK_BELGE(dosya_id, silindi);
    CREATE INDEX IX_KRY_HUK_BELGE_yazi ON KRY_HUK_BELGE(yazi_id);
END

IF OBJECT_ID('KRY_HUK_YAZI') IS NULL
BEGIN
    CREATE TABLE KRY_HUK_YAZI (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        kayit_no       NVARCHAR(30)   NOT NULL,
        dosya_id       INT            NULL,
        yanit_id       INT            NULL,
        konu           NVARCHAR(250)  NOT NULL,
        metin          NVARCHAR(MAX)  NOT NULL,
        gonderen       NVARCHAR(80)   NOT NULL,
        gonderen_ad    NVARCHAR(150)  NULL,
        gonderen_kurum NVARCHAR(200)  NULL,
        cevap_suresi   DATETIME2      NULL,
        olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE UNIQUE INDEX UX_KRY_HUK_YAZI_no ON KRY_HUK_YAZI(kayit_no);
    CREATE INDEX IX_KRY_HUK_YAZI_dosya ON KRY_HUK_YAZI(dosya_id, id DESC);
    CREATE TABLE KRY_HUK_YAZI_KUTU (
        yazi_id   INT           NOT NULL,
        anahtar   NVARCHAR(80)  NOT NULL,
        rol       NVARCHAR(10)  NOT NULL,
        okundu    DATETIME2     NULL,
        okuyan_ad NVARCHAR(150) NULL,
        arsiv     BIT           NOT NULL DEFAULT 0,
        CONSTRAINT PK_KRY_HUK_YAZI_KUTU PRIMARY KEY (yazi_id, anahtar)
    );
    CREATE INDEX IX_KRY_HUK_YAZI_KUTU_anahtar ON KRY_HUK_YAZI_KUTU(anahtar, yazi_id DESC);
END

IF OBJECT_ID('KRY_HUK_DANISMAN') IS NULL
BEGIN
    CREATE TABLE KRY_HUK_DANISMAN (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        kullanici_adi NVARCHAR(60)   NOT NULL,
        ad_soyad      NVARCHAR(150)  NOT NULL,
        unvan         NVARCHAR(60)   NULL,
        kurum         NVARCHAR(200)  NULL,
        eposta        NVARCHAR(150)  NULL,
        telefon       NVARCHAR(20)   NULL,
        parola_hash   NVARCHAR(200)  NOT NULL,
        parola_salt   NVARCHAR(100)  NOT NULL,
        aktif         BIT            NOT NULL DEFAULT 1,
        son_giris     DATETIME2      NULL,
        olusturan     NVARCHAR(80)   NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE UNIQUE INDEX UX_KRY_HUK_DANISMAN_k ON KRY_HUK_DANISMAN(kullanici_adi);
    CREATE TABLE KRY_HUK_DANISMAN_KOD (
        gecici     NVARCHAR(40)  NOT NULL PRIMARY KEY,
        danisman_id INT          NOT NULL,
        kod        NVARCHAR(10)  NOT NULL,
        gecerlilik DATETIME2     NOT NULL,
        deneme     INT           NOT NULL DEFAULT 0,
        kullanildi BIT           NOT NULL DEFAULT 0
    );
END

-- Hukuk danışmanı TC + telefon + SMS ile giriş (24.10.2026): TC yalnız özet olarak
IF COL_LENGTH('KRY_HUK_DANISMAN', 'tc_ozet') IS NULL
    ALTER TABLE KRY_HUK_DANISMAN ADD tc_ozet NVARCHAR(64) NULL, tc_son NVARCHAR(2) NULL;
IF COL_LENGTH('KRY_HUK_DANISMAN_KOD', 'olusturma') IS NULL
    ALTER TABLE KRY_HUK_DANISMAN_KOD ADD olusturma DATETIME2 NOT NULL CONSTRAINT DF_KRY_HUK_DKOD_olus DEFAULT SYSDATETIME();
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_HUK_DANISMAN_tc')
    EXEC('CREATE INDEX IX_KRY_HUK_DANISMAN_tc ON KRY_HUK_DANISMAN(tc_ozet)');

IF OBJECT_ID('KRY_HUK_EKIP') IS NULL
    CREATE TABLE KRY_HUK_EKIP (
        anahtar   NVARCHAR(80)  NOT NULL PRIMARY KEY,
        ad        NVARCHAR(150) NULL,
        rol       NVARCHAR(10)  NOT NULL DEFAULT N'hukuk',
        ekleyen   NVARCHAR(80)  NULL,
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

IF OBJECT_ID('KRY_HUK_ERISIM') IS NULL
    CREATE TABLE KRY_HUK_ERISIM (
        dosya_id  INT           NOT NULL,
        anahtar   NVARCHAR(80)  NOT NULL,
        hak       NVARCHAR(10)  NOT NULL DEFAULT N'standart',
        ekleyen   NVARCHAR(80)  NULL,
        olusturma DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_HUK_ERISIM PRIMARY KEY (dosya_id, anahtar)
    );

IF OBJECT_ID('KRY_HUK_LOG') IS NULL
BEGIN
    CREATE TABLE KRY_HUK_LOG (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        anahtar   NVARCHAR(80)  NULL,
        ad        NVARCHAR(150) NULL,
        islem     NVARCHAR(40)  NOT NULL,
        dosya_id  INT           NULL,
        hedef     NVARCHAR(300) NULL,
        ip        NVARCHAR(60)  NULL,
        zaman     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_HUK_LOG_dosya ON KRY_HUK_LOG(dosya_id, id DESC);
    CREATE TABLE KRY_HUK_HATIRLATMA (
        anahtar  NVARCHAR(60) NOT NULL PRIMARY KEY,
        zaman    DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Havuz dagitimi duzeltmesi (23.10.2026): onaylanan dagitimlar havuzdan dusulmuyordu
-- (alt sorguda yanlis sutun adi). Eksik kullanim hareketleri tamamlanir; tekrar calisinca eklemez.
IF COL_LENGTH('KRY_PUAN_TALEP', 'havuz_kodu') IS NOT NULL AND OBJECT_ID('KRY_HAVUZ_HAREKET') IS NOT NULL
    EXEC(N'
INSERT INTO KRY_HAVUZ_HAREKET (sube_kodu, sube_adi, tarih, tur, tutar, aciklama, kaydeden)
SELECT t.havuz_kodu,
       (SELECT TOP 1 s.sube FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id),
       CAST(ISNULL(t.karar_tarihi, t.olusturma) AS DATE), N''kullanim'', t.toplam_puan,
       N''Biçen Kart dağıtımı · '' + CAST(t.kart_sayisi AS NVARCHAR(10)) + N'' kişi · puan talebi #'' + CAST(t.id AS NVARCHAR(10)),
       t.talep_eden
FROM KRY_PUAN_TALEP t
WHERE t.durum = N''onaylandi'' AND t.havuz_kodu IS NOT NULL AND LTRIM(RTRIM(t.havuz_kodu)) <> N''''
  AND NOT EXISTS (SELECT 1 FROM KRY_HAVUZ_HAREKET h
                  WHERE h.sube_kodu = t.havuz_kodu AND h.aciklama LIKE N''%puan talebi #'' + CAST(t.id AS NVARCHAR(10)))');

-- Toplu bildirim kuyrugu (21.10.2026): yuzlerce kisiye ayni anda gitmesin, dakikaya yayilsin
IF OBJECT_ID('KRY_BILDIRIM_KUYRUK') IS NULL
BEGIN
    CREATE TABLE KRY_BILDIRIM_KUYRUK (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        baslik       NVARCHAR(200)  NOT NULL,
        metin        NVARCHAR(1000) NOT NULL,
        ekran        NVARCHAR(60)   NULL,
        planlanan    DATETIME2      NOT NULL,
        gonderildi   DATETIME2      NULL,
        olusturma    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_BILDIRIM_KUYRUK_bekleyen ON KRY_BILDIRIM_KUYRUK(gonderildi, planlanan);
END

-- Onay yazismasi (22.10.2026): onaylayanin sorusu ve isteyenin yaniti
IF OBJECT_ID('KRY_ONAY_MESAJ') IS NULL
BEGIN
    CREATE TABLE KRY_ONAY_MESAJ (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        onay_id    INT            NOT NULL,
        tur        NVARCHAR(10)   NOT NULL,
        metin      NVARCHAR(1000) NOT NULL,
        kullanici  NVARCHAR(60)   NULL,
        ad_soyad   NVARCHAR(120)  NULL,
        tarih      DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_ONAY_MESAJ_onay ON KRY_ONAY_MESAJ(onay_id, id);
END

-- Sohbet (22.10.2026): gruplar ve ozel mesajlar
IF OBJECT_ID('KRY_SOHBET') IS NULL
BEGIN
    CREATE TABLE KRY_SOHBET (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        tur               NVARCHAR(10)  NOT NULL,
        ad                NVARCHAR(120) NULL,
        duyuru            BIT           NOT NULL DEFAULT 0,
        yonetici_ekler    BIT           NOT NULL DEFAULT 1,
        olusturan         NVARCHAR(60)  NOT NULL,
        olusturma         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        son_mesaj_zamani  DATETIME2     NULL
    );
    CREATE TABLE KRY_SOHBET_UYE (
        sohbet_id     INT          NOT NULL,
        kullanici     NVARCHAR(60) NOT NULL,
        uye_turu      NVARCHAR(10) NOT NULL DEFAULT N'panel',
        yonetici      BIT          NOT NULL DEFAULT 0,
        son_okunan    INT          NOT NULL DEFAULT 0,
        sessiz        BIT          NOT NULL DEFAULT 0,
        eklenme       DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        ayrildi       DATETIME2    NULL,
        CONSTRAINT PK_KRY_SOHBET_UYE PRIMARY KEY (sohbet_id, kullanici)
    );
    CREATE INDEX IX_KRY_SOHBET_UYE_kullanici ON KRY_SOHBET_UYE(kullanici, ayrildi);
    CREATE TABLE KRY_SOHBET_MESAJ (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        sohbet_id   INT            NOT NULL,
        gonderen    NVARCHAR(60)   NULL,
        tur         NVARCHAR(10)   NOT NULL DEFAULT N'metin',
        metin       NVARCHAR(4000) NULL,
        yanit_id    INT            NULL,
        dosya_yol   NVARCHAR(300)  NULL,
        dosya_ad    NVARCHAR(200)  NULL,
        dosya_tur   NVARCHAR(100)  NULL,
        dosya_boyut BIGINT         NULL,
        silindi     BIT            NOT NULL DEFAULT 0,
        tarih       DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_SOHBET_MESAJ_sohbet ON KRY_SOHBET_MESAJ(sohbet_id, id);
END

-- Sohbet mesaj duzenleme ve dosya sikistirma (22.10.2026)
IF OBJECT_ID('KRY_SOHBET_MESAJ') IS NOT NULL AND COL_LENGTH('KRY_SOHBET_MESAJ', 'duzenlendi') IS NULL
    ALTER TABLE KRY_SOHBET_MESAJ ADD duzenlendi DATETIME2 NULL;
IF OBJECT_ID('KRY_SOHBET_MESAJ') IS NOT NULL AND COL_LENGTH('KRY_SOHBET_MESAJ', 'degisme') IS NULL
    ALTER TABLE KRY_SOHBET_MESAJ ADD degisme DATETIME2 NULL;
IF OBJECT_ID('KRY_SOHBET_MESAJ') IS NOT NULL AND COL_LENGTH('KRY_SOHBET_MESAJ', 'dosya_kaldirildi') IS NULL
    ALTER TABLE KRY_SOHBET_MESAJ ADD dosya_kaldirildi BIT NOT NULL DEFAULT 0;
IF OBJECT_ID('KRY_SOHBET_MESAJ') IS NOT NULL AND COL_LENGTH('KRY_SOHBET_MESAJ', 'disk_boyut') IS NULL
    ALTER TABLE KRY_SOHBET_MESAJ ADD disk_boyut BIGINT NULL;

-- Izin turleri (23.10.2026): mazeret ve yarim gun izni kaldirildi, raporlu eklendi.
-- Bir kez calisir (KRY_AYARLAR isareti); IK sonradan turu yeniden acarsa dokunulmaz.
IF OBJECT_ID('KRY_IZIN_TURU') IS NOT NULL AND OBJECT_ID('KRY_AYARLAR') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = N'IZIN_TURU_20261023')
BEGIN
    UPDATE KRY_IZIN_TURU SET aktif = 0, guncelleyen = N'23.10.2026 duzenlemesi', guncelleme = SYSDATETIME()
    WHERE aktif = 1 AND (ad LIKE N'%mazeret%' OR sure_turu = N'yarim');

    IF EXISTS (SELECT 1 FROM KRY_IZIN_TURU WHERE ad LIKE N'%rapor%')
        UPDATE KRY_IZIN_TURU SET aktif = 1, bakiyeden_duser = 0, sure_turu = N'tam', belge_gerekli = 0,
               guncelleyen = N'23.10.2026 duzenlemesi', guncelleme = SYSDATETIME()
        WHERE ad LIKE N'%rapor%';
    ELSE
        INSERT INTO KRY_IZIN_TURU (ad, bakiyeden_duser, sure_turu, aciklama, sira, aktif, belge_gerekli, guncelleyen)
        VALUES (N'Raporlu', 0, N'tam', N'Rapor belgesiyle; bakiyeden düşmez', 25, 1, 0, N'23.10.2026 duzenlemesi');

    INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme) VALUES (N'IZIN_TURU_20261023', N'1', SYSDATETIME());
END

-- Devamsizlik (23.10.2026): birim yoneticisi okutma olmayan gune devamsizlik girer;
-- IK listeler, personele bildirim ve SMS gonderir
IF OBJECT_ID('KRY_DEVAMSIZLIK') IS NULL
BEGIN
    CREATE TABLE KRY_DEVAMSIZLIK (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(150) NULL,
        sube          NVARCHAR(100) NULL,
        pozisyon      NVARCHAR(100) NULL,
        tarih         DATE          NOT NULL,
        aciklama      NVARCHAR(500) NULL,
        giren         NVARCHAR(30)  NULL,
        giren_ad      NVARCHAR(150) NULL,
        kaynak        NVARCHAR(20)  NOT NULL DEFAULT N'mobil',
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        iptal         BIT           NOT NULL DEFAULT 0,
        iptal_eden    NVARCHAR(150) NULL,
        iptal_tarih   DATETIME2     NULL,
        iptal_not     NVARCHAR(300) NULL
    );
    CREATE INDEX IX_KRY_DEVAMSIZLIK_kod ON KRY_DEVAMSIZLIK(personel_kodu, iptal, tarih);
    CREATE INDEX IX_KRY_DEVAMSIZLIK_tarih ON KRY_DEVAMSIZLIK(iptal, tarih);
END

IF OBJECT_ID('KRY_DEVAMSIZLIK_ISLEM') IS NULL
BEGIN
    CREATE TABLE KRY_DEVAMSIZLIK_ISLEM (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)   NOT NULL,
        tur           NVARCHAR(20)   NOT NULL,
        metin         NVARCHAR(1000) NULL,
        tarihler      NVARCHAR(500)  NULL,
        sonuc         NVARCHAR(300)  NULL,
        yapan         NVARCHAR(150)  NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_DEVAMSIZLIK_ISLEM_kod ON KRY_DEVAMSIZLIK_ISLEM(personel_kodu, olusturma);
END

-- Devamsizlik tutanagi (26.10.2026): aciklama ve iki sahit zorunlu; tutanak mail gider,
-- giren imzali tutanagi yukler, sahitler Bicen360'tan onaylar. Devamsizlik kaydi hemen islenir;
-- tutanak durumu ayrica izlenir.
IF OBJECT_ID('KRY_DEVAMSIZLIK_TUTANAK') IS NULL
BEGIN
    CREATE TABLE KRY_DEVAMSIZLIK_TUTANAK (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu    NVARCHAR(30)  NOT NULL,
        ad_soyad         NVARCHAR(150) NULL,
        sube             NVARCHAR(100) NULL,
        pozisyon         NVARCHAR(100) NULL,
        tarih_bas        DATE          NOT NULL,
        tarih_bit        DATE          NOT NULL,
        tarihler         NVARCHAR(500) NULL,
        aciklama         NVARCHAR(500) NOT NULL,
        giren            NVARCHAR(30)  NOT NULL,
        giren_ad         NVARCHAR(150) NULL,
        giren_pozisyon   NVARCHAR(100) NULL,
        sahit1_kodu      NVARCHAR(30)  NOT NULL,
        sahit1_ad        NVARCHAR(150) NULL,
        sahit1_pozisyon  NVARCHAR(100) NULL,
        sahit1_durum     NVARCHAR(20)  NOT NULL DEFAULT N'bekliyor',
        sahit1_tarih     DATETIME2     NULL,
        sahit1_not       NVARCHAR(500) NULL,
        sahit2_kodu      NVARCHAR(30)  NOT NULL,
        sahit2_ad        NVARCHAR(150) NULL,
        sahit2_pozisyon  NVARCHAR(100) NULL,
        sahit2_durum     NVARCHAR(20)  NOT NULL DEFAULT N'bekliyor',
        sahit2_tarih     DATETIME2     NULL,
        sahit2_not       NVARCHAR(500) NULL,
        form_eposta      NVARCHAR(400) NULL,
        form_gonderim    DATETIME2     NULL,
        form_hata        NVARCHAR(500) NULL,
        belge_dosya      NVARCHAR(260) NULL,
        belge_ozgun_ad   NVARCHAR(260) NULL,
        belge_tarihi     DATETIME2     NULL,
        belge_yukleyen   NVARCHAR(150) NULL,
        iptal            BIT           NOT NULL DEFAULT 0,
        olusturma        DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_DEVAMSIZLIK_TUTANAK_kod ON KRY_DEVAMSIZLIK_TUTANAK(personel_kodu, iptal, tarih_bas);
    CREATE INDEX IX_KRY_DEVAMSIZLIK_TUTANAK_giren ON KRY_DEVAMSIZLIK_TUTANAK(giren, iptal);
    CREATE INDEX IX_KRY_DEVAMSIZLIK_TUTANAK_sahit1 ON KRY_DEVAMSIZLIK_TUTANAK(sahit1_kodu, sahit1_durum);
    CREATE INDEX IX_KRY_DEVAMSIZLIK_TUTANAK_sahit2 ON KRY_DEVAMSIZLIK_TUTANAK(sahit2_kodu, sahit2_durum);
END

IF OBJECT_ID('KRY_DEVAMSIZLIK') IS NOT NULL AND COL_LENGTH('KRY_DEVAMSIZLIK', 'tutanak_id') IS NULL
    ALTER TABLE KRY_DEVAMSIZLIK ADD tutanak_id INT NULL;

-- Raporlu izin talebinin personel kartindaki rapor kaydi (23.10.2026)
IF OBJECT_ID('KRY_PERSONEL_RAPOR') IS NOT NULL AND COL_LENGTH('KRY_PERSONEL_RAPOR', 'izin_talep_id') IS NULL
    ALTER TABLE KRY_PERSONEL_RAPOR ADD izin_talep_id INT NULL;

-- Duyurulara baglanti ve gorsel eklendi
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'baglanti') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD baglanti NVARCHAR(500) NULL;

IF COL_LENGTH('KRY_MOBIL_DUYURU', 'baglanti_yazi') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD baglanti_yazi NVARCHAR(120) NULL;

IF COL_LENGTH('KRY_MOBIL_DUYURU', 'gorsel') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD gorsel VARBINARY(MAX) NULL;

IF COL_LENGTH('KRY_MOBIL_DUYURU', 'hedef_tur') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD hedef_tur NVARCHAR(30) NULL;

-- Cihaz eslestirmesi: bir personel tek cihazda oturum acabilir.
--
-- Cihaz degistirme ayda bir kez serbesttir. Sinirsiz olsaydi kimlik ve
-- telefonu bilen biri kendi telefonuna kolayca gecebilirdi; hic izin
-- verilmeseydi telefon degistiren personel kilitlenirdi.
-- Fazla mesai (06.10.2026): yönetici mobilden girer, form (İK-FM-01)
-- doldurulup şubenin mailine gider; çalışan, birim yöneticisi ve bölge
-- müdürü imzalar, ıslak imzalı form İK'ya fiziki gönderilir. İK panelde
-- Personel Talepleri > Fazla mesai'den evrakı yükleyip onaylar.
-- durum: bekliyor (evrak / İK onayı bekleniyor), onaylandi, reddedildi, iptal
IF OBJECT_ID('KRY_FAZLA_MESAI') IS NULL
BEGIN
    CREATE TABLE KRY_FAZLA_MESAI (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu    NVARCHAR(30)  NOT NULL,
        ad_soyad         NVARCHAR(120) NULL,
        sube             NVARCHAR(120) NULL,
        gorev            NVARCHAR(120) NULL,
        tarih            DATE          NOT NULL,
        baslangic        NVARCHAR(5)   NOT NULL,
        bitis            NVARCHAR(5)   NOT NULL,
        sure_dk          INT           NOT NULL,
        aciklama         NVARCHAR(500) NULL,
        talep_eden       NVARCHAR(30)  NULL,
        talep_eden_ad    NVARCHAR(120) NULL,
        birim_yonetici   NVARCHAR(200) NULL,
        bolge_muduru     NVARCHAR(200) NULL,
        durum            NVARCHAR(20)  NOT NULL DEFAULT N'bekliyor',
        form_eposta      NVARCHAR(400) NULL,
        form_gonderim    DATETIME2     NULL,
        form_hata        NVARCHAR(500) NULL,
        belge_id         INT           NULL,
        belge_yukleyen   NVARCHAR(100) NULL,
        belge_tarihi     DATETIME2     NULL,
        karar_veren      NVARCHAR(100) NULL,
        karar_tarihi     DATETIME2     NULL,
        karar_notu       NVARCHAR(500) NULL,
        iptal_eden       NVARCHAR(100) NULL,
        olusturma        DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_FAZLA_MESAI_personel ON KRY_FAZLA_MESAI(personel_kodu, tarih DESC);
    CREATE INDEX IX_KRY_FAZLA_MESAI_durum ON KRY_FAZLA_MESAI(durum, olusturma DESC);
END

-- Fazla mesai onay akışı (08.10.2026): yıllık izinle aynı. Giren yönetici
-- 1. aşama; üst yönetici (durum 'ust') 2. aşama; İK ('bekliyor') son onay.
IF OBJECT_ID('KRY_FAZLA_MESAI') IS NOT NULL AND COL_LENGTH('KRY_FAZLA_MESAI', 'ust_karar') IS NULL
    ALTER TABLE KRY_FAZLA_MESAI ADD
        onay_sube  NVARCHAR(150) NULL,
        ust_karar  NVARCHAR(20)  NULL,
        ust_kisi   NVARCHAR(100) NULL,
        ust_tarih  DATETIME2     NULL,
        ust_not    NVARCHAR(500) NULL;

-- Bölge müdürünün yüklediği imzalı form (09.10.2026): üst yönetici onaydan
-- önce Biçen360'tan yükler; İK son imzalı formu ayrıca (belge_id) yükler.
IF OBJECT_ID('KRY_FAZLA_MESAI') IS NOT NULL AND COL_LENGTH('KRY_FAZLA_MESAI', 'bolge_belge_id') IS NULL
    ALTER TABLE KRY_FAZLA_MESAI ADD
        bolge_belge_id       INT           NULL,
        bolge_belge_yukleyen NVARCHAR(100) NULL,
        bolge_belge_tarihi   DATETIME2     NULL;

-- Personelin kendi e-postası (13.10.2026): genel merkez ve depodaki
-- bilgisayarlı personelin izin / fazla mesai formu İK yerine kendi mailine
-- gider; personel çıktıyı imzalatıp uygulamadan yükler. Şubeler değişmez.
IF OBJECT_ID('KRY_PERSONEL_EPOSTA') IS NULL
    CREATE TABLE KRY_PERSONEL_EPOSTA (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        eposta        NVARCHAR(200) NOT NULL,
        guncelleyen   NVARCHAR(100) NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

IF OBJECT_ID('KRY_IZIN_TALEP') IS NOT NULL AND COL_LENGTH('KRY_IZIN_TALEP', 'form_kisisel') IS NULL
    ALTER TABLE KRY_IZIN_TALEP ADD form_kisisel BIT NULL;

-- Fazla mesai akış kuralları (14.10.2026, Yönetim › Fazla mesai akışı):
-- iş yeri + personel pozisyonu + giren → ara onaylar (İK hep sonda) ve
-- form maili. Kayda akış JSON olarak yazılıyor; kural yoksa eski akış.
IF OBJECT_ID('KRY_FM_AKIS_KURAL') IS NULL
    CREATE TABLE KRY_FM_AKIS_KURAL (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        sira         INT            NOT NULL DEFAULT(0),
        ad           NVARCHAR(150)  NULL,
        is_yeri      NVARCHAR(150)  NOT NULL DEFAULT(N'*'),
        pozisyon     NVARCHAR(150)  NOT NULL DEFAULT(N'*'),
        giren        NVARCHAR(150)  NOT NULL DEFAULT(N'*'),
        giren_sicil  NVARCHAR(30)   NULL,
        adimlar      NVARCHAR(2000) NOT NULL DEFAULT(N'[]'),
        eposta_mod   NVARCHAR(20)   NOT NULL DEFAULT(N'varsayilan'),
        eposta       NVARCHAR(500)  NULL,
        aktif        BIT            NOT NULL DEFAULT(1),
        guncelleyen  NVARCHAR(100)  NULL,
        guncelleme   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

IF OBJECT_ID('KRY_FAZLA_MESAI') IS NOT NULL AND COL_LENGTH('KRY_FAZLA_MESAI', 'akis') IS NULL
    ALTER TABLE KRY_FAZLA_MESAI ADD akis NVARCHAR(MAX) NULL;

-- Fazla mesai ücret kuralları (15.10.2026, Yönetim › Fazla mesai ücret
-- kuralları): kapsam + gün türü → ücret ya da serbest zaman, çarpan.
-- İlk kurulumda bugünkü hesapla aynı üç genel kural (×1,5 ücret).
IF OBJECT_ID('KRY_FM_UCRET_KURAL') IS NULL
BEGIN
    CREATE TABLE KRY_FM_UCRET_KURAL (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        sira         INT            NOT NULL DEFAULT(0),
        ad           NVARCHAR(150)  NULL,
        is_yeri      NVARCHAR(150)  NOT NULL DEFAULT(N'*'),
        pozisyon     NVARCHAR(150)  NOT NULL DEFAULT(N'*'),
        sicil        NVARCHAR(30)   NULL,
        gun_turu     NVARCHAR(20)   NOT NULL DEFAULT(N'*'),
        karsilik     NVARCHAR(10)   NOT NULL DEFAULT(N'ucret'),
        carpan       DECIMAL(5,2)   NOT NULL DEFAULT(1.5),
        aktif        BIT            NOT NULL DEFAULT(1),
        guncelleyen  NVARCHAR(100)  NULL,
        guncelleme   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

    INSERT INTO KRY_FM_UCRET_KURAL (sira, ad, gun_turu, karsilik, carpan, guncelleyen) VALUES
        (10, N'Normal gün', N'normal', N'ucret', 1.5, N'ilk kurulum'),
        (20, N'Hafta tatili', N'hafta', N'ucret', 1.5, N'ilk kurulum'),
        (30, N'Resmi tatil', N'resmi', N'ucret', 1.5, N'ilk kurulum'),
        (40, N'Arife', N'arife', N'ucret', 1.5, N'ilk kurulum');
END

IF OBJECT_ID('KRY_FAZLA_MESAI') IS NOT NULL AND COL_LENGTH('KRY_FAZLA_MESAI', 'form_kisisel') IS NULL
    ALTER TABLE KRY_FAZLA_MESAI ADD form_kisisel BIT NULL;

-- Birim yöneticisi onayı (09.10.2026): imzalı formu yükleyip onaylayan
IF OBJECT_ID('KRY_FAZLA_MESAI') IS NOT NULL AND COL_LENGTH('KRY_FAZLA_MESAI', 'birim_onay') IS NULL
    ALTER TABLE KRY_FAZLA_MESAI ADD
        birim_onay        NVARCHAR(100) NULL,
        birim_onay_tarihi DATETIME2     NULL;

-- Biçen360 kurulum daveti (06.10.2026): Mikro'da işe girişi yapılıp
-- çalışıyor görünen personele bir kez SMS. Aynı sicil ve giriş tarihi
-- için ikinci kez gitmez; yeniden işe girişte yeni giriş tarihiyle gider.
IF OBJECT_ID('KRY_UYGULAMA_DAVET') IS NULL
BEGIN
    CREATE TABLE KRY_UYGULAMA_DAVET (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube          NVARCHAR(120) NULL,
        gorev         NVARCHAR(120) NULL,
        giris_tarihi  DATE          NULL,
        telefon       NVARCHAR(20)  NULL,
        durum         NVARCHAR(20)  NOT NULL,
        hata          NVARCHAR(400) NULL,
        gonderen      NVARCHAR(100) NULL,
        tarih         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_UYGULAMA_DAVET_personel ON KRY_UYGULAMA_DAVET(personel_kodu, giris_tarihi);
END

-- Talep eksik bildirimi (07.10.2026): İK, Personel Talepleri'nden
-- talepteki eksiği (yüklenmeyen evrak, ulaşmayan ıslak imzalı form,
-- hatalı tarih vb.) bildirir. Personel bildirim + duyuru alır, uygulamayı
-- açınca ana sayfada kart görür. Fazla mesaide hedef formu giren yöneticidir.
-- tur: izin · avans · fazlamesai · itiraz
-- durum: acik · tamamlandi (personel tamamladım dedi / evrak yükledi) · kapandi
-- İzin kontenjanı elle düzeltme (07.10.2026): şube × ay. gun NULL ise
-- otomatik hesap geçerli; kapali = 1 ise o ay şubede yıllık izin seçilemez.
IF OBJECT_ID('KRY_IZIN_KONTENJAN') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_KONTENJAN (
        sube         NVARCHAR(120) NOT NULL,
        yil          INT           NOT NULL,
        ay           INT           NOT NULL,
        gun          INT           NULL,
        kapali       BIT           NOT NULL DEFAULT 0,
        guncelleyen  NVARCHAR(120) NULL,
        guncelleme   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_IZIN_KONTENJAN PRIMARY KEY (sube, yil, ay)
    );
END

-- İşe alımda tanımlanan Biçen Kart (07.10.2026): adayın henüz sicili yok;
-- kart başvuruya bağlı bekler, Mikro'ya TC ile girilince personele bağlanır.
IF OBJECT_ID('KRY_BASVURU_KART') IS NULL
BEGIN
    CREATE TABLE KRY_BASVURU_KART (
        basvuru_id     INT           NOT NULL PRIMARY KEY,
        kimlik_no      NVARCHAR(20)  NULL,
        ad_soyad       NVARCHAR(120) NULL,
        kart_no        NVARCHAR(50)  NOT NULL,
        giren          NVARCHAR(120) NULL,
        tarih          DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        personel_kodu  NVARCHAR(30)  NULL,
        baglanti       DATETIME2     NULL,
        hata           NVARCHAR(300) NULL
    );

    CREATE INDEX IX_KRY_BASVURU_KART_kart ON KRY_BASVURU_KART(kart_no);
END

IF OBJECT_ID('KRY_TALEP_EKSIK') IS NULL
BEGIN
    CREATE TABLE KRY_TALEP_EKSIK (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        tur              NVARCHAR(20)   NOT NULL,
        talep_id         INT            NOT NULL,
        personel_kodu    NVARCHAR(30)   NOT NULL,
        ad_soyad         NVARCHAR(120)  NULL,
        hedef_kodu       NVARCHAR(30)   NOT NULL,
        hedef_ad         NVARCHAR(120)  NULL,
        talep_ozet       NVARCHAR(200)  NULL,
        maddeler         NVARCHAR(1000) NULL,
        aciklama         NVARCHAR(600)  NULL,
        son_tarih        DATE           NULL,
        durum            NVARCHAR(20)   NOT NULL DEFAULT N'acik',
        gonderen         NVARCHAR(100)  NULL,
        gonderen_ad      NVARCHAR(120)  NULL,
        tarih            DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        duyuru_id        INT            NULL,
        jeton_var        BIT            NOT NULL DEFAULT 0,
        sms_durum        NVARCHAR(200)  NULL,
        goruldu          DATETIME2      NULL,
        hatirlatma       DATETIME2      NULL,
        hatirlatma_sayi  INT            NOT NULL DEFAULT 0,
        tamamlandi       DATETIME2      NULL,
        personel_notu    NVARCHAR(500)  NULL,
        kapandi          DATETIME2      NULL,
        kapatan          NVARCHAR(120)  NULL,
        kapanis_notu     NVARCHAR(300)  NULL
    );

    CREATE INDEX IX_KRY_TALEP_EKSIK_talep ON KRY_TALEP_EKSIK(tur, talep_id, tarih DESC);
    CREATE INDEX IX_KRY_TALEP_EKSIK_hedef ON KRY_TALEP_EKSIK(hedef_kodu, durum);
END

IF OBJECT_ID('KRY_MOBIL_CIHAZ') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_CIHAZ (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        cihaz_id      NVARCHAR(128) NOT NULL,
        cihaz_adi     NVARCHAR(120) NULL,
        isletim       NVARCHAR(30)  NULL,
        ilk_eslesme   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        son_degisim   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        son_giris     DATETIME2     NULL,
        oturum_acik   BIT           NOT NULL DEFAULT(1)
    );
END

-- Cihaz degisim gecmisi; suistimal suphesinde bakilir
IF OBJECT_ID('KRY_MOBIL_CIHAZ_GECMIS') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_CIHAZ_GECMIS (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        eski_cihaz    NVARCHAR(128) NULL,
        yeni_cihaz    NVARCHAR(128) NOT NULL,
        cihaz_adi     NVARCHAR(120) NULL,
        sebep         NVARCHAR(60)  NULL,
        yapan         NVARCHAR(60)  NULL,
        tarih         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_MOBIL_CIHAZ_GECMIS
        ON KRY_MOBIL_CIHAZ_GECMIS(personel_kodu, tarih DESC);
END

-- Vardiya giris cikislari. Karekod okutuldugunda kayit dusler.
IF OBJECT_ID('KRY_VARDIYA') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube_kodu     NVARCHAR(30)  NULL,
        sube_adi      NVARCHAR(120) NULL,
        tur           NVARCHAR(10)  NOT NULL,
        gecis_zamani  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),

        /* Konum dogrulamasi: izin verilmediyse bos kalir ve kayit
           isaretlenir. Konum yuzunden vardiya kaydinin yapilamamasi
           isletmeyi durdurur, bu yuzden zorunlu degildir. */
        /* DECIMAL(9,6) tam sayi kismina yalnizca uc basamak birakiyordu;
           hatali ya da beklenmedik bir deger tasma hatasi veriyordu.
           FLOAT hem yeterli hassasiyette hem de tasmiyor. */
        enlem         FLOAT         NULL,
        boylam        FLOAT         NULL,
        konum_dogru   BIT           NOT NULL DEFAULT(0),
        mesafe_metre  INT           NULL
    );

    CREATE INDEX IX_KRY_VARDIYA ON KRY_VARDIYA(personel_kodu, gecis_zamani DESC);
END

-- Okutmanın kaynağı: mobil karekod ya da kart geçiş sisteminden aktarım.
-- Geçmiş veri iCardBicen'den aktarıldığı için ayırt edilebilmeli; yeniden
-- aktarımda yalnızca kart kayıtları etkileniyor.
IF OBJECT_ID('KRY_VARDIYA') IS NOT NULL
   AND COL_LENGTH('KRY_VARDIYA', 'kaynak') IS NULL
    ALTER TABLE KRY_VARDIYA ADD kaynak NVARCHAR(10) NULL;

IF OBJECT_ID('KRY_VARDIYA') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_VARDIYA_kisi_zaman')
    CREATE INDEX IX_KRY_VARDIYA_kisi_zaman ON KRY_VARDIYA(personel_kodu, gecis_zamani);

-- Gunluk calisma sureleri; aylik mesai toplami buradan hesaplanir
IF OBJECT_ID('KRY_VARDIYA_GUN') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_GUN (
        personel_kodu NVARCHAR(30) NOT NULL,
        tarih         DATE         NOT NULL,
        ilk_giris     DATETIME2    NULL,
        son_cikis     DATETIME2    NULL,
        sure_dakika   INT          NOT NULL DEFAULT(0),
        izinli        BIT          NOT NULL DEFAULT(0),
        PRIMARY KEY (personel_kodu, tarih)
    );
END

-- Sube karekodlari. Kod duzenli yenilenir; ekran goruntusuyle uzaktan
-- okutma boylece engellenir.
IF OBJECT_ID('KRY_SUBE_KAREKOD') IS NULL
BEGIN
    CREATE TABLE KRY_SUBE_KAREKOD (
        sube_kodu   NVARCHAR(30)  NOT NULL PRIMARY KEY,
        sube_adi    NVARCHAR(120) NULL,
        kod         NVARCHAR(64)  NOT NULL,
        enlem       FLOAT         NULL,
        boylam      FLOAT         NULL,
        yenilenme   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

-- Subelerde zaten asili olan baska sistemin (iCard) vardiya karekodlari.
-- Yeni karekod basip asmak yerine mevcut kod subeye taniltiliyor: okunan
-- metin bu tabloda varsa o subenin okutmasi sayilir. Ayni kod birden cok
-- subede ayni olabilir (kod subeye ozel degilse); o zaman sube konumdan
-- ayirt edilir.
IF OBJECT_ID('KRY_SUBE_KAREKOD_HARICI') IS NULL
BEGIN
    CREATE TABLE KRY_SUBE_KAREKOD_HARICI (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        sube_kodu   NVARCHAR(30)  NOT NULL,
        sube_adi    NVARCHAR(120) NULL,
        kod         NVARCHAR(400) NOT NULL,
        kaynak      NVARCHAR(40)  NOT NULL DEFAULT N'iCard',
        tanimlayan  NVARCHAR(150) NULL,
        olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_SUBE_KAREKOD_HARICI_kod ON KRY_SUBE_KAREKOD_HARICI(kod);
END

-- Koordinat sutunlari FLOAT'a cevrilir. DECIMAL(9,6) dar geliyordu.
IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('KRY_SUBE_KAREKOD')
             AND name = 'enlem' AND system_type_id = 106)
BEGIN
    ALTER TABLE KRY_SUBE_KAREKOD ALTER COLUMN enlem FLOAT NULL;
    ALTER TABLE KRY_SUBE_KAREKOD ALTER COLUMN boylam FLOAT NULL;
END

IF EXISTS (SELECT 1 FROM sys.columns
           WHERE object_id = OBJECT_ID('KRY_VARDIYA')
             AND name = 'enlem' AND system_type_id = 106)
BEGIN
    ALTER TABLE KRY_VARDIYA ALTER COLUMN enlem FLOAT NULL;
    ALTER TABLE KRY_VARDIYA ALTER COLUMN boylam FLOAT NULL;
END

-- Duyurular. personel_kodu bos ise herkese aciktir.
IF OBJECT_ID('KRY_MOBIL_DUYURU') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_DUYURU (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        baslik        NVARCHAR(160) NOT NULL,
        metin         NVARCHAR(MAX) NOT NULL,
        personel_kodu NVARCHAR(30)  NULL,
        sube_kodu     NVARCHAR(30)  NULL,
        sube_adi      NVARCHAR(120) NULL,
        onemli        BIT           NOT NULL DEFAULT(0),
        gonderen      NVARCHAR(60)  NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        iptal         BIT           NOT NULL DEFAULT(0)
    );

    CREATE INDEX IX_KRY_MOBIL_DUYURU ON KRY_MOBIL_DUYURU(olusturma DESC);
END

IF COL_LENGTH('KRY_MOBIL_DUYURU', 'sube_adi') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD sube_adi NVARCHAR(120) NULL;

-- Duyurunun altında görünen imza: duyuruyu yapanın adı, pozisyonu ve
-- isterse kendi imza metni. Kullanıcı adı tek başına personele bir şey
-- söylemiyordu; duyurunun kimden geldiği belli olmalı.
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'yazan_ad') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD yazan_ad NVARCHAR(120) NULL;
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'yazan_unvan') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD yazan_unvan NVARCHAR(120) NULL;
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'imza') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD imza NVARCHAR(400) NULL;

-- Kullanıcının kendi imza metni: bir kez yazılıyor, sonraki duyurularda
-- hazır geliyor.
IF COL_LENGTH('KRY_KULLANICILAR', 'imza') IS NULL
    ALTER TABLE KRY_KULLANICILAR ADD imza NVARCHAR(400) NULL;

-- Duyuru hedefi: pozisyon, birden cok sube ya da secili kisiler. Alicilar
-- gonderim aninda yaziliyor; hedef_ozet listede Pozisyon: Kasiyer gibi
-- okunur bir aciklama.
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'hedef_ozet') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD hedef_ozet NVARCHAR(400) NULL;

-- Planli duyuru (27.10.2026): olusturma = yayin zamani; planli_bildirim = 1
-- iken bildirim henuz gitmedi (DuyuruPlanGorevi zamani gelince gonderir).
-- Personel listeleri olusturma <= simdi olanlari gosterir.
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'planli') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD planli BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('KRY_MOBIL_DUYURU', 'planli_bildirim') IS NULL
    ALTER TABLE KRY_MOBIL_DUYURU ADD planli_bildirim BIT NOT NULL DEFAULT 0;

IF OBJECT_ID('KRY_MOBIL_DUYURU_ALICI') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_DUYURU_ALICI (
        duyuru_id     INT          NOT NULL,
        personel_kodu NVARCHAR(30) NOT NULL,
        PRIMARY KEY (duyuru_id, personel_kodu)
    );
    CREATE INDEX IX_KRY_MOBIL_DUYURU_ALICI_kisi ON KRY_MOBIL_DUYURU_ALICI(personel_kodu);
END

-- Genel merkez ve depo departmanlari: ekip ve izin onayi buradan.
-- Bir kisi en fazla bir departmanda personel, birden cok departmanda
-- yonetici olabilir (kural kodda).
IF OBJECT_ID('KRY_DEPARTMAN') IS NULL
BEGIN
    CREATE TABLE KRY_DEPARTMAN (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        ad          NVARCHAR(120) NOT NULL,
        is_yeri     NVARCHAR(120) NULL,
        aciklama    NVARCHAR(300) NULL,
        sira        INT           NOT NULL DEFAULT(0),
        aktif       BIT           NOT NULL DEFAULT(1),
        olusturan   NVARCHAR(60)  NULL,
        olusturma   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        guncelleyen NVARCHAR(60)  NULL,
        guncelleme  DATETIME2     NULL
    );
END

IF OBJECT_ID('KRY_DEPARTMAN_UYE') IS NULL
BEGIN
    CREATE TABLE KRY_DEPARTMAN_UYE (
        departman_id  INT          NOT NULL,
        personel_kodu NVARCHAR(30) NOT NULL,
        rol           NVARCHAR(20) NOT NULL DEFAULT(N'personel'),
        ekleyen       NVARCHAR(60) NULL,
        ekleme        DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        PRIMARY KEY (departman_id, personel_kodu)
    );
    CREATE INDEX IX_KRY_DEPARTMAN_UYE_kisi ON KRY_DEPARTMAN_UYE(personel_kodu);
END

-- Dogum gunu kutlamasi her personele yilda bir kez gosterilir.
-- Uygulama ayni gunu yalnizca bellekte tutuyordu; kapatip acinca
-- pencere tekrar cikiyordu.
IF OBJECT_ID('KRY_MOBIL_DOGUMGUNU') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_DOGUMGUNU (
        personel_kodu NVARCHAR(30) NOT NULL,
        yil           INT          NOT NULL,
        gosterim      DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        PRIMARY KEY (personel_kodu, yil)
    );
END

-- Kimin hangi duyuruyu okudugu
IF OBJECT_ID('KRY_MOBIL_DUYURU_OKUMA') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_DUYURU_OKUMA (
        duyuru_id     INT          NOT NULL,
        personel_kodu NVARCHAR(30) NOT NULL,
        okuma         DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        PRIMARY KEY (duyuru_id, personel_kodu)
    );
END

-- Cikis anketi: isten ayrilan personele SMS ile gonderilen degerlendirme.
-- Her kayit kisiye ozel bir kod tasir; kod olmadan anket acilmaz.
-- Cikis nedeni ankette serbest metin olarak yaziliyor; 80 karakter dar
-- kaliyor ve uzun cevaplar kirpiliyordu.
IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'cikis_nedeni') IS NOT NULL
   AND COL_LENGTH('KRY_CIKIS_MULAKAT', 'cikis_nedeni') < 1000
    ALTER TABLE KRY_CIKIS_MULAKAT ALTER COLUMN cikis_nedeni NVARCHAR(500) NULL;

IF OBJECT_ID('KRY_CIKIS_ANKET') IS NULL
BEGIN
    CREATE TABLE KRY_CIKIS_ANKET (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        kod           NVARCHAR(12)  NOT NULL,
        personel_kodu NVARCHAR(30)  NULL,
        kimlik_no     NVARCHAR(15)  NULL,
        ad_soyad      NVARCHAR(120) NOT NULL,
        telefon       NVARCHAR(20)  NOT NULL,
        gorev         NVARCHAR(120) NULL,
        sube_adi      NVARCHAR(120) NULL,
        cikis_tarihi  DATE          NULL,
        gonderen      NVARCHAR(60)  NULL,
        gonderim      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        acilma        DATETIME2     NULL,
        dolduruldu    DATETIME2     NULL,
        mulakat_id    INT           NULL,
        iptal         BIT           NOT NULL DEFAULT(0)
    );

    CREATE UNIQUE INDEX UX_KRY_CIKIS_ANKET_kod ON KRY_CIKIS_ANKET(kod);
    CREATE INDEX IX_KRY_CIKIS_ANKET_kimlik ON KRY_CIKIS_ANKET(kimlik_no);
END

IF OBJECT_ID('KRY_PERSONEL_ANLIK') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_ANLIK (
        personel_kodu NVARCHAR(30)  NOT NULL PRIMARY KEY,
        veri_json     NVARCHAR(MAX) NOT NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
END

IF OBJECT_ID('KRY_PERSONEL_DEGISIM') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_DEGISIM (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        alan          NVARCHAR(60)  NOT NULL,
        eski_deger    NVARCHAR(300) NULL,
        yeni_deger    NVARCHAR(300) NULL,
        mikro_kullanici NVARCHAR(60) NULL,
        tarih         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE INDEX IX_KRY_PERSONEL_DEGISIM_kod
        ON KRY_PERSONEL_DEGISIM(personel_kodu, tarih DESC);
END

-- Mülakatın tek cümlelik özeti. Kayıt sırasında bir kez üretilip saklanır;
-- liste her açıldığında modele sormak hem yavaş hem gereksiz maliyet olur.
IF COL_LENGTH('KRY_CIKIS_MULAKAT', 'ozet') IS NULL
    ALTER TABLE KRY_CIKIS_MULAKAT ADD ozet NVARCHAR(400) NULL;

-- Izin talebinin hareket gunlugu: olusturma, kararlar, kime hangi
-- bildirimin gittigi, evrak, hatirlatma, form e-postasi, asli, iptal.
-- tur: olusturma | karar | bildirim | evrak | hatirlatma | form | asil | iptal
-- kanal: uygulama | sms | eposta | panel
IF OBJECT_ID('KRY_IZIN_TALEP_HAREKET') IS NULL
BEGIN
    CREATE TABLE KRY_IZIN_TALEP_HAREKET (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        talep_id  INT           NOT NULL,
        zaman     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        tur       NVARCHAR(30)  NOT NULL,
        baslik    NVARCHAR(200) NOT NULL,
        metin     NVARCHAR(900) NULL,
        kisi      NVARCHAR(150) NULL,
        hedef     NVARCHAR(300) NULL,
        kanal     NVARCHAR(30)  NULL
    );

    CREATE INDEX IX_KRY_IZIN_TALEP_HAREKET_talep ON KRY_IZIN_TALEP_HAREKET(talep_id, zaman);
    CREATE INDEX IX_KRY_IZIN_TALEP_HAREKET_zaman ON KRY_IZIN_TALEP_HAREKET(zaman DESC);
END

-- Personel kartindan yapilan degisiklikler (02.10.2026): Mikro'ya yazilan
-- alanlar (hedef MIKRO) ve kariyerde tutulan yol ucreti (hedef KARIYER).
-- Mikro'ya yazmadan ONCE eklenir (durum YAZILIYOR), sonra TAMAM ya da
-- BASARISIZ olur; eski deger burada kaldigi icin her degisiklik elle
-- geri alinabilir.
IF OBJECT_ID('KRY_PERSONEL_MIKRO_DEGISIKLIK') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_MIKRO_DEGISIKLIK (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        alan          NVARCHAR(60)  NOT NULL,
        eski          NVARCHAR(400) NULL,
        yeni          NVARCHAR(400) NULL,
        yapan         NVARCHAR(150) NULL,
        zaman         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        kolon         NVARCHAR(128) NULL,
        hedef         NVARCHAR(20)  NOT NULL DEFAULT N'MIKRO',
        durum         NVARCHAR(20)  NOT NULL DEFAULT N'TAMAM'
    );

    CREATE INDEX IX_KRY_PERSONEL_MIKRO_DEGISIKLIK_kod
        ON KRY_PERSONEL_MIKRO_DEGISIKLIK(personel_kodu, zaman DESC);
END

-- Ayrilan personelin Bicen Kart baglantisi (02.10.2026): isten ayrilan
-- personele SMS ile kisiye ozel bir baglanti gider (#/kart/KOD). Kisi TC
-- kimlik numarasiyla dogrular, kart sifresini belirler; sonra kart
-- numarasi ve barkod acilir. Baglanti ilk SMS'ten itibaren son_gecerlilik
-- tarihine kadar (varsayilan 30 gun) gecerli.
-- kimlik_hash: HMAC-SHA256(sunucu anahtari, kod + TC); TC'nin kendisi tutulmaz.
-- ay: gonderimin yapildigi cikis ayi ('2026-10').
IF OBJECT_ID('KRY_KART_AYRILAN_BAGLANTI') IS NULL
BEGIN
    CREATE TABLE KRY_KART_AYRILAN_BAGLANTI (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        kod              NVARCHAR(24)  NOT NULL,
        ay               CHAR(7)       NOT NULL,
        personel_kodu    NVARCHAR(30)  NOT NULL,
        ad_soyad         NVARCHAR(120) NULL,
        sube             NVARCHAR(120) NULL,
        pozisyon         NVARCHAR(120) NULL,
        cikis_tarihi     DATE          NULL,
        telefon          NVARCHAR(20)  NULL,
        kart_no          NVARCHAR(50)  NOT NULL,
        kimlik_hash      CHAR(64)      NULL,
        gonderim         DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        son_gecerlilik   DATETIME2     NOT NULL,
        gonderim_bakiye  DECIMAL(18,2) NULL,
        sms_durum        NVARCHAR(20)  NULL,
        sms_hata         NVARCHAR(400) NULL,
        sms_ilk          DATETIME2     NULL,
        sms_son          DATETIME2     NULL,
        sms_sayisi       INT           NOT NULL DEFAULT 0,
        gonderen         NVARCHAR(100) NULL,
        son_gonderen     NVARCHAR(100) NULL,
        ilk_acilis       DATETIME2     NULL,
        son_acilis       DATETIME2     NULL,
        acilis_sayisi    INT           NOT NULL DEFAULT 0,
        kimlik_dogrulama DATETIME2     NULL,
        son_dogrulama    DATETIME2     NULL,
        sifre_tarihi     DATETIME2     NULL,
        sifre_sayisi     INT           NOT NULL DEFAULT 0,
        sifre_gecersiz   DATETIME2     NULL,
        hatali_deneme    INT           NOT NULL DEFAULT 0,
        kilit_bitis      DATETIME2     NULL,
        kilit_sayisi     INT           NOT NULL DEFAULT 0,
        gorsel_indirme   DATETIME2     NULL,
        indirme_sayisi   INT           NOT NULL DEFAULT 0,
        son_bakiye       DECIMAL(18,2) NULL,
        bakiye_kontrol   DATETIME2     NULL,
        harcanan         DECIMAL(18,2) NULL,
        silinen          DECIMAL(18,2) NULL,
        ilk_kullanim     DATETIME2     NULL,
        son_kullanim     DATETIME2     NULL,
        tamamlandi       DATETIME2     NULL,
        suresi_doldu     DATETIME2     NULL,
        iptal            BIT           NOT NULL DEFAULT 0,
        iptal_tarihi     DATETIME2     NULL,
        iptal_eden       NVARCHAR(100) NULL,
        birakildi        DATETIME2     NULL,
        birakan          NVARCHAR(100) NULL,
        uzatma_sayisi    INT           NOT NULL DEFAULT 0,
        olusturma        DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX UX_KRY_KART_AYRILAN_BAGLANTI_kod ON KRY_KART_AYRILAN_BAGLANTI(kod);
    CREATE INDEX IX_KRY_KART_AYRILAN_BAGLANTI_personel ON KRY_KART_AYRILAN_BAGLANTI(personel_kodu, id);
    CREATE INDEX IX_KRY_KART_AYRILAN_BAGLANTI_ay ON KRY_KART_AYRILAN_BAGLANTI(ay, id);
END

-- Ayrilan personel kart baglantisinda taninan cihazlar: TC dogrulamasindan
-- sonra cihaza rastgele bir belirtec verilir (tarayicida localStorage ve
-- cerez). Burada yalnizca belirtecin HMAC ozeti durur.
-- gecerlilik: sifre belirlenene kadar 30 dakika, sonra 180 gun.
-- dogrulama: bu cihazdaki son TC dogrulamasi (sifre degistirmek icin taze olmali).
IF OBJECT_ID('KRY_KART_AYRILAN_CIHAZ') IS NULL
BEGIN
    CREATE TABLE KRY_KART_AYRILAN_CIHAZ (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        baglanti_id     INT           NOT NULL,
        token_ozet      CHAR(64)      NOT NULL,
        olusturma       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        gecerlilik      DATETIME2     NOT NULL,
        dogrulama       DATETIME2     NULL,
        son_kullanim    DATETIME2     NULL,
        kullanim_sayisi INT           NOT NULL DEFAULT 0,
        ip              NVARCHAR(64)  NULL,
        tarayici        NVARCHAR(200) NULL,
        iptal           BIT           NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX UX_KRY_KART_AYRILAN_CIHAZ_ozet ON KRY_KART_AYRILAN_CIHAZ(token_ozet);
    CREATE INDEX IX_KRY_KART_AYRILAN_CIHAZ_baglanti ON KRY_KART_AYRILAN_CIHAZ(baglanti_id);
END

-- Ayrilan personel kart baglantisinin gecmisi: SMS (basari/hata ve hata
-- metni), acilma, TC denemeleri, kilit, sifre, cihaz, gorsel indirme,
-- sure uzatma, iptal, karti bosa cikarma, bakiye silme, sure dolumu.
-- TC ve sifre burada da tutulmaz.
IF OBJECT_ID('KRY_KART_AYRILAN_OLAY') IS NULL
BEGIN
    CREATE TABLE KRY_KART_AYRILAN_OLAY (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        baglanti_id INT           NOT NULL,
        zaman       DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        tur         NVARCHAR(30)  NOT NULL,
        aciklama    NVARCHAR(500) NULL,
        yapan       NVARCHAR(100) NULL,
        ip          NVARCHAR(64)  NULL
    );

    CREATE INDEX IX_KRY_KART_AYRILAN_OLAY_baglanti ON KRY_KART_AYRILAN_OLAY(baglanti_id, zaman);
END

-- Kart baglantisinin turu (02.10.2026): 'ayrilan' (isten ayrilan personel)
-- ya da 'calisan' (hala calisan personel; karti Bicen360'ta da duruyor,
-- sure dolunca ya da bakiye bitince kart sifresine dokunulmaz). Var olan
-- satirlar 'ayrilan'.
IF COL_LENGTH('KRY_KART_AYRILAN_BAGLANTI', 'tur') IS NULL
    ALTER TABLE KRY_KART_AYRILAN_BAGLANTI
        ADD tur NVARCHAR(10) NOT NULL
            CONSTRAINT DF_KRY_KART_AYRILAN_BAGLANTI_tur DEFAULT N'ayrilan' WITH VALUES;");

        /* Tam sayı olarak açılmış norm kadro kolonları ondalığa çevrilir.
           Kolon eklemeleri bittikten sonra ayrı bir komut olarak çalışır.
           Dönüştürme başarısız olursa uygulama yine de açılır; yalnızca
           ondalıklı norm girişi kullanılamaz. */
        try
        {
            db.Execute(@"-- Norm kadro yarım kişi olabildiği için (24,5 gibi) ondalık tutulur.
-- Kolon tipi değiştirilmeden önce ona bağlı varsayılan değer kısıtları
-- kaldırılır; SQL Server aksi hâlde ALTER COLUMN işlemine izin vermez.
DECLARE @kadroKolonlari TABLE (kolon SYSNAME, bos BIT);

INSERT INTO @kadroKolonlari (kolon, bos)
VALUES ('norm', 1), ('mevcut', 1), ('engelli', 1), ('hedef', 0);

DECLARE @kolon SYSNAME, @bos BIT, @kisit SYSNAME, @komut NVARCHAR(500);

DECLARE kadro_imleci CURSOR LOCAL FAST_FORWARD FOR
    SELECT kolon, bos FROM @kadroKolonlari;

OPEN kadro_imleci;
FETCH NEXT FROM kadro_imleci INTO @kolon, @bos;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('KRY_KADRO')
                 AND name = @kolon
                 AND system_type_id = TYPE_ID('int'))
    BEGIN
        -- Varsa varsayılan değer kısıtı kaldırılır
        SELECT @kisit = dc.name
        FROM sys.default_constraints dc
        JOIN sys.columns c ON c.object_id = dc.parent_object_id
                          AND c.column_id = dc.parent_column_id
        WHERE dc.parent_object_id = OBJECT_ID('KRY_KADRO') AND c.name = @kolon;

        IF @kisit IS NOT NULL
        BEGIN
            SET @komut = 'ALTER TABLE KRY_KADRO DROP CONSTRAINT ' + QUOTENAME(@kisit);
            EXEC sp_executesql @komut;
        END

        SET @komut = 'ALTER TABLE KRY_KADRO ALTER COLUMN ' + QUOTENAME(@kolon) +
                     ' DECIMAL(7,1) ' + CASE WHEN @bos = 1 THEN 'NULL' ELSE 'NOT NULL' END;
        EXEC sp_executesql @komut;

        -- Kısıt aynı adla geri eklenir
        IF @kisit IS NOT NULL
        BEGIN
            SET @komut = 'ALTER TABLE KRY_KADRO ADD CONSTRAINT ' + QUOTENAME(@kisit) +
                         ' DEFAULT 0 FOR ' + QUOTENAME(@kolon);
            EXEC sp_executesql @komut;
        END

        SET @kisit = NULL;
    END

    FETCH NEXT FROM kadro_imleci INTO @kolon, @bos;
END

CLOSE kadro_imleci;
DEALLOCATE kadro_imleci;");
        }
        catch (Exception)
        {
            // Dönüştürme yapılamadıysa mevcut yapıyla devam edilir
        }

        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_BASVURULAR_ADRES')
CREATE INDEX IX_KRY_BASVURULAR_ADRES ON KRY_BASVURULAR (ilce, mahalle);");

        /* Vardiya türlerinin sınıfı (28.09.2026). Kolon ana betikte
           ekleniyor; aynı toplu komutta kullanılırsa SQL Server derleme
           anında "geçersiz kolon" diyor, bu yüzden ayrı çalışıyor.
           Varsayılan türler Sabahçı / Aracı / Akşamcı adını alıyor. */
        try
        {
            db.Execute(@"
UPDATE KRY_VARDIYA_SABLON SET tip = N'sabah' WHERE tip IS NULL AND ad LIKE N'%abah%';
UPDATE KRY_VARDIYA_SABLON SET tip = N'aksam' WHERE tip IS NULL AND (ad LIKE N'%kşam%' OR ad LIKE N'%ksam%');
UPDATE KRY_VARDIYA_SABLON SET tip = N'araci' WHERE tip IS NULL AND ad LIKE N'Ara%';
UPDATE KRY_VARDIYA_SABLON SET ad = N'Sabahçı' WHERE ad = N'Sabah';
UPDATE KRY_VARDIYA_SABLON SET ad = N'Aracı'   WHERE ad = N'Ara';
UPDATE KRY_VARDIYA_SABLON SET ad = N'Akşamcı' WHERE ad = N'Akşam';");
        }
        catch (Exception)
        {
            // Sınıf addan da çıkarılıyor (VardiyaPlanController.TipBul); açılış durmasın
        }

        /* Okutma kuralları (03.10.2026): saha / konum (Hal) / muaf personel,
           özel okutma konumları, şubeye özel yarıçap, reddedilen okutmalar.
           Ayrı korunuyor: kurulamazsa okutma eski davranışla (150 m) sürer. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_OKUTMA_KONUM') IS NULL
BEGIN
    CREATE TABLE KRY_OKUTMA_KONUM (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        ad            NVARCHAR(120) NOT NULL,
        aciklama      NVARCHAR(300) NULL,
        enlem         FLOAT         NOT NULL,
        boylam        FLOAT         NOT NULL,
        yaricap_metre INT           NULL,
        qr_kod        NVARCHAR(64)  NOT NULL,
        aktif         BIT           NOT NULL DEFAULT(1),
        olusturan     NVARCHAR(150) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        guncelleyen   NVARCHAR(150) NULL,
        guncelleme    DATETIME2     NULL
    );
    CREATE UNIQUE INDEX UX_KRY_OKUTMA_KONUM_qr ON KRY_OKUTMA_KONUM(qr_kod);
END

IF OBJECT_ID('KRY_OKUTMA_KONUM_AYAR') IS NULL
    CREATE TABLE KRY_OKUTMA_KONUM_AYAR (
        sube_kodu     NVARCHAR(30)  NOT NULL PRIMARY KEY,
        yaricap_metre INT           NOT NULL,
        guncelleyen   NVARCHAR(150) NULL,
        guncelleme    DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );

IF OBJECT_ID('KRY_OKUTMA_KURAL') IS NULL
BEGIN
    CREATE TABLE KRY_OKUTMA_KURAL (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube          NVARCHAR(120) NULL,
        pozisyon      NVARCHAR(120) NULL,
        tur           NVARCHAR(10)  NOT NULL,
        kendi_subesi  BIT           NOT NULL DEFAULT(0),
        baslangic     DATE          NULL,
        bitis         DATE          NULL,
        aciklama      NVARCHAR(300) NULL,
        olusturan     NVARCHAR(150) NULL,
        olusturma     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        guncelleyen   NVARCHAR(150) NULL,
        guncelleme    DATETIME2     NULL
    );
    CREATE UNIQUE INDEX UX_KRY_OKUTMA_KURAL_kod ON KRY_OKUTMA_KURAL(personel_kodu);
END

IF OBJECT_ID('KRY_OKUTMA_KURAL_KONUM') IS NULL
    CREATE TABLE KRY_OKUTMA_KURAL_KONUM (
        kural_id INT NOT NULL,
        konum_id INT NOT NULL,
        PRIMARY KEY (kural_id, konum_id)
    );

IF OBJECT_ID('KRY_OKUTMA_KURAL_GUNLUK') IS NULL
BEGIN
    CREATE TABLE KRY_OKUTMA_KURAL_GUNLUK (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        islem         NVARCHAR(30)   NOT NULL,
        personel_kodu NVARCHAR(30)   NULL,
        ad_soyad      NVARCHAR(120)  NULL,
        ayrinti       NVARCHAR(1000) NULL,
        yapan         NVARCHAR(150)  NULL,
        zaman         DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_OKUTMA_KURAL_GUNLUK_zaman ON KRY_OKUTMA_KURAL_GUNLUK(zaman DESC);
END

IF OBJECT_ID('KRY_OKUTMA_RED') IS NULL
BEGIN
    CREATE TABLE KRY_OKUTMA_RED (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)  NOT NULL,
        ad_soyad      NVARCHAR(120) NULL,
        sube          NVARCHAR(120) NULL,
        yer_kodu      NVARCHAR(60)  NULL,
        yer_adi       NVARCHAR(120) NULL,
        sebep         NVARCHAR(20)  NOT NULL,
        mesafe_metre  INT           NULL,
        sinir_metre   INT           NULL,
        enlem         FLOAT         NULL,
        boylam        FLOAT         NULL,
        ayrinti       NVARCHAR(300) NULL,
        zaman         DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_OKUTMA_RED_zaman ON KRY_OKUTMA_RED(zaman DESC);
END

IF NOT EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = N'okutmaYaricap')
    INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme) VALUES (N'okutmaYaricap', N'150', SYSDATETIME());

IF NOT EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = N'okutmaKendiSube')
    INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme) VALUES (N'okutmaKendiSube', N'0', SYSDATETIME());");
        }
        catch (Exception)
        {
            // Okutma kuralları tabloları kurulamazsa okutma 150 metreyle eski düzende sürer
        }

        /* Toplu vardiya (03.10.2026): kayıtlı haftalık şablonlar, toplu
           işlem günlüğü ve geri alma yedekleri. Ayrı korunuyor: kurulamazsa
           yalnızca Toplu Vardiya ekranı çalışmaz. */
        try
        {
            db.Execute(@"
-- Haftalık şablon (desen): yedi gün, her gün vardiya türü / izin / boş / dokunma.
-- gunler JSON metni; SQL tarafında ayrıştırılmıyor (OPENJSON yok).
IF OBJECT_ID('KRY_VARDIYA_DESEN') IS NULL
BEGIN
    CREATE TABLE KRY_VARDIYA_DESEN (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        ad         NVARCHAR(100) NOT NULL,
        gunler     NVARCHAR(400) NOT NULL,
        olusturan  NVARCHAR(150) NULL,
        olusturma  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        aktif      BIT           NOT NULL DEFAULT 1
    );
END

-- Toplu vardiya işlemleri: kim, hangi deseni, kime, hangi aralığa uyguladı.
-- imza, işlemin yazdığı plan satırlarının guncelleyen değeri; zaman da
-- guncelleme değeri. Geri alma bu ikisiyle işlemin satırlarını buluyor.
IF OBJECT_ID('KRY_TOPLU_VARDIYA') IS NULL
BEGIN
    CREATE TABLE KRY_TOPLU_VARDIYA (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        zaman           DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        yapan           NVARCHAR(150) NULL,
        imza            NVARCHAR(100) NOT NULL DEFAULT N'',
        desen_ad        NVARCHAR(100) NULL,
        desen           NVARCHAR(400) NULL,
        bas             DATE          NOT NULL,
        bitis           DATE          NOT NULL,
        kapsam          NVARCHAR(500) NULL,
        siciller        NVARCHAR(MAX) NULL,
        kisi_sayisi     INT           NOT NULL DEFAULT 0,
        eklenen         INT           NOT NULL DEFAULT 0,
        guncellenen     INT           NOT NULL DEFAULT 0,
        korunan         INT           NOT NULL DEFAULT 0,
        yillik_atlanan  INT           NOT NULL DEFAULT 0,
        resmi_tatil     NVARCHAR(10)  NULL,
        uzerine_yaz     BIT           NOT NULL DEFAULT 0,
        yayinla         BIT           NOT NULL DEFAULT 1,
        bildirim        NVARCHAR(10)  NULL,
        bildirim_sayisi INT           NOT NULL DEFAULT 0,
        uyarilar        NVARCHAR(1000) NULL,
        geri_alindi     DATETIME2     NULL,
        geri_alan       NVARCHAR(150) NULL,
        geri_ozet       NVARCHAR(300) NULL
    );
END

-- Üzerine yazılan plan satırlarının eski hâli (geri alma için)
IF OBJECT_ID('KRY_TOPLU_VARDIYA_YEDEK') IS NULL
BEGIN
    CREATE TABLE KRY_TOPLU_VARDIYA_YEDEK (
        islem_id      INT           NOT NULL,
        personel_kodu NVARCHAR(30)  NOT NULL,
        gun           DATE          NOT NULL,
        hafta         DATE          NOT NULL,
        sablon_id     INT           NULL,
        tur           NVARCHAR(10)  NOT NULL,
        guncelleyen   NVARCHAR(100) NULL,
        guncelleme    DATETIME2     NOT NULL,
        CONSTRAINT PK_KRY_TOPLU_VARDIYA_YEDEK PRIMARY KEY (islem_id, personel_kodu, gun)
    );
END

-- Yayın durumunun (KRY_VARDIYA_PLAN_DURUM) eski hâli; vardi = 0 satır yoktu
IF OBJECT_ID('KRY_TOPLU_VARDIYA_DURUM_YEDEK') IS NULL
BEGIN
    CREATE TABLE KRY_TOPLU_VARDIYA_DURUM_YEDEK (
        islem_id      INT           NOT NULL,
        personel_kodu NVARCHAR(30)  NOT NULL,
        hafta         DATE          NOT NULL,
        vardi         BIT           NOT NULL,
        durum         NVARCHAR(10)  NULL,
        surum         INT           NULL,
        gonderen      NVARCHAR(150) NULL,
        gonderme      DATETIME2     NULL,
        CONSTRAINT PK_KRY_TOPLU_VARDIYA_DURUM_YEDEK PRIMARY KEY (islem_id, personel_kodu, hafta)
    );
END

-- Geri almada işlemin satırlarını bulmak için
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_VARDIYA_PLAN_guncelleyen')
    CREATE INDEX IX_KRY_VARDIYA_PLAN_guncelleyen ON KRY_VARDIYA_PLAN(guncelleyen, guncelleme);");
        }
        catch (Exception)
        {
            // Toplu vardiya tabloları kurulamazsa yalnızca o ekran çalışmaz
        }

        /* Raporlu personel (03.10.2026): personel kartından girilen sağlık
           raporları. Belge dosyası KRY_PERSONEL_BELGE'de ("Sağlık Raporu"
           türüyle) duruyor, burada yalnızca bağı (belge_id) var; böylece
           belge personelin Belgeler sekmesinde de görünüyor. Kimlik
           numarası, belgelerde olduğu gibi geri dönüşlerde eşleşme için.
           Ayrı korunuyor: kurulamazsa yalnızca raporlu bilgisi görünmez. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_PERSONEL_RAPOR') IS NULL
BEGIN
    CREATE TABLE KRY_PERSONEL_RAPOR (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)   NOT NULL,
        kimlik_no     NVARCHAR(25)   NULL,
        ad_soyad      NVARCHAR(150)  NULL,
        baslangic     DATE           NOT NULL,
        bitis         DATE           NOT NULL,
        gun           AS (DATEDIFF(day, baslangic, bitis) + 1),
        rapor_turu    NVARCHAR(40)   NOT NULL DEFAULT(N'İstirahat raporu'),
        aciklama      NVARCHAR(500)  NULL,
        belge_id      INT            NULL,
        olusturan     NVARCHAR(150)  NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleyen   NVARCHAR(150)  NULL,
        guncelleme    DATETIME2      NULL,
        iptal         BIT            NOT NULL DEFAULT(0),
        CONSTRAINT FK_KRY_PERSONEL_RAPOR_belge
            FOREIGN KEY (belge_id) REFERENCES KRY_PERSONEL_BELGE(id)
    );

    CREATE INDEX IX_KRY_PERSONEL_RAPOR_kod
        ON KRY_PERSONEL_RAPOR(personel_kodu, iptal, baslangic DESC);

    CREATE INDEX IX_KRY_PERSONEL_RAPOR_kimlik
        ON KRY_PERSONEL_RAPOR(kimlik_no, iptal);

    CREATE INDEX IX_KRY_PERSONEL_RAPOR_tarih
        ON KRY_PERSONEL_RAPOR(iptal, baslangic, bitis);
END");
        }
        catch (Exception)
        {
            // Rapor tablosu kurulamazsa personel kartında raporlar bölümü boş kalır
        }

        /* Biçen360 sürüm takibi (08.10.2026): personelin kullandığı uygulama
           sürümü ve güncelleme hatırlatmaları. surum boşsa 1.5 ya da öncesi
           (sürüm başlığı göndermiyor). İlk kurulumda cihaz ve bildirim
           kayıtlarından dolduruluyor. Ayrı korunuyor. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_UYGULAMA_SURUM') IS NULL
BEGIN
    CREATE TABLE KRY_UYGULAMA_SURUM (
        personel_kodu    NVARCHAR(30)  NOT NULL PRIMARY KEY,
        surum            NVARCHAR(20)  NOT NULL DEFAULT(N''),
        platform         NVARCHAR(10)  NULL,
        ilk_gorulme      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        son_gorulme      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        surum_degisim    DATETIME2     NULL,
        hatirlatma_hedef NVARCHAR(20)  NULL,
        hatirlatma_sayi  INT           NOT NULL DEFAULT 0,
        son_hatirlatma   DATETIME2     NULL,
        duyuru_id        INT           NULL
    );

    INSERT INTO KRY_UYGULAMA_SURUM (personel_kodu, surum, platform, ilk_gorulme, son_gorulme)
    SELECT LTRIM(RTRIM(c.personel_kodu)),
           ISNULL(LTRIM(RTRIM(j.surum)), N''),
           CASE WHEN c.isletim LIKE N'%android%' THEN N'android'
                WHEN c.isletim LIKE N'%ios%' OR c.isletim LIKE N'%iphone%' THEN N'ios' END,
           c.ilk_eslesme,
           COALESCE(j.guncelleme, c.son_giris, c.son_degisim)
    FROM KRY_MOBIL_CIHAZ c
    LEFT JOIN KRY_MOBIL_JETON j ON j.personel_kodu = c.personel_kodu
    WHERE c.oturum_acik = 1;
END");
        }
        catch (Exception)
        {
            // Sürüm tablosu kurulamazsa güncelleme hatırlatması çalışmaz
        }

        /* Panel görünümü (03.10.2026): kenar menüye yüklenen logo. Kurum
           logosundan (wwwroot/logo.png, e-postalar ve aday sayfası) ayrı;
           ayarın kendisi KRY_AYARLAR'da PANEL_GORUNUM anahtarında. Her
           yükleme bir sürüm satırı; kaydedilmeyenler temizleniyor.
           Ayrı korunuyor: kurulamazsa menü harf rozetiyle çalışır. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_PANEL_LOGO') IS NULL
BEGIN
    CREATE TABLE KRY_PANEL_LOGO (
        surum      BIGINT          NOT NULL PRIMARY KEY,
        icerik     VARBINARY(MAX)  NOT NULL,
        tur        NVARCHAR(40)    NOT NULL,
        boyut      INT             NOT NULL,
        yukleyen   NVARCHAR(150)   NULL,
        olusturma  DATETIME2       NOT NULL DEFAULT SYSDATETIME()
    );
END");
        }
        catch (Exception)
        {
            // Logo tablosu kurulamazsa yalnızca görsel logo seçeneği çalışmaz
        }

        /* Biçen'den Haberler (08.10.2026): Biçen360 1.7'deki şirket içi akış.
           Gönderi türleri: gonderi (fotoğraflı), kampanya ("Kasada bu hafta":
           ürün ve fiyatlar), anket (tek seçimli oy). Türe özel alanlar
           veri sütununda JSON. Görseller veritabanında; adres tahmin
           edilemeyen anahtarla (img etiketi ve mobil Image başlık
           gönderemiyor). Ayrı korunuyor. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_HABER') IS NULL
BEGIN
    CREATE TABLE KRY_HABER (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        tur          NVARCHAR(12)   NOT NULL DEFAULT(N'gonderi'),
        durum        NVARCHAR(10)   NOT NULL DEFAULT(N'taslak'),
        yazar_sicil  NVARCHAR(30)   NULL,
        yazar_ad     NVARCHAR(150)  NOT NULL,
        yazar_unvan  NVARCHAR(150)  NULL,
        kurum        BIT            NOT NULL DEFAULT(0),
        kategori     NVARCHAR(60)   NULL,
        metin        NVARCHAR(MAX)  NULL,
        veri         NVARCHAR(MAX)  NULL,
        hedef        NVARCHAR(MAX)  NULL,
        yorum_acik   BIT            NOT NULL DEFAULT(1),
        sabit        BIT            NOT NULL DEFAULT(0),
        gizli        BIT            NOT NULL DEFAULT(0),
        silindi      BIT            NOT NULL DEFAULT(0),
        olusturan    NVARCHAR(150)  NULL,
        olusturma    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        yayin        DATETIME2      NULL
    );
    CREATE INDEX IX_KRY_HABER_YAYIN ON KRY_HABER (durum, silindi, gizli, id);
END

/* Gönderi videosu (12.10.2026): duyuru-video klasöründeki anahtar */
IF COL_LENGTH('KRY_HABER', 'video') IS NULL
    ALTER TABLE KRY_HABER ADD video NVARCHAR(40) NULL;

IF OBJECT_ID('KRY_HABER_GORSEL') IS NULL
BEGIN
    CREATE TABLE KRY_HABER_GORSEL (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        haber_id  INT              NOT NULL,
        sira      INT              NOT NULL DEFAULT(0),
        anahtar   UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
        tur       NVARCHAR(40)     NOT NULL,
        boyut     INT              NOT NULL,
        icerik    VARBINARY(MAX)   NOT NULL,
        olusturma DATETIME2        NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_HABER_GORSEL ON KRY_HABER_GORSEL (haber_id, sira);
END

IF OBJECT_ID('KRY_HABER_BEGENI') IS NULL
    CREATE TABLE KRY_HABER_BEGENI (
        haber_id INT          NOT NULL,
        sicil    NVARCHAR(30) NOT NULL,
        tarih    DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_HABER_BEGENI PRIMARY KEY (haber_id, sicil)
    );

IF OBJECT_ID('KRY_HABER_YORUM') IS NULL
BEGIN
    CREATE TABLE KRY_HABER_YORUM (
        id       INT IDENTITY(1,1) PRIMARY KEY,
        haber_id INT            NOT NULL,
        sicil    NVARCHAR(30)   NULL,
        ad       NVARCHAR(150)  NOT NULL,
        unvan    NVARCHAR(150)  NULL,
        metin    NVARCHAR(600)  NOT NULL,
        gizli    BIT            NOT NULL DEFAULT(0),
        tarih    DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_HABER_YORUM ON KRY_HABER_YORUM (haber_id, id);
END

IF OBJECT_ID('KRY_HABER_OY') IS NULL
    CREATE TABLE KRY_HABER_OY (
        haber_id INT          NOT NULL,
        sicil    NVARCHAR(30) NOT NULL,
        secenek  INT          NOT NULL,
        sube     NVARCHAR(100) NULL,
        tarih    DATETIME2    NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_HABER_OY PRIMARY KEY (haber_id, sicil)
    );

IF OBJECT_ID('KRY_HABER_YETKI') IS NULL
    CREATE TABLE KRY_HABER_YETKI (
        sicil       NVARCHAR(30)  NOT NULL PRIMARY KEY,
        kurum_adina BIT           NOT NULL DEFAULT(0),
        ekleyen     NVARCHAR(150) NULL,
        tarih       DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );");
        }
        catch (Exception)
        {
            // Haber tabloları kurulamazsa yalnızca Biçen'den Haberler çalışmaz
        }

        /* Personel aydınlatma metni (08.10.2026, KVKK md. 10): metnin her
           sürümü ve personelin "okudum" kaydı. Kayıtta metnin özeti (SHA-256),
           cihaz, uygulama sürümü ve IP tutuluyor: hangi metnin ne zaman
           okunduğu sonradan gösterilebilsin. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_AYDINLATMA') IS NULL
    CREATE TABLE KRY_AYDINLATMA (
        surum        INT            NOT NULL PRIMARY KEY,
        baslik       NVARCHAR(200)  NOT NULL,
        metin        NVARCHAR(MAX)  NOT NULL,
        onay_metni   NVARCHAR(400)  NOT NULL,
        ozet         CHAR(64)       NOT NULL,
        yeniden_onay BIT            NOT NULL DEFAULT(0),
        aktif        BIT            NOT NULL DEFAULT(1),
        yayinlayan   NVARCHAR(150)  NULL,
        yayin        DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );

IF OBJECT_ID('KRY_AYDINLATMA_ONAY') IS NULL
    CREATE TABLE KRY_AYDINLATMA_ONAY (
        sicil     NVARCHAR(30)  NOT NULL,
        surum     INT           NOT NULL,
        ad        NVARCHAR(150) NULL,
        sube      NVARCHAR(150) NULL,
        ozet      CHAR(64)      NOT NULL,
        cihaz     NVARCHAR(200) NULL,
        uygulama  NVARCHAR(20)  NULL,
        ip        NVARCHAR(64)  NULL,
        tarih     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_AYDINLATMA_ONAY PRIMARY KEY (sicil, surum)
    );");
        }
        catch (Exception)
        {
            // Kurulamazsa yalnızca aydınlatma metni ekranı çalışmaz
        }

        /* İş Planlaması (08.10.2026): panel ve Biçen360 güncellemelerinin
           planı. Yalnızca iki sicile açık (IsPlaniController). İş, kayıtlar
           (yorum, not, geçmiş) ve görseller ayrı tablolarda; görsel içeriği
           veritabanında, listeler yalnızca kimliği taşıyor. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_IS_PLANI') IS NULL
BEGIN
    CREATE TABLE KRY_IS_PLANI (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        baslik      NVARCHAR(150)  NOT NULL,
        aciklama    NVARCHAR(MAX)  NULL,
        platform    NVARCHAR(60)   NOT NULL DEFAULT('panel'),
        asama       NVARCHAR(20)   NOT NULL DEFAULT('fikir'),
        oncelik     NVARCHAR(20)   NOT NULL DEFAULT('normal'),
        surum       NVARCHAR(30)   NULL,
        sorumlu     NVARCHAR(20)   NULL,
        hedef       DATE           NULL,
        maddeler    NVARCHAR(MAX)  NULL,
        olusturan   NVARCHAR(20)   NULL,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme  DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        silindi     BIT            NOT NULL DEFAULT(0)
    );
END

IF OBJECT_ID('KRY_IS_PLANI_KAYIT') IS NULL
BEGIN
    CREATE TABLE KRY_IS_PLANI_KAYIT (
        id      INT IDENTITY(1,1) PRIMARY KEY,
        is_id   INT            NOT NULL,
        tur     NVARCHAR(10)   NOT NULL,
        kim     NVARCHAR(20)   NOT NULL,
        metin   NVARCHAR(MAX)  NULL,
        sabit   BIT            NOT NULL DEFAULT(0),
        tarih   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_IS_PLANI_KAYIT_IS ON KRY_IS_PLANI_KAYIT (is_id, tur);
END

IF OBJECT_ID('KRY_IS_PLANI_GORSEL') IS NULL
BEGIN
    CREATE TABLE KRY_IS_PLANI_GORSEL (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        is_id     INT             NOT NULL,
        kayit_id  INT             NULL,
        ad        NVARCHAR(150)   NULL,
        tur       NVARCHAR(40)    NOT NULL,
        boyut     INT             NOT NULL,
        icerik    VARBINARY(MAX)  NOT NULL,
        kim       NVARCHAR(20)    NOT NULL,
        tarih     DATETIME2       NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_IS_PLANI_GORSEL_IS ON KRY_IS_PLANI_GORSEL (is_id);
END");
        }
        catch (Exception)
        {
            // İş planlaması tabloları kurulamazsa yalnızca o sayfa çalışmaz
        }

        /* İşe giriş evrakları (03.10.2026): başvurudan işe alımda istenen
           evrakların takibi. Dosyalar yine KRY_PERSONEL_BELGE'de; belgeye
           klasör (kategori), evrak kodu, başvuru ve takip bağı ekleniyor.
           Aday henüz Mikro'da yokken yüklenen evrak kimlik numarasıyla
           personel kartına düşüyor. Sütunlar ve dizin ayrı komutlarda:
           aynı toplu komutta eklenen sütuna dizin kurmak derlenmiyor. */
        try
        {
            db.Execute(@"
IF COL_LENGTH('KRY_PERSONEL_BELGE', 'kategori') IS NULL
    ALTER TABLE KRY_PERSONEL_BELGE ADD kategori NVARCHAR(30) NULL;
IF COL_LENGTH('KRY_PERSONEL_BELGE', 'evrak_kodu') IS NULL
    ALTER TABLE KRY_PERSONEL_BELGE ADD evrak_kodu NVARCHAR(40) NULL;
IF COL_LENGTH('KRY_PERSONEL_BELGE', 'basvuru_id') IS NULL
    ALTER TABLE KRY_PERSONEL_BELGE ADD basvuru_id INT NULL;
IF COL_LENGTH('KRY_PERSONEL_BELGE', 'takip_id') IS NULL
    ALTER TABLE KRY_PERSONEL_BELGE ADD takip_id INT NULL;");

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_PERSONEL_BELGE_takip')
    CREATE INDEX IX_KRY_PERSONEL_BELGE_takip ON KRY_PERSONEL_BELGE(takip_id, silindi);

IF OBJECT_ID('KRY_ISE_GIRIS_TAKIP') IS NULL
BEGIN
    CREATE TABLE KRY_ISE_GIRIS_TAKIP (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        kimlik_no   NVARCHAR(25)   NULL,
        basvuru_id  INT            NULL,
        ad_soyad    NVARCHAR(150)  NULL,
        baslatan    NVARCHAR(150)  NULL,
        baslama     DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        kapandi     BIT            NOT NULL DEFAULT(0)
    );
    CREATE INDEX IX_KRY_ISE_GIRIS_TAKIP_kimlik ON KRY_ISE_GIRIS_TAKIP(kimlik_no, kapandi);
    CREATE INDEX IX_KRY_ISE_GIRIS_TAKIP_basvuru ON KRY_ISE_GIRIS_TAKIP(basvuru_id);
END

IF OBJECT_ID('KRY_ISE_GIRIS_EVRAK_DURUM') IS NULL
BEGIN
    CREATE TABLE KRY_ISE_GIRIS_EVRAK_DURUM (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        takip_id    INT            NOT NULL,
        evrak_kodu  NVARCHAR(40)   NOT NULL,
        durum       NVARCHAR(20)   NOT NULL,
        aciklama    NVARCHAR(300)  NULL,
        guncelleyen NVARCHAR(150)  NULL,
        guncelleme  DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE UNIQUE INDEX UX_KRY_ISE_GIRIS_EVRAK_DURUM
        ON KRY_ISE_GIRIS_EVRAK_DURUM(takip_id, evrak_kodu);
END");
        }
        catch (Exception)
        {
            // Kurulamazsa yalnızca işe giriş evrak listesi çalışmaz
        }

        /* Patron görünümü (03.10.2026): Biçen360'ta yönetim ekranlarını
           görecek kişiler. Yönetim → Patron Görünümü'nden seçiliyor.
           Kaldırılan kişi silinmiyor (aktif = 0): kim, ne zaman ekledi /
           kaldırdı izi kalsın; şirket geneli veriye erişim veriyor. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_PATRON') IS NULL
BEGIN
    CREATE TABLE KRY_PATRON (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        personel_kodu NVARCHAR(30)   NOT NULL,
        kimlik_no     NVARCHAR(25)   NULL,
        ad_soyad      NVARCHAR(150)  NULL,
        unvan         NVARCHAR(150)  NULL,
        ekleyen       NVARCHAR(150)  NULL,
        ekleme        DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        aktif         BIT            NOT NULL DEFAULT(1),
        kaldiran      NVARCHAR(150)  NULL,
        kaldirma      DATETIME2      NULL,
        son_giris     DATETIME2      NULL
    );
    CREATE INDEX IX_KRY_PATRON_kod ON KRY_PATRON(personel_kodu, aktif);
END");
        }
        catch (Exception)
        {
            // Kurulamazsa yalnızca patron listesi çalışmaz
        }

        /* Patron bildirim tercihleri (03.10.2026): sabah özeti ve saati,
           yeni onay, kritik okutma, etik hat. Düz JSON (JSON_VALUE ile
           okunabilir); yeni bir tercih eklemek sütun eklemeyi gerektirmesin.
           Ayrı korunuyor: eklenemezse herkes varsayılan ayarla bildirim alır. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_PATRON') IS NOT NULL AND COL_LENGTH('KRY_PATRON', 'bildirim_ayar') IS NULL
    ALTER TABLE KRY_PATRON ADD bildirim_ayar NVARCHAR(400) NULL;");
        }
        catch (Exception)
        {
            // Eklenemezse bildirim ayarları kaydedilemez, varsayılanlar geçerli
        }

        /* Patron bildirimlerinden gönderilenler (03.10.2026): sabah özeti
           kişi+gün, kritik okutma uyarısı birim+gün anahtarıyla bir kez
           yazılıyor. Anahtar birincil anahtar: uygulama yeniden başlasa ya
           da IIS geri dönüşümünde iki örnek aynı dakikada çalışsa da aynı
           bildirim ikinci kez gitmiyor. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_PATRON_BILDIRIM') IS NULL
    CREATE TABLE KRY_PATRON_BILDIRIM (
        anahtar   NVARCHAR(200) NOT NULL PRIMARY KEY,
        gonderim  DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );");
        }
        catch (Exception)
        {
            // Kurulamazsa zamanlanmış patron bildirimleri gönderilmez (tekrarı önlenemez)
        }

        /* Kıdemin bordrodan otomatik hesabı (05.10.2026): hak ediş
           düzeltmesinin kaynağı. 'bordro' = KidemBordroServisi yazdı (her
           sabah yeniden hesaplanır); boş ya da 'elle' = İK yazdı, otomatik
           hesap dokunmaz. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_IZIN_HAKEDIS') IS NOT NULL AND COL_LENGTH('KRY_IZIN_HAKEDIS', 'kaynak') IS NULL
    ALTER TABLE KRY_IZIN_HAKEDIS ADD kaynak NVARCHAR(10) NULL;");
        }
        catch (Exception)
        {
            // Eklenemezse otomatik kıdem hesabı yazamaz; elle düzeltme çalışır
        }

        /* Biçen bildirim sesleri (04.10.2026): cihaz 1.6 ve sonrası mı.
           Expo, cihazda olmayan kanala gönderilen bildirimi Android'de
           göstermiyor; ses ve kanal yalnızca ses = 1 olan cihaza. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_MOBIL_JETON') IS NOT NULL AND COL_LENGTH('KRY_MOBIL_JETON', 'ses') IS NULL
    ALTER TABLE KRY_MOBIL_JETON ADD ses BIT NOT NULL CONSTRAINT DF_KRY_MOBIL_JETON_ses DEFAULT(0);
IF OBJECT_ID('KRY_MOBIL_JETON') IS NOT NULL AND COL_LENGTH('KRY_MOBIL_JETON', 'surum') IS NULL
    ALTER TABLE KRY_MOBIL_JETON ADD surum NVARCHAR(20) NULL;");
        }
        catch (Exception)
        {
            // Eklenemezse jeton kaydı ve gönderim eski biçimde sürer (varsayılan ses)
        }

        /* Ayar değişiklikleri (03.10.2026): Yönetim sayfasındaki "son
           değişiklik" bilgisi ve Genel bakış'taki son değişiklikler listesi.
           Ayar uçlarına yapılan başarılı yazma istekleri ara katmanda
           (AyarDegisiklikKaydi) buraya düşüyor; içerik değil yalnızca
           bölüm, işlem ve kişi tutuluyor. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_AYAR_DEGISIKLIK') IS NULL
BEGIN
    CREATE TABLE KRY_AYAR_DEGISIKLIK (
        id         INT IDENTITY(1,1) PRIMARY KEY,
        bolum      NVARCHAR(40)  NOT NULL,
        islem      NVARCHAR(200) NOT NULL,
        kullanici  NVARCHAR(150) NULL,
        basarili   BIT           NOT NULL DEFAULT(1),
        tarih      DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_AYAR_DEGISIKLIK_bolum ON KRY_AYAR_DEGISIKLIK(bolum, tarih DESC);
END");
        }
        catch (Exception)
        {
            // Kurulamazsa Yönetim sayfasında son değişiklik bilgisi görünmez
        }

        /* Yenilikler ve Talep/Öneri (30.10.2026).

           KRY_KULLANICI_TERCIH: kişiye özel küçük tercihler (anahtar-değer).
           İlk kullanım "Yenilikler.SonOkunan": kullanıcının okuduğu en
           büyük yenilik numarası. Yenilik listesi veritabanında değil,
           panel kodunun içinde (bicen-kariyer-ik/src/yenilikler/).

           KRY_TALEP: panel kullanıcılarının her ekrandan yazdığı sorun
           bildirimi ve öneriler; yönetim cevaplar, kullanıcı zilden görür.
           KRY_TALEP_GORSEL: talep başına en çok 3 ekran görüntüsü. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_KULLANICI_TERCIH') IS NULL
BEGIN
    CREATE TABLE KRY_KULLANICI_TERCIH (
        kullanici  NVARCHAR(60)  NOT NULL,
        anahtar    NVARCHAR(50)  NOT NULL,
        deger      NVARCHAR(400) NOT NULL,
        degisim    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_KULLANICI_TERCIH PRIMARY KEY (kullanici, anahtar)
    );
END

IF OBJECT_ID('KRY_TALEP') IS NULL
BEGIN
    CREATE TABLE KRY_TALEP (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        kullanici      NVARCHAR(60)   NOT NULL,
        ad_soyad       NVARCHAR(100)  NOT NULL,
        rol            NVARCHAR(40)   NULL,
        tur            TINYINT        NOT NULL,              -- 1 sorun, 2 oneri
        ekran          NVARCHAR(100)  NULL,
        yol            NVARCHAR(200)  NULL,
        metin          NVARCHAR(2000) NOT NULL,
        surum          NVARCHAR(20)   NULL,
        durum          TINYINT        NOT NULL DEFAULT(0),   -- 0 yeni 1 inceleniyor 2 planlandi 3 tamamlandi 4 yapilmayacak
        cevap          NVARCHAR(2000) NULL,
        cevaplayan     NVARCHAR(100)  NULL,
        cevap_zamani   DATETIME2      NULL,
        olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_TALEP_kullanici ON KRY_TALEP(kullanici, olusturma DESC);
    CREATE INDEX IX_KRY_TALEP_durum ON KRY_TALEP(durum, olusturma DESC);
END

IF OBJECT_ID('KRY_TALEP_GORSEL') IS NULL
BEGIN
    CREATE TABLE KRY_TALEP_GORSEL (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        talep_id  INT            NOT NULL REFERENCES KRY_TALEP(id) ON DELETE CASCADE,
        sira      TINYINT        NOT NULL,
        tur       VARCHAR(20)    NOT NULL,
        veri      VARBINARY(MAX) NOT NULL,
        olusturma DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT UQ_KRY_TALEP_GORSEL UNIQUE (talep_id, sira)
    );
END");
        }
        catch (Exception)
        {
            // Kurulamazsa Yenilikler penceresi her girişte açılır, talep yazılamaz
        }

        /* Turnover elle girilen değerler (30.10.2026): Sirkülasyon › Turnover
           tablosunda bir ayın değeri elle girilirse otomatik hesabın yerine
           geçer; NULL alan otomatik kalır. 2025 elle, sonraki yıllar otomatik
           (gerekirse düzeltilir). */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_TURNOVER_MANUEL') IS NULL
BEGIN
    CREATE TABLE KRY_TURNOVER_MANUEL (
        yil          INT           NOT NULL,
        ay           INT           NOT NULL,
        kapsam       NVARCHAR(10)  NOT NULL,
        sube_sayisi  INT           NULL,
        donem_basi   INT           NULL,
        donem_sonu   INT           NULL,
        giris        INT           NULL,
        cikis        INT           NULL,
        guncelleyen  NVARCHAR(100) NULL,
        guncelleme   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_TURNOVER_MANUEL PRIMARY KEY (yil, ay, kapsam)
    );
END");
        }
        catch (Exception)
        {
            // Kurulamazsa Turnover yalnızca otomatik değerlerle çalışır
        }

        /* Turnover elle girilen aylar (30.10.2026): İK'nın Excel'de tuttuğu
           geçmiş yıl (2025) rakamları. Bir ay için satır varsa Turnover
           ekranı o ayı Mikro'dan hesaplamaz, bu değerleri kullanır. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_TURNOVER_MANUEL') IS NULL
BEGIN
    CREATE TABLE KRY_TURNOVER_MANUEL (
        yil          INT           NOT NULL,
        ay           INT           NOT NULL,
        sube_sayisi  INT           NULL,
        donem_basi   INT           NULL,
        donem_sonu   INT           NULL,
        giris        INT           NULL,
        cikis        INT           NULL,
        guncelleyen  NVARCHAR(100) NULL,
        guncelleme   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_TURNOVER_MANUEL PRIMARY KEY (yil, ay)
    );
END");
        }
        catch (Exception)
        {
            // Kurulamazsa Turnover yalnızca Mikro'dan hesaplanır
        }

        /* İcra / maaş haczi takibi (30.10.2026): personele gelen haciz
           ihbarnameleri ve nafaka kesintileri. Dosyalar tebliğ sırasına göre
           sıralanır; her ay nafakanın tamamı + net maaşın ayarlanan oranı
           (varsayılan ¼) sıradaki dosyaya kesilir. Olaylar (tebligat, cevap,
           ödeme, sıra, kapanış…) zaman çizelgesi; belgeler tebligat taraması
           ve ödeme dekontu. Danışman bu tablolara hiçbir uçtan ulaşamaz. */
        try
        {
            db.Execute(@"
IF OBJECT_ID('KRY_ICRA_DOSYA') IS NULL
BEGIN
    CREATE TABLE KRY_ICRA_DOSYA (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        dosya_no          NVARCHAR(20)   NOT NULL,
        sicil             NVARCHAR(30)   NOT NULL,
        personel_ad       NVARCHAR(150)  NULL,
        tur               NVARCHAR(10)   NOT NULL DEFAULT N'icra',
        icra_dairesi      NVARCHAR(200)  NULL,
        esas_no           NVARCHAR(60)   NULL,
        alacakli          NVARCHAR(200)  NULL,
        alacakli_vekili   NVARCHAR(200)  NULL,
        teblig_tarihi     DATE           NULL,
        gelis_tarihi      DATE           NULL,
        cevap_suresi      DATE           NULL,
        cevap_tarihi      DATE           NULL,
        asil_alacak       DECIMAL(18,2)  NULL,
        faiz              DECIMAL(18,2)  NULL,
        masraf            DECIMAL(18,2)  NULL,
        toplam_borc       DECIMAL(18,2)  NOT NULL DEFAULT 0,
        aylik_tutar       DECIMAL(18,2)  NULL,
        baslangic         DATE           NULL,
        odeme_hesabi      NVARCHAR(300)  NULL,
        sira              INT            NULL,
        sira_notu         NVARCHAR(300)  NULL,
        durum             NVARCHAR(12)   NOT NULL DEFAULT N'acik',
        kapanis_tarihi    DATE           NULL,
        notlar            NVARCHAR(2000) NULL,
        ayrilis_bildirildi DATETIME2     NULL,
        olusturan         NVARCHAR(80)   NULL,
        olusturma         DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
        guncelleme        DATETIME2      NULL
    );
    CREATE UNIQUE INDEX UX_KRY_ICRA_DOSYA_no ON KRY_ICRA_DOSYA(dosya_no);
    CREATE INDEX IX_KRY_ICRA_DOSYA_sicil ON KRY_ICRA_DOSYA(sicil, durum);
    CREATE INDEX IX_KRY_ICRA_DOSYA_durum ON KRY_ICRA_DOSYA(durum, id DESC);
END

IF OBJECT_ID('KRY_ICRA_OLAY') IS NULL
BEGIN
    CREATE TABLE KRY_ICRA_OLAY (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        dosya_id    INT            NOT NULL,
        tur         NVARCHAR(20)   NOT NULL,
        tarih       DATETIME2      NOT NULL,
        baslik      NVARCHAR(200)  NOT NULL,
        aciklama    NVARCHAR(1000) NULL,
        tutar       DECIMAL(18,2)  NULL,
        ekleyen     NVARCHAR(80)   NULL,
        ekleyen_ad  NVARCHAR(150)  NULL,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_ICRA_OLAY_dosya ON KRY_ICRA_OLAY(dosya_id, tarih);
END

IF OBJECT_ID('KRY_ICRA_BELGE') IS NULL
BEGIN
    CREATE TABLE KRY_ICRA_BELGE (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        dosya_id    INT            NOT NULL,
        kesinti_id  INT            NULL,
        ad          NVARCHAR(250)  NOT NULL,
        yol         NVARCHAR(400)  NOT NULL,
        icerik_turu NVARCHAR(120)  NULL,
        boyut       BIGINT         NOT NULL DEFAULT 0,
        yukleyen    NVARCHAR(80)   NULL,
        yukleyen_ad NVARCHAR(150)  NULL,
        silindi     BIT            NOT NULL DEFAULT 0,
        olusturma   DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_ICRA_BELGE_dosya ON KRY_ICRA_BELGE(dosya_id, silindi);
END

IF OBJECT_ID('KRY_ICRA_KESINTI') IS NULL
BEGIN
    CREATE TABLE KRY_ICRA_KESINTI (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        dosya_id      INT            NOT NULL,
        sicil         NVARCHAR(30)   NOT NULL,
        donem         NVARCHAR(7)    NOT NULL,
        tur           NVARCHAR(10)   NOT NULL,
        tutar         DECIMAL(18,2)  NOT NULL,
        net_maas      DECIMAL(18,2)  NULL,
        maas_kaynak   NVARCHAR(10)   NULL,
        sira          INT            NULL,
        odendi        BIT            NOT NULL DEFAULT 0,
        odeme_tarihi  DATE           NULL,
        dekont_id     INT            NULL,
        aciklama      NVARCHAR(300)  NULL,
        olusturan     NVARCHAR(80)   NULL,
        olusturma     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_ICRA_KESINTI_dosya ON KRY_ICRA_KESINTI(dosya_id, donem);
    CREATE INDEX IX_KRY_ICRA_KESINTI_donem ON KRY_ICRA_KESINTI(donem, sicil);
END

IF OBJECT_ID('KRY_ICRA_MAAS') IS NULL
    CREATE TABLE KRY_ICRA_MAAS (
        sicil        NVARCHAR(30)  NOT NULL,
        donem        NVARCHAR(7)   NOT NULL,
        net_maas     DECIMAL(18,2) NOT NULL,
        guncelleyen  NVARCHAR(80)  NULL,
        guncelleme   DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_ICRA_MAAS PRIMARY KEY (sicil, donem)
    );

IF OBJECT_ID('KRY_ICRA_LOG') IS NULL
BEGIN
    CREATE TABLE KRY_ICRA_LOG (
        id        INT IDENTITY(1,1) PRIMARY KEY,
        anahtar   NVARCHAR(80)  NULL,
        ad        NVARCHAR(150) NULL,
        islem     NVARCHAR(40)  NOT NULL,
        dosya_id  INT           NULL,
        hedef     NVARCHAR(300) NULL,
        ip        NVARCHAR(60)  NULL,
        zaman     DATETIME2     NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_KRY_ICRA_LOG_dosya ON KRY_ICRA_LOG(dosya_id, id DESC);
    CREATE TABLE KRY_ICRA_HATIRLATMA (
        anahtar  NVARCHAR(60) NOT NULL PRIMARY KEY,
        zaman    DATETIME2    NOT NULL DEFAULT SYSDATETIME()
    );
END");
        }
        catch (Exception)
        {
            // Kurulamazsa İcra takibi ekranı 'tablo yok' hatası verir
        }
    }

    private void YoneticiOlustur(IDbConnection db)
    {
        var kullaniciAdi = _yapilandirma["Yonetici:KullaniciAdi"] ?? "admin";
        var varMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_KULLANICILAR WHERE kullanici_adi = @k",
            new { k = kullaniciAdi });

        if (varMi > 0) return;

        var parola = _yapilandirma["Yonetici:BaslangicParolasi"] ?? "Bicen2026!";
        var (hash, salt) = ParolaServisi.Uret(parola);

        db.Execute(@"
INSERT INTO KRY_KULLANICILAR
    (kullanici_adi, ad_soyad, eposta, unvan, parola_hash, parola_salt, rol, aktif)
VALUES (@k, @a, @e, @unvan, @h, @s, @r, 1)",
            new
            {
                k = kullaniciAdi,
                a = "Sistem Yöneticisi",
                unvan = "Sistem Yöneticisi",
                e = "",
                h = hash,
                s = salt,
                r = Roller.Admin
            });
    }

    /// <summary>
    /// Organizasyon şemasının ilk hâli.
    ///
    /// Yalnızca tablo boşsa doldurulur; panelden yapılan değişiklikler
    /// korunur. Şema Biçen organizasyon tablosuna göre kurulmuştur.
    /// </summary>
    private void VarsayilanOrganizasyon(IDbConnection db)
    {
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_ORGANIZASYON") > 0)
            return;

        /* Kutu ekleyip kimliğini döndüren yardımcı */
        int Ekle(int? ust, string unvan, string renk, int sira, bool magaza = false) =>
            db.ExecuteScalar<int>(@"
INSERT INTO KRY_ORGANIZASYON (ust_id, unvan, renk, sira, magaza_mi)
OUTPUT INSERTED.id VALUES (@ust, @unvan, @renk, @sira, @magaza)",
                new { ust, unvan, renk, sira, magaza });

        /* ------------------------------------------------------- tepe */
        var yk = Ekle(null, "Yönetim Kurulu", "yesil", 0);
        var ykBaskan = Ekle(yk, "Yönetim Kurulu Başkanı", "yesil", 0);
        Ekle(yk, "Danışma Kurulu", "yesil", 1);

        /* Görselde bu üçü aynı satırda; İç Denetim ve Yönetim Asistanı
           İcra Kurulu Başkanı'nın altında değil yanındadır. */
        Ekle(ykBaskan, "İç Denetim Müdürü", "mavi", 0);
        var icra = Ekle(ykBaskan, "İcra Kurulu Başkanı", "turuncu", 1);
        Ekle(ykBaskan, "Yönetim Asistanı", "mavi", 2);

        /* --------------------------------------------- İK ve idari */
        var gmy1 = Ekle(icra, "Genel Müdür Yardımcısı (İK)", "yesil", 0);
        Ekle(gmy1, "İnsan Kaynakları Yöneticisi", "yesil", 0);
        Ekle(gmy1, "İnsan Kaynakları Uzmanı", "yesil", 1);
        Ekle(gmy1, "Kalite ve Hijyen Yöneticisi", "yesil", 2);
        Ekle(gmy1, "Santral Görevlisi", "yesil", 3);
        Ekle(gmy1, "Çaycı", "yesil", 4);
        Ekle(gmy1, "Temizlik Görevlisi", "yesil", 5);

        /* ------------------------------------------- bilgi teknolojileri */
        var bt = Ekle(icra, "Bilgi Teknolojileri Müdürü", "mor", 1);
        Ekle(bt, "Bilgi Teknolojileri Uzmanı", "mor", 0);
        Ekle(bt, "Bilgi Tekn. Asistanı", "mor", 1);
        Ekle(bt, "Raporlama Uzmanı", "mor", 2);

        /* ------------------------------------------- mali ve teknik */
        var gmy2 = Ekle(icra, "Genel Müdür Yardımcısı (Mali)", "kirmizi", 2);

        var muhasebe = Ekle(gmy2, "Muhasebe Şefi", "bej", 0);
        Ekle(muhasebe, "Muhasebe Personeli", "bej", 0);
        Ekle(muhasebe, "Mutabakat Sorumlusu", "bej", 1);
        Ekle(muhasebe, "Araç ve Evrak Sorumlusu", "bej", 2);
        Ekle(muhasebe, "Hal Rap. Sorumlusu", "bej", 3);
        Ekle(muhasebe, "Ekmek Şoförü", "bej", 4);
        Ekle(muhasebe, "Hal Şoförü", "bej", 5);

        var finans = Ekle(gmy2, "Finans Yöneticisi", "bej", 1);
        Ekle(finans, "Finans Asistanı", "bej", 0);

        var teknik = Ekle(gmy2, "Teknik İşler Müdürü", "bej", 2);
        Ekle(teknik, "Teknik İşler Yöneticisi", "bej", 0);
        Ekle(teknik, "Elektrik Ustası", "bej", 1);
        Ekle(teknik, "İnşaat Ustası", "bej", 2);
        Ekle(teknik, "Teknik İşler Asistanı", "bej", 3);

        /* ------------------------------------------- operasyon */
        var gmy3 = Ekle(icra, "Genel Müdür Yardımcısı (Operasyon)", "turuncu", 3);

        var bolge = Ekle(gmy3, "Bölge Müdürü", "bej", 0);

        /* Mağaza kadrosu: her mağazada tekrar eden pozisyonlar */
        var magazaMd = Ekle(bolge, "Mağaza Müdürü", "bej", 0, true);
        Ekle(magazaMd, "Müdür Yardımcısı", "bej", 0, true);
        Ekle(magazaMd, "Mağaza Şefi", "bej", 1, true);
        Ekle(magazaMd, "Kasa Şefi", "bej", 2, true);
        Ekle(magazaMd, "Kasiyer", "bej", 3, true);
        Ekle(magazaMd, "Reyon Şefi", "bej", 4, true);
        Ekle(magazaMd, "Reyoner", "bej", 5, true);
        Ekle(magazaMd, "Kasap Şefi", "bej", 6, true);
        Ekle(magazaMd, "Kasap Personeli", "bej", 7, true);
        Ekle(magazaMd, "Şarküteri Şefi", "bej", 8, true);
        Ekle(magazaMd, "Şarküteri Personeli", "bej", 9, true);
        Ekle(magazaMd, "Manav Şefi", "bej", 10, true);
        Ekle(magazaMd, "Manav Personeli", "bej", 11, true);
        Ekle(magazaMd, "Bilgi İşlem Personeli", "bej", 12, true);
        Ekle(magazaMd, "Aşçı", "bej", 13, true);
        Ekle(magazaMd, "Temizlik Görevlisi (Mağaza)", "bej", 14, true);

        Ekle(gmy3, "Pazarlama Müdürü", "bej", 1);
        Ekle(gmy3, "Grafik Tasarım", "bej", 2);
        Ekle(gmy3, "E Ticaret Yöneticisi", "bej", 3);

        /* ------------------------------------------- lojistik */
        var gmy4 = Ekle(icra, "Genel Müdür Yardımcısı (Lojistik)", "mavi", 4);

        var lojistik = Ekle(gmy4, "Lojistik ve Depolama Müdürü", "mavi", 0);
        Ekle(lojistik, "Depo Çalışanı", "mavi", 0);
        Ekle(lojistik, "Depo Şoförleri", "mavi", 1);

        var stok = Ekle(gmy4, "Stok Yöneticisi", "mavi", 1);
        Ekle(stok, "Stok Çalışanı", "mavi", 0);

        /* ------------------------------------------- güvenlik ve satın alma */
        var guvenlik = Ekle(icra, "Güvenlik Odası Yöneticisi", "mavi", 5);
        Ekle(guvenlik, "Güvenlik Odası Çalışanı", "mavi", 0);

        var satinAlma = Ekle(icra, "Satınalma Müdürü", "mor", 6);
        Ekle(satinAlma, "Kategori Yöneticisi", "mor", 0);
        Ekle(satinAlma, "Satınalma Asistanı", "mor", 1);
    }

    /// <summary>
    /// Engelli alan adlarının ilk hâli.
    ///
    /// Ayar dosyasındaki liste bir kez veritabanına aktarılır; sonrasında
    /// yönetim panelinden düzenlenir. Tablo boş değilse dokunulmaz.
    /// </summary>
    private void VarsayilanEngelliAlanlar(IDbConnection db)
    {
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_ENGELLI_ALAN") > 0)
            return;

        var alanlar = _yapilandirma
            .GetSection("EpostaDogrulama:EngelliAlanlar").Get<string[]>()
            ?? new[] { "protonmail.com", "proton.me", "protonmail.ch", "pm.me" };

        foreach (var ham in alanlar)
        {
            var alan = (ham ?? "").Trim().ToLowerInvariant().TrimStart('@');

            if (alan.Length < 3 || !alan.Contains('.')) continue;

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_ENGELLI_ALAN WHERE alan = @alan)
    INSERT INTO KRY_ENGELLI_ALAN (alan, sebep, ekleyen)
    VALUES (@alan, N'Kurulumla geldi', N'sistem')",
                new { alan });
        }
    }

    private void VarsayilanAyarlar(IDbConnection db)
    {
        AyarYoksaYaz(db, "MAIL", JsonSerializer.Serialize(new MailAyarlari()));
        AyarYoksaYaz(db, "FORM", JsonSerializer.Serialize(VarsayilanForm()));
    }

    private static void AyarYoksaYaz(IDbConnection db, string anahtar, string deger)
    {
        var varMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_AYARLAR WHERE anahtar = @a", new { a = anahtar });

        if (varMi == 0)
        {
            db.Execute(
                "INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME())",
                new { a = anahtar, d = deger });
        }
    }

    /* ------------------------------------------------- varsayılan form içeriği */

    public static FormAyarlari VarsayilanForm() => new()
    {
        Duyuru = "",
        Subeler = new List<Sube>
        {
            new() { Kod = "MERKEZ",  Ad = "Genel Müdürlük",   Tur = "Genel Müdürlük" },
            new() { Kod = "DEPO",    Ad = "Lojistik Depo",    Tur = "Lojistik Depo" },
            new() { Kod = "SEFAKOY", Ad = "Sefaköy Şubesi",   Tur = "Şube" },
            new() { Kod = "SUBE03",  Ad = "3 No.lu Şube",     Tur = "Şube" },
            new() { Kod = "SUBE04",  Ad = "4 No.lu Şube",     Tur = "Şube" },
            new() { Kod = "SUBE05",  Ad = "5 No.lu Şube",     Tur = "Şube" }
        },
        BirimTurleri = new List<BirimTuru>
        {
            new()
            {
                Ad = "Şube",
                Aciklama = "Mağazalarımızda satış, kasa, reyon ve gıda bölümlerinde " +
                           "görev alın. Size en yakın şubeyi seçerek başvurun.",
                Rozet = "Tüm şubelerimiz",
                Bolumler = new List<string>
                {
                    "Aşçı", "Kasap Şefi", "Kasap", "Kasa Şefi", "Kasiyer",
                    "Mağaza Müdürü", "Mağaza Şefi", "Manav Şefi", "Manav",
                    "Müdür Yardımcısı", "Pastane - Tandolya Fırın",
                    "Reyon Şefi", "Reyoner", "Şarküteri Şefi", "Şarküteri",
                    "Temizlik"
                }
            },
            new()
            {
                Ad = "Lojistik Depo",
                Aciklama = "Depo, sevkiyat ve dağıtım operasyonlarımızın bir parçası olun.",
                Rozet = "Vardiyalı çalışma",
                Bolumler = new List<string>
                {
                    "Mal Kabul", "Depo Görevlisi", "Depo Sorumlusu",
                    "Forklift Operatörü", "Sevkiyat Görevlisi",
                    "Şoför / Dağıtım", "Sayım Görevlisi", "Temizlik"
                }
            },
            new()
            {
                Ad = "Genel Müdürlük",
                Aciklama = "Ofis ve destek birimlerimizde uzmanlık alanınıza uygun " +
                           "pozisyonlarda çalışın.",
                Rozet = "Küçükçekmece",
                Bolumler = new List<string>
                {
                    "Bilgi İşlem", "Muhasebe", "Ön Muhasebe", "İnsan Kaynakları",
                    "Satın Alma", "Pazarlama", "İdari İşler", "Kalite Kontrol",
                    "Sekreter", "Temizlik"
                }
            }
        },
        Bolumler = new List<string>(),
        Bolgeler = new List<BolgeTanimi>(),
        WhatsappSablonu =
            "Sayın {ad}, Biçen Market'e yaptığınız başvuru için sizi görüşmeye " +
            "davet ediyoruz.\n\n" +
            "Tarih: {tarih} {saat}\n" +
            "Yer: {yer}\n\n" +
            "{not}\n\n" +
            "Yanınızda kimlik belgenizi getirmeniz yeterlidir. İyi günler dileriz.\n\n" +
            "{uzman}\n{unvan}\n{telefon}",
        EgitimSeviyeleri = new List<string>
        {
            "İlkokul", "Ortaokul", "Lise", "Ön Lisans",
            "Lisans (Üniversite)", "Yüksek Lisans", "Doktora"
        },
        KanGruplari = new List<string>
        {
            "A Rh+", "A Rh-", "B Rh+", "B Rh-",
            "AB Rh+", "AB Rh-", "0 Rh+", "0 Rh-"
        },
        AskerlikDurumlari = new List<string>
        {
            "Yapıldı", "Yapılmadı", "Tecilli", "Muaf / İlgili değil"
        },
        EhliyetSiniflari = new List<string>
        {
            "A", "A1", "A2", "B", "B1", "BE", "C", "C1", "CE",
            "D", "D1", "DE", "F", "G", "M"
        },
        SrcBelgeleri = new List<string> { "SRC1", "SRC2", "SRC3", "SRC4" },
        BilgisayarProgramlari = new List<string> { "Excel", "Word", "PowerPoint", "Diğer" },
        MedeniDurumlar = new List<string> { "Evli", "Bekar" },
        Uyruklar = new List<string> { "T.C.", "Yabancı Uyruklu" },
        SertifikaBolumuAcik = true,
        ReferansBolumuAcik = true,
        IsTecrubesiBolumuAcik = true,
        EpostaZorunlu = false,
        EnFazlaSertifika = 6,
        Iller = new List<string> { "İstanbul" },
        EngelTurleri = new List<string>
        {
            "Bedensel (Ortopedik)", "Görme", "İşitme", "Dil ve Konuşma",
            "Zihinsel", "Ruhsal ve Duygusal", "Süreğen (Kronik) Hastalık", "Diğer"
        },
        AydinlatmaMetni = "",
        AcikRizaMetni = ""
    };
}

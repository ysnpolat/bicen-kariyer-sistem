/* ==========================================================================
   Biçen Kariyer - Veritabanı Kurulum Betiği
   --------------------------------------------------------------------------
   Sunucu     : mail.bicen.com.tr , port 11904
   Veritabanı : biPortal   (mevcut veritabanı kullanılmaktadır)
   Kullanıcı  : rapor

   Uygulamanın tabloları biPortal içinde "KRY_" önekiyle oluşturulur:
       KRY_BASVURULAR        Başvurular (formun tamamı veri_json alanında)
       KRY_BASVURU_HAREKET   Durum değişiklikleri ve notlar
       KRY_KULLANICILAR      İK / yönetici hesapları
       KRY_AYARLAR           Mail ve form ayarları

   Önek sayesinde biPortal içindeki mevcut tablolarla çakışma olmaz.

   API açılışta bu tabloları kendisi oluşturur. "CREATE TABLE permission
   denied" benzeri bir hata alırsanız bu betiği çalıştırınız.

   Nasıl çalıştırılır:
     1. SSMS'i açıp bağlanırken:
          Server name : mail.bicen.com.tr,11904
          Login       : sysadmin yetkili bir hesap (örn. sa)
     2. Bu dosyayı açıp F5 ile çalıştırınız.
     3. API'yi yeniden başlatınız.
   ========================================================================== */

USE [biPortal];
GO

/* --------------------------------------------------------------------------
   "rapor" kullanıcısına tablo oluşturma ve veri işleme yetkisi
   --------------------------------------------------------------------------
   Yetkiler YALNIZCA biPortal veritabanı içinde geçerlidir.
   -------------------------------------------------------------------------- */

/* Veritabanı kullanıcısı yoksa oluştur */
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'rapor')
BEGIN
    CREATE USER [rapor] FOR LOGIN [rapor];
    PRINT 'rapor kullanicisi biPortal icinde olusturuldu.';
END
ELSE
    PRINT 'rapor kullanicisi zaten mevcut.';
GO

/* Seçenek 1 (önerilen): tablo oluşturma + okuma/yazma yetkisi.
   Mevcut yetkileri korunur, db_owner verilmez. */
GRANT CREATE TABLE TO [rapor];
GRANT ALTER, SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO [rapor];
PRINT 'rapor kullanicisina tablo olusturma ve veri yetkileri verildi.';
GO

/* Seçenek 2: yukarıdaki yetkiler yetmezse db_owner verilebilir.
   Bu durumda kullanıcı biPortal icindeki TUM tablolara tam erisim kazanir.

ALTER ROLE db_owner ADD MEMBER [rapor];
GO
*/

PRINT '';
PRINT 'Kurulum tamamlandi. API yeniden baslatilabilir.';
GO

/* ==========================================================================
   KONTROL SORGULARI
   ========================================================================== */

/*
USE [biPortal];

-- Uygulamanın tabloları oluşmuş mu?
SELECT name AS Tablo FROM sys.tables WHERE name LIKE 'KRY_%' ORDER BY name;

-- Yönetici hesabı
SELECT kullanici_adi, ad_soyad, rol, aktif FROM KRY_KULLANICILAR;

-- Başvuru sayısı
SELECT COUNT(*) AS BasvuruSayisi FROM KRY_BASVURULAR;
*/

/* ==========================================================================
   UYGULAMAYA ÖZEL KULLANICI (daha güvenli seçenek)
   --------------------------------------------------------------------------
   "rapor" hesabı başka sistemlerde de kullanılıyorsa, bu uygulama için ayrı
   bir hesap açmak daha doğrudur. Aşağıdaki bloğu çalıştırıp
   appsettings.json içindeki User Id / Password değerlerini
   bicen_kariyer / Kariyer2026! olarak değiştiriniz.
   ==========================================================================

USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'bicen_kariyer')
    CREATE LOGIN [bicen_kariyer] WITH PASSWORD = 'Kariyer2026!',
        CHECK_POLICY = OFF, DEFAULT_DATABASE = [biPortal];
GO
USE [biPortal];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'bicen_kariyer')
    CREATE USER [bicen_kariyer] FOR LOGIN [bicen_kariyer];
GO
GRANT CREATE TABLE TO [bicen_kariyer];
GRANT ALTER, SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO [bicen_kariyer];
GO

*/

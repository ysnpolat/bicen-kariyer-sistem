/* ==========================================================================
   Biçen Kariyer - Şube Listesini SQL ile Güncelleme
   --------------------------------------------------------------------------
   Şubeler, KRY_AYARLAR tablosundaki 'FORM' satırında JSON olarak tutulur.
   Bu betik listeyi tek seferde yazar; panelden tek tek girmeye gerek kalmaz.

   Nasıl kullanılır:
     1. SSMS ile bağlanınız:  mail.bicen.com.tr,11904  →  biPortal
     2. Aşağıdaki 2. ADIM bölümündeki VALUES listesini kendi şubelerinizle
        değiştiriniz.
     3. Betiği çalıştırınız.
     4. Aday sayfasını yenileyiniz (F5). Uygulamayı yeniden başlatmak
        gerekmez, ayarlar her istekte veritabanından okunur.

   ÖNEMLİ: Şube kodları QR adresindeki ?sube= değeri ile birebir aynı olur.
           Türkçe karakter ve boşluk kullanmayınız (SEFAKOY gibi).
   ========================================================================== */

USE [biPortal];
GO

/* --------------------------------------------------------------------------
   1. ADIM: Mevcut durumu görelim
   -------------------------------------------------------------------------- */

SELECT
    JSON_VALUE(deger, '$.duyuru')                    AS Duyuru,
    (SELECT COUNT(*) FROM OPENJSON(deger, '$.subeler'))   AS SubeSayisi,
    (SELECT COUNT(*) FROM OPENJSON(deger, '$.bolumler'))  AS BolumSayisi,
    guncelleme                                       AS SonGuncelleme
FROM KRY_AYARLAR
WHERE anahtar = 'FORM';

/* Kayıtlı şubeleri listele */
SELECT s.[kod], s.[ad]
FROM KRY_AYARLAR a
CROSS APPLY OPENJSON(a.deger, '$.subeler')
    WITH ([kod] NVARCHAR(50) '$.kod', [ad] NVARCHAR(150) '$.ad') s
WHERE a.anahtar = 'FORM';
GO

/* --------------------------------------------------------------------------
   2. ADIM: Şube listesini yaz
   --------------------------------------------------------------------------
   Aşağıdaki VALUES listesini düzenleyiniz. Her satır:  ('KOD', 'Şube Adı')

   Excel'de şube kodu ve adı varsa şu formülle satırları üretebilirsiniz:
       ="('"&A2&"', '"&B2&"'),"
   -------------------------------------------------------------------------- */

DECLARE @SubeJson NVARCHAR(MAX);

SELECT @SubeJson =
(
    SELECT v.kod AS [kod], v.ad AS [ad]
    FROM (VALUES
        (N'MERKEZ',   N'Merkez / Genel Müdürlük'),
        (N'SEFAKOY',  N'Sefaköy Şubesi'),
        (N'SUBE03',   N'3 No.lu Şube'),
        (N'SUBE04',   N'4 No.lu Şube'),
        (N'SUBE05',   N'5 No.lu Şube')
        -- Buraya 34 şubenin tamamını ekleyiniz.
        -- Son satırdan sonra virgül KOYMAYINIZ.
    ) AS v(kod, ad)
    FOR JSON PATH
);

/* FORM satırı yoksa oluştur (normalde API açılışta oluşturur) */
IF NOT EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = 'FORM')
BEGIN
    INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme)
    VALUES ('FORM', N'{}', SYSDATETIME());

    PRINT 'FORM satiri olusturuldu.';
END

UPDATE KRY_AYARLAR
SET deger = JSON_MODIFY(deger, '$.subeler', JSON_QUERY(@SubeJson)),
    guncelleme = SYSDATETIME()
WHERE anahtar = 'FORM';

PRINT CONCAT('Sube listesi guncellendi. Yazilan sube sayisi: ',
             (SELECT COUNT(*) FROM OPENJSON(@SubeJson)));
GO

/* --------------------------------------------------------------------------
   3. ADIM: Doğrulama
   -------------------------------------------------------------------------- */

SELECT s.[kod], s.[ad]
FROM KRY_AYARLAR a
CROSS APPLY OPENJSON(a.deger, '$.subeler')
    WITH ([kod] NVARCHAR(50) '$.kod', [ad] NVARCHAR(150) '$.ad') s
WHERE a.anahtar = 'FORM'
ORDER BY s.[ad];
GO

/* ==========================================================================
   EK: BÖLÜM LİSTESİNİ GÜNCELLEME
   --------------------------------------------------------------------------
   Çalışmak istediğiniz bölümler listesi de aynı satırda tutulur.
   Gerekirse aşağıdaki bloğu çalıştırınız.
   ==========================================================================

DECLARE @BolumJson NVARCHAR(MAX) = N'[
  "Aşçı", "Mal Kabul", "Kasap Şefi", "Kasap", "Kasa Şefi", "Kasiyer",
  "Mağaza Müdürü", "Mağaza Şefi", "Manav Şefi", "Manav",
  "Müdür Yardımcısı", "Pastane - Tandolya Fırın", "Reyon Şefi",
  "Reyoner", "Şarküteri Şefi", "Şarküteri", "Temizlik"
]';

UPDATE KRY_AYARLAR
SET deger = JSON_MODIFY(deger, '$.bolumler', JSON_QUERY(@BolumJson)),
    guncelleme = SYSDATETIME()
WHERE anahtar = 'FORM';
GO

*/

/* ==========================================================================
   EK: DUYURU METNİ
   --------------------------------------------------------------------------
   Aday formunun üstünde görünen duyuru. Boş bırakılırsa gösterilmez.
   ==========================================================================

UPDATE KRY_AYARLAR
SET deger = JSON_MODIFY(deger, '$.duyuru',
        N'Yaz dönemi alımlarımız başlamıştır.'),
    guncelleme = SYSDATETIME()
WHERE anahtar = 'FORM';
GO

*/

/* ==========================================================================
   EK: BAŞVURULARI ŞUBEYE GÖRE SAYMA
   --------------------------------------------------------------------------
   Hangi şubeye kaç başvuru gelmiş?
   ==========================================================================

SELECT
    ISNULL(sube_adi, '(belirtilmemiş)') AS Sube,
    COUNT(*)                            AS Basvuru,
    SUM(CASE WHEN durum = 'Yeni' THEN 1 ELSE 0 END) AS Yeni
FROM KRY_BASVURULAR
GROUP BY sube_adi
ORDER BY Basvuru DESC;

*/

-- ---------------------------------------------------------------------------
-- Norm kadro kolonlarını ondalığa çevirme
-- ---------------------------------------------------------------------------
-- API açılışta bunu kendiliğinden dener. Yetki nedeniyle başarısız olursa bu
-- betiği SSMS'te yetkili bir hesapla biPortal veritabanı üzerinde çalıştırınız.
--
-- Yaptığı iş: norm, mevcut, engelli ve hedef kolonlarını DECIMAL(7,1) yapar.
-- Kolonlara bağlı varsayılan değer kısıtları önce kaldırılır, sonra geri
-- eklenir; SQL Server aksi hâlde tip değişikliğine izin vermez.
-- ---------------------------------------------------------------------------

USE biPortal;
GO

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

        IF @kisit IS NOT NULL
        BEGIN
            SET @komut = 'ALTER TABLE KRY_KADRO ADD CONSTRAINT ' + QUOTENAME(@kisit) +
                         ' DEFAULT 0 FOR ' + QUOTENAME(@kolon);
            EXEC sp_executesql @komut;
        END

        PRINT @kolon + ' kolonu ondalığa çevrildi.';
        SET @kisit = NULL;
    END

    FETCH NEXT FROM kadro_imleci INTO @kolon, @bos;
END

CLOSE kadro_imleci;
DEALLOCATE kadro_imleci;
GO

-- Sonucu doğrulama
SELECT c.name AS kolon, t.name AS tip, c.precision, c.scale
FROM sys.columns c
JOIN sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('KRY_KADRO')
  AND c.name IN ('norm', 'mevcut', 'engelli', 'hedef');
GO

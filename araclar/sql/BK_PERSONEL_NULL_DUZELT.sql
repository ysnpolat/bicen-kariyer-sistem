/* ===========================================================================
   BK_PERSONEL_NULL_DUZELT (21.10.2026)
   ---------------------------------------------------------------------------
   Panelden (BK_PERSONEL_SICIL_AC) açılmış kartlarda boş bırakılabilen
   kolonlar NULL kalmıştı (per_iptal, per_hidden, per_kilitli ...). Mikro'nun
   isimle araması bu kartları göstermiyordu. Bu betik yalnızca per_iptal'i
   NULL olan kartlarda NULL alanları Mikro'nun boş değerine çevirir:
   metin '', sayı 0, tarih 1899-12-30, smalldatetime 1900-01-01,
   uniqueidentifier sıfır GUID. Dolu alanlara dokunmaz.

   Mikro sunucusunda, MikroDesktop_2004BICEN üzerinde SSMS'te çalıştırın.
   Önce @Yaz = 0 ile çalıştırıp etkilenecek kartları görün, sonra @Yaz = 1.
   =========================================================================== */
USE [MikroDesktop_2004BICEN];
SET NOCOUNT ON;

DECLARE @Yaz BIT = 0;   -- 1 yapınca yazar

SELECT per_kod, per_adi, per_soyadi, per_create_date
FROM dbo.PERSONELLER
WHERE per_iptal IS NULL
ORDER BY per_create_date DESC;

IF @Yaz = 1
BEGIN
    DECLARE @set NVARCHAR(MAX), @komut NVARCHAR(MAX);

    SELECT @set = STUFF((
        SELECT N', ' + QUOTENAME(c.name) + N' = ISNULL(' + QUOTENAME(c.name) + N', ' + CASE
            WHEN TYPE_NAME(c.system_type_id) IN ('char', 'varchar', 'nchar', 'nvarchar') THEN N''''''
            WHEN TYPE_NAME(c.system_type_id) = 'smalldatetime' THEN N'''19000101'''
            WHEN TYPE_NAME(c.system_type_id) IN ('datetime', 'datetime2', 'date') THEN N'''18991230'''
            WHEN TYPE_NAME(c.system_type_id) = 'uniqueidentifier' THEN N'''00000000-0000-0000-0000-000000000000'''
            ELSE N'0' END + N')'
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID('dbo.PERSONELLER')
          AND c.is_nullable = 1 AND c.is_computed = 0 AND c.is_identity = 0
          AND TYPE_NAME(c.system_type_id) NOT IN ('timestamp', 'text', 'ntext', 'image', 'binary', 'varbinary', 'xml')
        ORDER BY c.column_id
        FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'');

    SET @komut = N'UPDATE dbo.PERSONELLER SET ' + @set + N' WHERE per_iptal IS NULL;';

    BEGIN TRANSACTION;
    EXEC sp_executesql @komut;
    DECLARE @adet INT = @@ROWCOUNT;
    PRINT CAST(@adet AS NVARCHAR(10)) + N' kart düzeltildi.';
    COMMIT TRANSACTION;
END

/* ===========================================================================
   POSBACK_PUANHAREKET_INDEKS (21.10.2026, firma listesiyle güncellendi)
   ---------------------------------------------------------------------------
   Posback firmasının merkez tarafında PuanHareket için olması gerektiğini
   bildirdiği 4 indeks. Betik her birini ADINA ve KOLONLARINA göre denetler;
   yalnızca eksik olanı oluşturur. Var olana dokunmaz.

     1. IDX_Ph_PosbackId                 (PosbackId)
     2. IX_KartNo_FirmaId                (KartNo, FirmaId, PuanKodu, IslemTipi, SonKullanimTarihi)
     3. IX_PUANHAR_KART_ISLMT_SONKULTAR  (KartNo, IslemTipi, SonKullanimTarihi) + Puan, PuanKodu, EksiPuan
        → Biçen Kart bakiye sorgusunu (dbo.PuanBakiye ve panelin toplu
          bakiyesi) bu karşılıyor. Ayrıca bizim indeksimize gerek yok.
     4. IX_PUANKART_1                    (Tarih) + IslemTipi, KartNo, Puan

   UYGULAMA: Kasalar kapalıyken, Posback sunucusunda PosbackPromosyon
   veritabanında SSMS ile çalıştırın.
     - @Yaz = 0: yalnızca durumu gösterir (hangisi var, hangisi eksik).
     - @Yaz = 1: eksikleri oluşturur.
   Her indeks birkaç saniye ile birkaç dakika sürer; oluşturulurken tablo
   yazmaya kilitlenir.

   Notlar:
     - DATA_COMPRESSION = PAGE her sürümde desteklenmez (Standard sürümde
       SQL 2016 SP1 öncesi). Desteklenmezse indeks sıkıştırmasız oluşturulur;
       işlev aynıdır.
     - OPTIMIZE_FOR_SEQUENTIAL_KEY yalnızca SQL 2019+; varsayılanı zaten OFF
       olduğu için betikte yazılmadı.
   =========================================================================== */

USE [PosbackPromosyon];
SET NOCOUNT ON;

DECLARE @Yaz BIT = 0;   -- 1 yapınca eksikleri oluşturur

/* ---------------------------------------------------------------- durum */
DECLARE @istenen TABLE (sira INT, ad SYSNAME, anahtar NVARCHAR(400), ekli NVARCHAR(400), sikistir BIT);
INSERT INTO @istenen VALUES
 (1, 'IDX_Ph_PosbackId',                'PosbackId', '', 0),
 (2, 'IX_KartNo_FirmaId',               'KartNo, FirmaId, PuanKodu, IslemTipi, SonKullanimTarihi', '', 1),
 (3, 'IX_PUANHAR_KART_ISLMT_SONKULTAR', 'KartNo, IslemTipi, SonKullanimTarihi', 'Puan, PuanKodu, EksiPuan', 0),
 (4, 'IX_PUANKART_1',                   'Tarih', 'IslemTipi, KartNo, Puan', 0);

;WITH mevcut AS (
    SELECT i.name,
           STUFF((SELECT ', ' + c.name FROM sys.index_columns ic
                  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                  WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                  ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS anahtar
    FROM sys.indexes i
    WHERE i.object_id = OBJECT_ID('dbo.PuanHareket') AND i.type > 0
)
SELECT s.sira, s.ad AS istenen_indeks, s.anahtar AS kolonlar,
       CASE WHEN EXISTS (SELECT 1 FROM mevcut m WHERE m.name = s.ad) THEN 'VAR (aynı adla)'
            WHEN EXISTS (SELECT 1 FROM mevcut m WHERE m.anahtar = s.anahtar) THEN
                 'VAR (başka adla: ' + (SELECT TOP 1 m.name FROM mevcut m WHERE m.anahtar = s.anahtar) + ')'
            ELSE 'EKSİK' END AS durum
FROM @istenen s
ORDER BY s.sira;

/* Tablodaki bütün indeksler (firmaya bilgi için) */
SELECT i.name AS indeks, i.type_desc,
       STUFF((SELECT ', ' + c.name FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
              ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') AS anahtar,
       STUFF((SELECT ', ' + c.name FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1
              FOR XML PATH('')), 1, 2, '') AS ekli
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.PuanHareket') AND i.type > 0
ORDER BY i.index_id;

IF @Yaz = 0
BEGIN
    PRINT 'Yalnızca durum gösterildi. Eksikleri oluşturmak için @Yaz = 1 yapın.';
    RETURN;
END

/* ------------------------------------------------------- eksikleri oluştur */
DECLARE @sira INT, @ad SYSNAME, @anahtar NVARCHAR(400), @ekli NVARCHAR(400), @sikistir BIT, @komut NVARCHAR(MAX);

DECLARE k CURSOR LOCAL FAST_FORWARD FOR SELECT sira, ad, anahtar, ekli, sikistir FROM @istenen ORDER BY sira;
OPEN k;
FETCH NEXT FROM k INTO @sira, @ad, @anahtar, @ekli, @sikistir;

WHILE @@FETCH_STATUS = 0
BEGIN
    IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PuanHareket') AND name = @ad)
        PRINT @ad + ' zaten var, atlandı.';
    ELSE IF EXISTS (
        SELECT 1 FROM sys.indexes i
        WHERE i.object_id = OBJECT_ID('dbo.PuanHareket') AND i.type > 0
          AND STUFF((SELECT ', ' + c.name FROM sys.index_columns ic
                     JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                     WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
                     ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 2, '') = @anahtar)
        PRINT @ad + ' aynı kolonlarla başka adla var, atlandı.';
    ELSE
    BEGIN
        SET @komut = N'CREATE NONCLUSTERED INDEX ' + QUOTENAME(@ad) + N' ON dbo.PuanHareket (' + @anahtar + N')'
                   + CASE WHEN @ekli <> '' THEN N' INCLUDE (' + @ekli + N')' ELSE N'' END
                   + N' WITH (SORT_IN_TEMPDB = ON'
                   + CASE WHEN @sikistir = 1 THEN N', DATA_COMPRESSION = PAGE' ELSE N'' END + N')';
        BEGIN TRY
            EXEC sp_executesql @komut;
            PRINT @ad + ' oluşturuldu.';
        END TRY
        BEGIN CATCH
            IF @sikistir = 1
            BEGIN
                /* Sıkıştırma desteklenmiyorsa sıkıştırmasız */
                SET @komut = REPLACE(@komut, N', DATA_COMPRESSION = PAGE', N'');
                EXEC sp_executesql @komut;
                PRINT @ad + ' oluşturuldu (sıkıştırmasız; bu sürüm PAGE sıkıştırmayı desteklemiyor).';
            END
            ELSE
            BEGIN
                PRINT @ad + ' OLUŞTURULAMADI: ' + ERROR_MESSAGE();
            END
        END CATCH
    END

    FETCH NEXT FROM k INTO @sira, @ad, @anahtar, @ekli, @sikistir;
END

CLOSE k;
DEALLOCATE k;

/* Önceki önerimiz (IX_BK_PuanHareket_Kart) firma indeksiyle aynı işi görüyor;
   oluşturulduysa gereksiz yazma yükü olmasın diye kaldırılır. */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.PuanHareket') AND name = 'IX_BK_PuanHareket_Kart')
BEGIN
    DROP INDEX IX_BK_PuanHareket_Kart ON dbo.PuanHareket;
    PRINT 'IX_BK_PuanHareket_Kart kaldırıldı (firma indeksi 3 aynı işi görüyor).';
END

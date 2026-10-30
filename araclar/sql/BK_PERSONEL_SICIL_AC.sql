/* ==========================================================================
   BK_PERSONEL_SICIL_AC  ·  Mikro'da personel sicil kartı açar (09.10.2026)
   --------------------------------------------------------------------------
   KURULUM: SSMS'te Mikro sunucusuna (11902) bağlanıp bu dosyayı BİR KEZ
   çalıştırın. Mikro sürüm güncellemesinden sonra prosedür silinmişse yeniden
   çalıştırın. Panelin kullandığı SQL kullanıcısına (rapor) EXECUTE yetkisi
   verilir (en altta).

   Yalnızca [MikroDesktop_2004BICEN].dbo.PERSONELLER'e (GYRSM) yazar.
   MikroDesktop_BICEN'e (RSM) dokunmaz.

   Kartın alanları:
     - Parametrelerden: ad, soyad, TC (per_sicil_no'ya da TC), cinsiyet,
       medeni hâl, doğum, tahsil, telefon, adres, iş grubu, ünvan, meslek,
       giriş tarihi, ücret, brüt/net, asgari ücretli, IBAN, BES, engellilik
       derecesi ve oranı, sigorta grubu.
     - Şubeden (aynı iş grubundaki kartlarda en sık değer): departman,
       bölge, SGK işyeri, muhasebe grubu.
     - Ünvandan (aynı ünvandaki aktif personelde en sık değer): görev kodu,
       SGK meslek kodu, çalışma şekli, SGK belge türü.
     - Mikro sabitleri (son açılan 60 kartta en sık): dosya no, program,
       sürüm, menü, kan grubu, özel indirim, işsizlik sigortası.
     - Geri kalan her kolon: boş (metin '', sayı 0, tarih 31.12.1899; NULL
       olabilen kolon NULL). Mikro'nun açtığı kartla aynı.
   per_kod: Mikro'da EN SON AÇILAN kartın numarası + 1 (dolu ise ilk boş).

   DENEME: @Kontrol = 1 verilirse kart YAZILMAZ; açılacak satır ekrana
   gelir ve her şey geri alınır.

   ÖRNEK:
     DECLARE @kod NVARCHAR(25);
     EXEC dbo.BK_PERSONEL_SICIL_AC
          @MikroKullanici = 130, @Ad = N'AD', @Soyad = N'SOYAD',
          @TcKimlikNo = N'10000000146', @Cinsiyet = 1, @MedeniHal = 1,
          @DogumTarihi = '20030411', @Telefon = N'5321234567',
          @IsGrubuKodu = N'16', @UnvanKodu = N'30',
          @GirisTarihi = '20261010', @Ucret = 29933, @BrutNet = 0,
          @AsgariUcretli = 1, @Kontrol = 1, @PerKod = @kod OUTPUT;
     SELECT @kod;
   ========================================================================== */
USE [MikroDesktop_2004BICEN];
GO

IF OBJECT_ID('dbo.BK_PERSONEL_SICIL_AC', 'P') IS NOT NULL
    DROP PROCEDURE dbo.BK_PERSONEL_SICIL_AC;
GO

CREATE PROCEDURE dbo.BK_PERSONEL_SICIL_AC
    @MikroKullanici   INT,                      -- per_create_user / per_lastup_user
    @Ad               NVARCHAR(50),
    @Soyad            NVARCHAR(50),
    @TcKimlikNo       NVARCHAR(11),
    @Cinsiyet         TINYINT,                  -- 0 erkek, 1 kadın
    @MedeniHal        TINYINT,                  -- 0 evli, 1 bekâr
    @DogumTarihi      DATETIME,
    @DogumYeri        NVARCHAR(50)  = NULL,
    @Tahsil           TINYINT       = 0,
    @Telefon          NVARCHAR(15),             -- 5XXXXXXXXX
    @Il               NVARCHAR(50)  = N'İSTANBUL',
    @Ilce             NVARCHAR(50)  = NULL,
    @Semt             NVARCHAR(50)  = NULL,
    @Mahalle          NVARCHAR(50)  = NULL,
    @Cadde            NVARCHAR(50)  = NULL,
    @Sokak            NVARCHAR(50)  = NULL,
    @BinaNo           NVARCHAR(10)  = NULL,
    @DaireNo          NVARCHAR(10)  = NULL,
    @IsGrubuKodu      NVARCHAR(25),             -- per_is_grup_kodu (şube)
    @UnvanKodu        NVARCHAR(25),             -- per_unvan_kodu
    @Meslek           NVARCHAR(50)  = NULL,     -- boşsa ünvandaki en sık meslek
    @GirisTarihi      DATETIME,
    @Ucret            DECIMAL(18,2),
    @BrutNet          TINYINT       = 1,        -- 0 brüt, 1 net
    @AsgariUcretli    TINYINT       = 0,
    @Iban             NVARCHAR(34)  = NULL,     -- TR + 24 hane
    @Bes              TINYINT       = NULL,     -- NULL: 45 yaş altı dahil
    @SakatDerece      TINYINT       = 0,        -- 0 değil, 1 (%80+), 2 (%60-79), 3 (%40-59)
    @EngellilikOrani  TINYINT       = 0,
    @SigortaGrubu     TINYINT       = 0,        -- 0 normal, 1 emekli, 2 çırak, 3 yabancı, 4 öğrenci
    @Kontrol          BIT           = 0,        -- 1: yazmadan göster
    @PerKod           NVARCHAR(25)  = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @hata NVARCHAR(500);

    /* ------------------------------------------------------- denetimler */
    SET @Ad = UPPER(LTRIM(RTRIM(ISNULL(@Ad, N''))));
    SET @Soyad = UPPER(LTRIM(RTRIM(ISNULL(@Soyad, N''))));
    SET @TcKimlikNo = LTRIM(RTRIM(ISNULL(@TcKimlikNo, N'')));
    SET @Iban = REPLACE(UPPER(LTRIM(RTRIM(ISNULL(@Iban, N'')))), N' ', N'');

    IF LEN(@Ad) < 2 OR LEN(@Soyad) < 2
        BEGIN RAISERROR(N'Ad ve soyad giriniz.', 16, 1); RETURN; END
    IF LEN(@TcKimlikNo) <> 11 OR @TcKimlikNo LIKE N'%[^0-9]%'
        BEGIN RAISERROR(N'T.C. kimlik numarası 11 hane olmalı.', 16, 1); RETURN; END
    IF @Cinsiyet NOT IN (0, 1) OR @MedeniHal NOT IN (0, 1)
        BEGIN RAISERROR(N'Cinsiyet ve medeni hâl 0 ya da 1 olmalı.', 16, 1); RETURN; END
    IF @DogumTarihi IS NULL OR @GirisTarihi IS NULL
        BEGIN RAISERROR(N'Doğum ve giriş tarihi giriniz.', 16, 1); RETURN; END
    IF ISNULL(@Ucret, 0) <= 0
        BEGIN RAISERROR(N'Ücret giriniz.', 16, 1); RETURN; END
    IF @SakatDerece > 3 OR @SigortaGrubu > 4
        BEGIN RAISERROR(N'Engellilik derecesi 0-3, sigorta grubu 0-4 olmalı.', 16, 1); RETURN; END
    IF @Iban <> N'' AND (LEN(@Iban) <> 26 OR LEFT(@Iban, 2) <> N'TR')
        BEGIN RAISERROR(N'IBAN TR ile başlayan 26 karakter olmalı.', 16, 1); RETURN; END
    IF @MikroKullanici IS NULL OR @MikroKullanici <= 0
        BEGIN RAISERROR(N'Mikro kullanıcı numarası giriniz.', 16, 1); RETURN; END

    IF @Bes IS NULL
        SET @Bes = CASE WHEN DATEDIFF(YEAR, @DogumTarihi, GETDATE())
                             - CASE WHEN DATEADD(YEAR, DATEDIFF(YEAR, @DogumTarihi, GETDATE()), @DogumTarihi) > GETDATE() THEN 1 ELSE 0 END < 45
                        THEN 1 ELSE 0 END;

    IF NOT EXISTS (SELECT 1 FROM dbo.PERSONEL_IS_GRUP_TANIMLARI WITH (NOLOCK) WHERE ig_kod = @IsGrubuKodu)
        BEGIN SET @hata = N'İş grubu Mikro''da tanımlı değil: ' + @IsGrubuKodu; RAISERROR(@hata, 16, 1); RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.PERSONELLER WITH (NOLOCK) WHERE per_is_grup_kodu = @IsGrubuKodu)
        BEGIN RAISERROR(N'Bu iş grubunda hiç kart yok; SGK işyeri ve departman alınamadı. İlk kartı Mikro''dan açın.', 16, 1); RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.PERSONELLER WITH (NOLOCK)
                   WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101'))
        BEGIN SET @hata = N'Bu ünvanda aktif personel yok, görev kodu alınamadı: ' + @UnvanKodu; RAISERROR(@hata, 16, 1); RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        /* Panelden aynı anda iki kart açılmasın */
        DECLARE @kilit INT;
        EXEC @kilit = sp_getapplock @Resource = N'BicenKariyer.MikroSicil', @LockMode = N'Exclusive',
                                    @LockOwner = N'Transaction', @LockTimeout = 15000;
        IF @kilit < 0
            RAISERROR(N'Başka bir sicil kartı açılıyor; biraz sonra tekrar deneyin.', 16, 1);

        /* Aynı TC ile aktif kart varsa açılmaz */
        DECLARE @aktifKod NVARCHAR(25);
        SELECT TOP 1 @aktifKod = LTRIM(RTRIM(per_kod))
        FROM dbo.PERSONELLER
        WHERE LTRIM(RTRIM(Per_TcKimlikNo)) = @TcKimlikNo
          AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101');

        IF @aktifKod IS NOT NULL
        BEGIN
            SET @hata = N'Bu T.C. kimlik numarasıyla GYRSM''de aktif sicil var: ' + @aktifKod + N'. Yeni kart açılmadı.';
            RAISERROR(@hata, 16, 1);
        END

        /* per_kod: en son açılan kartın numarası + 1, doluysa ilk boş */
        DECLARE @son INT;

        SELECT TOP 1 @son = x.k
        FROM (SELECT TOP 50 per_create_date,
                     CASE WHEN LTRIM(RTRIM(per_kod)) NOT LIKE '%[^0-9]%'
                               AND LEN(LTRIM(RTRIM(per_kod))) BETWEEN 1 AND 9
                          THEN CAST(LTRIM(RTRIM(per_kod)) AS INT) END AS k
              FROM dbo.PERSONELLER
              WHERE per_create_date IS NOT NULL
              ORDER BY per_create_date DESC) x
        WHERE x.k IS NOT NULL
        ORDER BY x.per_create_date DESC;

        IF @son IS NULL RAISERROR(N'Son açılan kartın numarası okunamadı.', 16, 1);

        SET @son = @son + 1;
        WHILE EXISTS (SELECT 1 FROM dbo.PERSONELLER WHERE LTRIM(RTRIM(per_kod)) = CAST(@son AS NVARCHAR(25)))
            SET @son = @son + 1;

        SET @PerKod = CAST(@son AS NVARCHAR(25));

        /* ------------------------------------------- boş satır (Mikro'nun boşları) */
        SELECT TOP 0 * INTO #yeni FROM dbo.PERSONELLER;

        DECLARE @kolonlar NVARCHAR(MAX), @degerler NVARCHAR(MAX), @komut NVARCHAR(MAX);

        SELECT @kolonlar = STUFF((
            SELECT N', ' + QUOTENAME(c.name)
            FROM sys.columns c
            WHERE c.object_id = OBJECT_ID('dbo.PERSONELLER') AND c.is_computed = 0 AND c.is_identity = 0
              AND TYPE_NAME(c.system_type_id) NOT IN ('timestamp')
            ORDER BY c.column_id
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'');

        SELECT @degerler = STUFF((
            /* 21.10.2026: boş bırakılabilen kolonlara da NULL değil Mikro'nun boş
               değeri yazılır. per_iptal / per_hidden NULL kalınca Mikro'nun isimle
               araması kartı göstermiyordu (sicil koduyla arama gösteriyordu). */
            SELECT N', ' + CASE
                WHEN TYPE_NAME(c.system_type_id) IN ('char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext') THEN N''''''
                WHEN TYPE_NAME(c.system_type_id) = 'smalldatetime' THEN N'''19000101'''
                WHEN c.is_nullable = 1 AND TYPE_NAME(c.system_type_id) IN ('datetime', 'datetime2', 'date') THEN N'''18991230'''
                WHEN TYPE_NAME(c.system_type_id) IN ('datetime', 'datetime2', 'date') THEN N'''18991231'''
                WHEN c.is_nullable = 1 AND TYPE_NAME(c.system_type_id) = 'uniqueidentifier' THEN N'''00000000-0000-0000-0000-000000000000'''
                WHEN TYPE_NAME(c.system_type_id) = 'uniqueidentifier' THEN N'NEWID()'
                WHEN TYPE_NAME(c.system_type_id) IN ('binary', 'varbinary', 'image') THEN N'0x'
                ELSE N'0' END
            FROM sys.columns c
            WHERE c.object_id = OBJECT_ID('dbo.PERSONELLER') AND c.is_computed = 0 AND c.is_identity = 0
              AND TYPE_NAME(c.system_type_id) NOT IN ('timestamp')
            ORDER BY c.column_id
            FOR XML PATH(''), TYPE).value('.', 'NVARCHAR(MAX)'), 1, 2, N'');

        SET @komut = N'INSERT INTO #yeni (' + @kolonlar + N') VALUES (' + @degerler + N');';
        EXEC sp_executesql @komut;

        DECLARE @simdi DATETIME = GETDATE();
        DECLARE @bugun DATETIME = DATEADD(DAY, DATEDIFF(DAY, 0, @simdi), 0);

        /* ------------------------------------------------- parametreler */
        UPDATE #yeni SET
            per_Guid             = NEWID(),
            per_kod              = @PerKod,
            per_adi              = @Ad,
            per_soyadi           = @Soyad,
            per_sicil_no         = @TcKimlikNo,
            Per_TcKimlikNo       = @TcKimlikNo,
            per_create_user      = @MikroKullanici,
            per_lastup_user      = @MikroKullanici,
            per_create_date      = @simdi,
            per_lastup_date      = @simdi,
            per_giris_tar        = DATEADD(DAY, DATEDIFF(DAY, 0, @GirisTarihi), 0),
            per_is_grup_kodu     = @IsGrubuKodu,
            per_unvan_kodu       = @UnvanKodu,
            per_kim_tahsil       = ISNULL(@Tahsil, 0),
            per_nuf_uyruk        = N'TC',
            per_nuf_cinsiyet     = @Cinsiyet,
            per_nuf_medeni_hal   = @MedeniHal,
            per_nuf_dogum_tarih  = DATEADD(DAY, DATEDIFF(DAY, 0, @DogumTarihi), 0),
            per_nuf_dogum_yer    = UPPER(ISNULL(@DogumYeri, N'')),
            per_tel_cepno        = @Telefon,
            per_adr_il           = UPPER(ISNULL(@Il, N'')),
            per_adr_ilce         = UPPER(ISNULL(@Ilce, N'')),
            per_adr_semt         = UPPER(ISNULL(@Semt, N'')),
            per_adr_mahalle      = UPPER(ISNULL(@Mahalle, N'')),
            per_adr_cadde        = UPPER(ISNULL(@Cadde, N'')),
            per_adr_sokak        = UPPER(ISNULL(@Sokak, N'')),
            per_adr_apartman_no  = UPPER(ISNULL(@BinaNo, N'')),
            per_adr_daire_no     = UPPER(ISNULL(@DaireNo, N'')),
            per_adr_ulke         = N'TÜRKİYE',
            per_ucret            = @Ucret,
            per_Brut_net         = @BrutNet,
            per_asgari_ucretli   = @AsgariUcretli,
            per_ucr_hesapno      = @Iban,
            per_kim_sakat_derece = @SakatDerece,
            per_engellilik_orani = CASE WHEN @SakatDerece = 0 THEN 0 ELSE ISNULL(@EngellilikOrani, 0) END,
            per_ucr_sig_yuzde_gr = @SigortaGrubu,
            per_otobes_fl        = @Bes,
            per_otobes_giris     = CASE WHEN @Bes = 1 THEN @bugun ELSE '18991231' END,
            per_old_tarih        = '18991230',
            per_asgucrverind_tarihi = '18991230';

        /* ------------------------------------- şube (aynı iş grubunda en sık) */
        UPDATE #yeni SET
            per_dept_kod      = ISNULL((SELECT TOP 1 per_dept_kod      FROM dbo.PERSONELLER WHERE per_is_grup_kodu = @IsGrubuKodu GROUP BY per_dept_kod      ORDER BY COUNT(*) DESC), per_dept_kod),
            per_alt_dept_kod  = ISNULL((SELECT TOP 1 per_alt_dept_kod  FROM dbo.PERSONELLER WHERE per_is_grup_kodu = @IsGrubuKodu GROUP BY per_alt_dept_kod  ORDER BY COUNT(*) DESC), per_alt_dept_kod),
            per_bolge_kodu    = ISNULL((SELECT TOP 1 per_bolge_kodu    FROM dbo.PERSONELLER WHERE per_is_grup_kodu = @IsGrubuKodu GROUP BY per_bolge_kodu    ORDER BY COUNT(*) DESC), per_bolge_kodu),
            per_ucr_PSSK_sube = ISNULL((SELECT TOP 1 per_ucr_PSSK_sube FROM dbo.PERSONELLER WHERE per_is_grup_kodu = @IsGrubuKodu GROUP BY per_ucr_PSSK_sube ORDER BY COUNT(*) DESC), per_ucr_PSSK_sube),
            per_muh_grpkod    = ISNULL((SELECT TOP 1 per_muh_grpkod    FROM dbo.PERSONELLER WHERE per_is_grup_kodu = @IsGrubuKodu GROUP BY per_muh_grpkod    ORDER BY COUNT(*) DESC), per_muh_grpkod),
            per_srmmrkdaganah_kodu = ISNULL((SELECT TOP 1 per_srmmrkdaganah_kodu FROM dbo.PERSONELLER WHERE per_is_grup_kodu = @IsGrubuKodu GROUP BY per_srmmrkdaganah_kodu ORDER BY COUNT(*) DESC), per_srmmrkdaganah_kodu);

        /* ---------------------------- ünvan (aynı ünvandaki aktiflerde en sık) */
        UPDATE #yeni SET
            per_kim_meslek     = CASE WHEN LTRIM(RTRIM(ISNULL(@Meslek, N''))) <> N'' THEN UPPER(LTRIM(RTRIM(@Meslek)))
                                      ELSE ISNULL((SELECT TOP 1 per_kim_meslek FROM dbo.PERSONELLER WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101') GROUP BY per_kim_meslek ORDER BY COUNT(*) DESC), per_kim_meslek) END,
            per_kim_gorev      = ISNULL((SELECT TOP 1 per_kim_gorev      FROM dbo.PERSONELLER WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101') GROUP BY per_kim_gorev      ORDER BY COUNT(*) DESC), per_kim_gorev),
            per_meslek_kodu    = ISNULL((SELECT TOP 1 per_meslek_kodu    FROM dbo.PERSONELLER WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101') GROUP BY per_meslek_kodu    ORDER BY COUNT(*) DESC), per_meslek_kodu),
            per_mevsim         = ISNULL((SELECT TOP 1 per_mevsim         FROM dbo.PERSONELLER WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101') GROUP BY per_mevsim         ORDER BY COUNT(*) DESC), per_mevsim),
            per_sskbelge_turu  = ISNULL((SELECT TOP 1 per_sskbelge_turu  FROM dbo.PERSONELLER WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101') GROUP BY per_sskbelge_turu  ORDER BY COUNT(*) DESC), per_sskbelge_turu),
            per_sgk_deger_kodu = ISNULL((SELECT TOP 1 per_sgk_deger_kodu FROM dbo.PERSONELLER WHERE per_unvan_kodu = @UnvanKodu AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101') GROUP BY per_sgk_deger_kodu ORDER BY COUNT(*) DESC), per_sgk_deger_kodu);

        /* ------------------------- Mikro sabitleri (son açılan 60 kartta en sık) */
        SELECT TOP 60 * INTO #son FROM dbo.PERSONELLER WITH (NOLOCK) WHERE per_create_date IS NOT NULL ORDER BY per_create_date DESC;

        UPDATE #yeni SET
            per_fileid           = ISNULL((SELECT TOP 1 per_fileid           FROM #son GROUP BY per_fileid           ORDER BY COUNT(*) DESC), per_fileid),
            per_MainProgramNo    = ISNULL((SELECT TOP 1 per_MainProgramNo    FROM #son GROUP BY per_MainProgramNo    ORDER BY COUNT(*) DESC), per_MainProgramNo),
            per_VersionNo        = ISNULL((SELECT TOP 1 per_VersionNo        FROM #son GROUP BY per_VersionNo        ORDER BY COUNT(*) DESC), per_VersionNo),
            per_MenuNo           = ISNULL((SELECT TOP 1 per_MenuNo           FROM #son GROUP BY per_MenuNo           ORDER BY COUNT(*) DESC), per_MenuNo),
            per_is_grup          = ISNULL((SELECT TOP 1 per_is_grup          FROM #son GROUP BY per_is_grup          ORDER BY COUNT(*) DESC), per_is_grup),
            per_nuf_kangrup      = ISNULL((SELECT TOP 1 per_nuf_kangrup      FROM #son GROUP BY per_nuf_kangrup      ORDER BY COUNT(*) DESC), per_nuf_kangrup),
            per_yard_ozelindirim = ISNULL((SELECT TOP 1 per_yard_ozelindirim FROM #son GROUP BY per_yard_ozelindirim ORDER BY COUNT(*) DESC), per_yard_ozelindirim),
            per_iszlksig         = ISNULL((SELECT TOP 1 per_iszlksig         FROM #son GROUP BY per_iszlksig         ORDER BY COUNT(*) DESC), per_iszlksig),
            per_otobes_sigorta   = ISNULL((SELECT TOP 1 per_otobes_sigorta   FROM #son WHERE per_otobes_sigorta <> 0 GROUP BY per_otobes_sigorta ORDER BY COUNT(*) DESC), per_otobes_sigorta),
            per_otobes_orani     = ISNULL((SELECT TOP 1 per_otobes_orani     FROM #son WHERE per_otobes_orani   <> 0 GROUP BY per_otobes_orani   ORDER BY COUNT(*) DESC), per_otobes_orani);

        /* Maaş bankası: aynı bankanın IBAN'ı olan kartlarda en sık; IBAN yoksa 0 */
        IF LEN(@Iban) = 26
            UPDATE #yeni SET per_maas_banka = ISNULL((
                SELECT TOP 1 per_maas_banka FROM dbo.PERSONELLER WITH (NOLOCK)
                WHERE SUBSTRING(REPLACE(per_ucr_hesapno, ' ', ''), 5, 5) = SUBSTRING(@Iban, 5, 5) AND per_maas_banka <> 0
                GROUP BY per_maas_banka ORDER BY COUNT(*) DESC), 0);

        /* ------------------------------------------------------ yaz / göster */
        IF @Kontrol = 1
        BEGIN
            SELECT * FROM #yeni;          -- açılacak kart (yazılmadı)
            ROLLBACK TRANSACTION;
            RETURN;
        END

        INSERT INTO dbo.PERSONELLER SELECT * FROM #yeni;

        IF @@ROWCOUNT <> 1
            RAISERROR(N'Kart eklenemedi; işlem geri alındı.', 16, 1);

        COMMIT TRANSACTION;

        SELECT @PerKod AS per_kod;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

        SET @hata = ERROR_MESSAGE();
        SET @PerKod = NULL;
        RAISERROR(@hata, 16, 1);
    END CATCH
END
GO

/* Panelin SQL kullanıcısı prosedürü çalıştırabilsin */
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'rapor')
    GRANT EXECUTE ON dbo.BK_PERSONEL_SICIL_AC TO [rapor];
GO

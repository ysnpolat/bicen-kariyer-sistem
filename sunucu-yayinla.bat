@echo off
setlocal enabledelayedexpansion
title Bicen Kariyer - Sunucu Yayinlama
color 0A
cd /d "%~dp0"

REM ==========================================================================
REM  DEPODAN GUNCELLE
REM  Bu klasor bir git deposuysa once GitHub'daki son surum cekilir.
REM  Zip kopyalama yerine: GitHub'a push edilen kod -> git pull -> derle.
REM  Depo degilse (eski zip yontemi) bu adim atlanir.
REM ==========================================================================
if exist ".git" (
    where git >nul 2>&1
    if errorlevel 1 (
        echo [HATA] Bu klasor bir git deposu ama git kurulu degil.
        echo        https://git-scm.com adresinden Git for Windows kurunuz.
        pause
        exit /b 1
    )
    echo [GIT] GitHub'dan son surum cekiliyor...
    git fetch origin main
    if errorlevel 1 (
        echo [HATA] GitHub'a ulasilamadi ^(git fetch^). Internet ya da giris sorunu.
        pause
        exit /b 1
    )
    git merge --ff-only origin/main
    if errorlevel 1 (
        echo.
        echo [HATA] Yerel degisiklik var, depo ile birlestirilemedi.
        echo        Sunucudaki dosyalari elle degistirdiyseniz once
        echo        "git status" ile bakip "git checkout -- ." ile geri aliniz,
        echo        ya da degisikligi depoya aldiriniz.
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('git log -1 --pretty^=format:"%%h  %%s  ^(%%ci^)"') do echo      Surum: %%v
    echo      Tamam.
    echo.
)

REM ==========================================================================
REM  AYARLAR - Gerekirse bu iki satiri duzenleyiniz
REM ==========================================================================
set SITE_KOK=C:\inetpub\vhosts\bicen.com.tr\kariyer.bicen.com.tr
set API_ALT=apiservis
REM ==========================================================================

set API_HEDEF=%SITE_KOK%\%API_ALT%
set PANEL_ALT=panel
set PANEL_HEDEF=%SITE_KOK%\%PANEL_ALT%
set ADRES=https://kariyer.bicen.com.tr

echo ==========================================================
echo   BICEN KARIYER - SUNUCU YAYINLAMA
echo ==========================================================
echo   Site kok klasoru : %SITE_KOK%
echo   API klasoru      : %API_HEDEF%
echo   API yolu         : /%API_ALT%
echo   IK paneli yolu   : /%PANEL_ALT%
echo ==========================================================
echo.

REM ---------------------------------------------------- gereksinim kontrolu
where dotnet >nul 2>&1
if errorlevel 1 (
    echo [HATA] dotnet bulunamadi. .NET 8 SDK kurulu olmalidir.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [HATA] npm bulunamadi. Node.js 18+ kurulu olmalidir.
    pause
    exit /b 1
)

if not exist "%SITE_KOK%" (
    echo [HATA] Site kok klasoru bulunamadi:
    echo        %SITE_KOK%
    echo.
    echo Plesk - Alan adi - Barindirma Ayarlari ekranindaki "Belge kok"
    echo degerini bu dosyanin basindaki SITE_KOK satirina yaziniz.
    pause
    exit /b 1
)

if not exist "BicenKariyer.API\BicenKariyer.API.csproj" (
    echo [HATA] BicenKariyer.API klasoru bulunamadi.
    echo Bu dosyayi paketin kok klasorunden calistiriniz.
    pause
    exit /b 1
)

REM ==========================================================================
echo [0/8] On denetim yapiliyor...
REM ==========================================================================
where python >nul 2>&1
if not errorlevel 1 (
    python araclar\on-denetim.py
    if errorlevel 1 (
        echo.
        echo [HATA] On denetim sorun buldu. Yukaridaki satirlari duzeltiniz.
        echo Denetimi atlamak icin bu adimi gecebilirsiniz ancak derleme
        echo buyuk olasilikla basarisiz olacaktir.
        pause
        exit /b 1
    )
    echo      Tamam.
) else (
    echo      Python bulunamadi, on denetim atlandi.
)
echo.

REM ==========================================================================
echo [1/8] API durduruluyor...
REM ==========================================================================
REM app_offline.htm yeni istekleri keser ama IIS calisan islemi hemen
REM sonlandirmayabilir; bu durumda DLL dosyalari kilitli kalir ve yayinlama
REM "file is locked by IIS Worker Process" hatasiyla basarisiz olur.
REM Bu yuzden uygulama havuzu da durdurulur.
if not exist "%API_HEDEF%" mkdir "%API_HEDEF%"
echo Yayinlama yapiliyor, lutfen bekleyiniz. > "%API_HEDEF%\app_offline.htm"

REM Uygulama havuzunun adi genelde site adiyla aynidir.
REM Farkliysa asagidaki HAVUZ degerini duzenleyiniz.
set "HAVUZ=kariyer.bicen.com.tr"

REM Havuz adi kurulumdan kuruluma degisir; site yolundan otomatik bulunur.
for /f "tokens=*" %%A in ('powershell -NoProfile -Command ^
  "Import-Module WebAdministration -ErrorAction SilentlyContinue;" ^
  "$s = Get-Website ^| Where-Object { $_.PhysicalPath -like '*kariyer.bicen.com.tr*' } ^| Select-Object -First 1;" ^
  "if ($s) { $s.applicationPool }" 2^>nul') do set "HAVUZ=%%A"

echo      Uygulama havuzu: %HAVUZ%

"%SystemRoot%\System32\inetsrv\appcmd.exe" stop apppool /apppool.name:"%HAVUZ%" >nul 2>&1
if errorlevel 1 (
    echo      Uyari: havuz durdurulamadi. Kilit varsa islem sonlandirilacak.
)

timeout /t 4 /nobreak >nul

REM Kilit hala varsa calisan islem sonlandirilir
powershell -NoProfile -Command ^
  "$d = '%API_HEDEF%\BicenKariyer.API.dll';" ^
  "if (Test-Path $d) {" ^
  "  try { $f=[IO.File]::Open($d,'Open','Write'); $f.Close() }" ^
  "  catch {" ^
  "    Write-Host '     Dosya kilitli, IIS islemi sonlandiriliyor...';" ^
  "    Get-Process w3wp -ErrorAction SilentlyContinue |" ^
  "      Stop-Process -Force -ErrorAction SilentlyContinue;" ^
  "    Start-Sleep -Seconds 2 } }" >nul 2>&1

echo      Tamam.
echo.

REM ==========================================================================
echo [2/8] API derleniyor ve yayinlaniyor...
REM ==========================================================================
REM Sunucudaki appsettings.json yedeklenir: dotnet publish projedeki
REM dosyayi uzerine yazar ve gercek sifreler, portlar, anahtarlar silinir.
set AYAR_DOSYA=%API_HEDEF%\appsettings.json
set AYAR_YEDEK=%TEMP%\bicen-appsettings-yedek.json
if exist "%AYAR_DOSYA%" (
    copy /Y "%AYAR_DOSYA%" "%AYAR_YEDEK%" >nul
    echo      Sunucudaki appsettings.json yedeklendi.
)

REM Once gecici klasore yayinlanir, sonra kopyalanir.
REM Dogrudan hedefe yayinlarken web.config kilitliyse (IIS yapilandirma
REM izleyicisi ya da virus tarayicisi tutabiliyor) butun yayin duruyordu.
REM robocopy kilitli dosyada birkac kez bekleyip yeniden deniyor.
set "GECICI=%TEMP%\bicen-kariyer-yayin"
if exist "%GECICI%" rmdir /S /Q "%GECICI%"

pushd BicenKariyer.API
dotnet publish -c Release -o "%GECICI%" --nologo
if errorlevel 1 (
    echo.
    echo [HATA] API derlenemedi. Yukaridaki hata mesajini kontrol ediniz.
    "%SystemRoot%\System32\inetsrv\appcmd.exe" start apppool /apppool.name:"%HAVUZ%" >nul 2>&1
    del "%API_HEDEF%\app_offline.htm" >nul 2>&1
    popd
    pause
    exit /b 1
)
popd

REM appsettings.json kopyalanmaz: sunucudaki dosya (gercek sifreler) korunur.
REM /R:6 /W:5 = kilitli dosyada 6 kez, 5 saniye arayla dener.
robocopy "%GECICI%" "%API_HEDEF%" /E /R:6 /W:5 /XF appsettings.json app_offline.htm /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
    echo      Ilk kopyalama tamamlanamadi, IIS islemi sonlandirilip yeniden deneniyor...
    powershell -NoProfile -Command "Get-Process w3wp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3" >nul 2>&1
    robocopy "%GECICI%" "%API_HEDEF%" /E /R:6 /W:5 /XF appsettings.json app_offline.htm /NFL /NDL /NJH /NJS /NP >nul
)
if errorlevel 8 (
    echo.
    echo [HATA] Dosyalar kopyalanamadi: hedefte kilitli dosya var.
    echo        IIS Yoneticisi'nden "%HAVUZ%" havuzunu elle durdurup betigi tekrar calistiriniz.
    "%SystemRoot%\System32\inetsrv\appcmd.exe" start apppool /apppool.name:"%HAVUZ%" >nul 2>&1
    del "%API_HEDEF%\app_offline.htm" >nul 2>&1
    pause
    exit /b 1
)
REM Ilk kurulumda sunucuda appsettings.json yoksa projedeki kullanilir
if not exist "%AYAR_DOSYA%" copy /Y "%GECICI%\appsettings.json" "%AYAR_DOSYA%" >nul
rmdir /S /Q "%GECICI%" >nul 2>&1
echo      Tamam.
echo.

REM Yedek geri yazilir; yoksa projedeki dosya kalir (ilk kurulum).
if exist "%AYAR_YEDEK%" (
    copy /Y "%AYAR_YEDEK%" "%AYAR_DOSYA%" >nul
    echo      Sunucudaki appsettings.json geri yazildi.
) else (
    echo      UYARI: appsettings yedegi yok, projedeki dosya kullanilacak.
)
echo.

REM ==========================================================================
echo [3/8] Logo kopyalaniyor...
REM ==========================================================================
if not exist "%API_HEDEF%\wwwroot" mkdir "%API_HEDEF%\wwwroot"

set LOGO_VAR=0
for %%d in (logo.png logo.jpg logo.jpeg logo.svg) do (
    if exist "BicenKariyer.API\wwwroot\%%d" (
        copy /Y "BicenKariyer.API\wwwroot\%%d" "%API_HEDEF%\wwwroot\" >nul
        echo      %%d kopyalandi.
        set LOGO_VAR=1
    )
)

if "!LOGO_VAR!"=="0" (
    if exist "%API_HEDEF%\wwwroot\logo.png" (
        echo      Kaynakta logo yok, hedefteki mevcut logo korundu.
    ) else (
        echo      [UYARI] Logo bulunamadi. Sayfada yazi tipi logo gorunecek.
        echo               Logoyu BicenKariyer.API\wwwroot\logo.png olarak koyunuz.
    )
)
echo.

REM ==========================================================================
echo [4/8] API yeniden baslatiliyor...
REM ==========================================================================
"%SystemRoot%\System32\inetsrv\appcmd.exe" start apppool /apppool.name:"%HAVUZ%" >nul 2>&1
del "%API_HEDEF%\app_offline.htm" >nul 2>&1
echo      Tamam.
echo.

REM ==========================================================================
echo [5/8] Aday sayfasi derleniyor...
REM ==========================================================================
pushd bicen-kariyer

REM API yolunu derlemeye bildir (satir sonunda bosluk olmamasi onemli)
> .env.production echo VITE_API_TABAN=/%API_ALT%

call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [HATA] npm install basarisiz.
    popd
    pause
    exit /b 1
)

call npm run build
if errorlevel 1 (
    echo [HATA] Derleme basarisiz.
    popd
    pause
    exit /b 1
)
popd
echo      Tamam.
echo.

REM ==========================================================================
echo [6/8] API yolu yaziliyor ve dosyalar kopyalaniyor...
REM ==========================================================================

REM index.html icindeki meta etiketine API yolunu yaz.
REM Boylece adres derlemeye bagli kalmaz, gerekirse elle de duzenlenebilir.
powershell -NoProfile -ExecutionPolicy Bypass -File "araclar\api-yolu-yaz.ps1" -Dosya "bicen-kariyer\dist\index.html" -Yol "/%API_ALT%"

findstr /c:"/%API_ALT%" "bicen-kariyer\dist\index.html" >nul
if errorlevel 1 (
    echo      [UYARI] API yolu index.html icine yazilamadi.
    echo               Kopyalama sonrasi su dosyayi elle duzenleyiniz:
    echo               %SITE_KOK%\index.html
    echo               Icindeki meta etiketi soyle olmalidir:
    echo               ^<meta name="api-taban" content="/%API_ALT%" /^>
) else (
    echo      API yolu yazildi: /%API_ALT%
)

xcopy "bicen-kariyer\dist\*" "%SITE_KOK%\" /E /Y /I >nul
if errorlevel 1 (
    echo [HATA] Dosyalar kopyalanamadi. Klasor izinlerini kontrol ediniz.
    pause
    exit /b 1
)
echo      Tamam.
echo.

REM ==========================================================================
echo [7/8] IK paneli derleniyor...
REM ==========================================================================
pushd bicen-kariyer-ik

call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [HATA] npm install basarisiz.
    popd
    pause
    exit /b 1
)

call npm run build
if errorlevel 1 (
    echo [HATA] Panel derlemesi basarisiz.
    popd
    pause
    exit /b 1
)
popd

powershell -NoProfile -ExecutionPolicy Bypass -File "araclar\api-yolu-yaz.ps1" -Dosya "bicen-kariyer-ik\dist\index.html" -Yol "/%API_ALT%"
echo      Tamam.
echo.

REM ==========================================================================
echo [8/8] IK paneli kopyalaniyor...
REM ==========================================================================
if not exist "%PANEL_HEDEF%" mkdir "%PANEL_HEDEF%"
xcopy "bicen-kariyer-ik\dist\*" "%PANEL_HEDEF%\" /E /Y /I >nul
if errorlevel 1 (
    echo [HATA] Panel dosyalari kopyalanamadi.
    pause
    exit /b 1
)

REM Arama motorlarina kapat
if exist "araclar\panel-web.config" (
    copy /Y "araclar\panel-web.config" "%PANEL_HEDEF%\web.config" >nul
)
echo      Tamam.
echo.

REM ==========================================================================
echo ==========================================================
echo   TEST
echo ==========================================================
timeout /t 4 /nobreak >nul

where curl.exe >nul 2>&1
if errorlevel 1 (
    echo   curl bulunamadi, testler atlandi. Tarayicidan kontrol ediniz.
) else (
    echo   API saglik kontrolu:
    curl.exe -s -k %ADRES%/%API_ALT%/api/Saglik
    echo.
    echo.
    for /f %%k in ('curl.exe -s -k -o nul -w "%%{http_code}" %ADRES%/%API_ALT%/api/Logo') do set LOGO_KOD=%%k
    echo   Logo yanit kodu   : !LOGO_KOD!   ^(200 olmali^)
    for /f %%k in ('curl.exe -s -k -o nul -w "%%{http_code}" %ADRES%/') do set SAYFA_KOD=%%k
    echo   Aday sayfasi kodu : !SAYFA_KOD!   ^(200 olmali^)
    for /f %%k in ('curl.exe -s -k -o nul -w "%%{http_code}" %ADRES%/%PANEL_ALT%/') do set PANEL_KOD=%%k
    echo   IK paneli kodu    : !PANEL_KOD!   ^(200 olmali^)

    curl.exe -s -k %ADRES%/ | findstr /c:"content=\"/%API_ALT%\"" >nul
    if errorlevel 1 (
        echo   API yolu          : YAZILMAMIS  ^<-- SORUN
    ) else (
        echo   API yolu          : /%API_ALT%   ^(dogru^)
    )
)

echo.
echo ==========================================================
echo   YAYINLAMA TAMAMLANDI
echo ==========================================================
echo   Aday sayfasi : %ADRES%
echo   IK paneli    : %ADRES%/%PANEL_ALT%
echo   API saglik   : %ADRES%/%API_ALT%/api/Saglik
echo.
echo   Tarayicida CTRL+F5 ile yenileyiniz.
echo ==========================================================
echo.
pause

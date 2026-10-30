@echo off
setlocal enabledelayedexpansion
title Bicen360 - Tani
color 0E
cd /d "%~dp0"

REM ==========================================================================
REM  Uygulama neden acilmiyor sorusuna tek seferde cevap toplar.
REM  Ciktinin tamamini kopyalayip gonderebilirsiniz.
REM ==========================================================================
set SITE_KOK=C:\inetpub\vhosts\bicen.com.tr\kariyer.bicen.com.tr
set SITE_ADI=kariyer.bicen.com.tr
set API_ALT=portalservis
set API_HEDEF=%SITE_KOK%\%API_ALT%
set APPCMD=%windir%\system32\inetsrv\appcmd.exe

echo ==========================================================
echo   BICEN360 - TANI
echo ==========================================================
echo.

echo --- 1. Calisma zamanlari ---------------------------------
dotnet --list-runtimes
echo.

echo --- 2. IIS uygulamalari ----------------------------------
%APPCMD% list app /site.name:"%SITE_ADI%"
echo.

echo --- 3. Uygulama havuzlari --------------------------------
%APPCMD% list apppool
echo.

echo --- 4. apiservis havuzu ayrintisi ------------------------
for /f "delims=" %%a in ('%APPCMD% list app /app.name:"%SITE_ADI%/apiservis" /text:applicationPool 2^>nul') do set H1=%%a
echo   apiservis havuzu     : !H1!
for /f "delims=" %%a in ('%APPCMD% list app /app.name:"%SITE_ADI%/%API_ALT%" /text:applicationPool 2^>nul') do set H2=%%a
echo   portalservis havuzu  : !H2!
echo.
if not "!H1!"=="" %APPCMD% list apppool /apppool.name:"!H1!" /text:*
echo.

echo --- 5. Hedef klasor --------------------------------------
if exist "%API_HEDEF%" (
    dir /b "%API_HEDEF%"
) else (
    echo   [YOK] %API_HEDEF%
)
echo.

echo --- 6. web.config ----------------------------------------
if exist "%API_HEDEF%\web.config" (
    type "%API_HEDEF%\web.config"
) else (
    echo   [YOK] web.config bulunamadi. Uygulama bu yuzden acilmaz.
)
echo.

echo --- 7. Acilis hatasi -------------------------------------
if exist "%API_HEDEF%\logs\baslangic-hatasi.txt" (
    type "%API_HEDEF%\logs\baslangic-hatasi.txt"
) else (
    echo   baslangic-hatasi.txt yok.
)
echo.

echo --- 8. stdout gunlukleri ---------------------------------
if exist "%API_HEDEF%\logs" (
    dir /b /o-d "%API_HEDEF%\logs"
    echo.
    for /f "delims=" %%f in ('dir /b /o-d "%API_HEDEF%\logs\stdout*" 2^>nul') do (
        echo   --- %%f ---
        type "%API_HEDEF%\logs\%%f"
        goto :gunlukBitti
    )
) else (
    echo   logs klasoru yok.
)
:gunlukBitti
echo.

echo --- 9. Uygulamayi elle calistirma -------------------------
REM En kesin bilgi bu: IIS'i devre disi birakip dogrudan calistirinca
REM acilis hatasi ekrana yazilir. 8 saniye sonra kapatilir.
if exist "%API_HEDEF%\Bicen360.API.dll" (
    pushd "%API_HEDEF%"
    start "b360-sinama" /min cmd /c "dotnet Bicen360.API.dll > "%TEMP%\b360-elle.txt" 2>&1"
    timeout /t 8 /nobreak >nul
    taskkill /FI "WINDOWTITLE eq b360-sinama*" /T /F >nul 2>&1
    popd
    if exist "%TEMP%\b360-elle.txt" type "%TEMP%\b360-elle.txt"
) else (
    echo   [YOK] Bicen360.API.dll bulunamadi: %API_HEDEF%
)
echo.

echo ==========================================================
echo   Bitti. Yukaridaki ciktinin TAMAMINI kopyalayiniz.
echo ==========================================================
pause

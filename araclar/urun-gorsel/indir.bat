@echo off
rem ===========================================================================
rem  Urun gorseli indirici
rem  barkodlar.txt dosyasindaki barkodlarin gorsellerini indirir.
rem  Node.js kullanir; Expo icin zaten kurulu.
rem ===========================================================================
chcp 65001 >nul
cd /d "%~dp0"

if not exist "barkodlar.txt" (
    echo.
    echo  barkodlar.txt bulunamadi.
    echo  barkod-cikar.sql sorgusunu calistirip sonucu bu klasore
    echo  barkodlar.txt adiyla kaydediniz.
    echo.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js bulunamadi. nodejs.org adresinden kurabilirsiniz.
    echo.
    pause
    exit /b 1
)

node gorsel-indir.js barkodlar.txt

echo.
pause

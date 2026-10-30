@echo off
title Bicen360 - Panel
color 0E
cd /d "%~dp0"

echo =========================================================
echo   BICEN360 - YONETIM PANELI
echo =========================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [HATA] Node.js bulunamadi.
    echo Lutfen https://nodejs.org adresinden Node.js 18 veya ustunu kurunuz.
    echo.
    pause
    exit /b 1
)

echo [1/2] Paketler kontrol ediliyor...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo [HATA] Paket kurulumu basarisiz oldu.
    pause
    exit /b 1
)
echo.

echo [2/2] Sunucu baslatiliyor...
echo.
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.*' } ^| Select-Object -First 1).IPAddress"') do set LANIP=%%i

echo   Bilgisayardan : http://localhost:5180
if defined LANIP echo   Telefondan    : http://%LANIP%:5180
echo.
echo   Giris: Kariyer panelindeki kullanici adiniz ve parolaniz.
echo.
echo   Kapatmak icin bu pencerede CTRL+C tuslarina basiniz.
echo =========================================================
echo.

call npm run dev
pause

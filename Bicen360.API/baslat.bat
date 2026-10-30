@echo off
title Bicen360 API
color 0B
cd /d "%~dp0"

echo =========================================================
echo   BICEN360 - API SUNUCUSU
echo =========================================================
echo.

where dotnet >nul 2>&1
if errorlevel 1 (
    echo [HATA] .NET 8 SDK bulunamadi.
    echo https://dotnet.microsoft.com/download/dotnet/8.0 adresinden kurunuz.
    echo.
    pause
    exit /b 1
)

echo   API adresi   : http://localhost:5181
echo.
echo   Port burada veriliyor; appsettings.json icinde Kestrel bolumu
echo   yok. Sunucuda ANCM kendi portunu atadigi icin orada tanimli
echo   olmamasi gerekiyor.
echo.
echo   Ilk calistirmada B360_ tablolari otomatik olusturulur.
echo   Kullanicilar Kariyer sistemiyle ortak (KRY_KULLANICILAR);
echo   bu panel icin ayrica kullanici acmaniza gerek yok.
echo =========================================================
echo.

dotnet run --urls http://0.0.0.0:5181
pause

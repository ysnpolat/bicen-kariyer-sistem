@echo off
title Bicen Kariyer API
color 0B
cd /d "%~dp0"

echo =========================================================
echo   BICEN KARIYER - API SUNUCUSU
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

echo   API adresi   : http://localhost:5177
echo   Swagger      : http://localhost:5177/swagger
echo.
echo   Ilk calistirmada veritabani ve tablolar otomatik olusturulur.
echo   Varsayilan yonetici: admin / Bicen2026!
echo =========================================================
echo.

dotnet run
pause

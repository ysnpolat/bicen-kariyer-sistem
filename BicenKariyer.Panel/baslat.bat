@echo off
title Bicen Kariyer - Servis Paneli
cd /d "%~dp0"

where dotnet >nul 2>&1
if errorlevel 1 (
    echo [HATA] .NET 8 SDK bulunamadi.
    echo https://dotnet.microsoft.com/download/dotnet/8.0 adresinden kurunuz.
    pause
    exit /b 1
)

echo Panel baslatiliyor...
dotnet run

@echo off
title Bicen Kariyer Sistemi
color 0A
cd /d "%~dp0"

echo =========================================================
echo   BICEN KARIYER SISTEMI - TUM SERVISLER
echo =========================================================
echo.
echo   Kariyer
echo     1) API              : http://localhost:5177
echo     2) IK Paneli        : http://localhost:5178
echo     3) Aday Sayfasi     : http://localhost:5179
echo.
echo   Bicen360
echo     4) API              : http://localhost:5181
echo     5) Panel            : http://localhost:5180
echo.
echo   Bes ayri pencere acilacaktir. Kapatmak icin pencereleri
echo   kapatiniz.
echo =========================================================
echo.

start "Bicen Kariyer API" cmd /k "cd /d "%~dp0BicenKariyer.API" && baslat.bat"
timeout /t 6 /nobreak >nul

start "Bicen Kariyer - IK Paneli" cmd /k "cd /d "%~dp0bicen-kariyer-ik" && baslat.bat"
timeout /t 3 /nobreak >nul

start "Bicen Kariyer - Aday Sayfasi" cmd /k "cd /d "%~dp0bicen-kariyer" && baslat.bat"
timeout /t 3 /nobreak >nul

start "Bicen360 API" cmd /k "cd /d "%~dp0Bicen360.API" && baslat.bat"
timeout /t 6 /nobreak >nul

start "Bicen360 - Panel" cmd /k "cd /d "%~dp0bicen360-panel" && baslat.bat"

echo Tum servisler baslatildi.
timeout /t 5 /nobreak >nul

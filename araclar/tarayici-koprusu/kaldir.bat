@echo off
title Bicen Tarayici Koprusu - Kaldirma
taskkill /im BicenTarayici.exe /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v BicenTarayici /f >nul 2>&1
timeout /t 1 /nobreak >nul
rmdir /s /q "%LOCALAPPDATA%\BicenTarayici" 2>nul
echo Bicen Tarayici Koprusu kaldirildi.
pause

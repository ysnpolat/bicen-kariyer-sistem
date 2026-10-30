@echo off
rem Uc barkodla hizli deneme: servis erisimini dogrular
chcp 65001 >nul
cd /d "%~dp0"
node gorsel-indir.js deneme.txt deneme-gorsel
echo.
pause

@echo off
rem ===========================================================================
rem  Dokum ile toplu gorsel indirme
rem
rem  Dokumleri bir kez indirir, sonra barkod listesini yerelde eslestirir.
rem  Servisin istek siniri devreye girmez.
rem ===========================================================================
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo  Node.js bulunamadi. nodejs.org adresinden kurabilirsiniz.
    pause
    exit /b 1
)

if not exist "barkodlar.txt" (
    echo.
    echo  barkodlar.txt bulunamadi.
    echo  barkod-cikar.sql sorgusunu calistirip sonucu bu klasore
    echo  barkodlar.txt adiyla kaydediniz.
    echo.
    pause
    exit /b 1
)

echo.
echo  [1/2] Dokumler indiriliyor (yaklasik 1-1,5 GB, bir kez)
echo.
node dokum-indir.js
if errorlevel 1 goto son

echo.
echo  [2/2] Barkodlar eslestiriliyor ve gorseller indiriliyor
echo.
node dokum-eslestir.js barkodlar.txt

:son
echo.
pause

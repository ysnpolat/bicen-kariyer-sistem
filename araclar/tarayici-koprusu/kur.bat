@echo off
setlocal
title Bicen Tarayici Koprusu - Kurulum
cd /d "%~dp0"

REM ==========================================================================
REM  Bicen Tarayici Koprusu kurulumu
REM  - Yonetici yetkisi GEREKMEZ; yalnizca bu Windows kullanicisi icin kurulur.
REM  - Windows'ta hazir gelen .NET Framework 4 derleyicisiyle BicenTarayici.cs
REM    dosyasindan BicenTarayici.exe uretilir (internet gerekmez).
REM  - Oturum acilisinda kendiliginden calisir (gorunmez, pencere acmaz).
REM ==========================================================================

set HEDEF=%LOCALAPPDATA%\BicenTarayici
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe

if not exist "%CSC%" (
    echo [HATA] .NET Framework 4 derleyicisi bulunamadi.
    echo        Windows Ozellikleri'nden .NET Framework 4.8'i aciniz.
    pause
    exit /b 1
)

if not exist "BicenTarayici.cs" (
    echo [HATA] BicenTarayici.cs bu klasorde yok. Zip'in tamamini aciniz.
    pause
    exit /b 1
)

echo Eski surum kapatiliyor...
taskkill /im BicenTarayici.exe /f >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "%HEDEF%" mkdir "%HEDEF%"

echo Derleniyor...
"%CSC%" /nologo /target:winexe /optimize+ /codepage:65001 /out:"%HEDEF%\BicenTarayici.exe" /r:Microsoft.CSharp.dll /r:System.Core.dll /r:System.Xml.dll BicenTarayici.cs
if errorlevel 1 (
    echo [HATA] Derleme basarisiz. Yukaridaki hatayi IT birimine iletiniz.
    pause
    exit /b 1
)

REM Izinli adresler: daha once duzenlendiyse korunur
if not exist "%HEDEF%\izinli-adresler.txt" copy /y "izinli-adresler.txt" "%HEDEF%\izinli-adresler.txt" >nul

REM Ag tarayicisi (surucusuz, eSCL): cok fonksiyonlu yazicinin IP adresi
echo.
echo Cok fonksiyonlu yazici AGA bagliysa IP adresini yazin (orn. 192.168.1.50).
echo Surucu gerekmez. USB ile bagliysa ya da bilmiyorsaniz bos birakip Enter'a basin.
set AGIP=
set /p AGIP=Yazici IP adresi: 
if not "%AGIP%"=="" (
    findstr /x /c:"%AGIP%" "%HEDEF%\ag-tarayicilar.txt" >nul 2>&1 || echo %AGIP%>>"%HEDEF%\ag-tarayicilar.txt"
)

echo Oturum acilisina ekleniyor...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v BicenTarayici /t REG_SZ /d "\"%HEDEF%\BicenTarayici.exe\"" /f >nul

echo Baslatiliyor...
start "" "%HEDEF%\BicenTarayici.exe"
timeout /t 2 /nobreak >nul

echo.
echo Bu bilgisayardaki tarayicilar:
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c = Invoke-RestMethod -Uri 'http://127.0.0.1:47115/cihazlar' -TimeoutSec 40; if ($c.cihazlar.Count -eq 0) { '  (tarayici bulunamadi - surucusu kurulu ve cihaz acik olmali)' } else { $c.cihazlar | ForEach-Object { '  - ' + $_.ad + $(if ($_.besleyici) { '  (besleyici var)' } else { '' }) } } } catch { '  Kopru yanit vermedi: ' + $_.Exception.Message }"

echo.
echo ==========================================================
echo   Kurulum tamam. Paneli yenileyip evrak yukleme alanindaki
echo   "Tara" dugmesini kullanabilirsiniz.
echo   Chrome/Edge ilk taramada "yerel agdaki cihazlara erisim"
echo   izni sorarsa "Izin ver" deyiniz.
echo ==========================================================
pause

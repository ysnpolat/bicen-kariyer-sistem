@echo off
chcp 65001 >nul
title Rakip web fiyatlari
cd /d "%~dp0"

rem ---------------------------------------------------------------------
rem  Rakip web fiyatlari: siteler.txt'deki sayfalarin urun adi ve satis
rem  fiyatlarini Excel'e yazar (sonuclar klasoru).
rem  Ilk calistirmada gerekli bilesenler kurulur (bir kez, birkac dakika).
rem ---------------------------------------------------------------------

rem Windows'taki "python" kisayolu (Microsoft Store yonlendirmesi) gercek
rem Python degil: her aday gercekten calistirilarak deneniyor.
set "PY="
call :dene py -3
if not defined PY call :dene python
if not defined PY call :dene "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PY call :dene "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY call :dene "%ProgramFiles%\Python313\python.exe"
if not defined PY call :dene "%ProgramFiles%\Python312\python.exe"

if not defined PY (
  echo Bu bilgisayarda Python kurulu degil.
  echo.
  choice /c EH /m "Simdi kurulsun mu? (E: evet, H: hayir)"
  if errorlevel 2 goto :elle
  echo Python kuruluyor, 1-2 dakika surebilir...
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  call :dene "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
)

if not defined PY goto :elle

if not exist ".kurulum-tamam" (
  echo Ilk calistirma: bilesenler kuruluyor...
  %PY% -m pip install --disable-pip-version-check --upgrade playwright openpyxl || goto :hata
  %PY% -m playwright install chromium || goto :hata
  echo ok> ".kurulum-tamam"
)

%PY% fiyat_cek.py %*
echo.
pause
exit /b 0

:dene
%* -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>nul && set "PY=%*"
exit /b 0

:elle
echo.
echo Python kurulamadi. Elle kurmak icin:
echo   https://www.python.org/downloads/  adresinden indirip kurun;
echo   kurulumun ilk ekraninda "Add python.exe to PATH" kutusunu isaretleyin.
echo Sonra bu dosyayi yeniden calistirin.
pause
exit /b 1

:hata
echo.
echo Bilesenler kurulamadi. Internet baglantisini kontrol edip tekrar deneyin.
pause
exit /b 1

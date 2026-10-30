@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Biçen360 mobil derleme

echo ==============================================================
echo   Biçen360 mobil uygulama derlemesi (Expo EAS, bulutta)
echo ==============================================================

for /f "usebackq delims=" %%v in (`node -p "require('./app.json').expo.version"`) do set SURUM=%%v
echo Sürüm (app.json): !SURUM!
echo Yapı numarası EAS tarafından kendiliğinden artırılır.
echo.

rem --- Gerekli dosyalar ------------------------------------------------
if not exist "google-services.json" (
  echo [HATA] google-services.json bulunamadı. Android bildirimleri için gerekli.
  echo        Firebase konsolundan indirip bu klasöre koyun, sonra yeniden çalıştırın.
  pause & exit /b 1
)

rem --- EAS CLI ve oturum ------------------------------------------------
where eas >nul 2>nul
if errorlevel 1 (
  echo EAS CLI kuruluyor...
  call npm install -g eas-cli || (echo [HATA] eas-cli kurulamadı. & pause & exit /b 1)
)
call eas whoami >nul 2>nul
if errorlevel 1 (
  echo Expo hesabına giriş yapın:
  call eas login || (echo [HATA] Giriş yapılamadı. & pause & exit /b 1)
)
for /f "delims=" %%u in ('eas whoami 2^>nul') do (set HESAP=%%u & goto :hesapTamam)
:hesapTamam
echo Expo hesabı: !HESAP!
echo.

rem --- Paketler ----------------------------------------------------------
echo Paketler kuruluyor (npm install)...
call npm install --no-audit --no-fund || (echo [HATA] npm install başarısız. & pause & exit /b 1)
echo.

rem --- Seçim ------------------------------------------------------------
echo Ne yapılsın?
echo   1. iOS + Android mağaza sürümü (iOS App Store Connect'e, Android Play'e gönderilir)
echo   2. Yalnız iOS mağaza sürümü (App Store Connect / TestFlight'a gönderilir)
echo   3. Yalnız Android mağaza sürümü (.aab)
echo   4. Android deneme APK (telefona doğrudan kurulur, mağazaya gitmez)
echo.
choice /c 1234 /n /m "Seçiminiz [1-4]: "
set SECIM=%errorlevel%
echo.

set ANDROID_GONDER=--auto-submit
if not exist "play-anahtar.json" (
  set ANDROID_GONDER=
  if !SECIM! LEQ 3 echo [BİLGİ] play-anahtar.json yok: Android derlenecek ama Play'e otomatik gönderilmeyecek; .aab dosyasını Play Console'a elle yükleyin.
)

if !SECIM!==1 (
  call eas build --platform ios --profile production --auto-submit --no-wait || goto :hata
  call eas build --platform android --profile production !ANDROID_GONDER! --no-wait || goto :hata
)
if !SECIM!==2 call eas build --platform ios --profile production --auto-submit || goto :hata
if !SECIM!==3 call eas build --platform android --profile production !ANDROID_GONDER! || goto :hata
if !SECIM!==4 call eas build --platform android --profile denemeAndroid || goto :hata

echo.
echo ==============================================================
echo   Derleme Expo sunucularında başladı. İlerlemeyi şuradan izleyin:
echo   https://expo.dev  ^(Projects ^> bicen360 ^> Builds^)
echo   iOS: yükleme bitince 10-15 dakika içinde TestFlight'ta görünür.
echo ==============================================================
pause
exit /b 0

:hata
echo.
echo [HATA] Derleme başlatılamadı. Yukarıdaki iletiyi kontrol edin.
pause
exit /b 1

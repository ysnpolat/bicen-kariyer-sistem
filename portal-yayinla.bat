@echo off
setlocal enabledelayedexpansion
title Bicen360 - Sunucu Yayinlama
color 0A
cd /d "%~dp0"

REM ==========================================================================
REM  DEPODAN GUNCELLE
REM  Bu klasor bir git deposuysa once GitHub'daki son surum cekilir.
REM  Zip kopyalama yerine: GitHub'a push edilen kod -> git pull -> derle.
REM  Depo degilse (eski zip yontemi) bu adim atlanir.
REM ==========================================================================
if exist ".git" (
    where git >nul 2>&1
    if errorlevel 1 (
        echo [HATA] Bu klasor bir git deposu ama git kurulu degil.
        echo        https://git-scm.com adresinden Git for Windows kurunuz.
        pause
        exit /b 1
    )
    echo [GIT] GitHub'dan son surum cekiliyor...
    git fetch origin main
    if errorlevel 1 (
        echo [HATA] GitHub'a ulasilamadi ^(git fetch^). Internet ya da giris sorunu.
        pause
        exit /b 1
    )
    git merge --ff-only origin/main
    if errorlevel 1 (
        echo.
        echo [HATA] Yerel degisiklik var, depo ile birlestirilemedi.
        echo        Sunucudaki dosyalari elle degistirdiyseniz once
        echo        "git status" ile bakip "git checkout -- ." ile geri aliniz,
        echo        ya da degisikligi depoya aldiriniz.
        pause
        exit /b 1
    )
    for /f "tokens=*" %%v in ('git log -1 --pretty^=format:"%%h  %%s  ^(%%ci^)"') do echo      Surum: %%v
    echo      Tamam.
    echo.
)


REM ==========================================================================
REM  AYARLAR
REM ==========================================================================
set SITE_KOK=C:\inetpub\vhosts\bicen.com.tr\kariyer.bicen.com.tr
set SITE_ADI=kariyer.bicen.com.tr
set API_ALT=portalservis
set PANEL_ALT=portal
REM ==========================================================================

set API_HEDEF=%SITE_KOK%\%API_ALT%
set PANEL_HEDEF=%SITE_KOK%\%PANEL_ALT%
set ADRES=https://kariyer.bicen.com.tr
set APPCMD=%windir%\system32\inetsrv\appcmd.exe

echo ==========================================================
echo   BICEN360 - SUNUCU YAYINLAMA
echo ==========================================================
echo   Site kok klasoru : %SITE_KOK%
echo   API yolu         : /%API_ALT%
echo   Panel yolu       : /%PANEL_ALT%
echo.
echo   IK paneli (/panel) ve Kariyer API (/apiservis) bu betikten
echo   etkilenmez; onlar icin sunucu-yayinla.bat kullaniniz.
echo ==========================================================
echo.

REM ---------------------------------------------------- yonetici yetkisi
REM appcmd ve icacls yonetici gerektiriyor. Yetkisiz calistirilirsa
REM dosyalar kopyalanir ama IIS tanimi yapilamaz ve uygulama 500 verir.
net session >nul 2>&1
if errorlevel 1 (
    echo [HATA] Bu betik yonetici olarak calistirilmalidir.
    echo        Sag tik - "Yonetici olarak calistir".
    echo.
    pause
    exit /b 1
)

REM ---------------------------------------------------- gereksinim kontrolu
where dotnet >nul 2>&1
if errorlevel 1 (
    echo [HATA] dotnet bulunamadi. .NET 8 SDK kurulu olmalidir.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [HATA] npm bulunamadi. Node.js 18+ kurulu olmalidir.
    pause
    exit /b 1
)

if not exist "%SITE_KOK%" (
    echo [HATA] Site kok klasoru bulunamadi:
    echo        %SITE_KOK%
    echo.
    echo Plesk - Alan adi - Barindirma Ayarlari ekranindaki "Belge kok"
    echo degerini bu dosyanin basindaki SITE_KOK satirina yaziniz.
    pause
    exit /b 1
)

if not exist "Bicen360.API\Bicen360.API.csproj" (
    echo [HATA] Bicen360.API klasoru bulunamadi.
    echo Bu dosyayi paketin kok klasorunden calistiriniz.
    pause
    exit /b 1
)

REM ---------------------------------------------------- site adi dogrulama
set SITE_VAR=0
for /f "delims=" %%a in ('%APPCMD% list site /name:"%SITE_ADI%" 2^>nul ^| findstr /B /C:"SITE "') do set SITE_VAR=1

if "!SITE_VAR!"=="0" (
    echo [UYARI] "%SITE_ADI%" adinda bir IIS sitesi bulunamadi.
    echo.
    echo         Mevcut siteler:
    %APPCMD% list site /text:name
    echo.
    echo         Dogru site adini bu dosyanin basindaki SITE_ADI satirina
    echo         yazabilirsiniz. Devam ederseniz dosyalar kopyalanir ama
    echo         IIS uygulama tanimi yapilamayabilir.
    echo.
    choice /C EH /N /M "Yayina devam edilsin mi? (E/H): "
    if errorlevel 2 (
        echo Iptal edildi.
        pause
        exit /b 1
    )
    echo.
)

REM ---------------------------------------------------- calisma zamani
REM IIS'te barindirmak icin SDK yetmez, ASP.NET Core Hosting Bundle gerekir.
REM Eksikse uygulama hic ayaga kalkmaz ve IIS sebebi soylemeyen bir 500
REM dondurur.
REM
REM Bu bir UYARI, engel degil: "dotnet --list-runtimes" ciktisi makineden
REM makineye degisiyor ve yanlis okuma yuzunden yayini durdurmak, sorunu
REM cozmekten daha cok engel oldu. Kurulu olmasaydi /apiservis de
REM calismazdi.
dotnet --list-runtimes 2>nul | findstr /C:"Microsoft.AspNetCore.App 8." >nul
if errorlevel 1 (
    echo [UYARI] ASP.NET Core 8 calisma zamani listede gorunmedi.
    echo.
    echo         Sunucudaki calisma zamanlari:
    dotnet --list-runtimes
    echo.
    echo         Kariyer API ^(/apiservis^) calisiyorsa bu bir okuma
    echo         sorunudur, yayina devam edebilirsiniz. Calismiyorsa
    echo         "ASP.NET Core 8 Hosting Bundle" kurunuz:
    echo         https://dotnet.microsoft.com/download/dotnet/8.0
    echo.
    choice /C EH /N /M "Yayina devam edilsin mi? (E/H): "
    if errorlevel 2 (
        echo Iptal edildi.
        pause
        exit /b 1
    )
    echo.
)

REM ==========================================================================
echo [1/7] Sunucudaki ayar dosyasi yedekleniyor...
REM ==========================================================================
REM Ayarlar sunucuda duzenleniyor; derleme ciktisi uzerine yazmasin.
set AYAR_YEDEK=%TEMP%\bicen360-appsettings-yedek.json
if exist "%API_HEDEF%\appsettings.json" (
    copy /Y "%API_HEDEF%\appsettings.json" "%AYAR_YEDEK%" >nul
    echo      Yedeklendi.
) else (
    if exist "%AYAR_YEDEK%" del /Q "%AYAR_YEDEK%"
    echo      Ilk yayin; yedeklenecek ayar yok.
)
echo.

REM ==========================================================================
echo [2/7] API derleniyor...
REM ==========================================================================
dotnet publish "Bicen360.API\Bicen360.API.csproj" -c Release -o "%TEMP%\bicen360-yayin" >nul
if errorlevel 1 (
    echo [HATA] API derlemesi basarisiz.
    pause
    exit /b 1
)
echo      Tamam.
echo.

REM ==========================================================================
echo [3/7] Klasorler hazirlaniyor...
REM ==========================================================================
if not exist "%API_HEDEF%" mkdir "%API_HEDEF%"
REM logs  : uygulama acilista cokerse sebebi buraya yazilir
REM ariza : arizaya eklenen fotograflar
if not exist "%API_HEDEF%\logs" mkdir "%API_HEDEF%\logs"
if not exist "%API_HEDEF%\ariza" mkdir "%API_HEDEF%\ariza"
if not exist "%PANEL_HEDEF%" mkdir "%PANEL_HEDEF%"
echo      Tamam.
echo.

REM ==========================================================================
echo [4/7] IIS uygulamasi tanimlaniyor...
REM ==========================================================================
REM Bu adim atlanirsa /portalservis altindaki dll'ler statik dosya gibi
REM ele alinir ve her istek 500 doner. Ilk yayinda en cok atlanan adim bu.

REM --------------------------------------------------------------------
REM Uygulama havuzu: KENDI HAVUZU.
REM
REM /apiservis in-process barindiriliyor ve ASP.NET Core'da in-process bir
REM uygulamanin havuzunda BASKA UYGULAMA OLAMAZ. Ikisini ayni havuza
REM koymak /apiservis'i bozuyor.
REM
REM Bu yuzden portalservis kendi havuzunda calisir. Yeni havuzun
REM ApplicationPoolIdentity kimliginin klasoru okuyabilmesi icin izinler
REM asagida aciktan veriliyor; Plesk vhost klasorlerinde ACL'ler dar ve
REM bu adim atlanirsa uygulama hic baslamaz.
REM --------------------------------------------------------------------

set HAVUZ=bicen360

REM Onceki surumler ortak havuzun calisma zamani surumunu degistiriyordu.
REM Plesk'in alan adi havuzu v4.0 olmali; geri alinir.
set ORTAK=
for /f "delims=" %%a in ('%APPCMD% list app /app.name:"%SITE_ADI%/apiservis" /text:applicationPool 2^>nul ^| findstr /V /B /C:"ERROR"') do set ORTAK=%%a

if not "!ORTAK!"=="" (
    echo      Ortak havuz eski haline getiriliyor: !ORTAK!
    %APPCMD% set apppool /apppool.name:"!ORTAK!" /managedRuntimeVersion:"v4.0" >nul 2>&1
)

set HAVUZ_VAR=0
for /f "delims=" %%a in ('%APPCMD% list apppool /apppool.name:"%HAVUZ%" 2^>nul ^| findstr /B /C:"APPPOOL "') do set HAVUZ_VAR=1

if "!HAVUZ_VAR!"=="0" (
    echo      Uygulama havuzu olusturuluyor: %HAVUZ%
    REM managedRuntimeVersion bos = "No Managed Code": ASP.NET Core kendi
    REM calisma zamanini tasiyor, IIS ayrica bir CLR yuklememeli.
    %APPCMD% add apppool /name:"%HAVUZ%" /managedRuntimeVersion:"" /managedPipelineMode:"Integrated"
) else (
    echo      Uygulama havuzu var: %HAVUZ%
    %APPCMD% set apppool /apppool.name:"%HAVUZ%" /managedRuntimeVersion:"" >nul 2>&1
)

REM 32 bit havuzda x64 calisma zamani yuklenemez.
%APPCMD% set apppool /apppool.name:"%HAVUZ%" /enable32BitAppOnWin64:false >nul 2>&1

REM Havuz kimliginin klasoru okuyabilmesi sart. Okuma izni yoksa ANCM
REM dll'i acamaz ve govdesi olmayan bir 500 doner.
REM IIS bir uygulamayi acarken yapilandirma zincirini KOKTEN asagi okur.
REM Havuz kimligi site kokundeki web.config'i okuyamazsa istek uygulamaya
REM hic ulasmadan 500.19 (0x80070005) ile duser. Bu yuzden yalnizca
REM portalservis klasoru degil, ustundeki klasorler de aciliyor.
REM Ust klasorlere yalnizca gecis/okuma izni veriliyor, yazma yok.
echo      Klasor izinleri veriliyor...
icacls "%SITE_KOK%" /grant "IIS AppPool\%HAVUZ%":(OI)(CI)RX >nul 2>&1
for %%u in ("%SITE_KOK%\..") do icacls "%%~fu" /grant "IIS AppPool\%HAVUZ%":(RX) >nul 2>&1
for %%u in ("%SITE_KOK%\..\..") do icacls "%%~fu" /grant "IIS AppPool\%HAVUZ%":(RX) >nul 2>&1
icacls "%API_HEDEF%" /grant "IIS AppPool\%HAVUZ%":(OI)(CI)RX >nul 2>&1
icacls "%API_HEDEF%\logs"  /grant "IIS AppPool\%HAVUZ%":(OI)(CI)M >nul 2>&1
icacls "%API_HEDEF%\ariza" /grant "IIS AppPool\%HAVUZ%":(OI)(CI)M >nul 2>&1

set UYG_VAR=0
for /f "delims=" %%a in ('%APPCMD% list app /app.name:"%SITE_ADI%/%API_ALT%" 2^>nul ^| findstr /B /C:"APP "') do set UYG_VAR=1

if "!UYG_VAR!"=="0" (
    echo      Uygulama olusturuluyor: /%API_ALT%
    %APPCMD% add app /site.name:"%SITE_ADI%" /path:"/%API_ALT%" /physicalPath:"%API_HEDEF%" /applicationPool:"%HAVUZ%"

    set UYG_ONAY=0
    for /f "delims=" %%a in ('%APPCMD% list app /app.name:"%SITE_ADI%/%API_ALT%" 2^>nul ^| findstr /B /C:"APP "') do set UYG_ONAY=1

    if "!UYG_ONAY!"=="0" (
        echo.
        echo      [UYARI] IIS uygulamasi olusturulamadi.
        echo              IIS Yoneticisi'nden %API_ALT% klasorune sag tik -
        echo              "Convert to Application" yapip havuzu %HAVUZ%
        echo              olarak seciniz.
        echo.
    ) else (
        echo      Olusturuldu ve dogrulandi.
    )
) else (
    echo      Uygulama var: /%API_ALT%   ^(havuzu %HAVUZ% olarak ayarlaniyor^)
    %APPCMD% set app "%SITE_ADI%/%API_ALT%" /applicationPool:"%HAVUZ%"
)

REM Havuz kimligi Plesk'te ozel bir hesap olabilir; iki bicim de denenir.
icacls "%API_HEDEF%\logs"  /grant "IIS AppPool\!HAVUZ!":(OI)(CI)M >nul 2>&1
icacls "%API_HEDEF%\ariza" /grant "IIS AppPool\!HAVUZ!":(OI)(CI)M >nul 2>&1
icacls "%API_HEDEF%\logs"  /grant "IIS_IUSRS":(OI)(CI)M >nul 2>&1
icacls "%API_HEDEF%\ariza" /grant "IIS_IUSRS":(OI)(CI)M >nul 2>&1
echo      Tamam.
echo.

REM ==========================================================================
echo [5/7] API kopyalaniyor...
REM ==========================================================================
REM Havuz artik portalservis'e ozel; durdurmak /apiservis'i etkilemiyor.
echo      Uygulama havuzu durduruluyor: %HAVUZ%
%APPCMD% stop apppool /apppool.name:"%HAVUZ%" >nul 2>&1
echo Bakim > "%API_HEDEF%\app_offline.htm"

REM Elle "dotnet Bicen360.API.dll" ile baslatilmis bir surec varsa dosyalari
REM kilitli tutar ve kopyalama "Sharing violation" verir. app_offline.htm
REM onu kapatmaz; ayrica sonlandirilmasi gerekiyor.
for /f "tokens=2 delims=," %%p in ('tasklist /FI "IMAGENAME eq dotnet.exe" /FO CSV /NH 2^>nul') do (
    wmic process where "ProcessId=%%~p" get CommandLine 2>nul | findstr /I /C:"Bicen360.API.dll" >nul && (
        echo      Kilitleyen dotnet sureci kapatiliyor: %%~p
        taskkill /PID %%~p /F >nul 2>&1
    )
)

timeout /t 4 /nobreak >nul

xcopy "%TEMP%\bicen360-yayin\*" "%API_HEDEF%\" /E /Y /I >nul
if errorlevel 1 (
    echo      Dosyalar kilitli; 6 saniye beklenip tekrar denenecek...
    timeout /t 6 /nobreak >nul
    xcopy "%TEMP%\bicen360-yayin\*" "%API_HEDEF%\" /E /Y /I >nul
)

if errorlevel 1 (
    echo [HATA] API dosyalari kopyalanamadi ^(Sharing violation^).
    echo.
    echo        Acik bir komut isteminde "dotnet Bicen360.API.dll"
    echo        calisiyorsa CTRL+C ile kapatip tekrar deneyiniz.
    if exist "%API_HEDEF%\app_offline.htm" del /Q "%API_HEDEF%\app_offline.htm"
    pause
    exit /b 1
)

REM Sunucudaki ayarlar geri yazilir
if exist "%AYAR_YEDEK%" (
    copy /Y "%AYAR_YEDEK%" "%API_HEDEF%\appsettings.json" >nul
    echo      Sunucudaki ayarlar korundu.

    REM Eski ayar dosyasinda Kestrel bolumu kalmis olabilir. Out-of-process
    REM barindirmada uygulama ANCM'nin verdigi portu dinlemeli; kendi
    REM portunu dinlerse vekil baglanamaz ve 502 doner.
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "$y='%API_HEDEF%\appsettings.json'; $j=Get-Content $y -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.PSObject.Properties.Name -contains 'Kestrel') { $j.PSObject.Properties.Remove('Kestrel'); $j | ConvertTo-Json -Depth 20 | Set-Content $y -Encoding UTF8; Write-Host '     Kestrel bolumu temizlendi.' }"
)

if exist "%API_HEDEF%\app_offline.htm" del /Q "%API_HEDEF%\app_offline.htm"
echo      Uygulama havuzu baslatiliyor: %HAVUZ%
%APPCMD% start apppool /apppool.name:"%HAVUZ%"
echo      Tamam.
echo.

REM ==========================================================================
echo [6/7] Panel derleniyor...
REM ==========================================================================
pushd bicen360-panel

call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [HATA] npm install basarisiz.
    popd
    pause
    exit /b 1
)

call npm run build
if errorlevel 1 (
    echo [HATA] Panel derlemesi basarisiz.
    popd
    pause
    exit /b 1
)
popd

powershell -NoProfile -ExecutionPolicy Bypass -File "araclar\api-yolu-yaz.ps1" -Dosya "bicen360-panel\dist\index.html" -Yol "/%API_ALT%"
echo      Tamam.
echo.

REM ==========================================================================
echo [7/7] Panel kopyalaniyor...
REM ==========================================================================
xcopy "bicen360-panel\dist\*" "%PANEL_HEDEF%\" /E /Y /I >nul
if errorlevel 1 (
    echo [HATA] Panel dosyalari kopyalanamadi.
    pause
    exit /b 1
)

REM Arama motorlarina kapat; IK paneliyle ayni yapilandirma
if exist "araclar\panel-web.config" (
    copy /Y "araclar\panel-web.config" "%PANEL_HEDEF%\web.config" >nul
)
echo      Tamam.
echo.

REM ==========================================================================
echo   web.config denetimi...
powershell -NoProfile -Command ^
  "try { [xml](Get-Content '%API_HEDEF%\web.config' -Raw -Encoding UTF8) | Out-Null; Write-Host '     XML gecerli.' } catch { Write-Host '     [HATA] web.config gecersiz XML:'; Write-Host ('     ' + $_.Exception.Message); exit 1 }"

findstr /C:"processPath" "%API_HEDEF%\web.config" >nul 2>&1
if errorlevel 1 (
    echo      [UYARI] Yayinlanan web.config icinde processPath yok.
    echo              Uygulama bu hâliyle baslatilamaz.
) else (
    echo      processPath var.
)
echo.

echo ==========================================================
echo   SINAMA
echo ==========================================================
timeout /t 5 /nobreak >nul

where curl.exe >nul 2>&1
if errorlevel 1 (
    echo   curl bulunamadi. Tarayicidan kontrol ediniz:
    echo   %ADRES%/%API_ALT%/api/Durum
) else (
    for /f %%k in ('curl.exe -s -o nul -w "%%{http_code}" "%ADRES%/%API_ALT%/api/Durum"') do set KOD=%%k

    echo   API durum kodu : !KOD!   ^(200 olmali^)

    if "!KOD!"=="200" (
        echo.
        echo   Veritabani ve tablo durumu:
        curl.exe -s "%ADRES%/%API_ALT%/api/Durum"
        echo.
    ) else (
        echo.
        echo   [SORUN] API yanit vermiyor. Sunucunun yaniti:
        echo   ----------------------------------------------------------
        curl.exe -s "%ADRES%/%API_ALT%/api/Durum"
        echo.
        echo   ----------------------------------------------------------
        echo   Son ANCM kayitlari:
        powershell -NoProfile -Command ^
          "Get-WinEvent -LogName Application -MaxEvents 20 -EA 0 | Where-Object { $_.ProviderName -match 'AspNetCore|ANCM' } | Select-Object -First 5 TimeCreated, @{n='M';e={($_.Message -split \"`n\")[0]}} | Format-Table -AutoSize | Out-String -Width 200"
        echo   ----------------------------------------------------------
        echo.
        echo   Once yanitin kendisine bakiniz; uygulama kodu hata verdiyse
        echo   sebebi JSON olarak doner:
        echo     %ADRES%/%API_ALT%/api/Durum
        echo.
        echo   Yanit HTML ise uygulama hic baslamamistir. Sirasiyla:
        echo     1. %API_HEDEF%\logs\baslangic-hatasi.txt
        echo     2. %API_HEDEF%\logs klasorundeki stdout dosyasi
        echo     3. portal-tani.bat calistirip ciktisini inceleyiniz
        echo     4. iisreset calistirip tekrar deneyiniz
        echo.
    )
)

echo ==========================================================
echo   IIS TANIMI
echo ==========================================================
%APPCMD% list app /site.name:"%SITE_ADI%"
echo.
echo   Yukarida "/%API_ALT%" satiri gorunmuyorsa uygulama IIS'e
echo   tanitilamamis demektir; istekler /%API_ALT% klasorune statik
echo   dosya gibi gider ve 500 doner.
echo.

echo ==========================================================
echo   YAYINLANDI
echo ==========================================================
echo   Yeni panel : %ADRES%/%PANEL_ALT%
echo   API        : %ADRES%/%API_ALT%
echo.
echo   IK paneli  : %ADRES%/panel      (degismedi)
echo ==========================================================
pause

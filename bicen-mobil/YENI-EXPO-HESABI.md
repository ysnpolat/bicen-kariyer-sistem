# Yeni Expo hesabına geçiş

Derleme kotası hesap başına verildiği için yeni bir Expo hesabıyla devam
ediyoruz. Apple ve Google tarafında hiçbir şey değişmiyor: uygulama aynı
uygulama, sertifikalar aynı sertifikalar. Expo yalnızca derlemeyi yapan
taraf.

## Değiştirilenler

`app.json` içinden `owner` ve `extra.eas.projectId` kaldırıldı. Bunlar
eski hesaba bağlıydı; dururken `eas init` "bu proje başka hesaba ait"
diyerek duruyordu.

Paket adları korunuyor ve korunmalı:

    android.package          com.bicen.personel
    ios.bundleIdentifier     com.bicen.personel

Bu adlar değişirse mağazalarda yeni bir uygulama olur, mevcut kurulumlar
güncellenmez.

## Adımlar

1. `expo.dev` adresinden yeni hesap açın

2. Eski oturumu kapatıp yenisine girin:

       cd bicen-mobil
       eas logout
       eas login

3. Proje kimliğini yeni hesapta üretin:

       set EAS_NO_VCS=1
       eas init

   "Yeni proje oluşturulsun mu?" sorusuna evet deyin. Slug `bicen360`
   kalabilir. Komut `app.json` içine yeni `projectId` yazar.

4. Bildirim jetonu için proje kimliği kullanılıyor; `eas init` sonrası
   `app.json` dosyasında `extra.eas.projectId` satırının oluştuğunu
   doğrulayın. Yoksa bildirimler çalışmaz.

## iOS derlemesi

       eas build --platform ios --profile production --auto-submit

Apple hesabına giriş sorulur:

    Apple ID    ahmet.ozdinc@bicen.com.tr
    Team        WL95B4Q582

Sertifika sorularında **mevcut olanı kullan** seçeneğini seçin.
"Revoke" içeren seçeneği seçmeyin; üretimdeki sertifikayı iptal eder.

Apple bir takımda en fazla üç dağıtım sertifikasına izin verir. Yeni
hesap yeni sertifika üretmeye çalışırsa ve sınıra takılırsa, Apple
Developer portalından kullanılmayan bir sertifikayı iptal etmek gerekir.

`eas.json` içindeki gönderim bilgileri korunuyor:

    appleId      ahmet.ozdinc@bicen.com.tr
    ascAppId     6810635909
    appleTeamId  WL95B4Q582

## Android derlemesi

       eas build --platform android --profile production

İlk derlemede EAS bir imzalama anahtarı üretir ve saklar. **Bu anahtar
kritik:** Play Store'a yüklenen her güncelleme aynı anahtarla imzalanmak
zorundadır. Anahtar kaybolursa uygulamanın güncellenmesi mümkün olmaz,
yeni paket adıyla yeniden yayınlamak gerekir.

Anahtarı yedekleyin:

       eas credentials

Android → production → keystore → indirme seçeneğinden dosyayı alıp
güvenli bir yerde saklayın.

Play'e yüklemeden önce apk ile deneyin:

       eas build --platform android --profile denemeAndroid

## Dikkat

Eski hesaptaki derlemeler ve kurulum bağlantıları çalışmaya devam eder
ama yeni hesaptan erişilemez. Geliştirme derlemesini telefonunuzda
tutuyorsanız, yeni hesapta yeniden almanız gerekir.

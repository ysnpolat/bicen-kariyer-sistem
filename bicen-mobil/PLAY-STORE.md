# Play Store yayın adımları

Bu dosya Biçen360'ı Google Play'de yayınlamak için gereken adımları
sırasıyla anlatır. iOS tarafından farkı: Google bir kerelik 25 dolar
kayıt ücreti alır ve ilk yayında uygulama incelemesi birkaç gün sürer.

## 1. Google Play Console hesabı

`play.google.com/console` adresinden kurumsal hesap açılır. Kuruluş
hesabı seçilirse D-U-N-S numarası istenir; alınması birkaç gün sürebilir.
Kişisel hesapla açmak daha hızlıdır ama uygulama sahibi kişi görünür.

Kayıt ücreti bir kereliktir, yıllık değildir.

## 2. Uygulamayı oluşturma

Console'da **Uygulama oluştur**:

- Ad: Biçen360
- Varsayılan dil: Türkçe
- Uygulama türü: Uygulama
- Ücretsiz

Paket adı derlemeden gelir: `com.bicen.personel`

## 3. Servis hesabı anahtarı

EAS'in Play'e yükleme yapabilmesi için bir servis hesabı gerekir.

1. Play Console → **Kullanıcılar ve izinler** → yeni servis hesabı
   bağlantısından Google Cloud Console'a gidilir
2. Servis hesabı oluşturulur, JSON anahtarı indirilir
3. Anahtar dosyası `bicen-mobil/play-anahtar.json` olarak kaydedilir
4. Play Console'da bu servis hesabına **Sürüm yöneticisi** yetkisi verilir

Anahtar dosyası gizlidir; sürüm denetimine eklenmez.

## 4. Derleme

    cd bicen-mobil
    set EAS_NO_VCS=1
    eas build --platform android --profile production

Play Store yalnızca `.aab` kabul eder; üretim profili bunu üretir.

Elden dağıtıp denemek için `.apk` isterseniz:

    eas build --platform android --profile denemeAndroid

## 5. Yükleme

    eas submit --platform android --latest

İlk yüklemede Play Console'da elle yapılması gerekenler:

- **Uygulama içeriği**: gizlilik politikası adresi, veri güvenliği formu,
  hedef kitle, reklam beyanı
- **Mağaza kaydı**: kısa ve uzun açıklama, ekran görüntüleri
  (en az 2 telefon görüntüsü), 512×512 simge, 1024×500 öne çıkan görsel
- **Sürüm notları**

## 6. Veri güvenliği formu

Uygulama şunları topluyor, formda bunlar beyan edilmeli:

- **Kişisel bilgiler**: ad soyad, sicil numarası, telefon (giriş için)
- **Konum**: yaklaşık ve kesin konum (vardiya karekod okutmasında)
- **Fotoğraf**: arıza ve kontrol listesi görselleri
- **Cihaz kimliği**: bildirim jetonu

Hepsi kurum içi kullanım içindir, üçüncü tarafla paylaşılmaz,
şifreli bağlantı üzerinden iletilir.

## 7. Gizlilik politikası

Play zorunlu tutuyor. Portal üzerinde yayınlanabilir, örneğin:

    https://portal.bicen.com.tr/gizlilik

Metinde hangi verinin ne amaçla toplandığı, nerede saklandığı ve
silinme talebinin nasıl yapılacağı yazmalıdır.

## 8. Dağıtım

Uygulama yalnızca personel içindir. İki seçenek:

**Kapalı test** — belirli e-posta listesine açık, Play'de aranmaz.
Personel listesi elle yönetilir.

**Yayında ama listelenmemiş** — bağlantıyı bilen kurar, aramalarda
çıkmaz. Personel sayısı çoksa yönetimi kolaydır.

Şirket içi dağıtım için **Managed Google Play** de bir seçenek ama
kurumsal cihaz yönetimi gerektirir.

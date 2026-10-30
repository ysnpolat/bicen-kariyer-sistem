# iOS yayını — unlisted app

Biçen360 yalnızca çalışanların kullandığı bir uygulama. Halka açık
App Store'da "genel kullanıcıya faydası olmayan kurum içi araç" gerekçesiyle
(Kural 4.2) reddedilme riski var. Bu yüzden **unlisted** dağıtım seçildi:
uygulama App Store'da duruyor ama aramada, listelerde ve kategorilerde
çıkmıyor; yalnızca doğrudan bağlantıyla kuruluyor.

İnceleme yine de tam yapılıyor. Unlisted olmak incelemeden muaf tutmuyor.

---

## Sıra

### 1. App Store Connect'te uygulama kaydı

Apps → yeni uygulama. Bundle id `com.bicen.personel` seçilecek (Developer
portalında yoksa önce Identifiers altında oluşturun). SKU herhangi bir
metin olabilir, ör. `bicen360`.

Dağıtım tipi **Public** kalacak. Unlisted'a geçiş sonradan, ayrı bir
talep formuyla yapılıyor; baştan Private (Apple Business Manager)
seçilirse geri dönmek için uygulama kaydını sıfırdan açmak gerekiyor.

### 2. Derleme ve yükleme

Mac gerekmiyor; derleme Expo'nun sunucularında yapılıyor.

```bash
npm install -g eas-cli
eas login
cd bicen-mobil
eas init                 # projeyi Expo hesabına bağlar
eas build --platform ios --profile production
eas submit --platform ios --latest
```

İlk derlemede EAS sertifika ve profil oluşturmayı teklif ediyor; kabul
edin. Bildirimler için APNs anahtarını da o adımda oluşturuyor.

`eas.json` içindeki `submit.production.ios` alanlarını kendi
bilgilerinizle doldurun:

| Alan | Nereden |
|---|---|
| `appleId` | Apple hesabınızın e-postası |
| `ascAppId` | App Store Connect → uygulama → App Information → Apple ID |
| `appleTeamId` | developer.apple.com → Membership |

Yükleme sonrası uygulamanın işlenip TestFlight'ta görünmesi 10-15 dakika
sürüyor. Önce kendi telefonunuzda TestFlight'tan deneyin.

### 3. Mağaza bilgileri

Unlisted da olsa hepsi zorunlu; eksikse unlisted talebi reddediliyor.

- **Ekran görüntüleri** — 6.9" iPhone yeterli (tablet desteği kapalı).
  Giriş, ana sayfa, vardiya, arıza kaydı, kontrol listesi.
- **Açıklama** — uygulamanın Biçen çalışanlarına yönelik olduğunu açıkça
  yazın. Unlisted talebinde de aynı gerekçe soruluyor.
- **Gizlilik politikası adresi** — zorunlu. bicen.com.tr altında bir
  sayfa yeterli; hangi verinin niçin toplandığını yazın.
- **App Privacy anketi** — dürüst doldurun: konum (vardiya doğrulaması),
  kişi bilgisi (ad, sicil, telefon, kimlik numarası), fotoğraf (arıza
  kayıtları), kullanıcı içeriği.
- **Kategori** — Business. **Yaş sınırı** — 4+.

### 4. İnceleme hesabı (atlanırsa doğrudan ret)

Giriş SMS ile. İnceleyici Türkiye'deki bir hatta gelen kodu alamaz.

Kariyer API'sinin `appsettings.json` dosyasındaki `Mobil` bölümünü
doldurun:

```json
"Mobil": {
  "IncelemeKimlik": "10000000146",
  "IncelemeKodu": "246810",
  "IncelemePersonelKodu": "14721"
}
```

- `IncelemeKimlik` — **uydurma** 11 haneli bir numara. Gerçek personelin
  TC kimlik numarasını Apple'a vermeyin.
- `IncelemeKodu` — inceleyicinin gireceği 6 haneli sabit kod.
- `IncelemePersonelKodu` — oturumun bağlanacağı personel sicili. Verisi
  temsil edici ama hassas olmayan biri seçilsin.

Bu kimlikle giriş denendiğinde SMS gönderilmiyor, sabit kod veritabanına
yazılıyor ve doğrulama her zamanki yoldan işliyor. Üç alandan biri boşsa
özellik tamamen kapalı.

App Review Information bölümüne yazılacaklar:

```
Bu uygulama yalnızca Biçen Market çalışanlarının kullanımı içindir ve
unlisted dağıtım talep edilmektedir.

Giriş:
  Kimlik numarası : 10000000146
  Telefon         : 5551112233
  Doğrulama kodu  : 246810

Telefon alanına herhangi bir numara girilebilir; bu hesapta SMS
gönderilmez, yukarıdaki sabit kod geçerlidir.
```

Telefon numarası alanına ne yazıldığının önemi yok ama boş bırakılamıyor;
inceleyiciye bir örnek verin.

**Onay geldikten sonra bu üç ayarı boşaltın.** Sabit kodlu bir hesabın
açık kalması gereksiz risk.

### 5. İncelemeye gönderin

Review Notes'a "unlisted dağıtım talep ediyoruz" notunu düşmeyi unutmayın.
Unlisted talebi, uygulama incelemeye gönderilmemişse ya da beta/ön sürüm
durumundaysa reddediliyor.

İncelemelerin büyük çoğunluğu 24-48 saat içinde sonuçlanıyor.

### 6. Unlisted talebi

Talep formu yalnızca hesap sahibine açık:
<https://developer.apple.com/contact/request/unlisted-app/>

Formda uygulama adı, App ID (App Store Connect → App Information → Apple
ID), çözdüğü iş problemi, niçin unlisted istendiği ve tahmini kullanıcı
sayısı soruluyor. "Yaklaşık 600 mağaza çalışanı, 34 şube" gibi somut
yazın.

Onaylanınca bağlantı **General → Pricing and Availability → App
Distribution Methods** altında çıkıyor. Personele yalnızca bu bağlantıyı
dağıtın; başka hiçbir yerde görünmüyor.

---

## Sonraki sürümler

`app.json` içindeki `version` (ör. `1.0.1`) elle artırılır. `buildNumber`
ile `versionCode` EAS tarafından otomatik artıyor (`autoIncrement: true`).

```bash
eas build --platform ios --profile production --auto-submit
```

Yalnızca JavaScript değiştiyse EAS Update ile mağaza incelemesi olmadan da
güncelleme gönderilebilir; yerel kod ya da izin değişikliği varsa yeni
derleme şart.

---

## Android

Google Play tek seferlik 25 dolar ve inceleme daha hızlı. Aynı `eas.json`
ile:

```bash
eas build --platform android --profile production
```

Play Console'da "internal testing" ile başlanıp sonra kapalı/açık teste
geçiliyor. Play tarafında da aynı inceleme hesabı gerekiyor.

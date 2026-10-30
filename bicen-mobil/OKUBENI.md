# Biçen360 — Mobil Uygulama

Expo SDK 58 (26.10.2026'da 57'den yükseltildi). Hem Android hem iOS tek kaynaktan çalışır.

## Çalıştırma

```
npm install
npx expo start --tunnel
```

Telefondaki **Expo Go** ile ekrandaki karekodu okutun.

`--tunnel` bağlantıyı internet üzerinden kurar; telefonla bilgisayarın
aynı ağda olmasına gerek kalmaz ve güvenlik duvarı engellemez. Aynı
wifi'daysanız ve engel yoksa `npx expo start` daha hızlıdır.

## Sürüm uyuşmazlığı

Expo Go yalnızca en son SDK'yı destekler. "Project is incompatible"
hatası alırsanız `package.json` içindeki `expo` sürümü telefondaki
Expo Go ile aynı olmalıdır:

```
npx expo install expo@latest
npx expo install --fix
```

SDK yükseltmesinden sonra eski paketler karışmasın diye temiz kurulum:

```
rmdir /s /q node_modules
del package-lock.json
npm install
npx expo install --fix
npx expo start --tunnel --clear
```

## API adresi

`app.json` içindeki `extra.apiAdresi` sunucuyu gösterir. Yerel geliştirme
için değiştirilebilir:

```json
"extra": { "apiAdresi": "http://192.168.1.5:5177" }
```

## İkinci API — Biçen360

Uygulama iki sunucuya birden gidiyor:

| Modüller | Sunucu | Ayar |
|---|---|---|
| Vardiya, izin, prim, duyuru, iş emri, künye, checklist | Kariyer API | `extra.apiAdresi` |
| Arıza kayıt | Biçen360 API | `extra.api360Adresi` |

Arıza ekranında kayıt listesi (özet kutuları ve durum süzgeci), kayıt
ayrıntısı (fotoğraflar, yorumlar, geçmiş, durum değiştirme) ve yeni kayıt
formu var. Kategori seçildiğinde hedef çözüm süresi gösteriliyor;
departman değişince kategori seçimi sıfırlanıyor, çünkü departmana özel
kategoriler başka departmanın kaydında geçerli değil.

İç not ve "çözüm olarak işaretle" yalnızca departman temsilcilerinde
görünüyor: kaydı açan kendi kaydını çözülmüş ilan edemez.

Jeton ortak — iki API aynı imza anahtarını kullanıyor — bu yüzden ikinci
bir giriş yok. `src/api360.js` `src/api.js` içindeki jetonu okuyor.

Biçen360 sunucusuna ulaşılamazsa yeni modüller menüde görünmez ama
uygulama açılmaya devam eder. Bunu hata gibi göstermek, çalışan İK
modüllerini de kullanılamaz hâle getirirdi.

Yayında değer şu olmalı:

```json
"extra": { "api360Adresi": "https://kariyer.bicen.com.tr/portalservis" }
```

Geliştirmede kendi bilgisayarınızın ağ adresi (`http://192.168.1.x:5181`);
telefon `localhost` göremiyor.

## Envanter

`src/ekranlar/Envanter.js` — iki kademe: önce şube, sonra cihazlar.

| İşlem | Uç | Yaptığı |
|---|---|---|
| Şube listesi | `GET /api/Mobil/EnvanterSubeleri` | Şube, cihaz ve arızalı sayıları |
| Cihaz listesi | `GET /api/Mobil/Envanterim?sube=&ara=` | Kapsam içindeki cihazlar |
| Arıza geçmişi | `GET /api/Mobil/EnvanterArizalari/{id}` | Kapanmışlar dahil son 8 kayıt |
| Etiket okutma | `GET /api/Mobil/EnvanterBul?kod=` | Sicil ya da seri numarasından cihaz |

**Tür süzgeci sunucuya gönderilmiyor.** Gönderildiğinde dönen listeden
türetilen tür şeridi tek türe iniyor ve başka türe geçilemiyordu. Tür,
durum ve sıralama telefonda uygulanıyor; arama sunucuda kalıyor.

**Durum süzgeçleri:** açık arızalı, garantisi bitiyor (30 gün), garantisi
bitti. Üstteki üç özet kutusu da aynı süzgeci çalıştırıyor.

**Karekod etiketi** yalnızca sicil numarasını taşıyor — adres ya da
bağlantı değil, etiketler yeniden basıldığında adres değişmesin diye.
Cihaz detayında etiket gösteriliyor, kamerayla okutulunca `EnvanterBul`
çağrılıyor ve cihaz başka şubedeyse o şubeye geçiliyor.

**Arıza açma düğmesi kartta değil detayda.** Her kartta ayrı düğme varken
otuz cihazlı şubede otuz turuncu düğme alt alta diziliyordu.

## Biçen Kartım (gift kart)

`src/ekranlar/GiftKart.js` — ana sayfadaki bakiye şeridinden açılıyor.

Kart yüzü SVG ile çiziliyor: eğimli renk geçişi, çip, temassız simgesi,
kabartma numara ve altında Code 128 barkod. Ölçü `onLayout` ile alınıyor;
eğriler kartın gerçek en-boyuna göre hesaplanmazsa geniş ekranda eziliyor.

| İşlem | Uç | Yaptığı |
|---|---|---|
| Alışveriş tercihi | `POST /api/Mobil/GiftKartGuncelle` | Tercihi `GrupNo`'ya yazar |
| Kart şifresi | `POST /api/Mobil/GiftKartSifre` | Dört haneli kasa şifresi |

**Kart numarası uygulamadan girilmiyor.** Kart personele cep telefonuyla
eşleşiyor ve eşleştirmeyi İK paneli yapıyor (Biçen Kart ekranı). Personelin
kendi kartını tanımlaması, yanlış numarayla başkasının kartına bağlanmaya
açıktı. Sunucudaki `GiftKartGuncelle` ucu kart numarası da kabul ediyor ama
uygulama göndermiyor; `GiftKartKaldir` duruyor, uygulamada düğmesi yok.

**Alışveriş tercihi doğrudan `GrupNo`:** mobil uygulama seçilirse `608`,
fiziki kart seçilirse `NULL`. Kasa kartı bu numaraya bakarak ayırıyor.
`GiftKartGrup` ucu eski sürümler için duruyor, aynı işi yapıyor.

**Logo:** kart yüzündeki logo `assets/kart-logo.png`. Saydam zeminli, beyaz
çizimli ve geniş bir görsel olmalı. Dosya `require` ile bağlı; silinirse
paketleme hata verir, değiştirmek için üzerine yazın.

**Hareketlerdeki şube:** puan hareketinde kasa tarafının şube numarası
duruyor. `GiftKartServisi.SubeAdlari` bunu `B360_SUBE_DEPO` tablosundaki
şube kodu ve depo numarasıyla eşleştirip ada çeviriyor, yarım saat bellekte
tutuyor. Eşleşme bulunamazsa "Şube 12" gibi gösteriliyor — numarayı gizlemek
kaydı bulmayı zorlaştırırdı.

**Ortak desen:** kart yüzü, ana sayfanın yeşil tepesi ve bakiye şeridi
`src/bilesenler/KartZemin.js` ile çiziliyor (eğimli renk geçişi, kavisler,
ışık). Ölçü `onLayout` ile alınıyor; eğriler alanın gerçek en-boyuna göre
hesaplanmazsa geniş ekranda eziliyor.

Ödeme kodu yalnızca mobil kipte üretiliyor: fiziki kart seçiliyken kasa
plastik kartı okutuyor ve kod karşılığı aramıyor. Koddaki iki dakikalık
geri sayım kodu değil gösterimi sınırlıyor — kod gün boyunca sabit, kasa
aynı hesabı kendi tarafında yapıyor ve başka bir değer eşleşmezdi.

## Sayfa yardım videoları

Sayfa başlıklarının köşesinde hareketli Biçen çiçeği durur
(`src/bilesenler/YardimDugmesi.js`). Dokununca o sayfanın kullanım videosu
uygulama içinde açılır. Video kodu ekranın rota adıdır (`Izin`,
`Performans`…); mağaza müdürünün ekranı farklı olan sayfalarda
`VardiyaPlani.yonetici` ve `Ekibim.yonetici`. Videosu olmayan sayfada çiçek
görünmez.

- Oynatıcı **expo-video**: yeni yerel modül, bu sürüm için
  `npx expo install expo-video` ardından yeni derleme (EAS) gerekir. Modül
  olmayan eski derlemede video telefonun tarayıcısında açılır.
- Hazır videolar API ile gelir: `BicenKariyer.API/wwwroot/yardim/*.mp4`.
- İK paneli › Eğitim Dokümanları › **Uygulama yardım videoları**: video
  izlenir, değiştirilir ya da sayfa bazında kapatılır. Yüklenen video belge
  klasöründe (`yardim-video`) tutulur, yayında silinmez.

## Görseller

```
assets/icon.png           1024x1024  uygulama ikonu
assets/adaptive-icon.png  1024x1024  Android; simge ortada, kenarlarda %25 boşluk
assets/splash.png         1284x2778  açılış ekranı
```

Bu dosyalar eksikse `npx expo start` hata verir. Android ikonu daire ya da
yuvarlatılmış kare olarak kırpar; kenara yakın ayrıntılar kesilir.

## Yapı

```
App.js                  gezinme ve sekmeler
src/api.js              sunucu iletişimi, oturum jetonu
src/tema.js             renkler ve biçimlendirme yardımcıları
src/bilesenler/Ortak.js kart, kutu, satır, rozet
src/api360.js           Biçen360 sunucusu; jetonu api.js'ten alir
src/ekranlar/           dokuz ekran
```

## Mazeret belgesi ve oryantasyon (v923)

Bu sürüm yeni mağaza derlemesi ister: belge yükleme için iki yerel paket eklendi.

```
npx expo install expo-image-picker expo-document-picker
```

`app.json` zip içinde güncel geliyor (sürüm 1.4, `expo-image-picker` eklentisi ve izin metinleri).

Uygulamada otomatik güncelleme olmadığı için bu ekranlar yalnızca yeni derlemede görünür.
Sunucu, personelin yeni sürümü açıp açmadığını `KRY_MOBIL_JETON.gorev_gorulme` alanından
anlıyor: yeni sürümü son 60 günde açmayan personele oryantasyon bağlantısı eskisi gibi SMS
ile gider. Paketler kurulmadan derlenirse "Fotoğraf çek / Dosya seç" düğmeleri
"uygulamayı güncelleyin" uyarısı verir, ekran çökmez.

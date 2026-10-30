# Biçen Market — İş Başvuru Formu

Şubelerdeki QR kodlar üzerinden erişilen, mobil öncelikli iş başvuru sayfası.
Basılı **BİK-001** (Rev. 4 / 29.5.2017) formunun dijital karşılığıdır.

**Teknoloji:** React 18 + Vite + TypeScript + Ant Design 5 + lucide-react
**Bağımsız projedir** — BiSubeWeb veya diğer yapılarla bağlantısı yoktur.

---

## Çalıştırma

**Kolay yol:** `baslat.bat` dosyasına çift tıklayınız. Paketleri kurar, sunucuyu
başlatır ve telefondan bağlanılacak adresi ekrana yazar.

**Elle çalıştırma:**

```bash
npm install
npm run dev
```

| Adres | Kullanım |
|---|---|
| `http://localhost:5179` | Bilgisayardan |
| `http://<bilgisayar-ip>:5179` | Telefondan (aynı ağ üzerinden) |

Yayına almak için: `npm run build` → oluşan `dist` klasörünü IIS veya nginx
altında yayınlayınız.

---

## Yapılacak ayarlar

1. **Logo:** `bicen-logo.png` dosyasını `public/` klasörüne kopyalayınız.
   Dosya yoksa sayfa otomatik olarak yazı tipi logoya döner, hata vermez.

2. **Şubeler:** `src/sabitler.ts` içindeki `SUBELER` dizisine 34 şubenin kod ve
   adlarını giriniz. Şu an 5 örnek satır bulunmaktadır.

3. **Backend:** Mail gönderimi hazır olduğunda yine `src/sabitler.ts` içindeki
   `AYARLAR.apiAktif` değerini `true` yapınız, `apiTaban` ve `apiUc` adreslerini
   düzenleyiniz. `false` iken form verisi tarayıcı konsoluna yazılır ve başarı
   ekranı gösterilir.

---

## QR kodları

Her şube için adresin sonuna kendi şube kodu eklenir:

```
https://kariyer.bicen.com.tr/?sube=SEFAKOY
```

`sube` parametresi gelirse **Çalışmak istediğiniz şube** alanı otomatik seçilir
ve aday bunu değiştirebilir. Parametresiz açılırsa aday şubeyi kendisi seçer.

---

## Form bölümleri

Basılı form ile birebir aynı sırada ilerler, 4 adıma bölünmüştür:

| Adım | Bölüm |
|---|---|
| 1 | **Kişisel Bilgiler** — ad/soyad, medeni durum, çocuk sayısı, doğum tarihi ve yeri, **uyruk** (T.C. / yabancı), kimlik veya pasaport no, **kan grubu**, cep tel 1-2, ev adresi, e-posta, askerlik, ehliyet + sınıfı, ticari taşıt belgesi + SRC, eğitim seviyesi (ilkokul → doktora) + **mezun olunan okul**, bilgisayar program bilgisi |
| 2 | **İş Tecrübeniz** — işyeri adı, görev, net ücret, giriş/çıkış tarihi, ayrılma sebebi (satır eklenebilir) + **Sertifika ve Belgeler** — ad, kurum, tarih, bağlantı ve/veya görsel (en fazla 6 adet) |
| 3 | **Firma Başvuru İçeriği** + **Çalışmak İstediğiniz Bölümler** (16 bölüm) + **şube seçimi** |
| 4 | **Referanslarınız** (satır eklenebilir) + 4857 sayılı yasa **taahhüt metni** + **KVKK onayı** |

**Kalın** yazılanlar basılı formda bulunmayan, tarafınızca istenen eklerdir.

Doğrulamalar: T.C. kimlik no algoritma kontrolü, telefon biçimi, e-posta biçimi,
en az bir bölüm seçimi, taahhüt ve KVKK onayı zorunluluğu. Islak imza yerine
onay kutusu, aday adı ve tarih otomatik olarak kayda geçer.

---

## Gönderilen veri

`src/tipler.ts` içindeki `BasvuruDto` yapısı JSON olarak POST edilir. Mail
şablonu bu alanlardan üretilecektir. Her başvuruya `BSV-YYYYAAGG-XXXX`
biçiminde bir başvuru numarası atanır.

---

## Başvuru sonrası

Gönderim tamamlandığında aday, doldurduğu formu basılı BİK-001 yerleşimiyle
görür ve **Yazdır / PDF** ile çıktı alabilir. `#/sorgula` adresinden kimlik
numarası ve cep telefonu ile başvurularını tekrar görüntüleyebilir.

Sertifika görselleri tarayıcı tarafında en fazla 1400 piksele küçültülüp JPEG
olarak sıkıştırılır; boyut ve adet sınırları `SERTIFIKA_AYARLARI` içindedir.

---

## Sonraki adım

Mail gönderimi (SMTP ayarları, HTML mail şablonu, kayıt tablosu ve API ucu)
ayrıca tanımlanacaktır.

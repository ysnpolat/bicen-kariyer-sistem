# Biçen Kariyer Sistemi

Şubelerdeki QR kodlar üzerinden alınan iş başvurularının toplandığı, İnsan
Kaynakları tarafından değerlendirildiği ve mail ile iletildiği üç parçalı sistem.

### Yayındaki adresler (Plesk)

| Ne | Adres |
|---|---|
| Aday başvuru sayfası | `https://kariyer.bicen.com.tr` |
| İK / Yönetim paneli | `https://kariyer.bicen.com.tr/panel` |
| API | `https://kariyer.bicen.com.tr/apiservis` |

### Geliştirme ortamı

| Parça | Klasör | Port | Kim erişir |
|---|---|---|---|
| API | `BicenKariyer.API` | **5177** | Diğer iki uygulama |
| İK / Yönetim Paneli | `bicen-kariyer-ik` | **5178** | Yalnızca İK ve yönetici (girişli) |
| Aday Başvuru Sayfası | `bicen-kariyer` | **5179** | Adaylar (QR ile, girişsiz) |
| Servis Paneli | `BicenKariyer.Panel` | — | Sunucu yöneticisi (masaüstü uygulaması) |

---

## Hızlı başlangıç

### Servis Paneli ile (önerilen)

`BicenKariyer.Panel` klasöründe bir kez şu komutu çalıştırınız:

```
dotnet publish -c Release -r win-x64 --self-contained false -o yayin
```

Oluşan `yayin\BicenKariyerPanel.exe` dosyasını çalıştırın. Panelden:

- **Servisler** sekmesinde üç servisi tek tek veya topluca başlatıp
  durdurabilirsiniz; durum, PID, başlangıç zamanı ve adres görünür.
- **Loglar** sekmesinde her servisin canlı çıktısını izleyebilirsiniz. Loglar
  ayrıca `yayin\loglar` klasörüne günlük dosyalar hâlinde yazılır.
- **Ayarlar** sekmesinde bildirim maili ayarlarını girersiniz. Bir servis
  beklenmedik şekilde durduğunda bu adreslere mail gider, Windows bildirimi
  çıkar ve (açıksa) servis 5 saniye sonra otomatik yeniden başlatılır.

Pencereyi kapatmak paneli kapatmaz, sistem tepsisine küçültür. Tepsi
simgesine sağ tıklayarak tümünü başlat/durdur yapabilir, çift tıklayarak
paneli geri açabilirsiniz. Tamamen kapatmak için tepsi menüsünden **Çıkış**
seçeneğini kullanınız.

Windows açılışında başlaması için: `Win + R` → `shell:startup` → exe
kısayolunu bu klasöre kopyalayınız.

Servislerin komut, klasör ve port bilgileri `ayarlar.json` dosyasındadır.
Sunucuda yayın modu için `npm run dev` yerine `npm run preview` yazıp önce
her iki frontend klasöründe `npm run build` komutunu çalıştırınız.

### Toplu bat dosyası ile

Kök klasördeki `baslat-tumu.bat` üç servisi ayrı pencerelerde açar. Panel
kullanmayacaksanız bu yol da geçerlidir.

**Gereksinimler:** .NET 8 SDK, Node.js 18+, SQL Server (Express yeterlidir).

---

## İlk kurulum adımları

1. **Veritabanı**
   `BicenKariyer.API/appsettings.json` içindeki bağlantı cümlesi:

   ```
   Server=tcp:mail.bicen.com.tr,11904 · Database=biPortal · User Id=rapor
   ```

   Mevcut **biPortal** veritabanı kullanılır. Uygulamanın tabloları `KRY_`
   önekiyle oluşturulur, böylece portalın mevcut tablolarıyla çakışmaz:

   | Tablo | İçerik |
   |---|---|
   | `KRY_BASVURULAR` | Başvurunun özeti + tam formu `veri_json` alanında |
   | `KRY_BASVURU_HAREKET` | Durum değişiklikleri, kim ne zaman yaptı |
| `KRY_BASVURU_NOT` | Dahili notlar (yalnızca panel kullanıcılarına görünür) |
| `KRY_KADRO` | Açık pozisyon hedefleri (bölüm, şube, kişi sayısı) |
   | `KRY_KULLANICILAR` | Panel kullanıcıları (ad soyad, ünvan, telefon; PBKDF2 ile hashlenmiş parola) |
   | `KRY_AYARLAR` | Mail ve form ayarları (JSON) |

   Tablolar API ilk açılışta otomatik oluşturulur. Yetki hatası alırsanız
   `BicenKariyer.API/kurulum.sql` dosyasını sysadmin yetkili bir hesapla
   çalıştırınız.

   Sunucu bilgisi değişirse dosyayı düzenlemek yerine ortam değişkeni de
   kullanabilirsiniz:

   ```
   setx ConnectionStrings__Varsayilan "Server=tcp:...;Database=BicenKariyer;..."
   ```

2. **Yönetici girişi**
   İK paneline (`http://localhost:5178`) şu bilgilerle giriniz:
   kullanıcı **`admin`**, parola **`Bicen2026!`**
   İlk girişten sonra parolayı mutlaka değiştiriniz.

3. **Mail ayarları**
   Panelde *Yönetim → Mail Ayarları* bölümünden SMTP sunucusunu ve başvuruların
   gideceği adresleri giriniz, ardından **Test maili gönder** ile doğrulayınız.

4. **Şubeler ve form içeriği**
   *Yönetim → Form Ayarları* bölümünden 34 şubenin kod ve adını giriniz.
   Çok sayıda şubeyi tek seferde yazmak için `BicenKariyer.API/subeler.sql`
   betiğini kullanabilirsiniz; SSMS'te VALUES listesini doldurup
   çalıştırmanız yeterlidir.
   Bölümler, eğitim seviyeleri ve diğer listeler de buradan düzenlenir; aday
   sayfası yenilendiğinde değişiklikler anında geçerli olur.

5. **Logo**
   Kurum logosunu **tek bir yere** kopyalayınız:
   `BicenKariyer.API/wwwroot/logo.png`
   Aday sayfası ve İK paneli logoyu buradan alır; iki ayrı kopya tutmanız
   gerekmez. Logoyu değiştirmek için bu dosyayı değiştirip tarayıcıyı
   yenilemeniz yeterlidir. (png, jpg veya svg kullanılabilir.)

6. **API adresi**
   Sunucu IP'si değişirse iki dosyayı güncelleyiniz:
   `bicen-kariyer/src/sabitler.ts` → `AYARLAR.apiTaban`
   `bicen-kariyer-ik/src/api.ts` → `API_TABAN`

---

## Roller

| Rol | Yetkiler |
|---|---|
| **İK Personeli** | Başvuruları listeler ve inceler, dahili not ekler, durum değiştirir, görüşme talebi oluşturur, işe alım ve rotasyon yapar, norm kadroyu yönetir, raporları görüntüler |
| **Yönetici (Admin)** | İK personelinin tüm yetkileri + mail ayarları, form ayarları, kullanıcı yönetimi ve test verisi |
| **Bölge Müdürü** | Yalnızca kendisine tanımlı şubelerin başvurularını görür. Durum değiştiremez, işe alım ve rotasyon yapamaz. Not ekleyebilir; eklediği notu yalnızca İK ve yönetici görür, kendisi başkalarının notlarını göremez. |

Bölge müdürü eklerken kullanıcı penceresinden **yetkili şubeler** seçilir.
Başvurular, aday havuzu ve raporlar — hepsi bu şubelerle sınırlanır.

Kullanıcılar *Yönetim → Kullanıcılar* bölümünden eklenir.

---

## Sunucuda tek tuşla yayınlama

Plesk Windows sunucusunda, paketin kök klasöründeki **`sunucu-yayinla.bat`**
dosyasını çalıştırınız. Betik sırayla şunları yapar:

1. API'yi geçici olarak durdurur (`app_offline.htm`) — dosya kilidi sorunu olmaz
2. API'yi `dotnet publish` ile yayın klasörüne derler
3. Logoyu `wwwroot` klasörüne kopyalar
4. API'yi yeniden başlatır
5. Aday sayfasını `.env.production` dosyasını kendisi yazarak derler
6. `dist` içeriğini belge köküne kopyalar
7. İK panelini derler ve `/panel` klasörüne kopyalar
8. Panel klasörüne güvenlik başlıklarını (`web.config`) yerleştirir ve
   sonunda testleri çalıştırır

Sonda üç kontrol görürsünüz: API sağlık yanıtı, logo yanıt kodu (200 olmalı) ve
aday sayfası yanıt kodu (200 olmalı).

Klasör yolları farklıysa dosyanın başındaki `SITE_KOK` satırını düzenleyiniz:

```
set SITE_KOK=C:\inetpub\vhosts\bicen.com.tr\kariyer.bicen.com.tr
```

**Gereksinimler:** sunucuda .NET 8 SDK, Node.js 18+ ve .NET 8 Hosting Bundle.
IIS uygulaması (`apiservis`) bir kez oluşturulmuş olmalıdır —
bkz. `plesk/IIS-API-KURULUM.md`.

---

## Yayına alma (Plesk)

Aday sayfası `https://kariyer.bicen.com.tr` alan adında yayınlanacaksa
ayrıntılı kılavuz: **`plesk/OKUBENI.md`**

Özet: `bicen-kariyer` klasöründe `npm run build` → oluşan `dist` klasörünü
Plesk'te alan adının `httpdocs` klasörüne yükleyiniz. Ardından Plesk'te
`/api` yolunu API'nin 5177 portuna yönlendiren ters vekil kuralını ekleyiniz
(`plesk/nginx-yonergeleri.txt` veya `plesk/web.config.ornek`).

API adresi kod içinde sabit değildir: alan adı üzerinden açıldığında istekler
aynı alan adına göreli olarak (`/api/...`) gider. Ayrı bir adres kullanmak
isterseniz `.env.production` dosyasında `VITE_API_TABAN` tanımlayınız.

İK paneli internete açılmaz; şirket ağından 5178 portu ile kullanılır.

---

## QR kodlar

İK panelindeki **QR Kodlar** sekmesinden üretilir. Şube listesindeki her şube
için ayrı bir kod ve ek olarak şube seçimsiz genel bir kod oluşturulur.
Kodun ortasına kurum logosu yerleştirilir; hata düzeltme seviyesi en yükseğe
ayarlandığı için logo okumayı engellemez.

- Tek tek **PNG** olarak indirilebilir.
- **Tümünü yazdırılabilir dosya olarak indir** seçeneği, her şube için
  "İŞ BAŞVURUSU İÇİN OKUTUNUZ" yazılı, A4'e iki sütun sığan bir sayfa üretir.

Adres alanına adayların internetten erişeceği adresi yazınız; şirket içi bir
IP yazılırsa şube dışından okutulduğunda sayfa açılmaz.

---

## Kötüye kullanım koruması

Aday formu herkese açık olmak zorunda olduğundan otomatik araçlara karşı üç
katmanlı koruma vardır:

| Katman | Nasıl çalışır |
|---|---|
| Zorunlu alan denetimi | Fotoğraf, ad soyad, birim, pozisyon ve onaylar sunucuda da denetlenir |
| Fotoğraf doğrulaması | Dosya imzası (JPEG/PNG/WEBP) ve en az 4 KB boyut şartı |
| Tekrar fotoğraf | Aynı görsel başka bir kimlikle kullanılmışsa reddedilir |
| Form parmak izi | Aynı dolgu şablonu 3+ farklı kimlikle gelirse reddedilir |
| Kimlik doğrulaması | T.C. kimlik algoritmasını geçmeyen numara kabul edilmez |
| Telefon doğrulaması | 5 ile başlayan 10 haneli cep numarası zorunludur |
| Adres bazlı sınır | Aynı adresten saatte 5, günde 15 başvuru kabul edilir |
| Ülke denetimi | Yalnızca Türkiye'den başvuru kabul edilir |
| Genel sınır | Adresten bağımsız: dakikada 10, saatte 60 başvuru |
| Başarısız istek sınırı | Dakikada 30 reddedilen istek sonrası form geçici kapanır |
| Kimlik beklemesi | Aynı kimlik numarasıyla 6 saat içinde tekrar gönderilemez |
| Bal küpü | Formda gizli bir alan bulunur; dolduran istek sessizce reddedilir |

**Adres tespiti:** `X-Forwarded-For` başlığı yalnızca istek gerçekten
localhost'tan (IIS) geliyorsa dikkate alınır. Aksi hâlde TCP bağlantısının
kendi adresi kullanılır. Bu başlığa koşulsuz güvenmek, saldırganın her istekte
farklı bir adres uydurup adres bazlı sınırı atlamasına yol açar.

**Fotoğraf yalnızca kamerayla alınır.** Galeriden seçme kaldırıldı; aday
fotoğrafını o anda çekmek zorundadır. Sayfa içi kamera destekleniyorsa
(https bağlantıda) o kullanılır, desteklenmiyorsa telefonun kamera
uygulaması açılır.

Bir sınır: `capture` ayarı yalnızca mobil tarayıcılarda kamerayı zorlar.
Masaüstünde tarayıcı bunu yok sayıp dosya seçici açabilir; bu yüzden sayfa içi
kamera desteklenen ortamlarda o yol tercih edilir. Tam koruma sunucu
tarafındaki fotoğraf ve şablon denetimlerinden gelir.

**Fotoğraf denetimi iki aşamalıdır.** Önce dosyanın gerçek bir görsel olup
olmadığı imzasından anlaşılır (JPEG, PNG veya WEBP başlığı) ve en az 4 KB
olması beklenir — rastgele metin ya da tek renk minik görsel geçmez. Sonra
fotoğrafın SHA-256 özeti alınır ve daha önce **başka bir kimlik numarasıyla**
kullanılıp kullanılmadığı denetlenir. Gerçek aday kendi fotoğrafını bir kez
yükler; aynı görselin farklı kimliklerle gelmesi otomatik gönderim işaretidir.

Reddedilenler günlükte **TEKRAR FOTOĞRAF** olarak görünür.

**Fotoğraf özeti meta veriyi yok sayar.** Otomatik gönderimlerde aynı görsel
her seferinde farklı bir JPEG yorumuyla gönderilerek dosya özeti
değiştiriliyordu; piksel verisi aynı olduğu hâlde özet farklı çıkıyor ve
tekrar denetimi işlemiyordu.

Bu yüzden özet alınırken yorum (FFFE) ve uygulama (FFE0-FFEF) bölümleri
atlanır, yalnızca görüntüyü tanımlayan bölümler özetlenir. Meta veri değişse
de özet sabit kalır.

Eski kayıtların özetleri `POST /api/Basvuru/OzetleriYenile` ile bir kez
yeniden hesaplanmalıdır.

**Formdaki kurallar sunucuda da uygulanır.** Otomatik gönderimler aday
formunu hiç kullanmaz, doğrudan API'ye istek atar; bu yüzden formdaki
zorunluluklar (fotoğraf, KVKK onayı, pozisyon seçimi) tek başına koruma
sağlamaz. Aynı denetimler sunucu tarafında da yapılır. Gönderi boyutu 4 MB
ile sınırlıdır.

**Genel sınır** bu nedenle vardır: saldırgan adres tespitini bir şekilde
atlatsa bile toplam başvuru hızı sınırlıdır.

Her başvurunun geldiği **IP adresi ve tarayıcı bilgisi** kaydedilir
(`gonderen_ip`, `tarayici` kolonları). Yöneticiler bu bilgiyi başvuru
detayında görebilir. Engellenen istekler sunucu günlüğüne yazılır.

Sayaçlar bellekte tutulur; uygulama yeniden başlatıldığında sıfırlanır.

### Engellenen adresler

**Yönetim → Güvenlik Günlüğü** ekranındaki listeye eklenen IP adreslerinden
gelen istekler karşılanmaz; istek daha ilk adımda 403 ile geri çevrilir ve
günlüğe yazılır.

Tek adres (`24.133.13.148`) veya önek (`24.133.13.`) yazılabilir. Önek
yazıldığında o aralıktaki tüm adresler engellenir.

Liste bir dakika önbelleklenir; ekleme ve çıkarmalarda önbellek hemen
boşaltılır. Kendi bağlandığınız adresi engellemenize izin verilmez.

### Ülke denetimi

Başvuru formu ve panel girişi yalnızca **Türkiye'den** erişime açıktır.
Ülke tespiti `ip-api.com` üzerinden yapılır; sonuçlar 12 saat önbelleklenir.

```json
"UlkeDenetimi": {
  "Acik": true,
  "Ulkeler": [ "TR" ]
}
```

`Acik: false` yapıldığında denetim tamamen devre dışı kalır. Ek ülke
gerekirse listeye eklenir.

**Servise ulaşılamazsa istek engellenmez.** Gerçek adayları kesmek, birkaç
sahte kaydın geçmesinden daha kötüdür. Engellenen istekler günlükte
**YURT DIŞI** olarak görünür.

Bu denetim VPN kullanan bir saldırganı durdurmaz; Türkiye çıkışlı vekil
sunucular mevcuttur. Diğer katmanlarla birlikte anlamlıdır.

### Cloudflare Turnstile

Aday formunda, ziyaretçinin gerçek bir tarayıcı kullandığını arka planda
doğrulayan bir bileşen bulunur. Kullanıcıya genelde hiçbir şey sorulmaz.
Otomatik araçlar bu doğrulamayı geçemez.

**Kurulum:**

1. `dash.cloudflare.com` → sol menüden **Turnstile** → **Add widget**
2. Widget adı verin, **Domain** olarak `kariyer.bicen.com.tr` yazın
3. Widget Mode: **Managed** seçin, **Create** deyin
4. Verilen **Site Key** ve **Secret Key** değerlerini sunucudaki
   `appsettings.json` dosyasına yazın:

```json
"Turnstile": {
  "SiteAnahtari": "0x4AAA...",
  "GizliAnahtar": "0x4AAA..."
}
```

5. Uygulamayı yeniden başlatın.

Anahtarlar boş bırakıldığında doğrulama devre dışı kalır; başvurular eskisi
gibi alınır. Cloudflare'e ulaşılamadığında da başvurular durmaz, durum
güvenlik günlüğüne yazılır — gerçek adayları engellememek önceliklidir.

Reddedilen doğrulamalar günlükte **TURNSTILE RED** ve **TURNSTILE EKSİK**
olarak görünür.

**Panel girişinde:** Doğrulama her girişte istenmez; **iki hatalı denemeden
sonra** devreye girer. Böylece günlük kullanımda İK ekibi beklemez, otomatik
parola denemeleri ise kesilir. Altı hatalı denemeden sonra adres zaten 15
dakika kilitlenir. Doğru parolayla giriş yapıldığında sayaç sıfırlanır.

Aynı Cloudflare anahtarı hem aday formu hem panel girişi için kullanılır;
ayrı bir widget oluşturmaya gerek yoktur.

### Bot ve sahte başvuru koruması

Katmanlar birbirini tamamlar; bot bir katmana uyum sağladıkça diğerleri
devrede kalır.

**SMS doğrulaması.** Başvuru gönderilmeden önce adayın telefon numarasına
JetSMS üzerinden altı haneli kod (dört rakam iki harf) gönderilir; kod
doğrulanmadan form kaydedilmez.

```json
"TelefonDogrulama": { "Acik": true },
"JetSms": {
  "Acik": true,
  "KullaniciAdi": "", "Sifre": "", "Gonderici": "",
  "Alanlar": { "Kullanici": "kno", "Sifre": "sifre",
               "Gsm": "gsm", "Mesaj": "mesaj", "Baslik": "baslik" }
}
```

JetSMS'in tam API alan adları hesaba özeldir ve genel dokümanlarda
yayınlanmaz; bu yüzden `Alanlar` altı appsettings.json üzerinden
düzenlenir, kod değiştirmeden düzeltilebilir. Yayınlamadan önce
**Yönetim → Güvenlik Günlüğü → Araçlar → JetSMS Bağlantısı** ile test
numarasına gönderim deneyip ham yanıtı görebilirsiniz.

Kod 15 dakika geçerlidir, 5 yanlış denemeden sonra geçersiz olur. Aynı
numaraya günde en fazla 5 kod, aynı adresten saatte en fazla 5 farklı
numara denenebilir.

**İzin verilen / engellenen e-posta sağlayıcıları.** Yönetim → Güvenlik
Günlüğü → E-posta Alanları sekmesinden yönetilir. İzinli listede kayıt
varsa yalnızca oradaki sağlayıcılardan başvuru kabul edilir (örn. yalnızca
gmail.com, hotmail.com, outlook.com, icloud.com); liste boşsa yalnızca
engelli liste geçerli olur. E-posta artık kod istemez, yalnızca sağlayıcı
denetlenir.

**Fotoğraf özeti.** Aynı fotoğraf farklı kimliklerle tekrar gönderilirse
yakalanır. Özet, JPEG'in yorum ve uygulama bölümlerini yok sayarak yalnızca
görüntü verisinden hesaplanır; botun dosyanın meta verisini değiştirip
özeti farklılaştırma yöntemi bu sayede işe yaramaz.

**Form şablonu.** Aynı dolgu verisi (adres, kan grubu, eğitim gibi sabit
alanlar) üç farklı kimlikle gelirse yakalanır.

**Yapay zekâ incelemesi.** Fotoğraf, form verisiyle birlikte görsel modele
gönderilir. Ölçüt yalnızca "insan yüzü var mı" değil, "bu başvuru
fotoğrafı ile form birbiriyle tutarlı mı"dır — ad ile fotoğraftaki
cinsiyetin uyuşmaması, kadrajın yarısının kesilmesi gibi işaretlere bakar.
Reddedilen başvurular silinmez, **İnceleme** sekmesine düşer.

**Toplu gönderim koruması.** Kısa sürede çok sayıda başvuru gelirse
(varsayılan: 10 dakikada 6) korumalı kipe geçilir; bir saat boyunca yeni
başvurular incelemeye alınır.

**Bal küpü.** Formda gerçek kullanıcının göremediği gizli bir alan
bulunur; otomatik araçlar bu alanı da doldurur. **Dikkat:** alan adı
autofill'in tanıyabileceği bir kalıptan (örn. "website") kaçınmalıdır —
aksi hâlde gerçek kullanıcıların tarayıcı otomatik doldurması alanı
doldurup ters etki yaratır. Doldurulduğunda başvuru incelemeye alınır,
gönderene başarı mesajı döner.

**Kaynak denetimi (varsayılan kapalı).** İsteğin form sayfasından gelip
gelmediği `Origin` başlığından denetlenebilir. Varsayılan kapalıdır çünkü
Instagram/Facebook/TikTok içi tarayıcılar bu başlığı sıklıkla göndermez;
açarsanız o kanallardan gelen gerçek adayların bir kısmı incelemeye düşer.

**Reddedilenler nereye gider.** Fotoğraf, şablon ve doğrulama dışındaki
tüm bot tespiti (yapay zekâ, toplu gönderim, bal küpü) kaydı silmez;
**Başvurular → İnceleme** sekmesine alır. İK fotoğrafa ve forma bakıp
gerçek bir aday ise başvurulara aktarabilir, sahte ise işaretleyip izleri
kalıcı kara listeye alabilir.

### Diğer güvenlik önlemleri### Güvenlik günlüğü

Engellenen başvurular, hız sınırı aşımları ve panel giriş denemeleri
`apiservis/logs/guvenlik-YYYY-AA-GG.log` dosyalarına yazılır ve 30 gün
saklanır. Uygulama IIS altında çalıştığı için konsol günlükleri hiçbir yere
ulaşmaz; bu dosyalar o boşluğu doldurur.

Kayıtlar sunucuya bağlanmadan **Yönetim → Güvenlik Günlüğü** sekmesinden
görüntülenebilir. Ekranda olay türlerine göre özet, en çok işlem yapan
adresler ve tüm kayıtların listesi yer alır. Yalnızca yöneticiler erişebilir.

---

## Test verisi

Yönetici menüsündeki **Test Verisi** ekranı, aday formunu doldurmadan başvuru
oluşturur. İki yol vardır:

- **Tek başvuru** — kısa bir formla tek kayıt. Tüm alanlar isteğe bağlıdır;
  boş bırakılanlar rastgele doldurulur. Belirli bir durumu veya birimi denemek
  için kullanılır.
- **Toplu üretim** — istediğiniz sayıda kaydı birimlere, pozisyonlara ve
  durumlara rastgele dağıtarak üretir. Tarihler geçmişe yayıldığı için raporlar
  ve aylık grafik anlamlı görünür.

Bu kayıtlar `test_kaydi = 1` olarak işaretlenir, başvuru listesinde **TEST**
etiketiyle görünür ve aynı ekrandaki *Test kayıtlarını sil* düğmesiyle
notlarıyla birlikte tek seferde temizlenir. Gerçek başvurular etkilenmez.

---

## Karşılama ekranı

`kariyer.bicen.com.tr` adresi açıldığında adayı bir karşılama ekranı karşılar.
Burada birim türleri kart olarak listelenir: her kartta simge, açıklama, rozet
ve örnek pozisyonlar bulunur.

- **Şube** gibi birden fazla birimi olan türlerde şube seçimi, eskisi gibi
  başvuru formunun içinde açılır listeden yapılır.
- **Genel Müdürlük** ve **Lojistik Depo** gibi tek birimli türlerde birim
  doğrudan belirlenir; formda yalnızca pozisyon seçilir.

Formun üstünde hangi birime başvurulduğu gösterilir, "Değiştir" düğmesiyle
karşılama ekranına dönülebilir. Pozisyon listesi her durumda seçilen birim
türüne göre gelir.

**QR ile gelen adaylar** karşılama ekranını görmez; `?sube=SEFAKOY` parametresi
birimi belirlediği için doğrudan form açılır.

Kart açıklamaları ve rozetleri *Yönetim → Form Ayarları* bölümünden düzenlenir.

Kart sırası `bicen-kariyer/src/sabitler.ts` içindeki `KART_SIRASI` dizisiyle
belirlenir (varsayılan: Şube → Lojistik Depo → Genel Müdürlük). Listede yer
almayan birim türleri bunların ardından, ayarlardaki sırayla gösterilir.

---

## Birimler ve pozisyonlar

Sistem üç birim türü ile çalışır: **Şube**, **Genel Müdürlük** ve **Lojistik
Depo**. Her türün kendi pozisyon listesi vardır.

Aday formunda önce birim seçilir; ardından yalnızca o birime ait pozisyonlar
listelenir. Genel Müdürlük seçildiğinde Bilgi İşlem, Muhasebe gibi ofis
pozisyonları; Lojistik Depo seçildiğinde Mal Kabul, Forklift Operatörü gibi
depo pozisyonları görünür.

Birim türleri ve pozisyonları *Yönetim → Form Ayarları* bölümünden düzenlenir.
Yeni bir tür (örneğin "Üretim Tesisi") eklemek de mümkündür.

Raporlar ekranındaki **birim filtresi** varsayılan olarak "Tümü" gelir; tür
seçildiğinde tüm sayılar, grafikler ve kırılımlar o birime göre daraltılır.

---

## Personeller

Sol menüdeki **Personeller** ekranı, çalışan ve işten ayrılmış personeli
listeler. Veriler Mikro veritabanından (`MikroDesktop_2004BICEN`) **yalnızca
okunur**; bu sistem üzerinden personel kaydı değiştirilmez.

Gösterilen bilgiler: ad soyad, personel kodu, kimlik numarası, telefon,
iş grubu, ünvan, işe giriş tarihi, çalışma süresi ve durum.

Bu kaynakta ayrı bir durum alanı bulunmadığı için **çıkış tarihi olmayan
personel çalışıyor** kabul edilir; çıkış tarihi olanlar ayrılmış olarak
gösterilir. Mikro'da boş tarihler 1900 öncesi değerlerle tutulabildiğinden bu
tarihler yok sayılır.

Filtreler: çalışan / ayrılan / tümü, serbest arama (ad, personel kodu, kimlik,
telefon), iş grubu ve ünvan. Liste Excel'e aktarılabilir.

**Yapılandırma** — `appsettings.json`:

```json
"ConnectionStrings": {
  "Personel": "Server=tcp:mail.bicen.com.tr,11904;Database=MikroDesktop_2004BICEN;User Id=rapor;Password=102030;..."
}
```

Veritabanı başka bir sunucudaysa yalnızca bu satırdaki adresi değiştirmeniz
yeterlidir. Sorun yaşanırsa ekrandaki **Bağlantıyı sına** düğmesi hangi
aşamada takıldığını gösterir.

---

## Mobil kullanım

Panel telefonda da tam işlevlidir. 768 pikselden dar ekranlarda:

- Sol menü, başlıktaki düğmeyle açılan bir çekmeceye dönüşür.
- Tablolar kart listesine dönüşür: ilk sütun kartın başlığı, diğer sütunlar
  etiket-değer çiftleri olur. Yatay kaydırma gerekmez.
- Açılabilir satırlar kartın sağındaki okla açılır.
- Filtreler alt alta ve tam genişlikte dizilir.
- Çekmeceler ve pencereler tam ekran açılır.

Norm Tablosu gibi çok sütunlu özel görünümler kendi kart düzenlerine geçer.

---

### Genel mobil katmanı (styles.css sonu)

Sayfa sayfa düzeltme yerine ortak kalıpları toptan ele alan bir `@media
(max-width: 767px)` katmanı var: tablolar sayfa yerine kendi içinde yatay
kayar (`min-width: 640px`), sekme şeridi kaydırılabilir, araç çubuğundaki
sabit genişlikli arama/seçim/tarih alanları tam genişlik olur, kart
başlığındaki düğmeler alt satıra iner, pencere ve çekmeceler tam ekran
açılır, kutu ızgaraları tek/iki sütuna iner, başlıkta kullanıcı adı
gizlenir. Dokunmatik cihazlarda satır yüksekliği biraz artar. Yeni bir
sayfada taşma görürseniz önce bu katmandaki kalıplardan hangisine
uymadığına bakın; genellikle inline `width: 240` gibi sabit bir genişlik
ya da `Space` dışında duran bir alandır.

## Sirkülasyon

Sol menüdeki **Sirkülasyon** ekranı personel devrini analiz eder. Dönem
seçimi hazır düğmelerle (son 3 / 6 / 12 ay) veya takvimden serbestçe yapılır.

**Devir oranı** şöyle hesaplanır:

```
ortalama çalışan = (dönem başı çalışan + dönem sonu çalışan) ÷ 2
devir oranı      = dönemde ayrılan ÷ ortalama çalışan × 100
yıllık karşılığı = devir oranı × (12 ÷ dönem ayı)
```

Dönem başı ve sonu çalışan sayıları giriş-çıkış tarihlerinden bulunur, böylece
kadrosu büyüyen veya küçülen birimlerde oran doğru çıkar. %100'ün üzerindeki
değerler kadronun tamamından fazla kişinin ayrıldığını gösterir. Sütunun
üzerine gelindiğinde hesabın kendisi görünür.

**Birim bazında:** mevcut personel, dönemde işe giren ve ayrılan sayısı, devir
oranı, ayrılanların ortalama çalışma
süresi, ilk yılını doldurmadan ayrılan sayısı, o birime yapılan işe alımların
ortalama süresi ve en çok ayrılan pozisyonlar. Satır açıldığında ayrılan
personel tek tek listelenir: ünvan, giriş-çıkış tarihleri, çalışma süresi ve
çıkış sebebi.

**Pozisyon bazında:** hangi pozisyonda kaç kişi başlamış, kaç kişi ayrılmış,
ortalama ne kadar çalışmışlar.

**Çıkış sebepleri** dönem genelinde ayrıca özetlenir.

### Geri Dönenler sekmesi

Daha önce çalışıp ayrılmış ve tekrar işe alınmış personeli analiz eder. Aynı
kişinin farklı personel kodlarıyla açılmış kayıtları **kimlik numarası**
üzerinden eşleştirilir; 7 günden kısa aralar kayıt düzeltmesi sayılır ve geri
dönüş kabul edilmez.

Hesaplamalar:

```
geri dönüş oranı = geri dönen kişi ÷ dönemde ayrılan benzersiz kişi × 100
kalıcılık oranı  = ikinci döneminde hâlâ çalışan ÷ geri dönen × 100
kıdem değişimi   = ikinci dönem ort. süre − birinci dönem ort. süre
```

Listede her kişinin önceki dönemi (birim, tarihler, süre), çıkış sebebi,
aradan geçen zaman, döndüğü birim (aynı/farklı etiketiyle), ikinci dönem
süresi ve güncel durumu yer alır. Kırılımlar: çıkış sebebine göre geri dönüş,
ara süreye göre kalıcılık, aynı/farklı birim karşılaştırması ve birim bazında
geri dönüş tablosu.

Giriş ve çıkış bilgisi Mikro'dan, işe alım süresi başvuru sisteminden gelir;
ikisi birim adına göre eşleştirilir.

---

## Norm kadro ve işe alım

### Norm Kadro ekranı

Ekran üç sekmelidir: **Kadro Düzenleme**, **Şube Raporu** ve **Bölge Raporu**.

Norm kadro verileri üzerinde **yalnızca yöneticiler** değişiklik yapabilir; İK
personeli görüntüleyebilir ve rapor alabilir. Bu sınır hem arayüzde hem
sunucuda uygulanır.

**Excel'den içeri aktarma (yalnızca yönetici):** Excel'deki iki sütunu
(departman kodu ve meslek) kopyalayıp yapıştırmanız yeterlidir. İki biçim
desteklenir:

- **Kişi listesi** — her satır bir personeldir; aynı birim ve meslekteki
  satırlar sayılarak adede dönüştürülür.
- **Özet liste** — birim, meslek ve adet sütunlarıyla gelir.

Değerlerin *mevcut personel* alanına mı yoksa *norm kadro* alanına mı
yazılacağı seçilir. Departman ve meslek adları sistemdeki birim ve
pozisyonlarla otomatik eşleştirilir; "PART", "VKL" gibi ekler yok sayılır.
Eşleşmeyenler için ekranda elle seçim yapılabilir. Aktarmadan önce tüm satırlar
önizlemede gösterilir.

**Excel görünümünde giriş (yalnızca yönetici):** "Excel görünümünde gir"
düğmesi, satırlarda pozisyonların sütunlarda şubelerin yer aldığı bir matris
açar. Üstteki seçimle hangi değerin girildiği belirlenir (Norm / Mevcut /
Engelli); birim türü ve bölgeye göre daraltılabilir. Değiştirilen hücreler
turuncu görünür, satır ve sütun toplamları anında hesaplanır, tümü tek tuşla
kaydedilir.

**Şube bazlı toplu düzenleme:** Birim filtresinden bir şube seçip "Şubeyi
toplu düzenle" düğmesine bastığınızda, o şubenin türüne ait tüm pozisyonlar
tek ekranda listelenir; norm, mevcut ve engelli çalışan sayılarını satır satır
girip hepsini birlikte kaydedersiniz. Norm ve mevcutu boş bırakılan pozisyonlar
kaydedilmez.

**Şube Raporu** sekmesi, İK'nın kullandığı Excel tablolarının karşılığıdır ve
iki görünüm sunar:

- **Şube Listesi** — her şube bir satır: eksik pozisyonlar (kaç kişilik ve kaç
  gündür açık), işe alınanlar, evrak süreci devam edenler, fazla personel +
  engelli çalışan, rotasyon ve havuzdaki aday sayıları.
**İşe alınanlar yalnızca seçilen güne aittir**; varsayılan bugündür. Filtre
satırındaki takvimden başka bir gün seçilerek o günün alımları görüntülenebilir.
Havuzdaki ve evrak aşamasındaki adaylar bu süzgeçten etkilenmez.

- **Norm Tablosu** — şubeler sütun, ölçütler satır: norm, mevcut durum, fark,
  engelli çalışan, eksik ve fazla personel detayı; sağda genel toplam sütunu.
  Tüm şubeler kaydırma çubuğu olmadan ekrana sığar; 900 pikselden dar
  ekranlarda otomatik olarak şube kartlarına dönüşür.

**Dışa aktarma:** Her iki görünüm de dört biçimde indirilebilir:

| Düğme | Çıktı |
|---|---|
| Excel | Renkleri ve kenarlıkları korunmuş `.xls` dosyası |
| PDF | A4 yatay, doğrudan inen `.pdf` (yazdırma penceresi açılmaz) |
| Görsel | Yüksek çözünürlüklü `.png` |
| İndirme simgesi | Ham veri `.csv` |

Aynı düğmeler Bölge Raporu sekmesinde de bulunur.

Norm ve mevcut değerleri **ondalıklı** girilebilir (24,5 gibi yarım kadrolar
için). Rapor bölgeye göre süzülebilir, yalnızca eksiği olan şubeler
gösterilebilir ve Excel'e aktarılabilir.

Her birim için pozisyon bazında **norm kadro** (olması gereken) ve **mevcut
personel** sayısı girilir; ihtiyaç otomatik hesaplanır.

Örnek: Atakent şubesi · Kasiyer · Norm 6 · Mevcut 4 → **2 kişi ihtiyaç**.

Bu bilgiler hem Aday Havuzu ekranındaki doluluk oranlarını hem Raporlar
ekranındaki ihtiyaç tablosunu besler.

### İşe alım ve rotasyon

Başvuru detayında iki yeni işlem vardır:

- **İşe Al** — işe giriş tarihi girilir, aday *İşe Alındı* durumuna geçer.
  Aynı ekranda birim değiştirilerek rotasyon da yapılabilir: Atakent şubesine
  başvuran aday, ihtiyaç olan Halkalı şubesinde işe alınabilir.
- **Birim Değiştir** — işe almadan da adayın birimi değiştirilebilir. Her
  değişiklik gerekçesiyle birlikte işlem geçmişine kaydedilir.

*İşe Alındı* durumundaki başvurular ana listede görünmez, durum filtresinden
seçilerek görüntülenir ve raporlara yansır.

---

### Tarih aralığı süzgeci

Başvurular → Filtreler'de tarih aralığı. Verildiğinde o günlerdeki **bütün**
başvurular listelenir; sonuçlananları (Olumlu, İşe Alındı, Olumsuz) gizleyen
kural devreden çıkar (`Liste?tarihBas=&tarihBit=`, bitiş günü dahil).
Hazır seçimler: bugün, son 7 gün, son 30 gün, bu ay, geçen ay.

### "Pivot olarak indir"

Norm Kadro sayfasındaki düğme artık gerçek .xlsx üretir
(`raporExcel.normKadroIndir`). Eski sürüm HTML'i .xls uzantısıyla
veriyordu; Excel "dosya biçimi ve uzantısı eşleşmiyor" uyarısı çıkarıyordu.
Yedi sayfa: Norm Kadro / Kadro Doluluğu / Fark (birim × pozisyon çapraz;
Fark'ta eksik kırmızı, fazla turuncu), **Mevcut Personel** (kişi listesi:
bölge, birim, pozisyon, ad soyad, sicil, TC kimlik — role göre maskeli —,
engelli, işe giriş, çalışma günü, telefon; engelli satırı turuncu), Özet
(doluluk renk ölçekli, toplam satırlı), Veri ("NormVerisi" Excel Tablosu, **kişi düzeyinde**) ve Pivot
(Bölge › Birim › Pozisyon › **Personel** satırları, Norm ve Mevcut
toplamları; gerçek PivotTable). Pivot önbelleği tam yazılır (paylaşılan öğeler ve kayıtlar), Excel
yerleşimi yeniden kurmak zorunda kalmaz; alan sırası korunur. Veri sayfasında her
çalışan bir satırdır (Mevcut = 1); norm kişiye ait olmadığı için pozisyon
başına tek "(norm)" satırında taşınır (Mevcut = 0). Böylece pozisyon
düzeyinde Norm ve Mevcut doğru toplanır, altında çalışanların adı görünür.
Çalışan listesi indirme anında `GET /api/Personel?durum=calisan` ile
çekilir; şube adı ya da koduyla, pozisyon adıyla (büyük/küçük harf
duyarsız) eşlenir; kadro planında olmayan pozisyondaki çalışanlar da kendi
pozisyonuyla listelenir. Pivot parçası sorun çıkarırsa
`raporExcel.ts` içindeki `PIVOT_EKLE` kapatılır.

## Başvuru durumları

`Yeni` → `İncelendi` → `Değerlendirmede` → `Görüşme Talebi` → `Olumlu` →
`Evrak Hazırlanıyor` → `İşe Alındı` · veya herhangi bir aşamada `Olumsuz`

**İncelendi** durumu, başvuruyu inceleyen İK personeli tarafından değerlendirme
bölümündeki turuncu düğmeyle işaretlenir. Böylece bakılmış ancak henüz karar
verilmemiş kayıtlar listede turuncu etiketle ayrışır.

---

### Olumlu kartı

Başvurular sayfasındaki özet kartlarına **Olumlu** eklendi; tıklanınca
havuza aktarılmış (Olumlu durumundaki) başvurular listelenir.

### Kartlar, şerit ve liste aynı tabanı sayar

`GET /api/Basvuru/Ozet` liste ile aynı kuralı uygular: arşivlenenler sayılmaz
ve aynı kimlik numarasıyla yapılmış eski başvurular düşürülüp kişi başına
yalnızca en yeni başvuru sayılır. Toplam, durum sayılarının toplamıdır.
Şeritteki "Yeni" doğrudan Yeni durumunun sayısıdır; "İşlemde" İncelendi,
Değerlendirmede, Görüşme Talebi, Evrak Hazırlanıyor ve Onay Bekliyor'u
kapsar. Listede "tekrarları göster" açılırsa liste kartlardan fazla satır
gösterir; bu beklenen davranıştır.

## Bekleme süreleri

Başvuru listesinde her kayıt için **bekleme** sütunu vardır: başvurunun
üzerinden kaç gün geçtiğini gösterir ve süre uzadıkça rengi değişir
(2 güne kadar yeşil, 7 güne kadar sarı, 14 güne kadar turuncu, sonrası
kırmızı). Son işlemden bu yana üç günden fazla geçmişse ayrıca "işlemsiz"
etiketi çıkar.

Başvuru detayında da aynı bilgi yazıyla verilir ve görüşme planlanmamışsa
bu ayrıca belirtilir.

---

## İK performans (yalnızca yönetici)

Sol menüdeki **İK Performans** ekranı yalnızca yönetici rolüne görünür.
Seçilen dönem için:

- **Uzman bazında** — ilgilenilen başvuru, işlem yaptığı farklı birim sayısı,
  inceleme, görüşme, olumlu, işe alınan, olumsuz, rotasyon ve not sayıları;
  sonuçlandırma oranı, **ortalama tepki süresi** ve son işlem zamanı
- **Ortalama doldurma** — açılan bir pozisyonun işe alım yapılana kadar kaç
  gün açık kaldığı. Norm kadroda eksiğin başladığı tarihten işe giriş tarihine
  kadar ölçülür ve işe alımı yapan personele yazılır.

**Ücret Pazarlığı** sütunu, o uzmanın işe aldığı adayların ortalama ücret
talebini ve anlaşılan ortalama ücreti yan yana gösterir. Yüzde farkı yeşilse
talebin altında anlaşılmış, kırmızıysa üstünde demektir.

Tabloda **Eski Çalışan** sütunu, o uzmanın işe aldıklarından kaçının daha önce
şirkette çalışmış olduğunu gösterir; yanında işe alımlarına oranı yer alır.
Kimlik numarası Mikro personel kayıtlarıyla karşılaştırılarak bulunur.

Ekranın altındaki **Olumsuz Değerlendirmeler** bölümü, seçilen dönemde kimin
kaç başvuruyu olumsuz sonuçlandırdığını gösterir: personel bazında sayı, genel
içindeki pay ve en çok olumsuz verdiği pozisyonlar. Satır açıldığında adaylar,
başvuru ve işlem tarihleri ile gerekçeler listelenir.

**Pozisyon Doldurma Süreleri** bölümü aynı ölçüyü pozisyon
bazında verir: kasiyer açığı ortalama kaç günde kapatıldı, reyoner kaç günde
gibi. Her satırda işe alım sayısı, ortalama süre, en hızlı ve en yavaş değerler
yer alır; satıra tıklandığında o pozisyondaki tek tek işe alımlar (aday, birim,
bölge, süre, işlemi yapan) listelenir. Altta bölge bazında ortalamalar
gösterilir.
- **Bölge bazında** — aynı sayıların bölge toplamları

Ortalama tepki süresi, başvurunun sisteme gelmesinden o kişinin aynı
başvuruya ilk dokunuşuna kadar geçen sürelerin ortalamasıdır. Süreler saat
ve dakika olarak yazılır ("3 saat 20 dk"), üzerine gelindiğinde en hızlı ve
en yavaş değerler görünür. Ekranın üstünde tüm ölçütlerin nasıl hesaplandığını
anlatan bir açıklama kutusu vardır.

### Bölge tanımlama

Bölgeler *Yönetim → Form Ayarları → Bölgeler* bölümünden tanımlanır: bölge adı
yazılır ve altına o bölgeye bağlı şubeler seçilir.

*Yönetim → Kullanıcılar* ekranında bir personele **bir veya birden fazla bölge**
seçebilirsiniz. Seçilen bölgelerin şubeleri birleştirilerek yetkili şubeleri
olarak otomatik atanır — ayrıca şube seçmeniz gerekmez. Bölgeye sonradan şube
eklerseniz, Form Ayarları kaydedildiğinde bölgesi olan tüm kullanıcılar
yeniden hesaplanır.

Performans ekranında, birden fazla bölgeden sorumlu uzmanların sayıları her
bölgede görünür; bu nedenle bölge toplamları genel toplamdan yüksek olabilir.

Bölge, hem yetki hem de İK Performans ekranındaki kırılım için kullanılır.
Bölge girilmemiş kullanıcılar performansta "Belirtilmemiş" başlığı altında
toplanır.

---

## Form önizlemesi

Başvuru gönderildikten sonra adaya gösterilen ve panelde açılan basılı form
(BİK-001 düzeni), pozisyon listesini **başvurunun kendi verisinden** okur.
Başvuru anında adaya sunulan pozisyonlar kayda yazıldığı için, form ayarları
sonradan değişse bile eski başvurular o günkü hâliyle basılır.

Bu bilgiyi içermeyen eski kayıtlarda yalnızca adayın seçtiği pozisyonlar
gösterilir.

---

## Başvuru detay penceresi

Raporlar, İK Performans ve Aday Havuzu ekranlarında bir başvuruya
tıklandığında açılan pencere üç sekmeden oluşur:

- **İK Notları** — o başvuruya eklenmiş tüm dahili notlar; her notta yazan
  personel ve tarih. Not varsa pencere bu sekmeyle açılır.
- **Başvuru Formu** — adayın doldurduğu formun tamamı
- **İşlem Geçmişi** — durum değişiklikleri, kim ne zaman yaptı

Pencerenin başlığında adayın adı, güncel durumu, telefonu, birimi, başvuru
tarihi ve **son işlemi yapan personel** görünür. Aynı bilgi liste
tablolarında da ayrı bir sütun olarak yer alır.

---

## Kötüye kullanım koruması

Aday formu herkese açık olmak zorunda olduğundan otomatik araçlara karşı üç
katmanlı koruma vardır:

| Katman | Nasıl çalışır |
|---|---|
| Zorunlu alan denetimi | Fotoğraf, ad soyad, birim, pozisyon ve onaylar sunucuda da denetlenir |
| Fotoğraf doğrulaması | Dosya imzası (JPEG/PNG/WEBP) ve en az 4 KB boyut şartı |
| Tekrar fotoğraf | Aynı görsel başka bir kimlikle kullanılmışsa reddedilir |
| Form parmak izi | Aynı dolgu şablonu 3+ farklı kimlikle gelirse reddedilir |
| Kimlik doğrulaması | T.C. kimlik algoritmasını geçmeyen numara kabul edilmez |
| Telefon doğrulaması | 5 ile başlayan 10 haneli cep numarası zorunludur |
| Adres bazlı sınır | Aynı adresten saatte 5, günde 15 başvuru kabul edilir |
| Ülke denetimi | Yalnızca Türkiye'den başvuru kabul edilir |
| Genel sınır | Adresten bağımsız: dakikada 10, saatte 60 başvuru |
| Başarısız istek sınırı | Dakikada 30 reddedilen istek sonrası form geçici kapanır |
| Kimlik beklemesi | Aynı kimlik numarasıyla 6 saat içinde tekrar gönderilemez |
| Bal küpü | Formda gizli bir alan bulunur; dolduran istek sessizce reddedilir |

**Adres tespiti:** `X-Forwarded-For` başlığı yalnızca istek gerçekten
localhost'tan (IIS) geliyorsa dikkate alınır. Aksi hâlde TCP bağlantısının
kendi adresi kullanılır. Bu başlığa koşulsuz güvenmek, saldırganın her istekte
farklı bir adres uydurup adres bazlı sınırı atlamasına yol açar.

**Fotoğraf yalnızca kamerayla alınır.** Galeriden seçme kaldırıldı; aday
fotoğrafını o anda çekmek zorundadır. Sayfa içi kamera destekleniyorsa
(https bağlantıda) o kullanılır, desteklenmiyorsa telefonun kamera
uygulaması açılır.

Bir sınır: `capture` ayarı yalnızca mobil tarayıcılarda kamerayı zorlar.
Masaüstünde tarayıcı bunu yok sayıp dosya seçici açabilir; bu yüzden sayfa içi
kamera desteklenen ortamlarda o yol tercih edilir. Tam koruma sunucu
tarafındaki fotoğraf ve şablon denetimlerinden gelir.

**Fotoğraf denetimi iki aşamalıdır.** Önce dosyanın gerçek bir görsel olup
olmadığı imzasından anlaşılır (JPEG, PNG veya WEBP başlığı) ve en az 4 KB
olması beklenir — rastgele metin ya da tek renk minik görsel geçmez. Sonra
fotoğrafın SHA-256 özeti alınır ve daha önce **başka bir kimlik numarasıyla**
kullanılıp kullanılmadığı denetlenir. Gerçek aday kendi fotoğrafını bir kez
yükler; aynı görselin farklı kimliklerle gelmesi otomatik gönderim işaretidir.

Reddedilenler günlükte **TEKRAR FOTOĞRAF** olarak görünür.

**Fotoğraf özeti meta veriyi yok sayar.** Otomatik gönderimlerde aynı görsel
her seferinde farklı bir JPEG yorumuyla gönderilerek dosya özeti
değiştiriliyordu; piksel verisi aynı olduğu hâlde özet farklı çıkıyor ve
tekrar denetimi işlemiyordu.

Bu yüzden özet alınırken yorum (FFFE) ve uygulama (FFE0-FFEF) bölümleri
atlanır, yalnızca görüntüyü tanımlayan bölümler özetlenir. Meta veri değişse
de özet sabit kalır.

Eski kayıtların özetleri `POST /api/Basvuru/OzetleriYenile` ile bir kez
yeniden hesaplanmalıdır.

**Formdaki kurallar sunucuda da uygulanır.** Otomatik gönderimler aday
formunu hiç kullanmaz, doğrudan API'ye istek atar; bu yüzden formdaki
zorunluluklar (fotoğraf, KVKK onayı, pozisyon seçimi) tek başına koruma
sağlamaz. Aynı denetimler sunucu tarafında da yapılır. Gönderi boyutu 4 MB
ile sınırlıdır.

**Genel sınır** bu nedenle vardır: saldırgan adres tespitini bir şekilde
atlatsa bile toplam başvuru hızı sınırlıdır.

Her başvurunun geldiği **IP adresi ve tarayıcı bilgisi** kaydedilir
(`gonderen_ip`, `tarayici` kolonları). Yöneticiler bu bilgiyi başvuru
detayında görebilir. Engellenen istekler sunucu günlüğüne yazılır.

Sayaçlar bellekte tutulur; uygulama yeniden başlatıldığında sıfırlanır.

### Engellenen adresler

**Yönetim → Güvenlik Günlüğü** ekranındaki listeye eklenen IP adreslerinden
gelen istekler karşılanmaz; istek daha ilk adımda 403 ile geri çevrilir ve
günlüğe yazılır.

Tek adres (`24.133.13.148`) veya önek (`24.133.13.`) yazılabilir. Önek
yazıldığında o aralıktaki tüm adresler engellenir.

Liste bir dakika önbelleklenir; ekleme ve çıkarmalarda önbellek hemen
boşaltılır. Kendi bağlandığınız adresi engellemenize izin verilmez.

### Ülke denetimi

Başvuru formu ve panel girişi yalnızca **Türkiye'den** erişime açıktır.
Ülke tespiti `ip-api.com` üzerinden yapılır; sonuçlar 12 saat önbelleklenir.

```json
"UlkeDenetimi": {
  "Acik": true,
  "Ulkeler": [ "TR" ]
}
```

`Acik: false` yapıldığında denetim tamamen devre dışı kalır. Ek ülke
gerekirse listeye eklenir.

**Servise ulaşılamazsa istek engellenmez.** Gerçek adayları kesmek, birkaç
sahte kaydın geçmesinden daha kötüdür. Engellenen istekler günlükte
**YURT DIŞI** olarak görünür.

Bu denetim VPN kullanan bir saldırganı durdurmaz; Türkiye çıkışlı vekil
sunucular mevcuttur. Diğer katmanlarla birlikte anlamlıdır.

### Cloudflare Turnstile

Aday formunda, ziyaretçinin gerçek bir tarayıcı kullandığını arka planda
doğrulayan bir bileşen bulunur. Kullanıcıya genelde hiçbir şey sorulmaz.
Otomatik araçlar bu doğrulamayı geçemez.

**Kurulum:**

1. `dash.cloudflare.com` → sol menüden **Turnstile** → **Add widget**
2. Widget adı verin, **Domain** olarak `kariyer.bicen.com.tr` yazın
3. Widget Mode: **Managed** seçin, **Create** deyin
4. Verilen **Site Key** ve **Secret Key** değerlerini sunucudaki
   `appsettings.json` dosyasına yazın:

```json
"Turnstile": {
  "SiteAnahtari": "0x4AAA...",
  "GizliAnahtar": "0x4AAA..."
}
```

5. Uygulamayı yeniden başlatın.

Anahtarlar boş bırakıldığında doğrulama devre dışı kalır; başvurular eskisi
gibi alınır. Cloudflare'e ulaşılamadığında da başvurular durmaz, durum
güvenlik günlüğüne yazılır — gerçek adayları engellememek önceliklidir.

Reddedilen doğrulamalar günlükte **TURNSTILE RED** ve **TURNSTILE EKSİK**
olarak görünür.

**Panel girişinde:** Doğrulama her girişte istenmez; **iki hatalı denemeden
sonra** devreye girer. Böylece günlük kullanımda İK ekibi beklemez, otomatik
parola denemeleri ise kesilir. Altı hatalı denemeden sonra adres zaten 15
dakika kilitlenir. Doğru parolayla giriş yapıldığında sayaç sıfırlanır.

Aynı Cloudflare anahtarı hem aday formu hem panel girişi için kullanılır;
ayrı bir widget oluşturmaya gerek yoktur.

### Diğer güvenlik önlemleri

**Güvenlik başlıkları:** Her yanıtta `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy` ve https üzerinden geliniyorsa
`Strict-Transport-Security` gönderilir.

**CORS kısıtı:** Panelin uçlarını yalnızca `bicen.com.tr` ve alt alanları ile
localhost çağırabilir. Ek adres gerekirse `appsettings.json` içindeki
`Cors:Adresler` listesine yazılır.

**Sorgulama sınırı:** Aday başvuru sorgulaması bir adresten saatte 10 kez
yapılabilir. Sınırsız bırakıldığında kimlik ve telefon deneyerek başkalarının
başvurusuna ulaşmak mümkün olurdu.

**Parola kuralları:** En az 8 karakter, hem harf hem rakam, en az dört farklı
karakter. Sık kullanılan parolalar reddedilir. Parolalar PBKDF2 (SHA-256,
100.000 tur) ile saklanır.

**JWT anahtarı denetimi:** Anahtar varsayılan değerdeyse veya 32 karakterden
kısaysa uygulama açılışında konsola uyarı basar.

### Güvenlik günlüğü

Engellenen başvurular, hız sınırı aşımları ve panel giriş denemeleri
`apiservis/logs/guvenlik-YYYY-AA-GG.log` dosyalarına yazılır ve 30 gün
saklanır. Uygulama IIS altında çalıştığı için konsol günlükleri hiçbir yere
ulaşmaz; bu dosyalar o boşluğu doldurur.

Kayıtlar sunucuya bağlanmadan **Yönetim → Güvenlik Günlüğü** sekmesinden
görüntülenebilir. Ekranda olay türlerine göre özet, en çok işlem yapan
adresler ve tüm kayıtların listesi yer alır. Yalnızca yöneticiler erişebilir.

---

## Test verisi

Test başvurusu üretimi **varsayılan olarak kapalıdır**; canlı sistemde
yanlışlıkla test kaydı oluşturulmasını önlemek için. Kapalıyken menüde "Test
Verisi" bölümü görünmez ve üretim uçları çalışmaz.

Açmak için sunucudaki `appsettings.json` dosyasında:

```json
"TestVerisi": { "Acik": true }
```

Mevcut test kayıtlarını temizleme ve sayma uçları bu ayardan bağımsız çalışır.

---

## Görüşme takvimi

Panel → **Görüşme Takvimi**. Üç kaynak tek ajandada birleşir: başvurudan
oluşturulan görüşme talepleri (`GET /api/Basvuru/GorusmeTakvimi`), elle
oluşturulan görüşmeler (`GET /api/Takvim/Gorusmeler`) ve kişiye özel takvim
notları (`GET /api/Takvim/Notlar`). Renk kaynağı söyler: yeşil başvuru
görüşmesi, mavi elle görüşme, turuncu not. Soluk şerit geçmiş kayıttır.

Üstte dört kutu — bugün, bu hafta, önümüzdeki 7 gün, bekleyen hatırlatma — ve
her biri tıklanınca ilgili görünümü açar. Üç görünüm vardır:

| Görünüm | Ne gösterir |
| --- | --- |
| Ay | Her hücrede saat ve adla ilk üç kayıt, gerisi "+N"; güne tıklayınca gün çekmecesi |
| Hafta | Pazartesi–Pazar yedi sütun, her kayıt saatiyle; bugün yeşil çerçeveli; ileri/geri gezinme |
| Ajanda | Süzülebilir liste: ad/şube/telefon araması, yaklaşan–geçmiş–tümü, kayıt türü, oluşturan uzman; satırda form açma, not yazma, düzenleme ve silme |

Görüşme ve not ekleme artık üst çubuktan da yapılır; gün çekmecesine girmek
gerekmez. Gün çekmecesi eskisi gibi çalışır: o günün başvuru görüşmeleri, elle
görüşmeler ve notlar bir arada.

Veri, görünen ayın bir öncesi ve bir sonrasıyla birlikte çekilir; ajandada bu
aralığın dışı görünmez, takvimde ilerlemek gerekir.

## Görüşme takibi

Görüşme talebi oluşturulan adaylar için panel iki şey yapar:

**Zamanı geçenler için uyarı.** Görüşme saatinin üzerinden 2 saat geçtiği
hâlde başvuru hâlâ "Görüşme Talebi" durumundaysa panelde bir uyarı penceresi
açılır. Pencere **yalnızca görüşmeyi planlayan kişiye** gösterilir; diğer
kullanıcılar bu kayıtları zil simgesinden görür. Pencerede adayın bilgileri, planlanan tarih ve ne
kadar geciktiği görünür. Dört seçenek sunulur:

| Seçim | Sonuç |
|---|---|
| Görüşme yapıldı | Durum "Olumlu" olur |
| Gelmedi · ertele | Yeni görüşme tarihi girilir, durum değişmez |
| Değerlendirmede | Karar ertelenir, durum "Değerlendirmede" olur |
| Olumsuz | Durum "Olumsuz" olur |

**Açıklama her seçimde zorunludur** ve işlem geçmişine yazılır. Birden fazla
geciken görüşme varsa sırayla ele alınır.

Pencere **"Sonra bakarım"** ile kapatılabilir; o gün tekrar açılmaz. Kapatılan
kayıtlar başlıktaki zil simgesinde "Zamanı Geçen Görüşmeler" başlığı altında
görünmeye devam eder.

Zil simgesindeki kartlarda **Sonuçlandır** düğmesi vardır: aynı seçenekler
(görüşme yapıldı, ertele, değerlendirmede, olumsuz) oradan da uygulanabilir.
Böylece görüşmeyi planlayan kişi izinliyse başka bir yetkili müdahale
edebilir. İşlem yetkisi olan tüm kullanıcılar bu düğmeyi görür.

**Yaklaşanlar için hatırlatma.** Önümüzdeki 24 saat içindeki görüşmeler
ekranın sağ alt köşesinde bildirim olarak gösterilir. Bu yalnızca
bilgilendirmedir, işlem gerektirmez.

Kontrol beş dakikada bir tekrarlanır. İki saatlik tolerans, görüşme biraz
uzadığında gereksiz uyarı çıkmasını önler.

---

## Yetki grupları

| Yetki | Yönetici | Gen. Md. Yrd. | İK Yöneticisi | İK Uzmanı | Bölge Koord. | Bölge Müdürü |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Norm kadro düzenleme | ✓ | ✓ | onaya gider | — | — | — |
| Maaş skalası | ✓ | ✓ | — | — | — | — |
| İşe alım onayı | ✓ | ✓ | — | — | — | — |
| İK Performans | ✓ | ✓ | — | — | — | — |
| Yönetim (tamamı) | ✓ | ✓ | — | — | — | — |
| Yönetim (form ayarları) | ✓ | ✓ | ✓ | ✓ | — | — |
| Kimlik bilgileri | ✓ | ✓ | ✓ | ✓ | — | — |
| Bölge seçici | ✓ | ✓ | — | — | ✓ | — |
| Başvuru işlemleri | ✓ | — | ✓ | ✓ | — | — |

**Kimlik bilgileri:** Bölge müdürü ve koordinatör adayın kimlik numarasını,
doğum bilgilerini, adresini ve referanslarını göremez. Ad soyad, telefon,
başvurduğu birim, pozisyon ve ücret talebi görünmeye devam eder. Kimlik
numarası tamamen gizlenmez, son dört hanesi kayıt eşleştirmek için bırakılır.

**Aday havuzu** yalnızca işlem yapan roller ile yönetim kademesinde görünür;
bölge müdürü ve koordinatör bu ekrana erişemez.

**Bölge müdürü** başvuru listesi yerine **özet ekranı** görür: bölgesindeki
görüşme talepleri, evrak aşamasındakiler ve işe alınanlar üç kart hâlinde
özetlenir, karta tıklandığında liste açılır. Havuz, personeller, sirkülasyon
ve raporlar menüsü kendisine gösterilmez.

### Otomatik çıkış

Panelde **bir saat** işlem yapılmazsa oturum kendiliğinden kapanır. Açık
unutulan bir bilgisayarın başkası tarafından kullanılmasını önler.

Süre dolmadan **iki dakika önce** geri sayımlı bir uyarı çıkar; "Devam et"
denildiğinde ya da ekrana dokunulduğunda süre baştan başlar. Fare hareketi,
tuş basımı, dokunma ve kaydırma işlem sayılır.

Sunucudaki oturum belirteci 12 saat geçerlidir; panel daha önce kapattığı için
kullanıcı belirteç hatasıyla karşılaşmaz.

### Kullanıcı olarak görüntüleme

Yönetici ve genel müdür yardımcısı, **Yönetim → Kullanıcılar** ekranındaki
giriş simgesiyle başka bir kullanıcının hesabıyla panele girebilir. Amaç, o
kullanıcının ekranı nasıl gördüğünü doğrulamak ve gerektiğinde onun adına
işlem yapabilmektir. Parola gerekmez.

Kötüye kullanımı önlemek için dört önlem vardır:

- Oturum **bir saatle** sınırlıdır (normal oturum 12 saat).
- İşlem **güvenlik günlüğüne** yazılır: kim, kimin hesabına, ne zaman.
- Bu oturumda yapılan işlemlerde ad soyad **"Ali Veli (Caner Alkan adına)"**
  biçiminde görünür; işlem geçmişinde iz kalır.
- Ekranın üstünde turuncu bir şerit çıkar ve **"Kendi hesabıma dön"** düğmesi
  bulunur.

Taklit oturumundayken yeni bir taklit başlatılamaz ve giriş simgesi görünmez.

### Bölge seçici

Yönetici, genel müdür yardımcısı ve bölge koordinatörü başlıkta bir bölge
seçicisi görür. Varsayılan **tüm bölgeler**dir; seçim yapıldığında tüm
ekranlar yalnızca o bölgelerin verilerini gösterir.

Seçim tarayıcıda saklanır ve her istekte `X-Bolge` başlığıyla sunucuya
iletilir; süzme sunucu tarafında yapılır. Etkilediği ekranlar: başvurular,
aday havuzu, norm kadro, şube ve bölge raporları, raporlar, İK performans,
personeller, sirkülasyon, personel takip ve geri dönenler.

Personel ekranlarında Mikro kayıtları şube kodu taşımadığı için eşleştirme
birim adı üzerinden yapılır.

### Bildirim dağıtımı

**İK uzmanı** yalnızca kendisine tanımlı şubelerin görüşme bildirimlerini
alır. İK yöneticisi ve üstü tüm şubelerin bildirimlerini görür.

**Onay sonuçları** isteği gönderen kişiye bildirim olarak döner: zil
simgesinde "İsteklerinizin Sonucu" başlığı altında onay veya ret bilgisi,
onaylayan kişi ve varsa notu görünür. "Tamam" denildiğinde bildirim kapanır.

---

### İK referansları

Başvuru detayında, form önizlemesinin üstünde **İK Referansları** bölümü
bulunur. Görüşme sırasında adaydan alınan referanslar buraya işlenir; adayın
formda yazdığı referanslardan ayrıdır ve sayı sınırı yoktur.

Her referans için: ad soyad, birlikte çalıştığı yer, görevi, telefon ve adayla
ilişkisi (eski yöneticisi, mesai arkadaşı gibi).

**Referans görüşmesi** ayrıca kaydedilir: sonuç (olumlu, çekimser, olumsuz,
ulaşılamadı) ve serbest metin görüşme notu. Sonuç seçildiğinde referans
görüşülmüş sayılır ve tarih kendiliğinden atanır.

Kartın başlığında kaç referansın görüşüldüğü görünür; satırların solundaki
renk şeridi sonucu gösterir. Referans ekleme ve düzenleme, işlem yetkisi olan
kullanıcılara açıktır.

### Geçmiş başvuru formları

Aynı kimlik numarasıyla birden fazla başvuru yapılmışsa, başvuru detayında
sarı bir uyarı kutusunda önceki başvurular listelenir. Her kaydın yanında
**Başvuru formunu gör** bağlantısı bulunur; o dönemki formun tamamı ayrı bir
çekmecede açılır.

İşe alınmış eski başvurularda giriş tarihi ve anlaşılan ücret de görünür.
Kimlik bilgilerini görme yetkisi olmayan kullanıcılarda eski formların özel
alanları da gizlenir.

---

### Rol menü ayarı esastır

Bir rol için Rol Yetkileri'nde menü işaretlenmişse panel menüsü **tüm
katalogdan yalnızca işaretlenenlerle** kurulur (`App.tsx` → `katalog`);
koddaki rol kapıları devreden çıkar. Hiçbir menü işaretli değilse koddaki
varsayılan menüler görünür. Önceden ayar yalnızca daraltabiliyordu: koddaki
kapı önce çalışıyor, ayarda işaretlenen ama kapının vermediği menü (bölge
koordinatörüne Aday Havuzu gibi) hiç görünmüyordu. İnceleme ve Erişim
Denetimi yalnızca Yönetici'de açılır, ayarla verilemez. Sunucu tarafındaki
uç yetkileri değişmedi; ayarla açılan sayfa sunucuda kapalıysa boş gelir.

Yeni bir sayfa eklerken `katalog` listesine de yazın; yoksa ayarla
verilemez.

### Mobil yetkiler tek yerden: Biçen360

Mobil uygulamadaki bütün modüllerin yetkisi **portal → Yetkiler** ekranından
veriliyor; İK panelindeki "Mobil Modüller" sekmesi kaldırıldı. Alt menü
seçimi de aynı ekranda.

İki katman: **grup → kişiye özel istisna**. Yetki pozisyon grubunda
tanımlanır; bir ünvan yalnızca bir grupta olabilir (sunucu çakışmayı
reddeder). Kişiye özel satır yalnızca gruptan farklı olduğunda yazılır —
gruptakiyle aynı değer kaydedilmez, grup değiştiğinde kişi sessizce geride
kalmasın. Eskiden araya ünvan katmanı giriyordu ve aynı pozisyona üç ayrı
yerden yetki verilebiliyordu; eski ünvan satırları tabloda dursa da artık
okunmuyor.

Hiçbir grupta tanımı olmayan modül açıktır. Tek istisna Haftalık İzin
Onayı: tanımsızken yalnızca ünvanında "müdür" geçip "yardımcı" geçmeyenlere
açılır.

Sütunlar üç kümeye ayrılmış: mağaza modülleri (ekranı portal servisinde),
özlük modülleri (ekranı Kariyer servisinde) ve kapsam yetkileri ("· yönetici"
ile bitenler; menüde satır değil, kişinin kendi şubesi yerine bütün kurumu
görmesini sağlıyor).

Eşleştirme sadeleştirilmiş anahtarla yapılıyor: ünvan adındaki boşluk,
noktalama, Türkçe harf ve büyük-küçük harf farkları eleniyor. Tam metin
karşılaştırması yüzünden verilen yetki mobilde sessizce uygulanmıyordu.

Yetkiler ekranı iki bölüm: **Mobil uygulama yetkileri** (Gruplar ·
Kişiye özel · Alt menü) ve **Panel yetkileri** (Rollere göre · Kişiye özel).
Kişiye özel sekmesinde personel sicil ya da adla aranıyor; grubundan gelen
her yetki, kişiye özel istisnası ve sonuç yan yana görünüyor.

### Grup ayarları: sorumluluk, kapsam, onay

Modül yetkisi "bu ekranı görür mü" sorusunu cevaplıyor. **Grup ayarı**
(Yetkiler → Gruplar → gruba tıkla) "görünce neyi görür, kimden sorumlu,
hangi talebi onaylar" sorusunu. Tablo: `B360_GRUP_AYAR` (grup kimliğine
bağlı, JSON).

- **Kimlerden sorumlu:** başka gruplar. İzin onayları buna göre düşüyor.
- **Arıza / Envanter kapsamı:** kendi · şube · sorumlu bölgeleri ·
  departmanları · bütün kurum. Tanımsızsa modülün eski kuralı.
- **Haftalık izin onayı:** aynı şubede, sorumlu olduğu gruplardaki
  personelin gün seçimi.
- **Yıllık izin kademesi:** 1. kademe mağaza (aynı şube) → 2. kademe
  bölge (mağaza onayından sonra, sorumlu bölgeler) → İK son onay (panel).
  Panel ve mobil aynı karar yordamını (`KararIsle`) kullanıyor.

Bölge kapsamı kişi başına atanıyor (`B360_KISI_BOLGE`, Yetkiler → Kişiye
özel → Sorumlu bölgeleri); atama yoksa kişinin kendi şubesinin bölgesi.
Bölge → şube eşlemesi İK ayarındaki bölge tanımlarından okunuyor.

Grubun ayarı kaydedildiğinde izin onayları yalnızca o ayara göre çalışır;
ayar yoksa eski ünvan kuralı ("müdür" geçip "yardımcı" geçmeyen) geçerli.

### Roller panelden açılır

Yedi rol koddadır (`Roller.Sabitler`); her birinin sunucuda ayrı kuralları
vardır (onay, bölge sınırı, salt okunurluk). Bunlara ek olarak **Yönetim →
Rol Yetkileri → Rolleri Yönet** ile yeni rol açılabilir.

Her özel rol bir **temel rol** seçer ve o rolün sunucu tarafındaki
davranışını devralır: veri kapsamı, işlem yetkisi, gizlenen alanlar. Rolü
asıl ayıran şey Rol Yetkileri'ndeki menü, alan ve sekme seçimidir. Yönetici
temel alınamaz — aksi hâlde panelden tam yetkili rol üretilebilirdi.

Nasıl çalışıyor:

- Tanımlar `FORM` ayarındaki `ozelRoller` listesinde durur
  (`kod`, `ad`, `temel`, `aciklama`).
- `Roller.OzelRolleriYukle` bunları belleğe alır; `AyarServisi.FormOku`
  her okumada tazeler, açılışta `Program.cs` bir kez yükler.
- Bütün yetki metotları `Roller.Temel(rol)` üzerinden çalışır.
- Jetona iki rol hakkı yazılır: rolün kendisi ve temeli. Böylece
  `[Authorize(Roles=…)]` süzgeçleri sabit adları aramaya devam eder,
  ekranlarda görünen ad ise özel rolündür.
- Kullanıcısı olan rol silinemez; silinen rolün yetki kaydı da temizlenir.

Rol kodu kaydedildikten sonra değiştirilmemeli: kod kullanıcıların
jetonunda taşınıyor ve ayardaki yetki kaydının anahtarı.

Rol Yetkileri ekranı yeniden düzenlendi: roller kart olarak (kaç menü, salt
okunur, kaç gizli alan), menüler dört grupta (İşe alım / Personel / Raporlar
ve performans / Yönetim) grup bazında hepsi–hiçbiri ile. Kullanıcılar
listesine arama, rol süzgeci ve aktif/tümü anahtarı eklendi; ad ve iletişim
sütunları birleştirildi, pasif kullanıcılar soluk gösterilir.

## Onay süreci

Üç işlem yetkili onayına gönderilir ve başlıktaki **zil** simgesinde toplanır.
Her kayıtta işlemin türü (İşe Alım / Norm Kadro / Rotasyon) renkli bir
etiketle ve özetiyle görünür.

| Tür | Ne zaman | Reddedilirse |
|---|---|---|
| İşe Alım | İşe alım bilgileri kaydedildiğinde | Başvuru "Evrak Hazırlanıyor" durumuna döner |
| Norm Kadro | Norm sayısı değiştirildiğinde | Eski norm değerlerine dönülür |
| Rotasyon | Adayın birimi değiştirildiğinde | Aday eski birimine geri alınır |

Norm kadro ve rotasyon işlemleri hemen uygulanır; onay bir teyit adımıdır.
İşe alımda ise durum onaylanana kadar "Onay Bekliyor" olarak kalır.

Onay bekleyen kayıtlar zaman sınırı olmadan listede durur; onaylanana veya
reddedilene kadar kaybolmazlar.

### İşe alım akışı

1. İK uzmanı **İşe Al** ekranında bilgileri girer (giriş tarihi, birim,
   pozisyon, anlaşılan ücret, yol ücreti) ve kaydeder.
2. Başvuru **Onay Bekliyor** durumuna geçer.
3. Onay yetkisi olan bir kullanıcı, başlıktaki **zil** simgesinden bekleyen
   kayıtları görür ve onaylar ya da reddeder.
4. Onaylanınca durum **İşe Alındı** olur. Reddedilirse **Evrak Hazırlanıyor**
   durumuna döner; bilgiler düzeltilip yeniden gönderilebilir. Reddetme
   sebebi zorunludur ve işlem geçmişine yazılır.

Onay ekranında adayın **ücret talebi ile anlaşılan ücret** yan yana görünür;
aradaki fark renkle işaretlenir.

**Yetki tanımı:** Yönetim → Kullanıcılar ekranında kullanıcı düzenlenirken
"İşe alım onaylayabilir" seçeneği işaretlenir. Yöneticiler bu yetkiye
kendiliğinden sahiptir. Yetkisi olmayanlar listeyi görebilir ancak işlem
yapamaz.

---

## Raporlar

Raporlar sayfası üç sekmeden oluşur: **Başvuru İstatistikleri**,
**Günlük Geçiş** ve **Personel Başı Ciro**.

### Sayfa düzeni

Raporlar üç sekmedir: Başvuru İstatistikleri, Günlük Geçiş, Personel Başı
Ciro. Başvuru İstatistikleri tek sayfada, üstten aşağı yedi bölümdür ve her
bölümün başında yeşil çizgili aynı biçimde bir başlık vardır
(`RaporBolumu`): Genel bakış · Yönetim özeti · Aylık dağılım · Şubeler ·
Bölümler ve ilçeler · Norm kadro · İşe alınanlar. Süzgecin altındaki hızlı
geçiş düğmeleri ilgili bölüme kaydırır (masaüstünde yapışkan).

**Yönetim özeti** bölümü Yönetim Raporu'nun aylık göstergelerini bu
sayfaya taşır (`YonetimOzeti`): dönemin son ayı için
`GET /api/YonetimRaporu?yil&ay` çekilir; beş kutu (gelen başvuru, onay
isteği, ciro büyümesi, geçiş hareketi, çıkış mülakatı) ve üç küçük tablo
(onay türleri, çıkış nedenleri, kart okutma oranı en düşük altı şube).
Ayrıntı için Yönetim Raporu sayfası.

### Günlük okutma raporu maili

Her gün saat 10:00'da bir önceki günün raporu otomatik gönderilir:

- **Bölge müdürlerine** yalnızca kendi bölgelerinin raporu (kullanıcı
  kaydındaki bölge ve e-posta alanları kullanılır)
- **İK ve yönetim adreslerine** tüm şubeleri kapsayan rapor

Ayarlar `appsettings.json` içindedir:

```json
"OkutmaRaporu": {
  "Acik": true,
  "Saat": 10,
  "GenelAlicilar": [ "ik@bicen.com.tr", "..." ]
}
```

**IIS uygulama havuzu ayarı gereklidir.** Arka plan görevi yalnızca uygulama
çalışırken işler. IIS varsayılan olarak trafik gelmeyince havuzu durdurur ve
gece boyunca istek olmadığı için sabah 10:00'da görev çalışmaz.

Bunu düzeltmek için IIS Yöneticisi → Application Pools → ilgili havuz →
Advanced Settings:

| Ayar | Değer |
|---|---|
| Start Mode | AlwaysRunning |
| Idle Time-out (minutes) | 0 |
| Regular Time Interval (minutes) | 0 |

Ayrıca site için **Preload Enabled = True** yapılmalıdır
(Sites → site → Advanced Settings).

Son gönderim zamanı veritabanında saklanır; uygulama yeniden başlasa bile
aynı gün iki kez mail gitmez.

Mail mağaza düzeyinde özet verir; personel adları panelde kalır. İçerik:
okutma oranı ve hedefe uzaklık, hiç okutmayan mağazalar ve kaç gündür
okutmadıkları, orana göre sıralı mağaza listesi, düne göre değişim ve en çok
gelişen mağazalar.

**Elle gönderim:** Raporlar → Günlük Geçiş ekranındaki mail düğmesinden
istenen tarih aralığı, bölge ve alıcılarla rapor yeniden gönderilebilir.
"Önizle" ile gönderilecek mailin tamamı ekranda görülebilir.

### Günlük geçiş raporu

Seçilen günde QR okutan ve hiç okutmayan çalışan personeli mağaza bazında
gösterir. Üstte genel okutma oranı, altında her mağaza için kart: okutan
sayısı, doluluk çubuğu ve okutmayan kişi sayısı. Okutmayanı olan mağazaların
sol şeridi kırmızıdır.

Mağaza kartına tıklandığında sağdan çekmece açılır ve o birimin **tüm**
personeli listelenir: durum etiketi, ilk giriş, son çıkış ve hareket sayısı.
Okutmayan satırlar kırmızı zeminle vurgulanır. Çekmecedeki seçimle yalnızca
okutmayanlara süzülebilir.

"Çıkış eksik" etiketi, girişi olan ama çıkışı okutulmamış personeli
işaretler.

**Önemli:** Okutmayan her personel devamsız değildir — izinli olabilir,
telefonu yanında olmamış ya da okutmayı atlamış olabilir. Rapor bunları ayırt etmez.
Yıllık izin kayıtlarıyla birlikte değerlendirilmelidir.

Liste CSV olarak dışa aktarılabilir.

### Personel başı ciro verimliliği

Şubelerin günlük ortalama cirosu hem mevcut personele hem norm kadroya
bölünerek gösterilir. İki oran arasındaki fark, kadronun ne kadar dolu
çalıştığını ortaya koyar.

**Veri kaynağı:** Ciro Mikro V15'ten okunur
(`hmz_stok_hareket1`, `Satis_Tutar + Satis_Kdv`, depo kırılımında). Bu
veritabanı personel veritabanından farklı bir portta olduğu için ayrı bağlantı
tanımlıdır: `ConnectionStrings:Ciro`.

**Şube eşleştirmesi:** Mikro'daki `DEPO` alanı numara değil şube adı taşır
("ADAKENT", "BAKIRKÖY-2"). Sistemdeki şube adlarıyla karşılaştırmak için her
iki ad sadeleştirilir: Türkçe karakterler, büyük/küçük harf farkı, tire ve
boşluklar ile "şube/mağaza" ekleri temizlenir. Eşleşmeyen depolar yanıtta
`eslesmeyenDepolar` alanında döner.

**Karşılaştırma dönemi** seçilebilir:

| Seçim | Kıyaslanan dönem |
|---|---|
| Geçen hafta | 7 gün öncesi (haftanın günü korunur) |
| Önceki dönem | Hemen önceki eşit uzunluktaki aralık |
| Geçen ay | Bir ay öncesinin aynı günleri |
| Geçen yıl | Bir yıl öncesinin aynı günleri |
| Özel tarih | Elle girilen aralık |
| Karşılaştırma yok | Kıyas sütunları gizlenir |

Tabloya "Önceki" ve "Değişim %" sütunları eklenir; artış yeşil, düşüş kırmızı
gösterilir. CSV çıktısına da yansır.

**Okuma kılavuzu:** Kişi başı sütunlarındaki büyük değer **günlük ortalamadır**
(dönem toplamı ÷ gün sayısı ÷ personel). Altındaki küçük yazı aynı kişinin
dönemin tamamında ürettiği ciroyu gösterir. Farklı uzunluktaki dönemleri
kıyaslayabilmek için ana ölçüt günlük tutulur.

**Değişim yüzdesi kişi başı değer üzerinden hesaplanır**, ham ciro üzerinden
değil. Kıyas dönemi için o tarihte geçerli olan norm ve mevcut kullanılır
(`KRY_KADRO_GECMIS` tablosundan). Böylece ciro artmış ama personel daha da
artmışsa verimlilik düşüşü görünür. Kadro değişmediyse iki yüzde aynı çıkar.

Değişim sütunu seçilen ölçütü izler: "Mevcut" seçiliyse mevcut başı, "Norm"
seçiliyse norm başı değişimi gösterir.

**Örtüşme uyarısı:** Kıyas dönemi seçilen dönemle çakışıyorsa ekranda sarı bir
uyarı çıkar ve kaç gün örtüştüğü yazar. Hazır dönem etiketlerinden 30 veya 90
gün seçildiğinde kıyas ölçütü kendiliğinden "Önceki dönem"e geçer.

**Geriye dönük norm:** Norm kadroda yapılan her değişiklik
`KRY_KADRO_GECMIS` tablosuna tarihiyle yazılır. Geçmiş bir dönem
sorgulandığında, o tarihten sonra yapılan değişiklikler geri alınarak o
dönemde geçerli olan norm kullanılır. Böylece bugün normu değiştirmek geçmiş
raporları bozmaz.

Sayfa açıldığında **bir gün öncesi** filtrelenir; günlük takip için en sık
bakılan aralık budur. Üstteki etiketlerden 7, 30 veya 90 güne geçilebilir,
tarih aralığı serbestçe de seçilebilir (en fazla 400 gün).

Üstteki ilk kutuda **seçilen aralığın toplam cirosu** görünür; altında günlük
ortalama ve varsa önceki döneme göre değişim yer alır. Şube satırlarında da
aralık birden fazla günse dönem toplamı ikinci satırda yazılır.

Kişi başı değerler her zaman **günlük ortalamadan** hesaplanır; dönem toplamı
farklı uzunluktaki aralıklar arasında kıyas yapmayı bozmasın diye.

**İki ölçüt** hesaplanır:

| Ölçüt | Hesap |
|---|---|
| Genel kişi başı | Mağaza ciroları ÷ **şirketin tüm personeli** (genel müdürlük, lojistik depo, hal dahil) |
| Mağaza kişi başı | Mağaza ciroları ÷ **yalnızca mağaza personeli** |

Ciro yalnızca mağazalardan gelir; merkez birimler ciro üretmez ama o cironun
parçasıdır. İkisi arasındaki fark merkez personelinin yüküdür.

Listenin başında iki sabit satır bulunur: **GENEL KİŞİ BAŞI** ve
**MAĞAZA KİŞİ BAŞI**. Bunlar şubelerin ortalaması değil, toplam ciro ÷ toplam
personeldir — büyük şubeler doğal olarak ağırlıklı olur. Renkler genel ortalamaya göredir.

**Dışa aktarma** indirme düğmesinden yapılır: Excel (biçimlendirmeli), CSV,
PDF ve görsel. PDF ve görsel çıktısında özet kutuları da yer alır; tablo
kaydırma çubuğu olmadan tam genişlikte basılır.

---



### Şube Norm Kadro ve Personel İhtiyacı

Tablo şube bazında özetlenir: her satırda birimin toplam eksiği, fazlası, açık
pozisyonları ve dönemde işe alınan sayısı yer alır. Satır açıldığında o
birimin pozisyon kırılımı görünür; pozisyona tıklandığında o pozisyona gelen
başvurular listelenir.

Üstteki **Sorunlular / Eksik / Tümü** seçimiyle hangi birimlerin listeleneceği
belirlenir. Varsayılan "Sorunlular"dır: yalnızca eksiği veya norm üstü
personeli olan birimler görünür, kadrosu tam olanlar listeyi doldurmaz.

Sol menüden erişilir. Seçilen tarih aralığı için:

- **Genel özet** — durum bazında başvuru sayıları
- **Dönüşüm oranları** — kaç başvurudan kaçı görüşmeye çağrıldı, kaçı olumluya döndü
- **Aylık dağılım** — sütun grafikte toplam ve olumlu sonuçlanan başvurular
- **Şube kırılımı** — hangi şubeye kaç başvuru geldi, olumlu oranı nedir
- **Bölüm kırılımı** — pozisyon bazında başvuru sayısı ve kadro hedefiyle karşılaştırma
- **İlçe dağılımı** — adayların geldiği ilk 15 ilçe
- **İşe alınanlar** — dönemde işe alınan adaylar; birim, pozisyon ve işe giriş
  tarihiyle birlikte, formuna erişimli
- **Şube norm kadro ve personel ihtiyacı** — birim ve pozisyon bazında norm,
  mevcut, ihtiyaç, gelen başvuru, havuzdaki aday ve işe alınan sayıları.
  Satıra tıklandığında o birim ve pozisyona gelen başvurular listelenir;
  yönetime sunum yaparken doğrudan kullanılabilir.

Ayrıca **hiç başvuru almayan şubeler** ve **hiç başvuru gelmeyen bölümler** ayrı
ayrı listelenir. Birincisi o şubedeki QR kodun görünmediğine, ikincisi o
pozisyon için ilan verilmesi gerektiğine işaret eder.

Şube ve bölüm tabloları Excel'e aktarılabilir. Üstteki özet kutuları
tıklanabilir: örneğin "İşe Alındı" kutusuna tıklandığında o durumdaki
başvurular listelenir ve formları açılabilir.

### Bölge Raporu

Norm kadro durumunu birim türü (Şubeler, Merkez, Depo) ve bölge bazında
özetler. Sütunlar: G.M. norm, mevcut çalışan, normun %2'si kadar kabul
edilebilir eksik, eksik personel, fazla personel, toplam sorun (eksik + fazla)
ve maliyet.

Maliyet şöyle hesaplanır:

```
maliyet = (fazla personel − eksik personel) × kişi başı maliyet
```

Kişi başı maliyet ekranın üstünden değiştirilebilir (varsayılan ₺35.000) ve
tarayıcıda saklanır. Eksik personel, normun %2'sini aşarsa hücre kırmızıya
döner.

Bölge satırlarında o bölgeden sorumlu personelin adı da görünür; bu bilgi
kullanıcı kayıtlarındaki bölge alanından gelir.

**Günlük bilgilendirme mesajı** aynı sekmenin altında hazır metin olarak
üretilir: norm, mevcut, eksik, fazla, engelli kadro, fazla personel dökümü ve
birim bazında çalışan sayıları. Metin düzenlenebilir; tek tuşla panoya
kopyalanır veya WhatsApp'ta açılır.

---

### Şube raporu Excel çıktısı

Raporlar → Şube Bazında Başvurular → **Excel** artık .xlsx üretir
(`raporExcel.ts`, exceljs). Üç sayfa:

1. **Şube Raporu** — bölgeye göre gruplanmış, bölge ara toplamlı ve genel
   toplamlı okunur rapor: koyu yeşil başlık, şeritli satırlar, Olumlu
   Oranı sütununda kırmızı→sarı→yeşil renk ölçeği, Başvuru sütununda veri
   çubuğu, dondurulmuş başlık, süzgeç. Toplamlar SUBTOTAL ile; süzgeç
   uygulanınca kendiliğinden güncellenir.
2. **Veri** — satır başına bir şube, "SubeVerisi" adlı Excel Tablosu.
   Pivotun kaynağı; kullanıcı buradan kendi pivotunu da kurabilir.
3. **Pivot** — Bölge › Şube satırlarında beş toplamla gerçek bir Excel
   PivotTable. exceljs pivot üretemediği için dosya yazıldıktan sonra
   OpenXML parçaları (pivotCacheDefinition, pivotTable, ilişkiler, içerik
   türleri) elle eklenir; önbellek `refreshOnLoad` ile işaretlidir, Excel
   açılışta kendisi hesaplar. Excel açılışta onarım isterse
   `raporExcel.ts` içindeki `PIVOT_EKLE` kapatılır; ilk iki sayfa ondan
   bağımsızdır.

`GET /api/Rapor` şube kırılımı artık `bolge` (Form Ayarları'ndaki bölge
tanımından; tanımsızsa "Tanımsız") ve `iseAlindi` alanlarını da döner.

## Aday havuzu

Sol menüden erişilir. Durumu **Olumlu** yapılan başvurular bu ekrana düşer.

Havuz, **Norm Kadro ekranından bağımsız** çalışır ve kendi ihtiyaç tanımlarını
tutar. Her pozisyon bir kart olarak görünür; kartın içinde bölgeler yan yana
dizilir ve her bölge için "aday / ihtiyaç" sayısı, doluluk çubuğu ve bağlı
mağaza sayısı gösterilir. Bir bölge kutusuna tıklandığında o bölgedeki adaylar
açılır.

### İhtiyaçların belirlenmesi (yalnızca yönetici)

Ekranın sağ üstündeki **Bölgeler** düğmesi iki sekmeli bir pencere açar:

- **Pozisyon İhtiyaçları** — hangi bölgede hangi pozisyondan kaç kişiye ihtiyaç
  olduğu satır satır girilir (örneğin Bakırköy Bölgesi · Kasiyer · 10).
  Havuz kartları bu sayılara göre oluşur.
**Havuz mantığı:** Buradaki sayılar işe alım ihtiyacı değil, **havuzda
beklemesi istenen aday sayısıdır**. "Küçükçekmece bölgesinde 10 kasiyer adayı
hazır bulunsun" gibi. Olumlu değerlendirilen adaylar bu havuza düşer ve işe
alınana kadar bekler.

Ekran bölge merkezlidir: her kart bir bölgeyi gösterir, kartın içinde o
bölgenin pozisyonları liste hâlinde sıralanır. Pozisyon satırına tıklandığında
o pozisyonda bekleyen adaylar açılır. Satırın solundaki renk şeridi doluluğu
gösterir: kırmızı hiç aday yok, sarı hedefin altında, yeşil hedef tamam.

Her pozisyonun yanında son 90 günde o pozisyona **kaç kişi işe alındığı** da
görünür.

**Hedefi tanımlanmamış pozisyonlar:** Bir aday olumlu değerlendirildiği hâlde
seçtiği pozisyon için havuz hedefi girilmemişse, o pozisyon bölge kartına
kendiliğinden eklenir ve mor "hedef tanımsız" etiketiyle işaretlenir. Böylece
aday listeden düşmez. Hedef girildiğinde satır normal görünüme döner.

Yalnızca **bölgesi belirlenemeyen** adaylar ayrı bir bölümde toplanır: bunlar,
başvurduğu mağaza hiçbir havuz bölgesine bağlı olmayan adaylardır. Bölüm
başında hangi mağazalardan geldikleri özetlenir.

Üstteki **Havuzdaki Aday** kartına tıklandığında havuzdaki tüm adaylar tek
listede görüntülenir.

**Hedefleri kopyalama:** Havuz penceresindeki **Hedefleri Kopyala** sekmesi,
bir bölgenin tüm pozisyon hedeflerini seçilen bölgelere aktarır. Aynı pozisyon
yapısı birden çok bölgede geçerliyse hedefleri tek tek girmek gerekmez.

"Mevcut hedeflerin üzerine yaz" işaretlenmezse hedef bölgede zaten tanımlı
pozisyonlara dokunulmaz, yalnızca eksikler eklenir.

- **Havuz Bölgeleri** — bölge adı yazılır ve o bölgeye bağlı mağazalar
  seçilir. Bu bölgeler **yalnızca Aday Havuzu için** geçerlidir; Form
  Ayarları'ndaki yönetsel bölgeleri (1. Bölge, 2. Bölge…) etkilemez ve
  onlardan etkilenmez. Adayların oturduğu yere göre serbestçe gruplanabilir:
  "Küçükçekmece tarafı", "Esenyurt tarafı" gibi.

  Liste boş başlar. Kolaylık olsun diye tek tuşla şirket bölgeleri
  kopyalanabilir; kopyalandıktan sonra üzerinde yapılan değişiklikler
  yalnızca havuzu etkiler.

İhtiyaç tanımı olmayan pozisyonlara başvuran olumlu adaylar, ekranın altındaki
"Kadro Planı Dışındaki Adaylar" başlığında toplanır.

---

### Havuzdan çıkarma

Havuzdaki adayın yanındaki çıkarma düğmesi yalnızca **İK yöneticisi** ve
**yönetici** rollerinde görünür; sunucu (`POST /api/Havuz/Cikar/{id}`) da
aynı rolleri ister. Çıkarırken adayın **döneceği başvuru durumu** seçilir
(Yeni, İncelendi, Değerlendirmede, Görüşme Talebi, Olumsuz) ve **not
zorunludur**. Aday havuzdan düşer, başvuru o durumla Başvurular sayfasına
döner ve hareket geçmişine "Havuzdan çıkarıldı: <not>" yazılır.

Başvurular listesinde ve detayında bu kayıtlar **havuzdan döndü** rozetiyle
görünür; üzerine gelince tarih, kim çıkardığı ve not okunur. Detayda ayrıca
sarı bir uyarı kutusu vardır. Aday yeniden Olumlu'ya alınırsa çıkış izi
silinir ve havuza geri girer; rozet kalkar.

### Açık pozisyonlar için öneriler

Havuz sayfasının en üstünde, `GET /api/Havuz/Oneriler` ile beslenir. Norm
kadrosu eksik olan her pozisyon için iki kaynak taranır: o pozisyona başvurmuş
ve hâlâ havuzda olan adaylar, ve aynı öneri grubunda (grup yoksa aynı bölgede)
o pozisyonda fazlası olan mağazalar. Öneri karar değil, hatırlatmadır.

Ekran üç katmandır:

1. **Özet şeridi** — açık pozisyon sayısı, toplam eksik kişi, havuzdan adayı
   olan pozisyon sayısı, rotasyonla kapanabilecek pozisyon sayısı. Son iki
   kutu tıklanınca tabloyu o kaynağa göre süzer.
2. **Tablo** — satır başına bir açık pozisyon: mağaza, pozisyon, eksik
   (norm/mevcut), havuzdan ilk iki aday (yeşil nokta aynı şube, mavi nokta
   aynı bölge), en iyi rotasyon seçeneği. Arama, pozisyon ve kaynak süzgeci
   var; en çok eksik üstte.
3. **Ayrıntı çekmecesi** — satıra tıklayınca adayların tamamı telefon ve
   yakınlık bilgisiyle listelenir; her satırda Görüşme / Evrak / İşe al
   düğmeleri onay sorarak `POST /api/Basvuru/{id}/Durum` çağırır. Altında
   rotasyon seçenekleri ve her mağazanın fazlasının açığın yüzde kaçını
   kapattığı görünür. Durum değişince liste ve açık çekmece kendiliğinden
   tazelenir.

Eski tasarımda her pozisyon ayrı bir kartta alt alta diziliyor, 34 mağazada
sayfa uzayıp gidiyordu ve tek aday için ayrı pencere açmak gerekiyordu.

## Başvuru akışı

1. Aday şubedeki QR kodu okutur → `http://sunucu:5179/?sube=SEFAKOY`
2. Formu doldurup gönderir; şube alanı QR'dan otomatik seçilir
3. Başvuru veritabanına yazılır, İK adreslerine **mail gider**, adaya
   "başvurunuz alındı" bilgilendirmesi gönderilir
4. Aday doldurduğu formu basılı BİK-001 düzeninde görür, yazdırabilir
5. Aday `#/sorgula` adresinden kimlik no + telefon ile başvurularını izler
6. İK panelde başvuruyu inceler: **Değerlendirmede**, **Görüşme Talebi**,
   **Olumlu** veya **Olumsuz** durumuna alır. Başvuruya dahili not ekleyebilir;
   notlar yalnızca panel kullanıcılarına görünür, adayın sorgulama ekranına
   hiçbir şekilde yansımaz.
7. Görüşme talebinde tarih, yer ve not girilir; adaya davet maili gönderilir.
   Maildeki "Önemli Not" bu ekranda yazılan nottur. Mailin altında görüşmeyi
   planlayan personelin ünvanı, adı ve telefonu imza olarak yer alır; bu
   bilgiler kullanıcının **Profilim** ekranından girilir.
8. Tüm işlemler başvuru geçmişinde kullanıcı ve tarih ile saklanır

---

## Güvenlik notları

- İK paneli `/panel` yolunda yayınlanır ve **girişsiz kullanılamaz**. Giriş
  ekranında IP başına 15 dakikada en fazla 6 hatalı deneme kabul edilir,
  sonrasında adres 15 dakika kilitlenir.
- Paneli yalnızca ofis IP'nizden erişilebilir yapmak isterseniz
  `araclar/panel-web.config` dosyasındaki `ipSecurity` bloğunun yorumunu
  kaldırıp IP adresinizi yazınız. Bu, panele dışarıdan hiç ulaşılamamasını
  sağlar ve en güçlü korumadır.
- Panel klasörüne arama motorlarını engelleyen başlıklar otomatik eklenir.
- Panelin (5178) ve API'nin (5177) dışarıya açılmaması, yalnızca şirket ağından
  erişilebilmesi için güvenlik duvarı kuralı tanımlayınız. Adaylar internetten
  erişecekse yalnızca 5179 portu yayınlanmalıdır.
- `appsettings.json` içindeki `Jwt:Anahtar` değerini kuruluma özel, uzun ve
  rastgele bir metinle değiştiriniz.
- Yayına alırken `npm run build` çıktısını (`dist`) IIS veya nginx altında
  yayınlayınız; Vite geliştirme sunucusu kalıcı kullanım için uygun değildir.

---

## Veritabanı tabloları

| Tablo | İçerik |
|---|---|
| `KRY_BASVURULAR` | Başvurunun özeti + tam formu `veri_json` alanında |
| `KRY_BASVURU_HAREKET` | Durum değişiklikleri, kim ne zaman yaptı |
| `KRY_BASVURU_NOT` | Dahili notlar (yalnızca panel kullanıcılarına görünür) |
| `KRY_KADRO` | Açık pozisyon hedefleri (bölüm, şube, kişi sayısı) |
| `KRY_KULLANICILAR` | Panel kullanıcıları (ad soyad, ünvan, telefon; PBKDF2 ile hashlenmiş parola) |
| `KRY_AYARLAR` | Mail ve form ayarları (JSON) |

Tablolar `biPortal` veritabanı içinde `KRY_` önekiyle tutulur; portalın
mevcut tablolarına dokunulmaz.

Form yapısı `veri_json` alanında saklandığı için, panelden yeni bir alan veya
seçenek eklendiğinde veritabanı şemasında değişiklik gerekmez.

## Oryantasyon Takip — İşe Uyum ve Geribildirim raporlaması

Panel → **Oryantasyon Takip** sayfası altı sekmeden oluşur. İlk sekme günlük
iştir, kalan beşi raporlamadır ve hepsi aynı iki uçtan beslenir:
`GET /api/Uyum/Rapor` ve `GET /api/Uyum/Karneler`.

| Sekme | Ne gösterir |
| --- | --- |
| Takip Listesi | Dönemi gelen personelin aranması, görüşme notu girişi, test ve toplu gönderim |
| Pano | Genel durum kutuları, aşama bazında tamamlanma, aksiyon bekleyenler |
| Çalışan Karneleri | Kişi bazında dört aşamanın puanları, risk skoru, karne ayrıntısı |
| Mağaza & Yönetici | Mağaza kırılımı ve yönetici karşılaştırması, erken ayrılma oranı |
| Trend & Analiz | Memnuniyet trendi, gelişim alanları, ayrılma ilişkisi, açık uçlu derleme |
| İcra Kurulu | Yönetime sunulacak tek sayfalık özet, yazdırılabilir |

### Aşamalar ve gönderim

Dört aşama vardır: 7. gün, 2. ay, 6. ay, 1. yıl. Sayım Personel
Listesi'ndeki **çalışma süresi** ile aynıdır (giriş günü 0, ertesi gün 1;
`UyumAnaliz.KacinciGun`):

| Aşama | Kime gider |
| --- | --- |
| 7. gün | çalışma süresi tam **7 gün** olanlar |
| 2. ay | çalışma süresi tam **55 gün** olanlar |
| 6. ay | 170.–180. gün |
| 1. yıl | 355.–365. gün |

Bunlar varsayılandır; **Yönetim → Form Ayarları → İşe Uyum Anketi Aşama
Pencereleri** bölümünden düzenlenir (`FormAyarlari.UyumPencereleri`). Tek gün
için iki değer aynı yazılır. Her satırın yanında o değerlerle bugün kaç
kişinin listeleneceği görünür (`POST /api/Uyum/PencereSayimi`, kaydetmeden
hesaplar; üzerine gelince ilk 30 kişi listelenir). Takip listesi, elle
gönderim ve otomatik gönderim hepsi `UyumGonderimServisi.Pencereler` ile
aynı değeri okur; tanımsız aşamada koddaki varsayılan geçerlidir.

Kişi pencereye girince Takip Listesi'nde görünür, pencere kapanınca düşer;
SMS yalnızca penceredeyken gönderilebilir.

Her aşamada iki taraf ayrı ayrı ölçülür — çalışanın kendi formu ve mağaza
müdürünün değerlendirmesi. Yöneticiye kişi başına değil mağaza başına tek
bağlantı gider; açılan ekranda dönemi dolan personel listelenip tek tek
değerlendirilir. Bağlantılar **72 saat** (3 gün) geçerlidir; eski SMS şablonlarındaki "48 saat" gönderimde kendiliğinden düzeltilir.

Test gönderimleri `test_mi = 1` ile işaretlenir ve hiçbir rapora girmez.

### Risk skoru (0–100)

`UyumAnaliz.RiskSkoru` bir kestirim değil, önceliklendirme aracıdır: İK'nın
kiminle önce ilgileneceğini söyler. Elde olan bileşenlerden hesaplanır ve
yalnızca bulunan ağırlıklara göre yüze normalize edilir; yönetici formu
doldurulmamış bir kişi bu yüzden haksızca riskli görünmez.

| Bileşen | Ağırlık |
| --- | --- |
| Son çalışan puanı düşükse | 40 |
| Dönemler arasında düşüş varsa (en az iki ölçüm gerekir) | 25 |
| Son yönetici puanı düşükse | 20 |
| İK'ya iletilmek istenen bir konu bildirildiyse | 10 |
| Beklenti ile gerçeklik ayrıştıysa | 5 |

E�ikler: **60 ve üzeri** İK görüşmesi, **35–59** yakın takip, altı normal takip.
Karne listesindeki rozet renkleri ve karne ayrıntısındaki "Sonraki aksiyon"
alanı aynı eşikleri kullanır.

### Alan kümeleri

Çalışan ve yönetici formlarında soru metinleri farklıdır ("Yöneticimden yeterli
destek alıyorum" ↔ "Yöneticiyle iletişimi"). İki tarafı yan yana koyabilmek için
ölçek soruları beş ortak alanda toplanır: **İşe uyum**, **İş bilgisi ve
gelişim**, **İletişim**, **Çalışma düzeni**, **Bağlılık ve sorumluluk**.

E�leştirme `UyumAnaliz.AlanKurallari` içindeki anahtar kelimelerle yapılır.
Sıra önemlidir: bir soru ilk uyan alana yazılır, böylece aynı soru iki alanda
birden sayılmaz. Karşılaştırma Türkçe harfler karşılıklarına indirilerek
yapılır, yoksa "İletişim" ile "iletisim" eşleşmiyordu.

Hiçbir alana uymayan soru sayılmaz. Zorlamayla yanlış alana yazmaktansa
dışarıda kalması doğrudur.

### Serbest metin sınıflandırması

Açık uçlu yanıtlar üç kümede konulara ayrılır: çalışanın memnun olduğu
konular, çalışanın değişmesini istediği konular ve yöneticinin işaretlediği
gelişim alanları. Birden çok konuya uyan bir metinde en çok kelimesi geçen
konu seçilir; böylece yüzdeler toplandığında yüzde yüzü aşmaz.

Kümeler `UyumAnaliz.MemnunKonulari`, `IstekKonulari` ve `GelisimKonulari`
içindedir. Yeni bir konu eklemek için oraya bir satır yazmak yeterlidir;
ekran tarafında değişiklik gerekmez.

### Ayrılma ile ilişki

Trend & Analiz sekmesindeki en değerli tablo budur: hangi geribildirim
işaretinin gerçekten ayrılmaya dönüştüğünü gösterir. Her satır bir kümedir ve
kümedeki kişilerin **son formundan sonraki 183 gün** içinde ayrılıp
ayrılmadığına bakılır. Ayrılma bilgisi Mikro personel kartındaki çıkış
tarihinden gelir.

Mağaza ve yönetici tablolarındaki **erken ayrılma** sütunu farklı ölçer: o
birimde form gönderilmiş çalışanlardan ilk yılı içinde ayrılanların oranıdır.

### eNPS

"Biçen'i çalışmak için bir arkadaşınıza tavsiye etme ihtimaliniz nedir?"
sorusunun 0–10 yanıtlarından hesaplanır: 9–10 verenlerin yüzdesinden 0–6
verenlerin yüzdesi çıkarılır. Sonuç −100 ile +100 arasındadır. 1. yıl formunda
sorulduğu için ilk yıl dolmadan değer oluşmaz.

### Yorum kutuları

Rapor sayfalarındaki renkli yorum kutuları (`.pt-not`) elle yazılmış sabit
metin değildir; her biri o anki veriden türetilir. Eşik aşılmadığında kutu hiç
görünmez. Sabit metin birkaç ay sonra gerçeği yansıtmayı bırakacağı için
bilerek böyle yapılmıştır.

### Tıklanabilir satırlar ve takip listesindeki anket durumu

Trend & Analiz sekmesindeki tabloların hepsi bir yere açılır: aşama satırı o
aşamayı dolduranların karnelerine, ayrılma ilişkisi satırı o kümedeki kişilere
(`kisiler` alanı), konu satırları o konuya yazılmış yanıtların kendisine
(`ornekler`), alan satırları alanı oluşturan sorulara (`sorular`). Yönetici
karşılaştırması artık tek tarafı dolu birimleri de listeler; fark hesaplanamaz
ama yöneticinin puanı tek başına da bilgi verir.

Takip Listesi'ne **Anket** sütunu eklendi. `GET /api/Personel/Takip` her kişi
için o dönemin çalışan anketini de döner (`anketDurumu`): SMS gitmiş ve
doldurulmamışsa *yanıt bekleniyor*, bağlantı 3 gün içinde açılmamışsa *anket
süresi doldu*, doldurulmuşsa puanıyla *dolduruldu* (tıklanınca karne açılır).
Hiç gönderilmemişse *gönderilmedi* yazar. Takip dönemi adları ile anket aşama
kodları `PersonelController.AsamaKodu` içinde eşleştirilir.

Yanıtlanmamış anket (bekliyor ya da süresi doldu) satırda **Kendisine /
Yöneticisine / İkisine** düğmeleriyle yeniden gönderilir
(`POST /api/Uyum/YenidenGonder`; İK yöneticisi, GMY ve yönetici). Yeni
bağlantı üretilir, süre baştan başlar; eskisi süresi dolana kadar açık
kalır. Pencere şartı aranmaz: kişi pencereden çıkmış olsa da bu dönem için
son 45 günde gönderilmiş yanıtsız anketi varsa listede "pencere dışı"
etiketiyle kalır — aksi hâlde tek günlük pencerelerde yanıtsız kalan kişiye
bir daha ulaşılamazdı. Test gönderimi kartındaki **Süresi dolanlara yeniden
gönder** düğmesi seçili dönemin listesinde durumu "anket süresi doldu" olan
anketleri toplu gönderir (bağlantısı hâlâ açık olanlara gitmez; onlara
satırdaki menüden tek tek gönderilebilir) (`POST /api/Uyum/YenidenGonderToplu`): çalışana kişi başına,
yöneticiye mağaza + değerlendirici grubu başına tek SMS; aynı yöneticiye
bugün ikinci kez gitmez.

Mağaza & Yönetici sekmesindeki yönetici karşılaştırması artık **(şube,
yönetici) çifti** başına bir satırdır: Z.Merkez Büro gibi birden çok
departmanı ve yöneticisi olan birimde her yönetici ayrı görünür. Yönetici
puanı o yöneticinin formundaki kişilerin ortalaması, çalışan memnuniyeti
yalnızca o kişilerin kendi formlarından; satır kaç kişiyi değerlendirdiğini
gösterir ve tıklanınca çekmece yalnızca o kişileri açar (`kisiler`).
Tablodaki **Genel puan** iki tarafın ortalamasıdır (yalnızca biri doluysa
o), altında fark küçük yazar. Durum genel puandan: 4+ iyi, 3,5–4 takip, altı
risk; fark 1'i geçiyorsa "çalışan düşük puan veriyor" ya da "yönetici düşük
puan veriyor" etiketi eklenir. Formda
kişi kodu yoksa satırda "N form · kişi kodu yok" yazar, çekmece bunu bir
uyarıyla söyler ve şubenin tamamını listeler.

Yönetici formlarının birleştirilmesi (`Cevap`) artık gerçek JSON
çözümlemesiyle yapılır: aynı kişi yeniden değerlendirilince yalnızca onun
önceki formu değiştirilir. Önceki sürüm köşeli parantezleri metin olarak
kırpıp bütün diziyi tek parça saydığı için diğer kişilerin formları da
siliniyordu — yönetici satırlarında "0 kişi değerlendirdi" ama puanı olan
kayıtların bir sebebi bu olabilir.

Kişi kodu olmayan eski yönetici formları için **tahmin** yapılır
(`YoneticiKisiTahmini`): yönetici satırıyla aynı şube ve aşamada, gönderimi
±3 gün içinde olan çalışan satırlarına bakılır; tek bir kişi varsa form ona
bağlanır (karne, karne listesi, yönetici karşılaştırması ve ayrılma
ilişkisinde). Birden çok aday varsa tahmin yapılmaz, kayıt "kişi kodu yok"
olarak kalır.

Aynı sütunun ikinci satırı yönetici formudur: birim başına tek gönderim
gittiği için kişinin şubesi + aşama ile eşlenir (`yoneticiAnketDurumu`).
Gönderim yapılmadan da kurala göre kime gideceği görünür; bulunamıyorsa
sebebi yazar (mağaza müdürü yok / bölge müdürü tanımsız).

**Kim kimi değerlendirir** (`Servisler/YoneticiBulucu`): mağaza personelini
mağaza müdürü (yoksa müdür yardımcısı, mağaza şefi; elle tanımlı eşleştirme
üstün gelir), **mağaza müdürünü o şubenin bölge müdürü** değerlendirir. Bölge
müdürü panel kullanıcıları arasından bulunur: rolü bölge müdürü olan ve
şubeleri arasında o şube bulunan kişi (Yönetim → Kullanıcılar). Tanımlı
değilse gönderim yapılmaz ve hata sebebi söylenir; mağazaya düşülmez, çünkü
kişi kendi kendini değerlendirirdi. Aynı mağazada iki grup varsa iki ayrı
SMS gider; yönetici satırının `gorev` alanı "magaza" / "bolge" olarak hangi
grup için olduğunu taşır ve açılan ekran yalnızca o grubu listeler.
Hangi yöneticiye, hangi numaraya gittiği ve bekliyor / doldurdu / süresi
doldu durumu görünür; İK "yönetici doldurmadı" deyince kimi arayacağını
buradan bilir.

### Yöneticinin verdiği yanıtlar ve zorunlu açıklama

Yönetici formunda gönderim satırı mağazaya aittir, personel koduna değil — bir
gönderimde birden çok kişi değerlendirilir. Bu yüzden `Karne/{personelKodu}`
ucu yöneticinin yanıtlarını getirmiyordu ve karnede "yöneticisi ne demiş"
görünmüyordu. Artık uç, doldurulmuş yönetici formlarını da tarayıp o kişiye ait
bölümü ayıklıyor ve normal bir form kaydı gibi döndürüyor: soru soru puanlar,
açık uçlu yanıtlar ve o kişiye özel ortalama. Yöneticinin başka personel için
yazdıkları karnede görünmez.

Karne listesinde her aşama hücresinde iki kutu vardır: **Ç** etiketli yeşil
düz çerçeveli kutu çalışanın kendi anketi, **Y** etiketli mavi kesikli
çerçeveli kutu yöneticisinin değerlendirmesi; başlığın altında lejant durur.
Durum rozeti çalışan anketi yoksa yöneticinin son puanından hesaplanır
(`durumKaynagi`), yalnızca ikisi de boşsa "Anket bekleniyor" yazar. Pano
veya Mağaza sekmesinden gelindiğinde uygulanan süzgeç mavi bir şeritte
"Liste süzülmüş: 3 / 27 kişi" diye görünür; "Süzgeci kaldır · tüm 27 kişi"
düğmesi listeyi açar.

Karne çekmecesinde formlar aşama başına **yan yana iki kutu** hâlinde
gösterilir: solda yeşil şeritli "ÇALIŞAN · kendi anketi", sağda mavi
şeritli "YÖNETİCİ · değerlendirmesi" (yöneticinin adıyla). Gönderilmemiş
taraf kesikli boş kutu olarak durur; süresi dolan "süresi doldu,
doldurulmadı" yazar. Karne özeti ve fark analizi tablolarının sütun
başlıkları da aynı renklerle (yeşil çalışan, mavi yönetici) ve üstte lejant
vardır.

Bir birimin tüm formlarını (çalışan ve yönetici, hepsi bir arada) görmek için
yönetici karşılaştırması çekmecesindeki **Birimin tüm formları** düğmesi
kullanılır; `GET /api/Uyum/BirimFormlari` ucuna gider.

"İK'nın bilmesini istediğiniz bir konu var mı?" sorusuna **Evet** denince
altında zorunlu bir açıklama alanı açılır (`Soru.aciklamaIsteyen`). Yalnızca
"Evet" demek İK'ya hiçbir şey söylemiyor, kişiyi arayıp sormak gerekiyordu.
Açıklama yazılmadan form gönderilemez; en az üç karakter beklenir.

Açıklama, yanıtın kendisine eklenmez — `sorular[].aciklama` alanında ayrı
taşınır. Yanıt "Evet" olarak kaldığı için evet/hayır sayımları ve risk skoru
bozulmaz. Panelde açıklama, form yanıtının altında sarı kutuda görünür ve
Pano'daki "Aksiyon bekleyenler" listesinde kişinin altında doğrudan okunur.

## Çıkış mülakatı — neden ve açıklama

Mülakat açılırken **çıkış nedeni** Mikro'daki çıkış sebebiyle
(`PERSONELLER.per_cikis_neden`) ön dolu gelir; `GET /api/CikisMulakat/Ayrilanlar`
her kişi için `cikisSebebi` döner. Sebep ayarlardaki neden listesinde yoksa da
seçili görünür — liste o değerle geçici olarak genişletilir. Uzman isterse
değiştirir; alanın altındaki not Mikro'daki kayıtla seçilen değerin aynı olup
olmadığını söyler.

Nedenin altında **Nedenin açıklaması** alanı vardır
(`cikis_nedeni_aciklama`, NVARCHAR(MAX)). Neden Mikro'dan sabit bir başlık
olarak gelir ("İstifa" gibi); görüşmede öğrenilen asıl sebep buraya yazılır.
İkisi ayrı tutulur ki rapor nedene göre gruplayabilsin, ayrıntı da kaybolmasın.
Açıklama listede nedenin altında kırpılmış, ipucunda ve ayrıntı çekmecesinde
tam hâliyle görünür.

Kolon `VeritabaniServisi` açılışta yoksa ekler; eski kayıtlarda boş kalır.

## Yıllık izin — çizelge aktarımı

Panel → Yıllık İzin → Toplu Aktarım, İK'nın Excel'de tuttuğu
"BİÇEN YILLIK İZİN ÇİZELGESİ" dosyasını (.xlsb) olduğu gibi okur; CSV'ye
çevirmek gerekmez. "PER-KOD" başlığı olan sayfa ("2026-YILLIK İZİN") ve
başlık satırı kendiliğinden bulunur; üstteki özet blokları atlanır.

Sütunlar başlık adıyla eşleştirilir, **önce tam ad, sonra içeren**. Bu sıra
önemlidir: çizelgede iki tür "KULLANILAN" var — kişi satırındaki
"KULLANILAN İZİN/PLANLANAN İZİN" (ikisinin toplamı) ve sağdaki "KULLANILAN".
İçeren aramada ilkine takılıyor, kullanılan ile planlanan tek sayı olarak
geliyordu.

Haftalık sütunlar ("01.Ocak - 08.Ocak" … "25.Aralık - 01.Ocak") tarihli
izin kayıtlarına çevrilir:

- Hücre değeri haftanın gün sayısını aşıyorsa (tek hücrede "14") izin o kadar
  gün sürer; dönüş = çıkış + gün − 1. Önceden 14 günlük izin 7 günde biten
  bir kayıt oluyordu.
- Ardışık haftalara bölünmüş değerler (7 + 4) tek izin kaydına birleştirilir.
  Önizlemede "(2 hafta birleşti)" yazar.
- Bugünden önce başlayanlar kullanılan, sonrakiler planlı sayılır; dosya bu
  ayrımı yapmıyor, sistem yapıyor.

Kişi TC kimlik ile, yoksa sicille Mikro'da aranır (`Durum?tumu=true`,
ayrılanlar dahil). Bulunamayan satır aktarılmaz ve önizlemede sayısı ayrıca
uyarı olarak görünür.

Önizlemede her satır için dosyadaki toplam ve kalan, haftalık sütunlardan
hesaplananla karşılaştırılır; tutmuyorsa satır **uyarılı** olur ama yine
aktarılır — doğru olan haftalık sütunlardır, izin kayıtları oradan üretilir.
Özet kutuları (okunan / aktarılacak / uyarılı / atlanacak) tıklanınca tabloyu
süzer; satır açılınca üretilecek izin kayıtları tarihleriyle listelenir.

Sunucu (`POST /api/Izin/BakiyeToplu`) hak ediş ve devri `KRY_IZIN_BAKIYE`'ye,
tarihli izinleri `giren = 'çizelge'` ile `KRY_IZIN`'e yazar; artık şube ve
görev de yazılır. Aktarım tekrarlanabilir: kişinin önceki çizelge kayıtları
silinip yeniden yazılır, elle girilen izinlere dokunulmaz.

Eşleştirmede aynı kişinin Mikro'da birden çok kaydı olabilir (çıkıp yeniden
girenler yeni sicil alır, eski kayıt durur). Adaylar arasından önce çalışan,
sonra dosyadaki sicille aynı olan, sonra en son işe giren seçilir; dosyadaki
sicil ile seçilen sicil farklıysa satır uyarı alır ve bakiyenin hangi sicile
yazılacağı görünür.

## Başvuru listesi ve havuz — hız

`KRY_BASVURULAR.veri_json` formun tamamını **fotoğrafın base64'üyle birlikte**
taşır; satır başına yüzlerce KB. Havuz ve liste sorguları her satırda
`REPLACE(veri_json, ' ', '') LIKE '%engelDurumuVarMi...%'` ile bu LOB'u
tarıyordu; havuz tüm Olumlu kayıtlarda çalıştığı için dakikalara ve
"Execution Timeout Expired" hatasına düşüyordu. `durum` üzerinde indeks de
yoktu, her çağrı tabloyu baştan sona okuyordu.

Çözüm:

- `engel_var` ve `fotograf_var` bayrak kolonları. Yeni kayıtta başvuru
  alınırken yazılır; eski kayıtlar `BasvuruBayrakGorevi` ile arka planda
  yüzer yüzer doldurulur (açılıştan 45 sn sonra başlar, iş bitince saatte bir
  bakar). Bayrak henüz hesaplanmamış satırlarda engel 0, fotoğraf
  `fotograf_ozeti` varlığından okunur.
- Havuz ve liste sorguları artık `veri_json`'a hiç dokunmuyor.
- `IX_KRY_BASVURULAR_durum (durum, olusturma DESC)` ve
  `IX_KRY_BASVURULAR_olusturma` indeksleri.

Yayından sonra ilk dakikalarda arka plan görevi eski kayıtları işlerken
sunucu biraz meşgul olabilir; kalıcı değildir. Log'da "Başvuru bayrakları
tamamlandı" görünene kadar sürer.

## Mikro personel fotoğrafı (mye_ImageData)

Yeni fotoğraf kaydında `ImageID` her zaman **0** yazılır. Mikro personel
fotoğrafını `Record_uid` + `TableID` ile bulur; ImageID sıra numarası değil.
Önceden MAX+1 ile üretilen sayılar Mikro'nun kendi yazdığı kayıtlarla
uyuşmuyordu. Kolon otomatik artansa yazılmaz. Şablon satır (Mikro'nun
yazdığı bir kayıt) artık ImageID ile değil `TOP 1` ile seçilir, çünkü
ImageID'ler ayırt edici değil.

### Otomatik gönderim

Yönetim → Form Ayarları → "İşe Uyum Anketi Otomatik Gönderim": aşama başına
Elle / Otomatik anahtarı (`FormAyarlari.UyumOtomatik`, varsayılan kapalı).
Açık aşamada `UyumOtomatikGorevi` saatte bir bakar ve 09:00–18:00 arasında
o gün pencereye giren personele çalışan anketini, birimin yöneticisine
(mağaza müdürü; mağaza müdürü için bölge müdürü) tek bildirimi gönderir.
Elle gönderimle aynı servisi (`UyumGonderimServisi`) kullanır; gönderen
alanına "otomatik" yazılır. Daha önce gönderilmiş kişiye ikinci kez gitmez,
o yüzden elle gönderimle çakışmaz. Bölge müdürü tanımlı değilse mağaza
müdürünün değerlendirmesi gönderilmez ve log'a yazılır.

## Excel çıktıları — ortak biçim

Paneldeki her "Excel'e aktar" düğmesi aynı görünümde .xlsx üretir
(`raporExcel.tabloIndir`): başlık ve oluşturma satırı, koyu yeşil başlık,
şeritli satırlar, ince çerçeve, sayı/tarih/para/yüzde biçimleri, gruplu ara
toplamlar ve genel toplam (SUBTOTAL; süzgeçle güncellenir), yüzde ve fark
sütunlarında renk ölçeği, sayı sütunlarında veri çubuğu, dondurulmuş başlık,
süzgeç. Dönüştürülen çıktılar: Başvurular listesi, Rapor bölüm/ilçe
kırılımları, Personel listesi, Norm Kadro raporu, Yıllık İzin listesi,
Personel Başı Ciro, Günlük Geçiş raporu; ekrandaki HTML tabloyu aktaran
`disaAktar.excelOlarakIndir` (Bölge raporu, Performans büyüme, Prim hak
edişi vb.) da aynı biçime `htmlTabloIndir` ile gider — sayılar ve yüzdeler
metinden sayıya çevrilir. CSV kalan tek yer izin bakiye **şablonu**; o içe
aktarım için kasıtlı olarak düz tutulur.

Yeni bir dışa aktarım eklerken CSV üretmek yerine `tabloIndir` çağırın;
sütun tipini verin (`sayi`, `ondalik`, `yuzde`, `tarih`, `tarihSaat`,
`para`), gerekiyorsa `grupSutunu` ve `genelToplam`.

## Güvenlik günlüğü — "ÇIKIŞ MÜLAKATI OKUNAMADI"

Başvuru detayı açılırken "Invalid object name
'MikroDesktop_2004BICEN.dbo.PERSONELLER'" kaydı düşüyorsa sebebi: eski
sorgu kariyer veritabanı bağlantısı üzerinden Mikro tablosuna JOIN
yapıyordu; Mikro ayrı SQL sunucusunda olduğu için bulunamıyordu ve her
detay açılışında günlüğe yazılıyordu. Artık kimlik → personel kodu eşlemesi
`PersonelKaynagiServisi`'nden (önbellekli) alınır, çıkış mülakatı yalnızca
kariyer veritabanında `personel_kodu IN (...)` ile aranır. Mikro kapalıysa
kimlikle eşleşen anket kayıtlarına düşülür.

## Tahakkuk — ücret hesap pusulası

Panel → **Tahakkuk** (yönetici, İK yöneticisi, GMY). Dönem (yıl, ay) seçilir;
o dönemde tahakkuku olan SGK şubeleri kart olarak listelenir
(`GET /api/Tahakkuk/Subeler`). Bir şube ya da "Tüm şubeler" seçilince
personel listesi gelir (`GET /api/Tahakkuk/Pusula`); satırdaki düğme tek
PDF, üstteki düğme zip indirir. Zip yapısı:
`{yıl}-{ay}/{SGK no - şube adı}/{ad soyad (kod)}.pdf`.

Veri **MikroDesktop_BICEN** (bordro) veritabanından okunur — personel
listesinin geldiği MikroDesktop_2004BICEN'den farklıdır. Bağlantı
`ConnectionStrings:Tahakkuk`; boş bırakılırsa personel bağlantısının
veritabanı adı `Tahakkuk:Veritabani` ile değiştirilerek kullanılır
(`VeritabaniServisi.TahakkukBaglantisi`). Tablolar: PERSONEL_TAHAKKUKLARI,
PERSONELLER, FIRMALAR, PERSONEL_SSK_TANIMLARI, MESLEK_TANIMLARI. Mikro'nun tahakkuk tablosu **yuvalıdır**: kazanç 1–7
(`pt_kazanc{n}_tkgun/_tksaat/_tktutar`), ek kazanç 1–11
(`pt_ekkazanc{n}_…`), sosyal yardım 1–32 (`pt_sosyrdm{n}`), özel kesinti
1–24 (`pt_ozksnt{n}`); yasal kesinti ve toplamlar adlı sütunlardır
(`pt_sskbrutmatrah`, `pt_sskprimi`, `pt_gv`, `pt_dv`, `pt_iszlksigperpayi`,
`pt_kazanc`, `pt_kesinti`, `pt_net`, `pt_yuvfarki` …). Bu sütunlar
`TahakkukController.Alanlar` içinde **sabit** tanımlıdır; tahmin yoktur.

**Brütleştirme:** sosyal yardımlar Mikro'da net tutulur, makbuzda brüt
gösterilir; brüt = net × `pt_SosYardBNCarpan{n}`. Aynı mantık kazanç
(`pt_KazancBNCarpan`) ve ek kazanç (`pt_EkKazancBNCarpan{n}`) için de
uygulanır. Çarpan yoksa ya da 1 ise değer olduğu gibi kalır — bu adım
atlanınca yemek 2.068,14 yerine 2.455,04 gibi farklar çıkıyordu.

**Hesaplanan satırlar:** "Net (istisna öncesi)" = net − GV istisnası − DV
istisnası; "Toplam (istisna öncesi)" = toplam kesinti + GV istisnası.
Mikro'da bunların ayrı sütunu yok, makbuzda türetiliyor.

Tutarlar Mikro'daki gibi **brütleştirme çarpanıyla** gösterilir:
`pt_sosyrdm{n} × pt_SosYardBNCarpan{n}` (kazançta `pt_KazancBNCarpan`, ek
kazançta `pt_EkKazancBNCarpan{n}`). Çarpan 0 ya da yoksa tutar olduğu
gibidir — yemek 2.068,14 × 1,1871 = 2.455,04 gibi. Yasal sütundaki
"Net (İstisna öncesi)" ve "Toplam (İstisna önc.)" satırları Mikro'da da
hesaplanır: toplam kesinti + GV istisnası, net = toplam kazanç − o kesinti
− DV istisnası.

Yuvaların *adları* firmaya göre değişir — varsayılanlar Biçen'in
makbuzundaki sıradır ve **İşyeri ve satır adları** sekmesinden düzenlenir
(`FormAyarlari.TahakkukEtiketler`). Bir alan başka bir sütundan gelmeliyse (`TahakkukController.Alanlar` → Mikro
sütunu): kayıtlı eşleme `FormAyarlari.TahakkukEslesme`'de durur, boşsa
sütun adındaki parçalara göre otomatik tahmin edilir. **Sütun eşleme**
sekmesi denetim içindir: bir dönem kaydının bütün sütunları örnek
değerleriyle listelenir, hazır bağlantı yanlışsa değiştirilir. **Değere göre sütun bul**
kutusuna Mikro makbuzundaki bir rakam yazılınca (27.525,00 / 27525 fark
etmez) aynı değeri taşıyan sütunlar listelenir — eşlemeyi tamamlamanın en
hızlı yolu budur.

SGK şubesinin adı önce ayardan, yoksa **o şubedeki personelin en çok bağlı
olduğu iş grubundan** (mağaza adı) gelir; kartın altında "personelin birimi"
yazar. Elle yazılan ad her zaman üstündür.

**İşyeri bilgileri** sekmesinde pusulanın üst bloğu (ünvan, adres,
telefon, faks, ticaret sicil, web) ve SGK şubelerinin adı / işyeri sicil
numarası tutulur. Bunlar Mikro'da sürüme göre farklı sütunlarda durduğu ve
tahmin yanlış alanları getirdiği için ayardan okunur
(`FormAyarlari.TahakkukIsyeriBilgisi`, `TahakkukSubeler`). İlk kurulumda Mikro'dan
alınmış bir makbuzla karşılaştırarak eşlemeyi doğrulayın; toplamlar
(toplam kazanç, toplam kesinti, net) doğrudan Mikro sütunundan okunur,
eşlenmemişse satırlardan hesaplanır.

PDF panelde üretilir (`pusulaPdf.ts`, jsPDF) ve **Mikro'nun çıktısının
aynısıdır**: pusula sabit genişlikli metin olarak kurulur — çerçeveler
`|` ve `-` karakterleriyle çizilir, satırlar 133 karakter genişliğindedir
(`sol_`, `sag_`, `orta_` yardımcıları). Eşit genişlikli yazı için DejaVu
Sans Mono kullanılır (`public/fonts`, panel yayınında dist ile kopyalanır);
jsPDF'in yerleşik Courier'i Türkçe karakter basmıyor. Düzen: işyeri bloğu,
Dönem ve Meslek Kodu / Meslek Adı kutuları, KODU satırı, dört sütunlu gövde
(KAZANÇ · SOSYAL YARDIMI · ÖZEL KESİNTİSİ · YASAL KESİNTİSİ), kazanç
altında EK KAZANÇ, altta beş toplam kutusu ve imza alanı. Sütun
genişlikleri `G` sabitinde; değiştirilirse toplam 133 karakter korunmalı.

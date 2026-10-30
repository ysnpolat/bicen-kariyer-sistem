# Biçen360

İK panelinden ayrı, kendi adresinde çalışan yönetim paneli. Mobil uygulama
tek; adı Biçen360 olacak.

## Yapı

Biçen360 artık Kariyer paketinin içinde; ayrı bir paket yok.

```
Bicen360.API/        ASP.NET Core 8 — port 5181
bicen360-panel/      React + Vite + TS + AntD — port 5180
bicen-mobil/         ortak mobil uygulama (arıza modülü eklendi)
portal-yayinla.bat   yalnızca Biçen360'ı yayınlar
plesk/PORTAL-KURULUM.md  sunucu tarafındaki bir kerelik kurulum
```

Yayında Kariyer ile aynı alan adını paylaşıyor:

```
kariyer.bicen.com.tr/panel         İK paneli          (değişmedi)
kariyer.bicen.com.tr/apiservis     BicenKariyer.API   (değişmedi)
kariyer.bicen.com.tr/portal        Biçen360 paneli
kariyer.bicen.com.tr/portalservis  Bicen360.API
```

Ayrı alan adı açılmadı: iki panel aynı kullanıcı tablosunu ve aynı jeton
anahtarını kullanıyor, aynı köken altında durmaları oturum tarafında ek
iş çıkarmıyor. Kalıcı adres belirlendiğinde `bicen360-panel/vite.config.ts`
içindeki `base` ve `portal-yayinla.bat` başındaki iki değişken
güncellenir.

## Kariyer sistemiyle ilişkisi

| Ortak | Ayrı |
|---|---|
| Kullanıcılar (`biPortal.KRY_KULLANICILAR`) | Yetkiler (`biPortal.B360_YETKI`) |
| Jeton imza anahtarı ve yayıncı | Uygulama, port, oturum anahtarı |
| Künye kayıtları (`KRY_KUNYE_ANALIZ`) | Menü ve sayfalar |

HKS veritabanı da biPortal ile aynı SQL örneğinde (`mail.bicen.com.tr,11904`).
Yeni tabloları ayrı bir veritabanına koymamanın bir sebebi de buydu.

Bir kullanıcı iki panele de aynı kullanıcı adı ve parolayla girer. Ama İK
panelinde gördüğü sayfalarla burada gördüğü sayfaların hiçbir ilgisi yoktur;
yetkiler panel bazında ayrı tanımlanır.

**Jeton anahtarı iki `appsettings.json` dosyasında da aynı olmalı.** Mobil
uygulama tek jetonla iki API'ye de gidiyor. Anahtar Kariyer API'deki gerçek
değerle dolduruldu; bundan sonra değiştirirken ikisini birlikte
güncelleyiniz. Yalnızca birini değiştirmek, mobil tarafta yarısı çalışan bir
oturuma yol açar ve hata mesajı bunu söylemez.

Bağlantı dizeleri, hmzYS belirteci ve jeton anahtarı Kariyer API'nin güncel
`appsettings.json` dosyasından alındı. Dosya parola ve API anahtarı içeriyor;
sürüm denetimine girerse dikkat ediniz.

## Çalıştırma

Paket kökündeki `baslat-tumu.bat` beş servisi birden açar: Kariyer API
(5177), İK paneli (5178), aday sayfası (5179), Biçen360 API (5181) ve
Biçen360 paneli (5180).

Yalnızca Biçen360 için:

```bash
cd Bicen360.API && dotnet run     # tabloları açılışta kendi kurar
cd bicen360-panel && npm install && npm run dev
```

## Yayınlama

```
portal-yayinla.bat
```

İK paneli ve Kariyer API'si bu betikten etkilenmez; onlar için
`sunucu-yayinla.bat` kullanılır. İlk yayından önce `portalservis`
klasörünün IIS'te uygulama olarak tanımlanması gerekiyor —
`plesk/PORTAL-KURULUM.md` içinde adım adım yazılı.

Tablolar oluşturulamazsa (`CREATE TABLE permission denied`)
`Bicen360.API/kurulum.sql` dosyasını SSMS ile çalıştırınız.

## İlk giriş

Admin rolündeki kullanıcılar her sayfayı görür — yetki tablosu boşken
sistemin kimsenin giremediği bir hâlde kalmaması için koda gömülü. Admin
olmayan birine erişim vermek için önce elle bir satır gerekir:

```sql
INSERT INTO B360_YETKI (alan, kapsam, anahtar, kod, izin)
VALUES ('panel', 'kullanici', N'kullanici.adi', 'yonetim', 1);
```

Gerisi panelin Yönetim sayfasındaki Yetkiler sekmesinden yapılır.

## Yetki modeli

İki alan, her birinde iki katman:

| Alan | Üst katman | Alt katman | Tanımsızın anlamı |
|---|---|---|---|
| `panel` | kullanıcı | rol | kapalı |
| `mobil` | kullanıcı | pozisyon | açık |

Kullanıcı satırı her zaman alt katmanı ezer.

**Tanımsız ile kapalı farklı şeylerdir.** Bir kod için kullanıcı satırı yoksa
alt katmana düşülür; satır varsa `izin = 0` olsa bile düşülmez. Yoksa kişiye
özel kapatma diye bir şey olmazdı. Yetki ekranındaki üç durumlu seçim bunun
karşılığı.

Ekran tek matris: satırlar roller, görevler ya da kişiler; sütunlar
sayfalar ve mobil modüller. Hücreye tıklandıkça durum dönüyor (tanımsız →
açık → kapalı), sütun başlığından o sütunun tamamı, satır adına sağ
tıklayarak o satırın tamamı ayarlanıyor ve sonda tek kaydetme var. Önceki
hâlinde bir rol seçilip tablo doldurulup kaydediliyor, sonra sonrakine
geçiliyordu: "hangi görevde hangi modül açık" sorusunun cevabı hiçbir
ekranda bir arada görünmüyor ve otuz küsur pozisyon için otuz küsur tur
atmak gerekiyordu.

Panelde varsayılan kapalı: tanımsız bir sayfayı açık saymak, yeni sayfa
eklendiğinde onu herkese açardı. Mobilde tersi — Kariyer tarafındaki mevcut
davranış "liste boşsa kısıtlama yok" ve yeni modül kimsenin göremediği bir
durumda kalmamalı.

## Giriş ekranı ve panel düzeni

Giriş ekranı İK panelindeki iki sütunlu düzenin aynısı: solda marka alanı,
sağda form; dar ekranda marka alanı gizlenir. CSS değişkenleri
(`--yesil`, `--metin`, `--cizgi` …) ve düzen sınıfları İK panelinden alındı,
sınıf öneki `ik-` yerine `b3-` yapıldı — iki panel aynı tarayıcıda açıkken
karışmasın.

Logo Kariyer'deki desenle aynı yerden yayınlanıyor: `Bicen360.API/wwwroot/`
klasörüne `logo.png` kopyalayınız (en kolayı `BicenKariyer.API/wwwroot/`
içindekini almak). Dosya yoksa ekran hata vermez, logo alanı boş kalır.

## Durum

**Hazır**

- Oturum, menü, yetki modeli, yetki yönetimi ekranı
- Departman ve temsilci tanımları
- Künye modülü: `KunyeController` taşındı, panel raporu bağlandı
- Arıza kayıt — sunucu, panel ekranları ve mobil ekran
- Arıza soru akışı — panelde tasarım ekranı, toplu seçenek girişi, mobilde
  adım adım sorma
- Yetki matrisi — bütün roller/görevler tek ekranda
- Envanter — cihaz girişi ve mağaza bazlı listeleme

**Bekleyen**

1. Rakip fiyat
2. Checklist yönetiminin taşınması

Panel sayfaları: `kunye`, `rakipfiyat`, `ariza`, `envanter`, `checklist`,
`yonetim`. Yetki yönetimi ayrı bir sayfa değil, Yönetim'in bir sekmesi —
erişimi de `yonetim` yetkisiyle veriliyor. Admin dışındaki kullanıcılar
tanımsız sayfayı göremez.

## Arıza kayıt

Kayıt mobilden açılıyor, temsilciler yönetiyor. Görünürlük üç kuralla
belirleniyor ve kurallar VEYA ile bağlanıyor — bir kişi hem temsilci hem
mağaza müdürü olabiliyor ve kendi açtığı kaydı da görmeli:

| Kim | Ne görür |
|---|---|
| Departman temsilcisi | Departmanına açılan tüm kayıtlar, durumu değiştirebilir |
| Mağaza yöneticisi | Kendi mağazasındaki kayıtlar |
| Diğer personel | Yalnızca kendi açtığı kayıtlar |
| Panel kullanıcısı | `ariza` sayfası açıksa hepsi |

Mağaza yönetici ünvanları `appsettings.json` içindeki
`Ariza:MagazaPozisyonlari` listesinde; Mikro'daki ünvan adlarıyla birebir
aynı yazılmalı. Kodda sabitlenmedi çünkü ünvanlar değişiyor ve her
değişiklikte yeniden derlemek gerekmemeli.

Bildirim için ayrı altyapı kurulmadı: panel zilinin okuduğu `KRY_BILDIRIM`
ve mobil jetonların durduğu `KRY_MOBIL_JETON` zaten biPortal'da. Kayıt
açılınca departman temsilcilerine, durum değişince kaydı açana gidiyor.

### Kayıt yaşam döngüsü

`acik → devam → beklemede → cozuldu → kapandi`

"Çözüldü" ile "kapandı" ayrı: ekip işi bitirdiğini söyler, kayıt
doğrulanana kadar kapanmaz. Tek durum olsaydı, çözülmediği hâlde kapatılan
kayıtlar görünmez olurdu.

Öncelik dört kademeli: düşük, orta, yüksek, acil.

Kaydı açanın cep numarası kayıt anında yazılıyor (`acan_telefon`) ve hem
panelde hem mobilde aranabilir bağlantı olarak duruyor. Her ayrıntı
isteğinde Mikro'ya sormak yerine kayda yazılıyor: personel işten ayrılsa
bile teknisyenin o gün kimi aradığı kayıtta kalmalı. Sütun eklenmeden önce
açılmış kayıtlarda numara Mikro'dan okunuyor.

Fotoğraflar `Ariza:GorselKlasoru` ayarındaki klasöre yazılıyor; boşsa
uygulama klasörünün altındaki `ariza`. IIS'te uygulama havuzunun kendi
klasörüne yazma izni olmadığında yükleme sessizce başarısız oluyordu,
artık sebep hem günlüğe hem telefondaki uyarıya yazılıyor. Kayıt numarası
yolda gidiyor (`/api/Ariza/Gorsel/{id}`): çok parçalı gövdedeki alan adı
bağlanamadığında istek "Dosya boş" diye reddediliyordu.

Hem panel hem mobil liste **kapanmamış kayıtların tamamıyla** açılıyor
(açık, devam eden ve beklemede olanlar). Varsayılan süzgeç "açık" iken bir
kayıt beklemeye alındığı ya da üzerinde çalışılmaya başlandığı anda
listeden düşüyor, personel de temsilci de süzgeci kaldırana kadar işin bir
kısmını göremiyordu. Süzgeç bunun ardından daraltmak için kullanılıyor.

### SLA

Süre kategoriye bağlı. Kayıt açılırken kategorinin saatinden bir bitiş
zamanı hesaplanıp **kayda yazılıyor**. Sonradan hesaplamak, kategori
süresi değiştiğinde geçmiş kayıtların gecikme durumunu da değiştirirdi.

Gecikmiş sayılmak için SLA bitişinin geçmiş **ve** kaydın hâlâ
çözülmemiş olması gerekiyor; kapanmış kaydın gecikmiş görünmesi listeyi
kirletiyordu.

### Yorumlar

Hareket geçmişinden ayrı tablo: hareket "ne oldu"yu, yorum "ne
konuşuldu"yu tutuyor. Aynı tabloya koymak, geçmişi durum değişiklikleriyle
yorumların karıştığı okunmaz bir listeye çeviriyordu.

İç notlar kaydı açana gösterilmiyor ve ona bildirim de gitmiyor; ekip
kendi arasında yazışabilsin. Çözüm olarak işaretlenen yorum kaydı
otomatik "çözüldü"ye alıyor. İkisi de yalnızca temsilcilerde: kaydı açan
kendi kaydını çözülmüş ilan edemez.

### Soru akışı

Personel eskiden tek satır yazıp bitiriyordu ("kasam çalışmıyor") ve
teknisyen mağazaya gidene kadar neyin bozulduğunu bilmiyordu. Arıza türü
seçildikten sonra artık panelde tanımlanan adımlar soruluyor:

```
Yazarkasa › Fiş yazıcı › Silik çıkarıyor
```

Bu metin kaydın başlığı oluyor; liste, arama ve raporlama da bunun
üzerinden çalışıyor.

**Adımlar tek ağaçta.** "Donanım" ve "soru" için iki ayrı tablo iki
seviyeyle sınırlı kalıyordu; oysa teknik işlerde `Dolap › Şarküteri ›
Kapak` gibi istenildiği kadar derinleşen kırılımlar var. Bir düğüm hem
seçenek hem de kendi alt seçeneklerinin sorusudur: `ad` ekranda görünen
düğme metnini ("Fiş yazıcı"), `soru` ise altındakiler sorulurken yazacak
cümleyi ("Fiş yazıcınızda nasıl bir sorun yaşıyorsunuz?") tutar. İlk
seviyenin sorusu türün üzerinde.

Adım başına ayarlanabilenler:

| Ayar | Ne yapar |
|---|---|
| Çoklu seçim | Alt seçeneklerden birden fazlası işaretlenebilir |
| Envanterden cihaz sor | Personel kendi mağazasındaki o türde bir cihazı seçer |
| Açıklama iste / zorunlu | Seçenek işaretlenince açıklama kutusu çıkar |
| Fotoğraf iste / zorunlu | Kayıt fotoğrafsız açılamaz |
| Öncelik | Seçilince kaydın önceliği bu olur |

**Seçenekler liste hâlinde girilebiliyor.** Bir yazarkasanın donanımları
(fiş yazıcı, dokunmatik ekran, çekmece, barkod okuyucu) ya da bir donanımın
belirtileri onlarca satır oluyor; her biri için pencere açıp kapamak tanım
işini caydırıcı hâle getiriyordu. "Liste hâlinde ekle" satır satır
yapıştırılan metni seçeneklere çeviriyor ve hepsine aynı alt soruyu
yazabiliyor. Ayrıntılı ayarlar (açıklama, fotoğraf, öncelik, cihaz türü)
sonradan tek tek düzenleniyor. Aynı seviyede aynı adla ikinci bir seçenek
eklenmiyor: listeyi iki kez yapıştırmak her şeyi ikiye katlıyordu.

**Çoklu seçim akışın sonudur.** İki seçenek işaretlendikten sonra
hangisinin altına inileceği belirsiz kalırdı; hem mobil hem sunucu bunu
böyle uyguluyor.

**Metinler kayda kopyalanıyor.** Yanıt satırı soru ve cevabı kendi içinde
tutuyor, adım tablosundan okumuyor: bir seçeneğin adı değiştiğinde ya da
pasife alındığında geçmiş kayıtların ne dediği değişmemeli. Aynı sebeple
kullanılmış bir adım silinmiyor, pasife alınıyor.

**İstemciden yalnızca adım kimlikleri geliyor.** Soru ve cevap metinleri
sunucuda tablodan okunuyor; metne güvenilseydi kayıt geçmişi istemcinin
yazdığı her şeyi kabul ederdi. Zincir de baştan sona doğrulanıyor: her
seçimin üstü bir önceki seçim olmalı.

**Fotoğraf zorunluluğu mobilde denetleniyor**, sunucuda değil. Fotoğraflar
kayıttan sonra yükleniyor; sunucuda denetlense kayıt açılmaz ve çekilen
fotoğraflar da kaybolurdu.

Akışı tanımlanmamış türlerde eski serbest form (başlık + açıklama) olduğu
gibi duruyor: akış tanımlanana kadar o türe kayıt açılamaz hâle
gelmemeli. Türde "akış zorunlu" işaretliyse yarım bırakılmış akış kabul
edilmiyor.

### Panel ekranları

**Arıza Kayıtları** — özet kartları (tıklanınca süzgeç oluyor), durum,
öncelik, departman, kategori, SLA ve metin süzgeçleri; satıra tıklayınca
ayrıntı çekmecesi: fotoğraflar, yorumlar, hareket geçmişi, durum/öncelik/
kategori değiştirme ve atama.

**Envanter** — cihaz girişi; temel bilgiler ile garanti ve muayene ayrı
sekmelerde. Cihaz açıldığında o cihazın arıza geçmişi de görünüyor; arıza
ayrıntısında ise aynı cihazın önceki kayıtları listeleniyor. Tekrar eden
arıza tek tek bakıldığında görünmüyordu: aynı fiş yazıcısı üç ayda dört kez
bozulduysa tamir edilmesi değil değiştirilmesi gerekiyor olabilir. Garanti bitişi boş bırakılırsa başlangıç ve süreden, sonraki
muayene boş bırakılırsa son muayene ve aralıktan hesaplanıyor — iki alanı
birden elle doldurmak, ikisinin çelişmesine yol açıyordu.

**Yönetim** — departmanlar, temsilcileri, arıza kategorileri ve soru
akışı. Kategori: ad, departman (boşsa genel), açıklama, SLA saati, ilgili
cihaz türleri, akışın ilk sorusu, akışın zorunlu olup olmadığı, aktiflik. Cihaz türü listesi elle tanımlanmıyor, envantere girilenlerden
toplanıyor: iki ayrı liste tutmak, biri güncellenip diğeri unutulduğunda
eşleşmeyen kategoriler bırakıyordu.

**Soru Akışı** (Yönetim'in sekmesi) — solda adım ağacı, satır üstüne
gelince alt seçenek ekleme, düzenleme, yukarı/aşağı taşıma ve kaldırma;
sağda önizleme. Önizleme mobil akışın aynısını tarayıcıda yürütüyor:
akışı telefonda denemek için yayın almak gerekiyordu ve küçük bir yazım
hatası bile pahalıya mal oluyordu. Adım penceresindeki "Kaydet ve
yenisini ekle", aynı seviyeye arka arkaya on seçenek girerken pencereyi
her seferinde yeniden açma zahmetini kaldırıyor.

Tanımlar arıza ekranından ayrıldı: yılda birkaç kez dokunulan listelerdi
ve her gün kullanılan ekranın içinde durmaları hem orayı
kalabalıklaştırıyor hem de yanlışlıkla değiştirilmelerini
kolaylaştırıyordu. Ayrı sayfa, ayrı yetki (`yonetim`).

Kullanılmış bir departman, kategori ya da cihaz silinmiyor, pasife
alınıyor: silinseydi eski kayıtların bilgisi boşalırdı.

Envanterde mağaza kutusu serbest metin değil: mağaza eşleşmesi personelin
iş grubu üzerinden yapıldığı için liste de Mikro'daki iş grubu
tanımlarından geliyor. `KRY_AYARLAR`'daki şube listesi kullanılmadı —
oradaki kodlar aday başvurusunun QR adresinden geliyor ve iş grubu adıyla
birebir aynı olmayabiliyor; ayrışırsa personel kendi mağazasının cihazını
göremez.

Kullanılmış bir cihaz ya da tür silinmiyor, pasife alınıyor: silinseydi
eski kayıtların cihaz ve tür bilgisi boşalırdı.

Fotoğraflar checklist desenindeki gibi dosya sisteminde
(`Bicen360.API/ariza/`), ama saklama süresi farklı: checklist görselleri
yedi günde siliniyor, arıza fotoğrafı kaydın kanıtı olduğu için kayıt
kapandıktan **30 gün** sonra siliniyor (`Ariza:GorselSaklamaGunu`). Kayıt
ve hareket geçmişi duruyor; görsel istendiğinde "süresi dolmuş" bilgisi
dönüyor.

## Mobil uygulama

`bicen-mobil/` klasörü, v554'teki uygulamanın arıza modülü eklenmiş hâli.
Kendi projenizdeki `bicen-mobil` klasörünün yerine koyup yayınlayabilirsiniz.

Değişen dosyalar:

| Dosya | Ne yapıldı |
|---|---|
| `src/api360.js` | **yeni** — Biçen360 sunucusuna giden istek katmanı |
| `src/ekranlar/Ariza.js` | **yeni** — arıza kayıt ekranı; kayıt açma adım adım |
| `src/api.js` | `jetonOku` dışa açıldı |
| `src/ekranlar/Diger.js` | iki sunucunun modül listesi birleştirildi |
| `src/bilesenler/Simge.js` | `uyari` simgesi eklendi |
| `App.js` | `Ariza` ekranı tanıtıldı |
| `app.json` | `extra.api360Adresi` eklendi |

**Yayınlamadan önce `app.json` içindeki `api360Adresi` değerini
değiştiriniz.** Şu an geliştirme için yerel bir adres yazılı
(`http://192.168.1.10:5181`) — kendi bilgisayarınızın ağ adresiyle
değiştiriniz, telefon `localhost` göremiyor. Panel yayına alındığında
gerçek adres yazılacak.

Uygulama artık iki API'ye birden soruyor: İK modülleri Kariyer API'den,
Biçen360 modülleri yeni sunucudan. Jeton ortak olduğu için ikinci bir
giriş yok. Biçen360 sunucusuna ulaşılamazsa yeni modüller görünmüyor ama
İK modülleri çalışmaya devam ediyor — bunu hata gibi göstermek, çalışan
tarafı da kullanılamaz hâle getirirdi.

Ayrıntı ekranında kaydın künyesi ad/değer satırları hâlinde duruyor;
altında akış yanıtları numaralı olarak, sorusu ve varsa açıklamasıyla
birlikte. Personelin yazdığı serbest metin ayrı başlıkta, aynı cihazın
geçmiş kayıtları da onun altında. Önceden ekranda yalnızca başlık ve
rozetler vardı; teknisyen kaydı açtığında neredeyse hiçbir şey
görmüyordu.

Diğer menüsünden açılan ekranların başlığında geri oku var ve alt menü
gezinme geçmişini izliyor (`backBehavior="history"`). Önceden geri tuşu
hangi ekranda olunursa olunsun ilk sekmeye — ana sayfaya — atıyordu. Ok
yalnızca alt menüde kendi sekmesi olmayan ekranlarda çıkıyor.

Kayıt açma tek sayfalık form değil, adım adım ilerleyen bir akış: her
ekranda tek soru var. Uzun formda personel alanları atlıyor, sonda hangi
zorunlu alanın eksik kaldığını bulamıyordu. Üstteki yol yazısının
yanındaki geri okuyla önceki adıma dönülebiliyor; dönülünce o adımdan
sonrası siliniyor, yanlış dalda verilmiş cevaplar kayda karışmasın.

Arıza modülü menüde görünmesi için panelin **Yetki Yönetimi → Mobil ·
Pozisyon** sekmesinden ilgili görevlere açık olmalı. Tanımsız bırakılan
modül mobilde varsayılan olarak açıktır.

## Taşırken değişenler

**`PersonelKaynagiServisi` getirilmedi.** Künye tarafında yalnızca sicilden
ad soyad bulmak için kullanılıyordu; 22 KB'lık servis yerine aynı tablolara
tek satırlık sorgu yazıldı.

**Yetki denetimi eklendi.** Kariyer'de künye yetkisi rolle geliyordu. Burada
aynı uçlar iki taraftan da geliyor: panelden gelen kullanıcı için sayfa
yetkisine, mobilden gelen personel için modül yetkisine bakılıyor.

**`KRY_KUNYE_ANALIZ` yerinde bırakıldı.** Aynı veritabanında, aynı adla.
`B360_` önekine çevirmek birikmiş veriyi göç ettirmek demekti.

## Açık kalanlar

**Rakip fiyat kaynağı.** Bizim satış fiyatımız POS'tan mı (raftaki güncel
fiyat) yoksa Mikro stok kartından mı gelecek? Barkod eşleşmesi netleşti:
`MikroDB_V15_BICEN.dbo.BARKOD_TANIMLARI`, `bar_kodu` → `bar_stokkodu`.

**Mobil modül yetkileri.** Kariyer API'si bunları hâlâ `KRY_AYARLAR`
içindeki JSON'dan okuyor (`MobilController.Modullerim`). `B360_YETKI` o
tarafı taşıyacak şekilde tasarlandı ama bağlantı henüz kurulmadı; mobil
ekranlar bu panele bağlanırken yapılacak.

**Panelin yayın adresi.** Geliştirmede `localhost:5180`. Adres belirlenince
`vite.config.ts` içindeki `base` ve API'deki `Panel:Adresler` güncellenecek.

## Rapor Merkezi (v960)

Menü: **Rapor Merkezi** (`/portal/rapor-merkezi`). Yetki: Yönetim → Yetkiler → "Rapor Merkezi" (sayfa kodu `rapormerkezi`). Şubeye kilitli kullanıcı yalnızca kendi şubesini görür.

Sekmeler: Genel Bakış, Satış Analizi, Depo & Stok, Şube Karşılaştırma. Süzgeçler: dönem, bölge (Yetkiler → Bölgeler), şube, kategori (Mikro ana grup).

Veri kaynakları:
- Ciro / kâr / fire / kategori / şube: `MikroDB_V15_BICEN.STOK_HAREKETLERI` (satış: sth_tip=1, cins 0-1, evraktip 1-4; müşteri iadesi düşülür; fire cins 4,5,10).
- Brüt kâr: KDV hariç net − son 365 günün ortalama alış maliyeti.
- Şube stoğu ve stok günü: `PUSULA`; merkez depo (100+103) hareketlerden.
- Transfer: `DEPOLAR_ARASI_SIPARISLER` (merkezden, son 14 gün).
- SKT: Mikro parti/lot (`PARTILOT`) kullanılıyorsa.
- Fiş sayısı, saat dağılımı ve ödeme tipi: Yönetici → Rapor Merkezi → **Veri kaynakları** ekranında PosBack sorgusu tanımlanırsa kasadan; tanımlı değilse fiş = Mikro evrak sayısı, saat = satırın oluşturulma saati.

Satış küpü arka planda hazırlanır ve bellekte tutulur; 7 günden eski günler sunucunun TEMP klasörüne (`bicen360-rapor-merkezi`) yazılır. Klasör `appsettings.json` → `RaporMerkezi:OnbellekKlasoru` ile değiştirilebilir.

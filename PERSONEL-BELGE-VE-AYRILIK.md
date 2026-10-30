# Personel Belgeleri ve Ayrılacak Personel

> README ana dosyada olması gerekirdi; o dosya farklı bir kodlamayla
> kaydedilmiş ve düzenlenmeye elverişli değil. Bir sonraki elden geçirmede
> içeri taşınmalı.

## Belgeler

Tutanak, ihtar, savunma ve sözleşme gibi özlük evrakları personel kartındaki
**Belgeler** bölümünden yükleniyor (`KRY_PERSONEL_BELGE`). Dosyanın kendisi
diskte, künyesi tabloda duruyor: ikili veriyi tabloya koymak yedek boyutunu
hızla şişiriyordu.

Belgeler kimlik numarasıyla da eşleşiyor. Personel ayrılıp geri döndüğünde
Mikro yeni bir personel kodu veriyor ve eski tutanakları yeni kartında
görünmez oluyordu.

Yükleme yetkisi yönetici, İK ve İK yöneticisinde; bölge müdürü ve
koordinatör personelin kimlik bilgisini bile göremezken bunları görmemeli.
Silme yalnızca yöneticide ve kayıt gerçekten silinmiyor, gizleniyor — dosya
diskte kalıyor. Özlük evrakının yanlışlıkla ya da kasten yok edilmesi geri
alınamaz bir kayıp olurdu.

Belge türü serbest metin değil sabit liste: aynı şey "tutanak", "Tutanak" ve
"tutanak tuttuk" diye üç ayrı biçimde giriliyor ve süzmek imkânsız hâle
geliyordu.

Klasör `Belge:Klasor` ayarıyla değiştirilebiliyor; boşsa uygulama klasörünün
altındaki `personel-belge`. IIS'te uygulama havuzunun kendi klasörüne yazma
izni olmadığında yükleme başarısız oluyor ve sebebi hem günlüğe hem ekrana
yazılıyor.

| Uç | İş |
|---|---|
| `GET /api/PersonelBelge?kod=` | Listeleme |
| `POST /api/PersonelBelge` | Yükleme (çok parçalı) |
| `GET /api/PersonelBelge/Indir/{id}` | İndirme |
| `DELETE /api/PersonelBelge/{id}` | Gizleme |

İndirme belirteci başlıkla gidiyor, adres satırıyla değil: belge bağlantısı
kopyalanıp paylaşıldığında oturum bilgisi de gitmiş olurdu.

## Ayrılacak personel

İhbar süresi başlayan personelin Mikro'daki `per_cikis_tar` alanına ileri bir
tarih yazılıyor. Sistemin geri kalanı "çıkış tarihi dolu ise ayrılmış"
saydığı için bu kişiler listelerden anında düşüyordu; oysa çıkış gününe kadar
çalışıyorlar, norm kadroda yerleri duruyor ve yerlerine alım planlanması
gerekiyor.

`AyrilacakPersonelServisi` bu kümeyi ayrıca veriyor. Veri Mikro'ya yeniden
sorulmuyor, `PersonelKaynagiServisi` üzerinden okunuyor — o taraf kolon
adlarının sürümden sürüme değişmesini zaten karşılıyor ve sonucu
önbellekliyor.

**Çalışıyor sayılıyorlar.** `PersonelKaynagiServisi` artık çıkışı ileri
tarihli personele `Durum = 1` veriyor. Önceden çıkış tarihi dolu olan herkes
"ayrılmış" sayılıyordu; ihbar süresindeki personel listede Ayrılan sekmesine
düşüyor, mevcut sayımından çıkıyor ve norm kadroda yeri boşalmış gibi
görünüyordu. Oysa kişi hâlâ işe geliyor ve vardiya açıyor. `Ayrilacak`
alanıyla ayrıca işaretleniyorlar; personel listesinde çıkış tarihinin yanında
turuncu rozet çıkıyor.

Görüldüğü yerler:

- **Norm kadro raporu** — şube bazında "Ayrılacak" sütunu, üstüne gelince
  kişi listesi, üst şeritte tıklanabilir toplam kartı. Karta basınca kim,
  hangi şubeden, hangi tarihte ayrılacağı ve çıkışa kaç gün kaldığı tek
  listede açılıyor; sayıyı görmek yetmiyordu, satır satır aramak
  gerekiyordu. Sayılar mevcuttan düşülmüyor; kişi hâlâ
  çalışıyor. Norm tutuyor görünen bir şube iki hafta sonra üç kişi eksik
  kalabiliyordu.
- **Personel kartı** — başlıkta rozet, üstte çıkış tarihini gösteren uyarı
  şeridi. Bu bilgi ek bilgiler arasında bir satır olarak duruyordu ve gözden
  kaçıyordu.
- **`GET /api/Personel/Ayrilacaklar`** — liste ve bu hafta çıkacakların sayısı.

## Uyarı

`AyrilikUyariGorevi` saatte bir bakıyor; çıkışına bir gün kalan personel için
İK uzmanı, İK yöneticisi ve yöneticinin panel çanına bildirim düşüyor. Çıkış
tarihi haftalar önce yazılıp sonra unutuluyordu: çıkış işlemleri, zimmet
teslimi ve yerine alım son güne kalıyordu.

Uzmanın şube kısıtı varsa yalnızca kendi şubeleri; kısıt tanımlı değilse
tamamı. Kullanıcıdaki liste şube *kodlarını* tutuyor, personeldeki birim ise
Mikro'daki iş grubu *adı*; ikisi ayarlardaki şube tanımı üzerinden, sistemin
geri kalanının kullandığı eşleştirmeyle bağlanıyor.

Gönderilen uyarılar `KRY_AYRILIK_UYARI` tablosuna yazılıyor. Bu kayıt olmadan
görev her çalıştığında aynı uyarı tekrar düşüyor ve çan okunmadan
kapatılıyordu.

---

## Ayar kaydetmede birleştirme

Ayarların tamamı `KRY_AYARLAR` içinde tek bir JSON belgesinde duruyor ve
panelin her sekmesi yalnızca kendi alanlarını biliyor. `POST /api/Ayar/Form`
gövdeyi tipli bir nesneye bağlayıp belgenin tamamını yazdığı için,
gönderilmeyen her alan varsayılanına düşüyordu — "gönderilmedi" ile "boş
bırakıldı" ayırt edilemiyordu.

Görünen sonucu: Form Ayarları sekmesinde tek bir değişiklik yapıp kaydetmek,
o ekranda hiç görünmeyen **sol menü sırasını** siliyordu ve menü her
seferinde yeniden diziliyordu.

Uç artık ham JSON'a bağlanıyor ve `AyarServisi.Birlestir` yalnızca gövdede
bulunan alanları mevcut belgenin üzerine yazıyor. Anahtar eşleşmesi
büyük/küçük harfe duyarsız: aynı alanın iki ayrı yazımla belgede
ikiye katlanmasını önlüyor.

Panel tarafında da Form Ayarları sekmesi yüklediği ayarın tamamını saklayıp
kaydederken geri gönderiyor; sunucudaki birleştirme asıl çözüm, bu ikinci
güvence.

Yeni bir ayar sekmesi eklenirken aynı uca yazılabilir; artık başka alanları
silme riski yok.

---

## Ek notlar (v646)

### Belge boyutu

Sınır 500 MB. Üç yerde birden açılması gerekiyordu: denetleyicideki
`RequestSizeLimit`, `FormOptions.MultipartBodyLengthLimit` ve IIS'in kendi
`MaxRequestBodySize` değeri. Biri eksik kalırsa istek denetleyiciye hiç
ulaşmıyor ve açıklayıcı bir mesaj olmadan düşüyor.

IIS'te ayrıca `web.config` içindeki `maxAllowedContentLength` değerinin de
artırılması gerekir (bayt cinsinden, 524288000). Aksi hâlde büyük dosyalar
404.13 ile reddedilir.

### Önizleme

`GET /api/PersonelBelge/Onizle/{id}` dosyayı indirme yerine tarayıcıda
açıyor. Belirteç adres satırından kabul ediliyor, çünkü iframe ve img
etiketleri istek başlığı gönderemiyor. PDF, resim ve metin önizlenebiliyor;
Word ve Excel için ekran indirme öneriyor.

### Personelin kendi belgeleri

`GET /api/Mobil/Belgelerim` ve `GET /api/Mobil/BelgeGoster/{id}`. Sorgu
yalnızca isteyen kişinin kendi personel kodu ya da kimlik numarasıyla
eşleşen belgeleri döndürüyor; başka bir belge numarası denendiğinde kayıt
bulunamıyor. Mobilde Diğer → Bilgilerim ekranının altında liste olarak
duruyor, dokununca telefonun tarayıcısında açılıyor.

### Arıza fotoğrafı

Yükleme `FileSystem.uploadAsync` ile yapılıyor. iOS'ta dosya nesnesi taşıyan
bir `fetch` isteği sunucuya hiç ulaşmadan "Network request failed" ile
düşüyordu: kayıt açılıyor, fotoğraf her seferinde eklenemiyordu. Eski fetch
yolu yedek olarak duruyor.

`expo-file-system` bağımlılığı eklendi; derlemeden önce
`npx expo install expo-file-system` çalıştırılmalı.

### Pencereler

`bilesenler/Pencere.js`: uygulamanın kendi bildirim penceresi. İşletim
sisteminin gri kutusunda başarı ile hata aynı görünüyor, kaydın künyesi tek
paragrafa sıkışıyordu. Dört tür var (basari, hata, uyari, bilgi); tür
yalnızca rengi ve simgeyi değiştiriyor, yapı aynı kalıyor ki personel her
seferinde aynı yerde aynı şeyi arasın. Arıza kaydı sonucu ve vardiya okutma
sonucu bu pencereyi kullanıyor.

### Derleme notu

`Program.cs` içindeki üst düzey deyimlerde `const` bildirimi tür ister;
`const BelgeSiniri = …` derlenmiyor, `const long BelgeSiniri = …` olmalı.
Yerel sabitlerde tür çıkarımı yok.

---

## Ücret pusulası (v649)

Aylık bordrolar İK panelindeki **Ücret Pusulaları** sayfasından personel
bazında yükleniyor (`KRY_PUSULA`). Yalnızca PDF: pusulanın telefonda
açılabilmesi ve yazdırılabilmesi gerekiyor.

Personel mobilde Diğer → Bilgilerim ekranında görüyor, PDF'i açıyor ve
**Onayla** ya da **İtiraz et** diyor.

**Onay iki adımlı.** Tek dokunuşla imzalanan bir pusula yanlışlıkla
basıldığında geri alınamıyordu. İlk dokunuşta kuralı anlatan bilgilendirme
çıkıyor — "onay imza yerine geçer ve geri alınamaz", "yedi gün içinde
onaylamadığınız veya itiraz etmediğiniz takdirde onaylanmış sayılacaktır" —
ikinci dokunuşta onay kaydediliyor.

**İtirazda sebep hazır listeden** seçiliyor (fazla mesai eksik, prim eksik,
izin kesintisi hatalı, avans görünmüyor, net ücret hatalı, diğer) ve
açıklama isteniyor. Serbest metinde herkes farklı yazıyor ve İK hangi
konuda itiraz edildiğini ancak açıklamayı okuyarak anlıyordu. İtiraz hem
panel çanına hem İK'nın telefonuna düşüyor.

İK itirazı yanıtladığında pusula yeniden **bekliyor** durumuna geçiyor ve
süre baştan başlıyor: personel açıklamayı okumadan kaydın onaylanmış
görünmesi, itirazın çözüldüğü anlamına gelmiyor.

**Otomatik onay** `PusulaOtomatikGorevi` ile, saatte bir. Süresi dolan
pusula `otomatik = 1` ile işaretleniyor; panelde "süre doldu" notuyla
görünüyor, çünkü elle onaylanmış bir pusulayla aynı görünmesi sonradan
çıkan bir uyuşmazlıkta yanıltıcı olurdu. İtiraz edilmiş pusula otomatik
onaylanmıyor.

Panelde ayrıca **"açtı mı"** sütunu var: personelin pusulayı hiç açmadan
onaylayıp onaylamadığı görünüyor.

### Bildirim yönlendirmesi

`bildirim.js` içindeki eşleme genişletildi. Sunucudaki her `ekran` değerinin
burada karşılığı olmalı; eksik kalan değerde bildirime dokunan personel ana
sayfaya düşüyor ve bildirimin neyle ilgili olduğunu bulamıyordu. Belge ve
pusula Bilgilerim ekranına, iş emri Isler'e, arıza Ariza'ya gidiyor.

Belge yüklendiğinde personele bildirim gidiyor; önceden kendi evrakının
yüklendiğini bilmeden uygulamayı açıp bakmıyordu.

---

## Ücret pusulası — v651 değişiklikleri

### Tahakkuk sayfası taşındı

Tahakkuk artık ayrı bir menü değil, **Ücret Pusulaları** sayfasının
sekmesi. İkisi de aynı işin iki ucu: biri bordroyu Mikro'dan üretiyor,
diğeri personele iletip onayını topluyor. Ayrı menülerde durduklarında
hangisinden ne yapılacağı karışıyordu. Eski `tahakkuk` menü anahtarı aynı
sayfaya yönleniyor; kayıtlı sekme sırası ve yetki listeleri bozulmuyor.

### İşyeri bilgileri Mikro'dan

Pusulanın üst bloğundaki ünvan, adres ve ticaret sicil numarası artık
`PERSONEL_SSK_TANIMLARI` tablosundan, **bordronun bağlı olduğu SGK
işyerinden** okunuyor. Önceden panelden tek bir adres giriliyor ve bütün
şubelere aynısı yazılıyordu; oysa her işyerinin kendi ünvanı ve adresi var
ve pusula yanlış işyerini gösteriyordu.

Adres üç satıra bölünüyor (mahalle/cadde/sokak · kapı ve daire · ilçe/il),
çünkü pusulanın üst bloğu üç satır yüksekliğinde ve tek satıra sığdırılan
adres kesiliyordu.

SGK şubelerinin adı da `ssk_ismi` alanından geliyor; liste "adsız şube"
diye dolmuyor. Ayarda elle yazılmış bir ad varsa o üstün geliyor.

Telefon, faks ve web Mikro'nun bu tablosunda tutulmadığı için panelden
girilmeye devam ediyor; İşyeri sekmesindeki diğer alanlar Mikro doluysa
yok sayılıyor.

Kolon adları sürümden sürüme değişebildiği için satır tümüyle okunup
alanlar adla aranıyor, bulunamayan alan sessizce boş kalıyor ve panelden
girilen değer devreye giriyor.

### "Eşlenmedi" görünen hesaplanan alanlar

`netIstisnaOncesi` ve `kesintiIstisnaOncesi` Mikro'da sütun olarak yok;
makbuzda türetiliyor (net − GV istisnası − DV istisnası, toplam kesinti +
GV istisnası). Eşleme ekranı bunları boş bir seçim kutusuyla gösterip
"Eşlenmedi" yazıyordu — eşlenecek bir şey olmadığı hâlde eksik izlenimi
veriyordu. Artık "Hesaplanıyor" etiketi ve formülü görünüyor.

### Personel seçimi

Pusula yükleme penceresindeki sicil kutusu, ad soyad / sicil / T.C. kimlik
numarasıyla aranabilen bir seçim listesine dönüştü. Liste
`/api/Personel?durum=calisan` ucundan geliyor; uç bir dizi değil, içinde
sayımlar da olan bir nesne döndürüyor ve personeller onun bir alanında —
ilk sürümde bu gözden kaçtığı için liste boş görünüyordu.

### Derleme notu

`TahakkukController.Sayi()` `decimal?` döndürüyor. SGK şube numarası sözlük
anahtarı olarak kullanıldığında tam sayıya çevrilmeli; doğrudan geçirmek
CS1503 veriyor.

### Tahakkuk sekmesi kapalı

`Pusulalar.tsx` içindeki `TAHAKKUK_GORUNSUN` sabiti `false`. Bölüm hazır ve
çalışıyor ama şimdilik kullanılmıyor; sekmeyi ekranda tutmak İK'yı henüz
devreye alınmamış bir işe yönlendiriyordu. Açmak için değeri `true` yapmak
yeterli — bileşen, sunucu uçları ve menü yetkisi yerinde duruyor.

Tek sekme kalınca sekme çubuğu da çizilmiyor: tek başına duran bir sekme
başlığı gereksiz bir katman.

---

## Çalışma düzeni ve izin hesabı (v655)

### Sorun

Yıllık izin gün sayısı, çıkış ile dönüş arasındaki bütün takvim günleri
sayılarak bulunuyordu. Bunun iki sonucu vardı: 1 Mayıs'a ya da bayrama denk
gelen izin, personelin bakiyesinden hak etmediği günler yiyordu; mağaza
personelinin haftalık izin günü de yıllık izninden gidiyordu.

### Resmi tatiller

`KRY_RESMI_TATIL`. Yönetim → **Çalışma Düzeni → Resmi Tatiller** sekmesinden
giriliyor. Sabit tarihli millî bayramlar tek dokunuşla bir yıla ekleniyor;
dinî bayramların tarihi her yıl kaydığı için elle giriliyor. Arife günleri
"yarım gün" işaretlenebiliyor ve hesapta 0,5 düşülüyor.

Aynı güne ikinci tatil yazılamıyor — izin hesabı o günü iki kez düşerdi.

### Pozisyon grupları

`KRY_POZISYON_GRUBU`. Ünvanları ortak çalışma düzenine göre kümeliyor:
"Mağaza Personeli" haftada bir gün, "Merkez Ofis" cumartesi ve pazar izinli.
Ünvan listesi Mikro'dan geliyor; elle yazılan ünvan eşleşmediğinde grup
sessizce boşa düşüyordu.

İzin günü haftadan haftaya değişen gruplarda hiçbir gün işaretlenmiyor; o
zaman yalnızca resmi tatiller düşülmüyor.

Bu gruplar ileride yetki tanımında da kullanılacak: ünvan ünvan yetki
vermek yerine gruba verilecek.

### Hesap

`IzinGunuServisi.Hesapla` çıkış ve dönüş arasındaki günleri dolaşıp resmi
tatilleri ve grubun izin günlerini düşüyor. Dönüş tarihi personelin işe
döndüğü gün, izinli sayılmıyor.

Grup tanımlı değilse hiçbir gün düşülmüyor — tanım eksikken personelin
aleyhine davranmak yanlış olurdu; İK grupları tanımlayana kadar eski
davranış sürüyor. Tanımlar okunamazsa da eski davranışa dönülüyor: izin
kaydının hiç açılamamasındansa.

`GET /api/Izin/GunHesabi?cikis=&donus=&pozisyon=` gün sayısını ve hangi
günlerin düşülmediğini veriyor.

### Bekleyenler

- **Nöbet takvimi**: merkez ofisin beş haftada bir cumartesi nöbeti; şu an
  Excel'de takip ediliyor. Yıllık İzin sayfasının altına ayrı sayfa olarak
  gelecek.
- **Grup bazlı yetkiler**: pozisyon grupları menü ve rol yetkilerinde
  kullanılacak, hem İK panelinde hem portalda.
- **İzin ekranının** gün kutusunu `GunHesabi` ucuna bağlamak: şu an sayı
  elle yazılıyor, uç hazır ama ekran henüz kullanmıyor.

---

## v656 değişiklikleri

### Belge görünürlüğü

`KRY_PERSONEL_BELGE.personele_acik`. Tutanak ve ihtar gibi evrakların hepsi
personele açılmamalı; hangisini göreceğini İK seçiyor.

Varsayılan **kapalı**: yanlışlıkla açılan bir tutanağı geri almak, hiç
açılmamış olmasından daha zor. Yükleme penceresinde işaret kutusu var,
listede de "Personel görüyor mu" sütunundan tek dokunuşla değiştiriliyor —
yüklerken unutulan işareti düzeltmek için ayrı pencere açmak zahmetliydi.

Bildirim yalnızca belge personele açıldığında gidiyor; göremeyeceği bir
evrak için bildirim almak personeli boşuna tedirgin ediyordu. Kapatma
sessiz: "belgeniz kaldırıldı" demek gereksiz soru doğuruyor.

Mobil uçlar (`Belgelerim`, `BelgeGoster`) yalnızca açık belgeleri
döndürüyor; kapalı bir belgenin numarası denense bile bulunamıyor.

### Cloudflare doğrulaması kaldırıldı

Başvuru formundaki Turnstile hem istemciden hem sunucudan çıkarıldı. Gerçek
adayları da engelliyordu: doğrulama yüklenmediğinde ya da takıldığında
başvuru hiç gönderilemiyor, aday sebebini anlamıyor, İK'ya "form
çalışmıyor" diye telefon geliyordu.

Otomatik gönderimlere karşı kalan denetimler yerinde: istek hızı sınırı,
ülke kısıtı, form açılış süresi, kimlik numarası algoritması, fotoğraf
zorunluluğu ve aynı kimlikle tekrar başvuru engeli. Hepsi aday tarafında
görünmeden çalışıyor.

`TurnstileServisi` dosyası duruyor ama çağrılmıyor; ileride gerekirse
yeniden bağlanabilir.

### Eksik alana yönlendirme

Form uzun; "zorunlu alanları doldurunuz" uyarısı aday hangi alanın eksik
olduğunu aramak zorunda bırakıyor, çoğu yarıda bırakıyordu. Artık eksik
alan başka adımdaysa önce o adıma geçiliyor, sonra alan ekranın ortasına
kaydırılıp odaklanıyor ve uyarıda alanın kendi hata metni yazıyor.

---

## v656

### Belge görünürlüğü

`KRY_PERSONEL_BELGE.personele_acik`. **Varsayılan kapalı**: tutanak ve ihtar
gibi evrakların tamamının personele açılması İK'nın kararı olmalı, yükleme
anının varsayılanı değil.

Yükleme penceresinde işaret kutusu var; listede her satırda tek dokunuşla
açılıp kapanan bir düğme duruyor. Kapalıdan açığa geçişte personele bildirim
gidiyor — her açıp kapamada değil, yoksa telefonu boşuna titriyordu.

Mobil uçlar yalnızca açık belgeleri veriyor; kapalı bir belgenin numarası
elle denense de dosya dönmüyor.

### Başvuru formu

Tecrübe ve başvuru adımları tek adımda birleşti ("Tecrübe ve Başvuru").
Tecrübe adımı tek başına neredeyse boş bir sayfaydı ve aday iki kez "Devam
et" basıyordu. Adım sayısı artık `ADIM_ALANLARI` uzunluğundan okunuyor;
sabit yazıldığında adım birleştirince güncellemek unutuluyordu.

Eksik alana yönlendirme zaten vardı (`eksigeGit`): ilk hatalı alanın
adımına geçip alana kaydırıyor ve odaklanıyor.

### Cloudflare Turnstile

Sunucu tarafında daha önce kaldırılmıştı; geride kalan ölü kod da temizlendi
(`GuvenlikDogrulamasi.tsx`, ayar alanı). Otomatik gönderimlere karşı kalan
denetimler yerinde: istek hızı sınırı, ülke kısıtı, kimlik numarası
algoritması, fotoğraf zorunluluğu ve aynı kimlikle tekrar başvuru engeli.

### Sıradakiler

Bu turda istenip yapılmayanlar, önerilen sıra:

1. **Hafta sonu izinli grubu + QR**: gruba "hafta sonu izinli" işareti;
   o günlerde okutmayan personel "okutulmadı" sayılmayacak.
2. **Mesai saatleri ve hatırlatma**: gruba başlangıç/bitiş saati; saatinde
   okutmayana "henüz vardiya girişi yapmadınız" bildirimi.
3. **Haftalık izin günü seçimi**: personel mobilden seçecek, mağaza müdürü
   onaylayacak; değişiklik talebi ve onay akışı, seçili günde okutmama
   "okutulmadı" sayılmayacak, başka gün okutmadığında "izin gününüz
   değiştiyse güncelleyiniz" bildirimi.
4. **Doğum günü kutlaması**: uygulamaya girişte balonlu pencere, metni
   panelden.
5. **Nöbet takvimi**: merkez ofisin beş haftada bir cumartesi nöbeti.
6. **Grup bazlı yetkiler**: pozisyon gruplarının menü ve rol yetkilerinde
   kullanılması, hem panelde hem portalda.

---

## v657 — çalışma düzeni, hatırlatma, doğum günü

### 1. İzin günlerinde "okutulmadı" görünmemesi

`OkutmaVeriHazirlayici`, rapor aralığının tamamı izinli olan personeli
listeden çıkarıyor. Hafta sonu izinli merkez ofis çalışanları cumartesi
raporunda "okutmadı" diye görünüyor ve listeyi kullanılamaz hâle
getiriyordu. Aralığın bir günü bile çalışma günüyse kişi raporda kalıyor.

İzin günleri pozisyon grubundan, resmi tatiller tanım tablosundan geliyor.
Grup formunda "Hafta sonu izinli" kısayolu var: cumartesi ve pazarı tek
dokunuşla işaretliyor.

Tanım yoksa kimse çıkarılmıyor — grup tanımlanmadan personeli raporun
dışına almak, eksik veriyi sessizce gizlemek olurdu.

### 2. Mesai saati ve vardiya hatırlatması

Gruba başlangıç ve bitiş saati ile "kaç dakika sonra hatırlat" değeri
giriliyor. `VardiyaHatirlatmaGorevi` on dakikada bir bakıyor; mesai
başlangıcı + gecikme anı pencereye düştüğünde, o gün karekod okutmamış
personele bildirim gönderiyor.

Hatırlatma tam saatinde değil, gecikme kadar sonra: saatinde gönderilen
bildirim yolda olan ve birazdan okutacak personeli boşuna rahatsız
ediyordu. Resmi tatilde ve grubun izin gününde gönderilmiyor.
`KRY_VARDIYA_HATIRLATMA` aynı gün ikinci bildirimi engelliyor.

Saat metin olarak tutuluyor ("08:30"); zaman tipinde tutmak, sunucunun saat
dilimi ve yaz saati değişimleri yüzünden bu basit ayarı gereksiz yere
karmaşıklaştırıyordu.

### 3. Doğum günü kutlaması

`GET /api/Mobil/DogumGunu` bugünün doğum günü olup olmadığını söylüyor.
Doğum tarihi Mikro'dan tek kişilik bir sorguyla okunuyor; personel kaydı
modelini genişletmek bütün personel sorgularını değiştirmeyi
gerektiriyordu.

Mobilde ana sayfa açılışında balonlu kutlama penceresi çıkıyor. Süsün
kendisi işin bir parçası: sade bir satır, kurumun tebriğinden çok bir
sistem bildirimi gibi duruyordu. Kutlama günde bir kez gösteriliyor ve bu
bilgi cihazda tutuluyor — sunucuda "gösterildi" işaretlemek, uygulamayı
kapatıp açan personelin kutlamayı hiç görmemesine yol açabilirdi.

Metin Yönetim → Form Ayarları'ndaki **Doğum günü kutlama metni** alanından
geliyor.

### Kalanlar

- **Haftalık izin günü seçimi**: personel mobilden seçecek, mağaza müdürü
  onaylayacak; değişiklik talebi, seçili günde okutmama muafiyeti ve
  "izin gününüz değiştiyse güncelleyiniz" bildirimi.
- **Nöbet takvimi**: merkez ofisin beş haftada bir cumartesi nöbeti.
- **Grup bazlı yetkiler**: pozisyon gruplarının menü ve rol yetkilerinde
  kullanılması, hem panelde hem portalda.

---

## v658 — haftalık izin, nöbet, grup yetkileri

### 3. Haftalık izin günü

`KRY_HAFTALIK_IZIN`, kişi başına tek satır: geçerli gün ile bekleyen talep
aynı kayıtta. Talep geçmişi ayrı tabloya alınmadı; İK'nın ihtiyacı "şu an
hangi gün" ile "bir talep bekliyor mu" sorularından ibaret.

Akış: personel mobilden gün seçiyor → mağaza müdürüne bildirim gidiyor →
müdür onaylıyor ya da sebep yazarak reddediyor → personele sonuç bildirimi.
Onaysız geçerli olmuyor; onaysız seçim, okutma raporundaki muafiyeti
denetimsiz bırakırdı.

Reddedilirse önceki gün korunuyor: reddedilen bir talep yüzünden personelin
hiç izin günü kalmaması, o günü de "okutmadı" saydırırdı.

Müdür yalnızca kendi mağazasını onaylayabiliyor. Müdürlük, ünvanda "müdür"
geçip "yardımcı" geçmemesinden anlaşılıyor.

**Okutma raporu** onaylanmış kişisel izin gününü de muaf tutuyor — grup
düzeyindeki sabit günden farklı olarak mağazada izin günü kişiden kişiye
değişiyor.

**Hatırlatma** izin gününe göre değişiyor: o gün izinliyse bildirim
gitmiyor. İzin günü tanımlı olup başka gün okutmadıysa metin farklı —
"haftalık izin gününüz X görünüyor, değiştiyse güncelleyiniz". Asıl sorun
genelde izin gününün değişmiş ve güncellenmemiş olması oluyor.

Uçlar: `GET/POST /api/HaftalikIzin` (yönetim), `Benim`, `Sec`,
`Bekleyenler`, `Onay/{id}`.

### 5. Nöbet takvimi

`KRY_NOBET`. Elle tek tek atama ya da **sırayla üretim**: gruptaki personel
ada göre sıralanıp seçilen gün her N haftada bir tekrarlanacak biçimde
dağıtılıyor (merkez ofiste cumartesi, beş haftada bir). Sıra Excel'de elle
tutulduğunda birinin iki kez üst üste nöbet tutması ya da hiç tutmaması sık
oluyordu.

Üretim var olan kayıtların üzerine yazmıyor: elle yapılmış bir değişikliği
otomatik üretim silmemeli. Atlanan tarihler sonuçta bildiriliyor.

Nöbetçiye bildirim gidiyor; kimin ne zaman tutacağı ona da ulaşmalı.
Personel kendi nöbetlerini `GET /api/Nobet/Benim` ile görüyor.

### 6. Grup bazlı yetkiler

Portalda mobil modül yetkisi artık üç katmanlı: **kişi → ünvan → grup**.
Daha dar tanım geniş olanı eziyor; hiçbiri yoksa modül açık.

Ünvan ünvan yetki vermek, yeni bir ünvan tanımlandığında yetkinin
unutulmasına yol açıyordu. Grup yetkisi gruptaki bütün ünvanlara birden
uygulanıyor.

Gruplar Kariyer tarafında (Çalışma Düzeni ekranı) tanımlanıyor, portal aynı
veritabanındaki tabloyu okuyor. Tablo yoksa ya da ünvan hiçbir gruba bağlı
değilse grup katmanı devre dışı kalıyor ve çözüm eskisi gibi yalnızca
ünvana bakıyor.

Yetki matrisine **Mobil · Grup** görünümü eklendi.

### Panel ekranları

Bu turda sunucu tarafı ve portal yetki matrisi tamamlandı. İK panelinde
haftalık izin listesi ve nöbet takvimi ekranları henüz yok; uçlar hazır,
ekranlar bir sonraki turda.

---

## v659 — ekranlar tamamlandı

### İK paneli: İzin Düzeni

Yeni menü öğesi. İki sekme:

**Haftalık İzin Günleri** — personelin geçerli günü, bekleyen talebi ve son
işlem. Bekleyen talepler listenin başında; tek tıkla onaylanıyor, reddederken
sebep yazılıyor ve sebep personele bildirim olarak gidiyor.

**Nöbet Takvimi** — tarih aralığı seçilip liste görülüyor, bugünün nöbeti
vurgulanıyor. "Sırayla üret" grubu, günü, kaç haftada bir ve kaç nöbet
üretileceğini sorup dönüşümlü dağıtıyor; var olan kayıtların üzerine
yazmıyor ve kaç tarihin atlandığını söylüyor. "Başlangıç sırası" alanı,
çizelgeyi yenilerken kaldığı yerden devam etmek için.

Menü sırasından Yıllık İzin'in altına alınabiliyor.

### Mobil: Bilgilerim

**Haftalık İzin Günüm** — yedi gün tek satırda; dokunulan gün müdür onayına
düşüyor. Onaylı gün yeşil, bekleyen talep turuncu. Reddedilen talebin sebebi
ekranda duruyor.

**Onay Bekleyen İzin Talepleri** — yalnızca mağaza müdürüne dolu geliyor;
sunucu kendi şubesi dışındaki talepleri vermiyor. Onayla ve reddet
düğmeleri satırın içinde.

**Nöbetlerim** — personelin kendi nöbetleri, en yakın tarih üstte.

Bölümlerin verisi tek seferde çekiliyor ama her birinin hatası ayrı
yutuluyor: biri okunamazsa diğer bölümler yine açılmalı.

---

## v666

### Mobil oturum artık her gün kapanmıyor

Jeton süresi panelde 12 saat; mobil de aynı süreyi kullandığı için personel
her gün yeniden kimlik ve SMS ile giriş yapmak zorunda kalıyordu — karekod
okutmak için uygulamayı açtığı anda.

Mobil jeton `Mobil:OturumGunu` (varsayılan 365 gün) kadar geçerli. Güvenlik
süreye değil iki denetime dayanıyor ve ikisi de her istekte çalışıyor:
jetondaki cihaz kimliği kayıtlı cihazla eşleşmeli, `oturum_acik` bayrağı
açık olmalı. Çıkışta ya da başka telefondan girişte jeton anında
geçersizleşiyor.

### Ana sayfa kartları

Kalan İzin, Son Prim, Performans ve Bu Ay Mesai kartları ilgili ekrana
gidiyor. Dokunulabilir kutu yalnızca bir işlev verildiğinde çiziliyor;
hepsini dokunulabilir yapmak, hiçbir yere gitmeyen kartlarda da basılıyor
hissi veriyordu. Sağ üstteki küçük ok kartın bir yere götürdüğünü
gösteriyor.

### Doğum günü kutlaması

Konfeti eklendi: kırk parça yukarı fırlayıp dönerek süzülüyor. Tek yönlü
düşüşte patlama hissi oluşmuyordu, o yüzden önce yukarı sonra aşağı.
Konfeti kısa sürüyor, balonlar devam ediyor — ikisi aynı anda bitince ekran
boşalıyordu.

Balonlar da gerçekçileşti: alta doğru daralan oval gövde, sol üstte ışık
yansıması ve ağız düğümü. Tam daire balondan çok topa benziyordu.

**Ses eklenmedi.** `expo-audio` bağımlılığı ve ses dosyası gerekiyor; ayrıca
sessiz moddaki telefonda ve mağaza ortamında ne yapılacağına karar
verilmeli. İstenirse ayrıca eklenir.

### Fiyat Kontrol

Diğer menüsünde "YAKINDA" rozetiyle görünüyor, dokununca bilgi veriyor.
Satır soluk değil rozet belirgin: soluk satır dokunulamaz izlenimi veriyor
ve modülün varlığı gözden kaçıyordu.

### Sıradakiler

Bu mesajda istenip yapılmayanlar:

1. **Bilgilerim'in modülleştirilmesi** — Belgelerim, Kasa ve Terminal
   Bilgileri, Kartvizit (rehbere ekleyen QR), Eğitim Dokümanları ayrı
   satırlar olarak.
2. **Eğitim Dokümanları** — İK ve BT'nin video/belge/bağlantı paylaşımı,
   pozisyon seçerek gönderim.
3. **İşlerim ve Kontrol Listeleri elden geçirme** — mobilden iş atama,
   açıklamada tablo/onay kutusu, satır ve sütun kilitleme, yorum satırı.
4. **Etik Hat** — anonim bildirim, bildirim numarası, durum takibi, panelde
   ayrı modül ve yetki tanımı.

3 ve 4 tek başlarına birer tur; 1 ve 2 birlikte yapılabilir.

---

## v667 — Bilgilerim modülleri ve Eğitim Dokümanları

### Bilgilerim artık modül listesi

Belgeler, pusulalar ve kasa bilgileri tek sayfada alt alta diziliydi; sayfa
uzadıkça personel aradığını bulamıyordu. Şimdi beş satır var, her biri kendi
ekranında açılıyor: Belgelerim, Ücret Pusulalarım, Kasa ve Terminal, Eğitim
Dokümanları, Kartvizitim. Belge sayısı ve bekleyen pusula sayısı satırın
sağında rozet olarak duruyor.

Alt ekranların hepsi `BilgiModul.js` içinde: hepsi aynı düzeni paylaşıyor ve
ayrı dosyalara bölmek beş kez tekrar eden başlık, yükleme ve hata yönetimi
demekti. Hangi bölümün açılacağını rota parametresi söylüyor; her modül
yalnızca kendi verisini çekiyor.

**Kasa ve Terminal** — şifre kapalı başlıyor, dokununca açılıyor. Personel
kasada dururken ekranı başkasının görmesi olağan. El terminali alanı
"yakında" notuyla yerini tutuyor.

**Kartvizitim** — karekod vCard biçiminde. Karşıdaki kişi kamerayla
okuttuğunda telefon doğrudan "Kişilere ekle" ekranını açıyor; düz metin
karekodda bilgiler elle yazılmak zorunda kalıyordu. Ad, soyad, ünvan,
telefon, şube ve kurum gidiyor.

`react-native-qrcode-svg` bağımlılığı eklendi; derlemeden önce
`npx expo install react-native-qrcode-svg` çalıştırılmalı.

### Eğitim Dokümanları

`KRY_EGITIM` ve `KRY_EGITIM_OKUMA`. İK ve BT video, belge ya da bağlantı
paylaşıyor; bunlar WhatsApp gruplarında dolaşıyordu ve yeni gelen personel
hiçbirini görmüyordu.

Hedef ünvan boşsa herkese açık, doluysa yalnızca o ünvanlardakiler görüyor —
kasiyere depo eğitimi göstermek listeyi kullanışsız yapıyordu. Paylaşımda
hedef kitleye bildirim gidiyor.

**Zorunlu** işaretli eğitimler personelin listesinde başta duruyor ve
açılmadıkça uyarı görünüyor. Panelde "Açan" sütunu kimin açtığını veriyor:
"paylaştık" ile "okundu" ayrı şeyler.

Video ileri sarılabilsin diye aralıklı indirme açık; olmadan telefondaki
oynatıcı dosyanın tamamını indirmeden başlamıyor. Bağlantı türünde okundu
işareti ayrı isteniyor, çünkü tarayıcıya çıkıldığında sunucu bunu göremiyor.

Panelde yeni menü: **Eğitim Dokümanları**. Yetkisi varsayılan kapalı, Rol
Yetkileri'nden açılmalı.

### Kalanlar

1. **İşlerim ve Kontrol Listeleri elden geçirme** — mobilden iş atama,
   açıklamada tablo ve onay kutusu, satır/sütun kilitleme, yorum satırı.
2. **Etik Hat** — anonim bildirim, bildirim numarası, durum takibi, panel
   modülü ve yetki tanımı.

---

## v668 — izin gün hesabı ve Etik Hat

### İzin gün hesabı ekrana bağlandı

Yıllık İzin ekranındaki gün sayısı artık takvim farkıyla değil
`/api/Izin/GunHesabi` ile bulunuyor: resmi tatiller ve personelin pozisyon
grubuna tanımlı haftalık izin günleri bakiyeden düşülmüyor. Altında hangi
günlerin düşülmediği satır satır yazıyor — sayının neden takvim farkından
küçük olduğu görünmezse kullanıcı hesabı yanlış sanıyordu.

Sunucuya ulaşılamazsa eski takvim farkına düşülüyor; izin kaydının hiç
açılamaması daha kötü.

### Etik Hat

Üç tablo: `KRY_ETIK`, `KRY_ETIK_EK`, `KRY_ETIK_HAREKET`.

**Anonimlik.** Anonim bildirimde personel kodu, adı ve telefonu tabloya
*hiç yazılmıyor*. Sütunu doldurup ekranda gizlemek, veritabanına erişimi
olan herkes için anonimliği ortadan kaldırırdı. Doğal sonucu: anonim
bildirim "Bildirimlerim" listesinde çıkmıyor, çünkü eşleştirecek veri yok.
Personel onu takip numarasıyla sorguluyor ve numara bildirimden sonra bir
kez gösteriliyor — kopyalama düğmesiyle birlikte.

**Takip numarası** `ETH-2026-000001` biçiminde, yıl içinde sırayla artıyor.
Kayıt kimliğini doğrudan vermek toplam bildirim sayısını dışarıya söylerdi.

**Yetki sabit rol değil.** Hangi rolün bildirimleri göreceği Yönetim → Rol
Yetkileri'ndeki `etik` menüsünden belirleniyor. Etik bildirimlerin önemli
bir kısmı yönetim zinciri hakkında oluyor ve bu karar yazılıma gömülemez.
Bildirim alıcıları da aynı yetkiden türetiliyor: bildirim alan ama kaydı
açamayan kullanıcı olmamalı.

Kimliğini paylaşarak açılmış bir bildirimi başkası numarayla sorgulayamıyor;
anonimde zaten sahip bilinmiyor.

**Panel** — durum kutuları, süzme, bildirim ayrıntısı, ekler, işlem geçmişi
ve durum güncelleme. Kurul notu için "bildirimi yapan bu notu görsün"
seçeneği var; kendi aralarındaki değerlendirme personele gitmemeli.

**Mobil** — Diğer menüsünde herkese açık (bildirimin önündeki en büyük engel
nereye başvurulacağının bilinmemesi). İki sekme: bildirim formu ve takip.

### Kalan

**İşlerim ve Kontrol Listeleri elden geçirme** — mobilden iş atama,
açıklamada tablo ve onay kutusu, satır/sütun kilitleme, yorum satırı,
görünüm ve buton düzeni.

---

## v669 — iş emri içeriği (sunucu ve düzenleyici)

### Yapılandırılmış içerik

İş emrinin açıklaması düz metindi; bir işi maddelere bölmek, hangi
maddenin yapıldığını takip etmek ya da sütunlu bir çizelge vermek mümkün
değildi.

Üç blok tipi var: **biçimli metin** (kalın, eğik, boyut, renk), **kontrol
listesi** ve **tablo**. Bloklar `KRY_IS_EMRI.icerik` içinde JSON olarak
tutuluyor: yapı işten işe değişiyor ve her blok tipi için ayrı tablo açmak,
yeni bir tip eklendiğinde göçe zorluyordu.

### Kilitleme ve yorum satırı

Tabloda her sütun ve her satır ayrı ayrı kilitlenebiliyor. Kilitli hücreler
atanan kişiye salt okunur geliyor — işi atan çizelgenin hangi kısmına
dokunulmayacağını belirlemeli. Sütun tipleri: metin, sayı, onay kutusu.

Her tablonun altında **yorum satırı** var; yalnızca işi yapan kişi
yazabiliyor.

### Doldurma ayrı saklanıyor

Atananın doldurduğu değerler `doldurma` sütununda, özgün içerikten ayrı:
iş atayan neyi verdiğini, atanan neyi doldurduğunu ayrı görebilmeli.
İçeriği yalnızca işi atan düzenleyebiliyor; atananın çizelgeyi
değiştirebilmesi kilitli sütunların anlamını ortadan kaldırırdı.

İlk doldurmada iş kendiliğinden "Devam ediyor" oluyor — personel çizelgeyi
işaretleyip durumu ayrıca değiştirmeyi unutuyordu.

### Eklediğim şeyler

- **İlerleme oranı**: işaretlenen kutucukların yüzdesi kaydetme anında
  hesaplanıp `ilerleme` sütununa yazılıyor; listede çubuk olarak
  gösterilebilir. Her açılışta JSON ayrıştırmak gereksiz. İşaretlenecek
  hiçbir şey yoksa oran yok — sıfır göstermek işi hiç yapılmamış gibi
  gösteriyordu.
- **Şablonlar** (`KRY_IS_SABLON`): aynı çizelge her hafta yeniden
  kuruluyordu. Bir kez hazırlanıp tekrar kullanılabiliyor.
- **Metin biçimlendirme**: uzun bir işin başlığını kalın ya da renkli
  yazabilmek, işi okunur yapmanın en ucuz yolu.

### Kalanlar

- `IsEmirleri.tsx` ekranına düzenleyicinin bağlanması (bileşen hazır)
- Mobilde doldurma ekranı ve iş atama
- Kontrol Listeleri sayfasının elden geçirilmesi

---

## v670 — iş içeriği ekranlara bağlandı

### Panel

İş emri ayrıntı penceresine **İçerik** kartı eklendi. İşi atan "Düzenle"
ile blokları kuruyor: metin (kalın, eğik, boyut, renk), kontrol listesi ve
tablo. Tabloda sütun tipi metin/sayı/onay seçiliyor, sütun ve satır ayrı
ayrı kilitleniyor.

Görüntüleme kipinde işaretlenen kutucukların oranı ilerleme çubuğu olarak
duruyor. İşaretlenecek bir şey yoksa çubuk hiç çizilmiyor.

İçerik JSON çözülürken hata yutuluyor ve boş içerik gösteriliyor: bozuk bir
kayıt ekranın tamamını kilitlememeli.

### Mobil

Personel işi açtığında çizelge kartın içinde geliyor. Kilitli hücreler
girdi değil düz metin olarak çiziliyor — dokunulabilir görünen ama
yazılamayan bir kutu kafa karıştırıyor.

**Tablolar telefonda satır kartına dönüşüyor**: sütunlar yan yana
sıkıştırılmıyor, her satır kendi kartında alanlar alt alta. Yatay
kaydırmalı tablo tek elle kullanılamıyordu.

Kaydet düğmesi yalnızca değişiklik yapıldığında görünüyor; her açılışta
duran bir düğme, kaydedilmesi gereken bir şey olduğu izlenimi veriyordu.

İlk doldurmada iş kendiliğinden "Devam ediyor" oluyor.

### Kalan

- Mobilden iş atama (yetkisi olan kullanıcılar için)
- Kontrol Listeleri sayfasının elden geçirilmesi

---

## v671 — mobilden iş atama

Mağaza müdürü ve şefler tezgâhın başındayken iş verebiliyor. Paneli açmak
için ofise gitmek, işin hiç kaydedilmemesine yol açıyordu.

Yetki sunucudan geliyor (`IsAtanabilecekler`): ünvan eşleşmesini istemcide
yapmak, ünvan adı değiştiğinde sessizce bozuluyordu. Liste yalnızca kendi
şubesindeki personeli veriyor ve atama ucu bunu ayrıca denetliyor — uç
doğrudan da çağrılabilir.

Form panelde olduğu kadar zengin değil: başlık, kişi, öncelik, açıklama ve
isteğe bağlı bir yapılacaklar listesi. Telefonda tablo kurdurmak tek elle
kullanılamayan bir ekran demekti; tablo gerektiren işler panelden atanıyor.

Maddeler panelle aynı blok yapısında gönderiliyor: aynı işi iki ayrı
biçimde saklamak, panelde açıldığında çizelgenin görünmemesine yol açardı.

---

## v672 — Kontrol Listeleri elden geçirme

### Düzeltilen hata

Mobilde eksik madde uyarısı, süzülmüş liste üzerinden yeniden
numaralandırıyordu: personele "3. madde eksik" deniyor ama ekranda üçüncü
sırada başka bir madde duruyordu. Numara artık listedeki gerçek sıradan
geliyor.

Uyarı başlığı da kaç madde eksik olduğunu söylüyor ve altı maddeden
fazlasını "… ve N madde daha" diye özetliyor; on beş satırlık bir uyarı
kutusu okunmuyordu.

### Eklenenler

**İlerleme çubuğu** (mobil) — uzun listelerde personel nerede olduğunu
göremiyordu. Üstte sabit duruyor: "12/20 madde tamam".

**Liste çoğaltma** (panel) — benzer listeler sıfırdan yazılıyordu: kasap
reyonu listesiyle manav listesi arasında üç madde fark varken yirmi madde
yeniden giriliyor, arada satır atlanıyordu. Kopya maddeleriyle birlikte
oluşuyor, **pasif** açılıyor ve hemen düzenlemeye giriliyor — düzenlenmeden
personele düşen bir kopya, aynı işin iki kez yapılmasına yol açardı.

---

## v674 — iş emri içeriği görünmüyordu

### Neden görünmüyordu

Ayrıntı penceresi listedeki özet kayıtla açılıyordu. Liste ucu içerik
alanlarını döndürmüyor — otuz işi listelerken her birinin çizelgesini
taşımak gereksiz — dolayısıyla pencerede içerik hep boş geliyor ve
"Düzenle" düğmesi de görünmüyordu (atayan alanı da listede yok).

Artık pencere açılırken `/api/IsEmri/{id}` ile tam kayıt isteniyor. İstek
başarısız olursa listedeki özetle açılıyor: pencerenin hiç açılmaması daha
kötü.

D�zenleme hakkı ayrıca sekmeden de anlaşılıyor — "Attıklarım" sekmesinden
açılan iş zaten bu kullanıcının attığı iştir.

### Kenar boşlukları

`IsEmirleri.tsx` ve `Checklistler.tsx` `ik-icerik` sarmalayıcısını
kullanmıyordu; içerik sol menüye ve sağ kenara yapışıyordu. Panelde
`Content` kendi boşluğunu kurmuyor, her sayfa kendi sarmalayıcısını
koyuyor.

---

## v675 — mobil açılışta beyaz ekran

Uygulama açılışta boş kalıyordu. Sebep: App.js bütün ekranları en baştan
yüklüyor ve çözülemeyen tek bir import bütün paketi düşürüyor — ekranda
hata bile görünmüyor, sadece beyaz kalıyor.

İki kırılgan import vardı:

- `react-native-qrcode-svg` (kartvizit karekodu)
- `expo-file-system/legacy` (arıza fotoğrafı yükleme)

İkisi de artık isteğe bağlı yükleniyor. Paket yoksa yalnızca o bölüm devre
dışı kalıyor: kartvizitte karekod yerine açıklama ve paylaşma düğmesi,
fotoğraf yüklemede eski fetch yolu. Bir bölümün çalışmaması, uygulamanın
hiç açılmamasından iyidir.

`expo-file-system` için önce `/legacy`, bulunamazsa ana giriş deneniyor;
`/legacy` giriş noktası paketin bütün sürümlerinde yok.

Ayrıca `Clipboard` react-native çekirdeğinden kaldırılmıştı; etik hat takip
numarası artık paylaşım sayfasıyla veriliyor.

Bağımlılıklar yine de kurulmalı — isteğe bağlı yükleme bir güvenlik ağı,
çözüm değil:

```
npx expo install expo-file-system react-native-qrcode-svg
```

---

## v685 — portal karşılama sayfası

### Neden

Portalın adresi kurum dışına da veriliyor ve doğrudan giriş formuyla
karşılamak, sistemin ne olduğunu anlatmadan parola sormak demekti.

### Yapı

`B360_AYAR` anahtar-değer ayar deposu, `B360_GORSEL` görsel künyesi.
Her alan için sütun açmak, sayfaya bölüm eklendiğinde göç gerektiriyordu.

`GET /api/Portal/Icerik` sayfanın tamamını tek istekte veriyor: başlık,
kapak, logo, slaytlar, duyurular, özellikler, iletişim. Bölüm başına ayrı
istek, yavaş bağlantıda içeriğin sırayla belirmesine yol açıyordu.

Okuma uçları kimlik istemiyor — karşılama sayfası oturum açmadan görünüyor
ve logo, duyuru, iletişim zaten herkese açık bilgi. Yazma uçları yönetici
yetkisi istiyor.

Ayar kaydetmede yalnızca gönderilen anahtarlar güncelleniyor: bir sekmeden
kaydeden kullanıcının diğer sekmedeki değerleri silmesi Kariyer tarafında
bir kez yaşanmıştı.

Logo ve kapak tek tutuluyor; yenisi yüklendiğinde eskisi pasife alınıyor,
yoksa hangisinin görüneceği rastgeleleşiyor.

### Sayfa

Yapışkan üst çubuk, gradyanlı kapak (arkasında soluk kapak görseli),
saydamlıkla dönen slayt, duyurular, sistem özellikleri, iletişim kartları
ve dipnot. Panelden ayrı bir görsel dil: panel yoğun ve işlevsel, burası
nefes alan ve tanıtıcı.

Adres satırında `#giris` varsa doğrudan forma açılıyor — personele verilen
kısayol bağlantısı tanıtımı atlayabilmeli.

İçerik alınamazsa sayfa yine açılıyor: giriş düğmesine ulaşmak tanıtım
metninden önemli.

### Kalanlar

- Yönetim ekranına Portal Görünümü sekmesi (uçlar hazır, arayüz yok)
- Giriş sayfasının karşılama ile aynı dile getirilmesi
- Dashboard, envanter ve yardım masası ekranları

---

## v687 — mobil açılış hatası bulundu

### Sebep

`src/ekranlar/Bilgilerim.js` stil tanımında `olcu.yuvarlak` kullanıyordu
ama `olcu` o dosyaya hiç içe aktarılmamıştı. Stil nesnesi modül gövdesinde
çalıştığı için hata, hiçbir React bileşeni çizilmeden önce oluşuyordu:
`App.js` bu ekranı en baştan yüklüyor, yükleme koptuğu için uygulama açılış
görselinde donuyor ya da çöküyordu.

Aynı eksik üç dosyada daha vardı (`BilgiModul`, `EtikHat`, `Ariza`). Hepsi
tarandı ve giderildi; tema dosyasından kullanılan her ad artık ya içe
aktarılmış ya da yerel olarak tanımlı.

`tarihYaz` bu üç dosyada zaten yerel olarak tanımlıydı; içe aktarmak
çakışma yaratacaktı, o yüzden yalnızca gerçekten eksik olanlar eklendi.

### Teşhis nasıl yapıldı

Üretim derlemesi yalnızca "JS hatası var" diyordu. Geliştirme derlemesi
(`expo-dev-client` + tünel) hatayı dosya ve satır numarasıyla gösterdi.
Bu yola baştan gidilmeliydi: TestFlight üzerinden her deneme yarım saat
harcatıyor ve elde sebep bırakmıyor.

### Kalıcı korumalar

Açılış katmanı (`Basla.js`) kalıyor: uygulamayı gecikmeli yüklüyor ve
yükleme hatasını ekranda gösteriyor. Bileşen bir nesnenin içinde tutuluyor
— doğrudan durumda tutulduğunda React onu "durum üreten işlev" sanıp
çağırıyor ve kancalarıyla yanlış yerde çalıştırıyordu.

---

## v688 — portal görünümü yönetimi

Yönetim ekranına **Portal Görünümü** sekmesi eklendi. Karşılama sayfasının
bütün içeriği buradan yönetiliyor; metinleri koda gömmek, her duyuru
değişikliğinde yeni sürüm yayınlamak demekti.

Beş alt sekme:

**Kapak ve logo** — logo ve kapak görseli yükleme, başlık, alt başlık,
açıklama ve sayfa altı notu. Logo ve kapak tek tutuluyor; yenisi
yüklendiğinde eskisi pasife alınıyor.

**Slaytlar** — başlık ve açıklamasıyla görsel ekleme. Yazı girilirse
görselin üstünde koyu şeritte görünüyor.

**Duyurular** ve **Özellikler** — aynı düzenleyici bileşeni kullanıyor;
ikisi de "başlık + metin" yapısında ve ayrı bileşen yazmak aynı düzeni iki
yerde güncellemek demekti. Duyuruda tarih, özellikte simge alanı var.

**İletişim** — adres, telefon, e-posta, web ve çalışma saatleri. Boş
bırakılan alan karşılama sayfasında hiç görünmüyor.

Kaydetme yalnızca o sekmenin alanlarını gönderiyor: bütün ayarı yazmak, bir
bölümden kaydeden kullanıcının diğerini silmesine yol açardı.

Portal API istemcisine `dosyaGonder` eklendi — genel istek yardımcısı her
isteğe JSON başlığı koyuyor ve bu, çok parçalı gövdede sınır bilgisini
eziyordu.

Görsel yüklemede antd Upload yerine düz dosya girdisi: bileşenin kendi
yükleme akışı devreye girip isteği iki kez göndermeye çalışıyordu.

---

## v690 — portal adresleri ve ana sayfa

### Her sayfanın kendi adresi

`portal.bicen.com.tr/anasayfa`, `/ariza-kayitlari`, `/envanter`,
`/kontrol-listeleri`, `/kunye-analizi`, `/rakip-fiyat`, `/yonetim`.

Sayfa daha önce bileşen durumunda tutuluyordu: adres hep aynı kalıyor,
kullanıcı bir sayfayı yer imine ekleyemiyor, bağlantı paylaşamıyor ve
tarayıcının geri tuşu portaldan tamamen çıkarıyordu.

Kütüphane eklenmedi; tarayıcının kendi geçmiş arayüzü kullanılıyor.
İhtiyaç tek düzeyli bir eşleme ve bağımlılık eklemek yayın akışına her
seferinde kurulum sokuyordu.

**`public/web.config` eklendi.** Bu dosya olmadan `/anasayfa` adresine
doğrudan girildiğinde ya da sayfa yenilendiğinde IIS diskte o adı arayıp
404 veriyor. Hata yalnızca yenilemede ve paylaşılan bağlantıda çıktığı
için gözden kaçması kolay.

Adresteki sayfaya yetki yoksa ilk açık sayfaya düşülüyor ve adres de ona
göre düzeltiliyor.

### Ana sayfa

Gösterge Paneli menünün başında ve girişten sonra açılan sayfa. Son arıza
kayıtları sekize değil beşe indirildi; daha uzunu panonun altını gereksiz
uzatıyor ve ayrıntı için zaten Arıza Kayıtları sayfası var.

### Birim altyapısı

`GET /api/Pano` artık `birim` parametresi alıyor (`bt`, `muhasebe`,
`satinalma`). Şimdilik yalnızca bilgi teknolojileri panosu dolu; diğer
ikisi "hazırlanıyor" bilgisi dönüyor ve ekranda açık bir not olarak
görünüyor.

Bölümü baştan parametre yapmak, muhasebe ve satın alma portala
katıldığında istemcinin çağrı biçimini değiştirmek zorunda kalmasını
önlüyor. Tanınmayan bölüm istendiğinde boş pano yerine varsayılan
gösteriliyor.

### Kalanlar

- Kontrol listelerinin İK panelinden portala taşınması
- Muhasebe ve satın alma panoları (veri kaynakları belirlenince)
- Portalın genel görsel elden geçirmesi

---

## v698 — envanter ızgarası ve cihaz görselleri

### Cihaz görselleri

`B360_ENVANTER_GORSEL` tablosu. Bir cihazın nasıl göründüğünü ve nerede
durduğunu yazıyla anlatmak zor; arızada "hangi cihaz" sorusu fotoğrafla
bir bakışta çözülüyor.

İlk yüklenen görsel kapak oluyor ve ızgarada küçük resim olarak
kullanılıyor. Kapak tek tutuluyor: iki kapak işaretliyken listede
hangisinin görüneceği rastgeleleşiyordu.

Kapak görseli liste sorgusunda geliyor; her cihaz için ayrı istek atmak
otuz cihazda otuz istek demekti.

Görseller portal görselleriyle aynı kökte, `cihaz` alt klasöründe.

### Izgara görünümü

Envanterin varsayılan görünümü ızgara oldu; tablo ikinci seçenek olarak
duruyor ve seçim tarayıcıda saklanıyor.

Cihazı fotoğrafından tanımak, satırdaki marka model yazısından hızlı:
mağazada "şu köşedeki terazi" denilen cihazı listede bulmak yazıyla zor
oluyordu.

Kartta açık arıza sayısı kırmızı rozet olarak duruyor — cihazın sorunlu
olduğu ızgarada görünmeli, ayrıntıyı açmak gerekmemeli. Birden çok görseli
olan cihazlarda sayı alt köşede yazıyor.

Görseli olmayan cihazda tür simgesi gösteriliyor; boş gri kutu, kaydın
eksik olduğu izlenimi veriyordu.

### Kalan

Ayrıntı penceresine görsel yükleme ve silme arayüzü (uçlar hazır).

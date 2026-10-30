# Biçen360 — sunucu kurulumu

Yeni panel, Kariyer ile aynı alan adı altında iki klasörde yayınlanıyor:

```
kariyer.bicen.com.tr/panel         → İK paneli          (mevcut, değişmedi)
kariyer.bicen.com.tr/apiservis     → BicenKariyer.API   (mevcut, değişmedi)

kariyer.bicen.com.tr/portal        → Biçen360 paneli    (yeni)
kariyer.bicen.com.tr/portalservis  → Bicen360.API       (yeni)
```

Ayrı bir alan adı açılmadı: iki panel aynı kullanıcı tablosunu ve aynı
jeton anahtarını kullanıyor, aynı köken altında durmaları oturum
tarafında hiçbir ek iş çıkarmıyor.

## Yayınlama

```
portal-yayinla.bat        (yönetici olarak çalıştırınız)
```

Betik artık IIS tarafını da kendisi kuruyor:

- `portalservis` uygulama havuzunu oluşturur ve **No Managed Code**
  ayarlar — ASP.NET Core kendi çalışma zamanını taşıyor, IIS ayrıca bir
  CLR yüklerse uygulama açılmıyor
- klasörü IIS uygulaması olarak tanımlar (elle "Convert to Application"
  gerekmez)
- `logs` ve `ariza` klasörlerini açıp havuz kimliğine yazma izni verir
- yayın sonunda `/portalservis/api/Durum` adresini çağırıp sonucu ekrana
  yazar

**Yönetici olarak çalıştırılması şart:** `appcmd` ve `icacls` yetki
istiyor. Yetkisiz çalıştırılırsa betik en başta durur; dosyaları kopyalayıp
IIS tanımını atlamaz.

### Kurulumda çıkan üç sorun ve sebepleri

Bunlar çözüldü, betik hepsini kendisi yapıyor. Kaydı burada duruyor ki
benzer bir yayında tekrar aranmasın.

**Ayrı uygulama havuzu şart.** ASP.NET Core'da in-process barındırılan bir
uygulamanın havuzunda başka uygulama olamaz. `/portalservis`'i
`/apiservis` ile aynı havuza koymak Kariyer API'sini durduruyor.
`portalservis` kendi `bicen360` havuzunda çalışıyor.

**İzin zinciri.** IIS bir uygulamayı açarken yapılandırmayı kökten aşağı
okur. Havuz kimliği site kökündeki `web.config`'i okuyamazsa istek
uygulamaya hiç ulaşmadan `500.19 (0x80070005)` ile düşer. Bu yüzden
yalnızca `portalservis` değil, `kariyer.bicen.com.tr` ve üstündeki iki
klasör de havuz kimliğine okuma izniyle açılıyor. Yazma izni yalnızca
`logs` ve `ariza` klasörlerinde.

**web.config'te kilitli bölüm olmamalı.** `httpErrors` ve
`requestFiltering` IIS'te varsayılan olarak kilitli; uygulama düzeyinde
tanımlanınca yine `500.19` veriyor. Ayrıca dosya `<location>` sarmalayıcısı
içine alınırsa `dotnet publish` `processPath` içermeyen ikinci bir
`aspNetCore` elemanı üretiyor ve ANCM uygulamayı hiç başlatmıyor —
`csproj` içindeki `IsTransformWebConfigDisabled` bunu engelliyor.

### 500 hatası alıyorsanız

Panel "API yanıt vermiyor" diyorsa uygulama IIS'te ayağa kalkmamış
demektir; sunucudaki hata sarmalayıcısı hiç çalışmamıştır, yani sorun
kodda değil barındırmada. Sırasıyla:

1. `portalservis\logs` klasöründeki `stdout` dosyası — açılış hatasının
   tam sebebi orada yazar
2. ASP.NET Core 8 Hosting Bundle kurulu mu (kurulu değilse `apiservis` de
   çalışmazdı, ama yeni sürüm gerekmiş olabilir)
3. `portalservis` havuzu "No Managed Code" mu

### Ayar dosyası

`portalservis\appsettings.json` sunucuda düzenlenir; yayınlama betiği
onu yedekleyip geri yazar, üzerine yazmaz. İlk yayından sonra kontrol
ediniz:

- `Jwt:Anahtar` — **`apiservis\appsettings.json` ile birebir aynı olmalı.**
  Mobil uygulama tek jetonla iki API'ye de gidiyor; ayrışırsa jeton
  yalnızca bir tarafta doğrulanır ve hata mesajı sebebi söylemez.
- `Panel:Adresler` — yayında CORS gerekmiyor (panel ve API aynı köken),
  ama geliştirme adresleri listede kalabilir.

### İlk yetki

Admin rolündeki kullanıcılar her sayfayı görür. Admin olmayan birine
erişim vermek için bir satır gerekiyor:

```sql
USE biPortal;
INSERT INTO B360_YETKI (alan, kapsam, anahtar, kod, izin)
VALUES ('panel', 'kullanici', N'kullanici.adi', 'yonetim', 1);
```

Gerisi panelin Yönetim sayfasındaki Yetkiler sekmesinden yapılır.

İK paneli ve Kariyer API'si bu betikten etkilenmez; onlar için
`sunucu-yayinla.bat` kullanılır. İki sistem ayrı yayınlanabiliyor —
arıza modülünde küçük bir düzeltme için Kariyer tarafını yeniden
yayınlamak gerekmiyor.

## Mobil uygulama

Uygulama iki API'ye birden gidiyor. `bicen-mobil/app.json` içindeki
`extra.api360Adresi` değeri yayında şu olmalı:

```json
"api360Adresi": "https://kariyer.bicen.com.tr/portalservis"
```

Bu değer pakette **zaten yayın adresine ayarlı**; yayınlamak için
değiştirmeniz gerekmiyor. Yerelde denemek isterseniz kendi
bilgisayarınızın ağ adresini (`http://192.168.1.x:5181`) yazınız; telefon
`localhost` göremiyor.

Arıza modülü mobilde **Diğer** sekmesi altında görünür. Görünmüyorsa
Biçen360 sunucusuna ulaşılamıyor demektir; o ekranda artık sebebini
söyleyen bir uyarı çıkıyor.

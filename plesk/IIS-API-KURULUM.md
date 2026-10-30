# API'yi Plesk (Windows / IIS) Üzerinde Yayınlama

Aday sayfası `https://kariyer.bicen.com.tr` adresinde statik olarak duruyor.
API'yi aynı alan adı altında bir **IIS uygulaması** olarak yayınlıyoruz:

```
https://kariyer.bicen.com.tr/            → aday sayfası (statik dosyalar)
https://kariyer.bicen.com.tr/apiservis/  → BicenKariyer.API (IIS uygulaması)
```

Bu yöntemin avantajı: ARR eklentisi gerekmez, ayrı port açılmaz, SSL
sertifikası alan adından devralınır, API kendi başına bir süreç olarak
izlenmek zorunda kalmaz — IIS uygulama havuzu onu yönetir, çökerse yeniden
başlatır.

---

## 1. .NET 8 Hosting Bundle kurulumu

Sunucuda **bir kez** yapılır. IIS'in .NET uygulamalarını çalıştırabilmesi için
gereklidir (SDK'ya gerek yoktur, Hosting Bundle yeterlidir).

İndirme: `https://dotnet.microsoft.com/download/dotnet/8.0` →
**ASP.NET Core Runtime 8.x → Hosting Bundle**

Kurulumdan sonra IIS'i yeniden başlatınız:

```
net stop was /y
net start w3svc
```

Doğrulama:

```
dotnet --list-runtimes
```

Listede `Microsoft.AspNetCore.App 8.x` görünmelidir.

---

## 2. API'yi yayına derleme

API kaynak klasöründe (bu sunucuda ya da kendi bilgisayarınızda):

```
cd BicenKariyer.API
dotnet publish -c Release -o C:\BicenKariyer\api
```

> Derlemeyi kendi bilgisayarınızda yaptıysanız `C:\BicenKariyer\api` klasörünü
> sunucuya kopyalayınız. Bu klasör alan adının belge kökünün **dışında**
> olmalıdır; aksi halde `appsettings.json` dosyası internetten indirilebilir
> hâle gelir.

Klasörde `BicenKariyer.API.dll`, `web.config` ve `appsettings.json`
bulunmalıdır. `web.config` dosyası publish sırasında otomatik oluşur, elle
düzenlemeyiniz.

`wwwroot\logo.png` dosyasını da bu klasöre kopyalamayı unutmayınız.

---

## 3. IIS uygulaması oluşturma

### Plesk arayüzünden

Plesk → Web Siteleri ve Alan Adları → `kariyer.bicen.com.tr` →
**Sanal Dizinler** (Virtual Directories):

1. Kök dizinde **Sanal Dizin Oluştur**
2. Ad: `apiservis`
3. Fiziksel yol: `C:\BicenKariyer\api`
4. Oluşturduktan sonra dizini seçip **Özellikler** → **Uygulama oluştur**
   seçeneğini işaretleyiniz.

### IIS Yöneticisi ile (alternatif)

`kariyer.bicen.com.tr` sitesine sağ tık → **Add Application**

| Alan | Değer |
|---|---|
| Alias | `apiservis` |
| Physical path | `C:\BicenKariyer\api` |
| Application pool | Yeni bir havuz: `BicenKariyerApi` |

Uygulama havuzu ayarları (**Application Pools → BicenKariyerApi → Basic
Settings**):

| Ayar | Değer |
|---|---|
| .NET CLR version | **No Managed Code** |
| Managed pipeline mode | Integrated |

**Advanced Settings** içinde ayrıca:

| Ayar | Değer | Neden |
|---|---|---|
| Start Mode | AlwaysRunning | İlk istekte gecikme olmaz |
| Idle Time-out (minutes) | 0 | Boşta kalınca kapanmaz |
| Regular Time Interval | 0 | Gereksiz yeniden başlatma olmaz |

---

## 4. Klasör izni

Uygulama havuzunun klasörü okuyabilmesi gerekir. Yönetici komut satırında:

```
icacls "C:\BicenKariyer\api" /grant "IIS AppPool\BicenKariyerApi":(OI)(CI)RX
```

Log yazımı için (isteğe bağlı) `logs` alt klasörüne yazma izni:

```
mkdir C:\BicenKariyer\api\logs
icacls "C:\BicenKariyer\api\logs" /grant "IIS AppPool\BicenKariyerApi":(OI)(CI)M
```

---

## 5. Doğrulama

Tarayıcıda:

```
https://kariyer.bicen.com.tr/apiservis/api/Saglik
```

Beklenen yanıt:

```json
{"durum":"çalışıyor","veritabani":"hazır"}
```

`veritabani` alanı `hata` diyorsa SQL bağlantısında sorun var; yanıt hiç
gelmiyorsa uygulama başlamamıştır. Hata ayrıntısı için:
`C:\BicenKariyer\api\logs\stdout*.log`

---

## 6. Aday sayfasını API adresine bağlama

`bicen-kariyer` klasöründe `.env.production` dosyası oluşturunuz:

```
VITE_API_TABAN=https://kariyer.bicen.com.tr/apiservis
```

Ardından yeniden derleyip dosyaları belge köküne kopyalayınız:

```
npm run build
```

> Bu dosya olmadan sayfa API'yi `https://kariyer.bicen.com.tr/api/...`
> adresinde arar; uygulama `/apiservis` altında olduğu için istekler 404
> döner.

---

## 7. İK paneli

İK paneli internete açılmaz. Şirket ağındaki bir makinede
`npm run build` + `npm run preview` ile 5178 portunda çalıştırılır. Bu
durumda panelin API adresini bilmesi gerekir; `bicen-kariyer-ik` klasöründe
`.env.production` dosyası oluşturunuz:

```
VITE_API_TABAN=https://kariyer.bicen.com.tr/apiservis
```

Panel API'ye internet üzerinden bağlanacağı için CORS zaten açıktır.

---

## Güncelleme yapmak istediğinizde

**Aday sayfası değiştiyse:** `npm run build` → `dist` içeriğini belge köküne
kopyala.

**API değiştiyse:** IIS'te uygulama havuzunu durdur (dosyalar kilitli
kalmasın), publish klasörünün üzerine yaz, havuzu başlat:

```
%windir%\system32\inetsrv\appcmd stop apppool /apppool.name:BicenKariyerApi
robocopy C:\yeni\api C:\BicenKariyer\api /MIR /XD logs
%windir%\system32\inetsrv\appcmd start apppool /apppool.name:BicenKariyerApi
```

---

## Bu yöntemde Servis Paneli gerekir mi?

Gerekmez. IIS uygulama havuzu API'yi kendisi ayakta tutar ve çökerse yeniden
başlatır. Servis Paneli, API'yi konsol uygulaması olarak çalıştırdığınız
kurulumlar için hazırlanmıştı. Yine de "servis durunca mail gelsin"
davranışını istiyorsanız panelin ayarlar.json dosyasından yalnızca API
servisini bırakıp komutunu IIS havuz durumunu kontrol edecek şekilde
uyarlayabiliriz.

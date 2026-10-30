# Plesk ile Yayına Alma

> **Plesk Windows kullanıyorsanız** API'yi IIS uygulaması olarak yayınlamak
> daha kolaydır: ARR eklentisi gerekmez, ayrı port açılmaz.
> Bunun için **`IIS-API-KURULUM.md`** dosyasını izleyiniz. Aşağıdaki ters
> vekil yöntemi, API'yi ayrı bir süreç olarak çalıştırdığınız kurulumlar
> içindir.

Aday başvuru sayfasını `https://kariyer.bicen.com.tr` adresinde yayınlamak için
kılavuz. Aday sayfası derlendikten sonra tamamen statik dosyalardan oluşur,
Plesk üzerinde çalışması için Node.js gerekmez.

---

## Neden ters vekil gerekiyor?

Sayfa `https://` ile açılacak. Tarayıcılar, https bir sayfadan `http://` bir
adrese istek atılmasını engeller (mixed content). Bu nedenle API'nin de aynı
alan adı altında https üzerinden erişilebilir olması gerekir.

Çözüm: Plesk `/api` yolunu, API'nin çalıştığı makinenin 5177 portuna
yönlendirir. Aynı alan adı kullanıldığı için CORS ayarı da gerekmez.

```
Aday tarayıcısı
      │  https://kariyer.bicen.com.tr/            → statik dosyalar (dist)
      │  https://kariyer.bicen.com.tr/api/...     → ters vekil → API:5177
      ▼
   Plesk (nginx / IIS)  ──────────────►  BicenKariyer.API  (5177)
```

**Önemli:** Plesk sunucusunun, API'nin çalıştığı makineye ağ üzerinden
erişebilmesi gerekir. API şirket içi bir makinede (örn. 192.168.0.114) ve
Plesk dışarıda barındırılıyorsa bu erişim yoktur; o durumda API'yi Plesk
sunucusunda çalıştırmak ya da güvenlik duvarında yönlendirme tanımlamak
gerekir.

---

## 1. Aday sayfasını derleme

`bicen-kariyer` klasöründe:

```
npm install
npm run build
```

`dist` klasörü oluşur. İçindeki **tüm dosyaları** (klasörün kendisini değil)
alan adının belge köküne kopyalayınız. Belge kökünü Plesk → Alan adı →
**Barındırma Ayarları** ekranındaki *Belge kökü* alanından görebilirsiniz.

Kurulumunuzdaki yol:

```
C:\inetpub\vhosts\bicen.com.tr\kariyer.bicen.com.tr
```

Bu klasörde Plesk'in oluşturduğu `index.html` üzerine yazılacaktır, sorun
değildir. Ancak **`web.config` dosyasını silmeyiniz ve üzerine yazmayınız**;
Plesk'in site ayarları o dosyada tutulur. Değiştirmeden önce
`web.config.yedek` adıyla bir kopyasını alınız.

Aday sayfası hash tabanlı yönlendirme kullanır (`#/sorgula`), bu nedenle
SPA yeniden yazma kuralı gerekmez.

---

## 2. Ters vekil ayarı

### Plesk Linux (nginx)

Plesk → Alan adı → **Apache & nginx Ayarları** → *Ek nginx yönergeleri*
alanına:

```nginx
location /api/ {
    proxy_pass         http://API_SUNUCU_IP:5177/api/;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;

    # Fotoğraf ve sertifika görselleri için gövde sınırı
    client_max_body_size 25m;
}
```

`API_SUNUCU_IP` yerine API'nin çalıştığı makinenin adresini yazınız. API
Plesk sunucusunun kendisinde çalışıyorsa `http://127.0.0.1:5177/api/`
yazmanız yeterlidir.

### Plesk Windows (IIS)

Sunucuda **URL Rewrite** ve **Application Request Routing (ARR)** eklentileri
kurulu olmalıdır. Ardından `httpdocs` klasörüne şu `web.config` dosyasını
koyunuz (bu klasördeki `web.config.ornek` dosyasını kullanabilirsiniz):

```xml
<rule name="API Ters Vekil" stopProcessing="true">
  <match url="^api/(.*)" />
  <action type="Rewrite" url="http://API_SUNUCU_IP:5177/api/{R:1}" />
</rule>
```

---

## 3. SSL sertifikası

Plesk → Alan adı → **SSL/TLS Sertifikaları** → *Let's Encrypt ile ücretsiz
sertifika al*. Ardından **HTTP → HTTPS yönlendirmesini** açınız.

Bu adım isteğe bağlı değildir: aday sayfasında kimlik numarası, telefon ve
fotoğraf toplanıyor. Ayrıca sayfa içi kamera (getUserMedia) yalnızca https
üzerinde çalışır; http olarak kalırsa adaylar telefonun kamera uygulamasını
kullanmak zorunda kalır.

---

## 4. API adresini doğrulama

Yayına aldıktan sonra tarayıcıda şu adresi açınız:

```
https://kariyer.bicen.com.tr/api/Saglik
```

`{"durum":"çalışıyor","veritabani":"hazır"}` yanıtını görüyorsanız ters vekil
ve veritabanı bağlantısı doğru çalışıyor demektir. Bu yanıt gelmiyorsa aday
sayfası da çalışmaz.

---

## 5. QR kodları

İK panelindeki **QR Kodlar** sekmesinde adres alanına şunu yazınız:

```
https://kariyer.bicen.com.tr
```

Şube kodları otomatik eklenir:
`https://kariyer.bicen.com.tr/?sube=SEFAKOY`

Kodları bastırmadan önce bir telefondan (mobil veri ile, şirket ağı dışında)
okutup test ediniz.

---

## İK panelini yayınlamayın

`bicen-kariyer-ik` internete açılmamalıdır. İK personeli şirket ağından
`http://sunucu:5178` adresini kullanmaya devam etsin. Panelin ayrı kalması,
adayların erişebileceği yüzeyi en küçük tutar.

Panel de derlenmiş hâlde çalıştırılabilir: `npm run build` sonrası
`npm run preview` komutu `dist` klasörünü 5178 portunda yayınlar.

---

## API'yi sunucuda sürekli çalıştırma

API'nin ayakta kalması gerekir. Üç seçenek:

1. **Servis Paneli** (`BicenKariyer.Panel`) — Windows sunucuda başlat/durdur,
   log izleme ve servis durduğunda mail bildirimi sağlar.
2. **Windows Servisi** — `sc create` ile kalıcı servis olarak kaydedilebilir.
3. **Plesk Linux'ta systemd** — API'yi Plesk sunucusunda çalıştıracaksanız
   `dotnet publish` çıktısı için bir systemd birimi tanımlanır.

Hangisini kullanacağınızı belirtirseniz gerekli dosyaları hazırlayabilirim.

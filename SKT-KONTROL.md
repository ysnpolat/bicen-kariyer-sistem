# SKT Kontrol

*Biçen360 mobil modülü ve portal sayfası · 23.10.2026 · ilk sürüm v1110 / uygulama 1.9*

Mağazalarda son kullanma tarihi (SKT) kontrolü Excel'den Biçen360'a taşındı.

**Eski düzen:** Her ay her şubeye bir kategori atanıyordu. Şube reyonda o kategorinin ürünlerini dolaşıp SKT'leri Excel'e yazıyor, dosyayı merkeze gönderiyordu. Bir sonraki ay aynı kategoriyi başka bir şube kontrol ediyordu.

**Yeni düzen:** Plan portalda tutuluyor. Personel ürünü telefonla okutup SKT'yi giriyor, kayıt anında sunucuya gidiyor. Portal kayıtları şube, kategori, ürün ve tarih bazında analiz ediyor. Veriler kalıcı tutuluyor; ileride başka raporlar da bu tablolardan beslenecek.

---

## 1. Akış

1. **Plan (portal › SKT Takip › Aylık plan)**
   - Her ay her şubeye bir kategori ve o kategorinin ürün listesi atanır.
   - Plan üç yoldan kurulabilir:
     - Excel'den içe aktarma (bkz. §5).
     - Bir önceki ayı kaydırma: "Kasım planını oluştur" düğmesi. Her kategori, listede bir sonraki şubeye geçer.
     - **Ana gruplardan (26.10.2026, varsayılan):** SKT kategorileri Mikro'daki stok ana gruplarıdır (`MikroDB_V15_BICEN.dbo.STOK_ANA_GRUPLARI`). `san_RECno` 42, 45, 46 ve 47 hariç tutulur.
       - Aktif şubeler (Şube ve Depo ekranı, kod sırasıyla) ve ana gruplar sabit bir sırada tutulur. Her ay her şube listede bir sonraki gruba geçer.
       - Planın ürün listesi o ana gruptaki aktif ürünlerdir.
       - Portaldaki "Ana gruplardan kur" düğmesi ayın planını aynı kuralla elle kurar.
       - Ayarlar: `"Skt": { "HaricAnaGruplar": "42,45,46,47", "Kaynak": "anagrup" }`. `Kaynak` değeri `"kaydir"` olursa eski yol kullanılır: geçen ayın planı kaydırılır.
     - **Otomatik (26.10.2026):** Portal, her ayın 25. gününden itibaren gelecek ayın planını kendiliğinden oluşturur (yukarıdaki ana grup kuralıyla). Bu ay bir kategoriyi kontrol eden şube, o kategoriyi gelecek ay yapmaz; kategori listedeki bir sonraki şubeye geçer ve ürün listesi de onunla taşınır. Böylece şube sayısı kadar ayda her şube her kategoriyi bir kez görür.
       - Gelecek ayın planı Excel ya da elle önceden kurulmuşsa ona dokunulmaz.
       - Ay başında o ayın planı hiç yoksa geçen ayınkinden oluşturulur.
       - Oluşturanı "otomatik" yazılır. Plan oluştuktan sonra portalda elle değiştirilebilir.
       - Ayarlar (`Bicen360.API/appsettings.json`): `"Skt": { "OtomatikPlan": true, "OtomatikGun": 25 }`. Kapatmak için `OtomatikPlan` değerini `false` yapın.
     - Elle: Yeni plan ekleyip ürünleri Mikro'dan doldurmak ya da barkodla tek tek eklemek.
2. **Kontrol (Biçen360 › SKT Kontrol)**
   - Ana sayfada şunlar görünür:
     - Ayın görevi: kategori, son gün, ilerleme.
     - Bu ay bulunan sorunlar.
     - Acil ilgilenilmesi gereken ürünler.
   - **Barkod okut:** Okutulan ürün bu ayın planında yoksa uygulama titrer ve uyarır: *"Bu ürün bu ayın kategorisinde değil"*. Personel tekrar okutabilir ya da ürünü "serbest kontrol" olarak girebilir.
   - Ürün ekranında iki seçenek var:
     - **SKT gir:** Bir ya da daha fazla parti girilir. Her partide tarih (gün · ay · yıl) ve adet olur. Etikette gün yazmıyorsa gün boş bırakılır; ayın son günü alınır.
     - **Ürün yok:** Ürün rafta da depoda da yoksa seçilir.
   - **Kaydet, sonraki** düğmesi doğrudan barkod ekranına döner.
   - **Serbest kontrol:** Plan dışında, kendi şubesindeki herhangi bir ürünün SKT'si girilebilir.
   - Aynı ay aynı plan ürünü yeniden okutulursa önceki kayıt güncellenir (düzeltme). Serbest kontrol her seferinde yeni kayıt açar.
3. **Bildirim**
   - SKT'si geçmiş ya da 0–7 gün kalmış bir ürün girildiğinde şube müdürüne anlık bildirim gider. Müdür, pozisyonunda "müdür" geçen ve "yardımcı" geçmeyen kişidir.
   - Portaldaki "Hatırlat" düğmesi, şubede modülü açık olan personele bildirim gönderir.
4. **Takip (portal › SKT Takip)**
   - Şube durumu, kritik ürünler (aksiyon seçimiyle), ürün analizi, kategori analizi ve tüm kayıtlar sekmeleri var.
   - Excel'e aktarma (CSV) ve her tabloda "Kopyala" var.

## 2. Durum eşikleri

| Durum | Kalan gün | Renk |
|---|---|---|
| Geçmiş | < 0 | kırmızı |
| 0–7 gün (kritik) | 0–7 | turuncu |
| 8–30 gün (yaklaşıyor) | 8–30 | sarı/mavi |
| Uygun | > 30 | yeşil |
| Ürün yok | — | gri |

Eşikler `SktController.Kritik` (7) ve `SktController.Yakin` (30) sabitlerinde tanımlı. Kalan gün, kayıt anına göre değil **bugüne göre** hesaplanır; böylece eski bir kayıt da bugünkü riski gösterir.

## 3. Yetki

| Nerede | Kod | Varsayılan |
|---|---|---|
| Mobil modül | `skt` (SKT Kontrol) | **Kapalı.** Yeni modüldür; Portal › Yetkiler'den gruba ya da kişiye açılmalı. |
| Portal sayfası | `skt` (SKT Takip) | Kapalı. Panel rolüne ya da kullanıcıya verilir; Admin her zaman görür. |

Mobil modül eski uygulama sürümlerinde görünmez; ekranı 1.9'dadır.

## 4. Veri modeli (biPortal)

Tablolar, API ilk istekte kendisi oluşturur (`SktController.Kur`). Ayrıca bir SQL betiği çalıştırmak gerekmez.

```
B360_SKT_PLAN          id, ay CHAR(7) 'YYYY-MM', sube, kategori, aciklama, son_gun, sira,
                       olusturan, olusturma, silindi
B360_SKT_PLAN_URUN     plan_id, stok_kod, barkod, urun_ad, ana_grup, kategori     (PK plan_id+stok_kod)
B360_SKT_KONTROL       id, plan_id (NULL = serbest), sube, stok_kod, barkod, urun_ad, ana_grup,
                       kategori, tur ('skt' | 'yok'), notu, personel_kodu, personel_ad,
                       olusturma, guncelleme, silindi
B360_SKT_PARTI         id, kontrol_id, skt DATE, adet, aksiyon, aksiyon_yapan, aksiyon_tarih
```

- Bir kontrol (okutulan ürün) birden fazla parti içerebilir.
- Ürün adı, ana grup ve kategori kayıt anında kontrolün içine yazılır. Mikro'daki ad sonradan değişse de geçmiş kayıt değişmez.
- Şube eşleştirmesi büyük/küçük harf, Türkçe karakter, boşluk ve tireyi yok sayar. Örneğin "BEYLİKDÜZÜ-2" ile "Beylikdüzü 2" aynı şube sayılır (`SktController.SubeAnahtar`).
- Aksiyon seçenekleri: İndirime alındı · Başka şubeye transfer · Tedarikçiye iade · İmha / fire · Raftan kaldırıldı.

### Başka raporlarda kullanım (örnek sorgular)

```sql
-- Bugün itibarıyla 30 gün içinde dolacak, aksiyon alınmamış partiler (şube × ürün)
SELECT k.sube, k.stok_kod, k.urun_ad, k.ana_grup, k.kategori, p.skt, p.adet,
       DATEDIFF(day, CAST(GETDATE() AS DATE), p.skt) AS kalan_gun
FROM B360_SKT_KONTROL k
JOIN B360_SKT_PARTI p ON p.kontrol_id = k.id
WHERE k.silindi = 0 AND p.aksiyon IS NULL
  AND p.skt <= DATEADD(day, 30, CAST(GETDATE() AS DATE))
ORDER BY p.skt;

-- Ayın plan ilerlemesi
SELECT p.ay, p.sube, p.kategori,
       (SELECT COUNT(*) FROM B360_SKT_PLAN_URUN u WHERE u.plan_id = p.id) AS urun,
       (SELECT COUNT(DISTINCT k.stok_kod) FROM B360_SKT_KONTROL k
         WHERE k.plan_id = p.id AND k.silindi = 0) AS kontrol_edilen
FROM B360_SKT_PLAN p
WHERE p.silindi = 0 AND p.ay = '2026-10';

-- Ürün bazında birden çok şubede sorunlu (sevkiyat/tedarik kaynaklı olabilir)
SELECT k.stok_kod, MAX(k.urun_ad) AS urun, COUNT(DISTINCT k.sube) AS sube_sayisi, SUM(p.adet) AS adet
FROM B360_SKT_KONTROL k JOIN B360_SKT_PARTI p ON p.kontrol_id = k.id
WHERE k.silindi = 0 AND p.skt <= DATEADD(day, 30, CAST(GETDATE() AS DATE))
GROUP BY k.stok_kod HAVING COUNT(DISTINCT k.sube) > 1
ORDER BY adet DESC;
```

## 5. Excel'den içe aktarma

Portal › SKT Takip › Aylık plan › **Excel'den içe aktar**. Önce ay seçilir, sonra bir ya da daha fazla `.xlsx` dosyası yüklenir. İki biçim tanınır ve aynı anda verilebilir:

1. **Kategori planı:** `ÜRÜN ADET · KATEGORİ · AÇIKLAMA · ŞUBELER` (KATEGORİ-SKT PLAN dosyası).
2. **Şube ürün listesi:** `SIRA · Stok kodu · Barkod · Stok ismi · Ana Grup · Kategori · Mağaza` (SKT MAĞAZA ALIMASI dosyası).
   - Dosyada birden fazla ürün listesi sayfası varsa, seçilen ayın adını taşıyan sayfa (ör. "Ekim") kullanılır; o yoksa son sayfa.
   - Mağaza değeri `#N/A` olan satırlar atlanır.

**Kategori adı nasıl belirlenir:**
- Kategori planındaki ad, o şubenin ürünleriyle ortak kelime içeriyorsa o ad kullanılır; örneğin "ÇİKOLATA+BATON ÇİKOLATA+BARLAR".
- Ortak kelime yoksa (plan dosyası başka bir aya aitse), ürünlerin en çok geçen ana grubu kullanılır ve sonuç penceresinde uyarı gösterilir.

**Not:** Gönderilen örnek dosyalarda kategori planı ile Ekim ürün listesi farklı şube eşleştirmeleri içeriyor. Örneğin Sefaköy plan dosyasında Kuruyemiş, Ekim listesinde Sıvı Yağ ve İçecek görünüyor. İçe aktarmada ürün listesi esas alınır.

Seçilen ay için zaten plan varsa sistem onay ister. Onaylanırsa eski plan silinir (gizlenir); girilmiş kontrol kayıtları silinmez.

## 6. API uçları (Bicen360.API · `/portalservis/api/Skt`)

| Uç | Kim | Ne |
|---|---|---|
| `GET Mobil/Gorev` | personel | Şubenin bu ayki planları, ürünlerin durumu, bu ay bulunan sorunlar |
| `GET Mobil/Urun?barkod=&planId=` | personel | Barkod/karekod çözümü, ürünün planda olup olmadığı, varsa son kayıt |
| `POST Mobil/Kaydet` | personel | `{ planId?, stokKod, barkod, urunAd, anaGrup, kategori, tur, partiler[{skt, adet}], not }` |
| `GET Veri?bas=&bit=` | portal | Tarih aralığındaki bütün kontroller, parti başına bir satır (en fazla 50 000) |
| `GET Planlar?ay=` | portal | Ayın planları ve ilerlemesi; plan olan aylar |
| `GET Rotasyon?bas=&ayAdet=` | portal | Kategori × ay → şube tablosu |
| `POST Plan` / `DELETE Plan/{id}` | portal | Plan ekle, düzenle, sil |
| `GET/POST Plan/{id}/Urunler` | portal | Plan ürünleri; barkodla ekle, stok koduyla çıkar |
| `POST Plan/{id}/Doldur` | portal | Mikro'dan doldur: ana grup (+ isteğe bağlı kategoriler), pasif olmayan ürünler |
| `POST Plan/Kaydir` | portal | `{ kaynakAy, hedefAy, adim: 1, uzerine }`: rotasyonla sonraki ayın planını oluşturur |
| `POST Plan/IceAktar` | portal | Çok parçalı form: `ay`, `uzerine`, `dosyalar[]` (.xlsx) |
| `POST Aksiyon` | portal | `{ partiId, aksiyon }` |
| `POST Hatirlat` | portal | `{ planId }`: şubedeki modülü açık personele bildirim gönderir |
| `GET Secenekler`, `GET Kategoriler?grup=` | portal | Şubeler, Mikro ana grupları ve kategorileri |

Mikro sorguları `BARKOD_TANIMLARI`, `STOKLAR`, `STOK_ANA_GRUPLARI` ve `STOK_KATEGORILERI` tablolarını yalnızca okur. Grup/kategori tabloları yoksa ürün yine bulunur; ana grup ve kategori boş kalır.

## 7. Dosyalar

- `Bicen360.API/Controllers/SktController.cs`: uçlar, tablo kurulumu ve .xlsx okuyucu (paket gerektirmez).
- `Bicen360.API/Modeller.cs`: sayfa `skt` ve mobil modül `skt` (varsayılan kapalı).
- `bicen360-panel/src/sayfalar/SktTakip.tsx`: portal sayfası (menüde "SKT Takip", adres `/portal/skt-takip`).
- `bicen-mobil/src/ekranlar/Skt.js`: mobil ekran. `api360.js` içinde `sktGorevAl`, `sktUrunAl`, `sktKaydet`.
- `bicen-mobil/App.js`, `src/ekranlar/Diger.js`, `src/bildirim.js`: rota, menü grubu ("Mağaza") ve `skt` bildiriminin açacağı ekran.

## 8. Yayın

1. `portal-yayinla.bat`: Bicen360.API ve portal. Tablolar ilk istekte oluşur.
2. Mobil 1.9 build'i alınır (`app.json` sürümü 1.9).
3. Portal › Yetkiler:
   - Mobil uygulama yetkileri › Mağaza modülleri › **SKT Kontrol**: ilgili gruplara (mağaza personeli, müdürler) açılır.
   - Panel yetkileri › **SKT Takip**: ilgili rollere verilir.
4. Portal › SKT Takip › Aylık plan › Excel'den içe aktar: Ekim (ya da Kasım) planı yüklenir.

## 9. Sonraki adımlar (öneri)

- Ay başında otomatik bildirim: "Bu ayın kategoriniz: …". Şu an "Hatırlat" düğmesiyle elle gönderiliyor.
- Rotasyonda aynı şubeye üst üste aynı kategori gelirse planı oluştururken uyarı vermek (rotasyon tablosunda kırmızıyla zaten görünüyor).
- Kritik ürünlerden doğrudan transfer önerisi (Stok Yönetimi'ndeki transfer ekranıyla bağlantı).
- Fire raporlarında "SKT'den imha" kalemi için `B360_SKT_PARTI.aksiyon = 'İmha / fire'` kullanmak.

# Kampanyalar (insert ürünleri): mobilden biŞube'ye etiket

26.10.2026 · Biçen360 Fiyat Kontrol › İnsert ürünleri ↔ biŞube "Mobilden"

## Akış

1. Panel, insert kampanyalarının ürünlerini OZ Merkez'deki `PANEL_INSERT_URUNLERI` tablosuna yazar. Kapsam: Normal İnsert, Haftanın Ürünü, Tamamla Kazan, Pazar Delisi vb. Yazma 15 dakikada bir yapılır (Biçen Panel belgesi).
2. Personel Biçen360'ta **Fiyat Kontrol › Kampanyalar** ekranını açar:
   - Kampanyalar türü, adı, durumu (Sürüyor / Planlı / Onay bekliyor) ve tarih aralığıyla listelenir.
   - Her üründe kare no, ad, barkod, çizili raf fiyatı, kalın insert fiyatı ve indirim % görünür.
   - Çeşit grupları grup başlığı altında toplanır.
   - Süzgeçler: "Sürüyor · Planlı" (varsayılan), "Onay bekliyor", "Tümü".
   - Ürünler tek tek ya da "Tümünü seç" ile seçilir.
3. **biŞube'ye gönder** düğmesi seçilen ürünleri doğrudan şubenin etiket listesine yollar. Gidilen yer, bugünkü mobil gönderimle aynı tablodur: `ETIKET_GONDERIM`.
   - Onay bekleyen kampanyada şu uyarı çıkar: "Bu kampanya henüz tamamlanmadı, fiyatlar değişebilir."
   - Raf fiyatı boşsa ya da insert fiyatı raftan düşük değilse satır kırmızı görünür; gönderirken de uyarılır.
4. biŞube'de **Mobilden** düğmesiyle liste açılır ve etiketler basılır.

Biçen360 `PANEL_INSERT_URUNLERI`'ni yalnız okur. Mağazanın depo numarasıyla, `NOLOCK` olmadan okur.

---

## biŞube'de yapılacak: ETIKET_GONDERIM'in yeni iki sütunu

Betik: `Bicen360.API/etiket-gonderim.sql` (alt kısım). Portal sütunları ilk insert gönderiminde kendisi eklemeyi dener. SQL kullanıcısının ALTER yetkisi yoksa betiği OZ Merkez'de elle çalıştırın.

| Sütun | Tür | Açıklama |
|---|---|---|
| `tur` | NVARCHAR(20) | `insert`: İnsert ürünleri ekranından. Boşsa eski tip liste (okutulan barkodlar). |
| `ayrinti` | NVARCHAR(MAX) | Ürün başına etiket bilgisi, JSON dizi (aşağıda) |

`barkodlar` sütunu **eskisi gibi dolu** gelir: alt alta barkod, adet kadar satır. Güncellenmemiş biŞube insert listesini de normal barkod listesi gibi açar ve basar. Fiyatlar o zaman Mikro'dan okunur.

### ayrinti JSON

```json
[
  {
    "barkod": "8690570543212",
    "stok_kod": "120.05.0031",
    "urun_adi": "ACE ÇAMAŞIR SUYU 1 LT",
    "raf_fiyati": 39.95,
    "insert_fiyati": 29.95,
    "indirim_yuzde": 25,
    "baslangic": "2026-11-03",
    "bitis": "2026-11-09",
    "kampanya_no": 8,
    "kampanya_adi": "3-9 KASIM YIL DÖNÜMÜ ŞENLİK",
    "kampanya_turu": "Normal İnsert",
    "grup_adi": null,
    "kare": 1,
    "adet": 1
  }
]
```

### Etiket kuralı (panel belgesi, 23.10.2026)

- **Basılı fiyat:** `insert_fiyati` (Bicard, 2. fiyat)
- **Çizili fiyat:** `raf_fiyati` (1. fiyat)
- **Geçerlilik:** `baslangic` – `bitis` ("03.11–09.11 tarihleri arasında geçerlidir")
- **Grup ürünü:** `grup_adi` doluysa aynı fiyat; her çeşide ayrı etiket

### Mobilden okuma (öneri)

```vbnet
' Mobilden listesi okunurken
If tur = "insert" AndAlso Not String.IsNullOrEmpty(ayrinti) Then
    Dim satirlar = JsonConvert.DeserializeObject(Of List(Of InsertSatiri))(ayrinti)
    ' Her satır: barkodla ürün bulunur, fiyat olarak insert_fiyati,
    ' çizili fiyat olarak raf_fiyati, geçerlilik baslangic–bitis
    ' insert etiket şablonuna verilir. adet kadar basılır.
Else
    ' Eski davranış: barkodlar satır satır
End If
```

Ekranda listeyi gösterirken `tur = 'insert'` olanlara bir rozet koymak yeterli, örneğin "İNSERT · 3-9 KASIM YIL DÖNÜMÜ ŞENLİK". Kampanya adları `aciklama` sütununda da yazar.

### Etiket kaydı ile birlikte (ETIKET-KAREKOD.md)

İnsert etiketi basılırken `ETIKET_KAYIT`'a şu değerler yazılır; karekod okutulunca kampanyanın bittiği söylenir:

| ETIKET_KAYIT sütunu | Değer |
|---|---|
| `fiyat` | `raf_fiyati` |
| `indirimli_fiyat` | `insert_fiyati` |
| `indirim_turu` | `kampanya` |
| `kampanya_bitis` | `bitis` |
| `kaynak` | `mobilden` |
| `rf_kodu` | listenin RF kodu |

---

## Panel belgesindeki açık soruların yanıtları

1. **Biçen360 OZ Merkez'i hangi SQL kullanıcısıyla okuyor?** Portal `appsettings`'teki `ConnectionStrings:OzMerkez` bağlantısıyla okuyor; kullanıcı **rapor**. Bu kullanıcıya `PANEL_INSERT_URUNLERI` için SELECT izni verilmeli. ETIKET_GONDERIM'e yeni sütunlar portaldan eklenecekse bu kullanıcıya o tabloda ALTER izni de gerekir; yoksa `etiket-gonderim.sql` elle çalıştırılır.
2. **Mobilden gönderim nereye yazıyor?** OZ Merkez `ETIKET_GONDERIM` tablosuna yazıyor; servis yok. Başlangıç–bitiş tarihi ve çizili fiyat artık `ayrinti` JSON'unda taşınıyor (yukarıda).
3. **Onay bekleyen kampanyalar mobilde görünsün mü?** Görünüyor, ama ayrı süzgeçte (varsayılan listede değil). Kampanya kartında uyarı var, gönderirken onay soruluyor.

---

## "Kampanya listesi şu an alınamıyor" uyarısı

Mobilde bu uyarı görünüyorsa portal `PANEL_INSERT_URUNLERI` tablosunu okuyamıyordur. İki nedeni olabilir:

1. **Tablo henüz yok.** Panelin tabloyu yazan işi kurulmamış.
2. **Okuma izni yok.** Portalın SQL kullanıcısı (**rapor**) tabloyu göremiyor. SQL Server, izni olmayan kullanıcıya tabloyu "yok" gibi gösterdiği için portal bu iki durumu birbirinden ayıramaz.

İzin için OZ Merkez'de çalıştırılacak betik:

```sql
USE OzMerkez;
GRANT SELECT ON dbo.PANEL_INSERT_URUNLERI TO rapor;
```

Panel tabloyu başka bir veritabanına yazıyorsa, portalın `appsettings` dosyasına tablonun tam adını verin:

```json
"Kampanya": { "Tablo": "OzMerkez.dbo.PANEL_INSERT_URUNLERI" }
```

---

## Kampanyaları doğrudan Biçen Panel'den okuma (26.10.2026)

`PANEL_INSERT_URUNLERI` dolana kadar (ya da onun yerine) portal kampanyaları **BicenPanel** veritabanından doğrudan, yalnız okuyarak alabilir. Kaynak tablolar `dbo.Kampanya` ve `dbo.KampanyaUrun`'dür. Panele hiçbir şey yazılmaz.

**Kurulum:** Sunucudaki `Bicen360.API/appsettings.json` dosyasına bağlantıyı ekleyin. Parola yalnız sunucudaki dosyada durur; pakete ve repoya girmez.

```json
"ConnectionStrings": {
  "BicenPanel": "Server=tcp:mail.bicen.com.tr,11903;Database=BicenPanel;User Id=<okuma kullanıcısı>;Password=<parola>;TrustServerCertificate=True;Encrypt=False"
}
```

- **Kullanıcı:** BicenPanel'de yalnız okuma yetkisi olan bir SQL kullanıcısı yeterlidir (`db_datareader` ya da iki tabloya SELECT).
- **Kaynak seçimi:** Bağlantı tanımlıysa portal kampanyaları panelden okur; tanımlı değilse `PANEL_INSERT_URUNLERI` tablosundan.

**Kurallar** (panel belgesi bölüm 2 ile aynı):

- **Hangi kampanyalar:** Bitişi bugün ya da sonra olanlar.
- **Durum:** `Asama` ≥ 5 ise başlangıca göre Planlı ya da Sürüyor. `Asama` 3–4 ise Onay bekliyor. `Asama` < 3 (ürün girişi, müdür onayı) hiç gösterilmez.
- **Tek ürünlü kampanyalar** (Haftanın Ürünü, Tamamla Kazan, Pazar Delisi): yalnız `SecilenUrunId` ürünü gösterilir. Seçim yapılmamışsa kampanya görünmez.
- **Diğer kampanyalar:** `KampanyaUrun.Durum` 0 ya da 1 olan ürünler gösterilir.
- **Mağaza seçimli kampanyalar** (`KatilimSecili = 1`): Katılım tablosu bağlanana kadar gösterilmez; böylece yanlış mağazaya etiket gitmez.
- **Raf (çizili) fiyat:** Mikro'dan, mağazanın depo fiyatıyla okunur. İndirim % buradan hesaplanır.

**Eşikler** (`appsettings`, varsayılanlar):

```json
"Kampanya": { "TamamAsama": 5, "OnayAsama": 3, "UrunDurumlari": "0,1" }
```

**ETIKET_GONDERIM'in yeni sütunları:** Portal artık bu tabloya kendiliğinden sütun eklemiyor (en az yetki). `tur` ve `ayrinti` sütunları için `etiket-gonderim.sql`'in alt kısmını OZ Merkez'de bir kez çalıştırın. Çalıştırılmazsa gönderim yine yapılır, yalnız ayrıntı (insert fiyatı, tarihler) taşınmaz.

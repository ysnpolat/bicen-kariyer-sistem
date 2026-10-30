# Raf etiketi karekodu ve etiket kaydı

26.10.2026 · Biçen360 Fiyat Kontrol ↔ BiŞube etiket basımı

Her basılan raf etiketine bir **etiket numarası (ID)** verilir. Etiket basılırken ürünün o anki bilgileri (ad, fiyat, indirimli fiyat, menşei, SKT, fiyat değişim tarihi) OZ Merkez'deki `ETIKET_KAYIT` tablosuna yazılır. Numara etiketin karekoduna da basılır.

Personel mobil uygulamada (Fiyat Kontrol) karekodu okutunca sistem şunları yapar:

1. Etiket numarasıyla kaydı bulur, yani etiketin üzerinde ne yazdığını bilir.
2. Ürünün güncel bilgisini Mikro'dan okur.
3. İkisini alan alan karşılaştırır ve değişeni söyler: "Fiyat: etikette 39,95 TL, şimdi 42,50 TL".
4. Aynı şubede bu ürün için daha sonra yeni etiket basılmış mı bakar:
   - **Basılmışsa:** "Yeni etiketi basılmış, raftaki eski etiketi yenisiyle değiştirin."
   - **Basılmamışsa:** "Etiketi sistemden yeniden çıkartıp değiştirin."
5. SKT'yi gösterir. Kaynakları etikette basılı SKT ile SKT kontrol modülünde girilen partilerdir. Tarih yaklaşmışsa (varsayılan 7 gün) ya da geçmişse uyarır.
6. Menşei ve son fiyat değişim tarihini de gösterir.

Portal ve mobil taraf hazırdır. **BiŞube tarafında yapılacak iki iş var:** (A) basarken kayıt eklemek, (B) karekoda ID yazmak.

---

## 1. Tablo — OZ Merkez

Betik: `Bicen360.API/etiket-kayit.sql`. Portal API tabloyu ilk kullanımda kendisi kurmayı dener. SQL kullanıcısının yetkisi yoksa betiği OZ Merkez'de elle çalıştırın.

### ETIKET_KAYIT

| Sütun | Tür | Zorunlu | Açıklama |
|---|---|---|---|
| `etiket_id` | BIGINT IDENTITY (100001'den) | otomatik | **Etiket numarası**, karekoda yazılır |
| `depo_no` | INT | ✔ | Şubenin depo numarası (ETIKET_GONDERIM'deki gibi) |
| `sube_adi` | NVARCHAR(120) | | Şube adı |
| `stok_kodu` | NVARCHAR(30) | ✔ | Mikro stok kodu |
| `barkod` | NVARCHAR(50) | | Etiketteki barkod |
| `urun_adi` | NVARCHAR(200) | | **Etikete basılan ürün adı** (karşılaştırılır) |
| `birim` | NVARCHAR(20) | | ADET, KG… |
| `fiyat` | DECIMAL(18,2) | | **Etiketteki normal (raf) fiyat**, ör. 39,95 (karşılaştırılır) |
| `indirimli_fiyat` | DECIMAL(18,2) | | **Etiketteki indirimli fiyat**, ör. 29,95; yoksa NULL (karşılaştırılır) |
| `indirim_turu` | NVARCHAR(20) | | `bicard` ya da `kampanya`; indirim yoksa NULL |
| `birim_fiyat` | NVARCHAR(40) | | Etiketteki birim fiyat metni ("1 KG: 79,90 TL") |
| `mensei` | NVARCHAR(60) | | **Etiketteki menşei**, ör. TÜRKİYE (karşılaştırılır) |
| `reyon` | NVARCHAR(100) | | Reyon adı |
| `yer_kodu` | NVARCHAR(30) | | Raf yeri |
| `skt` | DATE | | Etikete SKT basılıyorsa |
| `fiyat_degisim_tarihi` | DATE | | Etiketteki FDT (fiyat değişim tarihi) |
| `kampanya_bitis` | DATE | | Kampanya etiketiyse bitiş tarihi |
| `sablon` | NVARCHAR(80) | | Kullanılan şablon (A4minietiket32LICIZGILI…) |
| `adet` | INT | ✔ (1) | Bu satırdan kaç etiket basıldı |
| `basan_kullanici` | NVARCHAR(100) | | BiŞube kullanıcısı |
| `bilgisayar` | NVARCHAR(60) | | `Environment.MachineName` |
| `kaynak` | NVARCHAR(30) | | `elle`, `mobilden`, `fiyat-degisikligi`, `uyari` |
| `rf_kodu` | NVARCHAR(24) | | Mobilden gelen listeden basıldıysa RF kodu |
| `basim` | DATETIME2 | otomatik | Basım anı |
| `iptal` | BIT | (0) | Etiket hatalı basıldı ya da çöpe gittiyse 1 |
| `ek_json` | NVARCHAR(MAX) | | İleride eklenecek alanlar için |

> Kalın yazılan alanlar okutulduğunda güncel bilgiyle karşılaştırılır. Boş (NULL) bırakılan alan karşılaştırılmaz.

### ETIKET_OKUTMA

Portal yazar, BiŞube'ye iş düşmez. Her okutmada etiket numarası, durumu (`guncel`, `degisti`, `yenisi-var`, `iptal`) ve değişen alanlar kaydedilir. Hangi şubede kaç eski etiket bulunduğunu raporlamak için kullanılır.

---

## 2. BiŞube — basarken kayıt ekle (A)

Etiket basım formunda (`frm_etiket_basim`, yeni C# BiŞube'de etiket basım ekranı) her ürün satırı için:

1. **Önce** OZ Merkez'e kayıt eklenir, `etiket_id` alınır.
2. Karekod metni bu numarayla kurulur (bölüm 3).
3. Etiket basılır.

Aynı üründen 5 etiket basılıyorsa tek kayıt açılır (`adet = 5`) ve beşine de aynı numara basılır.

### SQL

```sql
INSERT INTO ETIKET_KAYIT
    (depo_no, sube_adi, stok_kodu, barkod, urun_adi, birim,
     fiyat, indirimli_fiyat, indirim_turu, birim_fiyat,
     mensei, reyon, yer_kodu, skt, fiyat_degisim_tarihi, kampanya_bitis,
     sablon, adet, basan_kullanici, bilgisayar, kaynak, rf_kodu)
OUTPUT INSERTED.etiket_id
VALUES
    (@depo_no, @sube_adi, @stok_kodu, @barkod, @urun_adi, @birim,
     @fiyat, @indirimli_fiyat, @indirim_turu, @birim_fiyat,
     @mensei, @reyon, @yer_kodu, @skt, @fdt, @kampanya_bitis,
     @sablon, @adet, @kullanici, @bilgisayar, @kaynak, @rf_kodu)
```

### VB.NET (eski BiŞube)

```vbnet
Private Function EtiketKaydet(r As DataRow, adet As Integer, sablon As String, kaynak As String) As Long
    Using cn As New SqlConnection(txt_oz_sql.Text)          ' OZ Merkez bağlantısı
        cn.Open()
        Using cmd As New SqlCommand(ETIKET_KAYIT_INSERT, cn)
            cmd.Parameters.AddWithValue("@depo_no", CInt(txt_depo_kodu.Text))
            cmd.Parameters.AddWithValue("@sube_adi", SubeAdi)
            cmd.Parameters.AddWithValue("@stok_kodu", r("sto_kod").ToString().Trim())
            cmd.Parameters.AddWithValue("@barkod", r("barkod").ToString().Trim())
            cmd.Parameters.AddWithValue("@urun_adi", r("urun_adi").ToString().Trim())
            cmd.Parameters.AddWithValue("@birim", r("birim").ToString().Trim())
            cmd.Parameters.AddWithValue("@fiyat", r("raf_fiyat"))
            cmd.Parameters.AddWithValue("@indirimli_fiyat", IIf(IsDBNull(r("indirimli_fiyat")) OrElse CDec(r("indirimli_fiyat")) <= 0, DBNull.Value, r("indirimli_fiyat")))
            cmd.Parameters.AddWithValue("@indirim_turu", IIf(IsDBNull(r("indirimli_fiyat")), DBNull.Value, "bicard"))
            cmd.Parameters.AddWithValue("@birim_fiyat", BirimFiyatBirimiHesapla(r))
            cmd.Parameters.AddWithValue("@mensei", Nz(r("mensei")))
            cmd.Parameters.AddWithValue("@reyon", Nz(r("reyon")))
            cmd.Parameters.AddWithValue("@yer_kodu", Nz(r("yer_kodu")))
            cmd.Parameters.AddWithValue("@skt", DBNull.Value)       ' etikete SKT basılıyorsa tarih
            cmd.Parameters.AddWithValue("@fdt", Nz(r("fiyat_degisim_tarihi")))
            cmd.Parameters.AddWithValue("@kampanya_bitis", DBNull.Value)
            cmd.Parameters.AddWithValue("@sablon", sablon)
            cmd.Parameters.AddWithValue("@adet", adet)
            cmd.Parameters.AddWithValue("@kullanici", KullaniciAdi)
            cmd.Parameters.AddWithValue("@bilgisayar", Environment.MachineName)
            cmd.Parameters.AddWithValue("@kaynak", kaynak)          ' elle / mobilden / fiyat-degisikligi / uyari
            cmd.Parameters.AddWithValue("@rf_kodu", DBNull.Value)
            Return CLng(cmd.ExecuteScalar())
        End Using
    End Using
End Function
```

### C# (yeni BiŞube)

```csharp
var id = oz.ExecuteScalar<long>(EtiketKayitInsert, new
{
    depo_no = DepoNo, sube_adi = SubeAdi,
    stok_kodu = u.StokKodu, barkod = u.Barkod, urun_adi = u.Ad, birim = u.Birim,
    fiyat = u.RafFiyat,
    indirimli_fiyat = u.BicardFiyat > 0 ? u.BicardFiyat : (decimal?)null,
    indirim_turu = u.BicardFiyat > 0 ? "bicard" : null,
    birim_fiyat = u.BirimFiyatMetni, mensei = u.Mensei, reyon = u.Reyon, yer_kodu = u.YerKodu,
    skt = (DateTime?)null, fdt = u.FiyatDegisimTarihi, kampanya_bitis = (DateTime?)null,
    sablon = Sablon, adet, kullanici = Kullanici, bilgisayar = Environment.MachineName,
    kaynak = "elle", rf_kodu = (string)null,
});
```

**Bağlantı yoksa:** OZ Merkez'e ulaşılamazsa etiket yine basılsın. Karekoda ID satırı yazılmaz, eski biçimle (BARKOD/STOK/FIYAT) devam edilir. Mobil uygulama o zaman eski kontrolü yapar: basılı fiyat güncel fiyatla aynı mı.

**Hatalı basım:** Etiket yanlış basıldıysa ya da atıldıysa `UPDATE ETIKET_KAYIT SET iptal = 1 WHERE etiket_id = @id`. Okutulunca "Etiket iptal edilmiş, raftan kaldırınız" der.

---

## 3. Karekod içeriği (B)

Düz metin, satır satır `ANAHTAR: değer`. Büyük harf ve ASCII kullanın (Türkçe karakter yok). Var olan biçime **yalnızca ilk satırdaki `ID:` eklenir**. `IND` ve `SKT` isteğe bağlıdır.

```
ID: 100245
BARKOD: 8690570543212
STOK: 120.05.0031
FIYAT: 39,95 TL
IND: 29,95 TL
FDT: 08.10.2026
SKT: 30.10.2026
BASIM: 12.10.2026
```

- **En kısa geçerli biçim:** yalnızca `ID: 100245`. Barkod ve stok kayıttan bulunur. Ama BARKOD ve STOK satırlarını bırakmanız önerilir: kayıt bulunamazsa ürün yine açılır.
- Tarihler `gg.aa.yyyy`, fiyatlar `39,95 TL` biçimindedir.
- Karekod boyutu: 8 satır, A4minietiket32'deki mevcut karekod alanına sığar (QR, hata düzeltme M).
- Etiket Stüdyosu şablonunda karekod alanına yeni `etiket_id` alanını bağlayın. Karekod metnini BiŞube kurup şablona tek alan olarak gönderiyorsa, metnin başına `ID: {etiket_id}` satırını ekleyin.

Örnek kurulum (VB.NET):

```vbnet
Dim qr = $"ID: {etiketId}{vbLf}BARKOD: {barkod}{vbLf}STOK: {stok}{vbLf}" &
         $"FIYAT: {fiyat:N2} TL{vbLf}" &
         If(indirimli > 0, $"IND: {indirimli:N2} TL{vbLf}", "") &
         $"FDT: {fdt:dd.MM.yyyy}{vbLf}BASIM: {Now:dd.MM.yyyy}"
```

> `N2` biçimi Türkçe kültürde `39,95` verir. Uygulamanın kültürü tr-TR değilse `ToString("N2", New CultureInfo("tr-TR"))` kullanın.

---

## 4. Mobilde ne görünüyor

Fiyat Kontrol'de karekod okutulunca ürün kartında aşağıdakiler görünür.

**Etiket kutusu**

| Durum | Renk | Mesaj |
|---|---|---|
| Etiket güncel | yeşil | "Etiket güncel" + etikette yazan bilgiler |
| Bilgi değişti, yeni etiket basılmamış | kırmızı | "Bu ürünün fiyat, indirimli fiyat bilgisi değişti ve yeni etiketi henüz çıkartılmamış. Etiketi sistemden yeniden çıkartıp değiştiriniz." |
| Bilgi değişti, yeni etiket basılmış | turuncu | "… Yeni etiketi 25.10.2026 09:40 tarihinde basılmış; raftaki eski etiketi yenisiyle değiştiriniz." |
| Etiket iptal | kırmızı | "Bu etiket sistemde iptal edilmiş. Raftan kaldırınız …" |

Değişen her alan iki satırla gösterilir: **Etikette: 39,95 TL** (üstü çizili) ve **Şimdi: 42,50 TL**.

**Karşılaştırılan alanlar**

- **Ürün adı:** büyük/küçük harf ve boşluk farkı sayılmaz.
- **Fiyat (raf, liste 1):** Mikro'daki şubeye özel fiyatla karşılaştırılır.
- **İndirimli fiyat:**
  - `bicard` ise BiCard fiyatıyla (liste 2) karşılaştırılır. Etikette indirim var ama artık yoksa "İndirim yok" der.
  - `kampanya` ise bitiş tarihine bakılır. Tarih geçtiyse "Kampanya bitti" der.
- **Menşei:** Mikro'daki menşei sütunuyla karşılaştırılır (bölüm 5).

**Diğer bilgiler**

- **Menşei ve fiyat değişim tarihi:** ürün kartının altında.
- **SKT kutusu:**
  - Etikette basılı SKT ve SKT kontrolünde bu şube için girilmiş, aksiyon alınmamış partiler gösterilir.
  - En yakın tarih esas alınır: geçmişse kırmızı ("Ürünü raftan kaldırınız"), 7 gün içindeyse turuncu, değilse yeşil.

Eski uygulama sürümleri (1.8 ve öncesi) ayrıntıyı göstermez ama kırmızı uyarı şeridinde aynı mesajı görür.

---

## 5. Ayarlar (Bicen360.API · appsettings)

```json
"Etiket": {
  "SktUyariGun": 7,
  "MenseiSutunu": "sto_mensei"
}
```

- `SktUyariGun`: SKT kaç gün kala "yaklaşıyor" uyarısı verilsin (varsayılan 7).
- `MenseiSutunu`: Mikro `STOKLAR` tablosunda menşeinin tutulduğu sütun.
  - Boş bırakılırsa adında "mensei" geçen sütun aranır.
  - Bulunamazsa menşei karşılaştırılmaz (etikette yazan yine gösterilir).
  - Menşei BiŞube'de başka bir tablodan geliyorsa sütunu bildirin; sorgu oraya yönlendirilir.

---

## 6. Deneme

1. `etiket-kayit.sql`'i OZ Merkez'de çalıştırın (ya da portalı yayınlayıp bir okutma yapın, tablo kurulur).
2. Elle bir kayıt ekleyin:
   ```sql
   INSERT INTO ETIKET_KAYIT (depo_no, sube_adi, stok_kodu, barkod, urun_adi, fiyat, indirimli_fiyat, indirim_turu, mensei, fiyat_degisim_tarihi, adet, kaynak)
   OUTPUT INSERTED.etiket_id
   VALUES (12, N'SEFAKÖY', N'120.05.0031', N'8690570543212', N'ACE ÇAMAŞIR SUYU 1 LT', 39.95, 29.95, N'bicard', N'TÜRKİYE', '2026-10-08', 1, N'elle');
   ```
3. Dönen numarayla bir karekod üretin (`ID: 100001` ve alt satırda `BARKOD: 8690570543212`). Herhangi bir QR üreticisi olur. Telefonda Fiyat Kontrol'den okutun.
4. Fiyat güncelse yeşil, farklıysa kırmızı kutu ve değişen alanlar görünmelidir.
5. Aynı ürün için ikinci bir kayıt ekleyip ilk etiketi tekrar okutun: "Yeni etiketi basılmış" demelidir.

using System.Text;
using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İK asistanı: doğal dilde sorulan soruları yanıtlar.
///
/// <para>
/// Modele serbest SQL yazdırmak yerine <b>tanımlı araçlar</b> verilir. Model
/// hangi veriye ihtiyacı olduğuna karar verir, sunucu kontrollü sorguyu
/// çalıştırır, model sonucu yorumlayıp Türkçe anlatır.
/// </para>
///
/// <para>
/// Bu tercih üç sebeple yapılmıştır: serbest SQL güvenlik açığıdır (model
/// yanlış tabloyu okuyabilir ya da veri değiştirebilir), sonuçlar
/// öngörülemez olur, ve hata ayıklanamaz. Araçlarla her sorgu bizim
/// yazdığımız ve sınadığımız koddur.
/// </para>
/// </summary>
public class SohbetServisi
{
    private readonly IHttpClientFactory _istemciUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<SohbetServisi> _kayit;

    public SohbetServisi(
        IHttpClientFactory istemciUretici,
        IConfiguration yapilandirma,
        ILogger<SohbetServisi> kayit)
    {
        _istemciUretici = istemciUretici;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    public bool Etkin =>
        _yapilandirma.GetValue("Sohbet:Acik", false) &&
        !string.IsNullOrWhiteSpace(Anahtar);

    private string Anahtar =>
        _yapilandirma["Sohbet:Anahtar"] ?? _yapilandirma["YapayZeka:Anahtar"];

    private string Model => _yapilandirma["Sohbet:Model"] ?? "gpt-4o-mini";

    /// <summary>Bir soruda en fazla kaç araç çağrısı yapılabilir</summary>
    private const int EnFazlaTur = 5;

    /* ==================================================================== */
    /* Araç tanımları                                                        */
    /* ==================================================================== */

    /// <summary>
    /// Modele sunulan araçlar. Her biri sunucudaki bir sorguya karşılık gelir.
    /// </summary>
    private static object[] Araclar => new object[]
    {
        Arac("qr_okutma_gunluk",
            "Belirli bir gündeki QR giriş çıkış okutma durumunu getirir. "
            + "Hangi personelin okuttuğunu, kimin okutmadığını mağaza bazında verir.",
            new
            {
                type = "object",
                properties = new
                {
                    tarih = new
                    {
                        type = "string",
                        description = "Gün, YYYY-MM-DD biçiminde. Boş bırakılırsa dün."
                    },
                    sube = new
                    {
                        type = "string",
                        description = "Mağaza adı. Boş bırakılırsa tüm mağazalar."
                    }
                }
            }),

        Arac("personel_bilgi",
            "T.C. kimlik numarası ya da ad soyad ile personel kartını getirir. "
            + "İçerik: hangi mağazada ve hangi ünvanla çalıştığı, işe giriş ve "
            + "çıkış tarihleri, çalışma süresi, çıkış sebebi, ücreti, doğum "
            + "tarihi, adresi, son yedi günün QR okutma durumu, oryantasyon "
            + "görüşme notları, geçmiş başvuruları ve o başvurulara düşülen "
            + "değerlendirme notları. Aynı kişi birden çok kez çalışmışsa "
            + "hepsi listelenir.",
            new
            {
                type = "object",
                properties = new
                {
                    kimlikNo = new { type = "string", description = "11 haneli T.C. kimlik numarası" },
                    adSoyad = new { type = "string", description = "Ad soyad (kimlik yoksa)" }
                }
            }),

        Arac("ciro_verimlilik",
            "Personel başı ciro verimliliğini getirir. Mağazaların günlük "
            + "cirosunu norm kadro ve mevcut personele böler; önceki döneme "
            + "göre değişimi de verir.",
            new
            {
                type = "object",
                properties = new
                {
                    bas = new { type = "string", description = "Başlangıç tarihi YYYY-MM-DD" },
                    bit = new { type = "string", description = "Bitiş tarihi YYYY-MM-DD" },
                    sube = new { type = "string", description = "Mağaza adı (isteğe bağlı)" }
                }
            }),

        Arac("norm_kadro",
            "Şubelerin norm kadro durumunu getirir: norm, mevcut, eksik ve "
            + "fazla personel, açık pozisyonlar.",
            new
            {
                type = "object",
                properties = new
                {
                    sube = new { type = "string", description = "Mağaza adı (isteğe bağlı)" },
                    yalnizcaSorunlu = new
                    {
                        type = "boolean",
                        description = "Yalnızca eksik ya da fazlası olan şubeler"
                    }
                }
            }),

        Arac("basvuru_eski_calisanlar",
            "Başvuru yapanlar arasında daha önce şirkette çalışmış olanları "
            + "bulur. Her biri için önceki çalışma dönemi, ayrılma tarihi ve "
            + "çıkış sebebi verilir. 'Daha önce bizde çalışan var mı' türü "
            + "sorular için bu aracı kullan.",
            new
            {
                type = "object",
                properties = new
                {
                    bas = new { type = "string", description = "Başlangıç tarihi YYYY-MM-DD" },
                    bit = new { type = "string", description = "Bitiş tarihi YYYY-MM-DD" },
                    durum = new
                    {
                        type = "string",
                        description = "Başvuru durumu süzgeci (isteğe bağlı)"
                    }
                }
            }),

        Arac("basvuru_ozet",
            "Belirli bir dönemdeki başvuru istatistiklerini getirir: toplam "
            + "başvuru, durum dağılımı, şube ve pozisyon kırılımı, işe alınan sayısı.",
            new
            {
                type = "object",
                properties = new
                {
                    bas = new { type = "string", description = "Başlangıç tarihi YYYY-MM-DD" },
                    bit = new { type = "string", description = "Bitiş tarihi YYYY-MM-DD" },
                    sube = new { type = "string", description = "Mağaza adı (isteğe bağlı)" }
                }
            }),

        Arac("gorsel_olustur",
            "Yanıtına görsel ekler: çubuk grafik, karşılaştırma tablosu ya da "
            + "özet kutuları. Sayısal karşılaştırma yaptığında ya da birden "
            + "fazla mağazayı sıraladığında kullan. Metin açıklamanı ayrıca yaz.",
            new
            {
                type = "object",
                properties = new
                {
                    tur = new
                    {
                        type = "string",
                        @enum = new[] { "cubuk", "tablo", "kutular", "rapor", "personel" },
                        description =
                            "cubuk: mağaza karşılaştırma, oran sıralaması. "
                            + "tablo: çok sütunlu liste. "
                            + "kutular: 2-4 önemli sayı. "
                            + "rapor: panel raporlarının biçimi — üstte özet "
                            + "kutuları, altında tablo. Rapor istendiğinde bunu kullan. "
                            + "personel: personel kartı — fotoğraf, künye bilgileri ve "
                            + "çalışma dönemleri tablosu. Bir kişi sorulduğunda bunu kullan."
                    },
                    baslik = new { type = "string", description = "Görselin başlığı" },
                    satirlar = new
                    {
                        type = "array",
                        description = "Gösterilecek veriler",
                        items = new
                        {
                            type = "object",
                            properties = new
                            {
                                etiket = new { type = "string", description = "Satır adı" },
                                deger = new { type = "number", description = "Ana değer" },
                                ikinci = new
                                {
                                    type = "number",
                                    description = "Karşılaştırma değeri (isteğe bağlı)"
                                },
                                metin = new
                                {
                                    type = "string",
                                    description = "Sağda gösterilecek metin (isteğe bağlı)"
                                },
                                renk = new
                                {
                                    type = "string",
                                    @enum = new[] { "yesil", "kirmizi", "turuncu", "mavi", "gri" },
                                    description = "Satır rengi"
                                }
                            },
                            required = new[] { "etiket" }
                        }
                    },
                    sutunlar = new
                    {
                        type = "array",
                        description = "tur=tablo ise sütun başlıkları",
                        items = new { type = "string" }
                    },
                    hucreler = new
                    {
                        type = "array",
                        description = "tur=tablo ise satırlar; her satır sütun sayısı kadar metin",
                        items = new { type = "array", items = new { type = "string" } }
                    },
                    aciklama = new { type = "string", description = "Görselin altına küçük not" },

                    ozetler = new
                    {
                        type = "array",
                        description = "tur=rapor ise üstteki özet kutuları",
                        items = new
                        {
                            type = "object",
                            properties = new
                            {
                                etiket = new { type = "string" },
                                deger = new { type = "string", description = "Biçimlendirilmiş değer" },
                                alt = new { type = "string", description = "Küçük alt bilgi" },
                                renk = new
                                {
                                    type = "string",
                                    @enum = new[] { "yesil", "kirmizi", "turuncu", "mavi", "gri" }
                                }
                            },
                            required = new[] { "etiket", "deger" }
                        }
                    },

                    hucreRenkleri = new
                    {
                        type = "array",
                        description = "tur=tablo ise her satırın rengi; satır sayısı "
                                    + "kadar olmalı. Sorunlu satırları kırmızı yap.",
                        items = new
                        {
                            type = "string",
                            @enum = new[] { "yesil", "kirmizi", "turuncu", "yok" }
                        }
                    },

                    donem = new
                    {
                        type = "string",
                        description = "Raporun kapsadığı dönem, başlığın altına yazılır"
                    },

                    personelKodu = new
                    {
                        type = "string",
                        description = "tur=personel ise fotoğrafı çekmek için kullanılır; "
                                    + "personel_bilgi aracının döndürdüğü değeri ver"
                    },

                    kunye = new
                    {
                        type = "array",
                        description = "tur=personel ise künye alanları: telefon, kimlik, "
                                    + "doğum tarihi, adres, ünvan, mağaza gibi",
                        items = new
                        {
                            type = "object",
                            properties = new
                            {
                                etiket = new { type = "string" },
                                deger = new { type = "string" }
                            },
                            required = new[] { "etiket", "deger" }
                        }
                    }
                },
                required = new[] { "tur", "baslik" }
            }),

        Arac("sube_listesi",
            "Sistemdeki mağaza ve bölge listesini getirir. Kullanıcı mağaza "
            + "adını eksik ya da farklı yazdıysa doğrusunu bulmak için kullanılır.",
            new { type = "object", properties = new { } }),

        Arac("sirket_yapisi",
            "Şirketin GÜNCEL yapısını veritabanından getirir: toplam personel "
            + "sayısı, birim sayısı ve türleri, bölgeler ve her bölgedeki "
            + "mağaza ve kişi sayısı, birim bazında personel dağılımı, "
            + "pozisyon dağılımı, norm kadroda tanımsız kalan birimler. "
            + "Şirket yapısı, kaç mağaza, kaç personel, hangi bölgede ne var "
            + "gibi her soruda MUTLAKA bu araç çağrılır; ezberden sayı söyleme.",
            new { type = "object", properties = new { } })
    };

    private static object Arac(string ad, string aciklama, object parametreler) =>
        new
        {
            type = "function",
            function = new
            {
                name = ad,
                description = aciklama,
                parameters = parametreler
            }
        };

    /* ==================================================================== */
    /* Konuşma                                                               */
    /* ==================================================================== */

    /// <summary>Modelden gelen araç çağrısı</summary>
    public record AracCagrisi(string Id, string Ad, string Girdi);

    /// <summary>Bir turun sonucu</summary>
    public record TurSonucu(string Metin, List<AracCagrisi> Cagrilar, string HamYanit);

    private string SistemYonergesi(string bugun) => $"""
Sen Biçen Market'in İnsan Kaynakları asistanısın. Türkçe konuşuyorsun.
Bugünün tarihi: {bugun}

═══════════════════════════════════════════════════════════════════
ŞİRKET YAPISI
═══════════════════════════════════════════════════════════════════

Biçen Market, İstanbul ve çevresinde faaliyet gösteren bir market zinciri.

KRİTİK: Mağaza sayısı, personel sayısı, bölge yapısı ve pozisyon dağılımı
DEĞİŞKENDİR. Bu sayıları asla ezberden söyleme; şirket yapısıyla ilgili her
soruda önce sirket_yapisi aracını çağır ve dönen değerleri kullan. "Yaklaşık
şu kadar" deme, aracın verdiği kesin sayıyı ver.

BİRİM TÜRLERİ
- Mağaza: ciro üreten satış noktaları
- Merkez birimler: Genel Müdürlük, Lojistik Depo, Hal, Akçaburgaz Depo,
  Z.Merkez Büro gibi. Bunlar ciro üretmez ama personeli vardır.
Hangi birimin hangi türde olduğunu sirket_yapisi söyler.

BÖLGELER
Mağazalar bölgelere ayrılmıştır ve her bölgenin bir bölge müdürü vardır.
Bölge adlarını, hangi mağazanın hangi bölgede olduğunu ve bölge başına kişi
sayısını sirket_yapisi aracından al.

MAĞAZA POZİSYONLARI
Mağaza Müdürü, Müdür Yardımcısı, Kasa Şefi, Kasiyer, Reyoner, Manav,
Manav Şefi, Kasap, Kasap Şefi, Şarküteri, Şarküteri Şefi, Tadolya,
Tadolya Şefi, Temizlik Görevlisi, Ürün Kabul Görevlisi, Depo Görevlisi.
Kaç kişinin hangi pozisyonda olduğu sirket_yapisi içindeki pozisyonDagilimi
alanında gelir.

═══════════════════════════════════════════════════════════════════
TEMEL KAVRAMLAR
═══════════════════════════════════════════════════════════════════

NORM KADRO
Bir mağazada her pozisyon için olması gereken personel sayısı. Genel Müdür
onayıyla belirlenir. Yarım değer alabilir (23.5 gibi) çünkü part-time
personel yarım sayılır.

MEVCUT
O mağazada fiilen çalışan personel sayısı.

FARK
Mevcut eksi norm. Negatifse eksik kadro (açık pozisyon), pozitifse fazla
kadro. Sıfır ideal durumdur.

KİŞİ BAŞI CİRO
Mağazanın günlük ortalama cirosunun personel sayısına bölümü. İki ölçüt var:
- Norm başı: günlük ciro ÷ norm kadro
- Mevcut başı: günlük ciro ÷ fiilen çalışan personel
Mevcut başı norm başından yüksekse mağaza eksik kadroyla çalışıyor demektir.

ÖNEMLİ: Kişi başı değerler her zaman GÜNLÜK ORTALAMA üzerinden hesaplanır,
dönem toplamı üzerinden değil. Farklı uzunluktaki dönemler ancak böyle
kıyaslanabilir.

QR OKUTMA
Personel giriş çıkışını telefonundan QR kod okutarak yapar. Mağazalarda
okutma oranı düşük; alışkanlık oluşturma sürecindeyiz. Hedef %90.

KRİTİK: Okutmayan personel devamsız DEĞİLDİR. İzinli olabilir, telefonu
yanında olmayabilir ya da okutmayı atlamış olabilir. Bu ayrımı her zaman
belirt.

ADAY HAVUZU
Bölge ve pozisyon bazında kaç aday bulundurulması gerektiği hedefi. Açık
pozisyon çıktığında havuzdan aday çağrılır.

ORYANTASYON TAKİBİ
Yeni başlayan personel dört dönemde aranır: 7. gün, 2. ay, 6. ay, 1. yıl.
Görüşme sonucu ve notu kaydedilir.

BAŞVURU DURUMLARI
Yeni → İncelendi → Değerlendirmede → Görüşme Talebi → Olumlu →
Evrak Hazırlanıyor → İşe Alındı. Olumsuz her aşamada verilebilir.

═══════════════════════════════════════════════════════════════════
PANEL SAYFALARI
═══════════════════════════════════════════════════════════════════

BAŞVURULAR: Gelen başvurular, durum değişikliği, görüşme planlama, notlar,
İK referansları, işe alım işlemleri.

ADAY HAVUZU: Bölge kartları, pozisyon bazında hedef ve mevcut aday sayısı.

NORM KADRO: Şube bazında norm, mevcut, fark, eksik ve fazla pozisyonlar,
engelli personel sayısı.

PERSONELLER: Mikro'daki personel listesi, detayda çalışma geçmişi, ücret,
adres, QR geçiş hareketleri. Ayrıca Oryantasyon Takip sekmesi.

RAPORLAR: Üç sekme —
  1. Başvuru İstatistikleri: aylık dağılım, durum kırılımı, İK performansı
  2. Günlük Geçiş: QR okutma oranları, mağaza bazında
  3. Personel Başı Ciro: verimlilik, norm ve mevcut kırılımı

YÖNETİM: Kullanıcılar, şube tanımları, form ayarları, güvenlik günlüğü.

═══════════════════════════════════════════════════════════════════
NASIL YANITLAMALISIN
═══════════════════════════════════════════════════════════════════

VERİ
- Yalnızca araçlarla ulaştığın veriyi kullan. Tahmin etme, uydurma.
- Hesaplama YAPMA. Oran ve ortalamalar araç yanıtında hazır gelir.
- Mağaza adı belirsizse önce sube_listesi ile doğrusunu bul.
- Tarih belirtilmemişse makul olanı varsay ve varsayımını söyle.

PERSONEL KARTI
Bir kişi sorulduğunda (kimlik numarası ya da ad soyad ile) MUTLAKA
gorsel_olustur aracını tur="personel" ile çağır. Panelin personel detay
ekranındaki gibi görünür: fotoğraf, künye ve çalışma dönemleri tablosu.

- baslik: kişinin adı soyadı
- personelKodu: personel_bilgi aracının döndürdüğü değer (fotoğraf için)
- kunye: telefon, kimlik no, doğum tarihi, ünvan, mağaza, adres,
  QR okutma durumu
- sutunlar: ["Mağaza", "Ünvan", "Giriş", "Çıkış", "Süre", "Çıkış Sebebi"]
- hucreler: her çalışma dönemi bir satır, en yenisi üstte
- hucreRenkleri: halen çalıştığı dönem "yesil", ayrıldıkları "yok"

Metin kısmında listeyi tekrar yazma; yalnızca dikkat çeken bir nokta varsa
belirt (sık iş değişikliği, kısa süreli ayrılmalar gibi).

RAPOR BİÇİMİ
Sayı, liste ya da kırılım içeren HER yanıtta gorsel_olustur aracını
kullan — yalnızca "rapor" kelimesi geçtiğinde değil. Üç ve daha fazla
satırlık her veri görsel olarak gösterilir. Metin içinde markdown tablosu
yazma; panelde okunmuyor.

Görsel gerektiren tipik sorular: kaç mağaza var, hangi bölgede kaç kişi,
pozisyon dağılımı, okutma oranları, kadro durumu, ciro kıyası, çıkış
nedenleri. Bunlarda önce veriyi araçla çek, sonra gorsel_olustur ile göster.

Yalnızca tek bir sayı ya da tek cümlelik cevap gerektiren sorularda görsel
üretme; orada düz metin doğrudur.

Rapor yapısı şöyle olmalı:
  1. Önce bir cümlelik özet ("Dün 35 mağazada 203 kişi okuttu, oran %23.")
  2. Sonra görsel (tablo ya da çubuk)
  3. Sonra dikkat çeken noktalar (2-3 madde)

RENK KULLANIMI (panelin kuralları)
- yesil: hedefin üzerinde, iyi durum, artış
- kirmizi: kritik, hedefin çok altında, düşüş, eksik kadro
- turuncu: dikkat edilmesi gereken ara durum
- mavi: norm ile ilgili değerler
- gri: nötr bilgi

Okutma oranı için: %80+ yeşil, %50-79 açık yeşil, %25-49 turuncu, %25 altı
kırmızı. Kadro farkı için: 0 yeşil, negatif kırmızı, pozitif turuncu.

SIRALAMA
Sorunlu olanı üste koy. Okutma oranı düşük mağaza, eksik kadrolu şube,
cirosu gerileyen mağaza önce görünsün.

ÜSLUP
- Kısa yaz. Uzun listede en önemli 5-10 satırı göster, "diğerleri panelde"
  de.
- Sayıları binlik ayraçla yaz (1.250.000 ₺).
- Dikkat çeken bir şey varsa sorulmasa da belirt: üç gündür hiç okutmayan
  mağaza, normun 3 kişi üstünde kadro, cirosu iki haftadır düşen şube.
- Ücret ve kimlik bilgisi hassastır; yalnızca doğrudan sorulduğunda söyle.
- Bir personel hakkında yorum yaparken veriye dayan, kişisel değerlendirme
  yapma.
""";

    /// <summary>
    /// Modele bir tur gönderir. Model araç çağırırsa çağrılar döner;
    /// çağırmazsa metin yanıtı döner.
    /// </summary>
    public async Task<TurSonucu> TurCalistir(List<object> mesajlar, string bugun)
    {
        var istemci = _istemciUretici.CreateClient();
        istemci.Timeout = TimeSpan.FromSeconds(60);

        istemci.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Anahtar);

        var tumMesajlar = new List<object>
        {
            new { role = "system", content = SistemYonergesi(bugun) }
        };

        tumMesajlar.AddRange(mesajlar);

        var istek = new
        {
            model = Model,
            max_tokens = 1200,
            temperature = 0.3,
            messages = tumMesajlar,
            tools = Araclar,
            tool_choice = "auto"
        };

        var govde = new StringContent(
            JsonSerializer.Serialize(istek), Encoding.UTF8, "application/json");

        var cevap = await istemci.PostAsync(
            "https://api.openai.com/v1/chat/completions", govde);

        var metin = await cevap.Content.ReadAsStringAsync();

        if (!cevap.IsSuccessStatusCode)
        {
            _kayit.LogWarning("Sohbet isteği başarısız: {Durum} {Metin}",
                cevap.StatusCode, metin[..Math.Min(400, metin.Length)]);

            throw new InvalidOperationException(
                "Yapay zekâ servisine ulaşılamadı.");
        }

        using var belge = JsonDocument.Parse(metin);

        var mesaj = belge.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message");

        var icerik = mesaj.TryGetProperty("content", out var c) &&
                     c.ValueKind == JsonValueKind.String
            ? c.GetString() ?? ""
            : "";

        var cagrilar = new List<AracCagrisi>();

        if (mesaj.TryGetProperty("tool_calls", out var araclar) &&
            araclar.ValueKind == JsonValueKind.Array)
        {
            foreach (var a in araclar.EnumerateArray())
            {
                cagrilar.Add(new AracCagrisi(
                    a.GetProperty("id").GetString(),
                    a.GetProperty("function").GetProperty("name").GetString(),
                    a.GetProperty("function").GetProperty("arguments").GetString() ?? "{}"));
            }
        }

        return new TurSonucu(icerik, cagrilar, mesaj.GetRawText());
    }

    public static int TurSiniri => EnFazlaTur;
}

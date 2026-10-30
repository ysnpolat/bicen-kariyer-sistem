using System.Text;
using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Başvuru fotoğrafını görsel modelle inceler.
///
/// <para>
/// Otomatik gönderimlerde fotoğraf alanına gerçek bir insan yüzü yerine
/// hayvan, çizim, maskeli figür ya da rastgele bir görsel konuyor. Desen
/// tanıma (özet karşılaştırma) botun görseli değiştirmesiyle etkisiz
/// kalıyor; görüntünün <b>ne olduğuna</b> bakmak bu döngüyü kırıyor.
/// </para>
///
/// <para>
/// <b>Kasıtlı bir tercih:</b> Model erişilemezse başvuru reddedilmez.
/// Gerçek adayları kesmek, birkaç sahte kaydın geçmesinden daha kötüdür.
/// Reddedilen başvurular da silinmez; panelden incelenip aktarılabilir.
/// </para>
/// </summary>
public class YapayZekaServisi
{
    private readonly IHttpClientFactory _istemciUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<YapayZekaServisi> _kayit;

    public YapayZekaServisi(
        IHttpClientFactory istemciUretici,
        IConfiguration yapilandirma,
        ILogger<YapayZekaServisi> kayit)
    {
        _istemciUretici = istemciUretici;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /// <summary>
    /// Başvuruların (fotoğraf + form) yapay zekâyla incelenmesi kapalı
    /// (08.10.2026, KVKK md. 9: yurt dışına aktarım). Sahte başvuruya karşı
    /// kaynak denetimi, toplu gönderim kipi ve bal küpü çalışmaya devam ediyor.
    /// </summary>
    public const bool BasvuruIncelemesiKapali = true;

    public bool Etkin =>
        _yapilandirma.GetValue("YapayZeka:Acik", false) &&
        !string.IsNullOrWhiteSpace(Anahtar);

    private string Anahtar => _yapilandirma["YapayZeka:Anahtar"];

    private string Model =>
        _yapilandirma["YapayZeka:Model"] ?? "gpt-4o-mini";

    /// <summary>
    /// Bu güven değerinin altındaki retler uygulanmaz.
    ///
    /// Eşik düşük tutulabilir: reddedilen başvurular silinmiyor, İnceleme
    /// sekmesine düşüyor ve İK gerçek adayı oradan aktarabiliyor. Yanlış
    /// bir retin bedeli, sahte bir başvurunun geçmesinden düşüktür.
    /// </summary>
    private int GuvenEsigi =>
        _yapilandirma.GetValue("YapayZeka:GuvenEsigi", 70);

    /// <summary>İnceleme sonucu</summary>
    public record Karar(
        bool Gecerli,
        string Sonuc,
        string Gerekce,
        int Guven,
        bool Denetlendi);

    /// <summary>
    /// Başvurunun tamamını inceler: fotoğraf ve form verisi birlikte.
    ///
    /// <para>
    /// Yalnızca fotoğrafa bakmak yetmiyor; bot internetten indirilmiş
    /// gerçek insan fotoğrafları kullanıyor. Form verisiyle birlikte
    /// bakıldığında tutarsızlıklar ortaya çıkıyor: ad soyad ile fotoğraftaki
    /// kişinin cinsiyeti/yaşı uyuşmuyor, adres bilgileri şablon gibi
    /// duruyor, eğitim ile başvurulan pozisyon anlamsız eşleşiyor.
    /// </para>
    /// </summary>
    public async Task<Karar> BasvuruIncele(string base64, string formOzeti)
    {
        /* KVKK (08.10.2026): aday fotoğrafı ve form bilgisi yurt dışındaki
           yapay zekâ servisine gönderilmiyor. Ayarda açık olsa da çalışmaz;
           açmak için bu satır bilerek kaldırılmalı (standart sözleşme ve
           Kurul bildirimi yapılmadan açılmamalı). */
        if (BasvuruIncelemesiKapali) return new Karar(true, "ATLANDI", "Başvuru incelemesi kapalı (KVKK)", 0, false);

        if (!Etkin) return new Karar(true, "ATLANDI", "Denetim kapalı", 0, false);

        /* $$ ile açılır: değişken {{...}} ile yazılır, JSON'daki tek süslü
           parantezler olduğu gibi kalır. Tek $ ile "{{" iki kez açılış
           sayılıp derleme hatası veriyordu. */
        var yonerge = $$"""
Bir iş başvurusunu değerlendiriyorsun. Sana hem yüklenen fotoğraf hem form
bilgileri veriliyor. Soru şu: "Bu başvuruyu gerçek bir aday mı yaptı, yoksa
otomatik bir gönderim mi?"

FORM BİLGİLERİ
{{formOzeti}}

NEYE BAKACAKSIN

1. FOTOĞRAF BAŞVURU FOTOĞRAFI MI
   - Vesikalık, selfie ya da yüzün bütün göründüğü normal fotoğraf geçerli
   - Yüzün bir kısmı kadraj dışındaysa geçersiz
   - Görüntünün büyük bölümü düz renk ya da boş blok ise geçersiz
   - Stok fotoğraf, haber görseli, ünlü kişi, film karesi ise geçersiz
   - Hayvan, çizim, maske, nesne ise geçersiz

2. FOTOĞRAF FORMLA TUTARLI MI
   - Ad soyad ile fotoğraftaki kişinin görünen cinsiyeti uyuşuyor mu
   - Doğum tarihinden çıkan yaş ile fotoğraftaki yaş yakın mı
   - Belirgin bir uyuşmazlık varsa (25 yaşındaki bir adaya 60 yaşında
     fotoğraf gibi) bu güçlü bir işarettir

3. FORM VERİSİ İNANDIRICI MI
   - Adres bilgileri gerçek bir yeri tarif ediyor mu, şablon mu duruyor
   - Ad soyad gerçek bir Türk adı mı, rastgele harf dizisi mi
   - Eğitim düzeyi ile başvurulan pozisyon makul mü
   - Alanlar birbirini tutuyor mu

KARAR
Yukarıdakilerden herhangi biri belirgin biçimde sorunluysa otomatik gönderim
say. Tek başına zayıf bir işaret varsa (örneğin fotoğraf biraz bulanık)
gerçek aday saymayı tercih et.

Yalnızca şu JSON'u döndür, başka hiçbir şey yazma:
{"gecerli": true veya false, "gerekce": "kısa Türkçe açıklama", "guven": 0-100}

"gerekce" hangi işareti gördüğünü somut yazsın: "fotoğrafın yarısı düz renk",
"ad kadın, fotoğraf erkek", "adres alanları şablon" gibi.

Kararsız kaldığında gecerli=true de. Reddedilen başvurular İK tarafından
ayrıca inceleniyor.
""";

        return await ModeleSor(base64, yonerge);
    }

    /// <summary>
    /// Fotoğrafın gerçek bir kişiye ait vesikalık olup olmadığını inceler.
    /// Denetim yapılamazsa <c>Denetlendi=false</c> döner ve başvuru geçer.
    /// </summary>
    public async Task<Karar> FotografIncele(string base64)
    {
        if (BasvuruIncelemesiKapali) return new Karar(true, "ATLANDI", "Başvuru incelemesi kapalı (KVKK)", 0, false);

        var yonerge = """
Bir iş başvurusuna yüklenmiş fotoğrafı değerlendiriyorsun. Soru şu:
"Bu kişi bu fotoğrafı kendi iş başvurusu için mi yükledi?"

Yalnızca "insan yüzü var mı" diye bakma. Otomatik gönderimler internetten
indirilmiş rastgele fotoğraflar kullanıyor; bunlarda da insan yüzü oluyor.
Ayırt edici olan fotoğrafın BAŞVURU FOTOĞRAFI olup olmadığı.

GEÇERLİ say:
- Vesikalık ya da vesikalık benzeri portre
- Kişinin kendi çektiği selfie
- Yüzün tamamının göründüğü normal bir fotoğraf
- Işık, arka plan ya da çözünürlük kötü olabilir; yüz bütün hâlde
  görünüyorsa sorun değil
- Gözlük, başörtüsü, sakal, makyaj, şapka doğal unsurlardır

GEÇERSİZ say:
- Yüzün bir kısmı kesilmiş: alın, çene, ağız ya da bir yanak kadraj dışında
- Görüntünün büyük bir bölümü düz renk, boş ya da anlamsız blok
- Yakın plana zorlanmış, aşırı büyütülmüş, bozuk kırpılmış görsel
- İnternetten indirilmiş izlenimi veren fotoğraf: haber görseli, stok
  fotoğraf, ünlü kişi, film karesi, ekran görüntüsü
- Birden fazla kişi varsa ve kimin başvurduğu belli değilse
- Hayvan, çizim, karikatür, yapay üretilmiş görsel
- Maske, kostüm ya da yüzü gizleyen figür
- Nesne, manzara, logo, yazı
- Boş, tek renk ya da tamamen bulanık görüntü

KARAR VERİRKEN
Kendine şunu sor: "Bu fotoğrafı kişi kendisi mi çekmiş?"

Gerçek adaylar fotoğraflarını kendileri çeker: selfie ya da bir yakınının
çektiği portre. Hazır, indirilmiş ya da üretilmiş görsel kullanmazlar.
Bu yüzden "kendi çekilmiş fotoğraf" izlenimi vermeyen her görsele şüpheyle
yaklaş.

KENDİ ÇEKİLMİŞ FOTOĞRAF İZLENİMİ VEREN İŞARETLER
- Doğal, kusurlu ışık; ev, iş yeri, araç, sokak gibi sıradan arka plan
- Telefon kamerasına özgü açı: hafif alttan bakış, kola uzanmış mesafe
- Kadrajın ortalanmamış olması, hafif eğiklik
- Sıradan kıyafet, doğal ifade

ŞÜPHE UYANDIRAN İŞARETLER
- Stüdyo kalitesinde ışık ve arka plan, profesyonel poz
- Kusursuz cilt, simetrik yüz, yapay pürüzsüzlük
- Model ya da tanıtım fotoğrafı havası
- Filigran, kırpılmış kenar, yazı izi, ekran görüntüsü çerçevesi
- Aynı fotoğrafın internette dolaşıyor olabileceği hissi

Yalnızca şu JSON'u döndür, başka hiçbir şey yazma:
{"gecerli": true veya false, "gerekce": "kısa Türkçe açıklama", "guven": 0-100}

"gerekce" ne gördüğünü somut yazsın: "yüzün alt yarısı kadraj dışında",
"görüntünün yarısı düz renk", "stok fotoğraf izlenimi veriyor" gibi.

"guven" kararından ne kadar emin olduğunu gösterir.

KARARSIZ KALIRSAN gecerli=false demeyi tercih et. Reddedilen başvurular
silinmez, İnceleme sekmesine düşer ve İK bunlara tek tek bakar. Yani
şüpheli bir görseli işaretlemenin bedeli düşüktür; sahte bir başvurunun
gerçek gibi geçmesinin bedeli yüksektir.

Yalnızca fotoğrafın açıkça kişinin kendi çektiği bir portre olduğundan
eminsen gecerli=true de.
""";

        /* Önce görüntünün kendi köken kaydına bakılır. Bu, modele sormaktan
           farklıdır: tahmin değil, üretici tarafından dosyaya gömülmüş
           imzalı bilgidir. Bulunursa modele hiç gitmeye gerek kalmaz. */
        var koken = KokenDenetimi(base64);

        if (koken is not null) return koken;

        return await ModeleSor(base64, yonerge);
    }

    /* ==================================================================== */
    /* Metin özetleme                                                        */
    /* ==================================================================== */

    /// <summary>
    /// Verilen metni, verilen yönergeye göre özetler. Çıkış mülakatı
    /// raporlaması bunu kullanır.
    ///
    /// Model erişilemezse boş değil, açıklayıcı bir metin döner: özet
    /// alınamadığında ekranda ne olduğu anlaşılmalı.
    /// </summary>
    public async Task<string> MetinOzetle(string metin, string yonerge)
    {
        if (!Etkin)
            return "Yapay zekâ servisi kapalı (appsettings.json → YapayZeka).";

        if (string.IsNullOrWhiteSpace(metin))
            return "Özetlenecek metin bulunamadı.";

        /* Çok uzun metin modelin sınırını aşar; baştan kesilir.
           Mülakatlar tarihe göre sıralı geldiği için en yeniler korunur. */
        var kirpik = metin.Length > 60000 ? metin[..60000] : metin;

        try
        {
            var istemci = _istemciUretici.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(120);

            istemci.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Anahtar);

            var istek = new
            {
                model = Model,
                messages = new object[]
                {
                    new { role = "system", content = yonerge },
                    new { role = "user", content = kirpik }
                },
                max_tokens = 1500
            };

            using var govde = new StringContent(
                JsonSerializer.Serialize(istek),
                System.Text.Encoding.UTF8, "application/json");

            var cevap = await istemci.PostAsync(
                "https://api.openai.com/v1/chat/completions", govde);

            var icerik = await cevap.Content.ReadAsStringAsync();

            if (!cevap.IsSuccessStatusCode)
            {
                _kayit.LogWarning("Özet alınamadı: {Durum} {Icerik}",
                    cevap.StatusCode, icerik[..Math.Min(300, icerik.Length)]);

                return $"Özet alınamadı (sağlayıcı {(int)cevap.StatusCode} döndü).";
            }

            using var belge = JsonDocument.Parse(icerik);

            return belge.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? "Özet boş döndü.";
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Özet çıkarılamadı");
            return $"Özet çıkarılamadı: {hata.Message}";
        }
    }

    /* ==================================================================== */
    /* C2PA köken denetimi                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Yapay zekâ üretimi olduğunu belirten C2PA işaretleri.
    ///
    /// <para>
    /// C2PA, görsellerin nasıl üretildiğini imzalı olarak dosyaya gömen bir
    /// standarttır. Yapay zekâ araçları ürettikleri görsele
    /// <c>trainedAlgorithmicMedia</c> türünde bir kayıt koyar. Bu, görsel
    /// modele "yapay mı" diye sormaktan çok daha güvenilirdir çünkü tahmin
    /// değil, üreticinin kendi beyanıdır.
    /// </para>
    ///
    /// <para>
    /// <b>Dikkat:</b> C2PA'nın varlığı tek başına yapaylık kanıtı DEĞİLDİR.
    /// Bazı telefonlar çektikleri her fotoğrafa köken kaydı ekler; orada tür
    /// <c>digitalCapture</c> olur ve bu tamamen normaldir. Bu yüzden yalnızca
    /// yapay üretimi belirten türler aranır.
    /// </para>
    /// </summary>
    private static readonly string[] YapayKokenIsaretleri =
    {
        "trainedAlgorithmicMedia",
        "compositeWithTrainedAlgorithmicMedia",
        "algorithmicMedia"
    };

    /// <summary>
    /// Görselin içine gömülü köken kaydını okur. Yapay üretim işareti
    /// bulunursa geçersiz kararı döner; bulunmazsa null döner ve inceleme
    /// normal akışla (görsel modelle) sürer.
    /// </summary>
    private Karar KokenDenetimi(string base64)
    {
        try
        {
            var ham = base64;

            var virgul = ham.IndexOf(',');
            if (ham.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && virgul > 0)
                ham = ham[(virgul + 1)..];

            var bayt = Convert.FromBase64String(ham);

            /* Köken kaydı dosyanın başlarında, JPEG başlık bloklarında
               durur; tamamını taramaya gerek yok. Metin olarak aranır. */
            var uzunluk = Math.Min(bayt.Length, 256 * 1024);
            var metin = System.Text.Encoding.ASCII.GetString(bayt, 0, uzunluk);

            foreach (var isaret in YapayKokenIsaretleri)
            {
                if (metin.Contains(isaret, StringComparison.OrdinalIgnoreCase))
                {
                    _kayit.LogWarning(
                        "Fotoğrafta yapay üretim köken kaydı bulundu: {Isaret}", isaret);

                    return new Karar(false, "YAPAY GÖRSEL",
                        "Fotoğrafın köken kaydı görselin yapay zekâ ile "
                        + "üretildiğini belirtiyor.", 100, false);
                }
            }

            return null;
        }
        catch
        {
            /* Görsel çözülemezse köken denetimi atlanır; karar modele kalır. */
            return null;
        }
    }

    /// <summary>Görseli ve yönergeyi modele gönderip kararı ayrıştırır.</summary>
    private async Task<Karar> ModeleSor(string base64, string yonerge)
    {
        if (!Etkin || string.IsNullOrWhiteSpace(base64))
            return new Karar(true, "ATLANDI", "Denetim kapalı", 0, false);

        var gorsel = base64.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            ? base64
            : $"data:image/jpeg;base64,{base64}";

        try
        {
            var istemci = _istemciUretici.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(20);

            istemci.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Anahtar);

            var istek = new
            {
                model = Model,
                max_tokens = 200,
                messages = new object[]
                {
                    new
                    {
                        role = "user",
                        content = new object[]
                        {
                            new { type = "text", text = yonerge },
                            new
                            {
                                type = "image_url",
                                image_url = new { url = gorsel, detail = "low" }
                            }
                        }
                    }
                }
            };

            var govde = new StringContent(
                JsonSerializer.Serialize(istek), Encoding.UTF8, "application/json");

            var cevap = await istemci.PostAsync(
                "https://api.openai.com/v1/chat/completions", govde);

            if (!cevap.IsSuccessStatusCode)
            {
                var hataMetni = await cevap.Content.ReadAsStringAsync();

                _kayit.LogWarning("Görsel incelemesi başarısız: {Durum} {Metin}",
                    cevap.StatusCode, hataMetni[..Math.Min(300, hataMetni.Length)]);

                return new Karar(true, "HATA", "Model yanıt vermedi", 0, false);
            }

            var metin = await cevap.Content.ReadAsStringAsync();

            using var belge = JsonDocument.Parse(metin);

            var icerik = belge.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? "";

            /* Model bazen ```json çitleri ya da açıklama metni ekliyor;
               gövdedeki ilk JSON bloğu çekilir. */
            icerik = icerik.Replace("```json", "").Replace("```", "").Trim();

            if (!icerik.StartsWith("{"))
            {
                var bas = icerik.IndexOf('{');
                var son = icerik.LastIndexOf('}');

                if (bas >= 0 && son > bas)
                    icerik = icerik[bas..(son + 1)];
            }

            JsonElement kok;

            try
            {
                using var sonuc = JsonDocument.Parse(icerik);
                kok = sonuc.RootElement.Clone();
            }
            catch
            {
                _kayit.LogWarning("Model yanıtı ayrıştırılamadı: {Yanit}",
                    icerik[..Math.Min(200, icerik.Length)]);

                return new Karar(true, "AYRIŞTIRILAMADI",
                    "Model yanıtı okunamadı", 0, false);
            }

            var gecerli = !kok.TryGetProperty("gecerli", out var g)
                          || g.ValueKind != JsonValueKind.False;

            var gerekce = kok.TryGetProperty("gerekce", out var a)
                ? (a.GetString() ?? "").Trim()
                : "";

            if (string.IsNullOrWhiteSpace(gerekce))
                gerekce = "Fotoğrafta gerçek bir insan yüzü bulunamadı";

            var guven = kok.TryGetProperty("guven", out var v) &&
                        v.TryGetInt32(out var sayi)
                ? sayi
                : 0;

            /* Model emin değilse ret uygulanmaz */
            if (!gecerli && guven < GuvenEsigi)
            {
                return new Karar(true, "DÜŞÜK GÜVEN",
                    $"{gerekce} (güven %{guven}, eşik %{GuvenEsigi})", guven, true);
            }

            return new Karar(
                gecerli,
                gecerli ? "GEÇERLİ" : "REDDEDİLDİ",
                gerekce,
                guven,
                true);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Görsel incelemesi yapılamadı");
            return new Karar(true, "HATA", hata.Message, 0, false);
        }
    }
}

using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Test verisi üretimi.
///
/// Panelin akışını denemek için gerçek aday formunu doldurmadan başvuru
/// oluşturur. Zorunlu alan kontrolü uygulanmaz, eksik bilgiler makul
/// varsayılanlarla tamamlanır. Üretilen kayıtlar test_kaydi = 1 olarak
/// işaretlenir ve tek komutla temizlenebilir.
///
/// Bu bölüm varsayılan olarak KAPALIDIR: canlı sistemde yanlışlıkla test
/// kaydı oluşturulmasını önlemek için. Açmak gerekirse appsettings.json
/// içine şu ayar eklenir:
///
///     "TestVerisi": { "Acik": true }
///
/// Kapalıyken üretim uçları çalışmaz; mevcut test kayıtlarını temizleme
/// ve sayma uçları çalışmaya devam eder.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TestController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly IConfiguration _yapilandirma;

    public TestController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        IConfiguration yapilandirma)
    {
        _vt = vt;
        _ayar = ayar;
        _yapilandirma = yapilandirma;
    }

    /// <summary>Test verisi üretimi açık mı?</summary>
    private bool UretimAcik =>
        _yapilandirma.GetValue("TestVerisi:Acik", false);

    /// <summary>Kapalıyken üretim uçlarının döndürdüğü yanıt</summary>
    private IActionResult Kapali() => StatusCode(403, new
    {
        hata = "Test verisi üretimi kapalıdır.",
        ayrinti = "Açmak için sunucudaki appsettings.json dosyasına "
                + "\"TestVerisi\": { \"Acik\": true } ayarı eklenmelidir."
    });

    /// <summary>Bu bölümün açık olup olmadığını bildirir.</summary>
    [HttpGet("Durum")]
    public IActionResult Durum() => Ok(new { acik = UretimAcik });

    /* ==================================================================== */
    /* Örnek veri havuzları                                                 */
    /* ==================================================================== */

    private static readonly string[] Adlar =
    {
        "Ahmet", "Mehmet", "Mustafa", "Ali", "Hüseyin", "Hasan", "İbrahim",
        "Emre", "Burak", "Serkan", "Murat", "Kadir", "Yusuf", "Enes", "Furkan",
        "Ayşe", "Fatma", "Emine", "Hatice", "Zeynep", "Elif", "Merve", "Büşra",
        "Esra", "Şeyma", "Melike", "Sultan", "Derya", "Gamze", "Sevgi"
    };

    private static readonly string[] Soyadlar =
    {
        "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım",
        "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan",
        "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek", "Polat", "Korkmaz"
    };

    private static readonly string[] Ilceler =
    {
        "Küçükçekmece", "Bahçelievler", "Avcılar", "Bağcılar", "Esenyurt",
        "Başakşehir", "Güngören", "Beylikdüzü", "Zeytinburnu", "Bakırköy"
    };

    private static readonly string[] Mahalleler =
    {
        "Cennet Mahallesi", "Atatürk Mahallesi", "Cumhuriyet Mahallesi",
        "Fatih Mahallesi", "Yeni Mahalle", "Merkez Mahallesi",
        "İnönü Mahallesi", "Kartaltepe Mahallesi"
    };

    private static readonly string[] Durumlar_ =
    {
        Durumlar.Yeni, Durumlar.Yeni, Durumlar.Yeni,
        Durumlar.Degerlendirmede, Durumlar.Degerlendirmede,
        Durumlar.GorusmeTalebi,
        Durumlar.Olumlu, Durumlar.Olumlu,
        Durumlar.Olumsuz
    };

    private static readonly string[] KanGruplari =
    {
        "A Rh+", "A Rh-", "B Rh+", "0 Rh+", "AB Rh+", "0 Rh-"
    };

    private static readonly string[] Egitimler =
    {
        "Lise", "Ön Lisans", "Lisans (Üniversite)", "Ortaokul", "Yüksek Lisans"
    };

    /* ==================================================================== */
    /* Tekil kayıt                                                          */
    /* ==================================================================== */

    /// <summary>Kısa formdan gelen bilgilerle tek bir test başvurusu oluşturur.</summary>
    [HttpPost("Basvuru")]
    public IActionResult Basvuru([FromBody] JsonElement govde)
    {
        if (!UretimAcik) return Kapali();

        string Al(string alan, string varsayilan = "") =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
                ? (string.IsNullOrWhiteSpace(d.GetString()) ? varsayilan : d.GetString())
                : varsayilan;

        var rastgele = Random.Shared;
        var ayar = _ayar.FormOku();

        var adSoyad = Al("adSoyad", RastgeleAd(rastgele));
        var birimKodu = Al("subeKodu");
        var birim = ayar.Subeler?.FirstOrDefault(x => x.Kod == birimKodu)
                    ?? ayar.Subeler?.FirstOrDefault();

        var bolumler = govde.TryGetProperty("bolumler", out var b) &&
                       b.ValueKind == JsonValueKind.Array
            ? b.EnumerateArray().Select(x => x.GetString()).Where(x => !string.IsNullOrWhiteSpace(x)).ToList()
            : new List<string>();

        if (bolumler.Count == 0)
        {
            var turBolumleri = ayar.BirimTurleri?
                .FirstOrDefault(x => x.Ad == (birim?.Tur ?? "Şube"))?.Bolumler;

            if (turBolumleri is { Count: > 0 })
                bolumler.Add(turBolumleri[rastgele.Next(turBolumleri.Count)]);
        }

        var durum = Al("durum", Durumlar.Yeni);
        if (!Durumlar.Tumu.Contains(durum)) durum = Durumlar.Yeni;

        var id = Olustur(
            adSoyad: adSoyad,
            kimlik: Al("kimlikNo", RastgeleKimlik(rastgele)),
            telefon: Al("telefon", RastgeleTelefon(rastgele)),
            eposta: Al("eposta"),
            birim: birim,
            bolumler: bolumler,
            durum: durum,
            tarih: DateTime.Now,
            rastgele: rastgele,
            ayar: ayar);

        return Ok(new { basarili = true, id });
    }

    /* ==================================================================== */
    /* Toplu rastgele kayıt                                                 */
    /* ==================================================================== */

    [HttpPost("Rastgele")]
    public IActionResult Rastgele([FromQuery] int adet = 10, [FromQuery] int gun = 90)
    {
        if (!UretimAcik) return Kapali();

        if (adet is < 1 or > 200) adet = 10;
        if (gun is < 1 or > 730) gun = 90;

        var rastgele = Random.Shared;
        var ayar = _ayar.FormOku();

        var birimler = ayar.Subeler?.Where(x => !string.IsNullOrWhiteSpace(x.Kod)).ToList()
                       ?? new List<Sube>();

        if (birimler.Count == 0)
            return BadRequest(new { hata = "Önce Form Ayarları'ndan birim tanımlayınız." });

        var uretilen = 0;

        for (var i = 0; i < adet; i++)
        {
            var birim = birimler[rastgele.Next(birimler.Count)];

            var turBolumleri = ayar.BirimTurleri?
                .FirstOrDefault(x => x.Ad == (birim.Tur ?? "Şube"))?.Bolumler
                ?? new List<string>();

            var bolumler = new List<string>();
            if (turBolumleri.Count > 0)
            {
                var kac = rastgele.Next(1, Math.Min(3, turBolumleri.Count) + 1);
                bolumler = turBolumleri
                    .OrderBy(_ => rastgele.Next())
                    .Take(kac)
                    .ToList();
            }

            Olustur(
                adSoyad: RastgeleAd(rastgele),
                kimlik: RastgeleKimlik(rastgele),
                telefon: RastgeleTelefon(rastgele),
                eposta: "",
                birim: birim,
                bolumler: bolumler,
                durum: Durumlar_[rastgele.Next(Durumlar_.Length)],
                tarih: DateTime.Now.AddDays(-rastgele.Next(gun)).AddHours(-rastgele.Next(12)),
                rastgele: rastgele,
                ayar: ayar);

            uretilen++;
        }

        return Ok(new { basarili = true, uretilen });
    }

    /* ==================================================================== */
    /* Temizlik                                                             */
    /* ==================================================================== */

    [HttpGet("Sayi")]
    public IActionResult Sayi()
    {
        using var db = _vt.Baglanti();
        var adet = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_BASVURULAR WHERE test_kaydi = 1");

        return Ok(new { adet });
    }

    /// <summary>Tüm test kayıtlarını ve bunlara ait not/hareketleri siler.</summary>
    [HttpDelete("Temizle")]
    public IActionResult Temizle()
    {
        using var db = _vt.Baglanti();

        var silinen = db.Execute(@"
DELETE FROM KRY_BASVURU_NOT
WHERE basvuru_id IN (SELECT id FROM KRY_BASVURULAR WHERE test_kaydi = 1);

DELETE FROM KRY_BASVURU_HAREKET
WHERE basvuru_id IN (SELECT id FROM KRY_BASVURULAR WHERE test_kaydi = 1);

DELETE FROM KRY_BASVURULAR WHERE test_kaydi = 1;");

        return Ok(new { basarili = true, silinen });
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    private int Olustur(
        string adSoyad, string kimlik, string telefon, string eposta,
        Sube birim, List<string> bolumler, string durum, DateTime tarih,
        Random rastgele, FormAyarlari ayar)
    {
        var parcalar = adSoyad.Split(' ', 2);
        var ad = parcalar[0];
        var soyad = parcalar.Length > 1 ? parcalar[1] : "";

        var ilce = Ilceler[rastgele.Next(Ilceler.Length)];
        var mahalle = Mahalleler[rastgele.Next(Mahalleler.Length)];
        var basvuruNo = $"TEST-{tarih:yyyyMMdd}-{rastgele.Next(1000, 9999)}";
        var bolumMetni = string.Join(", ", bolumler);

        /* Form önizlemesinin çalışması için aday formuyla aynı yapıda JSON */
        var veri = new Dictionary<string, object>
        {
            ["basvuruNo"] = basvuruNo,
            ["ad"] = ad,
            ["soyad"] = soyad,
            ["adayAdSoyad"] = adSoyad,
            ["uyruk"] = "T.C.",
            ["tcKimlikNo"] = kimlik,
            ["dogumTarihi"] = DateTime.Today.AddYears(-rastgele.Next(19, 45))
                .AddDays(-rastgele.Next(365)).ToString("dd.MM.yyyy"),
            ["dogumYeri"] = ilce,
            ["kanGrubu"] = KanGruplari[rastgele.Next(KanGruplari.Length)],
            ["medeniDurum"] = rastgele.Next(2) == 0 ? "Bekar" : "Evli",
            ["cocukSayisi"] = 0,
            ["cepTel1"] = telefon,
            ["cepTel2"] = "",
            ["email"] = eposta,
            ["il"] = "İstanbul",
            ["ilce"] = ilce,
            ["mahalle"] = mahalle,
            ["caddeSokak"] = $"{rastgele.Next(1, 40)}. Sokak",
            ["binaNo"] = rastgele.Next(1, 60).ToString(),
            ["daireNo"] = rastgele.Next(1, 20).ToString(),
            ["evAdresi"] = "",
            ["engelDurumuVarMi"] = "Hayır",
            ["engelTurleri"] = new List<string>(),
            ["engelOrani"] = null,
            ["askerlikDurumu"] = "Yapıldı",
            ["egitimSeviyesi"] = Egitimler[rastgele.Next(Egitimler.Length)],
            ["mezunOkul"] = "",
            ["ehliyetVarMi"] = rastgele.Next(2) == 0 ? "Evet" : "Hayır",
            ["ehliyetSinifi"] = "B",
            ["ticariTasitBelgesiVarMi"] = "Hayır",
            ["srcBelgeleri"] = new List<string>(),
            ["bilgisayarBilgisi"] = new List<string> { "Excel", "Word" },
            ["isTecrubesi"] = new List<object>(),
            ["sertifikalar"] = new List<object>(),
            ["referanslar"] = new List<object>(),
            ["oncedenBasvurduMu"] = "Hayır",
            ["oncedenCalistiMi"] = "Hayır",
            ["halenCalisiyorMu"] = "Hayır",
            ["talepEdilenNetUcret"] = $"{rastgele.Next(28, 45)}.000 ₺",
            ["iseBaslamaTarihi"] = DateTime.Today.AddDays(rastgele.Next(1, 30)).ToString("dd.MM.yyyy"),
            ["subeKodu"] = birim?.Kod ?? "",
            ["subeAdi"] = birim?.Ad ?? "",
            ["birimTuru"] = birim?.Tur ?? "Şube",
            ["bolumler"] = bolumler,
            ["taahhutOnay"] = true,
            ["kvkkOnay"] = true,
            ["aydinlatmaOnay"] = true,
            ["rizaIsleme"] = "Onay veriyorum",
            ["rizaReferans"] = "Onay veriyorum",
            ["rizaYetkiliMerci"] = "Onay veriyorum",
            ["rizaBeyanPaylasim"] = "Onay veriyorum",
            ["adayAdSoyadImza"] = adSoyad,
            ["beyanTarihi"] = tarih.ToString("dd.MM.yyyy"),
            ["gonderimZamani"] = tarih.ToString("dd.MM.yyyy HH:mm:ss"),
            ["testKaydi"] = true
        };

        var json = JsonSerializer.Serialize(veri, new JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        });

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_BASVURULAR
    (basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
     bolumler, birim_turu, il, ilce, mahalle, durum, veri_json,
     olusturma, test_kaydi)
VALUES
    (@no, @ad, @kimlik, @tel, @eposta, @subeKod, @subeAd, @bolumler,
     @birimTuru, @il, @ilce, @mahalle, @durum, @json,
     /* Kesirli saniye eklenir: koruma tetikleyicisi tam sıfır kesri
        elle ekleme sayıyor ve kaydı reddediyor. */
     DATEADD(microsecond, ABS(CHECKSUM(NEWID())) % 999000 + 1, @tarih), 1);

SELECT CAST(SCOPE_IDENTITY() AS INT);",
            new
            {
                no = basvuruNo,
                ad = adSoyad,
                kimlik,
                tel = telefon,
                eposta,
                subeKod = birim?.Kod ?? "",
                subeAd = birim?.Ad ?? "",
                bolumler = bolumMetni,
                birimTuru = birim?.Tur ?? "Şube",
                il = "İstanbul",
                ilce,
                mahalle,
                durum,
                json,
                tarih
            });

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici, tarih)
VALUES (@id, @durum, N'Test verisi olarak oluşturuldu.', @kullanici, @tarih)",
            new
            {
                id,
                durum,
                kullanici = User.Identity?.Name ?? "test",
                tarih
            });

        return id;
    }

    private static string RastgeleAd(Random r) =>
        $"{Adlar[r.Next(Adlar.Length)]} {Soyadlar[r.Next(Soyadlar.Length)]}";

    private static string RastgeleTelefon(Random r) =>
        $"05{r.Next(30, 60)}{r.Next(1000000, 9999999)}";

    private static string RastgeleKimlik(Random r) =>
        $"{r.Next(1, 10)}{r.Next(1000000000, int.MaxValue).ToString().PadLeft(10, '0')[..10]}";
}

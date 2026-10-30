using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Çıkış mülakatları.
///
/// <para>
/// İşten ayrılan personelle yapılan görüşme kayıtları. Sorular kod içinde
/// sabit değildir: Form Ayarları'ndan yönetilir, mülakat açılırken havuzdan
/// rastgele seçilir. "Soruları değiştir" denildiğinde yalnızca cevabı boş
/// olanlar yenilenir; doldurulmuş cevaplar korunur.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
/* Çıkış mülakatları ve anket yanıtları yalnızca bu üç role açıktır.
   Ankette kişiye "yalnızca Yönetim görür" sözü veriliyor; erişimi geniş
   bırakmak o sözü boşa çıkarırdı. Bölge müdürü ve koordinatör göremez. */
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class CikisMulakatController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly YapayZekaServisi _yz;
    private readonly ILogger<CikisMulakatController> _kayit;
    private readonly GuvenlikGunlugu _gunluk;

    public CikisMulakatController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        PersonelKaynagiServisi personelKaynak,
        YapayZekaServisi yz,
        ILogger<CikisMulakatController> kayit,
        GuvenlikGunlugu gunluk)
    {
        _vt = vt;
        _ayar = ayar;
        _personelKaynak = personelKaynak;
        _yz = yz;
        _kayit = kayit;
        _gunluk = gunluk;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private string KullaniciAdSoyad =>
        User?.FindFirst("adSoyad")?.Value ?? Kullanici;

    /* ==================================================================== */
    /* Ayarlar                                                               */
    /* ==================================================================== */

    /// <summary>Soru havuzu ve çıkış nedenleri.</summary>
    [HttpGet("Ayar")]
    public IActionResult AyarOku() => Ok(_ayar.CikisMulakatOku());

    /// <summary>Soru havuzunu ve nedenleri günceller (yalnızca yönetici).</summary>
    [HttpPost("Ayar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult AyarYaz([FromBody] CikisMulakatAyari girdi)
    {
        girdi ??= new CikisMulakatAyari();

        girdi.Sorular = (girdi.Sorular ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        girdi.Nedenler = (girdi.Nedenler ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (girdi.Sorular.Count == 0)
            return BadRequest(new { hata = "En az bir soru tanımlamalısınız." });

        girdi.Puanlamalar = (girdi.Puanlamalar ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        girdi.SoruSayisi = Math.Clamp(girdi.SoruSayisi, 1, 20);

        _ayar.CikisMulakatYaz(girdi);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Soru seçimi                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Mülakat için soru seçer.
    ///
    /// <paramref name="korunan"/> içinde gönderilen sorular olduğu gibi
    /// kalır (İK uzmanı bunları cevaplamış demektir); geri kalan yerler
    /// havuzdaki diğer sorularla doldurulur. Böylece "soruları değiştir"
    /// denildiğinde doldurulmuş cevaplar kaybolmaz.
    /// </summary>
    [HttpPost("Sorular")]
    public IActionResult Sorular([FromBody] List<string> korunan)
    {
        var ayar = _ayar.CikisMulakatOku();

        korunan = (korunan ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var kalanYer = Math.Max(0, ayar.SoruSayisi - korunan.Count);

        /* Korunanlar havuzdan çıkarılır ki aynı soru iki kez gelmesin */
        var havuz = ayar.Sorular
            .Where(x => !korunan.Contains(x, StringComparer.OrdinalIgnoreCase))
            .OrderBy(_ => Random.Shared.Next())
            .Take(kalanYer)
            .ToList();

        return Ok(korunan.Concat(havuz).ToList());
    }

    /* ==================================================================== */
    /* Ayrılan personel listesi                                             */
    /* ==================================================================== */

    /// <summary>
    /// Mülakat yapılabilecek personel: işten ayrılmış olanlar. Daha önce
    /// mülakat yapılmışsa işaretlenir.
    /// </summary>
    [HttpGet("Ayrilanlar")]
    public IActionResult Ayrilanlar([FromQuery] string arama = null)
    {
        List<PersonelKaydi> ayrilanlar;

        try
        {
            ayrilanlar = _personelKaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 0)
                .OrderByDescending(x => x.CikisTarihi)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ayrılan personel listesi alınamadı");
            return Ok(new List<object>());
        }

        if (!string.IsNullOrWhiteSpace(arama))
        {
            var q = arama.Trim().ToLower(new System.Globalization.CultureInfo("tr-TR"));

            ayrilanlar = ayrilanlar
                .Where(x => $"{x.Ad} {x.Soyad} {x.PersonelKodu}"
                    .ToLower(new System.Globalization.CultureInfo("tr-TR"))
                    .Contains(q))
                .ToList();
        }

        using var db = _vt.Baglanti();

        var yapilanlar = db.Query<string>(
            "SELECT personel_kodu FROM KRY_CIKIS_MULAKAT WHERE personel_kodu IS NOT NULL")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return Ok(ayrilanlar.Take(300).Select(x => new
        {
            personelKodu = x.PersonelKodu,
            adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
            resimVar = x.ResimVar,
            resimSurumu = x.ResimSurumu,
            telefon = x.Telefon,
            subeAdi = x.Sube,
            gorev = x.Pozisyon,
            girisTarihi = x.GirisTarihi,
            cikisTarihi = x.CikisTarihi,
            /* Mikro'daki çıkış sebebi: mülakat açılınca neden alanı bununla
               ön dolu gelir, uzman gerekirse değiştirir. */
            cikisSebebi = string.IsNullOrWhiteSpace(x.CikisSebebi)
                ? null : x.CikisSebebi.Trim(),
            mulakatVar = !string.IsNullOrWhiteSpace(x.PersonelKodu)
                         && yapilanlar.Contains(x.PersonelKodu)
        }));
    }

    /* ==================================================================== */
    /* Kayıt                                                                 */
    /* ==================================================================== */

    /// <summary>Mülakatı kaydeder.</summary>
    [HttpPost]
    public async Task<IActionResult> Kaydet([FromBody] CikisMulakati girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.AdSoyad))
            return BadRequest(new { hata = "Personel seçiniz." });

        var dolu = (girdi.Sorular ?? new List<MulakatSorusu>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Soru)
                     && !string.IsNullOrWhiteSpace(x.Cevap))
            .ToList();

        if (dolu.Count == 0)
            return BadRequest(new { hata = "En az bir soruyu cevaplayınız." });

        using var db = _vt.Baglanti();

        /* Sorular, puanlar ve ek yanıtlar tek JSON alanında tutulur:
           soru listesi ayarlardan değiştiğinde sabit kolon yapısı
           kurulamıyor. */
        /* camelCase zorunlu: panel bu JSON'u doğrudan okuyor ve alan
           adlarını küçük harfle arıyor. Varsayılan PascalCase ile
           yazıldığında cevaplar ve puanlar boş görünüyordu. */
        var jsonSecenek = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        var json = JsonSerializer.Serialize(new
        {
            sorular = girdi.Sorular ?? new List<MulakatSorusu>(),
            puanlar = girdi.Puanlar ?? new List<MulakatPuani>(),
            telefon = girdi.Telefon,
            tekrarCalisir = girdi.TekrarCalisir,
            tavsiyePuani = girdi.TavsiyePuani
        }, jsonSecenek);

        /* Tek cümlelik özet: listede çıkış nedeninin yanında görünür.
           İK yöneticisi otuz satırlık listeyi tek tek açmadan hangi
           mülakatta ne konuşulduğunu görebilmeli. */
        var analiz = await CikisAnalizi.Analiz(_yz,
            CikisAnalizi.Metin(json, girdi.CikisNedeni, girdi.CikisNedeniAciklama, girdi.UzmanYorumu),
            girdi.CikisNedeni);

        var ozet = analiz.Ozet;
        var grup = analiz.Grup;

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_CIKIS_MULAKAT
SET cikis_nedeni = @cikisNedeni, cikis_nedeni_aciklama = @nedenAciklama,
    sorular_json = @json, uzman_yorumu = @yorum,
    ozet = COALESCE(@ozet, ozet), neden_grubu = @grup
WHERE id = @id",
                new
                {
                    id = girdi.Id,
                    cikisNedeni = girdi.CikisNedeni,
                    nedenAciklama = string.IsNullOrWhiteSpace(girdi.CikisNedeniAciklama)
                        ? null : girdi.CikisNedeniAciklama.Trim(),
                    json,
                    yorum = girdi.UzmanYorumu,
                    ozet,
                    grup
                });

            return Ok(new { basarili = true, id = girdi.Id });
        }

        var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CIKIS_MULAKAT
    (personel_kodu, ad_soyad, sube_adi, gorev, giris_tarihi, cikis_tarihi,
     cikis_nedeni, cikis_nedeni_aciklama, sorular_json, uzman_yorumu,
     kullanici, uzman_adi, ozet, neden_grubu)
OUTPUT INSERTED.id
VALUES (@personelKodu, @adSoyad, @subeAdi, @gorev, @girisTarihi, @cikisTarihi,
        @cikisNedeni, @nedenAciklama, @json, @yorum, @kullanici, @uzmanAdi, @ozet, @grup)",
            new
            {
                personelKodu = girdi.PersonelKodu,
                adSoyad = girdi.AdSoyad,
                subeAdi = girdi.SubeAdi,
                gorev = girdi.Gorev,
                girisTarihi = girdi.GirisTarihi,
                cikisTarihi = girdi.CikisTarihi,
                cikisNedeni = girdi.CikisNedeni,
                nedenAciklama = string.IsNullOrWhiteSpace(girdi.CikisNedeniAciklama)
                    ? null : girdi.CikisNedeniAciklama.Trim(),
                json,
                yorum = girdi.UzmanYorumu,
                kullanici = Kullanici,
                uzmanAdi = KullaniciAdSoyad,
                ozet,
                grup
            });

        return Ok(new { basarili = true, id = yeniId });
    }

    /// <summary>Mülakat listesi.</summary>
    [HttpGet]
    public IActionResult Liste(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string uzman = null,
        [FromQuery] string neden = null)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-12);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT id            AS id,
       personel_kodu AS personelKodu,
       ad_soyad      AS adSoyad,
       sube_adi      AS subeAdi,
       gorev         AS gorev,
       giris_tarihi  AS girisTarihi,
       cikis_tarihi  AS cikisTarihi,
       cikis_nedeni  AS cikisNedeni,
       cikis_nedeni_aciklama AS cikisNedeniAciklama,
       sorular_json  AS sorularJson,
       uzman_yorumu  AS uzmanYorumu,
       kullanici     AS kullanici,
       uzman_adi     AS uzmanAdi,
       ozet          AS ozet,
       neden_grubu   AS nedenGrubu,
       yonetici_yorumu AS yoneticiYorumu,
       kaynak        AS kaynak,
       olusturma     AS olusturma
FROM KRY_CIKIS_MULAKAT
WHERE olusturma BETWEEN @bas AND @bit
  AND (@uzman IS NULL OR kullanici = @uzman)
  AND (@neden IS NULL OR cikis_nedeni = @neden)
ORDER BY olusturma DESC",
            new
            {
                bas = baslangic,
                bit = bitis,
                uzman = string.IsNullOrWhiteSpace(uzman) ? null : uzman,
                neden = string.IsNullOrWhiteSpace(neden) ? null : neden
            }).ToList();

        return Ok(liste);
    }

    public class EksikGirdi
    {
        public DateTime? Baslangic { get; set; }
        public DateTime? Bitis { get; set; }
        public List<int> Idler { get; set; }
    }

    /// <summary>
    /// Özeti ya da neden grubu eksik kayıtları tamamlar (29.09.2026).
    ///
    /// <para>
    /// Önceden tüm kayıtlar içinden en yeni 50'yi deniyor ve yalnızca
    /// soru-cevaplara bakıyordu. İçeriği olmayan (çizelgeden aktarılmış)
    /// kayıtlar her seferinde başarısız olup bu 50'lik yeri dolduruyor,
    /// ekrandaki dönemin kayıtlarına sıra hiç gelmiyordu; çıkış anketinden
    /// gelen kayıtların da özeti hiç üretilmiyordu. Artık ekranda seçili
    /// dönemin kayıtları işleniyor, ayrılma nedeni de metne ekleniyor;
    /// hiç içeriği olmayan kayda "yanıt yok" yazılıyor ki listede eksik
    /// görünmeye devam etmesin. Yapay zekâ hata verirse hata ekrana
    /// dönüyor.
    /// </para>
    /// </summary>
    [HttpPost("EksikOzetler")]
    public async Task<IActionResult> EksikOzetler([FromBody] EksikGirdi girdi = null)
    {
        using var db = _vt.Baglanti();

        var idler = (girdi?.Idler ?? new List<int>()).Distinct().ToArray();

        var bas = girdi?.Baslangic?.Date;
        var bit = girdi?.Bitis?.Date.AddDays(1).AddSeconds(-1);

        var eksikler = db.Query($@"
SELECT TOP 300 id AS id, sorular_json AS sorularJson, uzman_yorumu AS uzmanYorumu,
       yonetici_yorumu AS yoneticiYorumu, cikis_nedeni AS cikisNedeni,
       cikis_nedeni_aciklama AS nedenAciklama, ozet AS ozet, neden_grubu AS nedenGrubu
FROM KRY_CIKIS_MULAKAT
WHERE (ozet IS NULL OR LTRIM(RTRIM(ozet)) = '' OR neden_grubu IS NULL)
  {(idler.Length > 0 ? "AND id IN @idler" : "")}
  AND (@bas IS NULL OR olusturma >= @bas)
  AND (@bit IS NULL OR olusturma <= @bit)
ORDER BY olusturma DESC", new { idler, bas, bit }).ToList();

        if (eksikler.Count == 0)
            return Ok(new { basarili = true, uretilen = 0, siniflandirilan = 0, mesaj = "Eksik özet ya da sınıflandırma yok." });

        var uretilen = 0;
        var siniflandirilan = 0;
        string sonHata = null;
        var kilit = new object();

        /* Aynı anda dört istek: sağlayıcının hız sınırına takılmadan birkaç
           saniyede bitsin */
        using var sinir = new SemaphoreSlim(4);

        var gorevler = eksikler.Select(async k =>
        {
            await sinir.WaitAsync();
            try
            {
                string mevcutOzet = k.ozet;
                var ozetVar = !string.IsNullOrWhiteSpace(mevcutOzet);

                var metin = CikisAnalizi.Metin((string)k.sorularJson, (string)k.cikisNedeni,
                    (string)k.nedenAciklama, (string)k.uzmanYorumu, (string)k.yoneticiYorumu);

                string ozet;
                string grup;

                if (string.IsNullOrWhiteSpace(metin))
                {
                    ozet = ozetVar ? mevcutOzet : "Görüşmede yanıt girilmemiş.";
                    grup = CikisAnalizi.BELIRTILMEMIS;
                }
                else
                {
                    var a = await CikisAnalizi.Analiz(_yz, metin, (string)k.cikisNedeni);

                    if (a.Hata is not null) lock (kilit) sonHata = a.Hata;

                    ozet = ozetVar ? mevcutOzet : a.Ozet;
                    grup = a.Grup;
                }

                using var yaz = _vt.Baglanti();

                yaz.Execute(@"
UPDATE KRY_CIKIS_MULAKAT
SET ozet = COALESCE(@ozet, ozet),
    neden_grubu = COALESCE(neden_grubu, @grup)
WHERE id = @id", new { id = (int)k.id, ozet, grup });

                lock (kilit)
                {
                    if (!ozetVar && !string.IsNullOrWhiteSpace(ozet)) uretilen++;
                    if (k.nedenGrubu is null && grup is not null) siniflandirilan++;
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Çıkış mülakatı özeti tamamlanamadı: {Id}", (int)k.id);
                lock (kilit) sonHata = hata.Message;
            }
            finally
            {
                sinir.Release();
            }
        });

        await Task.WhenAll(gorevler);

        return Ok(new
        {
            basarili = sonHata is null,
            uretilen,
            siniflandirilan,
            toplam = eksikler.Count,
            hata = sonHata,
        });
    }

    public class NedenGrubuGirdi
    {
        public string Grup { get; set; }
    }

    /// <summary>Neden grubunu elle değiştirir (yapay zekâ yanlış seçtiyse).</summary>
    [HttpPost("{id:int}/NedenGrubu")]
    public IActionResult NedenGrubu(int id, [FromBody] NedenGrubuGirdi girdi)
    {
        var grup = CikisAnalizi.GrupEsle(girdi?.Grup);

        if (grup is null) return BadRequest(new { hata = "Geçersiz neden grubu." });

        using var db = _vt.Baglanti();

        var n = db.Execute("UPDATE KRY_CIKIS_MULAKAT SET neden_grubu = @grup WHERE id = @id", new { id, grup });

        return n == 0 ? NotFound(new { hata = "Mülakat bulunamadı." }) : Ok(new { basarili = true, grup });
    }

    /// <summary>Neden grupları (panel seçim listesi).</summary>
    [HttpGet("NedenGruplari")]
    public IActionResult NedenGruplari() =>
        Ok(CikisAnalizi.GRUPLAR.Select(g => new { ad = g.Ad, tanim = g.Tanim })
            .Append(new { ad = CikisAnalizi.BELIRTILMEMIS, tanim = "Ayrılma nedeni anlaşılmıyor" }));

    /// <summary>Alanı hem camelCase hem PascalCase adıyla arar.</summary>
    private static JsonElement Bul(JsonElement kok, string ad)
    {
        if (kok.TryGetProperty(ad, out var d)) return d;

        var buyuk = char.ToUpperInvariant(ad[0]) + ad[1..];

        return kok.TryGetProperty(buyuk, out var b) ? b : default;
    }

    private static string Metin(JsonElement kok, string ad)
    {
        var d = Bul(kok, ad);
        return d.ValueKind == JsonValueKind.String ? d.GetString() : null;
    }

    private static int Sayi(JsonElement kok, string ad)
    {
        var d = Bul(kok, ad);
        return d.ValueKind == JsonValueKind.Number && d.TryGetInt32(out var n) ? n : 0;
    }

    /// <summary>Mülakatı siler (yalnızca yönetici).</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult Sil(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute("DELETE FROM KRY_CIKIS_MULAKAT WHERE id = @id", new { id });

        /* Mülakat anketten geldiyse anket kaydı da iptal edilir. Aksi
           hâlde kayıt "doldurulmuş" işaretli kalıyor ve o kişiye yeniden
           anket gönderilemiyordu; silmenin işe yaramaması buradan
           kaynaklanıyordu. */
        db.Execute(@"
UPDATE KRY_CIKIS_ANKET SET iptal = 1
WHERE mulakat_id = @id", new { id });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Yapay zekâ özeti                                                      */
    /* ==================================================================== */

    /// <summary>
    /// Eski çizelgeden toplu mülakat aktarımı.
    ///
    /// <para>
    /// Çizelgede kimlik ya da sicil numarası yok; eşleştirme ad ve şubeye
    /// göre yapılır. Eşleşme kurulamayan kayıtlar da aktarılır — mülakat
    /// içeriği kişi bağlantısı olmasa da değerli, raporlarda görünür.
    /// </para>
    /// </summary>
    [HttpPost("TopluAktar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult TopluAktar([FromBody] List<MulakatAktarimSatiri> girdiler)
    {
        if (girdiler is null || girdiler.Count == 0)
            return BadRequest(new { hata = "Aktarılacak satır yok." });

        using var db = _vt.Baglanti();

        /* Ad ve şubeye göre eşleştirme için personel listesi */
        var personeller = new List<PersonelKaydi>();

        try
        {
            personeller = _personelKaynak.TumPersonelleriGetir().ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı; eşleştirme yapılmayacak");
        }

        string Sadelestir(string x) =>
            new string((x ?? "")
                .ToUpperInvariant()
                .Where(c => char.IsLetterOrDigit(c) || c == ' ')
                .ToArray())
            .Trim();

        var yazilan = 0;
        var eslesen = 0;
        var atlanan = new List<string>();

        foreach (var g in girdiler)
        {
            var ad = (g.AdSoyad ?? "").Trim();

            if (string.IsNullOrWhiteSpace(ad))
            {
                atlanan.Add("Ad soyad boş");
                continue;
            }

            /* Aynı kişi ve aynı çıkış tarihi varsa tekrar yazılmaz:
               aktarım birden çok kez çalıştırılabilmeli. */
            var varMi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_CIKIS_MULAKAT
WHERE ad_soyad = @ad
  AND (@cikis IS NULL OR cikis_tarihi = @cikis)",
                new { ad, cikis = g.CikisTarihi });

            if (varMi > 0)
            {
                atlanan.Add($"{ad} · zaten kayıtlı");
                continue;
            }

            /* Sicil eşleştirmesi: ad ve şube birlikte tutmalı. Yalnızca
               ada bakmak aynı isimli iki kişide yanlış bağlar. */
            var sadeAd = Sadelestir(ad);
            var sadeSube = Sadelestir(g.SubeAdi);

            var kisi = personeller.FirstOrDefault(x =>
                Sadelestir($"{x.Ad} {x.Soyad}") == sadeAd &&
                (string.IsNullOrWhiteSpace(sadeSube) ||
                 Sadelestir(x.Sube).Contains(sadeSube) ||
                 sadeSube.Contains(Sadelestir(x.Sube))));

            if (kisi is not null) eslesen++;

            /* İK nedeni varsa o kullanılır: çizelgede yönetici ve İK
               ayrı neden yazabiliyor, İK'nınki nihai değerlendirmedir. */
            var neden = !string.IsNullOrWhiteSpace(g.IkCikisNedeni)
                ? g.IkCikisNedeni.Trim()
                : (g.CikisNedeni ?? "").Trim();

            if (neden.Length > 80) neden = neden[..80];

            db.Execute(@"
INSERT INTO KRY_CIKIS_MULAKAT
    (personel_kodu, ad_soyad, sube_adi, gorev,
     giris_tarihi, cikis_tarihi, cikis_nedeni,
     uzman_yorumu, yonetici_yorumu, donem, kaynak,
     uzman_adi, kullanici, olusturma)
VALUES (@personelKodu, @ad, @sube, @gorev,
        @giris, @cikis, @neden,
        @ikYorum, @yoneticiYorumu, @donem, N'Çizelge',
        N'Çizelgeden aktarıldı', @kullanici, @olusturma)",
                new
                {
                    personelKodu = kisi?.PersonelKodu,
                    ad,
                    sube = g.SubeAdi,
                    gorev = g.Gorev,
                    giris = g.GirisTarihi,
                    cikis = g.CikisTarihi,
                    neden,
                    ikYorum = g.IkYorum,
                    yoneticiYorumu = g.YoneticiYorumu,
                    donem = g.Donem,
                    kullanici = User?.Identity?.Name ?? "sistem",

                    /* Oluşturma tarihi çıkış tarihine yazılır: aksi hâlde
                       eski mülakatlar bugün yapılmış gibi görünüyor ve
                       dönem raporları bozuluyor. */
                    olusturma = g.CikisTarihi ?? DateTime.Now
                });

            yazilan++;
        }

        return Ok(new { basarili = true, yazilan, eslesen, atlanan });
    }

    /// <summary>
    /// Bir şubenin dönem içindeki mülakatları ve yapay zekâ özeti.
    ///
    /// <para>
    /// Genel dönem raporu şirket geneline bakıyor; tek bir şubede
    /// yoğunlaşan bir sorun orada kayboluyor. Şube kırılımı, o şubeye
    /// özgü desenleri görmek için.
    /// </para>
    /// </summary>
    [HttpPost("SubeOzeti")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> SubeOzeti([FromBody] SubeOzetiGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.SubeAdi))
            return BadRequest(new { hata = "Şube belirtiniz." });

        using var db = _vt.Baglanti();

        /* tavsiyePuani ve tekrarCalisir ayrı kolonlarda değil, sorular_json
           içinde tutuluyor (bkz. kayıt tarafı). Kolon olarak okumaya
           çalışmak sorguyu tamamen başarısız kılıyordu. */
        var ham = db.Query(@"
SELECT m.id, m.ad_soyad AS adSoyad, m.gorev, m.cikis_tarihi AS cikisTarihi,
       m.giris_tarihi AS girisTarihi, m.cikis_nedeni AS cikisNedeni,
       m.uzman_yorumu AS uzmanYorumu, m.yonetici_yorumu AS yoneticiYorumu,
       m.ozet, m.sorular_json AS sorularJson,
       m.neden_grubu AS nedenGrubu, m.cikis_nedeni_aciklama AS cikisNedeniAciklama,
       m.sube_adi AS subeAdi, m.uzman_adi AS uzmanAdi, m.kullanici, m.kaynak,
       m.olusturma
FROM KRY_CIKIS_MULAKAT m
WHERE m.sube_adi = @sube
  AND m.cikis_tarihi >= @bas AND m.cikis_tarihi <= @bit
ORDER BY m.cikis_tarihi DESC",
            new { sube = girdi.SubeAdi, bas = girdi.Baslangic, bit = girdi.Bitis })
            .ToList();

        var mulakatlar = ham.Select(m =>
        {
            int? tavsiye = null;
            bool? tekrar = null;

            try
            {
                using var kok = JsonDocument.Parse((string)m.sorularJson ?? "{}");

                /* Eski kayıtlar PascalCase yazılmıştı; iki biçim de okunur. */
                static bool Al(JsonElement k, string ad, out JsonElement d) =>
                    k.TryGetProperty(ad, out d) ||
                    k.TryGetProperty(char.ToUpperInvariant(ad[0]) + ad[1..], out d);

                if (Al(kok.RootElement, "tavsiyePuani", out var tp)
                    && tp.ValueKind == JsonValueKind.Number)
                    tavsiye = tp.GetInt32();

                if (Al(kok.RootElement, "tekrarCalisir", out var tc)
                    && tc.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    tekrar = tc.GetBoolean();
            }
            catch
            {
                /* Bozuk JSON tek kaydı etkiler, şube özetini engellemez. */
            }

            return new
            {
                m.id,
                m.adSoyad,
                m.gorev,
                m.cikisTarihi,
                m.girisTarihi,
                m.cikisNedeni,
                m.uzmanYorumu,
                m.yoneticiYorumu,
                m.ozet,
                tavsiyePuani = tavsiye,
                tekrarCalisir = tekrar
            };
        }).ToList();

        if (mulakatlar.Count == 0)
            return Ok(new { mulakatlar, ozet = (string)null });

        /* Nedenlerin dağılımı: özetten bağımsız olarak sayısal resim */
        var nedenler = mulakatlar
            .Where(x => !string.IsNullOrWhiteSpace((string)x.cikisNedeni))
            .GroupBy(x => ((string)x.cikisNedeni).Trim())
            .Select(g => new { neden = g.Key, sayi = g.Count() })
            .OrderByDescending(x => x.sayi)
            .ToList();

        string ozet = null;

        /* Tek mülakattan desen çıkarmak anlamlı değil; iki ve üzerinde
           özet üretilir. */
        if (girdi.OzetIste && mulakatlar.Count >= 2)
        {
            var metin = string.Join("\n\n", mulakatlar.Select(m =>
            {
                var parcalar = new List<string>
                {
                    $"Görev: {m.gorev}",
                    $"Çıkış nedeni: {m.cikisNedeni}",
                };

                if (!string.IsNullOrWhiteSpace((string)m.ozet))
                    parcalar.Add($"Görüşme özeti: {m.ozet}");

                if (!string.IsNullOrWhiteSpace((string)m.uzmanYorumu))
                    parcalar.Add($"İK yorumu: {m.uzmanYorumu}");

                if (!string.IsNullOrWhiteSpace((string)m.yoneticiYorumu))
                    parcalar.Add($"Yönetici yorumu: {m.yoneticiYorumu}");

                if (m.tavsiyePuani is int tp)
                    parcalar.Add($"Tavsiye puanı: {tp}/10");

                if (m.tekrarCalisir is bool tc)
                    parcalar.Add(tc
                        ? "Tekrar çalışmak ister"
                        : "Tekrar çalışmak istemez");

                return string.Join(" · ", parcalar);
            }));

            var yonerge = $@"Aşağıda {girdi.SubeAdi} şubesinden ayrılan {mulakatlar.Count} kişinin çıkış görüşmesi var.

Bu şubeye özgü ortak konuları çıkar. Kişi adı yazma.

Şunlara dikkat et:
- Aynı konu kaç kişide geçiyor, sayısını belirt
- Bu şubede tekrar eden bir sorun var mı
- Yönetim, çalışma koşulları ya da ekip ilişkileriyle ilgili bir desen görünüyor mu
- Tek seferlik durumları desen gibi sunma

Kısa ve doğrudan yaz. Madde madde değil, akıcı paragraflar hâlinde.
Bir şey söylemeye yetecek veri yoksa bunu açıkça belirt.";

            try
            {
                ozet = await _yz.MetinOzetle(metin, yonerge);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Şube özeti üretilemedi: {Sube}", girdi.SubeAdi);
            }
        }

        return Ok(new
        {
            mulakatlar,
            nedenler,
            ozet,
            yetersizVeri = mulakatlar.Count < 2
        });
    }

    /// <summary>
    /// Çizelgeden aktarılan mülakatları sayar.
    ///
    /// Silmeden önce kaç kaydın etkileneceğini göstermek için: kullanıcı
    /// neyi sildiğini bilmeden onaylamamalı.
    /// </summary>
    [HttpGet("AktarimOzeti")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult AktarimOzeti()
    {
        using var db = _vt.Baglanti();

        var ozet = db.QueryFirstOrDefault(@"
SELECT COUNT(*) AS adet,
       MIN(cikis_tarihi) AS enEski,
       MAX(cikis_tarihi) AS enYeni,
       MAX(olusturma) AS sonAktarim
FROM KRY_CIKIS_MULAKAT
WHERE kaynak = N'Çizelge'");

        var donemler = db.Query(@"
SELECT donem, COUNT(*) AS adet
FROM KRY_CIKIS_MULAKAT
WHERE kaynak = N'Çizelge'
GROUP BY donem
ORDER BY COUNT(*) DESC").ToList();

        return Ok(new { ozet, donemler });
    }

    /// <summary>
    /// Çizelgeden aktarılan mülakatları siler.
    ///
    /// <para>
    /// Yalnızca <c>kaynak = 'Çizelge'</c> olan kayıtlar silinir. Elle
    /// girilen ve anketten gelen mülakatlara dokunulmaz — yanlış bir
    /// aktarımı geri almak, gerçek görüşmeleri kaybettirmemeli.
    /// </para>
    ///
    /// <para>
    /// Dönem verilirse yalnızca o dönem silinir; tek bir ayın aktarımı
    /// hatalıysa tamamını silmek gerekmiyor.
    /// </para>
    /// </summary>
    [HttpPost("AktarimGeriAl")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult AktarimGeriAl([FromBody] MetinGirdi girdi)
    {
        using var db = _vt.Baglanti();

        var donem = (girdi?.Deger ?? "").Trim();

        var silinecek = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_CIKIS_MULAKAT
WHERE kaynak = N'Çizelge'
  AND (@donem = '' OR donem = @donem)", new { donem });

        if (silinecek == 0)
            return BadRequest(new
            {
                hata = "Silinecek kayıt bulunamadı.",
                ayrinti = donem.Length > 0
                    ? $"'{donem}' dönemine ait aktarılmış mülakat yok."
                    : "Çizelgeden aktarılmış mülakat yok."
            });

        /* Anket kayıtları bu mülakatlara bağlı olabilir; bağlantı
           koparılır ki anket kaydı yetim kalmasın. */
        db.Execute(@"
UPDATE KRY_CIKIS_ANKET
SET mulakat_id = NULL
WHERE mulakat_id IN (
    SELECT id FROM KRY_CIKIS_MULAKAT
    WHERE kaynak = N'Çizelge' AND (@donem = '' OR donem = @donem));

DELETE FROM KRY_CIKIS_MULAKAT
WHERE kaynak = N'Çizelge' AND (@donem = '' OR donem = @donem);",
            new { donem });

        _gunluk.Yaz(
            "MULAKAT AKTARIMI GERI ALINDI",
            User?.Identity?.Name ?? "-",
            donem.Length > 0
                ? $"{donem} dönemi · {silinecek} kayıt silindi."
                : $"Tüm çizelge aktarımı · {silinecek} kayıt silindi.");

        return Ok(new { basarili = true, silinen = silinecek });
    }

    /// <summary>
    /// Seçilen mülakatları yapay zekâya okutup özet çıkarır: tekrar eden
    /// şikâyetler, ayrılma sebeplerindeki örüntüler, şubelere göre farklar.
    ///
    /// Özet öneri niteliğindedir; karar için ham mülakatlara bakılmalıdır.
    /// </summary>
    [HttpPost("Ozet")]
    public async Task<IActionResult> Ozet([FromBody] MulakatOzetGirdi girdi)
    {
        girdi ??= new MulakatOzetGirdi();

        using var db = _vt.Baglanti();

        var idler = (girdi.Idler ?? new List<int>()).ToArray();

        var kayitlar = idler.Length > 0
            ? db.Query(@"
SELECT ad_soyad AS adSoyad, sube_adi AS subeAdi, gorev AS gorev,
       cikis_nedeni AS cikisNedeni, sorular_json AS sorularJson,
       uzman_yorumu AS uzmanYorumu, olusturma AS olusturma,
       neden_grubu AS nedenGrubu
FROM KRY_CIKIS_MULAKAT WHERE id IN @idler", new { idler }).ToList()
            : db.Query(@"
SELECT ad_soyad AS adSoyad, sube_adi AS subeAdi, gorev AS gorev,
       cikis_nedeni AS cikisNedeni, sorular_json AS sorularJson,
       uzman_yorumu AS uzmanYorumu, olusturma AS olusturma,
       neden_grubu AS nedenGrubu
FROM KRY_CIKIS_MULAKAT
WHERE olusturma BETWEEN @bas AND @bit",
                new
                {
                    bas = girdi.Baslangic?.Date ?? DateTime.Today.AddMonths(-1),
                    bit = (girdi.Bitis?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1)
                }).ToList();

        if (kayitlar.Count == 0)
            return Ok(new { basarili = false, ozet = "Seçilen aralıkta mülakat bulunamadı." });

        /* Metin modele okunabilir biçimde hazırlanır. Kişi adları da
           gönderilir; İK uzmanı özette hangi kişiden söz edildiğini
           görebilmeli. */
        var yazi = new System.Text.StringBuilder();

        /* Neden grupları sayılmış olarak başta veriliyor: yorum kendi
           saydığı değil, rapor tablosundaki gruplarla aynı rakamları
           kullansın. */
        var gruplar = kayitlar
            .GroupBy(k => (string)k.nedenGrubu
                          ?? CikisAnalizi.AnahtarlaSinifla((string)k.cikisNedeni))
            .OrderByDescending(g => g.Count())
            .Select(g => $"{g.Key}: {g.Count()} kişi");

        yazi.AppendLine($"AYRILMA NEDENİ GRUPLARI ({kayitlar.Count} kayıt): {string.Join(" · ", gruplar)}");
        yazi.AppendLine();

        foreach (var k in kayitlar)
        {
            yazi.AppendLine($"--- {(string)k.adSoyad} · {(string)k.subeAdi} · {(string)k.gorev}");
            yazi.AppendLine($"Çıkış nedeni: {(string)k.cikisNedeni}"
                            + (k.nedenGrubu is null ? "" : $" (grup: {(string)k.nedenGrubu})"));

            try
            {
                using var kok = JsonDocument.Parse((string)k.sorularJson ?? "{}");

                /* Eski kayıtlar PascalCase yazılmıştı; iki biçim de okunur. */
                static bool Al(JsonElement k, string ad, out JsonElement d) =>
                    k.TryGetProperty(ad, out d) ||
                    k.TryGetProperty(char.ToUpperInvariant(ad[0]) + ad[1..], out d);

                if (Al(kok.RootElement, "sorular", out var sDizi)
                    && sDizi.ValueKind == JsonValueKind.Array)
                {
                    foreach (var s in sDizi.EnumerateArray())
                    {
                        var cevap = Al(s, "cevap", out var c) ? c.GetString() : null;
                        if (string.IsNullOrWhiteSpace(cevap)) continue;

                        var soru = Al(s, "soru", out var q) ? q.GetString() : "";
                        yazi.AppendLine($"S: {soru}\nC: {cevap}");
                    }
                }

                if (Al(kok.RootElement, "puanlar", out var pDizi)
                    && pDizi.ValueKind == JsonValueKind.Array)
                {
                    foreach (var pu in pDizi.EnumerateArray())
                    {
                        var baslik = Al(pu, "baslik", out var b) ? b.GetString() : "";
                        var puan = Al(pu, "puan", out var v) && v.TryGetInt32(out var n)
                            ? n : 0;

                        if (puan > 0) yazi.AppendLine($"Puan · {baslik}: {puan}/5");
                    }
                }

                if (Al(kok.RootElement, "tavsiyePuani", out var tp)
                    && tp.ValueKind == JsonValueKind.Number)
                    yazi.AppendLine($"Tavsiye puanı: {tp.GetInt32()}/10");
            }
            catch (JsonException) { /* bozuk kayıt atlanır */ }

            if (!string.IsNullOrWhiteSpace((string)k.uzmanYorumu))
                yazi.AppendLine($"İK yorumu: {(string)k.uzmanYorumu}");

            yazi.AppendLine();
        }

        var ozet = await _yz.MetinOzetle(
            yazi.ToString(),
            $"""
             Aşağıda {kayitlar.Count} adet çıkış mülakatı var. Bir İK
             yöneticisine bunları kısaca yorumluyorsun.

             EN ÖNEMLİ KURAL: KİŞİ ADI YAZMA.
             Tek tek kimin ne dediğini anlatma. Bu özet yüzlerce mülakatı
             kapsayabilir; kişi kişi yazıldığında okunamaz hâle gelir.
             Bunun yerine ORTAK KONULARI çıkar ve her birinin kaç kişide
             görüldüğünü belirt.

             Yanlış: Ayşe yöneticisinden memnundu, Mehmet ise mola
             saatlerinden şikâyetçiydi.
             Doğru: Üç kişi mola düzeninden, iki kişi yöneticiyle
             iletişimden şikâyetçi.

             SAYILARI YAZMA. Kaç kişinin hangi nedenle ayrıldığı, puan
             ortalamaları ve şube dağılımı ekranda tablo hâlinde zaten
             gösteriliyor. Senin işin tablodan görünmeyeni söylemek.

             NASIL YAZ
             En fazla iki kısa paragraf, düz metin. Başlık, madde işareti,
             numara, yıldız ya da diyez kullanma.

             NE YAZ
             Tekrar eden şikâyetler ve tekrar eden övgüler; her birinin kaç
             kişide görüldüğü. Belirli bir şubede yoğunlaşan bir durum varsa
             şubenin adıyla. Sonda, veriden çıkan bir ya da iki somut öneri.

             KURALLAR
             - Yalnızca metinde geçenlere dayan, tahmin ekleme.
             - Tek kişide görülen bir şeyi genel eğilim gibi sunma.
             - Az veri varsa bunu açıkça söyle ve genelleme yapma.
             - Sade ve doğrudan yaz, kurumsal dil kullanma.
             """);

        return Ok(new { basarili = true, adet = kayitlar.Count, ozet });
    }
}

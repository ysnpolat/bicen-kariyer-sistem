using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Çıkış anketi: işten ayrılan personele SMS ile gönderilen değerlendirme.
///
/// <para>
/// Her gönderim kişiye özel bir kod üretir. Anket yalnızca o kodla açılır;
/// açıldıktan sonra kimlik numarası doğrulanır. İki katman birlikte
/// çalışır: kod bağlantının doğru kişiye gittiğini, kimlik numarası
/// bağlantıyı kullananın o kişi olduğunu gösterir. Yalnızca kimlik
/// numarası istenseydi, adresi bilen biri geçerli görünen numaralar
/// üretip sahte yanıt gönderebilirdi.
/// </para>
///
/// <para>
/// Sorular ayrı tutulmaz: yüz yüze mülakatla aynı havuzdan gelir
/// (Yönetim → Çıkış Mülakatı). Doldurulan anket, mülakat kaydına dönüşür
/// ve aynı listede raporlanır.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class CikisAnketController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly SmsServisi _sms;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<CikisAnketController> _kayit;
    private readonly YapayZekaServisi _yz;
    private readonly IServiceScopeFactory _kapsamUretici;

    public CikisAnketController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        PersonelKaynagiServisi personelKaynak,
        SmsServisi sms,
        GuvenlikGunlugu gunluk,
        IConfiguration yapilandirma,
        ILogger<CikisAnketController> kayit,
        YapayZekaServisi yz,
        IServiceScopeFactory kapsamUretici)
    {
        _yz = yz;
        _kapsamUretici = kapsamUretici;
        _vt = vt;
        _ayar = ayar;
        _personelKaynak = personelKaynak;
        _sms = sms;
        _gunluk = gunluk;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /* ==================================================================== */
    /* Yönetim tarafı                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Ankete çağrılmayacak çıkış sebepleri.
    ///
    /// Disiplin gerekçesiyle ayrılan kişiye "deneyimini değerlendir" diye
    /// mesaj gitmesi hem uygunsuz hem de gelen yanıt sağlıklı olmaz.
    /// Eşleştirme metin içinde arama ile yapılır: Mikro'daki sebep alanı
    /// serbest yazıldığı için birebir eşleşme beklenemez.
    /// </summary>
    private static readonly string[] AnketeUygunOlmayan =
    {
        "usulsüz", "usulsuz", "hırsız", "hirsiz", "disiplin",
        "haklı fesih", "hakli fesih", "iş akdi fesih", "is akdi fesih",
        "devamsız", "devamsiz", "suistimal", "güven", "guven",
        "kod 25", "25/2", "ahlak", "ihtar", "ihtarname", "ihtarnâme"
    };

    /// <summary>Kişinin çıkış sebebi ankete uygun mu.</summary>
    private static bool AnketeUygun(string sebep)
    {
        if (string.IsNullOrWhiteSpace(sebep)) return true;

        var kucuk = sebep.ToLowerInvariant();

        return !AnketeUygunOlmayan.Any(x => kucuk.Contains(x));
    }

    /// <summary>
    /// Seçilen ayda ayrılan personel ve anket durumları.
    /// </summary>
    [HttpGet("Ayrilanlar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
    public IActionResult Ayrilanlar(
        [FromQuery] int? yil = null,
        [FromQuery] int? ay = null,
        [FromQuery] string sube = null)
    {
        var seciliYil = yil ?? DateTime.Today.Year;
        var seciliAy = ay ?? DateTime.Today.Month;

        List<PersonelKaydi> ayrilanlar;

        try
        {
            ayrilanlar = _personelKaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 0
                         && x.CikisTarihi is not null
                         && x.CikisTarihi.Value.Year == seciliYil
                         && x.CikisTarihi.Value.Month == seciliAy)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ayrılan personel alınamadı");
            return Ok(new { kayitlar = new List<object>() });
        }

        if (!string.IsNullOrWhiteSpace(sube))
            ayrilanlar = ayrilanlar
                .Where(x => string.Equals(x.Sube, sube, StringComparison.OrdinalIgnoreCase))
                .ToList();

        /* Disiplin gerekçesiyle ayrılanlar listeye hiç girmez. Kaç kişinin
           elendiği ekranda belirtilir; sessizce eksik liste göstermek
           kullanıcıyı yanıltır. */
        var elenen = ayrilanlar.Count(x => !AnketeUygun(x.CikisSebebi));

        ayrilanlar = ayrilanlar.Where(x => AnketeUygun(x.CikisSebebi)).ToList();

        using var db = _vt.Baglanti();

        /* Gönderim ve doldurma durumları kimlik numarasına göre eşleşir */
        var anketler = db.Query(@"
SELECT kimlik_no AS kimlik, gonderim, dolduruldu
FROM KRY_CIKIS_ANKET
WHERE iptal = 0 AND kimlik_no IS NOT NULL").ToList();

        /* Yüz yüze mülakatı yapılmış kişiler listede işaretlenir; aynı
           kişiye iki kez sormanın anlamı yok. */
        var mulakatlar = db.Query<string>(@"
SELECT personel_kodu FROM KRY_CIKIS_MULAKAT WHERE personel_kodu IS NOT NULL")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var kayitlar = ayrilanlar.Select(x =>
        {
            var kimlik = (x.KimlikNo ?? "").Trim();

            var anket = anketler.FirstOrDefault(a =>
                string.Equals((string)a.kimlik, kimlik, StringComparison.OrdinalIgnoreCase));

            return new
            {
                personelKodu = x.PersonelKodu,
                adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                kimlikNo = kimlik,
                telefon = x.Telefon,
                gorev = x.Pozisyon,
                subeAdi = x.Sube,
                cikisTarihi = x.CikisTarihi,
                cikisSebebi = x.CikisSebebi,
                mulakatVar = !string.IsNullOrWhiteSpace(x.PersonelKodu)
                             && mulakatlar.Contains(x.PersonelKodu),
                gonderim = anket is null ? null : (DateTime?)anket.gonderim,
                dolduruldu = anket is null ? null : (DateTime?)anket.dolduruldu
            };
        })
        .OrderBy(x => x.subeAdi)
        .ThenBy(x => x.adSoyad)
        .ToList();

        return Ok(new { yil = seciliYil, ay = seciliAy, kayitlar, elenen });
    }

    /// <summary>Ankete davet SMS'i gönderir.</summary>
    /* Gönderim yalnızca yöneticide: her davet bir SMS harcıyor ve
       ayrılmış bir kişiye şirket adına mesaj gidiyor. Listeyi görmek
       İK'ya açık, göndermek değil. */
    [HttpPost("Gonder")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public async Task<IActionResult> Gonder([FromBody] AnketGonderGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.AdSoyad))
            return BadRequest(new { hata = "Ad soyad gereklidir." });

        var telefon = new string((girdi.Telefon ?? "").Where(char.IsDigit).ToArray());

        if (telefon.StartsWith("90") && telefon.Length == 12) telefon = telefon[2..];
        if (telefon.StartsWith("0") && telefon.Length == 11) telefon = telefon[1..];

        if (telefon.Length != 10 || !telefon.StartsWith("5"))
            return BadRequest(new { hata = "Geçerli bir cep telefonu giriniz." });

        if (!_sms.Etkin)
            return StatusCode(503, new
            {
                hata = "SMS servisi kapalı.",
                ayrinti = "appsettings.json → Sms bölümünü kontrol ediniz."
            });

        using var db = _vt.Baglanti();

        /* Zaten doldurulmuşsa tekrar göndermenin anlamı yok.

           Mülakat kaydının hâlâ durduğu kontrol edilir: kayıt silinmişse
           anket öksüz kalmış demektir ve engellememelidir. Aksi hâlde
           mülakatı silen kullanıcı, o kişiye bir daha anket gönderemiyor. */
        var dolduruldu = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_CIKIS_ANKET a
WHERE a.telefon = @telefon AND a.iptal = 0 AND a.dolduruldu IS NOT NULL
  AND EXISTS (SELECT 1 FROM KRY_CIKIS_MULAKAT m WHERE m.id = a.mulakat_id)",
            new { telefon });

        if (dolduruldu > 0)
            return BadRequest(new
            {
                hata = "Bu kişi anketi zaten doldurmuş.",
                ayrinti = "Yanıtlar Mülakatlar sekmesinde görülebilir."
            });

        /* Günlük sınır rahatsız etmeyi önlemek için var, tekrar göndermeyi
           engellemek için değil. Bağlantı ulaşmamış ya da kaybolmuş
           olabilir; kullanıcı yeniden gönderebilmeli. Üç gönderimden
           sonrası ısrar sayılır ve durdurulur. */
        var bugunku = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_CIKIS_ANKET
WHERE telefon = @telefon
  AND CAST(gonderim AS DATE) = CAST(SYSDATETIME() AS DATE)",
            new { telefon });

        /* Sınır, deneme sürecinde kapatılabilsin: kendi numarasına art
           arda gönderim yapmak gerekiyor. appsettings.json →
           CikisAnketi:GunlukSinir değeri 0 yazılırsa sınır uygulanmaz. */
        var sinir = Parametre.Sayi("cikis.gunlukSinir");

        if (sinir > 0 && bugunku >= sinir)
            return BadRequest(new
            {
                hata = $"Bu numaraya bugün {sinir} kez anket gönderildi.",
                ayrinti = "Yarın tekrar deneyebilirsiniz."
            });

        /* Doldurulmamış eski davetler iptal edilir: aynı kişide birden
           çok açık kod kalırsa hangisinin kullanıldığı belirsizleşir. */
        db.Execute(@"
UPDATE KRY_CIKIS_ANKET SET iptal = 1
WHERE telefon = @telefon AND iptal = 0 AND dolduruldu IS NULL",
            new { telefon });

        /* Kısa, karışmayan kod. Benzersiz olana kadar denenir. */
        string kod = null;

        for (var deneme = 0; deneme < 6; deneme++)
        {
            kod = KodUret();

            if (db.ExecuteScalar<int>(
                    "SELECT COUNT(*) FROM KRY_CIKIS_ANKET WHERE kod = @kod",
                    new { kod }) == 0)
                break;
        }

        var kimlik = new string((girdi.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CIKIS_ANKET
    (kod, personel_kodu, kimlik_no, ad_soyad, telefon, gorev, sube_adi,
     cikis_tarihi, gonderen)
OUTPUT INSERTED.id
VALUES (@kod, @personelKodu, @kimlik, @adSoyad, @telefon, @gorev, @subeAdi,
        @cikisTarihi, @gonderen)",
            new
            {
                kod,
                personelKodu = girdi.PersonelKodu,
                kimlik = kimlik.Length == 11 ? kimlik : null,
                adSoyad = girdi.AdSoyad.Trim(),
                telefon,
                gorev = girdi.Gorev,
                subeAdi = girdi.SubeAdi,
                cikisTarihi = girdi.CikisTarihi,
                gonderen = Kullanici
            });

        /* Aday formu hash yönlendirme kullanıyor: adres '/#/anket/KOD'
           biçiminde olmalı. Sunucuda "/anket/" diye gerçek bir yol yok,
           o yüzden diyezsiz adres 404 veriyordu. */
        var adres = (_ayar.FormOku().AnketAdresi ?? "").Trim().TrimEnd('/');

        if (string.IsNullOrWhiteSpace(adres))
            adres = "kariyer.bicen.com.tr";

        /* Ayarda yol verilmemişse eklenir; verilmişse olduğu gibi kullanılır */
        if (!adres.Contains("#"))
            adres = $"{adres}/#/anket";

        var ilkAd = girdi.AdSoyad.Trim().Split(' ')[0];

        /* Metin Yönetim ekranından düzenlenebilir. {ad} ve {link}
           yer tutucuları doldurulur. */
        var kalip = _ayar.CikisMulakatOku().AnketMesaji;

        if (string.IsNullOrWhiteSpace(kalip))
            kalip = "Merhaba {ad}, Biçen'deki deneyiminizi değerlendirmeniz "
                  + "bizim için değerli. 2 dakikanızı ayırır mısınız? {link} "
                  + "Yanıtlarınız gizli tutulur, üçüncü kişilerle paylaşılmaz.";

        var mesaj = kalip
            .Replace("{ad}", ilkAd)
            .Replace("{link}", $"{adres}/{kod}");

        var sonuc = await _sms.Gonder(telefon, mesaj);

        if (!sonuc.Basarili)
        {
            /* Gönderilemeyen davet iptal edilir: listede 'gönderildi'
               görünüp aslında ulaşmamış olması yanıltıcı olur. */
            db.Execute("UPDATE KRY_CIKIS_ANKET SET iptal = 1 WHERE id = @id", new { id });

            return StatusCode(502, new
            {
                hata = "SMS gönderilemedi.",
                ayrinti = sonuc.Mesaj
            });
        }

        _gunluk.Yaz("ÇIKIŞ ANKETİ GÖNDERİLDİ", IstemciAdresi.Bul(HttpContext),
            $"{girdi.AdSoyad} · {telefon} · {Kullanici}");

        return Ok(new { basarili = true, kod });
    }

    /* ==================================================================== */
    /* Aday tarafı — kimlik doğrulaması gerektirmez                          */
    /* ==================================================================== */

    /// <summary>
    /// Anketi açar. Kod geçerliyse kişinin adı ve sorular döner; kimlik
    /// numarası bu aşamada sorulmaz, yanıt gönderilirken doğrulanır.
    /// </summary>
    [HttpGet("Ac/{kod}")]
    [AllowAnonymous]
    public IActionResult Ac(string kod)
    {
        using var db = _vt.Baglanti();

        var anket = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, ad_soyad AS adSoyad, dolduruldu, kimlik_no AS kimlikNo,
       personel_kodu AS personelKodu, sube_adi AS subeAdi
FROM KRY_CIKIS_ANKET
WHERE kod = @kod AND iptal = 0", new { kod = (kod ?? "").Trim().ToUpperInvariant() });

        if (anket is null)
            return Ok(new { gecerli = false, sebep = "Bağlantı geçersiz." });

        if (anket.dolduruldu is not null)
            return Ok(new { gecerli = false, sebep = "Bu anket zaten doldurulmuş." });

        db.Execute(@"
UPDATE KRY_CIKIS_ANKET SET acilma = ISNULL(acilma, SYSDATETIME())
WHERE id = @id", new { id = (int)anket.id });

        var ayar = _ayar.CikisMulakatOku();

        return Ok(new
        {
            gecerli = true,
            adSoyad = (string)anket.adSoyad,

            /* Kimlik doğrulaması yalnızca kayıtta kimlik varsa istenir;
               elle gönderilen anketlerde kimlik girilmemiş olabilir.
               O durumda kimliği yine sorarız ama eşleştirme için, doğrulama
               için değil. */
            sorular = ayar.Sorular,
            puanlamalar = ayar.Puanlamalar,
            nedenler = ayar.Nedenler
        });
    }

    /// <summary>Anketi kaydeder ve çıkış mülakatı kaydına dönüştürür.</summary>
    [HttpPost("Gonderi/{kod}")]
    [AllowAnonymous]
    public IActionResult Gonderi(string kod, [FromBody] AnketYanitGirdi girdi)
    {
        if (girdi is null)
            return BadRequest(new { hata = "Yanıt okunamadı." });

        using var db = _vt.Baglanti();

        var anket = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, ad_soyad AS adSoyad, kimlik_no AS kimlikNo,
       personel_kodu AS personelKodu, gorev, sube_adi AS subeAdi,
       cikis_tarihi AS cikisTarihi, dolduruldu
FROM KRY_CIKIS_ANKET
WHERE kod = @kod AND iptal = 0", new { kod = (kod ?? "").Trim().ToUpperInvariant() });

        if (anket is null)
            return BadRequest(new { hata = "Bağlantı geçersiz." });

        if (anket.dolduruldu is not null)
            return BadRequest(new { hata = "Bu anket zaten doldurulmuş." });

        /* Kimlik doğrulaması istenmez: bağlantıdaki kod zaten kişiye
           özeldir, bir kez kullanılır ve yalnızca o kişinin telefonuna
           gitmiştir. Ayrıca kimlik sormak, ankete başlamayı zorlaştırıp
           tamamlanma oranını düşürüyordu. */

        var dolu = (girdi.Sorular ?? new List<MulakatSorusu>())
            .Count(x => !string.IsNullOrWhiteSpace(x.Cevap));

        var puanli = (girdi.Puanlar ?? new List<MulakatPuani>()).Count(x => x.Puan > 0);

        if (dolu == 0 && puanli == 0)
            return BadRequest(new { hata = "En az bir soruyu cevaplayınız." });

        /* Çıkış sebebi zorunlu. Denetim burada da yapılır: panel
           doğrulaması atlanabilir, sunucu son sözü söylemeli. */
        if (string.IsNullOrWhiteSpace(girdi.CikisNedeni)
            || girdi.CikisNedeni.Trim().Length < 3)
            return BadRequest(new
            {
                hata = "Ayrılma sebebi gereklidir.",
                ayrinti = "Lütfen ayrılmanızın sebebini yazınız."
            });

        var jsonSecenek = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        var json = JsonSerializer.Serialize(new
        {
            sorular = girdi.Sorular ?? new List<MulakatSorusu>(),
            puanlar = girdi.Puanlar ?? new List<MulakatPuani>(),
            tekrarCalisir = girdi.TekrarCalisir,
            tavsiyePuani = girdi.TavsiyePuani
        }, jsonSecenek);

        /* Anket, yüz yüze mülakatla aynı tabloya yazılır: raporlama ikisini
           birlikte değerlendirir. Kaydın anketten geldiği "uzman_adi"
           alanından anlaşılır. */
        /* Anket sırasında girilen birim, kayıtta yoksa kullanılır: elle
           gönderimlerde şube bilgisi baştan bilinmiyor. */
        var subeAdi = string.IsNullOrWhiteSpace((string)anket.subeAdi)
            ? girdi.SubeAdi
            : (string)anket.subeAdi;

        var mulakatId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CIKIS_MULAKAT
    (personel_kodu, ad_soyad, sube_adi, gorev, cikis_tarihi,
     cikis_nedeni, sorular_json, kullanici, uzman_adi)
OUTPUT INSERTED.id
VALUES (@personelKodu, @adSoyad, @subeAdi, @gorev, @cikisTarihi,
        @cikisNedeni, @json, N'anket', N'Çıkış anketi')",
            new
            {
                personelKodu = (string)anket.personelKodu,
                adSoyad = (string)anket.adSoyad,
                subeAdi,
                gorev = (string)anket.gorev,
                cikisTarihi = (DateTime?)anket.cikisTarihi,
                cikisNedeni = girdi.CikisNedeni,
                json
            });

        db.Execute(@"
UPDATE KRY_CIKIS_ANKET
SET dolduruldu = SYSDATETIME(), mulakat_id = @mulakatId
WHERE id = @id", new { id = (int)anket.id, mulakatId });

        /* Özet ve neden grubu arka planda: anketi dolduran personel yapay
           zekânın cevabını beklemesin. Önceden anket kayıtlarının özeti hiç
           üretilmiyordu; panelde "eksik özet" olarak kalıyorlardı. */
        var metin = CikisAnalizi.Metin(json, girdi.CikisNedeni, null, null);
        var neden = girdi.CikisNedeni;

        _ = Task.Run(async () =>
        {
            try
            {
                var a = await CikisAnalizi.Analiz(_yz, metin, neden);

                using var kapsam = _kapsamUretici.CreateScope();
                var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
                using var yaz = vt.Baglanti();

                yaz.Execute(@"
UPDATE KRY_CIKIS_MULAKAT
SET ozet = COALESCE(@ozet, ozet), neden_grubu = @grup
WHERE id = @mulakatId", new { mulakatId, ozet = a.Ozet, grup = a.Grup });
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Çıkış anketi özeti üretilemedi: {Id}", mulakatId);
            }
        });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Anket kodu: karışabilecek karakterler kullanılmaz (0/O, 1/I).
    /// Telefonda okunup elle yazılabilecek kadar kısa tutulur.
    /// </summary>
    private static string KodUret()
    {
        const string karakterler = "23456789ACDEFGHKLMNPRSTUVYZ";

        var uret = new char[6];

        for (var i = 0; i < uret.Length; i++)
            uret[i] = karakterler[
                System.Security.Cryptography.RandomNumberGenerator
                    .GetInt32(karakterler.Length)];

        return new string(uret);
    }
}

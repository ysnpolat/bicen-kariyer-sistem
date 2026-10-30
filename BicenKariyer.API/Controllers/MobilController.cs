using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Mobil uygulamanın uçları.
///
/// <para>
/// Panelin uçlarından ayrıdır ve olması gerekir: kimlik doğrulama SMS
/// tabanlı, yetki modeli farklı ve personel <b>yalnızca kendi verisini</b>
/// görür. Panel uçlarını paylaşmak, bir personelin başkasının maaşını
/// görmesine açık kapı bırakırdı.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
/* 30.10.2026: partial — icra uçları MobilIcra.cs dosyasında */
public partial class MobilController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly GiftKartServisi _giftKart;
    private readonly SmsServisi _sms;
    private readonly JwtServisi _jwt;
    private readonly AyarServisi _ayar;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly BildirimServisi _bildirim;
    private readonly MailServisi _mail;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<MobilController> _kayit;

    /* Mobil modül yetkileri Biçen360 yetki ekranında; Kariyer servisi de
       aynı tabloyu okuyor. */
    private readonly PortalYetkiServisi _portalYetki;
    private readonly OrgOnayServisi _orgOnay;
    private readonly EkipServisi _ekip;

    /* Merkezi oturum denetimi (26.10.2026): çıkış ve yeniden girişte
       saklanan sonuç düşürülür */
    private readonly MobilOturumDenetimi _oturumDenetimi;

    public MobilController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        GiftKartServisi giftKart,
        SmsServisi sms,
        JwtServisi jwt,
        AyarServisi ayar,
        GuvenlikGunlugu gunluk,
        BildirimServisi bildirim,
        MailServisi mail,
        PortalYetkiServisi portalYetki,
        OrgOnayServisi orgOnay,
        EkipServisi ekip,
        MobilOturumDenetimi oturumDenetimi,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<MobilController> kayit)
    {
        _oturumDenetimi = oturumDenetimi;
        _portalYetki = portalYetki;
        _orgOnay = orgOnay;
        _ekip = ekip;
        _vt = vt;
        _personelKaynak = personelKaynak;
        _giftKart = giftKart;
        _sms = sms;
        _jwt = jwt;
        _ayar = ayar;
        _gunluk = gunluk;
        _bildirim = bildirim;
        _mail = mail;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /// <summary>Oturumdaki personelin sicil numarası.</summary>
    /// <summary>
    /// Oturumdaki personelin sicil numarası.
    ///
    /// Jetonda "personel:14721" biçiminde tutulur; ek talep alanı
    /// eklemek yerine mevcut yapıyı kullanmak, jeton üretimini
    /// değiştirmeden çalışmayı sağlıyor.
    /// </summary>
    private string PersonelKodu => JetonCoz().kod;

    /// <summary>Jetondaki cihaz kimliği.</summary>
    private string CihazId => JetonCoz().cihaz;

    /// <summary>
    /// Jetondan sicil ve cihaz kimliğini ayırır.
    /// Biçim: "personel:14721|cihaz-abc"
    /// </summary>
    private (string kod, string cihaz) JetonCoz()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return ("", "");

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? (govde, "") : (govde[..i], govde[(i + 1)..]);
    }

    /// <summary>
    /// Oturumun hâlâ geçerli olup olmadığı.
    ///
    /// Jetondaki cihaz kayıtlı cihazdan farklıysa başka bir telefondan
    /// giriş yapılmış demektir; bu oturum kapanmalıdır. Çıkış yapıldığında
    /// da oturum_acik sıfırlanır.
    /// </summary>
    private bool OturumGecerli(System.Data.IDbConnection db)
    {
        var (kod, cihaz) = JetonCoz();

        if (string.IsNullOrWhiteSpace(kod)) return false;

        /* Eski jetonlarda cihaz yok; geriye dönük kabul edilir */
        if (string.IsNullOrWhiteSpace(cihaz)) return true;

        var kayit = db.QueryFirstOrDefault(@"
SELECT cihaz_id AS cihazId, oturum_acik AS oturumAcik
FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod", new { kod });

        if (kayit is null) return true;

        /* Kalıcı kimliğe taşınan kayıtta eski jeton kısa süre kabul edilir (26.10.2026) */
        return (bool)kayit.oturumAcik &&
               CihazKimligi.Uyusuyor(db, kod, (string)kayit.cihazId, cihaz);
    }

    /// <summary>Kod geçerlilik süresi.</summary>
    private const int KodDakika = 2;

    /// <summary>Aynı numaraya arka arkaya gönderim sınırı.</summary>
    private const int BeklemeSaniye = 60;

    /* ==================================================================== */
    /* Giriş                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Kimlik ve telefonu doğrular, SMS ile kod gönderir.
    ///
    /// Telefon personel kaydındakiyle eşleşmiyorsa kod gönderilmez. Bu,
    /// başkasının kimlik numarasıyla giriş denenmesini engelliyor.
    /// </summary>
    [HttpPost("KodIste")]
    [AllowAnonymous]
    public IActionResult KodIste([FromBody] MobilGirisGirdi girdi)
    {
        var kimlik = new string((girdi?.KimlikNo ?? "").Where(char.IsDigit).ToArray());
        var telefon = new string((girdi?.Telefon ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11)
            return BadRequest(new { hata = "Kimlik numarasını kontrol ediniz." });

        /* Telefon denetimi inceleme hesabından sonraya bırakıldı: mağaza
           inceleyicisine telefon numarası verilmiyor ve zorunlu alan
           yüzünden giriş denemesi başarısız oluyordu. Normal personelde
           denetim aşağıda, aynı sıkılıkta uygulanıyor. */

        /* ---------------------------------------------- inceleme hesabı

           Apple ve Google, uygulamayı incelerken içeri girebilmek zorunda.
           Giriş SMS ile olduğu için inceleyicinin Türkiye'deki bir hatta
           gelen kodu alması mümkün değil; hesap verilmediğinde uygulama
           doğrudan reddediliyor.

           Ayarda tanımlı kimlik numarasıyla giriş denendiğinde SMS
           gönderilmiyor, sabit kod veritabanına yazılıyor ve doğrulama
           her zamanki yoldan işliyor — KodDogrula tarafında hiçbir
           istisna yok, dolayısıyla atlatılabilecek ikinci bir kapı da yok.

           Kimlik numarası gerçek bir personelin değil: Apple'a çalışanın
           TC kimlik numarasını vermek gerekmesin diye uydurma bir numara
           veriliyor ve oturum, ayarda belirtilen personel koduna
           bağlanıyor.

           Ayar boşsa özellik tamamen kapalı. Yayın onaylandıktan sonra
           boşaltmanızı öneririm. */
        var incelemeKimlik = new string(
            (_yapilandirma["Mobil:IncelemeKimlik"] ?? "").Where(char.IsDigit).ToArray());

        var incelemeKodu = (_yapilandirma["Mobil:IncelemeKodu"] ?? "").Trim();
        var incelemePersonel = (_yapilandirma["Mobil:IncelemePersonelKodu"] ?? "").Trim();

        if (incelemeKimlik.Length == 11 && incelemeKodu.Length == 6 &&
            !string.IsNullOrWhiteSpace(incelemePersonel) && kimlik == incelemeKimlik)
        {
            _gunluk.Yaz(
                "MOBIL INCELEME GIRISI",
                telefon,
                $"Mağaza inceleme hesabıyla kod istendi; oturum {incelemePersonel} "
                + "personel koduna bağlanacak.");

            using var incelemeDb = _vt.Baglanti();

            /* Önceki kod kapatılıyor: inceleyici arka arkaya deneyince
               birikip "çok fazla hatalı deneme" sayacına takılıyordu. */
            incelemeDb.Execute(@"
UPDATE KRY_MOBIL_KOD SET kullanildi = 1
WHERE kimlik_no = @kimlik AND kullanildi = 0", new { kimlik });

            incelemeDb.Execute(@"
INSERT INTO KRY_MOBIL_KOD (kimlik_no, telefon, kod, personel_kodu, gecerlilik)
VALUES (@kimlik, @telefon, @kod, @personelKodu, DATEADD(minute, @dk, SYSDATETIME()))",
                new
                {
                    kimlik,
                    telefon,
                    kod = incelemeKodu,
                    personelKodu = incelemePersonel,
                    dk = KodDakika
                });

            /* Kod yanıtta dönüyor ve uygulama kutuyu kendiliğinden
               dolduruyor.

               Mağaza incelemesi bize kullanıcı adı ve şifre veriyor;
               uygulamada ise kimlik, telefon ve SMS kodu diye üç adım
               var. İnceleyici kod ekranında ne yazacağını bilemeyip
               girişi tamamlayamıyordu. Bu yalnızca yapılandırmada
               tanımlı sahte kimlik için geçerli; gerçek personelde kod
               hiçbir zaman yanıtta dönmüyor. */
            return Ok(new
            {
                basarili = true,
                sure = KodDakika * 60,
                inceleme = true,
                kod = incelemeKodu
            });
        }

        /* Normal giriş: telefon zorunlu */
        if (telefon.Length != 10)
            return BadRequest(new { hata = "Telefon numarasını kontrol ediniz." });

        /* Dış hukuk danışmanı (24.10.2026): personel değil; panelde Yönetim >
           Hukuk yetkileri'nden kimlik ve telefonu tanımlanır. Kimlik yalnız
           özetle karşılaştırılır. Eşleşirse aynı ekrandan kod gider. */
        try
        {
            using var hdb = _vt.Baglanti();
            var hd = HukukGiris.Bul(hdb, _yapilandirma, kimlik);
            if (hd is not null && HukukGiris.TelefonEsit(hd, telefon))
            {
                var (hh, _) = HukukGiris.KodGonder(hdb, _sms, (object)hd).GetAwaiter().GetResult();
                if (hh is not null) return BadRequest(new { hata = (string)hh });
                return Ok(new { basarili = true, sure = HukukGiris.KodDakika * 60, hukuk = true });
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Hukuk danışmanı kod isteği");
        }

        PersonelKaydi personel;

        try
        {
            personel = _personelKaynak.TumPersonelleriGetir()
                .FirstOrDefault(x =>
                    x.Durum == 1 &&
                    new string((x.KimlikNo ?? "").Where(char.IsDigit).ToArray()) == kimlik);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Personel listesi alınamadı");
            return StatusCode(503, new { hata = "Sistem şu anda yanıt vermiyor. Sonra deneyiniz." });
        }

        if (personel is null)
            return BadRequest(new
            {
                hata = "Kayıt bulunamadı.",
                ayrinti = "Kimlik numaranız sistemde aktif personel olarak kayıtlı değil."
            });

        var kayitliTelefon = new string(
            (personel.Telefon ?? "").Where(char.IsDigit).ToArray());

        /* Son on hane karşılaştırılır: kayıtta 0 ya da +90 ile başlayan
           numaralar bulunabiliyor. */
        /* ------------------------------------------------- test numarası

           Test sürecinde tek bir numaradan her personelin kimliğiyle
           giriş yapılabilmesi için. Ayardan verilir, koda gömülmez;
           `Mobil:TestTelefon` boş bırakıldığında özellik tamamen kapanır.

           Her kullanım güvenlik günlüğüne yazılır — kimin hangi personel
           adına giriş yaptığı sonradan görülebilmeli. */
        var testTelefon = new string(
            (_ayar.FormOku().MobilTestTelefon ?? "")
                .Where(char.IsDigit).ToArray());

        var testGirisi = testTelefon.Length == 10 && telefon == testTelefon;

        if (testGirisi)
        {
            _gunluk.Yaz(
                "MOBIL TEST GIRISI",
                telefon,
                $"{personel.Ad} {personel.Soyad} ({personel.PersonelKodu}) "
                + "adına test numarasıyla kod istendi.");
        }
        else if (kayitliTelefon.Length < 10 ||
                 !kayitliTelefon.EndsWith(telefon, StringComparison.Ordinal))
        {
            return BadRequest(new
            {
                hata = "Telefon numarası eşleşmedi.",
                ayrinti = "Personel kaydınızdaki numarayı giriniz. Farklıysa İnsan Kaynakları ile görüşünüz."
            });
        }

        using var db = _vt.Baglanti();

        /* Arka arkaya gönderim engellenir: SMS maliyeti var ve numaraya
           art arda mesaj gitmesi rahatsız edici. */
        var sonGonderim = db.ExecuteScalar<DateTime?>(@"
SELECT MAX(olusturma) FROM KRY_MOBIL_KOD
WHERE kimlik_no = @kimlik AND kullanildi = 0", new { kimlik });

        if (sonGonderim is not null &&
            (DateTime.Now - sonGonderim.Value).TotalSeconds < BeklemeSaniye)
        {
            var kalan = BeklemeSaniye - (int)(DateTime.Now - sonGonderim.Value).TotalSeconds;

            return BadRequest(new
            {
                hata = $"Yeni kod için {kalan} saniye bekleyiniz."
            });
        }

        var kod = Random.Shared.Next(100000, 999999).ToString();

        db.Execute(@"
INSERT INTO KRY_MOBIL_KOD (kimlik_no, telefon, kod, personel_kodu, gecerlilik)
VALUES (@kimlik, @telefon, @kod, @personelKodu, DATEADD(minute, @dk, SYSDATETIME()))",
            new
            {
                kimlik,
                telefon,
                kod,
                personelKodu = personel.PersonelKodu,
                dk = KodDakika
            });

        var mesaj = $"Bicen360 giris kodunuz: {kod}. "
                    + $"Kod {KodDakika} dakika gecerlidir.";

        try
        {
            var sonuc = _sms.Gonder(telefon, mesaj).GetAwaiter().GetResult();

            if (!sonuc.Basarili)
                return StatusCode(502, new
                {
                    hata = "Kod gönderilemedi.",
                    ayrinti = sonuc.Mesaj
                });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "SMS gönderilemedi: {Telefon}", telefon);
            return StatusCode(502, new { hata = "Kod gönderilemedi. Sonra deneyiniz." });
        }

        return Ok(new { basarili = true, sure = KodDakika * 60 });
    }

    /// <summary>Kodu doğrular ve oturum jetonu döner.</summary>
    [HttpPost("KodDogrula")]
    [AllowAnonymous]
    public IActionResult KodDogrula([FromBody] MobilGirisGirdi girdi)
    {
        var kimlik = new string((girdi?.KimlikNo ?? "").Where(char.IsDigit).ToArray());
        var kod = (girdi?.Kod ?? "").Trim();

        if (kimlik.Length != 11 || kod.Length != 6)
            return BadRequest(new { hata = "Kodu eksiksiz giriniz." });

        using var db = _vt.Baglanti();

        /* Dış hukuk danışmanı: bekleyen hukuk kodu varsa onunla doğrulanır */
        var hd = HukukGiris.Bul(db, _yapilandirma, kimlik);
        if (hd is not null && db.ExecuteScalar<int>(@"SELECT COUNT(*) FROM KRY_HUK_DANISMAN_KOD
WHERE danisman_id = @id AND kullanildi = 0 AND gecerlilik > SYSDATETIME()", new { id = (int)hd.id }) > 0)
        {
            var (dd, hh) = HukukGiris.KodDogrula(db, (int)hd.id, kod);
            if (hh is not null) return BadRequest(new { hata = (string)hh });
            var (hj, hb) = ((string, DateTime))HukukGiris.Belirtec(_jwt, dd, true);
            db.Execute("UPDATE KRY_HUK_DANISMAN SET son_giris = SYSDATETIME() WHERE id = @id", new { id = (int)dd.id });
            db.Execute(@"INSERT INTO KRY_HUK_LOG (anahtar, ad, islem, dosya_id, hedef, ip) VALUES (@a, @ad, N'giris', NULL, N'mobil', @ip)",
                new { a = "hd:" + (string)dd.kullanici_adi, ad = (string)HukukGiris.TamAd(dd), ip = IstemciAdresi.Bul(HttpContext) });
            return Ok(new { jeton = hj, bitis = hb, personelKodu = "hd:" + (string)dd.kullanici_adi, hukuk = true, adSoyad = (string)HukukGiris.TamAd(dd) });
        }

        var kayit = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, personel_kodu AS personelKodu, deneme
FROM KRY_MOBIL_KOD
WHERE kimlik_no = @kimlik AND kod = @kod
  AND kullanildi = 0 AND gecerlilik > SYSDATETIME()
ORDER BY olusturma DESC", new { kimlik, kod });

        if (kayit is null)
        {
            /* Yanlış deneme sayılır: sınırsız deneme altı haneli kodu
               kırmayı mümkün kılar. */
            db.Execute(@"
UPDATE KRY_MOBIL_KOD SET deneme = deneme + 1
WHERE kimlik_no = @kimlik AND kullanildi = 0 AND gecerlilik > SYSDATETIME()",
                new { kimlik });

            var fazlaDeneme = db.ExecuteScalar<int>(@"
SELECT ISNULL(MAX(deneme), 0) FROM KRY_MOBIL_KOD
WHERE kimlik_no = @kimlik AND kullanildi = 0 AND gecerlilik > SYSDATETIME()",
                new { kimlik });

            if (fazlaDeneme >= 5)
            {
                db.Execute(@"
UPDATE KRY_MOBIL_KOD SET kullanildi = 1
WHERE kimlik_no = @kimlik AND kullanildi = 0", new { kimlik });

                return BadRequest(new
                {
                    hata = "Çok fazla hatalı deneme. Yeni kod isteyiniz."
                });
            }

            return BadRequest(new { hata = "Kod hatalı ya da süresi dolmuş." });
        }

        var personelKodu = (string)kayit.personelKodu;

        /* Ayrılmış personel giriş yapamaz (26.10.2026). KodIste zaten aktif
           personel arıyor; kod iki dakika geçerli olsa da çıkış tarihi tam o
           aralıkta gelebilir ve mağaza inceleme hesabı KodIste'deki aramadan
           geçmiyor. Liste okunamazsa giriş engellenmez. */
        try
        {
            if (MobilOturumDenetimi.Aktif(_personelKaynak.TumPersonelleriGetir(), personelKodu) == false)
            {
                db.Execute("UPDATE KRY_MOBIL_KOD SET kullanildi = 1 WHERE id = @id", new { id = (int)kayit.id });

                return BadRequest(new
                {
                    hata = "Kayıt bulunamadı.",
                    ayrinti = "Kimlik numaranız sistemde aktif personel olarak kayıtlı değil.",
                    kod = MobilOturumDenetimi.AyrildiKodu
                });
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Girişte personel aktiflik denetimi yapılamadı");
        }

        /* ---------------------------------------------- cihaz eşleştirme */
        var cihazId = (girdi.CihazId ?? "").Trim();

        if (string.IsNullOrWhiteSpace(cihazId))
            return BadRequest(new { hata = "Cihaz tanımlanamadı." });

        var mevcut = db.QueryFirstOrDefault(@"
SELECT cihaz_id AS cihazId, cihaz_adi AS cihazAdi, isletim, son_degisim AS sonDegisim
FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod", new { kod = personelKodu });

        /* Test numarasıyla girilen oturumlarda cihaz kilidi uygulanmaz:
           aynı telefondan farklı personellerle denenmesi gerekiyor. */
        var testCihazi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_KOD
WHERE kimlik_no = @kimlik AND telefon = @test AND kullanildi = 1
  AND olusturma > DATEADD(minute, -10, SYSDATETIME())",
            new
            {
                kimlik,
                test = new string((_ayar.FormOku().MobilTestTelefon ?? "")
                    .Where(char.IsDigit).ToArray())
            }) > 0;

        /* Mağaza inceleme hesabı cihaza bağlanmıyor.

           Google ve Apple incelemeleri farklı cihazlardan yapılıyor:
           biri girdikten sonra diğeri "bu hesap başka bir cihaza tanımlı"
           hatası alıyor ve uygulamayı hiç açamıyordu. Aylık değişim hakkı
           da işe yaramıyor, iki inceleme aynı hafta oluyor.

           Gerçek personelde eşleştirme aynen sürüyor; bu muafiyet
           yalnızca yapılandırmada tanımlı sahte kimlik için. */
        var incelemeHesabi = kimlik == new string(
            (_yapilandirma["Mobil:IncelemeKimlik"] ?? "").Where(char.IsDigit).ToArray());

        /* ---------------------------------------- kalıcı kimliğe geçiş (26.10.2026)

           1.9 ve öncesi cihaz kimliğini rastgele üretip telefonda
           saklıyordu; Android'de uygulama silinip yeniden kurulunca kimlik
           değişiyor, personel aynı telefondayken "başka cihaza tanımlı"
           hatası alıyordu. 1.10 kimliği kalıcı kaynaktan alıyor (Android
           kimliği; iOS'ta Keychain). Eski kayıtlar iki yoldan yeni kimliğe
           taşınır, ikisi de yeniden onay istemez ve aylık hakkı harcamaz:

           1) Güncellenen uygulama eski rastgele kimliği hâlâ saklıyorsa
              eskiCihazId olarak gönderir; kayıtlı cihazla aynıysa taşınır.
           2) Uygulama silinip kurulduysa eski kimlik de silinmiş olur.
              Kayıtlı kimlik eski rastgele biçimdeyse, gelen kimlik kalıcı
              Android biçimindeyse ve işletim ile cihaz modeli kayıtla
              aynıysa yeniden kurulum sayılır. Model adı sahtelenebilir;
              bu yüzden bu yol aylık değişim hakkını harcar (son_degisim
              ilerler) ve kayıt bir kez kalıcı biçime geçince bir daha
              kullanılamaz. Böylece hesap paylaşımı için eskisinden fazla
              bir kapı açılmış olmuyor. */
        var eskiCihazId = (girdi.EskiCihazId ?? "").Trim();
        var farkli = mevcut is not null &&
                     !string.Equals((string)mevcut.cihazId, cihazId, StringComparison.Ordinal);

        var kimlikTasima = farkli && eskiCihazId.Length > 0 &&
                           string.Equals((string)mevcut.cihazId, eskiCihazId, StringComparison.Ordinal);

        var yenidenKurulum = farkli && !kimlikTasima &&
                             CihazKimligi.EskiBicim((string)mevcut.cihazId) &&
                             CihazKimligi.KaliciAndroid(cihazId) &&
                             string.Equals(((string)mevcut.isletim ?? "").Trim(), (girdi.Isletim ?? "").Trim(),
                                           StringComparison.OrdinalIgnoreCase) &&
                             !string.IsNullOrWhiteSpace((string)mevcut.cihazAdi) &&
                             string.Equals(((string)mevcut.cihazAdi).Trim(), (girdi.CihazAdi ?? "").Trim(),
                                           StringComparison.OrdinalIgnoreCase);

        if (kimlikTasima || yenidenKurulum)
        {
            db.Execute(@"
INSERT INTO KRY_MOBIL_CIHAZ_GECMIS
    (personel_kodu, eski_cihaz, yeni_cihaz, cihaz_adi, sebep, yapan)
VALUES (@kod, @eski, @yeni, @ad, @sebep, N'sistem')",
                new
                {
                    kod = personelKodu,
                    eski = (string)mevcut.cihazId,
                    yeni = cihazId,
                    ad = girdi.CihazAdi,
                    sebep = kimlikTasima ? CihazKimligi.TasimaSebebi : CihazKimligi.KurulumSebebi
                });

            _kayit.LogInformation(
                "Mobil cihaz kimliği kalıcı biçime taşındı ({Yol}): {Eski} -> {Yeni}",
                kimlikTasima ? "güncelleme" : "yeniden kurulum",
                CihazKimligi.Ozet((string)mevcut.cihazId), CihazKimligi.Ozet(cihazId));
        }

        if (!testCihazi && !incelemeHesabi && farkli && !kimlikTasima && !yenidenKurulum)
        {
            /* Farklı cihaz. Ayda bir kez değişime izin verilir: sınırsız
               olsaydı kimlik ve telefonu bilen biri kendi telefonuna
               kolayca geçerdi; hiç izin verilmeseydi telefon değiştiren
               personel kilitlenirdi. */
            var gecenGun = (DateTime.Now - (DateTime)mevcut.sonDegisim).TotalDays;

            if (gecenGun < 30)
            {
                var kalan = 30 - (int)gecenGun;

                return BadRequest(new
                {
                    hata = "Bu hesap başka bir cihaza tanımlı.",
                    ayrinti = $"Cihaz değişimi ayda bir kez yapılabilir. "
                              + $"{kalan} gün sonra tekrar deneyebilir ya da "
                              + "İnsan Kaynakları'ndan eşleştirmenin kaldırılmasını isteyebilirsiniz."
                });
            }

            db.Execute(@"
INSERT INTO KRY_MOBIL_CIHAZ_GECMIS
    (personel_kodu, eski_cihaz, yeni_cihaz, cihaz_adi, sebep, yapan)
VALUES (@kod, @eski, @yeni, @ad, N'Aylık değişim hakkı', N'personel')",
                new
                {
                    kod = personelKodu,
                    eski = (string)mevcut.cihazId,
                    yeni = cihazId,
                    ad = girdi.CihazAdi
                });
        }

        db.Execute(@"
MERGE KRY_MOBIL_CIHAZ AS h
USING (SELECT @kod AS k) AS y ON h.personel_kodu = y.k
WHEN MATCHED THEN
    UPDATE SET cihaz_id = @cihazId, cihaz_adi = @cihazAdi,
               isletim = @isletim, son_giris = SYSDATETIME(),
               oturum_acik = 1,
               son_degisim = CASE WHEN h.cihaz_id <> @cihazId AND @tasima = 0
                                  THEN SYSDATETIME() ELSE h.son_degisim END
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, cihaz_id, cihaz_adi, isletim, son_giris)
    VALUES (@kod, @cihazId, @cihazAdi, @isletim, SYSDATETIME());",
            new
            {
                kod = personelKodu,
                cihazId,
                cihazAdi = girdi.CihazAdi,
                isletim = girdi.Isletim,
                /* Eski kimlikle kanıtlanan taşıma cihaz değişimi değildir;
                   aylık hak saati ilerlemez. Yeniden kurulum yolu ilerletir. */
                tasima = kimlikTasima ? 1 : 0
            });

        db.Execute("UPDATE KRY_MOBIL_KOD SET kullanildi = 1 WHERE id = @id",
            new { id = (int)kayit.id });

        /* Önceki oturumun saklanan denetim sonucu düşürülür: yeni jeton
           hemen geçerli sayılsın */
        _oturumDenetimi.Unut(personelKodu);

        /* Personel rolü panelde tanımlı değildir: mobil uygulamaya özel bir
           kimliktir ve panel uçlarına erişim vermez.

           Sicil numarası kullanıcı adına gömülür; MobilController kendi
           verisini bununla bulur. */
        /* Cihaz kimliği jetona gömülür. Her istekte kayıtlı cihazla
           karşılaştırılır; başka bir cihaz giriş yaptığında eskisinin
           jetonu geçersiz kalır ve iki cihazda aynı anda oturum
           açık kalamaz. */
        /* Mobil oturum uzun ömürlü: personel çıkış yapmadıkça açık kalıyor.
           12 saatlik panel süresi telefonda her gün yeniden giriş yaptırıyor,
           personel de karekod okutmak için uygulamayı açtığında kimlik ve
           SMS beklemek zorunda kalıyordu.

           Güvenlik süreye değil iki denetime dayanıyor: jetondaki cihaz
           kimliği kayıtlı cihazla eşleşmeli ve oturum_acik bayrağı açık
           olmalı. Çıkış yapıldığında ya da başka telefondan giriş
           yapıldığında jeton aynı anda geçersizleşiyor. */
        var oturumGunu = int.TryParse(_yapilandirma["Mobil:OturumGunu"], out var g) && g > 0
            ? g : 365;

        var (jeton, bitis) = _jwt.Uret(new Kullanici
        {
            Id = 0,
            KullaniciAdi = $"personel:{personelKodu}|{cihazId}",
            AdSoyad = "",
            Rol = "Personel"
        }, saatAsim: oturumGunu * 24);

        return Ok(new { jeton, bitis, personelKodu });
    }

    /* ==================================================================== */
    /* Veri uçları                                                          */
    /* ==================================================================== */

    /// <summary>Kişinin kendi kaydı; başkasınınki alınamaz.</summary>
    private PersonelKaydi Kendisi()
    {
        var kod = PersonelKodu;

        if (string.IsNullOrWhiteSpace(kod)) return null;

        /* Oturum geçerliliği burada denetlenir: neredeyse tüm uçlar bu
           metodu çağırıyor, tek noktadan kontrol yeterli oluyor. */
        using (var db = _vt.Baglanti())
        {
            if (!OturumGecerli(db)) return null;
        }

        return _personelKaynak.TumPersonelleriGetir()
            .FirstOrDefault(x =>
                string.Equals((x.PersonelKodu ?? "").Trim(), kod,
                    StringComparison.OrdinalIgnoreCase));
    }

    /* ====================================================================== */
    /* Belgelerim                                                            */
    /* ====================================================================== */

    /// <summary>
    /// Personelin kendi özlük belgeleri.
    ///
    /// <para>
    /// Tutanak, ihtar ve sözleşme gibi evraklar İK panelinden yükleniyor.
    /// Personel kendi evrakını görmek için İK'yı aramak zorunda kalıyordu;
    /// imzaladığı belgenin bir kopyası kendisinde de olmalı.
    /// </para>
    ///
    /// <para>
    /// Kimlik numarasıyla da eşleşiyor: kişi ayrılıp geri döndüğünde Mikro
    /// yeni bir personel kodu veriyor ve önceki dönemin belgeleri
    /// görünmüyordu.
    /// </para>
    /// </summary>
    [HttpGet("Belgelerim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Belgelerim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kimlik = (p.KimlikNo ?? "").Trim();

        var ham = db.Query(@"
SELECT id, tur, baslik, aciklama, dosya, ozgun_ad AS ozgunAd, boyut, olusturma
FROM KRY_PERSONEL_BELGE
WHERE silindi = 0
  AND personele_acik = 1
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))
ORDER BY olusturma DESC",
            new { kod = (p.PersonelKodu ?? "").Trim(), kimlik }).ToList();

        /* Alan adları tek tek yazılıyor: dinamik satırdan ad çıkarımıyla
           anonim tip kurmak derlenmiyor. */
        var belgeler = ham.Select(b =>
        {
            var uzanti = Path.GetExtension((string)b.dosya ?? "").ToLowerInvariant();

            return new
            {
                id = (int)b.id,
                tur = (string)b.tur,
                baslik = (string)b.baslik,
                aciklama = (string)b.aciklama,
                ozgunAd = (string)b.ozgunAd,
                boyut = (long)b.boyut,
                olusturma = (DateTime)b.olusturma,
                uzanti,

                /* Word ve Excel telefonun tarayıcısında açılmıyor; ekran
                   bunlarda "indir" diyor, açılmayan boş bir sekme yerine. */
                acilabilir = uzanti is ".pdf" or ".jpg" or ".jpeg" or ".png" or ".txt"
            };
        }).ToList();

        return Ok(new { belgeler });
    }

    /// <summary>
    /// Personelin kendi belgesini tarayıcıda açar.
    ///
    /// Belirteç adres satırından da kabul ediliyor (Program.cs): telefon
    /// belgeyi tarayıcıda açıyor ve o istek başlık taşıyamıyor. Yalnızca
    /// kişinin kendi belgesi açılabiliyor; başka bir kimliğe ait belge
    /// numarası denendiğinde kayıt bulunamıyor.
    /// </summary>
    [HttpGet("BelgeGoster/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult BelgeGoster(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kimlik = (p.KimlikNo ?? "").Trim();

        var belge = db.QueryFirstOrDefault(@"
SELECT dosya FROM KRY_PERSONEL_BELGE
WHERE id = @id AND silindi = 0 AND personele_acik = 1
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))",
            new { id, kod = (p.PersonelKodu ?? "").Trim(), kimlik });

        if (belge is null) return NotFound(new { hata = "Belge bulunamadı." });

        var dosyaAdi = (string)belge.dosya ?? "";

        /* Dosya adı tabloda üretiliyor; yine de yol ayracı denetleniyor */
        if (dosyaAdi.Length == 0 || dosyaAdi.Contains('/') ||
            dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest(new { hata = "Geçersiz dosya adı." });

        /* Yapılandırılan klasörde yoksa eski klasöre de bakılıyor: ayar
           sonradan taşındı ve önceki belgeler eski yerde kaldı. */
        /* Sınıf tam adıyla çağrılıyor: bu denetleyicide aynı adda bir
           yerel metot var ve C# yerel adı öne aldığı için sınıfa
           erişilemiyordu. */
        var yol = Servisler.BelgeKlasoru.Bul(_yapilandirma, _ortam, dosyaAdi);

        if (yol is null)
            return NotFound(new { hata = "Belge dosyası sunucuda bulunamadı." });

        var tur = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".txt" => "text/plain; charset=utf-8",
            _ => "application/octet-stream"
        };

        return PhysicalFile(yol, tur);
    }

    /* ====================================================================== */
    /* Ücret pusulası                                                        */
    /* ====================================================================== */

    /// <summary>
    /// Personelin ücret pusulaları.
    ///
    /// Onay bir imza yerine geçtiği için pusulanın durumu, süresi ve varsa
    /// itiraz yazışması da geliyor; personel neyi ne zaman onayladığını
    /// sonradan görebilmeli.
    /// </summary>
    [HttpGet("Pusulalarim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Pusulalarim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kimlik = (p.KimlikNo ?? "").Trim();

        var ham = db.Query(@"
SELECT id, donem, durum, otomatik, son_gun AS sonGun, onay_tarihi AS onayTarihi,
       itiraz_sebebi AS itirazSebebi, itiraz_metni AS itirazMetni,
       itiraz_tarihi AS itirazTarihi, itiraz_yanit AS itirazYanit, olusturma
FROM KRY_PUSULA
WHERE silindi = 0
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))
ORDER BY donem DESC",
            new { kod = (p.PersonelKodu ?? "").Trim(), kimlik }).ToList();

        var pusulalar = ham.Select(x =>
        {
            var sonGun = (DateTime?)x.sonGun;

            return new
            {
                id = (int)x.id,
                donem = (string)x.donem,
                donemAdi = PusulaController.DonemAdi((string)x.donem),
                durum = (string)x.durum,
                otomatik = (bool)x.otomatik,
                sonGun,

                /* Kalan gün sunucuda hesaplanıyor: telefonun saati yanlışsa
                   personel yanlış süre görüyordu. */
                kalanGun = sonGun is null
                    ? (int?)null
                    : (int)(sonGun.Value.Date - DateTime.Today).TotalDays,

                onayTarihi = (DateTime?)x.onayTarihi,
                itirazSebebi = (string)x.itirazSebebi,
                itirazMetni = (string)x.itirazMetni,
                itirazTarihi = (DateTime?)x.itirazTarihi,
                itirazYanit = (string)x.itirazYanit,
                olusturma = (DateTime)x.olusturma
            };
        }).ToList();

        return Ok(new { pusulalar, onayGunu = PusulaController.OnayGunu });
    }

    /// <summary>
    /// Pusulayı tarayıcıda açar ve ilk görüntülemeyi kaydeder.
    ///
    /// Görüntüleme zamanı, "pusulayı hiç açmadan onayladı" durumunu ayırt
    /// etmek için tutuluyor.
    /// </summary>
    [HttpGet("PusulaGoster/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult PusulaGoster(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var dosyaAdi = db.ExecuteScalar<string>(@"
SELECT dosya FROM KRY_PUSULA
WHERE id = @id AND silindi = 0
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))",
            new
            {
                id,
                kod = (p.PersonelKodu ?? "").Trim(),
                kimlik = (p.KimlikNo ?? "").Trim()
            });

        if (string.IsNullOrWhiteSpace(dosyaAdi))
            return NotFound(new { hata = "Pusula bulunamadı." });

        if (dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest(new { hata = "Geçersiz dosya adı." });

        var yol = Path.Combine(PusulaKlasoru(), dosyaAdi);

        if (!System.IO.File.Exists(yol))
            return NotFound(new { hata = "Pusula dosyası sunucuda bulunamadı." });

        db.Execute(@"
UPDATE KRY_PUSULA SET goruntuleme = SYSDATETIME()
WHERE id = @id AND goruntuleme IS NULL", new { id });

        return PhysicalFile(yol, "application/pdf");
    }

    /// <summary>
    /// Pusulayı onaylar.
    ///
    /// Onay imza yerine geçiyor; zamanı yazılıyor ve geri alınamıyor. İtiraz
    /// edilmiş bir pusula İK yanıtlayana kadar onaylanamaz.
    /// </summary>
    [HttpPost("PusulaOnayla/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult PusulaOnayla(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_PUSULA
SET durum = N'onaylandi', otomatik = 0, onay_tarihi = SYSDATETIME()
WHERE id = @id AND silindi = 0 AND durum = N'bekliyor'
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))",
            new
            {
                id,
                kod = (p.PersonelKodu ?? "").Trim(),
                kimlik = (p.KimlikNo ?? "").Trim()
            });

        if (etkilenen == 0)
            return BadRequest(new
            {
                hata = "Pusula bulunamadı ya da zaten işlem görmüş."
            });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Pusulaya itiraz eder; İK'ya bildirim gider.
    ///
    /// İtiraz sebebi ve açıklaması kayda yazılıyor: "itiraz var" bilgisi tek
    /// başına İK'ya ne yapacağını söylemiyordu.
    /// </summary>
    [HttpPost("PusulaItiraz/{id:int}")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> PusulaItiraz(int id, [FromBody] PusulaItirazGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (string.IsNullOrWhiteSpace(girdi?.Sebep))
            return BadRequest(new { hata = "İtiraz sebebini seçiniz." });

        if (string.IsNullOrWhiteSpace(girdi?.Aciklama))
            return BadRequest(new { hata = "Açıklama yazınız." });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_PUSULA
SET durum = N'itiraz', itiraz_sebebi = @sebep, itiraz_metni = @aciklama,
    itiraz_tarihi = SYSDATETIME()
WHERE id = @id AND silindi = 0 AND durum = N'bekliyor'
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))",
            new
            {
                id,
                sebep = girdi.Sebep.Trim(),
                aciklama = girdi.Aciklama.Trim(),
                kod = (p.PersonelKodu ?? "").Trim(),
                kimlik = (p.KimlikNo ?? "").Trim()
            });

        if (etkilenen == 0)
            return BadRequest(new
            {
                hata = "Pusula bulunamadı ya da zaten işlem görmüş."
            });

        var donem = db.ExecuteScalar<string>(
            "SELECT donem FROM KRY_PUSULA WHERE id = @id", new { id });

        var ad = $"{p.Ad} {p.Soyad}".Trim();

        /* Panel çanına düşen bildirim: itiraz İK'nın gündemine girmeli */
        db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
SELECT kullanici_adi, 'pusula_itiraz', @baslik, @metin
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN (N'Admin', N'IK', N'IKYoneticisi')",
            new
            {
                baslik = $"Ücret pusulasına itiraz: {ad}",
                metin = $"{PusulaController.DonemAdi(donem)} · {girdi.Sebep.Trim()}\n"
                        + girdi.Aciklama.Trim()
            });

        await _bildirim.RoleGonder(
            new[] { "Admin", "IK", "IKYoneticisi" },
            "Ücret pusulasına itiraz",
            $"{ad} · {PusulaController.DonemAdi(donem)} · {girdi.Sebep.Trim()}",
            "pusula");

        return Ok(new { basarili = true });
    }

    /// <summary>Pusulaların durduğu klasör; belgelerle aynı ayardan türetiliyor.</summary>
    private string PusulaKlasoru() => Path.Combine(BelgeKlasoru(), "pusula");

    /// <summary>Belgelerin durduğu klasör.</summary>
    private string BelgeKlasoru()
    {
        var ayar = _yapilandirma["Belge:Klasor"];

        if (!string.IsNullOrWhiteSpace(ayar)) return ayar.Trim();

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        return Path.Combine(kok, "personel-belge");
    }

    /// <summary>
    /// Bugün personelin doğum günü mü.
    ///
    /// <para>
    /// Uygulama açılışında soruluyor ve doğum gününde kutlama penceresi
    /// çıkıyor. Metin ayarlardan geliyor; kutlamanın sözünü İK yazmalı,
    /// yazılıma gömülü bir cümle kurumun diliyle uyuşmuyordu.
    /// </para>
    ///
    /// <para>
    /// Kutlama her personele yılda bir kez gösterilir; sunucu ilk
    /// gösterimi KRY_MOBIL_DOGUMGUNU tablosuna yazar. Önceden yalnızca
    /// uygulama belleğinde tutuluyordu ve uygulama kapatılıp açıldıkça
    /// pencere yeniden çıkıyordu. Mobil uygulamada değişiklik gerekmez:
    /// ikinci istekte <c>kutlama = false</c> döner.
    /// </para>
    /// </summary>
    [HttpGet("DogumGunu")]
    [Authorize(Roles = "Personel")]
    public IActionResult DogumGunu()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var bugun = DateTime.Today;

        /* Doğum tarihi Mikro'dan doğrudan okunuyor: personel kaydı modelinde
           bu alan yok ve modeli genişletmek bütün personel sorgularını
           değiştirmeyi gerektiriyordu. Tek kişilik bu sorgu ucuz. */
        DateTime? dogum = null;

        try
        {
            using var mikro = _vt.PersonelBaglantisi();

            /* Kolon adı aday listesiyle denenmişti ve tutmuyordu: Mikro'da
               alan "per_nuf_dogum_tarih" diye geçiyor, sürüme göre de
               değişebiliyor. Aday saymak yerine satırın tamamı okunup
               adında hem "dogum" hem "tarih" geçen ilk geçerli tarih
               alınıyor — böylece ad değiştiğinde kutlama sessizce
               kaybolmuyor.

               Tablo tam adıyla yazılıyor: personel bağlantısının varsayılan
               veritabanı Mikro olmayabiliyor. */
            var satir = mikro.QueryFirstOrDefault(
                @"SELECT TOP 1 * FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
                  WHERE LTRIM(RTRIM(per_kod)) = @kod",
                new { kod = (p.PersonelKodu ?? "").Trim() });

            if (satir is not null)
            {
                foreach (var alan in (IDictionary<string, object>)satir)
                {
                    if (alan.Key.Contains("dogum", StringComparison.OrdinalIgnoreCase) &&
                        alan.Key.Contains("tarih", StringComparison.OrdinalIgnoreCase) &&
                        /* Adı 't' değil: aynı metodun altında yaş hesabında
                           kullanılan bir t daha var ve iç kapsamda aynı adı
                           tanımlamak derlenmiyor. */
                        alan.Value is DateTime tarih && tarih.Year > 1900)
                    {
                        dogum = tarih;
                        break;
                    }
                }
            }
        }
        catch (Exception hata)
        {
            /* Doğum tarihi okunamazsa kutlama gösterilmiyor; uygulamanın
               açılışını bir kutlama yüzünden bekletmenin anlamı yok. */
            _kayit.LogWarning(hata, "Doğum tarihi okunamadı");
            return Ok(new { kutlama = false });
        }

        var kutlama = dogum is DateTime d && d.Year > 1900 &&
                      d.Day == bugun.Day && d.Month == bugun.Month;

        if (!kutlama) return Ok(new { kutlama = false });

        /* Bu yıl daha önce gösterildiyse tekrar gösterilmez. Kayıt
           eklenemezse (tablo yok, bağlantı sorunu) eski davranışla
           gösterilir: kutlamayı kaçırmak, iki kez görmekten kötü. */
        try
        {
            using var db = _vt.Baglanti();

            var eklenen = db.Execute(@"
INSERT INTO KRY_MOBIL_DOGUMGUNU (personel_kodu, yil)
SELECT @kod, @yil
WHERE NOT EXISTS (SELECT 1 FROM KRY_MOBIL_DOGUMGUNU
                  WHERE personel_kodu = @kod AND yil = @yil)",
                new { kod = (p.PersonelKodu ?? "").Trim(), yil = bugun.Year });

            if (eklenen == 0) return Ok(new { kutlama = false });
        }
        catch (Microsoft.Data.SqlClient.SqlException hata) when (hata.Number is 2627 or 2601)
        {
            /* Aynı anda iki istek: diğeri zaten gösterdi */
            return Ok(new { kutlama = false });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Doğum günü gösterimi kaydedilemedi");
        }

        var ayar = _ayar.FormOku();

        var metin = string.IsNullOrWhiteSpace(ayar?.DogumGunuMetni)
            ? "Doğum gününüz kutlu olsun! Nice mutlu, sağlıklı yıllara."
            : ayar.DogumGunuMetni;

        return Ok(new
        {
            kutlama = true,
            baslik = $"İyi ki doğdunuz, {p.Ad}!",
            metin,
            yas = dogum is DateTime t ? bugun.Year - t.Year : (int?)null
        });
    }

    /// <summary>Ana sayfa özeti.</summary>
    [HttpGet("Ozet")]
    [Authorize(Roles = "Personel")]
    public IActionResult Ozet()
    {
        var p = Kendisi();

        if (p is null)
            return Unauthorized(new
            {
                hata = "Oturumunuz sona erdi.",
                ayrinti = "Başka bir cihazdan giriş yapılmış olabilir. Yeniden giriş yapınız."
            });

        using var db = _vt.Baglanti();

        /* İzin bakiyesi */
        var bakiye = db.QueryFirstOrDefault(@"
SELECT baslangic AS hakedilen, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod", new { kod = p.PersonelKodu });

        var kullanim = db.QueryFirstOrDefault(@"
SELECT
    ISNULL(SUM(CASE WHEN cikis_tarihi <= CAST(SYSDATETIME() AS DATE)
                    THEN gun ELSE 0 END), 0) AS kullanilan,
    ISNULL(SUM(CASE WHEN cikis_tarihi > CAST(SYSDATETIME() AS DATE)
                    THEN gun ELSE 0 END), 0) AS planli
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1",
            new { kod = p.PersonelKodu });

        var hakedilen = bakiye is null ? 0m : (decimal)bakiye.hakedilen;
        var devir = bakiye is null ? 0m : (decimal)bakiye.devir;
        var aktarilan = bakiye is null ? 0m : (decimal)bakiye.aktarilan;

        var kullanilan = aktarilan + (kullanim is null ? 0m : (decimal)kullanim.kullanilan);
        var planli = kullanim is null ? 0m : (decimal)kullanim.planli;

        /* Son duyuru */
        var duyuru = db.QueryFirstOrDefault(@"
SELECT TOP 1 d.baslik, d.metin,
       DATEDIFF(day, d.olusturma, SYSDATETIME()) AS gecenGun
FROM KRY_MOBIL_DUYURU d
WHERE d.iptal = 0 AND d.olusturma <= SYSDATETIME()
  AND (d.personel_kodu IS NULL OR d.personel_kodu = @kod)
  AND (d.hedef_tur IS NULL OR d.hedef_tur = N'herkes'
       OR (d.hedef_tur = N'sube' AND d.sube_adi = @subeAdi)
       OR (d.hedef_tur = N'merkez' AND @subeAdi LIKE N'%MERKEZ%')
       OR (d.hedef_tur = N'depo' AND @subeAdi LIKE N'%DEPO%')
       OR (d.hedef_tur = N'kisi' AND d.personel_kodu = @kod)
       OR (d.hedef_tur = N'secili' AND EXISTS (
            SELECT 1 FROM KRY_MOBIL_DUYURU_ALICI a
            WHERE a.duyuru_id = d.id AND a.personel_kodu = @kod)))
ORDER BY d.olusturma DESC", new { kod = p.PersonelKodu, subeAdi = p.Sube ?? "" });

        /* Okunmamış duyuru sayısı: ana sayfadaki zil rozeti.

           Süzgeç duyuru listesindekiyle birebir aynı olmalı — daha geniş
           bir sayım, personelin açtığında bulamayacağı duyuruları da
           sayar ve rozet hiç sıfırlanmaz. */
        var okunmamisDuyuru = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM KRY_MOBIL_DUYURU d
LEFT JOIN KRY_MOBIL_DUYURU_OKUMA o
       ON o.duyuru_id = d.id AND o.personel_kodu = @kod
WHERE d.iptal = 0 AND d.olusturma <= SYSDATETIME()
  AND o.duyuru_id IS NULL
  AND (d.personel_kodu IS NULL OR d.personel_kodu = @kod)
  AND (d.hedef_tur IS NULL OR d.hedef_tur = N'herkes'
       OR (d.hedef_tur = N'sube' AND d.sube_adi = @subeAdi)
       OR (d.hedef_tur = N'merkez' AND @subeAdi LIKE N'%MERKEZ%')
       OR (d.hedef_tur = N'depo' AND @subeAdi LIKE N'%DEPO%')
       OR (d.hedef_tur = N'kisi' AND d.personel_kodu = @kod)
       OR (d.hedef_tur = N'secili' AND EXISTS (
            SELECT 1 FROM KRY_MOBIL_DUYURU_ALICI a
            WHERE a.duyuru_id = d.id AND a.personel_kodu = @kod)))",
            new { kod = p.PersonelKodu, subeAdi = p.Sube ?? "" });

        return Ok(new
        {
            kisi = new
            {
                personelKodu = p.PersonelKodu,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                gorev = p.Pozisyon,
                subeAdi = p.Sube,
                girisTarihi = p.GirisTarihi,
                kidem = KidemMetni(IzinHakedis.Esas(p.GirisTarihi, IzinHakedis.Getir(db, p.PersonelKodu)))
            },

            izin = new
            {
                kalan = hakedilen + devir - kullanilan - planli
            },

            vardiya = VardiyaOzeti(db, p),
            performans = PerformansOzeti(p),
            prim = PrimOzeti(p),

            sonDuyuru = duyuru,
            okunmamisDuyuru,

            /* Ana sayfadaki "sizi bekleyenler" bölümü bu sayıları
               kullanıyor. Önce döndürülmüyordu ve iki satır hiç
               görünmüyordu. */
            isEmri = IsEmriOzeti(db, p),
            checklist = ChecklistOzeti(db, p),

            hareketler = SonHareketler(p)
        });
    }

    /// <summary>
    /// Açık iş emri sayısı ve süresi geçmiş olan var mı.
    ///
    /// Panel hesabına atananlar da sayılıyor: liste ikisini birlikte
    /// gösteriyor, sayı yalnızca birini saysa tutmazdı.
    /// </summary>
    private dynamic IsEmriOzeti(System.Data.IDbConnection db, PersonelKaydi p)
    {
        try
        {
            var hesaplar = PanelHesaplari(db, p);

            return db.QueryFirstOrDefault(@"
SELECT COUNT(*) AS acik,
       SUM(CASE WHEN son_tarih IS NOT NULL AND son_tarih < SYSDATETIME()
                THEN 1 ELSE 0 END) AS geciken
FROM KRY_IS_EMRI
WHERE durum NOT IN (N'Bitti', N'İptal')
  AND ((atanan_tur = 'personel' AND atanan_kod = @kod)
    OR (atanan_tur = 'panel' AND atanan_kod IN @hesaplar))",
                new
                {
                    kod = (p.PersonelKodu ?? "").Trim(),
                    hesaplar = hesaplar.Count > 0 ? hesaplar : new List<string> { "__yok__" }
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İş emri özeti alınamadı");

            return new { acik = 0, geciken = 0 };
        }
    }

    /// <summary>
    /// Bugün doldurulmayı bekleyen kontrol listesi sayısı.
    ///
    /// Yalnızca bugüne ait ve tamamlanmamış olanlar; geçmiş günler
    /// bekleyen iş değil, rapor konusu.
    /// </summary>
    private dynamic ChecklistOzeti(System.Data.IDbConnection db, PersonelKaydi p)
    {
        try
        {
            var bekleyen = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM KRY_CHECKLIST_DOLDURMA
WHERE personel_kodu = @kod
  AND gun = CAST(SYSDATETIME() AS DATE)
  AND tamamlandi = 0",
                new { kod = (p.PersonelKodu ?? "").Trim() });

            return new { bekleyen };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kontrol listesi özeti alınamadı");

            return new { bekleyen = 0 };
        }
    }

    private static string KidemMetni(DateTime? giris)
    {
        if (giris is null) return null;

        var ay = (int)((DateTime.Now - giris.Value).TotalDays / 30.44);
        var yil = ay / 12;

        return yil > 0 ? $"{yil} yıl" : $"{ay} ay";
    }

    /// <summary>Bugünkü vardiya durumu ve aylık toplam mesai.</summary>
    private object VardiyaOzeti(System.Data.IDbConnection db, PersonelKaydi p)
    {
        var bugun = db.QueryFirstOrDefault(@"
SELECT MIN(gecis_zamani) AS giris, MAX(gecis_zamani) AS cikis, COUNT(*) AS adet
FROM KRY_VARDIYA
WHERE personel_kodu = @kod
  AND CAST(gecis_zamani AS DATE) = CAST(SYSDATETIME() AS DATE)",
            new { kod = p.PersonelKodu });

        var giris = bugun?.giris as DateTime?;
        var cikis = bugun is null ? null : (DateTime?)bugun.cikis;
        var adet = bugun is null ? 0 : (int)bugun.adet;

        /* Tek kayıt varsa henüz çıkış yapılmamıştır */
        var icerideMi = adet > 0 && adet % 2 == 1;

        var aylikDakika = db.ExecuteScalar<int?>(@"
SELECT ISNULL(SUM(sure_dakika), 0) FROM KRY_VARDIYA_GUN
WHERE personel_kodu = @kod
  AND YEAR(tarih) = YEAR(SYSDATETIME())
  AND MONTH(tarih) = MONTH(SYSDATETIME())", new { kod = p.PersonelKodu }) ?? 0;

        string sure = null;

        if (icerideMi && giris is not null)
        {
            var d = (int)(DateTime.Now - giris.Value).TotalMinutes;
            sure = $"{d / 60} saat {d % 60} dakika";
        }

        /* Bugün izinli, raporlu ya da planda izinliyse uygulama açılışındaki
           "giriş yapmadınız" karekod hatırlatması çıkmasın (07.10.2026).
           Yayındaki sürüm hatırlatmayı yalnızca girisSaati boşsa açıyor; bu
           alan başka yerde gösterilmiyor. Okutma yoksa gün başı yazılıyor ki
           1.5 de güncelleme gerekmeden hatırlatmayı açmasın; yeni sürüm
           "izinli" alanına bakıyor. */
        var izinli = giris is null && OkutmaBeklenmez.KisiBugun(db, _vt, p.PersonelKodu, DateTime.Today);

        return new
        {
            icerideMi,
            izinli,
            girisSaati = giris ?? (izinli ? DateTime.Today : (DateTime?)null),
            cikisSaati = icerideMi ? null : cikis,
            sureMetni = sure,
            aylikSaat = aylikDakika / 60
        };
    }

    /// <summary>Son performans puanı ve sırası.</summary>
    private object PerformansOzeti(PersonelKaydi p)
    {
        var kimlik = new string((p?.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11) return null;

        try
        {
            using var db = _vt.PerformansBaglantisi();

            var son = db.QueryFirstOrDefault(@"
SELECT TOP 1 p1.yil, p1.ay, ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
ORDER BY p1.yil DESC, p1.ay DESC", new { kimlik });

            if (son is null) return null;

            var sira = db.ExecuteScalar<int?>(@"
SELECT COUNT(*) + 1
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay
  AND ISNULL([MAĞAZA PERFORMANSI], 0) > @puan",
                new { yil = (int)son.yil, ay = (int)son.ay, puan = (decimal)son.puan });

            return new { puan = (int)(decimal)son.puan, sira };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Performans özeti okunamadı");
            return null;
        }
    }

    /// <summary>
    /// Son kesinleşmiş prim. Prim tablosu yoktur; panel gibi anlık
    /// hesaplanır ve içinde bulunulan ay dışarıda bırakılır.
    /// </summary>
    private object PrimOzeti(PersonelKaydi p)
    {
        var kimlik = new string((p?.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11) return null;

        try
        {
            var buYil = DateTime.Now.Year;
            var buAy = DateTime.Now.Month;

            using var db = _vt.PerformansBaglantisi();

            var son = db.QueryFirstOrDefault(@"
SELECT TOP 1 p1.yil, p1.ay, ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
  AND ISNULL(p1.[MAĞAZA PERFORMANSI], 0) >= 60
  AND (p1.yil < @buYil OR (p1.yil = @buYil AND p1.ay < @buAy))
ORDER BY p1.yil DESC, p1.ay DESC", new { kimlik, buYil, buAy });

            if (son is null) return null;

            decimal ucret = 0;

            using (var mikro = _vt.PersonelBaglantisi())
            {
                ucret = mikro.ExecuteScalar<decimal?>(@"
/* Panelle aynı sorgu: eşleştirme sicil numarasıyla yapılır,
   kimlikle değil. Bazı ünvanlarda ücret Mikro'da tutulmadığı için
   sabit değer kullanılıyor. Ayrılmış kayıt varsa aktif olan
   tercih edilir. */
SELECT TOP 1
       CASE WHEN per_unvan_kodu IN (9, 8, 7, 83) THEN 70000
            ELSE ISNULL(per_ucret, 0) END AS ucret
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
/* per_sicil_no alanı kimlik numarasını tutuyor: panel sözlüğü bu
   alanla dolduruyor ama kimlik numarasıyla arıyor. Sicil numarası
   sanıp p.PersonelKodu göndermek eşleşme vermiyordu. */
WHERE LTRIM(RTRIM(per_sicil_no)) = @kimlik
  AND (per_ucret <> 1 OR per_unvan_kodu IN (9, 8, 7, 83))
ORDER BY CASE WHEN YEAR(per_cikis_tar) <= 1950 OR per_cikis_tar IS NULL
              THEN 0 ELSE 1 END", new { kimlik }) ?? 0;
            }

            var puan = (decimal)son.puan;

            var oran = puan >= 90 ? 0.10m
                     : puan >= 80 ? 0.07m
                     : puan >= 70 ? 0.05m
                     : 0.03m;

            return new
            {
                sonTutar = Math.Round(ucret * oran, 0),
                sonAy = (int)son.ay,
                sonYil = (int)son.yil
            };
        }
        catch
        {
            return null;
        }
    }

    /* ==================================================================== */
    /* Yıllık izin                                                          */
    /* ==================================================================== */

    [HttpGet("Izin")]
    [Authorize(Roles = "Personel")]
    public IActionResult Izin()
    {
        var kod = PersonelKodu;

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var bakiye = db.QueryFirstOrDefault(@"
SELECT baslangic AS hakedilen, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod", new { kod });

        var kullanim = db.QueryFirstOrDefault(@"
SELECT
    ISNULL(SUM(CASE WHEN cikis_tarihi <= CAST(SYSDATETIME() AS DATE)
                    THEN gun ELSE 0 END), 0) AS kullanilan,
    ISNULL(SUM(CASE WHEN cikis_tarihi > CAST(SYSDATETIME() AS DATE)
                    THEN gun ELSE 0 END), 0) AS planli
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1",
            new { kod });

        var hakedilen = bakiye is null ? 0m : (decimal)bakiye.hakedilen;
        var devir = bakiye is null ? 0m : (decimal)bakiye.devir;
        var aktarilan = bakiye is null ? 0m : (decimal)bakiye.aktarilan;

        var kullanilan = aktarilan + (decimal)(kullanim?.kullanilan ?? 0m);
        var planli = (decimal)(kullanim?.planli ?? 0m);

        var kayitlar = db.Query(@"
SELECT tur, cikis_tarihi AS cikisTarihi, donus_tarihi AS donusTarihi,
       gun, yarim_gun AS yarimGun,
       baslangic_saat AS baslangicSaat, bitis_saat AS bitisSaat, saat,
       CASE WHEN cikis_tarihi > CAST(SYSDATETIME() AS DATE)
            THEN 1 ELSE 0 END AS planliMi
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0
ORDER BY cikis_tarihi DESC", new { kod }).ToList();

        /* Sonraki hak ediş: işe giriş gününün gelecek yıl dönümü */
        var p = Kendisi();
        DateTime? sonraki = null;
        int? kalanAy = null;

        /* Ayrılıp tekrar girenlerde İK'nın düzelttiği hak ediş tarihi */
        DateTime? esas = p is null ? null
            : IzinHakedis.Esas(p.GirisTarihi, IzinHakedis.Getir(db, kod));

        if (esas is DateTime giris)
        {
            var aday = IzinHakedis.YilDonumu(giris, DateTime.Now.Year);

            if (aday < DateTime.Now.Date) aday = aday.AddYears(1);

            sonraki = aday;
            kalanAy = (int)((aday - DateTime.Now.Date).TotalDays / 30.44);
        }

        return Ok(new
        {
            yil = DateTime.Now.Year,

            bakiye = new
            {
                hakedilen,
                devir,
                kullanilan,
                planli,
                kalan = hakedilen + devir - kullanilan - planli,
                sonrakiHakEdis = sonraki,
                kalanAy
            },

            kayitlar
        });
    }

    /* ==================================================================== */
    /* Performans                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Kişinin kendi performansı.
    ///
    /// Panelle aynı kaynak: biDb'deki değerlendirme sonuçları tablosu.
    /// Ölçütler ayrı bir tabloda değil, o tablonun sütunlarında duruyor.
    /// </summary>
    [HttpGet("Performans")]
    [Authorize(Roles = "Personel")]
    public IActionResult Performans([FromQuery] int? yil, [FromQuery] int? ay)
    {
        var p = Kendisi();

        if (p is null)
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kimlik = new string((p.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11) return Ok(new { puan = (int?)null });

        try
        {
            using var db = _vt.PerformansBaglantisi();

            /* Dönem verilmezse en son değerlendirme alınır; verilirse o ay
               gösterilir. Personel geçmiş aylarına da bakabilmeli. */
            var son = yil is not null && ay is not null
                ? db.QueryFirstOrDefault(@"
SELECT TOP 1 p1.yil, p1.ay,
       ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan,
       p1.gorev_adi AS gorevAdi, p1.sube_adi AS subeAdi
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
  AND p1.yil = @yil AND p1.ay = @ay",
                    new { kimlik, yil, ay })
                : db.QueryFirstOrDefault(@"
SELECT TOP 1 p1.yil, p1.ay,
       ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan,
       p1.gorev_adi AS gorevAdi, p1.sube_adi AS subeAdi
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
ORDER BY p1.yil DESC, p1.ay DESC", new { kimlik });

            if (son is null) return Ok(new { puan = (int?)null });

            var seciliYil = (int)son.yil;
            var seciliAy = (int)son.ay;

            /* Ölçütler sütun olarak duruyor; satırı sözlük gibi okuyup
               tanımlı ölçüt adlarıyla eşleştiriyoruz. */
            var satir = db.QueryFirstOrDefault(@"
SELECT p1.*
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
  AND p1.yil = @yil AND p1.ay = @ay",
                new { kimlik, yil = seciliYil, ay = seciliAy }) as IDictionary<string, object>;

            var olcutler = new List<object>();

            if (satir is not null)
            {
                /* Referans puan: aynı dönemde o ölçütten alınabilen en
                   yüksek değer. Puan alamayan kişi neyi kaçırdığını
                   göremiyordu; "0" tek başına bir şey söylemiyor. */
                var referanslar = new Dictionary<string, decimal>();
                var ortalamalar = new Dictionary<string, decimal>();

                try
                {
                    /* Yalnızca tabloda gerçekten olan sütunlar sorulur;
                       tek bir eksik ad sorgunun tamamını düşürüyordu. */
                    var tablodakiler = db.Query<string>(@"
SELECT COLUMN_NAME
FROM [biDb].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Personel_Degerlendirme_Sonuclari'")
                        .ToHashSet(StringComparer.OrdinalIgnoreCase);

                    var kullanilacak = MagazaOlcutleri
                        .Where(x => tablodakiler.Contains(x))
                        .ToArray();

                    if (kullanilacak.Length == 0) throw new Exception("Ölçüt sütunu yok");

                    var secim = string.Join(", ", kullanilacak
                        .Select(x => $"MAX([{x}]) AS [max_{x}], AVG([{x}]) AS [ort_{x}]"));

                    var ozet = db.QueryFirstOrDefault($@"
SELECT {secim}
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay AND gorev_adi = @gorev",
                        new { yil = seciliYil, ay = seciliAy, gorev = (string)son.gorevAdi })
                        as IDictionary<string, object>;

                    if (ozet is not null)
                    {
                        foreach (var ad in kullanilacak)
                        {
                            if (ozet.TryGetValue("max_" + ad, out var m)
                                && m is not null
                                && decimal.TryParse(m.ToString(), out var mv))
                                referanslar[ad] = Math.Round(mv, 1);

                            if (ozet.TryGetValue("ort_" + ad, out var o)
                                && o is not null
                                && decimal.TryParse(o.ToString(), out var ov))
                                ortalamalar[ad] = Math.Round(ov, 1);
                        }
                    }
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Ölçüt referansları hesaplanamadı");
                }

                /* Ölçütlerin mağaza değerleri: sizin değeriniz ve geçmek
                   için gereken eşik (şirket ortalaması ya da sınır) */
                var olcutServisi = HttpContext.RequestServices.GetRequiredService<PerformansOlcutServisi>();
                var degerler = olcutServisi.Degerler(db, (string)son.subeAdi, seciliYil, seciliAy, (string)son.gorevAdi);
                /* Gerçek puan sınırı: o ay puan alan mağazaların en zayıf değeri (24.10.2026) */
                var sinirlar = olcutServisi.PuanSinirlari(db, seciliYil, seciliAy, (string)son.gorevAdi);
                /* Pozisyonun ölçütleri: kişinin görevinde hiç puan çıkmayan ölçüt gösterilmez */
                var gorevde = olcutServisi.GorevOlcutleri(db, (string)son.gorevAdi, MagazaOlcutleri);
                static string Sy(decimal d) => d.ToString(Math.Abs(d) < 1 ? "0.####" : "0.##", new System.Globalization.CultureInfo("tr-TR"));

                foreach (var ad in MagazaOlcutleri)
                {
                    if (!satir.TryGetValue(ad, out var deger) || deger is null)
                        continue;

                    if (!decimal.TryParse(deger.ToString(), out var puan))
                        continue;

                    if (puan <= 0 && gorevde is not null && !gorevde.Contains(ad))
                        continue;

                    string aciklama = null;

                    if (ortalamalar.TryGetValue(ad, out var sirketOrt))
                        aciklama = $"Şirket ortalaması: {sirketOrt}";

                    /* Puan alınamamışsa kaç puanın kaçırıldığı yazılır */
                    if (puan <= 0 && referanslar.TryGetValue(ad, out var referans)
                        && referans > 0)
                        aciklama = (aciklama is null ? "" : aciklama + " · ")
                                 + $"Bu bölümden puan alamadınız "
                                 + $"(referans puan: {referans})";

                    degerler.TryGetValue(ad, out var mv);
                    var aldi = puan > 0;

                    /* Değer şirket ortalamasının iyi tarafında olduğu hâlde puan
                       yoksa "ortalamaya çıkarmanız gerekiyor" yazmak yanlıştı.
                       Eşik, o ay gerçekten puan alan mağazaların en zayıf
                       değerine çekilir; eski uygulama da doğru cümleyi kurar. */
                    var yon = PerformansOlcutServisi.Yon(ad);
                    var esik = mv?.Esik;
                    var esikAd = mv?.EsikAd;
                    string neden = null;
                    sinirlar.TryGetValue(ad, out var sn);
                    if (!aldi && mv?.Sen is decimal sen && mv.Esik is decimal es && PerformansOlcutServisi.IyiTarafta(sen, es, yon))
                    {
                        var taraf = yon > 0 ? "üzerinde" : "altında";
                        if (sn?.PuanAlanEnZayif is decimal gz && !PerformansOlcutServisi.IyiTarafta(sen, gz, yon))
                        {
                            esik = gz;
                            esikAd = yon > 0 ? "Puan alan en düşük" : "Puan alan en yüksek";
                            neden = $"Değeriniz ({Sy(sen)}) şirket ortalamasının ({Sy(es)}) {taraf}, ancak ortalamayı geçmek bu ay puan için yetmedi. "
                                  + $"Puan alan {sn.Alan} mağazanın en zayıf değeri {Sy(gz)}; puan için en az bu değer gerekiyordu"
                                  + (sn.Alamayan > 0 ? $" ({sn.Alamayan} mağaza puan alamadı)." : ".");
                        }
                        else
                        {
                            esik = null;
                            neden = $"Değeriniz ({Sy(sen)}) şirket ortalamasının ({Sy(es)}) {taraf} olduğu hâlde bu ölçütten puan verilmemiş. "
                                  + "Hesapta ek bir koşul uygulanmış olabilir; İnsan Kaynakları'na danışabilirsiniz.";
                            _kayit.LogWarning("Performans tutarsızlığı: {Sube} {Yil}/{Ay} {Olcut} değer {Sen} ort {Ort} puan 0",
                                (string)son.subeAdi, seciliYil, seciliAy, ad, sen, es);
                        }
                    }

                    olcutler.Add(new
                    {
                        ad = ToBaslik(ad),
                        kod = ad,
                        puan = Math.Round(puan, 1),
                        referans = referanslar.TryGetValue(ad, out var r) ? r : (decimal?)null,
                        sirketOrtalamasi = ortalamalar.TryGetValue(ad, out var so)
                            ? so : (decimal?)null,
                        aciklama,

                        /* Eski sistemdeki gibi: sizin değeriniz, eşik ve yön */
                        aldi,
                        yon,
                        deger = mv?.Sen,
                        esik,
                        esikAd,
                        /* Ayrıntı (1.10+): şirket ortalaması ve gerçek sınır ayrı ayrı */
                        sirketOrt = mv?.EsikAd == "Şirket ort." ? mv?.Esik : null,
                        puanSiniri = sn?.PuanAlanEnZayif,
                        puanAlan = sn?.Alan,
                        puanAlamayan = sn?.Alamayan,
                        neden,
                        sinirda = PerformansOlcutServisi.Sinirda(mv, aldi),
                        azKaldi = !aldi && esik is decimal ae && mv?.Sen is decimal av && ae != 0 && Math.Abs(av - ae) / Math.Abs(ae) < 0.03m,
                    });
                }
            }

            /* Aynı yıldaki tüm aylar; grafik için */
            var aylik = db.Query(@"
SELECT p1.yil, p1.ay, ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik AND p1.yil = @yil
ORDER BY p1.ay", new { kimlik, yil = seciliYil })
                .Select(x => new
                {
                    yil = (int)x.yil,
                    ay = (int)x.ay,
                    puan = (int)(decimal)x.puan,
                    buAy = (int)x.ay == seciliAy
                })
                .ToList();

            /* Sıralama: aynı ayda aynı görevdeki ve şirket genelindeki yeri */
            var gorevSirasi = db.ExecuteScalar<int?>(@"
SELECT COUNT(*) + 1
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay AND gorev_adi = @gorev
  AND ISNULL([MAĞAZA PERFORMANSI], 0) > @puan",
                new { yil = seciliYil, ay = seciliAy, gorev = (string)son.gorevAdi, puan = (decimal)son.puan });

            var sirketSirasi = db.ExecuteScalar<int?>(@"
SELECT COUNT(*) + 1
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay
  AND ISNULL([MAĞAZA PERFORMANSI], 0) > @puan",
                new { yil = seciliYil, ay = seciliAy, puan = (decimal)son.puan });

            /* Seçilebilecek dönemler; uygulama ay seçicisini bununla kurar */
            var donemler = db.Query(@"
SELECT p1.yil, p1.ay
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
ORDER BY p1.yil DESC, p1.ay DESC", new { kimlik })
                .Select(x => new { yil = (int)x.yil, ay = (int)x.ay })
                .ToList();

            return Ok(new
            {
                yil = seciliYil,
                ay = seciliAy,
                donemler,
                puan = (int)(decimal)son.puan,
                gorevAdi = (string)son.gorevAdi,
                subeAdi = (string)son.subeAdi,
                gorevSirasi,
                sirketSirasi,
                olcutler,
                aylik
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Performans okunamadı: {Kod}", p.PersonelKodu);
            return Ok(new { puan = (int?)null });
        }
    }

    /// <summary>
    /// Duyuru imzası: yazanın adı, ünvanı ve imza metni.
    ///
    /// Varsayılan imzada metin boş bırakılıyor; uygulama adı ve ünvanı
    /// kendisi yazıyor. Kişisel imza seçilirse metin olduğu gibi
    /// gösteriliyor ve istenirse hesaba kaydediliyor.
    /// </summary>
    private (string ad, string unvan, string imza) ImzaHazirla(
        System.Data.IDbConnection db, DuyuruGirdi girdi)
    {
        var kullanici = User?.Identity?.Name ?? "";

        var hesap = db.QueryFirstOrDefault(@"
SELECT ad_soyad AS ad, unvan, imza FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici",
            new { kullanici });

        var ad = ((string)hesap?.ad)?.Trim();
        var unvan = ((string)hesap?.unvan)?.Trim();

        var kisisel = string.Equals(girdi.ImzaTuru, "kisisel", StringComparison.OrdinalIgnoreCase);
        var metin = (girdi.Imza ?? "").Trim();

        if (!kisisel) return (ad, unvan, null);

        /* Metin verilmediyse hesapta kayıtlı imza kullanılıyor */
        if (metin.Length == 0) metin = ((string)hesap?.imza ?? "").Trim();

        if (metin.Length > 400) metin = metin[..400];

        if (girdi.ImzayiKaydet && metin.Length > 0)
            db.Execute("UPDATE KRY_KULLANICILAR SET imza = @imza WHERE kullanici_adi = @kullanici",
                new { imza = metin, kullanici });

        return (ad, unvan, metin.Length > 0 ? metin : null);
    }

    /// <summary>Ölçüt adları büyük harfle tutuluyor; okunur hâle getirir.</summary>
    private static string ToBaslik(string ad)
    {
        if (string.IsNullOrWhiteSpace(ad)) return ad;

        var kultur = new System.Globalization.CultureInfo("tr-TR");

        return kultur.TextInfo.ToTitleCase(ad.ToLower(kultur));
    }

    /// <summary>Mağaza performans ölçütleri; panelle aynı liste.</summary>
    private static readonly string[] MagazaOlcutleri =
    {
        "CİRO", "KARLILIK", "MÜŞTERİ SAYISI", "KİŞİ BAŞI CİRO",
        "TURNOVER", "ÜRÜN YOK SATMA", "GİDER ORANI", "İADE",
        "FİYAT FARKLARI", "KALİTE & HİJYEN",
        "ET FİRE", "BEYAZ ET FİRE", "MANAV FİRE", "TADOLYA FİRE",
        "KASA AÇIKLARI", "MAL KABUL HATASI",
        /* Tabloda ayrı iki sütun; birleşik ad kullanmak bu ölçütlerin
           hiç görünmemesine yol açıyordu. */
        "FİŞ İPTAL SAYILARI", "SATIR İPTAL SAYILARI"
    };

    /* ==================================================================== */
    /* Prim                                                                 */
    /* ==================================================================== */

    /// <summary>
    /// Geçmiş ayların primleri.
    ///
    /// <para>
    /// Prim ayrı bir tabloda saklanmıyor; panelde olduğu gibi anlık
    /// hesaplanıyor. Puan biDb'den, ücret Mikro'dan gelir ve dilime göre
    /// oran uygulanır — panelle aynı kural.
    /// </para>
    ///
    /// <para>
    /// İçinde bulunulan ay DÖNMEZ. Ay kapanmadan hesaplanan tutar mağaza
    /// verileri kesinleştiğinde değişiyor; personele değişen bir rakam
    /// göstermek güveni zedeliyor.
    /// </para>
    /// </summary>
    [HttpGet("Prim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Prim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var kimlik = new string((p.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11)
            return Ok(new { yillikToplam = 0m, primliAy = 0, aylar = new List<object>() });

        var buYil = DateTime.Now.Year;
        var buAy = DateTime.Now.Month;

        List<dynamic> puanlar;

        try
        {
            using var db = _vt.PerformansBaglantisi();

            /* Yalnızca kesinleşmiş aylar: içinde bulunulan ay hariç.
               Panelin sorgusuyla aynı kaynak ve aynı süzgeçler. */
            puanlar = db.Query(@"
SELECT p1.yil, p1.ay,
       ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE LTRIM(RTRIM(p2.per_tckimlik_no)) = @kimlik
  AND ISNULL(p1.[MAĞAZA PERFORMANSI], 0) >= 60
  AND (p1.yil < @buYil OR (p1.yil = @buYil AND p1.ay < @buAy))
ORDER BY p1.yil DESC, p1.ay DESC",
                new { kimlik, buYil, buAy }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Prim puanları okunamadı: {Kimlik}", kimlik);

            return Ok(new
            {
                yillikToplam = 0m,
                primliAy = 0,
                aylar = new List<object>(),
                uyari = "Prim bilgisine şu anda ulaşılamıyor."
            });
        }

        /* Ücret Mikro'dan; prim ücret üzerinden hesaplanıyor */
        decimal ucret = 0;

        try
        {
            using var mikro = _vt.PersonelBaglantisi();

            ucret = mikro.ExecuteScalar<decimal?>(@"
/* Panelle aynı sorgu: eşleştirme sicil numarasıyla yapılır,
   kimlikle değil. Bazı ünvanlarda ücret Mikro'da tutulmadığı için
   sabit değer kullanılıyor. Ayrılmış kayıt varsa aktif olan
   tercih edilir. */
SELECT TOP 1
       CASE WHEN per_unvan_kodu IN (9, 8, 7, 83) THEN 70000
            ELSE ISNULL(per_ucret, 0) END AS ucret
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
/* per_sicil_no alanı kimlik numarasını tutuyor: panel sözlüğü bu
   alanla dolduruyor ama kimlik numarasıyla arıyor. Sicil numarası
   sanıp p.PersonelKodu göndermek eşleşme vermiyordu. */
WHERE LTRIM(RTRIM(per_sicil_no)) = @kimlik
  AND (per_ucret <> 1 OR per_unvan_kodu IN (9, 8, 7, 83))
ORDER BY CASE WHEN YEAR(per_cikis_tar) <= 1950 OR per_cikis_tar IS NULL
              THEN 0 ELSE 1 END", new { kimlik }) ?? 0;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ücret okunamadı: {Kimlik}", kimlik);
        }

        var aylar = puanlar
            .Select(x =>
            {
                var puan = (decimal)x.puan;

                /* Panelle aynı dilimler */
                var oran = puan >= 90 ? 0.10m
                         : puan >= 80 ? 0.07m
                         : puan >= 70 ? 0.05m
                         : 0.03m;

                return new
                {
                    yil = (int)x.yil,
                    ay = (int)x.ay,
                    puan = (int)puan,
                    oran = (int)(oran * 100),
                    tutar = Math.Round(ucret * oran, 0)
                };
            })
            .ToList();

        return Ok(new
        {
            yillikToplam = aylar.Where(a => a.yil == buYil).Sum(a => a.tutar),
            primliAy = aylar.Count(a => a.tutar > 0),
            aylar
        });
    }

    /* ==================================================================== */
    /* Duyurular                                                            */
    /* ==================================================================== */

    [HttpGet("Duyurular")]
    [Authorize(Roles = "Personel")]
    public IActionResult Duyurular()
    {
        var kod = PersonelKodu;
        var p = Kendisi();

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT TOP 50
       d.id, d.baslik, d.metin, d.onemli,
       d.baglanti, d.baglanti_yazi AS baglantiYazi,
       CASE WHEN d.gorsel IS NULL THEN 0 ELSE 1 END AS gorselVar,
       CASE WHEN d.personel_kodu IS NOT NULL THEN 1 ELSE 0 END AS kisisel,
       DATEDIFF(day, d.olusturma, SYSDATETIME()) AS gecenGun,

       /* Tam tarih: kartta 22 Haziran 2026/Pzt 18:39 biçiminde
          gösteriliyor. Göreli yazı (3 gün önce) bir hafta sonra ne
          zaman yayınlandığını söylemiyordu. */
       d.olusturma,

       /* Duyurunun altındaki imza */
       d.yazan_ad AS yazanAd, d.yazan_unvan AS yazanUnvan, d.imza,

       CASE WHEN o.duyuru_id IS NULL THEN 0 ELSE 1 END AS okundu
FROM KRY_MOBIL_DUYURU d
LEFT JOIN KRY_MOBIL_DUYURU_OKUMA o
       ON o.duyuru_id = d.id AND o.personel_kodu = @kod
WHERE d.iptal = 0 AND d.olusturma <= SYSDATETIME()
  AND (d.personel_kodu IS NULL OR d.personel_kodu = @kod)
  /* Şube süzgeci ada göre: personel kaydında şube kodu taşınmıyor,
     yalnızca adı var. Duyuru şubeye özel değilse herkese açıktır. */
  AND (d.hedef_tur IS NULL OR d.hedef_tur = N'herkes'
       OR (d.hedef_tur = N'sube' AND d.sube_adi = @subeAdi)
       OR (d.hedef_tur = N'merkez' AND @subeAdi LIKE N'%MERKEZ%')
       OR (d.hedef_tur = N'depo' AND @subeAdi LIKE N'%DEPO%')
       OR (d.hedef_tur = N'kisi' AND d.personel_kodu = @kod)
       OR (d.hedef_tur = N'secili' AND EXISTS (
            SELECT 1 FROM KRY_MOBIL_DUYURU_ALICI a
            WHERE a.duyuru_id = d.id AND a.personel_kodu = @kod)))
ORDER BY d.olusturma DESC",
            new { kod, subeAdi = p?.Sube ?? "" }).ToList();

        /* Görülenler okundu sayılır: ayrıca dokunmayı beklemek,
           bildirimlerin hep okunmamış görünmesine yol açıyor. */
        var okunmayanlar = kayitlar
            .Where(x => (int)x.okundu == 0)
            .Select(x => (int)x.id)
            .ToList();

        if (okunmayanlar.Count > 0)
        {
            foreach (var id in okunmayanlar)
                db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_MOBIL_DUYURU_OKUMA
               WHERE duyuru_id = @id AND personel_kodu = @kod)
    INSERT INTO KRY_MOBIL_DUYURU_OKUMA (duyuru_id, personel_kodu)
    VALUES (@id, @kod)", new { id, kod });
        }

        return Ok(new { kayitlar });
    }

    /// <summary>
    /// Fotoğraf tanısı: jeton çözülüyor mu, kayıt bulunuyor mu, veri
    /// hangi sütunda. Fotoğrafın neden gelmediğini tahmin etmek yerine
    /// görmek için.
    /// </summary>
    [HttpGet("ResimTanisi")]
    [AllowAnonymous]
    public IActionResult ResimTanisi([FromQuery] string j, [FromQuery] string sicil)
    {
        var kod = PersonelKodu;
        var kaynak = "başlık";

        if (string.IsNullOrWhiteSpace(kod) && !string.IsNullOrWhiteSpace(j))
        {
            kod = _jwt.PersonelKoduCoz(j);
            kaynak = "jeton";
        }

        /* Tanı sırasında sicil doğrudan verilebilir: jeton almak zor ve
           sorunun jetonda mı sorguda mı olduğunu ayırmak gerekiyor. */
        if (string.IsNullOrWhiteSpace(kod) && !string.IsNullOrWhiteSpace(sicil))
        {
            kod = sicil.Trim();
            kaynak = "sicil parametresi";
        }

        if (string.IsNullOrWhiteSpace(kod))
            return Ok(new
            {
                sonuc = "Sicil belirtilmedi",
                nasil = "?sicil=14264 ekleyerek deneyiniz"
            });

        try
        {
            using var db = _vt.PersonelBaglantisi();

            var personelVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @kod", new { kod });

            var resimVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
JOIN [MikroDesktop_2004BICEN].dbo.mye_ImageData I ON I.Record_uid = P.per_Guid
WHERE LTRIM(RTRIM(P.per_kod)) = @kod", new { kod });

            var satir = db.QueryFirstOrDefault(@"
SELECT TOP 1 I.*
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
JOIN [MikroDesktop_2004BICEN].dbo.mye_ImageData I ON I.Record_uid = P.per_Guid
WHERE LTRIM(RTRIM(P.per_kod)) = @kod", new { kod }) as IDictionary<string, object>;

            var sutunlar = satir?
                .Select(x => new
                {
                    ad = x.Key,
                    tur = x.Value?.GetType().Name ?? "null",
                    boyut = x.Value is byte[] b ? b.Length : 0
                })
                .Where(x => x.boyut > 0 || x.tur != "Byte[]")
                .Take(25)
                .ToList();

            /* Panelin kullandığı yol: per_Guid üzerinden. Bazı kayıtlarda
               per_Guid boş olabiliyor; o zaman eşleşme kurulamıyor. */
            var guid = db.ExecuteScalar<Guid?>(@"
SELECT TOP 1 per_Guid FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @kod", new { kod });

            return Ok(new
            {
                kod,
                kaynak,
                personelVar,
                perGuid = guid,
                resimVar,
                sutunlar,

                yorum =
                    personelVar == 0
                        ? "Bu sicille personel bulunamadı."
                        : guid is null || guid == Guid.Empty
                        ? "Personelin per_Guid alanı boş; fotoğraf eşleştirmesi kurulamıyor."
                        : resimVar == 0
                        ? "Personel var ama mye_ImageData tablosunda kaydı yok."
                        : "Kayıt bulundu; sütunlara bakınız."
            });
        }
        catch (Exception hata)
        {
            return Ok(new { kod, kaynak, hata = hata.Message });
        }
    }

    /// <summary>Son geçiş hareketleri.</summary>    /* ==================================================================== */
    /* Vardiya                                                              */
    /* ==================================================================== */

    [HttpGet("Vardiya")]
    [Authorize(Roles = "Personel")]
    public IActionResult VardiyaDurumu()
    {
        var kod = PersonelKodu;
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var bugun = db.QueryFirstOrDefault(@"
SELECT MIN(gecis_zamani) AS giris, MAX(gecis_zamani) AS cikis,
       COUNT(*) AS adet,
       MAX(CAST(konum_dogru AS INT)) AS konumDogru
FROM KRY_VARDIYA
WHERE personel_kodu = @kod
  AND CAST(gecis_zamani AS DATE) = CAST(SYSDATETIME() AS DATE)",
            new { kod });

        var adet = bugun is null ? 0 : (int)bugun.adet;
        var icerideMi = adet > 0 && adet % 2 == 1;

        /* Son yedi gün */
        var hafta = db.Query(@"
SELECT TOP 7 tarih, ilk_giris AS giris, son_cikis AS cikis,
       sure_dakika AS sureDakika, izinli
FROM KRY_VARDIYA_GUN
WHERE personel_kodu = @kod
ORDER BY tarih DESC", new { kod })
            .Select(x => new
            {
                gunAdi = GunAdi((DateTime)x.tarih),
                giris = x.giris,
                cikis = x.cikis,
                izinli = (bool)x.izinli,
                sureMetni = (int)x.sureDakika > 0
                    ? $"{(int)x.sureDakika / 60}s {(int)x.sureDakika % 60}d"
                    : null
            })
            .Reverse()
            .ToList();

        return Ok(new
        {
            subeAdi = p.Sube,

            bugun = new
            {
                icerideMi,
                girisSaati = adet > 0 ? (DateTime?)bugun.giris : null,
                cikisSaati = icerideMi ? null : (adet > 1 ? (DateTime?)bugun.cikis : null),
                konumDogrulandi = bugun is not null && (int?)bugun.konumDogru == 1
            },

            hafta
        });
    }

    private static string GunAdi(DateTime t) => t.DayOfWeek switch
    {
        DayOfWeek.Monday => "Pazartesi",
        DayOfWeek.Tuesday => "Salı",
        DayOfWeek.Wednesday => "Çarşamba",
        DayOfWeek.Thursday => "Perşembe",
        DayOfWeek.Friday => "Cuma",
        DayOfWeek.Saturday => "Cumartesi",
        _ => "Pazar",
    };

    /// <summary>
    /// Karekod okutulduğunda giriş ya da çıkış kaydı düşer.
    ///
    /// <para>
    /// Karekod her şubede sabittir ve mağaza girişine asılır. Sabit kod
    /// fotoğraflanıp paylaşılabilir; buna karşı iki önlem var: konum
    /// doğrulaması ve aynı kişinin arka arkaya okutmasının engellenmesi.
    /// </para>
    /// </summary>
    [HttpPost("VardiyaOkut")]
    [Authorize(Roles = "Personel")]
    public IActionResult VardiyaOkut([FromBody] VardiyaOkutGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var okunan = (girdi?.Kod ?? "").Trim();

        if (string.IsNullOrWhiteSpace(okunan))
            return BadRequest(new { hata = "Karekod okunamadı." });

        using var db = _vt.Baglanti();

        /* Her yerden karekodu (21.10.2026): yalnızca "Her yerden" kuralı olan
           personel, konum sınırı olmadan okutabilir. Konum gelirse kayda yazılır. */
        var serbest = OkutmaKurallari.SerbestKodMu(_vt, okunan);

        if (serbest && OkutmaKurallari.KuralBul(_vt, p.PersonelKodu, DateTime.Today)?.Tur != OkutmaKurallari.Serbest)
        {
            OkutmaKurallari.RedYaz(_vt, p, OkutmaKurallari.SerbestSubeKodu, "Her yerden karekodu",
                "yetki", null, null, girdi.Enlem, girdi.Boylam, "Her yerden okutma yetkisi yok.");

            return BadRequest(new
            {
                hata = "Bu karekodu kullanma yetkiniz yok.",
                ayrinti = "Bu karekod yalnızca İnsan Kaynakları'nın tanımladığı personel içindir. Okutmanızı şubenizdeki karekoddan yapınız."
            });
        }

        var sube = serbest
            ? new
            {
                subeKodu = OkutmaKurallari.SerbestSubeKodu,
                subeAdi = ("Her yerden · " + (p.IsGrubu ?? "").Trim()).TrimEnd(' ', '·'),
                enlem = (double?)null,
                boylam = (double?)null
            }
            : db.QueryFirstOrDefault(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, enlem, boylam
FROM KRY_SUBE_KAREKOD WHERE kod = @kod", new { kod = okunan });

        /* Şubede zaten asılı olan başka sistemin (iCard) karekodu: şubeye
           tanıtılmışsa o şubenin okutması sayılıyor. Aynı kod birden çok
           şubede aynıysa şube, personelin konumuna en yakın olan. */
        if (sube is null && okunan.Length <= 400)
        {
            var adaylar = db.Query(@"
SELECT h.sube_kodu AS subeKodu, COALESCE(h.sube_adi, k.sube_adi) AS subeAdi, k.enlem, k.boylam
FROM KRY_SUBE_KAREKOD_HARICI h
LEFT JOIN KRY_SUBE_KAREKOD k ON k.sube_kodu = h.sube_kodu
WHERE h.kod = @kod OR (@guid IS NOT NULL AND h.kod = @guid)",
                new { kod = okunan, guid = KarekodGuid(okunan) }).ToList();

            if (adaylar.Count == 1)
            {
                sube = adaylar[0];
            }
            else if (adaylar.Count > 1)
            {
                if (girdi.Enlem is double ae && girdi.Boylam is double ab)
                    sube = adaylar
                        .Where(x => x.enlem is not null && x.boylam is not null)
                        .OrderBy(x => Mesafe(ae, ab, (double)x.enlem, (double)x.boylam))
                        .FirstOrDefault();

                if (sube is null)
                    return BadRequest(new
                    {
                        hata = "Şube belirlenemedi.",
                        ayrinti = "Bu karekod birden çok şubede kullanılıyor; hangi şubede olduğunuz "
                                  + "konumunuzdan anlaşılıyor. Konum izni verip tekrar deneyiniz."
                    });
            }
        }

        /* Özel okutma konumu (Hal gibi; 03.10.2026): karekodu panelde
           üretilen GUID, iCard'da değil bizim tabloda. Uygulama değişmedi;
           okunan metin burada çözülüyor. */
        OkutmaKurallari.Konum ozelKonum = null;

        if (sube is null)
        {
            ozelKonum = OkutmaKurallari.KonumBul(_vt, okunan);

            if (ozelKonum is not null && !ozelKonum.Aktif)
                return BadRequest(new
                {
                    hata = "Bu karekod kullanımdan kaldırıldı.",
                    ayrinti = $"{ozelKonum.Ad} okutma konumu pasif. Bilgi için İnsan Kaynakları ile görüşünüz."
                });

            if (ozelKonum is not null)
                sube = new
                {
                    subeKodu = OkutmaKurallari.KonumOneki + ozelKonum.Id,
                    subeAdi = ozelKonum.Ad,
                    enlem = (double?)ozelKonum.Enlem,
                    boylam = (double?)ozelKonum.Boylam
                };
        }

        if (sube is null)
            return BadRequest(new
            {
                hata = "Bu karekod tanınmadı.",
                ayrinti = "Mağaza girişindeki kodu okuttuğunuzdan emin olunuz."
            });

        /* ------------------------------------------ okutma kuralları

           Saha personeli her şubede, Hal/konum personeli yalnızca kendi
           konumunda okutabilir; genel ayar açıksa diğerleri yalnızca kendi
           şubesinde. Muaf personel okutursa kayıt normal düşer. */
        var karar = serbest
            ? new OkutmaKurallari.Karar(true)
            : OkutmaKurallari.YetkiDenetle(
                _vt, () => _ayar.PersonelOku(), () => _ayar.FormOku().Subeler, p,
                (string)sube.subeKodu, (string)sube.subeAdi, ozelKonum, DateTime.Today);

        if (!karar.Izin)
        {
            OkutmaKurallari.RedYaz(_vt, p, (string)sube.subeKodu, (string)sube.subeAdi,
                karar.Sebep, null, null, girdi.Enlem, girdi.Boylam, karar.Hata);

            return BadRequest(new { hata = karar.Hata, ayrinti = karar.Ayrinti });
        }

        /* ------------------------------------------ konum doğrulaması

           Şubenin konumu tanımlıysa okutma o konumdan yapılmalıdır.
           Karekod sabit olduğu için fotoğraflanıp paylaşılabiliyor;
           konum denetimi olmadan uzaktan okutma mümkün olur.

           Şubenin konumu girilmemişse denetim yapılamaz ve okutma
           geçer — aksi hâlde konumu tanımlanmamış şubelerde hiç kimse
           vardiya kaydı yapamazdı.

           Sınır eskiden sabit 150 metreydi; artık Vardiya Karekodları →
           Okutma Kuralları'ndan genel olarak ve şube/konum başına
           ayarlanıyor (varsayılan 150). */
        var SinirMetre = ozelKonum is not null
            ? OkutmaKurallari.KonumYaricapi(_vt, ozelKonum)
            : OkutmaKurallari.SubeYaricapi(_vt, (string)sube.subeKodu);

        var yerAdi = ozelKonum is not null ? "konumun" : "şubenin";

        var konumDogru = false;
        int? mesafe = null;

        var subeKonumluMu = sube.enlem is not null && sube.boylam is not null;

        if (subeKonumluMu)
        {
            if (girdi.Enlem is not double e || girdi.Boylam is not double b)
            {
                OkutmaKurallari.RedYaz(_vt, p, (string)sube.subeKodu, (string)sube.subeAdi,
                    "konum_yok", null, SinirMetre, null, null, "Konum alınamadı.");

                return BadRequest(new
                {
                    hata = "Konum alınamadı.",
                    ayrinti = "Vardiya kaydı için konum izni vermeniz gerekiyor. "
                              + "Telefon ayarlarından uygulamaya konum izni veriniz."
                });
            }

            mesafe = (int)Mesafe(e, b, (double)sube.enlem, (double)sube.boylam);
            konumDogru = mesafe <= SinirMetre;

            if (!konumDogru)
            {
                _gunluk.Yaz(
                    "UZAK KONUMDAN OKUTMA",
                    p.PersonelKodu,
                    $"{p.Ad} {p.Soyad} · {sube.subeAdi} · {mesafe} metre uzaktan denendi (sınır {SinirMetre} m).");

                OkutmaKurallari.RedYaz(_vt, p, (string)sube.subeKodu, (string)sube.subeAdi,
                    "mesafe", mesafe, SinirMetre, e, b);

                return BadRequest(new
                {
                    hata = ozelKonum is not null ? "Okutma konumundan çok uzaktasınız." : "Şubeden çok uzaktasınız.",
                    ayrinti = $"Okutma yalnızca {yerAdi} {SinirMetre} metre "
                              + $"yakınından yapılabilir. Şu an yaklaşık "
                              + $"{mesafe} metre uzaktasınız."
                });
            }
        }

        /* Son hareket: aynı kişi arka arkaya okutmasın. İki dakikadan
           kısa aralıkla ikinci okutma, yanlışlıkla ikinci kez okutmadır. */
        var son = db.QueryFirstOrDefault(@"
SELECT TOP 1 gecis_zamani AS zaman, tur
FROM KRY_VARDIYA
WHERE personel_kodu = @kod
  AND CAST(gecis_zamani AS DATE) = CAST(SYSDATETIME() AS DATE)
ORDER BY gecis_zamani DESC", new { kod = p.PersonelKodu });

        /* Yalnızca çok kısa aralıkla ikinci okutma engellenir; bu
           yanlışlıkla iki kez okutmadır. Süre iki dakikaydı ve normal
           çıkışı engelliyordu: personel giriş yapıp hemen çıkmak
           isteyebilir. Yirmi saniye bu ayrımı yapmak için yeterli. */
        if (son is not null &&
            (DateTime.Now - (DateTime)son.zaman).TotalSeconds < 20)
            return BadRequest(new
            {
                hata = "Az önce okuttunuz.",
                ayrinti = $"Son kaydınız {((DateTime)son.zaman):HH:mm} · {son.tur}. "
                          + "Birkaç saniye sonra tekrar deneyiniz."
            });

        var tur = son is not null && (string)son.tur == "Giriş" ? "Çıkış" : "Giriş";

        db.Execute(@"
INSERT INTO KRY_VARDIYA
    (personel_kodu, ad_soyad, sube_kodu, sube_adi, tur,
     enlem, boylam, konum_dogru, mesafe_metre)
VALUES (@kod, @adSoyad, @subeKodu, @subeAdi, @tur,
        @enlem, @boylam, @konumDogru, @mesafe)",
            new
            {
                kod = p.PersonelKodu,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                subeKodu = (string)sube.subeKodu,
                subeAdi = (string)sube.subeAdi,
                tur,
                enlem = girdi.Enlem,
                boylam = girdi.Boylam,
                /* Her yerden okutmada konum denetimi yok ama izinli: "konum dışı" sayılmaz */
                konumDogru = konumDogru || serbest,
                mesafe
            });

        /* Günlük özet güncellenir; aylık mesai buradan hesaplanıyor */
        db.Execute(@"
MERGE KRY_VARDIYA_GUN AS h
USING (SELECT @kod AS kod, CAST(SYSDATETIME() AS DATE) AS t) AS y
   ON h.personel_kodu = y.kod AND h.tarih = y.t
WHEN MATCHED THEN UPDATE SET
    son_cikis = (SELECT MAX(gecis_zamani) FROM KRY_VARDIYA
                 WHERE personel_kodu = @kod
                   AND CAST(gecis_zamani AS DATE) = CAST(SYSDATETIME() AS DATE)),
    sure_dakika = (SELECT ISNULL(DATEDIFF(minute,
                       MIN(gecis_zamani), MAX(gecis_zamani)), 0)
                   FROM KRY_VARDIYA
                   WHERE personel_kodu = @kod
                     AND CAST(gecis_zamani AS DATE) = CAST(SYSDATETIME() AS DATE))
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, tarih, ilk_giris, sure_dakika)
    VALUES (@kod, CAST(SYSDATETIME() AS DATE), SYSDATETIME(), 0);",
            new { kod = p.PersonelKodu });

        return Ok(new
        {
            basarili = true,
            tur,
            subeAdi = (string)sube.subeAdi,
            zaman = DateTime.Now,
            konumDogru,
            mesafe
        });
    }

    /// <summary>
    /// "08:30" biçiminde, gün içinde geçerli bir saat mi. Tek sayı ("8")
    /// TimeSpan'de gün olarak okunduğu için iki nokta zorunlu.
    /// </summary>
    public static bool SaatGecerli(string metin, out TimeSpan saat)
    {
        saat = TimeSpan.Zero;

        var m = System.Text.RegularExpressions.Regex.Match((metin ?? "").Trim(), @"^(\d{1,2}):(\d{2})$");

        if (!m.Success) return false;

        var s = int.Parse(m.Groups[1].Value);
        var d = int.Parse(m.Groups[2].Value);

        if (s > 23 || d > 59) return false;

        saat = new TimeSpan(s, d, 0);

        return true;
    }

    /// <summary>İki nokta arası mesafe (metre); Haversine.</summary>
    private static double Mesafe(double e1, double b1, double e2, double b2)
    {
        const double R = 6371000;

        var de = (e2 - e1) * Math.PI / 180;
        var db = (b2 - b1) * Math.PI / 180;

        var a = Math.Sin(de / 2) * Math.Sin(de / 2)
              + Math.Cos(e1 * Math.PI / 180) * Math.Cos(e2 * Math.PI / 180)
              * Math.Sin(db / 2) * Math.Sin(db / 2);

        return R * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    /// <summary>
    /// Personel fotoğrafı.
    ///
    /// Parametre alınmaz: her zaman oturumdaki kişinin fotoğrafı döner.
    /// Sicil numarası parametre olsaydı bir personel başkasının
    /// fotoğrafını çekebilirdi.
    /// </summary>
    [HttpGet("Resim")]
    [AllowAnonymous]
    public IActionResult Resim([FromQuery] string j)
    {
        /* Image bileşeni başlık gönderemiyor; jeton sorgu olarak gelir
           ve burada doğrulanır. Jeton geçersizse fotoğraf verilmez. */
        var kod = PersonelKodu;

        if (string.IsNullOrWhiteSpace(kod))
            kod = _jwt.PersonelKoduCoz(j);

        if (string.IsNullOrWhiteSpace(kod)) return NotFound();

        try
        {
            /* Mikro bağlantısı: varsayılan bağlantıdan o veritabanına
               erişilemiyor ve "Invalid object name" hatası veriyordu. */
            using var db = _vt.PersonelBaglantisi();

            var satir = db.QueryFirstOrDefault(@"
SELECT TOP 1 I.*
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
JOIN [MikroDesktop_2004BICEN].dbo.mye_ImageData I ON I.Record_uid = P.per_Guid
WHERE LTRIM(RTRIM(P.per_kod)) = @kod", new { kod }) as IDictionary<string, object>;

            if (satir is null) return NotFound();

            foreach (var alan in satir)
            {
                if (alan.Value is byte[] veri && veri.Length > 100)
                    return File(veri, "image/jpeg");
            }

            return NotFound();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fotoğraf okunamadı: {Kod}", kod);
            return NotFound();
        }
    }

    /// <summary>Son geçiş hareketleri.</summary>    /* ==================================================================== */
    /* Oturum                                                               */
    /* ==================================================================== */

    /// <summary>
    /// Uygulamadan çıkış.
    ///
    /// Cihaz eşleştirmesi KALDIRILMAZ, yalnızca oturum kapatılır. Aksi
    /// hâlde çıkış yapan personel aylık değişim hakkını harcamadan başka
    /// bir telefona geçebilirdi.
    /// </summary>
    [HttpPost("Cikis")]
    [Authorize(Roles = "Personel")]
    public IActionResult Cikis()
    {
        var kod = PersonelKodu;

        if (string.IsNullOrWhiteSpace(kod))
            return Ok(new { basarili = true });

        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_MOBIL_CIHAZ SET oturum_acik = 0 WHERE personel_kodu = @kod",
            new { kod });

        _oturumDenetimi.Unut(kod);

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Açık oturumun cihaz kaydını kalıcı kimliğe taşır (26.10.2026).
    ///
    /// <para>
    /// 1.10'a güncellenen uygulama ilk açılışta, oturumu açıkken bu ucu
    /// çağırır. Jetondaki cihaz kayıtlı cihazla eşleşiyorsa (OturumGecerli)
    /// kayıt yeni kimliğe alınır ve yeni kimlikli jeton döner; personel
    /// yeniden kod girmez. Böylece uygulama daha sonra silinip kurulsa da
    /// aynı kalıcı kimlikle gelir ve "başka cihaza tanımlı" hatası çıkmaz.
    /// </para>
    ///
    /// <para>
    /// Güvenlik: yalnızca kayıtlı cihazdaki geçerli oturum taşıyabilir;
    /// cihazsız eski jetonlar (1.5 öncesi) taşıyamaz. Taşıma aylık değişim
    /// hakkını harcamaz. Jeton çalınmışsa saldırgan zaten oturumu
    /// kullanabiliyordu; bu uç ona ek bir şey vermiyor.
    /// </para>
    /// </summary>
    [HttpPost("CihazKimligiTasi")]
    [Authorize(Roles = "Personel")]
    public IActionResult CihazKimligiTasi([FromBody] MobilGirisGirdi girdi)
    {
        var (kod, eski) = JetonCoz();
        var yeni = (girdi?.CihazId ?? "").Trim();

        if (string.IsNullOrWhiteSpace(kod) || string.IsNullOrWhiteSpace(eski))
            return Ok(new { tasindi = false });

        if (yeni.Length == 0 || yeni.Length > 128)
            return BadRequest(new { hata = "Cihaz tanımlanamadı." });

        if (string.Equals(eski, yeni, StringComparison.Ordinal))
            return Ok(new { tasindi = false });

        using var db = _vt.Baglanti();

        if (!OturumGecerli(db))
            return Unauthorized(new { hata = "Oturumunuz sona erdi. Yeniden giriş yapınız." });

        var guncellenen = db.Execute(@"
INSERT INTO KRY_MOBIL_CIHAZ_GECMIS
    (personel_kodu, eski_cihaz, yeni_cihaz, cihaz_adi, sebep, yapan)
SELECT personel_kodu, cihaz_id, @yeni, ISNULL(NULLIF(@ad, N''), cihaz_adi), @sebep, N'sistem'
FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod AND cihaz_id = @eski;

UPDATE KRY_MOBIL_CIHAZ
   SET cihaz_id = @yeni,
       cihaz_adi = ISNULL(NULLIF(@ad, N''), cihaz_adi),
       isletim = ISNULL(NULLIF(@isletim, N''), isletim),
       son_giris = SYSDATETIME()
 WHERE personel_kodu = @kod AND cihaz_id = @eski;",
            new
            {
                kod,
                eski,
                yeni,
                ad = girdi.CihazAdi,
                isletim = girdi.Isletim,
                sebep = CihazKimligi.TasimaSebebi
            });

        /* Execute iki komutun toplamını döner; UPDATE'in tutmadığı tek
           durum kaydın bu arada değişmiş olması (başka cihazdan giriş). */
        if (guncellenen < 2)
            return Unauthorized(new { hata = "Oturumunuz sona erdi. Yeniden giriş yapınız." });

        _kayit.LogInformation("Mobil cihaz kimliği kalıcı biçime taşındı (açık oturum): {Eski} -> {Yeni}",
            CihazKimligi.Ozet(eski), CihazKimligi.Ozet(yeni));

        var oturumGunu = int.TryParse(_yapilandirma["Mobil:OturumGunu"], out var g) && g > 0
            ? g : 365;

        var (jeton, bitis) = _jwt.Uret(new Kullanici
        {
            Id = 0,
            KullaniciAdi = $"personel:{kod}|{yeni}",
            AdSoyad = "",
            Rol = "Personel"
        }, saatAsim: oturumGunu * 24);

        return Ok(new { tasindi = true, jeton, bitis });
    }

    /* ==================================================================== */
    /* Cihaz yönetimi · panel                                               */
    /* ==================================================================== */

    /// <summary>Eşleştirilmiş cihazlar; panelden görüntülenir.</summary>
    [HttpGet("Cihazlar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult Cihazlar([FromQuery] string ara = null)
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT c.personel_kodu AS personelKodu, c.cihaz_adi AS cihazAdi,
       c.isletim, c.ilk_eslesme AS ilkEslesme, c.son_degisim AS sonDegisim,
       c.son_giris AS sonGiris, c.oturum_acik AS oturumAcik,
       DATEDIFF(day, c.son_degisim, SYSDATETIME()) AS degisimGun,
       (SELECT COUNT(*) FROM KRY_MOBIL_CIHAZ_GECMIS g
        WHERE g.personel_kodu = c.personel_kodu
          AND ISNULL(g.sebep, N'') NOT IN (" + CihazKimligi.SayimDisi + @")) AS degisimSayisi
FROM KRY_MOBIL_CIHAZ c
ORDER BY c.son_giris DESC").ToList();

        /* Ad ve şube Mikro'dan eklenir: sicil numarası tek başına
           kimin olduğunu anlatmıyor. */
        try
        {
            var personeller = _personelKaynak.TumPersonelleriGetir()
                .ToDictionary(x => (x.PersonelKodu ?? "").Trim(), x => x,
                              StringComparer.OrdinalIgnoreCase);

            var zenginlestirilmis = kayitlar.Select(k =>
            {
                var p = personeller.GetValueOrDefault((string)k.personelKodu);

                return new
                {
                    personelKodu = (string)k.personelKodu,
                    adSoyad = p is null ? null : $"{p.Ad} {p.Soyad}".Trim(),
                    gorev = p?.Pozisyon,
                    subeAdi = p?.Sube,
                    cihazAdi = (string)k.cihazAdi,
                    isletim = (string)k.isletim,
                    ilkEslesme = (DateTime)k.ilkEslesme,
                    sonDegisim = (DateTime)k.sonDegisim,
                    sonGiris = k.sonGiris,
                    /* Ayrılmış personelde (çıkış tarihi gelmiş) açık gösterilmez */
                    oturumAcik = (bool)k.oturumAcik && (p is null || p.Durum == 1),
                    degisimGun = (int)k.degisimGun,
                    degisimSayisi = (int)k.degisimSayisi
                };
            })
            .Where(x => string.IsNullOrWhiteSpace(ara) ||
                        (x.adSoyad ?? "").Contains(ara, StringComparison.OrdinalIgnoreCase) ||
                        x.personelKodu.Contains(ara, StringComparison.OrdinalIgnoreCase))
            .ToList();

            return Ok(new { kayitlar = zenginlestirilmis });
        }
        catch
        {
            return Ok(new { kayitlar });
        }
    }

    /// <summary>
    /// Cihaz eşleştirmesini kaldırabilen roller: Admin, İK Yöneticisi, İK
    /// Uzmanı (02.10.2026'da eklendi) ve Genel Müdür Yardımcısı. Özel
    /// rollerin jetonunda temel rol ikinci bir rol hakkı olarak durduğu için
    /// IsInRole onları da tanır; CihazKaldir'daki [Authorize] ile aynı liste.
    /// </summary>
    private bool CihazKaldirabilir =>
        User.IsInRole(Roller.Admin) || User.IsInRole(Roller.IKYoneticisi)
        || User.IsInRole(Roller.IK) || User.IsInRole(Roller.GenelMudurYardimcisi);

    /// <summary>
    /// Cihaz eşleştirmesini kaldırır. Personel yeni telefonundan hemen
    /// giriş yapabilir; aylık bekleme süresi uygulanmaz.
    /// </summary>
    [HttpDelete("Cihaz/{personelKodu}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult CihazKaldir(string personelKodu)
    {
        using var db = _vt.Baglanti();

        var kod = (personelKodu ?? "").Trim();

        var eski = db.ExecuteScalar<string>(
            "SELECT cihaz_id FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod",
            new { kod });

        if (eski is null)
            return NotFound(new { hata = "Bu personelin eşleştirilmiş cihazı yok." });

        db.Execute(@"
INSERT INTO KRY_MOBIL_CIHAZ_GECMIS
    (personel_kodu, eski_cihaz, yeni_cihaz, sebep, yapan)
VALUES (@kod, @eski, N'-', N'Panelden kaldırıldı', @yapan);

DELETE FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod;",
            new
            {
                kod,
                eski,
                yapan = User?.Identity?.Name ?? "sistem"
            });

        _oturumDenetimi.Unut(kod);

        return Ok(new { basarili = true });
    }

    /// <summary>Bir personelin cihaz değişim geçmişi.</summary>
    [HttpGet("CihazGecmisi/{personelKodu}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult CihazGecmisi(string personelKodu)
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT eski_cihaz AS eskiCihaz, yeni_cihaz AS yeniCihaz,
       cihaz_adi AS cihazAdi, sebep, yapan, tarih
FROM KRY_MOBIL_CIHAZ_GECMIS
WHERE personel_kodu = @kod
ORDER BY tarih DESC", new { kod = (personelKodu ?? "").Trim() }).ToList();

        return Ok(new { kayitlar });
    }

    /* ==================================================================== */
    /* Uygulama kullanımı · panel (30.09.2026)                              */
    /* ==================================================================== */

    /// <summary>Kişi bazında uygulama durumu: eşleşme, bildirim izni, son okutma.</summary>
    private sealed record UygulamaDurumuSatiri(
        string PersonelKodu, string AdSoyad, string Gorev, string SubeAdi, string Telefon,
        DateTime? GirisTarihi, bool GirisYapti, string CihazAdi, string Isletim,
        DateTime? IlkGiris, DateTime? SonGiris, bool OturumAcik, bool BildirimAcik,
        DateTime? SonOkutma, int CihazDegisimSayisi,
        string EskiSicil = null, bool Kaldirildi = false, DateTime? SonGorulme = null, string Surum = null);

    /// <summary>Sicil anahtarı: boşluksuz, baştaki sıfırlar yok</summary>
    private static string SicilAnahtari(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>
    /// Uygulama durumları (16.10.2026).
    ///
    /// <para>
    /// Cihaz eşleştirmesi sicile bağlı. İkinci kez işe giren personelin
    /// eski sicille yaptığı giriş yeni sicilde görünmüyor, personel
    /// "uygulamayı kurmamış" sayılıyordu: eşleşme yeni sicilde yoksa aynı
    /// kimlik numaralı eski sicildeki eşleşme kullanılır. Uygulamadan
    /// çıkış yapan personelin eşleşmesi zaten kalıyor (oturum kapalı
    /// olarak); panelden kaldırılan eşleşme ayrı gösterilir.
    /// </para>
    /// </summary>
    private List<UygulamaDurumuSatiri> UygulamaDurumlari(IEnumerable<PersonelKaydi> personeller)
    {
        using var db = _vt.Baglanti();

        var cihazlar = db.Query(@"
SELECT c.personel_kodu AS kod, c.cihaz_adi AS cihazAdi, c.isletim, c.ilk_eslesme AS ilk,
       c.son_giris AS son, c.oturum_acik AS acik,
       (SELECT COUNT(*) FROM KRY_MOBIL_CIHAZ_GECMIS g WHERE g.personel_kodu = c.personel_kodu
          AND ISNULL(g.sebep, N'') NOT IN (" + CihazKimligi.SayimDisi + @")) AS degisim
FROM KRY_MOBIL_CIHAZ c")
            .GroupBy(x => SicilAnahtari((string)x.kod), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var jetonlar = db.Query<string>("SELECT personel_kodu FROM KRY_MOBIL_JETON")
            .Select(SicilAnahtari)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var okutmalar = db.Query(@"
SELECT personel_kodu AS kod, MAX(gecis_zamani) AS son
FROM KRY_VARDIYA GROUP BY personel_kodu")
            .GroupBy(x => SicilAnahtari((string)x.kod), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (DateTime?)g.Max(y => (DateTime?)y.son), StringComparer.OrdinalIgnoreCase);

        /* Uygulamanın görüldüğü son zaman ve sürüm (her istekte tutuluyor) */
        var gorulme = new Dictionary<string, (DateTime Son, string Surum)>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var r in db.Query("SELECT personel_kodu AS kod, son_gorulme AS son, surum FROM KRY_UYGULAMA_SURUM"))
                gorulme[SicilAnahtari((string)r.kod)] = ((DateTime)r.son, (string)r.surum);
        }
        catch
        {
            /* Sürüm tablosu yoksa yalnızca eşleşmeye bakılır */
        }

        /* Panelden kaldırılmış eşleşmeler: son geçmiş kaydı kaldırma olan */
        var kaldirilan = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var kod in db.Query<string>(@"
SELECT g.personel_kodu FROM KRY_MOBIL_CIHAZ_GECMIS g
WHERE g.sebep = N'Panelden kaldırıldı'
  AND g.tarih = (SELECT MAX(x.tarih) FROM KRY_MOBIL_CIHAZ_GECMIS x WHERE x.personel_kodu = g.personel_kodu)"))
                kaldirilan.Add(SicilAnahtari(kod));
        }
        catch
        {
            /* Geçmiş okunamazsa kaldırma bilgisi gösterilmez */
        }

        /* Aynı kimlik numarasının bütün sicilleri (ikinci kez işe giriş) */
        var tcSicilleri = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        try
        {
            foreach (var x in _personelKaynak.TumPersonelleriGetir())
            {
                var tc = new string((x.KimlikNo ?? "").Where(char.IsDigit).ToArray());
                if (tc.Length != 11) continue;
                if (!tcSicilleri.TryGetValue(tc, out var l)) tcSicilleri[tc] = l = new();
                l.Add(SicilAnahtari(x.PersonelKodu));
            }
        }
        catch
        {
            /* Personel listesi okunamazsa yalnızca kendi sicili */
        }

        return personeller.Select(p =>
        {
            var kod = (p.PersonelKodu ?? "").Trim();
            var k = SicilAnahtari(kod);
            cihazlar.TryGetValue(k, out var c);

            string eski = null;

            if (c is null)
            {
                var tc = new string((p.KimlikNo ?? "").Where(char.IsDigit).ToArray());

                if (tc.Length == 11 && tcSicilleri.TryGetValue(tc, out var siciller))
                    foreach (var s in siciller.Where(s => !string.Equals(s, k, StringComparison.OrdinalIgnoreCase)))
                        if (cihazlar.TryGetValue(s, out var ec) && (c is null || (DateTime?)ec.son > (DateTime?)c.son))
                        {
                            c = ec;
                            eski = s;
                        }
            }

            var g = gorulme.TryGetValue(k, out var gg) ? gg : (eski != null && gorulme.TryGetValue(eski, out var ge) ? ge : default);
            var gorulduMu = g.Son != default;

            return new UygulamaDurumuSatiri(
                kod,
                $"{p.Ad} {p.Soyad}".Trim(),
                p.Pozisyon,
                p.Sube,
                p.Telefon,
                p.GirisTarihi,
                c is not null || (gorulduMu && !kaldirilan.Contains(k)),
                (string)c?.cihazAdi,
                (string)c?.isletim,
                (DateTime?)c?.ilk,
                (DateTime?)c?.son,
                /* Ayrılmış personel (çıkış tarihi gelmiş) açık gösterilmez;
                   görev saat başı bayrağı da kapatıyor (26.10.2026) */
                c is not null && eski is null && (bool)c.acik && p.Durum == 1,
                jetonlar.Contains(k),
                okutmalar.GetValueOrDefault(k),
                c is null ? 0 : Convert.ToInt32(c.degisim),
                eski,
                c is null && kaldirilan.Contains(k),
                gorulduMu ? g.Son : (DateTime?)null,
                gorulduMu ? g.Surum : null);
        }).ToList();
    }

    /// <summary>
    /// Aktif personelin Biçen360 kullanımı: kimler giriş yapmış (uygulamayı
    /// kurmuş), kimler hiç giriş yapmamış. Giriş, telefondan ilk SMS
    /// doğrulamasıyla cihaz eşleştirmesi oluşunca sayılıyor.
    /// </summary>
    [HttpGet("UygulamaKullanimi")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult UygulamaKullanimi()
    {
        var aktifler = _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        var satirlar = UygulamaDurumlari(aktifler);

        return Ok(new
        {
            olusturma = DateTime.Now,
            toplam = satirlar.Count,
            girisYapan = satirlar.Count(x => x.GirisYapti),
            bildirimAcik = satirlar.Count(x => x.BildirimAcik),
            kaldirabilir = CihazKaldirabilir,
            kisiler = satirlar.Select(x => new
            {
                personelKodu = x.PersonelKodu,
                adSoyad = x.AdSoyad,
                gorev = x.Gorev,
                subeAdi = x.SubeAdi,
                telefon = x.Telefon,
                girisTarihi = x.GirisTarihi,
                girisYapti = x.GirisYapti,
                cihazAdi = x.CihazAdi,
                isletim = x.Isletim,
                ilkGiris = x.IlkGiris,
                sonGiris = x.SonGiris,
                oturumAcik = x.OturumAcik,
                bildirimAcik = x.BildirimAcik,
                sonOkutma = x.SonOkutma,
                cihazDegisimSayisi = x.CihazDegisimSayisi,
                eskiSicil = x.EskiSicil,
                kaldirildi = x.Kaldirildi,
                sonGorulme = x.SonGorulme,
                surum = x.Surum,
            }),
        });
    }

    /// <summary>Modül kodlarının ekrandaki adları (ModulKullanimi eşlemesi)</summary>
    private static readonly Dictionary<string, string> ModulAdlari = new()
    {
        ["anasayfa"] = "Ana sayfa", ["vardiya"] = "Vardiya", ["okutma"] = "Karekod okutma",
        ["manuelgiris"] = "Manuel giriş-çıkış talebi", ["izin"] = "İzin", ["izintalebi"] = "İzin talebi gönderme",
        ["avans"] = "Avanslarım", ["avanstalebi"] = "Avans talebi gönderme", ["yonetici"] = "Yönetici (onaylar)",
        ["onay"] = "Onay / ret verme", ["ekibim"] = "Ekibim", ["fazlamesai"] = "Fazla mesai girişi",
        ["rotasyon"] = "Rotasyon talebi", ["puantaj"] = "Puantaj", ["vardiyaplani"] = "Vardiya planı",
        ["duyuru"] = "Duyurular", ["performans"] = "Performans", ["prim"] = "Prim", ["haberler"] = "Haberler",
        ["checklist"] = "Kontrol listeleri", ["isemri"] = "İş emirleri", ["bilgilerim"] = "Bilgilerim / belgeler",
        ["bicenkart"] = "Biçen Kartım", ["etik"] = "Etik hat", ["kazankazan"] = "Kazan-Kazan", ["ekipdegerlendirme"] = "Ekip değerlendirmesi", ["raporlar"] = "Raporlar", ["kunye"] = "Künye analizi",
        ["patron"] = "Patron görünümü", ["egitim"] = "Eğitimler", ["fiyatkontrol"] = "Fiyat kontrol",
        ["rakipfiyat"] = "Rakip fiyat", ["ariza"] = "Arıza kayıt", ["envanter"] = "Envanter", ["servisformu"] = "Servis formu",
    };

    /// <summary>
    /// Modül kullanımı (16.10.2026): seçilen dönemde her modülü kaç kişinin
    /// kullandığı ve kaç kez açıldığı (aynı kişi 15 dakika içinde tekrar
    /// açarsa tek sayılır). Kayıt bu sürümle başladı; öncesi yok.
    /// </summary>
    [HttpGet("ModulKullanimi")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult ModulKullanimiRaporu([FromQuery] int gun = 30, [FromQuery] string sube = null)
    {
        gun = Math.Clamp(gun, 1, 365);
        var bas = DateTime.Today.AddDays(1 - gun);

        using var db = _vt.Baglanti();
        ModulKullanimi.TabloKur(db);

        var satirlar = db.Query(@"
SELECT personel_kodu AS kod, modul, SUM(sayi) AS sayi, COUNT(*) AS gun, MAX(son) AS son
FROM KRY_MOBIL_MODUL_KULLANIM
WHERE tarih >= @bas
GROUP BY personel_kodu, modul", new { bas }).ToList();

        var gunluk = db.Query(@"
SELECT tarih, personel_kodu AS kod, modul FROM KRY_MOBIL_MODUL_KULLANIM WHERE tarih >= @bas", new { bas }).ToList();

        var ilk = db.ExecuteScalar<DateTime?>("SELECT MIN(tarih) FROM KRY_MOBIL_MODUL_KULLANIM");

        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .GroupBy(x => SicilAnahtari(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        string SubeAdi(string kod) =>
            personel.TryGetValue(SicilAnahtari(kod), out var p) && !string.IsNullOrWhiteSpace(p.Sube) ? p.Sube.Trim() : "Şubesiz";

        bool Uygun(string kod) => string.IsNullOrWhiteSpace(sube)
                                  || string.Equals(SubeAdi(kod), sube.Trim(), StringComparison.OrdinalIgnoreCase);

        var suzulmus = satirlar.Where(r => Uygun((string)r.kod)).ToList();

        var moduller = suzulmus
            .GroupBy(r => (string)r.modul)
            .Select(g => new
            {
                kod = g.Key,
                ad = ModulAdlari.GetValueOrDefault(g.Key, g.Key),
                kisi = g.Select(r => SicilAnahtari((string)r.kod)).Distinct().Count(),
                acilis = g.Sum(r => (int)r.sayi),
                kisiGun = g.Sum(r => (int)r.gun),
                son = g.Max(r => (DateTime)r.son),
                subeler = g.GroupBy(r => SubeAdi((string)r.kod))
                    .Select(sg => new { sube = sg.Key, kisi = sg.Select(r => (string)r.kod).Distinct().Count(), acilis = sg.Sum(r => (int)r.sayi) })
                    .OrderByDescending(x => x.kisi).ThenByDescending(x => x.acilis)
                    .Take(8)
                    .ToList(),
            })
            .OrderByDescending(x => x.kisi).ThenByDescending(x => x.acilis)
            .ToList();

        var gunler = gunluk.Where(r => Uygun((string)r.kod))
            .GroupBy(r => ((DateTime)r.tarih).Date)
            .Select(g => new { tarih = g.Key, kisi = g.Select(r => SicilAnahtari((string)r.kod)).Distinct().Count() })
            .OrderBy(x => x.tarih)
            .ToList();

        var subeler = satirlar
            .Select(r => SubeAdi((string)r.kod)).Distinct()
            .OrderBy(x => x, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
            .ToList();

        return Ok(new
        {
            gun,
            baslangic = bas,
            kayitBaslangici = ilk,
            aktifKisi = suzulmus.Select(r => SicilAnahtari((string)r.kod)).Distinct().Count(),
            moduller,
            gunler,
            subeler,
        });
    }

    /// <summary>Tek personelin uygulama durumu (personel kartı) ve cihaz geçmişi.</summary>
    [HttpGet("UygulamaDurumu/{personelKodu}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult UygulamaDurumu(string personelKodu)
    {
        var kod = (personelKodu ?? "").Trim();

        var p = _personelKaynak.TumPersonelleriGetir()
                    .Where(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(x => x.Durum == 1)
                    .FirstOrDefault()
                ?? new PersonelKaydi { PersonelKodu = kod };

        var d = UygulamaDurumlari(new[] { p }).First();

        using var db = _vt.Baglanti();

        var gecmis = db.Query(@"
SELECT TOP 10 cihaz_adi AS cihazAdi, sebep, yapan, tarih
FROM KRY_MOBIL_CIHAZ_GECMIS WHERE personel_kodu = @kod ORDER BY tarih DESC", new { kod }).ToList();

        return Ok(new
        {
            girisYapti = d.GirisYapti,
            cihazAdi = d.CihazAdi,
            isletim = d.Isletim,
            ilkGiris = d.IlkGiris,
            sonGiris = d.SonGiris,
            oturumAcik = d.OturumAcik,
            bildirimAcik = d.BildirimAcik,
            sonOkutma = d.SonOkutma,
            cihazDegisimSayisi = d.CihazDegisimSayisi,
            kaldirabilir = CihazKaldirabilir,
            gecmis,
        });
    }

    /* ==================================================================== */
    /* Yazarkasa (PosBack)                                                  */
    /* ==================================================================== */

    /// <summary>
    /// Personelin kendi yazarkasa kullanıcı kodu ve şifresi.
    ///
    /// <para>
    /// Eşleştirme <b>kimlik numarası</b> üzerinden yapılır ve numara
    /// oturumdan alınır; istemciden parametre kabul edilmez. Aksi hâlde
    /// personel numara deneyerek başkasının şifresini okuyabilirdi.
    /// </para>
    /// </summary>
    [HttpGet("Yazarkasa")]
    [Authorize(Roles = "Personel")]
    public IActionResult Yazarkasa()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var kimlik = new string((p.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11)
            return Ok(new { kayitVar = false, sebep = "Kimlik numaranız personel kaydında eksik." });

        try
        {
            using var db = _vt.PosBaglantisi();

            var satir = db.QueryFirstOrDefault(@"
SELECT TOP 1 PERNO, ADSOYAD, GOREV, SIFRE, [NO], AKTIF
FROM [PosBack].[dbo].[PERTT005]
WHERE LTRIM(RTRIM(TCNO)) = @kimlik", new { kimlik });

            if (satir is null)
                return Ok(new { kayitVar = false, sebep = "Yazarkasa kaydınız bulunamadı." });

            var no = SayiyaCevir(satir.NO);

            return Ok(new
            {
                kayitVar = true,
                kullaniciKodu = (satir.PERNO?.ToString() ?? "").Trim(),
                sifre = (satir.SIFRE?.ToString() ?? "").Trim(),
                adSoyad = (satir.ADSOYAD?.ToString() ?? "").Trim(),
                gorev = (satir.GOREV?.ToString() ?? "").Trim(),
                no,
                yetkiAdi = no == 5 ? "Yönetici" : no == 1 ? "Kasiyer" : "Tanımsız",
                onayYetkisi = no == 5,
                aktif = AktifMi(satir.AKTIF)
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yazarkasa kaydı okunamadı: {Kod}", p.PersonelKodu);

            /* Konsol günlüğü IIS altında kayboluyor; sebebi güvenlik
               günlüğüne yazıyoruz, panelden okunabilsin. */
            _gunluk.Yaz("YAZARKASA HATA",
                IstemciAdresi.Bul(HttpContext),
                $"Okuma başarısız (sicil {p.PersonelKodu}): {hata.Message}");

            return StatusCode(503, new
            {
                hata = "Yazarkasa sistemine şu anda ulaşılamıyor.",
                ayrinti = "Biraz sonra tekrar deneyiniz."
            });
        }
    }

    /// <summary>
    /// PERTT005 alanları farklı türlerde tutulabiliyor (bit, char, int).
    /// Dönüşümü katı yapmak, tek bir sütun türü yüzünden ekranın tamamen
    /// açılmamasına yol açıyordu.
    /// </summary>
    private static int SayiyaCevir(object deger)
    {
        if (deger is null) return 0;

        var metin = deger.ToString()?.Trim() ?? "";

        return int.TryParse(metin, out var sonuc) ? sonuc : 0;
    }

    /// <summary>Aktiflik alanı: 1/0, true/false, E/H hepsi kabul edilir.</summary>
    private static bool AktifMi(object deger)
    {
        if (deger is null) return true;

        var metin = (deger.ToString() ?? "").Trim().ToUpperInvariant();

        /* Boş bırakılmış kayıtları pasif saymıyoruz: alan doldurulmamış
           olabilir, personeli boşuna endişelendirmeyelim. */
        if (metin.Length == 0) return true;

        return metin is "1" or "TRUE" or "E" or "EVET" or "A" or "AKTIF";
    }

    /// <summary>Yazarkasa şifresini değiştirir. Dört hane, yalnızca rakam.</summary>
    [HttpPost("YazarkasaSifre")]
    [Authorize(Roles = "Personel")]
    public IActionResult YazarkasaSifre([FromBody] YazarkasaSifreGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var yeni = (girdi?.YeniSifre ?? "").Trim();

        /* Yazarkasa yalnızca dört haneli rakam kabul ediyor; kuralı
           sunucuda da uyguluyoruz, uygulamadaki denetim tek başına
           koruma sağlamaz. */
        if (yeni.Length != 4 || !yeni.All(char.IsDigit))
            return BadRequest(new { hata = "Şifre dört haneli olmalı ve yalnızca rakam içermelidir." });

        var kimlik = new string((p.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11)
            return BadRequest(new { hata = "Kimlik numaranız personel kaydında eksik." });

        try
        {
            using var db = _vt.PosBaglantisi();

            /* Kimlik numarasına göre günceller: oturumdaki kişinin kendi
               satırından başkasına dokunamaz. */
            var etkilenen = db.Execute(@"
UPDATE [PosBack].[dbo].[PERTT005]
SET SIFRE = @yeni
WHERE LTRIM(RTRIM(TCNO)) = @kimlik", new { yeni, kimlik });

            if (etkilenen == 0)
                return NotFound(new { hata = "Yazarkasa kaydınız bulunamadı." });

            _gunluk.Yaz("YAZARKASA ŞİFRE",
                IstemciAdresi.Bul(HttpContext),
                $"Sicil {p.PersonelKodu} kendi yazarkasa şifresini değiştirdi");

            return Ok(new { tamam = true });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yazarkasa şifresi değiştirilemedi: {Kod}", p.PersonelKodu);

            _gunluk.Yaz("YAZARKASA HATA",
                IstemciAdresi.Bul(HttpContext),
                $"Şifre değişikliği başarısız (sicil {p.PersonelKodu}): {hata.Message}");

            return StatusCode(503, new
            {
                hata = "Şifre değiştirilemedi.",
                ayrinti = "Yazarkasa sistemine ulaşılamıyor olabilir; biraz sonra deneyiniz."
            });
        }
    }

    /// <summary>
    /// Panel: yazarkasa bağlantısını sınar ve hatayı olduğu gibi döner.
    ///
    /// Personele dönen mesaj bilerek geneldir; sorunun nerede olduğunu
    /// görmek için bu uç kullanılır. Yalnızca yöneticiye açıktır.
    /// </summary>
    [HttpGet("YazarkasaSina")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult YazarkasaSina()
    {
        var adimlar = new List<object>();

        try
        {
            adimlar.Add(new { adim = "Bağlantı cümlesi okunuyor", tamam = true });

            using var db = _vt.PosBaglantisi();

            db.Open();
            adimlar.Add(new { adim = "Sunucuya bağlanıldı", tamam = true });

            var sayi = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [PosBack].[dbo].[PERTT005]");

            adimlar.Add(new { adim = $"Tablo okundu ({sayi} kayıt)", tamam = true });

            var tcDolu = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM [PosBack].[dbo].[PERTT005]
WHERE TCNO IS NOT NULL AND LTRIM(RTRIM(TCNO)) <> ''");

            adimlar.Add(new { adim = $"TCNO dolu olan kayıt: {tcDolu}", tamam = true });

            return Ok(new { tamam = true, adimlar });
        }
        catch (Exception hata)
        {
            adimlar.Add(new { adim = hata.Message, tamam = false });

            return Ok(new
            {
                tamam = false,
                adimlar,
                hata = hata.Message,
                tur = hata.GetType().Name
            });
        }
    }

    /* ==================================================================== */
    /* İş emirleri                                                          */
    /* ==================================================================== */

    /// <summary>
    /// Personele atanan iş emirleri.
    ///
    /// Kişiye doğrudan atanan işler ve panel hesabına atanan işler birlikte.
    /// </summary>
    [HttpGet("IsEmirlerim")]
    [Authorize(Roles = "Personel")]
    public IActionResult IsEmirlerim([FromQuery] bool tumu = false)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var hesaplar = PanelHesaplari(db, p);

        /* Hem mağaza personeli olarak hem panel hesabıyla atanan işler
           aynı listede: kişi ikisini ayrı yerlerde aramasın. */
        var liste = db.Query(@"
SELECT id, baslik, aciklama, oncelik, atayan_ad AS atayanAd,
       kaynak_baslik AS kaynakBaslik, durum, son_tarih AS sonTarih,
       goruldu, sonuc, bitis_tarihi AS bitisTarihi, olusturma,
       atanan_tur AS atananTur, icerik, doldurma, ilerleme
FROM KRY_IS_EMRI
WHERE ((atanan_tur = 'personel' AND atanan_kod = @kod)
       OR (atanan_tur = 'panel' AND atanan_kod IN @hesaplar))
  AND (@tumu = 1 OR durum NOT IN ('Bitti', 'İptal'))
ORDER BY CASE durum WHEN 'Yeni' THEN 0 WHEN 'Görüldü' THEN 1 ELSE 2 END,
         olusturma DESC",
            new
            {
                kod = (p.PersonelKodu ?? "").Trim(),
                /* Boş liste IN yan tümcesini bozar; eşleşmeyecek bir değer. */
                hesaplar = hesaplar.Count > 0 ? hesaplar : new List<string> { "__yok__" },
                tumu
            }).ToList();

        return Ok(new
        {
            liste,
            acikSayi = liste.Count(x => x.durum != "Bitti" && x.durum != "İptal"),

            /* Uygulama açılışındaki açılır pencere yalnızca hiç görülmemiş
               emirler için gösterilir; her açılışta tekrar çıkmasın. */
            yeniler = liste.Where(x => x.goruldu == false).ToList()
        });
    }

    /// <summary>
    /// Bu personelin panel hesabı (varsa) kullanıcı adları.
    ///
    /// Panel kullanıcısına atanan bir iş emrinin, aynı kişinin mobil
    /// uygulamasında da görünmesi gerekiyor. İki kayıt arasında doğrudan
    /// bir bağ yok; cep telefonunun son on hanesi üzerinden eşleştirilir.
    /// Telefonu kayıtlı olmayan panel kullanıcısı için eşleşme kurulamaz.
    /// </summary>
    private static List<string> PanelHesaplari(
        System.Data.IDbConnection db, PersonelKaydi p)
    {
        var telefon = new string((p.Telefon ?? "").Where(char.IsDigit).ToArray());

        if (telefon.Length < 10) return new List<string>();

        var son10 = telefon[^10..];

        return db.Query<string>(@"
SELECT kullanici_adi FROM KRY_KULLANICILAR
WHERE aktif = 1 AND telefon IS NOT NULL
  AND RIGHT(REPLACE(REPLACE(REPLACE(telefon, ' ', ''), '(', ''), ')', ''), 10) = @son10",
            new { son10 }).ToList();
    }

    /// <summary>İş emrini görüldü işaretler.</summary>
    /// <summary>
    /// İş içeriğini doldurur.
    ///
    /// Panelde kurulan çizelgenin kilitli olmayan hücreleri buradan
    /// işaretleniyor. Kilit denetimi istemcide görünürlük, sunucuda ise
    /// sahiplik düzeyinde: kaydı yalnızca atanan kişi doldurabiliyor.
    /// </summary>
    [HttpPost("IsEmriDoldur/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult IsEmriDoldur(int id, [FromBody] MobilDoldurmaGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        /* Panel hesabına atanan işler de doldurulabiliyor.

           Liste hem personel hem panel ataması olan işleri gösteriyor ama
           doldurma yalnızca personel atamasını kabul ediyordu: kişi
           listedeki işi açıp çizelgeyi dolduruyor, kaydederken "iş
           bulunamadı" hatası alıyordu. İki yerde aynı koşul olmalı. */
        var hesaplar = PanelHesaplari(db, p);

        var etkilenen = db.Execute(@"
UPDATE KRY_IS_EMRI
SET doldurma = @doldurma, ilerleme = @ilerleme, doldurma_tarihi = SYSDATETIME(),

    /* İlk doldurmada iş kendiliğinden ilerliyor; personel çizelgeyi
       işaretleyip durumu ayrıca değiştirmeyi unutuyordu. */
    durum = CASE WHEN durum IN (N'Yeni', N'Görüldü') THEN N'Devam ediyor' ELSE durum END
WHERE id = @id
  AND ((atanan_tur = 'personel' AND atanan_kod = @kod)
       OR (atanan_tur = 'panel' AND atanan_kod IN @hesaplar))
  AND durum <> N'İptal'",
            new
            {
                id,
                kod = (p.PersonelKodu ?? "").Trim(),
                hesaplar = hesaplar.Count > 0 ? hesaplar : new List<string> { "__yok__" },
                doldurma = girdi?.Doldurma,
                ilerleme = girdi?.Ilerleme is >= 0 and <= 100 ? girdi.Ilerleme : 0
            });

        if (etkilenen == 0)
            return BadRequest(new
            {
                hata = "İş bulunamadı ya da doldurulamaz.",
                ayrinti = "İş size atanmamış olabilir ya da iptal edilmiş olabilir."
            });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Mobilden iş atanabilecek kişiler.
    ///
    /// Yalnızca kendi şubesindeki personel: mağaza müdürü başka şubeye iş
    /// atamamalı, merkez atamaları panelden yapılıyor.
    /// </summary>
    /// <summary>
    /// Mobil İK raporu.
    ///
    /// <para>
    /// Başvuru, işe alım, vardiya ve oryantasyon özetleri tek istekte.
    /// Telefon dört ayrı istek atıp dört bekleme göstermemeli; hesap
    /// sunucuda yapılıp hazır sayılar dönüyor.
    /// </para>
    ///
    /// <para>
    /// Yalnızca İK rolündeki panel kullanıcıları görüyor. Mağaza
    /// personeli bu uca erişemiyor: başvuru ve işe alım sayıları
    /// kurum geneli bilgi.
    /// </para>
    /// </summary>
    [HttpGet("IKRapor")]
    [Authorize(Roles = "Personel")]
    public IActionResult IKRapor(
        [FromQuery] int gun = 30,
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (gun is < 1 or > 365) gun = 30;

        using var db = _vt.Baglanti();

        if (!IKRaporYetkisi(db, p))
            return StatusCode(403, new
            {
                hata = "İK raporlarına yetkiniz yok.",
                ayrinti = "Yetki: Yönetim → Yetkiler → Mobil → İK Raporları."
            });

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-gun + 1);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1);

        /* ----------------------------------------------------- başvuru */

        var basvurular = db.Query(@"
SELECT durum, sube_adi AS subeAdi, kaynak, olusturma,
       ise_giris_tarihi AS iseGiris
FROM KRY_BASVURULAR
WHERE olusturma >= @baslangic AND olusturma < @bitis
  AND ISNULL(arsiv, 0) = 0", new { baslangic, bitis }).ToList();

        List<object> Grupla(IEnumerable<dynamic> kayitlar, string alan, int enCok = 8) =>
            kayitlar
                .GroupBy(x => (string)((IDictionary<string, object>)x)[alan] ?? "Belirtilmemiş")
                .Select(g => new { ad = g.Key, deger = g.Count() })
                .OrderByDescending(x => x.deger)
                .Take(enCok)
                .Cast<object>()
                .ToList();

        int Say(IEnumerable<dynamic> k, params string[] durumlar) =>
            k.Count(x => durumlar.Contains((string)x.durum ?? ""));

        var gunluk = Enumerable.Range(0, gun)
            .Select(i => baslangic.AddDays(i))
            .Select(g => new
            {
                etiket = g.ToString("dd.MM"),
                deger = basvurular.Count(x => ((DateTime)x.olusturma).Date == g)
            })
            .ToList();

        /* ------------------------------------------------ işe alım, çıkış */

        var iseAlinan = basvurular.Count(x => (string)x.durum == Durumlar.IseAlindi);

        /* Ayrılanlar Mikro'dan; başvuru tablosunda çıkış bilgisi yok. */
        var ayrilan = 0;
        var yeniGiren = 0;

        try
        {
            using var mikro = _vt.PersonelBaglantisi();

            ayrilan = mikro.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE per_cikis_tar >= @baslangic AND per_cikis_tar < @bitis",
                new { baslangic, bitis }, commandTimeout: 30);

            yeniGiren = mikro.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE per_giris_tar >= @baslangic AND per_giris_tar < @bitis",
                new { baslangic, bitis }, commandTimeout: 30);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Mikro personel hareketleri okunamadı");
        }

        /* ----------------------------------------------------- vardiya */

        var vardiya = db.Query(@"
SELECT sube_adi AS subeAdi, tur, gecis_zamani AS gecis,
       CASE WHEN enlem IS NULL THEN 1 ELSE 0 END AS konumsuz
FROM KRY_VARDIYA
WHERE gecis_zamani >= @baslangic AND gecis_zamani < @bitis",
            new { baslangic, bitis }).ToList();

        /* -------------------------------------------------- oryantasyon */

        var uyum = db.Query(@"
SELECT asama, tur, dolduruldu
FROM KRY_UYUM_ANKET
WHERE olusturma >= @baslangic AND olusturma < @bitis AND test_mi = 0",
            new { baslangic, bitis }).ToList();

        return Ok(new
        {
            gun,

            /* Durum adları Durumlar sınıfından alınıyor.

               Önce elle yazılmıştı ve "Değerlendiriliyor" diye var olmayan
               bir durum sayılıyordu; İncelendi, Onay Bekliyor ve İşe Alındı
               hiçbir sayıya girmiyordu. Sonuç: toplam tutuyor ama
               kırılımların hepsi eksik çıkıyordu. */
            basvuru = new
            {
                toplam = basvurular.Count,

                yeni = Say(basvurular,
                    Durumlar.Yeni, Durumlar.Incelendi, Durumlar.Degerlendirmede),

                gorusme = Say(basvurular, Durumlar.GorusmeTalebi),

                olumlu = Say(basvurular,
                    Durumlar.Olumlu, Durumlar.EvrakHazirlaniyor, Durumlar.OnayBekliyor),

                iseAlinan,
                olumsuz = Say(basvurular, Durumlar.Olumsuz),
                gunluk,
                subeler = Grupla(basvurular, "subeAdi"),
                kaynaklar = Grupla(basvurular, "kaynak", 6)
            },

            hareket = new { yeniGiren, ayrilan, iseAlinan },

            /* Tür değerleri "Giriş" ve "Çıkış" olarak saklanıyor; küçük
               harfle arandığı için bütün sayılar sıfır çıkıyordu. */
            vardiya = new
            {
                toplam = vardiya.Count,
                giris = vardiya.Count(x => (string)x.tur == "Giriş"),
                cikis = vardiya.Count(x => (string)x.tur == "Çıkış"),
                konumsuz = vardiya.Count(x => (int)x.konumsuz == 1),
                subeler = Grupla(vardiya, "subeAdi", 10)
            },

            uyumOzet = new
            {
                gonderilen = uyum.Count,
                dolduruldu = uyum.Count(x => x.dolduruldu is not null),
                bekleyen = uyum.Count(x => x.dolduruldu is null),
                calisan = uyum.Count(x => (string)x.tur == "calisan"),
                yonetici = uyum.Count(x => (string)x.tur == "yonetici")
            }
        });
    }

    /// <summary>
    /// İK raporu kırılımının ayrıntısı.
    ///
    /// <para>
    /// Rapordaki bir satıra ya da pasta diliminine dokunulunca o satırı
    /// oluşturan kayıtlar dönüyor. Yetki denetimi İK raporuyla aynı:
    /// raporu göremeyen ayrıntıyı da göremiyor.
    /// </para>
    /// </summary>
    /// <summary>
    /// İK raporu yetkisi.
    ///
    /// <para>
    /// Portal yetki tablosundan okunuyor: kişi, ünvan, ünvanın grubu
    /// sırasıyla. Kişiye özel tanım ünvanı, ünvan da grubu eziyor.
    /// Rapor ve kırılım uçları aynı denetimi kullanıyor; ayrı yazılsaydı
    /// biri değişip diğeri geride kalırdı.
    /// </para>
    /// </summary>
    private bool IKRaporYetkisi(System.Data.IDbConnection db, PersonelKaydi p)
    {
        var pozisyon = (p.Pozisyon ?? "").Trim();

        var grup = db.ExecuteScalar<string>(@"
SELECT TOP 1 ad FROM KRY_POZISYON_GRUBU
WHERE aktif = 1
  AND N',' + REPLACE(pozisyonlar, N', ', N',') + N',' LIKE N'%,' + @pozisyon + N',%'",
            new { pozisyon });

        /* Dinamik okuma: Dapper demet alanlarını sütun adlarıyla
           güvenilir biçimde eşlemiyor ve satırlar boş geliyordu. */
        var satirlar = db.Query(@"
SELECT kapsam, anahtar, izin FROM B360_YETKI
WHERE alan = 'mobil' AND kod = 'ikrapor'").ToList();

        bool? Bak(string kapsam, string anahtar)
        {
            if (string.IsNullOrWhiteSpace(anahtar)) return null;

            foreach (var satir in satirlar)
            {
                if (!string.Equals((string)satir.kapsam, kapsam,
                        StringComparison.OrdinalIgnoreCase)) continue;

                if (!string.Equals(((string)satir.anahtar ?? "").Trim(), anahtar.Trim(),
                        StringComparison.OrdinalIgnoreCase)) continue;

                return (bool)satir.izin;
            }

            return null;
        }

        return Bak("kullanici", p.PersonelKodu)
            ?? Bak("pozisyon", pozisyon)
            ?? Bak("grup", grup)
            ?? false;
    }

    [HttpGet("IKRaporKirilim")]
    [Authorize(Roles = "Personel")]
    public IActionResult IKRaporKirilim(
        [FromQuery] string bolum,
        [FromQuery] string alan,
        [FromQuery] string deger,
        [FromQuery] int gun = 30,
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (gun is < 1 or > 365) gun = 30;

        using var db = _vt.Baglanti();

        if (!IKRaporYetkisi(db, p))
            return StatusCode(403, new { hata = "İK raporlarına yetkiniz yok." });

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-gun + 1);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1);

        /* Sütun adı listeden seçiliyor: dışarıdan gelen metni doğrudan
           sorguya koymak enjeksiyon riski. */
        var sutun = (bolum, alan) switch
        {
            ("basvuru", "sube") => "sube_adi",
            ("basvuru", "durum") => "durum",
            ("basvuru", "kaynak") => "kaynak",

            ("vardiya", "sube") => "sube_adi",
            ("vardiya", "tur") => "tur",

            ("uyum", "asama") => "asama",
            ("uyum", "tur") => "tur",

            _ => null
        };

        if (sutun is null)
            return BadRequest(new { hata = "Bu kırılım desteklenmiyor." });

        var girdi = new { baslangic, bitis, deger = (deger ?? "").Trim() };

        if (bolum == "basvuru")
        {
            var kayitlar = db.Query($@"
SELECT TOP 200 id, basvuru_no AS basvuruNo, ad_soyad AS adSoyad,
       telefon, sube_adi AS subeAdi, bolumler, durum, kaynak, olusturma
FROM KRY_BASVURULAR
WHERE olusturma >= @baslangic AND olusturma < @bitis
  AND ISNULL(arsiv, 0) = 0
  AND ISNULL(NULLIF(LTRIM(RTRIM({sutun})), N''), N'Belirtilmemiş') = @deger
ORDER BY olusturma DESC", girdi).ToList();

            return Ok(new { kayitlar, adet = kayitlar.Count, tip = "basvuru" });
        }

        if (bolum == "vardiya")
        {
            var kayitlar = db.Query($@"
SELECT TOP 200 id, personel_kodu AS personelKodu, ad_soyad AS adSoyad,
       sube_adi AS subeAdi, tur, gecis_zamani AS gecis,
       CASE WHEN enlem IS NULL THEN 1 ELSE 0 END AS konumsuz
FROM KRY_VARDIYA
WHERE gecis_zamani >= @baslangic AND gecis_zamani < @bitis
  AND ISNULL(NULLIF(LTRIM(RTRIM({sutun})), N''), N'Belirtilmemiş') = @deger
ORDER BY gecis_zamani DESC", girdi).ToList();

            return Ok(new { kayitlar, adet = kayitlar.Count, tip = "vardiya" });
        }

        if (bolum == "uyum")
        {
            var kayitlar = db.Query($@"
SELECT TOP 200 id, kod, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       asama, tur, puan, dolduruldu, olusturma
FROM KRY_UYUM_ANKET
WHERE olusturma >= @baslangic AND olusturma < @bitis AND test_mi = 0
  AND ISNULL(NULLIF(LTRIM(RTRIM({sutun})), N''), N'Belirtilmemiş') = @deger
ORDER BY olusturma DESC", girdi).ToList();

            return Ok(new { kayitlar, adet = kayitlar.Count, tip = "uyum" });
        }

        return BadRequest(new { hata = "Bu bölüm desteklenmiyor." });
    }

    /* ==================================================================== */
    /* Gift kart                                                            */
    /* ==================================================================== */

    /// <summary>
    /// Personelin gift kartı: bakiye, ödeme kodu ve hareketler.
    ///
    /// <para>
    /// Ödeme kodu sunucuda saklanmıyor; yazarkasa aynı algoritmayı kendi
    /// tarafında çalıştırıp karşılaştırıyor. Kod gün boyunca sabit.
    /// </para>
    /// </summary>
    [HttpGet("GiftKart")]
    [Authorize(Roles = "Personel")]
    public IActionResult GiftKartOku()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        /* Toplu yüklemeden sonra aynı anda yüzlerce açılış: kısa önbellek (21.10.2026) */
        if (GiftKartOnbellek.Oku(p.PersonelKodu) is { } onbellek) return Ok(onbellek);

        GiftKart kart;

        try
        {
            kart = _giftKart.Getir(p.Telefon, p.PersonelKodu);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Gift kart okunamadı");

            /* Yazarkasa veritabanı ayrı sunucuda; bağlantı sorunları
               burada görünür olmalı, yoksa özellik hiç gelmemiş gibi
               duruyor. */
            return StatusCode(503, new
            {
                hata = "Kart bilgilerine şu anda ulaşılamıyor.",
                ayrinti = hata.Message
            });
        }

        if (kart is null)
        {
            /* Aranan numara yanıtta: kart bulunamadığında sebebin
               personel kaydındaki telefon mu yoksa kart tarafı mı olduğu
               başka türlü anlaşılmıyordu. Numara maskeli. */
            var aranan = new string((p.Telefon ?? "").Where(char.IsDigit).ToArray());

            var maske = aranan.Length >= 4
                ? new string('•', Math.Max(aranan.Length - 4, 0)) + aranan[^4..]
                : aranan.Length == 0 ? "kayıtlı değil" : aranan;

            return Ok(new
            {
                kartVar = false,
                bilgi = "Adınıza tanımlı bir gift kart bulunamadı. "
                      + $"Aranan numara: {maske}. "
                      + "Kartınız sistemde kayıtlı cep telefonunuzla eşleşiyor; "
                      + "numaranız güncel değilse İnsan Kaynakları ile görüşünüz."
            });
        }

        var cevap = new
        {
            kartVar = true,
            kartNo = kart.KartNo,

            /* Tam numara gösterilmiyor: ekran görüntüsü paylaşıldığında
               kart numarasının açıkta kalmaması gerekiyor. */
            maskeli = kart.KartNo.Length >= 4
                ? "•••• " + kart.KartNo[^4..]
                : kart.KartNo,

            kart.Bakiye,
            kart.MobilKart,
            kart.SifreVar,
            kart.BakiyeOkunabildi,

            kod = GiftKartServisi.Kod(p.Telefon, kart.KartNo),

            /* Kod gün sonunda değişiyor; ekrandaki geri sayım buna göre. */
            gecerlilik = DateTime.Today.AddDays(1),

            hareketler = _giftKart.Hareketler(kart.KartNo)
        };

        /* Bakiye okunamadıysa saklanmaz: bir sonraki açılış yeniden dener */
        if (kart.BakiyeOkunabildi) GiftKartOnbellek.Yaz(p.PersonelKodu, kart.KartNo, cevap);

        return Ok(cevap);
    }

    /// <summary>
    /// Kart kullanım biçimini değiştirir: mobil ödeme ya da fiziki kart.
    /// </summary>
    [HttpPost("GiftKartGrup")]
    [Authorize(Roles = "Personel")]
    public IActionResult GiftKartGrup([FromBody] GiftKartGrupGirdi girdi)
    {
        GiftKartOnbellek.KisiDegisti(Kendisi()?.PersonelKodu);

        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kart = _giftKart.Getir(p.Telefon, p.PersonelKodu);

        if (kart is null)
            return BadRequest(new { hata = "Adınıza tanımlı bir kart bulunamadı." });

        var (basarili, hata) = _giftKart.GrupDegistir(kart.KartNo, girdi?.Mobil ?? true, girdi?.Sifre);

        return basarili ? Ok(new { basarili = true }) : BadRequest(new { hata });
    }

    /// <summary>
    /// Kartı personelin üzerine tanımlar ya da alışveriş tercihini
    /// değiştirir.
    ///
    /// <para>
    /// Uygulamadaki "Kartı güncelle" bu uca geliyor. Kart numarası
    /// boş bırakılırsa yalnızca tercih değişiyor; numara verilirse
    /// kart o numaraya bağlanıyor. Tercih doğrudan GrupNo:
    /// mobil 608, fiziki NULL.
    /// </para>
    /// </summary>
    [HttpPost("GiftKartGuncelle")]
    [Authorize(Roles = "Personel")]
    public IActionResult GiftKartGuncelle([FromBody] GiftKartBagGirdi girdi)
    {
        GiftKartOnbellek.KisiDegisti(Kendisi()?.PersonelKodu);

        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kartNo = new string((girdi?.KartNo ?? "").Where(char.IsDigit).ToArray());

        /* Numara yazılmadıysa tanımlı kart üzerinden gidiliyor: ekranda
           yalnızca tercih değiştirilmiş demektir. */
        if (kartNo.Length == 0)
        {
            var mevcut = _giftKart.Getir(p.Telefon, p.PersonelKodu);

            if (mevcut is null)
                return BadRequest(new { hata = "Biçen kart numaranızı yazınız ya da barkodu okutunuz." });

            kartNo = mevcut.KartNo;
        }

        var mobil = girdi?.Mobil ?? true;

        try
        {
            var (basarili, hata) = _giftKart.KartBagla(
                kartNo, p.Telefon, $"{p.Ad} {p.Soyad}".Trim(), mobil, girdi?.Sifre);

            return basarili
                ? Ok(new { basarili = true, kartNo, mobilKart = mobil })
                : BadRequest(new { hata });
        }
        catch (Exception istisna)
        {
            _kayit.LogError(istisna, "Kart güncellenemedi");

            return StatusCode(503, new
            {
                hata = "Kart veritabanına ulaşılamıyor.",
                ayrinti = istisna.Message
            });
        }
    }

    /// <summary>
    /// Kartı personelin üzerinden kaldırır; puan geçmişi kartta kalıyor.
    /// </summary>
    [HttpPost("GiftKartKaldir")]
    [Authorize(Roles = "Personel")]
    public IActionResult GiftKartKaldir()
    {
        GiftKartOnbellek.KisiDegisti(Kendisi()?.PersonelKodu);

        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kart = _giftKart.Getir(p.Telefon, p.PersonelKodu);

        if (kart is null)
            return BadRequest(new { hata = "Adınıza tanımlı bir kart bulunamadı." });

        try
        {
            var (basarili, hata) = _giftKart.KartKaldir(kart.KartNo, p.Telefon);

            return basarili ? Ok(new { basarili = true }) : BadRequest(new { hata });
        }
        catch (Exception istisna)
        {
            _kayit.LogError(istisna, "Kart kaldırılamadı");

            return StatusCode(503, new
            {
                hata = "Kart veritabanına ulaşılamıyor.",
                ayrinti = istisna.Message
            });
        }
    }

    /// <summary>
    /// Kart tanısı: yazmanın hangi sunucuya ve hangi karta gittiğini
    /// gösterir. Sorun ararken tahmin yürütmek yerine bakılacak yer.
    /// </summary>
    [HttpGet("GiftKartTani")]
    [Authorize(Roles = "Personel")]
    public IActionResult GiftKartTani()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        try
        {
            return Ok(_giftKart.Tani(p.Telefon));
        }
        catch (Exception istisna)
        {
            _kayit.LogError(istisna, "Kart tanısı alınamadı");

            return StatusCode(503, new
            {
                hata = "Kart veritabanına ulaşılamıyor.",
                ayrinti = istisna.Message
            });
        }
    }

    /// <summary>Kart şifresini değiştirir.</summary>
    [HttpPost("GiftKartSifre")]
    [Authorize(Roles = "Personel")]
    public IActionResult GiftKartSifre([FromBody] GiftKartSifreGirdi girdi)
    {
        GiftKartOnbellek.KisiDegisti(Kendisi()?.PersonelKodu);

        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var kart = _giftKart.Getir(p.Telefon, p.PersonelKodu);

        if (kart is null)
            return BadRequest(new { hata = "Adınıza tanımlı bir kart bulunamadı." });

        var (basarili, hata2) = _giftKart.SifreDegistir(kart.KartNo, girdi?.Sifre);

        return basarili
            ? Ok(new { basarili = true })
            : BadRequest(new { hata = hata2 });
    }

    [HttpGet("IsAtanabilecekler")]
    [Authorize(Roles = "Personel")]
    public IActionResult IsAtanabilecekler()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var durum = IsAtamaDurumu(p);

        if (!durum.yetki)
            return Ok(new { yetki = false, sebep = durum.sebep, kisiler = new List<object>() });

        var kisiler = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .Where(x => PersonelKaynagiServisi.Benziyor(x.IsGrubu ?? "", p.IsGrubu ?? ""))
            .Where(x => (x.PersonelKodu ?? "") != (p.PersonelKodu ?? ""))
            .OrderBy(x => $"{x.Ad} {x.Soyad}")
            .Select(x => new
            {
                kod = (x.PersonelKodu ?? "").Trim(),
                ad = $"{x.Ad} {x.Soyad}".Trim(),
                gorev = x.Pozisyon
            })
            .ToList();

        return Ok(new { yetki = true, kisiler });
    }

    /// <summary>
    /// Mobilden iş atar.
    ///
    /// <para>
    /// Mağaza müdürü tezgâhın başındayken işi telefondan verebilmeli;
    /// paneli açmak için ofise gitmesi, işin hiç kaydedilmemesine yol
    /// açıyordu.
    /// </para>
    /// </summary>
    [HttpPost("IsEmriAta")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> IsEmriAta([FromBody] MobilIsGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (!IsAtayabilir(p))
            return StatusCode(403, new { hata = "İş atama yetkiniz yok." });

        if (string.IsNullOrWhiteSpace(girdi?.Baslik))
            return BadRequest(new { hata = "Başlık giriniz." });

        if (string.IsNullOrWhiteSpace(girdi?.AtananKod))
            return BadRequest(new { hata = "Kişi seçiniz." });

        var hedef = _personelKaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim() == girdi.AtananKod.Trim());

        if (hedef is null) return BadRequest(new { hata = "Kişi bulunamadı." });

        /* Kendi şubesi dışına atama engelleniyor: liste zaten süzülü ama
           uç doğrudan da çağrılabilir. */
        if (!PersonelKaynagiServisi.Benziyor(hedef.IsGrubu ?? "", p.IsGrubu ?? ""))
            return StatusCode(403, new
            {
                hata = "Yalnızca kendi şubenizdeki personele iş atayabilirsiniz."
            });

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IS_EMRI
    (baslik, aciklama, oncelik, atanan_tur, atanan_kod, atanan_ad,
     atayan, atayan_ad, durum, son_tarih, icerik)
OUTPUT INSERTED.id
VALUES (@baslik, @aciklama, @oncelik, 'personel', @atananKod, @atananAd,
        @atayan, @atayanAd, N'Yeni', @sonTarih, @icerik)",
            new
            {
                baslik = girdi.Baslik.Trim(),
                aciklama = girdi.Aciklama,
                oncelik = string.IsNullOrWhiteSpace(girdi.Oncelik) ? "Normal" : girdi.Oncelik,
                atananKod = (hedef.PersonelKodu ?? "").Trim(),
                atananAd = $"{hedef.Ad} {hedef.Soyad}".Trim(),

                /* Atayan mobil oturum biçiminde yazılıyor; panelde bu
                   kaydı düzenleyebilecek bir hesap yok, bilerek. */
                atayan = $"personel:{(p.PersonelKodu ?? "").Trim()}",
                atayanAd = $"{p.Ad} {p.Soyad}".Trim(),
                sonTarih = girdi.SonTarih,
                icerik = girdi.Icerik
            });

        try
        {
            await _bildirim.Gonder(
                (hedef.PersonelKodu ?? "").Trim(),
                "Yeni iş emri",
                $"{girdi.Baslik.Trim()} · {$"{p.Ad} {p.Soyad}".Trim()}",
                "isemri");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İş emri bildirimi gönderilemedi");
        }

        return Ok(new { id, basarili = true });
    }

    /// <summary>
    /// Mobilden iş atayabilir mi.
    ///
    /// Mağaza müdürü ve müdür yardımcısı atayabiliyor: vardiyayı onlar
    /// yönetiyor ve işin sahibi onlar.
    /// </summary>
    /// <summary>
    /// Mobilden iş atayabilir mi.
    ///
    /// <para>
    /// Yetki, kişinin ünvanının bağlı olduğu pozisyon grubundan geliyor:
    /// Yönetim → Çalışma Düzeni → Pozisyon Grupları ekranındaki
    /// "mobilden iş atayabilsin" kutusu. Daha önce ünvan adında "müdür"
    /// ya da "şef" aranıyordu; ünvanında bu sözcükler geçmeyen ama işi
    /// atayan kişiler düğmeyi hiç göremiyordu, üstelik kuruma göre
    /// değişen bir listeyi koda ya da ayar dosyasına yazmak her kurulumda
    /// tekrar eden bir iş çıkarıyordu.
    /// </para>
    /// </summary>
    private bool IsAtayabilir(PersonelKaydi p) => IsAtamaDurumu(p).yetki;

    /// <summary>
    /// İş atama yetkisi ve yetki yoksa sebebi.
    ///
    /// Sebep ekranda gösteriliyor: "düğme görünmüyor" şikâyetinde ünvanın
    /// gruba bağlı olmaması ile grubun yetkisinin kapalı olması farklı
    /// çözümler istiyor ve ikisini ayırt etmenin başka yolu yoktu.
    /// </summary>
    private (bool yetki, string sebep) IsAtamaDurumu(PersonelKaydi p)
    {
        var unvan = (p?.Pozisyon ?? "").Trim();
        var hedef = PersonelKaynagiServisi.MeslekAnahtari(unvan);

        if (hedef.Length == 0)
            return (false, "Personel kaydınızda ünvan tanımlı değil.");

        try
        {
            using var db = _vt.Baglanti();

            var gruplar = db.Query(@"
SELECT ad, pozisyonlar, is_atayabilir AS isAtayabilir
FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad").ToList();

            if (gruplar.Count == 0)
                return (false, "Henüz pozisyon grubu tanımlanmamış (Yönetim → Çalışma Düzeni).");

            foreach (var g in gruplar)
            {
                var uyuyor = ((string)g.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries
                             | StringSplitOptions.TrimEntries)
                    .Any(x => PersonelKaynagiServisi.MeslekAnahtari(x) == hedef);

                if (!uyuyor) continue;

                return (bool)g.isAtayabilir
                    ? (true, null)
                    : (false, $"\"{(string)g.ad}\" grubunda iş atama yetkisi kapalı.");
            }

            return (false, $"\"{unvan}\" ünvanı hiçbir pozisyon grubuna bağlı değil.");
        }
        catch (Exception hata)
        {
            /* Grup tanımı okunamazsa yetki verilmiyor: iş atama başkası
               adına kayıt açmak demek ve şüphede kalınan yerde açık
               bırakmak doğru değil. */
            _kayit.LogWarning(hata, "Pozisyon grubu okunamadı");

            return (false, "Yetki tanımları okunamadı.");
        }
    }

    [HttpPost("IsEmriGordum/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult IsEmriGordum(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var hesaplar = PanelHesaplari(db, p);

        var etkilenen = db.Execute(@"
UPDATE KRY_IS_EMRI
SET goruldu = 1, goruldu_tarih = SYSDATETIME(),
    durum = CASE WHEN durum = 'Yeni' THEN 'Görüldü' ELSE durum END
WHERE id = @id
  AND ((atanan_tur = 'personel' AND atanan_kod = @kod)
       OR (atanan_tur = 'panel' AND atanan_kod IN @hesaplar))",
            new
            {
                id,
                kod = (p.PersonelKodu ?? "").Trim(),
                hesaplar = hesaplar.Count > 0 ? hesaplar : new List<string> { "__yok__" }
            });

        return etkilenen == 0
            ? NotFound(new { hata = "İş emri bulunamadı." })
            : Ok(new { tamam = true });
    }

    /// <summary>İş emrini bitirir; açıklama zorunludur.</summary>
    [HttpPost("IsEmriBitir/{id:int}")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> IsEmriBitir(int id, [FromBody] IsEmriBitirGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var sonuc = (girdi?.Sonuc ?? "").Trim();

        if (sonuc.Length == 0)
            return BadRequest(new { hata = "Yaptığınız işi açıklayınız." });

        using var db = _vt.Baglanti();

        var hesaplar = PanelHesaplari(db, p);

        var emir = db.QueryFirstOrDefault(@"
SELECT id, baslik, atayan FROM KRY_IS_EMRI
WHERE id = @id
  AND ((atanan_tur = 'personel' AND atanan_kod = @kod)
       OR (atanan_tur = 'panel' AND atanan_kod IN @hesaplar))
  AND durum NOT IN ('Bitti', 'İptal')",
            new
            {
                id,
                kod = (p.PersonelKodu ?? "").Trim(),
                hesaplar = hesaplar.Count > 0 ? hesaplar : new List<string> { "__yok__" }
            });

        if (emir is null)
            return NotFound(new { hata = "İş emri bulunamadı ya da zaten kapanmış." });

        var kisi = $"{p.Ad} {p.Soyad}".Trim();

        db.Execute(@"
UPDATE KRY_IS_EMRI
SET durum = 'Bitti', sonuc = @sonuc, bitiren_ad = @ad,
    bitis_tarihi = SYSDATETIME(), goruldu = 1
WHERE id = @id", new { id, sonuc, ad = kisi });

        /* Atayana haber: panel çanı ve e-posta. Bildirim hatası işin
           bitmesini geri almamalı. */
        try
        {
            var atayan = (string)emir.atayan;
            var baslik = (string)emir.baslik;

            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, 'is_emri_bitti', @baslik, @metin)",
                new
                {
                    kullanici = atayan,
                    baslik = "İş emri tamamlandı",
                    metin = $"{kisi}: {baslik} — {sonuc}"
                });

            var eposta = db.ExecuteScalar<string>(
                "SELECT eposta FROM KRY_KULLANICILAR WHERE kullanici_adi = @kod",
                new { kod = atayan });

            if (!string.IsNullOrWhiteSpace(eposta))
            {
                await _mail.GonderAsync(
                    new[] { eposta },
                    $"İş emri tamamlandı: {baslik}",
                    $"<p><b>{kisi}</b> atadığınız iş emrini tamamladı.</p>"
                    + $"<p><b>İş:</b> {baslik}</p>"
                    + $"<p><b>Açıklama:</b><br>{sonuc.Replace("\n", "<br>")}</p>");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İş emri bildirimi gönderilemedi: {Id}", id);
        }

        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Kontrol listeleri                                                    */
    /* ==================================================================== */

    /// <summary>
    /// Personelin bugün doldurabileceği kontrol listeleri.
    ///
    /// Hedef kitle pozisyona göre belirlenir; şube sınırı varsa ayrıca
    /// süzülür. Saat aralığı tanımlıysa aralık dışında liste görünür ama
    /// doldurulamaz — personel neyi ne zaman yapacağını görsün.
    /// </summary>
    [HttpGet("Checklistlerim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Checklistlerim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var bugun = DateTime.Today;
        var saat = DateTime.Now.Hour;

        var listeler = db.Query(@"
SELECT c.id, c.baslik, c.aciklama, c.pozisyonlar, c.subeler, c.siklik,
       c.bas_saat AS basSaat, c.bit_saat AS bitSaat,
       (SELECT COUNT(*) FROM KRY_CHECKLIST_MADDE m WHERE m.checklist_id = c.id)
           AS maddeSayisi,
       d.id AS doldurmaId, d.tamamlandi
FROM KRY_CHECKLIST c
    LEFT JOIN KRY_CHECKLIST_DOLDURMA d
        ON d.checklist_id = c.id AND d.personel_kodu = @kod AND d.gun = @gun
WHERE c.aktif = 1
ORDER BY c.baslik", new { kod = (p.PersonelKodu ?? "").Trim(), gun = bugun })
            .Where(c => Hedefte((string)c.pozisyonlar, p.Pozisyon)
                     && Hedefte((string)c.subeler, p.IsGrubu))
            .Select(c => new
            {
                c.id,
                c.baslik,
                c.aciklama,
                c.siklik,
                c.maddeSayisi,
                c.doldurmaId,
                tamamlandi = c.tamamlandi ?? false,
                acikMi = SaatUygun(c.basSaat, c.bitSaat, saat),
                saatAraligi = c.basSaat is null || c.bitSaat is null
                    ? null
                    : $"{c.basSaat:00}:00 - {c.bitSaat:00}:00"
            })
            .ToList();

        return Ok(new
        {
            listeler,
            bekleyen = listeler.Count(x => x.tamamlandi == false)
        });
    }

    /// <summary>Bir listenin maddeleri ve personelin verdiği cevaplar.</summary>
    [HttpGet("Checklist/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult Checklist(int id)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();

        var liste = db.QueryFirstOrDefault(@"
SELECT id, baslik, aciklama, bas_saat AS basSaat, bit_saat AS bitSaat
FROM KRY_CHECKLIST WHERE id = @id AND aktif = 1", new { id });

        if (liste is null) return NotFound(new { hata = "Liste bulunamadı." });

        var doldurmaId = db.ExecuteScalar<int?>(@"
SELECT id FROM KRY_CHECKLIST_DOLDURMA
WHERE checklist_id = @id AND personel_kodu = @kod AND gun = @gun",
            new { id, kod = (p.PersonelKodu ?? "").Trim(), gun = DateTime.Today });

        var maddeler = db.Query(@"
SELECT m.id, m.sira, m.soru, m.gorsel_zorunlu AS gorselZorunlu,
       m.yorum_zorunlu AS yorumZorunlu,
       v.cevap, v.yorum, v.iade, v.iade_notu AS iadeNotu,
       (SELECT COUNT(*) FROM KRY_CHECKLIST_GORSEL g
        WHERE g.madde_id = m.id AND g.doldurma_id = @doldurmaId AND g.silindi = 0)
           AS gorselSayisi
FROM KRY_CHECKLIST_MADDE m
    LEFT JOIN KRY_CHECKLIST_CEVAP v
        ON v.madde_id = m.id AND v.doldurma_id = @doldurmaId
WHERE m.checklist_id = @id
ORDER BY m.sira, m.id", new { id, doldurmaId = doldurmaId ?? 0 });

        return Ok(new
        {
            liste,
            doldurmaId,
            acikMi = SaatUygun(liste.basSaat, liste.bitSaat, DateTime.Now.Hour),
            maddeler
        });
    }

    /// <summary>Bir maddeyi cevaplar. Doldurma kaydı yoksa açılır.</summary>
    [HttpPost("ChecklistCevap")]
    [Authorize(Roles = "Personel")]
    public IActionResult ChecklistCevap([FromBody] ChecklistCevapGirdi girdi)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        if (girdi is null || girdi.MaddeId <= 0)
            return BadRequest(new { hata = "Madde belirtiniz." });

        using var db = _vt.Baglanti();

        var doldurmaId = DoldurmaAc(db, p, girdi.ChecklistId);

        db.Execute(@"
MERGE KRY_CHECKLIST_CEVAP AS h
USING (SELECT @doldurmaId AS d, @maddeId AS m) AS k
    ON h.doldurma_id = k.d AND h.madde_id = k.m
WHEN MATCHED THEN
    /* Yeniden cevaplandıysa iade kalkar: personel istenen düzeltmeyi yaptı */
    UPDATE SET cevap = @cevap, yorum = @yorum, iade = 0,
               guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (doldurma_id, madde_id, cevap, yorum)
    VALUES (@doldurmaId, @maddeId, @cevap, @yorum);",
            new
            {
                doldurmaId,
                maddeId = girdi.MaddeId,
                cevap = girdi.Cevap,
                yorum = girdi.Yorum
            });

        TamamlanmaGuncelle(db, doldurmaId, girdi.ChecklistId);

        return Ok(new { doldurmaId, tamam = true });
    }

    /// <summary>Bir maddeye fotoğraf ekler.</summary>
    [HttpPost("ChecklistGorsel")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(12_000_000)]
    public async Task<IActionResult> ChecklistGorsel(
        [FromForm] int checklistId, [FromForm] int maddeId, IFormFile dosya)
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Dosya boş." });

        using var db = _vt.Baglanti();

        var doldurmaId = DoldurmaAc(db, p, checklistId);

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        var klasor = Path.Combine(kok, "checklist");

        if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

        var ad = $"{doldurmaId}_{maddeId}_{Guid.NewGuid():N}.jpg";

        await using (var akis = new FileStream(Path.Combine(klasor, ad), FileMode.Create))
        {
            await dosya.CopyToAsync(akis);
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CHECKLIST_GORSEL (doldurma_id, madde_id, dosya)
OUTPUT INSERTED.id VALUES (@doldurmaId, @maddeId, @ad)",
            new { doldurmaId, maddeId, ad });

        return Ok(new { id, doldurmaId, tamam = true });
    }

    /// <summary>Doldurma kaydını açar ya da var olanı döner.</summary>
    private int DoldurmaAc(System.Data.IDbConnection db, PersonelKaydi p, int checklistId)
    {
        var kod = (p.PersonelKodu ?? "").Trim();

        var mevcut = db.ExecuteScalar<int?>(@"
SELECT id FROM KRY_CHECKLIST_DOLDURMA
WHERE checklist_id = @checklistId AND personel_kodu = @kod AND gun = @gun",
            new { checklistId, kod, gun = DateTime.Today });

        if (mevcut is int varOlan) return varOlan;

        return db.ExecuteScalar<int>(@"
INSERT INTO KRY_CHECKLIST_DOLDURMA
    (checklist_id, personel_kodu, ad_soyad, sube_adi, gorev, gun)
OUTPUT INSERTED.id
VALUES (@checklistId, @kod, @ad, @sube, @gorev, @gun)",
            new
            {
                checklistId,
                kod,
                ad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = p.IsGrubu,
                gorev = p.Pozisyon,
                gun = DateTime.Today
            });
    }

    /// <summary>Tüm maddeler cevaplandıysa doldurma tamamlanmış sayılır.</summary>
    private static void TamamlanmaGuncelle(
        System.Data.IDbConnection db, int doldurmaId, int checklistId)
    {
        db.Execute(@"
UPDATE KRY_CHECKLIST_DOLDURMA
SET tamamlandi = CASE WHEN
        (SELECT COUNT(*) FROM KRY_CHECKLIST_MADDE WHERE checklist_id = @checklistId) =
        (SELECT COUNT(*) FROM KRY_CHECKLIST_CEVAP
         WHERE doldurma_id = @doldurmaId AND cevap IS NOT NULL AND iade = 0)
    THEN 1 ELSE 0 END,
    guncelleme = SYSDATETIME()
WHERE id = @doldurmaId", new { doldurmaId, checklistId });
    }

    /// <summary>Virgüllü hedef listesi boşsa herkes kapsanır.</summary>
    private static bool Hedefte(string tanim, string deger)
    {
        if (string.IsNullOrWhiteSpace(tanim)) return true;

        return tanim.Split(',')
            .Select(x => x.Trim())
            .Any(x => x.Equals((deger ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
    }

    private static bool SaatUygun(dynamic bas, dynamic bit, int saat)
    {
        if (bas is null || bit is null) return true;

        int b = Convert.ToInt32(bas), s = Convert.ToInt32(bit);

        return saat >= b && saat < s;
    }

    /* ==================================================================== */
    /* Modüller                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Uygulamadaki modüllerin tanımı.
    ///
    /// Tek yerde tutulur: panel yetki ekranı ve mobil menü aynı listeyi
    /// kullanır, biri değişip diğeri unutulmasın.
    /// </summary>
    public static readonly (string Kod, string Ad, string Aciklama, string Simge)[]
        Moduller =
    {
        ("vardiya", "Vardiya", "Karekod okutarak giriş çıkış", "kare"),
        ("izin", "İzin Yönetimi", "Bakiye, geçmiş ve izin talebi", "takvim"),
        ("performans", "Performansım", "Puan ve ölçüt kırılımı", "grafik"),
        ("prim", "Prim Hak Edişi", "Geçmiş ayların primleri", "para"),
        ("duyuru", "Duyurular", "Şirket duyuruları ve bildirimler", "zil"),
        ("isemri", "İşlerim", "Size atanan iş emirleri", "liste"),
        ("checklist", "Kontrol Listeleri", "Doldurmanız gereken kontroller", "belge"),
        ("kunye", "Künye Analizi", "Rakip künyesi okut, alış fiyatını karşılaştır", "kare"),

        /* Haftalık izin onayı: mağaza yöneticisinin ekranı.

           Personelin seçtiği izin günleri buraya düşüyor; yönetici
           onaylıyor ya da sebep yazıp reddediyor. Ekran eskiden
           Bilgilerim'in içinde bir bölümdü ve kimse orada arayamıyordu. */
        /* Yönetici İşlemleri (12.10.2026): kod aynı kaldı (portal yetkileri
           ve bildirimler bu kodla). 1.7 ekranı kategorili; 1.6 aynı ekranı
           eski başlıkla açıyor. */
        ("izinonay", "Yönetici İşlemleri", "İzin, avans ve fazla mesai talepleri, onaylar ve süreçleri", "onay"),

        /* Puantaj: yöneticinin ekibinin, bölge müdürünün mağazalarının
           vardiya giriş-çıkışı. Ekibim: ekip arkadaşları; yönetici
           ayrıntıyı da görür. Kapsam İK'nın izin onay tablosundan. */
        ("puantaj", "Puantaj Çizelgesi", "Ekibinizin vardiya giriş ve çıkışları", "takvim"),
        ("ekibim", "Ekibim", "Ekip arkadaşlarınız", "kisi"),

        /* Vardiya planı: yönetici ekibinin haftasını kurar, personel
           kendi planını görür ve onaylar. Herkese açık. */
        ("vardiyaplani", "Vardiya Planı", "Haftalık vardiya planınız", "takvim"),

        /* Ekranı yok: yalnızca ana sayfadaki "Bu Ay Mesai" kutusunun
           görünürlüğünü belirliyor, menüde çıkmıyor. */
        ("mesaiozet", "Bu Ay Mesai kutusu", "Ana sayfadaki mesai saati özeti", "takvim"),

        /* Etik hat eskiden uygulamada sabit yazılıydı ve gizlenemiyordu */
        ("etik", "Etik Hat", "Gizli ya da anonim bildirim", "uyari"),

        /* Avans (06.10.2026): ekranı uygulamanın 1.6 sürümünde. Eski
           sürümlere menüde gösterilmiyor (Modullerim, sürüm başlığı). */
        ("avans", "Avanslarım", "Avans talebi ve kesinti planı", "para"),

        /* Biçen'den Haberler (08.10.2026): şirket içi akış, Kasada bu
           hafta ve anketler. Ekranı 1.7'de; tanımsızken herkese açık. */
        ("haberler", "Biçen'den Haberler", "Şirket içi haber akışı, kampanya ve anketler", "kalp"),

        /* Kazan-Kazan (20.10.2026): yeni ürün önerisiyle altın ödül.
           Ekranı 1.8'de; tanımsızken herkese açık. */
        ("kazankazan", "Kazan-Kazan", "Yeni ürün öner, altın kazan", "kupa"),

        /* Dönemsel değerlendirme (20.10.2026): mağaza müdürü 3 ayda bir
           ekibini değerlendirir. Yalnızca değerlendirme yapabilene; 1.8. */
        ("ekipdegerlendirme", "Ekip değerlendirmesi", "Ekibini 3 ayda bir değerlendir", "ekip"),

        /* Mesajlar ve devamsızlık girişi (23.10.2026): ekranları 1.9'da.
           Tanımsızken KAPALI (PortalYetkiServisi.VarsayilanKapali). */
        ("mesajlar", "Mesajlar", "Birebir ve grup mesajlaşma", "mesaj"),
        ("devamsizlik", "Devamsızlık Girişi", "Vardiya girişi yapmayan ekibine devamsızlık gir", "uyari"),

        /* İcralarım (30.10.2026): personelin kendi maaş haczi / nafaka
           dosyaları. Ekranı 1.11'de. Tanımsızken yalnız icra dosyası olan
           personelde görünür (IcraVar); portaldan gruba/kişiye açılıp
           kapatılabilir. */
        ("icralarim", "İcralarım", "Maaş haczi ve nafaka dosyalarınız, sıra ve kesintiler", "belge"),

        /* Yeni modül eklerken: buraya bir satır yazmak yeterli. Uygulamada
           karşılığı olan bir ekran yoksa menüde "yakında" uyarısı çıkar,
           o yüzden ekran hazır olmadan eklenmemeli. */
    };

    /// <summary>
    /// Alt menüye alınabilecek portal modülleri.
    ///
    /// <para>
    /// Bunların yetkisi Biçen360 tarafından veriliyor ve bu listede
    /// yalnızca alt menü seçimi için duruyorlar. Alt menü ayarı Kariyer
    /// tarafında tutulduğu için seçenekleri de buradan sunmak gerekiyor;
    /// aksi halde portalda açılan bir modül sekmeye alınamıyordu.
    /// </para>
    /// </summary>
    public static readonly (string Kod, string Ad)[] PortalModulleri =
    {
        ("ariza", "Arıza Bildirimi"),
        ("rakipfiyat", "Rakip Fiyat"),
        ("fiyatkontrol", "Fiyat Kontrol"),
        ("envanter", "Envanter"),
        ("rapor", "Raporlar"),
    };

    /// <summary>
    /// Kişinin görebileceği modüller.
    ///
    /// Yetki pozisyona göre verilir: aynı görevdeki herkes aynı şeyi
    /// görür. Kişi bazlı yetki, personel değiştikçe bakımı imkânsız
    /// hâle geliyor.
    /// </summary>
    [HttpGet("Modullerim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Modullerim()
    {
        var p = Kendisi();

        if (p is null)
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var gorev = (p.Pozisyon ?? "").Trim();
        var sicil = (p.PersonelKodu ?? "").Trim();

        /* Yetki portaldan.

           Mobil modül yetkileri Biçen360 yetki ekranına taşındı: aynı
           yetkiyi iki panelde tutmak, birini güncelleyip diğerini
           unutmaya açıktı ve hangisinin geçtiği belirsizdi. Çözüm sırası
           orada da aynı: kişi → ünvan → grup.

           Portal okunamazsa eski ayar yedek olarak kullanılıyor; mobil
           menü portal yüzünden boş kalmamalı. */
        var portalAcik = _portalYetki.AcikModuller(
            sicil, gorev, Moduller.Select(m => m.Kod));

        /* İzin onayı ekranı herkese açık olamaz: varsayılanı diğer
           modüllerden farklı. Portalda tanım varsa o geçerli, yoksa
           ünvan kuralına düşüyor. */
        /* Sıra: kişiye özel ya da grup modül yetkisi (izinonay) →
           grubun onay ayarı (haftalık ya da yıllık onay veriyorsa) →
           ünvan kuralı. Grup ayarında onay verilmiş birinin onay
           ekranını bulamaması, ayarın hiç işlemediği izlenimi veriyordu. */
        var grupAyari = _portalYetki.Ayar(gorev);

        /* Yıllık izin onayı organizasyon şemasından: kişinin kutusu izin
           onaylıyor ve altında kutu varsa onaylayıcı. Haftalık izin onayı
           grup ayarından. İkisinden biri yeterli. */
        var onaylayabilir = _portalYetki.Acik(sicil, gorev, "izinonay")
            ?? (_orgOnay.OnaylayiciMi(gorev, sicil)
                || (grupAyari is not null ? grupAyari.HaftalikIzinOnay : OnayUnvani(gorev)));

        /* Avans onay tablosunda onaylayan (08.10.2026): avanslar İzin
           Onayları ekranında; portalda kapatılmış olsa da bekleyen avansı
           varsa ekran açılıyor ki talep sahipsiz kalmasın. */
        if (!onaylayabilir)
            onaylayabilir = HttpContext?.RequestServices.GetService<AvansOnayZinciri>()?.OnayciMi(sicil, gorev) ?? false;

        /* Fazla mesai giren yönetici (12.10.2026, 1.7): onaylayıcı olmasa da
           girdiği fazla mesailerin sürecini Yönetici İşlemleri'nde görüyor.
           Portalda açıkça kapatıldıysa (Acik == false) açılmıyor. */
        if (!onaylayabilir && SurumEnAz(1, 7) && _portalYetki.Acik(sicil, gorev, "izinonay") is null)
        {
            try
            {
                using var dbFm = _vt.Baglanti();
                onaylayabilir = dbFm.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_FAZLA_MESAI
WHERE LTRIM(RTRIM(talep_eden)) = @sicil AND olusturma >= DATEADD(DAY, -120, SYSDATETIME())",
                    new { sicil }) > 0;
            }
            catch
            {
                /* tablo yoksa ekran kapalı kalır */
            }
        }

        /* Puantaj yalnızca yöneticide: sorumlu olduğu kişi ya da bölgesi
           varsa. Portalda açıkça verilmişse o geçerli. */
        /* Herkese açık: yönetici ekibini, bölge müdürü mağazalarını,
           personel yalnızca kendi çizelgesini görüyor. */
        var puantajVarsayilan = true;

        var acik = Moduller
            .Where(m => m.Kod == "etik"
                /* Tanımsızken herkese açık: bildirimin önündeki en büyük
                   engel nereye başvurulacağının bilinmemesi. */
                ? (_portalYetki.Acik(sicil, gorev, "etik") ?? true)
                : m.Kod == "haberler"
                ? (_portalYetki.Acik(sicil, gorev, "haberler") ?? true)
                : m.Kod == "kazankazan"
                ? (_portalYetki.Acik(sicil, gorev, "kazankazan") ?? true)
                : m.Kod == "ekipdegerlendirme"
                ? (_portalYetki.Acik(sicil, gorev, "ekipdegerlendirme")
                   ?? ((HttpContext?.RequestServices.GetService<DonemselDegerlendirmeServisi>()?.DegerlendirebilirMi(_ekip.Kisi(sicil)) ?? false)
                       /* 26.10.2026: bölge müdürü şubelerinin değerlendirmelerini görür */
                       || _ekip.BolgeSubeleri(_ekip.Kisi(sicil)).Count > 0))
                : m.Kod == "puantaj"
                ? (_portalYetki.Acik(sicil, gorev, "puantaj") ?? puantajVarsayilan)
                : m.Kod == "izinonay"
                ? onaylayabilir
                /* İcra (30.10.2026): dosyası olana kendiliğinden; portal ayarı üstün */
                : m.Kod == "icralarim"
                ? (_portalYetki.Acik(sicil, gorev, "icralarim") ?? IcraVar(sicil))
                /* İK panel hesabı olan kişi mesajlarını telefonda da görür */
                : m.Kod == "mesajlar"
                ? _portalYetki.AcikMi(sicil, gorev, "mesajlar")
                : portalAcik is not null
                    ? portalAcik.Contains(m.Kod)
                    : EskiYetki(m.Kod, gorev))
            /* Ekranı yeni sürümde olan modüller eski uygulamaya gönderilmiyor:
               menüde "yakında" diye çıkıyordu. */
            .Where(m => m.Kod != "avans" || SurumEnAz(1, 6))
            .Where(m => m.Kod != "haberler" || SurumEnAz(1, 7))
            .Where(m => m.Kod != "kazankazan" || SurumEnAz(1, 8))
            .Where(m => m.Kod != "ekipdegerlendirme" || SurumEnAz(1, 8))
            .Where(m => (m.Kod != "mesajlar" && m.Kod != "devamsizlik") || SurumEnAz(1, 9))
            .Where(m => m.Kod != "icralarim" || SurumEnAz(1, 11))
            .Select(m => new { kod = m.Kod, ad = m.Ad, aciklama = m.Aciklama, simge = m.Simge })
            .ToList();

        /* Alt menüde görünecekler; kalanı 'Diğer' altında toplanır */
        var altMenu = _portalYetki.AltMenu()
            ?? new List<string> { "vardiya", "duyuru", "performans" };

        return Ok(new
        {
            moduller = acik,
            altMenu = altMenu.Where(x => acik.Any(m => m.kod == x)).ToList(),
            gorev,

            /* Patron görünümü (03.10.2026): Yönetim → Patron Görünümü'nde
               seçilen kişi. Uygulamanın 1.5 sürümü bu bayrakla yönetim
               ekranını açacak; eski sürümler alanı yok sayar. */
            patron = HttpContext?.RequestServices.GetService<PatronServisi>()
                ?.PatronMu(p.PersonelKodu, p.KimlikNo) ?? false,

            kisi = new
            {
                personelKodu = p.PersonelKodu,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                subeAdi = p.Sube
            }
        });
    }

    /// <summary>
    /// Uygulama sürümü (X-Uygulama-Surum başlığı, 1.6'dan itibaren
    /// gönderiliyor) en az verilen sürüm mü. Başlık yoksa eski sürüm.
    /// </summary>
    private bool SurumEnAz(int ana, int alt)
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();

        if (string.IsNullOrWhiteSpace(ham)) return false;

        var p = ham.Trim().Split('.');

        if (!int.TryParse(p[0], out var a)) return false;

        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;

        return a > ana || (a == ana && b >= alt);
    }

    /// <summary>
    /// İzin onayı için eski ünvan kuralı.
    ///
    /// Ünvanda "müdür" geçip "yardımcı" geçmiyorsa onaylar. Portalda tanım
    /// yoksa bu geçerli; tanımsızı kapalı saymak, yetki ekranına hiç
    /// girilmemiş kurumda bütün onayları durdururdu.
    /// </summary>
    private static bool OnayUnvani(string gorev)
    {
        var poz = PersonelKaynagiServisi.MeslekAnahtari(gorev ?? "");

        return poz.Contains("mudur") && !poz.Contains("yardimci");
    }

    /// <summary>
    /// Portal okunamadığında kullanılan eski kural.
    ///
    /// Ayardaki pozisyon listesi boşsa ya da kod hiç tanımlı değilse modül
    /// açık sayılıyordu; o davranış korunuyor. Ayar ekranı kaldırıldı ama
    /// var olan kayıt hâlâ okunabiliyor.
    /// </summary>
    private bool EskiYetki(string kod, string gorev)
    {
        var yetkiler = _ayar.FormOku().MobilModulYetkileri ?? new();

        var varsayilan = !PortalYetkiServisi.VarsayilanKapali.Contains(kod);

        if (!yetkiler.TryGetValue(kod, out var pozisyonlar)) return varsayilan;

        if (pozisyonlar is null || pozisyonlar.Count == 0) return varsayilan;

        return pozisyonlar.Any(x =>
            string.Equals(x?.Trim(), gorev, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Panel: modül listesi ve mevcut yetkiler.</summary>
    [HttpGet("ModulYetkileri")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult ModulYetkileri()
    {
        var ayar = _ayar.FormOku();

        /* Pozisyonlar personel kayıtlarından toplanır: elle liste tutmak
           yeni görev eklendiğinde unutuluyor. */
        var pozisyonlar = new List<string>();

        try
        {
            pozisyonlar = _personelKaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.Pozisyon))
                .Select(x => x.Pozisyon.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Pozisyon listesi alınamadı");
        }

        return Ok(new
        {
            moduller = Moduller.Select(m => new
            {
                kod = m.Kod,
                ad = m.Ad,
                aciklama = m.Aciklama
            }),

            /* Alt menü seçenekleri: İK modülleri ve portal modülleri.
               Yetki ekranı yalnızca İK modüllerini gösteriyor, portal
               modüllerinin yetkisi Biçen360'ta veriliyor. */
            altMenuAdaylari = Moduller
                .Select(m => new { kod = m.Kod, ad = m.Ad })
                .Concat(PortalModulleri.Select(m => new { kod = m.Kod, ad = m.Ad }))
                .ToList(),

            pozisyonlar,
            yetkiler = ayar.MobilModulYetkileri ?? new(),
            altMenu = ayar.MobilAltMenu is { Count: > 0 }
                ? ayar.MobilAltMenu
                : new List<string> { "vardiya", "duyuru", "performans" }
        });
    }

    /// <summary>
    /// Alt menü ayarı: portaldan okunup yazılıyor.
    ///
    /// <para>
    /// Ayar Kariyer'in form ayarlarında tutuluyor ve mobil uygulama
    /// buradan okuyor. Portala kopyalamak veriyi iki yerde tutmak
    /// olurdu; onun yerine portal bu uca yazıyor, tek kaynak korunuyor.
    /// </para>
    ///
    /// <para>
    /// Seçenekler İK ve portal modüllerini birlikte veriyor: portalda
    /// açılan bir modülün sekmeye alınamaması, ayarın orada olmamasından
    /// kaynaklanıyordu.
    /// </para>
    /// </summary>
    [HttpGet("AltMenu")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult AltMenuOku()
    {
        var ayar = _ayar.FormOku();

        return Ok(new
        {
            secili = ayar.MobilAltMenu is { Count: > 0 }
                ? ayar.MobilAltMenu
                : new List<string> { "vardiya", "duyuru", "performans" },

            adaylar = Moduller
                .Select(m => new { kod = m.Kod, ad = m.Ad })
                .Concat(PortalModulleri.Select(m => new { kod = m.Kod, ad = m.Ad }))
                .ToList(),

            enFazla = 4
        });
    }

    /// <summary>Alt menü ayarını yazar; yalnızca alt menüye dokunuyor.</summary>
    [HttpPost("AltMenu")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult AltMenuYaz([FromBody] AltMenuGirdi girdi)
    {
        var ayar = _ayar.FormOku();

        /* Alt menüde en fazla dört modül: beşinci sekme 'Diğer' olacak
           ve daha fazlası küçük ekranda okunmuyor.

           Yalnızca MobilAltMenu değiştiriliyor: bütün form ayarını
           portaldan yazmak, İK panelinden yapılan başka bir düzenlemeyi
           silme riski taşıyordu. */
        ayar.MobilAltMenu = (girdi?.AltMenu ?? new()).Take(4).ToList();

        _ayar.Yaz("FORM", ayar);

        return Ok(new { basarili = true, secili = ayar.MobilAltMenu });
    }

    /// <summary>Panel: modül yetkilerini kaydeder.</summary>
    [HttpPost("ModulYetkileri")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult ModulYetkileriYaz([FromBody] ModulYetkiGirdi girdi)
    {
        var ayar = _ayar.FormOku();

        ayar.MobilModulYetkileri = girdi?.Yetkiler ?? new();

        /* Alt menüde en fazla dört modül: beşinci sekme 'Diğer' olacak
           ve daha fazlası küçük ekranda okunmuyor. */
        ayar.MobilAltMenu = (girdi?.AltMenu ?? new()).Take(4).ToList();

        _ayar.Yaz("FORM", ayar);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Bildirim jetonu                                                      */
    /* ==================================================================== */

    /// <summary>
    /// Cihazın bildirim jetonunu kaydeder.
    ///
    /// Uygulama her açılışta gönderir: jeton işletim sistemi tarafından
    /// yenilenebiliyor ve eskisi sessizce çalışmaz hâle geliyor.
    /// </summary>
    [HttpPost("BildirimJetonu")]
    [Authorize(Roles = "Personel")]
    public IActionResult BildirimJetonu([FromBody] BildirimJetonuGirdi girdi)
    {
        var kod = PersonelKodu;

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var jeton = (girdi?.Deger ?? "").Trim();

        if (string.IsNullOrWhiteSpace(jeton))
            return BadRequest(new { hata = "Jeton boş." });

        using var db = _vt.Baglanti();

        /* Aynı jeton başka bir sicile bağlıysa o kayıt siliniyor.

           Bir telefondan sırayla üç kişi giriş yaptığında jeton üç sicile
           birden bağlı kalıyor ve üçüne giden bildirimlerin hepsi son
           kullanıcının telefonuna düşüyordu. Jeton cihaza ait; bir cihaz
           aynı anda tek kişinindir. */
        /* 1.6 ve sonrası Biçen bildirim kanallarını kurduğunu bildiriyor;
           eski sürüm göndermiyor, ona varsayılan ses gidiyor */
        var ses = girdi?.Sesler == true;
        var surum = string.IsNullOrWhiteSpace(girdi?.Surum) ? null
            : girdi.Surum.Trim()[..Math.Min(20, girdi.Surum.Trim().Length)];

        try
        {
            db.Execute(@"
DELETE FROM KRY_MOBIL_JETON WHERE jeton = @jeton AND personel_kodu <> @kod;

MERGE KRY_MOBIL_JETON AS h
USING (SELECT @kod AS k) AS y ON h.personel_kodu = y.k
WHEN MATCHED THEN
    UPDATE SET jeton = @jeton, guncelleme = SYSDATETIME(), ses = @ses, surum = @surum
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, jeton, ses, surum) VALUES (@kod, @jeton, @ses, @surum);",
                new { kod, jeton, ses, surum });
        }
        catch (Microsoft.Data.SqlClient.SqlException)
        {
            /* ses / surum sütunları yoksa eski biçimde kaydedilir */
            db.Execute(@"
DELETE FROM KRY_MOBIL_JETON WHERE jeton = @jeton AND personel_kodu <> @kod;

MERGE KRY_MOBIL_JETON AS h
USING (SELECT @kod AS k) AS y ON h.personel_kodu = y.k
WHEN MATCHED THEN
    UPDATE SET jeton = @jeton, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, jeton) VALUES (@kod, @jeton);",
                new { kod, jeton });
        }

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Vardiya itirazı                                                      */
    /* ==================================================================== */

    /// <summary>
    /// Okutamayan ya da okutmayı unutan personel manuel giriş-çıkış talep
    /// eder.
    ///
    /// Doğrudan kayıt düzeltilmez; yöneticisi saati kontrol edip onaylar
    /// (<c>VardiyaDuzeltme/Karar</c>). Aksi hâlde vardiya kaydının bir
    /// anlamı kalmaz — herkes istediği saati yazabilir. İK paneli de
    /// talepleri görüp sonuçlandırabilir.
    /// </summary>
    [HttpPost("Itiraz")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> Itiraz([FromBody] ItirazGirdi girdi)
    {
        var p = Kendisi();

        if (p is null)
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (string.IsNullOrWhiteSpace(girdi?.Sebep))
            return BadRequest(new
            {
                hata = "Sebep yazınız.",
                ayrinti = "Yöneticiniz neden düzeltme istediğinizi bilmeli."
            });

        if (girdi.Tarih.Date > DateTime.Now.Date)
            return BadRequest(new { hata = "Gelecek bir tarih için itiraz açılamaz." });

        /* Saat "08:30" biçiminde olmalı: "8" gibi bir değer TimeSpan'de 8 gün
           sayılıyor ve onayda kayıt günler sonrasına düşüyordu. */
        if (!SaatGecerli(girdi.Saat, out _))
            return BadRequest(new { hata = "Saati 08:30 biçiminde giriniz." });

        if (girdi.Tur is not ("Giriş" or "Çıkış"))
            return BadRequest(new { hata = "Giriş ya da çıkış seçiniz." });

        if (girdi.Sebep.Trim().Length > 480)
            return BadRequest(new { hata = "Açıklama en fazla 480 karakter olabilir." });

        /* 09.10.2026: "." gibi anlamsız açıklama kabul edilmiyor; yönetici ve
           İK neden okutulamadığını görmeli. 1.6 bu metni uyarıda gösteriyor. */
        if (ManuelSebepHatasi(girdi.Sebep) is string sebepHatasi)
            return BadRequest(new { hata = sebepHatasi, ayrinti = "Örnek: Telefonumun şarjı bitti, karekodu okutamadım." });

        /* Yalnızca bugün ve dün (29.09.2026; önceden son yedi gün). Unutulan
           okutma hemen bildirilsin: günler sonra yazılan saat tahmine
           dönüyordu, eski kayıtlar bordroya da işlenmiş olabiliyor. */
        if ((DateTime.Now.Date - girdi.Tarih.Date).TotalDays > 1)
            return BadRequest(new
            {
                hata = "Yalnızca bugün ve dün için manuel giriş-çıkış bildirilebilir.",
                ayrinti = "Daha eski bir düzeltme için İnsan Kaynakları ile görüşünüz."
            });

        using var db = _vt.Baglanti();

        var acikVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_VARDIYA_ITIRAZ
WHERE personel_kodu = @kod AND tarih = @tarih
  AND durum = N'Bekliyor' AND iptal = 0",
            new { kod = p.PersonelKodu, tarih = girdi.Tarih.Date });

        if (acikVar > 0)
            return BadRequest(new
            {
                hata = "Bu tarih için bekleyen bir itirazınız var."
            });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_VARDIYA_ITIRAZ
    (personel_kodu, ad_soyad, sube_adi, tarih, tur, saat, sebep)
OUTPUT INSERTED.id
VALUES (@kod, @adSoyad, @subeAdi, @tarih, @tur, @saat, @sebep)",
            new
            {
                kod = p.PersonelKodu,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                subeAdi = p.Sube,
                tarih = girdi.Tarih.Date,
                tur = girdi.Tur,
                saat = girdi.Saat,
                sebep = girdi.Sebep.Trim()
            });

        /* Önce yöneticisine: manuel giriş-çıkışı o onaylıyor. Yöneticisi
           bulunamazsa İK'ya düşüyor ki talep sahipsiz kalmasın. */
        var yoneticiler = new HashSet<string>();

        try
        {
            if (_ekip.Yoneticiler().TryGetValue((p.PersonelKodu ?? "").Trim().TrimStart('0'), out var liste))
                yoneticiler = liste;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Manuel vardiya talebi için yönetici bulunamadı");
        }

        var metin = $"{p.Ad} {p.Soyad} · {girdi.Tarih:dd.MM} {girdi.Tur} {girdi.Saat} · {girdi.Sebep.Trim()}";

        if (yoneticiler.Count > 0)
        {
            foreach (var y in yoneticiler)
            {
                try
                {
                    await _bildirim.Gonder(y, "Manuel giriş-çıkış onayı bekliyor",
                        metin + " — saati kontrol edip onaylayınız.", "vardiyaplani");
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Manuel vardiya bildirimi gönderilemedi");
                }
            }
        }
        else
        {
            await _bildirim.RoleGonder(
                new[] { Roller.IK, Roller.IKYoneticisi },
                "Manuel giriş-çıkış talebi",
                metin,
                "izintalep");
        }

        return Ok(new { basarili = true, id, yoneticiyeGitti = yoneticiler.Count > 0 });
    }

    /// <summary>
    /// Manuel giriş-çıkış açıklaması yeterli mi (09.10.2026). En az iki
    /// kelime ve 12 karakter; harf olmayan ya da aynı harfin tekrarı
    /// ("....", "aaaa", "x") olan metin kabul edilmez. Uygunsa null.
    /// </summary>
    public static string ManuelSebepHatasi(string sebep)
    {
        var t = System.Text.RegularExpressions.Regex.Replace((sebep ?? "").Trim(), @"\s+", " ");
        var harfler = t.Where(char.IsLetter).Select(char.ToLowerInvariant).ToList();
        var kelimeler = t.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Count(k => k.Count(char.IsLetter) >= 2);

        if (t.Length < 12 || harfler.Count < 8 || kelimeler < 2 || harfler.Distinct().Count() < 5)
            return "Neden okutamadığınızı birkaç kelimeyle yazınız (en az iki kelime). Örnek: “Telefonumun şarjı bitti, karekodu okutamadım.”";

        return null;
    }

    /// <summary>Kişinin kendi itirazları.</summary>
    [HttpGet("Itirazlarim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Itirazlarim()
    {
        var kod = PersonelKodu;

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, tarih, tur, saat, sebep, durum,
       karar_notu AS kararNotu, karar_tarihi AS kararTarihi, olusturma
FROM KRY_VARDIYA_ITIRAZ
WHERE personel_kodu = @kod AND iptal = 0
ORDER BY olusturma DESC", new { kod }).ToList();

        return Ok(new { kayitlar });
    }

    /// <summary>Panel: bekleyen ve geçmiş itirazlar.</summary>
    [HttpGet("Itirazlar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult Itirazlar([FromQuery] string uzman = null, [FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null)
    {
        using var db = _vt.Baglanti();

        /* Uzman süzgeci (07.10.2026): İK uzmanı önce kendi şubelerini görür */
        var kapsam = UzmanKapsami.Olustur(db, _ayar,
            User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value, User?.Identity?.Name, uzman);

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad,
       sube_adi AS subeAdi, tarih, tur, saat, sebep, durum,
       karar_veren AS kararVeren, karar_notu AS kararNotu,
       karar_tarihi AS kararTarihi, olusturma
FROM KRY_VARDIYA_ITIRAZ
WHERE iptal = 0
  /* Rapor (09.10.2026): tarih aralığı verilirse o aralık; bekleyenler her zaman */
  AND (durum = N'Bekliyor' OR @bas IS NULL OR tarih >= @bas)
  AND (durum = N'Bekliyor' OR @bit IS NULL OR tarih <= @bit)
ORDER BY CASE WHEN durum = N'Bekliyor' THEN 0 ELSE 1 END,
         olusturma DESC", new { bas = bas?.Date, bit = bit?.Date }).ToList();

        if (kapsam is not null) kayitlar = kayitlar.Where(x => kapsam.Icinde((string)x.subeAdi)).ToList();

        return Ok(new
        {
            kayitlar,
            bekleyen = kayitlar.Count(x => (string)x.durum == "Bekliyor"),
            kapsam = UzmanKapsami.Ozet(kapsam)
        });
    }

    /// <summary>
    /// Personelin manuel giriş-çıkış talepleri (15.10.2026, panel yan
    /// penceresi): bu ay / geçen ay / bu yıl sayıları, son 12 ay ve bütün
    /// talepler açıklamalarıyla.
    /// </summary>
    [HttpGet("Itirazlar/Personel/{kod}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult ItirazPersonel(string kod)
    {
        kod = (kod ?? "").Trim();
        if (kod.Length == 0) return BadRequest(new { hata = "Sicil yok." });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT TOP 500 id, tarih, tur, saat, sebep, durum, karar_veren AS kararVeren, karar_notu AS kararNotu,
       karar_tarihi AS kararTarihi, olusturma, sube_adi AS subeAdi, ad_soyad AS adSoyad
FROM KRY_VARDIYA_ITIRAZ
WHERE iptal = 0 AND personel_kodu IN (@a, @b)
ORDER BY tarih DESC, id DESC", new { a = kod, b = kod.TrimStart('0') }).ToList();

        var ayBasi = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var gecenAy = ayBasi.AddMonths(-1);
        var yilBasi = new DateTime(DateTime.Today.Year, 1, 1);

        int Say(Func<dynamic, bool> f) => kayitlar.Count(f);

        return Ok(new
        {
            sicil = kod,
            ad = (string)kayitlar.FirstOrDefault()?.adSoyad,
            sube = (string)kayitlar.FirstOrDefault()?.subeAdi,
            ozet = new
            {
                buAy = Say(x => (DateTime)x.tarih >= ayBasi),
                buAyGiris = Say(x => (DateTime)x.tarih >= ayBasi && (string)x.tur == "Giriş"),
                buAyCikis = Say(x => (DateTime)x.tarih >= ayBasi && (string)x.tur == "Çıkış"),
                buAyRed = Say(x => (DateTime)x.tarih >= ayBasi && (string)x.durum == "Reddedildi"),
                gecenAy = Say(x => (DateTime)x.tarih >= gecenAy && (DateTime)x.tarih < ayBasi),
                buYil = Say(x => (DateTime)x.tarih >= yilBasi),
                toplam = kayitlar.Count,
                onaylanan = Say(x => (string)x.durum == "Onaylandı"),
                reddedilen = Say(x => (string)x.durum == "Reddedildi"),
            },
            aylar = Enumerable.Range(0, 12).Select(i => ayBasi.AddMonths(-i)).Select(a => new
            {
                ay = a.ToString("yyyy-MM"),
                adet = Say(x => (DateTime)x.tarih >= a && (DateTime)x.tarih < a.AddMonths(1)),
            }),
            kayitlar,
        });
    }

    /// <summary>
    /// İtirazı sonuçlandırır. Onaylanırsa vardiya kaydı oluşturulur.
    /// </summary>
    [HttpPost("Itiraz/{id:int}/Karar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> ItirazKarar(int id, [FromBody] IzinKararGirdi girdi)
    {
        var onay = girdi?.Onay == true;

        if (!onay && string.IsNullOrWhiteSpace(girdi?.Not))
            return BadRequest(new { hata = "Ret sebebini yazınız." });

        using var db = _vt.Baglanti();

        var itiraz = db.QueryFirstOrDefault(@"
SELECT * FROM KRY_VARDIYA_ITIRAZ WHERE id = @id AND iptal = 0", new { id });

        if (itiraz is null) return NotFound(new { hata = "İtiraz bulunamadı." });

        if ((string)itiraz.durum != "Bekliyor")
            return BadRequest(new { hata = "Bu itiraz zaten sonuçlanmış." });

        /* Saat, durum değişmeden önce doğrulanıyor: önce onaylanıp sonra
           saat hatası verilirse talep kayıtsız "onaylandı" kalıyordu. */
        var onaySaatMetni = string.IsNullOrWhiteSpace(girdi?.Saat) ? (string)itiraz.saat : girdi.Saat.Trim();
        var onaySaati = TimeSpan.Zero;

        if (onay && !SaatGecerli(onaySaatMetni, out onaySaati))
            return BadRequest(new { hata = "Saati 08:30 biçiminde giriniz." });

        /* Yönetici aynı anda mobilden onaylarsa ikinci karar yazılmıyor */
        var degisen = db.Execute(@"
UPDATE KRY_VARDIYA_ITIRAZ
SET durum = @durum, karar_veren = @kisi, karar_notu = @not,
    karar_tarihi = SYSDATETIME()
WHERE id = @id AND durum = N'Bekliyor'",
            new
            {
                id,
                durum = onay ? "Onaylandı" : "Reddedildi",
                kisi = User?.Identity?.Name ?? "sistem",
                not = (girdi?.Not ?? "").Trim()
            });

        if (degisen == 0)
            return BadRequest(new { hata = "Bu talep az önce başka biri tarafından sonuçlandırıldı." });

        if (onay)
        {
            /* Onaylanan talep vardiya kaydı olarak yazılır. Panel saati
               düzeltebilir; düzeltilmişse talepteki saat de güncellenir.
               Elle eklendiği belli olsun diye konum doğrulaması işaretlenmez. */
            var tarih = ((DateTime)itiraz.tarih).Date;
            var zaman = tarih.Add(onaySaati);

            VardiyaKayitYazici.ElleEkle(db,
                (string)itiraz.personel_kodu, (string)itiraz.ad_soyad, (string)itiraz.sube_adi,
                (string)itiraz.tur, zaman);

            if (zaman.ToString("HH:mm") != (string)itiraz.saat)
                db.Execute("UPDATE KRY_VARDIYA_ITIRAZ SET saat = @saat WHERE id = @id",
                    new { id, saat = zaman.ToString("HH:mm") });
        }

        await _bildirim.Gonder(
            (string)itiraz.personel_kodu,
            onay ? "Vardiya itirazınız onaylandı" : "Vardiya itirazınız reddedildi",
            onay
                ? $"{((DateTime)itiraz.tarih):dd.MM} {itiraz.tur} {itiraz.saat} kaydınıza işlendi."
                : (girdi?.Not ?? "").Trim(),
            "vardiya");

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Duyuru gönderme · panel                                              */
    /* ==================================================================== */

    /// <summary>Duyuru hedefine uyan aktif personel (sicil listesi).</summary>
    private static List<PersonelKaydi> HedefKisileri(
        string hedefTur, string subeAdi, string personelKodu,
        IEnumerable<PersonelKaydi> aktifler, HashSet<string> alicilar)
    {
        bool Esit(string a, string b) => string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

        return aktifler.Where(x => (hedefTur ?? "herkes") switch
        {
            "sube" => Esit(x.Sube, subeAdi),
            "merkez" => (x.Sube ?? "").Contains("MERKEZ", StringComparison.OrdinalIgnoreCase),
            "depo" => (x.Sube ?? "").Contains("DEPO", StringComparison.OrdinalIgnoreCase),
            "kisi" => Esit(x.PersonelKodu, personelKodu),
            "secili" => alicilar.Contains((x.PersonelKodu ?? "").Trim()),
            _ => true,
        }).ToList();
    }

    /// <summary>Gönderilmiş duyurular; panelde listelenir.</summary>
    [HttpGet("DuyuruListe")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult DuyuruListe()
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT d.id, d.baslik, d.metin, d.hedef_tur AS hedefTur, d.hedef_ozet AS hedefOzet,
       d.sube_adi AS subeAdi, d.personel_kodu AS personelKodu,
       d.onemli, d.baglanti, d.baglanti_yazi AS baglantiYazi,
       CASE WHEN d.gorsel IS NULL THEN 0 ELSE 1 END AS gorselVar,
       d.gonderen, d.yazan_ad AS yazanAd, d.yazan_unvan AS yazanUnvan, d.imza,
       d.olusturma, d.iptal,
       /* 27.10.2026: planlı duyuru, yayın zamanı gelmediyse bekliyor */
       CAST(CASE WHEN ISNULL(d.planli, 0) = 1 AND d.olusturma > SYSDATETIME() THEN 1 ELSE 0 END AS BIT) AS planliBekliyor,
       CAST(ISNULL(d.planli, 0) AS BIT) AS planli,
       (SELECT COUNT(*) FROM KRY_MOBIL_DUYURU_OKUMA o
        WHERE o.duyuru_id = d.id) AS okuyan,
       (SELECT COUNT(*) FROM KRY_MOBIL_DUYURU_ALICI a
        WHERE a.duyuru_id = d.id) AS aliciSayisi
FROM KRY_MOBIL_DUYURU d
ORDER BY d.olusturma DESC").ToList();

        /* Hedef kitle büyüklüğü: okunma oranı için. Seçili hedefte alıcı
           tablosundan, diğerlerinde bugünkü aktif personelden sayılır. */
        List<PersonelKaydi> aktifler;
        try { aktifler = _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList(); }
        catch { aktifler = new List<PersonelKaydi>(); }

        var bos = new HashSet<string>();

        return Ok(new
        {
            kayitlar = kayitlar.Select(k => new
            {
                id = (int)k.id,
                baslik = (string)k.baslik,
                metin = (string)k.metin,
                hedefTur = (string)k.hedefTur ?? "herkes",
                hedefOzet = (string)k.hedefOzet,
                subeAdi = (string)k.subeAdi,
                personelKodu = (string)k.personelKodu,
                onemli = (bool)k.onemli,
                baglanti = (string)k.baglanti,
                baglantiYazi = (string)k.baglantiYazi,
                gorselVar = (int)k.gorselVar,
                gonderen = (string)k.gonderen,
                yazanAd = (string)k.yazanAd,
                yazanUnvan = (string)k.yazanUnvan,
                imza = (string)k.imza,
                olusturma = (DateTime)k.olusturma,
                iptal = (bool)k.iptal,
                okuyan = (int)k.okuyan,
                hedefSayisi = (string)k.hedefTur == "secili"
                    ? (int)k.aliciSayisi
                    : HedefKisileri((string)k.hedefTur, (string)k.subeAdi, (string)k.personelKodu, aktifler, bos).Count
            })
        });
    }

    /// <summary>
    /// Duyuru gönderilebilecek aktif personel: pozisyon ve kişi seçimi,
    /// alıcı sayısı ve uygulamayı kullananların oranı için.
    /// </summary>
    [HttpGet("DuyuruAlicilari")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult DuyuruAlicilari()
    {
        var aktifler = _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        using var db = _vt.Baglanti();

        var uygulamada = db.Query<string>("SELECT LTRIM(RTRIM(personel_kodu)) FROM KRY_MOBIL_CIHAZ")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return Ok(new
        {
            kisiler = aktifler
                .Select(x => new
                {
                    personelKodu = (x.PersonelKodu ?? "").Trim(),
                    adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    gorev = (x.Pozisyon ?? "").Trim(),
                    subeAdi = (x.Sube ?? "").Trim(),
                    uygulama = uygulamada.Contains((x.PersonelKodu ?? "").Trim())
                })
                .OrderBy(x => x.adSoyad)
                .ToList()
        });
    }

    /// <summary>Duyurunun hedef kitlesi: kim okudu, kim henüz okumadı.</summary>
    [HttpGet("DuyuruOkuma/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.IK + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult DuyuruOkuma(int id)
    {
        using var db = _vt.Baglanti();

        var d = db.QueryFirstOrDefault(@"
SELECT hedef_tur AS hedefTur, sube_adi AS subeAdi, personel_kodu AS personelKodu
FROM KRY_MOBIL_DUYURU WHERE id = @id", new { id });

        if (d is null) return NotFound(new { hata = "Duyuru bulunamadı." });

        var okumalar = db.Query(@"
SELECT LTRIM(RTRIM(personel_kodu)) AS kod, okuma FROM KRY_MOBIL_DUYURU_OKUMA
WHERE duyuru_id = @id", new { id })
            .ToDictionary(x => (string)x.kod, x => (DateTime)x.okuma, StringComparer.OrdinalIgnoreCase);

        var alicilar = db.Query<string>(@"
SELECT LTRIM(RTRIM(personel_kodu)) FROM KRY_MOBIL_DUYURU_ALICI WHERE duyuru_id = @id", new { id })
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var hepsi = _personelKaynak.TumPersonelleriGetir();
        var aktifler = hepsi.Where(x => x.Durum == 1).ToList();

        var uygulamada = db.Query<string>("SELECT LTRIM(RTRIM(personel_kodu)) FROM KRY_MOBIL_CIHAZ")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var hedef = HedefKisileri((string)d.hedefTur, (string)d.subeAdi, (string)d.personelKodu, aktifler, alicilar);

        object Satir(PersonelKaydi x) => new
        {
            personelKodu = (x.PersonelKodu ?? "").Trim(),
            adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
            gorev = x.Pozisyon,
            subeAdi = x.Sube,
            uygulama = uygulamada.Contains((x.PersonelKodu ?? "").Trim()),
            okuma = okumalar.TryGetValue((x.PersonelKodu ?? "").Trim(), out var t) ? t : (DateTime?)null
        };

        var hedefKodlari = hedef.Select(x => (x.PersonelKodu ?? "").Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);

        /* Hedef dışından okuyanlar (ör. sonradan ayrılan ya da şubesi
           değişen personel) ayrıca listelenir ki sayı tutsun */
        var disaridan = okumalar.Keys.Where(k => !hedefKodlari.Contains(k))
            .Select(k => hepsi.FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), k, StringComparison.OrdinalIgnoreCase)))
            .Where(x => x is not null)
            .Select(Satir);

        return Ok(new
        {
            okuyanlar = hedef.Where(x => okumalar.ContainsKey((x.PersonelKodu ?? "").Trim())).Select(Satir).Concat(disaridan).ToList(),
            okumayanlar = hedef.Where(x => !okumalar.ContainsKey((x.PersonelKodu ?? "").Trim())).Select(Satir).ToList()
        });
    }

    /// <summary>
    /// Panel kullanıcısına gelen duyurular: hesabındaki sicil (yoksa
    /// telefon) ile personel kaydı bulunur, mobil uygulamadaki süzgecin
    /// aynısı uygulanır. Açıldığında okundu sayılır.
    /// </summary>
    [HttpGet("GelenDuyurular")]
    [Authorize]
    public IActionResult GelenDuyurular()
    {
        using var db = _vt.Baglanti();

        var hesap = db.QueryFirstOrDefault(@"
SELECT sicil, telefon FROM KRY_KULLANICILAR WHERE kullanici_adi = @ad",
            new { ad = User?.Identity?.Name ?? "" });

        string Rakam(string t) => new string((t ?? "").Where(char.IsDigit).ToArray());

        var sicil = ((string)hesap?.sicil ?? "").Trim();
        var tel = Rakam((string)hesap?.telefon);
        if (tel.Length > 10) tel = tel[^10..];

        PersonelKaydi p = null;

        try
        {
            var hepsi = _personelKaynak.TumPersonelleriGetir();

            p = (sicil.Length > 0
                    ? hepsi.Where(x => string.Equals((x.PersonelKodu ?? "").Trim(), sicil, StringComparison.OrdinalIgnoreCase))
                    : Enumerable.Empty<PersonelKaydi>())
                .Concat(tel.Length == 10
                    ? hepsi.Where(x => { var t = Rakam(x.Telefon); return t.Length >= 10 && t[^10..] == tel; })
                    : Enumerable.Empty<PersonelKaydi>())
                .OrderByDescending(x => x.Durum == 1)
                .FirstOrDefault();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Gelen duyurular için personel bulunamadı");
        }

        var kod = (p?.PersonelKodu ?? "").Trim();

        var kayitlar = db.Query(@"
SELECT TOP 100
       d.id, d.baslik, d.metin, d.onemli, d.hedef_tur AS hedefTur, d.hedef_ozet AS hedefOzet,
       d.sube_adi AS subeAdi,
       d.baglanti, d.baglanti_yazi AS baglantiYazi,
       CASE WHEN d.gorsel IS NULL THEN 0 ELSE 1 END AS gorselVar,
       d.olusturma, d.gonderen,
       d.yazan_ad AS yazanAd, d.yazan_unvan AS yazanUnvan, d.imza,
       CASE WHEN o.duyuru_id IS NULL THEN 0 ELSE 1 END AS okundu
FROM KRY_MOBIL_DUYURU d
LEFT JOIN KRY_MOBIL_DUYURU_OKUMA o
       ON o.duyuru_id = d.id AND o.personel_kodu = @kod
WHERE d.iptal = 0 AND d.olusturma <= SYSDATETIME()
  AND (d.personel_kodu IS NULL OR d.personel_kodu = @kod)
  AND (d.hedef_tur IS NULL OR d.hedef_tur = N'herkes'
       OR (d.hedef_tur = N'sube' AND d.sube_adi = @subeAdi)
       OR (d.hedef_tur = N'merkez' AND @subeAdi LIKE N'%MERKEZ%')
       OR (d.hedef_tur = N'depo' AND @subeAdi LIKE N'%DEPO%')
       OR (d.hedef_tur = N'kisi' AND d.personel_kodu = @kod)
       OR (d.hedef_tur = N'secili' AND EXISTS (
            SELECT 1 FROM KRY_MOBIL_DUYURU_ALICI a
            WHERE a.duyuru_id = d.id AND a.personel_kodu = @kod)))
ORDER BY d.olusturma DESC",
            new { kod = kod.Length > 0 ? kod : "__YOK__", subeAdi = p?.Sube ?? "" }).ToList();

        return Ok(new
        {
            eslesti = p is not null,
            personel = p is null ? null : new { personelKodu = kod, adSoyad = $"{p.Ad} {p.Soyad}".Trim(), subeAdi = p.Sube, gorev = p.Pozisyon },
            kayitlar
        });
    }

    /// <summary>Gelen duyuruyu okundu işaretler (panelde açıldığında).</summary>
    [HttpPost("GelenDuyuruOkundu/{id:int}")]
    [Authorize]
    public IActionResult GelenDuyuruOkundu(int id, [FromQuery] string kod)
    {
        if (string.IsNullOrWhiteSpace(kod)) return Ok(new { basarili = false });

        using var db = _vt.Baglanti();

        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_MOBIL_DUYURU_OKUMA WHERE duyuru_id = @id AND personel_kodu = @kod)
    INSERT INTO KRY_MOBIL_DUYURU_OKUMA (duyuru_id, personel_kodu) VALUES (@id, @kod)",
            new { id, kod = kod.Trim() });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Duyuru gönderir.
    ///
    /// Hedef: herkes, belirli bir şube, genel müdürlük ya da lojistik depo.
    /// Şube adına göre süzülür; personel kaydında şube kodu taşınmıyor.
    /// </summary>
    [HttpPost("Duyuru")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public async Task<IActionResult> DuyuruGonder([FromBody] DuyuruGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.Baslik))
            return BadRequest(new { hata = "Başlık yazınız." });

        if (string.IsNullOrWhiteSpace(girdi.Metin))
            return BadRequest(new { hata = "Duyuru metnini yazınız." });

        /* Bağlantı verilmişse geçerli olmalı: tıklanamayan bir bağlantı
           duyuruyu güvenilmez gösteriyor. */
        if (!string.IsNullOrWhiteSpace(girdi.Baglanti) &&
            !Uri.TryCreate(girdi.Baglanti.Trim(), UriKind.Absolute, out var adres))
            return BadRequest(new
            {
                hata = "Bağlantı geçersiz.",
                ayrinti = "https:// ile başlayan tam adres giriniz."
            });

        byte[] gorsel = null;

        if (!string.IsNullOrWhiteSpace(girdi.Gorsel))
        {
            try
            {
                var veri = girdi.Gorsel;
                var virgul = veri.IndexOf(',');

                /* data:image/png;base64,.... biçiminde gelir */
                if (virgul > 0) veri = veri[(virgul + 1)..];

                gorsel = Convert.FromBase64String(veri);

                if (gorsel.Length > 3 * 1024 * 1024)
                    return BadRequest(new
                    {
                        hata = "Görsel çok büyük.",
                        ayrinti = "En fazla 3 MB olmalıdır."
                    });
            }
            catch
            {
                return BadRequest(new { hata = "Görsel okunamadı." });
            }
        }

        using var db = _vt.Baglanti();

        var hedef = (girdi.HedefTur ?? "herkes").Trim();

        /* Seçili hedef: şube ve pozisyon süzgeci + tek tek seçilen kişiler.
           Alıcılar gönderim anında belirlenip yazılır. */
        var secilenler = new List<PersonelKaydi>();
        string hedefOzet = null;

        if (hedef == "secili")
        {
            var subeler = (girdi.Subeler ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToList();
            var pozisyonlar = (girdi.Pozisyonlar ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).ToList();
            var kodlar = (girdi.PersonelKodlari ?? new()).Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            if (subeler.Count == 0 && pozisyonlar.Count == 0 && kodlar.Count == 0)
                return BadRequest(new { hata = "Alıcı seçiniz.", ayrinti = "Şube, pozisyon ya da kişi seçmelisiniz." });

            var aktifler = _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

            var suzgecVar = subeler.Count > 0 || pozisyonlar.Count > 0;

            secilenler = aktifler.Where(x =>
                    kodlar.Contains((x.PersonelKodu ?? "").Trim())
                    || (suzgecVar
                        && (subeler.Count == 0 || subeler.Any(s => string.Equals(s, (x.Sube ?? "").Trim(), StringComparison.OrdinalIgnoreCase)))
                        && (pozisyonlar.Count == 0 || pozisyonlar.Any(s => string.Equals(s, (x.Pozisyon ?? "").Trim(), StringComparison.OrdinalIgnoreCase)))))
                .GroupBy(x => (x.PersonelKodu ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .ToList();

            if (secilenler.Count == 0)
                return BadRequest(new { hata = "Seçime uyan aktif personel yok." });

            string Kisa(List<string> l) => l.Count <= 3 ? string.Join(", ", l) : $"{string.Join(", ", l.Take(3))} +{l.Count - 3}";

            var parcalar = new List<string>();
            if (pozisyonlar.Count > 0) parcalar.Add($"Pozisyon: {Kisa(pozisyonlar)}");
            if (subeler.Count > 0) parcalar.Add($"Şube: {Kisa(subeler)}");
            if (kodlar.Count > 0)
            {
                var adlar = secilenler.Where(x => kodlar.Contains((x.PersonelKodu ?? "").Trim()))
                    .Select(x => $"{x.Ad} {x.Soyad}".Trim()).ToList();
                parcalar.Add(adlar.Count == 1 ? $"Kişi: {adlar[0]}" : $"{adlar.Count} kişi: {Kisa(adlar)}");
            }

            hedefOzet = string.Join(" · ", parcalar);
            if (hedefOzet.Length > 400) hedefOzet = hedefOzet[..397] + "…";
        }

        /* Duyurunun altındaki imza: panel kullanıcısının adı ve ünvanı,
           kişisel imza seçildiyse kendi metni. Kişisel imza istenirse
           hesapta saklanıyor; sonraki duyurularda hazır geliyor. */
        var yazan = ImzaHazirla(db, girdi);

        /* Planlı gönderim (27.10.2026): en az 2 dakika ileri ve en fazla 1 yıl */
        DateTime? yayin = null;
        if (girdi.YayinZamani is DateTime yz)
        {
            var yerel = yz.Kind == DateTimeKind.Utc ? yz.ToLocalTime() : yz;
            if (yerel > DateTime.Now.AddMinutes(2))
            {
                if (yerel > DateTime.Now.AddYears(1))
                    return BadRequest(new { hata = "Planlı duyuru en fazla bir yıl ileriye kurulabilir." });
                yayin = new DateTime(yerel.Year, yerel.Month, yerel.Day, yerel.Hour, yerel.Minute, 0);
            }
        }

        /* Kayıt Biçen360 patron duyurusuyla ortak (DuyuruYazici) */
        var id = DuyuruYazici.Ekle(db, new DuyuruYazici.Kayit
            {
                Baslik = girdi.Baslik.Trim(),
                Metin = girdi.Metin.Trim(),
                Hedef = hedef,
                HedefOzet = hedefOzet,
                SubeAdi = hedef == "sube" ? girdi.SubeAdi : null,
                PersonelKodu = hedef == "kisi" ? girdi.PersonelKodu : null,
                Onemli = girdi.Onemli,
                Baglanti = string.IsNullOrWhiteSpace(girdi.Baglanti)
                    ? null : girdi.Baglanti.Trim(),
                BaglantiYazi = string.IsNullOrWhiteSpace(girdi.BaglantiYazi)
                    ? null : girdi.BaglantiYazi.Trim(),
                Gorsel = gorsel,
                Gonderen = User?.Identity?.Name ?? "sistem",
                YazanAd = yazan.ad,
                YazanUnvan = yazan.unvan,
                Imza = yazan.imza,
                YayinZamani = yayin,
            },
            hedef == "secili" ? secilenler.Select(x => x.PersonelKodu) : null);

        /* Planlıysa bildirim zamanı gelince gider (DuyuruPlanGorevi) */
        if (yayin is not null)
            return Ok(new { basarili = true, id, planli = true, yayinZamani = yayin, aliciSayisi = hedef == "secili" ? secilenler.Count : (int?)null });

        await DuyuruBildir(_bildirim, _personelKaynak, _kayit, hedef, girdi.SubeAdi, girdi.PersonelKodu,
            hedef == "secili" ? secilenler.Select(x => x.PersonelKodu).ToList() : null, girdi.Baslik.Trim(), girdi.Metin.Trim());

        return Ok(new { basarili = true, id, aliciSayisi = hedef == "secili" ? secilenler.Count : (int?)null });
    }

    /// <summary>Duyuru bildirimi hedefe göre (hemen gönderimde ve planlı duyurunun zamanı gelince)</summary>
    public static async Task DuyuruBildir(BildirimServisi bildirim, PersonelKaynagiServisi kaynak, ILogger kayit,
        string hedef, string subeAdi, string personelKodu, List<string> secilenler, string baslik, string metin)
    {

        /* Bildirim: duyurunun okunması için uygulamanın açılmasını
           beklemek anlamsız. Hedefe göre süzülür. */
        try
        {
            if (hedef == "secili")
            {
                await bildirim.TopluGonder(
                    secilenler ?? new List<string>(), baslik, metin, "duyuru");
            }
            else if (hedef == "herkes")
            {
                await bildirim.HerkeseGonder(
                    baslik, metin, "duyuru");
            }
            else
            {
                var personeller = kaynak.TumPersonelleriGetir()
                    .Where(x => x.Durum == 1)
                    .Where(x => hedef switch
                    {
                        "sube" => string.Equals(x.Sube, subeAdi,
                            StringComparison.OrdinalIgnoreCase),
                        "merkez" => (x.Sube ?? "").Contains("MERKEZ",
                            StringComparison.OrdinalIgnoreCase),
                        "depo" => (x.Sube ?? "").Contains("DEPO",
                            StringComparison.OrdinalIgnoreCase),
                        "kisi" => string.Equals(x.PersonelKodu, personelKodu,
                            StringComparison.OrdinalIgnoreCase),
                        _ => false,
                    })
                    .Select(x => x.PersonelKodu);

                await bildirim.TopluGonder(
                    personeller, baslik, metin, "duyuru");
            }
        }
        catch (Exception hata)
        {
            /* Bildirim gitmemesi duyurunun kaydını geçersiz kılmaz */
            kayit.LogWarning(hata, "Duyuru bildirimi gönderilemedi");
        }

    }

    /// <summary>Duyuruyu yayından kaldırır.</summary>
    [HttpDelete("Duyuru/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult DuyuruKaldir(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute("UPDATE KRY_MOBIL_DUYURU SET iptal = 1 WHERE id = @id",
            new { id });

        return Ok(new { basarili = true });
    }

    /// <summary>Duyuru görseli.</summary>
    [HttpGet("DuyuruGorsel/{id:int}")]
    [AllowAnonymous]
    public IActionResult DuyuruGorsel(int id)
    {
        using var db = _vt.Baglanti();

        var veri = db.ExecuteScalar<byte[]>(
            "SELECT gorsel FROM KRY_MOBIL_DUYURU WHERE id = @id", new { id });

        if (veri is null || veri.Length == 0) return NotFound();

        return File(veri, "image/jpeg");
    }

    /* ==================================================================== */
    /* Şube karekodları · panel yönetimi                                    */
    /* ==================================================================== */

    /// <summary>
    /// Şube listesi ve karekod durumları.
    ///
    /// Ayardaki tüm şubeler döner; kod tanımlanmamış olanlar da görünür
    /// ki eksikler fark edilsin.
    /// </summary>
    [HttpGet("Karekodlar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult Karekodlar()
    {
        var ayar = _ayar.FormOku();

        using var db = _vt.Baglanti();

        /* Şubeye tanıtılmış mevcut (iCard) karekodları */
        var harici = db.Query(@"
SELECT id, sube_kodu AS subeKodu, kod, kaynak, tanimlayan, olusturma
FROM KRY_SUBE_KAREKOD_HARICI ORDER BY olusturma")
            .GroupBy(x => ((string)x.subeKodu ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(gr => gr.Key, gr => gr.Select(x => (object)new
            {
                id = (int)x.id,
                kod = (string)x.kod,
                kaynak = (string)x.kaynak,
                tanimlayan = (string)x.tanimlayan,
                olusturma = (DateTime)x.olusturma,
            }).ToList(), StringComparer.OrdinalIgnoreCase);

        var kayitli = db.Query(@"
SELECT sube_kodu AS subeKodu, kod, enlem, boylam, yenilenme
FROM KRY_SUBE_KAREKOD")
            .ToDictionary(x => (string)x.subeKodu, x => x,
                          StringComparer.OrdinalIgnoreCase);

        var liste = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .Select(x =>
            {
                var k = kayitli.GetValueOrDefault(x.Kod);

                return new
                {
                    subeKodu = x.Kod,
                    subeAdi = x.Ad,
                    tur = x.Tur,
                    kod = k is null ? null : (string)k.kod,
                    enlem = k?.enlem,
                    boylam = k?.boylam,
                    yenilenme = k?.yenilenme,
                    tanimliMi = k is not null,
                    harici = harici.GetValueOrDefault(x.Kod.Trim()) ?? new List<object>(),
                };
            })
            .OrderBy(x => x.subeAdi)
            .ToList();

        return Ok(new
        {
            kayitlar = liste,
            tanimli = liste.Count(x => x.tanimliMi),
            /* iCard karekodu tanıtılmış şube de okutma yapabiliyor */
            eksik = liste.Count(x => !x.tanimliMi && x.harici.Count == 0)
        });
    }

    /// <summary>
    /// Bir şubenin karekodunu oluşturur ya da yeniler.
    ///
    /// Kod rastgele üretilir; şube kodundan türetilseydi tahmin edilebilir
    /// olurdu ve biri kendi telefonundan kod oluşturup uzaktan okutabilirdi.
    /// </summary>
    [HttpPost("Karekod")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult KarekodYaz([FromBody] KarekodGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.SubeKodu))
            return BadRequest(new { hata = "Şube belirtiniz." });

        /* Koordinat aralığı denetlenir. Yanlışlıkla ondalık ayracı nokta
           yerine virgül girildiğinde ya da alanlar ters yazıldığında
           anlamsız bir değer kaydedilmesin. */
        if (girdi.Enlem is double e && (e < -90 || e > 90))
            return BadRequest(new
            {
                hata = "Enlem değeri geçersiz.",
                ayrinti = "Enlem -90 ile 90 arasında olmalıdır. Türkiye için 36-42 aralığındadır."
            });

        if (girdi.Boylam is double b && (b < -180 || b > 180))
            return BadRequest(new
            {
                hata = "Boylam değeri geçersiz.",
                ayrinti = "Boylam -180 ile 180 arasında olmalıdır. Türkiye için 26-45 aralığındadır."
            });

        using var db = _vt.Baglanti();

        /* Mevcut kod korunur; yalnızca 'yenile' istendiğinde değişir.
           Kod değişince o şubedeki asılı çıktı geçersiz kalır. */
        var mevcut = db.ExecuteScalar<string>(
            "SELECT kod FROM KRY_SUBE_KAREKOD WHERE sube_kodu = @kod",
            new { kod = girdi.SubeKodu.Trim() });

        var kod = girdi.Yenile || string.IsNullOrWhiteSpace(mevcut)
            ? KarekodUret()
            : mevcut;

        db.Execute(@"
MERGE KRY_SUBE_KAREKOD AS h
USING (SELECT @subeKodu AS k) AS y ON h.sube_kodu = y.k
WHEN MATCHED THEN
    UPDATE SET kod = @kod, sube_adi = @subeAdi,
               enlem = @enlem, boylam = @boylam,
               yenilenme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (sube_kodu, sube_adi, kod, enlem, boylam)
    VALUES (@subeKodu, @subeAdi, @kod, @enlem, @boylam);",
            new
            {
                subeKodu = girdi.SubeKodu.Trim(),
                subeAdi = girdi.SubeAdi,
                kod,
                enlem = girdi.Enlem,
                boylam = girdi.Boylam
            });

        return Ok(new { basarili = true, kod });
    }

    /// <summary>
    /// Karekod içeriği. Rastgele ve tahmin edilemez olmalı; şube kodundan
    /// türetilirse biri kendi kodunu üretip uzaktan okutabilir.
    /// </summary>
    private static string KarekodUret()
    {
        var bayt = new byte[16];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bayt);

        return "BICEN-" + Convert.ToHexString(bayt);
    }

    public class HariciKarekodGirdi
    {
        public string SubeKodu { get; set; }
        public string SubeAdi { get; set; }
        public string Kod { get; set; }
    }

    /// <summary>Panelden şubeye mevcut (iCard) karekod metni tanımlar.</summary>
    [HttpPost("KarekodHarici")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult KarekodHariciEkle([FromBody] HariciKarekodGirdi g)
    {
        var kod = (g?.Kod ?? "").Trim();
        kod = KarekodGuid(kod) ?? kod;

        if (string.IsNullOrWhiteSpace(g?.SubeKodu)) return BadRequest(new { hata = "Şube belirtiniz." });
        if (kod.Length == 0 || kod.Length > 400) return BadRequest(new { hata = "Karekod metnini giriniz (en fazla 400 karakter)." });

        using var db = _vt.Baglanti();

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_SUBE_KAREKOD WHERE kod = @kod", new { kod }) > 0)
            return BadRequest(new { hata = "Bu metin zaten bir şubenin Biçen karekodu." });

        if (db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_SUBE_KAREKOD_HARICI WHERE kod = @kod AND sube_kodu = @s",
                new { kod, s = g.SubeKodu.Trim() }) == 0)
            db.Execute(@"
INSERT INTO KRY_SUBE_KAREKOD_HARICI (sube_kodu, sube_adi, kod, kaynak, tanimlayan)
VALUES (@s, @a, @kod, N'iCard', @yapan)",
                new { s = g.SubeKodu.Trim(), a = g.SubeAdi, kod, yapan = User?.Identity?.Name ?? "panel" });

        return Ok(new { basarili = true });
    }

    /// <summary>Şubeye tanıtılmış mevcut karekodu kaldırır.</summary>
    [HttpDelete("KarekodHarici/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult KarekodHariciSil(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute("DELETE FROM KRY_SUBE_KAREKOD_HARICI WHERE id = @id", new { id });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Metindeki GUID (iCard erişim noktası kodu), küçük harfle. iCard
    /// karekodu GUID'in kendisi ya da GUID içeren bir adres olabiliyor;
    /// eşleştirme ikisinde de GUID üzerinden.
    /// </summary>
    private static string KarekodGuid(string metin)
    {
        var m = System.Text.RegularExpressions.Regex.Match(metin ?? "",
            @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

        return m.Success ? m.Value.ToLowerInvariant() : null;
    }

    public class IcardAktarGirdi
    {
        /// <summary>iCard AccessPoint tablosundan kopyalanan satırlar (başlık satırıyla).</summary>
        public string Metin { get; set; }
    }

    /// <summary>
    /// iCard erişim noktalarını toplu içe aktarır (29.09.2026).
    ///
    /// <para>
    /// iCard'ın <c>AccessPoint</c> tablosu SQL Server Management Studio'dan
    /// başlıklarıyla kopyalanıp yapıştırılıyor. Her satırın <c>Name</c>
    /// alanı şube adıyla eşleştiriliyor, <c>QRCode</c> (GUID) o şubenin
    /// mevcut karekodu olarak tanımlanıyor. Şubenin konumu girilmemişse
    /// iCard'daki <c>Latitude</c>/<c>Longitude</c> yazılıyor. Pasif
    /// (<c>Active = 0</c>) erişim noktaları atlanıyor.
    /// </para>
    /// </summary>
    [HttpPost("KarekodIcardAktar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
               + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult KarekodIcardAktar([FromBody] IcardAktarGirdi g)
    {
        var satirlar = (g?.Metin ?? "")
            .Replace("\r", "")
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Where(x => x.Trim().Length > 0)
            .ToList();

        if (satirlar.Count < 2)
            return BadRequest(new { hata = "Başlık satırıyla birlikte en az bir satır yapıştırınız." });

        static string[] Bol(string satir) =>
            (satir.Contains('\t') ? satir.Split('\t') : satir.Split(';')).Select(x => x.Trim()).ToArray();

        var baslik = Bol(satirlar[0]);

        int Sutun(string ad) => Array.FindIndex(baslik, x => string.Equals(x, ad, StringComparison.OrdinalIgnoreCase));

        var iAd = Sutun("Name");
        var iKod = Sutun("QRCode");
        var iEnlem = Sutun("Latitude");
        var iBoylam = Sutun("Longitude");
        var iAktif = Sutun("Active");

        if (iAd < 0 || iKod < 0)
            return BadRequest(new
            {
                hata = "Başlık satırında Name ve QRCode sütunları bulunamadı.",
                ayrinti = "SQL Server Management Studio'da sonucu sağ tıklayıp \"Copy with Headers\" ile kopyalayınız."
            });

        static double? Sayi(string[] p, int i)
        {
            if (i < 0 || i >= p.Length) return null;
            var t = p[i].Replace(',', '.');
            return double.TryParse(t, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : null;
        }

        static string N(string x) =>
            (x ?? "").Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));

        var subeler = (_ayar.FormOku().Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

        Sube SubeBul(string ad)
        {
            var tam = subeler.FirstOrDefault(x => N(x.Ad) == N(ad));
            if (tam is not null) return tam;

            var benzer = subeler
                .Where(x => PersonelKaynagiServisi.Benziyor(
                    PersonelKaynagiServisi.BirimAnahtari(x.Ad), PersonelKaynagiServisi.BirimAnahtari(ad)))
                .ToList();

            return benzer.Count == 1 ? benzer[0] : null;
        }

        using var db = _vt.Baglanti();

        var yapan = User?.Identity?.Name ?? "panel";
        int eklenen = 0, zatenVar = 0, konumYazilan = 0, pasif = 0;
        var eslesmeyen = new List<string>();
        var gecersiz = new List<string>();

        foreach (var satir in satirlar.Skip(1))
        {
            var p = Bol(satir);

            if (p.Length <= Math.Max(iAd, iKod)) continue;

            var ad = p[iAd];

            if (iAktif >= 0 && iAktif < p.Length && p[iAktif] == "0") { pasif++; continue; }

            var kod = KarekodGuid(p[iKod]);

            if (kod is null) { gecersiz.Add(ad); continue; }

            var sube = SubeBul(ad);

            if (sube is null) { eslesmeyen.Add(ad); continue; }

            var subeKodu = sube.Kod.Trim();

            if (db.ExecuteScalar<int>(
                    "SELECT COUNT(*) FROM KRY_SUBE_KAREKOD_HARICI WHERE kod = @kod AND sube_kodu = @subeKodu",
                    new { kod, subeKodu }) > 0)
            {
                zatenVar++;
            }
            else
            {
                db.Execute(@"
INSERT INTO KRY_SUBE_KAREKOD_HARICI (sube_kodu, sube_adi, kod, kaynak, tanimlayan)
VALUES (@subeKodu, @subeAdi, @kod, N'iCard', @yapan)",
                    new { subeKodu, subeAdi = sube.Ad, kod, yapan });
                eklenen++;
            }

            /* Şube konumu yoksa iCard'daki konum */
            var e = Sayi(p, iEnlem);
            var b = Sayi(p, iBoylam);

            if (e is double en && b is double boy && en is >= -90 and <= 90 && boy is >= -180 and <= 180 && en != 0)
            {
                var mevcut = db.QueryFirstOrDefault(
                    "SELECT enlem, boylam FROM KRY_SUBE_KAREKOD WHERE sube_kodu = @subeKodu", new { subeKodu });

                if (mevcut is null)
                {
                    db.Execute(@"
INSERT INTO KRY_SUBE_KAREKOD (sube_kodu, sube_adi, kod, enlem, boylam)
VALUES (@subeKodu, @subeAdi, @yeniKod, @en, @boy)",
                        new { subeKodu, subeAdi = sube.Ad, yeniKod = KarekodUret(), en, boy });
                    konumYazilan++;
                }
                else if (mevcut.enlem is null || mevcut.boylam is null)
                {
                    db.Execute("UPDATE KRY_SUBE_KAREKOD SET enlem = @en, boylam = @boy WHERE sube_kodu = @subeKodu",
                        new { subeKodu, en, boy });
                    konumYazilan++;
                }
            }
        }

        _kayit.LogInformation(
            "iCard karekodları aktarıldı: {Eklenen} yeni, {Var} zaten vardı, {Konum} konum, eşleşmeyen: {Eslesmeyen}",
            eklenen, zatenVar, konumYazilan, string.Join(", ", eslesmeyen));

        return Ok(new { eklenen, zatenVar, konumYazilan, pasif, eslesmeyen, gecersiz });
    }


    /// <summary>Son geçiş hareketleri.</summary>    /// <summary>Son geçiş hareketleri.</summary>
    private List<object> SonHareketler(PersonelKaydi p)
    {
        try
        {
            using var db = _vt.Baglanti();

            return db.Query(@"
SELECT TOP 5 gecis_zamani AS zaman, tur, sube_adi AS subeAdi,
       CASE WHEN CAST(gecis_zamani AS DATE) = CAST(SYSDATETIME() AS DATE)
            THEN N'Bugün'
            WHEN CAST(gecis_zamani AS DATE) = DATEADD(day, -1, CAST(SYSDATETIME() AS DATE))
            THEN N'Dün'
            ELSE FORMAT(gecis_zamani, 'dd.MM') END AS gun
FROM KRY_VARDIYA
WHERE personel_kodu = @kod
ORDER BY gecis_zamani DESC", new { kod = p.PersonelKodu })
                .Cast<object>()
                .ToList();
        }
        catch
        {
            return new List<object>();
        }
    }
}

/// <summary>
/// Ücret pusulasına itiraz.
///
/// Adı "PusulaItirazGirdi": vardiya düzeltme itirazı için Modeller.cs
/// içinde zaten bir ItirazGirdi var ve ikisi aynı isim alanında.
/// </summary>
public class PusulaItirazGirdi
{
    /// <summary>Hazır sebep listesinden seçilen başlık.</summary>
    public string Sebep { get; set; }

    public string Aciklama { get; set; }
}

/// <summary>Mobilden gönderilen iş içeriği doldurması.</summary>
public class MobilDoldurmaGirdi
{
    public string Doldurma { get; set; }
    public int Ilerleme { get; set; }
}

/// <summary>Mobilden atanan iş.</summary>
public class MobilIsGirdi
{
    public string Baslik { get; set; }
    public string Aciklama { get; set; }
    public string Oncelik { get; set; }
    public string AtananKod { get; set; }
    public DateTime? SonTarih { get; set; }

    /// <summary>Blok içeriği (JSON); mobilde şimdilik kontrol listesi.</summary>
    public string Icerik { get; set; }
}

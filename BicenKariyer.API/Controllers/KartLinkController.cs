using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen Kart bağlantısı (ayrılan ya da çalışan personel) — herkese açık uçlar (02.10.2026)
/// ---------------------------------------------------------------------------
/// SMS'teki <c>#/kart/KOD</c> sayfası bu uçlarla çalışıyor. Oturum yok; kod,
/// TC doğrulaması ve cihaz belirteci birlikte anahtar.
///
/// <list type="number">
/// <item><b>İlk açılış:</b> yalnızca ilk ad, bakiye, kartın son dört hanesi
/// ve geçerlilik. Kart numarası istemciye hiç gönderilmiyor.</item>
/// <item><b>Kimlik:</b> TC'nin tamamı; gönderimde yazılan HMAC özetiyle
/// sabit sürede karşılaştırılıyor (Mikro'ya gidilmiyor). Kod başına on
/// hatalı denemede bağlantı bir saat kilitleniyor; üçüncü kilit süresiz
/// (İK panelden açar). Adres başına ayrıca saatte yirmi hata sınırı.</item>
/// <item><b>Cihaz:</b> doğrulamadan sonra rastgele belirteç (localStorage +
/// HttpOnly çerez); tabloda yalnızca özeti. Şifre belirlenene kadar 30
/// dakika, sonra 180 gün geçerli.</item>
/// <item><b>Şifre:</b> dört hane, iki kez; panelin şifre işlemiyle aynı yazma
/// yolu (<see cref="GiftKartServisi.KartSifresiYaz"/>). Belirlenmiş şifreyi
/// değiştirmek için o cihazda son on dakikada TC doğrulaması gerekiyor.</item>
/// <item><b>Kart:</b> şifre belirlendikten sonra numara, barkod için numara,
/// son hareketler. Ödeme kasada kart şifresiyle; günlük kod gösterilmez.
/// Bakiye sıfırsa ya da süre dolduysa numara yine gönderilmiyor.</item>
/// </list>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class KartLinkController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly GiftKartServisi _giftKart;
    private readonly KartLinkHizSiniri _hiz;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<KartLinkController> _kayit;

    private const string AYR = KartAyrilan.TABLO;
    private const string CIHAZ = KartAyrilan.CIHAZ;
    private const string KART = "[PosbackPromosyon].[dbo].[MusteriKart]";

    public KartLinkController(VeritabaniServisi vt, GiftKartServisi giftKart, KartLinkHizSiniri hiz,
        IConfiguration yapilandirma, ILogger<KartLinkController> kayit)
    {
        _vt = vt;
        _giftKart = giftKart;
        _hiz = hiz;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Adres => IstemciAdresi.Bul(HttpContext);

    private sealed class Cihaz
    {
        public int Id { get; set; }
        public DateTime Gecerlilik { get; set; }
        public DateTime? Dogrulama { get; set; }
    }

    public class DogrulaGirdi
    {
        public string Tc { get; set; }
    }

    public class SifreGirdi
    {
        public string Sifre { get; set; }
        public string SifreTekrar { get; set; }
    }

    /* ==================================================================== */
    /* Ortak                                                                */
    /* ==================================================================== */

    /// <summary>
    /// İsteğin ilk adımı: hız sınırı, kod biçimi, bağlantı satırı. Hata varsa
    /// <paramref name="sonuc"/> dolu döner.
    /// </summary>
    private KartAyrilanSatiri Hazirla(System.Data.IDbConnection db, string kod, out IActionResult sonuc)
    {
        sonuc = null;

        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        Response.Headers["X-Robots-Tag"] = "noindex, nofollow";

        if (!_hiz.Kabul(Adres, out var sebep))
        {
            sonuc = StatusCode(429, new { hata = sebep });
            return null;
        }

        var k = KartAyrilan.KodTemizle(kod);

        var satir = k is null
            ? null
            : db.QueryFirstOrDefault<KartAyrilanSatiri>(
                $"SELECT {KartAyrilan.SUTUNLAR} FROM {AYR} WHERE kod = @k", new { k });

        if (satir is null)
        {
            _hiz.Hata(Adres);
            sonuc = NotFound(new { hata = "Bağlantı bulunamadı. Adresi SMS'teki gibi eksiksiz açtığınızdan emin olunuz." });
        }

        return satir;
    }

    /// <summary>
    /// Kartı kullanılamaz kılan durum: iptal, kart boşa çıkarılmış ya da
    /// başkasına geçmiş, süre dolmuş, kilit. Yoksa null.
    /// </summary>
    private object Engel(System.Data.IDbConnection db, KartAyrilanSatiri b, DateTime simdi)
    {
        var ad = KartAyrilan.IlkAd(b.AdSoyad);

        if (b.Iptal)
            return new { durum = "iptal", ad };

        if (b.Birakildi is not null || !KartAyrilan.KartKisininMi(db, b.KartNo, b.PersonelKodu))
            return new { durum = "kullanilamaz", ad };

        if (b.SonGecerlilik < simdi)
            return new { durum = "suresiDoldu", ad, sonGecerlilik = b.SonGecerlilik };

        if (b.KilitBitis is DateTime kb && kb > simdi)
            return new
            {
                durum = "kilitli",
                ad,
                kilitBitis = kb >= KartAyrilan.SuresizKilit.AddYears(-1) ? (DateTime?)null : kb,
            };

        return null;
    }

    /// <summary>Belirteçler: başlıktaki (localStorage) ve çerezdeki.</summary>
    private IEnumerable<string> Belirtecler(string kod)
    {
        var baslik = Request.Headers[KartAyrilan.CIHAZ_BASLIGI].FirstOrDefault();
        var cerez = Request.Cookies[KartAyrilan.CerezAdi(kod)];

        return new[] { baslik, cerez }
            .Where(x => !string.IsNullOrWhiteSpace(x) && x.Length is >= 20 and <= 100)
            .Distinct();
    }

    /// <summary>Bu bağlantı için tanınan, süresi geçmemiş cihaz; yoksa null.</summary>
    private Cihaz CihazBul(System.Data.IDbConnection db, KartAyrilanSatiri b, byte[] anahtar)
    {
        foreach (var belirtec in Belirtecler(b.Kod))
        {
            var c = db.QueryFirstOrDefault<Cihaz>($@"
SELECT TOP 1 id AS Id, gecerlilik AS Gecerlilik, dogrulama AS Dogrulama
FROM {CIHAZ}
WHERE token_ozet = @ozet AND baglanti_id = @id AND iptal = 0 AND gecerlilik > SYSDATETIME()",
                new { ozet = KartAyrilan.CihazOzeti(anahtar, belirtec), id = b.Id });

            if (c is not null) return c;
        }

        return null;
    }

    private void CerezYaz(string kod, string belirtec) =>
        Response.Cookies.Append(KartAyrilan.CerezAdi(kod), belirtec, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            Expires = DateTimeOffset.Now.Add(KartAyrilan.UzunCihaz),
            IsEssential = true,
        });

    private byte[] Anahtar() => KartAyrilan.Anahtar(_yapilandirma);

    /* ==================================================================== */
    /* Açılış                                                               */
    /* ==================================================================== */

    /// <summary>
    /// Bağlantının durumu. Tanınan cihazda ve şifre belirlenmişse kart
    /// bilgileri, değilse yalnızca ilk ad, bakiye ve son dört hane.
    /// </summary>
    [HttpGet("{kod}")]
    public IActionResult Ac(string kod)
    {
        using var db = _vt.Baglanti();

        var b = Hazirla(db, kod, out var sonuc);

        if (b is null) return sonuc;

        var simdi = DateTime.Now;

        db.Execute($@"
UPDATE {AYR}
SET ilk_acilis = COALESCE(ilk_acilis, SYSDATETIME()), son_acilis = SYSDATETIME(), acilis_sayisi = acilis_sayisi + 1
WHERE id = @id", new { id = b.Id });

        if (b.IlkAcilis is null) KartAyrilan.OlayYaz(db, b.Id, "acildi", "Bağlantı ilk kez açıldı", null, Adres);

        var engel = Engel(db, b, simdi);

        if (engel is not null) return Ok(engel);

        decimal bakiye;

        try
        {
            using var pos = _vt.PosBaglantisi();
            bakiye = GiftKartServisi.BakiyeSorgusu(pos, b.KartNo.Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bağlantısı: bakiye okunamadı ({Id})", b.Id);
            return StatusCode(503, new { hata = "Kart bilgisi şu anda okunamıyor. Lütfen biraz sonra tekrar deneyiniz." });
        }

        var ad = KartAyrilan.IlkAd(b.AdSoyad);

        if (bakiye <= 0m)
        {
            db.Execute($"UPDATE {AYR} SET tamamlandi = COALESCE(tamamlandi, SYSDATETIME()), son_bakiye = 0, bakiye_kontrol = SYSDATETIME() WHERE id = @id",
                new { id = b.Id });

            return Ok(new { durum = "tamamlandi", ad });
        }

        var temel = new
        {
            ad,
            bakiye,
            kartSon4 = KartAyrilan.SonDort(b.KartNo),
            sonGecerlilik = b.SonGecerlilik,
            kalanGun = (int)Math.Ceiling((b.SonGecerlilik - simdi).TotalDays),
            toplamGun = Math.Max(1, (int)Math.Round((b.SonGecerlilik - (b.SmsIlk ?? b.Gonderim)).TotalDays)),
        };

        byte[] anahtar;

        try
        {
            anahtar = Anahtar();
        }
        catch (Exception hata)
        {
            _kayit.LogError("Kart bağlantısı anahtarı yok: {Mesaj}", hata.Message);
            return StatusCode(503, new { hata = "Sayfa şu anda açılamıyor. Lütfen İnsan Kaynakları ile görüşünüz." });
        }

        var cihaz = CihazBul(db, b, anahtar);

        if (cihaz is null)
            return Ok(new
            {
                durum = "dogrulama",
                temel.ad, temel.bakiye, temel.kartSon4, temel.sonGecerlilik, temel.kalanGun, temel.toplamGun,
                kalanDeneme = Math.Max(0, KartAyrilan.EnFazlaHata - b.HataliDeneme),
                sifreVar = b.SifreGecerli,
            });

        db.Execute($"UPDATE {CIHAZ} SET son_kullanim = SYSDATETIME(), kullanim_sayisi = kullanim_sayisi + 1 WHERE id = @id",
            new { id = cihaz.Id });

        if (!b.SifreGecerli)
            return Ok(new
            {
                durum = "sifre",
                temel.ad, temel.bakiye, temel.kartSon4, temel.sonGecerlilik, temel.kalanGun, temel.toplamGun,

                /* Şifre bizim tarafımızdan kilitlendiyse (süre uzatıldıktan
                   sonra) kişiye neden yeniden sorulduğu söyleniyor */
                yenidenBelirle = b.SifreTarihi is not null,
            });

        /* Kart bilgileri: yalnızca bu noktada */
        string cepTel = null;
        var mobil = false;

        try
        {
            using var pos = _vt.PosBaglantisi();

            var k = pos.QueryFirstOrDefault($@"
SELECT TOP 1 CASE WHEN CepTel IS NULL OR CepTel = 0 THEN NULL
                  ELSE RIGHT(CONVERT(VARCHAR(20), CepTel), 10) END AS tel,
       GrupNo AS grup
FROM {KART} WHERE KartNo = CONVERT(VARCHAR(50), @kart)", new { kart = b.KartNo.Trim() }, commandTimeout: 30);

            if (k is not null)
            {
                cepTel = (string)k.tel;
                mobil = k.grup is not null && Convert.ToInt32(k.grup) == GiftKartServisi.MOBIL_GRUP;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bağlantısı: kart kaydı okunamadı ({Id})", b.Id);
        }


        return Ok(new
        {
            durum = "kart",
            temel.ad, temel.bakiye, temel.kartSon4, temel.sonGecerlilik, temel.kalanGun, temel.toplamGun,
            adSoyad = b.AdSoyad,
            kartNo = b.KartNo.Trim(),
            mobil,

            /* Günlük ödeme kodu gösterilmiyor (02.10.2026): kasada yalnızca
               barkod okutulup kart şifresiyle ödeme yapılıyor. */

            hareketler = _giftKart.Hareketler(b.KartNo.Trim(), 10),

            /* Şifre değiştirmek için TC yeniden sorulmasın: az önce doğrulandı */
            tazeDogrulama = cihaz.Dogrulama is DateTime d && simdi - d < KartAyrilan.TazeDogrulama,
        });
    }

    /* ==================================================================== */
    /* Kimlik doğrulama                                                     */
    /* ==================================================================== */

    [HttpPost("{kod}/Dogrula")]
    public IActionResult Dogrula(string kod, [FromBody] DogrulaGirdi girdi)
    {
        using var db = _vt.Baglanti();

        var b = Hazirla(db, kod, out var sonuc);

        if (b is null) return sonuc;

        var simdi = DateTime.Now;
        var engel = Engel(db, b, simdi);

        if (engel is not null) return Conflict(engel);

        var tc = KartAyrilan.KimlikNormal(girdi?.Tc);

        if (tc is null) return BadRequest(new { hata = "TC kimlik numarası 11 haneli olmalıdır." });

        byte[] anahtar;

        try
        {
            anahtar = Anahtar();
        }
        catch (Exception hata)
        {
            _kayit.LogError("Kart bağlantısı anahtarı yok: {Mesaj}", hata.Message);
            return StatusCode(503, new { hata = "Doğrulama şu anda yapılamıyor. Lütfen İnsan Kaynakları ile görüşünüz." });
        }

        if (!KartAyrilan.OzetEsit(KartAyrilan.KimlikOzeti(anahtar, b.Kod, tc), b.KimlikHash))
        {
            _hiz.Hata(Adres);

            var d = db.QuerySingle($@"
UPDATE {AYR} SET hatali_deneme = hatali_deneme + 1
OUTPUT INSERTED.hatali_deneme AS hatali, INSERTED.kilit_sayisi AS kilitSayisi
WHERE id = @id", new { id = b.Id });

            int hatali = d.hatali, kilitSayisi = d.kilitSayisi;

            if (hatali >= KartAyrilan.EnFazlaHata)
            {
                kilitSayisi++;

                var bitis = kilitSayisi >= KartAyrilan.SuresizKilitSayisi
                    ? KartAyrilan.SuresizKilit
                    : simdi.Add(KartAyrilan.KilitSuresi);

                db.Execute($@"
UPDATE {AYR} SET kilit_bitis = @bitis, hatali_deneme = 0, kilit_sayisi = @kilitSayisi WHERE id = @id",
                    new { id = b.Id, bitis, kilitSayisi });

                var suresiz = bitis == KartAyrilan.SuresizKilit;

                KartAyrilan.OlayYaz(db, b.Id, "kilit",
                    suresiz
                        ? $"{KartAyrilan.EnFazlaHata} hatalı TC denemesi; bağlantı süresiz kilitlendi ({kilitSayisi}. kilit)"
                        : $"{KartAyrilan.EnFazlaHata} hatalı TC denemesi; bağlantı {bitis:HH:mm}'e kadar kilitlendi",
                    null, Adres);

                _kayit.LogWarning("Kart bağlantısı kilitlendi: {Id} ({Adres})", b.Id, Adres);

                return StatusCode(423, new
                {
                    durum = "kilitli",
                    hata = suresiz
                        ? "Çok sayıda hatalı deneme yapıldı. Bağlantı kilitlendi; İnsan Kaynakları ile görüşünüz."
                        : "Çok sayıda hatalı deneme yapıldı. Bağlantı bir saatliğine kilitlendi.",
                    kilitBitis = suresiz ? (DateTime?)null : bitis,
                });
            }

            KartAyrilan.OlayYaz(db, b.Id, "tc_hatali", $"Hatalı TC denemesi ({hatali}/{KartAyrilan.EnFazlaHata})", null, Adres);

            return BadRequest(new
            {
                hata = "TC kimlik numarası kayıtlarımızla eşleşmedi.",
                kalanDeneme = Math.Max(0, KartAyrilan.EnFazlaHata - hatali),
            });
        }

        db.Execute($@"
UPDATE {AYR}
SET hatali_deneme = 0, kimlik_dogrulama = COALESCE(kimlik_dogrulama, SYSDATETIME()), son_dogrulama = SYSDATETIME()
WHERE id = @id", new { id = b.Id });

        KartAyrilan.OlayYaz(db, b.Id, "kimlik", "TC kimlik doğrulandı", null, Adres);

        var gecerlilik = simdi.Add(b.SifreGecerli ? KartAyrilan.UzunCihaz : KartAyrilan.KisaCihaz);
        var cihaz = CihazBul(db, b, anahtar);
        string yeni = null;

        if (cihaz is not null)
        {
            db.Execute($@"
UPDATE {CIHAZ} SET dogrulama = SYSDATETIME(),
    gecerlilik = CASE WHEN gecerlilik < @gecerlilik THEN @gecerlilik ELSE gecerlilik END
WHERE id = @id", new { id = cihaz.Id, gecerlilik });
        }
        else
        {
            yeni = KartAyrilan.YeniBelirtec();

            db.Execute($@"
INSERT INTO {CIHAZ} (baglanti_id, token_ozet, gecerlilik, dogrulama, son_kullanim, ip, tarayici)
VALUES (@id, @ozet, @gecerlilik, SYSDATETIME(), SYSDATETIME(), @ip, @tarayici)",
                new
                {
                    id = b.Id,
                    ozet = KartAyrilan.CihazOzeti(anahtar, yeni),
                    gecerlilik,
                    ip = KartAyrilan.Kisalt(Adres, 64),
                    tarayici = KartAyrilan.Kisalt(Request.Headers.UserAgent.ToString(), 200),
                });

            CerezYaz(b.Kod, yeni);

            KartAyrilan.OlayYaz(db, b.Id, "cihaz", "Yeni cihaz tanındı", null, Adres);
        }

        return Ok(new { tamam = true, cihaz = yeni, sonraki = b.SifreGecerli ? "kart" : "sifre" });
    }

    /* ==================================================================== */
    /* Şifre                                                                */
    /* ==================================================================== */

    [HttpPost("{kod}/Sifre")]
    public IActionResult Sifre(string kod, [FromBody] SifreGirdi girdi)
    {
        using var db = _vt.Baglanti();

        var b = Hazirla(db, kod, out var sonuc);

        if (b is null) return sonuc;

        var simdi = DateTime.Now;
        var engel = Engel(db, b, simdi);

        if (engel is not null) return Conflict(engel);

        var cihaz = CihazBul(db, b, Anahtar());

        if (cihaz is null)
            return StatusCode(401, new { hata = "Önce TC kimlik numaranızı doğrulayınız.", durum = "dogrulama" });

        /* Var olan şifreyi değiştirmek: bu cihazda taze TC doğrulaması şart */
        if (b.SifreGecerli && !(cihaz.Dogrulama is DateTime d && simdi - d < KartAyrilan.TazeDogrulama))
            return StatusCode(403, new
            {
                hata = "Şifre değiştirmek için TC kimlik numaranızı yeniden doğrulayınız.",
                tcGerekli = true,
            });

        var sifre = new string((girdi?.Sifre ?? "").Where(char.IsDigit).ToArray());
        var tekrar = new string((girdi?.SifreTekrar ?? "").Where(char.IsDigit).ToArray());

        if (sifre != tekrar) return BadRequest(new { hata = "Girdiğiniz iki şifre aynı değil." });

        var kural = GiftKartServisi.SifreKuraliHatasi(sifre);

        if (kural is not null) return BadRequest(new { hata = kural });

        try
        {
            using var pos = _vt.PosBaglantisi();

            if (GiftKartServisi.BakiyeSorgusu(pos, b.KartNo.Trim()) <= 0m)
                return Conflict(new { durum = "tamamlandi", ad = KartAyrilan.IlkAd(b.AdSoyad) });

            /* Panelin şifre işlemiyle aynı yazma yolu: yazıp geri okuyarak doğrular */
            var (tamam, hata) = GiftKartServisi.KartSifresiYaz(pos, b.KartNo.Trim(), sifre, _kayit);

            if (!tamam) return StatusCode(502, new { hata });

            /* Kasada harcamada şifre sorulsun: ödeme yalnızca barkod +
               kart şifresiyle yapılıyor. Kart fiziki kipe alınıyor
               (GrupNo NULL): mobil kipte (608) kasa şifre değil ödeme kodu
               soruyor ve bağlantıdaki kişinin uygulaması yok (05.10.2026). */
            pos.Execute($@"
UPDATE [PosbackPromosyon].[dbo].[MusteriKart]
SET PuanHarcamaSmsSifre = 1, GrupNo = NULL
WHERE KartNo = CONVERT(VARCHAR(50), @kartNo) AND (ISNULL(PuanHarcamaSmsSifre, 0) <> 1 OR GrupNo IS NOT NULL)",
                new { kartNo = b.KartNo.Trim() }, commandTimeout: 30);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart bağlantısı: şifre yazılamadı ({Id})", b.Id);
            return StatusCode(503, new { hata = "Şifre şu anda kaydedilemiyor. Lütfen biraz sonra tekrar deneyiniz." });
        }

        var ilk = b.SifreTarihi is null;

        db.Execute($@"
UPDATE {AYR} SET sifre_tarihi = SYSDATETIME(), sifre_sayisi = sifre_sayisi + 1 WHERE id = @id;
UPDATE {CIHAZ} SET gecerlilik = @uzun WHERE id = @cihaz AND gecerlilik < @uzun;",
            new { id = b.Id, cihaz = cihaz.Id, uzun = simdi.Add(KartAyrilan.UzunCihaz) });

        KartAyrilan.OlayYaz(db, b.Id, ilk ? "sifre" : "sifre_degisti",
            ilk ? "Kart şifresi belirlendi" : b.SifreGecerli ? "Kart şifresi değiştirildi" : "Kart şifresi yeniden belirlendi",
            null, Adres);

        _kayit.LogInformation("Kart bağlantısı: kart şifresi belirlendi, bağlantı {Id} ({Tur})", b.Id, b.Tur);

        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Görsel indirme ve cihazdan çıkış                                     */
    /* ==================================================================== */

    [HttpPost("{kod}/Indirildi")]
    public IActionResult Indirildi(string kod)
    {
        using var db = _vt.Baglanti();

        var b = Hazirla(db, kod, out var sonuc);

        if (b is null) return sonuc;

        if (CihazBul(db, b, Anahtar()) is null) return StatusCode(401, new { hata = "Cihaz tanınmadı." });

        db.Execute($@"
UPDATE {AYR} SET gorsel_indirme = SYSDATETIME(), indirme_sayisi = indirme_sayisi + 1 WHERE id = @id",
            new { id = b.Id });

        KartAyrilan.OlayYaz(db, b.Id, "gorsel", "Kart görseli indirildi", null, Adres);

        return Ok(new { tamam = true });
    }

    /// <summary>Bu cihazı unutur: belirteç geçersiz olur, çerez silinir.</summary>
    [HttpPost("{kod}/Cikis")]
    public IActionResult Cikis(string kod)
    {
        using var db = _vt.Baglanti();

        var b = Hazirla(db, kod, out var sonuc);

        if (b is null) return sonuc;

        var cihaz = CihazBul(db, b, Anahtar());

        if (cihaz is not null)
        {
            db.Execute($"UPDATE {CIHAZ} SET iptal = 1 WHERE id = @id", new { id = cihaz.Id });
            KartAyrilan.OlayYaz(db, b.Id, "cihaz_cikis", "Cihazdan çıkış yapıldı", null, Adres);
        }

        Response.Cookies.Delete(KartAyrilan.CerezAdi(b.Kod), new CookieOptions { Path = "/" });

        return Ok(new { tamam = true });
    }
}

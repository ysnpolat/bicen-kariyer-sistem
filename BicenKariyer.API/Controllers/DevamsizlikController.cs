using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Devamsızlık (23.10.2026).
///
/// <list type="number">
/// <item>Birim yöneticisi Biçen360'tan, vardiya girişi olmayan güne
/// devamsızlık girer (Yönetici › Devamsızlık, Ekibim kişi ayrıntısı ya da
/// "vardiya girişini yapmadı" bildirimi). İzinli, raporlu, haftalık
/// izinli, resmî tatil ve okutmadan muaf günlere girilemez.</item>
/// <item>Vardiya planında, Puantaj'da ve Ekibim'de gün "Devamsız" yazar.</item>
/// <item>İK panelinde Personel Talepleri › Devamsızlık: dönemde eşikten
/// (varsayılan 3) fazla gün devamsızlığı olanlar öne çıkar. İK personele
/// uygulama bildirimi ve SMS gönderir, not düşer ya da yanlış girilen
/// günü kaldırır. Her işlem kayıt altında.</item>
/// <item>Tutanak (26.10.2026): açıklama ve iki şahit zorunlu. Kayıt hemen
/// işlenir; tutanak üretilip mail gider (izin formu alıcı kuralı), giren
/// imzalı tutanağı yükler, şahitler uygulamadan onaylar. Tutanak durumu
/// panelde ve kayıtta ayrıca izlenir (<see cref="DevamsizlikTutanakServisi"/>).</item>
/// </list>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DevamsizlikController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly SmsServisi _sms;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly DevamsizlikTutanakServisi _tutanak;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<DevamsizlikController> _kayit;

    public DevamsizlikController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim,
        SmsServisi sms, PersonelKaynagiServisi kaynak, DevamsizlikTutanakServisi tutanak,
        IConfiguration yapilandirma, IWebHostEnvironment ortam, ILogger<DevamsizlikController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _sms = sms;
        _kaynak = kaynak;
        _tutanak = tutanak;
        _yapilandirma = yapilandirma;
        _ortam = ortam;
        _kayit = kayit;
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string AdSoyad(PersonelKaydi p) => $"{p.Ad} {p.Soyad}".Trim();

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool PersonelMi => User?.IsInRole("Personel") ?? false;

    private bool IkYetkili =>
        !PersonelMi && Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    private string PanelAdi => User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return i < 0 ? govde : govde[..i];
    }

    private static int GeriGun => Math.Clamp(Parametre.Sayi("devamsizlik.geriGun") is var g && g > 0 ? g : 7, 1, 60);

    private EkipController EkipKoprusu()
    {
        var c = ActivatorUtilities.CreateInstance<EkipController>(HttpContext.RequestServices);
        c.ControllerContext = ControllerContext;
        return c;
    }

    /// <summary>"21, 22 ve 24 Ekim 2026" biçiminde</summary>
    public static string TarihMetni(IEnumerable<DateTime> gunler)
    {
        var l = gunler.Select(x => x.Date).Distinct().OrderBy(x => x).ToList();
        if (l.Count == 0) return "";

        var parcalar = new List<string>();
        foreach (var g in l.GroupBy(x => (x.Year, x.Month)))
        {
            var gunlerAy = g.Select(x => x.Day.ToString()).ToList();
            var ilk = g.First();
            var bas = gunlerAy.Count == 1 ? gunlerAy[0] : string.Join(", ", gunlerAy.Take(gunlerAy.Count - 1)) + " ve " + gunlerAy[^1];
            parcalar.Add($"{bas} {ilk.ToString("MMMM", Tr)}" + (ilk.Year != DateTime.Today.Year || l.Select(x => x.Year).Distinct().Count() > 1 ? $" {ilk.Year}" : ""));
        }

        return string.Join(", ", parcalar);
    }

    /* ==================================================================== */
    /* Biçen360: birim yöneticisi                                            */
    /* ==================================================================== */

    /// <summary>Devamsızlık Girişi modülü bu yöneticide açık mı (portal; tanımsızken kapalı)</summary>
    private bool ModulAcik(PersonelKaydi ben)
    {
        try
        {
            return HttpContext.RequestServices.GetRequiredService<PortalYetkiServisi>()
                .AcikMi(ben.PersonelKodu.Trim(), (ben.Pozisyon ?? "").Trim(), "devamsizlik");
        }
        catch
        {
            return false;
        }
    }

    private IActionResult ModulKapali() =>
        StatusCode(403, new { hata = "Devamsızlık Girişi modülü sizin için açık değil.", ayrinti = "Portal › Yetkiler'den açılabilir." });

    /// <summary>Yöneticinin devamsızlık girebileceği kişiler</summary>
    private List<PersonelKaydi> Kapsam(PersonelKaydi ben)
    {
        var l = new List<PersonelKaydi>();
        var var_ = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { K(ben.PersonelKodu) };

        void Ekle(IEnumerable<PersonelKaydi> x)
        {
            foreach (var p in x ?? Enumerable.Empty<PersonelKaydi>())
                if (var_.Add(K(p.PersonelKodu))) l.Add(p);
        }

        try { Ekle(_ekip.VardiyaKapsami(ben)); } catch { }
        try { Ekle(_ekip.SorumluOlduklari(ben)); } catch { }

        return l.Where(p => _ekip.IslemYapabilir(ben, p)).ToList();
    }

    private static object GunCiktisi(EkipController.Gun g, Dictionary<DateTime, dynamic> kayitlar)
    {
        kayitlar.TryGetValue(g.Tarih.Date, out var d);
        return new
        {
            tarih = g.Tarih,
            durum = g.DevamsizMi ? "devamsiz" : g.Durum,
            izinTuru = g.DevamsizMi ? null : g.IzinTuru,
            giris = g.Giris,
            cikis = g.Cikis,
            devamsizId = (int?)d?.id,
            giren = (string)d?.giren_ad,
            aciklama = (string)d?.aciklama,
            tutanakId = (int?)d?.tutanak_id,
            /* Girilebilir: okutma yok, izin/rapor/haftalık/tatil/muaf değil */
            girilebilir = g.Durum == "okutmadi" && !g.DevamsizMi,
        };
    }

    /// <summary>Ekipte vardiya girişi olmayan günleri olan kişiler (son N gün)</summary>
    [HttpGet("Mobil/Ekip")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilEkip()
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();
        if (!ModulAcik(ben)) return ModulKapali();

        var kisiler = Kapsam(ben);
        var son = DateTime.Today;
        var bas = son.AddDays(-(GeriGun - 1));

        if (kisiler.Count == 0) return Ok(new { geriGun = GeriGun, bas, son, kisiler = Array.Empty<object>() });

        var durumlar = EkipKoprusu().GunDurumlari(kisiler, bas, son);

        var liste = kisiler.Select(p =>
            {
                var gunler = durumlar.GetValueOrDefault(K(p.PersonelKodu)) ?? new();
                return new
                {
                    sicil = (p.PersonelKodu ?? "").Trim(),
                    adSoyad = AdSoyad(p),
                    pozisyon = p.Pozisyon,
                    sube = p.IsGrubu,
                    eksik = gunler.Where(g => g.Durum == "okutmadi" && !g.DevamsizMi).Select(g => g.Tarih).ToList(),
                    devamsiz = gunler.Where(g => g.DevamsizMi).Select(g => g.Tarih).ToList(),
                };
            })
            .Where(x => x.eksik.Count > 0 || x.devamsiz.Count > 0)
            .OrderByDescending(x => x.eksik.Count)
            .ThenBy(x => x.adSoyad, StringComparer.Create(Tr, true))
            .ToList();

        return Ok(new { geriGun = GeriGun, bas, son, kisiler = liste });
    }

    /// <summary>Bir kişinin son N günü: giriş saati, izin türü, devamsızlık</summary>
    [HttpGet("Mobil/Kisi/{sicil}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilKisi(string sicil)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized();
        if (!ModulAcik(ben)) return ModulKapali();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });
        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu) || !_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için devamsızlık giremezsiniz." });

        var son = DateTime.Today;
        var bas = son.AddDays(-(GeriGun - 1));

        var gunler = EkipKoprusu().GunDurumlari(new List<PersonelKaydi> { hedef }, bas, son)
            .GetValueOrDefault(K(hedef.PersonelKodu)) ?? new();

        using var db = _vt.Baglanti();
        var kayitlar = Kayitlar(db, hedef.PersonelKodu, bas, son);

        return Ok(new
        {
            personel = new { sicil = hedef.PersonelKodu.Trim(), adSoyad = AdSoyad(hedef), pozisyon = hedef.Pozisyon, sube = hedef.IsGrubu },
            geriGun = GeriGun,
            gunler = gunler.OrderByDescending(x => x.Tarih).Select(g => GunCiktisi(g, kayitlar)),
        });
    }

    private static Dictionary<DateTime, dynamic> Kayitlar(System.Data.IDbConnection db, string kod, DateTime bas, DateTime son)
    {
        try
        {
            return db.Query(@"
SELECT id, tarih, giren_ad, aciklama, tutanak_id FROM KRY_DEVAMSIZLIK
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND tarih BETWEEN @bas AND @son",
                    new { kod = (kod ?? "").Trim(), kodK = K(kod), bas = bas.Date, son = son.Date })
                .GroupBy(x => ((DateTime)x.tarih).Date)
                .ToDictionary(g => g.Key, g => g.First());
        }
        catch
        {
            return new();
        }
    }

    public class GirisGirdi
    {
        public List<DateTime> Tarihler { get; set; } = new();
        public string Aciklama { get; set; }
        /// <summary>Şahit personel sicilleri (26.10.2026; zorunlu, iki farklı kişi)</summary>
        public string Sahit1 { get; set; }
        public string Sahit2 { get; set; }
    }

    /// <summary>
    /// Şahit olabilecekler (26.10.2026): devamsız personelle aynı şubedeki
    /// aktif personel; o şubede kimse yoksa yöneticinin ekibi. Devamsız
    /// personelin kendisi ve devamsızlığı giren yönetici listede yok.
    /// Kişisel veri dönmüyor: sicil, ad, pozisyon.
    /// </summary>
    private List<PersonelKaydi> SahitAdaylari(PersonelKaydi ben, PersonelKaydi hedef)
    {
        var sube = PersonelKaynagiServisi.BirimAnahtari(hedef.IsGrubu);
        var disarida = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { K(ben.PersonelKodu), K(hedef.PersonelKodu) };

        List<PersonelKaydi> l;
        try
        {
            l = sube.Length == 0
                ? new()
                : _ekip.Aktifler().Where(p => PersonelKaynagiServisi.BirimAnahtari(p.IsGrubu) == sube).ToList();
        }
        catch
        {
            l = new();
        }

        if (l.Count == 0)
        {
            try { l = Kapsam(ben); } catch { l = new(); }
        }

        return l.Where(p => !disarida.Contains(K(p.PersonelKodu)))
            .GroupBy(p => K(p.PersonelKodu), StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(p => AdSoyad(p), StringComparer.Create(Tr, true))
            .ToList();
    }

    /// <summary>Devamsız personel için seçilebilecek şahitler</summary>
    [HttpGet("Mobil/Kisi/{sicil}/Sahitler")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilSahitler(string sicil)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized();
        if (!ModulAcik(ben)) return ModulKapali();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });
        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu) || !_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için devamsızlık giremezsiniz." });

        var l = SahitAdaylari(ben, hedef);
        return Ok(new
        {
            sube = hedef.IsGrubu,
            sahitler = l.Select(p => new { sicil = (p.PersonelKodu ?? "").Trim(), adSoyad = AdSoyad(p), pozisyon = p.Pozisyon, sube = p.IsGrubu }),
        });
    }

    /// <summary>Açıklama anlamlı mı: en az 5 karakter ve harf içermeli (26.10.2026)</summary>
    private static bool AciklamaGecerli(string a) =>
        !string.IsNullOrWhiteSpace(a) && a.Trim().Length >= 5 && a.Any(char.IsLetter);

    /// <summary>
    /// Seçilen günlere devamsızlık girer. 26.10.2026'dan itibaren açıklama
    /// ve iki şahit zorunlu; eski uygulama (1.10 ve öncesi) bu alanları
    /// göndermediğinden "uygulamayı güncelleyin" uyarısıyla reddedilir.
    /// </summary>
    [HttpPost("Mobil/Kisi/{sicil}")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilGir(string sicil, [FromBody] GirisGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized();
        if (!ModulAcik(ben)) return ModulKapali();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });
        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu) || !_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için devamsızlık giremezsiniz." });

        var istenen = (g?.Tarihler ?? new()).Select(x => x.Date).Distinct().ToList();
        if (istenen.Count == 0) return BadRequest(new { hata = "Gün seçiniz." });

        var son = DateTime.Today;
        var bas = son.AddDays(-(GeriGun - 1));

        if (istenen.Any(x => x < bas || x > son))
            return BadRequest(new { hata = $"Devamsızlık en fazla {GeriGun} gün öncesine ve bugüne kadar girilebilir." });

        /* Eski istemci (1.10 ve öncesi): şahit alanı yok. Hata metni ekranda
           Alert ile gösteriliyor; 400 yerine açıklayıcı uyarı. */
        var sahit1Kod = (g.Sahit1 ?? "").Trim();
        var sahit2Kod = (g.Sahit2 ?? "").Trim();
        if (sahit1Kod.Length == 0 && sahit2Kod.Length == 0)
            return BadRequest(new
            {
                hata = "Uygulamayı güncelleyiniz: devamsızlık için açıklama ve iki şahit gerekiyor.",
                ayrinti = "Biçen360'ın yeni sürümünde devamsızlık girişinde açıklama yazılıp iki şahit personel seçiliyor; tutanak otomatik hazırlanıyor.",
                guncelle = true,
            });

        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length > 500) aciklama = aciklama[..500];
        if (!AciklamaGecerli(aciklama))
            return BadRequest(new { hata = "Açıklama zorunlu.", ayrinti = "En az 5 karakter yazın; ör. \"haber vermeden gelmedi, telefona cevap vermedi\"." });

        if (sahit1Kod.Length == 0 || sahit2Kod.Length == 0) return BadRequest(new { hata = "İki şahit seçiniz." });
        if (K(sahit1Kod) == K(sahit2Kod)) return BadRequest(new { hata = "İki şahit farklı kişi olmalı." });
        if (K(sahit1Kod) == K(hedef.PersonelKodu) || K(sahit2Kod) == K(hedef.PersonelKodu))
            return BadRequest(new { hata = "Devamsız personel şahit olamaz." });
        if (K(sahit1Kod) == K(ben.PersonelKodu) || K(sahit2Kod) == K(ben.PersonelKodu))
            return BadRequest(new { hata = "Devamsızlığı giren kişi şahit olamaz." });

        var adaylar = SahitAdaylari(ben, hedef);
        var sahit1 = adaylar.FirstOrDefault(p => K(p.PersonelKodu) == K(sahit1Kod));
        var sahit2 = adaylar.FirstOrDefault(p => K(p.PersonelKodu) == K(sahit2Kod));
        if (sahit1 is null || sahit2 is null)
            return BadRequest(new { hata = "Şahit, devamsız personelle aynı şubeden aktif bir personel olmalı.", ayrinti = "Listeden seçiniz." });

        /* Gün durumu yeniden denetleniyor: bu arada okutmuş ya da izin girilmiş olabilir */
        var gunler = EkipKoprusu().GunDurumlari(new List<PersonelKaydi> { hedef }, istenen.Min(), istenen.Max())
            .GetValueOrDefault(K(hedef.PersonelKodu)) ?? new();

        var uygun = gunler.Where(x => istenen.Contains(x.Tarih.Date) && x.Durum == "okutmadi" && !x.DevamsizMi)
            .Select(x => x.Tarih.Date).OrderBy(x => x).ToList();

        using var db = _vt.Baglanti();

        /* Görevlendirme (26.10.2026): onaylı görevde olunan gün devamsızlık değil */
        var gorevGunleri = GorevlendirmeServisi.GorevGunleri(db, hedef.PersonelKodu, uygun);
        if (gorevGunleri.Count > 0)
        {
            uygun = uygun.Except(gorevGunleri).ToList();
            if (uygun.Count == 0)
                return BadRequest(new
                {
                    hata = "Personel bu tarihlerde görevlendirmede.",
                    ayrinti = $"Onaylı görevlendirme: {string.Join(", ", gorevGunleri.Select(x => x.ToString("dd.MM")))}. Görevde olunan güne devamsızlık girilemez.",
                });
        }

        if (uygun.Count == 0)
            return BadRequest(new { hata = "Seçilen günlerde devamsızlık girilemez.", ayrinti = "Personel o gün okutmuş, izinli/raporlu ya da devamsızlığı zaten girilmiş." });

        /* Tutanak: devamsızlık kayıtlarıyla aynı anda; kayıt tutanaksız kalmasın */
        int tutanakId = 0;
        try
        {
            tutanakId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_DEVAMSIZLIK_TUTANAK
    (personel_kodu, ad_soyad, sube, pozisyon, tarih_bas, tarih_bit, tarihler, aciklama,
     giren, giren_ad, giren_pozisyon,
     sahit1_kodu, sahit1_ad, sahit1_pozisyon, sahit2_kodu, sahit2_ad, sahit2_pozisyon)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @sube, @poz, @bas, @bit, @tarihler, @aciklama,
        @giren, @girenAd, @girenPoz,
        @s1, @s1Ad, @s1Poz, @s2, @s2Ad, @s2Poz)",
                new
                {
                    kod = hedef.PersonelKodu.Trim(),
                    ad = AdSoyad(hedef),
                    sube = hedef.IsGrubu,
                    poz = hedef.Pozisyon,
                    bas = uygun.Min(),
                    bit = uygun.Max(),
                    tarihler = string.Join(", ", uygun.Select(x => x.ToString("dd.MM.yyyy"))),
                    aciklama,
                    giren = ben.PersonelKodu.Trim(),
                    girenAd = AdSoyad(ben),
                    girenPoz = ben.Pozisyon,
                    s1 = sahit1.PersonelKodu.Trim(),
                    s1Ad = AdSoyad(sahit1),
                    s1Poz = sahit1.Pozisyon,
                    s2 = sahit2.PersonelKodu.Trim(),
                    s2Ad = AdSoyad(sahit2),
                    s2Poz = sahit2.Pozisyon,
                });
        }
        catch (Exception h)
        {
            _kayit.LogError(h, "Devamsızlık tutanağı yazılamadı");
            return StatusCode(500, new { hata = "Tutanak oluşturulamadı; devamsızlık işlenmedi.", ayrinti = "Sunucu güncellenmemiş olabilir." });
        }

        foreach (var t in uygun)
            db.Execute(@"
INSERT INTO KRY_DEVAMSIZLIK (personel_kodu, ad_soyad, sube, pozisyon, tarih, aciklama, giren, giren_ad, kaynak, tutanak_id)
VALUES (@kod, @ad, @sube, @poz, @t, @aciklama, @giren, @girenAd, N'mobil', @tutanakId)",
                new
                {
                    kod = hedef.PersonelKodu.Trim(),
                    ad = AdSoyad(hedef),
                    sube = hedef.IsGrubu,
                    poz = hedef.Pozisyon,
                    t,
                    aciklama,
                    giren = ben.PersonelKodu.Trim(),
                    girenAd = AdSoyad(ben),
                    tutanakId,
                });

        /* Tutanak maili (izin formu alıcı kuralı) ve şahit bildirimleri;
           ikisi de kaydı engellemez */
        string tutanakNotu = null;
        try
        {
            var (gitti, adres, formHata) = await _tutanak.GonderAsync(tutanakId, hedef);
            tutanakNotu = gitti ? $"Tutanak {adres} adresine gönderildi." : $"Tutanak maili gönderilemedi: {formHata}";
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Devamsızlık tutanağı gönderilemedi: {Id}", tutanakId);
        }

        try
        {
            var tut = db.QueryFirstOrDefault("SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK WHERE id = @id", new { id = tutanakId });
            if (tut is not null) await _tutanak.SahitlereBildir(tut);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Şahit bildirimi gönderilemedi: {Id}", tutanakId);
        }

        /* Dönemde eşiği geçtiyse İK'ya haber */
        try
        {
            var esik = Parametre.Sayi("devamsizlik.ikEsik");
            var ay = db.ExecuteScalar<int>(@"
SELECT COUNT(DISTINCT tarih) FROM KRY_DEVAMSIZLIK
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) = @kod AND tarih >= DATEADD(day, -29, CAST(SYSDATETIME() AS DATE))",
                new { kod = hedef.PersonelKodu.Trim() });

            if (esik > 0 && ay > esik && ay - uygun.Count <= esik)
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Devamsızlık eşiği aşıldı",
                    $"{AdSoyad(hedef)} · {hedef.IsGrubu}: son 30 günde {ay} gün devamsızlık", "izintalep");
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Devamsızlık eşik bildirimi gönderilemedi");
        }

        return Ok(new
        {
            basarili = true,
            girilen = uygun.Count,
            atlanan = istenen.Count - uygun.Count,
            tutanakId,
            mesaj = $"{AdSoyad(hedef)} için {TarihMetni(uygun)} devamsızlık olarak işlendi."
                    + (istenen.Count > uygun.Count ? $" {istenen.Count - uygun.Count} gün atlandı (okutma ya da izin var)." : "")
                    + (tutanakNotu is null ? "" : $" {tutanakNotu}")
                    + " Tutanağı yazdırıp şahitlerle imzalayın ve ana sayfadaki karttan yükleyin; şahitler uygulamadan onaylayacak.",
        });
    }

    /* ==================================================================== */
    /* Biçen360: tutanak (26.10.2026)                                        */
    /* ==================================================================== */

    private dynamic TutanakBul(System.Data.IDbConnection db, int id) =>
        db.QueryFirstOrDefault("SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK WHERE id = @id", new { id });

    /// <summary>Tutanağı görebilir mi: giren, şahitler, kişiden sorumlu yönetici, İK</summary>
    private bool TutanakGorebilir(dynamic t, PersonelKaydi ben)
    {
        if (IkYetkili) return true;
        if (ben is null) return false;
        var k = K(ben.PersonelKodu);
        if (k == K((string)t.giren) || k == K((string)t.sahit1_kodu) || k == K((string)t.sahit2_kodu)) return true;
        try
        {
            var hedef = _ekip.Kisi((string)t.personel_kodu);
            return hedef is not null && _ekip.IslemYapabilir(ben, hedef);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Ana sayfa kartları: girenin yüklemesi beklenen imzalı tutanaklar ve
    /// kişinin şahitlik onayı bekleyen tutanaklar (son 60 gün).
    /// </summary>
    [HttpGet("Mobil/Tutanak/Bekleyenler")]
    [Authorize(Roles = "Personel")]
    public IActionResult TutanakBekleyenler()
    {
        var kod = Sicil().Trim();
        if (kod.Length == 0) return Unauthorized();

        using var db = _vt.Baglanti();
        var kodlar = new[] { kod, K(kod) }.Distinct().ToArray();

        try
        {
            var yuklenecek = db.Query(@"
SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK
WHERE iptal = 0 AND LTRIM(RTRIM(giren)) IN @kodlar AND belge_dosya IS NULL
  AND olusturma >= DATEADD(day, -60, CAST(SYSDATETIME() AS DATE))
ORDER BY olusturma DESC", new { kodlar }).Select(DevamsizlikTutanakServisi.Nesne).ToList();

            var sahitlik = db.Query(@"
SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK
WHERE iptal = 0 AND olusturma >= DATEADD(day, -60, CAST(SYSDATETIME() AS DATE))
  AND ((LTRIM(RTRIM(sahit1_kodu)) IN @kodlar AND sahit1_durum = N'bekliyor')
    OR (LTRIM(RTRIM(sahit2_kodu)) IN @kodlar AND sahit2_durum = N'bekliyor'))
ORDER BY olusturma DESC", new { kodlar }).Select(DevamsizlikTutanakServisi.Nesne).ToList();

            return Ok(new { yuklenecek, sahitlik });
        }
        catch (Exception h)
        {
            /* Tablo henüz yoksa ana sayfa boş kartla açılsın */
            _kayit.LogWarning(h, "Tutanak bekleyenleri okunamadı");
            return Ok(new { yuklenecek = Array.Empty<object>(), sahitlik = Array.Empty<object>() });
        }
    }

    /// <summary>Tutanak ayrıntısı (giren, şahit, sorumlu yönetici)</summary>
    [HttpGet("Mobil/Tutanak/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult TutanakAyrinti(int id)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        using var db = _vt.Baglanti();
        var t = TutanakBul(db, id);
        if (t is null || !TutanakGorebilir(t, ben)) return NotFound(new { hata = "Tutanak bulunamadı." });

        var k = K(ben.PersonelKodu);
        var sahitSira = k == K((string)t.sahit1_kodu) ? 1 : k == K((string)t.sahit2_kodu) ? 2 : 0;
        var sahitDurum = sahitSira == 1 ? (string)t.sahit1_durum : sahitSira == 2 ? (string)t.sahit2_durum : null;

        return Ok(new
        {
            tutanak = DevamsizlikTutanakServisi.Nesne(t),
            benGiren = k == K((string)t.giren),
            sahitSira,
            sahitKararBekliyor = sahitSira > 0 && sahitDurum == DevamsizlikTutanakServisi.SahitBekliyor && !(bool)t.iptal,
        });
    }

    public class SahitKarar
    {
        public bool Onay { get; set; }
        public string Not { get; set; }
    }

    /// <summary>Şahit onayı: "Onaylıyorum" ya da "Onaylamıyorum" + açıklama</summary>
    [HttpPost("Mobil/Tutanak/{id:int}/Sahit")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> SahitOnayi(int id, [FromBody] SahitKarar g)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        using var db = _vt.Baglanti();
        var t = TutanakBul(db, id);
        if (t is null) return NotFound(new { hata = "Tutanak bulunamadı." });
        if ((bool)t.iptal) return BadRequest(new { hata = "Tutanak iptal edilmiş." });

        var k = K(ben.PersonelKodu);
        var sira = k == K((string)t.sahit1_kodu) ? 1 : k == K((string)t.sahit2_kodu) ? 2 : 0;
        if (sira == 0) return StatusCode(403, new { hata = "Bu tutanakta şahit değilsiniz." });

        var mevcut = sira == 1 ? (string)t.sahit1_durum : (string)t.sahit2_durum;
        if (mevcut != DevamsizlikTutanakServisi.SahitBekliyor)
            return BadRequest(new { hata = "Bu tutanak için kararınızı zaten verdiniz." });

        var not = (g?.Not ?? "").Trim();
        if (not.Length > 500) not = not[..500];
        if (g?.Onay != true && not.Length < 3) return BadRequest(new { hata = "Onaylamama sebebinizi yazınız." });

        var durum = g!.Onay ? DevamsizlikTutanakServisi.SahitOnayladi : DevamsizlikTutanakServisi.SahitReddetti;
        var sql = sira == 1
            ? "UPDATE KRY_DEVAMSIZLIK_TUTANAK SET sahit1_durum = @durum, sahit1_tarih = SYSDATETIME(), sahit1_not = @not WHERE id = @id AND sahit1_durum = N'bekliyor'"
            : "UPDATE KRY_DEVAMSIZLIK_TUTANAK SET sahit2_durum = @durum, sahit2_tarih = SYSDATETIME(), sahit2_not = @not WHERE id = @id AND sahit2_durum = N'bekliyor'";
        var etkilenen = db.Execute(sql, new { id, durum, not = not.Length == 0 ? null : not });
        if (etkilenen == 0) return BadRequest(new { hata = "Bu tutanak için kararınızı zaten verdiniz." });

        db.Execute(@"
INSERT INTO KRY_DEVAMSIZLIK_ISLEM (personel_kodu, tur, metin, tarihler, yapan)
VALUES (@kod, @tur, @metin, @tarihler, @yapan)",
            new
            {
                kod = ((string)t.personel_kodu ?? "").Trim(),
                tur = g.Onay ? "sahitonay" : "sahitred",
                metin = $"{sira}. şahit {(g.Onay ? "onayladı" : "onaylamadı")}" + (not.Length == 0 ? "" : $": {not}"),
                tarihler = (string)t.tarihler,
                yapan = AdSoyad(ben) + " (Biçen360)",
            });

        /* Girene haber; onaylamadıysa İK'ya da */
        try
        {
            var ad = (string)t.ad_soyad;
            var metin = $"{ad} · {(string)t.tarihler} · {AdSoyad(ben)} tutanağı {(g.Onay ? "onayladı" : "onaylamadı")}" + (not.Length == 0 ? "" : $": {not}");
            await _bildirim.Gonder(((string)t.giren ?? "").Trim(), "Devamsızlık tutanağı", metin, $"devamsizliktutanak|{id}");
            if (!g.Onay)
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Devamsızlık tutanağına itiraz", metin, "izintalep");
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Şahit kararı bildirimi gönderilemedi: {Id}", id);
        }

        var yeni = TutanakBul(db, id);
        return Ok(new { basarili = true, tutanak = DevamsizlikTutanakServisi.Nesne(yeni) });
    }

    /// <summary>Devamsızlığı giren yönetici imzalı tutanağı yükler (fotoğraf ya da PDF)</summary>
    [HttpPost("Mobil/Tutanak/{id:int}/ImzaliForm")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(31_457_280)]
    public async Task<IActionResult> ImzaliTutanakYukle(int id, IFormFile dosya)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();
        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });

        using var db = _vt.Baglanti();
        var t = TutanakBul(db, id);
        if (t is null) return NotFound(new { hata = "Tutanak bulunamadı." });
        if ((bool)t.iptal) return BadRequest(new { hata = "Tutanak iptal edilmiş." });

        /* Yalnız giren yönetici (ya da kişiden sorumlu başka yönetici; giren ayrılmış olabilir) */
        var hedef = _ekip.Kisi((string)t.personel_kodu);
        var girenMi = K(ben.PersonelKodu) == K((string)t.giren);
        if (!girenMi && (hedef is null || !_ekip.IslemYapabilir(ben, hedef)))
            return StatusCode(403, new { hata = "Bu tutanağı yükleme yetkiniz yok." });

        var uzanti = BelgeUzantisi(dosya);
        if (uzanti is null) return BadRequest(new { hata = "Fotoğraf (JPG, PNG, HEIC) ya da PDF yükleyiniz." });

        var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
        var diskAdi = $"{K((string)t.personel_kodu)}_dvmimza{id}_{Guid.NewGuid():N}{uzanti}";
        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);
            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);
            await dosya.CopyToAsync(akis);
        }
        catch (Exception h)
        {
            _kayit.LogError(h, "İmzalı tutanak yazılamadı: {Klasor}", klasor);
            return StatusCode(500, new { hata = "Dosya sunucuya yazılamadı." });
        }

        var yukleyen = AdSoyad(ben) + " (Biçen360)";
        db.Execute(@"
UPDATE KRY_DEVAMSIZLIK_TUTANAK SET belge_dosya = @diskAdi, belge_ozgun_ad = @ozgun, belge_tarihi = SYSDATETIME(), belge_yukleyen = @yukleyen
WHERE id = @id", new { id, diskAdi, ozgun = dosya.FileName, yukleyen });

        _tutanak.ImzaliBelgeyeKaydet(t, diskAdi, dosya.FileName, dosya.Length, yukleyen);

        db.Execute(@"
INSERT INTO KRY_DEVAMSIZLIK_ISLEM (personel_kodu, tur, metin, tarihler, yapan)
VALUES (@kod, N'tutanakbelge', N'İmzalı tutanak yüklendi', @tarihler, @yapan)",
            new { kod = ((string)t.personel_kodu ?? "").Trim(), tarihler = (string)t.tarihler, yapan = yukleyen });

        var yeni = TutanakBul(db, id);
        return Ok(new { basarili = true, tutanak = DevamsizlikTutanakServisi.Nesne(yeni) });
    }

    private static string BelgeUzantisi(IFormFile f)
    {
        var u = Path.GetExtension(f.FileName ?? "").ToLowerInvariant();
        if (u is ".pdf" or ".jpg" or ".jpeg" or ".png" or ".heic" or ".heif" or ".webp") return u;
        return (f.ContentType ?? "").ToLowerInvariant() switch
        {
            "application/pdf" => ".pdf",
            "image/jpeg" or "image/jpg" => ".jpg",
            "image/png" => ".png",
            "image/heic" or "image/heif" => ".heic",
            "image/webp" => ".webp",
            _ => null,
        };
    }

    /* ==================================================================== */
    /* Tutanak çıktısı (mobil ve panel)                                      */
    /* ==================================================================== */

    /// <summary>Doldurulmuş tutanak: HTML (yazdırma) ya da PDF</summary>
    [HttpGet("Tutanak/{id:int}/Form")]
    public async Task<IActionResult> TutanakFormu(int id, [FromQuery] bool html = false)
    {
        var ben = PersonelMi ? _ekip.Kisi(Sicil()) : null;
        using var db = _vt.Baglanti();
        var t = TutanakBul(db, id);
        if (t is null || !TutanakGorebilir(t, ben)) return NotFound(new { hata = "Tutanak bulunamadı." });

        string sayfa = DevamsizlikTutanakServisi.FormHtml(t);
        if (html) return Content(sayfa, "text/html; charset=utf-8");

        var (pdf, _) = await TarayiciPdf.DonusturAsync(sayfa, _yapilandirma, _kayit);
        return pdf is not null
            ? File(pdf, "application/pdf", $"{DevamsizlikTutanakServisi.TutanakNo(id, (DateTime)t.olusturma)}.pdf")
            : Content(sayfa, "text/html; charset=utf-8");
    }

    /// <summary>Yüklenen imzalı tutanak</summary>
    [HttpGet("Tutanak/{id:int}/ImzaliForm")]
    public IActionResult ImzaliTutanak(int id)
    {
        var ben = PersonelMi ? _ekip.Kisi(Sicil()) : null;
        using var db = _vt.Baglanti();
        var t = TutanakBul(db, id);
        if (t is null || !TutanakGorebilir(t, ben)) return NotFound(new { hata = "Tutanak bulunamadı." });

        var ad = (string)t.belge_dosya ?? "";
        if (ad.Length == 0 || ad.Contains('/') || ad.Contains('\\') || ad.Contains("..")) return NotFound(new { hata = "İmzalı tutanak yüklenmedi." });
        var yol = BelgeKlasoru.Bul(_yapilandirma, _ortam, ad);
        if (yol is null) return NotFound(new { hata = "Dosya sunucuda bulunamadı." });

        var tip = Path.GetExtension(ad).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".heic" or ".heif" => "image/heic",
            ".webp" => "image/webp",
            _ => "application/octet-stream",
        };
        return PhysicalFile(yol, tip);
    }

    /// <summary>İK: tutanağı yeniden mail gönder</summary>
    [HttpPost("Tutanak/{id:int}/YenidenGonder")]
    public async Task<IActionResult> TutanakYenidenGonder(int id)
    {
        if (!IkYetkili) return Forbid();
        using var db = _vt.Baglanti();
        var t = TutanakBul(db, id);
        if (t is null) return NotFound(new { hata = "Tutanak bulunamadı." });

        var hedef = _ekip.Kisi((string)t.personel_kodu)
                    ?? _kaynak.TumPersonelleriGetir().FirstOrDefault(x => K(x.PersonelKodu) == K((string)t.personel_kodu));
        var (gitti, adres, hata) = await _tutanak.GonderAsync(id, hedef);
        if (!gitti) return BadRequest(new { hata = hata ?? "Gönderilemedi." });
        return Ok(new { basarili = true, adres, uyari = hata });
    }

    /// <summary>Yanlış girilen devamsızlığı kaldırır (giren yönetici ya da kişiden sorumlu yönetici)</summary>
    [HttpDelete("Mobil/{id:int}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilKaldir(int id)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();
        if (!ModulAcik(ben)) return ModulKapali();

        using var db = _vt.Baglanti();
        var d = db.QueryFirstOrDefault("SELECT * FROM KRY_DEVAMSIZLIK WHERE id = @id AND iptal = 0", new { id });
        if (d is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        var hedef = _ekip.Kisi((string)d.personel_kodu);
        if (hedef is null || !_ekip.IslemYapabilir(ben, hedef) || K(ben.PersonelKodu) == K(hedef.PersonelKodu))
            return StatusCode(403, new { hata = "Bu kaydı kaldıramazsınız." });

        if (((DateTime)d.tarih).Date < DateTime.Today.AddDays(-(GeriGun - 1)))
            return BadRequest(new { hata = "Eski kayıtları İnsan Kaynakları düzeltir." });

        db.Execute(@"
UPDATE KRY_DEVAMSIZLIK SET iptal = 1, iptal_eden = @ad, iptal_tarih = SYSDATETIME(), iptal_not = N'Yönetici kaldırdı'
WHERE id = @id", new { id, ad = AdSoyad(ben) + " (Biçen360)" });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* İK paneli                                                             */
    /* ==================================================================== */

    /// <summary>Dönemde devamsızlığı olan personel (eşikten fazlası öne çıkar)</summary>
    [HttpGet("Liste")]
    public IActionResult Liste([FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null, [FromQuery] bool tumu = false)
    {
        if (!IkYetkili) return Forbid();

        var b = (bit ?? DateTime.Today).Date;
        var a = (bas ?? b.AddDays(-29)).Date;
        if (a > b) (a, b) = (b, a);

        var esik = Parametre.Sayi("devamsizlik.ikEsik");

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, personel_kodu, ad_soyad, sube, pozisyon, tarih, giren_ad, aciklama, olusturma
FROM KRY_DEVAMSIZLIK WHERE iptal = 0 AND tarih BETWEEN @a AND @b
ORDER BY tarih", new { a, b }).ToList();

        var islemler = db.Query(@"
SELECT personel_kodu, tur, olusturma, yapan FROM KRY_DEVAMSIZLIK_ISLEM
WHERE olusturma >= @a ORDER BY olusturma DESC", new { a = a.AddDays(-1) })
            .GroupBy(x => K((string)x.personel_kodu))
            .ToDictionary(g => g.Key, g => g.ToList());

        var aktif = new Dictionary<string, PersonelKaydi>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in _kaynak.TumPersonelleriGetir()) aktif[K(p.PersonelKodu)] = p;
        }
        catch { }

        /* Tutanak özeti (26.10.2026): kişi başına kaç tutanak belge / şahit bekliyor */
        var tutanakOzeti = new Dictionary<string, (int toplam, int belge, int sahit, int itiraz)>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var g in db.Query("SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK WHERE iptal = 0 AND tarih_bit >= @a AND tarih_bas <= @b", new { a, b })
                         .GroupBy(x => K((string)x.personel_kodu)))
            {
                var durumlar = g.Select(x => (string)DevamsizlikTutanakServisi.Durum(x)).ToList();
                tutanakOzeti[g.Key] = (durumlar.Count,
                    durumlar.Count(x => x == DevamsizlikTutanakServisi.DurumBelge),
                    durumlar.Count(x => x == DevamsizlikTutanakServisi.DurumSahit),
                    durumlar.Count(x => x == DevamsizlikTutanakServisi.DurumItiraz));
            }
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Devamsızlık tutanak özeti okunamadı");
        }

        var liste = kayitlar
            .GroupBy(x => K((string)x.personel_kodu))
            .Select(g =>
            {
                var ilk = g.First();
                aktif.TryGetValue(g.Key, out var p);
                var gunler = g.Select(x => ((DateTime)x.tarih).Date).Distinct().OrderBy(x => x).ToList();
                var isl = islemler.GetValueOrDefault(g.Key) ?? new();
                var sonBildirim = isl.FirstOrDefault(x => (string)x.tur is "bildirim" or "sms");
                var sonNot = isl.FirstOrDefault(x => (string)x.tur is "not" or "gorusuldu");
                var tut = tutanakOzeti.GetValueOrDefault(g.Key);

                return new
                {
                    tutanak = new { toplam = tut.toplam, belgeBekleyen = tut.belge, sahitBekleyen = tut.sahit, itiraz = tut.itiraz },
                    kod = ((string)ilk.personel_kodu ?? "").Trim(),
                    adSoyad = p is null ? (string)ilk.ad_soyad : AdSoyad(p),
                    sube = p?.IsGrubu ?? (string)ilk.sube,
                    pozisyon = p?.Pozisyon ?? (string)ilk.pozisyon,
                    telefonVar = !string.IsNullOrWhiteSpace(p?.Telefon),
                    ayrildi = p is not null && p.Durum != 1,
                    gun = gunler.Count,
                    esikUstu = gunler.Count > esik,
                    ardisik = EnUzunArdisik(gunler),
                    tarihler = gunler,
                    girenler = g.Select(x => (string)x.giren_ad).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList(),
                    sonGiris = g.Max(x => (DateTime)x.olusturma),
                    sonBildirim = (DateTime?)sonBildirim?.olusturma,
                    sonBildirimYapan = (string)sonBildirim?.yapan,
                    sonNot = (DateTime?)sonNot?.olusturma,
                    sonNotTur = (string)sonNot?.tur,
                };
            })
            .Where(x => tumu || x.esikUstu)
            .OrderByDescending(x => x.esikUstu).ThenByDescending(x => x.gun).ThenBy(x => x.adSoyad, StringComparer.Create(Tr, true))
            .ToList();

        return Ok(new
        {
            bas = a,
            bit = b,
            esik,
            smsEtkin = _sms.Etkin,
            metin = Parametre.Metin("devamsizlik.mesaj"),
            toplamKisi = kayitlar.Select(x => K((string)x.personel_kodu)).Distinct().Count(),
            esikUstu = liste.Count(x => x.esikUstu),
            kayitlar = liste,
        });
    }

    private static int EnUzunArdisik(List<DateTime> l)
    {
        int en = 0, simdi = 0;
        DateTime? onceki = null;
        foreach (var g in l)
        {
            simdi = onceki is DateTime o && (g - o).TotalDays == 1 ? simdi + 1 : 1;
            en = Math.Max(en, simdi);
            onceki = g;
        }
        return en;
    }

    /// <summary>Kişinin dönemdeki devamsızlıkları ve İK işlemleri</summary>
    [HttpGet("Kisi/{kod}")]
    public IActionResult Kisi(string kod, [FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null)
    {
        if (!IkYetkili) return Forbid();

        var b = (bit ?? DateTime.Today).Date;
        var a = (bas ?? b.AddDays(-89)).Date;

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, tarih, giren_ad AS giren, aciklama, olusturma, kaynak
FROM KRY_DEVAMSIZLIK
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND tarih BETWEEN @a AND @b
ORDER BY tarih DESC", new { kod = (kod ?? "").Trim(), kodK = K(kod), a, b }).ToList();

        var islemler = db.Query(@"
SELECT id, tur, metin, tarihler, sonuc, yapan, olusturma FROM KRY_DEVAMSIZLIK_ISLEM
WHERE LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) ORDER BY olusturma DESC", new { kod = (kod ?? "").Trim(), kodK = K(kod) }).ToList();

        /* Tutanaklar (26.10.2026): kayıtla eşlemek için tutanak_id */
        var tutanaklar = new List<object>();
        var tutanakHaritasi = new Dictionary<int, int>();
        try
        {
            tutanaklar = db.Query(@"
SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND tarih_bit >= @a
ORDER BY olusturma DESC", new { kod = (kod ?? "").Trim(), kodK = K(kod), a }).Select(DevamsizlikTutanakServisi.Nesne).ToList();

            foreach (var x in db.Query("SELECT id, tutanak_id FROM KRY_DEVAMSIZLIK WHERE iptal = 0 AND tutanak_id IS NOT NULL AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND tarih BETWEEN @a AND @b",
                         new { kod = (kod ?? "").Trim(), kodK = K(kod), a, b }))
                tutanakHaritasi[(int)x.id] = (int)x.tutanak_id;
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Devamsızlık tutanakları okunamadı: {Kod}", K(kod));
        }

        var kayitCikti = kayitlar.Select(x => new
        {
            id = (int)x.id,
            tarih = (DateTime)x.tarih,
            giren = (string)x.giren,
            aciklama = (string)x.aciklama,
            olusturma = (DateTime)x.olusturma,
            kaynak = (string)x.kaynak,
            tutanakId = tutanakHaritasi.TryGetValue((int)x.id, out var tid) ? tid : (int?)null,
        }).ToList();

        return Ok(new { kayitlar = kayitCikti, islemler, tutanaklar });
    }

    public class BildirGirdi
    {
        public List<string> Kodlar { get; set; } = new();
        public DateTime? Bas { get; set; }
        public DateTime? Bit { get; set; }
        public bool Uygulama { get; set; } = true;
        public bool Sms { get; set; }
        /// <summary>Boşsa parametredeki metin; {ad} ve {tarihler} yerine konur</summary>
        public string Metin { get; set; }
    }

    /// <summary>Personele devamsızlık uyarısı: uygulama bildirimi ve/veya SMS</summary>
    [HttpPost("Bildir")]
    public async Task<IActionResult> Bildir([FromBody] BildirGirdi g)
    {
        if (!IkYetkili) return Forbid();
        if (g?.Kodlar is not { Count: > 0 }) return BadRequest(new { hata = "Personel seçiniz." });
        if (!g.Uygulama && !g.Sms) return BadRequest(new { hata = "Uygulama bildirimi ya da SMS seçiniz." });
        if (g.Sms && !_sms.Etkin) return BadRequest(new { hata = "SMS servisi kapalı; yalnızca uygulama bildirimi gönderilebilir." });

        var b = (g.Bit ?? DateTime.Today).Date;
        var a = (g.Bas ?? b.AddDays(-29)).Date;
        var sablon = string.IsNullOrWhiteSpace(g.Metin) ? Parametre.Metin("devamsizlik.mesaj") : g.Metin.Trim();
        if (sablon.Length > 600) sablon = sablon[..600];

        var personel = new Dictionary<string, PersonelKaydi>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in _kaynak.TumPersonelleriGetir()) personel[K(p.PersonelKodu)] = p;
        }
        catch { }

        using var db = _vt.Baglanti();
        var sonuclar = new List<object>();
        int uygAdet = 0, smsAdet = 0;

        foreach (var kod in g.Kodlar.Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct().Take(300))
        {
            var gunler = db.Query<DateTime>(@"
SELECT DISTINCT tarih FROM KRY_DEVAMSIZLIK
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND tarih BETWEEN @a AND @b",
                new { kod, kodK = K(kod), a, b }).ToList();

            personel.TryGetValue(K(kod), out var p);
            var ad = p is null ? kod : AdSoyad(p);

            if (gunler.Count == 0)
            {
                sonuclar.Add(new { kod, adSoyad = ad, uygulama = false, sms = false, hata = "Dönemde devamsızlık yok" });
                continue;
            }

            var tarihMetni = TarihMetni(gunler);
            var metin = sablon.Replace("{ad}", p is null ? "" : $"{p.Ad} {p.Soyad}".Trim()).Replace("{tarihler}", tarihMetni)
                .Replace("Sayın ,", "Sayın personelimiz,");

            bool uyg = false, sms = false;
            string hata = null;

            if (g.Uygulama)
            {
                try
                {
                    await _bildirim.Gonder(kod, "Devamsızlık bildirimi", metin, "duyuru");
                    db.Execute(@"
INSERT INTO KRY_MOBIL_DUYURU (baslik, metin, personel_kodu, gonderen)
VALUES (N'Devamsızlık bildirimi', @metin, @kod, @gonderen)", new { metin, kod, gonderen = PanelAdi });
                    uyg = true;
                }
                catch (Exception h)
                {
                    hata = "Uygulama bildirimi gönderilemedi";
                    _kayit.LogWarning(h, "Devamsızlık bildirimi gönderilemedi: {Kod}", kod);
                }
            }

            if (g.Sms)
            {
                if (string.IsNullOrWhiteSpace(p?.Telefon))
                    hata = "Telefon numarası yok";
                else
                {
                    var r = await _sms.Gonder(p.Telefon, metin);
                    sms = r.Basarili;
                    if (!r.Basarili) hata = $"SMS gönderilemedi: {r.Mesaj}";
                }
            }

            var turler = new List<string>();
            if (uyg) turler.Add("bildirim");
            if (sms) turler.Add("sms");

            foreach (var t in turler.DefaultIfEmpty("hata"))
                db.Execute(@"
INSERT INTO KRY_DEVAMSIZLIK_ISLEM (personel_kodu, tur, metin, tarihler, sonuc, yapan)
VALUES (@kod, @tur, @metin, @tarihler, @sonuc, @yapan)",
                    new { kod, tur = t, metin, tarihler = tarihMetni, sonuc = hata, yapan = PanelAdi });

            if (uyg) uygAdet++;
            if (sms) smsAdet++;
            sonuclar.Add(new { kod, adSoyad = ad, uygulama = uyg, sms, hata });
        }

        return Ok(new { sonuclar, uygulama = uygAdet, sms = smsAdet });
    }

    public class NotGirdi
    {
        public string Kod { get; set; }
        /// <summary>not · gorusuldu</summary>
        public string Tur { get; set; }
        public string Metin { get; set; }
    }

    /// <summary>İK notu: "personelle görüşüldü" ya da serbest not</summary>
    [HttpPost("Not")]
    public IActionResult NotYaz([FromBody] NotGirdi g)
    {
        if (!IkYetkili) return Forbid();
        var kod = (g?.Kod ?? "").Trim();
        var metin = (g?.Metin ?? "").Trim();
        if (kod.Length == 0) return BadRequest(new { hata = "Personel seçiniz." });
        if (metin.Length < 2) return BadRequest(new { hata = "Not yazınız." });
        if (metin.Length > 1000) metin = metin[..1000];

        using var db = _vt.Baglanti();
        db.Execute(@"
INSERT INTO KRY_DEVAMSIZLIK_ISLEM (personel_kodu, tur, metin, yapan) VALUES (@kod, @tur, @metin, @yapan)",
            new { kod, tur = g.Tur == "gorusuldu" ? "gorusuldu" : "not", metin, yapan = PanelAdi });

        return Ok(new { basarili = true });
    }

    public class IptalGirdi
    {
        public string Not { get; set; }
    }

    /// <summary>İK yanlış girilen devamsızlığı kaldırır</summary>
    [HttpPost("{id:int}/Iptal")]
    public IActionResult Iptal(int id, [FromBody] IptalGirdi g)
    {
        if (!IkYetkili) return Forbid();
        var not = (g?.Not ?? "").Trim();
        if (not.Length < 3) return BadRequest(new { hata = "Kaldırma sebebini yazınız." });
        if (not.Length > 300) not = not[..300];

        using var db = _vt.Baglanti();
        var d = db.QueryFirstOrDefault("SELECT personel_kodu, tarih FROM KRY_DEVAMSIZLIK WHERE id = @id AND iptal = 0", new { id });
        if (d is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        db.Execute(@"
UPDATE KRY_DEVAMSIZLIK SET iptal = 1, iptal_eden = @ad, iptal_tarih = SYSDATETIME(), iptal_not = @not WHERE id = @id",
            new { id, ad = PanelAdi, not });
        db.Execute(@"
INSERT INTO KRY_DEVAMSIZLIK_ISLEM (personel_kodu, tur, metin, tarihler, yapan) VALUES (@kod, N'kaldirildi', @not, @t, @yapan)",
            new { kod = (string)d.personel_kodu, not, t = ((DateTime)d.tarih).ToString("dd.MM.yyyy"), yapan = PanelAdi });

        return Ok(new { basarili = true });
    }

    /// <summary>Panel vardiya planı için: haftadaki devamsız günler (kod → günler)</summary>
    [NonAction]
    public static Dictionary<string, HashSet<DateTime>> Hafta(System.Data.IDbConnection db, DateTime bas, DateTime son)
    {
        var s = new Dictionary<string, HashSet<DateTime>>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var x in db.Query("SELECT personel_kodu AS kod, tarih FROM KRY_DEVAMSIZLIK WHERE iptal = 0 AND tarih BETWEEN @bas AND @son",
                         new { bas = bas.Date, son = son.Date }))
            {
                var k = K((string)x.kod);
                if (!s.TryGetValue(k, out var l)) s[k] = l = new HashSet<DateTime>();
                l.Add(((DateTime)x.tarih).Date);
            }
        }
        catch
        {
            /* tablo yoksa boş */
        }
        return s;
    }
}

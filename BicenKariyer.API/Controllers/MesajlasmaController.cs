using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Mesajlaşma (22.10.2026; İK asistanı SohbetController ayrı): İK paneli kullanıcıları arasında grup ve özel
/// mesajlaşma; görsel, video ve dosya gönderimi.
///
/// <para>
/// Mobil (23.10.2026, Biçen360 1.9): personel aynı uçları kullanıyor.
/// Personelin üye anahtarı "p-sicil" (uye_turu = personel); panel
/// kullanıcısı kullanıcı adıyla. Modül portalda "mesajlar" yetkisiyle
/// açılıyor, tanımsızken kapalı. Mobil üyeye yeni mesajda anlık bildirim
/// gidiyor (sessize alınan sohbet hariç).
/// </para>
///
/// <para>
/// Anlık güncelleme kısa aralıklı sorguyla: panel açık sohbeti 3 saniyede,
/// genel özeti (okunmamış sayısı ve yeni mesaj bildirimi) 8 saniyede bir
/// soruyor. IIS'te WebSocket açık olmasa da çalışıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class MesajlasmaController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<MesajlasmaController> _kayit;

    public MesajlasmaController(VeritabaniServisi vt, IWebHostEnvironment ortam, ILogger<MesajlasmaController> kayit)
    {
        _vt = vt;
        _ortam = ortam;
        _kayit = kayit;
    }

    /* 23.10.2026: her dosya türü gönderilebilir, sınır 5 GB. Tek istekte
       en fazla 500 MB (sunucu sınırı); büyük dosyalar parça parça gelir
       (IIS tek istekte 4 GB'tan büyüğünü hiç kabul etmiyor). */
    private const long DosyaSiniri = 5L * 1024 * 1024 * 1024;
    private const long TekIstekSiniri = 500L * 1024 * 1024;
    private const int ParcaSiniri = 32 * 1024 * 1024;

    /* Tarayıcıda açılabilecek güvenli türler; geri kalan her şey (html,
       svg, js, exe…) indirme olarak verilir: aynı adreste çalıştırılırsa
       oturumu çalabilir. */
    private static readonly HashSet<string> GosterilebilirUzanti = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".bmp",
        ".mp4", ".mov", ".webm", ".m4v", ".mp3", ".m4a", ".wav", ".ogg",
        ".pdf", ".txt", ".csv",
    };

    private static string GuvenliUzanti(string ad)
    {
        var u = Path.GetExtension(ad ?? "");
        if (u.Length > 12 || u.Any(c => !char.IsLetterOrDigit(c) && c != '.')) u = "";
        return u.ToLowerInvariant();
    }

    private bool Mobil => User?.IsInRole("Personel") == true;

    /// <summary>Personelin üye anahtarı öneki</summary>
    /* İki nokta değil tire: IIS yol içinde ":" kabul etmiyor (üye çıkarma ucu) */
    public const string PersonelOnek = "p-";

    /// <summary>Jetondaki sicil ("personel:14721|cihaz" biçiminden)</summary>
    private string MobilSicil
    {
        get
        {
            var ad = User?.Identity?.Name ?? "";
            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');
            return (i < 0 ? govde : govde[..i]).Trim();
        }
    }

    /* Panel hesabı olan personel (23.10.2026): İK panelinde kullanıcısı
       olan kişi (KRY_KULLANICILAR.sicil) mobilde de panel kimliğiyle
       yazışır; panelde ve telefonda aynı sohbetler ve okunmamışlar. */
    private string _ben;
    private string Ben => _ben ??= Mobil ? MobilKimlik() : (User?.Identity?.Name ?? "").Trim();

    private static (DateTime Zaman, Dictionary<string, string> Harita)? _panelHesap;
    private static readonly object _panelKilit = new();
    private static readonly HashSet<string> _birlestirilen = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Sicil → aktif panel kullanıcı adı (baştaki sıfırlar yok sayılır), 2 dakika bellekte</summary>
    private Dictionary<string, string> PanelHesaplari()
    {
        lock (_panelKilit)
            if (_panelHesap is { } b && DateTime.UtcNow - b.Zaman < TimeSpan.FromMinutes(2)) return b.Harita;
        var h = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var db = _vt.Baglanti();
            foreach (var x in db.Query(@"SELECT kullanici_adi AS k, sicil FROM KRY_KULLANICILAR
WHERE aktif = 1 AND sicil IS NOT NULL AND LTRIM(RTRIM(sicil)) <> N'' ORDER BY id"))
            {
                var sc = K((string)x.sicil);
                if (sc.Length > 0 && !h.ContainsKey(sc)) h[sc] = ((string)x.k).Trim();
            }
        }
        catch (Exception e) { _kayit.LogWarning(e, "Panel hesap eşlemesi okunamadı"); }

        /* Sicili girilmemiş panel hesabı (23.10.2026): adı soyadı aktif
           personelde tek bir kişiyle birebir aynıysa o kişi sayılır. Aynı
           adda iki personel varsa eşlenmez (Kullanıcılar'dan sicil girilmeli). */
        try
        {
            using var db = _vt.Baglanti();
            var sicilsiz = db.Query(@"SELECT kullanici_adi AS k, ad_soyad AS ad FROM KRY_KULLANICILAR
WHERE aktif = 1 AND (sicil IS NULL OR LTRIM(RTRIM(sicil)) = N'')").ToList();
            if (sicilsiz.Count > 0)
            {
                var adlar = Ekip.Aktifler()
                    .GroupBy(p => PersonelKaynagiServisi.DuzAnahtar($"{p.Ad} {p.Soyad}"))
                    .Where(g => g.Key.Length > 4 && g.Count() == 1)
                    .ToDictionary(g => g.Key, g => K(g.First().PersonelKodu));
                var panelAdlari = sicilsiz.GroupBy(x => PersonelKaynagiServisi.DuzAnahtar((string)x.ad))
                    .Where(g => g.Count() == 1).ToDictionary(g => g.Key, g => ((string)g.First().k).Trim());
                foreach (var (an, k) in panelAdlari)
                    if (adlar.TryGetValue(an, out var sc) && sc.Length > 0 && !h.ContainsKey(sc)) h[sc] = k;
            }
        }
        catch (Exception e) { _kayit.LogWarning(e, "Panel hesabı adla eşlenemedi"); }

        lock (_panelKilit) _panelHesap = (DateTime.UtcNow, h);

        /* Panel hesabı olan personelin eski "p-sicil" sohbetleri panel
           kimliğine taşınır (her biri bir kez) */
        foreach (var (sc, k) in h) Birlestir(PersonelOnek + sc, k);
        return h;
    }

    /// <summary>"p-sicil" anahtarı panel hesabı olan birini gösteriyorsa panel kullanıcı adı</summary>
    private string Esle(string k)
    {
        k = (k ?? "").Trim();
        if (!k.StartsWith(PersonelOnek, StringComparison.OrdinalIgnoreCase)) return k;
        return PanelHesaplari().TryGetValue(K(k[PersonelOnek.Length..]), out var panel) ? panel : k;
    }

    private string MobilKimlik()
    {
        var personel = PersonelOnek + MobilSicil;
        var panel = Esle(personel);
        if (panel != personel) Birlestir(personel, panel);
        return panel;
    }

    /// <summary>
    /// Personel anahtarıyla açılmış eski sohbetleri panel hesabına taşır
    /// (bir kez): üyelik, gönderilen mesajlar ve okundu bilgisi.
    /// </summary>
    private void Birlestir(string personel, string panel)
    {
        var sicil = K(personel.StartsWith(PersonelOnek) ? personel[PersonelOnek.Length..] : personel);
        lock (_birlestirilen) if (!_birlestirilen.Add(sicil)) return;
        try
        {
            using var db = _vt.Baglanti();

            /* Sicil baştaki sıfırlarla da yazılmış olabilir: "p-0381" = "p-381" */
            var anahtarlar = db.Query<string>(@"
SELECT DISTINCT kullanici FROM KRY_SOHBET_UYE WHERE kullanici LIKE N'p-%'
UNION SELECT DISTINCT gonderen FROM KRY_SOHBET_MESAJ WHERE gonderen LIKE N'p-%'")
                .Where(x => x is not null && K(x.Trim()[PersonelOnek.Length..]) == sicil)
                .ToList();

            foreach (var eski in anahtarlar)
                db.Execute(@"
UPDATE p SET p.son_okunan = CASE WHEN o.son_okunan > p.son_okunan THEN o.son_okunan ELSE p.son_okunan END,
             p.ayrildi = CASE WHEN o.ayrildi IS NULL THEN NULL ELSE p.ayrildi END
FROM KRY_SOHBET_UYE p JOIN KRY_SOHBET_UYE o ON o.sohbet_id = p.sohbet_id AND o.kullanici = @eski
WHERE p.kullanici = @panel;
DELETE o FROM KRY_SOHBET_UYE o
WHERE o.kullanici = @eski AND EXISTS (SELECT 1 FROM KRY_SOHBET_UYE p WHERE p.sohbet_id = o.sohbet_id AND p.kullanici = @panel);
UPDATE KRY_SOHBET_UYE SET kullanici = @panel, uye_turu = N'panel' WHERE kullanici = @eski;
UPDATE KRY_SOHBET_MESAJ SET gonderen = @panel WHERE gonderen = @eski;
UPDATE KRY_SOHBET SET olusturan = @panel WHERE olusturan = @eski;", new { eski, panel });
        }
        catch (Exception e)
        {
            lock (_birlestirilen) _birlestirilen.Remove(sicil);
            _kayit.LogWarning(e, "Mesaj kimlikleri birleştirilemedi");
        }
    }

    private EkipServisi Ekip => HttpContext.RequestServices.GetRequiredService<EkipServisi>();

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Mobilde modül açık mı (portal "mesajlar"; tanımsızken kapalı)</summary>
    private bool MobilAcik()
    {
        try
        {
            var p = Ekip.Kisi(MobilSicil);
            if (p is null) return false;
            return HttpContext.RequestServices.GetRequiredService<PortalYetkiServisi>()
                .AcikMi(MobilSicil, (p.Pozisyon ?? "").Trim(), "mesajlar");
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Mobilde modül kapalıysa 403; panelde ya da açıksa null</summary>
    private IActionResult MobilEngel() =>
        Mobil && !MobilAcik() ? StatusCode(403, new { hata = "Mesajlar modülü sizin için açık değil." }) : null;

    private string Klasor(int sohbetId)
    {
        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath) ? AppContext.BaseDirectory : _ortam.ContentRootPath;
        var k = Path.Combine(kok, "sohbet", sohbetId.ToString());
        if (!Directory.Exists(k)) Directory.CreateDirectory(k);
        return k;
    }

    private static bool UyeMi(IDbConnection db, int id, string k) =>
        db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_SOHBET_UYE WHERE sohbet_id = @id AND kullanici = @k AND ayrildi IS NULL",
            new { id, k }) > 0;

    private static bool YoneticiMi(IDbConnection db, int id, string k) =>
        db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_SOHBET_UYE WHERE sohbet_id = @id AND kullanici = @k AND ayrildi IS NULL AND yonetici = 1",
            new { id, k }) > 0;

    private static int SistemMesaji(IDbConnection db, int id, string metin) =>
        db.ExecuteScalar<int>(@"
INSERT INTO KRY_SOHBET_MESAJ (sohbet_id, gonderen, tur, metin) OUTPUT INSERTED.id VALUES (@id, NULL, N'sistem', @metin);
UPDATE KRY_SOHBET SET son_mesaj_zamani = SYSDATETIME() WHERE id = @id;", new { id, metin });

    /// <summary>Panel kullanıcıları ve personel ("p-sicil") adları</summary>
    private Dictionary<string, string> Adlar(IDbConnection db)
    {
        var d = db.Query("SELECT kullanici_adi AS k, ad_soyad AS a FROM KRY_KULLANICILAR")
            .GroupBy(x => ((string)x.k ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (string)g.First().a ?? g.Key, StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var p in Ekip.Aktifler())
                d[PersonelOnek + (p.PersonelKodu ?? "").Trim()] = $"{p.Ad} {p.Soyad}".Trim();
        }
        catch { /* personel kaynağı okunamazsa sicil görünür */ }

        return d;
    }

    /// <summary>Üye olabilecek anahtarlar: aktif panel kullanıcıları ve aktif personel</summary>
    private HashSet<string> GecerliUyeler(IDbConnection db)
    {
        var h = db.Query<string>("SELECT kullanici_adi FROM KRY_KULLANICILAR WHERE aktif = 1")
            .Select(x => x.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in Ekip.Aktifler()) h.Add(PersonelOnek + (p.PersonelKodu ?? "").Trim());
        }
        catch { }
        return h;
    }

    private static string UyeTuru(string k) =>
        k.StartsWith(PersonelOnek, StringComparison.OrdinalIgnoreCase) ? "personel" : "panel";

    /* ==================================================================== */
    /* Kullanıcılar ve sohbet listesi                                       */
    /* ==================================================================== */

    /// <summary>
    /// Sohbete eklenebilecek kişiler: panel kullanıcıları ve (personel=1
    /// ya da mobilde) personel. Personel çok olduğu için <c>q</c> ile
    /// aranıyor; aramasız mobilde kendi şubesi geliyor.
    /// </summary>
    [HttpGet("Kullanicilar")]
    public IActionResult Kullanicilar([FromQuery] string q = null, [FromQuery] bool personel = false)
    {
        if (MobilEngel() is { } engel) return engel;
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT kullanici_adi AS kod, ad_soyad AS ad, rol
FROM KRY_KULLANICILAR WHERE aktif = 1 AND kullanici_adi <> @ben
ORDER BY ad_soyad", new { ben = Ben })
            .Select(x => (object)new { kod = (string)x.kod, ad = (string)x.ad, rol = (string)x.rol, tur = "panel", sube = (string)null })
            .ToList();

        if (!Mobil && !personel) return Ok(liste);

        var aranan = (q ?? "").Trim();
        var tr = new System.Globalization.CultureInfo("tr-TR");
        string Duz(string x) => (x ?? "").ToLower(tr);

        try
        {
            var aktifler = Ekip.Aktifler();
            IEnumerable<PersonelKaydi> secim;

            if (aranan.Length >= 2)
            {
                var a = Duz(aranan);
                secim = aktifler.Where(p => Duz($"{p.Ad} {p.Soyad}").Contains(a) || K(p.PersonelKodu) == K(aranan)
                                         || Duz(p.IsGrubu).Contains(a));
            }
            else if (Mobil)
            {
                var ben = Ekip.Kisi(MobilSicil);
                var sube = (ben?.IsGrubu ?? "").Trim();
                secim = aktifler.Where(p => sube.Length > 0 && string.Equals((p.IsGrubu ?? "").Trim(), sube, StringComparison.OrdinalIgnoreCase));
            }
            else secim = Enumerable.Empty<PersonelKaydi>();

            var benimKod = Mobil ? K(MobilSicil) : null;
            var panelli = PanelHesaplari();
            liste.AddRange(secim
                .Where(p => K(p.PersonelKodu) != benimKod)
                /* Panel hesabı olan personel panel kullanıcısı olarak listede zaten var */
                .Where(p => !panelli.ContainsKey(K(p.PersonelKodu)))
                .OrderBy(p => p.Ad, StringComparer.Create(tr, true)).ThenBy(p => p.Soyad, StringComparer.Create(tr, true))
                .Take(60)
                .Select(p => (object)new
                {
                    kod = PersonelOnek + (p.PersonelKodu ?? "").Trim(),
                    ad = $"{p.Ad} {p.Soyad}".Trim(),
                    rol = p.Pozisyon,
                    tur = "personel",
                    sube = p.IsGrubu,
                }));
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Mesajlaşma personel listesi okunamadı");
        }

        /* Mobilde aramada panel kullanıcıları da süzülür */
        if (Mobil && aranan.Length >= 2)
        {
            var a = Duz(aranan);
            liste = liste.Where(x => Duz((string)x.GetType().GetProperty("ad")!.GetValue(x)).Contains(a)
                                  || (string)x.GetType().GetProperty("tur")!.GetValue(x) == "personel").ToList();
        }

        return Ok(liste);
    }

    /// <summary>Kişinin sohbetleri: son mesaj ve okunmamış sayısıyla.</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        if (MobilEngel() is { } engel) return engel;
        using var db = _vt.Baglanti();
        var adlar = Adlar(db);

        var sohbetler = db.Query(@"
SELECT s.id, s.tur, s.ad, s.duyuru, s.yonetici_ekler AS yoneticiEkler, s.olusturma,
       ISNULL(s.son_mesaj_zamani, s.olusturma) AS sonZaman, u.yonetici AS benYonetici, u.sessiz,
       (SELECT COUNT(*) FROM KRY_SOHBET_MESAJ m WHERE m.sohbet_id = s.id AND m.id > u.son_okunan
           AND m.silindi = 0 AND ISNULL(m.gonderen, N'') <> @ben AND m.tur <> N'sistem') AS okunmamis,
       sm.id AS sonId, sm.gonderen AS sonGonderen, sm.tur AS sonTur, sm.metin AS sonMetin, sm.dosya_ad AS sonDosya, sm.silindi AS sonSilindi
FROM KRY_SOHBET_UYE u
JOIN KRY_SOHBET s ON s.id = u.sohbet_id
OUTER APPLY (SELECT TOP 1 * FROM KRY_SOHBET_MESAJ x WHERE x.sohbet_id = s.id ORDER BY x.id DESC) sm
WHERE u.kullanici = @ben AND u.ayrildi IS NULL
ORDER BY ISNULL(s.son_mesaj_zamani, s.olusturma) DESC", new { ben = Ben }).ToList();

        var idler = sohbetler.Select(x => (int)x.id).ToList();
        var uyeler = idler.Count == 0
            ? new Dictionary<int, List<string>>()
            : idler.Chunk(500).SelectMany(p => db.Query(
                    "SELECT sohbet_id AS id, kullanici AS k FROM KRY_SOHBET_UYE WHERE sohbet_id IN @p AND ayrildi IS NULL", new { p }))
                .GroupBy(x => (int)x.id)
                .ToDictionary(g => g.Key, g => g.Select(x => ((string)x.k).Trim()).ToList());

        var sonuc = sohbetler.Select(s =>
        {
            var u = uyeler.GetValueOrDefault((int)s.id) ?? new List<string>();
            var karsi = (string)s.tur == "kisi" ? u.FirstOrDefault(x => !string.Equals(x, Ben, StringComparison.OrdinalIgnoreCase)) : null;
            string ad = (string)s.tur == "kisi" ? (karsi is null ? "Sohbet" : adlar.GetValueOrDefault(karsi, karsi)) : (string)s.ad;
            string sonGonderen = s.sonGonderen as string;

            return new
            {
                id = (int)s.id,
                tur = (string)s.tur,
                ad,
                karsi,
                duyuru = (bool)s.duyuru,
                yoneticiEkler = (bool)s.yoneticiEkler,
                benYonetici = (bool)s.benYonetici,
                sessiz = (bool)s.sessiz,
                uyeSayisi = u.Count,
                okunmamis = (int)s.okunmamis,
                sonZaman = (DateTime)s.sonZaman,
                son = s.sonId is null ? null : new
                {
                    gonderen = sonGonderen,
                    gonderenAd = sonGonderen is null ? null : adlar.GetValueOrDefault(sonGonderen, sonGonderen),
                    ben = string.Equals(sonGonderen, Ben, StringComparison.OrdinalIgnoreCase),
                    tur = (string)s.sonTur,
                    metin = (bool)s.sonSilindi ? "Bu mesaj silindi" : (string)s.sonMetin,
                    dosya = (string)s.sonDosya,
                },
            };
        }).ToList();

        return Ok(new { ben = Ben, sohbetler = sonuc });
    }

    /* ==================================================================== */
    /* Oluşturma ve üyeler                                                  */
    /* ==================================================================== */

    public class OlusturGirdi
    {
        /// <summary>grup | kisi</summary>
        public string Tur { get; set; }
        public string Ad { get; set; }
        public List<string> Uyeler { get; set; } = new();
        public bool Duyuru { get; set; }
        public bool YoneticiEkler { get; set; } = true;
    }

    [HttpPost]
    public IActionResult Olustur([FromBody] OlusturGirdi g)
    {
        if (MobilEngel() is { } engel) return engel;

        var tur = g?.Tur == "kisi" ? "kisi" : "grup";
        using var db = _vt.Baglanti();

        var gecerli = GecerliUyeler(db);

        var uyeler = (g?.Uyeler ?? new List<string>())
            .Select(Esle)
            .Where(x => x.Length > 0 && gecerli.Contains(x) && !string.Equals(x, Ben, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (uyeler.Count == 0) return BadRequest(new { hata = "En az bir kişi seçiniz." });

        if (tur == "kisi")
        {
            var karsi = uyeler[0];

            /* Aynı iki kişinin tek özel sohbeti olur */
            var mevcut = db.ExecuteScalar<int?>(@"
SELECT TOP 1 s.id FROM KRY_SOHBET s
WHERE s.tur = N'kisi'
  AND EXISTS (SELECT 1 FROM KRY_SOHBET_UYE a WHERE a.sohbet_id = s.id AND a.kullanici = @ben)
  AND EXISTS (SELECT 1 FROM KRY_SOHBET_UYE b WHERE b.sohbet_id = s.id AND b.kullanici = @karsi)",
                new { ben = Ben, karsi });

            if (mevcut is int m)
            {
                db.Execute("UPDATE KRY_SOHBET_UYE SET ayrildi = NULL WHERE sohbet_id = @m AND kullanici IN (@ben, @karsi)",
                    new { m, ben = Ben, karsi });
                return Ok(new { id = m });
            }

            var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_SOHBET (tur, olusturan) OUTPUT INSERTED.id VALUES (N'kisi', @ben)", new { ben = Ben });
            db.Execute("INSERT INTO KRY_SOHBET_UYE (sohbet_id, kullanici, uye_turu, yonetici) VALUES (@id, @k, @t, 0)",
                new[] { new { id, k = Ben, t = UyeTuru(Ben) }, new { id, k = karsi, t = UyeTuru(karsi) } });
            return Ok(new { id });
        }

        var ad = (g.Ad ?? "").Trim();
        if (ad.Length < 2) return BadRequest(new { hata = "Grup adını yazınız." });
        if (ad.Length > 120) ad = ad[..120];

        var gid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_SOHBET (tur, ad, duyuru, yonetici_ekler, olusturan) OUTPUT INSERTED.id
VALUES (N'grup', @ad, @duyuru, @ye, @ben)", new { ad, duyuru = g.Duyuru, ye = g.YoneticiEkler, ben = Ben });

        db.Execute("INSERT INTO KRY_SOHBET_UYE (sohbet_id, kullanici, uye_turu, yonetici) VALUES (@gid, @k, @t, @y)",
            uyeler.Select(k => new { gid, k, t = UyeTuru(k), y = false }).Prepend(new { gid, k = Ben, t = UyeTuru(Ben), y = true }));

        var adlar = Adlar(db);
        SistemMesaji(db, gid, $"{adlar.GetValueOrDefault(Ben, Ben)} grubu oluşturdu");

        return Ok(new { id = gid });
    }

    /// <summary>Sohbetin üyeleri.</summary>
    [HttpGet("{id:int}/Uyeler")]
    public IActionResult Uyeler(int id)
    {
        using var db = _vt.Baglanti();
        if (!UyeMi(db, id, Ben)) return NotFound(new { hata = "Sohbet bulunamadı." });

        var adlar = Adlar(db);
        var gorevler = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in Ekip.Aktifler()) gorevler[PersonelOnek + (p.PersonelKodu ?? "").Trim()] = $"{p.Pozisyon} · {p.IsGrubu}".Trim(' ', '·');
        }
        catch { }

        var liste = db.Query(@"
SELECT u.kullanici AS kod, k.ad_soyad AS ad, k.rol, u.yonetici, u.uye_turu AS uyeTuru
FROM KRY_SOHBET_UYE u LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = u.kullanici
WHERE u.sohbet_id = @id AND u.ayrildi IS NULL", new { id })
            .Select(x =>
            {
                string kod = ((string)x.kod).Trim();
                return new
                {
                    kod,
                    ad = (string)x.ad ?? adlar.GetValueOrDefault(kod, kod),
                    rol = (string)x.rol ?? gorevler.GetValueOrDefault(kod),
                    yonetici = (bool)x.yonetici,
                    uyeTuru = (string)x.uyeTuru,
                };
            })
            .OrderByDescending(x => x.yonetici).ThenBy(x => x.ad)
            .ToList();

        return Ok(liste);
    }

    public class UyeGirdi
    {
        public List<string> Kullanicilar { get; set; } = new();
    }

    [HttpPost("{id:int}/Uye")]
    public IActionResult UyeEkle(int id, [FromBody] UyeGirdi g)
    {
        using var db = _vt.Baglanti();
        var s = db.QueryFirstOrDefault("SELECT tur, yonetici_ekler AS ye FROM KRY_SOHBET WHERE id = @id", new { id });
        if (s is null || !UyeMi(db, id, Ben)) return NotFound(new { hata = "Sohbet bulunamadı." });
        if ((string)s.tur != "grup") return BadRequest(new { hata = "Özel sohbete üye eklenemez; grup kurunuz." });
        if ((bool)s.ye && !YoneticiMi(db, id, Ben)) return StatusCode(403, new { hata = "Bu grupta üyeleri yalnızca yöneticiler ekleyebilir." });

        var gecerli = GecerliUyeler(db);
        var eklenecek = (g?.Kullanicilar ?? new()).Select(Esle)
            .Where(x => gecerli.Contains(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (eklenecek.Count == 0) return BadRequest(new { hata = "Kişi seçiniz." });

        var son = db.ExecuteScalar<int>("SELECT ISNULL(MAX(id), 0) FROM KRY_SOHBET_MESAJ WHERE sohbet_id = @id", new { id });
        foreach (var k in eklenecek)
            db.Execute(@"
MERGE KRY_SOHBET_UYE AS h USING (SELECT @id AS s, @k AS k) AS y ON h.sohbet_id = y.s AND h.kullanici = y.k
WHEN MATCHED THEN UPDATE SET ayrildi = NULL, son_okunan = @son
WHEN NOT MATCHED THEN INSERT (sohbet_id, kullanici, uye_turu, son_okunan) VALUES (@id, @k, @t, @son);", new { id, k, son, t = UyeTuru(k) });

        var adlar = Adlar(db);
        SistemMesaji(db, id, $"{adlar.GetValueOrDefault(Ben, Ben)}, {string.Join(", ", eklenecek.Select(x => adlar.GetValueOrDefault(x, x)))} kişisini gruba ekledi");
        return Ok(new { basarili = true });
    }

    [HttpDelete("{id:int}/Uye/{kullanici}")]
    public IActionResult UyeCikar(int id, string kullanici)
    {
        using var db = _vt.Baglanti();
        if (!UyeMi(db, id, Ben)) return NotFound(new { hata = "Sohbet bulunamadı." });
        var kendisi = string.Equals(kullanici, Ben, StringComparison.OrdinalIgnoreCase);
        if (!kendisi && !YoneticiMi(db, id, Ben)) return StatusCode(403, new { hata = "Üyeleri yalnızca grup yöneticisi çıkarabilir." });

        db.Execute("UPDATE KRY_SOHBET_UYE SET ayrildi = SYSDATETIME() WHERE sohbet_id = @id AND kullanici = @kullanici",
            new { id, kullanici });

        /* Yöneticisiz grup kalmasın: en eski üye yönetici olur */
        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_SOHBET_UYE WHERE sohbet_id = @id AND ayrildi IS NULL AND yonetici = 1)
UPDATE TOP (1) KRY_SOHBET_UYE SET yonetici = 1 WHERE sohbet_id = @id AND ayrildi IS NULL", new { id });

        var adlar = Adlar(db);
        SistemMesaji(db, id, kendisi
            ? $"{adlar.GetValueOrDefault(Ben, Ben)} gruptan ayrıldı"
            : $"{adlar.GetValueOrDefault(Ben, Ben)}, {adlar.GetValueOrDefault(kullanici, kullanici)} kişisini gruptan çıkardı");
        return Ok(new { basarili = true });
    }

    public class SessizGirdi { public bool Sessiz { get; set; } }

    [HttpPost("{id:int}/Sessiz")]
    public IActionResult Sessiz(int id, [FromBody] SessizGirdi g)
    {
        using var db = _vt.Baglanti();
        db.Execute("UPDATE KRY_SOHBET_UYE SET sessiz = @s WHERE sohbet_id = @id AND kullanici = @ben",
            new { id, s = g?.Sessiz ?? false, ben = Ben });
        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Mesajlar                                                              */
    /* ==================================================================== */

    /// <summary>
    /// Mesajlar. <c>sonra</c> verilirse yalnızca o id'den yenileri (anlık
    /// güncelleme); <c>once</c> verilirse eski mesajlar (yukarı kaydırma).
    /// </summary>
    [HttpGet("{id:int}/Mesajlar")]
    public IActionResult Mesajlar(int id, [FromQuery] int? sonra = null, [FromQuery] int? once = null)
    {
        using var db = _vt.Baglanti();
        if (!UyeMi(db, id, Ben)) return NotFound(new { hata = "Sohbet bulunamadı." });
        var adlar = Adlar(db);

        var satirlar = db.Query(@"
SELECT TOP 60 m.id, m.gonderen, m.tur, m.metin, m.yanit_id AS yanitId, m.dosya_ad AS dosyaAd, m.dosya_tur AS dosyaTur,
       m.dosya_boyut AS dosyaBoyut, m.silindi, m.tarih, m.duzenlendi, m.dosya_kaldirildi AS kaldirildi,
       y.metin AS yanitMetin, y.gonderen AS yanitGonderen, y.dosya_ad AS yanitDosya, y.silindi AS yanitSilindi
FROM KRY_SOHBET_MESAJ m
LEFT JOIN KRY_SOHBET_MESAJ y ON y.id = m.yanit_id
WHERE m.sohbet_id = @id
  AND (@sonra IS NULL OR m.id > @sonra
       OR (@degisim = 1 AND m.degisme >= DATEADD(SECOND, -20, SYSDATETIME())))
  AND (@once IS NULL OR m.id < @once)
ORDER BY CASE WHEN @sonra IS NULL THEN -m.id ELSE m.id END", new { id, sonra, once, degisim = sonra is null ? 0 : 1 })
            .ToList();

        if (sonra is null) satirlar.Reverse();

        var mesajlar = satirlar.Select(m =>
        {
            var silindi = (bool)m.silindi;
            string g = m.gonderen as string;
            string yg = m.yanitGonderen as string;
            return new
            {
                id = (int)m.id,
                gonderen = g,
                gonderenAd = g is null ? null : adlar.GetValueOrDefault(g, g),
                ben = string.Equals(g, Ben, StringComparison.OrdinalIgnoreCase),
                tur = silindi ? "metin" : (bool)m.kaldirildi && (string)m.tur != "sistem" ? "kaldirildi" : (string)m.tur,
                duzenlendi = !silindi && m.duzenlendi is not null,
                metin = silindi ? null : (string)m.metin,
                silindi,
                dosyaAd = silindi ? null : (string)m.dosyaAd,
                dosyaTur = silindi ? null : (string)m.dosyaTur,
                dosyaBoyut = silindi ? null : (long?)m.dosyaBoyut,
                tarih = (DateTime)m.tarih,
                yanit = m.yanitId is null ? null : new
                {
                    id = (int)m.yanitId,
                    gonderenAd = yg is null ? null : adlar.GetValueOrDefault(yg, yg),
                    metin = (m.yanitSilindi as bool?) == true ? "Bu mesaj silindi" : ((string)m.yanitMetin ?? (string)m.yanitDosya),
                },
            };
        }).ToList();

        /* Karşı tarafın okuduğu en son mesaj (özel sohbette çift tik) */
        var okunan = db.ExecuteScalar<int?>(@"
SELECT MIN(son_okunan) FROM KRY_SOHBET_UYE WHERE sohbet_id = @id AND ayrildi IS NULL AND kullanici <> @ben",
            new { id, ben = Ben }) ?? 0;

        return Ok(new { mesajlar, digerleriOkudu = okunan, dahaVar = sonra is null && satirlar.Count == 60 });
    }

    public class OkunduGirdi { public int SonId { get; set; } }

    [HttpPost("{id:int}/Okundu")]
    public IActionResult Okundu(int id, [FromBody] OkunduGirdi g)
    {
        using var db = _vt.Baglanti();
        db.Execute(@"
UPDATE KRY_SOHBET_UYE SET son_okunan = @son
WHERE sohbet_id = @id AND kullanici = @ben AND son_okunan < @son", new { id, son = g?.SonId ?? 0, ben = Ben });
        return Ok(new { basarili = true });
    }

    public class MesajGirdi
    {
        public string Metin { get; set; }
        public int? YanitId { get; set; }
    }

    private IActionResult YazabilirMi(IDbConnection db, int id)
    {
        var s = db.QueryFirstOrDefault("SELECT duyuru FROM KRY_SOHBET WHERE id = @id", new { id });
        if (s is null || !UyeMi(db, id, Ben)) return NotFound(new { hata = "Sohbet bulunamadı." });
        if ((bool)s.duyuru && !YoneticiMi(db, id, Ben))
            return StatusCode(403, new { hata = "Bu duyuru grubunda yalnızca yöneticiler mesaj yazabilir." });
        return null;
    }

    [HttpPost("{id:int}/Mesaj")]
    public IActionResult MesajGonder(int id, [FromBody] MesajGirdi g)
    {
        var metin = (g?.Metin ?? "").Trim();
        if (metin.Length == 0) return BadRequest(new { hata = "Mesaj boş." });
        if (metin.Length > 4000) metin = metin[..4000];

        using var db = _vt.Baglanti();
        if (YazabilirMi(db, id) is { } red) return red;

        var mid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_SOHBET_MESAJ (sohbet_id, gonderen, tur, metin, yanit_id) OUTPUT INSERTED.id
VALUES (@id, @ben, N'metin', @metin, @yanit);
", new { id, ben = Ben, metin, yanit = g.YanitId });

        db.Execute(@"
UPDATE KRY_SOHBET SET son_mesaj_zamani = SYSDATETIME() WHERE id = @id;
UPDATE KRY_SOHBET_UYE SET son_okunan = @mid WHERE sohbet_id = @id AND kullanici = @ben;
UPDATE KRY_SOHBET_UYE SET ayrildi = NULL WHERE sohbet_id = @id AND ayrildi IS NOT NULL
  AND EXISTS (SELECT 1 FROM KRY_SOHBET WHERE id = @id AND tur = N'kisi');", new { id, mid, ben = Ben });

        MobilBildir(db, id, metin);
        return Ok(new { id = mid });
    }

    [HttpPost("{id:int}/Dosya")]
    [RequestSizeLimit(TekIstekSiniri + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = TekIstekSiniri + 1024 * 1024)]
    public async Task<IActionResult> DosyaGonder(int id, IFormFile dosya, [FromForm] string metin, [FromForm] int? yanitId)
    {
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçiniz." });
        if (dosya.Length > TekIstekSiniri) return BadRequest(new { hata = "Bu dosya parça parça gönderilmeli; uygulamayı güncelleyin." });

        using var db = _vt.Baglanti();
        if (YazabilirMi(db, id) is { } red) return red;

        var ad = Path.GetFileName(dosya.FileName ?? "dosya");
        var yol = Path.Combine(Klasor(id), Guid.NewGuid().ToString("N") + GuvenliUzanti(ad));

        await using (var akis = System.IO.File.Create(yol))
            await dosya.CopyToAsync(akis);

        var mid = DosyaMesaji(db, id, yol, ad, dosya.ContentType, dosya.Length, metin, yanitId);
        return Ok(new { id = mid });
    }

    private int DosyaMesaji(IDbConnection db, int id, string yol, string ad, string icerikTuru, long boyut, string metin, int? yanitId)
    {
        ad = string.IsNullOrWhiteSpace(ad) ? "dosya" : ad.Trim();
        if (ad.Length > 200) ad = ad[^200..];
        var ct = string.IsNullOrWhiteSpace(icerikTuru) ? "application/octet-stream" : icerikTuru.Trim();
        if (ct.Length > 100) ct = "application/octet-stream";
        var goster = GosterilebilirUzanti.Contains(GuvenliUzanti(ad));
        var tur = goster && ct.StartsWith("image/") ? "gorsel" : goster && ct.StartsWith("video/") ? "video" : "dosya";

        var mid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_SOHBET_MESAJ (sohbet_id, gonderen, tur, metin, yanit_id, dosya_yol, dosya_ad, dosya_tur, dosya_boyut)
OUTPUT INSERTED.id
VALUES (@id, @ben, @tur, @metin, @yanitId, @yol, @ad, @ct, @boyut)",
            new
            {
                id, ben = Ben, tur,
                metin = string.IsNullOrWhiteSpace(metin) ? null : metin.Trim(),
                yanitId, yol, ad, ct, boyut,
            });

        db.Execute(@"
UPDATE KRY_SOHBET SET son_mesaj_zamani = SYSDATETIME() WHERE id = @id;
UPDATE KRY_SOHBET_UYE SET son_okunan = @mid WHERE sohbet_id = @id AND kullanici = @ben;", new { id, mid, ben = Ben });

        MobilBildir(db, id, !string.IsNullOrWhiteSpace(metin) ? metin.Trim()
            : tur == "gorsel" ? "📷 Görsel" : tur == "video" ? "🎬 Video" : "📎 " + ad);
        return mid;
    }

    /* ------------------------------------------------ parçalı yükleme */

    private string ParcaYolu(int id, string yukleme)
    {
        if (!Guid.TryParseExact(yukleme ?? "", "N", out _)) return null;
        var k = Path.Combine(Klasor(id), "_parca");
        if (!Directory.Exists(k)) Directory.CreateDirectory(k);

        /* Yarım kalan yüklemeler bir gün sonra silinir */
        try
        {
            foreach (var f in Directory.GetFiles(k, "*.part"))
                if (System.IO.File.GetLastWriteTimeUtc(f) < DateTime.UtcNow.AddDays(-1)) System.IO.File.Delete(f);
        }
        catch { /* başka yükleme kullanıyor olabilir */ }

        var sahip = new string(K(Ben).Where(char.IsLetterOrDigit).ToArray());
        return Path.Combine(k, $"{yukleme}_{sahip}.part");
    }

    /// <summary>
    /// Büyük dosyanın bir parçası (en fazla 32 MB). Parça, sırasına göre
    /// dosyadaki yerine yazılır; aynı parça yeniden gönderilirse üstüne yazar.
    /// </summary>
    [HttpPost("{id:int}/Parca")]
    [RequestSizeLimit(ParcaSiniri + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = ParcaSiniri + 1024 * 1024)]
    public async Task<IActionResult> Parca(int id, [FromForm] string yukleme, [FromForm] long baslangic, [FromForm] long toplam, IFormFile parca)
    {
        if (parca is null || parca.Length == 0) return BadRequest(new { hata = "Parça boş." });
        if (parca.Length > ParcaSiniri) return BadRequest(new { hata = "Parça çok büyük." });
        if (toplam <= 0 || toplam > DosyaSiniri) return BadRequest(new { hata = "Dosya en fazla 5 GB olabilir." });
        if (baslangic < 0 || baslangic + parca.Length > toplam) return BadRequest(new { hata = "Parça sırası geçersiz." });

        using var db = _vt.Baglanti();
        if (YazabilirMi(db, id) is { } red) return red;

        var yol = ParcaYolu(id, yukleme);
        if (yol is null) return BadRequest(new { hata = "Yükleme kimliği geçersiz." });

        await using (var akis = new FileStream(yol, FileMode.OpenOrCreate, FileAccess.Write, FileShare.None))
        {
            akis.Seek(baslangic, SeekOrigin.Begin);
            await parca.CopyToAsync(akis);
        }
        return Ok(new { tamam = true, alinan = baslangic + parca.Length });
    }

    public sealed class ParcaBitirGirdisi
    {
        public string Yukleme { get; set; }
        public string Ad { get; set; }
        public string Tur { get; set; }
        public long Boyut { get; set; }
        public string Metin { get; set; }
        public int? YanitId { get; set; }
    }

    /// <summary>Parçalar tamamlanınca dosyayı mesaj olarak ekler.</summary>
    [HttpPost("{id:int}/ParcaBitir")]
    public IActionResult ParcaBitir(int id, [FromBody] ParcaBitirGirdisi g)
    {
        using var db = _vt.Baglanti();
        if (YazabilirMi(db, id) is { } red) return red;
        var parca = ParcaYolu(id, g?.Yukleme);
        if (parca is null || !System.IO.File.Exists(parca)) return BadRequest(new { hata = "Yükleme bulunamadı; yeniden gönderin." });

        var boyut = new FileInfo(parca).Length;
        if (boyut != g.Boyut)
        {
            return BadRequest(new { hata = $"Dosya eksik geldi ({boyut:N0} / {g.Boyut:N0} bayt); yeniden gönderin." });
        }

        var ad = Path.GetFileName(g.Ad ?? "dosya");
        var yol = Path.Combine(Klasor(id), Guid.NewGuid().ToString("N") + GuvenliUzanti(ad));
        System.IO.File.Move(parca, yol);

        var mid = DosyaMesaji(db, id, yol, ad, g.Tur, boyut, g.Metin, g.YanitId);
        return Ok(new { id = mid });
    }

    /// <summary>Ek dosya: yalnızca sohbet üyesine.</summary>
    [HttpGet("Dosya/{mesajId:int}")]
    public IActionResult Dosya(int mesajId, [FromQuery] bool indir = false)
    {
        using var db = _vt.Baglanti();
        var m = db.QueryFirstOrDefault(@"
SELECT sohbet_id AS s, dosya_yol AS yol, dosya_ad AS ad, dosya_tur AS tur, silindi, dosya_kaldirildi AS kaldirildi
FROM KRY_SOHBET_MESAJ WHERE id = @mesajId", new { mesajId });

        if (m is null || (bool)m.silindi || (bool)m.kaldirildi || m.yol is null || !UyeMi(db, (int)m.s, Ben)) return NotFound();
        if (!System.IO.File.Exists((string)m.yol)) return NotFound();

        /* Yönetimden sıkıştırılan belgeler diskte .gz; açılarak gönderilir */
        if (((string)m.yol).EndsWith(".gz", StringComparison.OrdinalIgnoreCase))
        {
            var gz = new System.IO.Compression.GZipStream(System.IO.File.OpenRead((string)m.yol),
                System.IO.Compression.CompressionMode.Decompress);
            return indir ? File(gz, (string)m.tur, (string)m.ad) : File(gz, (string)m.tur);
        }

        /* Güvenli olmayan tür (html, svg, js…) her zaman indirme olarak ve
           içerik türü bildirilmeden: tarayıcı açıp çalıştırmasın */
        var goster = GosterilebilirUzanti.Contains(GuvenliUzanti((string)m.ad))
                     && !((string)m.tur ?? "").Contains("html", StringComparison.OrdinalIgnoreCase)
                     && !((string)m.tur ?? "").Contains("svg", StringComparison.OrdinalIgnoreCase);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var akis = System.IO.File.OpenRead((string)m.yol);
        if (!goster) return File(akis, "application/octet-stream", (string)m.ad, enableRangeProcessing: true);
        return indir
            ? File(akis, (string)m.tur, (string)m.ad, enableRangeProcessing: true)
            : File(akis, (string)m.tur, enableRangeProcessing: true);
    }

    /// <summary>
    /// Kendi mesajını siler: herkes için "Bu mesaj silindi" görünür, eki
    /// diskten de kaldırılır (yer kaplamasın).
    /// </summary>
    [HttpDelete("Mesaj/{mesajId:int}")]
    public IActionResult MesajSil(int mesajId)
    {
        using var db = _vt.Baglanti();
        var m = db.QueryFirstOrDefault(
            "SELECT dosya_yol AS yol FROM KRY_SOHBET_MESAJ WHERE id = @mesajId AND gonderen = @ben AND silindi = 0",
            new { mesajId, ben = Ben });
        if (m is null) return NotFound(new { hata = "Yalnızca kendi mesajınızı silebilirsiniz." });

        db.Execute(@"UPDATE KRY_SOHBET_MESAJ SET silindi = 1, dosya_kaldirildi = CASE WHEN dosya_yol IS NULL THEN 0 ELSE 1 END, degisme = SYSDATETIME() WHERE id = @mesajId", new { mesajId });
        DosyayiKaldir(m.yol as string);
        return Ok(new { basarili = true });
    }

    public class DuzenleGirdi
    {
        public string Metin { get; set; }
    }

    /// <summary>Kendi mesajının metnini düzenler; "düzenlendi" etiketi çıkar.</summary>
    [HttpPut("Mesaj/{mesajId:int}")]
    public IActionResult MesajDuzenle(int mesajId, [FromBody] DuzenleGirdi g)
    {
        var metin = (g?.Metin ?? "").Trim();
        if (metin.Length > 4000) metin = metin[..4000];

        using var db = _vt.Baglanti();
        var m = db.QueryFirstOrDefault(
            "SELECT tur FROM KRY_SOHBET_MESAJ WHERE id = @mesajId AND gonderen = @ben AND silindi = 0",
            new { mesajId, ben = Ben });
        if (m is null) return NotFound(new { hata = "Yalnızca kendi mesajınızı düzenleyebilirsiniz." });
        if ((string)m.tur == "metin" && metin.Length == 0) return BadRequest(new { hata = "Mesaj boş olamaz." });

        db.Execute(@"
UPDATE KRY_SOHBET_MESAJ SET metin = @metin, duzenlendi = SYSDATETIME(), degisme = SYSDATETIME()
WHERE id = @mesajId", new { mesajId, metin = metin.Length == 0 ? null : metin });
        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Mobil üyelere anlık bildirim (sessize alanlar ve gönderen hariç).
    /// Arka planda gönderiliyor: mesaj yanıtı Expo'yu beklemesin.
    /// Uygulama "mesaj|sohbetId" ile sohbeti açıyor; ön plandaysa üstte
    /// kendi balonunu gösteriyor.
    /// </summary>
    private void MobilBildir(IDbConnection db, int sohbetId, string metin)
    {
        try
        {
            /* Personel üyeler ve panel hesabı sicile bağlı olanlar telefona bildirim alır */
            var panelSicil = PanelHesaplari().GroupBy(x => x.Value, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(x => x.Key, x => x.First().Key, StringComparer.OrdinalIgnoreCase);
            var alicilar = db.Query<string>(@"
SELECT kullanici FROM KRY_SOHBET_UYE
WHERE sohbet_id = @sohbetId AND ayrildi IS NULL AND sessiz = 0 AND kullanici <> @ben",
                new { sohbetId, ben = Ben })
                .Select(x => x.Trim())
                .Select(x => x.StartsWith(PersonelOnek, StringComparison.OrdinalIgnoreCase) ? x[PersonelOnek.Length..]
                    : panelSicil.TryGetValue(x, out var sc) ? sc : null)
                .Where(x => !string.IsNullOrEmpty(x))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (alicilar.Count == 0) return;

            var s = db.QueryFirstOrDefault("SELECT tur, ad FROM KRY_SOHBET WHERE id = @sohbetId", new { sohbetId });
            var adlar = Adlar(db);
            var gonderen = adlar.GetValueOrDefault(Ben, Ben.StartsWith(PersonelOnek) ? Ben[PersonelOnek.Length..] : Ben);
            var baslik = (string)s?.tur == "grup" ? $"{(string)s.ad} · {gonderen}" : gonderen;
            var govde = (metin ?? "").Length > 160 ? metin[..157] + "…" : metin ?? "";

            var kapsam = HttpContext.RequestServices.GetRequiredService<IServiceScopeFactory>();
            _ = Task.Run(async () =>
            {
                try
                {
                    using var sc = kapsam.CreateScope();
                    await sc.ServiceProvider.GetRequiredService<BildirimServisi>()
                        .KisiyeOzelGonder(alicilar.Select(k => (k, baslik, govde)), $"mesaj|{sohbetId}");
                }
                catch (Exception h)
                {
                    _kayit.LogWarning(h, "Mesaj bildirimi gönderilemedi");
                }
            });
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Mesaj bildirimi hazırlanamadı");
        }
    }

    private void DosyayiKaldir(string yol)
    {
        if (string.IsNullOrWhiteSpace(yol)) return;
        try
        {
            if (System.IO.File.Exists(yol)) System.IO.File.Delete(yol);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Sohbet dosyası silinemedi");
        }
    }

    /* ==================================================================== */
    /* Yönetim: sohbet boyutları ve sıkıştırma                              */
    /* ==================================================================== */

    private bool TamYonetici =>
        Roller.TamYonetim(User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "");

    private static readonly HashSet<string> BelgeUzanti = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv",
    };

    /// <summary>Bütün sohbetler, mesaj sayısı ve diskteki boyutlarıyla (yalnızca tam yönetim).</summary>
    [HttpGet("Yonetim")]
    public IActionResult YonetimListe()
    {
        if (!TamYonetici) return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });
        using var db = _vt.Baglanti();
        var adlar = Adlar(db);

        var satirlar = db.Query(@"
SELECT s.id, s.tur, s.ad, s.olusturan, s.olusturma, s.son_mesaj_zamani AS sonMesaj,
       (SELECT COUNT(*) FROM KRY_SOHBET_UYE u WHERE u.sohbet_id = s.id AND u.ayrildi IS NULL) AS uye,
       (SELECT TOP 2 u.kullanici + N'|' FROM KRY_SOHBET_UYE u WHERE u.sohbet_id = s.id FOR XML PATH('')) AS kisiler,
       ISNULL(x.mesaj, 0) AS mesaj, ISNULL(x.silinen, 0) AS silinen,
       ISNULL(x.gorsel, 0) AS gorsel, ISNULL(x.video, 0) AS video, ISNULL(x.belge, 0) AS belge,
       ISNULL(x.boyutGorsel, 0) AS boyutGorsel, ISNULL(x.boyutVideo, 0) AS boyutVideo, ISNULL(x.boyutBelge, 0) AS boyutBelge,
       ISNULL(x.boyutSilinen, 0) AS boyutSilinen
FROM KRY_SOHBET s
OUTER APPLY (
    SELECT COUNT(*) AS mesaj,
           SUM(CASE WHEN m.silindi = 1 THEN 1 ELSE 0 END) AS silinen,
           SUM(CASE WHEN m.tur = N'gorsel' AND m.dosya_kaldirildi = 0 AND m.silindi = 0 THEN 1 ELSE 0 END) AS gorsel,
           SUM(CASE WHEN m.tur = N'video'  AND m.dosya_kaldirildi = 0 AND m.silindi = 0 THEN 1 ELSE 0 END) AS video,
           SUM(CASE WHEN m.tur = N'dosya'  AND m.dosya_kaldirildi = 0 AND m.silindi = 0 THEN 1 ELSE 0 END) AS belge,
           SUM(CASE WHEN m.tur = N'gorsel' AND m.dosya_kaldirildi = 0 AND m.silindi = 0 THEN ISNULL(m.disk_boyut, m.dosya_boyut) ELSE 0 END) AS boyutGorsel,
           SUM(CASE WHEN m.tur = N'video'  AND m.dosya_kaldirildi = 0 AND m.silindi = 0 THEN ISNULL(m.disk_boyut, m.dosya_boyut) ELSE 0 END) AS boyutVideo,
           SUM(CASE WHEN m.tur = N'dosya'  AND m.dosya_kaldirildi = 0 AND m.silindi = 0 THEN ISNULL(m.disk_boyut, m.dosya_boyut) ELSE 0 END) AS boyutBelge,
           SUM(CASE WHEN m.silindi = 1 AND m.dosya_kaldirildi = 0 AND m.dosya_yol IS NOT NULL THEN ISNULL(m.disk_boyut, m.dosya_boyut) ELSE 0 END) AS boyutSilinen
    FROM KRY_SOHBET_MESAJ m WHERE m.sohbet_id = s.id
) x
ORDER BY ISNULL(x.boyutGorsel, 0) + ISNULL(x.boyutVideo, 0) + ISNULL(x.boyutBelge, 0) DESC, s.id DESC").ToList();

        var liste = satirlar.Select(s =>
        {
            var kisiler = ((string)s.kisiler ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries)
                .Select(k => adlar.GetValueOrDefault(k.Trim(), k.Trim()));
            return new
            {
                id = (int)s.id,
                tur = (string)s.tur,
                ad = (string)s.tur == "kisi" ? string.Join(" ↔ ", kisiler) : (string)s.ad,
                olusturan = adlar.GetValueOrDefault(((string)s.olusturan ?? "").Trim(), (string)s.olusturan),
                olusturma = (DateTime)s.olusturma,
                sonMesaj = (DateTime?)s.sonMesaj,
                uye = (int)s.uye,
                mesaj = (int)s.mesaj,
                silinen = (int)s.silinen,
                gorsel = (int)s.gorsel,
                video = (int)s.video,
                belge = (int)s.belge,
                boyutGorsel = (long)s.boyutGorsel,
                boyutVideo = (long)s.boyutVideo,
                boyutBelge = (long)s.boyutBelge,
                boyutSilinen = (long)s.boyutSilinen,
            };
        }).ToList();

        return Ok(liste);
    }

    public class SikistirGirdi
    {
        /// <summary>Silinen mesajların kalan eklerini diskten kaldır</summary>
        public bool SilinenleriTemizle { get; set; } = true;
        /// <summary>Belgeleri (PDF, Office, metin) kayıpsız gzip'le</summary>
        public bool BelgeleriSikistir { get; set; } = true;
        /// <summary>Bu tarihten eski ekleri kaldır (mesaj kalır, "dosya kaldırıldı" görünür); null = kaldırma</summary>
        public DateTime? EskiEkTarihi { get; set; }
        /// <summary>Eski ek kaldırmada türler: video, gorsel, dosya</summary>
        public List<string> EskiEkTurleri { get; set; } = new() { "video" };
    }

    /// <summary>
    /// Bir sohbeti sıkıştırır. Mesaj metinleri hiç silinmez; yalnızca ekler
    /// küçültülür ya da (seçilirse) eski ekler kaldırılır. sohbetId = 0
    /// bütün sohbetlerde çalışır.
    /// </summary>
    [HttpPost("Yonetim/{sohbetId:int}/Sikistir")]
    public async Task<IActionResult> Sikistir(int sohbetId, [FromBody] SikistirGirdi g)
    {
        if (!TamYonetici) return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });
        g ??= new SikistirGirdi();
        using var db = _vt.Baglanti();

        long kazanilan = 0;
        int kaldirilan = 0, sikistirilan = 0;

        var satirlar = db.Query(@"
SELECT id, tur, silindi, dosya_yol AS yol, dosya_boyut AS boyut, disk_boyut AS disk, tarih
FROM KRY_SOHBET_MESAJ
WHERE (@sohbetId = 0 OR sohbet_id = @sohbetId) AND dosya_yol IS NOT NULL AND dosya_kaldirildi = 0",
            new { sohbetId }).ToList();

        var turler = new HashSet<string>(g.EskiEkTurleri ?? new(), StringComparer.OrdinalIgnoreCase);

        foreach (var m in satirlar)
        {
            string yol = m.yol;
            long boyut = (long?)m.disk ?? (long?)m.boyut ?? 0;
            bool kaldir = (g.SilinenleriTemizle && (bool)m.silindi)
                       || (g.EskiEkTarihi is not null && (DateTime)m.tarih < g.EskiEkTarihi.Value.Date
                           && turler.Contains((string)m.tur));

            if (kaldir)
            {
                DosyayiKaldir(yol);
                db.Execute("UPDATE KRY_SOHBET_MESAJ SET dosya_kaldirildi = 1, degisme = SYSDATETIME() WHERE id = @id", new { id = (int)m.id });
                kazanilan += boyut;
                kaldirilan++;
                continue;
            }

            if (g.BelgeleriSikistir && (string)m.tur == "dosya" && !(bool)m.silindi
                && BelgeUzanti.Contains(Path.GetExtension(yol)) && System.IO.File.Exists(yol))
            {
                try
                {
                    var hedef = yol + ".gz";
                    await using (var kaynak = System.IO.File.OpenRead(yol))
                    await using (var cikis = System.IO.File.Create(hedef))
                    await using (var gz = new System.IO.Compression.GZipStream(cikis, System.IO.Compression.CompressionLevel.SmallestSize))
                        await kaynak.CopyToAsync(gz);

                    var yeni = new FileInfo(hedef).Length;
                    if (yeni < boyut * 0.9)
                    {
                        db.Execute("UPDATE KRY_SOHBET_MESAJ SET dosya_yol = @hedef, disk_boyut = @yeni WHERE id = @id",
                            new { hedef, yeni, id = (int)m.id });
                        System.IO.File.Delete(yol);
                        kazanilan += boyut - yeni;
                        sikistirilan++;
                    }
                    else
                    {
                        /* Kazanç yoksa (zaten sıkışık bir belge) olduğu gibi kalır */
                        System.IO.File.Delete(hedef);
                    }
                }
                catch (Exception h)
                {
                    _kayit.LogWarning(h, "Sohbet belgesi sıkıştırılamadı: {Id}", (int)m.id);
                }
            }
        }

        _kayit.LogInformation("Sohbet sıkıştırıldı {Sohbet} by {Kim}: {Kaldirilan} kaldırıldı, {Sikistirilan} sıkıştırıldı, {Kazanc} bayt",
            sohbetId, Ben, kaldirilan, sikistirilan, kazanilan);

        return Ok(new { kaldirilan, sikistirilan, kazanilan });
    }

    /* ==================================================================== */
    /* Özet: okunmamış sayısı ve anlık bildirim                              */
    /* ==================================================================== */

    /// <summary>
    /// Panelin 8 saniyede bir sorduğu özet: toplam okunmamış ve
    /// <c>son</c> id'sinden sonra gelen (başkasının yazdığı) mesajlar —
    /// sağ alttaki bildirim ve ses için. Sessize alınan sohbetler bildirimde yok.
    /// </summary>
    [HttpGet("Ozet")]
    public IActionResult Ozet([FromQuery] int son = 0)
    {
        if (Mobil && !MobilAcik()) return Ok(new { okunmamis = 0, sonId = 0, yeniler = Array.Empty<object>() });

        try
        {
            using var db = _vt.Baglanti();

            var okunmamis = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_SOHBET_MESAJ m
JOIN KRY_SOHBET_UYE u ON u.sohbet_id = m.sohbet_id AND u.kullanici = @ben AND u.ayrildi IS NULL
WHERE m.id > u.son_okunan AND m.silindi = 0 AND m.tur <> N'sistem' AND ISNULL(m.gonderen, N'') <> @ben", new { ben = Ben });

            var sonId = db.ExecuteScalar<int>(@"
SELECT ISNULL(MAX(m.id), 0) FROM KRY_SOHBET_MESAJ m
JOIN KRY_SOHBET_UYE u ON u.sohbet_id = m.sohbet_id AND u.kullanici = @ben AND u.ayrildi IS NULL", new { ben = Ben });

            var yeniler = new List<object>();

            if (son > 0)
            {
                var adlar = Adlar(db);
                foreach (var m in db.Query(@"
SELECT TOP 10 m.id, m.sohbet_id AS sohbetId, m.gonderen, m.tur, m.metin, m.dosya_ad AS dosyaAd, s.tur AS sTur, s.ad AS sAd
FROM KRY_SOHBET_MESAJ m
JOIN KRY_SOHBET s ON s.id = m.sohbet_id
JOIN KRY_SOHBET_UYE u ON u.sohbet_id = m.sohbet_id AND u.kullanici = @ben AND u.ayrildi IS NULL AND u.sessiz = 0
WHERE m.id > @son AND m.silindi = 0 AND m.tur <> N'sistem' AND ISNULL(m.gonderen, N'') <> @ben
ORDER BY m.id", new { ben = Ben, son }))
                {
                    string g = m.gonderen;
                    var gAd = adlar.GetValueOrDefault(g ?? "", g);
                    yeniler.Add(new
                    {
                        id = (int)m.id,
                        sohbetId = (int)m.sohbetId,
                        baslik = (string)m.sTur == "grup" ? (string)m.sAd : gAd,
                        gonderenAd = gAd,
                        grup = (string)m.sTur == "grup",
                        metin = (string)m.metin ?? ((string)m.tur == "gorsel" ? "📷 Görsel" : (string)m.tur == "video" ? "🎬 Video" : "📎 " + (string)m.dosyaAd),
                    });
                }
            }

            return Ok(new { okunmamis, sonId, yeniler });
        }
        catch (Exception hata)
        {
            /* Tablolar henüz kurulmadıysa panel bozulmasın */
            _kayit.LogDebug(hata, "Sohbet özeti okunamadı");
            return Ok(new { okunmamis = 0, sonId = 0, yeniler = Array.Empty<object>() });
        }
    }
}

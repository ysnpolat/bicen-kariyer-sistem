using System.Data;
using System.Globalization;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen'den Haberler (08.10.2026): Biçen360 1.7'deki şirket içi akış.
///
/// <para>
/// Üç gönderi türü:
/// <list type="bullet">
/// <item><c>gonderi</c> — fotoğraflı paylaşım (Instagram düzeni). Panelden
///   ya da Biçen360'tan, paylaşım yetkisi verilen kişiler.</item>
/// <item><c>kampanya</c> — "Kasada bu hafta": dönem, ürünler (eski / yeni
///   fiyat) ve kasiyerin müşteriye söyleyeceği cümle. Yalnızca panelden.</item>
/// <item><c>anket</c> — tek seçimli oylama; oy veren sonucu görür, kim ne
///   verdi gizli. Yalnızca panelden.</item>
/// </list>
/// </para>
///
/// <para>
/// Herkes beğenir ve yorum yazar; yorumlar hemen yayınlanır, İK panelden
/// gizler. Gönderi herkese ya da seçili şubelere. Yeni gönderi bildirimi
/// yalnızca 1.7 ve üstü uygulamalara gidiyor (eskilerde ekran yok).
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class HaberController : ControllerBase
{
    private const string Personel = "Personel";
    private const string PanelRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK;
    private const string AyarAnahtari = "HABER_AYAR";
    private const int GorselSiniri = 10 * 1024 * 1024;

    public const string KampanyaKategori = "Kasada bu hafta";
    public const string AnketKategori = "Anket";

    private static readonly CultureInfo Tr = new("tr-TR");
    private static readonly JsonSerializerOptions Js = new(JsonSerializerDefaults.Web);

    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<HaberController> _kayit;

    public HaberController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim, ILogger<HaberController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Ortak                                                                */
    /* ==================================================================== */

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return (i < 0 ? govde : govde[..i]).Trim();
    }

    private string PanelAdi =>
        User?.FindFirst("adSoyad")?.Value is { Length: > 0 } a ? a : User?.Identity?.Name ?? "İK";

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    public sealed class Ayar
    {
        public List<string> Kategoriler { get; set; } = new() { "Duyuru", "Mağazalarımız", "Etkinlik", "Tebrik", "Eğitim" };
        public List<string> YasakliKelimeler { get; set; } = new();

        /// <summary>Yeni gönderide varsayılan olarak bildirim gönderilsin</summary>
        public bool Bildirim { get; set; } = true;

        /// <summary>Kurum adına paylaşımlarda görünen ad</summary>
        public string KurumAdi { get; set; } = "Biçen Market";

        /// <summary>Kurum profilinde adın altındaki tanıtım (09.10.2026)</summary>
        public string KurumAciklama { get; set; }

        /// <summary>Logo sürümü: değişince adres değişir, telefonlar eskisini önbellekten göstermez</summary>
        public string LogoSurum { get; set; }
    }

    private const string LogoAnahtari = "HABER_LOGO";

    /// <summary>Kurum logosunun adresi (yoksa null: yeşil "b" rozeti)</summary>
    private static string LogoAdresi(Ayar a) =>
        string.IsNullOrWhiteSpace(a?.LogoSurum) ? null : $"/api/Haber/Logo?v={a.LogoSurum}";

    /// <summary>Yazarın profil anahtarı: kurum ya da personel sicili</summary>
    private static string ProfilAnahtari(HaberSatiri h) =>
        h.Kurum || string.IsNullOrWhiteSpace(h.YazarSicil) ? "kurum" : h.YazarSicil.Trim();

    private Ayar AyarOku(IDbConnection db)
    {
        try
        {
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = AyarAnahtari });
            var a = string.IsNullOrWhiteSpace(ham) ? new Ayar() : JsonSerializer.Deserialize<Ayar>(ham, Js) ?? new Ayar();
            a.Kategoriler ??= new();
            a.YasakliKelimeler ??= new();
            if (string.IsNullOrWhiteSpace(a.KurumAdi)) a.KurumAdi = "Biçen Market";
            return a;
        }
        catch
        {
            return new Ayar();
        }
    }

    /* Türe özel veri */

    public sealed class Urun
    {
        public string Ad { get; set; }
        public decimal? Eski { get; set; }
        public decimal Yeni { get; set; }
        public string Birim { get; set; }
    }

    public sealed class KampanyaVeri
    {
        public string Baslik { get; set; }
        public string Donem { get; set; }
        public List<Urun> Urunler { get; set; } = new();

        /// <summary>Kasiyerin müşteriye söyleyeceği cümle</summary>
        public string Soyle { get; set; }
    }

    public sealed class AnketVeri
    {
        public string Soru { get; set; }
        public List<string> Secenekler { get; set; } = new();
        public DateTime? Bitis { get; set; }
    }

    private static T Oku<T>(string json) where T : class
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonSerializer.Deserialize<T>(json, Js); }
        catch { return null; }
    }

    private sealed class HaberSatiri
    {
        public int Id { get; set; }
        public string Tur { get; set; }
        public string Durum { get; set; }
        public string YazarSicil { get; set; }
        public string YazarAd { get; set; }
        public string YazarUnvan { get; set; }
        public bool Kurum { get; set; }
        public string Kategori { get; set; }
        public string Metin { get; set; }
        public string Veri { get; set; }
        public string Hedef { get; set; }
        public bool YorumAcik { get; set; }
        public bool Sabit { get; set; }
        public bool Gizli { get; set; }
        public string Olusturan { get; set; }
        public DateTime Olusturma { get; set; }
        public DateTime? Yayin { get; set; }

        /// <summary>Gönderi videosu (12.10.2026): duyuru-video klasöründeki anahtar</summary>
        public string Video { get; set; }
    }

    private const string Secim = @"
SELECT id, tur, durum, yazar_sicil AS YazarSicil, yazar_ad AS YazarAd, yazar_unvan AS YazarUnvan, kurum,
       kategori, metin, veri, hedef, yorum_acik AS YorumAcik, sabit, gizli, olusturan, olusturma, yayin, video
FROM KRY_HABER";

    private static List<string> HedefOku(string h) =>
        (h ?? "").Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

    /// <summary>Gönderi bu şubeye görünüyor mu (hedef boşsa herkese)</summary>
    private static bool HedefteMi(HaberSatiri h, string sube)
    {
        var l = HedefOku(h.Hedef);
        return l.Count == 0 || l.Any(x => string.Equals(x, (sube ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
    }

    private string GorselAdresi(int id, Guid anahtar) => $"/api/Haber/Gorsel/{id}?k={anahtar:N}";

    /// <summary>Gönderilerin ortak sayıları ve kişiye özel alanları</summary>
    private List<object> Kartlar(IDbConnection db, List<HaberSatiri> l, string sicil, bool panel)
    {
        if (l.Count == 0) return new List<object>();

        var idler = l.Select(x => x.Id).ToList();

        var gorseller = db.Query<(int HaberId, int Id, Guid Anahtar)>(
                "SELECT haber_id, id, anahtar FROM KRY_HABER_GORSEL WHERE haber_id IN @idler ORDER BY haber_id, sira, id", new { idler })
            .GroupBy(x => x.HaberId).ToDictionary(g => g.Key, g => g.Select(x => GorselAdresi(x.Id, x.Anahtar)).ToList());

        var begeni = db.Query<(int HaberId, int Sayi)>(
                "SELECT haber_id, COUNT(*) FROM KRY_HABER_BEGENI WHERE haber_id IN @idler GROUP BY haber_id", new { idler })
            .ToDictionary(x => x.HaberId, x => x.Sayi);

        var benimBegeni = string.IsNullOrEmpty(sicil)
            ? new HashSet<int>()
            : db.Query<int>("SELECT haber_id FROM KRY_HABER_BEGENI WHERE haber_id IN @idler AND sicil = @sicil", new { idler, sicil }).ToHashSet();

        /* "Ayşe Kara ve 12 kişi beğendi": son beğenen */
        var sonBegenen = db.Query<(int HaberId, string Sicil)>(@"
SELECT b.haber_id, b.sicil FROM KRY_HABER_BEGENI b
WHERE b.haber_id IN @idler AND b.tarih = (SELECT MAX(x.tarih) FROM KRY_HABER_BEGENI x WHERE x.haber_id = b.haber_id)", new { idler })
            .GroupBy(x => x.HaberId).ToDictionary(g => g.Key, g => g.First().Sicil);

        var yorumSayisi = db.Query<(int HaberId, int Sayi, int Gizli)>(@"
SELECT haber_id, SUM(CASE WHEN gizli = 0 THEN 1 ELSE 0 END), SUM(CASE WHEN gizli = 1 THEN 1 ELSE 0 END)
FROM KRY_HABER_YORUM WHERE haber_id IN @idler GROUP BY haber_id", new { idler })
            .ToDictionary(x => x.HaberId, x => (x.Sayi, x.Gizli));

        var sonYorumlar = db.Query<(int HaberId, string Ad, string Metin)>(@"
SELECT haber_id, ad, metin FROM (
    SELECT haber_id, ad, metin, ROW_NUMBER() OVER (PARTITION BY haber_id ORDER BY id DESC) AS s
    FROM KRY_HABER_YORUM WHERE haber_id IN @idler AND gizli = 0
) x WHERE s <= 2 ORDER BY haber_id, s DESC", new { idler })
            .GroupBy(x => x.HaberId).ToDictionary(g => g.Key, g => g.Select(y => new { ad = y.Ad, metin = y.Metin }).ToList());

        var anketler = l.Where(x => x.Tur == "anket").Select(x => x.Id).ToList();

        var oylar = anketler.Count == 0
            ? new Dictionary<int, Dictionary<int, int>>()
            : db.Query<(int HaberId, int Secenek, int Sayi)>(
                    "SELECT haber_id, secenek, COUNT(*) FROM KRY_HABER_OY WHERE haber_id IN @anketler GROUP BY haber_id, secenek", new { anketler })
                .GroupBy(x => x.HaberId).ToDictionary(g => g.Key, g => g.ToDictionary(y => y.Secenek, y => y.Sayi));

        var oyum = anketler.Count == 0 || string.IsNullOrEmpty(sicil)
            ? new Dictionary<int, int>()
            : db.Query<(int HaberId, int Secenek)>(
                    "SELECT haber_id, secenek FROM KRY_HABER_OY WHERE haber_id IN @anketler AND sicil = @sicil", new { anketler, sicil })
                .ToDictionary(x => x.HaberId, x => x.Secenek);

        string Ad(string s)
        {
            var p = string.IsNullOrEmpty(s) ? null : _ekip.Kisi(s);
            return p is null ? null : $"{p.Ad} {p.Soyad}".Trim();
        }

        var logo = LogoAdresi(AyarOku(db));

        return l.Select(h =>
        {
            object kampanya = null, anket = null;

            if (h.Tur == "kampanya")
            {
                var k = Oku<KampanyaVeri>(h.Veri) ?? new KampanyaVeri();
                kampanya = new
                {
                    baslik = string.IsNullOrWhiteSpace(k.Baslik) ? KampanyaKategori : k.Baslik,
                    donem = k.Donem,
                    soyle = k.Soyle,
                    urunler = (k.Urunler ?? new()).Select(u => new
                    {
                        ad = u.Ad,
                        birim = u.Birim,
                        eski = u.Eski,
                        yeni = u.Yeni,
                        eskiYazi = u.Eski is { } e ? e.ToString("N2", Tr) : null,
                        yeniYazi = u.Yeni.ToString("N2", Tr),
                    }),
                };
            }

            if (h.Tur == "anket")
            {
                var a = Oku<AnketVeri>(h.Veri) ?? new AnketVeri();
                var say = oylar.TryGetValue(h.Id, out var d) ? d : new Dictionary<int, int>();
                var toplam = say.Values.Sum();
                var bitti = a.Bitis is { } b && b.Date < DateTime.Today;
                int? benim = oyum.TryGetValue(h.Id, out var o) ? o : null;

                /* Oy vermeyen sonucu görmüyor (etkilenmesin); panel ve bitmiş anket görür */
                var goster = panel || bitti || benim is not null;

                anket = new
                {
                    soru = a.Soru,
                    bitis = a.Bitis?.ToString("yyyy-MM-dd"),
                    bitti,
                    toplam,
                    oyum = benim,
                    sonucGorunur = goster,
                    secenekler = (a.Secenekler ?? new()).Select((ad, i) =>
                    {
                        var n = say.TryGetValue(i, out var x) ? x : 0;
                        return new
                        {
                            ad,
                            oy = goster ? n : (int?)null,
                            yuzde = goster && toplam > 0 ? (int?)Math.Round(100.0 * n / toplam) : (goster ? 0 : null),
                        };
                    }),
                };
            }

            var ys = yorumSayisi.TryGetValue(h.Id, out var y) ? y : (0, 0);

            return (object)new
            {
                id = h.Id,
                tur = h.Tur,
                yazar = new { ad = h.YazarAd, unvan = h.YazarUnvan, kurum = h.Kurum, foto = h.Kurum ? logo : null, profil = ProfilAnahtari(h) },
                kategori = h.Tur == "kampanya" ? KampanyaKategori : h.Tur == "anket" ? AnketKategori : h.Kategori,
                metin = h.Metin,
                gorseller = gorseller.TryGetValue(h.Id, out var g) ? g : new List<string>(),
                /* Video (12.10.2026, 1.7): göreli adres; aralıklı okuma açık */
                video = VideoParca.DosyaYolu(h.Video),
                begeni = begeni.TryGetValue(h.Id, out var bs) ? bs : 0,
                begendim = benimBegeni.Contains(h.Id),
                begeniOzet = sonBegenen.TryGetValue(h.Id, out var sb) ? Ad(sb) : null,
                yorumSayisi = ys.Item1,
                gizliYorum = panel ? ys.Item2 : 0,
                sonYorumlar = sonYorumlar.TryGetValue(h.Id, out var sy) ? sy : null,
                yorumAcik = h.YorumAcik,
                sabit = h.Sabit,
                gizli = panel && h.Gizli,
                durum = panel ? h.Durum : null,
                hedef = panel ? HedefOku(h.Hedef) : null,
                tarih = h.Yayin ?? h.Olusturma,
                kampanya,
                anket,
            };
        }).ToList();
    }

    /* ==================================================================== */
    /* Biçen360                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Akış: yayındaki, gizlenmemiş ve kişinin şubesine görünen gönderiler;
    /// sabitler ilk sayfada başta. <c>once</c> verilirse o kimlikten eskiler.
    /// </summary>
    [HttpGet("Akis")]
    [Authorize(Roles = Personel)]
    public IActionResult Akis([FromQuery] int? once = null)
    {
        var sicil = Sicil();
        var ben = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        var ayar = AyarOku(db);

        /* Şube süzgeci bellekte: hedef listesi kısa ve gönderi sayısı küçük */
        var adaylar = db.Query<HaberSatiri>(Secim + @"
WHERE durum = N'yayin' AND silindi = 0 AND gizli = 0 AND (@once IS NULL OR id < @once)
ORDER BY " + (once is null ? "sabit DESC, " : "") + "ISNULL(yayin, olusturma) DESC, id DESC", new { once })
            .Where(h => HedefteMi(h, ben.IsGrubu))
            .Take(20)
            .ToList();

        var yetki = db.QueryFirstOrDefault<bool?>("SELECT kurum_adina FROM KRY_HABER_YETKI WHERE sicil = @sicil", new { sicil });

        return Ok(new
        {
            ben = new { ad = $"{ben.Ad} {ben.Soyad}".Trim() },
            paylasabilir = yetki is not null,
            kategoriler = ayar.Kategoriler.Concat(new[] { KampanyaKategori, AnketKategori }).Distinct().ToList(),
            paylasimKategorileri = ayar.Kategoriler,
            gonderiler = Kartlar(db, adaylar, sicil, false),
            devami = adaylar.Count == 20,
        });
    }

    /// <summary>
    /// Profil (09.10.2026): yazarın adı, ünvanı, sayıları ve kişinin
    /// görebildiği gönderileri. <c>anahtar</c> "kurum" ya da personel sicili.
    /// </summary>
    [HttpGet("Profil")]
    [Authorize(Roles = Personel)]
    public IActionResult Profil([FromQuery] string anahtar)
    {
        var sicil = Sicil();
        var ben = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        anahtar = (anahtar ?? "").Trim();
        if (anahtar.Length == 0) return BadRequest(new { hata = "Profil seçilmedi." });

        var kurum = string.Equals(anahtar, "kurum", StringComparison.OrdinalIgnoreCase);

        using var db = _vt.Baglanti();
        var ayar = AyarOku(db);

        var hepsi = db.Query<HaberSatiri>(Secim + @"
WHERE durum = N'yayin' AND silindi = 0 AND gizli = 0
  AND " + (kurum ? "kurum = 1" : "kurum = 0 AND LTRIM(RTRIM(yazar_sicil)) IN @siciller") + @"
ORDER BY ISNULL(yayin, olusturma) DESC, id DESC",
                new { siciller = new[] { anahtar, K(anahtar), "0" + K(anahtar), "00" + K(anahtar) }.Distinct().ToArray() })
            .Where(h => HedefteMi(h, ben.IsGrubu))
            .Take(90)
            .ToList();

        var kartlar = Kartlar(db, hepsi, sicil, false);
        var idler = hepsi.Select(x => x.Id).ToList();

        var begeniToplam = idler.Count == 0 ? 0
            : db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_BEGENI WHERE haber_id IN @idler", new { idler });
        var yorumToplam = idler.Count == 0 ? 0
            : db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_YORUM WHERE haber_id IN @idler AND gizli = 0", new { idler });

        object profil;

        if (kurum)
        {
            profil = new
            {
                anahtar = "kurum",
                ad = ayar.KurumAdi,
                unvan = "Biçen360 · resmî hesap",
                aciklama = ayar.KurumAciklama,
                foto = LogoAdresi(ayar),
                kurum = true,
            };
        }
        else
        {
            var p = _ekip.Kisi(anahtar);
            var son = hepsi.FirstOrDefault();
            profil = new
            {
                anahtar = p?.PersonelKodu?.Trim() ?? anahtar,
                ad = p is not null ? $"{p.Ad} {p.Soyad}".Trim() : son?.YazarAd ?? "Çalışma arkadaşı",
                unvan = p is not null
                    ? string.Join(" · ", new[] { p.Pozisyon, p.IsGrubu }.Where(x => !string.IsNullOrWhiteSpace(x)))
                    : son?.YazarUnvan,
                aciklama = (string)null,
                foto = (string)null,
                kurum = false,
            };
        }

        return Ok(new
        {
            profil,
            gonderiSayisi = hepsi.Count,
            begeniToplam,
            yorumToplam,
            ben = new { ad = $"{ben.Ad} {ben.Soyad}".Trim() },
            gonderiler = kartlar,
        });
    }

    /// <summary>Kurum logosu: herkese açık (şirket logosu, kişisel veri yok)</summary>
    [HttpGet("Logo")]
    [AllowAnonymous]
    public IActionResult Logo()
    {
        using var db = _vt.Baglanti();
        var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = LogoAnahtari });
        if (string.IsNullOrWhiteSpace(ham)) return NotFound();

        byte[] b;
        try { b = Convert.FromBase64String(ham); }
        catch { return NotFound(); }

        var tur = TurBul(b);
        if (tur is null) return NotFound();

        Response.Headers["Cache-Control"] = "public, max-age=604800, immutable";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(b, tur);
    }

    private HaberSatiri GorunurHaber(IDbConnection db, int id, PersonelKaydi ben)
    {
        var h = db.QueryFirstOrDefault<HaberSatiri>(Secim + " WHERE id = @id AND durum = N'yayin' AND silindi = 0 AND gizli = 0", new { id });
        return h is not null && HedefteMi(h, ben.IsGrubu) ? h : null;
    }

    public sealed class BegenGirdi { public bool Begen { get; set; } = true; }

    [HttpPost("{id:int}/Begen")]
    [Authorize(Roles = Personel)]
    public IActionResult Begen(int id, [FromBody] BegenGirdi g)
    {
        var sicil = Sicil();
        var ben = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        if (GorunurHaber(db, id, ben) is null) return NotFound(new { hata = "Gönderi bulunamadı." });

        if (g?.Begen != false)
            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_HABER_BEGENI WHERE haber_id = @id AND sicil = @sicil)
    INSERT INTO KRY_HABER_BEGENI (haber_id, sicil) VALUES (@id, @sicil)", new { id, sicil });
        else
            db.Execute("DELETE FROM KRY_HABER_BEGENI WHERE haber_id = @id AND sicil = @sicil", new { id, sicil });

        return Ok(new { begeni = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_BEGENI WHERE haber_id = @id", new { id }) });
    }

    [HttpGet("{id:int}/Begenenler")]
    [Authorize(Roles = Personel)]
    public IActionResult Begenenler(int id)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        if (GorunurHaber(db, id, ben) is null) return NotFound(new { hata = "Gönderi bulunamadı." });

        var kisiler = db.Query<string>("SELECT TOP 500 sicil FROM KRY_HABER_BEGENI WHERE haber_id = @id ORDER BY tarih DESC", new { id })
            .Select(s => _ekip.Kisi(s))
            .Where(p => p is not null)
            .Select(p => new { ad = $"{p.Ad} {p.Soyad}".Trim(), unvan = p.Pozisyon, sube = p.IsGrubu })
            .ToList();

        return Ok(new { kisiler });
    }

    [HttpGet("{id:int}/Yorumlar")]
    [Authorize(Roles = Personel)]
    public IActionResult Yorumlar(int id)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        if (GorunurHaber(db, id, ben) is null) return NotFound(new { hata = "Gönderi bulunamadı." });

        var yorumlar = db.Query(@"
SELECT id, ad, unvan, metin, tarih, CASE WHEN sicil = @sicil THEN 1 ELSE 0 END AS benim
FROM KRY_HABER_YORUM WHERE haber_id = @id AND gizli = 0 ORDER BY id", new { id, sicil = ben.PersonelKodu.Trim() }).ToList();

        return Ok(new { yorumlar });
    }

    public sealed class YorumGirdi { public string Metin { get; set; } }

    [HttpPost("{id:int}/Yorum")]
    [Authorize(Roles = Personel)]
    public async Task<IActionResult> Yorum(int id, [FromBody] YorumGirdi g)
    {
        var sicil = Sicil();
        var ben = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var metin = (g?.Metin ?? "").Trim();
        if (metin.Length == 0) return BadRequest(new { hata = "Yorum boş olamaz." });
        if (metin.Length > 500) return BadRequest(new { hata = "Yorum en fazla 500 karakter olabilir." });

        using var db = _vt.Baglanti();
        var h = GorunurHaber(db, id, ben);
        if (h is null) return NotFound(new { hata = "Gönderi bulunamadı." });
        if (!h.YorumAcik) return BadRequest(new { hata = "Bu gönderide yorumlar kapalı." });

        var ayar = AyarOku(db);
        var kucuk = metin.ToLower(Tr);

        if (ayar.YasakliKelimeler.Any(k => !string.IsNullOrWhiteSpace(k) && kucuk.Contains(k.Trim().ToLower(Tr))))
            return BadRequest(new { hata = "Yorumunuz uygun olmayan bir ifade içerdiği için gönderilemedi." });

        var ad = $"{ben.Ad} {ben.Soyad}".Trim();
        var unvan = string.Join(" · ", new[] { ben.Pozisyon, ben.IsGrubu }.Where(x => !string.IsNullOrWhiteSpace(x)));

        var yid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HABER_YORUM (haber_id, sicil, ad, unvan, metin) OUTPUT INSERTED.id
VALUES (@id, @sicil, @ad, @unvan, @metin)", new { id, sicil, ad, unvan, metin });

        /* Gönderi sahibine haber (kurum adına paylaşılanlarda gitmiyor) */
        if (!h.Kurum && !string.IsNullOrWhiteSpace(h.YazarSicil) && K(h.YazarSicil) != K(sicil))
        {
            try
            {
                await _bildirim.Gonder(h.YazarSicil, "Gönderine yorum yapıldı", $"{ad}: {(metin.Length > 80 ? metin[..77] + "…" : metin)}", "haberler");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Haber yorum bildirimi gönderilemedi");
            }
        }

        return Ok(new { yorum = new { id = yid, ad, unvan, metin, tarih = DateTime.Now, benim = 1 } });
    }

    public sealed class OyGirdi { public int Secenek { get; set; } }

    [HttpPost("{id:int}/Oy")]
    [Authorize(Roles = Personel)]
    public IActionResult Oy(int id, [FromBody] OyGirdi g)
    {
        var sicil = Sicil();
        var ben = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        var h = GorunurHaber(db, id, ben);
        if (h is null || h.Tur != "anket") return NotFound(new { hata = "Anket bulunamadı." });

        var a = Oku<AnketVeri>(h.Veri) ?? new AnketVeri();
        if (a.Bitis is { } b && b.Date < DateTime.Today) return BadRequest(new { hata = "Anket sona erdi." });
        if (g is null || g.Secenek < 0 || g.Secenek >= (a.Secenekler?.Count ?? 0)) return BadRequest(new { hata = "Geçersiz seçenek." });

        var n = db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_HABER_OY WHERE haber_id = @id AND sicil = @sicil)
    INSERT INTO KRY_HABER_OY (haber_id, sicil, secenek, sube) VALUES (@id, @sicil, @s, @sube)",
            new { id, sicil, s = g.Secenek, sube = ben.IsGrubu });

        if (n == 0) return BadRequest(new { hata = "Bu ankette oyunuzu zaten kullandınız." });

        return Ok(new { gonderi = Kartlar(db, new List<HaberSatiri> { h }, sicil, false)[0] });
    }

    /* ---------------------------------------------- Biçen360'tan paylaşım */

    public sealed class GonderiGirdi
    {
        public string Tur { get; set; } = "gonderi";
        public string Metin { get; set; }
        public string Kategori { get; set; }
        public bool YorumAcik { get; set; } = true;
        public bool Sabit { get; set; }
        public List<string> Hedef { get; set; }
        public string YazarAd { get; set; }
        public KampanyaVeri Kampanya { get; set; }
        public AnketVeri Anket { get; set; }
    }

    /// <summary>Taslak açar (görseller ardından yüklenir, sonra Yayinla).</summary>
    [HttpPost]
    [Authorize(Roles = Personel)]
    public IActionResult Olustur([FromBody] GonderiGirdi g)
    {
        var sicil = Sicil();
        var ben = _ekip.Kisi(sicil);
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kurumAdina = db.QueryFirstOrDefault<bool?>("SELECT kurum_adina FROM KRY_HABER_YETKI WHERE sicil = @sicil", new { sicil });
        if (kurumAdina is null) return StatusCode(403, new { hata = "Gönderi paylaşma yetkiniz yok." });

        var ayar = AyarOku(db);
        var metin = (g?.Metin ?? "").Trim();
        if (metin.Length > 2200) return BadRequest(new { hata = "Açıklama en fazla 2200 karakter olabilir." });

        var kategori = ayar.Kategoriler.FirstOrDefault(x => string.Equals(x, g?.Kategori, StringComparison.OrdinalIgnoreCase));

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HABER (tur, durum, yazar_sicil, yazar_ad, yazar_unvan, kurum, kategori, metin, yorum_acik, olusturan)
OUTPUT INSERTED.id
VALUES (N'gonderi', N'taslak', @sicil, @ad, @unvan, @kurum, @kategori, @metin, @yorum, @ad)",
            new
            {
                sicil,
                ad = kurumAdina == true ? ayar.KurumAdi : $"{ben.Ad} {ben.Soyad}".Trim(),
                unvan = kurumAdina == true ? null : string.Join(" · ", new[] { ben.Pozisyon, ben.IsGrubu }.Where(x => !string.IsNullOrWhiteSpace(x))),
                kurum = kurumAdina == true,
                kategori,
                metin = metin.Length == 0 ? null : metin,
                yorum = g?.YorumAcik ?? true,
            });

        return Ok(new { id });
    }

    [HttpPost("{id:int}/Gorsel")]
    [Authorize(Roles = Personel)]
    [RequestSizeLimit(GorselSiniri + 128 * 1024)]
    public async Task<IActionResult> GorselMobil(int id, IFormFile dosya)
    {
        var sicil = Sicil();

        using var db = _vt.Baglanti();

        var taslak = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_HABER WHERE id = @id AND yazar_sicil = @sicil AND durum = N'taslak' AND silindi = 0", new { id, sicil });
        if (taslak == 0) return NotFound(new { hata = "Gönderi bulunamadı." });

        return await GorselKaydet(db, id, dosya);
    }

    public sealed class YayinGirdi { public bool Bildirim { get; set; } = true; }

    [HttpPost("{id:int}/Yayinla")]
    [Authorize(Roles = Personel)]
    public async Task<IActionResult> YayinlaMobil(int id, [FromBody] YayinGirdi g)
    {
        var sicil = Sicil();

        using var db = _vt.Baglanti();

        var h = db.QueryFirstOrDefault<HaberSatiri>(Secim + " WHERE id = @id AND yazar_sicil = @sicil AND silindi = 0", new { id, sicil });
        if (h is null) return NotFound(new { hata = "Gönderi bulunamadı." });

        if (string.IsNullOrEmpty(h.Video) && db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_GORSEL WHERE haber_id = @id", new { id }) == 0)
            return BadRequest(new { hata = "Gönderide en az bir fotoğraf ya da video olmalı." });

        return await Yayinla(db, h, g?.Bildirim ?? true);
    }

    /* ==================================================================== */
    /* Video (12.10.2026)                                                   */
    /* ==================================================================== */

    /// <summary>Gönderi videosu en çok 300 MB (telefondan yüklenecek)</summary>
    private const long VideoSiniri = 300L * 1024 * 1024;

    private string VideoKlasoru() => VideoParca.Klasor(
        HttpContext.RequestServices.GetRequiredService<IConfiguration>(),
        HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>());

    /// <summary>Parça yazar; son parçada videoyu gönderiye bağlar (eski video silinir)</summary>
    private async Task<IActionResult> VideoParcaYaz(IDbConnection db, int id, string anahtar, int sira, int toplam,
        string dosyaAdi, long boyut, int parcaBoyut, IFormFile parca)
    {
        if (parca is null && Request.HasFormContentType) parca = Request.Form.Files.FirstOrDefault();

        var klasor = VideoKlasoru();
        var sonuc = await VideoParca.Yaz(klasor, anahtar, sira, toplam, dosyaAdi, boyut, parca, parcaBoyut, VideoSiniri,
            HttpContext.RequestServices.GetRequiredService<ILogger<HaberController>>());

        if (sonuc.Kod != 200) return StatusCode(sonuc.Kod, sonuc.Govde);
        if (!sonuc.Tamam) return Ok(sonuc.Govde);

        var eski = db.ExecuteScalar<string>("SELECT video FROM KRY_HABER WHERE id = @id", new { id });
        db.Execute("UPDATE KRY_HABER SET video = @v WHERE id = @id", new { id, v = sonuc.Anahtar });
        if (!string.IsNullOrEmpty(eski) && eski != sonuc.Anahtar) VideoParca.Sil(klasor, eski);

        return Ok(new { anahtar = sonuc.Anahtar, tamam = true, video = VideoParca.DosyaYolu(sonuc.Anahtar) });
    }

    /// <summary>Biçen360: taslağa video (8 MB'a kadar parçalarla)</summary>
    [HttpPost("{id:int}/VideoParca")]
    [Authorize(Roles = Personel)]
    [RequestSizeLimit(VideoParca.Parca + 2 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = VideoParca.Parca + 2 * 1024 * 1024)]
    public async Task<IActionResult> VideoParcaMobil(int id,
        [FromForm] string anahtar, [FromForm] int sira, [FromForm] int toplam,
        [FromForm] string dosyaAdi, [FromForm] long boyut, [FromForm] int parcaBoyut, IFormFile parca)
    {
        var sicil = Sicil();

        using var db = _vt.Baglanti();

        var taslak = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_HABER WHERE id = @id AND yazar_sicil = @sicil AND durum = N'taslak' AND silindi = 0", new { id, sicil });
        if (taslak == 0) return NotFound(new { hata = "Gönderi bulunamadı." });

        return await VideoParcaYaz(db, id, anahtar, sira, toplam, dosyaAdi, boyut, parcaBoyut, parca);
    }

    /// <summary>İK paneli: gönderiye video</summary>
    [HttpPost("Panel/{id:int}/VideoParca")]
    [Authorize(Roles = PanelRolleri)]
    [RequestSizeLimit(VideoParca.Parca + 2 * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = VideoParca.Parca + 2 * 1024 * 1024)]
    public async Task<IActionResult> PanelVideoParca(int id,
        [FromForm] string anahtar, [FromForm] int sira, [FromForm] int toplam,
        [FromForm] string dosyaAdi, [FromForm] long boyut, [FromForm] int parcaBoyut, IFormFile parca)
    {
        using var db = _vt.Baglanti();

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER WHERE id = @id AND silindi = 0", new { id }) == 0)
            return NotFound(new { hata = "Gönderi bulunamadı." });

        return await VideoParcaYaz(db, id, anahtar, sira, toplam, dosyaAdi, boyut, parcaBoyut, parca);
    }

    /// <summary>İK paneli: gönderinin videosunu kaldırır</summary>
    [HttpPost("Panel/{id:int}/VideoSil")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult PanelVideoSil(int id)
    {
        using var db = _vt.Baglanti();

        var eski = db.ExecuteScalar<string>("SELECT video FROM KRY_HABER WHERE id = @id AND silindi = 0", new { id });
        db.Execute("UPDATE KRY_HABER SET video = NULL WHERE id = @id", new { id });
        if (!string.IsNullOrEmpty(eski)) VideoParca.Sil(VideoKlasoru(), eski);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Görseller                                                            */
    /* ==================================================================== */

    private async Task<IActionResult> GorselKaydet(IDbConnection db, int id, IFormFile dosya)
    {
        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Fotoğraf seçilmedi." });
        if (dosya.Length > GorselSiniri) return BadRequest(new { hata = "Fotoğraf en fazla 10 MB olabilir." });

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_GORSEL WHERE haber_id = @id", new { id }) >= 10)
            return BadRequest(new { hata = "Bir gönderide en fazla 10 fotoğraf olabilir." });

        byte[] icerik;
        using (var akis = new MemoryStream())
        {
            await dosya.CopyToAsync(akis);
            icerik = akis.ToArray();
        }

        var tur = TurBul(icerik);
        if (tur is null) return BadRequest(new { hata = "JPG, PNG ya da WebP yükleyiniz." });

        var sira = db.ExecuteScalar<int>("SELECT ISNULL(MAX(sira), -1) + 1 FROM KRY_HABER_GORSEL WHERE haber_id = @id", new { id });

        var gid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HABER_GORSEL (haber_id, sira, tur, boyut, icerik) OUTPUT INSERTED.id
VALUES (@id, @sira, @tur, @boyut, @icerik)", new { id, sira, tur, boyut = icerik.Length, icerik });

        return Ok(new { id = gid });
    }

    /// <summary>
    /// Görsel. Herkese açık ama adres tahmin edilemiyor (anahtar): mobil
    /// Image ve panel img etiketi başlık gönderemiyor.
    /// </summary>
    [HttpGet("Gorsel/{gid:int}")]
    [AllowAnonymous]
    public IActionResult Gorsel(int gid, [FromQuery] string k)
    {
        if (!Guid.TryParse(k, out var anahtar)) return NotFound();

        using var db = _vt.Baglanti();

        var g = db.QueryFirstOrDefault<(byte[] Icerik, string Tur)>(@"
SELECT g.icerik, g.tur FROM KRY_HABER_GORSEL g
JOIN KRY_HABER h ON h.id = g.haber_id AND h.silindi = 0
WHERE g.id = @gid AND g.anahtar = @anahtar", new { gid, anahtar });

        if (g.Icerik is null) return NotFound();

        Response.Headers["Cache-Control"] = "public, max-age=604800, immutable";
        Response.Headers["X-Content-Type-Options"] = "nosniff";

        return File(g.Icerik, g.Tur);
    }

    private static string TurBul(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
            return "image/webp";
        return null;
    }

    /* ==================================================================== */
    /* Yayın ve bildirim                                                    */
    /* ==================================================================== */

    private async Task<IActionResult> Yayinla(IDbConnection db, HaberSatiri h, bool bildirim)
    {
        db.Execute("UPDATE KRY_HABER SET durum = N'yayin', yayin = ISNULL(yayin, SYSDATETIME()) WHERE id = @Id", new { h.Id });

        if (bildirim && h.Durum != "yayin")
        {
            try
            {
                await BildirimGonder(db, h);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Haber bildirimi gönderilemedi");
            }
        }

        return Ok(new { basarili = true, id = h.Id });
    }

    /// <summary>
    /// Yeni gönderi bildirimi: yalnızca 1.7 ve üstü uygulamalara (eski
    /// sürümde ekran yok) ve hedef şubelerdeki personele.
    /// </summary>
    private async Task BildirimGonder(IDbConnection db, HaberSatiri h)
    {
        var hedef = HedefOku(h.Hedef);

        var kodlar = db.Query<(string Kod, string Surum)>(
                "SELECT personel_kodu, surum FROM KRY_MOBIL_JETON WHERE personel_kodu IS NOT NULL")
            .Where(x => SurumEnAz(x.Surum, 1, 7))
            .Select(x => x.Kod.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (hedef.Count > 0)
        {
            var subede = _ekip.Aktifler()
                .Where(p => hedef.Any(x => string.Equals(x, (p.IsGrubu ?? "").Trim(), StringComparison.OrdinalIgnoreCase)))
                .Select(p => p.PersonelKodu.Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            kodlar = kodlar.Where(subede.Contains).ToList();
        }

        if (!string.IsNullOrWhiteSpace(h.YazarSicil))
            kodlar = kodlar.Where(x => K(x) != K(h.YazarSicil)).ToList();

        if (kodlar.Count == 0) return;

        var baslik = h.Tur switch
        {
            "kampanya" => "🏷️ Kasada bu hafta",
            "anket" => "📊 Yeni anket",
            _ => $"Biçen'den Haberler · {h.YazarAd}",
        };

        var metin = h.Tur == "anket"
            ? Oku<AnketVeri>(h.Veri)?.Soru ?? "Oyunu kullan"
            : string.IsNullOrWhiteSpace(h.Metin) ? "Yeni gönderi paylaşıldı" : (h.Metin.Length > 90 ? h.Metin[..87] + "…" : h.Metin);

        await _bildirim.TopluGonder(kodlar, baslik, metin, "haberler");
    }

    private static bool SurumEnAz(string ham, int ana, int alt)
    {
        if (string.IsNullOrWhiteSpace(ham)) return false;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return false;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a > ana || (a == ana && b >= alt);
    }

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    /// <summary>Panel: bütün gönderiler (taslak, gizli dahil), yetkililer, ayar, şubeler.</summary>
    [HttpGet("Panel")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Panel()
    {
        using var db = _vt.Baglanti();

        var l = db.Query<HaberSatiri>(Secim + " WHERE silindi = 0 ORDER BY sabit DESC, ISNULL(yayin, olusturma) DESC, id DESC").Take(300).ToList();

        var yetkililer = db.Query<(string Sicil, bool KurumAdina)>("SELECT sicil, kurum_adina FROM KRY_HABER_YETKI ORDER BY tarih")
            .Select(y =>
            {
                var p = _ekip.Kisi(y.Sicil);
                var say = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER WHERE yazar_sicil = @s AND durum = N'yayin' AND silindi = 0", new { s = y.Sicil });
                var son = db.ExecuteScalar<DateTime?>("SELECT MAX(yayin) FROM KRY_HABER WHERE yazar_sicil = @s AND silindi = 0", new { s = y.Sicil });
                return new
                {
                    sicil = y.Sicil,
                    ad = p is null ? y.Sicil : $"{p.Ad} {p.Soyad}".Trim(),
                    unvan = p?.Pozisyon,
                    sube = p?.IsGrubu,
                    kurumAdina = y.KurumAdina,
                    gonderi = say,
                    sonGonderi = son,
                };
            })
            .ToList();

        var subeler = _ekip.Aktifler()
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new { ad = g.Key, kisi = g.Count() })
            .OrderBy(x => x.ad)
            .ToList();

        return Ok(new
        {
            gonderiler = Kartlar(db, l, null, true),
            yetkililer,
            ayar = AyarOku(db),
            subeler,
        });
    }

    /// <summary>Panelden yeni gönderi (kurum adına): taslak olarak açılır.</summary>
    [HttpPost("Panel/Gonderi")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult PanelOlustur([FromBody] GonderiGirdi g)
    {
        if (g is null) return BadRequest(new { hata = "Bilgiler eksik." });

        var tur = g.Tur is "kampanya" or "anket" ? g.Tur : "gonderi";

        using var db = _vt.Baglanti();
        var ayar = AyarOku(db);

        var hata = Denetle(g, tur, ayar, out var veri);
        if (hata is not null) return BadRequest(new { hata });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HABER (tur, durum, yazar_ad, kurum, kategori, metin, veri, hedef, yorum_acik, sabit, olusturan)
OUTPUT INSERTED.id
VALUES (@tur, N'taslak', @yazar, 1, @kategori, @metin, @veri, @hedef, @yorum, @sabit, @olusturan)",
            new
            {
                tur,
                yazar = string.IsNullOrWhiteSpace(g.YazarAd) ? ayar.KurumAdi : g.YazarAd.Trim()[..Math.Min(150, g.YazarAd.Trim().Length)],
                kategori = tur == "gonderi" ? ayar.Kategoriler.FirstOrDefault(x => string.Equals(x, g.Kategori, StringComparison.OrdinalIgnoreCase)) : null,
                metin = string.IsNullOrWhiteSpace(g.Metin) ? null : g.Metin.Trim(),
                veri,
                hedef = HedefYaz(g.Hedef),
                yorum = g.YorumAcik,
                sabit = g.Sabit,
                olusturan = PanelAdi,
            });

        return Ok(new { id });
    }

    /// <summary>Gönderiyi düzenler (metin, kategori, hedef, kampanya / anket).</summary>
    [HttpPost("Panel/{id:int}/Duzenle")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult PanelDuzenle(int id, [FromBody] GonderiGirdi g)
    {
        using var db = _vt.Baglanti();

        var h = db.QueryFirstOrDefault<HaberSatiri>(Secim + " WHERE id = @id AND silindi = 0", new { id });
        if (h is null || g is null) return NotFound(new { hata = "Gönderi bulunamadı." });

        var ayar = AyarOku(db);
        var hata = Denetle(g, h.Tur, ayar, out var veri);
        if (hata is not null) return BadRequest(new { hata });

        /* Oy verilmiş ankette seçenekler değiştirilemez (oylar kayar) */
        if (h.Tur == "anket" && db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_OY WHERE haber_id = @id", new { id }) > 0)
        {
            var eski = Oku<AnketVeri>(h.Veri);
            var yeni = Oku<AnketVeri>(veri);
            if (eski is not null && yeni is not null && !eski.Secenekler.SequenceEqual(yeni.Secenekler))
                return BadRequest(new { hata = "Oy kullanılmış ankette seçenekler değiştirilemez; bitiş tarihi ve soru değişebilir." });
        }

        db.Execute(@"
UPDATE KRY_HABER SET metin = @metin, kategori = @kategori, veri = @veri, hedef = @hedef, yorum_acik = @yorum
WHERE id = @id",
            new
            {
                id,
                metin = string.IsNullOrWhiteSpace(g.Metin) ? null : g.Metin.Trim(),
                kategori = h.Tur == "gonderi" ? ayar.Kategoriler.FirstOrDefault(x => string.Equals(x, g.Kategori, StringComparison.OrdinalIgnoreCase)) ?? h.Kategori : null,
                veri = h.Tur == "gonderi" ? null : veri,
                hedef = HedefYaz(g.Hedef),
                yorum = g.YorumAcik,
            });

        return Ok(new { basarili = true });
    }

    private static string HedefYaz(List<string> l)
    {
        var temiz = (l ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        return temiz.Count == 0 ? null : string.Join("\n", temiz);
    }

    private static string Denetle(GonderiGirdi g, string tur, Ayar ayar, out string veri)
    {
        veri = null;

        if ((g.Metin ?? "").Length > 2200) return "Açıklama en fazla 2200 karakter olabilir.";

        if (tur == "kampanya")
        {
            var k = g.Kampanya ?? new KampanyaVeri();
            var urunler = (k.Urunler ?? new()).Where(u => !string.IsNullOrWhiteSpace(u?.Ad)).ToList();

            if (urunler.Count == 0) return "En az bir ürün ekleyiniz.";
            if (urunler.Count > 20) return "En fazla 20 ürün eklenebilir.";
            if (urunler.Any(u => u.Yeni <= 0)) return "Her ürünün kampanya fiyatını yazınız.";
            if (urunler.Any(u => u.Eski is { } e && e <= u.Yeni)) return "Eski fiyat kampanya fiyatından büyük olmalı (ya da boş bırakılmalı).";

            veri = JsonSerializer.Serialize(new KampanyaVeri
            {
                Baslik = Kisalt(k.Baslik, 80),
                Donem = Kisalt(k.Donem, 60),
                Soyle = Kisalt(k.Soyle, 300),
                Urunler = urunler.Select(u => new Urun
                {
                    Ad = Kisalt(u.Ad, 80),
                    Birim = Kisalt(u.Birim, 12),
                    Eski = u.Eski is { } e ? Math.Round(e, 2) : null,
                    Yeni = Math.Round(u.Yeni, 2),
                }).ToList(),
            }, Js);
        }

        if (tur == "anket")
        {
            var a = g.Anket ?? new AnketVeri();
            var secenekler = (a.Secenekler ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).ToList();

            if (string.IsNullOrWhiteSpace(a.Soru)) return "Anket sorusunu yazınız.";
            if (secenekler.Count < 2) return "En az iki seçenek yazınız.";
            if (secenekler.Count > 6) return "En fazla altı seçenek olabilir.";
            if (secenekler.Distinct(StringComparer.OrdinalIgnoreCase).Count() != secenekler.Count) return "Seçenekler birbirinden farklı olmalı.";

            veri = JsonSerializer.Serialize(new AnketVeri
            {
                Soru = Kisalt(a.Soru, 200),
                Secenekler = secenekler.Select(x => Kisalt(x, 100)).ToList(),
                Bitis = a.Bitis?.Date,
            }, Js);
        }

        return null;
    }

    private static string Kisalt(string s, int n)
    {
        s = (s ?? "").Trim();
        return s.Length == 0 ? null : s.Length > n ? s[..n] : s;
    }

    [HttpPost("Panel/{id:int}/Gorsel")]
    [Authorize(Roles = PanelRolleri)]
    [RequestSizeLimit(GorselSiniri + 128 * 1024)]
    public async Task<IActionResult> PanelGorsel(int id, IFormFile dosya)
    {
        using var db = _vt.Baglanti();
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER WHERE id = @id AND silindi = 0", new { id }) == 0)
            return NotFound(new { hata = "Gönderi bulunamadı." });

        return await GorselKaydet(db, id, dosya);
    }

    [HttpPost("Panel/Gorsel/{gid:int}/Sil")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult PanelGorselSil(int gid)
    {
        using var db = _vt.Baglanti();
        db.Execute("DELETE FROM KRY_HABER_GORSEL WHERE id = @gid", new { gid });
        return Ok(new { basarili = true });
    }

    [HttpPost("Panel/{id:int}/Yayinla")]
    [Authorize(Roles = PanelRolleri)]
    public async Task<IActionResult> PanelYayinla(int id, [FromBody] YayinGirdi g)
    {
        using var db = _vt.Baglanti();

        var h = db.QueryFirstOrDefault<HaberSatiri>(Secim + " WHERE id = @id AND silindi = 0", new { id });
        if (h is null) return NotFound(new { hata = "Gönderi bulunamadı." });

        if (h.Tur == "gonderi" && string.IsNullOrEmpty(h.Video)
            && db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HABER_GORSEL WHERE haber_id = @id", new { id }) == 0)
            return BadRequest(new { hata = "Gönderide en az bir fotoğraf ya da video olmalı." });

        return await Yayinla(db, h, g?.Bildirim ?? true);
    }

    [HttpPost("Panel/{id:int}/Sabitle")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Sabitle(int id) => Degistir(id, "sabit = 1 - sabit");

    [HttpPost("Panel/{id:int}/Gizle")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Gizle(int id) => Degistir(id, "gizli = 1 - gizli");

    [HttpPost("Panel/{id:int}/YorumAc")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult YorumAc(int id) => Degistir(id, "yorum_acik = 1 - yorum_acik");

    [HttpPost("Panel/{id:int}/Sil")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Sil(int id) => Degistir(id, "silindi = 1");

    private IActionResult Degistir(int id, string ifade)
    {
        using var db = _vt.Baglanti();
        var n = db.Execute($"UPDATE KRY_HABER SET {ifade} WHERE id = @id AND silindi = 0", new { id });
        return n == 0 ? NotFound(new { hata = "Gönderi bulunamadı." }) : Ok(new { basarili = true });
    }

    [HttpGet("Panel/{id:int}/Yorumlar")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult PanelYorumlar(int id)
    {
        using var db = _vt.Baglanti();
        var yorumlar = db.Query("SELECT id, ad, unvan, metin, tarih, gizli FROM KRY_HABER_YORUM WHERE haber_id = @id ORDER BY id", new { id }).ToList();
        return Ok(new { yorumlar });
    }

    [HttpPost("Panel/Yorum/{yid:int}/Gizle")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult YorumGizle(int yid)
    {
        using var db = _vt.Baglanti();
        db.Execute("UPDATE KRY_HABER_YORUM SET gizli = 1 - gizli WHERE id = @yid", new { yid });
        return Ok(new { basarili = true });
    }

    /// <summary>Anket sonucu şube kırılımıyla (panel).</summary>
    [HttpGet("Panel/{id:int}/Anket")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult AnketSonuc(int id)
    {
        using var db = _vt.Baglanti();

        var h = db.QueryFirstOrDefault<HaberSatiri>(Secim + " WHERE id = @id AND tur = N'anket'", new { id });
        if (h is null) return NotFound(new { hata = "Anket bulunamadı." });

        var a = Oku<AnketVeri>(h.Veri) ?? new AnketVeri();

        var subeler = db.Query<(string Sube, int Secenek, int Sayi)>(
                "SELECT ISNULL(sube, N'—'), secenek, COUNT(*) FROM KRY_HABER_OY WHERE haber_id = @id GROUP BY sube, secenek", new { id })
            .GroupBy(x => x.Sube)
            .Select(g => new { sube = g.Key, toplam = g.Sum(x => x.Sayi), oylar = a.Secenekler.Select((_, i) => g.Where(x => x.Secenek == i).Sum(x => x.Sayi)).ToList() })
            .OrderByDescending(x => x.toplam)
            .ToList();

        return Ok(new { soru = a.Soru, secenekler = a.Secenekler, subeler });
    }

    [HttpGet("Panel/KisiAra")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult KisiAra([FromQuery] string q)
    {
        var t = (q ?? "").Trim().ToLower(Tr);
        if (t.Length < 2) return Ok(new List<object>());

        var l = _ekip.Aktifler()
            .Where(p => $"{p.Ad} {p.Soyad} {p.PersonelKodu} {p.IsGrubu}".ToLower(Tr).Contains(t))
            .Take(20)
            .Select(p => new { sicil = p.PersonelKodu.Trim(), ad = $"{p.Ad} {p.Soyad}".Trim(), sube = p.IsGrubu, unvan = p.Pozisyon })
            .ToList();

        return Ok(l);
    }

    public sealed class YetkiGirdi
    {
        public string Sicil { get; set; }
        public bool Ekle { get; set; } = true;
        public bool? KurumAdina { get; set; }
    }

    [HttpPost("Panel/Yetki")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Yetki([FromBody] YetkiGirdi g)
    {
        var sicil = (g?.Sicil ?? "").Trim();
        if (sicil.Length == 0) return BadRequest(new { hata = "Personel seçiniz." });

        using var db = _vt.Baglanti();

        if (!g.Ekle)
        {
            db.Execute("DELETE FROM KRY_HABER_YETKI WHERE sicil = @sicil", new { sicil });
            return Ok(new { basarili = true });
        }

        if (_ekip.Kisi(sicil) is null) return BadRequest(new { hata = "Personel bulunamadı." });

        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_HABER_YETKI WHERE sicil = @sicil)
    UPDATE KRY_HABER_YETKI SET kurum_adina = ISNULL(@kurum, kurum_adina) WHERE sicil = @sicil
ELSE
    INSERT INTO KRY_HABER_YETKI (sicil, kurum_adina, ekleyen) VALUES (@sicil, ISNULL(@kurum, 0), @ekleyen)",
            new { sicil, kurum = g.KurumAdina, ekleyen = PanelAdi });

        return Ok(new { basarili = true });
    }

    [HttpPost("Panel/Ayar")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult AyarKaydet([FromBody] Ayar a)
    {
        if (a is null) return BadRequest(new { hata = "Ayar okunamadı." });

        a.Kategoriler = (a.Kategoriler ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length is > 0 and <= 40)
            .Where(x => x != KampanyaKategori && x != AnketKategori)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(15).ToList();
        a.YasakliKelimeler = (a.YasakliKelimeler ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(300).ToList();
        a.KurumAdi = string.IsNullOrWhiteSpace(a.KurumAdi) ? "Biçen Market" : a.KurumAdi.Trim();
        a.KurumAciklama = string.IsNullOrWhiteSpace(a.KurumAciklama) ? null
            : a.KurumAciklama.Trim()[..Math.Min(300, a.KurumAciklama.Trim().Length)];

        if (a.Kategoriler.Count == 0) return BadRequest(new { hata = "En az bir kategori olmalı." });

        using var db = _vt.Baglanti();

        /* Logo sürümü yalnızca logo yüklenince değişir */
        a.LogoSurum = AyarOku(db).LogoSurum;

        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = AyarAnahtari, d = JsonSerializer.Serialize(a, Js) });

        return Ok(new { basarili = true, ayar = a });
    }

    /// <summary>Kurum logosu yükle (PNG, JPEG, WebP; en fazla 1 MB). Kare görsel önerilir.</summary>
    [HttpPost("Panel/Logo")]
    [Authorize(Roles = PanelRolleri)]
    [RequestSizeLimit(2_000_000)]
    public async Task<IActionResult> LogoYukle(IFormFile dosya)
    {
        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Logo seçiniz." });
        if (dosya.Length > 1_048_576) return BadRequest(new { hata = "Logo en fazla 1 MB olabilir." });

        byte[] b;
        using (var ms = new MemoryStream())
        {
            await dosya.CopyToAsync(ms);
            b = ms.ToArray();
        }

        if (TurBul(b) is null) return BadRequest(new { hata = "Logo PNG, JPEG ya da WebP olmalı." });

        using var db = _vt.Baglanti();
        AyarYaz(db, LogoAnahtari, Convert.ToBase64String(b));

        var a = AyarOku(db);
        a.LogoSurum = DateTime.Now.ToString("yyyyMMddHHmmss");
        AyarYaz(db, AyarAnahtari, JsonSerializer.Serialize(a, Js));

        return Ok(new { basarili = true, ayar = a, logo = LogoAdresi(a) });
    }

    [HttpPost("Panel/Logo/Sil")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult LogoSil()
    {
        using var db = _vt.Baglanti();
        db.Execute("DELETE FROM KRY_AYARLAR WHERE anahtar = @a", new { a = LogoAnahtari });

        var a = AyarOku(db);
        a.LogoSurum = null;
        AyarYaz(db, AyarAnahtari, JsonSerializer.Serialize(a, Js));

        return Ok(new { basarili = true, ayar = a });
    }

    private static void AyarYaz(IDbConnection db, string anahtar, string deger) =>
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = anahtar, d = deger });
}

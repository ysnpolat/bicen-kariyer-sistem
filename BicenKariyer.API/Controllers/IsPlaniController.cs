using System.Data;
using System.Security.Claims;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İş Planlaması (08.10.2026): İK paneli ve Biçen360 güncellemelerinin
/// planı — aşama, öncelik, sürüm, yapılacaklar, yorum, not ve görsel.
///
/// <para>
/// Yalnızca iki kişiye açık: sicil 14264 ve 10664. Kapı rol değil sicil;
/// panel hesabının KRY_KULLANICILAR.sicil alanı bu iki sicilden biri
/// olmalı. Rol Yetkileri'nden açılamaz, başka hesap adına açılmış
/// (taklit) oturumda ve Biçen360 jetonuyla kapalı. Yetkisi olmayana
/// sayfa varmış gibi görünmesin diye 404 dönüyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class IsPlaniController : ControllerBase
{
    /// <summary>Sayfaya erişebilen siciller</summary>
    public static readonly string[] Siciller = { "14264", "10664" };

    public static readonly string[] Asamalar = { "fikir", "plan", "gelis", "test", "yayin", "aski" };
    public static readonly string[] Oncelikler = { "acil", "yuksek", "normal", "dusuk" };
    public static readonly string[] Platformlar = { "panel", "mobil", "sunucu" };

    private static readonly Dictionary<string, string> AsamaAdi = new()
    {
        ["fikir"] = "Fikir", ["plan"] = "Planlandı", ["gelis"] = "Geliştiriliyor",
        ["test"] = "Testte", ["yayin"] = "Yayında", ["aski"] = "Askıda",
    };

    private static readonly Dictionary<string, string> OncelikAdi = new()
    {
        ["acil"] = "Acil", ["yuksek"] = "Yüksek", ["normal"] = "Normal", ["dusuk"] = "Düşük",
    };

    private const int GorselSiniri = 8 * 1024 * 1024;

    private readonly VeritabaniServisi _vt;

    public IsPlaniController(VeritabaniServisi vt) => _vt = vt;

    /* ------------------------------------------------------------ kapı */

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Oturumdaki panel kullanıcısının sicili; kapalıysa null</summary>
    private string Sicil(IDbConnection db)
    {
        var ad = User?.Identity?.Name ?? "";

        /* Biçen360 (personel:…) ve patron görünümü jetonları panel hesabı değil */
        if (ad.Length == 0 || ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return null;

        /* Başka bir hesap adına açılmış oturum: plan kişiye özel */
        if (User.FindFirst("taklitEden") is not null) return null;

        if (!int.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id)) return null;

        var sicil = db.QueryFirstOrDefault<string>(
            "SELECT sicil FROM KRY_KULLANICILAR WHERE id = @id AND kullanici_adi = @ad AND aktif = 1",
            new { id, ad });

        var k = K(sicil);

        return Siciller.Contains(k) ? k : null;
    }

    /// <summary>Sicil → görünen ad (panel hesabındaki ad soyad)</summary>
    private static Dictionary<string, string> Kisiler(IDbConnection db)
    {
        var sonuc = Siciller.ToDictionary(s => s, s => s);

        try
        {
            foreach (var (sicil, adSoyad) in db.Query<(string, string)>(
                         "SELECT sicil, ad_soyad FROM KRY_KULLANICILAR WHERE aktif = 1 AND sicil IS NOT NULL AND sicil <> ''"))
            {
                var k = K(sicil);
                if (sonuc.ContainsKey(k) && !string.IsNullOrWhiteSpace(adSoyad)) sonuc[k] = adSoyad.Trim();
            }
        }
        catch
        {
            /* ad bulunamazsa sicil görünür */
        }

        return sonuc;
    }

    private static object KisiListesi(Dictionary<string, string> k) =>
        k.Select(x => new { sicil = x.Key, ad = x.Value }).ToList();

    /// <summary>Panel menüsü bu uca bakıyor; herkese 200 döner, yalnızca evet/hayır.</summary>
    [HttpGet("Erisim")]
    public IActionResult Erisim()
    {
        try
        {
            using var db = _vt.Baglanti();
            var sicil = Sicil(db);

            return Ok(new { acik = sicil is not null, sicil });
        }
        catch
        {
            return Ok(new { acik = false });
        }
    }

    /* ----------------------------------------------------------- model */

    public sealed class Madde
    {
        public string M { get; set; }
        public bool B { get; set; }
    }

    public sealed class IsGirdi
    {
        public string Baslik { get; set; }
        public string Aciklama { get; set; }
        public List<string> Platform { get; set; }
        public string Asama { get; set; }
        public string Oncelik { get; set; }
        public string Surum { get; set; }
        public string Sorumlu { get; set; }

        /// <summary>yyyy-MM-dd; boş metin tarihi kaldırır, null dokunmaz</summary>
        public string Hedef { get; set; }

        public List<Madde> Maddeler { get; set; }
    }

    public sealed class KayitGirdi
    {
        public string Tur { get; set; }
        public string Metin { get; set; }
        public bool Sabit { get; set; }
    }

    private sealed class IsSatiri
    {
        public int Id { get; set; }
        public string Baslik { get; set; }
        public string Aciklama { get; set; }
        public string Platform { get; set; }
        public string Asama { get; set; }
        public string Oncelik { get; set; }
        public string Surum { get; set; }
        public string Sorumlu { get; set; }
        public DateTime? Hedef { get; set; }
        public string Maddeler { get; set; }
        public string Olusturan { get; set; }
        public DateTime Olusturma { get; set; }
        public DateTime Guncelleme { get; set; }
    }

    private sealed class KayitSatiri
    {
        public int Id { get; set; }
        public int IsId { get; set; }
        public string Tur { get; set; }
        public string Kim { get; set; }
        public string Metin { get; set; }
        public bool Sabit { get; set; }
        public DateTime Tarih { get; set; }
    }

    private sealed class GorselSatiri
    {
        public int Id { get; set; }
        public int IsId { get; set; }
        public int? KayitId { get; set; }
        public string Ad { get; set; }
        public string Kim { get; set; }
        public DateTime Tarih { get; set; }
    }

    private static readonly JsonSerializerOptions Js = new(JsonSerializerDefaults.Web);

    private static List<Madde> MaddeOku(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();

        try
        {
            return JsonSerializer.Deserialize<List<Madde>>(json, Js) ?? new();
        }
        catch
        {
            return new();
        }
    }

    private static List<string> PlatformOku(string s) =>
        (s ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .Where(Platformlar.Contains).Distinct().ToList();

    private const string IsSecimi = @"
SELECT id, baslik, aciklama, platform, asama, oncelik, surum, sorumlu, hedef, maddeler,
       olusturan, olusturma, guncelleme
FROM KRY_IS_PLANI";

    private static object IsCevap(IsSatiri i) => new
    {
        id = i.Id,
        baslik = i.Baslik,
        aciklama = i.Aciklama ?? "",
        platform = PlatformOku(i.Platform),
        asama = i.Asama,
        oncelik = i.Oncelik,
        surum = i.Surum ?? "",
        sorumlu = i.Sorumlu ?? "",
        hedef = i.Hedef?.ToString("yyyy-MM-dd") ?? "",
        maddeler = MaddeOku(i.Maddeler).Select(m => new { m = m.M, b = m.B }),
        olusturan = i.Olusturan,
        olusturma = i.Olusturma,
        guncelleme = i.Guncelleme,
    };

    private static void Gecmis(IDbConnection db, int isId, string kim, string olay, IDbTransaction tx = null) =>
        db.Execute(
            "INSERT INTO KRY_IS_PLANI_KAYIT (is_id, tur, kim, metin) VALUES (@isId, 'gecmis', @kim, @olay)",
            new { isId, kim, olay = olay.Length > 400 ? olay[..397] + "…" : olay }, tx);

    private static IActionResult Yok() => new NotFoundObjectResult(new { hata = "Bulunamadı." });

    /* ----------------------------------------------------------- liste */

    [HttpGet]
    public IActionResult Liste()
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        var isler = db.Query<IsSatiri>(IsSecimi + " WHERE silindi = 0 ORDER BY id").ToList();

        var sayilar = db.Query<(int isId, string tur, int sayi)>(@"
SELECT k.is_id, k.tur, COUNT(*)
FROM KRY_IS_PLANI_KAYIT k JOIN KRY_IS_PLANI i ON i.id = k.is_id AND i.silindi = 0
WHERE k.tur IN ('yorum', 'not')
GROUP BY k.is_id, k.tur").ToList();

        var gorseller = db.Query<(int isId, int id)>(@"
SELECT g.is_id, g.id
FROM KRY_IS_PLANI_GORSEL g JOIN KRY_IS_PLANI i ON i.id = g.is_id AND i.silindi = 0
ORDER BY g.id").ToList();

        return Ok(new
        {
            ben,
            kisiler = KisiListesi(Kisiler(db)),
            isler = isler.Select(i => new
            {
                @is = IsCevap(i),
                yorumSay = sayilar.Where(x => x.isId == i.Id && x.tur == "yorum").Sum(x => x.sayi),
                notSay = sayilar.Where(x => x.isId == i.Id && x.tur == "not").Sum(x => x.sayi),
                gorselSay = gorseller.Count(x => x.isId == i.Id),
                gorseller = gorseller.Where(x => x.isId == i.Id).Select(x => x.id).TakeLast(3),
            }),
        });
    }

    /* --------------------------------------------------------- ayrıntı */

    [HttpGet("{id:int}")]
    public IActionResult Ayrinti(int id)
    {
        using var db = _vt.Baglanti();
        if (Sicil(db) is null) return Yok();

        return AyrintiCevap(db, id);
    }

    private IActionResult AyrintiCevap(IDbConnection db, int id)
    {
        var i = db.QueryFirstOrDefault<IsSatiri>(IsSecimi + " WHERE id = @id AND silindi = 0", new { id });
        if (i is null) return Yok();

        var kayitlar = db.Query<KayitSatiri>(
            "SELECT id, is_id AS IsId, tur, kim, metin, sabit, tarih FROM KRY_IS_PLANI_KAYIT WHERE is_id = @id ORDER BY id",
            new { id }).ToList();

        var gorseller = db.Query<GorselSatiri>(
            "SELECT id, is_id AS IsId, kayit_id AS KayitId, ad, kim, tarih FROM KRY_IS_PLANI_GORSEL WHERE is_id = @id ORDER BY id",
            new { id }).ToList();

        return Ok(new
        {
            @is = IsCevap(i),
            yorumlar = kayitlar.Where(k => k.Tur == "yorum").Select(k => new
            {
                id = k.Id, kim = k.Kim, metin = k.Metin ?? "", tarih = k.Tarih,
                gorseller = gorseller.Where(g => g.KayitId == k.Id).Select(g => g.Id),
            }),
            notlar = kayitlar.Where(k => k.Tur == "not")
                .OrderByDescending(k => k.Sabit).ThenByDescending(k => k.Id)
                .Select(k => new { id = k.Id, kim = k.Kim, metin = k.Metin ?? "", sabit = k.Sabit, tarih = k.Tarih }),
            gecmis = kayitlar.Where(k => k.Tur == "gecmis").OrderByDescending(k => k.Id)
                .Select(k => new { id = k.Id, kim = k.Kim, metin = k.Metin ?? "", tarih = k.Tarih }),
            gorseller = gorseller.Select(g => new { id = g.Id, ad = g.Ad ?? "", kim = g.Kim, tarih = g.Tarih, kayitId = g.KayitId }),
        });
    }

    /* ------------------------------------------------------ doğrulama */

    private static string Denetle(IsGirdi g, bool yeni)
    {
        if (yeni || g.Baslik is not null)
        {
            var b = (g.Baslik ?? "").Trim();
            if (b.Length == 0) return "İşin adını yazınız.";
            if (b.Length > 150) return "İşin adı en fazla 150 karakter olabilir.";
        }

        if (g.Asama is not null && !Asamalar.Contains(g.Asama)) return "Geçersiz aşama.";
        if (g.Oncelik is not null && !Oncelikler.Contains(g.Oncelik)) return "Geçersiz öncelik.";
        if (g.Platform is not null && (g.Platform.Count == 0 || g.Platform.Any(p => !Platformlar.Contains(p))))
            return "En az bir platform seçiniz.";
        if (g.Sorumlu is not null && g.Sorumlu != "" && !Siciller.Contains(K(g.Sorumlu))) return "Sorumlu yalnızca planı kullanan iki kişiden biri olabilir.";
        if (g.Surum is { Length: > 30 }) return "Sürüm en fazla 30 karakter olabilir.";
        if (g.Aciklama is { Length: > 20000 }) return "Açıklama çok uzun.";
        if (g.Hedef is { Length: > 0 } && !DateTime.TryParseExact(g.Hedef, "yyyy-MM-dd", null,
                System.Globalization.DateTimeStyles.None, out _)) return "Hedef tarih geçersiz.";

        if (g.Maddeler is not null)
        {
            if (g.Maddeler.Count > 100) return "En fazla 100 madde eklenebilir.";
            if (g.Maddeler.Any(m => string.IsNullOrWhiteSpace(m?.M) || m.M.Length > 300))
                return "Madde boş ya da 300 karakterden uzun olamaz.";
        }

        return null;
    }

    private static DateTime? Tarih(string s) =>
        DateTime.TryParseExact(s ?? "", "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out var t)
            ? t : null;

    private static string MaddeJson(List<Madde> l) =>
        JsonSerializer.Serialize(l.Select(m => new Madde { M = m.M.Trim(), B = m.B }), Js);

    /* ----------------------------------------------------------- yeni */

    [HttpPost]
    public IActionResult Olustur([FromBody] IsGirdi g)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        g ??= new IsGirdi();
        g.Asama ??= "fikir";
        g.Oncelik ??= "normal";
        g.Platform ??= new() { "panel" };

        var hata = Denetle(g, true);
        if (hata is not null) return BadRequest(new { hata });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IS_PLANI (baslik, aciklama, platform, asama, oncelik, surum, sorumlu, hedef, maddeler, olusturan)
OUTPUT INSERTED.id
VALUES (@baslik, @aciklama, @platform, @asama, @oncelik, @surum, @sorumlu, @hedef, @maddeler, @ben)",
            new
            {
                baslik = g.Baslik.Trim(),
                aciklama = g.Aciklama ?? "",
                platform = string.Join(",", g.Platform.Distinct()),
                asama = g.Asama,
                oncelik = g.Oncelik,
                surum = (g.Surum ?? "").Trim(),
                sorumlu = string.IsNullOrWhiteSpace(g.Sorumlu) ? ben : K(g.Sorumlu),
                hedef = Tarih(g.Hedef),
                maddeler = MaddeJson(g.Maddeler ?? new()),
                ben,
            });

        Gecmis(db, id, ben, "oluşturdu");

        return AyrintiCevap(db, id);
    }

    /* ------------------------------------------------------- güncelle */

    /// <summary>Yalnızca gönderilen alanlar değişir; her değişiklik geçmişe yazılır.</summary>
    [HttpPost("{id:int}")]
    public IActionResult Guncelle(int id, [FromBody] IsGirdi g)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        if (g is null) return BadRequest(new { hata = "Değişiklik yok." });

        var hata = Denetle(g, false);
        if (hata is not null) return BadRequest(new { hata });

        var i = db.QueryFirstOrDefault<IsSatiri>(IsSecimi + " WHERE id = @id AND silindi = 0", new { id });
        if (i is null) return Yok();

        var kisiler = Kisiler(db);
        var olaylar = new List<string>();

        if (g.Baslik is not null && g.Baslik.Trim() != i.Baslik)
        {
            i.Baslik = g.Baslik.Trim();
            olaylar.Add("başlığı değiştirdi");
        }

        if (g.Aciklama is not null && g.Aciklama != (i.Aciklama ?? ""))
        {
            i.Aciklama = g.Aciklama;
            olaylar.Add("açıklamayı düzenledi");
        }

        if (g.Asama is not null && g.Asama != i.Asama)
        {
            olaylar.Add($"{AsamaAdi.GetValueOrDefault(i.Asama, i.Asama)} → {AsamaAdi[g.Asama]}");
            i.Asama = g.Asama;
        }

        if (g.Oncelik is not null && g.Oncelik != i.Oncelik)
        {
            i.Oncelik = g.Oncelik;
            olaylar.Add($"önceliği {OncelikAdi[g.Oncelik]} yaptı");
        }

        if (g.Platform is not null)
        {
            var yeni = string.Join(",", g.Platform.Distinct());
            if (yeni != (i.Platform ?? ""))
            {
                i.Platform = yeni;
                olaylar.Add("platformu değiştirdi");
            }
        }

        if (g.Surum is not null && g.Surum.Trim() != (i.Surum ?? ""))
        {
            i.Surum = g.Surum.Trim();
            olaylar.Add($"sürümü {(i.Surum.Length > 0 ? i.Surum : "—")} yaptı");
        }

        if (g.Sorumlu is not null && K(g.Sorumlu) != (i.Sorumlu ?? ""))
        {
            i.Sorumlu = K(g.Sorumlu);
            olaylar.Add($"sorumluyu {kisiler.GetValueOrDefault(i.Sorumlu, i.Sorumlu)} yaptı");
        }

        if (g.Hedef is not null && Tarih(g.Hedef) != i.Hedef)
        {
            i.Hedef = Tarih(g.Hedef);
            olaylar.Add(i.Hedef is { } h ? $"hedef tarihi {h:dd.MM.yyyy} yaptı" : "hedef tarihi kaldırdı");
        }

        if (g.Maddeler is not null)
        {
            var eski = MaddeOku(i.Maddeler);
            var yeni = g.Maddeler.Select(m => new Madde { M = m.M.Trim(), B = m.B }).ToList();

            foreach (var m in yeni)
            {
                var o = eski.FirstOrDefault(x => x.M == m.M);
                if (o is null) olaylar.Add($"\"{m.M}\" maddesini ekledi");
                else if (o.B != m.B) olaylar.Add($"\"{m.M}\" {(m.B ? "tamamlandı" : "yeniden açıldı")}");
            }

            foreach (var o in eski.Where(o => yeni.All(m => m.M != o.M)))
                olaylar.Add($"\"{o.M}\" maddesini sildi");

            i.Maddeler = MaddeJson(yeni);
        }

        if (olaylar.Count == 0) return AyrintiCevap(db, id);

        db.Open();
        using (var tx = db.BeginTransaction())
        {
            db.Execute(@"
UPDATE KRY_IS_PLANI SET
    baslik = @Baslik, aciklama = @Aciklama, platform = @Platform, asama = @Asama, oncelik = @Oncelik,
    surum = @Surum, sorumlu = @Sorumlu, hedef = @Hedef, maddeler = @Maddeler, guncelleme = SYSDATETIME()
WHERE id = @Id AND silindi = 0", i, tx);

            foreach (var o in olaylar) Gecmis(db, id, ben, o, tx);

            tx.Commit();
        }

        return AyrintiCevap(db, id);
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        var n = db.Execute(
            "UPDATE KRY_IS_PLANI SET silindi = 1, guncelleme = SYSDATETIME() WHERE id = @id AND silindi = 0",
            new { id });

        if (n == 0) return Yok();

        Gecmis(db, id, ben, "sildi");

        return Ok(new { basarili = true });
    }

    /* ---------------------------------------------------- yorum ve not */

    [HttpPost("{id:int}/Kayit")]
    public IActionResult KayitEkle(int id, [FromBody] KayitGirdi g)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        if (g is null || g.Tur is not ("yorum" or "not")) return BadRequest(new { hata = "Geçersiz kayıt." });

        var metin = (g.Metin ?? "").Trim();

        /* Yalnızca görselden oluşan yorum olabilir (görsel ardından yükleniyor) */
        if (g.Tur == "not" && metin.Length == 0) return BadRequest(new { hata = "Not boş olamaz." });
        if (metin.Length > 10000) return BadRequest(new { hata = "Metin çok uzun." });

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_IS_PLANI WHERE id = @id AND silindi = 0", new { id }) == 0)
            return Yok();

        var kid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IS_PLANI_KAYIT (is_id, tur, kim, metin, sabit)
OUTPUT INSERTED.id
VALUES (@id, @tur, @ben, @metin, @sabit)",
            new { id, tur = g.Tur, ben, metin, sabit = g.Tur == "not" && g.Sabit });

        db.Execute("UPDATE KRY_IS_PLANI SET guncelleme = SYSDATETIME() WHERE id = @id", new { id });

        return Ok(new { id = kid });
    }

    [HttpPost("Kayit/{kid:int}/Sabit")]
    public IActionResult Sabitle(int kid)
    {
        using var db = _vt.Baglanti();
        if (Sicil(db) is null) return Yok();

        var n = db.Execute(
            "UPDATE KRY_IS_PLANI_KAYIT SET sabit = 1 - sabit WHERE id = @kid AND tur = 'not'", new { kid });

        return n == 0 ? Yok() : Ok(new { basarili = true });
    }

    /// <summary>Yorumu yalnızca yazan siler; notu ikisi de.</summary>
    [HttpDelete("Kayit/{kid:int}")]
    public IActionResult KayitSil(int kid)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        var k = db.QueryFirstOrDefault<KayitSatiri>(
            "SELECT id, is_id AS IsId, tur, kim FROM KRY_IS_PLANI_KAYIT WHERE id = @kid", new { kid });

        if (k is null || k.Tur == "gecmis") return Yok();
        if (k.Tur == "yorum" && k.Kim != ben) return BadRequest(new { hata = "Yalnızca kendi yorumunuzu silebilirsiniz." });

        db.Execute(@"
DELETE FROM KRY_IS_PLANI_GORSEL WHERE kayit_id = @kid;
DELETE FROM KRY_IS_PLANI_KAYIT WHERE id = @kid;", new { kid });

        Gecmis(db, k.IsId, ben, k.Tur == "yorum" ? "bir yorumunu sildi" : "bir notu sildi");

        return Ok(new { basarili = true });
    }

    /* ---------------------------------------------------------- görsel */

    [HttpPost("{id:int}/Gorsel")]
    [RequestSizeLimit(GorselSiniri + 64 * 1024)]
    public async Task<IActionResult> GorselYukle(int id, IFormFile dosya, [FromForm] int? kayitId)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });
        if (dosya.Length > GorselSiniri) return BadRequest(new { hata = "Görsel en fazla 8 MB olabilir." });

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_IS_PLANI WHERE id = @id AND silindi = 0", new { id }) == 0)
            return Yok();

        if (kayitId is not null && db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_IS_PLANI_KAYIT WHERE id = @kayitId AND is_id = @id AND tur = 'yorum'",
                new { kayitId, id }) == 0)
            return BadRequest(new { hata = "Yorum bulunamadı." });

        byte[] icerik;

        using (var akis = new MemoryStream())
        {
            await dosya.CopyToAsync(akis);
            icerik = akis.ToArray();
        }

        var tur = TurBul(icerik);
        if (tur is null) return BadRequest(new { hata = "PNG, JPG, WebP ya da GIF yükleyiniz." });

        var ad = Path.GetFileName(dosya.FileName ?? "");
        if (ad.Length == 0) ad = "gorsel";
        if (ad.Length > 150) ad = ad[^150..];

        var gid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IS_PLANI_GORSEL (is_id, kayit_id, ad, tur, boyut, icerik, kim)
OUTPUT INSERTED.id
VALUES (@id, @kayitId, @ad, @tur, @boyut, @icerik, @ben)",
            new { id, kayitId, ad, tur, boyut = icerik.Length, icerik, ben });

        if (kayitId is null) Gecmis(db, id, ben, $"görsel ekledi ({ad})");

        db.Execute("UPDATE KRY_IS_PLANI SET guncelleme = SYSDATETIME() WHERE id = @id", new { id });

        return Ok(new { id = gid });
    }

    /// <summary>Görsel; panel başlıkla (Authorization) istiyor, adreste jeton yok.</summary>
    [HttpGet("Gorsel/{gid:int}")]
    public IActionResult Gorsel(int gid)
    {
        using var db = _vt.Baglanti();
        if (Sicil(db) is null) return Yok();

        var g = db.QueryFirstOrDefault<(byte[] icerik, string tur)>(@"
SELECT g.icerik, g.tur FROM KRY_IS_PLANI_GORSEL g
JOIN KRY_IS_PLANI i ON i.id = g.is_id AND i.silindi = 0
WHERE g.id = @gid", new { gid });

        if (g.icerik is null) return Yok();

        Response.Headers["Cache-Control"] = "private, max-age=86400";
        Response.Headers["X-Content-Type-Options"] = "nosniff";

        return File(g.icerik, g.tur);
    }

    [HttpDelete("Gorsel/{gid:int}")]
    public IActionResult GorselSil(int gid)
    {
        using var db = _vt.Baglanti();
        var ben = Sicil(db);
        if (ben is null) return Yok();

        var g = db.QueryFirstOrDefault<GorselSatiri>(
            "SELECT id, is_id AS IsId, kayit_id AS KayitId, ad FROM KRY_IS_PLANI_GORSEL WHERE id = @gid", new { gid });

        if (g is null) return Yok();

        db.Execute("DELETE FROM KRY_IS_PLANI_GORSEL WHERE id = @gid", new { gid });
        Gecmis(db, g.IsId, ben, $"görseli sildi ({g.Ad})");

        return Ok(new { basarili = true });
    }

    /// <summary>İçerikten tür: PNG, JPEG, WebP, GIF. SVG kabul edilmiyor (betik taşıyabilir).</summary>
    private static string TurBul(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
            && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            return "image/png";

        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";

        if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
            && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
            return "image/webp";

        if (b.Length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') return "image/gif";

        return null;
    }
}

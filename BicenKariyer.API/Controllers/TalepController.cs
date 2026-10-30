using System.Security.Claims;
using System.Text.RegularExpressions;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Talep / Öneri (30.10.2026).
///
/// <para>
/// Panel kullanıcısı her ekrandan sorun bildirir ya da öneri yazar; ekran
/// adı, yol ve panel sürümü istemciden gelir. Yönetim tek listede görür,
/// durum ve cevap yazar; kullanıcı cevabı "Taleplerim" listesinde ve zil
/// bildirimiyle görür. Yeni talep geldiğinde yönetime e-posta gider.
/// </para>
///
/// <para>
/// Durumlar: 0 Yeni, 1 İnceleniyor, 2 Planlandı, 3 Tamamlandı,
/// 4 Yapılmayacak. "Açık talep" 0–2 olanlardır.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TalepController : ControllerBase
{
    private const string AyarAnahtari = "TALEP";
    private const int GunlukSinir = 30;
    private const int EnCokGorsel = 3;
    private const int EnCokGorselBayt = 3 * 1024 * 1024;

    private static readonly Regex YolDeseni = new(@"^#?[A-Za-z0-9/_\-.?=&%]{0,200}$", RegexOptions.Compiled);

    private static readonly string[] DurumAdlari =
        { "Yeni", "İnceleniyor", "Planlandı", "Tamamlandı", "Yapılmayacak" };

    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly YetkiServisi _yetki;
    private readonly IServiceScopeFactory _kapsam;
    private readonly ILogger<TalepController> _kayit;

    public TalepController(
        VeritabaniServisi vt, AyarServisi ayar, YetkiServisi yetki,
        IServiceScopeFactory kapsam, ILogger<TalepController> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _yetki = yetki;
        _kapsam = kapsam;
        _kayit = kayit;
    }

    /* ------------------------------------------------------------ kimlik */

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";
    private bool Taklit => User.FindFirst("taklitEden") is not null;

    /// <summary>Talepleri yöneten kişi: Admin ya da "talepler" sayfası açık rol.</summary>
    private bool Yonetici =>
        Roller.Temel(Rol) == Roller.Admin
        || (_yetki.Oku(Rol)?.Menuler?.Contains("talepler") == true);

    public sealed class TalepAyarlari
    {
        /// <summary>Yeni talep bildirimi gidecek adresler; boşsa aktif Admin'lerin e-postası</summary>
        public List<string> BildirimAdresleri { get; set; } = new();
    }

    /* ------------------------------------------------------------ yazma */

    public sealed class TalepGirdi
    {
        public int Tur { get; set; }
        public string Ekran { get; set; }
        public string Yol { get; set; }
        public string Metin { get; set; }
        public string Surum { get; set; }
        /// <summary>data:image/png;base64,… biçiminde en çok 3 görsel</summary>
        public List<string> Gorseller { get; set; }
    }

    [HttpPost]
    public IActionResult Yaz([FromBody] TalepGirdi g)
    {
        if (Taklit) return Forbid();
        if (g is null) return BadRequest(new { hata = "Talep boş." });
        if (g.Tur is not (1 or 2)) return BadRequest(new { hata = "Tür sorun (1) ya da öneri (2) olmalı." });

        var metin = (g.Metin ?? "").Trim();
        if (metin.Length < 5) return BadRequest(new { hata = "En az 5 karakter yazınız." });
        if (metin.Length > 2000) return BadRequest(new { hata = "En çok 2000 karakter." });

        var yol = (g.Yol ?? "").Trim();
        if (yol.Length > 0 && !YolDeseni.IsMatch(yol))
            return BadRequest(new { hata = "Yol yalnızca panel içi bir adres olabilir." });

        var gorseller = new List<(string Tur, byte[] Veri)>();
        foreach (var ham in (g.Gorseller ?? new()).Take(EnCokGorsel))
        {
            var cozum = GorselCoz(ham);
            if (cozum is null) return BadRequest(new { hata = "Görsel PNG, JPEG ya da WEBP olmalı; en çok 3 MB." });
            gorseller.Add(cozum.Value);
        }

        using var db = _vt.Baglanti();
        db.Open();
        using var islem = db.BeginTransaction();

        /* Günlük sınır: sayım ve ekleme aynı işlemde, kilitli; aynı anda
           gelen istekler sınırı aşamaz. */
        var bugun = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_TALEP WITH (UPDLOCK, HOLDLOCK)
WHERE kullanici = @k AND olusturma >= CAST(GETDATE() AS DATE)",
            new { k = Kullanici }, islem);

        if (bugun >= GunlukSinir)
        {
            islem.Rollback();
            return BadRequest(new { hata = $"Günde en çok {GunlukSinir} talep yazılabilir." });
        }

        var adSoyad = db.ExecuteScalar<string>(
            "SELECT ad_soyad FROM KRY_KULLANICILAR WHERE kullanici_adi = @k",
            new { k = Kullanici }, islem) ?? Kullanici;

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_TALEP (kullanici, ad_soyad, rol, tur, ekran, yol, metin, surum)
OUTPUT INSERTED.id
VALUES (@kullanici, @adSoyad, @rol, @tur, @ekran, @yol, @metin, @surum)",
            new
            {
                kullanici = Kullanici,
                adSoyad = Kirp(adSoyad, 100),
                rol = Kirp(Rol, 40),
                tur = (byte)g.Tur,
                ekran = Kirp(g.Ekran?.Trim(), 100),
                yol = Kirp(yol, 200),
                metin,
                surum = Kirp(g.Surum?.Trim(), 20)
            }, islem);

        for (var i = 0; i < gorseller.Count; i++)
            db.Execute(
                "INSERT INTO KRY_TALEP_GORSEL (talep_id, sira, tur, veri) VALUES (@id, @sira, @tur, @veri)",
                new { id, sira = (byte)(i + 1), tur = gorseller[i].Tur, veri = gorseller[i].Veri }, islem);

        islem.Commit();

        /* Yönetime e-posta arka planda; hata talebi düşürmez */
        /* İstek bittikten sonra HttpContext kullanılamaz; değerler önce alınır */
        var ekran = g.Ekran?.Trim();
        var surum = g.Surum?.Trim();
        var rol = Rol;
        var tur = g.Tur;
        var gorselSayisi = gorseller.Count;
        _ = Task.Run(() => YonetimeMail(id, tur, adSoyad, rol, ekran, yol, surum, metin, gorselSayisi));

        return Ok(new { id, tamam = true });
    }

    private async Task YonetimeMail(
        int id, int tur, string adSoyad, string rol, string ekran, string yol,
        string surum, string metin, int gorselSayisi)
    {
        try
        {
            /* İstek bitince kapsamlı servisler kapanır; arka plan işi kendi
               kapsamını açar. */
            using var kapsam = _kapsam.CreateScope();
            var ayar = kapsam.ServiceProvider.GetRequiredService<AyarServisi>();
            var mail = kapsam.ServiceProvider.GetRequiredService<MailServisi>();
            var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

            var alicilar = ayar.Oku(AyarAnahtari, new TalepAyarlari()).BildirimAdresleri
                .Where(a => !string.IsNullOrWhiteSpace(a)).Select(a => a.Trim()).Distinct().ToList();

            if (alicilar.Count == 0)
            {
                using var db = vt.Baglanti();
                alicilar = db.Query<string>(@"
SELECT eposta FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol = @rol AND eposta IS NOT NULL AND LTRIM(RTRIM(eposta)) <> ''",
                    new { rol = Roller.Admin }).ToList();
            }

            if (alicilar.Count == 0) return;

            var turAdi = tur == 1 ? "destek" : "geliştirme";
            var konu = TemizKonu($"Yeni {turAdi} talebi #{id} · {adSoyad} · {ekran}");
            var govde = mail.TalepBildirimGovdesi(id, tur == 1 ? "Sorun bildirimi" : "Öneri",
                adSoyad, rol, ekran, yol, surum, metin, gorselSayisi, DateTime.Now);

            await mail.GonderAsync(alicilar, konu, govde);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Talep e-postası gönderilemedi: #{Id}", id);
        }
    }

    /* ------------------------------------------------------------ okuma */

    [HttpGet("Benim")]
    public IActionResult Benim()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT t.id, t.tur, t.ekran, t.yol, t.metin, t.surum, t.durum, t.cevap,
       t.cevaplayan, t.cevap_zamani AS cevapZamani, t.olusturma,
       (SELECT COUNT(*) FROM KRY_TALEP_GORSEL g WHERE g.talep_id = t.id) AS gorselSayisi
FROM KRY_TALEP t
WHERE t.kullanici = @k
ORDER BY t.olusturma DESC", new { k = Kullanici }).ToList();

        return Ok(liste);
    }

    [HttpGet]
    public IActionResult Liste()
    {
        if (!Yonetici) return Forbid();

        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT t.id, t.kullanici, t.ad_soyad AS adSoyad, t.rol, t.tur, t.ekran, t.yol, t.metin,
       t.surum, t.durum, t.cevap, t.cevaplayan, t.cevap_zamani AS cevapZamani, t.olusturma,
       (SELECT COUNT(*) FROM KRY_TALEP_GORSEL g WHERE g.talep_id = t.id) AS gorselSayisi
FROM KRY_TALEP t
WHERE t.olusturma >= DATEADD(DAY, -365, GETDATE())
ORDER BY CASE WHEN t.durum <= 2 THEN 0 ELSE 1 END, t.olusturma DESC").ToList();

        return Ok(liste);
    }

    /// <summary>Görsel; talep sahibi ya da yönetim görür.</summary>
    [HttpGet("{id:int}/Gorsel/{sira:int}")]
    public IActionResult Gorsel(int id, int sira)
    {
        using var db = _vt.Baglanti();

        var sahip = db.ExecuteScalar<string>("SELECT kullanici FROM KRY_TALEP WHERE id = @id", new { id });
        if (sahip is null) return NotFound();
        if (!string.Equals(sahip, Kullanici, StringComparison.OrdinalIgnoreCase) && !Yonetici) return Forbid();

        var g = db.QueryFirstOrDefault(
            "SELECT tur, veri FROM KRY_TALEP_GORSEL WHERE talep_id = @id AND sira = @sira",
            new { id, sira });
        if (g is null) return NotFound();

        Response.Headers.CacheControl = "private, max-age=86400";
        return File((byte[])g.veri, (string)g.tur);
    }

    /* ------------------------------------------------------------ cevap */

    public sealed class CevapGirdi
    {
        public int Durum { get; set; }
        public string Cevap { get; set; }
    }

    [HttpPut("{id:int}")]
    public IActionResult Cevapla(int id, [FromBody] CevapGirdi g)
    {
        if (!Yonetici) return Forbid();
        if (Taklit) return Forbid();
        if (g is null || g.Durum < 0 || g.Durum > 4) return BadRequest(new { hata = "Durum 0–4 arası olmalı." });

        var cevap = (g.Cevap ?? "").Trim();
        if (cevap.Length > 2000) return BadRequest(new { hata = "Cevap en çok 2000 karakter." });

        using var db = _vt.Baglanti();

        var eski = db.QueryFirstOrDefault(
            "SELECT kullanici, durum, cevap FROM KRY_TALEP WHERE id = @id", new { id });
        if (eski is null) return NotFound(new { hata = "Talep bulunamadı." });

        var cevaplayan = db.ExecuteScalar<string>(
            "SELECT ad_soyad FROM KRY_KULLANICILAR WHERE kullanici_adi = @k", new { k = Kullanici }) ?? Kullanici;

        var degisti = (int)(byte)eski.durum != g.Durum
                      || !string.Equals((string)eski.cevap ?? "", cevap, StringComparison.Ordinal);

        db.Execute(@"
UPDATE KRY_TALEP
SET durum = @durum, cevap = @cevap, cevaplayan = @cevaplayan, cevap_zamani = SYSDATETIME()
WHERE id = @id",
            new { id, durum = (byte)g.Durum, cevap = cevap.Length == 0 ? null : cevap, cevaplayan = Kirp(cevaplayan, 100) });

        /* Talep sahibine zil bildirimi (panel çanı KRY_BILDIRIM'i okur) */
        if (degisti)
        {
            try
            {
                var ozet = cevap.Length == 0 ? "" : $" Cevap: {Kirp(cevap, 600)}";
                db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, N'talep_cevap', @baslik, @metin)",
                    new
                    {
                        kullanici = (string)eski.kullanici,
                        baslik = $"Talep #{id}: {DurumAdlari[g.Durum]}",
                        metin = Kirp($"Talebiniz güncellendi.{ozet}", 900)
                    });
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Talep bildirimi yazılamadı: #{Id}", id);
            }
        }

        return Ok(new { tamam = true });
    }

    /* ------------------------------------------------------------ ayar */

    [HttpGet("Ayar")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult AyarOku() => Ok(_ayar.Oku(AyarAnahtari, new TalepAyarlari()));

    [HttpPut("Ayar")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult AyarYaz([FromBody] TalepAyarlari a)
    {
        a ??= new TalepAyarlari();
        a.BildirimAdresleri = (a.BildirimAdresleri ?? new())
            .Select(x => (x ?? "").Trim()).Where(x => x.Length > 0 && x.Contains('@')).Distinct().ToList();
        _ayar.Yaz(AyarAnahtari, a);
        return Ok(new { tamam = true });
    }

    /* ------------------------------------------------------------ yardımcı */

    /// <summary>
    /// data:image/…;base64,… metnini çözer. Tür hem başlıktan hem dosyanın
    /// ilk baytlarından denetlenir; uymazsa null.
    /// </summary>
    private static (string Tur, byte[] Veri)? GorselCoz(string ham)
    {
        if (string.IsNullOrWhiteSpace(ham)) return null;

        var virgul = ham.IndexOf(',');
        if (virgul < 0 || !ham.StartsWith("data:image/", StringComparison.OrdinalIgnoreCase)) return null;

        var baslik = ham[..virgul].ToLowerInvariant();
        var tur = baslik.Contains("image/png") ? "image/png"
                : baslik.Contains("image/jpeg") || baslik.Contains("image/jpg") ? "image/jpeg"
                : baslik.Contains("image/webp") ? "image/webp"
                : null;
        if (tur is null) return null;

        byte[] veri;
        try { veri = Convert.FromBase64String(ham[(virgul + 1)..]); }
        catch { return null; }

        if (veri.Length == 0 || veri.Length > EnCokGorselBayt) return null;

        var uyuyor = tur switch
        {
            "image/png" => veri.Length > 4 && veri[0] == 0x89 && veri[1] == 0x50 && veri[2] == 0x4E && veri[3] == 0x47,
            "image/jpeg" => veri.Length > 3 && veri[0] == 0xFF && veri[1] == 0xD8 && veri[2] == 0xFF,
            "image/webp" => veri.Length > 12 && veri[0] == (byte)'R' && veri[1] == (byte)'I' && veri[2] == (byte)'F'
                            && veri[3] == (byte)'F' && veri[8] == (byte)'W' && veri[9] == (byte)'E'
                            && veri[10] == (byte)'B' && veri[11] == (byte)'P',
            _ => false
        };

        return uyuyor ? (tur, veri) : null;
    }

    /// <summary>Konu satırına başlık enjeksiyonu olmasın: satır sonu ve denetim karakterleri silinir.</summary>
    private static string TemizKonu(string s) =>
        new string((s ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();

    private static string Kirp(string metin, int uzunluk) =>
        string.IsNullOrEmpty(metin) ? metin : metin.Length <= uzunluk ? metin : metin[..uzunluk];
}

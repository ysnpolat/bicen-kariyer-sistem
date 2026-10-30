using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Kazan-Kazan (20.10.2026).
///
/// <para>
/// İlk aktivite "Yeni Ürün Önerisi": çalışan Biçen360'tan marketlerde
/// bulunmayan bir ürünü önerir (ürün adı, barkod, neden, görsel). Ad soyad
/// ve şube oturumdan gelir. Barkod Mikro'da (BARKOD_TANIMLARI / STOKLAR)
/// varsa ve son 400 günde satılmışsa, ya da son 1 ay içinde önerilmişse
/// öneri kabul edilmez; 400 gündür satılmayan kayıtlı ürün önerilebilir.
/// </para>
///
/// <para>
/// Akış: degerlendiriliyor → (satınalma kararı) denemede | uygunDegil →
/// 3 ay deneme → 4. ay ölçüm → odullendi | odulYok. Ölçümde ürünün 4. ay
/// satış miktarı, o aydaki bütün ürünlerin satış miktarı sıralamasına
/// konur: ilk 100 tam, 101–500 yarım, 501–1000 çeyrek, 1001–2000 gram altın.
/// </para>
///
/// <para>
/// Kayıt KRY_KK_ONERI'de; her durum değişikliği KRY_KK_HAREKET'e yazılır.
/// Görseller içerik kökünde "kazankazan" klasöründe.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class KazanKazanController : ControllerBase
{
    private const string PanelRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + ","
                                        + Roller.IKYoneticisi + "," + Roller.IK;

    /// <summary>Ödül teslimini işaretleyebilenler (İK sorumlusu GMY).</summary>
    private const string TeslimRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi;

    private static readonly string[] Durumlar =
        { "degerlendiriliyor", "onaylandi", "denemede", "uygunDegil", "odullendi", "odulYok" };

    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personel;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<KazanKazanController> _kayit;
    private readonly KazanKazanServisi _kk;
    private readonly IConfiguration _ayar;

    public KazanKazanController(VeritabaniServisi vt, PersonelKaynagiServisi personel,
        IWebHostEnvironment ortam, ILogger<KazanKazanController> kayit, KazanKazanServisi kk, IConfiguration ayar)
    {
        _vt = vt;
        _personel = personel;
        _ortam = ortam;
        _kayit = kayit;
        _kk = kk;
        _ayar = ayar;
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    /// <summary>Mobil jetondaki sicil ("personel:SICIL|CIHAZ").</summary>
    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return (i < 0 ? govde : govde[..i]).Trim();
    }

    private string Cihaz()
    {
        var ad = User?.Identity?.Name ?? "";
        var i = ad.IndexOf('|');
        return i < 0 ? "" : ad[(i + 1)..];
    }

    /// <summary>Oturumdaki personel; cihaz oturumu kapatılmışsa null (MobilController ile aynı kural).</summary>
    private PersonelKaydi Kendisi()
    {
        var kod = Sicil();
        if (kod.Length == 0) return null;

        var cihaz = Cihaz();
        if (cihaz.Length > 0)
        {
            using var db = _vt.Baglanti();
            var k = db.QueryFirstOrDefault(
                "SELECT cihaz_id AS cihazId, oturum_acik AS oturumAcik FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod",
                new { kod });
            /* Kalıcı kimliğe taşınan kayıtta eski jeton kısa süre kabul edilir (26.10.2026) */
            if (k is not null && (!(bool)k.oturumAcik || !CihazKimligi.Uyusuyor(db, kod, (string)k.cihazId, cihaz)))
                return null;
        }

        return _personel.TumPersonelleriGetir()
            .Where(x => string.Equals((x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(x => x.Durum == 1)
            .FirstOrDefault();
    }

    private string GorselKlasoru()
    {
        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath) ? AppContext.BaseDirectory : _ortam.ContentRootPath;
        var k = Path.Combine(kok, "kazankazan");
        if (!Directory.Exists(k)) Directory.CreateDirectory(k);
        return k;
    }

    private (bool Var, string StokKodu, string Ad) MikrodaAra(string barkod) => _kk.MikrodaAra(barkod);

    /// <summary>Son 1 ay içindeki öneri (aynı barkod); reddedilenler de sayılır.</summary>
    private static DateTime? SonOneri(System.Data.IDbConnection db, string barkod) =>
        db.ExecuteScalar<DateTime?>(@"
SELECT MAX(olusturma) FROM KRY_KK_ONERI
WHERE barkod = @barkod AND olusturma >= DATEADD(MONTH, -1, SYSDATETIME())", new { barkod });

    private static void Hareket(System.Data.IDbConnection db, int id, string eski, string yeni, string aciklama, string yapan,
        string kaynak, System.Data.IDbTransaction tx = null) =>
        db.Execute(@"
INSERT INTO KRY_KK_HAREKET (oneri_id, eski_durum, yeni_durum, aciklama, yapan, kaynak)
VALUES (@id, @eski, @yeni, @aciklama, @yapan, @kaynak)",
            new { id, eski, yeni, aciklama, yapan, kaynak }, tx);

    /// <summary>Denemede olan önerinin ekranda gösterilecek aşaması.</summary>
    private static (string Asama, string Not) Asama(string durum, DateTime? bas, DateTime? olcumBas, DateTime? olcumBit)
    {
        if (durum != "denemede" || bas is null) return (durum, null);
        var bugun = DateTime.Today;
        if (bugun < bas) return ("denemede", $"Satışa giriş {bas:dd.MM.yyyy}");
        if (olcumBas is not null && bugun >= olcumBas)
            return ("olcumde", bugun > olcumBit ? "Ölçüm tamamlandı, sonuç bekleniyor" : $"4. ay ölçülüyor · {olcumBit:dd.MM.yyyy}'e kadar");
        var ay = (int)Math.Floor((bugun - bas.Value).TotalDays / 30.44) + 1;
        return ("denemede", $"Satışta · deneme {Math.Min(ay, 3)}. ay");
    }

    /* ==================================================================== */
    /* Mobil                                                                */
    /* ==================================================================== */

    [HttpGet("Ozet")]
    [Authorize(Roles = "Personel")]
    public IActionResult Ozet()
    {
        var p = Kendisi();
        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        using var db = _vt.Baglanti();
        var liste = db.Query(@"
SELECT TOP 50 id, urun_adi AS urunAdi, barkod, olusturma AS tarih, durum, odul, karar_notu AS kararNotu,
       satis_baslangic AS bas, olcum_bas AS olcumBas, olcum_bit AS olcumBit, siralama
FROM KRY_KK_ONERI WHERE personel_kodu = @kod ORDER BY olusturma DESC",
            new { kod = p.PersonelKodu.Trim() }).ToList();
        var kademeler = _kk.Kademeler(db);

        return Ok(new
        {
            kisi = new { adSoyad = $"{p.Ad} {p.Soyad}".Trim(), sube = p.IsGrubu },
            kademeler = kademeler.Select((k, i) => new
            {
                sira = i == 0 ? $"İlk {k.Sinir}" : $"{kademeler[i - 1].Sinir + 1} – {k.Sinir}",
                odul = k.Odul,
            }),
            aktiviteler = new object[]
            {
                new
                {
                    kod = "yeniurun", ad = "Yeni Ürün Önerisi",
                    aciklama = "Marketlerimizde olmayan, satacağını düşündüğün ürünü öner.",
                    odul = kademeler.Count > 0 ? $"{kademeler[0].Odul}'a kadar ödül" : "Ödül", acik = true, yeni = true,
                },
                new { kod = "yakinda", ad = "Yeni aktiviteler", aciklama = "Kazan-Kazan'a yeni aktiviteler eklenecek.", acik = false },
            },
            onerilerim = liste.Select(o =>
            {
                var (asama, not) = Asama((string)o.durum, (DateTime?)o.bas, (DateTime?)o.olcumBas, (DateTime?)o.olcumBit);
                return new
                {
                    id = (int)o.id,
                    urunAdi = (string)o.urunAdi,
                    barkod = (string)o.barkod,
                    tarih = (DateTime)o.tarih,
                    durum = asama,
                    odul = (string)o.odul,
                    not = (string)o.durum == "onaylandi" ? "Onaylandı, ürün açılıyor"
                        : (string)o.durum == "uygunDegil" ? (string)o.kararNotu
                        : (string)o.durum == "odulYok" ? $"4. ay sıralaması: {o.siralama}"
                        : (string)o.durum == "odullendi" ? $"4. ay sıralaması: {o.siralama}"
                        : not,
                };
            }),
        });
    }

    [HttpGet("BarkodKontrol")]
    [Authorize(Roles = "Personel")]
    public IActionResult BarkodKontrol([FromQuery] string barkod)
    {
        if (Kendisi() is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var (gecerli, b, hataMetni) = KazanKazanServisi.BarkodDenetle(barkod);
        if (!gecerli) return Ok(new { durum = "gecersiz", mesaj = hataMetni });

        using var db = _vt.Baglanti();
        if (SonOneri(db, b) is DateTime son)
            return Ok(new { durum = "onerilmis", tarih = son, tekrarTarihi = son.AddMonths(1).Date.AddDays(1) });

        try
        {
            /* Mikro'da kayıtlı ama 400 gündür satılmayan ürün de önerilebilir
               (30.10.2026): eski ürün rafa dönebilir. */
            var m = _kk.Onerilebilir(b);
            if (!m.Uygun)
                return Ok(new { durum = "mevcut", urunAdi = m.Ad, sonSatis = m.SonSatis });
            if (m.Mikroda)
                return Ok(new
                {
                    durum = "uygun",
                    eskiUrun = true,
                    urunAdi = m.Ad,
                    sonSatis = m.SonSatis,
                    mesaj = m.SonSatis is null
                        ? "Bu ürün kayıtlı ama hiç satılmamış, önerebilirsiniz."
                        : $"Bu ürün {m.SonSatis:dd.MM.yyyy} tarihinden beri satılmıyor, önerebilirsiniz."
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kazan-Kazan barkod kontrolü: Mikro'ya ulaşılamadı");
            return Ok(new { durum = "hata", mesaj = "Barkod şu an kontrol edilemiyor, biraz sonra tekrar deneyiniz." });
        }

        return Ok(new { durum = "uygun" });
    }

    [HttpPost("Oneri")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> Oneri([FromForm] string urunAdi, [FromForm] string barkod, [FromForm] string neden,
        IFormFile dosya)
    {
        var p = Kendisi();
        if (p is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var ad = (urunAdi ?? "").Trim();
        var (gecerli, b, barkodHata) = KazanKazanServisi.BarkodDenetle(barkod);
        var n = (neden ?? "").Trim();

        if (ad.Length < 2) return BadRequest(new { hata = "Ürün adını yazınız." });
        if (ad.Length > 150) ad = ad[..150];
        if (!gecerli) return BadRequest(new { hata = barkodHata });
        if (n.Length < 10) return BadRequest(new { hata = "Ürünün neden satılması gerektiğini kısaca açıklayınız." });
        if (n.Length > 1000) n = n[..1000];
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Ürünün görselini ekleyiniz." });

        using var db = _vt.Baglanti();

        /* Sunucuda yeniden denetim: istemci atlatılmış olabilir */
        if (SonOneri(db, b) is DateTime son)
            return BadRequest(new { hata = $"Bu ürün {son:dd.MM.yyyy} tarihinde önerildi; son 1 ay içinde önerilen ürün tekrar önerilemez." });

        string stokKodu = null;
        try
        {
            var m = _kk.Onerilebilir(b);
            if (!m.Uygun) return BadRequest(new { hata = "Bu ürün zaten mağazalarımızda satılıyor." });
            /* 400 gündür satılmayan kayıtlı ürün: stok kodu ölçüm için şimdiden yazılır */
            if (m.Mikroda) stokKodu = m.StokKodu;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kazan-Kazan öneri: Mikro'ya ulaşılamadı");
            return StatusCode(503, new { hata = "Barkod şu an kontrol edilemiyor, biraz sonra tekrar deneyiniz." });
        }

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();
        if (uzanti is not (".jpg" or ".jpeg" or ".png" or ".heic" or ".webp" or ".pdf" or ".mp4" or ".mov")) uzanti = ".jpg";
        var dosyaAdi = $"{DateTime.Now:yyyyMMdd}_{p.PersonelKodu.Trim()}_{Guid.NewGuid():N}{uzanti}";

        await using (var akis = new FileStream(Path.Combine(GorselKlasoru(), dosyaAdi), FileMode.Create))
            await dosya.CopyToAsync(akis);

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_KK_ONERI (aktivite, personel_kodu, ad_soyad, sube_adi, pozisyon, urun_adi, barkod, neden, gorsel, stok_kodu)
OUTPUT INSERTED.id
VALUES (N'yeniurun', @kod, @adSoyad, @sube, @pozisyon, @ad, @b, @n, @dosyaAdi, @stokKodu)",
            new
            {
                kod = p.PersonelKodu.Trim(), adSoyad = $"{p.Ad} {p.Soyad}".Trim(), sube = p.IsGrubu, pozisyon = p.Pozisyon,
                ad, b, n, dosyaAdi, stokKodu,
            });

        Hareket(db, id, null, "degerlendiriliyor", "Öneri Biçen360'tan gönderildi", p.PersonelKodu.Trim(), "mobil");

        return Ok(new { id, urunAdi = ad });
    }

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    [HttpGet("Liste")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Liste([FromQuery] string durum = null)
    {
        using var db = _vt.Baglanti();
        var liste = db.Query(@"
SELECT TOP 2000 id, personel_kodu AS sicil, ad_soyad AS adSoyad, sube_adi AS sube, pozisyon, urun_adi AS urunAdi,
       barkod, neden, gorsel, durum, karar_notu AS kararNotu, karar_veren AS kararVeren, karar_tarihi AS kararTarihi,
       stok_kodu AS stokKodu, satis_baslangic AS satisBaslangic, olcum_bas AS olcumBas, olcum_bit AS olcumBit,
       olcum_miktar AS olcumMiktar, siralama, urun_sayisi AS urunSayisi, odul, odul_tarihi AS odulTarihi, olusturma,
       teslim_tarihi AS teslimTarihi, teslim_eden AS teslimEden
FROM KRY_KK_ONERI
WHERE (@durum IS NULL OR durum = @durum)
ORDER BY olusturma DESC", new { durum = string.IsNullOrWhiteSpace(durum) ? null : durum }).ToList();

        return Ok(liste.Select(o =>
        {
            var (asama, not) = Asama((string)o.durum, (DateTime?)o.satisBaslangic, (DateTime?)o.olcumBas, (DateTime?)o.olcumBit);
            return new
            {
                o.id, o.sicil, o.adSoyad, o.sube, o.pozisyon, o.urunAdi, o.barkod, o.neden,
                gorselVar = !string.IsNullOrWhiteSpace((string)o.gorsel),
                o.durum, asama, asamaNotu = not, o.kararNotu, o.kararVeren, o.kararTarihi, o.stokKodu, o.satisBaslangic,
                o.olcumBas, o.olcumBit, o.olcumMiktar, o.siralama, o.urunSayisi, o.odul, o.odulTarihi, o.olusturma, o.teslimTarihi, o.teslimEden,
                olcumHazir = (string)o.durum == "denemede" && o.olcumBit is DateTime bit && bit < DateTime.Today,
            };
        }));
    }

    /// <summary>
    /// Öneri görseli. İK paneli jetonla (?t=) açar. Satınalma sunucusu için
    /// sunucu ayarındaki KazanKazan:ServisAnahtari, "X-Servis-Anahtari"
    /// başlığıyla gönderilirse jeton gerekmez. Anahtar ayarlanmamışsa bu yol
    /// kapalıdır. Anahtar kayda yazılmaz.
    /// </summary>
    [HttpGet("Gorsel/{id:int}")]
    [AllowAnonymous]
    public IActionResult Gorsel(int id)
    {
        if (!PanelKullanicisi() && !ServisAnahtariDogru()) return Unauthorized();

        using var db = _vt.Baglanti();
        var ad = db.ExecuteScalar<string>("SELECT gorsel FROM KRY_KK_ONERI WHERE id = @id", new { id });
        if (string.IsNullOrWhiteSpace(ad)) return NotFound();
        var yol = Path.Combine(GorselKlasoru(), Path.GetFileName(ad));
        if (!System.IO.File.Exists(yol)) return NotFound();
        var tur = Path.GetExtension(yol).ToLowerInvariant() switch
        {
            ".png" => "image/png", ".webp" => "image/webp", ".pdf" => "application/pdf",
            ".mp4" => "video/mp4", ".mov" => "video/quicktime", ".heic" => "image/heic", _ => "image/jpeg",
        };
        return PhysicalFile(yol, tur);
    }

    private bool PanelKullanicisi() =>
        User?.Identity?.IsAuthenticated == true && PanelRolleri.Split(',').Any(r => User.IsInRole(r));

    private bool ServisAnahtariDogru()
    {
        var beklenen = _ayar["KazanKazan:ServisAnahtari"];
        if (string.IsNullOrWhiteSpace(beklenen) || beklenen.Length < 24) return false;
        var gelen = Request.Headers["X-Servis-Anahtari"].ToString();
        if (gelen.Length == 0) return false;
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(gelen), System.Text.Encoding.UTF8.GetBytes(beklenen));
    }

    [HttpGet("Hareketler/{id:int}")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Hareketler(int id)
    {
        using var db = _vt.Baglanti();
        return Ok(db.Query(@"
SELECT eski_durum AS eski, yeni_durum AS yeni, aciklama, yapan, kaynak, zaman
FROM KRY_KK_HAREKET WHERE oneri_id = @id ORDER BY zaman", new { id }).ToList());
    }

    /// <summary>Etkin ödül kademeleri (satınalma KRY_KK_ODUL_KADEME'den yönetir).</summary>
    [HttpGet("OdulKademeleri")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult OdulKademeleri()
    {
        using var db = _vt.Baglanti();
        return Ok(_kk.Kademeler(db).Select(k => new { sinir = k.Sinir, odul = k.Odul }));
    }

    public sealed class KararGirdisi
    {
        /// <summary>onaylandi | denemede | uygunDegil | degerlendiriliyor</summary>
        public string Durum { get; set; }
        public string Not { get; set; }
        public string StokKodu { get; set; }
        public DateTime? SatisBaslangic { get; set; }
    }

    /// <summary>
    /// Değerlendirme kararı. "onaylandi": ürün açılıyor (tarih yok).
    /// "denemede": satışa giriş tarihiyle; ölçüm dönemi giriş + 3 ay ile
    /// giriş + 4 ay arası (4. ay). Yazım eski duruma koşullu: bu arada başka
    /// biri (satınalma) değiştirdiyse 409 döner.
    /// </summary>
    [HttpPost("Karar/{id:int}")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Karar(int id, [FromBody] KararGirdisi g)
    {
        var durum = g?.Durum;
        if (durum is not ("onaylandi" or "denemede" or "uygunDegil" or "degerlendiriliyor"))
            return BadRequest(new { hata = "Karar geçersiz." });

        using var db = _vt.Baglanti();
        var eski = db.ExecuteScalar<string>("SELECT durum FROM KRY_KK_ONERI WHERE id = @id", new { id });
        if (eski is null) return NotFound(new { hata = "Öneri bulunamadı." });
        if (eski is "odullendi" or "odulYok") return BadRequest(new { hata = "Sonuçlanmış öneri değiştirilemez." });

        var not = (g.Not ?? "").Trim();
        if (durum == "uygunDegil" && not.Length < 3) return BadRequest(new { hata = "Uygun bulunmama sebebini yazınız; personel bunu görür." });
        if (not.Length > 500) not = not[..500];

        DateTime? bas = null, olcBas = null, olcBit = null;
        if (durum == "denemede")
        {
            if (g.SatisBaslangic is null) return BadRequest(new { hata = "Satışa giriş tarihini seçiniz." });
            bas = g.SatisBaslangic.Value.Date;
            olcBas = bas.Value.AddMonths(3);
            olcBit = bas.Value.AddMonths(4).AddDays(-1);
        }

        var kim = User?.Identity?.Name ?? "panel";
        var n = db.Execute(@"
UPDATE KRY_KK_ONERI
SET durum = @durum, karar_notu = @not, karar_veren = @kim, karar_tarihi = SYSDATETIME(),
    stok_kodu = COALESCE(@stok, stok_kodu), satis_baslangic = @bas, olcum_bas = @olcBas, olcum_bit = @olcBit,
    guncelleme = SYSDATETIME()
WHERE id = @id AND durum = @eski",
            new { id, eski, durum, not = not.Length == 0 ? null : not, kim, stok = string.IsNullOrWhiteSpace(g.StokKodu) ? null : g.StokKodu.Trim(), bas, olcBas, olcBit });
        if (n == 0) return Conflict(new { hata = "Öneri bu arada güncellendi; sayfayı yenileyiniz." });

        Hareket(db, id, eski, durum,
            durum == "denemede" ? $"Satışa giriş {bas:dd.MM.yyyy}; ölçüm {olcBas:dd.MM.yyyy}–{olcBit:dd.MM.yyyy}"
            : durum == "onaylandi" ? (not.Length > 0 ? not : "Onaylandı, ürün açılıyor")
            : not,
            kim, "panel");

        return Ok(new { tamam = true, olcumBas = olcBas, olcumBit = olcBit });
    }

    /// <summary>
    /// 4. ay ölçümü: ölçüm dönemindeki bütün ürünlerin satış miktarı
    /// sıralanır, önerilen ürünün yeri bulunur ve ödül belirlenir. Gece
    /// görevi de aynısını kendiliğinden yapar; yazım atomik (durum = denemede).
    /// </summary>
    [HttpPost("Olc/{id:int}")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Olc(int id)
    {
        var s = _kk.Olc(id, User?.Identity?.Name ?? "panel", "panel");
        return s.Kod switch
        {
            200 => Ok(new { sira = s.Sira, urunSayisi = s.UrunSayisi, miktar = s.Miktar, odul = s.Odul, durum = s.Durum }),
            404 => NotFound(new { hata = s.Hata }),
            409 => Conflict(new { hata = s.Hata }),
            502 => StatusCode(502, new { hata = s.Hata }),
            _ => BadRequest(new { hata = s.Hata }),
        };
    }

    public sealed class TeslimGirdisi
    {
        /// <summary>true: teslim kaydını geri alır.</summary>
        public bool GeriAl { get; set; }
        public DateTime? Tarih { get; set; }
    }

    /// <summary>Ödül teslim edildi (İK sorumlusu GMY işaretler; satınalma yalnızca okur).</summary>
    [HttpPost("Teslim/{id:int}")]
    [Authorize(Roles = TeslimRolleri)]
    public IActionResult Teslim(int id, [FromBody] TeslimGirdisi g)
    {
        var geriAl = g?.GeriAl == true;
        var tarih = (g?.Tarih ?? DateTime.Now);
        if (tarih > DateTime.Now.AddMinutes(5)) return BadRequest(new { hata = "Teslim tarihi ileri bir gün olamaz." });

        var kim = User?.Identity?.Name ?? "panel";
        using var db = _vt.Baglanti();
        var n = db.Execute(geriAl
            ? "UPDATE KRY_KK_ONERI SET teslim_tarihi = NULL, teslim_eden = NULL, guncelleme = SYSDATETIME() WHERE id = @id AND durum = N'odullendi' AND teslim_tarihi IS NOT NULL"
            : "UPDATE KRY_KK_ONERI SET teslim_tarihi = @tarih, teslim_eden = @kim, guncelleme = SYSDATETIME() WHERE id = @id AND durum = N'odullendi' AND teslim_tarihi IS NULL",
            new { id, tarih, kim });
        if (n == 0) return Conflict(new { hata = geriAl ? "Teslim kaydı yok." : "Öneri ödüllü değil ya da zaten teslim edilmiş." });

        Hareket(db, id, "odullendi", "odullendi",
            geriAl ? "Teslim kaydı geri alındı" : $"Ödül teslim edildi {tarih:dd.MM.yyyy}", kim, "panel");
        if (geriAl)
            db.Execute("UPDATE KRY_KK_HAREKET SET bildirim_zamani = SYSDATETIME() WHERE oneri_id = @id AND bildirim_zamani IS NULL", new { id });

        return Ok(new { tamam = true });
    }
}

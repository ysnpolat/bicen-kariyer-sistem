using System.Globalization;
using System.Net;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Çalışma süresi denkleştirmesi (23.10.2026).
/// ---------------------------------------------------------------------------
/// <para>
/// Fazla çalışma ücret yerine izin olarak ×1,5 alacak yazılır (5 sa → 7 sa
/// 30 dk). Erken çıkış / geç geliş bire bir borçtur; kapatmak için borcun
/// 1,5'te biri kadar fazla çalışma yeter (3 sa borç → 2 sa). Denkleştirme
/// izni alacaktan düşer.
/// </para>
/// <para>
/// Akış: personel formu doldurur → çıktısını alıp imzalar → imzalı formu
/// yükler → birim yöneticisi onaylar → İK onaylar. Bakiyeye yalnız İK'nın
/// onayladığı formlar işlenir. Fazla mesai modülünde onaylanıp karşılığı
/// "izin" olan kayıtlar (ücret kuralları) bakiyeye kendiliğinden eklenir.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DenklestirmeController : ControllerBase
{
    public const decimal Carpan = 1.5m;

    public const string TurFazla = "fazla";
    public const string TurEksik = "eksik";
    public const string TurIzin = "izin";

    public const string DImza = "imza";
    public const string DYonetici = "yonetici";
    public const string DIk = "ik";
    public const string DOnay = "onaylandi";
    public const string DRed = "reddedildi";
    public const string DIptal = "iptal";

    private const string PanelRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK;

    private static readonly Dictionary<string, string> TurAdlari = new()
    {
        [TurFazla] = "Fazla çalışma",
        [TurEksik] = "Eksik çalışma",
        [TurIzin] = "Denkleştirme izni",
    };

    private static readonly Dictionary<string, string> DurumAdlari = new()
    {
        [DImza] = "İmzalı form bekleniyor",
        [DYonetici] = "Yönetici onayında",
        [DIk] = "İK onayında",
        [DOnay] = "Onaylandı",
        [DRed] = "Reddedildi",
        [DIptal] = "İptal edildi",
    };

    private static readonly CultureInfo Tr = new("tr-TR");

    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly OrgOnayServisi _orgOnay;
    private readonly BildirimServisi _bildirim;
    private readonly IzinOnayKuralServisi _kural;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<DenklestirmeController> _kayit;

    public DenklestirmeController(VeritabaniServisi vt, EkipServisi ekip, OrgOnayServisi orgOnay, BildirimServisi bildirim,
        IzinOnayKuralServisi kural, IConfiguration yapilandirma, IWebHostEnvironment ortam, ILogger<DenklestirmeController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _orgOnay = orgOnay;
        _bildirim = bildirim;
        _kural = kural;
        _yapilandirma = yapilandirma;
        _ortam = ortam;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');
    private static string Ad(PersonelKaydi p) => $"{p?.Ad} {p?.Soyad}".Trim();
    private string Kullanici => User?.Identity?.Name ?? "sistem";
    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private bool PanelRolu => Rol is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi or Roller.IK;

    private string PersonelKodu()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return (i < 0 ? govde : govde[..i]).Trim();
    }

    public static string FormNo(int id, DateTime olusturma) => $"DNK-{olusturma:yyyy}-{id:0000}";

    public static string Sure(int dk)
    {
        dk = Math.Abs(dk);
        var s = dk / 60;
        var d = dk % 60;
        return s > 0 && d > 0 ? $"{s} sa {d} dk" : s > 0 ? $"{s} sa" : $"{d} dk";
    }

    public static string Isaretli(int dk) => (dk > 0 ? "+" : dk < 0 ? "−" : "") + (dk == 0 ? "0" : Sure(dk));

    /* ==================================================================== */
    /* Bakiye                                                               */
    /* ==================================================================== */

    public sealed record Hareket(string Kaynak, int? Id, string Tur, DateTime Tarih, string Baslangic, string Bitis,
        int Dk, int EtkiDk, string Aciklama, string Durum, DateTime Olusturma);

    /// <summary>Onaylanmış fazla mesailerden karşılığı "izin" olanlar (ücret kurallarına göre).</summary>
    private List<Hareket> FazlaMesaiIzinleri(System.Data.IDbConnection db, string[] kodlar)
    {
        var l = new List<Hareket>();
        try
        {
            var satirlar = db.Query(@"
SELECT id, personel_kodu AS kod, gorev, sube, tarih, baslangic, bitis, sure_dk AS dk, aciklama, olusturma
FROM KRY_FAZLA_MESAI
WHERE durum = N'onaylandi' AND (@hepsi = 1 OR personel_kodu IN @kodlar)",
                new { hepsi = kodlar is null ? 1 : 0, kodlar = kodlar ?? new[] { "" } }).ToList();
            if (satirlar.Count == 0) return l;

            var girdiler = satirlar.Select(x =>
            {
                var kisi = _ekip.Kisi((string)x.kod);
                return new FazlaMesaiUcretServisi.Girdi((int)x.id, ((string)x.kod).Trim(), kisi?.Pozisyon ?? (string)x.gorev,
                    kisi?.IsGrubu ?? (string)x.sube, (DateTime)x.tarih, (int)x.dk);
            }).ToList();

            var sonuc = HttpContext.RequestServices.GetRequiredService<FazlaMesaiUcretServisi>()
                .Hesapla(girdiler, new Dictionary<string, decimal>(), ig => _kural.IsYeriBul(ig));

            foreach (var x in satirlar)
            {
                if (!sonuc.TryGetValue((int)x.id, out var s) || s.Karsilik != FazlaMesaiUcretServisi.KarsilikIzin || s.IzinDk <= 0) continue;
                l.Add(new Hareket("fm:" + K((string)x.kod), (int)x.id, TurFazla, (DateTime)x.tarih, (string)x.baslangic, (string)x.bitis,
                    (int)x.dk, s.IzinDk, (string)x.aciklama, DOnay, (DateTime)x.olusturma));
            }
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Denkleştirme: fazla mesai izinleri okunamadı");
        }
        return l;
    }

    public sealed record Bakiye(int AlacakDk, int BorcDk, int NetDk, int Bekleyen);

    /// <summary>Kişi(ler)in bakiyesi; kodlar null ise herkes.</summary>
    private Dictionary<string, Bakiye> Bakiyeler(System.Data.IDbConnection db, string[] kodlar)
    {
        var formlar = db.Query(@"
SELECT personel_kodu AS kod,
       SUM(CASE WHEN durum = N'onaylandi' AND etki_dk > 0 THEN etki_dk ELSE 0 END) AS alacak,
       SUM(CASE WHEN durum = N'onaylandi' AND etki_dk < 0 THEN -etki_dk ELSE 0 END) AS borc,
       SUM(CASE WHEN durum IN (N'imza', N'yonetici', N'ik') THEN 1 ELSE 0 END) AS bekleyen
FROM KRY_DENKLESTIRME
WHERE (@hepsi = 1 OR personel_kodu IN @kodlar)
GROUP BY personel_kodu", new { hepsi = kodlar is null ? 1 : 0, kodlar = kodlar ?? new[] { "" } }).ToList();

        var d = new Dictionary<string, (int a, int b, int bek)>(StringComparer.OrdinalIgnoreCase);
        foreach (var f in formlar)
        {
            var k = K((string)f.kod);
            var o = d.GetValueOrDefault(k);
            d[k] = (o.a + (int)f.alacak, o.b + (int)f.borc, o.bek + (int)f.bekleyen);
        }
        foreach (var fm in FazlaMesaiIzinleri(db, kodlar))
        {
            var k = fm.Kaynak[3..];
            var o = d.GetValueOrDefault(k);
            d[k] = (o.a + fm.EtkiDk, o.b, o.bek);
        }
        return d.ToDictionary(x => x.Key, x => new Bakiye(x.Value.a, x.Value.b, x.Value.a - x.Value.b, x.Value.bek),
            StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Sicil baştaki sıfırlarla da yazılmış olabilir: sorguya iki biçim gider.</summary>
    private static string[] KodBicimleri(string kod)
    {
        var k = (kod ?? "").Trim();
        return new[] { k, K(k) }.Distinct().ToArray();
    }

    private Bakiye KisiBakiyesi(System.Data.IDbConnection db, string kod) =>
        Bakiyeler(db, KodBicimleri(kod)).GetValueOrDefault(K(kod)) ?? new Bakiye(0, 0, 0, 0);

    private object KayitNesne(dynamic x) => new
    {
        id = (int)x.id,
        formNo = FormNo((int)x.id, (DateTime)x.olusturma),
        personelKodu = K((string)x.personel_kodu),
        adSoyad = (string)x.ad_soyad,
        gorev = (string)x.gorev,
        sube = (string)x.sube,
        tur = (string)x.tur,
        turAdi = TurAdlari.GetValueOrDefault((string)x.tur, (string)x.tur),
        tarih = (DateTime)x.tarih,
        baslangic = (string)x.baslangic,
        bitis = (string)x.bitis,
        dk = (int)x.dk,
        etkiDk = (int)x.etki_dk,
        aciklama = (string)x.aciklama,
        durum = (string)x.durum,
        durumAdi = DurumAdlari.GetValueOrDefault((string)x.durum, (string)x.durum),
        belgeVar = !string.IsNullOrEmpty((string)x.belge_dosya),
        belgeTarihi = (DateTime?)x.belge_tarihi,
        yoneticiAd = (string)x.yonetici_ad,
        yoneticiTarih = (DateTime?)x.yonetici_tarih,
        yoneticiNot = (string)x.yonetici_not,
        ikAd = (string)x.ik_ad,
        ikTarih = (DateTime?)x.ik_tarih,
        redNedeni = (string)x.red_nedeni,
        olusturma = (DateTime)x.olusturma,
    };

    private static object HareketNesne(Hareket h) => new
    {
        kaynak = h.Kaynak.StartsWith("fm:") ? "fazlamesai" : "form",
        id = h.Id,
        tur = h.Tur,
        turAdi = h.Kaynak.StartsWith("fm:") ? "Fazla mesai" : TurAdlari.GetValueOrDefault(h.Tur, h.Tur),
        tarih = h.Tarih,
        baslangic = h.Baslangic,
        bitis = h.Bitis,
        dk = h.Dk,
        etkiDk = h.EtkiDk,
        aciklama = h.Aciklama,
        durum = h.Durum,
        durumAdi = DurumAdlari.GetValueOrDefault(h.Durum, h.Durum),
    };

    private static object BakiyeNesne(Bakiye b) => new { alacakDk = b.AlacakDk, borcDk = b.BorcDk, netDk = b.NetDk, bekleyen = b.Bekleyen };

    /* ==================================================================== */
    /* Mobil · personel                                                     */
    /* ==================================================================== */

    /// <summary>Bakiye, formlarım ve fazla mesaiden gelen izin hareketleri.</summary>
    [HttpGet("Mobil/Ozet")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilOzet()
    {
        var kod = PersonelKodu();
        if (kod.Length == 0) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        var formlar = db.Query(@"
SELECT TOP 100 * FROM KRY_DENKLESTIRME
WHERE personel_kodu IN @kodlar AND durum <> N'iptal'
ORDER BY id DESC", new { kodlar = KodBicimleri(kod) }).ToList();

        var fm = FazlaMesaiIzinleri(db, KodBicimleri(kod))
            .OrderByDescending(x => x.Tarih).Take(50).ToList();

        var ben = _ekip.Kisi(kod);

        return Ok(new
        {
            carpan = Carpan,
            bakiye = BakiyeNesne(KisiBakiyesi(db, kod)),
            formlar = formlar.Select(KayitNesne),
            fazlaMesai = fm.Select(HareketNesne),
            onaylayici = ben is not null && OnayBekleyenler(db, ben).Count > 0,
        });
    }

    public sealed class FormGirdisi
    {
        public string Tur { get; set; }
        public DateTime Tarih { get; set; }
        public string Baslangic { get; set; }
        public string Bitis { get; set; }
        public string Aciklama { get; set; }
    }

    private static int? Dakika(string s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var p = s.Trim().Split(':');
        if (p.Length != 2 || !int.TryParse(p[0], out var h) || !int.TryParse(p[1], out var m)) return null;
        if (h == 24 && m == 0) return 1440;
        if (h is < 0 or > 23 || m is < 0 or > 59) return null;
        return h * 60 + m;
    }

    private static string SaatDuz(string s)
    {
        var d = Dakika(s) ?? 0;
        return d == 1440 ? "24:00" : $"{d / 60:00}:{d % 60:00}";
    }

    /// <summary>Yeni form; imzalı form yüklenene kadar onaya gitmez.</summary>
    [HttpPost("Mobil/Form")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilForm([FromBody] FormGirdisi g)
    {
        var kod = PersonelKodu();
        if (kod.Length == 0) return Unauthorized(new { hata = "Oturumunuz sona erdi." });
        var kisi = _ekip.Kisi(kod);
        if (kisi is null) return BadRequest(new { hata = "Personel kaydınız bulunamadı." });
        if (g is null || !TurAdlari.ContainsKey(g.Tur ?? "")) return BadRequest(new { hata = "Form türünü seçiniz." });

        var bas = Dakika(g.Baslangic);
        var bit = Dakika(g.Bitis);
        if (bas is null || bit is null) return BadRequest(new { hata = "Saatleri SS:DD biçiminde giriniz." });
        var dk = bit.Value - bas.Value;
        if (dk <= 0) dk += 1440;
        if (dk < 15) return BadRequest(new { hata = "Süre en az 15 dakika olmalı." });
        if (dk > 16 * 60) return BadRequest(new { hata = "Süre 16 saati geçemez; günleri ayrı form olarak giriniz." });

        var tarih = g.Tarih.Date;
        var bugun = DateTime.Today;
        if (g.Tur != TurIzin && tarih > bugun) return BadRequest(new { hata = "Fazla ya da eksik çalışma ileri bir tarih için girilemez." });
        if (tarih < bugun.AddDays(-60)) return BadRequest(new { hata = "60 günden eski tarih için form doldurulamaz; İK ile görüşünüz." });
        if (tarih > bugun.AddDays(90)) return BadRequest(new { hata = "En fazla 90 gün sonrası için izin planlanabilir." });

        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length > 500) aciklama = aciklama[..500];
        if (g.Tur != TurIzin && aciklama.Length < 3) return BadRequest(new { hata = "Kısa bir açıklama yazınız (ör. sayım, doktor)." });

        var etki = g.Tur == TurFazla ? (int)Math.Round(dk * Carpan) : -dk;
        var basS = SaatDuz(g.Baslangic);
        var bitS = SaatDuz(g.Bitis);

        using var db = _vt.Baglanti();

        /* Aynı gün çakışan form */
        var ayniGun = db.Query("SELECT id, baslangic, bitis FROM KRY_DENKLESTIRME WHERE personel_kodu IN @kodlar AND tarih = @tarih AND durum NOT IN (N'iptal', N'reddedildi')",
            new { kodlar = KodBicimleri(kod), tarih }).ToList();
        foreach (var x in ayniGun)
        {
            var b2 = Dakika((string)x.baslangic) ?? 0;
            var e2 = Dakika((string)x.bitis) ?? 0;
            if (e2 <= b2) e2 += 1440;
            var e1 = bas.Value + dk;
            if (bas.Value < e2 && b2 < e1)
                return BadRequest(new { hata = $"Bu saatlerle çakışan bir formunuz var ({(string)x.baslangic}–{(string)x.bitis})." });
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_DENKLESTIRME (personel_kodu, ad_soyad, gorev, sube, tur, tarih, baslangic, bitis, dk, etki_dk, aciklama, durum)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @gorev, @sube, @tur, @tarih, @bas, @bit, @dk, @etki, @aciklama, N'imza')",
            new { kod = kisi.PersonelKodu.Trim(), ad = Ad(kisi), gorev = kisi.Pozisyon, sube = kisi.IsGrubu, tur = g.Tur, tarih, bas = basS, bit = bitS, dk, etki, aciklama });

        var kayit = db.QueryFirst("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        return Ok(KayitNesne(kayit));
    }

    /// <summary>Formun ayrıntısı (personel kendi formunu, onaylayıcı ve İK hepsini).</summary>
    [HttpGet("{id:int}")]
    [Authorize]
    public IActionResult Ayrinti(int id)
    {
        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null || !Gorebilir(x)) return NotFound(new { hata = "Form bulunamadı." });
        return Ok(new { kayit = KayitNesne(x), bakiye = BakiyeNesne(KisiBakiyesi(db, (string)x.personel_kodu)) });
    }

    private bool Gorebilir(dynamic x)
    {
        if (PanelRolu) return true;
        var kod = PersonelKodu();
        if (kod.Length == 0) return false;
        if (K((string)x.personel_kodu) == K(kod)) return true;
        return _orgOnay.KararVerebilir(kod, ((string)x.personel_kodu).Trim(), (string)x.gorev, (string)x.sube, 1);
    }

    /// <summary>İmzalı form (fotoğraf ya da PDF): yüklenince yönetici onayına gider.</summary>
    [HttpPost("Mobil/{id:int}/ImzaliForm")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(31_457_280)]
    public async Task<IActionResult> ImzaliFormYukle(int id, IFormFile dosya)
    {
        var kod = PersonelKodu();
        if (kod.Length == 0) return Unauthorized(new { hata = "Oturumunuz sona erdi." });
        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });

        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null || K((string)x.personel_kodu) != K(kod)) return NotFound(new { hata = "Form bulunamadı." });
        if ((string)x.durum is not (DImza or DYonetici))
            return BadRequest(new { hata = "Bu formun imzalı çıktısı artık değiştirilemez." });

        var uzanti = Uzanti(dosya);
        if (uzanti is null) return BadRequest(new { hata = "Fotoğraf (JPG, PNG, HEIC) ya da PDF yükleyiniz." });

        var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
        var diskAdi = $"{K(kod)}_dnk{id}_{Guid.NewGuid():N}{uzanti}";
        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);
            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);
            await dosya.CopyToAsync(akis);
        }
        catch (Exception h)
        {
            _kayit.LogError(h, "Denkleştirme formu yazılamadı: {Klasor}", klasor);
            return StatusCode(500, new { hata = "Form sunucuya yazılamadı." });
        }

        /* Personel kartında da görünsün (personele kapalı) */
        try
        {
            db.Execute(@"
INSERT INTO KRY_PERSONEL_BELGE (personel_kodu, ad_soyad, tur, baslik, aciklama, dosya, ozgun_ad, boyut, yukleyen, personele_acik)
VALUES (@kod, @ad, N'Denkleştirme formu', @baslik, @aciklama, @diskAdi, @ozgun, @boyut, @yukleyen, 0)",
                new
                {
                    kod = ((string)x.personel_kodu).Trim(), ad = (string)x.ad_soyad,
                    baslik = $"{TurAdlari.GetValueOrDefault((string)x.tur)} · {(DateTime)x.tarih:dd.MM.yyyy}",
                    aciklama = FormNo(id, (DateTime)x.olusturma), diskAdi, ozgun = dosya.FileName, boyut = dosya.Length, yukleyen = kod,
                });
        }
        catch (Exception h) { _kayit.LogWarning(h, "Denkleştirme formu personel belgelerine eklenemedi"); }

        var (birim, _, birimUnvan, _) = _orgOnay.Onaylayicilar(((string)x.personel_kodu).Trim(), (string)x.gorev, (string)x.sube);
        birim = birim.Where(p => K(p.PersonelKodu) != K(kod)).ToList();
        var yeniDurum = birim.Count > 0 ? DYonetici : DIk;

        db.Execute(@"UPDATE KRY_DENKLESTIRME SET belge_dosya = @diskAdi, belge_tarihi = SYSDATETIME(), durum = @yeniDurum
WHERE id = @id", new { id, diskAdi, yeniDurum });

        var metin = $"{(string)x.ad_soyad} · {TurAdlari.GetValueOrDefault((string)x.tur)} {Sure((int)x.dk)} ({(DateTime)x.tarih:dd.MM})";
        if ((string)x.durum == DImza)
        {
            if (yeniDurum == DYonetici)
                await _bildirim.KisiyeOzelGonder(birim.Select(p => (p.PersonelKodu.Trim(), "Denkleştirme onayı", metin)), "denklestirmeonay");
            else
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Denkleştirme formu", metin);
        }

        return Ok(new { tamam = true, durum = yeniDurum, durumAdi = DurumAdlari[yeniDurum], onaylayan = birimUnvan });
    }

    private static string Uzanti(IFormFile f)
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

    [HttpPost("Mobil/{id:int}/Iptal")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilIptal(int id)
    {
        var kod = PersonelKodu();
        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT personel_kodu, durum FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null || K((string)x.personel_kodu) != K(kod)) return NotFound(new { hata = "Form bulunamadı." });
        if ((string)x.durum is not (DImza or DYonetici or DIk)) return BadRequest(new { hata = "Sonuçlanan form iptal edilemez." });
        db.Execute("UPDATE KRY_DENKLESTIRME SET durum = N'iptal', iptal_tarihi = SYSDATETIME() WHERE id = @id", new { id });
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Mobil · yönetici                                                     */
    /* ==================================================================== */

    private List<dynamic> OnayBekleyenler(System.Data.IDbConnection db, PersonelKaydi ben)
    {
        var l = db.Query("SELECT * FROM KRY_DENKLESTIRME WHERE durum = N'yonetici' ORDER BY id").ToList();
        return l.Where(x => K((string)x.personel_kodu) != K(ben.PersonelKodu)
                            && _orgOnay.KararVerebilir(ben.PersonelKodu.Trim(), ((string)x.personel_kodu).Trim(), (string)x.gorev, (string)x.sube, 1))
            .ToList();
    }

    [HttpGet("Mobil/Onay")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilOnay()
    {
        var ben = _ekip.Kisi(PersonelKodu());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });
        using var db = _vt.Baglanti();
        var l = OnayBekleyenler(db, ben);
        var kodlar = l.Select(x => ((string)x.personel_kodu).Trim()).SelectMany(KodBicimleri).Distinct().ToArray();
        var bakiyeler = kodlar.Length == 0 ? new() : Bakiyeler(db, kodlar);
        return Ok(new
        {
            kayitlar = l.Select(x => new
            {
                kayit = KayitNesne(x),
                bakiye = BakiyeNesne(bakiyeler.GetValueOrDefault(K((string)x.personel_kodu)) ?? new Bakiye(0, 0, 0, 0)),
            }),
        });
    }

    public sealed class KararGirdisi
    {
        public bool Onay { get; set; }
        public string Not { get; set; }
    }

    [HttpPost("Mobil/{id:int}/Karar")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilKarar(int id, [FromBody] KararGirdisi g)
    {
        var ben = _ekip.Kisi(PersonelKodu());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });
        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null) return NotFound(new { hata = "Form bulunamadı." });
        if ((string)x.durum != DYonetici) return BadRequest(new { hata = "Form yönetici onayında değil." });
        if (!_orgOnay.KararVerebilir(ben.PersonelKodu.Trim(), ((string)x.personel_kodu).Trim(), (string)x.gorev, (string)x.sube, 1))
            return StatusCode(403, new { hata = "Bu formu onaylama yetkiniz yok." });

        var not = (g?.Not ?? "").Trim();
        if (not.Length > 500) not = not[..500];
        if (g?.Onay != true && not.Length < 3) return BadRequest(new { hata = "Red nedenini yazınız." });

        if (g!.Onay)
        {
            db.Execute(@"UPDATE KRY_DENKLESTIRME SET durum = N'ik', yonetici_kodu = @k, yonetici_ad = @ad, yonetici_tarih = SYSDATETIME(),
yonetici_not = @not WHERE id = @id", new { id, k = ben.PersonelKodu.Trim(), ad = $"{Ad(ben)} · {ben.Pozisyon}", not = not.Length == 0 ? null : not });
            await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Denkleştirme formu",
                $"{(string)x.ad_soyad} · {TurAdlari.GetValueOrDefault((string)x.tur)} {Sure((int)x.dk)} · yönetici onayladı");
        }
        else
        {
            db.Execute(@"UPDATE KRY_DENKLESTIRME SET durum = N'reddedildi', yonetici_kodu = @k, yonetici_ad = @ad, yonetici_tarih = SYSDATETIME(),
red_nedeni = @not WHERE id = @id", new { id, k = ben.PersonelKodu.Trim(), ad = $"{Ad(ben)} · {ben.Pozisyon}", not });
            await _bildirim.Gonder(((string)x.personel_kodu).Trim(), "Denkleştirme formu reddedildi", $"{(DateTime)x.tarih:dd.MM} · {not}", "denklestirme");
        }
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Form çıktısı ve imzalı form                                          */
    /* ==================================================================== */

    [HttpGet("{id:int}/Form")]
    [Authorize]
    public async Task<IActionResult> FormCiktisi(int id, [FromQuery] bool html = false)
    {
        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null || !Gorebilir(x)) return NotFound(new { hata = "Form bulunamadı." });

        var (birim, _, birimUnvan, _) = _orgOnay.Onaylayicilar(((string)x.personel_kodu).Trim(), (string)x.gorev, (string)x.sube);
        string sayfa = FormHtml(x, birimUnvan ?? "Birim yöneticisi");
        if (html) return Content(sayfa, "text/html; charset=utf-8");

        var (pdf, _) = await TarayiciPdf.DonusturAsync(sayfa, _yapilandirma, _kayit);
        return pdf is not null
            ? File(pdf, "application/pdf", $"{FormNo(id, (DateTime)x.olusturma)}.pdf")
            : Content(sayfa, "text/html; charset=utf-8");
    }

    [HttpGet("{id:int}/ImzaliForm")]
    [Authorize]
    public IActionResult ImzaliForm(int id)
    {
        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null || !Gorebilir(x)) return NotFound(new { hata = "Form bulunamadı." });
        var ad = (string)x.belge_dosya ?? "";
        if (ad.Length == 0 || ad.Contains('/') || ad.Contains('\\') || ad.Contains("..")) return NotFound(new { hata = "İmzalı form yüklenmedi." });
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

    private static string E(string s) => WebUtility.HtmlEncode(s ?? "");

    private static string FormHtml(dynamic x, string yoneticiUnvan)
    {
        string tur = x.tur;
        int dk = x.dk, etki = x.etki_dk;
        DateTime tarih = x.tarih, olusturma = x.olusturma;
        string Kutu(string t) => tur == t ? "☒" : "☐";
        var gerek = tur == TurEksik ? $"{Sure((int)Math.Ceiling(dk / Carpan))} ({Sure((int)Math.Ceiling(dk / Carpan))} × 1,5 = {Sure(dk)})" : "—";
        var katsayi = tur == TurFazla ? "1,5" : "1,0";

        return $$"""
<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{E(FormNo((int)x.id, olusturma))}}</title>
<style>
@page{size:A4;margin:14mm}
body{font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:0;background:#f3f4f1}
.a4{max-width:794px;margin:16px auto;background:#fff;padding:36px 42px;font-size:13px;box-shadow:0 6px 30px #0002}
.bas{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px}
.logo{font-weight:900;font-size:22px;letter-spacing:.5px;color:#4a6e0c}
h1{font-size:17px;margin:14px 0 4px;text-align:center}
.alt{text-align:center;color:#555;font-size:11.5px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin:8px 0 14px}
td,th{border:1px solid #333;padding:7px 9px;text-align:left;vertical-align:top}
th{background:#f1f3ee;width:32%}
.hes td,.hes th{text-align:center;width:auto}
.beyan{border:1px solid #333;padding:10px 12px;font-size:12px;line-height:1.55;margin-bottom:16px}
.imza{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.imza div{border:1px solid #333;height:118px;padding:8px;display:flex;flex-direction:column;justify-content:space-between;font-size:11.5px}
.dip{margin-top:12px;font-size:10.5px;color:#666;display:flex;justify-content:space-between;gap:10px}
.yazdir{display:block;margin:12px auto 0;padding:10px 22px;border:0;border-radius:10px;background:#5f8c10;color:#fff;font-weight:700;font-size:15px}
@media print{body{background:#fff}.a4{box-shadow:none;margin:0;padding:0;max-width:none}.yazdir{display:none} }
</style></head><body>
<button class="yazdir" onclick="window.print()">Yazdır</button>
<div class="a4">
<div class="bas"><div class="logo">BİÇEN</div><div style="text-align:right;font-size:11.5px">Form no: <b>{{E(FormNo((int)x.id, olusturma))}}</b><br>Oluşturma: {{olusturma:dd.MM.yyyy HH:mm}}</div></div>
<h1>ÇALIŞMA SÜRESİ DENKLEŞTİRME FORMU</h1>
<div class="alt">Fazla çalışma karşılığı serbest zaman ve eksik çalışmanın denkleştirilmesi</div>
<table>
<tr><th>Adı soyadı</th><td>{{E((string)x.ad_soyad)}}</td></tr>
<tr><th>Sicil / Görevi</th><td>{{E(((string)x.personel_kodu).Trim())}} · {{E((string)x.gorev)}}</td></tr>
<tr><th>Şube / Birim</th><td>{{E((string)x.sube)}}</td></tr>
<tr><th>Türü</th><td>{{Kutu(TurFazla)}} Fazla çalışma (izin karşılığı) &nbsp; {{Kutu(TurEksik)}} Eksik çalışma (erken çıkış / geç geliş) &nbsp; {{Kutu(TurIzin)}} Denkleştirme izni kullanımı</td></tr>
<tr><th>Tarih ve saat</th><td>{{tarih:dd.MM.yyyy}} · {{E((string)x.baslangic)}} – {{E((string)x.bitis)}} ({{Sure(dk)}})</td></tr>
<tr><th>Açıklama</th><td>{{E((string)x.aciklama)}}</td></tr>
</table>
<table class="hes">
<tr><th>Süre</th><th>Katsayı</th><th>Bakiyeye etkisi</th><th>Kapatmak için gereken fazla çalışma</th></tr>
<tr><td>{{Sure(dk)}}</td><td>{{katsayi}}</td><td><b>{{Isaretli(etki)}}</b></td><td>{{gerek}}</td></tr>
</table>
<div class="beyan">Yukarıda belirtilen sürenin denkleştirme kapsamında değerlendirilmesini kabul ediyorum. Fazla çalışma, ücret yerine
1 saate 1,5 saat oranında serbest zaman olarak bakiyeme yazılır; eksik çalışılan süre bire bir borç yazılır ve fazla çalışma ile
aynı oranda kapatılır. Form, imzalı olarak sisteme yüklenip İnsan Kaynakları tarafından onaylandıktan sonra geçerlidir.</div>
<div class="imza">
<div><b>Personel</b><span>{{E((string)x.ad_soyad)}}</span><span>İmza / Tarih: ___/___/______</span></div>
<div><b>{{E(yoneticiUnvan)}}</b><span>Ad soyad</span><span>İmza / Tarih: ___/___/______</span></div>
<div><b>İnsan Kaynakları</b><span>Ad soyad</span><span>İmza / Tarih: ___/___/______</span></div>
</div>
<div class="dip"><span>Bu form sisteme imzalı olarak yüklenmeden geçerli değildir.</span><span>Biçen360 · denkleştirme</span></div>
</div>
</body></html>
""";
    }

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    [HttpGet("Liste")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Liste([FromQuery] string durum = DIk, [FromQuery] string ay = null, [FromQuery] string sube = null, [FromQuery] string q = null)
    {
        using var db = _vt.Baglanti();
        DateTime? bas = null, bit = null;
        if (!string.IsNullOrWhiteSpace(ay) && DateTime.TryParseExact(ay + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var a))
        {
            bas = a;
            bit = a.AddMonths(1);
        }
        q = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        var durumlar = durum == "bekleyen" ? new[] { DImza, DYonetici, DIk } : new[] { durum ?? DIk };

        var l = db.Query(@"
SELECT TOP 1000 * FROM KRY_DENKLESTIRME
WHERE durum IN @durumlar
  AND (@bas IS NULL OR tarih >= @bas) AND (@bit IS NULL OR tarih < @bit)
  AND (@sube IS NULL OR sube = @sube)
  AND (@q IS NULL OR ad_soyad LIKE N'%' + @q + N'%' OR personel_kodu = @q)
ORDER BY CASE WHEN durum = N'ik' THEN 0 ELSE 1 END, id DESC",
            new { durumlar, bas, bit, sube = string.IsNullOrWhiteSpace(sube) ? null : sube.Trim(), q }).ToList();

        var kodlar = l.Select(x => ((string)x.personel_kodu).Trim()).SelectMany(KodBicimleri).Distinct().ToArray();
        var bakiyeler = kodlar.Length == 0 ? new() : Bakiyeler(db, kodlar);

        var sayilar = db.Query<(string d, int n)>("SELECT durum, COUNT(*) FROM KRY_DENKLESTIRME GROUP BY durum")
            .ToDictionary(x => x.d, x => x.n);
        var buAy = db.ExecuteScalar<int>(@"SELECT COUNT(*) FROM KRY_DENKLESTIRME WHERE durum = N'onaylandi'
AND ik_tarih >= DATEADD(DAY, 1 - DAY(GETDATE()), CAST(GETDATE() AS DATE))");
        var subeler = db.Query<string>("SELECT DISTINCT sube FROM KRY_DENKLESTIRME WHERE sube IS NOT NULL ORDER BY sube").ToList();

        return Ok(new
        {
            kayitlar = l.Select(x => new
            {
                kayit = KayitNesne(x),
                bakiye = BakiyeNesne(bakiyeler.GetValueOrDefault(K((string)x.personel_kodu)) ?? new Bakiye(0, 0, 0, 0)),
            }),
            sayilar = new
            {
                ik = sayilar.GetValueOrDefault(DIk),
                yonetici = sayilar.GetValueOrDefault(DYonetici),
                imza = sayilar.GetValueOrDefault(DImza),
                onaylandi = sayilar.GetValueOrDefault(DOnay),
                reddedildi = sayilar.GetValueOrDefault(DRed),
                buAy,
            },
            subeler,
        });
    }

    /// <summary>Kişinin bakiyesi ve bütün hareketleri (formlar + fazla mesai izinleri).</summary>
    [HttpGet("Bakiye/{kod}")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult KisiBakiye(string kod)
    {
        using var db = _vt.Baglanti();
        var formlar = db.Query("SELECT * FROM KRY_DENKLESTIRME WHERE personel_kodu IN @kodlar AND durum <> N'iptal' ORDER BY id DESC",
            new { kodlar = KodBicimleri(kod) }).ToList();
        var fm = FazlaMesaiIzinleri(db, KodBicimleri(kod)).OrderByDescending(x => x.Tarih).ToList();
        var kisi = _ekip.Kisi(kod);
        return Ok(new
        {
            kod = K(kod),
            adSoyad = kisi is null ? (string)formlar.FirstOrDefault()?.ad_soyad : Ad(kisi),
            gorev = kisi?.Pozisyon,
            sube = kisi?.IsGrubu,
            bakiye = BakiyeNesne(KisiBakiyesi(db, kod)),
            formlar = formlar.Select(KayitNesne),
            fazlaMesai = fm.Select(HareketNesne),
        });
    }

    /// <summary>Bakiyesi olan herkes (alacak ya da borç).</summary>
    [HttpGet("Bakiyeler")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult TumBakiyeler()
    {
        using var db = _vt.Baglanti();
        var b = Bakiyeler(db, null);
        var l = b.Where(x => x.Value.AlacakDk != 0 || x.Value.BorcDk != 0 || x.Value.Bekleyen > 0).Select(x =>
        {
            var p = _ekip.Kisi(x.Key);
            return new
            {
                kod = x.Key,
                adSoyad = p is null ? x.Key : Ad(p),
                gorev = p?.Pozisyon,
                sube = p?.IsGrubu,
                aktif = p is not null,
                alacakDk = x.Value.AlacakDk,
                borcDk = x.Value.BorcDk,
                netDk = x.Value.NetDk,
                bekleyen = x.Value.Bekleyen,
            };
        }).OrderByDescending(x => Math.Abs(x.netDk)).ToList();
        return Ok(new
        {
            kisiler = l,
            toplamAlacakDk = l.Where(x => x.netDk > 0).Sum(x => x.netDk),
            borclu = l.Count(x => x.netDk < 0),
        });
    }

    /// <summary>İK kararı: onaylanınca bakiyeye işlenir. Admin / GMY yönetici aşamasını da geçebilir.</summary>
    [HttpPost("{id:int}/Karar")]
    [Authorize(Roles = PanelRolleri)]
    public async Task<IActionResult> Karar(int id, [FromBody] KararGirdisi g)
    {
        using var db = _vt.Baglanti();
        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_DENKLESTIRME WHERE id = @id", new { id });
        if (x is null) return NotFound(new { hata = "Form bulunamadı." });
        var d = (string)x.durum;
        var ustRol = Rol is Roller.Admin or Roller.GenelMudurYardimcisi;
        if (!(d == DIk || (ustRol && d is DYonetici or DImza)))
            return BadRequest(new { hata = d == DYonetici ? "Form yönetici onayında." : d == DImza ? "İmzalı form henüz yüklenmedi." : "Form sonuçlanmış." });

        var not = (g?.Not ?? "").Trim();
        if (not.Length > 500) not = not[..500];
        if (g?.Onay != true && not.Length < 3) return BadRequest(new { hata = "Red nedenini yazınız." });

        var adSoyad = db.ExecuteScalar<string>("SELECT ad_soyad FROM KRY_KULLANICILAR WHERE kullanici_adi = @k", new { k = Kullanici }) ?? Kullanici;
        db.Execute(@"UPDATE KRY_DENKLESTIRME SET durum = @durum, ik_kullanici = @k, ik_ad = @ad, ik_tarih = SYSDATETIME(), ik_not = @not,
red_nedeni = CASE WHEN @durum = N'reddedildi' THEN @not ELSE red_nedeni END WHERE id = @id",
            new { id, durum = g!.Onay ? DOnay : DRed, k = Kullanici, ad = adSoyad, not = not.Length == 0 ? null : not });

        var etki = (int)x.etki_dk;
        await _bildirim.Gonder(((string)x.personel_kodu).Trim(),
            g.Onay ? "Denkleştirme formunuz onaylandı" : "Denkleştirme formunuz reddedildi",
            g.Onay ? $"{(DateTime)x.tarih:dd.MM} · bakiyenize {Isaretli(etki)} işlendi." : $"{(DateTime)x.tarih:dd.MM} · {not}",
            "denklestirme");

        return Ok(new { tamam = true });
    }
}

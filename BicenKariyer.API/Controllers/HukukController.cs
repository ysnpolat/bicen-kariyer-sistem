using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Hukuk masası (24.10.2026)
/// ---------------------------------------------------------------------------
/// <para>
/// İK ile ilgili dava, arabuluculuk ve ihtarname dosyaları; duruşma ve kesin
/// süreler; belgeler; resmi yazışma (e-posta gibi, kayıt numaralı). İç ekip
/// (İK hukuk) ile dışarıdan danışmanlık alınan avukatlar aynı dosyada çalışır.
/// </para>
/// <para>
/// Kimlikler: panel kullanıcısı "u:kullanıcı", personel "p:sicil" (panel
/// hesabı varsa "u:"), dış danışman "hd:kullanıcı". Danışman yalnız
/// kendisine erişim verilen dosyaları ve muhatabı olduğu yazıları görür;
/// danışman jetonu Hukuk dışındaki hiçbir uca giremez (Program.cs).
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public partial class HukukController : ControllerBase
{
    public const string DanismanRolu = "HukukDanisman";
    public const string DanismanOnek = "hd:";
    public const string EkipKutusu = "ekip";

    private static readonly CultureInfo Tr = new("tr-TR");

    public static readonly Dictionary<string, string> Turler = new()
    {
        ["ise_iade"] = "İşe iade",
        ["alacak"] = "İşçilik alacağı",
        ["is_kazasi"] = "İş kazası",
        ["arabuluculuk"] = "Arabuluculuk",
        ["ihtarname"] = "İhtarname",
        ["tespit"] = "Tespit / diğer dava",
        ["diger"] = "Diğer",
    };

    public static readonly Dictionary<string, string> OlayTurleri = new()
    {
        ["durusma"] = "Duruşma",
        ["kesin_sure"] = "Kesin süre",
        ["arabuluculuk"] = "Arabuluculuk toplantısı",
        ["sure"] = "Süre",
        ["surec"] = "Süreç kaydı",
    };

    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly JwtServisi _jwt;
    private readonly SmsServisi _sms;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<HukukController> _kayit;

    public HukukController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim, JwtServisi jwt, SmsServisi sms,
        IWebHostEnvironment ortam, ILogger<HukukController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _jwt = jwt;
        _sms = sms;
        _ortam = ortam;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /* ==================================================================== */
    /* Kimlik ve yetki                                                       */
    /* ==================================================================== */

    /// <summary>tam: her şey · okuma: her şeyi görür, değiştiremez · danisman: erişim verilen dosyalar</summary>
    public sealed record Kimlik(string Anahtar, string Ad, string Kurum, string Tur, string Yetki, string Sicil);

    private Kimlik _ben;
    private bool _benOkundu;

    private Kimlik Ben(System.Data.IDbConnection db)
    {
        if (_benOkundu) return _ben;
        _benOkundu = true;
        _ben = BenCoz(db);
        return _ben;
    }

    private Kimlik BenCoz(System.Data.IDbConnection db)
    {
        var ad = User?.Identity?.Name ?? "";
        var rol = User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
        var adSoyad = User?.FindFirst("adSoyad")?.Value;

        if (rol == DanismanRolu && ad.StartsWith(DanismanOnek))
        {
            var d = db.QueryFirstOrDefault("SELECT ad_soyad, unvan, kurum, aktif FROM KRY_HUK_DANISMAN WHERE kullanici_adi = @k",
                new { k = ad[DanismanOnek.Length..] });
            if (d is null || !(bool)d.aktif) return null;
            var tam = string.IsNullOrWhiteSpace((string)d.unvan) ? (string)d.ad_soyad : $"{(string)d.unvan} {(string)d.ad_soyad}";
            return new Kimlik(ad, tam, (string)d.kurum, "danisman", "danisman", null);
        }

        string anahtar, sicil = null;
        if (ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
        {
            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');
            sicil = (i < 0 ? govde : govde[..i]).Trim();
            var hesap = db.Query("SELECT kullanici_adi AS k, sicil FROM KRY_KULLANICILAR WHERE aktif = 1 AND sicil IS NOT NULL")
                .FirstOrDefault(x => K((string)x.sicil) == K(sicil));
            anahtar = hesap is not null ? "u:" + ((string)hesap.k).Trim() : "p:" + K(sicil);
            var p = _ekip.Kisi(sicil);
            adSoyad = p is null ? sicil : $"{p.Ad} {p.Soyad}".Trim();
        }
        else
        {
            anahtar = "u:" + ad.Trim();
            sicil = db.ExecuteScalar<string>("SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi = @ad", new { ad });
        }

        var ekipRol = db.ExecuteScalar<string>("SELECT rol FROM KRY_HUK_EKIP WHERE anahtar = @anahtar", new { anahtar })
                      ?? (sicil is null ? null : db.ExecuteScalar<string>("SELECT rol FROM KRY_HUK_EKIP WHERE anahtar = @a", new { a = "p:" + K(sicil) }));
        var yonetici = Roller.Temel(rol) is Roller.Admin or Roller.IKYoneticisi or Roller.GenelMudurYardimcisi;
        var yetki = yonetici || ekipRol == "hukuk" ? "tam" : ekipRol == "okuma" ? "okuma" : null;
        if (yetki is null) return null;
        return new Kimlik(anahtar, adSoyad ?? ad, "Biçen · İnsan Kaynakları", "ic", yetki, sicil);
    }

    /// <summary>Kişinin bu dosyadaki hakkı: tam / standart / okuma; erişimi yoksa null.</summary>
    private string DosyaHakki(System.Data.IDbConnection db, Kimlik ben, int dosyaId)
    {
        if (ben is null) return null;
        if (ben.Yetki == "tam") return "tam";
        if (ben.Yetki == "okuma") return "okuma";
        return db.ExecuteScalar<string>("SELECT hak FROM KRY_HUK_ERISIM WHERE dosya_id = @dosyaId AND anahtar = @a",
            new { dosyaId, a = ben.Anahtar });
    }

    private int[] ErisilenDosyalar(System.Data.IDbConnection db, Kimlik ben) =>
        db.Query<int>("SELECT dosya_id FROM KRY_HUK_ERISIM WHERE anahtar = @a", new { a = ben.Anahtar }).ToArray();

    private void Logla(System.Data.IDbConnection db, Kimlik ben, string islem, int? dosyaId, string hedef = null)
    {
        try
        {
            db.Execute("INSERT INTO KRY_HUK_LOG (anahtar, ad, islem, dosya_id, hedef, ip) VALUES (@a, @ad, @islem, @dosyaId, @hedef, @ip)",
                new { a = ben?.Anahtar, ad = ben?.Ad, islem, dosyaId, hedef = hedef is { Length: > 300 } ? hedef[..300] : hedef, ip = IstemciAdresi.Bul(HttpContext) });
        }
        catch (Exception h) { _kayit.LogWarning(h, "Hukuk günlüğü yazılamadı"); }
    }

    private IActionResult Yasak() => StatusCode(403, new { hata = "Hukuk masasına erişiminiz yok." });

    /// <summary>Oturumdaki kişi ve yetkisi; panel menüsü ve mobil görünüm buna göre açılır.</summary>
    [HttpGet("Ben")]
    public IActionResult BenGetir()
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Ok(new { yetkili = false });
        return Ok(new
        {
            yetkili = true,
            anahtar = ben.Anahtar,
            ad = ben.Ad,
            kurum = ben.Kurum,
            tur = ben.Tur,
            yetki = ben.Yetki,
            danisman = ben.Tur == "danisman",
            turler = Turler.Select(x => new { kod = x.Key, ad = x.Value }),
            olayTurleri = OlayTurleri.Select(x => new { kod = x.Key, ad = x.Value }),
        });
    }

    /* ==================================================================== */
    /* Dosyalar                                                              */
    /* ==================================================================== */

    private object DosyaNesne(dynamic x, bool tutarGorur, dynamic sonraki = null) => new
    {
        id = (int)x.id,
        dosyaNo = (string)x.dosya_no,
        tur = (string)x.tur,
        turAdi = Turler.GetValueOrDefault((string)x.tur, (string)x.tur),
        davaciAd = (string)x.davaci_ad,
        davaciSicil = (string)x.davaci_sicil,
        gorev = (string)x.gorev,
        sube = (string)x.sube,
        mahkeme = (string)x.mahkeme,
        esasNo = (string)x.esas_no,
        karsiVekil = (string)x.karsi_vekil,
        davaTarihi = (DateTime?)x.dava_tarihi,
        tebligTarihi = (DateTime?)x.teblig_tarihi,
        asama = (string)x.asama,
        risk = Convert.ToInt32(x.risk),
        talepTutar = tutarGorur ? (decimal?)x.talep_tutar : null,
        tutarGizli = !tutarGorur && x.talep_tutar != null,
        ozet = (string)x.ozet,
        durum = (string)x.durum,
        sonuc = (string)x.sonuc,
        kapanisTarihi = (DateTime?)x.kapanis_tarihi,
        olusturma = (DateTime)x.olusturma,
        sonraki = sonraki is null ? null : new
        {
            id = (int)sonraki.id,
            tur = (string)sonraki.tur,
            turAdi = OlayTurleri.GetValueOrDefault((string)sonraki.tur, (string)sonraki.tur),
            tarih = (DateTime)sonraki.tarih,
            baslik = (string)sonraki.baslik,
        },
    };

    [HttpGet("Dosyalar")]
    public IActionResult Dosyalar([FromQuery] string durum = "acik", [FromQuery] string q = null, [FromQuery] string tur = null)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();

        var izinli = ben.Yetki == "danisman" ? ErisilenDosyalar(db, ben) : null;
        if (izinli is { Length: 0 }) return Ok(new { dosyalar = Array.Empty<object>(), sayilar = new { acik = 0, kapandi = 0 } });

        q = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        var l = db.Query(@"
SELECT * FROM KRY_HUK_DOSYA
WHERE (@hepsi = 1 OR id IN @izinli)
  AND (@durum = N'hepsi' OR durum = @durum)
  AND (@tur IS NULL OR tur = @tur)
  AND (@q IS NULL OR davaci_ad LIKE N'%' + @q + N'%' OR esas_no LIKE N'%' + @q + N'%' OR mahkeme LIKE N'%' + @q + N'%'
       OR dosya_no LIKE N'%' + @q + N'%' OR sube LIKE N'%' + @q + N'%')
ORDER BY id DESC",
            new { hepsi = izinli is null ? 1 : 0, izinli = izinli ?? new[] { 0 }, durum = durum ?? "acik", tur = string.IsNullOrWhiteSpace(tur) ? null : tur, q }).ToList();

        var idler = l.Select(x => (int)x.id).ToArray();
        var sonrakiler = idler.Length == 0 ? new Dictionary<int, dynamic>() : db.Query(@"
SELECT o.* FROM KRY_HUK_OLAY o
WHERE o.dosya_id IN @idler AND o.tamam = 0 AND o.tur <> N'surec' AND o.tarih >= CAST(GETDATE() AS DATE)", new { idler })
            .GroupBy(x => (int)x.dosya_id).ToDictionary(g => g.Key, g => g.OrderBy(x => (DateTime)x.tarih).First());
        var ekip = idler.Length == 0 ? new List<dynamic>() : db.Query(@"
SELECT e.dosya_id, d.ad_soyad, d.unvan FROM KRY_HUK_ERISIM e JOIN KRY_HUK_DANISMAN d ON N'hd:' + d.kullanici_adi = e.anahtar
WHERE e.dosya_id IN @idler", new { idler }).ToList();

        var tutar = ben.Yetki == "tam";
        var sayilar = db.Query<(string d, int n)>(@"SELECT durum, COUNT(*) FROM KRY_HUK_DOSYA
WHERE (@hepsi = 1 OR id IN @izinli) GROUP BY durum", new { hepsi = izinli is null ? 1 : 0, izinli = izinli ?? new[] { 0 } })
            .ToDictionary(x => x.d, x => x.n);

        var dosyalar = l.Select(x =>
        {
            sonrakiler.TryGetValue((int)x.id, out var s);
            return new
            {
                dosya = DosyaNesne(x, tutar, s),
                vekiller = ekip.Where(e => (int)e.dosya_id == (int)x.id)
                    .Select(e => string.IsNullOrWhiteSpace((string)e.unvan) ? (string)e.ad_soyad : $"{(string)e.unvan} {(string)e.ad_soyad}").ToList(),
            };
        })
            /* Sıradaki işi en yakın olan önde; işi olmayanlar sonra */
            .OrderBy(x => ((dynamic)x.dosya).sonraki is null ? 1 : 0)
            .ThenBy(x => ((dynamic)x.dosya).sonraki?.tarih ?? DateTime.MaxValue)
            .ToList();

        return Ok(new { dosyalar, sayilar = new { acik = sayilar.GetValueOrDefault("acik"), kapandi = sayilar.GetValueOrDefault("kapandi") } });
    }

    [HttpGet("Dosya/{id:int}")]
    public IActionResult Dosya(int id)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        var hak = DosyaHakki(db, ben, id);
        if (hak is null) return NotFound(new { hata = "Dosya bulunamadı." });

        var x = db.QueryFirstOrDefault("SELECT * FROM KRY_HUK_DOSYA WHERE id = @id", new { id });
        if (x is null) return NotFound(new { hata = "Dosya bulunamadı." });
        Logla(db, ben, "dosya_ac", id);

        var olaylar = db.Query("SELECT * FROM KRY_HUK_OLAY WHERE dosya_id = @id ORDER BY tarih", new { id })
            .Select(o => new
            {
                id = (int)o.id, tur = (string)o.tur, turAdi = OlayTurleri.GetValueOrDefault((string)o.tur, (string)o.tur),
                tarih = (DateTime)o.tarih, baslik = (string)o.baslik, aciklama = (string)o.aciklama, tamam = (bool)o.tamam,
                ekleyenAd = (string)o.ekleyen_ad,
            }).ToList();
        var belgeler = db.Query("SELECT * FROM KRY_HUK_BELGE WHERE dosya_id = @id AND silindi = 0 ORDER BY id DESC", new { id })
            .Select(BelgeNesne).ToList();
        var yazilar = YaziListesi(db, ben, dosyaId: id);

        var erisim = db.Query(@"
SELECT e.anahtar, e.hak, d.ad_soyad, d.unvan, d.kurum FROM KRY_HUK_ERISIM e
LEFT JOIN KRY_HUK_DANISMAN d ON N'hd:' + d.kullanici_adi = e.anahtar
WHERE e.dosya_id = @id", new { id })
            .Select(e => new
            {
                anahtar = (string)e.anahtar, hak = (string)e.hak,
                ad = string.IsNullOrWhiteSpace((string)e.unvan) ? (string)e.ad_soyad ?? (string)e.anahtar : $"{(string)e.unvan} {(string)e.ad_soyad}",
                kurum = (string)e.kurum,
            }).ToList();

        object ik = null;
        if (hak == "tam" && !string.IsNullOrWhiteSpace((string)x.davaci_sicil))
        {
            var p = _ekip.Aktifler().FirstOrDefault(k => K(k.PersonelKodu) == K((string)x.davaci_sicil));
            ik = p is null ? new { aktif = false } : new
            {
                aktif = true, pozisyon = p.Pozisyon, sube = p.IsGrubu, giris = p.GirisTarihi,
            };
        }

        return Ok(new
        {
            hak,
            dosya = DosyaNesne(x, hak == "tam"),
            olaylar,
            belgeler,
            yazilar,
            erisim = ben.Yetki == "danisman" ? null : erisim,
            ik,
        });
    }

    public sealed class DosyaGirdisi
    {
        public string Tur { get; set; }
        public string DavaciAd { get; set; }
        public string DavaciSicil { get; set; }
        public string Gorev { get; set; }
        public string Sube { get; set; }
        public string Mahkeme { get; set; }
        public string EsasNo { get; set; }
        public string KarsiVekil { get; set; }
        public DateTime? DavaTarihi { get; set; }
        public DateTime? TebligTarihi { get; set; }
        public string Asama { get; set; }
        public int Risk { get; set; } = 1;
        public decimal? TalepTutar { get; set; }
        public string Ozet { get; set; }
    }

    private static string Kirp(string s, int n)
    {
        s = (s ?? "").Trim();
        return s.Length == 0 ? null : s.Length > n ? s[..n] : s;
    }

    /// <summary>Yeni dosya (id yoksa) ya da güncelleme. Danışman "tam" hakla dosyayı düzenleyebilir, açamaz.</summary>
    [HttpPost("Dosya")]
    [HttpPost("Dosya/{id:int}")]
    public IActionResult DosyaKaydet(int? id, [FromBody] DosyaGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        if (g is null || !Turler.ContainsKey(g.Tur ?? "")) return BadRequest(new { hata = "Dosya türünü seçiniz." });
        var davaci = Kirp(g.DavaciAd, 150);
        if (davaci is null) return BadRequest(new { hata = "Davacı / karşı taraf adını yazınız." });

        if (!string.IsNullOrWhiteSpace(g.DavaciSicil) && (g.Gorev is null || g.Sube is null))
        {
            var p = _ekip.Aktifler().FirstOrDefault(k => K(k.PersonelKodu) == K(g.DavaciSicil));
            g.Gorev ??= p?.Pozisyon;
            g.Sube ??= p?.IsGrubu;
        }

        var p2 = new
        {
            tur = g.Tur, davaci, sicil = Kirp(g.DavaciSicil, 30), gorev = Kirp(g.Gorev, 120), sube = Kirp(g.Sube, 120),
            mahkeme = Kirp(g.Mahkeme, 200), esas = Kirp(g.EsasNo, 60), vekil = Kirp(g.KarsiVekil, 200),
            dava = g.DavaTarihi?.Date, teblig = g.TebligTarihi?.Date, asama = Kirp(g.Asama, 120),
            risk = Math.Clamp(g.Risk, 0, 3), tutar = g.TalepTutar, ozet = Kirp(g.Ozet, 2000), kim = ben.Anahtar,
        };

        if (id is null)
        {
            if (ben.Yetki != "tam") return StatusCode(403, new { hata = "Yeni dosyayı İK hukuk açar." });
            if (db.State != System.Data.ConnectionState.Open) db.Open();
            using var tx = db.BeginTransaction();
            var yil = DateTime.Today.Year;
            var son = db.ExecuteScalar<int?>(@"SELECT MAX(CAST(SUBSTRING(dosya_no, 8, 10) AS INT)) FROM KRY_HUK_DOSYA WITH (UPDLOCK, HOLDLOCK)
WHERE dosya_no LIKE @onek", new { onek = $"H-{yil}-%" }, tx) ?? 0;
            var no = $"H-{yil}-{son + 1:000}";
            var yeni = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HUK_DOSYA (dosya_no, tur, davaci_ad, davaci_sicil, gorev, sube, mahkeme, esas_no, karsi_vekil, dava_tarihi,
    teblig_tarihi, asama, risk, talep_tutar, ozet, olusturan)
OUTPUT INSERTED.id
VALUES (@no, @tur, @davaci, @sicil, @gorev, @sube, @mahkeme, @esas, @vekil, @dava, @teblig, @asama, @risk, @tutar, @ozet, @kim)",
                new { no, p2.tur, p2.davaci, p2.sicil, p2.gorev, p2.sube, p2.mahkeme, p2.esas, p2.vekil, p2.dava, p2.teblig, p2.asama, p2.risk, p2.tutar, p2.ozet, p2.kim }, tx);
            tx.Commit();
            Logla(db, ben, "dosya_ac_yeni", yeni, no);
            return Ok(new { id = yeni, dosyaNo = no });
        }

        var hak = DosyaHakki(db, ben, id.Value);
        if (hak is not "tam") return StatusCode(403, new { hata = "Bu dosyayı düzenleme yetkiniz yok." });
        /* Tutarı göremeyen (danışman) kaydederse mevcut tutar korunur */
        db.Execute(@"
UPDATE KRY_HUK_DOSYA SET tur = @tur, davaci_ad = @davaci, davaci_sicil = @sicil, gorev = @gorev, sube = @sube, mahkeme = @mahkeme,
    esas_no = @esas, karsi_vekil = @vekil, dava_tarihi = @dava, teblig_tarihi = @teblig, asama = @asama, risk = @risk,
    talep_tutar = CASE WHEN @tutarGorur = 1 THEN @tutar ELSE talep_tutar END, ozet = @ozet, guncelleme = SYSDATETIME()
WHERE id = @id",
            new { id, p2.tur, p2.davaci, p2.sicil, p2.gorev, p2.sube, p2.mahkeme, p2.esas, p2.vekil, p2.dava, p2.teblig, p2.asama, p2.risk, p2.tutar, p2.ozet,
                  tutarGorur = ben.Yetki == "tam" ? 1 : 0 });
        Logla(db, ben, "dosya_guncelle", id);
        return Ok(new { id });
    }

    public sealed class KapatGirdisi
    {
        public bool Kapat { get; set; } = true;
        public string Sonuc { get; set; }
    }

    [HttpPost("Dosya/{id:int}/Durum")]
    public IActionResult DosyaDurum(int id, [FromBody] KapatGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben?.Yetki != "tam") return StatusCode(403, new { hata = "Dosyayı İK hukuk kapatır." });
        db.Execute(@"UPDATE KRY_HUK_DOSYA SET durum = @d, sonuc = @s, kapanis_tarihi = CASE WHEN @d = N'kapandi' THEN CAST(GETDATE() AS DATE) END,
guncelleme = SYSDATETIME() WHERE id = @id", new { id, d = g?.Kapat != false ? "kapandi" : "acik", s = Kirp(g?.Sonuc, 500) });
        Logla(db, ben, g?.Kapat != false ? "dosya_kapat" : "dosya_yeniden_ac", id, g?.Sonuc);
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Süreler, duruşmalar, süreç kayıtları                                  */
    /* ==================================================================== */

    public sealed class OlayGirdisi
    {
        public string Tur { get; set; }
        public DateTime Tarih { get; set; }
        public string Baslik { get; set; }
        public string Aciklama { get; set; }
        public bool Tamam { get; set; }
    }

    [HttpPost("Dosya/{id:int}/Olay")]
    public IActionResult OlayEkle(int id, [FromBody] OlayGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        var hak = DosyaHakki(db, ben, id);
        if (hak is not ("tam" or "standart")) return StatusCode(403, new { hata = "Bu dosyaya kayıt ekleyemezsiniz." });
        if (g is null || !OlayTurleri.ContainsKey(g.Tur ?? "")) return BadRequest(new { hata = "Türü seçiniz." });
        var baslik = Kirp(g.Baslik, 200) ?? OlayTurleri[g.Tur];
        if (g.Tarih.Year < 2000) return BadRequest(new { hata = "Tarihi giriniz." });
        var oid = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HUK_OLAY (dosya_id, tur, tarih, baslik, aciklama, tamam, ekleyen, ekleyen_ad)
OUTPUT INSERTED.id VALUES (@id, @tur, @tarih, @baslik, @aciklama, @tamam, @kim, @ad)",
            new { id, tur = g.Tur, tarih = g.Tarih, baslik, aciklama = Kirp(g.Aciklama, 1000), tamam = g.Tamam || g.Tur == "surec", kim = ben.Anahtar, ad = ben.Ad });
        Logla(db, ben, "olay_ekle", id, $"{OlayTurleri[g.Tur]} · {g.Tarih:dd.MM.yyyy HH:mm} · {baslik}");
        return Ok(new { id = oid });
    }

    [HttpPost("Olay/{oid:int}")]
    public IActionResult OlayGuncelle(int oid, [FromBody] OlayGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        var o = db.QueryFirstOrDefault("SELECT dosya_id FROM KRY_HUK_OLAY WHERE id = @oid", new { oid });
        if (o is null) return NotFound();
        var hak = DosyaHakki(db, ben, (int)o.dosya_id);
        if (hak is not ("tam" or "standart")) return StatusCode(403, new { hata = "Yetkiniz yok." });
        if (g is null || !OlayTurleri.ContainsKey(g.Tur ?? "")) return BadRequest(new { hata = "Türü seçiniz." });
        db.Execute("UPDATE KRY_HUK_OLAY SET tur = @Tur, tarih = @Tarih, baslik = @baslik, aciklama = @aciklama, tamam = @Tamam WHERE id = @oid",
            new { oid, g.Tur, g.Tarih, baslik = Kirp(g.Baslik, 200) ?? OlayTurleri[g.Tur], aciklama = Kirp(g.Aciklama, 1000), g.Tamam });
        Logla(db, ben, "olay_guncelle", (int)o.dosya_id, g.Baslik);
        return Ok(new { tamam = true });
    }

    [HttpDelete("Olay/{oid:int}")]
    public IActionResult OlaySil(int oid)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        var o = db.QueryFirstOrDefault("SELECT dosya_id, baslik FROM KRY_HUK_OLAY WHERE id = @oid", new { oid });
        if (o is null) return NotFound();
        if (DosyaHakki(db, ben, (int)o.dosya_id) != "tam") return StatusCode(403, new { hata = "Yetkiniz yok." });
        db.Execute("DELETE FROM KRY_HUK_OLAY WHERE id = @oid", new { oid });
        Logla(db, ben, "olay_sil", (int)o.dosya_id, (string)o.baslik);
        return Ok(new { tamam = true });
    }

    /// <summary>Ajanda: tarih aralığındaki duruşma, süre ve yazı cevap süreleri (yalnız erişilen dosyalar).</summary>
    [HttpGet("Ajanda")]
    public IActionResult Ajanda([FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        var b = (bas ?? DateTime.Today.AddDays(-1)).Date;
        var e = (bit ?? b.AddDays(45)).Date.AddDays(1);
        var izinli = ben.Yetki == "danisman" ? ErisilenDosyalar(db, ben) : null;

        var olaylar = db.Query(@"
SELECT o.id, o.dosya_id, o.tur, o.tarih, o.baslik, o.aciklama, o.tamam, d.dosya_no, d.davaci_ad, d.esas_no, d.mahkeme, d.tur AS dosyaTur
FROM KRY_HUK_OLAY o JOIN KRY_HUK_DOSYA d ON d.id = o.dosya_id
WHERE o.tur <> N'surec' AND o.tarih >= @b AND o.tarih < @e AND d.durum = N'acik'
  AND (@hepsi = 1 OR o.dosya_id IN @izinli)
ORDER BY o.tarih", new { b, e, hepsi = izinli is null ? 1 : 0, izinli = izinli is { Length: > 0 } ? izinli : new[] { 0 } })
            .Select(o => new
            {
                kaynak = "olay", id = (int)o.id, dosyaId = (int)o.dosya_id, tur = (string)o.tur,
                turAdi = OlayTurleri.GetValueOrDefault((string)o.tur, (string)o.tur),
                tarih = (DateTime)o.tarih, baslik = (string)o.baslik, aciklama = (string)o.aciklama, tamam = (bool)o.tamam,
                dosyaNo = (string)o.dosya_no, davaciAd = (string)o.davaci_ad, esasNo = (string)o.esas_no, mahkeme = (string)o.mahkeme,
                dosyaTurAdi = Turler.GetValueOrDefault((string)o.dosyaTur, (string)o.dosyaTur),
            }).ToList<object>();

        /* Cevap süresi olan, yanıtlanmamış yazılar (kişinin kutusundakiler) */
        var kutu = KutuAnahtarlari(ben);
        var yazilar = db.Query(@"
SELECT y.id, y.kayit_no, y.konu, y.cevap_suresi, y.dosya_id, d.dosya_no, d.davaci_ad
FROM KRY_HUK_YAZI y LEFT JOIN KRY_HUK_DOSYA d ON d.id = y.dosya_id
WHERE y.cevap_suresi >= @b AND y.cevap_suresi < @e
  AND EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.rol IN (N'kime', N'bilgi'))
  AND NOT EXISTS (SELECT 1 FROM KRY_HUK_YAZI c WHERE c.yanit_id = y.id)", new { b, e, kutu })
            .Select(y => (object)new
            {
                kaynak = "yazi", id = (int)y.id, dosyaId = (int?)y.dosya_id, tur = "yazi", turAdi = "Yazı cevabı",
                tarih = (DateTime)y.cevap_suresi, baslik = $"Cevap: {(string)y.konu}", aciklama = (string)y.kayit_no, tamam = false,
                dosyaNo = (string)y.dosya_no, davaciAd = (string)y.davaci_ad, esasNo = (string)null, mahkeme = (string)null, dosyaTurAdi = (string)null,
            }).ToList();

        return Ok(new { olaylar = olaylar.Concat(yazilar).OrderBy(x => ((dynamic)x).tarih).ToList() });
    }

    /// <summary>Hukuk masası: özet sayılar, bu haftanın işleri, dosyalar ve yanıt bekleyen yazılar.</summary>
    [HttpGet("Masa")]
    public IActionResult Masa()
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        var izinli = ben.Yetki == "danisman" ? ErisilenDosyalar(db, ben) : null;
        var iz = new { hepsi = izinli is null ? 1 : 0, izinli = izinli is { Length: > 0 } ? izinli : new[] { 0 } };

        var turSay = db.Query<(string t, int n)>(@"SELECT tur, COUNT(*) FROM KRY_HUK_DOSYA WHERE durum = N'acik' AND (@hepsi = 1 OR id IN @izinli) GROUP BY tur", iz).ToList();
        var bugun = DateTime.Today;
        var hafta = db.ExecuteScalar<int>(@"SELECT COUNT(*) FROM KRY_HUK_OLAY o JOIN KRY_HUK_DOSYA d ON d.id = o.dosya_id
WHERE o.tamam = 0 AND o.tur <> N'surec' AND d.durum = N'acik' AND o.tarih >= @b AND o.tarih < @e AND (@hepsi = 1 OR o.dosya_id IN @izinli)",
            new { b = bugun, e = bugun.AddDays(7), iz.hepsi, iz.izinli });
        var bugunSay = db.ExecuteScalar<int>(@"SELECT COUNT(*) FROM KRY_HUK_OLAY o JOIN KRY_HUK_DOSYA d ON d.id = o.dosya_id
WHERE o.tamam = 0 AND o.tur <> N'surec' AND d.durum = N'acik' AND o.tarih >= @b AND o.tarih < @e AND (@hepsi = 1 OR o.dosya_id IN @izinli)",
            new { b = bugun, e = bugun.AddDays(1), iz.hepsi, iz.izinli });
        var kesinBugun = db.ExecuteScalar<int>(@"SELECT COUNT(*) FROM KRY_HUK_OLAY o JOIN KRY_HUK_DOSYA d ON d.id = o.dosya_id
WHERE o.tamam = 0 AND o.tur = N'kesin_sure' AND d.durum = N'acik' AND o.tarih >= @b AND o.tarih < @e AND (@hepsi = 1 OR o.dosya_id IN @izinli)",
            new { b = bugun, e = bugun.AddDays(1), iz.hepsi, iz.izinli });
        var yil = db.Query<(string s, int n)>(@"SELECT ISNULL(sonuc, N''), COUNT(*) FROM KRY_HUK_DOSYA
WHERE durum = N'kapandi' AND kapanis_tarihi >= @y AND (@hepsi = 1 OR id IN @izinli) GROUP BY ISNULL(sonuc, N'')",
            new { y = new DateTime(bugun.Year, 1, 1), iz.hepsi, iz.izinli }).ToList();

        var kutu = KutuAnahtarlari(ben);
        var bekleyen = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_HUK_YAZI y
WHERE y.cevap_suresi IS NOT NULL AND NOT EXISTS (SELECT 1 FROM KRY_HUK_YAZI c WHERE c.yanit_id = y.id)
  AND EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.rol IN (N'kime', N'bilgi') AND k.arsiv = 0)", new { kutu });
        var okunmamis = db.ExecuteScalar<int>(@"
SELECT COUNT(DISTINCT k.yazi_id) FROM KRY_HUK_YAZI_KUTU k
WHERE k.anahtar IN @kutu AND k.rol IN (N'kime', N'bilgi') AND k.okundu IS NULL AND k.arsiv = 0", new { kutu });

        return Ok(new
        {
            ben = new { ben.Ad, ben.Yetki, danisman = ben.Tur == "danisman" },
            acik = turSay.Sum(x => x.n),
            turler = turSay.Select(x => new { tur = x.t, ad = Turler.GetValueOrDefault(x.t, x.t), adet = x.n }),
            hafta,
            bugun = bugunSay,
            kesinBugun,
            arabuluculuk = turSay.Where(x => x.t == "arabuluculuk").Sum(x => x.n),
            yanitBekleyen = bekleyen,
            okunmamis,
            buYilSonuclanan = yil.Sum(x => x.n),
            buYilLehe = yil.Where(x => x.s is "lehe" or "sulh" or "feragat").Sum(x => x.n),
        });
    }

    /* ==================================================================== */
    /* Belgeler                                                              */
    /* ==================================================================== */

    private object BelgeNesne(dynamic b) => new
    {
        id = (int)b.id, ad = (string)b.ad, tur = (string)b.icerik_turu, boyut = (long)b.boyut,
        uzanti = Path.GetExtension((string)b.ad ?? "").TrimStart('.').ToUpperInvariant(),
        yukleyenAd = (string)b.yukleyen_ad, tarih = (DateTime)b.olusturma, yaziId = (int?)b.yazi_id, dosyaId = (int?)b.dosya_id,
    };

    private string Klasor(string alt)
    {
        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath) ? AppContext.BaseDirectory : _ortam.ContentRootPath;
        var k = Path.Combine(kok, "hukuk", alt);
        if (!Directory.Exists(k)) Directory.CreateDirectory(k);
        return k;
    }

    private const long BelgeSiniri = 300L * 1024 * 1024;

    private async Task<int> BelgeYaz(System.Data.IDbConnection db, Kimlik ben, IFormFile f, int? dosyaId, int? yaziId)
    {
        var ad = Path.GetFileName(f.FileName ?? "belge");
        if (ad.Length > 240) ad = ad[^240..];
        var uz = Path.GetExtension(ad);
        if (uz.Length > 12 || uz.Any(c => !char.IsLetterOrDigit(c) && c != '.')) uz = "";
        var yol = Path.Combine(Klasor(dosyaId?.ToString() ?? "genel"), Guid.NewGuid().ToString("N") + uz.ToLowerInvariant());
        await using (var akis = System.IO.File.Create(yol)) await f.CopyToAsync(akis);
        return db.ExecuteScalar<int>(@"
INSERT INTO KRY_HUK_BELGE (dosya_id, yazi_id, ad, yol, icerik_turu, boyut, yukleyen, yukleyen_ad)
OUTPUT INSERTED.id VALUES (@dosyaId, @yaziId, @ad, @yol, @ct, @boyut, @kim, @kimAd)",
            new { dosyaId, yaziId, ad, yol, ct = string.IsNullOrWhiteSpace(f.ContentType) ? "application/octet-stream" : f.ContentType, boyut = f.Length, kim = ben.Anahtar, kimAd = ben.Ad });
    }

    [HttpPost("Dosya/{id:int}/Belge")]
    [RequestSizeLimit(BelgeSiniri + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = BelgeSiniri + 1024 * 1024)]
    public async Task<IActionResult> BelgeYukle(int id, List<IFormFile> dosyalar)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        var hak = DosyaHakki(db, ben, id);
        if (hak is not ("tam" or "standart")) return StatusCode(403, new { hata = "Bu dosyaya belge yükleyemezsiniz." });
        if ((dosyalar == null || dosyalar.Count == 0) && Request.HasFormContentType) dosyalar = Request.Form.Files.ToList();
        if (dosyalar is null || dosyalar.Count == 0) return BadRequest(new { hata = "Dosya seçiniz." });
        var idler = new List<int>();
        foreach (var f in dosyalar.Where(x => x.Length > 0))
        {
            if (f.Length > BelgeSiniri) return BadRequest(new { hata = $"{f.FileName}: en fazla 300 MB." });
            idler.Add(await BelgeYaz(db, ben, f, id, null));
            Logla(db, ben, "belge_yukle", id, f.FileName);
        }
        return Ok(new { idler });
    }

    /* Tarayıcıda açılabilecek güvenli türler; geri kalanlar indirilir */
    private static readonly HashSet<string> Gosterilir = new(StringComparer.OrdinalIgnoreCase)
    { ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".txt", ".mp4", ".mov", ".mp3", ".m4a" };

    [HttpGet("Belge/{bid:int}")]
    public IActionResult BelgeGetir(int bid, [FromQuery] bool indir = false)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        var b = db.QueryFirstOrDefault("SELECT * FROM KRY_HUK_BELGE WHERE id = @bid AND silindi = 0", new { bid });
        if (b is null) return NotFound();

        var izin = b.dosya_id is int did && DosyaHakki(db, ben, did) is not null;
        if (!izin && b.yazi_id is int yid)
            izin = YaziGorebilir(db, ben, yid);
        if (!izin) return NotFound();
        if (!System.IO.File.Exists((string)b.yol)) return NotFound(new { hata = "Dosya sunucuda bulunamadı." });

        Logla(db, ben, "belge_ac", (int?)b.dosya_id, (string)b.ad);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var akis = System.IO.File.OpenRead((string)b.yol);
        var goster = !indir && Gosterilir.Contains(Path.GetExtension((string)b.ad ?? ""));
        return goster
            ? File(akis, (string)b.icerik_turu ?? "application/octet-stream", enableRangeProcessing: true)
            : File(akis, "application/octet-stream", (string)b.ad, enableRangeProcessing: true);
    }

    [HttpDelete("Belge/{bid:int}")]
    public IActionResult BelgeSil(int bid)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        var b = db.QueryFirstOrDefault("SELECT dosya_id, ad, yukleyen, yazi_id FROM KRY_HUK_BELGE WHERE id = @bid AND silindi = 0", new { bid });
        if (b is null) return NotFound();
        if (b.yazi_id != null) return BadRequest(new { hata = "Resmi yazının eki silinemez." });
        var hak = b.dosya_id is int did ? DosyaHakki(db, ben, did) : null;
        if (hak != "tam" && !(hak == "standart" && (string)b.yukleyen == ben?.Anahtar))
            return StatusCode(403, new { hata = "Yalnız kendi yüklediğiniz belgeyi silebilirsiniz." });
        db.Execute("UPDATE KRY_HUK_BELGE SET silindi = 1 WHERE id = @bid", new { bid });
        Logla(db, ben, "belge_sil", (int?)b.dosya_id, (string)b.ad);
        return Ok(new { tamam = true });
    }
}

using System.Security.Cryptography;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Hukuk masası yönetimi (24.10.2026): dış danışman hesapları ve girişi
/// (kimlik numarası + telefon + SMS kodu), iç hukuk ekibi, dosya erişimi ve
/// işlem günlüğü. Yönetimi İK hukuk "tam" yetkisiyle yapar.
/// </summary>
public partial class HukukController
{
    private IActionResult TamDegil(Kimlik ben) =>
        ben?.Yetki == "tam" ? null : StatusCode(403, new { hata = "Bu işlem için hukuk masası tam yetkisi gerekli." });

    /* ==================================================================== */
    /* Danışman girişi: TC kimlik + kayıtlı telefon + SMS kodu               */
    /* ==================================================================== */

    public sealed class GirisGirdisi
    {
        public string KimlikNo { get; set; }
        public string Telefon { get; set; }
        /// <summary>Mobil: oturum 30 gün</summary>
        public bool Mobil { get; set; }
    }

    public sealed class DogrulaGirdisi
    {
        public string Gecici { get; set; }
        public string Kod { get; set; }
    }

    private static string MaskeliTelefon(string t)
    {
        var d = new string((t ?? "").Where(char.IsDigit).ToArray());
        return d.Length < 4 ? "" : $"•••• ••• {d[^4..^2]} {d[^2..]}";
    }

    private IConfiguration Yapilandirma => HttpContext.RequestServices.GetRequiredService<IConfiguration>();

    /// <summary>
    /// Dış danışman girişi, 1. adım: kimlik numarası ve kayıtlı telefon
    /// eşleşirse telefona 6 haneli kod gider. Kimlik numarası saklanmaz;
    /// yalnız özetiyle karşılaştırılır.
    /// </summary>
    [HttpPost("Giris")]
    [AllowAnonymous]
    public async Task<IActionResult> Giris([FromBody] GirisGirdisi g)
    {
        var ip = IstemciAdresi.Bul(HttpContext) ?? "bilinmiyor";
        if (GirisSinirlayici.KilitliMi(ip) is { } kalan)
            return StatusCode(429, new { hata = $"Çok fazla hatalı deneme. {Math.Max(1, kalan / 60)} dakika sonra tekrar deneyiniz." });
        if (HukukGiris.KimlikNormal(g?.KimlikNo) is null) return BadRequest(new { hata = "Kimlik numarasını kontrol ediniz." });
        if (HukukGiris.TelefonNormal(g.Telefon).Length != 10) return BadRequest(new { hata = "Telefon numarasını başında sıfır olmadan giriniz." });

        using var db = _vt.Baglanti();
        var d = HukukGiris.Bul(db, Yapilandirma, g.KimlikNo);
        if (d is null || !HukukGiris.TelefonEsit(d, g.Telefon))
        {
            GirisSinirlayici.HataliDeneme(ip);
            return Unauthorized(new { hata = "Kimlik numarası veya telefon eşleşmedi." });
        }
        GirisSinirlayici.BasariliGiris(ip);

        var (hata, gecici) = await HukukGiris.KodGonder(db, _sms, (object)d);
        if (hata is not null) return BadRequest(new { hata });
        return Ok(new { ikinciAdim = true, gecici, telefon = MaskeliTelefon((string)d.telefon), mobil = g.Mobil });
    }

    /// <summary>Dış danışman girişi, 2. adım: SMS kodu.</summary>
    [HttpPost("GirisDogrula")]
    [AllowAnonymous]
    public IActionResult GirisDogrula([FromBody] DogrulaGirdisi g, [FromQuery] bool mobil = false)
    {
        using var db = _vt.Baglanti();
        var id = db.ExecuteScalar<int?>("SELECT danisman_id FROM KRY_HUK_DANISMAN_KOD WHERE gecici = @g", new { g = g?.Gecici ?? "" });
        if (id is null) return BadRequest(new { hata = "Kodun süresi doldu; yeniden giriş yapınız." });
        var (d, hata) = HukukGiris.KodDogrula(db, id.Value, g.Kod, g.Gecici);
        if (hata is not null) return BadRequest(new { hata });
        return Ok(Oturum(db, d, mobil));
    }

    private object Oturum(System.Data.IDbConnection db, dynamic d, bool mobil)
    {
        var tamAd = string.IsNullOrWhiteSpace((string)d.unvan) ? (string)d.ad_soyad : $"{(string)d.unvan} {(string)d.ad_soyad}";
        var (token, bitis) = _jwt.Uret(new Kullanici
        {
            Id = (int)d.id,
            KullaniciAdi = DanismanOnek + (string)d.kullanici_adi,
            AdSoyad = tamAd,
            Rol = DanismanRolu,
        }, saatAsim: mobil ? 24 * 30 : 12);
        db.Execute("UPDATE KRY_HUK_DANISMAN SET son_giris = SYSDATETIME() WHERE id = @id", new { id = (int)d.id });
        Logla(db, new Kimlik(DanismanOnek + (string)d.kullanici_adi, tamAd, (string)d.kurum, "danisman", "danisman", null), "giris", null, mobil ? "mobil" : "panel");
        return new
        {
            token,
            gecerlilikSonu = bitis,
            kullaniciAdi = DanismanOnek + (string)d.kullanici_adi,
            adSoyad = tamAd,
            kurum = (string)d.kurum,
            rol = DanismanRolu,
        };
    }

    public sealed class JetonGirdisi
    {
        public string Deger { get; set; }
    }

    /// <summary>Danışmanın telefon bildirim jetonu (personel ucuna giremediği için ayrı).</summary>
    [HttpPost("BildirimJetonu")]
    public IActionResult BildirimJetonu([FromBody] JetonGirdisi g)
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith(DanismanOnek)) return Ok(new { tamam = false });
        var jeton = (g?.Deger ?? "").Trim();
        if (jeton.Length == 0 || jeton.Length > 200) return BadRequest(new { hata = "Jeton geçersiz." });
        using var db = _vt.Baglanti();
        db.Execute(@"
DELETE FROM KRY_MOBIL_JETON WHERE jeton = @jeton AND personel_kodu <> @kod;
MERGE KRY_MOBIL_JETON AS h
USING (SELECT @kod AS k) AS y ON h.personel_kodu = y.k
WHEN MATCHED THEN UPDATE SET jeton = @jeton, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (personel_kodu, jeton) VALUES (@kod, @jeton);", new { kod = ad.Length > 30 ? ad[..30] : ad, jeton });
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Danışmanlar                                                           */
    /* ==================================================================== */

    [HttpGet("Danismanlar")]
    public IActionResult Danismanlar()
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null || ben.Tur == "danisman") return Yasak();
        var erisim = db.Query(@"SELECT e.anahtar, e.hak, d.id, d.dosya_no, d.davaci_ad, d.tur FROM KRY_HUK_ERISIM e
JOIN KRY_HUK_DOSYA d ON d.id = e.dosya_id").ToList();
        var l = db.Query("SELECT * FROM KRY_HUK_DANISMAN ORDER BY aktif DESC, ad_soyad").Select(d =>
        {
            var anahtar = DanismanOnek + (string)d.kullanici_adi;
            return new
            {
                id = (int)d.id, anahtar, adSoyad = (string)d.ad_soyad, unvan = (string)d.unvan,
                kurum = (string)d.kurum, eposta = (string)d.eposta, telefon = (string)d.telefon, aktif = (bool)d.aktif,
                /* Kimlik numarası saklanmıyor; yalnız son iki hane */
                kimlikTanimli = d.tc_ozet != null, kimlikSon = (string)d.tc_son,
                sonGiris = (DateTime?)d.son_giris, olusturma = (DateTime)d.olusturma,
                dosyalar = erisim.Where(e => (string)e.anahtar == anahtar).Select(e => new
                {
                    id = (int)e.id, dosyaNo = (string)e.dosya_no, davaciAd = (string)e.davaci_ad, hak = (string)e.hak,
                    turAdi = Turler.GetValueOrDefault((string)e.tur, (string)e.tur),
                }),
            };
        }).ToList();
        return Ok(new { danismanlar = l, tamYetki = ben.Yetki == "tam" });
    }

    public sealed class DanismanGirdisi
    {
        /// <summary>Yeni kayıtta zorunlu; düzenlemede boşsa değişmez</summary>
        public string KimlikNo { get; set; }
        public string AdSoyad { get; set; }
        public string Unvan { get; set; }
        public string Kurum { get; set; }
        public string Eposta { get; set; }
        public string Telefon { get; set; }
        public bool Aktif { get; set; } = true;
    }

    /// <summary>Ad soyaddan iç anahtar: "ayse.yilmaz", çakışırsa sayı eklenir.</summary>
    private static string AnahtarUret(System.Data.IDbConnection db, string ad)
    {
        var tr = new Dictionary<char, string> { ['ç'] = "c", ['ğ'] = "g", ['ı'] = "i", ['ö'] = "o", ['ş'] = "s", ['ü'] = "u", ['â'] = "a", ['î'] = "i", ['û'] = "u" };
        var s = string.Concat((ad ?? "").ToLower(new System.Globalization.CultureInfo("tr-TR"))
            .Select(c => tr.TryGetValue(c, out var r) ? r : char.IsLetterOrDigit(c) && c < 128 ? c.ToString() : " "));
        var kok = string.Join(".", s.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (kok.Length < 3) kok = "danisman";
        if (kok.Length > 20) kok = kok[..20].TrimEnd('.');
        var aday = kok;
        for (var i = 2; db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_DANISMAN WHERE kullanici_adi = @a", new { a = aday }) > 0; i++)
            aday = $"{kok}{i}";
        return aday;
    }

    [HttpPost("Danisman")]
    [HttpPost("Danisman/{id:int}")]
    public IActionResult DanismanKaydet(int? id, [FromBody] DanismanGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (TamDegil(ben) is { } red) return red;
        var ad = Kirp(g?.AdSoyad, 150);
        if (ad is null) return BadRequest(new { hata = "Ad soyad zorunlu." });
        var tel = HukukGiris.TelefonNormal(g.Telefon);
        if (tel.Length != 10 || tel[0] != '5') return BadRequest(new { hata = "Cep telefonunu 5xx xxx xx xx biçiminde yazınız." });
        var tcGirildi = !string.IsNullOrWhiteSpace(g.KimlikNo);
        var tc = HukukGiris.KimlikNormal(g.KimlikNo);
        if (tcGirildi && tc is null) return BadRequest(new { hata = "Kimlik numarası 11 hane olmalı." });
        if (id is null && tc is null) return BadRequest(new { hata = "Kimlik numarası zorunlu." });

        string ozet = null;
        if (tc is not null)
        {
            ozet = HukukGiris.KimlikOzeti(Yapilandirma, tc);
            var cakisma = db.ExecuteScalar<int?>("SELECT id FROM KRY_HUK_DANISMAN WHERE tc_ozet = @ozet", new { ozet });
            if (cakisma is not null && cakisma != id) return BadRequest(new { hata = "Bu kimlik numarası başka bir danışmanda kayıtlı." });
        }

        var p = new { ad, unvan = Kirp(g.Unvan, 60), kurum = Kirp(g.Kurum, 200), eposta = Kirp(g.Eposta, 150), tel, aktif = g.Aktif };
        if (id is null)
        {
            var kullanici = AnahtarUret(db, ad);
            /* Parola kullanılmıyor; sütun zorunlu olduğu için tahmin edilemez bir değer yazılır */
            var (h, s) = ParolaServisi.Uret(Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)));
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HUK_DANISMAN (kullanici_adi, ad_soyad, unvan, kurum, eposta, telefon, parola_hash, parola_salt, aktif, olusturan, tc_ozet, tc_son)
OUTPUT INSERTED.id VALUES (@kullanici, @ad, @unvan, @kurum, @eposta, @tel, @h, @s, @aktif, @kim, @ozet, @son)",
                new { kullanici, p.ad, p.unvan, p.kurum, p.eposta, p.tel, h, s, p.aktif, kim = ben.Anahtar, ozet, son = tc![^2..] });
            Logla(db, ben, "danisman_ekle", null, ad);
        }
        else
        {
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_DANISMAN WHERE id = @id", new { id }) == 0) return NotFound();
            db.Execute(@"UPDATE KRY_HUK_DANISMAN SET ad_soyad = @ad, unvan = @unvan, kurum = @kurum, eposta = @eposta, telefon = @tel, aktif = @aktif,
tc_ozet = ISNULL(@ozet, tc_ozet), tc_son = ISNULL(@son, tc_son) WHERE id = @id",
                new { id, p.ad, p.unvan, p.kurum, p.eposta, p.tel, p.aktif, ozet, son = tc?[^2..] });
            Logla(db, ben, g.Aktif ? "danisman_guncelle" : "danisman_pasif", null, ad);
        }
        return Ok(new { id });
    }

    /* ==================================================================== */
    /* Dosya erişimi                                                         */
    /* ==================================================================== */

    public sealed class ErisimGirdisi
    {
        public int DosyaId { get; set; }
        public string Anahtar { get; set; }
        /// <summary>tam / standart / okuma; boşsa erişim kaldırılır</summary>
        public string Hak { get; set; }
    }

    [HttpPost("Erisim")]
    public async Task<IActionResult> Erisim([FromBody] ErisimGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (TamDegil(ben) is { } red) return red;
        if (g is null || !(g.Anahtar ?? "").StartsWith(DanismanOnek)) return BadRequest(new { hata = "Danışman seçiniz." });
        var dosya = db.QueryFirstOrDefault("SELECT dosya_no, davaci_ad FROM KRY_HUK_DOSYA WHERE id = @id", new { id = g.DosyaId });
        if (dosya is null) return NotFound(new { hata = "Dosya bulunamadı." });
        if (string.IsNullOrWhiteSpace(g.Hak))
        {
            db.Execute("DELETE FROM KRY_HUK_ERISIM WHERE dosya_id = @DosyaId AND anahtar = @Anahtar", g);
            Logla(db, ben, "erisim_kaldir", g.DosyaId, g.Anahtar);
            return Ok(new { tamam = true });
        }
        if (g.Hak is not ("tam" or "standart" or "okuma")) return BadRequest(new { hata = "Hak geçersiz." });
        var yeni = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_ERISIM WHERE dosya_id = @DosyaId AND anahtar = @Anahtar", g) == 0;
        db.Execute(@"MERGE KRY_HUK_ERISIM AS h USING (SELECT @DosyaId AS d, @Anahtar AS a) AS y ON h.dosya_id = y.d AND h.anahtar = y.a
WHEN MATCHED THEN UPDATE SET hak = @Hak
WHEN NOT MATCHED THEN INSERT (dosya_id, anahtar, hak, ekleyen) VALUES (@DosyaId, @Anahtar, @Hak, @kim);",
            new { g.DosyaId, g.Anahtar, g.Hak, kim = ben.Anahtar });
        Logla(db, ben, "erisim_ver", g.DosyaId, $"{g.Anahtar} · {g.Hak}");
        if (yeni)
            await Bildir(db, new[] { g.Anahtar }, "Yeni dosya erişimi", $"{(string)dosya.dosya_no} · {(string)dosya.davaci_ad} dosyasına erişiminiz açıldı.");
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* İç hukuk ekibi                                                         */
    /* ==================================================================== */

    [HttpGet("Ekip")]
    public IActionResult Ekip()
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null || ben.Tur == "danisman") return Yasak();
        var l = db.Query("SELECT anahtar, ad, rol, olusturma FROM KRY_HUK_EKIP ORDER BY ad").ToList();
        var adlar = Adlar(db, l.Select(x => (string)x.anahtar));
        var paneller = db.Query("SELECT kullanici_adi AS k, ad_soyad AS a, rol FROM KRY_KULLANICILAR WHERE aktif = 1 ORDER BY ad_soyad")
            .Select(x => new { anahtar = "u:" + (string)x.k, ad = (string)x.a, rol = (string)x.rol }).ToList();
        return Ok(new
        {
            ekip = l.Select(x => new
            {
                anahtar = (string)x.anahtar, ad = adlar.GetValueOrDefault((string)x.anahtar).Ad ?? (string)x.ad, rol = (string)x.rol,
                tur = ((string)x.anahtar).StartsWith("p:") ? "personel" : "panel", olusturma = (DateTime)x.olusturma,
            }),
            panelKullanicilari = paneller,
            not = "Admin, İK yöneticisi ve GMY her zaman tam yetkilidir.",
            tamYetki = ben.Yetki == "tam",
        });
    }

    public sealed class EkipGirdisi
    {
        /// <summary>u:kullanıcı ya da p:sicil</summary>
        public string Anahtar { get; set; }
        /// <summary>hukuk (tam) / okuma; boşsa ekipten çıkarılır</summary>
        public string Rol { get; set; }
    }

    [HttpPost("Ekip")]
    public IActionResult EkipKaydet([FromBody] EkipGirdisi g)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (TamDegil(ben) is { } red) return red;
        var a = (g?.Anahtar ?? "").Trim();
        if (a.StartsWith("p:")) a = "p:" + K(a[2..]);
        if (!(a.StartsWith("u:") || a.StartsWith("p:")) || a.Length < 3) return BadRequest(new { hata = "Panel kullanıcısı ya da personel seçiniz." });
        if (string.IsNullOrWhiteSpace(g.Rol))
        {
            db.Execute("DELETE FROM KRY_HUK_EKIP WHERE anahtar = @a", new { a });
            Logla(db, ben, "ekip_cikar", null, a);
            return Ok(new { tamam = true });
        }
        if (g.Rol is not ("hukuk" or "okuma")) return BadRequest(new { hata = "Rol geçersiz." });
        string ad;
        if (a.StartsWith("u:"))
        {
            ad = db.ExecuteScalar<string>("SELECT ad_soyad FROM KRY_KULLANICILAR WHERE kullanici_adi = @k AND aktif = 1", new { k = a[2..] });
            if (ad is null) return BadRequest(new { hata = "Panel kullanıcısı bulunamadı." });
        }
        else
        {
            var p = _ekip.Kisi(a[2..]);
            if (p is null) return BadRequest(new { hata = "Bu sicilde aktif personel yok." });
            ad = $"{p.Ad} {p.Soyad}".Trim();
        }
        db.Execute(@"MERGE KRY_HUK_EKIP AS h USING (SELECT @a AS a) AS y ON h.anahtar = y.a
WHEN MATCHED THEN UPDATE SET rol = @rol, ad = @ad
WHEN NOT MATCHED THEN INSERT (anahtar, ad, rol, ekleyen) VALUES (@a, @ad, @rol, @kim);", new { a, ad, rol = g.Rol, kim = ben.Anahtar });
        Logla(db, ben, "ekip_ekle", null, $"{a} · {g.Rol}");
        return Ok(new { tamam = true, ad });
    }

    /// <summary>Dosyanın işlem günlüğü (kim ne zaman açtı, indirdi, yazdı).</summary>
    [HttpGet("Dosya/{id:int}/Gunluk")]
    public IActionResult Gunluk(int id)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben?.Yetki != "tam") return Yasak();
        var l = db.Query("SELECT TOP 300 ad, islem, hedef, zaman FROM KRY_HUK_LOG WHERE dosya_id = @id ORDER BY id DESC", new { id })
            .Select(x => new { ad = (string)x.ad, islem = (string)x.islem, hedef = (string)x.hedef, zaman = (DateTime)x.zaman });
        return Ok(new { gunluk = l });
    }
}

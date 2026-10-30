using System.Security.Claims;
using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using H = BicenKariyer.API.Servisler.ButceHesap;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel bütçesi (30.10.2026) — /api/Butce/…
/// ---------------------------------------------------------------------------
/// <para>
/// İK'nın "B_T_E" Excel'inin yerine: yıl/senaryo başlıkları (KRY_BUTCE_DONEM),
/// parametre seti (KRY_BUTCE_PARAMETRE, JSON), kişi listesi (KRY_BUTCE_KISI),
/// zam kuralları (KRY_BUTCE_ZAM_KURAL). Hesap ButceHesap'ta; burada veri ve
/// yetki.
/// </para>
/// <para>
/// <b>Yetki:</b> yalnız Admin, GenelMudurYardimcisi ve IKYoneticisi; rolün
/// kendisi bu üçünden biri olmalı (özel rollerin devraldığı temel rol
/// GEÇMEZ, Rol Yetkileri'nden açılamaz). Panel kullanıcısı olmayan jetonlar
/// (mobil "personel:", hukuk danışmanı "hd:") hiçbir koşulda giremez.
/// Her görüntüleme, dışa aktarma ve değişiklik KRY_BUTCE_LOG'a yazılır.
/// Ücret verisi adres satırına ve sorgu dizesine konmaz: süzme panelde,
/// önizleme ve toplu işlemler gövdede (POST) taşınır.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ButceController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly ILogger<ButceController> _kayit;

    public ButceController(VeritabaniServisi vt, PersonelKaynagiServisi personelKaynak, ILogger<ButceController> kayit)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Yetki ve günlük                                                       */
    /* ==================================================================== */

    private static readonly string[] IzinliRoller = { Roller.Admin, Roller.GenelMudurYardimcisi, Roller.IKYoneticisi };

    private string KullaniciAdi => User?.Identity?.Name ?? "";
    private string Rol => User?.FindFirst(ClaimTypes.Role)?.Value ?? "";
    private string AdSoyad => User?.FindFirst("adSoyad")?.Value is { Length: > 0 } a ? a : KullaniciAdi;

    /// <summary>Bütçeye girebilir mi: tam rol eşleşmesi + panel kullanıcısı jetonu</summary>
    private bool Yetkili
    {
        get
        {
            if (User?.Identity?.IsAuthenticated != true) return false;
            if (string.IsNullOrWhiteSpace(KullaniciAdi)) return false;
            if (KullaniciAdi.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return false;
            if (KullaniciAdi.StartsWith(HukukController.DanismanOnek, StringComparison.OrdinalIgnoreCase)) return false;
            if (User.FindFirst(ClaimTypes.NameIdentifier) is null) return false;
            return IzinliRoller.Contains(Rol, StringComparer.Ordinal);
        }
    }

    private IActionResult Yasak() => StatusCode(403, new { hata = "Personel bütçesine erişiminiz yok." });

    private void Logla(System.Data.IDbConnection db, string islem, int? donemId, string ayrinti = null)
    {
        try
        {
            db.Execute("INSERT INTO KRY_BUTCE_LOG (kullanici, ad, rol, islem, donem_id, ayrinti, ip) VALUES (@k, @ad, @rol, @islem, @donemId, @ayrinti, @ip)",
                new { k = KullaniciAdi, ad = AdSoyad, rol = Rol, islem, donemId, ayrinti = ayrinti is { Length: > 400 } ? ayrinti[..400] : ayrinti, ip = IstemciAdresi.Bul(HttpContext) });
        }
        catch (Exception h) { _kayit.LogWarning(h, "Bütçe günlüğü yazılamadı"); }
    }

    /* ==================================================================== */
    /* Veri okuma yardımcıları                                               */
    /* ==================================================================== */

    private sealed class DonemSatiri
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public int Yil { get; set; }
        public int? BazDonemId { get; set; }
        public string Durum { get; set; }
        public string Aciklama { get; set; }
        public string Kaynak { get; set; }
        public string Olusturan { get; set; }
        public DateTime Olusturma { get; set; }
        public string Guncelleyen { get; set; }
        public DateTime? Guncelleme { get; set; }
        public int KisiSayisi { get; set; }
    }

    private const string DonemSql = @"
SELECT d.id AS Id, d.ad AS Ad, d.yil AS Yil, d.baz_donem_id AS BazDonemId, d.durum AS Durum, d.aciklama AS Aciklama, d.kaynak AS Kaynak,
       d.olusturan AS Olusturan, d.olusturma AS Olusturma, d.guncelleyen AS Guncelleyen, d.guncelleme AS Guncelleme,
       (SELECT COUNT(*) FROM KRY_BUTCE_KISI k WHERE k.donem_id = d.id AND k.aktif = 1) AS KisiSayisi
FROM KRY_BUTCE_DONEM d WHERE d.silindi = 0";

    private static DonemSatiri DonemOku(System.Data.IDbConnection db, int id) =>
        db.QueryFirstOrDefault<DonemSatiri>(DonemSql + " AND d.id = @id", new { id });

    private static object DonemNesnesi(DonemSatiri d) => new
    {
        id = d.Id, ad = d.Ad, yil = d.Yil, bazDonemId = d.BazDonemId, durum = d.Durum, aciklama = d.Aciklama, kaynak = d.Kaynak,
        olusturan = d.Olusturan, olusturma = d.Olusturma, guncelleyen = d.Guncelleyen, guncelleme = d.Guncelleme, kisiSayisi = d.KisiSayisi,
    };

    private static H.Parametre ParametreOku(System.Data.IDbConnection db, int donemId)
    {
        var json = db.ExecuteScalar<string>("SELECT veri FROM KRY_BUTCE_PARAMETRE WHERE donem_id = @id", new { id = donemId });
        if (string.IsNullOrWhiteSpace(json)) return new H.Parametre();
        try { return JsonSerializer.Deserialize<H.Parametre>(json, H.JsonAyar) ?? new H.Parametre(); }
        catch { return new H.Parametre(); }
    }

    private static void ParametreYaz(System.Data.IDbConnection db, int donemId, H.Parametre p, string kim)
    {
        var json = JsonSerializer.Serialize(p, H.JsonAyar);
        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_BUTCE_PARAMETRE WHERE donem_id = @id)
    UPDATE KRY_BUTCE_PARAMETRE SET veri = @json, guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE donem_id = @id
ELSE
    INSERT INTO KRY_BUTCE_PARAMETRE (donem_id, veri, guncelleyen) VALUES (@id, @json, @kim)", new { id = donemId, json, kim });
    }

    private sealed class KisiSatiri
    {
        public int Id { get; set; }
        public string Sube { get; set; }
        public string Bolum { get; set; }
        public string Sicil { get; set; }
        public string Ad { get; set; }
        public int Gun { get; set; }
        public bool Emekli { get; set; }
        public string Meslek { get; set; }
        public decimal GrmOnceki { get; set; }
        public decimal Grm { get; set; }
        public decimal BordroNet { get; set; }
        public string YanGiderler { get; set; }
        public decimal? BazGrm { get; set; }
        public decimal? BazBordroNet { get; set; }
        public int? BazKisiId { get; set; }
        public bool Elle { get; set; }
        public bool Aktif { get; set; }
        public string Notu { get; set; }

        public H.Kisi Kisi() => new()
        {
            Id = Id, Sube = Sube, Bolum = Bolum, Sicil = Sicil, Ad = Ad, Gun = Gun, Emekli = Emekli, Meslek = Meslek,
            GrmOnceki = GrmOnceki, Grm = Grm, BordroNet = BordroNet, YanGiderler = YanGiderSozluk(YanGiderler), Aktif = Aktif,
        };
    }

    private const string KisiSql = @"
SELECT id AS Id, sube AS Sube, bolum AS Bolum, sicil AS Sicil, ad AS Ad, gun AS Gun, emekli AS Emekli, meslek AS Meslek,
       grm_onceki AS GrmOnceki, grm AS Grm, bordro_net AS BordroNet, yan_giderler AS YanGiderler, baz_grm AS BazGrm, baz_bordro_net AS BazBordroNet,
       baz_kisi_id AS BazKisiId, elle AS Elle, aktif AS Aktif, notu AS Notu
FROM KRY_BUTCE_KISI WHERE donem_id = @id ORDER BY sube, ad";

    private static Dictionary<string, decimal> YanGiderSozluk(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { var d = JsonSerializer.Deserialize<Dictionary<string, decimal>>(json, H.JsonAyar); return d is { Count: > 0 } ? d : null; }
        catch { return null; }
    }

    private static string YanGiderJson(Dictionary<string, decimal> d) =>
        d is { Count: > 0 } ? JsonSerializer.Serialize(d.Where(x => !string.IsNullOrWhiteSpace(x.Key)).ToDictionary(x => x.Key.Trim(), x => x.Value), H.JsonAyar) : null;

    private static List<KisiSatiri> KisileriOku(System.Data.IDbConnection db, int donemId) =>
        db.Query<KisiSatiri>(KisiSql, new { id = donemId }).ToList();

    private sealed class KuralSatiri
    {
        public int Id { get; set; }
        public string Tur { get; set; }
        public string Sube { get; set; }
        public string Meslek { get; set; }
        public int? KisiId { get; set; }
        public decimal BordroOran { get; set; }
        public decimal? GrmOran { get; set; }
        public string Aciklama { get; set; }

        public H.ZamKurali Kural() => new() { Tur = Tur, Sube = Sube, Meslek = Meslek, KisiId = KisiId, BordroOran = BordroOran, GrmOran = GrmOran, Aciklama = Aciklama };
    }

    private static List<KuralSatiri> KurallariOku(System.Data.IDbConnection db, int donemId) =>
        db.Query<KuralSatiri>(@"SELECT id AS Id, tur AS Tur, sube AS Sube, meslek AS Meslek, kisi_id AS KisiId, bordro_oran AS BordroOran, grm_oran AS GrmOran, aciklama AS Aciklama
FROM KRY_BUTCE_ZAM_KURAL WHERE donem_id = @id ORDER BY sira, id", new { id = donemId }).ToList();

    /* ---------------------------------------------------------- çıktılar */

    private static object AyNesne(H.AyOzeti a) => new
    {
        ay = a.Ay, etiket = a.Etiket, brut = R(a.Brut), isverenSgk = R(a.IsverenSgk), grFarki = R(a.GrFarki),
        yanGider = R(a.YanGider), tekSeferlik = R(a.TekSeferlik), netBanka = R(a.NetBanka), toplam = R(a.Toplam),
    };

    private static object GrupNesne(H.GrupOzeti g) => new
    {
        ad = g.Ad, kisi = g.Kisi, fte = g.Fte, toplam = R(g.Toplam), brut = R(g.Brut), isverenSgk = R(g.IsverenSgk), grFarki = R(g.GrFarki),
        yanGider = R(g.YanGider), tekSeferlik = R(g.TekSeferlik), ortalamaNet = R(g.OrtalamaNet), kisiBasiAylik = R(g.KisiBasiAylik),
    };

    private static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>Senaryo özeti (kişi satırları hariç)</summary>
    private static object OzetNesne(H.SenaryoSonuc s) => new
    {
        kisi = s.Kisi, fte = s.Fte, yillikToplam = R(s.YillikToplam), aylikOrtalama = R(s.AylikOrtalama), kisiBasiAylik = R(s.KisiBasiAylik),
        yillikBrut = R(s.YillikBrut), yillikIsverenSgk = R(s.YillikIsverenSgk), yillikGrFarki = R(s.YillikGrFarki), yillikYanGider = R(s.YillikYanGider),
        yillikTekSeferlik = R(s.YillikTekSeferlik), yillikNetBanka = R(s.YillikNetBanka), yillikGrm = R(s.YillikGrm),
        netMaliyetCarpani = Math.Round(s.NetMaliyetCarpani, 4), asgariNet = s.AsgariNet,
        bordroAylari = s.BordroAylari.Select(AyNesne), odemeAylari = s.OdemeAylari.Select(AyNesne),
        subeler = s.Subeler.Select(GrupNesne), meslekler = s.Meslekler.Select(GrupNesne),
        yanGiderDagilimi = s.YanGiderDagilimi.Select(x => new { kod = x.Kod, ad = x.Ad, tutar = R(x.Tutar) }),
        tekSeferlikDagilimi = s.TekSeferlikDagilimi.Select(x => new { kod = x.Kod, ad = x.Ad, tutar = R(x.Tutar) }),
    };

    private static object KisiOzetNesne(KisiSatiri k, H.KisiSonuc s) => new
    {
        id = k.Id, sube = k.Sube, bolum = k.Bolum, sicil = k.Sicil, ad = k.Ad, gun = k.Gun, emekli = k.Emekli, meslek = k.Meslek,
        grmOnceki = k.GrmOnceki, grm = k.Grm, bordroNet = k.BordroNet, yanGiderler = YanGiderSozluk(k.YanGiderler), bazGrm = k.BazGrm, bazBordroNet = k.BazBordroNet, elle = k.Elle, aktif = k.Aktif, notu = k.Notu,
        zamOrani = k.GrmOnceki > 0 ? Math.Round((k.Grm - k.GrmOnceki) / k.GrmOnceki, 4) : (decimal?)null,
        yillikToplam = s is null ? 0 : R(s.YillikToplam), yillikIsveren = s is null ? 0 : R(s.YillikIsveren), yillikGrFarki = s is null ? 0 : R(s.YillikGrFarki),
        yillikYanGider = s is null ? 0 : R(s.YillikYanGider), yillikTekSeferlik = s is null ? 0 : R(s.YillikTekSeferlik),
        ocakBrut = s is null || s.Aylar.Count == 0 ? 0 : R(s.Aylar[0].Brut), aylikOrtalama = s is null ? 0 : R(s.YillikToplam / 12m),
    };

    /* ==================================================================== */
    /* Uçlar: kimlik, liste                                                  */
    /* ==================================================================== */

    /// <summary>Oturumdaki kişi bütçeye girebilir mi</summary>
    [HttpGet("Ben")]
    public IActionResult Ben()
    {
        if (!Yetkili) return Ok(new { yetkili = false });
        return Ok(new { yetkili = true, ad = AdSoyad, rol = Rol, varsayilan = new H.Parametre() });
    }

    [HttpGet("Donemler")]
    public IActionResult Donemler()
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var l = db.Query<DonemSatiri>(DonemSql + " ORDER BY d.yil DESC, d.id DESC").Select(DonemNesnesi).ToList();
        return Ok(new { donemler = l });
    }

    /* ==================================================================== */
    /* Dönem oluşturma (içe aktarma) ve başlık                               */
    /* ==================================================================== */

    public class KisiGirdi
    {
        public string Sube { get; set; }
        public string Bolum { get; set; }
        public string Sicil { get; set; }
        public string Ad { get; set; }
        public int Gun { get; set; } = 30;
        public bool Emekli { get; set; }
        public string Meslek { get; set; }
        public decimal GrmOnceki { get; set; }
        public decimal Grm { get; set; }
        public decimal BordroNet { get; set; }
        /// <summary>Kişiye özel yan gider tutarları (kod → aylık)</summary>
        public Dictionary<string, decimal> YanGiderler { get; set; }
        public bool Aktif { get; set; } = true;
        public string Notu { get; set; }
    }

    public class DonemGirdi
    {
        public string Ad { get; set; }
        public int Yil { get; set; }
        public string Aciklama { get; set; }
        public string Kaynak { get; set; }
        public H.Parametre Parametre { get; set; }
        public List<KisiGirdi> Kisiler { get; set; }
    }

    /// <summary>Excel'den içe aktarılan ya da boş yeni dönem</summary>
    [HttpPost("Donem")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public IActionResult DonemOlustur([FromBody] DonemGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (g is null || string.IsNullOrWhiteSpace(g.Ad)) return BadRequest(new { hata = "Dönem adı gerekli." });
        if (g.Yil is < 2020 or > 2100) return BadRequest(new { hata = "Yıl geçersiz." });

        using var db = _vt.Baglanti();
        var p = g.Parametre ?? new H.Parametre();
        p.Yil = g.Yil;
        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_BUTCE_DONEM (ad, yil, durum, aciklama, kaynak, olusturan)
OUTPUT INSERTED.id VALUES (@ad, @yil, N'taslak', @aciklama, @kaynak, @kim)",
            new { ad = g.Ad.Trim(), yil = g.Yil, aciklama = g.Aciklama, kaynak = g.Kaynak ?? "elle", kim = AdSoyad });
        ParametreYaz(db, id, p, AdSoyad);
        var n = KisileriEkle(db, id, g.Kisiler);
        Logla(db, "donem_olustur", id, $"{g.Ad} · {g.Yil} · {n} kişi · {g.Kaynak}");
        return Ok(new { id, kisi = n });
    }

    private int KisileriEkle(System.Data.IDbConnection db, int donemId, IEnumerable<KisiGirdi> kisiler)
    {
        var n = 0;
        foreach (var k in kisiler ?? Enumerable.Empty<KisiGirdi>())
        {
            if (k is null) continue;
            db.Execute(@"
INSERT INTO KRY_BUTCE_KISI (donem_id, sube, bolum, sicil, ad, gun, emekli, meslek, grm_onceki, grm, bordro_net, yan_giderler, baz_grm, baz_bordro_net, aktif, notu, guncelleyen, guncelleme)
VALUES (@donemId, @sube, @bolum, @sicil, @ad, @gun, @emekli, @meslek, @grmOnceki, @grm, @bordroNet, @yan, @grm, @bordroNet, @aktif, @notu, @kim, SYSDATETIME())",
                new
                {
                    donemId, sube = K(k.Sube, 100), bolum = K(k.Bolum, 60), sicil = K(k.Sicil, 30), ad = K(k.Ad, 150), gun = k.Gun is 15 or 30 ? k.Gun : Math.Clamp(k.Gun, 1, 30),
                    emekli = k.Emekli, meslek = K(k.Meslek, 100), grmOnceki = k.GrmOnceki, grm = k.Grm, bordroNet = k.BordroNet, yan = YanGiderJson(k.YanGiderler), aktif = k.Aktif, notu = K(k.Notu, 300), kim = AdSoyad,
                });
            n++;
        }
        return n;
    }

    private static string K(string s, int en) => string.IsNullOrWhiteSpace(s) ? null : s.Trim().Length > en ? s.Trim()[..en] : s.Trim();

    public class BaslikGirdi
    {
        public string Ad { get; set; }
        public string Durum { get; set; }
        public string Aciklama { get; set; }
    }

    [HttpPut("Donem/{id:int}")]
    public IActionResult DonemGuncelle(int id, [FromBody] BaslikGirdi g)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var d = DonemOku(db, id);
        if (d is null) return NotFound(new { hata = "Dönem bulunamadı." });
        var durum = g?.Durum is "onayli" or "taslak" or "arsiv" ? g.Durum : d.Durum;
        db.Execute("UPDATE KRY_BUTCE_DONEM SET ad = @ad, durum = @durum, aciklama = @aciklama, guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE id = @id",
            new { id, ad = string.IsNullOrWhiteSpace(g?.Ad) ? d.Ad : g.Ad.Trim(), durum, aciklama = g?.Aciklama ?? d.Aciklama, kim = AdSoyad });
        Logla(db, "donem_guncelle", id, $"{g?.Ad} · {durum}");
        return Ok(new { tamam = true });
    }

    [HttpDelete("Donem/{id:int}")]
    public IActionResult DonemSil(int id)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var d = DonemOku(db, id);
        if (d is null) return NotFound(new { hata = "Dönem bulunamadı." });
        if (d.Durum == "onayli") return BadRequest(new { hata = "Onaylı dönem silinemez; önce taslağa alın." });
        db.Execute("UPDATE KRY_BUTCE_DONEM SET silindi = 1, guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE id = @id", new { id, kim = AdSoyad });
        Logla(db, "donem_sil", id, d.Ad);
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Dönem özeti ve kişiler                                                */
    /* ==================================================================== */

    /// <summary>Başlık, parametre, kurallar ve hesaplanmış özet (kişi satırları yok)</summary>
    [HttpGet("Donem/{id:int}")]
    public IActionResult Donem(int id)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var d = DonemOku(db, id);
        if (d is null) return NotFound(new { hata = "Dönem bulunamadı." });
        var p = ParametreOku(db, id);
        var kisiler = KisileriOku(db, id);
        var kurallar = KurallariOku(db, id);
        var sonuc = H.SenaryoHesapla(kisiler.Select(k => k.Kisi()), p, kisileriEkle: false);
        Logla(db, "goruntule", id, d.Ad);

        object baz = null;
        if (d.BazDonemId is { } bid && DonemOku(db, bid) is { } bd)
        {
            var bs = H.SenaryoHesapla(KisileriOku(db, bid).Select(k => k.Kisi()), ParametreOku(db, bid), kisileriEkle: false);
            baz = new { donem = DonemNesnesi(bd), ozet = OzetNesne(bs) };
        }

        return Ok(new
        {
            donem = DonemNesnesi(d),
            parametre = p,
            kurallar = kurallar.Select(KuralNesne),
            ozet = OzetNesne(sonuc),
            baz,
            subeler = kisiler.Select(k => k.Sube).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(s => s).ToList(),
            meslekler = kisiler.Select(k => k.Meslek).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(s => s).ToList(),
        });
    }

    private static object KuralNesne(KuralSatiri r) => new { id = r.Id, tur = r.Tur, sube = r.Sube, meslek = r.Meslek, kisiId = r.KisiId, bordroOran = r.BordroOran, grmOran = r.GrmOran, aciklama = r.Aciklama };

    /// <summary>Kişi listesi (yıllık toplamlarıyla). Süzme panelde yapılır; sorgu dizesinde ücret taşınmaz.</summary>
    [HttpGet("Donem/{id:int}/Kisiler")]
    public IActionResult Kisiler(int id)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var d = DonemOku(db, id);
        if (d is null) return NotFound(new { hata = "Dönem bulunamadı." });
        var p = ParametreOku(db, id);
        var kisiler = KisileriOku(db, id);
        var l = kisiler.Select(k => KisiOzetNesne(k, k.Aktif ? H.KisiHesapla(k.Kisi(), p) : null)).ToList();
        Logla(db, "kisi_listesi", id, $"{d.Ad} · {l.Count} kişi");
        return Ok(new { kisiler = l });
    }

    /// <summary>Bir kişinin 12 aylık bordro tablosu</summary>
    [HttpGet("Donem/{id:int}/Kisi/{kisiId:int}")]
    public IActionResult KisiDetay(int id, int kisiId)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var p = ParametreOku(db, id);
        var k = db.QueryFirstOrDefault<KisiSatiri>(KisiSql.Replace("ORDER BY sube, ad", "AND id = @kisiId"), new { id, kisiId });
        if (k is null) return NotFound(new { hata = "Kişi bulunamadı." });
        var s = H.KisiHesapla(k.Kisi(), p);
        Logla(db, "kisi_detay", id, $"kişi #{kisiId}");
        return Ok(new
        {
            kisi = KisiOzetNesne(k, s),
            aylar = s.Aylar.Select(a => new
            {
                ay = a.Ay, etiket = H.AyAdlari[a.Ay - 1], brut = R(a.Brut), sgkIsci = R(a.SgkIsci), issizlikIsci = R(a.IssizlikIsci), matrah = R(a.Matrah),
                kumulatifMatrah = R(a.KumulatifMatrah), gv = R(a.Gv), dv = R(a.Dv), gvIstisna = R(a.GvIstisna), dvIstisna = R(a.DvIstisna), gvSon = R(a.GvSon), dvSon = R(a.DvSon),
                net = R(a.Net), sskIsveren = R(a.SskIsveren), indirim = R(a.Indirim), issizlikIsveren = R(a.IssizlikIsveren), isverenMaliyeti = R(a.IsverenMaliyeti),
                netBanka = R(a.NetBanka), grFarki = R(a.GrFarki), yanGider = R(a.YanGider), tekSeferlik = R(a.TekSeferlik), toplam = R(a.Toplam),
                tekSeferlikKalemler = a.TekSeferlikKalemler.Select(t => new { kod = t.Kod, ad = t.Ad, tutar = R(t.Tutar) }),
            }),
            yanGiderler = s.YanGiderKalemleri.Select(y => new { kod = y.Kod, ad = y.Ad, tutar = R(y.Tutar) }),
            tavan = p.AsgariUcretBrut * p.TavanKatsayisi,
            asgariNet = H.AsgariNet(p),
        });
    }

    /* ==================================================================== */
    /* Kişi düzenleme                                                        */
    /* ==================================================================== */

    public class KisiDuzenle
    {
        public string Sube { get; set; }
        public string Bolum { get; set; }
        public string Sicil { get; set; }
        public string Ad { get; set; }
        public int? Gun { get; set; }
        public bool? Emekli { get; set; }
        public string Meslek { get; set; }
        public decimal? GrmOnceki { get; set; }
        public decimal? Grm { get; set; }
        public decimal? BordroNet { get; set; }
        /// <summary>null = dokunma; boş sözlük = hepsini varsayılana döndür; dolu = bu liste</summary>
        public Dictionary<string, decimal> YanGiderler { get; set; }
        public bool? Aktif { get; set; }
        public string Notu { get; set; }
    }

    [HttpPost("Donem/{id:int}/Kisi")]
    public IActionResult KisiEkle(int id, [FromBody] KisiGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (g is null || string.IsNullOrWhiteSpace(g.Ad)) return BadRequest(new { hata = "Ad soyad gerekli." });
        using var db = _vt.Baglanti();
        if (DonemOku(db, id) is null) return NotFound(new { hata = "Dönem bulunamadı." });
        KisileriEkle(db, id, new[] { g });
        var yeniId = db.ExecuteScalar<int>("SELECT MAX(id) FROM KRY_BUTCE_KISI WHERE donem_id = @id", new { id });
        db.Execute("UPDATE KRY_BUTCE_KISI SET elle = 1 WHERE id = @yeniId", new { yeniId });
        Logla(db, "kisi_ekle", id, $"kişi #{yeniId}");
        return Ok(new { id = yeniId });
    }

    [HttpPut("Donem/{id:int}/Kisi/{kisiId:int}")]
    public IActionResult KisiGuncelle(int id, int kisiId, [FromBody] KisiDuzenle g)
    {
        if (!Yetkili) return Yasak();
        if (g is null) return BadRequest(new { hata = "Veri yok." });
        using var db = _vt.Baglanti();
        var k = db.QueryFirstOrDefault<KisiSatiri>(KisiSql.Replace("ORDER BY sube, ad", "AND id = @kisiId"), new { id, kisiId });
        if (k is null) return NotFound(new { hata = "Kişi bulunamadı." });
        var ucretDegisti = (g.Grm is { } gr && gr != k.Grm) || (g.BordroNet is { } bn && bn != k.BordroNet);
        db.Execute(@"
UPDATE KRY_BUTCE_KISI SET sube = @sube, bolum = @bolum, sicil = @sicil, ad = @ad, gun = @gun, emekli = @emekli, meslek = @meslek,
    grm_onceki = @grmOnceki, grm = @grm, bordro_net = @bordroNet, yan_giderler = @yan, aktif = @aktif, notu = @notu, elle = @elle, guncelleyen = @kim, guncelleme = SYSDATETIME()
WHERE id = @kisiId AND donem_id = @id", new
        {
            id, kisiId, sube = K(g.Sube ?? k.Sube, 100), bolum = K(g.Bolum ?? k.Bolum, 60), sicil = K(g.Sicil ?? k.Sicil, 30), ad = K(g.Ad ?? k.Ad, 150),
            gun = g.Gun is { } gn ? Math.Clamp(gn, 1, 30) : k.Gun, emekli = g.Emekli ?? k.Emekli, meslek = K(g.Meslek ?? k.Meslek, 100),
            grmOnceki = g.GrmOnceki ?? k.GrmOnceki, grm = g.Grm ?? k.Grm, bordroNet = g.BordroNet ?? k.BordroNet, yan = g.YanGiderler is null ? k.YanGiderler : YanGiderJson(g.YanGiderler), aktif = g.Aktif ?? k.Aktif,
            notu = K(g.Notu ?? k.Notu, 300), elle = k.Elle || ucretDegisti, kim = AdSoyad,
        });
        Logla(db, "kisi_guncelle", id, $"kişi #{kisiId}" + (ucretDegisti ? " · ücret" : ""));
        return Ok(new { tamam = true });
    }

    [HttpDelete("Donem/{id:int}/Kisi/{kisiId:int}")]
    public IActionResult KisiSil(int id, int kisiId)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var n = db.Execute("DELETE FROM KRY_BUTCE_KISI WHERE id = @kisiId AND donem_id = @id", new { id, kisiId });
        if (n == 0) return NotFound(new { hata = "Kişi bulunamadı." });
        Logla(db, "kisi_sil", id, $"kişi #{kisiId}");
        return Ok(new { tamam = true });
    }

    public class TopluGirdi
    {
        public List<int> Ids { get; set; }
        /// <summary>Bordro netine oran (0.10 = %10)</summary>
        public decimal? BordroOran { get; set; }
        /// <summary>GRM'ye oran; null = bordro oranıyla aynı</summary>
        public decimal? GrmOran { get; set; }
        public int? Gun { get; set; }
        public bool? Emekli { get; set; }
        public bool? Aktif { get; set; }
        public string Meslek { get; set; }
        public string Sube { get; set; }
    }

    /// <summary>Seçili kişilere toplu zam / alan değişikliği (kimlikler gövdede)</summary>
    [HttpPost("Donem/{id:int}/KisilerToplu")]
    public IActionResult KisilerToplu(int id, [FromBody] TopluGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (g?.Ids is null || g.Ids.Count == 0) return BadRequest(new { hata = "Kişi seçilmedi." });
        using var db = _vt.Baglanti();
        var n = 0;
        foreach (var kisiId in g.Ids.Distinct())
        {
            var k = db.QueryFirstOrDefault<KisiSatiri>(KisiSql.Replace("ORDER BY sube, ad", "AND id = @kisiId"), new { id, kisiId });
            if (k is null) continue;
            var bordro = k.BordroNet; var grm = k.Grm; var elle = k.Elle;
            if (g.BordroOran is { } bo) { bordro = Math.Round(bordro * (1 + bo), 2); grm = Math.Round(grm * (1 + (g.GrmOran ?? bo)), 2); elle = true; }
            db.Execute(@"UPDATE KRY_BUTCE_KISI SET bordro_net = @bordro, grm = @grm, gun = @gun, emekli = @emekli, aktif = @aktif, meslek = @meslek, sube = @sube, elle = @elle,
guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE id = @kisiId", new
            {
                kisiId, bordro, grm, gun = g.Gun is { } gn ? Math.Clamp(gn, 1, 30) : k.Gun, emekli = g.Emekli ?? k.Emekli, aktif = g.Aktif ?? k.Aktif,
                meslek = K(g.Meslek, 100) ?? k.Meslek, sube = K(g.Sube, 100) ?? k.Sube, elle, kim = AdSoyad,
            });
            n++;
        }
        Logla(db, "kisi_toplu", id, $"{n} kişi" + (g.BordroOran is { } o ? $" · zam %{o * 100:0.##}" : ""));
        return Ok(new { adet = n });
    }

    /* ==================================================================== */
    /* Parametre ve zam kuralları                                            */
    /* ==================================================================== */

    [HttpPut("Donem/{id:int}/Parametre")]
    public IActionResult ParametreGuncelle(int id, [FromBody] H.Parametre p)
    {
        if (!Yetkili) return Yasak();
        if (p is null) return BadRequest(new { hata = "Parametre yok." });
        var hata = ParametreDogrula(p);
        if (hata is not null) return BadRequest(new { hata });
        using var db = _vt.Baglanti();
        var d = DonemOku(db, id);
        if (d is null) return NotFound(new { hata = "Dönem bulunamadı." });
        p.Yil = d.Yil;
        ParametreYaz(db, id, p, AdSoyad);
        Logla(db, "parametre", id, $"asgari {p.AsgariUcretBrut} · SGK işv. {p.SgkIsveren} · {p.YanGiderler?.Count} yan gider");
        var sonuc = H.SenaryoHesapla(KisileriOku(db, id).Select(k => k.Kisi()), p, kisileriEkle: false);
        return Ok(new { ozet = OzetNesne(sonuc) });
    }

    private static string ParametreDogrula(H.Parametre p)
    {
        if (p.AsgariUcretBrut <= 0) return "Asgari ücret sıfırdan büyük olmalı.";
        if (p.TavanKatsayisi <= 0) return "Tavan katsayısı sıfırdan büyük olmalı.";
        if (p.VergiDilimleri is null || p.VergiDilimleri.Count == 0) return "En az bir vergi dilimi gerekli.";
        decimal? once = null;
        foreach (var d in p.VergiDilimleri)
        {
            if (d.Oran is < 0 or > 1) return "Vergi oranı 0 ile 1 arasında olmalı (0,15 = %15).";
            if (d.UstSinir is { } u && once is { } o && u <= o) return "Vergi dilimleri artan sırada olmalı.";
            if (d.UstSinir is { } u2) once = u2;
        }
        if (p.VergiDilimleri[^1].UstSinir is not null) return "Son vergi diliminin üst sınırı boş (sınırsız) olmalı.";
        foreach (var o in new[] { p.SgkIsci, p.IssizlikIsci, p.DamgaVergisi, p.SgkIsveren, p.IsverenIndirim, p.IssizlikIsveren, p.SgdpIsci, p.SgdpIsveren })
            if (o is < 0 or > 1) return "Oranlar 0 ile 1 arasında olmalı (0,14 = %14).";
        foreach (var t in p.TekSeferlikler ?? new()) if (t.Ay is < 1 or > 12) return $"'{t.Ad}' kaleminin ayı 1–12 arasında olmalı.";
        return null;
    }

    public class KuralGirdi
    {
        public string Tur { get; set; }
        public string Sube { get; set; }
        public string Meslek { get; set; }
        public int? KisiId { get; set; }
        public decimal BordroOran { get; set; }
        public decimal? GrmOran { get; set; }
        public string Aciklama { get; set; }
    }

    private static readonly string[] KuralTurleri = { "genel", "sube", "meslek", "subeMeslek", "kisi" };

    private void KurallariYaz(System.Data.IDbConnection db, int donemId, IEnumerable<KuralGirdi> kurallar)
    {
        db.Execute("DELETE FROM KRY_BUTCE_ZAM_KURAL WHERE donem_id = @donemId", new { donemId });
        var sira = 0;
        foreach (var r in kurallar ?? Enumerable.Empty<KuralGirdi>())
        {
            if (r is null || !KuralTurleri.Contains(r.Tur)) continue;
            db.Execute("INSERT INTO KRY_BUTCE_ZAM_KURAL (donem_id, tur, sube, meslek, kisi_id, bordro_oran, grm_oran, aciklama, sira) VALUES (@donemId, @tur, @sube, @meslek, @kisiId, @bo, @go, @aciklama, @sira)",
                new { donemId, tur = r.Tur, sube = K(r.Sube, 100), meslek = K(r.Meslek, 100), kisiId = r.KisiId, bo = r.BordroOran, go = r.GrmOran, aciklama = K(r.Aciklama, 300), sira = sira++ });
        }
    }

    /// <summary>Kuralları kaydeder; "uygula" seçiliyse baz değerlerden yeniden hesaplar (elle düzeltilen kişiler korunur)</summary>
    [HttpPut("Donem/{id:int}/Kurallar")]
    public IActionResult KurallarGuncelle(int id, [FromBody] List<KuralGirdi> kurallar, [FromQuery] bool uygula = false)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var d = DonemOku(db, id);
        if (d is null) return NotFound(new { hata = "Dönem bulunamadı." });
        KurallariYaz(db, id, kurallar);
        var n = 0;
        if (uygula) n = KurallariUygula(db, id);
        Logla(db, "kurallar", id, $"{kurallar?.Count ?? 0} kural" + (uygula ? $" · {n} kişiye uygulandı" : ""));
        return Ok(new { tamam = true, uygulanan = n });
    }

    /// <summary>
    /// Kişinin baz değerleri (baz_bordro_net / baz_grm = kopyalandığı senaryodaki
    /// ücret) üzerine kuralları uygular. Elle düzeltilen (elle = 1) kişilere
    /// dokunmaz. Baz değeri olmayan kişide bugünkü değer baz sayılır.
    /// </summary>
    private int KurallariUygula(System.Data.IDbConnection db, int donemId)
    {
        var p = ParametreOku(db, donemId);
        var kurallar = KurallariOku(db, donemId).Select(r => r.Kural()).ToList();
        var kisiler = KisileriOku(db, donemId);
        var baz = kisiler.Where(k => !k.Elle).Select(k =>
        {
            var b = k.Kisi();
            b.BordroNet = k.BazBordroNet ?? k.BordroNet;
            b.Grm = k.BazGrm ?? k.Grm;
            return b;
        }).ToList();
        /* Kişiye özel kalemler senaryo oluşturulurken artırıldı; yeniden uygulamada dokunulmaz */
        var pKalemsiz = p.Kopya(); pKalemsiz.KisiKalemArtis = 0m;
        var yeni = H.ZamUygula(baz, kurallar, pKalemsiz);
        var n = 0;
        foreach (var y in yeni)
        {
            db.Execute("UPDATE KRY_BUTCE_KISI SET bordro_net = @b, grm = @g, guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE id = @id AND donem_id = @donemId",
                new { id = y.Id, donemId, b = y.BordroNet, g = y.Grm, kim = AdSoyad });
            n++;
        }
        return n;
    }

    [HttpPost("Donem/{id:int}/KurallariUygula")]
    public IActionResult KurallariUygulaUcu(int id)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        if (DonemOku(db, id) is null) return NotFound(new { hata = "Dönem bulunamadı." });
        var n = KurallariUygula(db, id);
        Logla(db, "kural_uygula", id, $"{n} kişi");
        return Ok(new { uygulanan = n });
    }

    /* ==================================================================== */
    /* Senaryo: baz dönemden yeni yıl                                        */
    /* ==================================================================== */

    public class SenaryoGirdi
    {
        public int BazDonemId { get; set; }
        public string Ad { get; set; }
        public int Yil { get; set; }
        public string Aciklama { get; set; }
        public H.Parametre Parametre { get; set; }
        public List<KuralGirdi> Kurallar { get; set; }
        /// <summary>Bazdaki kişi kimlikleri; bu kişiler yeni senaryoda pasif (ayrılacak) sayılır</summary>
        public List<int> PasifKisiler { get; set; }
    }

    private (DonemSatiri Baz, List<KisiSatiri> BazKisiler, H.Parametre Parametre, List<H.Kisi> Yeni, string Hata) SenaryoHazirla(System.Data.IDbConnection db, SenaryoGirdi g)
    {
        if (g is null) return (null, null, null, null, "Veri yok.");
        var baz = DonemOku(db, g.BazDonemId);
        if (baz is null) return (null, null, null, null, "Baz dönem bulunamadı.");
        var p = g.Parametre ?? ParametreOku(db, g.BazDonemId).Kopya();
        p.Yil = g.Yil > 0 ? g.Yil : baz.Yil + 1;
        var hata = ParametreDogrula(p);
        if (hata is not null) return (null, null, null, null, hata);
        var bazKisiler = KisileriOku(db, g.BazDonemId);
        var pasif = new HashSet<int>(g.PasifKisiler ?? new());
        var kurallar = (g.Kurallar ?? new()).Where(r => r is not null && KuralTurleri.Contains(r.Tur))
            .Select(r => new H.ZamKurali { Tur = r.Tur, Sube = r.Sube, Meslek = r.Meslek, KisiId = r.KisiId, BordroOran = r.BordroOran, GrmOran = r.GrmOran, Aciklama = r.Aciklama }).ToList();
        var yeni = H.ZamUygula(bazKisiler.Where(k => k.Aktif).Select(k => k.Kisi()), kurallar, p);
        foreach (var y in yeni) if (pasif.Contains(y.Id)) y.Aktif = false;
        return (baz, bazKisiler, p, yeni, null);
    }

    /// <summary>Kaydetmeden hesapla: sihirbazın canlı önizlemesi</summary>
    [HttpPost("Onizle")]
    public IActionResult Onizle([FromBody] SenaryoGirdi g)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var (baz, bazKisiler, p, yeni, hata) = SenaryoHazirla(db, g);
        if (hata is not null) return BadRequest(new { hata });
        var bazSonuc = H.SenaryoHesapla(bazKisiler.Select(k => k.Kisi()), ParametreOku(db, g.BazDonemId), kisileriEkle: false);
        var yeniSonuc = H.SenaryoHesapla(yeni, p, kisileriEkle: false);
        Logla(db, "onizle", g.BazDonemId, $"{g.Ad} · {p.Yil}");
        return Ok(new { baz = OzetNesne(bazSonuc), yeni = OzetNesne(yeniSonuc), asgariNet = H.AsgariNet(p) });
    }

    [HttpPost("Senaryo")]
    public IActionResult SenaryoOlustur([FromBody] SenaryoGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (string.IsNullOrWhiteSpace(g?.Ad)) return BadRequest(new { hata = "Senaryo adı gerekli." });
        using var db = _vt.Baglanti();
        var (baz, _, p, yeni, hata) = SenaryoHazirla(db, g);
        if (hata is not null) return BadRequest(new { hata });

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_BUTCE_DONEM (ad, yil, baz_donem_id, durum, aciklama, kaynak, olusturan)
OUTPUT INSERTED.id VALUES (@ad, @yil, @baz, N'taslak', @aciklama, N'senaryo', @kim)",
            new { ad = g.Ad.Trim(), yil = p.Yil, baz = baz.Id, aciklama = g.Aciklama, kim = AdSoyad });
        ParametreYaz(db, id, p, AdSoyad);
        KurallariYaz(db, id, g.Kurallar);

        /* Baz değerler = kopyalanan senaryonun ücretleri; kurallar sonradan yeniden uygulanabilsin */
        var bazKisiler = KisileriOku(db, baz.Id).ToDictionary(k => k.Id);
        foreach (var y in yeni)
        {
            var b = bazKisiler.GetValueOrDefault(y.Id);
            db.Execute(@"
INSERT INTO KRY_BUTCE_KISI (donem_id, sube, bolum, sicil, ad, gun, emekli, meslek, grm_onceki, grm, bordro_net, yan_giderler, baz_grm, baz_bordro_net, baz_kisi_id, aktif, notu, guncelleyen, guncelleme)
VALUES (@donemId, @sube, @bolum, @sicil, @ad, @gun, @emekli, @meslek, @grmOnceki, @grm, @bordroNet, @yan, @bazGrm, @bazBordro, @bazId, @aktif, @notu, @kim, SYSDATETIME())",
                new
                {
                    donemId = id, sube = y.Sube, bolum = y.Bolum, sicil = y.Sicil, ad = y.Ad, gun = y.Gun, emekli = y.Emekli, meslek = y.Meslek,
                    grmOnceki = y.GrmOnceki, grm = y.Grm, bordroNet = y.BordroNet, yan = YanGiderJson(y.YanGiderler), bazGrm = b?.Grm, bazBordro = b?.BordroNet, bazId = y.Id, aktif = y.Aktif, notu = b?.Notu, kim = AdSoyad,
                });
        }
        Logla(db, "senaryo_olustur", id, $"{g.Ad} · {p.Yil} · baz #{baz.Id} · {yeni.Count} kişi · {g.Kurallar?.Count ?? 0} kural");
        return Ok(new { id });
    }

    /* ==================================================================== */
    /* Karşılaştırma, Mikro eşleme, günlük                                   */
    /* ==================================================================== */

    /// <summary>İki senaryonun özeti yan yana (kimlikler sorguda; ücret yok)</summary>
    [HttpGet("Karsilastir")]
    public IActionResult Karsilastir([FromQuery] int a, [FromQuery] int b)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var da = DonemOku(db, a); var dbb = DonemOku(db, b);
        if (da is null || dbb is null) return NotFound(new { hata = "Dönem bulunamadı." });
        var sa = H.SenaryoHesapla(KisileriOku(db, a).Select(k => k.Kisi()), ParametreOku(db, a), kisileriEkle: false);
        var sb = H.SenaryoHesapla(KisileriOku(db, b).Select(k => k.Kisi()), ParametreOku(db, b), kisileriEkle: false);
        Logla(db, "karsilastir", a, $"#{a} ↔ #{b}");
        return Ok(new { a = new { donem = DonemNesnesi(da), ozet = OzetNesne(sa) }, b = new { donem = DonemNesnesi(dbb), ozet = OzetNesne(sb) } });
    }

    /// <summary>Bütçedeki kişiler ile Mikro'daki aktif personelin eşlemesi (ad, sicil, şube — ücret yok)</summary>
    [HttpGet("Donem/{id:int}/MikroKarsilastir")]
    public IActionResult MikroKarsilastir(int id)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        if (DonemOku(db, id) is null) return NotFound(new { hata = "Dönem bulunamadı." });
        List<PersonelKaydi> mikro;
        try { mikro = _personelKaynak.TumPersonelleriGetir(); }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Bütçe Mikro eşlemesi: personel okunamadı");
            return Ok(new { hazir = false, hata = "Mikro personel listesi okunamadı." });
        }
        static string N(string s) => new string((s ?? "").Where(char.IsDigit).ToArray());
        var bugun = DateTime.Today;
        var aktifMikro = mikro.Where(p => p.Durum == 1 && (p.CikisTarihi is null || p.CikisTarihi > bugun)).ToList();
        var mikroTc = new HashSet<string>(aktifMikro.Select(p => N(p.KimlikNo)).Where(x => x.Length == 11));
        var mikroSicil = new HashSet<string>(aktifMikro.Select(p => N(p.PersonelKodu)).Where(x => x.Length > 0));
        var kisiler = KisileriOku(db, id).Where(k => k.Aktif).ToList();
        var butceAnahtar = new HashSet<string>(kisiler.Select(k => N(k.Sicil)).Where(x => x.Length > 0));

        /* Sicilsiz kişiler (Excel'deki "boş kadro" satırları) eşlenemez; ayrı sayılır */
        var sicilsiz = kisiler.Count(k => N(k.Sicil).Length == 0);
        var butcedeOlupMikrodaYok = kisiler
            .Where(k => { var s = N(k.Sicil); return s.Length > 0 && !mikroTc.Contains(s) && !mikroSicil.Contains(s); })
            .Select(k => new { id = k.Id, ad = k.Ad, sube = k.Sube, meslek = k.Meslek, sicil = k.Sicil }).ToList();
        var mikrodaOlupButcedeYok = aktifMikro
            .Where(p => !butceAnahtar.Contains(N(p.KimlikNo)) && !butceAnahtar.Contains(N(p.PersonelKodu)))
            .Select(p => new { ad = $"{p.Ad} {p.Soyad}".Trim(), sube = p.IsGrubu, pozisyon = p.Pozisyon, sicil = p.PersonelKodu, giris = p.GirisTarihi })
            .OrderBy(p => p.sube).ThenBy(p => p.ad).ToList();
        Logla(db, "mikro_esleme", id, $"{butcedeOlupMikrodaYok.Count} / {mikrodaOlupButcedeYok.Count}");
        return Ok(new { hazir = true, mikroAktif = aktifMikro.Count, butceAktif = kisiler.Count, sicilsiz, butcedeOlupMikrodaYok, mikrodaOlupButcedeYok });
    }

    public class LogGirdi
    {
        public string Islem { get; set; }
        public int? DonemId { get; set; }
        public string Ayrinti { get; set; }
    }

    /// <summary>Panelde üretilen Excel / yazdırma gibi dışa aktarmaların günlüğe yazılması</summary>
    [HttpPost("Log")]
    public IActionResult LogYaz([FromBody] LogGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (string.IsNullOrWhiteSpace(g?.Islem)) return BadRequest(new { hata = "İşlem gerekli." });
        using var db = _vt.Baglanti();
        Logla(db, "panel_" + K(g.Islem, 30), g.DonemId, g.Ayrinti);
        return Ok(new { tamam = true });
    }

    [HttpGet("Gunluk")]
    public IActionResult Gunluk([FromQuery] int adet = 200)
    {
        if (!Yetkili) return Yasak();
        using var db = _vt.Baglanti();
        var l = db.Query(@"SELECT TOP (@adet) l.id, l.kullanici, l.ad, l.rol, l.islem, l.donem_id, d.ad AS donem_ad, l.ayrinti, l.ip, l.zaman
FROM KRY_BUTCE_LOG l LEFT JOIN KRY_BUTCE_DONEM d ON d.id = l.donem_id ORDER BY l.id DESC", new { adet = Math.Clamp(adet, 1, 1000) })
            .Select(x => new { id = (int)x.id, kullanici = (string)x.kullanici, ad = (string)x.ad, rol = (string)x.rol, islem = (string)x.islem, donemId = (int?)x.donem_id, donemAd = (string)x.donem_ad, ayrinti = (string)x.ayrinti, ip = (string)x.ip, zaman = (DateTime)x.zaman })
            .ToList();
        return Ok(new { kayitlar = l });
    }
}

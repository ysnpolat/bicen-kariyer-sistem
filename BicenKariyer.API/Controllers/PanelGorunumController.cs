using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetim → Panel Görünümü (03.10.2026).
///
/// <para>
/// Kenar menünün üstündeki marka bloğu: başlık, alt başlık ve logo rozeti.
/// Ayar KRY_AYARLAR'da <c>PANEL_GORUNUM</c> anahtarında JSON olarak duruyor.
/// </para>
///
/// <para>
/// Yüklenen menü logosu ayrı tabloda (KRY_PANEL_LOGO, varbinary). Kurum
/// logosuna (wwwroot/logo.png — e-postalarda ve aday sayfasında kullanılan)
/// hiç dokunulmuyor; "Kurum logosu" seçeneği yalnızca o adresi gösteriyor.
/// </para>
///
/// <para>
/// Her yükleme yeni bir sürüm numarasıyla ayrı satıra yazılıyor. Ayar
/// kaydedilene kadar menüdeki logo değişmiyor; ayar ekranı yeni sürümü
/// önizlemede gösterebiliyor. Kaydedilen sürüm dışındaki satırlar
/// kaydetmede ve yeni yüklemede temizleniyor (en fazla iki satır kalır:
/// geçerli olan ve henüz kaydedilmemiş son yükleme).
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class PanelGorunumController : ControllerBase
{
    /// <summary>Düzenleyebilen roller: menü herkesin ekranını etkiliyor.</summary>
    public const string Duzenleyenler =
        Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi;

    private const long LogoSiniri = 1024 * 1024;

    private readonly AyarServisi _ayar;
    private readonly VeritabaniServisi _vt;
    private readonly GuvenlikGunlugu _gunluk;

    public PanelGorunumController(AyarServisi ayar, VeritabaniServisi vt, GuvenlikGunlugu gunluk)
    {
        _ayar = ayar;
        _vt = vt;
        _gunluk = gunluk;
    }

    /* ==================================================================== */
    /* Ayar                                                                 */
    /* ==================================================================== */

    /// <summary>Her panel kullanıcısının kenar menüsü bunu okuyor.</summary>
    [HttpGet]
    [Authorize]
    public IActionResult Oku() => Ok(Cevap(AyarOku()));

    [HttpPost]
    [Authorize(Roles = Duzenleyenler)]
    public IActionResult Kaydet([FromBody] PanelGorunumAyari girdi)
    {
        if (girdi is null) return BadRequest(new { hata = "Ayar okunamadı." });

        var hata = Temizle(girdi);
        if (hata is not null) return BadRequest(new { hata });

        using var db = _vt.Baglanti();

        if (girdi.LogoSurum > 0 && !GorselVar(db, girdi.LogoSurum))
            girdi.LogoSurum = 0;

        if (girdi.LogoTuru == PanelGorunumAyari.TurGorsel && girdi.LogoSurum == 0)
            return BadRequest(new { hata = "Yüklenen görsel bulunamadı. Önce bir görsel yükleyiniz." });

        _ayar.Yaz(PanelGorunumAyari.Anahtar, girdi);

        /* Kaydedilmeyen eski yüklemeler artık kullanılmıyor */
        db.Execute("DELETE FROM KRY_PANEL_LOGO WHERE surum <> @s", new { s = girdi.LogoSurum });

        _gunluk.Yaz("PANEL GÖRÜNÜMÜ", IstemciAdresi.Bul(HttpContext),
            $"{User.Identity?.Name}: başlık \"{girdi.Baslik}\", logo {girdi.LogoTuru}");

        return Ok(new { basarili = true, ayar = Cevap(girdi) });
    }

    /* ==================================================================== */
    /* Menü logosu                                                          */
    /* ==================================================================== */

    /// <summary>
    /// Menü logosunu yükler. Ayar kaydedilene kadar menüde görünmez;
    /// dönen sürüm numarası kaydedilecek ayara yazılır.
    /// </summary>
    [HttpPost("Logo")]
    [Authorize(Roles = Duzenleyenler)]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> LogoYukle(IFormFile dosya)
    {
        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Dosya seçilmedi." });

        if (dosya.Length > LogoSiniri)
            return BadRequest(new { hata = "Logo en fazla 1 MB olabilir." });

        byte[] icerik;

        using (var akis = new MemoryStream())
        {
            await dosya.CopyToAsync(akis);
            icerik = akis.ToArray();
        }

        var (tur, hata) = TurBul(icerik);
        if (hata is not null) return BadRequest(new { hata });

        var gecerli = AyarOku().LogoSurum;

        using var db = _vt.Baglanti();

        /* Sürüm numarası aynı zamanda önbellek kırıcı: her yüklemede artar */
        var enBuyuk = db.ExecuteScalar<long?>("SELECT MAX(surum) FROM KRY_PANEL_LOGO") ?? 0;
        var surum = Math.Max(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Math.Max(enBuyuk, gecerli) + 1);

        db.Execute(@"
INSERT INTO KRY_PANEL_LOGO (surum, icerik, tur, boyut, yukleyen)
VALUES (@surum, @icerik, @tur, @boyut, @yukleyen);

DELETE FROM KRY_PANEL_LOGO WHERE surum <> @surum AND surum <> @gecerli;",
            new { surum, icerik, tur, boyut = icerik.Length, yukleyen = User.Identity?.Name, gecerli });

        _gunluk.Yaz("PANEL LOGOSU YÜKLENDİ", IstemciAdresi.Bul(HttpContext),
            $"{User.Identity?.Name}: {tur}, {icerik.Length} bayt");

        return Ok(new { logoSurum = surum, tur, boyut = icerik.Length });
    }

    /// <summary>
    /// Menü logosunu siler. Menü görselle gösteriliyorsa harf rozetine döner;
    /// diğer ayarlar olduğu gibi kalır.
    /// </summary>
    [HttpDelete("Logo")]
    [Authorize(Roles = Duzenleyenler)]
    public IActionResult LogoSil()
    {
        var ayar = AyarOku();

        using (var db = _vt.Baglanti())
            db.Execute("DELETE FROM KRY_PANEL_LOGO");

        ayar.LogoSurum = 0;
        if (ayar.LogoTuru == PanelGorunumAyari.TurGorsel) ayar.LogoTuru = PanelGorunumAyari.TurHarf;

        _ayar.Yaz(PanelGorunumAyari.Anahtar, ayar);

        _gunluk.Yaz("PANEL LOGOSU SİLİNDİ", IstemciAdresi.Bul(HttpContext), User.Identity?.Name ?? "");

        return Ok(new { basarili = true, ayar = Cevap(ayar) });
    }

    /// <summary>
    /// Menü logosu. Herkese açık: yalnızca bir logo.
    ///
    /// <para>
    /// <c>v</c> verilip o sürüm bulunursa içerik değişmez, uzun süre
    /// önbellekte kalabilir. Verilmezse kaydedilmiş geçerli logo döner ve her
    /// seferinde doğrulanır (ETag).
    /// </para>
    /// </summary>
    [HttpGet("Logo")]
    [AllowAnonymous]
    public IActionResult Logo([FromQuery] long v = 0)
    {
        using var db = _vt.Baglanti();

        LogoSatiri satir = null;

        if (v > 0)
            satir = db.QueryFirstOrDefault<LogoSatiri>(
                "SELECT surum AS Surum, icerik AS Icerik, tur AS Tur FROM KRY_PANEL_LOGO WHERE surum = @v", new { v });

        var surumlu = satir is not null;

        if (satir is null)
        {
            var gecerli = AyarOku().LogoSurum;

            if (gecerli > 0)
                satir = db.QueryFirstOrDefault<LogoSatiri>(
                    "SELECT surum AS Surum, icerik AS Icerik, tur AS Tur FROM KRY_PANEL_LOGO WHERE surum = @v",
                    new { v = gecerli });
        }

        if (satir?.Icerik is null || satir.Icerik.Length == 0) return NotFound();

        var basliklar = Response.Headers;
        var etiket = $"\"pg-{satir.Surum}\"";

        basliklar.ETag = etiket;
        basliklar.CacheControl = surumlu
            ? "public, max-age=31536000, immutable"
            : "no-cache";

        /* SVG doğrudan açılırsa betik çalıştıramasın (yüklemede de
           denetleniyor; bu ikinci kat) */
        basliklar["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

        /* Panel başka bir alan adından yayınlanabiliyor; img etiketiyle
           yüklenebilsin */
        basliklar["Cross-Origin-Resource-Policy"] = "cross-origin";

        if (Request.Headers.IfNoneMatch.ToString().Contains(etiket))
            return StatusCode(StatusCodes.Status304NotModified);

        return File(satir.Icerik, satir.Tur);
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    private PanelGorunumAyari AyarOku()
    {
        PanelGorunumAyari ayar;

        try
        {
            ayar = _ayar.Oku(PanelGorunumAyari.Anahtar, new PanelGorunumAyari());
        }
        catch
        {
            ayar = new PanelGorunumAyari();
        }

        /* Elle bozulmuş bir kayıt menüyü bozmasın */
        if (Temizle(ayar) is not null) ayar = new PanelGorunumAyari { LogoSurum = ayar.LogoSurum };

        return ayar;
    }

    private static object Cevap(PanelGorunumAyari a) => new
    {
        baslik = a.Baslik,
        altBaslik = a.AltBaslik,
        logoTuru = a.LogoTuru,
        harf = a.Harf,
        renk = a.Renk,
        renk1 = a.Renk1,
        renk2 = a.Renk2,
        gorselZemin = a.GorselZemin,
        logoSurum = a.LogoSurum,
    };

    private static bool GorselVar(System.Data.IDbConnection db, long surum) =>
        db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_PANEL_LOGO WHERE surum = @s", new { s = surum }) > 0;

    private static readonly Regex Hex = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);

    /// <summary>Alanları düzeltir; kabul edilemeyen bir değerde hata metni döner.</summary>
    private static string Temizle(PanelGorunumAyari a)
    {
        a.Baslik = (a.Baslik ?? "").Trim();
        a.AltBaslik = (a.AltBaslik ?? "").Trim();
        a.Harf = (a.Harf ?? "").Trim();

        if (a.Baslik.Length == 0) a.Baslik = PanelGorunumAyari.VarsayilanBaslik;

        if (a.Baslik.Length > PanelGorunumAyari.EnUzun)
            return $"Başlık en fazla {PanelGorunumAyari.EnUzun} karakter olabilir.";

        if (a.AltBaslik.Length > PanelGorunumAyari.EnUzun)
            return $"Alt başlık en fazla {PanelGorunumAyari.EnUzun} karakter olabilir.";

        if (a.Harf.Length == 0) a.Harf = PanelGorunumAyari.VarsayilanHarf;

        if (new StringInfo(a.Harf).LengthInTextElements > 2)
            return "Rozet en fazla 2 karakter olabilir.";

        if (a.LogoTuru is not (PanelGorunumAyari.TurHarf or PanelGorunumAyari.TurGorsel or PanelGorunumAyari.TurKurum))
            a.LogoTuru = PanelGorunumAyari.TurHarf;

        if (a.GorselZemin is not ("beyaz" or "seffaf")) a.GorselZemin = "beyaz";

        if (!PanelGorunumAyari.Renkler.Contains(a.Renk ?? "")) a.Renk = "yesil";

        if (a.Renk == "ozel")
        {
            if (!Hex.IsMatch(a.Renk1 ?? "") || !Hex.IsMatch(a.Renk2 ?? ""))
                return "Özel renk için iki renk seçiniz (#RRGGBB).";
        }
        else
        {
            a.Renk1 = null;
            a.Renk2 = null;
        }

        if (a.LogoSurum < 0) a.LogoSurum = 0;

        return null;
    }

    /// <summary>
    /// Dosya türünü uzantıya değil içeriğe bakarak bulur.
    /// PNG, JPEG ve WebP imzayla; SVG ayrıştırılarak denetlenir.
    /// </summary>
    private static (string tur, string hata) TurBul(byte[] b)
    {
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
            && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            return ("image/png", null);

        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
            return ("image/jpeg", null);

        if (b.Length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
            && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P')
            return ("image/webp", null);

        var svgHata = SvgDenetle(b);

        return svgHata is null
            ? ("image/svg+xml", null)
            : (null, svgHata);
    }

    /// <summary>
    /// SVG'yi temizlemek yerine riskli bir şey içeriyorsa reddeder:
    /// betik, olay öznitelikleri (on…), dış bağlantı, foreignObject,
    /// DOCTYPE/ENTITY. Logo için bunların hiçbiri gerekmiyor.
    /// </summary>
    private static string SvgDenetle(byte[] b)
    {
        const string tanimsiz = "Desteklenmeyen dosya. PNG, JPG, WebP ya da SVG yükleyiniz.";
        const string riskli = "SVG betik, olay özniteliği ya da dış bağlantı içeremez.";

        string metin;

        try
        {
            metin = new UTF8Encoding(false, true).GetString(b).TrimStart('﻿');
        }
        catch
        {
            return tanimsiz;
        }

        if (!metin.Contains("<svg", StringComparison.OrdinalIgnoreCase)) return tanimsiz;

        var kucuk = metin.ToLowerInvariant();

        if (kucuk.Contains("<!doctype") || kucuk.Contains("<!entity"))
            return "SVG DOCTYPE ya da ENTITY içeremez; dosyayı bunlar olmadan kaydediniz.";

        if (kucuk.Contains("<script") || kucuk.Contains("javascript:") || kucuk.Contains("<foreignobject")
            || Regex.IsMatch(kucuk, @"[\s""'/]on[a-z]+\s*="))
            return riskli;

        try
        {
            var ayar = new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                IgnoreComments = true,
            };

            using var okuyucu = XmlReader.Create(new StringReader(metin), ayar);

            var kokBulundu = false;

            while (okuyucu.Read())
            {
                if (okuyucu.NodeType != XmlNodeType.Element) continue;

                var ad = okuyucu.LocalName.ToLowerInvariant();

                if (!kokBulundu)
                {
                    if (ad != "svg") return tanimsiz;
                    kokBulundu = true;
                }

                if (ad is "script" or "foreignobject" or "iframe" or "embed" or "object")
                    return riskli;

                if (!okuyucu.HasAttributes) continue;

                for (var i = 0; i < okuyucu.AttributeCount; i++)
                {
                    okuyucu.MoveToAttribute(i);

                    var oz = okuyucu.LocalName.ToLowerInvariant();
                    var deger = (okuyucu.Value ?? "").Trim().ToLowerInvariant();

                    if (oz.StartsWith("on")) return riskli;

                    /* Yalnızca belge içi (#id) ya da gömülü raster görsele izin */
                    if (oz == "href"
                        && !(deger.StartsWith("#")
                             || deger.StartsWith("data:image/png")
                             || deger.StartsWith("data:image/jpeg")
                             || deger.StartsWith("data:image/webp")))
                        return riskli;

                    if (deger.Contains("javascript:")) return riskli;
                }

                okuyucu.MoveToElement();
            }

            return kokBulundu ? null : tanimsiz;
        }
        catch (XmlException)
        {
            return "SVG dosyası okunamadı.";
        }
    }

    private class LogoSatiri
    {
        public long Surum { get; set; }
        public byte[] Icerik { get; set; }
        public string Tur { get; set; }
    }
}

/// <summary>Kenar menünün marka bloğu (KRY_AYARLAR, PANEL_GORUNUM).</summary>
public class PanelGorunumAyari
{
    public const string Anahtar = "PANEL_GORUNUM";

    public const string TurHarf = "harf";
    public const string TurGorsel = "gorsel";
    public const string TurKurum = "kurum";

    public const string VarsayilanBaslik = "Biçen İK";
    public const string VarsayilanAltBaslik = "İnsan Kaynakları Paneli";
    public const string VarsayilanHarf = "b";

    public const int EnUzun = 40;

    /// <summary>Hazır renkler; panel aynı adları kullanıyor.</summary>
    public static readonly string[] Renkler = { "yesil", "turuncu", "mavi", "mor", "kirmizi", "koyu", "ozel" };

    public string Baslik { get; set; } = VarsayilanBaslik;
    public string AltBaslik { get; set; } = VarsayilanAltBaslik;

    /// <summary>harf | gorsel | kurum</summary>
    public string LogoTuru { get; set; } = TurHarf;

    /// <summary>Harf rozetinin 1–2 karakteri</summary>
    public string Harf { get; set; } = VarsayilanHarf;

    /// <summary>Hazır renk adı ya da "ozel" (Renk1 → Renk2 geçişi)</summary>
    public string Renk { get; set; } = "yesil";

    public string Renk1 { get; set; }
    public string Renk2 { get; set; }

    /// <summary>Görsel logonun zemini: beyaz | seffaf</summary>
    public string GorselZemin { get; set; } = "beyaz";

    /// <summary>KRY_PANEL_LOGO'daki geçerli satır; 0 = yüklenmiş görsel yok</summary>
    public long LogoSurum { get; set; }
}

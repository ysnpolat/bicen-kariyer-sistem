using System.Text.Json;
using BicenKariyer.API.Servisler;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İK asistanı ile sohbet.
///
/// Model araç çağırdıkça sunucu ilgili sorguyu çalıştırır ve sonucu geri
/// verir. Bu döngü modelin metin yanıtı üretmesine kadar sürer; sonsuz
/// döngüyü önlemek için tur sınırı vardır.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class SohbetController : ControllerBase
{
    private readonly SohbetServisi _sohbet;
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly ILogger<SohbetController> _kayit;
    private readonly IConfiguration _yapilandirma;

    public SohbetController(
        SohbetServisi sohbet,
        VeritabaniServisi vt,
        AyarServisi ayar,
        GuvenlikGunlugu gunluk,
        ILogger<SohbetController> kayit,
        IConfiguration yapilandirma)
    {
        _yapilandirma = yapilandirma;
        _sohbet = sohbet;
        _vt = vt;
        _ayar = ayar;
        _gunluk = gunluk;
        _kayit = kayit;
    }

    private string Rol =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>
    /// Asistanın durumu.
    ///
    /// Yalnızca "açık mı" demek yetmiyor: kapalıysa sebebini de bildirir,
    /// yoksa düğme görünmediğinde neyin eksik olduğu anlaşılmaz.
    /// </summary>
    [HttpGet("Durum")]
    public IActionResult Durum()
    {
        var yetkiVar = Roller.IslemYetkisi(Rol);
        var ayarAcik = _yapilandirma.GetValue("Sohbet:Acik", false);

        var anahtar = _yapilandirma["Sohbet:Anahtar"]
                   ?? _yapilandirma["YapayZeka:Anahtar"];

        var anahtarVar = !string.IsNullOrWhiteSpace(anahtar);

        return Ok(new
        {
            acik = _sohbet.Etkin && yetkiVar,
            yetkiVar,
            ayarAcik,
            anahtarVar,
            sebep = !yetkiVar
                ? "Bu özellik için yetkiniz bulunmuyor."
                : !ayarAcik
                    ? "Asistan ayarlardan kapatılmış (Sohbet:Acik = false)."
                    : !anahtarVar
                        ? "Yapay zekâ anahtarı tanımlı değil "
                          + "(appsettings.json → Sohbet:Anahtar)."
                        : null
        });
    }

    /// <summary>
    /// Bir aracı doğrudan çalıştırır; asistan yanlış cevap verdiğinde
    /// aracın gerçekte ne döndürdüğünü görmek için.
    /// </summary>
    [HttpGet("AracSina")]
    public IActionResult AracSina(
        [FromQuery] string arac,
        [FromQuery] string girdi = "{}")
    {
        if (!Roller.TamYonetim(Rol))
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (string.IsNullOrWhiteSpace(arac))
            return BadRequest(new
            {
                hata = "Araç adı gerekli.",
                araclar = new[]
                {
                    "qr_okutma_gunluk", "personel_bilgi", "ciro_verimlilik",
                    "norm_kadro", "basvuru_ozet", "sube_listesi"
                }
            });

        var araclar = new SohbetAraclari(_vt, _ayar);

        try
        {
            var cikti = araclar.Calistir(arac, girdi);

            return Content(cikti, "application/json");
        }
        catch (Exception hata)
        {
            return StatusCode(500, new
            {
                hata = hata.Message,
                tur = hata.GetType().Name,
                iz = hata.StackTrace?[..Math.Min(600, hata.StackTrace.Length)]
            });
        }
    }

    /// <summary>
    /// Bir soru gönderir ve yanıtı alır.
    ///
    /// <paramref name="girdi"/> içindeki <c>gecmis</c> önceki mesajları
    /// taşır; model bağlamı korusun diye her istekte gönderilir.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Sor([FromBody] SohbetGirdi girdi)
    {
        if (!Roller.IslemYetkisi(Rol))
            return StatusCode(403, new { hata = "Bu özellik için yetkiniz bulunmuyor." });

        if (!_sohbet.Etkin)
            return StatusCode(503, new
            {
                hata = "Asistan şu anda kullanılamıyor.",
                ayrinti = "Yapay zekâ anahtarı tanımlı değil."
            });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Soru))
            return BadRequest(new { hata = "Soru boş olamaz." });

        if (girdi.Soru.Length > 2000)
            return BadRequest(new { hata = "Soru çok uzun." });

        var araclar = new SohbetAraclari(_vt, _ayar);

        /* Konuşma geçmişi; model bağlamı korusun diye tümü gönderilir */
        var mesajlar = new List<object>();

        foreach (var m in (girdi.Gecmis ?? new List<SohbetMesaji>()).TakeLast(10))
        {
            if (string.IsNullOrWhiteSpace(m.Icerik)) continue;

            mesajlar.Add(new
            {
                role = m.Rol == "asistan" ? "assistant" : "user",
                content = m.Icerik
            });
        }

        mesajlar.Add(new { role = "user", content = girdi.Soru.Trim() });

        var bugun = DateTime.Today.ToString("dd MMMM yyyy dddd",
            new System.Globalization.CultureInfo("tr-TR"));

        var kullanilanAraclar = new List<string>();
        object gorsel = null;

        try
        {
            for (var tur = 0; tur < SohbetServisi.TurSiniri; tur++)
            {
                var sonuc = await _sohbet.TurCalistir(mesajlar, bugun);

                /* Model araç çağırmadıysa yanıt hazırdır */
                if (sonuc.Cagrilar.Count == 0)
                {
                    _gunluk.Yaz("ASİSTAN", "-",
                        $"{Kullanici}: {Kisalt(girdi.Soru)} "
                        + $"[{string.Join(", ", kullanilanAraclar)}]");

                    return Ok(new
                    {
                        yanit = sonuc.Metin,
                        gorsel,
                        araclar = kullanilanAraclar
                    });
                }

                /* Modelin isteği geçmişe eklenir */
                mesajlar.Add(JsonSerializer.Deserialize<object>(sonuc.HamYanit));

                foreach (var cagri in sonuc.Cagrilar)
                {
                    kullanilanAraclar.Add(cagri.Ad);

                    string ciktı;

                    if (cagri.Ad == "gorsel_olustur")
                    {
                        /* Görsel tarifi panele iletilir; modele kısa onay döner */
                        gorsel = JsonSerializer.Deserialize<JsonElement>(cagri.Girdi);
                        ciktı = "{\"durum\":\"görsel eklendi\"}";
                    }
                    else
                    {
                        ciktı = araclar.Calistir(cagri.Ad, cagri.Girdi);

                        /* Araç hata döndürdüyse günlüğe yazılır; kullanıcı
                           "bir hata oluştu" görünce sebebini bulabilelim. */
                        if (ciktı.Contains("\"hata\""))
                        {
                            _kayit.LogWarning(
                                "Asistan aracı hata verdi: {Arac} {Girdi} -> {Cikti}",
                                cagri.Ad, cagri.Girdi,
                                ciktı[..Math.Min(300, ciktı.Length)]);

                            _gunluk.Yaz("ASİSTAN ARAÇ HATASI", "-",
                                $"{cagri.Ad}: {ciktı[..Math.Min(200, ciktı.Length)]}");
                        }
                    }

                    mesajlar.Add(new
                    {
                        role = "tool",
                        tool_call_id = cagri.Id,
                        content = ciktı
                    });
                }
            }

            /* Tur sınırına ulaşıldı */
            return Ok(new
            {
                yanit = "Sorunuzu yanıtlamak için gereken veriye ulaşamadım. "
                      + "Soruyu biraz daha belirginleştirir misiniz?",
                gorsel,
                araclar = kullanilanAraclar
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Asistan yanıt veremedi");

            return StatusCode(502, new
            {
                hata = "Asistan yanıt veremedi.",
                ayrinti = hata.Message
            });
        }
    }

    private static string Kisalt(string metin) =>
        metin.Length <= 120 ? metin : metin[..120] + "...";
}

/// <summary>Sohbet isteği</summary>
public class SohbetGirdi
{
    public string Soru { get; set; }
    public List<SohbetMesaji> Gecmis { get; set; } = new();
}

/// <summary>Konuşma geçmişindeki bir mesaj</summary>
public class SohbetMesaji
{
    /// <summary>"kullanici" ya da "asistan"</summary>
    public string Rol { get; set; }
    public string Icerik { get; set; }
}

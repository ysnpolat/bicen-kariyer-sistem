using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration.Json;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Ayar tanılama (27.10.2026): API'nin hangi ayar dosyasını okuduğu ve
/// bağlantıların / SMS ayarlarının tanımlı olup olmadığı. Değerler asla
/// dönmez; yalnız "tanımlı mı" ve dosya yolları. Yalnız Admin.
/// "Bağlantı tanımlı değil" hatası dosyada değer dururken çıkıyorsa
/// (yanlış klasör, appsettings.Production.json, ortam değişkeni) bunu
/// göstermek için.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin)]
public class AyarTanilamaController : ControllerBase
{
    private readonly IConfiguration _yap;
    private readonly IWebHostEnvironment _ortam;

    public AyarTanilamaController(IConfiguration yap, IWebHostEnvironment ortam)
    {
        _yap = yap;
        _ortam = ortam;
    }

    [HttpGet]
    public IActionResult Getir()
    {
        var kaynaklar = new List<object>();
        if (_yap is IConfigurationRoot kok)
            foreach (var p in kok.Providers)
            {
                if (p is JsonConfigurationProvider j)
                {
                    var yol = j.Source.FileProvider?.GetFileInfo(j.Source.Path ?? "")?.PhysicalPath ?? j.Source.Path;
                    kaynaklar.Add(new
                    {
                        tur = "json",
                        dosya = yol,
                        var = !string.IsNullOrWhiteSpace(yol) && System.IO.File.Exists(yol),
                        posTanimli = p.TryGet("ConnectionStrings:Pos", out var pv) ? !string.IsNullOrWhiteSpace(pv) : (bool?)null,
                        smsTanimli = p.TryGet("Sms:KullaniciAdi", out var sv) ? !string.IsNullOrWhiteSpace(sv) : (bool?)null,
                    });
                }
                else
                {
                    kaynaklar.Add(new
                    {
                        tur = p.GetType().Name,
                        posTanimli = p.TryGet("ConnectionStrings:Pos", out var pv) ? !string.IsNullOrWhiteSpace(pv) : (bool?)null,
                        smsTanimli = p.TryGet("Sms:KullaniciAdi", out var sv) ? !string.IsNullOrWhiteSpace(sv) : (bool?)null,
                    });
                }
            }

        var baglantilar = _yap.GetSection("ConnectionStrings").GetChildren()
            .ToDictionary(x => x.Key, x => !string.IsNullOrWhiteSpace(x.Value));

        return Ok(new
        {
            ortam = _ortam.EnvironmentName,
            icerikKlasoru = _ortam.ContentRootPath,
            baglantilar,
            sms = new
            {
                acik = _yap.GetValue("Sms:Acik", false),
                adres = !string.IsNullOrWhiteSpace(_yap["Sms:Adres"]),
                kullaniciAdi = !string.IsNullOrWhiteSpace(_yap["Sms:KullaniciAdi"]),
                sifre = !string.IsNullOrWhiteSpace(_yap["Sms:Sifre"]),
            },
            /* Sonraki kaynak öncekini ezer: null = o kaynakta anahtar yok */
            kaynaklar,
        });
    }
}

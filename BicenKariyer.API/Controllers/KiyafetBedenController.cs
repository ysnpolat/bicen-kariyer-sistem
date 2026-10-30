using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel kıyafet bedenleri (18.10.2026).
///
/// <para>
/// Beden listesi Yönetim → Kıyafet bedenleri'nden düzenlenir
/// (KRY_AYARLAR, anahtar KIYAFET_BEDENLERI; varsayılan S…XXXL). Kişinin
/// bedeni personel kartından seçilir ve KRY_PERSONEL_BEDEN tablosunda
/// personel koduna bağlı durur. Mikro'ya yazılmaz.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class KiyafetBedenController : ControllerBase
{
    public const string Anahtar = "KIYAFET_BEDENLERI";
    public static readonly string[] Varsayilan = { "S", "M", "L", "XL", "XXL", "XXXL" };

    private const string Yazabilen = Roller.Admin + "," + Roller.GenelMudurYardimcisi + ","
                                     + Roller.IKYoneticisi + "," + Roller.IK;

    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;

    public KiyafetBedenController(VeritabaniServisi vt, PersonelKaynagiServisi kaynak)
    {
        _vt = vt;
        _kaynak = kaynak;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string Temizle(string s) => (s ?? "").Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));

    private List<string> BedenleriOku()
    {
        try
        {
            using var db = _vt.Baglanti();
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = Anahtar });
            var liste = string.IsNullOrWhiteSpace(ham) ? null : JsonSerializer.Deserialize<List<string>>(ham);
            return liste is { Count: > 0 } ? liste : Varsayilan.ToList();
        }
        catch
        {
            return Varsayilan.ToList();
        }
    }

    private Dictionary<string, (string beden, string guncelleyen, DateTime guncelleme)> KayitlariOku()
    {
        using var db = _vt.Baglanti();
        return db.Query<(string kod, string beden, string guncelleyen, DateTime guncelleme)>(
                "SELECT personel_kodu, beden, guncelleyen, guncelleme FROM KRY_PERSONEL_BEDEN")
            .GroupBy(x => K(x.kod))
            .ToDictionary(g => g.Key, g => (g.First().beden, g.First().guncelleyen, g.First().guncelleme),
                StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Tanımlı bedenler (sırasıyla).</summary>
    [HttpGet("Bedenler")]
    public IActionResult Bedenler() => Ok(new { bedenler = BedenleriOku() });

    public sealed class BedenListesi
    {
        public List<string> Bedenler { get; set; } = new();
    }

    /// <summary>Beden listesini kaydeder (sıra korunur, tekrarlar atılır).</summary>
    [HttpPost("Bedenler")]
    [Authorize(Roles = Yazabilen)]
    public IActionResult BedenleriKaydet([FromBody] BedenListesi g)
    {
        var liste = (g?.Bedenler ?? new())
            .Select(Temizle)
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (liste.Count == 0) return BadRequest(new { hata = "En az bir beden olmalı." });
        if (liste.Any(x => x.Length > 20)) return BadRequest(new { hata = "Beden adı en fazla 20 karakter olabilir." });
        if (liste.Count > 40) return BadRequest(new { hata = "En fazla 40 beden tanımlanabilir." });

        using var db = _vt.Baglanti();
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = Anahtar, d = JsonSerializer.Serialize(liste) });

        return Ok(new { bedenler = liste });
    }

    /// <summary>Kişinin bedeni.</summary>
    [HttpGet("Kisi/{sicil}")]
    public IActionResult Kisi(string sicil)
    {
        using var db = _vt.Baglanti();
        var kayit = db.QueryFirstOrDefault<(string beden, string guncelleyen, DateTime? guncelleme)>(
            @"SELECT TOP 1 beden, guncelleyen, guncelleme FROM KRY_PERSONEL_BEDEN
              WHERE personel_kodu = @a OR personel_kodu = @b",
            new { a = (sicil ?? "").Trim(), b = K(sicil) });

        return Ok(new
        {
            beden = kayit.beden,
            guncelleyen = kayit.guncelleyen,
            guncelleme = kayit.guncelleme,
            bedenler = BedenleriOku(),
            duzenlenebilir = User.IsInRole(Roller.Admin) || User.IsInRole(Roller.GenelMudurYardimcisi)
                             || User.IsInRole(Roller.IKYoneticisi) || User.IsInRole(Roller.IK),
        });
    }

    public sealed class BedenGirdisi
    {
        public string Beden { get; set; }
    }

    /// <summary>Kişinin bedenini yazar; boş gönderilirse siler.</summary>
    [HttpPost("Kisi/{sicil}")]
    [Authorize(Roles = Yazabilen)]
    public IActionResult KisiKaydet(string sicil, [FromBody] BedenGirdisi g)
    {
        var kod = (sicil ?? "").Trim();
        if (kod.Length == 0 || kod.Length > 30) return BadRequest(new { hata = "Sicil geçersiz." });

        var beden = Temizle(g?.Beden);
        using var db = _vt.Baglanti();

        if (beden.Length == 0)
        {
            db.Execute("DELETE FROM KRY_PERSONEL_BEDEN WHERE personel_kodu = @a OR personel_kodu = @b",
                new { a = kod, b = K(kod) });
            return Ok(new { beden = (string)null });
        }

        if (!BedenleriOku().Contains(beden, StringComparer.OrdinalIgnoreCase))
            return BadRequest(new { hata = "Bu beden tanımlı değil. Yönetim → Kıyafet bedenleri'nden ekleyin." });

        db.Execute(@"
DELETE FROM KRY_PERSONEL_BEDEN WHERE personel_kodu = @b AND personel_kodu <> @a;
MERGE KRY_PERSONEL_BEDEN AS h
USING (SELECT @a AS personel_kodu) AS k ON h.personel_kodu = k.personel_kodu
WHEN MATCHED THEN UPDATE SET beden = @beden, guncelleyen = @kim, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (personel_kodu, beden, guncelleyen) VALUES (@a, @beden, @kim);",
            new { a = kod, b = K(kod), beden, kim = Kullanici });

        return Ok(new { beden });
    }

    /// <summary>
    /// Çalışan personelin beden listesi ve beden başına sayı (Yönetim
    /// sayfası ve Excel çıktısı). İsteğe bağlı şube süzgeci.
    /// </summary>
    [HttpGet("Liste")]
    [Authorize(Roles = Yazabilen)]
    public IActionResult Liste([FromQuery] string sube = null)
    {
        var kayitlar = KayitlariOku();
        var bedenler = BedenleriOku();

        var kisiler = _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .Where(x => string.IsNullOrWhiteSpace(sube)
                        || string.Equals((x.IsGrubu ?? "").Trim(), sube.Trim(), StringComparison.OrdinalIgnoreCase))
            .GroupBy(x => K(x.PersonelKodu))
            .Select(g => g.First())
            .Select(x =>
            {
                kayitlar.TryGetValue(K(x.PersonelKodu), out var b);
                return new
                {
                    sicil = x.PersonelKodu,
                    adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    sube = x.IsGrubu,
                    pozisyon = x.Pozisyon,
                    beden = b.beden,
                    guncelleyen = b.guncelleyen,
                    guncelleme = b.beden is null ? (DateTime?)null : b.guncelleme,
                };
            })
            .OrderBy(x => x.sube).ThenBy(x => x.adSoyad)
            .ToList();

        var sayilar = bedenler
            .Select(b => new { beden = b, sayi = kisiler.Count(x => string.Equals(x.beden, b, StringComparison.OrdinalIgnoreCase)) })
            .ToList();

        return Ok(new
        {
            bedenler,
            sayilar,
            girilmemis = kisiler.Count(x => x.beden is null),
            tanimsiz = kisiler.Count(x => x.beden is not null && !bedenler.Contains(x.beden, StringComparer.OrdinalIgnoreCase)),
            toplam = kisiler.Count,
            subeler = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1)
                .Select(x => (x.IsGrubu ?? "").Trim()).Where(x => x.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToList(),
            kisiler,
        });
    }
}

using System.Data;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetim › Ayarlar Merkezi (07.10.2026): kodun içindeki süre ve sınırlar
/// (<see cref="Parametre"/>), seçenek listeleri (<see cref="SecenekListesi"/>)
/// ve avans onay akışı (<see cref="AvansAkisi"/>).
///
/// <para>
/// Gizli değerler (veritabanı bağlantısı, JWT, SMS parolası, API
/// anahtarları) burada yok: ne okunuyor ne yazılıyor. Her değişiklik
/// eski → yeni değerle KRY_AYAR_DEGISIKLIK'e yazılıyor; Yönetim sayfasının
/// "son değişiklik" bilgisi ve geçmiş listesi buradan.
/// </para>
///
/// <para>Okuma: Admin, GMY, İK yöneticisi, İK. Yazma: Admin, GMY, İK yöneticisi.</para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class AyarMerkeziController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;

    public AyarMerkeziController(VeritabaniServisi vt, EkipServisi ekip)
    {
        _vt = vt;
        _ekip = ekip;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool Yazabilir => Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi;

    private string Kim =>
        User?.FindFirst("adSoyad")?.Value is { Length: > 0 } ad ? ad : User?.Identity?.Name ?? "";

    private void Iz(IDbConnection db, string bolum, string islem)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_AYAR_DEGISIKLIK (bolum, islem, kullanici, basarili)
VALUES (@bolum, @islem, @kullanici, 1)",
                new { bolum, islem = islem.Length > 200 ? islem[..197] + "…" : islem, kullanici = User?.Identity?.Name ?? "" });
        }
        catch
        {
            /* İz yazılamazsa ayar yine kaydedilmiş sayılır */
        }
    }

    /* ==================================================================== */
    /* Süreler ve sınırlar                                                   */
    /* ==================================================================== */

    [HttpGet("Parametreler")]
    public IActionResult Parametreler()
    {
        Parametre.OnbellekTemizle();

        return Ok(new
        {
            yazabilir = Yazabilir,
            gruplar = Parametre.Gruplar.Select(g => new { kod = g.Kod, ad = g.Ad, aciklama = g.Aciklama }),
            parametreler = Parametre.Tanimlar.Select(t =>
            {
                var (deger, kaynak) = Parametre.Gecerli(t);
                string kisi = null;

                if (t.Tip == "sicil" && !string.IsNullOrWhiteSpace(deger))
                {
                    try
                    {
                        var p = _ekip.Kisi(deger);
                        if (p is not null) kisi = $"{p.Ad} {p.Soyad}".Trim() + (string.IsNullOrWhiteSpace(p.Pozisyon) ? "" : $" · {p.Pozisyon}");
                    }
                    catch
                    {
                    }
                }

                return new
                {
                    anahtar = t.Anahtar,
                    grup = t.Grup,
                    ad = t.Ad,
                    aciklama = t.Aciklama,
                    tip = t.Tip,
                    birim = t.Birim,
                    min = t.Min,
                    max = t.Max,
                    varsayilan = Parametre.Temel(t),
                    deger,
                    kaynak,
                    etki = t.Etki,
                    kisi,
                };
            }),
        });
    }

    public class ParametreGirdi
    {
        public Dictionary<string, string> Degerler { get; set; }
    }

    [HttpPost("Parametreler")]
    public IActionResult ParametreKaydet([FromBody] ParametreGirdi g)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu ayarları değiştirme yetkiniz yok." });
        if (g?.Degerler is null || g.Degerler.Count == 0) return BadRequest(new { hata = "Değişiklik yok." });

        Parametre.OnbellekTemizle();

        var kayitli = new Dictionary<string, string>(Parametre.Kayitli(), StringComparer.OrdinalIgnoreCase);
        var degisenler = new List<string>();

        foreach (var (anahtar, hamDeger) in g.Degerler)
        {
            var t = Parametre.Bul(anahtar);
            if (t is null) return BadRequest(new { hata = $"Tanınmayan ayar: {anahtar}" });

            if (Parametre.Denetle(t, hamDeger) is string hata) return BadRequest(new { hata, anahtar });

            var yeni = Parametre.Duzelt(t, hamDeger);
            var eski = Parametre.Gecerli(t).Deger;

            if (yeni == eski) continue;

            if (yeni == Parametre.Temel(t)) kayitli.Remove(t.Anahtar);
            else kayitli[t.Anahtar] = yeni;

            degisenler.Add($"{t.Ad}: {Parametre.Goster(t, eski)} → {Parametre.Goster(t, yeni)}");
        }

        if (degisenler.Count == 0) return Ok(new { basarili = true, degisen = 0 });

        Parametre.Yaz(kayitli);

        using var db = _vt.Baglanti();
        foreach (var d in degisenler) Iz(db, "sureler", d);

        return Ok(new { basarili = true, degisen = degisenler.Count, degisenler });
    }

    /* ==================================================================== */
    /* Seçenek listeleri                                                     */
    /* ==================================================================== */

    [HttpGet("Listeler")]
    public IActionResult Listeler()
    {
        SecenekListesi.OnbellekTemizle();

        return Ok(new
        {
            yazabilir = Yazabilir,
            listeler = SecenekListesi.Tanimlar.Select(t => new
            {
                kod = t.Kod,
                ad = t.Ad,
                aciklama = t.Aciklama,
                digerVar = t.DigerVar,
                belgeSutunu = t.BelgeSutunu,
                ogeler = SecenekListesi.Tumu(t.Kod),
                varsayilan = t.Varsayilan,
                varsayilanBelgeli = t.VarsayilanBelgeli ?? Array.Empty<string>(),
            }),
        });
    }

    public class ListeGirdi
    {
        public string Kod { get; set; }
        public List<SecenekListesi.Oge> Ogeler { get; set; }
    }

    [HttpPost("Listeler")]
    public IActionResult ListeKaydet([FromBody] ListeGirdi g)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu ayarları değiştirme yetkiniz yok." });

        var t = SecenekListesi.Bul(g?.Kod);
        if (t is null) return BadRequest(new { hata = "Liste bulunamadı." });

        var ogeler = (g.Ogeler ?? new())
            .Where(x => !string.IsNullOrWhiteSpace(x?.Ad))
            .Select(x => new SecenekListesi.Oge
            {
                Ad = x.Ad.Trim().Length > 60 ? x.Ad.Trim()[..60] : x.Ad.Trim(),
                AciklamaZorunlu = x.AciklamaZorunlu,
                Acik = x.Acik,
                BelgeGerekli = t.BelgeSutunu && x.BelgeGerekli,
            })
            .Where(x => !string.Equals(x.Ad, SecenekListesi.Diger, StringComparison.OrdinalIgnoreCase))
            .GroupBy(x => x.Ad, StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First())
            .Take(40)
            .ToList();

        /* "Diğer" (14.10.2026): yalnızca açık/kapalı bilgisi saklanır */
        var digerAcik = !t.DigerVar || ((g.Ogeler ?? new())
            .FirstOrDefault(x => string.Equals(x?.Ad?.Trim(), SecenekListesi.Diger, StringComparison.OrdinalIgnoreCase))?.Acik ?? true);

        if (!ogeler.Any(x => x.Acik) && !(t.DigerVar && digerAcik))
            return BadRequest(new { hata = "En az bir seçenek açık olmalı." });

        if (t.DigerVar && ogeler.Count > 0)
            ogeler.Add(new SecenekListesi.Oge { Ad = SecenekListesi.Diger, AciklamaZorunlu = true, Acik = digerAcik });

        SecenekListesi.OnbellekTemizle();
        var tumu = SecenekListesi.TanimlarSozluk();
        tumu[t.Kod] = ogeler;
        SecenekListesi.Yaz(tumu);

        using var db = _vt.Baglanti();
        Iz(db, "listeler", $"{t.Ad} güncellendi · {ogeler.Count(x => x.Acik)} açık seçenek");

        return Ok(new { basarili = true, ogeler = SecenekListesi.Tumu(t.Kod) });
    }

    /* ==================================================================== */
    /* Avans onay akışı                                                      */
    /* ==================================================================== */

    private static readonly (string Kod, string Ad)[] AkisRolleri =
    {
        (Roller.IK, "İnsan Kaynakları"),
        (Roller.IKYoneticisi, "İK Yöneticisi"),
        (Roller.GenelMudurYardimcisi, "Genel Müdür Yardımcısı"),
        (Roller.Admin, "Yönetici (Admin)"),
    };

    [HttpGet("AvansAkisi")]
    public IActionResult AvansAkisiGetir()
    {
        using var db = _vt.Baglanti();

        var gmySicil = Parametre.Metin("avans.gmySicil");
        string gmyAd = null;

        try
        {
            var p = _ekip.Kisi(gmySicil);
            if (p is not null) gmyAd = $"{p.Ad} {p.Soyad}".Trim();
        }
        catch
        {
        }

        var bekleyen = db.Query<(int Asama, int Adet)>(@"
SELECT ISNULL(asama, 0), COUNT(*) FROM KRY_AVANS WHERE durum = N'bekliyor' GROUP BY ISNULL(asama, 0)").ToList();

        return Ok(new
        {
            yazabilir = Yazabilir,
            akis = AvansAkisi.Oku(db),
            varsayilan = AvansAkisi.Temizle(AvansAkisi.Varsayilan()),
            roller = AkisRolleri.Select(x => new { kod = x.Kod, ad = x.Ad }),
            gmy = new { sicil = gmySicil, adSoyad = gmyAd },
            bekleyen = bekleyen.Select(x => new { asama = x.Asama, adet = x.Adet }),
        });
    }

    [HttpPost("AvansAkisi")]
    public IActionResult AvansAkisiKaydet([FromBody] AvansAkisi.Ayar g)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu ayarları değiştirme yetkiniz yok." });
        if (g is null) return BadRequest(new { hata = "Akış okunamadı." });

        g = AvansAkisi.Temizle(g);

        var bilinen = AkisRolleri.Select(x => x.Kod).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var a in g.Adimlar)
        {
            a.Roller = a.Roller.Where(bilinen.Contains).ToList();
            a.Siciller = a.Siciller.Where(x => x.Equals("gmy", StringComparison.OrdinalIgnoreCase)
                                               || (x.Length <= 20 && x.All(char.IsLetterOrDigit))).ToList();
        }

        if (AvansAkisi.Denetle(g) is string hata) return BadRequest(new { hata });

        using var db = _vt.Baglanti();

        /* Adım sayısı azaldıysa, artık olmayan adımda bekleyen talepler son adıma */
        var sonAdim = g.Adimlar.Count - 1;
        var tasinan = db.Execute(
            "UPDATE KRY_AVANS SET asama = @sonAdim WHERE durum = N'bekliyor' AND ISNULL(asama, 0) > @sonAdim",
            new { sonAdim });

        AvansAkisi.Yaz(db, g);

        var ozet = string.Join(" → ", g.Adimlar.Select((a, i) =>
            i == g.Adimlar.Count - 1
                ? a.Ad
                : $"{a.Ad} ({(a.Onaylarsa == AvansAkisi.Sonraki ? "onay: sonraki" : "onay: kesin")}, {(a.Reddederse == AvansAkisi.Sonraki ? "red: sonraki" : "red: kesin")})"));

        Iz(db, "avansakis", $"Avans onay akışı: {ozet}");

        return Ok(new { basarili = true, akis = g, tasinan });
    }

    /* ==================================================================== */
    /* Mikro kullanıcı adları                                                */
    /* ==================================================================== */

    [HttpGet("MikroKullanicilar")]
    public IActionResult MikroKullanicilar()
    {
        MikroKullanicilari.OnbellekTemizle();

        var bulunan = MikroKullanicilari.Bulunan;
        var elle = MikroKullanicilari.Elle;

        /* Değişiklik günlüğünde geçen numaralar (adı bulunamayanlar öne) */
        List<string> gecenler = new();

        try
        {
            using var db = _vt.Baglanti();
            gecenler = db.Query<string>(@"
SELECT DISTINCT mikro_kullanici FROM KRY_PERSONEL_DEGISIM
WHERE mikro_kullanici IS NOT NULL AND mikro_kullanici NOT LIKE N'%[^0-9]%'").ToList();
        }
        catch
        {
        }

        var numaralar = bulunan.Keys.Concat(elle.Keys).Concat(gecenler)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => int.TryParse(x, out var n) ? n : int.MaxValue)
            .ToList();

        return Ok(new
        {
            yazabilir = Yazabilir,
            kaynak = MikroKullanicilari.Kaynak,
            hata = MikroKullanicilari.Hata,
            kullanicilar = numaralar.Select(n => new
            {
                no = n,
                mikroAdi = bulunan.GetValueOrDefault(n),
                elle = elle.GetValueOrDefault(n),
                gorunen = MikroKullanicilari.Ad(n),
                gunlukte = gecenler.Contains(n),
            }),
        });
    }

    [HttpPost("MikroKullanicilar")]
    public IActionResult MikroKullaniciKaydet([FromBody] Dictionary<string, string> elle)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu ayarları değiştirme yetkiniz yok." });

        using var db = _vt.Baglanti();
        MikroKullanicilari.ElleYaz(db, elle ?? new());
        MikroKullanicilari.EskiKayitlariDuzelt(db);
        Iz(db, "mikrokullanici", $"Mikro kullanıcı adları güncellendi · {elle?.Count(x => !string.IsNullOrWhiteSpace(x.Value)) ?? 0} elle ad");

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Geçmiş                                                                */
    /* ==================================================================== */

    [HttpGet("Gecmis")]
    public IActionResult Gecmis([FromQuery] string bolum = null, [FromQuery] int adet = 60)
    {
        adet = Math.Clamp(adet, 1, 300);

        using var db = _vt.Baglanti();

        var bolumler = string.IsNullOrWhiteSpace(bolum)
            ? new[] { "sureler", "listeler", "avansakis", "mikrokullanici" }
            : bolum.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        try
        {
            var satirlar = db.Query(@"
SELECT TOP (@adet) d.bolum, d.islem, d.kullanici, d.tarih, k.ad_soyad AS adSoyad
FROM KRY_AYAR_DEGISIKLIK d
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = d.kullanici
WHERE d.bolum IN @bolumler AND d.basarili = 1
ORDER BY d.tarih DESC, d.id DESC", new { adet, bolumler }).ToList();

            return Ok(satirlar.Select(x => new
            {
                bolum = (string)x.bolum,
                islem = (string)x.islem,
                kim = (string)x.adSoyad ?? (string)x.kullanici,
                tarih = (DateTime)x.tarih,
            }));
        }
        catch
        {
            return Ok(Array.Empty<object>());
        }
    }
}

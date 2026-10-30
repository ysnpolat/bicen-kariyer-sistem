using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Vardiya Karekodları → Okutma Kuralları (03.10.2026).
///
/// <para>
/// Okutma mesafesi (genel ve şube/konum başına), özel okutma konumları
/// (Hal gibi; kendi karekodlarıyla) ve personel kuralları: saha
/// personeli her şubede okutabilir, konum personeli yalnızca atandığı
/// konumda, muaf personelden okutma beklenmez.
/// </para>
///
/// <para>
/// Kuralların uygulandığı yer mobil okutma ucu (MobilController.VardiyaOkut);
/// mobil uygulamada değişiklik gerekmiyor. Her değişiklik önbelleği
/// boşaltır ve KRY_OKUTMA_KURAL_GUNLUK'a yazılır.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi)]
public class OkutmaKuralController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly PersonelKaynagiServisi _personel;
    private readonly ILogger<OkutmaKuralController> _kayit;

    public OkutmaKuralController(VeritabaniServisi vt, AyarServisi ayar,
        PersonelKaynagiServisi personel, ILogger<OkutmaKuralController> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _personel = personel;
        _kayit = kayit;
    }

    private string Kullanici => User?.Identity?.Name ?? "panel";

    private static readonly string[] Turler = { OkutmaKurallari.Saha, OkutmaKurallari.KonumTuru, OkutmaKurallari.Muaf, OkutmaKurallari.Serbest };

    private static string TurAdi(string tur) => tur switch
    {
        OkutmaKurallari.Saha => "Saha personeli",
        OkutmaKurallari.KonumTuru => "Konum (Hal) personeli",
        OkutmaKurallari.Muaf => "Okutmadan muaf",
        OkutmaKurallari.Serbest => "Her yerden okutabilir",
        _ => tur
    };

    private const int EnAzYaricap = 20;
    private const int EnFazlaYaricap = 5000;

    /* ==================================================================== */
    /* Özet: ayarlar, harita konumları, sayılar                              */
    /* ==================================================================== */

    [HttpGet("Ozet")]
    public IActionResult Ozet()
    {
        var form = _ayar.FormOku();
        var subeler = (form.Subeler ?? new List<Sube>()).Where(x => !string.IsNullOrWhiteSpace(x.Kod)).ToList();
        var varsayilan = OkutmaKurallari.VarsayilanYaricap(_vt);

        using var db = _vt.Baglanti();

        var konumlar = db.Query(@"
SELECT sube_kodu AS subeKodu, enlem, boylam FROM KRY_SUBE_KAREKOD")
            .ToDictionary(x => ((string)x.subeKodu ?? "").Trim(), x => x, StringComparer.OrdinalIgnoreCase);

        var hariciSayi = db.Query(@"
SELECT sube_kodu AS subeKodu, COUNT(*) AS adet FROM KRY_SUBE_KAREKOD_HARICI GROUP BY sube_kodu")
            .ToDictionary(x => ((string)x.subeKodu ?? "").Trim(), x => (int)x.adet, StringComparer.OrdinalIgnoreCase);

        var ozelYaricap = db.Query(@"
SELECT sube_kodu AS subeKodu, yaricap_metre AS y, guncelleyen, guncelleme FROM KRY_OKUTMA_KONUM_AYAR")
            .ToDictionary(x => ((string)x.subeKodu ?? "").Trim(), x => x, StringComparer.OrdinalIgnoreCase);

        /* Son yedi günün uygulama okutmaları ve reddedilenleri yer başına */
        var yediGun = DateTime.Today.AddDays(-6);

        var okutma7 = db.Query(@"
SELECT sube_kodu AS kod, COUNT(*) AS adet FROM KRY_VARDIYA
WHERE gecis_zamani >= @bas AND (kaynak IS NULL OR kaynak = N'mobil')
GROUP BY sube_kodu", new { bas = yediGun })
            .Where(x => x.kod is not null)
            .ToDictionary(x => ((string)x.kod).Trim(), x => (int)x.adet, StringComparer.OrdinalIgnoreCase);

        var red7 = db.Query(@"
SELECT yer_kodu AS kod, COUNT(*) AS adet FROM KRY_OKUTMA_RED
WHERE zaman >= @bas GROUP BY yer_kodu", new { bas = yediGun })
            .Where(x => x.kod is not null)
            .ToDictionary(x => ((string)x.kod).Trim(), x => (int)x.adet, StringComparer.OrdinalIgnoreCase);

        /* Personel sayısı ve şubesi eşleşmeyenler: Mikro'ya ulaşılamazsa boş */
        Dictionary<string, int> subePersonel = new(StringComparer.OrdinalIgnoreCase);
        int? eslesmeyen = null;
        var eslesmeyenOrnek = new List<string>();

        try
        {
            var personelAyar = _ayar.PersonelOku();
            var aktifler = _personel.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();
            eslesmeyen = 0;

            foreach (var grup in aktifler.GroupBy(x => (x.IsGrubu ?? "").Trim(), StringComparer.OrdinalIgnoreCase))
            {
                var ornek = grup.First();
                var sube = subeler.FirstOrDefault(s => OkutmaKurallari.KendiSubesiMi(personelAyar, ornek, s.Kod, s.Ad));

                if (sube is null)
                {
                    eslesmeyen += grup.Count();
                    if (eslesmeyenOrnek.Count < 12 && grup.Key.Length > 0) eslesmeyenOrnek.Add($"{grup.Key} ({grup.Count()})");
                    continue;
                }

                subePersonel[sube.Kod.Trim()] = subePersonel.GetValueOrDefault(sube.Kod.Trim()) + grup.Count();
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Okutma kuralları özeti için personel alınamadı");
        }

        var subeListesi = subeler
            .Select(s =>
            {
                var kod = s.Kod.Trim();
                var k = konumlar.GetValueOrDefault(kod);
                var oy = ozelYaricap.GetValueOrDefault(kod);

                return new
                {
                    tur = "sube",
                    anahtar = kod,
                    subeKodu = kod,
                    ad = s.Ad,
                    enlem = (double?)k?.enlem,
                    boylam = (double?)k?.boylam,
                    yaricap = (int?)oy?.y,
                    etkinYaricap = (int?)oy?.y ?? varsayilan,
                    karekod = k is not null,
                    icard = hariciSayi.GetValueOrDefault(kod),
                    okutma7 = okutma7.GetValueOrDefault(kod),
                    red7 = red7.GetValueOrDefault(kod),
                    personel = subePersonel.TryGetValue(kod, out var ps) ? ps : (int?)null,
                    guncelleyen = (string)oy?.guncelleyen,
                    guncelleme = (DateTime?)oy?.guncelleme,
                };
            })
            .OrderBy(x => x.ad)
            .ToList();

        var kuralKonumSayisi = db.Query(@"
SELECT kk.konum_id AS id, COUNT(*) AS adet FROM KRY_OKUTMA_KURAL_KONUM kk
JOIN KRY_OKUTMA_KURAL k ON k.id = kk.kural_id GROUP BY kk.konum_id")
            .ToDictionary(x => (int)x.id, x => (int)x.adet);

        var ozeller = db.Query(@"
SELECT id, ad, aciklama, enlem, boylam, yaricap_metre AS yaricap, qr_kod AS qrKod, aktif,
       olusturan, olusturma, guncelleyen, guncelleme
FROM KRY_OKUTMA_KONUM ORDER BY ad")
            .Select(x =>
            {
                var anahtar = OkutmaKurallari.KonumOneki + (int)x.id;

                return new
                {
                    tur = "ozel",
                    anahtar,
                    id = (int)x.id,
                    ad = (string)x.ad,
                    aciklama = (string)x.aciklama,
                    enlem = (double)x.enlem,
                    boylam = (double)x.boylam,
                    yaricap = (int?)x.yaricap,
                    etkinYaricap = (int?)x.yaricap ?? varsayilan,
                    qrKod = (string)x.qrKod,
                    aktif = (bool)x.aktif,
                    okutma7 = okutma7.GetValueOrDefault(anahtar),
                    red7 = red7.GetValueOrDefault(anahtar),
                    personel = kuralKonumSayisi.GetValueOrDefault((int)x.id),
                    olusturan = (string)x.olusturan,
                    olusturma = (DateTime)x.olusturma,
                    guncelleyen = (string)x.guncelleyen,
                    guncelleme = (DateTime?)x.guncelleme,
                };
            })
            .ToList();

        var bugun = DateTime.Today;

        var turSayilari = db.Query(@"
SELECT tur, COUNT(*) AS adet FROM KRY_OKUTMA_KURAL
WHERE (baslangic IS NULL OR baslangic <= @bugun) AND (bitis IS NULL OR bitis >= @bugun)
GROUP BY tur", new { bugun })
            .ToDictionary(x => (string)x.tur, x => (int)x.adet, StringComparer.OrdinalIgnoreCase);

        return Ok(new
        {
            ayar = new
            {
                varsayilanYaricap = varsayilan,
                kendiSube = OkutmaKurallari.KendiSubeZorunlu(_vt),
                enAz = EnAzYaricap,
                enFazla = EnFazlaYaricap,
            },
            sayilar = new
            {
                saha = turSayilari.GetValueOrDefault(OkutmaKurallari.Saha),
                konum = turSayilari.GetValueOrDefault(OkutmaKurallari.KonumTuru),
                muaf = turSayilari.GetValueOrDefault(OkutmaKurallari.Muaf),
                serbest = turSayilari.GetValueOrDefault(OkutmaKurallari.Serbest),
                ozelKonum = ozeller.Count(x => x.aktif),
                konumsuzSube = subeListesi.Count(x => x.enlem is null),
                ozelYaricapli = subeListesi.Count(x => x.yaricap is not null),
                eslesmeyen,
                eslesmeyenOrnek,
            },
            subeler = subeListesi,
            ozelKonumlar = ozeller,
        });
    }

    /* ==================================================================== */
    /* Genel ayarlar                                                         */
    /* ==================================================================== */

    /// <summary>Genel ayarlar; Vardiya Karekodları sayfasındaki açıklama metni için hafif uç.</summary>
    [HttpGet("Ayar")]
    public IActionResult AyarOku() => Ok(new
    {
        varsayilanYaricap = OkutmaKurallari.VarsayilanYaricap(_vt),
        kendiSube = OkutmaKurallari.KendiSubeZorunlu(_vt),
    });

    public class AyarGirdi
    {
        public int? VarsayilanYaricap { get; set; }
        public bool? KendiSube { get; set; }
    }

    [HttpPost("Ayar")]
    public IActionResult AyarKaydet([FromBody] AyarGirdi g)
    {
        if (g is null) return BadRequest(new { hata = "Ayar gönderilmedi." });

        using var db = _vt.Baglanti();

        if (g.VarsayilanYaricap is int y)
        {
            if (y < EnAzYaricap || y > EnFazlaYaricap)
                return BadRequest(new
                {
                    hata = "Yarıçap geçersiz.",
                    ayrinti = $"Okutma mesafesi {EnAzYaricap} ile {EnFazlaYaricap} metre arasında olmalıdır."
                });

            var eski = OkutmaKurallari.VarsayilanYaricap(_vt);
            AyarYaz(db, OkutmaKurallari.AyarYaricap, y.ToString());

            if (eski != y)
                OkutmaKurallari.GunlukYaz(db, "ayar", null, null,
                    $"Varsayılan okutma mesafesi {eski} m → {y} m", Kullanici);
        }

        if (g.KendiSube is bool k)
        {
            var eski = OkutmaKurallari.KendiSubeZorunlu(_vt);
            AyarYaz(db, OkutmaKurallari.AyarKendiSube, k ? "1" : "0");

            if (eski != k)
                OkutmaKurallari.GunlukYaz(db, "ayar", null, null,
                    k ? "Kendi şube zorunluluğu açıldı" : "Kendi şube zorunluluğu kapatıldı", Kullanici);
        }

        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Her yerden karekodu (21.10.2026)                                      */
    /* ==================================================================== */

    /// <summary>Her yerden karekodu ve onu kullanabilen kişi sayısı.</summary>
    [HttpGet("SerbestKod")]
    public IActionResult SerbestKodOku()
    {
        using var db = _vt.Baglanti();
        var bugun = DateTime.Today;

        var kisi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_OKUTMA_KURAL
WHERE tur = @tur AND (baslangic IS NULL OR baslangic <= @bugun) AND (bitis IS NULL OR bitis >= @bugun)",
            new { tur = OkutmaKurallari.Serbest, bugun });

        var son30 = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_VARDIYA WHERE sube_kodu = @kod AND gecis_zamani >= DATEADD(DAY, -30, SYSDATETIME())",
            new { kod = OkutmaKurallari.SerbestSubeKodu });

        return Ok(new { kod = OkutmaKurallari.SerbestKod(_vt), kisi, son30 });
    }

    /// <summary>Kodu oluşturur ya da yeniler; eski çıktılar geçersiz olur.</summary>
    [HttpPost("SerbestKod")]
    public IActionResult SerbestKodYenile()
    {
        using var db = _vt.Baglanti();

        var eski = OkutmaKurallari.SerbestKod(_vt);
        var kod = "BCN-HERYER-" + Guid.NewGuid().ToString("N")[..16].ToUpperInvariant();

        AyarYaz(db, OkutmaKurallari.AyarSerbestKod, kod);
        OkutmaKurallari.GunlukYaz(db, "ayar", null, null,
            eski is null ? "Her yerden karekodu oluşturuldu" : "Her yerden karekodu yenilendi; eski çıktılar geçersiz", Kullanici);
        OkutmaKurallari.Temizle();

        return Ok(new { kod });
    }

    private static void AyarYaz(System.Data.IDbConnection db, string anahtar, string deger) =>
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @anahtar AS a) AS y ON h.anahtar = y.a
WHEN MATCHED THEN UPDATE SET deger = @deger, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@anahtar, @deger, SYSDATETIME());",
            new { anahtar, deger });

    public class SubeYaricapGirdi
    {
        public string SubeKodu { get; set; }
        public string SubeAdi { get; set; }

        /// <summary>Boş gönderilirse şubeye özel değer kaldırılır, genel ayar geçerli olur.</summary>
        public int? Yaricap { get; set; }
    }

    /// <summary>Şubeye özel okutma mesafesi.</summary>
    [HttpPost("SubeYaricap")]
    public IActionResult SubeYaricap([FromBody] SubeYaricapGirdi g)
    {
        var kod = (g?.SubeKodu ?? "").Trim();

        if (kod.Length == 0) return BadRequest(new { hata = "Şube belirtiniz." });

        if (g.Yaricap is int y && (y < EnAzYaricap || y > EnFazlaYaricap))
            return BadRequest(new
            {
                hata = "Yarıçap geçersiz.",
                ayrinti = $"Okutma mesafesi {EnAzYaricap} ile {EnFazlaYaricap} metre arasında olmalıdır."
            });

        using var db = _vt.Baglanti();

        var eski = db.ExecuteScalar<int?>(
            "SELECT yaricap_metre FROM KRY_OKUTMA_KONUM_AYAR WHERE sube_kodu = @kod", new { kod });

        if (g.Yaricap is null)
        {
            db.Execute("DELETE FROM KRY_OKUTMA_KONUM_AYAR WHERE sube_kodu = @kod", new { kod });
        }
        else
        {
            db.Execute(@"
MERGE KRY_OKUTMA_KONUM_AYAR AS h
USING (SELECT @kod AS k) AS y ON h.sube_kodu = y.k
WHEN MATCHED THEN UPDATE SET yaricap_metre = @y, guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (sube_kodu, yaricap_metre, guncelleyen) VALUES (@kod, @y, @yapan);",
                new { kod, y = g.Yaricap, yapan = Kullanici });
        }

        if (eski != g.Yaricap)
            OkutmaKurallari.GunlukYaz(db, "yaricap", null, null,
                $"{g.SubeAdi ?? kod}: {(eski is null ? "varsayılan" : eski + " m")} → "
                + $"{(g.Yaricap is null ? "varsayılan" : g.Yaricap + " m")}", Kullanici);

        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Özel konumlar                                                         */
    /* ==================================================================== */

    public class KonumGirdi
    {
        public int? Id { get; set; }
        public string Ad { get; set; }
        public string Aciklama { get; set; }
        public double? Enlem { get; set; }
        public double? Boylam { get; set; }
        public int? Yaricap { get; set; }
        public bool? Aktif { get; set; }
    }

    /// <summary>Özel konum ekler ya da günceller. Yeni konuma yeni karekod üretilir.</summary>
    [HttpPost("Konum")]
    public IActionResult KonumKaydet([FromBody] KonumGirdi g)
    {
        var ad = (g?.Ad ?? "").Trim();

        if (ad.Length == 0 || ad.Length > 120)
            return BadRequest(new { hata = "Konum adını giriniz (en fazla 120 karakter)." });

        if (g.Enlem is not double e || e < -90 || e > 90 || e == 0)
            return BadRequest(new { hata = "Enlem değeri geçersiz.", ayrinti = "Haritadan bir nokta seçiniz ya da koordinatı yazınız." });

        if (g.Boylam is not double b || b < -180 || b > 180 || b == 0)
            return BadRequest(new { hata = "Boylam değeri geçersiz.", ayrinti = "Haritadan bir nokta seçiniz ya da koordinatı yazınız." });

        if (g.Yaricap is int y && (y < EnAzYaricap || y > EnFazlaYaricap))
            return BadRequest(new
            {
                hata = "Yarıçap geçersiz.",
                ayrinti = $"Okutma mesafesi {EnAzYaricap} ile {EnFazlaYaricap} metre arasında olmalıdır."
            });

        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length > 300) aciklama = aciklama[..300];

        using var db = _vt.Baglanti();

        int id;
        string qrKod;

        if (g.Id is int mevcutId)
        {
            var eski = db.QueryFirstOrDefault(
                "SELECT ad, enlem, boylam, yaricap_metre AS yaricap, aktif, qr_kod AS qrKod FROM KRY_OKUTMA_KONUM WHERE id = @id",
                new { id = mevcutId });

            if (eski is null) return NotFound(new { hata = "Konum bulunamadı." });

            db.Execute(@"
UPDATE KRY_OKUTMA_KONUM SET ad = @ad, aciklama = @aciklama, enlem = @e, boylam = @b,
       yaricap_metre = @y, aktif = @aktif, guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id",
                new
                {
                    id = mevcutId, ad, aciklama = aciklama.Length == 0 ? null : aciklama, e, b,
                    y = g.Yaricap, aktif = g.Aktif ?? (bool)eski.aktif, yapan = Kullanici
                });

            id = mevcutId;
            qrKod = (string)eski.qrKod;

            var degisen = new List<string>();
            if ((string)eski.ad != ad) degisen.Add($"ad: {eski.ad} → {ad}");
            if (Math.Abs((double)eski.enlem - e) > 1e-7 || Math.Abs((double)eski.boylam - b) > 1e-7)
                degisen.Add($"konum: {e:0.000000}, {b:0.000000}");
            if ((int?)eski.yaricap != g.Yaricap)
                degisen.Add($"yarıçap: {((int?)eski.yaricap)?.ToString() ?? "varsayılan"} → {g.Yaricap?.ToString() ?? "varsayılan"}");
            if (g.Aktif is bool a && a != (bool)eski.aktif) degisen.Add(a ? "aktif edildi" : "pasif edildi");

            if (degisen.Count > 0)
                OkutmaKurallari.GunlukYaz(db, "konum", null, null, $"{ad} · {string.Join(" · ", degisen)}", Kullanici);
        }
        else
        {
            qrKod = Guid.NewGuid().ToString().ToLowerInvariant();

            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_OKUTMA_KONUM (ad, aciklama, enlem, boylam, yaricap_metre, qr_kod, aktif, olusturan)
OUTPUT INSERTED.id
VALUES (@ad, @aciklama, @e, @b, @y, @qrKod, @aktif, @yapan)",
                new
                {
                    ad, aciklama = aciklama.Length == 0 ? null : aciklama, e, b, y = g.Yaricap,
                    qrKod, aktif = g.Aktif ?? true, yapan = Kullanici
                });

            OkutmaKurallari.GunlukYaz(db, "konum", null, null,
                $"{ad} eklendi · {e:0.000000}, {b:0.000000} · {(g.Yaricap?.ToString() ?? "varsayılan")} m", Kullanici);
        }

        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true, id, qrKod });
    }

    public class AktifGirdi
    {
        public bool Aktif { get; set; }
    }

    [HttpPost("Konum/{id:int}/Aktif")]
    public IActionResult KonumAktif(int id, [FromBody] AktifGirdi g)
    {
        using var db = _vt.Baglanti();

        var ad = db.ExecuteScalar<string>("SELECT ad FROM KRY_OKUTMA_KONUM WHERE id = @id", new { id });
        if (ad is null) return NotFound(new { hata = "Konum bulunamadı." });

        db.Execute(@"
UPDATE KRY_OKUTMA_KONUM SET aktif = @a, guncelleyen = @yapan, guncelleme = SYSDATETIME() WHERE id = @id",
            new { id, a = g?.Aktif ?? false, yapan = Kullanici });

        OkutmaKurallari.GunlukYaz(db, "konum", null, null,
            $"{ad} {(g?.Aktif == true ? "aktif edildi" : "pasif edildi")}", Kullanici);

        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true });
    }

    /// <summary>Karekodu yeniler; asılı eski çıktı geçersiz olur.</summary>
    [HttpPost("Konum/{id:int}/KodYenile")]
    public IActionResult KonumKodYenile(int id)
    {
        using var db = _vt.Baglanti();

        var ad = db.ExecuteScalar<string>("SELECT ad FROM KRY_OKUTMA_KONUM WHERE id = @id", new { id });
        if (ad is null) return NotFound(new { hata = "Konum bulunamadı." });

        var qrKod = Guid.NewGuid().ToString().ToLowerInvariant();

        db.Execute(@"
UPDATE KRY_OKUTMA_KONUM SET qr_kod = @qrKod, guncelleyen = @yapan, guncelleme = SYSDATETIME() WHERE id = @id",
            new { id, qrKod, yapan = Kullanici });

        OkutmaKurallari.GunlukYaz(db, "konum", null, null, $"{ad} karekodu yenilendi", Kullanici);
        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true, qrKod });
    }

    /// <summary>
    /// Özel konumu siler. Konuma bağlı kurallardan konum çıkarılır; geçmiş
    /// okutma kayıtları (KRY_VARDIYA) adıyla birlikte kalır.
    /// </summary>
    [HttpDelete("Konum/{id:int}")]
    public IActionResult KonumSil(int id)
    {
        using var db = _vt.Baglanti();

        var ad = db.ExecuteScalar<string>("SELECT ad FROM KRY_OKUTMA_KONUM WHERE id = @id", new { id });
        if (ad is null) return NotFound(new { hata = "Konum bulunamadı." });

        db.Execute(@"
DELETE FROM KRY_OKUTMA_KURAL_KONUM WHERE konum_id = @id;
DELETE FROM KRY_OKUTMA_KONUM WHERE id = @id;", new { id });

        OkutmaKurallari.GunlukYaz(db, "konum", null, null, $"{ad} silindi", Kullanici);
        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Personel kuralları                                                    */
    /* ==================================================================== */

    /// <summary>Kural seçicisi için çalışan personel.</summary>
    [HttpGet("Personeller")]
    public IActionResult Personeller()
    {
        List<PersonelKaydi> aktifler;

        try
        {
            aktifler = _personel.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Okutma kuralı için personel alınamadı");
            return StatusCode(502, new { hata = "Personel listesi alınamadı.", ayrinti = hata.Message });
        }

        using var db = _vt.Baglanti();

        var kurallar = db.Query("SELECT personel_kodu AS kod, tur FROM KRY_OKUTMA_KURAL")
            .ToDictionary(x => OkutmaKurallari.Anahtar((string)x.kod), x => (string)x.tur, StringComparer.OrdinalIgnoreCase);

        var liste = aktifler
            .Select(p => new
            {
                kod = (p.PersonelKodu ?? "").Trim(),
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = p.IsGrubu ?? p.Sube,
                pozisyon = p.Pozisyon,
                kural = kurallar.GetValueOrDefault(OkutmaKurallari.Anahtar(p.PersonelKodu)),
            })
            .Where(x => x.kod.Length > 0)
            .GroupBy(x => x.kod, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderBy(x => x.adSoyad)
            .ToList();

        return Ok(new
        {
            personeller = liste,
            subeler = liste.Select(x => x.sube).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x => x),
            pozisyonlar = liste.Select(x => x.pozisyon).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().OrderBy(x => x),
        });
    }

    [HttpGet("Kurallar")]
    public IActionResult Kurallar()
    {
        using var db = _vt.Baglanti();

        var konumAdlari = db.Query("SELECT id, ad, aktif FROM KRY_OKUTMA_KONUM")
            .ToDictionary(x => (int)x.id, x => new { id = (int)x.id, ad = (string)x.ad, aktif = (bool)x.aktif });

        var baglar = db.Query("SELECT kural_id AS kuralId, konum_id AS konumId FROM KRY_OKUTMA_KURAL_KONUM")
            .GroupBy(x => (int)x.kuralId)
            .ToDictionary(g => g.Key, g => g.Select(x => (int)x.konumId).ToList());

        var bugun = DateTime.Today;

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube, pozisyon, tur,
       kendi_subesi AS kendiSubesi, baslangic, bitis, aciklama,
       olusturan, olusturma, guncelleyen, guncelleme
FROM KRY_OKUTMA_KURAL ORDER BY ad_soyad")
            .Select(x =>
            {
                var idler = baglar.GetValueOrDefault((int)x.id) ?? new List<int>();
                DateTime? bas = x.baslangic, bit = x.bitis;

                return new
                {
                    id = (int)x.id,
                    personelKodu = (string)x.personelKodu,
                    adSoyad = (string)x.adSoyad,
                    sube = (string)x.sube,
                    pozisyon = (string)x.pozisyon,
                    tur = (string)x.tur,
                    kendiSubesi = (bool)x.kendiSubesi,
                    baslangic = bas,
                    bitis = bit,
                    aciklama = (string)x.aciklama,
                    konumIdleri = idler,
                    konumlar = idler.Where(konumAdlari.ContainsKey).Select(i => konumAdlari[i]).ToList(),
                    durum = bas is not null && bas.Value.Date > bugun ? "baslamadi"
                          : bit is not null && bit.Value.Date < bugun ? "bitti"
                          : "gecerli",
                    olusturan = (string)x.olusturan,
                    olusturma = (DateTime)x.olusturma,
                    guncelleyen = (string)x.guncelleyen,
                    guncelleme = (DateTime?)x.guncelleme,
                };
            })
            .ToList();

        return Ok(new { kayitlar });
    }

    public class KuralGirdi
    {
        public List<string> PersonelKodlari { get; set; }
        public string Tur { get; set; }
        public List<int> KonumIdleri { get; set; }
        public bool KendiSubesi { get; set; }
        public DateTime? Baslangic { get; set; }
        public DateTime? Bitis { get; set; }
        public string Aciklama { get; set; }
    }

    /// <summary>
    /// Seçilen personele kural yazar. Personelin tek kuralı olur: mevcut
    /// kuralı varsa yenisiyle değiştirilir (düzenleme de bu uçtan).
    /// </summary>
    [HttpPost("Kural")]
    public IActionResult KuralKaydet([FromBody] KuralGirdi g)
    {
        var tur = (g?.Tur ?? "").Trim().ToLowerInvariant();

        if (!Turler.Contains(tur))
            return BadRequest(new { hata = "Kural türünü seçiniz." });

        var kodlar = (g.PersonelKodlari ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0 && x.Length <= 30)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (kodlar.Count == 0)
            return BadRequest(new { hata = "En az bir personel seçiniz." });

        if (kodlar.Count > 1000)
            return BadRequest(new { hata = "Tek seferde en fazla 1000 personel seçilebilir." });

        if (g.Baslangic is DateTime b1 && g.Bitis is DateTime b2 && b2.Date < b1.Date)
            return BadRequest(new { hata = "Bitiş tarihi başlangıçtan önce olamaz." });

        using var db = _vt.Baglanti();

        var konumIdleri = new List<int>();

        if (tur == OkutmaKurallari.KonumTuru)
        {
            var istenen = (g.KonumIdleri ?? new List<int>()).Distinct().ToList();
            var mevcut = db.Query<int>("SELECT id FROM KRY_OKUTMA_KONUM").ToHashSet();

            konumIdleri = istenen.Where(mevcut.Contains).ToList();

            if (konumIdleri.Count == 0)
                return BadRequest(new
                {
                    hata = "En az bir okutma konumu seçiniz.",
                    ayrinti = "Konum personeli yalnızca kendisine atanan konumlarda okutabilir. Konum yoksa önce Harita sekmesinden ekleyiniz."
                });
        }

        /* Ad, şube, pozisyon kuralın yazıldığı andaki hâliyle saklanıyor;
           liste her açılışta Mikro'ya gitmesin. */
        Dictionary<string, PersonelKaydi> kisiler;

        try
        {
            kisiler = _personel.TumPersonelleriGetir()
                .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
                .GroupBy(x => OkutmaKurallari.Anahtar(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(gr => gr.Key, gr => gr.OrderByDescending(x => x.Durum).First(), StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Okutma kuralı için personel adları alınamadı");
            kisiler = new(StringComparer.OrdinalIgnoreCase);
        }

        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length > 300) aciklama = aciklama[..300];

        var konumAdi = konumIdleri.Count == 0 ? "" :
            string.Join(", ", db.Query<string>("SELECT ad FROM KRY_OKUTMA_KONUM WHERE id IN @konumIdleri", new { konumIdleri }));

        var gecerlilik = g.Baslangic is null && g.Bitis is null
            ? "süresiz"
            : $"{g.Baslangic?.ToString("dd.MM.yyyy") ?? "…"} – {g.Bitis?.ToString("dd.MM.yyyy") ?? "…"}";

        int eklenen = 0, guncellenen = 0;

        foreach (var kod in kodlar)
        {
            var p = kisiler.GetValueOrDefault(OkutmaKurallari.Anahtar(kod));
            var adSoyad = p is null ? null : $"{p.Ad} {p.Soyad}".Trim();

            using var islem = db.BeginTransactionAc();

            var mevcut = db.QueryFirstOrDefault(
                "SELECT id, tur FROM KRY_OKUTMA_KURAL WHERE personel_kodu = @kod",
                new { kod }, islem);

            int id;

            var parametre = new
            {
                kod,
                adSoyad,
                sube = p?.IsGrubu ?? p?.Sube,
                pozisyon = p?.Pozisyon,
                tur,
                kendi = tur == OkutmaKurallari.KonumTuru && g.KendiSubesi,
                bas = g.Baslangic?.Date,
                bit = g.Bitis?.Date,
                aciklama = aciklama.Length == 0 ? null : aciklama,
                yapan = Kullanici
            };

            if (mevcut is null)
            {
                id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_OKUTMA_KURAL
    (personel_kodu, ad_soyad, sube, pozisyon, tur, kendi_subesi, baslangic, bitis, aciklama, olusturan)
OUTPUT INSERTED.id
VALUES (@kod, @adSoyad, @sube, @pozisyon, @tur, @kendi, @bas, @bit, @aciklama, @yapan)", parametre, islem);
                eklenen++;
            }
            else
            {
                id = (int)mevcut.id;

                db.Execute(@"
UPDATE KRY_OKUTMA_KURAL SET
    ad_soyad = ISNULL(@adSoyad, ad_soyad), sube = ISNULL(@sube, sube), pozisyon = ISNULL(@pozisyon, pozisyon),
    tur = @tur, kendi_subesi = @kendi, baslangic = @bas, bitis = @bit, aciklama = @aciklama,
    guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id", new
                {
                    parametre.adSoyad, parametre.sube, parametre.pozisyon, parametre.tur, parametre.kendi,
                    parametre.bas, parametre.bit, parametre.aciklama, parametre.yapan, id
                }, islem);
                guncellenen++;
            }

            db.Execute("DELETE FROM KRY_OKUTMA_KURAL_KONUM WHERE kural_id = @id", new { id }, islem);

            foreach (var konumId in konumIdleri)
                db.Execute("INSERT INTO KRY_OKUTMA_KURAL_KONUM (kural_id, konum_id) VALUES (@id, @konumId)",
                    new { id, konumId }, islem);

            islem.Commit();

            OkutmaKurallari.GunlukYaz(db, mevcut is null ? "ekle" : "guncelle", kod, adSoyad,
                $"{TurAdi(tur)}"
                + (mevcut is not null && (string)mevcut.tur != tur ? $" (önceki: {TurAdi((string)mevcut.tur)})" : "")
                + (konumAdi.Length > 0 ? $" · {konumAdi}" : "")
                + (parametre.kendi ? " · kendi şubesi de" : "")
                + $" · {gecerlilik}"
                + (aciklama.Length > 0 ? $" · {aciklama}" : ""),
                Kullanici);
        }

        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true, eklenen, guncellenen });
    }

    [HttpDelete("Kural/{id:int}")]
    public IActionResult KuralSil(int id)
    {
        using var db = _vt.Baglanti();

        var k = db.QueryFirstOrDefault(
            "SELECT personel_kodu AS kod, ad_soyad AS adSoyad, tur FROM KRY_OKUTMA_KURAL WHERE id = @id", new { id });

        if (k is null) return NotFound(new { hata = "Kural bulunamadı." });

        db.Execute(@"
DELETE FROM KRY_OKUTMA_KURAL_KONUM WHERE kural_id = @id;
DELETE FROM KRY_OKUTMA_KURAL WHERE id = @id;", new { id });

        OkutmaKurallari.GunlukYaz(db, "kaldir", (string)k.kod, (string)k.adSoyad,
            $"{TurAdi((string)k.tur)} kuralı kaldırıldı", Kullanici);

        OkutmaKurallari.Temizle();

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Denetim                                                               */
    /* ==================================================================== */

    /// <summary>Kural ve ayar değişiklikleri.</summary>
    [HttpGet("Gunluk")]
    public IActionResult Gunluk([FromQuery] int adet = 100)
    {
        adet = Math.Clamp(adet, 10, 500);

        using var db = _vt.Baglanti();

        var kayitlar = db.Query($@"
SELECT TOP {adet} id, islem, personel_kodu AS personelKodu, ad_soyad AS adSoyad, ayrinti, yapan, zaman
FROM KRY_OKUTMA_KURAL_GUNLUK ORDER BY zaman DESC").ToList();

        return Ok(new { kayitlar });
    }

    /// <summary>Son reddedilen okutmalar (mesafe, yetki, konum izni).</summary>
    [HttpGet("Redler")]
    public IActionResult Redler([FromQuery] int gun = 7)
    {
        gun = Math.Clamp(gun, 1, 90);

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT TOP 300 id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube, yer_kodu AS yerKodu,
       yer_adi AS yerAdi, sebep, mesafe_metre AS mesafe, sinir_metre AS sinir, enlem, boylam, ayrinti, zaman
FROM KRY_OKUTMA_RED WHERE zaman >= @bas ORDER BY zaman DESC",
            new { bas = DateTime.Today.AddDays(-(gun - 1)) }).ToList();

        return Ok(new { kayitlar });
    }
}

internal static class OkutmaKuralBaglantiUzantisi
{
    /// <summary>Bağlantı kapalıysa açıp işlem başlatır.</summary>
    public static System.Data.IDbTransaction BeginTransactionAc(this System.Data.IDbConnection db)
    {
        if (db.State != System.Data.ConnectionState.Open) db.Open();
        return db.BeginTransaction();
    }
}

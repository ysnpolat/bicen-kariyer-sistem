using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Dapper;

using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen Kart yönetimi
/// ---------------------------------------------------------------------------
/// Personele yüklenen puanların kartı yazarkasa tarafındaki
/// PosbackPromosyon veritabanında duruyor. Bu denetleyici İK panelinin
/// kart işlemlerini karşılıyor: eşleştirme, eşleşme kaldırma, şifre,
/// sorgulama.
///
/// <para>
/// 28.09.2026: Genius3 artık kullanılmıyor. Kart araması ve kart
/// bilgileri yalnızca <c>[PosbackPromosyon].[dbo].[MusteriKart]</c>
/// tablosundan: personelin adı soyadı <c>Ad</c>, kart numarası
/// <c>KartNo</c>, cep telefonu <c>CepTel</c> sütununda.
/// </para>
///
/// <para>
/// Kart kaydı burada oluşturulmuyor. Kartlar fiziki olarak basılıp
/// sisteme giriliyor; buradan yapılan iş var olan bir kartı personele
/// bağlamak ya da bağı kaldırmak.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IK + "," + Roller.IKYoneticisi
                 + "," + Roller.GenelMudurYardimcisi)]
public partial class BicenKartController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly GiftKartServisi _giftKart;
    private readonly YetkiServisi _yetki;
    private readonly SmsServisi _sms;
    private readonly AyarServisi _ayar;
    private readonly ILogger<BicenKartController> _kayit;

    private const string TABLO = "[PosbackPromosyon].[dbo].[MusteriKart]";
    private const string HAREKET = "[PosbackPromosyon].[dbo].[PuanHareket]";

    /// <summary>Mobil uygulama kartlarının grup numarası.</summary>
    private const int MOBIL = 608;

    /// <summary>Boşta (kimseye verilmemiş) kartın MusteriKart'taki adı.</summary>
    private const string BOS_KART_ADI = "BİÇEN KART";

    public BicenKartController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        GiftKartServisi giftKart,
        YetkiServisi yetki,
        SmsServisi sms,
        AyarServisi ayar,
        ILogger<BicenKartController> kayit)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _giftKart = giftKart;
        _yetki = yetki;
        _sms = sms;
        _ayar = ayar;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>
    /// Ayrılan (ya da çıkışı yazılmış) personele kart tanımlama yalnızca
    /// Yönetici (Admin) rolünde (06.10.2026). Diğer rollerde eşleştirme
    /// eskisi gibi engelli.
    /// </summary>
    private bool AyrilanaKartYetkisi => Roller.Temel(Rol) == Roller.Admin;

    /* ==================================================================== */
    /* Genel görünüm                                                        */
    /* ==================================================================== */

    /// <summary>
    /// Tek ekran için bütün veri: şubeler, personel, kart, bakiye, şifre.
    ///
    /// <para>
    /// Eşleşme kendi tablomuzdan (KRY_KART_ESLESME); kart bilgileri ve
    /// şifre MusteriKart'tan, bakiye puan hareketlerinden toplu
    /// hesaplanıyor. POS sunucusuna ulaşılamazsa personel ve eşleşmeler
    /// yine dönüyor, bakiye ve şifre boş kalıyor.
    /// </para>
    /// </summary>
    [HttpGet("Genel")]
    public IActionResult Genel([FromQuery] bool bakiye = true)
    {
        var sure = System.Diagnostics.Stopwatch.StartNew();
        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .ToList();

        var eslesmeler = Eslesmeler();

        var kartNolari = eslesmeler.Values
            .Select(x => x.KartNo)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var kartlar = new Dictionary<string, (string Ad, string Telefon, bool Mobil, bool Sifre)>(
            StringComparer.OrdinalIgnoreCase);
        var bakiyeler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        string posHatasi = null;

        try
        {
            using var db = _vt.PosBaglantisi();

            foreach (var parca in kartNolari.Chunk(400))
            {
                foreach (var k in db.Query($@"
SELECT CONVERT(VARCHAR(50), k.KartNo) AS kartNo,
       LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
       CASE WHEN k.CepTel IS NULL OR k.CepTel = 0 THEN NULL
            ELSE RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) END AS telefon,
       k.GrupNo AS grupNo,
       CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE k.KartNo IN @parca",
                             new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120))
                {
                    kartlar[((string)k.kartNo ?? "").Trim()] = (
                        ((string)k.ad ?? "").Trim(),
                        (string)k.telefon,
                        k.grupNo is not null && (int)k.grupNo == MOBIL,
                        (int)k.sifreVar == 1);
                }

                if (bakiye)
                    foreach (var (no, tutar) in TopluBakiye(db, parca))
                        bakiyeler[no] = tutar;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bilgileri okunamadı");
            posHatasi = hata.Message;
        }

        /* Hız takibi: POS sorguları (kart + bakiye) ne kadar sürdü */
        if (sure.ElapsedMilliseconds > 3000)
            _kayit.LogWarning("Biçen Kart Genel yavaş: POS {Ms} ms ({Kart} kart)", sure.ElapsedMilliseconds, kartNolari.Count);
        else
            _kayit.LogInformation("Biçen Kart Genel: POS {Ms} ms ({Kart} kart)", sure.ElapsedMilliseconds, kartNolari.Count);

        var satirlar = personel.Select(p =>
        {
            var sicil = (p.PersonelKodu ?? "").Trim();
            var adSoyad = $"{p.Ad} {p.Soyad}".Trim();
            var tel = Telefon(p.Telefon);

            eslesmeler.TryGetValue(sicil, out var e);

            var kartNo = string.IsNullOrWhiteSpace(e.KartNo) ? null : e.KartNo;
            var kartVar = kartNo is not null && kartlar.TryGetValue(kartNo, out _);
            var kart = kartVar ? kartlar[kartNo] : default;

            /* Kart kaydı personelle uyuşmuyor: ad ya da telefon farklı.
               "Kart bilgilerini eşitle" bunları düzeltiyor. */
            var uyumsuz = kartVar && (
                !string.Equals(Kisalt(kart.Ad), Kisalt(Ust(adSoyad)), StringComparison.OrdinalIgnoreCase)
                || (tel.Length == 10 && kart.Telefon != tel)
                || !kart.Mobil);

            return new
            {
                sicil = p.PersonelKodu,
                /* Excel çıktısında sicil yerine TC kimlik no isteniyor.
                   Rol yetkisinde kimlik gizliyse son dört hane kalır. */
                tc = _yetki.KimlikMaskele(Rol, p.KimlikNo?.Trim()),
                adSoyad,
                sube = (p.IsGrubu ?? "").Trim(),
                pozisyon = p.Pozisyon,
                telefon = tel.Length == 10 ? tel : null,
                kartNo,
                kartBulunamadi = kartNo is not null && posHatasi is null && !kartVar,
                kartAdi = kartVar ? kart.Ad : null,
                kartTelefon = kartVar ? kart.Telefon : null,
                mobilKart = kartVar && kart.Mobil,
                sifreVar = kartVar && kart.Sifre,
                bakiye = kartNo is not null && bakiyeler.TryGetValue(kartNo, out var b) ? b : (decimal?)null,
                uyumsuz,
                cikisTarihi = AyrilisTarihi(p.CikisTarihi),
                eslestirilemez = AyrilisTarihi(p.CikisTarihi).HasValue && !AyrilanaKartYetkisi,
            };
        })
        .OrderBy(x => x.adSoyad)
        .ToList();

        var subeler = satirlar
            .Where(x => x.sube.Length > 0)
            .GroupBy(x => x.sube)
            .Select(g => new
            {
                sube = g.Key,
                personel = g.Count(),
                kartli = g.Count(x => x.kartNo is not null),
            })
            .OrderBy(x => x.sube)
            .ToList();

        return Ok(new
        {
            personel = satirlar,
            subeler,
            posHatasi,
            bakiyeOkundu = bakiye && posHatasi is null,
        });
    }

    /// <summary>
    /// Birden çok kartın bakiyesi tek sorguda. Kart sütununa dönüşüm
    /// uygulanmıyor ki dizin kullanılabilsin (tek kart sorgusundaki gibi). Kural
    /// <see cref="GiftKartServisi.BakiyeSorgusu"/> ile aynı (Posback dbo.PuanBakiye):
    /// süresi geçmemiş 1/3/4 partilerinde kalan Puan − EksiPuan.
    /// </summary>
    private static IEnumerable<(string KartNo, decimal Bakiye)> TopluBakiye(
        System.Data.IDbConnection db, IEnumerable<string> kartlar)
    {
        /* Posback'in dbo.PuanBakiye fonksiyonunun toplu hali: süresi
           geçmemiş kazanma/yükleme/devir partilerinde kalan (Puan − EksiPuan).
           Sorgu GiftKartServisi'nde: ayrılan personel görevi de kullanıyor. */
        return GiftKartServisi.TopluBakiye(db, kartlar);
    }

    /// <summary>
    /// İleri tarihli (bugün dahil) işten çıkış tarihi. Çıkışı yazılmış
    /// personel listede görünür ama kart eşleştirilmez: kart birkaç gün
    /// sonra boşa çıkacak, yeni personele devredilecek.
    /// </summary>
    private static DateTime? AyrilisTarihi(DateTime? cikis) =>
        cikis.HasValue && cikis.Value.Date >= DateTime.Today ? cikis.Value.Date : null;

    private static string AyrilisMetni(DateTime tarih) =>
        $"Çıkış tarihi {tarih:dd.MM.yyyy} olarak girilmiş; bu personele kart eşleştirilemez.";

    /// <summary>
    /// Şube eşleşmesi birebir. Ekranda şube listesi personel kaydındaki
    /// adlardan geliyor; benzerlik araması "SİLİVRİ" ile "SİLİVRİ-2"yi aynı
    /// şube sayıp birinin kartsız personelini ötekinde gösteriyor ve toplu
    /// eşleştirmede kartları yanlış mağazaya dağıtıyordu (29.09.2026).
    /// </summary>
    private static bool AyniSube(string secilen, string personelSubesi) =>
        !string.IsNullOrWhiteSpace(secilen)
        && string.Equals(Ust(secilen), Ust(personelSubesi), StringComparison.Ordinal);

    private static string Ust(string s) => (s ?? "").Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));

    /// <summary>MusteriKart.Ad 30 hane: karşılaştırma da kırpılmış hâlle.</summary>
    private static string Kisalt(string s)
    {
        var t = (s ?? "").Trim();
        return t.Length > 30 ? t[..30].Trim() : t;
    }

    /* ==================================================================== */
    /* Liste                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Personel ve kart eşleşmeleri.
    ///
    /// <para>
    /// Eşleşme cep telefonu üzerinden: personel kaydıyla kart kaydı
    /// arasında başka ortak alan yok. Aynı numaraya birden çok kart
    /// tanımlı olabiliyor, hepsi listeleniyor.
    /// </para>
    /// </summary>
    [HttpGet("Liste")]
    public IActionResult Liste([FromQuery] string ara = null, [FromQuery] string durum = null)
    {
        var personeller = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .ToList();

        /* Kartlar tek sorguda çekiliyor.

           Önce personel numaraları IN listesine konuyordu; yedi yüz
           kişilik liste sorguyu zaman aşımına uğratıyordu. Artık yalnızca
           mobil karta bağlanmış kayıtlar okunuyor — sınırlı bir küme —
           ve eşleştirme bellekte yapılıyor. */
        var kartlar = new Dictionary<string, List<dynamic>>();

        try
        {
            using var db = _vt.PosBaglantisi();

            var ham = db.Query($@"
SELECT k.KartNo                                       AS kartNo,
       RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10)      AS telefon,
       k.GrupNo                                       AS grupNo,
       CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE k.CepTel IS NOT NULL AND k.CepTel > 0",
                commandTimeout: 120).ToList();

            foreach (var x in ham)
            {
                var tel = (string)x.telefon;

                if (string.IsNullOrWhiteSpace(tel)) continue;

                if (!kartlar.TryGetValue(tel, out var liste))
                    kartlar[tel] = liste = new List<dynamic>();

                liste.Add(x);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart listesi okunamadı");

            return StatusCode(503, new
            {
                hata = "Kart veritabanına ulaşılamıyor.",
                ayrinti = hata.Message
            });
        }

        var sonuc = personeller.Select(p =>
        {
            var tel = new string((p.Telefon ?? "").Where(char.IsDigit).ToArray());
            var son10 = tel.Length >= 10 ? tel[^10..] : "";

            var kendi = son10.Length == 10 && kartlar.TryGetValue(son10, out var l)
                ? l : new List<dynamic>();

            /* Mobil kart öne alınıyor: personel uygulamadan onu
               kullanıyor, fiziki kart ikincil. */
            var mobil = kendi.FirstOrDefault(x => x.grupNo is not null && (int)x.grupNo == MOBIL);

            return new
            {
                personelKodu = p.PersonelKodu,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = p.IsGrubu,
                gorev = p.Pozisyon,
                telefon = son10,

                kartSayisi = kendi.Count,
                kartNo = (string)(mobil?.kartNo ?? kendi.FirstOrDefault()?.kartNo),
                mobilKart = mobil is not null,
                sifreVar = mobil is not null && (int)mobil.sifreVar == 1,
            };
        });

        if (!string.IsNullOrWhiteSpace(ara))
        {
            var a = ara.Trim();

            sonuc = sonuc.Where(x =>
                (x.adSoyad ?? "").Contains(a, StringComparison.OrdinalIgnoreCase) ||
                (x.personelKodu ?? "").Contains(a) ||
                (x.telefon ?? "").Contains(a) ||
                (x.kartNo ?? "").Contains(a));
        }

        sonuc = durum switch
        {
            "kartsiz" => sonuc.Where(x => x.kartSayisi == 0),
            "mobil" => sonuc.Where(x => x.mobilKart),
            "fiziki" => sonuc.Where(x => x.kartSayisi > 0 && !x.mobilKart),
            _ => sonuc,
        };

        return Ok(new { kayitlar = sonuc.OrderBy(x => x.adSoyad).Take(500).ToList() });
    }

    /* ==================================================================== */
    /* Kart ayrıntısı                                                       */
    /* ==================================================================== */

    /// <summary>Kartın bakiyesi, hareketleri ve şube kırılımı.</summary>
    [HttpGet("Kart/{kartNo}")]
    public IActionResult Kart(string kartNo, [FromQuery] int gun = 90)
    {
        if (string.IsNullOrWhiteSpace(kartNo))
            return BadRequest(new { hata = "Kart numarası gerekli." });

        if (gun is < 1 or > 730) gun = 90;

        var baslangic = DateTime.Today.AddDays(-gun + 1);

        try
        {
            using var db = _vt.PosBaglantisi();

            var kart = db.QueryFirstOrDefault($@"
SELECT k.KartNo AS kartNo,
       LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
       RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) AS telefon,
       k.GrupNo AS grupNo, k.VerilisTarihi AS verilis,
       CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE k.KartNo = CONVERT(VARCHAR(50), @kartNo)", new { kartNo }, commandTimeout: 30);

            if (kart is null) return NotFound(new { hata = "Kart bulunamadı." });

            var bakiye = GiftKartServisi.BakiyeSorgusu(db, kartNo);

            var hareketler = db.Query($@"
SELECT TOP 200 h.Tarih AS tarih, h.IslemTipi AS tip, h.SubeId AS subeId,
       h.BelgeNo AS belgeNo,
       CASE WHEN h.IslemTipi = 2
                 THEN ABS(COALESCE(NULLIF(h.EksiPuan, 0), h.Puan, 0))
            WHEN h.IslemTipi = 6
                 THEN ABS(ISNULL(h.Puan, 0))
            ELSE ABS(COALESCE(NULLIF(h.Puan, 0), h.EksiPuan, 0)) END AS tutar
FROM {HAREKET} h
WHERE h.KartNo = CONVERT(VARCHAR(50), @kartNo) AND h.Tarih >= @baslangic
ORDER BY h.Tarih DESC", new { kartNo, baslangic }, commandTimeout: 30).ToList();

            /* Şube kırılımı: hangi mağazada ne kadar harcandığı.
               Yalnızca harcama satırları; yükleme merkezden yapılıyor
               ve şubeye mal edilemez. */
            var subeler = db.Query($@"
SELECT h.SubeId AS subeId,
       COUNT(*) AS adet,
       SUM(ABS(COALESCE(NULLIF(h.EksiPuan, 0), h.Puan, 0))) AS tutar
FROM {HAREKET} h
WHERE h.KartNo = CONVERT(VARCHAR(50), @kartNo) AND h.Tarih >= @baslangic AND h.IslemTipi = 2
GROUP BY h.SubeId
ORDER BY SUM(ABS(COALESCE(NULLIF(h.EksiPuan, 0), h.Puan, 0))) DESC",
                new { kartNo, baslangic }, commandTimeout: 30).ToList();

            /* Kart kimde: panelden yapılan eşleşme */
            var kimde = KartKimde(kartNo);

            return Ok(new
            {
                kart = new
                {
                    kartNo = Convert.ToString(kart.kartNo)?.Trim(),
                    ad = (string)kart.ad,
                    telefon = (string)kart.telefon,
                    mobilKart = kart.grupNo is not null && (int)kart.grupNo == MOBIL,
                    grupNo = (int?)kart.grupNo,
                    sifreVar = (int)kart.sifreVar == 1,
                    verilis = kart.verilis,
                    bakiye,
                },

                kimde,

                hareketler = hareketler.Select(h => new
                {
                    h.tarih,
                    h.belgeNo,
                    h.subeId,
                    subeAdi = _giftKart.SubeAdiBul(h.subeId),
                    tip = (int)h.tip,
                    islem = GiftKartServisi.IslemAdi((int)h.tip),
                    tutar = h.tutar is null ? 0m : Convert.ToDecimal(h.tutar),
                }),

                subeler = subeler.Select(x => new
                {
                    x.subeId,
                    subeAdi = _giftKart.SubeAdiBul(x.subeId),
                    adet = (int)x.adet,
                    tutar = x.tutar is null ? 0m : Convert.ToDecimal(x.tutar),
                }),

                gun,
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart ayrıntısı okunamadı");

            return StatusCode(503, new
            {
                hata = "Kart veritabanına ulaşılamıyor.",
                ayrinti = hata.Message
            });
        }
    }

    /* ==================================================================== */
    /* İşlemler                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Kartı personele bağlar: kartın cep telefonu personelinkiyle
    /// güncelleniyor ve grup numarası mobil karta çevriliyor.
    /// </summary>
    /* ==================================================================== */
    /* Şube görünümü ve toplu eşleştirme                                    */
    /* ==================================================================== */

    /// <summary>
    /// Şube listesi: her şubede kaç personel var, kaçının kartı eşleşmiş.
    /// Kartlar tek tek aranmak yerine şubeden başlanarak bulunuyor.
    /// </summary>
    [HttpGet("Subeler")]
    public IActionResult Subeler()
    {
        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .ToList();

        var eslesmeler = Eslesmeler();

        var subeler = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim())
            .Select(g => new
            {
                sube = g.Key,
                personel = g.Count(),
                kartli = g.Count(x => eslesmeler.ContainsKey((x.PersonelKodu ?? "").Trim())),
                telefonsuz = g.Count(x => Telefon(x.Telefon).Length < 10),
            })
            .OrderBy(x => x.sube)
            .ToList();

        return Ok(new
        {
            subeler,
            toplamPersonel = subeler.Sum(x => x.personel),
            toplamKartli = subeler.Sum(x => x.kartli),
        });
    }

    /// <summary>
    /// Bir şubenin personeli: kart numarası, bakiyesi ve son hareketi.
    /// Kartı olmayanlar da listede — toplu eşleştirmede sıra onlara göre.
    /// </summary>
    [HttpGet("Sube")]
    public IActionResult Sube([FromQuery] string ad, [FromQuery] bool bakiye = true)
    {
        if (string.IsNullOrWhiteSpace(ad)) return BadRequest(new { hata = "Şube adı giriniz." });

        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && AyniSube(ad, x.IsGrubu))
            .OrderBy(x => x.Ad)
            .ToList();

        var eslesmeler = Eslesmeler();

        /* Şifre bilgisi POS tarafında; kart numarasına göre okunuyor */
        var sifreliler = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.PosBaglantisi();

            sifreliler = db.Query<string>($@"
SELECT CONVERT(VARCHAR(50), k.KartNo) FROM {TABLO} k WHERE k.KartSifre IS NOT NULL",
                    commandTimeout: 120)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart şifre bilgisi okunamadı");
        }

        var sonuc = personel.Select(p =>
        {
            var sicil = (p.PersonelKodu ?? "").Trim();

            eslesmeler.TryGetValue(sicil, out var esles);

            var kartNo = esles.KartNo;

            decimal? bakiyeDeger = null;

            if (bakiye && !string.IsNullOrWhiteSpace(kartNo))
                try
                {
                    using var db = _vt.PosBaglantisi();
                    bakiyeDeger = GiftKartServisi.BakiyeSorgusu(db, kartNo);
                }
                catch
                {
                    /* Bakiye alınamazsa satır yine dönüyor */
                }

            return new
            {
                sicil = p.PersonelKodu,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                pozisyon = p.Pozisyon,
                telefon = Telefon(p.Telefon),
                telefonVar = Telefon(p.Telefon).Length >= 10,
                kartNo = string.IsNullOrWhiteSpace(kartNo) ? null : kartNo,
                sifreVar = !string.IsNullOrWhiteSpace(kartNo) && sifreliler.Contains(kartNo),
                bakiye = bakiyeDeger,
                cikisTarihi = AyrilisTarihi(p.CikisTarihi),
                eslestirilemez = AyrilisTarihi(p.CikisTarihi).HasValue && !AyrilanaKartYetkisi,
            };
        }).ToList();

        return Ok(new
        {
            personel = sonuc,
            kartli = sonuc.Count(x => x.kartNo is not null),
            kartsiz = sonuc.Count(x => x.kartNo is null),
        });
    }

    public class TopluEslesmeGirdi
    {
        public string Sube { get; set; }

        /// <summary>Sırayla eşleştirilecek kart numaraları.</summary>
        public List<string> Kartlar { get; set; } = new();

        /// <summary>Yalnızca sonucu göster, kaydetme.</summary>
        public bool Deneme { get; set; }
    }

    /// <summary>
    /// Şubedeki kartsız personele, verilen kart numaralarını sırayla
    /// eşleştirir.
    ///
    /// <para>
    /// Eşleştirme telefon numarası üzerinden yapıldığı için telefonu
    /// kayıtlı olmayan personel atlanıyor ve sonuçta bildiriliyor.
    /// Kartı olan personel atlanıyor: var olan eşleşme bozulmasın.
    /// Önce <c>Deneme</c> ile hangi kartın kime gideceği gösteriliyor,
    /// onaydan sonra yazılıyor.
    /// </para>
    /// </summary>
    [HttpPost("TopluEsle")]
    public IActionResult TopluEsle([FromBody] TopluEslesmeGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.Sube))
            return BadRequest(new { hata = "Şube seçiniz." });

        var kartlar = (girdi.Kartlar ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (kartlar.Count == 0) return BadRequest(new { hata = "Kart numarası giriniz." });

        var mevcut = Eslesmeler();

        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && AyniSube(girdi.Sube, x.IsGrubu))
            .OrderBy(x => x.Ad)
            .ToList();

        var atlanan = new List<object>();

        /* Kartsız ve telefonu olan personel, ada göre sırayla */
        var hedefler = personel.Where(p =>
        {
            if (mevcut.ContainsKey((p.PersonelKodu ?? "").Trim()))
            {
                atlanan.Add(new { adSoyad = $"{p.Ad} {p.Soyad}".Trim(), sebep = "kartı zaten var" });
                return false;
            }

            if (AyrilisTarihi(p.CikisTarihi) is DateTime cikis)
            {
                atlanan.Add(new { adSoyad = $"{p.Ad} {p.Soyad}".Trim(), sebep = $"çıkış tarihi {cikis:dd.MM.yyyy}" });
                return false;
            }

            return true;
        }).ToList();

        var eslesmeler = hedefler.Zip(kartlar, (p, kart) => new
        {
            sicil = p.PersonelKodu,
            adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
            pozisyon = p.Pozisyon,
            telefon = Telefon(p.Telefon),
            kartNo = kart,
        }).ToList();

        var sonuc = new
        {
            eslesmeler,
            atlanan,
            kalanKart = kartlar.Count - eslesmeler.Count,
            kalanPersonel = hedefler.Count - eslesmeler.Count,
            deneme = girdi.Deneme,
        };

        if (girdi.Deneme) return Ok(sonuc);

        var yazilan = 0;
        var hatalar = new List<object>();

        foreach (var e in eslesmeler)
        {
            try
            {
                var cevap = Esle(new KartEslesmeGirdi { KartNo = e.kartNo, PersonelKodu = e.sicil });

                if (cevap is OkObjectResult)
                {
                    yazilan++;
                    continue;
                }

                /* Sebep kullanıcıya gösteriliyor: "kart yazılamadı" demek
                   neyin yanlış olduğunu söylemiyordu. */
                var sebep = "kart yazılamadı";

                if (cevap is ObjectResult o && o.Value is not null)
                {
                    var tur = o.Value.GetType();
                    var h = tur.GetProperty("hata")?.GetValue(o.Value) as string;
                    var a = tur.GetProperty("ayrinti")?.GetValue(o.Value) as string;

                    sebep = string.Join(" ", new[] { h, a }.Where(x => !string.IsNullOrWhiteSpace(x)));

                    if (string.IsNullOrWhiteSpace(sebep)) sebep = "kart yazılamadı";
                }

                hatalar.Add(new { e.adSoyad, e.kartNo, hata = sebep });
            }
            catch (Exception hata)
            {
                hatalar.Add(new { e.adSoyad, e.kartNo, hata = hata.Message });
            }
        }

        return Ok(new { sonuc.eslesmeler, sonuc.atlanan, sonuc.kalanKart, sonuc.kalanPersonel, yazilan, hatalar });
    }

    /// <summary>
    /// Panelden yapılan kart eşleşmeleri: kart numarası → personel.
    ///
    /// Eşleşme POS tarafındaki telefon alanından çıkarılmıyor artık;
    /// panelden ne tanımlandıysa o geçerli ve burada duruyor.
    /// </summary>
    private Dictionary<string, (string Sicil, string KartNo)> Eslesmeler()
    {
        var sonuc = new Dictionary<string, (string, string)>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.Baglanti();

            foreach (var x in db.Query(
                "SELECT kart_no AS kartNo, personel_kodu AS sicil FROM KRY_KART_ESLESME"))
            {
                var sicil = ((string)x.sicil ?? "").Trim();

                if (sicil.Length > 0) sonuc[sicil] = (sicil, ((string)x.kartNo ?? "").Trim());
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart eşleşmeleri okunamadı");
        }

        return sonuc;
    }

    /// <summary>
    /// Eşleşmeyi kaydeder; aynı kart başka personeldeyse taşınır. Hata
    /// yutulmuyor: eşleşme yazılamadıysa işlem başarılı sayılmamalı.
    /// </summary>
    /// <summary>Kart eşleşme geçmişine bir satır (yazılamazsa işlem bozulmaz)</summary>
    private void GecmisYaz(string sicil, string adSoyad, string kartNo, string islem, string aciklama = null)
    {
        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
INSERT INTO KRY_KART_ESLESME_GECMIS (personel_kodu, ad_soyad, kart_no, islem, aciklama, yapan)
VALUES (@sicil, @adSoyad, @kartNo, @islem, @aciklama, @yapan)",
                new
                {
                    sicil = (sicil ?? "").Trim(),
                    adSoyad,
                    kartNo = (kartNo ?? "").Trim(),
                    islem,
                    aciklama = aciklama is { Length: > 300 } ? aciklama[..300] : aciklama,
                    yapan = _disYapan ?? User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart geçmişi yazılamadı: {Kart}", kartNo);
        }
    }

    private void EslesmeYaz(string kartNo, PersonelKaydi kisi)
    {
        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
DELETE FROM KRY_KART_ESLESME WHERE kart_no = @kartNo OR personel_kodu = @sicil;

INSERT INTO KRY_KART_ESLESME (kart_no, personel_kodu, ad_soyad, sube_adi, eslestiren)
VALUES (@kartNo, @sicil, @ad, @sube, @yapan);",
                new
                {
                    kartNo = (kartNo ?? "").Trim(),
                    sicil = (kisi.PersonelKodu ?? "").Trim(),
                    ad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                    sube = kisi.IsGrubu,
                    yapan = User?.Identity?.Name,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart eşleşmesi kaydedilemedi: {Kart}", kartNo);
            throw;
        }
    }

    /// <summary>
    /// Eşleşmiş kartların MusteriKart kaydını personel bilgisiyle eşitler.
    ///
    /// <para>
    /// Ad sütununa personelin adı soyadı (30 hane), CepTel'e cep telefonu
    /// yazılıyor ve kart mobil karta çevriliyor. Kasa fişinde ve müşteri
    /// ekranında kartın kime ait olduğu görünsün. Tekrar çalıştırmak
    /// zararsız. Eski adı <c>GeniusDuzelt</c> da çalışıyor.
    /// </para>
    /// </summary>
    [HttpPost("BilgiEsitle")]
    [HttpPost("GeniusDuzelt")]
    public IActionResult BilgiEsitle([FromQuery] string sube = null)
    {
        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .Where(x => string.IsNullOrWhiteSpace(sube)
                        || AyniSube(sube, x.IsGrubu))
            .ToList();

        var kisilerSicil = personel
            .GroupBy(x => (x.PersonelKodu ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        List<dynamic> kartlar;

        try
        {
            using var db = _vt.Baglanti();

            kartlar = db.Query(
                "SELECT kart_no AS kartNo, personel_kodu AS sicil FROM KRY_KART_ESLESME").ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart eşleşmeleri okunamadı");

            return StatusCode(503, new { hata = "Eşleşme tablosu okunamadı.", ayrinti = hata.Message });
        }

        int yazilan = 0, bulunamayan = 0;
        var sonuclar = new List<object>();

        try
        {
            using var db = _vt.PosBaglantisi();

            foreach (var k in kartlar)
            {
                var sicil = ((string)k.sicil ?? "").Trim();

                if (!kisilerSicil.TryGetValue(sicil, out var kisi)) continue;

                var kartNo = ((string)k.kartNo ?? "").Trim();
                var etkilenen = KartaYaz(db, kartNo, kisi);

                if (etkilenen > 0)
                {
                    yazilan++;
                    continue;
                }

                bulunamayan++;

                if (sonuclar.Count < 100)
                    sonuclar.Add(new
                    {
                        kartNo,
                        adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                        sicil = kisi.PersonelKodu,
                        sube = kisi.IsGrubu,
                        hata = "Kart MusteriKart'ta bulunamadı",
                    });
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart bilgileri eşitlenemedi");

            return StatusCode(503, new { hata = "Kart veritabanına ulaşılamıyor.", ayrinti = hata.Message });
        }

        _kayit.LogInformation("Kart bilgileri eşitlendi: {Yazilan} kart, {Bulunamayan} bulunamadı",
            yazilan, bulunamayan);

        return Ok(new { yazilan, bulunamayan, basarisiz = bulunamayan, sonuclar });
    }

    /// <summary>
    /// Kartın MusteriKart kaydına personeli yazar: Ad = ad soyad (30 hane,
    /// büyük harf), Soyad boşaltılır, CepTel = cep telefonu (varsa), kart
    /// mobil karta çevrilir. Etkilenen satır sayısını döner.
    /// </summary>
    /// <param name="devral">
    /// Kart başka birinden geliyorsa true: eski sahibin şifresi silinir ve
    /// telefonu yeni sahibinkiyle (yoksa boş) değiştirilir. Aksi hâlde eski
    /// sahip telefon numarasıyla kartı uygulamada görmeye devam ederdi.
    /// </param>
    private static int KartaYaz(System.Data.IDbConnection db, string kartNo, PersonelKaydi kisi, bool devral = false)
    {
        var tel = Telefon(kisi.Telefon);
        var ad = Kisalt(Ust($"{kisi.Ad} {kisi.Soyad}"));

        return db.Execute($@"
UPDATE {TABLO}
SET Ad = @ad,
    Soyad = N'',
    CepTel = CASE WHEN @devral = 1 THEN @tel WHEN @tel IS NULL THEN CepTel ELSE @tel END,
    KartSifre = CASE WHEN @devral = 1 THEN NULL ELSE KartSifre END,
    GrupNo = @mobil,
    /* Mobil kart: kasa ödeme kodunu sorar (şifre değil) */
    PuanHarcamaSmsSifre = 0,
    GuncellemeTarihi = GETDATE()
WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new
            {
                ad,
                tel = tel.Length == 10 ? long.Parse(tel) : (long?)null,
                devral = devral ? 1 : 0,
                mobil = MOBIL,
                kartNo,
            },
            commandTimeout: 60);
    }

    /// <summary>
    /// Kartı boşa çıkarır: kimseye ait değilmiş gibi MusteriKart'ta ad
    /// "BİÇEN KART" olur, telefon ve şifre silinir, kart fiziki karta
    /// döner. Bakiye ve hareketler silinmez.
    /// </summary>
    private static int KartiBirak(System.Data.IDbConnection db, string kartNo) =>
        db.Execute($@"
UPDATE {TABLO}
SET Ad = @bos,
    Soyad = N'',
    CepTel = NULL,
    GrupNo = NULL,
    KartSifre = NULL,
    GuncellemeTarihi = GETDATE()
WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new { bos = BOS_KART_ADI, kartNo }, commandTimeout: 60);

    /// <summary>Kart panelden kime eşleştirilmiş; yoksa null.</summary>
    private object KartKimde(string kartNo)
    {
        try
        {
            using var db = _vt.Baglanti();

            var k = db.QueryFirstOrDefault(@"
SELECT TOP 1 personel_kodu AS sicil, ad_soyad AS adSoyad, sube_adi AS sube, eslesme
FROM KRY_KART_ESLESME WHERE kart_no = @kartNo", new { kartNo = (kartNo ?? "").Trim() });

            return k is null
                ? null
                : new
                {
                    sicil = ((string)k.sicil ?? "").Trim(),
                    adSoyad = (string)k.adSoyad,
                    sube = (string)k.sube,
                    eslesme = (DateTime)k.eslesme,
                };
        }
        catch
        {
            return null;
        }
    }

    private static string Telefon(string t)
    {
        var rakamlar = new string((t ?? "").Where(char.IsDigit).ToArray());

        return rakamlar.Length >= 10 ? rakamlar[^10..] : "";
    }

    /// <summary>Karta bağlanmış telefon numaraları: kimde kart var, oradan belli.</summary>
    private HashSet<string> KartTelefonlari() => KartTelefonlariDurum().Telefonlar;

    /// <summary>
    /// Kart telefonları ve okuma hatası. Hata yutulunca bütün personel
    /// "kartı yok" görünüyor ve eşleşmeler silinmiş sanılıyor.
    /// </summary>
    private (HashSet<string> Telefonlar, string Hata) KartTelefonlariDurum()
    {
        try
        {
            using var db = _vt.PosBaglantisi();

            var liste = db.Query<string>($@"
SELECT RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10)
FROM {TABLO} k WHERE k.CepTel IS NOT NULL AND k.CepTel > 0",
                    commandTimeout: 120)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .ToHashSet();

            return (liste, null);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart telefonları okunamadı");

            return (new HashSet<string>(), hata.Message);
        }
    }

    /// <summary>
    /// Kartı personele bağlar.
    ///
    /// <para>
    /// Kart MusteriKart'ta aranıyor (Genius3 artık kullanılmıyor). Bulunan
    /// kartın Ad sütununa personelin adı soyadı, CepTel'e telefonu yazılıyor
    /// ve kart mobil karta çevriliyor. Kart başka bir personeldeyse ondan
    /// alınıyor; personelin önceki kartı varsa o kart boşa çıkarılıyor.
    /// </para>
    /// </summary>
    [HttpPost("Esle")]
    public IActionResult Esle([FromBody] KartEslesmeGirdi girdi)
    {
        /* Aynı sicil hem eski (ayrılmış) hem güncel kayıtta olabilir: çalışan kayıt önce */
        var personel = _personelKaynak.TumPersonelleriGetir()
            .Where(x => (x.PersonelKodu ?? "").Trim() == (girdi?.PersonelKodu ?? "").Trim())
            .OrderByDescending(x => x.Durum == 1)
            .ThenByDescending(x => x.CikisTarihi ?? DateTime.MaxValue)
            .FirstOrDefault();

        if (personel is null)
            return BadRequest(new { hata = "Personel bulunamadı." });

        /* Ayrılmış ya da çıkışı yazılmış personel: yalnızca Yönetici */
        var ayrilmis = personel.Durum != 1
                       || (personel.CikisTarihi is DateTime ct && ct.Date < DateTime.Today);

        if (!AyrilanaKartYetkisi)
        {
            if (AyrilisTarihi(personel.CikisTarihi) is DateTime ayrilis)
                return BadRequest(new { hata = AyrilisMetni(ayrilis) + " Ayrılan personele kartı yalnızca Yönetici rolü tanımlayabilir." });

            if (ayrilmis)
                return StatusCode(403, new { hata = "İşten ayrılan personele kartı yalnızca Yönetici rolü tanımlayabilir." });
        }

        var kartNo = new string((girdi?.KartNo ?? "").Where(char.IsDigit).ToArray());

        if (kartNo.Length == 0)
            return BadRequest(new { hata = "Kart numarası gerekli." });

        var sicil = (personel.PersonelKodu ?? "").Trim();

        try
        {
            using var db = _vt.PosBaglantisi();

            var mevcut = db.QueryFirstOrDefault($@"
SELECT TOP 1 CASE WHEN CepTel IS NULL OR CepTel = 0 THEN NULL
                  ELSE RIGHT(CONVERT(VARCHAR(20), CepTel), 10) END AS telefon
FROM {TABLO} WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
                new { kartNo }, commandTimeout: 30);

            if (mevcut is null)
                return BadRequest(new
                {
                    hata = "Kart bulunamadı.",
                    ayrinti = "Bu numarayla PosbackPromosyon MusteriKart'ta kart kaydı yok. Numarayı "
                            + "kontrol edin; kart kasadan hiç okutulmadıysa kaydı olmayabilir.",
                });

            /* Eski durum: kart kimdeydi, personelin önceki kartı hangisiydi */
            var eslesmeler = Eslesmeler();

            var oncekiSahip = eslesmeler.Values
                .FirstOrDefault(x => string.Equals(x.KartNo, kartNo, StringComparison.OrdinalIgnoreCase)
                                     && !string.Equals(x.Sicil, sicil, StringComparison.OrdinalIgnoreCase));

            var oncekiKart = eslesmeler.TryGetValue(sicil, out var ek)
                             && !string.Equals(ek.KartNo, kartNo, StringComparison.OrdinalIgnoreCase)
                ? ek.KartNo
                : null;

            /* Kart başka birinden geliyor mu: panelde başkasına eşli ya da
               MusteriKart'ta başka bir telefona bağlı. Öyleyse eski sahibin
               şifresi ve telefonu karttan siliniyor. */
            var kartTel = (string)mevcut.telefon;
            var yeniTel = Telefon(personel.Telefon);
            var devral = oncekiSahip.Sicil is not null
                         || (!string.IsNullOrEmpty(kartTel) && kartTel != yeniTel);

            /* Önce eşleşme kaydı: yazılamazsa kart tarafına hiç dokunulmuyor */
            EslesmeYaz(kartNo, personel);

            KartaYaz(db, kartNo, personel, devral);

            /* Personelin eski kartı boşa çıkıyor: adı ve telefonu eski
               kartta kalırsa kasada yanlış kişi görünür. */
            if (!string.IsNullOrWhiteSpace(oncekiKart))
                KartiBirak(db, oncekiKart);

            var ad = $"{personel.Ad} {personel.Soyad}".Trim();

            GecmisYaz(sicil, ad, kartNo, oncekiKart is null ? "tanimlandi" : "degistirildi",
                oncekiKart is null ? null : $"Önceki kart {oncekiKart} boşa çıkarıldı");

            if (!string.IsNullOrWhiteSpace(oncekiKart))
                GecmisYaz(sicil, ad, oncekiKart, "birakildi", $"Yerine {kartNo} tanımlandı");

            if (oncekiSahip.Sicil is not null)
                GecmisYaz(oncekiSahip.Sicil, null, kartNo, "alindi", $"Kart {ad} ({sicil}) kişisine verildi");

            _kayit.LogInformation("Kart eşleştirildi: {Kart} → {Personel}{Onceki}{Ayrilan}",
                kartNo, sicil, oncekiSahip.Sicil is null ? "" : $" (önceki sahip {oncekiSahip.Sicil})",
                ayrilmis || AyrilisTarihi(personel.CikisTarihi).HasValue ? $" · ayrılan personel, {User?.Identity?.Name}" : "");

            return Ok(new
            {
                basarili = true,
                oncekiSahip = oncekiSahip.Sicil,
                birakilanKart = oncekiKart,
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart eşleştirilemedi");

            return StatusCode(503, new { hata = "İşlem yapılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>
    /// Eşleştirmeyi kaldırır.
    ///
    /// <para>
    /// Kart personelden ayrılıyor: eşleşme kaydı siliniyor ve kart
    /// MusteriKart'ta boşa çıkarılıyor (ad "BİÇEN KART", telefon ve şifre
    /// boş, fiziki kart). Telefon silinmezse mobil uygulama kartı telefon
    /// numarasından yine bulup eski sahibine gösteriyordu. Bakiye ve
    /// hareket geçmişi kartta kalıyor; kart başka personele yeniden
    /// eşleştirilebilir.
    /// </para>
    /// </summary>
    /// <summary>Panel dışından (işe alım kartı görevi) eşleştirmede kayıttaki "yapan"</summary>
    private string _disYapan;

    /// <summary>
    /// İşe alımda girilen kartı Mikro'ya işlenen çalışana bağlar
    /// (BasvuruKartGorevi). Panel "Kart tanımla" ile aynı yol. Hata yoksa null.
    /// </summary>
    [NonAction]
    public string DisaridanEsle(string sicil, string kartNo, string yapan)
    {
        _disYapan = yapan;

        try
        {
            var sonuc = Esle(new KartEslesmeGirdi { PersonelKodu = sicil, KartNo = kartNo });

            if (sonuc is ObjectResult o && (o.StatusCode ?? 200) >= 400)
            {
                var v = o.Value;
                var hata = v?.GetType().GetProperty("hata")?.GetValue(v) as string;
                var ayrinti = v?.GetType().GetProperty("ayrinti")?.GetValue(v) as string;
                return string.Join(" ", new[] { hata, ayrinti }.Where(x => !string.IsNullOrWhiteSpace(x))) is { Length: > 0 } m ? m : "Kart bağlanamadı.";
            }

            return null;
        }
        finally
        {
            _disYapan = null;
        }
    }

    /// <summary>
    /// İşe alım penceresi için kart denetimi (07.10.2026): kart POS'ta var
    /// mı, kimde, başka bir işe alımda bekliyor mu.
    /// </summary>
    [HttpGet("KartDogrula")]
    public IActionResult KartDogrula([FromQuery] string kartNo, [FromQuery] int basvuruId = 0)
    {
        var no = new string((kartNo ?? "").Where(char.IsDigit).ToArray());
        if (no.Length < 6) return BadRequest(new { hata = "Kart numarası eksik." });

        using var db = _vt.Baglanti();
        var engel = BasvuruKart.Denetle(db, _personelKaynak, no, basvuruId);

        bool? posta = null;
        string ad = null;

        try
        {
            using var pos = _vt.PosBaglantisi();
            var r = pos.QueryFirstOrDefault($"SELECT TOP 1 Ad FROM {TABLO} WHERE KartNo = CONVERT(VARCHAR(50), @no)",
                new { no }, commandTimeout: 15);
            posta = r is not null;
            ad = (string)r?.Ad;
        }
        catch
        {
            /* POS'a ulaşılamazsa kart varlığı bilinmiyor; işe alım yine kaydedilir */
        }

        return Ok(new
        {
            kartNo = no,
            uygun = engel is null && posta != false,
            hata = engel ?? (posta == false ? "Bu numarayla kart kaydı yok. Numarayı kontrol edin." : null),
            posta,
            kartAdi = ad,
        });
    }

    /// <summary>
    /// Rapor › Bekleyen işler (07.10.2026): onay bekleyen puan talepleri,
    /// işe alımda girilip henüz sicile bağlanmamış kartlar, kartı tanımlı
    /// olmayan çalışanlar.
    /// </summary>
    [HttpGet("Bekleyenler")]
    public IActionResult Bekleyenler()
    {
        using var db = _vt.Baglanti();

        var puanBekleyen = 0;
        try { puanBekleyen = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_PUAN_TALEP WHERE durum = N'bekliyor'"); } catch { }

        var iseAlim = new List<object>();
        try
        {
            iseAlim = db.Query(@"
SELECT k.basvuru_id, k.ad_soyad, k.kart_no, k.tarih, k.hata, b.durum
FROM KRY_BASVURU_KART k LEFT JOIN KRY_BASVURULAR b ON b.id = k.basvuru_id
WHERE k.personel_kodu IS NULL AND k.tarih >= DATEADD(DAY, -120, SYSDATETIME())
ORDER BY k.tarih DESC")
                .Select(x => (object)new
                {
                    basvuruId = (int)x.basvuru_id,
                    adSoyad = (string)x.ad_soyad,
                    kartNo = (string)x.kart_no,
                    tarih = (DateTime)x.tarih,
                    hata = (string)x.hata,
                    durum = (string)x.durum,
                })
                .ToList();
        }
        catch { }

        var eslesmeler = Eslesmeler();
        var bekleyenSicil = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var kartsiz = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu)
                        && !(x.CikisTarihi is DateTime ct && ct.Date < DateTime.Today)
                        && !eslesmeler.ContainsKey(x.PersonelKodu.Trim()))
            .OrderByDescending(x => x.GirisTarihi ?? DateTime.MinValue)
            .Select(x => new
            {
                sicil = x.PersonelKodu.Trim(),
                adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                sube = x.IsGrubu,
                pozisyon = x.Pozisyon,
                giris = x.GirisTarihi,
            })
            .ToList();

        return Ok(new { puanBekleyen, iseAlim, kartsiz });
    }

    [HttpPost("EslesmeKaldir")]
    public IActionResult EslesmeKaldir([FromBody] KartEslesmeGirdi girdi)
    {
        var kartNo = (girdi?.KartNo ?? "").Trim();
        var sicil = (girdi?.PersonelKodu ?? "").Trim();

        /* Sicil verildiyse kart numarası eşleşmeden bulunuyor */
        if (kartNo.Length == 0 && sicil.Length > 0 && Eslesmeler().TryGetValue(sicil, out var e))
            kartNo = e.KartNo ?? "";

        if (kartNo.Length == 0)
            return BadRequest(new { hata = "Kart numarası gerekli." });

        /* Geçmiş için kartın sahibi (kaldırmadan önce) */
        var sahip = Eslesmeler().Values.FirstOrDefault(x =>
            string.Equals((x.KartNo ?? "").Trim(), kartNo, StringComparison.OrdinalIgnoreCase));

        try
        {
            using (var db = _vt.PosBaglantisi())
                KartiBirak(db, kartNo);

            using (var db = _vt.Baglanti())
                db.Execute("DELETE FROM KRY_KART_ESLESME WHERE kart_no = @kartNo", new { kartNo });

            if (sahip.Sicil is not null)
                GecmisYaz(sahip.Sicil, null, kartNo, "kaldirildi", "Kart personelden alındı ve boşa çıkarıldı");

            _kayit.LogInformation("Kart eşleşmesi kaldırıldı: {Kart} ({Yapan})", kartNo, User?.Identity?.Name);

            return Ok(new { basarili = true });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Eşleşme kaldırılamadı");

            return StatusCode(503, new { hata = "İşlem yapılamadı.", ayrinti = hata.Message });
        }
    }

    /* ==================================================================== */
    /* Kasa doğrulaması: mobil → ödeme kodu, fiziki → kart şifresi           */
    /* ==================================================================== */

    /// <summary>
    /// Personel kartlarında (KRY_KART_ESLESME) kasa doğrulama ayarı kurala
    /// uymayanlar. Ayrılan personel bağlantısı gönderilmiş kartlar dışarıda:
    /// onlar bağlantıdaki şifreyle kullanılıyor.
    /// </summary>
    private (List<string> MobilSifreli, List<string> FizikiKodlu, int Toplam) KasaDogrulamaFarklari(
        System.Data.IDbConnection pos)
    {
        var personelKartlari = Eslesmeler().Values
            .Select(x => (x.KartNo ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.Baglanti();

            foreach (var k in db.Query<string>("SELECT DISTINCT kart_no FROM KRY_KART_AYRILAN_BAGLANTI"))
                personelKartlari.Remove((k ?? "").Trim());
        }
        catch
        {
            /* Bağlantı tablosu yoksa dışlanacak kart da yok */
        }

        var mobilSifreli = new List<string>();
        var fizikiKodlu = new List<string>();

        foreach (var parca in personelKartlari.Chunk(400))
            foreach (var k in pos.Query($@"
SELECT CONVERT(VARCHAR(50), KartNo) AS kartNo, GrupNo AS grupNo,
       ISNULL(PuanHarcamaSmsSifre, 0) AS sifre
FROM {TABLO} WHERE KartNo IN @parca", new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120))
            {
                var mobil = k.grupNo is not null && (int)k.grupNo == MOBIL;
                var sifreli = Convert.ToInt32(k.sifre) == 1;

                if (mobil && sifreli) mobilSifreli.Add(((string)k.kartNo).Trim());
                if (!mobil && !sifreli) fizikiKodlu.Add(((string)k.kartNo).Trim());
            }

        return (mobilSifreli, fizikiKodlu, personelKartlari.Count);
    }

    /// <summary>Kurala uymayan kart sayıları (Biçen Kart → Kasa doğrulaması).</summary>
    [HttpGet("KasaDogrulama")]
    public IActionResult KasaDogrulama()
    {
        try
        {
            using var pos = _vt.PosBaglantisi();
            var (mobil, fiziki, toplam) = KasaDogrulamaFarklari(pos);

            return Ok(new
            {
                toplam,
                mobilSifreli = mobil.Count,
                fizikiSifresiz = fiziki.Count,
                ornekMobil = mobil.Take(5),
                ornekFiziki = fiziki.Take(5),
            });
        }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Kart veritabanına ulaşılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>
    /// Kuralı personel kartlarına uygular: mobil (608) kartlarda kasa ödeme
    /// kodunu, fiziki kartlarda kart şifresini sorsun. Yalnızca yönetici ve
    /// İK yöneticisi; güvenlik günlüğüne yazılır.
    /// </summary>
    [HttpPost("KasaDogrulamaEsitle")]
    public IActionResult KasaDogrulamaEsitle([FromServices] GuvenlikGunlugu gunluk)
    {
        if (Roller.Temel(Rol) is not (Roller.Admin or Roller.IKYoneticisi))
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz yok." });

        try
        {
            using var pos = _vt.PosBaglantisi();
            var (mobil, fiziki, _) = KasaDogrulamaFarklari(pos);

            var degisen = 0;

            foreach (var parca in mobil.Chunk(400))
                degisen += pos.Execute($@"
UPDATE {TABLO} SET PuanHarcamaSmsSifre = 0
WHERE KartNo IN @parca AND GrupNo = {MOBIL}", new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120);

            foreach (var parca in fiziki.Chunk(400))
                degisen += pos.Execute($@"
UPDATE {TABLO} SET PuanHarcamaSmsSifre = 1
WHERE KartNo IN @parca AND GrupNo IS NULL", new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120);

            gunluk.Yaz("BİÇEN KART KASA DOĞRULAMASI", IstemciAdresi.Bul(HttpContext),
                $"{User.Identity?.Name} · mobil→ödeme kodu {mobil.Count}, fiziki→şifre {fiziki.Count}");

            return Ok(new { basarili = true, mobil = mobil.Count, fiziki = fiziki.Count, degisen });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kasa doğrulaması eşitlenemedi");
            return StatusCode(503, new { hata = "İşlem yapılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Kart şifresini sıfırlar ya da belirler.</summary>
    [HttpPost("Sifre")]
    public IActionResult Sifre([FromBody] KartSifreGirdi girdi)
    {
        var kartNo = (girdi?.KartNo ?? "").Trim();

        if (kartNo.Length == 0)
            return BadRequest(new { hata = "Kart numarası gerekli." });

        var sifre = new string((girdi?.Sifre ?? "").Where(char.IsDigit).ToArray());

        /* Boş gönderilirse şifre kaldırılıyor: personel unuttuğunda
           İK'nın sıfırlayıp yenisini uygulamadan belirletmesi gerekiyor. */
        if (sifre.Length != 0 && sifre.Length != 4)
            return BadRequest(new { hata = "Şifre 4 haneli rakam olmalıdır." });

        try
        {
            using var db = _vt.PosBaglantisi();

            /* Yazma GiftKartServisi'ndeki tek yoldan: uygulama ve ayrılan
               personelin SMS bağlantısı da aynısını kullanıyor. */
            var (basarili, hata) = GiftKartServisi.KartSifresiYaz(
                db, kartNo, sifre.Length == 0 ? null : sifre, _kayit);

            return basarili
                ? Ok(new { basarili = true, sifreVar = sifre.Length == 4 })
                : BadRequest(new { hata });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart şifresi değiştirilemedi");

            return StatusCode(503, new { hata = "İşlem yapılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>
    /// Kart arama: kaynak PosbackPromosyon MusteriKart.
    ///
    /// <para>
    /// Kart numarasının bir parçasıyla aranıyor (en az dört hane). Her
    /// sonuçta kartın boşta mı, kimde mi olduğu da dönüyor: eşleşme
    /// panelin kendi tablosundan (KRY_KART_ESLESME).
    /// </para>
    /// </summary>
    [HttpGet("Ara")]
    public IActionResult Ara([FromQuery] string kartNo)
    {
        var no = new string((kartNo ?? "").Where(char.IsDigit).ToArray());

        if (no.Length < 4)
            return BadRequest(new { hata = "Kart numarasının en az dört hanesini yazınız." });

        try
        {
            using var db = _vt.PosBaglantisi();

            /* Tam numara yazıldıysa doğrudan eşitlikle, dizin kullanılarak
               aranıyor; parça yazıldıysa içinde geçenler. */
            var kayitlar = (no.Length >= 12
                    ? db.Query($@"
SELECT TOP 20 CONVERT(VARCHAR(50), k.KartNo) AS kartNo,
       LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
       CASE WHEN k.CepTel IS NULL OR k.CepTel = 0 THEN NULL
            ELSE RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) END AS telefon,
       k.GrupNo AS grupNo,
       CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE k.KartNo = CONVERT(VARCHAR(50), @no)", new { no }, commandTimeout: 60).ToList()
                    : new List<dynamic>())
                .ToList();

            if (kayitlar.Count == 0)
                kayitlar = db.Query($@"
SELECT TOP 20 CONVERT(VARCHAR(50), k.KartNo) AS kartNo,
       LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
       CASE WHEN k.CepTel IS NULL OR k.CepTel = 0 THEN NULL
            ELSE RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) END AS telefon,
       k.GrupNo AS grupNo,
       CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE CONVERT(VARCHAR(50), k.KartNo) LIKE @desen
ORDER BY k.KartNo",
                    new { desen = "%" + no + "%" }, commandTimeout: 90).ToList();

            var eslesmeler = Eslesmeler().Values
                .Where(x => !string.IsNullOrWhiteSpace(x.KartNo))
                .GroupBy(x => x.KartNo, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Sicil, StringComparer.OrdinalIgnoreCase);

            var personel = _personelKaynak.TumPersonelleriGetir()
                .GroupBy(x => (x.PersonelKodu ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

            return Ok(new
            {
                kayitlar = kayitlar.Select(k =>
                {
                    var kno = ((string)k.kartNo ?? "").Trim();

                    object kimde = null;

                    if (eslesmeler.TryGetValue(kno, out var sicil))
                    {
                        personel.TryGetValue(sicil, out var p);

                        kimde = new
                        {
                            sicil,
                            adSoyad = p is null ? sicil : $"{p.Ad} {p.Soyad}".Trim(),
                            sube = p?.IsGrubu,
                            aktif = p?.Durum == 1,
                        };
                    }

                    return new
                    {
                        kartNo = kno,
                        ad = ((string)k.ad ?? "").Trim(),
                        telefon = (string)k.telefon,
                        mobilKart = k.grupNo is not null && (int)k.grupNo == MOBIL,
                        sifreVar = (int)k.sifreVar == 1,
                        kimde,
                    };
                }).ToList(),
            });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart aranamadı");

            return StatusCode(503, new
            {
                hata = "Kart veritabanına ulaşılamıyor.",
                ayrinti = hata.Message
            });
        }
    }
}

/// <summary>Kart eşleştirme girdisi.</summary>
public class KartEslesmeGirdi
{
    public string PersonelKodu { get; set; }
    public string KartNo { get; set; }
}

/// <summary>Kart şifresi girdisi; boş şifre kaldırma anlamına geliyor.</summary>
public class KartSifreGirdi
{
    public string KartNo { get; set; }
    public string Sifre { get; set; }
}

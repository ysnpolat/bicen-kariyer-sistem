using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yıllık İzin Ücretleri (03.10.2026).
///
/// <para>
/// Çalışan her personel için "bugün ayrılsa kullanmadığı yıllık izin için
/// ne kadar ödenir" sorusunun cevabı: şirketin izin yükümlülüğü.
/// </para>
///
/// <para>
/// Hesap (30 günlük ay):
///   günlük = net maaş ÷ 30
///   tutar  = günlük × kullanılmamış gün
/// Örnek: 53.000 TL net, 10 gün → 53.000 ÷ 30 = 1.766,67 · × 10 = 17.666,67 TL.
/// Yuvarlama yalnızca ekranda yapılır; toplamlar yuvarlanmamış değerlerden
/// alınır, yoksa 900 kişide kuruş farkları liraya birikiyor.
/// </para>
///
/// <para>
/// Net maaş: Mikro bordro veritabanındaki (MikroDesktop_BICEN)
/// PERSONEL_TAHAKKUKLARI.pt_net. İçinde bulunulan aya göre hesaplanır:
/// kişinin bu aydan sonra olmayan EN SON tahakkuk ayı (pt_net &gt; 0). Bir
/// ayda birden çok satır varsa ücret pusulasıyla aynı satır alınır
/// (pt_tahno, sonra pt_kanun_modu sırasıyla ilki — TahakkukController).
/// Böylece buradaki rakam personelin elindeki pusuladaki "Net ödenecek"
/// ile birebir aynıdır.
/// </para>
///
/// <para>
/// Kullanılmamış gün: Yıllık İzin ekranının bakiyesi (IzinBakiyeHesabi).
/// Ayrılışta ödenecek gün = hak edilen + devir − kullanılan; planlı izin
/// henüz kullanılmadığı için düşülmez, ayrıca gösterilir.
/// </para>
///
/// <para>
/// Ücret verisi olduğu için YALNIZCA Yönetici (Admin) rolüne açık; Rol
/// Yetkileri'nden başka bir role verilemez. Her görüntüleme güvenlik
/// günlüğüne yazılır.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class IzinUcretiController : ControllerBase
{
    /// <summary>Ay 30 gün sayılır (İK'nın kullandığı esas).</summary>
    private const decimal AyGunu = 30m;

    /// <summary>
    /// Bordroda geriye en çok kaç yıl bakılır. Tahakkuk tablosu yüzlerce
    /// sütunlu ve yıllar boyu birikiyor; tamamını taramak gereksiz yük.
    /// Çalışan bir personelin iki yılı aşkın süredir tahakkuku yoksa o
    /// rakamla hesap yapmak zaten yanıltıcı olurdu — "maaş bulunamadı"
    /// olarak görünür ve İK bakar.
    /// </summary>
    private const int GeriyeYil = 2;

    /// <summary>
    /// Hesap 60 saniye bellekte tutulur. Ekranda süzgeç değiştikçe ya da
    /// iki yönetici aynı anda açtığında Mikro'ya tekrar tekrar gidilmesin;
    /// süre kısa, çünkü izin girildiğinde rakamın çabuk güncellenmesi
    /// gerekiyor.
    /// </summary>
    private static readonly TimeSpan OnbellekSuresi = TimeSpan.FromSeconds(60);

    private static readonly object _kilit = new();
    private static Hesap _onbellek;
    private static DateTime _onbellekZamani;

    private static readonly CompareInfo Turkce = CultureInfo.GetCultureInfo("tr-TR").CompareInfo;

    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly IzinFormuServisi _izinFormu;
    private readonly AyarServisi _ayar;
    private readonly ILogger<IzinUcretiController> _kayit;

    /* Kıdeme göre yıllık izin hakkı (06.10.2026, İş Kanunu md. 53): 1–5 yıl
       14, 6–14 yıl 20, 15 yıl ve üzeri 26 gün; 18 yaş altı ve 50 yaş üstü
       en az 20 gün (IzinHakKurali). 1 yılı dolmamış personelin hakkı yok;
       listede değil, ayrı kartta yıl dolum tarihiyle görünüyor. */
    private readonly DogumTarihiServisi _dogum;

    public IzinUcretiController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        GuvenlikGunlugu gunluk,
        IzinFormuServisi izinFormu,
        AyarServisi ayar,
        DogumTarihiServisi dogum,
        ILogger<IzinUcretiController> kayit)
    {
        _dogum = dogum;
        _ayar = ayar;
        _izinFormu = izinFormu;
        _vt = vt;
        _personelKaynak = personelKaynak;
        _gunluk = gunluk;
        _kayit = kayit;
    }

    private string Kullanici => User?.Identity?.Name ?? "-";

    private string Rol =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>
    /// Yalnızca Yönetici. Temel() ile bakılıyor: panelden açılan özel
    /// roller Admin'i temel alamaz (Roller.OzelRolleriYukle onları en dar
    /// role düşürüyor), yani özel rol adıyla bu kapıdan geçilemez.
    /// </summary>
    private bool Yetkili => Roller.Temel(Rol) == Roller.Admin;

    /* ==================================================================== */
    /* Uç                                                                   */
    /* ==================================================================== */

    /// <summary>Çalışan personelin kullanılmamış izin ücreti.</summary>
    /// <param name="sube">Yalnızca bu şube</param>
    /// <param name="ara">Ad, sicil, şube ya da ünvanda geçen metin</param>
    [HttpGet]
    public IActionResult Getir([FromQuery] string sube = null, [FromQuery] string ara = null)
    {
        var adres = IstemciAdresi.Bul(HttpContext);

        if (!Yetkili)
        {
            /* Reddedilen deneme de yazılır: menüde görünmeyen bir ekrana
               adresle ulaşılmaya çalışılması kendi başına bir işaret. */
            _gunluk.Yaz("İZİN ÜCRETİ REDDİ", adres, $"{Kullanici} ({Rol})");
            return StatusCode(403, new { hata = "Bu ekran yalnızca Yönetici rolüne açıktır." });
        }

        Hesap hesap;

        try
        {
            hesap = HesabiGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yıllık izin ücretleri hesaplanamadı");
            return StatusCode(503, new { hata = "İzin ücretleri hesaplanamadı.", ayrinti = hata.Message });
        }

        IEnumerable<IzinUcretiKaydi> secilen = hesap.Kayitlar;

        if (!string.IsNullOrWhiteSpace(sube))
            secilen = secilen.Where(x => string.Equals(x.Sube, sube.Trim(), StringComparison.OrdinalIgnoreCase));

        if (!string.IsNullOrWhiteSpace(ara))
        {
            var a = ara.Trim();

            /* Türkçe büyük/küçük harf: "işcan" araması "IŞCAN"ı bulsun */
            bool Gecer(string s) =>
                !string.IsNullOrEmpty(s) && Turkce.IndexOf(s, a, CompareOptions.IgnoreCase) >= 0;

            secilen = secilen.Where(x => Gecer(x.Ad) || Gecer(x.Kod) || Gecer(x.Sube) || Gecer(x.Pozisyon));
        }

        var kayitlar = secilen.ToList();

        IEnumerable<YeniPersonel> yeniler = hesap.Yeniler;

        if (!string.IsNullOrWhiteSpace(sube))
            yeniler = yeniler.Where(x => string.Equals(x.Sube, sube.Trim(), StringComparison.OrdinalIgnoreCase));

        var yeniListe = yeniler.ToList();

        /* Ücret verisi: kimin ne zaman baktığı izlenebilmeli. Tutar
           günlüğe yazılmaz; günlüğü okuyabilen herkes rakamı görmesin. */
        _gunluk.Yaz("İZİN ÜCRETİ GÖRÜNTÜLENDİ", adres,
            $"{Kullanici}: {kayitlar.Count} kişi"
            + (string.IsNullOrWhiteSpace(sube) ? "" : $", şube {sube.Trim()}")
            + (string.IsNullOrWhiteSpace(ara) ? "" : $", arama \"{ara.Trim()}\""));

        return Ok(new
        {
            donem = new { yil = hesap.Yil, ay = hesap.Ay },
            hesapTarihi = hesap.Zaman,
            ayGunu = AyGunu,
            kayitlar,
            yeniler = yeniListe,
            kurallar = new
            {
                hak1_5 = IzinHakKurali.Gun1_5,
                hak6_14 = IzinHakKurali.Gun6_14,
                hak15 = IzinHakKurali.Gun15,
                yasIstisna = IzinHakKurali.GunYasIstisna,
            },
            ozet = Ozetle(kayitlar, yeniListe),
            uyarilar = hesap.Uyarilar
        });
    }

    /// <summary>
    /// Yıllık izin maliyet raporu (05.10.2026): şubenin kalan yıllık izin
    /// yükü — çalışanlar bugün ayrılsa kalan izinleri için ödenecek NET
    /// tutar (yukarıdaki listenin aynı hesabı, 1 yılı dolmamışlar hariç).
    ///
    /// <para>
    /// Aylık sütunlar anlık görüntü: rapor her açıldığında içinde bulunulan
    /// ayın şube toplamları KRY_IZIN_UCRET_ANLIK'a yazılır (ayın son hesabı
    /// kalır). Geçmiş aylar bu kayıtlardan; içinde bulunulan ay her zaman
    /// canlı. Kalan izin geçmişe dönük bilinmediği için ilk sütun raporun
    /// ilk kullanıldığı ay.
    /// </para>
    /// </summary>
    [HttpGet("Maliyet")]
    public IActionResult Maliyet([FromQuery] int? yil = null)
    {
        var adres = IstemciAdresi.Bul(HttpContext);

        if (!Yetkili)
        {
            _gunluk.Yaz("İZİN ÜCRETİ REDDİ", adres, $"{Kullanici} ({Rol}) · maliyet raporu");
            return StatusCode(403, new { hata = "Bu ekran yalnızca Yönetici rolüne açıktır." });
        }

        var bugun = DateTime.Today;
        var y = yil is >= 2015 and <= 2100 ? yil.Value : bugun.Year;
        var harf = CultureInfo.GetCultureInfo("tr-TR");

        try
        {
            var hesap = HesabiGetir();

            /* Bugünkü şube toplamları */
            var canli = hesap.Kayitlar
                .GroupBy(x => (x.Sube ?? "Belirtilmemiş").Trim().ToUpper(harf))
                .Select(g => new
                {
                    Sube = g.Key,
                    Kisi = g.Count(),
                    Gun = g.Sum(x => x.OdenecekGun ?? 0m),
                    Tutar = g.Sum(x => x.Tutar ?? 0m),
                })
                .ToList();

            var subeler = new Dictionary<string, (decimal[] Tutar, decimal[] Gun, int[] Kisi)>(StringComparer.OrdinalIgnoreCase);

            (decimal[] Tutar, decimal[] Gun, int[] Kisi) Al(string ad)
            {
                if (!subeler.TryGetValue(ad, out var s))
                    subeler[ad] = s = (new decimal[12], new decimal[12], new int[12]);
                return s;
            }

            using (var db = _vt.Baglanti())
            {
                /* Bu ayın anlık görüntüsü: şube başına tek satır */
                try
                {
                    db.Open();
                    using var islem = db.BeginTransaction();

                    db.Execute("DELETE FROM KRY_IZIN_UCRET_ANLIK WHERE yil = @y AND ay = @a",
                        new { y = bugun.Year, a = bugun.Month }, islem);

                    foreach (var c in canli)
                        db.Execute(@"
INSERT INTO KRY_IZIN_UCRET_ANLIK (yil, ay, sube, kisi, gun, tutar)
VALUES (@y, @a, @sube, @kisi, @gun, @tutar)",
                            new
                            {
                                y = bugun.Year, a = bugun.Month,
                                sube = c.Sube.Length > 150 ? c.Sube[..150] : c.Sube,
                                kisi = c.Kisi, gun = Math.Round(c.Gun, 1), tutar = Math.Round(c.Tutar, 2)
                            }, islem);

                    islem.Commit();
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "İzin maliyeti anlık görüntüsü yazılamadı");
                }

                foreach (var r in db.Query(@"
SELECT ay, sube, kisi, gun, tutar FROM KRY_IZIN_UCRET_ANLIK WHERE yil = @y", new { y }))
                {
                    var ay = (int)r.ay;
                    if (ay is < 1 or > 12) continue;

                    var s = Al(((string)r.sube ?? "").Trim().ToUpper(harf));
                    s.Gun[ay - 1] = (decimal)r.gun;
                    s.Tutar[ay - 1] = (decimal)r.tutar;
                    s.Kisi[ay - 1] = (int)r.kisi;
                }
            }

            /* İçinde bulunulan ay her zaman canlı değerle */
            if (y == bugun.Year)
            {
                foreach (var s in subeler.Values)
                {
                    s.Gun[bugun.Month - 1] = 0;
                    s.Tutar[bugun.Month - 1] = 0;
                    s.Kisi[bugun.Month - 1] = 0;
                }

                foreach (var c in canli)
                {
                    var s = Al(c.Sube);
                    s.Gun[bugun.Month - 1] = c.Gun;
                    s.Tutar[bugun.Month - 1] = c.Tutar;
                    s.Kisi[bugun.Month - 1] = c.Kisi;
                }
            }

            var canliHarita = canli.ToDictionary(x => x.Sube, StringComparer.OrdinalIgnoreCase);

            var sirali = subeler
                .OrderBy(x => x.Key, StringComparer.Create(harf, true))
                .Select(x =>
                {
                    canliHarita.TryGetValue(x.Key, out var c);

                    return new
                    {
                        sube = x.Key,
                        tutar = x.Value.Tutar,
                        gun = x.Value.Gun,
                        kisi = x.Value.Kisi,
                        bugunKisi = c?.Kisi ?? 0,
                        bugunGun = c?.Gun ?? 0m,
                        bugunTutar = c?.Tutar ?? 0m,
                    };
                })
                .ToList();

            _gunluk.Yaz("İZİN ÜCRETİ GÖRÜNTÜLENDİ", adres, $"{Kullanici}: maliyet raporu {y}");

            return Ok(new
            {
                yil = y,
                buAy = y == bugun.Year ? bugun.Month : 12,
                canliAy = y == bugun.Year ? bugun.Month : (int?)null,
                subeler = sirali,
                aylikTutar = Enumerable.Range(0, 12).Select(i => sirali.Sum(x => x.tutar[i])),
                aylikGun = Enumerable.Range(0, 12).Select(i => sirali.Sum(x => x.gun[i])),
                aylikKisi = Enumerable.Range(0, 12).Select(i => sirali.Sum(x => x.kisi[i])),
                bugunTutar = canli.Sum(x => x.Tutar),
                bugunGun = canli.Sum(x => x.Gun),
                bugunKisi = canli.Sum(x => x.Kisi),
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin maliyet raporu hazırlanamadı");
            return StatusCode(503, new { hata = "Maliyet raporu hazırlanamadı.", ayrinti = hata.Message });
        }
    }

    /* ==================================================================== */
    /* Hesap                                                                */
    /* ==================================================================== */

    private sealed class Hesap
    {
        public int Yil { get; init; }
        public int Ay { get; init; }
        public DateTime Zaman { get; init; }
        public List<IzinUcretiKaydi> Kayitlar { get; init; }
        public List<YeniPersonel> Yeniler { get; init; }
        public List<string> Uyarilar { get; init; }

        /// <summary>Herkesin (ayrılanlar dahil) günlük ücreti ve şubesi: maliyet raporu için.</summary>
        public Dictionary<string, (decimal Gunluk, string Sube)> Gunlukler { get; init; }
    }

    /// <summary>Bordrodan okunan son net maaş.</summary>
    private sealed class MaasSatiri
    {
        public string Kod { get; set; }
        public int Yil { get; set; }
        public int Ay { get; set; }
        public decimal Net { get; set; }

        public int Sira => Yil * 100 + Ay;
    }

    /// <summary>Aynı bordro ayının brüt temel kazancı (kazanç 1–7 tutar ve gün)</summary>
    private sealed class BrutSatiri
    {
        public string Kod { get; set; }
        public decimal Tutar { get; set; }
        public decimal Gun { get; set; }
    }

    private sealed class KimlikSatiri
    {
        public string Kod { get; set; }
        public string Tc { get; set; }
    }

    /// <summary>
    /// Aylık net maaşlar (sicil → tutar): genel merkezde son bordro neti,
    /// diğerlerinde personel kartındaki ücret — Yıllık İzin Ücretleri ile
    /// aynı kaynak. Avans üst limiti buradan hesaplanıyor (06.10.2026).
    /// </summary>
    [NonAction]
    public Dictionary<string, decimal> AylikMaaslar() =>
        HesabiGetir().Gunlukler
            .ToDictionary(x => x.Key.Trim().TrimStart('0'), x => Math.Round(x.Value.Gunluk * AyGunu, 2),
                StringComparer.OrdinalIgnoreCase);

    private Hesap HesabiGetir()
    {
        var h = _onbellek;
        if (h is not null && DateTime.UtcNow - _onbellekZamani < OnbellekSuresi) return h;

        /* Aynı anda gelen istekler hesabı bir kez yapsın; Mikro sorgusu
           birkaç saniye sürebiliyor. */
        lock (_kilit)
        {
            h = _onbellek;
            if (h is not null && DateTime.UtcNow - _onbellekZamani < OnbellekSuresi) return h;

            h = Hesapla();
            _onbellek = h;
            _onbellekZamani = DateTime.UtcNow;
            return h;
        }
    }

    private Hesap Hesapla()
    {
        var simdi = DateTime.Now;
        var bugun = simdi.Date;
        var yil = bugun.Year;
        var ay = bugun.Month;
        var uyarilar = new List<string>();

        /* Çalışanlar: ileri tarihli çıkışı olan (ihbar süresindeki) kişi de
           Durum = 1 — hâlâ çalışıyor ve ödeme tam da onda gündeme gelecek. */
        var tumPersonel = _personelKaynak.TumPersonelleriGetir();

        var personeller = tumPersonel
            .Where(x => x.Durum == 1)
            .ToList();

        /* Genel merkez: maaş bordrodan; diğerleri personel kartındaki
           ücretten (05.10.2026). Form ayarı bir kez okunuyor. */
        var form = _izinFormu.FormAyari();
        var merkezMi = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

        bool Merkez(PersonelKaydi x)
        {
            var k = (x.PersonelKodu ?? "").Trim();

            if (!merkezMi.TryGetValue(k, out var m))
                merkezMi[k] = m = _izinFormu.GenelMerkezMi(x, form);

            return m;
        }

        /* ---------------------------------------------------- net maaş */
        List<MaasSatiri> maaslar;
        var brutler = new Dictionary<string, BrutSatiri>(StringComparer.OrdinalIgnoreCase);
        var bordroKimlik = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        using (var bordro = _vt.TahakkukBaglantisi())
        {
            /* İki aşama, tek sorgu:
                 1) Her kişi-ay için asıl satır: pusuladaki sırayla ilki
                    (pt_tahno, pt_kanun_modu). Ek tahakkuklar elenir.
                 2) Asıl satırı pt_net > 0 olan aylardan en sonuncusu.
               Dönem koşulu "bu aydan sonra değil": ileri aya açılmış
               taslak tahakkuk bugünün maaşı sayılmasın.
               Uyumluluk düzeyi 130'un altında; STRING_SPLIT/OPENJSON yok,
               ROW_NUMBER yeterli. */
            maaslar = bordro.Query<MaasSatiri>(@"
WITH ana AS (
    SELECT LTRIM(RTRIM(t.pt_pkod))            AS Kod,
           CAST(t.pt_maliyil AS INT)          AS Yil,
           CAST(t.pt_tah_ay AS INT)           AS Ay,
           CAST(t.pt_net AS DECIMAL(19, 2))   AS Net,
           ROW_NUMBER() OVER (
               PARTITION BY t.pt_pkod, t.pt_maliyil, t.pt_tah_ay
               ORDER BY t.pt_tahno, t.pt_kanun_modu) AS AySirasi
    FROM PERSONEL_TAHAKKUKLARI t WITH (NOLOCK)
    WHERE t.pt_maliyil >= @enEski
      AND (t.pt_maliyil < @yil OR (t.pt_maliyil = @yil AND t.pt_tah_ay <= @ay))
),
son AS (
    SELECT Kod, Yil, Ay, Net,
           ROW_NUMBER() OVER (PARTITION BY Kod ORDER BY Yil DESC, Ay DESC) AS Sira
    FROM ana
    WHERE AySirasi = 1 AND Net > 0
)
SELECT Kod, Yil, Ay, Net FROM son WHERE Sira = 1",
                new { yil, ay, enEski = yil - GeriyeYil },
                commandTimeout: 120).ToList();

            /* Brüt karşılık (03.10.2026, kullanıcı isteği): İş Kanunu md. 59
               kullanılmayan izin ücretini son BRÜT ücret üzerinden ister.
               Net maaşla aynı bordro ayının temel kazanç kalemleri (normal,
               hafta tatili, genel tatil, ücretli izin, mazeret, hasta, kısa
               çalışma) alınıyor; fazla mesai ve sosyal yardımlar ücret
               sayılmadığı için dışarıda. Ay eksik çalışılmışsa (yeni giriş)
               günlük brüt = tutar ÷ gün ile tam aya ölçekleniyor.
               Ayrı sorgu: sütunlar bir Mikro sürümünde yoksa net hesap
               bozulmasın, yalnızca brüt boş kalsın. */
            try
            {
                foreach (var b in bordro.Query<BrutSatiri>(@"
WITH ana AS (
    SELECT LTRIM(RTRIM(t.pt_pkod)) AS Kod,
           CAST(t.pt_net AS DECIMAL(19, 2)) AS Net,
           CAST(ISNULL(t.pt_kazanc1_tktutar, 0) + ISNULL(t.pt_kazanc2_tktutar, 0)
              + ISNULL(t.pt_kazanc3_tktutar, 0) + ISNULL(t.pt_kazanc4_tktutar, 0)
              + ISNULL(t.pt_kazanc5_tktutar, 0) + ISNULL(t.pt_kazanc6_tktutar, 0)
              + ISNULL(t.pt_kazanc7_tktutar, 0) AS DECIMAL(19, 2)) AS Tutar,
           CAST(ISNULL(t.pt_kazanc1_tkgun, 0) + ISNULL(t.pt_kazanc2_tkgun, 0)
              + ISNULL(t.pt_kazanc3_tkgun, 0) + ISNULL(t.pt_kazanc4_tkgun, 0)
              + ISNULL(t.pt_kazanc5_tkgun, 0) + ISNULL(t.pt_kazanc6_tkgun, 0)
              + ISNULL(t.pt_kazanc7_tkgun, 0) AS DECIMAL(19, 2)) AS Gun,
           CAST(t.pt_maliyil AS INT) AS Yil,
           CAST(t.pt_tah_ay AS INT) AS Ay,
           ROW_NUMBER() OVER (
               PARTITION BY t.pt_pkod, t.pt_maliyil, t.pt_tah_ay
               ORDER BY t.pt_tahno, t.pt_kanun_modu) AS AySirasi
    FROM PERSONEL_TAHAKKUKLARI t WITH (NOLOCK)
    WHERE t.pt_maliyil >= @enEski
      AND (t.pt_maliyil < @yil OR (t.pt_maliyil = @yil AND t.pt_tah_ay <= @ay))
),
son AS (
    SELECT Kod, Tutar, Gun,
           ROW_NUMBER() OVER (PARTITION BY Kod ORDER BY Yil DESC, Ay DESC) AS Sira
    FROM ana
    WHERE AySirasi = 1 AND Net > 0
)
SELECT Kod, Tutar, Gun FROM son WHERE Sira = 1",
                    new { yil, ay, enEski = yil - GeriyeYil },
                    commandTimeout: 120))
                {
                    if (!string.IsNullOrWhiteSpace(b.Kod) && b.Tutar > 0 && b.Gun > 0)
                        brutler[b.Kod] = b;
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İzin ücreti: bordro brüt kazançları okunamadı");
                uyarilar.Add("Bordrodaki brüt kazanç kalemleri okunamadı; brüt karşılık gösterilemiyor.");
            }

            /* Bordro veritabanının kendi personel kartından T.C. kimlik no.
               Personel listesi başka veritabanından (2004BICEN) geliyor ve
               iki yerde sicil kodu farklı olabiliyor; kod tutmazsa kişi
               T.C. ile bulunur. Sütun okunamazsa yalnızca kodla eşlenir. */
            try
            {
                /* T.C. sütunu bordro veritabanında farklı adla tutulabiliyor:
                   ücret pusulası (TahakkukController) kimlik numarasını
                   per_sicil_no'dan okuyor. Hangisi varsa o kullanılır;
                   sütun adı yalnızca bu iki sabitten seçildiği için sorguya
                   güvenle yazılıyor. Değer 11 haneli değilse eşleşmede
                   kullanılmıyor. */
                var tcSutunu = bordro.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM sys.columns
WHERE object_id = OBJECT_ID('PERSONELLER')
  AND name IN ('Per_TcKimlikNo', 'per_sicil_no')
ORDER BY CASE name WHEN 'Per_TcKimlikNo' THEN 0 ELSE 1 END");

                if (tcSutunu is not ("Per_TcKimlikNo" or "per_sicil_no"))
                    throw new InvalidOperationException("Bordro personel kartında T.C. sütunu bulunamadı.");

                foreach (var k in bordro.Query<KimlikSatiri>($@"
SELECT LTRIM(RTRIM(per_kod)) AS Kod,
       LTRIM(RTRIM(CAST([{tcSutunu}] AS NVARCHAR(20)))) AS Tc
FROM PERSONELLER WITH (NOLOCK)
WHERE [{tcSutunu}] IS NOT NULL",
                             commandTimeout: 60))
                {
                    var tc = new string((k.Tc ?? "").Where(char.IsDigit).ToArray());

                    if (!string.IsNullOrWhiteSpace(k.Kod) && tc.Length == 11) bordroKimlik[k.Kod] = tc;
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Bordro personel kimlikleri okunamadı");
                uyarilar.Add("Bordrodaki T.C. kimlik numaraları okunamadı; maaş yalnızca sicil koduyla eşleştirildi.");
            }
        }

        var koduyla = maaslar
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .GroupBy(x => x.Kod, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Sira).First(),
                          StringComparer.OrdinalIgnoreCase);

        /* Aynı T.C. bordroda birden çok sicille bulunabilir (ayrılıp yeni
           kodla tekrar giriş). En son dönemi olan alınır. */
        var tcIle = maaslar
            .Where(x => bordroKimlik.ContainsKey(x.Kod))
            .GroupBy(x => bordroKimlik[x.Kod])
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Sira).First());

        /* ------------------------------------------------ izin bakiyesi */
        IzinBakiyeHesabi.Tablo bakiyeTablosu;
        Dictionary<string, dynamic> duzeltmeler;

        using (var db = _vt.Baglanti())
        {
            bakiyeTablosu = IzinBakiyeHesabi.Oku(db);
            duzeltmeler = IzinHakedis.Hepsi(db);
        }

        /* ---------------------------------------------------- birleştir */
        var kayitlar = new List<IzinUcretiKaydi>(personeller.Count);
        var yeniler = new List<YeniPersonel>();

        /* Bordro eşleşmesi: kod, olmazsa T.C. (aşağıdaki kuralın aynısı) */
        MaasSatiri BordroMaasi(PersonelKaydi x, out string yol)
        {
            yol = null;
            var k = (x.PersonelKodu ?? "").Trim();
            var t = new string((x.KimlikNo ?? "").Where(char.IsDigit).ToArray());

            if (koduyla.TryGetValue(k, out var mm))
            {
                var bt = bordroKimlik.GetValueOrDefault(mm.Kod);

                if (t.Length == 0 || string.IsNullOrEmpty(bt) || bt == t)
                {
                    yol = "kod";
                    return mm;
                }
            }

            if (t.Length > 0 && tcIle.TryGetValue(t, out var tt))
            {
                yol = "tc";
                return tt;
            }

            return null;
        }

        /* Maliyet raporu için herkesin günlük ücreti */
        var gunlukler = new Dictionary<string, (decimal, string)>(StringComparer.OrdinalIgnoreCase);

        foreach (var x in tumPersonel)
        {
            var k = (x.PersonelKodu ?? "").Trim();

            if (k.Length == 0 || gunlukler.ContainsKey(k)) continue;

            decimal? aylik = !Merkez(x) && x.Ucret is > 0 ? x.Ucret : BordroMaasi(x, out _)?.Net;

            if (aylik is > 0)
                gunlukler[k] = (aylik.Value / AyGunu, string.IsNullOrWhiteSpace(x.Sube) ? "Belirtilmemiş" : x.Sube.Trim());
        }

        foreach (var p in personeller)
        {
            var kod = (p.PersonelKodu ?? "").Trim();

            /* Kıdem: önceki çalışma dönemleri dahil toplam gün (personel
               kartındaki kıdemle aynı); yoksa hak ediş esasından. */
            DateTime? kidemEsas = IzinHakedis.Esas(p.GirisTarihi, duzeltmeler.GetValueOrDefault(kod));
            int kidemGunu = p.KidemGunu > 0
                ? p.KidemGunu
                : kidemEsas is DateTime ke ? Math.Max(0, (int)(bugun - ke.Date).TotalDays) : 0;
            var kidemYil = (int)Math.Floor(kidemGunu / 365.25);
            var yas = IzinHakKurali.Yas(_dogum.Getir(kod), bugun);

            if (kidemYil < 1)
            {
                yeniler.Add(new YeniPersonel
                {
                    Kod = kod,
                    Ad = $"{p.Ad} {p.Soyad}".Trim(),
                    Sube = string.IsNullOrWhiteSpace(p.Sube) ? "Belirtilmemiş" : p.Sube.Trim(),
                    Pozisyon = p.Pozisyon,
                    KidemTarihi = p.KidemTarihi ?? kidemEsas,
                    KidemGun = kidemGunu,
                    YilDolum = bugun.AddDays(Math.Max(0, 365 - kidemGunu)),
                    KalanGun = Math.Max(0, 365 - kidemGunu),
                });

                continue;
            }

            var merkez = Merkez(p);
            /* Bordro tarafı rakama indirgendi; bu taraf da aynı biçimde */
            var tc = new string((p.KimlikNo ?? "").Where(char.IsDigit).ToArray());

            /* Önce sicil kodu. Ama kod iki veritabanında başka kişilere
               verilmiş olabilir: iki tarafta da T.C. biliniyor ve
               farklıysa kod eşleşmesi reddedilir, T.C. ile aranır. */
            var maas = BordroMaasi(p, out var eslesme);

            /* Genel merkez dışı: personel kartındaki ücret. Kartta ücret
               yoksa bordroya düşülüyor ve ekranda belirtiliyor. */
            var kartUcreti = !merkez && p.Ucret is > 0 ? p.Ucret : null;
            var maasKaynak = kartUcreti is not null ? "kart" : maas is not null ? "bordro" : null;
            decimal? aylikNet = kartUcreti ?? maas?.Net;

            var b = bakiyeTablosu.Hesapla(kod);
            /* Tip açıkça yazılıyor: düzeltme dynamic geldiği için 'var'
               sonucu da dynamic yapar ve hata derlemede değil çalışırken çıkar */
            DateTime? esas = IzinHakedis.Esas(p.GirisTarihi, duzeltmeler.GetValueOrDefault(kod));

            /* Bugün ayrılsa: hak edilen + devir − kullanılan (planlı düşülmez) */
            var kalan = b.KullanilmamisGun;
            var eksi = kalan is < 0;
            decimal? odenecekGun = kalan is null ? null : Math.Max(0m, kalan.Value);

            decimal? gunluk = aylikNet is null ? null : aylikNet.Value / AyGunu;

            decimal? tutar =
                odenecekGun is null ? null
                : eksi ? 0m                                  // eksi bakiyede ödenecek bir şey yok
                : gunluk is null ? null
                : gunluk.Value * odenecekGun.Value;

            var durum =
                !b.Girildi ? "bakiyeYok"
                : eksi ? "eksiBakiye"
                : aylikNet is null ? "maasYok"
                : "tamam";

            /* Brüt: net ile aynı bordro satırından (maaş hangi kodla
               bulunduysa o) */
            var brut = maas is null ? null : brutler.GetValueOrDefault(maas.Kod);
            decimal? brutGunluk = brut is null ? null : brut.Tutar / brut.Gun;
            decimal? brutTutar =
                tutar is null || brutGunluk is null ? null
                : eksi ? 0m
                : brutGunluk.Value * odenecekGun.Value;

            kayitlar.Add(new IzinUcretiKaydi
            {
                Kod = kod,
                Ad = $"{p.Ad} {p.Soyad}".Trim(),
                Sube = string.IsNullOrWhiteSpace(p.Sube) ? "Belirtilmemiş" : p.Sube.Trim(),
                Pozisyon = p.Pozisyon,
                GirisTarihi = p.GirisTarihi,
                HakedisEsas = esas,
                KidemGun = kidemGunu,
                KidemYil = kidemYil,
                YillikHak = IzinHakKurali.HakGun(kidemYil, yas),
                Yas = yas,
                YasIstisnasi = IzinHakKurali.YasIstisnasi(yas) && IzinHakKurali.KidemHakki(kidemYil) < IzinHakKurali.GunYasIstisna,
                GenelMerkez = merkez,
                MaasKaynak = maasKaynak,
                KartUcretiYok = !merkez && kartUcreti is null,
                Ayrilacak = p.Ayrilacak,
                CikisTarihi = p.Ayrilacak ? p.CikisTarihi : null,

                NetMaas = aylikNet,
                MaasDonemi = maasKaynak != "bordro" || maas is null ? null : new IzinUcretiDonem { Yil = maas.Yil, Ay = maas.Ay },
                MaasEslesme = maasKaynak == "bordro" ? eslesme : null,
                Gunluk = gunluk,
                BrutMaas = brutGunluk is null ? null : brutGunluk.Value * 30m,
                BrutGunluk = brutGunluk,
                BrutTutar = brutTutar,

                Hakedilen = b.Hakedilen,
                Devir = b.Devir,
                Kullanilan = b.Kullanilan,
                Planli = b.Planli,
                KalanGun = kalan,
                OdenecekGun = odenecekGun,
                Tutar = tutar,

                BakiyeVar = b.Girildi,
                MaasVar = aylikNet is not null,
                EksiBakiye = eksi,
                Durum = durum
            });
        }

        kayitlar = kayitlar
            .OrderByDescending(x => x.Tutar ?? -1)
            .ThenBy(x => x.Ad, StringComparer.Create(CultureInfo.GetCultureInfo("tr-TR"), true))
            .ToList();

        return new Hesap
        {
            Yil = yil,
            Ay = ay,
            Zaman = simdi,
            Kayitlar = kayitlar,
            Yeniler = yeniler.OrderBy(x => x.YilDolum).ToList(),
            Gunlukler = gunlukler,
            Uyarilar = uyarilar
        };
    }

    /// <summary>Özet: yuvarlanmamış değerlerden.</summary>
    private static object Ozetle(List<IzinUcretiKaydi> kayitlar, List<YeniPersonel> yeniler)
    {
        var gunlu = kayitlar.Where(x => x.OdenecekGun is not null).ToList();

        var subeler = kayitlar
            .GroupBy(x => x.Sube)
            .Select(g => new
            {
                sube = g.Key,
                kisi = g.Count(),
                gun = g.Sum(x => x.OdenecekGun ?? 0m),
                tutar = g.Sum(x => x.Tutar ?? 0m),
                brutTutar = g.Sum(x => x.BrutTutar ?? 0m)
            })
            .OrderByDescending(x => x.tutar)
            .ThenBy(x => x.sube)
            .ToList();

        return new
        {
            toplamTutar = kayitlar.Sum(x => x.Tutar ?? 0m),
            toplamBrutTutar = kayitlar.Sum(x => x.BrutTutar ?? 0m),
            brutYok = kayitlar.Count(x => x.Tutar is not null && x.BrutTutar is null),
            kisi = kayitlar.Count,
            odenecekKisi = kayitlar.Count(x => x.Tutar > 0),
            toplamGun = gunlu.Sum(x => x.OdenecekGun.Value),

            /* Bakiyesi bilinenlerin ortalaması; girilmemiş olanlar sıfır
               sayılırsa ortalama yapay olarak düşer */
            ortalamaGun = gunlu.Count == 0 ? 0m : gunlu.Average(x => x.OdenecekGun.Value),
            bakiyeYok = kayitlar.Count(x => !x.BakiyeVar),
            maasYok = kayitlar.Count(x => !x.MaasVar),
            eksiBakiye = kayitlar.Count(x => x.EksiBakiye),

            /* Tutarı hesaplanamayan kişi: bakiyesi ya da maaşı eksik */
            hesaplanamayan = kayitlar.Count(x => x.Tutar is null),

            /* Kıdem grupları (İş Kanunu md. 53): 1 yılı dolmamış (listede yok),
               1–5 yıl, 6–14 yıl, 15 yıl ve üzeri; yaş istisnası (18 altı /
               50 ve üstü, en az 20 gün) ayrıca sayılıyor. */
            kidem = new
            {
                yeni = yeniler.Count,
                yeniBuAy = yeniler.Count(x => x.KalanGun <= 31),
                yil1_5 = kayitlar.Count(x => x.KidemYil is >= 1 and <= 5),
                yil6_14 = kayitlar.Count(x => x.KidemYil is >= 6 and < 15),
                yil15 = kayitlar.Count(x => x.KidemYil >= 15),
                gun1_5 = kayitlar.Where(x => x.KidemYil is >= 1 and <= 5).Sum(x => x.OdenecekGun ?? 0m),
                gun6_14 = kayitlar.Where(x => x.KidemYil is >= 6 and < 15).Sum(x => x.OdenecekGun ?? 0m),
                gun15 = kayitlar.Where(x => x.KidemYil >= 15).Sum(x => x.OdenecekGun ?? 0m),
                tutar1_5 = kayitlar.Where(x => x.KidemYil is >= 1 and <= 5).Sum(x => x.Tutar ?? 0m),
                tutar6_14 = kayitlar.Where(x => x.KidemYil is >= 6 and < 15).Sum(x => x.Tutar ?? 0m),
                tutar15 = kayitlar.Where(x => x.KidemYil >= 15).Sum(x => x.Tutar ?? 0m),
                yasIstisnasi = kayitlar.Count(x => x.YasIstisnasi),
            },
            kartUcretiYok = kayitlar.Count(x => x.KartUcretiYok),
            subeler
        };
    }
}

/// <summary>1 yılı dolmamış personel: izin hakkı yok, yıl dolum tarihi.</summary>
public class YeniPersonel
{
    public string Kod { get; set; }
    public string Ad { get; set; }
    public string Sube { get; set; }
    public string Pozisyon { get; set; }
    public DateTime? KidemTarihi { get; set; }
    public int KidemGun { get; set; }

    /// <summary>1. yılın dolacağı gün</summary>
    public DateTime YilDolum { get; set; }

    /// <summary>Dolum tarihine kalan gün</summary>
    public int KalanGun { get; set; }
}

/// <summary>Bordro dönemi.</summary>
public class IzinUcretiDonem
{
    public int Yil { get; set; }
    public int Ay { get; set; }
}

/// <summary>Bir personelin kullanılmamış izin ücreti.</summary>
public class IzinUcretiKaydi
{
    public string Kod { get; set; }
    public string Ad { get; set; }
    public string Sube { get; set; }
    public string Pozisyon { get; set; }
    public DateTime? GirisTarihi { get; set; }

    /// <summary>Kıdemin hesaplandığı tarih (hak ediş düzeltmesi varsa o)</summary>
    public DateTime? HakedisEsas { get; set; }

    public int? KidemGun { get; set; }

    /// <summary>Tamamlanmış kıdem yılı (önceki dönemler dahil)</summary>
    public int KidemYil { get; set; }

    /// <summary>Yıllık hak (İş Kanunu md. 53): 1–5 yıl 14, 6–14 yıl 20, 15+ yıl 26; 18 altı / 50 ve üstü en az 20</summary>
    public int YillikHak { get; set; }

    /// <summary>Bugünkü yaş; doğum tarihi yoksa null</summary>
    public int? Yas { get; set; }

    /// <summary>Hak yaş istisnasıyla 20 güne çıktı</summary>
    public bool YasIstisnasi { get; set; }

    public bool GenelMerkez { get; set; }

    /// <summary>Maaşın kaynağı: "kart" (personel kartı ücreti) | "bordro" (son tahakkuk net)</summary>
    public string MaasKaynak { get; set; }

    /// <summary>Genel merkez dışında kartta ücret yok; bordroya düşüldü</summary>
    public bool KartUcretiYok { get; set; }

    /// <summary>Çıkışı ileri bir güne yazılmış (ihbar süresinde)</summary>
    public bool Ayrilacak { get; set; }
    public DateTime? CikisTarihi { get; set; }

    public decimal? NetMaas { get; set; }
    public IzinUcretiDonem MaasDonemi { get; set; }

    /// <summary>Maaş hangi yolla bulundu: "kod" ya da "tc"</summary>
    public string MaasEslesme { get; set; }

    /// <summary>Net ÷ 30, yuvarlanmamış</summary>
    public decimal? Gunluk { get; set; }

    public decimal? Hakedilen { get; set; }
    public decimal Devir { get; set; }
    public decimal Kullanilan { get; set; }
    public decimal Planli { get; set; }

    /// <summary>Hak edilen + devir − kullanılan; eksi olabilir</summary>
    public decimal? KalanGun { get; set; }

    /// <summary>Ödenecek gün: kalan, sıfırın altına inmez</summary>
    public decimal? OdenecekGun { get; set; }

    /// <summary>Günlük × ödenecek gün, yuvarlanmamış</summary>
    public decimal? Tutar { get; set; }

    /// <summary>Aylık brüt (30 güne ölçeklenmiş temel kazanç); yoksa null</summary>
    public decimal? BrutMaas { get; set; }

    /// <summary>Brüt günlük = temel kazanç ÷ kazanç günü</summary>
    public decimal? BrutGunluk { get; set; }

    /// <summary>Brüt günlük × ödenecek gün (İş Kanunu md. 59 karşılığı)</summary>
    public decimal? BrutTutar { get; set; }

    public bool BakiyeVar { get; set; }
    public bool MaasVar { get; set; }
    public bool EksiBakiye { get; set; }

    /// <summary>tamam | bakiyeYok | maasYok | eksiBakiye</summary>
    public string Durum { get; set; }
}

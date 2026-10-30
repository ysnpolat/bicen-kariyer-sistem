using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Başvuru raporları: genel özet, aylık dağılım, şube ve bölüm kırılımları,
/// dönüşüm oranları ve hiç başvuru almayan şube/bölüm listeleri.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RaporController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly ILogger<RaporController> _kayit;

    public RaporController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        ILogger<RaporController> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _kayit = kayit;
    }

    /// <summary>Bölüm ayrıştırması için ara sınıf</summary>
    private class BolumSatiri
    {
        public string Bolumler { get; set; }
        public string Durum { get; set; }
    }

    /// <summary>Norm kadro eşleştirmesi için ara sınıf</summary>
    private class BolumSayim
    {
        public string SubeKodu { get; set; }
        public string Bolumler { get; set; }
        public string Durum { get; set; }
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private bool SubeSiniri => Roller.SubeSiniri(Rol);

    private string[] YetkiliSubeler()
    {
        var ham = User?.FindFirst("subeler")?.Value ?? "";
        var liste = ham.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        return liste.Length > 0 ? liste : new[] { "__TANIMSIZ__" };
    }

    /// <summary>
    /// Sağ üstteki bölge seçicisinde seçilen bölgelerin şube kodları.
    /// Seçim yoksa null döner ve süzme uygulanmaz.
    /// </summary>
    private string[] SecilenBolgeSubeleri()
    {
        if (!Roller.BolgeSecici(Rol)) return null;

        var secim = Request.Headers["X-Bolge"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(secim)) return null;

        var bolgeAdlari = secim
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => Uri.UnescapeDataString(x.Trim()))
            .Where(x => x.Length > 0)
            .ToArray();

        if (bolgeAdlari.Length == 0) return null;

        var ayar = _ayar.FormOku();

        var kodlar = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => bolgeAdlari.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return kodlar.Length > 0 ? kodlar : new[] { "__TANIMSIZ__" };
    }

    /// <summary>Bölge seçimi etkin mi</summary>
    private bool BolgeSuzgeci => SecilenBolgeSubeleri() is not null;

    /// <summary>Süzmede kullanılacak şube listesi</summary>
    private string[] SuzmeSubeleri() =>
        SecilenBolgeSubeleri() ?? YetkiliSubeler();

    /// <summary>Şube süzmesi uygulanacak mı (yetki veya bölge seçimi)</summary>
    private bool SubeSuzmesi => SubeSiniri || BolgeSuzgeci;

    /// <summary>
    /// Yetkili şubelerin KOD kümesi.
    ///
    /// Bölge tanımında şubeler kimi yerde kod, kimi yerde ad ile yazılmış;
    /// doğrudan kod karşılaştırması adla yazılanları düşürüyordu. Her iki
    /// yazım da koda çevriliyor.
    /// </summary>
    private HashSet<string> YetkiliKodlar()
    {
        var tanimlar = _ayar.FormOku().Subeler ?? new List<Sube>();

        return SuzmeSubeleri()
            .Select(y =>
                tanimlar.FirstOrDefault(x =>
                    string.Equals(x.Kod, y, StringComparison.OrdinalIgnoreCase))?.Kod
                ?? tanimlar.FirstOrDefault(x =>
                    string.Equals(x.Ad, y, StringComparison.OrdinalIgnoreCase))?.Kod
                ?? y)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static readonly string[] AyAdlari =
    {
        "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
    };

    /// <summary>
    /// Rapordaki bir satıra tıklandığında o kırılıma ait başvuruları listeler.
    /// Genel listeden farklı olarak Olumlu ve Olumsuz kayıtlar da döner.
    /// </summary>
    [HttpGet("Basvurular")]
    public IActionResult Basvurular(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string subeKodu = null,
        [FromQuery] string bolum = null,
        [FromQuery] string ilce = null,
        [FromQuery] string birimTuru = null,
        /// <summary>Tek durum ya da virgülle ayrılmış durum listesi</summary>
        [FromQuery] string durum = null,
        [FromQuery] string bolge = null,
        [FromQuery] string kullanici = null,

        /* Kaynak kırılımından tıklanınca: adayın bizi nereden duyduğu.
           "Diğer" satırında serbest metin eşleştiriliyor. */
        [FromQuery] string kaynak = null,
        [FromQuery] string kaynakDetay = null,

        /* Raporlar sayfasından açılan liste: sayfadaki kutularla aynı taban
           (arşiv ve aynı adayın eski başvuruları hariç). Kutuda 21 yazıp
           listede 25 kayıt çıkmasın diye (03.10.2026). İK performans
           ekranı bu parametreyi göndermez; onun davranışı değişmez. */
        [FromQuery] bool rapor = false,

        /* Norm kadro satırından açılan "işe alınan" listesi: işe giriş
           tarihi dönemde olan İşe Alındı kayıtları (İşe alınanlar
           bölümüyle aynı kural). */
        [FromQuery] bool iseGiris = false)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-11).AddDays(1 - DateTime.Today.Day);
        /* Bitiş günü dahil: ertesi günün başına kadar. Önceden 23:59:59'a
           kadar alınıyor, son saniyedeki milisaniyeler dışarıda kalıyordu;
           Başvurular sayfası da "< ertesi gün" kullanıyor. */
        var bitisSonrasi = (bit?.Date ?? DateTime.Today).AddDays(1);

        /* Bölge verildiyse o bölgenin şubeleri süzgece çevrilir */
        var bolgeSubeleri = string.IsNullOrWhiteSpace(bolge)
            ? Array.Empty<string>()
            : KullaniciController.BolgeSubeleri(bolge, _ayar.FormOku());

        /* Uzman verildiyse yalnızca onun işlem yaptığı başvurular listelenir */
        var kullanicilar = (kullanici ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        var durumlar = (durum ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        /* Raporlar sayfası, kutularla aynı yetki kümesini kullanır: bölge
           tanımında adla yazılmış şubeler koda çevrilir (YetkiliKodlar). */
        var yetkili = rapor && SubeSuzmesi
            ? YetkiliKodlar().ToArray()
            : SuzmeSubeleri();

        /* İşe giriş listesi "İşe alınanlar" bölümüyle aynı: tabansız (bir
           kişi işe alındıktan sonra yeniden başvursa da alım sayılır). */
        var taban = rapor && !iseGiris ? " AND " + BasvuruTabani.RaporKosul("b") : "";

        /* İşe giriş listesi tarihi başvurudan değil işe girişten alır */
        var tarihKosulu = iseGiris
            ? @"b.durum = N'İşe Alındı'
  AND (b.ise_giris_tarihi >= @bas AND b.ise_giris_tarihi < @bitSonra
       OR (b.ise_giris_tarihi IS NULL AND b.olusturma >= @bas AND b.olusturma < @bitSonra))"
            : "b.olusturma >= @bas AND b.olusturma < @bitSonra";

        /* İşe giriş listesinde pozisyon, varsa işe başladığı pozisyondur */
        var bolumKosulu = iseGiris
            ? @"(N',' + REPLACE(ISNULL(NULLIF(LTRIM(RTRIM(b.ise_giris_bolum)), N''), b.bolumler), N', ', N',') + N',')
                  LIKE (N'%,' + @bolum + N',%')"
            : "(N',' + REPLACE(b.bolumler, N', ', N',') + N',') LIKE (N'%,' + @bolum + N',%')";

        using var db = _vt.Baglanti();

        var kayitlar = db.Query<BasvuruOzet>($@"
SELECT b.id AS Id, b.basvuru_no AS BasvuruNo, b.ad_soyad AS AdSoyad, b.kimlik_no AS KimlikNo,
       b.telefon AS Telefon, b.eposta AS Eposta, b.sube_kodu AS SubeKodu, b.sube_adi AS SubeAdi,
       b.bolumler AS Bolumler, b.birim_turu AS BirimTuru,
       b.il AS Il, b.ilce AS Ilce, b.mahalle AS Mahalle,
       b.durum AS Durum, b.degerlendirme_notu AS DegerlendirmeNotu,
       b.kaynak AS Kaynak, b.kaynak_detay AS KaynakDetay,
       b.gorusme_tarihi AS GorusmeTarihi, b.gorusme_yeri AS GorusmeYeri,
       b.ise_giris_tarihi AS IseGirisTarihi, b.ise_giris_bolum AS IseGirisBolum,
       b.anlasilan_ucret AS AnlasilanUcret, b.yol_ucreti AS YolUcreti,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS TalepUcret,
       b.olusturma AS Olusturma, b.guncelleme AS Guncelleme, b.guncelleyen AS Guncelleyen,
       b.mail_gonderildi AS MailGonderildi,
       (SELECT COUNT(*) FROM KRY_BASVURU_NOT n WHERE n.basvuru_id = b.id)
           AS NotSayisi
FROM KRY_BASVURULAR b
WHERE {tarihKosulu}{taban}
  AND (@sube  IS NULL OR ISNULL(b.sube_kodu, '') = @sube)
  AND (@ilce  IS NULL OR ISNULL(NULLIF(LTRIM(RTRIM(b.ilce)), N''), N'Belirtilmemiş') = @ilce)
  AND (@kaynak IS NULL
       OR ISNULL(NULLIF(LTRIM(RTRIM(b.kaynak)), N''), N'Belirtilmemiş') = @kaynak)
  AND (@kaynakDetay IS NULL OR LTRIM(RTRIM(b.kaynak_detay)) = @kaynakDetay)
  AND (@bolum IS NULL OR {bolumKosulu})
  AND (@birimTuru IS NULL OR ISNULL(b.birim_turu, N'Şube') = @birimTuru)
  AND (@durumVar = 0 OR b.durum IN @durumlar)
  AND (@bolgeVar = 0 OR b.sube_kodu IN @bolgeSubeleri)
  AND (@kullaniciVar = 0 OR EXISTS (
        SELECT 1 FROM KRY_BASVURU_HAREKET h
        WHERE h.basvuru_id = b.id
          AND h.kullanici IN @kullanicilar
          AND h.tarih >= @bas AND h.tarih < @bitSonra))
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY b.olusturma DESC",
            new
            {
                bas = baslangic,
                bitSonra = bitisSonrasi,
                /* "__BOS__": şubesi boş başvurular (rapordaki "—" satırı) */
                sube = string.IsNullOrWhiteSpace(subeKodu) ? null
                    : subeKodu == "__BOS__" ? "" : subeKodu,
                ilce = string.IsNullOrWhiteSpace(ilce) ? null : ilce,
                kaynak = string.IsNullOrWhiteSpace(kaynak) ? null : kaynak.Trim(),
                kaynakDetay = string.IsNullOrWhiteSpace(kaynakDetay)
                    ? null : kaynakDetay.Trim(),
                bolum = string.IsNullOrWhiteSpace(bolum) ? null : bolum.Trim(),
                birimTuru = string.IsNullOrWhiteSpace(birimTuru) || birimTuru == "Tümü"
                    ? null
                    : birimTuru,
                durumVar = durumlar.Length > 0 ? 1 : 0,
                durumlar = durumlar.Length > 0 ? durumlar : new[] { "__YOK__" },
                bolgeVar = bolgeSubeleri.Length > 0 ? 1 : 0,
                bolgeSubeleri = bolgeSubeleri.Length > 0
                    ? bolgeSubeleri
                    : new[] { "__YOK__" },
                kullaniciVar = kullanicilar.Length > 0 ? 1 : 0,
                kullanicilar = kullanicilar.Length > 0
                    ? kullanicilar
                    : new[] { "__YOK__" },
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = yetkili.Length > 0 ? yetkili : new[] { "__TANIMSIZ__" }
            }).ToList();

        /* Raporlar sayfası kimlik numarasını kullanmıyor; listeden Excel'e
           aktarıldığında maskesiz numara dosyaya geçmesin. */
        if (rapor)
            foreach (var k in kayitlar) k.KimlikNo = null;

        return Ok(kayitlar);
    }

    /// <summary>
    /// Pozisyon bazında doldurma süreleri: hangi pozisyonun açığı kaç günde
    /// kapatıldı. Kasiyer, reyoner gibi her pozisyon ayrı satırdır.
    /// </summary>
    [HttpGet("DoldurmaSureleri")]
    public IActionResult DoldurmaSureleri(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string bolge = null)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        var ayar = _ayar.FormOku();

        using var db = _vt.Baglanti();

        /* Norm kadroda eksiğin başladığı tarih bilinmiyorsa (eski kayıtlar)
           başvurunun geldiği tarihten işe girişe kadar geçen süre kullanılır.
           Hangi ölçütün kullanıldığı satırda belirtilir. */
        var kayitlar = db.Query<DoldurmaKaydi>(@"
SELECT b.id AS Id, b.ad_soyad AS AdSoyad,
       ISNULL(NULLIF(b.ise_giris_bolum, N''), b.bolumler) AS Bolum,
       b.sube_kodu AS SubeKodu, b.sube_adi AS SubeAdi,
       /* Süre dakika cinsinden ölçülür; aynı gün doldurulan pozisyonlar
          sıfır görünmesin diye gün çözünürlüğü kullanılmaz. */
       ISNULL(b.doldurma_dakika,
              ISNULL(NULLIF(b.doldurma_gun, 0) * 1440,
                     DATEDIFF(minute, b.olusturma,
                              ISNULL(b.guncelleme, b.ise_giris_tarihi)))) AS Dakika,
       CASE WHEN b.doldurma_dakika IS NOT NULL OR b.doldurma_gun IS NOT NULL
            THEN N'kadro' ELSE N'basvuru' END AS Olcum,
       b.ise_giris_tarihi AS IseGirisTarihi,
       b.olusturma AS BasvuruTarihi,
       b.guncelleyen AS Kullanici,
       ISNULL(k.ad_soyad, b.guncelleyen) AS KullaniciAdSoyad
FROM KRY_BASVURULAR b
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = b.guncelleyen
WHERE b.durum = N'İşe Alındı'
  AND b.ise_giris_tarihi IS NOT NULL
  AND b.ise_giris_tarihi BETWEEN @bas AND @bit
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY b.ise_giris_tarihi DESC",
            new
            {
                bas = baslangic,
                bit = bitis,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        /* Her kayda bölgesi yazılır */
        foreach (var kayit in kayitlar)
        {
            kayit.Bolge = (ayar.Bolgeler ?? new List<BolgeTanimi>())
                .FirstOrDefault(x => (x.Subeler ?? new List<string>())
                    .Any(k => string.Equals(k, kayit.SubeKodu,
                        StringComparison.OrdinalIgnoreCase)))?.Ad ?? "Bölgesiz";

            // Birden fazla pozisyon yazılıysa ilki esas alınır
            if (!string.IsNullOrWhiteSpace(kayit.Bolum) && kayit.Bolum.Contains(','))
                kayit.Bolum = kayit.Bolum.Split(',')[0].Trim();
        }

        if (!string.IsNullOrWhiteSpace(bolge))
            kayitlar = kayitlar.Where(x => x.Bolge == bolge).ToList();

        // Tarih tutarsızlığından doğan eksi değerler en az bir dakikaya çekilir
        foreach (var kayit in kayitlar)
            if (kayit.Dakika < 1) kayit.Dakika = 1;

        /* Geçmişe dönük kayıtlar ölçümden çıkarılır.

           Norm kadroda eksik başlangıcı bilinmeyen kayıtlarda süre,
           başvurunun açılışından son güncellemeye kadar ölçülüyor. Hâlen
           çalışan biri için sonradan başvuru açılıp anında "İşe Alındı"
           işaretlendiğinde bu süre dakikalarla ifade ediliyor ve gerçek
           bir işe alım süreci değil.

           Bunlar sayılmaya devam eder ama ortalamaya girmez: aksi hâlde
           "1 dakikada işe alım" gibi değerler ortalamayı olduğundan
           kısa gösteriyordu. */
        const int EnAzDakika = 60;

        var gecmiseDonuk = kayitlar
            .Where(x => x.Olcum == "basvuru" && x.Dakika < EnAzDakika)
            .ToList();

        var olculenler = kayitlar.Except(gecmiseDonuk).ToList();

        /* Ölçülebilir kayıt kalmadıysa eleme yapılmaz: boş rapor
           göstermektense kusurlu veriyi göstermek yeğdir. */
        if (olculenler.Count == 0) olculenler = kayitlar;

        kayitlar = olculenler;

        var pozisyonlar = kayitlar
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Bolum) ? "Belirtilmemiş" : x.Bolum)
            .Select(g => new
            {
                bolum = g.Key,
                adet = g.Count(),
                ortalamaDakika = (int)Math.Round(g.Average(x => (double)x.Dakika)),
                enHizli = g.Min(x => x.Dakika),
                enYavas = g.Max(x => x.Dakika),

                /* Bu pozisyonda işe alım yapan uzmanlar; en çok alım yapan
                   başta olacak şekilde sıralanır. */
                uzmanlar = g
                    .Where(x => !string.IsNullOrWhiteSpace(x.KullaniciAdSoyad))
                    .GroupBy(x => x.KullaniciAdSoyad)
                    .Select(u => new { adSoyad = u.Key, adet = u.Count() })
                    .OrderByDescending(u => u.adet)
                    .ToList(),

                kayitlar = g.OrderByDescending(x => x.IseGirisTarihi).ToList()
            })
            .OrderByDescending(x => x.adet)
            .ThenBy(x => x.bolum)
            .ToList();

        var bolgeler = kayitlar
            .GroupBy(x => x.Bolge)
            .Select(g => new
            {
                bolge = g.Key,
                adet = g.Count(),
                ortalamaDakika = (int)Math.Round(g.Average(x => (double)x.Dakika))
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        return Ok(new
        {
            toplam = kayitlar.Count,
            ortalamaDakika = kayitlar.Count > 0
                ? (int)Math.Round(kayitlar.Average(x => (double)x.Dakika))
                : 0,
            enHizli = kayitlar.Count > 0 ? kayitlar.Min(x => x.Dakika) : 0,
            enYavas = kayitlar.Count > 0 ? kayitlar.Max(x => x.Dakika) : 0,
            /* Ölçüme girmeyen geçmişe dönük kayıt sayısı; ekranda
               belirtilir ki toplamdaki fark anlaşılsın. */
            gecmiseDonuk = gecmiseDonuk.Count,
            pozisyonlar,
            bolgeler,
            kadroOlcumu = kayitlar.Count(x => x.Olcum == "kadro"),
            basvuruOlcumu = kayitlar.Count(x => x.Olcum == "basvuru")
        });
    }

    /// <summary>
    /// Olumsuz değerlendirmeler: kim ne kadar olumsuz sonuçlandırmış,
    /// hangi pozisyonlarda yoğunlaşıyor ve gerekçeleri neler.
    /// </summary>
    [HttpGet("Olumsuzlar")]
    public IActionResult Olumsuzlar(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        var ayar = _ayar.FormOku();

        using var db = _vt.Baglanti();

        /* Her başvurunun olumsuz işlemi bir kez alınır; aynı başvuru birkaç
           kez olumsuz yapılmışsa en sonuncusu geçerlidir. */
        var kayitlar = db.Query<OlumsuzKaydi>(@"
SELECT b.id AS Id, b.ad_soyad AS AdSoyad, b.telefon AS Telefon,
       b.sube_kodu AS SubeKodu, b.sube_adi AS SubeAdi, b.bolumler AS Bolumler,
       b.olusturma AS BasvuruTarihi,
       h.tarih AS IslemTarihi, h.aciklama AS Gerekce,
       h.kullanici AS Kullanici,
       ISNULL(k.ad_soyad, h.kullanici) AS KullaniciAdSoyad
FROM KRY_BASVURULAR b
JOIN (
    SELECT basvuru_id, MAX(id) AS sonId
    FROM KRY_BASVURU_HAREKET
    WHERE durum = N'Olumsuz' AND tarih BETWEEN @bas AND @bit
    GROUP BY basvuru_id
) son ON son.basvuru_id = b.id
JOIN KRY_BASVURU_HAREKET h ON h.id = son.sonId
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = h.kullanici
WHERE (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY h.tarih DESC",
            new
            {
                bas = baslangic,
                bit = bitis,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        foreach (var kayit in kayitlar)
        {
            kayit.Bolge = (ayar.Bolgeler ?? new List<BolgeTanimi>())
                .FirstOrDefault(x => (x.Subeler ?? new List<string>())
                    .Any(k => string.Equals(k, kayit.SubeKodu,
                        StringComparison.OrdinalIgnoreCase)))?.Ad ?? "Bölgesiz";

            if (!string.IsNullOrWhiteSpace(kayit.Bolumler) && kayit.Bolumler.Contains(','))
                kayit.Bolum = kayit.Bolumler.Split(',')[0].Trim();
            else
                kayit.Bolum = kayit.Bolumler;
        }

        foreach (var kayit in kayitlar)
            kayit.NedenGrubu = OlumsuzNedeni.Grupla(kayit.Gerekce);

        /* Gerekçeler serbest metin; anahtar kelimelerle gruplanır ki "en sık
           olumsuz sebebi" sorusu cevaplanabilsin. Metnin kendisi kayıtta durur. */
        var nedenler = kayitlar
            .GroupBy(x => x.NedenGrubu)
            .Select(g => new { neden = g.Key, adet = g.Count() })
            .OrderByDescending(x => x.adet)
            .ToList();

        var uzmanlar = kayitlar
            .GroupBy(x => string.IsNullOrWhiteSpace(x.KullaniciAdSoyad)
                ? "Belirtilmemiş"
                : x.KullaniciAdSoyad)
            .Select(g => new
            {
                adSoyad = g.Key,
                adet = g.Count(),
                pozisyonlar = g
                    .GroupBy(x => string.IsNullOrWhiteSpace(x.Bolum) ? "Belirtilmemiş" : x.Bolum)
                    .Select(b => new { bolum = b.Key, adet = b.Count() })
                    .OrderByDescending(b => b.adet)
                    .Take(3)
                    .ToList(),
                kayitlar = g.OrderByDescending(x => x.IslemTarihi).ToList()
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        var pozisyonlar = kayitlar
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Bolum) ? "Belirtilmemiş" : x.Bolum)
            .Select(g => new { bolum = g.Key, adet = g.Count() })
            .OrderByDescending(x => x.adet)
            .ToList();

        return Ok(new
        {
            toplam = kayitlar.Count,
            uzmanlar,
            pozisyonlar,
            nedenler,
            kayitlar
        });
    }

    /// <summary>
    /// Başvurulara eklenen tüm dahili notlar. Yalnızca yöneticiler görebilir.
    /// </summary>
    [HttpGet("Notlar")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult Notlar(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string kullanici = null,
        [FromQuery] string bolge = null,
        [FromQuery] string durum = null,
        [FromQuery] string arama = null)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        var bolgeSubeleri = string.IsNullOrWhiteSpace(bolge)
            ? Array.Empty<string>()
            : KullaniciController.BolgeSubeleri(bolge, _ayar.FormOku());

        using var db = _vt.Baglanti();

        var notlar = db.Query<NotKaydi>(@"
SELECT
    n.id            AS Id,
    n.basvuru_id    AS BasvuruId,
    b.basvuru_no    AS BasvuruNo,
    b.ad_soyad      AS AdaySoyad,
    b.telefon       AS Telefon,
    b.sube_kodu     AS SubeKodu,
    b.sube_adi      AS SubeAdi,
    b.bolumler      AS Bolumler,
    b.durum         AS Durum,
    n.metin         AS Metin,
    n.kullanici     AS Kullanici,
    ISNULL(n.ad_soyad, k.ad_soyad) AS YazanAdSoyad,
    ISNULL(k.unvan, N'')           AS YazanUnvan,
    ISNULL(k.rol, N'')             AS YazanRol,
    n.tarih         AS Tarih
FROM KRY_BASVURU_NOT n
JOIN KRY_BASVURULAR b ON b.id = n.basvuru_id
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = n.kullanici
WHERE n.tarih BETWEEN @bas AND @bit
  AND (@kullanici IS NULL OR n.kullanici = @kullanici)
  AND (@durum IS NULL OR b.durum = @durum)
  AND (@bolgeVar = 0 OR b.sube_kodu IN @bolgeSubeleri)
  AND (@arama IS NULL OR n.metin LIKE @kalip OR b.ad_soyad LIKE @kalip
       OR b.basvuru_no LIKE @kalip)
ORDER BY n.tarih DESC",
            new
            {
                bas = baslangic,
                bit = bitis,
                kullanici = string.IsNullOrWhiteSpace(kullanici) ? null : kullanici,
                durum = string.IsNullOrWhiteSpace(durum) ? null : durum,
                arama = string.IsNullOrWhiteSpace(arama) ? null : arama,
                kalip = $"%{arama}%",
                bolgeVar = bolgeSubeleri.Length > 0 ? 1 : 0,
                bolgeSubeleri = bolgeSubeleri.Length > 0
                    ? bolgeSubeleri
                    : new[] { "__YOK__" }
            }).ToList();

        /* Not yazan kullanıcılar (filtre kutusu için) */
        var yazanlar = notlar
            .GroupBy(x => x.Kullanici)
            .Select(g => new
            {
                kullanici = g.Key,
                adSoyad = g.First().YazanAdSoyad ?? g.Key,
                adet = g.Count()
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.Date,
            toplam = notlar.Count,
            yazanlar,
            notlar
        });
    }

    /// <summary>
    /// İK uzmanlarının performansı. Yalnızca yöneticiler görebilir.
    /// Ölçüm, işlem geçmişindeki kayıtlara dayanır.
    /// </summary>
    /// <summary>
    /// Tek bir uzmanın dönem içindeki işlemleri: hangi adaya ne yapmış,
    /// ücret pazarlığı nasıl sonuçlanmış.
    ///
    /// Listede yalnızca o uzmanın işlemleri döner; başkalarının aynı
    /// başvuruya yaptığı işlemler karışmaz.
    /// </summary>
    /// <summary>
    /// Bölge eşleştirmesi tanısı: hangi şube kodu hangi bölgeye düşüyor,
    /// düşmüyorsa ayarda ne yazıyor. "Bölgesiz" kartının sebebini
    /// tahmin etmek yerine görmek için.
    /// </summary>
    [HttpGet("BolgeTanisi")]
    public IActionResult BolgeTanisi()
    {
        using var db = _vt.Baglanti();

        var ayar = _ayar.FormOku();

        var subeler = (ayar.Subeler ?? new List<Sube>())
            .Select(x => new { kod = x.Kod, ad = x.Ad })
            .ToList();

        var bolgeler = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Select(x => new { ad = x.Ad, subeler = x.Subeler })
            .ToList();

        /* Başvurularda geçen şube kodları ve adları */
        var basvurular = db.Query(@"
SELECT TOP 60 sube_kodu AS kod, MAX(sube_adi) AS ad, COUNT(*) AS adet
FROM KRY_BASVURULAR
WHERE sube_kodu IS NOT NULL
GROUP BY sube_kodu
ORDER BY COUNT(*) DESC").ToList();

        return Ok(new
        {
            ayardakiSubeler = subeler,
            ayardakiBolgeler = bolgeler,
            basvurudakiSubeKodlari = basvurular
        });
    }

    /// <summary>
    /// İK Performans ekranındaki kutu, huni ve bölge satırlarından açılan
    /// başvuru listesi. Sayılar hareket (işlem) geçmişine göre hesaplandığı
    /// için liste de aynı ölçütle alınır: aralıkta ilgili durumda işlem
    /// görmüş başvurular. Böylece kutudaki sayı ile açılan liste tutar.
    /// </summary>
    /// <param name="asama">ilgilenilen · inceleme · gorusme · olumlu · iseAlinan · olumsuz · eskiCalisan</param>
    [HttpGet("PerformansListe")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
                     + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult PerformansListe(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string asama = "ilgilenilen",
        [FromQuery] string bolge = null,
        [FromQuery] string kullanici = null)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        /* Hareketteki durum adı; sonuç durumlarında güncel durum da aynı
           olmalı (sonradan geri alınanlar sayılmıyor) */
        var (hareketDurumu, guncelDe) = (asama ?? "").ToLowerInvariant() switch
        {
            "inceleme" => ("İncelendi", false),
            "gorusme" => ("Görüşme Talebi", false),
            "olumlu" => ("Olumlu", false),
            "isealinan" or "eskicalisan" => ("İşe Alındı", true),
            "olumsuz" => ("Olumsuz", true),
            _ => (null, false)
        };

        var kullanicilar = (kullanici ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT b.id, b.basvuru_no AS basvuruNo, b.ad_soyad AS adSoyad, b.kimlik_no AS kimlikNo,
       b.telefon, b.sube_kodu AS subeKodu, b.sube_adi AS subeAdi, b.bolumler,
       b.durum, JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS talepUcret,
       b.anlasilan_ucret AS anlasilanUcret, b.ise_giris_tarihi AS iseGirisTarihi,
       b.olusturma, b.guncelleme, b.guncelleyen,
       (SELECT CAST(DATEDIFF(minute, b.olusturma, MIN(t.tarih)) AS FLOAT) / 60.0
        FROM KRY_BASVURU_HAREKET t
        WHERE t.basvuru_id = b.id AND t.kullanici NOT IN (N'aday', N'sistem', N'test')
          AND t.tarih >= b.olusturma) AS tepkiSaat
FROM KRY_BASVURULAR b
WHERE EXISTS (
        SELECT 1 FROM KRY_BASVURU_HAREKET h
        WHERE h.basvuru_id = b.id
          AND h.tarih BETWEEN @bas AND @bit
          AND h.kullanici NOT IN (N'aday', N'sistem', N'test')
          AND (@durum IS NULL OR h.durum = @durum)
          AND (@kullaniciVar = 0 OR h.kullanici IN @kullanicilar))
  AND (@guncel = 0 OR b.durum = @durum)
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY b.olusturma DESC",
            new
            {
                bas = baslangic,
                bit = bitis,
                durum = hareketDurumu,
                guncel = guncelDe ? 1 : 0,
                kullaniciVar = kullanicilar.Length > 0 ? 1 : 0,
                kullanicilar = kullanicilar.Length > 0 ? kullanicilar : new[] { "__YOK__" },
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }, commandTimeout: 120).ToList();

        /* Bölge: şube kodu ayardaki bölge listesinde aranır (kod ya da ad) */
        if (!string.IsNullOrWhiteSpace(bolge))
        {
            var ayar = _ayar.FormOku();
            var adlar = (ayar.Subeler ?? new List<Sube>())
                .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
                .GroupBy(x => x.Kod.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => (g.First().Ad ?? "").Trim(), StringComparer.OrdinalIgnoreCase);

            string BolgeBul(string kod)
            {
                kod = (kod ?? "").Trim();
                if (kod.Length == 0) return "Bölgesiz";
                var ad = adlar.GetValueOrDefault(kod, "");

                foreach (var b in ayar.Bolgeler ?? new List<BolgeTanimi>())
                    foreach (var k in b.Subeler ?? new List<string>())
                    {
                        var d = (k ?? "").Trim();
                        if (d.Length == 0) continue;
                        if (string.Equals(d, kod, StringComparison.OrdinalIgnoreCase)
                            || (ad.Length > 0 && string.Equals(d, ad, StringComparison.OrdinalIgnoreCase)))
                            return b.Ad;
                    }

                return "Bölgesiz";
            }

            satirlar = satirlar.Where(x => BolgeBul((string)x.subeKodu) == bolge).ToList();
        }

        /* Eski çalışan: kimlik numarası Mikro'daki ayrılmış personelde varsa */
        if ((asama ?? "").Equals("eskiCalisan", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                using var mikro = _vt.PersonelBaglantisi();

                var eskiler = mikro.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(Per_TcKimlikNo)) FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE per_cikis_tar IS NOT NULL AND YEAR(per_cikis_tar) > 1950
  AND LEN(LTRIM(RTRIM(Per_TcKimlikNo))) = 11", commandTimeout: 60)
                    .ToHashSet();

                satirlar = satirlar.Where(x => eskiler.Contains(((string)x.kimlikNo ?? "").Trim())).ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Eski çalışan eşleştirmesi yapılamadı");
            }
        }

        return Ok(satirlar.Select(x => new
        {
            id = (int)x.id,
            basvuruNo = (string)x.basvuruNo,
            adSoyad = (string)x.adSoyad,
            telefon = (string)x.telefon,
            subeAdi = (string)x.subeAdi,
            bolumler = (string)x.bolumler,
            durum = (string)x.durum,
            talepUcret = (string)x.talepUcret,
            anlasilanUcret = (decimal?)x.anlasilanUcret,
            iseGirisTarihi = (DateTime?)x.iseGirisTarihi,
            olusturma = (DateTime)x.olusturma,
            guncelleme = (DateTime?)x.guncelleme,
            guncelleyen = (string)x.guncelleyen,
            tepkiSaat = x.tepkiSaat is null ? (double?)null : Math.Round((double)x.tepkiSaat, 1)
        }));
    }

    [HttpGet("Performans/{kullanici}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi
                     + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult PerformansDetay(
        string kullanici,
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit)
    {
        if (string.IsNullOrWhiteSpace(kullanici))
            return BadRequest(new { hata = "Uzman seçiniz." });

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-30);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        var islemler = db.Query(@"
SELECT h.tarih          AS tarih,
       h.durum          AS durum,
       h.aciklama       AS aciklama,
       b.id             AS basvuruId,
       b.basvuru_no     AS basvuruNo,
       b.ad_soyad       AS adSoyad,
       b.sube_adi       AS subeAdi,
       b.bolumler       AS bolumler,
       b.durum          AS sonDurum,
       b.anlasilan_ucret AS anlasilanUcret,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS talepUcret
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
WHERE h.kullanici = @kullanici
  AND h.tarih BETWEEN @bas AND @bit
ORDER BY h.tarih DESC",
            new { kullanici, bas = baslangic, bit = bitis }).ToList();

        /* Ücret pazarlığı: adayın talebi ile anlaşılan tutar. Yalnızca
           ikisi de dolu olan kayıtlar alınır; biri eksikse karşılaştırma
           anlamsız olur. */
        var pazarliklar = db.Query(@"
SELECT DISTINCT
       b.id              AS basvuruId,
       b.ad_soyad        AS adSoyad,
       b.sube_adi        AS subeAdi,
       b.anlasilan_ucret AS anlasilan,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS talep,
       b.ise_giris_tarihi AS girisTarihi
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
WHERE h.kullanici = @kullanici
  AND h.tarih BETWEEN @bas AND @bit
  AND b.anlasilan_ucret IS NOT NULL AND b.anlasilan_ucret > 0
ORDER BY b.ise_giris_tarihi DESC",
            new { kullanici, bas = baslangic, bit = bitis }).ToList();

        /* Talep serbest metin ("45.000 ₺", "35 bin"); sayıya çevrilmiş hâli
           ayrıca döner ki ekranda fark hesaplanabilsin. */
        var pazarlikSatirlari = pazarliklar.Select(x => new
        {
            basvuruId = (int)x.basvuruId,
            adSoyad = (string)x.adSoyad,
            subeAdi = (string)x.subeAdi,
            anlasilan = (decimal?)x.anlasilan,
            talepMetin = (string)x.talep,
            talep = UcretMetni.Coz((string)x.talep),
            girisTarihi = (DateTime?)x.girisTarihi
        }).ToList();

        return Ok(new { islemler, pazarliklar = pazarlikSatirlari });
    }

    [HttpGet("Performans")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult Performans([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        /* Yalnızca aktif İK uzmanı ve İK yöneticisi değerlendirilir (panelden
           açılan ve bu rolleri temel alan özel roller dahil). Admin, GMY ve
           ayrılmış (pasif) kullanıcılar ne listede yer alır ne de özet
           sayılara ve genel tepki süresine katılır. */
        var ikRolleri = Roller.Tumu
            .Where(r => Roller.Temel(r) is Roller.IK or Roller.IKYoneticisi)
            .Distinct()
            .ToArray();
        var p = new { bas = baslangic, bit = bitis, roller = ikRolleri };

        var satirlar = db.Query<PerformansSatiri>(@"
SELECT
    k.kullanici_adi                   AS KullaniciAdi,
    k.ad_soyad                        AS AdSoyad,
    ISNULL(k.unvan, N'')              AS Unvan,
    ISNULL(k.bolge, N'Belirtilmemiş') AS Bolge,
    /* Aynı başvuruya birden çok kez aynı işlem yapılsa da bir kez sayılır;
       böylece sayılar gerçek başvuru adedini gösterir. */
    COUNT(DISTINCT h.basvuru_id)      AS Islem,
    COUNT(DISTINCT CASE WHEN h.durum = N'İncelendi'          THEN h.basvuru_id END) AS Inceleme,
    COUNT(DISTINCT CASE WHEN h.durum = N'Değerlendirmede'    THEN h.basvuru_id END) AS Degerlendirme,
    COUNT(DISTINCT CASE WHEN h.durum = N'Görüşme Talebi'     THEN h.basvuru_id END) AS Gorusme,
    COUNT(DISTINCT CASE WHEN h.durum = N'Olumlu'             THEN h.basvuru_id END) AS Olumlu,
    COUNT(DISTINCT CASE WHEN h.durum = N'Evrak Hazırlanıyor' THEN h.basvuru_id END) AS EvrakHazirlaniyor,
    /* Sonuc durumlarinda basvurunun GUNCEL durumu da aranir. Yalnizca
       islem gecmisine bakildiginda sonradan geri alinan kayitlar da
       sayiliyordu; Basvurular sayfasi guncel duruma baktigi icin iki
       ekran farkli sayi gosteriyordu. */
    COUNT(DISTINCT CASE WHEN h.durum = N'İşe Alındı' AND b.durum = N'İşe Alındı'
                        THEN h.basvuru_id END) AS IseAlinan,
    COUNT(DISTINCT CASE WHEN h.durum = N'Olumsuz' AND b.durum = N'Olumsuz'
                        THEN h.basvuru_id END) AS Olumsuz,
    COUNT(DISTINCT CASE WHEN h.aciklama LIKE N'Birim değişikliği%'
                        THEN h.basvuru_id END) AS Rotasyon,
    COUNT(DISTINCT h.basvuru_id)      AS IlgilenilenBasvuru,
    COUNT(DISTINCT b.sube_kodu)       AS BirimSayisi,
    MAX(h.tarih)                      AS SonIslem,
    0 AS [Not], 0 AS OrtalamaTepkiSaat, 0 AS OrtalamaTepkiGun,
    0 AS EnHizliSaat, 0 AS EnYavasSaat, 0 AS Sonuclanan
FROM KRY_KULLANICILAR k
LEFT JOIN KRY_BASVURU_HAREKET h
       ON h.kullanici = k.kullanici_adi
      AND h.tarih BETWEEN @bas AND @bit
LEFT JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
/* 1 numaralı kullanıcı sistem yöneticisidir; başvuru işlemlerini
   uzman olarak değil bakım amaçlı yapar ve listede yer alması
   uzmanların karşılaştırmasını bozar. */
WHERE k.rol IN @roller AND k.aktif = 1 AND k.id <> 1
GROUP BY k.kullanici_adi, k.ad_soyad, k.unvan, k.bolge
ORDER BY COUNT(DISTINCT h.basvuru_id) DESC", p).ToList();

        /* Sonuçlandırılan başvurular: aynı başvuruya birden çok son durum
           işlemi yapılabildiği için benzersiz başvuru sayısı alınır.
           (Örneğin önce "Olumlu", sonra "İşe Alındı" yapılan bir başvuru
           iki kez değil bir kez sayılır.) */
        var sonuclananlar = db.Query(@"
SELECT kullanici AS Kullanici, COUNT(DISTINCT basvuru_id) AS Adet
FROM KRY_BASVURU_HAREKET
WHERE tarih BETWEEN @bas AND @bit
  AND durum IN (N'Olumlu', N'İşe Alındı', N'Olumsuz')
GROUP BY kullanici", p).ToList();

        /* Açılan pozisyonların ortalama doldurulma süresi (gün) */
        var doldurmalar = db.Query(@"
SELECT guncelleyen AS Kullanici,
       AVG(CAST(ISNULL(doldurma_dakika, doldurma_gun * 1440) AS FLOAT)) AS Dakika,
       COUNT(*) AS Adet
FROM KRY_BASVURULAR
WHERE durum = N'İşe Alındı'
  AND (doldurma_dakika IS NOT NULL OR doldurma_gun IS NOT NULL)
  AND ise_giris_tarihi BETWEEN @bas AND @bit
GROUP BY guncelleyen", p).ToList();

        /* Ücret pazarlığı: adayın talebi ile anlaşılan ücret karşılaştırılır.
           Negatif fark, uzmanın talebin altında anlaşabildiğini gösterir. */
        /* Talep edilen ücret formdan serbest metin olarak geliyor: "45.000 ₺",
           "45,000", "40-45 bin" gibi. SQL'de FLOAT'a çevirmek
           "Error converting data type nvarchar to float" hatası veriyordu
           (ISNUMERIC süzgeci CAST'ten önce çalışmayı garanti etmiyor,
           "45,000" gibi değerleri de sayı sayıyor). Değer C#'ta çözülüyor. */
        var ucretHam = db.Query(@"
SELECT guncelleyen AS Kullanici,
       JSON_VALUE(veri_json, '$.talepEdilenNetUcret') AS TalepMetin,
       anlasilan_ucret AS Anlasilan
FROM KRY_BASVURULAR
WHERE durum = N'İşe Alındı'
  AND anlasilan_ucret > 0
  AND ise_giris_tarihi BETWEEN @bas AND @bit", p).ToList();

        var ucretler = ucretHam
            .Select(x => new
            {
                Kullanici = (string)x.Kullanici,
                Talep = UcretMetni.Coz((string)x.TalepMetin),
                Anlasilan = (decimal?)x.Anlasilan
            })
            .Where(x => x.Talep > 0 && x.Anlasilan > 0)
            .GroupBy(x => x.Kullanici ?? "")
            .Select(g => new
            {
                Kullanici = g.Key,
                Talep = (double?)g.Average(x => (double)x.Talep.Value),
                Anlasilan = (double?)g.Average(x => (double)x.Anlasilan.Value),
                Adet = g.Count()
            })
            .ToList();

        /* Eski çalışan alımı: işe alınanlardan daha önce şirkette çalışmış
           olanlar. Kimlik numarası Mikro personel kayıtlarıyla eşleştirilir. */
        var eskiAlimlar = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var alimlar = db.Query(@"
SELECT guncelleyen AS Kullanici, kimlik_no AS KimlikNo
FROM KRY_BASVURULAR
WHERE durum = N'İşe Alındı'
  AND kimlik_no IS NOT NULL AND LTRIM(RTRIM(kimlik_no)) <> ''
  AND ise_giris_tarihi BETWEEN @bas AND @bit", p).ToList();

            if (alimlar.Count > 0)
            {
                using var pdb = _vt.PersonelBaglantisi();

                /* Daha önce çıkışı olan kimlik numaraları */
                var eskiler = pdb.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(Per_TcKimlikNo))
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE Per_TcKimlikNo IS NOT NULL
  AND per_cikis_tar IS NOT NULL
  AND YEAR(per_cikis_tar) > 1950").ToList();

                var eskiKume = new HashSet<string>(
                    eskiler.Where(x => !string.IsNullOrWhiteSpace(x)),
                    StringComparer.OrdinalIgnoreCase);

                foreach (var alim in alimlar)
                {
                    var kullanici = (string)alim.Kullanici;
                    var kimlik = ((string)alim.KimlikNo)?.Trim() ?? "";

                    if (string.IsNullOrWhiteSpace(kullanici)) continue;
                    if (!eskiKume.Contains(kimlik)) continue;

                    eskiAlimlar.TryGetValue(kullanici, out var adet);
                    eskiAlimlar[kullanici] = adet + 1;
                }
            }
        }
        catch
        {
            // Personel veritabanına ulaşılamazsa diğer sayılar yine gösterilir
        }

        /* Not sayıları */
        var notlar = db.Query(@"
SELECT kullanici AS kullanici, COUNT(DISTINCT basvuru_id) AS adet
FROM KRY_BASVURU_NOT
WHERE tarih BETWEEN @bas AND @bit
GROUP BY kullanici", p).ToList();

        /* Ortalama tepki süresi: başvurunun gelişinden ilk işleme kadar.

           Yalnızca SEÇİLEN ARALIKTA GELEN başvurular sayılır. Önceden
           aralıktaki her işlem alınıyordu; üç ay önce gelmiş bir başvuruya
           bugün dokunulduğunda tepki süresi doksan gün çıkıyor ve
           ortalamayı anlamsız kılıyordu.

           Ayrıca ilk işlem, o başvuruya dokunan ilk kişinin işlemidir;
           sonradan devralan uzmana önceki gecikme yazılmaz. */
        var tepki = db.Query(@"
SELECT i.kullanici AS Kullanici,
       AVG(CAST(DATEDIFF(minute, b.olusturma, i.ilkTarih) AS FLOAT)) / 60.0 AS Saat,
       MIN(CAST(DATEDIFF(minute, b.olusturma, i.ilkTarih) AS FLOAT)) / 60.0 AS EnHizli,
       MAX(CAST(DATEDIFF(minute, b.olusturma, i.ilkTarih) AS FLOAT)) / 60.0 AS EnYavas
FROM (
    SELECT h.basvuru_id, h.kullanici, MIN(h.tarih) AS ilkTarih
    FROM KRY_BASVURU_HAREKET h
    WHERE h.kullanici NOT IN (N'aday', N'sistem', N'test')
      /* Başvuruya ilk dokunan kişi */
      AND h.tarih = (
          SELECT MIN(x.tarih) FROM KRY_BASVURU_HAREKET x
          WHERE x.basvuru_id = h.basvuru_id
            AND x.kullanici NOT IN (N'aday', N'sistem', N'test'))
    GROUP BY h.basvuru_id, h.kullanici
) i
JOIN KRY_BASVURULAR b ON b.id = i.basvuru_id
WHERE i.ilkTarih >= b.olusturma
  AND b.olusturma BETWEEN @bas AND @bit
GROUP BY i.kullanici", p).ToList();

        foreach (var satir in satirlar)
        {
            var n = notlar.FirstOrDefault(x =>
                string.Equals((string)x.kullanici, satir.KullaniciAdi,
                    StringComparison.OrdinalIgnoreCase));
            if (n is not null) satir.Not = (int)n.adet;

            var t = tepki.FirstOrDefault(x =>
                string.Equals((string)x.Kullanici, satir.KullaniciAdi,
                    StringComparison.OrdinalIgnoreCase));

            if (t is not null && t.Saat is not null)
            {
                satir.OrtalamaTepkiSaat = Math.Round((double)t.Saat, 1);
                satir.OrtalamaTepkiGun = Math.Round((double)t.Saat / 24.0, 2);
                satir.EnHizliSaat = Math.Round((double)(t.EnHizli ?? 0), 1);
                satir.EnYavasSaat = Math.Round((double)(t.EnYavas ?? 0), 1);
            }

            var sc = sonuclananlar.FirstOrDefault(x =>
                string.Equals((string)x.Kullanici, satir.KullaniciAdi,
                    StringComparison.OrdinalIgnoreCase));

            satir.Sonuclanan = sc is null ? 0 : (int)sc.Adet;

            var d = doldurmalar.FirstOrDefault(x =>
                string.Equals((string)x.Kullanici, satir.KullaniciAdi,
                    StringComparison.OrdinalIgnoreCase));

            if (d is not null && d.Dakika is not null)
                satir.OrtalamaDoldurmaDakika = (int)Math.Round((double)d.Dakika);

            if (eskiAlimlar.TryGetValue(satir.KullaniciAdi ?? "", out var eskiAdet))
                satir.EskiCalisanAlimi = eskiAdet;

            var u = ucretler.FirstOrDefault(x => x.Kullanici == satir.KullaniciAdi);

            if (u is not null && u.Talep is not null && u.Anlasilan is not null)
            {
                satir.OrtalamaTalep = (decimal)Math.Round((double)u.Talep, 0);
                satir.OrtalamaAnlasilan = (decimal)Math.Round((double)u.Anlasilan, 0);
                satir.UcretliAlim = (int)u.Adet;
            }
        }

        /* Bölge sayıları başvurunun MAĞAZASINA göre hesaplanır.

           Önceki yöntem uzmanların toplam işlemlerini bölgelere dağıtıyordu:
           bir uzman iki bölgeden sorumluysa bütün işleri her iki bölgeye de
           yazılıyor, iki kart birebir aynı sayıları gösteriyordu. Oysa
           sorulan şey "bu bölgedeki mağazalara gelen başvurularda ne
           yapıldı" — bu da başvurunun şubesinden çıkar. */
        var ayarBolge = _ayar.FormOku();

        var bolgeHam = db.Query(@"
SELECT b.sube_kodu                AS subeKodu,
       h.basvuru_id               AS basvuruId,
       h.durum                    AS durum,
       b.durum                    AS guncelDurum,
       h.kullanici                AS kullanici,
       ISNULL(u.ad_soyad, h.kullanici) AS adSoyad
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
LEFT JOIN KRY_KULLANICILAR u ON u.kullanici_adi = h.kullanici
WHERE h.tarih BETWEEN @bas AND @bit
  /* Sistem kullanıcıları uzman değildir: 'aday' adayın kendi
     gönderimidir, 'sistem' ve 'test' otomatik işlemlerdir. */
  AND h.kullanici NOT IN (N'aday', N'sistem', N'test')", p).ToList();

        /* Şube kodundan bölge adı bulunur */
        /* Şube kodu ile bölge ayarındaki değerler birebir eşleşmeyebiliyor:
           başında sonunda boşluk, farklı büyük-küçük harf ya da ayarın
           kod yerine ad tutması. Üçü de denenir; yoksa "Bölgesiz". */
        var subeAdCoz = (ayarBolge.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .GroupBy(x => x.Kod.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => (g.First().Ad ?? "").Trim(),
                          StringComparer.OrdinalIgnoreCase);

        string BolgeBul(string subeKodu)
        {
            var kod = (subeKodu ?? "").Trim();

            if (kod.Length == 0) return "Bölgesiz";

            var ad = subeAdCoz.GetValueOrDefault(kod, "");

            foreach (var b in ayarBolge.Bolgeler ?? new List<BolgeTanimi>())
            {
                foreach (var k in b.Subeler ?? new List<string>())
                {
                    var deger = (k ?? "").Trim();

                    if (deger.Length == 0) continue;

                    if (string.Equals(deger, kod, StringComparison.OrdinalIgnoreCase))
                        return b.Ad;

                    /* Ayar ada göre tutulmuşsa */
                    if (ad.Length > 0 &&
                        string.Equals(deger, ad, StringComparison.OrdinalIgnoreCase))
                        return b.Ad;
                }
            }

            return "Bölgesiz";
        }

        /* Bölgesiz kalan şubeler ayrıca döner: kullanıcı hangi şubenin
           atanmadığını görmeden düzeltemiyordu. */
        /* Şube adı gösterilir: kod tek başına anlaşılmıyor. Ad ayardan
           bulunamazsa kodun kendisi yazılır. */
        var subeAdlari = (ayarBolge.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .GroupBy(x => x.Kod, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Ad,
                          StringComparer.OrdinalIgnoreCase);

        var bolgesizSubeler = bolgeHam
            .Select(x => (string)x.subeKodu)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Where(x => BolgeBul(x) == "Bölgesiz")
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(kod => new
            {
                kod,
                ad = subeAdlari.GetValueOrDefault(kod, kod),

                /* Kaç başvuru etkileniyor: önceliklendirmeye yarar */
                basvuru = bolgeHam
                    .Where(x => string.Equals((string)x.subeKodu, kod,
                                StringComparison.OrdinalIgnoreCase))
                    .Select(x => (int)x.basvuruId)
                    .Distinct()
                    .Count()
            })
            .OrderByDescending(x => x.basvuru)
            .ToList();

        var bolgeler = bolgeHam
            .Select(x => new
            {
                bolge = BolgeBul((string)x.subeKodu),
                basvuruId = (int)x.basvuruId,
                durum = (string)x.durum,
                guncelDurum = (string)x.guncelDurum,
                adSoyad = (string)x.adSoyad
            })
            .GroupBy(x => x.bolge)
            .Select(g => new
            {
                bolge = g.Key,

                /* Bu bölgenin mağazalarında işlem yapan uzmanlar */
                uzmanlar = g.Select(x => x.adSoyad)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct()
                    .OrderBy(x => x)
                    .ToList(),

                uzman = g.Select(x => x.adSoyad)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct()
                    .Count(),

                islem = g.Select(x => x.basvuruId).Distinct().Count(),

                inceleme = g.Where(x => x.durum == "İncelendi")
                    .Select(x => x.basvuruId).Distinct().Count(),

                gorusme = g.Where(x => x.durum == "Görüşme Talebi")
                    .Select(x => x.basvuruId).Distinct().Count(),

                olumlu = g.Where(x => x.durum == "Olumlu")
                    .Select(x => x.basvuruId).Distinct().Count(),

                /* Sonuç durumları güncel duruma da bakar; sonradan geri
                   alınan kayıtlar sayılmasın. */
                iseAlinan = g.Where(x => x.durum == "İşe Alındı"
                                      && x.guncelDurum == "İşe Alındı")
                    .Select(x => x.basvuruId).Distinct().Count(),

                olumsuz = g.Where(x => x.durum == "Olumsuz"
                                    && x.guncelDurum == "Olumsuz")
                    .Select(x => x.basvuruId).Distinct().Count()
            })
            .OrderByDescending(x => x.islem)
            .ToList();

        /* İK uzmanlarının yazdığı notların kendisi. Sayı tek başına
           yeterli değil: hangi adaya ne yazıldığını görmeden değerlendirme
           kalitesi ölçülemez. Uzman başına en son 20 not döner. */
        var notMetinleri = db.Query(@"
SELECT * FROM (
    SELECT n.kullanici                AS kullanici,
           ISNULL(n.ad_soyad, n.kullanici) AS yazan,
           n.tarih                    AS tarih,
           n.metin                    AS metin,
           b.id                       AS basvuruId,
           b.ad_soyad                 AS aday,
           b.sube_adi                 AS subeAdi,
           b.durum                    AS durum,
           ROW_NUMBER() OVER (PARTITION BY n.kullanici ORDER BY n.tarih DESC) AS sira
    FROM KRY_BASVURU_NOT n
    LEFT JOIN KRY_BASVURULAR b ON b.id = n.basvuru_id
    WHERE n.tarih BETWEEN @bas AND @bit
) t
WHERE t.sira <= 20
ORDER BY t.tarih DESC", p).ToList();

        /* Özet sayılar tek sorgudan gelir. Uzmanların satırlarını toplamak
           yanlış sonuç veriyordu: aynı başvuruya üç uzman dokunduysa
           toplamda üç kez sayılıyor ve sistemdeki başvuru sayısını
           aşıyordu. Burada başvuru bazında benzersiz sayılır. */
        var ozet = db.QueryFirstOrDefault(@"
SELECT
    COUNT(DISTINCT h.basvuru_id) AS ilgilenilen,

    COUNT(DISTINCT CASE WHEN h.durum = N'İncelendi'
                        THEN h.basvuru_id END) AS inceleme,

    COUNT(DISTINCT CASE WHEN h.durum = N'Görüşme Talebi'
                        THEN h.basvuru_id END) AS gorusme,

    COUNT(DISTINCT CASE WHEN h.durum = N'Olumlu'
                        THEN h.basvuru_id END) AS olumlu,

    COUNT(DISTINCT CASE WHEN h.durum = N'İşe Alındı' AND b.durum = N'İşe Alındı'
                        THEN h.basvuru_id END) AS iseAlinan,

    COUNT(DISTINCT CASE WHEN h.durum = N'Olumsuz' AND b.durum = N'Olumsuz'
                        THEN h.basvuru_id END) AS olumsuz
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
WHERE h.tarih BETWEEN @bas AND @bit
  AND h.kullanici NOT IN (N'aday', N'sistem', N'test')
  AND h.kullanici IN (SELECT kullanici_adi FROM KRY_KULLANICILAR
                      WHERE rol IN @roller AND aktif = 1 AND id <> 1)", p);

        /* Ortalama tepki: kişi başına değil, aralıkta gelen tüm
           başvurular üzerinden tek bir değer. */
        var genelTepki = db.ExecuteScalar<double?>(@"
SELECT AVG(CAST(DATEDIFF(minute, b.olusturma, i.ilkTarih) AS FLOAT)) / 60.0
FROM (
    SELECT basvuru_id, MIN(tarih) AS ilkTarih
    FROM KRY_BASVURU_HAREKET
    WHERE kullanici NOT IN (N'aday', N'sistem', N'test')
      AND kullanici IN (SELECT kullanici_adi FROM KRY_KULLANICILAR
                        WHERE rol IN @roller AND aktif = 1 AND id <> 1)
    GROUP BY basvuru_id
) i
JOIN KRY_BASVURULAR b ON b.id = i.basvuru_id
WHERE i.ilkTarih >= b.olusturma
  AND b.olusturma BETWEEN @bas AND @bit", p);

        return Ok(new
        {
            baslangic,
            bitis = bitis.Date,
            uzmanlar = satirlar,
            notlar = notMetinleri,
            bolgeler,
            bolgesizSubeler,
            ozet,
            genelTepkiSaat = genelTepki is null
                ? 0 : Math.Round(genelTepki.Value, 1)
        });
    }

    [HttpGet]
    public IActionResult Rapor(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string birimTuru = null)
    {
        // Varsayılan aralık: son 12 ay
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-11).AddDays(1 - DateTime.Today.Day);
        var bitisGunu = (bit?.Date ?? DateTime.Today);

        /* Bitiş günü dahil, ertesi günün başına kadar (Başvurular sayfasıyla
           aynı sınır). 23:59:59 sınırı son saniyedeki kayıtları düşürüyordu. */
        var bitisSonrasi = bitisGunu.AddDays(1);

        var tur = string.IsNullOrWhiteSpace(birimTuru) || birimTuru == "Tümü"
            ? null
            : birimTuru;

        /* Şube yetkisi KOD kümesiyle uygulanır. Bölge tanımında adla yazılmış
           şubeler sube_kodu ile karşılaştırılınca hiçbir kayda denk
           gelmiyordu; Norm Kadro ve Şube Raporu da YetkiliKodlar kullanıyor. */
        var yetkiliKodlar = SubeSuzmesi ? YetkiliKodlar() : null;
        var yetkiliDizi = yetkiliKodlar is { Count: > 0 }
            ? yetkiliKodlar.ToArray()
            : new[] { "__TANIMSIZ__" };

        using var db = _vt.Baglanti();
        var p = new
        {
            bas = baslangic,
            bitSonra = bitisSonrasi,
            birimTuru = tur,
            subeSiniri = SubeSuzmesi ? 1 : 0,
            yetkiliSubeler = yetkiliDizi
        };

        /* Bütün sayımların ortak tabanı: Başvurular sayfasının kartları ve
           dağılım penceresiyle aynı (arşiv ve aynı adayın eski başvuruları
           hariç, BasvuruTabani). Önceden rapor bunları da sayıyordu ve aynı
           dönem için iki sayfa farklı toplam gösteriyordu. */
        var taban = $@"
FROM KRY_BASVURULAR b
WHERE b.olusturma >= @bas AND b.olusturma < @bitSonra
  AND {BasvuruTabani.RaporKosul("b")}
  AND (@birimTuru IS NULL OR ISNULL(b.birim_turu, N'Şube') = @birimTuru)
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)";

        /* Görüşme ve olumlu kümeleri her kırılımda aynı; "Onay Bekliyor"
           önceden hiçbir kümeye girmiyordu (işe alım onayı bekleyen aday
           görüşmeyi geçmiş, olumlu sonuçlanmıştır). */
        var gorusme = BasvuruTabani.GorusmeSql;
        var olumlu = BasvuruTabani.OlumluSql;

        var sayimSutunlari = $@"
    COUNT(*)                                                             AS Toplam,
    SUM(CASE WHEN b.durum IN ({gorusme}) THEN 1 ELSE 0 END)              AS Gorusme,
    SUM(CASE WHEN b.durum IN ({olumlu})  THEN 1 ELSE 0 END)              AS Olumlu,
    SUM(CASE WHEN b.durum = N'Olumsuz'   THEN 1 ELSE 0 END)              AS Olumsuz,
    SUM(CASE WHEN b.durum = N'İşe Alındı' THEN 1 ELSE 0 END)             AS IseAlindi";

        /* ------------------------------------------------------------ genel */

        var genel = db.QuerySingle<RaporGenel>($@"
SELECT
    COUNT(*)                                                             AS Toplam,
    SUM(CASE WHEN b.durum = N'Yeni'               THEN 1 ELSE 0 END)     AS Yeni,
    SUM(CASE WHEN b.durum = N'İncelendi'          THEN 1 ELSE 0 END)     AS Incelendi,
    SUM(CASE WHEN b.durum = N'Değerlendirmede'    THEN 1 ELSE 0 END)     AS Degerlendirmede,
    SUM(CASE WHEN b.durum = N'Görüşme Talebi'     THEN 1 ELSE 0 END)     AS GorusmeTalebi,
    SUM(CASE WHEN b.durum = N'Olumlu'             THEN 1 ELSE 0 END)     AS Olumlu,
    SUM(CASE WHEN b.durum = N'Evrak Hazırlanıyor' THEN 1 ELSE 0 END)     AS EvrakHazirlaniyor,
    SUM(CASE WHEN b.durum = N'Onay Bekliyor'      THEN 1 ELSE 0 END)     AS OnayBekliyor,
    SUM(CASE WHEN b.durum = N'İşe Alındı'         THEN 1 ELSE 0 END)     AS IseAlindi,
    SUM(CASE WHEN b.durum = N'Olumsuz'            THEN 1 ELSE 0 END)     AS Olumsuz,
    SUM(CASE WHEN b.eposta IS NOT NULL AND LTRIM(RTRIM(b.eposta)) <> ''
             THEN 1 ELSE 0 END)                                          AS EpostaliAday,
    SUM(CASE WHEN ISNULL(b.engel_var, 0) = 1 THEN 1 ELSE 0 END)          AS EngelBeyanEden
{taban}", p);

        /* ------------------------------------------------------------ aylık */

        var aylikHam = db.Query<AylikRapor>($@"
SELECT
    YEAR(b.olusturma)  AS Yil,
    MONTH(b.olusturma) AS Ay,
    COUNT(*)           AS Toplam,
    SUM(CASE WHEN b.durum IN ({gorusme}) THEN 1 ELSE 0 END) AS Gorusme,
    SUM(CASE WHEN b.durum IN ({olumlu})  THEN 1 ELSE 0 END) AS Olumlu,
    SUM(CASE WHEN b.durum = N'Olumsuz'   THEN 1 ELSE 0 END) AS Olumsuz
{taban}
GROUP BY YEAR(b.olusturma), MONTH(b.olusturma)", p).ToList();

        /* Hiç başvuru gelmeyen aylar da grafikte görünsün: boş ay atlanınca
           eksen kayıyor ve iki ay yan yana duruyormuş gibi okunuyordu. */
        var aylik = new List<AylikRapor>();

        for (var ay = new DateTime(baslangic.Year, baslangic.Month, 1);
             ay <= bitisGunu;
             ay = ay.AddMonths(1))
        {
            var satir = aylikHam.FirstOrDefault(x => x.Yil == ay.Year && x.Ay == ay.Month)
                        ?? new AylikRapor { Yil = ay.Year, Ay = ay.Month };

            satir.Etiket = $"{AyAdlari[satir.Ay]} {satir.Yil}";
            aylik.Add(satir);
        }

        /* ------------------------------------------------------------- şube */

        var subeler = db.Query<KirilimRapor>($@"
SELECT
    ISNULL(b.sube_kodu, '')                AS Anahtar,
    MAX(ISNULL(NULLIF(LTRIM(RTRIM(b.sube_adi)), N''), b.sube_kodu)) AS Ad,
    {sayimSutunlari}
{taban}
GROUP BY ISNULL(b.sube_kodu, '')
ORDER BY COUNT(*) DESC", p).ToList();

        /* Şube → bölge: Excel pivotunda bölge kırılımı için. Bölge tanımı
           Form Ayarları'ndaki listeden; tanımsız şube "Tanımsız". Bölge
           tanımında şube adla yazılmışsa ad da eşleştirilir. */
        var ayar = _ayar.FormOku();
        var bolgeHaritasi = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var b in ayar.Bolgeler ?? new List<BolgeTanimi>())
            foreach (var kod in b.Subeler ?? new List<string>())
            {
                var k = (kod ?? "").Trim();
                var tanim = (ayar.Subeler ?? new List<Sube>()).FirstOrDefault(x =>
                    string.Equals(x.Ad, k, StringComparison.OrdinalIgnoreCase));

                bolgeHaritasi[tanim?.Kod ?? k] = b.Ad;
            }

        foreach (var x in subeler)
        {
            x.Bolge = bolgeHaritasi.TryGetValue((x.Anahtar ?? "").Trim(), out var bAd)
                ? bAd : "Tanımsız";

            if (string.IsNullOrWhiteSpace(x.Ad)) x.Ad = "Şubesi belirtilmemiş";
        }

        /* ------------------------------------------------------------ bölüm */
        /* Bölümler tek alanda virgülle saklandığı için ayrıştırılarak sayılır
           (STRING_SPLIT kullanılmıyor: uyumluluk düzeyi 130'un altında). */

        var ham = db.Query<BolumSatiri>($@"
SELECT b.bolumler AS Bolumler, b.durum AS Durum
{taban}
  AND b.bolumler IS NOT NULL AND LTRIM(RTRIM(b.bolumler)) <> ''", p).ToList();

        var bolumHaritasi = new Dictionary<string, KirilimRapor>(StringComparer.OrdinalIgnoreCase);

        foreach (var satir in ham)
        {
            var durum = satir.Durum;

            foreach (var parca in (satir.Bolumler ?? "")
                         .Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var bolum = parca.Trim();
                if (bolum.Length == 0) continue;

                if (!bolumHaritasi.TryGetValue(bolum, out var kayit))
                {
                    kayit = new KirilimRapor { Anahtar = bolum, Ad = bolum };
                    bolumHaritasi[bolum] = kayit;
                }

                kayit.Toplam++;
                if (BasvuruTabani.GorusmeDurumlari.Contains(durum)) kayit.Gorusme++;
                if (BasvuruTabani.OlumluDurumlari.Contains(durum)) kayit.Olumlu++;
                if (durum == Durumlar.Olumsuz) kayit.Olumsuz++;
                if (durum == Durumlar.IseAlindi) kayit.IseAlindi++;
            }
        }

        /* Bölüm hedefi: açık pozisyon (norm − mevcut). Önceden KRY_KADRO
           'hedef' kolonu toplanıyordu; o değer son senkronda yazılır ve norm
           elle değiştirilince eskir. Norm Kadro ekranı ve aşağıdaki norm
           bölümü farkı kullanıyor; gizli birimler ve şube yetkisi de aynı. */
        foreach (var kadro in NormKadroSatirlariOku(db))
        {
            if (kadro.Ihtiyac <= 0 || string.IsNullOrWhiteSpace(kadro.Bolum)) continue;

            var anahtar = kadro.Bolum.Trim();

            if (!bolumHaritasi.TryGetValue(anahtar, out var kayit))
            {
                kayit = new KirilimRapor { Anahtar = anahtar, Ad = anahtar };
                bolumHaritasi[anahtar] = kayit;
            }

            kayit.Hedef += kadro.Ihtiyac;
        }

        var bolumler = bolumHaritasi.Values
            .OrderByDescending(x => x.Toplam)
            .ThenBy(x => x.Ad)
            .ToList();

        /* ---------------------------------------------- ilgi görmeyen alanlar */

        var basvurusuOlmayanSubeler = (ayar.Subeler ?? new List<Sube>())
            .Where(x => yetkiliKodlar is null || yetkiliKodlar.Contains(x.Kod ?? ""))
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            /* Birim türü seçiliyse yalnızca o türdeki birimler sorulur */
            .Where(x => tur is null || string.Equals(x.Tur ?? "Şube", tur, StringComparison.OrdinalIgnoreCase))
            .Where(x => !subeler.Any(s =>
                string.Equals(s.Anahtar, x.Kod, StringComparison.OrdinalIgnoreCase)))
            .Select(x => string.IsNullOrWhiteSpace(x.Ad) ? x.Kod : x.Ad)
            .OrderBy(x => x)
            .ToList();

        var basvurusuOlmayanBolumler = (ayar.Bolumler ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Where(x => !bolumHaritasi.ContainsKey(x.Trim()) ||
                        bolumHaritasi[x.Trim()].Toplam == 0)
            .OrderBy(x => x)
            .ToList();

        /* -------------------------------------------------------- ilçe / semt */
        /* Olumsuz ve işe alınan sütunları 0 yazılıyordu; Excel çıktısında
           bütün satırlar "0 olumsuz" görünüyordu. Şube kırılımıyla aynı
           sayım kullanılır. */

        var ilceler = db.Query<KirilimRapor>($@"
SELECT TOP 15
    ISNULL(NULLIF(LTRIM(RTRIM(b.ilce)), N''), N'Belirtilmemiş') AS Anahtar,
    ISNULL(NULLIF(LTRIM(RTRIM(b.ilce)), N''), N'Belirtilmemiş') AS Ad,
    {sayimSutunlari}
{taban}
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(b.ilce)), N''), N'Belirtilmemiş')
ORDER BY COUNT(*) DESC", p).ToList();

        /* ------------------------------------------------ başvuru kaynağı */

        /* Adayın bizi nereden duyduğu.

           Hangi kanalın gerçekten aday getirdiğini ölçmek için: mağaza
           karekodu mu, ilan sitesi mi, tanıdık önerisi mi. Olumlu sonuç
           sayısı da geliyor — çok başvuru getiren kanal ille de iyi aday
           getirmiyor ve ikisini ayırmadan karar verilemiyordu.

           "Diğer" seçilip açıklama yazılanlar tek satırda toplanıyor;
           serbest metinler ayrı ayrı listelense rapor okunmaz olurdu. */
        var kaynaklar = db.Query<KirilimRapor>($@"
SELECT
    ISNULL(NULLIF(LTRIM(RTRIM(b.kaynak)), N''), N'Belirtilmemiş') AS Anahtar,
    ISNULL(NULLIF(LTRIM(RTRIM(b.kaynak)), N''), N'Belirtilmemiş') AS Ad,
    {sayimSutunlari}
{taban}
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(b.kaynak)), N''), N'Belirtilmemiş')
ORDER BY COUNT(*) DESC", p).ToList();

        /* "Diğer" açıklamaları ayrı: hangi kanalların listeye eklenmesi
           gerektiği buradan görülüyor. */
        var kaynakDigerleri = db.Query<KirilimRapor>($@"
SELECT TOP 20
    LTRIM(RTRIM(b.kaynak_detay))     AS Anahtar,
    LTRIM(RTRIM(b.kaynak_detay))     AS Ad,
    {sayimSutunlari}
{taban}
  AND b.kaynak_detay IS NOT NULL AND LTRIM(RTRIM(b.kaynak_detay)) <> N''
GROUP BY LTRIM(RTRIM(b.kaynak_detay))
ORDER BY COUNT(*) DESC", p).ToList();

        /* ------------------------------------------------ norm kadro raporu */

        var kadroSatirlari = NormKadroRaporu(db, baslangic, bitisSonrasi);

        /* -------------------------------------------------- işe alınanlar */

        /* İşe giriş tarihi dönemde olan İşe Alındı kayıtları: Yönetim Raporu
           ve Norm Kadro ekranındaki "işe alınan" ile aynı ölçüt (tarih işe
           girişten). Giriş tarihi girilmemiş eski kayıtlar başvuru
           tarihiyle alınır. Birim türü ve şube yetkisi uygulanır. */
        var iseAlinanlar = db.Query<IseAlinanRapor>(@"
SELECT b.id AS Id, b.basvuru_no AS BasvuruNo, b.ad_soyad AS AdSoyad, b.telefon AS Telefon,
       b.sube_kodu AS SubeKodu, b.sube_adi AS SubeAdi, b.bolumler AS Bolumler,
       b.ise_giris_tarihi AS IseGirisTarihi, b.ise_giris_bolum AS IseGirisBolum,
       b.anlasilan_ucret AS AnlasilanUcret, b.yol_ucreti AS YolUcreti,
       /* Talep edilen ücret alanı modelde vardı ama seçilmiyordu; ekranda
          ve Excel'de hep boş kalıyordu. */
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS TalepUcret,
       b.doldurma_gun AS DoldurmaGun,
       b.olusturma AS Olusturma
FROM KRY_BASVURULAR b
WHERE b.durum = N'İşe Alındı'
  AND (b.ise_giris_tarihi >= @bas AND b.ise_giris_tarihi < @bitSonra
       OR (b.ise_giris_tarihi IS NULL AND b.olusturma >= @bas AND b.olusturma < @bitSonra))
  AND (@birimTuru IS NULL OR ISNULL(b.birim_turu, N'Şube') = @birimTuru)
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY b.ise_giris_tarihi DESC, b.id DESC", p).ToList();

        var birimTurleri = (ayar.BirimTurleri ?? new List<BirimTuru>())
            .Select(x => x.Ad)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitisGunu,
            birimTurleri,
            secili = tur,
            iseAlinanlar,
            normKadro = kadroSatirlari,
            normOzet = NormOzeti(kadroSatirlari),
            genel,
            aylik,
            subeler,
            bolumler,
            ilceler,
            kaynaklar,
            kaynakDigerleri,
            basvurusuOlmayanSubeler,
            basvurusuOlmayanBolumler
        });
    }

    /// <summary>
    /// Raporlar sayfasının norm kadro bölümü: pozisyon satırları ve dönemde
    /// gelen başvuru / havuz / işe alınan sayıları.
    ///
    /// <para>
    /// Panel bu ucu Norm Kadro ekranının ucundan (Havuz/NormRapor) SONRA
    /// çağırır: o uç Mikro'dan mevcut sayılarını senkronlar ve engelli,
    /// raporlu, ayrılacak bilgisini verir. Böylece iki ekran aynı norm,
    /// mevcut, eksik ve fazla sayılarını gösterir (03.10.2026).
    /// </para>
    /// </summary>
    [HttpGet("NormKadro")]
    public IActionResult NormKadro([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-11).AddDays(1 - DateTime.Today.Day);
        var bitisSonrasi = (bit?.Date ?? DateTime.Today).AddDays(1);

        using var db = _vt.Baglanti();

        var satirlar = NormKadroRaporu(db, baslangic, bitisSonrasi);

        return Ok(new { satirlar, ozet = NormOzeti(satirlar) });
    }

    /// <summary>Norm kadro satırlarının toplamları</summary>
    private static object NormOzeti(List<NormKadroRapor> satirlar) => new
    {
        toplamNorm = satirlar.Sum(x => x.Norm),
        toplamMevcut = satirlar.Sum(x => x.MevcutPersonel),
        /* Pozisyon bazında toplanır; Norm Kadro kartlarıyla aynı */
        toplamIhtiyac = satirlar.Sum(x => x.Ihtiyac),
        toplamFazla = satirlar.Sum(x => x.Fazla),
        toplamEngelli = satirlar.Sum(x => x.Engelli),
        toplamIseAlinan = satirlar.Sum(x => x.IseAlinan)
    };

    /// <summary>
    /// Aktif kadro satırları; Norm Kadro ekranıyla (Havuz/NormRapor) aynı
    /// kapsam: "Norm raporunda gizle" işaretli birimler çıkar, şube yetkisi
    /// kod kümesiyle uygulanır. Şubesiz ("Tüm Birimler") satırlar da
    /// dahildir; Norm Kadro toplamları onları da sayıyor ve rapor onları
    /// dışarıda bıraktığı için toplamlar tutmuyordu. Şube süzmesi varken
    /// şubesizler — Norm Kadro ekranında olduğu gibi — düşer.
    /// </summary>
    private List<NormKadroRapor> NormKadroSatirlariOku(System.Data.IDbConnection db)
    {
        /* İhtiyaç, 'hedef' kolonundan değil norm ile mevcut farkından
           hesaplanır: hedef son senkronda yazılmış bir değerdir ve norm
           elle değiştirildiğinde güncellenmemiş olabiliyor. */
        var satirlar = db.Query<NormKadroRapor>(@"
SELECT id AS KadroId, ISNULL(sube_kodu, '') AS SubeKodu,
       CASE WHEN sube_kodu IS NULL OR LTRIM(RTRIM(sube_kodu)) = ''
            THEN N'Tüm Birimler (genel)' ELSE ISNULL(sube_adi, sube_kodu) END AS SubeAdi,
       bolum AS Bolum,
       ISNULL(norm, 0) AS Norm, ISNULL(mevcut, 0) AS MevcutPersonel,
       CASE WHEN ISNULL(norm, 0) > ISNULL(mevcut, 0)
            THEN ISNULL(norm, 0) - ISNULL(mevcut, 0) ELSE 0 END AS Ihtiyac,
       CASE WHEN ISNULL(mevcut, 0) > ISNULL(norm, 0)
            THEN ISNULL(mevcut, 0) - ISNULL(norm, 0) ELSE 0 END AS Fazla,
       ISNULL(engelli, 0) AS Engelli,
       aciklama AS Aciklama
FROM KRY_KADRO
WHERE aktif = 1
ORDER BY sube_adi, bolum").ToList();

        var gizliKodlar = (_ayar.FormOku().Subeler ?? new List<Sube>())
            .Where(x => x.NormRaporundaGizle && !string.IsNullOrWhiteSpace(x.Kod))
            .Select(x => x.Kod)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (gizliKodlar.Count > 0)
            satirlar = satirlar.Where(x => !gizliKodlar.Contains(x.SubeKodu ?? "")).ToList();

        if (SubeSuzmesi)
        {
            var izinli = YetkiliKodlar();
            satirlar = satirlar.Where(x => izinli.Contains(x.SubeKodu ?? "")).ToList();
        }

        return satirlar;
    }

    /// <summary>
    /// Kadro satırları ve her satır için dönemdeki başvuru, havuz ve işe
    /// alınan sayıları.
    /// </summary>
    private List<NormKadroRapor> NormKadroRaporu(
        System.Data.IDbConnection db, DateTime bas, DateTime bitSonra)
    {
        var kadroSatirlari = NormKadroSatirlariOku(db);

        if (kadroSatirlari.Count == 0) return kadroSatirlari;

        /* Başvuru ve havuz sayıları başvuru tarihine göre ve kutularla aynı
           tabanda (arşiv ve eski tekrar başvurular hariç). */
        var basvuruSatirlari = db.Query<BolumSayim>($@"
SELECT ISNULL(b.sube_kodu, '') AS SubeKodu, b.bolumler AS Bolumler, b.durum AS Durum
FROM KRY_BASVURULAR b
WHERE b.olusturma >= @bas AND b.olusturma < @bitSonra
  AND {BasvuruTabani.RaporKosul("b")}
  AND b.bolumler IS NOT NULL AND LTRIM(RTRIM(b.bolumler)) <> ''",
            new { bas, bitSonra }).ToList();

        /* İşe alınan: işe giriş tarihi dönemde olanlar, işe başladığı
           pozisyonla (yoksa başvurduğu pozisyonlarla). Önceden başvuru
           tarihine bakılıyordu; "İşe alınanlar" listesinde görünen kişi
           norm tablosunda görünmüyordu. */
        var alinanlar = db.Query<BolumSayim>(@"
SELECT ISNULL(sube_kodu, '') AS SubeKodu,
       ISNULL(NULLIF(LTRIM(RTRIM(ise_giris_bolum)), N''), bolumler) AS Bolumler,
       durum AS Durum
FROM KRY_BASVURULAR
WHERE durum = N'İşe Alındı'
  AND (ise_giris_tarihi >= @bas AND ise_giris_tarihi < @bitSonra
       OR (ise_giris_tarihi IS NULL AND olusturma >= @bas AND olusturma < @bitSonra))",
            new { bas, bitSonra }).ToList();

        static bool Uyar(BolumSayim x, NormKadroRapor kadro) =>
            (string.IsNullOrWhiteSpace(kadro.SubeKodu) ||
             string.Equals(x.SubeKodu, kadro.SubeKodu, StringComparison.OrdinalIgnoreCase)) &&
            (x.Bolumler ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(b => b.Trim())
                .Any(b => string.Equals(b, kadro.Bolum, StringComparison.OrdinalIgnoreCase));

        foreach (var kadro in kadroSatirlari)
        {
            var uyanlar = basvuruSatirlari.Where(x => Uyar(x, kadro)).ToList();

            kadro.Basvuru = uyanlar.Count;
            /* "Havuzda": durumu Olumlu olanlar (Norm Kadro'daki havuz sütunu) */
            kadro.Olumlu = uyanlar.Count(x => x.Durum == Durumlar.Olumlu);
            kadro.IseAlinan = alinanlar.Count(x => Uyar(x, kadro));
        }

        return kadroSatirlari;
    }

    /* ==================================================================== */
    /* Personel başı ciro verimliliği                                        */
    /* ==================================================================== */

    /// <summary>
    /// Şube bazında personel başı günlük ciro.
    ///
    /// Ciro Mikro V15'ten depo (şube) ve tarih kırılımında okunur. İki ayrı
    /// oran hesaplanır: mevcut personele bölünmüş ve norm kadroya bölünmüş.
    /// Aradaki fark, kadronun ne kadar dolu çalıştığını gösterir.
    ///
    /// Geriye dönük sorgularda o tarihte geçerli olan norm kullanılır;
    /// norm değişiklikleri KRY_KADRO_GECMIS tablosundan izlenir.
    /// </summary>
    [HttpGet("CiroVerimliligi")]
    public IActionResult CiroVerimliligi(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string kiyas = "hafta",
        [FromQuery] DateTime? kiyasBas = null,
        [FromQuery] DateTime? kiyasBit = null)
    {
        var baslangic = (bas ?? DateTime.Today.AddDays(-30)).Date;
        var bitis = (bit ?? DateTime.Today.AddDays(-1)).Date;

        if (bitis < baslangic) (baslangic, bitis) = (bitis, baslangic);

        /* Çok geniş aralıklar sorguyu yorar */
        if ((bitis - baslangic).TotalDays > 400)
            return BadRequest(new { hata = "En fazla 400 günlük aralık sorgulanabilir." });

        var ayar = _ayar.FormOku();

        var subeler = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

        /* Şube yetkisi kod kümesiyle (YetkiliKodlar): bölge tanımında adla
           yazılmış şubeler doğrudan karşılaştırmada düşüyordu. */
        var izinliKodlar = SubeSuzmesi ? YetkiliKodlar() : null;

        if (izinliKodlar is not null)
        {
            subeler = subeler
                .Where(x => izinliKodlar.Contains(x.Kod))
                .ToList();
        }

        /* ------------------------------------------------ karşılaştırma dönemi
           Kullanıcı hangi dönemle kıyaslayacağını seçer:

             hafta  → bir hafta öncesi (haftanın günleri aynı kalır)
             donem  → hemen önceki eşit uzunluktaki dönem
             ay     → bir ay öncesi
             yil    → bir yıl öncesi
             ozel   → elle girilen tarih aralığı
             yok    → karşılaştırma yapılmaz
        */
        var gunSayisiAralik = (bitis - baslangic).Days + 1;

        DateTime? oncekiBas = null;
        DateTime? oncekiBit = null;

        switch ((kiyas ?? "hafta").ToLowerInvariant())
        {
            case "yok":
                break;

            case "donem":
                oncekiBit = baslangic.AddDays(-1);
                oncekiBas = oncekiBit.Value.AddDays(-(gunSayisiAralik - 1));
                break;

            case "ay":
                oncekiBas = baslangic.AddMonths(-1);
                oncekiBit = bitis.AddMonths(-1);
                break;

            case "yil":
                oncekiBas = baslangic.AddYears(-1);
                oncekiBit = bitis.AddYears(-1);
                break;

            case "ozel":
                if (kiyasBas is not null && kiyasBit is not null)
                {
                    oncekiBas = kiyasBas.Value.Date;
                    oncekiBit = kiyasBit.Value.Date;

                    if (oncekiBit < oncekiBas)
                        (oncekiBas, oncekiBit) = (oncekiBit, oncekiBas);
                }
                break;

            default: /* hafta */
                oncekiBas = baslangic.AddDays(-7);
                oncekiBit = bitis.AddDays(-7);
                break;
        }

        /* ------------------------------------------------------------ ciro */
        List<dynamic> tumSatirlar;

        try
        {
            using var ciroDb = _vt.CiroBaglantisi();

            /* İki dönem tek sorguda alınır */
            /* Sorgu her iki dönemi kapsayacak şekilde tek seferde çalışır */
            var sorguBas = oncekiBas is null
                ? baslangic
                : (oncekiBas.Value < baslangic ? oncekiBas.Value : baslangic);

            var sorguBit = oncekiBit is null
                ? bitis
                : (oncekiBit.Value > bitis ? oncekiBit.Value : bitis);

            tumSatirlar = ciroDb.Query(@"
SELECT DEPO AS depo,
       CAST(Tarih AS DATE) AS tarih,
       SUM(Satis_Tutar + Satis_Kdv) AS ciro
FROM [MikroDB_V15_BICEN].[dbo].[hmz_stok_hareket1]
WHERE Tarih BETWEEN @sorguBas AND @sorguBit
GROUP BY DEPO, CAST(Tarih AS DATE)",
                new { sorguBas, sorguBit },
                commandTimeout: 180).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Ciro verisi alınamadı");

            return StatusCode(502, new
            {
                hata = "Ciro veritabanına ulaşılamadı.",
                ayrinti = hata.Message
            });
        }

        /* Satırlar dönemlere ayrılır */
        var ciroSatirlari = tumSatirlar
            .Where(x => (DateTime)x.tarih >= baslangic && (DateTime)x.tarih <= bitis)
            .ToList();

        var oncekiSatirlar = oncekiBas is null
            ? new List<dynamic>()
            : tumSatirlar
                .Where(x => (DateTime)x.tarih >= oncekiBas.Value &&
                            (DateTime)x.tarih <= oncekiBit.Value)
                .ToList();

        /* --------------------------------------------------- kadro bilgisi */
        using var db = _vt.Baglanti();

        var kadrolar = db.Query(@"
SELECT sube_kodu AS subeKodu, ISNULL(SUM(norm), 0) AS norm,
       ISNULL(SUM(mevcut), 0) AS mevcut
FROM KRY_KADRO
WHERE aktif = 1 AND sube_kodu IS NOT NULL
GROUP BY sube_kodu").ToList();

        /* Şubesiz tanımlanmış kadrolar (tüm birimler için ortak) */
        var subesizKadro = db.QuerySingleOrDefault(@"
SELECT ISNULL(SUM(norm), 0) AS norm, ISNULL(SUM(mevcut), 0) AS mevcut
FROM KRY_KADRO
WHERE aktif = 1 AND (sube_kodu IS NULL OR LTRIM(RTRIM(sube_kodu)) = '')");

        /* Dönem sonundaki normu bulmak için değişiklik geçmişi.
           Bitiş tarihinden sonra yapılan değişiklikler geri alınır. */
        /* Kıyas dönemi daha eski olabileceği için sorgu o tarihten
           itibaren alınır; her iki dönemin kadrosu buradan türetilir. */
        var enEskiTarih = oncekiBas is null || oncekiBas.Value > bitis
            ? bitis
            : oncekiBas.Value;

        var gecmis = db.Query(@"
SELECT sube_kodu AS subeKodu, bolum, eski_norm AS eskiNorm,
       yeni_norm AS yeniNorm, eski_mevcut AS eskiMevcut,
       yeni_mevcut AS yeniMevcut, gecerli_tarih AS tarih
FROM KRY_KADRO_GECMIS
WHERE gecerli_tarih > @tarih
ORDER BY gecerli_tarih DESC", new { tarih = enEskiTarih }).ToList();

        /*
         * Belirli bir tarihte geçerli olan kadroyu bulur.
         *
         * Tablodaki değerler bugünkü hâli gösterir; o tarihten sonra yapılan
         * değişiklikler geri alınarak dönemin kadrosuna ulaşılır. Böylece
         * kişi başı ciro, o dönemde gerçekten çalışan personele bölünür.
         */
        (decimal Norm, decimal Mevcut) KadroBul(
            string subeKodu, decimal bugunkuNorm, decimal bugunkuMevcut, DateTime tarih)
        {
            var norm = bugunkuNorm;
            var mevcut = bugunkuMevcut;

            foreach (var d in gecmis.Where(x =>
                string.Equals((string)x.subeKodu, subeKodu,
                    StringComparison.OrdinalIgnoreCase) &&
                (DateTime)x.tarih > tarih))
            {
                norm -= (decimal)d.yeniNorm - (decimal)(d.eskiNorm ?? 0m);

                if (d.yeniMevcut is not null)
                    mevcut -= (decimal)d.yeniMevcut - (decimal)(d.eskiMevcut ?? 0m);
            }

            return (Math.Max(0, norm), Math.Max(0, mevcut));
        }

        /* Depo kodu ile şube kodunu eşleştirmek için sözlük */
        var sonuc = new List<CiroVerimlilik>();

        foreach (var sube in subeler)
        {
            var kendi = ciroSatirlari
                .Where(x => DepoEslesiyorMu(x.depo, sube))
                .ToList();

            if (kendi.Count == 0) continue;

            var toplamCiro = kendi.Sum(x => (decimal)(x.ciro ?? 0m));
            var gunSayisi = kendi.Select(x => (DateTime)x.tarih).Distinct().Count();

            var kadro = kadrolar.FirstOrDefault(x =>
                string.Equals((string)x.subeKodu, sube.Kod,
                    StringComparison.OrdinalIgnoreCase));

            var bugunkuNorm = kadro is null ? 0m : (decimal)kadro.norm;
            var bugunkuMevcut = kadro is null ? 0m : (decimal)kadro.mevcut;

            /* Seçilen dönemde geçerli olan kadro */
            var (norm, mevcut) = KadroBul(
                sube.Kod, bugunkuNorm, bugunkuMevcut, bitis);

            /* Kıyas döneminde geçerli olan kadro; personel sayısı
               değiştiyse kişi başı değişim ciro değişiminden farklı çıkar */
            var (oncekiNorm, oncekiMevcut) = oncekiBit is null
                ? (norm, mevcut)
                : KadroBul(sube.Kod, bugunkuNorm, bugunkuMevcut, oncekiBit.Value);

            var gunlukCiro = gunSayisi > 0 ? toplamCiro / gunSayisi : 0m;

            /* Karşılaştırma dönemindeki aynı şubenin günlük cirosu */
            var oncekiKendi = oncekiSatirlar
                .Where(x => DepoEslesiyorMu(x.depo, sube))
                .ToList();

            var oncekiToplam = oncekiKendi.Sum(x => (decimal)(x.ciro ?? 0m));
            var oncekiGun = oncekiKendi.Select(x => (DateTime)x.tarih).Distinct().Count();
            var oncekiGunluk = oncekiGun > 0 ? oncekiToplam / oncekiGun : 0m;

            var oncekiMevcutBasi = oncekiMevcut > 0 && oncekiGunluk > 0
                ? Math.Round(oncekiGunluk / oncekiMevcut, 2)
                : 0m;

            var oncekiNormBasi = oncekiNorm > 0 && oncekiGunluk > 0
                ? Math.Round(oncekiGunluk / oncekiNorm, 2)
                : 0m;

            sonuc.Add(new CiroVerimlilik
            {
                SubeKodu = sube.Kod,
                SubeAdi = sube.Ad,
                ToplamCiro = toplamCiro,
                GunSayisi = gunSayisi,
                GunlukCiro = Math.Round(gunlukCiro, 2),
                Norm = norm,
                Mevcut = mevcut,
                NormBasi = norm > 0 ? Math.Round(gunlukCiro / norm, 2) : 0m,
                MevcutBasi = mevcut > 0 ? Math.Round(gunlukCiro / mevcut, 2) : 0m,

                OncekiGunlukCiro = Math.Round(oncekiGunluk, 2),
                OncekiToplamCiro = oncekiToplam,
                OncekiNormBasi = oncekiNormBasi,
                OncekiMevcutBasi = oncekiMevcutBasi,

                OncekiNorm = oncekiNorm,
                OncekiMevcut = oncekiMevcut,

                /* Değişim kişi başı değer üzerinden hesaplanır.
                   Ciro artmış ama personel daha da artmışsa verimlilik
                   düşmüştür; ham ciro değişimi bunu göstermez. */
                DegisimYuzde = oncekiMevcutBasi > 0
                    ? Math.Round(
                        ((mevcut > 0 ? gunlukCiro / mevcut : 0m) - oncekiMevcutBasi)
                        / oncekiMevcutBasi * 100, 1)
                    : (decimal?)null,

                NormDegisimYuzde = oncekiNormBasi > 0
                    ? Math.Round(
                        ((norm > 0 ? gunlukCiro / norm : 0m) - oncekiNormBasi)
                        / oncekiNormBasi * 100, 1)
                    : (decimal?)null
            });
        }

        sonuc = sonuc.OrderByDescending(x => x.MevcutBasi).ToList();

        /* Cirosu olan ama sistemde tanımlı şubeyle eşleşmeyen depolar.
           Şube adı Mikro'dakinden farklı yazıldıysa burada görünür. */
        /* Tanımlı BÜTÜN şubelerle karşılaştırılır: şube yetkisi olan
           kullanıcıda başka bölgenin depoları "eşleşmedi" uyarısına
           düşüyordu. */
        var tanimliSubeler = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

        var eslesenDepolar = new HashSet<string>(
            tanimliSubeler.Select(x => DepoAnahtari(x.Ad))
                .Concat(tanimliSubeler.Select(x => DepoAnahtari(x.Kod))),
            StringComparer.Ordinal);

        var eslesmeyenler = ciroSatirlari
            .Select(x => (string)(x.depo?.ToString() ?? ""))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(x => !eslesenDepolar.Contains(DepoAnahtari(x)))
            .OrderBy(x => x)
            .ToList();

        /* Genel ortalamalar; kıyaslama için */
        var toplamGunluk = sonuc.Sum(x => x.GunlukCiro);
        var oncekiToplamGunluk = sonuc.Sum(x => x.OncekiGunlukCiro);

        /* Dönemin tamamındaki ciro. Günlük ortalama karşılaştırma içindir;
           bu değer seçilen aralıkta gerçekte ne kadar satış yapıldığını
           gösterir. */
        var donemToplamCiro = sonuc.Sum(x => x.ToplamCiro);
        /* Kıyas dönemi de aynı şubelerden toplanır. Önceden kıyas dönemindeki
           BÜTÜN depolar (eşleşmeyenler ve yetki dışı şubeler dahil)
           toplanıyordu; bu dönem yalnızca eşleşen şubeleri saydığı için
           değişim yüzdesi olduğundan düşük çıkıyordu. */
        var oncekiDonemToplamCiro = sonuc.Sum(x => x.OncekiToplamCiro);

        /* Ciro kaydı bulunan gün sayısı (kapalı günler sayılmaz) */
        var donemGunSayisi = ciroSatirlari
            .Select(x => (DateTime)x.tarih)
            .Distinct()
            .Count();

        /* Mağaza kişi başı: yalnızca ciro üreten birimlerin personeli */
        var magazaNorm = sonuc.Sum(x => x.Norm);
        var magazaMevcut = sonuc.Sum(x => x.Mevcut);

        /* Kıyas dönemindeki mağaza kadrosu */
        var oncekiMagazaNorm = sonuc.Sum(x => x.OncekiNorm);
        var oncekiMagazaMevcut = sonuc.Sum(x => x.OncekiMevcut);

        /* Genel kişi başı: şirketin tüm personeli.
           Ciro yalnızca mağazalardan gelir ama genel müdürlük, lojistik depo
           ve hal gibi birimler de o cironun parçasıdır; bu yüzden toplam
           ciro şirketin tamamına bölünür. */
        /* Bölge süzgeci ya da şube yetkisi varsa genel toplam da o şubelerle
           sınırlıdır. Önceden yorumda öyle yazıyordu ama şirketin bütün
           personeli alınıyor, bölgenin cirosu tüm şirkete bölünüyordu. */
        var tumBirimKodlari = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .Where(x => izinliKodlar is null || izinliKodlar.Contains(x.Kod))
            .Select(x => x.Kod)
            .ToList();

        var genelNorm = kadrolar
            .Where(k => tumBirimKodlari.Contains((string)k.subeKodu,
                StringComparer.OrdinalIgnoreCase))
            .Sum(k => (decimal)k.norm);

        var genelMevcut = kadrolar
            .Where(k => tumBirimKodlari.Contains((string)k.subeKodu,
                StringComparer.OrdinalIgnoreCase))
            .Sum(k => (decimal)k.mevcut);

        /* Şubesiz kadrolar da genel toplama girer (şube süzmesi yokken) */
        if (subesizKadro is not null && izinliKodlar is null)
        {
            genelNorm += (decimal)subesizKadro.norm;
            genelMevcut += (decimal)subesizKadro.mevcut;
        }

        /* Bölge süzgeci varsa genel toplam da o bölgeyle sınırlıdır */
        var toplamNorm = genelNorm;
        var toplamMevcut = genelMevcut;

        /* Genel kadrodaki dönemler arası fark, mağaza kadrosundaki farkla
           aynı orandadır; merkez birimlerin geçmişi ayrıca tutulmadığı için
           bu fark mağaza değişiminden türetilir. */
        var oncekiToplamNorm = toplamNorm - (magazaNorm - oncekiMagazaNorm);
        var oncekiToplamMevcut = toplamMevcut - (magazaMevcut - oncekiMagazaMevcut);

        return Ok(new
        {
            baslangic,
            bitis,
            eslesmeyenDepolar = eslesmeyenler,

            /* Seçilen aralığın toplam cirosu */
            donem = new
            {
                toplamCiro = Math.Round(donemToplamCiro, 2),
                gunSayisi = donemGunSayisi,
                oncekiToplamCiro = Math.Round(oncekiDonemToplamCiro, 2),
                degisimYuzde = oncekiDonemToplamCiro > 0
                    ? Math.Round((donemToplamCiro - oncekiDonemToplamCiro)
                        / oncekiDonemToplamCiro * 100, 1)
                    : (decimal?)null
            },

            subeler = sonuc,
            /* GENEL: mağaza ciroları ÷ şirketin tüm personeli */
            genel = new
            {
                gunlukCiro = Math.Round(toplamGunluk, 2),
                norm = toplamNorm,
                mevcut = toplamMevcut,
                normBasi = toplamNorm > 0
                    ? Math.Round(toplamGunluk / toplamNorm, 2) : 0m,
                mevcutBasi = toplamMevcut > 0
                    ? Math.Round(toplamGunluk / toplamMevcut, 2) : 0m,

                oncekiGunlukCiro = Math.Round(oncekiToplamGunluk, 2),
                oncekiNorm = oncekiToplamNorm,
                oncekiMevcut = oncekiToplamMevcut,
                oncekiNormBasi = oncekiToplamNorm > 0 && oncekiToplamGunluk > 0
                    ? Math.Round(oncekiToplamGunluk / oncekiToplamNorm, 2) : 0m,
                oncekiMevcutBasi = oncekiToplamMevcut > 0 && oncekiToplamGunluk > 0
                    ? Math.Round(oncekiToplamGunluk / oncekiToplamMevcut, 2) : 0m,

                /* Değişim kişi başı değer üzerinden */
                degisimYuzde = Yuzde(
                    toplamMevcut > 0 ? toplamGunluk / toplamMevcut : 0m,
                    oncekiToplamMevcut > 0
                        ? oncekiToplamGunluk / oncekiToplamMevcut : 0m),

                /* Norm ölçütündeki değişim. Panel "Norm" seçiliyken genel
                   satırda mevcut değişimini gösteriyordu; alan yoktu. */
                normDegisimYuzde = Yuzde(
                    toplamNorm > 0 ? toplamGunluk / toplamNorm : 0m,
                    oncekiToplamNorm > 0
                        ? oncekiToplamGunluk / oncekiToplamNorm : 0m)
            },

            /* MAĞAZA: mağaza ciroları ÷ yalnızca mağaza personeli.
               Merkez ve lojistik hariç tutulduğu için bu değer daha yüksektir;
               şube verimliliğini kıyaslarken bu ölçüt kullanılır. */
            magaza = new
            {
                gunlukCiro = Math.Round(toplamGunluk, 2),
                norm = magazaNorm,
                mevcut = magazaMevcut,
                normBasi = magazaNorm > 0
                    ? Math.Round(toplamGunluk / magazaNorm, 2) : 0m,
                mevcutBasi = magazaMevcut > 0
                    ? Math.Round(toplamGunluk / magazaMevcut, 2) : 0m,
                oncekiGunlukCiro = Math.Round(oncekiToplamGunluk, 2),
                oncekiNorm = oncekiMagazaNorm,
                oncekiMevcut = oncekiMagazaMevcut,
                oncekiMevcutBasi = oncekiMagazaMevcut > 0 && oncekiToplamGunluk > 0
                    ? Math.Round(oncekiToplamGunluk / oncekiMagazaMevcut, 2) : 0m,
                oncekiNormBasi = oncekiMagazaNorm > 0 && oncekiToplamGunluk > 0
                    ? Math.Round(oncekiToplamGunluk / oncekiMagazaNorm, 2) : 0m,

                degisimYuzde = Yuzde(
                    magazaMevcut > 0 ? toplamGunluk / magazaMevcut : 0m,
                    oncekiMagazaMevcut > 0
                        ? oncekiToplamGunluk / oncekiMagazaMevcut : 0m),

                normDegisimYuzde = Yuzde(
                    magazaNorm > 0 ? toplamGunluk / magazaNorm : 0m,
                    oncekiMagazaNorm > 0
                        ? oncekiToplamGunluk / oncekiMagazaNorm : 0m)
            },

            /* Ciro üretmeyen birimlerin personeli; farkın kaynağı */
            merkezPersoneli = new
            {
                norm = genelNorm - magazaNorm,
                mevcut = genelMevcut - magazaMevcut
            },

            kiyasDonemi = oncekiBas is null ? null : new
            {
                baslangic = oncekiBas.Value,
                bitis = oncekiBit.Value,
                tur = kiyas
            }
        });
    }

    /// <summary>
    /// Mikro'daki DEPO alanı ile şube eşleştirmesi.
    ///
    /// DEPO alanı numara değil, şube adını taşır ("ADAKENT", "BAKIRKÖY-2").
    /// Sistemdeki şube adları ise "Adakent Şubesi", "Bakırköy-3 Şubesi"
    /// biçiminde olabildiği için doğrudan karşılaştırma yetmez.
    ///
    /// Bu yüzden her iki ad sadeleştirilir: büyük/küçük harf, Türkçe
    /// karakterler, "şube/mağaza" gibi ekler ve ayraçlar temizlenir.
    /// </summary>
    private static bool DepoEslesiyorMu(object depo, Sube sube)
    {
        if (depo is null || sube is null) return false;

        var d = DepoAnahtari(depo.ToString());

        if (string.IsNullOrWhiteSpace(d)) return false;

        /* Önce şube adı, sonra kod denenir */
        return d == DepoAnahtari(sube.Ad) || d == DepoAnahtari(sube.Kod);
    }

    /// <summary>İki değer arasındaki yüzde değişim; önceki sıfırsa null.</summary>
    private static decimal? Yuzde(decimal simdi, decimal onceki) =>
        onceki > 0 ? Math.Round((simdi - onceki) / onceki * 100, 1) : null;

    /// <summary>Şube/depo adını karşılaştırılabilir bir anahtara indirger.</summary>
    private static string DepoAnahtari(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return "";

        var buyuk = metin.Trim().ToUpperInvariant();

        /* Türkçe karakterler sadeleştirilir */
        var esler = new (char, char)[]
        {
            ('İ', 'I'), ('I', 'I'), ('Ş', 'S'), ('Ğ', 'G'),
            ('Ü', 'U'), ('Ö', 'O'), ('Ç', 'C')
        };

        foreach (var (kaynak, hedef) in esler)
            buyuk = buyuk.Replace(kaynak, hedef);

        /* Yalnızca harf ve rakam bırakılır; tire, boşluk, nokta atılır */
        var temiz = new string(buyuk.Where(char.IsLetterOrDigit).ToArray());

        /* Sonundaki tanım ekleri kaldırılır */
        string[] ekler = { "SUBESI", "SUBE", "MAGAZASI", "MAGAZA", "MARKET" };

        foreach (var ek in ekler)
        {
            if (temiz.EndsWith(ek, StringComparison.Ordinal) && temiz.Length > ek.Length)
            {
                temiz = temiz[..^ek.Length];
                break;
            }
        }

        return temiz;
    }
}

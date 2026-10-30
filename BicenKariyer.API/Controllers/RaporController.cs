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
public partial class RaporController : ControllerBase
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

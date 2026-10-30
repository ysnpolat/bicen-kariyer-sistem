using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Künye ve rakip fiyat analizi.
///
/// <para>
/// Personel rakip marketteki meyve-sebze künyesinin karekodunu okutur.
/// Karekod doğrudan künye numarasını içerir. HKS'de o künyeyi bildiren
/// işletmenin alış fiyatı ile bizim aynı cinste son alış fiyatımız yan
/// yana konur. Bizim fiyat, OZMerkez'deki HKS_SORGU_YENI prosedürünün
/// kullandığı mantıkla bulunur: kendi şubemizin aynı MalinCinsKodNo için
/// son 90 gündeki en güncel etiketi.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class KunyeController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly IHttpClientFactory _istemci;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<KunyeController> _kayit;

    public KunyeController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        IHttpClientFactory istemci,
        IConfiguration yapilandirma,
        ILogger<KunyeController> kayit)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _istemci = istemci;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";

    /// <summary>
    /// Okutan personelin sicili.
    ///
    /// Mobil jetonu "personel:14721|cihaz-abc" biçiminde; panelden
    /// gelindiğinde kullanıcı adı kalır. İstemciden gelen değere
    /// güvenilmez, kim okuttuysa o yazılır.
    /// </summary>
    private string OkutanKodu
    {
        get
        {
            var ad = Kullanici;

            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
                return ad;

            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');

            return i < 0 ? govde : govde[..i];
        }
    }

    /// <summary>Okutanın adı soyadı; personel kaynağından bulunur.</summary>
    private string OkutanAdi(string sicil)
    {
        if (string.IsNullOrWhiteSpace(sicil)) return null;

        try
        {
            var p = _personelKaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(),
                                                   sicil.Trim(),
                                                   StringComparison.OrdinalIgnoreCase));

            return p is null ? null : $"{p.Ad} {p.Soyad}".Trim();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Künyeyi HKS'den okur ve bizim fiyatla karşılaştırır. Kaydetmez;
    /// personel ekranda görüp isterse kaydeder.
    /// </summary>
    [HttpGet("Sorgula")]
    public IActionResult Sorgula([FromQuery] string kunye, [FromQuery] int? depo,
                                 [FromQuery] string sube = null)
    {
        var kunyeNo = KunyeAyikla(kunye);

        if (kunyeNo is null)
            return BadRequest(new { hata = "Künye numarası okunamadı." });

        try
        {
            using var db = _vt.HksBaglantisi();

            /* Rakip taraf: künyeyi bildiren işletme ve alış fiyatı.
               Aynı künye birden çok etikete bölünmüş olabilir; en son
               etiket alınır. */
            var rakip = db.QueryFirstOrDefault(@"
SELECT TOP 1
       kn.KunyeNo            AS kunyeNo,
       kn.MalinCinsKodNo     AS cinsKod,
       kn.MalinSatisFiyati   AS malinSatisFiyati,
       kn.BildirimTarihi     AS bildirimTarihi,
       e.isletme_adi         AS isletme,
       e.sube_adi            AS subeAdi,
       e.alis_fiyati         AS alisFiyati,
       e.miktari             AS miktar,
       e.birimi              AS birim,
       e.uretici             AS uretici,
       e.uretim_yeri         AS uretimYeri,
       e.uretim_tarihi       AS uretimTarihi,
       e.uretim_sekli        AS uretimSekli,
       e.create_date         AS etiketTarihi
FROM [HKS].[dbo].[KUNYELER] kn WITH (NOLOCK)
LEFT JOIN [HKS].[dbo].[ETIKETLER] e WITH (NOLOCK) ON e.kunye = kn.KunyeNo
WHERE kn.KunyeNo = @kunyeNo
ORDER BY e.create_date DESC", new { kunyeNo });

            if (rakip is null)
                return NotFound(new
                {
                    hata = "Künye HKS'de bulunamadı.",
                    ayrinti = $"Numara: {kunyeNo}. Künye henüz bildirilmemiş ya da numara yanlış okunmuş olabilir."
                });

            int? cinsKod = rakip.cinsKod is null ? null : (int?)Convert.ToInt32(rakip.cinsKod);

            /* Bizim taraf: aynı cinste kendi şubemizin son etiketi */
            object bizim = null;
            string bizimSube = null;

            /* Şube ya depo numarasıyla ya da adıyla bulunur. Mobil özet
               şube adını veriyor; HKS'deki sube_adi şirket unvanıyla
               birlikte tutulduğu için içerik araması yapılır. */
            if (depo is not null)
            {
                bizimSube = db.ExecuteScalar<string>(@"
SELECT TOP 1 sube_adi FROM [HKS].[dbo].[DEPO_ESLESTIRME] WITH (NOLOCK)
WHERE mikro_dep_no = @depo", new { depo });
            }
            else if (!string.IsNullOrWhiteSpace(sube))
            {
                var anahtar = new string(sube.Trim().ToUpperInvariant()
                    .Replace('İ', 'I').Replace('Ş', 'S').Replace('Ğ', 'G')
                    .Replace('Ü', 'U').Replace('Ö', 'O').Replace('Ç', 'C')
                    .Where(char.IsLetterOrDigit).ToArray());

                var adlar = db.Query<string>(
                    "SELECT sube_adi FROM [HKS].[dbo].[DEPO_ESLESTIRME] WITH (NOLOCK)")
                    .ToList();

                bizimSube = adlar.FirstOrDefault(a =>
                {
                    var b = new string((a ?? "").ToUpperInvariant()
                        .Replace('İ', 'I').Replace('Ş', 'S').Replace('Ğ', 'G')
                        .Replace('Ü', 'U').Replace('Ö', 'O').Replace('Ç', 'C')
                        .Where(char.IsLetterOrDigit).ToArray());

                    return anahtar.Length > 0 && b.Contains(anahtar);
                });
            }

            if (cinsKod is not null)
            {
                var b = db.QueryFirstOrDefault(@"
SELECT TOP 1
       e.kunye         AS kunyeNo,
       e.alis_fiyati   AS alisFiyati,
       e.sube_adi      AS subeAdi,
       e.uretici       AS uretici,
       kn.BildirimTarihi AS tarih
FROM [HKS].[dbo].[ETIKETLER] e WITH (NOLOCK)
INNER JOIN [HKS].[dbo].[KUNYELER] kn WITH (NOLOCK) ON e.kunye = kn.KunyeNo
WHERE kn.MalinCinsKodNo = @cinsKod
  AND kn.BildirimTarihi >= DATEADD(DAY, -90, CAST(GETDATE() AS DATE))
  AND (@sube IS NULL OR e.sube_adi = @sube)
  AND e.kunye <> @kunyeNo
ORDER BY CASE WHEN @sube IS NOT NULL AND e.sube_adi = @sube THEN 0 ELSE 1 END,
         kn.BildirimTarihi DESC, e.create_date DESC",
                    new { cinsKod, sube = bizimSube, kunyeNo });

                if (b is not null)
                    bizim = new
                    {
                        kunyeNo = (string)b.kunyeNo,
                        alisFiyati = b.alisFiyati is null ? (decimal?)null : Convert.ToDecimal(b.alisFiyati),
                        subeAdi = (string)b.subeAdi,
                        uretici = (string)b.uretici,
                        tarih = b.tarih
                    };
            }

            decimal? rakipFiyat = rakip.alisFiyati is null ? null : Convert.ToDecimal(rakip.alisFiyati);
            decimal? bizimFiyat = bizim is null ? null : ((dynamic)bizim).alisFiyati;

            decimal? fark = rakipFiyat is not null && bizimFiyat is not null
                ? bizimFiyat - rakipFiyat : null;

            decimal? farkYuzde = fark is not null && rakipFiyat > 0
                ? Math.Round(fark.Value / rakipFiyat.Value * 100, 1) : null;

            return Ok(new
            {
                kunyeNo,
                cinsKod,
                urunAdi = CinsAdi(db, cinsKod),
                rakip = new
                {
                    isletme = (string)rakip.isletme ?? (string)rakip.subeAdi,
                    alisFiyati = rakipFiyat,
                    malinSatisFiyati = rakip.malinSatisFiyati is null
                        ? (decimal?)null : Convert.ToDecimal(rakip.malinSatisFiyati),
                    miktar = rakip.miktar,
                    birim = (string)rakip.birim,
                    uretici = (string)rakip.uretici,
                    uretimYeri = (string)rakip.uretimYeri,
                    uretimTarihi = rakip.uretimTarihi,
                    uretimSekli = (string)rakip.uretimSekli,
                    bildirimTarihi = rakip.bildirimTarihi
                },
                bizim,
                bizimSube,
                fark,
                farkYuzde,
                /* Yorumlama: pozitif fark biz pahalı alıyoruz demek */
                durum = fark is null ? "karsilastirilamadi"
                      : fark > 0 ? "biz_pahali"
                      : fark < 0 ? "biz_ucuz" : "esit"
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Künye sorgusu başarısız: {Kunye}", kunyeNo);

            /* Asıl hata mesaja gömülür: mobil ekran yalnızca 'hata' alanını
               gösterdiği için "ulaşılamadı" tek başına sebebi söylemiyordu.
               Bağlantı, yetki ve tablo/kolon hatalarının çözümü farklı. */
            var sebep = hata.GetBaseException().Message;

            return StatusCode(502, new
            {
                hata = $"HKS sorgusu başarısız: {sebep}",
                ayrinti = hata.ToString()
            });
        }
    }

    /// <summary>
    /// Künyeyi şirketin kendi künye servisinden okur ve bizim alış
    /// fiyatımızla karşılaştırır.
    ///
    /// <para>
    /// Bakanlığın sorgulama sayfası captcha istediği için doğrudan
    /// sorgulanmaz; hmzYS servisi bu işi zaten yapıyor, buradan yalnızca
    /// okunmuş veri alınır. Rakibin alış fiyatı geçmiş bildirimlerdeki
    /// MARKET sıfatlı satırdan gelir.
    /// </para>
    /// </summary>
    [HttpGet("Oku")]
    public async Task<IActionResult> Oku([FromQuery] string kunye)
    {
        var kunyeNo = KunyeAyikla(kunye);

        if (kunyeNo is null)
            return BadRequest(new { hata = "Künye numarası okunamadı." });

        var taban = (_yapilandirma["KunyeServisi:Adres"] ?? "").TrimEnd('/');

        if (taban.Length == 0)
            return StatusCode(500, new
            {
                hata = "Künye servisi tanımlı değil (KunyeServisi:Adres)."
            });

        try
        {
            var http = _istemci.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(25);

            /* hmzYS oturum belirtecini jwt çerezinde bekliyor. */
            var belirtec = (_yapilandirma["KunyeServisi:Jwt"] ?? "").Trim();

            if (belirtec.Length > 0)
                http.DefaultRequestHeaders.Add("Cookie", $"jwt={belirtec}");

            var bilgiGorev = http.GetStringAsync(
                $"{taban}/api/kunye/kunye-oku?kunyeNo={Uri.EscapeDataString(kunyeNo)}");

            var gecmisGorev = http.GetStringAsync(
                $"{taban}/api/kunye/kunye-gecmis?kunyeNo={Uri.EscapeDataString(kunyeNo)}");

            await Task.WhenAll(bilgiGorev, gecmisGorev);

            using var bilgi = System.Text.Json.JsonDocument.Parse(bilgiGorev.Result);
            using var gecmis = System.Text.Json.JsonDocument.Parse(gecmisGorev.Result);

            var k = bilgi.RootElement;

            if (k.TryGetProperty("hata", out var h)
                && h.ValueKind == System.Text.Json.JsonValueKind.String)
                return NotFound(new { hata = h.GetString() });

            string Al(string ad) =>
                k.TryGetProperty(ad, out var v)
                && v.ValueKind == System.Text.Json.JsonValueKind.String
                    ? v.GetString() : null;

            decimal? rakipFiyat = null;
            string rakipAd = null;
            var satirlar = new List<object>();

            if (gecmis.RootElement.TryGetProperty("tumKayitlar", out var dizi)
                && dizi.ValueKind == System.Text.Json.JsonValueKind.Array)
            {
                foreach (var g in dizi.EnumerateArray())
                {
                    string S(string ad) =>
                        g.TryGetProperty(ad, out var v)
                        && v.ValueKind == System.Text.Json.JsonValueKind.String
                            ? v.GetString() : null;

                    var sifat = S("KisiSifat") ?? "";
                    var ad = S("AdSoyad");
                    var fiyatMetni = (S("Fiyat") ?? "").Replace("TL", "").Trim();

                    decimal.TryParse(fiyatMetni.Replace(",", "."),
                        System.Globalization.NumberStyles.Any,
                        System.Globalization.CultureInfo.InvariantCulture,
                        out var fiyat);

                    satirlar.Add(new
                    {
                        sifat,
                        adSoyad = ad,
                        fiyat = fiyat > 0 ? fiyat : (decimal?)null
                    });

                    if (sifat.Contains("market", StringComparison.OrdinalIgnoreCase)
                        && fiyat > 0)
                    {
                        rakipFiyat = fiyat;
                        rakipAd = ad;
                    }
                }
            }

            /* Market satırı yoksa son fiyatlı satır kullanılır */
            if (rakipFiyat is null)
            {
                var sonFiyatli = satirlar.Select(x => (dynamic)x)
                    .LastOrDefault(x => x.fiyat is not null);

                if (sonFiyatli is not null)
                {
                    rakipFiyat = sonFiyatli.fiyat;
                    rakipAd = sonFiyatli.adSoyad;
                }
            }

            var malinAdi = Al("malinAdi");
            var malinCinsi = Al("malinCinsi");

            object bizim = null;
            string uyari = null;

            try
            {
                using var db = _vt.HksBaglantisi();

                var cinsKodlari = CinsKodlariBul(db, malinAdi, malinCinsi);

                if (cinsKodlari.Count == 0)
                    uyari = $"{malinAdi} için kendi künye kayıtlarımızda "
                          + "eşleşme bulunamadı; bu ürünü hiç almamış olabiliriz.";
                else
                {
                    var b = db.QueryFirstOrDefault(@"
SELECT TOP 1 e.kunye AS kunyeNo, e.alis_fiyati AS alisFiyati,
       e.sube_adi AS subeAdi, e.uretici AS uretici, kn.BildirimTarihi AS tarih
FROM [HKS].[dbo].[ETIKETLER] e WITH (NOLOCK)
INNER JOIN [HKS].[dbo].[KUNYELER] kn WITH (NOLOCK) ON e.kunye = kn.KunyeNo
WHERE kn.MalinCinsKodNo IN @cinsKodlari
  AND kn.BildirimTarihi >= DATEADD(DAY, -90, CAST(GETDATE() AS DATE))
  AND e.alis_fiyati IS NOT NULL AND e.alis_fiyati > 0
ORDER BY kn.BildirimTarihi DESC, e.create_date DESC", new { cinsKodlari });

                    if (b is null)
                        uyari = "Bu üründe son 90 günde bizim alışımız yok.";
                    else
                        bizim = new
                        {
                            kunyeNo = (string)b.kunyeNo,
                            alisFiyati = Convert.ToDecimal(b.alisFiyati),
                            subeAdi = (string)b.subeAdi,
                            uretici = (string)b.uretici,
                            tarih = b.tarih
                        };
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Bizim fiyat bulunamadı: {Kunye}", kunyeNo);
                uyari = "Bizim HKS verisine ulaşılamadı: " + hata.GetBaseException().Message;
            }

            decimal? bizimFiyat = bizim is null ? null : ((dynamic)bizim).alisFiyati;

            decimal? fark = rakipFiyat is not null && bizimFiyat is not null
                ? bizimFiyat - rakipFiyat : null;

            decimal? farkYuzde = fark is not null && rakipFiyat > 0
                ? Math.Round(fark.Value / rakipFiyat.Value * 100, 1) : null;

            return Ok(new
            {
                kunyeNo,
                urunAdi = string.Join(" / ", new[] { malinAdi, malinCinsi }
                    .Where(x => !string.IsNullOrWhiteSpace(x))),
                rakip = new
                {
                    isletme = rakipAd,
                    alisFiyati = rakipFiyat,
                    uretici = Al("uretici"),
                    uretimYeri = Al("uretimYeri"),
                    uretimTarihi = Al("uretimTarihi"),
                    uretimSekli = Al("malinTuru"),
                    gidecekYer = Al("gidecekYer"),
                    subeAdi = Al("subeAdi")
                },
                gecmis = satirlar,
                bizim,
                uyari,
                fark,
                farkYuzde,
                durum = fark is null ? "karsilastirilamadi"
                      : fark > 0 ? "biz_pahali"
                      : fark < 0 ? "biz_ucuz" : "esit"
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Künye servisi başarısız: {Kunye}", kunyeNo);

            var mesaj = hata.GetBaseException().Message;

            if (mesaj.Contains("401"))
                mesaj = "Künye servisi yetki reddetti. KunyeServisi:Jwt ayarındaki "
                      + "belirteç eksik ya da süresi dolmuş olabilir.";

            return StatusCode(502, new { hata = "Künye sorgusu başarısız: " + mesaj });
        }
    }

    /// <summary>
    /// Ürün adı ve cinsinden cins kodlarını bulur.
    ///
    /// <para>
    /// KUNYELER tablosunda MalinAdi, MalinCinsi ve MalinCinsKodNo yan yana
    /// duruyor; ayrı bir ürün tablosuna gerek yok. Eşleştirme kademeli:
    /// önce ad + cins, sonra yalnızca ad. İkinci adım gerekli, çünkü
    /// künyede "SALATALIK / DİĞER" yazarken bizde aynı ürün başka cinsle
    /// kayıtlı olabiliyor; ürün aynı olduğu sürece fiyat karşılaştırması
    /// anlamını koruyor.
    /// </para>
    /// </summary>
    private List<int> CinsKodlariBul(System.Data.IDbConnection db,
                                     string malinAdi, string malinCinsi)
    {
        var sonuc = new List<int>();

        if (string.IsNullOrWhiteSpace(malinAdi)) return sonuc;

        try
        {
            var ad = malinAdi.Trim();
            var cins = (malinCinsi ?? "").Trim();

            if (cins.Length > 0)
            {
                sonuc = db.Query<int>(@"
SELECT DISTINCT MalinCinsKodNo
FROM [HKS].[dbo].[KUNYELER] WITH (NOLOCK)
WHERE MalinAdi = @ad AND MalinCinsi = @cins
  AND MalinCinsKodNo IS NOT NULL", new { ad, cins }).ToList();

                if (sonuc.Count > 0) return sonuc;
            }

            /* Cins tutmadı: aynı ürünün tüm cinsleri alınır */
            return db.Query<int>(@"
SELECT DISTINCT MalinCinsKodNo
FROM [HKS].[dbo].[KUNYELER] WITH (NOLOCK)
WHERE MalinAdi = @ad AND MalinCinsKodNo IS NOT NULL",
                new { ad }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Cins kodu bulunamadı: {Ad}", malinAdi);
            return sonuc;
        }
    }

    /// <summary>Okutmayı kaydeder; panel raporu buradan beslenir.</summary>
    [HttpPost("Kaydet")]
    public IActionResult Kaydet([FromBody] KunyeAnalizGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.KunyeNo))
            return BadRequest(new { hata = "Künye numarası gereklidir." });

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_KUNYE_ANALIZ
    (kunye_no, cins_kod, urun_adi, uretici, uretim_yeri,
     rakip_isletme, rakip_fiyat, bizim_fiyat, bizim_kunye, bizim_tarih,
     fark, fark_yuzde, sube_adi, mikro_dep_no, personel_kodu, personel_adi,
     not_metni)
OUTPUT INSERTED.id
VALUES (@kunyeNo, @cinsKod, @urunAdi, @uretici, @uretimYeri,
        @rakipIsletme, @rakipFiyat, @bizimFiyat, @bizimKunye, @bizimTarih,
        @fark, @farkYuzde, @subeAdi, @depo, @personelKodu, @personelAdi,
        @notMetni)",
            new
            {
                kunyeNo = Kirp(girdi.KunyeNo, 40),
                cinsKod = girdi.CinsKod,
                /* Kırpma güvenlik ağı: sütunlar genişletildi ama sunucudaki
                   tablo eski hâlindeyse kayıt yine de geçsin. */
                urunAdi = Kirp(girdi.UrunAdi, 200),
                uretici = Kirp(girdi.Uretici, 200),
                uretimYeri = Kirp(girdi.UretimYeri, 200),
                rakipIsletme = Kirp(girdi.RakipIsletme, 250),
                rakipFiyat = girdi.RakipFiyat,
                bizimFiyat = girdi.BizimFiyat,
                bizimKunye = Kirp(girdi.BizimKunye, 40),
                bizimTarih = girdi.BizimTarih,
                fark = girdi.Fark,
                farkYuzde = girdi.FarkYuzde,
                subeAdi = Kirp(girdi.SubeAdi, 120),
                depo = girdi.Depo,
                /* Okutan kişi jetondan alınır; istemcinin gönderdiği
                   değer kullanılmaz. */
                personelKodu = Kirp(OkutanKodu, 30),
                personelAdi = Kirp(girdi.PersonelAdi ?? OkutanAdi(OkutanKodu), 120),
                notMetni = Kirp(girdi.NotMetni, 500)
            });

        return Ok(new { id, tamam = true });
    }

    /// <summary>Panel raporu: okutmalar, süzülebilir.</summary>
    [HttpGet("Rapor")]
    public IActionResult Rapor([FromQuery] DateTime? bas, [FromQuery] DateTime? bit,
                               [FromQuery] string sube = null)
    {
        var baslangic = (bas ?? DateTime.Today.AddDays(-30)).Date;
        var bitis = (bit ?? DateTime.Today).Date.AddDays(1);

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, kunye_no AS kunyeNo, cins_kod AS cinsKod, urun_adi AS urunAdi,
       uretici, uretim_yeri AS uretimYeri, rakip_isletme AS rakipIsletme,
       rakip_fiyat AS rakipFiyat, bizim_fiyat AS bizimFiyat,
       bizim_kunye AS bizimKunye, bizim_tarih AS bizimTarih,
       fark, fark_yuzde AS farkYuzde, sube_adi AS subeAdi,
       personel_adi AS personelAdi, not_metni AS notMetni, olusturma
FROM KRY_KUNYE_ANALIZ
WHERE olusturma >= @bas AND olusturma < @bit
  AND (@sube IS NULL OR sube_adi = @sube)
ORDER BY olusturma DESC",
            new { bas = baslangic, bit = bitis, sube }).ToList();

        /* Ürün bazında özet: hangi üründe kaç okutma, ortalama fark */
        var urunler = kayitlar
            .Where(x => x.fark is not null)
            .GroupBy(x => (string)x.urunAdi ?? "Bilinmiyor")
            .Select(g => new
            {
                urun = g.Key,
                adet = g.Count(),
                ortalamaFark = Math.Round(g.Average(x => (decimal)x.fark), 2),
                pahaliSayisi = g.Count(x => (decimal)x.fark > 0)
            })
            .OrderByDescending(x => x.ortalamaFark)
            .ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            toplam = kayitlar.Count,
            karsilastirilan = kayitlar.Count(x => x.fark is not null),
            pahaliAldigimiz = kayitlar.Count(x => x.fark is not null && (decimal)x.fark > 0),
            kayitlar,
            urunler
        });
    }

    /// <summary>Metni sütun boyuna göre kırpar; null güvenli.</summary>
    private static string Kirp(string metin, int enFazla)
    {
        if (string.IsNullOrWhiteSpace(metin)) return null;

        var t = metin.Trim();

        return t.Length <= enFazla ? t : t[..enFazla];
    }

    /// <summary>
    /// Karekod metninden künye numarasını ayıklar. Karekod doğrudan
    /// numarayı taşıyor; yine de içine adres gömülmüşse rakam dizisi alınır.
    /// </summary>
    private static string KunyeAyikla(string ham)
    {
        var metin = (ham ?? "").Trim();

        if (metin.Length == 0) return null;

        /* En uzun rakam dizisi künye numarasıdır */
        var parcalar = System.Text.RegularExpressions.Regex.Matches(metin, @"\d{6,}")
            .Select(m => m.Value)
            .OrderByDescending(x => x.Length)
            .ToList();

        return parcalar.FirstOrDefault() ?? metin;
    }

    /// <summary>Cins kodundan ürün adı; KUNYELER tablosundan.</summary>
    private static string CinsAdi(System.Data.IDbConnection db, int? cinsKod)
    {
        if (cinsKod is null) return null;

        try
        {
            return db.ExecuteScalar<string>(@"
SELECT TOP 1 MalinAdi + ' / ' + MalinCinsi
FROM [HKS].[dbo].[KUNYELER] WITH (NOLOCK)
WHERE MalinCinsKodNo = @cinsKod AND MalinAdi IS NOT NULL
ORDER BY BildirimTarihi DESC", new { cinsKod });
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>Künye analizi kaydı</summary>
public class KunyeAnalizGirdi
{
    public string KunyeNo { get; set; }
    public int? CinsKod { get; set; }
    public string UrunAdi { get; set; }
    public string Uretici { get; set; }
    public string UretimYeri { get; set; }
    public string RakipIsletme { get; set; }
    public decimal? RakipFiyat { get; set; }
    public decimal? BizimFiyat { get; set; }
    public string BizimKunye { get; set; }
    public DateTime? BizimTarih { get; set; }
    public decimal? Fark { get; set; }
    public decimal? FarkYuzde { get; set; }
    public string SubeAdi { get; set; }
    public int? Depo { get; set; }
    public string PersonelKodu { get; set; }
    public string PersonelAdi { get; set; }
    public string NotMetni { get; set; }
}

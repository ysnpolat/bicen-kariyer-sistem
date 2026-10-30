using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel performans değerlendirmeleri.
///
/// <para>
/// Puanlar bu sistemde hesaplanmaz: <c>biDb</c> veritabanında
/// <c>PD_Rapor</c> saklı yordamı her dönem çalıştırılıp sonuçlar
/// <c>Personel_Degerlendirme_Sonuclari</c> tablosuna yazılıyor. Burada
/// yalnızca okunup gösterilir. Hesabı burada yeniden yazmak iki sistemin
/// farklı puan üretmesine yol açardı.
/// </para>
///
/// <para>
/// Eşleştirme <c>per_erp_id</c> üzerinden yapılır: bu alan Mikro'daki
/// <c>per_Guid</c> ile aynıdır ve benzersizdir. Ad benzerliğine
/// dayanılmaz; aynı adda iki kişi olduğunda yanlış kişinin performansı
/// görünürdü.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PerformansController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PerformansController> _kayit;

    public PerformansController(
        VeritabaniServisi vt, ILogger<PerformansController> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>
    /// Mağaza ölçütleri. Sıralama ekranda göründüğü sıradır.
    /// Sütun adları boşluklu olduğu için köşeli parantezle okunur.
    /// </summary>
    private static readonly string[] MagazaOlcutleri =
    {
        "CİRO", "KARLILIK", "MÜŞTERİ SAYISI", "KİŞİ BAŞI CİRO",
        "TURNOVER", "ÜRÜN YOK SATMA", "GİDER ORANI", "İADE",
        "FİYAT FARKLARI", "KALİTE & HİJYEN",
        "ET FİRE", "BEYAZ ET FİRE", "MANAV FİRE", "TADOLYA FİRE",
        "KASA AÇIKLARI", "MAL KABUL HATASI",
        /* Tabloda ayrı iki sütun; birleşik ad kullanmak sorgunun
           tamamını düşürüyordu. Eski birleşik ad da listede tutulur,
           çünkü var olan sütunlarla kesiştirme yapılıyor. */
        "FİŞ İPTAL SAYILARI", "SATIR İPTAL SAYILARI",
        "FİŞ & SATIR İPTAL SAYILARI"
    };

    /// <summary>Yetkinlik ölçütleri (360 derece değerlendirmeden gelir).</summary>
    private static readonly string[] YetkinlikOlcutleri =
    {
        "ETKİLİ İLETİŞİM", "İŞİNİ SÜREKLİ GELİŞTİRME", "KENDİNİ GELİŞTİRME",
        "KURUM KÜLTÜRÜNÜ BENİMSEME -  SAHİPLENME",
        "LİDERLİK - İNSANLARI GELİŞTİRME", "MÜŞTERİ DUYARLILIĞI",
        "PLANLAMA ZAMANI İYİ YÖNETME", "SORUMLULUK ALMA VE TAKİP",
        "TAKIM ÇALIŞMASI", "YENİLİK VE YARATICILIK - İŞİNİ ÖNEMSEME"
    };

    /// <summary>Tabloda gerçekten bulunan ölçüt sütunları (bir kez okunur).</summary>
    private static string[] _mevcutSutunlar;

    /// <summary>
    /// Ölçüt sütunlarını tablodaki gerçek sütunlarla kesiştirir.
    ///
    /// <para>
    /// Sütun adları kurulumdan kuruluma değişebiliyor: "FİŞ İPTAL
    /// SAYILARI" bazı sürümlerde ayrı, bazılarında birleşik. Var olmayan
    /// tek bir sütun sorgunun tamamını düşürdüğü ve tüm ölçütler birden
    /// kaybolduğu için, listeden yalnızca mevcut olanlar seçilir.
    /// </para>
    /// </summary>
    private string[] MevcutOlcutler(System.Data.IDbConnection db)
    {
        if (_mevcutSutunlar is not null) return _mevcutSutunlar;

        try
        {
            var tablodakiler = db.Query<string>(@"
SELECT COLUMN_NAME
FROM [biDb].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Personel_Degerlendirme_Sonuclari'")
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            _mevcutSutunlar = MagazaOlcutleri.Concat(YetkinlikOlcutleri)
                .Where(x => tablodakiler.Contains(x))
                .ToArray();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ölçüt sütunları okunamadı");

            /* Şema okunamazsa eski davranış: hepsi denenir */
            _mevcutSutunlar = MagazaOlcutleri.Concat(YetkinlikOlcutleri).ToArray();
        }

        return _mevcutSutunlar;
    }

    private string Sutunlar(System.Data.IDbConnection db) =>
        string.Join(",\n       ", MevcutOlcutler(db).Select(x => $"[{x}]"));

    /// <summary>
    /// Bir personelin dönem dönem performansı.
    /// <paramref name="guid"/> Mikro'daki per_Guid değeridir.
    /// </summary>
    [HttpGet("Personel")]
    public IActionResult Personel(
        [FromQuery] Guid? guid,
        [FromQuery] string kimlik = null,
        [FromQuery] int? perId = null,
        [FromQuery] int? yil = null,
        [FromQuery] int? ay = null)
    {
        if (guid is null && string.IsNullOrWhiteSpace(kimlik) && perId is null)
            return BadRequest(new { hata = "Personel belirtiniz." });

        try
        {
            using var db = _vt.PerformansBaglantisi();

            /* Kişi önce ERP kimliğiyle aranır; boşsa TC kimliğe düşülür.
               Bazı eski kayıtlarda erp_id boş kalmış olabiliyor. */
            /* perId doğrudan verilmişse arama yapılmaz: performans
               listesinden gelen kayıtlar zaten bu kimliği taşıyor. */
            var kisiId = perId ?? db.ExecuteScalar<int?>(@"
SELECT TOP 1 per_id FROM [biDb].[dbo].Personel
WHERE (@guid IS NOT NULL AND per_erp_id = @guid)
   OR (@kimlik IS NOT NULL AND per_tckimlik_no = @kimlik)
ORDER BY CASE WHEN per_erp_id = @guid THEN 0 ELSE 1 END",
                new
                {
                    guid = guid?.ToString(),
                    kimlik = string.IsNullOrWhiteSpace(kimlik) ? null : kimlik.Trim()
                });

            if (kisiId is null)
                return Ok(new { bulundu = false, donemler = new List<object>() });

            var donemler = db.Query($@"
SELECT yil, ay,
       [MAĞAZA PERFORMANSI]        AS magazaToplam,
       [YETKİNLİK ÖLÇÜTLERİ TOPLAMI] AS yetkinlikToplam,
       gorev_adi                   AS gorevAdi,
       sube_adi                    AS subeAdi,
       gorev_sirasi                AS gorevSirasi,
       sirket_sirasi               AS sirketSirasi,
       {Sutunlar(db)}
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE per_id = @kisiId
  AND (@yil IS NULL OR yil = @yil)
  AND (@ay  IS NULL OR ay  = @ay)
ORDER BY yil DESC, ay DESC", new { kisiId, yil, ay }).ToList();

            /* Kişinin kimlik ve ERP bilgisi: panel bununla Mikro'daki
               fotoğrafı ve personel kartını açabiliyor. */
            var kisi = db.QueryFirstOrDefault(@"
SELECT TOP 1 per_kod        AS personelKodu,
       per_erp_id           AS guid,
       per_tckimlik_no      AS kimlikNo,
       per_cep_telefon      AS telefon,
       per_ise_giris_tarihi AS girisTarihi,
       per_isten_cikis_tarihi AS cikisTarihi
FROM [biDb].[dbo].Personel WHERE per_id = @kisiId", new { kisiId });

            /* Referans puan ve şirket ortalaması: en yeni dönem için
               hesaplanır. Personel "0" gördüğünde neyi kaçırdığını ve
               şirketin nerede olduğunu görmeli. */
            var referanslar = new Dictionary<string, decimal?>();
            var ortalamalar = new Dictionary<string, decimal?>();

            var sonDonem = donemler.FirstOrDefault();

            if (sonDonem is not null)
            {
                try
                {
                    var olcutler = MevcutOlcutler(db);

                    var secim = string.Join(", ", olcutler
                        .Select(x => $"MAX([{x}]) AS [max_{x}], AVG([{x}]) AS [ort_{x}]"));

                    var ozet = db.QueryFirstOrDefault($@"
SELECT {secim}
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay AND gorev_adi = @gorev",
                        /* Referans aynı görevden: ölçüt puanları pozisyona göre değişiyor */
                        new { yil = (int)sonDonem.yil, ay = (int)sonDonem.ay, gorev = (string)sonDonem.gorevAdi })
                        as IDictionary<string, object>;

                    if (ozet is not null)
                    {
                        foreach (var ad in olcutler)
                        {
                            decimal? Al(string on)
                                => ozet.TryGetValue(on + ad, out var v) && v is not null
                                   && decimal.TryParse(v.ToString(), out var d)
                                    ? Math.Round(d, 1) : null;

                            referanslar[ad] = Al("max_");
                            ortalamalar[ad] = Al("ort_");
                        }
                    }
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Referans puanlar hesaplanamadı");
                }
            }

            /* Pozisyona göre ölçütler ve eski sayfadaki gibi değer/eşik satırları
               (24.10.2026). Tablo her ölçüt sütununu herkese yazıyor; kasap
               şefi yetkinlik ve müşteri sayısı gibi ölçütleri görmemeli. */
            var olcutServisi = HttpContext.RequestServices.GetRequiredService<PerformansOlcutServisi>();
            var mevcut = MevcutOlcutler(db);
            var ayrinti = new Dictionary<string, object>();
            foreach (var d in donemler.Take(24))
            {
                var satir = (IDictionary<string, object>)d;
                int dy = (int)d.yil, da = (int)d.ay;
                var gorevde = olcutServisi.GorevOlcutleri(db, (string)d.gorevAdi, mevcut);
                bool Dolu(string o) => satir.TryGetValue(o, out var v) && v is not null && v.ToString() != "";
                bool Uygun(string o) => Dolu(o) && (gorevde is null || gorevde.Contains(o)
                    || (satir.TryGetValue(o, out var v) && decimal.TryParse(v?.ToString(), out var pv) && pv > 0));
                var magaza = MagazaOlcutleri.Where(mevcut.Contains).Where(Uygun).ToList();
                var yetkinlik = YetkinlikOlcutleri.Where(mevcut.Contains).Where(Uygun).ToList();

                var degerler = olcutServisi.Degerler(db, (string)d.subeAdi, dy, da, (string)d.gorevAdi);
                var sinirlar = olcutServisi.PuanSinirlari(db, dy, da, (string)d.gorevAdi);
                var satirlar = new Dictionary<string, object>();
                foreach (var o in magaza)
                {
                    degerler.TryGetValue(o, out var mv);
                    sinirlar.TryGetValue(o, out var sn);
                    decimal.TryParse(satir[o]?.ToString(), out var puan);
                    var (esik, esikAd, neden) = PerformansOlcutServisi.Aciklama(o, puan, mv, sn);
                    satirlar[o] = new { deger = mv?.Sen, esik, esikAd, yon = PerformansOlcutServisi.Yon(o), neden,
                        sirketOrt = mv?.EsikAd == "Şirket ort." ? mv?.Esik : null };
                }

                ayrinti[$"{dy}-{da}"] = new
                {
                    magaza, yetkinlik, satirlar,
                    /* Tek bölüm uygulanıyorsa ortalamanın tamamı odur */
                    magazaAgirlik = yetkinlik.Count == 0 && magaza.Count > 0 ? 100 : (int?)null,
                    yetkinlikAgirlik = magaza.Count == 0 && yetkinlik.Count > 0 ? 100 : (int?)null,
                };
            }

            return Ok(new
            {
                bulundu = true,
                kisi,
                referanslar,
                ortalamalar,
                ayrinti,
                /* Panel bu listeye göre satır çiziyor; tabloda olmayan
                   ölçüt gönderilirse boş satır oluşuyordu. */
                magazaOlcutleri = MagazaOlcutleri
                    .Where(x => MevcutOlcutler(db).Contains(x)),
                yetkinlikOlcutleri = YetkinlikOlcutleri
                    .Where(x => MevcutOlcutler(db).Contains(x)),
                donemler
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Performans okunamadı");

            return Ok(new
            {
                bulundu = false,
                hata = "Performans verisine ulaşılamadı.",
                ayrinti = hata.Message,
                donemler = new List<object>()
            });
        }
    }

    /// <summary>
    /// Prim hak edişi.
    ///
    /// <para>
    /// Mağaza performans puanına göre ücretin bir yüzdesi prim olur:
    /// 60-70 arası %3, 70-80 %5, 80-90 %7, 90 ve üstü %10. Altmışın
    /// altında prim yoktur.
    /// </para>
    ///
    /// <para>
    /// Puanlar biDb'de, ücretler Mikro'da olduğu için iki ayrı sorgu
    /// çalıştırılıp bellekte birleştirilir. Kaynak yordam bunu OPENROWSET
    /// ile yapıyordu; iki bağlantımız zaten var, dağıtık sorguya gerek yok.
    /// </para>
    /// </summary>
    [HttpGet("Hakedis")]
    public IActionResult Hakedis([FromQuery] int? yil = null, [FromQuery] int? ay = null,
        [FromServices] PersonelKaynagiServisi personelKaynak = null,
        [FromServices] YetkiServisi yetkiServisi = null)
    {
        var rol = User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
        var ucretGizli = yetkiServisi?.Gizli(rol, YetkiServisi.Ucret) == true;
        var kimlikGizli = yetkiServisi?.Gizli(rol, YetkiServisi.Kimlik) == true;

        try
        {
            using var db = _vt.PerformansBaglantisi();

            var seciliYil = yil ?? DateTime.Today.Year;

            var seciliAy = ay ?? db.ExecuteScalar<int?>(@"
SELECT MAX(ay) FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil", new { yil = seciliYil });

            if (seciliAy is null)
                return Ok(new { yil = seciliYil, kayitlar = new List<object>() });

            /* Değerlendirme puanları. Merkez büro dışarıda; yalnızca bölge
               müdürleri istisna. Depolar da hariç. */
            var puanlar = db.Query(@"
SELECT p2.per_tckimlik_no                AS kimlik,
       p1.per_adi + ' ' + p1.per_soyadi  AS adSoyad,
       p1.gorev_adi                      AS gorevAdi,
       p1.sube_adi                       AS subeAdi,
       ISNULL(p1.[MAĞAZA PERFORMANSI], 0) AS puan
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE p1.yil = @yil AND p1.ay = @ay
  AND (p1.sube_adi <> N'Z.MERKEZ BURO' OR p1.gorev_adi LIKE N'BÖLGE MÜDÜRÜ%')
  AND p1.sube_adi NOT IN (N'MERKEZDEPO KIRAC', N'HALDEPO KIRAC')
  AND p2.per_tckimlik_no IS NOT NULL
  AND ISNULL(p1.[MAĞAZA PERFORMANSI], 0) >= 60",
                new { yil = seciliYil, ay = seciliAy }).ToList();

            if (puanlar.Count == 0)
                return Ok(new { yil = seciliYil, ay = seciliAy, kayitlar = new List<object>() });

            /* Ücretler Mikro'dan. Belirli ünvanlarda sabit taban kullanılır
               (kaynak yordamdaki kural birebir korundu). */
            var ucretler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            var ayrilanlar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var cikislar = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);
            /* Ücretle aynı anahtar (per_sicil_no) → personel kodu. Ayrılan
               personelde Per_TcKimlikNo boş olabiliyor; kart eşleşmesi bu
               yüzden bulunamıyordu (21.10.2026). */
            var mikroKod = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                using var mikro = _vt.PersonelBaglantisi();

                /* Ayrılan personel de alınır: değerlendirme döneminde
                   çalışmışsa primi hak etmiştir. Önceki süzgeç yalnızca
                   aktifleri alıyordu ve ayrılanların tutarı
                   "hesaplanamadı" görünüyordu.

                   Sıralama, aynı sicille birden çok kayıt olması hâlinde
                   (işten ayrılıp geri dönenler) aktif kaydın en son
                   yazılmasını ve öncekini ezmesini sağlar. */
                foreach (var u in mikro.Query(@"
SELECT LTRIM(RTRIM(per_sicil_no)) AS sicil,
       CASE WHEN per_unvan_kodu IN (9, 8, 7, 83) THEN 70000
            ELSE ISNULL(per_ucret, 0) END AS ucret,
       CASE WHEN YEAR(per_cikis_tar) <= 1950 OR per_cikis_tar IS NULL
            THEN 1 ELSE 0 END AS aktif,
       per_cikis_tar AS cikis,
       LTRIM(RTRIM(per_kod)) AS kod
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE (per_ucret <> 1 OR per_unvan_kodu IN (9, 8, 7, 83))
ORDER BY CASE WHEN YEAR(per_cikis_tar) <= 1950 OR per_cikis_tar IS NULL
              THEN 1 ELSE 0 END, per_cikis_tar",
                    commandTimeout: 60))
                {
                    var sicil = (string)u.sicil;

                    if (string.IsNullOrWhiteSpace(sicil)) continue;

                    ucretler[sicil] = (decimal)u.ucret;
                    if (!string.IsNullOrWhiteSpace((string)u.kod)) mikroKod[sicil] = (string)u.kod;

                    /* Aktif kayıt sonra geldiği için işareti temizler */
                    if ((int)u.aktif == 1) { ayrilanlar.Remove(sicil); cikislar.Remove(sicil); }
                    else
                    {
                        ayrilanlar.Add(sicil);
                        if (u.cikis is DateTime ct) cikislar[sicil] = ct.Date;
                    }
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Hak ediş için ücretler okunamadı");

                return Ok(new
                {
                    hata = "Ücret bilgisine ulaşılamadı.",
                    ayrinti = hata.Message,
                    kayitlar = new List<object>()
                });
            }

            /* TC → sicil → Biçen Kart (21.10.2026): Excel'de ve Biçen Kart'a
               prim yüklemede kullanılır. Okunamazsa liste yine döner. */
            var tcSicil = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var sicilKart = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                if (personelKaynak is not null)
                    foreach (var k in personelKaynak.TumPersonelleriGetir()
                                 .Where(x => !string.IsNullOrWhiteSpace(x.KimlikNo) && !string.IsNullOrWhiteSpace(x.PersonelKodu))
                                 .OrderBy(x => x.Durum == 1 && !(x.CikisTarihi is DateTime c && c.Date <= DateTime.Today)))
                        tcSicil[k.KimlikNo.Trim()] = k.PersonelKodu.Trim();

                using var kdb = _vt.Baglanti();

                /* Önce ayrılan bağlantılarındaki kart (eşleşme silinmiş olabilir),
                   sonra güncel eşleşme üzerine yazar */
                foreach (var e in kdb.Query(@"
SELECT personel_kodu AS sicil, kart_no AS kartNo FROM KRY_KART_AYRILAN_BAGLANTI
WHERE kart_no IS NOT NULL AND birakildi IS NULL ORDER BY id"))
                {
                    var s = ((string)e.sicil ?? "").Trim();
                    if (s.Length > 0 && !string.IsNullOrWhiteSpace((string)e.kartNo)) sicilKart[s] = ((string)e.kartNo).Trim();
                }

                foreach (var e in kdb.Query("SELECT personel_kodu AS sicil, kart_no AS kartNo FROM KRY_KART_ESLESME"))
                {
                    var s = ((string)e.sicil ?? "").Trim();
                    if (s.Length > 0 && !string.IsNullOrWhiteSpace((string)e.kartNo)) sicilKart[s] = ((string)e.kartNo).Trim();
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Hak ediş: sicil / kart eşleşmesi okunamadı");
            }

            var kayitlar = puanlar
                .Select(p =>
                {
                    var puan = (decimal)p.puan;

                    var yuzde = puan >= 90 ? 0.10m
                              : puan >= 80 ? 0.07m
                              : puan >= 70 ? 0.05m
                              : 0.03m;

                    var aralik = puan >= 90 ? "90-100"
                               : puan >= 80 ? "80-90"
                               : puan >= 70 ? "70-80"
                               : "60-70";

                    var kimlik = ((string)p.kimlik ?? "").Trim();

                    var ucret = ucretler.GetValueOrDefault(kimlik);
                    var sicil = mikroKod.GetValueOrDefault(kimlik) ?? tcSicil.GetValueOrDefault(kimlik);
                    var kartNo = sicil is null ? null : sicilKart.GetValueOrDefault(sicil);

                    return new
                    {
                        kimlik = kimlikGizli && kimlik.Length > 4 ? new string('•', kimlik.Length - 4) + kimlik[^4..] : kimlik,
                        sicil,
                        kartNo,
                        adSoyad = (string)p.adSoyad,
                        gorevAdi = (string)p.gorevAdi,
                        subeAdi = (string)p.subeAdi,
                        puan,
                        yuzde,
                        aralik,
                        ucret = ucretGizli ? 0m : ucret,
                        ayrildi = ayrilanlar.Contains(kimlik),
                        cikisTarihi = cikislar.TryGetValue(kimlik, out var ctar) ? ctar : (DateTime?)null,
                        /* Ücreti bulunamayan kişi için tutar hesaplanmaz:
                           sıfır göstermek "prim yok" gibi okunur, oysa
                           eksik olan ücret bilgisi. */
                        tutar = ucret > 0 ? Math.Round(ucret * yuzde, 0) : (decimal?)null
                    };
                })
                .OrderBy(x => x.subeAdi)
                .ThenByDescending(x => x.puan)
                .ToList();

            return Ok(new
            {
                yil = seciliYil,
                ay = seciliAy,
                toplam = kayitlar.Sum(x => x.tutar ?? 0),
                ucretsiz = kayitlar.Count(x => x.tutar is null),
                kayitlar
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Hak ediş okunamadı");

            return Ok(new
            {
                hata = "Hak ediş verisine ulaşılamadı.",
                ayrinti = hata.Message,
                kayitlar = new List<object>()
            });
        }
    }

    /// <summary>
    /// Büyüme oranları: şubelerin bir önceki yıla göre büyümesi.
    ///
    /// <para>
    /// Her ölçüt için şubenin büyümesi genel ortalamayla karşılaştırılır;
    /// üstündeyse iyi, altındaysa kötü sayılır. Karşılaştırmayı panel
    /// yapar — kaynak yordam renkleri HTML olarak gömüyordu, veri ile
    /// sunumu ayırmak daha sağlam.
    /// </para>
    /// </summary>
    [HttpGet("Buyume")]
    public IActionResult Buyume([FromQuery] int? yil = null, [FromQuery] int? ay = null)
    {
        try
        {
            using var db = _vt.PerformansBaglantisi();

            var seciliYil = yil ?? DateTime.Today.Year;

            /* Ay verilmezse veri girilmiş en son ay alınır */
            /* Ay verilmezse içinde bulunulan ay denenir; o ayın verisi
               yoksa veri girilmiş en son aya düşülür. Yıl sonu ayının
               açılması kullanıcıyı her seferinde ay seçmeye zorluyordu. */
            var seciliAy = ay
                ?? db.ExecuteScalar<int?>(@"
SELECT Tarih FROM [biDb].[dbo].Magaza_Performans_Ciro
WHERE Yil = @yil AND Tarih = @buAy AND sube_ciro_buyume IS NOT NULL
GROUP BY Tarih", new { yil = seciliYil, buAy = DateTime.Today.Month })
                ?? db.ExecuteScalar<int?>(@"
SELECT MAX(Tarih) FROM [biDb].[dbo].Magaza_Performans_Ciro
WHERE Yil = @yil AND sube_ciro_buyume IS NOT NULL", new { yil = seciliYil });

            if (seciliAy is null)
                return Ok(new { yil = seciliYil, satirlar = new List<object>() });

            var satirlar = db.Query(@"
SELECT c.sube_adi                       AS subeAdi,
       c.Tarih                          AS ay,

       /* Müşteri sayısı Diger tablosunda, ciro ve ürün grubu kırılımları
          Ciro tablosunda tutuluyor. */
       d.musteri_sayisi_buyume          AS musteri,
       d.musteri_sayisi_buyume_genel    AS musteriGenel,

       c.sube_ciro_buyume               AS ciro,
       c.genel_ciro_buyume              AS ciroGenel,

       c.sube_kar_buyume                AS kar,
       c.genel_kar_buyume               AS karGenel,

       c.et_ciro_buyume                 AS etCiro,
       c.et_ciro_genel_buyume           AS etCiroGenel,

       c.sube_et_kar_tl_buyume          AS etKar,
       c.genel_et_kar_tl_buyume         AS etKarGenel,

       c.sarkuteri_ciro_buyume          AS sarkuteriCiro,
       c.sarkuteri_ciro_genel_buyume    AS sarkuteriCiroGenel,

       c.sube_sarkuteri_kar_tl_buyume   AS sarkuteriKar,
       c.genel_sarkuteri_kar_tl_buyume  AS sarkuteriKarGenel,

       c.manav_ciro_buyume              AS manavCiro,
       c.manav_ciro_genel_buyume        AS manavCiroGenel,

       c.sube_manav_kar_tl_buyume       AS manavKar,
       c.genel_manav_kar_tl_buyume      AS manavKarGenel,

       c.tadolya_ciro_buyume            AS tadolyaCiro,
       c.tadolya_ciro_genel_buyume      AS tadolyaCiroGenel,

       c.sube_tadolya_kar_tl_buyume     AS tadolyaKar,
       c.genel_tadolya_kar_tl_buyume    AS tadolyaKarGenel
FROM [biDb].[dbo].Magaza_Performans_Ciro c
INNER JOIN [biDb].[dbo].Magaza_Performans_Diger d
        ON c.sube_id = d.sube_id AND c.Yil = d.Yil AND c.Tarih = d.Tarih
WHERE c.Yil = @yil AND c.Tarih = @ay
  AND c.sube_ciro_buyume IS NOT NULL
ORDER BY c.sube_adi",
                new { yil = seciliYil, ay = seciliAy }).ToList();

            /* Seçilebilecek aylar */
            var aylar = db.Query<int>(@"
SELECT DISTINCT Tarih FROM [biDb].[dbo].Magaza_Performans_Ciro
WHERE Yil = @yil AND sube_ciro_buyume IS NOT NULL
ORDER BY Tarih DESC", new { yil = seciliYil }).ToList();

            var yillar = db.Query<int>(@"
SELECT DISTINCT Yil FROM [biDb].[dbo].Magaza_Performans_Ciro
WHERE sube_ciro_buyume IS NOT NULL
ORDER BY Yil DESC").ToList();

            return Ok(new { yil = seciliYil, ay = seciliAy, satirlar, aylar, yillar });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Büyüme oranları okunamadı");

            /* Gerçek hata mesajı da döner: 'bağlantı tanımlı olmayabilir'
               gibi genel bir metin, kolon adı yanlışlığını ya da yetki
               eksikliğini gizliyor ve teşhisi imkânsız kılıyordu. */
            return Ok(new
            {
                hata = "Büyüme verisine ulaşılamadı.",
                ayrinti = hata.Message,
                satirlar = new List<object>()
            });
        }
    }

    /// <summary>
    /// Üst üste tam puan alanlar.
    ///
    /// <para>
    /// Son <paramref name="donem"/> dönemin hepsinde 100 puan almış
    /// personel. Kesintisiz olması şart: aradaki bir dönemde düşen kişi
    /// listeye girmez, çünkü aranan şey süreklilik.
    /// </para>
    /// </summary>
    [HttpGet("Sureklilik")]
    public IActionResult Sureklilik([FromQuery] int donem = 3)
    {
        donem = Math.Clamp(donem, 2, 12);

        try
        {
            using var db = _vt.PerformansBaglantisi();

            /* Son N dönem, veri girilmiş dönemler arasından alınır:
               takvim ayı değil, gerçekten değerlendirme yapılmış ay. */
            var donemler = db.Query(@"
SELECT DISTINCT TOP (@donem) yil, ay
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
ORDER BY yil DESC, ay DESC", new { donem }).ToList();

            if (donemler.Count < donem)
                return Ok(new
                {
                    yeterliDonemYok = true,
                    istenen = donem,
                    mevcut = donemler.Count,
                    kayitlar = new List<object>()
                });

            var enEski = donemler.Last();

            var kayitlar = db.Query(@"
SELECT per_id      AS perId,
       MAX(per_adi)     AS ad,
       MAX(per_soyadi)  AS soyad,
       MAX(gorev_adi)   AS gorevAdi,
       MAX(sube_adi)    AS subeAdi,
       COUNT(*)         AS donemSayisi
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE (yil > @enEskiYil OR (yil = @enEskiYil AND ay >= @enEskiAy))
  AND ISNULL([MAĞAZA PERFORMANSI], 0)
      + ISNULL([YETKİNLİK ÖLÇÜTLERİ TOPLAMI], 0) >= 100
  AND sube_adi IS NOT NULL AND LTRIM(RTRIM(sube_adi)) <> ''
GROUP BY per_id
HAVING COUNT(*) >= @donem
ORDER BY MAX(sube_adi), MAX(per_adi)",
                new
                {
                    enEskiYil = (int)enEski.yil,
                    enEskiAy = (int)enEski.ay,
                    donem
                }).ToList();

            return Ok(new { donem, kayitlar });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Süreklilik listesi okunamadı");
            return Ok(new { kayitlar = new List<object>() });
        }
    }

    /// <summary>
    /// Dönem özeti: tüm personelin sıralaması. Karşılaştırma ekranı bunu
    /// kullanır.
    /// </summary>
    [HttpGet("Ozet")]
    public IActionResult Ozet(
        [FromQuery] int? yil = null,
        [FromQuery] int? ay = null,
        [FromQuery] string sube = null)
    {
        try
        {
            using var db = _vt.PerformansBaglantisi();

            /* Dönem verilmezse en son veri girilen dönem alınır: kullanıcı
               ay seçmeden girdiğinde boş ekran görmesin. */
            var donem = db.QueryFirstOrDefault(@"
SELECT TOP 1 yil, ay FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
ORDER BY yil DESC, ay DESC");

            var seciliYil = yil ?? (int?)donem?.yil;
            var seciliAy = ay ?? (int?)donem?.ay;

            if (seciliYil is null)
                return Ok(new { kayitlar = new List<object>(), donemler = new List<object>() });

            var kayitlar = db.Query(@"
SELECT per_id                       AS perId,
       per_adi                      AS ad,
       per_soyadi                   AS soyad,
       gorev_adi                    AS gorevAdi,
       sube_adi                     AS subeAdi,
       [MAĞAZA PERFORMANSI]         AS magazaToplam,
       [YETKİNLİK ÖLÇÜTLERİ TOPLAMI] AS yetkinlikToplam,
       gorev_sirasi                 AS gorevSirasi,
       sirket_sirasi                AS sirketSirasi
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay
  AND (@sube IS NULL OR sube_adi = @sube)
ORDER BY sirket_sirasi",
                new
                {
                    yil = seciliYil,
                    ay = seciliAy,
                    sube = string.IsNullOrWhiteSpace(sube) ? null : sube
                }).ToList();

            /* Seçilebilecek dönemler */
            var donemler = db.Query(@"
SELECT DISTINCT yil, ay FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
ORDER BY yil DESC, ay DESC").ToList();

            return Ok(new { yil = seciliYil, ay = seciliAy, kayitlar, donemler });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Performans özeti okunamadı");

            return Ok(new
            {
                hata = "Performans verisine ulaşılamadı.",
                ayrinti = hata.Message,
                kayitlar = new List<object>(),
                donemler = new List<object>()
            });
        }
    }
}

using System.Data;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İK Performans › İşe alım sekmesi (30.10.2026'da baştan düzenlendi).
///
/// <para>
/// Ekrandaki her sayı ile o sayıya tıklayınca açılan liste aynı kümeden
/// hesaplanır. Ortak kurallar:
/// </para>
/// <list type="bullet">
/// <item><b>Kişiler</b>: yalnızca aktif ve rolü tam olarak İK Uzmanı ya da
/// İK Yöneticisi olan kullanıcıların işlemleri sayılır (özet, bölge,
/// olumsuzlar, listeler dahil).</item>
/// <item><b>Şube</b>: bölge seçimi ya da şube yetkisi varsa bütün sayılara
/// aynı şube kodu kümesi uygulanır.</item>
/// <item><b>Dönem</b>: işlemin (hareketin) tarihi seçilen aralıkta olmalı.</item>
/// <item><b>İşe alım</b>: uzman "İşe Al" dediğinde başvuru "Onay Bekliyor"a
/// geçer; "İşe Alındı" hareketini onaylayan yönetici yazar. Önceden işe
/// alım onaylayana sayılıyordu (uzmanlarda 0, yöneticide yüksek). Artık
/// işe alım, başvurunun son "Onay Bekliyor" hareketini yapan uzmana
/// sayılır; dönem o hareketin tarihidir; başvurunun güncel durumu "İşe
/// Alındı" olmalıdır. Onay akışından önceki doğrudan alımlarda "İşe
/// Alındı" hareketini yapan kişi esas alınır. Ücret pazarlığı, doldurma
/// süresi ve eski çalışan sayısı da bu kümeden hesaplanır.</item>
/// <item><b>Eski çalışan</b>: Mikro'da işe giriş tarihinden önce çıkışı
/// olan kimlik numarası (sonradan ayrılan yeni personel sayılmaz).</item>
/// <item><b>Doldurma süresi</b>: süresi norm kadrodan bilinmeyen ve 1
/// saatten kısa (geçmişe dönük açılmış) kayıtlar ortalamaya girmez; hem
/// uzman kartında hem pozisyon tablosunda aynı.</item>
/// </list>
/// </summary>
public partial class RaporController
{
    private const int GecmiseDonukDakika = 60;

    private static readonly string[] SistemKullanicilari = { "aday", "sistem", "test" };

    /// <summary>Hesaba giren İK kullanıcıları (aktif, rol tam İK / İK Yöneticisi).</summary>
    private static string[] IkKullanicilari(IDbConnection db) =>
        db.Query<string>(@"
SELECT kullanici_adi FROM KRY_KULLANICILAR
WHERE aktif = 1 AND id <> 1 AND rol IN @roller",
            new { roller = new[] { Roller.IK, Roller.IKYoneticisi } }).ToArray();

    /// <summary>Performans sayfasının şube süzgeci (KOD kümesi); süzme yoksa null.</summary>
    private string[] PerfSubeleri() => SubeSuzmesi ? YetkiliKodlar().ToArray() : null;

    /// <summary>Boş listeyle IN sorgusu hata vermesin diye.</summary>
    private static string[] Dolu(string[] l) => l is { Length: > 0 } ? l : new[] { "__YOK__" };

    public sealed class IseAlimKaydi
    {
        public int Id { get; set; }
        public string Kullanici { get; set; }
        public string KullaniciAdSoyad { get; set; }
        public DateTime Tarih { get; set; }
        public string AdSoyad { get; set; }
        public string KimlikNo { get; set; }
        public string Bolum { get; set; }
        public string SubeKodu { get; set; }
        public string SubeAdi { get; set; }
        public int Dakika { get; set; }
        public string Olcum { get; set; }
        public DateTime? IseGirisTarihi { get; set; }
        public DateTime BasvuruTarihi { get; set; }
        public string TalepMetin { get; set; }
        public decimal? Anlasilan { get; set; }

        public bool Olculebilir => !(Olcum == "basvuru" && Dakika < GecmiseDonukDakika);
    }

    /// <summary>
    /// Dönemdeki işe alımlar, her biri işe alan uzmana bağlı (kurallar sınıf
    /// açıklamasında). <paramref name="kullanicilar"/> verilirse yalnızca
    /// onların alımları.
    /// </summary>
    private List<IseAlimKaydi> IseAlimlari(IDbConnection db, DateTime bas, DateTime bit,
        string[] ik, string[] kullanicilar = null)
    {
        var subeler = PerfSubeleri();
        var kisiler = kullanicilar is { Length: > 0 }
            ? kullanicilar.Where(k => ik.Contains(k, StringComparer.OrdinalIgnoreCase)).ToArray()
            : ik;

        var liste = db.Query<IseAlimKaydi>(@"
WITH g AS (
    SELECT h.basvuru_id, h.kullanici, h.tarih,
           ROW_NUMBER() OVER (
               PARTITION BY h.basvuru_id
               ORDER BY CASE WHEN h.durum = N'Onay Bekliyor' THEN 0 ELSE 1 END,
                        h.tarih DESC, h.id DESC) AS sira
    FROM KRY_BASVURU_HAREKET h
    WHERE h.durum IN (N'Onay Bekliyor', N'İşe Alındı')
      AND h.kullanici NOT IN @sistem
)
SELECT b.id AS Id,
       g.kullanici AS Kullanici,
       ISNULL(k.ad_soyad, g.kullanici) AS KullaniciAdSoyad,
       g.tarih AS Tarih,
       b.ad_soyad AS AdSoyad,
       b.kimlik_no AS KimlikNo,
       ISNULL(NULLIF(b.ise_giris_bolum, N''), b.bolumler) AS Bolum,
       b.sube_kodu AS SubeKodu,
       b.sube_adi AS SubeAdi,
       ISNULL(b.doldurma_dakika,
              ISNULL(NULLIF(b.doldurma_gun, 0) * 1440,
                     DATEDIFF(minute, b.olusturma, ISNULL(b.ise_giris_tarihi, g.tarih)))) AS Dakika,
       CASE WHEN b.doldurma_dakika IS NOT NULL OR b.doldurma_gun IS NOT NULL
            THEN N'kadro' ELSE N'basvuru' END AS Olcum,
       b.ise_giris_tarihi AS IseGirisTarihi,
       b.olusturma AS BasvuruTarihi,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS TalepMetin,
       b.anlasilan_ucret AS Anlasilan
FROM g
JOIN KRY_BASVURULAR b ON b.id = g.basvuru_id
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = g.kullanici
WHERE g.sira = 1
  AND b.durum = N'İşe Alındı'
  AND g.tarih BETWEEN @bas AND @bit
  AND g.kullanici IN @kisiler
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)
ORDER BY g.tarih DESC",
            new
            {
                bas, bit,
                sistem = SistemKullanicilari,
                kisiler = Dolu(kisiler),
                subeSiniri = subeler is null ? 0 : 1,
                subeler = Dolu(subeler)
            }, commandTimeout: 120).ToList();

        foreach (var k in liste)
        {
            if (k.Dakika < 1) k.Dakika = 1;
            if (!string.IsNullOrWhiteSpace(k.Bolum) && k.Bolum.Contains(','))
                k.Bolum = k.Bolum.Split(',')[0].Trim();
        }

        return liste;
    }

    /// <summary>
    /// Eski çalışan alımları: kimlik numarası Mikro'da, bu işe girişten
    /// ÖNCE çıkışı olan bir sicilde bulunanlar. Mikro'ya ulaşılamazsa boş.
    /// </summary>
    private HashSet<int> EskiCalisanAlimlari(List<IseAlimKaydi> alimlar)
    {
        var sonuc = new HashSet<int>();
        var adaylar = alimlar.Where(a => (a.KimlikNo ?? "").Trim().Length == 11).ToList();
        if (adaylar.Count == 0) return sonuc;

        try
        {
            using var pdb = _vt.PersonelBaglantisi();
            var cikislar = pdb.Query<(string Tc, DateTime Cikis)>(@"
SELECT LTRIM(RTRIM(Per_TcKimlikNo)), per_cikis_tar
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE per_cikis_tar IS NOT NULL AND YEAR(per_cikis_tar) > 1950
  AND LEN(LTRIM(RTRIM(Per_TcKimlikNo))) = 11", commandTimeout: 60)
                .GroupBy(x => x.Tc)
                .ToDictionary(g => g.Key, g => g.Select(x => x.Cikis).ToList());

            foreach (var a in adaylar)
            {
                if (!cikislar.TryGetValue(a.KimlikNo.Trim(), out var c)) continue;
                var giris = (a.IseGirisTarihi ?? a.Tarih).Date;
                if (c.Any(x => x.Date < giris)) sonuc.Add(a.Id);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Eski çalışan eşleştirmesi yapılamadı");
        }

        return sonuc;
    }

    private string BolgeBulucu(string subeKodu, FormAyarlari ayar)
    {
        var kod = (subeKodu ?? "").Trim();
        if (kod.Length == 0) return "Bölgesiz";

        var ad = (ayar.Subeler ?? new List<Sube>())
            .FirstOrDefault(x => string.Equals((x.Kod ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase))?.Ad?.Trim() ?? "";

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

    /* ==================================================================== */
    /* Ana ekran                                                            */
    /* ==================================================================== */

    [HttpGet("Performans")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult Performans([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();
        var ik = IkKullanicilari(db);
        var subeler = PerfSubeleri();
        var p = new
        {
            bas = baslangic,
            bit = bitis,
            ik = Dolu(ik),
            sistem = SistemKullanicilari,
            subeSiniri = subeler is null ? 0 : 1,
            subeler = Dolu(subeler)
        };

        /* Dönemdeki İK hareketleri (şube süzgeciyle) — kartların, özetin ve
           bölgelerin ortak tabanı */
        var hareketler = db.Query<(int BasvuruId, string Kullanici, string Durum, string GuncelDurum, string SubeKodu, DateTime Tarih, string Aciklama)>(@"
SELECT h.basvuru_id, h.kullanici, h.durum, b.durum, b.sube_kodu, h.tarih, h.aciklama
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
WHERE h.tarih BETWEEN @bas AND @bit
  AND h.kullanici IN @ik
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)", p, commandTimeout: 120).ToList();

        var alimlar = IseAlimlari(db, baslangic, bitis, ik);
        var eskiler = EskiCalisanAlimlari(alimlar);

        /* Tepki: dönemde GELEN başvurulara ilk dokunan kişi (sistem dışı)
           ve süresi. İlk dokunan İK kullanıcısı değilse (yönetici) kimseye
           yazılmaz; genel ortalama da aynı kümeden. */
        var ilkDokunus = db.Query<(int BasvuruId, string Kullanici, double Dakika)>(@"
SELECT i.basvuru_id, i.kullanici, CAST(DATEDIFF(minute, b.olusturma, i.tarih) AS FLOAT)
FROM (
    SELECT h.basvuru_id, h.kullanici, h.tarih,
           ROW_NUMBER() OVER (PARTITION BY h.basvuru_id ORDER BY h.tarih, h.id) AS sira
    FROM KRY_BASVURU_HAREKET h
    WHERE h.kullanici NOT IN @sistem
) i
JOIN KRY_BASVURULAR b ON b.id = i.basvuru_id
WHERE i.sira = 1
  AND i.tarih >= b.olusturma
  AND b.olusturma BETWEEN @bas AND @bit
  AND i.kullanici IN @ik
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)", p, commandTimeout: 120).ToList();

        var notlar = db.Query<(string Kullanici, int Adet)>(@"
SELECT n.kullanici, COUNT(DISTINCT n.basvuru_id)
FROM KRY_BASVURU_NOT n
JOIN KRY_BASVURULAR b ON b.id = n.basvuru_id
WHERE n.tarih BETWEEN @bas AND @bit
  AND n.kullanici IN @ik
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)
GROUP BY n.kullanici", p).ToDictionary(x => x.Kullanici, x => x.Adet, StringComparer.OrdinalIgnoreCase);

        var kisiler = db.Query(@"
SELECT kullanici_adi AS kullaniciAdi, ad_soyad AS adSoyad, ISNULL(unvan, N'') AS unvan,
       ISNULL(bolge, N'Belirtilmemiş') AS bolge
FROM KRY_KULLANICILAR WHERE kullanici_adi IN @ik", p).ToList();

        static int Benzersiz(IEnumerable<int> l) => l.Distinct().Count();
        static bool Sonuc(string d) => d is "Olumlu" or "Onay Bekliyor" or "İşe Alındı" or "Olumsuz";

        var satirlar = kisiler.Select(k =>
        {
            string ad = k.kullaniciAdi;
            var h = hareketler.Where(x => string.Equals(x.Kullanici, ad, StringComparison.OrdinalIgnoreCase)).ToList();
            var a = alimlar.Where(x => string.Equals(x.Kullanici, ad, StringComparison.OrdinalIgnoreCase)).ToList();
            var t = ilkDokunus.Where(x => string.Equals(x.Kullanici, ad, StringComparison.OrdinalIgnoreCase)).ToList();
            var olc = a.Where(x => x.Olculebilir).ToList();
            var ucret = a.Select(x => (x, talep: UcretMetni.Coz(x.TalepMetin)))
                .Where(x => x.talep > 0 && x.x.Anlasilan > 0).ToList();

            var s = new PerformansSatiri
            {
                KullaniciAdi = ad,
                AdSoyad = k.adSoyad,
                Unvan = k.unvan,
                Bolge = k.bolge,
                Islem = Benzersiz(h.Select(x => x.BasvuruId)),
                IlgilenilenBasvuru = Benzersiz(h.Select(x => x.BasvuruId)),
                Inceleme = Benzersiz(h.Where(x => x.Durum == "İncelendi").Select(x => x.BasvuruId)),
                Degerlendirme = Benzersiz(h.Where(x => x.Durum == "Değerlendirmede").Select(x => x.BasvuruId)),
                Gorusme = Benzersiz(h.Where(x => x.Durum == "Görüşme Talebi").Select(x => x.BasvuruId)),
                Olumlu = Benzersiz(h.Where(x => x.Durum == "Olumlu").Select(x => x.BasvuruId)),
                EvrakHazirlaniyor = Benzersiz(h.Where(x => x.Durum == "Evrak Hazırlanıyor").Select(x => x.BasvuruId)),
                IseAlinan = a.Count,
                Olumsuz = Benzersiz(h.Where(x => x.Durum == "Olumsuz" && x.GuncelDurum == "Olumsuz").Select(x => x.BasvuruId)),
                Rotasyon = Benzersiz(h.Where(x => (x.Aciklama ?? "").StartsWith("Birim değişikliği")).Select(x => x.BasvuruId)),
                BirimSayisi = h.Select(x => x.SubeKodu).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().Count(),
                SonIslem = h.Count > 0 ? h.Max(x => x.Tarih) : null,
                /* Sonuca bağladığı başvurular: olumlu, işe al (onay bekliyor),
                   işe alındı ya da olumsuz — uzmanın kendi hareketi */
                Sonuclanan = Benzersiz(h.Where(x => Sonuc(x.Durum)).Select(x => x.BasvuruId)),
                Not = notlar.GetValueOrDefault(ad),
                EskiCalisanAlimi = a.Count(x => eskiler.Contains(x.Id)),
                OrtalamaDoldurmaDakika = olc.Count > 0 ? (int)Math.Round(olc.Average(x => (double)x.Dakika)) : 0,
            };

            if (t.Count > 0)
            {
                var ort = t.Average(x => x.Dakika) / 60.0;
                s.OrtalamaTepkiSaat = Math.Round(ort, 1);
                s.OrtalamaTepkiGun = Math.Round(ort / 24.0, 2);
                s.EnHizliSaat = Math.Round(t.Min(x => x.Dakika) / 60.0, 1);
                s.EnYavasSaat = Math.Round(t.Max(x => x.Dakika) / 60.0, 1);
            }

            if (ucret.Count > 0)
            {
                s.OrtalamaTalep = Math.Round(ucret.Average(x => x.talep!.Value), 0);
                s.OrtalamaAnlasilan = Math.Round(ucret.Average(x => x.x.Anlasilan!.Value), 0);
                s.UcretliAlim = ucret.Count;
            }

            return s;
        })
        .OrderByDescending(x => x.IlgilenilenBasvuru)
        .ToList();

        /* Özet: başvuru bazında benzersiz (birden çok uzmanın dokunduğu
           başvuru bir kez sayılır) */
        var ozet = new
        {
            ilgilenilen = Benzersiz(hareketler.Select(x => x.BasvuruId)),
            inceleme = Benzersiz(hareketler.Where(x => x.Durum == "İncelendi").Select(x => x.BasvuruId)),
            gorusme = Benzersiz(hareketler.Where(x => x.Durum == "Görüşme Talebi").Select(x => x.BasvuruId)),
            olumlu = Benzersiz(hareketler.Where(x => x.Durum == "Olumlu").Select(x => x.BasvuruId)),
            iseAlinan = Benzersiz(alimlar.Select(x => x.Id)),
            olumsuz = Benzersiz(hareketler.Where(x => x.Durum == "Olumsuz" && x.GuncelDurum == "Olumsuz").Select(x => x.BasvuruId)),
            eskiCalisan = eskiler.Count,
        };

        var genelTepki = ilkDokunus.Count > 0 ? Math.Round(ilkDokunus.Average(x => x.Dakika) / 60.0, 1) : 0;

        /* Bölgeler: başvurunun mağazasının bölgesi */
        var ayar = _ayar.FormOku();
        var adlar = db.Query<(string Kullanici, string AdSoyad)>(
                "SELECT kullanici_adi, ad_soyad FROM KRY_KULLANICILAR WHERE kullanici_adi IN @ik", p)
            .ToDictionary(x => x.Kullanici, x => x.AdSoyad ?? x.Kullanici, StringComparer.OrdinalIgnoreCase);

        var bolgeler = hareketler
            .Select(x => new { x.BasvuruId, x.Durum, x.GuncelDurum, x.Kullanici, bolge = BolgeBulucu(x.SubeKodu, ayar) })
            .GroupBy(x => x.bolge)
            .Select(g =>
            {
                var alim = alimlar.Where(a => BolgeBulucu(a.SubeKodu, ayar) == g.Key).ToList();
                var uzmanAdlari = g.Select(x => adlar.GetValueOrDefault(x.Kullanici, x.Kullanici)).Distinct().OrderBy(x => x).ToList();
                return new
                {
                    bolge = g.Key,
                    uzmanlar = uzmanAdlari,
                    uzman = uzmanAdlari.Count,
                    islem = Benzersiz(g.Select(x => x.BasvuruId)),
                    inceleme = Benzersiz(g.Where(x => x.Durum == "İncelendi").Select(x => x.BasvuruId)),
                    gorusme = Benzersiz(g.Where(x => x.Durum == "Görüşme Talebi").Select(x => x.BasvuruId)),
                    olumlu = Benzersiz(g.Where(x => x.Durum == "Olumlu").Select(x => x.BasvuruId)),
                    iseAlinan = Benzersiz(alim.Select(x => x.Id)),
                    olumsuz = Benzersiz(g.Where(x => x.Durum == "Olumsuz" && x.GuncelDurum == "Olumsuz").Select(x => x.BasvuruId)),
                };
            })
            .OrderByDescending(x => x.islem)
            .ToList();

        var subeAdlari = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .GroupBy(x => x.Kod.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Ad, StringComparer.OrdinalIgnoreCase);

        var bolgesizSubeler = hareketler
            .Where(x => !string.IsNullOrWhiteSpace(x.SubeKodu) && BolgeBulucu(x.SubeKodu, ayar) == "Bölgesiz")
            .GroupBy(x => x.SubeKodu.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new { kod = g.Key, ad = subeAdlari.GetValueOrDefault(g.Key, g.Key), basvuru = Benzersiz(g.Select(x => x.BasvuruId)) })
            .OrderByDescending(x => x.basvuru)
            .ToList();

        var notMetinleri = db.Query(@"
SELECT * FROM (
    SELECT n.kullanici AS kullanici, ISNULL(n.ad_soyad, n.kullanici) AS yazan, n.tarih AS tarih,
           n.metin AS metin, b.id AS basvuruId, b.ad_soyad AS aday, b.sube_adi AS subeAdi, b.durum AS durum,
           ROW_NUMBER() OVER (PARTITION BY n.kullanici ORDER BY n.tarih DESC) AS sira
    FROM KRY_BASVURU_NOT n
    LEFT JOIN KRY_BASVURULAR b ON b.id = n.basvuru_id
    WHERE n.tarih BETWEEN @bas AND @bit
      AND n.kullanici IN @ik
      AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)
) t
WHERE t.sira <= 20
ORDER BY t.tarih DESC", p).ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.Date,
            uzmanlar = satirlar,
            notlar = notMetinleri,
            bolgeler,
            bolgesizSubeler,
            ozet,
            genelTepkiSaat = genelTepki
        });
    }

    /* ==================================================================== */
    /* Sayıdan açılan liste                                                 */
    /* ==================================================================== */

    /// <param name="asama">ilgilenilen · inceleme · gorusme · olumlu · iseAlinan · olumsuz · eskiCalisan</param>
    [HttpGet("PerformansListe")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult PerformansListe(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] string asama = "ilgilenilen",
        [FromQuery] string bolge = null,
        [FromQuery] string kullanici = null)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        var kullanicilar = (kullanici ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim()).Where(x => x.Length > 0).ToArray();

        using var db = _vt.Baglanti();
        var ik = IkKullanicilari(db);
        var kisiler = kullanicilar.Length > 0
            ? kullanicilar.Where(k => ik.Contains(k, StringComparer.OrdinalIgnoreCase)).ToArray()
            : ik;
        var subeler = PerfSubeleri();
        var a = (asama ?? "").ToLowerInvariant();

        /* Başvuru numaraları: kutudaki sayıyla aynı küme */
        List<int> idler;
        if (a is "isealinan" or "eskicalisan")
        {
            var alimlar = IseAlimlari(db, baslangic, bitis, ik, kisiler);
            if (a == "eskicalisan")
            {
                var eski = EskiCalisanAlimlari(alimlar);
                alimlar = alimlar.Where(x => eski.Contains(x.Id)).ToList();
            }
            idler = alimlar.Select(x => x.Id).Distinct().ToList();
        }
        else
        {
            var (durum, guncel) = a switch
            {
                "inceleme" => ("İncelendi", false),
                "gorusme" => ("Görüşme Talebi", false),
                "olumlu" => ("Olumlu", false),
                "olumsuz" => ("Olumsuz", true),
                _ => ((string)null, false)
            };

            idler = db.Query<int>(@"
SELECT DISTINCT h.basvuru_id
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
WHERE h.tarih BETWEEN @bas AND @bit
  AND h.kullanici IN @kisiler
  AND (@durum IS NULL OR h.durum = @durum)
  AND (@guncel = 0 OR b.durum = @durum)
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)",
                new
                {
                    bas = baslangic, bit = bitis, durum, guncel = guncel ? 1 : 0,
                    kisiler = Dolu(kisiler),
                    subeSiniri = subeler is null ? 0 : 1,
                    subeler = Dolu(subeler)
                }, commandTimeout: 120).ToList();
        }

        if (idler.Count == 0) return Ok(Array.Empty<object>());

        /* SQL Server'da bir sorguda en çok 2100 parametre: numaralar 1000'erli
           parçalarla okunur (geniş aralıkta binlerce başvuru olabiliyor). */
        var satirlar = new List<dynamic>();
        foreach (var parca in idler.Chunk(1000))
            satirlar.AddRange(db.Query(@"
SELECT b.id, b.basvuru_no AS basvuruNo, b.ad_soyad AS adSoyad, b.telefon, b.sube_kodu AS subeKodu,
       b.sube_adi AS subeAdi, b.bolumler, b.durum,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS talepUcret,
       b.anlasilan_ucret AS anlasilanUcret, b.ise_giris_tarihi AS iseGirisTarihi,
       b.olusturma, b.guncelleme, b.guncelleyen,
       (SELECT CAST(DATEDIFF(minute, b.olusturma, MIN(t.tarih)) AS FLOAT) / 60.0
        FROM KRY_BASVURU_HAREKET t
        WHERE t.basvuru_id = b.id AND t.kullanici NOT IN @sistem AND t.tarih >= b.olusturma) AS tepkiSaat
FROM KRY_BASVURULAR b
WHERE b.id IN @idler",
                new { idler = parca, sistem = SistemKullanicilari }, commandTimeout: 120));

        satirlar = satirlar.OrderByDescending(x => (DateTime)x.olusturma).ToList();

        if (!string.IsNullOrWhiteSpace(bolge))
        {
            var ayar = _ayar.FormOku();
            satirlar = satirlar.Where(x => BolgeBulucu((string)x.subeKodu, ayar) == bolge).ToList();
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

    /// <summary>Uzman detayı: işlemleri ve ücret pazarlıkları (kartla aynı küme).</summary>
    [HttpGet("Performans/{kullanici}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult PerformansDetay(string kullanici, [FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        if (string.IsNullOrWhiteSpace(kullanici)) return BadRequest(new { hata = "Uzman seçiniz." });

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-30);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();
        var ik = IkKullanicilari(db);
        var subeler = PerfSubeleri();

        var islemler = db.Query(@"
SELECT h.tarih AS tarih, h.durum AS durum, h.aciklama AS aciklama,
       b.id AS basvuruId, b.basvuru_no AS basvuruNo, b.ad_soyad AS adSoyad,
       b.sube_adi AS subeAdi, b.bolumler AS bolumler, b.durum AS sonDurum,
       b.anlasilan_ucret AS anlasilanUcret,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS talepUcret
FROM KRY_BASVURU_HAREKET h
JOIN KRY_BASVURULAR b ON b.id = h.basvuru_id
WHERE h.kullanici = @kullanici
  AND h.tarih BETWEEN @bas AND @bit
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)
ORDER BY h.tarih DESC",
            new
            {
                kullanici, bas = baslangic, bit = bitis,
                subeSiniri = subeler is null ? 0 : 1,
                subeler = Dolu(subeler)
            }).ToList();

        var pazarliklar = IseAlimlari(db, baslangic, bitis, ik, new[] { kullanici.Trim() })
            .Select(x => new
            {
                basvuruId = x.Id,
                adSoyad = x.AdSoyad,
                subeAdi = x.SubeAdi,
                anlasilan = x.Anlasilan,
                talepMetin = x.TalepMetin,
                talep = UcretMetni.Coz(x.TalepMetin),
                girisTarihi = x.IseGirisTarihi
            })
            .Where(x => x.talep > 0 && x.anlasilan > 0)
            .OrderByDescending(x => x.girisTarihi)
            .ToList();

        return Ok(new { islemler, pazarliklar });
    }

    /* ==================================================================== */
    /* Pozisyon doldurma süreleri                                           */
    /* ==================================================================== */

    [HttpGet("DoldurmaSureleri")]
    public IActionResult DoldurmaSureleri([FromQuery] DateTime? bas, [FromQuery] DateTime? bit, [FromQuery] string bolge = null)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);
        var ayar = _ayar.FormOku();

        using var db = _vt.Baglanti();
        var ik = IkKullanicilari(db);

        var tumu = IseAlimlari(db, baslangic, bitis, ik)
            .Select(x => new DoldurmaKaydi
            {
                Id = x.Id,
                AdSoyad = x.AdSoyad,
                Bolum = x.Bolum,
                SubeKodu = x.SubeKodu,
                SubeAdi = x.SubeAdi,
                Dakika = x.Dakika,
                Olcum = x.Olcum,
                IseGirisTarihi = x.IseGirisTarihi,
                BasvuruTarihi = x.BasvuruTarihi,
                Kullanici = x.Kullanici,
                KullaniciAdSoyad = x.KullaniciAdSoyad,
                Bolge = BolgeBulucu(x.SubeKodu, ayar)
            })
            .ToList();

        if (!string.IsNullOrWhiteSpace(bolge)) tumu = tumu.Where(x => x.Bolge == bolge).ToList();

        /* Geçmişe dönük (süresi bilinmeyen ve 1 saatten kısa) kayıtlar
           ortalamaya girmez; uzman kartındaki doldurma süresi de aynı kuralla */
        var gecmiseDonuk = tumu.Where(x => x.Olcum == "basvuru" && x.Dakika < GecmiseDonukDakika).ToList();
        var kayitlar = tumu.Except(gecmiseDonuk).ToList();

        var pozisyonlar = kayitlar
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Bolum) ? "Belirtilmemiş" : x.Bolum)
            .Select(g => new
            {
                bolum = g.Key,
                adet = g.Count(),
                ortalamaDakika = (int)Math.Round(g.Average(x => (double)x.Dakika)),
                enHizli = g.Min(x => x.Dakika),
                enYavas = g.Max(x => x.Dakika),
                uzmanlar = g.Where(x => !string.IsNullOrWhiteSpace(x.KullaniciAdSoyad))
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
            .Select(g => new { bolge = g.Key, adet = g.Count(), ortalamaDakika = (int)Math.Round(g.Average(x => (double)x.Dakika)) })
            .OrderByDescending(x => x.adet)
            .ToList();

        return Ok(new
        {
            toplam = kayitlar.Count,
            ortalamaDakika = kayitlar.Count > 0 ? (int)Math.Round(kayitlar.Average(x => (double)x.Dakika)) : 0,
            enHizli = kayitlar.Count > 0 ? kayitlar.Min(x => x.Dakika) : 0,
            enYavas = kayitlar.Count > 0 ? kayitlar.Max(x => x.Dakika) : 0,
            gecmiseDonuk = gecmiseDonuk.Count,
            pozisyonlar,
            bolgeler,
            kadroOlcumu = kayitlar.Count(x => x.Olcum == "kadro"),
            basvuruOlcumu = kayitlar.Count(x => x.Olcum == "basvuru")
        });
    }

    /* ==================================================================== */
    /* Olumsuz değerlendirmeler                                             */
    /* ==================================================================== */

    /// <summary>
    /// İK kullanıcılarının dönemde olumsuz sonuçlandırdığı ve hâlâ olumsuz
    /// olan başvurular (uzman kartındaki "Olumsuz" ile aynı küme).
    /// </summary>
    [HttpGet("Olumsuzlar")]
    public IActionResult Olumsuzlar([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddMonths(-2).AddDays(1 - DateTime.Today.Day);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1).AddSeconds(-1);
        var ayar = _ayar.FormOku();

        using var db = _vt.Baglanti();
        var ik = IkKullanicilari(db);
        var subeler = PerfSubeleri();

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
    WHERE durum = N'Olumsuz' AND tarih BETWEEN @bas AND @bit AND kullanici IN @ik
    GROUP BY basvuru_id
) son ON son.basvuru_id = b.id
JOIN KRY_BASVURU_HAREKET h ON h.id = son.sonId
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = h.kullanici
WHERE b.durum = N'Olumsuz'
  AND (@subeSiniri = 0 OR b.sube_kodu IN @subeler)
ORDER BY h.tarih DESC",
            new
            {
                bas = baslangic, bit = bitis,
                ik = Dolu(ik),
                subeSiniri = subeler is null ? 0 : 1,
                subeler = Dolu(subeler)
            }).ToList();

        foreach (var kayit in kayitlar)
        {
            kayit.Bolge = BolgeBulucu(kayit.SubeKodu, ayar);
            kayit.Bolum = !string.IsNullOrWhiteSpace(kayit.Bolumler) && kayit.Bolumler.Contains(',')
                ? kayit.Bolumler.Split(',')[0].Trim()
                : kayit.Bolumler;
            kayit.NedenGrubu = OlumsuzNedeni.Grupla(kayit.Gerekce);
        }

        var nedenler = kayitlar
            .GroupBy(x => x.NedenGrubu)
            .Select(g => new { neden = g.Key, adet = g.Count() })
            .OrderByDescending(x => x.adet)
            .ToList();

        var uzmanlar = kayitlar
            .GroupBy(x => string.IsNullOrWhiteSpace(x.KullaniciAdSoyad) ? "Belirtilmemiş" : x.KullaniciAdSoyad)
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

        return Ok(new { toplam = kayitlar.Count, uzmanlar, pozisyonlar, nedenler, kayitlar });
    }
}

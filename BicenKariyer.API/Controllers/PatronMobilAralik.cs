using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen360 patron görünümü · tarih aralığı (uygulama 1.6, 06.10.2026).
///
/// <para>
/// Patron "her sayfada tarih filtresi seçebilelim" dedi: ekranlar bugüne ve
/// bu aya sabitti. Zamana bağlı her uç isteğe bağlı <c>bas</c> ve <c>bit</c>
/// (yyyy-MM-dd, iki gün de dahil) alıyor. Verilmezse yanıt eskisiyle
/// birebir aynı: yayındaki 1.5 hiçbir şey göndermiyor ve hiçbir şey
/// değişmiyor. Verilirse zamana bağlı sayılar o aralık için hesaplanıyor
/// ve yanıtta uygulanan aralık dönüyor (<c>aralik</c>).
/// </para>
///
/// <para>
/// <b>Aralıkla değişenler:</b> okutma (en az bir gün okutan, hiç
/// okutmayan, geç kalınan gün, saat saat ilk giriş, gün gün okutan),
/// başvuru sayıları ve huni (başvuru tarihine göre), işe alınanlar,
/// Biçen Kart yükleme/harcama, sirkülasyon, izin ve rapor, etik hattaki
/// yeni bildirimler, onay listesi (talep tarihine göre) ve verilen
/// kararlar (karar tarihine göre), norm ekranında aralıktaki giriş/çıkış.
/// </para>
///
/// <para>
/// <b>Şu an kalanlar:</b> norm kadro ve doluluk, kart bakiyesi ve aktif
/// kart, bekleyen onay toplamı, "3+ gündür işlemsiz" başvuru sayısı,
/// etik hattaki açık/yeni bildirim, önümüzdeki 7 günün izin planı. Bunlar
/// bir anın fotoğrafı; geçmiş bir tarihteki değeri tutulmuyor, uydurmak
/// yerine "şu an" olarak gösteriliyor. Aralık bugünü kapsıyorsa
/// "içeride" (şu an mağazada) da canlı veriden ekleniyor.
/// </para>
///
/// <para>
/// Okutma kuralı panelin Günlük QR Okutma Raporu'nun aralık sürümüyle
/// (OkutmaVeriHazirlayici) aynı: aralıkta en az bir kez okutan "okuttu";
/// aralığın tamamında raporlu ya da okutmadan muaf olanlar beklenene
/// girmiyor. Kişi → şube eşleştirmesi canlı ekrandakiyle aynı
/// (<see cref="Birimler"/>), kişiler bugün çalışanlar.
/// </para>
///
/// <para>
/// Sunucuyu korumak için aralık en çok <see cref="AralikAzamiGun"/> gün
/// (daha uzunsa bitişten geriye kırpılıyor, <c>aralik.kirpildi</c>);
/// gelecek günler bugüne çekiliyor. Kart geçiş sisteminden kişi-gün
/// özetleri SQL'de toplanarak alınıyor (her okutma satırı taşınmıyor).
/// Bugünü içermeyen aralıkların sonuçları iki dakika saklanıyor.
/// Veritabanları eski uyumluluk düzeyinde: STRING_SPLIT, OPENJSON,
/// TRY_CONVERT, IIF, FORMAT kullanılmıyor; liste parametreleri Dapper'ın
/// <c>IN @liste</c> açılımıyla.
/// </para>
/// </summary>
public partial class PatronMobilController
{
    /* ==================================================================== */
    /* Aralık                                                                */
    /* ==================================================================== */

    /// <summary>En uzun aralık (gün): bir yıl, artık yıl dahil</summary>
    private const int AralikAzamiGun = 366;

    /// <summary>Bundan eski tarih istenmiyor (kayıtlar zaten yok)</summary>
    private static readonly DateTime AralikEnEski = new(2015, 1, 1);

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private sealed class Aralik
    {
        public DateTime Bas { get; init; }
        public DateTime Bit { get; init; }

        /// <summary>İstenen aralık en uzun süreden uzundu, kırpıldı</summary>
        public bool Kirpildi { get; init; }

        public DateTime BitSonrasi => Bit.AddDays(1);
        public int Gun => (Bit - Bas).Days + 1;
        public bool BugunDahil => Bit >= DateTime.Today;
        public string Anahtar => $"{Bas:yyyyMMdd}-{Bit:yyyyMMdd}";
        public string Ad => AralikAdi(Bas, Bit);

        /// <summary>Önceki eşit uzunluktaki dönemin başı (kıyas için)</summary>
        public DateTime OncekiBas => Bas.AddDays(-Gun);

        /// <summary>
        /// Önbellek ömrü: bugünü içeren aralık canlı ekranlar gibi 30 saniye;
        /// geçmiş aralık iki dakika (sonradan değişen tek şey başvuru
        /// durumları gibi yavaş değişen alanlar).
        /// </summary>
        public TimeSpan Omur => BugunDahil ? TimeSpan.FromSeconds(30) : TimeSpan.FromMinutes(2);

        public int Sira(DateTime gun) => (gun.Date - Bas).Days;

        public bool Icinde(DateTime? t) => t is DateTime x && x >= Bas && x < BitSonrasi;

        /// <summary>Yanıttaki <c>aralik</c> alanı</summary>
        public object Disari() => new
        {
            bas = Bas.ToString("yyyy-MM-dd", Inv),
            bit = Bit.ToString("yyyy-MM-dd", Inv),
            ad = Ad,
            yazi = AralikYazisi(Bas, Bit),
            gun = Gun,
            bugunDahil = BugunDahil,
            kirpildi = Kirpildi
        };
    }

    private static bool TarihCoz(string s, out DateTime? t)
    {
        t = null;
        if (s.Length == 0) return true;

        if (!DateTime.TryParseExact(s, new[] { "yyyy-MM-dd", "dd.MM.yyyy" }, Inv, DateTimeStyles.None, out var d))
            return false;

        t = d.Date;
        return true;
    }

    /// <summary>
    /// <c>bas</c>/<c>bit</c> sorgusundan aralık. İkisi de boşsa null (uç eski
    /// davranışıyla çalışır). Yalnızca <c>bas</c> verilirse bitiş bugün,
    /// yalnızca <c>bit</c> verilirse tek gün. Ters verilen tarihler
    /// çevriliyor, gelecek bugüne çekiliyor, uzun aralık kırpılıyor.
    /// </summary>
    private (Aralik Aralik, IActionResult Hata) AralikAl(string bas, string bit)
    {
        var s1 = K(bas);
        var s2 = K(bit);

        if (s1.Length == 0 && s2.Length == 0) return (null, null);

        if (!TarihCoz(s1, out var d1) || !TarihCoz(s2, out var d2))
            return (null, BadRequest(new { hata = "Tarih yyyy-AA-gg biçiminde olmalı (ör. 2026-10-01)." }));

        var bugun = DateTime.Today;
        var ilk = d1 ?? d2.Value;
        var son = d2 ?? (d1 is null ? ilk : bugun);

        if (ilk > son) (ilk, son) = (son, ilk);
        if (son > bugun) son = bugun;
        if (ilk > son) ilk = son;
        if (son < AralikEnEski) son = AralikEnEski;
        if (ilk < AralikEnEski) ilk = AralikEnEski;

        var kirpildi = false;

        if ((son - ilk).Days + 1 > AralikAzamiGun)
        {
            ilk = son.AddDays(-(AralikAzamiGun - 1));
            kirpildi = true;
        }

        return (new Aralik { Bas = ilk, Bit = son, Kirpildi = kirpildi }, null);
    }

    /// <summary>Haftanın ilk günü (pazartesi)</summary>
    private static DateTime HaftaBasi(DateTime g) => g.AddDays(-(((int)g.DayOfWeek + 6) % 7));

    /// <summary>
    /// Uygulamadaki hazır seçeneklerle aynı adlar ("Bu ay"); eşleşmezse
    /// tarih yazısı ("1–6 Eki 2026").
    /// </summary>
    private static string AralikAdi(DateTime bas, DateTime bit)
    {
        var bugun = DateTime.Today;
        var ayBas = new DateTime(bugun.Year, bugun.Month, 1);

        if (bit == bugun)
        {
            if (bas == bugun) return "Bugün";
            if (bas == HaftaBasi(bugun)) return "Bu hafta";
            if (bas == ayBas) return "Bu ay";
            if (bas == new DateTime(bugun.Year, 1, 1)) return "Bu yıl";
        }

        if (bas == bit && bas == bugun.AddDays(-1)) return "Dün";
        if (bas == ayBas.AddMonths(-1) && bit == ayBas.AddDays(-1)) return "Geçen ay";

        return AralikYazisi(bas, bit);
    }

    /// <summary>"6 Eki 2026", "1–6 Eki 2026", "28 Eyl – 6 Eki 2026", "28 Ara 2025 – 6 Oca 2026"</summary>
    private static string AralikYazisi(DateTime bas, DateTime bit)
    {
        string Ay(DateTime t) => AyKisa[t.Month - 1];

        if (bas == bit) return $"{bas.Day} {Ay(bas)} {bas.Year}";
        if (bas.Year == bit.Year && bas.Month == bit.Month) return $"{bas.Day}–{bit.Day} {Ay(bit)} {bit.Year}";
        if (bas.Year == bit.Year) return $"{bas.Day} {Ay(bas)} – {bit.Day} {Ay(bit)} {bit.Year}";

        return $"{bas.Day} {Ay(bas)} {bas.Year} – {bit.Day} {Ay(bit)} {bit.Year}";
    }

    /* ==================================================================== */
    /* Seriler: aralık gün, hafta ya da aya bölünüyor                        */
    /* ==================================================================== */

    private sealed record Dilim(DateTime Bas, DateTime Bit, string Etiket)
    {
        public int Gun => (Bit - Bas).Days + 1;
    }

    /// <summary>
    /// Grafik dilimleri. Telefon genişliğinde okunabilir çubuk sayısı
    /// sınırlı: 16 güne kadar gün gün, 70 güne kadar hafta hafta
    /// (aralığın ilk gününden başlayarak), daha uzunsa ay ay.
    /// </summary>
    private static (List<Dilim> Liste, string Birim) Dilimler(Aralik a)
    {
        var l = new List<Dilim>();

        if (a.Gun <= 16)
        {
            for (var g = a.Bas; g <= a.Bit; g = g.AddDays(1))
                l.Add(new Dilim(g, g, g.Day.ToString("00", Inv)));

            return (l, "gün");
        }

        if (a.Gun <= 70)
        {
            for (var g = a.Bas; g <= a.Bit; g = g.AddDays(7))
            {
                var son = g.AddDays(6) > a.Bit ? a.Bit : g.AddDays(6);
                l.Add(new Dilim(g, son, g.ToString("dd.MM", Inv)));
            }

            return (l, "hafta");
        }

        for (var ay = new DateTime(a.Bas.Year, a.Bas.Month, 1); ay <= a.Bit; ay = ay.AddMonths(1))
        {
            var b = ay < a.Bas ? a.Bas : ay;
            var s = ay.AddMonths(1).AddDays(-1) > a.Bit ? a.Bit : ay.AddMonths(1).AddDays(-1);
            l.Add(new Dilim(b, s, AyKisa[ay.Month - 1]));
        }

        return (l, "ay");
    }

    /// <summary>
    /// Günlük değerden seri: [[etiket, değer]]. <paramref name="ortalama"/>
    /// kişi sayıları için (dilimdeki günlük ortalama), değilse toplam
    /// (adet, tutar).
    /// </summary>
    private static List<object[]> Seri(Aralik a, Func<DateTime, decimal> gunluk, bool ortalama) =>
        Dilimler(a).Liste
            .Select(d =>
            {
                decimal t = 0;
                for (var g = d.Bas; g <= d.Bit; g = g.AddDays(1)) t += gunluk(g);

                return new object[] { d.Etiket, N(ortalama ? Math.Round(t / d.Gun, 1) : t) };
            })
            .ToList();

    /* ==================================================================== */
    /* Veri kümesi: aralıkta okutma, izin, rapor                             */
    /* ==================================================================== */

    private sealed class AralikKisi
    {
        public PersonelKaydi P;
        public string Kod;
        public string SubeKodu;
        public string SubeAdi;

        /// <summary>Gün gün okuttu mu (sıra = aralığın kaçıncı günü)</summary>
        public bool[] Gunler;

        /// <summary>Gün gün izinli / raporlu; izni yoksa null</summary>
        public bool[] Izin;

        public bool[] Rapor;

        /// <summary>Günlerin ilk girişlerinin saati (0–23 sayaç); hiç girişi yoksa null</summary>
        public int[] Saat;

        public int OkutmaGun;
        public int IzinGun;
        public int RaporGun;
        public int GecGun;
        public bool Muaf;

        public bool Okuttu => OkutmaGun > 0;

        /// <summary>Aralığın tamamında raporlu (panel raporundaki gibi beklenene girmiyor)</summary>
        public bool TamRaporlu;

        public bool TamIzinli;

        public bool OkutmadiMi => !Okuttu && !TamRaporlu && !Muaf;
        public bool Beklenen => Okuttu || (!TamRaporlu && !Muaf);

        /// <summary>Ekip satırındaki durum: okuttu · yok · izin · rapor</summary>
        public string Durum => Okuttu ? "okuttu" : TamRaporlu ? "rapor" : TamIzinli ? "izin" : "yok";
    }

    private sealed class AralikVeri
    {
        public Aralik A;
        public List<AralikKisi> Kisiler = new();
        public Dictionary<string, AralikKisi> KodIle = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Aralıkta vardiya planı girilmiş mi (geç kalan ölçülebilir mi)</summary>
        public bool PlanVar;
    }

    private const string GirisSql = "(N'1', N'in', N'giris', N'giriş', N'entry', N'input')";

    /// <summary>
    /// Aralığın okutma, izin ve rapor verisi, kişi kişi ve gün gün.
    ///
    /// <para>
    /// Kart geçiş sistemi (iCard) ve uygulama okutmaları kişi-gün başına bir
    /// satıra indirilerek okunuyor (ilk giriş saatiyle): bir yıllık aralıkta
    /// bile satır sayısı kişi × gün ile sınırlı. Okutma panelin aralık
    /// raporundaki gibi; geç kalma canlı ekrandaki kural (vardiya planı +
    /// 5 dk), gün gün.
    /// </para>
    /// </summary>
    private AralikVeri AralikVerisi(Aralik a) => PatronOnbellegi.Al($"okA|{a.Anahtar}", a.Omur, () =>
    {
        var birim = Birimler();
        var veri = new AralikVeri { A = a };

        foreach (var p in _kaynak.TumPersonelleriGetir()
                     .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
                     .Where(x => x.GirisTarihi is null || x.GirisTarihi.Value.Date <= a.Bit))
        {
            var kod = birim.KodBul(p.Sube);

            var kisi = new AralikKisi
            {
                P = p,
                Kod = K(p.PersonelKodu),
                SubeKodu = kod,
                SubeAdi = birim.Tanim(kod)?.Ad ?? K(p.Sube),
                Gunler = new bool[a.Gun]
            };

            if (veri.KodIle.TryAdd(kisi.Kod, kisi)) veri.Kisiler.Add(kisi);
        }

        var kimlikIle = new Dictionary<string, AralikKisi>(StringComparer.Ordinal);

        foreach (var k in veri.Kisiler)
        {
            var kimlik = Rakam(k.P.KimlikNo);
            if (kimlik.Length == 11) kimlikIle.TryAdd(kimlik, k);
        }

        /* ------------------------------------------- kişi-gün ilk girişleri */
        var ilkGiris = new Dictionary<(AralikKisi, int), DateTime?>();

        void Ekle(AralikKisi k, DateTime? gun, DateTime? giris)
        {
            if (k is null || gun is not DateTime g) return;

            var i = a.Sira(g);
            if (i < 0 || i >= a.Gun) return;

            k.Gunler[i] = true;

            if (ilkGiris.TryGetValue((k, i), out var mevcut))
            {
                if (giris is DateTime yeni && (mevcut is null || yeni < mevcut)) ilkGiris[(k, i)] = yeni;
            }
            else ilkGiris[(k, i)] = giris;
        }

        try
        {
            using var gecis = _vt.GecisBaglantisi();

            foreach (var x in gecis.Query<(string Kimlik, DateTime? Gun, DateTime? Giris)>($@"
SELECT LTRIM(RTRIM(CONVERT(NVARCHAR(30), p.RegistrationNumber))) AS kimlik,
       CAST(t.TransitionDateTime AS DATE) AS gun,
       MIN(CASE WHEN LOWER(LTRIM(RTRIM(CAST(t.Direction AS NVARCHAR(20))))) IN {GirisSql}
                THEN t.TransitionDateTime END) AS giris
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) BETWEEN @bas AND @bit
  AND p.RegistrationNumber IS NOT NULL
GROUP BY LTRIM(RTRIM(CONVERT(NVARCHAR(30), p.RegistrationNumber))), CAST(t.TransitionDateTime AS DATE)",
                         new { bas = a.Bas, bit = a.Bit }, commandTimeout: 120))
            {
                if (kimlikIle.TryGetValue(Rakam(x.Kimlik), out var k)) Ekle(k, x.Gun, x.Giris);
            }
        }
        catch (Exception hata)
        {
            /* iCard kapalıysa uygulama okutmalarıyla devam (panelle aynı) */
            _kayit.LogWarning(hata, "Patron görünümü: aralıktaki iCard hareketleri alınamadı");
        }

        try
        {
            using var db = _vt.Baglanti();

            foreach (var x in db.Query<(string Kod, DateTime? Gun, DateTime? Giris)>($@"
SELECT LTRIM(RTRIM(personel_kodu)) AS kod,
       CAST(gecis_zamani AS DATE) AS gun,
       MIN(CASE WHEN LOWER(LTRIM(RTRIM(tur))) IN {GirisSql} THEN gecis_zamani END) AS giris
FROM KRY_VARDIYA
WHERE gecis_zamani >= @bas AND gecis_zamani < @bitSonra
  AND ISNULL(kaynak, N'mobil') <> N'kart'
GROUP BY LTRIM(RTRIM(personel_kodu)), CAST(gecis_zamani AS DATE)",
                         new { bas = a.Bas, bitSonra = a.BitSonrasi }, commandTimeout: 90))
            {
                if (veri.KodIle.TryGetValue(K(x.Kod), out var k)) Ekle(k, x.Gun, x.Giris);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron görünümü: aralıktaki uygulama okutmaları alınamadı");
        }

        /* ------------------------------------------------- vardiya planı */
        var plan = new Dictionary<(string, int), TimeSpan>();

        try
        {
            using var db = _vt.Baglanti();

            foreach (var x in db.Query<(string Kod, DateTime Gun, TimeSpan Baslangic)>(@"
SELECT LTRIM(RTRIM(p.personel_kodu)) AS kod, p.gun, MIN(s.baslangic) AS baslangic
FROM KRY_VARDIYA_PLAN p
    INNER JOIN KRY_VARDIYA_SABLON s ON s.id = p.sablon_id
WHERE p.gun BETWEEN @bas AND @bit AND p.tur NOT IN (N'izin', N'off')
GROUP BY LTRIM(RTRIM(p.personel_kodu)), p.gun", new { bas = a.Bas, bit = a.Bit }))
            {
                plan[(K(x.Kod).ToUpperInvariant(), a.Sira(x.Gun))] = x.Baslangic;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron görünümü: aralıktaki vardiya planı okunamadı");
        }

        veri.PlanVar = plan.Count > 0;

        foreach (var ((k, i), giris) in ilkGiris)
        {
            if (giris is not DateTime g) continue;

            k.Saat ??= new int[24];
            k.Saat[g.Hour]++;

            if (plan.TryGetValue((k.Kod.ToUpperInvariant(), i), out var basla) && g > a.Bas.AddDays(i) + basla + GecKalmaPayi)
                k.GecGun++;
        }

        /* ------------------------------------------------- izin, rapor */
        bool[] Isaretle(bool[] dizi, DateTime bas, DateTime bit)
        {
            for (var g = bas.Date < a.Bas ? a.Bas : bas.Date; g <= bit.Date && g <= a.Bit; g = g.AddDays(1))
            {
                dizi ??= new bool[a.Gun];
                dizi[a.Sira(g)] = true;
            }

            return dizi;
        }

        try
        {
            using var db = _vt.Baglanti();

            /* Izin/Durum ile aynı: çıkış ile dönüş arası */
            foreach (var x in db.Query<(string Kod, DateTime? Cikis, DateTime? Donus)>(@"
SELECT LTRIM(RTRIM(personel_kodu)), cikis_tarihi, donus_tarihi
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @bit AND donus_tarihi >= @bas",
                         new { bas = a.Bas, bit = a.Bit }))
            {
                if (x.Cikis is DateTime c && x.Donus is DateTime d && veri.KodIle.TryGetValue(K(x.Kod), out var k))
                    k.Izin = Isaretle(k.Izin, c, d);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron görünümü: aralıktaki izinler okunamadı");
        }

        var raporAnahtar = veri.Kisiler
            .GroupBy(k => RaporluServisi.Anahtar(k.Kod), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        foreach (var r in new RaporluServisi(_vt).Kayitlar(a.Bas, a.Bit))
        {
            if (raporAnahtar.TryGetValue(RaporluServisi.Anahtar(r.PersonelKodu), out var k))
                k.Rapor = Isaretle(k.Rapor, r.Baslangic, r.Bitis);
        }

        HashSet<string> muaf;

        try
        {
            muaf = OkutmaKurallari.MuafKodlari(_vt, a.Bas, a.Bit);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron görünümü: okutma muafiyetleri okunamadı");
            muaf = new HashSet<string>();
        }

        foreach (var k in veri.Kisiler)
        {
            k.OkutmaGun = k.Gunler.Count(x => x);
            k.RaporGun = k.Rapor?.Count(x => x) ?? 0;

            /* Raporlu gün izin sayılmıyor (canlı ekranda da rapor önce) */
            k.IzinGun = k.Izin is null ? 0 : Enumerable.Range(0, a.Gun).Count(i => k.Izin[i] && k.Rapor?[i] != true);

            k.TamRaporlu = k.RaporGun == a.Gun;
            k.TamIzinli = k.Izin is not null && Enumerable.Range(0, a.Gun).All(i => k.Izin[i] || k.Rapor?[i] == true);
            k.Muaf = !k.TamRaporlu && muaf.Contains(OkutmaKurallari.Anahtar(k.Kod));
        }

        return veri;
    });

    private sealed record AralikOzeti(
        int Beklenen, int Okutan, int Okutmadi, int Izinli, int Raporlu, int? GecKalan, decimal GunlukOrt)
    {
        public int? Oran => Beklenen > 0 ? (int)Math.Round((Beklenen - Okutmadi) * 100.0 / Beklenen) : null;
    }

    private static AralikOzeti AralikTopla(AralikVeri v, IEnumerable<AralikKisi> kisiler)
    {
        var l = kisiler as IList<AralikKisi> ?? kisiler.ToList();

        return new AralikOzeti(
            l.Count(x => x.Beklenen),
            l.Count(x => x.Okuttu),
            l.Count(x => x.OkutmadiMi),
            l.Count(x => x.IzinGun > 0),
            l.Count(x => x.RaporGun > 0),
            v.PlanVar ? l.Sum(x => x.GecGun) : null,
            N(Math.Round((decimal)l.Sum(x => x.OkutmaGun) / v.A.Gun, 1)));
    }

    /// <summary>Gün gün okutan kişi (seçilen kişiler için)</summary>
    private static Func<DateTime, decimal> GunlukOkutan(AralikVeri v, IEnumerable<AralikKisi> kisiler)
    {
        var sayac = new int[v.A.Gun];

        foreach (var k in kisiler)
            for (var i = 0; i < v.A.Gun; i++)
                if (k.Gunler[i]) sayac[i]++;

        return g => sayac[v.A.Sira(g)];
    }

    /// <summary>
    /// Saat saat ilk giriş. Bir günlük aralıkta kişi sayısı (canlı ekrandaki
    /// gibi), daha uzunsa günlük ortalama.
    /// </summary>
    private static List<object[]> AralikSaatlik(AralikVeri v, IEnumerable<AralikKisi> kisiler)
    {
        var toplam = new int[24];

        foreach (var k in kisiler.Where(x => x.Saat is not null))
            for (var s = 0; s < 24; s++)
                toplam[s] += k.Saat[s];

        return Enumerable.Range(0, 24)
            .Where(s => toplam[s] > 0)
            .Select(s => new object[]
            {
                s.ToString("00", Inv),
                v.A.Gun == 1 ? toplam[s] : N(Math.Round((decimal)toplam[s] / v.A.Gun, 1))
            })
            .ToList();
    }

    /// <summary>Şube koduna göre aralık kişileri</summary>
    private static Dictionary<string, List<AralikKisi>> SubeGruplari(AralikVeri v) =>
        v.Kisiler
            .Where(k => k.SubeKodu is not null)
            .GroupBy(k => k.SubeKodu, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Şube satırı (Subeler, Norm, Özet sıralaması) aralıkla: kadro şu an,
    /// okutma, izin ve rapor aralıktan. "içeride" yalnızca aralık bugünü
    /// kapsıyorsa (şu an mağazada olan).
    /// </summary>
    private static object SubeDisariAralik(SubeSatiri s, AralikVeri v, Dictionary<string, List<AralikKisi>> gruplar)
    {
        var o = v is null
            ? null
            : AralikTopla(v, gruplar.TryGetValue(s.T.Kod, out var l) ? l : new List<AralikKisi>());

        return new
        {
            ad = s.T.Ad,
            bolge = s.T.Bolge,
            mudur = s.Mudur,
            norm = s.NormDegeri,
            mevcut = s.Mevcut,
            eksik = s.Eksik,
            fazla = s.Fazla,
            iceride = v is not null && v.A.BugunDahil ? s.Canli?.Iceride : null,
            beklenen = o?.Beklenen,
            okutan = o?.Okutan,
            okutmadi = o?.Okutmadi,
            izinli = o?.Izinli,
            raporlu = o?.Raporlu,
            oran = o?.Oran
        };
    }

    /* ==================================================================== */
    /* Okutma akışı (aralıktaki son hareketler)                              */
    /* ==================================================================== */

    private sealed record AralikHareket(AralikKisi Kisi, DateTime Zaman, bool Giris, string Kaynak);

    /// <summary>
    /// Aralıktaki son hareketler, yeniden eskiye. Kişi süzgeci verilirse
    /// (şube, bölge) sorgu o kişilerle sınırlanıyor: şirket genelinin son
    /// hareketlerinde küçük bir şubenin satırı hiç çıkmayabilirdi.
    /// </summary>
    private List<AralikHareket> AralikAkis(AralikVeri v, List<AralikKisi> kume, string kumeAnahtari, int sinir) =>
        PatronOnbellegi.Al($"akisA|{v.A.Anahtar}|{kumeAnahtari}|{sinir}", v.A.Omur, () =>
        {
            var a = v.A;
            var suz = kume is { Count: > 0 and <= 1500 };
            var n = sinir * 3;
            var liste = new List<AralikHareket>();

            var kimlikIle = (suz ? kume : v.Kisiler)
                .Select(k => (Kimlik: Rakam(k.P.KimlikNo), Kisi: k))
                .Where(x => x.Kimlik.Length == 11)
                .GroupBy(x => x.Kimlik)
                .ToDictionary(g => g.Key, g => g.First().Kisi, StringComparer.Ordinal);

            var kodIle = suz
                ? kume.GroupBy(k => k.Kod, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase)
                : v.KodIle;

            try
            {
                if (!suz || kimlikIle.Count > 0)
                {
                    using var gecis = _vt.GecisBaglantisi();

                    foreach (var x in gecis.Query<(string Kimlik, DateTime? Zaman, string Yon)>($@"
SELECT TOP (@n) LTRIM(RTRIM(CONVERT(NVARCHAR(30), p.RegistrationNumber))) AS kimlik,
       t.TransitionDateTime AS zaman,
       CAST(t.Direction AS NVARCHAR(20)) AS yon
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) BETWEEN @bas AND @bit
  AND p.RegistrationNumber IS NOT NULL
  {(suz ? "AND LTRIM(RTRIM(CONVERT(NVARCHAR(30), p.RegistrationNumber))) IN @kimlikler" : "")}
ORDER BY t.TransitionDateTime DESC",
                                 new { n, bas = a.Bas, bit = a.Bit, kimlikler = kimlikIle.Keys.ToList() },
                                 commandTimeout: 60))
                    {
                        if (x.Zaman is DateTime z && a.Icinde(z) && kimlikIle.TryGetValue(Rakam(x.Kimlik), out var k))
                            liste.Add(new AralikHareket(k, z, PersonelController.GirisMi(x.Yon), MobilOkutmaKaynagi.ICard));
                    }
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron görünümü: aralık akışı (iCard) alınamadı");
            }

            try
            {
                using var db = _vt.Baglanti();

                foreach (var x in db.Query<(string Kod, DateTime Zaman, string Tur, string Kaynak)>($@"
SELECT TOP (@n) LTRIM(RTRIM(personel_kodu)) AS kod, gecis_zamani AS zaman, tur, kaynak
FROM KRY_VARDIYA
WHERE gecis_zamani >= @bas AND gecis_zamani < @bitSonra
  AND ISNULL(kaynak, N'mobil') <> N'kart'
  {(suz ? "AND personel_kodu IN @kodlar" : "")}
ORDER BY gecis_zamani DESC",
                             new { n, bas = a.Bas, bitSonra = a.BitSonrasi, kodlar = kodIle.Keys.ToList() },
                             commandTimeout: 60))
                {
                    if (kodIle.TryGetValue(K(x.Kod), out var k))
                        liste.Add(new AralikHareket(k, x.Zaman, PersonelController.GirisMi(x.Tur),
                            MobilOkutmaKaynagi.KaynakAdi(x.Kaynak)));
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron görünümü: aralık akışı (uygulama) alınamadı");
            }

            return liste.OrderByDescending(h => h.Zaman).Take(sinir).ToList();
        });

    private object AkisSatiri(AralikHareket h, Aralik a) => new
    {
        kod = h.Kisi.Kod,
        ad = Ad(h.Kisi.P),
        sube = h.Kisi.SubeAdi,
        poz = K(h.Kisi.P.Pozisyon),
        saat = Saat(h.Zaman),
        /* Birden çok günlük aralıkta satırın günü ("05.10") */
        tarih = a.Gun > 1 ? h.Zaman.ToString("dd.MM", Inv) : null,
        giris = h.Giris,
        kaynak = h.Kaynak,
        fotoUrl = PersonelFoto(h.Kisi.P)
    };

    private object AralikKisiSatiri(AralikKisi k, int? gun = null) => new
    {
        kod = k.Kod,
        ad = Ad(k.P),
        poz = K(k.P.Pozisyon),
        sube = k.SubeAdi,
        durum = k.Durum,
        saat = (string)null,
        okutmaGun = k.OkutmaGun,
        gun,
        fotoUrl = PersonelFoto(k.P)
    };

    /// <summary>Aralık bugünü kapsıyorsa şu an içerideki kişilerin kodları (canlı veriden)</summary>
    private HashSet<string> IceridekiKodlar(Aralik a)
    {
        if (!a.BugunDahil) return null;

        var canli = Guvenli("canlı okutma", Canli);

        return canli?.Kisiler
            .Where(k => k.Iceride)
            .Select(k => k.Kod)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    /* ==================================================================== */
    /* Veri kümesi: başvuru, kart, sirkülasyon, etik, giriş/çıkış            */
    /* ==================================================================== */

    private sealed class BasvuruAralikVeri
    {
        public Dictionary<DateTime, int> Gunluk = new();
        public int Toplam;
        public int Onceki;
        public List<(string Durum, int Adet)> Durumlar = new();
        public int Alinan;
        public double? OrtSureGun;
    }

    /// <summary>
    /// Aralıkta gelen başvurular (başvuru tarihine göre, kartlarla aynı
    /// taban), önceki eşit dönem, bugünkü durumlarına göre huni, aralıkta
    /// işe girenler ve aralıkta işe alınanların ortalama süresi.
    /// </summary>
    private BasvuruAralikVeri BasvuruAraligi(Aralik a) => PatronOnbellegi.Al($"basvuruA|{a.Anahtar}", a.Omur, () =>
    {
        using var db = _vt.Baglanti();

        using var cok = db.QueryMultiple($@"
SELECT CAST(b.olusturma AS DATE) AS gun, COUNT(*) AS adet
{BasvuruTabani}
  AND b.olusturma >= @bas AND b.olusturma < @bitSonra
GROUP BY CAST(b.olusturma AS DATE);

SELECT COUNT(*)
{BasvuruTabani}
  AND b.olusturma >= @oncekiBas AND b.olusturma < @bas;

SELECT b.durum AS durum, COUNT(*) AS adet
{BasvuruTabani}
  AND b.olusturma >= @bas AND b.olusturma < @bitSonra
GROUP BY b.durum;

SELECT COUNT(*)
{BasvuruTabani}
  AND b.durum = N'İşe Alındı'
  AND b.ise_giris_tarihi >= @bas AND b.ise_giris_tarihi < @bitSonra;

SELECT AVG(DATEDIFF(minute, b.olusturma, h.tarih) / 1440.0)
FROM KRY_BASVURULAR b
    INNER JOIN (SELECT basvuru_id, MIN(tarih) AS tarih
                FROM KRY_BASVURU_HAREKET
                WHERE durum = N'İşe Alındı'
                GROUP BY basvuru_id) h ON h.basvuru_id = b.id
WHERE ISNULL(b.arsiv, 0) = 0
  AND h.tarih >= @bas AND h.tarih < @bitSonra AND h.tarih >= b.olusturma;",
            new { bas = a.Bas, bitSonra = a.BitSonrasi, oncekiBas = a.OncekiBas }, commandTimeout: 60);

        var veri = new BasvuruAralikVeri
        {
            Gunluk = cok.Read<(DateTime Gun, int Adet)>().ToDictionary(x => x.Gun.Date, x => x.Adet),
            Onceki = cok.ReadFirstOrDefault<int>(),
            Durumlar = cok.Read<(string Durum, int Adet)>().ToList(),
            Alinan = cok.ReadFirstOrDefault<int>()
        };

        var ort = cok.ReadFirstOrDefault<decimal?>();
        veri.OrtSureGun = ort is decimal d ? Math.Round((double)d, 1) : null;
        veri.Toplam = veri.Gunluk.Values.Sum();

        return veri;
    });

    private sealed class KartAralikVeri
    {
        public decimal Yuklenen;
        public decimal Harcanan;
        public int Islem;
        public Dictionary<DateTime, decimal> Gunluk = new();
        public List<object> Subeler = new();
        public List<object> SonIslemler = new();
    }

    /// <summary>
    /// Aralıktaki kart yüklemesi ve harcaması: Kart Raporları ekranının
    /// formülleri (yükleme = işlem tipi 3, harcama = HARCAMA), kart kümesi
    /// eşleşmiş personel kartları (<see cref="KartBugun"/> ile aynı).
    /// </summary>
    private KartAralikVeri KartAraligi(Aralik a) => PatronOnbellegi.Al($"kartA|{a.Anahtar}", a.Omur, () =>
        Kapsamda<BicenKartRaporController, KartAralikVeri>(rapor =>
        {
            var sahipler = rapor.Kartlar();
            var veri = new KartAralikVeri();

            if (sahipler.Count == 0) return veri;

            var giftKart = rapor.HttpContext.RequestServices.GetRequiredService<GiftKartServisi>();

            using var pos = rapor.KartTablosuylaAc(sahipler.Keys);

            const string h = BicenKartRaporController.HAREKET;
            const string harcama = BicenKartRaporController.HARCAMA;

            using var cok = pos.QueryMultiple($@"
SELECT SUM(CASE WHEN h.IslemTipi = 3 THEN ABS(ISNULL(h.Puan, 0)) ELSE 0 END) AS yuklenen,
       SUM(CASE WHEN h.IslemTipi = 2 THEN {harcama} ELSE 0 END) AS harcanan,
       SUM(CASE WHEN h.IslemTipi = 2 THEN 1 ELSE 0 END) AS islem
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.Tarih >= @bas AND h.Tarih < @bitSonra AND h.IslemTipi IN (2, 3);

SELECT CAST(h.Tarih AS DATE) AS gun, SUM({harcama}) AS tutar
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bas AND h.Tarih < @bitSonra
GROUP BY CAST(h.Tarih AS DATE);

SELECT h.SubeId AS subeId, SUM({harcama}) AS tutar
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bas AND h.Tarih < @bitSonra
GROUP BY h.SubeId;

SELECT TOP {AkisSiniri} h.Tarih AS tarih, CONVERT(VARCHAR(20), h.KartNo) AS kartNo, {harcama} AS tutar
FROM {h} h WITH (NOLOCK) INNER JOIN #k k ON k.KartNo = h.KartNo
WHERE h.IslemTipi = 2 AND h.Tarih >= @bas AND h.Tarih < @bitSonra
ORDER BY h.Tarih DESC;", new { bas = a.Bas, bitSonra = a.BitSonrasi }, commandTimeout: 180);

            var toplam = cok.ReadFirstOrDefault();
            veri.Yuklenen = N(Ondalik((object)toplam?.yuklenen));
            veri.Harcanan = N(Ondalik((object)toplam?.harcanan));
            veri.Islem = Tam((object)toplam?.islem);

            veri.Gunluk = cok.Read().ToDictionary(x => ((DateTime)x.gun).Date, x => Ondalik((object)x.tutar));

            veri.Subeler = cok.Read()
                .Select(x => new
                {
                    ad = giftKart.SubeAdiBul((object)x.subeId) ?? "Şube belirsiz",
                    tutar = N(Ondalik((object)x.tutar))
                })
                .OrderByDescending(x => x.tutar)
                .Cast<object>()
                .ToList();

            veri.SonIslemler = cok.Read()
                .Select(x =>
                {
                    var no = K((string)x.kartNo);
                    sahipler.TryGetValue(no, out var s);
                    var t = (DateTime?)x.tarih;

                    return (object)new
                    {
                        ad = s?.AdSoyad,
                        sube = s?.Sube,
                        tutar = N(Ondalik((object)x.tutar)),
                        saat = Saat(t),
                        tarih = a.Gun > 1 ? t?.ToString("dd.MM", Inv) : null,
                        kartSon4 = KartAyrilan.SonDort(no)
                    };
                })
                .ToList();

            return veri;
        }));

    private sealed class SirkulasyonAralikVeri
    {
        public int Giris;
        public int Cikis;
        public double Oran;
        public double YillikOran;
        public List<object> Nedenler = new();
        public List<object> Seri = new();
        public int? Ilk90Orani;
    }

    /// <summary>
    /// Aralıkta sirkülasyon: oran ve nedenler panelin Sirkülasyon ucundan
    /// (aynı aralıkla), seri ve ilk 90 gün personel listesinden (giriş/çıkış
    /// tarihi) — <see cref="Sirkulasyon"/> ile aynı yol.
    /// </summary>
    private SirkulasyonAralikVeri SirkulasyonAraligi(Aralik a) => PatronOnbellegi.Al($"sirkA|{a.Anahtar}", a.Omur, () =>
    {
        var donem = Cagir<PersonelController>(c => c.Sirkulasyon(a.Bas, a.Bit))
                    ?? throw new InvalidOperationException("Sirkülasyon alınamadı.");

        var veri = new SirkulasyonAralikVeri
        {
            Giris = Tam(Alan(donem, "giren")),
            Cikis = Tam(Alan(donem, "cikan")),
            Oran = Convert.ToDouble(Ondalik(Alan(donem, "devirOrani"))),
            YillikOran = Convert.ToDouble(Ondalik(Alan(donem, "yillikDevir"))),
            Nedenler = Dizi(Alan(donem, "sebepler"))
                .Select(x => (object)new { neden = (string)Alan(x, "sebep"), adet = Tam(Alan(x, "adet")) })
                .Take(10)
                .ToList()
        };

        var tumu = _kaynak.TumPersonelleriGetir();
        var bugunSonu = DateTime.Today.AddDays(1);

        veri.Seri = Dilimler(a).Liste
            .Select(d => (object)new
            {
                etiket = d.Etiket,
                giris = tumu.Count(p => p.GirisTarihi >= d.Bas && p.GirisTarihi < d.Bit.AddDays(1) && p.GirisTarihi < bugunSonu),
                cikis = tumu.Count(p => p.CikisTarihi >= d.Bas && p.CikisTarihi < d.Bit.AddDays(1) && p.CikisTarihi < bugunSonu)
            })
            .ToList();

        var cikanlar = tumu.Where(p => a.Icinde(p.CikisTarihi)).ToList();

        veri.Ilk90Orani = cikanlar.Count > 0
            ? (int)Math.Round(cikanlar.Count(p => p.CalismaGunu >= 0 && p.CalismaGunu < 90) * 100.0 / cikanlar.Count)
            : null;

        return veri;
    });

    private sealed class EtikAralikVeri
    {
        public int Donem;
        public List<object> Son = new();
    }

    /// <summary>Aralıkta gelen etik bildirimleri: yine yalnızca tür, durum ve tarih.</summary>
    private EtikAralikVeri EtikAraligi(Aralik a) => PatronOnbellegi.Al($"etikA|{a.Anahtar}", a.Omur, () =>
    {
        using var db = _vt.Baglanti();

        using var cok = db.QueryMultiple(@"
SELECT COUNT(*) FROM KRY_ETIK WHERE olusturma >= @bas AND olusturma < @bitSonra;

SELECT TOP 20 tur, durum, olusturma FROM KRY_ETIK
WHERE olusturma >= @bas AND olusturma < @bitSonra
ORDER BY olusturma DESC;", new { bas = a.Bas, bitSonra = a.BitSonrasi });

        return new EtikAralikVeri
        {
            Donem = cok.ReadFirstOrDefault<int>(),
            Son = cok.Read()
                .Select(x => (object)new
                {
                    baslik = (string)x.tur,
                    durum = EtikDurumAdi.GetValueOrDefault(K((string)x.durum)) ?? (string)x.durum,
                    tarih = Iso((DateTime?)x.olusturma)
                })
                .ToList()
        };
    });

    /// <summary>
    /// Performans aylık bir ölçü: aralığın bittiği ayın dönemi, o ay için
    /// veri yoksa bir önceki ay.
    /// </summary>
    private object PerformansAraligi(Aralik a) =>
        PerformansDonemi(a.Bit.Year, a.Bit.Month)
        ?? PerformansDonemi(a.Bit.AddMonths(-1).Year, a.Bit.AddMonths(-1).Month);

    /// <summary>Aralıkta işe girenler ve ayrılanlar, şube şube (norm ekranı)</summary>
    private List<(string SubeKodu, bool Giris)> GirisCikislar(Aralik a) => PatronOnbellegi.Al($"normDonem|{a.Anahtar}", a.Omur, () =>
    {
        var birim = Birimler();
        var bugunSonu = DateTime.Today.AddDays(1);
        var l = new List<(string, bool)>();

        foreach (var p in _kaynak.TumPersonelleriGetir())
        {
            if (a.Icinde(p.GirisTarihi) && p.GirisTarihi < bugunSonu) l.Add((birim.KodBul(p.Sube), true));
            if (a.Icinde(p.CikisTarihi) && p.CikisTarihi < bugunSonu) l.Add((birim.KodBul(p.Sube), false));
        }

        return l;
    });

    /* ==================================================================== */
    /* Uçların aralıklı yanıtları                                            */
    /* ==================================================================== */

    /// <summary>
    /// Özet, aralıkla. Bölümler canlı özetteki gibi paralel ve biri
    /// okunamazsa yalnızca o bölüm null. "canli" (şu an mağazada) yerine
    /// <c>okutma</c> bölümü; norm ve bekleyen onaylar şu an.
    /// </summary>
    private async Task<object> AralikOzet(Aralik a)
    {
        if (PatronOnbellegi.Dene($"ozetA|{a.Anahtar}", out var hazir)) return hazir;

        var tVeri = Paralel("aralık okutma", () => AralikVerisi(a));
        var tNorm = Paralel("norm kadro", Norm);
        var tOnay = Paralel("onaylar", Onaylar);
        var tBasvuru = Paralel("başvuru aralığı", () => BasvuruAraligi(a));
        var tBasvuruSu = Paralel("başvurular", Basvurular);
        var tKart = Paralel("kart aralığı", () => KartAraligi(a));
        var tKartSu = Paralel("Biçen Kart", KartBugun);
        var tSirk = Paralel("sirkülasyon aralığı", () => SirkulasyonAraligi(a));
        var tEtik = Paralel("etik hat", Etik);

        await Task.WhenAll(tVeri, tNorm, tOnay, tBasvuru, tBasvuruSu, tKart, tKartSu, tSirk, tEtik);

        var v = tVeri.Result;
        var norm = tNorm.Result;
        var onay = tOnay.Result;
        var basvuru = tBasvuru.Result;
        var basvuruSu = tBasvuruSu.Result;
        var kart = tKart.Result;
        var sirk = tSirk.Result;
        var etik = tEtik.Result;

        var subeler = await Paralel("şubeler", SubeSatirlari);
        var birim = Guvenli("birimler", Birimler);
        var gruplar = v is null ? null : SubeGruplari(v);

        int? calisan = Guvenli("personel", () => (object)_kaynak.TumPersonelleriGetir().Count(x => x.Durum == 1)) as int?;

        /* ------------------------------------------------------ okutma */
        object okutma = null;

        if (v is not null)
        {
            var o = AralikTopla(v, v.Kisiler);
            var son = Guvenli("aralık akışı", () => AralikAkis(v, null, "", 1))?.FirstOrDefault();

            okutma = new
            {
                beklenen = o.Beklenen,
                okutan = o.Okutan,
                okutmadi = o.Okutmadi,
                izinli = o.Izinli,
                raporlu = o.Raporlu,
                gecKalan = o.GecKalan,
                oran = o.Oran,
                gunlukOrt = o.GunlukOrt,
                seri = Seri(a, GunlukOkutan(v, v.Kisiler), true),
                sonOkutma = son is null
                    ? null
                    : new { saat = Saat(son.Zaman), tarih = son.Zaman.ToString("dd.MM", Inv), sube = son.Kisi.SubeAdi }
            };
        }

        /* ---------------------------------------------------- başvuru */
        object basvuruBolum = null;

        if (basvuru is not null)
        {
            basvuruBolum = new
            {
                toplam = basvuru.Toplam,
                onceki = basvuru.Onceki,
                alinan = basvuru.Alinan,
                seri = Seri(a, g => basvuru.Gunluk.GetValueOrDefault(g), false),
                islemsiz = basvuruSu?.Islemsiz,
                enEskiGun = basvuruSu?.EnEskiGun
            };
        }

        /* ------------------------------------------------------ dikkat */
        var dikkat = new List<object>();

        if (subeler is not null && gruplar is not null)
        {
            foreach (var x in subeler
                         .Where(s => s.T.Satis)
                         .Select(s => (S: s, O: AralikTopla(v, gruplar.TryGetValue(s.T.Kod, out var l) ? l : new List<AralikKisi>())))
                         .Where(x => x.O.Beklenen >= 3 && x.O.Oran < 75)
                         .OrderBy(x => x.O.Oran)
                         .Take(2))
            {
                dikkat.Add(new
                {
                    tur = "okutma",
                    baslik = $"{x.S.T.Ad}: okutma %{x.O.Oran}",
                    alt = $"{x.O.Okutmadi} kişi bu aralıkta hiç okutmadı"
                          + (string.IsNullOrWhiteSpace(x.S.Mudur) ? "" : $" · Md. {x.S.Mudur}"),
                    hedef = new { ekran = "sube", p = x.S.T.Ad }
                });
            }
        }

        if (norm is not null)
        {
            var enUzun = norm.Satirlar
                .Where(x => !string.IsNullOrWhiteSpace(x.SubeKodu))
                .SelectMany(x => x.Eksikler.Select(e => (Sube: x.SubeAdi, Eksik: e)))
                .OrderByDescending(x => x.Eksik.Gun)
                .ThenByDescending(x => x.Eksik.Adet)
                .FirstOrDefault();

            if (enUzun.Eksik is not null)
                dikkat.Add(new
                {
                    tur = "kadro",
                    baslik = $"{enUzun.Sube}: {Adet(enUzun.Eksik.Adet)} {Kucuk(enUzun.Eksik.Bolum)} eksik",
                    alt = enUzun.Eksik.Gun > 0 ? $"{enUzun.Eksik.Gun} gündür doldurulamadı" : "Yeni açıldı",
                    hedef = new { ekran = "sube", p = enUzun.Sube }
                });
        }

        if (basvuruSu is { Islemsiz: > 0 })
            dikkat.Add(new
            {
                tur = "basvuru",
                baslik = $"{basvuruSu.Islemsiz} başvuru {IslemsizGun}+ gündür işlemsiz",
                alt = $"En eskisi {basvuruSu.EnEskiGun} gün",
                hedef = new { ekran = "basvurular", p = "islemsiz" }
            });

        if (etik is { Yeni: > 0 })
            dikkat.Add(new
            {
                tur = "etik",
                baslik = $"Etik hatta {etik.Yeni} yeni bildirim",
                alt = etik.SonYeni is DateTime t ? GunSaat(t) : null,
                hedef = new { ekran = "ik", p = (string)null }
            });

        var veri = new
        {
            zaman = Iso(DateTime.Now),
            aralik = a.Disari(),
            calisan,
            birimSayisi = birim?.Subeler.Count(x => x.Satis),
            okutma,
            onay = onay is null
                ? null
                : new
                {
                    toplam = onay.Turler.Sum(x => x.Adet),
                    turler = onay.Turler.Select(x => new { tur = x.Tur, adet = x.Adet }).ToList(),
                    aralikta = onay.Tarihler.Count(t => a.Icinde(t))
                },
            norm = norm is null
                ? null
                : new
                {
                    norm = N(norm.Satirlar.Sum(x => x.Norm)),
                    mevcut = N(norm.Satirlar.Sum(x => x.Mevcut)),
                    eksik = N(norm.Satirlar.Sum(x => x.Eksikler.Sum(e => e.Adet))),
                    fazla = N(norm.Satirlar.Sum(x => x.Fazlalar.Sum(e => e.Adet))),
                    doluluk = Doluluk(norm.Satirlar.Sum(x => x.Norm), norm.Satirlar.Sum(x => x.Eksikler.Sum(e => e.Adet))),
                    eksikSube = norm.Satirlar.Count(x => !string.IsNullOrWhiteSpace(x.SubeKodu) && x.Eksikler.Count > 0)
                },
            basvuru = basvuruBolum,
            kart = kart is null
                ? null
                : new { harcanan = kart.Harcanan, yuklenen = kart.Yuklenen, aktifKart = tKartSu.Result?.AktifKart },
            sirkulasyon = sirk is null
                ? null
                : new
                {
                    giris = sirk.Giris,
                    cikis = sirk.Cikis,
                    oran = sirk.Oran,
                    seri = sirk.Seri
                },
            seriBirim = Dilimler(a).Birim,
            dikkat = dikkat.Take(5).ToList(),
            subeSirasi = subeler is null || gruplar is null
                ? null
                : subeler
                    .Where(x => x.T.Satis)
                    .Select(x => (S: x, O: AralikTopla(v, gruplar.TryGetValue(x.T.Kod, out var l) ? l : new List<AralikKisi>())))
                    .OrderByDescending(x => x.O.Oran ?? -1)
                    .ThenBy(x => x.S.T.Ad, StringComparer.Create(Tr, true))
                    .Take(40)
                    .Select(x => new
                    {
                        ad = x.S.T.Ad,
                        bolge = x.S.T.Bolge,
                        oran = x.O.Oran,
                        okutan = x.O.Okutan,
                        beklenen = x.O.Beklenen,
                        mevcut = x.S.Mevcut,
                        norm = x.S.NormDegeri
                    })
                    .ToList()
        };

        PatronOnbellegi.Koy($"ozetA|{a.Anahtar}", veri, a.Omur);

        return veri;
    }

    private IActionResult SubelerAralik(Aralik a)
    {
        var satirlar = Guvenli("şubeler", SubeSatirlari) ?? new List<SubeSatiri>();
        var birim = Guvenli("birimler", Birimler);
        var v = Guvenli("aralık okutma", () => AralikVerisi(a));
        var gruplar = v is null ? null : SubeGruplari(v);

        return Ok(new
        {
            aralik = a.Disari(),
            bolgeler = birim?.Bolgeler ?? new List<string>(),
            subeler = satirlar.Select(x => SubeDisariAralik(x, v, gruplar)).ToList()
        });
    }

    private IActionResult SubeAralik(Aralik a, SubeSatiri s)
    {
        var v = Guvenli("aralık okutma", () => AralikVerisi(a));
        var norm = Guvenli("norm kadro", Norm);
        var iceride = IceridekiKodlar(a);

        var kisiler = v?.Kisiler.Where(k => Esit(k.SubeKodu, s.T.Kod)).ToList() ?? new List<AralikKisi>();
        var o = v is null ? null : AralikTopla(v, kisiler);

        /* Ekip: hiç okutmayanlar önce, sonra okutanlar (az gün okutan önce), izinli, raporlu */
        var sira = new Dictionary<string, int> { ["yok"] = 0, ["okuttu"] = 1, ["izin"] = 2, ["rapor"] = 3 };

        return Ok(new
        {
            aralik = a.Disari(),
            ad = s.T.Ad,
            bolge = s.T.Bolge,
            mudur = s.Mudur,
            mudurTel = s.MudurTel,
            norm = s.NormDegeri,
            mevcut = s.Mevcut,
            eksik = s.Eksik,
            iceride = iceride is null ? (int?)null : kisiler.Count(k => iceride.Contains(k.Kod)),
            beklenen = o?.Beklenen,
            okutan = o?.Okutan,
            okutmadi = o?.Okutmadi,
            gecKalan = o?.GecKalan,
            izinli = o?.Izinli,
            raporlu = o?.Raporlu,
            oran = o?.Oran,
            gunlukOrt = o?.GunlukOrt,
            saatlik = v is null ? new List<object[]>() : AralikSaatlik(v, kisiler),
            seri = v is null ? new List<object[]>() : Seri(a, GunlukOkutan(v, kisiler), true),
            seriBirim = Dilimler(a).Birim,
            kadro = norm?.Kadro
                .Where(k => Esit(k.SubeKodu, s.T.Kod))
                .Select(k => new
                {
                    poz = K(k.Bolum),
                    norm = N(k.Norm),
                    mevcut = N(k.Mevcut),
                    eksik = N(Math.Max(0, k.Norm - k.Mevcut)),
                    gun = k.Norm > k.Mevcut && k.EksikGun > 0 ? (int?)k.EksikGun : null
                })
                .OrderByDescending(k => k.eksik)
                .ThenBy(k => k.poz, StringComparer.Create(Tr, true))
                .ToList(),
            ekip = kisiler
                .OrderBy(k => sira.GetValueOrDefault(k.Durum, 9))
                .ThenBy(k => k.OkutmaGun)
                .ThenBy(k => Ad(k.P), StringComparer.Create(Tr, true))
                .Take(ListeSiniri)
                .Select(k => AralikKisiSatiri(k))
                .ToList()
        });
    }

    private IActionResult OnaylarAralik(Aralik a, PersonelKaydi p)
    {
        var bekleyen = Guvenli("onaylar", Onaylar);
        var imza = Imza(p);

        var verilenler = Guvenli("verilen kararlar", () => PatronOnbellegi.Al($"verilen|{imza}|{a.Anahtar}", a.Omur, () =>
        {
            using var db = _vt.Baglanti();

            return db.Query<(int Id, string Tur, string Baslik, string AdSoyad, string Durum, string Not, DateTime? Tarih)>(@"
SELECT TOP 100 x.id, x.tur, x.baslik, x.ad_soyad, x.durum, x.onay_notu, x.onay_tarihi
FROM (
    SELECT o.id, o.tur, o.baslik, b.ad_soyad, o.durum, o.onay_notu, o.onay_tarihi
    FROM KRY_ONAY o
    LEFT JOIN KRY_BASVURULAR b ON b.id = o.basvuru_id
    WHERE o.onaylayan = @imza AND o.durum IN (@onay, @red)
      AND o.onay_tarihi >= @bas AND o.onay_tarihi < @bitSonra
    UNION ALL
    /* Biçen Kart puan talepleri (patron kararı) */
    SELECT -t.id, N'puan', t.aciklama, NULL,
           CASE WHEN t.durum = N'onaylandi' THEN @onay ELSE @red END, t.red_sebebi, t.karar_tarihi
    FROM KRY_PUAN_TALEP t
    WHERE t.karar_veren = @imza AND t.durum IN (N'onaylandi', N'reddedildi')
      AND t.karar_tarihi >= @bas AND t.karar_tarihi < @bitSonra
) x
ORDER BY x.onay_tarihi DESC",
                    new { imza, onay = OnayDurumu.Onaylandi, red = OnayDurumu.Reddedildi, bas = a.Bas, bitSonra = a.BitSonrasi })
                .Select(x => (object)new
                {
                    id = x.Id,
                    tur = TurKodu(x.Tur),
                    baslik = x.Tur == OnayTuru.NormKadro || string.IsNullOrWhiteSpace(x.AdSoyad)
                        ? K(x.Baslik)
                        : K(x.AdSoyad),
                    sonuc = x.Durum == OnayDurumu.Onaylandi ? "onay" : "red",
                    not = string.IsNullOrWhiteSpace(x.Not) ? null : K(x.Not),
                    saat = x.Tarih?.ToString("dd.MM HH:mm", Tr)
                })
                .ToList();
        }));

        var liste = bekleyen is null
            ? new List<object>()
            : bekleyen.Liste.Where((_, i) => a.Icinde(bekleyen.Tarihler[i])).ToList();

        /* Avans talepleri (07.10.2026): bu kişinin adımındakiler, aralıktan bağımsız başta */
        var avanslar = Guvenli("avans onayları", () => AvansOnaylari(p)) ?? new();
        var talepler = Guvenli("izin ve fazla mesai onayları", () => PersonelTalepOnaylari(p)) ?? new();
        liste = avanslar.Select(x => x.Kayit).Concat(talepler.Select(x => x.Kayit)).Concat(liste).ToList();

        return Ok(new
        {
            aralik = a.Disari(),
            onaylar = liste.Take(ListeSiniri).ToList(),
            /* Bekleyenler talep tarihine göre süzülüyor; aralığın dışında
               kalan bekleyen onay unutulmasın diye sayısı ayrıca */
            toplamBekleyen = bekleyen?.Liste.Count,
            disarida = bekleyen is null ? (int?)null : bekleyen.Liste.Count - liste.Count,
            verilenler = verilenler ?? new List<object>()
        });
    }

    private IActionResult BasvurularAralik(Aralik a, string durum, string ara)
    {
        var veri = Guvenli("başvuru aralığı", () => BasvuruAraligi(a));
        var su = Guvenli("başvurular", Basvurular);
        var liste = Guvenli("başvuru listesi", () => AdayListesi(durum, ara, ListeSiniri, a));

        return Ok(new
        {
            aralik = a.Disari(),
            toplam = veri?.Toplam,
            onceki = veri?.Onceki,
            alinan = veri?.Alinan,
            ortSureGun = veri?.OrtSureGun,
            islemsiz = su?.Islemsiz,
            huni = veri is null
                ? new List<object>()
                : HuniSirasi
                    .Select(d => (Durum: d, Adet: veri.Durumlar.Where(x => x.Durum == d).Sum(x => x.Adet)))
                    .Where(x => x.Adet > 0 || HuniHepGorunen.Contains(x.Durum))
                    .Select(x => (object)new { durum = x.Durum, adet = x.Adet })
                    .ToList(),
            seri = veri is null ? new List<object[]>() : Seri(a, g => veri.Gunluk.GetValueOrDefault(g), false),
            seriBirim = Dilimler(a).Birim,
            liste = liste ?? new List<object>()
        });
    }

    private IActionResult NormAralik(Aralik a, string bolge, object klasik)
    {
        var subeler = Guvenli("şubeler", SubeSatirlari) ?? new List<SubeSatiri>();
        var birim = Guvenli("birimler", Birimler);
        var v = Guvenli("aralık okutma", () => AralikVerisi(a));
        var gruplar = v is null ? null : SubeGruplari(v);
        var hareket = Guvenli("giriş/çıkış", () => GirisCikislar(a));

        var bolgeVar = !string.IsNullOrWhiteSpace(bolge);

        bool BolgedeMi(string subeKodu) =>
            !bolgeVar || Esit(birim?.Tanim(subeKodu)?.Bolge, bolge);

        var donemHareket = hareket?.Where(x => BolgedeMi(x.SubeKodu)).ToList();

        /* Klasik yanıtın alanları (kadro şu an) + aralık */
        var yanit = klasik.GetType().GetProperties().ToDictionary(x => x.Name, x => x.GetValue(klasik));

        yanit["aralik"] = a.Disari();
        yanit["donem"] = donemHareket is null
            ? null
            : new
            {
                giris = donemHareket.Count(x => x.Giris),
                cikis = donemHareket.Count(x => !x.Giris),
                subeler = donemHareket
                    .Where(x => x.SubeKodu is not null)
                    .GroupBy(x => x.SubeKodu, StringComparer.OrdinalIgnoreCase)
                    .Select(g => new
                    {
                        ad = birim?.Tanim(g.Key)?.Ad ?? g.Key,
                        giris = g.Count(x => x.Giris),
                        cikis = g.Count(x => !x.Giris)
                    })
                    .OrderByDescending(x => x.giris + x.cikis)
                    .ThenBy(x => x.ad, StringComparer.Create(Tr, true))
                    .Take(10)
                    .ToList()
            };
        yanit["subeler"] = subeler
            .Where(x => !bolgeVar || Esit(x.T.Bolge, bolge))
            .Select(x => SubeDisariAralik(x, v, gruplar))
            .ToList();

        return Ok(yanit);
    }

    private IActionResult GecisAralik(Aralik a, string filtre)
    {
        var v = Guvenli("aralık okutma", () => AralikVerisi(a));

        if (v is null)
            return Ok(new
            {
                aralik = a.Disari(),
                iceride = (int?)null, okutan = (int?)null, okutmadi = (int?)null, gecKalan = (int?)null,
                beklenen = (int?)null, oran = (int?)null,
                saatlik = new List<object[]>(), seri = new List<object[]>(), seriBirim = Dilimler(a).Birim,
                akis = new List<object>(), okutmayanlar = new List<object>()
            });

        IEnumerable<AralikKisi> kisiler = v.Kisiler;
        var anahtar = "";

        if (!string.IsNullOrWhiteSpace(filtre))
        {
            var birim = Birimler();
            var f = K(filtre);

            if (birim.Bolgeler.Any(b => Esit(b, f)))
            {
                kisiler = kisiler.Where(k => Esit(birim.Tanim(k.SubeKodu)?.Bolge, f));
                anahtar = "b:" + Ust(f);
            }
            else
            {
                var sube = Guvenli("şube", () => SubeBul(f));

                kisiler = sube is not null
                    ? kisiler.Where(k => Esit(k.SubeKodu, sube.T.Kod))
                    : kisiler.Where(k => Esit(k.P.Sube, f));
                anahtar = "s:" + (sube?.T.Kod ?? Ust(f));
            }
        }

        var liste = kisiler.ToList();
        var o = AralikTopla(v, liste);
        var iceride = IceridekiKodlar(a);
        var akis = Guvenli("aralık akışı", () => AralikAkis(v, anahtar.Length > 0 ? liste : null, anahtar, AkisSiniri))
                   ?? new List<AralikHareket>();

        return Ok(new
        {
            aralik = a.Disari(),
            iceride = iceride is null ? (int?)null : liste.Count(k => iceride.Contains(k.Kod)),
            okutan = o.Okutan,
            okutmadi = o.Okutmadi,
            gecKalan = o.GecKalan,
            beklenen = o.Beklenen,
            oran = o.Oran,
            gunlukOrt = o.GunlukOrt,
            saatlik = AralikSaatlik(v, liste),
            seri = Seri(a, GunlukOkutan(v, liste), true),
            seriBirim = Dilimler(a).Birim,
            akis = akis.Select(h => AkisSatiri(h, a)).ToList(),
            okutmayanlar = liste
                .Where(k => k.OkutmadiMi)
                .OrderBy(k => k.SubeAdi, StringComparer.Create(Tr, true))
                .ThenBy(k => Ad(k.P), StringComparer.Create(Tr, true))
                .Take(ListeSiniri)
                .Select(k => new { kod = k.Kod, ad = Ad(k.P), sube = k.SubeAdi, poz = K(k.P.Pozisyon), fotoUrl = PersonelFoto(k.P) })
                .ToList()
        });
    }

    private async Task<IActionResult> KartAralik(Aralik a)
    {
        var tAralik = Paralel("kart aralığı", () => KartAraligi(a));
        var tBugun = Paralel("kart bugün", KartBugun);
        var tGenel = Paralel("kart bakiye", KartGenel);
        var tBaglanti = Paralel("kart bağlantıları", KartBaglanti);
        var tPuan = Paralel("puan onayı", PuanOnay);

        await Task.WhenAll(tAralik, tBugun, tGenel, tBaglanti, tPuan);

        var ar = tAralik.Result;
        var bugun = tBugun.Result;

        return Ok(new
        {
            aralik = a.Disari(),
            /* şu an */
            toplamBakiye = tGenel.Result?.ToplamBakiye,
            aktifKart = bugun?.AktifKart,
            uygulamaOrani = bugun?.UygulamaOrani,
            baglanti = tBaglanti.Result,
            puanOnay = tPuan.Result,
            /* aralık */
            yuklenen = ar?.Yuklenen,
            harcanan = ar?.Harcanan,
            islem = ar?.Islem,
            seri = ar is null ? new List<object[]>() : Seri(a, g => ar.Gunluk.GetValueOrDefault(g), false),
            seriBirim = Dilimler(a).Birim,
            subeler = ar?.Subeler.Take(ListeSiniri).ToList() ?? new List<object>(),
            sonIslemler = ar?.SonIslemler ?? new List<object>()
        });
    }

    private async Task<IActionResult> IkAralik(Aralik a)
    {
        var tVeri = Paralel("aralık okutma", () => AralikVerisi(a));
        var tIzin = Paralel("7 günlük izin", YediGunIzin);
        var tSirk = Paralel("sirkülasyon aralığı", () => SirkulasyonAraligi(a));
        var tEtik = Paralel("etik hat", Etik);
        var tEtikA = Paralel("etik aralığı", () => EtikAraligi(a));
        var tPerf = Paralel("performans", () => PerformansAraligi(a));

        await Task.WhenAll(tVeri, tIzin, tSirk, tEtik, tEtikA, tPerf);

        var v = tVeri.Result;
        var sirk = tSirk.Result;
        var etik = tEtik.Result;
        var etikA = tEtikA.Result;

        List<object> Kisiler(Func<AralikKisi, int> gun, string durum) =>
            v?.Kisiler
                .Where(k => gun(k) > 0)
                .OrderByDescending(gun)
                .ThenBy(k => k.SubeAdi, StringComparer.Create(Tr, true))
                .ThenBy(k => Ad(k.P), StringComparer.Create(Tr, true))
                .Take(ListeSiniri)
                .Select(k => (object)new
                {
                    kod = k.Kod,
                    ad = Ad(k.P),
                    poz = K(k.P.Pozisyon),
                    sube = k.SubeAdi,
                    durum,
                    saat = (string)null,
                    gun = gun(k),
                    fotoUrl = PersonelFoto(k.P)
                })
                .ToList() ?? new List<object>();

        Func<DateTime, decimal> gunlukIzinli = null;

        if (v is not null)
        {
            var sayac = new int[a.Gun];

            foreach (var k in v.Kisiler.Where(x => x.Izin is not null))
                for (var i = 0; i < a.Gun; i++)
                    if (k.Izin[i] && k.Rapor?[i] != true) sayac[i]++;

            gunlukIzinli = g => sayac[a.Sira(g)];
        }

        return Ok(new
        {
            aralik = a.Disari(),
            izinli = Kisiler(k => k.IzinGun, "izin"),
            raporlu = Kisiler(k => k.RaporGun, "rapor"),
            izinliSayi = v?.Kisiler.Count(k => k.IzinGun > 0),
            raporluSayi = v?.Kisiler.Count(k => k.RaporGun > 0),
            izinSeri = gunlukIzinli is null ? new List<object[]>() : Seri(a, gunlukIzinli, true),
            seriBirim = Dilimler(a).Birim,
            /* şu an: önümüzdeki 7 günün izin planı */
            yediGunIzin = tIzin.Result ?? new List<object[]>(),
            sirkulasyon = sirk is null
                ? null
                : new
                {
                    giris = sirk.Giris,
                    cikis = sirk.Cikis,
                    oran = sirk.Oran,
                    yillikOran = sirk.YillikOran,
                    seri = sirk.Seri,
                    nedenler = sirk.Nedenler,
                    ilk90Orani = sirk.Ilk90Orani
                },
            etik = etik is null
                ? null
                : new { yeni = etik.Yeni, acik = etik.Acik, donem = etikA?.Donem, son = etikA?.Son ?? new List<object>() },
            performans = tPerf.Result
        });
    }
}

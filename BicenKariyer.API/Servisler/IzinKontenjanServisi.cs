using System.Globalization;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>Yıllık izin kontenjanı ayarı (KRY_AYARLAR, anahtar IZIN_KONTENJAN)</summary>
public class IzinKontenjanAyari
{
    public const string Anahtar = "IZIN_KONTENJAN";

    /// <summary>Kapalıyken hiçbir talep denetlenmez; rapor yine görünür.</summary>
    public bool Acik { get; set; }

    /// <summary>Bu tarihten önceki günler denetlenmez (yürürlük). Boşsa hemen.</summary>
    public DateTime? Baslangic { get; set; } = new DateTime(2027, 1, 1);

    /// <summary>Yıllık hedef: şubenin toplam hak edişinin yüzde kaçı</summary>
    public int Hedef { get; set; } = 100;

    /// <summary>hakedis: şubenin kendi toplam hak edişi · kisi: şirket toplamı personel sayısına göre</summary>
    public string Dagitim { get; set; } = "hakedis";

    /// <summary>Ocak..Aralık ağırlıkları (yüzde)</summary>
    public int[] Agirlik { get; set; } = { 7, 7, 8, 8, 8, 10, 12, 12, 8, 7, 7, 6 };

    /// <summary>Onay bekleyen talep kontenjandan yer tutar</summary>
    public bool Tut { get; set; } = true;

    /// <summary>Kişi başı bir ayda en çok gün (0: sınırsız)</summary>
    public int KisiBasiGun { get; set; } = 10;

    /// <summary>Devri olanlara öncelik: payın yüzdesi ayın başlamasına N gün kalana kadar ayrılır</summary>
    public bool Oncelik { get; set; } = true;
    public int OncelikPay { get; set; } = 30;
    public int OncelikGun { get; set; } = 15;

    /// <summary>Ay doluysa: oner (boş ayları göster, talep açılmaz) · ik (açılır, İK onayı) · engel</summary>
    public string Dolu { get; set; } = "oner";

    /// <summary>Bayram ve yılbaşı haftalarına yıllık izin seçilemez</summary>
    public bool BayramKapali { get; set; }

    /// <summary>Kontenjan uygulanmayan birimler (genel merkez gibi)</summary>
    public List<string> MuafSubeler { get; set; } = new();

    /// <summary>Kontenjandan düşen izin türleri</summary>
    public List<string> Turler { get; set; } = new() { IzinRaporServisi.YillikTur };
}

/// <summary>
/// Yıllık izin kontenjanı (07.10.2026): şube × ay.
///
/// <para>
/// Yıllık hedef (şubenin toplam hak edişi × hedef %) mevsim ağırlığıyla
/// aylara, aylar şubelere bölünür; İK bir şube-ay için elle gün yazabilir ya
/// da ayı kapatabilir (KRY_IZIN_KONTENJAN). Dolu: onaylı yıllık izin günleri
/// ve (ayarlıysa) onay bekleyen talepler. Personel talep ederken istediği
/// günler aylara bölünür; her ayın boşu yetmezse talep açılmaz ve en yakın
/// boş aylar gösterilir (ayara göre İK onayına da düşebilir). Kişi başı
/// aylık gün sınırı ayrıca denetlenir.
/// </para>
/// </summary>
public class IzinKontenjanServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinRaporServisi _rapor;
    private readonly ILogger<IzinKontenjanServisi> _kayit;

    private static readonly CultureInfo Tr = new("tr-TR");

    public static readonly string[] AyAdlari =
        { "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık" };

    public IzinKontenjanServisi(VeritabaniServisi vt, IzinRaporServisi rapor, ILogger<IzinKontenjanServisi> kayit)
    {
        _vt = vt;
        _rapor = rapor;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /* ------------------------------------------------------------ ayar */

    public IzinKontenjanAyari AyarOku()
    {
        try
        {
            using var db = _vt.Baglanti();
            var json = db.ExecuteScalar<string>(
                "SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = IzinKontenjanAyari.Anahtar });

            var a = string.IsNullOrWhiteSpace(json)
                ? new IzinKontenjanAyari()
                : JsonSerializer.Deserialize<IzinKontenjanAyari>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                  ?? new IzinKontenjanAyari();

            return Duzelt(a);
        }
        catch
        {
            return new IzinKontenjanAyari();
        }
    }

    private static IzinKontenjanAyari Duzelt(IzinKontenjanAyari a)
    {
        if (a.Agirlik is not { Length: 12 }) a.Agirlik = new IzinKontenjanAyari().Agirlik;
        a.Agirlik = a.Agirlik.Select(x => Math.Clamp(x, 0, 100)).ToArray();
        a.Hedef = Math.Clamp(a.Hedef, 10, 200);
        a.KisiBasiGun = Math.Clamp(a.KisiBasiGun, 0, 31);
        a.OncelikPay = Math.Clamp(a.OncelikPay, 0, 100);
        a.OncelikGun = Math.Clamp(a.OncelikGun, 0, 90);
        if (a.Dolu is not ("oner" or "ik" or "engel")) a.Dolu = "oner";
        if (a.Dagitim is not ("hakedis" or "kisi")) a.Dagitim = "hakedis";
        a.MuafSubeler ??= new();
        if (a.Turler is not { Count: > 0 }) a.Turler = new() { IzinRaporServisi.YillikTur };
        return a;
    }

    public void AyarYaz(IzinKontenjanAyari a, string kim)
    {
        a = Duzelt(a);
        var json = JsonSerializer.Serialize(a);

        using var db = _vt.Baglanti();
        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = @a)
    UPDATE KRY_AYARLAR SET deger = @d WHERE anahtar = @a
ELSE
    INSERT INTO KRY_AYARLAR (anahtar, deger) VALUES (@a, @d)", new { a = IzinKontenjanAyari.Anahtar, d = json });

        Temizle();
    }

    /* ------------------------------------------------------------ hesap */

    public sealed class Hucre
    {
        public int Ay { get; set; }
        public int Otomatik { get; set; }
        public int? Elle { get; set; }
        public bool Kapali { get; set; }
        public int Kontenjan => Kapali ? 0 : Elle ?? Otomatik;
        public decimal Kullanilan { get; set; }
        public decimal Planli { get; set; }
        public decimal Bekleyen { get; set; }
        public decimal Dolu => Kullanilan + Planli + Bekleyen;
        public decimal Bos => Kontenjan - Dolu;
    }

    public sealed class SubeKontenjani
    {
        public string Sube { get; set; }
        public string Bolge { get; set; }
        public int Kisi { get; set; }
        public decimal Yillik { get; set; }
        public bool Muaf { get; set; }
        public Hucre[] Aylar { get; set; } = new Hucre[12];
    }

    private static readonly object _kilit = new();
    private static readonly Dictionary<int, (DateTime Zaman, List<SubeKontenjani> Veri)> _bellek = new();

    public static void Temizle()
    {
        lock (_kilit) _bellek.Clear();
        IzinRaporServisi.Temizle();
    }

    /// <summary>Şube şube yılın 12 ayı</summary>
    public List<SubeKontenjani> Hesapla(int yil)
    {
        lock (_kilit)
        {
            if (_bellek.TryGetValue(yil, out var b) && DateTime.UtcNow - b.Zaman < TimeSpan.FromSeconds(60))
                return b.Veri;
        }

        var a = AyarOku();
        var kisiler = _rapor.Kisiler(yil).Where(x => !string.IsNullOrWhiteSpace(x.Sube)).ToList();

        using var db = _vt.Baglanti();

        var elle = new Dictionary<(string, int), (int? Gun, bool Kapali)>();

        try
        {
            foreach (var r in db.Query("SELECT sube, ay, gun, kapali FROM KRY_IZIN_KONTENJAN WHERE yil = @yil", new { yil }))
                elle[(((string)r.sube).Trim().ToUpper(Tr), (int)r.ay)] = ((int?)r.gun, r.kapali == true);
        }
        catch
        {
            /* Tablo henüz yoksa elle düzeltme yok */
        }

        /* Dolu: onaylı yıllık izin (kişi tablosundan) ve bekleyen talepler.
           Kişi tablosundaki Plan bekleyenleri de içeriyor; Tut kapalıysa
           bekleyenler ayrıca çıkarılıyor. */
        var bekleyen = Tut(a) ? null : BekleyenGunler(db, yil);

        var toplamHak = kisiler.Where(x => !x.HakYok).Sum(x => x.Toplam);
        var toplamKisi = Math.Max(1, kisiler.Count(x => !x.HakYok));
        var wt = Math.Max(1, a.Agirlik.Sum());

        var sonuc = kisiler
            .GroupBy(x => x.Sube.ToUpper(Tr))
            .Select(g =>
            {
                var liste = g.ToList();
                var ad = liste[0].Sube;
                var hakli = liste.Where(x => !x.HakYok).ToList();

                var yillik = a.Dagitim == "kisi"
                    ? toplamHak * hakli.Count / toplamKisi
                    : hakli.Sum(x => x.Toplam);

                yillik = Math.Round(yillik * a.Hedef / 100m, 0);

                var s = new SubeKontenjani
                {
                    Sube = ad,
                    Bolge = liste.Select(x => x.Bolge).FirstOrDefault(x => x is not null),
                    Kisi = liste.Count,
                    Yillik = yillik,
                    Muaf = Muaf(a, ad),
                };

                for (var i = 0; i < 12; i++)
                {
                    var h = new Hucre
                    {
                        Ay = i + 1,
                        Otomatik = (int)Math.Round(yillik * a.Agirlik[i] / wt, 0),
                        Kullanilan = Math.Round(liste.Sum(x => x.Aylar[i]), 1),
                        Planli = Math.Round(liste.Sum(x => x.Plan[i]), 1),
                    };

                    if (bekleyen is not null)
                        h.Planli = Math.Max(0, h.Planli - Math.Round(liste.Sum(x => bekleyen.GetValueOrDefault((K(x.Kod), i))), 1));

                    if (elle.TryGetValue((ad.ToUpper(Tr), i + 1), out var e))
                    {
                        h.Elle = e.Gun;
                        h.Kapali = e.Kapali;
                    }

                    s.Aylar[i] = h;
                }

                return s;
            })
            .OrderBy(x => x.Sube)
            .ToList();

        lock (_kilit) _bellek[yil] = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    private static bool Tut(IzinKontenjanAyari a) => a.Tut;

    private static Dictionary<(string, int), decimal> BekleyenGunler(System.Data.IDbConnection db, int yil)
    {
        var d = new Dictionary<(string, int), decimal>();

        try
        {
            foreach (var t in db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS bas, donus_tarihi AS son, gun
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND izin_id IS NULL AND tur = @tur
  AND durum NOT IN (N'Onaylandı', N'Reddedildi')", new { tur = IzinRaporServisi.YillikTur }))
            {
                var kod = K((string)t.kod);
                IzinRaporServisi.GunleriDagit((DateTime)t.bas, (DateTime)t.son, (decimal)t.gun, (g, pay) =>
                {
                    if (g.Year != yil) return;
                    var anahtar = (kod, g.Month - 1);
                    d[anahtar] = d.GetValueOrDefault(anahtar) + pay;
                });
            }
        }
        catch
        {
            /* okunamazsa boş */
        }

        return d;
    }

    public static bool Muaf(IzinKontenjanAyari a, string sube) =>
        (a.MuafSubeler ?? new()).Any(x => !string.IsNullOrWhiteSpace(x)
            && (string.Equals(x.Trim(), sube, StringComparison.OrdinalIgnoreCase) || PersonelKaynagiServisi.Benziyor(x.Trim(), sube)));

    public void Duzelt(string sube, int yil, int ay, int? gun, bool kapali, string kim)
    {
        using var db = _vt.Baglanti();

        if (gun is null && !kapali)
            db.Execute("DELETE FROM KRY_IZIN_KONTENJAN WHERE sube = @sube AND yil = @yil AND ay = @ay", new { sube, yil, ay });
        else
            db.Execute(@"
MERGE KRY_IZIN_KONTENJAN AS h
USING (SELECT @sube AS sube, @yil AS yil, @ay AS ay) AS k
   ON h.sube = k.sube AND h.yil = k.yil AND h.ay = k.ay
WHEN MATCHED THEN UPDATE SET gun = @gun, kapali = @kapali, guncelleyen = @kim, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (sube, yil, ay, gun, kapali, guncelleyen) VALUES (@sube, @yil, @ay, @gun, @kapali, @kim);",
                new { sube, yil, ay, gun, kapali, kim });

        Temizle();
    }

    /* ------------------------------------------------------------ denetim */

    public sealed record Sonuc(bool Engel, bool IkOnayi, string Hata, string Ayrinti, List<object> Oneriler)
    {
        public static readonly Sonuc Yok = new(false, false, null, null, new());
    }

    /// <summary>
    /// Talebi denetler. İstenen gün sayısı takvim günlerine oranla aylara
    /// bölünür; her ayda kişi sınırı ve şubenin boşu ayrı bakılır.
    /// </summary>
    public Sonuc Denetle(PersonelKaydi p, string tur, DateTime ilk, DateTime son, decimal gun)
    {
        try
        {
            var a = AyarOku();

            if (!a.Acik || p is null || gun <= 0) return Sonuc.Yok;
            if (!a.Turler.Any(x => string.Equals(x?.Trim(), (tur ?? "").Trim(), StringComparison.OrdinalIgnoreCase)))
                return Sonuc.Yok;

            var sube = (p.Sube ?? p.IsGrubu ?? "").Trim();
            if (sube.Length == 0 || Muaf(a, sube)) return Sonuc.Yok;

            /* Ay ay istenen gün */
            var istek = new Dictionary<(int Yil, int Ay), decimal>();
            IzinRaporServisi.GunleriDagit(ilk, son, gun, (g, pay) =>
            {
                if (a.Baslangic is DateTime b && g < b.Date) return;
                var k = (g.Year, g.Month);
                istek[k] = istek.GetValueOrDefault(k) + pay;
            });

            if (istek.Count == 0) return Sonuc.Yok;

            /* Bayram ve yılbaşı haftaları */
            if (a.BayramKapali)
            {
                var kapaliGun = BayramGunu(ilk, son);
                if (kapaliGun is DateTime kg)
                    return new Sonuc(true, false,
                        "Bayram ve yılbaşı haftalarına yıllık izin seçilemiyor.",
                        $"{kg:dd.MM.yyyy} haftası kapalı. Başka bir tarih seçin ya da İnsan Kaynakları ile görüşün.", new());
            }

            var kod = p.PersonelKodu.Trim();
            var ikOnayi = false;
            var notlar = new List<string>();

            foreach (var ((yil, ay), ham) in istek.OrderBy(x => x.Key.Yil).ThenBy(x => x.Key.Ay))
            {
                var ihtiyac = Math.Round(ham, 1);
                var tablo = Hesapla(yil);
                var s = tablo.FirstOrDefault(x => string.Equals(x.Sube, sube, StringComparison.OrdinalIgnoreCase));
                if (s is null || s.Muaf) continue;

                var h = s.Aylar[ay - 1];
                var ayAdi = $"{AyAdlari[ay - 1]} {yil}";

                if (h.Kapali)
                    return new Sonuc(true, false, $"{ayAdi} şubenizde yıllık izne kapalı.",
                        OneriMetni(tablo, sube, yil, ay, ihtiyac, kod, a), Oneriler(tablo, sube, yil, ay, kod, a));

                /* Kişi başı aylık sınır */
                if (a.KisiBasiGun > 0)
                {
                    var kendi = KisiAyGunu(kod, yil, ay);
                    if (kendi + ihtiyac > a.KisiBasiGun)
                        return new Sonuc(true, false,
                            $"Bir ayda en çok {a.KisiBasiGun} gün yıllık izin kullanılabiliyor.",
                            $"{ayAdi} için {(kendi > 0 ? $"zaten {kendi:0.#} gün izniniz var, " : "")}{ihtiyac:0.#} gün daha istediniz. Kalanını başka bir aya alabilirsiniz.",
                            new());
                }

                var bos = Bos(h, a, kod, yil, ay);

                if (ihtiyac > bos)
                {
                    if (a.Dolu == "ik")
                    {
                        ikOnayi = true;
                        notlar.Add($"{ayAdi}: {Math.Max(0, bos):0.#} gün boş, {ihtiyac:0.#} gün istendi");
                        continue;
                    }

                    var baslik = bos <= 0
                        ? $"{ayAdi} için şubenizin izin kontenjanı dolu."
                        : $"{ayAdi} için şubenizde yalnızca {bos:0.#} gün boş.";

                    return new Sonuc(true, false, baslik,
                        a.Dolu == "oner" ? OneriMetni(tablo, sube, yil, ay, ihtiyac, kod, a) : "İnsan Kaynakları ile görüşün.",
                        a.Dolu == "oner" ? Oneriler(tablo, sube, yil, ay, kod, a) : new());
                }
            }

            return ikOnayi
                ? new Sonuc(false, true, "Kontenjan aşımı: talep İK onayına düşecek.", string.Join(" · ", notlar), new())
                : Sonuc.Yok;
        }
        catch (Exception hata)
        {
            /* Denetim yapılamazsa talep engellenmiyor */
            _kayit.LogWarning(hata, "İzin kontenjanı denetlenemedi");
            return Sonuc.Yok;
        }
    }

    /// <summary>Kişi için ayın boşu (öncelik payı düşülmüş)</summary>
    private decimal Bos(Hucre h, IzinKontenjanAyari a, string kod, int yil, int ay)
    {
        decimal kontenjan = h.Kontenjan;

        if (a.Oncelik && a.OncelikPay > 0)
        {
            var ayBasi = new DateTime(yil, ay, 1);
            if (DateTime.Today < ayBasi.AddDays(-a.OncelikGun))
            {
                var kisi = _rapor.Kisiler(DateTime.Today.Year).FirstOrDefault(x => K(x.Kod) == K(kod));
                if (kisi is null || kisi.Devir <= 0)
                    kontenjan = Math.Floor(kontenjan * (100 - a.OncelikPay) / 100m);
            }
        }

        return Math.Round(kontenjan - h.Dolu, 1);
    }

    /// <summary>Kişinin o ay zaten aldığı / beklettiği yıllık izin günü</summary>
    private decimal KisiAyGunu(string kod, int yil, int ay)
    {
        var k = _rapor.Kisiler(yil).FirstOrDefault(x => K(x.Kod) == K(kod));
        return k is null ? 0 : Math.Round(k.Aylar[ay - 1] + k.Plan[ay - 1], 1);
    }

    private List<object> Oneriler(List<SubeKontenjani> tablo, string sube, int yil, int ay, string kod, IzinKontenjanAyari a)
    {
        var liste = new List<object>();
        var bugunAy = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var merkez = new DateTime(yil, ay, 1);

        for (var fark = -3; fark <= 3; fark++)
        {
            if (fark == 0) continue;
            var t = merkez.AddMonths(fark);
            if (t < bugunAy) continue;

            var tb = t.Year == yil ? tablo : Hesapla(t.Year);
            var s = tb.FirstOrDefault(x => string.Equals(x.Sube, sube, StringComparison.OrdinalIgnoreCase));
            if (s is null) continue;

            var h = s.Aylar[t.Month - 1];
            if (h.Kapali) continue;

            var bos = Bos(h, a, kod, t.Year, t.Month);
            if (bos >= 1) liste.Add(new { yil = t.Year, ay = t.Month, ad = $"{AyAdlari[t.Month - 1]} {t.Year}", bos, fark });
        }

        return liste.OrderBy(x => Math.Abs((int)((dynamic)x).fark)).ToList();
    }

    private string OneriMetni(List<SubeKontenjani> tablo, string sube, int yil, int ay, decimal ihtiyac, string kod, IzinKontenjanAyari a)
    {
        var o = Oneriler(tablo, sube, yil, ay, kod, a).Cast<dynamic>().Take(4).ToList();
        if (o.Count == 0) return "Yakın aylarda boş gün yok. İnsan Kaynakları ile görüşün.";
        return "Boş günü olan aylar: " + string.Join(", ", o.Select(x => $"{x.ad} ({((decimal)x.bos):0.#} gün)")) + ".";
    }

    /// <summary>Aralıkta bayram ya da yılbaşı haftasına düşen ilk gün</summary>
    private DateTime? BayramGunu(DateTime ilk, DateTime son)
    {
        using var db = _vt.Baglanti();

        var tatiller = db.Query<DateTime>(@"
SELECT tarih FROM KRY_RESMI_TATIL
WHERE aktif = 1 AND tarih BETWEEN @bas AND @bit AND (ad LIKE N'%Bayram%' OR ad LIKE N'%Yılbaşı%' OR ad LIKE N'%Yeni Yıl%')",
            new { bas = ilk.Date.AddDays(-7), bit = son.Date.AddDays(7) })
            .Select(x => x.Date)
            .ToList();

        /* Yılbaşı tatil tablosunda yoksa da sayılır */
        for (var y = ilk.Year; y <= son.Year + 1; y++) tatiller.Add(new DateTime(y, 1, 1));

        static DateTime Pzt(DateTime g) => g.AddDays(-(((int)g.DayOfWeek + 6) % 7));

        var haftalar = tatiller.Select(Pzt).ToHashSet();

        for (var g = ilk.Date; g <= son.Date; g = g.AddDays(1))
            if (haftalar.Contains(Pzt(g))) return g;

        return null;
    }

    /* ------------------------------------------------------------ mobil */

    /// <summary>Personelin şubesinde bu aydan itibaren 6 ayın boşu</summary>
    public object MobilOzet(PersonelKaydi p)
    {
        var a = AyarOku();
        var sube = (p?.Sube ?? p?.IsGrubu ?? "").Trim();

        if (!a.Acik || sube.Length == 0 || Muaf(a, sube))
            return new { acik = false };

        var kod = p.PersonelKodu.Trim();
        var bas = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var aylar = new List<object>();

        for (var i = 0; i < 6; i++)
        {
            var t = bas.AddMonths(i);
            if (a.Baslangic is DateTime b && t.AddMonths(1) <= b.Date) continue;

            var s = Hesapla(t.Year).FirstOrDefault(x => string.Equals(x.Sube, sube, StringComparison.OrdinalIgnoreCase));
            if (s is null) continue;

            var h = s.Aylar[t.Month - 1];
            var kendi = KisiAyGunu(kod, t.Year, t.Month);

            aylar.Add(new
            {
                yil = t.Year,
                ay = t.Month,
                ad = $"{AyAdlari[t.Month - 1]} {t.Year}",
                kapali = h.Kapali,
                bos = h.Kapali ? 0 : Math.Max(0, Bos(h, a, kod, t.Year, t.Month)),
                kendi,
                kisiKalan = a.KisiBasiGun > 0 ? Math.Max(0, a.KisiBasiGun - kendi) : (decimal?)null,
            });
        }

        return new
        {
            acik = true,
            sube,
            kisiBasiGun = a.KisiBasiGun,
            dolu = a.Dolu,
            aylar,
        };
    }
}

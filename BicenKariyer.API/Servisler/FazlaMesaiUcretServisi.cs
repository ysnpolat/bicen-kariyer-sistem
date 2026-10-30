using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Fazla mesai ücret / serbest zaman kuralları (15.10.2026, Yönetim ›
/// Fazla mesai ücret kuralları).
///
/// <para>
/// Her fazla mesai kaydının günü sınıflanır:
/// <list type="bullet">
/// <item><b>resmi</b>: Resmi tatil (KRY_RESMI_TATIL, tam gün).</item>
/// <item><b>arife</b>: Yarım gün resmi tatil (arife).</item>
/// <item><b>hafta</b>: Personelin haftalık izin günü (o haftanın vardiya planı,
/// yoksa onaylı sabit izin günü, o da yoksa pozisyon grubunun izin günleri —
/// izin gün hesabındaki sıra).</item>
/// <item><b>normal</b>: Diğer günler.</item>
/// </list>
/// Kural: kapsam (iş yeri, pozisyon, kişi) + gün türü → karşılık (ücret ya da
/// serbest zaman) ve çarpan (1, 1,5, 2…). En özel kural uygulanır: kişi >
/// pozisyon > iş yeri > genel; gün türü yazılı olan "hepsi"nden önce gelir.
/// Kural yoksa ücret × "fm.zamYuzde" (varsayılan %150).
/// </para>
///
/// <para>
/// Ücret = aylık ücret ÷ "fm.aylikSaat" (225) × çarpan × saat. Serbest zaman
/// = saat × çarpan. Ücret yalnızca ücret görme yetkisi olanlara döner.
/// </para>
/// </summary>
public class FazlaMesaiUcretServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinGunuServisi _izinGunu;
    private readonly ILogger<FazlaMesaiUcretServisi> _kayit;

    public FazlaMesaiUcretServisi(VeritabaniServisi vt, IzinGunuServisi izinGunu, ILogger<FazlaMesaiUcretServisi> kayit)
    {
        _vt = vt;
        _izinGunu = izinGunu;
        _kayit = kayit;
    }

    public const string Hepsi = "*";
    public const string KarsilikUcret = "ucret";
    public const string KarsilikIzin = "izin";

    public static readonly Dictionary<string, string> GunTurleri = new()
    {
        ["normal"] = "Normal gün",
        ["hafta"] = "Hafta tatili",
        ["resmi"] = "Resmi tatil",
        ["arife"] = "Arife (yarım gün tatil)",
    };

    public sealed class Kural
    {
        public int Id { get; set; }
        public int Sira { get; set; }
        public string Ad { get; set; }
        public string IsYeri { get; set; } = Hepsi;
        public string Pozisyon { get; set; } = Hepsi;
        public string Sicil { get; set; }
        public string GunTuru { get; set; } = Hepsi;
        public string Karsilik { get; set; } = KarsilikUcret;
        public decimal Carpan { get; set; } = 1.5m;
        public bool Aktif { get; set; } = true;
    }

    /// <summary>Bir kaydın hesabı</summary>
    public sealed record Sonuc(
        string GunTuru,
        string GunTuruAdi,
        string TatilAdi,
        string Karsilik,
        decimal Carpan,
        decimal? Ucret,
        int IzinDk,
        string Kural);

    /// <summary>Hesaplanacak kayıt</summary>
    public sealed record Girdi(int Id, string Sicil, string Pozisyon, string IsGrubu, DateTime Tarih, int Dk);

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');
    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");
    private static bool HepsiMi(string s) => string.IsNullOrWhiteSpace(s) || s.Trim() == Hepsi;

    /* -------------------------------------------------------- kurallar */

    private static (DateTime zaman, List<Kural> liste)? _bellek;
    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    public List<Kural> Kurallar(bool pasifDahil = false)
    {
        List<Kural> l;
        lock (_kilit) l = _bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60) ? b.liste : null;

        if (l is null)
        {
            try
            {
                using var db = _vt.Baglanti();
                l = db.Query(@"
SELECT id, sira, ad, is_yeri, pozisyon, sicil, gun_turu, karsilik, carpan, aktif
FROM KRY_FM_UCRET_KURAL ORDER BY sira, id")
                    .Select(x => new Kural
                    {
                        Id = (int)x.id,
                        Sira = (int)x.sira,
                        Ad = (string)x.ad,
                        IsYeri = (string)x.is_yeri ?? Hepsi,
                        Pozisyon = (string)x.pozisyon ?? Hepsi,
                        Sicil = (string)x.sicil,
                        GunTuru = (string)x.gun_turu ?? Hepsi,
                        Karsilik = (string)x.karsilik ?? KarsilikUcret,
                        Carpan = (decimal)x.carpan,
                        Aktif = (bool)x.aktif,
                    })
                    .ToList();
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "Fazla mesai ücret kuralları okunamadı");
                l = new();
            }

            lock (_kilit) _bellek = (DateTime.UtcNow, l);
        }

        return pasifDahil ? l : l.Where(x => x.Aktif).ToList();
    }

    /// <summary>En özel tutan kural; yoksa null</summary>
    public Kural Bul(string sicil, string pozisyon, string isGrubu, string isYeri, string gunTuru)
    {
        Kural en = null;
        var enPuan = -1.0;

        foreach (var k in Kurallar())
        {
            if (!string.IsNullOrWhiteSpace(k.Sicil) && K(k.Sicil) != K(sicil)) continue;
            if (!HepsiMi(k.Pozisyon) && A(k.Pozisyon) != A(pozisyon)) continue;
            if (!HepsiMi(k.IsYeri) && A(k.IsYeri) != A(isYeri) && A(k.IsYeri) != A(isGrubu)) continue;
            if (!HepsiMi(k.GunTuru) && k.GunTuru != gunTuru) continue;

            var puan = (string.IsNullOrWhiteSpace(k.Sicil) ? 0 : 100)
                       + (HepsiMi(k.Pozisyon) ? 0 : 10)
                       + (HepsiMi(k.IsYeri) ? 0 : 1)
                       + (HepsiMi(k.GunTuru) ? 0 : 0.5);

            if (puan > enPuan) (en, enPuan) = (k, puan);
        }

        return en;
    }

    /* ------------------------------------------------------- gün türü */

    /// <summary>Kayıtların gün türleri tek seferde (tatiller, planlar, sabit günler)</summary>
    private Dictionary<int, (string Tur, string TatilAdi)> GunTurleri_(IDbConnection db, IReadOnlyList<Girdi> kayitlar)
    {
        var sonuc = new Dictionary<int, (string, string)>();
        if (kayitlar.Count == 0) return sonuc;

        var bas = kayitlar.Min(x => x.Tarih).Date;
        var bit = kayitlar.Max(x => x.Tarih).Date;

        var tatiller = db.Query(@"
SELECT tarih, ad, yarim_gun AS yarim FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih BETWEEN @bas AND @bit",
                new { bas, bit })
            .ToDictionary(x => ((DateTime)x.tarih).Date, x => ((string)x.ad, (bool)x.yarim));

        var siciller = kayitlar.Select(x => (x.Sicil ?? "").Trim()).Where(x => x.Length > 0).Distinct().ToList();

        var sabit = new Dictionary<string, DayOfWeek>(StringComparer.OrdinalIgnoreCase);
        var plan = new Dictionary<string, (HashSet<DateTime> Haftalar, HashSet<DateTime> Izinler)>(StringComparer.OrdinalIgnoreCase);

        foreach (var parca in siciller.Chunk(800))
        {
            try
            {
                foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, gun FROM KRY_HAFTALIK_IZIN h
WHERE personel_kodu IN @parca AND gun IS NOT NULL AND durum = N'onaylandi'
  AND id = (SELECT MAX(id) FROM KRY_HAFTALIK_IZIN x WHERE x.personel_kodu = h.personel_kodu AND x.gun IS NOT NULL AND x.durum = N'onaylandi')",
                             new { parca }))
                {
                    if (r.gun is null) continue;
                    var g = Convert.ToInt32(r.gun);
                    if (g is >= 0 and <= 6) sabit[K((string)r.kod)] = (DayOfWeek)g;
                }
            }
            catch { /* tablo yoksa sabit gün yok */ }

            try
            {
                foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, gun, tur FROM KRY_VARDIYA_PLAN
WHERE personel_kodu IN @parca AND gun BETWEEN @bas AND @bit",
                             new { parca, bas = IzinGunuHesabi.HaftaBasi(bas), bit = IzinGunuHesabi.HaftaBasi(bit).AddDays(6) }))
                {
                    var k = K((string)r.kod);
                    if (!plan.TryGetValue(k, out var p)) plan[k] = p = (new HashSet<DateTime>(), new HashSet<DateTime>());
                    var g = ((DateTime)r.gun).Date;
                    p.Haftalar.Add(IzinGunuHesabi.HaftaBasi(g));
                    if ((string)r.tur == "izin") p.Izinler.Add(g);
                }
            }
            catch { /* plan yoksa grup günleri */ }
        }

        var grup = new Dictionary<string, HashSet<DayOfWeek>>(StringComparer.OrdinalIgnoreCase);

        foreach (var x in kayitlar)
        {
            var g = x.Tarih.Date;

            if (tatiller.TryGetValue(g, out var t))
            {
                sonuc[x.Id] = (t.Item2 ? "arife" : "resmi", t.Item1);
                continue;
            }

            var k = K(x.Sicil);
            bool haftalik;

            if (plan.TryGetValue(k, out var p) && p.Haftalar.Contains(IzinGunuHesabi.HaftaBasi(g)))
                haftalik = p.Izinler.Contains(g);
            else if (sabit.TryGetValue(k, out var sg))
                haftalik = g.DayOfWeek == sg;
            else
            {
                var poz = x.Pozisyon ?? "";
                if (!grup.TryGetValue(poz, out var gunler))
                {
                    try
                    {
                        gunler = _izinGunu.GrupIzinGunleri(db, poz);
                    }
                    catch
                    {
                        gunler = new();
                    }
                    grup[poz] = gunler;
                }
                haftalik = gunler.Contains(g.DayOfWeek);
            }

            sonuc[x.Id] = (haftalik ? "hafta" : "normal", null);
        }

        return sonuc;
    }

    /* ------------------------------------------------------------ hesap */

    /// <summary>
    /// Kayıtların karşılığı. <paramref name="bazUcretler"/>: sicil → saat
    /// ücreti (aylık ÷ aylık saat, zamsız); ücret yetkisi yoksa boş geçilir.
    /// </summary>
    public Dictionary<int, Sonuc> Hesapla(IReadOnlyList<Girdi> kayitlar, IReadOnlyDictionary<string, decimal> bazUcretler,
        Func<string, string> isYeriBul)
    {
        var sonuc = new Dictionary<int, Sonuc>();
        if (kayitlar.Count == 0) return sonuc;

        Dictionary<int, (string Tur, string TatilAdi)> turler;
        try
        {
            using var db = _vt.Baglanti();
            turler = GunTurleri_(db, kayitlar);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Fazla mesai gün türleri belirlenemedi");
            turler = new();
        }

        var varsayilanCarpan = Math.Max(100, Parametre.Sayi("fm.zamYuzde")) / 100m;
        var yerBellek = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var x in kayitlar)
        {
            var (tur, tatil) = turler.TryGetValue(x.Id, out var t) ? t : ("normal", null);

            var ig = x.IsGrubu ?? "";
            if (!yerBellek.TryGetValue(ig, out var yer))
            {
                try
                {
                    yer = isYeriBul?.Invoke(ig) ?? ig;
                }
                catch
                {
                    yer = ig;
                }
                yerBellek[ig] = yer;
            }

            var kural = Bul(x.Sicil, x.Pozisyon, x.IsGrubu, yer, tur);
            var karsilik = kural?.Karsilik == KarsilikIzin ? KarsilikIzin : KarsilikUcret;
            var carpan = kural?.Carpan ?? varsayilanCarpan;

            decimal? ucret = null;
            var izinDk = 0;

            if (karsilik == KarsilikIzin)
                izinDk = (int)Math.Round(x.Dk * carpan);
            else if (bazUcretler is not null && bazUcretler.TryGetValue(K(x.Sicil), out var baz))
                ucret = Math.Round(baz * carpan * x.Dk / 60m, 2);

            sonuc[x.Id] = new Sonuc(tur, GunTurleri.GetValueOrDefault(tur, tur), tatil, karsilik, carpan, ucret, izinDk,
                kural is null ? "Varsayılan" : kural.Ad ?? $"Kural #{kural.Id}");
        }

        return sonuc;
    }
}

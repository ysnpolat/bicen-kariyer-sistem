using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin Yönetimi raporu ve izin kontenjanı için kişi kişi yıllık izin
/// tablosu (07.10.2026).
///
/// <para>
/// Sistemde hak ediş tek satır (KRY_IZIN_BAKIYE): <c>baslangic</c> bu
/// dönemin hak edişi, <c>devir</c> önceki dönemlerin brüt hak edişi;
/// kullanılan tüm zamanların toplamı. Raporda “önceki dönemden kullanılmamış
/// devir” gerekiyor: devir − hak ediş döneminin başından önceki kullanım.
/// Kalan gün sistemdekiyle aynı çıkar (hak + devir − kullanılan − planlı).
/// </para>
///
/// <para>
/// Aylık dağılım takvim yılına göre: onaylı izin günleri bugüne kadar
/// “kullanılan”, sonrası “planlı”; onay bekleyen yıllık izin talepleri de
/// planlı sayılır. Bir izin birden çok aya taşıyorsa gün sayısı takvim
/// günlerine oranla bölünür.
/// </para>
/// </summary>
public class IzinRaporServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly AyarServisi _ayar;

    public IzinRaporServisi(VeritabaniServisi vt, PersonelKaynagiServisi kaynak, AyarServisi ayar)
    {
        _vt = vt;
        _kaynak = kaynak;
        _ayar = ayar;
    }

    public const string YillikTur = "Yıllık İzin";

    public sealed class Kisi
    {
        public string Kod { get; set; }
        public string Ad { get; set; }
        public string Sube { get; set; }
        public string Bolge { get; set; }
        public string Gorev { get; set; }
        public DateTime? Giris { get; set; }
        public bool HakYok { get; set; }
        public decimal Hak { get; set; }
        public decimal Devir { get; set; }
        public decimal Toplam => Hak + Devir;
        public decimal Kullanilan { get; set; }
        public decimal Planli { get; set; }
        public decimal Kalan { get; set; }
        public DateTime DonemBasi { get; set; }
        public decimal[] Aylar { get; set; } = new decimal[12];
        public decimal[] Plan { get; set; } = new decimal[12];
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static readonly object _kilit = new();
    private static (DateTime Zaman, int Yil, List<Kisi> Veri)? _bellek;

    /// <summary>Raporlar arka arkaya soruyor: 60 saniye bellekte</summary>
    public static void Temizle()
    {
        lock (_kilit) _bellek = null;
    }

    /// <summary>
    /// Bir izin satırının günlerini takvim yılının aylarına dağıtır.
    /// <paramref name="ekle"/> (tarih, gün payı) her gün için çağrılır.
    /// </summary>
    public static void GunleriDagit(DateTime bas, DateTime son, decimal gun, Action<DateTime, decimal> ekle)
    {
        bas = bas.Date;
        son = son.Date;
        if (son < bas) son = bas;

        var takvim = (decimal)((son - bas).TotalDays + 1);
        if (takvim <= 0 || gun <= 0) return;

        var pay = gun / takvim;

        for (var g = bas; g <= son; g = g.AddDays(1))
            ekle(g, pay);
    }

    /// <summary>Aktif personelin yıllık izin tablosu</summary>
    public List<Kisi> Kisiler(int yil)
    {
        lock (_kilit)
        {
            if (_bellek is { } b && b.Yil == yil && DateTime.UtcNow - b.Zaman < TimeSpan.FromSeconds(60))
                return b.Veri;
        }

        var veri = Hesapla(yil);

        lock (_kilit) _bellek = (DateTime.UtcNow, yil, veri);

        return veri;
    }

    private List<Kisi> Hesapla(int yil)
    {
        var bugun = DateTime.Today;
        var yilBas = new DateTime(yil, 1, 1);
        var yilSon = new DateTime(yil, 12, 31);

        var personel = _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .ToList();

        using var db = _vt.Baglanti();

        var bakiye = IzinBakiyeHesabi.Oku(db);
        var duzeltmeler = IzinHakedis.Hepsi(db);

        /* Onaylı, hak edişten düşen bütün izinler (kişi başı az satır) */
        var izinler = db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son,
       gun
FROM KRY_IZIN
WHERE iptal = 0 AND bakiyeden_duser = 1")
            .GroupBy(x => K((string)x.kod))
            .ToDictionary(g => g.Key, g => g.ToList());

        /* Onay bekleyen yıllık izin talepleri */
        var bekleyen = new Dictionary<string, List<dynamic>>();

        try
        {
            bekleyen = db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS bas, donus_tarihi AS son, gun
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND izin_id IS NULL AND tur = @tur
  AND durum NOT IN (N'Onaylandı', N'Reddedildi')", new { tur = YillikTur })
                .GroupBy(x => K((string)x.kod))
                .ToDictionary(g => g.Key, g => g.ToList());
        }
        catch
        {
            /* Talep tablosu okunamazsa yalnızca onaylı izinler */
        }

        var bolgeler = BolgeHaritasi();

        var sonuc = new List<Kisi>();

        foreach (var p in personel)
        {
            var kod = p.PersonelKodu.Trim();
            var b = bakiye.Hesapla(kod);

            var esas = IzinHakedis.Esas(p.GirisTarihi, duzeltmeler.GetValueOrDefault(kod));
            var donemBasi = yilBas;

            if (esas is DateTime e)
            {
                var yd = IzinHakedis.YilDonumu(e, bugun.Year);
                donemBasi = yd <= bugun ? yd : IzinHakedis.YilDonumu(e, bugun.Year - 1);
                if (donemBasi < e) donemBasi = e;
            }

            var satirlar = izinler.GetValueOrDefault(K(kod)) ?? new List<dynamic>();

            /* Dönem başından önceki kullanım (tarihsiz aktarılan dahil) */
            var oncekiKullanim = b.Kullanilan
                                 - satirlar.Where(x => ((DateTime)x.bas).Date >= donemBasi && ((DateTime)x.bas).Date <= bugun)
                                     .Sum(x => (decimal)x.gun);

            var k = new Kisi
            {
                Kod = kod,
                Ad = $"{p.Ad} {p.Soyad}".Trim(),
                Sube = (p.Sube ?? p.IsGrubu ?? "").Trim(),
                Gorev = p.Pozisyon,
                Giris = p.GirisTarihi,
                DonemBasi = donemBasi,
                HakYok = !b.Girildi || ((b.Hakedilen ?? 0) <= 0 && b.Devir <= 0),
            };

            k.Bolge = BolgeBul(bolgeler, k.Sube);

            if (!k.HakYok)
            {
                k.Hak = b.Hakedilen ?? 0;
                k.Devir = Math.Max(0, b.Devir - oncekiKullanim);
                k.Kullanilan = Math.Max(0, b.Kullanilan - oncekiKullanim);
                k.Planli = b.Planli;
            }

            foreach (var s in satirlar)
            {
                if ((DateTime)s.son < yilBas || (DateTime)s.bas > yilSon) continue;

                GunleriDagit((DateTime)s.bas, (DateTime)s.son, (decimal)s.gun, (g, pay) =>
                {
                    if (g.Year != yil) return;
                    if (g <= bugun) k.Aylar[g.Month - 1] += pay;
                    else k.Plan[g.Month - 1] += pay;
                });
            }

            foreach (var t in bekleyen.GetValueOrDefault(K(kod)) ?? new List<dynamic>())
            {
                if (!k.HakYok) k.Planli += (decimal)t.gun;

                GunleriDagit((DateTime)t.bas, (DateTime)t.son, (decimal)t.gun, (g, pay) =>
                {
                    if (g.Year == yil) k.Plan[g.Month - 1] += pay;
                });
            }

            k.Kalan = k.HakYok ? 0 : k.Toplam - k.Kullanilan - k.Planli;

            for (var i = 0; i < 12; i++)
            {
                k.Aylar[i] = Math.Round(k.Aylar[i], 1);
                k.Plan[i] = Math.Round(k.Plan[i], 1);
            }

            sonuc.Add(k);
        }

        return sonuc;
    }

    /* ------------------------------------------------------------ bölge */

    /// <summary>Bölge adı → o bölgedeki birim adları</summary>
    /* ================================================================== */
    /* Dönem raporu (08.10.2026)                                           */
    /* ================================================================== */

    public sealed class DonemSatiri
    {
        public int Id { get; set; }
        public string Kod { get; set; }
        public string Ad { get; set; }
        public string Sube { get; set; }
        public string Bolge { get; set; }
        public string Gorev { get; set; }
        public bool Aktif { get; set; }
        public string Tur { get; set; }
        public bool BakiyedenDuser { get; set; }
        public DateTime Cikis { get; set; }
        public DateTime Donus { get; set; }
        public DateTime? Baslama { get; set; }
        public decimal Gun { get; set; }
        public decimal DonemGun { get; set; }
        public decimal? Saat { get; set; }
        public string SaatAraligi { get; set; }
        public string YarimGun { get; set; }
        public string Aciklama { get; set; }
        public string Giren { get; set; }
        public DateTime Olusturma { get; set; }

        /// <summary>"2026-10" → dönem içindeki gün</summary>
        public Dictionary<string, decimal> Aylar { get; set; } = new();
    }

    /// <summary>
    /// Tarih aralığına düşen bütün izinler (iptal edilmemiş, her tür).
    /// Aralığa kısmen düşen iznin günü aralıktaki takvim günlerine
    /// orantılanıyor (DonemGun); aylık dağılım da aynı paydan.
    /// </summary>
    public List<DonemSatiri> Donem(DateTime bas, DateTime bit)
    {
        bas = bas.Date;
        bit = bit.Date;

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT id, personel_kodu AS kod, ad_soyad AS ad, sube_adi AS sube, gorev, tur, bakiyeden_duser AS duser,
       cikis_tarihi AS cikis, donus_tarihi AS donus, baslama_tarihi AS baslama, gun, saat,
       baslangic_saat AS sb, bitis_saat AS se, yarim_gun AS yarim, aciklama, giren, olusturma
FROM KRY_IZIN
WHERE iptal = 0
  AND cikis_tarihi <= @bit
  AND (CASE WHEN baslama_tarihi IS NOT NULL AND baslama_tarihi > cikis_tarihi
            THEN DATEADD(day, -1, baslama_tarihi) ELSE donus_tarihi END) >= @bas
ORDER BY cikis_tarihi, personel_kodu", new { bas, bit }).ToList();

        var personel = _kaynak.TumPersonelleriGetir()
            .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .GroupBy(x => K(x.PersonelKodu))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Durum == 1).First());

        var bolgeler = BolgeHaritasi();
        var bolgeBellek = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var sonuc = new List<DonemSatiri>();

        foreach (var r in satirlar)
        {
            var kod = ((string)r.kod ?? "").Trim();
            personel.TryGetValue(K(kod), out var p);

            DateTime cikis = r.cikis;
            DateTime donus = r.donus;
            DateTime? baslama = r.baslama;
            var son = baslama is DateTime bs && bs.Date > cikis.Date ? bs.Date.AddDays(-1) : donus.Date;
            var gun = (decimal)r.gun;

            var x = new DonemSatiri
            {
                Id = (int)r.id,
                Kod = kod,
                Ad = p is not null ? $"{p.Ad} {p.Soyad}".Trim() : (string)r.ad,
                Sube = (p?.Durum == 1 ? p.IsGrubu : null) ?? (string)r.sube ?? p?.IsGrubu,
                Gorev = (p?.Durum == 1 ? p.Pozisyon : null) ?? (string)r.gorev ?? p?.Pozisyon,
                Aktif = p?.Durum == 1,
                Tur = string.IsNullOrWhiteSpace((string)r.tur) ? YillikTur : ((string)r.tur).Trim(),
                BakiyedenDuser = (bool)r.duser,
                Cikis = cikis,
                Donus = donus,
                Baslama = baslama,
                Gun = gun,
                Saat = (decimal?)r.saat,
                SaatAraligi = string.IsNullOrWhiteSpace((string)r.sb) ? null : $"{r.sb}–{r.se}",
                YarimGun = (string)r.yarim,
                Aciklama = (string)r.aciklama,
                Giren = (string)r.giren,
                Olusturma = r.olusturma,
            };

            GunleriDagit(cikis, son, gun, (g, pay) =>
            {
                if (g < bas || g > bit) return;
                x.DonemGun += pay;
                var ay = g.ToString("yyyy-MM");
                x.Aylar[ay] = x.Aylar.GetValueOrDefault(ay) + pay;
            });

            x.DonemGun = Math.Round(x.DonemGun, 2);
            foreach (var a in x.Aylar.Keys.ToList()) x.Aylar[a] = Math.Round(x.Aylar[a], 2);

            var subeAnahtar = x.Sube ?? "";
            if (!bolgeBellek.TryGetValue(subeAnahtar, out var bolge))
                bolgeBellek[subeAnahtar] = bolge = BolgeBul(bolgeler, x.Sube);
            x.Bolge = bolge;

            sonuc.Add(x);
        }

        return sonuc;
    }

    private List<(string Bolge, List<string> Birimler)> BolgeHaritasi()
    {
        try
        {
            var ayar = _ayar.FormOku();
            var tanimlar = ayar?.Subeler ?? new List<Sube>();

            return (ayar?.Bolgeler ?? new List<BolgeTanimi>())
                .Where(b => !string.IsNullOrWhiteSpace(b.Ad))
                .Select(b => (b.Ad.Trim(), (b.Subeler ?? new List<string>())
                    .Select(kod => tanimlar.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad ?? kod)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .ToList()))
                .ToList();
        }
        catch
        {
            return new();
        }
    }

    private static string BolgeBul(List<(string Bolge, List<string> Birimler)> harita, string sube)
    {
        if (string.IsNullOrWhiteSpace(sube)) return null;

        foreach (var (bolge, birimler) in harita)
            if (birimler.Any(x => string.Equals(x, sube, StringComparison.OrdinalIgnoreCase)
                                  || PersonelKaynagiServisi.Benziyor(x, sube)))
                return bolge;

        return null;
    }
}

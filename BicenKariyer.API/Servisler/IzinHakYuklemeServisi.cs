using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kıdeme göre yıllık izin hakkı — 4857 sayılı İş Kanunu md. 53'teki
/// asgari süreler (06.10.2026, İK kararıyla önceki 15/26 kuralının yerine):
/// <list type="bullet">
/// <item>1 yıldan 5 yıla kadar (5 dahil): 14 gün</item>
/// <item>5 yıldan fazla, 15 yıldan az: 20 gün</item>
/// <item>15 yıl (dahil) ve üzeri: 26 gün</item>
/// <item>18 yaşından küçük ve 50 yaş ve üzeri: kıdemi ne olursa olsun en az 20 gün</item>
/// </list>
/// Yaş, hak ediş tarihindeki (yıl dönümü) yaş. Yıllık İzin Ücretleri ve
/// otomatik hak yüklemesi aynı kuralı buradan okuyor.
/// </summary>
public static class IzinHakKurali
{
    public const int Gun1_5 = 14;
    public const int Gun6_14 = 20;
    public const int Gun15 = 26;
    public const int GunYasIstisna = 20;

    /// <summary>Kural sürümü: yükleme kayıtlarında eski kuralla yüklenenleri bulmak için</summary>
    public const string Surum = "is-kanunu-53";

    /// <summary>Kıdem yılına göre (yaş bilinmeden) hak; 1 yılı dolmamışsa 0.</summary>
    public static int KidemHakki(int kidemYili) =>
        kidemYili < 1 ? 0 : kidemYili <= 5 ? Gun1_5 : kidemYili < 15 ? Gun6_14 : Gun15;

    /// <summary>Tamamlanan kıdem yılı ve hak ediş tarihindeki yaşa göre o yılın hakkı.</summary>
    public static int HakGun(int kidemYili, int? yas = null)
    {
        var hak = KidemHakki(kidemYili);

        if (hak > 0 && YasIstisnasi(yas)) hak = Math.Max(hak, GunYasIstisna);

        return hak;
    }

    /// <summary>18 yaşından küçük ya da 50 yaş ve üzeri</summary>
    public static bool YasIstisnasi(int? yas) => yas is int y && (y < 18 || y >= 50);

    /// <summary>Verilen gündeki yaş; doğum tarihi yoksa null.</summary>
    public static int? Yas(DateTime? dogum, DateTime gun)
    {
        if (dogum is not DateTime d || d.Year < 1900 || d > gun) return null;

        return TamYil(d, gun);
    }

    /// <summary>Kıdem grubu: yeni (1 yıl dolmadı) · 1_5 · 6_14 · 15</summary>
    public static string Grup(int kidemYili) =>
        kidemYili < 1 ? "yeni" : kidemYili <= 5 ? "1_5" : kidemYili < 15 ? "6_14" : "15";

    /// <summary>Esas tarihten bugüne tamamlanan yıl (takvim yıldönümüyle).</summary>
    public static int TamYil(DateTime esas, DateTime gun)
    {
        var y = gun.Year - esas.Year;
        if (esas.Date.AddYears(y) > gun.Date) y--;
        return Math.Max(0, y);
    }
}

/// <summary>
/// Personelin doğum tarihleri (Mikro PERSONELLER). Kolon adı sürüme göre
/// değişebildiği için ("per_nuf_dogum_tarih") adında hem "dogum" hem
/// "tarih" geçen kolon şemadan bulunuyor. Liste 6 saat bellekte.
/// </summary>
public class DogumTarihiServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<DogumTarihiServisi> _kayit;

    private static (DateTime zaman, Dictionary<string, DateTime> liste)? _bellek;
    private static readonly object _kilit = new();

    public DogumTarihiServisi(VeritabaniServisi vt, ILogger<DogumTarihiServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    public Dictionary<string, DateTime> Tumu()
    {
        lock (_kilit)
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromHours(6)) return b.liste;

        var sonuc = new Dictionary<string, DateTime>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.PersonelBaglantisi();

            var kolon = db.ExecuteScalar<string>(@"
SELECT TOP 1 c.name
FROM [MikroDesktop_2004BICEN].sys.columns c
    JOIN [MikroDesktop_2004BICEN].sys.objects o ON o.object_id = c.object_id
WHERE o.name = 'PERSONELLER' AND c.name LIKE '%dogum%' AND c.name LIKE '%tarih%'
ORDER BY CASE WHEN c.name = 'per_nuf_dogum_tarih' THEN 0 ELSE 1 END, c.column_id");

            if (string.IsNullOrWhiteSpace(kolon) || !kolon.All(ch => char.IsLetterOrDigit(ch) || ch == '_'))
                return sonuc;

            foreach (var x in db.Query($@"
SELECT LTRIM(RTRIM(per_kod)) AS kod, [{kolon}] AS dogum
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER WITH (NOLOCK)
WHERE [{kolon}] IS NOT NULL"))
            {
                if (x.dogum is DateTime d && d.Year > 1900)
                    sonuc[K((string)x.kod)] = d.Date;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Doğum tarihleri okunamadı; yaş istisnası uygulanamıyor");
            return sonuc;
        }

        lock (_kilit) _bellek = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    public DateTime? Getir(string sicil) =>
        Tumu().TryGetValue(K(sicil), out var d) ? d : null;
}

/// <summary>
/// Yıl dönümünde yıllık izin bakiyesinin otomatik yüklenmesi (05.10.2026).
///
/// <para>
/// Personelin kıdem esas tarihi (önceki çalışma dönemleri dahil, personel
/// kartındaki kıdemle aynı) yıl dönümüne geldiği gün, o yılın hakkı
/// bakiyeye eklenir: önceki dönemin hak edileni devre geçer, yeni hak
/// "hak edilen" olur. Toplam kalan böylece yeni hak kadar artar; kullanılan
/// izinler eskisi gibi düşülür. 1. yılını dolduran ve bakiyesi olmayan
/// personele ilk bakiye (14 gün; yaş istisnasında 20) açılır.
/// </para>
///
/// <para>
/// Güvenlik: her (personel, kıdem yılı) yalnızca bir kez yüklenir
/// (KRY_IZIN_HAK_YUKLEME birincil anahtarı). Özelliğin ilk çalıştığı günden
/// önceki yıl dönümleri yüklenmez — İK o bakiyeleri elle girdi. Bakiyesi
/// yıl dönümünden sonra elle güncellenmiş personel atlanır (İK yeni hakkı
/// zaten yazmış sayılır) ve kayda "atlandı" diye düşülür.
/// </para>
/// </summary>
public class IzinHakYuklemeServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personel;
    private readonly DogumTarihiServisi _dogum;
    private readonly ILogger<IzinHakYuklemeServisi> _kayit;

    private const string BaslangicAnahtari = "IZIN_HAK_OTOMATIK_BASLANGIC";

    public IzinHakYuklemeServisi(VeritabaniServisi vt, PersonelKaynagiServisi personel,
        DogumTarihiServisi dogum, ILogger<IzinHakYuklemeServisi> kayit)
    {
        _vt = vt;
        _personel = personel;
        _dogum = dogum;
        _kayit = kayit;
    }

    public sealed record Sonuc(int Yuklenen, int Atlanan);

    private sealed class Bakiye
    {
        public decimal Baslangic { get; set; }
        public decimal Devir { get; set; }
        public DateTime BaslangicTarihi { get; set; }
        public DateTime? Guncelleme { get; set; }
        public string Guncelleyen { get; set; }
    }

    /// <summary>Bugüne kadar gelmiş, yüklenmemiş yıl dönümlerini yükler.</summary>
    public Sonuc Calistir()
    {
        var bugun = DateTime.Today;

        using var db = _vt.Baglanti();
        db.Open();

        /* İlk çalışma günü: bundan önceki yıl dönümleri yüklenmez */
        var ilk = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a",
            new { a = BaslangicAnahtari });

        if (!DateTime.TryParse(ilk, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var baslangic))
        {
            baslangic = bugun;

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = @a)
    INSERT INTO KRY_AYARLAR (anahtar, deger) VALUES (@a, @d)",
                new { a = BaslangicAnahtari, d = bugun.ToString("yyyy-MM-dd") });
        }

        var yapilmis = db.Query<(string Kod, int Yil)>(@"
SELECT personel_kodu AS Kod, kidem_yili AS Yil FROM KRY_IZIN_HAK_YUKLEME")
            .Select(x => $"{x.Kod.Trim()}|{x.Yil}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var yuklenen = 0;
        var atlanan = 0;

        foreach (var p in _personel.TumPersonelleriGetir().Where(x => x.Durum == 1))
        {
            var kod = (p.PersonelKodu ?? "").Trim();

            if (kod.Length == 0 || p.KidemTarihi is not DateTime esas) continue;

            var yil = IzinHakKurali.TamYil(esas, bugun);

            if (yil < 1) continue;

            var donum = esas.Date.AddYears(yil);

            if (donum < baslangic.Date || donum > bugun) continue;
            if (yapilmis.Contains($"{kod}|{yil}")) continue;

            var hak = IzinHakKurali.HakGun(yil, IzinHakKurali.Yas(_dogum.Getir(kod), donum));
            var ad = $"{p.Ad} {p.Soyad}".Trim();

            try
            {
                using var islem = db.BeginTransaction();

                var b = db.QueryFirstOrDefault<Bakiye>(@"
SELECT baslangic AS Baslangic, devir AS Devir, baslangic_tarihi AS BaslangicTarihi,
       guncelleme AS Guncelleme, guncelleyen AS Guncelleyen
FROM KRY_IZIN_BAKIYE WITH (UPDLOCK) WHERE personel_kodu = @kod", new { kod }, islem);

                /* Yıl dönümünden sonra İK elle güncellediyse yeni hak yazılmış sayılır */
                var elle = b is not null
                    && (b.Guncelleme ?? b.BaslangicTarihi).Date >= donum
                    && !string.Equals(b.Guncelleyen, "otomatik", StringComparison.OrdinalIgnoreCase);

                if (elle)
                {
                    db.Execute(@"
INSERT INTO KRY_IZIN_HAK_YUKLEME
    (personel_kodu, ad_soyad, kidem_yili, yildonumu, gun, onceki_baslangic, onceki_devir,
     yeni_baslangic, yeni_devir, durum)
VALUES (@kod, @ad, @yil, @donum, 0, @ob, @od, @ob, @od, N'atlandı')",
                        new { kod, ad, yil, donum, ob = b.Baslangic, od = b.Devir }, islem);

                    islem.Commit();
                    atlanan++;
                    yapilmis.Add($"{kod}|{yil}");
                    continue;
                }

                decimal ob = b?.Baslangic ?? 0m, od = b?.Devir ?? 0m;
                decimal yb = hak, yd = b is null ? 0m : od + ob;

                if (b is null)
                    db.Execute(@"
INSERT INTO KRY_IZIN_BAKIYE (personel_kodu, ad_soyad, baslangic, devir, baslangic_tarihi, aciklama, giren,
                             guncelleme, guncelleyen)
VALUES (@kod, @ad, @yb, 0, @donum, @aciklama, N'otomatik', SYSDATETIME(), N'otomatik')",
                        new { kod, ad, yb, donum, aciklama = $"{yil}. yıl hak ediş · otomatik" }, islem);
                else
                    db.Execute(@"
UPDATE KRY_IZIN_BAKIYE
SET devir = @yd, baslangic = @yb, aciklama = @aciklama,
    guncelleme = SYSDATETIME(), guncelleyen = N'otomatik'
WHERE personel_kodu = @kod",
                        new { kod, yd, yb, aciklama = $"{yil}. yıl hak ediş · otomatik ({donum:dd.MM.yyyy})" }, islem);

                db.Execute(@"
INSERT INTO KRY_IZIN_HAK_YUKLEME
    (personel_kodu, ad_soyad, kidem_yili, yildonumu, gun, onceki_baslangic, onceki_devir,
     yeni_baslangic, yeni_devir, durum, kural)
VALUES (@kod, @ad, @yil, @donum, @hak, @ob, @od, @yb, @yd, N'yüklendi', @surum)",
                    new { kod, ad, yil, donum, hak, ob, od, yb, yd, surum = IzinHakKurali.Surum }, islem);

                islem.Commit();
                yuklenen++;
                yapilmis.Add($"{kod}|{yil}");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Yıllık izin hakkı yüklenemedi: {Kod} {Yil}. yıl", kod, yil);
            }
        }

        var duzeltilen = EskiKuralDuzelt(db);

        if (yuklenen + atlanan + duzeltilen > 0)
            _kayit.LogInformation("Yıllık izin hakkı: {Yuklenen} yüklendi, {Atlanan} atlandı, {Duzeltilen} düzeltildi",
                yuklenen, atlanan, duzeltilen);

        return new Sonuc(yuklenen, atlanan);
    }

    /// <summary>
    /// 06.10.2026'dan önce 15/26 kuralıyla yapılmış otomatik yüklemeleri İş
    /// Kanunu sürelerine çeker: fark "hak edilen"e eklenir/çıkarılır. Bakiye
    /// yüklemeden sonra elle değiştirilmişse dokunulmaz (İK'nın girdiği
    /// geçerli). Her kayıt bir kez düzeltilir (kural sütunu).
    /// </summary>
    private int EskiKuralDuzelt(System.Data.IDbConnection db)
    {
        var duzeltilen = 0;

        var eskiler = db.Query(@"
SELECT personel_kodu AS kod, kidem_yili AS yil, yildonumu, gun
FROM KRY_IZIN_HAK_YUKLEME
WHERE durum = N'yüklendi' AND (kural IS NULL OR kural <> @surum)",
            new { surum = IzinHakKurali.Surum }).ToList();

        foreach (var e in eskiler)
        {
            var kod = ((string)e.kod).Trim();
            var yil = (int)e.yil;
            var donum = (DateTime)e.yildonumu;
            var eskiGun = Convert.ToInt32(e.gun);
            var yeniGun = IzinHakKurali.HakGun(yil, IzinHakKurali.Yas(_dogum.Getir(kod), donum));

            try
            {
                using var islem = db.BeginTransaction();

                if (yeniGun != eskiGun)
                {
                    /* Yalnızca bakiye hâlâ otomatik yüklemenin yazdığı hâldeyse */
                    var n = db.Execute(@"
UPDATE KRY_IZIN_BAKIYE
SET baslangic = baslangic + @fark, guncelleme = SYSDATETIME(), guncelleyen = N'otomatik',
    aciklama = @aciklama
WHERE personel_kodu = @kod AND guncelleyen = N'otomatik'",
                        new
                        {
                            kod,
                            fark = yeniGun - eskiGun,
                            aciklama = $"{yil}. yıl hak ediş · İş Kanunu süresine göre düzeltildi ({eskiGun} → {yeniGun} gün)",
                        }, islem);

                    db.Execute(@"
UPDATE KRY_IZIN_HAK_YUKLEME
SET kural = @surum, gun = CASE WHEN @n > 0 THEN @yeniGun ELSE gun END,
    yeni_baslangic = CASE WHEN @n > 0 THEN yeni_baslangic + @fark ELSE yeni_baslangic END,
    durum = CASE WHEN @n > 0 THEN N'düzeltildi' ELSE durum END
WHERE personel_kodu = @kod AND kidem_yili = @yil",
                        new { kod, yil, surum = IzinHakKurali.Surum, n, yeniGun, fark = yeniGun - eskiGun }, islem);

                    if (n > 0) duzeltilen++;
                }
                else
                {
                    db.Execute("UPDATE KRY_IZIN_HAK_YUKLEME SET kural = @surum WHERE personel_kodu = @kod AND kidem_yili = @yil",
                        new { kod, yil, surum = IzinHakKurali.Surum }, islem);
                }

                islem.Commit();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Eski kuralla yüklenen hak düzeltilemedi: {Kod} {Yil}. yıl", kod, yil);
            }
        }

        return duzeltilen;
    }

    /// <summary>Bir personelin yükleme geçmişi ve sonraki yıl dönümü.</summary>
    public object Durum(PersonelKaydi p)
    {
        var kod = (p?.PersonelKodu ?? "").Trim();

        using var db = _vt.Baglanti();

        var gecmis = db.Query(@"
SELECT TOP 20 kidem_yili AS kidemYili, yildonumu, gun, onceki_baslangic AS oncekiBaslangic,
       onceki_devir AS oncekiDevir, yeni_baslangic AS yeniBaslangic, yeni_devir AS yeniDevir,
       durum, olusturma
FROM KRY_IZIN_HAK_YUKLEME WHERE personel_kodu = @kod
ORDER BY kidem_yili DESC", new { kod }).ToList();

        object sonraki = null;

        if (p?.KidemTarihi is DateTime esas)
        {
            var yil = IzinHakKurali.TamYil(esas, DateTime.Today) + 1;
            var tarih = esas.Date.AddYears(yil);
            var yas = IzinHakKurali.Yas(_dogum.Getir(kod), tarih);

            sonraki = new
            {
                kidemYili = yil,
                tarih,
                kalanGun = (tarih - DateTime.Today).Days,
                gun = IzinHakKurali.HakGun(yil, yas),
                yas,
                yasIstisnasi = IzinHakKurali.YasIstisnasi(yas) && IzinHakKurali.KidemHakki(yil) < IzinHakKurali.GunYasIstisna,
            };
        }

        return new { gecmis, sonraki };
    }
}

/// <summary>Her sabah (kıdem eşitlemesinden sonra) ve açılışta yıl dönümü yüklemesi.</summary>
public class IzinHakYuklemeGorevi : BackgroundService
{
    private static readonly TimeSpan Saat = new(6, 40, 0);

    private readonly IServiceProvider _saglayici;
    private readonly ILogger<IzinHakYuklemeGorevi> _kayit;

    public IzinHakYuklemeGorevi(IServiceProvider saglayici, ILogger<IzinHakYuklemeGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Kıdem eşitlemesi açılıştan 4 dakika sonra; ondan sonra */
        try { await Task.Delay(TimeSpan.FromMinutes(7), jeton); } catch { return; }

        Calistir();

        while (!jeton.IsCancellationRequested)
        {
            var simdi = DateTime.Now;
            var sonraki = simdi.Date + Saat;
            if (sonraki <= simdi) sonraki = sonraki.AddDays(1);

            try { await Task.Delay(sonraki - simdi, jeton); } catch { return; }

            Calistir();
        }
    }

    private void Calistir()
    {
        try
        {
            using var kapsam = _saglayici.CreateScope();
            kapsam.ServiceProvider.GetRequiredService<IzinHakYuklemeServisi>().Calistir();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yıllık izin hakkı yüklemesi çalışmadı");
        }
    }
}

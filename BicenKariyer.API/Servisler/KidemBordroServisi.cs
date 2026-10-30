using System.Globalization;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kıdem ve yıllık izin hak ediş tarihinin bordrodan otomatik hesabı (05.10.2026).
///
/// <para>
/// Mikro personel kartı yalnızca son işe girişi biliyor. Ayrılıp tekrar
/// işe giren personelde her giriş bordro veritabanında (MikroDesktop_BICEN,
/// tahakkukların alındığı yer) ayrı bir personel kartı olarak duruyor; aynı
/// T.C. kimlik numarasıyla. Bu servis bir kişinin bütün kartlarını T.C. ile
/// toplayıp çalışma dönemlerini çıkarıyor ve paneldeki "Ara dönemden
/// hesapla" ekranının yaptığı hesabı otomatik yapıyor:
/// </para>
/// <para>
/// hak ediş esas tarihi = ilk işe giriş + çalışılmayan günlerin toplamı.
/// Çalışılmayan gün = tekrar giriş − ayrılış (son çalışılan gün) − 1.
/// Çakışan ya da art arda gelen dönemler (ayrılışın ertesi günü giriş)
/// boşluk sayılmıyor.
/// </para>
/// <para>
/// Sonuç <c>KRY_IZIN_HAKEDIS</c>'e <c>kaynak = 'bordro'</c> ile yazılıyor;
/// sistemin geri kalanı (yıllık izin, izin ücretleri, mobil) zaten oradan
/// okuyor. Elle girilmiş düzeltmeye (<c>kaynak</c> boş ya da 'elle')
/// dokunulmuyor: İK'nın bildiği bir istisna olabilir.
/// </para>
/// </summary>
public class KidemBordroServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly ILogger<KidemBordroServisi> _kayit;

    public KidemBordroServisi(VeritabaniServisi vt, PersonelKaynagiServisi kaynak,
        ILogger<KidemBordroServisi> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _kayit = kayit;
    }

    public const string Kaynak = "bordro";

    public sealed record Donem(string Kod, DateTime Giris, DateTime? Cikis);

    public sealed record AraDonem(DateTime Ayrilis, DateTime Donus, int Gun);

    public sealed record Hesap(
        DateTime IlkGiris, DateTime Esas, int BosGun, List<AraDonem> Aralar, List<Donem> Donemler);

    /* ------------------------------------------------------------------ */
    /* Bordrodaki dönemler                                                 */
    /* ------------------------------------------------------------------ */

    private static (DateTime zaman, Dictionary<string, List<Donem>> veri)? _bellek;
    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    private sealed class Satir
    {
        public string Kod { get; set; }
        public string Tc { get; set; }
        public DateTime? Giris { get; set; }
        public DateTime? Cikis { get; set; }
    }

    private static string Rakam(string s) => new((s ?? "").Where(char.IsDigit).ToArray());

    /// <summary>T.C. → bordrodaki bütün kartlarının dönemleri. 10 dakika bellekte.</summary>
    public Dictionary<string, List<Donem>> Donemler()
    {
        lock (_kilit)
        {
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromMinutes(10))
                return b.veri;
        }

        using var db = _vt.TahakkukBaglantisi();

        /* T.C. sütunu bordro veritabanında iki adla bulunabiliyor (izin
           ücretleri ve ücret pusulasıyla aynı kural). Sütun adı yalnızca bu
           iki sabitten seçildiği için sorguya güvenle yazılıyor. */
        var tcSutunu = db.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM sys.columns
WHERE object_id = OBJECT_ID('PERSONELLER')
  AND name IN ('Per_TcKimlikNo', 'per_sicil_no')
ORDER BY CASE name WHEN 'Per_TcKimlikNo' THEN 0 ELSE 1 END");

        if (tcSutunu is not ("Per_TcKimlikNo" or "per_sicil_no"))
            throw new InvalidOperationException("Bordro personel kartında T.C. kimlik sütunu bulunamadı.");

        /* Giriş / çıkış sütunları: Mikro'da per_giris_tar / per_cikis_tar
           (ücret pusulası ve personel listesi bunları okuyor). Farklı bir
           sürümde uzun adlar da olabilir; yalnızca bu sabitlerden seçiliyor. */
        string Sutun(params string[] adaylar) => db.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM sys.columns
WHERE object_id = OBJECT_ID('PERSONELLER') AND name IN @adaylar
ORDER BY CASE name WHEN @ilk THEN 0 ELSE 1 END", new { adaylar, ilk = adaylar[0] });

        var girisSutunu = Sutun("per_giris_tar", "per_ise_giris_tarihi");
        var cikisSutunu = Sutun("per_cikis_tar", "per_isten_cikis_tarihi");

        if (girisSutunu is not ("per_giris_tar" or "per_ise_giris_tarihi"))
            throw new InvalidOperationException("Bordro personel kartında işe giriş tarihi sütunu bulunamadı.");

        var cikisIfadesi = cikisSutunu is "per_cikis_tar" or "per_isten_cikis_tarihi"
            ? $"[{cikisSutunu}]"
            : "CAST(NULL AS DATETIME)";

        var satirlar = db.Query<Satir>($@"
SELECT LTRIM(RTRIM(per_kod)) AS Kod,
       LTRIM(RTRIM(CAST([{tcSutunu}] AS NVARCHAR(20)))) AS Tc,
       [{girisSutunu}] AS Giris,
       {cikisIfadesi} AS Cikis
FROM PERSONELLER WITH (NOLOCK)
WHERE [{tcSutunu}] IS NOT NULL AND [{girisSutunu}] IS NOT NULL",
            commandTimeout: 120);

        var sonuc = new Dictionary<string, List<Donem>>();

        foreach (var s in satirlar)
        {
            var tc = Rakam(s.Tc);

            if (tc.Length != 11 || s.Giris is not DateTime g || g.Year < 1950) continue;

            /* Mikro boş tarihi 1899/1900 olarak tutabiliyor; çıkıştan önceki
               ya da anlamsız çıkış tarihi "çıkış yok" sayılıyor */
            DateTime? c = s.Cikis is DateTime x && x.Year > 1950 && x.Date >= g.Date ? x.Date : null;

            if (!sonuc.TryGetValue(tc, out var l)) sonuc[tc] = l = new List<Donem>();

            l.Add(new Donem(s.Kod, g.Date, c));
        }

        lock (_kilit) _bellek = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    /* ------------------------------------------------------------------ */
    /* Hesap                                                               */
    /* ------------------------------------------------------------------ */

    /// <summary>
    /// Dönemlerden ilk giriş, ara dönemler ve hak ediş esas tarihi. Boşluk
    /// yoksa (tek dönem ya da art arda dönemler) <c>BosGun = 0</c>.
    /// </summary>
    public static Hesap Hesapla(IEnumerable<Donem> donemler)
    {
        var sirali = donemler.OrderBy(d => d.Giris).ThenBy(d => d.Cikis ?? DateTime.MaxValue).ToList();

        if (sirali.Count == 0) return null;

        var aralar = new List<AraDonem>();
        var ilk = sirali[0].Giris;
        DateTime? son = sirali[0].Cikis;   // null: hâlâ çalışıyor (ya da kayıtta çıkış yok)

        foreach (var d in sirali.Skip(1))
        {
            if (son is null)
            {
                /* Önceki dönem bitmemiş görünüyor: çakışma, boşluk yok */
                continue;
            }

            if (d.Giris > son.Value.AddDays(1))
            {
                var gun = (d.Giris - son.Value).Days - 1;
                aralar.Add(new AraDonem(son.Value, d.Giris, gun));
                son = d.Cikis;
            }
            else
            {
                /* Çakışan ya da ertesi gün başlayan dönem: birleşir */
                son = d.Cikis is null ? null : (d.Cikis > son ? d.Cikis : son);
            }
        }

        var bos = aralar.Sum(a => a.Gun);

        return new Hesap(ilk, ilk.AddDays(bos), bos, aralar, sirali);
    }

    /// <summary>Paneldeki biçim: [{"ayrilis":"yyyy-MM-dd","donus":"yyyy-MM-dd"}]</summary>
    public static string AraDonemJson(Hesap h) =>
        JsonSerializer.Serialize(h.Aralar.Select(a => new
        {
            ayrilis = a.Ayrilis.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            donus = a.Donus.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
        }));

    /// <summary>Bir personelin bordrodaki dönemleri ve hesabı (T.C. ile).</summary>
    public Hesap KisiHesabi(PersonelKaydi p)
    {
        var tc = Rakam(p?.KimlikNo);

        if (tc.Length != 11) return null;

        return Donemler().TryGetValue(tc, out var l) ? Hesapla(l) : null;
    }

    /* ------------------------------------------------------------------ */
    /* Eşitleme                                                            */
    /* ------------------------------------------------------------------ */

    public sealed record Sonuc(
        int Incelenen, int TekrarGiren, int Yazilan, int Degismeyen,
        int ElleAtlanan, int Kaldirilan, int TcYok);

    /// <summary>
    /// Çalışan bütün personelin bordrodan hak ediş tarihini yazar.
    /// Elle düzeltilmiş kayda dokunmaz. Ara dönemi kalmayan (bordrodan
    /// yazılmış ama artık boşluk görünmeyen) kaydı kaldırır.
    /// </summary>
    public Sonuc Esitle(string yapan = "Sistem (bordro)")
    {
        Unut();
        var donemler = Donemler();

        var aktif = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        using var db = _vt.Baglanti();

        var mevcut = db.Query(@"
SELECT personel_kodu AS kod, hakedis_tarihi AS tarih, ilk_giris AS ilk,
       ara_donemler AS ara, kaynak
FROM KRY_IZIN_HAKEDIS")
            .ToDictionary(x => ((string)x.kod ?? "").Trim(), x => x, StringComparer.OrdinalIgnoreCase);

        int incelenen = 0, tekrar = 0, yazilan = 0, ayni = 0, elle = 0, kaldirilan = 0, tcYok = 0;

        foreach (var p in aktif)
        {
            var kod = (p.PersonelKodu ?? "").Trim();
            if (kod.Length == 0) continue;

            incelenen++;

            var tc = Rakam(p.KimlikNo);

            if (tc.Length != 11)
            {
                tcYok++;
                continue;
            }

            mevcut.TryGetValue(kod, out var m);
            var bordroKaydi = m is not null && string.Equals((string)m.kaynak, Kaynak, StringComparison.OrdinalIgnoreCase);

            var h = donemler.TryGetValue(tc, out var l) ? Hesapla(l) : null;

            if (h is null || h.BosGun == 0)
            {
                /* Boşluk yok: bordrodan yazılmış eski kayıt varsa kaldırılır */
                if (bordroKaydi)
                {
                    db.Execute("DELETE FROM KRY_IZIN_HAKEDIS WHERE personel_kodu = @kod AND kaynak = @k",
                        new { kod, k = Kaynak });
                    kaldirilan++;
                }

                continue;
            }

            tekrar++;

            if (m is not null && !bordroKaydi)
            {
                elle++;
                continue;
            }

            var ara = AraDonemJson(h);

            if (bordroKaydi && m.tarih is DateTime t && t.Date == h.Esas.Date
                && m.ilk is DateTime i && i.Date == h.IlkGiris.Date && (string)m.ara == ara)
            {
                ayni++;
                continue;
            }

            db.Execute(@"
MERGE KRY_IZIN_HAKEDIS AS h
USING (SELECT @kod AS kod) AS y ON h.personel_kodu = y.kod
WHEN MATCHED AND h.kaynak = @kaynak THEN
    UPDATE SET hakedis_tarihi = @esas, ilk_giris = @ilk, ara_donemler = @ara,
               aciklama = @aciklama, ad_soyad = @ad, guncelleyen = @yapan,
               guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, ad_soyad, hakedis_tarihi, ilk_giris, ara_donemler,
            aciklama, guncelleyen, kaynak)
    VALUES (@kod, @ad, @esas, @ilk, @ara, @aciklama, @yapan, @kaynak);",
                new
                {
                    kod,
                    ad = $"{p.Ad} {p.Soyad}".Trim(),
                    esas = h.Esas.Date,
                    ilk = h.IlkGiris.Date,
                    ara,
                    aciklama = $"Bordrodan otomatik: {h.Donemler.Count} giriş, {h.Aralar.Count} ara dönem, {h.BosGun} gün",
                    yapan,
                    kaynak = Kaynak
                });

            yazilan++;
        }

        PersonelKaynagiServisi.KidemiUnut();

        _kayit.LogInformation(
            "Kıdem bordrodan eşitlendi: {Incelenen} kişi, {Tekrar} tekrar giriş, {Yazilan} yazıldı, {Elle} elle düzeltilmiş atlandı, {Kaldirilan} kaldırıldı",
            incelenen, tekrar, yazilan, elle, kaldirilan);

        return new Sonuc(incelenen, tekrar, yazilan, ayni, elle, kaldirilan, tcYok);
    }
}

/// <summary>
/// Her sabah 06:20'de (ve açılıştan birkaç dakika sonra bir kez) kıdemi
/// bordrodan eşitler. Bordroya yeni giriş ya da çıkış işlendiğinde ertesi
/// gün hak ediş tarihi kendiliğinden güncellenir.
/// </summary>
public class KidemBordroGorevi : BackgroundService
{
    private static readonly TimeSpan Saat = new(6, 20, 0);

    private readonly IServiceProvider _saglayici;
    private readonly ILogger<KidemBordroGorevi> _kayit;

    public KidemBordroGorevi(IServiceProvider saglayici, ILogger<KidemBordroGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu ve personel önbelleği sürüyor */
        try { await Task.Delay(TimeSpan.FromMinutes(4), jeton); } catch { return; }

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
            kapsam.ServiceProvider.GetRequiredService<KidemBordroServisi>().Esitle();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kıdem bordrodan eşitlenemedi");
        }
    }
}

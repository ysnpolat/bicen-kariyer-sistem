using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Duyuru videoları (28.10.2026).
///
/// <para>
/// Videolar sunucuda Belge:Klasor/duyuru-video altında duruyor. Bu görev
/// altı saatte bir:
/// </para>
/// <list type="bullet">
///   <item>60 günü geçen duyuru videolarını siler ve o videoyu gösteren
///   duyuruların bağlantısını boşaltır (duyuru kalır, video kalkar).
///   Biçen'den Haberler gönderilerinde kullanılan videolara dokunmaz.</item>
///   <item>Yarım kalmış yüklemeleri (iki günden eski) siler.</item>
///   <item>Kalan videoları hızlı başlatmaya çevirir; telefonda dosyanın
///   tamamı inmeden oynamaya başlar.</item>
/// </list>
/// </summary>
public class DuyuruVideoTemizlikGorevi : BackgroundService
{
    public const int SaklamaGunu = 60;

    private readonly IServiceProvider _saglayici;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<DuyuruVideoTemizlikGorevi> _kayit;

    public DuyuruVideoTemizlikGorevi(IServiceProvider saglayici, IConfiguration yapilandirma,
        IWebHostEnvironment ortam, ILogger<DuyuruVideoTemizlikGorevi> kayit)
    {
        _saglayici = saglayici;
        _yapilandirma = yapilandirma;
        _ortam = ortam;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromSeconds(60), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Duyuru videoları temizlenemedi");
            }

            await Task.Delay(TimeSpan.FromHours(6), jeton);
        }
    }

    private void Calistir()
    {
        var klasor = VideoParca.Klasor(_yapilandirma, _ortam);
        if (!Directory.Exists(klasor)) return;

        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        using var db = vt.Baglanti();

        /* Haber gönderilerinin videoları silinmez */
        var haberVideolari = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (db.ExecuteScalar<int>("SELECT CASE WHEN COL_LENGTH('KRY_HABER', 'video') IS NULL THEN 0 ELSE 1 END") == 1)
                foreach (var v in db.Query<string>("SELECT video FROM KRY_HABER WHERE video IS NOT NULL AND silindi = 0"))
                    haberVideolari.Add(v.Trim());
        }
        catch (Exception h)
        {
            /* Haber tablosu okunamazsa hiçbir şey silinmesin */
            _kayit.LogWarning(h, "Haber videoları okunamadı; video silme atlandı");
            return;
        }

        var sinir = DateTime.UtcNow.AddDays(-SaklamaGunu);

        foreach (var yol in Directory.EnumerateFiles(klasor))
        {
            var ad = Path.GetFileName(yol);

            /* Yarım kalmış yükleme */
            if (ad.EndsWith(".yukleniyor", StringComparison.OrdinalIgnoreCase) ||
                ad.EndsWith(".hizli", StringComparison.OrdinalIgnoreCase))
            {
                if (File.GetLastWriteTimeUtc(yol) < DateTime.UtcNow.AddDays(-2))
                    Sil(yol);
                continue;
            }

            var anahtar = Path.GetFileNameWithoutExtension(yol);
            if (!VideoParca.AnahtarDeseni.IsMatch(anahtar)) continue;
            if (!VideoParca.Turler.ContainsKey(Path.GetExtension(yol))) continue;

            var zaman = File.GetCreationTimeUtc(yol);
            var yazma = File.GetLastWriteTimeUtc(yol);
            if (yazma > zaman) zaman = yazma;

            if (zaman < sinir && !haberVideolari.Contains(anahtar))
            {
                if (Sil(yol))
                {
                    var n = db.Execute(@"
UPDATE KRY_MOBIL_DUYURU
SET baglanti = NULL, baglanti_yazi = NULL
WHERE baglanti LIKE @desen", new { desen = "%/DuyuruVideo/Izle/" + anahtar + "%" });

                    _kayit.LogInformation("Duyuru videosu {Gun} günü geçtiği için silindi: {Anahtar} ({Adet} duyuru)",
                        SaklamaGunu, anahtar, n);
                }
                continue;
            }

            Mp4HizliBaslat.Duzenle(yol, _kayit);
        }
    }

    private bool Sil(string yol)
    {
        try
        {
            File.Delete(yol);
            return true;
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Video silinemedi: {Yol}", yol);
            return false;
        }
    }
}

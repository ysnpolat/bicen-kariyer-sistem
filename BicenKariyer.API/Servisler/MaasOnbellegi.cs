namespace BicenKariyer.API.Servisler;

/// <summary>
/// Aylık maaşların ortak önbelleği (15.10.2026). Maaşlar Mikro bordrosundan
/// hesaplanıyor (Yıllık İzin Ücretleri ile aynı kaynak) ve bu birkaç saniye
/// sürüyor; avans listesi / detayı ve fazla mesai personel penceresi her
/// açılışta bunu bekliyordu.
///
/// <list type="bullet">
/// <item>Arka plan görevi (<see cref="MaasOnbellegiGorevi"/>) uygulama
/// açılınca ve her 10 dakikada bir listeyi yeniler.</item>
/// <item>Liste 15 dakikadan eskiyse bekletmeden eldeki verilir, yenisi
/// arkada hazırlanır (12 saatten eskiyse beklenir).</item>
/// </list>
/// Tutarlar yalnızca bellekte; günlüğe yazılmaz.
/// </summary>
public static class MaasOnbellegi
{
    private static readonly object Kilit = new();
    private static Dictionary<string, decimal> _liste;
    private static DateTime _zaman = DateTime.MinValue;
    private static int _yenileniyor;

    private static readonly TimeSpan Taze = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan EnEski = TimeSpan.FromHours(12);

    /// <summary>Sicil (baştaki sıfırsız) → aylık ücret</summary>
    public static Dictionary<string, decimal> Getir(IServiceProvider saglayici)
    {
        var liste = _liste;
        var yas = DateTime.UtcNow - _zaman;

        if (liste is not null && yas < Taze) return liste;

        if (liste is not null && yas < EnEski)
        {
            ArkadaYenile(saglayici);
            return liste;
        }

        lock (Kilit)
        {
            if (_liste is not null && DateTime.UtcNow - _zaman < Taze) return _liste;
            Yukle(saglayici);
            return _liste ?? new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        }
    }

    public static void ArkadaYenile(IServiceProvider saglayici)
    {
        if (Interlocked.CompareExchange(ref _yenileniyor, 1, 0) != 0) return;

        var fabrika = saglayici.GetRequiredService<IServiceScopeFactory>();

        _ = Task.Run(() =>
        {
            try
            {
                using var kapsam = fabrika.CreateScope();
                lock (Kilit) Yukle(kapsam.ServiceProvider);
            }
            catch
            {
                /* eldeki liste kullanılmaya devam eder */
            }
            finally
            {
                Interlocked.Exchange(ref _yenileniyor, 0);
            }
        });
    }

    /// <summary>Arka plan görevinden gelen taze liste</summary>
    public static void Ayarla(Dictionary<string, decimal> yeni)
    {
        lock (Kilit)
        {
            _liste = new Dictionary<string, decimal>(yeni, StringComparer.OrdinalIgnoreCase);
            _zaman = DateTime.UtcNow;
        }
    }

    /// <summary>Kilit içinde çağrılır</summary>
    private static void Yukle(IServiceProvider saglayici)
    {
        var yeni = saglayici.GetRequiredService<Controllers.IzinUcretiController>().AylikMaaslar();
        _liste = new Dictionary<string, decimal>(yeni, StringComparer.OrdinalIgnoreCase);
        _zaman = DateTime.UtcNow;
    }
}

/// <summary>Maaş önbelleğini açılışta ve her 10 dakikada bir tazeler</summary>
public class MaasOnbellegiGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<MaasOnbellegiGorevi> _kayit;

    public MaasOnbellegiGorevi(IServiceProvider saglayici, ILogger<MaasOnbellegiGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromSeconds(40), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                using var kapsam = _saglayici.CreateScope();
                var zaman = System.Diagnostics.Stopwatch.StartNew();
                var sayi = MaasOnbellegiYenile(kapsam.ServiceProvider);
                _kayit.LogInformation("Maaş önbelleği yenilendi: {Sayi} kişi, {Ms} ms", sayi, zaman.ElapsedMilliseconds);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Maaş önbelleği yenilenemedi");
            }

            await Task.Delay(TimeSpan.FromMinutes(10), jeton);
        }
    }

    private static int MaasOnbellegiYenile(IServiceProvider sp)
    {
        var yeni = sp.GetRequiredService<Controllers.IzinUcretiController>().AylikMaaslar();
        MaasOnbellegi.Ayarla(yeni);
        return yeni.Count;
    }
}

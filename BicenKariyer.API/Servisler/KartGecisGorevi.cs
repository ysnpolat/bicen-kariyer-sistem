namespace BicenKariyer.API.Servisler;

/// <summary>
/// Gece kart geçişlerini aktarır: son üç gün, her gece 03:30'da.
///
/// <para>
/// Üç gün, tek gün değil: geçiş sunucusu gece kapalıysa ya da kayıtlar
/// geç düşerse eksik gün kalmasın. Aktarım tekrar çalıştırılabilir
/// olduğu için aynı kayıt ikinci kez eklenmiyor.
/// </para>
///
/// <para>
/// Kart sistemi kapatıldığında appsettings'te
/// <c>KartGecis:Aktarim</c> false yapılıyor ve görev durur; aktarılmış
/// geçmiş veri tabloda kalır, mobil okutmalar kaldığı yerden devam eder.
/// </para>
/// </summary>
public class KartGecisGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly IConfiguration _ayar;
    private readonly ILogger<KartGecisGorevi> _kayit;

    public KartGecisGorevi(IServiceProvider saglayici, IConfiguration ayar, ILogger<KartGecisGorevi> kayit)
    {
        _saglayici = saglayici;
        _ayar = ayar;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(9), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                /* Varsayılan açık; kart sistemi kapatılınca false yapılır */
                var acik = _ayar.GetValue("KartGecis:Aktarim", true);

                var simdi = DateTime.Now;

                if (acik && simdi.Hour == 3 && simdi.Minute >= 30 && simdi.Minute < 45)
                {
                    using var kapsam = _saglayici.CreateScope();

                    var aktarim = kapsam.ServiceProvider.GetRequiredService<KartGecisAktarimServisi>();

                    aktarim.Aktar(DateTime.Today.AddDays(-3), DateTime.Today);
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Gecelik kart geçiş aktarımı yapılamadı");
            }

            await Task.Delay(TimeSpan.FromMinutes(15), jeton);
        }
    }
}

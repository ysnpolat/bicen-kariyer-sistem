namespace Bicen360.API.Servisler;

/// <summary>
/// Rapor Merkezi ön yüklemesi.
///
/// <para>
/// Açılışta diskteki kesin günler belleğe alınıyor ve son iki ayın küpü
/// arka planda hazırlanıyor: sayfayı ilk açan kişi "son 30 gün" için
/// Mikro sorgusunu beklemesin. Sonra yarım saatte bir son günler
/// tazeleniyor (geç aktarılan satışlar).
/// </para>
/// </summary>
public class RaporMerkeziGorevi : BackgroundService
{
    private readonly RaporMerkeziServisi _rm;
    private readonly ILogger<RaporMerkeziGorevi> _kayit;

    public RaporMerkeziGorevi(RaporMerkeziServisi rm, ILogger<RaporMerkeziGorevi> kayit)
    {
        _rm = rm;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken iptal)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), iptal);

            var sayi = _rm.DiskOku();

            _kayit.LogInformation("Rapor Merkezi: diskten {Sayi} gün okundu", sayi);

            while (!iptal.IsCancellationRequested)
            {
                try
                {
                    var dun = DateTime.Today.AddDays(-1);

                    _rm.Hazirla(dun.AddDays(-61), dun);
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Rapor Merkezi ön yüklemesi başarısız");
                }

                await Task.Delay(TimeSpan.FromMinutes(30), iptal);
            }
        }
        catch (TaskCanceledException)
        {
            /* Uygulama kapanıyor */
        }
    }
}

using BicenKariyer.API.Controllers;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Gönderilmeyi unutulan vardiya planlarını on dakikada bir gönderir
/// (bkz. VardiyaPlanController.OtomatikGonder). Gece bildirim atılmaz.
/// </summary>
public class VardiyaOtomatikGonderGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<VardiyaOtomatikGonderGorevi> _kayit;

    public VardiyaOtomatikGonderGorevi(IServiceProvider saglayici, ILogger<VardiyaOtomatikGonderGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(3), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                var saat = DateTime.Now.Hour;
                var dakika = Parametre.Sayi("vardiya.otomatikGonderDakika");

                if (dakika > 0 && saat >= 8 && saat < 22)
                {
                    using var kapsam = _saglayici.CreateScope();
                    var denetleyici = ActivatorUtilities.CreateInstance<VardiyaPlanController>(kapsam.ServiceProvider);
                    var adet = await denetleyici.OtomatikGonder(dakika);

                    if (adet > 0) _kayit.LogInformation("Vardiya planı otomatik gönderildi: {Adet} kişi", adet);
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Vardiya planı otomatik gönderimi işlenemedi");
            }

            await Task.Delay(TimeSpan.FromMinutes(10), jeton);
        }
    }
}

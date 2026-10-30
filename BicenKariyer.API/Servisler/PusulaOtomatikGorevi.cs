using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Süresi dolan ücret pusulalarını onaylanmış sayar.
///
/// <para>
/// Personele yükleme anında "yedi gün içinde onaylamadığınız ya da itiraz
/// etmediğiniz takdirde onaylanmış sayılacaktır" deniyor. Kural
/// uygulanmazsa pusulaların çoğu süresiz "bekliyor" durumunda kalıyor ve
/// İK'nın elinde kimin gerçekten itirazı olduğu görünmüyordu.
/// </para>
///
/// <para>
/// Otomatik onaylananlar <c>otomatik = 1</c> ile işaretleniyor: elle
/// onaylanmış bir pusulayla aynı görünmesi, sonradan çıkan bir uyuşmazlıkta
/// yanıltıcı olurdu.
/// </para>
/// </summary>
public class PusulaOtomatikGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<PusulaOtomatikGorevi> _kayit;

    public PusulaOtomatikGorevi(
        IServiceProvider saglayici, ILogger<PusulaOtomatikGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu sürüyor olabilir */
        await Task.Delay(TimeSpan.FromMinutes(4), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Pusula otomatik onayı işlenemedi");
            }

            /* Saatte bir yeterli: sınır gün bazında, dakika hassasiyeti
               gerekmiyor. */
            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private void Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        /* İtiraz edilmiş pusula otomatik onaylanmıyor: itiraz açıkken süre
           dolduğu için onaylanmış saymak, itirazı sessizce yok sayardı. */
        var sayi = db.Execute(@"
UPDATE KRY_PUSULA
SET durum = N'onaylandi', otomatik = 1, onay_tarihi = SYSDATETIME()
WHERE silindi = 0
  AND durum = N'bekliyor'
  AND son_gun IS NOT NULL
  AND son_gun < CAST(SYSDATETIME() AS DATE)");

        if (sayi > 0)
            _kayit.LogInformation(
                "Ücret pusulası: {Adet} kayıt süresi dolduğu için onaylandı", sayi);
    }
}

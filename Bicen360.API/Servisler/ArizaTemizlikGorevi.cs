using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Kapanmış arıza kayıtlarının fotoğraflarını siler.
///
/// <para>
/// Checklist görsellerindeki desenin aynısı, süresi farklı. Orada yedi gün
/// yetiyor çünkü kontrolün amacı anlık durumu göstermek. Arızada fotoğraf
/// kaydın kanıtı: kayıt açıkken silinmemeli, kapandıktan sonra da bir süre
/// durmalı ki itiraz gelirse bakılabilsin. Varsayılan, kapanmadan sonra
/// otuz gün.
/// </para>
///
/// <para>
/// Silinen yalnızca dosyadır. Kayıt, hareket geçmişi ve açıklamalar durur;
/// görsel istendiğinde "süresi dolmuş" bilgisi döner. Böylece kimin ne
/// zaman ne yaptığı kaybolmuyor.
/// </para>
/// </summary>
public class ArizaTemizlikGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly IWebHostEnvironment _ortam;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<ArizaTemizlikGorevi> _kayit;

    public ArizaTemizlikGorevi(
        IServiceProvider saglayici,
        IWebHostEnvironment ortam,
        IConfiguration yapilandirma,
        ILogger<ArizaTemizlikGorevi> kayit)
    {
        _saglayici = saglayici;
        _ortam = ortam;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta hemen çalışmaz: uygulama ayağa kalkarken tablo kurulumu
           sürüyor olabilir. */
        await Task.Delay(TimeSpan.FromMinutes(3), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Temizle();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Arıza görsel temizliği yapılamadı");
            }

            await Task.Delay(TimeSpan.FromHours(6), jeton);
        }
    }

    private void Temizle()
    {
        var gun = int.TryParse(_yapilandirma["Ariza:GorselSaklamaGunu"], out var g) ? g : 30;

        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        var eskiler = db.Query<(int id, string dosya)>(@"
SELECT G.id, G.dosya
FROM B360_ARIZA_GORSEL G
    INNER JOIN B360_ARIZA A ON G.ariza_id = A.id
WHERE G.silindi = 0
  AND A.kapanma IS NOT NULL
  AND A.kapanma < DATEADD(DAY, -@gun, SYSDATETIME())", new { gun }).ToList();

        if (eskiler.Count == 0) return;

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        var klasor = Path.Combine(kok, "ariza");

        foreach (var (id, dosya) in eskiler)
        {
            try
            {
                var yol = Path.Combine(klasor, dosya);
                if (File.Exists(yol)) File.Delete(yol);
            }
            catch (Exception hata)
            {
                /* Dosya silinemese de kayıt işaretlenir; bir sonraki turda
                   tekrar denenmesi sonsuz döngü yaratırdı. */
                _kayit.LogWarning(hata, "Görsel dosyası silinemedi: {Dosya}", dosya);
            }

            db.Execute("UPDATE B360_ARIZA_GORSEL SET silindi = 1 WHERE id = @id",
                new { id });
        }

        _kayit.LogInformation("{Sayi} arıza görseli temizlendi.", eskiler.Count);
    }
}

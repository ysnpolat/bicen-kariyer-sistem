using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Checklist görsellerini yedi gün sonra siler.
///
/// <para>
/// Hacim hızla büyüyor: her mağazada her gün birden çok madde, her maddede
/// birkaç fotoğraf. Kontrolün amacı anlık durumu göstermek olduğu için eski
/// fotoğrafların saklanması gerekmiyor.
/// </para>
///
/// <para>
/// Silinen yalnızca dosyadır. Kayıt, cevap ve yorumlar durur; panelde
/// geçmişe bakıldığında "görsel süresi dolduğu için silinmiş" bilgisi
/// görünür. Böylece kimin ne zaman ne cevapladığı kaybolmuyor.
/// </para>
/// </summary>
public class ChecklistTemizlikGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<ChecklistTemizlikGorevi> _kayit;

    /// <summary>Görsellerin saklanma süresi</summary>
    private const int SaklamaGunu = 7;

    public ChecklistTemizlikGorevi(
        IServiceProvider saglayici,
        IWebHostEnvironment ortam,
        ILogger<ChecklistTemizlikGorevi> kayit)
    {
        _saglayici = saglayici;
        _ortam = ortam;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta hemen çalışmaz: uygulama ayağa kalkarken veritabanı
           kurulumu sürüyor olabilir. */
        await Task.Delay(TimeSpan.FromMinutes(3), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Temizle();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Checklist görsel temizliği yapılamadı");
            }

            await Task.Delay(TimeSpan.FromHours(6), jeton);
        }
    }

    private void Temizle()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        var sinir = DateTime.Now.AddDays(-SaklamaGunu);

        var eskiler = db.Query<(int Id, string Dosya)>(@"
SELECT id AS Id, dosya AS Dosya
FROM KRY_CHECKLIST_GORSEL
WHERE silindi = 0 AND olusturma < @sinir", new { sinir }).ToList();

        if (eskiler.Count == 0) return;

        var kok = string.IsNullOrWhiteSpace(_ortam.ContentRootPath)
            ? AppContext.BaseDirectory
            : _ortam.ContentRootPath;

        var klasor = Path.Combine(kok, "checklist");

        var silinen = 0;

        foreach (var (id, dosya) in eskiler)
        {
            try
            {
                var yol = Path.Combine(klasor, dosya);

                if (File.Exists(yol)) File.Delete(yol);

                /* Dosya zaten yoksa da işaretlenir: tekrar tekrar
                   denenmesinin anlamı yok. */
                db.Execute(
                    "UPDATE KRY_CHECKLIST_GORSEL SET silindi = 1 WHERE id = @id",
                    new { id });

                silinen++;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Görsel silinemedi: {Dosya}", dosya);
            }
        }

        _kayit.LogInformation(
            "Checklist temizliği: {Adet} görsel silindi ({Gun} günden eski)",
            silinen, SaklamaGunu);
    }
}

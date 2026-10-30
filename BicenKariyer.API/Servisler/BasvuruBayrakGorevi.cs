using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Başvuru bayraklarını (engel_var, fotograf_var) eski kayıtlar için
/// arka planda doldurur.
///
/// <para>
/// Bayraklar veri_json'un içinden türetilir ve veri_json fotoğrafın
/// base64'ünü taşıdığı için satır başına yüzlerce KB'dir. Hepsini tek
/// seferde açılışta hesaplamak uygulamayı dakikalarca kilitlerdi; burada
/// küçük partiler hâlinde, aralıklarla yapılır. Yeni kayıtlarda bayrak
/// kayıt sırasında yazılır, bu görev yalnızca geçmişi tamamlar ve iş
/// bitince boşta bekler.
/// </para>
/// </summary>
public class BasvuruBayrakGorevi : BackgroundService
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<BasvuruBayrakGorevi> _kayit;

    /// <summary>Bir partide işlenen kayıt sayısı</summary>
    private const int Parti = 100;

    public BasvuruBayrakGorevi(VeritabaniServisi vt, ILogger<BasvuruBayrakGorevi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu bitsin */
        await Task.Delay(TimeSpan.FromSeconds(45), jeton);

        while (!jeton.IsCancellationRequested)
        {
            var kalan = 0;

            try
            {
                kalan = PartiIsle();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Başvuru bayrakları doldurulamadı");
            }

            /* İş varken sık, bitince seyrek: yeni kayıtlar bayrağı zaten
               girişte alıyor, burası yalnızca kaçanı yakalar. */
            await Task.Delay(kalan > 0 ? TimeSpan.FromSeconds(5) : TimeSpan.FromHours(1), jeton);
        }
    }

    /// <summary>Bir parti işler; hesaplanmayı bekleyen kayıt kaldıysa sayısını döner.</summary>
    private int PartiIsle()
    {
        using var db = _vt.Baglanti();

        var bekleyen = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BASVURULAR
WHERE engel_var IS NULL OR fotograf_var IS NULL");

        if (bekleyen == 0) return 0;

        /* Tek UPDATE ile parti: hesaplama sunucuda, satırlar uygulamaya
           taşınmaz. LOB yalnızca bu partinin satırlarında okunur. */
        var islenen = db.Execute(@"
UPDATE b
SET engel_var = CASE WHEN REPLACE(b.veri_json, ' ', '')
                          LIKE '%""engelDurumuVarMi"":""Evet""%'
                     THEN 1 ELSE 0 END,
    fotograf_var = CASE WHEN b.fotograf_ozeti IS NOT NULL
                          OR CHARINDEX('base64', b.veri_json) > 0
                        THEN 1 ELSE 0 END
FROM KRY_BASVURULAR b
WHERE b.id IN (
    SELECT TOP (@parti) id FROM KRY_BASVURULAR
    WHERE engel_var IS NULL OR fotograf_var IS NULL
    ORDER BY id DESC)",
            new { parti = Parti }, commandTimeout: 120);

        var kalan = Math.Max(0, bekleyen - islenen);

        if (kalan == 0)
            _kayit.LogInformation("Başvuru bayrakları tamamlandı");

        return kalan;
    }
}

using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Planlı duyurular (27.10.2026): yayın zamanı gelen duyurunun bildirimini
/// gönderir. Duyuru kaydı oluşturulurken <c>olusturma</c> yayın zamanı
/// olarak yazılıyor; personel listeleri <c>olusturma &lt;= şimdi</c> olanları
/// gösterdiği için duyuru zamanında kendiliğinden görünür. Bu görev
/// yalnız anlık bildirimi (push) o dakikada gönderir; dakikada bir çalışır.
/// Aynı duyuru iki kez gönderilmesin diye bayrak önce düşürülüp sonra
/// bildirim gönderiliyor.
/// </summary>
public class DuyuruPlanGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<DuyuruPlanGorevi> _kayit;

    public DuyuruPlanGorevi(IServiceProvider saglayici, ILogger<DuyuruPlanGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromSeconds(45), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Planlı duyurular denetlenemedi");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), jeton);
        }
    }

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();
        var sp = kapsam.ServiceProvider;
        var vt = sp.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        if (db.ExecuteScalar<int>("SELECT CASE WHEN COL_LENGTH('KRY_MOBIL_DUYURU', 'planli_bildirim') IS NULL THEN 0 ELSE 1 END") == 0)
            return;

        var gelenler = db.Query(@"
SELECT id, hedef_tur AS hedef, sube_adi AS sube, personel_kodu AS kod, baslik, metin
FROM KRY_MOBIL_DUYURU
WHERE iptal = 0 AND planli_bildirim = 1 AND olusturma <= SYSDATETIME()
ORDER BY olusturma").ToList();

        if (gelenler.Count == 0) return;

        var bildirim = sp.GetRequiredService<BildirimServisi>();
        var kaynak = sp.GetRequiredService<PersonelKaynagiServisi>();

        foreach (var d in gelenler)
        {
            var id = (int)d.id;

            /* Önce bayrak: iki süreç aynı anda çalışsa da bildirim bir kez gider */
            if (db.Execute("UPDATE KRY_MOBIL_DUYURU SET planli_bildirim = 0 WHERE id = @id AND planli_bildirim = 1", new { id }) == 0)
                continue;

            var hedef = string.IsNullOrWhiteSpace((string)d.hedef) ? "herkes" : ((string)d.hedef).Trim();
            List<string> secilenler = null;

            if (hedef == "secili")
                secilenler = db.Query<string>("SELECT personel_kodu FROM KRY_MOBIL_DUYURU_ALICI WHERE duyuru_id = @id", new { id }).ToList();

            await BicenKariyer.API.Controllers.MobilController.DuyuruBildir(bildirim, kaynak, _kayit,
                hedef, (string)d.sube, (string)d.kod, secilenler, (string)d.baslik, (string)d.metin);

            _kayit.LogInformation("Planlı duyuru yayına girdi, bildirim gönderildi: {Id}", id);
        }
    }
}

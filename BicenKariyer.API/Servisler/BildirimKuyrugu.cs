using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Toplu bildirim kuyruğu (21.10.2026).
///
/// <para>
/// 800 kişiye aynı anda "kartınıza bakiye yüklendi" bildirimi gidince
/// herkes aynı dakikada uygulamayı açıyor; ana sayfa, kart ve bekleyen işler
/// sorguları üst üste binip uygulamayı ve paneli yavaşlatıyordu. Kuyruğa
/// alınan bildirimler bildirim.dakikadaKisi hızıyla sırayla gönderilir.
/// </para>
/// </summary>
public static class BildirimKuyrugu
{
    public static int Ekle(System.Data.IDbConnection db, IEnumerable<(string Kod, string Baslik, string Metin)> liste, string ekran)
    {
        var hiz = Math.Max(10, Parametre.Sayi("bildirim.dakikadaKisi"));
        var simdi = DateTime.Now;

        var satirlar = liste
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .Select((x, i) => new
            {
                kod = x.Kod.Trim(),
                baslik = Kisalt(x.Baslik, 200),
                metin = Kisalt(x.Metin, 1000),
                ekran,
                /* i. kişi i / hız dakika sonra */
                planlanan = simdi.AddSeconds(i * 60.0 / hiz),
            })
            .ToList();

        if (satirlar.Count == 0) return 0;

        db.Execute(@"
INSERT INTO KRY_BILDIRIM_KUYRUK (personel_kodu, baslik, metin, ekran, planlanan)
VALUES (@kod, @baslik, @metin, @ekran, @planlanan)", satirlar);

        return satirlar.Count;
    }

    private static string Kisalt(string s, int n) => (s ?? "").Length > n ? s[..n] : s ?? "";
}

/// <summary>Kuyruğu 15 saniyede bir boşaltır.</summary>
public class BildirimKuyrukGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<BildirimKuyrukGorevi> _kayit;

    public BildirimKuyrukGorevi(IServiceProvider saglayici, ILogger<BildirimKuyrukGorevi> kayit)
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
                using var kapsam = _saglayici.CreateScope();
                var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
                var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();

                using var db = vt.Baglanti();

                var gelen = db.Query<(int Id, string Kod, string Baslik, string Metin, string Ekran)>(@"
SELECT TOP 500 id, personel_kodu, baslik, metin, ekran
FROM KRY_BILDIRIM_KUYRUK
WHERE gonderildi IS NULL AND planlanan <= SYSDATETIME()
ORDER BY planlanan, id").ToList();

                if (gelen.Count > 0)
                {
                    /* Önce işaretle: gönderim sırasında görev yeniden başlarsa iki kez gitmesin */
                    db.Execute("UPDATE KRY_BILDIRIM_KUYRUK SET gonderildi = SYSDATETIME() WHERE id IN @idler",
                        new { idler = gelen.Select(x => x.Id).ToList() });

                    foreach (var grup in gelen.GroupBy(x => x.Ekran ?? ""))
                        await bildirim.KisiyeOzelGonder(
                            grup.Select(x => (x.Kod, x.Baslik, x.Metin)),
                            string.IsNullOrEmpty(grup.Key) ? null : grup.Key);
                }

                /* 30 günden eski kayıtlar silinir */
                if (DateTime.Now.Minute == 0 && DateTime.Now.Second < 15)
                    db.Execute("DELETE FROM KRY_BILDIRIM_KUYRUK WHERE gonderildi < DATEADD(DAY, -30, SYSDATETIME())");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Bildirim kuyruğu işlenemedi");
            }

            await Task.Delay(TimeSpan.FromSeconds(15), jeton);
        }
    }
}

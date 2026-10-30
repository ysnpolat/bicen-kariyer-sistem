using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Takvim notlarının hatırlatmalarını çalıştırır.
///
/// <para>
/// Zamanı gelen notlar panel çanına bildirim olarak düşer. Bildirim notu
/// yazan kişiye gider; takvim notu kişiye özeldir, ekibin tamamına
/// gönderilmesi doğru olmazdı.
/// </para>
///
/// <para>
/// Dakikada bir bakılır. Geçmişte kalmış hatırlatmalar da gönderilir:
/// uygulama kapalıyken zamanı gelen bir not sessizce kaybolmasın. Ancak
/// çok eskiler atlanır — üç gün önce hatırlatılması gereken bir notun
/// bugün bildirim olarak düşmesi kafa karıştırır.
/// </para>
/// </summary>
public class HatirlatmaGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<HatirlatmaGorevi> _kayit;

    /// <summary>Bu süreden eski hatırlatmalar gönderilmez</summary>
    private const int GecikmeSiniriSaat = 72;

    public HatirlatmaGorevi(
        IServiceProvider saglayici, ILogger<HatirlatmaGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu sürüyor olabilir */
        await Task.Delay(TimeSpan.FromMinutes(2), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Takvim hatırlatmaları işlenemedi");
            }

            await Task.Delay(TimeSpan.FromMinutes(1), jeton);
        }
    }

    private void Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        var sinir = DateTime.Now.AddHours(-GecikmeSiniriSaat);

        var notlar = db.Query(@"
SELECT id, baslik, metin, gun, kullanici
FROM KRY_TAKVIM_NOT
WHERE hatirlatildi = 0
  AND hatirlatma IS NOT NULL
  AND hatirlatma <= SYSDATETIME()
  AND hatirlatma >= @sinir", new { sinir }).ToList();

        if (notlar.Count == 0) return;

        foreach (var n in notlar)
        {
            /* Dapper dinamik satır döndürüyor; kimlik önceden türlenir.
               Dinamik değer genişletme metoduna doğrudan geçirilemiyor. */
            int notId = (int)n.id;

            try
            {
                db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, 'takvim_hatirlatma', @baslik, @metin)",
                    new
                    {
                        kullanici = (string)n.kullanici,
                        baslik = $"Hatırlatma: {n.baslik}",
                        metin = string.IsNullOrWhiteSpace((string)n.metin)
                            ? $"{((DateTime)n.gun):dd.MM.yyyy} tarihli notunuz"
                            : (string)n.metin
                    });

                db.Execute(
                    "UPDATE KRY_TAKVIM_NOT SET hatirlatildi = 1 WHERE id = @id",
                    new { id = notId });
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Hatırlatma gönderilemedi: {Id}", notId);
            }
        }

        /* Süresi çoktan geçmiş olanlar bir daha denenmesin */
        db.Execute(@"
UPDATE KRY_TAKVIM_NOT SET hatirlatildi = 1
WHERE hatirlatildi = 0 AND hatirlatma IS NOT NULL AND hatirlatma < @sinir",
            new { sinir });

        _kayit.LogInformation(
            "Takvim hatırlatması: {Adet} bildirim gönderildi", notlar.Count);
    }
}

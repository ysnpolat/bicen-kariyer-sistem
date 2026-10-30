using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kazan-Kazan arka plan görevi.
///
/// <para>
/// 1) Bildirim: KRY_KK_HAREKET'e yazılan her durum değişikliği (İK paneli,
/// satınalma paneli ya da doğrudan SQL) iki dakika içinde önerenin
/// telefonuna gider. Satınalmanın yapması gereken tek şey hareket satırını
/// yazmak; bildirim_zamani boş bırakılır, görev doldurur. Mobilin kendi
/// yazdığı satırlar (kaynak = 'mobil') bildirilmez. Son 3 günden eski
/// satırlar bildirilmeden işaretlenir (birikmiş bildirim gitmesin).
/// </para>
///
/// <para>
/// 2) Gece ölçümü: her gece 02:00'den sonra ölçüm dönemi biten 'denemede'
/// önerilerin 4. ay sıralaması hesaplanır. İK'daki düğme yerinde durur;
/// ikisi de aynı atomik yazımı kullandığından çift ölçüm olmaz.
/// </para>
/// </summary>
public class KazanKazanGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<KazanKazanGorevi> _kayit;
    private DateTime _sonOlcumGunu = DateTime.MinValue;

    public KazanKazanGorevi(IServiceProvider saglayici, ILogger<KazanKazanGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try { await Bildir(); }
            catch (Exception hata) { _kayit.LogWarning(hata, "Kazan-Kazan bildirimleri gönderilemedi"); }

            if (DateTime.Now.Hour >= 2 && _sonOlcumGunu != DateTime.Today)
            {
                _sonOlcumGunu = DateTime.Today;
                try { GeceOlcumu(); }
                catch (Exception hata) { _kayit.LogWarning(hata, "Kazan-Kazan gece ölçümü yapılamadı"); }
            }

            await Task.Delay(TimeSpan.FromMinutes(2), jeton);
        }
    }

    private async Task Bildir()
    {
        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();

        using var db = vt.Baglanti();

        db.Execute(@"
UPDATE KRY_KK_HAREKET SET bildirim_zamani = SYSDATETIME()
WHERE bildirim_zamani IS NULL AND (kaynak = N'mobil' OR zaman < DATEADD(DAY, -3, SYSDATETIME()))");

        var satirlar = db.Query(@"
SELECT TOP 200 h.id, h.eski_durum AS eski, h.yeni_durum AS yeni, h.aciklama,
       o.personel_kodu AS kod, o.urun_adi AS urun, o.odul, o.karar_notu AS kararNotu, o.siralama
FROM KRY_KK_HAREKET h
INNER JOIN KRY_KK_ONERI o ON o.id = h.oneri_id
WHERE h.bildirim_zamani IS NULL
ORDER BY h.id").ToList();

        if (satirlar.Count == 0) return;

        var liste = new List<(string, string, string)>();
        foreach (var s in satirlar)
        {
            var m = Metin((string)s.eski, (string)s.yeni, (string)s.urun, (string)s.odul, (string)s.kararNotu,
                (int?)s.siralama, (string)s.aciklama);
            if (m is not null) liste.Add(((string)s.kod, m.Value.Baslik, m.Value.Metin));
        }

        var idler = satirlar.Select(x => (int)x.id).ToArray();
        db.Execute("UPDATE KRY_KK_HAREKET SET bildirim_zamani = SYSDATETIME() WHERE id IN @idler", new { idler });

        if (liste.Count > 0) await bildirim.KisiyeOzelGonder(liste, "kazankazan");
    }

    private static (string Baslik, string Metin)? Metin(string eski, string yeni, string urun, string odul,
        string kararNotu, int? sira, string aciklama)
    {
        const string B = "Kazan-Kazan";

        /* Teslim satırı: durum aynı kalır, açıklama "Ödül teslim edildi" ile başlar */
        if (eski == yeni)
            return yeni == "odullendi" && (aciklama ?? "").StartsWith("Ödül teslim edildi", StringComparison.Ordinal)
                ? (B, $"{odul ?? "Ödülün"} teslim edildi. Tebrikler! ({urun})")
                : null;

        return yeni switch
        {
            "onaylandi" => (B, $"Önerin onaylandı: {urun}. Ürün açılıyor, satışa girince haber vereceğiz."),
            "denemede" => (B, $"{urun} satışa girdi! 3 ay deneme başladı."),
            "uygunDegil" => (B, $"{urun} önerin uygun bulunmadı." + (string.IsNullOrWhiteSpace(kararNotu) ? "" : $" Sebep: {kararNotu}")),
            "odullendi" => (B, $"Tebrikler! {urun} 4. ayda {sira}. sırada; {odul} kazandın."),
            "odulYok" => (B, $"{urun} önerinin 4. ay sonucu açıklandı: {sira}. sıra. Bu sefer ödül çıkmadı, yeni önerilerini bekliyoruz."),
            "degerlendiriliyor" when eski is not null => (B, $"{urun} önerin yeniden değerlendirmeye alındı."),
            _ => null,
        };
    }

    private void GeceOlcumu()
    {
        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var kk = kapsam.ServiceProvider.GetRequiredService<KazanKazanServisi>();

        List<int> idler;
        using (var db = vt.Baglanti())
            idler = db.Query<int>(@"
SELECT id FROM KRY_KK_ONERI
WHERE durum = N'denemede' AND olcum_bit IS NOT NULL AND olcum_bit < CAST(GETDATE() AS DATE)").ToList();

        foreach (var id in idler)
        {
            var s = kk.Olc(id, "gece-olcumu", "otomatik");
            if (s.Kod != 200 && s.Kod != 409)
                _kayit.LogWarning("Kazan-Kazan gece ölçümü #{Id}: {Hata}", id, s.Hata);
        }
    }
}

using Dapper;
using BicenKariyer.API.Controllers;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Hukuk masası hatırlatmaları (24.10.2026): duruşma, kesin süre,
/// arabuluculuk ve süre kayıtlarından 7, 3 ve 1 gün önce ve günün sabahı;
/// cevap süreli yazılardan 1 gün önce ve gün sabahı. Dosyanın iç ekibine
/// (ekip kutusu) ve erişimi olan danışmanlara gider; her biri bir kez.
/// </summary>
public class HukukHatirlatmaGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<HukukHatirlatmaGorevi> _kayit;

    public HukukHatirlatmaGorevi(IServiceProvider saglayici, ILogger<HukukHatirlatmaGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(3), jeton);
        while (!jeton.IsCancellationRequested)
        {
            try { await Calis(); }
            catch (Exception h) { _kayit.LogWarning(h, "Hukuk hatırlatması çalışmadı"); }
            await Task.Delay(TimeSpan.FromMinutes(20), jeton);
        }
    }

    private static readonly Dictionary<string, string> Adlar = new()
    {
        ["durusma"] = "Duruşma", ["kesin_sure"] = "Kesin süre", ["arabuluculuk"] = "Arabuluculuk", ["sure"] = "Süre",
    };

    private async Task Calis()
    {
        var simdi = DateTime.Now;
        if (simdi.Hour < 8 || simdi.Hour >= 20) return;

        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();
        using var db = vt.Baglanti();
        if (db.ExecuteScalar<int?>("SELECT CASE WHEN OBJECT_ID('KRY_HUK_OLAY') IS NULL THEN 0 ELSE 1 END") != 1) return;

        var bugun = DateTime.Today;
        var olaylar = db.Query(@"
SELECT o.id, o.dosya_id, o.tur, o.tarih, o.baslik, d.dosya_no, d.davaci_ad, d.esas_no
FROM KRY_HUK_OLAY o JOIN KRY_HUK_DOSYA d ON d.id = o.dosya_id
WHERE o.tamam = 0 AND o.tur <> N'surec' AND d.durum = N'acik' AND o.tarih >= @b AND o.tarih < @e",
            new { b = bugun, e = bugun.AddDays(8) }).ToList();

        foreach (var o in olaylar)
        {
            var gun = ((DateTime)o.tarih).Date;
            var kalan = (gun - bugun).Days;
            if (kalan is not (0 or 1 or 3 or 7)) continue;
            var anahtar = $"o{(int)o.id}-{gun:yyyyMMdd}-{kalan}";
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_HATIRLATMA WHERE anahtar = @anahtar", new { anahtar }) > 0) continue;
            db.Execute("INSERT INTO KRY_HUK_HATIRLATMA (anahtar) VALUES (@anahtar)", new { anahtar });

            var ad = Adlar.GetValueOrDefault((string)o.tur, "Süre");
            var ne = kalan == 0 ? "Bugün" : kalan == 1 ? "Yarın" : $"{kalan} gün sonra";
            var saat = ((DateTime)o.tarih).TimeOfDay.TotalMinutes > 0 ? $" {(DateTime)o.tarih:HH:mm}" : "";
            var baslik = $"{ad} · {ne}{saat}";
            var metin = $"{(string)o.dosya_no} · {(string)o.davaci_ad}{(string.IsNullOrWhiteSpace((string)o.esas_no) ? "" : $" · {(string)o.esas_no}")} · {(string)o.baslik}";

            var kime = db.Query<string>("SELECT anahtar FROM KRY_HUK_ERISIM WHERE dosya_id = @d", new { d = (int)o.dosya_id }).ToList();
            kime.AddRange(db.Query<string>("SELECT anahtar FROM KRY_HUK_EKIP WHERE rol = N'hukuk'"));
            await HukukBildirim.Gonder(db, bildirim, kime.Distinct().ToList(), baslik, metin);
        }

        var yazilar = db.Query(@"
SELECT y.id, y.kayit_no, y.konu, y.cevap_suresi FROM KRY_HUK_YAZI y
WHERE y.cevap_suresi >= @b AND y.cevap_suresi < @e AND NOT EXISTS (SELECT 1 FROM KRY_HUK_YAZI c WHERE c.yanit_id = y.id)",
            new { b = bugun, e = bugun.AddDays(2) }).ToList();
        foreach (var y in yazilar)
        {
            var kalan = (((DateTime)y.cevap_suresi).Date - bugun).Days;
            var anahtar = $"y{(int)y.id}-{kalan}";
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_HATIRLATMA WHERE anahtar = @anahtar", new { anahtar }) > 0) continue;
            db.Execute("INSERT INTO KRY_HUK_HATIRLATMA (anahtar) VALUES (@anahtar)", new { anahtar });
            var kime = db.Query<string>("SELECT anahtar FROM KRY_HUK_YAZI_KUTU WHERE yazi_id = @id AND rol = N'kime'", new { id = (int)y.id }).ToList();
            if (kime.Remove("ekip")) kime.AddRange(db.Query<string>("SELECT anahtar FROM KRY_HUK_EKIP WHERE rol = N'hukuk'"));
            await HukukBildirim.Gonder(db, bildirim, kime.Distinct().ToList(),
                $"Yazı cevabı · {(kalan == 0 ? "bugün" : "yarın")} {(DateTime)y.cevap_suresi:HH:mm}", $"{(string)y.kayit_no} · {(string)y.konu}");
        }
    }
}

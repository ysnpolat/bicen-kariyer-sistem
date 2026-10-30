using System.Collections.Concurrent;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Biçen360 "Biçen Kart" ekranının kısa süreli önbelleği (21.10.2026).
///
/// <para>
/// Toplu bakiye yüklemesinden sonra yüzlerce kişi aynı anda kart ekranını
/// açıyordu; her açılış Posback'te bakiye (dbo.PuanBakiye) ve hareket
/// sorgusu çalıştırıyor, sunucu ve panel yavaşlıyordu. Sonuç kişi başına
/// <see cref="Sure"/> kadar tutulur. Panelden yükleme / transfer / silme
/// yapılan kart <see cref="KartDegisti"/> ile işaretlenir; o karta ait
/// önbellek bir sonraki açılışta tazelenir, böylece yeni bakiye hemen görünür.
/// Kasada harcama buraya bildirilmez; en geç <see cref="Sure"/> sonra görünür.
/// </para>
/// </summary>
public static class GiftKartOnbellek
{
    public static readonly TimeSpan Sure = TimeSpan.FromSeconds(90);

    private sealed record Kayit(DateTime Zaman, object Veri, string KartNo);

    private static readonly ConcurrentDictionary<string, Kayit> Kisiler = new(StringComparer.OrdinalIgnoreCase);
    private static readonly ConcurrentDictionary<string, DateTime> Degisen = new(StringComparer.OrdinalIgnoreCase);

    public static object Oku(string sicil)
    {
        if (string.IsNullOrWhiteSpace(sicil) || !Kisiler.TryGetValue(sicil.Trim(), out var k)) return null;

        var simdi = DateTime.UtcNow;
        if (simdi - k.Zaman > Sure) return null;
        if (k.KartNo is not null && Degisen.TryGetValue(k.KartNo, out var d) && d >= k.Zaman) return null;

        return k.Veri;
    }

    public static void Yaz(string sicil, string kartNo, object veri)
    {
        if (string.IsNullOrWhiteSpace(sicil)) return;

        Kisiler[sicil.Trim()] = new Kayit(DateTime.UtcNow, veri, kartNo?.Trim());

        /* Büyümesin: eski kayıtlar ara ara temizlenir */
        if (Kisiler.Count > 5000)
            foreach (var x in Kisiler.Where(x => DateTime.UtcNow - x.Value.Zaman > Sure).Select(x => x.Key).ToList())
                Kisiler.TryRemove(x, out _);
    }

    public static void KisiDegisti(string sicil)
    {
        if (!string.IsNullOrWhiteSpace(sicil)) Kisiler.TryRemove(sicil.Trim(), out _);
    }

    public static void KartDegisti(IEnumerable<string> kartlar)
    {
        var simdi = DateTime.UtcNow;
        foreach (var k in kartlar ?? Enumerable.Empty<string>())
            if (!string.IsNullOrWhiteSpace(k)) Degisen[k.Trim()] = simdi;

        if (Degisen.Count > 20000)
            foreach (var x in Degisen.Where(x => simdi - x.Value > Sure).Select(x => x.Key).ToList())
                Degisen.TryRemove(x, out _);
    }
}

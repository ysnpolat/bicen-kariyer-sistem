using System.Collections.Concurrent;
using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// IP adresinden ülke tespiti ve ülke bazlı erişim denetimi.
///
/// <para>
/// Başvuruların yalnızca Türkiye'den kabul edilmesi için kullanılır.
/// Ülke bilgisi ip-api.com üzerinden sorulur; sonuçlar bellekte
/// önbelleklenir, aynı adres tekrar sorulmaz.
/// </para>
///
/// <para>
/// <b>Kasıtlı bir tercih:</b> Servise ulaşılamadığında istek engellenmez.
/// Gerçek adayları kesmek, birkaç sahte kaydın geçmesinden daha kötüdür.
/// Bu durumlar güvenlik günlüğüne yazılır.
/// </para>
/// </summary>
public class UlkeServisi
{
    private readonly IHttpClientFactory _istemciUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly GuvenlikGunlugu _gunluk;

    /// <summary>Adres → ülke kodu önbelleği</summary>
    private readonly ConcurrentDictionary<string, (string Kod, DateTime Zaman)> _onbellek
        = new();

    /// <summary>Önbellek ömrü</summary>
    private static readonly TimeSpan OnbellekSuresi = TimeSpan.FromHours(12);

    private DateTime _sonTemizlik = DateTime.UtcNow;

    public UlkeServisi(
        IHttpClientFactory istemciUretici,
        IConfiguration yapilandirma,
        GuvenlikGunlugu gunluk)
    {
        _istemciUretici = istemciUretici;
        _yapilandirma = yapilandirma;
        _gunluk = gunluk;
    }

    /// <summary>Ülke denetimi açık mı?</summary>
    public bool Etkin =>
        _yapilandirma.GetValue("UlkeDenetimi:Acik", false);

    /// <summary>İzin verilen ülke kodları (varsayılan: yalnızca Türkiye)</summary>
    private string[] IzinliUlkeler =>
        _yapilandirma.GetSection("UlkeDenetimi:Ulkeler").Get<string[]>()
        ?? new[] { "TR" };

    /// <summary>
    /// Adresin ülkesini bulur. Bulunamazsa null döner.
    /// Yerel ağ adresleri için "TR" kabul edilir.
    /// </summary>
    public async Task<string> UlkeBulAsync(string adres)
    {
        if (string.IsNullOrWhiteSpace(adres)) return null;

        if (YerelMi(adres)) return "TR";

        Temizle();

        if (_onbellek.TryGetValue(adres, out var kayit) &&
            DateTime.UtcNow - kayit.Zaman < OnbellekSuresi)
        {
            return kayit.Kod;
        }

        try
        {
            var istemci = _istemciUretici.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(4);

            var cevap = await istemci.GetStringAsync(
                $"http://ip-api.com/json/{adres}?fields=status,countryCode");

            using var belge = JsonDocument.Parse(cevap);
            var kok = belge.RootElement;

            if (!kok.TryGetProperty("status", out var durum) ||
                durum.GetString() != "success")
            {
                return null;
            }

            var kod = kok.TryGetProperty("countryCode", out var u)
                ? u.GetString()
                : null;

            if (!string.IsNullOrWhiteSpace(kod))
                _onbellek[adres] = (kod, DateTime.UtcNow);

            return kod;
        }
        catch
        {
            /* Servise ulaşılamadı; istek engellenmez */
            return null;
        }
    }

    /// <summary>
    /// Adresin erişimine izin verilir mi?
    /// Denetim kapalıysa ya da ülke tespit edilemezse izin verilir.
    /// </summary>
    public async Task<bool> IzinliMi(string adres)
    {
        if (!Etkin) return true;

        var kod = await UlkeBulAsync(adres);

        /* Tespit edilemediyse engellenmez */
        if (string.IsNullOrWhiteSpace(kod)) return true;

        var izinli = IzinliUlkeler.Contains(kod, StringComparer.OrdinalIgnoreCase);

        if (!izinli)
            _gunluk.Yaz("YURT DIŞI", adres, $"Ülke: {kod}");

        return izinli;
    }

    /// <summary>Yerel ağ ve geri döngü adresleri</summary>
    private static bool YerelMi(string adres)
    {
        var a = adres.Trim();

        return a is "127.0.0.1" or "::1" or "localhost"
            || a.StartsWith("10.")
            || a.StartsWith("192.168.")
            || a.StartsWith("172.16.")
            || a.StartsWith("172.17.")
            || a.StartsWith("172.18.")
            || a.StartsWith("172.19.");
    }

    private void Temizle()
    {
        if (DateTime.UtcNow - _sonTemizlik < TimeSpan.FromHours(1)) return;

        _sonTemizlik = DateTime.UtcNow;

        foreach (var (adres, kayit) in _onbellek.ToArray())
        {
            if (DateTime.UtcNow - kayit.Zaman > OnbellekSuresi)
                _onbellek.TryRemove(adres, out _);
        }
    }
}

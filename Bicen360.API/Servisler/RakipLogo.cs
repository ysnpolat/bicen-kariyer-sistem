using System.Net;
using System.Net.Sockets;

namespace Bicen360.API.Servisler;

/// <summary>
/// Rakip firma logoları (12.10.2026).
///
/// <para>
/// Portalın Yönetim › Rakip Firmalar bölümünden bağlantı ya da görsel
/// veriliyor. Bağlantı verildiğinde görsel sunucuya indirilip saklanıyor:
/// telefon ve portal logoyu bizim sunucumuzdan alıyor, rakip sitesi
/// görseli taşırsa ya da başka sitelerden gösterimi engellerse logo
/// kaybolmuyor. İndirilemezse (sunucunun internet erişimi yoksa) bağlantı
/// saklanıyor ve logo ucu oraya yönlendiriyor.
/// </para>
///
/// <para>
/// Yalnızca PNG, JPEG, WEBP ve GIF; tür uzantıya değil dosyanın ilk
/// baytlarına bakılarak belirleniyor. SVG kabul edilmiyor (içine betik
/// gömülebiliyor). En fazla 2 MB.
/// </para>
/// </summary>
public static class RakipLogo
{
    public const int EnBuyuk = 2 * 1024 * 1024;

    public static string Klasor(IConfiguration yapilandirma)
    {
        var ayar = yapilandirma["Portal:GorselKlasor"];

        var kok = string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(AppContext.BaseDirectory, "portal-gorsel")
            : ayar.Trim();

        return Path.Combine(kok, "rakip-logo");
    }

    /// <summary>İstemcilerin kullandığı adres; logo yoksa null</summary>
    public static string Adres(int id, int surum, bool var) =>
        var ? $"/api/RakipFiyat/Logo/{id}?v={surum}" : null;

    public static string IcerikTuru(string uzanti) => uzanti switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "image/jpeg",
    };

    /// <summary>Dosyanın ilk baytlarından uzantı; görsel değilse null</summary>
    public static string TurBul(byte[] v)
    {
        if (v is null || v.Length < 12) return null;

        if (v[0] == 0x89 && v[1] == 0x50 && v[2] == 0x4E && v[3] == 0x47) return ".png";
        if (v[0] == 0xFF && v[1] == 0xD8 && v[2] == 0xFF) return ".jpg";
        if (v[0] == (byte)'G' && v[1] == (byte)'I' && v[2] == (byte)'F' && v[3] == (byte)'8') return ".gif";
        if (v[0] == (byte)'R' && v[1] == (byte)'I' && v[2] == (byte)'F' && v[3] == (byte)'F'
            && v[8] == (byte)'W' && v[9] == (byte)'E' && v[10] == (byte)'B' && v[11] == (byte)'P') return ".webp";

        return null;
    }

    /// <summary>Baytları diske yazar; dosya adını döndürür</summary>
    public static async Task<(string Dosya, string Hata)> Yaz(IConfiguration yapilandirma, int firmaId, byte[] veri)
    {
        if (veri is null || veri.Length == 0) return (null, "Görsel boş.");
        if (veri.Length > EnBuyuk) return (null, "Logo en çok 2 MB olabilir.");

        var uzanti = TurBul(veri);
        if (uzanti is null) return (null, "Yalnızca PNG, JPEG, WEBP ya da GIF logo yüklenebilir.");

        var klasor = Klasor(yapilandirma);
        var ad = $"rakip_{firmaId}_{Guid.NewGuid():N}{uzanti}";

        try
        {
            Directory.CreateDirectory(klasor);
            await File.WriteAllBytesAsync(Path.Combine(klasor, ad), veri);
        }
        catch (Exception hata)
        {
            return (null, $"Logo sunucuya yazılamadı ({klasor}): {hata.Message}");
        }

        return (ad, null);
    }

    public static void Sil(IConfiguration yapilandirma, string dosya)
    {
        if (!GuvenliAd(dosya)) return;

        try
        {
            var yol = Path.Combine(Klasor(yapilandirma), dosya);
            if (File.Exists(yol)) File.Delete(yol);
        }
        catch
        {
            /* eski dosya kalırsa zararı yok */
        }
    }

    public static bool GuvenliAd(string dosya) =>
        !string.IsNullOrWhiteSpace(dosya) && !dosya.Contains('/') && !dosya.Contains('\\') && !dosya.Contains("..");

    /// <summary>Bağlantı yalnızca http(s) olabilir</summary>
    public static bool AdresGecerli(string adres, out Uri uri) =>
        Uri.TryCreate((adres ?? "").Trim(), UriKind.Absolute, out uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);

    /// <summary>
    /// Bağlantıdaki görseli indirir. İç ağ adreslerine gidilmiyor (sunucunun
    /// kendi ağındaki makinelere istek atılmasın); 10 saniye, en çok 2 MB.
    /// </summary>
    public static async Task<(byte[] Veri, string Hata)> Indir(IHttpClientFactory kaynak, string adres)
    {
        if (!AdresGecerli(adres, out var uri)) return (null, "Bağlantı http:// ya da https:// ile başlamalı.");

        try
        {
            var ipler = await Dns.GetHostAddressesAsync(uri.DnsSafeHost);
            if (ipler.Length == 0 || ipler.Any(IcAg))
                return (null, "Bu adresten indirilemez (iç ağ adresi).");
        }
        catch
        {
            return (null, "Adres çözümlenemedi.");
        }

        try
        {
            using var istemci = kaynak.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(10);
            istemci.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Bicen360 logo)");

            using var yanit = await istemci.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
            if (!yanit.IsSuccessStatusCode) return (null, $"Görsel indirilemedi ({(int)yanit.StatusCode}).");

            if (yanit.Content.Headers.ContentLength > EnBuyuk) return (null, "Görsel 2 MB'tan büyük.");

            await using var akis = await yanit.Content.ReadAsStreamAsync();
            using var bellek = new MemoryStream();
            var tampon = new byte[81920];
            int n;
            while ((n = await akis.ReadAsync(tampon)) > 0)
            {
                bellek.Write(tampon, 0, n);
                if (bellek.Length > EnBuyuk) return (null, "Görsel 2 MB'tan büyük.");
            }

            var veri = bellek.ToArray();
            if (TurBul(veri) is null)
                return (null, "Bağlantı bir PNG/JPEG/WEBP/GIF görseline gitmiyor (SVG desteklenmiyor).");

            return (veri, null);
        }
        catch (Exception hata)
        {
            return (null, $"Görsel indirilemedi: {hata.Message}");
        }
    }

    private static bool IcAg(IPAddress ip)
    {
        if (IPAddress.IsLoopback(ip)) return true;

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv4MappedToIPv6) return IcAg(ip.MapToIPv4());
            return ip.IsIPv6LinkLocal || ip.IsIPv6SiteLocal || ip.IsIPv6UniqueLocal || ip.Equals(IPAddress.IPv6Any);
        }

        var b = ip.GetAddressBytes();
        return b[0] == 10
               || b[0] == 127
               || b[0] == 0
               || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
               || (b[0] == 192 && b[1] == 168)
               || (b[0] == 169 && b[1] == 254)
               || (b[0] == 100 && b[1] >= 64 && b[1] <= 127);
    }
}

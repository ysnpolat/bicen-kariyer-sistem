namespace BicenKariyer.API.Servisler;

/// <summary>
/// İsteğin geldiği gerçek adresi bulur.
///
/// <para>
/// <b>Neden bu sınıf var:</b> X-Forwarded-For başlığını isteği yapan kişi
/// kendisi yazabilir. Bu başlığa doğrudan güvenildiğinde saldırgan her
/// istekte farklı bir adres uydurarak hız sınırını tamamen atlar; nitekim
/// böyle bir olay yaşandı.
/// </para>
///
/// <para>
/// Bu yüzden başlık yalnızca isteğin <b>gerçekten</b> bilinen bir vekil
/// sunucudan (IIS/nginx, localhost) geldiği durumda dikkate alınır. Aksi
/// hâlde TCP bağlantısının kendi adresi kullanılır; o adres taklit edilemez.
/// </para>
/// </summary>
public static class IstemciAdresi
{
    /// <summary>
    /// Vekil sunucu olarak kabul edilen adresler.
    /// Uygulama IIS arkasında çalıştığı için istekler localhost'tan gelir.
    /// </summary>
    private static readonly string[] GuvenilirVekiller =
    {
        "127.0.0.1",
        "::1",
        "localhost"
    };

    /// <summary>İsteğin geldiği adresi döndürür.</summary>
    public static string Bul(HttpContext baglam)
    {
        var baglanti = baglam.Connection.RemoteIpAddress?.ToString() ?? "";

        /* Bağlantı güvenilir bir vekilden gelmiyorsa başlığa bakılmaz */
        if (!GuvenilirVekilMi(baglanti)) return Sadelestir(baglanti);

        var iletilen = baglam.Request.Headers["X-Forwarded-For"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(iletilen)) return Sadelestir(baglanti);

        /* Zincirin ilk adresi asıl istemcidir */
        var ilk = iletilen.Split(',')[0].Trim();

        return string.IsNullOrWhiteSpace(ilk) ? Sadelestir(baglanti) : Sadelestir(ilk);
    }

    private static bool GuvenilirVekilMi(string adres)
    {
        if (string.IsNullOrWhiteSpace(adres)) return false;

        var temiz = Sadelestir(adres);

        return GuvenilirVekiller.Contains(temiz, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// IPv6 sarmalı ve port bilgisini temizler.
    /// "::ffff:192.168.1.5" → "192.168.1.5"
    /// </summary>
    private static string Sadelestir(string adres)
    {
        if (string.IsNullOrWhiteSpace(adres)) return "";

        var temiz = adres.Trim();

        if (temiz.StartsWith("::ffff:", StringComparison.OrdinalIgnoreCase))
            temiz = temiz[7..];

        /* '1.2.3.4:56789' biçimindeki port ekini at */
        var iki = temiz.LastIndexOf(':');

        if (iki > 0 && temiz.Count(x => x == ':') == 1 && temiz.Contains('.'))
            temiz = temiz[..iki];

        return temiz;
    }
}

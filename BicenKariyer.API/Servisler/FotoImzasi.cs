using System.Security.Cryptography;
using System.Text;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Biçen360 patron görünümü fotoğraf bağlantılarının imzası (04.10.2026).
///
/// <para>
/// Fotoğraflar önceden yalnızca oturum jetonuyla açılıyordu: uygulama
/// jetonu hem başlıkta hem <c>?t=</c> sorgusunda gönderiyordu. Mağaza
/// derlemesinde (1.5) görüntüleyici bu jetonu her durumda iletmeyince
/// fotoğraflar boş kaldı. Artık sunucu, fotoğraf adresini yalnızca yetkili
/// patrona verdiği yanıtın içinde imzalı üretiyor; adres kısa süre
/// (bugün ve önceki <see cref="GecerliGun"/> gün) jetonsuz da açılıyor.
/// Jetonla açma da çalışmaya devam ediyor.
/// </para>
///
/// <para>
/// Anahtar JWT anahtarından türetiliyor (ayrı bir ayar gerekmesin); imza
/// fotoğraf türü, kimlik ve günü kapsıyor, başka bir kişinin fotoğrafına
/// çevrilemiyor.
/// </para>
/// </summary>
public static class FotoImzasi
{
    /// <summary>İmzalı adresin geçerli kaldığı gün (bugün dahil değil)</summary>
    public const int GecerliGun = 2;

    private static byte[] _anahtar = Array.Empty<byte>();

    /// <summary>Program.cs açılışta JWT anahtarıyla çağırıyor.</summary>
    public static void Ayarla(string jwtAnahtari)
    {
        if (string.IsNullOrEmpty(jwtAnahtari)) return;

        _anahtar = HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(jwtAnahtari),
            Encoding.UTF8.GetBytes("bicen360-patron-foto"));
    }

    public static bool Hazir => _anahtar.Length > 0;

    private static string Hesapla(string tur, string kimlik, string gun) =>
        Convert.ToHexString(HMACSHA256.HashData(_anahtar,
                Encoding.UTF8.GetBytes($"{tur}|{kimlik}|{gun}")))[..32]
            .ToLowerInvariant();

    /// <summary>
    /// Adrese eklenecek sorgu parçası ("g=20261004&amp;s=…"); anahtar yoksa boş.
    /// </summary>
    public static string Sorgu(string tur, string kimlik)
    {
        if (!Hazir || string.IsNullOrWhiteSpace(kimlik)) return "";

        var gun = DateTime.Today.ToString("yyyyMMdd");
        return $"g={gun}&s={Hesapla(tur, kimlik.Trim(), gun)}";
    }

    /// <summary>İmza bu kimlik için doğru ve süresi geçmemiş mi</summary>
    public static bool Gecerli(string tur, string kimlik, string gun, string imza)
    {
        if (!Hazir || string.IsNullOrWhiteSpace(kimlik) ||
            string.IsNullOrWhiteSpace(gun) || string.IsNullOrWhiteSpace(imza))
            return false;

        if (!DateTime.TryParseExact(gun, "yyyyMMdd",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out var tarih))
            return false;

        if (tarih > DateTime.Today || tarih < DateTime.Today.AddDays(-GecerliGun))
            return false;

        var beklenen = Encoding.ASCII.GetBytes(Hesapla(tur, kimlik.Trim(), gun));
        var gelen = Encoding.ASCII.GetBytes(imza.Trim().ToLowerInvariant());

        return CryptographicOperations.FixedTimeEquals(beklenen, gelen);
    }
}

using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Bicen360.API.Servisler;

/* ==========================================================================
 * Parola
 * ========================================================================== */

/// <summary>
/// Parola doğrulama.
///
/// <para>
/// BicenKariyer.API'deki ParolaServisi ile aynı algoritma: PBKDF2, SHA256,
/// 100.000 tur. Aynı <c>KRY_KULLANICILAR</c> tablosunu okuduğumuz için
/// birebir aynı olmak zorunda; tur sayısı ya da algoritma ayrışırsa mevcut
/// parolaların hiçbiri doğrulanmaz.
/// </para>
///
/// <para>
/// Parola üretimi burada yok: yeni kullanıcı ve parola değişikliği Kariyer
/// panelinden yapılıyor, iki yerde birden yazmak kaçınılmaz olarak
/// ayrışıyor.
/// </para>
/// </summary>
public static class ParolaServisi
{
    /// <summary>
    /// Yeni parola için özet ve tuz. Kariyer servisindekiyle birebir aynı
    /// algoritma: portaldan açılan kullanıcı İK paneline de aynı parolayla
    /// girebilmeli.
    /// </summary>
    public static (string hash, string salt) Uret(string parola)
    {
        var tuz = RandomNumberGenerator.GetBytes(16);

        var hesap = Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(parola), tuz, 100_000, HashAlgorithmName.SHA256, 32);

        return (Convert.ToBase64String(hesap), Convert.ToBase64String(tuz));
    }

    /// <summary>Parola yeterince güçlü mü; sorun varsa açıklaması, yoksa null.</summary>
    public static string GucKontrolu(string parola)
    {
        if (string.IsNullOrWhiteSpace(parola) || parola.Length < 8)
            return "Parola en az 8 karakter olmalıdır.";

        if (!parola.Any(char.IsLetter) || !parola.Any(char.IsDigit))
            return "Parola hem harf hem rakam içermelidir.";

        string[] zayif =
        {
            "123456", "password", "parola", "sifre", "qwerty", "111111",
            "123123", "admin", "bicen", "12345678", "abc123"
        };

        var kucuk = parola.ToLowerInvariant();

        if (zayif.Any(z => kucuk.Contains(z)))
            return "Bu parola kolay tahmin edilebilir. Farklı bir parola seçiniz.";

        if (parola.Distinct().Count() < 4)
            return "Parola en az dört farklı karakter içermelidir.";

        return null;
    }

    public static bool Dogrula(string parola, string hash, string salt)
    {
        try
        {
            var tuz = Convert.FromBase64String(salt);

            var hesap = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(parola), tuz, 100_000, HashAlgorithmName.SHA256, 32);

            return CryptographicOperations.FixedTimeEquals(
                hesap, Convert.FromBase64String(hash));
        }
        catch
        {
            return false;
        }
    }
}

/* ==========================================================================
 * Jeton
 * ========================================================================== */

/// <summary>
/// Oturum belirteci üretimi.
///
/// <para>
/// Hak (claim) adları ve imza anahtarı BicenKariyer.API ile aynı. Mobil
/// uygulama tek olduğu için tek jetonla iki API'ye de gidiyor: Kariyer
/// API'nin ürettiği personel jetonu burada da geçerli, buradan üretilen
/// panel jetonu orada da geçerli.
/// </para>
///
/// <para>
/// Anahtar değişirse iki appsettings.json birlikte güncellenmeli. Yalnızca
/// birini değiştirmek, mobil tarafta yarısı çalışan bir oturuma yol açar ve
/// hata mesajı bunu söylemez.
/// </para>
/// </summary>
public class JwtServisi
{
    private readonly IConfiguration _yapilandirma;

    public JwtServisi(IConfiguration yapilandirma) => _yapilandirma = yapilandirma;

    public (string jeton, DateTime bitis) Uret(Kullanici kullanici)
    {
        var anahtar = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_yapilandirma["Jwt:Anahtar"]));

        var saat = int.TryParse(_yapilandirma["Jwt:GecerlilikSaat"], out var s) ? s : 12;
        var bitis = DateTime.UtcNow.AddHours(saat);

        var haklar = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, kullanici.Id.ToString()),
            new(ClaimTypes.Name, kullanici.KullaniciAdi),
            new(ClaimTypes.Role, kullanici.Rol),
            new("adSoyad", kullanici.AdSoyad ?? ""),
            new("subeler", kullanici.Subeler ?? "")
        };

        var jeton = new JwtSecurityToken(
            issuer: _yapilandirma["Jwt:Yayinci"],
            audience: _yapilandirma["Jwt:Yayinci"],
            claims: haklar,
            expires: bitis,
            signingCredentials: new SigningCredentials(anahtar, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(jeton), bitis);
    }
}

/* ==========================================================================
 * Giriş sınırlayıcı
 * ========================================================================== */

/// <summary>
/// Aynı adresten peş peşe hatalı girişleri yavaşlatır.
///
/// Kariyer panelindeki desenle aynı; parola denemesini sınırsız bırakmak
/// zayıf bir parolayı er geç bulunur hâle getiriyor.
/// </summary>
public static class GirisSinirlayici
{
    private const int Esik = 5;
    private static readonly TimeSpan Kilit = TimeSpan.FromMinutes(10);

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<
        string, (int sayi, DateTime son)> _kayitlar = new();

    /// <summary>Kilitliyse kalan süre, değilse null.</summary>
    public static TimeSpan? KilitliMi(string ip)
    {
        if (!_kayitlar.TryGetValue(ip ?? "", out var k)) return null;

        if (k.sayi < Esik) return null;

        var gecen = DateTime.UtcNow - k.son;

        if (gecen >= Kilit)
        {
            _kayitlar.TryRemove(ip, out _);
            return null;
        }

        return Kilit - gecen;
    }

    public static void HataliDeneme(string ip) =>
        _kayitlar.AddOrUpdate(ip ?? "",
            _ => (1, DateTime.UtcNow),
            (_, k) => (k.sayi + 1, DateTime.UtcNow));

    public static void BasariliGiris(string ip) => _kayitlar.TryRemove(ip ?? "", out _);
}

using System.Data;
using System.Text.RegularExpressions;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mobil cihaz kimliği yardımcıları (26.10.2026).
///
/// <para>
/// Biçen360 1.9 ve öncesi cihaz kimliğini telefonda rastgele üretiyordu
/// ("k3x9ab2c-…" biçimi); Android'de uygulama silinince kimlik de
/// siliniyor, yeniden kurulumda personel aynı telefondayken "başka
/// cihaza tanımlı" hatası alıyordu. 1.10 kalıcı kimlik kullanır:
/// Android'de "and-" + ANDROID_ID (16 onaltılık), iOS'ta Keychain'de
/// saklanan UUID (eski iOS kimlikleri Keychain'de kaldığı için aynen
/// sürer; yeni kurulumlar "ios-" önekiyle gelir).
/// </para>
///
/// <para>
/// MAC adresi ve seri numarası kullanılamıyor: iOS uygulamalara hiç
/// vermez, Android 10 ve sonrası da vermez (MAC ayrıca rastgeleleştirilir).
/// </para>
/// </summary>
public static class CihazKimligi
{
    /// <summary>Eski kimlik kanıtıyla ya da açık oturumla yapılan taşıma</summary>
    public const string TasimaSebebi = "Kalıcı kimliğe geçiş";

    /// <summary>Eski kimliği olmayan yeniden kurulum (model + işletim eşleşti)</summary>
    public const string KurulumSebebi = "Yeniden kurulum (kalıcı kimlik)";

    /// <summary>Geçmiş sayımında taşıma kayıtları cihaz değişimi sayılmaz (SQL liste)</summary>
    public const string SayimDisi = "N'" + TasimaSebebi + "', N'" + KurulumSebebi + "'";

    /// <summary>
    /// Taşımadan sonra eski jetonun kabul edildiği süre (dakika).
    ///
    /// Uygulama açılışta taşımayı diğer isteklerle aynı anda gönderiyor;
    /// yeni jeton telefona ulaşmadan eski jetonla yola çıkmış istekler
    /// 401 alıp oturumu kapatmasın diye eski kimlik kısa süre geçerli
    /// sayılır. Eski jetonun sahibi zaten aynı cihazdır.
    /// </summary>
    private const int GecisDakika = 5;

    private static readonly Regex Eski = new("^[0-9a-z]{6,12}-[0-9a-z]{10,20}$", RegexOptions.Compiled);
    private static readonly Regex Android = new("^and-[0-9a-f]{16}$", RegexOptions.Compiled);

    /// <summary>Telefonda rastgele üretilmiş eski biçim mi</summary>
    public static bool EskiBicim(string id) => id is not null && Eski.IsMatch(id);

    /// <summary>Kalıcı Android kimliği biçimi mi</summary>
    public static bool KaliciAndroid(string id) => id is not null && Android.IsMatch(id);

    /// <summary>Günlük için kısaltılmış kimlik; tam kimlik yazılmaz</summary>
    public static string Ozet(string id) =>
        string.IsNullOrEmpty(id) ? "-" : id.Length <= 8 ? id : id[..8] + "…";

    /// <summary>
    /// Jetondaki cihaz kayıtlı cihazla uyuşuyor mu.
    ///
    /// Birebir eşleşme ya da son birkaç dakika içinde tam bu eski kimlikten
    /// kayıtlı kimliğe yapılmış bir taşıma varsa uyuşur. Taşıma dışındaki
    /// değişimlerde (başka telefondan giriş, panelden kaldırma) eski jeton
    /// eskisi gibi hemen düşer.
    /// </summary>
    public static bool Uyusuyor(IDbConnection db, string kod, string kayitliCihaz, string jetonCihaz)
    {
        if (string.Equals(kayitliCihaz, jetonCihaz, StringComparison.Ordinal)) return true;

        if (string.IsNullOrWhiteSpace(jetonCihaz) || string.IsNullOrWhiteSpace(kayitliCihaz)) return false;

        try
        {
            return db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_CIHAZ_GECMIS
WHERE personel_kodu = @kod AND sebep = @sebep
  AND eski_cihaz = @eski AND yeni_cihaz = @yeni
  AND tarih > DATEADD(minute, -@dk, SYSDATETIME())",
                new { kod, sebep = TasimaSebebi, eski = jetonCihaz, yeni = kayitliCihaz, dk = GecisDakika }) > 0;
        }
        catch
        {
            /* Geçmiş okunamazsa yalnızca birebir eşleşme geçerli */
            return false;
        }
    }
}

using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Talep eksik bildirimi ortak yardımcıları (07.10.2026).
///
/// <para>
/// Kayıt <c>KRY_TALEP_EKSIK</c>: İK talepteki eksiği bildirir (durum
/// <c>acik</c>), personel tamamlayınca ya da evrakı uygulamadan yükleyince
/// <c>tamamlandi</c>, İK kontrol edip kapatınca <c>kapandi</c>. Bkz.
/// <c>TalepEksikController</c>.
/// </para>
/// </summary>
public static class TalepEksik
{
    public const string Izin = "izin";
    public const string Avans = "avans";
    public const string FazlaMesai = "fazlamesai";
    public const string Itiraz = "itiraz";

    public static readonly string[] Turler = { Izin, Avans, FazlaMesai, Itiraz };

    public const string Acik = "acik";
    public const string Tamamlandi = "tamamlandi";
    public const string Kapandi = "kapandi";

    /// <summary>Bildirimin ve kartın başlığı</summary>
    public static string Baslik(string tur) => tur switch
    {
        Avans => "Avans talebinizde eksik var",
        FazlaMesai => "Fazla mesai kaydında eksik var",
        Itiraz => "Vardiya düzeltme talebinizde eksik var",
        _ => "İzin talebinizde eksik var",
    };

    /// <summary>Talep türünün okunur adı (panel ve geçmiş için)</summary>
    public static string TurAdi(string tur) => tur switch
    {
        Avans => "Avans",
        FazlaMesai => "Fazla mesai",
        Itiraz => "Vardiya düzeltme",
        _ => "İzin",
    };

    /// <summary>Maddeler satır satır saklanıyor (STRING_SPLIT yok: uyumluluk düzeyi düşük)</summary>
    public static List<string> Maddeler(string ham) =>
        (ham ?? "")
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

    /// <summary>
    /// Personel eksiği tamamladı (uygulamadan "tamamladım" ya da izin
    /// evrakını yükledi). Açık kayıt yoksa bir şey yapmaz; etkilenen satır
    /// sayısı döner. İK yine kontrol edip kapatıyor.
    /// </summary>
    public static int PersonelTamamladi(IDbConnection db, string tur, int talepId, string not)
    {
        try
        {
            not = string.IsNullOrWhiteSpace(not) ? null : not.Trim();
            if (not is { Length: > 500 }) not = not[..500];

            return db.Execute(@"
UPDATE KRY_TALEP_EKSIK
SET durum = N'tamamlandi', tamamlandi = SYSDATETIME(),
    goruldu = COALESCE(goruldu, SYSDATETIME()),
    personel_notu = CASE WHEN @not IS NULL THEN personel_notu
                         WHEN personel_notu IS NULL THEN @not
                         ELSE LEFT(personel_notu + N' · ' + @not, 500) END
WHERE tur = @tur AND talep_id = @talepId AND durum = N'acik'
  /* Sistemin açtığı yükleme kartları (yönetici formu) kendi akışında kapanır */
  AND ISNULL(gonderen, N'') NOT IN (N'sistem:fmform', N'sistem:izinform')", new { tur, talepId, not });
        }
        catch
        {
            /* Tablo henüz kurulmamış olabilir: asıl işi durdurmaz */
            return 0;
        }
    }
}

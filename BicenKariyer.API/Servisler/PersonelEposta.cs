using System.Data;
using System.Text.RegularExpressions;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Personelin kendi e-postası (13.10.2026).
///
/// <para>
/// Genel merkez ve depodaki bilgisayarlı personelin (satın alma, muhasebe
/// vb.) izin ve fazla mesai formu İK'ya değil kendi adresine gider; kişi
/// çıktıyı imzalatıp uygulamadan yükler. Adresi girilmeyen personelin
/// (temizlik görevlisi gibi) formu eskisi gibi İK'ya düşer. Şube
/// personelinde adres girilse de kullanılmaz; şubeler standart akışta.
/// </para>
///
/// <para>
/// Mikro'da personele ait e-posta alanı yok; adresler panelden
/// (Yönetim → İzin formu e-postaları) girilir, KRY_PERSONEL_EPOSTA'da durur.
/// Sicil baştaki sıfırlar atılarak saklanır: Mikro sicili "0145" ve
/// "145" olarak iki biçimde dönebiliyor.
/// </para>
/// </summary>
public static class PersonelEposta
{
    private static readonly Regex Desen = new(@"^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]{2,}$", RegexOptions.Compiled);

    public static string Anahtar(string kod) => (kod ?? "").Trim().TrimStart('0');

    public static bool Gecerli(string eposta) => !string.IsNullOrWhiteSpace(eposta) && Desen.IsMatch(eposta.Trim());

    public static string Oku(IDbConnection db, string kod)
    {
        var k = Anahtar(kod);
        if (k.Length == 0) return null;

        return db.ExecuteScalar<string>(
            "SELECT eposta FROM KRY_PERSONEL_EPOSTA WHERE personel_kodu = @k", new { k });
    }

    public static Dictionary<string, string> Tumu(IDbConnection db) =>
        db.Query<(string Kod, string Eposta)>("SELECT personel_kodu, eposta FROM KRY_PERSONEL_EPOSTA")
            .GroupBy(x => Anahtar(x.Kod))
            .ToDictionary(g => g.Key, g => g.First().Eposta, StringComparer.OrdinalIgnoreCase);

    /// <summary>Adresi yazar; boşsa kaydı siler (form yeniden İK'ya gider).</summary>
    public static void Yaz(IDbConnection db, string kod, string eposta, string kullanici)
    {
        var k = Anahtar(kod);
        if (k.Length == 0) return;

        if (string.IsNullOrWhiteSpace(eposta))
        {
            db.Execute("DELETE FROM KRY_PERSONEL_EPOSTA WHERE personel_kodu = @k", new { k });
            return;
        }

        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_PERSONEL_EPOSTA WHERE personel_kodu = @k)
    UPDATE KRY_PERSONEL_EPOSTA SET eposta = @e, guncelleyen = @u, guncelleme = SYSDATETIME() WHERE personel_kodu = @k
ELSE
    INSERT INTO KRY_PERSONEL_EPOSTA (personel_kodu, eposta, guncelleyen) VALUES (@k, @e, @u)",
            new { k, e = eposta.Trim().ToLowerInvariant(), u = kullanici is { Length: > 100 } ? kullanici[..100] : kullanici });
    }
}

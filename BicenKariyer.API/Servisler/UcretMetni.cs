using System.Globalization;
using System.Text.RegularExpressions;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Başvuru formundaki serbest metin ücret alanını sayıya çevirir.
///
/// Örnekler: "45.000 ₺" → 45000, "45,000" → 45000, "45.000,50" → 45000,50,
/// "45000" → 45000, "35" ya da "35 bin" → 35000, "40-45 bin" → 42500 (aralığın ortası).
/// Çözülemeyen değer null döner; hata fırlatmaz.
/// </summary>
public static class UcretMetni
{
    private static readonly Regex Sayi = new(@"\d[\d.,\s]*", RegexOptions.Compiled);

    public static decimal? Coz(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return null;

        var kucuk = metin.ToLower(new CultureInfo("tr-TR"));

        var sayilar = Sayi.Matches(kucuk)
            .Select(m => Tek(m.Value))
            .Where(x => x is > 0)
            .Select(x => x!.Value)
            .ToList();

        if (sayilar.Count == 0) return null;

        /* Aralık yazılmışsa ortası */
        var deger = sayilar.Count >= 2 ? (sayilar[0] + sayilar[1]) / 2 : sayilar[0];

        /* "35" ya da "35 bin": bin cinsinden yazılmış (panel de aynı kuralı
           uyguluyor; gerçek bir aylık ücret 1.000 TL'nin altında olmaz) */
        if (deger < 1000) deger *= 1000;

        /* Makul olmayan değerler (ör. telefon numarası) dışarıda */
        if (deger < 1000 || deger > 10_000_000) return null;

        return Math.Round(deger, 2);
    }

    /// <summary>Tek bir sayı parçasını Türkçe ya da İngilizce biçimde okur.</summary>
    private static decimal? Tek(string parca)
    {
        var s = parca.Replace(" ", "").Trim('.', ',');
        if (s.Length == 0) return null;

        var nokta = s.LastIndexOf('.');
        var virgul = s.LastIndexOf(',');

        if (nokta >= 0 && virgul >= 0)
        {
            /* İkisi birden: sondaki ondalık ayırıcı */
            if (virgul > nokta) s = s.Replace(".", "").Replace(',', '.');
            else s = s.Replace(",", "");
        }
        else if (nokta >= 0 || virgul >= 0)
        {
            var ayirici = nokta >= 0 ? '.' : ',';
            var parcalar = s.Split(ayirici);

            /* 45.000 / 45,000 / 1.250.000 → binlik; 45,5 / 45.50 → ondalık */
            var binlik = parcalar.Length > 2 || parcalar[^1].Length == 3;
            s = binlik ? s.Replace(ayirici.ToString(), "") : s.Replace(ayirici, '.');
        }

        return decimal.TryParse(s, NumberStyles.Number, CultureInfo.InvariantCulture, out var d) ? d : null;
    }
}

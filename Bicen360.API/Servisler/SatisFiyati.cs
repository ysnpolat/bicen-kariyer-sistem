using System.Globalization;

namespace Bicen360.API.Servisler;

/// <summary>
/// Geçerli satış fiyatı kuralı (09.10.2026).
///
/// <para>
/// Mağazada müşteriye uygulanan fiyat BiCard fiyatı (Mikro satış fiyat
/// listesi 2). BiCard fiyatı tanımlı değilse ya da 0 veya altındaysa raf
/// fiyatı (liste 1) geçerli. Fiyat Kontrol ekranı, rakip fiyat girişi ve
/// rakip raporları bu kuralı kullanıyor; raporlar raf fiyatıyla da
/// karşılaştırıyor ("rafla satsaydık").
/// </para>
/// </summary>
public static class SatisFiyati
{
    public const int RafListesi = 1;
    public const int BicardListesi = 2;

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    /// <summary>
    /// Mikro'dan okunan fiyatı ondalığa çevirir. sfiyat_fiyati Mikro'da float
    /// (double) tutuluyor; dinamik satırdan doğrudan decimal'e atamak
    /// "Cannot implicitly convert type 'double' to 'decimal?'" ile düşüyordu.
    /// </summary>
    public static decimal? Sayi(object d) =>
        d is null or DBNull ? null : Math.Round(Convert.ToDecimal(d), 4);

    /// <summary>BiCard fiyatı 0'dan büyükse o, değilse raf fiyatı.</summary>
    public static decimal? Etkin(decimal? raf, decimal? bicard) =>
        bicard is > 0 ? bicard : raf;

    /// <summary>"bicard", "raf" ya da fiyat yoksa null.</summary>
    public static string Tur(decimal? raf, decimal? bicard) =>
        bicard is > 0 ? "bicard" : raf is null ? null : "raf";

    /// <summary>Ekranda gösterilecek ad.</summary>
    public static string TurAdi(string tur) => tur switch
    {
        "bicard" => "BiCard fiyatı",
        "raf" => "Raf fiyatı",
        _ => "Fiyat yok"
    };

    /// <summary>12,50 ₺ biçimi.</summary>
    public static string Yaz(decimal? d) =>
        d is null ? "—" : d.Value.ToString("N2", Tr) + " ₺";

    /// <summary>
    /// Bir listedeki fiyatı veren alt sorgu (Mikro); Fiyat Kontrol ekranıyla
    /// birebir aynı kural: o deponun (şubenin) kendi fiyatı varsa o, yoksa
    /// depo ayrımı olmayan (0) genel fiyat. Depo bilinmiyorsa yalnızca genel
    /// fiyat. İptal edilmiş satırlar alınmıyor.
    /// </summary>
    /// <param name="depo">Depo numarası; sayı olarak metne gömülüyor.</param>
    public static string AltSorgu(string stokAlani, int liste, int? depo = null) => depo is int d
        ? $@"(
    SELECT TOP 1 F.sfiyat_fiyati
    FROM STOK_SATIS_FIYAT_LISTELERI F WITH (NOLOCK)
    WHERE F.sfiyat_stokkod = {stokAlani} AND F.sfiyat_listesirano = {liste}
      AND F.sfiyat_iptal = 0
      AND (F.sfiyat_deposirano = {d} OR F.sfiyat_deposirano = 0)
    ORDER BY CASE WHEN F.sfiyat_deposirano = {d} THEN 0 ELSE 1 END)"
        : $@"(
    SELECT TOP 1 F.sfiyat_fiyati
    FROM STOK_SATIS_FIYAT_LISTELERI F WITH (NOLOCK)
    WHERE F.sfiyat_stokkod = {stokAlani} AND F.sfiyat_listesirano = {liste}
      AND F.sfiyat_iptal = 0 AND F.sfiyat_deposirano = 0)";

    /// <summary>
    /// Şube adı ya da kodundan depo numarası (B360_SUBE_DEPO). Önce birebir
    /// (Türkçe harf ve boşluk farkı gözetmeden), olmazsa adı içeren tek şube.
    /// Bulunamazsa null: genel fiyat kullanılır.
    /// </summary>
    public static Func<string, int?> DepoBulucu(System.Data.IDbConnection db)
    {
        var subeler = Dapper.SqlMapper.Query(db, @"
SELECT sube_kodu AS kod, sube_adi AS ad, depo_no AS depo
FROM B360_SUBE_DEPO WHERE depo_no IS NOT NULL").ToList();

        var liste = subeler
            .Select(x => (Kod: YetkiServisi.Anahtar((string)x.kod), Ad: YetkiServisi.Anahtar((string)x.ad), Depo: (int?)x.depo))
            .ToList();

        var onbellek = new Dictionary<string, int?>();

        return sube =>
        {
            var a = YetkiServisi.Anahtar(sube);
            if (a.Length < 3) return null;
            if (onbellek.TryGetValue(a, out var v)) return v;

            var tam = liste.FirstOrDefault(x => x.Kod == a || x.Ad == a);
            int? depo = tam.Depo;

            if (depo is null)
            {
                var icerik = liste.Where(x =>
                    (x.Kod.Length >= 4 && (a.Contains(x.Kod) || x.Kod.Contains(a))) ||
                    (x.Ad.Length >= 4 && (a.Contains(x.Ad) || x.Ad.Contains(a)))).ToList();

                if (icerik.Count == 1) depo = icerik[0].Depo;
            }

            onbellek[a] = depo;
            return depo;
        };
    }
}

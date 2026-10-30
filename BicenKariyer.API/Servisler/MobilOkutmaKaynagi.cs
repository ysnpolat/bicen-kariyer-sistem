using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Biçen360 uygulamasından yapılan karekod okutmaları.
///
/// <para>
/// Okutma raporları eskiden yalnızca kart geçiş sisteminden (iCard) okunuyordu.
/// Uygulamadaki okutmalar KRY_VARDIYA tablosunda; raporlar iki kaynağı
/// birlikte görüyor ve her okutmanın nereden geldiği ekranda belli oluyor.
/// </para>
///
/// <para>
/// KRY_VARDIYA'da kaynak = 'kart' olan satırlar iCard'dan aktarılmış
/// kopyalardır; raporlar iCard'ı zaten doğrudan okuduğu için bu satırlar
/// burada alınmıyor, aksi hâlde aynı okutma iki kez sayılırdı.
/// </para>
/// </summary>
public static class MobilOkutmaKaynagi
{
    public const string ICard = "iCard";
    public const string Bicen360 = "Biçen360";
    public const string Manuel = "Manuel";

    public sealed record Okutma(string PersonelKodu, DateTime Zaman, string Tur, string SubeAdi, string Kaynak);

    private sealed class Satir
    {
        public string PersonelKodu { get; set; }
        public DateTime Zaman { get; set; }
        public string Tur { get; set; }
        public string SubeAdi { get; set; }
        public string Kaynak { get; set; }
    }

    /// <summary>KRY_VARDIYA.kaynak değerinin ekranda görünen adı.</summary>
    public static string KaynakAdi(string kaynak) =>
        (kaynak ?? "").Trim().ToLowerInvariant() switch
        {
            "manuel" => Manuel,
            "kart" => ICard,
            _ => Bicen360,
        };

    /// <summary>
    /// Aralıktaki uygulama okutmaları (bitiş günü dahil). Tablo yoksa ya da
    /// sorgu başarısızsa boş liste: rapor iCard verisiyle çalışmaya devam eder.
    /// </summary>
    public static List<Okutma> Aralik(VeritabaniServisi vt, DateTime bas, DateTime bitDahil,
        string personelKodu = null, ILogger kayit = null)
    {
        try
        {
            using var db = vt.Baglanti();
            return Aralik(db, bas, bitDahil, personelKodu);
        }
        catch (Exception hata)
        {
            kayit?.LogWarning(hata, "Uygulama okutmaları alınamadı");
            return new List<Okutma>();
        }
    }

    public static List<Okutma> Aralik(IDbConnection db, DateTime bas, DateTime bitDahil,
        string personelKodu = null)
    {
        if (bitDahil < bas) (bas, bitDahil) = (bitDahil, bas);

        var kod = string.IsNullOrWhiteSpace(personelKodu) ? null : personelKodu.Trim();

        return db.Query<Satir>(@"
SELECT LTRIM(RTRIM(personel_kodu)) AS PersonelKodu,
       gecis_zamani                AS Zaman,
       tur                         AS Tur,
       sube_adi                    AS SubeAdi,
       kaynak                      AS Kaynak
FROM KRY_VARDIYA
WHERE gecis_zamani >= @bas AND gecis_zamani < @bit
  AND ISNULL(kaynak, N'mobil') <> N'kart'
  AND (@kod IS NULL OR personel_kodu = @kod)",
                new { bas = bas.Date, bit = bitDahil.Date.AddDays(1), kod }, commandTimeout: 90)
            .Select(x => new Okutma(x.PersonelKodu ?? "", x.Zaman, x.Tur, x.SubeAdi, KaynakAdi(x.Kaynak)))
            .ToList();
    }

    /// <summary>
    /// Personelin son uygulama okutma tarihi (sınırdan sonra). "Kaç gündür
    /// okutmuyor" hesabında iCard'ın son tarihiyle karşılaştırılır.
    /// </summary>
    public static DateTime? SonTarih(VeritabaniServisi vt, IEnumerable<string> kodlar, DateTime sinir)
    {
        var liste = kodlar.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToList();

        if (liste.Count == 0) return null;

        try
        {
            using var db = vt.Baglanti();

            return db.ExecuteScalar<DateTime?>(@"
SELECT MAX(CAST(gecis_zamani AS DATE))
FROM KRY_VARDIYA
WHERE personel_kodu IN @liste
  AND gecis_zamani >= @sinir
  AND ISNULL(kaynak, N'mobil') <> N'kart'",
                new { liste, sinir = sinir.Date }, commandTimeout: 60);
        }
        catch
        {
            return null;
        }
    }
}

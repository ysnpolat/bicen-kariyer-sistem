using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Yıllık izin hak ediş (kıdem) tarihi düzeltmesi.
///
/// <para>
/// Normalde hak ediş, Mikro'daki işe giriş tarihinin yıl dönümüdür. İşten
/// ayrılıp tekrar giren personelde Mikro yalnızca son girişi bilir; oysa
/// önceki çalışma süresi de kıdeme sayılır. İK burada elle bir "hak ediş
/// esas tarihi" belirler: ilk giriş tarihine çalışılmayan (ara) günler
/// eklenerek bulunur ya da doğrudan yazılır.
/// </para>
/// </summary>
public static class IzinHakedis
{
    /// <summary>Tüm düzeltmeler, personel koduna göre.</summary>
    public static Dictionary<string, dynamic> Hepsi(IDbConnection db) =>
        db.Query(@"
SELECT personel_kodu AS kod, hakedis_tarihi AS tarih, ilk_giris AS ilkGiris,
       ara_donemler AS araDonemler, aciklama, guncelleyen, guncelleme, kaynak
FROM KRY_IZIN_HAKEDIS")
            .GroupBy(x => ((string)x.kod ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

    /// <summary>Tek personelin düzeltmesi; yoksa null.</summary>
    public static dynamic Getir(IDbConnection db, string kod) =>
        db.QueryFirstOrDefault(@"
SELECT personel_kodu AS kod, hakedis_tarihi AS tarih, ilk_giris AS ilkGiris,
       ara_donemler AS araDonemler, aciklama, guncelleyen, guncelleme, kaynak
FROM KRY_IZIN_HAKEDIS WHERE personel_kodu = @kod", new { kod = (kod ?? "").Trim() });

    /// <summary>Kıdem ve hak edişin hesaplandığı tarih: düzeltme varsa o, yoksa işe giriş.</summary>
    public static DateTime? Esas(DateTime? giris, dynamic duzeltme)
    {
        if (duzeltme is not null && duzeltme.tarih is DateTime t) return t.Date;
        return giris is DateTime g && g.Year > 1900 ? g.Date : null;
    }

    /// <summary>Ekrana giden düzeltme özeti.</summary>
    public static object Ozet(dynamic d) => d is null ? null : new
    {
        tarih = (DateTime)d.tarih,
        ilkGiris = (DateTime?)d.ilkGiris,
        araDonemler = (string)d.araDonemler,
        aciklama = (string)d.aciklama,
        guncelleyen = (string)d.guncelleyen,
        guncelleme = (DateTime?)d.guncelleme,
        /* 'bordro': bordrodan otomatik hesaplandı; boş/'elle': İK yazdı */
        kaynak = string.IsNullOrWhiteSpace((string)d.kaynak) ? "elle" : (string)d.kaynak
    };

    /// <summary>Esas tarihin bu yılki yıl dönümü (29 Şubat için ay sonu).</summary>
    public static DateTime YilDonumu(DateTime esas, int yil) =>
        new(yil, esas.Month, Math.Min(esas.Day, DateTime.DaysInMonth(yil, esas.Month)));
}

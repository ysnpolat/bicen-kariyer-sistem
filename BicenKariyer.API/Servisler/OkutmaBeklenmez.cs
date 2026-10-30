using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Bugün vardiya okutması beklenmeyen personel (07.10.2026).
///
/// <para>
/// "Vardiya girişi yapılmadı" bildirimi ve uygulama açılışındaki karekod
/// hatırlatması izinli personele de gidiyordu. Sebepler: sicil karşılaştırması
/// birebir yazımla yapılıyordu ("0123" ile "123" tutmuyordu) ve yalnızca
/// izin kaydı (KRY_IZIN) okunuyordu; onay sürecindeki ya da onaylanıp henüz
/// izin kaydına dönüşmemiş talepler, personel kartındaki raporlar sayılmıyordu.
/// </para>
///
/// <para>
/// Bugün okutma beklenmeyenler: izin kaydı (tam gün), reddedilmemiş ve iptal
/// edilmemiş izin talebi (onay bekleyen dahil), raporlu (personel kartı ya da
/// rapor izni), vardiya planında bugün haftalık izin ya da boş.
/// </para>
/// </summary>
public static class OkutmaBeklenmez
{
    public static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Bugün okutma beklenmeyenlerin sicilleri (sıfırsız yazım)</summary>
    public static HashSet<string> Bugun(IDbConnection db, VeritabaniServisi vt, DateTime bugun)
    {
        var kume = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void Ekle(IEnumerable<string> l)
        {
            foreach (var x in l) if (!string.IsNullOrWhiteSpace(x)) kume.Add(K(x));
        }

        /* İzin kaydı: tam gün (saatlik ve yarım gün izinde personel yine çalışıyor) */
        try
        {
            Ekle(db.Query<string>(@"
SELECT DISTINCT personel_kodu FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @bugun
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @bugun
  AND (yarim_gun IS NULL OR yarim_gun = N'')
  AND (baslangic_saat IS NULL OR baslangic_saat = N'')", new { bugun }));
        }
        catch { }

        /* İzin talebi: reddedilmemiş ve kaydı henüz oluşmamış (onay bekleyen dahil) */
        try
        {
            Ekle(db.Query<string>(@"
SELECT DISTINCT personel_kodu FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND izin_id IS NULL AND durum <> N'Reddedildi'
  AND cikis_tarihi <= @bugun AND donus_tarihi >= @bugun
  AND (yarim_gun IS NULL OR yarim_gun = N'')
  AND (baslangic_saat IS NULL OR baslangic_saat = N'')", new { bugun }));
        }
        catch { }

        /* Vardiya planında bugün haftalık izin ya da boş */
        try
        {
            Ekle(db.Query<string>(@"
SELECT personel_kodu FROM KRY_VARDIYA_PLAN WHERE gun = @bugun AND tur IN (N'izin', N'off')", new { bugun }));
        }
        catch { }

        /* Raporlu */
        try
        {
            Ekle(new RaporluServisi(vt).Bugun(bugun).Values.Select(x => x.PersonelKodu));
        }
        catch { }

        return kume;
    }

    /// <summary>Tek kişi için (uygulama ana sayfası)</summary>
    public static bool KisiBugun(IDbConnection db, VeritabaniServisi vt, string kod, DateTime bugun)
    {
        try
        {
            return Bugun(db, vt, bugun).Contains(K(kod));
        }
        catch
        {
            return false;
        }
    }
}

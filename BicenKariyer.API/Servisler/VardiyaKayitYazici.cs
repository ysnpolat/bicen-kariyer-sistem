using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Elle (karekodsuz) vardiya kaydı yazar ve günlük özeti yeniler.
///
/// <para>
/// Personel okutamadığında ya da unuttuğunda manuel giriş-çıkış talebi
/// açıyor; yöneticisi saati kontrol edip onaylıyor. Onaylanan kayıt
/// karekod okutmasıyla aynı tabloya düşüyor ki puantaj, mesai ve okutma
/// raporları hiç ayrım yapmadan çalışsın. Konum doğrulaması 0 ve kaynak
/// "manuel" yazılıyor; elle eklendiği raporda belli oluyor.
/// </para>
/// </summary>
public static class VardiyaKayitYazici
{
    public static void ElleEkle(IDbConnection db, string kod, string adSoyad, string subeAdi,
        string tur, DateTime zaman)
    {
        db.Execute(@"
INSERT INTO KRY_VARDIYA
    (personel_kodu, ad_soyad, sube_adi, tur, gecis_zamani, konum_dogru, kaynak)
VALUES (@kod, @adSoyad, @subeAdi, @tur, @zaman, 0, N'manuel')",
            new { kod, adSoyad, subeAdi, tur, zaman });

        /* Günlük özet yeniden hesaplanır; aylık mesai buradan okunuyor */
        db.Execute(@"
MERGE KRY_VARDIYA_GUN AS h
USING (SELECT @kod AS kod, @tarih AS t) AS y
   ON h.personel_kodu = y.kod AND h.tarih = y.t
WHEN MATCHED THEN UPDATE SET
    ilk_giris = (SELECT MIN(gecis_zamani) FROM KRY_VARDIYA
                 WHERE personel_kodu = @kod
                   AND CAST(gecis_zamani AS DATE) = @tarih),
    son_cikis = (SELECT MAX(gecis_zamani) FROM KRY_VARDIYA
                 WHERE personel_kodu = @kod
                   AND CAST(gecis_zamani AS DATE) = @tarih),
    sure_dakika = (SELECT ISNULL(DATEDIFF(minute,
                       MIN(gecis_zamani), MAX(gecis_zamani)), 0)
                   FROM KRY_VARDIYA
                   WHERE personel_kodu = @kod
                     AND CAST(gecis_zamani AS DATE) = @tarih)
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, tarih, ilk_giris, sure_dakika)
    VALUES (@kod, @tarih, @zaman, 0);",
            new { kod, tarih = zaman.Date, zaman });
    }
}

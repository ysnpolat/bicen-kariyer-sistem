using System.Data;
using Microsoft.Data.SqlClient;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kart geçiş sistemindeki (iCardBicen) okutmaları vardiya tablosuna aktarır.
///
/// <para>
/// Geçmiş okutmalar kart sisteminde, yeni okutmalar mobil uygulamada
/// tutuluyordu; puantaj yalnızca mobili gördüğü için geçmiş boş
/// görünüyordu. İki kaynak da aynı tabloya (KRY_VARDIYA) yazılıyor,
/// satırda kaynağı duruyor. Kart sistemi kapatıldığında aktarımı
/// durdurmak yetiyor: geçmiş veri tabloda kalıyor, uygulama tarafında
/// hiçbir şey değişmiyor.
/// </para>
///
/// <para>
/// Aktarım tekrar çalıştırılabilir: aynı kişinin aynı saniyedeki kaydı
/// ikinci kez eklenmiyor. Geçiş döneminde kişi hem kart hem telefonla
/// okutursa, kart kaydı mobil kaydın 10 dakikası içindeyse atlanıyor —
/// aynı giriş iki kez sayılmasın.
/// </para>
///
/// <para>
/// Giriş/çıkış yönü, geçiş tablosunda yön sütunu varsa ondan; yoksa gün
/// içindeki sıraya göre (ilk okutma giriş, sonrakiler sırayla) veriliyor.
/// Bulunan sütun günlüğe yazılıyor.
/// </para>
/// </summary>
public class KartGecisAktarimServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly ILogger<KartGecisAktarimServisi> _kayit;

    public KartGecisAktarimServisi(VeritabaniServisi vt, PersonelKaynagiServisi kaynak,
        ILogger<KartGecisAktarimServisi> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _kayit = kayit;
    }

    public sealed record Sonuc(int Okunan, int Eklenen, int Mevcut, int EslesmeyenKisi, int MobilCakismasi,
                               string YonSutunu, string SaatSutunu, List<string> Sutunlar,
                               List<string> EslesmeyenKimlikler, int Silinen);

    private static string Rakam(string s) => new((s ?? "").Where(char.IsDigit).ToArray());

    private static readonly string[] YonAdaylari =
    {
        "Direction", "TransitionType", "InOut", "IsEntry", "EntryExit", "Way", "TransitionWay", "Type",
    };

    /// <summary>Saatin ayrı tutulduğu sütun adayları.</summary>
    private static readonly string[] SaatAdaylari =
    {
        "TransitionTime", "TransitionHour", "Time", "Saat", "TransitionDateTime", "EventTime", "PassTime",
    };

    /// <summary>
    /// Geçiş tablosunun yön ve saat sütunları.
    ///
    /// TransitionDate bazı kurulumlarda yalnızca tarih tutuyor; saat ayrı
    /// sütunda. İkisi birleştirilmezse bütün okutmalar 00:00 görünüyor ve
    /// aynı günün okutmaları tek kayda düşüyordu.
    /// </summary>
    private (string yon, string saat, List<string> sutunlar) Sutunlar(IDbConnection gecis)
    {
        try
        {
            var sutunlar = gecis.Query<string>(@"
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Transitions'").ToList();

            var yon = YonAdaylari.FirstOrDefault(a =>
                sutunlar.Any(x => x.Equals(a, StringComparison.OrdinalIgnoreCase)));

            var saat = SaatAdaylari.FirstOrDefault(a =>
                sutunlar.Any(x => x.Equals(a, StringComparison.OrdinalIgnoreCase)));

            _kayit.LogInformation(
                "Geçiş tablosu sütunları: {Sutunlar}. Yön: {Yon}. Saat: {Saat}",
                string.Join(", ", sutunlar), yon ?? "yok", saat ?? "yok (TransitionDate içinde)");

            return (yon, saat, sutunlar);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Geçiş tablosu sütunları okunamadı");
            return (null, null, new List<string>());
        }
    }

    /// <summary>Tarih ve ayrı saat sütununu birleştirir.</summary>
    private static DateTime Birlestir(DateTime tarih, object saat)
    {
        if (saat is null || tarih.TimeOfDay != TimeSpan.Zero) return tarih;

        switch (saat)
        {
            case TimeSpan ts:
                return tarih.Date + ts;

            case DateTime dt:
                return tarih.Date + dt.TimeOfDay;

            default:
                var metin = Convert.ToString(saat)?.Trim();

                if (TimeSpan.TryParse(metin, out var t1)) return tarih.Date + t1;
                if (DateTime.TryParse(metin, out var t2)) return tarih.Date + t2.TimeOfDay;

                /* 930 / 0930 gibi sayı biçimleri */
                if (int.TryParse(metin, out var sayi) && sayi is >= 0 and <= 235959)
                {
                    var ss = sayi > 2359 ? sayi / 10000 : sayi / 100;
                    var dd = sayi > 2359 ? (sayi / 100) % 100 : sayi % 100;
                    var sn = sayi > 2359 ? sayi % 100 : 0;

                    if (ss < 24 && dd < 60 && sn < 60)
                        return tarih.Date + new TimeSpan(ss, dd, sn);
                }

                return tarih;
        }
    }

    private static DataTable YeniTablo()
    {
        var t = new DataTable();

        t.Columns.Add("personel_kodu", typeof(string));
        t.Columns.Add("ad_soyad", typeof(string));
        t.Columns.Add("sube_adi", typeof(string));
        t.Columns.Add("tur", typeof(string));
        t.Columns.Add("gecis_zamani", typeof(DateTime));

        return t;
    }

    /// <summary>Günün satırlarını geçici tabloya toplu kopyalar.</summary>
    private static void Kopyala(IDbConnection db, DataTable tablo)
    {
        if (db is not SqlConnection sql)
            throw new InvalidOperationException("Toplu kopyalama için SQL Server bağlantısı gerekiyor.");

        using var kopya = new SqlBulkCopy(sql)
        {
            DestinationTableName = "#aktarim",
            BatchSize = 2000,
            BulkCopyTimeout = 300,
        };

        foreach (DataColumn s in tablo.Columns)
            kopya.ColumnMappings.Add(s.ColumnName, s.ColumnName);

        kopya.WriteToServer(tablo);
    }

    /// <summary>Yön değerini giriş/çıkışa çevirir; bilinmiyorsa null.</summary>
    private static string Yon(object deger)
    {
        var s = Convert.ToString(deger)?.Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(s)) return null;

        if (s is "1" or "true" or "in" or "giris" or "giriş" or "entry" or "e") return "giris";
        if (s is "0" or "2" or "false" or "out" or "cikis" or "çıkış" or "exit" or "c") return "cikis";

        return null;
    }

    /// <summary>
    /// Verilen aralıktaki kart okutmalarını aktarır. Gün gün işliyor:
    /// yılların verisi tek sorguda belleğe alınmasın.
    /// </summary>
    public Sonuc Aktar(DateTime bas, DateTime bit, bool temizle = false)
    {
        if (bit < bas) (bas, bit) = (bit, bas);

        using var gecis = _vt.GecisBaglantisi();
        using var db = _vt.Baglanti();

        db.Open();

        /* Kayıtlar toplu kopyalanıyor. Tek tek INSERT, hedef veritabanı
           uzak sunucuda olduğu için satır başına bir ağ gidiş-dönüşü
           demekti ve bir ay bile dakikalarca sürüyordu. Satırlar geçici
           tabloya kopyalanıp tek sorguda aktarılıyor; tekrar ve mobil
           çakışma elemesi de orada yapılıyor. */
        db.Execute(@"
CREATE TABLE #aktarim (
    personel_kodu NVARCHAR(30)  NOT NULL,
    ad_soyad      NVARCHAR(120) NULL,
    sube_adi      NVARCHAR(120) NULL,
    tur           NVARCHAR(10)  NOT NULL,
    gecis_zamani  DATETIME2     NOT NULL
);");

        var (yonSutunu, saatSutunu, tumSutunlar) = Sutunlar(gecis);

        /* Yeniden aktarım: aralıktaki kart kayıtları silinip baştan
           yazılıyor. Saatleri yanlış (00:00) aktarılmış kayıtları
           düzeltmenin tek yolu bu; mobil okutmalara dokunulmuyor. */
        var silinen = 0;

        if (temizle)
            silinen = db.Execute(@"
DELETE FROM KRY_VARDIYA
WHERE kaynak = N'kart' AND gecis_zamani >= @bas AND gecis_zamani < @bit",
                new { bas = bas.Date, bit = bit.Date.AddDays(1) }, commandTimeout: 300);

        /* Personel eşlemesi: kimlik → sicil. Ayrılanlar da dahil; geçmiş
           okutmaların sahibi bugün çalışmıyor olabilir. */
        var kisiler = _kaynak.TumPersonelleriGetir()
            .Where(x => !string.IsNullOrWhiteSpace(x.KimlikNo))
            .GroupBy(x => Rakam(x.KimlikNo))
            .ToDictionary(g => g.Key, g => g.First());

        int okunan = 0, eklenen = 0, mevcut = 0, eslesmeyen = 0, cakisma = 0;
        var eslesmeyenKimlikler = new HashSet<string>();

        for (var gun = bas.Date; gun <= bit.Date; gun = gun.AddDays(1))
        {
            var secim = (yonSutunu is null ? "" : $", t.[{yonSutunu}] AS yon")
                      + (saatSutunu is null ? "" : $", t.[{saatSutunu}] AS saat");

            List<dynamic> satirlar;

            try
            {
                satirlar = gecis.Query($@"
SELECT LTRIM(RTRIM(p.RegistrationNumber)) AS kimlik, t.TransitionDate AS zaman{secim}
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) = @gun
  AND p.RegistrationNumber IS NOT NULL
ORDER BY p.RegistrationNumber, t.TransitionDate",
                    new { gun }, commandTimeout: 180).ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Kart geçişleri okunamadı: {Gun}", gun);
                continue;
            }

            if (satirlar.Count == 0) continue;

            okunan += satirlar.Count;

            var tablo = YeniTablo();
            var sonKisi = "";
            var sira = 0;

            foreach (var r in satirlar)
            {
                var kimlik = Rakam((string)r.kimlik);

                if (!kisiler.TryGetValue(kimlik, out var kisi))
                {
                    if (eslesmeyenKimlikler.Add(kimlik)) eslesmeyen++;
                    continue;
                }

                var kod = (kisi.PersonelKodu ?? "").Trim();
                var zaman = (DateTime)r.zaman;

                /* Saat ayrı sütundaysa tarihle birleştiriliyor */
                if (saatSutunu is not null
                    && ((IDictionary<string, object>)r).TryGetValue("saat", out var saatDeger))
                    zaman = Birlestir(zaman, saatDeger);

                if (kod != sonKisi)
                {
                    sonKisi = kod;
                    sira = 0;
                }

                /* Yön: sütundan; yoksa sıraya göre giriş/çıkış */
                string tur = null;

                if (yonSutunu is not null)
                {
                    var d = ((IDictionary<string, object>)r).TryGetValue("yon", out var v) ? v : null;
                    tur = Yon(d);
                }

                tur ??= sira % 2 == 0 ? "giris" : "cikis";
                sira++;

                tablo.Rows.Add(kod, $"{kisi.Ad} {kisi.Soyad}".Trim(), kisi.IsGrubu, tur, zaman);
            }

            if (tablo.Rows.Count == 0) continue;

            Kopyala(db, tablo);

            /* Eleme ve aktarım tek sorguda:
               - aynı kişinin aynı saniyedeki kaydı varsa atlanır
               - kart kaydı, aynı kişinin 10 dakika içindeki mobil
                 okutmasına denk geliyorsa atlanır (aynı giriş iki kez
                 sayılmasın) */
            var sayilar = db.QueryFirst(@"
SELECT
    (SELECT COUNT(*) FROM #aktarim a
      WHERE EXISTS (SELECT 1 FROM KRY_VARDIYA v
                    WHERE v.personel_kodu = a.personel_kodu
                      AND ABS(DATEDIFF(second, v.gecis_zamani, a.gecis_zamani)) < 1)) AS mevcut,
    (SELECT COUNT(*) FROM #aktarim a
      WHERE NOT EXISTS (SELECT 1 FROM KRY_VARDIYA v
                        WHERE v.personel_kodu = a.personel_kodu
                          AND ABS(DATEDIFF(second, v.gecis_zamani, a.gecis_zamani)) < 1)
        AND EXISTS (SELECT 1 FROM KRY_VARDIYA v
                    WHERE v.personel_kodu = a.personel_kodu
                      AND ISNULL(v.kaynak, N'mobil') = N'mobil'
                      AND ABS(DATEDIFF(minute, v.gecis_zamani, a.gecis_zamani)) < 10)) AS cakisma;",
                commandTimeout: 300);

            mevcut += (int)sayilar.mevcut;
            cakisma += (int)sayilar.cakisma;

            eklenen += db.Execute(@"
INSERT INTO KRY_VARDIYA (personel_kodu, ad_soyad, sube_adi, tur, gecis_zamani, konum_dogru, kaynak)
SELECT a.personel_kodu, a.ad_soyad, a.sube_adi, a.tur, a.gecis_zamani, 0, N'kart'
FROM #aktarim a
WHERE NOT EXISTS (SELECT 1 FROM KRY_VARDIYA v
                  WHERE v.personel_kodu = a.personel_kodu
                    AND ABS(DATEDIFF(second, v.gecis_zamani, a.gecis_zamani)) < 1)
  AND NOT EXISTS (SELECT 1 FROM KRY_VARDIYA v
                  WHERE v.personel_kodu = a.personel_kodu
                    AND ISNULL(v.kaynak, N'mobil') = N'mobil'
                    AND ABS(DATEDIFF(minute, v.gecis_zamani, a.gecis_zamani)) < 10);",
                commandTimeout: 300);

            db.Execute("TRUNCATE TABLE #aktarim;");
        }

        _kayit.LogInformation(
            "Kart geçiş aktarımı {Bas:dd.MM.yyyy}–{Bit:dd.MM.yyyy}: {Okunan} okundu, {Eklenen} eklendi, "
            + "{Mevcut} zaten vardı, {Cakisma} mobille çakıştı, {Eslesmeyen} kimlik eşleşmedi",
            bas, bit, okunan, eklenen, mevcut, cakisma, eslesmeyen);

        return new Sonuc(okunan, eklenen, mevcut, eslesmeyen, cakisma, yonSutunu, saatSutunu,
            tumSutunlar, eslesmeyenKimlikler.Take(20).ToList(), silinen);
    }
}

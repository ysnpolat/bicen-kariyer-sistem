using System.Data;
using System.Text;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Bicen360.API.Servisler;

/// <summary>
/// Pusula'nın Biçen360 kopyası (30.10.2026).
///
/// <para>
/// <c>MikroDB_V15_BICEN.dbo.PUSULA</c> tablosunu <c>hmz_pusula</c> yordamı
/// günde 4 kez (10:00, 14:00, 17:00, 21:00) baştan yazıyor; tablo geniş
/// yapıda, her şube için S_/P_/SDG_/MSG_ sütunları var. Ekranlar (Fiyat
/// Kontrol'deki ürün durumu) canlı Mikro'ya sorgu atmasın diye bu görev
/// tabloyu "ürün × şube" satırlarına çevirip biPortal'daki
/// <c>B360_PUSULA_SUBE</c> tablosuna kopyalar.
/// </para>
///
/// <para>
/// 15 dakikada bir bakar; iki koşul: Pusula en az 1 saat önce hesaplanmış
/// olmalı (yarım kalmış tabloyu okumamak için — yordam bayrak tarihini en
/// son yazıyor) ve o hesaplama daha önce yüklenmemiş olmalı. Son 8
/// hesaplama (yaklaşık 2 gün) tutulur.
/// </para>
///
/// <para>
/// Linked server ve SQL Agent görevi gerekmez: API, Mikro bağlantısıyla
/// okuyup SqlBulkCopy ile biPortal'a yazar. Şube listesi sabit değil,
/// PUSULA'daki S_n + MSG_n sütunlarından okunur; yeni şube açılınca
/// kendiliğinden gelir. Kapatmak için <c>Pusula:Yukle = false</c>.
/// </para>
/// </summary>
public class PusulaYukleGorevi : BackgroundService
{
    private const string Tablo = "B360_PUSULA_SUBE";
    private const int TutulacakHesap = 8;

    private readonly VeritabaniServisi _vt;
    private readonly IConfiguration _yap;
    private readonly ILogger<PusulaYukleGorevi> _kayit;

    public PusulaYukleGorevi(VeritabaniServisi vt, IConfiguration yap, ILogger<PusulaYukleGorevi> kayit)
    {
        _vt = vt;
        _yap = yap;
        _kayit = kayit;
    }

    /// <summary>
    /// Durum kodlarının ekranda görünen adı (PUSULA MSG_ sütunu). Yalnızca
    /// anlamı Stok ekranında da kullanılanlar; bilinmeyen kod olduğu gibi
    /// gösterilir. Yeni kod anlamı netleşince buraya eklenir.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, string> DurumAdlari = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["DS"] = "Depodan sipariş",
        ["SS"] = "Satıcıdan sipariş",
        ["ÜY"] = "Çok yavaş satıyor",
        ["ÜS"] = "Ürün hiç satmıyor",
        ["YS"] = "Stoğunuzu düzeltin",
        ["MK"] = "Mal kabule kapalı",
    };

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                if (!string.Equals(_yap["Pusula:Yukle"], "false", StringComparison.OrdinalIgnoreCase))
                    await Calis(jeton);
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "Pusula kopyası yüklenemedi");
            }

            await Task.Delay(TimeSpan.FromMinutes(15), jeton);
        }
    }

    private void TabloKur(IDbConnection db) => db.Execute($@"
IF OBJECT_ID('{Tablo}') IS NULL
BEGIN
    CREATE TABLE {Tablo} (
        hesap_zamani   DATETIME      NOT NULL,
        yukleme_zamani DATETIME      NOT NULL DEFAULT GETDATE(),
        sira           INT           NULL,
        stok_kodu      NVARCHAR(25)  NOT NULL,
        urun_adi       NVARCHAR(127) NULL,
        barkod         NVARCHAR(50)  NULL,
        birim          NVARCHAR(10)  NULL,
        tip            NVARCHAR(50)  NULL,
        depo_no        INT           NOT NULL,
        sube_adi       NVARCHAR(50)  NULL,
        stok           FLOAT         NULL,
        satis_21gun    FLOAT         NULL,
        sdg            FLOAT         NULL,
        sembol         NVARCHAR(4)   NULL,
        CONSTRAINT PK_{Tablo} PRIMARY KEY (hesap_zamani, depo_no, stok_kodu)
    );
    CREATE INDEX IX_{Tablo}_depo_stok ON {Tablo} (depo_no, stok_kodu, hesap_zamani DESC);
END");

    public async Task<string> Calis(CancellationToken jeton = default)
    {
        using var hedef = (SqlConnection)_vt.Baglanti();
        await hedef.OpenAsync(jeton);
        TabloKur(hedef);

        using var mikro = (SqlConnection)_vt.MikroBaglantisi();
        if (mikro.State != ConnectionState.Open) await mikro.OpenAsync(jeton);

        var hesap = mikro.ExecuteScalar<DateTime?>(
            "SELECT TOP 1 pusula_guncelleme_tarihi FROM Otomatik_Islemler.dbo.Mail_Gonderim WITH (NOLOCK)");

        if (hesap is null) return "hesap zamanı yok";
        if (hesap > DateTime.Now.AddHours(-1)) return "1 saat dolmadı";
        if (hedef.ExecuteScalar<int>($"SELECT COUNT(1) FROM {Tablo} WHERE hesap_zamani = @h", new { h = hesap }) > 0)
            return "zaten yüklü";

        var sql = KaynakSorgu(mikro);
        if (sql is null) return "PUSULA sütunları bulunamadı";

        using var islem = hedef.BeginTransaction();
        using (var okuyucu = await new SqlCommand(sql, mikro) { CommandTimeout = 600 }.ExecuteReaderAsync(jeton))
        using (var kopya = new SqlBulkCopy(hedef, SqlBulkCopyOptions.Default, islem)
               {
                   DestinationTableName = Tablo,
                   BatchSize = 5000,
                   BulkCopyTimeout = 600,
               })
        {
            foreach (var s in new[] { "hesap_zamani", "sira", "stok_kodu", "urun_adi", "barkod", "birim", "tip",
                                      "depo_no", "sube_adi", "stok", "satis_21gun", "sdg", "sembol" })
                kopya.ColumnMappings.Add(s, s);

            await kopya.WriteToServerAsync(okuyucu, jeton);
        }

        hedef.Execute($@"
DELETE FROM {Tablo}
WHERE hesap_zamani < (SELECT MIN(h) FROM (SELECT DISTINCT TOP {TutulacakHesap} hesap_zamani h
                                          FROM {Tablo} ORDER BY h DESC) x)", transaction: islem, commandTimeout: 300);

        islem.Commit();

        var adet = hedef.ExecuteScalar<int>($"SELECT COUNT(1) FROM {Tablo} WHERE hesap_zamani = @h", new { h = hesap });
        _kayit.LogInformation("Pusula kopyası yüklendi: {Hesap} · {Adet} satır", hesap, adet);
        return $"yüklendi: {adet} satır";
    }

    /// <summary>
    /// PUSULA'yı ürün × şube satırlarına çeviren sorgu. Şubeler S_n ve
    /// MSG_n sütunu bulunan numaralar; P_n ya da SDG_n yoksa NULL.
    /// </summary>
    private static string KaynakSorgu(IDbConnection mikro)
    {
        var sutunlar = mikro.Query<string>(@"
SELECT COLUMN_NAME FROM MikroDB_V15_BICEN.INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PUSULA'")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var depolar = sutunlar
            .Select(x => Regex.Match(x, @"^S_(\d+)$", RegexOptions.IgnoreCase))
            .Where(m => m.Success)
            .Select(m => int.Parse(m.Groups[1].Value))
            .Where(no => sutunlar.Contains($"MSG_{no}"))
            .OrderBy(x => x)
            .ToList();

        if (depolar.Count == 0) return null;

        string S(string ad) => sutunlar.Contains(ad) ? $"p.[{ad}]" : "NULL";

        var degerler = new StringBuilder();
        foreach (var d in depolar)
        {
            if (degerler.Length > 0) degerler.Append(",\n    ");
            degerler.Append($"({d}, CAST({S($"S_{d}")} AS FLOAT), CAST({S($"P_{d}")} AS FLOAT), CAST({S($"SDG_{d}")} AS FLOAT), {S($"MSG_{d}")})");
        }

        return $@"
SELECT
    m.pusula_guncelleme_tarihi              AS hesap_zamani,
    {S("SIRA")}                              AS sira,
    LTRIM(RTRIM(p.sto_kod))                 AS stok_kodu,
    LEFT(p.sto_isim, 127)                   AS urun_adi,
    LEFT(CAST({S("BARKOD")} AS NVARCHAR(50)), 50) AS barkod,
    LEFT(CAST({S("birim")} AS NVARCHAR(10)), 10)  AS birim,
    LEFT(CAST({S("Tip")} AS NVARCHAR(50)), 50)    AS tip,
    s.depo_no,
    LEFT(d.dep_adi, 50)                     AS sube_adi,
    s.stok,
    s.satis_21gun,
    s.sdg,
    LEFT(LTRIM(RTRIM(s.sembol)), 4)         AS sembol
FROM MikroDB_V15_BICEN.dbo.PUSULA p WITH (NOLOCK)
CROSS APPLY (VALUES
    {degerler}
) s (depo_no, stok, satis_21gun, sdg, sembol)
LEFT JOIN MikroDB_V15_BICEN.dbo.DEPOLAR d WITH (NOLOCK) ON d.dep_no = s.depo_no
CROSS JOIN (SELECT TOP 1 pusula_guncelleme_tarihi
            FROM Otomatik_Islemler.dbo.Mail_Gonderim WITH (NOLOCK)) m
WHERE p.sto_kod IS NOT NULL";
    }

    /// <summary>
    /// Bir şubede bir ürünün son Pusula satırı; kopya yoksa ya da ürün
    /// Pusula'da değilse null.
    /// </summary>
    public static object UrunDurumu(IDbConnection db, int depo, string stokKodu)
    {
        if (string.IsNullOrWhiteSpace(stokKodu)) return null;

        var r = db.QueryFirstOrDefault($@"
IF OBJECT_ID('{Tablo}') IS NOT NULL
SELECT TOP 1 sira, tip, stok, satis_21gun AS satis21, sdg, sembol, hesap_zamani AS hesapZamani
FROM {Tablo} t
WHERE depo_no = @depo AND stok_kodu = @stok
ORDER BY hesap_zamani DESC", new { depo, stok = stokKodu.Trim() });

        if (r is null) return null;

        var sembol = ((string)r.sembol ?? "").Trim();
        double? sdg = r.sdg is null ? null : (double)r.sdg;

        return new
        {
            sira = (int?)r.sira,
            tip = (string)r.tip,
            stok = r.stok is null ? (double?)null : Math.Round((double)r.stok, 2),
            satis21 = r.satis21 is null ? (double?)null : Math.Round((double)r.satis21, 2),
            sdg = sdg is null ? null : sdg >= 999 ? (double?)null : Math.Round(sdg.Value, 1),
            satisYok = sdg >= 999,
            sembol = sembol.Length == 0 ? null : sembol,
            durumAdi = sembol.Length == 0 ? null : DurumAdlari.TryGetValue(sembol, out var ad) ? ad : sembol,
            hesapZamani = (DateTime)r.hesapZamani,
        };
    }
}

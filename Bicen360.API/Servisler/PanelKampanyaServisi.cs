using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Bicen360.API.Servisler;

/// <summary>
/// Kampanyalar doğrudan Biçen Panel veritabanından (26.10.2026).
/// <para>
/// Panelin OZ Merkez'e yazacağı PANEL_INSERT_URUNLERI tablosu henüz
/// dolmuyor; kampanyalar BicenPanel.dbo.Kampanya / KampanyaUrun'de duruyor.
/// Bağlantı (ConnectionStrings:BicenPanel) tanımlıysa buradan, yalnız
/// okunarak alınır; tanımlı değilse eski yol (OZ Merkez tablosu) kullanılır.
/// Panele hiçbir şey yazılmaz.
/// </para>
/// <para>
/// Kurallar (panel belgesi, bölüm 2):
/// - Bitişi bugün ya da sonra olan kampanyalar.
/// - Aşama ≥ Kampanya:TamamAsama (varsayılan 5): Planlı / Sürüyor.
/// - Kampanya:OnayAsama ≤ aşama &lt; TamamAsama (varsayılan 3): Onay bekliyor.
/// - Tek ürünlü türlerde (Haftanın Ürünü, Tamamla Kazan, Pazar Delisi) yalnız
///   seçilen ürün (SecilenUrunId); seçim yapılmamışsa kampanya görünmez.
/// - Diğerlerinde ürün durumu Kampanya:UrunDurumlari'ndan (varsayılan 0,1).
/// - KatilimSecili = 1 (mağaza seçilmiş) kampanyalar, katılım tablosu
///   tanımlanana kadar gösterilmez: yanlış mağazaya etiket gitmesin.
/// Raf fiyatı Mikro'dan, mağazanın depo fiyatıyla okunur.
/// </para>
/// </summary>
public class PanelKampanyaServisi
{
    public static readonly string[] TekUrunlu = { "Haftanın Ürünü", "Tamamla Kazan", "Pazar Delisi" };

    private readonly IConfiguration _yap;
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PanelKampanyaServisi> _kayit;

    public PanelKampanyaServisi(IConfiguration yap, VeritabaniServisi vt, ILogger<PanelKampanyaServisi> kayit)
    {
        _yap = yap;
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>Bağlantı tanımlı mı (sunucu appsettings'te; parola yalnız orada)</summary>
    public bool Tanimli => !string.IsNullOrWhiteSpace(_yap.GetConnectionString("BicenPanel"));

    private int Ayar(string ad, int varsayilan) => int.TryParse(_yap[$"Kampanya:{ad}"], out var v) ? v : varsayilan;

    private int[] UrunDurumlari()
    {
        var l = (_yap["Kampanya:UrunDurumlari"] ?? "0,1")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => int.TryParse(x, out var v) ? v : (int?)null)
            .Where(x => x is not null).Select(x => x.Value).ToArray();
        return l.Length == 0 ? new[] { 0, 1 } : l;
    }

    public sealed class Satir
    {
        public int KampanyaNo { get; set; }
        public string KampanyaAdi { get; set; }
        public string KampanyaTuru { get; set; }
        public DateTime? Baslangic { get; set; }
        public DateTime? Bitis { get; set; }
        public string Durum { get; set; }
        public int? Kare { get; set; }
        public string GrupAdi { get; set; }
        public string StokKod { get; set; }
        public string UrunAdi { get; set; }
        public string Barkod { get; set; }
        public decimal? RafFiyati { get; set; }
        public decimal? InsertFiyati { get; set; }
        public int? IndirimYuzde { get; set; }
        public DateTime? Guncelleme { get; set; }
    }

    /// <summary>Mağazanın (depo no) güncel kampanya ürünleri.</summary>
    public List<Satir> Oku(int depo)
    {
        var tamam = Ayar("TamamAsama", 5);
        var onay = Ayar("OnayAsama", 3);
        var durumlar = UrunDurumlari();

        List<Satir> satirlar;
        using (var db = new SqlConnection(_yap.GetConnectionString("BicenPanel")))
        {
            /* Grup adı: panelde grup tablosu varsa (KampanyaGrup.Ad) */
            var grupVar = db.ExecuteScalar<int>(@"
SELECT CASE WHEN COL_LENGTH('dbo.KampanyaGrup', 'Ad') IS NOT NULL AND COL_LENGTH('dbo.KampanyaGrup', 'Id') IS NOT NULL THEN 1 ELSE 0 END") == 1;

            satirlar = db.Query<Satir>($@"
SELECT k.Id AS KampanyaNo, k.Ad AS KampanyaAdi, k.Tur AS KampanyaTuru,
       CAST(CAST(k.Baslangic AS DATE) AS DATETIME) AS Baslangic,
       DATEADD(SECOND, 86399, CAST(CAST(k.Bitis AS DATE) AS DATETIME)) AS Bitis,
       CASE WHEN k.Asama >= @tamam
            THEN CASE WHEN CAST(k.Baslangic AS DATE) > CAST(GETDATE() AS DATE) THEN N'Planlı' ELSE N'Sürüyor' END
            ELSE N'Onay bekliyor' END AS Durum,
       u.Kare, {(grupVar ? "g.Ad" : "CAST(NULL AS NVARCHAR(150))")} AS GrupAdi,
       u.StokKod, u.UrunAdi, u.Barkod, u.InsertFiyat AS InsertFiyati,
       ISNULL(u.DegistirmeZamani, ISNULL(k.DegistirmeZamani, k.OlusturmaZamani)) AS Guncelleme
FROM dbo.Kampanya k
    INNER JOIN dbo.KampanyaUrun u ON u.KampanyaId = k.Id
    {(grupVar ? "LEFT JOIN dbo.KampanyaGrup g ON g.Id = u.GrupId" : "")}
WHERE CAST(k.Bitis AS DATE) >= CAST(GETDATE() AS DATE)
  AND k.Asama >= @onay
  AND ISNULL(k.KatilimSecili, 0) = 0
  AND (
        (k.Tur IN @tekUrunlu AND k.SecilenUrunId IS NOT NULL AND u.Id = k.SecilenUrunId)
     OR (k.Tur NOT IN @tekUrunlu AND u.Durum IN @durumlar)
      )
ORDER BY k.Baslangic, k.Id, u.Kare, u.UrunAdi",
                new { tamam, onay, tekUrunlu = TekUrunlu, durumlar }, commandTimeout: 30).ToList();

            /* Mağaza seçilmiş kampanyalar şimdilik atlanıyor; kaç tane olduğu günlüğe */
            try
            {
                var atlanan = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM dbo.Kampanya
WHERE CAST(Bitis AS DATE) >= CAST(GETDATE() AS DATE) AND Asama >= @onay AND ISNULL(KatilimSecili, 0) = 1", new { onay });
                if (atlanan > 0)
                    _kayit.LogInformation("Mağaza seçimli {Adet} kampanya katılım tablosu tanımlanmadığı için gösterilmedi", atlanan);
            }
            catch { /* bilgi amaçlı */ }
        }

        /* Raf fiyatı: Mikro, mağazanın depo fiyatı (yoksa genel) */
        var stoklar = satirlar.Select(x => (x.StokKod ?? "").Trim()).Where(x => x.Length > 0).Distinct().ToArray();
        if (stoklar.Length > 0)
            try
            {
                using var mikro = _vt.MikroBaglantisi();
                var raf = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
                foreach (var parca in stoklar.Chunk(500))
                    foreach (var r in mikro.Query<(string stok, decimal fiyat)>(@"
SELECT f.sfiyat_stokkod, CAST(f.sfiyat_fiyati AS DECIMAL(18,2))
FROM STOK_SATIS_FIYAT_LISTELERI f WITH (NOLOCK)
WHERE f.sfiyat_stokkod IN @parca AND f.sfiyat_listesirano = 1 AND f.sfiyat_iptal = 0
  AND (f.sfiyat_deposirano = @depo OR f.sfiyat_deposirano = 0)
ORDER BY CASE WHEN f.sfiyat_deposirano = @depo THEN 1 ELSE 0 END", new { parca, depo }, commandTimeout: 30))
                        raf[r.stok.Trim()] = r.fiyat; // depoya özel satır sonra geldiği için üstüne yazar

                foreach (var s in satirlar)
                    if (raf.TryGetValue((s.StokKod ?? "").Trim(), out var f))
                    {
                        s.RafFiyati = f;
                        if (f > 0 && s.InsertFiyati is decimal i)
                            s.IndirimYuzde = (int)Math.Round((f - i) / f * 100m, MidpointRounding.AwayFromZero);
                    }
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "Kampanya ürünlerinin raf fiyatı okunamadı");
            }

        return satirlar;
    }
}

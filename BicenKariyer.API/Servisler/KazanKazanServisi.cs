using System.Globalization;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kazan-Kazan ortak işleri: ödül kademeleri, barkod denetimi, Mikro araması
/// ve 4. ay ölçümü. İK panelindeki düğme ile gece görevi aynı yolu kullanır;
/// ölçüm yalnızca durum hâlâ 'denemede' iken yazılır, iki kez ölçülmez.
/// </summary>
public class KazanKazanServisi
{
    /// <summary>KRY_KK_ODUL_KADEME boş ya da okunamazsa kullanılan kademeler.</summary>
    public static readonly (int Sinir, string Odul)[] VarsayilanKademeler =
    {
        (100, "Tam Altın"),
        (500, "Yarım Altın"),
        (1000, "Çeyrek Altın"),
        (2000, "Gram Altın"),
    };

    private readonly VeritabaniServisi _vt;
    private readonly ILogger<KazanKazanServisi> _kayit;

    public KazanKazanServisi(VeritabaniServisi vt, ILogger<KazanKazanServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>Etkin ödül kademeleri (sıra sınırına göre artan).</summary>
    public List<(int Sinir, string Odul)> Kademeler(System.Data.IDbConnection db, string aktivite = "yeniurun")
    {
        try
        {
            var l = db.Query<(int, string)>(@"
SELECT sira_sinir, odul FROM KRY_KK_ODUL_KADEME
WHERE aktif = 1 AND aktivite = @aktivite AND sira_sinir > 0
ORDER BY sira_sinir", new { aktivite }).ToList();
            if (l.Count > 0) return l;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kazan-Kazan ödül kademeleri okunamadı; varsayılanlar kullanılıyor");
        }

        return VarsayilanKademeler.ToList();
    }

    /* ------------------------------------------------------------------ barkod */

    public static string BarkodTemizle(string b) => new((b ?? "").Where(char.IsDigit).ToArray());

    /// <summary>
    /// GTIN denetimi. 8 (EAN-8), 12 (UPC-A), 13 (EAN-13) hane kabul edilir;
    /// 14 hane yalnızca başı 0 ise (13 haneye indirilir). Başka 14 haneli
    /// kodlar (ITF-14) koli barkodudur, reddedilir. Kontrol hanesi doğrulanır.
    /// </summary>
    public static (bool Gecerli, string Barkod, string Hata) BarkodDenetle(string ham)
    {
        var b = BarkodTemizle(ham);

        if (b.Length == 14)
        {
            if (b[0] != '0')
                return (false, b, "Bu koli barkodu (14 hane). Lütfen ürünün tekli ambalajındaki barkodu okutunuz.");
            b = b[1..];
        }

        if (b.Length is not (8 or 12 or 13))
            return (false, b, "Barkod 8, 12 ya da 13 haneli olmalı.");

        if (!KontrolHanesiDogru(b))
            return (false, b, "Barkod hatalı okundu ya da yazıldı (kontrol hanesi tutmuyor). Tekrar okutunuz.");

        return (true, b, null);
    }

    private static bool KontrolHanesiDogru(string b)
    {
        var toplam = 0;
        /* Sağdan, kontrol hanesi hariç: tek konumlar ×3, çiftler ×1 */
        for (int i = b.Length - 2, k = 0; i >= 0; i--, k++)
            toplam += (b[i] - '0') * (k % 2 == 0 ? 3 : 1);
        return (10 - toplam % 10) % 10 == b[^1] - '0';
    }

    /* ------------------------------------------------------------------ Mikro */

    /// <summary>Barkod Mikro'da kayıtlı mı: (var, stok kodu, ürün adı).</summary>
    public (bool Var, string StokKodu, string Ad) MikrodaAra(string barkod)
    {
        using var mikro = _vt.CiroBaglantisi();
        var k = mikro.QueryFirstOrDefault(@"
SELECT TOP 1 LTRIM(RTRIM(s.sto_kod)) AS kod, s.sto_isim AS ad
FROM BARKOD_TANIMLARI b WITH (NOLOCK)
INNER JOIN STOKLAR s WITH (NOLOCK) ON s.sto_kod = b.bar_stokkodu
WHERE b.bar_kodu = @barkod", new { barkod }, commandTimeout: 30);

        k ??= mikro.QueryFirstOrDefault(@"
SELECT TOP 1 LTRIM(RTRIM(sto_kod)) AS kod, sto_isim AS ad
FROM STOKLAR WITH (NOLOCK) WHERE sto_kod = @barkod", new { barkod }, commandTimeout: 30);

        return k is null ? (false, null, null) : (true, (string)k.kod, (string)k.ad);
    }

    /* ------------------------------------------------------------------ ölçüm */

    public sealed record OlcumSonucu(int Kod, string Hata, int Sira = 0, int UrunSayisi = 0, decimal Miktar = 0,
        string Odul = null, string Durum = null);

    /// <summary>
    /// 4. ay ölçümü. Kod: 200 tamam, 400 uygun değil, 404 yok, 409 başkası
    /// ölçtü / durum değişti, 502 Mikro'ya ulaşılamadı.
    /// </summary>
    public OlcumSonucu Olc(int id, string kim, string kaynak)
    {
        using var db = _vt.Baglanti();
        var o = db.QueryFirstOrDefault(@"
SELECT durum, barkod, stok_kodu AS stokKodu, olcum_bas AS bas, olcum_bit AS bit FROM KRY_KK_ONERI WHERE id = @id", new { id });
        if (o is null) return new(404, "Öneri bulunamadı.");
        if ((string)o.durum != "denemede" || o.bas is null) return new(409, "Öneri deneme sürecinde değil (ölçülmüş ya da durumu değişmiş).");
        if ((DateTime)o.bit >= DateTime.Today) return new(400, $"Ölçüm dönemi {((DateTime)o.bit):dd.MM.yyyy} tarihinde bitiyor.");

        string stok = o.stokKodu;
        decimal miktar;
        int sira, urunSayisi;
        try
        {
            if (string.IsNullOrWhiteSpace(stok))
            {
                var m = MikrodaAra((string)o.barkod);
                if (!m.Var) return new(400, "Ürün Mikro'da bulunamadı; stok kodunu karar ekranından giriniz.");
                stok = m.StokKodu;
            }

            using var mikro = _vt.CiroBaglantisi();
            var satis = mikro.Query<(string kod, decimal miktar)>(@"
SELECT LTRIM(RTRIM(h.sth_stok_kod)), SUM(CASE WHEN h.sth_tip = 1 THEN h.sth_miktar ELSE -h.sth_miktar END)
FROM STOK_HAREKETLERI h WITH (NOLOCK)
WHERE h.sth_tarih >= @bas AND h.sth_tarih < @son
  AND h.sth_cins IN (0,1)
  AND ((h.sth_tip = 1 AND h.sth_normal_iade = 0 AND h.sth_evraktip IN (1,4))
    OR (h.sth_tip = 0 AND h.sth_normal_iade = 1))
GROUP BY h.sth_stok_kod",
                new { bas = (DateTime)o.bas, son = ((DateTime)o.bit).AddDays(1) }, commandTimeout: 300).ToList();

            miktar = satis.Where(x => string.Equals(x.kod, stok.Trim(), StringComparison.OrdinalIgnoreCase)).Sum(x => x.miktar);
            sira = satis.Count(x => x.miktar > miktar) + 1;
            urunSayisi = satis.Count(x => x.miktar > 0);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kazan-Kazan ölçümü yapılamadı: {Id}", id);
            return new(502, "Mikro satış verisi alınamadı.");
        }

        var odul = miktar > 0 ? Kademeler(db).Where(x => sira <= x.Sinir).Select(x => x.Odul).FirstOrDefault() : null;
        var yeni = odul is null ? "odulYok" : "odullendi";

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var tx = db.BeginTransaction();

        /* Atomik: yalnızca hâlâ denemede ise yazılır (panel + gece görevi + satınalma çakışmasın) */
        var n = db.Execute(@"
UPDATE KRY_KK_ONERI
SET durum = @yeni, stok_kodu = @stok, olcum_miktar = @miktar, siralama = @sira, urun_sayisi = @urunSayisi,
    odul = @odul, odul_tarihi = CASE WHEN @odul IS NULL THEN NULL ELSE SYSDATETIME() END, guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'denemede'", new { id, yeni, stok, miktar, sira, urunSayisi, odul }, tx);

        if (n == 0)
        {
            tx.Rollback();
            return new(409, "Öneri bu arada ölçülmüş ya da durumu değişmiş.");
        }

        db.Execute(@"
INSERT INTO KRY_KK_HAREKET (oneri_id, eski_durum, yeni_durum, aciklama, yapan, kaynak)
VALUES (@id, N'denemede', @yeni, @aciklama, @kim, @kaynak)",
            new
            {
                id, yeni, kim, kaynak,
                aciklama = $"4. ay satış {miktar.ToString("N0", new CultureInfo("tr-TR"))} · sıra {sira}/{urunSayisi}" + (odul is null ? "" : $" · {odul}"),
            }, tx);

        tx.Commit();
        return new(200, null, sira, urunSayisi, miktar, odul, yeni);
    }
}

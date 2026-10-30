using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>Onay türleri</summary>
public static class OnayTuru
{
    public const string IseAlim = "İşe Alım";
    public const string NormKadro = "Norm Kadro";
    public const string Rotasyon = "Rotasyon";
}

/// <summary>Onay durumları</summary>
public static class OnayDurumu
{
    public const string Bekliyor = "Bekliyor";
    public const string Onaylandi = "Onaylandı";
    public const string Reddedildi = "Reddedildi";

    /// <summary>
    /// Onaylayan bir açıklama yazıp isteği geri gönderdi. Ret değildir:
    /// isteyen düzeltip yeniden onaya sunabilir.
    /// </summary>
    public const string YanitBekliyor = "Yanıt Bekliyor";
}

/// <summary>
/// Onay kayıtlarını yönetir.
///
/// İşe alım, norm kadro değişikliği ve rotasyon işlemleri yetkili onayına
/// gönderilir. Her kayıt türüyle birlikte saklanır; böylece onaylayan kişi
/// neyi onayladığını görür.
///
/// Norm kadro ve rotasyon işlemleri hemen uygulanır, onay bir teyit
/// adımıdır: reddedilirse eski değere geri dönülür. İşe alımda ise durum
/// onaylanana kadar "Onay Bekliyor" olarak kalır.
/// </summary>
public class OnayServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PatronBildirimServisi _patronBildirim;

    public OnayServisi(VeritabaniServisi vt, PatronBildirimServisi patronBildirim)
    {
        _vt = vt;
        _patronBildirim = patronBildirim;
    }

    /// <summary>
    /// Yeni bir onay kaydı oluşturur. Bütün onay türleri buradan geçtiği
    /// için Biçen360 patron bildirimi ("yeni onay talebi") de burada
    /// tetikleniyor (03.10.2026); yeni bir onay yolu eklenince bildirim
    /// kendiliğinden gelsin.
    /// </summary>
    public int Olustur(
        string tur,
        string baslik,
        string ozet,
        object veri,
        string isteyen,
        int? basvuruId = null,
        string subeKodu = null,
        string subeAdi = null)
    {
        int id;

        using (var db = _vt.Baglanti())
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_ONAY
    (tur, baslik, ozet, veri_json, basvuru_id, sube_kodu, sube_adi,
     durum, isteyen)
OUTPUT INSERTED.id
VALUES (@tur, @baslik, @ozet, @veri, @basvuruId, @subeKodu, @subeAdi,
        @durum, @isteyen)",
            new
            {
                tur,
                baslik,
                ozet = Kirp(ozet, 900),
                veri = veri is null ? null : JsonSerializer.Serialize(veri),
                basvuruId,
                subeKodu,
                subeAdi,
                durum = OnayDurumu.Bekliyor,
                isteyen
            });
        }

        /* Bildirim sıraya alınıyor, beklenmiyor; hata fırlatmaz */
        _patronBildirim?.OnayOlustu(tur, baslik);

        return id;
    }

    /// <summary>Aynı kayıt için bekleyen onayları kapatır (yeniden gönderim).</summary>
    public void EskiBekleyenleriKapat(string tur, int? basvuruId)
    {
        if (basvuruId is null) return;

        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_ONAY
SET durum = N'İptal', onay_tarihi = SYSDATETIME(),
    onay_notu = N'Yeni istek gönderildiği için iptal edildi'
WHERE tur = @tur AND basvuru_id = @basvuruId AND durum IN (@bekliyor, @yanit)",
            new { tur, basvuruId, bekliyor = OnayDurumu.Bekliyor, yanit = OnayDurumu.YanitBekliyor });
    }

    private static string Kirp(string metin, int uzunluk) =>
        string.IsNullOrEmpty(metin) || metin.Length <= uzunluk
            ? metin
            : metin[..uzunluk];
}

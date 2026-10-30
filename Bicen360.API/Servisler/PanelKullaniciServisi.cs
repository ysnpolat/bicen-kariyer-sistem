using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Panel kullanıcısının personel bağlantısı ve şube kilidi.
///
/// <para>
/// Portaldan açılan şube kullanıcısının depo kodu var: bu kullanıcı
/// portalda yalnızca kendi şubesinin verisini görüyor — arıza kayıtları,
/// envanter, fiyat sorgusu, rakip fiyat ve raporlar. Kilit sunucu
/// tarafında her okuma ucunda uygulanıyor; ekrandaki şube seçicisini
/// gizlemek yeterli değil, adres satırından başka şube istenebilir.
/// </para>
///
/// <para>
/// Sonuç kısa süre bellekte: her istekte kullanıcı tablosuna gitmek
/// gereksiz. Kullanıcı düzenlendiğinde bellek temizleniyor, kilit hemen
/// geçerli oluyor.
/// </para>
/// </summary>
public class PanelKullaniciServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PanelKullaniciServisi> _kayit;

    public PanelKullaniciServisi(VeritabaniServisi vt, ILogger<PanelKullaniciServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>Şube kilidi yoksa <c>SubeKodu</c> boş.</summary>
    public sealed record Bilgi(string Sicil, int? DepoNo, string SubeKodu, string SubeAdi)
    {
        public bool SubeKilitli => !string.IsNullOrWhiteSpace(SubeKodu);
    }

    private static readonly Bilgi Bos = new(null, null, null, null);

    private readonly System.Collections.Concurrent.ConcurrentDictionary<
        string, (Bilgi bilgi, DateTime zaman)> _bellek = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Panel kullanıcısının bilgisi; mobil jetonda boş döner.</summary>
    public Bilgi Getir(string kullaniciAdi)
    {
        if (string.IsNullOrWhiteSpace(kullaniciAdi) ||
            kullaniciAdi.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return Bos;

        if (_bellek.TryGetValue(kullaniciAdi, out var b) &&
            DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
            return b.bilgi;

        try
        {
            using var db = _vt.Baglanti();

            var satir = db.QueryFirstOrDefault(@"
SELECT K.sicil, K.depo_no AS depoNo, K.sube_kodu AS subeKodu, S.sube_adi AS subeAdi
FROM KRY_KULLANICILAR K
    LEFT JOIN B360_SUBE_DEPO S ON S.sube_kodu = K.sube_kodu
WHERE K.kullanici_adi = @kullaniciAdi", new { kullaniciAdi });

            var bilgi = satir is null
                ? Bos
                : new Bilgi(
                    ((string)satir.sicil)?.Trim(),
                    (int?)satir.depoNo,
                    ((string)satir.subeKodu)?.Trim(),
                    ((string)satir.subeAdi)?.Trim());

            _bellek[kullaniciAdi] = (bilgi, DateTime.UtcNow);

            return bilgi;
        }
        catch (Exception hata)
        {
            /* Sütunlar henüz yoksa (servis ilk kez açılıyor) kilit yok
               sayılıyor; kurulum bitince bir sonraki istekte okunur. */
            _kayit.LogWarning(hata, "Panel kullanıcısı okunamadı: {Kullanici}", kullaniciAdi);

            return Bos;
        }
    }

    /// <summary>Kullanıcı düzenlendiğinde çağrılıyor.</summary>
    public void Unut(string kullaniciAdi)
    {
        if (!string.IsNullOrWhiteSpace(kullaniciAdi))
            _bellek.TryRemove(kullaniciAdi, out _);
    }
}

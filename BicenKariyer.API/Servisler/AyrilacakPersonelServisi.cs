namespace BicenKariyer.API.Servisler;

/// <summary>
/// Çıkış tarihi ileri bir güne yazılmış personel.
///
/// <para>
/// İhbar süresi başlayan personelin Mikro'daki <c>per_cikis_tar</c> alanına
/// ileri bir tarih yazılıyor. Sistemin geri kalanı "çıkış tarihi dolu ise
/// ayrılmış" saydığı için bu kişiler listelerden anında düşüyordu; oysa
/// çıkış gününe kadar çalışıyorlar, norm kadroda yerleri duruyor ve yerine
/// alım planlanması gerekiyor. Bu servis aradaki kümeyi ayrıca veriyor.
/// </para>
///
/// <para>
/// Veri Mikro'ya yeniden sorulmuyor, <see cref="PersonelKaynagiServisi"/>
/// üzerinden okunuyor: o taraf kolon adlarının sürümden sürüme değişmesini
/// zaten karşılıyor ve sonucu önbellekliyor. İkinci bir sorgu, aynı işi iki
/// ayrı yerde doğru tutmak zorunda bırakırdı.
/// </para>
/// </summary>
public class AyrilacakPersonelServisi
{
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly ILogger<AyrilacakPersonelServisi> _kayit;

    public AyrilacakPersonelServisi(
        PersonelKaynagiServisi kaynak, ILogger<AyrilacakPersonelServisi> kayit)
    {
        _kaynak = kaynak;
        _kayit = kayit;
    }

    public sealed class Ayrilacak
    {
        public string PersonelKodu { get; set; }
        public string AdSoyad { get; set; }
        public string Birim { get; set; }
        public string Pozisyon { get; set; }
        public string Telefon { get; set; }
        public DateTime CikisTarihi { get; set; }
        public DateTime? GirisTarihi { get; set; }

        /// <summary>Çıkışa kalan gün. 1 ise çıkış yarın.</summary>
        public int KalanGun { get; set; }
    }

    /// <summary>
    /// Çıkış tarihi bugünden sonraya yazılmış personelin tamamı,
    /// çıkış tarihine göre sıralı.
    ///
    /// Mikro'ya ulaşılamazsa boş liste döner: norm raporunun tamamen
    /// çökmesindense bu bölümün boş görünmesi yeğdir.
    /// </summary>
    public List<Ayrilacak> Listele()
    {
        try
        {
            var bugun = DateTime.Today;

            return _kaynak.TumPersonelleriGetir()
                .Where(x => x.CikisTarihi.HasValue && x.CikisTarihi.Value.Date > bugun)
                .Select(x => new Ayrilacak
                {
                    PersonelKodu = (x.PersonelKodu ?? "").Trim(),
                    AdSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    Birim = x.IsGrubu,
                    Pozisyon = x.Pozisyon,
                    Telefon = x.Telefon,
                    CikisTarihi = x.CikisTarihi.Value.Date,
                    GirisTarihi = x.GirisTarihi,
                    KalanGun = (x.CikisTarihi.Value.Date - bugun).Days
                })
                .OrderBy(x => x.CikisTarihi)
                .ThenBy(x => x.AdSoyad)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ayrılacak personel listesi alınamadı");
            return new List<Ayrilacak>();
        }
    }

    /// <summary>
    /// Birim adına göre sayılar; norm raporu şube satırlarına bunu ekliyor.
    /// </summary>
    public Dictionary<string, int> BirimeGoreSayi()
    {
        var sonuc = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        foreach (var k in Listele())
        {
            var birim = (k.Birim ?? "").Trim();

            if (birim.Length == 0) continue;

            sonuc[birim] = sonuc.TryGetValue(birim, out var s) ? s + 1 : 1;
        }

        return sonuc;
    }
}

using System.Collections.Concurrent;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Ayrılan personel kart bağlantısının (herkese açık <c>KartLinkController</c>)
/// adres bazlı hız sınırı.
///
/// <para>
/// Kod başına sınır (on hatalı TC → kilit) tabloda tutuluyor ve sunucu
/// yeniden başlasa da sürüyor. Bu sınıf onun üstüne adres bazlı ikinci bir
/// katman: aynı adresten çok sayıda kod denenmesi (kod tahmini) ya da
/// farklı kodlarda TC denemesi. Sayaçlar bellekte; tek sunucu için yeterli.
/// Adres <see cref="IstemciAdresi"/> ile bulunuyor (X-Forwarded-For'a
/// yalnızca yerel vekilden gelince güveniliyor).
/// </para>
/// </summary>
public class KartLinkHizSiniri
{
    /// <summary>Bir adresten dakikada kabul edilen istek.</summary>
    private const int DakikalikIstek = 40;

    /// <summary>Bir adresten saatte kabul edilen başarısız deneme (yanlış TC, olmayan kod).</summary>
    private const int SaatlikHata = 20;

    /// <summary>Adresten bağımsız: saatte toplam başarısız deneme.</summary>
    private const int SaatlikGenelHata = 300;

    private readonly ConcurrentDictionary<string, List<DateTime>> _istekler = new();
    private readonly ConcurrentDictionary<string, List<DateTime>> _hatalar = new();
    private readonly List<DateTime> _genelHatalar = new();
    private readonly object _genelKilit = new();

    private DateTime _sonTemizlik = DateTime.UtcNow;

    /// <summary>İstek kabul edilir mi; edilmezse gösterilecek sebep.</summary>
    public bool Kabul(string adres, out string sebep)
    {
        sebep = "";
        Temizle();

        var simdi = DateTime.UtcNow;
        var anahtar = string.IsNullOrWhiteSpace(adres) ? "?" : adres;

        lock (_genelKilit)
        {
            _genelHatalar.RemoveAll(x => simdi - x > TimeSpan.FromHours(1));

            if (_genelHatalar.Count >= SaatlikGenelHata)
            {
                sebep = "Sistem şu anda yoğun. Lütfen bir süre sonra tekrar deneyiniz.";
                return false;
            }
        }

        if (_hatalar.TryGetValue(anahtar, out var hatalar))
            lock (hatalar)
            {
                hatalar.RemoveAll(x => simdi - x > TimeSpan.FromHours(1));

                if (hatalar.Count >= SaatlikHata)
                {
                    sebep = "Çok fazla hatalı deneme yapıldı. Lütfen bir saat sonra tekrar deneyiniz.";
                    return false;
                }
            }

        var istekler = _istekler.GetOrAdd(anahtar, _ => new List<DateTime>());

        lock (istekler)
        {
            istekler.RemoveAll(x => simdi - x > TimeSpan.FromMinutes(1));

            if (istekler.Count >= DakikalikIstek)
            {
                sebep = "Çok sık istek gönderildi. Lütfen bir dakika sonra tekrar deneyiniz.";
                return false;
            }

            istekler.Add(simdi);
        }

        return true;
    }

    /// <summary>Başarısız denemeyi (yanlış TC, olmayan kod) sayar.</summary>
    public void Hata(string adres)
    {
        var simdi = DateTime.UtcNow;
        var anahtar = string.IsNullOrWhiteSpace(adres) ? "?" : adres;

        lock (_genelKilit) _genelHatalar.Add(simdi);

        var hatalar = _hatalar.GetOrAdd(anahtar, _ => new List<DateTime>());

        lock (hatalar) hatalar.Add(simdi);
    }

    private void Temizle()
    {
        if (DateTime.UtcNow - _sonTemizlik < TimeSpan.FromMinutes(15)) return;

        _sonTemizlik = DateTime.UtcNow;

        var sinir = DateTime.UtcNow.AddHours(-1);

        foreach (var sozluk in new[] { _istekler, _hatalar })
            foreach (var (adres, liste) in sozluk.ToArray())
            {
                lock (liste) liste.RemoveAll(x => x < sinir);

                if (liste.Count == 0) sozluk.TryRemove(adres, out _);
            }
    }
}

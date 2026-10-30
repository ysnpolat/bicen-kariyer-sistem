using System.Collections.Concurrent;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Aday formu için hız sınırı.
///
/// Form herkese açık olmak zorunda; bu da otomatik araçların kısa sürede
/// yüzlerce sahte başvuru bırakabileceği anlamına gelir. Bu servis aynı
/// adresten gelen istekleri sayar ve sınırı aşanları reddeder.
///
/// Sayaçlar bellekte tutulur: uygulama yeniden başladığında sıfırlanır.
/// Tek sunucu için yeterlidir; birden çok sunucuya dağıtılırsa ortak bir
/// depoya (Redis gibi) taşınması gerekir.
/// </summary>
public class HizSiniriServisi
{
    /// <summary>Bir adresten saatte kabul edilen en fazla başvuru</summary>
    private const int SaatlikSinir = 5;

    /// <summary>Bir adresten günde kabul edilen en fazla başvuru</summary>
    private const int GunlukSinir = 15;

    /// <summary>Aynı kimlik numarasıyla tekrar başvuru için beklenmesi gereken süre</summary>
    private static readonly TimeSpan KimlikBeklemesi = TimeSpan.FromHours(6);

    /// <summary>
    /// Adresten bağımsız genel sınır. Saldırgan adres değiştirse bile
    /// dakikada bu sayıdan fazla başvuru kabul edilmez.
    /// Gerçek kullanımda bir mağazadan aynı anda bu kadar başvuru gelmez.
    /// </summary>
    private const int DakikalikGenelSinir = 10;

    /// <summary>Bir saatte kabul edilen toplam başvuru</summary>
    private const int SaatlikGenelSinir = 60;

    private readonly ConcurrentDictionary<string, List<DateTime>> _adresler = new();
    private readonly ConcurrentDictionary<string, DateTime> _kimlikler = new();

    /// <summary>Tüm başvuruların zamanı; genel sınır için</summary>
    private readonly List<DateTime> _genelKayitlar = new();
    private readonly object _genelKilit = new();

    private DateTime _sonTemizlik = DateTime.UtcNow;

    /// <summary>
    /// İsteğin kabul edilip edilmeyeceğini söyler.
    /// Reddedilirse sebebi <paramref name="sebep"/> ile döner.
    /// </summary>
    public bool KabulEdilir(string adres, string kimlikNo, out string sebep)
    {
        sebep = "";
        Temizle();

        var simdi = DateTime.UtcNow;

        /* Genel sınır: adresten bağımsızdır. Saldırgan sahte adres kullansa
           bile toplam başvuru hızı bu eşiği aşamaz. */
        lock (_genelKilit)
        {
            _genelKayitlar.RemoveAll(x => simdi - x > TimeSpan.FromHours(1));

            var sonDakika = _genelKayitlar.Count(x => simdi - x < TimeSpan.FromMinutes(1));

            if (sonDakika >= DakikalikGenelSinir)
            {
                sebep = "Sistem şu anda yoğun. Lütfen birkaç dakika sonra "
                      + "tekrar deneyiniz.";
                return false;
            }

            if (_genelKayitlar.Count >= SaatlikGenelSinir)
            {
                sebep = "Bu saat için başvuru sınırına ulaşıldı. "
                      + "Lütfen daha sonra tekrar deneyiniz.";
                return false;
            }
        }

        /* Aynı kişinin arka arkaya gönderim yapması engellenir */
        if (!string.IsNullOrWhiteSpace(kimlikNo))
        {
            var anahtar = kimlikNo.Trim();

            if (_kimlikler.TryGetValue(anahtar, out var sonGonderim) &&
                simdi - sonGonderim < KimlikBeklemesi)
            {
                sebep = "Bu kimlik numarasıyla kısa süre önce başvuru yapılmış. "
                      + "Başvurunuz sistemimize ulaştı; tekrar göndermenize gerek yok.";
                return false;
            }
        }

        if (string.IsNullOrWhiteSpace(adres)) return true;

        var kayitlar = _adresler.GetOrAdd(adres, _ => new List<DateTime>());

        lock (kayitlar)
        {
            kayitlar.RemoveAll(x => simdi - x > TimeSpan.FromDays(1));

            var sonSaat = kayitlar.Count(x => simdi - x < TimeSpan.FromHours(1));

            if (sonSaat >= SaatlikSinir)
            {
                sebep = "Kısa sürede çok fazla başvuru gönderildi. "
                      + "Lütfen bir süre sonra tekrar deneyiniz.";
                return false;
            }

            if (kayitlar.Count >= GunlukSinir)
            {
                sebep = "Bugün için başvuru sınırına ulaşıldı. "
                      + "Lütfen yarın tekrar deneyiniz.";
                return false;
            }
        }

        return true;
    }

    /// <summary>Kabul edilen bir başvuruyu sayaçlara işler.</summary>
    public void Kaydet(string adres, string kimlikNo)
    {
        var simdi = DateTime.UtcNow;

        lock (_genelKilit) _genelKayitlar.Add(simdi);

        if (!string.IsNullOrWhiteSpace(kimlikNo))
            _kimlikler[kimlikNo.Trim()] = simdi;

        if (string.IsNullOrWhiteSpace(adres)) return;

        var kayitlar = _adresler.GetOrAdd(adres, _ => new List<DateTime>());

        lock (kayitlar) kayitlar.Add(simdi);
    }

    /* -------------------------------------------------- başarısız istek sınırı */

    private readonly List<DateTime> _basarisizlar = new();
    private readonly object _basarisizKilit = new();

    /// <summary>Bir dakikada kabul edilen en fazla başarısız başvuru denemesi</summary>
    private const int DakikalikBasarisizSinir = 30;

    /// <summary>
    /// Reddedilen başvuruları sayar.
    ///
    /// Hız sınırı yalnızca kabul edilen başvuruları saydığı için, sürekli
    /// eksik veri gönderen bir saldırgan sınıra hiç değmiyordu. Bu sayaç
    /// reddedilenleri de izler; eşik aşılınca form kısa süreli kapanır.
    ///
    /// Gerçek adaylar bu sayıya ulaşmaz: bir kişinin dakikada otuz kez
    /// hatalı form göndermesi beklenmez.
    /// </summary>
    public void BasarisizKaydet()
    {
        var simdi = DateTime.UtcNow;

        lock (_basarisizKilit)
        {
            _basarisizlar.RemoveAll(x => simdi - x > TimeSpan.FromMinutes(5));
            _basarisizlar.Add(simdi);
        }
    }

    /// <summary>Son dakikada eşik aşıldı mı?</summary>
    public bool BasarisizYogunlugu(out string sebep)
    {
        sebep = "";

        var simdi = DateTime.UtcNow;

        lock (_basarisizKilit)
        {
            var sonDakika = _basarisizlar.Count(x => simdi - x < TimeSpan.FromMinutes(1));

            if (sonDakika >= DakikalikBasarisizSinir)
            {
                sebep = "Sistem şu anda yoğun. Lütfen birkaç dakika sonra "
                      + "tekrar deneyiniz.";
                return true;
            }
        }

        return false;
    }

    /* ------------------------------------------------------ sorgulama sınırı */

    private readonly ConcurrentDictionary<string, List<DateTime>> _sorgular = new();

    /// <summary>Bir adresten saatte kabul edilen sorgulama denemesi</summary>
    private const int SorgulamaSiniri = 10;

    /// <summary>
    /// Başvuru sorgulama denemesi kabul edilir mi?
    ///
    /// Sorgulama kimlik numarası ve telefonla yapıldığı için sınırsız
    /// bırakılırsa deneme yanılmayla başkalarının başvurusu görülebilir.
    /// </summary>
    public bool SorgulamaKabulEdilir(string adres, out string sebep)
    {
        sebep = "";

        if (string.IsNullOrWhiteSpace(adres)) return true;

        var simdi = DateTime.UtcNow;
        var kayitlar = _sorgular.GetOrAdd(adres, _ => new List<DateTime>());

        lock (kayitlar)
        {
            kayitlar.RemoveAll(x => simdi - x > TimeSpan.FromHours(1));

            if (kayitlar.Count >= SorgulamaSiniri)
            {
                sebep = "Çok fazla sorgulama yapıldı. "
                      + "Lütfen bir süre sonra tekrar deneyiniz.";
                return false;
            }

            kayitlar.Add(simdi);
        }

        return true;
    }

    /// <summary>Eski kayıtları temizler; bellekte sınırsız birikmesini önler.</summary>
    private void Temizle()
    {
        if (DateTime.UtcNow - _sonTemizlik < TimeSpan.FromMinutes(30)) return;

        _sonTemizlik = DateTime.UtcNow;
        var sinir = DateTime.UtcNow.AddDays(-1);

        foreach (var (adres, kayitlar) in _adresler.ToArray())
        {
            lock (kayitlar) kayitlar.RemoveAll(x => x < sinir);

            if (kayitlar.Count == 0) _adresler.TryRemove(adres, out _);
        }

        foreach (var (kimlik, zaman) in _kimlikler.ToArray())
            if (zaman < sinir) _kimlikler.TryRemove(kimlik, out _);

        foreach (var (adres, kayitlar) in _sorgular.ToArray())
        {
            lock (kayitlar) kayitlar.RemoveAll(x => x < sinir);

            if (kayitlar.Count == 0) _sorgular.TryRemove(adres, out _);
        }
    }
}

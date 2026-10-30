using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Personel Talepleri › uzman süzgeci (07.10.2026).
///
/// <para>
/// Başvurular sayfasındakiyle aynı kural: İK uzmanı ve İK yöneticisi
/// önce kendi şubelerini görür (Yönetim › Kullanıcılar'daki şube hakkı);
/// başlıktaki "Diğer uzmanlar" seçicisinden uzman seçerse onların
/// şubeleri de eklenir. Admin ve GMY seçim yapmazsa hepsini görür.
/// Kullanıcının şubesi tanımlı değilse süzme yapılmaz (hiçbir şeyi
/// göremez hâle gelmesin).
/// </para>
///
/// <para>
/// Taleplerde şube kodu değil şube adı (Mikro) duruyor; kullanıcıdaki
/// şube kodları Birimler tanımından ada çevrilip ad benzerliğiyle
/// eşleniyor (Avcılar-1 / Avcılar-2 ayrımı korunuyor).
/// </para>
/// </summary>
public sealed class UzmanKapsami
{
    private readonly List<string> _adlar;
    private readonly Dictionary<string, bool> _onbellek = new(StringComparer.OrdinalIgnoreCase);

    private readonly List<string> _anahtarlar;

    private UzmanKapsami(List<string> adlar)
    {
        _adlar = adlar;
        _anahtarlar = adlar.Select(PersonelKaynagiServisi.BirimAnahtari).Distinct().ToList();
    }

    /// <summary>Kapsamdaki şube adları (ekranda göstermek için)</summary>
    public IReadOnlyList<string> Adlar => _adlar;

    /// <summary>Süzme yoksa null</summary>
    /// <param name="kendisi">false: İK uzmanı seçim yapmazsa hepsini görür
    /// (avans, 09.10.2026); süzme yalnızca başlıktan uzman seçilince</param>
    public static UzmanKapsami Olustur(IDbConnection db, AyarServisi ayar, string rol, string kullanici, string uzman,
        bool kendisi = true)
    {
        var kodlar = (uzman ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToList();

        var temel = Roller.Temel(rol);

        if (kendisi && (temel is Roller.IK or Roller.IKYoneticisi)
            && !string.IsNullOrWhiteSpace(kullanici)
            && !kodlar.Contains(kullanici, StringComparer.OrdinalIgnoreCase))
            kodlar.Add(kullanici);

        if (kodlar.Count == 0) return null;

        List<string> tanimlar;

        try
        {
            tanimlar = db.Query<string>(
                "SELECT subeler FROM KRY_KULLANICILAR WHERE kullanici_adi IN @k", new { k = kodlar }).ToList();
        }
        catch
        {
            return null;
        }

        var girdiler = tanimlar
            .SelectMany(x => (x ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (girdiler.Count == 0) return null;

        List<Sube> birimler;
        try { birimler = ayar.FormOku().Subeler ?? new List<Sube>(); }
        catch { birimler = new List<Sube>(); }

        /* Kod → ad; birimlerde yoksa yazılanın kendisi ad sayılır */
        var adlar = girdiler
            .Select(g => birimler.FirstOrDefault(b =>
                             string.Equals((b.Kod ?? "").Trim(), g, StringComparison.OrdinalIgnoreCase)
                             || string.Equals((b.Ad ?? "").Trim(), g, StringComparison.OrdinalIgnoreCase)) is { } b
                ? (string.IsNullOrWhiteSpace(b.Ad) ? b.Kod : b.Ad).Trim()
                : g)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new UzmanKapsami(adlar);
    }

    /// <summary>Talebin şubesi kapsamda mı</summary>
    public bool Icinde(string subeAdi)
    {
        var s = (subeAdi ?? "").Trim();
        if (s.Length == 0) return false;

        if (_onbellek.TryGetValue(s, out var v)) return v;

        /* Kullanıcıdaki şube adı "Mehterçeşme-2 Şubesi", talepteki Mikro
           adı "MEHTERÇEŞME-2": ham hâlleri eşleşmiyordu (09.10.2026, uzman
           seçilince avansların çoğu kayboluyordu). Ekler atılıp büyük
           harfe çevrilmiş anahtarlar karşılaştırılıyor. */
        var sa = PersonelKaynagiServisi.BirimAnahtari(s);

        v = _anahtarlar.Any(a => a.Length > 0 && (a == sa || PersonelKaynagiServisi.Benziyor(a, sa)))
            || _adlar.Any(a => string.Equals(a, s, StringComparison.OrdinalIgnoreCase)
                               || PersonelKaynagiServisi.Benziyor(a, s));

        _onbellek[s] = v;
        return v;
    }

    /// <summary>Ekrana: süzme var mı, hangi şubeler</summary>
    public static object Ozet(UzmanKapsami k) =>
        k is null ? new { aktif = false, subeler = Array.Empty<string>() } : new { aktif = true, subeler = k._adlar.ToArray() };
}

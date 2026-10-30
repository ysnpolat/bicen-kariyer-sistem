using System.Security.Claims;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Arıza kayıtlarına kim erişir, hangi kayıtları görür ve yönetir.
///
/// <para>
/// ArizaController'ın içindeydi; servis formu da aynı kurala ihtiyaç
/// duyduğu için buraya alındı (08.10.2026). Servis formu yalnızca panel
/// sayfa yetkisine bakıyordu: Biçen360'tan gelen temsilci formu açamıyor,
/// "Çözüldü" ve "Kapandı" form zorunlu olduğu için kaydı da
/// kapatamıyordu ("Bu bölüme erişim yetkiniz yok").
/// </para>
/// </summary>
public sealed class ArizaErisimi
{
    /// <summary>Kimin hangi kayıtları göreceği; <see cref="Kapsam"/> üretir.</summary>
    public sealed record Gorunurluk(
        bool Hepsi,
        IReadOnlyList<int> Departmanlar,
        IReadOnlyList<string> Subeler,
        string Sicil);

    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly KapsamServisi _kapsam;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly IConfiguration _yapilandirma;
    private readonly RaporKapsami _rapor;

    public ArizaErisimi(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        PersonelServisi personel,
        KapsamServisi kapsam,
        PanelKullaniciServisi panelKullanici,
        IConfiguration yapilandirma,
        RaporKapsami rapor)
    {
        _rapor = rapor;
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _kapsam = kapsam;
        _panelKullanici = panelKullanici;
        _yapilandirma = yapilandirma;
    }

    private static string Ad(ClaimsPrincipal u) => u?.Identity?.Name ?? "";

    /// <summary>Biçen360 (mobil) jetonu mu</summary>
    public static bool MobilMi(ClaimsPrincipal u) =>
        Ad(u).StartsWith("personel:", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Mobil jetondaki sicil. Jeton "personel:14721|cihaz-abc" biçiminde;
    /// istemciden gelen değere güvenilmez.
    /// </summary>
    public static string SicilAl(ClaimsPrincipal u)
    {
        if (!MobilMi(u)) return null;

        var govde = Ad(u)["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? govde : govde[..i];
    }

    public PersonelServisi.Bilgi Kisi(ClaimsPrincipal u) =>
        MobilMi(u) ? _personel.Getir(SicilAl(u)) : null;

    /// <summary>İşlemi yapanın görünen adı</summary>
    public string YapanAdi(ClaimsPrincipal u) =>
        Kisi(u)?.AdSoyad ?? u?.FindFirstValue("adSoyad") ?? Ad(u);

    /// <summary>Kaydı yazan: mobilde sicil, panelde kullanıcı adı</summary>
    public static string Yapan(ClaimsPrincipal u) => MobilMi(u) ? SicilAl(u) : Ad(u);

    /// <summary>Arıza modülü bu kişiye açık mı</summary>
    public bool Yetkili(ClaimsPrincipal u) =>
        MobilMi(u)
            ? _yetki.Modulleri(SicilAl(u), Kisi(u)?.Pozisyon ?? "").Contains("ariza")
            : _yetki.SayfaAcik(Ad(u), u?.FindFirstValue(ClaimTypes.Role) ?? "", "ariza");

    /// <summary>Panelden gelen ve arıza sayfası açık kullanıcı (raporlar için)</summary>
    public bool PanelYetkili(ClaimsPrincipal u) => !MobilMi(u) && Yetkili(u);

    /// <summary>
    /// Kimin hangi kayıtları göreceği.
    ///
    /// <list type="bullet">
    /// <item>Temsilci — departmanına açılan her kaydı görür ve yönetir</item>
    /// <item>Mağaza yöneticisi — kendi mağazasındaki kayıtları görür</item>
    /// <item>Diğer personel — yalnızca kendi açtığı kayıtları görür</item>
    /// </list>
    ///
    /// Panelden gelen kullanıcı: şube kullanıcısı kendi şubesini, diğerleri
    /// temsilcisi olduğu departmanları; Admin ve "Tüm departmanlar" hepsini.
    /// </summary>
    public Gorunurluk Kapsam(ClaimsPrincipal u)
    {
        if (!MobilMi(u))
        {
            /* Şube kullanıcısı (portaldan depo koduyla açılmış) yalnızca
               kendi şubesinin kayıtlarını ve kendi açtıklarını görüyor.
               Diğer panel kullanıcıları eskisi gibi hepsini. */
            var kilit = _panelKullanici.Getir(Ad(u));

            if (kilit.SubeKilitli)
                return new Gorunurluk(false, Array.Empty<int>(),
                    new List<string> { kilit.SubeKodu }, Ad(u));

            /* Departman kapsamı (08.10.2026): panel kullanıcısı yalnızca
               sicilinin temsilci olduğu departmanların kayıtlarını ve kendi
               açtıklarını görür. Admin ve Yetkiler'de "Tüm departmanlar"
               işaretli hesaplar hepsini. Raporlarla aynı kural. */
            var r = _rapor.Panel(Ad(u), u?.FindFirstValue(ClaimTypes.Role) ?? "");

            if (r.TumunuGorur)
                return new Gorunurluk(true, Array.Empty<int>(), Array.Empty<string>(), null);

            return new Gorunurluk(false, r.Departmanlar, Array.Empty<string>(), Ad(u));
        }

        var kisi = Kisi(u);
        var sicil = SicilAl(u);

        using var db = _vt.Baglanti();

        var departmanlar = db.Query<int>(@"
SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI WHERE personel_kodu = @sicil",
            new { sicil }).ToList();

        /* Mağaza yöneticisi ünvanları ayarda: ünvan adları zamanla
           değişiyor ve her değişiklikte yeniden derlemek gerekmemeli. */
        var magazaPozisyonlari = _yapilandirma
            .GetSection("Ariza:MagazaPozisyonlari").Get<string[]>() ?? Array.Empty<string>();

        /* Karşılaştırma ortak anahtarla: tam metin eşitliği, ünvandaki tek
           bir boşluk ya da noktalama yüzünden tutmuyordu. */
        var magazaYoneticisi = magazaPozisyonlari.Any(x =>
            YetkiServisi.Anahtar(x) == YetkiServisi.Anahtar(kisi?.Pozisyon));

        /* "Arıza · yönetici" yetkisi departman ve şube sınırını kaldırıyor */
        if (_yetki.Modulleri(sicil, kisi?.Pozisyon ?? "").Contains("ariza-yonetici"))
            return new Gorunurluk(true, Array.Empty<int>(), Array.Empty<string>(), sicil);

        /* Grup ayarı varsa o geçerli: Yetkiler → Gruplar → Arıza kayıtları.
           Temsilcisi olduğu departmanların kayıtları da ekleniyor. */
        var ayar = _kapsam.KisininAyari(kisi?.Pozisyon);

        if (!string.IsNullOrWhiteSpace(ayar?.ArizaKapsami))
        {
            var c = _kapsam.Coz(ayar.ArizaKapsami, ayar, sicil, kisi?.Sube);

            if (c.Hepsi)
                return new Gorunurluk(true, Array.Empty<int>(), Array.Empty<string>(), sicil);

            return new Gorunurluk(false,
                departmanlar.Concat(c.Departmanlar).Distinct().ToList(),
                c.Subeler, sicil);
        }

        IReadOnlyList<string> kendiSubesi =
            magazaYoneticisi && !string.IsNullOrWhiteSpace(kisi?.Sube)
                ? new List<string> { kisi.Sube }
                : new List<string>();

        return new Gorunurluk(false, departmanlar, kendiSubesi, sicil);
    }

    /// <summary>
    /// Kaydı yönetebilir mi (durum, servis formu). Görmekten dar: yalnızca
    /// kaydın departmanının temsilcisi ya da tüm kayıtları yöneten.
    /// </summary>
    /// <summary>
    /// Kaydı görebilir mi: kapsamındaki departman, şube ya da kendi
    /// açtığı kayıt (13.10.2026; servis formu için).
    /// </summary>
    public bool Gorur(ClaimsPrincipal u, int? departmanId, string sube, string acan)
    {
        var k = Kapsam(u);

        return k.Hepsi
               || (departmanId is int d && k.Departmanlar.Contains(d))
               || (!string.IsNullOrWhiteSpace(sube) && k.Subeler.Any(x => string.Equals(x?.Trim(), sube.Trim(), StringComparison.OrdinalIgnoreCase)))
               || (!string.IsNullOrWhiteSpace(acan) && string.Equals(acan.Trim(), k.Sicil?.Trim(), StringComparison.OrdinalIgnoreCase));
    }

    public bool Yonetir(ClaimsPrincipal u, int? departmanId)
    {
        /* Portal rolünde arıza yalnızca "görür" ise (13.10.2026): rolün
           departmanlarını görür ama yönetmez; temsilcisi olduğu
           departmanların kaydını yönetmeye devam eder. */
        if (!MobilMi(u))
        {
            var rol = u?.FindFirstValue(ClaimTypes.Role) ?? "";

            if (!_yetki.SayfaYonetir(Ad(u), rol, "ariza"))
                return departmanId is int td && _rapor.PanelTemsilcilikleri(Ad(u)).Contains(td);
        }

        var k = Kapsam(u);
        return k.Hepsi || (departmanId is int d && k.Departmanlar.Contains(d));
    }
}

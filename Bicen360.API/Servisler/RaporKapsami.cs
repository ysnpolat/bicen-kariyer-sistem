using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Rapor kapsamı.
///
/// <para>
/// Kimin hangi veriyi göreceği ayrı bir yetki satırıyla değil kişinin
/// görevleriyle belirleniyor. İkinci bir "tümünü gör" yetkisi, aynı
/// bilgiyi iki yerde tutmak ve ikisini tutarlı tutmak demekti; departman
/// temsilciliği zaten tanımlı ve her yerde kullanılıyor.
/// </para>
///
/// <para>
/// Kural şu: yönetici rolündeki kullanıcı bütün departmanları görüyor.
/// Bir ya da daha çok departmanın temsilcisi olan kişi o departmanları
/// görüyor. İkisi de değilse yalnızca kendi şubesinin fiyat ve künye
/// verilerini görüyor — arıza ve maliyet boş kalıyor, çünkü o kayıtlar
/// departmana ait.
/// </para>
/// </summary>
public class RaporKapsami
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;

    public RaporKapsami(VeritabaniServisi vt, YetkiServisi yetki)
    {
        _vt = vt;
        _yetki = yetki;
    }

    /// <summary>
    /// Bütün departmanları görür mü: Admin ya da Yetkiler'de "Tüm
    /// departmanlar" işaretli hesap (08.10.2026). Hangi hesapların göreceği
    /// kodda değil, yetki ekranında belirleniyor.
    /// </summary>
    public bool TumDepartmanlar(string kullanici, string rol) =>
        YetkiServisi.Adminmi(rol) || _yetki.SayfaAcik(kullanici, rol, "tum-departmanlar");

    /// <summary>Bir kişinin görebileceği kapsam.</summary>
    public record Kapsam(
        bool TumunuGorur,
        List<int> Departmanlar,
        List<string> DepartmanAdlari,
        string Sube);

    /// <summary>
    /// Panel kullanıcısı için kapsam.
    ///
    /// Yönetici rolü bütün departmanları görüyor; bu rol zaten yetki
    /// sisteminin kendi tanıdığı üst seviye ve ayrıca tanımlanması
    /// gereken bir şey değil.
    /// </summary>
    public Kapsam Panel(string kullanici, string rol)
    {
        using var db = _vt.Baglanti();

        /* Portaldan açılmış kullanıcının personel bağlantısı ve şube
           kilidi. Şube kullanıcısı rolü ne olursa olsun yalnızca kendi
           şubesini görüyor; temsilcilik sicille bağlanıyor. */
        var baglanti = db.QueryFirstOrDefault(@"
SELECT sicil, sube_kodu AS subeKodu FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici",
            new { kullanici });

        var sicil = ((string)baglanti?.sicil)?.Trim();
        var sube = ((string)baglanti?.subeKodu)?.Trim();

        if (!string.IsNullOrWhiteSpace(sube))
        {
            var d = Temsilcilikler(db, sicil ?? kullanici);

            return new Kapsam(false, d, Adlar(db, d), sube);
        }

        /* Statik metot: tür adıyla çağrılıyor, nesne üzerinden değil. */
        if (TumDepartmanlar(kullanici, rol))
            return new Kapsam(true, new List<int>(), Adlar(db, null), null);

        var kendi = Temsilcilikler(db, string.IsNullOrWhiteSpace(sicil) ? kullanici : sicil);

        /* Portal rolünün departmanları (13.10.2026): temsilciliklere
           ekleniyor; kişi hem rolünden hem temsilcisi olduğu
           departmanlardan gelen kayıtları görür. */
        var portal = _yetki.PortalRolu(kullanici);

        if (portal is not null)
            kendi = kendi.Concat(portal.Departmanlar).Distinct().ToList();

        return new Kapsam(false, kendi, Adlar(db, kendi), null);
    }

    /// <summary>
    /// Yalnızca temsilci olunan departmanlar (rolden gelenler hariç).
    /// Arızada "yönetir" yetkisi olmayan rolün, temsilcisi olduğu
    /// departmanın kaydını yine yönetebilmesi için.
    /// </summary>
    public List<int> PanelTemsilcilikleri(string kullanici)
    {
        using var db = _vt.Baglanti();

        var sicil = db.ExecuteScalar<string>(
            "SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici", new { kullanici })?.Trim();

        return Temsilcilikler(db, string.IsNullOrWhiteSpace(sicil) ? kullanici : sicil);
    }

    /// <summary>
    /// Tutarları (alış bedeli, tamir, servis formu) görür mü: şube
    /// kullanıcısı görmez; portal rolü varsa rolün "maliyet" ayarı.
    /// </summary>
    public bool MaliyetGorur(string kullanici, string rol)
    {
        if (YetkiServisi.Adminmi(rol)) return true;
        if (string.IsNullOrWhiteSpace(kullanici) || kullanici.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return false;

        using var db = _vt.Baglanti();

        var sube = db.ExecuteScalar<string>(
            "SELECT sube_kodu FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici", new { kullanici });

        if (!string.IsNullOrWhiteSpace(sube)) return false;

        return _yetki.PortalRolu(kullanici)?.Maliyet ?? true;
    }

    /// <summary>
    /// Raporlar sayfasında görünen sekmeler (13.10.2026). Rakip fiyat ve
    /// künye raporları kaldırıldı (kendi sayfalarında). Rolü olan kullanıcı
    /// rolde seçilenleri; olmayan, sayfası açık olan raporları görür.
    /// Servis maliyeti tutar yetkisi ister.
    /// </summary>
    public List<string> Raporlari(string kullanici, string rol)
    {
        if (!_yetki.SayfaAcik(kullanici, rol, "rapor")) return new List<string>();

        var maliyet = MaliyetGorur(kullanici, rol);
        var portal = YetkiServisi.Adminmi(rol) ? null : _yetki.PortalRolu(kullanici);

        return RolServisi.Raporlar
            .Where(r => portal is null || portal.RaporKodlari.Contains(r.Kod))
            .Where(r => _yetki.SayfaAcik(kullanici, rol, r.Sayfa))
            .Where(r => !r.Maliyet || maliyet)
            .Select(r => r.Kod)
            .ToList();
    }

    /// <summary>
    /// Mobil personel için kapsam.
    ///
    /// <paramref name="yoneticiYetkisi"/> yetki ekranındaki "Yönetici
    /// olarak gör" satırından geliyor; verilen kişi bütün departmanları
    /// görüyor. Vermeyen kişi yalnızca temsilcisi olduğu departmanları
    /// görüyor, mağaza personeli de kendi şubesini.
    /// </summary>
    public Kapsam Mobil(string sicil, string sube, bool yoneticiYetkisi = false)
    {
        using var db = _vt.Baglanti();

        if (yoneticiYetkisi)
            return new Kapsam(true, new List<int>(), Adlar(db, null), sube);

        var kendi = Temsilcilikler(db, sicil);

        /* Bütün aktif departmanların temsilcisi olan kişi fiilen hepsini
           görüyor; ayrıca bir işaret aramak gereksiz. */
        var toplam = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_DEPARTMAN WHERE aktif = 1");

        var hepsi = toplam > 0 && kendi.Count >= toplam;

        return new Kapsam(hepsi, hepsi ? new List<int>() : kendi,
                          Adlar(db, hepsi ? null : kendi), sube);
    }

    /* ====================================================================== */

    private static List<int> Temsilcilikler(System.Data.IDbConnection db, string kod) =>
        string.IsNullOrWhiteSpace(kod)
            ? new List<int>()
            : db.Query<int>(@"
SELECT departman_id FROM B360_DEPARTMAN_TEMSILCI WHERE personel_kodu = @kod",
                new { kod }).ToList();

    /// <summary>Departman adları; kimlik listesi boşsa tümü.</summary>
    private static List<string> Adlar(System.Data.IDbConnection db, List<int> kimlikler)
    {
        if (kimlikler is null)
            return db.Query<string>(
                "SELECT ad FROM B360_DEPARTMAN WHERE aktif = 1 ORDER BY sira, ad").ToList();

        if (kimlikler.Count == 0) return new List<string>();

        return db.Query<string>(
            "SELECT ad FROM B360_DEPARTMAN WHERE id IN @kimlikler ORDER BY ad",
            new { kimlikler }).ToList();
    }
}

using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Portal rolleri (13.10.2026).
///
/// <para>
/// Yönetim › Roller'de tanımlanan rol; hangi panel sayfalarının açık
/// olduğunu, hangi departmanların kayıtlarının görüneceğini, Raporlar'da
/// hangi sekmelerin çıkacağını ve tutarların görünüp görünmeyeceğini
/// belirler.
/// </para>
///
/// <para>
/// Kullanıcıya atama <c>B360_KULLANICI_ROL</c>'de tutuluyor;
/// <c>KRY_KULLANICILAR.rol</c> sütununa dokunulmuyor. O sütun Kariyer
/// panelinin rolü: portal rolü oraya yazılsaydı aynı kişinin İK
/// panelindeki yetkisi bozulurdu. Portal rolü atanmamış kullanıcı eskisi
/// gibi çalışır (rol satırları ve departman temsilciliği).
/// </para>
///
/// <para>
/// Roller ve atamalar küçük; hepsi bellekte tutulup her 30 saniyede bir
/// tazeleniyor. Her istekte yapılan sayfa denetimi veritabanına
/// gitmesin. Yazınca önbellek hemen sıfırlanıyor.
/// </para>
/// </summary>
public class RolServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<RolServisi> _kayit;

    public RolServisi(VeritabaniServisi vt, ILogger<RolServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>Sayfa seviyesi: 1 görür, 2 yönetir / düzenler.</summary>
    public const int Gorur = 1, Yonetir = 2;

    /// <summary>"Yönetir" ayrımı olan sayfalar</summary>
    public static readonly string[] YonetimliSayfalar = { "ariza", "envanter" };

    /// <summary>Raporlar sayfasındaki sekmeler ve bağlı oldukları sayfa.</summary>
    public static readonly (string Kod, string Ad, string Sayfa, bool Maliyet)[] Raporlar =
    {
        ("ariza", "Arıza Kayıtları", "ariza", false),
        ("envanter", "Envanter", "envanter", false),
        ("maliyet", "Servis Maliyeti", "ariza", true),
    };

    public sealed record PortalRol(
        int Id,
        string Ad,
        string Aciklama,
        bool TumDepartmanlar,
        bool Maliyet,
        IReadOnlyList<int> Departmanlar,
        IReadOnlyDictionary<string, int> Sayfalar,
        IReadOnlyList<string> RaporKodlari)
    {
        public int Seviye(string kod) => Sayfalar.TryGetValue(kod, out var s) ? s : 0;
    }

    private sealed record Onbellek(
        DateTime Zaman,
        Dictionary<int, PortalRol> Roller,
        Dictionary<string, int> Atamalar);

    private static Onbellek _onbellek;
    private static readonly object Kilit = new();

    public void Sifirla()
    {
        lock (Kilit) _onbellek = null;
    }

    private Onbellek Oku()
    {
        var o = _onbellek;
        if (o is not null && (DateTime.UtcNow - o.Zaman).TotalSeconds < 30) return o;

        try
        {
            using var db = _vt.Baglanti();

            var roller = db.Query(@"
SELECT id, ad, aciklama, tum_departmanlar, maliyet FROM B360_ROL WHERE aktif = 1").ToList();

            var deps = db.Query<(int RolId, int DepId)>(
                "SELECT rol_id, departman_id FROM B360_ROL_DEPARTMAN").ToList();
            var sayfalar = db.Query<(int RolId, string Kod, int Seviye)>(
                "SELECT rol_id, kod, CAST(seviye AS INT) FROM B360_ROL_SAYFA").ToList();
            var raporlar = db.Query<(int RolId, string Rapor)>(
                "SELECT rol_id, rapor FROM B360_ROL_RAPOR").ToList();
            var atamalar = db.Query<(string Kullanici, int RolId)>(
                "SELECT kullanici_adi, rol_id FROM B360_KULLANICI_ROL").ToList();

            var sozluk = new Dictionary<int, PortalRol>();

            foreach (var r in roller)
            {
                int id = r.id;
                sozluk[id] = new PortalRol(
                    id, (string)r.ad, (string)r.aciklama,
                    (bool)r.tum_departmanlar, (bool)r.maliyet,
                    deps.Where(x => x.RolId == id).Select(x => x.DepId).ToList(),
                    sayfalar.Where(x => x.RolId == id)
                        .GroupBy(x => x.Kod, StringComparer.OrdinalIgnoreCase)
                        .ToDictionary(g => g.Key, g => g.Max(x => x.Seviye), StringComparer.OrdinalIgnoreCase),
                    raporlar.Where(x => x.RolId == id).Select(x => x.Rapor).ToList());
            }

            o = new Onbellek(DateTime.UtcNow, sozluk,
                atamalar.Where(a => sozluk.ContainsKey(a.RolId))
                    .GroupBy(a => a.Kullanici.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First().RolId, StringComparer.OrdinalIgnoreCase));
        }
        catch (Exception hata)
        {
            /* Tablolar yoksa (kurulum yapılamadıysa) roller devre dışı:
               herkes eskisi gibi çalışır. */
            _kayit.LogWarning(hata, "Portal rolleri okunamadı");
            o = new Onbellek(DateTime.UtcNow,
                new Dictionary<int, PortalRol>(),
                new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase));
        }

        lock (Kilit) _onbellek = o;
        return o;
    }

    /// <summary>Kullanıcının portal rolü; atanmamışsa null.</summary>
    public PortalRol KullaniciRolu(string kullaniciAdi)
    {
        if (string.IsNullOrWhiteSpace(kullaniciAdi)) return null;
        if (kullaniciAdi.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return null;

        var o = Oku();
        return o.Atamalar.TryGetValue(kullaniciAdi.Trim(), out var id) && o.Roller.TryGetValue(id, out var r) ? r : null;
    }

    public IReadOnlyCollection<PortalRol> Tumu() => Oku().Roller.Values;

    /// <summary>Role atanmış kullanıcı adları</summary>
    public List<string> Kullanicilari(int rolId) =>
        Oku().Atamalar.Where(x => x.Value == rolId).Select(x => x.Key).ToList();
}

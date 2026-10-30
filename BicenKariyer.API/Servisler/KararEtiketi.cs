using System.Text.RegularExpressions;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kararı verenin personele ve onaylayanlara görünen adı (15.10.2026).
/// İK çalışanlarının adı görünmez: "İnsan Kaynakları"; yönetimin (Genel
/// Müdür Yardımcısı / yönetici rolündeki panel kullanıcıları) adı da
/// görünmez: "Yönetim". Panelde (İK'nın kendi geçmiş kayıtlarında) adlar
/// durur. Mağaza müdürü, bölge müdürü gibi kişi adımları değişmez.
/// </summary>
public static class KararEtiketi
{
    public const string Ik = "İnsan Kaynakları";
    public const string Yonetim = "Yönetim";

    private static VeritabaniServisi _vt;
    private static (DateTime Zaman, HashSet<string> Ik, HashSet<string> Yonetim)? _bellek;
    private static readonly object Kilit = new();

    public static void Baslat(VeritabaniServisi vt) => _vt = vt;

    private static string Ad(string s) =>
        Regex.Replace((s ?? "").Replace("(Biçen360)", "").Replace("(üst yönetici adına)", ""), @"\s+", " ")
            .Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));

    private static (HashSet<string> Ik, HashSet<string> Yonetim) Adlar()
    {
        lock (Kilit)
            if (_bellek is { } b && DateTime.UtcNow - b.Zaman < TimeSpan.FromMinutes(5))
                return (b.Ik, b.Yonetim);

        var ik = new HashSet<string>();
        var yonetim = new HashSet<string>();

        try
        {
            if (_vt is not null)
            {
                using var db = _vt.Baglanti();
                foreach (var r in db.Query("SELECT ad_soyad, rol FROM KRY_KULLANICILAR"))
                {
                    var temel = Roller.Temel((string)r.rol);
                    var ad = Ad((string)r.ad_soyad);
                    if (ad.Length == 0) continue;
                    if (temel is Roller.GenelMudurYardimcisi or Roller.Admin) yonetim.Add(ad);
                    else if (temel is Roller.IK or Roller.IKYoneticisi) ik.Add(ad);
                }
            }
        }
        catch
        {
            /* okunamazsa yalnızca adım adına bakılır */
        }

        lock (Kilit) _bellek = (DateTime.UtcNow, ik, yonetim);
        return (ik, yonetim);
    }

    private static bool IkAdimi(string adimAdi, string adimTur) =>
        adimTur == "ik" || Ad(adimAdi).Contains("İNSAN KAYNAKLARI") || Ad(adimAdi) == "İK";

    /// <summary>
    /// Görünen ad: "Yönetim", "İnsan Kaynakları" ya da kişinin adı.
    /// <paramref name="rol"/>: kararı panelden veren kullanıcının rolü (biliniyorsa).
    /// </summary>
    public static string Kisi(string adimAdi, string adimTur, string kim, string rol = null)
    {
        var temel = string.IsNullOrWhiteSpace(rol) ? null : Roller.Temel(rol);
        if (temel is Roller.GenelMudurYardimcisi or Roller.Admin) return Yonetim;
        if (temel is Roller.IK or Roller.IKYoneticisi) return Ik;

        var (ik, yonetim) = Adlar();
        var ad = Ad(kim);

        /* Genel müdür (yardımcısı) adımı: yönetim */
        if (Ad(adimAdi).Contains("GENEL MÜDÜR")) return Yonetim;

        if (ad.Length > 0 && yonetim.Contains(ad)) return Yonetim;
        if (IkAdimi(adimAdi, adimTur) || (ad.Length > 0 && ik.Contains(ad))) return Ik;

        return string.IsNullOrWhiteSpace(kim) ? kim : kim.Replace(" (Biçen360)", "").Trim();
    }

    /// <summary>Ara not satırı: "İnsan Kaynakları tarafından onaylanmadı" / "Yönetim onayladı" / "Bölge müdürü reddetti (Ad)"</summary>
    public static string Karar(string adimAdi, string adimTur, string kim, bool onay, string rol = null)
    {
        var k = Kisi(adimAdi, adimTur, kim, rol);
        if (k is Ik or Yonetim) return onay ? $"{k} onayladı" : $"{k} tarafından onaylanmadı";
        return $"{adimAdi} {(onay ? "onayladı" : "reddetti")} ({k})";
    }

    private static readonly Regex AraSatir = new(@"^(?<adim>[^\n(]+?) (?<fiil>reddetti|onayladı) \((?<kim>[^)\n]*)\)", RegexOptions.Compiled);

    /// <summary>Eski kayıtlardaki ara notların adlarını gizler (satır satır)</summary>
    public static string Maskele(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return metin;

        return string.Join("\n", metin.Split('\n').Select(satir =>
        {
            var m = AraSatir.Match(satir);
            if (!m.Success) return satir;
            var yeni = Karar(m.Groups["adim"].Value.Trim(), null, m.Groups["kim"].Value, m.Groups["fiil"].Value == "onayladı");
            return yeni + satir[m.Length..];
        }));
    }
}

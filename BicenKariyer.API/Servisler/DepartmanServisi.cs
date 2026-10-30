using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Genel merkez ve depo departmanları: kim hangi ekipte, kimin yöneticisi kim.
///
/// <para>
/// Mağazalarda ekip iş yerinden çıkıyor (mağaza müdürü + mağazanın
/// personeli) ve sorun yok. Genel merkezde ise ekip izin onay tablosundan
/// türetiliyordu: aynı genel müdür yardımcısına bağlı onlarca pozisyon
/// birbirinin "ekip arkadaşı" oluyor, Bilgi Teknolojileri'ndeki biri bütün
/// merkezi görüyordu. Temizlik görevlisi gibi hem mağazada hem merkezde
/// hem depoda bulunan pozisyonlar da birbirine karışıyordu.
/// </para>
///
/// <para>
/// Burada İK departmanı elle kuruyor: yöneticileri ve personeli. Bir kişi
/// bir departmanda personel olarak tanımlıysa:
/// <list type="bullet">
/// <item>izin ve haftalık izin talebinin 1. onayı departman yöneticisine
/// gider,</item>
/// <item>mobilde Ekibim'de yalnızca departmanındakiler görünür,</item>
/// <item>yöneticinin ekibi (puantaj, vardiya planı, onaylar) yönettiği
/// departmanların personelidir.</item>
/// </list>
/// Departmanı olmayan herkes için eski kural (izin onay tablosu) aynen
/// geçerli.
/// </para>
/// </summary>
public class DepartmanServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<DepartmanServisi> _kayit;

    private readonly PersonelKaynagiServisi _kaynak;

    public DepartmanServisi(VeritabaniServisi vt, ILogger<DepartmanServisi> kayit, PersonelKaynagiServisi kaynak = null)
    {
        _vt = vt;
        _kayit = kayit;
        _kaynak = kaynak;
    }

    public const string Yonetici = "yonetici";
    public const string Personel = "personel";

    public sealed record Departman(int Id, string Ad, string IsYeri, string Aciklama, int Sira);

    /// <summary>Bellekteki hazır görünüm: sicil anahtarları baştaki sıfırsız.</summary>
    public sealed class Harita
    {
        public Dictionary<int, Departman> Departmanlar { get; } = new();

        /// <summary>Personel olarak bağlı olduğu departman (kişi başı tek)</summary>
        public Dictionary<string, int> PersonelDepartmani { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Yönettiği departmanlar</summary>
        public Dictionary<string, HashSet<int>> YonettigiDepartmanlar { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<int, HashSet<string>> Yoneticiler { get; } = new();
        public Dictionary<int, HashSet<string>> Personeller { get; } = new();

        /// <summary>Üyeliği olup bugün başka iş yerinde çalışanlar (yok sayılır)</summary>
        public Dictionary<string, int> IsYeriDegisen { get; } = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Kişi herhangi bir departmanda tanımlı mı (yönetici ya da personel)</summary>
        public bool Tanimli(string sicil) =>
            PersonelDepartmani.ContainsKey(K(sicil)) || YonettigiDepartmanlar.ContainsKey(K(sicil));

        /// <summary>Kişinin personel olarak bağlı olduğu departmanın yöneticileri (kendisi hariç)</summary>
        public HashSet<string> Yoneticileri(string sicil)
        {
            var k = K(sicil);

            if (!PersonelDepartmani.TryGetValue(k, out var d)) return new(StringComparer.OrdinalIgnoreCase);

            return (Yoneticiler.GetValueOrDefault(d) ?? new HashSet<string>())
                .Where(x => x != k)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Yönettiği departmanların personeli (kendisi hariç). Aynı
        /// departmanın diğer yöneticileri dahil değil: iki yönetici birbirinin
        /// vardiyasını ya da izin onayını yönetmesin.
        /// </summary>
        public HashSet<string> Sorumlulari(string sicil)
        {
            var k = K(sicil);
            var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (!YonettigiDepartmanlar.TryGetValue(k, out var ds)) return sonuc;

            foreach (var d in ds)
                foreach (var x in Personeller.GetValueOrDefault(d) ?? new()) sonuc.Add(x);

            sonuc.Remove(k);
            return sonuc;
        }

        /// <summary>Personel olarak bağlı olduğu departmandaki herkes (kendisi hariç)</summary>
        public HashSet<string> DepartmanArkadaslari(string sicil)
        {
            var k = K(sicil);
            var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            if (!PersonelDepartmani.TryGetValue(k, out var d)) return sonuc;

            foreach (var x in Personeller.GetValueOrDefault(d) ?? new()) sonuc.Add(x);
            foreach (var x in Yoneticiler.GetValueOrDefault(d) ?? new()) sonuc.Add(x);

            sonuc.Remove(k);
            return sonuc;
        }
    }

    public static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static (DateTime zaman, Harita harita)? _bellek;
    private static readonly object _kilit = new();

    /// <summary>Departman değişince çağrılır.</summary>
    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    public Harita Oku()
    {
        lock (_kilit)
        {
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.harita;
        }

        var h = new Harita();

        try
        {
            using var db = _vt.Baglanti();

            foreach (var d in db.Query<Departman>(@"
SELECT id AS Id, ad AS Ad, is_yeri AS IsYeri, aciklama AS Aciklama, sira AS Sira
FROM KRY_DEPARTMAN WHERE aktif = 1"))
                h.Departmanlar[d.Id] = d;

            /* 16.10.2026: üyelik sicile bağlı. Personel sonradan mağazaya
               geçtiyse ya da ikinci kez mağazada işe girdiyse eski genel
               merkez departmanı üyeliği kalıyor ve kişi o departmanın
               yöneticisinin Ekibim'inde ve onayında görünüyordu. Kişi bugün
               departmanı olan hiçbir iş yerinde (genel merkez, depo) değilse,
               yani mağazadaysa, üyelik yok sayılır. */
            var isYerleri = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                foreach (var p in _kaynak?.TumPersonelleriGetir() ?? new List<PersonelKaydi>())
                    if (p.Durum == 1 && !string.IsNullOrWhiteSpace(p.PersonelKodu))
                        isYerleri[K(p.PersonelKodu)] = p.IsGrubu ?? "";
            }
            catch
            {
                /* Personel okunamazsa üyelikler olduğu gibi */
            }

            /* Departmanı olan iş yerleri (genel merkez, depo); bunların dışı mağaza */
            var depYerleri = h.Departmanlar.Values
                .Where(x => !string.IsNullOrWhiteSpace(x.IsYeri))
                .Select(x => PersonelKaynagiServisi.MeslekAnahtari(x.IsYeri))
                .ToHashSet();

            foreach (var u in db.Query(@"
SELECT u.departman_id AS d, u.personel_kodu AS kod, u.rol
FROM KRY_DEPARTMAN_UYE u
INNER JOIN KRY_DEPARTMAN d ON d.id = u.departman_id AND d.aktif = 1"))
            {
                var d = (int)u.d;
                var kod = K((string)u.kod);

                if (kod.Length == 0) continue;

                if (h.Departmanlar.ContainsKey(d)
                    && depYerleri.Count > 0
                    && isYerleri.TryGetValue(kod, out var yer)
                    && !string.IsNullOrWhiteSpace(yer)
                    && !depYerleri.Contains(PersonelKaynagiServisi.MeslekAnahtari(yer)))
                {
                    h.IsYeriDegisen[kod] = d;
                    continue;
                }

                if ((string)u.rol == Yonetici)
                {
                    if (!h.Yoneticiler.TryGetValue(d, out var ys)) h.Yoneticiler[d] = ys = new(StringComparer.OrdinalIgnoreCase);
                    ys.Add(kod);

                    if (!h.YonettigiDepartmanlar.TryGetValue(kod, out var ds)) h.YonettigiDepartmanlar[kod] = ds = new();
                    ds.Add(d);
                }
                else
                {
                    if (!h.Personeller.TryGetValue(d, out var ps)) h.Personeller[d] = ps = new(StringComparer.OrdinalIgnoreCase);
                    ps.Add(kod);

                    h.PersonelDepartmani[kod] = d;
                }
            }
        }
        catch (Exception hata)
        {
            /* Tablo yoksa ya da okunamazsa departman yok sayılır: eski
               kural çalışmaya devam eder. */
            _kayit.LogWarning(hata, "Departmanlar okunamadı");
        }

        lock (_kilit) _bellek = (DateTime.UtcNow, h);

        return h;
    }
}

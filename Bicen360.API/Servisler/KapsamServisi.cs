using System.Text.Json;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Grup ayarı: modülü gören kişi o modülde neyi görür, kimden sorumludur,
/// hangi talebi onaylar.
/// </summary>
public class GrupAyari
{
    /// <summary>Bu grubun sorumlu olduğu gruplar (kimlik).</summary>
    public List<int> SorumluGruplar { get; set; } = new();

    /// <summary>
    /// Arıza kayıtlarında görünürlük.
    /// <c>null</c> eski kural, yoksa: kendi · sube · bolge · departman · tum.
    /// </summary>
    public string ArizaKapsami { get; set; }

    /// <summary>Envanterde görünürlük; değerler arızayla aynı.</summary>
    public string EnvanterKapsami { get; set; }

    /// <summary>Departman kapsamında hangi departmanlar.</summary>
    public List<int> Departmanlar { get; set; } = new();

    /// <summary>Sorumlu olduğu personelin haftalık izin gününü onaylar.</summary>
    public bool HaftalikIzinOnay { get; set; }

    /// <summary>
    /// Yıllık izin onay kademesi: <c>null</c>/yok · magaza · bolge.
    /// Mağaza kademesi aynı şubedeki talebi ilk onaylıyor; bölge kademesi
    /// mağaza onayından sonra, sorumlu olduğu bölgelerdeki talebi.
    /// </summary>
    public string YillikIzinKademe { get; set; }
}

/// <summary>
/// Grup ayarlarını okuyup kişiye uygular.
///
/// <para>
/// Ayar tanımlı değilse <c>null</c> dönüyor ve her modül kendi eski
/// kuralına düşüyor: ayar ekranına hiç girilmemiş bir grubun davranışı
/// değişmemeli.
/// </para>
///
/// <para>
/// Şube eşleşmesi adla ve kodla birlikte yapılıyor: kayıtlarda şube kimi
/// yerde adıyla, kimi yerde koduyla duruyor. Bölge tanımları İK ayarındaki
/// (KRY_AYARLAR · FORM) bölge listesinden okunuyor; portalda ikinci bir
/// bölge listesi tutmak, ikisinin ayrışmasına yol açardı.
/// </para>
/// </summary>
public class KapsamServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<KapsamServisi> _kayit;

    private static readonly JsonSerializerOptions JSON = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public KapsamServisi(VeritabaniServisi vt, ILogger<KapsamServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /* ------------------------------------------------------------ grup */

    /// <summary>Ünvanın bağlı olduğu grup: kimlik ve ad.</summary>
    public (int Id, string Ad)? GrupBul(string pozisyon)
    {
        if (string.IsNullOrWhiteSpace(pozisyon)) return null;

        var hedef = YetkiServisi.Anahtar(pozisyon);

        try
        {
            using var db = _vt.Baglanti();

            foreach (var g in db.Query(@"
SELECT id, ad, pozisyonlar FROM KRY_POZISYON_GRUBU
WHERE aktif = 1 ORDER BY sira, ad"))
            {
                var uyuyor = ((string)g.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Any(x => YetkiServisi.Anahtar(x) == hedef);

                if (uyuyor) return ((int)g.id, (string)g.ad);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Grup okunamadı");
        }

        return null;
    }

    /// <summary>Grubun ayarı; tanımlı değilse <c>null</c>.</summary>
    public GrupAyari Oku(int grupId)
    {
        try
        {
            using var db = _vt.Baglanti();

            var ham = db.ExecuteScalar<string>(
                "SELECT ayar FROM B360_GRUP_AYAR WHERE grup_id = @grupId", new { grupId });

            return string.IsNullOrWhiteSpace(ham)
                ? null
                : JsonSerializer.Deserialize<GrupAyari>(ham, JSON);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Grup ayarı okunamadı: {Grup}", grupId);

            return null;
        }
    }

    public void Yaz(int grupId, GrupAyari ayar, string yapan)
    {
        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE B360_GRUP_AYAR AS h
USING (SELECT @grupId AS grup_id) AS k ON h.grup_id = k.grup_id
WHEN MATCHED THEN UPDATE SET ayar = @ayar, guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (grup_id, ayar, guncelleyen) VALUES (@grupId, @ayar, @yapan);",
            new { grupId, ayar = JsonSerializer.Serialize(ayar), yapan });
    }

    /// <summary>Kişinin grubunun ayarı; grup ya da ayar yoksa <c>null</c>.</summary>
    public GrupAyari KisininAyari(string pozisyon)
    {
        var g = GrupBul(pozisyon);

        return g is null ? null : Oku(g.Value.Id);
    }

    /* ----------------------------------------------------------- bölge */

    private sealed class FormBolge
    {
        public string Ad { get; set; }
        public List<string> Subeler { get; set; } = new();
    }

    private sealed class FormSube
    {
        public string Kod { get; set; }
        public string Ad { get; set; }
    }

    private sealed class FormAyari
    {
        public List<FormBolge> Bolgeler { get; set; } = new();
        public List<FormSube> Subeler { get; set; } = new();
    }

    /// <summary>İK ayarındaki bölge ve şube tanımları.</summary>
    private FormAyari Form()
    {
        try
        {
            using var db = _vt.Baglanti();

            var ham = db.ExecuteScalar<string>(
                "SELECT deger FROM KRY_AYARLAR WHERE anahtar = 'FORM'");

            return string.IsNullOrWhiteSpace(ham)
                ? new FormAyari()
                : JsonSerializer.Deserialize<FormAyari>(ham, JSON) ?? new FormAyari();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bölge tanımları okunamadı");

            return new FormAyari();
        }
    }

    /// <summary>Tanımlı bölge adları; ayar ekranındaki seçim listesi için.</summary>
    public List<string> BolgeAdlari() =>
        Form().Bolgeler
            .Select(b => b.Ad)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();

    /// <summary>Kişiye atanmış sorumlu bölgeler.</summary>
    public List<string> KisiBolgeleri(string sicil)
    {
        if (string.IsNullOrWhiteSpace(sicil)) return new();

        using var db = _vt.Baglanti();

        return db.Query<string>(
            "SELECT bolge FROM B360_KISI_BOLGE WHERE sicil = @sicil ORDER BY bolge",
            new { sicil = sicil.Trim() }).ToList();
    }

    public void KisiBolgeleriYaz(string sicil, IEnumerable<string> bolgeler)
    {
        using var db = _vt.Baglanti();
        db.Open();

        using var islem = db.BeginTransaction();

        db.Execute("DELETE FROM B360_KISI_BOLGE WHERE sicil = @sicil",
            new { sicil }, islem);

        foreach (var b in (bolgeler ?? Enumerable.Empty<string>())
                     .Select(x => (x ?? "").Trim())
                     .Where(x => x.Length > 0)
                     .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            db.Execute("INSERT INTO B360_KISI_BOLGE (sicil, bolge) VALUES (@sicil, @b)",
                new { sicil, b }, islem);
        }

        islem.Commit();
    }

    /// <summary>
    /// Kişinin sorumlu olduğu bölgelerin şubeleri: ad ve kod birlikte.
    ///
    /// Kişiye bölge atanmamışsa kendi şubesinin bölgesi kullanılıyor.
    /// </summary>
    public List<string> BolgeSubeleri(string sicil, string kendiSubesi)
    {
        /* Önce Yetkiler → Bölgeler tanımı: bu kişi bir bölgenin müdürüyse
           o bölgenin şubeleri (personel kartındaki adlarla). */
        try
        {
            using var dbBolge = _vt.Baglanti();

            var tanimli = dbBolge.Query<string>(@"
SELECT DISTINCT S.sube
FROM B360_BOLGE_MUDUR M
    INNER JOIN B360_BOLGE B ON B.id = M.bolge_id AND B.aktif = 1
    INNER JOIN B360_BOLGE_SUBE S ON S.bolge_id = M.bolge_id
WHERE LTRIM(RTRIM(M.sicil)) = @sicil", new { sicil = (sicil ?? "").Trim() }).ToList();

            if (tanimli.Count > 0) return tanimli;
        }
        catch
        {
            /* Tablo yoksa eski kurala düşülüyor */
        }

        var form = Form();

        var bolgeler = KisiBolgeleri(sicil);

        if (bolgeler.Count == 0 && !string.IsNullOrWhiteSpace(kendiSubesi))
        {
            var kendi = BolgeBul(form, kendiSubesi);

            if (kendi is not null) bolgeler.Add(kendi);
        }

        var sonuc = new List<string>();

        foreach (var b in form.Bolgeler.Where(x =>
                     bolgeler.Contains(x.Ad ?? "", StringComparer.OrdinalIgnoreCase)))
        {
            foreach (var kod in b.Subeler ?? new List<string>())
            {
                sonuc.Add(kod);

                var ad = form.Subeler.FirstOrDefault(x =>
                    string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad;

                if (!string.IsNullOrWhiteSpace(ad)) sonuc.Add(ad);
            }
        }

        return sonuc.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string BolgeBul(FormAyari form, string sube)
    {
        var hedef = YetkiServisi.Anahtar(sube);

        foreach (var b in form.Bolgeler)
        {
            foreach (var kod in b.Subeler ?? new List<string>())
            {
                var ad = form.Subeler.FirstOrDefault(x =>
                    string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad ?? kod;

                if (YetkiServisi.Anahtar(ad) == hedef || YetkiServisi.Anahtar(kod) == hedef)
                    return b.Ad;
            }
        }

        return null;
    }

    /* ---------------------------------------------------------- kapsam */

    /// <summary>
    /// Bir kapsam değerini somut süzgece çevirir.
    ///
    /// Dönen şube listesi boşsa ve "hepsi" yanlışsa kişi yalnızca kendi
    /// kayıtlarını görür.
    /// </summary>
    public (bool Hepsi, List<string> Subeler, List<int> Departmanlar) Coz(
        string kapsam, GrupAyari ayar, string sicil, string kendiSubesi)
    {
        var bos = new List<string>();

        return kapsam switch
        {
            "tum" => (true, bos, new List<int>()),

            "bolge" => (false, BolgeSubeleri(sicil, kendiSubesi), new List<int>()),

            "sube" => (false,
                string.IsNullOrWhiteSpace(kendiSubesi) ? bos : new List<string> { kendiSubesi },
                new List<int>()),

            "departman" => (false, bos, ayar?.Departmanlar?.ToList() ?? new List<int>()),

            _ => (false, bos, new List<int>()),
        };
    }
}

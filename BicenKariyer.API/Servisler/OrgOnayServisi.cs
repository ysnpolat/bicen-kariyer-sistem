using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Yıllık izin onay zinciri: organizasyon şemasından.
///
/// <para>
/// Talep edenin kutusundan yukarı çıkılıyor; "izin onaylar" işaretli ilk
/// kutu <b>birim yöneticisi</b> (1. aşama), bir sonraki <b>üst yönetici</b>
/// (2. aşama). Son onay İnsan Kaynakları'nda. Mağaza personeliyle genel
/// merkez personeli aynı kurala tabi; "mağaza müdürü onayı" yerine
/// "birim yöneticisi" denmesinin sebebi bu.
/// </para>
///
/// <para>
/// Bir kutuda birden çok kişi olabiliyor. Mağaza kutularında aynı
/// şubedeki kişi alınıyor. Diğer kutularda sorumlu olduğu bölgeler talep
/// edenin şubesini kapsayan kişi alınıyor (bölge müdürleri); kimse
/// kapsamıyorsa kutudaki herkes onaylayabiliyor (genel merkezde tek kişilik
/// kutular için).
/// </para>
///
/// <para>
/// Aşamada onaylayacak kimse yoksa aşama atlanıyor ve talep bir sonrakine
/// geçiyor; talebin sahipsiz kalıp sonsuza kadar beklemesi en kötü sonuç.
/// </para>
/// </summary>
public class OrgOnayServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly AyarServisi _ayar;
    private readonly IzinOnayKuralServisi _kural;
    private readonly ILogger<OrgOnayServisi> _kayit;
    private readonly IConfiguration _yapilandirma;
    private readonly AvansOnayZinciri _avans;

    public OrgOnayServisi(VeritabaniServisi vt, PersonelKaynagiServisi kaynak,
                          AyarServisi ayar, IzinOnayKuralServisi kural,
                          ILogger<OrgOnayServisi> kayit, IConfiguration yapilandirma,
                          AvansOnayZinciri avans)
    {
        _avans = avans;
        _yapilandirma = yapilandirma;
        _kural = kural;
        _vt = vt;
        _kaynak = kaynak;
        _ayar = ayar;
        _kayit = kayit;
    }

    private sealed record Kutu(int Id, int? UstId, string Unvan, bool MagazaMi, bool IzinOnay);

    /* Şema, eşleşmeler ve personel kısa süre bellekte: onay listesi her
       açıldığında aynı veriyi yeniden okumak gereksiz. */
    private static (DateTime zaman, Dictionary<int, Kutu> kutular,
             Dictionary<string, int> eslesme, List<PersonelKaydi> personel)? _bellek;

    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    private (Dictionary<int, Kutu> kutular, Dictionary<string, int> eslesme, List<PersonelKaydi> personel) Veri()
    {
        lock (_kilit)
        {
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromMinutes(2))
                return (b.kutular, b.eslesme, b.personel);
        }

        using var db = _vt.Baglanti();

        var kutular = db.Query(@"
SELECT id, ust_id, unvan, magaza_mi, CAST(ISNULL(izin_onay, 1) AS BIT) AS izin_onay
FROM KRY_ORGANIZASYON WHERE aktif = 1")
            .Select(x => new Kutu((int)x.id, (int?)x.ust_id, (string)x.unvan,
                                  (bool)x.magaza_mi, (bool)x.izin_onay))
            .ToDictionary(x => x.Id);

        var eslesme = new Dictionary<string, int>();

        foreach (var e in db.Query("SELECT unvan, kutu_id FROM KRY_ORG_ESLESME WHERE kutu_id IS NOT NULL"))
            eslesme[Controllers.PersonelController.UnvanAnahtari((string)e.unvan)] = (int)e.kutu_id;

        var personel = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        lock (_kilit) _bellek = (DateTime.UtcNow, kutular, eslesme, personel);

        return (kutular, eslesme, personel);
    }

    /// <summary>Ünvanın kutusu; elle eşleşme önce, sonra ad benzerliği.</summary>
    private static int? KutuBul(string pozisyon, Dictionary<int, Kutu> kutular, Dictionary<string, int> eslesme)
    {
        var a = Controllers.PersonelController.UnvanAnahtari(pozisyon);

        if (a.Length == 0) return null;

        if (eslesme.TryGetValue(a, out var k) && kutular.ContainsKey(k)) return k;

        return kutular.Values.FirstOrDefault(x =>
            Controllers.PersonelController.UnvanAnahtari(x.Unvan) == a)?.Id;
    }

    /// <summary>Kişinin kutusundan yukarı, izin onaylayan kutular (en yakın önce).</summary>
    private static List<Kutu> OnayZinciri(int kutuId, Dictionary<int, Kutu> kutular)
    {
        var zincir = new List<Kutu>();
        var goruldu = new HashSet<int>();

        var simdi = kutular.TryGetValue(kutuId, out var k) ? k.UstId : null;

        while (simdi is int id && kutular.TryGetValue(id, out var ust) && goruldu.Add(id))
        {
            if (ust.IzinOnay) zincir.Add(ust);
            simdi = ust.UstId;
        }

        return zincir;
    }

    /// <summary>Bir kutudaki, bu talep sahibinden sorumlu kişiler.</summary>
    private List<PersonelKaydi> Kisiler(Kutu kutu, string talepSubesi, string talepSicili,
        Dictionary<int, Kutu> kutular, Dictionary<string, int> eslesme, List<PersonelKaydi> personel)
    {
        var kutudakiler = personel
            .Where(p => KutuBul(p.Pozisyon, kutular, eslesme) == kutu.Id)
            .Where(p => !string.Equals((p.PersonelKodu ?? "").Trim(), (talepSicili ?? "").Trim(),
                StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (kutu.MagazaMi)
            return kutudakiler
                .Where(p => PersonelKaynagiServisi.Benziyor(p.IsGrubu ?? "", talepSubesi ?? ""))
                .ToList();

        /* Bölge sorumluluğu: kişiye atanmış bölgeler (portal → Kişiye
           özel → Sorumlu bölgeleri), yoksa kendi şubesinin bölgesi. */
        var form = _ayar.FormOku();

        var bolgeli = kutudakiler
            .Where(p => SubeIcinde(BolgeSubeleri(p, form), talepSubesi))
            .ToList();

        return bolgeli.Count > 0 ? bolgeli : kutudakiler;
    }

    private List<string> BolgeSubeleri(PersonelKaydi p, FormAyarlari form)
    {
        var bolgeler = new List<string>();

        try
        {
            using var db = _vt.Baglanti();

            bolgeler = db.Query<string>("SELECT bolge FROM B360_KISI_BOLGE WHERE sicil = @s",
                new { s = (p.PersonelKodu ?? "").Trim() }).ToList();
        }
        catch
        {
            /* Portal tablosu yoksa atama da yok */
        }

        var tanimlar = form?.Bolgeler ?? new List<BolgeTanimi>();
        var subeler = form?.Subeler ?? new List<Sube>();

        string Ad(string kod) =>
            subeler.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad ?? kod;

        /* Atama yoksa bölge ancak kişi bir mağazada çalışıyorsa çıkarılır;
           merkezdeki kişinin "kendi şubesi" bir bölgeye ait değil. */
        if (bolgeler.Count == 0)
        {
            var kendi = tanimlar.FirstOrDefault(b => (b.Subeler ?? new List<string>())
                .Any(k => PersonelKaynagiServisi.Benziyor(Ad(k), p.IsGrubu ?? "")
                       || PersonelKaynagiServisi.Benziyor(k, p.IsGrubu ?? "")));

            if (kendi is not null) bolgeler.Add(kendi.Ad);
        }

        return tanimlar
            .Where(b => bolgeler.Contains(b.Ad ?? "", StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => (b.Subeler ?? new List<string>()).SelectMany(k => new[] { k, Ad(k) }))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool SubeIcinde(IEnumerable<string> liste, string sube) =>
        !string.IsNullOrWhiteSpace(sube) &&
        liste.Any(x => PersonelKaynagiServisi.Benziyor(x ?? "", sube));

    /* ================================================================== */

    /// <summary>
    /// Talep sahibinin iki aşamadaki onaylayıcıları.
    ///
    /// Aşamada kimse yoksa liste boş döner; çağıran taraf o aşamayı atlar.
    /// </summary>
    public (List<PersonelKaydi> Birim, List<PersonelKaydi> Ust, string BirimUnvan, string UstUnvan)
        Onaylayicilar(string sicil, string pozisyon, string sube)
    {
        /* 23.10.2026: bütün onay akışları (izin, fazla mesai, rotasyon)
           avans onay tablosundaki sırayla, İK'da bitiyor. Tablodaki ilk
           kişi adımı 1. aşama (birim yöneticisi), ikincisi 2. aşama; son
           onay İK. Ör. şubede kasiyer: mağaza müdürü → bölge müdürü → İK;
           merkezde IT uzmanı: teknoloji müdürü → İK. Tablo çözülemezse
           aşağıdaki eski kural. */
        try
        {
            var kademeler = _avans.IzinKademeleri(sicil, pozisyon, sube);

            if (kademeler.Count > 2)
                _kayit.LogWarning("Onay tablosunda İK'dan önce {Adet} kişi adımı var; ilk ikisi kullanılıyor: {Sicil} {Pozisyon}",
                    kademeler.Count, sicil, pozisyon);

            return (
                kademeler.Count > 0 ? kademeler[0].Kisiler : new(),
                kademeler.Count > 1 ? kademeler[1].Kisiler : new(),
                kademeler.Count > 0 ? kademeler[0].Unvan : null,
                kademeler.Count > 1 ? kademeler[1].Unvan : null);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Avans onay tablosundan onaylayan bulunamadı, eski kurala düşüldü: {Sicil}", sicil);
        }

        return EskiOnaylayicilar(sicil, pozisyon, sube);
    }

    /// <summary>23.10.2026 öncesi kural: izin onay tablosu + şubenin bölge müdürü</summary>
    private (List<PersonelKaydi> Birim, List<PersonelKaydi> Ust, string BirimUnvan, string UstUnvan)
        EskiOnaylayicilar(string sicil, string pozisyon, string sube)
    {
        /* 1. aşama İK'nın onay tablosundan (IzinOnayKuralServisi).

           2. aşama (07.10.2026): şubenin bağlı olduğu bölgenin bölge
           müdürü (Yönetim › Bölgeler + bölge müdürü hesapları). Önceden
           bu aşama hep boş dönüyordu: onay tablosu devreye girerken "ara
           aşama yok" denmişti ve birim yöneticisinin onayladığı her talep
           bölge müdürünü atlayıp doğrudan İK'ya geçiyordu.

           1. onaylayan zaten bölge müdürüyse (mağaza müdürünün kendi
           talebi gibi) ikinci kez sorulmuyor. Şube bir bölgede değilse
           (genel merkez, depo) aşama yine atlanıyor. */
        var (kisiler, unvan) = _kural.Onaylayanlar(sicil, pozisyon, sube);

        var ust = new List<PersonelKaydi>();

        try
        {
            if (Parametre.Acik("izin.bolgeAsamasi"))
            {
                var bm = _kural.BolgeMudurleri(sube, sicil);

                static string K(string x) => (x ?? "").Trim().TrimStart('0');

                var birinci = kisiler.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

                if (bm.Count > 0 && !bm.Any(x => birinci.Contains(K(x.PersonelKodu))))
                    ust = bm;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bölge müdürü aşaması çözülemedi: {Sicil}", sicil);
        }

        return (kisiler, ust, unvan, ust.Count > 0 ? "Bölge Müdürü" : null);
    }

    /// <summary>
    /// Fazla mesainin üst onaylayıcıları (14.10.2026). Şubelerde her zaman
    /// şubenin bölge müdürü: izin akışındaki "Bölge müdürü onay aşaması"
    /// ayarından ve izin onay tablosundan bağımsız (mağaza müdürü fazla mesai
    /// girince imzalı formu yükleyip onaylar, ardından bölge müdürü formu
    /// görüp onaylar). Genel merkez ve depo eskisi gibi.
    /// </summary>
    public List<PersonelKaydi> FazlaMesaiUst(string sicil, string pozisyon, string sube, string isGrubu)
    {
        /* 23.10.2026: izinle aynı kaynak, avans onay tablosunun 2. kişi adımı */
        return Onaylayicilar(sicil, pozisyon, string.IsNullOrWhiteSpace(isGrubu) ? sube : isGrubu).Ust ?? new();
    }

    /// <summary>14.10.2026 kuralı: şubede bölge müdürü. 23.10.2026'dan beri kullanılmıyor.</summary>
    private List<PersonelKaydi> EskiFazlaMesaiUst(string sicil, string pozisyon, string sube, string isGrubu)
    {
        static string K(string x) => (x ?? "").Trim().TrimStart('0');

        try
        {
            var yer = _kural.IsYeriBul(isGrubu ?? sube);

            if (PersonelKaynagiServisi.MeslekAnahtari(yer) == PersonelKaynagiServisi.MeslekAnahtari(IzinOnayKuralServisi.Sube))
            {
                var bm = _kural.BolgeMudurleri(string.IsNullOrWhiteSpace(isGrubu) ? sube : isGrubu, sicil);

                if (bm.Count == 0 && !string.IsNullOrWhiteSpace(sube) && !string.Equals(sube, isGrubu, StringComparison.OrdinalIgnoreCase))
                    bm = _kural.BolgeMudurleri(sube, sicil);

                return bm.Where(x => K(x.PersonelKodu) != K(sicil)).ToList();
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fazla mesai bölge müdürü çözülemedi: {Sicil}", sicil);
        }

        return Onaylayicilar(sicil, pozisyon, sube).Ust ?? new();
    }

    /// <summary>Eski çözüm: organizasyon şemasından. Artık kullanılmıyor.</summary>
    private (List<PersonelKaydi> Birim, List<PersonelKaydi> Ust, string BirimUnvan, string UstUnvan)
        SemadanOnaylayicilar(string sicil, string pozisyon, string sube)
    {
        try
        {
            var (kutular, eslesme, personel) = Veri();

            var kutu = KutuBul(pozisyon, kutular, eslesme);

            if (kutu is null) return (new(), new(), null, null);

            var zincir = OnayZinciri(kutu.Value, kutular);

            /* Kutu var ama içinde bu kişiden sorumlu kimse yoksa bir üste
               geçiliyor: boş kalan müdürlük talebi bekletmemeli. */
            var dolu = zincir
                .Select(k => (k, kisi: Kisiler(k, sube, sicil, kutular, eslesme, personel)))
                .Where(x => x.kisi.Count > 0)
                .Take(2)
                .ToList();

            return (
                dolu.Count > 0 ? dolu[0].kisi : new(),
                dolu.Count > 1 ? dolu[1].kisi : new(),
                dolu.Count > 0 ? dolu[0].k.Unvan : null,
                dolu.Count > 1 ? dolu[1].k.Unvan : null);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Onay zinciri çözülemedi: {Sicil}", sicil);

            return (new(), new(), null, null);
        }
    }

    /// <summary>Bu kişi, talebin şu anki aşamasında onaylayıcı mı.</summary>
    public bool KararVerebilir(string onaylayanSicil, string talepSicil, string talepPozisyon,
                               string talepSube, int asama)
    {
        var (birim, ust, _, _) = Onaylayicilar(talepSicil, talepPozisyon, talepSube);

        var liste = asama == 1 ? birim : asama == 2 ? ust : new List<PersonelKaydi>();

        return liste.Any(p => string.Equals((p.PersonelKodu ?? "").Trim(),
            (onaylayanSicil ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Kişi herhangi birinin yıllık izin onaylayıcısı olabilir mi: kutusu
    /// izin onaylıyor ve altında kutu var. Mobil menüde onay ekranı buna
    /// göre gösteriliyor.
    /// </summary>
    public bool OnaylayiciMi(string pozisyon, string sicil = null) =>
        _kural.OnaylayiciMi(pozisyon, sicil) || (sicil is not null && _avans.OnayciMi(sicil, pozisyon));

    /// <summary>Eski kural: şemadan. Artık kullanılmıyor.</summary>
    private bool SemadanOnaylayiciMi(string pozisyon)
    {
        try
        {
            var (kutular, eslesme, _) = Veri();

            var kutu = KutuBul(pozisyon, kutular, eslesme);

            return kutu is int id && kutular[id].IzinOnay && kutular.Values.Any(x => x.UstId == id);
        }
        catch
        {
            return false;
        }
    }
}

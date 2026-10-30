namespace BicenKariyer.API.Servisler;

/// <summary>
/// Kim kimin ekibinde: Puantaj ve Ekibim modüllerinin kapsamı.
///
/// <para>
/// Sorumluluk ayrı bir listede tutulmuyor; İK'nın izin onay tablosundan
/// türetiliyor. Bir kişinin 1. onaylayanı, o kişinin yöneticisi sayılıyor.
/// Mağaza müdürü bu yüzden kendi mağazasının personelinden, depo müdürü
/// deponun, IT müdürü IT ekibinin sorumlusu oluyor — tabloyu düzenleyen
/// İK aynı anda puantaj ve ekip görünürlüğünü de düzenlemiş oluyor.
/// </para>
///
/// <para>
/// Bölge müdürü ayrıca sorumlu olduğu bölgelerin bütün şubelerini
/// görüyor (portal → Yetkiler → Kişiye özel → Sorumlu bölgeleri): puantajda
/// mağazalar kart olarak listeleniyor.
/// </para>
///
/// <para>
/// Hesap bütün personel için bir kerede yapılıp iki dakika bellekte
/// tutuluyor: kişi başı onaylayan araması ekran başına yüzlerce kez
/// tekrarlanıyordu.
/// </para>
/// </summary>
public class EkipServisi
{
    private readonly IzinOnayKuralServisi _kural;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly PortalYetkiServisi _portalYetki;
    private readonly AyarServisi _ayar;
    private readonly DepartmanServisi _departman;
    private readonly EkibimKurallari _ekibim;

    public EkipServisi(IzinOnayKuralServisi kural, PersonelKaynagiServisi kaynak,
        PortalYetkiServisi portalYetki, AyarServisi ayar, DepartmanServisi departman,
        EkibimKurallari ekibim = null)
    {
        _ekibim = ekibim;
        _departman = departman;
        _kural = kural;
        _kaynak = kaynak;
        _portalYetki = portalYetki;
        _ayar = ayar;
    }

    private static (DateTime zaman, Dictionary<string, HashSet<string>> yonetici)? _bellek;
    private static readonly object _kilit = new();

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Departman ya da onay tablosu değişince çağrılır.</summary>
    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    /* Personel listesi istek boyunca bir kez okunuyor: aynı istekte
       kapsam, liste ve ayrıntı hesapları ayrı ayrı veritabanına
       gidiyordu. */
    private List<PersonelKaydi> _aktifler;

    public List<PersonelKaydi> Aktifler() =>
        _aktifler ??= _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .ToList();

    public PersonelKaydi Kisi(string sicil) =>
        Aktifler().FirstOrDefault(x => K(x.PersonelKodu) == K(sicil));

    /// <summary>Her personelin 1. onaylayanları (sicil kümesi).</summary>
    public Dictionary<string, HashSet<string>> Yoneticiler()
    {
        lock (_kilit)
        {
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromMinutes(2))
                return b.yonetici;
        }

        var sonuc = _kural.TopluOnaylayanlar(Aktifler())
            .ToDictionary(
                x => x.Key,
                x => x.Value.Select(y => K(y.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase),
                StringComparer.OrdinalIgnoreCase);

        lock (_kilit) _bellek = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    public static bool BolgeMuduruMu(string pozisyon) =>
        PersonelKaynagiServisi.BolgeMuduruPozisyonu(pozisyon);

    /// <summary>Bölge müdürünün sorumlu olduğu şube adları (personel iş grubu adlarıyla).</summary>
    public List<string> BolgeSubeleri(PersonelKaydi kisi)
    {
        if (kisi is null) return new();

        var form = _ayar.FormOku();
        var adSoyad = $"{kisi.Ad} {kisi.Soyad}";

        /* İK panelinde bölge müdürü hesabı varsa oradaki şubeler; yoksa
           pozisyonu bölge müdürüyse portal ataması. Kendi şubesinin
           bölgesine düşme burada istenmiyor: o, mağaza personelini de
           bölge müdürü gibi gösterirdi. */
        /* Önce portaldaki bölge tanımı; sonra İK panelindeki hesap */
        var kapsam = _portalYetki.TanimliBolgeSubeleri(kisi.PersonelKodu);

        if (kapsam.Count == 0)
            kapsam = _portalYetki.PanelSubeleri(kisi.PersonelKodu, adSoyad, form);

        if (kapsam.Count == 0)
        {
            if (!BolgeMuduruMu(kisi.Pozisyon)) return new();
            kapsam = _portalYetki.BolgeSubeleri(kisi.PersonelKodu, kisi.IsGrubu, form, adSoyad);
        }

        if (kapsam.Count == 0) return new();

        return Aktifler()
            .Select(x => x.IsGrubu)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(x => PortalYetkiServisi.SubeIcinde(kapsam, x))
            .OrderBy(x => x)
            .ToList();
    }

    /// <summary>
    /// İK panelinde tanımlı olup personel listesinde karşılığı bulunmayan
    /// şubeler: adı Mikro'daki iş grubu adından çok farklı yazılmış ya da
    /// şube tanımında adı eksik olanlar. Puantajda uyarı olarak gösteriliyor.
    /// </summary>
    public List<string> EslesmeyenSubeler(PersonelKaydi kisi)
    {
        if (kisi is null) return new();

        /* Portaldaki bölge tanımındaki şubeler personel kartındaki adla
           seçildiği için eşleşmeyen olmuyor; yalnızca personeli kalmamış
           (kapanmış) şubeler için uyarı. */
        var tanimli = _portalYetki.TanimliBolgeSubeleri(kisi.PersonelKodu);

        if (tanimli.Count > 0)
        {
            var gruplar = Aktifler().Select(x => (x.IsGrubu ?? "").Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return tanimli.Where(x => !gruplar.Contains(x.Trim()))
                .Select(x => $"{x} (aktif personel yok)")
                .ToList();
        }

        var ciftler = _portalYetki.PanelSubeCiftleri(kisi.PersonelKodu, $"{kisi.Ad} {kisi.Soyad}", _ayar.FormOku());

        var isGruplari = Aktifler().Select(x => x.IsGrubu).Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        return ciftler
            .Where(c => !isGruplari.Any(g =>
                PortalYetkiServisi.SubeIcinde(new[] { c.Kod, c.Ad ?? "" }, g)))
            .Select(c => string.IsNullOrWhiteSpace(c.Ad) ? $"{c.Kod} (şube tanımında adı yok)" : c.Ad)
            .ToList();
    }

    /// <summary>Kişinin iş yeri onay kurallarında birebir geçmiyorsa şubededir.</summary>
    public bool Subede(PersonelKaydi x) =>
        !string.IsNullOrWhiteSpace(x?.IsGrubu)
        && string.Equals(_kural.IsYeriBul(x.IsGrubu), IzinOnayKuralServisi.Sube, StringComparison.OrdinalIgnoreCase);

    /// <summary>Bu kişinin sorumlu olduğu personel (1. onaylayanı olduğu kişiler).</summary>
    public List<PersonelKaydi> SorumluOlduklari(PersonelKaydi kisi)
    {
        if (kisi is null) return new();

        var ben = K(kisi.PersonelKodu);
        var y = Yoneticiler();
        var dep = _departman.Oku();

        /* Onaylayan listesi departmanı zaten içeriyor (departman personelinin
           1. onaylayanı departman yöneticisi). Departman yöneticisi olup
           onay listesine düşmeyenler için departman ayrıca ekleniyor. */
        var depSorumlu = dep.Sorumlulari(ben);

        /* İş yeri (mağaza/depo) yöneticisi başka iş yerindeki birinin
           onaylayanı ancak ona özel atanmışsa (onay tablosunda sicil ile)
           sayılır. Kişinin onaylayan listesi kalabalıksa (ör. o pozisyonun
           bütün yöneticileri ortak havuz olarak dönmüşse) bu, başka
           mağazanın personelini Ekibim'e taşıyordu (02.10.2026,
           Bakırköy-3: 18 kişilik mağazada 35 kişi). */
        var isYeriYoneticisi = _kural.IsYeriYoneticisiMi(kisi.Pozisyon, kisi.IsGrubu)
                               && !string.IsNullOrWhiteSpace(kisi.IsGrubu);
        var benimYerim = (kisi.IsGrubu ?? "").Trim();

        var sonuc = Aktifler()
            .Where(x =>
            {
                var o = K(x.PersonelKodu);

                /* 16.10.2026: şubede çalışan kişi eski departman üyeliğiyle
                   genel merkez yöneticisinin ekibine girmez; normal onay
                   kuralına (mağaza müdürü) bakılır. */
                if (depSorumlu.Contains(o) && !Subede(x)) return true;

                if (!y.TryGetValue(o, out var s) || !s.Contains(ben)) return false;

                if (!isYeriYoneticisi) return true;

                var ayniYer = string.Equals((x.IsGrubu ?? "").Trim(), benimYerim, StringComparison.OrdinalIgnoreCase);

                return ayniYer || s.Count <= 2;
            })
            .ToList();

        /* Mağaza müdürü ve depo müdürü iş yerinin bütün personelinden
           sorumlu: onay tablosunda pozisyonu eksik olan (Tadolya Şefi gibi)
           personel de ekibinde ve puantajında görünsün. Yalnızca tabloya
           bakınca bu kişiler kayboluyor, sayı İK panelindekinden az
           çıkıyordu. */
        if (isYeriYoneticisi)
        {
            var mevcut = sonuc.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

            /* Departmanı tanımlı olanlar iş yeri üzerinden eklenmiyor:
               depoda departmanlar kurulduysa ekip departmandan gelir. */
            sonuc.AddRange(Aktifler().Where(x =>
                K(x.PersonelKodu) != ben
                && !mevcut.Contains(K(x.PersonelKodu))
                && (!dep.Tanimli(x.PersonelKodu) || Subede(x))
                && string.Equals((x.IsGrubu ?? "").Trim(), kisi.IsGrubu.Trim(), StringComparison.OrdinalIgnoreCase)));
        }

        return sonuc;
    }

    /* ==================================================================== */
    /* Bölge müdürü (06.10.2026)                                            */
    /* ==================================================================== */

    /// <summary>Bölge müdürünün şubelerindeki bütün aktif personel (kendisi hariç).</summary>
    public List<PersonelKaydi> BolgePersoneli(PersonelKaydi ben)
    {
        var subeler = BolgeSubeleri(ben);

        if (subeler.Count == 0) return new();

        var kume = subeler.Select(x => x.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var benK = K(ben.PersonelKodu);

        return Aktifler()
            .Where(x => K(x.PersonelKodu) != benK && kume.Contains((x.IsGrubu ?? "").Trim()))
            .ToList();
    }

    /// <summary>Pozisyonu müdür yardımcısı mı ("Müdür Yardımcısı", "Mağaza Müdür Yrd.")</summary>
    public static bool MudurYardimcisiMi(PersonelKaydi p)
    {
        var a = PersonelKaynagiServisi.DuzAnahtar(p?.Pozisyon);
        return a.Contains("muduryard") || a.Contains("muduryrd");
    }

    /// <summary>Şubedeki (genel merkez değil) müdür yardımcısı mı</summary>
    public bool SubeMudurYardimcisiMi(PersonelKaydi p) =>
        p is not null && MudurYardimcisiMi(p) && !string.IsNullOrWhiteSpace(p.IsGrubu)
        && !PersonelKaynagiServisi.DuzAnahtar(p.IsGrubu).Contains("merkez")
        && !PersonelKaynagiServisi.DuzAnahtar(_kural.IsYeriBul(p.IsGrubu)).Contains("merkez");

    /// <summary>Müdür yardımcısının planını yapabildiği kişiler: şubesindeki personel (kendisi ve şube yöneticisi hariç)</summary>
    public List<PersonelKaydi> SubePlanKisileri(PersonelKaydi ben)
    {
        var yer = (ben?.IsGrubu ?? "").Trim();
        var benK = K(ben?.PersonelKodu);
        return Aktifler()
            .Where(x => K(x.PersonelKodu) != benK
                        && string.Equals((x.IsGrubu ?? "").Trim(), yer, StringComparison.OrdinalIgnoreCase)
                        && !SubeYoneticisiMi(x))
            .ToList();
    }

    /// <summary>Şubenin müdür yardımcıları (vardiya planı bildirimleri için)</summary>
    public List<PersonelKaydi> SubeMudurYardimcilari(string isGrubu)
    {
        var yer = (isGrubu ?? "").Trim();
        if (yer.Length == 0) return new();
        return Aktifler()
            .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), yer, StringComparison.OrdinalIgnoreCase) && SubeMudurYardimcisiMi(x))
            .ToList();
    }

    /// <summary>Şubenin yöneticisi mi: onay tablosundaki 1. onaylayan pozisyonu.</summary>
    public bool SubeYoneticisiMi(PersonelKaydi p) =>
        p is not null && _kural.IsYeriYoneticisiMi(p.Pozisyon, p.IsGrubu);

    /// <summary>
    /// Vardiya planı kapsamı.
    ///
    /// <para>
    /// Bölge müdürü şubelerinin mağaza müdürlerinin planını yapıyor
    /// (06.10.2026): her şubeden onay tablosunda iş yerinin 1. onaylayanı
    /// olan pozisyondakiler; o pozisyonda kimse yoksa pozisyon adında
    /// "müdür" geçenler. Şube personelinin planını mağaza müdürü yapıyor,
    /// bölge müdürü yapmıyor. Bölge dışında 1. onaylayanı olduğu kişiler
    /// (bölge koordinatörü gibi) eskisi gibi kapsamda.
    /// </para>
    ///
    /// <para>Bölge müdürü değilse sorumlu olduğu kişiler (mağaza müdürü → mağazası).</para>
    /// </summary>
    public List<PersonelKaydi> VardiyaKapsami(PersonelKaydi ben)
    {
        if (ben is null) return new();

        /* Ekibim kuralı (09.10.2026): İK vardiya planını kapattıysa kişi
           ekibin planını görmüyor; yalnızca kendi planı kalıyor. */
        if (_ekibim?.Bul(ben.PersonelKodu) is { VardiyaPlani: false }) return new();

        var bolge = BolgePersoneli(ben);

        if (bolge.Count == 0 && BolgeSubeleri(ben).Count == 0)
        {
            var sorumlu = SorumluOlduklari(ben);

            /* Müdür yardımcısı (09.10.2026): kendi şubesindeki personelin
               planını da yapar (şube yöneticisi hariç; onun planını bölge
               müdürü yapıyor). Onay akışları değişmiyor, yalnızca plan. */
            if (SubeMudurYardimcisiMi(ben))
            {
                var var_ = sorumlu.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);
                sorumlu.AddRange(SubePlanKisileri(ben).Where(x => var_.Add(K(x.PersonelKodu))));
                sorumlu = sorumlu.OrderBy(x => x.Ad).ThenBy(x => x.Soyad).ToList();
            }

            return sorumlu;
        }

        var yoneticiler = bolge
            .GroupBy(x => (x.IsGrubu ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .SelectMany(g =>
            {
                var y = g.Where(SubeYoneticisiMi).ToList();

                if (y.Count == 0)
                    y = g.Where(x => PersonelKaynagiServisi.DuzAnahtar(x.Pozisyon).Contains("mudur")).ToList();

                return y;
            })
            .ToList();

        var bolgeKume = bolge.Select(x => (x.IsGrubu ?? "").Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var mevcut = yoneticiler.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        yoneticiler.AddRange(SorumluOlduklari(ben).Where(x =>
            !bolgeKume.Contains((x.IsGrubu ?? "").Trim()) && mevcut.Add(K(x.PersonelKodu))));

        return yoneticiler
            .OrderBy(x => (x.IsGrubu ?? "").Trim(), StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
            .ThenBy(x => x.Ad).ThenBy(x => x.Soyad)
            .ToList();
    }

    /// <summary>
    /// Ekip arkadaşları: aynı yöneticiye bağlı olanlar, yöneticinin kendisi
    /// ve (yöneticiyse) sorumlu olduğu kişiler.
    /// </summary>
    public List<PersonelKaydi> EkipArkadaslari(PersonelKaydi kisi)
    {
        if (kisi is null) return new();

        /* Yönetici yalnızca sorumlu olduğu kişileri görüyor: mağaza
           müdürü kendi mağazasının personelini, diğer mağaza müdürlerini
           değil. Aynı bölge müdürüne bağlı olmak mağaza müdürlerini
           birbirinin ekip arkadaşı yapıyordu. */
        var sorumlu = SorumluOlduklari(kisi);

        if (sorumlu.Count > 0)
            return sorumlu.OrderBy(x => x.Ad).ThenBy(x => x.Soyad).ToList();

        var ben = K(kisi.PersonelKodu);
        var dep = _departman.Oku();

        /* Departmanı tanımlı personel yalnızca kendi departmanını görür:
           yöneticileri ve departman arkadaşları. Genel merkezde aynı
           yöneticiye bağlı olmak bütün merkezi ekip yapıyordu. */
        if (dep.PersonelDepartmani.ContainsKey(ben))
        {
            var arkadaslar = dep.DepartmanArkadaslari(ben);

            return Aktifler()
                .Where(x => arkadaslar.Contains(K(x.PersonelKodu)))
                .OrderBy(x => x.Ad).ThenBy(x => x.Soyad)
                .ToList();
        }

        var y = Yoneticiler();
        var benimYoneticilerim = y.TryGetValue(ben, out var bs) ? bs : new HashSet<string>();

        /* Mağaza ve depoda iş yeri arkadaşları da ekipte: onay tablosunda
           pozisyonu eksik olan personel kimseyi göremiyordu. Genel
           merkezde değil; orada ekip yöneticiye göre. */
        var isYeri = (kisi.IsGrubu ?? "").Trim();
        var isYeriEkibi = isYeri.Length > 0
            && !PersonelKaynagiServisi.MeslekAnahtari(_kural.IsYeriBul(isYeri)).Contains("merkez");

        return Aktifler()
            .Where(x => K(x.PersonelKodu) != ben)
            /* Departmanı tanımlı kişiler, kendi yöneticisi değilse başka
               ekiplerde görünmez */
            .Where(x => !dep.PersonelDepartmani.ContainsKey(K(x.PersonelKodu))
                        || benimYoneticilerim.Contains(K(x.PersonelKodu)))
            .Where(x =>
            {
                var o = K(x.PersonelKodu);
                var onunYoneticileri = y.TryGetValue(o, out var s) ? s : new HashSet<string>();

                return benimYoneticilerim.Contains(o)
                    || onunYoneticileri.Contains(ben)
                    || onunYoneticileri.Overlaps(benimYoneticilerim)
                    || (isYeriEkibi && string.Equals((x.IsGrubu ?? "").Trim(), isYeri, StringComparison.OrdinalIgnoreCase));
            })
            .OrderBy(x => x.Ad).ThenBy(x => x.Soyad)
            .ToList();
    }

    /// <summary>
    /// Yöneticinin bu kişi için işlem yapabilmesi (fazla mesai gir, rotasyon
    /// talebi, hatırlatma): ayrıntıyı görebilen yönetici ya da İK'nın Ekibim
    /// kuralıyla eklediği kişi (kural "işlem" açıksa). Kendisi için değil.
    /// </summary>
    public bool IslemYapabilir(PersonelKaydi ben, PersonelKaydi hedef)
    {
        if (ben is null || hedef is null) return false;
        if (AyrintiGorebilir(ben, hedef)) return true;
        return _ekibim?.EkIslem(ben, hedef, Aktifler()) ?? false;
    }

    /// <summary>
    /// Bu kişi hedef personelin ayrıntısını (izin, puantaj) görebilir mi:
    /// 1. onaylayanıysa ya da hedefin şubesi bölgesindeyse.
    /// </summary>
    public bool AyrintiGorebilir(PersonelKaydi ben, PersonelKaydi hedef)
    {
        if (ben is null || hedef is null) return false;

        /* Personel kendi puantajını görüyor */
        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu)) return true;

        var y = Yoneticiler();

        if (y.TryGetValue(K(hedef.PersonelKodu), out var s) && s.Contains(K(ben.PersonelKodu)))
            return true;

        var dep = _departman.Oku();

        if (dep.Sorumlulari(ben.PersonelKodu).Contains(K(hedef.PersonelKodu)))
            return true;

        /* İş yeri yöneticisi kendi iş yerindeki herkesi görebiliyor
           (departmanı tanımlı olanlar hariç: onları departman yöneticisi) */
        if (!dep.Tanimli(hedef.PersonelKodu)
            && _kural.IsYeriYoneticisiMi(ben.Pozisyon, ben.IsGrubu)
            && string.Equals((hedef.IsGrubu ?? "").Trim(), (ben.IsGrubu ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
            && K(hedef.PersonelKodu) != K(ben.PersonelKodu))
            return true;

        return BolgeSubeleri(ben).Any(x => PersonelKaynagiServisi.Benziyor(x, hedef.IsGrubu ?? ""));
    }
}

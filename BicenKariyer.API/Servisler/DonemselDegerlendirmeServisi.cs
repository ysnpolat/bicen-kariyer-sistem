using System.Globalization;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Dönemsel personel değerlendirmesi (20.10.2026)
/// ---------------------------------------------------------------------------
/// Mağaza müdürü (açılırsa müdür yardımcısı da) 3 ayda bir şubesindeki
/// personeli değerlendirir: pozisyona özel 1–5 puanlı ve açık uçlu sorular,
/// sonda 1–10 genel puan. Kurallar KRY_AYARLAR "DONEMSEL_DEGERLENDIRME",
/// sorular KRY_DD_SORU, kayıtlar KRY_DD_DEGERLENDIRME + KRY_DD_CEVAP.
///
/// <para>
/// Oryantasyon takipten ayrıdır: oryantasyon ilk yılın 7. gün / 2. ay /
/// 6. ay / 1. yıl formlarıdır. En az kıdem (varsayılan 60 gün) dolmayan
/// personel dönem listesine girmez; onu oryantasyon formları kapsar.
/// </para>
/// </summary>
public class DonemselDegerlendirmeServisi
{
    public const string AyarAnahtari = "DONEMSEL_DEGERLENDIRME";
    public const string GenelSet = "Genel";

    /// <summary>Her pozisyona sorulan ortak sorular (pozisyon sorularından önce).</summary>
    public const string OrtakSet = "Ortak";

    public sealed class Ayar
    {
        public bool Acik { get; set; } = true;
        public List<int> Aylar { get; set; } = new() { 1, 4, 7, 10 };
        public int BasGun { get; set; } = 1;
        public int BitGun { get; set; } = 15;
        public bool MudurDegerlendirir { get; set; } = true;
        public bool YardimciDegerlendirir { get; set; }

        /// <summary>Müdür yardımcıları da değerlendirilsin (mağaza müdürü değerlendirir).</summary>
        public bool YardimciDegerlendirilir { get; set; } = true;

        public int EnAzKidemGun { get; set; } = 60;

        /// <summary>1–5 puan etiketleri</summary>
        public List<string> OlcekEtiketleri { get; set; } = new() { "Hiçbir zaman", "Nadiren", "Bazen", "Çoğunlukla", "Her zaman" };
        public List<int> HatirlatmaGunleri { get; set; } = new() { 5, 12 };

        /// <summary>Takvim dışında elle açılan dönem ("yyyy-MM") ve son günü.</summary>
        public string ElleDonem { get; set; }
        public DateTime? ElleBitis { get; set; }

        /* Kademeler (23.10.2026). Değerlendiren, kişinin izin onay
           tablosundaki 1. onaylayanıdır (mağaza müdürü → bölge müdürü,
           bölge müdürü → satış GMY, depo personeli → depo müdürü, depo
           müdürü → depo GMY). Sicil yazılırsa o kişi değerlendirir. */

        /// <summary>Bölge müdürü mağaza müdürlerini değerlendirir</summary>
        public bool MagazaMuduruKademesi { get; set; }

        /// <summary>Satıştan sorumlu GMY bölge müdürlerini değerlendirir</summary>
        public bool BolgeMuduruKademesi { get; set; }
        public string BolgeMuduruDegerlendiren { get; set; }

        /// <summary>Depo müdürü lojistik depo personelini değerlendirir</summary>
        public bool DepoKademesi { get; set; }

        /// <summary>Depodan sorumlu GMY depo müdürünü değerlendirir</summary>
        public bool DepoMuduruKademesi { get; set; }
        public string DepoMuduruDegerlendiren { get; set; }

        /// <summary>Pozisyon → soru seti elle eşleme ("depo:" önekli anahtar depo için)</summary>
        public Dictionary<string, string> SetEslesme { get; set; } = new();
    }

    /* Kapsamlar: kişinin hangi kademede değerlendirildiği */
    public const string KSube = "sube";
    public const string KMagazaMuduru = "magazaMuduru";
    public const string KBolgeMuduru = "bolgeMuduru";
    public const string KDepo = "depo";
    public const string KDepoMuduru = "depoMuduru";

    public static readonly (string Kod, string Ad, string Degerlendiren)[] KapsamTanimlari =
    {
        (KSube, "Şube personeli", "Mağaza müdürü"),
        (KMagazaMuduru, "Mağaza müdürleri", "Bölge müdürü"),
        (KBolgeMuduru, "Bölge müdürleri", "Satıştan sorumlu GMY"),
        (KDepo, "Lojistik depo personeli", "Depo müdürü"),
        (KDepoMuduru, "Depo müdürü", "Depodan sorumlu GMY"),
    };

    public static string KapsamAdi(string k) => KapsamTanimlari.FirstOrDefault(x => x.Kod == (k ?? KSube)).Ad ?? "Şube personeli";

    /// <summary>Depo soru setlerinin adı önekli tutuluyor: "Depo · Ortak", "Depo · RT Operatörü"</summary>
    public const string DepoOnek = "Depo · ";
    public static bool DepoKapsami(string k) => k is KDepo or KDepoMuduru;

    public sealed record Donem(string Kod, string Ad, DateTime Bas, DateTime Bit);

    public sealed class Soru
    {
        public int Id { get; set; }
        public string Pozisyon { get; set; }
        public int Sira { get; set; }
        public string Tur { get; set; }
        public string Metin { get; set; }
        public bool Zorunlu { get; set; }
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly EkipServisi _ekip;

    private readonly IzinOnayKuralServisi _kural;

    public DonemselDegerlendirmeServisi(VeritabaniServisi vt, AyarServisi ayar, EkipServisi ekip, IzinOnayKuralServisi kural)
    {
        _vt = vt;
        _ayar = ayar;
        _ekip = ekip;
        _kural = kural;
    }

    public static string K(string s) => (s ?? "").Trim().TrimStart('0');

    public static string DonemAdi(string kod)
    {
        if (string.IsNullOrWhiteSpace(kod) || kod.Length < 7) return kod;
        return DateTime.TryParseExact(kod + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)
            ? $"{t:yyyy} · {Tr.DateTimeFormat.GetMonthName(t.Month)}"
            : kod;
    }

    /* ------------------------------------------------------------------ ayar */

    public Ayar AyarOku()
    {
        var a = _ayar.Oku(AyarAnahtari, new Ayar());
        a.Aylar = (a.Aylar ?? new()).Where(x => x is >= 1 and <= 12).Distinct().OrderBy(x => x).ToList();
        a.BasGun = Math.Clamp(a.BasGun, 1, 28);
        a.BitGun = Math.Clamp(a.BitGun, a.BasGun, 31);
        a.EnAzKidemGun = Math.Clamp(a.EnAzKidemGun, 0, 365);
        a.HatirlatmaGunleri ??= new();
        a.SetEslesme ??= new();
        if (a.OlcekEtiketleri is not { Count: 5 } || a.OlcekEtiketleri.Any(string.IsNullOrWhiteSpace))
            a.OlcekEtiketleri = new() { "Hiçbir zaman", "Nadiren", "Bazen", "Çoğunlukla", "Her zaman" };
        return a;
    }

    public void AyarYaz(Ayar a) => _ayar.Yaz(AyarAnahtari, a);

    /// <summary>Şu an açık dönem (takvimden ya da elle açılan); yoksa null.</summary>
    public Donem AcikDonem(DateTime? an = null)
    {
        var a = AyarOku();
        if (!a.Acik) return null;
        var bugun = (an ?? DateTime.Now).Date;

        if (!string.IsNullOrWhiteSpace(a.ElleDonem) && a.ElleBitis is DateTime eb && bugun <= eb.Date)
        {
            var bas = DateTime.TryParseExact(a.ElleDonem + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t) ? t : bugun;
            return new(a.ElleDonem, DonemAdi(a.ElleDonem), bas, eb.Date);
        }

        if (!a.Aylar.Contains(bugun.Month)) return null;
        var son = Math.Min(a.BitGun, DateTime.DaysInMonth(bugun.Year, bugun.Month));
        if (bugun.Day < a.BasGun || bugun.Day > son) return null;
        var kod = $"{bugun:yyyy-MM}";
        return new(kod, DonemAdi(kod), new DateTime(bugun.Year, bugun.Month, a.BasGun), new DateTime(bugun.Year, bugun.Month, son));
    }

    /// <summary>Bir sonraki dönemin başlangıcı (bilgi için).</summary>
    public DateTime? SonrakiDonem()
    {
        var a = AyarOku();
        if (!a.Acik || a.Aylar.Count == 0) return null;
        var t = DateTime.Today;
        for (var i = 0; i < 24; i++)
        {
            var ay = new DateTime(t.Year, t.Month, 1).AddMonths(i);
            if (!a.Aylar.Contains(ay.Month)) continue;
            var bas = ay.AddDays(a.BasGun - 1);
            if (bas > t) return bas;
        }
        return null;
    }

    /* ------------------------------------------------------------------ kimler */

    /// <summary>Şube kademesi: şubede mağaza müdürü ya da açıksa yardımcısı.</summary>
    public bool SubeDegerlendiricisiMi(PersonelKaydi ben, Ayar a = null)
    {
        if (ben is null) return false;
        a ??= AyarOku();
        if (!a.Acik || !_ekip.Subede(ben)) return false;
        if (a.MudurDegerlendirir && _ekip.SubeYoneticisiMi(ben)) return true;
        return a.YardimciDegerlendirir && _ekip.SubeMudurYardimcisiMi(ben);
    }

    /// <summary>Bu kişi değerlendirme yapabilir mi (herhangi bir kademede).</summary>
    public bool DegerlendirebilirMi(PersonelKaydi ben, Ayar a = null)
    {
        if (ben is null) return false;
        a ??= AyarOku();
        if (!a.Acik) return false;
        return SubeDegerlendiricisiMi(ben, a) || UstKademeHedefleri(ben, a).Count > 0;
    }

    /* ------------------------------------------------------------------ kademeler */

    /// <summary>Kişi lojistik depoda mı (onay tablosunda iş yeri adında "depo" geçiyor)</summary>
    public bool DepodaMi(PersonelKaydi x)
    {
        if (string.IsNullOrWhiteSpace(x?.IsGrubu) || _ekip.Subede(x)) return false;
        return PersonelKaynagiServisi.DuzAnahtar(_kural.IsYeriBul(x.IsGrubu)).Contains("depo");
    }

    /// <summary>Kişinin değerlendirme kapsamı; hiçbirine girmiyorsa null (genel merkez).</summary>
    public string Kapsam(PersonelKaydi x)
    {
        if (x is null) return null;
        if (_ekip.Subede(x)) return _ekip.SubeYoneticisiMi(x) ? KMagazaMuduru : KSube;
        if (EkipServisi.BolgeMuduruMu(x.Pozisyon)) return KBolgeMuduru;
        if (DepodaMi(x)) return _kural.IsYeriYoneticisiMi(x.Pozisyon, x.IsGrubu) ? KDepoMuduru : KDepo;
        return null;
    }

    private static bool KademeAcik(Ayar a, string k) => k switch
    {
        KMagazaMuduru => a.MagazaMuduruKademesi,
        KBolgeMuduru => a.BolgeMuduruKademesi,
        KDepo => a.DepoKademesi,
        KDepoMuduru => a.DepoMuduruKademesi,
        _ => false,
    };

    private static string ElleDegerlendiren(Ayar a, string k) => K(k switch
    {
        KBolgeMuduru => a.BolgeMuduruDegerlendiren,
        KDepoMuduru => a.DepoMuduruDegerlendiren,
        _ => null,
    });

    private bool KidemTamam(PersonelKaydi x, Ayar a) =>
        (x.GirisTarihi ?? x.KidemTarihi ?? DateTime.MinValue) <= DateTime.Today.AddDays(-a.EnAzKidemGun);

    /// <summary>
    /// Üst kademelerdeki bütün değerlendirme atamaları: değerlendirilen,
    /// kapsamı ve değerlendirenlerin sicilleri. Değerlendiren ayarda sicille
    /// yazılmadıysa kişinin izin onay tablosundaki 1. onaylayanları.
    /// </summary>
    public List<(PersonelKaydi Kisi, string Kapsam, HashSet<string> Degerlendirenler)> UstKademeAtamalari(Ayar a = null)
    {
        a ??= AyarOku();
        var sonuc = new List<(PersonelKaydi, string, HashSet<string>)>();
        if (!a.Acik || !(a.MagazaMuduruKademesi || a.BolgeMuduruKademesi || a.DepoKademesi || a.DepoMuduruKademesi))
            return sonuc;

        Dictionary<string, HashSet<string>> yon = null;
        foreach (var x in _ekip.Aktifler())
        {
            var k = Kapsam(x);
            if (k is null || k == KSube || !KademeAcik(a, k) || !KidemTamam(x, a)) continue;

            var elle = ElleDegerlendiren(a, k);
            HashSet<string> kim;
            if (elle.Length > 0) kim = new(StringComparer.OrdinalIgnoreCase) { elle };
            else
            {
                yon ??= _ekip.Yoneticiler();
                kim = yon.TryGetValue(K(x.PersonelKodu), out var y) ? y : new(StringComparer.OrdinalIgnoreCase);
            }
            kim = kim.Where(s => s != K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            sonuc.Add((x, k, kim));
        }
        return sonuc;
    }

    /// <summary>Bu kişinin üst kademelerde değerlendireceği kişiler.</summary>
    public List<(PersonelKaydi Kisi, string Kapsam)> UstKademeHedefleri(PersonelKaydi ben, Ayar a = null)
    {
        var benK = K(ben?.PersonelKodu);
        if (benK.Length == 0) return new();
        return UstKademeAtamalari(a).Where(x => x.Degerlendirenler.Contains(benK)).Select(x => (x.Kisi, x.Kapsam)).ToList();
    }

    /// <summary>Kişinin bütün değerlendirecekleri: şube ekibi + üst kademeler.</summary>
    public List<(PersonelKaydi Kisi, string Kapsam)> Hedefler(PersonelKaydi ben, Ayar a = null)
    {
        a ??= AyarOku();
        if (ben is null || !a.Acik) return new();
        var l = new List<(PersonelKaydi, string)>();
        if (SubeDegerlendiricisiMi(ben, a)) l.AddRange(SubeEkibi(ben.IsGrubu, a, ben).Select(x => (x, KSube)));
        foreach (var h in UstKademeHedefleri(ben, a))
            if (!l.Any(y => K(y.Item1.PersonelKodu) == K(h.Kisi.PersonelKodu))) l.Add(h);
        return l;
    }

    /// <summary>Bir kapsamda değerlendirilecek herkes (rapor kadrosu için).</summary>
    public List<PersonelKaydi> KapsamKisileri(string kapsam, Ayar a = null)
    {
        a ??= AyarOku();
        if (string.IsNullOrEmpty(kapsam) || kapsam == KSube)
            return _ekip.Aktifler().Where(x => _ekip.Subede(x) && !string.IsNullOrWhiteSpace(x.IsGrubu))
                .GroupBy(x => x.IsGrubu.Trim(), StringComparer.OrdinalIgnoreCase)
                .SelectMany(g => SubeEkibi(g.Key, a)).ToList();
        if (!KademeAcik(a, kapsam)) return new();
        return _ekip.Aktifler().Where(x => Kapsam(x) == kapsam && KidemTamam(x, a)).ToList();
    }

    /// <summary>
    /// Şubenin değerlendirilecek personeli: mağaza müdürü hariç; müdür
    /// yardımcıları ayara göre. Değerlendiren kendisini görmez; yardımcı
    /// değerlendiriyorsa diğer yardımcıları da görmez. En az kıdem dolmuş.
    /// </summary>
    public List<PersonelKaydi> SubeEkibi(string isGrubu, Ayar a = null, PersonelKaydi ben = null)
    {
        a ??= AyarOku();
        var yer = (isGrubu ?? "").Trim();
        if (yer.Length == 0) return new();
        var sinir = DateTime.Today.AddDays(-a.EnAzKidemGun);
        var benK = K(ben?.PersonelKodu);
        var benYardimci = ben is not null && EkipServisi.MudurYardimcisiMi(ben) && !_ekip.SubeYoneticisiMi(ben);
        return _ekip.Aktifler()
            .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), yer, StringComparison.OrdinalIgnoreCase))
            .Where(x => benK.Length == 0 || K(x.PersonelKodu) != benK)
            .Where(x => !_ekip.SubeYoneticisiMi(x))
            .Where(x => !EkipServisi.MudurYardimcisiMi(x) || (a.YardimciDegerlendirilir && !benYardimci))
            .Where(x => (x.GirisTarihi ?? x.KidemTarihi ?? DateTime.MinValue) <= sinir)
            .OrderBy(x => $"{x.Ad} {x.Soyad}", StringComparer.Create(Tr, true))
            .ToList();
    }

    /// <summary>Bütün şubelerin değerlendirmecileri (bildirim için).</summary>
    public List<PersonelKaydi> Degerlendirenler()
    {
        var a = AyarOku();
        var ust = UstKademeAtamalari(a).SelectMany(x => x.Degerlendirenler).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return _ekip.Aktifler().Where(x => SubeDegerlendiricisiMi(x, a) || ust.Contains(K(x.PersonelKodu))).ToList();
    }

    /* ------------------------------------------------------------------ sorular */

    /// <summary>Eski çağrılar: mağaza kapsamı</summary>
    public List<Soru> Sorular(System.Data.IDbConnection db, string pozisyon) => Sorular(db, pozisyon, KSube);

    /// <summary>
    /// Kişiye sorulacak sorular. Sıra: ortak puanlı → pozisyon puanlı →
    /// ortak açık uçlu → pozisyon açık uçlu. Depo kapsamında setler
    /// "Depo · " önekli; depoda seti olmayan pozisyona da Genel sorulur.
    /// </summary>
    public List<Soru> Sorular(System.Data.IDbConnection db, string pozisyon, string kapsam)
    {
        DonemselSoruTohumu.Yukle(db);
        var hepsi = db.Query<Soru>(@"
SELECT id AS Id, pozisyon AS Pozisyon, sira AS Sira, tur AS Tur, metin AS Metin, zorunlu AS Zorunlu
FROM KRY_DD_SORU WHERE aktif = 1 ORDER BY sira, id").ToList();

        var depo = DepoKapsami(kapsam);
        var setAdi = SetAdi(pozisyon, depo, hepsi.Select(x => x.Pozisyon).Distinct().ToList(), AyarOku());
        var l = hepsi.Where(x => x.Pozisyon == setAdi).ToList();
        var ortakAdi = depo && hepsi.Any(x => x.Pozisyon == DepoOnek + OrtakSet) ? DepoOnek + OrtakSet : OrtakSet;
        var ortak = hepsi.Where(x => x.Pozisyon == ortakAdi).ToList();

        return ortak.Where(x => x.Tur == "olcek")
            .Concat(l.Where(x => x.Tur == "olcek"))
            .Concat(ortak.Where(x => x.Tur != "olcek"))
            .Concat(l.Where(x => x.Tur != "olcek"))
            .ToList();
    }

    /* Mikro'daki pozisyon adlarının soru setine karşılıkları */
    private static readonly Dictionary<string, string> MagazaTakma = new()
    {
        ["tadolya"] = "Pastane - Tandolya Fırın", ["tandolya"] = "Pastane - Tandolya Fırın",
        ["pastane"] = "Pastane - Tandolya Fırın", ["firinci"] = "Pastane - Tandolya Fırın", ["firin"] = "Pastane - Tandolya Fırın",
        ["muduryardimcisi"] = "Müdür Yardımcısı", ["muduryrd"] = "Müdür Yardımcısı", ["magazamuduryrd"] = "Müdür Yardımcısı",
        ["magazamuduryardimcisi"] = "Müdür Yardımcısı",
        ["asci"] = "Aşçı", ["ascibasi"] = "Aşçı",
        ["temizlikgorev"] = "Temizlik Görevlisi", ["temizlikpersoneli"] = "Temizlik Görevlisi",
        ["magazamuduru"] = "Mağaza Müdürü", ["magazamuduruvkl"] = "Mağaza Müdürü",
        ["bolgemuduru"] = "Bölge Müdürü",
    };

    private static readonly Dictionary<string, string> DepoTakma = new()
    {
        ["depogorevlisi"] = "Depo Personeli", ["depopersoneli"] = "Depo Personeli", ["depoiscisi"] = "Depo Personeli",
        ["depocalisani"] = "Depo Personeli",
        ["servissoforu"] = "Sevkiyat Şoförü", ["sevkiyatsoforu"] = "Sevkiyat Şoförü", ["sofor"] = "Sevkiyat Şoförü",
        ["depomuduryrd"] = "Depo Müdür Yardımcısı", ["depomuduryardimcisi"] = "Depo Müdür Yardımcısı",
        ["rtoperatoru"] = "RT Operatörü", ["reachtruckoperatoru"] = "RT Operatörü", ["forkliftoperatoru"] = "RT Operatörü",
        ["temizlikgorev"] = "Temizlik Görevlisi",
        ["depomuduru"] = "Depo Müdürü",
    };

    /// <summary>Pozisyon adının ek ve parantezlerden arınmış anahtarı ("KASİYER PART" → "kasiyer")</summary>
    public static string PozisyonAnahtari(string pozisyon)
    {
        var p = pozisyon ?? "";
        var i = p.IndexOf('(');
        if (i > 0) p = p[..i];
        var a = PersonelKaynagiServisi.DuzAnahtar(p);
        foreach (var ek in new[] { "part", "cirak", "vkl", "stajyer" })
            if (a.Length > ek.Length + 2 && a.EndsWith(ek)) a = a[..^ek.Length];
        return a;
    }

    /// <summary>
    /// Pozisyonun soru seti adı: elle eşleme → aynı ad → takma ad → en
    /// uzun önek → Genel. Depoda set adları "Depo · " önekli.
    /// </summary>
    public static string SetAdi(string pozisyon, bool depo, List<string> setler, Ayar a)
    {
        var onek = depo ? DepoOnek : "";
        var adaylar = setler
            .Where(x => x != GenelSet && x != OrtakSet && x != DepoOnek + OrtakSet && x != DepoOnek + GenelSet)
            .Where(x => depo ? x.StartsWith(DepoOnek) : !x.StartsWith(DepoOnek))
            .ToDictionary(x => PersonelKaynagiServisi.DuzAnahtar(depo ? x[DepoOnek.Length..] : x), x => x, StringComparer.Ordinal);

        var tam = PersonelKaynagiServisi.DuzAnahtar(pozisyon);
        var an = PozisyonAnahtari(pozisyon);

        if (a?.SetEslesme is { } es && es.TryGetValue((depo ? "depo:" : "") + tam, out var elle) && setler.Contains(elle))
            return elle;
        if (adaylar.TryGetValue(tam, out var x1)) return x1;
        if (adaylar.TryGetValue(an, out var x2)) return x2;

        var takma = depo ? DepoTakma : MagazaTakma;
        foreach (var t in takma.OrderByDescending(t => t.Key.Length))
            if ((an == t.Key || an.StartsWith(t.Key)) && adaylar.TryGetValue(PersonelKaynagiServisi.DuzAnahtar(t.Value), out var x3))
                return x3;

        var onekli = adaylar.Where(k => k.Key.Length >= 4 && an.StartsWith(k.Key)).OrderByDescending(k => k.Key.Length).FirstOrDefault();
        if (onekli.Value is not null) return onekli.Value;

        return depo && setler.Contains(DepoOnek + GenelSet) ? DepoOnek + GenelSet : GenelSet;
    }

    /// <summary>Kişinin bu dönemden önceki son değerlendirmesi.</summary>
    public dynamic Onceki(System.Data.IDbConnection db, string personelKodu, string donem) =>
        db.QueryFirstOrDefault(@"
SELECT TOP 1 id, donem, genel_puan AS genelPuan, soru_ort AS soruOrt, genel_aciklama AS genelAciklama
FROM KRY_DD_DEGERLENDIRME
WHERE personel_kodu = @kod AND donem < @donem
ORDER BY donem DESC", new { kod = K(personelKodu), donem });
}

using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Yıllık izin onay tablosu: kimin iznini kim onaylar.
///
/// <para>
/// İnsan Kaynakları'nın hazırladığı tablodan geliyor (iş yeri + pozisyon →
/// 1. onaylayan pozisyon). 2. onay her zaman İnsan Kaynakları, panelden.
/// Organizasyon şeması izin onayında artık kullanılmıyor: şema görsel bir
/// harita, onay kuralı ise İK'nın tek tabloda yönettiği bir karar.
/// </para>
///
/// <para>
/// Onaylayan kişi şöyle bulunuyor:
/// <list type="bullet">
/// <item>Kuralda sicil varsa o kişi (aynı ünvanda birden çok genel müdür
/// yardımcısı olduğu için).</item>
/// <item>1. onay Bölge Müdürü ise, talep edenin şubesini kapsayan bölge
/// müdürü (sorumlu bölgeleri portalda Yetkiler → Kişiye özel'den).</item>
/// <item>Diğerlerinde o pozisyondaki kişi; talep edenle aynı iş yerindeyse
/// o (mağaza müdürü kendi mağazasının), değilse o pozisyondaki herkes
/// (genel merkez pozisyonları).</item>
/// </list>
/// </para>
///
/// <para>
/// Talep edenin iş yeri kuralda birebir yazıyorsa (Z.MERKEZ BURO,
/// AKÇABURGAZ DEPO) o, değilse ŞUBE sayılıyor. Kuralı olmayan pozisyonun
/// talebi 1. onayı atlayıp doğrudan İK'ya düşüyor; panel bu pozisyonları
/// ayrıca listeliyor ki tablo tamamlanabilsin.
/// </para>
/// </summary>
public class IzinOnayKuralServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly PortalYetkiServisi _portalYetki;
    private readonly AyarServisi _ayar;
    private readonly ILogger<IzinOnayKuralServisi> _kayit;
    private readonly DepartmanServisi _departman;

    public IzinOnayKuralServisi(VeritabaniServisi vt, PersonelKaynagiServisi kaynak,
        PortalYetkiServisi portalYetki, AyarServisi ayar, ILogger<IzinOnayKuralServisi> kayit,
        DepartmanServisi departman)
    {
        _vt = vt;
        _departman = departman;
        _kaynak = kaynak;
        _portalYetki = portalYetki;
        _ayar = ayar;
        _kayit = kayit;
    }

    public const string Sube = "ŞUBE";

    public sealed record Kural(int Id, string IsYeri, string Pozisyon, string Onay1, string Onay1Sicil);

    /* ------------------------------------------------------------ bellek */

    private static (DateTime zaman, List<Kural> kurallar)? _bellek;
    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    public List<Kural> Kurallar()
    {
        lock (_kilit)
        {
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.kurallar;
        }

        using var db = _vt.Baglanti();

        Tohumla(db);

        var liste = db.Query<Kural>(@"
SELECT id AS Id, is_yeri AS IsYeri, pozisyon AS Pozisyon,
       onay1 AS Onay1, onay1_sicil AS Onay1Sicil
FROM KRY_IZIN_ONAY_KURAL WHERE aktif = 1
ORDER BY is_yeri, pozisyon").ToList();

        lock (_kilit) _bellek = (DateTime.UtcNow, liste);

        return liste;
    }

    /// <summary>
    /// Tablo boşsa İK'nın hazırladığı ilk tablo yükleniyor (POZİSYON YETKİ,
    /// 71 kural). Sonrası panelden düzenleniyor; tablo boş değilse bir daha
    /// dokunulmuyor.
    /// </summary>
    private static void Tohumla(System.Data.IDbConnection db)
    {
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_IZIN_ONAY_KURAL") > 0) return;

        foreach (var (yer, poz, onay, sicil) in Ilk)
            db.Execute(@"
INSERT INTO KRY_IZIN_ONAY_KURAL (is_yeri, pozisyon, onay1, onay1_sicil, guncelleyen)
VALUES (@yer, @poz, @onay, @sicil, N'ilk yükleme')", new { yer, poz, onay, sicil });
    }

    private static readonly (string, string, string, string)[] Ilk =
    {
        ("ŞUBE", "MAĞAZA MÜDÜRÜ", "BÖLGE MÜDÜRÜ", null),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ VKL.", "BÖLGE MÜDÜRÜ", null),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ VKL", "BÖLGE MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "ARAÇ VE EVRAK SORUML", "GENEL MÜDÜR YARDIMCISI", "0234"),
        ("Z.MERKEZ BURO", "BİLGİSAYAR DONANIM", "TKNOLOJİ VE TKNK MÜD", null),
        ("Z.MERKEZ BURO", "IT UZMANI", "TKNOLOJİ VE TKNK MÜD", null),
        ("Z.MERKEZ BURO", "EKMEK ŞOFÖRÜ", "ARAÇ VE EVRAK SORUML", null),
        ("Z.MERKEZ BURO", "ELEKTRİK USTASI", "TEKNİK İŞLER MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "E-TİCARET YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI", "0381"),
        ("Z.MERKEZ BURO", "FİNANS UZMANI", "GENEL MÜDÜR YARDIMCISI", "0234"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI ÇLŞ.", "GÜVENLİK ODASI YNT.", null),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI PART", "GÜVENLİK ODASI YNT.", null),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI YNT.", "GENEL MÜDÜR", null),
        ("Z.MERKEZ BURO", "TKNOLOJİ VE TKNK MÜD", "GENEL MÜDÜR", null),
        ("Z.MERKEZ BURO", "GENEL MÜDÜR YARDIMCISI", "GENEL MÜDÜR", null),
        ("Z.MERKEZ BURO", "HAL SATIN ALMA", "GENEL MÜDÜR YARDIMCISI", "0381"),
        ("Z.MERKEZ BURO", "HİJYEN VE KALİTE SRM", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "İÇ DENETİM MÜDÜRÜ", "GENEL MÜDÜR", null),
        ("Z.MERKEZ BURO", "İK. YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "İK UZMANI", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "İK. UZMANI", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "İNŞAAT USTASI", "TEKNİK İŞLER MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "KATEGORİ YÖNETİCİSİ", "SATIN ALMA MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "KATEGORİ YÖN. AST.", "SATIN ALMA MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "MUHASEBE ÇALIŞANI", "MUHASEBE MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "MUHASEBE ŞEFİ", "MUHASEBE MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "MUHASEBE MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI", "0234"),
        ("Z.MERKEZ BURO", "PAZARLAMA MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI", "0381"),
        ("Z.MERKEZ BURO", "MUTFAK GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "RAPORLAMA UZMANI", "TKNOLOJİ VE TKNK MÜD", null),
        ("Z.MERKEZ BURO", "RAPORLAMA YÖNETİCİSİ", "TKNOLOJİ VE TKNK MÜD", null),
        ("Z.MERKEZ BURO", "SANTRAL GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "STOK ENVANTER ÇLŞ.", "GENEL MÜDÜR YARDIMCISI", "11220"),
        ("Z.MERKEZ BURO", "STOK YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI", "11220"),
        ("Z.MERKEZ BURO", "SATIN ALMA MÜDÜRÜ", "GENEL MÜDÜR", null),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER YÖN.", "TEKNİK İŞLER MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER ÇLŞ.", "TEKNİK İŞLER MÜDÜRÜ", null),
        ("Z.MERKEZ BURO", "YÖNETİM KURULU AST.", "GENEL MÜDÜR", null),
        ("Z.MERKEZ BURO", "TEMİZLİK GÖREVLİSİ (Z.MERKEZ BURO)", "GENEL MÜDÜR YARDIMCISI", "10664"),
        ("Z.MERKEZ BURO", "BÖLGE MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI", "0381"),
        ("AKÇABURGAZ DEPO", "DEPO GÖREVLİSİ", "DEPO MÜDÜRÜ", null),
        ("AKÇABURGAZ DEPO", "DEPO MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI", "11220"),
        ("AKÇABURGAZ DEPO", "RT OPERATÖRÜ", "DEPO MÜDÜRÜ", null),
        ("AKÇABURGAZ DEPO", "SERVİS ŞÖFÖRÜ", "DEPO MÜDÜRÜ", null),
        ("AKÇABURGAZ DEPO", "ÜRÜN KABUL GÖREVLİSİ", "DEPO MÜDÜRÜ", null),
        ("AKÇABURGAZ DEPO", "SEVKİYAT ŞOFÖRÜ", "DEPO MÜDÜRÜ", null),
        ("AKÇABURGAZ DEPO", "DEPO MÜDÜR YRD.", "DEPO MÜDÜRÜ", null),
        ("AKÇABURGAZ DEPO", "TEMİZLİK GÖREVLİSİ", "DEPO MÜDÜRÜ", null),
        ("ŞUBE", "MANAV", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "REYONER", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "ÜRÜN KABUL GÖREVLİSİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "SEPET TOPLAYICI", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "VALE", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "MÜDÜR YARDIMCISI", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "KASİYER", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "KASA ŞEFİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "TADOLYA", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "REYON ŞEFİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "TEMİZLİK GÖREVLİSİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "MANAV ŞEFİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "ŞARKÜTERİ ŞEFİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "ŞARKÜTERİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "KASAP ŞEFİ", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "KASAP", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "MANAV PART", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "KASİYER PART", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "TADOLYA PART", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "REYONER PART", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "TEMİZLİK GÖREV.PART", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "ŞARKÜTERİ ÇIRAK", "MAĞAZA MÜDÜRÜ", null),
        ("ŞUBE", "KASAP ÇIRAK", "MAĞAZA MÜDÜRÜ", null),
    };

    /* ------------------------------------------------------------ çözüm */

    /// <summary>Şubede varsayılan 1. onaylayan pozisyonu</summary>
    public const string SubeYoneticisi = "MAĞAZA MÜDÜRÜ";

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    /// <summary>Sicil karşılaştırması: baştaki sıfırlar yok sayılıyor ("0234" = "234").</summary>
    public static bool AyniSicil(string a, string b) =>
        string.Equals((a ?? "").Trim().TrimStart('0'), (b ?? "").Trim().TrimStart('0'),
            StringComparison.OrdinalIgnoreCase)
        && !string.IsNullOrWhiteSpace(a);

    /// <summary>Talep edenin iş yeri: kuralda birebir yazıyorsa o, değilse ŞUBE.</summary>
    private static string IsYeri(string isGrubu, List<Kural> kurallar)
    {
        var a = A(isGrubu);

        var tam = kurallar.Select(k => k.IsYeri).Distinct()
            .FirstOrDefault(y => A(y) == a && A(y) != A(Sube));

        return tam ?? Sube;
    }

    /// <summary>Talep edenin iş yeri: kuralda birebir yazıyorsa o, değilse ŞUBE.</summary>
    public string IsYeriBul(string isGrubu) => IsYeri(isGrubu, Kurallar());

    /// <summary>
    /// Kişi kendi iş yerinin yöneticisi mi: pozisyonu, kendi iş yeri
    /// türündeki kurallarda 1. onaylayan olarak geçiyor (mağazada mağaza
    /// müdürü, depoda depo müdürü). Genel merkez hariç: orada 1. onaylayan
    /// olmak bütün merkezin yöneticisi olmak demek değil.
    /// </summary>
    public bool IsYeriYoneticisiMi(string pozisyon, string isGrubu)
    {
        var yer = IsYeriBul(isGrubu);

        if (A(yer).Contains("merkez")) return false;

        var p = A(pozisyon);

        return Kurallar().Any(k => A(k.IsYeri) == A(yer)
                                  && string.IsNullOrWhiteSpace(k.Onay1Sicil)
                                  && A(k.Onay1) == p);
    }

    public Kural KuralBul(string pozisyon, string isGrubu)
    {
        var kurallar = Kurallar();
        var yer = IsYeri(isGrubu, kurallar);
        var p = A(pozisyon);

        return kurallar.FirstOrDefault(k => A(k.IsYeri) == A(yer) && A(k.Pozisyon) == p)
            ?? kurallar.FirstOrDefault(k => A(k.Pozisyon) == p);
    }

    /// <summary>
    /// Talep edenin 1. onaylayanları ve onaylayanın pozisyon adı.
    /// Kural yoksa ya da kimse bulunamazsa liste boş: talep İK'ya geçer.
    /// </summary>
    public (List<PersonelKaydi> Kisiler, string Unvan) Onaylayanlar(
        string sicil, string pozisyon, string isGrubu) =>
        Onaylayanlar(sicil, pozisyon, isGrubu, null, null);

    /// <summary>
    /// Bütün personelin 1. onaylayanları tek seferde: personel listesi,
    /// kurallar ve bölge kapsamları bir kez okunuyor.
    ///
    /// Tek kişilik çözüm her çağrıda personel listesini veritabanından
    /// yeniden çekiyordu; ekip hesabı bunu bin kişi için art arda yapınca
    /// Ekibim ve Puantaj ekranları dakikalarca yükleniyordu.
    /// </summary>
    public Dictionary<string, List<PersonelKaydi>> TopluOnaylayanlar(List<PersonelKaydi> aktif)
    {
        var bolgeBellek = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        var sonuc = new Dictionary<string, List<PersonelKaydi>>(StringComparer.OrdinalIgnoreCase);

        foreach (var p in aktif)
        {
            var (kisiler, _) = Onaylayanlar(p.PersonelKodu, p.Pozisyon, p.IsGrubu, aktif, bolgeBellek);
            sonuc[(p.PersonelKodu ?? "").Trim().TrimStart('0')] = kisiler;
        }

        return sonuc;
    }

    private (List<PersonelKaydi> Kisiler, string Unvan) Onaylayanlar(
        string sicil, string pozisyon, string isGrubu,
        List<PersonelKaydi> hazirListe, Dictionary<string, List<string>> bolgeBellek)
    {
        try
        {
            /* Departmanı tanımlı personel (genel merkez, depo): 1. onay
               departman yöneticisinde. Tablo kuralından önce gelir; aynı
               pozisyonun farklı iş yerlerinde farklı ekiplere bağlı olması
               (temizlik görevlisi gibi) ancak böyle ayrılabiliyor. */
            var harita = _departman.Oku();

            /* 16.10.2026: kişi bugün şubedeyse (iş yeri kurallarda birebir
               geçmiyor) eski genel merkez departmanı üyeliği yok sayılır.
               Departmanın iş yeri boş bırakıldığında DepartmanServisi'ndeki
               süzgeç çalışmıyor, şube personeli GMY'ye düşüyordu. */
            var subede = !string.IsNullOrWhiteSpace(isGrubu)
                         && A(IsYeri(isGrubu, Kurallar())) == A(Sube);
            var depYoneticileri = subede
                ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                : harita.Yoneticileri(sicil);

            if (depYoneticileri.Count > 0)
            {
                var yoneticiler = (hazirListe ?? _kaynak.TumPersonelleriGetir())
                    .Where(x => x.Durum == 1
                                && !AyniSicil(x.PersonelKodu, sicil)
                                && depYoneticileri.Contains(DepartmanServisi.K(x.PersonelKodu)))
                    .ToList();

                if (yoneticiler.Count > 0
                    && harita.PersonelDepartmani.TryGetValue(DepartmanServisi.K(sicil), out var depId)
                    && harita.Departmanlar.TryGetValue(depId, out var dep))
                    return (yoneticiler, $"{dep.Ad} Yöneticisi");
            }

            var kural = KuralBul(pozisyon, isGrubu);

            if (kural is null) return (new(), null);

            /* Kural kişinin kendi iş yerinden değil, aynı pozisyonun başka
               bir iş yerindeki kuralından geldiyse (ör. mağazadaki "depo
               görevlisi" → Akçaburgaz depo kuralı) onaylayan yalnızca kişinin
               kendi iş yerinde aranır. */
            var capraz0 = A(kural.IsYeri) != A(IsYeri(isGrubu, Kurallar()));
            var subeKurali0 = A(IsYeri(isGrubu, Kurallar())) == A(Sube);

            /* 16.10.2026: şube personelinin pozisyonu ŞUBE kurallarında yoksa
               aynı pozisyonun genel merkez kuralı bulunuyor ve o kuralda
               onaylayan sicille yazılıysa (ör. "TEMİZLİK GÖREVLİSİ (Z.MERKEZ
               BURO)" → GMY 10664) mağazadaki personel GMY'nin Ekibim'ine ve
               onayına düşüyordu. Şubede başka iş yerinin sicilli kuralı
               uygulanmaz: 1. onay şubenin mağaza müdürü (yoksa bölge müdürü). */
            if (capraz0 && subeKurali0 && !string.IsNullOrWhiteSpace(kural.Onay1Sicil))
                return (KisileriBul(SubeYoneticisi, null, sicil, isGrubu, false, true, hazirListe, bolgeBellek),
                    BasHarf(SubeYoneticisi));

            return (KisileriBul(kural.Onay1, kural.Onay1Sicil, sicil, isGrubu, capraz0, subeKurali0,
                hazirListe, bolgeBellek), BasHarf(kural.Onay1));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin onaylayanı bulunamadı: {Sicil}", sicil);

            return (new(), null);
        }
    }

    /// <summary>
    /// Onaylayan pozisyon (ya da sicil) için talep edenden sorumlu kişiler.
    /// İzin tablosunun 1. onayıyla aynı kural; avans onay tablosu da her
    /// adımı bununla çözüyor (08.10.2026).
    /// </summary>
    public List<PersonelKaydi> KisileriBul(string onay, string onaySicil, string sicil, string isGrubu,
        bool capraz, bool subeKurali) =>
        KisileriBul(onay, onaySicil, sicil, isGrubu, capraz, subeKurali, null, null);

    private List<PersonelKaydi> KisileriBul(string onay, string onaySicil, string sicil, string isGrubu,
        bool capraz, bool subeKurali, List<PersonelKaydi> hazirListe, Dictionary<string, List<string>> bolgeBellek)
    {
        var kural = new Kural(0, "", "", onay ?? "", onaySicil);

        try
        {
            var aktif = (hazirListe ?? _kaynak.TumPersonelleriGetir())
                .Where(x => x.Durum == 1 && !AyniSicil(x.PersonelKodu, sicil))
                .ToList();

            /* Çapraz kuralda (başka iş yerinin kuralı) onaylayan bulunamazsa
               talep İK'ya düşer; başka iş yerinin yöneticisine gitmez. */

            List<PersonelKaydi> sonuc;

            if (!string.IsNullOrWhiteSpace(kural.Onay1Sicil))
            {
                sonuc = aktif.Where(x => AyniSicil(x.PersonelKodu, kural.Onay1Sicil)).ToList();
            }
            else if (PersonelKaynagiServisi.BolgeMuduruPozisyonu(kural.Onay1)
                     && PaneldekiBolgeMudurleri(isGrubu, sicil, aktif) is { Count: > 0 } panelden)
            {
                /* Asıl kaynak İK paneli: Kullanıcılar ekranında şubeyi
                   (bölgesi üzerinden) kapsayan Bölge Müdürü hesabı */
                sonuc = panelden;
            }
            else if (PersonelKaynagiServisi.BolgeMuduruPozisyonu(kural.Onay1))
            {
                var form = _ayar.FormOku();

                /* Bölge müdürü: pozisyonu bölge müdürü olan ya da portalda
                   (Yetkiler → Bölgeler) bir bölgenin müdürü olarak tanımlı
                   kişi. Mikro'da ünvanı farklı yazılmış bölge müdürü de
                   böylece bulunuyor. */
                var bolgeMudurleri = aktif
                    .Where(x => A(x.Pozisyon) == A(kural.Onay1)
                                || PersonelKaynagiServisi.BolgeMuduruPozisyonu(x.Pozisyon)
                                || _portalYetki.TanimliBolgeSubeleri(x.PersonelKodu).Count > 0)
                    .ToList();

                /* Bölge müdürünün kapsamı toplu hesapta bir kez okunuyor */
                List<string> Kapsam(PersonelKaydi x)
                {
                    var k = (x.PersonelKodu ?? "").Trim();

                    if (bolgeBellek is not null && bolgeBellek.TryGetValue(k, out var v)) return v;

                    var l = _portalYetki.BolgeSubeleri(x.PersonelKodu, x.IsGrubu, form, $"{x.Ad} {x.Soyad}");

                    if (bolgeBellek is not null) bolgeBellek[k] = l;

                    return l;
                }

                sonuc = bolgeMudurleri
                    .Where(x => PortalYetkiServisi.SubeIcinde(Kapsam(x), isGrubu))
                    .ToList();

                /* Şubeyi kapsayan bölge müdürü yoksa (bölge ataması
                   yapılmamış) bütün bölge müdürlerine düşüyor: talep
                   kimsenin görmediği yerde beklemesin. */
                if (sonuc.Count == 0)
                {
                    _kayit.LogWarning("Şubeyi kapsayan bölge müdürü yok: {Sube}", isGrubu);
                    sonuc = bolgeMudurleri;
                }
            }
            else
            {
                var hepsi = aktif.Where(x => A(x.Pozisyon) == A(kural.Onay1)).ToList();

                /* Aynı iş yerindeki önce: mağaza müdürü kendi mağazasının,
                   depo müdürü deponun. Merkez pozisyonlarında iş yeri farklı
                   olabiliyor, o zaman o pozisyondaki herkes. */
                var ayniYer = hepsi.Where(x => PersonelKaynagiServisi.Benziyor(x.IsGrubu ?? "", isGrubu ?? "")).ToList();

                /* Mağazada (ŞUBE kuralı) o mağazanın müdürü yoksa — kadro
                   boş, müdür izinde ayrılmış ya da ünvanı farklı yazılmış —
                   "o pozisyondaki herkes" bütün mağaza müdürleri demekti:
                   müdürsüz mağazanın personeli her mağaza müdürünün
                   Ekibim'inde görünüyor, izin talepleri 30 müdüre birden
                   düşüyordu (02.10.2026, Bakırköy-3: 18 kişilik mağazada
                   35 kişi). Artık şubeyi kapsayan bölge müdürüne gidiyor;
                   o da yoksa liste boş ve talep İK'ya geçiyor. "Herkes"
                   yalnızca merkez gibi iş yeri farklı olabilen kurallarda. */
                if (ayniYer.Count > 0)
                    sonuc = ayniYer;
                else if (capraz)
                    sonuc = new List<PersonelKaydi>();
                else if (subeKurali)
                    sonuc = SubeninBolgeMudurleri(isGrubu, aktif, bolgeBellek);
                else
                    sonuc = hepsi;
            }

            return sonuc;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Onaylayan bulunamadı: {Sicil} · {Onay}", sicil, onay);

            return new();
        }
    }

    /// <summary>
    /// Talep sahibinin şubesinin bölge müdürleri: izin onayının 2. aşaması
    /// (07.10.2026). Yönetim › Bölgeler'de şube bir bölgeye bağlıysa o
    /// bölgenin müdürü (panel hesabı ya da portal bölge ataması). Şube
    /// hiçbir bölgede değilse (genel merkez, depo) boş: aşama atlanır.
    /// </summary>
    public List<PersonelKaydi> BolgeMudurleri(string isGrubu, string talepSicil)
    {
        if (string.IsNullOrWhiteSpace(isGrubu)) return new List<PersonelKaydi>();

        var aktif = _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !AyniSicil(x.PersonelKodu, talepSicil))
            .ToList();

        return SubeninBolgeMudurleri(isGrubu, aktif, null);
    }

    /// <summary>
    /// Şubeyi kapsayan bölge müdürleri (bölge ataması yoksa boş). Mağaza
    /// müdürü bulunamayan şubede 1. onaylayan olarak kullanılıyor.
    /// </summary>
    private List<PersonelKaydi> SubeninBolgeMudurleri(
        string isGrubu, List<PersonelKaydi> aktif, Dictionary<string, List<string>> bolgeBellek)
    {
        try
        {
            var panelden = PaneldekiBolgeMudurleri(isGrubu, null, aktif);
            if (panelden.Count > 0) return panelden;

            var form = _ayar.FormOku();

            return aktif
                .Where(x => PersonelKaynagiServisi.BolgeMuduruPozisyonu(x.Pozisyon)
                            || _portalYetki.TanimliBolgeSubeleri(x.PersonelKodu).Count > 0)
                .Where(x =>
                {
                    var k = (x.PersonelKodu ?? "").Trim();

                    if (bolgeBellek is null || !bolgeBellek.TryGetValue(k, out var kapsam))
                    {
                        kapsam = _portalYetki.BolgeSubeleri(x.PersonelKodu, x.IsGrubu, form, $"{x.Ad} {x.Soyad}");
                        if (bolgeBellek is not null) bolgeBellek[k] = kapsam;
                    }

                    return PortalYetkiServisi.SubeIcinde(kapsam, isGrubu);
                })
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şubenin bölge müdürü bulunamadı: {Sube}", isGrubu);
            return new List<PersonelKaydi>();
        }
    }

    /// <summary>
    /// İK panelinde şubeyi kapsayan Bölge Müdürü hesaplarının Mikro'daki
    /// karşılıkları (Yönetim → Bölgeler'deki bölge → şubeler ve Kullanıcılar'da
    /// hesaba seçilen bölge). Hesabı Mikro'da bulunamayan bölge müdürü
    /// listeye girmiyor; o zaman eski kaynaklara (portal, pozisyon) bakılıyor.
    /// </summary>
    private List<PersonelKaydi> PaneldekiBolgeMudurleri(string isGrubu, string talepSicil, List<PersonelKaydi> aktif)
    {
        try
        {
            return _portalYetki.PanelBolgeMudurleri(aktif ?? _kaynak.TumPersonelleriGetir(), _ayar.FormOku())
                .Where(x => x.Kisi is not null
                            && !AyniSicil(x.Kisi.PersonelKodu, talepSicil)
                            && PortalYetkiServisi.SubeIcinde(x.Subeler, isGrubu))
                .Select(x => x.Kisi)
                .GroupBy(x => (x.PersonelKodu ?? "").Trim().TrimStart('0'))
                .Select(g => g.First())
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Paneldeki bölge müdürü okunamadı: {Sube}", isGrubu);
            return new List<PersonelKaydi>();
        }
    }

    /// <summary>
    /// Kişi herhangi birinin 1. onaylayanı olabilir mi: pozisyonu bir
    /// kuralda onaylayan olarak geçiyor ya da sicili bir kuralda yazılı.
    /// Mobilde onay ekranı buna göre gösteriliyor.
    /// </summary>
    public bool OnaylayiciMi(string pozisyon, string sicil = null)
    {
        try
        {
            /* Departman yöneticisi: onaylayacağı personel departmanda */
            if (!string.IsNullOrWhiteSpace(sicil)
                && _departman.Oku().YonettigiDepartmanlar.ContainsKey(DepartmanServisi.K(sicil)))
                return true;

            var p = A(pozisyon);
            var bolgeMuduru = PersonelKaynagiServisi.BolgeMuduruPozisyonu(pozisyon)
                              || (!string.IsNullOrWhiteSpace(sicil)
                                  && (_portalYetki.TanimliBolgeSubeleri(sicil).Count > 0
                                      || _portalYetki.PanelBolgeMudurleri(_kaynak.TumPersonelleriGetir(), _ayar.FormOku())
                                          .Any(x => x.Kisi is not null && AyniSicil(x.Kisi.PersonelKodu, sicil))));

            return Kurallar().Any(k =>
                (!string.IsNullOrWhiteSpace(k.Onay1Sicil)
                    ? AyniSicil(k.Onay1Sicil, sicil)
                    : A(k.Onay1) == p
                      || (bolgeMuduru && PersonelKaynagiServisi.BolgeMuduruPozisyonu(k.Onay1))));
        }
        catch
        {
            return false;
        }
    }

    /// <summary>"BÖLGE MÜDÜRÜ" → "Bölge Müdürü": mobilde aşama adı olarak.</summary>
    public static string BasHarf(string s)
    {
        var tr = new System.Globalization.CultureInfo("tr-TR");

        return string.Join(" ", (s ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.Length <= 1 ? w : w[..1].ToUpper(tr) + w[1..].ToLower(tr)));
    }
}

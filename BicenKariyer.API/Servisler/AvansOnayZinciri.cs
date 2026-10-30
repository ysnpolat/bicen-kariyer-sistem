using System.Data;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Avans onay tablosu ve talep başına onay zinciri (08.10.2026).
///
/// <para>
/// İK'nın hazırladığı "AVANS TALEP ONAY SÜRECİ" tablosu: iş yeri +
/// pozisyon → sırayla 1.–5. onay. Bir onay ya bir pozisyon (MAĞAZA
/// MÜDÜRÜ, BÖLGE MÜDÜRÜ, DEPO MÜDÜRÜ, TEKNİK İŞLER MÜDÜRÜ…), ya belirli bir
/// kişi (pozisyon + sicil), ya da İnsan Kaynakları. Pozisyondaki kişi izin
/// onay tablosundaki kuralla bulunuyor (<see cref="IzinOnayKuralServisi.KisileriBul"/>):
/// mağaza müdürü kendi mağazasının, bölge müdürü şubeyi kapsayan, merkez
/// pozisyonlarında o pozisyondaki kişi.
/// </para>
///
/// <para>
/// Talep oluşturulurken kural, talebe zincir olarak yazılıyor
/// (KRY_AVANS.zincir): tablo sonradan değişse de bekleyen talep kendi
/// sırasıyla ilerliyor. Bir adım sıraya geldiğinde onaylayanı yeniden
/// bulunuyor; kimse yoksa ya da önceki adımla aynı kişiyse adım atlanıyor
/// (talep sahipsiz beklemesin).
/// </para>
///
/// <para>
/// Kişi adımları Biçen360'ta İzin Onayları ekranında (yayındaki 1.6 izin
/// kartıyla; eksi kimlik), patron görünümündekilerde Onaylar ekranında da
/// görünüyor. İK adımı panelde. Kişi adımında red talebi kapatır; İK
/// reddederse ayara göre sonraki onaya (GMY) gider ya da kapanır.
/// </para>
///
/// <para>
/// Zinciri olmayan (bu sürümden önce açılmış) talepler eski genel akışla
/// (<see cref="AvansAkisi"/>) sonuçlanıyor.
/// </para>
/// </summary>
public class AvansOnayZinciri
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinOnayKuralServisi _izinKural;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly ILogger<AvansOnayZinciri> _kayit;

    public AvansOnayZinciri(VeritabaniServisi vt, IzinOnayKuralServisi izinKural,
        PersonelKaynagiServisi kaynak, ILogger<AvansOnayZinciri> kayit)
    {
        _vt = vt;
        _izinKural = izinKural;
        _kaynak = kaynak;
        _kayit = kayit;
    }

    public const string Ik = "İK";
    public const string IkAdi = "İnsan Kaynakları";
    public const string Sube = IzinOnayKuralServisi.Sube;
    public const string AyarAnahtari = "AVANS_ZINCIR_AYAR";
    public const int EnFazlaAdim = 5;

    public const string TurKisi = "kisi";
    public const string TurIk = "ik";
    public const string TurEski = "eski";

    /* ------------------------------------------------------- mobil kimlik */

    /// <summary>Mobil İzin Onayları listesinde avans kimliği: -(500.000.000 + id)</summary>
    public const int MobilTaban = 500_000_000;

    public static int MobilKimlik(int id) => -(MobilTaban + id);

    public static int? KayitKimligi(int mobilKimlik) =>
        mobilKimlik <= -MobilTaban && mobilKimlik > -1_000_000_000 ? -mobilKimlik - MobilTaban : null;

    /* -------------------------------------------------------------- model */

    public sealed class KuralAdimi
    {
        /// <summary>Onaylayan pozisyon; "İK" İnsan Kaynakları</summary>
        public string Onay { get; set; }

        /// <summary>Belirli kişi (aynı ünvanda birden çok kişi varsa)</summary>
        public string Sicil { get; set; }
    }

    public sealed class Kural
    {
        public int Id { get; set; }
        public string IsYeri { get; set; }
        public string Pozisyon { get; set; }
        public List<KuralAdimi> Adimlar { get; set; } = new();
    }

    /// <summary>Talebe yazılan adım (zincir)</summary>
    public sealed class Adim
    {
        public string Ad { get; set; }
        public string Tur { get; set; }
        public string Onay { get; set; }
        public string Sicil { get; set; }

        /// <summary>Panelde karar verebilecek roller (Admin her adımda)</summary>
        public List<string> Roller { get; set; } = new();

        /// <summary>Biçen360'tan karar verebilecek siciller (baştaki sıfırsız)</summary>
        public List<string> Siciller { get; set; } = new();

        public List<string> Adlar { get; set; } = new();

        public string Onaylarsa { get; set; } = AvansAkisi.Sonraki;
        public string Reddederse { get; set; } = AvansAkisi.Bitir;

        /// <summary>onay · red · atlandi · null (bekliyor/sırası gelmedi)</summary>
        public string Karar { get; set; }
        public string Kim { get; set; }
        public DateTime? Tarih { get; set; }
        public string Not { get; set; }
    }

    public sealed class Zincir
    {
        /// <summary>"ŞUBE · KASİYER" ya da "varsayılan"</summary>
        public string Kural { get; set; }
        public string IsYeri { get; set; }
        public bool Capraz { get; set; }
        public bool SubeKurali { get; set; }
        public List<Adim> Adimlar { get; set; } = new();
    }

    public sealed class Ayar
    {
        /// <summary>İK reddederse: "sonraki" (sıradaki onay, ör. GMY son kararı verir) ya da "bitir"</summary>
        public string IkReddederse { get; set; } = AvansAkisi.Sonraki;

        /// <summary>Talep bir sonraki onaya geçince personele "değerlendirmede" bildirimi</summary>
        public bool AraKarardaBildir { get; set; }
    }

    private static readonly JsonSerializerOptions Secenek = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Json(Zincir z) => JsonSerializer.Serialize(z, Secenek);

    public static Zincir Oku(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;

        try
        {
            var z = JsonSerializer.Deserialize<Zincir>(json, Secenek);
            return z?.Adimlar is { Count: > 0 } ? z : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Zinciri olmayan eski talepler: genel akış (İK → GMY) aynı modelde</summary>
    public static List<Adim> EskiAdimlar() =>
        AvansAkisi.Gecerli().Adimlar.Select(x => new Adim
        {
            Ad = x.Ad,
            Tur = TurEski,
            Roller = x.Roller.ToList(),
            Siciller = AvansAkisi.Siciller(x).ToList(),
            Onaylarsa = x.Onaylarsa,
            Reddederse = x.Reddederse,
        }).ToList();

    /// <summary>Talebin adımları: kendi zinciri, yoksa eski genel akış</summary>
    public static List<Adim> Adimlari(string zincirJson) => Oku(zincirJson)?.Adimlar ?? EskiAdimlar();

    public static Adim AdimAl(List<Adim> adimlar, int? asama) =>
        adimlar[Math.Clamp(asama ?? 0, 0, adimlar.Count - 1)];

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    public static bool IkMi(string onay)
    {
        var a = A(onay);
        return a == A(Ik) || a == A(IkAdi) || a == A("İNSAN KAYNAKLARI");
    }

    /// <summary>Panel kullanıcısı bu adımda karar verebilir mi (Admin her adımda)</summary>
    public static bool PanelYetkili(Adim x, string temelRol) =>
        temelRol == Roller.Admin || (x.Roller ?? new()).Contains(temelRol, StringComparer.OrdinalIgnoreCase);

    /// <summary>Biçen360 kullanıcısı bu adımda karar verebilir mi</summary>
    public static bool SicilYetkili(Adim x, string sicil) =>
        x.Tur != TurIk && (x.Siciller ?? new()).Contains(K(sicil), StringComparer.OrdinalIgnoreCase);

    /* ------------------------------------------------------------- ayar */

    private static (DateTime zaman, Ayar ayar)? _ayarBellek;

    public Ayar AyarOku()
    {
        if (_ayarBellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60)) return b.ayar;

        var a = new Ayar();

        try
        {
            using var db = _vt.Baglanti();
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = AyarAnahtari });
            if (!string.IsNullOrWhiteSpace(ham)) a = JsonSerializer.Deserialize<Ayar>(ham, Secenek) ?? new Ayar();
        }
        catch
        {
            /* bozuk ayar varsayılana düşer */
        }

        a.IkReddederse = a.IkReddederse == AvansAkisi.Bitir ? AvansAkisi.Bitir : AvansAkisi.Sonraki;
        _ayarBellek = (DateTime.UtcNow, a);
        return a;
    }

    public void AyarYaz(IDbConnection db, Ayar a)
    {
        a.IkReddederse = a.IkReddederse == AvansAkisi.Bitir ? AvansAkisi.Bitir : AvansAkisi.Sonraki;
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @k AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@k, @d, SYSDATETIME());",
            new { k = AyarAnahtari, d = JsonSerializer.Serialize(a, Secenek) });
        _ayarBellek = null;
    }

    /* ---------------------------------------------------------- kurallar */

    private static (DateTime zaman, List<Kural> kurallar)? _bellek;
    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
        KademeleriUnut();
    }

    public List<Kural> Kurallar()
    {
        lock (_kilit)
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.kurallar;

        using var db = _vt.Baglanti();

        Tohumla(db);

        var liste = db.Query(@"
SELECT id, is_yeri, pozisyon, adimlar FROM KRY_AVANS_ONAY_KURAL WHERE aktif = 1 ORDER BY is_yeri, pozisyon")
            .Select(x => new Kural
            {
                Id = (int)x.id,
                IsYeri = (string)x.is_yeri,
                Pozisyon = (string)x.pozisyon,
                Adimlar = AdimlariCoz((string)x.adimlar),
            })
            .ToList();

        lock (_kilit) _bellek = (DateTime.UtcNow, liste);

        return liste;
    }

    public static List<KuralAdimi> AdimlariCoz(string json)
    {
        try
        {
            return Temizle(JsonSerializer.Deserialize<List<KuralAdimi>>(json ?? "[]", Secenek));
        }
        catch
        {
            return new();
        }
    }

    public static string AdimlariYaz(List<KuralAdimi> l) => JsonSerializer.Serialize(Temizle(l), Secenek);

    /// <summary>Boşlar atılır, art arda aynı adım bir kez, en fazla 5 adım</summary>
    public static List<KuralAdimi> Temizle(List<KuralAdimi> l)
    {
        var sonuc = new List<KuralAdimi>();

        foreach (var x in l ?? new())
        {
            if (x is null || string.IsNullOrWhiteSpace(x.Onay)) continue;

            var y = new KuralAdimi
            {
                Onay = IkMi(x.Onay) ? Ik : string.Join(" ", x.Onay.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)).ToUpper(new System.Globalization.CultureInfo("tr-TR")),
                Sicil = string.IsNullOrWhiteSpace(x.Sicil) || IkMi(x.Onay) ? null : new string(x.Sicil.Trim().Where(char.IsLetterOrDigit).Take(20).ToArray()),
            };

            if (y.Onay.Length > 150) y.Onay = y.Onay[..150];
            if (y.Sicil is { Length: 0 }) y.Sicil = null;

            var son = sonuc.LastOrDefault();
            if (son is not null && A(son.Onay) == A(y.Onay) && K(son.Sicil) == K(y.Sicil)) continue;

            sonuc.Add(y);
        }

        return sonuc.Take(EnFazlaAdim).ToList();
    }

    /// <summary>Tablo boşsa İK'nın Excel'i (08.10.2026, 84 satır) yükleniyor</summary>
    private static void Tohumla(IDbConnection db)
    {
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_AVANS_ONAY_KURAL") > 0) return;

        foreach (var (yer, poz, adim) in Ilk)
            db.Execute(@"
INSERT INTO KRY_AVANS_ONAY_KURAL (is_yeri, pozisyon, adimlar, guncelleyen)
VALUES (@yer, @poz, @adimlar, N'ilk yükleme')", new { yer, poz, adimlar = AdimlariYaz(Satir(adim)) });
    }

    /// <summary>"MAĞAZA MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"</summary>
    private static List<KuralAdimi> Satir(string s) =>
        s.Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Split('|'))
            .Select(p => new KuralAdimi { Onay = p[0], Sicil = p.Length > 1 ? p[1] : null })
            .ToList();

    /// <summary>Kuralı olmayan pozisyon: şubede mağaza müdürü → bölge müdürü → İK → GMY, diğerlerinde İK → GMY</summary>
    public static List<KuralAdimi> Varsayilan(bool sube) => sube
        ? Satir("MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|gmy")
        : Satir("İK;GENEL MÜDÜR YARDIMCISI|gmy");

    private static readonly (string, string, string)[] Ilk =
    {
        ("AKÇABURGAZ DEPO", "DEPO GÖREVLİSİ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "DEPO MÜDÜR YRD.", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "DEPO MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|11220;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "RT OPERATÖRÜ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "SERVİS ŞÖFÖRÜ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "SERVİŞ ŞÖFÖRÜ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "SEVKİYAT ŞOFÖRÜ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "TEMİZLİK GÖREVLİSİ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("AKÇABURGAZ DEPO", "ÜRÜN KABUL GÖREVLİSİ", "DEPO MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "EKMEK USTASI", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "HAL ŞOFÖRÜ", "HAL SATIN ALMA|12169;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "HAL ŞOFÖRÜ SORUMLUSU", "HAL SATIN ALMA|12169;İK"),
        ("ŞUBE", "KASA ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "KASAP", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "KASAP ÇIRAK", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "KASAP ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "KASİYER", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "KASİYER PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ", "BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ VKL", "BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ VKL.", "BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MAĞAZA ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MANAV", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MANAV PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MANAV ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "MÜDÜR YARDIMCISI", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "REYON ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "REYONER", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "REYONER PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "SEPET TOPLAYICI", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "ŞARKÜTERİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "ŞARKÜTERİ ÇIRAK", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "ŞARKÜTERİ ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "TADOLYA", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "TADOLYA PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "TADOLYA ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "TEMİZLİK GÖREV.PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "TEMİZLİK GÖREVLİSİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "TEMZİLİK GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("ŞUBE", "ÜRÜN KABUL G.", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "ÜRÜN KABUL GÖREVLİSİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("ŞUBE", "VALE", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "ARAÇ VE EVRAK SORUML", "GENEL MÜDÜR YARDIMCISI|0234;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "BİLGİSAYAR DONANIM", "TKNOLOJİ VE TKNK MÜD;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "BÖLGE MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0381;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "EKMEK ŞOFÖRÜ", "ARAÇ VE EVRAK SORUML;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "ELEKTRİK USTASI", "TEKNİK İŞLER MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "E-TİCARET YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI|0381;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "FİNANS UZMANI", "GENEL MÜDÜR YARDIMCISI|0234;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "GENEL MÜDÜR YARDIMCISI", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "GENEL MÜDÜR YRD.", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "GRAFİK TASARIM", "PAZARLAMA MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI ÇLŞ.", "GÜVENLİK ODASI YNT.;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI PART", "GÜVENLİK ODASI YNT.;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI YNT.", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "HAL SATIN ALMA", "GENEL MÜDÜR YARDIMCISI|0381;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "HİJYEN VE KALİTE SRM", "GENEL MÜDÜR YARDIMCISI|10664;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "IT UZMANI", "TKNOLOJİ VE TKNK MÜD;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "İÇ DENETİM MÜDÜRÜ", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "İK UZMANI", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İK. UZMANI", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İK. YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İNSAN KAYNAKLARI", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İNŞAAT USTASI", "TEKNİK İŞLER MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "KATEGORİ YÖN. AST.", "SATIN ALMA MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "KATEGORİ YÖNETİCİSİ", "SATIN ALMA MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "MUHASEBE ÇALIŞANI", "MUHASEBE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "MUHASEBE MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0234;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "MUHASEBE ŞEFİ", "MUHASEBE MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "MUTFAK GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "PAZARLAMA MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0381;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "RAPORLAMA UZMANI", "TKNOLOJİ VE TKNK MÜD;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "RAPORLAMA YÖNETİCİSİ", "TKNOLOJİ VE TKNK MÜD;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "SANTRAL GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "SATIN ALMA MÜDÜRÜ", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "STOK ENVANTER ÇLŞ.", "GENEL MÜDÜR YARDIMCISI|11220;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "STOK KONTROL UZMANI", "GENEL MÜDÜR YARDIMCISI|11220;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "STOK YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI|11220;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER ÇLŞ.", "TEKNİK İŞLER MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0234;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER YÖN.", "TEKNİK İŞLER MÜDÜRÜ;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "TEMİZLİK GÖREVLİSİ (Z.MERKEZ BURO)", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "TKNOLOJİ VE TKNK MÜD", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
        ("Z.MERKEZ BURO", "YÖNETİM KURULU AST.", "GENEL MÜDÜR;İK;GENEL MÜDÜR YARDIMCISI|10664"),
    };

    /* ------------------------------------------------------------ çözüm */

    /// <summary>Talep edenin iş yeri: tabloda birebir yazıyorsa o, değilse ŞUBE</summary>
    public string IsYeri(string isGrubu, List<Kural> kurallar = null)
    {
        var a = A(isGrubu);
        return (kurallar ?? Kurallar()).Select(k => k.IsYeri).Distinct()
            .FirstOrDefault(y => A(y) == a && A(y) != A(Sube)) ?? Sube;
    }

    /// <summary>Kişinin kuralı: önce kendi iş yerinde, yoksa aynı pozisyonun başka iş yerindeki kuralı</summary>
    public (Kural Kural, bool Capraz) KuralBul(string pozisyon, string isGrubu)
    {
        var kurallar = Kurallar();
        var yer = IsYeri(isGrubu, kurallar);
        var p = A(pozisyon);

        var tam = kurallar.FirstOrDefault(k => A(k.IsYeri) == A(yer) && A(k.Pozisyon) == p);
        if (tam is not null) return (tam, false);

        var baska = kurallar.FirstOrDefault(k => A(k.Pozisyon) == p);
        return (baska, baska is not null);
    }

    /// <summary>Tablodaki "gmy" yer tutucusunun sicili (Ayarlar: avans.gmySicil). İzin zinciri de kullanıyor (26.10.2026).</summary>
    public static string GmySicil()
    {
        var s = Parametre.Metin("avans.gmySicil");
        return string.IsNullOrWhiteSpace(s) ? "10664" : s.Trim();
    }

    private static readonly System.Globalization.CultureInfo Tr = new("tr-TR");

    /// <summary>Talep anındaki zincir; kişi adımlarının onaylayanları da bulunur</summary>
    public Zincir Olustur(PersonelKaydi p)
    {
        var (kural, capraz) = KuralBul(p.Pozisyon, p.IsGrubu);
        var yer = IsYeri(p.IsGrubu);
        var sube = A(yer) == A(Sube);
        var ayar = AyarOku();

        var kaynak = kural?.Adimlar is { Count: > 0 } ? kural.Adimlar : Varsayilan(sube);

        var z = new Zincir
        {
            Kural = kural is null ? "varsayılan" : $"{kural.IsYeri} · {kural.Pozisyon}",
            IsYeri = yer,
            Capraz = capraz,
            SubeKurali = sube,
        };

        foreach (var x in kaynak)
        {
            if (IkMi(x.Onay))
            {
                z.Adimlar.AddRange(IkAdimlari(ayar));
                continue;
            }

            var sicil = string.Equals(x.Sicil, "gmy", StringComparison.OrdinalIgnoreCase) ? GmySicil() : x.Sicil;

            z.Adimlar.Add(new Adim
            {
                Ad = IzinOnayKuralServisi.BasHarf(x.Onay),
                Tur = TurKisi,
                Onay = x.Onay,
                Sicil = sicil,
                /* GMY adımı panelde GMY hesabıyla da onaylanabiliyor */
                Roller = sicil is not null && K(sicil) == K(GmySicil()) ? new() { Roller.GenelMudurYardimcisi } : new(),
            });
        }

        /* İK hiç yoksa son onay İK: tutar ve ödeme planını İK kesinleştiriyor */
        if (!z.Adimlar.Any(x => x.Tur == TurIk))
            z.Adimlar.AddRange(IkAdimlari(ayar));

        var son = z.Adimlar[^1];
        son.Onaylarsa = AvansAkisi.Bitir;
        son.Reddederse = AvansAkisi.Bitir;

        foreach (var a in z.Adimlar.Where(a => a.Tur == TurKisi)) Coz(a, p.PersonelKodu, p.IsGrubu, z);

        return z;
    }

    /// <summary>
    /// İK aşaması (23.10.2026): önce İK uzmanı, sonra İK yöneticisi. Uzman
    /// onaylasa da reddetse de talep İK yöneticisine geçer (uzmanın reddi
    /// son karar değil); İK yöneticisinden sonra sıradaki adım (GMY, son
    /// aşama). İK yöneticisinin reddi ayardaki "İK reddederse" kuralıyla.
    /// Zinciri bu tarihten önce oluşmuş talepler eski tek İK adımıyla sürer.
    /// </summary>
    private static List<Adim> IkAdimlari(Ayar ayar) => new()
    {
        new Adim
        {
            Ad = "İK Uzmanı",
            Tur = TurIk,
            Onay = Ik,
            Roller = new() { Roller.IK },
            Onaylarsa = AvansAkisi.Sonraki,
            Reddederse = AvansAkisi.Sonraki,
        },
        new Adim
        {
            Ad = "İK Yöneticisi",
            Tur = TurIk,
            Onay = Ik,
            Roller = new() { Roller.IKYoneticisi },
            Reddederse = ayar.IkReddederse,
        },
    };

    /// <summary>
    /// İzin, fazla mesai ve rotasyonun onay kademeleri (23.10.2026): avans
    /// tablosundaki sıra, İnsan Kaynakları adımına kadar. İK'dan sonraki
    /// adımlar (GMY) bu taleplerde yok. Onaylayacak kimse bulunamayan,
    /// talep edenin kendisi olan ya da bir öncekiyle aynı kişilerden oluşan
    /// kademe atlanıyor. Sonuç: İK'dan önceki kişi kademeleri, sırayla.
    /// </summary>
    public List<(string Unvan, List<PersonelKaydi> Kisiler)> IzinKademeleri(string talepSicil, string pozisyon, string isGrubu)
    {
        var anahtar = $"{K(talepSicil)}|{A(pozisyon)}|{A(isGrubu)}";

        lock (_kademeKilit)
            if (_kademeBellek.TryGetValue(anahtar, out var b) && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.liste;

        var (kural, capraz) = KuralBul(pozisyon, isGrubu);
        var sube = A(IsYeri(isGrubu)) == A(Sube);
        var kaynak = kural?.Adimlar is { Count: > 0 } ? kural.Adimlar : Varsayilan(sube);

        var sonuc = new List<(string, List<PersonelKaydi>)>();
        HashSet<string> onceki = null;

        foreach (var x in kaynak)
        {
            if (IkMi(x.Onay)) break;

            var sicil = string.Equals(x.Sicil, "gmy", StringComparison.OrdinalIgnoreCase) ? GmySicil() : x.Sicil;
            if (sicil is not null && K(sicil) == K(talepSicil)) continue;

            var kisiler = _izinKural.KisileriBul(x.Onay, sicil, talepSicil, isGrubu, capraz, sube)
                .Where(p => K(p.PersonelKodu) != K(talepSicil))
                .GroupBy(p => K(p.PersonelKodu)).Select(g => g.First())
                .Take(20)
                .ToList();

            if (kisiler.Count == 0) continue;

            var kume = kisiler.Select(p => K(p.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (onceki is not null && onceki.SetEquals(kume)) continue;
            onceki = kume;

            sonuc.Add((IzinOnayKuralServisi.BasHarf(x.Onay), kisiler));
        }

        lock (_kademeKilit)
        {
            if (_kademeBellek.Count > 5000) _kademeBellek.Clear();
            _kademeBellek[anahtar] = (DateTime.UtcNow, sonuc);
        }

        return sonuc;
    }

    /// <summary>Tablodaki İK'dan önceki adımlar (kişileri çözülmemiş)</summary>
    public List<KuralAdimi> IkOncesiAdimlar(string pozisyon, string isGrubu)
    {
        var (kural, _) = KuralBul(pozisyon, isGrubu);
        var sube = A(IsYeri(isGrubu)) == A(Sube);
        var kaynak = kural?.Adimlar is { Count: > 0 } ? kural.Adimlar : Varsayilan(sube);
        return kaynak.TakeWhile(x => !IkMi(x.Onay)).ToList();
    }

    private static readonly Dictionary<string, (DateTime zaman, List<(string Unvan, List<PersonelKaydi> Kisiler)> liste)> _kademeBellek = new();
    private static readonly object _kademeKilit = new();

    public static void KademeleriUnut()
    {
        lock (_kademeKilit) _kademeBellek.Clear();
    }

    /// <summary>Kişi adımının onaylayanları (talep eden hariç)</summary>
    public void Coz(Adim a, string talepSicil, string isGrubu, Zincir z)
    {
        if (a.Tur != TurKisi) return;

        try
        {
            var kisiler = _izinKural.KisileriBul(a.Onay, a.Sicil, talepSicil, isGrubu, z.Capraz, z.SubeKurali)
                .GroupBy(x => K(x.PersonelKodu)).Select(g => g.First()).Take(20).ToList();

            a.Siciller = kisiler.Select(x => K(x.PersonelKodu)).ToList();
            a.Adlar = kisiler.Select(x => $"{x.Ad} {x.Soyad}".Trim()).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Avans onaylayanı bulunamadı: {Onay}", a.Onay);
        }
    }

    /// <summary>
    /// Sıradaki adım (asama'dan sonra). Kişi adımında onaylayan yeniden
    /// bulunuyor; kimse yoksa ya da önceki adımın onaylayanıyla aynıysa adım
    /// "atlandi". Kalan adım yoksa null.
    /// </summary>
    public int? Ilerle(Zincir z, int asama, string talepSicil, string isGrubu)
    {
        for (var j = asama + 1; j < z.Adimlar.Count; j++)
        {
            var a = z.Adimlar[j];

            if (a.Tur != TurKisi) return j;

            /* Adımdaki belirli kişi talep edenin kendisi (ör. GMY'nin kendi avansı) */
            if (a.Sicil is not null && K(a.Sicil) == K(talepSicil))
            {
                a.Karar = "atlandi";
                a.Not = "Talep eden bu adımın onaylayanı";
                a.Tarih = DateTime.Now;
                continue;
            }

            Coz(a, talepSicil, isGrubu, z);

            if (a.Siciller.Count == 0 && a.Roller.Count == 0)
            {
                a.Karar = "atlandi";
                a.Not = "Onaylayacak kişi bulunamadı";
                a.Tarih = DateTime.Now;
                continue;
            }

            var onceki = j > 0 ? z.Adimlar[j - 1] : null;
            if (onceki is { Tur: TurKisi, Karar: "onay" or "atlandi" }
                && onceki.Siciller.Count > 0
                && onceki.Siciller.OrderBy(x => x).SequenceEqual(a.Siciller.OrderBy(x => x)))
            {
                a.Karar = "atlandi";
                a.Not = "Önceki adımda aynı kişi onayladı";
                a.Tarih = DateTime.Now;
                continue;
            }

            return j;
        }

        return null;
    }

    /// <summary>Paneldeki "kime gider" ve tablo önizlemesi</summary>
    public object Ozet(Zincir z) => z.Adimlar.Select((a, i) => new
    {
        sira = i + 1,
        ad = a.Ad,
        tur = a.Tur,
        sicil = a.Sicil,
        kisiler = a.Adlar,
        karar = a.Karar,
        kim = a.Kim,
        tarih = a.Tarih,
        not = a.Not,
    }).ToList();

    /* ------------------------------------------------- Biçen360 listeleri */

    public sealed class Bekleyen
    {
        public int Id { get; set; }
        public string PersonelKodu { get; set; }
        public string AdSoyad { get; set; }
        public string Sube { get; set; }
        public string Pozisyon { get; set; }
        public decimal Tutar { get; set; }
        public int Taksit { get; set; }
        public decimal? OnayTutar { get; set; }
        public int? OnayTaksit { get; set; }
        public DateTime IlkKesinti { get; set; }
        public DateTime? OnayIlkKesinti { get; set; }
        public string Neden { get; set; }
        public string Aciklama { get; set; }
        public DateTime Olusturma { get; set; }
        public int Asama { get; set; }
        public string ZincirJson { get; set; }

        public Zincir Zincir => Oku(ZincirJson);
    }

    /// <summary>Zincirli, bekleyen talepler</summary>
    public static List<Bekleyen> Bekleyenler(IDbConnection db) =>
        db.Query<Bekleyen>(@"
SELECT id AS Id, personel_kodu AS PersonelKodu, ad_soyad AS AdSoyad, sube AS Sube, pozisyon AS Pozisyon,
       tutar AS Tutar, taksit AS Taksit, onay_tutar AS OnayTutar, onay_taksit AS OnayTaksit,
       ilk_kesinti AS IlkKesinti, onay_ilk_kesinti AS OnayIlkKesinti, neden AS Neden, aciklama AS Aciklama,
       olusturma AS Olusturma, ISNULL(asama, 0) AS Asama, zincir AS ZincirJson
FROM KRY_AVANS WHERE durum = N'bekliyor' AND zincir IS NOT NULL ORDER BY olusturma").ToList();

    /// <summary>Bu kişinin onayını bekleyen (zincirli) talepler</summary>
    public static List<(Bekleyen B, Zincir Z, Adim Adim)> Onayinda(IDbConnection db, string sicil) =>
        Bekleyenler(db)
            .Select(b => (B: b, Z: b.Zincir))
            .Where(x => x.Z is not null)
            .Select(x => (x.B, x.Z, Adim: AdimAl(x.Z.Adimlar, x.B.Asama)))
            .Where(x => SicilYetkili(x.Adim, sicil) && K(x.B.PersonelKodu) != K(sicil))
            .ToList();

    private static string Lira(decimal v) => "₺" + v.ToString("N0", Tr);

    /// <summary>
    /// İzin Onayları listesine eklenecek avanslar. 1.6 izin kartının
    /// alanlarıyla (tür "Avans", ayrıntı açıklamada); 1.7 "tip" alanıyla
    /// avans kartı gösteriyor.
    /// </summary>
    public static List<object> MobilBekleyenler(IDbConnection db, PersonelKaydi kisi)
    {
        var sonuc = new List<object>();
        List<string> hazirRed = null;

        var onayinda = Onayinda(db, kisi.PersonelKodu);

        /* 26.10.2026: yöneticinin eksik bildirimi ve talebin belgeleri (2.0 kartı) */
        var eksikler = YoneticiEksik.Acikler(db, TalepEksik.Avans, onayinda.Select(x => x.B.Id));
        var belgeler = Belgeler(db, onayinda.Select(x => x.B.Id));

        foreach (var (b, z, adim) in onayinda)
        {
            var tutar = b.OnayTutar ?? b.Tutar;
            var taksit = b.OnayTaksit ?? b.Taksit;
            var ilk = b.OnayIlkKesinti ?? b.IlkKesinti;
            var onceki = z.Adimlar.Take(Math.Max(0, b.Asama)).LastOrDefault(x => x.Karar == "onay");

            hazirRed ??= BicenKariyer.API.Controllers.AvansController.RedGerekceleriOku(db);

            var metin = $"{Lira(tutar)} avans · {(taksit == 1 ? "tek seferde" : $"{taksit} taksit")} · ilk kesinti {ilk:dd.MM.yyyy}"
                        + (string.IsNullOrWhiteSpace(b.Neden) ? "" : $"\nNeden: {b.Neden}")
                        + (string.IsNullOrWhiteSpace(b.Aciklama) ? "" : $"\n{b.Aciklama}");

            sonuc.Add(new
            {
                id = MobilKimlik(b.Id),
                personelKodu = b.PersonelKodu,
                adSoyad = b.AdSoyad,
                subeAdi = b.Sube,
                gorev = b.Pozisyon,
                tur = "Avans",
                altTur = (string)null,
                cikisTarihi = b.Olusturma.Date,
                donusTarihi = b.Olusturma.Date,
                /* 1.6 kartında "GÜN" kutusu: avansta taksit yok, tutar açıklamada */
                gun = "—",
                aciklama = metin,
                olusturma = b.Olusturma,
                asama = b.Asama + 1,
                formBekleniyor = false,
                formBelgeId = (int?)null,
                magazaKisi = onceki is null ? null : $"{KararEtiketi.Kisi(onceki.Ad, onceki.Tur, onceki.Kim)} ({onceki.Ad})",
                magazaNot = onceki?.Not,
                magazaTarih = onceki?.Tarih,

                /* 1.7 */
                tip = "avans",
                avansId = b.Id,
                tutar,
                talepTutar = b.Tutar,
                taksit,
                ilkKesinti = ilk,
                neden = b.Neden,
                not = b.Aciklama,
                adimAdi = adim.Ad,
                sira = z.Adimlar.Select(x => new { ad = x.Ad, karar = x.Karar, kim = x.Kim is null ? null : KararEtiketi.Kisi(x.Ad, x.Tur, x.Kim) }).ToList(),
                /* 1.8: Yönetim › Avans kuralları'ndaki hazır ret gerekçeleri */
                hazirRed,

                /* 2.0 (26.10.2026): belgeler ve yöneticinin eksik bildirimi */
                evraklar = belgeler.GetValueOrDefault(b.Id) ?? new List<object>(),
                eksik = YoneticiEksik.Disari(eksikler.GetValueOrDefault(b.Id)),
                eksikBildirilebilir = true,
            });
        }

        return sonuc;
    }

    /// <summary>
    /// Taleplerin belgeleri (mobil kart; 26.10.2026). Yol <c>Avans/Belge/{id}</c>:
    /// yetki orada (zincirdeki onaylayan, personelin kendisi, İK).
    /// </summary>
    public static Dictionary<int, List<object>> Belgeler(IDbConnection db, IEnumerable<int> avansIdleri)
    {
        var idler = (avansIdleri ?? Enumerable.Empty<int>()).Distinct().ToList();
        var sonuc = new Dictionary<int, List<object>>();
        if (idler.Count == 0) return sonuc;

        try
        {
            foreach (var r in db.Query(@"
SELECT id, avans_id AS avansId, tur, dosya_adi AS dosya, tarih
FROM KRY_AVANS_BELGE WHERE avans_id IN @idler ORDER BY id", new { idler }))
            {
                if (!sonuc.TryGetValue((int)r.avansId, out var l)) sonuc[(int)r.avansId] = l = new List<object>();
                l.Add(new
                {
                    belgeId = (int)r.id,
                    kalem = "destek",
                    ad = string.IsNullOrWhiteSpace((string)r.tur) ? "Belge" : (string)r.tur,
                    dosya = (string)r.dosya,
                    tarih = (DateTime)r.tarih,
                    yol = $"/api/Avans/Belge/{(int)r.id}",
                });
            }
        }
        catch
        {
            /* tablo yoksa belge yok */
        }

        return sonuc;
    }

    /// <summary>Bu kişi zincirin herhangi bir kişi adımında onaylayan ya da karar vermiş mi (belge görme yetkisi; 26.10.2026)</summary>
    public static bool ZincirdeMi(string zincirJson, string sicil)
    {
        var z = Oku(zincirJson);
        return z?.Adimlar is not null && z.Adimlar.Any(x => SicilYetkili(x, sicil));
    }

    /// <summary>Biçen360 onay ekranı menüde görünsün mü: tabloda onaylayan olarak geçiyor ya da bekleyen var</summary>
    public bool OnayciMi(string sicil, string pozisyon)
    {
        try
        {
            var p = A(pozisyon);

            if (Kurallar().Any(k => k.Adimlar.Any(x => !IkMi(x.Onay) &&
                    (x.Sicil is not null ? K(x.Sicil) == K(sicil) : A(x.Onay) == p))))
                return true;

            using var db = _vt.Baglanti();
            return Onayinda(db, sicil).Count > 0;
        }
        catch
        {
            return false;
        }
    }
}

using System.Data;
using System.Text.RegularExpressions;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebi onay süreci tablosu (27.10.2026): iş yeri + pozisyon → 1.–5. onay.
///
/// <para>
/// İK'nın "İZİN TALEP ONAY SÜRECİ" Excel'i. 26.10.2026'dan beri izin
/// zinciri avans tablosundan türetiliyordu (GMY adımı İK'dan öne alınıp
/// şubede atlanarak); artık izin kendi tablosuyla, satırdaki sırayla
/// ilerliyor: ör. depo personeli Depo Müdürü → GMY (11220) → İK, genel
/// merkez çoğunlukla tek yönetici → İK, şube Mağaza Müdürü → Bölge
/// Müdürü → İK, hal şoförü Hal Şoförü Sorumlusu → GMY (0234) → İK.
/// </para>
///
/// <para>
/// Kişiye özel satır: pozisyon "SİCİL 13276" yazılırsa o personelin
/// talebi (pozisyonu ne olursa olsun) bu satırla gider. Kuralı olmayan
/// pozisyon: aynı pozisyonun başka iş yerindeki satırı, o da yoksa
/// şubede Mağaza Müdürü → Bölge Müdürü → İK, diğerlerinde yalnız İK.
/// Satırlar avans tablosuyla aynı biçimde (<see cref="AvansOnayZinciri.KuralAdimi"/>);
/// panelde Yönetim › İzin onay süreci'nden düzenleniyor.
/// </para>
/// </summary>
public class IzinZincirKurali
{
    private readonly VeritabaniServisi _vt;

    public IzinZincirKurali(VeritabaniServisi vt)
    {
        _vt = vt;
    }

    public const string Tablo = "KRY_IZIN_ZINCIR_KURAL";

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    private static readonly Regex SicilDeseni = new(@"S[İI]C[İI]L\s*:?\s*(\d{1,10})", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>"SİCİL 13276" → "13276"; kişiye özel satır değilse null</summary>
    public static string KisiSicili(string pozisyon)
    {
        var m = SicilDeseni.Match(pozisyon ?? "");
        return m.Success ? m.Groups[1].Value : null;
    }

    /* ------------------------------------------------------------ tablo */

    private static bool _kuruldu;
    private static readonly object _kurKilit = new();

    public static void Kur(IDbConnection db)
    {
        if (_kuruldu) return;
        lock (_kurKilit)
        {
            if (_kuruldu) return;
            db.Execute(@"
IF OBJECT_ID('KRY_IZIN_ZINCIR_KURAL') IS NULL
CREATE TABLE KRY_IZIN_ZINCIR_KURAL (
    id          INT IDENTITY(1,1) PRIMARY KEY,
    is_yeri     NVARCHAR(120) NOT NULL,
    pozisyon    NVARCHAR(150) NOT NULL,
    adimlar     NVARCHAR(MAX) NOT NULL,
    aktif       BIT NOT NULL DEFAULT 1,
    guncelleyen NVARCHAR(120) NULL,
    guncelleme  DATETIME2 NOT NULL DEFAULT SYSDATETIME()
);");
            _kuruldu = true;
        }
    }

    /* ---------------------------------------------------------- kurallar */

    private static (DateTime zaman, List<AvansOnayZinciri.Kural> kurallar)? _bellek;
    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    public List<AvansOnayZinciri.Kural> Kurallar()
    {
        lock (_kilit)
            if (_bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.kurallar;

        using var db = _vt.Baglanti();
        Kur(db);
        Tohumla(db);

        var liste = db.Query(@"
SELECT id, is_yeri, pozisyon, adimlar FROM KRY_IZIN_ZINCIR_KURAL WHERE aktif = 1 ORDER BY is_yeri, pozisyon")
            .Select(x => new AvansOnayZinciri.Kural
            {
                Id = (int)x.id,
                IsYeri = (string)x.is_yeri,
                Pozisyon = (string)x.pozisyon,
                Adimlar = AvansOnayZinciri.AdimlariCoz((string)x.adimlar),
            })
            .ToList();

        lock (_kilit) _bellek = (DateTime.UtcNow, liste);
        return liste;
    }

    /// <summary>Tablo boşsa İK'nın Excel'i (27.10.2026, 84 satır)</summary>
    private static void Tohumla(IDbConnection db)
    {
        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_IZIN_ZINCIR_KURAL") > 0) return;

        foreach (var (yer, poz, adim) in Ilk)
            db.Execute(@"
INSERT INTO KRY_IZIN_ZINCIR_KURAL (is_yeri, pozisyon, adimlar, guncelleyen)
VALUES (@yer, @poz, @adimlar, N'ilk yükleme (İzin talep onay süreci Excel)')",
                new { yer, poz, adimlar = AvansOnayZinciri.AdimlariYaz(Satir(adim)) });
    }

    private static List<AvansOnayZinciri.KuralAdimi> Satir(string s) =>
        s.Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Split('|'))
            .Select(p => new AvansOnayZinciri.KuralAdimi { Onay = p[0], Sicil = p.Length > 1 ? p[1] : null })
            .ToList();

    /// <summary>Kuralı olmayan pozisyon: şubede mağaza müdürü → bölge müdürü → İK, diğerlerinde İK</summary>
    public static List<AvansOnayZinciri.KuralAdimi> Varsayilan(bool sube) => sube
        ? Satir("MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK")
        : Satir("İK");

    private static readonly (string, string, string)[] Ilk =
    {
        ("AKÇABURGAZ DEPO", "DEPO GÖREVLİSİ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "DEPO MÜDÜR YRD.", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "DEPO MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|11220;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "RT OPERATÖRÜ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "SERVİS ŞÖFÖRÜ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "SERVİŞ ŞÖFÖRÜ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "SEVKİYAT ŞOFÖRÜ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "TEMİZLİK GÖREVLİSİ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("AKÇABURGAZ DEPO", "ÜRÜN KABUL GÖREVLİSİ", "DEPO MÜDÜRÜ;GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("ŞUBE", "EKMEK USTASI", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "HAL ŞOFÖRÜ", "HAL ŞOFÖRÜ SORUMLUSU;GENEL MÜDÜR YARDIMCISI|0234;İK"),
        ("ŞUBE", "HAL ŞOFÖRÜ SORUMLUSU", "GENEL MÜDÜR YARDIMCISI|0234;İK"),
        ("ŞUBE", "KASA ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "KASAP", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "KASAP ÇIRAK", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "KASAP ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "KASİYER", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "KASİYER PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ", "BÖLGE MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ VKL", "BÖLGE MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MAĞAZA MÜDÜRÜ VKL.", "BÖLGE MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MAĞAZA ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MANAV", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MANAV PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MANAV ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "MÜDÜR YARDIMCISI", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "REYON ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "REYONER", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "REYONER PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "SEPET TOPLAYICI", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "ŞARKÜTERİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "ŞARKÜTERİ ÇIRAK", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "ŞARKÜTERİ ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "TADOLYA", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "TADOLYA PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "TADOLYA ŞEFİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "TEMİZLİK GÖREV.PART", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "TEMİZLİK GÖREVLİSİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "SİCİL 13276", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("ŞUBE", "ÜRÜN KABUL G.", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "ÜRÜN KABUL GÖREVLİSİ", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("ŞUBE", "VALE", "MAĞAZA MÜDÜRÜ;BÖLGE MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "ARAÇ VE EVRAK SORUML", "GENEL MÜDÜR YARDIMCISI|0234;İK"),
        ("Z.MERKEZ BURO", "BİLGİSAYAR DONANIM", "TKNOLOJİ VE TKNK MÜD;İK"),
        ("Z.MERKEZ BURO", "BÖLGE MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0381;İK"),
        ("Z.MERKEZ BURO", "EKMEK ŞOFÖRÜ", "ARAÇ VE EVRAK SORUML;İK"),
        ("Z.MERKEZ BURO", "ELEKTRİK USTASI", "TEKNİK İŞLER MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "E-TİCARET YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI|0381;İK"),
        ("Z.MERKEZ BURO", "FİNANS UZMANI", "GENEL MÜDÜR YARDIMCISI|0234;İK"),
        ("Z.MERKEZ BURO", "GENEL MÜDÜR YARDIMCISI", "GENEL MÜDÜR;İK"),
        ("Z.MERKEZ BURO", "GENEL MÜDÜR YRD.", "GENEL MÜDÜR;İK"),
        ("Z.MERKEZ BURO", "GRAFİK TASARIM", "PAZARLAMA MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI ÇLŞ.", "GÜVENLİK ODASI YNT.;İK"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI PART", "GÜVENLİK ODASI YNT.;İK"),
        ("Z.MERKEZ BURO", "GÜVENLİK ODASI YNT.", "GENEL MÜDÜR;İK"),
        ("Z.MERKEZ BURO", "HAL SATIN ALMA", "GENEL MÜDÜR YARDIMCISI|0381;İK"),
        ("Z.MERKEZ BURO", "HİJYEN VE KALİTE SRM", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "IT UZMANI", "TKNOLOJİ VE TKNK MÜD;İK"),
        ("Z.MERKEZ BURO", "İÇ DENETİM MÜDÜRÜ", "GENEL MÜDÜR;İK"),
        ("Z.MERKEZ BURO", "İK UZMANI", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İK. UZMANI", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İK. YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İNSAN KAYNAKLARI", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "İNŞAAT USTASI", "TEKNİK İŞLER MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "KATEGORİ YÖN. AST.", "SATIN ALMA MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "KATEGORİ YÖNETİCİSİ", "SATIN ALMA MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "MUHASEBE ÇALIŞANI", "MUHASEBE MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "MUHASEBE MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0234;İK"),
        ("Z.MERKEZ BURO", "MUHASEBE ŞEFİ", "MUHASEBE MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "MUTFAK GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "PAZARLAMA MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0381;İK"),
        ("Z.MERKEZ BURO", "RAPORLAMA UZMANI", "TKNOLOJİ VE TKNK MÜD;İK"),
        ("Z.MERKEZ BURO", "RAPORLAMA YÖNETİCİSİ", "TKNOLOJİ VE TKNK MÜD;İK"),
        ("Z.MERKEZ BURO", "SANTRAL GÖREVLİSİ", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "SATIN ALMA MÜDÜRÜ", "GENEL MÜDÜR;İK"),
        ("Z.MERKEZ BURO", "STOK ENVANTER ÇLŞ.", "GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("Z.MERKEZ BURO", "STOK KONTROL UZMANI", "GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("Z.MERKEZ BURO", "STOK YÖNETİCİSİ", "GENEL MÜDÜR YARDIMCISI|11220;İK"),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER ÇLŞ.", "TEKNİK İŞLER MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER MÜDÜRÜ", "GENEL MÜDÜR YARDIMCISI|0234;İK"),
        ("Z.MERKEZ BURO", "TEKNİK İŞLER YÖN.", "TEKNİK İŞLER MÜDÜRÜ;İK"),
        ("Z.MERKEZ BURO", "TEMİZLİK GÖREVLİSİ (Z.MERKEZ BURO)", "GENEL MÜDÜR YARDIMCISI|10664;İK"),
        ("Z.MERKEZ BURO", "TKNOLOJİ VE TKNK MÜD", "GENEL MÜDÜR;İK"),
        ("Z.MERKEZ BURO", "YÖNETİM KURULU AST.", "GENEL MÜDÜR;İK"),
    };

    /* ------------------------------------------------------------ çözüm */

    /// <summary>Talep edenin iş yeri: tabloda birebir yazıyorsa o, değilse ŞUBE</summary>
    public string IsYeri(string isGrubu, List<AvansOnayZinciri.Kural> kurallar = null)
    {
        var a = A(isGrubu);
        return (kurallar ?? Kurallar()).Select(k => k.IsYeri).Distinct()
            .FirstOrDefault(y => A(y) == a && A(y) != A(AvansOnayZinciri.Sube)) ?? AvansOnayZinciri.Sube;
    }

    /// <summary>
    /// Kişinin kuralı: kişiye özel satır (SİCİL n), kendi iş yerinde
    /// pozisyon, yoksa aynı pozisyonun başka iş yerindeki satırı.
    /// </summary>
    public (AvansOnayZinciri.Kural Kural, bool Capraz) KuralBul(string pozisyon, string isGrubu, string sicil = null)
    {
        var kurallar = Kurallar();

        if (!string.IsNullOrWhiteSpace(sicil))
        {
            var kisi = kurallar.FirstOrDefault(k => KisiSicili(k.Pozisyon) is string s && K(s) == K(sicil));
            if (kisi is not null) return (kisi, false);
        }

        var yer = IsYeri(isGrubu, kurallar);
        var p = A(pozisyon);

        var tam = kurallar.FirstOrDefault(k => KisiSicili(k.Pozisyon) is null && A(k.IsYeri) == A(yer) && A(k.Pozisyon) == p);
        if (tam is not null) return (tam, false);

        var baska = kurallar.FirstOrDefault(k => KisiSicili(k.Pozisyon) is null && A(k.Pozisyon) == p);
        return (baska, baska is not null);
    }
}

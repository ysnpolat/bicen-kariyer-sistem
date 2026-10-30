using System.Data;
using System.Globalization;
using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Performans ölçütlerinin mağaza değerleri: "sizin değeriniz" ve eşik
/// (şirket ortalaması ya da sınır), eski performans sayfasındaki gibi.
///
/// <para>
/// 24.10.2026: sütunlar biDb şemasından birebir eşlendi. Ciro ve karlılık
/// görevin bölümüne göre değişiyor: kasap için et, manav için manav,
/// şarküteri ve tadolya kendi sütunları; diğerleri şube geneli. Eski
/// sayfayla karşılaştırıldı (kasap şefi Eylül: ciro 0,444 / 0,4681,
/// karlılık 0,62055 / 0,54005). Her ölçütün "_durum" sütunu da okunuyor.
/// appsettings "PerformansOlcutleri:{ÖLÇÜT}" altından ölçüt bazında
/// düzeltilebilir (Tablo, Deger, Esik, EsikAd).
/// </para>
/// </summary>
public class PerformansOlcutServisi
{
    private readonly IConfiguration _ayar;
    private readonly ILogger<PerformansOlcutServisi> _kayit;

    public PerformansOlcutServisi(IConfiguration ayar, ILogger<PerformansOlcutServisi> kayit)
    {
        _ayar = ayar;
        _kayit = kayit;
    }

    private static readonly object _kilit = new();

    private const string C = "Magaza_Performans_Ciro";
    private const string D = "Magaza_Performans_Diger";

    /// <summary>Ölçüt eşlemesi: tablo, değer, eşik, durum sütunu, eşiğin adı.</summary>
    private sealed record Esleme(string Tablo, string DegerSutun, string EsikSutun, string DurumSutun, string EsikAd);

    /// <summary>Yön: +1 yüksek iyi, -1 düşük iyi.</summary>
    private static readonly Dictionary<string, int> Yonler = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CİRO"] = +1, ["KARLILIK"] = +1, ["MÜŞTERİ SAYISI"] = +1, ["KİŞİ BAŞI CİRO"] = +1, ["KALİTE & HİJYEN"] = +1,
        ["TURNOVER"] = -1, ["ÜRÜN YOK SATMA"] = -1, ["GİDER ORANI"] = -1, ["İADE"] = -1, ["FİYAT FARKLARI"] = -1,
        ["ET FİRE"] = -1, ["BEYAZ ET FİRE"] = -1, ["MANAV FİRE"] = -1, ["TADOLYA FİRE"] = -1, ["KASA AÇIKLARI"] = -1,
        ["MAL KABUL HATASI"] = -1, ["FİŞ İPTAL SAYILARI"] = -1, ["SATIR İPTAL SAYILARI"] = -1, ["FİŞ & SATIR İPTAL SAYILARI"] = -1,
    };

    public static int Yon(string olcut) => Yonler.TryGetValue(olcut, out var y) ? y : +1;

    /// <summary>Ölçütün mağaza değeri, eşiği, eşiğin adı ve kaynaktaki durum (1 aldı / 0 almadı).</summary>
    public sealed record Deger(decimal? Sen, decimal? Esik, string EsikAd, int Yon, int? Durum = null);

    /// <summary>Görevin bölümü: ciro/karlılık sütunları buna göre seçilir.</summary>
    public static string Bolum(string gorev)
    {
        var g = (gorev ?? "").ToUpper(new CultureInfo("tr-TR"));
        if (g.Contains("KASAP") || g.Contains(" ET ") || g.StartsWith("ET ")) return "et";
        if (g.Contains("MANAV")) return "manav";
        if (g.Contains("ŞARKÜTERİ") || g.Contains("SARKUTERI") || g.Contains("ŞARKÜTERI")) return "sarkuteri";
        if (g.Contains("TADOLYA") || g.Contains("FIRIN") || g.Contains("PASTA")) return "tadolya";
        return "sube";
    }

    private Esleme Esle(string olcut, string bolum)
    {
        var el = _ayar.GetSection($"PerformansOlcutleri:{olcut}");
        if (el.Exists() && !string.IsNullOrWhiteSpace(el["Deger"]))
            return new Esleme((el["Tablo"] ?? "Diger").Contains("Ciro", StringComparison.OrdinalIgnoreCase) ? C : D,
                el["Deger"], el["Esik"], el["Durum"], el["EsikAd"] ?? "Şirket ort.");

        const string O = "Şirket ort.", S = "Sınır";
        return olcut.ToUpper(new CultureInfo("tr-TR")) switch
        {
            "CİRO" => bolum switch
            {
                "et" => new(C, "et_ciro_buyume", "et_ciro_genel_buyume", "et_ciro_durum", O),
                "manav" => new(C, "manav_ciro_buyume", "manav_ciro_genel_buyume", "manav_ciro_durum", O),
                "sarkuteri" => new(C, "sarkuteri_ciro_buyume", "sarkuteri_ciro_genel_buyume", "sarkuteri_ciro_durum", O),
                "tadolya" => new(C, "tadolya_ciro_buyume", "tadolya_ciro_genel_buyume", "tadolya_ciro_durum", O),
                _ => new(C, "sube_ciro_buyume", "genel_ciro_buyume", "sube_ciro_durum", O),
            },
            "KARLILIK" => bolum switch
            {
                "et" => new(C, "sube_et_kar_tl_buyume", "genel_et_kar_tl_buyume", "et_kar_durum", O),
                "manav" => new(C, "sube_manav_kar_tl_buyume", "genel_manav_kar_tl_buyume", "manav_kar_durum", O),
                "sarkuteri" => new(C, "sube_sarkuteri_kar_tl_buyume", "genel_sarkuteri_kar_tl_buyume", "sarkuteri_kar_durum", O),
                "tadolya" => new(C, "sube_tadolya_kar_tl_buyume", "genel_tadolya_kar_tl_buyume", "tadolya_kar_durum", O),
                _ => new(C, "sube_kar_buyume", "genel_kar_buyume", "sube_kar_durum", O),
            },
            "ET FİRE" => new(C, "kasap_imha", "kasap_imha_genel", "kasap_imha_durum", S),
            "MÜŞTERİ SAYISI" => new(D, "musteri_sayisi_buyume", "musteri_sayisi_buyume_genel", "musteri_sayisi_durum", O),
            "KİŞİ BAŞI CİRO" => new(D, "kisi_basi_ciro", "kisi_basi_ciro_genel", "kisi_basi_ciro_durum", O),
            "TURNOVER" => new(D, "turnover", "turnover_genel", "turnover_durum", O),
            "ÜRÜN YOK SATMA" => bolum == "sarkuteri"
                ? new(D, "yok_satmalar_sarkuteri", "yok_satmalar_sarkuteri_genel", "yok_satmalar_sarkuteri_durum", O)
                : new(D, "yok_satmalar", "yok_satmalar_genel", "yok_satmalar_durum", O),
            "GİDER ORANI" => new(D, "gider_orani", "gider_orani_genel", "gider_orani_durum", O),
            "İADE" => bolum == "sarkuteri"
                ? new(D, "iade_sarkuteri", "iade_sarkuteri_genel", "iade_sarkuteri_durum", O)
                : new(D, "iade", "iade_genel", "iade_durum", O),
            "FİYAT FARKLARI" => new(D, "fiyat_farki", "fiyat_farki_genel", "fiyat_farki_durum", O),
            "KALİTE & HİJYEN" => new(D, "kalite_hijyen", "kalite_hijyen_genel", "kalite_hijyen_durum", O),
            "KASA AÇIKLARI" => new(D, "kasa_aciklari", "kasa_aciklari_genel", "kasa_aciklari_durum", O),
            "MAL KABUL HATASI" => new(D, "mal_kabul_hatasi", "mal_kabul_hatasi_genel", "mal_kabul_durum", O),
            "FİŞ İPTAL SAYILARI" => new(D, "kasiyer_fis_iptal", null, "kasiyer_fis_iptal_durum", O),
            "SATIR İPTAL SAYILARI" => new(D, "kasiyer_satir_iptal", null, "kasiyer_satir_iptal_durum", O),
            "FİŞ & SATIR İPTAL SAYILARI" => new(D, "kasiyer_iptalleri", "kasiyer_iptalleri_genel", "kasiyer_iptalleri_durum", O),
            /* Beyaz et, manav ve tadolya firesinin kaynağı bu tablolarda yok:
               değer boş döner, ekran yalnız puanı gösterir */
            _ => null,
        };
    }

    /* ---------------------------------------------------------- değerler */

    private static decimal? Sayi(IDictionary<string, object> r, string sutun)
    {
        if (r is null || string.IsNullOrWhiteSpace(sutun)) return null;
        var a = r.Keys.FirstOrDefault(k => k.Equals(sutun, StringComparison.OrdinalIgnoreCase));
        if (a is null || r[a] is null) return null;
        return decimal.TryParse(Convert.ToString(r[a], CultureInfo.InvariantCulture), NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    private static string Metin(IDictionary<string, object> r, string k)
    {
        var a = r?.Keys.FirstOrDefault(x => x.Equals(k, StringComparison.OrdinalIgnoreCase));
        return a is null ? null : Convert.ToString(r[a], CultureInfo.InvariantCulture)?.Trim();
    }

    private Deger Oku(string olcut, string bolum, IDictionary<string, object> ciro, IDictionary<string, object> diger)
    {
        var e = Esle(olcut, bolum);
        if (e is null) return null;
        var r = e.Tablo == C ? ciro : diger;
        var durum = Sayi(r, e.DurumSutun);
        return new Deger(Sayi(r, e.DegerSutun), Sayi(r, e.EsikSutun), e.EsikAd, Yon(olcut), durum is null ? null : (int)durum.Value);
    }

    /// <summary>
    /// Bir şubenin bir dönemdeki ölçüt değerleri; ciro ve karlılık kişinin
    /// görevinin bölümüne göre. Şube adı birebir tutmazsa benzerlikle aranır.
    /// </summary>
    public Dictionary<string, Deger> Degerler(IDbConnection db, string subeAdi, int yil, int ay, string gorev = null)
    {
        var sonuc = new Dictionary<string, Deger>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (string.IsNullOrWhiteSpace(subeAdi)) return sonuc;
            var ciroSatirlari = db.Query("SELECT * FROM [biDb].[dbo].Magaza_Performans_Ciro WHERE Yil = @yil AND Tarih = @ay", new { yil, ay })
                .Cast<IDictionary<string, object>>().ToList();
            var ciro = ciroSatirlari.FirstOrDefault(r => string.Equals(Metin(r, "sube_adi"), subeAdi.Trim(), StringComparison.OrdinalIgnoreCase))
                    ?? ciroSatirlari.FirstOrDefault(r => PersonelKaynagiServisi.Benziyor(Metin(r, "sube_adi") ?? "", subeAdi.Trim()));
            IDictionary<string, object> diger = null;
            var subeId = Metin(ciro, "sube_id");
            if (subeId is not null)
                diger = db.QueryFirstOrDefault("SELECT * FROM [biDb].[dbo].Magaza_Performans_Diger WHERE sube_id = @subeId AND Yil = @yil AND Tarih = @ay",
                    new { subeId, yil, ay }) as IDictionary<string, object>;

            var bolum = Bolum(gorev);
            foreach (var olcut in Yonler.Keys)
                if (Oku(olcut, bolum, ciro, diger) is { } d) sonuc[olcut] = d;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ölçüt değerleri okunamadı: {Sube} {Yil}/{Ay}", subeAdi, yil, ay);
        }
        return sonuc;
    }

    /* ------------------------------------------------ gerçek puan sınırı */

    /// <summary>
    /// Bir ölçütte o ay puan alan ve alamayan mağazalar (aynı görev),
    /// değerleriyle. Yüksek iyi ölçütte puan alanların en düşük değeri,
    /// düşük iyi ölçütte en yüksek değeri gerçek sınırdır.
    /// </summary>
    public sealed record Sinir(decimal? PuanAlanEnZayif, decimal? AlamayanEnIyi, int Alan, int Alamayan);

    private static readonly Dictionary<string, (DateTime Zaman, Dictionary<string, Sinir> Veri)> _sinirOnbellek = new();

    public Dictionary<string, Sinir> PuanSinirlari(IDbConnection db, int yil, int ay, string gorev = null)
    {
        var anahtar = $"{yil}-{ay}-{gorev}";
        lock (_kilit)
            if (_sinirOnbellek.TryGetValue(anahtar, out var o) && (DateTime.Now - o.Zaman).TotalMinutes < 15)
                return o.Veri;

        var sonuc = new Dictionary<string, Sinir>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var puanSutunlari = db.Query<string>(@"SELECT COLUMN_NAME FROM [biDb].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Personel_Degerlendirme_Sonuclari'").ToHashSet(StringComparer.OrdinalIgnoreCase);
            var olcutler = Yonler.Keys.Where(puanSutunlari.Contains).ToList();
            if (olcutler.Count == 0) return sonuc;

            var secim = string.Join(", ", olcutler.Select(x => $"MAX(ISNULL([{x}], 0)) AS [{x}]"));
            var puanlar = db.Query($@"SELECT sube_adi, {secim} FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE yil = @yil AND ay = @ay AND sube_adi IS NOT NULL AND (@gorev IS NULL OR gorev_adi = @gorev) GROUP BY sube_adi",
                    new { yil, ay, gorev = string.IsNullOrWhiteSpace(gorev) ? null : gorev.Trim() })
                .Cast<IDictionary<string, object>>().ToList();
            var ciro = db.Query("SELECT * FROM [biDb].[dbo].Magaza_Performans_Ciro WHERE Yil = @yil AND Tarih = @ay", new { yil, ay })
                .Cast<IDictionary<string, object>>().ToList();
            var diger = db.Query("SELECT * FROM [biDb].[dbo].Magaza_Performans_Diger WHERE Yil = @yil AND Tarih = @ay", new { yil, ay })
                .Cast<IDictionary<string, object>>().ToList();

            var bolum = Bolum(gorev);
            var ciftler = olcutler.ToDictionary(x => x, _ => new List<(decimal Deger, bool Aldi)>(), StringComparer.OrdinalIgnoreCase);
            foreach (var p in puanlar)
            {
                var ad = Metin(p, "sube_adi") ?? "";
                var c = ciro.FirstOrDefault(r => string.Equals(Metin(r, "sube_adi"), ad, StringComparison.OrdinalIgnoreCase))
                        ?? ciro.FirstOrDefault(r => PersonelKaynagiServisi.Benziyor(Metin(r, "sube_adi") ?? "", ad));
                if (c is null) continue;
                var d = diger.FirstOrDefault(r => Metin(r, "sube_id") == Metin(c, "sube_id"));
                foreach (var o in olcutler)
                {
                    var deger = Oku(o, bolum, c, d)?.Sen;
                    var puan = Sayi(p, o);
                    if (deger is null || puan is null) continue;
                    ciftler[o].Add((deger.Value, puan.Value > 0));
                }
            }

            foreach (var (o, l) in ciftler)
            {
                if (l.Count == 0) continue;
                var yon = Yon(o);
                var alan = l.Where(x => x.Aldi).Select(x => x.Deger).ToList();
                var alamayan = l.Where(x => !x.Aldi).Select(x => x.Deger).ToList();
                sonuc[o] = new Sinir(
                    alan.Count == 0 ? null : yon > 0 ? alan.Min() : alan.Max(),
                    alamayan.Count == 0 ? null : yon > 0 ? alamayan.Max() : alamayan.Min(),
                    alan.Count, alamayan.Count);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Puan sınırları hesaplanamadı: {Yil}/{Ay}", yil, ay);
        }

        lock (_kilit) _sinirOnbellek[anahtar] = (DateTime.Now, sonuc);
        return sonuc;
    }


    /* ------------------------------------------- pozisyona göre ölçütler */

    private static readonly Dictionary<string, (DateTime Zaman, HashSet<string> Veri)> _gorevOnbellek = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Görevin değerlendirildiği ölçütler (24.10.2026). Ölçütler pozisyona
    /// göre değişiyor (kasap şefi: ciro, karlılık, kalite, et ve beyaz et
    /// fire); tablo ise her sütunu herkese yazıyor, kullanılmayanlara 0.
    /// Son 24 ayda o görevde en az bir kişinin puan aldığı ölçüt
    /// "uygulanıyor" sayılır; hiç puan çıkmamış ölçüt o görevin değil.
    /// </summary>
    public HashSet<string> GorevOlcutleri(IDbConnection db, string gorev, IReadOnlyCollection<string> sutunlar)
    {
        var bos = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(gorev) || sutunlar.Count == 0) return bos;
        var anahtar = gorev.Trim() + "|" + string.Join(",", sutunlar);
        lock (_kilit)
            if (_gorevOnbellek.TryGetValue(anahtar, out var o) && (DateTime.Now - o.Zaman).TotalMinutes < 30)
                return o.Veri;
        try
        {
            var bas = DateTime.Today.AddMonths(-24);
            /* Tabloda olmayan sütun sorguyu düşürür: önce kesiştirilir */
            var tablodaki = db.Query<string>(@"SELECT COLUMN_NAME FROM [biDb].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Personel_Degerlendirme_Sonuclari'").ToHashSet(StringComparer.OrdinalIgnoreCase);
            sutunlar = sutunlar.Where(tablodaki.Contains).ToList();
            if (sutunlar.Count == 0) return null;
            var secim = string.Join(", ", sutunlar.Select((x, i) => $"MAX(ISNULL([{x}], 0)) AS c{i}"));
            var r = db.QueryFirstOrDefault($@"SELECT {secim} FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE gorev_adi = @gorev AND yil * 100 + ay >= @bas", new { gorev = gorev.Trim(), bas = bas.Year * 100 + bas.Month }) as IDictionary<string, object>;
            var l = sutunlar.ToList();
            var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (r is not null)
                for (var i = 0; i < l.Count; i++)
                    if (r.TryGetValue("c" + i, out var v) && v is not null && Convert.ToDecimal(v) > 0) sonuc.Add(l[i]);
            lock (_kilit) _gorevOnbellek[anahtar] = (DateTime.Now, sonuc);
            return sonuc;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Görev ölçütleri okunamadı: {Gorev}", gorev);
            return null;
        }
    }

    /// <summary>
    /// Ölçüt satırının açıklaması (eski performans sayfasındaki gibi):
    /// eşik ve sizin değeriniz; puan alınamadıysa nedeni. Ortalamanın iyi
    /// tarafında kalıp puan alamayan için gerçek sınır kullanılır.
    /// </summary>
    public static (decimal? Esik, string EsikAd, string Neden) Aciklama(string olcut, decimal puan, Deger mv, Sinir sn)
    {
        var yon = Yon(olcut);
        var esik = mv?.Esik;
        var esikAd = mv?.EsikAd;
        static string Sy(decimal d) => d.ToString(Math.Abs(d) < 1 ? "0.####" : "0.##", new CultureInfo("tr-TR"));
        if (puan > 0 || mv?.Sen is not decimal sen || esik is not decimal es) return (esik, esikAd, null);

        var sinirAdi = esikAd == "Sınır" ? "sınırının" : "şirket ortalamasının";
        if (!IyiTarafta(sen, es, yon))
            return (esik, esikAd, $"{(esikAd == "Sınır" ? "Sınırın" : "Şirket ortalamasının")} {(yon > 0 ? "altında" : "üstünde")} kaldığınız için bu bölümden puan alamadınız.");

        if (sn?.PuanAlanEnZayif is decimal gz && !IyiTarafta(sen, gz, yon))
            return (gz, yon > 0 ? "Puan alan en düşük" : "Puan alan en yüksek",
                $"Değeriniz ({Sy(sen)}) {sinirAdi} ({Sy(es)}) {(yon > 0 ? "üzerinde" : "altında")}, ancak bu ay yetmedi: "
                + $"puan alan {sn.Alan} mağazanın en zayıf değeri {Sy(gz)}.");

        return (null, esikAd, $"Değeriniz ({Sy(sen)}) {sinirAdi} ({Sy(es)}) {(yon > 0 ? "üzerinde" : "altında")} olduğu hâlde puan verilmemiş; hesapta ek koşul olabilir.");
    }

    /// <summary>Değer eşiğin iyi tarafında mı (yön dikkate alınarak)</summary>
    public static bool IyiTarafta(decimal deger, decimal esik, int yon) => yon > 0 ? deger >= esik : deger <= esik;

    /// <summary>
    /// Puan alınmamış ama eşiğe çok yakın (göreli fark %3'ten az):
    /// "az kaldı" bildirimi ve ekrandaki uyarı için.
    /// </summary>
    public static bool AzKaldi(Deger d, bool aldi)
    {
        if (aldi || d?.Sen is null || d.Esik is null || d.Esik == 0) return false;

        return Math.Abs(d.Sen.Value - d.Esik.Value) / Math.Abs(d.Esik.Value) < 0.03m;
    }

    /// <summary>Puan alınmış ama eşiğin hemen yanında (göreli fark %1'den az).</summary>
    public static bool Sinirda(Deger d, bool aldi)
    {
        if (!aldi || d?.Sen is null || d.Esik is null || d.Esik == 0) return false;

        return Math.Abs(d.Sen.Value - d.Esik.Value) / Math.Abs(d.Esik.Value) < 0.01m;
    }
}

using System.Text.Json;
using System.Text.Json.Serialization;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Personel bütçesi hesap motoru (30.10.2026) — saf, veritabanından bağımsız.
/// ---------------------------------------------------------------------------
/// <para>
/// İK'nın "B_T_E" Excel'inin (2026 BÜTÇE sayfası) karşılığı. Her kişi için
/// 12 ay bordro: netten brüte çözüm (ikiye bölme, 1 kuruş), kümülatif gelir
/// vergisi matrahı, asgari ücret GV/DV istisnası, SGK tavanı, emekli (SGDP),
/// part-time gün oranı, işveren maliyeti, GR farkı, yan giderler ve tek
/// seferlik kalemler. Sonuç hem bordro ayına hem ödeme ayına göre toplanır.
/// </para>
/// <para>
/// Excel'den bilinçli farklar:
/// <list type="bullet">
/// <item>Kazan&amp;Kazan Excel'de toplamdan ÇIKARILIYORDU; burada maliyet
/// olarak EKLENİR (yan gider listesinde ayrı kalem, istenirse 0 yapılır).</item>
/// <item>Emekli personel Excel'de normal gibi hesaplanıyordu; burada SGDP:
/// işçi %7,5, işveren %24,75 (parametre), işsizlik ve 5 puan indirim yok.</item>
/// <item>Vergi dilimleri parametreden gelir; VBA'daki eski dilimler kullanılmaz.</item>
/// <item>İstisna sonrası GV/DV her ay en az 0 (Excel yalnız Ocak'ta sınırlıyordu).</item>
/// <item>Gelir vergisi her ay kümülatif matrah üzerinden hesaplanıp önceki
/// ayların vergisi düşülür (Excel'deki -SUM(...) ile aynı mantık).</item>
/// </list>
/// </para>
/// </summary>
public static class ButceHesap
{
    public static readonly string[] AyAdlari = { "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık" };

    public static readonly JsonSerializerOptions JsonAyar = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    /* ==================================================================== */
    /* Parametreler                                                          */
    /* ==================================================================== */

    public class VergiDilimi
    {
        /// <summary>Dilimin üst sınırı (kümülatif matrah); son dilimde null = sınırsız</summary>
        public decimal? UstSinir { get; set; }
        /// <summary>Oran (0.15 = %15)</summary>
        public decimal Oran { get; set; }
    }

    /// <summary>Kişi başı aylık yan gider kalemi (Excel'deki "2026 YEMEK", "2026 YOL"... sütunları)</summary>
    public class YanGider
    {
        public string Kod { get; set; }
        public string Ad { get; set; }
        /// <summary>Kişi başı aylık tutar (30 gün için)</summary>
        public decimal Tutar { get; set; }
        /// <summary>Part-time kişide gün oranıyla (gün/30) çarpılsın mı (yemek, maaş çeki)</summary>
        public bool GunOranli { get; set; }
        /// <summary>Kısa açıklama (nereden geldiği)</summary>
        public string Aciklama { get; set; }
    }

    /// <summary>Tek seferlik kalem: resmi tatil çalışması, bayram çeki, kıyafet...</summary>
    public class TekSeferlik
    {
        public string Kod { get; set; }
        public string Ad { get; set; }
        /// <summary>Ay (1–12)</summary>
        public int Ay { get; set; }
        /// <summary>
        /// "bordro": çalışıldığı ay (resmi tatil, gece); bir sonraki ayın
        /// bordrosuyla ödenir. "odeme": doğrudan ödendiği ay (çek, kıyafet).
        /// </summary>
        public string AyTuru { get; set; } = "odeme";
        /// <summary>Kişi başı tutar; GT için gün sayısı × günlük tutar</summary>
        public decimal Tutar { get; set; }
        /// <summary>Resmi tatil kalemi: gün sayısı (Tutar = Gun × GtGunluk)</summary>
        public decimal? Gun { get; set; }
        /// <summary>Gece çalışması kalemi: şube tablosundan kişi başı (Tutar çarpan: 1 ya da 0,5)</summary>
        public bool Gece { get; set; }
        public bool GunOranli { get; set; }
        public string Aciklama { get; set; }
    }

    public class GeceRol
    {
        public string Ad { get; set; }
        public decimal Maas { get; set; }
        /// <summary>Bu rol 4 kişilik kadroda da var mı</summary>
        public bool DortKisideVar { get; set; } = true;
    }

    public class GeceSube
    {
        public string Sube { get; set; }
        /// <summary>Gece çalışacak kişi (4 ya da 5)</summary>
        public int Kisi { get; set; }
        /// <summary>Şube norm kadrosu (kişi başına bölmek için)</summary>
        public int Norm { get; set; }
    }

    public class Parametre
    {
        public int Yil { get; set; } = 2026;
        public decimal AsgariUcretBrut { get; set; } = 33030m;
        /// <summary>SGK tavanı = asgari × katsayı</summary>
        public decimal TavanKatsayisi { get; set; } = 9m;
        public List<VergiDilimi> VergiDilimleri { get; set; } = new()
        {
            new() { UstSinir = 190000m, Oran = 0.15m },
            new() { UstSinir = 400000m, Oran = 0.20m },
            new() { UstSinir = 1500000m, Oran = 0.27m },
            new() { UstSinir = 5800000m, Oran = 0.35m },
            new() { UstSinir = null, Oran = 0.40m },
        };
        public decimal SgkIsci { get; set; } = 0.14m;
        public decimal IssizlikIsci { get; set; } = 0.01m;
        public decimal DamgaVergisi { get; set; } = 0.00759m;
        public decimal SgkIsveren { get; set; } = 0.2175m;
        /// <summary>5510/81 işveren indirimi (puan); emekliye uygulanmaz</summary>
        public decimal IsverenIndirim { get; set; } = 0.02m;
        public decimal IssizlikIsveren { get; set; } = 0.02m;
        public decimal SgdpIsci { get; set; } = 0.075m;
        public decimal SgdpIsveren { get; set; } = 0.2475m;
        /// <summary>Asgari ücret GV/DV istisnası uygulansın mı</summary>
        public bool AsgariIstisna { get; set; } = true;
        /// <summary>Fazla mesai / tatil kalemlerinde maliyet çarpanı (SGK + vergi payı)</summary>
        public decimal MaliyetKatsayisi { get; set; } = 1.35m;
        /// <summary>Resmi tatil çalışması: kişi başı günlük maliyet</summary>
        public decimal GtGunluk { get; set; } = 1353.3416m;
        public List<YanGider> YanGiderler { get; set; } = VarsayilanYanGiderler();
        public List<TekSeferlik> TekSeferlikler { get; set; } = VarsayilanTekSeferlikler();
        public List<GeceRol> GeceRoller { get; set; } = new()
        {
            new() { Ad = "Yönetici", Maas = 55824m },
            new() { Ad = "Kasa", Maas = 30885m },
            new() { Ad = "Tezgah", Maas = 41555m },
            new() { Ad = "Manav", Maas = 40652m },
            new() { Ad = "Reyon", Maas = 30633m, DortKisideVar = false },
        };
        /// <summary>Gece mesaisi = maaş / 225 × 1,125 × 30 (aylık) × maliyet katsayısı</summary>
        public decimal GeceSaatKatsayisi { get; set; } = 1.125m;
        public List<GeceSube> GeceSubeler { get; set; } = new();
        /// <summary>Zam sonrası bordro neti asgari ücret netinin altında kalmasın</summary>
        public bool BordroNetEnAzAsgari { get; set; } = true;
        /// <summary>Yol ücretinin SGK + vergi payı (Excel: yol × 0,35)</summary>
        public decimal YolSgkOrani { get; set; } = 0.35m;
        /// <summary>Senaryo türetilirken kişiye özel yan gider tutarlarına (yol, kasa tazminatı, İSG…) uygulanacak artış (0,32 = %32; Excel yolda ×1,2×1,1)</summary>
        public decimal KisiKalemArtis { get; set; } = 0m;

        public static List<YanGider> VarsayilanYanGiderler() => new()
        {
            new() { Kod = "yemek", Ad = "Yemek", Tutar = 7000m, GunOranli = true, Aciklama = "Aylık yemek kartı; part-time'da gün oranıyla" },
            /* Yol kişi bazlıdır (Kisi.Yol); buradaki tutar yolu boş kişiler için varsayılan */
            new() { Kod = "yol", Ad = "Yol", Tutar = 1728.7m, Aciklama = "Kişinin kendi yol tutarı; boşsa bu varsayılan" },
            new() { Kod = "yolSgk", Ad = "Yol SGK payı", Tutar = 0m, Aciklama = "Kişinin yolu × yol SGK oranı (%35)" },
            new() { Kod = "maasCek", Ad = "Maaş çeki", Tutar = 2000m, GunOranli = true },
            new() { Kod = "trendyolCek", Ad = "Trendyol çeki", Tutar = 175.85m },
            new() { Kod = "primCek", Ad = "Prim çeki", Tutar = 1289.57m, Aciklama = "2025 aylık prim çeki ortalaması / kişi" },
            new() { Kod = "sgkDanismanlik", Ad = "SGK danışmanlık", Tutar = 25.97m },
            new() { Kod = "kasaTazminati", Ad = "Kasa tazminatı", Tutar = 500m },
            new() { Kod = "tesvikIottech", Ad = "Teşvik (IOTTECH)", Tutar = 16.75m * 1.27m },
            new() { Kod = "isg", Ad = "İSG", Tutar = 0m },
            new() { Kod = "kiyafet", Ad = "Kıyafet", Tutar = 125.4m * 1.3m },
            new() { Kod = "ihbar", Ad = "İhbar tazminatı", Tutar = 95m * 1.27m },
            new() { Kod = "isciAlacagi", Ad = "İşçi alacağı", Tutar = 1499.01m },
            new() { Kod = "terfiFark", Ad = "Terfi / atama fark ücreti", Tutar = 86.21m },
            new() { Kod = "hediye", Ad = "Hediye (düğün, cenaze, doğum)", Tutar = 81.43m, Aciklama = "Aylık ort. 5 kişi × asgari/2 ÷ kişi sayısı" },
            new() { Kod = "satisGmy", Ad = "Satış GMY bütçesi", Tutar = 75m },
            new() { Kod = "fazlaMesai", Ad = "Fazla mesai", Tutar = 313.23m, Aciklama = "2025 aylık FM ortalaması × 1,35 ÷ kişi" },
            /* Excel'de bu kalem toplamdan ÇIKARILIYORDU (-KJ); maliyet olduğu için burada EKLENİR */
            new() { Kod = "kazanKazan", Ad = "Kazan-Kazan", Tutar = 90000m / 770m * 1.27m, Aciklama = "Excel'de eksi yazılmıştı; maliyet olarak eklenir" },
            new() { Kod = "egitim", Ad = "Eğitim", Tutar = 87m },
        };

        public static List<TekSeferlik> VarsayilanTekSeferlikler() => new()
        {
            new() { Kod = "gtOcak", Ad = "Resmi tatil çalışması (1 Ocak)", Ay = 1, AyTuru = "bordro", Gun = 1m },
            new() { Kod = "ramazanCeki", Ad = "Ramazan çeki", Ay = 2, AyTuru = "odeme", Tutar = 3500m },
            new() { Kod = "gtMart", Ad = "Resmi tatil çalışması (Ramazan Bayramı)", Ay = 3, AyTuru = "bordro", Gun = 3.5m, Aciklama = "Excel formülünde 4,25 gün kullanılmıştı" },
            new() { Kod = "gtNisan", Ad = "Resmi tatil çalışması (23 Nisan)", Ay = 4, AyTuru = "bordro", Gun = 1m },
            new() { Kod = "bayramCeki", Ad = "Bayram çeki", Ay = 5, AyTuru = "odeme", Tutar = 3500m },
            new() { Kod = "gtMayis", Ad = "Resmi tatil çalışması (1 Mayıs, 19 Mayıs, Kurban Bayramı)", Ay = 5, AyTuru = "bordro", Gun = 7m },
            new() { Kod = "geceHaziran", Ad = "Gece çalışması (Haziran)", Ay = 6, AyTuru = "bordro", Gece = true, Tutar = 1m },
            new() { Kod = "gtTemmuz", Ad = "Resmi tatil çalışması (15 Temmuz)", Ay = 7, AyTuru = "bordro", Gun = 1m },
            new() { Kod = "geceTemmuz", Ad = "Gece çalışması (Temmuz)", Ay = 7, AyTuru = "bordro", Gece = true, Tutar = 1m },
            new() { Kod = "kiyafetAgustos", Ad = "Kıyafet (yazlık)", Ay = 8, AyTuru = "odeme", Tutar = 1360.42m },
            new() { Kod = "gtAgustos", Ad = "Resmi tatil çalışması (30 Ağustos)", Ay = 8, AyTuru = "bordro", Gun = 1m },
            new() { Kod = "geceAgustos", Ad = "Gece çalışması (Ağustos)", Ay = 8, AyTuru = "bordro", Gece = true, Tutar = 1m },
            new() { Kod = "geceEylul", Ad = "Gece çalışması (Eylül, yarım)", Ay = 9, AyTuru = "bordro", Gece = true, Tutar = 0.5m },
            new() { Kod = "gtEkim", Ad = "Resmi tatil çalışması (29 Ekim)", Ay = 10, AyTuru = "bordro", Gun = 1.5m },
        };

        public Parametre Kopya() => JsonSerializer.Deserialize<Parametre>(JsonSerializer.Serialize(this, JsonAyar), JsonAyar);
    }

    /* ==================================================================== */
    /* Kişi ve zam kuralı                                                    */
    /* ==================================================================== */

    public class Kisi
    {
        public int Id { get; set; }
        public string Sube { get; set; }
        public string Bolum { get; set; }
        public string Sicil { get; set; }
        public string Ad { get; set; }
        /// <summary>30 tam, 15 part-time</summary>
        public int Gun { get; set; } = 30;
        public bool Emekli { get; set; }
        public string Meslek { get; set; }
        /// <summary>Önceki yıl gerçek net (GRM)</summary>
        public decimal GrmOnceki { get; set; }
        /// <summary>Bu yıl gerçek net (GRM): bankaya yatan + elden fark</summary>
        public decimal Grm { get; set; }
        /// <summary>Bordro neti (30 gün için); brüt bundan çözülür</summary>
        public decimal BordroNet { get; set; }
        /// <summary>Kişiye özel yan gider tutarları (kod → aylık tutar): yol, kasa tazminatı, İSG… Olmayan kalem parametredeki varsayılanı alır.</summary>
        public Dictionary<string, decimal> YanGiderler { get; set; }
        public bool Aktif { get; set; } = true;
        /// <summary>Kişi başı sayısı (1 ya da 0,5) — FTE</summary>
        public decimal KisiSayisi => Gun >= 30 ? 1m : 0.5m;
    }

    public class ZamKurali
    {
        /// <summary>genel | sube | meslek | subeMeslek | kisi</summary>
        public string Tur { get; set; } = "genel";
        public string Sube { get; set; }
        public string Meslek { get; set; }
        public int? KisiId { get; set; }
        /// <summary>Bordro netine uygulanacak oran (0.27 = %27)</summary>
        public decimal BordroOran { get; set; }
        /// <summary>GRM'ye uygulanacak oran; null = bordro oranıyla aynı</summary>
        public decimal? GrmOran { get; set; }
        public string Aciklama { get; set; }

        public int Oncelik => Tur switch { "kisi" => 5, "subeMeslek" => 4, "meslek" => 3, "sube" => 2, _ => 1 };
    }

    /* ==================================================================== */
    /* Sonuçlar                                                              */
    /* ==================================================================== */

    public class AyBordro
    {
        public int Ay { get; set; }
        public decimal Brut { get; set; }
        public decimal SgkIsci { get; set; }
        public decimal IssizlikIsci { get; set; }
        public decimal Matrah { get; set; }
        public decimal KumulatifMatrah { get; set; }
        public decimal Gv { get; set; }
        public decimal Dv { get; set; }
        public decimal GvIstisna { get; set; }
        public decimal DvIstisna { get; set; }
        public decimal GvSon { get; set; }
        public decimal DvSon { get; set; }
        public decimal Net { get; set; }
        public decimal SskIsveren { get; set; }
        public decimal Indirim { get; set; }
        public decimal IssizlikIsveren { get; set; }
        /// <summary>(brüt + SSK işveren − indirim + işsizlik işveren) × gün/30</summary>
        public decimal IsverenMaliyeti { get; set; }
        /// <summary>Net × gün/30</summary>
        public decimal NetBanka { get; set; }
        /// <summary>GRM − net banka (elden ödenen fark)</summary>
        public decimal GrFarki { get; set; }
        public decimal YanGider { get; set; }
        public decimal TekSeferlik { get; set; }
        public List<KalemTutar> TekSeferlikKalemler { get; set; } = new();
        /// <summary>İşveren maliyeti + GR farkı + yan gider + tek seferlik</summary>
        public decimal Toplam => IsverenMaliyeti + GrFarki + YanGider + TekSeferlik;
    }

    public record KalemTutar(string Kod, string Ad, decimal Tutar);

    public class KisiSonuc
    {
        public Kisi Kisi { get; set; }
        public List<AyBordro> Aylar { get; set; } = new();
        public List<KalemTutar> YanGiderKalemleri { get; set; } = new();
        public decimal YillikToplam => Aylar.Sum(a => a.Toplam);
        public decimal YillikIsveren => Aylar.Sum(a => a.IsverenMaliyeti);
        public decimal YillikBrut => Aylar.Sum(a => a.Brut) * Math.Clamp(Kisi.Gun, 0, 30) / 30m;
        public decimal YillikGrFarki => Aylar.Sum(a => a.GrFarki);
        public decimal YillikYanGider => Aylar.Sum(a => a.YanGider);
        public decimal YillikTekSeferlik => Aylar.Sum(a => a.TekSeferlik);
        public decimal YillikNetBanka => Aylar.Sum(a => a.NetBanka);
    }

    /// <summary>Bir ayın (bordro ya da ödeme ayı) maliyet bileşenleri</summary>
    public class AyOzeti
    {
        public int Ay { get; set; }
        public string Etiket { get; set; }
        public decimal Brut { get; set; }
        public decimal IsverenSgk { get; set; }
        public decimal GrFarki { get; set; }
        public decimal YanGider { get; set; }
        public decimal TekSeferlik { get; set; }
        public decimal NetBanka { get; set; }
        public decimal Toplam => Brut + IsverenSgk + GrFarki + YanGider + TekSeferlik;
    }

    public class GrupOzeti
    {
        public string Ad { get; set; }
        public int Kisi { get; set; }
        public decimal Fte { get; set; }
        public decimal Toplam { get; set; }
        public decimal Brut { get; set; }
        public decimal IsverenSgk { get; set; }
        public decimal GrFarki { get; set; }
        public decimal YanGider { get; set; }
        public decimal TekSeferlik { get; set; }
        public decimal OrtalamaNet { get; set; }
        public decimal KisiBasiAylik => Fte == 0 ? 0 : Toplam / 12m / Fte;
    }

    public class SenaryoSonuc
    {
        public int Kisi { get; set; }
        public decimal Fte { get; set; }
        public decimal YillikToplam { get; set; }
        public decimal AylikOrtalama => YillikToplam / 12m;
        public decimal KisiBasiAylik => Fte == 0 ? 0 : YillikToplam / 12m / Fte;
        public decimal YillikBrut { get; set; }
        public decimal YillikIsverenSgk { get; set; }
        public decimal YillikGrFarki { get; set; }
        public decimal YillikYanGider { get; set; }
        public decimal YillikTekSeferlik { get; set; }
        public decimal YillikNetBanka { get; set; }
        public decimal YillikGrm { get; set; }
        /// <summary>Toplam maliyet / kişiye ödenen gerçek net (GRM)</summary>
        public decimal NetMaliyetCarpani => YillikGrm == 0 ? 0 : YillikToplam / YillikGrm;
        public decimal AsgariNet { get; set; }
        public List<AyOzeti> BordroAylari { get; set; } = new();
        public List<AyOzeti> OdemeAylari { get; set; } = new();
        public List<GrupOzeti> Subeler { get; set; } = new();
        public List<GrupOzeti> Meslekler { get; set; } = new();
        public List<KalemTutar> YanGiderDagilimi { get; set; } = new();
        public List<KalemTutar> TekSeferlikDagilimi { get; set; } = new();
        public List<KisiSonuc> Kisiler { get; set; } = new();
    }

    /* ==================================================================== */
    /* Vergi ve netten brüte                                                 */
    /* ==================================================================== */

    /// <summary>Kümülatif matrah için toplam gelir vergisi (dilimli)</summary>
    public static decimal GelirVergisi(decimal matrah, IReadOnlyList<VergiDilimi> dilimler)
    {
        if (matrah <= 0 || dilimler is null || dilimler.Count == 0) return 0m;
        decimal vergi = 0m, alt = 0m;
        foreach (var d in dilimler)
        {
            var ust = d.UstSinir ?? decimal.MaxValue;
            if (matrah <= ust) { vergi += (matrah - alt) * d.Oran; return vergi; }
            vergi += (ust - alt) * d.Oran;
            alt = ust;
        }
        return vergi;
    }

    /// <summary>Verilen brüt için ayın bordrosu (30 gün esası; gün oranı dışarıda uygulanır)</summary>
    public static AyBordro BrutHesapla(decimal brut, bool emekli, decimal oncekiKumulatif, decimal oncekiAsgariKumulatif, Parametre p)
    {
        var tavan = p.AsgariUcretBrut * p.TavanKatsayisi;
        var sgkMatrah = Math.Min(brut, tavan);
        var a = new AyBordro { Brut = brut };
        a.SgkIsci = sgkMatrah * (emekli ? p.SgdpIsci : p.SgkIsci);
        a.IssizlikIsci = emekli ? 0m : sgkMatrah * p.IssizlikIsci;
        a.Matrah = brut - a.SgkIsci - a.IssizlikIsci;
        a.KumulatifMatrah = oncekiKumulatif + a.Matrah;
        a.Gv = GelirVergisi(a.KumulatifMatrah, p.VergiDilimleri) - GelirVergisi(oncekiKumulatif, p.VergiDilimleri);
        a.Dv = brut * p.DamgaVergisi;
        if (p.AsgariIstisna)
        {
            var asgariMatrah = p.AsgariUcretBrut - p.AsgariUcretBrut * p.SgkIsci - p.AsgariUcretBrut * p.IssizlikIsci;
            var asgariKum = oncekiAsgariKumulatif + asgariMatrah;
            a.GvIstisna = GelirVergisi(asgariKum, p.VergiDilimleri) - GelirVergisi(oncekiAsgariKumulatif, p.VergiDilimleri);
            a.DvIstisna = p.AsgariUcretBrut * p.DamgaVergisi;
        }
        a.GvSon = Math.Max(0m, a.Gv - a.GvIstisna);
        a.DvSon = Math.Max(0m, a.Dv - a.DvIstisna);
        a.Net = brut - a.SgkIsci - a.IssizlikIsci - a.GvSon - a.DvSon;
        a.SskIsveren = sgkMatrah * (emekli ? p.SgdpIsveren : p.SgkIsveren);
        a.Indirim = emekli ? 0m : sgkMatrah * p.IsverenIndirim;
        a.IssizlikIsveren = emekli ? 0m : sgkMatrah * p.IssizlikIsveren;
        return a;
    }

    /// <summary>
    /// Netten brüte: ikiye bölme, 1 kuruş hassasiyet. Net brüt'e göre
    /// monoton arttığından aralık [net, net×3] yeterlidir.
    /// </summary>
    public static decimal NettenBrut(decimal net, bool emekli, decimal oncekiKumulatif, decimal oncekiAsgariKumulatif, Parametre p)
    {
        if (net <= 0) return 0m;
        decimal alt = net, ust = net * 3m;
        for (var i = 0; i < 60 && ust - alt > 0.001m; i++)
        {
            var orta = (alt + ust) / 2m;
            var n = BrutHesapla(orta, emekli, oncekiKumulatif, oncekiAsgariKumulatif, p).Net;
            if (n < net) alt = orta; else ust = orta;
        }
        return Math.Round(ust, 2, MidpointRounding.AwayFromZero);
    }

    /// <summary>Asgari ücretin Ocak ayı neti (normal sigortalı, tam ay)</summary>
    public static decimal AsgariNet(Parametre p) => Math.Round(BrutHesapla(p.AsgariUcretBrut, false, 0m, 0m, p).Net, 2);

    /* ==================================================================== */
    /* Kişi hesabı                                                           */
    /* ==================================================================== */

    public static decimal GeceKisiBasi(string sube, Parametre p)
    {
        if (string.IsNullOrWhiteSpace(sube) || p.GeceSubeler is null) return 0m;
        var s = p.GeceSubeler.FirstOrDefault(x => string.Equals(x.Sube?.Trim(), sube.Trim(), StringComparison.OrdinalIgnoreCase));
        if (s is null || s.Norm <= 0) return 0m;
        var roller = p.GeceRoller.Where(r => s.Kisi >= 5 || r.DortKisideVar);
        var mesai = roller.Sum(r => r.Maas / 225m * p.GeceSaatKatsayisi * 30m) * p.MaliyetKatsayisi;
        return mesai / s.Norm;
    }

    public static KisiSonuc KisiHesapla(Kisi k, Parametre p)
    {
        var s = new KisiSonuc { Kisi = k };
        var gunOrani = Math.Clamp(k.Gun, 0, 30) / 30m;

        /* Yan giderler (her ay aynı) */
        decimal yan = 0m;
        var ozel = k.YanGiderler ?? new Dictionary<string, decimal>();
        var yolVarsayilan = (p.YanGiderler ?? new()).FirstOrDefault(y => y.Kod == "yol")?.Tutar ?? 0m;
        var yol = ozel.TryGetValue("yol", out var oy) ? oy : yolVarsayilan;
        foreach (var y in p.YanGiderler ?? new())
        {
            /* Kişiye özel tutar varsa o (gün oranı uygulanmaz: kişinin fiili tutarı); yoksa varsayılan */
            var t = y.Kod == "yol" ? yol
                : y.Kod == "yolSgk" ? yol * p.YolSgkOrani
                : ozel.TryGetValue(y.Kod, out var ot) ? ot
                : y.GunOranli ? y.Tutar * gunOrani : y.Tutar;
            s.YanGiderKalemleri.Add(new KalemTutar(y.Kod, y.Ad, t));
            yan += t;
        }
        var gece = (p.TekSeferlikler ?? new()).Any(t => t.Gece) ? GeceKisiBasi(k.Sube, p) : 0m;

        decimal kum = 0m, asgariKum = 0m;
        for (var ay = 1; ay <= 12; ay++)
        {
            var brut = NettenBrut(k.BordroNet, k.Emekli, kum, asgariKum, p);
            var a = BrutHesapla(brut, k.Emekli, kum, asgariKum, p);
            a.Ay = ay;
            kum = a.KumulatifMatrah;
            if (p.AsgariIstisna) asgariKum += p.AsgariUcretBrut - p.AsgariUcretBrut * p.SgkIsci - p.AsgariUcretBrut * p.IssizlikIsci;

            a.IsverenMaliyeti = (a.Brut + a.SskIsveren - a.Indirim + a.IssizlikIsveren) * gunOrani;
            a.NetBanka = a.Net * gunOrani;
            a.GrFarki = k.Grm - a.NetBanka;
            a.YanGider = yan;

            foreach (var t in p.TekSeferlikler ?? new())
            {
                /* Ödeme ayı kalemi bir önceki ayın bordrosuyla ödenir → bordro ayı = ay − 1 */
                var bordroAy = t.AyTuru == "odeme" ? Math.Max(1, t.Ay - 1) : t.Ay;
                if (bordroAy != ay) continue;
                decimal tutar = t.Gece ? gece * t.Tutar : t.Gun is { } g ? g * p.GtGunluk : t.Tutar;
                if (t.GunOranli) tutar *= gunOrani;
                if (tutar == 0m) continue;
                a.TekSeferlikKalemler.Add(new KalemTutar(t.Kod, t.Ad, tutar));
                a.TekSeferlik += tutar;
            }
            s.Aylar.Add(a);
        }
        return s;
    }

    /* ==================================================================== */
    /* Zam kuralları                                                         */
    /* ==================================================================== */

    /// <summary>Kişiye uygulanacak kural: kişi &gt; şube+meslek &gt; meslek &gt; şube &gt; genel</summary>
    public static ZamKurali KuralSec(Kisi k, IEnumerable<ZamKurali> kurallar)
    {
        static bool Es(string a, string b) => string.Equals(a?.Trim(), b?.Trim(), StringComparison.OrdinalIgnoreCase);
        return (kurallar ?? Enumerable.Empty<ZamKurali>())
            .Where(r => r.Tur switch
            {
                "kisi" => r.KisiId == k.Id,
                "subeMeslek" => Es(r.Sube, k.Sube) && Es(r.Meslek, k.Meslek),
                "meslek" => Es(r.Meslek, k.Meslek),
                "sube" => Es(r.Sube, k.Sube),
                _ => true,
            })
            .OrderByDescending(r => r.Oncelik)
            .FirstOrDefault();
    }

    /// <summary>
    /// Baz kişilere zam kurallarını uygular; yeni yılın kişi listesini
    /// döndürür (GRM önceki = bazın GRM'si). Bordro neti ve GRM ayrı oranla
    /// artar; "en az asgari net" seçiliyse bordro neti asgari netin altına inmez.
    /// </summary>
    public static List<Kisi> ZamUygula(IEnumerable<Kisi> baz, IEnumerable<ZamKurali> kurallar, Parametre yeniParametre)
    {
        var asgariNet = yeniParametre.BordroNetEnAzAsgari ? AsgariNet(yeniParametre) : 0m;
        var liste = new List<Kisi>();
        foreach (var b in baz)
        {
            var r = KuralSec(b, kurallar);
            var bo = r?.BordroOran ?? 0m;
            var go = r?.GrmOran ?? bo;
            var bordro = Math.Round(b.BordroNet * (1 + bo), 2);
            var grm = Math.Round(b.Grm * (1 + go), 2);
            if (asgariNet > 0 && b.BordroNet > 0 && bordro < asgariNet) bordro = asgariNet;
            var netBankaTahmini = Math.Round(bordro * Math.Clamp(b.Gun, 0, 30) / 30m, 2);
            if (grm < netBankaTahmini) grm = netBankaTahmini;
            liste.Add(new Kisi
            {
                Id = b.Id, Sube = b.Sube, Bolum = b.Bolum, Sicil = b.Sicil, Ad = b.Ad, Gun = b.Gun, Emekli = b.Emekli, Meslek = b.Meslek,
                GrmOnceki = b.Grm, Grm = grm, BordroNet = bordro, Aktif = b.Aktif,
                YanGiderler = b.YanGiderler is null ? null : b.YanGiderler.ToDictionary(x => x.Key, x => Math.Round(x.Value * (1 + yeniParametre.KisiKalemArtis), 2)),
            });
        }
        return liste;
    }

    /* ==================================================================== */
    /* Senaryo toplamı                                                       */
    /* ==================================================================== */

    public static SenaryoSonuc SenaryoHesapla(IEnumerable<Kisi> kisiler, Parametre p, bool kisileriEkle = true)
    {
        var s = new SenaryoSonuc { AsgariNet = AsgariNet(p) };
        var aktif = kisiler.Where(k => k.Aktif).ToList();
        var sonuclar = aktif.Select(k => KisiHesapla(k, p)).ToList();

        for (var ay = 1; ay <= 12; ay++)
        {
            s.BordroAylari.Add(new AyOzeti { Ay = ay, Etiket = AyAdlari[ay - 1] });
            var odeme = ay == 12 ? 1 : ay + 1;
            s.OdemeAylari.Add(new AyOzeti { Ay = ay, Etiket = AyAdlari[odeme - 1] + (ay == 12 ? $" {p.Yil + 1}" : "") });
        }

        var yanDagilim = new Dictionary<string, (string Ad, decimal T)>();
        var tekDagilim = new Dictionary<string, (string Ad, decimal T)>();
        var subeler = new Dictionary<string, GrupOzeti>(StringComparer.OrdinalIgnoreCase);
        var meslekler = new Dictionary<string, GrupOzeti>(StringComparer.OrdinalIgnoreCase);

        foreach (var ks in sonuclar)
        {
            var k = ks.Kisi;
            var oran = Math.Clamp(k.Gun, 0, 30) / 30m;
            s.Kisi++;
            s.Fte += k.KisiSayisi;
            s.YillikGrm += k.Grm * 12m;
            foreach (var a in ks.Aylar)
            {
                var brut = a.Brut * oran;
                var isverenSgk = (a.SskIsveren - a.Indirim + a.IssizlikIsveren) * oran;
                void Ekle(AyOzeti o)
                {
                    o.Brut += brut; o.IsverenSgk += isverenSgk; o.GrFarki += a.GrFarki;
                    o.YanGider += a.YanGider; o.TekSeferlik += a.TekSeferlik; o.NetBanka += a.NetBanka;
                }
                Ekle(s.BordroAylari[a.Ay - 1]);
                Ekle(s.OdemeAylari[a.Ay - 1]);
                s.YillikBrut += brut; s.YillikIsverenSgk += isverenSgk; s.YillikGrFarki += a.GrFarki;
                s.YillikYanGider += a.YanGider; s.YillikTekSeferlik += a.TekSeferlik; s.YillikNetBanka += a.NetBanka;
                foreach (var t in a.TekSeferlikKalemler)
                    tekDagilim[t.Kod] = (t.Ad, tekDagilim.GetValueOrDefault(t.Kod).T + t.Tutar);
            }
            foreach (var y in ks.YanGiderKalemleri)
                yanDagilim[y.Kod] = (y.Ad, yanDagilim.GetValueOrDefault(y.Kod).T + y.Tutar * 12m);

            void Grup(Dictionary<string, GrupOzeti> d, string ad)
            {
                ad = string.IsNullOrWhiteSpace(ad) ? "Belirtilmemiş" : ad.Trim();
                if (!d.TryGetValue(ad, out var g)) d[ad] = g = new GrupOzeti { Ad = ad };
                g.Kisi++; g.Fte += k.KisiSayisi; g.Toplam += ks.YillikToplam; g.Brut += ks.YillikBrut;
                g.IsverenSgk += ks.Aylar.Sum(a => (a.SskIsveren - a.Indirim + a.IssizlikIsveren) * oran);
                g.GrFarki += ks.YillikGrFarki; g.YanGider += ks.YillikYanGider; g.TekSeferlik += ks.YillikTekSeferlik;
                g.OrtalamaNet += k.Grm;
            }
            Grup(subeler, k.Sube);
            Grup(meslekler, k.Meslek);
        }
        s.YillikToplam = s.YillikBrut + s.YillikIsverenSgk + s.YillikGrFarki + s.YillikYanGider + s.YillikTekSeferlik;
        foreach (var g in subeler.Values.Concat(meslekler.Values)) g.OrtalamaNet = g.Kisi == 0 ? 0 : g.OrtalamaNet / g.Kisi;
        s.Subeler = subeler.Values.OrderByDescending(g => g.Toplam).ToList();
        s.Meslekler = meslekler.Values.OrderByDescending(g => g.Toplam).ToList();
        s.YanGiderDagilimi = yanDagilim.Select(x => new KalemTutar(x.Key, x.Value.Ad, x.Value.T)).OrderByDescending(x => x.Tutar).ToList();
        s.TekSeferlikDagilimi = tekDagilim.Select(x => new KalemTutar(x.Key, x.Value.Ad, x.Value.T)).OrderByDescending(x => x.Tutar).ToList();
        if (kisileriEkle) s.Kisiler = sonuclar;
        return s;
    }
}

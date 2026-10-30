using System.Data;
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Rakip web fiyatları ve ürün eşleştirme (09.10.2026).
///
/// <para>
/// "rakip-web-fiyat" aracının ürettiği Excel portala yükleniyor. Web'deki
/// ürün adı bizim stok adımızdan farklı olduğu için her web ürünü bir kez
/// elle bir stok kartına eşleştiriliyor (site + sadeleştirilmiş ad; ürün
/// linki de saklanıyor). Sonraki yüklemelerde aynı ürün kendiliğinden
/// eşleşiyor. Eşleşen her satır rakip fiyat kaydına (B360_RAKIP_FIYAT,
/// kaynak = web) çevriliyor; analiz ekranı mağazada okutulanlarla birlikte
/// gösteriyor.
/// </para>
/// </summary>
public class RakipWebServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<RakipWebServisi> _kayit;

    public RakipWebServisi(VeritabaniServisi vt, IConfiguration yapilandirma, ILogger<RakipWebServisi> kayit)
    {
        _vt = vt;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    /* ==================================================================== */
    /* Anahtarlar                                                           */
    /* ==================================================================== */

    /// <summary>Karşılaştırma anahtarı: küçük harf, Türkçe harfler ASCII, yalnız harf/rakam</summary>
    public static string Anahtar(string s)
    {
        var sb = new StringBuilder();
        foreach (var h in (s ?? "").ToLower(Tr))
        {
            var c = h switch
            {
                'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
                'â' => 'a', 'î' => 'i', 'û' => 'u', _ => h
            };
            sb.Append(char.IsLetterOrDigit(c) && c < 128 ? c : ' ');
        }
        return Regex.Replace(sb.ToString(), @"\s+", " ").Trim();
    }

    /// <summary>Link anahtarı: sorgu ve parça atılır</summary>
    public static string LinkAnahtari(string link)
    {
        if (string.IsNullOrWhiteSpace(link)) return null;
        if (!Uri.TryCreate(link.Trim(), UriKind.Absolute, out var u)) return null;
        var k = (u.Host.Replace("www.", "") + u.AbsolutePath).TrimEnd('/').ToLowerInvariant();
        return k.Length > 440 ? k[..440] : k;
    }

    private static readonly HashSet<string> Durak = new()
    {
        "ve", "ile", "icin", "adet", "li", "lu", "lı", "lü", "paket", "pk", "x", "the", "yeni", "indirim", "kampanya",
    };

    private static readonly Regex MiktarDeseni = new(
        @"(\d+(?:[.,]\d+)?)\s*(kg|kilo|gr|g|gram|lt|l|litre|ml|cl|cc)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Ad içindeki miktarlar, ortak birimde: "1 L" → "1000ml", "500 GR" → "500g"</summary>
    public static HashSet<string> Miktarlar(string ad)
    {
        var l = new HashSet<string>();
        foreach (Match m in MiktarDeseni.Matches(Anahtar(ad).Replace(" ,", ",")))
        {
            if (!decimal.TryParse(m.Groups[1].Value.Replace(',', '.'), NumberStyles.Number, CultureInfo.InvariantCulture, out var v)) continue;
            var b = m.Groups[2].Value.ToLowerInvariant();
            var (deger, birim) = b switch
            {
                "kg" or "kilo" => (v * 1000, "g"),
                "gr" or "g" or "gram" => (v, "g"),
                "lt" or "l" or "litre" => (v * 1000, "ml"),
                "cl" => (v * 10, "ml"),
                _ => (v, "ml"),
            };
            l.Add(deger.ToString("0.##", CultureInfo.InvariantCulture) + birim);
        }
        return l;
    }

    private static readonly Regex ArtiDeseni = new(@"(\d+)\s*\+\s*(\d+)", RegexOptions.Compiled);

    /// <summary>
    /// Ad parçaları (12.10.2026): Türkçe harfler katlanmış, miktarlar ("1 lt",
    /// "500 gr") ayrı tutulduğu için atılmış, "2+1" → 2 arti 1, sayı ile
    /// harf ayrılmış ("16lı" → 16 lı), bağlaçlar atılmış. Tek harfler kalıyor:
    /// Mikro'daki kısaltmalar ("D.FIRCA" → d firca) onlarla eşleşiyor.
    /// </summary>
    public static List<string> Jetonlar(string ad)
    {
        var t = ArtiDeseni.Replace((ad ?? "").ToLower(Tr), "$1 arti $2");
        t = Anahtar(t);
        t = Regex.Replace(t, @"(\d)([a-z])", "$1 $2");
        t = Regex.Replace(t, @"([a-z])(\d)", "$1 $2");
        t = MiktarDeseni.Replace(t, " ");
        return t.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(k => !Durak.Contains(k))
            .ToList();
    }

    /// <summary>İki parçanın uyumu 0–1: aynı, kısaltma ya da ek farkı</summary>
    private static double ParcaUyumu(string a, string b)
    {
        if (a == b) return 1;

        var sayiA = a.All(char.IsDigit);
        var sayiB = b.All(char.IsDigit);
        if (sayiA || sayiB) return 0;

        var (kisa, uzun) = a.Length <= b.Length ? (a, b) : (b, a);
        if (!uzun.StartsWith(kisa, StringComparison.Ordinal)) return 0;

        /* Türkçe ek: "fircasi" ~ "firca", "cikolatali" ~ "cikolata" */
        if (kisa.Length >= 4) return 0.95;

        /* Kısaltma: "d" ~ "dis", "cik" ~ "cikolata" */
        if (uzun.Length >= kisa.Length + 2) return 0.85;

        return 0;
    }

    /// <summary>
    /// Ad benzerliği 0–1 (12.10.2026).
    ///
    /// <para>
    /// Parçalar en iyi eşine bağlanıyor (aynı 1, Türkçe ek 0,95, kısaltma
    /// 0,85) ve Dice katsayısı alınıyor: iki taraftaki fazla parçalar puanı
    /// düşürüyor ("Şekersiz", "Vanilyalı" gibi çeşit farkları). Miktarlar
    /// ayrı karşılaştırılıyor: ikisinde de varsa ve tutmuyorsa puan
    /// kırılıyor; yalnızca birinde varsa otomatik eşleşme eşiğinin altına
    /// iniyor.
    /// </para>
    /// <para>
    /// Örnek: "Colgate Gentle Clean Diş Fırçası 2+1" ile
    /// "COLGATE D.FIRCA 2+1 GENTLE CLEAN" %97,5.
    /// </para>
    /// </summary>
    public static double Benzerlik(string web, string bizim)
    {
        var a = Jetonlar(web);
        var b = Jetonlar(bizim);
        if (a.Count == 0 || b.Count == 0) return 0;

        var kalan = new List<string>(b);
        double toplam = 0;

        foreach (var k in a.OrderByDescending(x => x.Length))
        {
            var enIyi = 0.0;
            var enIyiI = -1;
            for (var i = 0; i < kalan.Count; i++)
            {
                var u = ParcaUyumu(k, kalan[i]);
                if (u > enIyi) { enIyi = u; enIyiI = i; }
                if (u >= 1) break;
            }
            if (enIyiI >= 0)
            {
                toplam += enIyi;
                kalan.RemoveAt(enIyiI);
            }
        }

        var puan = 2 * toplam / (a.Count + b.Count);

        var ma = Miktarlar(web);
        var mb = Miktarlar(bizim);
        if (ma.Count > 0 && mb.Count > 0) puan *= ma.Overlaps(mb) ? 1 : 0.6;
        else if (ma.Count > 0 || mb.Count > 0) puan *= 0.94;

        return Math.Clamp(puan, 0, 1);
    }

    /* ==================================================================== */
    /* Excel                                                                */
    /* ==================================================================== */

    public sealed class WebSatir
    {
        public string Firma { get; set; }
        public string UrunAdi { get; set; }
        public decimal Fiyat { get; set; }
        public decimal? EskiFiyat { get; set; }
        public string Link { get; set; }
        public string Sayfa { get; set; }
        public DateTime Okunma { get; set; }
    }

    /// <summary>
    /// Aracın Excel'ini okur ("Ürünler" sayfası, başlıklara göre). Kütüphane
    /// kullanılmıyor: xlsx bir zip içindeki XML'ler.
    /// </summary>
    public static (List<WebSatir> Satirlar, string Hata) ExcelOku(Stream akis)
    {
        try
        {
            using var zip = new ZipArchive(akis, ZipArchiveMode.Read);

            XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
            XNamespace rns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            XNamespace pns = "http://schemas.openxmlformats.org/package/2006/relationships";

            XDocument Oku(string ad)
            {
                var g = zip.GetEntry(ad);
                if (g is null) return null;
                using var s = g.Open();
                return XDocument.Load(s);
            }

            var kitap = Oku("xl/workbook.xml");
            if (kitap is null) return (null, "Excel dosyası okunamadı.");

            var sayfalar = kitap.Descendants(ns + "sheet").ToList();
            var sayfa = sayfalar.FirstOrDefault(x => string.Equals((string)x.Attribute("name"), "Ürünler", StringComparison.OrdinalIgnoreCase))
                        ?? sayfalar.FirstOrDefault();
            if (sayfa is null) return (null, "Excel'de sayfa yok.");

            var rid = (string)sayfa.Attribute(rns + "id");
            var iliski = Oku("xl/_rels/workbook.xml.rels");
            var hedef = iliski?.Descendants(pns + "Relationship").FirstOrDefault(x => (string)x.Attribute("Id") == rid)?.Attribute("Target")?.Value
                        ?? "worksheets/sheet1.xml";
            hedef = hedef.TrimStart('/');
            if (!hedef.StartsWith("xl/")) hedef = "xl/" + hedef;

            var paylasilan = Oku("xl/sharedStrings.xml")?.Root?.Elements(ns + "si")
                .Select(si => string.Concat(si.Descendants(ns + "t").Select(t => t.Value)))
                .ToList() ?? new List<string>();

            var sayfaXml = Oku(hedef);
            if (sayfaXml is null) return (null, "Excel sayfası okunamadı.");

            static int Sutun(string r)
            {
                var n = 0;
                foreach (var c in r)
                {
                    if (!char.IsLetter(c)) break;
                    n = n * 26 + (char.ToUpperInvariant(c) - 'A' + 1);
                }
                return n - 1;
            }

            var satirlar = new List<Dictionary<int, string>>();
            foreach (var row in sayfaXml.Descendants(ns + "row"))
            {
                var d = new Dictionary<int, string>();
                var sira = 0;
                foreach (var c in row.Elements(ns + "c"))
                {
                    var r = (string)c.Attribute("r");
                    var i = r is null ? sira : Sutun(r);
                    sira = i + 1;
                    var t = (string)c.Attribute("t");
                    var v = c.Element(ns + "v")?.Value;
                    d[i] = t switch
                    {
                        "s" => int.TryParse(v, out var si) && si < paylasilan.Count ? paylasilan[si] : "",
                        "inlineStr" => string.Concat(c.Descendants(ns + "t").Select(x => x.Value)),
                        _ => v ?? "",
                    };
                }
                satirlar.Add(d);
            }

            if (satirlar.Count < 2) return (new List<WebSatir>(), null);

            var baslik = satirlar[0].ToDictionary(x => Anahtar(x.Value), x => x.Key);
            int? Kol(params string[] adlar) => adlar.Select(Anahtar).Where(baslik.ContainsKey).Select(a => (int?)baslik[a]).FirstOrDefault();

            var kFirma = Kol("Firma", "Site");
            var kAd = Kol("Ürün adı", "Urun", "Ürün");
            var kFiyat = Kol("Satış fiyatı", "Fiyat");
            var kEski = Kol("Eski fiyat");
            var kLink = Kol("Ürün linki", "Link");
            var kSayfa = Kol("Sayfa");
            var kOkunma = Kol("Okunma", "Tarih");

            if (kAd is null || kFiyat is null)
                return (null, "Excel'de 'Ürün adı' ve 'Satış fiyatı' sütunları bulunamadı. rakip-web-fiyat aracının ürettiği dosyayı yükleyin.");

            static decimal? Sayi(string s)
            {
                if (string.IsNullOrWhiteSpace(s)) return null;
                s = s.Trim();
                if (decimal.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)) return v;
                return decimal.TryParse(s.Replace("₺", "").Replace("TL", ""), NumberStyles.Number, Tr, out v) ? v : null;
            }

            string Al(Dictionary<int, string> d, int? k) => k is null ? null : d.GetValueOrDefault(k.Value)?.Trim();

            var sonuc = new List<WebSatir>();
            foreach (var d in satirlar.Skip(1))
            {
                var ad = Al(d, kAd);
                var fiyat = Sayi(Al(d, kFiyat));
                if (string.IsNullOrWhiteSpace(ad) || fiyat is not > 0) continue;

                var okunmaMetni = Al(d, kOkunma);
                DateTime okunma;
                if (!DateTime.TryParseExact(okunmaMetni ?? "", new[] { "dd.MM.yyyy HH:mm", "dd.MM.yyyy", "yyyy-MM-dd HH:mm" }, Tr, DateTimeStyles.None, out okunma))
                    okunma = double.TryParse(okunmaMetni, NumberStyles.Float, CultureInfo.InvariantCulture, out var oa) && oa > 30000
                        ? DateTime.FromOADate(oa)
                        : DateTime.Now;

                sonuc.Add(new WebSatir
                {
                    Firma = Kirp(Al(d, kFirma) ?? "Web", 120),
                    UrunAdi = Kirp(ad, 400),
                    Fiyat = fiyat.Value,
                    EskiFiyat = Sayi(Al(d, kEski)),
                    Link = Kirp(Al(d, kLink), 1000),
                    Sayfa = Kirp(Al(d, kSayfa), 1000),
                    Okunma = okunma,
                });
            }

            return (sonuc, null);
        }
        catch (InvalidDataException)
        {
            return (null, "Dosya bir Excel (.xlsx) dosyası değil.");
        }
    }

    private static string Kirp(string s, int n) => s is null ? null : s.Length > n ? s[..n] : s;

    public static string Ozet(byte[] veri) => Convert.ToHexString(SHA256.HashData(veri));

    /* ==================================================================== */
    /* Mikro: stok, fiyat                                                   */
    /* ==================================================================== */

    public sealed class Stok
    {
        public string StokKodu { get; set; }
        public string Ad { get; set; }
        /// <summary>Geçerli satış fiyatı: BiCard 0'dan büyükse BiCard, değilse raf.</summary>
        public decimal? Fiyat { get; set; }
        public decimal? RafFiyat { get; set; }
        public decimal? BicardFiyat { get; set; }
        public string FiyatTuru => SatisFiyati.Tur(RafFiyat, BicardFiyat);
        public string Barkod { get; set; }
        public double Puan { get; set; }
    }

    private int FiyatListesi => int.TryParse(_yapilandirma["RakipFiyat:FiyatListesi"], out var l) ? l : SatisFiyati.RafListesi;

    /// <summary>Stokların satış fiyatı, adı ve ilk barkodu (toplu)</summary>
    public Dictionary<string, Stok> StokBilgisi(IEnumerable<string> kodlar)
    {
        var liste = kodlar.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToList();
        var sonuc = new Dictionary<string, Stok>(StringComparer.OrdinalIgnoreCase);
        if (liste.Count == 0) return sonuc;

        using var db = _vt.MikroBaglantisi();

        foreach (var parca in liste.Chunk(800))
        {
            foreach (var r in db.Query($@"
SELECT LTRIM(RTRIM(S.sto_kod)) AS kod, S.sto_isim AS ad,
       {SatisFiyati.AltSorgu("S.sto_kod", FiyatListesi)} AS raf,
       {SatisFiyati.AltSorgu("S.sto_kod", SatisFiyati.BicardListesi)} AS bicard,
       (SELECT TOP 1 LTRIM(RTRIM(B.bar_kodu)) FROM BARKOD_TANIMLARI B WHERE B.bar_stokkodu = S.sto_kod) AS barkod
FROM STOKLAR S
WHERE S.sto_kod IN @parca", new { parca }, commandTimeout: 60))
            {
                decimal? raf = SatisFiyati.Sayi((object)r.raf), bicard = SatisFiyati.Sayi((object)r.bicard);

                sonuc[(string)r.kod] = new Stok
                {
                    StokKodu = r.kod, Ad = r.ad, Barkod = r.barkod,
                    RafFiyat = raf, BicardFiyat = bicard, Fiyat = SatisFiyati.Etkin(raf, bicard),
                };
            }
        }

        return sonuc;
    }

    /// <summary>Elle arama: ad parçaları, stok kodu ya da barkod</summary>
    /// <summary>
    /// Türkçe harfleri ASCII'ye katlar (büyük harf): ad karşılaştırması
    /// Mikro'daki yazımdan bağımsız olsun ("SÜTÜ" = "SUTU").
    /// </summary>
    private static string Katla(string t) => new string((t ?? "").ToUpper(Tr).Select(c => c switch
    {
        'Ç' => 'C', 'Ğ' => 'G', 'İ' => 'I', 'I' => 'I', 'Ö' => 'O', 'Ş' => 'S', 'Ü' => 'U',
        'Â' => 'A', 'Î' => 'I', 'Û' => 'U',
        _ => c
    }).ToArray());

    /// <summary>
    /// Ad koşulu: veritabanı harmanlaması (Turkish_CI_AS) aksana duyarlı;
    /// "SÜT" araması "SUT" yazılmış kartı bulmuyordu. Ad ı/İ düzeltilip
    /// aksansız harmanlamayla da karşılaştırılıyor (11.10.2026).
    /// </summary>
    private static string AdKosulu(string param) =>
        $"(S.sto_isim LIKE @{param} OR REPLACE(REPLACE(S.sto_isim, N'ı', N'i'), N'İ', N'I') COLLATE Latin1_General_CI_AI LIKE @{param}a COLLATE Latin1_General_CI_AI)";

    public List<Stok> StokAra(string q)
    {
        q = (q ?? "").Trim();
        if (q.Length < 2) return new List<Stok>();

        using var db = _vt.MikroBaglantisi();

        var kelimeler = Regex.Split(q.ToUpper(Tr), @"\s+").Where(x => x.Length > 0).Take(5).ToList();
        var p = new DynamicParameters();
        var kosul = new List<string>();
        for (var i = 0; i < kelimeler.Count; i++)
        {
            kosul.Add(AdKosulu($"k{i}"));
            p.Add($"k{i}", $"%{kelimeler[i]}%");
            p.Add($"k{i}a", $"%{Katla(kelimeler[i])}%");
        }
        p.Add("q", q);

        /* Barkod: birebir, ya da baştaki sıfırlar farklı yazılmışsa (EAN-13 /
           UPC) sıfırsız haliyle */
        var sifirsiz = q.All(char.IsDigit) ? q.TrimStart('0') : q;
        p.Add("q0", sifirsiz.Length == 0 ? q : sifirsiz);

        var kodlar = db.Query<string>($@"
SELECT TOP 40 LTRIM(RTRIM(S.sto_kod)) FROM STOKLAR S
WHERE ({string.Join(" AND ", kosul)})
   OR LTRIM(RTRIM(S.sto_kod)) = @q
   OR S.sto_kod IN (SELECT B.bar_stokkodu FROM BARKOD_TANIMLARI B
                    WHERE LTRIM(RTRIM(B.bar_kodu)) = @q
                       OR (ISNUMERIC(LTRIM(RTRIM(B.bar_kodu))) = 1
                           AND SUBSTRING(LTRIM(RTRIM(B.bar_kodu)), PATINDEX('%[^0]%', LTRIM(RTRIM(B.bar_kodu)) + 'x'), 50) = @q0))
ORDER BY S.sto_isim", p, commandTimeout: 60).ToList();

        var bilgi = StokBilgisi(kodlar);
        return kodlar.Where(bilgi.ContainsKey).Select(k => bilgi[k]).ToList();
    }

    /// <summary>
    /// Web ürün adına en çok benzeyen stok kartları (kod, ad, puan); fiyat
    /// okunmuyor. Otomatik eşleştirme bunu ürün başına bir sorguyla kullanıyor.
    /// </summary>
    public List<(string Kod, string Ad, double Puan)> Adaylar(IDbConnection mikro, string webAd, int adet = 8)
    {
        /* Arama kelimeleri asıl yazımla (Türkçe büyük harf): veritabanındaki
           ad aksanlı ("SÜT"); katlanmış biçim ayrıca deneniyor. */
        var kelimeler = Regex.Split(MiktarDeseni.Replace(webAd ?? "", " ").ToUpper(Tr), @"[^\p{L}\p{N}]+")
            .Where(k => k.Length >= 3 && !k.All(char.IsDigit) && !Durak.Contains(Anahtar(k)))
            .Distinct()
            .OrderByDescending(k => k.Length)
            .Take(4)
            .ToList();

        if (kelimeler.Count == 0) return new();

        var p = new DynamicParameters();
        var kosul = new List<string>();
        for (var i = 0; i < kelimeler.Count; i++)
        {
            kosul.Add(AdKosulu($"k{i}"));
            p.Add($"k{i}", $"%{kelimeler[i]}%");
            p.Add($"k{i}a", $"%{Katla(kelimeler[i])}%");
        }

        /* En çok kelimesi tutan adaylar önce: "SÜT" gibi yaygın bir kelime
           yüzlerce kart getiriyor ve sırasız ilk 400'de doğru ürün
           kalmayabiliyordu. */
        var puan = string.Join(" + ", kosul.Select(k => $"CASE WHEN {k} THEN 1 ELSE 0 END"));

        var adaylar = mikro.Query<(string Kod, string Ad)>($@"
SELECT TOP 400 LTRIM(RTRIM(S.sto_kod)) AS Kod, S.sto_isim AS Ad FROM STOKLAR S
WHERE {string.Join(" OR ", kosul)}
ORDER BY {puan} DESC, S.sto_isim", p, commandTimeout: 60).ToList();

        return adaylar
            .Select(x => (x.Kod, x.Ad, Puan: Benzerlik(webAd, x.Ad)))
            .Where(x => x.Puan > 0.15)
            .OrderByDescending(x => x.Puan)
            .Take(adet)
            .ToList();
    }

    /// <summary>Web ürün adına en çok benzeyen stoklar (fiyatlarıyla)</summary>
    public List<Stok> Oneriler(string webAd, int adet = 8)
    {
        /* Önce bellekteki dizin (hızlı); boş kalırsa Mikro'da arama */
        var secilen = DizindenAdaylar(webAd, adet);
        if (secilen.Count == 0)
            using (var db = _vt.MikroBaglantisi())
                secilen = Adaylar(db, webAd, adet);

        if (secilen.Count == 0) return new List<Stok>();

        var bilgi = StokBilgisi(secilen.Select(x => x.Kod));
        return secilen.Where(x => bilgi.ContainsKey(x.Kod)).Select(x =>
        {
            var s = bilgi[x.Kod];
            s.Puan = Math.Round(x.Puan, 3);
            return s;
        }).ToList();
    }

    /// <summary>
    /// Benzerlikle otomatik eşleştirme (12.10.2026).
    ///
    /// <para>
    /// Eşleşmesi olmayan her web ürünü için en iyi aday %95 ve üstü tutuyorsa
    /// ve ikinci aday en az 3 puan gerideyse (aynı ölçüde iki benzer kart
    /// varsa karar kişiye kalsın) eşleşme "otomatik" olarak açılıyor. Kişinin
    /// kaldırdığı ya da değiştirdiği otomatik eşleşme ret listesine yazılıyor;
    /// o kart o web ürününe bir daha otomatik bağlanmıyor.
    /// </para>
    /// </summary>
    public (int Eslesen, int Bakilan) BenzerlikleEslestir(IDbConnection db, int? yuklemeId = null, int sinir = 600, double esik = 0.95,
                                                          OtoDurum durum = null, string eslestiren = "otomatik")
    {
        /* Neden eşleşmediğinin dökümü durum nesnesine yazılıyor (12.10.2026) */
        void Say(Action<OtoDurum> f)
        {
            if (durum is null) return;
            lock (_otoKilit) f(durum);
        }
        var bekleyen = db.Query(@"
SELECT TOP (@sinir) W.site_anahtar AS siteAnahtar, W.ad_anahtar AS adAnahtar,
       MAX(W.urun_adi) AS ad, MAX(W.link_anahtar) AS link
FROM B360_RAKIP_WEB W
WHERE W.eslesme_id IS NULL
  AND (@yuklemeId IS NULL OR W.yukleme_id = @yuklemeId)
  AND NOT EXISTS (SELECT 1 FROM B360_RAKIP_WEB_ESLESME E
                  WHERE E.site_anahtar = W.site_anahtar AND E.ad_anahtar = W.ad_anahtar)
GROUP BY W.site_anahtar, W.ad_anahtar
ORDER BY MAX(W.okunma) DESC", new { yuklemeId, sinir }).ToList();

        Say(d => d.Toplam = bekleyen.Count);
        if (bekleyen.Count == 0) return (0, 0);

        var retler = db.Query<(string Site, string Ad, string Kod)>(
            "SELECT site_anahtar, ad_anahtar, stok_kodu FROM B360_RAKIP_WEB_RED")
            .Select(x => $"{x.Site}|{x.Ad}|{x.Kod}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var eslesen = 0;
        var bakilan = 0;

        foreach (var w in bekleyen)
        {
            string site = w.siteAnahtar, ad = w.adAnahtar, webAd = w.ad;
            var b = ++bakilan;
            Say(d => d.Bakilan = b);

            List<(string Kod, string Ad, double Puan)> l;
            try
            {
                /* Bellekteki stok dizininden: ürün başına Mikro sorgusu
                   190 üründe 2 dakikayı aşıp isteği düşürüyordu (502). */
                l = DizindenAdaylar(webAd, 3)
                    .Where(x => !retler.Contains($"{site}|{ad}|{x.Kod}"))
                    .ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Otomatik eşleştirme: aday okunamadı ({Ad})", webAd);
                Say(d => { d.HataSayisi++; d.IlkHata ??= hata.Message; });
                continue;
            }

            if (l.Count == 0)
            {
                Say(d => d.Adaysiz++);
                continue;
            }

            if (l[0].Puan < esik)
            {
                var p0 = l[0].Puan;
                Say(d => { d.EsikAlti++; d.EnYuksekAlti = Math.Max(d.EnYuksekAlti, Math.Round(p0 * 100, 1)); });
                continue;
            }

            /* İkinci aday da çok yakınsa karar kişiye kalıyor. Aynı adlı iki
               kart (Mikro'da çift açılmış) belirsizlik sayılmıyor. */
            if (l.Count > 1 && l[0].Puan - l[1].Puan < 0.03 && Anahtar(l[0].Ad) != Anahtar(l[1].Ad))
            {
                Say(d => d.Belirsiz++);
                continue;
            }

            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM B360_RAKIP_WEB_ESLESME WHERE site_anahtar = @site AND ad_anahtar = @ad)
INSERT INTO B360_RAKIP_WEB_ESLESME
    (site_anahtar, ad_anahtar, link_anahtar, web_ad, stok_kodu, urun_adi, yok, eslestiren, otomatik, puan)
VALUES (@site, @ad, @link, @webAd, @kod, @urun, 0, @eslestiren, 1, @puan)",
                new
                {
                    site,
                    ad,
                    link = (string)w.link,
                    webAd = Kirp(webAd, 400),
                    kod = l[0].Kod,
                    urun = Kirp(l[0].Ad, 200),
                    puan = Math.Round((decimal)l[0].Puan * 100, 1),
                    eslestiren = Kirp(eslestiren, 100),
                });
            eslesen++;
            var e = eslesen;
            Say(d => d.Eslesen = e);
        }

        if (eslesen > 0) OtomatikEslestir(db, yuklemeId);

        return (eslesen, bekleyen.Count);
    }

    /* ==================================================================== */
    /* Bellekteki stok dizini (12.10.2026)                                  */
    /* ==================================================================== */

    private sealed class StokDizini
    {
        public List<(string Kod, string Ad)> Kartlar = new();
        public Dictionary<string, List<int>> Ters = new(StringComparer.Ordinal);
        public DateTime Zaman;
    }

    private volatile StokDizini _dizin;
    private readonly object _dizinKilit = new();

    /// <summary>
    /// Aktif stok kartlarının adları ve parça → kart dizini; 30 dakika
    /// saklanıyor. Tek sorguyla okunuyor: eşleştirme ve öneriler her ürün
    /// için Mikro'ya gitmiyor.
    /// </summary>
    private StokDizini Dizin()
    {
        var d = _dizin;
        if (d is not null && DateTime.Now - d.Zaman < TimeSpan.FromMinutes(30)) return d;

        lock (_dizinKilit)
        {
            d = _dizin;
            if (d is not null && DateTime.Now - d.Zaman < TimeSpan.FromMinutes(30)) return d;

            var yeni = new StokDizini { Zaman = DateTime.Now };

            using (var mikro = _vt.MikroBaglantisi())
                yeni.Kartlar = mikro.Query<(string Kod, string Ad)>(@"
SELECT LTRIM(RTRIM(sto_kod)) AS Kod, sto_isim AS Ad
FROM STOKLAR WITH (NOLOCK)
WHERE ISNULL(sto_pasif_fl, 0) = 0 AND sto_isim IS NOT NULL", commandTimeout: 180).ToList();

            for (var i = 0; i < yeni.Kartlar.Count; i++)
                foreach (var t in Jetonlar(yeni.Kartlar[i].Ad).Where(t => t.Length >= 3 && !t.All(char.IsDigit)).Distinct())
                {
                    if (!yeni.Ters.TryGetValue(t, out var l)) yeni.Ters[t] = l = new List<int>();
                    l.Add(i);
                }

            _kayit.LogInformation("Rakip web: stok dizini hazır ({Adet} kart, {Parca} parça)", yeni.Kartlar.Count, yeni.Ters.Count);
            _dizin = yeni;
            return yeni;
        }
    }

    /// <summary>Dizinden en benzer kartlar: ortak parçası en çok olan 300 aday puanlanıyor.</summary>
    public List<(string Kod, string Ad, double Puan)> DizindenAdaylar(string webAd, int adet = 8)
    {
        var d = Dizin();
        var sayac = new Dictionary<int, int>();

        foreach (var t in Jetonlar(webAd).Where(t => t.Length >= 3 && !t.All(char.IsDigit)).Distinct())
        {
            if (!d.Ters.TryGetValue(t, out var l)) continue;
            foreach (var i in l) sayac[i] = sayac.TryGetValue(i, out var n) ? n + 1 : 1;
        }

        return sayac
            .OrderByDescending(x => x.Value)
            .Take(300)
            .Select(x => (d.Kartlar[x.Key].Kod, d.Kartlar[x.Key].Ad, Puan: Benzerlik(webAd, d.Kartlar[x.Key].Ad)))
            .Where(x => x.Puan > 0.15)
            .OrderByDescending(x => x.Puan)
            .Take(adet)
            .ToList();
    }

    /* ==================================================================== */
    /* Arka planda otomatik eşleştirme                                      */
    /* ==================================================================== */

    public sealed class OtoDurum
    {
        public bool Calisiyor { get; set; }
        public int Toplam { get; set; }
        public int Bakilan { get; set; }
        public int Eslesen { get; set; }
        public int Kayit { get; set; }
        public DateTime? Basladi { get; set; }
        public DateTime? Bitti { get; set; }
        public string Hata { get; set; }
        public double Esik { get; set; }
        public int Adaysiz { get; set; }
        public int EsikAlti { get; set; }
        public double EnYuksekAlti { get; set; }
        public int Belirsiz { get; set; }
        public int HataSayisi { get; set; }
        public string IlkHata { get; set; }
    }

    private OtoDurum _oto = new();
    private readonly object _otoKilit = new();

    public OtoDurum OtoDurumu()
    {
        lock (_otoKilit)
            return new OtoDurum
            {
                Calisiyor = _oto.Calisiyor, Toplam = _oto.Toplam, Bakilan = _oto.Bakilan, Eslesen = _oto.Eslesen,
                Kayit = _oto.Kayit, Basladi = _oto.Basladi, Bitti = _oto.Bitti, Hata = _oto.Hata,
                Esik = _oto.Esik, Adaysiz = _oto.Adaysiz, EsikAlti = _oto.EsikAlti, EnYuksekAlti = _oto.EnYuksekAlti,
                Belirsiz = _oto.Belirsiz, HataSayisi = _oto.HataSayisi, IlkHata = _oto.IlkHata,
            };
    }

    /// <summary>
    /// Benzerlik eşleştirmesini arka planda başlatır; zaten çalışıyorsa
    /// false. İstek beklemiyor: IIS bir isteği en çok 2 dakika bekliyor ve
    /// uzun süren eşleştirme 502 ile kesiliyordu.
    /// </summary>
    public bool OtoBaslat(int? yuklemeId = null, double esik = 0.95, string eslestiren = "otomatik")
    {
        esik = Math.Clamp(esik, 0.7, 1);
        OtoDurum durum;
        lock (_otoKilit)
        {
            if (_oto.Calisiyor) return false;
            _oto = durum = new OtoDurum { Calisiyor = true, Basladi = DateTime.Now, Esik = Math.Round(esik * 100) };
        }

        Task.Run(() =>
        {
            try
            {
                using var db = _vt.Baglanti();
                db.Open();

                var (eslesen, _) = BenzerlikleEslestir(db, yuklemeId, sinir: 5000, esik: esik, durum: durum, eslestiren: eslestiren);

                var kayit = eslesen > 0 ? KayitlariUret(db) : 0;

                lock (_otoKilit)
                {
                    _oto.Eslesen = eslesen;
                    _oto.Kayit = kayit;
                }
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Otomatik eşleştirme yarıda kaldı");
                lock (_otoKilit) _oto.Hata = hata.Message;
            }
            finally
            {
                lock (_otoKilit)
                {
                    _oto.Calisiyor = false;
                    _oto.Bitti = DateTime.Now;
                }
            }
        });

        return true;
    }

    /* ==================================================================== */
    /* Rakip kaydı                                                          */
    /* ==================================================================== */

    /// <summary>Web sitesinin rakip firma kaydı; yoksa (pasif olarak) açılır</summary>
    public int FirmaBul(IDbConnection db, string site)
    {
        var anahtar = Anahtar(site);
        var firmalar = db.Query<(int Id, string Ad)>("SELECT id, ad FROM B360_RAKIP_FIRMA").ToList();

        var f = firmalar.FirstOrDefault(x => Anahtar(x.Ad) == anahtar);
        if (f.Id == 0)
            f = firmalar.FirstOrDefault(x => Anahtar(x.Ad).Length >= 3 && (anahtar.Contains(Anahtar(x.Ad)) || Anahtar(x.Ad).Contains(anahtar)));

        if (f.Id > 0) return f.Id;

        /* Mobil okutma listesinde görünmesin diye pasif: yalnızca web'den gelen firma */
        return db.ExecuteScalar<int>(@"
INSERT INTO B360_RAKIP_FIRMA (ad, aktif, sira) OUTPUT INSERTED.id VALUES (@ad, 0, 900)",
            new { ad = Kirp(site, 120) });
    }

    /// <summary>
    /// Eşleşmiş ama henüz rakip kaydı olmayan web satırlarını rakip fiyat
    /// kaydına çevirir.
    /// </summary>
    public int KayitlariUret(IDbConnection db, int? eslesmeId = null, int? yuklemeId = null)
    {
        var satirlar = db.Query(@"
SELECT W.id, W.site, W.urun_adi AS urunAdi, W.fiyat, W.eski_fiyat AS eskiFiyat, W.link, W.okunma, W.eslesme_id AS eslesmeId,
       E.stok_kodu AS stokKodu, U.yukleyen
FROM B360_RAKIP_WEB W
    JOIN B360_RAKIP_WEB_ESLESME E ON E.id = W.eslesme_id
    LEFT JOIN B360_RAKIP_WEB_YUKLEME U ON U.id = W.yukleme_id
WHERE W.rakip_fiyat_id IS NULL AND E.yok = 0 AND E.stok_kodu IS NOT NULL
  AND (@eslesmeId IS NULL OR W.eslesme_id = @eslesmeId)
  AND (@yuklemeId IS NULL OR W.yukleme_id = @yuklemeId)", new { eslesmeId, yuklemeId }).ToList();

        if (satirlar.Count == 0) return 0;

        Dictionary<string, Stok> bilgi;
        try
        {
            bilgi = StokBilgisi(satirlar.Select(x => (string)x.stokKodu));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Web fiyat eşleşmesi için Mikro okunamadı");
            return 0;
        }

        var firmaOnbellek = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var adet = 0;

        foreach (var r in satirlar)
        {
            var site = (string)r.site;
            if (!firmaOnbellek.TryGetValue(site, out var firmaId))
                firmaOnbellek[site] = firmaId = FirmaBul(db, site);

            var stok = bilgi.GetValueOrDefault((string)r.stokKodu);
            decimal rakip = r.fiyat;

            /* Rakibin indirimsiz (üstü çizili) fiyatı; indirim yoksa satış fiyatı.
               Raporda bizim raf fiyatımızla karşılaştırılıyor. */
            decimal? rakipListe = r.eskiFiyat is decimal e && e > rakip ? e : rakip;
            decimal? bizim = stok?.Fiyat;
            decimal? fark = bizim is null ? null : bizim - rakip;
            decimal? yuzde = fark is null || rakip == 0 ? null : Math.Round(fark.Value / rakip * 100, 1);

            var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_RAKIP_FIYAT
    (firma_id, barkod, stok_kodu, urun_adi, rakip_fiyat, bizim_fiyat, fark, fark_yuzde,
     sube_kodu, personel_kodu, personel_adi, not_metni, olusturma, kaynak, web_link, web_eslesme_id,
     raf_fiyat, bicard_fiyat, fiyat_kurali, rakip_liste_fiyat)
OUTPUT INSERTED.id
VALUES (@firmaId, @barkod, @stokKodu, @urunAdi, @rakip, @bizim, @fark, @yuzde,
        NULL, @yukleyen, NULL, @webAd, @okunma, N'web', @link, @eslesmeId, @raf, @bicard, 1, @rakipListe)",
                new
                {
                    firmaId,
                    barkod = Kirp(stok?.Barkod ?? (string)r.stokKodu, 60),
                    stokKodu = (string)r.stokKodu,
                    urunAdi = Kirp(stok?.Ad, 200),
                    rakip,
                    bizim,
                    fark,
                    yuzde,
                    yukleyen = Kirp((string)r.yukleyen, 30),
                    webAd = $"Web: {r.urunAdi}",
                    okunma = (DateTime)r.okunma,
                    link = (string)r.link,
                    eslesmeId = (int)r.eslesmeId,
                    raf = stok?.RafFiyat,
                    bicard = stok?.BicardFiyat,
                    rakipListe,
                });

            db.Execute("UPDATE B360_RAKIP_WEB SET rakip_fiyat_id = @id WHERE id = @wid", new { id, wid = (int)r.id });
            adet++;
        }

        return adet;
    }

    /// <summary>Eşleşmesi olmayan web satırlarını kayıtlı eşleşmelerle bağlar</summary>
    public int OtomatikEslestir(IDbConnection db, int? yuklemeId = null)
    {
        /* Önce link, sonra ad: link ürünü daha kesin gösterir */
        var n = db.Execute(@"
UPDATE W SET eslesme_id = E.id
FROM B360_RAKIP_WEB W
    JOIN B360_RAKIP_WEB_ESLESME E ON E.site_anahtar = W.site_anahtar AND E.link_anahtar = W.link_anahtar
WHERE W.eslesme_id IS NULL AND W.link_anahtar IS NOT NULL
  AND (@yuklemeId IS NULL OR W.yukleme_id = @yuklemeId)", new { yuklemeId });

        n += db.Execute(@"
UPDATE W SET eslesme_id = E.id
FROM B360_RAKIP_WEB W
    JOIN B360_RAKIP_WEB_ESLESME E ON E.site_anahtar = W.site_anahtar AND E.ad_anahtar = W.ad_anahtar
WHERE W.eslesme_id IS NULL
  AND (@yuklemeId IS NULL OR W.yukleme_id = @yuklemeId)", new { yuklemeId });

        return n;
    }
}

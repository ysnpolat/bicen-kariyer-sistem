using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe uyum formlarının çözümlenmesi.
///
/// <para>
/// Formlar <c>cevaplar_json</c> içinde soru metniyle birlikte saklanır.
/// Rapor uçlarının hepsi aynı çözümlemeye ihtiyaç duyduğu için okuma,
/// puan çevrimi ve serbest metin sınıflandırması burada tek yerde durur.
/// </para>
///
/// <para>
/// Sorular sunucuda tanımlı değil, anket ekranında tanımlı. Bu yüzden
/// çözümleme soru metnine bakarak çalışır; metin ileride değişse bile
/// eski kayıtlar kendi metinleriyle okunur.
/// </para>
/// </summary>
public static class UyumAnaliz
{
    /* ==================================================================== */
    /* Temel yapılar                                                        */
    /* ==================================================================== */

    /// <summary>Tek bir sorunun yanıtı.</summary>
    public sealed class Yanit
    {
        public string Soru { get; set; } = "";

        /// <summary>olcek (1–5), on (0–10), secim, acik</summary>
        public string Tur { get; set; } = "olcek";

        /// <summary>Sayısal yanıt; ölçek ve 0–10 sorularında dolu.</summary>
        public double? Sayi { get; set; }

        /// <summary>Metin yanıtı; seçim ve açık uçlu sorularda dolu.</summary>
        public string Metin { get; set; }

        /// <summary>
        /// Seçime bağlı zorunlu açıklama. "İK'ya iletmek istediğiniz bir
        /// konu var mı?" sorusuna "Evet" denince yazılan metin burada
        /// durur; yanıtın kendisi "Evet" kalır ki sayımlar bozulmasın.
        /// </summary>
        public string Aciklama { get; set; }

        /// <summary>Yanıtın 5'lik tabana çevrilmiş hâli.</summary>
        public double? BesTaban =>
            Sayi is null ? null : Sayi.Value / (Tur == "on" ? 10.0 : 5.0) * 5.0;
    }

    /// <summary>
    /// Bir gönderimden çıkan tek değerlendirme.
    ///
    /// Çalışan formunda gönderim başına bir tane olur. Yönetici formunda
    /// bir gönderimde birden çok personel değerlendirildiği için birden
    /// çok tane çıkar.
    /// </summary>
    public sealed class Form
    {
        public string PersonelKodu { get; set; }
        public string AdSoyad { get; set; }
        public List<Yanit> Yanitlar { get; } = new();

        /// <summary>Ölçek sorularının 5'lik tabandaki ortalaması.</summary>
        public double? Ortalama
        {
            get
            {
                var p = Yanitlar
                    .Where(x => x.BesTaban is not null)
                    .Select(x => x.BesTaban.Value)
                    .ToList();

                return p.Count == 0 ? null : Math.Round(p.Average(), 2);
            }
        }
    }

    /* ==================================================================== */
    /* Gün sayımı                                                           */
    /* ==================================================================== */

    /// <summary>
    /// İşe girişten sonra geçen gün: Personel Listesi'ndeki "çalışma
    /// süresi" ile aynı sayım (giriş günü 0, ertesi gün 1).
    ///
    /// <para>
    /// İK "çalışma süresi 7 gün olana 7. gün anketi" dediği için sayım
    /// listedekiyle bire bir aynı olmalı; takip listesi, anket gönderimi,
    /// otomatik gönderim ve yönetici ekranı hep burayı kullanır.
    /// </para>
    /// </summary>
    public static int KacinciGun(DateTime girisTarihi) =>
        Math.Max(0, (int)(DateTime.Today - girisTarihi.Date).TotalDays);

    /* ==================================================================== */
    /* Okuma                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Bir <c>cevaplar_json</c> alanını okur.
    ///
    /// Çalışan formunda kök bir nesne, yönetici formunda kişi başına bir
    /// eleman içeren dizidir; ikisi de aynı biçimde döner. Bozuk kayıt
    /// boş liste döndürür, çağıran tarafı düşürmez.
    /// </summary>
    public static List<Form> Formlar(string cevaplarJson)
    {
        var sonuc = new List<Form>();

        if (string.IsNullOrWhiteSpace(cevaplarJson)) return sonuc;

        try
        {
            using var kok = JsonDocument.Parse(cevaplarJson);

            var elemanlar = kok.RootElement.ValueKind == JsonValueKind.Array
                ? kok.RootElement.EnumerateArray().ToList()
                : new List<System.Text.Json.JsonElement> { kok.RootElement };

            foreach (var el in elemanlar)
            {
                if (el.ValueKind != JsonValueKind.Object) continue;

                var form = new Form
                {
                    PersonelKodu = Metin(el, "personelKodu"),
                    AdSoyad = Metin(el, "adSoyad")
                };

                if (!el.TryGetProperty("sorular", out var dizi)
                    || dizi.ValueKind != JsonValueKind.Array)
                {
                    sonuc.Add(form);
                    continue;
                }

                foreach (var so in dizi.EnumerateArray())
                {
                    if (so.ValueKind != JsonValueKind.Object) continue;

                    var soru = Metin(so, "soru");

                    if (string.IsNullOrWhiteSpace(soru)) continue;

                    var yanit = new Yanit
                    {
                        Soru = soru,
                        Tur = Metin(so, "tur") ?? "olcek"
                    };

                    yanit.Aciklama = Metin(so, "aciklama");

                    if (so.TryGetProperty("yanit", out var ym))
                    {
                        if (ym.ValueKind == JsonValueKind.Number)
                            yanit.Sayi = ym.GetDouble();
                        else if (ym.ValueKind == JsonValueKind.String)
                            yanit.Metin = ym.GetString();
                    }

                    form.Yanitlar.Add(yanit);
                }

                sonuc.Add(form);
            }
        }
        catch
        {
            /* Bozuk JSON tek formu etkiler, raporu düşürmez */
        }

        return sonuc;
    }

    private static string Metin(JsonElement el, string ad)
    {
        if (!el.TryGetProperty(ad, out var d)) return null;

        return d.ValueKind switch
        {
            JsonValueKind.String => d.GetString(),
            /* Sicil sayı olarak gelmiş olabilir; metne çevrilir */
            JsonValueKind.Number => d.GetRawText(),
            _ => null
        };
    }

    /// <summary>
    /// Bir çalışanın rapor dönemindeki toplu görünümü.
    ///
    /// Aynı kişinin çalışan ve yönetici formları farklı satırlarda durduğu
    /// için önce kişide birleştirilir; ayrılma ilişkisi ve risk skoru
    /// ancak birleşmiş hâlde hesaplanabiliyor.
    /// </summary>
    public sealed class KisiOzeti
    {
        public string PersonelKodu { get; set; }
        public string AdSoyad { get; set; }
        public string SubeAdi { get; set; }
        public string Gorev { get; set; }

        /// <summary>En son doldurulan formun tarihi</summary>
        public DateTime? SonForm { get; set; }

        /// <summary>Aşama koduna göre çalışanın kendi puanı</summary>
        public Dictionary<string, double> CalisanPuan { get; } = new();

        /// <summary>Aşama koduna göre yöneticinin verdiği puan</summary>
        public Dictionary<string, double> YoneticiPuan { get; } = new();

        /// <summary>İK'ya iletilmek istenen bir konu bildirdi mi</summary>
        public bool IkBildirim { get; set; }

        /// <summary>Beklenti ile gerçeklik arasında fark bildirdi mi</summary>
        public bool BeklentiFarki { get; set; }
    }

    /// <summary>Bir konu alanının iki taraftaki toplamları.</summary>
    public sealed class AlanToplami
    {
        public double CalisanToplam { get; set; }
        public int CalisanAdet { get; set; }
        public double YoneticiToplam { get; set; }
        public int YoneticiAdet { get; set; }

        /// <summary>
        /// Alanı oluşturan sorular; anahtar "tur|soru". Alana tıklanınca
        /// hangi soruların o ortalamayı verdiği görünsün diye tutulur.
        /// </summary>
        public Dictionary<string, SoruToplami> Sorular { get; } = new();

        public void Ekle(string tur, string soru, double deger)
        {
            if (tur == "calisan") { CalisanToplam += deger; CalisanAdet++; }
            else { YoneticiToplam += deger; YoneticiAdet++; }

            var anahtar = tur + "|" + soru;

            if (!Sorular.TryGetValue(anahtar, out var st))
                Sorular[anahtar] = st = new SoruToplami { Tur = tur, Soru = soru };

            st.Toplam += deger;
            st.Adet++;
        }

        /// <summary>Soru kırılımı; düşükten yükseğe.</summary>
        public List<object> SoruListesi() => Sorular.Values
            .Where(x => x.Adet > 0)
            .OrderBy(x => x.Toplam / x.Adet)
            .Select(x => (object)new
            {
                tur = x.Tur,
                soru = x.Soru,
                ortalama = Math.Round(x.Toplam / x.Adet, 1),
                adet = x.Adet
            })
            .ToList();

        public double? CalisanOrt => CalisanAdet == 0
            ? null : Math.Round(CalisanToplam / CalisanAdet, 1);

        public double? YoneticiOrt => YoneticiAdet == 0
            ? null : Math.Round(YoneticiToplam / YoneticiAdet, 1);
    }

    /// <summary>Bir sorunun toplam ve adedi.</summary>
    public sealed class SoruToplami
    {
        public string Tur { get; set; }
        public string Soru { get; set; }
        public double Toplam { get; set; }
        public int Adet { get; set; }
    }

    /// <summary>
    /// Serbest metin yanıtı ve kimin verdiği. Konuya tıklanınca yanıtların
    /// kendisi okunabilsin diye kaynak da taşınır.
    /// </summary>
    public sealed class SerbestYanit
    {
        public string Metin { get; set; }
        public string AdSoyad { get; set; }
        public string SubeAdi { get; set; }
        public string AsamaAdi { get; set; }
        public string PersonelKodu { get; set; }
    }

    /* ==================================================================== */
    /* Metin sadeleştirme                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Karşılaştırma için metni sadeleştirir.
    ///
    /// Türkçe harfler karşılıklarına indirilir ve küçültülür; böylece
    /// "İletişim" ile "iletisim" aynı sayılır. Anahtar kelimeler de bu
    /// biçimde yazılıdır.
    /// </summary>
    public static string Sade(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return "";

        var kaynak = "ÇĞİIÖŞÜçğıiöşü";
        var karsilik = "cgiiosucgiiosu";

        var kutu = new System.Text.StringBuilder(metin.Length);

        foreach (var h in metin)
        {
            var yer = kaynak.IndexOf(h);

            kutu.Append(yer >= 0 ? karsilik[yer] : char.ToLowerInvariant(h));
        }

        return kutu.ToString();
    }

    /// <summary>Sadeleştirilmiş metinde kelimelerden biri geçiyor mu.</summary>
    private static bool Geciyor(string sade, string[] kelimeler) =>
        kelimeler.Any(k => sade.Contains(k, StringComparison.Ordinal));

    /* ==================================================================== */
    /* Ölçek sorularının alan kümeleri                                      */
    /* ==================================================================== */

    /// <summary>
    /// Ölçek sorularının konu alanları.
    ///
    /// <para>
    /// Çalışan ve yönetici formlarında soru metinleri farklı; ikisini yan
    /// yana koyabilmek için sorular ortak alanlara toplanır. Sıra
    /// önemlidir: bir soru ilk uyan alana yazılır, böylece aynı soru iki
    /// alanda birden sayılmaz.
    /// </para>
    /// </summary>
    private static readonly (string Ad, string[] Kelimeler)[] AlanKurallari =
    {
        ("Çalışma düzeni", new[]
        {
            "disiplin", "devam", "dakik", "kural", "ortam", "kosul", "mesai"
        }),
        ("İşe uyum", new[]
        {
            "uyum", "karsilanmis", "gorev ve sorumluluk", "net oldugunu",
            "gorevleri anlama"
        }),
        ("Bağlılık ve sorumluluk", new[]
        {
            "sorumluluk", "inisiyatif", "parcasi", "degerli", "deger verdigini",
            "uzun sure", "kariyer"
        }),
        ("İletişim", new[]
        {
            "iletisim", "yonetici", "ekip", "ekib", "musteri", "arkadas",
            "guveniyorum"
        }),
        ("İş bilgisi ve gelişim", new[]
        {
            "bilgi", "gelis", "ogren", "kalite", "verimli", "hedef", "tempo",
            "hiz", "problem", "uygulama", "is yapma"
        })
    };

    /// <summary>Alanların ekranda görünme sırası.</summary>
    public static readonly string[] AlanSirasi =
    {
        "İşe uyum", "İş bilgisi ve gelişim", "İletişim", "Çalışma düzeni",
        "Bağlılık ve sorumluluk"
    };

    /// <summary>Bir soru metninin alanı; uymuyorsa null.</summary>
    public static string Alan(string soru)
    {
        var sade = Sade(soru);

        foreach (var (ad, kelimeler) in AlanKurallari)
            if (Geciyor(sade, kelimeler)) return ad;

        return null;
    }

    /* ==================================================================== */
    /* Serbest metin konuları                                               */
    /* ==================================================================== */

    /// <summary>Çalışanın memnun olduğu konular.</summary>
    private static readonly (string Ad, string[] Kelimeler)[] MemnunKonulari =
    {
        ("Ekip arkadaşları", new[]
            { "ekip", "ekib", "arkadas", "takim", "kaynasma", "dayanisma" }),
        ("Yönetici yaklaşımı", new[]
            { "yonetici", "mudur", "amir", "sef", "usta" }),
        ("Mağaza ortamı", new[]
            { "ortam", "magaza", "temiz", "duzen", "huzur", "sicak", "samimi" }),
        ("İş güvencesi ve düzen", new[]
            { "guvence", "sigorta", "duzenli", "zamaninda", "maas", "odeme",
              "guvenli" }),
        ("Eğitim ve gelişim", new[]
            { "egitim", "ogren", "gelis", "kariyer", "firsat" }),
        ("Müşteri ilişkileri", new[]
            { "musteri", "satis", "kasa" }),
        ("Yan haklar", new[]
            { "yemek", "servis", "kiyafet", "izin", "prim" })
    };

    /// <summary>Çalışanın geliştirilmesini istediği konular.</summary>
    private static readonly (string Ad, string[] Kelimeler)[] IstekKonulari =
    {
        ("Çalışma saatleri", new[]
            { "saat", "mesai", "vardiya", "izin", "tatil", "gec cikis",
              "erken", "fazla mesai" }),
        ("Ücret ve yan haklar", new[]
            { "ucret", "maas", "prim", "zam", "yemek", "servis", "yan hak",
              "odeme" }),
        ("Yönetici iletişimi", new[]
            { "yonetici", "mudur", "amir", "sef", "iletisim", "uslup",
              "bagirma" }),
        ("İş yükü", new[]
            { "yogun", "yuk", "yorgun", "eksik personel", "personel sayisi",
              "kalabalik", "yetismiyor" }),
        ("Ekip içi ilişkiler", new[]
            { "ekip", "ekib", "arkadas", "takim", "dedikodu" }),
        ("Eğitim ve gelişim", new[]
            { "egitim", "ogren", "gelis", "kariyer", "terfi" }),
        ("Fiziksel koşullar", new[]
            { "soguk", "sicak", "depo", "dinlenme", "soyunma", "tuvalet",
              "klima", "isik" })
    };

    /// <summary>Yöneticinin işaretlediği gelişim alanları.</summary>
    private static readonly (string Ad, string[] Kelimeler)[] GelisimKonulari =
    {
        ("Ürün bilgisi", new[]
            { "urun", "reyon", "etiket", "fiyat", "bilgi", "manav", "kasap",
              "sarkuteri" }),
        ("Müşteri iletişimi", new[]
            { "musteri", "satis", "kasa", "guler yuz" }),
        ("İş disiplini", new[]
            { "disiplin", "devam", "gec kal", "dakik", "kural", "mesai",
              "izin" }),
        ("İş hızı ve verimlilik", new[]
            { "hiz", "tempo", "yavas", "verim", "cabuk" }),
        ("Ekip çalışması", new[]
            { "ekip", "ekib", "arkadas", "takim", "uyum" }),
        ("Sorumluluk ve inisiyatif", new[]
            { "sorumluluk", "inisiyatif", "ozguven", "cekingen",
              "girisken" }),
        ("Genel iletişim", new[]
            { "iletisim", "konusma", "uslup", "ifade" })
    };

    /// <summary>
    /// Serbest metni tek bir konuya yazar.
    ///
    /// Birden çok konuya uyan metinde en çok kelimesi geçen konu seçilir;
    /// böylece yüzdeler toplandığında yüzde yüzü aşmaz. Hiçbirine uymayan
    /// metin sayılmaz — zorlamayla yanlış konuya yazmaktansa dışarıda
    /// kalması doğru.
    /// </summary>
    private static string Konu(string metin, (string Ad, string[] Kelimeler)[] kume)
    {
        var sade = Sade(metin);

        if (sade.Trim().Length < 3) return null;

        string enIyi = null;
        var enCok = 0;

        foreach (var (ad, kelimeler) in kume)
        {
            var sayi = kelimeler.Count(k => sade.Contains(k, StringComparison.Ordinal));

            if (sayi > enCok)
            {
                enCok = sayi;
                enIyi = ad;
            }
        }

        return enIyi;
    }

    /// <summary>Konu dağılımı: her konunun adedi ve yüzdesi.</summary>
    public static List<object> KonuDagilimi(
        IEnumerable<SerbestYanit> yanitlar, string kumeAdi)
    {
        var kume = kumeAdi switch
        {
            "memnun" => MemnunKonulari,
            "istek" => IstekKonulari,
            _ => GelisimKonulari
        };

        var kutular = new Dictionary<string, List<SerbestYanit>>();
        var toplam = 0;

        foreach (var y in yanitlar)
        {
            var konu = Konu(y.Metin, kume);

            if (konu is null) continue;

            if (!kutular.TryGetValue(konu, out var liste))
                kutular[konu] = liste = new List<SerbestYanit>();

            liste.Add(y);
            toplam++;
        }

        if (toplam == 0) return new List<object>();

        return kutular
            .OrderByDescending(x => x.Value.Count)
            .Select(x => (object)new
            {
                konu = x.Key,
                adet = x.Value.Count,
                oran = (int)Math.Round(x.Value.Count * 100.0 / toplam),
                /* Yanıtların kendisi: konu adı tek başına 'çalışma saatleri'
                   diyor ama ne dendiğini ancak metin söylüyor. */
                ornekler = x.Value.Take(40).Select(o => new
                {
                    metin = o.Metin,
                    adSoyad = o.AdSoyad,
                    subeAdi = o.SubeAdi,
                    asamaAdi = o.AsamaAdi,
                    personelKodu = o.PersonelKodu
                }).ToList()
            })
            .ToList();
    }

    /* ==================================================================== */
    /* Soru türü tanıma                                                     */
    /* ==================================================================== */

    /// <summary>Çalışanın "en çok memnun eden" açık uçlu sorusu mu.</summary>
    public static bool MemnunSorusu(string soru)
    {
        var s = Sade(soru);

        return s.Contains("memnun eden") || s.Contains("devam etmenizi");
    }

    /// <summary>Çalışanın "değişsin" dediği açık uçlu soru mu.</summary>
    public static bool IstekSorusu(string soru)
    {
        var s = Sade(soru);

        return s.Contains("degistir") || s.Contains("iyilestir")
            || s.Contains("zorlandiginiz") || s.Contains("gelistirilmesini")
            || s.Contains("beklentiniz");
    }

    /// <summary>Yöneticinin gelişim alanı sorusu mu.</summary>
    public static bool GelisimSorusu(string soru)
    {
        var s = Sade(soru);

        return s.Contains("gelistirmesi") || s.Contains("gelisimi icin")
            || s.Contains("gelistirilmesi gereken");
    }

    /// <summary>Yöneticinin güçlü yön sorusu mu.</summary>
    public static bool GucluSorusu(string soru) => Sade(soru).Contains("guclu");

    /// <summary>İK'ya bildirim sorusu mu.</summary>
    public static bool IkBildirimSorusu(string soru)
    {
        var s = Sade(soru);

        return s.Contains("bilmesini istediginiz")
            || s.Contains("insan kaynaklari'nin ozellikle");
    }

    /// <summary>Beklenti ile gerçeklik farkı sorusu mu.</summary>
    public static bool BeklentiSorusu(string soru) =>
        Sade(soru).Contains("beklentileriniz ile");

    /// <summary>Tavsiye etme (eNPS) sorusu mu.</summary>
    public static bool TavsiyeSorusu(string soru) => Sade(soru).Contains("tavsiye");

    /// <summary>Yanıt olumlu bir "evet" mi.</summary>
    public static bool Evet(string yanit)
    {
        var s = Sade(yanit).Trim();

        return s == "evet" || s == "kesinlikle evet";
    }

    /* ==================================================================== */
    /* Puanlama                                                             */
    /* ==================================================================== */

    /// <summary>
    /// Erken ayrılma risk skoru (0–100).
    ///
    /// <para>
    /// Skor bir kestirim değil, önceliklendirme aracıdır: hangi çalışanla
    /// önce ilgilenileceğini söyler. Elde olan bileşenlerden hesaplanır ve
    /// bulunan ağırlıklara göre yüze normalize edilir; yönetici formu
    /// doldurulmamış bir kişi bu yüzden haksızca riskli görünmez.
    /// </para>
    ///
    /// <list type="bullet">
    /// <item>Son çalışan puanı düşükse — ağırlık 40</item>
    /// <item>Dönemler arasında düşüş varsa — ağırlık 25</item>
    /// <item>Son yönetici puanı düşükse — ağırlık 20</item>
    /// <item>İK'ya iletilmek istenen bir konu varsa — ağırlık 10</item>
    /// <item>Beklenti ile gerçeklik ayrışmışsa — ağırlık 5</item>
    /// </list>
    /// </summary>
    public static int? RiskSkoru(
        double? sonCalisan, double? dusus, double? sonYonetici,
        bool ikBildirim, bool beklentiFarki)
    {
        double toplam = 0;
        double agirlik = 0;

        if (sonCalisan is not null)
        {
            toplam += Math.Clamp((5 - sonCalisan.Value) / 4.0, 0, 1) * 40;
            agirlik += 40;
        }

        /* Düşüş yalnızca en az iki ölçüm varsa anlamlı. Tek ölçümü olan
           kişide bu bileşen hiç sayılmaz; sıfır sayılsaydı skoru olduğundan
           düşük görünürdü. */
        if (dusus is not null)
        {
            toplam += Math.Clamp(dusus.Value / 2.0, 0, 1) * 25;
            agirlik += 25;
        }

        if (sonYonetici is not null)
        {
            toplam += Math.Clamp((5 - sonYonetici.Value) / 4.0, 0, 1) * 20;
            agirlik += 20;
        }

        if (ikBildirim) { toplam += 10; agirlik += 10; }
        if (beklentiFarki) { toplam += 5; agirlik += 5; }

        if (agirlik <= 0) return null;

        return (int)Math.Round(toplam / agirlik * 100);
    }

    /// <summary>
    /// eNPS: tavsiye etme sorusunun 0–10 yanıtlarından.
    ///
    /// 9–10 verenlerin yüzdesinden 0–6 verenlerin yüzdesi çıkarılır.
    /// Sonuç −100 ile +100 arasındadır.
    /// </summary>
    public static int? Enps(List<double> puanlar)
    {
        if (puanlar.Count == 0) return null;

        var destekci = puanlar.Count(x => x >= 9);
        var koturum = puanlar.Count(x => x <= 6);

        return (int)Math.Round((destekci - koturum) * 100.0 / puanlar.Count);
    }
}

using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebinin onay zinciri (26.10.2026). 27.10.2026'dan beri kişi
/// adımları İK'nın "İZİN TALEP ONAY SÜRECİ" tablosundan
/// (<see cref="IzinZincirKurali"/>, KRY_IZIN_ZINCIR_KURAL), satırdaki
/// sırayla; aşağıdaki avans tablosu açıklaması bu tarihten önceki hâli.
///
/// <para>
/// İK'nın "AVANS TALEP ONAY SÜRECİ" tablosu (<see cref="AvansOnayZinciri"/>,
/// KRY_AVANS_ONAY_KURAL) iş yeri + pozisyon için sırayla onaylayanları
/// tutuyor: birim yöneticisi (mağaza / muhasebe / depo müdürü…), varsa
/// bölge müdürü, İnsan Kaynakları ve genel müdür yardımcısı. İzinde aynı
/// tablo kullanılıyor; tek fark sıralama: <b>kişi adımları tablodaki
/// sırayla, İnsan Kaynakları en sonda</b>. Avansta İK'dan sonra gelen GMY
/// adımı izinde İK'dan önce geliyor: birim yöneticisi imzalı formu yükleyip
/// onaylar → GMY formu görüp onaylar → İK son kararı verir ve izin kaydını
/// oluşturur. Örnek: Z.MERKEZ BURO · MUHASEBE ÇALIŞANI → Muhasebe Müdürü →
/// Genel Müdür Yardımcısı → İK; ŞUBE · KASİYER → Mağaza Müdürü → Bölge
/// Müdürü → Genel Müdür Yardımcısı → İK.
/// </para>
///
/// <para>
/// Zincir talep oluşturulurken talebe yazılıyor (KRY_IZIN_TALEP.zincir,
/// bulunduğu adım KRY_IZIN_TALEP.asama): tablo sonradan değişse de bekleyen
/// talep kendi sırasıyla ilerliyor. Bir adım sıraya geldiğinde onaylayanı
/// yeniden bulunuyor; kimse yoksa, talep edenin kendisiyse ya da önceki
/// adımla aynı kişiyse adım atlanıyor.
/// </para>
///
/// <para>
/// Geri uyumluluk: eski talep tablosundaki durum adları korunuyor. Zincirli
/// talepte "Bekliyor" = zincirin ilk adımı (birim yöneticisi; imzalı form
/// şartı burada), "Mağaza Onayladı" = aradaki kişi adımları (bölge müdürü,
/// GMY…), "Bölge Onayladı" = İnsan Kaynakları adımı. Yayındaki Biçen360
/// sürümleri (1.6–1.9) ve panel bu durumlarla çalışmaya devam ediyor;
/// kararlar magaza_* / bolge_* / ik_* kolonlarına da yazılıyor. Zinciri
/// olmayan (bu sürümden önce açılmış) talepler eski akışla sonuçlanıyor.
/// Avans tablosunda kişinin iş yeri + pozisyonu için kural yoksa zincir
/// yazılmıyor ve talep eski izin akışıyla (OrgOnayServisi) ilerliyor.
/// </para>
/// </summary>
public class IzinOnayZinciri
{
    private readonly AvansOnayZinciri _avans;
    private readonly IzinZincirKurali _tablo;
    private readonly IzinOnayKuralServisi _izinKural;
    private readonly ILogger<IzinOnayZinciri> _kayit;

    public IzinOnayZinciri(AvansOnayZinciri avans, IzinZincirKurali tablo, IzinOnayKuralServisi izinKural, ILogger<IzinOnayZinciri> kayit)
    {
        _avans = avans;
        _tablo = tablo;
        _izinKural = izinKural;
        _kayit = kayit;
    }

    public const string TurKisi = "kisi";
    public const string TurIk = "ik";

    public const string KararOnay = "onay";
    public const string KararRed = "red";
    public const string KararAtlandi = "atlandi";

    /* Durum adları IzinTalepController ile aynı; yazım farkı akışı bozar */
    public const string Bekliyor = "Bekliyor";
    public const string MagazaOnayli = "Mağaza Onayladı";
    public const string BolgeOnayli = "Bölge Onayladı";

    /* -------------------------------------------------------------- model */

    /// <summary>Talebe yazılan adım</summary>
    public sealed class Adim
    {
        /// <summary>Görünen ad: "Mağaza Müdürü", "Genel Müdür Yardımcısı", "İnsan Kaynakları"</summary>
        public string Ad { get; set; }

        /// <summary>kisi · ik</summary>
        public string Tur { get; set; }

        /// <summary>Tablodaki onaylayan pozisyon</summary>
        public string Onay { get; set; }

        /// <summary>Belirli kişi (tablo satırında sicil yazıyorsa)</summary>
        public string Sicil { get; set; }

        /// <summary>Biçen360'tan karar verebilecek siciller (baştaki sıfırsız; yetki denetimi)</summary>
        public List<string> Siciller { get; set; } = new();

        /// <summary>Aynı kişilerin Mikro'daki sicilleri (bildirim için; KRY_MOBIL_JETON birebir eşleşiyor)</summary>
        public List<string> Kodlar { get; set; } = new();

        public List<string> Adlar { get; set; } = new();

        /// <summary>Panelde bu adımda karar verebilecek roller (Admin ve GMY her adımda)</summary>
        public List<string> Roller { get; set; } = new();

        /// <summary>onay · red · atlandi · null (bekliyor / sırası gelmedi)</summary>
        public string Karar { get; set; }
        public string Kim { get; set; }
        public DateTime? Tarih { get; set; }
        public string Not { get; set; }
    }

    public sealed class Zincir
    {
        /// <summary>"Z.MERKEZ BURO · MUHASEBE ÇALIŞANI"</summary>
        public string Kural { get; set; }
        public string IsYeri { get; set; }
        public bool Capraz { get; set; }
        public bool SubeKurali { get; set; }
        public DateTime Olusturma { get; set; } = DateTime.Now;
        public List<Adim> Adimlar { get; set; } = new();
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

    /// <summary>
    /// Talep satırından (SELECT *) zincir ve bulunduğu adım. Kolon yoksa ya
    /// da zincir yazılmamışsa null: talep eski akışla ilerliyor.
    /// </summary>
    public static (Zincir Zincir, int Asama)? Talepten(object talep)
    {
        if (talep is not IDictionary<string, object> s) return null;

        var z = s.TryGetValue("zincir", out var ham) ? Oku(ham as string) : null;
        if (z is null) return null;

        var asama = s.TryGetValue("asama", out var a) && a is not null ? Convert.ToInt32(a) : 0;
        return (z, Math.Clamp(asama, 0, z.Adimlar.Count - 1));
    }

    public static Adim AdimAl(Zincir z, int asama) =>
        z.Adimlar[Math.Clamp(asama, 0, z.Adimlar.Count - 1)];

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    /// <summary>Biçen360 kullanıcısı bu adımda karar verebilir mi</summary>
    public static bool SicilYetkili(Adim x, string sicil) =>
        x is { Tur: TurKisi } && (x.Siciller ?? new()).Contains(K(sicil), StringComparer.OrdinalIgnoreCase);

    /// <summary>Bu kişi talebin şu anki adımında onaylayıcı mı</summary>
    public static bool KararVerebilir(Zincir z, int asama, string sicil) => SicilYetkili(AdimAl(z, asama), sicil);

    /// <summary>Bu kişi zincirin herhangi bir kişi adımında onaylayıcı mı (formu görme yetkisi)</summary>
    public static bool ZincirdeMi(Zincir z, string sicil) => z.Adimlar.Any(a => SicilYetkili(a, sicil));

    /// <summary>
    /// Adımın eski durum adı: ilk adım "Bekliyor", İK "Bölge Onayladı",
    /// aradaki kişi adımları "Mağaza Onayladı". Yayındaki uygulama ve panel
    /// bu adlarla çalışıyor.
    /// </summary>
    public static string Durum(Zincir z, int asama) =>
        asama <= 0 ? Bekliyor
        : AdimAl(z, asama).Tur == TurIk ? BolgeOnayli
        : MagazaOnayli;

    /// <summary>Adımın eski kolon öneki: magaza (ilk adım), bolge (ara kişi adımları), ik</summary>
    public static string Alan(Zincir z, int asama) =>
        asama <= 0 ? "magaza"
        : AdimAl(z, asama).Tur == TurIk ? "ik"
        : "bolge";

    /// <summary>Mobil kart için aşama: 1 ilk adım, 2 aradaki kişi adımları, 0 İK (mobilde değil)</summary>
    public static int MobilAsama(Zincir z, int asama) =>
        AdimAl(z, asama).Tur == TurIk ? 0 : asama <= 0 ? 1 : 2;

    /* ------------------------------------------------------------- oluşum */

    /// <summary>
    /// Talep anındaki zincir. Avans tablosunda kişinin kuralı (ya da aynı
    /// pozisyonun başka iş yerindeki kuralı) yoksa null: talep eski akışla
    /// açılır. Kişi adımları tablodaki sırayla (İK'dan sonrakiler de), İK
    /// en sonda; kişi adımlarının onaylayanları bulunur.
    /// </summary>
    public Zincir Olustur(PersonelKaydi p)
    {
        if (p is null) return null;

        /* 27.10.2026: İK'nın "İZİN TALEP ONAY SÜRECİ" tablosu (IzinZincirKurali);
           satırdaki sırayla. Kuralı yoksa şubede Mağaza Müdürü → Bölge
           Müdürü → İK, diğerlerinde İK. Avans tablosu artık kullanılmıyor. */
        var (kural, capraz) = _tablo.KuralBul(p.Pozisyon, p.IsGrubu, p.PersonelKodu);
        var yer = _tablo.IsYeri(p.IsGrubu);
        var sube = A(yer) == A(AvansOnayZinciri.Sube);
        var kaynak = kural?.Adimlar is { Count: > 0 } ? kural.Adimlar : IzinZincirKurali.Varsayilan(sube);

        var z = new Zincir
        {
            Kural = kural is null ? $"varsayılan ({yer})" : $"{kural.IsYeri} · {kural.Pozisyon}",
            IsYeri = yer,
            Capraz = capraz,
            SubeKurali = sube,
        };

        foreach (var x in kaynak)
        {
            if (AvansOnayZinciri.IkMi(x.Onay)) continue;

            var sicil = string.Equals(x.Sicil, "gmy", StringComparison.OrdinalIgnoreCase)
                ? AvansOnayZinciri.GmySicil()
                : x.Sicil;

            /* Aynı pozisyon + kişi art arda bir kez (tablo satırı tekrar ediyorsa) */
            var son = z.Adimlar.LastOrDefault();
            if (son is not null && A(son.Onay) == A(x.Onay) && K(son.Sicil) == K(sicil)) continue;

            z.Adimlar.Add(new Adim
            {
                Ad = IzinOnayKuralServisi.BasHarf(x.Onay),
                Tur = TurKisi,
                Onay = x.Onay,
                Sicil = sicil,
                /* GMY adımı panelde GMY hesabıyla da onaylanabiliyor */
                Roller = A(x.Onay).Contains(A("GENEL MÜDÜR YARDIMCISI")) ? new() { BicenKariyer.API.Roller.GenelMudurYardimcisi } : new(),
            });
        }

        /* Son onay her zaman İnsan Kaynakları: izin kaydını ve bakiyeyi İK kesinleştiriyor */
        z.Adimlar.Add(new Adim
        {
            Ad = AvansOnayZinciri.IkAdi,
            Tur = TurIk,
            Onay = AvansOnayZinciri.Ik,
            Roller = new() { BicenKariyer.API.Roller.IK, BicenKariyer.API.Roller.IKYoneticisi },
        });

        foreach (var a in z.Adimlar.Where(a => a.Tur == TurKisi)) Coz(a, p.PersonelKodu, p.IsGrubu, z);

        return z;
    }

    /// <summary>Kişi adımının onaylayanları (talep eden hariç)</summary>
    public void Coz(Adim a, string talepSicil, string isGrubu, Zincir z)
    {
        if (a.Tur != TurKisi) return;

        try
        {
            var kisiler = _izinKural.KisileriBul(a.Onay, a.Sicil, talepSicil, isGrubu, z.Capraz, z.SubeKurali)
                .Where(x => K(x.PersonelKodu) != K(talepSicil))
                .GroupBy(x => K(x.PersonelKodu)).Select(g => g.First())
                .Take(20)
                .ToList();

            a.Siciller = kisiler.Select(x => K(x.PersonelKodu)).ToList();
            a.Kodlar = kisiler.Select(x => (x.PersonelKodu ?? "").Trim()).ToList();
            a.Adlar = kisiler.Select(x => $"{x.Ad} {x.Soyad}".Trim()).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin onaylayanı bulunamadı: {Onay}", a.Onay);
        }
    }

    /// <summary>
    /// Sıradaki adım (asama'dan sonra; -1 ile ilk adım). Kişi adımında
    /// onaylayan yeniden bulunuyor; talep edenin kendisi, kimse yok ya da
    /// önceki adımın onaylayanıyla aynıysa adım "atlandi" (talep sahipsiz
    /// beklemesin). İK adımı hiç atlanmaz. Kalan adım yoksa null.
    /// </summary>
    public int? Ilerle(Zincir z, int asama, string talepSicil, string isGrubu)
    {
        for (var j = asama + 1; j < z.Adimlar.Count; j++)
        {
            var a = z.Adimlar[j];

            if (a.Tur != TurKisi) return j;

            if (a.Sicil is not null && K(a.Sicil) == K(talepSicil))
            {
                Atla(a, "Talep eden bu adımın onaylayanı");
                continue;
            }

            Coz(a, talepSicil, isGrubu, z);

            if (a.Siciller.Count == 0)
            {
                Atla(a, "Onaylayacak kişi bulunamadı");
                continue;
            }

            /* Önceki kişi adımında aynı kişi(ler) karar verdiyse ikinci kez sorulmuyor
               (mağaza müdürünün talebi: bölge müdürü 1. onaylayan; bölge müdürü adımı atlanır) */
            var onceki = z.Adimlar.Take(j).LastOrDefault(x => x.Tur == TurKisi && x.Karar == KararOnay);
            if (onceki is not null && onceki.Siciller.Count > 0
                && onceki.Siciller.OrderBy(x => x).SequenceEqual(a.Siciller.OrderBy(x => x)))
            {
                Atla(a, $"Önceki adımda aynı kişi onayladı ({onceki.Ad})");
                continue;
            }

            return j;
        }

        return null;
    }

    private static void Atla(Adim a, string not)
    {
        a.Karar = KararAtlandi;
        a.Not = not;
        a.Kim = "Sistem";
        a.Tarih = DateTime.Now;
    }

    /* ------------------------------------------------------------- çıktı */

    /// <summary>Panel "ONAY AKIŞI" kartları: zincirdeki gerçek adımlar</summary>
    public static List<object> Akis(Zincir z, int asama, string durum)
    {
        var bitti = durum is "Onaylandı" or "Reddedildi";

        return z.Adimlar.Select((a, i) => new
        {
            /* Eski kart anahtarları: ilk adım "magaza", İK "ik"; aradakiler adım sırasıyla */
            alan = i == 0 ? "magaza" : a.Tur == TurIk ? "ik" : $"adim{i}",
            ad = a.Ad,
            tur = a.Tur,
            kisa = a.Tur == TurIk ? "İK" : Kisa(a.Ad),
            yer = a.Tur == TurIk ? "İK'da" : $"{a.Ad} aşamasında",
            durum = a.Karar == KararOnay ? "tamam"
                : a.Karar == KararRed ? "red"
                : a.Karar == KararAtlandi ? "atlandi"
                : !bitti && i == asama ? "sirada"
                : "bekliyor",
            karar = a.Karar == KararOnay ? "Onaylandı" : a.Karar == KararRed ? "Reddedildi" : a.Karar == KararAtlandi ? "Atlandı" : null,
            kisi = a.Kim,
            not = a.Not,
            tarih = a.Tarih,
            kisiler = a.Adlar,
            sicil = a.Sicil,
        }).Cast<object>().ToList();
    }

    /// <summary>Mobil kart için sıra şeridi (avans kartındaki gibi)</summary>
    public static List<object> MobilSira(Zincir z) =>
        z.Adimlar.Select(x => new
        {
            ad = x.Ad,
            tur = x.Tur,
            karar = x.Karar,
            kim = x.Kim is null ? null : KararEtiketi.Kisi(x.Ad, x.Tur, x.Kim),
            tarih = x.Tarih,
            not = x.Karar == KararAtlandi ? null : x.Not,
        }).Cast<object>().ToList();

    private static string Kisa(string ad)
    {
        var a = A(ad);
        if (a.Contains(A("GENEL MÜDÜR YARDIMCISI"))) return "GMY";
        if (a.Contains(A("BÖLGE MÜDÜRÜ"))) return "Bölge";
        if (a.Contains(A("MAĞAZA MÜDÜRÜ"))) return "Mağaza";
        return ad is { Length: > 10 } ? ad[..10] + "…" : ad;
    }

    /// <summary>Zincirin tek satırlık özeti: "Mağaza Müdürü → Bölge Müdürü → Genel Müdür Yardımcısı → İnsan Kaynakları"</summary>
    public static string Ozet(Zincir z) =>
        string.Join(" → ", z.Adimlar.Where(a => a.Karar != KararAtlandi).Select(a => a.Ad));

    /* ------------------------------------------------------------- yazma */

    /// <summary>Zinciri ve adımı talebe yazar</summary>
    public static void Yaz(System.Data.IDbConnection db, int id, Zincir z, int asama) =>
        db.Execute("UPDATE KRY_IZIN_TALEP SET zincir = @zincir, asama = @asama WHERE id = @id",
            new { id, zincir = Json(z), asama });
}

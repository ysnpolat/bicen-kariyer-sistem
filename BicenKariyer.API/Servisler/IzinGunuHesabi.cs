namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin gün sayısının saf hesabı: veritabanına dokunmuyor.
///
/// <para>
/// <see cref="IzinGunuServisi"/> tanımları (resmi tatiller, haftalık izin
/// günleri, kurallar) okuyup buraya veriyor. Hesap ayrı tutuldu ki tek
/// yerde dursun ve veritabanı olmadan sınanabilsin: mobil önizleme, talep
/// oluşturma, panel gün hesabı, izin formu ve bakiye hepsi bu sayıyı
/// kullanıyor.
/// </para>
///
/// <para>
/// Cumartesi kuralı (03.10.2026): cumartesisi çalışma günü olmayan
/// personelde (genel merkez gibi pazartesi–cuma çalışanlar) izin o hafta
/// pazartesi, salı ya da çarşamba başlıyorsa ve haftanın sonuna (cumaya)
/// kadar sürüyorsa o haftanın cumartesisi izinden düşülüyor. Perşembe ya da
/// cuma başlayan izinde düşülmüyor. Kural hafta hafta uygulanıyor: birden
/// çok haftaya yayılan izinde ara haftalar pazartesi başladığı için
/// cumartesileri düşülüyor. Pazar ve resmi tatil hiçbir zaman düşülmüyor.
/// </para>
///
/// <para>
/// Cuma biten izin: pazartesi–cuma çalışan biri cuma son izin gününü
/// seçtiğinde pazartesi işe dönüyor; mobil uygulama "son izin günü"
/// sorduğu için bu kişiler cumayı seçiyor. Kural yalnızca aralıkta
/// cumartesi olunca uygulansaydı cumayı seçen herkes kuraldan çıkardı.
/// Bu yüzden cuma biten izinde (ayarla kapatılabilir) ertesi cumartesi de
/// sayıya ekleniyor.
/// </para>
/// </summary>
public static class IzinGunuHesabi
{
    /// <summary>Hesabın ayrıntısı; ekranda "şu kadar gün düşülmedi" demek için.</summary>
    public sealed record Sonuc(
        decimal Gun,
        decimal TakvimGunu,
        decimal ResmiTatil,
        decimal HaftalikIzin,
        List<string> Dusulmeyenler)
    {
        /// <summary>Cumartesi kuralıyla izinden düşülen cumartesi sayısı.</summary>
        public decimal CumartesiDusen { get; init; }

        /// <summary>Kişiye gösterilecek açıklamalar: "Cumartesi izinden düşüldü…"</summary>
        public List<string> Notlar { get; init; } = new();
    }

    public static readonly string[] GunAdlari =
        { "Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi" };

    /// <summary>Tarihin bulunduğu haftanın pazartesisi.</summary>
    public static DateTime HaftaBasi(DateTime g) =>
        g.Date.AddDays(-(((int)g.DayOfWeek + 6) % 7));

    /// <summary>
    /// İlk ve son izin günü (ikisi de dahil) arasında bakiyeden düşülecek
    /// gün sayısı.
    /// </summary>
    /// <param name="tatiller">Resmi tatiller; aralığın son haftasının pazarına kadar.</param>
    /// <param name="haftalikMi">O gün kişinin haftalık izin günü mü (plan, sabit gün, grup).</param>
    /// <param name="kural">Cumartesi kuralı; null ise kural yok.</param>
    public static Sonuc Say(
        DateTime ilk,
        DateTime son,
        IReadOnlyDictionary<DateTime, (string Ad, bool Yarim)> tatiller,
        Func<DateTime, bool> haftalikMi,
        CumartesiKurali kural)
    {
        var bas = ilk.Date;
        var bit = son.Date;

        if (bit < bas) return new Sonuc(0, 0, 0, 0, new List<string>());

        tatiller ??= new Dictionary<DateTime, (string, bool)>();
        haftalikMi ??= _ => false;

        var takvim = (decimal)((bit - bas).Days + 1);

        decimal tatilDusen = 0;
        decimal haftalikDusen = 0;
        decimal cumartesiDusen = 0;
        decimal ekGun = 0;

        var dusulmeyenler = new List<string>();
        var notlar = new List<string>();

        for (var g = bas; g <= bit; g = g.AddDays(1))
        {
            if (tatiller.TryGetValue(g, out var t))
            {
                /* Arife yarım gün: yarısı çalışma günü sayılıyor */
                var pay = t.Yarim ? 0.5m : 1m;

                tatilDusen += pay;
                dusulmeyenler.Add($"{g:dd.MM.yyyy} · {t.Ad}");
                continue;
            }

            /* Resmi tatille aynı güne denk gelen haftalık izin iki kez
               düşülmemeli; tatil dalı yukarıda zaten devam ediyor. */
            if (!haftalikMi(g)) continue;

            if (g.DayOfWeek == DayOfWeek.Saturday)
            {
                var karar = CumartesiKarari(g, bas, bit, tatiller, haftalikMi, kural);

                if (karar.Duser)
                {
                    /* Aralığın içinde: takvim gününden çıkarılmıyor */
                    cumartesiDusen += 1;
                    notlar.Add(karar.Not);
                    continue;
                }

                if (karar.Not is not null) notlar.Add(karar.Not);
            }

            haftalikDusen += 1;
            dusulmeyenler.Add($"{g:dd.MM.yyyy} · haftalık izin");
        }

        /* Cuma biten izin: kişi pazartesi dönüyor, aradaki cumartesi
           aralığın dışında kalsa da kurala giriyor. */
        if (kural is { Acik: true, CumaBitenDahil: true } && bit.DayOfWeek == DayOfWeek.Friday)
        {
            var cmt = bit.AddDays(1);

            if (!tatiller.ContainsKey(cmt) && haftalikMi(cmt))
            {
                var karar = CumartesiKarari(cmt, bas, bit, tatiller, haftalikMi, kural);

                if (karar.Duser)
                {
                    cumartesiDusen += 1;
                    ekGun += 1;
                    notlar.Add(karar.Not);
                }
                else if (karar.Not is not null)
                {
                    notlar.Add(karar.Not);
                }
            }
        }

        var gun = takvim - tatilDusen - haftalikDusen + ekGun;

        return new Sonuc(
            gun < 0 ? 0 : gun,
            takvim,
            tatilDusen,
            haftalikDusen,
            dusulmeyenler)
        {
            CumartesiDusen = cumartesiDusen,
            Notlar = notlar,
        };
    }

    /// <summary>
    /// Haftalık izin olan bir cumartesinin izinden düşülüp düşülmeyeceği.
    /// Not: kural uygulanmışsa (düşülse de düşülmese de) kişiye açıklama.
    /// </summary>
    private static (bool Duser, string Not) CumartesiKarari(
        DateTime cmt,
        DateTime bas,
        DateTime bit,
        IReadOnlyDictionary<DateTime, (string Ad, bool Yarim)> tatiller,
        Func<DateTime, bool> haftalikMi,
        CumartesiKurali kural)
    {
        if (kural is not { Acik: true }) return (false, null);

        /* Yalnızca hafta sonu iki gün izinli olanlar: tek haftalık izni
           cumartesi olan mağaza personelinin izin günü yıllık izinden
           düşülmemeli. Pazarı resmi tatil olsa da hafta sonu sayılır. */
        var pazar = cmt.AddDays(1);

        if (kural.YalnizcaIkiGunIzinli && !haftalikMi(pazar)) return (false, null);

        var pazartesi = HaftaBasi(cmt);
        var cuma = cmt.AddDays(-1);

        /* Haftanın sonuna kadar sürmeyen izinde kural yok: perşembe dönen
           kişinin cumartesisi zaten izin dışı. */
        if (bit < cuma || bas > cuma) return (false, null);

        var ilkGun = bas > pazartesi ? bas : pazartesi;
        var tetik = kural.TetikGunleri is { Count: > 0 } ? kural.TetikGunleri : CumartesiKurali.Varsayilan;
        var ilkAdi = GunAdlari[(int)ilkGun.DayOfWeek];

        if (tetik.Contains((int)ilkGun.DayOfWeek))
            return (true, ilkGun == pazartesi && bas < pazartesi
                ? $"{cmt:dd.MM.yyyy} Cumartesi izinden düşüldü (izin o haftayı baştan kapsadığı için)."
                : $"{cmt:dd.MM.yyyy} Cumartesi izinden düşüldü (izin {ilkAdi} başladığı için).");

        return (false, $"{cmt:dd.MM.yyyy} Cumartesi izinden düşülmedi (izin {ilkAdi} başladığı için).");
    }
}

/* ========================================================================== */
/* Kurallar (Yönetim → İzin Kuralları)                                        */
/* ========================================================================== */

/// <summary>
/// İzin kuralları: cumartesi kuralı ve vardiya planı denetimi.
/// KRY_AYARLAR'da <c>IZIN_KURAL</c> anahtarında JSON olarak duruyor.
/// </summary>
public class IzinKuralAyari
{
    public const string Anahtar = "IZIN_KURAL";

    public CumartesiKurali Cumartesi { get; set; } = new();

    public VardiyaKontrolKurali Vardiya { get; set; } = new();

    /// <summary>
    /// Cumartesisi izinli personel (08.10.2026): bu sicillerde cumartesi
    /// pazar gibi haftalık izin sayılır ve yıllık izinden hiç düşülmez;
    /// pazartesi–salı–çarşamba cumartesi kuralı bu kişilere uygulanmaz.
    /// Yönetim → İzin Kuralları'ndan seçiliyor.
    /// </summary>
    public List<string> CumartesiIzinliler { get; set; } = new();

    /// <summary>Sicil listede mi (baştaki sıfırlar ve boşluk yok sayılır)</summary>
    public bool CumartesiIzinliMi(string sicil) =>
        !string.IsNullOrWhiteSpace(sicil)
        && (CumartesiIzinliler ?? new List<string>()).Any(x => IzinOnayKuralServisi.AyniSicil(x, sicil));
}

/// <summary>Cumartesi kuralı; ayrıntı <see cref="IzinGunuHesabi"/>.</summary>
public class CumartesiKurali
{
    /// <summary>Pazartesi, salı, çarşamba (DayOfWeek: 1, 2, 3).</summary>
    public static readonly List<int> Varsayilan = new() { 1, 2, 3 };

    public bool Acik { get; set; } = true;

    /// <summary>
    /// Haftadaki ilk izin günü bunlardan biriyse cumartesi düşülür
    /// (DayOfWeek: 0 pazar … 6 cumartesi).
    /// </summary>
    public List<int> TetikGunleri { get; set; } = new() { 1, 2, 3 };

    /// <summary>
    /// Yalnızca cumartesi ve pazarı birlikte izinli olanlara uygulanır.
    /// Tek haftalık izni cumartesi olan personelin izin günü korunur.
    /// </summary>
    public bool YalnizcaIkiGunIzinli { get; set; } = true;

    /// <summary>
    /// Son izin günü cuma olan (pazartesi dönen) izinde de ertesi
    /// cumartesi düşülür.
    /// </summary>
    public bool CumaBitenDahil { get; set; } = true;
}

/// <summary>
/// Mobil izin talebinde vardiya planı denetimi: talep edilen günlerde
/// plan yoksa talep açılmıyor.
/// </summary>
public class VardiyaKontrolKurali
{
    public bool Acik { get; set; } = true;

    /// <summary>Denetlenen izin türleri; boşsa yalnızca yıllık izin.</summary>
    public List<string> Turler { get; set; } = new() { "Yıllık İzin" };

    /// <summary>
    /// hepsi: bütün personel · planKullanan: biriminde son 60 günde ya da
    /// ileriye dönük en az bir plan kaydı olanlar · secili: listedeki
    /// birimler.
    /// </summary>
    public string Kapsam { get; set; } = "planKullanan";

    /// <summary>Kapsam "secili" iken denetlenen birimler (iş grubu adı).</summary>
    public List<string> Birimler { get; set; } = new();

    /// <summary>Hiçbir kapsamda denetlenmeyen birimler.</summary>
    public List<string> MuafBirimler { get; set; } = new();

    /// <summary>
    /// Şube haftası (07.10.2026): personelin talep ettiği (içinde bulunulan)
    /// haftada şubesindeki herkesin o haftaki planı tam değilse talep
    /// açılmaz. İleri tarihli talep de bu haftanın planına bağlı. Türler,
    /// kapsam ve muaf birimler yukarıdakilerle aynı.
    /// </summary>
    public bool SubeHaftasi { get; set; } = true;

    /// <summary>
    /// Mobil Fiyat Kontrol de haftalık plan istesin (Biçen360 API okuyor):
    /// içinde bulunulan haftada personelin planda hiç kaydı yoksa fiyat
    /// sorgusu ve etiket listesi açılmaz. Kapsam ayarından bağımsız; yalnızca
    /// muaf birimler ve <see cref="FiyatKontrolMuaf"/> denetlenmez.
    /// </summary>
    public bool FiyatKontrol { get; set; } = true;

    /// <summary>Fiyat Kontrol denetiminden ayrıca muaf birimler (genel merkez gibi).</summary>
    public List<string> FiyatKontrolMuaf { get; set; } = new();
}

using BicenKariyer.API.Controllers;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Bir personelin işe uyum değerlendirmesini kimin yapacağını bulur.
///
/// <para>
/// Kural: mağaza personelini mağaza müdürü, mağaza müdürünü o mağazanın
/// bölge müdürü değerlendirir. Mağaza müdürü Mikro'daki aktif personel
/// arasından, bölge müdürü panel kullanıcıları arasından bulunur; elle
/// tanımlı eşleştirme (Yönetim → Form Ayarları) tahmine üstün gelir.
/// </para>
///
/// <para>
/// Gönderim (<c>UyumController</c>) ve takip listesi
/// (<c>PersonelController.Takip</c>) aynı kuralı kullanmalı; ikisi ayrı
/// yazıldığında listede görünen yönetici ile SMS giden yönetici
/// farklı çıkıyordu.
/// </para>
/// </summary>
public class YoneticiBulucu
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly ILogger<YoneticiBulucu> _kayit;

    public YoneticiBulucu(VeritabaniServisi vt, AyarServisi ayar,
                          ILogger<YoneticiBulucu> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _kayit = kayit;
    }

    /// <summary>Değerlendirilecek kişi mağaza müdürü mü.</summary>
    public static bool MagazaMuduruMu(string pozisyon) =>
        !string.IsNullOrWhiteSpace(pozisyon)
        && pozisyon.Contains("Mağaza Müdürü", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Yöneticiyi, telefonunu ve kaynağını bulur: "bolge" (bölge müdürü)
    /// ya da "magaza" (mağaza yöneticisi). Bulunamazsa telefon null döner.
    /// </summary>
    public (string ad, string telefon, string kaynak) Bul(
        List<PersonelKaydi> personeller, string sube, string pozisyon)
    {
        if (MagazaMuduruMu(pozisyon))
        {
            var bolge = BolgeMuduruBul(sube);

            /* Bölge müdürü tanımlı değilse mağazaya düşmek yanlış olur:
               kişi kendi kendini değerlendirirdi. Bulunamadı denir. */
            return (bolge.ad, bolge.telefon, "bolge");
        }

        var m = MagazaYoneticisi(personeller, sube, pozisyon);

        return (m.ad, m.telefon, "magaza");
    }

    /// <summary>
    /// Bir mağazanın yöneticisini ve cep numarasını bulur.
    ///
    /// <para>
    /// Ayrı bir tanım tutulmaz; Mikro'daki aktif personel arasından o
    /// şubenin müdürü aranır. Önce "Mağaza Müdürü", bulunamazsa "Müdür
    /// Yardımcısı", o da yoksa ünvanında "müdür" geçen ilk kişi alınır.
    /// Elle tutulan ikinci bir liste zamanla gerçekten sapardı.
    /// </para>
    /// </summary>
    public (string ad, string telefon) MagazaYoneticisi(
        List<PersonelKaydi> personeller, string sube, string pozisyon = null) =>
        MagazaYoneticisi(personeller, sube, pozisyon, null);

    /// <summary>
    /// Aynı kural; elle tanımlı eşleştirmeler çağırandan gelebiliyor
    /// (03.10.2026). Patron görünümü bütün şubelerin müdürünü tek seferde
    /// buluyor; her şube için ayarları yeniden okumak şube sayısı kadar
    /// sorgu demekti. <paramref name="eslesmeler"/> null ise ayarlardan
    /// okunur — eski davranış.
    /// </summary>
    public (string ad, string telefon) MagazaYoneticisi(
        List<PersonelKaydi> personeller, string sube, string pozisyon,
        List<YoneticiEslesme> eslesmeler)
    {
        var adaylar = personeller
            .Where(x => x.Durum == 1
                        && string.Equals((x.Sube ?? "").Trim(), (sube ?? "").Trim(),
                                         StringComparison.OrdinalIgnoreCase)
                        && !string.IsNullOrWhiteSpace(x.Pozisyon))
            .ToList();

        if (adaylar.Count == 0) return (null, null);

        /* Elle tanımlanmış eşleştirme tahmine üstün gelir. Önce birim +
           pozisyon, sonra yalnızca birim aranır; böylece Genel Müdürlük
           gibi birimlerde her alan için ayrı yönetici tanımlanabilir. */
        eslesmeler ??= _ayar.FormOku().UyumYoneticiEslesme
                       ?? new List<YoneticiEslesme>();

        /* Birim adları iki kaynakta Türkçe harflerde ayrışabiliyor
           (Z.MERKEZ BÜRO ↔ Z.MERKEZ BURO). Karşılaştırma sadeleştirilmiş
           anahtar üzerinden yapılır, yoksa eşleştirme hiç devreye girmiyor. */
        var subeAnahtar = EslesmeAnahtari(sube);

        bool BirimUyar(YoneticiEslesme e) =>
            EslesmeAnahtari(e.Birim) == subeAnahtar;

        var tanim =
            eslesmeler.FirstOrDefault(e =>
                BirimUyar(e)
                && !string.IsNullOrWhiteSpace(e.Pozisyon)
                && EslesmeAnahtari(e.Pozisyon) == EslesmeAnahtari(pozisyon))
            ?? eslesmeler.FirstOrDefault(e =>
                BirimUyar(e) && string.IsNullOrWhiteSpace(e.Pozisyon));

        if (tanim is not null)
        {
            var tanimli = personeller.FirstOrDefault(x =>
                string.Equals((x.PersonelKodu ?? "").Trim(),
                              (tanim.YoneticiKodu ?? "").Trim(),
                              StringComparison.OrdinalIgnoreCase));

            if (tanimli is not null)
                return ($"{tanimli.Ad} {tanimli.Soyad}".Trim(),
                        TelefonSadelestir(tanimli.Telefon));
        }

        bool Unvanli(PersonelKaydi x, params string[] kelimeler) =>
            kelimeler.Any(k => x.Pozisyon.Contains(k, StringComparison.OrdinalIgnoreCase));

        /* Genel Müdürlük gibi birimlerde birden çok müdür var: Muhasebe
           Müdürü, Pazarlama Müdürü, Bilgi Teknolojileri Müdürü... Bir IT
           uzmanının yöneticisi Muhasebe Müdürü değil. Bu yüzden önce
           çalışanın kendi alanıyla örtüşen müdür aranır. */
        PersonelKaydi AlanaGore()
        {
            if (string.IsNullOrWhiteSpace(pozisyon)) return null;

            /* Ünvandaki ayırt edici kelimeler: 'uzmanı', 'müdürü' gibi
               ortak sözcükler eşleşmeye katılmaz, yoksa her müdür uyar. */
            var atla = new[] { "uzman", "uzmanı", "müdür", "müdürü", "yardımcısı",
                               "şef", "şefi", "görevlisi", "personeli",
                               "çalışanı", "sorumlusu", "yöneticisi", "asistanı",
                               "ve", "part" };

            var kelimeler = pozisyon
                .Split(new[] { ' ', '.', '-', '/' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim().ToLowerInvariant())
                .Where(x => x.Length >= 4 && !atla.Contains(x))
                .ToList();

            if (kelimeler.Count == 0) return null;

            return adaylar
                .Where(x => Unvanli(x, "Müdür", "Yönetici"))
                .Select(x => new
                {
                    kisi = x,
                    ortak = kelimeler.Count(k =>
                        x.Pozisyon.Contains(k, StringComparison.OrdinalIgnoreCase))
                })
                .Where(x => x.ortak > 0)
                .OrderByDescending(x => x.ortak)
                .Select(x => x.kisi)
                .FirstOrDefault();
        }

        PersonelKaydi Bul(params string[] unvanlar) =>
            adaylar.FirstOrDefault(x => Unvanli(x, unvanlar));

        var kisi = AlanaGore()
                ?? Bul("Mağaza Müdürü")
                ?? Bul("Müdür Yardımcısı")
                ?? Bul("Mağaza Şefi")
                ?? Bul("Müdür")
                ?? Bul("Yönetici");

        if (kisi is null) return (null, null);

        return ($"{kisi.Ad} {kisi.Soyad}".Trim(), TelefonSadelestir(kisi.Telefon));
    }

    /// <summary>
    /// Bir şubenin bölge müdürü.
    ///
    /// Panel kullanıcıları arasından, rolü bölge müdürü olan ve şubeleri
    /// arasında bu şube bulunan kişi aranır.
    /// </summary>
    public (string ad, string telefon) BolgeMuduruBul(string sube)
    {
        try
        {
            using var db = _vt.Baglanti();

            var kisiler = db.Query(@"
SELECT ad_soyad AS adSoyad, telefon, subeler
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol = @rol AND telefon IS NOT NULL",
                new { rol = Roller.BolgeMuduru }).ToList();

            var anahtar = EslesmeAnahtari(sube);

            foreach (var k in kisiler)
            {
                var liste = ((string)k.subeler ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(x => EslesmeAnahtari(x));

                if (liste.Contains(anahtar))
                    return ((string)k.adSoyad, TelefonSadelestir((string)k.telefon));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bölge müdürü bulunamadı: {Sube}", sube);
        }

        return (null, null);
    }

    /// <summary>
    /// Eşleştirme anahtarı.
    ///
    /// <para>
    /// <c>PersonelKaynagiServisi.BirimAnahtari</c> Türkçe harfleri olduğu
    /// gibi bırakıyor; ayarlardaki "Z.MERKEZ BÜRO" ile Mikro'daki
    /// "Z.MERKEZ BURO" bu yüzden eşleşmiyordu. Burada harfler de
    /// karşılıklarına indirilir.
    /// </para>
    /// </summary>
    public static string EslesmeAnahtari(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return "";

        var buyuk = metin.Trim().ToUpperInvariant();

        foreach (var (k, h) in new[]
        {
            ('İ', 'I'), ('Ş', 'S'), ('Ğ', 'G'),
            ('Ü', 'U'), ('Ö', 'O'), ('Ç', 'C')
        })
        {
            buyuk = buyuk.Replace(k, h);
        }

        /* Harf ve rakam dışındaki her şey atılır: nokta, boşluk, tire
           iki kaynakta farklı yazılabiliyor. */
        return new string(buyuk.Where(char.IsLetterOrDigit).ToArray());
    }

    public static string TelefonSadelestir(string ham)
    {
        var t = new string((ham ?? "").Where(char.IsDigit).ToArray());

        if (t.StartsWith("90") && t.Length == 12) t = t[2..];
        if (t.StartsWith("0") && t.Length == 11) t = t[1..];

        return t.Length == 10 && t.StartsWith("5") ? t : null;
    }
}

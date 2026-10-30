using System.Globalization;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Ayarlar Merkezi › Süreler ve sınırlar (07.10.2026).
///
/// <para>
/// Kodun içinde sabit duran süreler, saatler ve sınırlar (otomatik onay 48
/// saat, mazeret belgesi 3 gün, fazla mesai en çok 16 saat, GMY sicili…)
/// buradan okunuyor. Değiştirmek için yayın gerekmiyor; Yönetim › Süreler
/// ve sınırlar ekranından kaydedilen değer en geç bir dakika içinde
/// geçerli olur.
/// </para>
///
/// <para>
/// Değerler KRY_AYARLAR'da <c>PARAMETRELER</c> anahtarında tek JSON
/// nesnesi olarak duruyor; yalnızca varsayılandan farklı olanlar yazılıyor.
/// Okuma sırası: kaydedilen değer → appsettings (tanımda adı varsa) →
/// varsayılan. Gizli değer (bağlantı cümlesi, anahtar, parola) bu
/// sistemde tutulmaz ve ekranda gösterilmez.
/// </para>
/// </summary>
public static class Parametre
{
    public const string Anahtar = "PARAMETRELER";

    public sealed record Tanim(
        string Anahtar,
        string Grup,
        string Ad,
        string Aciklama,
        string Tip,
        string Varsayilan,
        string Birim = null,
        int? Min = null,
        int? Max = null,
        string Yapilandirma = null,
        string Etki = null);

    public sealed record Grup(string Kod, string Ad, string Aciklama);

    public static readonly Grup[] Gruplar =
    {
        new("izin", "İzin talepleri", "Onay süreleri, mazeret belgesi ve hatırlatmalar"),
        new("fazlamesai", "Fazla mesai", "Kayıt sınırları"),
        new("avans", "Avans", "Onay akışındaki kişiler"),
        new("vardiya", "Vardiya ve okutma", "Hatırlatma saatleri ve okutma hedefleri"),
        new("uyum", "Uyum, çıkış ve pusula", "Anket bağlantıları ve onay süreleri"),
        new("mobil", "Biçen360", "Kurulum daveti SMS'leri ve güncelleme hatırlatması"),
        new("bildirim", "Toplu bildirim", "Yüzlerce kişiye giden bildirimin zamana yayılması"),
        new("gorev", "Otomatik görevler", "Arka planda çalışan görevlerin saatleri"),
    };

    /// <summary>Tipler: sayi, evethayir, saat (SS:dd), saatler (SS:dd,SS:dd), sicil, surum (1.6)</summary>
    public static readonly Tanim[] Tanimlar =
    {
        /* İzin */
        new("izin.otomatikOnaySaat", "izin", "Otomatik onay süresi",
            "Onay sırasındaki kişi bu süre içinde karar vermezse talep otomatik onaylanıp sonraki aşamaya geçer. 0 yazılırsa otomatik onay kapanır.",
            "sayi", "48", "saat", 0, 720, "IzinTalep:OtomatikOnaySaat", "İzin otomatik onay görevi"),
        new("izin.bolgeAsamasi", "izin", "Bölge müdürü onay aşaması",
            "Birim yöneticisinden sonra şubenin bölge müdürü onaylar. Kapalıysa talep birim yöneticisinden doğrudan İnsan Kaynaklarına geçer.",
            "evethayir", "true", null, null, null, "IzinTalep:BolgeAsamasi", "İzin onay sırası"),
        new("izin.mazeretBelgeGun", "izin", "Mazeret belgesi yükleme süresi",
            "Evlilik, doğum, ölüm gibi mazeret izinlerinde personelin belgeyi yükleyeceği süre. Süre dolunca yöneticisine bildirim gider.",
            "sayi", "3", "gün", 1, 30, null, "Mazeret belgesi görevi, izin talebi"),
        new("izin.mazeretTakipGun", "izin", "Mazeret belgesi takip süresi",
            "Süresi geçmiş ama yüklenmemiş belgeler için hatırlatmanın kaç gün daha süreceği.",
            "sayi", "14", "gün", 1, 90, null, "Mazeret belgesi görevi"),

        /* Fazla mesai */
        new("fm.enAzDakika", "fazlamesai", "En kısa fazla mesai",
            "Bundan kısa kayıt alınmaz.", "sayi", "15", "dakika", 1, 240, null, "Fazla mesai kaydı"),
        new("fm.enCokSaat", "fazlamesai", "Tek kayıtta en uzun süre",
            "Tek fazla mesai kaydının en fazla süresi.", "sayi", "16", "saat", 1, 24, null, "Fazla mesai kaydı"),
        new("fm.geriyeGun", "fazlamesai", "Geriye dönük giriş",
            "Fazla mesai en fazla kaç gün geriye girilebilir.", "sayi", "31", "gün", 0, 120, null, "Fazla mesai kaydı"),
        new("fm.aylikSaat", "fazlamesai", "Ücret hesabında aylık çalışma saati",
            "Fazla mesai saat ücreti = aylık ücret ÷ bu saat × zam oranı. Aylık ücret Yıllık İzin Ücretleri'ndeki kaynaktan.",
            "sayi", "225", "saat", 100, 300, null, "Fazla mesai raporu (ücret)"),
        new("fm.zamYuzde", "fazlamesai", "Fazla mesai zam oranı",
            "Saat ücretinin yüzde kaçı ödenir (yasal: %150).", "sayi", "150", "%", 100, 300, null, "Fazla mesai raporu (ücret)"),

        /* Avans */
        new("avans.gmySicil", "avans", "Genel müdür yardımcısı sicili",
            "Avans formunda GMY onay kutusunda adı çıkan ve avans onay akışında GMY adımına Biçen360'tan karar veren kişi.",
            "sicil", "10664", null, null, null, "Avans:GmySicil", "Avans formu, avans onay akışı"),

        /* Toplu bildirim (21.10.2026) */
        new("bildirim.topluEsik", "bildirim", "Kuyruğa alma eşiği",
            "Bir işlemde bu sayıdan fazla kişiye bildirim gidecekse (ör. Biçen Kart toplu yükleme) bildirimler bir anda değil, aşağıdaki hızla sırayla gönderilir. Herkes aynı anda uygulamayı açınca sunucu yavaşlıyordu.",
            "sayi", "50", "kişi", 10, 5000, null, "Biçen Kart toplu yükleme bildirimi"),
        new("bildirim.dakikadaKisi", "bildirim", "Dakikada gönderilecek bildirim",
            "Kuyruktaki bildirimler dakikada bu kadar kişiye gider. 800 kişi / 60 = yaklaşık 14 dakikaya yayılır.",
            "sayi", "60", "kişi", 10, 1000, null, "Bildirim kuyruğu görevi"),

        /* Vardiya ve okutma */
        new("vardiya.sabahSaati", "vardiya", "Sabahçı hatırlatma saati",
            "O gün planı sabahçı olan (ya da planı olmayan, genel merkez) ve henüz okutmamış personele \"vardiya girişi yapılmadı\" bildirimi bu saatte gider. İzinli, raporlu ve haftalık izindeki personele gitmez.",
            "saat", "08:40", null, null, null, null, "Vardiya hatırlatma görevi"),
        new("vardiya.aksamSaati", "vardiya", "Akşamcı hatırlatma saati",
            "O gün planı akşamcı olan ve okutmamış personele bu saatte gider. Genel merkez personeline öğleden sonra bildirim gitmez.",
            "saat", "14:00", null, null, null, null, "Vardiya hatırlatma görevi"),
        new("vardiya.araciSaati", "vardiya", "Aracı hatırlatma saati",
            "O gün planı aracı olan ve okutmamış personele bu saatte gider.",
            "saat", "15:00", null, null, null, null, "Vardiya hatırlatma görevi"),
        new("devamsizlik.yoneticiDakika", "vardiya", "Okutmayan personel: yöneticiye bildirim",
            "Personele \"vardiya girişi yapılmadı\" hatırlatması gittikten bu kadar dakika sonra hâlâ okutmamışsa birim yöneticisine \"vardiya girişini yapmadı, devamsızlıksa işleyin\" bildirimi gider. 0 yazılırsa yöneticiye bildirim gitmez.",
            "sayi", "30", "dakika", 0, 240, null, "Vardiya hatırlatma görevi"),
        new("devamsizlik.geriGun", "vardiya", "Devamsızlık girişi: geriye gün",
            "Birim yöneticisi Biçen360'tan en fazla kaç gün öncesine devamsızlık girebilir.",
            "sayi", "7", "gün", 1, 60, null, "Biçen360 › Devamsızlık"),
        new("devamsizlik.ikEsik", "vardiya", "Devamsızlık: İK listesine düşme",
            "Seçilen dönemde bu sayıdan FAZLA gün devamsızlığı girilen personel İK panelinde Personel Talepleri › Devamsızlık listesinde öne çıkar.",
            "sayi", "3", "gün", 0, 31, null, "Personel Talepleri › Devamsızlık"),
        new("devamsizlik.mesaj", "vardiya", "Devamsızlık bildirimi metni",
            "İK'nın personele gönderdiği uygulama bildirimi ve SMS metni. {ad} personelin adı, {tarihler} devamsız günler.",
            "metin", "Sayın {ad}, {tarihler} tarihlerinde devamsızlığınız bulunmaktadır. Yöneticiniz ile görüşerek durumu belirtiniz ya da İnsan Kaynakları ile iletişime geçiniz. Biçen İnsan Kaynakları", null, null, null, null, "Personel Talepleri › Devamsızlık"),
        new("vardiya.otomatikGonderDakika", "vardiya", "Vardiya planı otomatik gönderimi",
            "Yönetici \"Planı gönder\"e basmayı unutursa, haftanın 7 günü dolu (haftalık izin dahil) ve bu kadar dakikadır değişmeyen taslak/değişmiş plan kendiliğinden gönderilir; personele bildirim gider. 0 yazılırsa kapalı. Bildirim 08:00–22:00 arasında gider.",
            "sayi", "30", "dakika", 0, 1440, null, "Vardiya planı otomatik gönderim görevi"),
        new("okutma.hedefOran", "vardiya", "Okutma hedefi",
            "Günlük okutma raporunda yeşil/kırmızı sınırı.", "sayi", "90", "%", 1, 100, null, "Okutma raporu e-postası, personel ekranı"),
        new("okutma.kritikSinir", "vardiya", "Kritik okutma oranı",
            "Bu oranın altındaki birimler Biçen360 patron bildiriminde kritik olarak listelenir.",
            "sayi", "70", "%", 1, 100, null, "Patron bildirimi"),
        new("okutma.patronUyariSaati", "vardiya", "Patron okutma uyarısı başlangıcı",
            "Biçen360 patron ekranında düşük okutma uyarısı bu saatten sonra gösterilir.",
            "sayi", "10", "saat", 0, 23, null, "Biçen360 patron ekranı"),

        /* Uyum, çıkış, pusula */
        new("uyum.gecerlilikSaati", "uyum", "Uyum anketi bağlantı süresi",
            "İşe uyum anketi bağlantısının açık kalacağı süre.", "sayi", "72", "saat", 6, 720, null, "İşe uyum anketi"),
        new("cikis.beklemeSaati", "uyum", "Çıkış anketi bekleme süresi",
            "İşten ayrılan personele çıkış anketinin gönderilmesi için en fazla bekleme.", "sayi", "48", "saat", 1, 720, null, "Çıkış anketi görevi"),
        new("cikis.gunlukSinir", "uyum", "Çıkış anketi günlük sınır",
            "Aynı kişiye bir günde en çok kaç çıkış anketi hatırlatması. 0 sınırsız.", "sayi", "3", "adet", 0, 20,
            "CikisAnketi:GunlukSinir", "Çıkış anketi"),
        new("pusula.onayGunu", "uyum", "Pusula onay süresi",
            "Personelin kendisine gönderilen pusulayı inceleyip onaylaması için verilen süre.", "sayi", "7", "gün", 1, 60, null, "Pusula"),

        /* Biçen360 daveti */
        new("davet.enFazlaGun", "mobil", "Davet geriye bakış",
            "Uygulamayı kurmayan personele en fazla kaç günlük davet gönderilir.", "sayi", "7", "gün", 1, 60, null, "Kurulum daveti"),
        new("davet.baslangicSaat", "mobil", "Davet SMS'i en erken", "SMS bu saatten önce gönderilmez.",
            "sayi", "9", "saat", 0, 23, null, "Kurulum daveti"),
        new("davet.bitisSaat", "mobil", "Davet SMS'i en geç", "SMS bu saatten sonra gönderilmez.",
            "sayi", "20", "saat", 1, 24, null, "Kurulum daveti"),

        /* Biçen360 güncelleme (08.10.2026) */
        new("uygulama.guncelSurum", "mobil", "Mağazadaki güncel sürüm",
            "Play Store ve App Store'da yayında olan son sürüm. Bundan eski sürümü kullanan personele güncelleme hatırlatması gider. Yeni sürüm iki mağazada da yayına girdiğinde değiştirin.",
            "surum", "1.6", null, null, null, null, "Güncelleme hatırlatması, Uygulama sürümleri"),
        new("uygulama.enDusukSurum", "mobil", "En düşük kullanılabilir sürüm",
            "1.7 ve sonrasında: bundan eski sürümle uygulama açılmaz, önce güncelleme ister. 1.6 ve öncesinde etkisi yok.",
            "surum", "1.0", null, null, null, null, "Uygulama açılışı (1.7+)"),
        new("uygulama.hatirlatma", "mobil", "Güncelleme hatırlatması",
            "Eski sürümü kullanan personele bildirim ve \"Uygulamayı güncelle\" bağlantılı duyuru gönderilir.",
            "evethayir", "true", null, null, null, null, "Güncelleme hatırlatması"),
        new("uygulama.hatirlatmaSaati", "mobil", "Hatırlatma saati",
            "Hatırlatma bu saatten sonra gider (pazar hariç, 20:00'ye kadar).", "saat", "11:00", null, null, null, null, "Güncelleme hatırlatması"),
        new("uygulama.hatirlatmaAraligi", "mobil", "Hatırlatma aralığı",
            "Güncellemeyen personele kaç günde bir hatırlatılır.", "sayi", "3", "gün", 1, 30, null, "Güncelleme hatırlatması"),
        new("uygulama.hatirlatmaSayisi", "mobil", "En fazla hatırlatma",
            "Aynı sürüm için bir kişiye en fazla kaç hatırlatma gider.", "sayi", "5", "adet", 1, 20, null, "Güncelleme hatırlatması"),

        /* Otomatik görevler */
        new("gorev.baslangicSaat", "gorev", "Görevler en erken",
            "İzin otomatik onayı ve mazeret belgesi bildirimleri bu saatten önce çalışmaz.",
            "sayi", "8", "saat", 0, 23, null, "İzin otomatik onay, mazeret belgesi"),
        new("gorev.bitisSaat", "gorev", "Görevler en geç",
            "Bu saatten sonra çalışmaz (gece bildirim gitmez).", "sayi", "21", "saat", 1, 24, null, "İzin otomatik onay, mazeret belgesi"),
    };

    private static readonly Dictionary<string, Tanim> TanimSozlugu =
        Tanimlar.ToDictionary(x => x.Anahtar, StringComparer.OrdinalIgnoreCase);

    private static VeritabaniServisi _vt;
    private static IConfiguration _yapilandirma;
    private static Dictionary<string, string> _degerler = new(StringComparer.OrdinalIgnoreCase);
    private static DateTime _okunma = DateTime.MinValue;
    private static readonly object Kilit = new();

    /// <summary>Program başlarken bir kez</summary>
    public static void Baslat(VeritabaniServisi vt, IConfiguration yapilandirma)
    {
        _vt = vt;
        _yapilandirma = yapilandirma;
    }

    public static Tanim Bul(string anahtar) => TanimSozlugu.TryGetValue(anahtar ?? "", out var t) ? t : null;

    /// <summary>Kaydedilen değerler (60 sn önbellek)</summary>
    public static Dictionary<string, string> Kayitli()
    {
        if (DateTime.Now - _okunma < TimeSpan.FromSeconds(60)) return _degerler;

        lock (Kilit)
        {
            if (DateTime.Now - _okunma < TimeSpan.FromSeconds(60)) return _degerler;

            var yeni = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                if (_vt is not null)
                {
                    using var db = _vt.Baglanti();
                    var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = Anahtar });

                    if (!string.IsNullOrWhiteSpace(ham))
                        foreach (var x in JsonSerializer.Deserialize<Dictionary<string, string>>(ham) ?? new())
                            if (x.Value is not null) yeni[x.Key] = x.Value;
                }
            }
            catch
            {
                /* Okunamazsa önceki değerler (ya da varsayılanlar) */
                yeni = _degerler;
            }

            _degerler = yeni;
            _okunma = DateTime.Now;
            return _degerler;
        }
    }

    public static void OnbellekTemizle() => _okunma = DateTime.MinValue;

    /// <summary>appsettings'teki değer (dizi ise virgülle birleşik)</summary>
    private static string Yapilandirmadan(Tanim t)
    {
        if (t.Yapilandirma is null || _yapilandirma is null) return null;

        try
        {
            var bolum = _yapilandirma.GetSection(t.Yapilandirma);
            if (!string.IsNullOrWhiteSpace(bolum.Value)) return bolum.Value.Trim();

            var dizi = bolum.GetChildren().Select(x => x.Value).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
            return dizi.Count > 0 ? string.Join(",", dizi) : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Kayıt yokken geçerli olan (appsettings ya da varsayılan)</summary>
    public static string Temel(Tanim t) =>
        Yapilandirmadan(t) is string y && Denetle(t, y) is null ? Duzelt(t, y) : t.Varsayilan;

    /// <summary>Kaynakla birlikte geçerli değer: kayit, yapilandirma, varsayilan</summary>
    public static (string Deger, string Kaynak) Gecerli(Tanim t)
    {
        if (Kayitli().TryGetValue(t.Anahtar, out var k) && Denetle(t, k) is null) return (k, "kayit");
        if (Yapilandirmadan(t) is string y && Denetle(t, y) is null) return (y, "yapilandirma");
        return (t.Varsayilan, "varsayilan");
    }

    public static string Metin(string anahtar)
    {
        var t = Bul(anahtar);
        return t is null ? null : Gecerli(t).Deger;
    }

    public static int Sayi(string anahtar)
    {
        var t = Bul(anahtar);
        if (t is null) return 0;
        if (int.TryParse(Gecerli(t).Deger, NumberStyles.Integer, CultureInfo.InvariantCulture, out var s)) return s;
        return int.TryParse(t.Varsayilan, out var v) ? v : 0;
    }

    public static bool Acik(string anahtar)
    {
        var t = Bul(anahtar);
        return t is not null && bool.TryParse(Gecerli(t).Deger, out var b) && b;
    }

    public static string[] Saatler(string anahtar) =>
        (Metin(anahtar) ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>Saat aralığında mı (başlangıç dahil, bitiş hariç)</summary>
    public static bool SaatAraliginda(string bas, string bit, DateTime? an = null)
    {
        var saat = (an ?? DateTime.Now).Hour;
        return saat >= Sayi(bas) && saat < Sayi(bit);
    }

    /// <summary>Doğrulama; geçerliyse null, değilse hata metni</summary>
    public static string Denetle(Tanim t, string deger)
    {
        deger = (deger ?? "").Trim();

        switch (t.Tip)
        {
            case "sayi":
                if (!int.TryParse(deger, NumberStyles.Integer, CultureInfo.InvariantCulture, out var s))
                    return $"{t.Ad}: tam sayı giriniz.";
                if (t.Min is int mn && s < mn) return $"{t.Ad}: en az {mn}{(t.Birim is null ? "" : " " + t.Birim)}.";
                if (t.Max is int mx && s > mx) return $"{t.Ad}: en çok {mx}{(t.Birim is null ? "" : " " + t.Birim)}.";
                return null;

            case "evethayir":
                return bool.TryParse(deger, out _) ? null : $"{t.Ad}: açık ya da kapalı seçiniz.";

            case "sicil":
                return deger.Length is >= 1 and <= 20 && deger.All(char.IsLetterOrDigit)
                    ? null
                    : $"{t.Ad}: sicil numarası giriniz.";

            case "saat":
                return TimeSpan.TryParseExact(deger.Length == 4 ? "0" + deger : deger, @"hh\:mm", CultureInfo.InvariantCulture, out var tek)
                       && tek.TotalHours < 24
                    ? null
                    : $"{t.Ad}: SS:dd biçiminde saat yazınız (14:00).";

            case "surum":
                return System.Text.RegularExpressions.Regex.IsMatch(deger, @"^\d{1,3}\.\d{1,3}(\.\d{1,3})?$")
                    ? null
                    : $"{t.Ad}: sürüm numarası yazınız (1.6).";

            case "saatler":
                var p = deger.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                if (p.Length is 0 or > 8) return $"{t.Ad}: 1 ile 8 arasında saat yazınız (08:40,13:10).";
                foreach (var x in p)
                    if (!TimeSpan.TryParseExact(x, @"hh\:mm", CultureInfo.InvariantCulture, out var ts) || ts.TotalHours >= 24)
                        return $"{t.Ad}: \"{x}\" saat değil (SS:dd yazınız).";
                return null;
        }

        return null;
    }

    /// <summary>Saatler tipinde yazımı düzelt (8:40 → 08:40, sıralı)</summary>
    public static string Duzelt(Tanim t, string deger)
    {
        deger = (deger ?? "").Trim();

        if (t.Tip == "saatler")
            return string.Join(",", deger.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(x => x.Length == 4 ? "0" + x : x)
                .Distinct()
                .OrderBy(x => x, StringComparer.Ordinal));

        if (t.Tip == "saat" && deger.Length == 4) return "0" + deger;
        if (t.Tip == "evethayir") return bool.TryParse(deger, out var b) && b ? "true" : "false";
        if (t.Tip == "sayi" && int.TryParse(deger, out var s)) return s.ToString(CultureInfo.InvariantCulture);

        return deger;
    }

    public static string Goster(Tanim t, string deger)
    {
        if (t.Tip == "evethayir") return deger == "true" ? "açık" : "kapalı";
        return t.Birim is null ? deger : $"{deger} {t.Birim}";
    }

    /// <summary>Yalnızca varsayılandan farklı değerleri yazar</summary>
    public static void Yaz(IDictionary<string, string> degerler)
    {
        var json = JsonSerializer.Serialize(degerler);

        using var db = _vt.Baglanti();
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = Anahtar, d = json });

        OnbellekTemizle();
    }
}

/// <summary>
/// Ayarlar Merkezi › Seçenek listeleri (07.10.2026): avans nedenleri, eksik
/// evrak maddeleri, mazeret belgesi türleri, rapor türleri. KRY_AYARLAR,
/// <c>SECENEK_LISTELERI</c>. Liste boşsa ya da okunamazsa koddaki
/// varsayılan geçerli; "Diğer" her listede sonda ve açıklaması zorunlu
/// (14.10.2026: panelden kapatılabilir).
/// </summary>
public static class SecenekListesi
{
    public const string Anahtar = "SECENEK_LISTELERI";
    public const string Diger = "Diğer";

    public sealed class Oge
    {
        public string Ad { get; set; }
        public bool AciklamaZorunlu { get; set; }
        public bool Acik { get; set; } = true;

        /// <summary>Seçilince destekleyici belge istenir (mazeret türleri: raporlu)</summary>
        public bool BelgeGerekli { get; set; }
    }

    public sealed record Tanim(string Kod, string Ad, string Aciklama, string[] Varsayilan, bool DigerVar,
        bool BelgeSutunu = false, string[] VarsayilanBelgeli = null);

    public static readonly Tanim[] Tanimlar =
    {
        new("mazeretTurleri", "Mazeret izni türleri",
            "Personel mazeret izni isterken seçer (Biçen360 1.6). \"Belge istenir\" işaretlenen türde (raporlu) talepten sonra ana sayfadaki karttan belge yükletilir; diğerlerinde yalnızca imzalı form.",
            new[]
            {
                "Hastane / doktor", "Okul işleri", "Resmi daire işleri", "Raporlu", "Ailevi durum",
            }, true, true, new[] { "Raporlu" }),
        /* Belge (09.10.2026): "Belge istenir" işaretli nedende talep, belge
           yüklenene kadar onaya gitmiyor (AvansController, belge durumu). */
        new("avansNedenleri", "Avans talep nedenleri",
            "Personel avans isterken seçer (Biçen360 1.6). Açıklama zorunlu işaretlenenlerde açıklama yazmadan talep gönderilemez. \"Belge istenir\" işaretlenen nedende talep, nedeni gösteren belge (hastane belgesi, fatura, kira sözleşmesi…) yüklenene kadar onaya gitmez.",
            new[]
            {
                "Sağlık giderleri", "Eğitim / okul giderleri", "Kira / konut", "Fatura / borç ödemesi",
                "Düğün / nişan", "Ev eşyası / beyaz eşya", "Araç / ulaşım", "Acil aile ihtiyacı",
            }, true, true, new[]
            {
                "Sağlık giderleri", "Eğitim / okul giderleri", "Kira / konut", "Fatura / borç ödemesi",
                "Düğün / nişan", "Ev eşyası / beyaz eşya", "Araç / ulaşım", "Acil aile ihtiyacı", "Diğer",
            }),
        new("mazeretBelgeleri", "Mazeret belgesi türleri",
            "Mazeret izninde personelin yüklediği belgenin türü.",
            new[] { "Evlilik cüzdanı / belgesi", "Doğum belgesi", "Ölüm belgesi", "Evlat edinme belgesi", "Sağlık raporu" }, true),
        new("raporTurleri", "Rapor türleri",
            "Personel kartında rapor girerken seçilen tür.",
            new[] { "İstirahat raporu", "İş kazası", "Meslek hastalığı", "Analık/Doğum", "Refakat" }, true),
        new("eksik.izin", "Eksik evrak maddeleri · izin",
            "İzin talebinde \"Eksik bildir\" penceresindeki hazır maddeler.",
            new[]
            {
                "İmzalı izin formu yüklenmedi", "Mazeret belgesi (rapor vb.) yüklenmedi",
                "Islak imzalı formun aslı İK'ya ulaşmadı", "Yüklenen evrak okunmuyor / eksik sayfa",
                "Tarih veya izin türü hatalı",
            }, false),
        new("eksik.avans", "Eksik evrak maddeleri · avans", "Avans talebinde \"Eksik bildir\" maddeleri.",
            new[] { "Açıklama yetersiz", "Tutar veya taksit sayısı hatalı", "İmzalı avans formu ulaşmadı" }, false),
        new("eksik.fazlamesai", "Eksik evrak maddeleri · fazla mesai", "Fazla mesaide \"Eksik bildir\" maddeleri.",
            new[] { "Islak imzalı form İK'ya ulaşmadı", "Bölge müdürü imzası eksik", "Çalışan imzası eksik", "Saat veya tarih hatalı" }, false),
        new("eksik.itiraz", "Eksik evrak maddeleri · itiraz", "Puantaj itirazında \"Eksik bildir\" maddeleri.",
            new[] { "Sebep yetersiz", "Saat hatalı", "Yöneticinin onayı / açıklaması gerekli" }, false),
    };

    private static Dictionary<string, List<Oge>> _onbellek;
    private static DateTime _okunma = DateTime.MinValue;
    private static readonly object Kilit = new();
    private static VeritabaniServisi _vt;

    public static void Baslat(VeritabaniServisi vt) => _vt = vt;

    public static Tanim Bul(string kod) =>
        Tanimlar.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

    private static Dictionary<string, List<Oge>> Kayitli()
    {
        if (_onbellek is not null && DateTime.Now - _okunma < TimeSpan.FromSeconds(60)) return _onbellek;

        lock (Kilit)
        {
            var yeni = new Dictionary<string, List<Oge>>(StringComparer.OrdinalIgnoreCase);

            try
            {
                if (_vt is not null)
                {
                    using var db = _vt.Baglanti();
                    var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = Anahtar });

                    if (!string.IsNullOrWhiteSpace(ham))
                        foreach (var x in JsonSerializer.Deserialize<Dictionary<string, List<Oge>>>(ham,
                                     new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new())
                            yeni[x.Key] = x.Value ?? new();
                }
            }
            catch
            {
                yeni = _onbellek ?? yeni;
            }

            _onbellek = yeni;
            _okunma = DateTime.Now;
            return _onbellek;
        }
    }

    public static void OnbellekTemizle() => _okunma = DateTime.MinValue;

    /// <summary>Tüm öğeler (kapalılar dahil); "Diğer" sonda</summary>
    public static List<Oge> Tumu(string kod)
    {
        var t = Bul(kod);
        if (t is null) return new();

        var liste = Kayitli().TryGetValue(t.Kod, out var k) && k.Count > 0
            ? k.Where(x => !string.IsNullOrWhiteSpace(x?.Ad))
                .Select(x => new Oge { Ad = x.Ad.Trim(), AciklamaZorunlu = x.AciklamaZorunlu, Acik = x.Acik, BelgeGerekli = x.BelgeGerekli })
                .ToList()
            : t.Varsayilan.Select(x => new Oge { Ad = x, BelgeGerekli = t.VarsayilanBelgeli?.Contains(x) == true }).ToList();

        /* "Diğer" (14.10.2026): panelden kapatılabiliyor; kayıtta yoksa açık */
        var kayitliDiger = liste.FirstOrDefault(x => string.Equals(x.Ad, Diger, StringComparison.OrdinalIgnoreCase));
        liste.RemoveAll(x => string.Equals(x.Ad, Diger, StringComparison.OrdinalIgnoreCase));
        if (t.DigerVar) liste.Add(new Oge
        {
            Ad = Diger, AciklamaZorunlu = true, Acik = kayitliDiger?.Acik ?? true,
            /* "Diğer"in belge şartı tanımdan (avans: var); panelden değişmiyor */
            BelgeGerekli = t.VarsayilanBelgeli?.Contains(Diger) == true,
        });

        return liste;
    }

    /// <summary>Seçilebilir adlar</summary>
    public static string[] Acik(string kod) => Tumu(kod).Where(x => x.Acik).Select(x => x.Ad).ToArray();

    /// <summary>Açıklaması zorunlu olanlar</summary>
    public static string[] AciklamaZorunlu(string kod) =>
        Tumu(kod).Where(x => x.Acik && x.AciklamaZorunlu).Select(x => x.Ad).ToArray();

    /// <summary>Kayıtlı listeler (düzenleme için kopya; kaydedilmemiş liste yoksa yazılmaz)</summary>
    public static Dictionary<string, List<Oge>> TanimlarSozluk() =>
        new(Kayitli().ToDictionary(x => x.Key, x => x.Value), StringComparer.OrdinalIgnoreCase);

    public static Dictionary<string, List<Oge>> TumListeler() =>
        Tanimlar.ToDictionary(x => x.Kod, x => Tumu(x.Kod));

    public static void Yaz(Dictionary<string, List<Oge>> listeler)
    {
        var json = JsonSerializer.Serialize(listeler, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        using var db = _vt.Baglanti();
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = Anahtar, d = json });

        OnbellekTemizle();
    }
}

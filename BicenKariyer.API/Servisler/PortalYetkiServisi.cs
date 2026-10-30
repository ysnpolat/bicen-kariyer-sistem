using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Portal (Biçen360) mobil yetkilerini okur.
///
/// <para>
/// Yetkiler <c>B360_YETKI</c> tablosunda duruyor ve iki servis de aynı
/// veritabanına bağlı. Kariyer tarafındaki bazı akışlar — haftalık izin
/// onayı gibi — portal yetki ekranından yönetilebilmeli; aynı yetkiyi iki
/// ayrı ekranda tutmak, birini güncelleyip diğerini unutmaya açık.
/// </para>
///
/// <para>
/// Çözüm sırası portaldakiyle aynı: kişi → ünvan → ünvanın grubu. Hiçbir
/// satır yoksa <c>null</c> dönüyor; çağıran taraf o zaman kendi eski
/// kuralına düşüyor. "Tanımsız" ile "kapalı" farklı: tanımsız bırakılan
/// bir yetkiyi kapalı saymak, bugün çalışan akışları sessizce durdururdu.
/// </para>
///
/// <para>
/// Eşleştirme sadeleştirilmiş anahtarla: ünvan adındaki boşluk, noktalama
/// ve Türkçe harf farkları yüzünden tam metin karşılaştırması tutmuyordu.
/// </para>
/// </summary>
public class PortalYetkiServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PortalYetkiServisi> _kayit;

    public PortalYetkiServisi(VeritabaniServisi vt, ILogger<PortalYetkiServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>
    /// Tanımsızken KAPALI sayılan modüller (23.10.2026): bundan sonra
    /// eklenen modüller grubuna ya da kişiye açıkça verilene kadar kimsede
    /// görünmez. Biçen360 Katalog'daki VarsayilanAcik = false ile aynı liste.
    /// </summary>
    public static readonly HashSet<string> VarsayilanKapali =
        new(StringComparer.OrdinalIgnoreCase) { "mesajlar", "devamsizlik" };

    /// <summary>Modül bu kişide açık mı; tanımsızsa modülün varsayılanı.</summary>
    public bool AcikMi(string sicil, string pozisyon, string kod) =>
        /* İK panelinde hesabı olan kişi mesajlarını telefonda da görür (23.10.2026) */
        (string.Equals(kod, "mesajlar", StringComparison.OrdinalIgnoreCase) && PanelHesabiVar(sicil))
        || (Acik(sicil, pozisyon, kod) ?? !VarsayilanKapali.Contains(kod));

    /// <summary>Sicile bağlı aktif İK panel kullanıcısı var mı</summary>
    public bool PanelHesabiVar(string sicil)
    {
        var k = (sicil ?? "").Trim().TrimStart('0');
        if (k.Length == 0) return false;
        try
        {
            using var db = _vt.Baglanti();
            return db.Query<string>("SELECT sicil FROM KRY_KULLANICILAR WHERE aktif = 1 AND sicil IS NOT NULL")
                .Any(x => (x ?? "").Trim().TrimStart('0') == k);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Bir mobil yetki kodu bu personelde açık mı.
    ///
    /// Tanımlı satır yoksa <c>null</c> döner.
    /// </summary>
    public bool? Acik(string sicil, string pozisyon, string kod)
    {
        try
        {
            using var db = _vt.Baglanti();

            var satirlar = db.Query(@"
SELECT kapsam, anahtar, kod, izin
FROM B360_YETKI
WHERE alan = N'mobil' AND kod = @kod", new { kod }).ToList();

            if (satirlar.Count == 0) return null;

            /* İki katman: kişi → grup. Ünvan satırları artık okunmuyor;
               yetki grupta tanımlanıyor, kişiye özel satır istisna. Aynı
               pozisyona üç ayrı yerden yetki verilebilmesi hangisinin
               geçtiğini belirsiz bırakıyordu. Portal tarafında da aynı. */
            var kisi = Bul(satirlar, "kullanici", sicil);

            if (kisi is not null) return kisi;

            return Bul(satirlar, "grup", GrupBul(db, pozisyon));
        }
        catch (Exception hata)
        {
            /* Tablo yoksa ya da portal kurulmamışsa yetki yok sayılıyor ve
               çağıran taraf eski kuralına dönüyor; İK akışları portal
               yüzünden durmamalı. */
            _kayit.LogWarning(hata, "Portal yetkisi okunamadı: {Kod}", kod);

            return null;
        }
    }

    /// <summary>
    /// Bu personelde açık olan mobil modül kodları.
    ///
    /// <para>
    /// Çözüm sırası kişi → grup; hiçbiri tanımlı değilse modül
    /// açık sayılıyor. Kapalı saymak, yetki ekranına hiç girilmemiş bir
    /// kurumda bütün modülleri kapatırdı.
    /// </para>
    ///
    /// <para>
    /// Portal tablosu okunamazsa <c>null</c> dönüyor ve çağıran taraf
    /// kendi eski kuralına düşüyor: portal yüzünden mobil menü boş
    /// kalmamalı.
    /// </para>
    /// </summary>
    public HashSet<string> AcikModuller(string sicil, string pozisyon,
                                        IEnumerable<string> kodlar)
    {
        var hepsi = (kodlar ?? Enumerable.Empty<string>()).ToList();

        try
        {
            using var db = _vt.Baglanti();

            var satirlar = db.Query(@"
SELECT kapsam, anahtar, kod, izin FROM B360_YETKI WHERE alan = N'mobil'")
                .ToList();

            var grup = GrupBul(db, pozisyon);

            var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var kod in hepsi)
            {
                var kodun = satirlar
                    .Where(x => string.Equals((string)x.kod, kod, StringComparison.OrdinalIgnoreCase))
                    .ToList();

                var karar = Bul(kodun, "kullanici", sicil)
                         ?? Bul(kodun, "grup", grup)
                         ?? !VarsayilanKapali.Contains(kod);

                if (karar) sonuc.Add(kod);
            }

            return sonuc;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Portal mobil yetkileri okunamadı");

            return null;
        }
    }

    /// <summary>
    /// Alt menüde görünecek modüller; ayar portalda tutuluyor.
    ///
    /// Okunamazsa <c>null</c> dönüyor ve çağıran taraf varsayılanı
    /// kullanıyor.
    /// </summary>
    public List<string> AltMenu()
    {
        try
        {
            using var db = _vt.Baglanti();

            var ham = db.ExecuteScalar<string>(
                "SELECT deger FROM B360_AYAR WHERE anahtar = 'mobilAltMenu'");

            if (string.IsNullOrWhiteSpace(ham)) return null;

            var liste = System.Text.Json.JsonSerializer
                .Deserialize<List<string>>(ham);

            return liste is { Count: > 0 } ? liste : null;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Alt menü ayarı okunamadı");

            return null;
        }
    }

    /* ================================================================== */
    /* Grup ayarları                                                      */
    /* ================================================================== */

    /// <summary>
    /// Portaldaki grup ayarı (B360_GRUP_AYAR). Alan adları portaldakiyle
    /// aynı; JSON biçimi iki tarafta ortak.
    /// </summary>
    public class GrupAyari
    {
        public List<int> SorumluGruplar { get; set; } = new();
        public string ArizaKapsami { get; set; }
        public string EnvanterKapsami { get; set; }
        public List<int> Departmanlar { get; set; } = new();
        public bool HaftalikIzinOnay { get; set; }
        public string YillikIzinKademe { get; set; }
    }

    private static readonly System.Text.Json.JsonSerializerOptions JSON = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    /// <summary>Ünvanın bağlı olduğu grubun kimliği; yoksa <c>null</c>.</summary>
    public int? GrupKimligi(string pozisyon)
    {
        if (string.IsNullOrWhiteSpace(pozisyon)) return null;

        var hedef = Anahtar(pozisyon);

        try
        {
            using var db = _vt.Baglanti();

            foreach (var g in db.Query(@"
SELECT id, pozisyonlar FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad"))
            {
                var uyuyor = ((string)g.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Any(x => Anahtar(x) == hedef);

                if (uyuyor) return (int)g.id;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Grup kimliği okunamadı");
        }

        return null;
    }

    /// <summary>
    /// Kişinin grubunun ayarı; grup ya da ayar yoksa <c>null</c>.
    ///
    /// <c>null</c> "eski kural geçerli" demek: ayar ekranına hiç girilmemiş
    /// bir grubun davranışı değişmemeli.
    /// </summary>
    public GrupAyari Ayar(string pozisyon)
    {
        var id = GrupKimligi(pozisyon);

        if (id is null) return null;

        try
        {
            using var db = _vt.Baglanti();

            var ham = db.ExecuteScalar<string>(
                "SELECT ayar FROM B360_GRUP_AYAR WHERE grup_id = @id", new { id });

            return string.IsNullOrWhiteSpace(ham)
                ? null
                : System.Text.Json.JsonSerializer.Deserialize<GrupAyari>(ham, JSON);
        }
        catch (Exception hata)
        {
            /* Tablo yoksa portal henüz yayınlanmamış demektir; eski kural. */
            _kayit.LogWarning(hata, "Grup ayarı okunamadı");

            return null;
        }
    }

    /// <summary>
    /// Talep sahibi bu yöneticinin sorumluluğunda mı: talep sahibinin
    /// grubu yöneticinin sorumlu olduğu gruplardan biri mi.
    /// </summary>
    public bool Sorumlu(GrupAyari yoneticiAyari, string talepSahibiPozisyonu)
    {
        if (yoneticiAyari is null) return false;

        var g = GrupKimligi(talepSahibiPozisyonu);

        return g is not null && yoneticiAyari.SorumluGruplar.Contains(g.Value);
    }

    /// <summary>
    /// Kişinin sorumlu olduğu bölgelerin şubeleri: ad ve kod birlikte.
    /// Bölge ataması yoksa kendi şubesinin bölgesi.
    /// </summary>
    public List<string> BolgeSubeleri(string sicil, string kendiSubesi, FormAyarlari form, string adSoyad = null)
    {
        /* Önce İK panelindeki tanım: bölge müdürünün hesabında seçili
           şubeler (Kullanıcılar ekranı). Asıl kaynak orası; portal ataması
           yalnızca panelde hesabı olmayanlar için. Eskiden yalnızca portal
           atamasına bakılıyordu ve ataması olmayan bölge müdürü puantajda
           mağazaları değil mağaza müdürlerini görüyordu. */
        /* En önce portaldaki bölge tanımı (Yetkiler → Bölgeler) */
        var tanimli = TanimliBolgeSubeleri(sicil);

        if (tanimli.Count > 0) return tanimli;

        var panel = PanelSubeleri(sicil, adSoyad, form);

        if (panel.Count > 0) return panel;

        var bolgeler = new List<string>();

        try
        {
            using var db = _vt.Baglanti();

            bolgeler = db.Query<string>(
                "SELECT bolge FROM B360_KISI_BOLGE WHERE sicil = @sicil",
                new { sicil = (sicil ?? "").Trim() }).ToList();
        }
        catch
        {
            /* Tablo yoksa kendi şubesinin bölgesine düşülüyor */
        }

        var tanimlar = form?.Bolgeler ?? new List<BolgeTanimi>();
        var subeler = form?.Subeler ?? new List<Sube>();

        string AdOf(string kod) =>
            subeler.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad ?? kod;

        if (bolgeler.Count == 0 && !string.IsNullOrWhiteSpace(kendiSubesi))
        {
            var hedef = Anahtar(kendiSubesi);

            var kendi = tanimlar.FirstOrDefault(b => (b.Subeler ?? new List<string>())
                .Any(k => Anahtar(k) == hedef || Anahtar(AdOf(k)) == hedef));

            if (kendi is not null) bolgeler.Add(kendi.Ad);
        }

        var sonuc = new List<string>();

        foreach (var b in tanimlar.Where(x => bolgeler.Contains(x.Ad ?? "", StringComparer.OrdinalIgnoreCase)))
        {
            foreach (var kod in b.Subeler ?? new List<string>())
            {
                sonuc.Add(kod);
                sonuc.Add(AdOf(kod));
            }
        }

        return sonuc.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static (DateTime zaman, List<(string sicil, string sube)> satirlar)? _bolgeBellek;
    private static readonly object _bolgeKilit = new();

    /// <summary>
    /// Portalda tanımlı bölgelerde (Yetkiler → Bölgeler) bu kişinin müdürü
    /// olduğu bölgelerin şubeleri. Şube adları personel kartındaki şube
    /// adıyla birebir; eşleşme sorunu olmuyor. Asıl kaynak burası.
    /// </summary>
    public List<string> TanimliBolgeSubeleri(string sicil)
    {
        List<(string sicil, string sube)> satirlar;

        lock (_bolgeKilit)
        {
            satirlar = _bolgeBellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60)
                ? b.satirlar
                : null;
        }

        if (satirlar is null)
        {
            try
            {
                using var db = _vt.Baglanti();

                satirlar = db.Query(@"
SELECT M.sicil, S.sube
FROM B360_BOLGE_MUDUR M
    INNER JOIN B360_BOLGE B ON B.id = M.bolge_id AND B.aktif = 1
    INNER JOIN B360_BOLGE_SUBE S ON S.bolge_id = M.bolge_id")
                    .Select(x => (((string)x.sicil ?? "").Trim(), ((string)x.sube ?? "").Trim()))
                    .ToList();
            }
            catch
            {
                /* Tablo henüz yoksa (portal güncellenmemiş) tanım yok sayılıyor */
                satirlar = new();
            }

            lock (_bolgeKilit) _bolgeBellek = (DateTime.UtcNow, satirlar);
        }

        var s = (sicil ?? "").Trim().TrimStart('0');

        if (s.Length == 0) return new();

        return satirlar.Where(x => x.sicil.TrimStart('0') == s)
            .Select(x => x.sube)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static (DateTime zaman, List<(string sicil, string kullanici, string ad, string subeler)> hesaplar)? _panelBellek;
    private static readonly object _panelKilit = new();

    /// <summary>
    /// İK panelinde bölge müdürü (ya da koordinatörü) hesabında tanımlı
    /// şubeler: kod ve ad birlikte. Kişi hesabıyla sicil, kullanıcı adı ya
    /// da ad soyad üzerinden eşleşiyor — hesapların çoğunda sicil alanı boş.
    /// </summary>
    public List<string> PanelSubeleri(string sicil, string adSoyad, FormAyarlari form)
    {
        List<(string sicil, string kullanici, string ad, string subeler)> hesaplar;

        lock (_panelKilit)
        {
            hesaplar = _panelBellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60)
                ? b.hesaplar
                : null;
        }

        if (hesaplar is null)
        {
            try
            {
                using var db = _vt.Baglanti();

                hesaplar = db.Query(@"
SELECT sicil, kullanici_adi, ad_soyad, subeler FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN (N'BolgeMuduru', N'BolgeKoordinatoru')
  AND LTRIM(RTRIM(ISNULL(subeler, N''))) <> N''")
                    .Select(x => (
                        ((string)x.sicil ?? "").Trim(),
                        ((string)x.kullanici_adi ?? "").Trim(),
                        ((string)x.ad_soyad ?? "").Trim(),
                        ((string)x.subeler ?? "").Trim()))
                    .ToList();
            }
            catch
            {
                hesaplar = new();
            }

            lock (_panelKilit) _panelBellek = (DateTime.UtcNow, hesaplar);
        }

        var s = (sicil ?? "").Trim().TrimStart('0');
        var a = Anahtar(adSoyad ?? "");

        var hesap = hesaplar.FirstOrDefault(h =>
            (s.Length > 0 && (h.sicil.TrimStart('0') == s || h.kullanici.TrimStart('0') == s))
            || (a.Length > 3 && Anahtar(h.ad) == a));

        if (string.IsNullOrWhiteSpace(hesap.subeler)) return new();

        var tanim = form?.Subeler ?? new List<Sube>();

        var sonuc = new List<string>();

        foreach (var kod in hesap.subeler.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim()))
        {
            sonuc.Add(kod);

            var ad = tanim.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad;
            if (!string.IsNullOrWhiteSpace(ad)) sonuc.Add(ad);
        }

        return sonuc.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /* ================================================================== */
    /* İK panelindeki bölge müdürü hesapları (04.10.2026)                 */
    /* ================================================================== */

    /// <summary>İK panelindeki bölge müdürü hesabı ve Mikro'daki karşılığı.</summary>
    public sealed record PanelBolgeMuduru(
        int HesapId, string HesapAdi, string AdSoyad, string Bolge,
        List<string> Subeler, PersonelKaydi Kisi, string Eslesme);

    private static (DateTime zaman, List<PanelBolgeMuduru> liste)? _panelBmBellek;
    private static readonly object _panelBmKilit = new();

    public static void PanelBolgeMudurleriniUnut()
    {
        lock (_panelBmKilit) _panelBmBellek = null;
    }

    private static string TelefonAnahtari(string t)
    {
        var r = new string((t ?? "").Where(char.IsDigit).ToArray());
        return r.Length >= 10 ? r[^10..] : "";
    }

    /// <summary>
    /// İK panelindeki aktif Bölge Müdürü hesapları, hesapta seçili şubeler
    /// (bölge seçildiyse bölgenin şubeleri; Kullanıcılar ekranı) ve
    /// hesabın Mikro'daki personel kaydı.
    ///
    /// <para>
    /// Hesapta sicil alanı çoğunlukla boş; kişi sırayla sicil, kullanıcı
    /// adının sicil olması, cep telefonu ve ad soyad ile bulunuyor. Bulunamayan
    /// hesap listede <c>Kisi = null</c> ile duruyor: Kullanıcılar ekranı
    /// "Mikro'da eşleşmedi" uyarısını buradan gösteriyor.
    /// </para>
    /// </summary>
    public List<PanelBolgeMuduru> PanelBolgeMudurleri(IEnumerable<PersonelKaydi> personel, FormAyarlari form)
    {
        lock (_panelBmKilit)
        {
            if (_panelBmBellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.liste;
        }

        var sonuc = new List<PanelBolgeMuduru>();

        try
        {
            using var db = _vt.Baglanti();

            var hesaplar = db.Query(@"
SELECT id, kullanici_adi, ad_soyad, telefon, bolge, subeler, sicil
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol = N'BolgeMuduru'").ToList();

            var aktif = (personel ?? Enumerable.Empty<PersonelKaydi>()).Where(x => x.Durum == 1).ToList();
            var tanim = form?.Subeler ?? new List<Sube>();

            foreach (var h in hesaplar)
            {
                string sicil = ((string)h.sicil ?? "").Trim().TrimStart('0');
                string kullanici = ((string)h.kullanici_adi ?? "").Trim().TrimStart('0');
                string tel = TelefonAnahtari((string)h.telefon);
                string ad = Anahtar((string)h.ad_soyad);

                PersonelKaydi kisi = null;
                string eslesme = null;

                if (sicil.Length > 0)
                {
                    kisi = aktif.FirstOrDefault(x => (x.PersonelKodu ?? "").Trim().TrimStart('0') == sicil);
                    if (kisi is not null) eslesme = "sicil";
                }

                if (kisi is null && kullanici.Length > 0 && kullanici.All(char.IsDigit))
                {
                    kisi = aktif.FirstOrDefault(x => (x.PersonelKodu ?? "").Trim().TrimStart('0') == kullanici);
                    if (kisi is not null) eslesme = "kullanıcı adı";
                }

                if (kisi is null && tel.Length == 10)
                {
                    var l = aktif.Where(x => TelefonAnahtari(x.Telefon) == tel).ToList();
                    if (l.Count == 1) { kisi = l[0]; eslesme = "telefon"; }
                }

                if (kisi is null && ad.Length > 3)
                {
                    var l = aktif.Where(x => Anahtar($"{x.Ad} {x.Soyad}") == ad).ToList();
                    if (l.Count == 1) { kisi = l[0]; eslesme = "ad soyad"; }
                }

                var subeler = new List<string>();

                foreach (var kod in ((string)h.subeler ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                             .Select(x => x.Trim()).Where(x => x.Length > 0))
                {
                    subeler.Add(kod);

                    var sAd = tanim.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad;
                    if (!string.IsNullOrWhiteSpace(sAd)) subeler.Add(sAd);
                }

                sonuc.Add(new PanelBolgeMuduru(
                    (int)h.id, ((string)h.kullanici_adi ?? "").Trim(), ((string)h.ad_soyad ?? "").Trim(),
                    ((string)h.bolge ?? "").Trim(),
                    subeler.Distinct(StringComparer.OrdinalIgnoreCase).ToList(), kisi, eslesme));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Panel bölge müdürü hesapları okunamadı");
        }

        lock (_panelBmKilit) _panelBmBellek = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    /// <summary>Şube adı listede var mı; ad/kod ve yazım farkları gözetilmeden.</summary>
    public static bool SubeIcinde(IEnumerable<string> liste, string sube)
    {
        var hedef = Anahtar(sube);

        if (hedef.Length == 0) return false;

        /* Önce tam eşitlik; sonra personel tarafında kullanılan benzerlik
           (numaralı şube serilerini ayırt eden). İK panelindeki şube adı ile
           Mikro'daki iş grubu adı birebir aynı yazılmamış şubeler ("NİLÜFER"
           ile "NİLÜFER ŞUBE" gibi) tam eşitlikle düşüyordu. */
        return liste.Any(x => Anahtar(x) == hedef)
            || liste.Any(x => PersonelKaynagiServisi.Benziyor((x ?? "").Trim(), (sube ?? "").Trim()));
    }

    /// <summary>
    /// İK panelindeki bölge müdürü hesabında seçili şubeler, kod ve ad
    /// çifti olarak. Puantajda eşleşmeyen şubeleri göstermek için.
    /// </summary>
    public List<(string Kod, string Ad)> PanelSubeCiftleri(string sicil, string adSoyad, FormAyarlari form)
    {
        var duz = PanelSubeleri(sicil, adSoyad, form);
        var tanim = form?.Subeler ?? new List<Sube>();

        return duz
            .Where(x => tanim.Any(t => string.Equals(t.Kod, x, StringComparison.OrdinalIgnoreCase))
                        || !tanim.Any(t => string.Equals(t.Ad, x, StringComparison.OrdinalIgnoreCase)))
            .Select(kod => (kod, tanim.FirstOrDefault(t => string.Equals(t.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Ad))
            .ToList();
    }

    private static bool? Bul(List<dynamic> satirlar, string kapsam, string anahtar)
    {
        if (string.IsNullOrWhiteSpace(anahtar)) return null;

        var hedef = Anahtar(anahtar);

        foreach (var s in satirlar)
        {
            if (!string.Equals((string)s.kapsam, kapsam, StringComparison.OrdinalIgnoreCase))
                continue;

            if (Anahtar((string)s.anahtar) == hedef) return (bool)s.izin;
        }

        return null;
    }

    /// <summary>Ünvanın bağlı olduğu pozisyon grubunun adı.</summary>
    private static string GrupBul(System.Data.IDbConnection db, string pozisyon)
    {
        if (string.IsNullOrWhiteSpace(pozisyon)) return null;

        var hedef = Anahtar(pozisyon);

        foreach (var g in db.Query(@"
SELECT ad, pozisyonlar FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad"))
        {
            var uyuyor = ((string)g.pozisyonlar ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Any(x => Anahtar(x) == hedef);

            if (uyuyor) return (string)g.ad;
        }

        return null;
    }

    /// <summary>Karşılaştırma için sadeleştirilmiş anahtar.</summary>
    private static string Anahtar(string metin) =>
        new string((metin ?? "")
            .ToLowerInvariant()
            .Replace('ı', 'i').Replace('ş', 's').Replace('ğ', 'g')
            .Replace('ü', 'u').Replace('ö', 'o').Replace('ç', 'c')
            .Where(char.IsLetterOrDigit)
            .ToArray());
}

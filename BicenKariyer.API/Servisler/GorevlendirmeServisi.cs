using System.Data;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Görevlendirme (26.10.2026): şirketin gönderdiği iş toplantısı, seminer,
/// eğitim, fuar, iş görüşmesi… Şehir içi ya da şehir dışı.
///
/// <para>
/// Personel Biçen360'tan (İzin Yönetimi › Görevlendirme) gidiş ve dönüş
/// tarihiyle girer; açıklama zorunlu. Onay süreci İK paneli › İzin
/// Yönetimi › Görevlendirme'den kurulur: onay hiç istenmeyebilir (kayıt
/// bilgi amaçlı, hemen onaylı) ya da birim yöneticisi / üst onay (bölge
/// müdürü, GMY) / İK adımları seçilir. Kişi adımları izin zincirinden
/// (<see cref="IzinOnayZinciri"/>, avans onay tablosu) geliyor; şube
/// personelinde GMY adımı orada zaten atlanıyor.
/// </para>
///
/// <para>
/// Onaylı görevlendirme günü geçiş raporunda "Görevde" sayılır (okutmadı
/// diye devamsız görünmez) ve o güne devamsızlık girilemez.
/// </para>
///
/// <para>
/// Onay bekleyenler mobil İzin Onayları listesine eksi kimlikle
/// (<see cref="MobilKimlik"/>) eklenir: yayındaki sürümler de izin
/// kartıyla gösterip onaylayabilir; karar /api/IzinTalep/Mobil/{id}/Karar
/// üzerinden buraya yönlenir.
/// </para>
/// </summary>
public class GorevlendirmeServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinOnayZinciri _zincir;
    private readonly AvansOnayZinciri _avans;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<GorevlendirmeServisi> _kayit;

    public GorevlendirmeServisi(VeritabaniServisi vt, IzinOnayZinciri zincir, AvansOnayZinciri avans,
        BildirimServisi bildirim, ILogger<GorevlendirmeServisi> kayit)
    {
        _vt = vt;
        _zincir = zincir;
        _avans = avans;
        _bildirim = bildirim;
        _kayit = kayit;
    }

    public const string Bekliyor = "bekliyor";
    public const string Onaylandi = "onaylandi";
    public const string Reddedildi = "reddedildi";
    public const string Iptal = "iptal";

    public const string SehirIci = "sehir_ici";
    public const string SehirDisi = "sehir_disi";

    public const string AyarAnahtari = "GOREVLENDIRME_AYAR";

    public static readonly List<string> VarsayilanTurler = new()
    {
        "İş görüşmesi", "Toplantı", "Seminer / konferans", "Eğitim", "Fuar", "Denetim / ziyaret", "Diğer",
    };

    /* ------------------------------------------------------- mobil kimlik */

    /// <summary>Mobil İzin Onayları listesinde görevlendirme kimliği: -(1.500.000.000 + id)</summary>
    public const int MobilTaban = 1_500_000_000;

    public static int MobilKimlik(int id) => -(MobilTaban + id);

    public static int? KayitKimligi(int mobilKimlik) =>
        mobilKimlik <= -MobilTaban ? (int)(-(long)mobilKimlik - MobilTaban) : null;

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /* -------------------------------------------------------------- ayar */

    public sealed class Ayar
    {
        /// <summary>Modül açık mı (kapalıysa mobilde görünmez)</summary>
        public bool Acik { get; set; } = true;

        /// <summary>Onay istenmiyorsa kayıt hemen onaylı (bilgi amaçlı)</summary>
        public bool OnayGerekli { get; set; } = true;

        /// <summary>Birim yöneticisi (zincirin ilk kişi adımı)</summary>
        public bool YoneticiOnayi { get; set; } = true;

        /// <summary>Üst onay: zincirin diğer kişi adımları (bölge müdürü, GMY)</summary>
        public bool UstOnay { get; set; }

        /// <summary>İnsan Kaynakları son onayı</summary>
        public bool IkOnayi { get; set; } = true;

        /// <summary>hepsi · merkez · secili</summary>
        public string Kapsam { get; set; } = "hepsi";

        /// <summary>Kapsam "secili" ise girebilecek birimler (iş grubu)</summary>
        public List<string> Birimler { get; set; } = new();

        public List<string> Turler { get; set; } = new(VarsayilanTurler);

        /// <summary>Geçmişe dönük giriş sınırı (gün)</summary>
        public int GeriGun { get; set; } = 7;

        /// <summary>Bir görevlendirmenin en uzun süresi (gün)</summary>
        public int EnUzunGun { get; set; } = 30;

        /// <summary>Onay istenmese de İK'ya bilgi bildirimi</summary>
        public bool IkBilgi { get; set; } = true;
    }

    private static readonly JsonSerializerOptions Secenek = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public Ayar AyarOku()
    {
        try
        {
            using var db = _vt.Baglanti();
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = AyarAnahtari });
            var a = string.IsNullOrWhiteSpace(ham) ? new Ayar() : JsonSerializer.Deserialize<Ayar>(ham, Secenek) ?? new Ayar();
            return Duzelt(a);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Görevlendirme ayarı okunamadı");
            return new Ayar();
        }
    }

    public static Ayar Duzelt(Ayar a)
    {
        a ??= new Ayar();
        if (a.Kapsam is not ("hepsi" or "merkez" or "secili")) a.Kapsam = "hepsi";
        a.Birimler = Temiz(a.Birimler);
        a.Turler = Temiz(a.Turler).Select(x => x.Length > 60 ? x[..60] : x).Take(30).ToList();
        if (a.Turler.Count == 0) a.Turler = new(VarsayilanTurler);
        a.GeriGun = Math.Clamp(a.GeriGun, 0, 60);
        a.EnUzunGun = Math.Clamp(a.EnUzunGun, 1, 180);
        /* Onay isteniyor ama adım seçilmemişse İK onaylar: talep sahipsiz kalmasın */
        if (a.OnayGerekli && !a.YoneticiOnayi && !a.UstOnay && !a.IkOnayi) a.IkOnayi = true;
        return a;
    }

    private static List<string> Temiz(List<string> l) =>
        (l ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public void AyarYaz(Ayar a)
    {
        var json = JsonSerializer.Serialize(Duzelt(a), Secenek);
        using var db = _vt.Baglanti();
        db.Execute(@"
IF EXISTS (SELECT 1 FROM KRY_AYARLAR WHERE anahtar = @a)
    UPDATE KRY_AYARLAR SET deger = @d, guncelleme = SYSDATETIME() WHERE anahtar = @a
ELSE
    INSERT INTO KRY_AYARLAR (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME())", new { a = AyarAnahtari, d = json });
    }

    /* ------------------------------------------------------------- tablo */

    private static bool _kuruldu;
    private static readonly object Kilit = new();

    public void Kur()
    {
        if (_kuruldu) return;
        lock (Kilit)
        {
            if (_kuruldu) return;
            using var db = _vt.Baglanti();
            db.Execute(@"
IF OBJECT_ID('KRY_GOREVLENDIRME') IS NULL
CREATE TABLE KRY_GOREVLENDIRME (
    id             INT IDENTITY(1,1) PRIMARY KEY,
    personel_kodu  NVARCHAR(25)   NOT NULL,
    ad_soyad       NVARCHAR(120)  NULL,
    birim          NVARCHAR(120)  NULL,
    pozisyon       NVARCHAR(120)  NULL,
    kapsam         NVARCHAR(20)   NOT NULL,
    etkinlik_turu  NVARCHAR(60)   NOT NULL,
    etkinlik_adi   NVARCHAR(200)  NOT NULL,
    yer            NVARCHAR(150)  NOT NULL,
    gidis          DATE           NOT NULL,
    donus          DATE           NOT NULL,
    aciklama       NVARCHAR(1000) NOT NULL,
    durum          NVARCHAR(20)   NOT NULL,
    zincir         NVARCHAR(MAX)  NULL,
    asama          INT            NOT NULL DEFAULT 0,
    karar_kisi     NVARCHAR(120)  NULL,
    karar_not      NVARCHAR(500)  NULL,
    karar_tarih    DATETIME2      NULL,
    kaynak         NVARCHAR(20)   NOT NULL DEFAULT N'uygulama',
    olusturma      DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    guncelleme     DATETIME2      NULL
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_GOREVLENDIRME_KISI' AND object_id = OBJECT_ID('KRY_GOREVLENDIRME'))
    CREATE INDEX IX_KRY_GOREVLENDIRME_KISI ON KRY_GOREVLENDIRME (personel_kodu, gidis);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_KRY_GOREVLENDIRME_TARIH' AND object_id = OBJECT_ID('KRY_GOREVLENDIRME'))
    CREATE INDEX IX_KRY_GOREVLENDIRME_TARIH ON KRY_GOREVLENDIRME (durum, gidis, donus);");
            _kuruldu = true;
        }
    }

    /* ----------------------------------------------------------- kapsam */

    public bool MerkezMi(PersonelKaydi p) =>
        PersonelKaynagiServisi.MeslekAnahtari(_avans.IsYeri(p?.IsGrubu) ?? "")
        != PersonelKaynagiServisi.MeslekAnahtari(AvansOnayZinciri.Sube);

    /// <summary>Kişi görevlendirme girebilir mi; giremiyorsa neden</summary>
    public (bool Girebilir, string Neden) Girebilir(Ayar a, PersonelKaydi p)
    {
        if (!a.Acik) return (false, "Görevlendirme girişi kapalı.");
        if (p is null) return (false, "Personel kaydınız bulunamadı.");

        return a.Kapsam switch
        {
            "merkez" when !MerkezMi(p) => (false, "Görevlendirme girişi yalnız genel merkez personeline açık."),
            "secili" when !a.Birimler.Contains((p.IsGrubu ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
                => (false, "Biriminiz için görevlendirme girişi açık değil."),
            _ => (true, null),
        };
    }

    /* ------------------------------------------------------------ zincir */

    /// <summary>
    /// Ayara göre zincir. Onay istenmiyorsa ya da bütün adımlar atlanıyorsa
    /// null (kayıt hemen onaylı). İzin zinciri kurulamıyorsa (kişinin
    /// iş yeri + pozisyonu onay tablosunda yok) kişi adımları olmadan İK.
    /// </summary>
    public IzinOnayZinciri.Zincir ZincirKur(Ayar a, PersonelKaydi p)
    {
        if (!a.OnayGerekli) return null;

        var tam = _zincir.Olustur(p);
        var z = new IzinOnayZinciri.Zincir
        {
            Kural = tam?.Kural ?? "Görevlendirme",
            IsYeri = tam?.IsYeri,
            Capraz = tam?.Capraz ?? false,
            SubeKurali = tam?.SubeKurali ?? false,
        };

        var kisiler = (tam?.Adimlar ?? new()).Where(x => x.Tur == IzinOnayZinciri.TurKisi).ToList();
        for (var i = 0; i < kisiler.Count; i++)
            if (i == 0 ? a.YoneticiOnayi : a.UstOnay) z.Adimlar.Add(kisiler[i]);

        /* İK adımı: seçiliyse ya da kişi adımı kurulamadıysa (talep sahipsiz kalmasın) */
        if (a.IkOnayi || z.Adimlar.Count == 0)
            z.Adimlar.Add(new IzinOnayZinciri.Adim
            {
                Ad = AvansOnayZinciri.IkAdi,
                Tur = IzinOnayZinciri.TurIk,
                Onay = AvansOnayZinciri.Ik,
                Roller = new() { Roller.IK, Roller.IKYoneticisi },
            });

        return z;
    }

    /* ------------------------------------------------------------- okuma */

    public sealed class Kayit
    {
        public int Id { get; set; }
        public string PersonelKodu { get; set; }
        public string AdSoyad { get; set; }
        public string Birim { get; set; }
        public string Pozisyon { get; set; }
        public string Kapsam { get; set; }
        public string EtkinlikTuru { get; set; }
        public string EtkinlikAdi { get; set; }
        public string Yer { get; set; }
        public DateTime Gidis { get; set; }
        public DateTime Donus { get; set; }
        public string Aciklama { get; set; }
        public string Durum { get; set; }
        public string Zincir { get; set; }
        public int Asama { get; set; }
        public string KararKisi { get; set; }
        public string KararNot { get; set; }
        public DateTime? KararTarih { get; set; }
        public string Kaynak { get; set; }
        public DateTime Olusturma { get; set; }

        public int Gun => (Donus.Date - Gidis.Date).Days + 1;
    }

    public const string Secim = @"
SELECT id AS Id, personel_kodu AS PersonelKodu, ad_soyad AS AdSoyad, birim AS Birim, pozisyon AS Pozisyon,
       kapsam AS Kapsam, etkinlik_turu AS EtkinlikTuru, etkinlik_adi AS EtkinlikAdi, yer AS Yer,
       gidis AS Gidis, donus AS Donus, aciklama AS Aciklama, durum AS Durum, zincir AS Zincir, asama AS Asama,
       karar_kisi AS KararKisi, karar_not AS KararNot, karar_tarih AS KararTarih, kaynak AS Kaynak, olusturma AS Olusturma
FROM KRY_GOREVLENDIRME";

    public Kayit Getir(IDbConnection db, int id) =>
        db.QueryFirstOrDefault<Kayit>(Secim + " WHERE id = @id", new { id });

    public static string KapsamAdi(string k) => k == SehirDisi ? "Şehir dışı" : "Şehir içi";

    public static string DurumAdi(string d) => d switch
    {
        Onaylandi => "Onaylandı",
        Reddedildi => "Reddedildi",
        Iptal => "İptal edildi",
        _ => "Onay bekliyor",
    };

    public static IzinOnayZinciri.Zincir ZincirOku(Kayit k) => IzinOnayZinciri.Oku(k?.Zincir);

    /// <summary>Şu an kimde: "Mağaza Müdürü onayında"</summary>
    public static string Kimde(Kayit k)
    {
        if (k.Durum != Bekliyor) return null;
        var z = ZincirOku(k);
        return z is null ? null : $"{IzinOnayZinciri.AdimAl(z, k.Asama).Ad} onayında";
    }

    /// <summary>
    /// Belirli bir gün onaylı görevlendirmede olanlar (sicil baştaki
    /// sıfırsız → "İstanbul · Seminer"). Tablo yoksa boş.
    /// </summary>
    public static Dictionary<string, string> Gorevdekiler(IDbConnection db, DateTime bas, DateTime bit)
    {
        var s = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            if (db.ExecuteScalar<int>("SELECT CASE WHEN OBJECT_ID('KRY_GOREVLENDIRME') IS NULL THEN 0 ELSE 1 END") == 0) return s;

            foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, yer, etkinlik_turu AS tur
FROM KRY_GOREVLENDIRME
WHERE durum = @d AND gidis <= @bit AND donus >= @bas", new { d = Onaylandi, bas = bas.Date, bit = bit.Date }))
                s[K((string)r.kod)] = $"{r.yer} · {r.tur}";
        }
        catch
        {
            /* geçiş raporu görevlendirme olmadan da çalışır */
        }
        return s;
    }

    /// <summary>Kişinin günleri arasından onaylı görevde olunanlar</summary>
    public static List<DateTime> GorevGunleri(IDbConnection db, string kod, IEnumerable<DateTime> gunler)
    {
        var l = gunler.Select(x => x.Date).Distinct().ToList();
        if (l.Count == 0) return new();
        try
        {
            if (db.ExecuteScalar<int>("SELECT CASE WHEN OBJECT_ID('KRY_GOREVLENDIRME') IS NULL THEN 0 ELSE 1 END") == 0) return new();

            var araliklar = db.Query<(DateTime g, DateTime d)>(@"
SELECT gidis, donus FROM KRY_GOREVLENDIRME
WHERE durum = @d AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND gidis <= @bit AND donus >= @bas",
                new { d = Onaylandi, kod = (kod ?? "").Trim(), kodK = K(kod), bas = l.Min(), bit = l.Max() }).ToList();

            return l.Where(x => araliklar.Any(a => a.g.Date <= x && a.d.Date >= x)).ToList();
        }
        catch
        {
            return new();
        }
    }

    /* ------------------------------------------------------------- karar */

    public sealed class KararSonucu
    {
        public int Kod { get; set; } = 200;
        public string Hata { get; set; }
        public string Mesaj { get; set; }
    }

    /// <summary>
    /// Karar. <paramref name="mobilSicil"/> doluysa Biçen360'tan (bulunduğu
    /// kişi adımının onaylayanı olmalı); boşsa panelden: İK adımında İK
    /// rolleri, her adımda Admin ve GMY.
    /// </summary>
    public async Task<KararSonucu> Karar(int id, bool onay, string not, string kim, string mobilSicil, string panelRol)
    {
        Kur();
        not = (not ?? "").Trim();
        if (not.Length > 500) not = not[..500];
        if (!onay && not.Length < 3) return new() { Kod = 400, Hata = "Reddetme sebebini yazınız; personel bunu görür." };

        using var db = _vt.Baglanti();
        var k = Getir(db, id);
        if (k is null) return new() { Kod = 404, Hata = "Görevlendirme bulunamadı." };
        if (k.Durum != Bekliyor) return new() { Kod = 409, Hata = "Bu görevlendirme artık onay beklemiyor." };

        var z = ZincirOku(k);
        if (z is null) return new() { Kod = 409, Hata = "Görevlendirmenin onay akışı okunamadı." };

        var asama = Math.Clamp(k.Asama, 0, z.Adimlar.Count - 1);
        var adim = IzinOnayZinciri.AdimAl(z, asama);

        bool yetkili;
        if (!string.IsNullOrWhiteSpace(mobilSicil))
        {
            /* Kişi kendi görevlendirmesine karar veremez */
            yetkili = K(mobilSicil) != K(k.PersonelKodu) && IzinOnayZinciri.SicilYetkili(adim, mobilSicil);
        }
        else
        {
            yetkili = panelRol is Roller.Admin or Roller.GenelMudurYardimcisi
                      || (adim.Tur == IzinOnayZinciri.TurIk && panelRol is Roller.IK or Roller.IKYoneticisi)
                      || (adim.Roller ?? new()).Contains(panelRol ?? "");
        }

        if (!yetkili) return new() { Kod = 403, Hata = "Bu görevlendirme sizin onayınızı beklemiyor." };

        adim.Karar = onay ? IzinOnayZinciri.KararOnay : IzinOnayZinciri.KararRed;
        adim.Kim = kim;
        adim.Tarih = DateTime.Now;
        adim.Not = not.Length > 0 ? not : null;

        int? sonraki = onay ? _zincir.Ilerle(z, asama, k.PersonelKodu, k.Birim) : null;
        var yeniDurum = !onay ? Reddedildi : sonraki is null ? Onaylandi : Bekliyor;

        var etkilenen = db.Execute(@"
UPDATE KRY_GOREVLENDIRME
SET zincir = @zincir, asama = @asama, durum = @durum, guncelleme = SYSDATETIME(),
    karar_kisi = CASE WHEN @bitti = 1 THEN @kim ELSE karar_kisi END,
    karar_not = CASE WHEN @bitti = 1 THEN @not ELSE karar_not END,
    karar_tarih = CASE WHEN @bitti = 1 THEN SYSDATETIME() ELSE karar_tarih END
WHERE id = @id AND durum = @bekliyor AND asama = @eski",
            new
            {
                id, zincir = IzinOnayZinciri.Json(z), asama = sonraki ?? asama, durum = yeniDurum,
                bitti = yeniDurum == Bekliyor ? 0 : 1, kim, not = not.Length > 0 ? not : null,
                bekliyor = Bekliyor, eski = k.Asama,
            });

        if (etkilenen == 0) return new() { Kod = 409, Hata = "Görevlendirme bu arada güncellendi; listeyi yenileyiniz." };

        var ozet = $"{k.Yer} · {k.EtkinlikTuru} · {k.Gidis:dd.MM} – {k.Donus:dd.MM}";

        try
        {
            if (yeniDurum == Onaylandi)
                await _bildirim.Gonder(k.PersonelKodu, "Görevlendirmeniz onaylandı", ozet, "gorevlendirme");
            else if (yeniDurum == Reddedildi)
                await _bildirim.Gonder(k.PersonelKodu, "Görevlendirmeniz reddedildi", $"{ozet} · {not}", "gorevlendirme");
            else
                await SiradakineHaber(k, z, sonraki!.Value, $"{adim.Ad} onayladı");
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Görevlendirme bildirimi gönderilemedi");
        }

        return new()
        {
            Mesaj = yeniDurum == Onaylandi ? "Görevlendirme onaylandı."
                : yeniDurum == Reddedildi ? "Görevlendirme reddedildi."
                : $"Kararınız kaydedildi; görevlendirme {IzinOnayZinciri.AdimAl(z, sonraki!.Value).Ad} onayına geçti.",
        };
    }

    public async Task SiradakineHaber(Kayit k, IzinOnayZinciri.Zincir z, int asama, string ek = null)
    {
        var adim = IzinOnayZinciri.AdimAl(z, asama);
        var metin = $"{k.AdSoyad} · {k.Yer} · {k.EtkinlikTuru} · {k.Gidis:dd.MM} – {k.Donus:dd.MM}"
                    + (ek is null ? "" : $" · {ek}");

        if (adim.Tur == IzinOnayZinciri.TurIk)
        {
            await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Görevlendirme onayınızı bekliyor", metin, "yillikizin");
            return;
        }

        foreach (var kod in (adim.Kodlar ?? new()).Distinct())
            await _bildirim.Gonder(kod, "Görevlendirme onayınızı bekliyor", metin, "izinonay|izin");

        if ((adim.Roller ?? new()).Contains(Roller.GenelMudurYardimcisi))
            await _bildirim.RoleGonder(new[] { Roller.GenelMudurYardimcisi }, "Görevlendirme onayınızı bekliyor", metin, "yillikizin");
    }

    /* ------------------------------------------------- mobil onay listesi */

    /// <summary>
    /// İzin Onayları listesine eklenecek, bu kişinin onayını bekleyen
    /// görevlendirmeler. Alanlar izin kartıyla aynı (yayındaki sürümler
    /// izin kartıyla gösteriyor); "tip": "gorevlendirme".
    /// </summary>
    public List<object> MobilBekleyenler(IDbConnection db, PersonelKaydi kisi)
    {
        var sonuc = new List<object>();
        if (kisi is null) return sonuc;
        if (db.ExecuteScalar<int>("SELECT CASE WHEN OBJECT_ID('KRY_GOREVLENDIRME') IS NULL THEN 0 ELSE 1 END") == 0) return sonuc;

        var bekleyenler = db.Query<Kayit>(Secim + " WHERE durum = @d ORDER BY olusturma", new { d = Bekliyor }).ToList();

        foreach (var k in bekleyenler)
        {
            if (K(k.PersonelKodu) == K(kisi.PersonelKodu)) continue;
            var z = ZincirOku(k);
            if (z is null) continue;
            var asama = Math.Clamp(k.Asama, 0, z.Adimlar.Count - 1);
            if (!IzinOnayZinciri.KararVerebilir(z, asama, kisi.PersonelKodu)) continue;

            var adim = IzinOnayZinciri.AdimAl(z, asama);
            var onceki = z.Adimlar.Take(asama).LastOrDefault(a => a.Karar == IzinOnayZinciri.KararOnay);

            sonuc.Add(new
            {
                id = MobilKimlik(k.Id),
                personelKodu = k.PersonelKodu,
                adSoyad = k.AdSoyad,
                subeAdi = k.Birim,
                gorev = k.Pozisyon,
                tur = "Görevlendirme",
                altTur = (string)null,
                cikisTarihi = k.Gidis,
                donusTarihi = k.Donus,
                gun = (decimal)k.Gun,
                aciklama = $"{KapsamAdi(k.Kapsam)} · {k.EtkinlikTuru} · {k.Yer}\n{k.EtkinlikAdi}\n{k.Aciklama}",
                olusturma = k.Olusturma,
                asama = asama <= 0 ? 1 : 2,
                formBekleniyor = false,
                formBelgeId = (int?)null,
                formYukle = false,
                formYuklendi = false,
                formVar = false,
                rapor = false,
                magazaKisi = onceki is null ? null : $"{KararEtiketi.Kisi(onceki.Ad, onceki.Tur, onceki.Kim)} ({onceki.Ad})",
                magazaNot = onceki?.Not,
                magazaTarih = onceki?.Tarih,
                asamaAdi = adim.Ad,
                adimAdi = adim.Ad,
                sira = IzinOnayZinciri.MobilSira(z),
                eksikBildirilebilir = false,

                /* yeni sürüm kartı */
                tip = "gorevlendirme",
                gorevlendirmeId = k.Id,
                kapsam = k.Kapsam,
                kapsamAdi = KapsamAdi(k.Kapsam),
                etkinlikTuru = k.EtkinlikTuru,
                etkinlikAdi = k.EtkinlikAdi,
                yer = k.Yer,
                not = k.Aciklama,
            });
        }

        return sonuc;
    }
}

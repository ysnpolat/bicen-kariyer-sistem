using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Ayrılan personelin Biçen Kart bağlantısı (02.10.2026)
/// ---------------------------------------------------------------------------
/// Personele fiziki kart gönderilmedi; kartlar Biçen360 uygulamasında
/// kullanılıyor. İşten ayrılan kişi uygulamaya giremiyor ama kartı ve
/// bakiyesi eşleşmiş olarak duruyor. İK, panelden (Biçen Kart › Ayrılan
/// Personel) bu kişilere SMS ile kişiye özel bir bağlantı gönderiyor;
/// bağlantı aday sitesinde <c>#/kart/KOD</c> sayfasını açıyor.
///
/// <para>
/// Panel uçları (<c>BicenKartController</c>, Ayrilan/…), herkese açık sayfa
/// (<c>KartLinkController</c>) ve günlük görev (<c>KartAyrilanGorevi</c>)
/// aynı kuralları buradan alıyor: kod üretimi, bağlantı adresi, kimlik ve
/// cihaz özetleri, SMS metni, durum hesabı, karta şifre kilidi.
/// </para>
///
/// <para>
/// <b>Güvenlik.</b> Bağlantı kartın parasına erişim demek. Kod 12 karakter,
/// kriptografik üreteçle (29^12). İlk açılışta TC kimlik numarasının
/// tamamı soruluyor; TC tabloda tutulmuyor, gönderim anında sunucu
/// anahtarıyla HMAC-SHA256 özeti yazılıyor (herkese açık uç Mikro'ya hiç
/// gitmiyor). Doğrulanan cihaza rastgele bir belirteç veriliyor; tabloda
/// yalnızca özeti duruyor. Anahtar <c>KartBaglanti:Anahtar</c>, yoksa
/// <c>Jwt:Anahtar</c>'dan türetiliyor ve hiçbir yere yazılmıyor.
/// </para>
/// </summary>
public static class KartAyrilan
{
    public const string TABLO = "KRY_KART_AYRILAN_BAGLANTI";
    public const string CIHAZ = "KRY_KART_AYRILAN_CIHAZ";
    public const string OLAY = "KRY_KART_AYRILAN_OLAY";

    /// <summary>Ayarın KRY_AYARLAR anahtarı.</summary>
    public const string AYAR = "KART_AYRILAN";

    /// <summary>SMS başarıyla gittiğinde sms_durum.</summary>
    public const string SMS_TAMAM = "TAMAM";

    public const string SMS_HATA = "HATA";

    /// <summary>Bağlantı türü: işten ayrılan personel.</summary>
    public const string TUR_AYRILAN = "ayrilan";

    /// <summary>
    /// Bağlantı türü: hâlâ çalışan personel. Kart Biçen360'ta da kullanılıyor;
    /// süre dolunca ya da bakiye bitince yalnızca bağlantı kapanır, kart
    /// şifresine dokunulmaz ve hiçbir şey kendiliğinden boşa çıkarılmaz.
    /// </summary>
    public const string TUR_CALISAN = "calisan";

    public static string TurTemizle(string tur) =>
        string.Equals((tur ?? "").Trim(), TUR_CALISAN, StringComparison.OrdinalIgnoreCase) ? TUR_CALISAN : TUR_AYRILAN;

    /// <summary>Bir kodda art arda kabul edilen hatalı TC denemesi.</summary>
    public const int EnFazlaHata = 10;

    /// <summary>Hatalı denemeler dolunca bağlantının kilitli kaldığı süre.</summary>
    public static readonly TimeSpan KilitSuresi = TimeSpan.FromHours(1);

    /// <summary>
    /// Üçüncü kilitten sonra bağlantı süresiz kilitleniyor; İK panelden
    /// "Kilidi aç" demeden açılmıyor (otuz yanlış TC tesadüf değil).
    /// </summary>
    public const int SuresizKilitSayisi = 3;

    public static readonly DateTime SuresizKilit = new(9999, 12, 31);

    /// <summary>Şifre belirlenmeden önce verilen cihaz belirtecinin ömrü.</summary>
    public static readonly TimeSpan KisaCihaz = TimeSpan.FromMinutes(30);

    /// <summary>Şifre belirlendikten sonra cihazın tanınma süresi.</summary>
    public static readonly TimeSpan UzunCihaz = TimeSpan.FromDays(180);

    /// <summary>Şifre değiştirmek için TC doğrulamasının tazeliği.</summary>
    public static readonly TimeSpan TazeDogrulama = TimeSpan.FromMinutes(10);

    /// <summary>Cihaz belirtecinin geldiği başlık ve çerez öneki.</summary>
    public const string CIHAZ_BASLIGI = "X-Kart-Cihaz";

    public static string CerezAdi(string kod) => "bkc_" + kod;

    private const string Harfler = "ABCDEFGHJKLMNPRSTUVYZ23456789";

    private static readonly CultureInfo Tr = new("tr-TR");

    /* ================================================================ ayar */

    public static KartAyrilanAyari Ayar(AyarServisi ayar)
    {
        KartAyrilanAyari a;

        try
        {
            a = ayar.Oku(AYAR, new KartAyrilanAyari());
        }
        catch
        {
            a = new KartAyrilanAyari();
        }

        if (string.IsNullOrWhiteSpace(a.SmsSablonu)) a.SmsSablonu = KartAyrilanAyari.VarsayilanSablon;
        if (string.IsNullOrWhiteSpace(a.CalisanSmsSablonu)) a.CalisanSmsSablonu = KartAyrilanAyari.VarsayilanCalisanSablon;
        if (a.GecerlilikGunu is < 1 or > 365) a.GecerlilikGunu = 30;
        a.OtomatikGeriGun = Math.Clamp(a.OtomatikGeriGun, 1, 30);
        if (a.OtomatikSaatBas is < 0 or > 23) a.OtomatikSaatBas = 10;
        if (a.OtomatikSaatBit is < 1 or > 24 || a.OtomatikSaatBit <= a.OtomatikSaatBas) a.OtomatikSaatBit = 19;

        return a;
    }

    /// <summary>
    /// Bağlantı adresi. Ayarda adres yazılıysa o, değilse işe uyum anketinin
    /// kullandığı adres (Form Ayarları › anket adresi). Diyezden sonrası
    /// atılıyor: bazı kurulumlarda adres <c>…/#/anket</c> diye yazılı.
    /// </summary>
    public static string Adres(AyarServisi ayar, string kod, KartAyrilanAyari a = null)
    {
        a ??= Ayar(ayar);

        var adres = (a.BaglantiAdresi ?? "").Trim();

        if (adres.Length == 0)
        {
            try
            {
                adres = (ayar.FormOku()?.AnketAdresi ?? "").Trim();
            }
            catch
            {
                adres = "";
            }
        }

        var diyez = adres.IndexOf('#');

        if (diyez >= 0) adres = adres[..diyez];

        adres = adres.TrimEnd('/');

        if (adres.Length == 0) adres = "https://kariyer.bicen.com.tr";

        if (!adres.StartsWith("http", StringComparison.OrdinalIgnoreCase))
            adres = "https://" + adres;

        return $"{adres}/#/kart/{kod}";
    }

    /* ================================================================= kod */

    /// <summary>
    /// Benzersiz, tahmin edilemez kod: on iki karakter, uyum anketindeki
    /// karışmayan harf/rakam kümesinden (29^12 ≈ 3,5·10^17). Bağlantı paraya
    /// erişim olduğu için kriptografik üreteçle.
    /// </summary>
    public static string BenzersizKod(System.Data.IDbConnection db)
    {
        for (var i = 0; i < 8; i++)
        {
            var kod = KodUret(12);

            if (db.ExecuteScalar<int>($"SELECT COUNT(*) FROM {TABLO} WHERE kod = @kod", new { kod }) == 0)
                return kod;
        }

        return KodUret(16);
    }

    private static string KodUret(int uzunluk) =>
        new(Enumerable.Range(0, uzunluk)
            .Select(_ => Harfler[RandomNumberGenerator.GetInt32(Harfler.Length)])
            .ToArray());

    /// <summary>Kod biçimi: harf kümesinden 10–24 karakter. Değilse null.</summary>
    public static string KodTemizle(string kod)
    {
        var k = (kod ?? "").Trim().ToUpperInvariant();

        return k.Length is >= 10 and <= 24 && k.All(c => Harfler.Contains(c)) ? k : null;
    }

    /* ======================================================= özet / anahtar */

    /// <summary>
    /// Sunucu anahtarı. Ayrı anahtar (<c>KartBaglanti:Anahtar</c>) önerilir:
    /// JWT anahtarı değiştirilirse bu özetler de geçersiz olur (TC doğrulaması
    /// tutmaz; "Tekrar gönder" özeti yeniler). Anahtar doğrudan kullanılmıyor,
    /// amaca özel bir anahtar türetiliyor.
    /// </summary>
    public static byte[] Anahtar(IConfiguration yapilandirma)
    {
        var ham = yapilandirma["KartBaglanti:Anahtar"];

        if (string.IsNullOrWhiteSpace(ham)) ham = yapilandirma["Jwt:Anahtar"];

        if (string.IsNullOrWhiteSpace(ham) || ham.Trim().Length < 16)
            throw new InvalidOperationException(
                "Kart bağlantısı için sunucu anahtarı yok (KartBaglanti:Anahtar ya da Jwt:Anahtar).");

        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(ham.Trim()),
            Encoding.UTF8.GetBytes("bicen-kart-ayrilan-v1"));
    }

    private static string Hmac(byte[] anahtar, string veri) =>
        Convert.ToHexString(HMACSHA256.HashData(anahtar, Encoding.UTF8.GetBytes(veri)));

    /// <summary>TC'nin rakamları; 11 hane değilse null.</summary>
    public static string KimlikNormal(string kimlikNo)
    {
        var r = new string((kimlikNo ?? "").Where(char.IsDigit).ToArray());

        return r.Length == 11 && r[0] != '0' ? r : null;
    }

    /// <summary>TC özeti: HMAC(anahtar, "tc:KOD:TC"). Kod tuz yerine: aynı TC iki bağlantıda farklı özet.</summary>
    public static string KimlikOzeti(byte[] anahtar, string kod, string tc) => Hmac(anahtar, $"tc:{kod}:{tc}");

    public static string CihazOzeti(byte[] anahtar, string belirtec) => Hmac(anahtar, $"cihaz:{belirtec}");

    /// <summary>Sabit süreli karşılaştırma: farkın yeri zamanlamadan sızmasın.</summary>
    public static bool OzetEsit(string a, string b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return false;

        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(a.Trim().ToUpperInvariant()),
            Encoding.ASCII.GetBytes(b.Trim().ToUpperInvariant()));
    }

    /// <summary>Cihaz belirteci: 32 rastgele bayt, adreste taşınabilir base64.</summary>
    public static string YeniBelirtec() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /* =============================================================== metin */

    /// <summary>"AYŞE NUR YILMAZ" → "Ayşe" (herkese açık sayfada yalnızca ilk ad).</summary>
    public static string IlkAd(string adSoyad)
    {
        var ilk = (adSoyad ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        var k = ilk.ToLower(Tr);

        return k.Length == 0 ? k : k[..1].ToUpper(Tr) + k[1..];
    }

    /// <summary>1840.5 → "1.840,50"; tam sayıda kuruş yazılmıyor: "1.840".</summary>
    public static string Tutar(decimal tutar) =>
        tutar == decimal.Truncate(tutar) ? tutar.ToString("N0", Tr) : tutar.ToString("N2", Tr);

    /// <summary>
    /// SMS metni. Yer tutucular: {ad}, {bakiye}, {link}, {gun}, {tarih}.
    /// Kalıpta {link} unutulduysa bağlantı sona ekleniyor: bağlantısız SMS
    /// kişiye hiçbir şey söylemiyor.
    /// </summary>
    public static string SmsMetni(string kalip, string adSoyad, decimal bakiye, string link,
                                  int gun, DateTime sonGecerlilik)
    {
        var k = string.IsNullOrWhiteSpace(kalip) ? KartAyrilanAyari.VarsayilanSablon : kalip.Trim();

        var metin = k
            .Replace("{ad}", IlkAd(adSoyad))
            .Replace("{bakiye}", Tutar(bakiye))
            .Replace("{link}", link)
            .Replace("{gun}", gun.ToString(Tr))
            .Replace("{tarih}", sonGecerlilik.ToString("dd.MM.yyyy", Tr));

        if (!k.Contains("{link}")) metin += " " + link;

        return metin;
    }

    public static string SonDort(string kartNo)
    {
        var n = new string((kartNo ?? "").Where(char.IsDigit).ToArray());

        return n.Length >= 4 ? n[^4..] : n;
    }

    /* ============================================================= kayıtlar */

    /// <summary>Bağlantı geçmişine bir satır. Hata işi durdurmuyor.</summary>
    public static void OlayYaz(System.Data.IDbConnection db, int baglantiId, string tur,
                               string aciklama = null, string yapan = null, string ip = null)
    {
        try
        {
            db.Execute($@"
INSERT INTO {OLAY} (baglanti_id, tur, aciklama, yapan, ip)
VALUES (@baglantiId, @tur, @aciklama, @yapan, @ip)",
                new
                {
                    baglantiId,
                    tur,
                    aciklama = Kisalt(aciklama, 500),
                    yapan = Kisalt(yapan, 100),
                    ip = Kisalt(ip, 64),
                });
        }
        catch
        {
            /* Geçmiş satırı yazılamadı diye asıl işlem bozulmasın */
        }
    }

    public static string Kisalt(string s, int n) => s is null ? null : s.Length > n ? s[..n] : s;

    /// <summary>
    /// Kart hâlâ bu personelde mi (panel eşleşmesi). Kart boşa çıkarılmış ya
    /// da başkasına verilmişse false: o karta bu bağlantı adına dokunulmaz,
    /// yeni sahibinin şifresi bozulmasın.
    /// </summary>
    public static bool KartKisininMi(System.Data.IDbConnection db, string kartNo, string sicil)
    {
        var sahip = db.ExecuteScalar<string>(
            "SELECT TOP 1 personel_kodu FROM KRY_KART_ESLESME WHERE kart_no = @kartNo",
            new { kartNo = (kartNo ?? "").Trim() });

        return !string.IsNullOrWhiteSpace(sahip)
               && string.Equals(sahip.Trim(), (sicil ?? "").Trim(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Kart şifresini kimsenin bilmediği rastgele dört haneye çevirir.
    ///
    /// <para>
    /// Kasada puan harcaması kart şifresiyle onaylanıyor (kartlar
    /// <c>PuanHarcamaSmsSifre = 1</c>). Süresi dolan ya da bakiyesi biten
    /// bağlantıda kişinin bildiği şifre geçersiz kalınca, kart numarasını ya
    /// da indirdiği görseli bilse bile kasada harcama onaylanamıyor. Bakiye
    /// silinmiyor; İK süreyi uzatırsa kişi bağlantıdan TC ile yeni şifre
    /// belirleyebiliyor. Biçim kasanın okuduğu biçimle aynı (dört rakam) ve
    /// yazma tek yoldan (<see cref="GiftKartServisi.KartSifresiYaz"/>).
    /// </para>
    /// </summary>
    public static (bool Basarili, string Hata) SifreyiKilitle(
        System.Data.IDbConnection pos, string kartNo, ILogger kayit)
    {
        string sifre;

        do
        {
            sifre = RandomNumberGenerator.GetInt32(0, 10000).ToString("0000");
        } while (GiftKartServisi.SifreKuraliHatasi(sifre) is not null);

        return GiftKartServisi.KartSifresiYaz(pos, kartNo, sifre, kayit);
    }

    /* ================================================================ durum */

    public static readonly Dictionary<string, string> DurumAdi = new()
    {
        ["gonderilmedi"] = "Gönderilmedi",
        ["smsHata"] = "SMS başarısız",
        ["acilmadi"] = "Gönderildi (açılmadı)",
        ["acildi"] = "Açıldı (kimlik bekleniyor)",
        ["dogrulandi"] = "Açıldı (kimlik doğrulandı)",
        ["sifre"] = "Şifre belirlendi",
        ["kullaniyor"] = "Kullanıyor",
        ["tamamlandi"] = "Tamamlandı",
        ["silindi"] = "Bakiye silindi",
        ["sureDoldu"] = "Süresi doldu, kullanmadı",
        ["sureDolduKismen"] = "Süresi doldu, kısmen kullandı",
        ["kilitli"] = "Kilitlendi",
        ["iptal"] = "İptal edildi",
        ["birakildi"] = "Kart boşa çıkarıldı",
    };

    /// <summary>
    /// Bağlantının durumu.
    ///
    /// <para>
    /// "Kullanıyor": gönderimden sonra karta yazılmış alışveriş satırı var
    /// (PuanHareket.IslemTipi = 2, panelin rapor ekranındaki kuralla aynı;
    /// iade 9 düşülüyor). "Tamamlandı": bakiye sıfır. Bakiye sıfır ama
    /// gönderimden sonra silme/aktarma (6) satırı varsa ve harcama gönderim
    /// bakiyesine ulaşmıyorsa "Bakiye silindi" — İK sildiyse kişi
    /// kullanmış sayılmasın.
    /// </para>
    /// </summary>
    public static string Durum(KartAyrilanSatiri b, decimal? bakiye, DateTime simdi)
    {
        if (b is null) return "gonderilmedi";
        if (b.Iptal) return "iptal";
        if (b.Birakildi is not null) return "birakildi";

        var harcanan = b.Harcanan ?? 0m;
        var bitti = bakiye.HasValue ? bakiye.Value <= 0m : b.Tamamlandi is not null;

        if (bitti)
        {
            var silindi = (b.Silinen ?? 0m) > 0m && harcanan < (b.GonderimBakiye ?? 0m);

            return silindi ? "silindi" : "tamamlandi";
        }

        if (b.SonGecerlilik < simdi) return harcanan > 0m ? "sureDolduKismen" : "sureDoldu";

        if (b.KilitBitis is DateTime k && k > simdi) return "kilitli";

        var ulasti = b.SmsIlk is not null || b.AcilisSayisi > 0;

        if (!ulasti) return b.SmsDurum == SMS_HATA ? "smsHata" : "gonderilmedi";

        if (harcanan > 0m) return "kullaniyor";
        if (b.SifreGecerli) return "sifre";
        if (b.KimlikDogrulama is not null) return "dogrulandi";
        if (b.AcilisSayisi > 0) return "acildi";

        return "acilmadi";
    }

    /// <summary>KRY_KART_AYRILAN_BAGLANTI sütunları, <see cref="KartAyrilanSatiri"/> adlarıyla.</summary>
    public const string SUTUNLAR = @"id AS Id, kod AS Kod, ay AS Ay, personel_kodu AS PersonelKodu,
       ad_soyad AS AdSoyad, sube AS Sube, pozisyon AS Pozisyon, cikis_tarihi AS CikisTarihi,
       telefon AS Telefon, kart_no AS KartNo, kimlik_hash AS KimlikHash,
       gonderim AS Gonderim, son_gecerlilik AS SonGecerlilik, gonderim_bakiye AS GonderimBakiye,
       sms_durum AS SmsDurum, sms_hata AS SmsHata, sms_ilk AS SmsIlk, sms_son AS SmsSon,
       sms_sayisi AS SmsSayisi, gonderen AS Gonderen, son_gonderen AS SonGonderen,
       ilk_acilis AS IlkAcilis, son_acilis AS SonAcilis, acilis_sayisi AS AcilisSayisi,
       kimlik_dogrulama AS KimlikDogrulama, son_dogrulama AS SonDogrulama,
       sifre_tarihi AS SifreTarihi, sifre_sayisi AS SifreSayisi, sifre_gecersiz AS SifreGecersiz,
       hatali_deneme AS HataliDeneme, kilit_bitis AS KilitBitis, kilit_sayisi AS KilitSayisi,
       gorsel_indirme AS GorselIndirme, indirme_sayisi AS IndirmeSayisi,
       son_bakiye AS SonBakiye, bakiye_kontrol AS BakiyeKontrol, harcanan AS Harcanan,
       silinen AS Silinen, ilk_kullanim AS IlkKullanim, son_kullanim AS SonKullanim,
       tamamlandi AS Tamamlandi, suresi_doldu AS SuresiDoldu,
       iptal AS Iptal, iptal_tarihi AS IptalTarihi, iptal_eden AS IptalEden,
       birakildi AS Birakildi, birakan AS Birakan, uzatma_sayisi AS UzatmaSayisi,
       olusturma AS Olusturma, tur AS Tur";
}

/// <summary>Ayrılan personel kart bağlantısı ayarları (KRY_AYARLAR, KART_AYRILAN).</summary>
public class KartAyrilanAyari
{
    public const string VarsayilanSablon =
        "Sayın {ad}, Biçen Kart bakiyeniz {bakiye} TL. Kartınızı görüntülemek ve kullanmak için: "
        + "{link} ({gun} gün geçerlidir) - Biçen";

    /// <summary>SMS kalıbı: {ad}, {bakiye}, {link}, {gun}, {tarih}.</summary>
    public string SmsSablonu { get; set; } = VarsayilanSablon;

    public const string VarsayilanCalisanSablon =
        "Sayın {ad}, Biçen Kart bakiyeniz {bakiye} TL. Kartınızı görüntülemek için: "
        + "{link} ({gun} gün geçerlidir) - Biçen";

    /// <summary>Çalışan personele giden SMS'in kalıbı (aynı yer tutucular).</summary>
    public string CalisanSmsSablonu { get; set; } = VarsayilanCalisanSablon;

    public string Sablon(string tur) =>
        KartAyrilan.TurTemizle(tur) == KartAyrilan.TUR_CALISAN ? CalisanSmsSablonu : SmsSablonu;

    /// <summary>Bağlantının geçerlilik süresi (gün), ilk SMS'ten itibaren.</summary>
    public int GecerlilikGunu { get; set; } = 30;

    /// <summary>
    /// Bağlantının kök adresi (ör. https://kariyer.bicen.com.tr). Boşsa
    /// Form Ayarları'ndaki anket adresi kullanılır.
    /// </summary>
    public string BaglantiAdresi { get; set; } = "";

    /// <summary>
    /// 27.10.2026: işten ayrılan personele bağlantı SMS'i kendiliğinden
    /// (KartAyrilanGorevi, saat başı). Çıkış tarihi son <see cref="OtomatikGeriGun"/>
    /// gün içinde olan, daha önce "ayrılan" bağlantısı hiç oluşturulmamış
    /// kişilere; kart eşleşmesi, cep telefonu, TC ve bakiye şartları elle
    /// gönderimle aynı.
    /// </summary>
    public bool OtomatikGonder { get; set; } = true;

    /// <summary>Açıldığında eski ayrılanlara toplu SMS gitmesin: yalnız son N gün (1–30)</summary>
    public int OtomatikGeriGun { get; set; } = 7;

    /// <summary>SMS saat aralığı (gece gitmesin): başlangıç dahil, bitiş hariç</summary>
    public int OtomatikSaatBas { get; set; } = 10;
    public int OtomatikSaatBit { get; set; } = 19;
}

/// <summary>KRY_KART_AYRILAN_BAGLANTI satırı.</summary>
public sealed class KartAyrilanSatiri
{
    public int Id { get; set; }
    public string Kod { get; set; }

    /// <summary>Gönderimin yapıldığı çıkış ayı: "2026-10".</summary>
    public string Ay { get; set; }

    public string PersonelKodu { get; set; }
    public string AdSoyad { get; set; }
    public string Sube { get; set; }
    public string Pozisyon { get; set; }
    public DateTime? CikisTarihi { get; set; }
    public string Telefon { get; set; }
    public string KartNo { get; set; }
    public string KimlikHash { get; set; }

    /// <summary>Bağlantının oluşturulduğu an; kullanım bundan sonraki harcamayla ölçülüyor.</summary>
    public DateTime Gonderim { get; set; }

    public DateTime SonGecerlilik { get; set; }
    public decimal? GonderimBakiye { get; set; }
    public string SmsDurum { get; set; }
    public string SmsHata { get; set; }
    public DateTime? SmsIlk { get; set; }
    public DateTime? SmsSon { get; set; }
    public int SmsSayisi { get; set; }
    public string Gonderen { get; set; }
    public string SonGonderen { get; set; }
    public DateTime? IlkAcilis { get; set; }
    public DateTime? SonAcilis { get; set; }
    public int AcilisSayisi { get; set; }
    public DateTime? KimlikDogrulama { get; set; }
    public DateTime? SonDogrulama { get; set; }
    public DateTime? SifreTarihi { get; set; }
    public int SifreSayisi { get; set; }

    /// <summary>Kart şifresinin bizim tarafımızdan rastgeleye çevrildiği an (süre doldu / bitti / iptal).</summary>
    public DateTime? SifreGecersiz { get; set; }

    public int HataliDeneme { get; set; }
    public DateTime? KilitBitis { get; set; }
    public int KilitSayisi { get; set; }
    public DateTime? GorselIndirme { get; set; }
    public int IndirmeSayisi { get; set; }
    public decimal? SonBakiye { get; set; }
    public DateTime? BakiyeKontrol { get; set; }
    public decimal? Harcanan { get; set; }
    public decimal? Silinen { get; set; }
    public DateTime? IlkKullanim { get; set; }
    public DateTime? SonKullanim { get; set; }
    public DateTime? Tamamlandi { get; set; }
    public DateTime? SuresiDoldu { get; set; }
    public bool Iptal { get; set; }
    public DateTime? IptalTarihi { get; set; }
    public string IptalEden { get; set; }
    public DateTime? Birakildi { get; set; }
    public string Birakan { get; set; }
    public int UzatmaSayisi { get; set; }
    public DateTime Olusturma { get; set; }

    /// <summary><see cref="KartAyrilan.TUR_AYRILAN"/> ya da <see cref="KartAyrilan.TUR_CALISAN"/>.</summary>
    public string Tur { get; set; } = KartAyrilan.TUR_AYRILAN;

    public bool Calisan => string.Equals(Tur, KartAyrilan.TUR_CALISAN, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Kişinin bağlantıdan belirlediği şifre hâlâ kartta mı: belirlenmiş ve
    /// sonradan bizim tarafımızdan rastgeleye çevrilmemiş.
    /// </summary>
    public bool SifreGecerli =>
        SifreTarihi is not null && (SifreGecersiz is null || SifreTarihi > SifreGecersiz);

    /// <summary>Bağlantı kişiye ulaşabilir durumda mı (iptal, bırakma yok).</summary>
    public bool Etkin => !Iptal && Birakildi is null;
}

/// <summary>
/// Bağlantıların kart tarafındaki akıbeti: güncel bakiye, gönderimden
/// sonraki harcama/iade/silme ve bakiyenin bittiği an. Panel listesi ve
/// günlük görev aynı hesabı kullanıyor; sonuç bağlantı satırına yazılıyor
/// ki POS sunucusuna ulaşılamadığında son bilinen hâl gösterilebilsin.
/// </summary>
public static class KartAyrilanTazeleme
{
    private const string HAREKET = "[PosbackPromosyon].[dbo].[PuanHareket]";

    /// <summary>Harcama tutarı: EksiPuan, boşsa Puan (rapor ekranıyla aynı).</summary>
    private const string TUTAR = "ABS(COALESCE(NULLIF(h.EksiPuan, 0), h.Puan, 0))";

    /// <summary>
    /// Satırları POS verisiyle tazeler ve kart → güncel bakiye döner. POS'a
    /// ulaşılamazsa hata fırlatır; çağıran son bilinen değerlerle devam eder.
    /// </summary>
    public static Dictionary<string, decimal> Tazele(
        System.Data.IDbConnection db, System.Data.IDbConnection pos,
        IReadOnlyCollection<KartAyrilanSatiri> satirlar, DateTime simdi)
    {
        var izlenen = satirlar.Where(x => x.Etkin && !string.IsNullOrWhiteSpace(x.KartNo)).ToList();

        var kartlar = izlenen.Select(x => x.KartNo.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var bakiyeler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);

        if (kartlar.Count == 0) return bakiyeler;

        foreach (var k in kartlar) bakiyeler[k] = 0m;

        foreach (var (no, tutar) in GiftKartServisi.TopluBakiye(pos, kartlar))
            bakiyeler[no] = tutar;

        /* Gönderimden sonraki hareketler: 2 harcama, 9 iade, 6 silme/aktarma */
        var enEski = izlenen.Min(x => x.Gonderim);
        var hareketler = new List<(string Kart, DateTime Tarih, int Tip, decimal Tutar)>();

        foreach (var parca in kartlar.Chunk(400))
            foreach (var x in pos.Query($@"
SELECT CONVERT(VARCHAR(50), h.KartNo) AS kartNo, h.Tarih AS tarih, h.IslemTipi AS tip, {TUTAR} AS tutar
FROM {HAREKET} h WITH (NOLOCK)
WHERE h.KartNo IN @parca AND h.IslemTipi IN (2, 6, 9) AND h.Tarih >= @enEski",
                         new { parca = PosParametre.Ansi(parca), enEski }, commandTimeout: 120))
            {
                string no = ((string)x.kartNo ?? "").Trim();
                DateTime tarih = (DateTime)x.tarih;
                int tip = Convert.ToInt32((object)x.tip);
                decimal tutar = x.tutar is null ? 0m : Convert.ToDecimal((object)x.tutar);

                hareketler.Add((no, tarih, tip, tutar));
            }

        var guncellemeler = new List<object>();

        foreach (var b in izlenen)
        {
            var kart = b.KartNo.Trim();
            var h = hareketler.Where(x => string.Equals(x.Kart, kart, StringComparison.OrdinalIgnoreCase)
                                          && x.Tarih >= b.Gonderim).ToList();

            var harcamalar = h.Where(x => x.Tip == 2).ToList();
            var harcanan = Math.Max(0m, harcamalar.Sum(x => x.Tutar) - h.Where(x => x.Tip == 9).Sum(x => x.Tutar));
            var silinen = h.Where(x => x.Tip == 6).Sum(x => x.Tutar);
            var bakiye = bakiyeler.TryGetValue(kart, out var bb) ? bb : 0m;

            DateTime? ilk = harcamalar.Count > 0 ? harcamalar.Min(x => x.Tarih) : null;
            DateTime? son = harcamalar.Count > 0 ? harcamalar.Max(x => x.Tarih) : null;

            /* Bakiyenin bittiği an: ilk görüldüğü an (yalnızca kişiye
               ulaşmış ve süresi içindeki bağlantıda anlamlı). Bakiye geri
               gelirse (iade) işaret kalkıyor. */
            DateTime? tamam = bakiye <= 0m ? b.Tamamlandi ?? simdi : null;

            var degisti = b.SonBakiye != bakiye || b.Harcanan != harcanan || b.Silinen != silinen
                          || b.IlkKullanim != ilk || b.SonKullanim != son || b.Tamamlandi != tamam
                          || b.BakiyeKontrol is null || (simdi - b.BakiyeKontrol.Value).TotalMinutes > 10;

            b.SonBakiye = bakiye;
            b.Harcanan = harcanan;
            b.Silinen = silinen;
            b.IlkKullanim = ilk;
            b.SonKullanim = son;
            b.Tamamlandi = tamam;
            b.BakiyeKontrol = simdi;

            if (degisti)
                guncellemeler.Add(new { id = b.Id, bakiye, harcanan, silinen, ilk, son, tamam });
        }

        if (guncellemeler.Count > 0)
            db.Execute($@"
UPDATE {KartAyrilan.TABLO}
SET son_bakiye = @bakiye, bakiye_kontrol = SYSDATETIME(), harcanan = @harcanan, silinen = @silinen,
    ilk_kullanim = @ilk, son_kullanim = @son, tamamlandi = @tamam
WHERE id = @id", guncellemeler);

        return bakiyeler;
    }
}

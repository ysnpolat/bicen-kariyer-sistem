using System.Data;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe Al ekranından Mikro'da sicil kartı açma (09.10.2026).
///
/// <para>
/// <b>Yalnızca MikroDesktop_2004BICEN.dbo.PERSONELLER'e yazılır.</b>
/// MikroDesktop_BICEN (RSM) bu sınıfta yalnızca okunur: kişinin orada
/// kaydı var mı diye bakılır, hiçbir zaman yazılmaz.
/// </para>
///
/// <para>
/// Akış: İK uzmanı İşe Al penceresinde "Mikro'da sicil kartını aç"
/// seçeneğini işaretler, bilgileri doldurur. Bilgiler doğrulanıp
/// KRY_MIKRO_SICIL tablosuna "bekliyor" olarak alınır; işe alım yetkili
/// tarafından onaylanınca kart açılır (reddedilirse açılmaz, Mikro'da
/// bordroya girecek boş bir kayıt kalmaz). Hata olursa başvuru kartından
/// yeniden denenebilir.
/// </para>
///
/// <para>
/// Kartı Mikro'daki <c>dbo.BK_PERSONEL_SICIL_AC</c> prosedürü yazar
/// (araclar/sql/BK_PERSONEL_SICIL_AC.sql, 09.10.2026). Hangi kolona ne
/// yazıldığı yalnızca orada; bu sınıf formu hazırlar, doğrular, kuyruğu
/// tutar ve prosedürü çağırır.
/// </para>
///
/// <para>
/// Sicil numarası (per_kod): Mikro'da en son açılan kartın numarası + 1.
/// Kayıt Mikro'ya yazılmadan önce değişiklik günlüğüne alınır
/// (KRY_PERSONEL_MIKRO_DEGISIKLIK).
/// </para>
/// </summary>
public class MikroSicilServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<MikroSicilServisi> _kayit;

    private static ILogger<MikroSicilServisi> _ortakKayit;

    /// <summary>Program.cs: onayda (DI dışında) açılan kartların da günlüğe yazılması için</summary>
    public static void Baslat(ILogger<MikroSicilServisi> kayit) => _ortakKayit = kayit;

    public MikroSicilServisi(VeritabaniServisi vt, ILogger<MikroSicilServisi> kayit = null)
    {
        _vt = vt;
        _kayit = kayit ?? _ortakKayit;
    }

    private const string Veritabani = "[MikroDesktop_2004BICEN]";
    private const string Tablo = Veritabani + ".dbo.PERSONELLER";
    private const string IsGrupTablosu = Veritabani + ".dbo.PERSONEL_IS_GRUP_TANIMLARI";
    private const string UnvanTablosu = Veritabani + ".dbo.PERSONEL_UNVAN_TANIMLARI";

    /// <summary>RSM: yalnızca okunur. Bu tabloya yazan kod YOK ve olmamalı.</summary>
    private const string RsmTablo = "[MikroDesktop_BICEN].dbo.PERSONELLER";

    public const string Bekliyor = "bekliyor";
    public const string Acildi = "acildi";
    public const string HataDurumu = "hata";
    public const string Iptal = "iptal";

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");
    /// <summary>Mikro'nun boş tarihi: yeni kartlarda 31.12.1899 (per_old_tarih ve per_asgucrverind_tarihi 30.12.1899)</summary>
    private static readonly DateTime BosTarih = new(1899, 12, 31);

    /* ==================================================================== */
    /* Girdi                                                                 */
    /* ==================================================================== */

    public sealed class Girdi
    {
        public string Ad { get; set; }
        public string Soyad { get; set; }
        public string TcKimlikNo { get; set; }

        /// <summary>"E" erkek, "K" kadın (Mikro: 0 erkek, 1 kadın)</summary>
        public string Cinsiyet { get; set; }

        public DateTime? DogumTarihi { get; set; }
        public string DogumYeri { get; set; }

        /// <summary>"Evli" / "Bekar" (Mikro: 0 evli, 1 bekar)</summary>
        public string MedeniHal { get; set; }

        /// <summary>Mikro tahsil kodu (per_kim_tahsil)</summary>
        public int? Tahsil { get; set; }

        public string Telefon { get; set; }

        public string Il { get; set; }
        public string Ilce { get; set; }
        public string Semt { get; set; }
        public string Mahalle { get; set; }
        public string Cadde { get; set; }
        public string Sokak { get; set; }
        public string BinaNo { get; set; }
        public string DaireNo { get; set; }

        /// <summary>Mikro iş grubu kodu (şube)</summary>
        public string IsGrubuKodu { get; set; }

        /// <summary>Mikro ünvan kodu</summary>
        public string UnvanKodu { get; set; }

        /// <summary>Kartta görünen meslek / ünvan metni (per_kim_meslek)</summary>
        public string Meslek { get; set; }

        public decimal? Ucret { get; set; }

        /// <summary>"net" / "brut"</summary>
        public string BrutNet { get; set; }

        public bool AsgariUcretli { get; set; }

        public string Iban { get; set; }

        /// <summary>
        /// Engellilik derecesi (per_kim_sakat_derece; personel listesi de
        /// buradan okuyor): 0 değil, 1 (%80+), 2 (%60-79), 3 (%40-59)
        /// </summary>
        public int SakatDerece { get; set; }

        /// <summary>Engellilik oranı % (per_engellilik_orani), isteğe bağlı</summary>
        public int? EngellilikOrani { get; set; }

        /// <summary>
        /// Sigorta grubu (per_ucr_sig_yuzde_gr): 0 normal, 1 emekli (SGDP),
        /// 2 çırak, 3 yabancı, 4 öğrenci
        /// </summary>
        public int SigortaGrubu { get; set; }

        /// <summary>Otomatik BES'e dahil; boşsa yaşa göre (45 altı dahil)</summary>
        public bool? Bes { get; set; }

        /// <summary>Kayıtta kullanılan işe giriş tarihi (sunucu doldurur)</summary>
        public DateTime? GirisTarihi { get; set; }
    }

    /// <summary>İşlem sonucu; Durum HTTP koduna karşılık gelir.</summary>
    public sealed record Sonuc(int Durum, string Mesaj, object Veri = null)
    {
        public bool Basarili => Durum is >= 200 and < 300;
    }

    /// <summary>Tahsil kodları (Mikro per_kim_tahsil). Mikro'daki listeyle sırası kontrol edilmeli.</summary>
    public static readonly (int Kod, string Ad)[] Tahsiller =
    {
        (0, "Belirtilmemiş"),
        (1, "İlkokul"),
        (2, "Ortaokul"),
        (3, "Lise"),
        (4, "Ön lisans"),
        (5, "Lisans"),
        (6, "Yüksek lisans"),
        (7, "Doktora"),
    };

    /// <summary>Başvuru formundaki eğitim seviyesi → tahsil kodu</summary>
    public static int? TahsilKodu(string egitim)
    {
        var e = Anahtar(egitim);
        if (e.Length == 0) return null;
        if (e.Contains("DOKTORA")) return 7;
        if (e.Contains("YUKSEK")) return 6;
        if (e.Contains("ONLISANS") || e.Contains("ON LISANS")) return 4;
        if (e.Contains("LISANS") || e.Contains("UNIVERSITE")) return 5;
        if (e.Contains("LISE")) return 3;
        if (e.Contains("ORTAOKUL")) return 2;
        if (e.Contains("ILKOKUL")) return 1;
        return null;
    }

    /* ==================================================================== */
    /* Şema                                                                  */
    /* ==================================================================== */

    private sealed class Kolon
    {
        public string Ad { get; set; }
        public string Tip { get; set; }
        public int Uzunluk { get; set; }
        public bool BosOlabilir { get; set; }
        public bool Kimlik { get; set; }
        public bool Hesaplanan { get; set; }

        private static readonly string[] MetinTipleri = { "nvarchar", "varchar", "nchar", "char", "ntext", "text" };
        private static readonly string[] TamSayi = { "int", "smallint", "tinyint", "bigint" };
        private static readonly string[] Ondalik = { "decimal", "numeric", "float", "real", "money", "smallmoney" };
        private static readonly string[] Tarih = { "datetime", "datetime2", "smalldatetime", "date" };

        public bool Metin => MetinTipleri.Contains(Tip, StringComparer.OrdinalIgnoreCase);
        public bool Tam => TamSayi.Contains(Tip, StringComparer.OrdinalIgnoreCase);
        public bool Sayi => Tam || Ondalik.Contains(Tip, StringComparer.OrdinalIgnoreCase);
        public bool TarihMi => Tarih.Contains(Tip, StringComparer.OrdinalIgnoreCase);
        public bool Bit => string.Equals(Tip, "bit", StringComparison.OrdinalIgnoreCase);
        public bool Guid => string.Equals(Tip, "uniqueidentifier", StringComparison.OrdinalIgnoreCase);

        /// <summary>rowversion/timestamp: elle yazılamaz</summary>
        public bool Atla => Kimlik || Hesaplanan
                            || string.Equals(Tip, "timestamp", StringComparison.OrdinalIgnoreCase);

        public int AzamiKarakter =>
            Uzunluk < 0 || Tip.Equals("text", StringComparison.OrdinalIgnoreCase) || Tip.Equals("ntext", StringComparison.OrdinalIgnoreCase) ? 4000
            : Tip.StartsWith("n", StringComparison.OrdinalIgnoreCase) ? Uzunluk / 2
            : Uzunluk;

        /// <summary>Mikro'nun boş değeri: metin '', sayı 0, tarih 30.12.1899</summary>
        public object Sifir()
        {
            if (Metin) return "";
            if (Bit) return false;
            if (Tam) return 0;
            if (Sayi) return 0m;
            if (TarihMi)
                return string.Equals(Tip, "smalldatetime", StringComparison.OrdinalIgnoreCase) ? new DateTime(1900, 1, 1) : BosTarih;
            if (Guid) return System.Guid.Empty;
            return null;
        }
    }

    private static List<Kolon> SemaOku(IDbConnection db, IDbTransaction islem = null) =>
        db.Query<Kolon>($@"
SELECT c.name AS Ad, TYPE_NAME(c.system_type_id) AS Tip, c.max_length AS Uzunluk,
       c.is_nullable AS BosOlabilir, c.is_identity AS Kimlik, c.is_computed AS Hesaplanan
FROM {Veritabani}.sys.columns c
WHERE c.object_id = OBJECT_ID('{Tablo}')
ORDER BY c.column_id", transaction: islem).ToList();

    /* ==================================================================== */
    /* Kolon sınıfları                                                      */
    /* ==================================================================== */

    /// <summary>Ünvan şablonu kolonları (form ekranında görev / SGK meslek kodu gösterimi)</summary>
    private static readonly string[] UnvanKolonlari =
    {
        "per_kim_meslek", "per_kim_gorev", "per_meslek_kodu", "per_mevsim", "per_sskbelge_turu", "per_sgk_deger_kodu",
    };

    private const double OyBirligi = 0.7;

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    private static string Anahtar(string s) =>
        new string((s ?? "").ToUpper(Tr)
                .Replace('İ', 'I').Replace('Ş', 'S').Replace('Ğ', 'G').Replace('Ü', 'U').Replace('Ö', 'O').Replace('Ç', 'C')
                .Where(c => char.IsLetterOrDigit(c) || c == ' ').ToArray())
            .Trim();

    private static string Sade(string s) =>
        string.Join(" ", new string((s ?? "").Select(c => char.IsControl(c) ? ' ' : c).ToArray())
            .Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static string Buyuk(string s) => Sade(s).ToUpper(Tr);

    private static string Sayilar(string s) => new((s ?? "").Where(char.IsDigit).ToArray());

    /// <summary>TC kimlik numarası algoritma denetimi</summary>
    public static bool TcGecerli(string tc)
    {
        if (tc is not { Length: 11 } || !tc.All(char.IsDigit) || tc[0] == '0') return false;

        var d = tc.Select(c => c - '0').ToArray();
        var tek = d[0] + d[2] + d[4] + d[6] + d[8];
        var cift = d[1] + d[3] + d[5] + d[7];

        if (((tek * 7 - cift) % 10 + 10) % 10 != d[9]) return false;

        return d.Take(10).Sum() % 10 == d[10];
    }

    /// <summary>TR IBAN: 26 karakter, mod 97 = 1</summary>
    public static string IbanSadelestir(string ham)
    {
        var s = new string((ham ?? "").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (s.Length == 0) return "";
        if (s.Length == 24 && s.All(char.IsDigit)) s = "TR" + s;
        return s;
    }

    public static bool IbanGecerli(string iban)
    {
        if (iban is not { Length: 26 } || !iban.StartsWith("TR") || !iban[2..].All(char.IsDigit)) return false;

        var yeni = iban[4..] + iban[..4];
        var mod = 0;

        foreach (var c in yeni)
        {
            var parca = char.IsLetter(c) ? (c - 'A' + 10).ToString() : c.ToString();
            foreach (var p in parca) mod = (mod * 10 + (p - '0')) % 97;
        }

        return mod == 1;
    }

    private static bool Aktif(DateTime? cikis) => cikis is null || cikis.Value.Year <= 1950;

    private static int Yas(DateTime dogum, DateTime gun)
    {
        var y = gun.Year - dogum.Year;
        if (dogum.Date > gun.AddYears(-y)) y--;
        return y;
    }

    /// <summary>Kolonun karşılaştırma anahtarı (en sık değer için)</summary>
    private static string DegerAnahtari(object v) => v switch
    {
        null or DBNull => "\u0000NULL",
        DateTime t => t.ToString("O"),
        string s => s.Trim(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        _ => v.ToString()
    };

    /// <summary>Örneklemde en sık değer (en az %70); yoksa bulunamadı</summary>
    private static (bool Var, object Deger) EnSik(IReadOnlyList<IDictionary<string, object>> ornek, string kolon, double esik = OyBirligi)
    {
        if (ornek.Count == 0) return (false, null);

        var gruplar = ornek
            .Select(r => r.TryGetValue(kolon, out var v) ? v : null)
            .GroupBy(DegerAnahtari)
            .Select(g => (Adet: g.Count(), Deger: g.First()))
            .OrderByDescending(x => x.Adet)
            .ToList();

        var en = gruplar[0];

        return en.Adet >= Math.Ceiling(ornek.Count * esik) ? (true, en.Deger is DBNull ? null : en.Deger) : (false, null);
    }

    private static bool BaglantiHatasi(Exception hata) =>
        hata is SqlException { Number: -2 or 2 or 53 or 4060 or 18456 or 10053 or 10054 or 10060 or 11001 or 233 or 40613 }
        || hata is TimeoutException
        || hata.InnerException is System.Net.Sockets.SocketException;

    /* ==================================================================== */
    /* Mikro okumaları                                                      */
    /* ==================================================================== */

    private sealed class IsGrubu
    {
        public string Kod { get; set; }
        public string Ad { get; set; }
    }

    private static List<IsGrubu> IsGruplari(IDbConnection db, IDbTransaction islem = null) =>
        db.Query<IsGrubu>($@"
SELECT LTRIM(RTRIM(CAST(ig_kod AS NVARCHAR(50)))) AS Kod,
       LTRIM(RTRIM(CAST(ig_adi AS NVARCHAR(200)))) AS Ad
FROM {IsGrupTablosu}
ORDER BY ig_adi", transaction: islem)
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

    /// <summary>Ünvan şablonu: aynı ünvandaki aktif personelde en sık değerler</summary>
    public sealed class UnvanSablonu
    {
        public string Kod { get; set; }
        public string Ad { get; set; }
        public int Adet { get; set; }
        public Dictionary<string, object> Degerler { get; set; } = new(StringComparer.OrdinalIgnoreCase);

        public string Meslek => Degerler.GetValueOrDefault("per_kim_meslek") as string;
        public string Gorev => Convert.ToString(Degerler.GetValueOrDefault("per_kim_gorev"), CultureInfo.InvariantCulture);
        public string MeslekKodu => Convert.ToString(Degerler.GetValueOrDefault("per_meslek_kodu"), CultureInfo.InvariantCulture);
    }

    private static List<UnvanSablonu> UnvanSablonlari(IDbConnection db, ICollection<string> kolonlar, IDbTransaction islem = null)
    {
        var secim = UnvanKolonlari.Where(kolonlar.Contains).Select(k => $"P.[{k}]").ToList();
        secim.Insert(0, "LTRIM(RTRIM(CAST(P.per_unvan_kodu AS NVARCHAR(50)))) AS unvan_kodu");

        var satirlar = db.Query($@"
SELECT {string.Join(", ", secim)}
FROM {Tablo} P WITH (NOLOCK)
WHERE (P.per_cikis_tar IS NULL OR P.per_cikis_tar < '19500101')
  AND P.per_unvan_kodu IS NOT NULL", transaction: islem, commandTimeout: 60)
            .Cast<IDictionary<string, object>>()
            .ToList();

        var adlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var u in db.Query($"SELECT LTRIM(RTRIM(CAST(un_kod AS NVARCHAR(50)))) AS kod, LTRIM(RTRIM(un_aciklama)) AS ad FROM {UnvanTablosu} WITH (NOLOCK)", transaction: islem))
                if ((string)u.kod is { Length: > 0 } uk) adlar[uk] = (string)u.ad;
        }
        catch
        {
            /* Ünvan tanım tablosu yoksa meslek metni ad olur */
        }

        return satirlar
            .GroupBy(r => Convert.ToString(r["unvan_kodu"], CultureInfo.InvariantCulture)?.Trim() ?? "")
            .Where(g => g.Key.Length > 0 && g.Key != "0")
            .Select(g =>
            {
                var liste = g.ToList();
                var s = new UnvanSablonu { Kod = g.Key, Adet = liste.Count };

                foreach (var k in UnvanKolonlari.Where(kolonlar.Contains))
                {
                    var (_, deger) = EnSik(liste, k, 0);
                    s.Degerler[k] = deger is string ds ? ds.Trim() : deger;
                }

                s.Ad = adlar.GetValueOrDefault(g.Key) is { Length: > 0 } ad ? ad : s.Meslek ?? g.Key;
                return s;
            })
            .OrderByDescending(x => x.Adet)
            .ToList();
    }

    /// <summary>
    /// Sıradaki per_kod (09.10.2026): Mikro'da EN SON AÇILAN kartın
    /// numarası + 1 (ör. 15011 → 15012). En büyük numara kullanılmıyor:
    /// tabloda sıra dışı numaralar var (149000 gibi), sıra onlardan devam
    /// etmemeli. Numara Mikro'da başka kartta varsa boş olana kadar artar.
    /// per_sicil_no'ya T.C. kimlik no yazılır; bu numara yalnızca per_kod.
    /// </summary>
    private static int SonrakiKod(IDbConnection db, IDbTransaction islem = null)
    {
        var sonKodlar = db.Query<string>($@"
SELECT TOP 50 LTRIM(RTRIM(per_kod)) FROM {Tablo} WITH (NOLOCK)
WHERE per_create_date IS NOT NULL
ORDER BY per_create_date DESC", transaction: islem, commandTimeout: 30).ToList();

        var son = sonKodlar
            .Select(k => k is { Length: > 0 and <= 9 } && k.All(char.IsDigit) ? int.Parse(k, CultureInfo.InvariantCulture) : (int?)null)
            .FirstOrDefault(k => k is > 0);

        if (son is null) throw new InvalidOperationException("Mikro'da son açılan kartın numarası okunamadı.");

        /* Bir sonraki boş numara */
        var adaylar = Enumerable.Range(son.Value + 1, 100).Select(x => x.ToString(CultureInfo.InvariantCulture)).ToList();
        var dolu = db.Query<string>($@"
SELECT LTRIM(RTRIM(per_kod)) FROM {Tablo} WITH (NOLOCK)
WHERE LTRIM(RTRIM(per_kod)) IN @adaylar", new { adaylar }, islem, commandTimeout: 30)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var bos = adaylar.FirstOrDefault(a => !dolu.Contains(a))
                  ?? throw new InvalidOperationException("Sıradaki 100 sicil numarası dolu.");

        return int.Parse(bos, CultureInfo.InvariantCulture);
    }

    /// <summary>GYRSM (2004BICEN) kayıtları: aynı TC</summary>
    private static List<dynamic> GyrsmKayitlari(IDbConnection db, string tc, IDbTransaction islem = null) =>
        db.Query($@"
SELECT LTRIM(RTRIM(P.per_kod)) AS kod, P.per_giris_tar AS giris, P.per_cikis_tar AS cikis,
       LTRIM(RTRIM(CAST(G.ig_adi AS NVARCHAR(200)))) AS birim
FROM {Tablo} P WITH (NOLOCK)
LEFT JOIN {IsGrupTablosu} G WITH (NOLOCK) ON G.ig_kod = P.per_is_grup_kodu
WHERE LTRIM(RTRIM(P.Per_TcKimlikNo)) = @tc
ORDER BY P.per_giris_tar DESC", new { tc }, islem, commandTimeout: 30).ToList();

    /// <summary>
    /// RSM (MikroDesktop_BICEN) durumu. SALT OKUNUR: yalnızca SELECT.
    /// TC ile, TC yoksa sicil koduyla aranır.
    /// </summary>
    public object RsmDurumu(string tc, string kod)
    {
        tc = Sayilar(tc);
        kod = (kod ?? "").Trim();

        if (tc.Length != 11 && kod.Length == 0) return null;

        try
        {
            using var db = _vt.TahakkukBaglantisi();

            var satir = db.QueryFirstOrDefault($@"
SELECT TOP 1 LTRIM(RTRIM(per_kod)) AS kod, per_giris_tar AS giris, per_cikis_tar AS cikis
FROM {RsmTablo} WITH (NOLOCK)
WHERE (@tc <> '' AND LTRIM(RTRIM(Per_TcKimlikNo)) = @tc)
   OR (@tc = '' AND LTRIM(RTRIM(per_kod)) = @kod)
ORDER BY per_giris_tar DESC", new { tc = tc.Length == 11 ? tc : "", kod }, commandTimeout: 15);

            if (satir is null)
                return new { var = false, aktif = false, kod = (string)null, giris = (DateTime?)null, cikis = (DateTime?)null, mesaj = "RSM'de kaydı yok" };

            var cikis = (DateTime?)satir.cikis;
            var aktif = Aktif(cikis);

            return new
            {
                var = true,
                aktif,
                kod = (string)satir.kod,
                giris = (DateTime?)satir.giris,
                cikis = aktif ? null : cikis,
                mesaj = aktif ? "RSM'de mevcut" : $"RSM'de çıkışı yapılmış ({cikis:dd.MM.yyyy})"
            };
        }
        catch (Exception hata)
        {
            _kayit?.LogWarning(hata, "RSM personel kaydı okunamadı");
            return new { var = (bool?)null, aktif = false, kod = (string)null, giris = (DateTime?)null, cikis = (DateTime?)null, mesaj = "RSM'ye ulaşılamadı" };
        }
    }

    /* ==================================================================== */
    /* Panel: form hazırlığı                                                */
    /* ==================================================================== */

    /// <summary>Panel kullanıcısının Mikro numarası ve Mikro'daki adı</summary>
    public (int? No, string Ad) MikroKullanici(string kullaniciAdi)
    {
        if (string.IsNullOrWhiteSpace(kullaniciAdi)) return (null, null);

        try
        {
            using var yerel = _vt.Baglanti();
            var no = yerel.ExecuteScalar<int?>(
                "SELECT mikro_kullanici_no FROM KRY_KULLANICILAR WHERE kullanici_adi = @k",
                new { k = kullaniciAdi.Trim() });

            if (no is not > 0) return (null, null);

            var anahtar = no.Value.ToString(CultureInfo.InvariantCulture);
            var ad = MikroKullanicilari.Elle.GetValueOrDefault(anahtar) ?? MikroKullanicilari.Bulunan.GetValueOrDefault(anahtar);
            return (no, ad);
        }
        catch
        {
            return (null, null);
        }
    }

    /// <summary>
    /// İşe Al penceresindeki Mikro sicil bölümü: başvurudan ön doldurma,
    /// iş grupları, ünvan şablonları, tahmini sicil no, GYRSM/RSM durumu.
    /// </summary>
    public Sonuc Hazirla(int basvuruId, string kullaniciAdi, IEnumerable<Sube> birimler, Func<string, string> unvanBolumu)
    {
        using var yerel = _vt.Baglanti();

        var b = yerel.QuerySingleOrDefault(@"
SELECT id, ad_soyad, kimlik_no, telefon, sube_kodu, sube_adi, il, ilce, mahalle, veri_json,
       ise_giris_bolum, anlasilan_ucret
FROM KRY_BASVURULAR WHERE id = @basvuruId", new { basvuruId });

        if (b is null) return new Sonuc(404, "Başvuru bulunamadı.");

        JsonElement veri = default;
        try { veri = JsonDocument.Parse((string)b.veri_json ?? "{}").RootElement; } catch { /* boş */ }

        string Al(string ad) =>
            veri.ValueKind == JsonValueKind.Object && veri.TryGetProperty(ad, out var d) && d.ValueKind == JsonValueKind.String
                ? (d.GetString() ?? "").Trim() : "";

        var adSoyad = Sade((string)b.ad_soyad);
        var ad = Al("ad");
        var soyad = Al("soyad");

        if (ad.Length == 0 && adSoyad.Length > 0)
        {
            var parca = adSoyad.Split(' ');
            soyad = parca.Length > 1 ? parca[^1] : "";
            ad = parca.Length > 1 ? string.Join(" ", parca[..^1]) : adSoyad;
        }

        DateTime? dogum = DateTime.TryParseExact(Al("dogumTarihi"), new[] { "dd.MM.yyyy", "yyyy-MM-dd", "d.M.yyyy" }, Tr, DateTimeStyles.None, out var dt)
            ? dt : null;

        var caddeSokak = Buyuk(Al("caddeSokak"));
        var caddeMi = Regex.IsMatch(caddeSokak, @"\bCAD(DE|\.|\b)|\bBULVAR|\bBLV", RegexOptions.IgnoreCase);

        var tel = YoneticiBulucu.TelefonSadelestir(Al("cepTel1")) ?? YoneticiBulucu.TelefonSadelestir((string)b.telefon);

        var oneri = new Girdi
        {
            Ad = Buyuk(ad),
            Soyad = Buyuk(soyad),
            TcKimlikNo = Sayilar((string)b.kimlik_no),
            DogumTarihi = dogum,
            DogumYeri = Buyuk(Al("dogumYeri")),
            MedeniHal = Al("medeniDurum") is "Evli" or "Bekar" ? Al("medeniDurum") : null,
            Tahsil = TahsilKodu(Al("egitimSeviyesi")),
            Telefon = tel,
            Il = Buyuk((string)b.il is { Length: > 0 } il ? il : Al("il")),
            Ilce = Buyuk((string)b.ilce is { Length: > 0 } ilce ? ilce : Al("ilce")),
            Mahalle = Buyuk((string)b.mahalle is { Length: > 0 } mah ? mah : Al("mahalle")),
            Cadde = caddeMi ? caddeSokak : "",
            Sokak = caddeMi ? "" : caddeSokak,
            BinaNo = Buyuk(Al("binaNo")),
            DaireNo = Buyuk(Al("daireNo")),
            Ucret = (decimal?)b.anlasilan_ucret,
            BrutNet = "net",
        };

        if (string.IsNullOrWhiteSpace(oneri.Il)) oneri.Il = "İSTANBUL";

        /* Başvuru formundaki engel durumu → derece (SGK: %80+ 1, %60-79 2, %40-59 3) */
        if (string.Equals(Al("engelDurumuVarMi"), "Evet", StringComparison.OrdinalIgnoreCase))
        {
            int? oran = null;
            if (veri.ValueKind == JsonValueKind.Object && veri.TryGetProperty("engelOrani", out var eo))
            {
                if (eo.ValueKind == JsonValueKind.Number && eo.TryGetInt32(out var o)) oran = o;
                else if (eo.ValueKind == JsonValueKind.String && int.TryParse(eo.GetString(), out var o2)) oran = o2;
            }

            oneri.EngellilikOrani = oran;
            oneri.SakatDerece = oran switch { >= 80 => 1, >= 60 => 2, >= 40 => 3, _ => 3 };
        }
        if (dogum is not null) oneri.Bes = Yas(dogum.Value, DateTime.Today) < 45;

        var (mikroNo, mikroAd) = MikroKullanici(kullaniciAdi);

        try
        {
            using var db = _vt.PersonelBaglantisi();
            db.Open();

            var sema = SemaOku(db);
            var kolonlar = sema.Select(x => x.Ad).ToHashSet(StringComparer.OrdinalIgnoreCase);

            var gruplar = IsGruplari(db);
            var unvanlar = UnvanSablonlari(db, kolonlar);
            var sonraki = SonrakiKod(db);

            /* Panel birimi → Mikro iş grubu (şube adına göre) */
            var birimEsleme = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (var birim in birimler ?? Enumerable.Empty<Sube>())
            {
                var g = gruplar.FirstOrDefault(x => string.Equals(x.Ad, birim.Ad, StringComparison.OrdinalIgnoreCase))
                        ?? gruplar.FirstOrDefault(x => PersonelKaynagiServisi.Benziyor(Anahtar(x.Ad), Anahtar(birim.Ad)));
                if (g is not null && !string.IsNullOrWhiteSpace(birim.Kod)) birimEsleme[birim.Kod.Trim()] = g.Kod;
            }

            var basvuruSube = ((string)b.sube_kodu ?? "").Trim();
            oneri.IsGrubuKodu = birimEsleme.GetValueOrDefault(basvuruSube)
                                ?? gruplar.FirstOrDefault(x => PersonelKaynagiServisi.Benziyor(Anahtar(x.Ad), Anahtar((string)b.sube_adi)))?.Kod;

            /* GYRSM: aynı TC'li kayıtlar */
            object gyrsm = null;
            if (oneri.TcKimlikNo.Length == 11)
            {
                var kayitlar = GyrsmKayitlari(db, oneri.TcKimlikNo);
                var aktif = kayitlar.FirstOrDefault(x => Aktif((DateTime?)x.cikis));
                var eski = kayitlar.FirstOrDefault(x => !Aktif((DateTime?)x.cikis));

                gyrsm = new
                {
                    aktif = aktif is null ? null : new { kod = (string)aktif.kod, birim = (string)aktif.birim, giris = (DateTime?)aktif.giris },
                    eski = eski is null ? null : new { kod = (string)eski.kod, birim = (string)eski.birim, cikis = (DateTime?)eski.cikis },
                    adet = kayitlar.Count
                };
            }

            return new Sonuc(200, null, new
            {
                oneri,
                sonrakiKod = sonraki,
                mikroKullanici = mikroNo is null ? null : new { no = mikroNo, ad = mikroAd },
                isGruplari = gruplar.Select(g => new { kod = g.Kod, ad = g.Ad }),
                birimEsleme,
                unvanlar = unvanlar.Select(u => new
                {
                    kod = u.Kod,
                    ad = u.Ad,
                    adet = u.Adet,
                    meslek = u.Meslek,
                    gorev = u.Gorev,
                    meslekKodu = u.MeslekKodu,
                    bolum = unvanBolumu?.Invoke(u.Ad),
                }),
                tahsiller = Tahsiller.Select(t => new { kod = t.Kod, ad = t.Ad }),
                gyrsm,
                rsm = oneri.TcKimlikNo.Length == 11 ? RsmDurumu(oneri.TcKimlikNo, null) : null,
                kayit = Durum(basvuruId),
            });
        }
        catch (Exception hata) when (BaglantiHatasi(hata))
        {
            _kayit?.LogWarning(hata, "Mikro sicil formu hazırlanamadı");
            return new Sonuc(503, "Mikro'ya ulaşılamadı.");
        }
        catch (Exception hata)
        {
            _kayit?.LogError(hata, "Mikro sicil formu hazırlanamadı");
            return new Sonuc(500, "Mikro'dan okunamadı: " + hata.Message);
        }
    }

    /* ==================================================================== */
    /* Doğrulama                                                            */
    /* ==================================================================== */

    /// <summary>Formu sadeleştirir ve doğrular (Mikro'ya bakmadan)</summary>
    public static string Dogrula(Girdi g)
    {
        if (g is null) return "Mikro sicil bilgileri eksik.";

        g.Ad = Buyuk(g.Ad);
        g.Soyad = Buyuk(g.Soyad);
        g.TcKimlikNo = Sayilar(g.TcKimlikNo);
        g.DogumYeri = Buyuk(g.DogumYeri);
        g.Il = Buyuk(g.Il);
        g.Ilce = Buyuk(g.Ilce);
        g.Semt = Buyuk(g.Semt);
        g.Mahalle = Buyuk(g.Mahalle);
        g.Cadde = Buyuk(g.Cadde);
        g.Sokak = Buyuk(g.Sokak);
        g.BinaNo = Buyuk(g.BinaNo);
        g.DaireNo = Buyuk(g.DaireNo);
        g.Meslek = Buyuk(g.Meslek);
        g.IsGrubuKodu = Sade(g.IsGrubuKodu);
        g.UnvanKodu = Sade(g.UnvanKodu);
        g.Iban = IbanSadelestir(g.Iban);
        g.Cinsiyet = Sade(g.Cinsiyet).ToUpperInvariant() switch { "E" or "ERKEK" => "E", "K" or "KADIN" => "K", _ => null };
        g.MedeniHal = Sade(g.MedeniHal) switch { "Evli" or "EVLİ" => "Evli", "Bekar" or "Bekâr" or "BEKAR" => "Bekar", _ => null };
        g.BrutNet = string.Equals(Sade(g.BrutNet), "brut", StringComparison.OrdinalIgnoreCase) ? "brut" : "net";

        if (g.Ad.Length < 2) return "Mikro sicil: ad giriniz.";
        if (g.Soyad.Length < 2) return "Mikro sicil: soyad giriniz.";
        if (!TcGecerli(g.TcKimlikNo)) return "Mikro sicil: T.C. kimlik numarası geçersiz.";
        if (g.Cinsiyet is null) return "Mikro sicil: cinsiyet seçiniz.";
        if (g.DogumTarihi is null) return "Mikro sicil: doğum tarihi giriniz.";

        var yas = Yas(g.DogumTarihi.Value, DateTime.Today);
        if (yas < 15 || yas > 80) return "Mikro sicil: doğum tarihi hatalı görünüyor.";

        if (g.MedeniHal is null) return "Mikro sicil: medeni hâli seçiniz.";

        var tel = YoneticiBulucu.TelefonSadelestir(g.Telefon);
        if (tel is null) return "Mikro sicil: cep telefonu 5 ile başlayan 10 haneli olmalı.";
        g.Telefon = tel;

        if (g.IsGrubuKodu.Length == 0) return "Mikro sicil: şube / iş grubu seçiniz.";
        if (g.UnvanKodu.Length == 0) return "Mikro sicil: Mikro ünvanını seçiniz.";
        if (g.Ucret is null or <= 0) return "Mikro sicil: ücret giriniz.";
        if (g.Ucret > 10_000_000) return "Mikro sicil: ücret hatalı görünüyor.";
        if (g.Iban.Length > 0 && !IbanGecerli(g.Iban)) return "Mikro sicil: IBAN geçersiz (TR ile başlayan 26 karakter).";
        if (g.Tahsil is < 0 or > 20) g.Tahsil = null;
        if (g.SakatDerece is < 0 or > 3) return "Mikro sicil: engellilik derecesi 0-3 olmalı.";
        if (g.SakatDerece == 0) g.EngellilikOrani = null;
        if (g.EngellilikOrani is < 0 or > 100) return "Mikro sicil: engellilik oranı 0-100 olmalı.";
        if (g.SigortaGrubu is < 0 or > 4) return "Mikro sicil: sigorta grubunu seçiniz.";

        g.Bes ??= yas < 45;

        return null;
    }

    /* ==================================================================== */
    /* Kuyruk (kariyer veritabanı)                                          */
    /* ==================================================================== */

    /// <summary>İşe Al: doğrulanmış bilgileri onay için saklar</summary>
    public string Sakla(IDbConnection yerel, int basvuruId, Girdi g, DateTime giris, string isteyen)
    {
        var (no, _) = MikroKullanici(isteyen);
        if (no is null)
            return "Mikro'da sicil açabilmek için Yönetim › Kullanıcılar'da Mikro kullanıcı numaranızın tanımlı olması gerekir.";

        g.GirisTarihi = giris.Date;

        yerel.Execute(@"
UPDATE KRY_MIKRO_SICIL SET durum = @iptal, guncelleme = SYSDATETIME(), veri_json = NULL
WHERE basvuru_id = @basvuruId AND durum IN (@bekliyor, @hata);

INSERT INTO KRY_MIKRO_SICIL (basvuru_id, durum, veri_json, isteyen, mikro_kullanici_no)
VALUES (@basvuruId, @bekliyor, @json, @isteyen, @no);",
            new
            {
                basvuruId,
                iptal = Iptal,
                bekliyor = Bekliyor,
                hata = HataDurumu,
                json = JsonSerializer.Serialize(g),
                isteyen,
                no
            });

        return null;
    }

    /// <summary>Bekleyen isteği iptal eder (İşe Al tiksiz yeniden gönderildi, ya da işe alım reddedildi)</summary>
    public void Kapat(IDbConnection yerel, int basvuruId, string neden)
    {
        try
        {
            yerel.Execute(@"
UPDATE KRY_MIKRO_SICIL SET durum = @iptal, hata = @neden, veri_json = NULL, guncelleme = SYSDATETIME()
WHERE basvuru_id = @basvuruId AND durum IN (@bekliyor, @hata)",
                new { basvuruId, iptal = Iptal, bekliyor = Bekliyor, hata = HataDurumu, neden });
        }
        catch (Exception hata)
        {
            _kayit?.LogWarning(hata, "Mikro sicil isteği kapatılamadı");
        }
    }

    /// <summary>Başvurunun son Mikro sicil isteği (ekranda)</summary>
    public object Durum(int basvuruId)
    {
        try
        {
            using var yerel = _vt.Baglanti();

            var r = yerel.QueryFirstOrDefault(@"
SELECT TOP 1 id, durum, isteyen, mikro_kullanici_no, per_kod, hata, olusturma, acilma, deneme, son_deneyen
FROM KRY_MIKRO_SICIL WHERE basvuru_id = @basvuruId ORDER BY id DESC", new { basvuruId });

            if (r is null) return null;

            return new
            {
                id = (int)r.id,
                durum = (string)r.durum,
                isteyen = (string)r.isteyen,
                mikroKullaniciNo = (int?)r.mikro_kullanici_no,
                sicil = (string)r.per_kod,
                hata = (string)r.hata,
                olusturma = (DateTime)r.olusturma,
                acilma = (DateTime?)r.acilma,
                deneme = (int)r.deneme,
            };
        }
        catch (Exception hata)
        {
            _kayit?.LogWarning(hata, "Mikro sicil durumu okunamadı");
            return null;
        }
    }

    /* ==================================================================== */
    /* Kartı açma                                                           */
    /* ==================================================================== */

    /// <summary>
    /// İşe alım onaylanınca çağrılır: bekleyen istek varsa kartı açar.
    /// Hata onayı durdurmaz; istek "hata" olur ve isteyene bildirilir.
    /// </summary>
    public static void OnaydaAc(VeritabaniServisi vt, int basvuruId, string onaylayan)
    {
        try
        {
            var s = new MikroSicilServisi(vt);
            if (s.BekleyenVar(basvuruId)) s.Ac(basvuruId, onaylayan);
        }
        catch
        {
            /* Ac kendi hatasını kaydediyor */
        }
    }

    public bool BekleyenVar(int basvuruId)
    {
        using var yerel = _vt.Baglanti();
        return yerel.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_MIKRO_SICIL WHERE basvuru_id = @basvuruId AND durum IN (@b, @h)",
            new { basvuruId, b = Bekliyor, h = HataDurumu }) > 0;
    }

    /// <summary>Kartı Mikro'da açar (onayda ya da yeniden denemede)</summary>
    public Sonuc Ac(int basvuruId, string tetikleyen)
    {
        using var yerel = _vt.Baglanti();

        var istek = yerel.QueryFirstOrDefault(@"
SELECT TOP 1 id, durum, veri_json, isteyen, mikro_kullanici_no
FROM KRY_MIKRO_SICIL
WHERE basvuru_id = @basvuruId
  AND (durum IN (@b, @h) OR (durum = N'aciliyor' AND guncelleme < DATEADD(minute, -15, SYSDATETIME())))
ORDER BY id DESC", new { basvuruId, b = Bekliyor, h = HataDurumu });

        if (istek is null) return new Sonuc(404, "Bekleyen Mikro sicil isteği yok.");

        int istekId = istek.id;
        string isteyen = istek.isteyen;
        int? mikroNo = istek.mikro_kullanici_no;

        /* Aynı isteği iki kişi aynı anda açmasın: durum "aciliyor" */
        var alindi = yerel.Execute(@"
UPDATE KRY_MIKRO_SICIL SET durum = N'aciliyor', deneme = deneme + 1, son_deneyen = @tetikleyen, guncelleme = SYSDATETIME()
WHERE id = @istekId
  AND (durum IN (@b, @h) OR (durum = N'aciliyor' AND guncelleme < DATEADD(minute, -15, SYSDATETIME())))",
            new { istekId, tetikleyen, b = Bekliyor, h = HataDurumu });

        if (alindi == 0) return new Sonuc(409, "Bu kart şu anda açılıyor.");

        /* Bu denemenin işareti: son durum yalnızca bu deneme hâlâ sürüyorsa yazılır */
        var token = yerel.ExecuteScalar<int>("SELECT deneme FROM KRY_MIKRO_SICIL WHERE id = @istekId", new { istekId });

        Sonuc sonuc;

        try
        {
            var g = JsonSerializer.Deserialize<Girdi>((string)istek.veri_json ?? "{}");
            sonuc = mikroNo is > 0
                ? Yaz(g, mikroNo.Value, $"{isteyen} · {tetikleyen}", basvuruId)
                : new Sonuc(400, "Mikro kullanıcı numarası tanımlı değil.");
        }
        catch (Exception hata)
        {
            _kayit?.LogError(hata, "Mikro sicil açılamadı: başvuru {Id}", basvuruId);
            sonuc = new Sonuc(500, "Mikro sicil açılamadı: " + hata.Message);
        }

        if (sonuc.Basarili)
        {
            var kod = (string)((dynamic)sonuc.Veri).sicil;

            try
            {
                /* Kart açıldı: IBAN ve ücret artık kuyrukta tutulmuyor. "acildi"
                   koşulsuz yazılır: kart Mikro'da var, gerçeği bu. */
                yerel.Execute(@"
UPDATE KRY_MIKRO_SICIL
SET durum = @acildi, per_kod = @kod, acilma = SYSDATETIME(), hata = NULL, veri_json = NULL, guncelleme = SYSDATETIME()
WHERE id = @istekId", new { istekId, acildi = Acildi, kod });

                yerel.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
SELECT id, durum, @aciklama, @kullanici FROM KRY_BASVURULAR WHERE id = @basvuruId",
                    new { basvuruId, aciklama = $"Mikro'da sicil kartı açıldı · Sicil {kod} · Mikro kullanıcısı {mikroNo}", kullanici = isteyen });
            }
            catch (Exception hata)
            {
                _kayit?.LogCritical(hata, "Mikro sicil kartı {Kod} AÇILDI ama kariyer kaydı güncellenemedi (başvuru {Id})", kod, basvuruId);
            }

            Bildir(yerel, isteyen, basvuruId, $"Mikro sicil kartı açıldı · {kod}",
                $"Personelin Mikro sicil kartı {kod} numarasıyla açıldı (MikroDesktop_2004BICEN).");
        }
        else
        {
            /* Yalnızca bu deneme hâlâ sürüyorsa: arada başka deneme kartı
               açtıysa onun "acildi" durumu ezilmez */
            var yazildi = yerel.Execute(@"
UPDATE KRY_MIKRO_SICIL SET durum = @hata, hata = @mesaj, guncelleme = SYSDATETIME()
WHERE id = @istekId AND durum = N'aciliyor' AND deneme = @token",
                new { istekId, hata = HataDurumu, mesaj = Kirp(sonuc.Mesaj, 1000), token });

            if (yazildi == 0) return sonuc;

            Bildir(yerel, isteyen, basvuruId, "Mikro sicil kartı AÇILAMADI",
                $"{sonuc.Mesaj} Başvuru kartındaki 'Mikro'da aç' düğmesiyle yeniden deneyebilirsiniz.");
        }

        return sonuc;
    }

    private void Bildir(IDbConnection yerel, string kullanici, int basvuruId, string baslik, string metin)
    {
        if (string.IsNullOrWhiteSpace(kullanici)) return;

        try
        {
            yerel.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin, basvuru_id)
VALUES (@kullanici, N'MikroSicil', @baslik, @metin, @basvuruId)",
                new { kullanici, baslik, metin, basvuruId });
        }
        catch (Exception hata)
        {
            _kayit?.LogWarning(hata, "Mikro sicil bildirimi yazılamadı");
        }
    }

    private static string Kirp(string d, int azami = 400) =>
        d is null ? null : d.Length > azami ? d[..azami] : d;

    /// <summary>Mikro'daki prosedür (araclar/sql/BK_PERSONEL_SICIL_AC.sql)</summary>
    public const string Prosedur = Veritabani + ".dbo.BK_PERSONEL_SICIL_AC";

    /// <summary>
    /// Kartı Mikro'daki BK_PERSONEL_SICIL_AC prosedürüyle açar (09.10.2026).
    /// Kartın hangi kolonuna ne yazılacağı yalnızca prosedürde: panel ve
    /// SSMS'ten elle çağrı aynı kartı açar. Prosedür kurulu değilse kart
    /// açılmaz, kurulum söylenir.
    /// </summary>
    private Sonuc Yaz(Girdi g, int mikroNo, string yapan, int basvuruId)
    {
        var hataMetni = Dogrula(g);
        if (hataMetni is not null) return new Sonuc(400, hataMetni);

        if (g.GirisTarihi is null) return new Sonuc(400, "İşe giriş tarihi yok.");

        IDbConnection db;

        try
        {
            db = _vt.PersonelBaglantisi();
            db.Open();
        }
        catch (Exception hata)
        {
            _kayit?.LogError(hata, "Mikro bağlantısı açılamadı (sicil açma)");
            return new Sonuc(503, "Mikro'ya ulaşılamadı; kart açılmadı.");
        }

        using (db)
        {
            try
            {
                if (db.ExecuteScalar<int?>($"SELECT OBJECT_ID('{Prosedur}', 'P')") is null)
                    return new Sonuc(500,
                        "Mikro'da BK_PERSONEL_SICIL_AC prosedürü kurulu değil. araclar/sql/BK_PERSONEL_SICIL_AC.sql " +
                        "dosyasını SSMS'te Mikro sunucusunda bir kez çalıştırın, sonra 'Tekrar dene'ye basın.");
            }
            catch (Exception hata) when (BaglantiHatasi(hata))
            {
                return new Sonuc(503, "Mikro'ya ulaşılamadı; kart açılmadı.");
            }

            /* Önce günlük: kayıt dışarıda kalmadan Mikro'ya yazılmaz */
            List<int> gunluk;

            try
            {
                gunluk = Gunluk("(açılıyor)", yapan,
                    $"{g.Ad} {g.Soyad} · iş grubu {g.IsGrubuKodu} · ünvan {g.UnvanKodu} · giriş {g.GirisTarihi:dd.MM.yyyy} · başvuru #{basvuruId}");
            }
            catch (Exception hata)
            {
                _kayit?.LogError(hata, "Mikro sicil günlüğü yazılamadı");
                return new Sonuc(500, "Değişiklik günlüğü yazılamadığı için kart açılmadı.");
            }

            var p = new DynamicParameters();
            p.Add("MikroKullanici", mikroNo);
            p.Add("Ad", g.Ad);
            p.Add("Soyad", g.Soyad);
            p.Add("TcKimlikNo", g.TcKimlikNo);
            p.Add("Cinsiyet", (byte)(g.Cinsiyet == "K" ? 1 : 0));
            p.Add("MedeniHal", (byte)(g.MedeniHal == "Evli" ? 0 : 1));
            p.Add("DogumTarihi", g.DogumTarihi!.Value.Date);
            p.Add("DogumYeri", g.DogumYeri ?? "");
            p.Add("Tahsil", (byte)(g.Tahsil ?? 0));
            p.Add("Telefon", g.Telefon);
            p.Add("Il", g.Il ?? "");
            p.Add("Ilce", g.Ilce ?? "");
            p.Add("Semt", g.Semt ?? "");
            p.Add("Mahalle", g.Mahalle ?? "");
            p.Add("Cadde", g.Cadde ?? "");
            p.Add("Sokak", g.Sokak ?? "");
            p.Add("BinaNo", g.BinaNo ?? "");
            p.Add("DaireNo", g.DaireNo ?? "");
            p.Add("IsGrubuKodu", g.IsGrubuKodu);
            p.Add("UnvanKodu", g.UnvanKodu);
            p.Add("Meslek", g.Meslek ?? "");
            p.Add("GirisTarihi", g.GirisTarihi.Value.Date);
            p.Add("Ucret", g.Ucret!.Value);
            p.Add("BrutNet", (byte)(g.BrutNet == "brut" ? 0 : 1));
            p.Add("AsgariUcretli", (byte)(g.AsgariUcretli ? 1 : 0));
            p.Add("Iban", g.Iban ?? "");
            p.Add("Bes", (byte)(g.Bes == true ? 1 : 0));
            p.Add("SakatDerece", (byte)g.SakatDerece);
            p.Add("EngellilikOrani", (byte)(g.SakatDerece == 0 ? 0 : g.EngellilikOrani ?? 0));
            p.Add("SigortaGrubu", (byte)g.SigortaGrubu);
            p.Add("Kontrol", false);
            p.Add("PerKod", dbType: DbType.String, size: 25, direction: ParameterDirection.Output);

            try
            {
                db.Execute(Prosedur, p, commandType: CommandType.StoredProcedure, commandTimeout: 120);

                var kod = p.Get<string>("PerKod");
                if (string.IsNullOrWhiteSpace(kod))
                {
                    GunlukDurumu(gunluk, "BASARISIZ");
                    return new Sonuc(500, "Prosedür sicil numarası döndürmedi; kartı Mikro'dan kontrol edin.");
                }

                GunlukKodu(gunluk, kod.Trim());
                GunlukDurumu(gunluk, "TAMAM");
                PersonelKaynagiServisi.OnbellegiTemizle();

                _kayit?.LogInformation("Mikro sicil kartı açıldı (prosedür): {Kod} · başvuru {Basvuru} · {Yapan}", kod, basvuruId, yapan);

                return new Sonuc(200, $"Mikro'da sicil kartı açıldı: {kod.Trim()}", new { sicil = kod.Trim() });
            }
            catch (Exception hata)
            {
                _kayit?.LogError(hata, "Mikro sicil prosedürü hata verdi: başvuru {Basvuru}", basvuruId);

                /* Bağlantı sonuçtan önce koptuysa kart açılmış olabilir */
                if (BaglantiHatasi(hata) && AktifKod(g.TcKimlikNo) is { } acilan)
                {
                    GunlukKodu(gunluk, acilan);
                    GunlukDurumu(gunluk, "TAMAM");
                    return new Sonuc(200, $"Mikro'da sicil kartı açıldı: {acilan}", new { sicil = acilan });
                }

                GunlukDurumu(gunluk, "BASARISIZ");

                if (BaglantiHatasi(hata)) return new Sonuc(503, "Mikro'ya ulaşılamadı; kart açılmadı.");

                /* Prosedürün RAISERROR iletileri doğrudan kullanıcıya */
                return new Sonuc(hata is SqlException { Number: 50000 } ? 409 : 500,
                    hata is SqlException { Number: 50000 } ? hata.Message : "Mikro'ya yazılamadı, kart açılmadı: " + hata.Message);
            }
        }
    }

    /// <summary>Bu TC'nin aktif kartı (yazma sonucu belirsiz kaldığında)</summary>
    private string AktifKod(string tc)
    {
        try
        {
            using var db = _vt.PersonelBaglantisi();
            return db.ExecuteScalar<string>($@"
SELECT TOP 1 LTRIM(RTRIM(per_kod)) FROM {Tablo} WITH (NOLOCK)
WHERE LTRIM(RTRIM(Per_TcKimlikNo)) = @tc AND (per_cikis_tar IS NULL OR per_cikis_tar < '19500101')
  AND per_create_date >= DATEADD(minute, -10, GETDATE())", new { tc }, commandTimeout: 30);
        }
        catch
        {
            return null;
        }
    }

    private void GunlukKodu(List<int> idler, string kod)
    {
        try
        {
            using var yerel = _vt.Baglanti();
            yerel.Execute("UPDATE KRY_PERSONEL_MIKRO_DEGISIKLIK SET personel_kodu = @kod WHERE id IN @idler", new { kod, idler });
        }
        catch (Exception hata)
        {
            _kayit?.LogWarning(hata, "Mikro sicil günlüğüne kod yazılamadı");
        }
    }

    private List<int> Gunluk(string kod, string yapan, string ozet)
    {
        using var yerel = _vt.Baglanti();

        var id = yerel.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_MIKRO_DEGISIKLIK
    (personel_kodu, alan, kolon, eski, yeni, yapan, hedef, durum)
OUTPUT INSERTED.id
VALUES (@kod, N'Sicil kartı açıldı', N'INSERT', NULL, @ozet, @yapan, N'MIKRO', N'YAZILIYOR')",
            new { kod, ozet = Kirp(ozet), yapan = Kirp(yapan, 150) });

        return new List<int> { id };
    }

    private void GunlukDurumu(List<int> idler, string durum)
    {
        if (idler is null || idler.Count == 0) return;

        try
        {
            using var yerel = _vt.Baglanti();
            yerel.Execute("UPDATE KRY_PERSONEL_MIKRO_DEGISIKLIK SET durum = @durum WHERE id IN @idler", new { durum, idler });
        }
        catch (Exception hata)
        {
            _kayit?.LogWarning(hata, "Mikro sicil günlük durumu güncellenemedi");
        }
    }
}

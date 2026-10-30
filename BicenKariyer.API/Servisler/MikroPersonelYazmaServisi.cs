using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Personel kartından düzenlenen bilgileri Mikro'nun PERSONELLER tablosuna
/// yazar (02.10.2026).
///
/// <para>
/// <b>Mikro üretim veritabanıdır.</b> Bu yüzden yazma kuralları dar tutuldu
/// (<see cref="MikroResimServisi"/>'nin güvenlik yaklaşımı izlendi):
/// </para>
/// <list type="bullet">
///   <item>Yalnızca <see cref="Alanlar"/> listesindeki kolonlara yazılır.
///   Hepsi panelin zaten OKUDUĞU kolonlardır (PersonelKaynagiServisi ve
///   personel kartının adres satırı): okuduğumuz kolondan başka bir yere
///   yazılmaz. Ücret, giriş/çıkış tarihi, TC kimlik, SGK, çıkış sebebi ve
///   personel kodu listede yoktur; bunlar Mikro'dan değiştirilir.</item>
///   <item>Kolonun varlığı, tipi ve uzunluğu her kayıtta Mikro'nun kendi
///   şemasından (sys.columns) okunur; sürüm farkında yanlış tipe ya da
///   sığmayan değere yazılmaz.</item>
///   <item>Yalnızca gerçekten değişen kolonlar gönderilir. Panelin açıldığı
///   andaki değer, Mikro'daki güncel değerle tutmuyorsa (bu arada Mikro'dan
///   biri değiştirmişse) hiçbir şey yazılmaz.</item>
///   <item>Değişiklik kaydı (KRY_PERSONEL_MIKRO_DEGISIKLIK) Mikro'ya
///   yazmadan ÖNCE kendi veritabanımıza alınır; alınamazsa Mikro'ya
///   dokunulmaz. Eski değer orada durduğu için her değişiklik elle geri
///   alınabilir.</item>
///   <item>Güncelleme tek işlem (transaction) içinde, per_Guid ile ve
///   satır kilidiyle yapılır; tam olarak bir satır etkilenmezse geri
///   alınır.</item>
/// </list>
/// </summary>
public class MikroPersonelYazmaServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<MikroPersonelYazmaServisi> _kayit;

    public MikroPersonelYazmaServisi(
        VeritabaniServisi vt,
        IConfiguration yapilandirma,
        ILogger<MikroPersonelYazmaServisi> kayit)
    {
        _vt = vt;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private const string Veritabani = "[MikroDesktop_2004BICEN]";
    private const string Tablo = Veritabani + ".dbo.PERSONELLER";
    private const string IsGrupTablosu = Veritabani + ".dbo.PERSONEL_IS_GRUP_TANIMLARI";

    /// <summary>Panelde düzenlenebilen bir Mikro alanı.</summary>
    /// <param name="Anahtar">Panel ile sunucu arasındaki ad</param>
    /// <param name="Kolon">PERSONELLER tablosundaki kolon (okunduğu kolonun aynısı)</param>
    /// <param name="Etiket">Ekranda ve değişiklik kaydında görünen ad</param>
    /// <param name="Tur">metin · telefon · isGrubu</param>
    /// <param name="Grup">kimlik · gorev · adres (formdaki bölüm)</param>
    /// <param name="Zorunlu">Boş bırakılamaz</param>
    /// <param name="YetkiAlani">Rol yetkisinde gizlenebilen alan (telefon, adres)</param>
    public sealed record AlanTanimi(
        string Anahtar, string Kolon, string Etiket, string Tur, string Grup,
        bool Zorunlu = false, string YetkiAlani = null);

    /// <summary>
    /// Yazılabilen alanların tamamı. Buraya alan eklemeden önce kolonun
    /// panelde zaten okunduğundan ve bordro/SGK açısından kritik olmadığından
    /// emin olunmalı.
    /// </summary>
    public static readonly AlanTanimi[] Alanlar =
    {
        /* PersonelKaynagiServisi.TumPersonelleriGetir okuyor */
        new("ad",      "per_adi",          "Ad",              "metin",   "kimlik", Zorunlu: true),
        new("soyad",   "per_soyadi",       "Soyad",           "metin",   "kimlik", Zorunlu: true),
        new("telefon", "per_tel_cepno",    "Cep telefonu",    "telefon", "kimlik", Zorunlu: true,
            YetkiAlani: YetkiServisi.Telefon),
        new("isGrubu", "per_is_grup_kodu", "Şube / iş grubu", "isGrubu", "gorev",  Zorunlu: true),
        new("meslek",  "per_kim_meslek",   "Ünvan / meslek",  "metin",   "gorev"),

        /* PersonelController.AdresBirlestir okuyor (personel kartı adresi) */
        new("adrIl",         "per_adr_il",          "İl",       "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrIlce",       "per_adr_ilce",        "İlçe",     "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrSemt",       "per_adr_semt",        "Semt",     "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrMahalle",    "per_adr_mahalle",     "Mahalle",  "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrCadde",      "per_adr_cadde",       "Cadde",    "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrSokak",      "per_adr_sokak",       "Sokak",    "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrApartmanNo", "per_adr_apartman_no", "Bina no",  "metin", "adres", YetkiAlani: YetkiServisi.Adres),
        new("adrDaireNo",    "per_adr_daire_no",    "Daire no", "metin", "adres", YetkiAlani: YetkiServisi.Adres),
    };

    private static readonly string[] MetinTipleri = { "nvarchar", "varchar", "nchar", "char" };
    private static readonly string[] SayiTipleri = { "int", "smallint", "tinyint", "bigint" };

    /// <summary>Mikro şemasındaki kolon bilgisi.</summary>
    private sealed class Kolon
    {
        public string Ad { get; set; }
        public string Tip { get; set; }
        public int Uzunluk { get; set; }

        public bool Metin => MetinTipleri.Contains(Tip, StringComparer.OrdinalIgnoreCase);
        public bool Sayi => SayiTipleri.Contains(Tip, StringComparer.OrdinalIgnoreCase);

        /// <summary>Karakter cinsinden üst sınır; MAX kolonlar 4000 ile sınırlanır.</summary>
        public int AzamiKarakter =>
            Uzunluk < 0 ? 4000
            : Tip.StartsWith("n", StringComparison.OrdinalIgnoreCase) ? Uzunluk / 2
            : Uzunluk;
    }

    /// <summary>Formda gösterilecek tek alan.</summary>
    public sealed class FormAlani
    {
        public string Anahtar { get; set; }
        public string Etiket { get; set; }
        public string Kolon { get; set; }
        public string Tur { get; set; }
        public string Grup { get; set; }
        public bool Zorunlu { get; set; }
        public string Deger { get; set; }
        public int Uzunluk { get; set; }
        public bool Duzenlenebilir { get; set; }

        /// <summary>Düzenlenemiyorsa sebebi</summary>
        public string Neden { get; set; }
    }

    /// <summary>İşlem sonucu; Durum HTTP koduna karşılık gelir.</summary>
    public sealed record Sonuc(int Durum, string Mesaj, object Veri = null)
    {
        public bool Basarili => Durum is >= 200 and < 300;
    }

    public const string UlasilamadiMesaji = "Mikro'ya ulaşılamadı, değişiklik kaydedilmedi";

    /* ==================================================================== */
    /* Şema                                                                  */
    /* ==================================================================== */

    private static Dictionary<string, Kolon> KolonlariOku(IDbConnection db, IDbTransaction islem = null)
    {
        var adlar = Alanlar.Select(x => x.Kolon)
            .Concat(new[] { "per_lastup_user", "per_lastup_date", "per_Guid", "per_kod" })
            .ToArray();

        /* TYPE_NAME(system_type_id): kullanıcı tanımlı tip takma adı yerine
           temel SQL tipi (nvarchar, int…) gelsin. */
        return db.Query<Kolon>($@"
SELECT c.name AS Ad, TYPE_NAME(c.system_type_id) AS Tip, c.max_length AS Uzunluk
FROM {Veritabani}.sys.columns c
WHERE c.object_id = OBJECT_ID('{Tablo}')
  AND c.is_computed = 0
  AND c.name IN @adlar", new { adlar }, islem)
            .ToDictionary(x => x.Ad, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Mikro'daki iş grubu tanımları (kod, ad).</summary>
    public static List<(string Kod, string Ad)> IsGruplari(IDbConnection db, IDbTransaction islem = null) =>
        db.Query<(string Kod, string Ad)>($@"
SELECT LTRIM(RTRIM(CAST(ig_kod AS NVARCHAR(50)))) AS Kod,
       LTRIM(RTRIM(CAST(ig_adi AS NVARCHAR(200)))) AS Ad
FROM {IsGrupTablosu}
ORDER BY ig_adi", transaction: islem)
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

    /// <summary>
    /// Personelin Mikro kaydını kodla bulur. Kod tekil değilse ya da kayıt
    /// yoksa hata metni döner. Kilit alınmaz; asıl okuma işlem içinde
    /// per_Guid ile kilitli yapılır.
    /// </summary>
    private static (Guid? Guid, string Hata) KayitBul(IDbConnection db, string kod)
    {
        var guidler = db.Query<Guid>($@"
SELECT per_Guid FROM {Tablo}
WHERE LTRIM(RTRIM(per_kod)) = @kod", new { kod }).ToList();

        if (guidler.Count == 0)
            return (null, "Personel Mikro'da bulunamadı.");

        if (guidler.Count > 1)
            return (null, "Bu personel kodu Mikro'da birden fazla kayıtta geçiyor; " +
                          "güvenli olmadığı için panelden değiştirilemez, Mikro'dan düzenleyin.");

        return (guidler[0], null);
    }

    /// <summary>Güncel değerleri okur (kolon adı → metin).</summary>
    private static Dictionary<string, string> DegerleriOku(
        IDbConnection db, Guid guid, Dictionary<string, Kolon> kolonlar,
        IDbTransaction islem = null, bool kilitle = false)
    {
        var secimler = Alanlar
            .Where(a => kolonlar.ContainsKey(a.Kolon))
            .Select(a => $"CAST(P.[{a.Kolon}] AS NVARCHAR(4000)) AS [{a.Kolon}]")
            .ToList();

        var sonuc = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (secimler.Count == 0) return sonuc;

        /* Kilit: UPDLOCK + ROWLOCK, per_Guid üzerinden tek satır. Mikro'da
           per_Guid birincil anahtar; tabloyu taramadan tek satır kilitlenir. */
        var ipucu = kilitle ? " WITH (UPDLOCK, ROWLOCK)" : "";

        var satir = (IDictionary<string, object>)db.QueryFirstOrDefault(
            $"SELECT {string.Join(", ", secimler)} FROM {Tablo} P{ipucu} WHERE P.per_Guid = @guid",
            new { guid }, islem);

        if (satir is null) return null;

        foreach (var (k, v) in satir)
            sonuc[k] = (v as string)?.Trim() ?? "";

        return sonuc;
    }

    /* ==================================================================== */
    /* Form                                                                  */
    /* ==================================================================== */

    /// <summary>
    /// Formun güncel değerlerini Mikro'dan okur. Rolden gizli alanlar
    /// (telefon, adres) değersiz ve düzenlenemez döner.
    /// </summary>
    public Sonuc FormOku(string personelKodu, Func<string, bool> gizli)
    {
        var kod = (personelKodu ?? "").Trim();

        if (kod.Length == 0) return new Sonuc(400, "Personel kodu gereklidir.");

        try
        {
            using var db = _vt.PersonelBaglantisi();
            db.Open();

            var (guid, hata) = KayitBul(db, kod);
            if (guid is null) return new Sonuc(404, hata);

            var kolonlar = KolonlariOku(db);
            var degerler = DegerleriOku(db, guid.Value, kolonlar)
                           ?? new Dictionary<string, string>();

            var gruplar = IsGruplari(db);

            var alanlar = Alanlar.Select(a =>
            {
                var alan = new FormAlani
                {
                    Anahtar = a.Anahtar,
                    Etiket = a.Etiket,
                    Kolon = a.Kolon,
                    Tur = a.Tur,
                    Grup = a.Grup,
                    Zorunlu = a.Zorunlu,
                    Deger = degerler.GetValueOrDefault(a.Kolon),
                    Duzenlenebilir = true
                };

                if (!kolonlar.TryGetValue(a.Kolon, out var k))
                {
                    alan.Duzenlenebilir = false;
                    alan.Neden = "Bu Mikro sürümünde kolon yok.";
                }
                else
                {
                    alan.Uzunluk = k.AzamiKarakter;

                    var tipUygun = a.Tur == "isGrubu" ? k.Metin || k.Sayi : k.Metin;

                    if (!tipUygun)
                    {
                        alan.Duzenlenebilir = false;
                        alan.Neden = $"Mikro kolon tipi ({k.Tip}) desteklenmiyor.";
                    }
                }

                if (a.YetkiAlani is not null && gizli(a.YetkiAlani))
                {
                    alan.Deger = null;
                    alan.Duzenlenebilir = false;
                    alan.Neden = "Rolünüzden gizli alan.";
                }

                return alan;
            }).ToList();

            return new Sonuc(200, null, new
            {
                alanlar,
                isGruplari = gruplar.Select(g => new { kod = g.Kod, ad = g.Ad })
            });
        }
        catch (Exception hata) when (BaglantiHatasi(hata))
        {
            _kayit.LogWarning(hata, "Mikro personel formu okunamadı: {Kod}", kod);
            return new Sonuc(503, "Mikro'ya ulaşılamadı.");
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Mikro personel formu okunamadı: {Kod}", kod);
            return new Sonuc(500, "Mikro'dan okunamadı: " + hata.Message);
        }
    }

    /* ==================================================================== */
    /* Yazma                                                                 */
    /* ==================================================================== */

    /// <summary>
    /// Değişen alanları Mikro'ya yazar.
    /// </summary>
    /// <param name="degerler">anahtar → yeni değer (yalnızca gönderilenler)</param>
    /// <param name="onceki">anahtar → formun açıldığı andaki değer; Mikro'daki
    /// güncel değerle tutmazsa yazılmaz</param>
    /// <param name="gizli">rol yetkisinde alan gizli mi</param>
    public Sonuc Yaz(string personelKodu,
                     Dictionary<string, string> degerler,
                     Dictionary<string, string> onceki,
                     string yapan,
                     Func<string, bool> gizli,
                     string kullaniciAdi = null)
    {
        var kod = (personelKodu ?? "").Trim();

        if (kod.Length == 0) return new Sonuc(400, "Personel kodu gereklidir.");

        degerler ??= new Dictionary<string, string>();
        onceki ??= new Dictionary<string, string>();

        /* ------------------------------------------------- beyaz liste */
        var tanimlar = new List<(AlanTanimi Tanim, string Yeni)>();

        foreach (var (anahtar, deger) in degerler)
        {
            var tanim = Alanlar.FirstOrDefault(x =>
                string.Equals(x.Anahtar, anahtar, StringComparison.OrdinalIgnoreCase));

            if (tanim is null)
                return new Sonuc(400, $"Bu alan panelden değiştirilemez: {anahtar}");

            if (tanim.YetkiAlani is not null && gizli(tanim.YetkiAlani))
                return new Sonuc(403, $"{tanim.Etiket} alanı rolünüzden gizli; değiştiremezsiniz.");

            tanimlar.Add((tanim, deger));
        }

        if (tanimlar.Count == 0)
            return new Sonuc(200, "Değişiklik yok.", new { degisen = 0 });

        IDbConnection db;

        try
        {
            db = _vt.PersonelBaglantisi();
            db.Open();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Mikro bağlantısı açılamadı (personel düzenleme): {Kod}", kod);
            return new Sonuc(503, UlasilamadiMesaji);
        }

        using (db)
        {
            Guid guid;
            Dictionary<string, Kolon> kolonlar;
            List<(string Kod, string Ad)> gruplar;

            try
            {
                var (bulunan, hata) = KayitBul(db, kod);
                if (bulunan is null) return new Sonuc(404, hata);

                guid = bulunan.Value;
                kolonlar = KolonlariOku(db);
                gruplar = tanimlar.Any(x => x.Tanim.Tur == "isGrubu")
                    ? IsGruplari(db)
                    : new List<(string, string)>();
            }
            catch (Exception hata) when (BaglantiHatasi(hata))
            {
                _kayit.LogError(hata, "Mikro personel kaydı okunamadı: {Kod}", kod);
                return new Sonuc(503, UlasilamadiMesaji);
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Mikro personel kaydı okunamadı: {Kod}", kod);
                return new Sonuc(500, "Mikro kaydı okunamadı, değişiklik kaydedilmedi: " + hata.Message);
            }

            /* ----------------------------------------- doğrula ve sadeleştir */
            var hazir = new List<(AlanTanimi Tanim, Kolon Kolon, string Yeni, object Parametre)>();

            foreach (var (tanim, ham) in tanimlar)
            {
                if (!kolonlar.TryGetValue(tanim.Kolon, out var kolon))
                    return new Sonuc(400, $"{tanim.Etiket}: Mikro'da kolon bulunamadı ({tanim.Kolon}).");

                var (yeni, parametre, hata) = Dogrula(tanim, kolon, ham, gruplar);

                if (hata is not null) return new Sonuc(400, hata);

                hazir.Add((tanim, kolon, yeni, parametre));
            }

            /* ---------------------------------------------------- işlem */
            IDbTransaction islem = null;
            List<int> kayitIdleri = null;

            try
            {
                islem = db.BeginTransaction(IsolationLevel.ReadCommitted);

                /* Mikro kullanıcısı kaydı açık tutuyorsa sonsuza dek
                   beklenmez; 5 saniyede vazgeçilir. */
                db.Execute("SET LOCK_TIMEOUT 5000;", transaction: islem);

                var guncel = DegerleriOku(db, guid, kolonlar, islem, kilitle: true);

                if (guncel is null)
                {
                    islem.Rollback();
                    return new Sonuc(404, "Personel Mikro'da bulunamadı.");
                }

                /* Yalnızca değişenler; panel açıldıktan sonra Mikro'da
                   değişmişse durdurulur. */
                var degisen = new List<(AlanTanimi Tanim, Kolon Kolon, string Eski, string Yeni, object Parametre)>();
                var catisan = new List<string>();

                foreach (var h in hazir)
                {
                    var eski = guncel.GetValueOrDefault(h.Tanim.Kolon) ?? "";

                    if (onceki.TryGetValue(h.Tanim.Anahtar, out var gorulen) &&
                        !string.Equals((gorulen ?? "").Trim(), eski, StringComparison.Ordinal))
                    {
                        catisan.Add(h.Tanim.Etiket);
                        continue;
                    }

                    if (string.Equals(eski, h.Yeni, StringComparison.Ordinal)) continue;

                    degisen.Add((h.Tanim, h.Kolon, eski, h.Yeni, h.Parametre));
                }

                if (catisan.Count > 0)
                {
                    islem.Rollback();
                    return new Sonuc(409,
                        "Bu bilgiler siz formu açtıktan sonra Mikro'da değiştirilmiş: " +
                        string.Join(", ", catisan) + ". Formu yeniden açıp tekrar deneyin; " +
                        "hiçbir değişiklik kaydedilmedi.");
                }

                if (degisen.Count == 0)
                {
                    islem.Rollback();
                    return new Sonuc(200, "Değişiklik yok.", new { degisen = 0 });
                }

                /* ------------------------------------- önce değişiklik kaydı
                   Mikro'ya yazmadan önce kendi veritabanımıza alınır; eski
                   değer elimizde kalmadan üretim verisine dokunulmaz. */
                try
                {
                    kayitIdleri = DegisiklikKaydiYaz(kod, yapan,
                        degisen.Select(d => (d.Tanim.Etiket, d.Tanim.Kolon, d.Eski, d.Yeni)));
                }
                catch (Exception hata)
                {
                    _kayit.LogError(hata, "Mikro değişiklik kaydı yazılamadı: {Kod}", kod);
                    islem.Rollback();
                    return new Sonuc(500,
                        "Değişiklik kaydı tutulamadığı için işlem durduruldu; Mikro'ya hiçbir şey yazılmadı.");
                }

                /* ----------------------------------------------- güncelle */
                var p = new DynamicParameters();
                p.Add("guid", guid);

                var atamalar = new List<string>();

                for (var i = 0; i < degisen.Count; i++)
                {
                    atamalar.Add($"[{degisen[i].Kolon.Ad}] = @d{i}");
                    p.Add($"d{i}", degisen[i].Parametre);
                }

                /* Mikro'nun kendi "son değiştiren" kolonları: tarih her zaman,
                   kullanıcı numarası yalnızca ayarda tanımlıysa (yanlış bir
                   Mikro kullanıcısına bağlamaktansa önceki değer kalsın). */
                if (kolonlar.TryGetValue("per_lastup_date", out var tarihKolonu) &&
                    TYPE_TARIH.Contains(tarihKolonu.Tip, StringComparer.OrdinalIgnoreCase))
                {
                    atamalar.Add("[per_lastup_date] = GETDATE()");
                }

                /* Önce panel kullanıcısının kendi Mikro numarası
                   (Yönetim › Kullanıcılar, 09.10.2026), yoksa genel ayar */
                var mikroKullanici = PanelMikroNo(kullaniciAdi) ?? MikroKullaniciNo();

                if (mikroKullanici is not null &&
                    kolonlar.TryGetValue("per_lastup_user", out var kullaniciKolonu) &&
                    kullaniciKolonu.Sayi)
                {
                    atamalar.Add("[per_lastup_user] = @mikroKullanici");
                    p.Add("mikroKullanici", mikroKullanici.Value);
                }

                /* @@ROWCOUNT güncellemenin hemen ardından alınır; tetikleyici
                   olsa bile etkilenen satır sayısı bu ifadenin sayısıdır. */
                var etkilenen = db.ExecuteScalar<int>($@"
DECLARE @n INT;
UPDATE {Tablo} SET {string.Join(", ", atamalar)} WHERE per_Guid = @guid;
SET @n = @@ROWCOUNT;
SELECT @n;", p, islem, commandTimeout: 30);

                if (etkilenen != 1)
                {
                    islem.Rollback();
                    DegisiklikDurumu(kayitIdleri, "BASARISIZ");

                    _kayit.LogError("Mikro personel güncellemesi {Adet} satırı etkiledi, geri alındı: {Kod}",
                        etkilenen, kod);

                    return new Sonuc(500,
                        $"Mikro'da {etkilenen} satır etkilendi (1 bekleniyordu); işlem geri alındı.");
                }

                islem.Commit();
                islem = null;

                DegisiklikDurumu(kayitIdleri, "TAMAM");

                _kayit.LogInformation(
                    "Mikro personel kaydı güncellendi: {Kod} · {Alanlar} · {Yapan}",
                    kod, string.Join(", ", degisen.Select(d => d.Kolon.Ad)), yapan);

                /* Personel listesi önbelleği: değişiklik hemen görünsün */
                PersonelKaynagiServisi.OnbellegiTemizle();

                return new Sonuc(200, "Mikro'da güncellendi", new
                {
                    degisen = degisen.Count,
                    alanlar = degisen.Select(d => new { alan = d.Tanim.Etiket, eski = d.Eski, yeni = d.Yeni })
                });
            }
            catch (Exception hata)
            {
                try { islem?.Rollback(); } catch { /* bağlantı kopmuşsa zaten geri alınır */ }

                if (kayitIdleri is not null) DegisiklikDurumu(kayitIdleri, "BASARISIZ");

                _kayit.LogError(hata, "Mikro personel kaydı güncellenemedi: {Kod}", kod);

                if (hata is SqlException { Number: 1222 })
                    return new Sonuc(409,
                        "Kayıt şu anda Mikro'da başka bir kullanıcı tarafından açık; " +
                        "biraz sonra tekrar deneyin. Değişiklik kaydedilmedi.");

                if (BaglantiHatasi(hata))
                    return new Sonuc(503, UlasilamadiMesaji);

                return new Sonuc(500, "Mikro'ya yazılamadı, değişiklik kaydedilmedi: " + hata.Message);
            }
        }
    }

    private static readonly string[] TYPE_TARIH = { "datetime", "datetime2", "smalldatetime", "date" };

    /// <summary>
    /// Mikro'da "son değiştiren" olarak yazılacak kullanıcı numarası
    /// (appsettings: Personel:MikroKullaniciNo). Tanımlı değilse null.
    /// </summary>
    /// <summary>Panel kullanıcısının Mikro kullanıcı numarası (KRY_KULLANICILAR.mikro_kullanici_no)</summary>
    public int? PanelMikroNo(string kullaniciAdi)
    {
        if (string.IsNullOrWhiteSpace(kullaniciAdi)) return null;

        try
        {
            using var yerel = _vt.Baglanti();
            var no = yerel.ExecuteScalar<int?>(
                "SELECT mikro_kullanici_no FROM KRY_KULLANICILAR WHERE kullanici_adi = @k",
                new { k = kullaniciAdi.Trim() });
            return no is > 0 ? no : null;
        }
        catch
        {
            return null;
        }
    }

    private int? MikroKullaniciNo() =>
        int.TryParse(_yapilandirma["Personel:MikroKullaniciNo"], out var no) && no > 0 ? no : null;

    /// <summary>
    /// Bir alanın yeni değerini doğrular ve Mikro'ya yazılacak biçime getirir.
    /// </summary>
    private static (string Yeni, object Parametre, string Hata) Dogrula(
        AlanTanimi tanim, Kolon kolon, string ham, List<(string Kod, string Ad)> gruplar)
    {
        /* Kontrol karakterleri atılır, iç boşluklar teke indirilir */
        var temiz = string.Join(" ",
            new string((ham ?? "").Select(c => char.IsControl(c) ? ' ' : c).ToArray())
                .Split(' ', StringSplitOptions.RemoveEmptyEntries));

        if (tanim.Zorunlu && temiz.Length == 0)
            return (null, null, $"{tanim.Etiket} boş bırakılamaz.");

        switch (tanim.Tur)
        {
            case "telefon":
            {
                var tel = YoneticiBulucu.TelefonSadelestir(temiz);

                if (tel is null)
                    return (null, null, "Cep telefonu 5 ile başlayan 10 haneli olmalı (ör. 5321234567).");

                if (!kolon.Metin)
                    return (null, null, $"{tanim.Etiket}: Mikro kolon tipi desteklenmiyor ({kolon.Tip}).");

                if (tel.Length > kolon.AzamiKarakter)
                    return (null, null, $"{tanim.Etiket} Mikro'da en fazla {kolon.AzamiKarakter} karakter olabilir.");

                return (tel, tel, null);
            }

            case "isGrubu":
            {
                var grup = gruplar.FirstOrDefault(g =>
                    string.Equals(g.Kod, temiz, StringComparison.OrdinalIgnoreCase));

                if (grup.Kod is null)
                    return (null, null, $"Şube / iş grubu kodu Mikro'da tanımlı değil: {temiz}");

                if (kolon.Sayi)
                {
                    if (!long.TryParse(grup.Kod, out var sayi))
                        return (null, null, "Şube / iş grubu kodu sayı değil.");

                    return (grup.Kod, sayi, null);
                }

                if (!kolon.Metin)
                    return (null, null, $"{tanim.Etiket}: Mikro kolon tipi desteklenmiyor ({kolon.Tip}).");

                if (grup.Kod.Length > kolon.AzamiKarakter)
                    return (null, null, $"{tanim.Etiket} kodu kolona sığmıyor.");

                return (grup.Kod, grup.Kod, null);
            }

            default:
            {
                if (!kolon.Metin)
                    return (null, null, $"{tanim.Etiket}: Mikro kolon tipi desteklenmiyor ({kolon.Tip}).");

                if (temiz.Length > kolon.AzamiKarakter)
                    return (null, null,
                        $"{tanim.Etiket} Mikro'da en fazla {kolon.AzamiKarakter} karakter olabilir " +
                        $"(girilen {temiz.Length}).");

                /* varchar/char kolonlar Türkçe kod sayfasında; karşılığı
                   olmayan karakter (emoji vb.) '?' olarak yazılırdı. */
                if (!kolon.Tip.StartsWith("n", StringComparison.OrdinalIgnoreCase) &&
                    temiz.Any(c => c > 0x2FF))
                    return (null, null, $"{tanim.Etiket} desteklenmeyen karakter içeriyor.");

                return (temiz, temiz, null);
            }
        }
    }

    /* ==================================================================== */
    /* Değişiklik kaydı (kariyer veritabanı)                                 */
    /* ==================================================================== */

    /// <summary>
    /// Değişiklikleri KRY_PERSONEL_MIKRO_DEGISIKLIK tablosuna YAZILIYOR
    /// durumuyla ekler; Mikro işlemi bitince durum güncellenir.
    /// </summary>
    private List<int> DegisiklikKaydiYaz(string kod, string yapan,
        IEnumerable<(string Alan, string Kolon, string Eski, string Yeni)> satirlar)
    {
        using var yerel = _vt.Baglanti();
        yerel.Open();
        using var islem = yerel.BeginTransaction();

        var idler = new List<int>();

        foreach (var s in satirlar)
        {
            idler.Add(yerel.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_MIKRO_DEGISIKLIK
    (personel_kodu, alan, kolon, eski, yeni, yapan, hedef, durum)
OUTPUT INSERTED.id
VALUES (@kod, @alan, @kolon, @eski, @yeni, @yapan, N'MIKRO', N'YAZILIYOR')",
                new
                {
                    kod,
                    alan = s.Alan,
                    kolon = s.Kolon,
                    eski = Kirp(s.Eski),
                    yeni = Kirp(s.Yeni),
                    yapan = Kirp(yapan, 150)
                }, islem));
        }

        islem.Commit();

        return idler;
    }

    private void DegisiklikDurumu(List<int> idler, string durum)
    {
        if (idler is null || idler.Count == 0) return;

        try
        {
            using var yerel = _vt.Baglanti();

            yerel.Execute(
                "UPDATE KRY_PERSONEL_MIKRO_DEGISIKLIK SET durum = @durum WHERE id IN @idler",
                new { durum, idler });
        }
        catch (Exception hata)
        {
            /* Mikro işlemi zaten bitti; kayıt YAZILIYOR durumunda kalır ve
               panelde öyle görünür. */
            _kayit.LogWarning(hata, "Değişiklik kaydı durumu güncellenemedi ({Durum})", durum);
        }
    }

    /// <summary>
    /// Kariyer sisteminde tutulan bir değişikliğin (yol ücreti) kaydı.
    /// </summary>
    public void KariyerDegisikligiYaz(IDbConnection yerel, IDbTransaction islem,
        string kod, string alan, string eski, string yeni, string yapan)
    {
        yerel.Execute(@"
INSERT INTO KRY_PERSONEL_MIKRO_DEGISIKLIK
    (personel_kodu, alan, kolon, eski, yeni, yapan, hedef, durum)
VALUES (@kod, @alan, N'KRY_PERSONEL_YOL', @eski, @yeni, @yapan, N'KARIYER', N'TAMAM')",
            new { kod, alan, eski = Kirp(eski), yeni = Kirp(yeni), yapan = Kirp(yapan, 150) }, islem);
    }

    /// <summary>Bir personelin son değişiklikleri (en yeni önce).</summary>
    public List<dynamic> Gecmis(string kod, int adet = 15)
    {
        try
        {
            using var yerel = _vt.Baglanti();

            return yerel.Query($@"
SELECT TOP {Math.Clamp(adet, 1, 100)}
       id, alan, eski, yeni, yapan, zaman, hedef, durum
FROM KRY_PERSONEL_MIKRO_DEGISIKLIK
WHERE personel_kodu = @kod
ORDER BY zaman DESC, id DESC", new { kod = (kod ?? "").Trim() }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel değişiklik geçmişi okunamadı: {Kod}", kod);
            return new List<dynamic>();
        }
    }

    private static string Kirp(string d, int azami = 400) =>
        d is null ? null : d.Length > azami ? d[..azami] : d;

    /// <summary>Bağlantı/ağ kaynaklı hata mı (sorgu hatası değil).</summary>
    private static bool BaglantiHatasi(Exception hata) =>
        hata is SqlException { Number: -2 or 2 or 53 or 4060 or 18456 or 10053 or 10054 or 10060 or 11001 or 233 or 40613 }
        || hata is InvalidOperationException { Message: var m } && m.Contains("ConnectionStrings", StringComparison.OrdinalIgnoreCase)
        || hata is TimeoutException
        || hata.InnerException is System.Net.Sockets.SocketException;
}

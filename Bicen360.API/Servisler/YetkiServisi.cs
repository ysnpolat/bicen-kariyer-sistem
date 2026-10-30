using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// İki katmanlı yetki çözümü.
///
/// <para>
/// <b>Katmanlar.</b> Panel yetkisi role ya da kullanıcıya verilir, mobil
/// yetkisi pozisyona ya da kullanıcıya. Her iki alanda da kullanıcı satırı
/// alt katmanı ezer: pozisyona kapalı olan bir modül tek bir kişiye
/// açılabilir, herkese açık olan bir modül tek bir kişiye kapatılabilir.
/// </para>
///
/// <para>
/// <b>Tanımsız ile kapalı farklıdır.</b> Bir kod için kullanıcı satırı yoksa
/// alt katmana düşülür. Satır varsa <c>izin = 0</c> olsa bile düşülmez; aksi
/// hâlde kişiye özel kapatma diye bir şey olmazdı.
/// </para>
///
/// <para>
/// <b>Panelde varsayılan kapalıdır, mobilde açık.</b> Panel sayfaları yönetim
/// ekranları; tanımsız bir sayfayı açık saymak, yeni bir sayfa eklendiğinde
/// onu herkese açar. Mobil modüllerde tersi geçerli: Kariyer panelindeki
/// mevcut davranış "liste boşsa kısıtlama yok" ve mobil tarafta yeni modül
/// kimsenin göremediği bir durumda kalmamalı.
/// </para>
///
/// <para>
/// <b>Panelde gizlemek koruma değildir.</b> Menüden çıkarmak yalnızca
/// görünümü etkiler; asıl denetim her uçta <see cref="SayfaAcik"/> ile
/// yapılır.
/// </para>
/// </summary>
public class YetkiServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly RolServisi _roller;

    public YetkiServisi(VeritabaniServisi vt, RolServisi roller)
    {
        _vt = vt;
        _roller = roller;
    }

    /// <summary>Kariyer sistemindeki tam yetkili rol.</summary>
    public const string Admin = "Admin";

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Kullanıcının açabileceği panel sayfaları.
    ///
    /// Admin her zaman hepsini görür. Yetki tablosu boşken sistemin
    /// kimsenin giremediği bir hâlde kalmaması için gerekli.
    /// </summary>
    public List<string> Sayfalari(string kullaniciAdi, string rol)
    {
        if (Adminmi(rol))
            return Katalog.Sayfalar.Select(x => x.Kod).ToList();

        var satirlar = Satirlar(Alan.Panel, Kapsam.Kullanici, kullaniciAdi,
                                            Kapsam.Rol, rol);

        var portal = _roller.KullaniciRolu(kullaniciAdi);

        return Katalog.Sayfalar
            .Where(s => PortalCoz(satirlar, portal, s.Kod))
            .Select(s => s.Kod)
            .ToList();
    }

    /// <summary>
    /// Portal rolü atanmış kullanıcıda sıra: kişiye özel satır → portal
    /// rolü (13.10.2026). Rolde olmayan sayfa kapalı; eski rol satırlarına
    /// düşülmez. "Tüm departmanlar" rolün kapsam seçiminden gelir.
    /// </summary>
    private static bool PortalCoz(List<YetkiSatiri> satirlar, RolServisi.PortalRol portal, string kod)
    {
        if (portal is null) return Coz(satirlar, kod, Kapsam.Rol, varsayilan: false);

        var kisi = satirlar.FirstOrDefault(x =>
            string.Equals(x.Kapsam, Kapsam.Kullanici, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

        if (kisi is not null) return kisi.Izin;

        return kod == "tum-departmanlar" ? portal.TumDepartmanlar : portal.Seviye(kod) > 0;
    }

    /// <summary>
    /// Sayfada yönetim yetkisi (arıza: durum ve atama, envanter: ekleme ve
    /// düzenleme). Portal rolü yoksa sayfa açıksa yönetir sayılır (eski
    /// davranış); rolde "yönetir" ayrıca işaretlenir.
    /// </summary>
    public bool SayfaYonetir(string kullaniciAdi, string rol, string kod)
    {
        if (Adminmi(rol)) return true;

        var portal = _roller.KullaniciRolu(kullaniciAdi);

        return portal is null
            ? SayfaAcik(kullaniciAdi, rol, kod)
            : portal.Seviye(kod) >= RolServisi.Yonetir;
    }

    /// <summary>Kullanıcının portal rolü (yoksa null)</summary>
    public RolServisi.PortalRol PortalRolu(string kullaniciAdi) => _roller.KullaniciRolu(kullaniciAdi);

    /// <summary>Tek bir sayfa açık mı. Uçlarda bu kullanılır.</summary>
    public bool SayfaAcik(string kullaniciAdi, string rol, string kod)
    {
        if (Adminmi(rol)) return true;

        var satirlar = Satirlar(Alan.Panel, Kapsam.Kullanici, kullaniciAdi,
                                            Kapsam.Rol, rol);

        return PortalCoz(satirlar, _roller.KullaniciRolu(kullaniciAdi), kod);
    }

    /// <summary>
    /// Kullanıcı bu panele girebilir mi.
    ///
    /// <c>KRY_KULLANICILAR</c> tablosuna "Biçen360'a girebilir" diye bir
    /// sütun eklenmedi: o tabloyu Kariyer API kuruyor ve göç ettiriyor,
    /// iki uygulamanın aynı tablonun şemasını değiştirmesi er geç çakışır.
    /// Bunun yerine kural şu: en az bir sayfaya yetkisi olan girebilir.
    /// Yetkiler zaten panel bazında ayrı tutuluyor, İK panelindeki yetkisi
    /// buraya taşınmıyor.
    /// </summary>
    public bool PanelAcik(string kullaniciAdi, string rol) =>
        Adminmi(rol) || Sayfalari(kullaniciAdi, rol).Count > 0;

    /* ==================================================================== */
    /* Mobil                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Personelin görebileceği Biçen360 modülleri.
    ///
    /// <paramref name="anahtarKullanici"/> personelin sicil numarası,
    /// <paramref name="pozisyon"/> görev adı.
    /// </summary>
    public List<string> Modulleri(string anahtarKullanici, string pozisyon)
    {
        /* İki katman: kişi → grup.

           Eskiden araya ünvan katmanı giriyordu ve aynı pozisyona üç dört
           ayrı yerden yetki verilebiliyordu: ünvan satırı, grup satırı,
           kişi satırı. Hangisinin geçtiği ekrandan anlaşılmıyordu. Artık
           yetki grupta tanımlanıyor; kişiye özel satır yalnızca gruptan
           farklı bir istisna için. Eski ünvan satırları tabloda dursa da
           okunmuyor. */
        return KisiDetaylari(anahtarKullanici, pozisyon)
            .Values
            .Where(c => c.Sonuc)
            .Select(c => c.Kod)
            .ToList();
    }

    /// <summary>Bir modülün kişideki çözümü: gruptan geleni ve kişiye özel olanı.</summary>
    public record ModulCozum(string Kod, bool? Grup, bool? Kisi, bool Varsayilan, bool Sonuc);

    /// <summary>
    /// Bir modül için grup değeri, kişiye özel değer ve sonuç.
    ///
    /// Varsayılan her modülde "açık", izin onayı hariç: o ekranı tanımsız
    /// bırakmak herkese şubesinin izinlerini onaylatmak demekti; tanım yoksa
    /// ünvan kuralına bakılıyor (müdür, yardımcı değil).
    /// </summary>
    public ModulCozum KisiDetay(string sicil, string pozisyon, string kod)
    {
        var tumu = KisiDetaylari(sicil, pozisyon);

        return tumu.TryGetValue(kod, out var c)
            ? c
            : new ModulCozum(kod, null, null, true, true);
        /* Katalogda olmayan kod: eski davranış (açık) */
    }

    /// <summary>Kişinin bütün mobil modüllerinin çözümü, tek sorguyla.</summary>
    public Dictionary<string, ModulCozum> KisiDetaylari(string sicil, string pozisyon)
    {
        var grup = GrupBul(pozisyon);

        var grupSatirlari = string.IsNullOrWhiteSpace(grup)
            ? new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
            : Oku(Alan.Mobil, Kapsam.Grup, grup);

        var kisiSatirlari = string.IsNullOrWhiteSpace(sicil)
            ? new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
            : Oku(Alan.Mobil, Kapsam.Kullanici, sicil.Trim());

        var sonuc = new Dictionary<string, ModulCozum>(StringComparer.OrdinalIgnoreCase);

        foreach (var m in Katalog.MobilModuller)
        {
            bool? g = grupSatirlari.TryGetValue(m.Kod, out var gv) ? gv : null;
            bool? k = kisiSatirlari.TryGetValue(m.Kod, out var kv) ? kv : null;

            /* İzin onayı tanımsızken: grubun onay ayarı varsa o, yoksa
               ünvan kuralı. Kariyer servisindeki menü hesabıyla aynı sıra;
               ayrışırsa portal "görür" derken mobil göstermezdi. */
            var varsayilan =
                m.Kod == "izinonay" ? IzinOnayVarsayilani(pozisyon)
                : m.VarsayilanAcik;

            sonuc[m.Kod] = new ModulCozum(m.Kod, g, k, varsayilan, k ?? g ?? varsayilan);
        }

        return sonuc;
    }

    /// <summary>
    /// Puantaj tanımsızken: bölge müdürü ya da İK'nın izin onay tablosunda
    /// 1. onaylayan olarak geçen pozisyon. Kariyer servisindeki menü
    /// hesabıyla aynı kural; kişiye özel ekranda doğru "görür/görmez"
    /// yazsın diye.
    /// </summary>
    private bool PuantajVarsayilani(string pozisyon)
    {
        var a = Anahtar(pozisyon);

        if (a.Contains("bolgemudur")) return true;

        try
        {
            using var db = _vt.Baglanti();

            return db.Query<string>("SELECT onay1 FROM KRY_IZIN_ONAY_KURAL WHERE aktif = 1")
                .Any(x => Anahtar(x) == a);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>İzin onayı modülünün tanımsızken aldığı değer.</summary>
    private bool IzinOnayVarsayilani(string pozisyon)
    {
        try
        {
            using var db = _vt.Baglanti();

            var hedef = Anahtar(pozisyon);

            foreach (var g in db.Query(@"
SELECT G.id, G.pozisyonlar, A.ayar
FROM KRY_POZISYON_GRUBU G
    LEFT JOIN B360_GRUP_AYAR A ON A.grup_id = G.id
WHERE G.aktif = 1 ORDER BY G.sira, G.ad"))
            {
                var uyuyor = ((string)g.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Any(x => Anahtar(x) == hedef);

                if (!uyuyor) continue;

                if (string.IsNullOrWhiteSpace((string)g.ayar)) break;

                var ayar = System.Text.Json.JsonSerializer.Deserialize<GrupAyari>(
                    (string)g.ayar,
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

                return ayar is not null && (ayar.HaftalikIzinOnay || ayar.YillikIzinKademe is not null);
            }
        }
        catch
        {
            /* Tablo yoksa ünvan kuralına düşülüyor */
        }

        return OnayUnvani(pozisyon);
    }

    /// <summary>İzin onayında tanım yokken kullanılan ünvan kuralı.</summary>
    public static bool OnayUnvani(string pozisyon)
    {
        var a = Anahtar(pozisyon);

        return a.Contains("mudur") && !a.Contains("yardimci");
    }

    /// <summary>
    /// Ünvanın bağlı olduğu pozisyon grubunun adı.
    ///
    /// Gruplar Kariyer tarafında tanımlanıyor; portal aynı veritabanındaki
    /// tabloyu okuyor. Tablo yoksa ya da ünvan hiçbir gruba bağlı değilse
    /// null dönüyor ve yetki çözümü eskisi gibi yalnızca ünvana bakıyor.
    /// </summary>
    /// <summary>
    /// Grup çözümünde oluşan son hata; teşhis için okunuyor.
    /// </summary>
    public static string SonGrupHatasi { get; private set; }

    /// <summary>Tanı ekranı için: ünvanın bağlı olduğu grup.</summary>
    public string GrupAdi(string pozisyon) => GrupBul(pozisyon);

    private string GrupBul(string pozisyon)
    {
        if (string.IsNullOrWhiteSpace(pozisyon)) return null;

        try
        {
            using var db = _vt.Baglanti();

            var hedef = Anahtar(pozisyon);

            foreach (var g in db.Query(@"
SELECT ad, pozisyonlar FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad"))
            {
                var uyuyor = ((string)g.pozisyonlar ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Any(x => Anahtar(x) == hedef);

                if (uyuyor) return (string)g.ad;
            }
        }
        catch (Exception hata)
        {
            /* Tablo yoksa grup katmanı devre dışı kalır.

               Hata daha önce tamamen yutuluyordu: grup yetkileri sessizce
               uygulanmıyor ve sebebi hiçbir yerde görünmüyordu. */
            SonGrupHatasi = hata.Message;
        }

        return null;
    }

    /// <summary>
    /// Ünvan karşılaştırması için sadeleştirilmiş anahtar.
    ///
    /// Büyük/küçük harf, Türkçe harfler, noktalama ve boşluk atılıyor:
    /// "Mağaza Müdürü", "MAĞAZA MÜDÜRÜ" ve "Mağaza Müdürü " aynı anahtara
    /// düşüyor. Aynı iş üç ayrı yerde üç farklı biçimde yapılıyordu ve
    /// yetki ekranında verilen tanım mobilde tutmuyordu.
    /// </summary>
    public static string Anahtar(string metin) =>
        new string((metin ?? "")
            .ToLowerInvariant()
            .Replace('ı', 'i').Replace('ş', 's').Replace('ğ', 'g')
            .Replace('ü', 'u').Replace('ö', 'o').Replace('ç', 'c')
            .Where(char.IsLetterOrDigit)
            .ToArray());

    /* ==================================================================== */
    /* Okuma ve yazma                                                       */
    /* ==================================================================== */

    /// <summary>Yetki ekranı için: bir anahtarın tanımlı satırları.</summary>
    public Dictionary<string, bool> Oku(string alan, string kapsam, string anahtar)
    {
        using var db = _vt.Baglanti();

        return db.Query<(string kod, bool izin)>(@"
SELECT kod, izin FROM B360_YETKI
WHERE alan = @alan AND kapsam = @kapsam AND anahtar = @anahtar",
            new { alan, kapsam, anahtar })
            .ToDictionary(x => x.kod, x => x.izin, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Bir anahtarın yetkilerini yazar.
    ///
    /// Gönderilen listede olmayan kodların satırı silinir; böylece bir kodu
    /// "tanımsız" hâline geri döndürmek mümkün olur.
    /// </summary>
    public void Yaz(string alan, string kapsam, string anahtar,
                    Dictionary<string, bool> yetkiler, string yapan)
    {
        yetkiler ??= new();

        using var db = _vt.Baglanti();
        db.Open();

        using var islem = db.BeginTransaction();

        db.Execute(@"
DELETE FROM B360_YETKI
WHERE alan = @alan AND kapsam = @kapsam AND anahtar = @anahtar",
            new { alan, kapsam, anahtar }, islem);

        foreach (var (kod, izin) in yetkiler)
        {
            /* Katalogda olmayan kod yazılmaz: yazım hatası ya da kaldırılmış
               bir sayfa tabloda ölü satır olarak kalmasın. */
            var gecerli = alan == Alan.Panel ? Katalog.SayfaVar(kod) : Katalog.ModulVar(kod);

            if (!gecerli) continue;

            db.Execute(@"
INSERT INTO B360_YETKI (alan, kapsam, anahtar, kod, izin, guncelleyen)
VALUES (@alan, @kapsam, @anahtar, @kod, @izin, @yapan)",
                new { alan, kapsam, anahtar, kod, izin, yapan }, islem);
        }

        islem.Commit();
    }

    /* ==================================================================== */
    /* İç işleyiş                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Yönetici rolü. Rapor kapsamı da bunu kullanıyor; üst seviye yetkiyi
    /// iki ayrı yerde tanımlamak, birini güncelleyip diğerini unutmaya
    /// açık bırakıyordu.
    /// </summary>
    public static bool Adminmi(string rol) =>
        string.Equals(rol, Admin, StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Kullanıcı ve alt katman satırlarını tek sorguda çeker.
    ///
    /// İki ayrı sorgu her sayfa denetiminde iki gidiş dönüş demekti.
    /// </summary>
    private List<YetkiSatiri> Satirlar(
        string alan, string ustKapsam, string ustAnahtar,
                     string altKapsam, string altAnahtar,
                     string ucuncuKapsam = null, string ucuncuAnahtar = null)
    {
        if (string.IsNullOrWhiteSpace(ustAnahtar) &&
            string.IsNullOrWhiteSpace(altAnahtar) &&
            string.IsNullOrWhiteSpace(ucuncuAnahtar))
            return new();

        using var db = _vt.Baglanti();

        try
        {
            return Sorgula(db, alan, ustKapsam, ustAnahtar, altKapsam, altAnahtar,
                           ucuncuKapsam, ucuncuAnahtar);
        }
        catch (Microsoft.Data.SqlClient.SqlException hata) when (hata.Number == 208)
        {
            /* 208 = 'Invalid object name'. Tablolar kurulamamış demektir;
               açılışta CREATE TABLE yetkisi olmayan bir hesapla
               çalışıldığında oluyor. Ham SQL hatası yerine ne yapılacağını
               söylemek, giriş ekranında anlaşılmaz bir 500 görmekten iyi. */
            throw new InvalidOperationException(
                "Biçen360 tabloları oluşturulmamış. Bicen360.API/kurulum.sql " +
                "dosyasını SSMS ile biPortal üzerinde çalıştırınız.", hata);
        }
    }

    private static List<YetkiSatiri> Sorgula(
        System.Data.IDbConnection db,
        string alan, string ustKapsam, string ustAnahtar,
                     string altKapsam, string altAnahtar,
                     string ucuncuKapsam, string ucuncuAnahtar)
    {
        /* Eşleşme veritabanında değil bellekte yapılıyor.

           SQL'de "anahtar = @deger" tam metin karşılaştırması, ünvan
           adındaki tek bir boşluk ya da harf farkı yüzünden tutmuyordu:
           yetki ekranında verilen tanım mobilde hiç uygulanmıyor, sebebi
           de hiçbir yerde görünmüyordu. Alan bazında satır sayısı birkaç
           yüzü geçmiyor, hepsini çekip sadeleştirilmiş anahtarla
           karşılaştırmak hem doğru hem yeterince hızlı. */
        var hepsi = db.Query<YetkiSatiri>(@"
SELECT id AS Id, alan AS Alan, kapsam AS Kapsam,
       anahtar AS Anahtar, kod AS Kod, izin AS Izin
FROM B360_YETKI
WHERE alan = @alan
  AND kapsam IN @kapsamlar", new
        {
            alan,
            kapsamlar = new[] { ustKapsam, altKapsam, ucuncuKapsam }
                .Where(x => !string.IsNullOrWhiteSpace(x)).ToArray(),
        }).ToList();

        bool Uyar(YetkiSatiri x, string kapsam, string anahtar) =>
            !string.IsNullOrWhiteSpace(anahtar)
            && string.Equals(x.Kapsam, kapsam, StringComparison.OrdinalIgnoreCase)
            && Anahtar(x.Anahtar) == Anahtar(anahtar);

        return hepsi
            .Where(x => Uyar(x, ustKapsam, ustAnahtar)
                     || Uyar(x, altKapsam, altAnahtar)
                     || Uyar(x, ucuncuKapsam, ucuncuAnahtar))
            .ToList();
    }

    /// <summary>
    /// Bir kodun sonucunu belirler: önce kullanıcı satırı, sonra alt katman,
    /// hiçbiri yoksa varsayılan.
    /// </summary>
    private static bool Coz(List<YetkiSatiri> satirlar, string kod,
                            string altKapsam, bool varsayilan)
        => Coz(satirlar, kod, altKapsam, null, varsayilan);

    /// <summary>
    /// Sıra: kişi → alt katman (ünvan/rol) → üçüncü katman (grup) →
    /// varsayılan. Daha dar tanım geniş olanı eziyor.
    /// </summary>
    private static bool Coz(List<YetkiSatiri> satirlar, string kod,
                            string altKapsam, string ucuncuKapsam, bool varsayilan)
    {
        var kisi = satirlar.FirstOrDefault(x =>
            string.Equals(x.Kapsam, Kapsam.Kullanici, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

        if (kisi is not null) return kisi.Izin;

        var alt = satirlar.FirstOrDefault(x =>
            string.Equals(x.Kapsam, altKapsam, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

        if (alt is not null) return alt.Izin;

        if (ucuncuKapsam is not null)
        {
            var ucuncu = satirlar.FirstOrDefault(x =>
                string.Equals(x.Kapsam, ucuncuKapsam, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

            if (ucuncu is not null) return ucuncu.Izin;
        }

        return varsayilan;
    }
}

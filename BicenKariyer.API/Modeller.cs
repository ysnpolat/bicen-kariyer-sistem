using System.Text.Json.Serialization;

namespace BicenKariyer.API;

/* ==========================================================================
 * Başvuru durumları
 * ========================================================================== */

public static class Durumlar
{
    public const string Yeni = "Yeni";

    /// <summary>İK personeli başvuruyu açıp incelediğinde otomatik atanır</summary>
    public const string Incelendi = "İncelendi";
    public const string Degerlendirmede = "Değerlendirmede";
    public const string GorusmeTalebi = "Görüşme Talebi";
    public const string Olumlu = "Olumlu";

    /// <summary>İşe alım kararı verildi, evrak süreci sürüyor</summary>
    public const string EvrakHazirlaniyor = "Evrak Hazırlanıyor";

    /// <summary>
    /// İşe alım bilgileri girildi, yetkili onayı bekleniyor.
    /// Onaylanınca "İşe Alındı" durumuna geçer.
    /// </summary>
    public const string OnayBekliyor = "Onay Bekliyor";

    public const string IseAlindi = "İşe Alındı";
    public const string Olumsuz = "Olumsuz";

    public static readonly string[] Tumu =
    {
        Yeni, Incelendi, Degerlendirmede, GorusmeTalebi, Olumlu,
        EvrakHazirlaniyor, IseAlindi, Olumsuz
    };

    /// <summary>Ana listede gizlenen, sonuçlanmış durumlar</summary>
    public static readonly string[] Sonuclanmis = { Olumlu, IseAlindi, Olumsuz };
}

public static class Roller
{
    /// <summary>Tam yetki</summary>
    public const string Admin = "Admin";

    /// <summary>
    /// Genel müdür yardımcısı: tüm bölgeleri görür, onayları verir,
    /// norm kadro ve maaş skalasını düzenleyebilir.
    /// </summary>
    public const string GenelMudurYardimcisi = "GenelMudurYardimcisi";

    /// <summary>
    /// İK yöneticisi: uzmanların tüm bildirimlerini görür, norm kadroda
    /// değişiklik önerebilir (onaya gider).
    /// </summary>
    public const string IKYoneticisi = "IKYoneticisi";

    /// <summary>
    /// İK uzmanı: başvuru süreçlerini yürütür. Yalnızca kendi şubelerine
    /// ait görüşme bildirimlerini alır.
    /// </summary>
    public const string IK = "IK";

    /// <summary>
    /// Bölge koordinatörü: tüm bölgeleri görüntüler, düzenleme yapamaz,
    /// adayların kimlik bilgilerini göremez.
    /// </summary>
    public const string BolgeKoordinatoru = "BolgeKoordinatoru";

    /// <summary>
    /// Bölge müdürü: yalnızca kendi bölgesindeki şubeleri görür,
    /// düzenleme yapamaz, kimlik bilgilerini göremez.
    /// </summary>
    public const string BolgeMuduru = "BolgeMuduru";

    /// <summary>
    /// Fotoğraf görevlisi: yalnızca personel listesine erişir, personelin
    /// ad soyad ve telefon bilgisini görür, fotoğraf yükleyebilir.
    ///
    /// Ücret, kimlik numarası, adres ve çalışma geçmişi gibi bilgilere
    /// erişemez; başvuru ve rapor ekranlarını göremez.
    /// </summary>
    public const string FotografGorevlisi = "FotografGorevlisi";

    /* ------------------------------------------------------------ yetkiler */

    /// <summary>Yalnızca personel fotoğrafı yükleyebilen sınırlı rol</summary>
    public static bool YalnizcaFotograf(string rol) =>
        Temel(rol) is FotografGorevlisi;

    /// <summary>Personel fotoğrafı yükleme yetkisi</summary>
    public static bool FotografYukleme(string rol) =>
        Temel(rol) is Admin or IK or IKYoneticisi or FotografGorevlisi;

    /// <summary>Durum değiştirme, işe alım ve rotasyon yetkisi</summary>
    public static bool IslemYetkisi(string rol) =>
        Temel(rol) is Admin or IK or IKYoneticisi;

    /// <summary>Onay verme yetkisi (kullanıcı bazında da açılabilir)</summary>
    public static bool OnayYetkisi(string rol) =>
        Temel(rol) is Admin or GenelMudurYardimcisi;

    /// <summary>Norm kadro ve maaş skalasını düzenleme yetkisi</summary>
    public static bool KadroDuzenleme(string rol) =>
        Temel(rol) is Admin or GenelMudurYardimcisi;

    /// <summary>Norm kadroda değişiklik önerme (onaya gider)</summary>
    public static bool KadroOnerme(string rol) =>
        Temel(rol) is IKYoneticisi;

    /// <summary>İK performans ekranını görme yetkisi</summary>
    public static bool PerformansGorme(string rol) =>
        Temel(rol) is Admin or GenelMudurYardimcisi;

    /// <summary>
    /// Adayların kimlik numarası, doğum tarihi gibi özel verilerini görme.
    /// Bölge müdürü ve koordinatör bu bilgileri göremez.
    /// </summary>
    public static bool OzelVeriGorme(string rol) =>
        Temel(rol) is not (BolgeMuduru or BolgeKoordinatoru);

    /// <summary>Yalnızca kendi şubelerini görenler</summary>
    public static bool SubeSiniri(string rol) =>
        Temel(rol) is BolgeMuduru;

    /// <summary>Sağ üstte bölge seçicisi gösterilenler</summary>
    public static bool BolgeSecici(string rol) =>
        Temel(rol) is Admin or GenelMudurYardimcisi or BolgeKoordinatoru;

    /// <summary>Yönetim ekranının tamamını görenler</summary>
    public static bool TamYonetim(string rol) =>
        Temel(rol) is Admin or GenelMudurYardimcisi;

    /// <summary>Yalnızca form ayarlarını görenler</summary>
    public static bool FormAyari(string rol) =>
        Temel(rol) is IK or IKYoneticisi;

    /// <summary>Başvurular yerine özet ekranı görenler</summary>
    public static bool OzetEkrani(string rol) =>
        Temel(rol) is BolgeMuduru;

    /* ------------------------------------------------------ özel roller */

    /// <summary>Kodda tanımlı, silinemeyen roller.</summary>
    public static readonly string[] Sabitler =
    {
        Admin, GenelMudurYardimcisi, IKYoneticisi, IK,
        BolgeKoordinatoru, BolgeMuduru, FotografGorevlisi
    };

    /// <summary>
    /// Panelden açılan roller: kod → davrandığı sabit rol.
    ///
    /// <para>
    /// Yeni bir rol kodu koddaki hiçbir yetki kuralıyla eşleşmiyor ve tek
    /// başına hiçbir şey yapamazdı. Bu yüzden her özel rol bir sabit rolün
    /// davranışını devralıyor; rolü asıl ayıran şey Rol Yetkileri'nden
    /// seçilen menüler, gizlenen alanlar ve kapatılan sekmeler.
    /// </para>
    ///
    /// <para>
    /// Sözlük yerinde değiştirilmiyor, yenisiyle değiştiriliyor: ayar
    /// kaydedilirken başka istekler de bu listeyi okuyor.
    /// </para>
    /// </summary>
    private static Dictionary<string, string> _ozelTemel =
        new(StringComparer.OrdinalIgnoreCase);

    private static IReadOnlyList<OzelRol> _ozelRoller = new List<OzelRol>();

    /// <summary>Panelden açılmış roller.</summary>
    public static IReadOnlyList<OzelRol> Ozeller => _ozelRoller;

    /// <summary>Ayardaki özel rolleri belleğe alır.</summary>
    public static void OzelRolleriYukle(IEnumerable<OzelRol> roller)
    {
        var liste = (roller ?? Enumerable.Empty<OzelRol>())
            .Where(x => !string.IsNullOrWhiteSpace(x?.Kod))
            .Where(x => !Sabitler.Contains(x.Kod.Trim(), StringComparer.OrdinalIgnoreCase))
            .GroupBy(x => x.Kod.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(x => x.First())
            .ToList();

        var harita = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var r in liste)
        {
            var temel = (r.Temel ?? "").Trim();

            /* Tanınmayan ya da yönetici olan temel, en dar role düşürülüyor:
               yanlış bir ayarın rolü yetkisiz bırakması, farkında olmadan
               tam yetki vermesinden iyidir. */
            var gecerli =
                Sabitler.Contains(temel, StringComparer.OrdinalIgnoreCase)
                && !string.Equals(temel, Admin, StringComparison.OrdinalIgnoreCase);

            harita[r.Kod.Trim()] = gecerli ? temel : BolgeMuduru;
        }

        _ozelTemel = harita;
        _ozelRoller = liste;
    }

    /// <summary>
    /// Rolün davrandığı sabit rol. Sabit roller kendisini döndürür;
    /// tanınmayan bir kod da olduğu gibi döner ve hiçbir kuralla
    /// eşleşmediği için yetkisiz kalır.
    /// </summary>
    public static string Temel(string rol) =>
        rol is not null && _ozelTemel.TryGetValue(rol, out var t) ? t : rol ?? "";

    /// <summary>Tanımlı tüm roller: sabitler ve panelden açılanlar.</summary>
    public static string[] Tumu =>
        Sabitler.Concat(_ozelRoller.Select(x => x.Kod)).ToArray();
}

/// <summary>
/// Panelden açılan rol.
///
/// <para>
/// <c>Temel</c> rolün hangi sabit rol gibi davranacağını söylüyor: veri
/// kapsamı (kendi bölgesi mi, hepsi mi), işlem yetkisi ve gizlenen alanlar
/// oradan geliyor. Menü ve alan ayrıntısı Rol Yetkileri'nden ayarlanıyor.
/// </para>
/// </summary>
public class OzelRol
{
    /// <summary>Jetona yazılan kod; harf ve rakam, boşluksuz.</summary>
    public string Kod { get; set; }

    /// <summary>Panelde görünen ad.</summary>
    public string Ad { get; set; }

    /// <summary>Rolün ne için var olduğu; Rol Yetkileri'nde görünür.</summary>
    public string Aciklama { get; set; }

    /// <summary>Davranışını devraldığı sabit rol.</summary>
    public string Temel { get; set; } = Roller.BolgeMuduru;
}

/* ==========================================================================
 * Başvuru
 * ========================================================================== */

/// <summary>Aday uygulamasından gelen ham başvuru (JSON olarak saklanır).</summary>
public class BasvuruGirdi
{
    public string BasvuruNo { get; set; }

    /// <summary>Adayın bizi nereden duyduğu; seçenekler panelden yönetiliyor.</summary>
    public string Kaynak { get; set; }

    /// <summary>"Diğer" seçildiğinde yazılan açıklama.</summary>
    public string KaynakDetay { get; set; }
    public string Ad { get; set; }
    public string Soyad { get; set; }
    public string AdayAdSoyad { get; set; }
    public string TcKimlikNo { get; set; }
    public string CepTel1 { get; set; }
    public string CepTel2 { get; set; }
    public string Email { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public List<string> Bolumler { get; set; } = new();

    /// <summary>Formun tamamı; alan eklendiğinde şema değişikliği gerekmez.</summary>
    [JsonExtensionData]
    public Dictionary<string, object> DigerAlanlar { get; set; } = new();
}

public class BasvuruOzet
{
    public int Id { get; set; }

    /// <summary>Adayın bizi nereden duyduğu.</summary>
    public string Kaynak { get; set; }

    /// <summary>"Diğer" seçildiğinde yazılan açıklama.</summary>
    public string KaynakDetay { get; set; }

    /// <summary>
    /// Aday formda engel durumu belirtmiş mi.
    ///
    /// Listede yalnızca bir simge olarak gösterilir; norm kadroda engelli
    /// kontenjanı takip edildiği için İK'nın bunu listede görmesi gerekiyor.
    /// </summary>
    public bool EngelVar { get; set; }

    /// <summary>
    /// Bu aday, açık bir norm kadro pozisyonuna uygun mu.
    ///
    /// Listede rozet olarak gösterilir; uzman havuzu ayrıca taramadan
    /// hangi adayın hemen değerlendirilebileceğini görsün.
    /// </summary>
    /// <summary>
    /// İşe alındı işaretli ama Mikro'da aktif personel kaydı yok.
    ///
    /// Girişi yapılmamış demektir; listede uyarı olarak gösterilir ve
    /// kayıt üste alınır. Bu adımın atlanması bordro ve kart okutma
    /// dahil her şeyi aksatıyor.
    /// </summary>
    public bool MikroBekliyor { get; set; }

    /// <summary>
    /// İşe alındı işaretli, Mikro'da kaydı var ama çıkışı yapılmış.
    ///
    /// <para>
    /// Girişi hiç yapılmamış olanla ayrılmış olanı ayırmak gerekiyor:
    /// ikisi de "aktif kayıt yok" durumunda ama biri İK'nın yapması
    /// gereken bir iş, diğeri olmuş bitmiş bir ayrılık. Tek rozet
    /// kullanınca ayrılan personel için boşuna Mikro girişi aranıyordu.
    /// </para>
    /// </summary>
    public bool MikrodaAyrildi { get; set; }

    /// <summary>Ayrılmışsa çıkış tarihi ve nedeni; rozette gösterilir.</summary>
    public DateTime? MikroCikisTarihi { get; set; }

    public string MikroCikisNedeni { get; set; }

    public bool OneriVar { get; set; }

    /// <summary>Uygun olduğu açık pozisyonlar; ipucunda gösterilir</summary>
    public string OneriMetni { get; set; }

    /// <summary>Adayın fotoğrafı var mı; görsel ayrı uçtan çekilir</summary>
    public bool FotografVar { get; set; }
    public string BasvuruNo { get; set; }
    public string AdSoyad { get; set; }
    public string KimlikNo { get; set; }
    public string Telefon { get; set; }
    public string Eposta { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string BirimTuru { get; set; }
    public string Bolumler { get; set; }
    public string Il { get; set; }
    public string Ilce { get; set; }
    public string Mahalle { get; set; }
    public string Durum { get; set; }
    public string DegerlendirmeNotu { get; set; }

    /// <summary>
    /// Havuzdan başvurulara döndü mü. Olumlu bulunup havuza aktarılan aday
    /// havuzdan çıkarılınca başvurulara döner; uzman bunu rozette görür.
    /// Dolu ise döndüğü tarih; not ve kim çıkardığı yanında.
    /// </summary>
    public DateTime? HavuzdanDonusTarihi { get; set; }
    public string HavuzdanDonusNotu { get; set; }
    public string HavuzdanCikaran { get; set; }

    public DateTime? GorusmeTarihi { get; set; }
    public string GorusmeYeri { get; set; }
    public DateTime? IseGirisTarihi { get; set; }
    /// <summary>İşe başladığı pozisyon (başvurduğundan farklı olabilir)</summary>
    public string IseGirisBolum { get; set; }

    /// <summary>Adayın formda belirttiği net ücret beklentisi</summary>
    public string TalepUcret { get; set; }

    /// <summary>Pozisyonun açıldıktan kaç gün sonra doldurulduğu</summary>
    public int? DoldurmaGun { get; set; }
    /// <summary>Aynı bilginin dakika cinsinden karşılığı</summary>
    public int? DoldurmaDakika { get; set; }

    /// <summary>Başvurunun geldiği adres (kötüye kullanım incelemesi için)</summary>
    public string GonderenIp { get; set; }
    public string Tarayici { get; set; }
    public decimal? AnlasilanUcret { get; set; }
    public decimal? YolUcreti { get; set; }
    public DateTime Olusturma { get; set; }
    public DateTime? Guncelleme { get; set; }
    public string Guncelleyen { get; set; }
    public bool MailGonderildi { get; set; }
    public int NotSayisi { get; set; }
    /// <summary>Aynı kimlik numarasıyla yapılmış diğer başvuru sayısı.</summary>
    public int OncekiBasvuruSayisi { get; set; }
    public bool TestKaydi { get; set; }

    /// <summary>Arşive alınmış mı; arşivdekiler listelerde görünmez.</summary>
    public bool Arsiv { get; set; }
    /// <summary>En son eklenen referans görüşmesi puanı (1-10); referans
    /// yoksa null. Birden fazla referans varsa yalnızca en yenisi.</summary>
    public int? ReferansPuani { get; set; }

    /// <summary>Başvurunun üzerinden geçen gün sayısı</summary>
    public int BekleyenGun { get; set; }
    /// <summary>Mevcut durumda kaç gündür beklediği</summary>
    public int DurumGun { get; set; }

    /// <summary>Son işlemden bu yana geçen gün sayısı</summary>
    public int IslemsizGun { get; set; }
    /// <summary>
    /// Aday hâlihazırda Biçen'de çalışıyor mu? Kimlik numarası Mikro
    /// personel kayıtlarıyla eşleşirse doldurulur; listede rozet olarak
    /// gösterilir ki uzman "bu zaten bizim personelimiz" diye ayrı
    /// sorgulamak zorunda kalmasın.
    /// </summary>
    public bool CalisiyorMu { get; set; }

    /// <summary>Mikro'daki personel kodu (eski ya da şu anki kaydı); personel kartı için</summary>
    public string PersonelKodu { get; set; }

    /// <summary>Çalışıyorsa hangi şubede</summary>
    public string CalistigiSube { get; set; }

    /// <summary>Çalışıyorsa hangi ünvanla</summary>
    public string CalistigiUnvan { get; set; }

}

/// <summary>Aynı kimlik numarasıyla yapılmış diğer başvurular.</summary>
public class OncekiBasvuru
{
    public int Id { get; set; }
    public string BasvuruNo { get; set; }
    public string Durum { get; set; }
    public string DegerlendirmeNotu { get; set; }
    public string SubeAdi { get; set; }
    public string Bolumler { get; set; }
    public DateTime Olusturma { get; set; }

    /// <summary>İşe alındıysa giriş tarihi</summary>
    public DateTime? IseGirisTarihi { get; set; }
    public decimal? AnlasilanUcret { get; set; }

    /// <summary>O başvurunun form verisi; önizleme için</summary>
    public string VeriJson { get; set; }

    public List<BasvuruNotu> Notlar { get; set; } = new();
}

public class BasvuruDetay : BasvuruOzet
{
    public string VeriJson { get; set; }
    public List<OncekiBasvuru> OncekiBasvurular { get; set; } = new();

    /// <summary>
    /// Aday daha önce çalışıp ayrıldıysa o dönemin çıkış mülakatları.
    /// Neden ayrıldığı ve o zaman ne söylediği, yeniden işe alım
    /// kararında en çok işe yarayan bilgidir.
    /// </summary>
    public List<object> CikisMulakatlari { get; set; } = new();
    public List<Hareket> Hareketler { get; set; } = new();
    public List<BasvuruNotu> Notlar { get; set; } = new();
}

/// <summary>
/// Başvuruya İK personeli tarafından eklenen dahili not.
/// Adaya hiçbir şekilde gösterilmez; aday sorgulama ucu yalnızca
/// başvurunun kendi verisini döndürür.
/// </summary>
public class BasvuruNotu
{
    public int Id { get; set; }
    public int BasvuruId { get; set; }
    public string Metin { get; set; }
    public string Kullanici { get; set; }
    public string AdSoyad { get; set; }
    public DateTime Tarih { get; set; }
}

public class NotGirdi
{
    public string Metin { get; set; }
}

public class Hareket
{
    public int Id { get; set; }
    public string Durum { get; set; }
    public string Aciklama { get; set; }
    public string Kullanici { get; set; }
    public DateTime Tarih { get; set; }
}

/* --------------------------------------------------------------------------
   Filtre ve özet sonuçları
   --------------------------------------------------------------------------
   Bu sınıflar bilinçli olarak tiplidir: Dapper'ın dinamik nesneleri JSON'a
   çevrilirken alan adları SQL'deki gibi büyük harfle çıkar ve arayüz onları
   okuyamaz. Tipli sınıflarda camelCase dönüşümü doğru uygulanır.
   -------------------------------------------------------------------------- */

public class SubeSecenek
{
    public string Kod { get; set; }
    public string Ad { get; set; }
}

public class MahalleSecenek
{
    public string Ilce { get; set; }
    public string Mahalle { get; set; }
}

public class DurumSayisi
{
    public string Durum { get; set; }
    public int Adet { get; set; }
}

/// <summary>Dağılım penceresinde bir şube ya da pozisyonun başvuru sayısı.</summary>
public class DagilimSatiri
{
    public string Ad { get; set; }
    public int Adet { get; set; }
}

/// <summary>
/// Dağılım penceresindeki ortalama süreler (gün). Hesaplanacak kayıt yoksa
/// ilgili süre boş döner; yanındaki adet kaç başvurudan hesaplandığını söyler.
/// </summary>
public class OrtalamaSureler
{
    public decimal? IlkIslemGun { get; set; }
    public int IlkIslemAdet { get; set; }
    public decimal? GorusmeGun { get; set; }
    public int GorusmeAdet { get; set; }
    public decimal? IseAlimGun { get; set; }
    public int IseAlimAdet { get; set; }
    public decimal? DoldurmaGun { get; set; }
    public int DoldurmaAdet { get; set; }
}

public class SorgulaGirdi
{
    public string KimlikNo { get; set; }
    public string Telefon { get; set; }
}

public class DurumGirdi
{
    public string Durum { get; set; }
    public string Aciklama { get; set; }

    /// <summary>
    /// Olumlu kararında adayın hangi pozisyon için olumlu bulunduğu.
    /// Olumlu için zorunludur; başvurunun pozisyonu bu değere güncellenir.
    /// </summary>
    public string Bolum { get; set; }
}

public class SubeDegistirGirdi
{
    public string SubeKodu { get; set; }
    public string Aciklama { get; set; }
}

/// <summary>Zamanı geçmiş görüşmenin sonucu</summary>
public class GorusmeSonucGirdi
{
    /// <summary>ertele · olumlu · olumsuz · degerlendirmede</summary>
    public string Secim { get; set; }
    public DateTime? YeniTarih { get; set; }
    public string Aciklama { get; set; }
}

/// <summary>Havuz hedeflerini bölgeler arası kopyalama girdisi</summary>
public class IhtiyacKopyalaGirdi
{
    public string KaynakBolge { get; set; }
    public List<string> HedefBolgeler { get; set; } = new();

    /// <summary>Hedef bölgede tanımlı pozisyonların üzerine yazılsın mı</summary>
    public bool Uzerine { get; set; }
}

/// <summary>
/// İK tarafından görüşme sırasında alınan referans.
/// Adayın formda yazdığı referanslardan ayrıdır.
/// </summary>
public class IkReferansi
{
    public int Id { get; set; }
    public int BasvuruId { get; set; }

    public string AdSoyad { get; set; }
    public string CalistigiYer { get; set; }
    public string Gorev { get; set; }
    public string Telefon { get; set; }

    /// <summary>Adayla ilişkisi: eski müdürü, mesai arkadaşı vb.</summary>
    public string Yakinlik { get; set; }

    /* ------------------------------------------- referans görüşmesi */

    public bool GorusulduMu { get; set; }
    public DateTime? GorusmeTarihi { get; set; }

    /// <summary>Olumlu · Olumsuz · Çekimser · Ulaşılamadı</summary>
    public string GorusmeSonucu { get; set; }
    public string GorusmeNotu { get; set; }

    /// <summary>1-10 arası referans görüşmesi puanı. 5'in altı, başvuruyu
    /// otomatik olarak "Olumsuz" durumuna çeker (bkz. ReferansKaydet).</summary>
    public int? Puan { get; set; }

    public string Kullanici { get; set; }
    public string KullaniciAdSoyad { get; set; }
    public DateTime Olusturma { get; set; }
}

/// <summary>Şube bazında personel başı ciro verimliliği</summary>
public class CiroVerimlilik
{
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }

    /// <summary>Dönemdeki toplam ciro</summary>
    public decimal ToplamCiro { get; set; }

    /// <summary>Ciro kaydı bulunan gün sayısı</summary>
    public int GunSayisi { get; set; }

    /// <summary>Günlük ortalama ciro</summary>
    public decimal GunlukCiro { get; set; }

    public decimal Norm { get; set; }
    public decimal Mevcut { get; set; }

    /// <summary>Günlük ciro / norm kadro</summary>
    public decimal NormBasi { get; set; }

    /// <summary>Günlük ciro / mevcut personel</summary>
    public decimal MevcutBasi { get; set; }

    /* ------------------------------------------- karşılaştırma dönemi */

    public decimal OncekiGunlukCiro { get; set; }

    /// <summary>Kıyas dönemindeki toplam ciro (dönem değişimi için)</summary>
    public decimal OncekiToplamCiro { get; set; }
    public decimal OncekiNormBasi { get; set; }
    public decimal OncekiMevcutBasi { get; set; }

    /// <summary>Kıyas dönemindeki norm kadro</summary>
    public decimal OncekiNorm { get; set; }

    /// <summary>Kıyas dönemindeki mevcut personel</summary>
    public decimal OncekiMevcut { get; set; }

    /// <summary>Mevcut başı ciro değişimi (%); veri yoksa null</summary>
    public decimal? DegisimYuzde { get; set; }

    /// <summary>Norm başı ciro değişimi (%)</summary>
    public decimal? NormDegisimYuzde { get; set; }
}

/// <summary>
/// Yapay zekânın engellediği başvuru.
///
/// Dapper'ın dinamik nesnesi yerine tanımlı sınıf kullanılır: dinamik
/// nesneler sözlük olarak serileştiğinde alan adlarına camelCase kuralı
/// uygulanmaz ve panel değerleri okuyamaz.
/// </summary>
public class EngellenenBasvuru
{
    public int Id { get; set; }
    public string BasvuruNo { get; set; }
    public string AdSoyad { get; set; }
    public string KimlikNo { get; set; }
    public string Telefon { get; set; }
    public string Eposta { get; set; }
    public string SubeAdi { get; set; }
    public string Bolumler { get; set; }
    public string Il { get; set; }
    public string Ilce { get; set; }
    public string Mahalle { get; set; }

    public string AiSonuc { get; set; }
    public string AiGerekce { get; set; }
    public int? AiGuven { get; set; }

    public string GonderenIp { get; set; }
    public bool Incelendi { get; set; }
    public bool Aktarildi { get; set; }
    public int? AktarilanId { get; set; }
    public string Inceleyen { get; set; }
    public DateTime Olusturma { get; set; }
}

/// <summary>Personel fotoğrafı yükleme girdisi</summary>
public class ResimYuklemeGirdi
{
    public string PersonelKodu { get; set; }

    /// <summary>Görsel; "data:image/jpeg;base64,..." öneki olabilir</summary>
    public string Base64 { get; set; }
}

/// <summary>Engellenecek e-posta alan adı</summary>
public class EngelliAlanGirdi
{
    /// <summary>@ornek.com, ornek.com ya da kisi@ornek.com kabul edilir</summary>
    public string Alan { get; set; }

    public string Sebep { get; set; }
}

/// <summary>Doğrulama kodu isteği</summary>
public class KodGonderGirdi
{
    public string Telefon { get; set; }
}

/// <summary>Doğrulama kodu denetimi</summary>
public class KodDogrulaGirdi
{
    public string Telefon { get; set; }
    public string Kod { get; set; }
}

/// <summary>
/// Yönetim panelinden yüklenen doğrulama kodu havuzu girdisi.
/// Icerik, TXT dosyasının ham metnidir; her satır bir koddur.
/// </summary>
public class KodHavuzuGirdi
{
    public string Icerik { get; set; }
}

/// <summary>Günlük kod sınırı sıfırlanacak numara</summary>
public class KodSiniriGirdi
{
    public string Telefon { get; set; }
}

/* ==========================================================================
 * Çıkış mülakatı
 * ========================================================================== */

/// <summary>
/// Çıkış mülakatı ayarları: sorular ve çıkış nedenleri Form Ayarları'ndan
/// yönetilir, koda gömülü değildir.
/// </summary>
public class CikisMulakatAyari
{
    /// <summary>
    /// Ankete davet SMS'inin metni. {ad} kişinin ilk adıyla, {link}
    /// kişiye özel bağlantıyla değiştirilir. Boşsa varsayılan kullanılır.
    /// </summary>
    public string AnketMesaji { get; set; } = "";

    public List<string> Sorular { get; set; } = new();
    public List<string> Nedenler { get; set; } = new();

    /// <summary>
    /// 1-5 arası puanlanan başlıklar (yönetici, çalışma ortamı, ücret...).
    /// Açık uçlu sorulardan farklı olarak hepsi her mülakatta sorulur:
    /// karşılaştırılabilir olması için aynı ölçüt her seferinde gerekir.
    /// </summary>
    public List<string> Puanlamalar { get; set; } = new();

    /// <summary>Mülakat açılırken kaç açık uçlu soru gösterileceği</summary>
    public int SoruSayisi { get; set; } = 5;
}

/// <summary>Bir mülakattaki tek soru ve cevabı</summary>
public class MulakatSorusu
{
    public string Soru { get; set; }
    public string Cevap { get; set; }
}

/// <summary>Çıkış mülakatı kaydı</summary>
public class CikisMulakati
{
    public int Id { get; set; }
    public string PersonelKodu { get; set; }
    public string AdSoyad { get; set; }
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }
    public DateTime? GirisTarihi { get; set; }
    public DateTime? CikisTarihi { get; set; }
    public string CikisNedeni { get; set; }

    /// <summary>
    /// Nedenin açıklaması. Neden Mikro'daki çıkış sebebinden ön dolu gelir;
    /// uzman görüşmede öğrendiği ayrıntıyı buraya yazar.
    /// </summary>
    public string CikisNedeniAciklama { get; set; }
    public List<MulakatSorusu> Sorular { get; set; } = new();

    /// <summary>1-5 arası verilen puanlar</summary>
    public List<MulakatPuani> Puanlar { get; set; } = new();

    /// <summary>Personelin cep telefonu (arayarak yapılan mülakatlar için)</summary>
    public string Telefon { get; set; }

    /// <summary>Aynı şartlarda tekrar çalışmak ister mi</summary>
    public bool? TekrarCalisir { get; set; }

    /// <summary>Bir tanıdığına burayı önerir mi (0-10)</summary>
    public int? TavsiyePuani { get; set; }

    /// <summary>İK uzmanının kendi değerlendirmesi</summary>
    public string UzmanYorumu { get; set; }

    public string Kullanici { get; set; }
    public string UzmanAdi { get; set; }
    public DateTime Olusturma { get; set; }
}

/// <summary>Bir başlığa verilen 1-5 arası puan</summary>
public class MulakatPuani
{
    public string Baslik { get; set; }
    public int Puan { get; set; }
}

/* ==========================================================================
 * Sicil kartı (Mikro PERSONELLER) eşleştirmeleri
 * ========================================================================== */

/// <summary>
/// Sicil kartı açılırken Mikro'ya yazılacak kodların eşleştirmeleri.
///
/// <para>
/// Bu değerler koda gömülü değildir: Mikro'daki mevcut kayıtlardan
/// çıkarılan baskın değerlerle önceden dolu gelir, panelden düzeltilir.
/// Yanlış bir kod bordroyu etkilediği için karar İK'da olmalıdır.
/// </para>
/// </summary>
public class SicilAyari
{
    /// <summary>Ünvan bazlı kodlar</summary>
    public List<SicilUnvani> Unvanlar { get; set; } = new();

    /// <summary>Şube bazlı kodlar</summary>
    public List<SicilSubesi> Subeler { get; set; } = new();

    /// <summary>
    /// Mikro'da kayıtların hangi kullanıcı adına açılacağı
    /// (per_create_user). Ayrı bir kullanıcı tanımlamak önerilir:
    /// sonradan hangi kaydın sistemden geldiği ayırt edilebilir.
    /// </summary>
    public int MikroKullaniciNo { get; set; }

    /// <summary>
    /// Açık: kayıtlar canlı Mikro veritabanına yazılır.
    /// Kapalı: yalnızca önizleme üretilir, hiçbir şey yazılmaz.
    /// Varsayılan kapalıdır; doğrulanmadan canlıya yazılmamalıdır.
    /// </summary>
    public bool YazmaAcik { get; set; }
}

/// <summary>Bir ünvanın Mikro karşılıkları</summary>
public class SicilUnvani
{
    /// <summary>Sistemdeki pozisyon adı</summary>
    public string Bolum { get; set; }

    /// <summary>Mikro ünvan kodu (per_unvan_kodu)</summary>
    public int UnvanKodu { get; set; }

    /// <summary>Görev kodu (per_kim_gorev), ör. 700.06</summary>
    public string GorevKodu { get; set; }

    /// <summary>Meslek kodu (per_meslek_kodu), ör. 5230.04</summary>
    public string MeslekKodu { get; set; }
}

/// <summary>Bir şubenin Mikro karşılıkları</summary>
public class SicilSubesi
{
    /// <summary>Sistemdeki şube adı</summary>
    public string SubeAdi { get; set; }

    /// <summary>Mikro iş grubu kodu (per_is_grup_kodu)</summary>
    public int IsGrubuKodu { get; set; }

    /// <summary>Mikro iş grubu adı (per_is_grup), metin alan</summary>
    public string IsGrubuAdi { get; set; }

    /// <summary>SGK işyeri / bölge kodu (per_bolge_kodu), ör. B49</summary>
    public string BolgeKodu { get; set; }
}

/// <summary>Genel merkez / depo departmanı</summary>
public class DepartmanGirdi
{
    public int? Id { get; set; }
    public string Ad { get; set; }

    /// <summary>Z.MERKEZ BURO, AKÇABURGAZ DEPO: gruplama için</summary>
    public string IsYeri { get; set; }

    public string Aciklama { get; set; }
    public int Sira { get; set; }

    /// <summary>Yönetici sicilleri: personelin 1. onaylayanı</summary>
    public List<string> Yoneticiler { get; set; } = new();

    /// <summary>Personel sicilleri: bir kişi tek departmanda personel olabilir</summary>
    public List<string> Personeller { get; set; } = new();
}

/// <summary>Hak ediş (kıdem) esas tarihi düzeltmesi</summary>
public class IzinHakedisGirdi
{
    public string PersonelKodu { get; set; }
    public string AdSoyad { get; set; }

    /// <summary>Kıdem ve yıllık hak edişin hesaplanacağı tarih</summary>
    public DateTime? HakedisTarihi { get; set; }

    /// <summary>İlk işe giriş (ara dönem hesabında esas alınan)</summary>
    public DateTime? IlkGiris { get; set; }

    /// <summary>Çalışılmayan dönemler, JSON: [{"ayrilis":"..","donus":".."}]</summary>
    public string AraDonemler { get; set; }

    public string Aciklama { get; set; }
}

/// <summary>Personelin başlangıç izin bakiyesi</summary>
public class IzinBakiyeGirdi
{
    public string PersonelKodu { get; set; }
    public string AdSoyad { get; set; }

    /// <summary>Şube ve görev: aktarılan izin kayıtlarına yazılır ki
    /// çizelge ve şube kırılımları Mikro'ya bakmadan da çalışsın.</summary>
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }

    /// <summary>Bu dönem hak edilen izin günü</summary>
    public decimal Baslangic { get; set; }

    /// <summary>Geçmiş yıllardan devreden izin günü</summary>
    public decimal Devir { get; set; }

    /// <summary>
    /// Çizelgedeki toplam kullanılmış izin. Haftalık sütunlar
    /// okunabildiğinde <see cref="Izinler"/> kullanılır; bu alan yalnızca
    /// tarih bilgisi yoksa devreye girer.
    /// </summary>
    public decimal Kullanilan { get; set; }

    /// <summary>
    /// Çizelgenin haftalık sütunlarından çıkarılan tarihli izinler.
    /// Doluysa kullanılan gün buradan hesaplanır ve personel kartında
    /// izin geçmişi görünür.
    /// </summary>
    public List<IzinAktarimSatiri> Izinler { get; set; } = new();

    public string Aciklama { get; set; }
}

/// <summary>Aktarımda gelen tek bir izin kaydı</summary>
public class IzinAktarimSatiri
{
    public DateTime CikisTarihi { get; set; }
    public DateTime DonusTarihi { get; set; }
    public decimal Gun { get; set; }
}

/// <summary>Bir izin kaydı</summary>
public class IzinGirdi
{
    /// <summary>
    /// Panelden girilen izinde personele bildirim ve form maili (26.10.2026).
    /// Boşsa gönderilir; geriye dönük toplu girişte kapatılabilir.
    /// </summary>
    public bool? Bildir { get; set; }

    public string PersonelKodu { get; set; }
    public string AdSoyad { get; set; }
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }

    /// <summary>Yıllık İzin, Mazeret, Ücretsiz, Raporlu...</summary>
    public string Tur { get; set; }

    public DateTime CikisTarihi { get; set; }
    public DateTime DonusTarihi { get; set; }
    public DateTime? BaslamaTarihi { get; set; }

    /// <summary>
    /// İzin günü. Tarih farkından hesaplanan değer bir öneridir; yarım gün
    /// kullanımında kullanıcı 0,5 girebilir.
    /// </summary>
    public decimal Gun { get; set; }

    /// <summary>Öğleden önce / Öğleden sonra; yalnızca yarım günlerde</summary>
    public string YarimGun { get; set; }

    /// <summary>Saatlik izinde çıkış saati (ör. "13:30")</summary>
    public string BaslangicSaat { get; set; }

    /// <summary>Saatlik izinde dönüş saati</summary>
    public string BitisSaat { get; set; }

    /// <summary>
    /// Saatlik iznin süresi. Bakiyeden düşerken güne çevrilir: sekiz
    /// saatlik mesai bir gün sayılır.
    /// </summary>
    public decimal? Saat { get; set; }

    /// <summary>
    /// Yıllık izin bakiyeden düşülsün mü. Boşsa düşülür. Geriye dönük
    /// girilen ve açılış bakiyesine zaten dahil olan izinlerde false
    /// gönderilir: kayıt geçmişte görünür ama kalan gün değişmez.
    /// </summary>
    public bool? BakiyedenDussun { get; set; }

    public string Aciklama { get; set; }
}

/// <summary>Görüşme yönlendirme</summary>
public class YonlendirGirdi
{
    /// <summary>Hedef uzmanın kullanıcı adı</summary>
    public string Kullanici { get; set; }

    /// <summary>Yönlendirme sebebi; bildirimde görünür</summary>
    public string Not { get; set; }
}

/// <summary>
/// Bir rolün neyi görebileceği ve yapabileceği.
///
/// Panelde bir alanı gizlemek güvenlik sağlamaz: tarayıcıdan ağ isteğine
/// bakan biri veriyi yine görür. Bu yüzden maskeleme sunucuda uygulanır;
/// panel yalnızca sunucudan geleni gösterir.
/// </summary>
public class RolYetkisi
{
    /// <summary>Görebileceği menü anahtarları. Boşsa hepsi görünür.</summary>
    public List<string> Menuler { get; set; } = new();

    /// <summary>Yalnızca görüntüleyebilir, değişiklik yapamaz.</summary>
    public bool SaltOkunur { get; set; }

    /// <summary>
    /// Gizlenecek alanlar: kimlik, ucret, adres, telefon, dogumTarihi.
    /// Adres gizlendiğinde semt görünür, sokak ve numara gizlenir.
    /// </summary>
    public List<string> GizliAlanlar { get; set; } = new();

    /// <summary>Sayfa içinde gizlenecek sekmeler (ör. "cikismulakat.anket")</summary>
    public List<string> GizliSekmeler { get; set; } = new();
}

/// <summary>Mobil uygulama girişi</summary>
public class MobilGirisGirdi
{
    public string KimlikNo { get; set; }
    public string Telefon { get; set; }

    /// <summary>SMS ile gelen altı haneli kod; yalnızca doğrulamada</summary>
    public string Kod { get; set; }

    /// <summary>Cihaz kimliği; bir personel tek cihazda oturum açabilir</summary>
    public string CihazId { get; set; }

    /// <summary>
    /// Eski (rastgele üretilmiş) cihaz kimliği (26.10.2026).
    ///
    /// 1.10 ile cihaz kimliği kalıcı kaynaktan (Android kimliği / Keychain)
    /// alınıyor. Güncellenen uygulama bir önceki sürümün sakladığı rastgele
    /// kimliği de gönderir; sunucu kayıtlı cihazla eşleşirse kaydı yeni
    /// kimliğe taşır. Yalnızca KodDogrula'da okunur.
    /// </summary>
    public string EskiCihazId { get; set; }

    /// <summary>Cihaz modeli; panelde okunur biçimde gösterilir</summary>
    public string CihazAdi { get; set; }

    /// <summary>iOS ya da Android</summary>
    public string Isletim { get; set; }
}

/// <summary>Vardiya karekod okutma</summary>
public class VardiyaOkutGirdi
{
    public string Kod { get; set; }
    public double? Enlem { get; set; }
    public double? Boylam { get; set; }
}

/// <summary>Yazarkasa şifre değişikliği (dört haneli rakam)</summary>
public class YazarkasaSifreGirdi
{
    public string YeniSifre { get; set; }
}

/// <summary>Yeni iş emri</summary>
public class IsEmriGirdi
{
    public string Baslik { get; set; }
    public string Aciklama { get; set; }
    public string Oncelik { get; set; }

    /// <summary>"panel" ya da "personel"</summary>
    public string AtananTur { get; set; }
    public string AtananKod { get; set; }
    public string AtananAd { get; set; }

    /// <summary>Hangi ekrandan atandı: "basvuru", "personel", "norm" ...</summary>
    public string KaynakEkran { get; set; }
    public string KaynakId { get; set; }
    public string KaynakBaslik { get; set; }

    public DateTime? SonTarih { get; set; }
}

/// <summary>İş emri bitirme açıklaması</summary>
public class IsEmriBitirGirdi
{
    public string Sonuc { get; set; }
}

/// <summary>Kontrol listesi tanımı</summary>
public class ChecklistGirdi
{
    public int Id { get; set; }
    public string Baslik { get; set; }
    public string Aciklama { get; set; }

    /// <summary>Hedef pozisyonlar; boşsa herkes</summary>
    public List<string> Pozisyonlar { get; set; }

    /// <summary>Hedef şubeler; boşsa tümü</summary>
    public List<string> Subeler { get; set; }

    /// <summary>"gunluk" | "haftalik" | "tek"</summary>
    public string Siklik { get; set; }

    public int? BasSaat { get; set; }
    public int? BitSaat { get; set; }
    public bool Aktif { get; set; } = true;

    public List<ChecklistMaddeGirdi> Maddeler { get; set; }
}

/// <summary>Kontrol listesi maddesi</summary>
public class ChecklistMaddeGirdi
{
    public int Id { get; set; }
    public string Soru { get; set; }
    public bool GorselZorunlu { get; set; }
    public bool YorumZorunlu { get; set; }
}

/// <summary>Panelden yapılan checklist değerlendirmesi</summary>
public class ChecklistDegerlendirmeGirdi
{
    /// <summary>Genel not; puan maddelerin ortalamasından hesaplanır</summary>
    public string Degerlendirme { get; set; }

    public List<ChecklistMaddeDegerlendirme> Maddeler { get; set; }
}

/// <summary>Maddeyi tekrar yaptırmak için iade notu</summary>
public class ChecklistIadeGirdi
{
    public string Not { get; set; }
}

/// <summary>Tek bir maddenin değerlendirmesi</summary>
public class ChecklistMaddeDegerlendirme
{
    public int MaddeId { get; set; }
    public int? Puan { get; set; }
    public string Degerlendirme { get; set; }
}

/// <summary>Mobilden gelen checklist cevabı</summary>
public class ChecklistCevapGirdi
{
    public int ChecklistId { get; set; }
    public int MaddeId { get; set; }

    /// <summary>"evet" | "hayir" | "uygundegil"</summary>
    public string Cevap { get; set; }
    public string Yorum { get; set; }
}

/// <summary>Takvim notu</summary>
public class TakvimNotGirdi
{
    public int Id { get; set; }
    public DateTime Gun { get; set; }
    public string Baslik { get; set; }
    public string Metin { get; set; }

    /// <summary>Boşsa yalnızca not olarak durur, hatırlatma yapılmaz</summary>
    public DateTime? Hatirlatma { get; set; }

    public int? BasvuruId { get; set; }
    public int? GorusmeId { get; set; }
}

/// <summary>Elle oluşturulan görüşme</summary>
public class ManuelGorusmeGirdi
{
    public int Id { get; set; }
    public string AdSoyad { get; set; }
    public string Telefon { get; set; }
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }

    /// <summary>"personel" (bizde çalışan) | "dis" (dışarıdan)</summary>
    public string Tur { get; set; }
    public string PersonelKodu { get; set; }

    public DateTime GorusmeTarihi { get; set; }
    public string GorusmeYeri { get; set; }
    public string Aciklama { get; set; }

    public string Durum { get; set; }
    public string Sonuc { get; set; }
}

/// <summary>Havuzdan çıkarma</summary>
public class HavuzCikisGirdi
{
    /// <summary>
    /// Adayın döneceği başvuru durumu (Yeni, İncelendi, Değerlendirmede,
    /// Görüşme Talebi, Olumsuz). Aday havuzdan düşer ve başvurulara bu
    /// durumla döner.
    /// </summary>
    public string Durum { get; set; }

    /// <summary>Zorunlu: neden havuzdan çıkarıldığı</summary>
    public string Not { get; set; }

    /// <summary>Eski istemciler için; artık kullanılmıyor</summary>
    public string Sebep { get; set; }
}

/// <summary>İşe uyum anketi test gönderimi</summary>
/// <summary>Toplu uyum anketi gönderimi</summary>
/// <summary>Yanıtlanmamış anketi yeniden gönderme isteği</summary>
public class UyumYenidenGirdi
{
    public string PersonelKodu { get; set; }
    public string Asama { get; set; }
    public bool Calisan { get; set; }
    public bool Yonetici { get; set; }
}

/// <summary>
/// Oryantasyon hatırlatması: kime "c" (personelin kendisi) ya da "y"
/// (yöneticisi). Biçen360 bildirimi; anket ya da değerlendirme kapalıysa yeniden açılır.
/// </summary>
public class UyumHatirlatGirdi
{
    public string PersonelKodu { get; set; }
    public string Asama { get; set; }
    public string Kime { get; set; }
}

/// <summary>Toplu yeniden gönderim isteği</summary>
public class UyumYenidenTopluGirdi
{
    public string Asama { get; set; }
    public List<string> PersonelKodlari { get; set; } = new();
    public bool Calisan { get; set; } = true;
    public bool Yonetici { get; set; } = true;
}

public class UyumTopluGirdi
{
    /// <summary>"7g" | "2a" | "6a" | "1y"</summary>
    public string Asama { get; set; }

    public List<UyumTopluKisi> Kisiler { get; set; }

    /// <summary>Mağaza başına yöneticiye de tek bildirim gönderilsin mi</summary>
    public bool YoneticiyeDeGonder { get; set; }

    /// <summary>Şube adı → yönetici cep numarası</summary>
    public Dictionary<string, string> YoneticiTelefonlari { get; set; }
}

/// <summary>Toplu gönderimde bir kişi</summary>
public class UyumTopluKisi
{
    public string PersonelKodu { get; set; }
    public string AdSoyad { get; set; }
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }
    public string Telefon { get; set; }
    public DateTime? GirisTarihi { get; set; }
}

public class UyumTestGirdi
{
    /// <summary>"calisan" | "yonetici"</summary>
    public string Tur { get; set; }

    /// <summary>"7g" | "2a" | "6a" | "1y"</summary>
    public string Asama { get; set; }

    public string Telefon { get; set; }
    public string AdSoyad { get; set; }
    public string PersonelKodu { get; set; }
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }
    public DateTime? GirisTarihi { get; set; }

    /// <summary>"sms" (varsayılan) | "uygulama": test anketi verilen sicilin Biçen360'ına düşer</summary>
    public string Kanal { get; set; }

    /// <summary>Uygulamaya gönderimde hedef personelin sicili</summary>
    public string Sicil { get; set; }
}

/// <summary>İşe uyum anketi yanıtı</summary>
public class UyumCevapGirdi
{
    /// <summary>Yanıtların tamamı; sorular sürümle değiştiği için JSON</summary>
    public string CevaplarJson { get; set; }

    /// <summary>Ölçekli soruların ortalaması</summary>
    public decimal? Puan { get; set; }

    /// <summary>
    /// Yönetici formunda değerlendirilen personelin sicili. Çalışan
    /// formunda boştur; dolu olduğunda yanıtlar kişi bazında biriktirilir.
    /// </summary>
    public string PersonelKodu { get; set; }
}

/// <summary>
/// Bir birimdeki (isteğe bağlı olarak belirli bir pozisyondaki) personelin
/// yöneticisi. Pozisyon boş bırakılırsa o birimdeki herkes için geçerlidir.
/// </summary>
/// <summary>Ücret pusulasının üst bloğundaki sabit işyeri bilgileri</summary>
public class TahakkukIsyeri
{
    public string Unvan { get; set; } = "BİCEN MAĞAZACILIK SAN. VE TİC. A.Ş.";
    public string Adres1 { get; set; } = "SOGANLI MAH. MİMARSİNAN CAD.";
    public string Adres2 { get; set; } = "BAHÇELİEVLER";
    public string Adres3 { get; set; } = "BAHÇELİEVLER/İSTANBUL";
    public string Telefon { get; set; } = "(0212) 425 78 75";
    public string Faks { get; set; } = "(0212) 624 39 19";
    public string TicSicilNo { get; set; } = "0169002157800010";
    public string Web { get; set; } = "www.bicen.com.tr";
}

/// <summary>SGK şubesinin pusulada görünen adı ve işyeri sicil numarası</summary>
public class TahakkukSube
{
    public string Ad { get; set; }
    public string SicilNo { get; set; }
}

/// <summary>Bir aşamanın çalışma günü penceresi</summary>
public class AsamaPenceresi
{
    public int EnAz { get; set; }
    public int EnFazla { get; set; }
}

public class YoneticiEslesme
{
    public string Birim { get; set; }

    /// <summary>Boşsa birimdeki tüm pozisyonlar</summary>
    public string Pozisyon { get; set; }

    /// <summary>Yöneticinin Mikro sicil numarası</summary>
    public string YoneticiKodu { get; set; }
}

/// <summary>
/// Birbirine aday önerilebilecek mağazalar. Ulaşım mesafesine göre
/// kurulur; bölge tanımından bağımsızdır.
/// </summary>
public class OneriGrubu
{
    public string Ad { get; set; }

    /// <summary>Gruba dahil şube kodları</summary>
    public List<string> Subeler { get; set; } = new();
}

/// <summary>Şube karekodu tanımı</summary>
public class KarekodGirdi
{
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public double? Enlem { get; set; }
    public double? Boylam { get; set; }

    /// <summary>True ise yeni kod üretilir; asılı çıktı geçersiz kalır.</summary>
    public bool Yenile { get; set; }
}

/// <summary>Tek metin alanı taşıyan basit girdi</summary>
public class MetinGirdi
{
    public string Deger { get; set; }
}

/// <summary>Yönetim → Mobil test: bildirim sesi denemesi</summary>
public class SesDenemeGirdi
{
    public string Sicil { get; set; }

    /// <summary>onay | genel | kisa</summary>
    public string Tur { get; set; }
}

/// <summary>Bildirim jetonu kaydı (1.6: sürüm ve Biçen sesleri bilgisiyle)</summary>
public class BildirimJetonuGirdi
{
    public string Deger { get; set; }

    /// <summary>Uygulama sürümü ("1.6")</summary>
    public string Surum { get; set; }

    /// <summary>Cihazda Biçen bildirim kanalları ve sesleri kurulu</summary>
    public bool? Sesler { get; set; }
}

/// <summary>Personelin oluşturduğu izin talebi</summary>
public class IzinTalepGirdi
{
    public string Tur { get; set; }
    public DateTime CikisTarihi { get; set; }
    public DateTime DonusTarihi { get; set; }
    public DateTime? BaslamaTarihi { get; set; }
    public decimal Gun { get; set; }

    /// <summary>Yarım günlerde: Öğleden önce / Öğleden sonra</summary>
    public string YarimGun { get; set; }

    /// <summary>Saatlik izinde çıkış ve dönüş saati</summary>
    public string BaslangicSaat { get; set; }
    public string BitisSaat { get; set; }
    public decimal? Saat { get; set; }

    public string Aciklama { get; set; }

    /// <summary>
    /// İzin süresince yerine bakacak kişinin sicili (isteğe bağlı). Şube
    /// personelinde aynı şubeden, departmanı olanda departmanından biri.
    /// </summary>
    public string YerineKodu { get; set; }

    /// <summary>Mazeret izninin türü (hastane, okul işleri, raporlu…; 1.6)</summary>
    public string AltTur { get; set; }
}

/// <summary>Onay ya da ret kararı</summary>
public class IzinKararGirdi
{
    public bool Onay { get; set; }

    /// <summary>
    /// Son onayda: İK'nın ıslak imzalı evrakı henüz gelmedi, onay verilip
    /// evrak sonra yüklenecek. Talep "İK evrakı bekleniyor" olarak kalır.
    /// </summary>
    public bool EvrakSonra { get; set; }

    /// <summary>Retlerde zorunlu</summary>
    public string Not { get; set; }

    /// <summary>
    /// Manuel vardiya onayında düzeltilmiş saat ("08:30"); boşsa personelin
    /// yazdığı saat. Diğer kararlarda kullanılmaz.
    /// </summary>
    public string Saat { get; set; }

    /// <summary>
    /// Panelde son onayda zorunlu: yüklenen imzalı form ya da belge
    /// (KRY_PERSONEL_BELGE.id).
    /// </summary>
    public int? BelgeId { get; set; }
}

/// <summary>Panelden gönderilen duyuru</summary>
public class DuyuruGirdi
{
    /// <summary>İmza: "varsayilan" (ad + ünvan) ya da "kisisel" (kendi metni).</summary>
    public string ImzaTuru { get; set; }

    /// <summary>Kişisel imza metni; boşsa hesapta kayıtlı imza kullanılır.</summary>
    public string Imza { get; set; }

    /// <summary>Kişisel imza sonraki duyurular için hesaba kaydedilsin mi.</summary>
    public bool ImzayiKaydet { get; set; }

    public string Baslik { get; set; }
    public string Metin { get; set; }

    /// <summary>herkes · sube · merkez · depo · kisi · secili</summary>
    public string HedefTur { get; set; }

    public string SubeAdi { get; set; }
    public string PersonelKodu { get; set; }

    /// <summary>
    /// "secili" hedefte: şubeler ve pozisyonlar süzgeç olarak birlikte
    /// uygulanır (boşsa süzülmez); kişiler doğrudan eklenir.
    /// </summary>
    public List<string> Subeler { get; set; }
    public List<string> Pozisyonlar { get; set; }
    public List<string> PersonelKodlari { get; set; }

    public bool Onemli { get; set; }

    /// <summary>
    /// Planlı gönderim (27.10.2026): doluysa duyuru bu zamanda yayına girer
    /// ve bildirim o zaman gider. Boş ya da geçmişse hemen.
    /// </summary>
    public DateTime? YayinZamani { get; set; }

    /// <summary>İsteğe bağlı bağlantı ve düğme yazısı</summary>
    public string Baglanti { get; set; }
    public string BaglantiYazi { get; set; }

    /// <summary>base64 görsel; en fazla 3 MB</summary>
    public string Gorsel { get; set; }
}

/// <summary>Vardiya düzeltme itirazı</summary>
public class ItirazGirdi
{
    public DateTime Tarih { get; set; }

    /// <summary>Giriş ya da Çıkış</summary>
    public string Tur { get; set; }

    /// <summary>"08:30" biçiminde</summary>
    public string Saat { get; set; }

    public string Sebep { get; set; }
}

/// <summary>Eski çizelgeden aktarılan mülakat satırı</summary>
public class MulakatAktarimSatiri
{
    public string Donem { get; set; }
    public string AdSoyad { get; set; }
    public string SubeAdi { get; set; }
    public string Gorev { get; set; }
    public DateTime? GirisTarihi { get; set; }
    public DateTime? CikisTarihi { get; set; }

    /// <summary>Yöneticinin yazdığı neden</summary>
    public string CikisNedeni { get; set; }
    public string YoneticiYorumu { get; set; }

    /// <summary>İK değerlendirmesi; varsa nihai neden budur</summary>
    public string IkCikisNedeni { get; set; }
    public string IkYorum { get; set; }
}

/// <summary>Şube kırılımı için dönem ve özet isteği</summary>
public class SubeOzetiGirdi
{
    public string SubeAdi { get; set; }
    public DateTime Baslangic { get; set; }
    public DateTime Bitis { get; set; }

    /// <summary>Yapay zekâ özeti istensin mi; maliyetli olduğu için isteğe bağlı</summary>
    public bool OzetIste { get; set; }
}

/// <summary>Mobil modül yetkileri</summary>
/// <summary>
/// Alt menü yazma girdisi. Portal bu uca yazıyor; ayar tek kaynakta
/// (Kariyer form ayarları) kalsın diye kopyalanmıyor.
/// </summary>
/// <summary>Gift kart şifre değiştirme girdisi.</summary>
/// <summary>Kart kullanım biçimi girdisi; true ise mobil ödeme.</summary>
public class GiftKartGrupGirdi
{
    public bool Mobil { get; set; } = true;

    /// <summary>Fiziki karta geçerken yeni kart şifresi (1.7)</summary>
    public string Sifre { get; set; }
}

public class GiftKartSifreGirdi
{
    public string Sifre { get; set; }
}

/// <summary>
/// Kart tanımlama girdisi: kart numarası ve alışveriş tercihi.
///
/// Tercih doğrudan GrupNo'ya yazılıyor — mobil ise 608, fiziki ise NULL.
/// </summary>
public class GiftKartBagGirdi
{
    public string KartNo { get; set; }
    public bool Mobil { get; set; } = true;

    /// <summary>Fiziki karta geçerken yeni kart şifresi (1.7); mobilde şifre silinir</summary>
    public string Sifre { get; set; }
}

public class AltMenuGirdi
{
    public List<string> AltMenu { get; set; } = new();
}

public class ModulYetkiGirdi
{
    /// <summary>Modül kodu → o modülü görebilecek pozisyonlar</summary>
    public Dictionary<string, List<string>> Yetkiler { get; set; } = new();

    /// <summary>Alt menüde görünecek modüller; en fazla dört</summary>
    public List<string> AltMenu { get; set; } = new();
}

/// <summary>Sol menü sıralaması</summary>
public class MenuSirasiGirdi
{
    public List<string> Sira { get; set; } = new();

    /// <summary>Alt menü anahtarı → üst menü anahtarı</summary>
    public Dictionary<string, string> Gruplar { get; set; } = new();
}

/// <summary>Ankete davet gönderimi</summary>
public class AnketGonderGirdi
{
    public string PersonelKodu { get; set; }
    public string KimlikNo { get; set; }
    public string AdSoyad { get; set; }
    public string Telefon { get; set; }
    public string Gorev { get; set; }
    public string SubeAdi { get; set; }
    public DateTime? CikisTarihi { get; set; }
}

/// <summary>Adayın doldurduğu anket yanıtı</summary>
public class AnketYanitGirdi
{
    /// <summary>Kimlik doğrulaması; kayıtta kimlik varsa eşleşmeli</summary>
    public string KimlikNo { get; set; }

    /// <summary>
    /// Son çalışılan birim. Elle gönderilen anketlerde şube bilgisi
    /// baştan bilinmediği için kişinin kendisi seçer.
    /// </summary>
    public string SubeAdi { get; set; }

    public List<MulakatSorusu> Sorular { get; set; } = new();
    public List<MulakatPuani> Puanlar { get; set; } = new();
    public string CikisNedeni { get; set; }
    public bool? TekrarCalisir { get; set; }
    public int? TavsiyePuani { get; set; }
}

/// <summary>Yapay zekâ özeti istenen mülakatlar</summary>
public class MulakatOzetGirdi
{
    /// <summary>Belirli mülakatlar; boşsa tarih aralığındakiler alınır</summary>
    public List<int> Idler { get; set; } = new();

    public DateTime? Baslangic { get; set; }
    public DateTime? Bitis { get; set; }
}

/// <summary>Okutma raporu elle gönderim girdisi</summary>
public class OkutmaRaporuGirdi
{
    public DateTime? Bas { get; set; }
    public DateTime? Bit { get; set; }

    /// <summary>Boş bırakılırsa tüm bölgeler kapsanır</summary>
    public List<string> Bolgeler { get; set; } = new();

    public List<string> Adresler { get; set; } = new();
}

/// <summary>Ünvan eşleştirme girdisi</summary>
public class OrgEslesmeGirdi
{
    public string Unvan { get; set; }

    /// <summary>Boş bırakılırsa eşleştirme kaldırılır</summary>
    public int? KutuId { get; set; }
}

/// <summary>Organizasyon şemasındaki bir kutu</summary>
public class OrgKutu
{
    public int Id { get; set; }
    public int? UstId { get; set; }
    public string Unvan { get; set; }

    /// <summary>Kutu rengi: yesil, mavi, turuncu, kirmizi, mor, gri, bej</summary>
    public string Renk { get; set; }

    public int Sira { get; set; }

    /// <summary>Her mağazada tekrar eden pozisyon mu</summary>
    public bool MagazaMi { get; set; }

    /// <summary>Bu kutudaki kişi altındakilerin yıllık izin talebini onaylar mı</summary>
    public bool IzinOnay { get; set; } = true;

    public string Aciklama { get; set; }

    /// <summary>Bu ünvanda çalışan personel sayısı</summary>
    public int PersonelSayisi { get; set; }

    /// <summary>Tuvaldeki konum ve genişlik; boşsa otomatik düzen.</summary>
    public int? KonumX { get; set; }
    public int? KonumY { get; set; }
    public int? Genislik { get; set; }
}

/// <summary>Şema sıfırlama onayı: yanlışlıkla tıklanmasın diye yazılı.</summary>
public class OrgSifirlaGirdi
{
    public string Onay { get; set; }
}

/// <summary>Tuvalde taşınan kutunun yeni konumu.</summary>
public class OrgKonum
{
    public int Id { get; set; }
    public int X { get; set; }
    public int Y { get; set; }
    public int? Genislik { get; set; }
}

/// <summary>QR geçiş sistemindeki tek bir hareket</summary>
public class GecisHareketi
{
    public int Id { get; set; }
    public int KisiId { get; set; }
    public DateTime GecisZamani { get; set; }

    /// <summary>Giriş mi çıkış mı; kuruluma göre sayı ya da metin</summary>
    public string GecisYonu { get; set; }

    public string GecisNoktasi { get; set; }

    /// <summary>Okutmanın geldiği yer: iCard, Biçen360 ya da Manuel</summary>
    public string Kaynak { get; set; }
}

/// <summary>Takip listesinde görünen personel</summary>
public class TakipKisisi
{
    public string PersonelKodu { get; set; }
    public string Ad { get; set; }
    public string Soyad { get; set; }
    public string KimlikNo { get; set; }
    public string Telefon { get; set; }
    public string IsGrubu { get; set; }
    public string Pozisyon { get; set; }
    public DateTime? GirisTarihi { get; set; }

    /// <summary>İşe girişten bu yana geçen gün</summary>
    public int GecenGun { get; set; }

    /// <summary>Hedef güne kalan; eksi değer günün geçtiğini gösterir</summary>
    public int KalanGun { get; set; }

    public bool Tamamlandi { get; set; }
    public string NotDurumu { get; set; }
    public string NotMetni { get; set; }
    public DateTime? NotTarihi { get; set; }
    public string NotKullanici { get; set; }

    /// <summary>
    /// Bu dönemin işe uyum anketi: null (gönderilmedi), bekliyor,
    /// dolduruldu, suresiDoldu. Takip listesinde aramadan önce anketin
    /// durumunu görmek için.
    /// </summary>
    public string AnketDurumu { get; set; }
    public DateTime? AnketGonderim { get; set; }
    public DateTime? AnketGecerlilik { get; set; }
    public DateTime? AnketDolduruldu { get; set; }
    public decimal? AnketPuan { get; set; }

    /// <summary>
    /// Aynı dönemin yönetici formu: birim başına tek gönderim gider,
    /// kişinin satırında hangi yöneticiye gittiği ve durumu görünür.
    /// </summary>
    public string YoneticiAnketDurumu { get; set; }
    public string YoneticiAdi { get; set; }
    public string YoneticiTelefon { get; set; }
    public DateTime? YoneticiAnketGonderim { get; set; }
    public DateTime? YoneticiAnketGecerlilik { get; set; }
    public DateTime? YoneticiAnketDolduruldu { get; set; }

    /// <summary>"magaza" ya da "bolge": kişiyi kim değerlendirir</summary>
    public string YoneticiKaynak { get; set; }

    /// <summary>Kurala göre bir yönetici bulunabildi mi</summary>
    public bool YoneticiBulundu { get; set; }

    /// <summary>
    /// Kişi dönem penceresinin dışında ama bu dönem için gönderilmiş ve
    /// yanıtlanmamış bir anketi var; yeniden gönderilebilsin diye listede
    /// tutulur.
    /// </summary>
    public bool PencereDisi { get; set; }

    /// <summary>
    /// Kaçırıldı (07.10.2026): pencere dışında ve anketi (çalışan ve
    /// yönetici) artık açık değil. "Bekleyen" sayılmaz; listede altta ayrı
    /// görünür. Kişi zamanı gelince bir sonraki dönemin anketine girer.
    /// </summary>
    public bool Kacirildi { get; set; }

    /// <summary>Kaçırılan kişinin gireceği sonraki dönem ("6. Ay · 170. gün")</summary>
    public string SonrakiDonem { get; set; }

    /// <summary>
    /// Çalışan anketinin kanalı: "uygulama" ya da "sms". Gönderilmemişse
    /// gönderilince nereye düşeceği (personel uygulamayı kullanıyorsa
    /// uygulama). Eski kayıtlarda kanal boş; onlar SMS sayılır.
    /// </summary>
    public string AnketKanal { get; set; }

    /// <summary>Çalışan anketinin 24 saat kala hatırlatması gittiyse zamanı</summary>
    public DateTime? AnketHatirlatma { get; set; }

    /// <summary>Personel uygulamayı (görev ekranlı sürüm) kullanıyor mu</summary>
    public bool UygulamaKullaniyor { get; set; }

    /// <summary>
    /// Yönetici değerlendirmesinin kanalı: uygulamadan değerlendirdiyse ya
    /// da yöneticisi uygulamayı kullanıyorsa "uygulama", aksi hâlde "sms".
    /// </summary>
    public string YoneticiKanal { get; set; }

    /// <summary>Yöneticinin bu kişi için verdiği puan (5'lik), değerlendirdiyse</summary>
    public double? YoneticiPuan { get; set; }
}

/// <summary>Personel takip görüşmesi notu</summary>
public class TakipGirdi
{
    public string PersonelKodu { get; set; }
    public string KimlikNo { get; set; }
    public string AdSoyad { get; set; }
    public string Donem { get; set; }
    public string Durum { get; set; }
    public string Not { get; set; }
}

/// <summary>Kara listeye adres ekleme girdisi</summary>
public class KaraListeGirdi
{
    public string Ip { get; set; }
    public string Sebep { get; set; }
}

/// <summary>İşe alım onay/ret girdisi</summary>
public class OnayGirdi
{
    public bool Onaylandi { get; set; }
    public string Not { get; set; }
}

public class IseAlGirdi
{
    public DateTime IseGirisTarihi { get; set; }
    /// <summary>Rotasyon yapıldıysa yeni birim kodu; boşsa değişmez.</summary>
    public string SubeKodu { get; set; }
    /// <summary>İşe başlayacağı pozisyon</summary>
    public string Bolum { get; set; }
    /// <summary>Anlaşılan net ücret</summary>
    public decimal? AnlasilanUcret { get; set; }

    /// <summary>Aylık yol ücreti</summary>
    public decimal? YolUcreti { get; set; }

    /// <summary>Zorunlu: işe alım gerekçesi veya açıklaması</summary>
    public string Aciklama { get; set; }

    /// <summary>
    /// Zorunlu (07.10.2026): personele verilecek Biçen Kart numarası. Aday
    /// Mikro'ya işlenince kart sicile kendiliğinden bağlanır.
    /// </summary>
    public string KartNo { get; set; }

    /// <summary>
    /// İsteğe bağlı (09.10.2026): doluysa işe alım onaylanınca Mikro'da
    /// (MikroDesktop_2004BICEN) sicil kartı açılır.
    /// </summary>
    public BicenKariyer.API.Servisler.MikroSicilServisi.Girdi MikroSicil { get; set; }
}

public class GorusmeGirdi
{
    public DateTime GorusmeTarihi { get; set; }
    public string GorusmeYeri { get; set; }
    public string Aciklama { get; set; }
    public bool AdayaMailGonder { get; set; } = true;
}

/* ==========================================================================
 * Kadro planı ve aday havuzu
 * ========================================================================== */

/// <summary>Açık pozisyon tanımı: hangi bölüme kaç kişi alınacak.</summary>
public class Kadro
{
    public int Id { get; set; }
    public string Bolum { get; set; }
    /// <summary>Boş ise tüm şubeler için geçerlidir.</summary>
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    /// <summary>
    /// Norm kadro: bu pozisyonda çalışması gereken kişi sayısı.
    /// Yarım kadro (24,5 gibi) olabildiği için ondalıklıdır.
    /// </summary>
    public decimal Norm { get; set; }

    /// <summary>Hâlen çalışan personel sayısı</summary>
    public decimal Mevcut { get; set; }

    /// <summary>İhtiyaç (norm - mevcut). Norm girilmemişse elle belirlenir.</summary>
    public decimal Hedef { get; set; } = 1;

    /// <summary>Bu pozisyonda çalışan engelli personel sayısı</summary>
    public decimal Engelli { get; set; }

    /// <summary>Eksiğin başladığı tarih; "kaç gündür eksik" bundan hesaplanır</summary>
    public DateTime? EksikBaslangic { get; set; }

    /// <summary>Eksiğin kaç gündür sürdüğü (hesaplanır)</summary>
    public int EksikGun { get; set; }

    /// <summary>Fazlalığın başladığı tarih</summary>
    public DateTime? FazlaBaslangic { get; set; }

    /// <summary>Fazlalığın kaç gündür sürdüğü (hesaplanır)</summary>
    public int FazlaGun { get; set; }

    /// <summary>Norm üstü personel sayısı (mevcut - norm)</summary>
    public decimal Fazla { get; set; }

    public string Aciklama { get; set; }
    public bool Aktif { get; set; } = true;
    public DateTime Olusturma { get; set; }

    /// <summary>
    /// Bugün raporlu olan çalışan sayısı (kişi). Tabloda tutulmuyor, ekran
    /// açılırken hesaplanıyor. Mevcut'a dahildir; yalnızca bilgi.
    /// </summary>
    public int Raporlu { get; set; }

    /// <summary>Raporlu personel: "Ad Soyad · Ünvan · bitiş tarihi"</summary>
    public List<string> Raporlular { get; set; } = new();
}

/// <summary>Norm kadro ekranı açılırken yapılan Mikro senkron sonucu</summary>
public class MikroSenkronSonucu
{
    /// <summary>Kaç (şube, bölüm) satırının "mevcut" değeri değişti</summary>
    public int Guncellenen { get; set; }

    /// <summary>Personel bulunduğu için otomatik açılan yeni bölüm satırı sayısı</summary>
    public int Eklenen { get; set; }

    /// <summary>Norm kadro satırlarına yazılabilen toplam aktif personel</summary>
    public int Sayilan { get; set; }

    /// <summary>Personel listesindeki toplam aktif personel</summary>
    public int ToplamAktif { get; set; }

    /// <summary>Kadroda yeri bulunamadığı için sayılamayan personel dökümü</summary>
    public List<string> Eslesemeyen { get; set; } = new();

    /// <summary>Personel listesine hiç ulaşılamadıysa dolu gelir</summary>
    public string Hata { get; set; }
}

/// <summary>Şube bazlı norm kadro raporu satırı (Excel görünümü)</summary>
public class SubeNormRaporu
{
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string BirimTuru { get; set; }
    public string Bolge { get; set; }

    public int Sira { get; set; }

    public decimal Norm { get; set; }
    public decimal Mevcut { get; set; }
    public decimal Fark { get; set; }
    public decimal EngelliCalisan { get; set; }

    public List<KadroSatiri> Eksikler { get; set; } = new();
    public List<KadroSatiri> Fazlalar { get; set; } = new();

    /// <summary>Bu şubeye işe alınan adaylar (pozisyon · ad)</summary>
    public List<string> IseAlinanlar { get; set; } = new();

    /// <summary>Evrak süreci devam eden adaylar</summary>
    public List<string> EvrakTamamlayanlar { get; set; } = new();

    /// <summary>Bu şubeye rotasyonla yönlendirilen aday sayısı</summary>
    public int Rotasyon { get; set; }

    /// <summary>Havuzda bekleyen olumlu aday sayısı</summary>
    public int HavuzdakiAday { get; set; }

    /// <summary>
    /// Çıkış tarihi ileri bir güne yazılmış, yani ayrılacağı belli olan
    /// personel. Mevcut sayısına hâlâ dahildir: çıkış gününe kadar
    /// çalışıyor. Yerine alım bu sayıya bakılarak planlanır.
    /// </summary>
    public int Ayrilacak { get; set; }

    /// <summary>Ayrılacak personelin adı ve çıkış tarihi (ekranda liste)</summary>
    public List<string> Ayrilacaklar { get; set; } = new();

    /// <summary>
    /// Rapor gününde raporlu olan çalışan sayısı (kişi). Mevcut sayısına
    /// dahildir; engelli sütunu gibi bilgi amaçlı.
    /// </summary>
    public int Raporlu { get; set; }

    /// <summary>Raporlu personel: "Ad Soyad · Ünvan · bitiş tarihi"</summary>
    public List<string> Raporlular { get; set; } = new();
}

/// <summary>
/// Pozisyon bazında maaş skalası.
///
/// Her pozisyon için alt ve üst sınır tanımlanır; işe alım sırasında girilen
/// ücret bu aralığın dışındaysa uyarı verilir.
/// </summary>
public class MaasSkalasi
{
    public string Bolum { get; set; }
    public decimal AltSinir { get; set; }
    public decimal UstSinir { get; set; }
    public string Aciklama { get; set; }
}

/// <summary>Maaş skalası ayarları</summary>
public class MaasAyarlari
{
    public List<MaasSkalasi> Skalalar { get; set; } = new();
    /// <summary>Skalanın son güncellendiği tarih (bilgi amaçlı)</summary>
    public DateTime? Guncelleme { get; set; }
}

/// <summary>
/// Personel kaynağındaki adların sistemdeki karşılıkları.
///
/// Mikro'daki iş grubu adları sistemdeki birim adlarıyla birebir aynı
/// olmayabilir (örneğin "HAL ŞOFÖRÜ" ayrı bir iş grubudur ama Genel
/// Müdürlük'e bağlıdır). Bu eşleştirmeler o farkı kapatır.
/// </summary>
public class PersonelAyarlari
{
    public List<AdEslemesi> IsGrubuEslemeleri { get; set; } = new();
    public List<AdEslemesi> UnvanEslemeleri { get; set; } = new();

    /// <summary>
    /// Pozisyon bazlı kadro ağırlıkları. Norm kadroda bir kişinin kaç
    /// kadro saydığını belirler: tam zamanlı 1, yarı zamanlı 0,5.
    /// Listede karşılığı olmayan pozisyonlar 1 sayılır.
    /// </summary>
    public List<KadroAgirligi> Agirliklar { get; set; } = new();
}

/// <summary>Bir pozisyonun norm kadrodaki ağırlığı</summary>
public class KadroAgirligi
{
    /// <summary>Norm kadrodaki bölüm adı (ör. "Part time Kasiyer")</summary>
    public string Bolum { get; set; }

    /// <summary>Bir kişinin kaç kadro saydığı: 1 ya da 0,5</summary>
    public decimal Agirlik { get; set; } = 1m;
}

/// <summary>Kaynaktaki ad ile sistemdeki karşılığı</summary>
public class AdEslemesi
{
    /// <summary>Personel veritabanındaki ad (iş grubu veya ünvan)</summary>
    public string Kaynak { get; set; }
    /// <summary>Sistemdeki karşılığı: birim kodu veya pozisyon adı</summary>
    public string Hedef { get; set; }
}

/// <summary>Bir pozisyonun doldurulma kaydı</summary>
public class DoldurmaKaydi
{
    public int Id { get; set; }
    public string AdSoyad { get; set; }
    public string Bolum { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    /// <summary>Pozisyonun kaç dakikada doldurulduğu</summary>
    public int Dakika { get; set; }
    /// <summary>Sürenin nereden ölçüldüğü: "kadro" veya "basvuru"</summary>
    public string Olcum { get; set; }
    public DateTime? IseGirisTarihi { get; set; }
    /// <summary>Adayın başvuru tarihi ve saati</summary>
    public DateTime BasvuruTarihi { get; set; }
    public string Kullanici { get; set; }
    /// <summary>İşlemi yapan personelin adı</summary>
    public string KullaniciAdSoyad { get; set; }
    public string Bolge { get; set; }
}

/// <summary>Olumsuz sonuçlandırılan başvuru kaydı</summary>
public class OlumsuzKaydi
{
    public int Id { get; set; }
    public string AdSoyad { get; set; }
    public string Telefon { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string Bolumler { get; set; }
    /// <summary>Başvurulan ilk pozisyon (gruplama için)</summary>
    public string Bolum { get; set; }
    public string Bolge { get; set; }
    public DateTime BasvuruTarihi { get; set; }
    public DateTime IslemTarihi { get; set; }
    public string Gerekce { get; set; }
    public string Kullanici { get; set; }
    public string KullaniciAdSoyad { get; set; }

    /// <summary>Gerekçe metninden çıkarılan grup (ör. "Ücret beklentisi yüksek")</summary>
    public string NedenGrubu { get; set; }
}

/// <summary>Bölge veya birim türü bazında norm kadro özeti</summary>
public class BolgeNormSatiri
{
    public string Ad { get; set; }
    /// <summary>"tur" (Şubeler, Depo...) veya "bolge"</summary>
    public string Tur { get; set; }
    public List<string> Sorumlular { get; set; } = new();

    public decimal Norm { get; set; }
    public decimal Mevcut { get; set; }
    public decimal Eksik { get; set; }
    public decimal Fazla { get; set; }
    public decimal Engelli { get; set; }

    /// <summary>Bugün raporlu çalışan sayısı (kişi; mevcuda dahil)</summary>
    public int Raporlu { get; set; }

    public int BirimSayisi { get; set; }
}

/// <summary>Günlük mesaj için fazla personel dökümü</summary>
public class FazlaDetay
{
    public string Sube { get; set; }
    public string Pozisyonlar { get; set; }
}

/// <summary>Rapordaki eksik/fazla pozisyon satırı</summary>
public class KadroSatiri
{
    public string Bolum { get; set; }
    public decimal Adet { get; set; }
    public int Gun { get; set; }
    public string Aciklama { get; set; }
}

public class HavuzAdayi
{
    public int Id { get; set; }

    /// <summary>Eski çalışan eşleştirmesi için; panele gönderilmez</summary>
    public string KimlikNo { get; set; }

    /// <summary>Aday formda engel durumu belirtmiş mi</summary>
    public bool EngelVar { get; set; }

    /// <summary>Daha önce çalışıp ayrılmış mı</summary>
    public bool EskiCalisan { get; set; }
    public string BasvuruNo { get; set; }
    public string AdSoyad { get; set; }
    public string Telefon { get; set; }
    public string Eposta { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string Bolumler { get; set; }
    public string Ilce { get; set; }
    public string Mahalle { get; set; }
    public DateTime? GorusmeTarihi { get; set; }
    public DateTime Olusturma { get; set; }
    /// <summary>İşe alınanlarda hangi pozisyona alındığı</summary>
    public string IseGirisBolum { get; set; }
    public List<BasvuruNotu> Notlar { get; set; } = new();
}

/// <summary>
/// Havuzda bekleyen adaylar bölge bazında gruplanır; her bölgenin altında
/// pozisyonlar listelenir.
/// </summary>
public class HavuzBolgeKarti
{
    public string Bolge { get; set; }
    public List<string> Subeler { get; set; } = new();
    public List<HavuzPozisyonSatiri> Pozisyonlar { get; set; } = new();

    /// <summary>Bölgede havuzda bulunması hedeflenen toplam aday</summary>
    public int ToplamHedef { get; set; }

    /// <summary>Bölgede havuzda bekleyen toplam aday</summary>
    public int ToplamAday { get; set; }

    /// <summary>Bu bölgeden dönem içinde işe alınan aday sayısı</summary>
    public int IseAlinan { get; set; }
}

/// <summary>Bir bölgedeki tek bir pozisyonun havuz durumu</summary>
public class HavuzPozisyonSatiri
{
    public string Bolum { get; set; }

    /// <summary>Havuzda beklemesi hedeflenen aday sayısı</summary>
    public int Hedef { get; set; }

    /// <summary>
    /// Bu pozisyon için havuz hedefi tanımlanmamış; aday geldiği için
    /// listeye kendiliğinden eklendi.
    /// </summary>
    public bool HedefTanimsiz { get; set; }

    /// <summary>Şu an havuzda bekleyen adaylar</summary>
    public List<HavuzAdayi> Adaylar { get; set; } = new();

    /// <summary>Bu pozisyona bu bölgeden işe alınanların sayısı</summary>
    public int IseAlinan { get; set; }
}

/// <summary>
/// Aday havuzuna özel ayarlar.
///
/// Havuz bölgeleri, şirketin yönetsel bölgelerinden bağımsızdır: adayların
/// oturduğu yere göre "Küçükçekmece tarafı", "Esenyurt tarafı" gibi serbest
/// gruplar tanımlanabilir.
/// </summary>
public class HavuzAyarlari
{
    public List<BolgeTanimi> Bolgeler { get; set; } = new();
}

/// <summary>
/// Aday havuzu ihtiyaç tanımı.
///
/// Norm Kadro ekranından bağımsızdır: havuz, işe alım hedeflerini bölge ve
/// pozisyon bazında kendi tablosunda tutar.
/// </summary>
public class HavuzIhtiyac
{
    public int Id { get; set; }
    public string Bolge { get; set; }
    public string Bolum { get; set; }
    public int Ihtiyac { get; set; }
    public string Aciklama { get; set; }
}

/// <summary>Aday havuzunda bir pozisyonun bölge kırılımı</summary>
public class HavuzBolgesi
{
    public string Bolge { get; set; }
    public int Ihtiyac { get; set; }
    public int Norm { get; set; }
    public int MevcutPersonel { get; set; }
    public List<string> Subeler { get; set; } = new();
    public List<HavuzAdayi> Adaylar { get; set; } = new();
}

/// <summary>Aday havuzunda pozisyon kartı</summary>
public class HavuzPozisyonu
{
    public string Bolum { get; set; }
    public int ToplamIhtiyac { get; set; }
    public int ToplamNorm { get; set; }
    public int ToplamMevcut { get; set; }
    public int ToplamAday { get; set; }
    public List<HavuzBolgesi> Bolgeler { get; set; } = new();
}

public class HavuzGrubu
{
    public int KadroId { get; set; }
    public string Bolum { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public int Norm { get; set; }
    public int MevcutPersonel { get; set; }
    public int Hedef { get; set; }
    public int Mevcut { get; set; }
    public string Aciklama { get; set; }
    public List<HavuzAdayi> Adaylar { get; set; } = new();
}

/* ==========================================================================
 * Raporlar
 * ========================================================================== */

public class RaporGenel
{
    public int Toplam { get; set; }
    public int Yeni { get; set; }
    /* İncelendi ve Onay Bekliyor sayılmıyordu; kutuların toplamı "Toplam"
       ile tutmuyordu (03.10.2026). Başvurular sayfasındaki aşamalarla aynı. */
    public int Incelendi { get; set; }
    public int Degerlendirmede { get; set; }
    public int GorusmeTalebi { get; set; }
    public int Olumlu { get; set; }
    public int EvrakHazirlaniyor { get; set; }
    public int OnayBekliyor { get; set; }
    public int IseAlindi { get; set; }
    public int Olumsuz { get; set; }
    /// <summary>Fotoğrafı ve e-postası olan aday sayısı gibi ek bilgiler</summary>
    public int EpostaliAday { get; set; }
    public int EngelBeyanEden { get; set; }
}

public class AylikRapor
{
    public int Yil { get; set; }
    public int Ay { get; set; }
    public string Etiket { get; set; }
    public int Toplam { get; set; }
    public int Gorusme { get; set; }
    public int Olumlu { get; set; }
    public int Olumsuz { get; set; }
}

/// <summary>Şube bazlı norm kadro ve ihtiyaç raporu satırı</summary>
public class NormKadroRapor
{
    public int KadroId { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string Bolum { get; set; }
    public decimal Norm { get; set; }
    public decimal MevcutPersonel { get; set; }
    public decimal Ihtiyac { get; set; }

    /// <summary>Norm üstü çalışan sayısı; ihtiyaçla aynı anda olabilir</summary>
    public decimal Fazla { get; set; }

    /// <summary>Engelli çalışan (Norm Kadro ekranındaki sütunla aynı alan)</summary>
    public decimal Engelli { get; set; }
    public int Basvuru { get; set; }
    public int Olumlu { get; set; }
    public int IseAlinan { get; set; }
    public string Aciklama { get; set; }
}

/// <summary>
/// iCardBicen veritabanından okunan personel kaydı.
/// Durum: 1 = çalışıyor, diğer değerler işten ayrılmış.
/// </summary>
public class PersonelKaydi
{
    /// <summary>
    /// Mikro'daki engellilik derecesi (per_kim_sakat_derece).
    /// 0 sağlam; 0'dan büyük her değer engelli kadrosu sayılır ve
    /// norm kadroda yarım kadro olarak hesaplanır.
    /// </summary>
    public int SakatDerece { get; set; }

    /// <summary>Engelli kadrosunda mı</summary>
    public bool Engelli => SakatDerece > 0;

    /// <summary>Mikro'da kaydı en son değiştiren kullanıcı</summary>
    public string SonDegistiren { get; set; }

    /// <summary>Mikro'daki son değişiklik zamanı</summary>
    public DateTime? SonDegisiklik { get; set; }

    public int PersonId { get; set; }
    /// <summary>Mikro personel kodu (sicil)</summary>
    public string PersonelKodu { get; set; }
    /// <summary>İş grubu (bağlı olduğu birim)</summary>
    public string IsGrubu { get; set; }
    public string Ad { get; set; }
    public string Soyad { get; set; }
    public string Telefon { get; set; }
    public string KimlikNo { get; set; }
    public int PozisyonId { get; set; }

    /// <summary>1 çalışıyor, 0 ayrılmış. Çıkışı ileri tarihli olan çalışıyor sayılır.</summary>
    public int Durum { get; set; }

    /// <summary>
    /// Çıkış tarihi ileri bir güne yazılmış: kişi çalışmaya devam ediyor
    /// ama ayrılacağı belli. Listede ayrı bir rozetle gösteriliyor ve
    /// norm kadroda "kaybedilecek personel" olarak sayılıyor.
    /// </summary>
    public bool Ayrilacak { get; set; }
    /// <summary>Çalıştığı yer (şube)</summary>
    public string Sube { get; set; }
    public string Pozisyon { get; set; }
    public DateTime? GirisTarihi { get; set; }
    public DateTime? CikisTarihi { get; set; }

    /// <summary>Çalışma süresi (gün) — hesaplanır. Yalnızca bu dönem (son giriş).</summary>
    public int CalismaGunu { get; set; }

    /// <summary>
    /// Kıdem esas tarihi (05.10.2026): yıllık izin hak ediş düzeltmesi varsa
    /// o (bordrodaki bütün girişlerden otomatik ya da İK'nın elle girdiği),
    /// yoksa işe giriş. Ayrılıp dönen personelde önceki çalışmalar dahil.
    /// </summary>
    public DateTime? KidemTarihi { get; set; }

    /// <summary>Toplam kıdem (gün): kıdem esas tarihinden bugüne ya da çıkışa.</summary>
    public int KidemGunu { get; set; }

    /// <summary>Kıdem kaynağı: "bordro" (otomatik), "elle" (İK) ya da null (işe giriş).</summary>
    public string KidemKaynak { get; set; }

    /// <summary>İşten çıkış sebebi (kaynakta tanımlıysa)</summary>
    public string CikisSebebi { get; set; }

    /// <summary>Resim eşleştirmesi için kayıt kimliği</summary>
    public Guid? Guid { get; set; }

    /// <summary>Aynı kişinin kaç kez işe alındığı</summary>
    public int CalismaSayisi { get; set; }

    /// <summary>Personel kartında fotoğraf var mı</summary>
    public bool ResimVar { get; set; }

    /// <summary>
    /// Fotoğrafın son değiştirilme damgası. Resim adresine eklenir; panelden
    /// yeni fotoğraf yüklendiğinde tarayıcı eskisini göstermeye devam etmesin.
    /// </summary>
    public long ResimSurumu { get; set; }

    /// <summary>Kayıtlı net ücret (kaynakta tanımlıysa)</summary>
    public decimal? Ucret { get; set; }

    /// <summary>Önbellekten verilen kopya (alanların hepsi değer türü ya da metin)</summary>
    public PersonelKaydi Kopya() => (PersonelKaydi)MemberwiseClone();
}

/// <summary>Not izleme ekranı için birleşik kayıt</summary>
public class NotKaydi
{
    public int Id { get; set; }
    public int BasvuruId { get; set; }
    public string BasvuruNo { get; set; }
    public string AdaySoyad { get; set; }
    public string Telefon { get; set; }
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string Bolumler { get; set; }
    public string Durum { get; set; }
    public string Metin { get; set; }
    public string Kullanici { get; set; }
    public string YazanAdSoyad { get; set; }
    public string YazanUnvan { get; set; }
    public string YazanRol { get; set; }
    public DateTime Tarih { get; set; }
}

/// <summary>İK uzmanı performans satırı</summary>
public class PerformansSatiri
{
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Unvan { get; set; }
    /// <summary>Virgülle ayrılmış bölge listesi</summary>
    public string Bolge { get; set; }
    public int Islem { get; set; }
    public int Inceleme { get; set; }
    public int Degerlendirme { get; set; }
    public int Gorusme { get; set; }
    public int Olumlu { get; set; }
    public int EvrakHazirlaniyor { get; set; }
    public int IseAlinan { get; set; }
    public int Olumsuz { get; set; }
    public int Not { get; set; }
    public int Rotasyon { get; set; }

    /// <summary>Başvurudan bu kişinin ilk işlemine kadar geçen ortalama saat</summary>
    public double OrtalamaTepkiSaat { get; set; }
    /// <summary>Gün karşılığı (geriye dönük uyumluluk için)</summary>
    public double OrtalamaTepkiGun { get; set; }
    /// <summary>En hızlı ve en yavaş tepki (saat)</summary>
    public double EnHizliSaat { get; set; }
    public double EnYavasSaat { get; set; }

    /// <summary>Açılan pozisyonu ortalama kaç dakikada doldurduğu</summary>
    public int OrtalamaDoldurmaDakika { get; set; }

    /// <summary>İşe aldıklarından kaçı daha önce şirkette çalışmıştı</summary>
    public int EskiCalisanAlimi { get; set; }

    /// <summary>Adayların ortalama ücret talebi</summary>
    public decimal OrtalamaTalep { get; set; }

    /// <summary>Ortalama anlaşılan ücret</summary>
    public decimal OrtalamaAnlasilan { get; set; }

    /// <summary>Ücret karşılaştırmasına giren işe alım sayısı</summary>
    public int UcretliAlim { get; set; }

    public int IlgilenilenBasvuru { get; set; }
    /// <summary>İşlem yaptığı farklı birim (şube) sayısı</summary>
    public int BirimSayisi { get; set; }
    /// <summary>Sonuçlandırdığı başvuru sayısı (olumlu + işe alınan + olumsuz)</summary>
    public int Sonuclanan { get; set; }
    public DateTime? SonIslem { get; set; }
}

/// <summary>Rapor ekranındaki işe alınanlar listesi</summary>
public class IseAlinanRapor
{
    public int Id { get; set; }
    public string BasvuruNo { get; set; }
    public string AdSoyad { get; set; }
    public string Telefon { get; set; }
    /// <summary>Norm kadro tablosunda şube bazında saymak için</summary>
    public string SubeKodu { get; set; }
    public string SubeAdi { get; set; }
    public string Bolumler { get; set; }
    public DateTime? IseGirisTarihi { get; set; }
    /// <summary>İşe başladığı pozisyon (başvurduğundan farklı olabilir)</summary>
    public string IseGirisBolum { get; set; }

    /// <summary>Adayın formda belirttiği net ücret beklentisi</summary>
    public string TalepUcret { get; set; }

    /// <summary>Pozisyonun açıldıktan kaç gün sonra doldurulduğu</summary>
    public int? DoldurmaGun { get; set; }
    /// <summary>Aynı bilginin dakika cinsinden karşılığı</summary>
    public int? DoldurmaDakika { get; set; }

    /// <summary>Başvurunun geldiği adres (kötüye kullanım incelemesi için)</summary>
    public string GonderenIp { get; set; }
    public string Tarayici { get; set; }
    public decimal? AnlasilanUcret { get; set; }
    public decimal? YolUcreti { get; set; }
    public DateTime Olusturma { get; set; }
}

public class KirilimRapor
{
    /// <summary>Şube kodu veya bölüm adı</summary>
    public string Anahtar { get; set; }
    public string Ad { get; set; }
    public int Toplam { get; set; }
    public int Gorusme { get; set; }
    public int Olumlu { get; set; }
    public int Olumsuz { get; set; }
    /// <summary>İşe alınan; Excel pivotunda ayrı sütun</summary>
    public int IseAlindi { get; set; }
    /// <summary>Şubenin bağlı olduğu bölge (şube kırılımında; tanımsızsa "Tanımsız")</summary>
    public string Bolge { get; set; }
    /// <summary>Kadro planındaki hedef (yalnızca bölüm kırılımında dolu)</summary>
    public decimal Hedef { get; set; }
}

/* ==========================================================================
 * Kullanıcı
 * ========================================================================== */

public class Kullanici
{
    /// <summary>İşe alım onayı verebilir mi</summary>
    /// <summary>Mikro kullanıcı numarası (per_create_user / per_lastup_user)</summary>
    public int? MikroKullaniciNo { get; set; }
    public bool OnayYetkisi { get; set; }

    public int Id { get; set; }
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Eposta { get; set; }
    /// <summary>Görüşme davet mailinde imza olarak kullanılır.</summary>
    public string Unvan { get; set; }
    public string Telefon { get; set; }
    /// <summary>
    /// Kullanıcının sorumlu olduğu bölgeler (virgülle ayrılmış).
    /// Yetkili şubeler bu bölgelerden türetilir.
    /// </summary>
    public string Bolge { get; set; }
    public string Rol { get; set; }
    public bool Aktif { get; set; }
    public DateTime Olusturma { get; set; }

    /// <summary>Bölge müdürüne tanımlı şube kodları (virgülle ayrılmış)</summary>
    public string Subeler { get; set; }

    /// <summary>Mikro personel kodu (sicil); bölge müdürünün izin onayı bu kişiye gider</summary>
    public string Sicil { get; set; }
}

public class GirisGirdi
{
    /// <summary>Turnstile doğrulama jetonu (hatalı denemeden sonra istenir)</summary>
    public string DogrulamaJetonu { get; set; }

    public string KullaniciAdi { get; set; }
    public string Parola { get; set; }
}

/// <summary>Kullanıcının kendi profilini düzenlemesi için.</summary>
public class ProfilGirdi
{
    public string AdSoyad { get; set; }
    public string Eposta { get; set; }
    public string Unvan { get; set; }
    public string Telefon { get; set; }
    /// <summary>Boş bırakılırsa parola değişmez.</summary>
    public string YeniParola { get; set; }
}

public class GirisCikti
{
    /// <summary>Kullanıcı kimliği; sınırlı ekranların denetiminde kullanılır</summary>
    public int Id { get; set; }

    /// <summary>
    /// Rolün ayardan gelen yetkileri. Panel menüyü ve düzenleme
    /// düğmelerini buna göre kısıtlar; asıl koruma sunucudadır.
    /// </summary>
    public RolYetkisi Yetki { get; set; }

    /// <summary>İşe alım onayı verebilir mi</summary>
    public bool OnayYetkisi { get; set; }

    /// <summary>
    /// Bu oturum başka bir kullanıcı adına açıldıysa gerçek kişinin adı.
    /// Panelde uyarı şeridi göstermek için kullanılır.
    /// </summary>
    public string TaklitEden { get; set; }

    public string Token { get; set; }
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Rol { get; set; }
    public DateTime GecerlilikSonu { get; set; }
}

public class KullaniciGirdi
{
    public int Id { get; set; }
    /// <summary>İşe alım onayı verebilir mi</summary>
    /// <summary>Mikro kullanıcı numarası: panelden Mikro'ya yazılan kayıtlar bu numarayla açılır (09.10.2026)</summary>
    public int? MikroKullaniciNo { get; set; }
    public bool OnayYetkisi { get; set; }
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Eposta { get; set; }
    public string Unvan { get; set; }
    public string Telefon { get; set; }
    public string Bolge { get; set; }
    /// <summary>Mikro personel kodu (sicil); boş bırakılabilir</summary>
    public string Sicil { get; set; }
    public string Rol { get; set; }
    /// <summary>Bölge müdürü için yetkili şube kodları</summary>
    public List<string> Subeler { get; set; } = new();
    public bool Aktif { get; set; } = true;
    /// <summary>Boş bırakılırsa mevcut parola korunur.</summary>
    public string Parola { get; set; }
}

/* ==========================================================================
 * Ayarlar
 * ========================================================================== */

public class MailAyarlari
{
    public string Sunucu { get; set; } = "";
    public int Port { get; set; } = 587;
    public bool SslKullan { get; set; } = true;

    /// <summary>"Otomatik", "STARTTLS", "SSL" veya "Yok"</summary>
    public string SifrelemeTuru { get; set; } = "Otomatik";
    public string KullaniciAdi { get; set; } = "";
    public string Parola { get; set; } = "";
    public string GonderenAd { get; set; } = "Biçen Kariyer";
    public string GonderenAdres { get; set; } = "";
    public List<string> AliciAdresler { get; set; } = new();
    /// <summary>Mail içindeki bağlantılar ve logo için kullanılır.</summary>
    public string SiteAdresi { get; set; } = "https://kariyer.bicen.com.tr";

    public bool BasvuruMailiGonder { get; set; } = true;
    public bool AdayaBilgiMailiGonder { get; set; } = true;
}

public class Sube
{
    public string Kod { get; set; }
    public string Ad { get; set; }
    /// <summary>Birim türü: "Şube", "Genel Müdürlük", "Lojistik Depo" ...</summary>
    public string Tur { get; set; } = "Şube";

    /// <summary>
    /// İşaretliyse bu birim Norm Kadro raporunda hiç görünmez ve
    /// toplamlara katılmaz. Kadro kayıtları ve personel sayımı yerinde
    /// durur; yalnızca rapordan gizlenir. Mağaza olmayan birimler
    /// (merkez büro, depo gibi) için kullanılır.
    /// </summary>
    public bool NormRaporundaGizle { get; set; }

    /// <summary>
    /// Şubenin kendi e-posta adresi. Günlük okutma raporu her sabah
    /// buraya, yalnızca o şubenin verisiyle gönderilir. Birden fazla
    /// adres virgülle ayrılabilir; boşsa şubeye rapor gitmez.
    /// </summary>
    public string Eposta { get; set; }

    /// <summary>
    /// İzin formunun gideceği adres (04.10.2026; Yönetim → İzin formu
    /// e-postaları). Şubede şubenin maili, depoda depo müdürünün maili.
    /// Boşsa: genel merkez İK'ya, diğerleri portaldaki şube e-postasına,
    /// o da yoksa İK'ya. Birden fazla adres virgülle ayrılabilir.
    /// </summary>
    public string IzinFormuEposta { get; set; }
}

/// <summary>
/// Bölge tanımı: bir bölgeye bağlı şube/birim kodları.
/// Kullanıcıya bölge atandığında yetkili şubeleri buradan türetilir.
/// </summary>
public class BolgeTanimi
{
    public string Ad { get; set; }
    public List<string> Subeler { get; set; } = new();
}

/// <summary>
/// Birim türü ve o türde başvurulabilecek pozisyonlar.
/// Aday önce birimi seçer, ardından yalnızca o birime ait pozisyonlar listelenir.
/// </summary>
public class BirimTuru
{
    public string Ad { get; set; }

    /// <summary>Karşılama ekranındaki kartta görünen kısa açıklama.</summary>
    public string Aciklama { get; set; } = "";

    /// <summary>Kartta görünen küçük rozet (örn. "34 şube").</summary>
    public string Rozet { get; set; } = "";

    public List<string> Bolumler { get; set; } = new();
}

/// <summary>Aday formunun içeriği; admin panelinden düzenlenir.</summary>
public class FormAyarlari
{
    public string Duyuru { get; set; } = "";

    /// <summary>
    /// Doğum gününde uygulamada gösterilen kutlama metni.
    ///
    /// Boş bırakılırsa genel bir cümle kullanılır. Kutlamanın sözünü İK
    /// yazmalı; yazılıma gömülü bir cümle kurumun diliyle uyuşmuyordu.
    /// </summary>
    public string DogumGunuMetni { get; set; } = "";
    public List<Sube> Subeler { get; set; } = new();

    /// <summary>
    /// Başvuru formundaki "bizi nereden duydunuz" seçenekleri.
    ///
    /// Liste panelden yönetiliyor: kaynaklar kampanyaya göre değişiyor
    /// (mağaza karekodu, ilan sitesi, sosyal medya) ve koda gömülünce her
    /// değişiklikte yeni sürüm gerekiyordu. Boş bırakılırsa alan formda
    /// hiç görünmez.
    /// </summary>
    public List<string> BasvuruKaynaklari { get; set; } = new();

    /// <summary>
    /// Çıkış anketinin adresi; SMS'te bu adrese kod eklenerek gönderilir
    /// (ör. kariyer.bicen.com.tr/anket). Boşsa varsayılan kullanılır.
    /// </summary>
    public string AnketAdresi { get; set; } = "";

    /// <summary>
    /// Genel Müdürlük adresi. Tüm görüşmeler burada yapıldığı için görüşme
    /// davetine eklenir; aday nereye geleceğini davetin içinde görsün.
    /// </summary>
    public string GorusmeAdresi { get; set; } = "";

    /// <summary>
    /// Genel Müdürlük konum bağlantısı (Google Haritalar vb.). Davete
    /// tıklanabilir bağlantı olarak konur.
    /// </summary>
    public string GorusmeHaritaAdresi { get; set; } = "";

    /// <summary>
    /// Sol menü sıralaması: menü anahtarları istenen sırayla tutulur.
    /// Listede olmayan menüler sonda, kendi doğal sıralarında kalır —
    /// yeni bir sayfa eklendiğinde ayar bozulmasın diye.
    /// </summary>
    public List<string> MenuSirasi { get; set; } = new();

    /// <summary>
    /// Menü grupları: hangi sayfa hangi başlığın altında görünecek.
    /// Anahtar alt menünün, değer üst menünün anahtarıdır.
    ///
    /// Bir sayfa üst başlık yapıldığında kendisi de ilk alt öğe olarak
    /// eklenir; aksi hâlde o sayfaya ulaşmak imkânsız hale gelirdi
    /// (üst başlıklar tıklanınca yalnızca açılır, sayfa açmaz).
    /// </summary>
    public Dictionary<string, string> MenuGruplari { get; set; } = new();

    /// <summary>
    /// Rol bazlı yetkiler. Anahtar rol adı, değer o rolün ayarları.
    ///
    /// Bir rol için kayıt yoksa koddaki varsayılan kurallar geçerlidir —
    /// ayar bozulduğunda sistem kilitlenmesin diye.
    /// </summary>
    public Dictionary<string, RolYetkisi> RolYetkileri { get; set; } = new();

    /// <summary>Panelden açılan roller; sabit rollere ek olarak.</summary>
    public List<OzelRol> OzelRoller { get; set; } = new();

    /// <summary>
    /// Mobil test numarası.
    ///
    /// Bu numaradan her personelin kimliğiyle giriş yapılabilir; cihaz
    /// kilidi de uygulanmaz. Yalnızca test sürecinde kullanılır ve canlıya
    /// geçmeden boşaltılmalıdır — kimlik numarası kolay ulaşılabilir bir
    /// bilgi olduğu için bu numarayı bilen biri herkesin verisini görebilir.
    ///
    /// Her kullanım güvenlik günlüğüne yazılır.
    /// </summary>
    public string MobilTestTelefon { get; set; } = "";

    /// <summary>
    /// Personelin uygulamadan talep edebileceği izin türleri.
    /// Boşsa yalnızca yıllık izin talep edilebilir.
    /// </summary>
    public List<string> TalepEdilebilirIzinler { get; set; } = new();

    /// <summary>
    /// Mobil modüllerin pozisyon yetkileri.
    ///
    /// Anahtar modül kodu, değer o modülü görebilecek pozisyonlar.
    /// Liste boşsa modül herkese açıktır — yeni bir modül eklendiğinde
    /// kimsenin göremediği bir durum oluşmasın.
    /// </summary>
    public Dictionary<string, List<string>> MobilModulYetkileri { get; set; } = new();

    /// <summary>
    /// Alt menüde görünecek modüller; kalanı "Diğer" altında toplanır.
    /// Boşsa varsayılan sıra kullanılır.
    /// </summary>
    public List<string> MobilAltMenu { get; set; } = new();

    /// <summary>Birim türleri ve her türe ait pozisyon listeleri.</summary>
    public List<BirimTuru> BirimTurleri { get; set; } = new();

    /// <summary>Bölgeler ve her bölgeye bağlı şubeler.</summary>
    public List<BolgeTanimi> Bolgeler { get; set; } = new();

    /// <summary>
    /// Görüşme daveti için WhatsApp mesaj şablonu.
    /// Kullanılabilir alanlar: {ad} {tarih} {saat} {yer} {not}
    /// {uzman} {unvan} {telefon} {basvuruNo}
    /// </summary>
    public string WhatsappSablonu { get; set; } = "";

    /// <summary>
    /// İşe uyum anketinde çalışana giden SMS metni.
    /// Kullanılabilir alanlar: {ad} {asama} {link}
    /// Boş bırakılırsa varsayılan metin kullanılır.
    /// </summary>
    public string UyumCalisanMesaji { get; set; } = "";

    /// <summary>
    /// İşe uyum anketinde mağaza yöneticisine giden SMS metni.
    /// Kullanılabilir alanlar: {asama} {link} {sube}
    /// </summary>
    public string UyumYoneticiMesaji { get; set; } = "";

    /// <summary>
    /// Aşamaya özel SMS metinleri.
    ///
    /// Anahtar: "calisan7g", "calisan2a", "calisan6a", "calisan1y",
    /// "yonetici7g", "yonetici2a", "yonetici6a", "yonetici1y".
    ///
    /// Boş bırakılan aşama için yukarıdaki genel metin, o da boşsa
    /// koddaki varsayılan kullanılır. Sözlük olarak tutuldu ki yeni bir
    /// aşama eklendiğinde model değiştirmek gerekmesin.
    /// </summary>
    public Dictionary<string, string> UyumMesajlari { get; set; } = new();

    /// <summary>
    /// Birim/pozisyon → yönetici eşleştirmesi.
    ///
    /// <para>
    /// Mağazalarda yönetici ünvandan bulunabiliyor (Mağaza Müdürü), ama
    /// Genel Müdürlük ve Lojistik Depo gibi birimlerde yan yana birçok
    /// müdür var; hangisinin kimin yöneticisi olduğu ünvandan çıkmıyor.
    /// Burada tanımlananlar tahmine üstün gelir.
    /// </para>
    /// </summary>
    public List<YoneticiEslesme> UyumYoneticiEslesme { get; set; } = new();

    /// <summary>
    /// Aşama koduna göre otomatik gönderim açık mı ("7g", "2a", "6a", "1y").
    /// Açıksa günlük görev o aşamaya gelen personele kendiliğinden SMS
    /// atar; kapalıysa gönderim panelden elle yapılır.
    /// </summary>
    public Dictionary<string, bool> UyumOtomatik { get; set; } = new();

    /// <summary>
    /// Aşama pencereleri ("7g", "2a", "6a", "1y" → en az / en fazla çalışma
    /// günü). Boşsa koddaki varsayılan kullanılır. Takip listesi, elle ve
    /// otomatik gönderim hep buradan okur.
    /// </summary>
    public Dictionary<string, AsamaPenceresi> UyumPencereleri { get; set; } = new();

    /// <summary>
    /// Ücret hesap pusulası alanı → Mikro PERSONEL_TAHAKKUKLARI sütunu.
    /// Boş bırakılan alan sütun adına göre otomatik tahmin edilir.
    /// </summary>
    public Dictionary<string, string> TahakkukEslesme { get; set; } = new();

    /// <summary>
    /// Pusulanın üst bloğundaki işyeri bilgileri. Mikro'daki FIRMALAR
    /// sütun adları sürüme göre değiştiği ve bu bilgiler sabit olduğu için
    /// tahmin yerine burada tutulur; Yönetim → Tahakkuk'tan düzenlenir.
    /// </summary>
    public TahakkukIsyeri TahakkukIsyeriBilgisi { get; set; } = new();

    /// <summary>SGK şube no → işyeri sicil no ve şube adı</summary>
    public Dictionary<string, TahakkukSube> TahakkukSubeler { get; set; } = new();

    /// <summary>
    /// Pusula yuvalarının etiketleri (kazanc1, ekKazanc3, sosyal7, ozel5 …).
    /// Mikro'da yuva adları firmaya göre tanımlanır; varsayılan adlar
    /// Biçen'in makbuzundakilerdir, buradan değiştirilebilir.
    /// </summary>
    public Dictionary<string, string> TahakkukEtiketler { get; set; } = new();

    /// <summary>
    /// Öneri grupları: birbirine aday önerilebilecek mağaza kümeleri.
    ///
    /// <para>
    /// Bölge tanımı yönetsel bir yapı; aday önerisi ise ULAŞIM mesafesine
    /// göre anlamlı. Sefaköy'e başvuran biri Tevfikbey'de çalışabilir ama
    /// aynı bölgedeki Silivri'ye gidemez. Bu yüzden öneri, bölgeden ayrı
    /// tanımlanır. Grup tanımlı değilse bölge tanımına düşülür.
    /// </para>
    /// </summary>
    public List<OneriGrubu> OneriGruplari { get; set; } = new();

    /// <summary>
    /// Tüm pozisyonların birleşimi. Kadro planı, filtreler ve raporlarda
    /// kullanılır; BirimTurleri doluysa okuma sırasında otomatik hesaplanır.
    /// </summary>
    public List<string> Bolumler { get; set; } = new();
    public List<string> EgitimSeviyeleri { get; set; } = new();
    public List<string> KanGruplari { get; set; } = new();
    public List<string> AskerlikDurumlari { get; set; } = new();
    public List<string> EhliyetSiniflari { get; set; } = new();
    public List<string> SrcBelgeleri { get; set; } = new();
    public List<string> BilgisayarProgramlari { get; set; } = new();
    public List<string> MedeniDurumlar { get; set; } = new();
    public List<string> Uyruklar { get; set; } = new();
    public bool SertifikaBolumuAcik { get; set; } = true;
    public bool ReferansBolumuAcik { get; set; } = true;

    /// <summary>Pozisyona göre zorunlu referans sayısı (21.10.2026)</summary>
    public ReferansKurali ReferansKurali { get; set; } = new();
    public bool IsTecrubesiBolumuAcik { get; set; } = true;
    public bool EpostaZorunlu { get; set; } = false;
    public int EnFazlaSertifika { get; set; } = 6;

    /// <summary>Adres seçiminde kullanılacak iller</summary>
    public List<string> Iller { get; set; } = new();

    /// <summary>Engellilik türleri</summary>
    public List<string> EngelTurleri { get; set; } = new();

    /// <summary>Boş bırakılırsa aday sayfasındaki varsayılan metin kullanılır</summary>
    public string AydinlatmaMetni { get; set; } = "";

    /// <summary>
    /// Genel merkez personelinin izin formunun ve adresi bulunamayan
    /// birimlerin formunun gideceği İK adresi (Yönetim → İzin formu
    /// e-postaları). Boşsa appsettings IzinFormu:IkEposta, o da yoksa
    /// ik@bicen.com.tr.
    /// </summary>
    public string IzinFormuIkEposta { get; set; } = "";

    /// <summary>Boş bırakılırsa aday sayfasındaki varsayılan metin kullanılır</summary>
    public string AcikRizaMetni { get; set; } = "";
}

public class MailTestGirdi
{
    public string Adres { get; set; }
}


/// <summary>
/// Zorunlu referans kuralı. Şubede giriş seviyesi pozisyonlarda (kasiyer,
/// reyoner, tandolya, temizlik) referans istenmez; diğer tüm pozisyonlarda
/// en az bir, şef ve üstünde en az iki referans gerekir. Muaf liste yalnızca
/// MuafBirimTurleri'nde geçerlidir: depo ve genel merkezde herkes zorunludur.
/// </summary>
public class ReferansKurali
{
    public bool Acik { get; set; } = true;

    /// <summary>
    /// Kural bu tarihten (dahil) sonra gelen başvurulara uygulanır. Kural
    /// yürürlüğe girmeden önceki başvurularda referans olmadığı için İK işe
    /// alım yapamıyordu (21.10.2026). Boşsa bütün başvurulara uygulanır.
    /// </summary>
    public DateTime? GecerlilikBaslangic { get; set; } = new DateTime(2026, 10, 22);

    public int VarsayilanAdet { get; set; } = 1;
    public int UstAdet { get; set; } = 2;
    public List<string> MuafBirimTurleri { get; set; } = new() { "Şube" };
    public List<string> MuafPozisyonlar { get; set; } = new()
        { "Kasiyer", "Reyoner", "Pastane - Tandolya Fırın", "Temizlik" };
    public List<string> UstPozisyonlar { get; set; } = new()
    {
        "Mağaza Müdürü", "Müdür Yardımcısı", "Mağaza Şefi", "Kasa Şefi",
        "Manav Şefi", "Kasap Şefi", "Reyon Şefi", "Şarküteri Şefi", "Depo Sorumlusu"
    };
    /// <summary>Pozisyon adında geçerse üst pozisyon sayılır</summary>
    public List<string> UstAnahtarKelimeler { get; set; } = new() { "şef", "müdür", "sorumlu", "yönetici" };

    private static readonly System.Globalization.CultureInfo Tr = new("tr-TR");
    private static string N(string s) => (s ?? "").Trim().ToLower(Tr);

    /// <summary>Tek pozisyon için gereken referans sayısı</summary>
    public int Gereken(string birimTuru, string pozisyon)
    {
        if (!Acik || string.IsNullOrWhiteSpace(pozisyon)) return 0;
        var p = N(pozisyon);

        if ((UstPozisyonlar ?? new()).Any(x => N(x) == p) ||
            (UstAnahtarKelimeler ?? new()).Any(k => !string.IsNullOrWhiteSpace(k) && p.Contains(N(k))))
            return Math.Max(0, UstAdet);

        var tur = N(string.IsNullOrWhiteSpace(birimTuru) ? "Şube" : birimTuru);
        if ((MuafBirimTurleri ?? new()).Any(x => N(x) == tur) &&
            (MuafPozisyonlar ?? new()).Any(x => N(x) == p))
            return 0;

        return Math.Max(0, VarsayilanAdet);
    }

    /// <summary>Birden çok pozisyon seçilmişse en yüksek gereksinim</summary>
    public int Gereken(string birimTuru, IEnumerable<string> pozisyonlar) =>
        (pozisyonlar ?? Enumerable.Empty<string>()).Select(x => Gereken(birimTuru, x)).DefaultIfEmpty(0).Max();

    /// <summary>Ad soyad ve en az 10 haneli telefonu olan referans geçerlidir</summary>
    public static bool GecerliMi(string adSoyad, string telefon) =>
        !string.IsNullOrWhiteSpace(adSoyad) && adSoyad.Trim().Length >= 3 &&
        (telefon ?? "").Count(char.IsDigit) >= 10;
}

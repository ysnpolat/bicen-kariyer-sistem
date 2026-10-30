namespace Bicen360.API;

/* ==========================================================================
 * Katalog
 * --------------------------------------------------------------------------
 * Sayfa ve modül tanımları tek yerde tutulur. Yetki ekranı, menü ve mobil
 * uygulama aynı listeyi okur; biri değişip diğeri unutulmasın.
 *
 * BicenKariyer.API içindeki MobilController.Moduller ile aynı desen.
 * ========================================================================== */

/// <summary>
/// Kodun yetkisi nereden veriliyor.
///
/// Yetki ekranı buna göre davranıyor: İK kodlarının satırı kilitli
/// gösteriliyor. Eskiden işaretlenebiliyor ama hiçbir etkisi olmuyordu ve
/// kapatan kişi sebebini başka ekranlarda arıyordu.
/// </summary>
public enum Kaynak
{
    /// <summary>Bu panelden veriliyor; mobilde ekran karşılığı var.</summary>
    Portal,

    /// <summary>Ekran değil yetki: bir modülün kapsamını genişletiyor.</summary>
    Yetki,

    /// <summary>
    /// Uçları Kariyer servisinde olan modül; yetkisi yine buradan
    /// veriliyor. Ayrım yalnızca hangi servisin ekranı sunduğuyla ilgili.
    /// </summary>
    Kariyer,
}

/// <summary>Panelde bir sayfa ya da mobilde bir modül.</summary>
public record Girdi(string Kod, string Ad, string Aciklama, string Simge,
                    Kaynak Kaynak = Kaynak.Portal, bool VarsayilanAcik = true);

public static class Katalog
{
    /// <summary>
    /// Panel sayfaları.
    ///
    /// Buraya bir satır eklemek yeterli: yetki ekranında kendiliğinden
    /// çıkar. Ekranı olmayan bir sayfa eklenmemeli; yetki verilse bile
    /// kullanıcı boş sayfa görür.
    /// </summary>
    public static readonly Girdi[] Sayfalar =
    {
        new("pano",       "Anasayfa",          "Bölümünüze göre özet ekran",           "ev"),
        new("kunye",      "Künye Analizi",     "Künye sorgulama ve raporlama",         "kare"),
        new("checklist",  "Kontrol Listeleri", "Liste tanımlama ve değerlendirme",     "belge"),
        new("ariza",      "Arıza Kayıtları",   "Açılan kayıtların takibi",             "uyari"),
        new("envanter",   "Envanter",          "Mağaza cihazları",                     "kutu"),

        /* Stok yönetimi: sipariş önerisi, takip, şubeler arası transfer,
           raf denetimi, depo durumu ve fire. Hepsi salt görüntüleme. */
        new("stok",       "Stok Yönetimi",     "Sipariş önerisi, transfer, fire",      "kutu"),
        new("rakipfiyat", "Rakip Fiyat",       "Rakip fiyat karşılaştırma raporu",     "etiket"),
        new("fiyatkontrol","Fiyat Kontrol",     "Barkodla fiyat ve stok sorgulama",     "kare"),
        new("rapor",      "Raporlar",          "Arıza, maliyet, rakip fiyat ve künye",  "grafik"),

        /* Ciro, kâr, fire, stok ve şube karşılaştırması (Mikro, PUSULA,
           PosBack). Maliyet ve kâr içerdiği için ayrı yetki. */
        new("rapormerkezi", "Rapor Merkezi",   "Ciro, satış, stok ve şube karşılaştırma", "grafik"),

        /* SKT takibi (23.10.2026): aylık kategori planı, mağazadan girilen
           son kullanma tarihleri, şube/kategori/ürün analizi. */
        new("skt",        "SKT Takip",         "Son kullanma tarihi planı ve analizi", "takvim"),
        /* Yetki yönetimi ayrı bir sayfa değil, Yönetim'in bir sekmesi:
           ikisi de yılda birkaç kez dokunulan tanım işleri ve menüde iki
           ayrı madde tutmak sık kullanılan sayfaları aşağı itiyordu. */
        new("yonetim",    "Yönetim",           "Departman, kategori ve yetkiler",      "ayar"),

        /* Sayfa değil kapsam yetkisi (08.10.2026): menüde çıkmaz. Verilen
           hesap arıza kayıtlarında, envanterde, maliyette ve raporlarda
           bütün departmanları görür. Verilmeyen panel kullanıcısı yalnızca
           sicilinin temsilci olduğu departmanları görür; Admin her zaman
           hepsini. Hesapları Yönetim › Yetkiler'den işaretleniyor. */
        new("tum-departmanlar", "Tüm departmanlar",
            "Arıza, envanter, maliyet ve raporlarda bütün departmanları görür", "ayar"),
    };

    /// <summary>
    /// Bu panelin yönettiği mobil modüller.
    ///
    /// Mobil uygulamanın tamamı değil, yalnızca Biçen360 ile gelenler.
    /// Vardiya, izin, prim gibi İK modülleri Kariyer panelinden yönetilmeye
    /// devam ediyor.
    /// </summary>
    /// <remarks>
    /// Künye ve checklist burada YOK: o modüllerin uçları hâlâ Kariyer
    /// API'sinde ve mobil menü iki listeyi birleştiriyor. İkisinde birden
    /// ilan edilince menüde aynı modül iki kez çıkıyordu. Uçları buraya
    /// taşındığında listeye eklenecekler.
    /// </remarks>
    public static readonly Girdi[] MobilModuller =
    {
        new("ariza",       "Arıza Bildirimi", "Arıza kaydı aç ve takip et",       "uyari"),
        new("rakipfiyat",  "Rakip Fiyat",     "Barkod okut, rakip fiyatını gir",  "etiket"),
        new("fiyatkontrol","Fiyat Kontrol",   "Barkodla fiyat ve stok sorgula",   "kare"),
        new("envanter",    "Envanter",        "Cihazları görüntüle, arıza aç",    "kutu"),

        /* SKT Kontrol (23.10.2026, mobil 1.9): yeni modül, tanımsızken kapalı */
        new("skt",         "SKT Kontrol",     "Ayın kategorisinde son kullanma tarihi kontrolü", "takvim", Kaynak.Portal, false),

        /* Tek satır: kimin neyi göreceği yetkiyle değil kişinin
           görevleriyle belirleniyor. Departman temsilcisi kendi
           departmanını, birden çok departmanın temsilcisi hepsini,
           yönetici rolü tamamını görüyor. İkinci bir "tümünü gör"
           yetkisi, aynı bilgiyi iki yerde tutmak demekti. */
        new("rapor",       "Raporlar",        "Arıza, maliyet ve fiyat özetleri", "grafik"),

        /* Modül başına "yönetici olarak gör".

           Sayfa değil yetki: verilen kişi o modülde kendi şubesi ya da
           departmanı yerine bütün kurumu görür. Tek bir genel anahtar
           yeterli değildi — bilgi teknolojileri sorumlusunun envanteri
           kurum genelinde görmesi gerekirken rakip fiyatı görmesi
           gerekmiyor. Menüde çıkmaz; yalnızca yetki ekranında sütun
           olarak görünür. */
        new("ariza-yonetici",        "Arıza · yönetici",
            "Bütün şubelerin arıza kayıtlarını görür",           "uyari",  Kaynak.Yetki),
        new("rakipfiyat-yonetici",   "Rakip Fiyat · yönetici",
            "Bütün şubelerin rakip fiyat kayıtlarını görür",     "etiket", Kaynak.Yetki),
        new("fiyatkontrol-yonetici", "Fiyat Kontrol · yönetici",
            "Bütün şubelerde fiyat ve stok sorgulayabilir",      "kare",   Kaynak.Yetki),
        new("envanter-yonetici",     "Envanter · yönetici",
            "Bütün şubelerin cihazlarını görür",                 "kutu",   Kaynak.Yetki),
        new("rapor-yonetici",        "Raporlar · yönetici",
            "Raporlarda bütün departmanların verilerini görür",  "grafik", Kaynak.Yetki),



        /* İK raporu: mobil rapor ekranındaki İK sekmesi.

           Ayrı bir sayfa değil, mevcut Raporlar ekranına sekme olarak
           ekleniyor. Yetki buradan veriliyor; panel kullanıcı adına
           bağlamak yanlıştı, çünkü panel adları sicille aynı değil. */
        /* Uçları Kariyer servisinde olan modüller.

           Yetkileri de buradan veriliyor: İK panelindeki ayrı ekran
           kaldırıldı. Aynı yetkiyi iki panelde tutmak, birini güncelleyip
           diğerini unutmaya açıktı ve hangisinin geçtiği belirsizdi.
           Kariyer servisi mobil modülleri sunarken B360_YETKI tablosunu
           okuyor. */
        new("vardiya",     "Vardiya",         "Karekodla giriş çıkış",         "takvim", Kaynak.Kariyer),
        new("izin",        "İzin Yönetimi",   "İzin bakiyesi ve talep",        "belge",  Kaynak.Kariyer),
        new("prim",        "Prim Hak Edişi",  "Dönemsel prim bilgisi",         "para",   Kaynak.Kariyer),
        new("performans",  "Performans",      "Değerlendirme ve sıralama",     "grafik", Kaynak.Kariyer),
        new("duyuru",      "Duyurular",       "Merkez paylaşımları",           "zil",    Kaynak.Kariyer),
        new("isemri",      "İşlerim",         "Atanan iş emirleri",            "liste",  Kaynak.Kariyer),
        new("checklist",   "Kontrol Listesi", "Günlük mağaza kontrolleri",     "onay",   Kaynak.Kariyer),
        new("kunye",       "Künye Analizi",   "Künye okutma ve karşılaştırma", "kare",   Kaynak.Kariyer),

        /* Haftalık izin onayı: mağaza yöneticisinin ekranı.

           Diğer modüllerden bir farkı var — tanımsız bırakıldığında açık
           değil, ünvan kuralına düşüyor (ünvanda "müdür" geçip "yardımcı"
           geçmiyorsa). Herkese açık saymak, her personelin şubesinin izin
           taleplerini onaylayabilmesi demekti. */
        new("puantaj",     "Puantaj Çizelgesi",
            "Ekibinin ve bölgesinin vardiya giriş-çıkışları",   "takvim", Kaynak.Kariyer),
        new("ekibim",      "Ekibim",
            "Ekip arkadaşları; yönetici izin ve puantaj ayrıntısını da görür", "kisi", Kaynak.Kariyer),

        new("vardiyaplani","Vardiya Planı",
            "Haftalık vardiya planı; yönetici kurar, personele bildirim düşer",  "takvim", Kaynak.Kariyer),

        new("mesaiozet",   "Bu Ay Mesai kutusu",
            "Ana sayfadaki mesai saati özeti (ekranı yok)",     "takvim", Kaynak.Kariyer),

        new("etik",        "Etik Hat",
            "Gizli ya da anonim bildirim",                     "uyari", Kaynak.Kariyer),

        new("izinonay",    "İzin Onayları",
            "Sorumlu olduğu personelin haftalık ve yıllık izin talepleri", "onay", Kaynak.Kariyer),

        new("ikrapor",     "İK Raporları",
            "Başvuru, personel hareketi ve vardiya özetleri",    "grafik", Kaynak.Kariyer),

        /* Avans (06.10.2026): mobil 1.6. Personel maaşını ve limitini
           görmez; kurallar İK paneli → Yönetim → Avans kuralları. */
        new("avans",       "Avanslarım",
            "Avans talebi, taksit ve kesinti planı",             "para",  Kaynak.Kariyer),

        /* Biçen'den Haberler (08.10.2026): mobil 1.7. Gönderiler İK
           paneli → Operasyon → Biçen'den Haberler ekranından. */
        new("haberler",    "Biçen'den Haberler",
            "Şirket içi haber akışı, Kasada bu hafta ve anketler", "kalp", Kaynak.Kariyer),

        /* Kazan-Kazan (20.10.2026): mobil 1.8. Tanımsızken herkese açık;
           buradan kişi / ünvan / grup için kapatılabilir. */
        new("kazankazan",  "Kazan-Kazan",
            "Yeni ürün öner, altın kazan",                       "kupa",  Kaynak.Kariyer),

        /* Ekip değerlendirmesi (20.10.2026): mobil 1.8. Tanımsızken yalnızca
           değerlendirme yapabilene (mağaza müdürü vb.) açık. */
        new("ekipdegerlendirme", "Ekip Değerlendirmesi",
            "Ekibini 3 ayda bir değerlendirir",                  "kisi",  Kaynak.Kariyer),

        /* Mesajlar ve devamsızlık (23.10.2026): mobil 1.9. Yeni modüller
           varsayılanda KAPALI: grubuna ya da kişiye açıkça verilene kadar
           kimsede görünmez. Kariyer servisinde PortalYetkiServisi.
           VarsayilanKapali ile aynı liste. */
        new("mesajlar",    "Mesajlar",
            "Panel ile ortak mesajlaşma; anlık bildirim ve yanıt",  "mesaj", Kaynak.Kariyer, false),
        new("devamsizlik", "Devamsızlık Girişi",
            "Vardiya girişi yapmayan ekip personeline devamsızlık girer", "uyari", Kaynak.Kariyer, false),

        /* Mobil uygulamadaki bütün modüller burada. Hangi servisin ucunu
           kullandığı Kaynak alanında; yetki hepsi için aynı yerden,
           aynı üç katmanla (kişi → ünvan → grup) veriliyor. */
    };

    public static bool SayfaVar(string kod) =>
        Sayfalar.Any(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

    public static bool ModulVar(string kod) =>
        MobilModuller.Any(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Mobil uygulamada ekranı olan modüller.
    ///
    /// Kapsam yetkileri ("· yönetici" ile bitenler) dışarıda: menüde satır
    /// olarak çıkınca dokunulduğunda açılacak bir ekran olmuyordu.
    /// </summary>
    public static IEnumerable<Girdi> Ekranlar =>
        MobilModuller.Where(x => x.Kaynak != Kaynak.Yetki);

    /// <summary>Alt menüde en fazla kaç sekme olabilir.</summary>
    public const int AltMenuEnFazla = 4;

    /// <summary>
    /// Alt menü seçilmemişse kullanılacak sekmeler.
    ///
    /// Ana sayfa ve Diğer zaten sabit; buradakiler aradaki sekmeler.
    /// </summary>
    public static readonly string[] AltMenuVarsayilan =
        { "vardiya", "duyuru", "performans" };
}

/* ==========================================================================
 * Yetki
 * ========================================================================== */

/// <summary>
/// Yetki kapsamları.
///
/// Panel yetkisi role ya da kullanıcıya, mobil yetkisi pozisyona ya da
/// kullanıcıya verilir. Her iki alanda da kullanıcı satırı diğerini ezer.
/// </summary>
public static class Kapsam
{
    public const string Kullanici = "kullanici";
    public const string Rol = "rol";
    public const string Pozisyon = "pozisyon";

    /// <summary>
    /// Pozisyon grubu (KRY_POZISYON_GRUBU).
    ///
    /// Ünvan ünvan yetki vermek, yeni bir ünvan tanımlandığında yetkinin
    /// unutulmasına yol açıyordu. Grup yetkisi, gruptaki bütün ünvanlara
    /// birden uygulanıyor.
    /// </summary>
    public const string Grup = "grup";
}

public static class Alan
{
    public const string Panel = "panel";
    public const string Mobil = "mobil";
}

/// <summary>
/// Kişiye özel mobil yetkiler. Değer boşsa gruptan geleni kullan demek.
/// </summary>
public class KisiYetkiGirdi
{
    public string Sicil { get; set; }
    public Dictionary<string, bool?> Yetkiler { get; set; } = new();
}

/// <summary>Kişinin sorumlu olduğu bölgeler.</summary>
public class KisiBolgeGirdi
{
    public string Sicil { get; set; }
    public List<string> Bolgeler { get; set; } = new();
}

/// <summary>Alt menüde görünecek modüller.</summary>
public class AltMenuGirdi
{
    public List<string> AltMenu { get; set; } = new();
}

public class YetkiSatiri
{
    public int Id { get; set; }
    public string Alan { get; set; }
    public string Kapsam { get; set; }
    public string Anahtar { get; set; }
    public string Kod { get; set; }
    public bool Izin { get; set; }
}

/// <summary>Yetki ekranından gelen kayıt isteği.</summary>
public class YetkiGirdi
{
    /// <summary>"panel" ya da "mobil"</summary>
    public string Alan { get; set; }

    /// <summary>"kullanici", "rol" ya da "pozisyon"</summary>
    public string Kapsam { get; set; }

    /// <summary>Kullanıcı adı, rol adı ya da pozisyon adı</summary>
    public string Anahtar { get; set; }

    /// <summary>
    /// Kod → izin eşlemesi.
    ///
    /// Listede olmayan kod için satır silinir: "tanımsız" ile "kapalı"
    /// farklı şeyler. Tanımsız olan bir alt katmana düşer, kapalı olan
    /// düşmez.
    /// </summary>
    public Dictionary<string, bool> Yetkiler { get; set; } = new();
}

/* ==========================================================================
 * Oturum
 * ========================================================================== */

/// <summary>
/// Jeton üretilirken kullanılan kullanıcı bilgisi.
///
/// Alan adları BicenKariyer.API'deki Kullanici sınıfıyla aynı; iki API
/// aynı jetonu okuduğu için hak (claim) adları da aynı kalmalı.
/// </summary>
public class Kullanici
{
    public int Id { get; set; }
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Rol { get; set; }
    public string Subeler { get; set; }
}

public class GirisGirdi
{
    public string KullaniciAdi { get; set; }
    public string Parola { get; set; }
}

public class GirisCikti
{
    /// <summary>
    /// Şube kullanıcısının şubesi; kilit yoksa null. Ekran üstte şube
    /// rozetini gösteriyor ve şube seçicilerini kilitliyor. Asıl kilit
    /// sunucuda, her okuma ucunda.
    /// </summary>
    public string Sube { get; set; }

    /// <summary>Portal rolünün adı (13.10.2026); atanmamışsa null</summary>
    public string PortalRol { get; set; }

    public int Id { get; set; }
    public string Jeton { get; set; }
    public string KullaniciAdi { get; set; }
    public string AdSoyad { get; set; }
    public string Rol { get; set; }
    public DateTime GecerlilikSonu { get; set; }

    /// <summary>
    /// Kullanıcının açabileceği panel sayfaları.
    ///
    /// Menü buna göre kurulur. Asıl koruma sunucudadır: menüden gizlemek
    /// tek başına güvenlik sağlamaz, her uç kendi yetkisini denetler.
    /// </summary>
    public List<string> Sayfalar { get; set; } = new();
}

/* ==========================================================================
 * Departman
 * ========================================================================== */

public class Departman
{
    public int Id { get; set; }
    public string Ad { get; set; }
    public string Aciklama { get; set; }
    public bool Aktif { get; set; } = true;
    public int Sira { get; set; }

    /// <summary>
    /// Bu departmanın temsilcileri (personel sicil numaraları).
    ///
    /// Temsilci bir rol değil: bir kişi birden fazla departmanın
    /// temsilcisi olabiliyor ve tek bir bayrak hangi departman olduğunu
    /// söyleyemiyor.
    /// </summary>
    public List<string> Temsilciler { get; set; } = new();
}

using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Dönemsel değerlendirme soru setleri (İK, 20.10.2026 belgesi; 23.10.2026'da yüklendi).
/// Mağaza ve depo ayrı setler: depo setleri "Depo · " önekli. Mağaza müdürü,
/// bölge müdürü, depo müdürü ve Genel setleri taslaktır; panelden düzenlenir.
///
/// <para>
/// Bir kez çalışır ("Depo · Ortak" seti hiç yoksa): eski setler pasife alınır
/// (eski raporlarda soru metniyle kalır), yenileri eklenir.
/// </para>
/// </summary>
public static class DonemselSoruTohumu
{
    private static volatile bool _yuklendi;
    private static readonly object _kilit = new();

    public static void Yukle(System.Data.IDbConnection db)
    {
        if (_yuklendi) return;
        lock (_kilit)
        {
            if (_yuklendi) return;
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_DD_SORU WHERE pozisyon = @p", new { p = "Depo · Ortak" }) == 0)
            {
                var acik = db.State == System.Data.ConnectionState.Open;
                if (!acik) db.Open();
                using var tx = db.BeginTransaction();
                var adlar = Setler.Select(x => x.Ad).ToArray();
                db.Execute("UPDATE KRY_DD_SORU SET aktif = 0 WHERE aktif = 1 AND pozisyon IN @adlar", new { adlar }, tx);
                foreach (var (ad, sorular) in Setler)
                {
                    var sira = 0;
                    foreach (var (metin, tur, zorunlu) in sorular)
                        db.Execute("INSERT INTO KRY_DD_SORU (pozisyon, sira, tur, metin, zorunlu) VALUES (@ad, @sira, @tur, @metin, @zorunlu)",
                            new { ad, sira = ++sira, tur, metin, zorunlu = true }, tx);
                }
                tx.Commit();
            }
            _yuklendi = true;
        }
    }

    public static readonly (string Ad, (string Metin, string Tur, bool Zorunlu)[] Sorular)[] Setler =
    {
        ("Ortak", new (string, string, bool)[]
        {
            ("İşe zamanında gelir, vardiya düzenine ve çalışma saatlerine uyar mı?", "olcek", true),
            ("İş disiplinine ve iş sağlığı ve güvenliği kurallarına uyar mı?", "olcek", true),
            ("Görev ve sorumluluklarını zamanında ve eksiksiz yerine getirir mi?", "olcek", true),
            ("Ekip arkadaşları ve yöneticileriyle saygılı, uyumlu ve çözüm odaklı çalışır mı?", "olcek", true),
            ("Müşterilere güler yüzlü, ilgili ve profesyonel davranır mı?", "olcek", true),
            ("Yeni işleri öğrenmeye ve geri bildirime açık mıdır?", "olcek", true),
            ("Güçlü yönleri neler?", "acik", false),
            ("Gelişmesi gereken konular neler?", "acik", false),
            ("Eğitim ihtiyacı var mı? Hangi konuda?", "acik", false),
        }),
        ("Müdür Yardımcısı", new (string, string, bool)[]
        {
            ("Günlük mağaza operasyonlarının şirket standartlarına uygun yürümesini sağlar mı?", "olcek", true),
            ("Vardiya planını ve görev dağılımını etkin şekilde yönetir mi?", "olcek", true),
            ("Satış, stok, fire ve kasa farkı göstergelerini düzenli takip eder mi?", "olcek", true),
            ("Mağaza müdürünün olmadığı zamanlarda karar alır ve sorunları çözer mi?", "olcek", true),
            ("Mağaza müdürüne doğru ve zamanında bilgi verir, alınan aksiyonları takip eder mi?", "olcek", true),
            ("Yeni personelin uyumuna ve ekibin gelişimine destek olur mu?", "olcek", true),
        }),
        ("Mağaza Şefi", new (string, string, bool)[]
        {
            ("Sorumlu olduğu bölümün satış, stok, fire ve ürün bulunurluğunu takip eder mi?", "olcek", true),
            ("Ekibin görev dağılımını doğru yapar ve işlerin zamanında bitmesini sağlar mı?", "olcek", true),
            ("Fiyat, kampanya, son tüketim tarihi ve reyon düzeni kontrollerini düzenli yapar mı?", "olcek", true),
            ("Çalışanların performansını takip eder, eksiklikleri zamanında yönlendirir mi?", "olcek", true),
            ("Müşteri şikâyetlerini ve operasyonel sorunları çözer, gerektiğinde üst yönetime aktarır mı?", "olcek", true),
        }),
        ("Kasa Şefi", new (string, string, bool)[]
        {
            ("Kasa açılış, kapanış ve gün sonu işlemlerini doğru ve zamanında yaptırır mı?", "olcek", true),
            ("Kasa farklarını takip eder, nedenlerini araştırır ve zamanında bildirir mi?", "olcek", true),
            ("Kasa ve mola planlamasını müşteri yoğunluğuna göre yapar mı?", "olcek", true),
            ("İade, iptal ve fiyat düzeltme işlemlerini kurallara uygun yönetir mi?", "olcek", true),
            ("Kasiyerleri yönlendirir, yeni kasiyerlerin eğitimine destek olur mu?", "olcek", true),
        }),
        ("Kasiyer", new (string, string, bool)[]
        {
            ("Ürünleri doğru okutur, fiyat ve miktar hatası yapmaz mı?", "olcek", true),
            ("Nakit, kart ve iade işlemlerini prosedüre uygun yapar mı?", "olcek", true),
            ("Kasa açılış, kapanış ve para sayımını doğru yapar mı?", "olcek", true),
            ("Yoğun saatlerde hızlı ve sakin hizmet verir mi?", "olcek", true),
            ("Hatalı işlemleri ve şüpheli durumları zamanında bildirir mi?", "olcek", true),
        }),
        ("Reyon Şefi", new (string, string, bool)[]
        {
            ("Sorumlu olduğu reyonların doluluk, düzen ve görsel standartlarını sağlar mı?", "olcek", true),
            ("Fiyat, kampanya etiketi ve son tüketim tarihi kontrollerini düzenli yaptırır mı?", "olcek", true),
            ("Sipariş ihtiyacını ve eksik ürünleri zamanında belirler mi?", "olcek", true),
            ("Reyon ekibinin görev dağılımını yapar ve işlerin bitmesini takip eder mi?", "olcek", true),
            ("Fireyi ve ürün kayıplarını azaltmak için önlem alır mı?", "olcek", true),
        }),
        ("Reyoner", new (string, string, bool)[]
        {
            ("Rafları zamanında doldurur ve ürün bulunurluğunu korur mu?", "olcek", true),
            ("Ürün yerleşimini mağaza yönetiminin belirlediği düzene uygun yapar mı?", "olcek", true),
            ("Son tüketim tarihlerini düzenli kontrol eder mi?", "olcek", true),
            ("Raf fiyatı ve kampanya etiketlerinin doğruluğunu kontrol eder mi?", "olcek", true),
            ("Depodan ürün çeker, eksik ürünleri doğru ve zamanında bildirir mi?", "olcek", true),
        }),
        ("Manav Şefi", new (string, string, bool)[]
        {
            ("Manav reyonunun tazelik, kalite ve görsel standartlarını sağlar mı?", "olcek", true),
            ("Günlük sipariş miktarını satış ve stoka göre doğru belirler mi?", "olcek", true),
            ("Gelen ürünlerin kalite ve miktar kontrolünü yapar mı?", "olcek", true),
            ("Fire kayıtlarını doğru tutar ve fireyi azaltacak önlemleri alır mı?", "olcek", true),
            ("Manav ekibinin görev dağılımını yapar ve yeni personeli yetiştirir mi?", "olcek", true),
        }),
        ("Manav", new (string, string, bool)[]
        {
            ("Meyve ve sebzelerin tazeliğini ve kalitesini düzenli kontrol eder mi?", "olcek", true),
            ("Ürünleri doğru ayıklar, yerleştirir ve görsel düzeni korur mu?", "olcek", true),
            ("Bozulan ve satışa uygun olmayan ürünleri zamanında ayırır mı?", "olcek", true),
            ("Fireyi azaltmaya ve ürün kayıplarını önlemeye özen gösterir mi?", "olcek", true),
            ("Tezgâhı dolu, temiz ve etiketleri doğru tutar mı?", "olcek", true),
        }),
        ("Kasap Şefi", new (string, string, bool)[]
        {
            ("Et reyonunun tazelik, muhafaza ve soğuk zincir standartlarını sağlar mı?", "olcek", true),
            ("Kesim planını ve sipariş miktarlarını satışa göre doğru belirler mi?", "olcek", true),
            ("Hijyen ve gıda güvenliği kurallarının reyonda uygulanmasını sağlar mı?", "olcek", true),
            ("Porsiyonlama ve tartım doğruluğunu denetler, fireyi takip eder mi?", "olcek", true),
            ("Kasap ekibini yönlendirir, bıçak ve ekipman güvenliği konusunda yetiştirir mi?", "olcek", true),
        }),
        ("Kasap", new (string, string, bool)[]
        {
            ("Et ürünlerinin tazelik ve muhafaza koşullarını uygun şekilde takip eder mi?", "olcek", true),
            ("Kesim, parçalama ve hazırlık işlemlerini doğru ve standartlara uygun yapar mı?", "olcek", true),
            ("Bıçak, makine ve diğer ekipmanları güvenli ve doğru kullanır mı?", "olcek", true),
            ("Hijyen, çapraz bulaşmayı önleme ve kişisel koruyucu ekipman kurallarına uyar mı?", "olcek", true),
            ("Fireyi azaltır, porsiyonlama ve tartım doğruluğunu korur mu?", "olcek", true),
        }),
        ("Şarküteri Şefi", new (string, string, bool)[]
        {
            ("Şarküteri reyonunun tazelik, son tüketim tarihi ve saklama koşullarını takip eder mi?", "olcek", true),
            ("Sipariş ve stok seviyesini satışa göre doğru yönetir mi?", "olcek", true),
            ("Hijyen, ekipman temizliği ve çapraz bulaşma kurallarının uygulanmasını sağlar mı?", "olcek", true),
            ("Teşhir, etiket ve tezgâh düzeninin standartlara uygun olmasını sağlar mı?", "olcek", true),
            ("Ekibin görev dağılımını yapar ve müşteri memnuniyetini takip eder mi?", "olcek", true),
        }),
        ("Şarküteri", new (string, string, bool)[]
        {
            ("Ürünlerin tazelik, son tüketim tarihi ve saklama koşullarını takip eder mi?", "olcek", true),
            ("Dilimleme, porsiyonlama, tartım ve paketleme işlemlerini doğru yapar mı?", "olcek", true),
            ("Gıda hijyeni, ekipman temizliği ve çapraz bulaşmayı önleme kurallarına uyar mı?", "olcek", true),
            ("Teşhiri, etiketleri ve tezgâh düzenini standartlara uygun tutar mı?", "olcek", true),
            ("Müşteri taleplerini doğru karşılar ve ürünler hakkında yeterli bilgi verir mi?", "olcek", true),
        }),
        ("Pastane - Tandolya Fırın", new (string, string, bool)[]
        {
            ("Ürünleri tarif ve standartlara uygun, istenen kalitede üretir mi?", "olcek", true),
            ("Üretimi satış saatlerine göre planlar, rafta taze ürün bulunmasını sağlar mı?", "olcek", true),
            ("Hijyen, gıda güvenliği ve kişisel temizlik kurallarına uyar mı?", "olcek", true),
            ("Fırını ve ekipmanları güvenli kullanır, temiz ve bakımlı tutar mı?", "olcek", true),
            ("Hammadde kullanımını ve üretim firesini takip eder mi?", "olcek", true),
        }),
        ("Aşçı", new (string, string, bool)[]
        {
            ("Yemekleri tarif, porsiyon ve sunum standartlarına uygun hazırlar mı?", "olcek", true),
            ("Hijyen, gıda güvenliği ve çapraz bulaşma kurallarına uyar mı?", "olcek", true),
            ("Malzemelerin tazeliğini, son tüketim tarihini ve saklama koşullarını kontrol eder mi?", "olcek", true),
            ("Üretimi talebe göre planlar, artan ürünü ve fireyi azaltır mı?", "olcek", true),
            ("Mutfak ekipmanlarını güvenli kullanır, mutfağı temiz ve düzenli tutar mı?", "olcek", true),
        }),
        ("Ürün Kabul Görevlisi", new (string, string, bool)[]
        {
            ("Gelen ürünleri sipariş, irsaliye ve teslimat belgeleriyle karşılaştırarak kontrol eder mi?", "olcek", true),
            ("Ürünlerin miktarını, ambalajını, kalitesini ve tarih bilgilerini doğru kontrol eder mi?", "olcek", true),
            ("Eksik, fazla, hasarlı veya uygunsuz ürünleri kayıt altına alıp bildirir mi?", "olcek", true),
            ("Soğuk zincir gerektiren ürünlerde sıcaklık ve teslim alma koşullarını kontrol eder mi?", "olcek", true),
            ("Ürün giriş kayıtlarını zamanında ve doğru yapar, ürünleri doğru alana yönlendirir mi?", "olcek", true),
        }),
        ("Temizlik Görevlisi", new (string, string, bool)[]
        {
            ("Sorumluluğundaki alanları temizlik planına uygun ve zamanında temizler mi?", "olcek", true),
            ("Zemin, tuvalet ve personel alanlarının hijyenini korur mu?", "olcek", true),
            ("Temizlik malzemelerini ve kimyasalları doğru ve güvenli kullanır mı?", "olcek", true),
            ("Dökülme, kırılma ve kayma riski olan durumlara hızlı müdahale eder mi?", "olcek", true),
            ("Temizlik ekipmanlarının bakımına ve malzeme stokuna özen gösterir mi?", "olcek", true),
        }),
        ("Depo · Ortak", new (string, string, bool)[]
        {
            ("İşe zamanında gelir, vardiya düzenine ve çalışma saatlerine uyar mı?", "olcek", true),
            ("İş disiplinine ve iş sağlığı ve güvenliği kurallarına uyar mı?", "olcek", true),
            ("Görev ve sorumluluklarını zamanında ve eksiksiz yerine getirir mi?", "olcek", true),
            ("Ekip arkadaşları ve yöneticileriyle saygılı, uyumlu ve çözüm odaklı çalışır mı?", "olcek", true),
            ("Talimatlara uyar, vardiya devrinde işleri eksiksiz teslim eder mi?", "olcek", true),
            ("Yeni işleri öğrenmeye ve geri bildirime açık mıdır?", "olcek", true),
            ("Güçlü yönleri neler?", "acik", false),
            ("Gelişmesi gereken konular neler?", "acik", false),
            ("Eğitim ihtiyacı var mı? Hangi konuda?", "acik", false),
        }),
        ("Depo · Depo Müdür Yardımcısı", new (string, string, bool)[]
        {
            ("Günlük depo operasyonlarının plana ve şirket standartlarına uygun yürümesini sağlar mı?", "olcek", true),
            ("Görev dağılımını, vardiya planını ve iş gücü kullanımını etkin yönetir mi?", "olcek", true),
            ("Stok doğruluğu, ürün kaybı, hasar ve verimlilik göstergelerini takip eder mi?", "olcek", true),
            ("İş güvenliği, depo düzeni ve ürün muhafaza standartlarına uyumu kontrol eder mi?", "olcek", true),
            ("Aksaklıkları çözer ve depo müdürüne zamanında raporlar mı?", "olcek", true),
            ("Yeni personelin uyumuna ve ekibin gelişimine destek olur mu?", "olcek", true),
        }),
        ("Depo · Depo Personeli", new (string, string, bool)[]
        {
            ("Gelen ürünleri doğru alanlara yerleştirir ve depo düzenini korur mu?", "olcek", true),
            ("Ürün toplama, taşıma ve istifleme işlemlerini doğru ve eksiksiz yapar mı?", "olcek", true),
            ("Ürünlerin hasar görmesini, kaybolmasını ve karışmasını önlemeye özen gösterir mi?", "olcek", true),
            ("Stok sayımlarına katılır, stok farklarını zamanında bildirir mi?", "olcek", true),
            ("Ürünlerin son tüketim tarihlerini kontrol eder mi?", "olcek", true),
        }),
        ("Depo · RT Operatörü", new (string, string, bool)[]
        {
            ("Reach truck aracını güvenli ve kullanım talimatlarına uygun kullanır mı?", "olcek", true),
            ("Ürünleri raflara doğru ve hasarsız yerleştirir ve indirir mi?", "olcek", true),
            ("Yaya güvenliğine, hız sınırlarına ve depo trafik kurallarına uyar mı?", "olcek", true),
            ("Araçtaki arıza, hasar ve güvenlik risklerini zamanında bildirir mi?", "olcek", true),
            ("İstifleme ve palet taşımada depo düzenini ve ürün güvenliğini korur mu?", "olcek", true),
        }),
        ("Depo · Ürün Kabul Görevlisi", new (string, string, bool)[]
        {
            ("Gelen ürünleri sipariş, irsaliye ve teslimat belgeleriyle karşılaştırarak kontrol eder mi?", "olcek", true),
            ("Ürünlerin miktarını, ambalajını, kalitesini ve tarih bilgilerini doğru kontrol eder mi?", "olcek", true),
            ("Eksik, fazla, hasarlı veya uygunsuz ürünleri kayıt altına alıp bildirir mi?", "olcek", true),
            ("Soğuk zincir gerektiren ürünlerde sıcaklık ve teslim alma koşullarını kontrol eder mi?", "olcek", true),
            ("Kabul kayıtlarını zamanında yapar, ürünleri doğru depolama alanına yönlendirir mi?", "olcek", true),
        }),
        ("Depo · Sevkiyat Şoförü", new (string, string, bool)[]
        {
            ("Sevkiyatları belirlenen güzergâh ve teslimat saatlerine uygun yapar mı?", "olcek", true),
            ("Aracın günlük kontrollerini yapar, bakım ve güvenlik gerekliliklerini takip eder mi?", "olcek", true),
            ("Yükleme, sabitleme ve taşıma sırasında ürünlerin zarar görmesini önler mi?", "olcek", true),
            ("İrsaliye ve teslim belgelerini eksiksiz takip eder mi?", "olcek", true),
            ("Trafik kurallarına uyar, gecikme ve hasarları zamanında bildirir mi?", "olcek", true),
        }),
        ("Depo · Temizlik Görevlisi", new (string, string, bool)[]
        {
            ("Depo alanlarını temizlik planına uygun ve zamanında temizler mi?", "olcek", true),
            ("Zemin, ortak alan, tuvalet ve personel alanlarının hijyenini korur mu?", "olcek", true),
            ("Temizlik malzemelerini ve kimyasalları doğru ve güvenli kullanır mı?", "olcek", true),
            ("Dökülme, kırılma ve kayma riski olan durumlara hızlı müdahale eder mi?", "olcek", true),
            ("Ürünlere ve ekipmanlara zarar vermeden temizlik yapar mı?", "olcek", true),
        }),
        ("Genel", new (string, string, bool)[]
        {
            ("İşini doğru, özenli ve şirket standartlarına uygun yapar mı?", "olcek", true),
            ("Yoğun zamanlarda verimini ve iş kalitesini korur mu?", "olcek", true),
            ("Verilen talimatları doğru anlar ve uygular mı?", "olcek", true),
            ("Çalışma alanını düzenli ve temiz tutar mı?", "olcek", true),
            ("Sorunları ve eksikleri zamanında yöneticisine bildirir mi?", "olcek", true),
        }),
        ("Mağaza Müdürü", new (string, string, bool)[]
        {
            ("Mağazanın satış, kârlılık ve bütçe hedeflerini takip eder ve ulaşmak için aksiyon alır mı?", "olcek", true),
            ("Stok, fire, kasa farkı ve sayım sonuçlarını düzenli takip eder mi?", "olcek", true),
            ("Mağaza operasyonlarının ve görsel düzenin şirket standartlarına uygun yürümesini sağlar mı?", "olcek", true),
            ("Personel planlamasını, vardiya ve izin yönetimini etkin yapar mı?", "olcek", true),
            ("Ekibini yönlendirir, geliştirir ve performansını takip eder mi?", "olcek", true),
            ("Bölge müdürüne doğru ve zamanında bilgi verir, talimatları zamanında uygular mı?", "olcek", true),
        }),
        ("Bölge Müdürü", new (string, string, bool)[]
        {
            ("Bölgesindeki mağazaların satış, kârlılık ve bütçe hedeflerini takip eder mi?", "olcek", true),
            ("Mağaza ziyaretlerini düzenli yapar, operasyon standartlarını denetler mi?", "olcek", true),
            ("Fire, stok, kasa farkı ve sayım sonuçlarını takip eder, aksiyon aldırır mı?", "olcek", true),
            ("Mağaza müdürlerini yönlendirir, geliştirir ve performanslarını takip eder mi?", "olcek", true),
            ("Bölgedeki personel ihtiyacını ve kadro planlamasını doğru yönetir mi?", "olcek", true),
            ("Üst yönetime doğru ve zamanında raporlama yapar, kararları sahada uygulatır mı?", "olcek", true),
        }),
        ("Depo · Depo Müdürü", new (string, string, bool)[]
        {
            ("Depo operasyonlarının plana, bütçeye ve şirket standartlarına uygun yürümesini sağlar mı?", "olcek", true),
            ("Mağaza sevkiyatlarının zamanında ve eksiksiz yapılmasını sağlar mı?", "olcek", true),
            ("Stok doğruluğu, sayım farkı, hasar ve fire göstergelerini takip eder mi?", "olcek", true),
            ("İş güvenliği, depo düzeni ve ürün muhafaza standartlarını uygulatır mı?", "olcek", true),
            ("Ekibini planlar, yönlendirir ve geliştirir mi?", "olcek", true),
            ("Üst yönetime doğru ve zamanında raporlama yapar, sorunları çözer mi?", "olcek", true),
        }),
    };
}

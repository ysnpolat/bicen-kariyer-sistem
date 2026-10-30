using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Çalışan aydınlatma metni (08.10.2026, KVKK md. 10).
///
/// <para>
/// Biçen360 1.7 açılışta <c>Benim</c>'i soruyor; kişinin onayı yoksa metin
/// tam ekran açılıyor ve "Okudum, onaylıyorum" denmeden uygulama
/// kullanılamıyor. Bir kez onaylayan bir daha görmüyor; işe yeni giren
/// kişinin kaydı olmadığı için ilk açılışında görüyor.
/// </para>
///
/// <para>
/// Metin İK panelinden değiştirilebiliyor. Her değişiklik yeni bir sürüm:
/// eski sürümü okuyanın kaydı o sürümün özetiyle duruyor. "Herkes yeniden
/// onaylasın" seçilirse daha önce onaylayanlar da yeni metni görüyor;
/// seçilmezse yeni metni yalnızca hiç onayı olmayanlar görüyor.
/// </para>
///
/// <para>
/// Bu bir açık rıza değil, aydınlatmanın yapıldığının kaydı. Açık rıza
/// gereken işlemler (varsa) ayrı metinle ve ayrı onayla alınmalı.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class AydinlatmaController : ControllerBase
{
    private const string Personel = "Personel";
    private const string PanelRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK;

    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;

    public AydinlatmaController(VeritabaniServisi vt, EkipServisi ekip)
    {
        _vt = vt;
        _ekip = ekip;
    }

    /* ==================================================================== */
    /* Varsayılan metin                                                     */
    /* ==================================================================== */

    /* Veri sorumlusu unvanı ve başvuru adresi aday aydınlatma metninden
       (bicen-kariyer/src/kvkkMetinleri.ts) alındı. Yayından önce İK ve
       hukuk tarafından gözden geçirilmeli; panelden değiştirilebilir. */
    private const string VarsayilanBaslik = "ÇALIŞANLAR İÇİN KİŞİSEL VERİLERİN İŞLENMESİNE İLİŞKİN AYDINLATMA METNİ";

    private const string VarsayilanOnay =
        "6698 sayılı Kanun'un 10. maddesi kapsamında hazırlanan bu aydınlatma metnini dijital ortamda okudum ve bilgilendirildim.";

    private const string VarsayilanMetin = """
Biçen Mağazacılık San. ve Tic. A.Ş. ("Biçen") olarak, çalışanlarımızın kişisel verilerini 6698 sayılı Kişisel Verilerin Korunması Kanunu ("Kanun") ve ilgili mevzuata uygun şekilde, veri sorumlusu sıfatıyla işliyoruz. Bu metin; hangi verilerinizi, hangi amaçla, hangi hukuki sebeple işlediğimizi, kimlere aktardığımızı ve haklarınızı açıklamak için hazırlanmıştır.

1. İşlenen Kişisel Verileriniz
• Kimlik: ad, soyad, T.C. kimlik numarası, doğum tarihi ve yeri, medeni durum, cinsiyet.
• İletişim: telefon numarası, adres, e-posta adresi.
• Özlük: sicil numarası, çalıştığınız şube ve birim, görev ve unvan, işe giriş ve çıkış tarihleri, kıdem, eğitim ve sertifikalar, performans ve oryantasyon değerlendirmeleri, işe giriş evrakları.
• Çalışma süresi ve puantaj: vardiya planı, karekod ile giriş-çıkış kayıtları, yıllık izin, mazeret izni, fazla çalışma ve rotasyon talepleri.
• Finans: ücret ve bordro bilgileri, banka hesap bilgisi, avans talepleri ve kesinti planı, Biçen Kart bakiyesi ve harcamaları.
• Konum: yalnızca vardiya karekodunu okuttuğunuz anda, okutmanın iş yerinde yapıldığını doğrulamak için alınan konum bilgisi. Uygulama sizi sürekli izlemez.
• Görsel kayıt: personel fotoğrafınız; Biçen'den Haberler'de paylaşılan fotoğraflar.
• İşlem güvenliği: uygulamaya giriş kayıtları, cihaz bilgisi, uygulama sürümü, IP adresi, bildirim kimliği.
• Talep ve şikâyet: Etik Hat bildirimleri (gizli ya da anonim gönderilebilir), Biçen'den Haberler'deki yorum ve beğeniler.
• Özel nitelikli kişisel veriler: sağlık raporları ve rapor günleri, engellilik durumu; mevzuatın gerektirdiği hallerde adli sicil kaydı.

2. Kişisel Verilerinizin İşlenme Amaçları
• İş sözleşmenizin kurulması ve yürütülmesi; özlük dosyanızın tutulması.
• Çalışma sürelerinizin, vardiya ve puantajınızın takibi; ücret, fazla çalışma ve avans süreçlerinin yürütülmesi.
• Yıllık izin, mazeret izni ve rapor süreçlerinin yürütülmesi.
• İş Kanunu, sosyal güvenlik, vergi ve iş sağlığı ve güvenliği mevzuatından doğan yükümlülüklerin yerine getirilmesi.
• Eğitim, oryantasyon ve performans değerlendirme süreçlerinin yürütülmesi.
• Şirket içi iletişim: duyurular, bildirimler ve Biçen'den Haberler.
• Biçen Kart çalışan avantajlarının sağlanması.
• Etik Hat bildirimlerinin değerlendirilmesi; iş yeri güvenliğinin ve bilgi güvenliğinin sağlanması; denetim faaliyetleri.
• Yetkili kurum ve kuruluşlardan gelen taleplerin karşılanması.

3. Hukuki Sebepler
Kişisel verileriniz Kanun'un 5. maddesindeki; kanunlarda açıkça öngörülmesi, iş sözleşmesinin kurulması veya ifasıyla doğrudan ilgili olması, veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi, bir hakkın tesisi, kullanılması veya korunması ve temel hak ve özgürlüklerinize zarar vermemek kaydıyla Biçen'in meşru menfaati hukuki sebeplerine dayanılarak işlenir. Sağlık verileri ve diğer özel nitelikli verileriniz Kanun'un 6. maddesi uyarınca; kanunlarda öngörülmesi ile istihdam, iş sağlığı ve güvenliği ve sosyal güvenlik alanlarındaki hukuki yükümlülüklerin yerine getirilmesi için zorunlu olduğu ölçüde işlenir ve yalnızca yetkili kişilerce görülebilir.

4. Kişisel Verilerin Aktarılması
Kişisel verileriniz, yukarıdaki amaçlarla ve gerektiği ölçüde; Sosyal Güvenlik Kurumu, Gelir İdaresi, Türkiye İş Kurumu, mahkemeler ve diğer yetkili kamu kurum ve kuruluşlarına, ücret ödemeleri için bankalara, iş sağlığı ve güvenliği hizmeti alınan kuruluşlara ve hizmet aldığımız yazılım ve teknik destek sağlayıcılarına aktarılabilir. Biçen360 uygulamasına gönderilen bildirimler, mobil işletim sistemlerinin bildirim altyapıları (Expo, Google, Apple) üzerinden iletilir; bu kapsamda cihazınızın bildirim kimliği ve bildirim metni yurt dışındaki sunuculardan geçebilir ve bu aktarım Kanun'un 9. maddesine uygun şekilde yapılır.

5. Toplama Yöntemi
Kişisel verileriniz; işe giriş belgeleri, Biçen360 mobil uygulaması, İK paneli, insan kaynakları ve bordro yazılımı, karekod okutma, e-posta ve fiziki evrak yoluyla, otomatik ve otomatik olmayan yöntemlerle toplanır.

6. Saklama Süresi
Kişisel verileriniz ilgili mevzuatın öngördüğü süreler boyunca, bu süreler yoksa işleme amacının gerektirdiği süre boyunca saklanır; süre sonunda silinir, yok edilir veya anonim hale getirilir.

7. Haklarınız
Kanun'un 11. maddesi uyarınca; kişisel verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini isteme, Kanun'a uygun işlenmiş olmasına rağmen işlenmesini gerektiren sebeplerin ortadan kalkması halinde silinmesini veya yok edilmesini isteme, bu işlemlerin aktarıldığı üçüncü kişilere bildirilmesini isteme, münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme ve Kanun'a aykırı işleme sebebiyle zarara uğramanız halinde zararın giderilmesini talep etme haklarına sahipsiniz.

Bu haklarınızı kullanmak için talebinizi yazılı olarak İnsan Kaynakları birimine iletebilir ya da "Kartaltepe Mah. Belediye Cad. Saraçoğlu İş Merkezi K:1 No:1 Küçükçekmece / İstanbul" adresine elden veya noter kanalıyla gönderebilirsiniz. Talebiniz en geç otuz gün içinde ücretsiz olarak sonuçlandırılır.
""";

    /* ==================================================================== */
    /* Ortak                                                                */
    /* ==================================================================== */

    private sealed class Metin
    {
        public int Surum { get; set; }
        public string Baslik { get; set; }
        public string MetinGovde { get; set; }
        public string OnayMetni { get; set; }
        public string Ozet { get; set; }
        public bool YenidenOnay { get; set; }
        public string Yayinlayan { get; set; }
        public DateTime Yayin { get; set; }
    }

    private const string Secim = @"
SELECT surum, baslik, metin AS MetinGovde, onay_metni AS OnayMetni, ozet, yeniden_onay AS YenidenOnay, yayinlayan, yayin
FROM KRY_AYDINLATMA";

    private static string OzetAl(string baslik, string metin, string onay)
    {
        var b = SHA256.HashData(Encoding.UTF8.GetBytes($"{baslik}\n{metin}\n{onay}"));
        return Convert.ToHexString(b).ToLowerInvariant();
    }

    /// <summary>Yayındaki sürüm; hiç yoksa varsayılan metin 1. sürüm olarak yazılır.</summary>
    private Metin Aktif(System.Data.IDbConnection db)
    {
        var m = db.QueryFirstOrDefault<Metin>(Secim + " WHERE aktif = 1 ORDER BY surum DESC");
        if (m is not null) return m;

        var metin = VarsayilanMetin.Trim();
        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_AYDINLATMA)
    INSERT INTO KRY_AYDINLATMA (surum, baslik, metin, onay_metni, ozet, yeniden_onay, aktif, yayinlayan)
    VALUES (1, @baslik, @metin, @onay, @ozet, 0, 1, N'Varsayılan metin')",
            new { baslik = VarsayilanBaslik, metin, onay = VarsayilanOnay, ozet = OzetAl(VarsayilanBaslik, metin, VarsayilanOnay) });

        return db.QueryFirst<Metin>(Secim + " ORDER BY aktif DESC, surum DESC");
    }

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return (i < 0 ? govde : govde[..i]).Trim();
    }

    private string Cihaz()
    {
        var ad = User?.Identity?.Name ?? "";
        var i = ad.IndexOf('|');
        return i < 0 ? null : Kisalt(ad[(i + 1)..], 200);
    }

    private string Ip()
    {
        var ileri = Request.Headers["X-Forwarded-For"].ToString();
        var ip = !string.IsNullOrWhiteSpace(ileri) ? ileri.Split(',')[0].Trim() : HttpContext.Connection.RemoteIpAddress?.ToString();
        return Kisalt(ip, 64);
    }

    private static string Kisalt(string s, int n) =>
        string.IsNullOrWhiteSpace(s) ? null : (s = s.Trim()).Length > n ? s[..n] : s;

    private string PanelAdi =>
        User?.FindFirst("adSoyad")?.Value is { Length: > 0 } a ? a : User?.Identity?.Name ?? "İK";

    /// <summary>Kişi bu metin için onaylı mı (yeniden onay istenmediyse eski sürüm de yeter)</summary>
    private static bool Onayli(Metin aktif, IEnumerable<int> surumler) =>
        surumler.Contains(aktif.Surum) || (!aktif.YenidenOnay && surumler.Any());

    /* ==================================================================== */
    /* Biçen360                                                             */
    /* ==================================================================== */

    /// <summary>Açılışta: metin ve kişinin onay bekleyip beklemediği</summary>
    [HttpGet("Benim")]
    [Authorize(Roles = Personel)]
    public IActionResult Benim()
    {
        var sicil = Sicil();
        if (sicil.Length == 0) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        var m = Aktif(db);
        var surumler = db.Query<int>("SELECT surum FROM KRY_AYDINLATMA_ONAY WHERE sicil = @sicil", new { sicil }).ToList();

        var bekliyor = !Onayli(m, surumler);

        return Ok(new
        {
            bekliyor,
            surum = m.Surum,
            ozet = m.Ozet,
            baslik = m.Baslik,
            metin = bekliyor ? m.MetinGovde : null,
            onayMetni = m.OnayMetni,
            dugme = "Okudum, onaylıyorum",
        });
    }

    /// <summary>Metni her zaman okuyabilsin (ayarlar / bilgilerim)</summary>
    [HttpGet("Metin")]
    [Authorize(Roles = Personel)]
    public IActionResult MetinGetir()
    {
        var sicil = Sicil();
        using var db = _vt.Baglanti();
        var m = Aktif(db);
        var tarih = db.ExecuteScalar<DateTime?>("SELECT MAX(tarih) FROM KRY_AYDINLATMA_ONAY WHERE sicil = @sicil", new { sicil });
        return Ok(new { surum = m.Surum, baslik = m.Baslik, metin = m.MetinGovde, onayMetni = m.OnayMetni, onayTarihi = tarih });
    }

    public sealed class OnayGirdi
    {
        public int Surum { get; set; }
        public string Ozet { get; set; }
    }

    [HttpPost("Onayla")]
    [Authorize(Roles = Personel)]
    public IActionResult Onayla([FromBody] OnayGirdi g)
    {
        var sicil = Sicil();
        if (sicil.Length == 0) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();
        var m = Aktif(db);

        /* Kişi okurken metin değiştiyse yeni metni görsün: okumadığı metne onay yazılmaz */
        if (g is null || g.Surum != m.Surum || (!string.IsNullOrEmpty(g.Ozet) && !string.Equals(g.Ozet, m.Ozet, StringComparison.OrdinalIgnoreCase)))
            return StatusCode(409, new { hata = "Metin güncellendi; lütfen yeni metni okuyunuz.", kod = "guncellendi" });

        var p = _ekip.Kisi(sicil);
        var uygulama = Kisalt(Request.Headers["X-Uygulama-Surum"].ToString(), 20);

        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_AYDINLATMA_ONAY WHERE sicil = @sicil AND surum = @surum)
    INSERT INTO KRY_AYDINLATMA_ONAY (sicil, surum, ad, sube, ozet, cihaz, uygulama, ip)
    VALUES (@sicil, @surum, @ad, @sube, @ozet, @cihaz, @uygulama, @ip)",
            new
            {
                sicil,
                surum = m.Surum,
                ad = p is null ? null : Kisalt($"{p.Ad} {p.Soyad}", 150),
                sube = Kisalt(p?.IsGrubu, 150),
                ozet = m.Ozet,
                cihaz = Cihaz(),
                uygulama,
                ip = Ip(),
            });

        return Ok(new { basarili = true, tarih = DateTime.Now });
    }

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    /// <summary>Yayındaki metin, sürümler ve aktif personelin onay durumu</summary>
    [HttpGet("Panel")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Panel()
    {
        using var db = _vt.Baglanti();
        var m = Aktif(db);

        var onaylar = db.Query<(string Sicil, int Surum, DateTime Tarih, string Cihaz, string Uygulama, string Ip)>(
                "SELECT sicil, surum, tarih, cihaz, uygulama, ip FROM KRY_AYDINLATMA_ONAY")
            .GroupBy(x => OkutmaBeklenmez.K(x.Sicil), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Surum).ThenByDescending(x => x.Tarih).ToList(), StringComparer.OrdinalIgnoreCase);

        /* Uygulamayı hiç açmamış ya da 1.7'den eski kullanan metni göremez:
           panelde ayrı gösteriliyor ki İK neden beklediğini bilsin. */
        var surumler = db.Query<(string Kod, string Surum, DateTime Son)>(
                "SELECT personel_kodu, surum, son_gorulme FROM KRY_UYGULAMA_SURUM")
            .GroupBy(x => OkutmaBeklenmez.K(x.Kod), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Son).First(), StringComparer.OrdinalIgnoreCase);

        var kisiler = _ekip.Aktifler()
            .Select(p =>
            {
                var k = OkutmaBeklenmez.K(p.PersonelKodu);
                onaylar.TryGetValue(k, out var l);
                l ??= new();
                var onayli = Onayli(m, l.Select(x => x.Surum));
                var son = l.FirstOrDefault();
                surumler.TryGetValue(k, out var u);

                return new
                {
                    sicil = p.PersonelKodu.Trim(),
                    ad = $"{p.Ad} {p.Soyad}".Trim(),
                    sube = p.IsGrubu,
                    gorev = p.Pozisyon,
                    iseGiris = p.GirisTarihi,
                    onayli,
                    tarih = son.Sicil is null ? (DateTime?)null : son.Tarih,
                    surum = son.Sicil is null ? (int?)null : son.Surum,
                    cihaz = son.Cihaz,
                    ip = son.Ip,
                    uygulama = u.Kod is null ? null : u.Surum,
                    sonGorulme = u.Kod is null ? (DateTime?)null : u.Son,
                };
            })
            .OrderBy(x => x.onayli)
            .ThenBy(x => x.sube)
            .ThenBy(x => x.ad)
            .ToList();

        var tum = db.Query(@"
SELECT a.surum, a.baslik, a.yeniden_onay AS yenidenOnay, a.aktif, a.yayinlayan, a.yayin, a.ozet,
       (SELECT COUNT(*) FROM KRY_AYDINLATMA_ONAY o WHERE o.surum = a.surum) AS onay
FROM KRY_AYDINLATMA a ORDER BY a.surum DESC").ToList();

        return Ok(new
        {
            aktif = new
            {
                surum = m.Surum,
                baslik = m.Baslik,
                metin = m.MetinGovde,
                onayMetni = m.OnayMetni,
                yenidenOnay = m.YenidenOnay,
                yayinlayan = m.Yayinlayan,
                yayin = m.Yayin,
                ozet = m.Ozet,
            },
            surumler = tum,
            kisiler,
        });
    }

    /// <summary>Eski bir sürümün tam metni (kim neyi okudu sorusu için)</summary>
    [HttpGet("Panel/Surum/{surum:int}")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult PanelSurum(int surum)
    {
        using var db = _vt.Baglanti();
        var m = db.QueryFirstOrDefault<Metin>(Secim + " WHERE surum = @surum", new { surum });
        return m is null
            ? NotFound(new { hata = "Sürüm bulunamadı." })
            : Ok(new { m.Surum, m.Baslik, metin = m.MetinGovde, m.OnayMetni, m.Ozet, m.YenidenOnay, m.Yayinlayan, m.Yayin });
    }

    public sealed class YayinGirdi
    {
        public string Baslik { get; set; }
        public string Metin { get; set; }
        public string OnayMetni { get; set; }
        public bool YenidenOnay { get; set; }
    }

    /// <summary>Yeni sürüm yayınlar (eski sürümler ve onayları silinmez).</summary>
    [HttpPost("Panel/Yayinla")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Yayinla([FromBody] YayinGirdi g)
    {
        var baslik = (g?.Baslik ?? "").Trim();
        var metin = (g?.Metin ?? "").Trim();
        var onay = (g?.OnayMetni ?? "").Trim();

        if (baslik.Length is < 3 or > 200) return BadRequest(new { hata = "Başlık 3–200 karakter olmalı." });
        if (metin.Length < 100) return BadRequest(new { hata = "Metin çok kısa." });
        if (metin.Length > 60000) return BadRequest(new { hata = "Metin çok uzun." });
        if (onay.Length is < 10 or > 400) return BadRequest(new { hata = "Onay cümlesi 10–400 karakter olmalı." });

        using var db = _vt.Baglanti();
        var m = Aktif(db);
        var ozet = OzetAl(baslik, metin, onay);

        if (ozet == m.Ozet && g.YenidenOnay == m.YenidenOnay)
            return BadRequest(new { hata = "Metinde değişiklik yok." });

        var surum = db.ExecuteScalar<int>("SELECT ISNULL(MAX(surum), 0) + 1 FROM KRY_AYDINLATMA");

        db.Execute(@"
UPDATE KRY_AYDINLATMA SET aktif = 0;
INSERT INTO KRY_AYDINLATMA (surum, baslik, metin, onay_metni, ozet, yeniden_onay, aktif, yayinlayan)
VALUES (@surum, @baslik, @metin, @onay, @ozet, @yeniden, 1, @yayinlayan)",
            new { surum, baslik, metin, onay, ozet, yeniden = g.YenidenOnay, yayinlayan = PanelAdi });

        return Ok(new { basarili = true, surum });
    }
}

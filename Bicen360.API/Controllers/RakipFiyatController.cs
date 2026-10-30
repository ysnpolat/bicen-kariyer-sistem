using System.Security.Claims;
using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Rakip fiyat karşılaştırma.
///
/// <para>
/// Personel rakip mağazada barkodu okutur, gördüğü rafiyatı girer. Sistem
/// barkodu kendi stok kodumuza çevirip satış fiyatımızı bulur ve farkı
/// kaydeder. Künye modülünün barkod karşılığı; oradaki desen aynen
/// izleniyor.
/// </para>
///
/// <para>
/// Fiyat, kayıt anında hesaplanıp <b>kaydın içine</b> yazılıyor. Sonradan
/// hesaplamak, fiyatımız değiştiğinde geçmiş karşılaştırmaların da
/// değişmesi demekti; rapor "o gün ne durumdaydık" sorusunu cevaplayamaz
/// hâle gelirdi.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RakipFiyatController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly YetkiServisi _yetki;
    private readonly PersonelServisi _personel;
    private readonly IConfiguration _yapilandirma;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly ILogger<RakipFiyatController> _kayit;

    public RakipFiyatController(
        VeritabaniServisi vt,
        YetkiServisi yetki,
        PersonelServisi personel,
        IConfiguration yapilandirma,
        PanelKullaniciServisi panelKullanici,
        ILogger<RakipFiyatController> kayit)
    {
        _panelKullanici = panelKullanici;
        _vt = vt;
        _yetki = yetki;
        _personel = personel;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Kimlik                                                               */
    /* ==================================================================== */

    private string Kullanici => User.Identity?.Name ?? "";
    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    private bool Mobil =>
        Kullanici.StartsWith("personel:", StringComparison.OrdinalIgnoreCase);

    private string Sicil
    {
        get
        {
            if (!Mobil) return null;

            var govde = Kullanici["personel:".Length..];
            var i = govde.IndexOf('|');

            return i < 0 ? govde : govde[..i];
        }
    }

    private PersonelServisi.Bilgi Kisi() => Mobil ? _personel.Getir(Sicil) : null;

    /// <summary>Okutan personelin şubesinin depo numarası; bulunamazsa null (genel fiyat).</summary>
    private int? KisiDeposu(PersonelServisi.Bilgi kisi = null)
    {
        try
        {
            kisi ??= Kisi();
            if (string.IsNullOrWhiteSpace(kisi?.Sube)) return null;

            using var db = _vt.Baglanti();
            return SatisFiyati.DepoBulucu(db)(kisi.Sube);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rakip fiyat: personel deposu bulunamadı");
            return null;
        }
    }

    private bool Yetkili() =>
        Mobil
            ? _yetki.Modulleri(Sicil, Kisi()?.Pozisyon ?? "").Contains("rakipfiyat")
            : _yetki.SayfaAcik(Kullanici, Rol, "rakipfiyat");

    /* ==================================================================== */
    /* Okutma                                                              */
    /* ==================================================================== */

    /// <summary>Okutma ekranının ihtiyaç duyduğu firma listesi.</summary>
    [HttpGet("Form")]
    public IActionResult Form()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        /* Son kullanım ve bugünkü okutma sayısı bu kişiye göre (11.10.2026):
           uygulamada "son kullandıklarınız" ve rakip satırındaki bilgi.
           Eski uygulama yalnızca id ve ad'ı okuyor. */
        var firmalar = db.Query(@"
SELECT F.id, F.ad, S.son, ISNULL(S.bugun, 0) AS bugun,
       F.logo_surum AS logoSurum,
       CASE WHEN F.logo_dosya IS NOT NULL OR F.logo_adres IS NOT NULL THEN 1 ELSE 0 END AS logoVar
FROM B360_RAKIP_FIRMA F
    LEFT JOIN (
        SELECT firma_id, MAX(olusturma) AS son,
               SUM(CASE WHEN olusturma >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS bugun
        FROM B360_RAKIP_FIYAT
        WHERE personel_kodu = @kod
        GROUP BY firma_id
    ) S ON S.firma_id = F.id
WHERE F.aktif = 1
ORDER BY F.sira, F.ad", new { kod = Sicil ?? Kullanici })
            .Select(x => new
            {
                id = (int)x.id,
                ad = (string)x.ad,
                son = (DateTime?)x.son,
                bugun = (int)x.bugun,
                /* Logo (12.10.2026, uygulama 1.7): portaldan eklenen */
                logo = RakipLogo.Adres((int)x.id, (int)x.logoSurum, (int)x.logoVar == 1),
            })
            .ToList();

        return Ok(new { firmalar, sube = Kisi()?.Sube });
    }

    /// <summary>
    /// Barkodu ürüne ve kendi satış fiyatımıza çevirir.
    ///
    /// Kaydetmez; personel ekranda görüp fiyatı girdikten sonra kaydeder.
    /// </summary>
    [HttpGet("Sorgula")]
    public IActionResult Sorgula([FromQuery] string barkod)
    {
        if (!Yetkili()) return Forbid();

        var kod = (barkod ?? "").Trim();

        if (kod.Length == 0)
            return BadRequest(new { hata = "Barkod boş." });

        /* 13.10.2026: karekod okunduysa içinden çıkan barkodla sorgulanır */
        Urun urun;
        (urun, kod) = KarekodlaBul(kod, KisiDeposu());

        if (urun is null)
            return Ok(new
            {
                barkod = kod,
                bulundu = false,

                /* Bulunamayan barkod hata değil: rakipte olup bizde
                   olmayan bir ürün olabilir. Personel yine de fiyatı
                   kaydedebilsin. */
                bilgi = "Bu barkod stok kartlarımızda bulunamadı. Fiyatı yine de kaydedebilirsiniz."
            });

        return Ok(new
        {
            barkod = kod,
            bulundu = true,
            urun.StokKodu,
            urun.UrunAdi,
            urun.BizimFiyat,
            urun.RafFiyat,
            urun.BicardFiyat,
            urun.FiyatTuru,
            fiyatTuruAdi = SatisFiyati.TurAdi(urun.FiyatTuru),
            /* Ürün görseli (12.10.2026): Fiyat Kontrol'deki kapak görseli */
            gorselId = GorselBul(urun.StokKodu),
        });
    }

    /// <summary>Stok kartının kapak görseli (Fiyat Kontrol › görseller); yoksa null</summary>
    private int? GorselBul(string stokKodu)
    {
        if (string.IsNullOrWhiteSpace(stokKodu)) return null;

        try
        {
            using var db = _vt.Baglanti();
            return db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM B360_URUN_GORSEL WHERE stok_kodu = @stok ORDER BY kapak DESC, id",
                new { stok = stokKodu.Trim() });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rakip fiyat: ürün görseli okunamadı");
            return null;
        }
    }

    /// <summary>
    /// Rakip logosu (12.10.2026). Kimlik istemiyor: görsel etiketleri başlık
    /// gönderemiyor, logolar gizli değil. Görsel indirilememişse portalda
    /// girilen bağlantıya yönlendiriyor.
    /// </summary>
    [HttpGet("Logo/{id:int}")]
    [AllowAnonymous]
    public IActionResult Logo(int id)
    {
        using var db = _vt.Baglanti();

        var r = db.QueryFirstOrDefault(
            "SELECT logo_dosya, logo_adres FROM B360_RAKIP_FIRMA WHERE id = @id", new { id });

        if (r is null) return NotFound();

        var dosya = (string)r.logo_dosya;
        if (RakipLogo.GuvenliAd(dosya))
        {
            var yol = Path.Combine(RakipLogo.Klasor(_yapilandirma), dosya);
            if (System.IO.File.Exists(yol))
            {
                /* Adres ?v=sürüm taşıyor: logo değişince adres de değişiyor */
                Response.Headers["Cache-Control"] = "public, max-age=604800";
                return PhysicalFile(yol, RakipLogo.IcerikTuru(Path.GetExtension(dosya).ToLowerInvariant()));
            }
        }

        var adres = (string)r.logo_adres;
        return RakipLogo.AdresGecerli(adres, out var uri) ? Redirect(uri.ToString()) : NotFound();
    }

    /// <summary>
    /// BizimFiyat geçerli satış fiyatı: BiCard 0'dan büyükse BiCard, değilse
    /// raf (09.10.2026). Raporlar raf fiyatıyla da karşılaştırıyor.
    /// </summary>
    private sealed record Urun(string StokKodu, string UrunAdi, decimal? BizimFiyat,
                               decimal? RafFiyat = null, decimal? BicardFiyat = null)
    {
        public string FiyatTuru => SatisFiyati.Tur(RafFiyat, BicardFiyat);
    }

    /// <summary>
    /// Barkoddan stok kartı ve satış fiyatı.
    ///
    /// <para>
    /// Barkod eşleşmesi <c>BARKOD_TANIMLARI</c> tablosundan
    /// (<c>bar_kodu</c> → <c>bar_stokkodu</c>). Fiyat, ayarda belirtilen
    /// satış fiyat listesinden okunuyor.
    /// </para>
    ///
    /// <para>
    /// Fiyat sorgusu ayrı bir try içinde: liste numarası yanlışsa ya da
    /// fiyat tanımlı değilse ürün adı yine dönsün. Ürünü hiç bulamamakla
    /// fiyatını bulamamak farklı şeyler ve ekranda farklı görünmeleri
    /// gerekiyor.
    /// </para>
    /// </summary>
    /// <summary>
    /// Okunan değeri (barkod ya da karekod içeriği) çözer: bulunan ürün ve
    /// kaydedilecek barkod. Ürün yoksa karekodun içindeki sayısal barkod
    /// döner, o da yoksa değerin kendisi (13.10.2026).
    /// </summary>
    private (Urun urun, string barkod) KarekodlaBul(string deger, int? depo)
    {
        var adaylar = FiyatKontrolController.KarekodAdaylari(deger);
        foreach (var aday in adaylar)
        {
            var u = UrunBul(aday, depo);
            if (u is not null) return (u, aday);
        }
        var sayisal = adaylar.FirstOrDefault(x => x.Length >= 8 && x.Length <= 14 && x.All(char.IsDigit));
        var sonuc = sayisal ?? (deger ?? "").Trim();
        return (null, sonuc.Length > 50 ? sonuc.Substring(0, 50) : sonuc);
    }

    private Urun UrunBul(string barkod, int? depo = null)
    {
        try
        {
            using var db = _vt.MikroBaglantisi();

            var kart = db.QueryFirstOrDefault(@"
SELECT TOP 1
    LTRIM(RTRIM(B.bar_stokkodu)) AS stokKodu,
    S.sto_isim                   AS urunAdi
FROM BARKOD_TANIMLARI B
    LEFT JOIN STOKLAR S ON S.sto_kod = B.bar_stokkodu
WHERE LTRIM(RTRIM(B.bar_kodu)) = @barkod", new { barkod });

            if (kart is null) return null;

            var stokKodu = (string)kart.stokKodu;
            var urunAdi = (string)kart.urunAdi;

            decimal? raf = null, bicard = null;

            try
            {
                /* Raf (1) ve BiCard (2) fiyatı birlikte. Raf listesi numarası
                   eskisi gibi ayardan değiştirilebiliyor. */
                var liste = int.TryParse(_yapilandirma["RakipFiyat:FiyatListesi"], out var l) ? l : SatisFiyati.RafListesi;

                /* Fiyat Kontrol ekranıyla aynı kaynak: okutan personelin
                   şubesinin (deposunun) fiyatı, yoksa genel fiyat. */
                var f = db.QueryFirstOrDefault($@"
SELECT {SatisFiyati.AltSorgu("@stokKodu", liste, depo)} AS raf,
       {SatisFiyati.AltSorgu("@stokKodu", SatisFiyati.BicardListesi, depo)} AS bicard",
                    new { stokKodu });

                raf = f is null ? null : SatisFiyati.Sayi((object)f.raf);
                bicard = f is null ? null : SatisFiyati.Sayi((object)f.bicard);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata,
                    "Satış fiyatı okunamadı: {Stok}. RakipFiyat:FiyatListesi ayarını kontrol ediniz.",
                    stokKodu);
            }

            return new Urun(stokKodu, urunAdi, SatisFiyati.Etkin(raf, bicard), raf, bicard);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Barkod sorgulanamadı: {Barkod}", barkod);
            return null;
        }
    }

    /// <summary>Karşılaştırmayı kaydeder.</summary>
    [HttpPost]
    public IActionResult Kaydet([FromBody] RakipFiyatGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || girdi.FirmaId <= 0)
            return BadRequest(new { hata = "Rakip firma seçiniz." });

        if (string.IsNullOrWhiteSpace(girdi.Barkod))
            return BadRequest(new { hata = "Barkod okutunuz." });

        if (girdi.RakipFiyat <= 0)
            return BadRequest(new { hata = "Rakip fiyatı giriniz." });

        /* İndirimsiz (üstü çizili) fiyat isteğe bağlı; boşsa ya da indirimli
           fiyata eşitse rakipte indirim yok sayılıyor. */
        if (girdi.RakipListeFiyat is decimal lf && lf > 0 && lf < girdi.RakipFiyat)
            return BadRequest(new { hata = "İndirimsiz fiyat, indirimli fiyattan küçük olamaz." });

        var rakipListe = girdi.RakipListeFiyat is decimal l2 && l2 > girdi.RakipFiyat ? l2 : girdi.RakipFiyat;

        var kisi = Kisi();
        var (urun, cozulen) = KarekodlaBul(girdi.Barkod.Trim(), KisiDeposu(kisi));
        girdi.Barkod = cozulen;

        /* Fiyat istemciden değil, sunucuda yeniden okunuyor: ekranda
           gösterilen değer eskimiş ya da değiştirilmiş olabilir. */
        var bizim = urun?.BizimFiyat;

        decimal? fark = bizim is null ? null : bizim - girdi.RakipFiyat;

        decimal? yuzde = fark is null || girdi.RakipFiyat == 0
            ? null
            : Math.Round(fark.Value / girdi.RakipFiyat * 100, 1);

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_RAKIP_FIYAT
    (firma_id, barkod, stok_kodu, urun_adi, rakip_fiyat, bizim_fiyat,
     fark, fark_yuzde, sube_kodu, personel_kodu, personel_adi, not_metni,
     raf_fiyat, bicard_fiyat, fiyat_kurali, rakip_liste_fiyat)
OUTPUT INSERTED.id
VALUES (@FirmaId, @barkod, @stokKodu, @urunAdi, @RakipFiyat, @bizim,
        @fark, @yuzde, @sube, @kod, @ad, @Not, @raf, @bicard, 1, @rakipListe)",
            new
            {
                girdi.FirmaId,
                barkod = girdi.Barkod.Trim(),
                stokKodu = urun?.StokKodu,
                urunAdi = urun?.UrunAdi,
                girdi.RakipFiyat,
                bizim,
                fark,
                yuzde,
                sube = kisi?.Sube,
                kod = Sicil ?? Kullanici,
                ad = kisi?.AdSoyad ?? User.FindFirstValue("adSoyad"),
                girdi.Not,
                raf = urun?.RafFiyat,
                bicard = urun?.BicardFiyat,
                rakipListe
            });

        decimal? rafFark = urun?.RafFiyat is null ? null : urun.RafFiyat - rakipListe;

        return Ok(new
        {
            id,
            urunAdi = urun?.UrunAdi,
            bizimFiyat = bizim,
            fark,
            farkYuzde = yuzde,
            rafFiyat = urun?.RafFiyat,
            bicardFiyat = urun?.BicardFiyat,
            fiyatTuru = urun?.FiyatTuru,
            rakipFiyat = girdi.RakipFiyat,
            rakipListeFiyat = rakipListe,
            rafFark,
            rafFarkYuzde = rafFark is null || rakipListe == 0 ? (decimal?)null : Math.Round(rafFark.Value / rakipListe * 100, 1)
        });
    }

    /// <summary>
    /// Bu kişinin bir rakipteki bugünkü okutmaları (11.10.2026): uygulamada
    /// okutma ekranının altındaki liste. En yeni 30 kayıt.
    /// </summary>
    [HttpGet("Son")]
    public IActionResult Son([FromQuery] int firmaId)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT TOP 30 R.id, R.barkod, R.urun_adi AS urunAdi,
       R.rakip_fiyat AS rakipFiyat, ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat) AS rakipListeFiyat,
       R.bizim_fiyat AS bizimFiyat, R.raf_fiyat AS rafFiyat, R.bicard_fiyat AS bicardFiyat,
       CASE WHEN R.bicard_fiyat > 0 THEN 'bicard' WHEN R.bizim_fiyat IS NOT NULL THEN 'raf' END AS fiyatTuru,
       R.fark, R.fark_yuzde AS farkYuzde,
       R.raf_fiyat - ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat) AS rafFark,
       CAST(ROUND((R.raf_fiyat - ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat)) * 100.0
            / NULLIF(ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat), 0), 1) AS DECIMAL(9,1)) AS rafFarkYuzde,
       R.olusturma, R.firma_id AS firmaId, R.stok_kodu AS stokKodu, R.not_metni AS notMetni, R.duzeltme,
       (SELECT TOP 1 G.id FROM B360_URUN_GORSEL G WHERE G.stok_kodu = R.stok_kodu ORDER BY G.kapak DESC, G.id) AS gorselId
FROM B360_RAKIP_FIYAT R
WHERE R.firma_id = @firmaId AND R.personel_kodu = @kod
  AND R.olusturma >= CAST(GETDATE() AS DATE)
ORDER BY R.id DESC", new { firmaId, kod = Sicil ?? Kullanici }).ToList();

        var bugun = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM B360_RAKIP_FIYAT
WHERE firma_id = @firmaId AND personel_kodu = @kod AND olusturma >= CAST(GETDATE() AS DATE)",
            new { firmaId, kod = Sicil ?? Kullanici });

        return Ok(new { bugun, kayitlar });
    }

    /// <summary>
    /// Bu kişinin bugünkü bütün okutmaları (12.10.2026, uygulama 1.7):
    /// yanlış rakip seçip okuttuğu kaydı bulup düzeltebilsin diye rakip
    /// ayrımı olmadan.
    /// </summary>
    [HttpGet("Bugun")]
    public IActionResult Bugun()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT TOP 200 R.id, R.barkod, R.urun_adi AS urunAdi, R.stok_kodu AS stokKodu,
       R.rakip_fiyat AS rakipFiyat, ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat) AS rakipListeFiyat,
       R.bizim_fiyat AS bizimFiyat, R.raf_fiyat AS rafFiyat, R.bicard_fiyat AS bicardFiyat,
       CASE WHEN R.bicard_fiyat > 0 THEN 'bicard' WHEN R.bizim_fiyat IS NOT NULL THEN 'raf' END AS fiyatTuru,
       R.fark, R.fark_yuzde AS farkYuzde, R.olusturma, R.duzeltme, R.not_metni AS notMetni,
       R.firma_id AS firmaId, F.ad AS firmaAd, F.logo_surum AS logoSurum,
       CASE WHEN F.logo_dosya IS NOT NULL OR F.logo_adres IS NOT NULL THEN 1 ELSE 0 END AS logoVar,
       (SELECT TOP 1 G.id FROM B360_URUN_GORSEL G WHERE G.stok_kodu = R.stok_kodu ORDER BY G.kapak DESC, G.id) AS gorselId
FROM B360_RAKIP_FIYAT R
    LEFT JOIN B360_RAKIP_FIRMA F ON F.id = R.firma_id
WHERE R.personel_kodu = @kod AND R.olusturma >= CAST(GETDATE() AS DATE)
  AND ISNULL(R.kaynak, 'mobil') = 'mobil'
ORDER BY R.id DESC", new { kod = Sicil ?? Kullanici })
            .Select(x => new
            {
                id = (int)x.id,
                barkod = (string)x.barkod,
                urunAdi = (string)x.urunAdi,
                stokKodu = (string)x.stokKodu,
                rakipFiyat = (decimal)x.rakipFiyat,
                rakipListeFiyat = (decimal)x.rakipListeFiyat,
                bizimFiyat = (decimal?)x.bizimFiyat,
                rafFiyat = (decimal?)x.rafFiyat,
                bicardFiyat = (decimal?)x.bicardFiyat,
                fiyatTuru = (string)x.fiyatTuru,
                fark = (decimal?)x.fark,
                farkYuzde = (decimal?)x.farkYuzde,
                olusturma = (DateTime)x.olusturma,
                duzeltme = (DateTime?)x.duzeltme,
                notMetni = (string)x.notMetni,
                firmaId = (int)x.firmaId,
                firmaAd = (string)x.firmaAd,
                gorselId = (int?)x.gorselId,
                logo = RakipLogo.Adres((int)x.firmaId, (int)(x.logoSurum ?? 0), (int)x.logoVar == 1),
            })
            .ToList();

        return Ok(new { kayitlar });
    }

    /// <summary>
    /// Personelin bütün okutma geçmişi (23.10.2026). Hızlı olsun diye id ile
    /// sayfalanır (sonId'den küçükler, 40'ar). Özet yalnız ilk sayfada döner.
    /// gun: 0 = hepsi, 7 / 30 / 90 gün.
    /// </summary>
    [HttpGet("Gecmis")]
    public IActionResult Gecmis(int? sonId, int? firmaId, string q, int gun = 0)
    {
        if (!Yetkili()) return Forbid();

        var kod = Sicil ?? Kullanici;
        q = (q ?? "").Trim();
        if (q.Length > 60) q = q[..60];
        var baslangic = gun > 0 ? DateTime.Today.AddDays(-gun + 1) : (DateTime?)null;

        using var db = _vt.Baglanti();

        var kosul = @"R.personel_kodu = @kod AND ISNULL(R.kaynak, 'mobil') = 'mobil'
  AND (@baslangic IS NULL OR R.olusturma >= @baslangic)";
        var arg = new
        {
            kod, baslangic, sonId, firmaId,
            q = q.Length == 0 ? null : q,
            qLike = "%" + q.Replace("[", "[[]").Replace("%", "[%]").Replace("_", "[_]") + "%",
        };

        var filtre = kosul + @"
  AND (@firmaId IS NULL OR R.firma_id = @firmaId)
  AND (@q IS NULL OR R.barkod = @q OR R.urun_adi LIKE @qLike)";

        var kayitlar = db.Query(@"
SELECT TOP 40 R.id, R.barkod, R.urun_adi AS urunAdi,
       R.rakip_fiyat AS rakipFiyat, ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat) AS rakipListeFiyat,
       R.bizim_fiyat AS bizimFiyat, R.raf_fiyat AS rafFiyat, R.bicard_fiyat AS bicardFiyat,
       CASE WHEN R.bicard_fiyat > 0 THEN 'bicard' WHEN R.bizim_fiyat IS NOT NULL THEN 'raf' END AS fiyatTuru,
       R.olusturma, R.duzeltme, R.not_metni AS notMetni,
       R.firma_id AS firmaId, F.ad AS firmaAd, F.logo_surum AS logoSurum,
       CASE WHEN F.logo_dosya IS NOT NULL OR F.logo_adres IS NOT NULL THEN 1 ELSE 0 END AS logoVar
FROM B360_RAKIP_FIYAT R
    LEFT JOIN B360_RAKIP_FIRMA F ON F.id = R.firma_id
WHERE " + filtre + @"
  AND (@sonId IS NULL OR R.id < @sonId)
ORDER BY R.id DESC", arg)
            .Select(x => new
            {
                id = (int)x.id,
                barkod = (string)x.barkod,
                urunAdi = (string)x.urunAdi,
                rakipFiyat = (decimal)x.rakipFiyat,
                rakipListeFiyat = (decimal)x.rakipListeFiyat,
                bizimFiyat = (decimal?)x.bizimFiyat,
                rafFiyat = (decimal?)x.rafFiyat,
                bicardFiyat = (decimal?)x.bicardFiyat,
                fiyatTuru = (string)x.fiyatTuru,
                olusturma = (DateTime)x.olusturma,
                duzeltme = (DateTime?)x.duzeltme,
                notMetni = (string)x.notMetni,
                bugun = ((DateTime)x.olusturma).Date == DateTime.Today,
                firmaId = (int)x.firmaId,
                firmaAd = (string)x.firmaAd,
                logo = RakipLogo.Adres((int)x.firmaId, (int)(x.logoSurum ?? 0), (int)x.logoVar == 1),
            })
            .ToList();

        object ozet = null;
        if (sonId is null)
        {
            /* Rakip çipleri ve sayaçlar: arama/rakip süzgecinden bağımsız, yalnız dönem */
            var firmalar = db.Query(@"
SELECT R.firma_id AS id, MAX(F.ad) AS ad, COUNT(*) AS adet,
       SUM(CASE WHEN R.bizim_fiyat IS NOT NULL AND R.rakip_fiyat < R.bizim_fiyat THEN 1 ELSE 0 END) AS ucuz,
       SUM(CASE WHEN R.bizim_fiyat IS NOT NULL AND R.rakip_fiyat > R.bizim_fiyat THEN 1 ELSE 0 END) AS pahali
FROM B360_RAKIP_FIYAT R
    LEFT JOIN B360_RAKIP_FIRMA F ON F.id = R.firma_id
WHERE " + kosul + @"
GROUP BY R.firma_id
ORDER BY COUNT(*) DESC", arg)
                .Select(x => new { id = (int)x.id, ad = (string)x.ad, adet = (int)x.adet, ucuz = (int)x.ucuz, pahali = (int)x.pahali })
                .ToList();

            var sayac = db.QueryFirst(@"
SELECT COUNT(*) AS toplam,
       SUM(CASE WHEN R.olusturma >= CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END) AS bugun,
       SUM(CASE WHEN R.olusturma >= DATEADD(DAY, 1 - DAY(GETDATE()), CAST(GETDATE() AS DATE)) THEN 1 ELSE 0 END) AS buAy,
       COUNT(DISTINCT R.barkod) AS urun
FROM B360_RAKIP_FIYAT R
WHERE " + kosul, arg);

            ozet = new
            {
                toplam = (int)sayac.toplam,
                bugun = (int)(sayac.bugun ?? 0),
                buAy = (int)(sayac.buAy ?? 0),
                urun = (int)sayac.urun,
                firmalar,
            };
        }

        return Ok(new { kayitlar, ozet, devami = kayitlar.Count == 40 });
    }

    /// <summary>Kayıt bu kişinin bugünkü mobil okutması mı (düzeltme ve silme için)</summary>
    private dynamic DuzeltilebilirKayit(System.Data.IDbConnection db, int id, out IActionResult red)
    {
        red = null;

        var r = db.QueryFirstOrDefault(@"
SELECT id, firma_id, personel_kodu, olusturma, bizim_fiyat, raf_fiyat, kaynak
FROM B360_RAKIP_FIYAT WHERE id = @id", new { id });

        if (r is null)
        {
            red = NotFound(new { hata = "Kayıt bulunamadı." });
            return null;
        }

        if (!string.Equals(((string)r.personel_kodu ?? "").Trim(), (Sicil ?? Kullanici).Trim(), StringComparison.OrdinalIgnoreCase)
            || ((string)r.kaynak ?? "mobil") != "mobil")
        {
            red = BadRequest(new { hata = "Yalnızca kendi okuttuğunuz kaydı düzeltebilirsiniz." });
            return null;
        }

        if (((DateTime)r.olusturma).Date != DateTime.Today)
        {
            red = BadRequest(new { hata = "Yalnızca bugün okuttuğunuz kayıtlar düzeltilebilir." });
            return null;
        }

        return r;
    }

    /// <summary>
    /// Aynı gün düzeltme (12.10.2026, uygulama 1.7): yanlış rakip seçildiyse
    /// ya da fiyat yanlış yazıldıysa. Bizim fiyatımız okutma anındaki
    /// değerde kalıyor; fark yeni rakip fiyatıyla yeniden hesaplanıyor.
    /// </summary>
    [HttpPut("{id:int}")]
    public IActionResult Duzelt(int id, [FromBody] RakipFiyatGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || girdi.FirmaId <= 0) return BadRequest(new { hata = "Rakip firma seçiniz." });
        if (girdi.RakipFiyat <= 0) return BadRequest(new { hata = "Rakip fiyatı giriniz." });
        if (girdi.RakipListeFiyat is decimal lf && lf > 0 && lf < girdi.RakipFiyat)
            return BadRequest(new { hata = "İndirimsiz fiyat, indirimli fiyattan küçük olamaz." });

        using var db = _vt.Baglanti();

        var r = DuzeltilebilirKayit(db, id, out var red);
        if (r is null) return red;

        if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_RAKIP_FIRMA WHERE id = @f AND aktif = 1",
                new { f = girdi.FirmaId }) == 0)
            return BadRequest(new { hata = "Seçilen rakip bulunamadı ya da pasif." });

        var rakipListe = girdi.RakipListeFiyat is decimal l2 && l2 > girdi.RakipFiyat ? l2 : girdi.RakipFiyat;
        var bizim = (decimal?)r.bizim_fiyat;
        decimal? fark = bizim is null ? null : bizim - girdi.RakipFiyat;
        decimal? yuzde = fark is null ? null : Math.Round(fark.Value / girdi.RakipFiyat * 100, 1);

        db.Execute(@"
UPDATE B360_RAKIP_FIYAT
SET firma_id = @FirmaId, rakip_fiyat = @RakipFiyat, rakip_liste_fiyat = @rakipListe,
    fark = @fark, fark_yuzde = @yuzde, not_metni = @Not, duzeltme = SYSDATETIME()
WHERE id = @id",
            new { id, girdi.FirmaId, girdi.RakipFiyat, rakipListe, fark, yuzde, Not = string.IsNullOrWhiteSpace(girdi.Not) ? null : girdi.Not.Trim() });

        _kayit.LogInformation("Rakip fiyat #{Id} düzeltildi ({Kim})", id, Sicil ?? Kullanici);

        return Ok(new { basarili = true, id, fark, farkYuzde = yuzde, rakipListeFiyat = rakipListe });
    }

    /// <summary>Aynı gün silme: ürün yanlış okutulduysa</summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var r = DuzeltilebilirKayit(db, id, out var red);
        if (r is null) return red;

        db.Execute("DELETE FROM B360_RAKIP_FIYAT WHERE id = @id", new { id });

        _kayit.LogInformation("Rakip fiyat #{Id} silindi ({Kim})", id, Sicil ?? Kullanici);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Rapor                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Okutma raporu.
    ///
    /// Künye raporundaki desenin aynısı: süzgeçler sunucuda uygulanıyor ve
    /// özet sayılar her zaman ekrandaki listeyle aynı kümeyi anlatıyor.
    ///
    /// <c>yon</c>: <c>pahali</c> bizim daha pahalı olduğumuz,
    /// <c>ucuz</c> daha ucuz olduğumuz kayıtlar.
    /// </summary>
    [HttpGet("Rapor")]
    public IActionResult Rapor(
        [FromQuery] DateTime? bas,
        [FromQuery] DateTime? bit,
        [FromQuery] int? firma = null,
        [FromQuery] string okutan = null,
        [FromQuery] string sube = null,
        [FromQuery] string yon = null,
        [FromQuery] string ara = null,
        [FromQuery] string kaynak = null)
    {
        if (!Yetkili()) return Forbid();

        var baslangic = (bas ?? DateTime.Today.AddDays(-30)).Date;
        var bitis = (bit ?? DateTime.Today).Date.AddDays(1);

        /* Kural öncesi okutmalar bir kez BiCard kuralına çevriliyor. Hata
           olursa rapor yine açılıyor; sebep ekranda gösteriliyor. */
        string eskiHata = null;
        try
        {
            for (var tur = 0; tur < 20 && EskileriGuncelle() > 0; tur++) { }
        }
        catch (Exception hata)
        {
            eskiHata = hata.Message;
            _kayit.LogWarning(hata, "Eski rakip fiyat kayıtları BiCard kuralına çevrilemedi");
        }

        using var db = _vt.Baglanti();

        var eskiKalan = 0;
        try
        {
            eskiKalan = db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_RAKIP_FIYAT WHERE fiyat_kurali IS NULL");
        }
        catch (Exception hata)
        {
            eskiHata ??= hata.Message;
        }

        const string suzgec = @"
  AND (@firma  IS NULL OR R.firma_id = @firma)
  AND (@okutan IS NULL OR R.personel_adi = @okutan)
  AND (@sube   IS NULL OR R.sube_kodu = @sube)
  AND (@yon IS NULL
       OR (@yon = 'pahali' AND R.fark IS NOT NULL AND R.fark > 0)
       OR (@yon = 'ucuz'   AND R.fark IS NOT NULL AND R.fark < 0)
       OR (@yon = 'esit'   AND R.fark IS NOT NULL AND R.fark = 0))
  AND (@ara IS NULL OR R.urun_adi LIKE @kalip OR R.barkod LIKE @kalip
       OR R.stok_kodu LIKE @kalip OR R.not_metni LIKE @kalip)
  AND (@kaynak IS NULL OR ISNULL(R.kaynak, 'mobil') = @kaynak)";

        var parametre = new
        {
            bas = baslangic,
            bit = bitis,
            firma,
            okutan = Bos(okutan),
            /* Şube kullanıcısı yalnızca kendi şubesinin kayıtları */
            sube = (_panelKullanici.Getir(Kullanici) is { SubeKilitli: true } k
                ? k.SubeKodu : null) ?? Bos(sube),
            yon = Bos(yon),
            ara = Bos(ara),
            kalip = $"%{ara}%",
            /* mobil: mağazada okutulan, web: rakip web sitesinden (09.10.2026) */
            kaynak = kaynak is "mobil" or "web" ? kaynak : null
        };

        var kayitlar = db.Query($@"
SELECT
    R.id, R.barkod, R.stok_kodu AS stokKodu, R.urun_adi AS urunAdi,
    R.rakip_fiyat AS rakipFiyat, R.bizim_fiyat AS bizimFiyat,
    R.fark, R.fark_yuzde AS farkYuzde,
    /* İki fiyat (09.10.2026): bizim_fiyat geçerli fiyat (BiCard > 0 ise
       BiCard, değilse raf). Bu tarihten önceki kayıtlarda yalnızca raf
       fiyatı vardı ve bizim_fiyat oydu. */
    RF.raf AS rafFiyat, R.bicard_fiyat AS bicardFiyat,
    /* Raf fiyatımız rakibin indirimsiz (üstü çizili) fiyatıyla; indirim
       yoksa ya da mağazada okutulduysa rakibin satış fiyatıyla */
    RF.rakipListe AS rakipListeFiyat,
    RF.raf - RF.rakipListe AS rafFark,
    CAST(ROUND((RF.raf - RF.rakipListe) * 100.0 / NULLIF(RF.rakipListe, 0), 1) AS DECIMAL(9,1)) AS rafFarkYuzde,
    CASE WHEN R.bicard_fiyat > 0 THEN 'bicard'
         WHEN R.bizim_fiyat IS NOT NULL THEN 'raf' END AS fiyatTuru,
    R.sube_kodu AS subeKodu, R.personel_adi AS personelAdi,
    R.not_metni AS notMetni, R.olusturma,
    ISNULL(R.kaynak, 'mobil') AS kaynak, R.web_link AS webLink,
    F.ad AS firma,
    /* Ürün görseli (12.10.2026): Fiyat Kontrol'deki kapak görseli */
    (SELECT TOP 1 G.id FROM B360_URUN_GORSEL G WHERE G.stok_kodu = R.stok_kodu ORDER BY G.kapak DESC, G.id) AS gorselId
FROM B360_RAKIP_FIYAT R
    LEFT JOIN B360_RAKIP_FIRMA F ON R.firma_id = F.id
    CROSS APPLY (SELECT CASE WHEN R.fiyat_kurali IS NULL
                             THEN R.bizim_fiyat ELSE R.raf_fiyat END AS raf,
                        ISNULL(R.rakip_liste_fiyat, R.rakip_fiyat) AS rakipListe) RF
WHERE R.olusturma >= @bas AND R.olusturma < @bit{suzgec}
ORDER BY R.olusturma DESC", parametre).ToList();

        var farklar = kayitlar
            .Where(x => x.fark is not null)
            .Select(x => (decimal)x.fark)
            .ToList();

        /* Fark burada 'bizim fiyat - rakip fiyat': pozitif olması bizim
           pahalı olduğumuz anlamına geliyor, künye modülüyle aynı yön. */
        var urunler = kayitlar
            .Where(x => x.fark is not null)
            .GroupBy(x => (string)x.urunAdi ?? "Bilinmiyor")
            .Select(g => new
            {
                urun = g.Key,
                adet = g.Count(),
                ortalamaFark = Math.Round(g.Average(x => (decimal)x.fark), 2),
                pahaliSayisi = g.Count(x => (decimal)x.fark > 0),
                rafOrtalamaFark = g.Any(x => x.rafFark is not null)
                    ? Math.Round(g.Where(x => x.rafFark is not null).Average(x => (decimal)x.rafFark), 2)
                    : (decimal?)null,
                fiyatTuru = (string)g.OrderByDescending(x => (DateTime)x.olusturma).First().fiyatTuru
            })
            .OrderByDescending(x => x.ortalamaFark)
            .ToList();

        /* ------------------------------------------- analiz (09.10.2026) */

        /* Fiyat endeksi: bizim / rakip × 100 ortalaması. 100 eşit, 105 bizim
           ortalamada %5 pahalı olduğumuz anlamına gelir. */
        static decimal? Endeks(IEnumerable<dynamic> l)
        {
            var o = l.Where(x => x.bizimFiyat is not null && (decimal)x.rakipFiyat > 0)
                     .Select(x => (decimal)x.bizimFiyat / (decimal)x.rakipFiyat * 100m)
                     .ToList();
            return o.Count == 0 ? null : Math.Round(o.Average(), 1);
        }

        static decimal? OrtYuzde(IEnumerable<dynamic> l)
        {
            var o = l.Where(x => x.farkYuzde is not null).Select(x => (decimal)x.farkYuzde).ToList();
            return o.Count == 0 ? null : Math.Round(o.Average(), 1);
        }

        /* Raf fiyatıyla satsaydık: aynı ölçüler raf fiyatı üzerinden */
        static decimal? RafEndeks(IEnumerable<dynamic> l)
        {
            var o = l.Where(x => x.rafFiyat is not null && (decimal)x.rakipListeFiyat > 0)
                     .Select(x => (decimal)x.rafFiyat / (decimal)x.rakipListeFiyat * 100m)
                     .ToList();
            return o.Count == 0 ? null : Math.Round(o.Average(), 1);
        }

        static int Pahali(IEnumerable<dynamic> l) => l.Count(x => x.fark is not null && (decimal)x.fark > 0);
        static int Ucuz(IEnumerable<dynamic> l) => l.Count(x => x.fark is not null && (decimal)x.fark < 0);
        static int Esit(IEnumerable<dynamic> l) => l.Count(x => x.fark is not null && (decimal)x.fark == 0);

        var firmalar = kayitlar
            .Where(x => x.firma is not null)
            .GroupBy(x => (string)x.firma)
            .Select(g => new
            {
                firma = g.Key,
                adet = g.Count(),
                karsilastirilan = g.Count(x => x.fark is not null),
                ortalamaFark = g.Any(x => x.fark is not null) ? Math.Round(g.Where(x => x.fark is not null).Average(x => (decimal)x.fark), 2) : 0m,
                pahaliSayisi = Pahali(g),
                ucuzSayisi = Ucuz(g),
                esitSayisi = Esit(g),
                endeks = Endeks(g),
                rafEndeks = RafEndeks(g),
                bicardSayisi = g.Count(x => (string)x.fiyatTuru == "bicard"),
                ortalamaYuzde = OrtYuzde(g),
                sonOkutma = g.Max(x => (DateTime)x.olusturma),
                urunSayisi = g.Select(x => (string)x.barkod).Distinct().Count(),
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        var okutanlar = kayitlar
            .Where(x => x.personelAdi is not null)
            .GroupBy(x => (string)x.personelAdi)
            .Select(g => new
            {
                okutan = g.Key,
                adet = g.Count(),
                sube = g.GroupBy(x => (string)x.subeKodu).OrderByDescending(x => x.Count()).First().Key,
                son = g.Max(x => (DateTime)x.olusturma),
                firmaSayisi = g.Select(x => (string)x.firma).Distinct().Count(),
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        var subeler = kayitlar
            .GroupBy(x => (string)x.subeKodu ?? "")
            .Select(g => new
            {
                sube = g.Key.Length == 0 ? null : g.Key,
                adet = g.Count(),
                pahaliSayisi = Pahali(g),
                ucuzSayisi = Ucuz(g),
                endeks = Endeks(g),
                rafEndeks = RafEndeks(g),
                okutanSayisi = g.Select(x => (string)x.personelAdi).Distinct().Count(),
            })
            .OrderByDescending(x => x.adet)
            .ToList();

        var gunluk = kayitlar
            .GroupBy(x => ((DateTime)x.olusturma).Date)
            .OrderBy(g => g.Key)
            .Select(g => new
            {
                gun = g.Key,
                adet = g.Count(),
                pahali = Pahali(g),
                ucuz = Ucuz(g),
                esit = Esit(g),
                endeks = Endeks(g),
                rafEndeks = RafEndeks(g),
            })
            .ToList();

        /* Fark yüzdesi dağılımı: (bizim - rakip) / rakip */
        var yuzdeler = kayitlar.Where(x => x.farkYuzde is not null).Select(x => (decimal)x.farkYuzde).ToList();
        var dilimler = new (string Ad, string Yon, Func<decimal, bool> Icinde)[]
        {
            ("−%20 ve altı", "ucuz",   v => v <= -20),
            ("−%20…−%10",    "ucuz",   v => v > -20 && v <= -10),
            ("−%10…−%5",     "ucuz",   v => v > -10 && v <= -5),
            ("−%5…%0",       "ucuz",   v => v > -5 && v < 0),
            ("Eşit",         "esit",   v => v == 0),
            ("%0…%5",        "pahali", v => v > 0 && v <= 5),
            ("%5…%10",       "pahali", v => v > 5 && v <= 10),
            ("%10…%20",      "pahali", v => v > 10 && v < 20),
            ("%20 ve üstü",  "pahali", v => v >= 20),
        };
        var dagilim = dilimler.Select(d => new { ad = d.Ad, yon = d.Yon, adet = yuzdeler.Count(d.Icinde) }).ToList();

        /* Her ürün × rakip firma için en son okutma: "bugün nerede duruyoruz" */
        var sonDurum = kayitlar
            .Where(x => x.fark is not null)
            .GroupBy(x => ((string)x.barkod, (string)x.firma))
            .Select(g => g.OrderByDescending(x => (DateTime)x.olusturma).First())
            .Select(x => new
            {
                x.id,
                barkod = (string)x.barkod,
                urunAdi = (string)x.urunAdi,
                firma = (string)x.firma,
                rakipFiyat = (decimal)x.rakipFiyat,
                bizimFiyat = (decimal?)x.bizimFiyat,
                fark = (decimal?)x.fark,
                farkYuzde = (decimal?)x.farkYuzde,
                rafFiyat = (decimal?)x.rafFiyat,
                bicardFiyat = (decimal?)x.bicardFiyat,
                rafFark = (decimal?)x.rafFark,
                rafFarkYuzde = (decimal?)x.rafFarkYuzde,
                rakipListeFiyat = (decimal?)x.rakipListeFiyat,
                fiyatTuru = (string)x.fiyatTuru,
                olusturma = (DateTime)x.olusturma,
                subeKodu = (string)x.subeKodu,
                gorselId = (int?)x.gorselId,
            })
            .ToList();

        /* Önceki eş uzunluktaki dönem: KPI kıyası */
        object onceki = null;
        try
        {
            var gunSayisi = (bitis - baslangic).Days;
            var op = new
            {
                bas = baslangic.AddDays(-gunSayisi),
                bit = baslangic,
                parametre.firma,
                parametre.okutan,
                parametre.sube,
                parametre.yon,
                parametre.ara,
                parametre.kalip,
                parametre.kaynak
            };

            var eski = db.Query($@"
SELECT R.rakip_fiyat AS rakipFiyat, R.bizim_fiyat AS bizimFiyat, R.fark, R.fark_yuzde AS farkYuzde
FROM B360_RAKIP_FIYAT R
WHERE R.olusturma >= @bas AND R.olusturma < @bit{suzgec}", op).ToList();

            onceki = new
            {
                baslangic = op.bas,
                bitis = op.bit.AddDays(-1),
                toplam = eski.Count,
                pahali = Pahali(eski),
                ucuz = Ucuz(eski),
                karsilastirilan = eski.Count(x => x.fark is not null),
                endeks = Endeks(eski),
                ortalamaYuzde = OrtYuzde(eski),
            };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rakip fiyat önceki dönem okunamadı");
        }

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            toplam = kayitlar.Count,
            karsilastirilan = farklar.Count,
            karsilastirilamayan = kayitlar.Count - farklar.Count,
            pahaliAldigimiz = farklar.Count(x => x > 0),
            ucuzAldigimiz = farklar.Count(x => x < 0),
            esit = farklar.Count(x => x == 0),
            ortalamaFark = farklar.Count > 0 ? Math.Round(farklar.Average(), 2) : 0m,
            toplamFark = farklar.Count > 0 ? Math.Round(farklar.Sum(), 2) : 0m,
            endeks = Endeks(kayitlar),
            ortalamaYuzde = OrtYuzde(kayitlar),
            urunSayisi = kayitlar.Select(x => (string)x.barkod).Distinct().Count(),
            fiyatKiyas = FiyatKiyasi(kayitlar),
            eskiKayit = new { kalan = eskiKalan, hata = eskiHata },
            kayitlar,
            urunler,
            firmalar,
            okutanlar,
            subeler,
            gunluk,
            dagilim,
            sonDurum,
            onceki,
            secenekler = Secenekler(db, baslangic, bitis)
        });
    }

    /// <summary>
    /// "BiCard ile satıyoruz / rafla satsaydık" kıyası (09.10.2026).
    ///
    /// <para>
    /// Geçerli fiyat: BiCard 0'dan büyükse BiCard, değilse raf. Raf
    /// tarafında aynı kayıtlar raf fiyatıyla yeniden hesaplanıyor. Fark
    /// BiCard'ın getirdiği: rafla rakipten pahalı olup BiCard'la eşit ya da
    /// ucuz olduğumuz ürünler "BiCard'la öne geçtiğimiz" ürünler.
    /// </para>
    /// </summary>
    private static object FiyatKiyasi(List<dynamic> kayitlar)
    {
        decimal? Ort(IEnumerable<decimal> l) { var o = l.ToList(); return o.Count == 0 ? null : Math.Round(o.Average(), 1); }

        object Taraf(Func<dynamic, decimal?> fiyat, Func<dynamic, decimal?> fark, Func<dynamic, decimal?> yuzde,
                     Func<dynamic, decimal> rakipFiyati)
        {
            /* Dinamik satırlar önce türlü değerlere çevriliyor */
            var l = kayitlar
                .Select(x => (Fiyat: (decimal?)fiyat(x), Fark: (decimal?)fark(x),
                              Yuzde: (decimal?)yuzde(x), Rakip: (decimal)rakipFiyati(x)))
                .Where(x => x.Fiyat is not null)
                .ToList();

            return new
            {
                karsilastirilan = l.Count,
                pahali = l.Count(x => x.Fark > 0),
                ucuz = l.Count(x => x.Fark < 0),
                esit = l.Count(x => x.Fark == 0),
                endeks = Ort(l.Where(x => x.Rakip > 0).Select(x => x.Fiyat.Value / x.Rakip * 100m)),
                ortalamaYuzde = Ort(l.Where(x => x.Yuzde is not null).Select(x => x.Yuzde.Value)),
                toplamFark = Math.Round(l.Sum(x => x.Fark ?? 0m), 2),
                ortalamaFark = l.Count == 0 ? 0m : Math.Round(l.Average(x => x.Fark ?? 0m), 2),
            };
        }

        var ikisi = kayitlar
            .Where(x => (string)x.fiyatTuru == "bicard" && x.rafFiyat is not null && (decimal)x.rafFiyat > 0)
            .ToList();

        return new
        {
            /* Bundan satıyoruz: geçerli fiyat */
            /* BiCard (yoksa raf) ↔ rakibin indirimli satış fiyatı */
            satiyoruz = Taraf(x => (decimal?)x.bizimFiyat, x => (decimal?)x.fark, x => (decimal?)x.farkYuzde, x => (decimal)x.rakipFiyat),

            /* Bundan satsaydık: raf fiyatı */
            /* Raf ↔ rakibin indirimsiz (üstü çizili) fiyatı */
            rafla = Taraf(x => (decimal?)x.rafFiyat, x => (decimal?)x.rafFark, x => (decimal?)x.rafFarkYuzde, x => (decimal)x.rakipListeFiyat),

            bicardUygulanan = ikisi.Count,

            /* Rakipte indirimdeki ürünler: indirimsiz fiyatı satış fiyatından büyük */
            rakipIndirimde = kayitlar.Count(x => (decimal)x.rakipListeFiyat > (decimal)x.rakipFiyat),
            ortalamaRakipIndirim = Ort(kayitlar
                .Where(x => (decimal)x.rakipListeFiyat > (decimal)x.rakipFiyat)
                .Select(x => (decimal)(((decimal)x.rakipListeFiyat - (decimal)x.rakipFiyat) / (decimal)x.rakipListeFiyat * 100m))),
            rafUygulanan = kayitlar.Count(x => (string)x.fiyatTuru == "raf"),

            /* BiCard'ın raf fiyatına göre ortalama indirimi */
            ortalamaBicardIndirim = Ort(ikisi.Select(x => (decimal)(((decimal)x.rafFiyat - (decimal)x.bicardFiyat) / (decimal)x.rafFiyat * 100m))),

            /* Rafla pahalıyız ama BiCard'la değiliz */
            bicardlaOneGecilen = ikisi.Count(x => (decimal)x.rafFark > 0 && x.fark is not null && (decimal)x.fark <= 0),

            /* BiCard'la bile pahalıyız */
            bicardlaDaPahali = ikisi.Count(x => x.fark is not null && (decimal)x.fark > 0),
        };
    }

    /* ==================================================================== */
    /* Eski okutmalar (09.10.2026)                                          */
    /* ==================================================================== */

    private static readonly SemaphoreSlim _eskiKilit = new(1, 1);

    /// <summary>
    /// Elle tetikleme: kural öncesi okutmaları BiCard kuralına çevirir.
    /// Rapor açılırken de kendiliğinden çalışıyor.
    /// </summary>
    [HttpPost("FiyatlariGuncelle")]
    public IActionResult FiyatlariGuncelle()
    {
        if (!Yetkili()) return Forbid();

        var toplam = 0;
        int adet;

        try
        {
            do
            {
                adet = EskileriGuncelle();
                toplam += adet;
            }
            while (adet > 0 && toplam < 200_000);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Eski rakip fiyat kayıtları güncellenemedi");
            return StatusCode(500, new { hata = $"Güncellenemedi ({toplam} kayıt güncellendi): {hata.Message}" });
        }

        return Ok(new { guncellenen = toplam });
    }

    /// <summary>
    /// BiCard kuralından (09.10.2026) önce kaydedilen okutmalar.
    ///
    /// <para>
    /// O kayıtlarda bizim_fiyat yalnızca 1. fiyattı ve şube ayrımı
    /// gözetilmeden okunmuştu. Raf ve BiCard fiyatı Fiyat Kontrol ekranıyla
    /// aynı kuralla (okutmanın yapıldığı şubenin fiyatı, yoksa genel fiyat)
    /// Mikro'dan yeniden okunuyor; BiCard okutma anı için tutulmadığından
    /// güncel fiyatlar kullanılıyor. Fiyat bulunamazsa eski değer raf
    /// sayılıyor. Geçerli fiyat (BiCard > 0 ise BiCard, değilse raf), fark ve
    /// fark yüzdesi yeniden hesaplanıyor. Kayıt fiyat_kurali = 1 ile işaretleniyor ve
    /// bir daha ele alınmıyor. Bir çağrıda en çok 5000 kayıt.
    /// </para>
    /// </summary>
    private int EskileriGuncelle()
    {
        if (!_eskiKilit.Wait(0)) return 0;

        try
        {
            using var db = _vt.Baglanti();
            db.Open();

            var eskiler = db.Query(@"
SELECT TOP 5000 id, LTRIM(RTRIM(stok_kodu)) AS stokKodu, sube_kodu AS sube,
       rakip_fiyat AS rakip, bizim_fiyat AS bizim
FROM B360_RAKIP_FIYAT WHERE fiyat_kurali IS NULL ORDER BY id").ToList();

            if (eskiler.Count == 0) return 0;

            /* Her kaydın deposu: okutmanın yapıldığı şube. Fiyat Kontrol
               ekranıyla aynı kural (şubenin fiyatı, yoksa genel fiyat). */
            var depoBul = SatisFiyati.DepoBulucu(db);
            var rafListesi = int.TryParse(_yapilandirma["RakipFiyat:FiyatListesi"], out var l) ? l : SatisFiyati.RafListesi;

            var satirlar = eskiler.Select(x => new
            {
                Id = (int)x.id,
                Kod = ((string)x.stokKodu ?? "").Trim(),
                Depo = depoBul((string)x.sube),
                Rakip = (decimal)x.rakip,
                Eski = (decimal?)x.bizim,
            }).ToList();

            var fiyatlar = new Dictionary<(string, int?), (decimal? Raf, decimal? Bicard)>();

            using (var mikro = _vt.MikroBaglantisi())
            {
                foreach (var grup in satirlar.Where(x => x.Kod.Length > 0).GroupBy(x => x.Depo))
                {
                    var kodlar = grup.Select(x => x.Kod).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

                    foreach (var parca in kodlar.Chunk(800))
                        foreach (var r in mikro.Query($@"
SELECT LTRIM(RTRIM(S.sto_kod)) AS kod,
       {SatisFiyati.AltSorgu("S.sto_kod", rafListesi, grup.Key)} AS raf,
       {SatisFiyati.AltSorgu("S.sto_kod", SatisFiyati.BicardListesi, grup.Key)} AS bicard
FROM STOKLAR S WITH (NOLOCK)
WHERE S.sto_kod IN @parca", new { parca }, commandTimeout: 120))
                            fiyatlar[(((string)r.kod).ToUpperInvariant(), grup.Key)] = (SatisFiyati.Sayi((object)r.raf), SatisFiyati.Sayi((object)r.bicard));
                }
            }

            var guncellemeler = satirlar.Select(x =>
            {
                fiyatlar.TryGetValue((x.Kod.ToUpperInvariant(), x.Depo), out var f);

                /* Fiyat bulunamazsa kayıttaki eski fiyat raf sayılıyor */
                decimal? raf = f.Raf ?? x.Eski;
                decimal? bicard = f.Bicard;
                var etkin = SatisFiyati.Etkin(raf, bicard);
                decimal? fark = etkin is null ? null : etkin - x.Rakip;
                decimal? yuzde = fark is null || x.Rakip == 0 ? null : Math.Round(fark.Value / x.Rakip * 100, 1);

                return new { id = x.Id, raf, bicard, etkin, fark, yuzde };
            }).ToList();

            using var islem = db.BeginTransaction();

            db.Execute(@"
UPDATE B360_RAKIP_FIYAT
SET raf_fiyat = @raf, bicard_fiyat = @bicard, bizim_fiyat = @etkin,
    fark = @fark, fark_yuzde = @yuzde, fiyat_kurali = 1
WHERE id = @id AND fiyat_kurali IS NULL", guncellemeler, islem, commandTimeout: 300);

            islem.Commit();

            _kayit.LogInformation("Rakip fiyat: {Adet} eski okutma BiCard kuralına çevrildi", guncellemeler.Count);

            return guncellemeler.Count;
        }
        finally
        {
            _eskiKilit.Release();
        }
    }

    private static string Bos(string d) => string.IsNullOrWhiteSpace(d) ? null : d;

    /// <summary>
    /// Süzgeç kutularının seçenekleri.
    ///
    /// Yalnızca tarih aralığına bakılıyor; diğer süzgeçlere bakılsaydı bir
    /// firma seçildiğinde okutan listesi tek kişiye düşüp seçim
    /// değiştirilemez hâle gelirdi.
    /// </summary>
    private static object Secenekler(System.Data.IDbConnection db,
                                     DateTime bas, DateTime bit)
    {
        var p = new { bas, bit };

        return new
        {
            firmalar = db.Query(@"
SELECT id, ad, logo_surum AS logoSurum,
       CASE WHEN logo_dosya IS NOT NULL OR logo_adres IS NOT NULL THEN 1 ELSE 0 END AS logoVar
FROM B360_RAKIP_FIRMA ORDER BY sira, ad")
                .Select(x => new
                {
                    id = (int)x.id,
                    ad = (string)x.ad,
                    logo = RakipLogo.Adres((int)x.id, (int)x.logoSurum, (int)x.logoVar == 1),
                })
                .ToList(),

            okutanlar = db.Query<string>(@"
SELECT DISTINCT personel_adi FROM B360_RAKIP_FIYAT
WHERE olusturma >= @bas AND olusturma < @bit AND personel_adi IS NOT NULL
ORDER BY personel_adi", p).ToList(),

            subeler = db.Query<string>(@"
SELECT DISTINCT sube_kodu FROM B360_RAKIP_FIYAT
WHERE olusturma >= @bas AND olusturma < @bit AND sube_kodu IS NOT NULL
ORDER BY sube_kodu", p).ToList()
        };
    }

    /* ==================================================================== */
    /* Firmalar (okuma)                                                     */
    /* ==================================================================== */

    /// <summary>
    /// Rakip firma listesi.
    ///
    /// Tanımlama Yönetim sayfasından yapılıyor; burası yalnızca okuma.
    /// </summary>
    [HttpGet("Firmalar")]
    public IActionResult Firmalar()
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        return Ok(db.Query(@"
SELECT id, ad, aktif, sira, logo_surum AS logoSurum,
       CASE WHEN logo_dosya IS NOT NULL OR logo_adres IS NOT NULL THEN 1 ELSE 0 END AS logoVar
FROM B360_RAKIP_FIRMA ORDER BY sira, ad")
            .Select(x => new
            {
                id = (int)x.id,
                ad = (string)x.ad,
                aktif = (bool)x.aktif,
                sira = (int)x.sira,
                logo = RakipLogo.Adres((int)x.id, (int)x.logoSurum, (int)x.logoVar == 1),
            })
            .ToList());
    }
}

/* ========================================================================== */

public class RakipFiyatGirdi
{
    public int FirmaId { get; set; }
    public string Barkod { get; set; }

    /// <summary>Rakip mağazadaki raf fiyatı (indirimliyse indirimli satış fiyatı).</summary>
    public decimal RakipFiyat { get; set; }

    /// <summary>
    /// Rakibin indirimsiz (üstü çizili) fiyatı; isteğe bağlı (uygulama 1.7).
    /// Raporda bizim raf fiyatımızla karşılaştırılıyor.
    /// </summary>
    public decimal? RakipListeFiyat { get; set; }

    public string Not { get; set; }
}

using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İzin talepleri ve üç aşamalı onay akışı.
///
/// <para>
/// Personel uygulamadan talep oluşturur. Sırasıyla birim yöneticisi, üst
/// müdürü ve insan kaynakları onaylar. Her aşama yalnızca kendi sırası
/// geldiğinde karar verebilir; bir önceki onaylamadan sonraki aşamaya
/// düşmez. İK onayından sonra izin kaydı oluşturulur ve bakiyeden düşer.
/// </para>
///
/// <para>
/// Reddetmede açıklama zorunludur: personel neden reddedildiğini
/// bilmezse aynı talebi tekrar açıyor.
/// </para>
///
/// <para>
/// 26.10.2026: onay akışı avans onay tablosundaki süreç (<see cref="IzinOnayZinciri"/>):
/// kişi adımları tablodaki sırayla (birim yöneticisi → bölge müdürü / genel
/// müdür yardımcısı…), İnsan Kaynakları en sonda. Zincir talebe yazılıyor;
/// durum adları ("Bekliyor" ilk adım, "Mağaza Onayladı" ara adımlar, "Bölge
/// Onayladı" İK) ve magaza_* / bolge_* / ik_* kolonları yayındaki uygulama
/// ve panel için korunuyor. Zinciri olmayan eski talepler eski akışla sürer.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class IzinTalepController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly AyarServisi _ayar;
    private readonly BildirimServisi _bildirim;
    private readonly PortalYetkiServisi _portalYetki;
    private readonly OrgOnayServisi _orgOnay;
    private readonly IzinGunuServisi _izinGunu;
    private readonly ILogger<IzinTalepController> _kayit;
    private readonly DepartmanServisi _departman;
    private readonly IzinFormuServisi _form;
    private readonly IServiceScopeFactory _kapsam;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly EkipServisi _ekip;
    private readonly IzinOnayZinciri _zincir;

    public IzinTalepController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        AyarServisi ayar,
        BildirimServisi bildirim,
        PortalYetkiServisi portalYetki,
        OrgOnayServisi orgOnay,
        IzinGunuServisi izinGunu,
        ILogger<IzinTalepController> kayit,
        DepartmanServisi departman,
        IzinFormuServisi form,
        IServiceScopeFactory kapsam,
        IConfiguration yapilandirma,
        IWebHostEnvironment ortam,
        EkipServisi ekip,
        IzinOnayZinciri zincir)
    {
        _zincir = zincir;
        _ekip = ekip;
        _yapilandirma = yapilandirma;
        _ortam = ortam;
        _departman = departman;
        _form = form;
        _kapsam = kapsam;
        _orgOnay = orgOnay;
        _izinGunu = izinGunu;
        _vt = vt;
        _personelKaynak = personelKaynak;
        _ayar = ayar;
        _bildirim = bildirim;
        _portalYetki = portalYetki;
        _kayit = kayit;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private string Rol =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /* Durum adları tek yerde: yazım farkı akışı sessizce bozar */
    private const string Bekliyor = "Bekliyor";
    private const string MagazaOnayli = "Mağaza Onayladı";
    private const string BolgeOnayli = "Bölge Onayladı";
    private const string Onaylandi = "Onaylandı";
    private const string Reddedildi = "Reddedildi";

    /// <summary>
    /// Bu rol hangi aşamada karar verebilir.
    ///
    /// Birim yöneticisi ilk aşamada, üst yönetici ikincide, İK üçüncüde.
    /// Yönetici rolleri her aşamada karar verebilir — akış tıkanırsa
    /// müdahale edebilecek biri olmalı.
    /// </summary>
    private string AsamaRolu() => Rol switch
    {
        Roller.Admin or Roller.GenelMudurYardimcisi => "hepsi",
        Roller.IK or Roller.IKYoneticisi => "ik",
        /* Bölge müdürü (07.10.2026): 1. aşamada (mağaza müdürünün talebi
           gibi kendisi 1. onaylayansa) ve 2. aşamada karar verebilir */
        Roller.BolgeMuduru => "bolgemd",
        Roller.BolgeKoordinatoru => "bolge",
        _ => "",
    };

    /* ==================================================================== */
    /* Personel tarafı                                                      */
    /* ==================================================================== */

    /// <summary>Talep edilebilecek izin türleri.</summary>
    [HttpGet("Turler")]
    [Authorize(Roles = "Personel")]
    public IActionResult Turler()
    {
        using var db = _vt.Baglanti();

        var kayitlar = IzinTurleri(db);

        /* Mazeret izni türleri (07.10.2026, Ayarlar Merkezi › Seçenek
           listeleri): 1.6 mazeret izninde bunları seçtiriyor. 1.5 alanı yok sayar. */
        var mazeret = SecenekListesi.Tumu(IzinEvrak.MazeretListesi)
            .Where(x => x.Acik)
            .Select(x => new { ad = x.Ad, aciklamaZorunlu = x.AciklamaZorunlu, belgeGerekli = x.BelgeGerekli })
            .ToList();

        /* Raporlu (23.10.2026): rapor belgesi talep ekranında yükleniyor;
           bu akış 1.9'da. Eski sürüme gösterilmiyor (belgesiz talep açılmasın).
           Mazeret ve yarım gün izni kaldırıldı (tür tablosunda pasif). */
        if (!Surum19())
            kayitlar = kayitlar.Where(x => !IzinEvrak.RaporluMu((string)x.ad)).ToList();

        return Ok(new
        {
            /* Eski sürümler düz ad listesi bekliyor; ikisi birden dönüyor */
            turler = kayitlar.Select(x => x.ad).ToList(),
            turKayitlari = kayitlar.Select(x => new
            {
                ad = (string)x.ad,
                bakiyedenDuser = (bool)x.bakiyedenDuser,
                sureTuru = (string)x.sureTuru,
                aciklama = (string)x.aciklama,
                altTurler = IzinEvrak.MazeretMi((string)x.ad) && mazeret.Count > 0 ? mazeret : null,
                /* 1.9: rapor akışı ve saatlik izin üst sınırı */
                rapor = IzinEvrak.RaporluMu((string)x.ad),
                enFazlaSaat = (string)x.sureTuru == "saat" ? SaatlikSinir : (decimal?)null,
            }).ToList(),
        });
    }

    /// <summary>
    /// Tanımlı izin türleri. Tablo yoksa ya da boşsa yıllık izin tek
    /// seçenek: talep ekranı hiçbir zaman boş kalmamalı.
    /// </summary>
    private static List<dynamic> IzinTurleri(System.Data.IDbConnection db)
    {
        try
        {
            var liste = db.Query(@"
SELECT ad, CAST(bakiyeden_duser AS BIT) AS bakiyedenDuser, sure_turu AS sureTuru, aciklama
FROM KRY_IZIN_TURU WHERE aktif = 1 ORDER BY sira, ad").ToList();

            if (liste.Count > 0) return liste;
        }
        catch
        {
            /* Tablo henüz kurulmadıysa varsayılana düşülüyor */
        }

        return new List<dynamic>();
    }

    /// <summary>Türün bakiyeden düşüp düşmediği; tanımsızsa yalnızca yıllık izin düşer.</summary>
    private static bool BakiyedenDuser(System.Data.IDbConnection db, string tur)
    {
        var t = IzinTurleri(db).FirstOrDefault(x =>
            string.Equals((string)x.ad, tur, StringComparison.OrdinalIgnoreCase));

        return t is null
            ? string.Equals(tur, "Yıllık İzin", StringComparison.OrdinalIgnoreCase)
            : (bool)t.bakiyedenDuser;
    }

    /// <summary>Bu türde izin onaylanınca personelden belge isteniyor mu (mazeret, rapor).</summary>
    private static bool BelgeGerekli(System.Data.IDbConnection db, string tur)
    {
        try
        {
            return db.ExecuteScalar<bool?>(
                "SELECT TOP 1 CAST(belge_gerekli AS BIT) FROM KRY_IZIN_TURU WHERE ad = @tur",
                new { tur }) ?? false;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Kişinin kendi talepleri.</summary>
    [HttpGet("Taleplerim")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> Taleplerim()
    {
        await TakilanlariIlerlet();

        var kod = PersonelKodu();

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, tur, cikis_tarihi AS cikisTarihi, donus_tarihi AS donusTarihi,
       gun, yarim_gun AS yarimGun, baslangic_saat AS baslangicSaat,
       bitis_saat AS bitisSaat, saat, aciklama, durum, olusturma, baslama_tarihi AS baslamaTarihi,
       magaza_karar AS magazaKarar, magaza_not AS magazaNot,
       magaza_kisi AS magazaKisi, magaza_tarih AS magazaTarih,
       bolge_karar AS bolgeKarar, bolge_not AS bolgeNot,
       bolge_kisi AS bolgeKisi, bolge_tarih AS bolgeTarih,
       ik_karar AS ikKarar, ik_not AS ikNot,
       ik_kisi AS ikKisi, ik_tarih AS ikTarih,
       yerine_ad AS yerineAd, alt_tur AS altTur, CAST(ISNULL(form_sarti, 0) AS BIT) AS formSarti,
       mb_son, mb_yukleme, asil_gonderim, belge_id, evrak_sonra, zincir, asama
FROM KRY_IZIN_TALEP
WHERE personel_kodu = @kod AND iptal = 0
ORDER BY olusturma DESC", new { kod }).ToList();

        var gerekliTurler = IzinEvrak.BelgeGerekliTurler(db);
        var evraklar = IzinEvrak.Evraklar(db, kayitlar.Select(x => (int)x.id));

        /* Süreçteki talep için şu an kimde beklediği: personel "müdürüm
           baktı mı" diye sormak zorunda kalmasın. Zincir organizasyon
           şemasından; bir kez hesaplanıyor, bütün talepler aynı kişiye ait. */
        var kendi = Kendisi();

        var (birim, ust, birimUnvan, ustUnvan) = kendi is null
            ? (new List<PersonelKaydi>(), new List<PersonelKaydi>(), (string)null, (string)null)
            : _orgOnay.Onaylayicilar(kod, kendi.Pozisyon, kendi.IsGrubu);

        string Adlar(List<PersonelKaydi> l) =>
            string.Join(", ", l.Take(3).Select(x => $"{x.Ad} {x.Soyad}".Trim()));

        return Ok(new
        {
            kayitlar = kayitlar.Select(k => new
            {
                k.id, k.tur, k.cikisTarihi, k.donusTarihi, k.gun, k.yarimGun,
                k.baslangicSaat, k.bitisSaat, k.saat, k.aciklama, k.durum, k.olusturma,
                k.magazaKarar, k.magazaNot, k.magazaKisi, k.magazaTarih,
                k.bolgeKarar, k.bolgeNot, k.bolgeKisi, k.bolgeTarih,
                k.ikKarar, k.ikNot, k.ikKisi, k.ikTarih,
                k.yerineAd, k.altTur,

                rapor = IzinEvrak.RaporluMu((string)k.tur),
                baslamaTarihi = (DateTime?)k.baslamaTarihi,
                evrak = (string)k.durum == Reddedildi || IzinEvrak.RaporluMu((string)k.tur) ? null
                    : IzinEvrak.Ozet(k, IzinEvrak.TalepBelgeGerekli(gerekliTurler, (string)k.tur, (string)k.altTur),
                        evraklar.GetValueOrDefault((int)k.id),
                        IzinEvrak.DestekAdi((string)k.tur, (string)k.altTur), k.formSarti == true),

                bekleyen = IzinOnayZinciri.Talepten((object)k) is { } zt
                    ? ((string)k.durum is Bekliyor or MagazaOnayli
                        ? string.Join(", ", IzinOnayZinciri.AdimAl(zt.Zincir, zt.Asama).Adlar.Take(3))
                        : null)
                    : (string)k.durum == Bekliyor ? Adlar(birim)
                    : (string)k.durum == MagazaOnayli ? Adlar(ust)
                    : null,

                /* 26.10.2026: zincirli talepte adımlar (2.0 "Talebim nerede" şeridi) */
                sira = IzinOnayZinciri.Talepten((object)k) is { } zs ? IzinOnayZinciri.MobilSira(zs.Zincir) : null,
            }),

            /* Ekranda aşama adları: kişiye göre "Mağaza Müdürü", "BT Müdürü" */
            birimYoneticisi = birimUnvan,
            ustYonetici = ustUnvan,
        });
    }

    /* ==================================================================== */
    /* Yerine bakacak kişi                                                  */
    /* ==================================================================== */

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>
    /// İzin süresince yerine bakabilecek kişiler. Departmanı tanımlı olan
    /// (genel merkez, depo) departmanından; diğerleri kendi iş yerinden
    /// (şubesinden) seçer. Kendisi listede yok.
    /// </summary>
    private List<PersonelKaydi> YerineAdaylari(PersonelKaydi ben, List<PersonelKaydi> aktif)
    {
        if (ben is null) return new();

        var k = K(ben.PersonelKodu);
        var h = _departman.Oku();
        var kodlar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (h.Tanimli(k))
        {
            kodlar.UnionWith(h.DepartmanArkadaslari(k));
            kodlar.UnionWith(h.Sorumlulari(k));
            kodlar.UnionWith(h.Yoneticileri(k));
        }
        else
        {
            var yer = (ben.IsGrubu ?? "").Trim();

            if (yer.Length > 0)
                kodlar.UnionWith(aktif
                    .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), yer, StringComparison.OrdinalIgnoreCase))
                    .Select(x => K(x.PersonelKodu)));
        }

        /* Ekibim'deki kişiler de aday: departman tanımı eksik kalmışsa ya da
           sicil yazımı farklıysa liste boş kalmasın. Ekibim de departmanı
           ve şubeyi aynı kurallarla süzüyor. */
        try
        {
            kodlar.UnionWith(_ekip.EkipArkadaslari(ben).Select(x => K(x.PersonelKodu)));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yerine bakacak adayları için ekip okunamadı");
        }

        kodlar.Remove(k);

        return aktif.Where(x => kodlar.Contains(K(x.PersonelKodu)))
            .GroupBy(x => K(x.PersonelKodu)).Select(g => g.First())
            .OrderBy(x => x.Ad).ThenBy(x => x.Soyad).ToList();
    }

    /// <summary>Talep ekranında "yerine bakacak kişi" seçenekleri.</summary>
    [HttpGet("YerineBakacaklar")]
    [Authorize(Roles = "Personel")]
    public IActionResult YerineBakacaklar()
    {
        var kod = PersonelKodu();

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var aktif = _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();
        var ben = aktif.FirstOrDefault(x => K(x.PersonelKodu) == K(kod));

        var kisiler = YerineAdaylari(ben, aktif).Select(x => new
        {
            sicil = (x.PersonelKodu ?? "").Trim(),
            adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
            pozisyon = x.Pozisyon
        });

        return Ok(new
        {
            kisiler,
            kaynak = ben is not null && _departman.Oku().Tanimli(ben.PersonelKodu) ? "departman" : "sube"
        });
    }

    /// <summary>Yeni talep oluşturur.</summary>
    [HttpPost]
    [Authorize(Roles = "Personel")]
    public Task<IActionResult> Olustur([FromBody] IzinTalepGirdi girdi) => OlusturIc(girdi, false);

    /// <summary>Saatlik izinde en fazla süre (23.10.2026)</summary>
    public const decimal SaatlikSinir = 3m;

    /// <summary>Raporun başlangıcı en fazla bu kadar gün geriye girilebilir</summary>
    public const int RaporGeriGun = 30;

    private async Task<IActionResult> OlusturIc(IzinTalepGirdi girdi, bool raporGirisi)
    {
        var kod = PersonelKodu();

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (girdi is null || girdi.DonusTarihi < girdi.CikisTarihi)
            return BadRequest(new { hata = "Tarih aralığını kontrol ediniz." });

        if (raporGirisi)
        {
            if (girdi.CikisTarihi.Date < DateTime.Now.Date.AddDays(-RaporGeriGun))
                return BadRequest(new { hata = $"Raporun başlangıcı en fazla {RaporGeriGun} gün önce olabilir." });
        }
        else if (girdi.CikisTarihi.Date < DateTime.Now.Date)
            return BadRequest(new
            {
                hata = "Geçmiş bir tarih için talep oluşturulamaz."
            });

        var ayar = _ayar.FormOku();

        List<string> izinliTurler;

        using (var dbTur = _vt.Baglanti())
        {
            var kayitlar = IzinTurleri(dbTur);

            izinliTurler = kayitlar.Count > 0
                ? kayitlar.Select(x => (string)x.ad).ToList()
                : ayar.TalepEdilebilirIzinler is { Count: > 0 }
                    ? ayar.TalepEdilebilirIzinler
                    : new List<string> { "Yıllık İzin" };
        }

        var tur = (girdi.Tur ?? "").Trim();

        if (!izinliTurler.Contains(tur))
            return BadRequest(new { hata = "Bu izin türü talep edilemiyor." });

        var raporlu = IzinEvrak.RaporluMu(tur);

        if (raporlu && !raporGirisi)
            return BadRequest(new
            {
                hata = "Raporlu izin rapor belgesiyle talep edilir.",
                ayrinti = "Biçen360'ı güncelleyip İzin Yönetimi › Yeni izin talebi › Raporlu'dan raporunuzu yükleyin.",
            });

        /* Saatlik izin en fazla 3 saat (23.10.2026); fazlası yıllık ya da ücretsiz izin */
        if (!string.IsNullOrWhiteSpace(girdi.BaslangicSaat))
        {
            decimal? sure = girdi.Saat;

            if (TimeSpan.TryParse(girdi.BaslangicSaat, out var bs) && TimeSpan.TryParse(girdi.BitisSaat ?? "", out var bt))
                sure = (decimal)Math.Round((bt - bs).TotalHours, 2);

            if (sure is null || sure <= 0)
                return BadRequest(new { hata = "Saatlik izinde başlangıç ve bitiş saatini seçiniz." });

            if (sure > SaatlikSinir)
                return BadRequest(new
                {
                    hata = $"Saatlik izin en fazla {SaatlikSinir:0} saat olabilir.",
                    ayrinti = "Daha uzun süre için yıllık izin ya da ücretsiz izin talep ediniz.",
                    kod = "saatSiniri",
                });

            girdi.Saat = sure;
        }

        /* Ücretsiz izinde sebep zorunlu: formdaki talep cümlesi bununla yazılıyor */
        if (IzinFormuServisi.FormTuru(tur, girdi.BaslangicSaat) == "ucretsiz"
            && string.IsNullOrWhiteSpace(girdi.Aciklama))
            return BadRequest(new { hata = "Ücretsiz izin sebebini yazınız." });

        /* Mazeret izni türü (07.10.2026): 1.6 seçtiriyor, 1.5 göndermiyor (kabul) */
        string altTur = null;

        if (IzinEvrak.MazeretMi(tur))
        {
            var liste = SecenekListesi.Tumu(IzinEvrak.MazeretListesi).Where(x => x.Acik).ToList();
            var istenen = (girdi.AltTur ?? "").Trim();

            if (istenen.Length > 0)
            {
                var oge = liste.FirstOrDefault(x => string.Equals(x.Ad, istenen, StringComparison.OrdinalIgnoreCase));

                if (oge is null)
                    return BadRequest(new { hata = "Mazeret türünü listeden seçiniz.", kod = "altTur" });

                if (oge.AciklamaZorunlu && (girdi.Aciklama ?? "").Trim().Length < 3)
                    return BadRequest(new { hata = $"\"{oge.Ad}\" seçtiğinizde açıklama yazmanız zorunludur.", kod = "altTur" });

                altTur = oge.Ad;
            }
            else if (liste.Count > 0 && Surum16())
            {
                return BadRequest(new { hata = "Mazeret türünü seçiniz.", kod = "altTur" });
            }
        }

        PersonelKaydi p;

        try
        {
            p = _personelKaynak.TumPersonelleriGetir()
                .FirstOrDefault(x =>
                    string.Equals((x.PersonelKodu ?? "").Trim(), kod,
                        StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            return StatusCode(503, new { hata = "Sistem şu anda yanıt vermiyor." });
        }

        if (p is null) return NotFound(new { hata = "Personel kaydı bulunamadı." });

        /* Vardiya planı denetimi (03.10.2026): talep edilen günlerde plan
           tanımlı değilse talep açılmıyor. Hata hata + ayrinti biçiminde:
           yayındaki uygulama ikisini "Gönderilemedi" uyarısında gösteriyor,
           uygulama güncellemesi gerekmiyor. Türler ve kapsam Yönetim →
           İzin Kuralları'ndan. */
        var tamGun = string.IsNullOrWhiteSpace(girdi.YarimGun) && string.IsNullOrWhiteSpace(girdi.BaslangicSaat);
        var sonIzinGunu = tamGun ? girdi.DonusTarihi.Date : girdi.CikisTarihi.Date;

        var vardiya = raporlu ? default : _izinGunu.VardiyaDenetle(p, tur, girdi.CikisTarihi.Date, sonIzinGunu, BirimSicilleri(p));

        if (!raporlu && vardiya.Engel)
            return BadRequest(new
            {
                hata = vardiya.Hata,
                ayrinti = vardiya.Ayrinti,
                kod = "vardiyaPlaniYok",
                eksikGunler = vardiya.EksikGunler,
            });

        /* Şube haftası (07.10.2026): bu haftanın şube planı tam değilse
           yıllık izin talebi açılmıyor (ileri tarihli de). Hata + ayrinti
           biçimi aynı: 1.5 de "Gönderilemedi" uyarısında gösteriyor. */
        var subeHaftasi = raporlu ? default : _izinGunu.SubeHaftaDenetle(p, tur, BirimKisileri(p));

        if (!raporlu && subeHaftasi.Engel)
            return BadRequest(new
            {
                hata = subeHaftasi.Hata,
                ayrinti = subeHaftasi.Ayrinti,
                kod = "subeHaftasiEksik",
            });

        /* Tam gün izinde gün sayısı sunucuda yeniden hesaplanıyor: uygulama
           önizlemeden aldığı sayıyı gönderiyor ama bakiye, izin formu ve
           onay ekranları talebe yazılan sayıyı kullanıyor; kural (resmi
           tatil, haftalık izin, cumartesi kuralı) tek yerden uygulanmalı. */
        List<string> gunNotlari = new();

        if (raporlu)
        {
            /* Raporda takvim günü: raporun kapsadığı günler */
            girdi.Gun = (decimal)(girdi.DonusTarihi.Date - girdi.CikisTarihi.Date).TotalDays + 1;
        }
        else if (tamGun)
        {
            var hesap = _izinGunu.Hesapla(p.Pozisyon, girdi.CikisTarihi.Date, sonIzinGunu.AddDays(1), p.PersonelKodu);

            girdi.Gun = hesap.Gun;
            gunNotlari = hesap.Notlar ?? new List<string>();
        }

        /* Yerine bakacak kişi isteğe bağlı; seçildiyse listedekilerden biri
           olmalı (şubesinden ya da departmanından). */
        PersonelKaydi yerine = null;

        if (!string.IsNullOrWhiteSpace(girdi.YerineKodu))
        {
            var aktif = _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

            yerine = YerineAdaylari(p, aktif).FirstOrDefault(x => K(x.PersonelKodu) == K(girdi.YerineKodu));

            if (yerine is null)
                return BadRequest(new { hata = "Yerine bakacak kişi şubenizden ya da departmanınızdan olmalı." });
        }

        using var db = _vt.Baglanti();

        /* Aynı tarihlerde bekleyen talep varsa ikincisi açılmaz:
           iki kez gönderilmiş talep onaylayanı yanıltıyor. */
        var cakisan = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_IZIN_TALEP
WHERE personel_kodu = @kod AND iptal = 0
  AND durum NOT IN (@red, @onay)
  AND cikis_tarihi <= @bit AND donus_tarihi >= @bas",
            new
            {
                kod,
                bas = girdi.CikisTarihi.Date,
                bit = girdi.DonusTarihi.Date,
                red = Reddedildi,
                onay = Onaylandi
            });

        if (cakisan > 0)
            return BadRequest(new
            {
                hata = "Bu tarihler için bekleyen bir talebiniz var.",
                ayrinti = "Sonuçlanmasını bekleyiniz ya da mevcut talebi iptal ediniz."
            });

        /* İzin kontenjanı (07.10.2026): şube × ay. Kişi başı aylık sınır
           ve ayın boşu; yetmezse talep açılmaz, en yakın boş aylar yazılır
           (1.5 de "Gönderilemedi" uyarısında hata + ayrinti gösteriyor).
           Ayar "İK onayına düşsün" ise talep açılır, günlüğe not düşülür. */
        var kontenjan = raporlu ? default : HttpContext.RequestServices.GetRequiredService<IzinKontenjanServisi>()
            .Denetle(p, tur, girdi.CikisTarihi.Date, sonIzinGunu, girdi.Gun);

        if (!raporlu && kontenjan.Engel)
            return BadRequest(new
            {
                hata = kontenjan.Hata,
                ayrinti = kontenjan.Ayrinti,
                kod = "kontenjan",
                oneriler = kontenjan.Oneriler,
            });

        /* Yıllık izinde bakiye denetimi. Aşım engellenmez, uyarı döner:
           avans izin verilebiliyor ve engellemek İK'yı sistemin dışına
           itiyor. Karar onaylayanlarındır. */
        string uyari = null;

        if (tur == "Yıllık İzin")
        {
            var bakiye = db.QueryFirstOrDefault(@"
SELECT baslangic, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod", new { kod });

            if (bakiye is null)
                uyari = "İzin hak edişiniz henüz sisteme girilmemiş.";
            else
            {
                var kullanilan = db.ExecuteScalar<decimal>(@"
SELECT ISNULL(SUM(gun), 0) FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1",
                    new { kod });

                var kalan = (decimal)bakiye.baslangic + (decimal)bakiye.devir
                            - (decimal)bakiye.aktarilan - kullanilan;

                if (girdi.Gun > kalan)
                    uyari = $"Kalan izniniz {kalan:0.#} gün; "
                            + $"{girdi.Gun:0.#} gün talep ettiniz.";
            }
        }

        /* Onay zinciri organizasyon şemasından: talep edenin kutusundan
           yukarı çıkılarak birim yöneticisi ve üst yönetici bulunuyor.

           Aşamada onaylayacak kimse yoksa aşama atlanıyor. Talebin sahipsiz
           kalıp "Bekliyor"da sonsuza kadar durması en kötü sonuç; atlama
           talebin üstüne açıkça yazılıyor ki İK neden eksik olduğunu görsün. */
        /* 26.10.2026: onay zinciri avans onay tablosundan (IzinOnayZinciri):
           kişi adımları tablodaki sırayla (birim yöneticisi → bölge müdürü /
           GMY…), İK sonda. Zincir talebe yazılıyor; kural yoksa eski akış. */
        IzinOnayZinciri.Zincir zincir = null;
        int zincirAdim = 0;

        try
        {
            zincir = _zincir.Olustur(p);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin onay zinciri kurulamadı, eski akışa düşüldü: {Kod}", kod);
        }

        List<PersonelKaydi> birim, ust;
        string baslangic;

        if (zincir is not null)
        {
            /* İlk karar verecek adım; onaylayanı olmayanlar atlanıyor (İK hiç atlanmaz) */
            zincirAdim = _zincir.Ilerle(zincir, -1, kod, p.IsGrubu) ?? zincir.Adimlar.Count - 1;
            baslangic = IzinOnayZinciri.Durum(zincir, zincirAdim);

            birim = Kisiler(zincir.Adimlar[0].Kodlar);
            ust = new List<PersonelKaydi>();
        }
        else
        {
            (birim, ust, _, _) = _orgOnay.Onaylayicilar(kod, p.Pozisyon, p.Sube);

            baslangic = birim.Count > 0 ? Bekliyor
                      : ust.Count > 0 ? MagazaOnayli
                      : BolgeOnayli;
        }

        /* İzin formunun gittiği yer ve şube personelinde imzalı form şartı
           (07.10.2026): form şube mailine gider, çıktısı imzalanıp
           uygulamadan yüklenmeden birim yöneticisi onaylayamaz. */
        string formHedefi;
        try { formHedefi = _form.FormHedefi(p); }
        catch { formHedefi = "sube"; }

        /* Raporluda form yok (23.10.2026): onaylayanlar raporu görüp onaylıyor */
        var formSarti = !raporlu && baslangic == Bekliyor && formHedefi == "sube";

        /* Genel merkez / depo personelinin kendi e-postası girildiyse form
           İK yerine ona gider; imzalı formu kendisi yükler, İK son onayda
           ayrıca evrak yüklemez (13.10.2026). */
        string kisiselEposta = null;
        if (formHedefi != "sube")
        {
            try { kisiselEposta = _form.KisiselEposta(p); }
            catch { kisiselEposta = null; }
        }

        if (kisiselEposta is not null) formHedefi = "kisisel";

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IZIN_TALEP
    (personel_kodu, ad_soyad, sube_adi, gorev, tur,
     cikis_tarihi, donus_tarihi, baslama_tarihi, gun,
     yarim_gun, baslangic_saat, bitis_saat, saat,
     aciklama, durum, yerine_kodu, yerine_ad, alt_tur, form_sarti, form_kisisel)
OUTPUT INSERTED.id
VALUES (@kod, @adSoyad, @subeAdi, @gorev, @tur,
        @cikis, @donus, @baslama, @gun,
        @yarimGun, @baslangicSaat, @bitisSaat, @saat,
        @aciklama, @durum, @yerineKodu, @yerineAd, @altTur, @formSarti, @formKisisel)",
            new
            {
                kod,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                subeAdi = p.Sube,
                gorev = p.Pozisyon,
                tur,
                cikis = girdi.CikisTarihi.Date,
                donus = girdi.DonusTarihi.Date,
                baslama = girdi.BaslamaTarihi?.Date,
                gun = girdi.Gun,
                yarimGun = girdi.YarimGun,
                baslangicSaat = girdi.BaslangicSaat,
                bitisSaat = girdi.BitisSaat,
                saat = girdi.Saat,
                aciklama = girdi.Aciklama,
                durum = baslangic,
                yerineKodu = yerine?.PersonelKodu?.Trim(),
                yerineAd = yerine is null ? null : $"{yerine.Ad} {yerine.Soyad}".Trim(),
                altTur,
                formSarti,
                formKisisel = kisiselEposta is not null,
            });

        var talepEden = $"{p.Ad} {p.Soyad}".Trim();

        IzinHareket.Yaz(db, id, IzinHareket.Olusturma, "Talep oluşturuldu",
            $"{tur}{(altTur is null ? "" : $" ({altTur})")} · {girdi.CikisTarihi:dd.MM.yyyy} – {girdi.DonusTarihi:dd.MM.yyyy} · {girdi.Gun:0.#} gün"
            + (string.IsNullOrWhiteSpace(girdi.Aciklama) ? "" : $" · {girdi.Aciklama.Trim()}"),
            talepEden, null, IzinHareket.Uygulama);

        if (!raporlu && kontenjan.IkOnayi)
            IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Kontenjan aşımı · İK onayı gerekiyor",
                kontenjan.Ayrinti, "Sistem", "İnsan Kaynakları", IzinHareket.Uygulama);

        IzinKontenjanServisi.Temizle();

        if (zincir is not null)
        {
            /* Zincir talebe yazılıyor; başta atlanan adımlar eski kolonlara ve günlüğe de */
            IzinOnayZinciri.Yaz(db, id, zincir, zincirAdim);
            AtlananlariIsle(db, id, zincir, -1, zincirAdim);

            IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Onay sırası",
                IzinOnayZinciri.Ozet(zincir) + $" (kural: {zincir.Kural})", "Sistem", null, IzinHareket.Uygulama);
        }
        else if (baslangic != Bekliyor)
        {
            db.Execute(@"
UPDATE KRY_IZIN_TALEP
SET magaza_karar = N'Atlandı', magaza_kisi = N'Sistem', magaza_tarih = SYSDATETIME(),
    magaza_not = N'Organizasyon şemasında bu kişinin birim yöneticisi yok; aşama atlandı.'
WHERE id = @id", new { id });

            IzinHareket.Yaz(db, id, IzinHareket.Karar, IzinHareket.KararBasligi("magaza", "Atlandı"),
                "Organizasyon şemasında bu kişinin birim yöneticisi yok.", "Sistem");
        }

        if (zincir is null && baslangic == BolgeOnayli)
        {
            db.Execute(@"
UPDATE KRY_IZIN_TALEP
SET bolge_karar = N'Atlandı', bolge_kisi = N'Sistem', bolge_tarih = SYSDATETIME(),
    bolge_not = N'Şubesi bir bölgeye bağlı değil ya da bölgenin müdürü tanımlı değil; aşama atlandı.'
WHERE id = @id", new { id });

            IzinHareket.Yaz(db, id, IzinHareket.Karar, IzinHareket.KararBasligi("bolge", "Atlandı"),
                "Şubesi bir bölgeye bağlı değil ya da bölgenin müdürü tanımlı değil.", "Sistem");
        }

        /* Mobildeki onaylayıcılara haber: talep hangi aşamaya düştüyse o
           aşamanın kişilerine. Bildirim gitmese de talep listede duruyor. */
        var yeniTalep = db.QueryFirstOrDefault(
            "SELECT * FROM KRY_IZIN_TALEP WHERE id = @id", new { id });

        /* Şube personelinde birim yöneticisine "onayınızı bekliyor" imzalı
           form yüklenince gidiyor (MazeretBelgeYukle): öncesinde onaylayamaz. */
        if (yeniTalep is not null && baslangic != BolgeOnayli)
            await MobilKademeyeHaberVer(yeniTalep, baslangic == Bekliyor ? 1 : 2);

        if (formSarti)
        {
            /* 09.10.2026: imzalı formu birim yöneticisi yükleyip onaylar */
            foreach (var y in birim) IzinYoneticiFormu.KartlariHazirla(db, _orgOnay, y);

            IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "İmzalı form bekleniyor",
                "Şube personeli: birim yöneticisi imzalı formu Biçen360'tan yüklemeden onaylayamaz.",
                "Sistem", null, IzinHareket.Uygulama);
        }

        /* Panel rollerine haber: onay bekleyen talep olduğunu bilmeli */
        var yeniMetin = $"{p.Ad} {p.Soyad} · {tur} · "
                        + $"{girdi.CikisTarihi:dd.MM} – {girdi.DonusTarihi:dd.MM}";

        await _bildirim.RoleGonder(
            new[] { Roller.BolgeMuduru, Roller.IK, Roller.IKYoneticisi },
            "Yeni izin talebi",
            yeniMetin,
            "izintalep");

        IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Yöneticilere ve İK'ya yeni talep bildirildi",
            $"Yeni izin talebi · {yeniMetin}", "Sistem",
            "Bölge müdürleri · İK · İK yöneticileri", IzinHareket.Uygulama);

        /* Doldurulmuş form şubeye / İK'ya mail olarak gider. Arka planda:
           SMTP yavaşsa personel uygulamada beklemesin; sonuç talebe
           yazılıyor, panelden görülüp yeniden gönderilebiliyor. */
        /* Evrak süresi: personel formu imzalatıp (destekleyici belgesiyle)
           3 gün içinde uygulamadan yükler; ana sayfasında kart çıkar. */
        if (raporlu)
            return Ok(new { basarili = true, id, uyari, gun = girdi.Gun, notlar = gunNotlari, evrak = (string)null, formSarti = false });

        db.Execute("UPDATE KRY_IZIN_TALEP SET mb_son = DATEADD(DAY, @gun, SYSDATETIME()) WHERE id = @id",
            new { id, gun = MazeretBelgeGorevi.SureGun });

        FormuArkaPlandaGonder(id);

        /* Cumartesi kuralının açıklaması: yayındaki uygulama başarı
           uyarısında yalnızca uyari ve evrak metnini gösteriyor; açıklama
           evrak metninin başına ekleniyor. */
        var cumartesiNotu = gunNotlari.Count > 0
            ? $"Bu talep {girdi.Gun:0.#} gün olarak kaydedildi. " + string.Join(" ", gunNotlari) + "\n\n"
            : "";

        return Ok(new
        {
            basarili = true,
            id,
            uyari,
            gun = girdi.Gun,
            notlar = gunNotlari,
            evrak = cumartesiNotu + EvrakMesaji(formHedefi, formSarti,
                IzinEvrak.TalepBelgeGerekli(IzinEvrak.BelgeGerekliTurler(db), tur, altTur),
                IzinEvrak.DestekAdi(tur, altTur)),
            formHedefi,
            formSarti,
        });
    }

    /// <summary>
    /// Talep sonrası evrak mesajı (07.10.2026): yayındaki uygulama da
    /// "Talebiniz gönderildi" uyarısında bu metni gösteriyor.
    /// </summary>
    private static string EvrakMesaji(string hedef, bool formSarti, bool belgeGerekli, string destekAdi)
    {
        var form = hedef switch
        {
            "merkez" => "İnsan Kaynakları mailine giden izin formunun çıktısını alarak imzalayınız.",
            "kisisel" => "İzin formu e-posta adresinize gönderildi; çıktısını alıp imzalayınız ve yöneticinize imzalatınız. İK'ya ayrıca göndermeniz gerekmez.",
            "depo" => "Depo müdürünüzün mailine giden izin formunun çıktısını alarak imzalayınız.",
            _ => "Şube mailinize gelen izin formunun çıktısını alıp imzalayınız.",
        };

        var yukle = formSarti
            ? " İmzalı formu birim yöneticinize teslim ediniz; yöneticiniz formu Biçen360'tan yükleyip talebinizi onaylar."
            : $" İmzalı formu {MazeretBelgeGorevi.SureGun} gün içinde ana sayfadaki karttan yükleyiniz.";

        var belge = belgeGerekli
            ? destekAdi == "Rapor belgesi"
                ? " Rapor belgenizi de aynı karttan ekleyiniz."
                : " Destekleyici belgenizi de aynı karttan ekleyiniz."
            : "";

        return form + yukle + belge;
    }

    /// <summary>Uygulama sürümü en az 1.6 mı (X-Uygulama-Surum başlığı)</summary>
    private bool Surum16()
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();
        if (string.IsNullOrWhiteSpace(ham)) return false;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return false;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a > 1 || (a == 1 && b >= 6);
    }

    /// <summary>Uygulama sürümü en az 1.9 mu (raporlu izin, rapor görüntüleme)</summary>
    private bool Surum19()
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();
        if (string.IsNullOrWhiteSpace(ham)) return false;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return false;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a > 1 || (a == 1 && b >= 9);
    }

    /// <summary>Uygulama sürümü en az 1.7 mı (İzin Onayları kartında form yükleme / görme)</summary>
    private bool Surum17()
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();
        if (string.IsNullOrWhiteSpace(ham)) return false;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return false;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a > 1 || (a == 1 && b >= 7);
    }

    /// <summary>Kişinin birimindeki aktif personel (şube haftası denetimi için)</summary>
    private List<PersonelKaydi> BirimKisileri(PersonelKaydi kisi)
    {
        try
        {
            var birim = (kisi?.IsGrubu ?? "").Trim();

            if (birim.Length == 0) return new List<PersonelKaydi>();

            return _ekip.Aktifler()
                .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), birim, StringComparison.OrdinalIgnoreCase))
                .ToList();
        }
        catch
        {
            return new List<PersonelKaydi>();
        }
    }

    private List<string> BirimSicilleri(PersonelKaydi kisi)
    {
        try
        {
            var birim = (kisi?.IsGrubu ?? "").Trim();

            if (birim.Length == 0) return new List<string>();

            return _ekip.Aktifler()
                .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), birim, StringComparison.OrdinalIgnoreCase))
                .Select(x => (x.PersonelKodu ?? "").Trim())
                .ToList();
        }
        catch
        {
            return new List<string>();
        }
    }

    private void FormuArkaPlandaGonder(int id)
    {
        var kapsam = _kapsam;
        var kayit = _kayit;

        _ = Task.Run(async () =>
        {
            try
            {
                using var k = kapsam.CreateScope();
                var form = k.ServiceProvider.GetRequiredService<IzinFormuServisi>();
                await form.GonderAsync(id);
            }
            catch (Exception hata)
            {
                kayit.LogError(hata, "İzin formu arka planda gönderilemedi: {Id}", id);
            }
        });
    }

    /* ==================================================================== */
    /* Basılı form                                                          */
    /* ==================================================================== */

    /// <summary>Doldurulmuş form (yazdırmak için). Panel kullanıcıları.</summary>
    [HttpGet("{id:int}/Form")]
    [Authorize]
    public IActionResult Form(int id)
    {
        if (Rol == "Personel") return Forbid();

        var html = _form.FormHtmlGetir(id);

        if (html is null) return NotFound(new { hata = "Talep bulunamadı." });

        return Content(html, "text/html; charset=utf-8");
    }

    private static readonly string[] BelgeUzantilari =
        { ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".doc", ".docx" };

    /// <summary>
    /// Dosyanın uzantısı; adında uzantı yoksa ya da tanınmıyorsa içerik
    /// türünden. Telefondan gelen dosyalarda ad çoğu zaman uzantısız ya da
    /// rastgele oluyor (galeri, kamera); yalnızca ada bakmak geçerli bir
    /// fotoğrafı "PDF, resim ya da Word yükleyiniz" diye reddediyordu.
    /// </summary>
    private static string BelgeUzantisi(IFormFile dosya)
    {
        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        if (BelgeUzantilari.Contains(uzanti)) return uzanti;

        var tip = (dosya.ContentType ?? "").ToLowerInvariant();

        return tip switch
        {
            "application/pdf" => ".pdf",
            "image/jpeg" or "image/jpg" or "image/pjpeg" => ".jpg",
            "image/png" => ".png",
            "image/heic" or "image/heif" => ".heic",
            "image/webp" => ".webp",
            "application/msword" => ".doc",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => ".docx",
            _ => BasliktanUzanti(dosya) ?? uzanti,
        };
    }

    /// <summary>İçerik türü de yoksa dosyanın ilk baytlarından (PDF, JPEG, PNG).</summary>
    private static string BasliktanUzanti(IFormFile dosya)
    {
        try
        {
            using var akis = dosya.OpenReadStream();
            var b = new byte[8];
            var n = akis.Read(b, 0, b.Length);

            if (n >= 4 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46) return ".pdf";
            if (n >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return ".jpg";
            if (n >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return ".png";
        }
        catch
        {
            /* Okunamazsa uzantısız kalır ve reddedilir */
        }

        return null;
    }

    /// <summary>
    /// Talebin belgesi (imzalı form, rapor, evlilik cüzdanı…). Son onayı
    /// verecek roller yükler; belge personelin belgelerine de kaydolur
    /// (personele kapalı), böylece personel kartında da görünür.
    /// </summary>
    [HttpPost("{id:int}/Belge")]
    [Authorize]
    [RequestSizeLimit(52_428_800)]
    public async Task<IActionResult> BelgeYukle(int id, [FromForm] string tur, IFormFile dosya)
    {
        var asama = AsamaRolu();

        if (asama is not ("ik" or "hepsi"))
            return StatusCode(403, new { hata = "Belge yükleme yetkiniz yok." });

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault(
            "SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

        var (belgeId, hata) = await BelgeKaydet(db, (object)talep, tur, dosya, Kullanici);

        if (hata is not null) return hata;

        db.Execute("UPDATE KRY_IZIN_TALEP SET belge_id = @belgeId, evrak_sonra = 0 WHERE id = @id", new { id, belgeId });

        db.Execute(@"
INSERT INTO KRY_IZIN_TALEP_EVRAK (talep_id, belge_id, kalem, tur, yukleyen)
VALUES (@id, @belgeId, @kalem, @tur, @yukleyen)",
            new { id, belgeId, kalem = IzinEvrak.Ik, tur = tur.Trim().Length > 60 ? tur.Trim()[..60] : tur.Trim(), yukleyen = Kullanici });

        IzinHareket.Yaz(db, id, IzinHareket.Evrak, $"İK evrakı yüklendi: {tur.Trim()}",
            dosya?.FileName, Kullanici, null, IzinHareket.Panel);

        return Ok(new { belgeId, tur = tur.Trim() });
    }

    /// <summary>
    /// Talebe ait belgeyi diske yazar ve personelin belgelerine kaydeder
    /// (personele kapalı). İK'nın son onaydaki belgesi ve personelin
    /// mazeret belgesi aynı yoldan geçer.
    /// </summary>
    private async Task<(int? belgeId, IActionResult hata)> BelgeKaydet(
        System.Data.IDbConnection db, object talepKaydi, string tur, IFormFile dosya, string yukleyen)
    {
        dynamic talep = talepKaydi;

        if (dosya is null || dosya.Length == 0)
            return (null, BadRequest(new { hata = "Dosya seçilmedi." }));

        if (string.IsNullOrWhiteSpace(tur))
            return (null, BadRequest(new { hata = "Belge türünü seçiniz." }));

        var uzanti = BelgeUzantisi(dosya);

        if (!BelgeUzantilari.Contains(uzanti))
            return (null, BadRequest(new
            {
                hata = "PDF, resim (JPG, PNG, HEIC) ya da Word dosyası yükleyiniz.",
                ayrinti = $"Gelen dosya: {dosya.FileName} ({dosya.ContentType})"
            }));

        int id = (int)talep.id;

        var kod = ((string)talep.personel_kodu ?? "").Trim();
        var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
        var diskAdi = $"{kod}_izin{id}_{Guid.NewGuid():N}{uzanti}";

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);
            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "İzin belgesi yazılamadı: {Klasor}", klasor);
            return (null, StatusCode(500, new { hata = $"Belge sunucuya yazılamadı ({klasor})." }));
        }

        string kimlik = null;

        try
        {
            kimlik = _personelKaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => K(x.PersonelKodu) == K(kod))?.KimlikNo?.Trim();
        }
        catch
        {
            /* Kimlik yoksa belge yalnızca personel koduyla eşleşir */
        }

        var cikis = (DateTime)talep.cikis_tarihi;
        var donus = (DateTime)talep.donus_tarihi;

        var belgeId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama,
     dosya, ozgun_ad, boyut, yukleyen, personele_acik)
OUTPUT INSERTED.id
VALUES (@kod, @kimlik, @adSoyad, @tur, @baslik, @aciklama,
        @diskAdi, @ozgunAd, @boyut, @yukleyen, 0)",
            new
            {
                kod,
                kimlik = string.IsNullOrWhiteSpace(kimlik) ? null : kimlik,
                adSoyad = (string)talep.ad_soyad,
                tur = tur.Trim().Length > 40 ? tur.Trim()[..40] : tur.Trim(),
                baslik = $"{(string)talep.tur} · {cikis:dd.MM.yyyy}"
                         + (donus.Date != cikis.Date ? $" – {donus:dd.MM.yyyy}" : ""),
                aciklama = $"İzin talebi #{id}",
                diskAdi,
                ozgunAd = dosya.FileName,
                boyut = dosya.Length,
                yukleyen
            });

        return (belgeId, null);
    }

    /// <summary>Talebin belgesini indirir / gösterir.</summary>
    [HttpGet("{id:int}/Belge")]
    [Authorize]
    public IActionResult BelgeIndir(int id) => TalepBelgesi(id, "belge_id");

    /// <summary>Personelin uygulamadan yüklediği mazeret belgesini gösterir (panel).</summary>
    [HttpGet("{id:int}/MazeretBelge")]
    [Authorize]
    public IActionResult MazeretBelgeIndir(int id) => TalepBelgesi(id, "mb_belge_id");

    private IActionResult TalepBelgesi(int id, string kolon)
    {
        if (Rol == "Personel" || string.IsNullOrWhiteSpace(AsamaRolu())) return Forbid();

        using var db = _vt.Baglanti();

        /* kolon yalnızca iki sabit değerden biri; dışarıdan gelmiyor */
        var belge = db.QueryFirstOrDefault($@"
SELECT b.dosya, b.ozgun_ad AS ozgunAd
FROM KRY_IZIN_TALEP t
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = t.{(kolon == "mb_belge_id" ? "mb_belge_id" : "belge_id")} AND b.silindi = 0
WHERE t.id = @id", new { id });

        return DosyaDondur((string)belge?.dosya, (string)belge?.ozgunAd);
    }

    private IActionResult DosyaDondur(string dosyaAdi, string ozgunAd)
    {
        dosyaAdi ??= "";

        if (dosyaAdi.Length == 0 || dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return NotFound(new { hata = "Belge bulunamadı." });

        var yol = BelgeKlasoru.Bul(_yapilandirma, _ortam, dosyaAdi);

        if (yol is null) return NotFound(new { hata = "Belge dosyası sunucuda bulunamadı." });

        var tip = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".heic" or ".heif" => "image/heic",
            ".webp" => "image/webp",
            ".doc" => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            _ => "application/octet-stream"
        };

        return PhysicalFile(yol, tip, ozgunAd ?? dosyaAdi);
    }

    /* ====================================================================== */
    /* Mazeret izni belgesi (personel uygulamadan yükler)                     */
    /* ====================================================================== */

    /// <summary>Fazla mesai imzalı form yüklemesi için aynı istek bağlamında FazlaMesaiController (09.10.2026)</summary>
    private FazlaMesaiController FazlaMesaiKoprusu()
    {
        var c = ActivatorUtilities.CreateInstance<FazlaMesaiController>(HttpContext.RequestServices);
        c.ControllerContext = ControllerContext;
        return c;
    }

    /// <summary>Avans belge yüklemesi için aynı istek bağlamında AvansController (09.10.2026)</summary>
    private AvansController AvansKoprusu()
    {
        var c = ActivatorUtilities.CreateInstance<AvansController>(HttpContext.RequestServices);
        c.ControllerContext = ControllerContext;
        return c;
    }

    /// <summary>
    /// Personel, onaylanmış mazeret izninin belgesini yükler. Süre (3 gün)
    /// dolmuş olsa da kabul edilir: geç de olsa belgenin gelmesi gerekiyor;
    /// gecikme yöneticiye ve İK'ya zaten bildirilmiş oluyor.
    /// </summary>
    [HttpPost("{id:int}/MazeretBelge")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(52_428_800)]
    public async Task<IActionResult> MazeretBelgeYukle(int id, [FromForm] string tur, [FromForm] string kalem, IFormFile dosya)
    {
        /* Eksi kimlik = avans belgesi (09.10.2026): 1.6'nın evrak penceresi
           avans kartında da açılıyor ve buraya yüklüyor. */
        /* Fazla mesai imzalı formu (09.10.2026): bölge müdürü ana sayfa kartından */
        if (FazlaMesaiAkisi.KayitKimligi(id) is int fmId) return await FazlaMesaiKoprusu().BolgeFormYukleIc(fmId, dosya);
        if (id < 0) return await AvansKoprusu().BelgeYukleIc(-id, dosya, tur);

        var kod = PersonelKodu();

        if (string.IsNullOrWhiteSpace(kod))
            return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault(
            "SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

        /* 09.10.2026: form şartlı talepte imzalı formu birim yöneticisi yükler
           (1.6 ana sayfa kartı / 1.7 İzin Onayları kartı) */
        PersonelKaydi yonetici = null;

        if (K((string)talep.personel_kodu) != K(kod))
        {
            var ben = _ekip.Kisi(kod);

            if (talep.form_sarti != true || (string)talep.durum != Bekliyor || !IzinYoneticiFormu.BirimYoneticisiMi(_orgOnay, ben, talep))
                return NotFound(new { hata = "Talep bulunamadı ya da formu yükleme sırası sizde değil." });

            yonetici = ben;
            kalem = IzinEvrak.Form;
            tur = "İmzalı izin formu";
        }

        if ((string)talep.durum == Reddedildi)
            return BadRequest(new { hata = "Reddedilen talep için evrak yüklenmez." });

        var altTur = (string)talep.alt_tur;
        var belgeGerekli = IzinEvrak.TalepBelgeGerekli(IzinEvrak.BelgeGerekliTurler(db), (string)talep.tur, altTur);
        var formSarti = talep.form_sarti == true;
        var oncekiEvrak = IzinEvrak.Evraklar(db, new[] { id }).GetValueOrDefault(id) ?? new();
        var formOnceVardi = IzinEvrak.FormYuklendi(oncekiEvrak);

        /* Eski sürüm kalem göndermiyor: form şartı varsa ilk yükleme form;
           yoksa belge istenen türde destek, diğerinde form */
        kalem = (kalem ?? "").Trim().ToLowerInvariant();
        if (kalem is not (IzinEvrak.Form or IzinEvrak.Destek))
            kalem = yonetici is null && formSarti ? IzinEvrak.Destek
                  : formSarti && !formOnceVardi ? IzinEvrak.Form
                  : belgeGerekli && !oncekiEvrak.Any(e => e.Kalem == IzinEvrak.Destek) ? IzinEvrak.Destek
                  : IzinEvrak.Form;

        /* Form şartlı talepte imzalı formu personel değil birim yöneticisi yükler */
        if (yonetici is null && formSarti && kalem == IzinEvrak.Form && (string)talep.durum == Bekliyor)
            return BadRequest(new { hata = "İmzalı izin formunu birim yöneticiniz yükler; formu imzalayıp yöneticinize teslim edin." });

        if (string.IsNullOrWhiteSpace(tur))
            tur = kalem == IzinEvrak.Form ? "İmzalı izin formu" : "Destekleyici belge";

        var yukleyenAd = yonetici is null ? (string)talep.ad_soyad : $"{yonetici.Ad} {yonetici.Soyad}".Trim();

        var (belgeId, hata) = await BelgeKaydet(db, (object)talep, tur, dosya,
            yonetici is null ? $"personel:{kod}" : $"yonetici:{kod}");

        if (hata is not null) return hata;

        db.Execute(@"
INSERT INTO KRY_IZIN_TALEP_EVRAK (talep_id, belge_id, kalem, tur, yukleyen)
VALUES (@id, @belgeId, @kalem, @tur, @yukleyen)",
            new { id, belgeId, kalem, tur = tur.Trim().Length > 60 ? tur.Trim()[..60] : tur.Trim(), yukleyen = yukleyenAd });

        IzinHareket.Yaz(db, id, IzinHareket.Evrak,
            yonetici is null ? $"Personel evrakı yüklendi: {tur.Trim()}" : "Birim yöneticisi imzalı izin formunu yükledi",
            dosya?.FileName, yukleyenAd, null, IzinHareket.Uygulama);

        /* Form personelin kendi e-postasına gittiyse (genel merkez / depo,
           13.10.2026) yüklediği imzalı form İK evrakı da sayılır: İK son
           onayda ayrıca belge yüklemez, aslı da istenmez. */
        if (yonetici is null && kalem == IzinEvrak.Form && talep.form_kisisel == true && talep.belge_id is null)
        {
            db.Execute("UPDATE KRY_IZIN_TALEP SET belge_id = @belgeId WHERE id = @id AND belge_id IS NULL",
                new { id, belgeId });

            IzinHareket.Yaz(db, id, IzinHareket.Evrak,
                "İmzalı form personel tarafından yüklendi · İK evrakı olarak kaydedildi",
                null, (string)talep.ad_soyad, null, IzinHareket.Uygulama);
        }

        if (yonetici is not null)
        {
            IzinYoneticiFormu.KartlariKapat(db, id, $"İmzalı form yüklendi · {yukleyenAd}");
            formOnceVardi = true; /* yöneticiye "onayınızı bekliyor" yeniden gitmesin */
        }

        var evraklar = IzinEvrak.Evraklar(db, new[] { id }).GetValueOrDefault(id) ?? new();
        var tamam = IzinEvrak.PersonelTamam(belgeGerekli, evraklar);

        /* İmzalı form şartı (şube personeli): form ilk kez geldiyse birim
           yöneticisine "onayınızı bekliyor" bildirimi şimdi gidiyor */
        if (formSarti && !formOnceVardi && kalem == IzinEvrak.Form && (string)talep.durum == Bekliyor)
        {
            IzinHareket.Yaz(db, id, IzinHareket.Evrak, "İmzalı form yüklendi · birim yöneticisi onaylayabilir",
                null, (string)talep.ad_soyad, null, IzinHareket.Uygulama);

            await MobilKademeyeHaberVer(talep, 1);
        }

        /* İK'nın eksik bildirdiği talepse "tamamlandı"ya geçer; İK kontrol edip kapatır.
           Yöneticinin eksik bildirdiği talepte (26.10.2026) haber yöneticiye gider;
           talep onun kartında bekliyor. */
        var yoneticiEksikleri = YoneticiEksik.AcikYoneticiKayitlari(db, TalepEksik.Izin, id);

        if (TalepEksik.PersonelTamamladi(db, TalepEksik.Izin, id, $"Evrak yüklendi: {tur.Trim()}") > 0)
        {
            if (yoneticiEksikleri.Count > 0)
            {
                string talepOzeti = YoneticiEksik.IzinOzeti(talep);

                await YoneticiEksik.YoneticiyeHaberVer(db, _bildirim, TalepEksik.Izin, id, (string)talep.ad_soyad,
                    talepOzeti, $"{tur.Trim()} yüklendi", yoneticiEksikleri);

                IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Eksik bildirimi: personel evrakı yükledi",
                    tur.Trim(), (string)talep.ad_soyad, yoneticiEksikleri[0].GonderenAd, IzinHareket.Uygulama);
            }
            else
            {
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Eksik evrak yüklendi",
                    $"{talep.ad_soyad} · {talep.tur}: {tur.Trim()} yüklendi.", "izintalep");

                IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Eksik bildirimi: personel evrakı yükledi",
                    tur.Trim(), (string)talep.ad_soyad, "İnsan Kaynakları", IzinHareket.Uygulama);
            }
        }

        if (tamam && talep.mb_yukleme is null)
        {
            db.Execute(@"
UPDATE KRY_IZIN_TALEP SET mb_belge_id = @belgeId, mb_yukleme = SYSDATETIME(),
       mb_son = COALESCE(mb_son, SYSDATETIME())
WHERE id = @id", new { id, belgeId });

            /* Yönetici gecikme bildirimini aldıysa evrakın geldiğini de öğrensin */
            if (talep.mb_yonetici_bildirim is not null)
            {
                try
                {
                    var yoneticiler = MazeretBelgeGorevi.Yoneticileri(_ekip, _departman, kod);
                    var yuklendiMetni =
                        $"{talep.ad_soyad} {((string)talep.tur).ToLower(new System.Globalization.CultureInfo("tr-TR"))} evrakını yükledi.";

                    await _bildirim.TopluGonder(yoneticiler, "İzin evrakı yüklendi", yuklendiMetni, "ekibim");

                    IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Yöneticiye evrakın geldiği bildirildi",
                        yuklendiMetni, "Sistem", Adlar(yoneticiler), IzinHareket.Uygulama);
                }
                catch (Exception h)
                {
                    _kayit.LogWarning(h, "Evrak yüklendi bildirimi gönderilemedi");
                }
            }
        }

        return Ok(new { belgeId, kalem, tamam });
    }

    /* ====================================================================== */
    /* Raporlu izin (23.10.2026)                                              */
    /* ====================================================================== */

    /// <summary>
    /// Raporlu izin talebi: rapor belgesi ve tarihler tek istekte. Önce
    /// dosya denetlenir, talep açılır, rapor talebe kaydedilir; rapor
    /// yazılamazsa talep geri alınır (belgesiz raporlu talep kalmasın).
    /// İzin formu ve mail yok; onaylayanlar (avans onay tablosundaki sıra:
    /// mağaza müdürü → bölge müdürü → İK) raporu görüp onaylıyor.
    /// </summary>
    [HttpPost("Rapor")]
    [Authorize(Roles = "Personel")]
    [RequestSizeLimit(52_428_800)]
    public async Task<IActionResult> RaporluOlustur(
        [FromForm] DateTime baslangic, [FromForm] DateTime bitis, [FromForm] DateTime iseBaslama,
        [FromForm] string aciklama, IFormFile dosya)
    {
        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Rapor belgesini ekleyiniz." });

        if (!BelgeUzantilari.Contains(BelgeUzantisi(dosya)))
            return BadRequest(new { hata = "Raporun fotoğrafını ya da PDF'ini yükleyiniz." });

        if (bitis.Date < baslangic.Date)
            return BadRequest(new { hata = "Rapor bitiş tarihi başlangıçtan önce olamaz." });

        if ((bitis.Date - baslangic.Date).TotalDays > 180)
            return BadRequest(new { hata = "Rapor süresi 180 günden uzun olamaz; tarihleri kontrol ediniz." });

        if (iseBaslama.Date <= bitis.Date)
            return BadRequest(new { hata = "İşe başlama tarihi raporun bitişinden sonra olmalı." });

        if ((iseBaslama.Date - bitis.Date).TotalDays > 15)
            return BadRequest(new { hata = "İşe başlama tarihi raporun bitişinden en fazla 15 gün sonra olabilir." });

        string tur;
        using (var dbt = _vt.Baglanti())
            tur = IzinTurleri(dbt).Select(x => (string)x.ad).FirstOrDefault(IzinEvrak.RaporluMu);

        if (tur is null)
            return BadRequest(new { hata = "Raporlu izin türü tanımlı değil; İnsan Kaynakları ile görüşünüz." });

        var not = (aciklama ?? "").Trim();
        if (not.Length > 500) not = not[..500];

        var sonuc = await OlusturIc(new IzinTalepGirdi
        {
            Tur = tur,
            CikisTarihi = baslangic.Date,
            DonusTarihi = bitis.Date,
            BaslamaTarihi = iseBaslama.Date,
            Aciklama = not.Length == 0 ? null : not,
        }, true);

        if (sonuc is not ObjectResult or || (or.StatusCode ?? 200) >= 400 || or.Value is null)
            return sonuc;

        var id = (int)(or.Value.GetType().GetProperty("id")?.GetValue(or.Value) ?? 0);
        if (id <= 0) return sonuc;

        using var db = _vt.Baglanti();
        var talep = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id", new { id });

        var (belgeId, hata) = await BelgeKaydet(db, (object)talep, IzinEvrak.RaporEvrakTuru, dosya, $"personel:{PersonelKodu()}");

        if (hata is not null)
        {
            db.Execute("UPDATE KRY_IZIN_TALEP SET iptal = 1 WHERE id = @id", new { id });
        RaporKaydiniKaldir(db, id, "Talep iptal edildi");
            IzinHareket.Yaz(db, id, IzinHareket.Evrak, "Rapor yüklenemedi · talep geri alındı", null, "Sistem");
            return hata;
        }

        db.Execute(@"
INSERT INTO KRY_IZIN_TALEP_EVRAK (talep_id, belge_id, kalem, tur, yukleyen)
VALUES (@id, @belgeId, @kalem, @tur, @yukleyen);
UPDATE KRY_IZIN_TALEP SET mb_belge_id = @belgeId, mb_yukleme = SYSDATETIME() WHERE id = @id;",
            new { id, belgeId, kalem = IzinEvrak.Destek, tur = IzinEvrak.RaporEvrakTuru, yukleyen = (string)talep.ad_soyad });

        /* Personel kartının Raporlar bölümüne ve raporlu listesine
           (23.10.2026): rapor girildiği anda, tarih aralığıyla. Talep
           reddedilir ya da iptal edilirse kayıt da kalkar. */
        try
        {
            string kimlik = null;
            try
            {
                kimlik = _personelKaynak.TumPersonelleriGetir()
                    .FirstOrDefault(x => K(x.PersonelKodu) == K((string)talep.personel_kodu))?.KimlikNo?.Trim();
            }
            catch { }

            db.Execute(@"
INSERT INTO KRY_PERSONEL_RAPOR (personel_kodu, kimlik_no, ad_soyad, baslangic, bitis, aciklama, belge_id, olusturan, izin_talep_id)
VALUES (@kod, @kimlik, @ad, @bas, @bit, @aciklama, @belgeId, @olusturan, @id)",
                new
                {
                    kod = ((string)talep.personel_kodu).Trim(),
                    kimlik = string.IsNullOrWhiteSpace(kimlik) ? null : kimlik,
                    ad = (string)talep.ad_soyad,
                    bas = baslangic.Date,
                    bit = bitis.Date,
                    aciklama = $"Biçen360 raporlu izin talebi #{id}" + (not.Length > 0 ? $" · {not}" : ""),
                    belgeId,
                    olusturan = $"{(string)talep.ad_soyad} (Biçen360)",
                    id,
                });
            RaporluServisi.Temizle();
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Raporlu talep personel kartına yazılamadı: {Id}", id);
        }

        IzinHareket.Yaz(db, id, IzinHareket.Evrak, "Rapor yüklendi",
            $"Rapor {baslangic:dd.MM.yyyy} – {bitis:dd.MM.yyyy} · işe başlama {iseBaslama:dd.MM.yyyy} · {dosya.FileName}",
            (string)talep.ad_soyad, null, IzinHareket.Uygulama);

        var sira = new List<string>();

        if (IzinOnayZinciri.Talepten((object)talep) is { } zt)
        {
            /* 26.10.2026: zincirdeki (atlanmamış) adımlar */
            sira.AddRange(zt.Zincir.Adimlar.Where(a => a.Karar != IzinOnayZinciri.KararAtlandi).Select(a => a.Ad));
        }
        else
        {
            var (birim, ust, birimUnvan, ustUnvan) = _orgOnay.Onaylayicilar(
                (string)talep.personel_kodu, (string)talep.gorev, (string)talep.sube_adi);

            if (birim.Count > 0) sira.Add(birimUnvan ?? "Yöneticiniz");
            if (ust.Count > 0) sira.Add(ustUnvan ?? "Üst yöneticiniz");
            sira.Add("İnsan Kaynakları");
        }

        return Ok(new
        {
            basarili = true,
            id,
            gun = (decimal)talep.gun,
            mesaj = $"Raporunuz {string.Join(" → ", sira)} onayına gönderildi.",
        });
    }

    /// <summary>
    /// Raporlu talebin raporu. Personel kendi talebinin; onay sırasındaki
    /// yönetici (mağaza müdürü, bölge müdürü) ve panel kullanıcıları
    /// açabilir. Telefon tarayıcısında açıldığı için belirteç ?t= ile gelir.
    /// </summary>
    [HttpGet("{id:int}/Rapor")]
    [Authorize]
    public IActionResult RaporGoster(int id)
    {
        using var db = _vt.Baglanti();

        var t = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });
        if (t is null) return NotFound(new { hata = "Talep bulunamadı." });

        if (Rol == "Personel")
        {
            var kod = PersonelKodu();
            var kendi = K((string)t.personel_kodu) == K(kod);

            if (!kendi)
            {
                var asama = Asama((string)t.durum);
                var yetkili = asama > 0 && _orgOnay.KararVerebilir(kod, (string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi, asama);

                /* Zincirli talep (26.10.2026): zincirin herhangi bir kişi adımındaki onaylayan */
                if (!yetkili && IzinOnayZinciri.Talepten((object)t) is { } zt)
                    yetkili = IzinOnayZinciri.ZincirdeMi(zt.Zincir, kod);

                /* Önceki aşamada onaylamış yönetici de açabilsin */
                if (!yetkili)
                {
                    var (birim, ust, _, _) = _orgOnay.Onaylayicilar((string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi);
                    yetkili = birim.Concat(ust).Any(x => K(x.PersonelKodu) == K(kod));
                }

                /* 26.10.2026: talepte karar vermiş yönetici (şema sonradan değişse de) */
                if (!yetkili) yetkili = IzinYoneticiFormu.KararVermisMi(_ekip.Kisi(kod), t);

                if (!yetkili) return NotFound(new { hata = "Talep bulunamadı." });
            }
        }
        else if (string.IsNullOrWhiteSpace(AsamaRolu()))
            return Forbid();

        var b = db.QueryFirstOrDefault(@"
SELECT TOP 1 b.dosya, b.ozgun_ad AS ozgunAd FROM KRY_IZIN_TALEP_EVRAK e
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = e.belge_id AND b.silindi = 0
WHERE e.talep_id = @id AND e.kalem = N'destek'
ORDER BY e.olusturma DESC", new { id });

        if (b is null) return NotFound(new { hata = "Rapor henüz yüklenmedi." });

        var dosyaAdi = (string)b.dosya ?? "";
        if (dosyaAdi.Length == 0 || dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return NotFound(new { hata = "Rapor bulunamadı." });

        var yol = BelgeKlasoru.Bul(_yapilandirma, _ortam, dosyaAdi);
        if (yol is null) return NotFound(new { hata = "Rapor dosyası sunucuda bulunamadı." });

        var tip = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".heic" or ".heif" => "image/heic",
            ".webp" => "image/webp",
            _ => "application/octet-stream",
        };

        /* Telefon tarayıcısında satır içi açılsın (dosya adı verilmiyor) */
        return PhysicalFile(yol, tip);
    }

    /// <summary>Raporlu talep reddedilince ya da iptal edilince personel kartındaki rapor kaydı kalkar</summary>
    private static void RaporKaydiniKaldir(System.Data.IDbConnection db, int id, string neden)
    {
        try
        {
            if (db.Execute(@"
UPDATE KRY_PERSONEL_RAPOR SET iptal = 1, guncelleyen = @neden, guncelleme = SYSDATETIME()
WHERE izin_talep_id = @id AND iptal = 0", new { id, neden }) > 0)
                RaporluServisi.Temizle();
        }
        catch
        {
            /* sütun yoksa raporlu talep kaydı da yok */
        }
    }

    /// <summary>Raporlu talebin raporu yüklenmiş mi</summary>
    private static bool RaporVar(System.Data.IDbConnection db, int id) =>
        db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_IZIN_TALEP_EVRAK e
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = e.belge_id AND b.silindi = 0
WHERE e.talep_id = @id AND e.kalem = N'destek'", new { id }) > 0;

    /// <summary>
    /// Personel ıslak imzalı aslını İK'ya gönderdiğini işaretler (kargo,
    /// elden, şube çantası). İK panelinde "aslı yolda" görünür.
    /// </summary>
    [HttpPost("{id:int}/AsilGonderildi")]
    [Authorize(Roles = "Personel")]
    public IActionResult AsilGonderildi(int id)
    {
        /* Avansta asıl istenmiyor (eksi kimlik, 1.6 evrak penceresi) */
        if (id < 0) return Ok(new { basarili = true });

        var kod = PersonelKodu();

        using var db = _vt.Baglanti();

        var t = db.QueryFirstOrDefault(
            "SELECT personel_kodu, ad_soyad FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

        if (t is null || K((string)t.personel_kodu) != K(kod))
            return NotFound(new { hata = "Talep bulunamadı." });

        /* İkinci basışta zaman değişmiyor; günlüğe de yalnızca ilki yazılıyor */
        var ilk = db.Execute(
            "UPDATE KRY_IZIN_TALEP SET asil_gonderim = SYSDATETIME() WHERE id = @id AND asil_gonderim IS NULL",
            new { id }) > 0;

        if (ilk)
            IzinHareket.Yaz(db, id, IzinHareket.Asil, "Islak imzalı aslı İK'ya gönderildi",
                "Personel gönderdiğini uygulamadan bildirdi.", (string)t.ad_soyad, "İnsan Kaynakları",
                IzinHareket.Uygulama);

        TalepEksik.PersonelTamamladi(db, TalepEksik.Izin, id, "Islak imzalı aslını gönderdiğini bildirdi");

        return Ok(new { tamam = true });
    }

    /// <summary>
    /// Yüklenen imzalı izin formu (09.10.2026): personel, birim yöneticisi ve
    /// bölge müdürü (onaylarken) açar; panel kullanıcıları hepsini. Telefon
    /// tarayıcısında açıldığı için belirteç ?t= ile gelir.
    /// </summary>
    [HttpGet("{id:int}/ImzaliForm")]
    [Authorize]
    public IActionResult ImzaliForm(int id)
    {
        using var db = _vt.Baglanti();

        var t = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });
        if (t is null) return NotFound(new { hata = "Talep bulunamadı." });

        if (Rol == "Personel" && !IzinYoneticiFormu.FormGorebilir(_orgOnay, _ekip.Kisi(PersonelKodu()), t))
            return NotFound(new { hata = "Talep bulunamadı." });

        var b = db.QueryFirstOrDefault(@"
SELECT TOP 1 b.dosya FROM KRY_IZIN_TALEP_EVRAK e
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = e.belge_id AND b.silindi = 0
WHERE e.talep_id = @id AND e.kalem = N'form'
ORDER BY e.olusturma DESC", new { id });

        var dosyaAdi = (string)b?.dosya ?? "";
        if (dosyaAdi.Length == 0 || dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return NotFound(new { hata = "İmzalı form henüz yüklenmedi." });

        var yol = BelgeKlasoru.Bul(_yapilandirma, _ortam, dosyaAdi);
        if (yol is null) return NotFound(new { hata = "Form dosyası sunucuda bulunamadı." });

        var tip = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".pdf" => "application/pdf",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".png" => "image/png",
            ".heic" or ".heif" => "image/heic",
            ".webp" => "image/webp",
            _ => "application/octet-stream",
        };

        return PhysicalFile(yol, tip);
    }

    /// <summary>
    /// Doldurulmuş izin formu (PDF; sunucuda tarayıcı yoksa HTML). Personel
    /// kendi talebininkini, panel kullanıcıları hepsini açabilir. Personel
    /// formu şubeye gelmeden de telefondan açıp yazdırabilsin diye.
    /// </summary>
    [HttpGet("{id:int}/FormDosya")]
    [Authorize]
    public async Task<IActionResult> FormDosya(int id)
    {
        /* Fazla mesai formu (09.10.2026): bölge müdürünün kartındaki "Formu aç" */
        if (FazlaMesaiAkisi.KayitKimligi(id) is int fmId)
        {
            using var dbf = _vt.Baglanti();
            var r = dbf.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @fmId", new { fmId });
            if (r is null) return NotFound(new { hata = "Kayıt bulunamadı." });

            if (Rol == "Personel")
            {
                var kisi = _ekip.Kisi(PersonelKodu());
                string sube = (string)r.onay_sube ?? (string)r.sube;
                var izinli = kisi is not null
                             && (K((string)r.talep_eden) == K(kisi.PersonelKodu)
                                 || _orgOnay.KararVerebilir(kisi.PersonelKodu, (string)r.personel_kodu, (string)r.gorev, sube, 2));
                if (!izinli) return NotFound(new { hata = "Kayıt bulunamadı." });
            }

            var fmHtml = _form.FazlaMesaiFormHtmlGetir(fmId);
            return fmHtml is null ? NotFound(new { hata = "Kayıt bulunamadı." }) : Content(fmHtml, "text/html; charset=utf-8");
        }

        /* Avans kartında 1.6 penceresinin "Formu aç" bağlantısı: avansta
           yazdırılacak form yok, yalnızca belge yükleniyor. */
        if (id < 0)
            return Content("""
<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Avans talebi</title></head><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.5;color:#1f2933">
<h2 style="margin:0 0 8px">Avans talebinde form gerekmiyor</h2>
<p>Yazdırmanız ya da imzalatmanız gereken bir form yok. Uygulamaya dönüp <b>belgenizi yükleyin</b>; belge gelince talebiniz onaya gider.</p>
</body></html>
""", "text/html; charset=utf-8");

        if (Rol == "Personel")
        {
            using var db = _vt.Baglanti();

            var t = db.QueryFirstOrDefault(
                "SELECT personel_kodu FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

            if (t is null || K((string)t.personel_kodu) != K(PersonelKodu()))
                return NotFound(new { hata = "Talep bulunamadı." });
        }
        else if (string.IsNullOrWhiteSpace(AsamaRolu()))
            return Forbid();

        var html = _form.FormHtmlGetir(id);

        if (html is null) return NotFound(new { hata = "Talep bulunamadı." });

        var (pdf, _) = await TarayiciPdf.DonusturAsync(html, _yapilandirma, _kayit);

        return pdf is not null
            ? File(pdf, "application/pdf", $"izin-formu-{id}.pdf")
            : Content(html, "text/html; charset=utf-8");
    }

    /// <summary>
    /// Talebin bir evrak dosyasını gösterir (panel). 26.10.2026: Biçen360'tan
    /// da açılıyor; personel kendi talebinin, onay zincirindeki ya da karar
    /// vermiş yönetici sorumlu olduğu talebin evrakını (telefon
    /// tarayıcısında ?t= belirteciyle). Sayfa içi açılsın diye dosya adı
    /// verilmiyor.
    /// </summary>
    [HttpGet("{id:int}/Evrak/{belgeId:int}")]
    [Authorize]
    public IActionResult EvrakGoster(int id, int belgeId)
    {
        using var db = _vt.Baglanti();

        if (Rol == "Personel")
        {
            var t = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

            if (t is null || !IzinYoneticiFormu.FormGorebilir(_orgOnay, _ekip.Kisi(PersonelKodu()), t))
                return NotFound(new { hata = "Talep bulunamadı." });

            /* İK'nın kendi evrakı (kalem "ik") uygulamadan açılmıyor */
            var kalem = db.ExecuteScalar<string>(
                "SELECT TOP 1 kalem FROM KRY_IZIN_TALEP_EVRAK WHERE talep_id = @id AND belge_id = @belgeId", new { id, belgeId });

            if (kalem is null || kalem == IzinEvrak.Ik) return NotFound(new { hata = "Belge bulunamadı." });

            var mb = db.QueryFirstOrDefault(@"
SELECT b.dosya FROM KRY_PERSONEL_BELGE b WHERE b.id = @belgeId AND b.silindi = 0", new { belgeId });

            var mobilDosya = (string)mb?.dosya ?? "";
            if (mobilDosya.Length == 0 || mobilDosya.Contains('/') || mobilDosya.Contains('\\') || mobilDosya.Contains(".."))
                return NotFound(new { hata = "Belge bulunamadı." });

            var mobilYol = BelgeKlasoru.Bul(_yapilandirma, _ortam, mobilDosya);
            if (mobilYol is null) return NotFound(new { hata = "Belge dosyası sunucuda bulunamadı." });

            return PhysicalFile(mobilYol, Path.GetExtension(mobilDosya).ToLowerInvariant() switch
            {
                ".pdf" => "application/pdf",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".heic" or ".heif" => "image/heic",
                ".webp" => "image/webp",
                _ => "application/octet-stream",
            });
        }

        if (string.IsNullOrWhiteSpace(AsamaRolu())) return Forbid();

        var belge = db.QueryFirstOrDefault(@"
SELECT b.dosya, b.ozgun_ad AS ozgunAd
FROM KRY_PERSONEL_BELGE b
WHERE b.id = @belgeId AND b.silindi = 0
  AND (EXISTS (SELECT 1 FROM KRY_IZIN_TALEP_EVRAK e WHERE e.talep_id = @id AND e.belge_id = b.id)
       OR EXISTS (SELECT 1 FROM KRY_IZIN_TALEP t WHERE t.id = @id AND (t.belge_id = b.id OR t.mb_belge_id = b.id)))",
            new { id, belgeId });

        return DosyaDondur((string)belge?.dosya, (string)belge?.ozgunAd);
    }

    /// <summary>
    /// Yönetici, belgesini yüklemeyen ekip üyesine hatırlatma gönderir.
    /// Günde bir kez: art arda basılınca personele bildirim yağmasın.
    /// </summary>
    [HttpPost("{id:int}/MazeretBelgeHatirlat")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MazeretBelgeHatirlat(int id)
    {
        var ben = _ekip.Kisi(PersonelKodu());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault(
            "SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

        if (talep is null || talep.mb_son is null || talep.mb_yukleme is not null)
            return NotFound(new { hata = "Belge bekleyen talep bulunamadı." });

        var hedef = _ekip.Kisi((string)talep.personel_kodu);

        if (hedef is null || !_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için hatırlatma gönderemezsiniz." });

        var anahtar = $"mbhatirlat|{id}|{DateTime.Today:yyyyMMdd}";

        if (!MazeretBelgeGorevi.BirKez(db, anahtar))
            return Ok(new { tamam = false, mesaj = "Bugün zaten hatırlatıldı." });

        var hatirlatmaMetni = $"Yöneticiniz {ben.Ad} {ben.Soyad} izin evrakınızı yüklemenizi hatırlattı.";

        await _bildirim.Gonder((string)talep.personel_kodu,
            "İzin evrakınız bekleniyor",
            hatirlatmaMetni,
            "izin");

        IzinHareket.Yaz(db, id, IzinHareket.Hatirlatma, "Yönetici evrak hatırlatması gönderdi",
            hatirlatmaMetni + (IzinHareket.UlasmadiNotu(db, (string)talep.personel_kodu) is string n ? $" ({n})" : ""),
            $"{ben.Ad} {ben.Soyad}".Trim(), (string)talep.ad_soyad, IzinHareket.Uygulama);

        return Ok(new { tamam = true, mesaj = "Hatırlatma gönderildi." });
    }

    /// <summary>Formu yeniden mail olarak gönderir (gitmediyse ya da kaybolduysa).</summary>
    [HttpPost("{id:int}/FormGonder")]
    [Authorize]
    public async Task<IActionResult> FormGonder(int id)
    {
        if (Rol == "Personel") return Forbid();

        var (basarili, adres, hata) = await _form.GonderAsync(id, Kullanici);

        if (!basarili)
            return BadRequest(new { hata = "Form gönderilemedi.", ayrinti = hata });

        return Ok(new { basarili = true, adres });
    }

    /// <summary>Personel kendi talebini iptal eder.</summary>
    [HttpDelete("{id:int}")]
    [HttpPost("{id:int}/Iptal")]
    [Authorize(Roles = "Personel")]
    public IActionResult Iptal(int id)
    {
        var kod = PersonelKodu();

        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault(@"
SELECT personel_kodu AS personelKodu, durum, ad_soyad AS adSoyad, iptal
FROM KRY_IZIN_TALEP WHERE id = @id", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

        if (!string.Equals((string)talep.personelKodu, kod, StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { hata = "Bu talep size ait değil." });

        if ((string)talep.durum == Onaylandi)
            return BadRequest(new
            {
                hata = "Onaylanmış talep iptal edilemez.",
                ayrinti = "İnsan Kaynakları ile görüşünüz."
            });

        db.Execute("UPDATE KRY_IZIN_TALEP SET iptal = 1 WHERE id = @id", new { id });
        RaporKaydiniKaldir(db, id, "Talep iptal edildi");

        if (talep.iptal is not true)
            IzinHareket.Yaz(db, id, IzinHareket.Iptal, "Talep iptal edildi",
                $"Personel talebini uygulamadan geri çekti (durum: {talep.durum}).",
                (string)talep.adSoyad, null, IzinHareket.Uygulama);

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Panel tarafı                                                         */
    /* ==================================================================== */

    /// <summary>
    /// Onay bekleyen ve geçmiş talepler.
    ///
    /// Rol hangi aşamada karar veriyorsa o aşamadaki talepler "sırada"
    /// işaretlenir; diğerleri bilgi amaçlı görünür.
    /// </summary>
    [HttpGet("Liste")]
    [Authorize]
    public async Task<IActionResult> Liste([FromQuery] string durum = null, [FromQuery] string uzman = null)
    {
        await TakilanlariIlerlet();

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad,
       sube_adi AS subeAdi, gorev, tur,
       cikis_tarihi AS cikisTarihi, donus_tarihi AS donusTarihi,
       baslama_tarihi AS baslamaTarihi, gun,
       yarim_gun AS yarimGun, baslangic_saat AS baslangicSaat,
       bitis_saat AS bitisSaat, saat, aciklama, durum, olusturma,
       magaza_karar AS magazaKarar, magaza_kisi AS magazaKisi,
       magaza_not AS magazaNot, magaza_tarih AS magazaTarih,
       bolge_karar AS bolgeKarar, bolge_kisi AS bolgeKisi,
       bolge_not AS bolgeNot, bolge_tarih AS bolgeTarih,
       ik_karar AS ikKarar, ik_kisi AS ikKisi,
       ik_not AS ikNot, ik_tarih AS ikTarih,
       yerine_ad AS yerineAd, form_eposta AS formEposta,
       form_gonderim AS formGonderim, form_hata AS formHata,
       belge_id AS belgeId,
       (SELECT TOP 1 b.tur FROM KRY_PERSONEL_BELGE b WHERE b.id = KRY_IZIN_TALEP.belge_id) AS belgeTur,
       (SELECT TOP 1 b.baslik FROM KRY_PERSONEL_BELGE b WHERE b.id = KRY_IZIN_TALEP.belge_id) AS belgeBaslik,
       mb_son AS mbSon, mb_belge_id AS mbBelgeId, mb_yukleme AS mbYukleme,
       mb_son, mb_yukleme, asil_gonderim, belge_id, evrak_sonra,
       alt_tur AS altTur, CAST(ISNULL(form_sarti, 0) AS BIT) AS formSarti,
       (SELECT TOP 1 b.tur FROM KRY_PERSONEL_BELGE b WHERE b.id = KRY_IZIN_TALEP.mb_belge_id) AS mbBelgeTur,
       zincir, asama
FROM KRY_IZIN_TALEP
WHERE iptal = 0
  AND (@durum IS NULL OR durum = @durum)
ORDER BY
    CASE durum WHEN @onay THEN 2 WHEN @red THEN 3 ELSE 1 END,
    olusturma DESC",
            new { durum, onay = Onaylandi, red = Reddedildi }).ToList();

        /* Uzman süzgeci (07.10.2026): İK uzmanı önce kendi şubelerini görür */
        var kapsam = UzmanKapsami.Olustur(db, _ayar, User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value, Kullanici, uzman);
        if (kapsam is not null) kayitlar = kayitlar.Where(k => kapsam.Icinde((string)k.subeAdi)).ToList();

        var asama = AsamaRolu();

        var gerekliTurler = IzinEvrak.BelgeGerekliTurler(db);
        var evraklar = IzinEvrak.Evraklar(db, kayitlar.Select(x => (int)x.id));

        /* Kararı bekleyen aşamaların kişileri (09.10.2026): "Karar bekleniyor"
           altında kimin onayında olduğu yazsın. Sonuçlanmamış taleplerde,
           aynı personel için bir kez hesaplanıyor. */
        var onayCache = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

        object Onaylayanlar(dynamic k)
        {
            var dd = (string)k.durum;
            if (dd is not (Bekliyor or MagazaOnayli)) return null;

            /* Zincirli talep (26.10.2026): kişiler zincirden; birim = ilk adım,
               bolge = sıradaki (ya da ilk) ara kişi adımı */
            if (IzinOnayZinciri.Talepten((object)k) is { } zt)
            {
                var ara = zt.Zincir.Adimlar.Skip(1).Where(a => a.Tur == IzinOnayZinciri.TurKisi).ToList();
                var siradaki = zt.Asama > 0 ? IzinOnayZinciri.AdimAl(zt.Zincir, zt.Asama) : null;
                var bolgeAdimi = siradaki is { Tur: IzinOnayZinciri.TurKisi } ? siradaki : ara.FirstOrDefault();
                return new
                {
                    birim = zt.Zincir.Adimlar[0].Adlar.Take(4).ToList(),
                    bolge = (bolgeAdimi?.Adlar ?? new()).Take(4).ToList(),
                };
            }

            var anahtar = $"{k.personelKodu}|{k.gorev}|{k.subeAdi}";
            if (onayCache.TryGetValue(anahtar, out var v)) return v;

            try
            {
                var (birim, ust, _, _) = _orgOnay.Onaylayicilar((string)k.personelKodu, (string)k.gorev, (string)k.subeAdi);
                static List<string> Adlar(IEnumerable<PersonelKaydi> l) =>
                    (l ?? Enumerable.Empty<PersonelKaydi>()).Where(x => x is not null)
                        .Select(x => $"{x.Ad} {x.Soyad}".Trim()).Where(x => x.Length > 0).Distinct().Take(4).ToList();
                v = new { birim = Adlar(birim), bolge = Adlar(ust) };
            }
            catch
            {
                v = null;
            }

            onayCache[anahtar] = v;
            return v;
        }

        var zenginlestirilmis = kayitlar.Select(k =>
        {
            var d = (string)k.durum;

            /* Bu rolün şu an karar verebileceği talep mi */
            var sirada =
                asama == "hepsi"
                    ? d is Bekliyor or MagazaOnayli or BolgeOnayli
                    : asama == "magaza" ? d == Bekliyor
                    : asama == "bolgemd" ? d is Bekliyor or MagazaOnayli
                    : asama == "bolge" ? d == MagazaOnayli
                    : asama == "ik" ? d == BolgeOnayli
                    : false;

            return new
            {
                k.id, k.personelKodu, k.adSoyad, k.subeAdi, k.gorev, k.tur,
                k.cikisTarihi, k.donusTarihi, k.baslamaTarihi, k.gun,
                k.aciklama, k.durum, k.olusturma,
                k.yarimGun, k.baslangicSaat, k.bitisSaat, k.saat,
                k.magazaKarar, k.magazaKisi, k.magazaNot, k.magazaTarih,
                k.bolgeKarar, k.bolgeKisi, k.bolgeNot, k.bolgeTarih,
                k.ikKarar, k.ikKisi, k.ikNot, k.ikTarih,
                k.yerineAd, k.formEposta, k.formGonderim, k.formHata,
                k.belgeId, k.belgeTur, k.belgeBaslik,
                k.mbSon, k.mbBelgeId, k.mbYukleme, k.mbBelgeTur, k.altTur,
                evrak = IzinEvrak.Ozet(k, IzinEvrak.TalepBelgeGerekli(gerekliTurler, (string)k.tur, (string)k.altTur),
                    evraklar.GetValueOrDefault((int)k.id),
                    IzinEvrak.DestekAdi((string)k.tur, (string)k.altTur), k.formSarti == true),
                sirada,
                onaylayicilar = Onaylayanlar(k),

                /* Bu rolün kararı talebi sonuçlandırır mı: son onayda
                   imzalı belge yüklemek zorunlu */
                sonOnay = sirada && (asama == "ik" || (asama == "hepsi" && d == BolgeOnayli)),

                /* 26.10.2026: zincirli talepte ONAY AKIŞI kartları gerçek adımlar
                   (Birim Yöneticisi → GMY → İK); zinciri olmayan eski talepte null,
                   panel üç sabit aşamayı gösterir */
                akis = IzinOnayZinciri.Talepten((object)k) is { } zt ? IzinOnayZinciri.Akis(zt.Zincir, zt.Asama, d) : null,
            };
        }).ToList();

        return Ok(new
        {
            kayitlar = zenginlestirilmis,
            asama,
            bekleyen = zenginlestirilmis.Count(x => x.sirada),
            kapsam = UzmanKapsami.Ozet(kapsam)
        });
    }

    /* ==================================================================== */
    /* Geçmiş ve bildirimler                                                */
    /* ==================================================================== */

    /// <summary>Personele giden izin duyuruları (karar bildirimlerini eski talepler için kurmak).</summary>
    private static List<dynamic> IzinDuyurulari(System.Data.IDbConnection db, string kod, DateTime baslangic)
    {
        try
        {
            return db.Query(@"
SELECT baslik, metin, olusturma FROM KRY_MOBIL_DUYURU
WHERE personel_kodu = @kod AND olusturma >= @baslangic
  AND (baslik LIKE N'İzin talebiniz%' OR baslik LIKE N'% onaylandı')
ORDER BY olusturma", new { kod, baslangic }).ToList();
        }
        catch
        {
            return new List<dynamic>();
        }
    }

    private static object HareketCiktisi(IzinHareket.Kayit h) => new
    {
        id = h.Id, talepId = h.TalepId, zaman = h.Zaman, tur = h.Tur, baslik = h.Baslik,
        metin = h.Metin, kisi = h.Kisi, hedef = h.Hedef, kanal = h.Kanal,
        kaynak = h.Kaynak, belgeId = h.BelgeId,
    };

    /// <summary>
    /// Talebin geçmişi: hareket günlüğü ile talebin kendi kolonlarından
    /// kurulan olaylar birleşik (günlükten önce açılmış talepler de tam
    /// zaman çizelgesi göstersin). Yanında aynı personelin diğer talepleri.
    /// </summary>
    [HttpGet("{id:int}/Gecmis")]
    [Authorize]
    public IActionResult Gecmis(int id)
    {
        /* Diğer talepler kişisel: personel jetonu başkasının geçmişini okuyamasın */
        if (Rol == "Personel") return Forbid();

        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

        var kod = (string)talep.personel_kodu;

        var evraklar = IzinEvrak.Evraklar(db, new[] { id }).GetValueOrDefault(id) ?? new();
        var duyurular = IzinDuyurulari(db, kod, ((DateTime)talep.olusturma).AddMinutes(-1));

        var hareketler = IzinHareket.Birlestir(
            IzinHareket.Oku(db, id),
            IzinHareket.Sentezle((object)talep, evraklar, duyurular));

        var digerTalepler = db.Query(@"
SELECT TOP 20 id, tur, cikis_tarihi AS cikis, donus_tarihi AS donus, gun, durum, olusturma,
       yarim_gun AS yarimGun, baslangic_saat AS baslangicSaat, bitis_saat AS bitisSaat, saat
FROM KRY_IZIN_TALEP
WHERE personel_kodu = @kod AND id <> @id AND iptal = 0
ORDER BY cikis_tarihi DESC, id DESC", new { kod, id }).ToList();

        return Ok(new
        {
            hareketler = hareketler.Select(HareketCiktisi),
            digerTalepler,
        });
    }

    /// <summary>
    /// Bütün taleplerdeki son hareketler (sayfadaki "Son bildirimler"
    /// akışı). Günlük yeni kurulduğunda boş görünmesin diye son 30 günde
    /// hareket gören taleplerin kolonlarından kurulan olaylar da katılıyor.
    /// </summary>
    [HttpGet("SonHareketler")]
    [Authorize]
    public IActionResult SonHareketler([FromQuery] int adet = 30)
    {
        if (Rol == "Personel") return Forbid();

        adet = Math.Clamp(adet, 1, 100);

        using var db = _vt.Baglanti();

        List<IzinHareket.Kayit> kayitli;

        try
        {
            kayitli = db.Query<IzinHareket.Kayit>(@"
SELECT TOP (@adet) h.id AS Id, h.talep_id AS TalepId, h.zaman AS Zaman, h.tur AS Tur,
       h.baslik AS Baslik, h.metin AS Metin, h.kisi AS Kisi, h.hedef AS Hedef,
       h.kanal AS Kanal, 'kayit' AS Kaynak
FROM KRY_IZIN_TALEP_HAREKET h
INNER JOIN KRY_IZIN_TALEP t ON t.id = h.talep_id
ORDER BY h.zaman DESC, h.id DESC", new { adet }).ToList();
        }
        catch
        {
            kayitli = new List<IzinHareket.Kayit>();
        }

        /* Son 30 günde hareket gören talepler: kolonlarından olay kurulur */
        var talepler = db.Query(@"
SELECT TOP 60 * FROM KRY_IZIN_TALEP
WHERE (SELECT MAX(z) FROM (VALUES (olusturma), (magaza_tarih), (bolge_tarih), (ik_tarih),
              (form_gonderim), (mb_yukleme), (asil_gonderim), (mb_hatirlatma),
              (mb_yonetici_bildirim), (mb_son_gun_bildirim)) AS v(z)) >= DATEADD(DAY, -30, SYSDATETIME())
ORDER BY (SELECT MAX(z) FROM (VALUES (olusturma), (magaza_tarih), (bolge_tarih), (ik_tarih),
              (form_gonderim), (mb_yukleme), (asil_gonderim), (mb_hatirlatma),
              (mb_yonetici_bildirim), (mb_son_gun_bildirim)) AS v(z)) DESC").ToList();

        var evraklar = IzinEvrak.Evraklar(db, talepler.Select(x => (int)x.id));

        var kurulan = new List<IzinHareket.Kayit>();

        foreach (var t in talepler)
            kurulan.AddRange(IzinHareket.Sentezle((object)t, evraklar.GetValueOrDefault((int)t.id)));

        /* Kurulan olayların taleplerinin günlüğü de tamamıyla birleştirmeye
           girsin: yalnızca son N kayıtla birleştirince daha eski bir günlük
           kaydı kurulan olayla yinelenebiliyor. */
        var tumKayitli = kayitli.ToList();
        var kurulanIdler = kurulan.Select(x => x.TalepId).Distinct().ToList();

        if (kurulanIdler.Count > 0)
        {
            try
            {
                foreach (var r in db.Query<IzinHareket.Kayit>(@"
SELECT id AS Id, talep_id AS TalepId, zaman AS Zaman, tur AS Tur, baslik AS Baslik,
       metin AS Metin, kisi AS Kisi, hedef AS Hedef, kanal AS Kanal, 'kayit' AS Kaynak
FROM KRY_IZIN_TALEP_HAREKET WHERE talep_id IN @kurulanIdler", new { kurulanIdler }))
                    if (!tumKayitli.Any(x => x.Id == r.Id)) tumKayitli.Add(r);
            }
            catch
            {
                /* Günlük tablosu yoksa yalnızca kurulan olaylar */
            }
        }

        var birlesik = IzinHareket.Birlestir(tumKayitli, kurulan)
            .OrderByDescending(x => x.Zaman)
            .ThenByDescending(x => x.Id ?? 0)
            .Take(adet)
            .ToList();

        var ids = birlesik.Select(x => x.TalepId).Distinct().ToList();

        var bilgiler = ids.Count == 0
            ? new Dictionary<int, dynamic>()
            : db.Query(@"
SELECT id, ad_soyad AS adSoyad, tur, sube_adi AS subeAdi, personel_kodu AS personelKodu, durum
FROM KRY_IZIN_TALEP WHERE id IN @ids", new { ids })
                .ToDictionary(x => (int)x.id, x => x);

        return Ok(new
        {
            hareketler = birlesik.Select(h =>
            {
                var b = bilgiler.GetValueOrDefault(h.TalepId);

                return new
                {
                    id = h.Id, talepId = h.TalepId, zaman = h.Zaman, tur = h.Tur, baslik = h.Baslik,
                    metin = h.Metin, kisi = h.Kisi, hedef = h.Hedef, kanal = h.Kanal,
                    kaynak = h.Kaynak, belgeId = h.BelgeId,
                    adSoyad = (string)b?.adSoyad,
                    talepTur = (string)b?.tur,
                    subeAdi = (string)b?.subeAdi,
                    personelKodu = (string)b?.personelKodu,
                    durum = (string)b?.durum,
                };
            }),
        });
    }

    /// <summary>Talebi onaylar ya da reddeder.</summary>
    [HttpPost("{id:int}/Karar")]
    [Authorize]
    public async Task<IActionResult> Karar(int id, [FromBody] IzinKararGirdi girdi)
    {
        var asama = AsamaRolu();

        if (string.IsNullOrWhiteSpace(asama))
            return StatusCode(403, new { hata = "Onay yetkiniz bulunmuyor." });

        /* Panelde son onay (talebi sonuçlandıran onay) imzalı form ya da
           belge yüklenmeden verilemez: izin kaydı oluşuyor ve dayanağı
           personelin dosyasında bulunmalı. */
        if (girdi?.Onay == true)
        {
            using var db = _vt.Baglanti();

            var t = db.QueryFirstOrDefault(
                "SELECT durum, personel_kodu, belge_id FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

            var sonOnay = t is not null
                          && (asama == "ik" || (asama == "hepsi" && (string)t.durum == BolgeOnayli));

            if (sonOnay)
            {
                /* Belge önceden yüklenmişse talepte duruyor */
                girdi.BelgeId ??= (int?)t.belge_id;

                /* 13.10.2026: İK evrakı isteğe bağlı. Belge yüklenmeden de
                   onaylanır; "evrak sonra" işaretlenmediyse talep "İK evrakı
                   bekleniyor" listesine düşmez. */
                if (girdi.BelgeId is not int belgeId)
                    return await KararIsle(id, girdi, asama, Kullanici, null);

                var belge = db.QueryFirstOrDefault(@"
SELECT personel_kodu FROM KRY_PERSONEL_BELGE WHERE id = @belgeId AND silindi = 0", new { belgeId });

                if (belge is null || K((string)belge.personel_kodu) != K((string)t.personel_kodu))
                    return BadRequest(new { hata = "Yüklenen belge bu personele ait değil ya da bulunamadı." });
            }
        }

        return await KararIsle(id, girdi, asama, Kullanici, girdi?.BelgeId);
    }

    /// <summary>
    /// Kararın asıl işi: aşama denetimi, alanların yazılması, izin
    /// kaydının oluşması ve bildirimler.
    ///
    /// Panel ve mobil aynı yordamı kullanıyor. Onay mantığı iki yerde
    /// ayrı yazılsaydı, birinde yapılan düzeltme (bakiyeden düşme, sıra
    /// denetimi) diğerinde eksik kalırdı.
    /// </summary>
    private async Task<IActionResult> KararIsle(
        int id, IzinKararGirdi girdi, string asama, string kararVeren, int? belgeId = null,
        string kanal = IzinHareket.Panel)
    {
        var onayla = girdi?.Onay == true;

        /* Ret sebebi zorunlu: personel neden reddedildiğini bilmezse
           aynı talebi tekrar açıyor. */
        if (!onayla && string.IsNullOrWhiteSpace(girdi?.Not))
            return BadRequest(new { hata = "Ret sebebini yazınız." });

        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault(@"
SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

        var durum = (string)talep.durum;

        if (durum is Onaylandi or Reddedildi)
            return BadRequest(new { hata = "Bu talep zaten sonuçlanmış." });

        /* Şube personeli (07.10.2026): birim yöneticisi aşamasında onay,
           imzalı izin formu uygulamadan yüklenmeden verilemez (otomatik
           onay dahil). Ret serbest; İK ve Admin panelden onaylayabilir. */
        if (onayla && durum == Bekliyor && talep.form_sarti == true && asama is not ("hepsi" or "ik"))
        {
            var ev = IzinEvrak.Evraklar(db, new[] { id }).GetValueOrDefault(id) ?? new();

            if (!IzinEvrak.FormYuklendi(ev))
                return BadRequest(new
                {
                    hata = "İmzalı izin formunu yüklemeden onaylayamazsınız. Ana sayfanızdaki \"İzin formunu yükleyin\" kartından formun fotoğrafını yükleyin, sonra onaylayın.",
                    ayrinti = "Şube mailine gelen formun çıktısını personele imzalatın, siz de imzalayın ve Biçen360'tan yükleyin.",
                    kod = "formBekleniyor",
                });
        }

        /* Raporlu (23.10.2026): rapor olmadan onay verilmez */
        if (onayla && asama != "hepsi" && IzinEvrak.RaporluMu((string)talep.tur) && !RaporVar(db, id))
            return BadRequest(new { hata = "Bu raporlu izin talebinde rapor yüklenmemiş; onaylanamaz.", kod = "raporYok" });

        /* Sıra denetimi: aşama atlanamaz */
        var beklenen = asama switch
        {
            "magaza" => Bekliyor,
            "bolge" => MagazaOnayli,
            "ik" => BolgeOnayli,
            _ => durum,
        };

        if (asama == "bolgemd")
        {
            if (durum is not (Bekliyor or MagazaOnayli))
                return BadRequest(new { hata = "Bu talep şu anda sizin onayınızı beklemiyor.", ayrinti = $"Mevcut durum: {durum}" });
        }
        else if (asama != "hepsi" && durum != beklenen)
            return BadRequest(new
            {
                hata = "Bu talep şu anda sizin onayınızı beklemiyor.",
                ayrinti = $"Mevcut durum: {durum}"
            });

        var karar = onayla ? "Onaylandı" : "Reddedildi";
        var not = (girdi?.Not ?? "").Trim();

        /* Zincirli talep (26.10.2026): adım zincirden; karar zincire de yazılıyor,
           sıradaki adım onaylayanı yeniden bulunarak belirleniyor */
        var zt = IzinOnayZinciri.Talepten((object)talep);
        IzinOnayZinciri.Adim zincirAdimi = null;
        int? sonrakiAdim = null;

        /* Hangi aşamanın alanları yazılacak; 'hepsi' yetkisinde mevcut
           duruma göre belirlenir. */
        var yazilacak = zt is { } z0
            ? IzinOnayZinciri.Alan(z0.Zincir, z0.Asama)
            : asama is "hepsi" or "bolgemd"
            ? durum switch
            {
                Bekliyor => "magaza",
                MagazaOnayli => "bolge",
                _ => "ik",
            }
            : asama;

        var yeniDurum = !onayla
            ? Reddedildi
            : yazilacak switch
            {
                "magaza" => MagazaOnayli,
                "bolge" => BolgeOnayli,
                _ => Onaylandi,
            };

        if (zt is { } z1)
        {
            zincirAdimi = IzinOnayZinciri.AdimAl(z1.Zincir, z1.Asama);
            zincirAdimi.Karar = onayla ? IzinOnayZinciri.KararOnay : IzinOnayZinciri.KararRed;
            zincirAdimi.Kim = kararVeren;
            zincirAdimi.Tarih = DateTime.Now;
            zincirAdimi.Not = not.Length == 0 ? null : not;

            var yeniAsama = z1.Asama;

            if (onayla)
            {
                sonrakiAdim = _zincir.Ilerle(z1.Zincir, z1.Asama, (string)talep.personel_kodu, (string)talep.sube_adi);
                yeniDurum = sonrakiAdim is int s ? IzinOnayZinciri.Durum(z1.Zincir, s) : Onaylandi;
                yeniAsama = sonrakiAdim ?? z1.Zincir.Adimlar.Count - 1;
            }

            IzinOnayZinciri.Yaz(db, id, z1.Zincir, yeniAsama);
            if (onayla) AtlananlariIsle(db, id, z1.Zincir, z1.Asama, yeniAsama);
        }

        var alan = yazilacak switch
        {
            "magaza" => "magaza",
            "bolge" => "bolge",
            _ => "ik",
        };

        db.Execute($@"
UPDATE KRY_IZIN_TALEP
SET durum = @durum,
    {alan}_karar = @karar,
    {alan}_kisi = @kisi,
    {alan}_not = @not,
    {alan}_tarih = SYSDATETIME(),
    belge_id = COALESCE(@belgeId, belge_id)
WHERE id = @id",
            new { id, durum = yeniDurum, karar, kisi = kararVeren, not, belgeId });

        IzinHareket.Yaz(db, id, IzinHareket.Karar,
            zincirAdimi is null ? IzinHareket.KararBasligi(alan, karar) : IzinHareket.KararBasligi(zincirAdimi.Ad, karar, true),
            string.IsNullOrWhiteSpace(not) ? null : not, kararVeren, null, kanal);

        if (yeniDurum == Reddedildi) RaporKaydiniKaldir(db, id, "Talep reddedildi");

        /* Yöneticinin eksik bildirimi (26.10.2026) karar verilince kapanır:
           kart personelin ana sayfasından kalkar */
        YoneticiEksik.Kapat(db, TalepEksik.Izin, id, $"{karar} · {kararVeren}");

        var belgeIstendi = false;

        /* İK onayladıysa izin kaydı oluşturulur ve bakiyeden düşer */
        if (yeniDurum == Onaylandi)
        {
            var izinId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IZIN
    (personel_kodu, ad_soyad, sube_adi, gorev, tur,
     cikis_tarihi, donus_tarihi, baslama_tarihi, gun,
     yarim_gun, baslangic_saat, bitis_saat, saat,
     aciklama, bakiyeden_duser, giren)
OUTPUT INSERTED.id
VALUES (@kod, @adSoyad, @subeAdi, @gorev, @tur,
        @cikis, @donus, @baslama, @gun,
        @yarimGun, @baslangicSaat, @bitisSaat, @saat,
        @aciklama, @duser, @giren)",
                new
                {
                    kod = (string)talep.personel_kodu,
                    adSoyad = (string)talep.ad_soyad,
                    subeAdi = (string)talep.sube_adi,
                    gorev = (string)talep.gorev,
                    tur = (string)talep.tur,
                    cikis = (DateTime)talep.cikis_tarihi,
                    donus = (DateTime)talep.donus_tarihi,
                    baslama = talep.baslama_tarihi,
                    gun = (decimal)talep.gun,
                    yarimGun = talep.yarim_gun,
                    baslangicSaat = talep.baslangic_saat,
                    bitisSaat = talep.bitis_saat,
                    saat = talep.saat,
                    aciklama = $"Uygulamadan talep edildi · {talep.aciklama}",
                    /* Bakiyeden düşme kararı tür tanımından: yarım gün ve
                       saatlik izin kendi türü olduğu için yıllık izinden
                       düşmüyor. */
                    duser = BakiyedenDuser(db, (string)talep.tur),
                    giren = kararVeren
                });

            db.Execute("UPDATE KRY_IZIN_TALEP SET izin_id = @izinId WHERE id = @id",
                new { id, izinId });

            /* İK evrakı yoksa onay "evrak sonra" olarak işaretlenir */
            db.Execute(@"
UPDATE KRY_IZIN_TALEP SET evrak_sonra = CASE WHEN belge_id IS NULL AND @evrakSonra = 1 THEN 1 ELSE 0 END
WHERE id = @id", new { id, evrakSonra = girdi?.EvrakSonra == true ? 1 : 0 });

            /* Belge istenen türlerde (mazeret, rapor) personel 3 gün içinde
               belgesini uygulamadan yükler; süre onay anından başlar. */
            /* Talep açılırken evrak süresi başlamamışsa (eski talepler) */
            if (!IzinEvrak.RaporluMu((string)talep.tur)
                && IzinEvrak.TalepBelgeGerekli(IzinEvrak.BelgeGerekliTurler(db), (string)talep.tur, (string)talep.alt_tur))
                belgeIstendi = db.Execute(@"
UPDATE KRY_IZIN_TALEP SET mb_son = DATEADD(DAY, @gun, SYSDATETIME())
WHERE id = @id AND mb_son IS NULL", new { id, gun = MazeretBelgeGorevi.SureGun }) > 0;

            if (belgeId is null && talep.belge_id is null)
                IzinHareket.Yaz(db, id, IzinHareket.Evrak,
                    girdi?.EvrakSonra == true ? "Onaylandı · İK evrakı sonra yüklenecek" : "Onaylandı · İK evrakı yüklenmeden",
                    girdi?.EvrakSonra == true
                        ? "Islak imzalı evrak gelmeden onay verildi; talep \"İK evrakı bekleniyor\" listesinde."
                        : "İK evrakı isteğe bağlı; sonradan talebin ayrıntısından yüklenebilir.",
                    kararVeren, null, kanal);
        }

        /* Personele bildirim: sonucu uygulamada görsün */
        var baslik = belgeIstendi
            ? $"{talep.tur} onaylandı"
            : !onayla
            ? "İzin talebiniz reddedildi"
            : yeniDurum == Onaylandi
            ? "İzin talebiniz onaylandı"
            : "İzin talebiniz bir aşama ilerledi";

        var metin = belgeIstendi
            ? $"{((DateTime)talep.cikis_tarihi):dd.MM.yyyy} – {((DateTime)talep.donus_tarihi):dd.MM.yyyy} tarihli izniniz onaylandı. "
              + $"Belgenizi {MazeretBelgeGorevi.SureGun} gün içinde Biçen360'tan yükleyiniz."
            : !onayla
            ? not
            : yeniDurum == Onaylandi
            ? $"{((DateTime)talep.cikis_tarihi):dd.MM.yyyy} – "
              + $"{((DateTime)talep.donus_tarihi):dd.MM.yyyy} tarihli izniniz onaylandı."
            : kararVeren == "Sistem · otomatik onay"
            ? "Yöneticiniz süresi içinde yanıt vermediği için talebiniz otomatik onaylandı ve bir sonraki aşamaya geçti."
            : zincirAdimi is not null && sonrakiAdim is int sa
            ? $"Talebiniz {(zt.Value.Asama == 0 ? "yöneticiniz" : zincirAdimi.Ad)} tarafından onaylandı; {IzinOnayZinciri.AdimAl(zt.Value.Zincir, sa).Ad} onayına geçti."
            : $"Talebiniz {yazilacak switch { "magaza" => "yöneticiniz", "bolge" => "bölge müdürünüz", _ => "İnsan Kaynakları" }} tarafından onaylandı.";

        db.Execute(@"
INSERT INTO KRY_MOBIL_DUYURU (baslik, metin, personel_kodu, gonderen)
VALUES (@baslik, @metin, @kod, @gonderen)",
            new
            {
                baslik,
                metin,
                kod = (string)talep.personel_kodu,
                gonderen = kararVeren
            });

        await _bildirim.Gonder(
            (string)talep.personel_kodu, baslik, metin, "izin");

        IzinHareket.Yaz(db, id, IzinHareket.Bildirim, $"Personele bildirildi: {baslik}",
            metin + (IzinHareket.UlasmadiNotu(db, (string)talep.personel_kodu) is string ulasmadi
                ? $" ({ulasmadi} Uygulamadaki duyurularda görünür.)" : ""),
            "Sistem", (string)talep.ad_soyad, IzinHareket.Uygulama);

        /* Bir sonraki aşama.

           2. aşama şubenin bölge müdürü (07.10.2026). Şube bir bölgede
           değilse ya da 1. onaylayan zaten bölge müdürüyse aşama atlanıp
           talep doğrudan İK'ya geçiyor. Atlama bildirimden
           ÖNCE yapılıyor: eskiden önce bölge koordinatörüne "onayınızı
           bekliyor" gidiyor, sonra aşama atlanıyordu. */
        if (onayla && zt is { } z2 && sonrakiAdim is int sonrakiIdx)
        {
            /* Zincirli talep (26.10.2026): sıradaki adımın kişilerine (ya da İK'ya) haber */
            await SonrakiAdimaHaberVer(talep, z2.Zincir, sonrakiIdx, zincirAdimi);
        }
        else if (onayla && zt is null && yeniDurum == MagazaOnayli)
        {
            var (_, ust, _, _) = _orgOnay.Onaylayicilar(
                (string)talep.personel_kodu, (string)talep.gorev, (string)talep.sube_adi);

            if (ust.Count > 0)
            {
                await MobilKademeyeHaberVer(talep, 2);
            }
            else
            {
                using var db2 = _vt.Baglanti();

                AraAsamayiAtla(db2, id);

                yeniDurum = BolgeOnayli;
            }
        }

        /* 2. aşamaya geçen talepte bölge müdürüne kişisel bildirim yukarıda
           (MobilKademeyeHaberVer) gitti; rol yayını yalnızca İK aşamasında. */
        if (onayla && zt is null && yeniDurum == BolgeOnayli)
        {
            var sonraki = yeniDurum == MagazaOnayli
                ? new[] { Roller.BolgeKoordinatoru }
                : new[] { Roller.IK, Roller.IKYoneticisi };

            var sonrakiMetin = $"{talep.ad_soyad} · {talep.tur} · "
                               + $"{((DateTime)talep.cikis_tarihi):dd.MM} – "
                               + $"{((DateTime)talep.donus_tarihi):dd.MM}";

            await _bildirim.RoleGonder(
                sonraki,
                "İzin talebi onayınızı bekliyor",
                sonrakiMetin,
                "izintalep");

            IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Sonraki aşamaya onay bildirimi gönderildi",
                $"İzin talebi onayınızı bekliyor · {sonrakiMetin}", "Sistem",
                yeniDurum == MagazaOnayli ? "Bölge koordinatörleri" : "İK · İK yöneticileri",
                IzinHareket.Uygulama);
        }

        return Ok(new { basarili = true, durum = yeniDurum });
    }

    /// <summary>
    /// Birim yöneticisi süresinde karar vermediğinde otomatik onay
    /// (IzinOtomatikOnayGorevi). Kararla aynı yordam; yalnızca 1. aşamada.
    /// </summary>
    [NonAction]
    public async Task<string> OtomatikOnayla(int id, int saat)
    {
        var sonuc = await KararIsle(id,
            new IzinKararGirdi
            {
                Onay = true,
                Not = $"Birim yöneticisi {saat / 24} gün içinde karar vermediği için sistem tarafından otomatik onaylandı."
            },
            "magaza", "Sistem · otomatik onay", null, IzinHareket.Uygulama);

        return sonuc is ObjectResult o && o.Value is not null
            ? $"{o.StatusCode ?? 200} {System.Text.Json.JsonSerializer.Serialize(o.Value)}"
            : sonuc.GetType().Name;
    }

    /* ==================================================================== */
    /* Zincirli akış (26.10.2026)                                           */
    /* ==================================================================== */

    /// <summary>Sicillerin aktif personel kayıtları (bildirim ve kart hazırlığı için)</summary>
    private List<PersonelKaydi> Kisiler(IEnumerable<string> kodlar)
    {
        try
        {
            return (kodlar ?? Enumerable.Empty<string>())
                .Select(k => _ekip.Kisi(k))
                .Where(x => x is not null)
                .GroupBy(x => K(x.PersonelKodu)).Select(g => g.First())
                .ToList();
        }
        catch
        {
            return new List<PersonelKaydi>();
        }
    }

    /// <summary>
    /// (onceki, yeni) aralığında atlanan zincir adımlarını eski kolonlara ve
    /// günlüğe yazar: ilk adım atlandıysa magaza_*, ara adım atlandıysa
    /// bolge_* "Atlandı" (yalnızca o kolona henüz karar yazılmadıysa; yayındaki
    /// panel ve uygulama bu kolonlardan okuyor).
    /// </summary>
    private static void AtlananlariIsle(System.Data.IDbConnection db, int id, IzinOnayZinciri.Zincir z, int onceki, int yeni)
    {
        for (var j = onceki + 1; j < Math.Min(yeni, z.Adimlar.Count); j++)
        {
            var a = z.Adimlar[j];
            if (a.Karar != IzinOnayZinciri.KararAtlandi) continue;

            var alan = IzinOnayZinciri.Alan(z, j);
            if (alan == "ik") continue;

            db.Execute($@"
UPDATE KRY_IZIN_TALEP
SET {alan}_karar = N'Atlandı', {alan}_kisi = N'Sistem', {alan}_tarih = SYSDATETIME(), {alan}_not = @not
WHERE id = @id AND {alan}_karar IS NULL", new { id, not = $"{a.Ad}: {a.Not}; aşama atlandı." });

            IzinHareket.Yaz(db, id, IzinHareket.Karar, IzinHareket.KararBasligi(a.Ad, "Atlandı", true), a.Not, "Sistem");
        }
    }

    /// <summary>
    /// Zincirli talepte sıradaki adıma bildirim: kişi adımında adımın
    /// onaylayanlarına Biçen360 bildirimi (İzin Onayları açılır), GMY
    /// adımında ayrıca panel GMY rolüne, İK adımında İK rollerine.
    /// </summary>
    private async Task SonrakiAdimaHaberVer(dynamic talep, IzinOnayZinciri.Zincir z, int asama, IzinOnayZinciri.Adim onceki)
    {
        try
        {
            var adim = IzinOnayZinciri.AdimAl(z, asama);
            var metin = $"{talep.ad_soyad} · {talep.tur} · "
                        + $"{((DateTime)talep.cikis_tarihi):dd.MM} – {((DateTime)talep.donus_tarihi):dd.MM}"
                        + (onceki is null ? "" : $" · {onceki.Ad} onayladı");

            if (adim.Tur == IzinOnayZinciri.TurIk)
            {
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi },
                    "İzin talebi onayınızı bekliyor", metin, "izintalep");

                IzinHareket.Yaz(_vt, (int)talep.id, IzinHareket.Bildirim, "Sonraki aşamaya onay bildirimi gönderildi",
                    $"İzin talebi onayınızı bekliyor · {metin}", "Sistem", "İK · İK yöneticileri", IzinHareket.Uygulama);
                return;
            }

            foreach (var kod in (adim.Kodlar ?? new List<string>()).Distinct())
                await _bildirim.Gonder(kod, "İzin talebi onayınızı bekliyor", metin, "izinonay|izin");

            if ((adim.Roller ?? new()).Contains(Roller.GenelMudurYardimcisi))
                await _bildirim.RoleGonder(new[] { Roller.GenelMudurYardimcisi }, "İzin talebi onayınızı bekliyor", metin, "izintalep");

            if (adim.Kodlar is { Count: > 0 })
                IzinHareket.Yaz(_vt, (int)talep.id, IzinHareket.Bildirim,
                    asama == 0 ? "Birim yöneticisine onay bildirimi gönderildi" : $"{adim.Ad} adımına onay bildirimi gönderildi",
                    $"İzin talebi onayınızı bekliyor · {metin}", "Sistem",
                    string.Join(", ", adim.Adlar.Take(6)) + (adim.Adlar.Count > 6 ? $" +{adim.Adlar.Count - 6}" : ""),
                    IzinHareket.Uygulama);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Zincirdeki sonraki adıma bildirim gönderilemedi");
        }
    }

    /// <summary>Ara aşamayı (üst yönetici) atlayıp talebi İK'ya geçirir.</summary>
    private static void AraAsamayiAtla(System.Data.IDbConnection db, int id)
    {
        var atlandi = db.Execute(@"
UPDATE KRY_IZIN_TALEP
SET durum = @durum, bolge_karar = N'Atlandı', bolge_kisi = N'Sistem',
    bolge_tarih = SYSDATETIME(),
    bolge_not = N'Bölge müdürü yok (şube bir bölgede değil ya da 1. onaylayan zaten bölge müdürü); İnsan Kaynakları''na geçti.'
WHERE id = @id AND durum = @onceki", new { id, durum = BolgeOnayli, onceki = MagazaOnayli }) > 0;

        if (atlandi)
            IzinHareket.Yaz(db, id, IzinHareket.Karar, IzinHareket.KararBasligi("bolge", "Atlandı"),
                "Bölge müdürü yok (şube bir bölgede değil ya da 1. onaylayan zaten bölge müdürü); İnsan Kaynakları'na geçti.", "Sistem");
    }

    /// <summary>
    /// Ara aşamada takılı kalmış talepleri ilerletir.
    ///
    /// <para>
    /// Onay tablosu devreye girmeden önce (organizasyon şemasıyla çalışan
    /// sürümde) 1. onayı almış talepler "üst yönetici" aşamasında kaldı:
    /// şemada üst yönetici bulunduğu için aşama atlanmamıştı. Atlama
    /// yalnızca onay anında yapıldığı için bu talepler kendiliğinden
    /// ilerlemiyordu. Liste ekranları açılırken bir kez denetleniyor;
    /// ara aşamasında onaylayan olmayanlar İK'ya geçiyor.
    /// </para>
    /// </summary>
    private async Task TakilanlariIlerlet()
    {
        try
        {
            using var db = _vt.Baglanti();

            var takili = db.Query(@"
SELECT id, personel_kodu, gorev, sube_adi FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum = @durum AND bolge_karar IS NULL AND zincir IS NULL", new { durum = MagazaOnayli }).ToList();

            foreach (var t in takili)
            {
                var (_, ust, _, _) = _orgOnay.Onaylayicilar(
                    (string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi);

                if (ust.Count == 0) AraAsamayiAtla(db, (int)t.id);
            }

            if (takili.Count > 0)
                _kayit.LogInformation("Ara aşamada takılı {Adet} talep denetlendi", takili.Count);

            await ZincirdeTakilanlariIlerlet(db);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Takılı izin talepleri ilerletilemedi");
        }
    }

    /// <summary>
    /// Zincirli talepte (26.10.2026) sıradaki kişi adımının onaylayanı
    /// sonradan kalmamışsa (işten ayrıldı, pozisyonu değişti) adım atlanıp
    /// talep bir sonrakine geçiyor; sahipsiz beklemesin. En fazla 20 dakikada
    /// bir denetleniyor (liste açılışları).
    /// </summary>
    private static DateTime _zincirDenetim = DateTime.MinValue;

    private async Task ZincirdeTakilanlariIlerlet(System.Data.IDbConnection db)
    {
        if (DateTime.UtcNow - _zincirDenetim < TimeSpan.FromMinutes(20)) return;
        _zincirDenetim = DateTime.UtcNow;

        var adaylar = db.Query(@"
SELECT * FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum IN (@b, @m) AND zincir IS NOT NULL", new { b = Bekliyor, m = MagazaOnayli }).ToList();

        foreach (var t in adaylar)
        {
            if (IzinOnayZinciri.Talepten((object)t) is not { } zt) continue;

            var adim = IzinOnayZinciri.AdimAl(zt.Zincir, zt.Asama);
            if (adim.Tur != IzinOnayZinciri.TurKisi || adim.Karar is not null) continue;

            _zincir.Coz(adim, (string)t.personel_kodu, (string)t.sube_adi, zt.Zincir);
            if (adim.Siciller.Count > 0) continue;

            adim.Karar = IzinOnayZinciri.KararAtlandi;
            adim.Kim = "Sistem";
            adim.Tarih = DateTime.Now;
            adim.Not = "Onaylayacak kişi kalmadı (ayrıldı ya da pozisyonu değişti)";

            var sonraki = _zincir.Ilerle(zt.Zincir, zt.Asama, (string)t.personel_kodu, (string)t.sube_adi)
                          ?? zt.Zincir.Adimlar.Count - 1;

            var id = (int)t.id;
            IzinOnayZinciri.Yaz(db, id, zt.Zincir, sonraki);
            AtlananlariIsle(db, id, zt.Zincir, zt.Asama - 1, sonraki);
            db.Execute("UPDATE KRY_IZIN_TALEP SET durum = @durum WHERE id = @id",
                new { id, durum = IzinOnayZinciri.Durum(zt.Zincir, sonraki) });

            _kayit.LogInformation("İzin talebi {Id}: {Adim} adımında onaylayan kalmadı, {Sonraki} adımına geçti",
                id, adim.Ad, IzinOnayZinciri.AdimAl(zt.Zincir, sonraki).Ad);

            await SonrakiAdimaHaberVer(t, zt.Zincir, sonraki, null);
        }
    }

    /* ==================================================================== */
    /* Bekleyen talepleri onay süreci tablosuna uydurma (27.10.2026)        */
    /* ==================================================================== */

    private static string ZA(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");
    private static string ZK(string s) => (s ?? "").Trim().TrimStart('0');

    private static string AdimImzasi(IzinOnayZinciri.Adim a) =>
        a.Tur == IzinOnayZinciri.TurIk ? "İK" : $"{ZA(a.Onay)}|{ZK(a.Sicil)}";

    private static string AkisMetni(IzinOnayZinciri.Zincir z) =>
        string.Join(" → ", z.Adimlar.Select(a => a.Tur == IzinOnayZinciri.TurIk ? "İK"
            : string.IsNullOrWhiteSpace(a.Sicil) ? a.Ad : $"{a.Ad} ({ZK(a.Sicil)})"));

    private static string BekleyenMetni(IzinOnayZinciri.Adim a) =>
        a.Tur == IzinOnayZinciri.TurIk ? "İnsan Kaynakları"
            : a.Adlar is { Count: > 0 } ? $"{a.Ad} ({string.Join(", ", a.Adlar.Take(3))})" : a.Ad;

    private sealed class ZincirOnerisi
    {
        public int Id { get; set; }
        public dynamic Talep { get; set; }
        public IzinOnayZinciri.Zincir Yeni { get; set; }
        public int Asama { get; set; }
        public string EskiAkis { get; set; }
        public string EskiBekleyen { get; set; }
        public string YeniAkis { get; set; }
        public string YeniBekleyen { get; set; }
        public bool BekleyenDegisti { get; set; }
        public string Not { get; set; }
    }

    /// <summary>
    /// Onay bekleyen bir talebin yeni tablodaki zinciri. Verilmiş onaylar
    /// korunuyor: eski zincirde onaylayan adım, yeni zincirde aynı pozisyon +
    /// kişi ya da aynı onaylayan(lar)la eşleşirse "onaylandı" sayılıyor.
    /// Zincirsiz eski talepte birim yöneticisi onayı (Mağaza Onayladı) ilk
    /// adım, İK'daki (Bölge Onayladı) talepte ilk iki kişi adımı onaylı sayılıyor.
    /// Tabloya zaten uyuyorsa null.
    /// </summary>
    private ZincirOnerisi ZincirOnerisiKur(dynamic t, Dictionary<string, PersonelKaydi> personel)
    {
        var kod = ZK((string)t.personel_kodu);
        if (!personel.TryGetValue(kod, out var p)) return null;

        var yeni = _zincir.Olustur(p);
        if (yeni is null) return null;

        var eski = IzinOnayZinciri.Talepten((object)t);
        var durum = (string)t.durum;

        string eskiAkis, eskiBekleyen, eskiImza;
        var onaylananlar = new List<IzinOnayZinciri.Adim>();
        var eskiOnayliSayi = 0;

        if (eski is { } ez)
        {
            eskiAkis = AkisMetni(ez.Zincir);
            var bek = IzinOnayZinciri.AdimAl(ez.Zincir, ez.Asama);
            eskiBekleyen = BekleyenMetni(bek);
            eskiImza = string.Join(";", ez.Zincir.Adimlar.Select(AdimImzasi)) + "#" + AdimImzasi(bek);
            onaylananlar = ez.Zincir.Adimlar.Where(a => a.Tur == IzinOnayZinciri.TurKisi && a.Karar == IzinOnayZinciri.KararOnay).ToList();
        }
        else
        {
            eskiAkis = "Eski akış (onay tablosu öncesi)";
            eskiBekleyen = durum == Bekliyor ? "Birim yöneticisi" : durum == MagazaOnayli ? "Üst yönetici" : "İnsan Kaynakları";
            eskiImza = null; /* zincirsiz talep her zaman tabloya taşınır */
            eskiOnayliSayi = durum == MagazaOnayli ? 1 : durum == BolgeOnayli ? 2 : 0;
        }

        /* Verilmiş onayları yeni zincire taşı */
        var kullanilan = new HashSet<IzinOnayZinciri.Adim>();
        var kisiSira = 0;
        foreach (var a in yeni.Adimlar)
        {
            if (a.Tur != IzinOnayZinciri.TurKisi) continue;

            if (eski is null)
            {
                if (kisiSira++ < eskiOnayliSayi)
                {
                    a.Karar = IzinOnayZinciri.KararOnay;
                    a.Kim = kisiSira == 1 ? ((string)t.magaza_kisi ?? "Önceki onay") : ((string)t.bolge_kisi ?? "Önceki onay");
                    a.Tarih = kisiSira == 1 ? (DateTime?)t.magaza_tarih : (DateTime?)t.bolge_tarih;
                    a.Not = "Eski akışta verilen onay";
                }
                continue;
            }

            var es = onaylananlar.FirstOrDefault(o => !kullanilan.Contains(o) &&
                ((ZA(o.Onay) == ZA(a.Onay) && ZK(o.Sicil) == ZK(a.Sicil))
                 || ((o.Siciller?.Count ?? 0) > 0 && (a.Siciller ?? new()).Intersect(o.Siciller, StringComparer.OrdinalIgnoreCase).Any())));
            if (es is null) continue;

            kullanilan.Add(es);
            a.Karar = IzinOnayZinciri.KararOnay;
            a.Kim = es.Kim;
            a.Tarih = es.Tarih;
            a.Not = es.Not;
        }

        /* Onaylanmamış ilk adımdan itibaren (onaylayanı olmayan atlanır) */
        var ilk = yeni.Adimlar.FindIndex(a => a.Karar != IzinOnayZinciri.KararOnay);
        if (ilk < 0) ilk = yeni.Adimlar.Count - 1;
        var asama = _zincir.Ilerle(yeni, ilk - 1, (string)t.personel_kodu, p.IsGrubu) ?? yeni.Adimlar.Count - 1;

        var yeniBek = IzinOnayZinciri.AdimAl(yeni, asama);
        var yeniImza = string.Join(";", yeni.Adimlar.Select(AdimImzasi)) + "#" + AdimImzasi(yeniBek);

        if (eskiImza is not null && eskiImza == yeniImza) return null;

        return new ZincirOnerisi
        {
            Id = (int)t.id,
            Talep = t,
            Yeni = yeni,
            Asama = asama,
            EskiAkis = eskiAkis,
            EskiBekleyen = eskiBekleyen,
            YeniAkis = AkisMetni(yeni),
            YeniBekleyen = BekleyenMetni(yeniBek),
            BekleyenDegisti = eskiBekleyen != BekleyenMetni(yeniBek),
            Not = yeni.Kural,
        };
    }

    private List<ZincirOnerisi> ZincirOnerileri(System.Data.IDbConnection db)
    {
        var personel = new Dictionary<string, PersonelKaydi>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in _personelKaynak.TumPersonelleriGetir().Where(x => x.Durum == 1))
            personel[ZK(x.PersonelKodu)] = x;

        var bekleyenler = db.Query(@"
SELECT * FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum IN (@b, @m, @i)
ORDER BY olusturma", new { b = Bekliyor, m = MagazaOnayli, i = BolgeOnayli }).ToList();

        var sonuc = new List<ZincirOnerisi>();
        foreach (var t in bekleyenler)
        {
            try
            {
                if (ZincirOnerisiKur(t, personel) is ZincirOnerisi o) sonuc.Add(o);
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "İzin talebi {Id} için yeni onay zinciri kurulamadı", (int)t.id);
            }
        }
        return sonuc;
    }

    private bool ZincirYetkili => Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi or Roller.IK;

    /// <summary>
    /// Onay bekleyen izin taleplerinden İZİN TALEP ONAY SÜRECİ tablosuna
    /// uymayanlar: şu anki ve olması gereken sıra (değiştirmeden önizleme).
    /// </summary>
    [HttpGet("ZincirDenetim")]
    [Authorize]
    public IActionResult ZincirDenetim()
    {
        if (!ZincirYetkili) return Forbid();

        using var db = _vt.Baglanti();
        var l = ZincirOnerileri(db);

        return Ok(new
        {
            toplam = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_IZIN_TALEP WHERE iptal = 0 AND durum IN (@b, @m, @i)",
                new { b = Bekliyor, m = MagazaOnayli, i = BolgeOnayli }),
            uymayan = l.Count,
            talepler = l.Select(o => new
            {
                id = o.Id,
                adSoyad = (string)o.Talep.ad_soyad,
                sube = (string)o.Talep.sube_adi,
                gorev = (string)o.Talep.gorev,
                tur = (string)o.Talep.tur,
                cikis = (DateTime)o.Talep.cikis_tarihi,
                donus = (DateTime)o.Talep.donus_tarihi,
                eskiAkis = o.EskiAkis,
                eskiBekleyen = o.EskiBekleyen,
                yeniAkis = o.YeniAkis,
                yeniBekleyen = o.YeniBekleyen,
                bekleyenDegisti = o.BekleyenDegisti,
                kural = o.Not,
            }),
        });
    }

    /// <summary>
    /// Uymayan bekleyen talepleri tablodaki sıraya taşır; sırası değişen
    /// talepte yeni onaylayana bildirim gider. Verilmiş onaylar korunur.
    /// </summary>
    [HttpPost("ZincirDuzelt")]
    [Authorize]
    public async Task<IActionResult> ZincirDuzelt()
    {
        if (Roller.Temel(Rol) is not (Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi))
            return StatusCode(403, new { hata = "Bu işlemi Admin, GMY ya da İK yöneticisi yapabilir." });

        using var db = _vt.Baglanti();
        var l = ZincirOnerileri(db);
        int duzeltilen = 0, bildirilen = 0;

        foreach (var o in l)
        {
            try
            {
                var yeniDurum = IzinOnayZinciri.Durum(o.Yeni, o.Asama);

                var n = db.Execute(@"
UPDATE KRY_IZIN_TALEP SET zincir = @zincir, asama = @asama, durum = @durum
WHERE id = @id AND iptal = 0 AND durum = @eski",
                    new { id = o.Id, zincir = IzinOnayZinciri.Json(o.Yeni), asama = o.Asama, durum = yeniDurum, eski = (string)o.Talep.durum });
                if (n == 0) continue;

                var ilk = o.Yeni.Adimlar.FindIndex(a => a.Karar != IzinOnayZinciri.KararOnay);
                AtlananlariIsle(db, o.Id, o.Yeni, ilk - 1, o.Asama);

                IzinHareket.Yaz(db, o.Id, IzinHareket.Bildirim, "Onay sırası güncellendi (İzin talep onay süreci tablosu)",
                    $"Önceki: {o.EskiAkis} · bekleyen {o.EskiBekleyen}\nYeni: {o.YeniAkis} · bekleyen {o.YeniBekleyen}",
                    Kullanici, null, IzinHareket.Uygulama);
                duzeltilen++;

                if (o.BekleyenDegisti)
                {
                    var guncel = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id", new { id = o.Id });
                    if (guncel is not null)
                    {
                        await SonrakiAdimaHaberVer(guncel, o.Yeni, o.Asama, null);
                        bildirilen++;
                    }
                }
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "İzin talebi {Id} yeni onay sırasına taşınamadı", o.Id);
            }
        }

        return Ok(new
        {
            basarili = true,
            duzeltilen,
            bildirilen,
            mesaj = duzeltilen == 0 ? "Tabloya uymayan bekleyen talep yok."
                : $"{duzeltilen} talep yeni onay sırasına taşındı; {bildirilen} talepte yeni onaylayana bildirim gönderildi.",
        });
    }

    /* ==================================================================== */
    /* Mobil onay                                                           */
    /* ==================================================================== */

    /// <summary>Oturumdaki personel.</summary>
    private PersonelKaydi Kendisi()
    {
        var kod = PersonelKodu();

        if (string.IsNullOrWhiteSpace(kod)) return null;

        return _personelKaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => string.Equals(
                (x.PersonelKodu ?? "").Trim(), kod, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Talebin şu anki aşaması: 1 birim yöneticisi, 2 üst yönetici, 0 mobilde değil.</summary>
    private static int Asama(string durum) =>
        durum == Bekliyor ? 1 : durum == MagazaOnayli ? 2 : 0;

    /// <summary>
    /// Mobilde onayımı bekleyen yıllık izin talepleri.
    ///
    /// Organizasyon şemasına göre: talep edenin birim yöneticisi 1. aşamada,
    /// üst yöneticisi 2. aşamada görüyor. Kişi kendi talebini görmüyor.
    /// </summary>
    [HttpGet("Mobil/Bekleyenler")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilBekleyenler()
    {
        await TakilanlariIlerlet();

        var kisi = Kendisi();

        if (kisi is null) return Ok(new { kademe = (string)null, talepler = new List<object>() });

        using var db = _vt.Baglanti();

        var adaylar = db.Query(@"
SELECT * FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum IN (@b, @m)
ORDER BY olusturma", new { b = Bekliyor, m = MagazaOnayli }).ToList();

        /* Zincirli talepte (26.10.2026) yetki zincirden: bulunduğu adımın sicilleri */
        var uygun = adaylar
            .Where(t => IzinOnayZinciri.Talepten((object)t) is { } zt
                ? IzinOnayZinciri.KararVerebilir(zt.Zincir, zt.Asama, kisi.PersonelKodu)
                : _orgOnay.KararVerebilir(kisi.PersonelKodu, (string)t.personel_kodu,
                    (string)t.gorev, (string)t.sube_adi, Asama((string)t.durum)))
            .ToList();

        /* İmzalı form şartı (07.10.2026): yönetici formu görmeden onaylayamaz.
           1.5 bu alanları tanımıyor: türün yanına ve açıklamanın başına yazılıyor. */
        var yeni = Surum16();
        var yeni17 = Surum17();
        var mevcutEvrak = IzinEvrak.Evraklar(db, uygun.Select(t => (int)t.id));

        bool FormBekliyor(dynamic t) =>
            t.form_sarti == true && (string)t.durum == Bekliyor
            && !IzinEvrak.FormYuklendi(mevcutEvrak.GetValueOrDefault((int)t.id));

        /* Zincirli talepte mobil aşama: 1 ilk adım (form yükleme), 2 ara adımlar
           (formu görüp onay). Eski talepte durumdan. */
        int MobilAsama(dynamic t) =>
            IzinOnayZinciri.Talepten((object)t) is { } zt
                ? IzinOnayZinciri.MobilAsama(zt.Zincir, zt.Asama)
                : Asama((string)t.durum);

        /* Zincirli talepte bir önceki onaylanan adım (ara adımda kart "önceki onay"ı gösteriyor) */
        IzinOnayZinciri.Adim OncekiOnay(dynamic t) =>
            IzinOnayZinciri.Talepten((object)t) is { } zt
                ? zt.Zincir.Adimlar.Take(zt.Asama).LastOrDefault(a => a.Karar == IzinOnayZinciri.KararOnay)
                : null;

        /* Aşama adı onay tablosundan: "Mağaza Müdürü", "Bölge Müdürü"… */
        string AsamaAdi(dynamic t)
        {
            if (IzinOnayZinciri.Talepten((object)t) is { } zt)
                return IzinOnayZinciri.AdimAl(zt.Zincir, zt.Asama).Ad;

            var asama = Asama((string)t.durum);
            try
            {
                var (_, _, bu, uu) = _orgOnay.Onaylayicilar((string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi);
                var ad = asama == 1 ? bu : uu;
                if (!string.IsNullOrWhiteSpace(ad)) return ad;
            }
            catch
            {
                /* varsayılan ada düşer */
            }
            return asama == 1 ? "Birim yöneticisi" : "Bölge müdürü";
        }

        bool RaporMu(dynamic t) =>
            IzinEvrak.RaporluMu((string)t.tur) && (mevcutEvrak.GetValueOrDefault((int)t.id) ?? new()).Any(e => e.Kalem == IzinEvrak.Destek);

        int? FormBelgesi(dynamic t) =>
            (mevcutEvrak.GetValueOrDefault((int)t.id) ?? new())
                .Where(e => e.Kalem == IzinEvrak.Form).Select(e => (int?)e.BelgeId).LastOrDefault();

        /* Yöneticinin eksik bildirdiği talepler (26.10.2026): kartta
           "eksik bildirildi / personel tamamladı" şeridi */
        var yoneticiEksikleri = YoneticiEksik.Acikler(db, TalepEksik.Izin, uygun.Select(t => (int)t.id));

        var talepler = uygun
            .Select(t => new
            {
                id = (int)t.id,
                personelKodu = (string)t.personel_kodu,
                adSoyad = (string)t.ad_soyad,
                subeAdi = (string)t.sube_adi,
                gorev = (string)t.gorev,
                tur = yeni || string.IsNullOrWhiteSpace((string)t.alt_tur) ? (string)t.tur : $"{t.tur} · {t.alt_tur}",
                altTur = (string)t.alt_tur,
                cikisTarihi = (DateTime)t.cikis_tarihi,
                donusTarihi = (DateTime)t.donus_tarihi,
                gun = (decimal)t.gun,
                /* 09.10.2026: imzalı formu birim yöneticisi yükler; 1.6 kartında
                   yükleme düğmesi yok, yol açıklamada */
                aciklama = yeni17
                    ? (string)t.aciklama
                    : (FormBekliyor(t)
                          ? "⚠️ Önce imzalı formu yükleyin (Ana sayfa › \"İzin formunu yükleyin\" kartı › Evrakı yükle), sonra onaylayın."
                          : FormBelgesi(t) is not null ? "✓ İmzalı form yüklendi." : "")
                      + (string.IsNullOrWhiteSpace((string)t.aciklama) ? "" : $" · {t.aciklama}"),
                olusturma = (DateTime)t.olusturma,
                asama = MobilAsama(t),
                formBekleniyor = false,
                formBelgeId = FormBelgesi(t),

                /* 1.7: kart içinde "İmzalı formu yükle" / "Formu gör" */
                formYukle = FormBekliyor(t) && MobilAsama(t) == 1,
                formYuklendi = FormBelgesi(t) is not null || RaporMu(t),
                /* Raporlu (23.10.2026): 1.7–1.8 "formu gör" düğmesi raporu açıyor; 1.9 "Raporu gör" */
                formVar = FormBelgesi(t) is not null || RaporMu(t),
                formYolu = RaporMu(t) ? $"/api/IzinTalep/{(int)t.id}/Rapor"
                    : FormBelgesi(t) is not null ? IzinYoneticiFormu.FormYolu((int)t.id) : null,
                rapor = RaporMu(t),
                raporYolu = RaporMu(t) ? $"/api/IzinTalep/{(int)t.id}/Rapor" : null,
                baslamaTarihi = (DateTime?)t.baslama_tarihi,
                formYukleKimlik = (int)t.id,
                asamaAdi = AsamaAdi(t),

                /* Üst yönetici birim yöneticisinin kararını ve notunu görmeli.
                   Zincirli talepte (26.10.2026) bir önceki onaylanan adım
                   ("Bölge Müdürü onayladı (Ad)"); GMY adımı böylece bölge
                   müdürünün kararını da görüyor. */
                magazaKisi = OncekiOnay(t) is { } o1 ? $"{KararEtiketi.Kisi(o1.Ad, o1.Tur, o1.Kim)} ({o1.Ad})" : (string)t.magaza_kisi,
                magazaNot = OncekiOnay(t) is { } o2 ? o2.Not : (string)t.magaza_not,
                magazaTarih = OncekiOnay(t) is { } o3 ? o3.Tarih : (DateTime?)t.magaza_tarih,

                /* 2.0: zincirdeki adımlar (avans kartındaki sıra şeridi gibi) */
                sira = IzinOnayZinciri.Talepten((object)t) is { } zs ? IzinOnayZinciri.MobilSira(zs.Zincir) : null,
                adimAdi = AsamaAdi(t),

                /* 2.0 (26.10.2026): talebin bütün evrakları (form, rapor, mazeret
                   belgesi) ve yöneticinin eksik bildirimi; eski sürümler yok sayar */
                evraklar = IzinYoneticiFormu.EvrakListesi((int)t.id, mevcutEvrak.GetValueOrDefault((int)t.id)),
                eksik = YoneticiEksik.Disari(yoneticiEksikleri.GetValueOrDefault((int)t.id)),
                eksikBildirilebilir = true,
            })
            .ToList();

        /* Fazla mesai (08.10.2026): onay akışı izinle aynı; üst yöneticinin
           onayını bekleyenler aynı listede (1.6 izin kartıyla gösteriyor) */
        var hepsi = talepler.Cast<object>().ToList();
        try
        {
            hepsi.AddRange(FazlaMesaiAkisi.MobilBekleyenler(db, _orgOnay, kisi));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fazla mesai onay listesi alınamadı");
        }

        /* Avans (08.10.2026): Avans onay tablosundaki kişi adımları da burada
           (1.6 izin kartıyla; eksi kimlik) */
        try
        {
            hepsi.AddRange(AvansOnayZinciri.MobilBekleyenler(db, kisi));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Avans onay listesi alınamadı");
        }

        /* Görevlendirme (26.10.2026): zincirdeki kişi adımları da burada (eksi kimlik) */
        try
        {
            hepsi.AddRange(HttpContext.RequestServices.GetRequiredService<GorevlendirmeServisi>().MobilBekleyenler(db, kisi));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Görevlendirme onay listesi alınamadı");
        }

        /* Kademe: ekrandaki sekme adı için. Hiç talep yoksa da onaylayıcı
           olduğu biliniyorsa sekme görünsün. */
        var kademe = hepsi.Count > 0 || _orgOnay.OnaylayiciMi(kisi.Pozisyon, kisi.PersonelKodu) ? "org" : null;

        return Ok(new { kademe, talepler = hepsi });
    }

    /// <summary>Mobilden yıllık izin kararı.</summary>
    [HttpPost("Mobil/{id:int}/Karar")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilKarar(int id, [FromBody] IzinKararGirdi girdi)
    {
        var kisi = Kendisi();

        if (kisi is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        /* Avans: eksi kimlik (AvansOnayZinciri.MobilKimlik); karar avans
           ekranıyla aynı kodla (AvansController.KararUygula) */
        if (AvansOnayZinciri.KayitKimligi(id) is int avansId)
        {
            var onay = girdi?.Onay ?? false;
            var not = (girdi?.Not ?? "").Trim();
            if (!onay && not.Length < 3) return BadRequest(new { hata = "Reddetme sebebini yazınız; personel bunu görür." });
            if (not.Length > 500) not = not[..500];

            var avans = HttpContext.RequestServices.GetRequiredService<AvansController>();
            avans.ControllerContext = ControllerContext;

            var adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim();
            var imza = (adSoyad.Length > 38 ? adSoyad[..38] : adSoyad) + " (Biçen360)";
            var sonuc = await avans.DisaridanKarar(avansId, onay, not, imza, kisi.PersonelKodu);

            if (sonuc is ObjectResult or && (or.StatusCode ?? 200) >= 400)
            {
                var hata = or.Value?.GetType().GetProperty("hata")?.GetValue(or.Value) as string ?? "Karar kaydedilemedi.";
                return StatusCode(or.StatusCode ?? 400, new { hata });
            }

            string sonrakiAdim = null;
            if (sonuc is ObjectResult ok && ok.Value is not null)
                sonrakiAdim = ok.Value.GetType().GetProperty("sonrakiAdim")?.GetValue(ok.Value) as string;

            return Ok(new
            {
                basarili = true,
                mesaj = sonrakiAdim is not null
                    ? $"Kararınız kaydedildi; avans talebi {sonrakiAdim} onayına geçti."
                    : onay ? "Avans talebi onaylandı." : "Avans talebi reddedildi.",
            });
        }

        /* Görevlendirme: eksi kimlik (GorevlendirmeServisi.MobilKimlik); avanstan önce
           denetleniyor, aralıklar çakışmıyor */
        if (GorevlendirmeServisi.KayitKimligi(id) is int gorevId)
        {
            var adg = $"{kisi.Ad} {kisi.Soyad}".Trim();
            var sonuc = await HttpContext.RequestServices.GetRequiredService<GorevlendirmeServisi>()
                .Karar(gorevId, girdi?.Onay ?? false, girdi?.Not,
                    (adg.Length > 38 ? adg[..38] : adg) + " (Biçen360)", kisi.PersonelKodu, null);
            return sonuc.Hata is null
                ? Ok(new { basarili = true, mesaj = sonuc.Mesaj })
                : StatusCode(sonuc.Kod, new { hata = sonuc.Hata });
        }

        /* Fazla mesai: eksi kimlik (FazlaMesaiAkisi.MobilKimlik) */
        if (FazlaMesaiAkisi.KayitKimligi(id) is int fmId)
        {
            using var dbf = _vt.Baglanti();
            var (kod, govde) = await FazlaMesaiAkisi.UstKarar(dbf, _orgOnay, _bildirim, kisi, fmId,
                girdi?.Onay ?? false, girdi?.Not, HttpContext.RequestServices.GetService<FazlaMesaiKuralServisi>());
            return StatusCode(kod, govde);
        }

        int asama;

        using (var db = _vt.Baglanti())
        {
            var talep = db.QueryFirstOrDefault(
                "SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

            if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

            /* Liste zaten süzülüyor; burada yeniden denetleniyor ki kimlikle
               doğrudan istek atan sorumlu olmadığı talebe karar veremesin. */
            if (IzinOnayZinciri.Talepten((object)talep) is { } zt)
            {
                /* Zincirli talep (26.10.2026): bulunduğu adımın onaylayanı mı */
                asama = IzinOnayZinciri.MobilAsama(zt.Zincir, zt.Asama);

                if (asama == 0 || !IzinOnayZinciri.KararVerebilir(zt.Zincir, zt.Asama, kisi.PersonelKodu))
                    return StatusCode(403, new { hata = "Bu talep sizin onayınızı beklemiyor." });
            }
            else
            {
                asama = Asama((string)talep.durum);

                if (asama == 0 || !_orgOnay.KararVerebilir(kisi.PersonelKodu, (string)talep.personel_kodu,
                        (string)talep.gorev, (string)talep.sube_adi, asama))
                    return StatusCode(403, new { hata = "Bu talep sizin onayınızı beklemiyor." });
            }
        }

        var ad = $"{kisi.Ad} {kisi.Soyad}".Trim();

        return await KararIsle(id, girdi, asama == 1 ? "magaza" : "bolge",
            string.IsNullOrWhiteSpace(ad) ? kisi.PersonelKodu : ad, null, IzinHareket.Uygulama);
    }

    public class MobilEksikGirdi
    {
        public string Aciklama { get; set; }
    }

    /// <summary>
    /// Yönetici eksik bildirir (26.10.2026, Biçen360 2.0): Reddet ve
    /// Onayla'nın yanındaki "Eksik bildir". Talep reddedilmez, aynı adımda
    /// bekler; personele İK'nın eksik bildirimindeki mekanizmayla (ana
    /// sayfa kartı, duyuru, anlık bildirim) haber gider. Personel evrakı
    /// yükleyip ya da "Tamamladım" deyince bildirim bu yöneticiye döner ve
    /// talep yine onun onayında kalır. Avans eksi kimlikle (avans
    /// zincirinde sıradaki onaylayan); fazla mesaide yok (formu yönetici
    /// giriyor).
    /// </summary>
    [HttpPost("Mobil/{id:int}/Eksik")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilEksik(int id, [FromBody] MobilEksikGirdi girdi)
    {
        var kisi = Kendisi();

        if (kisi is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var aciklama = (girdi?.Aciklama ?? "").Trim();
        if (aciklama.Length < 5) return BadRequest(new { hata = "Eksik olanı kısaca yazınız; personel bu açıklamayı görür." });
        if (aciklama.Length > 600) aciklama = aciklama[..600];

        if (FazlaMesaiAkisi.KayitKimligi(id) is not null)
            return BadRequest(new { hata = "Fazla mesai kaydında eksik bildirimi yok; formu giren yöneticiyle görüşün ya da reddedin." });

        if (GorevlendirmeServisi.KayitKimligi(id) is not null)
            return BadRequest(new { hata = "Görevlendirmede eksik bildirimi yok; reddedip sebebini yazabilirsiniz." });

        using var db = _vt.Baglanti();

        /* Avans: eksi kimlik; yetki zincirdeki sıradaki adım */
        if (AvansOnayZinciri.KayitKimligi(id) is int avansId)
        {
            var a = db.QueryFirstOrDefault(@"
SELECT id, personel_kodu, ad_soyad, tutar, taksit, olusturma, durum, ISNULL(asama, 0) AS asama, zincir
FROM KRY_AVANS WHERE id = @avansId", new { avansId });

            if (a is null) return NotFound(new { hata = "Talep bulunamadı." });
            if ((string)a.durum != "bekliyor") return BadRequest(new { hata = "Bu talep sonuçlanmış." });

            var z = AvansOnayZinciri.Oku((string)a.zincir);
            var adim = z is null ? null : AvansOnayZinciri.AdimAl(z.Adimlar, (int)a.asama);

            if (adim is null || !AvansOnayZinciri.SicilYetkili(adim, kisi.PersonelKodu))
                return StatusCode(403, new { hata = "Bu talep sizin onayınızı beklemiyor." });

            string aKod = (string)a.personel_kodu, aAd = (string)a.ad_soyad;
            string aOzet = YoneticiEksik.AvansOzeti((decimal)a.tutar, (int)a.taksit, (DateTime)a.olusturma);

            var (eksikId, jeton) = await YoneticiEksik.Bildir(db, _bildirim, _kayit, TalepEksik.Avans, avansId, kisi, adim.Ad,
                aKod, aAd, aOzet, aciklama);

            YoneticiEksik.AvansHareket(db, avansId, $"{adim.Ad} eksik bildirdi", aciklama,
                $"{kisi.Ad} {kisi.Soyad}".Trim() + " (Biçen360)");

            return Ok(new
            {
                basarili = true,
                id = eksikId,
                mesaj = jeton
                    ? "Eksik personele bildirildi; tamamlayınca size haber gelir, talep onayınızda bekliyor."
                    : "Eksik kaydedildi; personelin uygulamasında bildirim jetonu yok, duyurularda görecek.",
            });
        }

        var talep = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });

        /* Yetki MobilKarar ile aynı: bulunduğu adımın onaylayanı */
        string unvan;

        if (IzinOnayZinciri.Talepten((object)talep) is { } zt)
        {
            if (IzinOnayZinciri.MobilAsama(zt.Zincir, zt.Asama) == 0 || !IzinOnayZinciri.KararVerebilir(zt.Zincir, zt.Asama, kisi.PersonelKodu))
                return StatusCode(403, new { hata = "Bu talep sizin onayınızı beklemiyor." });

            unvan = IzinOnayZinciri.AdimAl(zt.Zincir, zt.Asama).Ad;
        }
        else
        {
            var asama = Asama((string)talep.durum);

            if (asama == 0 || !_orgOnay.KararVerebilir(kisi.PersonelKodu, (string)talep.personel_kodu,
                    (string)talep.gorev, (string)talep.sube_adi, asama))
                return StatusCode(403, new { hata = "Bu talep sizin onayınızı beklemiyor." });

            unvan = asama == 1 ? "Birim Yöneticisi" : "Bölge Müdürü";
            try
            {
                var (_, _, bu, uu) = _orgOnay.Onaylayicilar((string)talep.personel_kodu, (string)talep.gorev, (string)talep.sube_adi);
                var u = asama == 1 ? bu : uu;
                if (!string.IsNullOrWhiteSpace(u)) unvan = u;
            }
            catch
            {
                /* varsayılan unvan */
            }
        }

        string personelKodu = (string)talep.personel_kodu, adSoyad = (string)talep.ad_soyad;
        string ozet = YoneticiEksik.IzinOzeti(talep);

        var (kayitId, jetonVar) = await YoneticiEksik.Bildir(db, _bildirim, _kayit, TalepEksik.Izin, id, kisi, unvan,
            personelKodu, adSoyad, ozet, aciklama);

        IzinHareket.Yaz(db, id, IzinHareket.Bildirim, $"{unvan} eksik bildirdi",
            aciklama + (jetonVar ? "" : " (Uygulamada bildirim jetonu yok; duyurularda görünür.)"),
            $"{kisi.Ad} {kisi.Soyad}".Trim() + $" ({unvan})", (string)talep.ad_soyad, IzinHareket.Uygulama);

        return Ok(new
        {
            basarili = true,
            id = kayitId,
            mesaj = jetonVar
                ? "Eksik personele bildirildi; tamamlayınca size haber gelir, talep onayınızda bekliyor."
                : "Eksik kaydedildi; personelin uygulamasında bildirim jetonu yok, duyurularda görecek.",
        });
    }

    /// <summary>
    /// Mobil talep ekranı için gün hesabı: seçilen izin günlerinden kaçı
    /// bakiyeden düşer ve hangileri düşmez (resmî tatil, haftalık izin).
    ///
    /// <para>
    /// Mobilde seçilen aralık izinli günlerin kendisi (ilk ve son izin
    /// günü). Hesap servisi dönüş gününü, yani işe dönülen günü bekliyor;
    /// o yüzden son güne bir gün ekleniyor.
    /// </para>
    ///
    /// <para>
    /// Eski ekran takvim günü sayıyordu: pazar ve bayram da bakiyeden
    /// düşülecekmiş gibi görünüyordu. Panelle aynı hesap burada da.
    /// </para>
    /// </summary>
    [HttpGet("Mobil/GunHesabi")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilGunHesabi([FromQuery] DateTime ilk, [FromQuery] DateTime son,
        [FromQuery] string tur = null)
    {
        var kisi = Kendisi();

        if (kisi is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        if (son < ilk) return BadRequest(new { hata = "Bitiş başlangıçtan önce olamaz." });

        if ((son - ilk).TotalDays > 90)
            return BadRequest(new { hata = "Tek talepte en fazla 90 gün seçilebilir." });

        var s = _izinGunu.Hesapla(kisi.Pozisyon, ilk.Date, son.Date.AddDays(1), kisi.PersonelKodu);

        /* Vardiya planı denetimi önizlemede de yapılıyor. Önizleme izin
           türünü bilmiyor (yayındaki uygulama göndermiyor); sonuç
           "vardiya" alanında, hangi türlerde engel olduğuyla dönüyor.
           Yayındaki uygulama bu alanları göstermiyor: engel, gönderimde
           "Gönderilemedi" uyarısıyla görünüyor. Gün sayısı yine dönüyor ki
           uygulamada gönder düğmesi açık kalsın ve personel sebebi görsün. */
        var vardiya = _izinGunu.VardiyaDenetle(kisi, tur, ilk.Date, son.Date, BirimSicilleri(kisi));

        /* Şube haftası da önizlemede: kişinin kendi planı tamsa bile şube
           eksikse uyarı aynı alanda görünsün */
        if (!vardiya.Engel)
        {
            var sh = _izinGunu.SubeHaftaDenetle(kisi, tur, BirimKisileri(kisi));
            if (sh.Engel) vardiya = sh;
        }

        /* Kontenjan da önizlemede (tür biliniyorsa) */
        if (!vardiya.Engel && tur is not null)
        {
            var kd = HttpContext.RequestServices.GetRequiredService<IzinKontenjanServisi>()
                .Denetle(kisi, tur, ilk.Date, son.Date, s.Gun);
            if (kd.Engel)
                vardiya = new IzinGunuServisi.VardiyaDenetimi(true, new List<DateTime>(), kd.Hata, kd.Ayrinti);
        }

        VardiyaKontrolKurali vk = null;

        try
        {
            vk = _izinGunu.KuralOku().Vardiya;
        }
        catch
        {
            /* Kural okunamazsa türler boş döner */
        }

        return Ok(new
        {
            gun = s.Gun,
            takvimGunu = s.TakvimGunu,
            dusulmeyenler = s.Dusulmeyenler,

            /* Cumartesi kuralı: "10.10.2026 Cumartesi izinden düşüldü…" */
            cumartesiDusen = s.CumartesiDusen,
            notlar = s.Notlar,

            /* Yeni sürümler için tek satırlık uyarı */
            uyari = vardiya.Engel ? vardiya.Hata : null,
            vardiya = vardiya.Engel
                ? new
                {
                    tanimli = false,
                    mesaj = vardiya.Hata,
                    ayrinti = vardiya.Ayrinti,
                    eksikGunler = vardiya.EksikGunler,
                    turler = vk?.Turler is { Count: > 0 } ? vk.Turler : new List<string> { "Yıllık İzin" },
                }
                : null,
        });
    }

    /// <summary>
    /// Talep sahibinin iznini aynı günlerde çakışan şube arkadaşları.
    ///
    /// Personel talep açarken kaç kişinin izinli olduğunu görüyor; müdür
    /// yoğunluk yüzünden reddetmeden önce başka güne kaydırabiliyor.
    /// İsim verilmiyor, yalnızca sayı: kimin ne zaman izinli olduğu kişisel.
    /// </summary>
    [HttpGet("Mobil/Cakisma")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilCakisma([FromQuery] DateTime cikis, [FromQuery] DateTime donus)
    {
        var kisi = Kendisi();

        if (kisi is null || donus < cikis) return Ok(new { sayi = 0 });

        using var db = _vt.Baglanti();

        var sayi = db.ExecuteScalar<int>(@"
SELECT COUNT(DISTINCT personel_kodu) FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum <> @red
  AND sube_adi = @sube AND personel_kodu <> @kod
  AND cikis_tarihi <= @donus AND donus_tarihi >= @cikis",
            new { red = Reddedildi, sube = kisi.IsGrubu, kod = kisi.PersonelKodu, cikis = cikis.Date, donus = donus.Date });

        return Ok(new { sayi });
    }

    /// <summary>Talebin düştüğü aşamanın onaylayıcılarına bildirim.</summary>
    private async Task MobilKademeyeHaberVer(dynamic talep, int asama)
    {
        /* Zincirli talep (26.10.2026): bulunduğu adımın kişilerine */
        if (IzinOnayZinciri.Talepten((object)talep) is { } zt)
        {
            await SonrakiAdimaHaberVer(talep, zt.Zincir, zt.Asama, null);
            return;
        }

        try
        {
            var (birim, ust, _, _) = _orgOnay.Onaylayicilar(
                (string)talep.personel_kodu, (string)talep.gorev, (string)talep.sube_adi);

            List<PersonelKaydi> alicilar = asama == 1 ? birim : ust;

            string haberMetni = $"{talep.ad_soyad} · {talep.tur} · "
                                + $"{((DateTime)talep.cikis_tarihi):dd.MM} – "
                                + $"{((DateTime)talep.donus_tarihi):dd.MM}";

            foreach (var x in alicilar)
            {
                await _bildirim.Gonder(
                    (x.PersonelKodu ?? "").Trim(),
                    "İzin talebi onayınızı bekliyor",
                    haberMetni,
                    /* Onaylayıcı: Yönetici İşlemleri › İzin (1.6 İzin Onayları'nı açar).
                       Önce "izin" gidiyordu ve kişinin kendi izin ekranı açılıyordu. */
                    "izinonay|izin");
            }

            if (alicilar.Count > 0)
                IzinHareket.Yaz(_vt, (int)talep.id, IzinHareket.Bildirim,
                    asama == 1 ? "Birim yöneticisine onay bildirimi gönderildi" : "Üst yöneticiye onay bildirimi gönderildi",
                    $"İzin talebi onayınızı bekliyor · {haberMetni}", "Sistem",
                    string.Join(", ", alicilar.Take(6).Select(x => $"{x.Ad} {x.Soyad}".Trim()))
                    + (alicilar.Count > 6 ? $" +{alicilar.Count - 6}" : ""),
                    IzinHareket.Uygulama);
        }
        catch (Exception hata)
        {
            /* Bildirim gitmezse talep yine listede; onaylayan görür */
            _kayit.LogWarning(hata, "Onaylayıcılara bildirim gönderilemedi");
        }
    }

    /// <summary>Sicillerin ad soyadları (günlükte "kime gitti" için).</summary>
    private string Adlar(IEnumerable<string> kodlar)
    {
        try
        {
            var adlar = (kodlar ?? Enumerable.Empty<string>())
                .Select(k => _ekip.Kisi(k) is { } x ? $"{x.Ad} {x.Soyad}".Trim() : k)
                .Where(x => !string.IsNullOrWhiteSpace(x))
                .Distinct()
                .ToList();

            return adlar.Count == 0 ? null
                : string.Join(", ", adlar.Take(6)) + (adlar.Count > 6 ? $" +{adlar.Count - 6}" : "");
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Jetondan sicil numarasını çıkarır.</summary>
    private string PersonelKodu()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return "";

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? govde : govde[..i];
    }
}

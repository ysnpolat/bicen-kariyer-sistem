using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Haftalık izin günü ve nöbet takvimi.
///
/// <para>
/// Mağaza personeli haftada bir gün izin kullanıyor ama hangi gün olduğu
/// hiçbir yerde tutulmuyordu: o gün karekod okutmayan personel raporda
/// "okutmadı" diye görünüyordu. Sabit izin günü kaydı burada tutuluyor;
/// 28.09.2026'dan itibaren personel gün seçmiyor, haftalık izin vardiya
/// planında yönetici tarafından veriliyor (VardiyaPlanController).
/// Bekleyen eski talepler yine buradan onaylanabiliyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class HaftalikIzinController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly BildirimServisi _bildirim;
    private readonly PortalYetkiServisi _portalYetki;
    private readonly ILogger<HaftalikIzinController> _kayit;

    public HaftalikIzinController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi kaynak,
        BildirimServisi bildirim,
        PortalYetkiServisi portalYetki,
        ILogger<HaftalikIzinController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _bildirim = bildirim;
        _portalYetki = portalYetki;
        _kayit = kayit;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private bool Yonetim =>
        Rol is Roller.Admin or Roller.IK or Roller.IKYoneticisi
            or Roller.GenelMudurYardimcisi;

    /* ====================================================================== */

    /// <summary>Tüm personelin haftalık izin günleri ve bekleyen talepler.</summary>
    [HttpGet]
    public IActionResult Listele([FromQuery] string durum = null, [FromQuery] string ara = null)
    {
        if (!Yonetim) return Forbid();

        using var db = _vt.Baglanti();

        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       pozisyon, gun, talep_gun AS talepGun, talep_tarihi AS talepTarihi,
       talep_notu AS talepNotu, durum, onay_tarihi AS onayTarihi, onaylayan,
       red_sebebi AS redSebebi, guncelleme
FROM KRY_HAFTALIK_IZIN
WHERE (@durum IS NULL OR durum = @durum)
  AND (@kalip IS NULL OR ad_soyad LIKE @kalip OR personel_kodu LIKE @kalip
       OR sube_adi LIKE @kalip)
ORDER BY CASE WHEN durum = N'bekliyor' THEN 0 ELSE 1 END, sube_adi, ad_soyad",
            new { durum, kalip }).ToList();

        return Ok(new
        {
            kayitlar,
            bekleyen = kayitlar.Count(x => (string)x.durum == "bekliyor")
        });
    }

    /// <summary>
    /// Talebi onaylar ya da reddeder.
    ///
    /// <para>
    /// Onaylandığında talep edilen gün geçerli gün hâline geliyor.
    /// Reddedildiğinde önceki gün korunuyor: reddedilen bir talep yüzünden
    /// personelin hiç izin günü kalmaması, o günü de "okutmadı" saydırırdı.
    /// </para>
    /// </summary>
    [HttpPost("Onay/{id:int}")]
    public async Task<IActionResult> Onay(int id, [FromBody] IzinOnayGirdi girdi)
    {
        /* Mağaza müdürü de onaylıyor; yetki mobil taraftan gelen role göre
           ayrıca denetleniyor. */
        var (yetkili, ayar) = Yonetim
            ? (true, (PortalYetkiServisi.GrupAyari)null)
            : OnayYetkisi();

        if (!yetkili) return Forbid();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT personel_kodu AS personelKodu, talep_gun AS talepGun, gun,
       sube_adi AS subeAdi, pozisyon
FROM KRY_HAFTALIK_IZIN WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        if (kayit.talepGun is null)
            return BadRequest(new { hata = "Bekleyen talep yok." });

        /* Müdür yalnızca kendi şubesini onaylayabilir */
        if (!Yonetim)
        {
            var kendi = Kendisi();

            if (kendi is null ||
                !PersonelKaynagiServisi.Benziyor(kendi.IsGrubu ?? "", (string)kayit.subeAdi ?? ""))
                return StatusCode(403, new { hata = "Yalnızca kendi mağazanızı onaylayabilirsiniz." });

            /* Liste zaten süzülüyor; burada da denetleniyor ki kayıt
               kimliğiyle doğrudan istek atan sorumlu olmadığı talebi
               onaylayamasın. */
            if (ayar is not null && !_portalYetki.Sorumlu(ayar, (string)kayit.pozisyon))
                return StatusCode(403, new { hata = "Bu personelin talebini onaylama yetkiniz yok." });
        }

        var onaylandi = girdi?.Onay ?? false;

        if (onaylandi)
        {
            db.Execute(@"
UPDATE KRY_HAFTALIK_IZIN
SET gun = talep_gun, talep_gun = NULL, durum = N'onaylandi',
    onay_tarihi = SYSDATETIME(), onaylayan = @kim, red_sebebi = NULL,
    guncelleme = SYSDATETIME()
WHERE id = @id", new { id, kim = OnaylayanAdi() });
        }
        else
        {
            db.Execute(@"
UPDATE KRY_HAFTALIK_IZIN
SET talep_gun = NULL, durum = CASE WHEN gun IS NULL THEN N'bekliyor' ELSE N'onaylandi' END,
    red_sebebi = @sebep, onay_tarihi = SYSDATETIME(), onaylayan = @kim,
    guncelleme = SYSDATETIME()
WHERE id = @id",
                new { id, kim = OnaylayanAdi(), sebep = girdi?.Sebep });
        }

        await _bildirim.Gonder(
            (string)kayit.personelKodu,
            onaylandi ? "İzin gününüz onaylandı" : "İzin günü talebiniz reddedildi",
            onaylandi
                ? $"Haftalık izin gününüz {GunAdi((int)kayit.talepGun)} olarak onaylandı."
                : $"Talebiniz onaylanmadı. {girdi?.Sebep ?? "Mağaza müdürünüzle görüşünüz."}",
            "izin");

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */
    /* Mobil                                                                 */
    /* ====================================================================== */

    /// <summary>Personelin kendi izin günü ve talebi.</summary>
    [HttpGet("Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Benim()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT gun, talep_gun AS talepGun, durum, red_sebebi AS redSebebi,
       onay_tarihi AS onayTarihi, onaylayan
FROM KRY_HAFTALIK_IZIN WHERE personel_kodu = @kod",
            new { kod = (p.PersonelKodu ?? "").Trim() });

        /* Seçim hakkı gruptan geliyor. İzin günü sabit olan gruplarda
           (merkez ofis: cumartesi, pazar) seçim ekranı çıkmamalı; personeli
           olmayan bir hakka yönlendiriyordu. */
        var secebilir = SecimHakki(db, p.Pozisyon);

        return Ok(new
        {
            kayit,
            secebilir,
            gunler = Enumerable.Range(0, 7).Select(g => new { deger = g, ad = GunAdi(g) })
        });
    }

    /// <summary>
    /// Eski uç: personel izin gününü kendisi seçiyordu.
    ///
    /// 28.09.2026 itibarıyla haftalık izin gününü yönetici vardiya planında
    /// veriyor; personel yalnızca o gün için özel durum bildirebiliyor
    /// (VardiyaPlan/OzelDurum). Eski sürüm uygulamalar için açıklayıcı
    /// bir yanıt dönüyor.
    /// </summary>
    [HttpPost("Sec")]
    [Authorize(Roles = "Personel")]
    public IActionResult Sec([FromBody] IzinSecimGirdi girdi) =>
        BadRequest(new
        {
            hata = "Haftalık izin günü artık yöneticiniz tarafından vardiya planında belirleniyor.",
            ayrinti = "Gün sizin için uygun değilse Vardiya Planı ekranından özel durum bildirebilirsiniz.",
        });

    /// <summary>Mağaza müdürünün onayını bekleyen talepler.</summary>
    [HttpGet("Bekleyenler")]
    [Authorize(Roles = "Personel")]
    public IActionResult Bekleyenler()
    {
        var p = Kendisi();

        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var (yetkili, ayar) = OnayYetkisi();

        if (!yetkili) return Ok(new { talepler = new List<object>() });

        using var db = _vt.Baglanti();

        /* Yalnızca kendi mağazası: müdürün başka şubenin talebini onaylaması
           anlamsız ve yetkisiz olurdu. */
        var talepler = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, pozisyon,
       gun, talep_gun AS talepGun, talep_tarihi AS talepTarihi,
       talep_notu AS talepNotu
FROM KRY_HAFTALIK_IZIN
WHERE talep_gun IS NOT NULL AND sube_adi = @sube
ORDER BY talep_tarihi", new { sube = p.IsGrubu }).ToList();

        /* Grup ayarı varsa yalnızca sorumlu olduğu gruplardaki personel.
           Aynı şubede mağaza müdürü kasiyerlerin, reyon şefi reyon
           personelinin talebini görüyor; herkes herkesin talebini değil. */
        if (ayar is not null)
            talepler = talepler
                .Where(t => _portalYetki.Sorumlu(ayar, (string)t.pozisyon))
                .ToList();

        return Ok(new
        {
            talepler = talepler.Select(t => new
            {
                t.id,
                t.personelKodu,
                t.adSoyad,
                t.pozisyon,
                mevcutGun = t.gun is null ? null : GunAdi((int)t.gun),
                talepGun = GunAdi((int)t.talepGun),
                t.talepTarihi,
                t.talepNotu
            })
        });
    }

    /* ====================================================================== */
    /* Yardımcılar                                                           */
    /* ====================================================================== */

    /// <summary>
    /// Ünvanın bağlı olduğu grup haftalık izin seçimine izin veriyor mu.
    ///
    /// Grup tanımlı değilse izin veriliyor: tanım eksikken personelin
    /// hakkını kapatmak yanlış olurdu.
    /// </summary>
    private bool SecimHakki(System.Data.IDbConnection db, string pozisyon)
    {
        if (string.IsNullOrWhiteSpace(pozisyon)) return true;

        var hedef = PersonelKaynagiServisi.MeslekAnahtari(pozisyon);

        foreach (var g in db.Query(@"
SELECT pozisyonlar, izin_secebilir AS izinSecebilir
FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad"))
        {
            var uyuyor = ((string)g.pozisyonlar ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Any(x => PersonelKaynagiServisi.MeslekAnahtari(x) == hedef);

            if (uyuyor) return (bool)g.izinSecebilir;
        }

        return true;
    }

    public static string GunAdi(int g) => g switch
    {
        0 => "Pazar",
        1 => "Pazartesi",
        2 => "Salı",
        3 => "Çarşamba",
        4 => "Perşembe",
        5 => "Cuma",
        6 => "Cumartesi",
        _ => "—"
    };

    /// <summary>
    /// Mobil jetondan sicil numarası.
    ///
    /// Jetonda ayrı bir "personelKodu" alanı yok; sicil kullanıcı adının
    /// içinde kodlu: <c>personel:14721|cihaz-abc</c>. Ayrı bir alan
    /// arandığında her istek "oturumunuz sona erdi" ile dönüyordu.
    /// </summary>
    private string PersonelKodu()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return null;

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? govde : govde[..i];
    }

    private PersonelKaydi Kendisi()
    {
        var kod = PersonelKodu();

        if (string.IsNullOrWhiteSpace(kod)) return null;

        try
        {
            return _kaynak.TumPersonelleriGetir()
                .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim() == kod.Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel bilgisi okunamadı");
            return null;
        }
    }

    /// <summary>Oturumdaki kişi mağaza müdürü mü.</summary>
    /// <summary>
    /// Bu kişi şubesinin izin taleplerini onaylayabilir mi.
    ///
    /// <para>
    /// Önce portal yetki ekranındaki <c>izin-onay</c> anahtarına bakılıyor
    /// (Yetkiler → Mobil, Özlük modülleri). Kişi, ünvan ya da grup için tanım
    /// varsa o geçerli: "Mağaza Sorumlusu" gibi bir ünvana onay vermek ya
    /// da tek bir müdürden almak artık mümkün.
    /// </para>
    ///
    /// <para>
    /// Hiç tanım yoksa eski kural yedek olarak çalışıyor: ünvanda "müdür"
    /// geçip "yardımcı" geçmiyorsa onaylar. Tanımsızı kapalı saymak, yetki
    /// ekranına hiç girilmemiş kurumda bütün onayları durdururdu.
    /// </para>
    /// </summary>
    private bool MudurMu()
    {
        var p = Kendisi();

        if (p is null) return false;

        var yetki = _portalYetki.Acik(
            (p.PersonelKodu ?? "").Trim(), p.Pozisyon ?? "", "izinonay");

        if (yetki is not null) return yetki.Value;

        var poz = PersonelKaynagiServisi.MeslekAnahtari(p.Pozisyon ?? "");

        return poz.Contains("mudur") && !poz.Contains("yardimci");
    }

    /// <summary>
    /// Bu kişi haftalık izin taleplerini onaylayabilir mi, hangi ayarla.
    ///
    /// <para>
    /// Grubunun portalda ayarı varsa (Yetkiler → Gruplar → gruba tıkla)
    /// yalnızca o geçerli: "Haftalık izin onaylar" işaretliyse, sorumlu
    /// olduğu gruplardaki personelin talebini onaylıyor. Ayar yoksa eski
    /// kural (izinonay yetkisi, o da yoksa müdür ünvanı).
    /// </para>
    /// </summary>
    private (bool Yetkili, PortalYetkiServisi.GrupAyari Ayar) OnayYetkisi()
    {
        var p = Kendisi();

        if (p is null) return (false, null);

        var ayar = _portalYetki.Ayar(p.Pozisyon ?? "");

        if (ayar is not null) return (ayar.HaftalikIzinOnay, ayar);

        return (MudurMu(), null);
    }

    private string OnaylayanAdi()
    {
        var p = Kendisi();

        return p is null ? Kullanici : $"{p.Ad} {p.Soyad}".Trim();
    }

    /// <summary>Şubenin mağaza müdürlerine bildirim gönderir.</summary>
    private async Task MudurlereHaberVer(string sube, string ad, int gun, string talepPozisyonu = null)
    {
        if (string.IsNullOrWhiteSpace(sube)) return;

        try
        {
            /* Bildirim de onay kuralıyla aynı kişilere: grup ayarı varsa
               sorumlu olanlara, yoksa şubedeki müdürlere. İkisi ayrışırsa
               bildirim onaylayamayan kişiye gider, onaylayabilen haberdar
               olmazdı. */
            var mudurler = _kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1)
                .Where(x => PersonelKaynagiServisi.Benziyor(x.IsGrubu ?? "", sube))
                .Where(x =>
                {
                    var ayar = _portalYetki.Ayar(x.Pozisyon ?? "");

                    if (ayar is not null)
                        return ayar.HaftalikIzinOnay
                            && (talepPozisyonu is null || _portalYetki.Sorumlu(ayar, talepPozisyonu));

                    var poz = PersonelKaynagiServisi.MeslekAnahtari(x.Pozisyon ?? "");
                    return poz.Contains("mudur") && !poz.Contains("yardimci");
                })
                .ToList();

            foreach (var m in mudurler)
            {
                await _bildirim.Gonder(
                    (m.PersonelKodu ?? "").Trim(),
                    "İzin günü onayı bekliyor",
                    $"{ad} haftalık izin günü olarak {GunAdi(gun)} seçti. "
                    + "Uygulamadan onaylayabilirsiniz.",
                    "izin");
            }
        }
        catch (Exception hata)
        {
            /* Bildirim gitmezse talep yine kayıtlı; müdür listeden görür */
            _kayit.LogWarning(hata, "İzin günü onayı bildirimi gönderilemedi");
        }
    }
}

/* ========================================================================== */

/// <summary>Personelin haftalık izin günü seçimi.</summary>
public class IzinSecimGirdi
{
    /// <summary>0=Pazar … 6=Cumartesi</summary>
    public int Gun { get; set; }

    public string Not { get; set; }
}

/// <summary>
/// İzin günü talebinin onayı.
///
/// Adı "IzinOnayGirdi": başvuru onayları için Modeller.cs içinde zaten bir
/// OnayGirdi var ve denetleyici isim alanındaki aynı adlı sınıf onu
/// gölgeliyordu.
/// </summary>
public class IzinOnayGirdi
{
    public bool Onay { get; set; }
    public string Sebep { get; set; }
}

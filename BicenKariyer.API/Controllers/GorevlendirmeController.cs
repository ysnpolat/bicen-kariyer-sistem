using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Görevlendirme (26.10.2026): iş görüşmesi, toplantı, seminer, eğitim,
/// fuar… için şirketin gönderdiği şehir içi / şehir dışı görev.
///
/// <para>
/// Mobil uçlar (<c>Mobil…</c>) yalnız Personel jetonuyla, kişi yalnız
/// kendi kayıtlarını görür ve girer. Onay bekleyenler mobil İzin Onayları
/// listesinde (IzinTalepController.MobilBekleyenler; karar aynı uçtan).
/// Panel uçları İK rollerine açık; ayar ve akış
/// <see cref="GorevlendirmeServisi"/>'nde.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class GorevlendirmeController : ControllerBase
{
    private const string PanelRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK;
    private const string AyarRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi;

    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personel;
    private readonly GorevlendirmeServisi _gorev;
    private readonly BildirimServisi _bildirim;
    private readonly EkipServisi _ekip;
    private readonly ILogger<GorevlendirmeController> _kayit;

    public GorevlendirmeController(VeritabaniServisi vt, PersonelKaynagiServisi personel, GorevlendirmeServisi gorev,
        BildirimServisi bildirim, EkipServisi ekip, ILogger<GorevlendirmeController> kayit)
    {
        _vt = vt;
        _personel = personel;
        _gorev = gorev;
        _bildirim = bildirim;
        _ekip = ekip;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /* ==================================================================== */
    /* Mobil                                                                */
    /* ==================================================================== */

    private string PersonelKodu()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return i < 0 ? govde : govde[..i];
    }

    private PersonelKaydi Kendisi()
    {
        var kod = PersonelKodu();
        if (string.IsNullOrWhiteSpace(kod)) return null;
        return _personel.TumPersonelleriGetir()
            .FirstOrDefault(x => K(x.PersonelKodu) == K(kod) && x.Durum == 1);
    }

    private static object Disari(GorevlendirmeServisi.Kayit k)
    {
        var z = GorevlendirmeServisi.ZincirOku(k);
        return new
        {
            id = k.Id,
            kapsam = k.Kapsam,
            kapsamAdi = GorevlendirmeServisi.KapsamAdi(k.Kapsam),
            etkinlikTuru = k.EtkinlikTuru,
            etkinlikAdi = k.EtkinlikAdi,
            yer = k.Yer,
            gidis = k.Gidis,
            donus = k.Donus,
            gun = k.Gun,
            aciklama = k.Aciklama,
            durum = k.Durum,
            durumAdi = GorevlendirmeServisi.DurumAdi(k.Durum),
            kimde = GorevlendirmeServisi.Kimde(k),
            kararNot = k.KararNot,
            kararKisi = k.KararKisi,
            kararTarih = k.KararTarih,
            olusturma = k.Olusturma,
            sira = z is null ? null : IzinOnayZinciri.MobilSira(z),
            iptalEdilebilir = k.Durum == GorevlendirmeServisi.Bekliyor
                              || (k.Durum == GorevlendirmeServisi.Onaylandi && k.Gidis.Date > DateTime.Today),
        };
    }

    /// <summary>Ekran: açık mı, girebilir mi, türler, akış ve kendi kayıtlarım</summary>
    [HttpGet("Mobil")]
    [Authorize(Roles = "Personel")]
    public IActionResult Mobil()
    {
        var ayar = _gorev.AyarOku();
        var ben = Kendisi();
        if (ben is null) return Ok(new { acik = false, girebilir = false, neden = "Personel kaydınız bulunamadı.", kayitlar = new List<object>() });

        var (girebilir, neden) = _gorev.Girebilir(ayar, ben);

        List<object> kayitlar = new();
        try
        {
            _gorev.Kur();
            using var db = _vt.Baglanti();
            kayitlar = db.Query<GorevlendirmeServisi.Kayit>(GorevlendirmeServisi.Secim + @"
WHERE LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND olusturma >= DATEADD(MONTH, -12, GETDATE())
ORDER BY gidis DESC, id DESC", new { kod = (ben.PersonelKodu ?? "").Trim(), kodK = K(ben.PersonelKodu) })
                .Take(60).Select(Disari).ToList();
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Görevlendirmeler okunamadı");
        }

        /* Akışın önizlemesi: "Mağaza Müdürü → İnsan Kaynakları" */
        string akis = null;
        try
        {
            var z = girebilir ? _gorev.ZincirKur(ayar, ben) : null;
            akis = !ayar.OnayGerekli ? "Onay gerekmiyor; kaydınız İK'ya bilgi olarak düşer."
                : z is null ? null : IzinOnayZinciri.Ozet(z);
        }
        catch
        {
            /* önizleme olmadan da çalışır */
        }

        return Ok(new
        {
            acik = ayar.Acik && girebilir || kayitlar.Count > 0,
            girebilir,
            neden,
            onayGerekli = ayar.OnayGerekli,
            akis,
            turler = ayar.Turler,
            geriGun = ayar.GeriGun,
            enUzunGun = ayar.EnUzunGun,
            kayitlar,
        });
    }

    public class GirisGirdi
    {
        public string Kapsam { get; set; }
        public string EtkinlikTuru { get; set; }
        public string EtkinlikAdi { get; set; }
        public string Yer { get; set; }
        public DateTime? Gidis { get; set; }
        public DateTime? Donus { get; set; }
        public string Aciklama { get; set; }
    }

    [HttpPost("Mobil")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilGir([FromBody] GirisGirdi g)
    {
        var ben = Kendisi();
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var ayar = _gorev.AyarOku();
        var (girebilir, neden) = _gorev.Girebilir(ayar, ben);
        if (!girebilir) return StatusCode(403, new { hata = neden });

        if (g is null) return BadRequest(new { hata = "Bilgiler okunamadı." });

        var kapsam = g.Kapsam is GorevlendirmeServisi.SehirDisi ? GorevlendirmeServisi.SehirDisi
            : g.Kapsam is GorevlendirmeServisi.SehirIci ? GorevlendirmeServisi.SehirIci : null;
        if (kapsam is null) return BadRequest(new { hata = "Şehir içi ya da şehir dışı seçiniz." });

        var tur = ayar.Turler.FirstOrDefault(x => string.Equals(x, (g.EtkinlikTuru ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
        if (tur is null) return BadRequest(new { hata = "Etkinlik türünü seçiniz." });

        var etkinlik = (g.EtkinlikAdi ?? "").Trim();
        var yer = (g.Yer ?? "").Trim();
        var aciklama = (g.Aciklama ?? "").Trim();

        if (etkinlik.Length < 3) return BadRequest(new { hata = "Etkinliğin adını yazınız.", ayrinti = "Ör. \"Tedarikçi toplantısı\", \"Gıda güvenliği semineri\"." });
        if (yer.Length < 2) return BadRequest(new { hata = "Gidilecek yeri yazınız.", ayrinti = "Şehir dışında il, şehir içinde firma ya da adres." });
        if (aciklama.Length < 10) return BadRequest(new { hata = "Açıklama zorunlu.", ayrinti = "En az 10 karakter: görevin amacı, kimin adına, kimlerle." });

        if (etkinlik.Length > 200) etkinlik = etkinlik[..200];
        if (yer.Length > 150) yer = yer[..150];
        if (aciklama.Length > 1000) aciklama = aciklama[..1000];

        if (g.Gidis is null || g.Donus is null) return BadRequest(new { hata = "Gidiş ve dönüş tarihini seçiniz." });
        var gidis = g.Gidis.Value.Date;
        var donus = g.Donus.Value.Date;

        if (donus < gidis) return BadRequest(new { hata = "Dönüş tarihi gidişten önce olamaz." });
        if (gidis < DateTime.Today.AddDays(-ayar.GeriGun))
            return BadRequest(new { hata = $"Görevlendirme en fazla {ayar.GeriGun} gün geriye dönük girilebilir." });
        if (gidis > DateTime.Today.AddDays(365)) return BadRequest(new { hata = "Gidiş tarihi bir yıldan ileri olamaz." });
        if ((donus - gidis).Days + 1 > ayar.EnUzunGun)
            return BadRequest(new { hata = $"Bir görevlendirme en fazla {ayar.EnUzunGun} gün olabilir." });

        _gorev.Kur();
        using var db = _vt.Baglanti();

        var cakisan = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_GOREVLENDIRME
WHERE LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodK) AND durum IN (@b, @o) AND gidis <= @donus AND donus >= @gidis",
            new { kod = (ben.PersonelKodu ?? "").Trim(), kodK = K(ben.PersonelKodu), b = GorevlendirmeServisi.Bekliyor, o = GorevlendirmeServisi.Onaylandi, gidis, donus });
        if (cakisan > 0) return BadRequest(new { hata = "Bu tarihlerde başka bir görevlendirmeniz var." });

        var z = _gorev.ZincirKur(ayar, ben);
        int? ilk = z is null ? null : HttpContext.RequestServices.GetRequiredService<IzinOnayZinciri>().Ilerle(z, -1, ben.PersonelKodu, ben.IsGrubu);
        var durum = ilk is null ? GorevlendirmeServisi.Onaylandi : GorevlendirmeServisi.Bekliyor;
        var adSoyad = $"{ben.Ad} {ben.Soyad}".Trim();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_GOREVLENDIRME
    (personel_kodu, ad_soyad, birim, pozisyon, kapsam, etkinlik_turu, etkinlik_adi, yer, gidis, donus, aciklama,
     durum, zincir, asama, karar_kisi, karar_tarih, kaynak)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @birim, @poz, @kapsam, @tur, @etkinlik, @yer, @gidis, @donus, @aciklama,
        @durum, @zincir, @asama, @kararKisi, @kararTarih, N'uygulama')",
            new
            {
                kod = (ben.PersonelKodu ?? "").Trim(), ad = adSoyad, birim = ben.IsGrubu, poz = ben.Pozisyon,
                kapsam, tur, etkinlik, yer, gidis, donus, aciklama, durum,
                zincir = z is null ? null : IzinOnayZinciri.Json(z), asama = ilk ?? 0,
                kararKisi = ilk is null ? "Sistem (onay gerekmiyor)" : null,
                kararTarih = ilk is null ? DateTime.Now : (DateTime?)null,
            });

        var k = _gorev.Getir(db, id);

        try
        {
            if (ilk is not null) await _gorev.SiradakineHaber(k, z, ilk.Value);
            else if (ayar.IkBilgi)
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Yeni görevlendirme",
                    $"{adSoyad} · {yer} · {tur} · {gidis:dd.MM} – {donus:dd.MM}", "yillikizin");
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Görevlendirme bildirimi gönderilemedi");
        }

        return Ok(new
        {
            basarili = true,
            mesaj = ilk is null ? "Görevlendirmeniz kaydedildi." : $"Görevlendirmeniz {IzinOnayZinciri.AdimAl(z, ilk.Value).Ad} onayına gönderildi.",
            kayit = Disari(k),
        });
    }

    [HttpPost("Mobil/{id:int}/Iptal")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilIptal(int id)
    {
        var ben = Kendisi();
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        _gorev.Kur();
        using var db = _vt.Baglanti();
        var k = _gorev.Getir(db, id);

        /* Başkasının kaydı "bulunamadı": kimlik denemesiyle bilgi sızmasın */
        if (k is null || K(k.PersonelKodu) != K(ben.PersonelKodu)) return NotFound(new { hata = "Görevlendirme bulunamadı." });

        var olur = k.Durum == GorevlendirmeServisi.Bekliyor
                   || (k.Durum == GorevlendirmeServisi.Onaylandi && k.Gidis.Date > DateTime.Today);
        if (!olur) return BadRequest(new { hata = "Bu görevlendirme iptal edilemez." });

        db.Execute(@"
UPDATE KRY_GOREVLENDIRME SET durum = @iptal, guncelleme = SYSDATETIME(),
    karar_kisi = @kim, karar_not = N'Personel iptal etti', karar_tarih = SYSDATETIME()
WHERE id = @id AND durum = @eski", new { id, iptal = GorevlendirmeServisi.Iptal, eski = k.Durum, kim = k.AdSoyad });

        return Ok(new { basarili = true, mesaj = "Görevlendirme iptal edildi." });
    }

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    private string Rol => User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private string PanelKisi => User?.Identity?.Name ?? "Panel";

    [HttpGet("Ayar")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult AyarOku()
    {
        var birimler = _ekip.Aktifler()
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new { ad = g.Key, kisi = g.Count(), merkez = _gorev.MerkezMi(g.First()) })
            .OrderBy(x => x.ad)
            .ToList();

        return Ok(new
        {
            ayar = _gorev.AyarOku(),
            birimler,
            varsayilanTurler = GorevlendirmeServisi.VarsayilanTurler,
            duzenleyebilir = Rol is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi,
        });
    }

    [HttpPost("Ayar")]
    [Authorize(Roles = AyarRolleri)]
    public IActionResult AyarKaydet([FromBody] GorevlendirmeServisi.Ayar girdi)
    {
        if (girdi is null) return BadRequest(new { hata = "Ayar okunamadı." });
        var a = GorevlendirmeServisi.Duzelt(girdi);
        if (a.Kapsam == "secili" && a.Birimler.Count == 0)
            return BadRequest(new { hata = "Seçili birimler için en az bir birim seçiniz." });

        _gorev.AyarYaz(a);
        return Ok(new { basarili = true, ayar = a });
    }

    [HttpGet("Liste")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Liste([FromQuery] DateTime? bas, [FromQuery] DateTime? bit, [FromQuery] string durum = null)
    {
        var b = (bas ?? DateTime.Today.AddDays(-30)).Date;
        var s = (bit ?? DateTime.Today.AddDays(60)).Date;
        if (s < b) (b, s) = (s, b);
        if ((s - b).TotalDays > 400) b = s.AddDays(-400);

        _gorev.Kur();
        using var db = _vt.Baglanti();

        var kayitlar = db.Query<GorevlendirmeServisi.Kayit>(GorevlendirmeServisi.Secim + @"
WHERE gidis <= @s AND donus >= @b AND (@durum IS NULL OR durum = @durum)
ORDER BY gidis DESC, id DESC", new { b, s, durum = string.IsNullOrWhiteSpace(durum) ? null : durum.Trim() }).ToList();

        var bugun = DateTime.Today;
        var satirlar = kayitlar.Select(k =>
        {
            var z = GorevlendirmeServisi.ZincirOku(k);
            var adim = z is null || k.Durum != GorevlendirmeServisi.Bekliyor ? null : IzinOnayZinciri.AdimAl(z, k.Asama);
            return new
            {
                id = k.Id,
                personelKodu = k.PersonelKodu,
                adSoyad = k.AdSoyad,
                birim = k.Birim,
                pozisyon = k.Pozisyon,
                kapsam = k.Kapsam,
                kapsamAdi = GorevlendirmeServisi.KapsamAdi(k.Kapsam),
                etkinlikTuru = k.EtkinlikTuru,
                etkinlikAdi = k.EtkinlikAdi,
                yer = k.Yer,
                gidis = k.Gidis,
                donus = k.Donus,
                gun = k.Gun,
                aciklama = k.Aciklama,
                durum = k.Durum,
                durumAdi = GorevlendirmeServisi.DurumAdi(k.Durum),
                kimde = GorevlendirmeServisi.Kimde(k),
                gorevde = k.Durum == GorevlendirmeServisi.Onaylandi && k.Gidis.Date <= bugun && k.Donus.Date >= bugun,
                kararKisi = k.KararKisi,
                kararNot = k.KararNot,
                kararTarih = k.KararTarih,
                olusturma = k.Olusturma,
                kaynak = k.Kaynak,
                akis = z is null ? null : IzinOnayZinciri.Akis(z, k.Asama, k.Durum == GorevlendirmeServisi.Bekliyor ? "" : "Onaylandı"),
                karar = adim is not null && (Rol is Roller.Admin or Roller.GenelMudurYardimcisi
                                             || (adim.Tur == IzinOnayZinciri.TurIk && Rol is Roller.IK or Roller.IKYoneticisi)),
            };
        }).ToList();

        return Ok(new
        {
            bas = b,
            bit = s,
            ozet = new
            {
                toplam = satirlar.Count,
                bekleyen = satirlar.Count(x => x.durum == GorevlendirmeServisi.Bekliyor),
                onayli = satirlar.Count(x => x.durum == GorevlendirmeServisi.Onaylandi),
                gorevde = satirlar.Count(x => x.gorevde),
                sehirDisi = satirlar.Count(x => x.kapsam == GorevlendirmeServisi.SehirDisi && x.durum == GorevlendirmeServisi.Onaylandi),
            },
            kayitlar = satirlar,
        });
    }

    public class KararGirdi
    {
        public bool Onay { get; set; }
        public string Not { get; set; }
    }

    [HttpPost("{id:int}/Karar")]
    [Authorize(Roles = PanelRolleri)]
    public async Task<IActionResult> Karar(int id, [FromBody] KararGirdi g)
    {
        var kim = PanelKisi;
        if (kim.Length > 100) kim = kim[..100];
        var sonuc = await _gorev.Karar(id, g?.Onay ?? false, g?.Not, $"{kim} (panel)", null, Rol);
        return sonuc.Hata is null
            ? Ok(new { basarili = true, mesaj = sonuc.Mesaj })
            : StatusCode(sonuc.Kod, new { hata = sonuc.Hata });
    }
}

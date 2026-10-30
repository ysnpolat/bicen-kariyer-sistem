using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Fazla mesai (06.10.2026)
/// ---------------------------------------------------------------------------
/// <list type="number">
/// <item>Yönetici Biçen360 › Ekibim › personel › "Fazla mesai gir": tarih,
/// başlangıç ve bitiş saati, neden.</item>
/// <item>Form (İK-FM-01) doldurulup birimin izin formu adresine (şube maili)
/// PDF olarak gider; personelin belgelerine de kaydolur.</item>
/// <item>Şubede çıktı alınır; çalışan, birim yöneticisi ve bölge müdürü
/// imzalar, ıslak imzalı form İK'ya fiziki gönderilir.</item>
/// <item>İK, Personel Talepleri › Fazla mesai'de evrakı yükleyip onaylar
/// (evrak yüklenmeden onaylanamaz) ya da reddeder.</item>
/// </list>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FazlaMesaiController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly IzinOnayKuralServisi _kural;
    private readonly OrgOnayServisi _orgOnay;
    private readonly IzinFormuServisi _form;
    private readonly BildirimServisi _bildirim;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<FazlaMesaiController> _kayit;
    private readonly FazlaMesaiKuralServisi _fmKural;

    private static readonly CultureInfo Tr = new("tr-TR");

    /// <summary>Tek kayıtta en fazla süre (saat)</summary>
    private static int EnCokSaat => Parametre.Sayi("fm.enCokSaat");

    /// <summary>Ne kadar geriye dönük girilebilir (gün)</summary>
    private static int GeriyeGun => Parametre.Sayi("fm.geriyeGun");

    public FazlaMesaiController(VeritabaniServisi vt, EkipServisi ekip, IzinOnayKuralServisi kural,
        IzinFormuServisi form, BildirimServisi bildirim, IConfiguration yapilandirma,
        IWebHostEnvironment ortam, ILogger<FazlaMesaiController> kayit, OrgOnayServisi orgOnay,
        FazlaMesaiKuralServisi fmKural)
    {
        _fmKural = fmKural;
        _orgOnay = orgOnay;
        _vt = vt;
        _ekip = ekip;
        _kural = kural;
        _form = form;
        _bildirim = bildirim;
        _yapilandirma = yapilandirma;
        _ortam = ortam;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool PersonelMi => User?.IsInRole("Personel") ?? false;

    private bool IkYetkili =>
        !PersonelMi && Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    private string PanelAdi =>
        User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    /// <summary>Mobil oturumdaki sicil ("personel:SICIL|...")</summary>
    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return i < 0 ? govde : govde[..i];
    }

    private static string AdSoyad(PersonelKaydi p) => $"{p.Ad} {p.Soyad}".Trim();

    private static readonly Dictionary<string, string> DurumAdi = new()
    {
        ["form"] = "Birim yöneticisinin imzalı formu bekleniyor",
        ["ust"] = "Üst yönetici onayında",
        ["bekliyor"] = "İK onayı ve ıslak imzalı form bekleniyor",
        ["onaylandi"] = "Onaylandı",
        ["reddedildi"] = "Reddedildi",
        ["iptal"] = "İptal edildi",
    };

    private const string Secim = @"
SELECT id, personel_kodu AS sicil, ad_soyad AS adSoyad, sube, gorev, tarih, baslangic, bitis,
       sure_dk AS sureDk, aciklama, talep_eden AS talepEden, talep_eden_ad AS talepEdenAd,
       birim_yonetici AS birimYonetici, bolge_muduru AS bolgeMuduru, durum,
       form_eposta AS formEposta, form_gonderim AS formGonderim, form_hata AS formHata,
       belge_id AS belgeId, belge_yukleyen AS belgeYukleyen, belge_tarihi AS belgeTarihi,
       karar_veren AS kararVeren, karar_tarihi AS kararTarihi, karar_notu AS kararNotu,
       iptal_eden AS iptalEden, olusturma,
       onay_sube AS onaySube, ust_karar AS ustKarar, ust_kisi AS ustKisi, ust_tarih AS ustTarih, ust_not AS ustNot,
       bolge_belge_id AS bolgeBelgeId, bolge_belge_yukleyen AS bolgeBelgeYukleyen, bolge_belge_tarihi AS bolgeBelgeTarihi,
       birim_onay AS birimOnay, birim_onay_tarihi AS birimOnayTarihi
FROM KRY_FAZLA_MESAI";

    private static object Disari(dynamic r) => new
    {
        id = (int)r.id,
        sicil = (string)r.sicil,
        adSoyad = (string)r.adSoyad,
        sube = (string)r.sube,
        gorev = (string)r.gorev,
        tarih = (DateTime)r.tarih,
        baslangic = (string)r.baslangic,
        bitis = (string)r.bitis,
        sureDk = (int)r.sureDk,
        sure = IzinFormuServisi.SureMetni((int)r.sureDk),
        aciklama = (string)r.aciklama,
        talepEden = (string)r.talepEdenAd ?? (string)r.talepEden,
        birimYonetici = (string)r.birimYonetici,
        bolgeMuduru = (string)r.bolgeMuduru,
        durum = (string)r.durum,
        durumAdi = DurumAdi.TryGetValue((string)r.durum ?? "", out var d) ? d : (string)r.durum,
        formEposta = (string)r.formEposta,
        formGonderim = (DateTime?)r.formGonderim,
        formHata = (string)r.formHata,
        belgeVar = r.belgeId is not null,
        belgeYukleyen = (string)r.belgeYukleyen,
        belgeTarihi = (DateTime?)r.belgeTarihi,
        kararVeren = (string)r.kararVeren,
        kararTarihi = (DateTime?)r.kararTarihi,
        kararNotu = (string)r.kararNotu,
        olusturma = (DateTime)r.olusturma,
        /* Onay akışı (08.10.2026) */
        ustKarar = (string)r.ustKarar,
        ustKisi = (string)r.ustKisi,
        ustTarih = (DateTime?)r.ustTarih,
        ustNot = (string)r.ustNot,
        /* Bölge müdürünün yüklediği imzalı form (09.10.2026) */
        bolgeBelgeVar = r.bolgeBelgeId is not null,
        bolgeBelgeYukleyen = (string)r.bolgeBelgeYukleyen,
        bolgeBelgeTarihi = (DateTime?)r.bolgeBelgeTarihi,
        birimOnay = (string)r.birimOnay,
        birimOnayTarihi = (DateTime?)r.birimOnayTarihi,
    };

    /* ==================================================================== */
    /* Mobil (yönetici)                                                     */
    /* ==================================================================== */

    /// <summary>Personelin fazla mesai kayıtları ve girilebilir mi (Ekibim › personel).</summary>
    [HttpGet("Mobil/Kisi/{sicil}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilKisi(string sicil)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için fazla mesai giremezsiniz." });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(Secim + @"
WHERE personel_kodu = @kod AND tarih >= @sinir
ORDER BY tarih DESC, id DESC", new { kod = hedef.PersonelKodu.Trim(), sinir = DateTime.Today.AddDays(-90) })
            .Select(Disari)
            .ToList();

        return Ok(new
        {
            girebilir = true,
            enCokSaat = EnCokSaat,
            geriyeGun = GeriyeGun,
            kayitlar,
        });
    }

    public class GirisGirdi
    {
        public string Sicil { get; set; }
        public string Tarih { get; set; }
        public string Baslangic { get; set; }
        public string Bitis { get; set; }
        public string Aciklama { get; set; }
    }

    private static bool SaatOku(string s, out TimeSpan t)
    {
        t = default;
        s = (s ?? "").Trim().Replace('.', ':');
        return TimeSpan.TryParseExact(s, new[] { @"hh\:mm", @"h\:mm" }, CultureInfo.InvariantCulture, out t)
               && t >= TimeSpan.Zero && t < TimeSpan.FromDays(1);
    }

    private static readonly System.Text.RegularExpressions.Regex AciklamaTarihDeseni = new(
        @"^\s*(\d{1,2})[./-](\d{2})(?:[./-](\d{4}|\d{2}))?(?!\d)[\s:,;·–\-]*",
        System.Text.RegularExpressions.RegexOptions.Compiled);

    /// <summary>
    /// Açıklamanın başındaki tarihi okur (gg.aa ya da gg.aa.yyyy). Tarih yoksa
    /// (null, açıklama, null); geçersiz ya da sınır dışıysa hata metni döner.
    /// </summary>
    private static (DateTime? Tarih, string Kalan, string Hata) AciklamadakiTarih(string aciklama)
    {
        var a = aciklama ?? "";
        var m = AciklamaTarihDeseni.Match(a);
        if (!m.Success) return (null, a, null);

        var gun = int.Parse(m.Groups[1].Value);
        var ay = int.Parse(m.Groups[2].Value);
        if (ay is < 1 or > 12 || gun is < 1 or > 31) return (null, a, null);

        var bugun = DateTime.Today;
        int yil;
        if (m.Groups[3].Success)
        {
            yil = int.Parse(m.Groups[3].Value);
            if (yil < 100) yil += 2000;
        }
        else
        {
            /* Yıl yazılmadıysa bu yıl; ay bu aydan sonraysa geçen yıl (ocakta "28.12") */
            yil = ay > bugun.Month ? bugun.Year - 1 : bugun.Year;
        }

        if (gun > DateTime.DaysInMonth(yil, ay))
            return (null, a, $"\"{m.Value.Trim()}\" geçerli bir tarih değil.");

        var t = new DateTime(yil, ay, gun);
        var sinir = bugun.AddDays(-GeriyeGun);

        if (t > bugun)
            return (null, a, $"{t:dd.MM.yyyy} ileri bir tarih; fazla mesai yapıldıktan sonra girilir.");

        if (t < sinir)
            return (null, a, $"{t:dd.MM.yyyy} için giriş süresi geçti: en fazla {GeriyeGun} gün öncesi ({sinir:dd.MM.yyyy}) girilebilir.");

        var kalan = a[m.Length..].Trim();
        if (kalan.Length < 3)
            return (null, a, $"Tarihten sonra fazla mesainin nedenini de yazınız (ör. \"{t:dd.MM} kapanış sonrası sayım\").");

        return (t, kalan, null);
    }

    /// <summary>Yönetici fazla mesai girer: kayıt, form, şube maili, İK'ya bildirim.</summary>
    [HttpPost("Mobil")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilGir([FromBody] GirisGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(g?.Sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için fazla mesai giremezsiniz." });

        return await Kaydet(ben, hedef, g, null);
    }

    public class PanelGirisGirdi : GirisGirdi
    {
        /// <summary>Kaydı adına açılan yönetici (formu o yükleyip onaylar)</summary>
        public string GirenSicil { get; set; }
    }

    /// <summary>
    /// Panelden geriye dönük giriş (13.10.2026): yayındaki uygulamada tarih
    /// seçimi son 7 günle sınırlı. İK, yöneticinin adına daha eski bir günü
    /// (fm.geriyeGun parametresine kadar) girer; kayıt uygulamadan girilmiş
    /// gibi işler: form maile gider, yöneticinin "imzalı formu yükleyin"
    /// kartı açılır, onay sırası aynıdır.
    /// </summary>
    [HttpPost("Panel")]
    public async Task<IActionResult> PanelGir([FromBody] PanelGirisGirdi g)
    {
        if (!IkYetkili) return Forbid();

        var hedef = _ekip.Kisi(g?.Sicil);
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        var ben = _ekip.Kisi(g?.GirenSicil);
        if (ben is null) return BadRequest(new { hata = "Kaydı adına gireceğiniz yöneticiyi seçiniz." });

        if (!_ekip.IslemYapabilir(ben, hedef))
            return BadRequest(new { hata = $"{AdSoyad(ben)} bu personele fazla mesai giremez; listeden başka bir yönetici seçiniz." });

        return await Kaydet(ben, hedef, g, PanelAdi);
    }

    private async Task<IActionResult> Kaydet(PersonelKaydi ben, PersonelKaydi hedef, GirisGirdi g, string panelGiren)
    {
        if (!DateTime.TryParseExact((g.Tarih ?? "").Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var tarih))
            return BadRequest(new { hata = "Tarih seçiniz." });

        /* Açıklamadaki tarih (13.10.2026): yayındaki 1.6 / 1.7 tarih
           seçiminde yalnızca son 7 günü gösteriyor. Açıklama "05.10" ya da
           "05.10.2026" ile başlıyorsa kayıt o güne yazılır, tarih
           açıklamadan çıkarılır. Ay iki haneli olmalı: "18.00" ya da
           "1.5 saat" gibi yazımlar tarih sayılmaz. */
        var (aciklamaTarihi, kalanAciklama, tarihHatasi) = AciklamadakiTarih(g.Aciklama);

        if (tarihHatasi is not null) return BadRequest(new { hata = tarihHatasi });

        if (aciklamaTarihi is DateTime at)
        {
            tarih = at;
            g.Aciklama = kalanAciklama;
        }

        if (tarih.Date > DateTime.Today)
            return BadRequest(new { hata = "İleri tarihli fazla mesai girilemez; mesai yapıldıktan sonra giriniz." });

        if (tarih.Date < DateTime.Today.AddDays(-GeriyeGun))
            return BadRequest(new { hata = $"En fazla {GeriyeGun} gün öncesine fazla mesai girilebilir." });

        if (!SaatOku(g.Baslangic, out var bas) || !SaatOku(g.Bitis, out var bit))
            return BadRequest(new { hata = "Başlangıç ve bitiş saatini SS:DD olarak yazınız (ör. 18:00)." });

        /* Bitiş başlangıçtan önceyse gece yarısını geçmiştir */
        var sure = bit > bas ? bit - bas : bit + TimeSpan.FromDays(1) - bas;
        var sureDk = (int)Math.Round(sure.TotalMinutes);

        var enAzDk = Parametre.Sayi("fm.enAzDakika");
        if (sureDk < enAzDk) return BadRequest(new { hata = $"Fazla mesai en az {enAzDk} dakika olmalı." });

        if (sureDk > EnCokSaat * 60)
            return BadRequest(new { hata = $"Tek seferde en fazla {EnCokSaat} saat girilebilir; saatleri kontrol ediniz." });

        var aciklama = (g.Aciklama ?? "").Trim();

        if (aciklama.Length < 3) return BadRequest(new { hata = "Fazla mesainin nedenini yazınız." });
        if (aciklama.Length > 500) aciklama = aciklama[..500];

        var kod = hedef.PersonelKodu.Trim();
        var basMetin = bas.ToString(@"hh\:mm");
        var bitMetin = bit.ToString(@"hh\:mm");

        using var db = _vt.Baglanti();

        /* Aynı gün çakışan kayıt (iptal/red hariç) */
        var ayniGun = db.Query<(string Bas, string Bit)>(@"
SELECT baslangic, bitis FROM KRY_FAZLA_MESAI
WHERE personel_kodu = @kod AND tarih = @tarih AND durum IN (N'ust', N'bekliyor', N'onaylandi')",
            new { kod, tarih = tarih.Date }).ToList();

        static (double A, double B) Aralik(TimeSpan a, TimeSpan b) =>
            (a.TotalMinutes, b > a ? b.TotalMinutes : b.TotalMinutes + 1440);

        var yeni = Aralik(bas, bit);

        foreach (var x in ayniGun)
        {
            if (!SaatOku(x.Bas, out var xb) || !SaatOku(x.Bit, out var xe)) continue;
            var eski = Aralik(xb, xe);
            if (yeni.A < eski.B && eski.A < yeni.B)
                return BadRequest(new { hata = $"Bu gün için {x.Bas} – {x.Bit} arası fazla mesai zaten girilmiş." });
        }

        /* Onay kutularına basılacak adlar: birim yöneticisi (onay tablosu, yoksa giren) ve bölge müdürü */
        string birimYonetici = null, bolgeMuduru = null;

        try
        {
            var (yoneticiler, _) = _kural.Onaylayanlar(hedef.PersonelKodu, hedef.Pozisyon, hedef.IsGrubu);
            birimYonetici = string.Join(" / ", yoneticiler.Where(x => K(x.PersonelKodu) != K(kod)).Take(2).Select(AdSoyad));
        }
        catch
        {
            /* onay tablosu okunamazsa giren yönetici */
        }

        if (string.IsNullOrWhiteSpace(birimYonetici)) birimYonetici = AdSoyad(ben);

        try
        {
            var sube = (hedef.IsGrubu ?? "").Trim();

            var bm = _ekip.Aktifler()
                .Where(x => EkipServisi.BolgeMuduruMu(x.Pozisyon))
                .FirstOrDefault(x => _ekip.BolgeSubeleri(x).Any(s =>
                    string.Equals(s.Trim(), sube, StringComparison.OrdinalIgnoreCase)
                    || PersonelKaynagiServisi.Benziyor(s, sube)));

            if (bm is not null && K(bm.PersonelKodu) != K(kod)) bolgeMuduru = AdSoyad(bm);
        }
        catch
        {
            /* bölge müdürü bulunamazsa kutu boş basılır */
        }

        /* Onay akışı (08.10.2026): yıllık izinle aynı. Giren yönetici 1. aşama;
           üst yönetici varsa onu bekler, yoksa ya da giren üst yöneticiyse İK. */
        var akis = FazlaMesaiAkisi.Baslangic(_orgOnay, ben, hedef);

        /* 14.10.2026: Yönetim › Fazla mesai akışı kuralı tutarsa ara onaylar
           ve form maili kuraldan; tutmazsa yukarıdaki eski akış */
        FazlaMesaiKuralServisi.Akis kuralAkisi = null;
        try
        {
            kuralAkisi = _fmKural.Olustur(ben, hedef);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Fazla mesai kuralı uygulanamadı; eski akış");
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_FAZLA_MESAI
    (personel_kodu, ad_soyad, sube, gorev, tarih, baslangic, bitis, sure_dk, aciklama,
     talep_eden, talep_eden_ad, birim_yonetici, bolge_muduru,
     durum, onay_sube, ust_karar, ust_kisi, ust_tarih, ust_not, akis)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @sube, @gorev, @tarih, @bas, @bit, @sureDk, @aciklama,
        @talepEden, @talepEdenAd, @birimYonetici, @bolgeMuduru,
        @durum, @onaySube, @ustKarar, @ustKisi, CASE WHEN @ustKarar IS NULL THEN NULL ELSE SYSDATETIME() END, @ustNot, @akisJson)",
            new
            {
                akisJson = kuralAkisi is null ? null : FazlaMesaiKuralServisi.Json(kuralAkisi),
                /* 09.10.2026: önce birim yöneticisi imzalı formu yükleyip onaylar;
                   üst yönetici / İK aşaması onunla belirlenir */
                durum = FazlaMesaiAkisi.FormBekliyor,
                onaySube = hedef.Sube,
                ustKarar = (string)null,
                ustKisi = (string)null,
                ustNot = (string)null,
                kod,
                ad = AdSoyad(hedef),
                sube = (hedef.IsGrubu ?? "").Trim(),
                gorev = hedef.Pozisyon,
                tarih = tarih.Date,
                bas = basMetin,
                bit = bitMetin,
                sureDk,
                aciklama,
                talepEden = ben.PersonelKodu.Trim(),
                talepEdenAd = AdSoyad(ben),
                birimYonetici = birimYonetici.Length > 200 ? birimYonetici[..200] : birimYonetici,
                bolgeMuduru,
            });

        /* Form ve mail: yanıt beklemesin diye değil, sonucu yöneticiye söylemek için bekleniyor */
        var (gitti, adres, hata) = await _form.FazlaMesaiGonderAsync(id);

        var metin = $"{AdSoyad(hedef)} · {tarih:dd.MM.yyyy} · {basMetin}–{bitMetin} ({IzinFormuServisi.SureMetni(sureDk)}) · {AdSoyad(ben)}"
                    + (panelGiren is null ? "" : $" · panelden giren: {panelGiren}");

        try
        {
            /* Girenin ana sayfasında "formu yükleyin" kartı; İzin Onayları'nda da görünür.
               1.6'nın kayıt ekranı eski adımları yazıyor: bildirim karta götürür. */
            FazlaMesaiAkisi.FormKartlariniHazirla(db, _orgOnay, ben);
            await _bildirim.Gonder(ben.PersonelKodu.Trim(), "Fazla mesai formunu yükleyin",
                (panelGiren is null ? "" : "İK sizin adınıza girdi · ")
                + $"{AdSoyad(hedef)} · {tarih:dd.MM} · imzalı formu yükleyip İzin Onayları'ndan onaylayın.", "anasayfa|eksik");
        }
        catch
        {
            /* bildirim gitmese de talep panelde */
        }

        _kayit.LogInformation("Fazla mesai #{Id}: {Metin}", id, metin);

        return Ok(new
        {
            id,
            basarili = true,
            sure = IzinFormuServisi.SureMetni(sureDk),
            formGitti = gitti,
            formAdres = adres,
            formHata = hata,
            durum = FazlaMesaiAkisi.FormBekliyor,
            onaylayacak = kuralAkisi is not null
                ? (kuralAkisi.Adimlar.Count > 0 ? string.Join(" → ", kuralAkisi.Adimlar.Select(x => x.Ad)) : null)
                : akis.Durum == FazlaMesaiAkisi.UstBekliyor
                    ? string.Join(", ", akis.Ust.Take(3).Select(AdSoyad))
                    : null,
            mesaj = (gitti
                ? $"Form {adres} adresine gönderildi. Çıktısını alıp çalışana ve bölge müdürüne imzalatın, siz de imzalayın."
                : $"Fazla mesai kaydedildi ama form maille gönderilemedi ({hata}). Formu ana sayfadaki karttan açıp yazdırabilirsiniz.")
                + " İmzalı formu ana sayfanızdaki \"Fazla mesai formunu yükleyin\" kartından yükleyip İzin Onayları'ndan onaylayın"
                + (kuralAkisi is not null
                    ? kuralAkisi.Adimlar.Count > 0
                        ? $"; ardından {string.Join(", ", kuralAkisi.Adimlar.Select(x => x.Ad))} ve İK onaylar."
                        : "; ardından İK onaylar."
                    : akis.Durum == FazlaMesaiAkisi.UstBekliyor
                        ? $"; ardından {string.Join(", ", akis.Ust.Take(3).Select(AdSoyad))} ve İK onaylar."
                        : "; ardından İK onaylar.")
                + " Islak imzalı aslını İK'ya gönderin.",
        });
    }

    /// <summary>
    /// Akış kontrolü (09.10.2026, panel): bir personele fazla mesaiyi kimler
    /// girebilir, girince onay kimlere gider, form hangi adrese gider ve
    /// forma hangi adlar basılır. Kayıt açmaz, mail göndermez.
    /// </summary>
    [HttpGet("Akis/{sicil}")]
    public IActionResult AkisOnizleme(string sicil)
    {
        if (!IkYetkili) return Forbid();

        var hedef = _ekip.Kisi(sicil);
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        var kod = hedef.PersonelKodu.Trim();
        object Kisi(PersonelKaydi p) => new { sicil = p.PersonelKodu.Trim(), ad = AdSoyad(p), gorev = p.Pozisyon, sube = p.IsGrubu };

        /* Girebilenler: Biçen360 Ekibim'den "Fazla mesai gir" açılan herkes */
        var girebilenler = _ekip.Aktifler()
            .Where(x => K(x.PersonelKodu) != K(kod) && _ekip.IslemYapabilir(x, hedef))
            .OrderBy(x => x.Ad).ThenBy(x => x.Soyad)
            .ToList();

        List<PersonelKaydi> birim = new(), ust = new();
        string birimUnvan = null, ustUnvan = null, hataMetni = null;
        try
        {
            (birim, _, birimUnvan, _) = _orgOnay.Onaylayicilar(hedef.PersonelKodu, hedef.Pozisyon, hedef.Sube);
            /* 14.10.2026: fazla mesaide şubede her zaman bölge müdürü */
            ust = _orgOnay.FazlaMesaiUst(hedef.PersonelKodu, hedef.Pozisyon, hedef.Sube, hedef.IsGrubu);
            ustUnvan = ust.Count > 0 ? "Bölge Müdürü" : null;
            birim = (birim ?? new()).Where(x => K(x.PersonelKodu) != K(kod)).ToList();
            ust = (ust ?? new()).Where(x => K(x.PersonelKodu) != K(kod)).ToList();
        }
        catch (Exception h)
        {
            hataMetni = "Onay tablosu okunamadı: " + h.Message;
        }

        /* Forma basılan adlar (MobilGir ile aynı kural) */
        string formBirim = null, formBolge = null;
        try
        {
            var (yoneticiler, _) = _kural.Onaylayanlar(hedef.PersonelKodu, hedef.Pozisyon, hedef.IsGrubu);
            formBirim = string.Join(" / ", yoneticiler.Where(x => K(x.PersonelKodu) != K(kod)).Take(2).Select(AdSoyad));
        }
        catch { /* giren yöneticinin adı basılır */ }

        try
        {
            var sube = (hedef.IsGrubu ?? "").Trim();
            var bm = _ekip.Aktifler()
                .Where(x => EkipServisi.BolgeMuduruMu(x.Pozisyon))
                .FirstOrDefault(x => _ekip.BolgeSubeleri(x).Any(s =>
                    string.Equals(s.Trim(), sube, StringComparison.OrdinalIgnoreCase) || PersonelKaynagiServisi.Benziyor(s, sube)));
            if (bm is not null && K(bm.PersonelKodu) != K(kod)) formBolge = AdSoyad(bm);
        }
        catch { /* kutu boş basılır */ }

        var (adresler, aciklama) = _form.Alicilar(hedef);

        var ustKume = ust.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        return Ok(new
        {
            kisi = Kisi(hedef),
            girebilenler = girebilenler.Select(x => new
            {
                sicil = x.PersonelKodu.Trim(),
                ad = AdSoyad(x),
                gorev = x.Pozisyon,
                sube = x.IsGrubu,
                /* Bu kişi girerse: üst yönetici onu girdiyse aşama onaylı sayılır */
                ustAsamaAtlanir = ust.Count == 0 || ustKume.Contains(K(x.PersonelKodu)),
                /* 14.10.2026: Fazla mesai akışı kuralı tutuyorsa onun adımları */
                kural = KuralOnizle(x, hedef),
            }),
            birim = birim.Select(Kisi),
            birimUnvan,
            ust = ust.Select(Kisi),
            ustUnvan,
            form = new { adresler, aciklama, birimYonetici = formBirim, bolgeMuduru = formBolge },
            hata = hataMetni,
            /* Panelden geriye dönük girişte tarih sınırı (13.10.2026) */
            geriyeGun = GeriyeGun,
        });
    }

    private object KuralOnizle(PersonelKaydi giren, PersonelKaydi hedef)
    {
        try
        {
            return _fmKural.Onizle(giren, hedef);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Giren yönetici, İK karar vermeden iptal edebilir.</summary>
    [HttpPost("Mobil/{id:int}/Iptal")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilIptal(int id)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        using var db = _vt.Baglanti();

        var n = db.Execute(@"
UPDATE KRY_FAZLA_MESAI SET durum = N'iptal', iptal_eden = @ad
WHERE id = @id AND durum IN (N'form', N'ust', N'bekliyor') AND talep_eden = @kod",
            new { id, kod = ben.PersonelKodu.Trim(), ad = AdSoyad(ben) });

        if (n > 0) FazlaMesaiAkisi.FormKartlariniKapat(db, id, "Kayıt iptal edildi");

        return n > 0
            ? Ok(new { basarili = true })
            : BadRequest(new { hata = "Yalnızca sizin girdiğiniz ve İK'nın henüz karar vermediği kayıt iptal edilebilir." });
    }

    /* ==================================================================== */
    /* Panel (İK)                                                           */
    /* ==================================================================== */

    [HttpGet("Liste")]
    public IActionResult Liste([FromQuery] string durum = null, [FromQuery] string bas = null, [FromQuery] string bit = null,
        [FromQuery] string uzman = null)
    {
        if (!IkYetkili) return Forbid();

        DateTime? b = DateTime.TryParse(bas, out var x1) ? x1.Date : null;
        DateTime? e = DateTime.TryParse(bit, out var x2) ? x2.Date : null;

        using var db = _vt.Baglanti();

        /* Uzman süzgeci (07.10.2026): İK uzmanı önce kendi şubelerini görür */
        var kapsam = UzmanKapsami.Olustur(db, HttpContext.RequestServices.GetRequiredService<AyarServisi>(),
            User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value, User?.Identity?.Name, uzman);

        var kayitlar = db.Query(Secim + @"
WHERE (@durum IS NULL OR durum = @durum)
  AND (@bas IS NULL OR tarih >= @bas) AND (@bit IS NULL OR tarih <= @bit)
ORDER BY CASE WHEN durum = N'bekliyor' THEN 0 WHEN durum = N'ust' THEN 1 WHEN durum = N'form' THEN 2 ELSE 3 END, tarih DESC, id DESC",
                new { durum = string.IsNullOrWhiteSpace(durum) ? null : durum, bas = b, bit = e })
            .Where(x => kapsam is null || kapsam.Icinde((string)x.sube))
            .Take(1000)
            .ToList();

        var hamlar = kayitlar;
        kayitlar = hamlar.Select(Disari).ToList();

        /* Üst yönetici onayındakiler: kimin onayını beklediği */
        var bekleyenAdlar = new Dictionary<int, string>();
        try
        {
            foreach (var r in db.Query("SELECT id, personel_kodu, gorev, sube, onay_sube, akis FROM KRY_FAZLA_MESAI WHERE durum = N'ust'"))
            {
                /* Kurallı kayıt: bekleyen adım */
                if (FazlaMesaiKuralServisi.Oku((string)r.akis)?.Gecerli is { } g)
                {
                    bekleyenAdlar[(int)r.id] = g.Adlar.Count > 0 ? $"{g.Ad} · {string.Join(", ", g.Adlar.Take(3))}" : g.Ad;
                    continue;
                }

                var (_, ust) = FazlaMesaiAkisi.Onaylayicilar(_orgOnay, (string)r.personel_kodu, (string)r.gorev,
                    (string)r.onay_sube ?? (string)r.sube, (string)r.sube);
                bekleyenAdlar[(int)r.id] = string.Join(", ", ust.Take(3).Select(AdSoyad));
            }
        }
        catch
        {
            /* şema okunamazsa ad yazılmaz */
        }

        var sayilar = kapsam is null
            ? db.Query<(string Durum, int Adet)>(
                    "SELECT durum, COUNT(*) FROM KRY_FAZLA_MESAI GROUP BY durum")
                .ToDictionary(x => x.Durum, x => x.Adet)
            : db.Query<(string Durum, string Sube)>("SELECT durum, sube FROM KRY_FAZLA_MESAI")
                .Where(x => kapsam.Icinde(x.Sube))
                .GroupBy(x => x.Durum)
                .ToDictionary(g => g.Key, g => g.Count());

        /* 15.10.2026: kayıt başına karşılık (ücret kuralları; onay sürecindekiler dahil) */
        var baz = BazUcretler();
        var karsilik = Karsiliklar(hamlar
            .Where(x => (string)x.durum is "form" or "ust" or "bekliyor" or "onaylandi")
            .Select(x => new FazlaMesaiUcretServisi.Girdi((int)x.id, (string)x.sicil, (string)x.gorev, (string)x.sube,
                (DateTime)x.tarih, (int)x.sureDk)), baz);

        return Ok(new
        {
            kayitlar,
            maasGorunur = baz.Count > 0,
            ucretler = karsilik.ToDictionary(x => x.Key, x => KarsilikDisari(x.Value)),
            ustOnaylayanlar = bekleyenAdlar,
            kapsam = UzmanKapsami.Ozet(kapsam),
            sayilar = new
            {
                form = sayilar.GetValueOrDefault("form"),
                ust = sayilar.GetValueOrDefault("ust"),
                bekliyor = sayilar.GetValueOrDefault("bekliyor"),
                onaylandi = sayilar.GetValueOrDefault("onaylandi"),
                reddedildi = sayilar.GetValueOrDefault("reddedildi"),
                iptal = sayilar.GetValueOrDefault("iptal"),
            },
        });
    }

    /// <summary>
    /// Fazla mesai raporu (09.10.2026): seçilen ayda kim, hangi şubede, kaç
    /// saat. <c>durum</c>: onaylandi (varsayılan) · surecte (onay bekleyen)
    /// · hepsi (iptal ve red hariç).
    /// </summary>
    [HttpGet("Rapor")]
    public IActionResult Rapor([FromQuery] string ay = null, [FromQuery] string durum = "onaylandi", [FromQuery] string uzman = null,
        [FromQuery] int? gun = null)
    {
        if (!IkYetkili) return Forbid();

        var bas = DateTime.TryParseExact((ay ?? "") + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var a)
            ? a
            : new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var ayBitis = bas.AddMonths(1);

        /* 15.10.2026: "bu güne kadar" (ayın 1'inden seçilen güne, o gün dahil) */
        var bit = gun is int g && g >= 1 && g <= DateTime.DaysInMonth(bas.Year, bas.Month) ? bas.AddDays(g) : ayBitis;

        var durumlar = (durum ?? "onaylandi") switch
        {
            "surecte" => new[] { "form", "ust", "bekliyor" },
            "hepsi" => new[] { "form", "ust", "bekliyor", "onaylandi" },
            _ => new[] { "onaylandi" },
        };

        using var db = _vt.Baglanti();

        var kapsam = UzmanKapsami.Olustur(db, HttpContext.RequestServices.GetRequiredService<AyarServisi>(),
            User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value, User?.Identity?.Name, uzman);

        var satirlar = db.Query(@"
SELECT id, personel_kodu AS sicil, ad_soyad AS ad, sube, gorev, tarih, baslangic, bitis, sure_dk AS dk, durum,
       aciklama, talep_eden_ad AS giren
FROM KRY_FAZLA_MESAI
WHERE tarih >= @bas AND tarih < @bit AND durum IN @durumlar
ORDER BY tarih, id", new { bas, bit, durumlar })
            .Where(x => kapsam is null || kapsam.Icinde((string)x.sube))
            .ToList();

        string Sube(dynamic x) => string.IsNullOrWhiteSpace((string)x.sube) ? "—" : ((string)x.sube).Trim();

        var subeler = satirlar
            .GroupBy(x => Sube(x))
            .Select(g => new
            {
                sube = g.Key,
                dk = g.Sum(x => (int)x.dk),
                kayit = g.Count(),
                kisi = g.Select(x => K((string)x.sicil)).Distinct().Count(),
            })
            .OrderByDescending(x => x.dk)
            .ToList();

        var kisiler = satirlar
            .GroupBy(x => K((string)x.sicil))
            .Select(g =>
            {
                var son = g.OrderByDescending(x => (DateTime)x.tarih).First();
                return new
                {
                    sicil = ((string)son.sicil ?? "").Trim(),
                    ad = (string)son.ad,
                    sube = Sube(son),
                    gorev = (string)son.gorev,
                    dk = g.Sum(x => (int)x.dk),
                    kayit = g.Count(),
                    son = (DateTime)son.tarih,
                };
            })
            .OrderByDescending(x => x.dk)
            .ToList();

        /* Excel biçimi (15.10.2026, İK'nın "EKİM AYI TOPLAM" tablosu): kişi
           başına bir satır; nedenler "05.10.2026-SEVKİYAT" biçiminde art arda,
           saat ve (yetkisi varsa) fazla mesai ücreti. */
        var ucretler = BazUcretler();
        var karsiliklar = Karsiliklar(satirlar.Select(x => new FazlaMesaiUcretServisi.Girdi(
            (int)x.id, (string)x.sicil, (string)x.gorev, (string)x.sube, (DateTime)x.tarih, (int)x.dk)), ucretler);
        var tr = new CultureInfo("tr-TR");
        var kimlikler = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var p in _ekip.Aktifler()) kimlikler[K(p.PersonelKodu)] = (p.KimlikNo ?? "").Trim();
        }
        catch { /* kimlik yazılmaz */ }

        var tablo = satirlar
            .GroupBy(x => K((string)x.sicil))
            .Select(gr =>
            {
                var sonKayit = gr.OrderByDescending(x => (DateTime)x.tarih).First();
                var dk = gr.Sum(x => (int)x.dk);
                var maasVar = ucretler.ContainsKey(gr.Key);
                var ks = gr.Select(x => karsiliklar.GetValueOrDefault((int)x.id)).Where(x => x is not null).ToList();
                return new
                {
                    sicil = ((string)sonKayit.sicil ?? "").Trim(),
                    tc = kimlikler.GetValueOrDefault(gr.Key),
                    ad = (string)sonKayit.ad,
                    sube = Sube(sonKayit),
                    gorev = (string)sonKayit.gorev,
                    neden = string.Join("-", gr.OrderBy(x => (DateTime)x.tarih)
                        .Select(x => $"{(DateTime)x.tarih:dd.MM.yyyy}-{((string)x.aciklama ?? "").Trim().ToUpper(tr)}")),
                    dk,
                    saat = Math.Round(dk / 60m, 2),
                    ucret = maasVar ? ks.Sum(x => x.Ucret ?? 0) : (decimal?)null,
                    /* Serbest zaman karşılığı olan kayıtların izin süresi (dk) */
                    izinDk = ks.Sum(x => x.IzinDk),
                    /* Ücretli ve izinli saat ayrımı */
                    ucretliDk = gr.Where(x => karsiliklar.GetValueOrDefault((int)x.id)?.Karsilik != FazlaMesaiUcretServisi.KarsilikIzin).Sum(x => (int)x.dk),
                };
            })
            .OrderBy(x => x.sube, StringComparer.Create(tr, true))
            .ThenBy(x => x.ad, StringComparer.Create(tr, true))
            .ToList();

        var gunler = Enumerable.Range(0, (bit - bas).Days)
            .Select(i => bas.AddDays(i))
            .Select(g => new { gun = g, dk = satirlar.Where(x => ((DateTime)x.tarih).Date == g).Sum(x => (int)x.dk) })
            .ToList();

        return Ok(new
        {
            ay = bas.ToString("yyyy-MM"),
            durum,
            sonGun = bit.AddDays(-1),
            maasGorunur = ucretler.Count > 0,
            tablo,
            toplamUcret = ucretler.Count > 0 ? tablo.Sum(x => x.ucret ?? 0) : (decimal?)null,
            toplamDk = satirlar.Sum(x => (int)x.dk),
            kayit = satirlar.Count,
            kisi = kisiler.Count,
            sube = subeler.Count,
            subeler,
            kisiler,
            gunler,
            kayitlar = satirlar.Select(x => new
            {
                id = (int)x.id,
                sicil = ((string)x.sicil ?? "").Trim(),
                ad = (string)x.ad,
                sube = Sube(x),
                gorev = (string)x.gorev,
                tarih = (DateTime)x.tarih,
                baslangic = (string)x.baslangic,
                bitis = (string)x.bitis,
                dk = (int)x.dk,
                durum = (string)x.durum,
                durumAdi = DurumAdi.TryGetValue((string)x.durum ?? "", out var d) ? d : (string)x.durum,
                aciklama = (string)x.aciklama,
                giren = (string)x.giren,
                /* Excel saat saat sayfası (23.10.2026) */
                tc = kimlikler.GetValueOrDefault(K((string)x.sicil)),
                ucret = ucretler.ContainsKey(K((string)x.sicil)) ? karsiliklar.GetValueOrDefault((int)x.id)?.Ucret : null,
                izinDk = karsiliklar.GetValueOrDefault((int)x.id)?.IzinDk ?? 0,
                gunTuru = karsiliklar.GetValueOrDefault((int)x.id)?.GunTuruAdi,
            }),
        });
    }

    /* ================================================================== */
    /* Personel özeti ve ücret (15.10.2026)                                */
    /* ================================================================== */

    /// <summary>Ücreti görebilir mi: İK yetkilisi ve rolünde ücret gizli değil</summary>
    private bool MaasGorebilir
    {
        get
        {
            try
            {
                return IkYetkili && !HttpContext.RequestServices.GetRequiredService<YetkiServisi>().Gizli(Rol, YetkiServisi.Ucret);
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Sicil → saat ücreti (aylık ücret ÷ aylık saat, ZAMSIZ). Çarpan
    /// ücret kuralından gelir (FazlaMesaiUcretServisi). Ücret gizliyse boş.
    /// </summary>
    private Dictionary<string, decimal> BazUcretler()
    {
        if (!MaasGorebilir) return new();

        try
        {
            /* Ortak önbellek (15.10.2026): Mikro bordrosunu her açılışta beklemesin */
            var aylik = MaasOnbellegi.Getir(HttpContext.RequestServices);
            var saat = Math.Max(1, Parametre.Sayi("fm.aylikSaat"));

            return aylik.ToDictionary(x => x.Key, x => Math.Round(x.Value / saat, 4), StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Fazla mesai ücretleri hesaplanamadı");
            return new();
        }
    }

    /// <summary>Kayıtların ücret / serbest zaman karşılığı (ücret kuralları)</summary>
    private Dictionary<int, FazlaMesaiUcretServisi.Sonuc> Karsiliklar(IEnumerable<FazlaMesaiUcretServisi.Girdi> kayitlar,
        Dictionary<string, decimal> baz)
    {
        try
        {
            return HttpContext.RequestServices.GetRequiredService<FazlaMesaiUcretServisi>()
                .Hesapla(kayitlar.ToList(), baz, ig => _kural.IsYeriBul(ig));
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Fazla mesai karşılıkları hesaplanamadı");
            return new();
        }
    }

    private static object KarsilikDisari(FazlaMesaiUcretServisi.Sonuc s) => s is null ? null : new
    {
        gunTuru = s.GunTuru,
        gunTuruAdi = s.GunTuruAdi,
        tatil = s.TatilAdi,
        karsilik = s.Karsilik,
        carpan = s.Carpan,
        ucret = s.Ucret,
        izinDk = s.IzinDk,
        kural = s.Kural,
    };

    /// <summary>
    /// Personel kartı (panel): bu personelin bütün fazla mesaileri, bu ay /
    /// geçen ay / bu yıl toplamları ve son 12 ayın dağılımı.
    /// </summary>
    [HttpGet("PersonelOzet/{sicil}")]
    public IActionResult PersonelOzet(string sicil)
    {
        if (!IkYetkili) return Forbid();

        var kod = (sicil ?? "").Trim();
        if (kod.Length == 0) return BadRequest(new { hata = "Sicil yok." });

        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT TOP 500 id, tarih, baslangic, bitis, sure_dk AS dk, durum, aciklama, talep_eden_ad AS giren, sube, gorev, ad_soyad AS ad
FROM KRY_FAZLA_MESAI
WHERE personel_kodu IN (@a, @b)
ORDER BY tarih DESC, id DESC", new { a = kod, b = K(kod) }).ToList();

        var ayBasi = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var gecenAy = ayBasi.AddMonths(-1);
        var yilBasi = new DateTime(DateTime.Today.Year, 1, 1);

        static bool Onayli(dynamic x) => (string)x.durum == "onaylandi";
        static bool Surecte(dynamic x) => (string)x.durum is "form" or "ust" or "bekliyor";

        int Dk(Func<dynamic, bool> f) => satirlar.Where(f).Sum(x => (int)x.dk);

        var baz = BazUcretler();
        var maasVar = baz.ContainsKey(K(kod));
        var karsilik = Karsiliklar(satirlar
            .Where(x => (string)x.durum is not ("reddedildi" or "iptal"))
            .Select(x => new FazlaMesaiUcretServisi.Girdi((int)x.id, kod, (string)x.gorev, (string)x.sube, (DateTime)x.tarih, (int)x.dk)), baz);

        decimal? Ucret(Func<dynamic, bool> f) => maasVar
            ? satirlar.Where(f).Sum(x => karsilik.TryGetValue((int)x.id, out var k) ? k.Ucret ?? 0 : 0)
            : null;

        int IzinDk(Func<dynamic, bool> f) =>
            satirlar.Where(f).Sum(x => karsilik.TryGetValue((int)x.id, out var k) ? k.IzinDk : 0);

        var aylar = Enumerable.Range(0, 12)
            .Select(i => ayBasi.AddMonths(-i))
            .Select(a => new
            {
                ay = a.ToString("yyyy-MM"),
                onayliDk = Dk(x => Onayli(x) && ((DateTime)x.tarih) >= a && ((DateTime)x.tarih) < a.AddMonths(1)),
                surecteDk = Dk(x => Surecte(x) && ((DateTime)x.tarih) >= a && ((DateTime)x.tarih) < a.AddMonths(1)),
            })
            .ToList();

        var son = satirlar.FirstOrDefault();
        var p = _ekip.Kisi(kod);

        var buAyOnayli = Dk(x => Onayli(x) && (DateTime)x.tarih >= ayBasi);

        return Ok(new
        {
            sicil = kod,
            ad = p is null ? (string)son?.ad : AdSoyad(p),
            sube = p?.IsGrubu ?? (string)son?.sube,
            gorev = p?.Pozisyon ?? (string)son?.gorev,
            ozet = new
            {
                buAyOnayliDk = buAyOnayli,
                buAySurecteDk = Dk(x => Surecte(x) && (DateTime)x.tarih >= ayBasi),
                buAyKayit = satirlar.Count(x => (DateTime)x.tarih >= ayBasi && (Onayli(x) || Surecte(x))),
                gecenAyOnayliDk = Dk(x => Onayli(x) && (DateTime)x.tarih >= gecenAy && (DateTime)x.tarih < ayBasi),
                buYilOnayliDk = Dk(x => Onayli(x) && (DateTime)x.tarih >= yilBasi),
                toplamOnayliDk = Dk(Onayli),
                toplamKayit = satirlar.Count(x => Onayli(x)),
                reddedilen = satirlar.Count(x => (string)x.durum == "reddedildi"),
                ilkTarih = satirlar.Count == 0 ? (DateTime?)null : satirlar.Min(x => (DateTime)x.tarih),
            },
            maasGorunur = maasVar,
            /* Ücret kurallarına göre (15.10.2026): onaylı ve onay sürecindeki ayrı */
            buAyUcret = Ucret(x => Onayli(x) && (DateTime)x.tarih >= ayBasi),
            buAySurecteUcret = Ucret(x => Surecte(x) && (DateTime)x.tarih >= ayBasi),
            /* Serbest zaman (izin) karşılığı olanlar: dakika */
            buAyIzinDk = IzinDk(x => (Onayli(x) || Surecte(x)) && (DateTime)x.tarih >= ayBasi),
            buYilIzinDk = IzinDk(x => Onayli(x) && (DateTime)x.tarih >= yilBasi),
            aylar,
            kayitlar = satirlar.Select(x => new
            {
                id = (int)x.id,
                tarih = (DateTime)x.tarih,
                baslangic = (string)x.baslangic,
                bitis = (string)x.bitis,
                dk = (int)x.dk,
                durum = (string)x.durum,
                durumAdi = DurumAdi.TryGetValue((string)x.durum ?? "", out var d) ? d : (string)x.durum,
                aciklama = (string)x.aciklama,
                giren = (string)x.giren,
                karsilik = karsilik.TryGetValue((int)x.id, out var ks) ? KarsilikDisari(ks) : null,
            }),
        });
    }

    [HttpGet("Sayac")]
    public IActionResult Sayac([FromQuery] string uzman = null)
    {
        if (!IkYetkili) return Ok(new { bekleyen = 0 });

        using var db = _vt.Baglanti();

        /* Uzman süzgeci: İK uzmanının sayacı kendi şubeleri (07.10.2026) */
        var kapsam = UzmanKapsami.Olustur(db, HttpContext.RequestServices.GetRequiredService<AyarServisi>(),
            User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value, User?.Identity?.Name, uzman);

        return Ok(new
        {
            bekleyen = db.Query<string>("SELECT sube FROM KRY_FAZLA_MESAI WHERE durum = N'bekliyor'")
                .Count(x => kapsam is null || kapsam.Icinde(x))
        });
    }

    /// <summary>Formun kendisi (yazdırma / görüntüleme)</summary>
    [HttpGet("{id:int}/Form")]
    public IActionResult Form(int id)
    {
        if (!IkYetkili) return Forbid();

        var html = _form.FazlaMesaiFormHtmlGetir(id);
        return html is null ? NotFound(new { hata = "Kayıt bulunamadı." }) : Content(html, "text/html; charset=utf-8");
    }

    /// <summary>Formu şubenin mailine yeniden gönderir</summary>
    /// <summary>
    /// Açık kayda güncel kuralı uygular (14.10.2026): kural sonradan yazıldıysa
    /// ya da değiştiyse onay sırası ve form alıcısı yeniden hesaplanır; form
    /// yeni alıcıya yeniden gönderilir. Birim yöneticisi aşamasındaki kayıt o
    /// aşamada kalır; üst onaydaki kayıt yeni sıranın ilk adımına geçer.
    /// </summary>
    [HttpPost("{id:int}/AkisYenile")]
    public async Task<IActionResult> AkisYenile(int id, [FromQuery] bool gonder = true)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();
        var (kod, govde) = await AkisYenileIc(db, id, gonder, zorla: true);
        return StatusCode(kod, govde);
    }

    /// <summary>Kurallar ekranından: bütün açık kayıtlara güncel kural (mail yalnızca alıcısı değişene)</summary>
    [HttpPost("AkisYenileToplu")]
    public async Task<IActionResult> AkisYenileToplu()
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();
        var idler = db.Query<int>("SELECT id FROM KRY_FAZLA_MESAI WHERE durum IN (N'form', N'ust') ORDER BY id").ToList();

        int degisen = 0, gonderilen = 0;
        foreach (var i in idler)
        {
            var (kod, govde) = await AkisYenileIc(db, i, gonder: true, zorla: false);
            if (kod != 200) continue;
            dynamic d = govde;
            if ((bool)d.degisti) degisen++;
            if ((bool)d.gonderildi) gonderilen++;
        }

        return Ok(new
        {
            basarili = true,
            toplam = idler.Count,
            degisen,
            gonderilen,
            mesaj = $"{idler.Count} açık kayıttan {degisen} tanesinin akışı güncel kurala göre değişti; {gonderilen} form yeni alıcısına gönderildi.",
        });
    }

    private async Task<(int, object)> AkisYenileIc(System.Data.IDbConnection db, int id, bool gonder, bool zorla)
    {
        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
        if (r is null) return (404, new { hata = "Kayıt bulunamadı." });

        string durum = (string)r.durum;
        if (durum is not (FazlaMesaiAkisi.FormBekliyor or FazlaMesaiAkisi.UstBekliyor))
            return (400, new { hata = "Yalnızca birim yöneticisi ya da üst yönetici onayındaki kayıtlarda akış yenilenir." });

        var hedef = _ekip.Kisi((string)r.personel_kodu) ?? new PersonelKaydi
        {
            PersonelKodu = ((string)r.personel_kodu ?? "").Trim(),
            Pozisyon = (string)r.gorev,
            IsGrubu = (string)r.sube,
            Sube = (string)r.onay_sube ?? (string)r.sube,
        };
        var giren = _ekip.Kisi((string)r.talep_eden) ?? new PersonelKaydi { PersonelKodu = ((string)r.talep_eden ?? "").Trim() };

        var eski = FazlaMesaiKuralServisi.Oku((string)r.akis);
        var yeni = _fmKural.Olustur(giren, hedef);

        string yeniDurum = durum;
        string ustKarar = (string)r.ust_karar, ustKisi = (string)r.ust_kisi, ustNot = (string)r.ust_not;

        /* Üst onaydaki kayıt: yeni sıranın ilk adımına (birim onayı verilmiş sayılır) */
        if (durum == FazlaMesaiAkisi.UstBekliyor && yeni is not null)
        {
            var j = _fmKural.Ilerle(yeni, hedef, new[] { (string)r.talep_eden });
            yeni.Asama = j ?? yeni.Adimlar.Count;
            if (j is null)
            {
                yeniDurum = FazlaMesaiAkisi.IkBekliyor;
                (ustKarar, ustKisi, ustNot) = ("Atlandı", "Sistem", $"Güncel kurala göre ara onay yok ({yeni.Kural}); İK onayına geçti.");
            }
        }

        var eskiJson = eski is null ? null : FazlaMesaiKuralServisi.Json(eski);
        var yeniJson = yeni is null ? null : FazlaMesaiKuralServisi.Json(yeni);

        /* Değişiklik: kural, adımlar ya da alıcı farklı */
        static string Imza(FazlaMesaiKuralServisi.Akis a) => a is null ? "eski" :
            $"{a.KuralId}|{string.Join(";", a.Adimlar.Select(x => $"{x.Onay}:{x.Sicil}"))}|{string.Join(";", a.Eposta)}";
        var degisti = Imza(eski) != Imza(yeni);

        if (!degisti && !zorla) return (200, new { basarili = true, degisti = false, gonderildi = false });

        db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET akis = @akis, durum = @durum, ust_karar = @ustKarar, ust_kisi = @ustKisi, ust_not = @ustNot,
    ust_tarih = CASE WHEN @durum <> durum THEN SYSDATETIME() ELSE ust_tarih END
WHERE id = @id AND durum = @eskiDurum",
            new { id, akis = yeniJson, durum = yeniDurum, ustKarar, ustKisi, ustNot, eskiDurum = durum });

        /* Bildirim: yeni bekleyen adıma ya da İK'ya */
        var ozet = $"{(string)r.ad_soyad} · {((DateTime)r.tarih):dd.MM.yyyy} · {(string)r.baslangic}–{(string)r.bitis}";
        try
        {
            if (durum == FazlaMesaiAkisi.UstBekliyor && degisti)
            {
                if (yeniDurum == FazlaMesaiAkisi.IkBekliyor)
                    await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Fazla mesai İK onayında", $"{ozet} · güncel kurala göre", "fazlamesai");
                else
                    foreach (var s in yeni?.Gecerli?.Siciller ?? new())
                        await _bildirim.Gonder(s, "Fazla mesai onayınızı bekliyor", ozet, "izinonay|fazlamesai");
            }
        }
        catch { /* akış kayıtlı */ }

        /* Form: zorla (tek kayıt) her zaman, toplu yalnızca alıcı değiştiyse */
        var eskiAlici = string.Join(";", eski?.Eposta ?? new());
        var yeniAlici = string.Join(";", yeni?.Eposta ?? new());
        var gonderilecek = gonder && (zorla || eskiAlici != yeniAlici);

        bool gitti = false;
        string adres = null, hata = null;
        if (gonderilecek) (gitti, adres, hata) = await _form.FazlaMesaiGonderAsync(id);

        var sira = yeni is null
            ? "Kural tutmuyor; bugünkü akış (şemadaki üst yönetici → İK)"
            : string.Join(" → ", yeni.Adimlar.Where(x => x.Karar != "atlandi").Select(x => x.Ad).Append("İK"));

        _kayit.LogInformation("Fazla mesai #{Id} akışı yenilendi: {Sira} · {Kim}", id, sira, PanelAdi);

        return (200, new
        {
            basarili = true,
            degisti,
            gonderildi = gitti,
            kural = yeni?.Kural,
            sira,
            durum = yeniDurum,
            adres,
            mesaj = $"Akış: {sira}."
                    + (gonderilecek
                        ? gitti ? $" Form {adres} adresine gönderildi." : $" Form gönderilemedi: {hata}"
                        : ""),
        });
    }

    [HttpPost("{id:int}/FormGonder")]
    public async Task<IActionResult> FormGonder(int id)
    {
        if (!IkYetkili) return Forbid();

        var (ok, adres, hata) = await _form.FazlaMesaiGonderAsync(id);
        return ok ? Ok(new { basarili = true, adres, uyari = hata }) : BadRequest(new { hata = hata ?? "Gönderilemedi.", adres });
    }

    private static readonly string[] Uzantilar =
        { ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".doc", ".docx" };

    /// <summary>Islak imzalı formun taraması / fotoğrafı</summary>
    [HttpPost("{id:int}/Belge")]
    [RequestSizeLimit(52_428_800)]
    public async Task<IActionResult> BelgeYukle(int id, IFormFile dosya)
    {
        if (!IkYetkili) return Forbid();
        return await BelgeKaydet(id, dosya, PanelAdi, bolge: false);
    }

    /// <summary>
    /// Bölge müdürü (üst yönetici) imzalı formu Biçen360'tan yükler
    /// (09.10.2026). Yayındaki 1.6 ana sayfa kartının evrak penceresinden
    /// IzinTalep/MazeretBelge'ye eksi kimlikle geliyor, oradan buraya.
    /// </summary>
    [NonAction]
    public async Task<IActionResult> BolgeFormYukleIc(int id, IFormFile dosya)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using (var db = _vt.Baglanti())
        {
            var r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
            if (r is null) return NotFound(new { hata = "Fazla mesai kaydı bulunamadı." });

            if (!FazlaMesaiAkisi.FormYukleyebilir(_orgOnay, ben, r))
                return BadRequest(new
                {
                    hata = (string)r.durum == FazlaMesaiAkisi.FormBekliyor
                        ? "Bu fazla mesainin formunu fazla mesaiyi giren ya da birim yöneticisi yükler."
                        : "Bu fazla mesainin formu yüklenmiş ve onaylanmış; aslı İK'ya gönderilir.",
                });
        }

        return await BelgeKaydet(id, dosya, AdSoyad(ben), bolge: true);
    }

    private async Task<IActionResult> BelgeKaydet(int id, IFormFile dosya, string yukleyen, bool bolge)
    {
        if (dosya is null && Request.HasFormContentType) dosya = Request.Form.Files.FirstOrDefault();
        if (dosya is null || dosya.Length == 0) return BadRequest(new { hata = "Dosya seçilmedi." });

        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        if (!Uzantilar.Contains(uzanti))
            uzanti = (dosya.ContentType ?? "").ToLowerInvariant() switch
            {
                "application/pdf" => ".pdf",
                "image/jpeg" or "image/jpg" => ".jpg",
                "image/png" => ".png",
                "image/heic" or "image/heif" => ".heic",
                "image/webp" => ".webp",
                _ => uzanti,
            };

        if (!Uzantilar.Contains(uzanti))
            return BadRequest(new { hata = "PDF, resim (JPG, PNG, HEIC) ya da Word dosyası yükleyiniz." });

        using var db = _vt.Baglanti();

        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });

        if (r is null) return NotFound(new { hata = "Kayıt bulunamadı." });
        if ((string)r.durum is "iptal") return BadRequest(new { hata = "İptal edilmiş kayda evrak yüklenemez." });

        var kod = ((string)r.personel_kodu ?? "").Trim();
        var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
        var diskAdi = $"{kod}_fazlamesai{id}_{(bolge ? "bolge" : "imzali")}_{Guid.NewGuid():N}{uzanti}";

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);
            await using var akis = new FileStream(Path.Combine(klasor, diskAdi), FileMode.Create);
            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Fazla mesai evrakı yazılamadı: {Klasor}", klasor);
            return StatusCode(500, new { hata = "Belge sunucuya yazılamadı." });
        }

        var belgeId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama, dosya, ozgun_ad, boyut, yukleyen, personele_acik)
OUTPUT INSERTED.id
VALUES (@kod, @kimlik, @ad, N'Fazla Mesai Formu', @baslik, @aciklama, @diskAdi, @ozgunAd, @boyut, @yukleyen, 0)",
            new
            {
                kod,
                kimlik = _ekip.Kisi(kod)?.KimlikNo?.Trim(),
                ad = (string)r.ad_soyad,
                baslik = $"Fazla mesai · {((DateTime)r.tarih):dd.MM.yyyy} · " + (bolge ? "bölge müdürü onayına imzalı form" : "ıslak imzalı form"),
                aciklama = $"Fazla mesai #{id} · imzalı form" + (bolge ? " (Biçen360, bölge müdürü)" : ""),
                diskAdi,
                ozgunAd = dosya.FileName,
                boyut = dosya.Length,
                yukleyen = yukleyen is { Length: > 100 } ? yukleyen[..100] : yukleyen,
            });

        if (bolge)
        {
            db.Execute(@"
UPDATE KRY_FAZLA_MESAI SET bolge_belge_id = @belgeId, bolge_belge_yukleyen = @ad, bolge_belge_tarihi = SYSDATETIME()
WHERE id = @id", new { id, belgeId, ad = yukleyen });

            FazlaMesaiAkisi.FormKartlariniKapat(db, id, $"İmzalı form yüklendi · {yukleyen}");

            /* Form personelin kendi e-postasına gittiyse (genel merkez / depo,
               13.10.2026) bu imzalı form İK evrakı da sayılır; aslı istenmez. */
            db.Execute(@"
UPDATE KRY_FAZLA_MESAI SET belge_id = @belgeId, belge_yukleyen = @ad, belge_tarihi = SYSDATETIME()
WHERE id = @id AND belge_id IS NULL AND form_kisisel = 1", new { id, belgeId, ad = yukleyen });
        }
        else
            db.Execute(@"
UPDATE KRY_FAZLA_MESAI SET belge_id = @belgeId, belge_yukleyen = @ad, belge_tarihi = SYSDATETIME()
WHERE id = @id", new { id, belgeId, ad = yukleyen });

        return Ok(new { basarili = true, belgeId, mesaj = bolge ? "İmzalı form yüklendi. İzin Onayları'ndan onaylayabilirsiniz." : null });
    }

    /// <summary>
    /// Birim yöneticisinin yüklediği imzalı form (09.10.2026): Biçen360'ta
    /// giren, birim yöneticisi ve bölge müdürü (onaylarken) açar; panelde İK.
    /// Telefon tarayıcısında açıldığı için belirteç ?t= ile de gelir.
    /// </summary>
    [HttpGet("{id:int}/ImzaliForm")]
    public IActionResult ImzaliForm(int id)
    {
        if (PersonelMi)
        {
            using var dbk = _vt.Baglanti();
            var r = dbk.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
            if (!FazlaMesaiAkisi.FormGorebilir(_orgOnay, _ekip.Kisi(Sicil()), r)) return NotFound(new { hata = "Form bulunamadı." });
        }
        else if (!IkYetkili) return Forbid();

        return BelgeDosyasi(id, bolge: true, satirIci: true);
    }

    [HttpGet("{id:int}/Belge")]
    public IActionResult BelgeIndir(int id, [FromQuery] bool bolge = false)
    {
        if (!IkYetkili) return Forbid();
        return BelgeDosyasi(id, bolge, satirIci: false);
    }

    private IActionResult BelgeDosyasi(int id, bool bolge, bool satirIci)
    {
        using var db = _vt.Baglanti();

        var b = db.QueryFirstOrDefault(@"
SELECT b.dosya, b.ozgun_ad AS ozgunAd FROM KRY_FAZLA_MESAI f
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = " + (bolge ? "f.bolge_belge_id" : "f.belge_id") + @" AND b.silindi = 0
WHERE f.id = @id", new { id });

        var dosyaAdi = (string)b?.dosya ?? "";

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
            _ => "application/octet-stream",
        };

        /* Telefonda tarayıcı içinde açılsın (indirme penceresi değil) */
        if (satirIci) return PhysicalFile(yol, tip);

        return PhysicalFile(yol, tip, (string)b.ozgunAd ?? dosyaAdi);
    }

    public class KararGirdi
    {
        public bool Onay { get; set; }
        public string Not { get; set; }
    }

    /// <summary>İK kararı. Islak imzalı form isteğe bağlı (13.10.2026).</summary>
    [HttpPost("{id:int}/Karar")]
    public async Task<IActionResult> Karar(int id, [FromBody] KararGirdi g)
    {
        if (!IkYetkili) return Forbid();

        var onay = g?.Onay ?? false;
        var not = (g?.Not ?? "").Trim();

        if (!onay && not.Length < 3) return BadRequest(new { hata = "Reddetme sebebini yazınız." });
        if (not.Length > 500) not = not[..500];

        using var db = _vt.Baglanti();

        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });

        if (r is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        /* Üst yönetici aşamasında yalnızca Admin ve GMY karar verebilir
           (izin talebindeki gibi: akış tıkanırsa müdahale edebilecek biri) */
        if ((string)r.durum == FazlaMesaiAkisi.FormBekliyor)
            return BadRequest(new { hata = "Birim yöneticisinin imzalı formu yükleyip onaylaması bekleniyor; İK sonra karar verir." });

        if ((string)r.durum == FazlaMesaiAkisi.UstBekliyor)
        {
            if (Roller.Temel(Rol) is not (Roller.Admin or Roller.GenelMudurYardimcisi))
                return BadRequest(new { hata = "Bu fazla mesai henüz üst yönetici onayında; onaylandıktan sonra İK karar verebilir." });

            var (kod, govde) = await FazlaMesaiAkisi.UstKararUygula(db, _bildirim, id, onay, not, PanelAdi + " (üst yönetici adına)",
                HttpContext.RequestServices.GetService<FazlaMesaiKuralServisi>());
            return StatusCode(kod, govde);
        }

        if ((string)r.durum != "bekliyor") return BadRequest(new { hata = "Bu kayıt zaten sonuçlanmış." });

        /* 13.10.2026: İK onayında ıslak imzalı form isteğe bağlı */

        var n = db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET durum = @durum, karar_veren = @ad, karar_tarihi = SYSDATETIME(), karar_notu = @not
WHERE id = @id AND durum = N'bekliyor'",
            new { id, durum = onay ? "onaylandi" : "reddedildi", ad = PanelAdi, not = not.Length == 0 ? null : not });

        if (n == 0) return BadRequest(new { hata = "Kayıt az önce sonuçlandırıldı." });

        var ozet = $"{(string)r.ad_soyad} · {((DateTime)r.tarih):dd.MM.yyyy} · {(string)r.baslangic}–{(string)r.bitis}";

        try
        {
            var baslik = onay ? "Fazla mesai onaylandı" : "Fazla mesai reddedildi";
            var metin = onay ? $"{ozet} · {PanelAdi}" : $"{ozet} · Sebep: {not}";

            /* Giren yöneticiye ve personele */
            await _bildirim.Gonder((string)r.talep_eden, baslik, metin, "izinonay|fazlamesai");
            await _bildirim.Gonder((string)r.personel_kodu,
                onay ? "Fazla mesainiz onaylandı" : "Fazla mesainiz reddedildi",
                onay
                    ? $"{((DateTime)r.tarih):dd.MM.yyyy} · {(string)r.baslangic}–{(string)r.bitis} ({IzinFormuServisi.SureMetni((int)r.sure_dk)})"
                    : $"{((DateTime)r.tarih):dd.MM.yyyy} · Sebep: {not}",
                /* 1.7: Puantaj Çizelgem'de onaylı fazla mesai görünüyor */
                "puantaj");
        }
        catch
        {
            /* bildirim gitmese de karar kayıtlı */
        }

        return Ok(new { basarili = true, durum = onay ? "onaylandi" : "reddedildi" });
    }

    [HttpPost("{id:int}/Iptal")]
    public IActionResult Iptal(int id)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();

        var n = db.Execute(@"
UPDATE KRY_FAZLA_MESAI SET durum = N'iptal', iptal_eden = @ad
WHERE id = @id AND durum IN (N'form', N'ust', N'bekliyor')", new { id, ad = PanelAdi });

        if (n > 0) FazlaMesaiAkisi.FormKartlariniKapat(db, id, "Kayıt iptal edildi");

        return n > 0 ? Ok(new { basarili = true }) : BadRequest(new { hata = "Yalnızca bekleyen kayıt iptal edilebilir." });
    }
}

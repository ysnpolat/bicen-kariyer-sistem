using System.Globalization;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Talep eksik bildirimi (07.10.2026)
/// ---------------------------------------------------------------------------
/// İK, Personel Talepleri'ndeki bir talepte eksik gördüğünde (imzalı form
/// yüklenmedi, mazeret belgesi yok, ıslak imzalı aslı ulaşmadı, tarih
/// hatalı…) buradan personele bildirir:
///
/// <list type="bullet">
/// <item>anlık bildirim (push) gider,</item>
/// <item>kişiye özel duyuru yazılır: 1.5'te de Duyurular'da ve ana
/// sayfadaki son duyuruda görünür (mağaza güncellemesi gerekmez),</item>
/// <item>1.6'da ana sayfada "Sizi bekleyenler" içinde turuncu kart çıkar;
/// personel evrakı oradan yükler ya da "Tamamladım" der,</item>
/// <item>isteğe bağlı: uygulaması (jetonu) olmayana SMS.</item>
/// </list>
///
/// Fazla mesai kaydında eksik formu giren yöneticiye gider. İK talebin
/// yanında "bildirildi · gördü · tamamladı" izini görür, tekrar
/// hatırlatır ya da eksik giderilince kapatır.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TalepEksikController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly SmsServisi _sms;
    private readonly ILogger<TalepEksikController> _kayit;

    private static readonly CultureInfo Tr = new("tr-TR");

    public TalepEksikController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim,
        SmsServisi sms, ILogger<TalepEksikController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _sms = sms;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private bool PersonelMi => User?.IsInRole("Personel") ?? false;

    /// <summary>Eksik bildirebilen panel rolleri</summary>
    private bool IkYetkili =>
        !PersonelMi && Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    private string PanelKullanici => User?.Identity?.Name ?? "panel";

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

    private static string Kes(string s, int n)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        return s.Length > n ? s[..n] : s;
    }

    /* ====================================================================== */
    /* Talebin kendisi                                                         */
    /* ====================================================================== */

    private sealed record TalepBilgi(string Kod, string Ad, string HedefKod, string HedefAd, string Ozet);

    /// <summary>
    /// Talebin sahibi, bildirimin gideceği kişi ve kısa özeti. Personel
    /// kodu istemciden alınmıyor: talep tablosundan okunuyor.
    /// </summary>
    private static TalepBilgi TalepOku(System.Data.IDbConnection db, string tur, int id)
    {
        switch (tur)
        {
            case TalepEksik.Izin:
            {
                var t = db.QueryFirstOrDefault(@"
SELECT personel_kodu, ad_soyad, tur, cikis_tarihi, donus_tarihi, gun, baslangic_saat, bitis_saat
FROM KRY_IZIN_TALEP WHERE id = @id AND iptal = 0", new { id });
                if (t is null) return null;

                DateTime c = t.cikis_tarihi, d = t.donus_tarihi;
                var gun = Convert.ToDecimal(t.gun);
                var aralik = c.Date == d.Date
                    ? c.ToString("d MMMM", Tr)
                    : c.Month == d.Month
                    ? $"{c:dd}–{d.ToString("d MMMM", Tr)}"
                    : $"{c.ToString("d MMM", Tr)} – {d.ToString("d MMM", Tr)}";
                var sure = t.baslangic_saat is not null
                    ? $"{t.baslangic_saat}–{t.bitis_saat}"
                    : $"{gun.ToString("0.#", Tr)} gün";

                return new TalepBilgi((string)t.personel_kodu, (string)t.ad_soyad,
                    (string)t.personel_kodu, (string)t.ad_soyad, $"{t.tur} {aralik} ({sure})");
            }

            case TalepEksik.Avans:
            {
                var t = db.QueryFirstOrDefault(@"
SELECT personel_kodu, ad_soyad, tutar, taksit, olusturma FROM KRY_AVANS WHERE id = @id", new { id });
                if (t is null) return null;

                var taksit = (int)t.taksit;
                return new TalepBilgi((string)t.personel_kodu, (string)t.ad_soyad,
                    (string)t.personel_kodu, (string)t.ad_soyad,
                    $"Avans {((decimal)t.tutar).ToString("N0", Tr)} TL"
                    + (taksit > 1 ? $", {taksit} taksit" : "")
                    + $" ({((DateTime)t.olusturma).ToString("d MMMM", Tr)} talebi)");
            }

            case TalepEksik.FazlaMesai:
            {
                var t = db.QueryFirstOrDefault(@"
SELECT personel_kodu, ad_soyad, tarih, baslangic, bitis, talep_eden, talep_eden_ad
FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
                if (t is null) return null;

                /* Formu yönetici girip imzalatıyor: eksik ona gidiyor */
                var hedef = string.IsNullOrWhiteSpace((string)t.talep_eden) ? (string)t.personel_kodu : (string)t.talep_eden;
                var hedefAd = string.IsNullOrWhiteSpace((string)t.talep_eden) ? (string)t.ad_soyad : (string)t.talep_eden_ad;

                return new TalepBilgi((string)t.personel_kodu, (string)t.ad_soyad, hedef, hedefAd,
                    $"{t.ad_soyad} fazla mesai {((DateTime)t.tarih).ToString("d MMMM", Tr)} {t.baslangic}–{t.bitis}");
            }

            case TalepEksik.Itiraz:
            {
                var t = db.QueryFirstOrDefault(@"
SELECT personel_kodu, ad_soyad, tarih, tur, saat FROM KRY_VARDIYA_ITIRAZ WHERE id = @id AND iptal = 0", new { id });
                if (t is null) return null;

                return new TalepBilgi((string)t.personel_kodu, (string)t.ad_soyad,
                    (string)t.personel_kodu, (string)t.ad_soyad,
                    $"Vardiya düzeltme {((DateTime)t.tarih).ToString("d MMMM", Tr)} {t.tur} {t.saat}");
            }
        }

        return null;
    }

    /* ====================================================================== */
    /* Metinler                                                                */
    /* ====================================================================== */

    /// <summary>Anlık bildirim metni: kısa (kilit ekranında okunuyor)</summary>
    private static string KisaMetin(string ozet, List<string> maddeler, DateTime? son)
    {
        var m = maddeler.Count == 0 ? "eksik var" : string.Join(", ", maddeler.Select(x => x.ToLower(Tr)));
        return $"{ozet}: {m}." + (son is DateTime s ? $" Son gün {s.ToString("d MMMM", Tr)}." : "");
    }

    /// <summary>Duyuru metni: 1.5'te personelin tek göreceği yer, ayrıntılı</summary>
    private static string UzunMetin(string tur, string ozet, List<string> maddeler, string aciklama, DateTime? son)
    {
        var satirlar = new List<string> { $"{ozet} için İnsan Kaynakları bir eksik bildirdi:" };
        satirlar.AddRange(maddeler.Select(x => $"• {x}"));

        if (!string.IsNullOrWhiteSpace(aciklama)) satirlar.Add($"\nİK notu: {aciklama.Trim()}");
        if (son is DateTime s) satirlar.Add($"\nSon gün: {s.ToString("d MMMM yyyy, dddd", Tr)}");

        satirlar.Add(tur == TalepEksik.Izin
            ? "\nEvrakı Biçen360 ana sayfasındaki karttan yükleyebilirsiniz. Tamamladığınızda İK'ya bildirim gider."
            : "\nEksiği tamamladığınızda Biçen360 ana sayfasındaki karttan İK'ya bildirebilirsiniz.");

        return string.Join("\n", satirlar);
    }

    /// <summary>Uygulamadaki karta ve panele giden biçim</summary>
    private static object Disari(dynamic r) => new
    {
        id = (int)r.id,
        tur = (string)r.tur,
        turAdi = TalepEksik.TurAdi((string)r.tur),
        talepId = (int)r.talep_id,
        personelKodu = ((string)r.personel_kodu ?? "").Trim(),
        adSoyad = (string)r.ad_soyad,
        hedefKodu = ((string)r.hedef_kodu ?? "").Trim(),
        hedefAd = (string)r.hedef_ad,
        baslik = (string)r.gonderen == FazlaMesaiAkisi.FormKaynak ? "Fazla mesai formunu yükleyin"
               : (string)r.gonderen == IzinYoneticiFormu.Kaynak ? "İzin formunu yükleyin"
               : TalepEksik.Baslik((string)r.tur),
        /* Kartı açan: İK, sistem (ör. "sistem:fmform") ya da yönetici ("yonetici:SICIL", 26.10.2026) */
        kaynak = (string)r.gonderen,
        /* 2.0: yöneticinin bildirdiği eksikte kartın üst yazısı "İK:" değil yöneticinin adı */
        yonetici = YoneticiEksik.YoneticidenMi((string)r.gonderen),
        bildiren = YoneticiEksik.YoneticidenMi((string)r.gonderen) ? ((string)r.gonderen_ad ?? "Yöneticiniz") : "İnsan Kaynakları",
        ozet = (string)r.talep_ozet,
        maddeler = TalepEksik.Maddeler((string)r.maddeler),
        aciklama = (string)r.aciklama,
        sonTarih = (DateTime?)r.son_tarih,
        gecikti = r.son_tarih is DateTime st && st.Date < DateTime.Today && (string)r.durum == TalepEksik.Acik,
        durum = (string)r.durum,
        gonderen = (string)r.gonderen_ad ?? (string)r.gonderen,
        tarih = (DateTime)r.tarih,
        jetonVar = r.jeton_var == true,
        smsDurum = (string)r.sms_durum,
        goruldu = (DateTime?)r.goruldu,
        hatirlatma = (DateTime?)r.hatirlatma,
        hatirlatmaSayi = (int)r.hatirlatma_sayi,
        tamamlandi = (DateTime?)r.tamamlandi,
        personelNotu = (string)r.personel_notu,
        kapandi = (DateTime?)r.kapandi,
        kapatan = (string)r.kapatan,
        kapanisNotu = (string)r.kapanis_notu,
    };

    /// <summary>Duyuru okunduysa "gördü" sayılır (1.5'te kart yok)</summary>
    private const string Secim = @"
SELECT e.*,
       COALESCE(e.goruldu, (SELECT MIN(o.okuma) FROM KRY_MOBIL_DUYURU_OKUMA o
                            WHERE o.duyuru_id = e.duyuru_id)) AS goruldu_hesap
FROM KRY_TALEP_EKSIK e";

    private static dynamic GorulduDuzelt(dynamic r)
    {
        if (r is IDictionary<string, object> d && d.TryGetValue("goruldu_hesap", out var g))
            d["goruldu"] = g;
        return r;
    }

    /* ====================================================================== */
    /* Panel                                                                   */
    /* ====================================================================== */

    /// <summary>
    /// Bir talep türünün eksik kayıtları: her talep için en son kayıt
    /// (açık olan öne). Liste satırlarındaki rozet ve pencere bundan.
    /// </summary>
    /// <summary>Hazır eksik maddeleri (Ayarlar Merkezi › Seçenek listeleri)</summary>
    [HttpGet("Maddeler")]
    public IActionResult Maddeler()
    {
        if (PersonelMi) return Forbid();

        return Ok(new
        {
            izin = SecenekListesi.Acik("eksik.izin"),
            avans = SecenekListesi.Acik("eksik.avans"),
            fazlamesai = SecenekListesi.Acik("eksik.fazlamesai"),
            itiraz = SecenekListesi.Acik("eksik.itiraz"),
        });
    }

    [HttpGet("Durumlar")]
    public IActionResult Durumlar([FromQuery] string tur)
    {
        if (PersonelMi) return Forbid();

        tur = (tur ?? "").Trim().ToLowerInvariant();
        if (!TalepEksik.Turler.Contains(tur)) return BadRequest(new { hata = "Geçersiz talep türü." });

        using var db = _vt.Baglanti();

        var satirlar = db.Query(Secim + @"
WHERE e.tur = @tur AND e.tarih >= DATEADD(DAY, -180, SYSDATETIME())
  /* Bölge müdürünün form kartı İK eksiği değil (09.10.2026) */
  AND ISNULL(e.gonderen, N'') NOT IN (N'sistem:fmform', N'sistem:izinform')
ORDER BY e.talep_id, CASE WHEN e.durum = N'kapandi' THEN 1 ELSE 0 END, e.tarih DESC", new { tur })
            .Select(GorulduDuzelt)
            .ToList();

        var kayitlar = new List<object>();
        var gorulen = new HashSet<int>();

        foreach (var r in satirlar)
        {
            if (!gorulen.Add((int)r.talep_id)) continue;
            kayitlar.Add(Disari(r));
        }

        return Ok(new { kayitlar, yetkili = IkYetkili });
    }

    /// <summary>Bir talebin bütün eksik kayıtları (pencerede geçmiş)</summary>
    [HttpGet("Talep")]
    public IActionResult Talep([FromQuery] string tur, [FromQuery] int id)
    {
        if (PersonelMi) return Forbid();

        tur = (tur ?? "").Trim().ToLowerInvariant();

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(Secim + " WHERE e.tur = @tur AND e.talep_id = @id ORDER BY e.tarih DESC", new { tur, id })
            .Select(GorulduDuzelt)
            .Select(r => Disari(r))
            .ToList();

        var t = TalepOku(db, tur, id);

        return Ok(new
        {
            kayitlar,
            talep = t is null ? null : new { ozet = t.Ozet, adSoyad = t.Ad, hedefAd = t.HedefAd, hedefFarkli = K(t.HedefKod) != K(t.Kod) },
            yetkili = IkYetkili,
            smsEtkin = _sms.Etkin,
        });
    }

    public class GonderGirdi
    {
        public string Tur { get; set; }
        public int TalepId { get; set; }
        public List<string> Maddeler { get; set; }
        public string Aciklama { get; set; }
        public DateTime? SonTarih { get; set; }
        public bool Sms { get; set; }
    }

    /// <summary>
    /// Eksik bildirir: kayıt + duyuru + anlık bildirim (+ isteğe bağlı SMS).
    /// Aynı talepte açık kayıt varsa o kapanıp yenisi açılıyor: personelin
    /// karşısına iki ayrı kart çıkmasın.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Gonder([FromBody] GonderGirdi g)
    {
        if (!IkYetkili) return StatusCode(403, new { hata = "Eksik bildirme yetkiniz yok." });

        var tur = (g?.Tur ?? "").Trim().ToLowerInvariant();
        if (!TalepEksik.Turler.Contains(tur)) return BadRequest(new { hata = "Geçersiz talep türü." });

        var maddeler = (g.Maddeler ?? new())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => Kes(x.Replace("\n", " "), 120))
            .Distinct()
            .Take(8)
            .ToList();

        var aciklama = Kes(g.Aciklama, 600);

        if (maddeler.Count == 0 && aciklama is null)
            return BadRequest(new { hata = "Eksik olanı seçin ya da açıklama yazın." });

        if (g.SonTarih is DateTime st && st.Date < DateTime.Today)
            return BadRequest(new { hata = "Son tarih geçmiş bir gün olamaz." });

        using var db = _vt.Baglanti();

        var t = TalepOku(db, tur, g.TalepId);
        if (t is null) return NotFound(new { hata = "Talep bulunamadı." });

        var jetonVar = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod", new { kod = t.HedefKod.Trim() }) > 0;

        var baslik = TalepEksik.Baslik(tur);
        if (K(t.HedefKod) != K(t.Kod)) baslik = $"{t.Ad}: fazla mesai formunda eksik var";

        var son = g.SonTarih?.Date;
        var kisa = KisaMetin(t.Ozet, maddeler, son);
        var uzun = UzunMetin(tur, t.Ozet, maddeler, aciklama, son);

        /* Önceki açık kayıt yerini yenisine bırakıyor */
        db.Execute(@"
UPDATE KRY_TALEP_EKSIK SET durum = N'kapandi', kapandi = SYSDATETIME(), kapatan = @kim,
       kapanis_notu = N'Yeni eksik bildirimiyle yenilendi'
WHERE tur = @tur AND talep_id = @id AND durum <> N'kapandi'", new { tur, id = g.TalepId, kim = PanelAdi });

        /* 1.5'in göreceği yer: kişiye özel duyuru */
        int? duyuruId = null;
        try
        {
            duyuruId = DuyuruYazici.Ekle(db, new DuyuruYazici.Kayit
            {
                Baslik = baslik,
                Metin = uzun,
                Hedef = "kisi",
                HedefOzet = t.HedefAd,
                PersonelKodu = t.HedefKod.Trim(),
                Onemli = true,
                Gonderen = "İnsan Kaynakları",
                YazanAd = PanelAdi,
                YazanUnvan = "İnsan Kaynakları",
            });
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Eksik duyurusu yazılamadı: {Tur} {Id}", tur, g.TalepId);
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_TALEP_EKSIK
    (tur, talep_id, personel_kodu, ad_soyad, hedef_kodu, hedef_ad, talep_ozet, maddeler, aciklama,
     son_tarih, gonderen, gonderen_ad, duyuru_id, jeton_var)
OUTPUT INSERTED.id
VALUES (@tur, @talepId, @kod, @ad, @hedef, @hedefAd, @ozet, @maddeler, @aciklama,
        @son, @gonderen, @gonderenAd, @duyuruId, @jetonVar)",
            new
            {
                tur,
                talepId = g.TalepId,
                kod = t.Kod.Trim(),
                ad = Kes(t.Ad, 120),
                hedef = t.HedefKod.Trim(),
                hedefAd = Kes(t.HedefAd, 120),
                ozet = Kes(t.Ozet, 200),
                maddeler = Kes(string.Join("\n", maddeler), 1000),
                aciklama,
                son,
                gonderen = Kes(PanelKullanici, 100),
                gonderenAd = Kes(PanelAdi, 120),
                duyuruId,
                jetonVar,
            });

        await _bildirim.Gonder(t.HedefKod.Trim(), baslik, kisa, "anasayfa|eksik");

        /* SMS yalnızca uygulaması olmayana: olanlara bildirim zaten gidiyor */
        string smsDurum = null;
        if (g.Sms && !jetonVar)
            smsDurum = await SmsGonder(t, $"{baslik}. {kisa} Ayrıntı için İnsan Kaynakları ile görüşün.");

        if (smsDurum is not null)
            db.Execute("UPDATE KRY_TALEP_EKSIK SET sms_durum = @smsDurum WHERE id = @id", new { id, smsDurum });

        if (tur == TalepEksik.Izin)
            IzinHareket.Yaz(db, g.TalepId, IzinHareket.Bildirim, "İK eksik bildirdi",
                string.Join(" · ", maddeler) + (aciklama is null ? "" : $" — {aciklama}")
                + (jetonVar ? "" : " (Uygulamada bildirim jetonu yok; duyurularda görünür.)"),
                PanelAdi, t.HedefAd, IzinHareket.Uygulama);

        return Ok(new { id, jetonVar, smsDurum, mesaj = jetonVar ? "Bildirim gönderildi." : "Kaydedildi; uygulamada bildirim jetonu yok, duyurularda görecek." });
    }

    private async Task<string> SmsGonder(TalepBilgi t, string metin)
    {
        try
        {
            if (!_sms.Etkin) return "SMS servisi kapalı";

            var p = _ekip.Kisi(t.HedefKod);
            var tel = UygulamaDavetGorevi.Telefon(p?.Telefon);
            if (tel is null) return "Cep telefonu geçersiz";

            if (metin.Length > 300) metin = metin[..297] + "…";

            var s = await _sms.Gonder(tel, metin);
            return s.Basarili ? "SMS gönderildi" : Kes($"SMS gitmedi: {s.Mesaj}", 200);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Eksik SMS'i gönderilemedi");
            return "SMS gönderilemedi";
        }
    }

    /// <summary>Tekrar hatırlatır (aynı gün bir kez)</summary>
    [HttpPost("{id:int}/Hatirlat")]
    public async Task<IActionResult> Hatirlat(int id)
    {
        if (!IkYetkili) return StatusCode(403, new { hata = "Yetkiniz yok." });

        using var db = _vt.Baglanti();

        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_TALEP_EKSIK WHERE id = @id", new { id });
        if (r is null || (string)r.durum != TalepEksik.Acik)
            return NotFound(new { hata = "Açık eksik bildirimi bulunamadı." });

        if (!MazeretBelgeGorevi.BirKez(db, $"eksikhatirlat|{id}|{DateTime.Today:yyyyMMdd}"))
            return Ok(new { tamam = false, mesaj = "Bugün zaten hatırlatıldı." });

        var maddeler = TalepEksik.Maddeler((string)r.maddeler);
        var metin = "Hatırlatma · " + KisaMetin((string)r.talep_ozet, maddeler, (DateTime?)r.son_tarih);

        await _bildirim.Gonder(((string)r.hedef_kodu).Trim(), TalepEksik.Baslik((string)r.tur), metin, "anasayfa|eksik");

        db.Execute(@"
UPDATE KRY_TALEP_EKSIK SET hatirlatma = SYSDATETIME(), hatirlatma_sayi = hatirlatma_sayi + 1 WHERE id = @id", new { id });

        if ((string)r.tur == TalepEksik.Izin)
            IzinHareket.Yaz(db, (int)r.talep_id, IzinHareket.Hatirlatma, "İK eksiği tekrar hatırlattı",
                metin, PanelAdi, (string)r.hedef_ad, IzinHareket.Uygulama);

        return Ok(new { tamam = true, mesaj = "Hatırlatma gönderildi." });
    }

    public class KapatGirdi
    {
        public string Not { get; set; }
        public bool Bildir { get; set; } = true;
    }

    /// <summary>Eksik giderildi: kart personelin ana sayfasından kalkar</summary>
    [HttpPost("{id:int}/Kapat")]
    public async Task<IActionResult> Kapat(int id, [FromBody] KapatGirdi g)
    {
        if (!IkYetkili) return StatusCode(403, new { hata = "Yetkiniz yok." });

        using var db = _vt.Baglanti();

        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_TALEP_EKSIK WHERE id = @id", new { id });
        if (r is null || (string)r.durum == TalepEksik.Kapandi)
            return NotFound(new { hata = "Açık eksik bildirimi bulunamadı." });

        db.Execute(@"
UPDATE KRY_TALEP_EKSIK SET durum = N'kapandi', kapandi = SYSDATETIME(), kapatan = @kim, kapanis_notu = @not
WHERE id = @id", new { id, kim = Kes(PanelAdi, 120), not = Kes(g?.Not, 300) });

        if (g?.Bildir != false)
            await _bildirim.Gonder(((string)r.hedef_kodu).Trim(), "Eksik tamamlandı",
                $"{r.talep_ozet}: İnsan Kaynakları eksiğin giderildiğini onayladı. Teşekkürler.", "anasayfa");

        if ((string)r.tur == TalepEksik.Izin)
            IzinHareket.Yaz(db, (int)r.talep_id, IzinHareket.Bildirim, "Eksik giderildi, kapatıldı",
                Kes(g?.Not, 300), PanelAdi, (string)r.hedef_ad, IzinHareket.Panel);

        return Ok(new { tamam = true });
    }

    /* ====================================================================== */
    /* Mobil (Biçen360 1.6)                                                    */
    /* ====================================================================== */

    /// <summary>
    /// Kişinin açık eksikleri; ana sayfa bunu <c>Gorev/Bekleyenler</c>
    /// içinde alıyor. Bu uç ayrıntı penceresinin tazelenmesi için.
    /// </summary>
    [HttpGet("Mobil")]
    [Authorize(Roles = "Personel")]
    public IActionResult Mobil()
    {
        var kod = Sicil();
        if (string.IsNullOrWhiteSpace(kod)) return Unauthorized();

        using var db = _vt.Baglanti();
        return Ok(new { kayitlar = Acikler(db, kod) });
    }

    /// <summary>Açık (ve personelin tamamladığı ama İK'nın henüz kapatmadığı) kayıtlar</summary>
    public static List<object> Acikler(System.Data.IDbConnection db, string kod)
    {
        try
        {
            return db.Query(@"
SELECT * FROM KRY_TALEP_EKSIK
WHERE durum IN (N'acik', N'tamamlandi')
  AND hedef_kodu = @kod
  AND tarih >= DATEADD(DAY, -60, SYSDATETIME())
ORDER BY CASE WHEN durum = N'acik' THEN 0 ELSE 1 END, tarih DESC", new { kod = kod.Trim() })
                .Select(r => Disari(r))
                .ToList();
        }
        catch
        {
            /* Tablo henüz yoksa boş */
            return new List<object>();
        }
    }

    /// <summary>Kart ekranda göründü: İK "gördü" izini görür</summary>
    public static void GorulduIsaretle(System.Data.IDbConnection db, string kod)
    {
        try
        {
            db.Execute(@"
UPDATE KRY_TALEP_EKSIK SET goruldu = SYSDATETIME()
WHERE goruldu IS NULL AND durum = N'acik' AND hedef_kodu = @kod", new { kod = kod.Trim() });
        }
        catch
        {
            /* Tablo henüz yoksa geçilir */
        }
    }

    public class TamamGirdi
    {
        public string Not { get; set; }
    }

    /// <summary>Personel "Tamamladım, İK'ya bildir" dedi</summary>
    [HttpPost("Mobil/{id:int}/Tamamladim")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> Tamamladim(int id, [FromBody] TamamGirdi g)
    {
        var kod = Sicil();
        if (string.IsNullOrWhiteSpace(kod)) return Unauthorized();

        using var db = _vt.Baglanti();

        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_TALEP_EKSIK WHERE id = @id", new { id });
        if (r is null || K((string)r.hedef_kodu) != K(kod))
            return NotFound(new { hata = "Kayıt bulunamadı." });

        if ((string)r.durum != TalepEksik.Acik)
            return Ok(new { tamam = true, mesaj = "Zaten İK'ya bildirildi." });

        /* Avans belgesi (09.10.2026): belge yüklenmeden "tamamladım" denemez */
        if ((string)r.gonderen is FazlaMesaiAkisi.FormKaynak or IzinYoneticiFormu.Kaynak)
            return BadRequest(new { hata = "\"Evrakı yükle\" ile imzalı formu yükleyin; yükleyince kart kendiliğinden kapanır." });

        if ((string)r.tur == TalepEksik.Avans && AvansController.BelgeBekleniyor(db, (int)r.talep_id))
            return BadRequest(new { hata = "Önce \"Evrakı yükle\" ile belgenizi yükleyin. Belge gelince talebiniz kendiliğinden onaya gider." });

        var not = Kes(g?.Not, 500) ?? "Personel tamamladığını bildirdi.";

        TalepEksik.PersonelTamamladi(db, (string)r.tur, (int)r.talep_id, not);

        var kimAd = (string)r.hedef_ad ?? kod;

        /* Yöneticinin eksik bildirimi (26.10.2026): haber İK'ya değil
           bildiren yöneticiye; talep onun onayında bekliyor */
        if (YoneticiEksik.YoneticidenMi((string)r.gonderen))
        {
            var yoneticiAd = (string)r.gonderen_ad ?? "Yönetici";

            await _bildirim.Gonder(YoneticiEksik.Sicil((string)r.gonderen), "Eksik tamamlandı · onayınızı bekliyor",
                $"{kimAd} · {r.talep_ozet}: {not}", YoneticiEksik.Ekran((string)r.tur));

            if ((string)r.tur == TalepEksik.Izin)
                IzinHareket.Yaz(db, (int)r.talep_id, IzinHareket.Bildirim, "Personel eksiği tamamladığını bildirdi",
                    not, kimAd, yoneticiAd, IzinHareket.Uygulama);
            else if ((string)r.tur == TalepEksik.Avans)
                YoneticiEksik.AvansHareket(db, (int)r.talep_id, "Personel eksiği tamamladığını bildirdi", not, kimAd);

            return Ok(new { tamam = true, mesaj = $"{yoneticiAd} bilgilendirildi; talebiniz onayında bekliyor." });
        }

        await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi },
            "Eksik tamamlandı",
            $"{kimAd} · {r.talep_ozet}: {not}", "izintalep");

        if ((string)r.tur == TalepEksik.Izin)
            IzinHareket.Yaz(db, (int)r.talep_id, IzinHareket.Bildirim, "Personel eksiği tamamladığını bildirdi",
                not, kimAd, "İnsan Kaynakları", IzinHareket.Uygulama);

        return Ok(new { tamam = true, mesaj = "İnsan Kaynakları'na bildirildi." });
    }
}

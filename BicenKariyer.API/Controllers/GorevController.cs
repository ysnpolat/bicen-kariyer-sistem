using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen360 ana sayfasındaki "Sizi bekleyenler" kartları ve Ekibim etiketleri
/// ---------------------------------------------------------------------------
/// Personel için: onaylanmış mazeret izninin belgesi ve açık oryantasyon
/// anketi. Yönetici için: belgesini yüklemeyen ekip üyeleri ve oryantasyon
/// değerlendirmesi bekleyen ekip üyeleri.
///
/// <para>
/// Personelin anketi uygulamada mevcut <c>api/Uyum/{kod}</c> uçlarıyla
/// dolduruluyor (eski SMS bağlantısının açtığı formla aynı kayıt).
/// Oryantasyon anketleri artık yalnızca Biçen360'a gidiyor. Yöneticinin
/// değerlendirmesi buradan kaydediliyor: yönetici kendi ekibini ve İK'nın
/// ona açtığı değerlendirmeleri (davet satırları, bkz.
/// <c>UyumGonderimServisi.YoneticiyeAc</c>) görüyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Personel")]
public class GorevController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<GorevController> _kayit;

    public GorevController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim,
        ILogger<GorevController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _kayit = kayit;
    }

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? govde : govde[..i];
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static double KalanSaat(DateTime son) =>
        Math.Round((son - DateTime.Now).TotalHours, 1);

    /// <summary>Mazeret belgesi için seçilebilecek belge türleri</summary>
    /// <para>Ayarlar Merkezi › Seçenek listeleri (mazeretBelgeleri).</para>
    public static string[] MazeretBelgeTurleri => SecenekListesi.Acik("mazeretBelgeleri");

    /* ====================================================================== */
    /* Bekleyenler                                                            */
    /* ====================================================================== */

    /// <summary>
    /// Ana sayfa ve Ekibim için tek istek: kişinin kendi bekleyenleri ve
    /// (yöneticiyse) ekibinin bekleyenleri.
    /// </summary>
    [HttpGet("Bekleyenler")]
    public IActionResult Bekleyenler()
    {
        var kod = Sicil();
        var ben = _ekip.Kisi(kod);

        if (string.IsNullOrWhiteSpace(kod)) return Unauthorized();

        using var db = _vt.Baglanti();

        /* Bu uç yalnızca görev ekranlarını taşıyan sürümden çağrılıyor:
           işaretlenmemiş kişiye giden oryantasyon bildirimine güncelleme
           notu ekleniyor. */
        try
        {
            db.Execute("UPDATE KRY_MOBIL_JETON SET gorev_gorulme = SYSDATETIME() WHERE personel_kodu = @kod",
                new { kod = kod.Trim() });
        }
        catch
        {
            /* Kolon henüz yoksa işaretlenmeden devam */
        }

        /* ------------------------------------------------ kendi belgeleri */
        /* Evrakı eksik ya da aslı henüz İK'ya gönderilmemiş talepler. Kart
           eksik evrakta "yükleyin", tamamlanınca "aslını gönderin" diyor. */
        var gerekliTurler = IzinEvrak.BelgeGerekliTurler(db);

        var talepSatirlari = db.Query(@"
SELECT id, tur, cikis_tarihi, donus_tarihi, mb_son, mb_yukleme, asil_gonderim, belge_id, evrak_sonra,
       alt_tur, CAST(ISNULL(form_sarti, 0) AS BIT) AS form_sarti, durum,
       CAST(ISNULL(form_kisisel, 0) AS BIT) AS form_kisisel
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum <> N'Reddedildi' AND mb_son IS NOT NULL
  AND (mb_yukleme IS NULL OR asil_gonderim IS NULL)
  /* Formu kendi e-postasına gelen (genel merkez / depo) personelden aslı
     istenmiyor; yükleyince kart kapanır (13.10.2026) */
  AND NOT (ISNULL(form_kisisel, 0) = 1 AND mb_yukleme IS NOT NULL)
  AND personel_kodu = @kod
  /* Şube personelinde imzalı form yüklenene kadar kart süresiz duruyor (07.10.2026) */
  AND (mb_son >= DATEADD(DAY, -30, SYSDATETIME())
       OR (form_sarti = 1 AND mb_yukleme IS NULL AND donus_tarihi >= DATEADD(DAY, -60, SYSDATETIME())))
ORDER BY mb_son", new { kod = kod.Trim() }).ToList();

        /* Eksik bildirimi (07.10.2026): İK'nın eksik bildirdiği izin talebi
           kart süresi dolmuş ya da evrakı tamam görünse de yeniden yüklenebilsin
           diye talep satırı ayrıca okunuyor. */
        /* Bölge müdürü: onayını bekleyen fazla mesailerin "imzalı formu
           yükleyin" kartları (09.10.2026) */
        try
        {
            var benKisi = _ekip.Kisi(kod);
            if (benKisi is not null)
            {
                var org = HttpContext.RequestServices.GetRequiredService<OrgOnayServisi>();
                FazlaMesaiAkisi.FormKartlariniHazirla(db, org, benKisi);
                /* İzin: form şartlı talepte imzalı formu birim yöneticisi yükler (09.10.2026) */
                IzinYoneticiFormu.KartlariHazirla(db, org, benKisi);
            }
        }
        catch
        {
            /* kart açılamazsa onay ekranındaki not yol gösterir */
        }

        var eksikler = TalepEksikController.Acikler(db, kod);
        TalepEksikController.GorulduIsaretle(db, kod);

        var eksikIzinIdleri = eksikler
            .Select(e => (dynamic)e)
            .Where(e => (string)e.tur == TalepEksik.Izin)
            .Select(e => (int)e.talepId)
            .Distinct()
            .ToList();

        var eksikTalepler = eksikIzinIdleri.Count == 0
            ? new List<dynamic>()
            : db.Query(@"
SELECT id, tur, cikis_tarihi, donus_tarihi, mb_son, mb_yukleme, asil_gonderim, belge_id, evrak_sonra,
       alt_tur, CAST(ISNULL(form_sarti, 0) AS BIT) AS form_sarti, durum,
       CAST(ISNULL(form_kisisel, 0) AS BIT) AS form_kisisel
FROM KRY_IZIN_TALEP WHERE iptal = 0 AND id IN @idler", new { idler = eksikIzinIdleri }).ToList();

        var talepEvraklari = IzinEvrak.Evraklar(db,
            talepSatirlari.Select(x => (int)x.id).Concat(eksikTalepler.Select(x => (int)x.id)).Distinct());

        object BelgeNesnesi(dynamic x)
        {
            var gerekli = IzinEvrak.TalepBelgeGerekli(gerekliTurler, (string)x.tur, (string)x.alt_tur);
            var destekAdi = IzinEvrak.DestekAdi((string)x.tur, (string)x.alt_tur);
            var ev = talepEvraklari.GetValueOrDefault((int)x.id) ?? new List<IzinEvrak.Kayit>();
            /* 09.10.2026: form şartlı talepte imzalı formu birim yöneticisi
               yüklüyor; personel yalnızca destekleyici belgeyi yükler */
            var yoneticiFormu = x.form_sarti == true;
            var formBekleniyor = false;
            var tamam = yoneticiFormu
                ? !gerekli || ev.Any(e => e.Kalem == IzinEvrak.Destek)
                : IzinEvrak.PersonelTamam(gerekli, ev);
            DateTime son = x.mb_son is DateTime ms ? ms : DateTime.Now.AddDays(MazeretBelgeGorevi.SureGun);

            return new
            {
                id = (int)x.id,
                tur = (string)x.tur,
                altTur = (string)x.alt_tur,
                /* Şube personeli: form yüklenmeden yönetici onaylayamaz; kart bunu söylüyor */
                formBekleniyor,
                cikis = (DateTime)x.cikis_tarihi,
                donus = (DateTime)x.donus_tarihi,
                son,
                kalanSaat = KalanSaat(son),
                gecikti = !tamam && son < DateTime.Now,
                tamam,
                belgeGerekli = gerekli,
                asilGonderildi = yoneticiFormu || x.form_kisisel == true || x.asil_gonderim is not null,
                gerekenler = IzinEvrak.Gerekenler(gerekli, destekAdi).Where(g => !yoneticiFormu || g.Kalem != IzinEvrak.Form).Select(g => new
                {
                    kalem = g.Kalem,
                    ad = g.Ad,
                    yuklendi = ev.Any(e => e.Kalem == g.Kalem),
                    dosyalar = ev.Where(e => e.Kalem == g.Kalem).Select(e => e.OzgunAd ?? e.Tur).ToList(),
                }).ToList(),
            };
        }

        var belgeler = talepSatirlari
            /* Form şartlı ve belge istenmeyen talepte personelin yükleyeceği bir şey yok */
            .Where(x => !(x.form_sarti == true && !IzinEvrak.TalepBelgeGerekli(gerekliTurler, (string)x.tur, (string)x.alt_tur)))
            .Where(x => !(x.form_sarti == true && (talepEvraklari.GetValueOrDefault((int)x.id) ?? new List<IzinEvrak.Kayit>()).Any(e => e.Kalem == IzinEvrak.Destek)))
            .Select(x => BelgeNesnesi(x)).ToList();

        /* Uygulamadaki eksik kartı: izinde evrak penceresini açabilmek için
           talebin evrak bilgisi de ekleniyor (1.5 bu alanı tanımıyor, yok sayar) */
        var eksikTalepHaritasi = eksikTalepler.ToDictionary(x => (int)x.id, x => x);

        var avansBelgeAdlari = new List<string>();

        var eksikKartlari = eksikler.Select(e =>
        {
            dynamic d = e;
            object belge = (string)d.tur == TalepEksik.Izin && (string)d.kaynak == IzinYoneticiFormu.Kaynak
                ? ((string)d.durum == TalepEksik.Acik ? IzinYoneticiFormu.EvrakNesnesi(db, (int)d.talepId) : null)
                : (string)d.tur == TalepEksik.Izin && eksikTalepHaritasi.TryGetValue((int)d.talepId, out var tx)
                ? BelgeNesnesi(tx)
                /* Avans belgesi (09.10.2026): 1.6 evrak penceresi eksi kimlikle */
                : (string)d.tur == TalepEksik.Avans && (string)d.durum == TalepEksik.Acik
                ? AvansController.BelgeNesnesi(db, (int)d.talepId, zorla: YoneticiEksik.YoneticidenMi((string)d.kaynak))
                /* Fazla mesai imzalı formu (09.10.2026): bölge müdürünün kartı */
                : (string)d.tur == TalepEksik.FazlaMesai && (string)d.kaynak == FazlaMesaiAkisi.FormKaynak && (string)d.durum == TalepEksik.Acik
                ? FazlaMesaiAkisi.EvrakNesnesi(db, (int)d.talepId)
                : null;

            if (belge is not null && (string)d.tur == TalepEksik.Avans)
                avansBelgeAdlari.Add(AvansController.BelgeAdiBul(db, (int)d.talepId));

            return new { kayit = e, belge };
        }).ToList();

        /* ------------------------------------------- kendi oryantasyonu */
        /* 13.10.2026: aynı aşamaya birden çok anket satırı açılmış olabiliyor
           (İK'nın "yeniden gönder"i, elle ve otomatik gönderim). Personel
           birini doldurunca diğeri açık kalıyor ve kart yeniden çıkıyordu;
           panel ise "doldurdu" gösteriyordu. Bu satır açıldıktan sonra aynı
           aşamada doldurulmuş bir satır varsa kart çıkmaz. Doldurduktan sonra
           yeniden gönderilen anket (bilerek tekrar isteniyor) yine görünür. */
        var anket = db.QueryFirstOrDefault(@"
SELECT TOP 1 A.kod, A.asama, A.gecerlilik, CAST(A.test_mi AS BIT) AS test
FROM KRY_UYUM_ANKET A
WHERE A.tur = 'calisan' AND A.dolduruldu IS NULL
  AND A.gecerlilik > SYSDATETIME() AND A.personel_kodu = @kod
  AND (A.test_mi = 0 OR A.kanal = 'uygulama')
  AND NOT EXISTS (
      SELECT 1 FROM KRY_UYUM_ANKET D
      WHERE D.tur = 'calisan' AND D.personel_kodu = A.personel_kodu
        AND D.asama = A.asama AND D.test_mi = A.test_mi
        AND D.dolduruldu IS NOT NULL AND D.dolduruldu >= A.olusturma)
ORDER BY A.olusturma DESC", new { kod = kod.Trim() });

        object oryantasyon = anket is null ? null : new
        {
            kod = (string)anket.kod,
            asama = (string)anket.asama,
            asamaAdi = UyumGonderimServisi.AsamaAdi.GetValueOrDefault((string)anket.asama, (string)anket.asama),
            son = (DateTime)anket.gecerlilik,
            kalanSaat = KalanSaat((DateTime)anket.gecerlilik),
            test = anket.test == true,
        };

        /* ------------------------------------------------------- ekip */
        var sorumlu = ben is null ? new List<PersonelKaydi>() : _ekip.SorumluOlduklari(ben);

        var ekipBelge = new List<object>();
        var ekipOryantasyon = new List<object>();

        var harita = sorumlu
            .GroupBy(x => K(x.PersonelKodu))
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        if (sorumlu.Count > 0)
        {

            /* Belgesi süresinde gelmeyenler; süre içindekiler de "bekleniyor"
               olarak dönüyor, ana sayfa kartı yalnızca gecikenler için açılıyor. */
            foreach (var t in db.Query(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, tur,
       cikis_tarihi AS cikis, donus_tarihi AS donus, mb_son AS son
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum <> N'Reddedildi' AND mb_son IS NOT NULL AND mb_yukleme IS NULL
  AND mb_son >= DATEADD(DAY, -30, SYSDATETIME())
ORDER BY mb_son"))
            {
                if (!harita.TryGetValue(K((string)t.kod), out var p)) continue;

                ekipBelge.Add(new
                {
                    id = (int)t.id,
                    sicil = p.PersonelKodu.Trim(),
                    adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                    pozisyon = p.Pozisyon,
                    tur = (string)t.tur,
                    cikis = (DateTime)t.cikis,
                    donus = (DateTime)t.donus,
                    son = (DateTime)t.son,
                    kalanSaat = KalanSaat((DateTime)t.son),
                    gecikti = (DateTime)t.son < DateTime.Now,
                });
            }

        }

        /* Oryantasyon: ekibin açık anketleri ve İK'nın bu yöneticiye açtığı
           değerlendirmeler (ekipte olmasa da, anketin süresi dolmuş olsa da) */
        ekipOryantasyon = OryantasyonBekleyenleri(db, harita, kod, _ekip.Kisi);

        /* Panelden uygulamaya gönderilen yönetici formu testi: kişi listesi
           yok, "Test personeli" olarak çıkıyor ve bağlantı koduyla
           dolduruluyor (SMS'teki yönetici formuyla aynı kayıt). */
        foreach (var t in db.Query(@"
SELECT kod, asama, gecerlilik FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 1 AND kanal = 'uygulama'
  AND yonetici_kodu = @kod AND dolduruldu IS NULL AND gecerlilik > SYSDATETIME()
ORDER BY olusturma DESC", new { kod = kod.Trim() }))
            ekipOryantasyon.Add(new
            {
                sicil = "TEST",
                adSoyad = "Test personeli",
                pozisyon = "Deneme gönderimi",
                asama = (string)t.asama,
                asamaAdi = UyumGonderimServisi.AsamaAdi.GetValueOrDefault((string)t.asama, (string)t.asama),
                son = (DateTime)t.gecerlilik,
                kalanSaat = KalanSaat((DateTime)t.gecerlilik),
                personelDoldurdu = false,
                test = true,
                kod = (string)t.kod,
            });

        return Ok(new
        {
            belgeler,
            eksikler = eksikKartlari,
            /* 1.6 evrak penceresi yüklemeden önce tür seçtiriyor: avans
               belgesi bekleniyorsa onun adı en başta */
            belgeTurleri = avansBelgeAdlari.Distinct().Concat(MazeretBelgeTurleri).ToArray(),
            oryantasyon,
            yonetici = sorumlu.Count > 0 || ekipOryantasyon.Count > 0,
            ekipBelge,
            ekipOryantasyon,
            /* Rotasyon talebi (07.10.2026): personel yalnızca görür; 1.5 alanı yok sayar */
            rotasyonlar = RotasyonController.Benim(db, kod),
            /* Dönemsel değerlendirme (20.10.2026, 1.8): açık dönemde bekleyen sayısı */
            ekipDegerlendirme = EkipDegerlendirmeOzeti(db, ben),
        });
    }

    private object EkipDegerlendirmeOzeti(System.Data.IDbConnection db, PersonelKaydi ben)
    {
        try
        {
            var dd = HttpContext?.RequestServices.GetService<DonemselDegerlendirmeServisi>();
            if (dd is null || ben is null) return null;
            var donem = dd.AcikDonem();
            if (donem is null || !dd.DegerlendirebilirMi(ben)) return null;
            var ekip = dd.Hedefler(ben).Select(x => x.Kisi).ToList();
            if (ekip.Count == 0) return null;
            var yapilan = db.Query<string>("SELECT personel_kodu FROM KRY_DD_DEGERLENDIRME WHERE donem = @d", new { d = donem.Kod })
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var bekleyen = ekip.Count(x => !yapilan.Contains(DonemselDegerlendirmeServisi.K(x.PersonelKodu)));
            return new { donem = donem.Kod, donemAdi = donem.Ad, bitis = donem.Bit, kalanGun = (donem.Bit - DateTime.Today).Days, bekleyen, toplam = ekip.Count };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Dönemsel değerlendirme özeti alınamadı");
            return null;
        }
    }

    /// <summary>
    /// Ekipte açık oryantasyon dönemi olan kişiler: personel anketi açık
    /// (süresi geçmemiş) ve yöneticinin değerlendirmesi henüz yapılmamış.
    /// Personel anketini bitirmiş olsa da yönetici değerlendirmesi süre
    /// içinde bekleniyor.
    ///
    /// <para>
    /// Ayrıca İK'nın (ya da otomatik gönderimin) bu yöneticiye açtığı
    /// değerlendirmeler: tur = yonetici, kanal = uygulama, yonetici_kodu =
    /// bu yönetici, personel_kodu = değerlendirilecek kişi, doldurulmamış ve
    /// süresi geçmemiş satırlar. Personelin anketinin süresi dolmuş olsa da
    /// ("yöneticisine yeniden gönder") ya da kişi Ekibim'de olmasa da
    /// (yönetici telefonundan eşleşen mağaza/bölge müdürü) kart görünür.
    /// </para>
    /// </summary>
    private static List<object> OryantasyonBekleyenleri(
        System.Data.IDbConnection db, Dictionary<string, PersonelKaydi> harita,
        string benKod, Func<string, PersonelKaydi> kisiBul)
    {
        var acik = harita.Count == 0 ? new List<dynamic>() : db.Query(@"
SELECT id, personel_kodu AS kod, asama, gecerlilik, dolduruldu, olusturma
FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND test_mi = 0 AND gecerlilik > SYSDATETIME()
  AND personel_kodu IS NOT NULL").ToList()
            .Where(x => harita.ContainsKey(K((string)x.kod)))
            .ToList();

        /* İK'nın açtığı değerlendirmeler */
        var davetler = new List<dynamic>();

        try
        {
            davetler = db.Query(@"
SELECT id, personel_kodu AS kod, asama, gecerlilik, olusturma, yonetici_kodu AS yonetici
FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND kanal = 'uygulama'
  AND personel_kodu IS NOT NULL AND yonetici_kodu IS NOT NULL
  AND dolduruldu IS NULL AND gecerlilik > SYSDATETIME()").ToList()
                .Where(x => K((string)x.yonetici) == K(benKod))
                .ToList();
        }
        catch
        {
            /* yonetici_kodu kolonu yoksa yalnızca ekip */
        }

        var kisiler = new Dictionary<string, PersonelKaydi>(harita, StringComparer.OrdinalIgnoreCase);

        foreach (var d in davetler)
        {
            var k = K((string)d.kod);

            if (!kisiler.ContainsKey(k) && kisiBul((string)d.kod) is { } p)
                kisiler[k] = p;
        }

        davetler = davetler.Where(x => kisiler.ContainsKey(K((string)x.kod))).ToList();

        if (acik.Count == 0 && davetler.Count == 0) return new List<object>();

        /* Davet satırlarında personelin anketi doldurup doldurmadığı:
           aynı aşamanın en son çalışan satırından */
        var doldurulan = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (davetler.Count > 0)
            foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, asama FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND test_mi = 0 AND dolduruldu IS NOT NULL AND personel_kodu IN @kodlar",
                         new { kodlar = davetler.Select(x => ((string)x.kod).Trim()).Distinct().ToList() }))
                doldurulan.Add($"{K((string)r.kod)}|{(string)r.asama}");

        var satirlar = acik
            .Select(x => (kod: K((string)x.kod), asama: (string)x.asama, son: (DateTime)x.gecerlilik,
                          olusturma: (DateTime)x.olusturma, doldurdu: x.dolduruldu is not null))
            .Concat(davetler.Select(x => (kod: K((string)x.kod), asama: (string)x.asama,
                                          son: (DateTime)x.gecerlilik, olusturma: (DateTime)x.olusturma,
                                          doldurdu: doldurulan.Contains($"{K((string)x.kod)}|{(string)x.asama}"))))
            .ToList();

        var degerlendirilen = YoneticiDegerlendirmeleri(db,
            satirlar.Select(x => x.asama).Distinct().ToList(),
            satirlar.Min(x => x.olusturma).AddDays(-1));

        /* 13.10.2026: önce kişi başına en son aşama seçiliyor, sonra
           değerlendirilmiş olan çıkarılıyor. Önceden sıra tersti: yönetici
           son aşamayı değerlendirince süresi henüz dolmamış eski aşama
           satırı (ya da aynı aşamanın eski bir satırı) öne çıkıyor ve kart
           "doldurulmamış" gibi yeniden görünüyordu. */
        return satirlar
            .GroupBy(x => x.kod)
            .Select(g =>
            {
                var x = g.OrderByDescending(y => y.olusturma).First();
                var ayni = g.Where(y => y.asama == x.asama).ToList();

                /* Anket ve davet birlikte açıksa: süre en geç kapananınki,
                   personel doldurduysa doldurdu */
                return (x.kod, x.asama, son: ayni.Max(y => y.son), doldurdu: ayni.Any(y => y.doldurdu));
            })
            .Where(x => !degerlendirilen.Contains($"{x.kod}|{x.asama}"))
            .Select(x =>
            {
                var p = kisiler[x.kod];

                return (object)new
                {
                    sicil = p.PersonelKodu.Trim(),
                    adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                    pozisyon = p.Pozisyon,
                    asama = x.asama,
                    asamaAdi = UyumGonderimServisi.AsamaAdi.GetValueOrDefault(x.asama, x.asama),
                    son = x.son,
                    kalanSaat = KalanSaat(x.son),
                    personelDoldurdu = x.doldurdu,
                };
            })
            .ToList();
    }

    /// <summary>"sicil|aşama" kümesi: yönetici değerlendirmesi yapılmış olanlar.</summary>
    public static HashSet<string> YoneticiDegerlendirmeleri(
        System.Data.IDbConnection db, List<string> asamalar, DateTime baslangic)
    {
        var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (asamalar.Count == 0) return sonuc;

        foreach (var r in db.Query(@"
SELECT asama, cevaplar_json AS json FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND cevaplar_json IS NOT NULL
  AND asama IN @asamalar AND (dolduruldu >= @baslangic OR olusturma >= @baslangic)",
                     new { asamalar, baslangic }))
            foreach (var f in UyumAnaliz.Formlar((string)r.json))
                if (!string.IsNullOrWhiteSpace(f.PersonelKodu))
                    sonuc.Add($"{K(f.PersonelKodu)}|{(string)r.asama}");

        return sonuc;
    }

    /* ====================================================================== */
    /* Yönetici değerlendirmesi                                               */
    /* ====================================================================== */

    public class DegerlendirmeGirdi
    {
        public string PersonelKodu { get; set; }
        public string Asama { get; set; }
        public string CevaplarJson { get; set; }
        public decimal? Puan { get; set; }
    }

    /// <summary>
    /// Yönetici ekibindeki kişiyi uygulamadan değerlendirir. Yanıt, SMS ile
    /// doldurulan yönetici formuyla aynı biçimde (kişi başına bir eleman
    /// içeren dizi) yöneticinin bu aşamadaki uygulama kaydına eklenir;
    /// raporlar ve karneler ikisini ayırt etmeden okur.
    /// </summary>
    [HttpPost("Oryantasyon/Degerlendir")]
    public IActionResult Degerlendir([FromBody] DegerlendirmeGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized();

        var asama = (g?.Asama ?? "").Trim().ToLowerInvariant();

        if (!UyumGonderimServisi.AsamaAdi.ContainsKey(asama))
            return BadRequest(new { hata = "Aşama geçersiz." });

        if (string.IsNullOrWhiteSpace(g.CevaplarJson) || UyumAnaliz.Formlar(g.CevaplarJson).Count == 0)
            return BadRequest(new { hata = "Yanıt bulunamadı." });

        var hedef = _ekip.Kisi(g.PersonelKodu);

        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        using var db = _vt.Baglanti();

        var benKod = ben.PersonelKodu.Trim();

        /* İK'nın bu yöneticiye bu kişi için açtığı değerlendirme (davet).
           Varsa yetki ondan gelir (kişi Ekibim'de olmasa da) ve yanıt o
           satıra yazılır; satır böylece "dolduruldu" olur. */
        int? davetId = null;

        try
        {
            davetId = db.QueryFirstOrDefault<int?>(@"
SELECT TOP 1 id FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND kanal = 'uygulama'
  AND asama = @asama AND yonetici_kodu = @benKod AND personel_kodu = @hedefKod
  AND dolduruldu IS NULL AND gecerlilik > SYSDATETIME()
ORDER BY id DESC", new { asama, benKod, hedefKod = hedef.PersonelKodu.Trim() });
        }
        catch
        {
            /* yonetici_kodu kolonu yoksa davet yok */
        }

        if (davetId is null
            && !_ekip.SorumluOlduklari(ben).Any(x => K(x.PersonelKodu) == K(hedef.PersonelKodu)))
            return StatusCode(403, new { hata = "Bu personeli değerlendirme yetkiniz yok." });

        if (davetId is int did)
        {
            db.Execute(@"
UPDATE KRY_UYUM_ANKET
SET cevaplar_json = @json, puan = @puan, dolduruldu = SYSDATETIME(),
    ad_soyad = @adSoyad, telefon = ISNULL(telefon, @telefon)
WHERE id = @did",
                new
                {
                    did,
                    json = "[" + g.CevaplarJson + "]",
                    puan = g.Puan,
                    adSoyad = $"{ben.Ad} {ben.Soyad}".Trim(),
                    telefon = YoneticiBulucu.TelefonSadelestir(ben.Telefon),
                });

            return Ok(new { tamam = true });
        }

        /* Yöneticinin bu aşamadaki toplama satırı (davet satırları hariç:
           onlarda personel_kodu dolu) */
        var mevcut = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, cevaplar_json AS json FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND kanal = 'uygulama'
  AND asama = @asama AND yonetici_kodu = @benKod AND personel_kodu IS NULL
ORDER BY id DESC", new { asama, benKod });

        /* Aynı kişi yeniden değerlendirilirse eskisinin yerine geçer */
        var liste = new List<string>();

        if (mevcut?.json is string eski && eski.Length > 0)
        {
            try
            {
                using var kok = System.Text.Json.JsonDocument.Parse(eski);

                if (kok.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array)
                    liste.AddRange(kok.RootElement.EnumerateArray().Select(x => x.GetRawText()));
                else
                    liste.Add(kok.RootElement.GetRawText());
            }
            catch
            {
                liste.Add(eski);
            }
        }

        liste.RemoveAll(x => UyumAnaliz.Formlar(x)
            .Any(f => K(f.PersonelKodu) == K(hedef.PersonelKodu)));

        liste.Add(g.CevaplarJson);

        var birlesik = "[" + string.Join(",", liste.Where(x => x.Length > 0)) + "]";

        /* Kayıttaki puan son değerlendirmenin puanı; raporlar kişi
           başına puanı formların kendisinden hesaplıyor. */
        if (mevcut is not null)
            db.Execute(@"
UPDATE KRY_UYUM_ANKET SET cevaplar_json = @birlesik, puan = @puan, dolduruldu = SYSDATETIME()
WHERE id = @id", new { id = (int)mevcut.id, birlesik, puan = g.Puan });
        else
            db.Execute(@"
INSERT INTO KRY_UYUM_ANKET
    (kod, tur, asama, personel_kodu, ad_soyad, sube_adi, gorev, telefon,
     giris_tarihi, gecerlilik, cevaplar_json, puan, dolduruldu, test_mi, gonderen,
     kanal, yonetici_kodu)
VALUES (@kod, 'yonetici', @asama, NULL, @adSoyad, @sube, N'uygulama', @telefon,
        NULL, SYSDATETIME(), @birlesik, @puan, SYSDATETIME(), 0, @gonderen,
        'uygulama', @benKod)",
                new
                {
                    kod = UyumGonderimServisi.BenzersizKod(db),
                    asama,
                    adSoyad = $"{ben.Ad} {ben.Soyad}".Trim(),
                    sube = hedef.Sube,
                    telefon = YoneticiBulucu.TelefonSadelestir(ben.Telefon),
                    birlesik,
                    puan = g.Puan,
                    gonderen = $"uygulama:{benKod}",
                    benKod,
                });

        return Ok(new { tamam = true });
    }

    /// <summary>
    /// Yönetici, anketini doldurmayan ekip üyesine hatırlatma gönderir.
    /// Kişi başına günde bir kez.
    /// </summary>
    [HttpPost("Oryantasyon/Hatirlat")]
    public async Task<IActionResult> OryantasyonHatirlat([FromQuery] string sicil)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için hatırlatma gönderemezsiniz." });

        using var db = _vt.Baglanti();

        var anket = db.QueryFirstOrDefault(@"
SELECT TOP 1 asama, gecerlilik FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND test_mi = 0 AND dolduruldu IS NULL
  AND gecerlilik > SYSDATETIME() AND personel_kodu = @kod
ORDER BY olusturma DESC", new { kod = hedef.PersonelKodu.Trim() });

        if (anket is null)
            return BadRequest(new { hata = "Açık bir oryantasyon anketi yok." });

        if (!MazeretBelgeGorevi.BirKez(db, $"oryhatirlat|{K(hedef.PersonelKodu)}|{DateTime.Today:yyyyMMdd}"))
            return Ok(new { tamam = false, mesaj = "Bugün zaten hatırlatıldı." });

        var kalan = Math.Max(1, (int)Math.Ceiling(((DateTime)anket.gecerlilik - DateTime.Now).TotalHours));

        await _bildirim.Gonder(hedef.PersonelKodu.Trim(), "Oryantasyon anketiniz bekliyor",
            $"Yöneticiniz {ben.Ad} {ben.Soyad} hatırlattı · {kalan} saat kaldı.", "anasayfa");

        return Ok(new { tamam = true, mesaj = "Hatırlatma gönderildi." });
    }
}

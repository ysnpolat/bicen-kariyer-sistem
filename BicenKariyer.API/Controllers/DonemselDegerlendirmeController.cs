using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Dönemsel personel değerlendirmesi (20.10.2026). Mobil: mağaza müdürü
/// ekibini değerlendirir. Panel: kurallar, soru setleri ve rapor
/// (genel → şube → personel; önceki dönemle karşılaştırma).
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DonemselDegerlendirmeController : ControllerBase
{
    private const string PanelRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + ","
                                        + Roller.IKYoneticisi + "," + Roller.IK;
    private const string KuralRolleri = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi;

    private readonly VeritabaniServisi _vt;
    private readonly DonemselDegerlendirmeServisi _dd;
    private readonly EkipServisi _ekip;
    private readonly ILogger<DonemselDegerlendirmeController> _kayit;

    public DonemselDegerlendirmeController(VeritabaniServisi vt, DonemselDegerlendirmeServisi dd, EkipServisi ekip,
        ILogger<DonemselDegerlendirmeController> kayit)
    {
        _vt = vt;
        _dd = dd;
        _ekip = ekip;
        _kayit = kayit;
    }

    private static string K(string s) => DonemselDegerlendirmeServisi.K(s);
    private static string Ad(PersonelKaydi p) => $"{p?.Ad} {p?.Soyad}".Trim();

    /* ==================================================================== */
    /* Mobil                                                                */
    /* ==================================================================== */

    private PersonelKaydi Ben()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return null;
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        var sicil = (i < 0 ? govde : govde[..i]).Trim();
        var cihaz = i < 0 ? "" : govde[(i + 1)..];
        if (sicil.Length == 0) return null;

        if (cihaz.Length > 0)
        {
            using var db = _vt.Baglanti();
            var k = db.QueryFirstOrDefault(
                "SELECT cihaz_id AS cihazId, oturum_acik AS oturumAcik FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @sicil",
                new { sicil });
            /* Kalıcı kimliğe taşınan kayıtta eski jeton kısa süre kabul edilir (26.10.2026) */
            if (k is not null && (!(bool)k.oturumAcik || !CihazKimligi.Uyusuyor(db, sicil, (string)k.cihazId, cihaz)))
                return null;
        }

        return _ekip.Kisi(sicil);
    }

    private static object DonemNesne(DonemselDegerlendirmeServisi.Donem d) =>
        d is null ? null : new { kod = d.Kod, ad = d.Ad, bas = d.Bas, bitis = d.Bit, kalanGun = (d.Bit - DateTime.Today).Days };

    /// <summary>Mağaza müdürünün ekip listesi ve dönem durumu.</summary>
    [HttpGet("Mobil/Ekip")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilEkip()
    {
        var ben = Ben();
        if (ben is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        var ayar = _dd.AyarOku();
        /* 26.10.2026: bölge müdürü sorumlu olduğu şubelerin değerlendirmelerini görür */
        var bolge = _ekip.BolgeSubeleri(ben).Count > 0;
        if (!_dd.DegerlendirebilirMi(ben, ayar))
        {
            /* 27.10.2026: 1.8–1.9'da "Şubelerim" sekmesi yok; bölge müdürüne
               aynı listede bölgesindeki şubelerin personeli ve puanları */
            if (bolge && EskiIstemci())
                return Ok(EskiBolgeYaniti(ben, null));

            return Ok(new { yetkili = false, bolge, donem = DonemNesne(_dd.AcikDonem()), kisiler = Array.Empty<object>() });
        }

        var donem = _dd.AcikDonem();
        var hedefler = _dd.Hedefler(ben, ayar);
        var ekip = hedefler.Select(x => x.Kisi).ToList();
        var kapsamlar = hedefler.ToDictionary(x => K(x.Kisi.PersonelKodu), x => x.Kapsam);
        var kodlar = ekip.Select(x => K(x.PersonelKodu)).ToArray();

        using var db = _vt.Baglanti();
        var kayitlar = kodlar.Length == 0
            ? new List<dynamic>()
            : db.Query(@"
SELECT personel_kodu AS kod, donem, genel_puan AS puan, soru_ort AS soruOrt, degerlendiren_ad AS degerlendiren
FROM KRY_DD_DEGERLENDIRME WHERE personel_kodu IN @kodlar", new { kodlar }).ToList();

        var kisiler = ekip.Select(p =>
        {
            var kod = K(p.PersonelKodu);
            var benim = kayitlar.Where(x => (string)x.kod == kod).OrderByDescending(x => (string)x.donem).ToList();
            var bu = donem is null ? null : benim.FirstOrDefault(x => (string)x.donem == donem.Kod);
            var kapsam = kapsamlar.GetValueOrDefault(kod) ?? DonemselDegerlendirmeServisi.KSube;
            return new
            {
                kod,
                adSoyad = Ad(p),
                pozisyon = p.Pozisyon,
                /* Kademeler (23.10.2026): bölge müdürü birden çok şubenin müdürünü görür */
                kapsam,
                kapsamAdi = DonemselDegerlendirmeServisi.KapsamAdi(kapsam),
                sube = p.IsGrubu,
                girisTarihi = p.GirisTarihi,
                durum = bu is null ? "bekliyor" : "tamam",
                puan = (int?)(bu?.puan is null ? null : Convert.ToInt32(bu.puan)),
                degerlendiren = (string)bu?.degerlendiren,
                /* 23.10.2026: yönetici önceki dönemi görmez; yalnız İK paneli */
                onceki = (object)null,
            };
        }).OrderBy(x => x.durum == "tamam").ThenBy(x => x.kapsam == DonemselDegerlendirmeServisi.KSube).ThenBy(x => x.adSoyad, StringComparer.Create(new CultureInfo("tr-TR"), true)).ToList();

        /* 27.10.2026: eski sürümde (1.8–1.9) bölge müdürü kendi değerlendireceklerinin
           altında bölgesindeki şubelerin değerlendirilmiş personelini de görür */
        if (bolge && EskiIstemci())
            return Ok(EskiBolgeYaniti(ben, kisiler.Cast<object>().ToList(), kodlar));

        return Ok(new
        {
            yetkili = true,
            bolge,
            donem = DonemNesne(donem),
            sonrakiDonem = donem is null ? _dd.SonrakiDonem() : null,
            sube = hedefler.All(x => x.Kapsam == DonemselDegerlendirmeServisi.KSube) ? ben.IsGrubu
                : string.Join(" · ", hedefler.Select(x => DonemselDegerlendirmeServisi.KapsamAdi(x.Kapsam)).Distinct()),
            kisiler,
            tamamlanan = kisiler.Count(x => x.durum == "tamam"),
        });
    }

    /// <summary>Bir personelin formu: pozisyonun soruları, önceki dönemin cevapları, bu dönem girildiyse cevaplar.</summary>
    [HttpGet("Mobil/Form/{kod}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilForm(string kod)
    {
        var ben = Ben();
        if (ben is null) return Unauthorized(new { hata = "Oturum geçersiz." });
        var ayar = _dd.AyarOku();
        var yetkili = _dd.DegerlendirebilirMi(ben, ayar);

        var hedef = yetkili ? _dd.Hedefler(ben, ayar).FirstOrDefault(x => K(x.Kisi.PersonelKodu) == K(kod)) : default;
        var kisi = hedef.Kisi;

        /* 27.10.2026: bölge müdürü (eski sürüm listesinden) şubesindeki kişinin
           değerlendirmesini salt okunur görür; dönem null gönderildiği için
           1.8–1.9 formu "gönderilemez" der, Kaydet de yalnız hedefleri kabul eder */
        if (kisi is null && _ekip.BolgeSubeleri(ben).Count > 0)
            /* 27.10.2026: bölge müdürü yalnız puanları görür; değerlendirme detayı açılmaz */
            return StatusCode(403, new { hata = "Bölge müdürü şubelerdeki personelin yalnız puanını görebilir; değerlendirme detayı açılmaz." });

        if (!yetkili) return Forbid();
        if (kisi is null) return NotFound(new { hata = "Personel ekibinizde değil." });

        var donem = _dd.AcikDonem();
        using var db = _vt.Baglanti();
        var sorular = _dd.Sorular(db, kisi.Pozisyon, hedef.Kapsam);
        /* 23.10.2026: önceki dönemin puanları ve yazdıkları yöneticiye gösterilmez (yalnız İK paneli) */

        dynamic mevcut = donem is null ? null : db.QueryFirstOrDefault(
            "SELECT id, genel_puan AS genelPuan, genel_aciklama AS genelAciklama FROM KRY_DD_DEGERLENDIRME WHERE donem = @d AND personel_kodu = @k",
            new { d = donem.Kod, k = K(kisi.PersonelKodu) });
        var mevcutCevap = mevcut is null
            ? new List<dynamic>()
            : db.Query("SELECT soru_id AS soruId, puan, metin FROM KRY_DD_CEVAP WHERE degerlendirme_id = @id", new { id = (int)mevcut.id }).ToList();

        return Ok(new
        {
            donem = DonemNesne(donem),
            kisi = new
            {
                kod = K(kisi.PersonelKodu), adSoyad = Ad(kisi), pozisyon = kisi.Pozisyon, sube = kisi.IsGrubu, girisTarihi = kisi.GirisTarihi,
                kapsam = hedef.Kapsam, kapsamAdi = DonemselDegerlendirmeServisi.KapsamAdi(hedef.Kapsam),
            },
            olcekEtiketleri = ayar.OlcekEtiketleri,
            sorular = sorular.Select(s =>
            {
                var m = mevcutCevap.FirstOrDefault(x => (int)x.soruId == s.Id);
                return new
                {
                    id = s.Id, tur = s.Tur, metin = s.Metin, zorunlu = true, /* 24.10.2026: tüm sorular zorunlu */
                    puan = m?.puan is null ? (int?)null : Convert.ToInt32(m.puan),
                    yanit = (string)m?.metin,
                };
            }),
            onceki = (object)null,
            oncekiGizli = true,
            genelPuan = mevcut is null ? (int?)null : Convert.ToInt32(mevcut.genelPuan),
            genelAciklama = (string)mevcut?.genelAciklama,
        });
    }

    public sealed class CevapGirdisi
    {
        public int SoruId { get; set; }
        public int? Puan { get; set; }
        public string Metin { get; set; }
    }

    public sealed class KaydetGirdisi
    {
        public string PersonelKodu { get; set; }
        public int GenelPuan { get; set; }
        /// <summary>Genel puanın açıklaması (zorunlu)</summary>
        public string GenelAciklama { get; set; }
        public List<CevapGirdisi> Cevaplar { get; set; }
    }

    /// <summary>Değerlendirmeyi kaydeder; dönem bitene kadar düzeltilebilir.</summary>
    [HttpPost("Mobil/Kaydet")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilKaydet([FromBody] KaydetGirdisi g)
    {
        var ben = Ben();
        if (ben is null) return Unauthorized(new { hata = "Oturum geçersiz." });
        var ayar = _dd.AyarOku();
        if (!_dd.DegerlendirebilirMi(ben, ayar)) return BadRequest(new { hata = "Değerlendirme yetkiniz yok." });

        var donem = _dd.AcikDonem();
        if (donem is null) return BadRequest(new { hata = "Şu an açık değerlendirme dönemi yok." });
        if (g is null || g.GenelPuan is < 1 or > 10) return BadRequest(new { hata = "Genel puanı 1–10 arasında seçiniz." });

        var aciklama = (g.GenelAciklama ?? "").Trim();
        if (aciklama.Length < 3) return BadRequest(new { hata = "Genel puanın açıklamasını yazınız." });
        if (aciklama.Length > 1000) aciklama = aciklama[..1000];

        var hedef = _dd.Hedefler(ben, ayar).FirstOrDefault(x => K(x.Kisi.PersonelKodu) == K(g.PersonelKodu));
        var kisi = hedef.Kisi;
        if (kisi is null) return BadRequest(new { hata = "Personel ekibinizde değil." });

        using var db = _vt.Baglanti();
        var sorular = _dd.Sorular(db, kisi.Pozisyon, hedef.Kapsam);
        var gelen = (g.Cevaplar ?? new()).GroupBy(x => x.SoruId).ToDictionary(x => x.Key, x => x.Last());

        var satirlar = new List<(DonemselDegerlendirmeServisi.Soru Soru, int? Puan, string Metin)>();
        foreach (var s in sorular)
        {
            gelen.TryGetValue(s.Id, out var c);
            if (s.Tur == "olcek")
            {
                var pu = c?.Puan;
                if (pu is not null && pu is < 1 or > 5) return BadRequest(new { hata = $"'{s.Metin}' için 1–5 seçiniz." });
                if (pu is null) return BadRequest(new { hata = $"'{s.Metin}' sorusunu puanlayınız." });
                satirlar.Add((s, pu, null));
            }
            else
            {
                var m = (c?.Metin ?? "").Trim();
                if (m.Length > 1000) m = m[..1000];
                if (m.Length == 0) return BadRequest(new { hata = $"'{s.Metin}' sorusunu yanıtlayınız." });
                if (m.Length < 3 || !m.Any(char.IsLetter)) return BadRequest(new { hata = $"'{s.Metin}' için açıklayıcı bir yanıt yazınız." });
                satirlar.Add((s, null, m.Length == 0 ? null : m));
            }
        }

        var puanlar = satirlar.Where(x => x.Puan is not null).Select(x => (decimal)x.Puan.Value).ToList();
        decimal? ort = puanlar.Count == 0 ? null : Math.Round(puanlar.Average(), 2);
        var kod = K(kisi.PersonelKodu);

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var tx = db.BeginTransaction();

        var id = db.ExecuteScalar<int?>(
            "SELECT id FROM KRY_DD_DEGERLENDIRME WITH (UPDLOCK, HOLDLOCK) WHERE donem = @d AND personel_kodu = @k",
            new { d = donem.Kod, k = kod }, tx);

        var p = new
        {
            d = donem.Kod, k = kod, ad = Ad(kisi), poz = kisi.Pozisyon, sube = kisi.IsGrubu,
            dk = K(ben.PersonelKodu), dad = Ad(ben), dgorev = ben.Pozisyon, puan = g.GenelPuan, ort, aciklama,
            kapsam = hedef.Kapsam,
        };

        if (id is null)
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_DD_DEGERLENDIRME (donem, personel_kodu, ad_soyad, pozisyon, sube_adi, degerlendiren_kodu,
    degerlendiren_ad, degerlendiren_gorev, genel_puan, soru_ort, genel_aciklama, kapsam)
OUTPUT INSERTED.id
VALUES (@d, @k, @ad, @poz, @sube, @dk, @dad, @dgorev, @puan, @ort, @aciklama, @kapsam)", p, tx);
        }
        else
        {
            db.Execute(@"
UPDATE KRY_DD_DEGERLENDIRME
SET genel_puan = @puan, soru_ort = @ort, genel_aciklama = @aciklama, pozisyon = @poz, sube_adi = @sube,
    degerlendiren_kodu = @dk, degerlendiren_ad = @dad, degerlendiren_gorev = @dgorev, kapsam = @kapsam, guncelleme = SYSDATETIME()
WHERE id = @id", new { p.puan, p.ort, p.aciklama, p.poz, p.sube, p.dk, p.dad, p.dgorev, p.kapsam, id }, tx);
            db.Execute("DELETE FROM KRY_DD_CEVAP WHERE degerlendirme_id = @id", new { id }, tx);
        }

        foreach (var x in satirlar)
            db.Execute(@"
INSERT INTO KRY_DD_CEVAP (degerlendirme_id, soru_id, soru_metni, tur, puan, metin)
VALUES (@id, @sid, @sm, @tur, @puan, @metin)",
                new { id, sid = x.Soru.Id, sm = x.Soru.Metin, tur = x.Soru.Tur, puan = x.Puan, metin = x.Metin }, tx);

        tx.Commit();

        return Ok(new
        {
            tamam = true,
            genelPuan = g.GenelPuan,
            soruOrt = ort,
            onceki = (object)null,
            bitis = donem.Bit,
        });
    }

    /* ==================================================================== */
    /* Eski sürüm (1.8–1.9) için bölge görünümü (27.10.2026)                */
    /* ==================================================================== */

    /// <summary>
    /// "Şubelerim" sekmesi 1.10'da geldi. Sürüm başlığı 1.10'dan küçükse ya
    /// da hiç yoksa bölge listesi Mobil/Ekip yanıtının içinde gönderiliyor.
    /// </summary>
    private bool EskiIstemci()
    {
        var ham = Request?.Headers["X-Uygulama-Surum"].ToString();
        if (string.IsNullOrWhiteSpace(ham)) return true;
        var p = ham.Trim().Split('.');
        if (!int.TryParse(p[0], out var a)) return true;
        var b = p.Length > 1 && int.TryParse(p[1], out var x) ? x : 0;
        return a < 1 || (a == 1 && b < 10);
    }

    /// <summary>
    /// 1.8 ekranının anladığı biçimde bölge listesi: kişi satırında
    /// pozisyon yerine "Şube · pozisyon · değerlendiren". Kendi
    /// değerlendireceği kişiler (varsa) başta ve aynen kalır; bölgedekilerden
    /// yalnız değerlendirilmiş olanlar eklenir (bekleyenler listesi
    /// karışmasın). Kendi hedefi yoksa bölgenin bekleyenleri de eklenir.
    /// </summary>
    private object EskiBolgeYaniti(PersonelKaydi ben, List<object> kendi, string[] kendiKodlar = null)
    {
        var subeAdlari = _ekip.BolgeSubeleri(ben);
        var ayar = _dd.AyarOku();
        var acikDonem = _dd.AcikDonem();

        using var db = _vt.Baglanti();
        var donem = BolgeDonemi(db);
        var acik = donem is not null && acikDonem?.Kod == donem;
        var haric = new HashSet<string>(kendiKodlar ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        var tr = StringComparer.Create(new CultureInfo("tr-TR"), true);

        var kayit = donem is null ? new List<dynamic>() : db.Query(@"
SELECT personel_kodu AS kod, ad_soyad AS adSoyad, pozisyon, sube_adi AS sube, genel_puan AS puan, degerlendiren_ad AS degerlendiren
FROM KRY_DD_DEGERLENDIRME WHERE donem = @donem AND sube_adi IN @subeAdlari", new { donem, subeAdlari }).ToList();

        var bolgeKisileri = kayit
            .Where(x => !haric.Contains((string)x.kod))
            .Select(x => new
            {
                kod = (string)x.kod,
                adSoyad = (string)x.adSoyad,
                pozisyon = $"{x.sube} · {x.pozisyon}",
                sube = (string)x.sube,
                durum = "tamam",
                puan = (int?)Convert.ToInt32(x.puan),
                onceki = (object)null,
            }).ToList();

        /* Kendi hedefi olmayan bölge müdürü: açık dönemde henüz değerlendirilmeyenler de */
        if (kendi is null && acik)
            foreach (var sb in subeAdlari)
                bolgeKisileri.AddRange(_dd.SubeEkibi(sb, ayar)
                    .Where(p => !kayit.Any(x => (string)x.kod == K(p.PersonelKodu)) && !haric.Contains(K(p.PersonelKodu)))
                    .Select(p => new
                    {
                        kod = K(p.PersonelKodu),
                        adSoyad = Ad(p),
                        pozisyon = $"{sb} · {p.Pozisyon}",
                        sube = sb,
                        durum = "bekliyor",
                        puan = (int?)null,
                        onceki = (object)null,
                    }));

        var siralı = bolgeKisileri
            .OrderBy(x => x.sube, tr).ThenBy(x => x.adSoyad, tr)
            .Cast<object>().ToList();

        var kisiler = (kendi ?? new List<object>()).Concat(siralı).ToList();

        return new
        {
            yetkili = true,
            bolge = true,
            /* Açık dönem yoksa null: 1.8 "dönem kapalı" bandını gösterir, satırlar salt okunur */
            donem = acik ? DonemNesne(acikDonem) : null,
            sonrakiDonem = acikDonem is null ? _dd.SonrakiDonem() : null,
            sube = $"Bölgem · {subeAdlari.Count} şube",
            kisiler,
            tamamlanan = kayit.Count,
        };
    }

    /* ==================================================================== */
    /* Mobil · bölge müdürü (26.10.2026)                                     */
    /* ==================================================================== */

    /// <summary>
    /// Bölge müdürünün göreceği dönem: açık dönem, yoksa en son kayıtlı
    /// dönem. Önceki dönemler yalnız İK panelinde (23.10.2026 kuralı).
    /// </summary>
    private string BolgeDonemi(System.Data.IDbConnection db) =>
        _dd.AcikDonem()?.Kod ?? db.ExecuteScalar<string>("SELECT MAX(donem) FROM KRY_DD_DEGERLENDIRME");

    private static bool SubeEsit(string a, string b) =>
        string.Equals((a ?? "").Trim(), (b ?? "").Trim(), StringComparison.OrdinalIgnoreCase);

    /// <summary>Bölgedeki şubeler: değerlendirme sayısı, kadro ve ortalama.</summary>
    [HttpGet("Mobil/Bolge")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilBolge()
    {
        var ben = Ben();
        if (ben is null) return Unauthorized(new { hata = "Oturum geçersiz." });
        var subeAdlari = _ekip.BolgeSubeleri(ben);
        if (subeAdlari.Count == 0) return Ok(new { yetkili = false, subeler = Array.Empty<object>() });

        using var db = _vt.Baglanti();
        var donem = BolgeDonemi(db);
        var acik = donem is not null && _dd.AcikDonem()?.Kod == donem;
        var ayar = _dd.AyarOku();

        var kayit = donem is null ? new List<dynamic>() : db.Query(@"
SELECT sube_adi AS sube, genel_puan AS puan, soru_ort AS soruOrt
FROM KRY_DD_DEGERLENDIRME WHERE donem = @donem AND sube_adi IN @subeAdlari", new { donem, subeAdlari }).ToList();

        var subeler = subeAdlari.Select(sb =>
        {
            var b = kayit.Where(x => SubeEsit((string)x.sube, sb)).ToList();
            var kadro = acik ? _dd.SubeEkibi(sb, ayar).Count : 0;
            var puanlar = b.Select(x => (decimal)Convert.ToDecimal(x.puan)).ToList();
            return new
            {
                sube = sb,
                yapilan = b.Count,
                kadro = Math.Max(kadro, b.Count),
                ortalama = puanlar.Count == 0 ? (decimal?)null : Math.Round(puanlar.Average(), 1),
                enDusuk = puanlar.Count == 0 ? (int?)null : (int)puanlar.Min(),
            };
        }).OrderByDescending(x => x.ortalama ?? -1).ThenBy(x => x.sube).ToList();

        var tum = kayit.Select(x => (decimal)Convert.ToDecimal(x.puan)).ToList();
        return Ok(new
        {
            yetkili = true,
            donem = donem is null ? null : new { kod = donem, ad = DonemselDegerlendirmeServisi.DonemAdi(donem), acik },
            genel = new
            {
                ortalama = tum.Count == 0 ? (decimal?)null : Math.Round(tum.Average(), 1),
                yapilan = tum.Count,
                kadro = subeler.Sum(x => x.kadro),
            },
            subeler,
        });
    }

    /// <summary>Bölgedeki bir şubenin personeli ve bu dönemki değerlendirmeleri.</summary>
    [HttpGet("Mobil/Bolge/Sube")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilBolgeSube([FromQuery] string sube)
    {
        var ben = Ben();
        if (ben is null) return Unauthorized(new { hata = "Oturum geçersiz." });
        var adi = _ekip.BolgeSubeleri(ben).FirstOrDefault(x => SubeEsit(x, sube));
        if (adi is null) return NotFound(new { hata = "Bu şube bölgenizde değil." });

        using var db = _vt.Baglanti();
        var donem = BolgeDonemi(db);
        var acik = donem is not null && _dd.AcikDonem()?.Kod == donem;

        var kayit = donem is null ? new List<dynamic>() : db.Query(@"
SELECT personel_kodu AS kod, ad_soyad AS adSoyad, pozisyon, genel_puan AS puan, soru_ort AS soruOrt,
       ISNULL(kapsam, N'sube') AS kapsam, degerlendiren_ad AS degerlendiren, ISNULL(guncelleme, olusturma) AS tarih
FROM KRY_DD_DEGERLENDIRME WHERE donem = @donem AND sube_adi = @adi", new { donem, adi }).ToList();

        /* 27.10.2026: bölge müdürü yalnız puanı görür (soru ortalaması, değerlendiren, detay yok) */
        var kisiler = kayit.Select(x => new
        {
            kod = (string)x.kod, adSoyad = (string)x.adSoyad, pozisyon = (string)x.pozisyon,
            kapsam = (string)x.kapsam, kapsamAdi = DonemselDegerlendirmeServisi.KapsamAdi((string)x.kapsam),
            durum = "tamam", puan = (int?)Convert.ToInt32(x.puan), soruOrt = (decimal?)null,
            degerlendiren = (string)null, tarih = (DateTime?)null, acilir = false,
        }).ToList();

        /* Açık dönemde henüz değerlendirilmeyenler de görünsün */
        if (acik)
            kisiler.AddRange(_dd.SubeEkibi(adi).Where(p => !kayit.Any(x => (string)x.kod == K(p.PersonelKodu))).Select(p => new
            {
                kod = K(p.PersonelKodu), adSoyad = Ad(p), pozisyon = p.Pozisyon,
                kapsam = DonemselDegerlendirmeServisi.KSube, kapsamAdi = DonemselDegerlendirmeServisi.KapsamAdi(DonemselDegerlendirmeServisi.KSube),
                durum = "bekliyor", puan = (int?)null, soruOrt = (decimal?)null, degerlendiren = (string)null, tarih = (DateTime?)null, acilir = false,
            }));

        var tr = StringComparer.Create(new CultureInfo("tr-TR"), true);
        return Ok(new
        {
            sube = adi,
            donem = donem is null ? null : new { kod = donem, ad = DonemselDegerlendirmeServisi.DonemAdi(donem), acik },
            kisiler = kisiler.OrderBy(x => x.durum == "bekliyor").ThenByDescending(x => x.puan ?? -1).ThenBy(x => x.adSoyad, tr),
        });
    }

    /// <summary>Bölgedeki bir personelin bu dönemki değerlendirmesi (cevaplarıyla).</summary>
    [HttpGet("Mobil/Bolge/Kisi/{kod}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilBolgeKisi(string kod)
    {
        var ben = Ben();
        if (ben is null) return Unauthorized(new { hata = "Oturum geçersiz." });

        /* 27.10.2026: bölge müdürü değerlendirme detayını görmez, yalnız şube listesindeki puanı */
        return StatusCode(403, new { hata = "Değerlendirme detayı yalnız İK panelinde görüntülenir." });
    }

    /* ==================================================================== */
    /* Panel · kurallar ve sorular                                          */
    /* ==================================================================== */

    [HttpGet("Ayar")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult AyarGetir() =>
        Ok(new { ayar = _dd.AyarOku(), acikDonem = DonemNesne(_dd.AcikDonem()), sonrakiDonem = _dd.SonrakiDonem(), kademeler = KademeOzeti() });

    /// <summary>
    /// Kademelerin durumu: kaç kişi değerlendirilecek, kim değerlendirecek,
    /// değerlendireni bulunamayan kaç kişi var. Kademe kapalıyken de
    /// gösteriliyor (açmadan önce kimin göreceği görülsün).
    /// </summary>
    private object KademeOzeti()
    {
        try
        {
            var a = _dd.AyarOku();
            var hepsiAcik = new DonemselDegerlendirmeServisi.Ayar
            {
                Acik = true, EnAzKidemGun = a.EnAzKidemGun,
                MagazaMuduruKademesi = true, BolgeMuduruKademesi = true, DepoKademesi = true, DepoMuduruKademesi = true,
                BolgeMuduruDegerlendiren = a.BolgeMuduruDegerlendiren, DepoMuduruDegerlendiren = a.DepoMuduruDegerlendiren,
            };
            var atama = _dd.UstKademeAtamalari(hepsiAcik);
            var aktif = _ekip.Aktifler().ToDictionary(x => K(x.PersonelKodu), x => x, StringComparer.OrdinalIgnoreCase);

            return DonemselDegerlendirmeServisi.KapsamTanimlari.Where(x => x.Kod != DonemselDegerlendirmeServisi.KSube).Select(t =>
            {
                var l = atama.Where(x => x.Kapsam == t.Kod).ToList();
                var kimler = l.SelectMany(x => x.Degerlendirenler).Distinct(StringComparer.OrdinalIgnoreCase)
                    .Select(s => aktif.TryGetValue(s, out var p) ? $"{Ad(p)} · {p.Pozisyon}" : s).OrderBy(x => x).ToList();
                return new
                {
                    kod = t.Kod, ad = t.Ad, degerlendiren = t.Degerlendiren,
                    kisi = l.Count,
                    eksik = l.Count(x => x.Degerlendirenler.Count == 0),
                    degerlendirenler = kimler.Take(12),
                    degerlendirenSayi = kimler.Count,
                };
            }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Değerlendirme kademe özeti alınamadı");
            return Array.Empty<object>();
        }
    }

    [HttpPost("Ayar")]
    [Authorize(Roles = KuralRolleri)]
    public IActionResult AyarKaydet([FromBody] DonemselDegerlendirmeServisi.Ayar a)
    {
        if (a is null) return BadRequest(new { hata = "Ayar boş." });
        if (!string.IsNullOrWhiteSpace(a.ElleDonem) &&
            !DateTime.TryParseExact(a.ElleDonem + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _))
            return BadRequest(new { hata = "Elle açılan dönem yyyy-MM olmalı." });
        /* Soru seti eşlemesi Sorular sekmesinden ayrıca kaydediliyor; eski
           ekrandan gelen boş liste onu silmesin */
        a.SetEslesme = a.SetEslesme is { Count: > 0 } ? a.SetEslesme : _dd.AyarOku().SetEslesme;
        a.BolgeMuduruDegerlendiren = (a.BolgeMuduruDegerlendiren ?? "").Trim();
        a.DepoMuduruDegerlendiren = (a.DepoMuduruDegerlendiren ?? "").Trim();
        foreach (var (s, ad) in new[] { (a.BolgeMuduruDegerlendiren, "Bölge müdürlerini"), (a.DepoMuduruDegerlendiren, "Depo müdürünü") })
            if (s.Length > 0 && _ekip.Kisi(s) is null)
                return BadRequest(new { hata = $"{ad} değerlendirecek sicil ({s}) aktif personelde bulunamadı." });
        _dd.AyarYaz(a);
        return Ok(new { ayar = _dd.AyarOku(), acikDonem = DonemNesne(_dd.AcikDonem()), kademeler = KademeOzeti() });
    }

    /// <summary>
    /// Soru setleri (mağaza ve depo ayrı) ve Mikro'daki pozisyonların hangi
    /// sete düştüğü. Değerlendirilen herkes sayılır: şube personeli, mağaza
    /// ve bölge müdürleri, depo.
    /// </summary>
    [HttpGet("Pozisyonlar")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Pozisyonlar()
    {
        using var db = _vt.Baglanti();
        DonemselSoruTohumu.Yukle(db);
        var setSayilari = db.Query<(string poz, int adet)>(
            "SELECT pozisyon, COUNT(*) FROM KRY_DD_SORU WHERE aktif = 1 GROUP BY pozisyon").ToList();
        var setAdlari = setSayilari.Select(x => x.poz).ToList();
        var ayar = _dd.AyarOku();

        var kisiler = _ekip.Aktifler()
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .Select(x => (Kisi: x, Kapsam: _dd.Kapsam(x)))
            .Where(x => x.Kapsam is not null)
            .ToList();

        var pozlar = kisiler
            .GroupBy(x => (Poz: x.Kisi.Pozisyon.Trim().ToUpper(new CultureInfo("tr-TR")), Depo: DonemselDegerlendirmeServisi.DepoKapsami(x.Kapsam)))
            .Select(gr =>
            {
                var anahtar = (gr.Key.Depo ? "depo:" : "") + PersonelKaynagiServisi.DuzAnahtar(gr.Key.Poz);
                return new
                {
                    pozisyon = gr.Key.Poz,
                    depo = gr.Key.Depo,
                    kisi = gr.Count(),
                    kapsam = DonemselDegerlendirmeServisi.KapsamAdi(gr.GroupBy(x => x.Kapsam).OrderByDescending(x => x.Count()).First().Key),
                    set = DonemselDegerlendirmeServisi.SetAdi(gr.Key.Poz, gr.Key.Depo, setAdlari, ayar),
                    elle = ayar.SetEslesme.ContainsKey(anahtar),
                };
            })
            .OrderBy(x => x.depo).ThenByDescending(x => x.kisi)
            .ToList();

        var setler = setSayilari.Select(x =>
        {
            var depo = x.poz.StartsWith(DonemselDegerlendirmeServisi.DepoOnek);
            var bagli = pozlar.Where(p => p.set == x.poz).ToList();
            return new
            {
                ad = x.poz,
                kisaAd = depo ? x.poz[DonemselDegerlendirmeServisi.DepoOnek.Length..] : x.poz,
                depo,
                soru = x.adet,
                kisi = bagli.Sum(p => p.kisi),
                pozisyonlar = bagli.Select(p => p.pozisyon),
            };
        })
        .OrderBy(x => x.depo)
        .ThenBy(x => x.kisaAd == DonemselDegerlendirmeServisi.OrtakSet ? 0 : x.kisaAd == DonemselDegerlendirmeServisi.GenelSet ? 1 : 2)
        .ThenBy(x => x.kisaAd, StringComparer.Create(new CultureInfo("tr-TR"), true))
        .ToList();

        return Ok(new { setler, pozisyonlar = pozlar });
    }

    public sealed class EslesmeGirdisi
    {
        public string Pozisyon { get; set; }
        public bool Depo { get; set; }
        /// <summary>Set adı; boşsa otomatik eşlemeye döner</summary>
        public string Set { get; set; }
    }

    /// <summary>Mikro pozisyonunu elle bir soru setine bağlar (ya da otomatiğe döndürür).</summary>
    [HttpPost("SetEslesme")]
    [Authorize(Roles = KuralRolleri)]
    public IActionResult SetEslesme([FromBody] EslesmeGirdisi g)
    {
        if (string.IsNullOrWhiteSpace(g?.Pozisyon)) return BadRequest(new { hata = "Pozisyon gerekli." });
        var a = _dd.AyarOku();
        var anahtar = (g.Depo ? "depo:" : "") + PersonelKaynagiServisi.DuzAnahtar(g.Pozisyon);
        if (string.IsNullOrWhiteSpace(g.Set)) a.SetEslesme.Remove(anahtar);
        else a.SetEslesme[anahtar] = g.Set.Trim();
        _dd.AyarYaz(a);
        return Pozisyonlar();
    }

    [HttpGet("Sorular")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Sorular([FromQuery] string pozisyon)
    {
        using var db = _vt.Baglanti();
        DonemselSoruTohumu.Yukle(db);
        var poz = string.IsNullOrWhiteSpace(pozisyon) ? DonemselDegerlendirmeServisi.GenelSet : pozisyon.Trim();
        var ozel = db.Query<DonemselDegerlendirmeServisi.Soru>(@"
SELECT id AS Id, pozisyon AS Pozisyon, sira AS Sira, tur AS Tur, metin AS Metin, zorunlu AS Zorunlu
FROM KRY_DD_SORU WHERE aktif = 1 AND pozisyon = @poz ORDER BY sira, id", new { poz }).ToList();
        return Ok(new { pozisyon = poz, ozel = ozel.Count > 0, sorular = ozel });
    }

    public sealed class SoruGirdisi
    {
        public int? Id { get; set; }
        public string Tur { get; set; }
        public string Metin { get; set; }
        public bool Zorunlu { get; set; } = true;
    }

    /// <summary>
    /// Pozisyonun soru setini kaydeder. Var olan soru kimliğiyle güncellenir
    /// (karşılaştırma bozulmaz); listeden çıkan soru pasife alınır (eski
    /// raporlarda kalır). Boş liste: pozisyon Genel seti kullanır.
    /// </summary>
    [HttpPost("Sorular")]
    [Authorize(Roles = KuralRolleri)]
    public IActionResult SorulariKaydet([FromQuery] string pozisyon, [FromBody] List<SoruGirdisi> liste)
    {
        var poz = string.IsNullOrWhiteSpace(pozisyon) ? DonemselDegerlendirmeServisi.GenelSet : pozisyon.Trim();
        liste ??= new();
        foreach (var x in liste)
        {
            x.Metin = (x.Metin ?? "").Trim();
            if (x.Metin.Length < 3) return BadRequest(new { hata = "Soru metni boş olamaz." });
            if (x.Metin.Length > 300) x.Metin = x.Metin[..300];
            if (x.Tur is not ("olcek" or "acik")) return BadRequest(new { hata = "Soru türü geçersiz." });
        }
        if (poz == DonemselDegerlendirmeServisi.GenelSet && liste.Count(x => x.Tur == "olcek") == 0)
            return BadRequest(new { hata = "Genel sette en az bir puanlı soru olmalı." });
        if (poz.Length > 100) return BadRequest(new { hata = "Set adı çok uzun." });

        using var db = _vt.Baglanti();
        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var tx = db.BeginTransaction();

        var mevcut = db.Query<int>("SELECT id FROM KRY_DD_SORU WHERE aktif = 1 AND pozisyon = @poz", new { poz }, tx).ToHashSet();
        var kalan = new HashSet<int>();
        var sira = 0;
        foreach (var x in liste)
        {
            sira++;
            if (x.Id is int id && mevcut.Contains(id))
            {
                db.Execute("UPDATE KRY_DD_SORU SET sira = @sira, tur = @Tur, metin = @Metin, zorunlu = @Zorunlu WHERE id = @id",
                    new { sira, x.Tur, x.Metin, Zorunlu = true, id }, tx);
                kalan.Add(id);
            }
            else
            {
                db.Execute("INSERT INTO KRY_DD_SORU (pozisyon, sira, tur, metin, zorunlu) VALUES (@poz, @sira, @Tur, @Metin, @Zorunlu)",
                    new { poz, sira, x.Tur, x.Metin, Zorunlu = true }, tx);
            }
        }
        var silinen = mevcut.Except(kalan).ToArray();
        if (silinen.Length > 0)
            db.Execute("UPDATE KRY_DD_SORU SET aktif = 0 WHERE id IN @silinen", new { silinen }, tx);
        tx.Commit();

        return Sorular(poz);
    }

    /* ==================================================================== */
    /* Panel · rapor                                                        */
    /* ==================================================================== */

    [HttpGet("Donemler")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Donemler()
    {
        using var db = _vt.Baglanti();
        var l = db.Query<string>("SELECT DISTINCT donem FROM KRY_DD_DEGERLENDIRME").ToList();
        var acik = _dd.AcikDonem();
        if (acik is not null && !l.Contains(acik.Kod)) l.Add(acik.Kod);
        return Ok(new
        {
            acik = acik?.Kod,
            donemler = l.OrderByDescending(x => x).Select(x => new { kod = x, ad = DonemselDegerlendirmeServisi.DonemAdi(x) }),
        });
    }

    /// <summary>Kapsamda değerlendirilecek kişi sayıları, iş grubuna (şubeye) göre (bugünkü kadroya göre).</summary>
    private Dictionary<string, int> SubeKadrolari(string kapsam = null) =>
        _dd.KapsamKisileri(kapsam ?? DonemselDegerlendirmeServisi.KSube)
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(gr => gr.Key, gr => gr.Count(), StringComparer.OrdinalIgnoreCase);

    private static string KapsamDuz(string k) =>
        DonemselDegerlendirmeServisi.KapsamTanimlari.Any(x => x.Kod == k) ? k : DonemselDegerlendirmeServisi.KSube;

    private static string OncekiDonem(System.Data.IDbConnection db, string donem) =>
        db.ExecuteScalar<string>("SELECT MAX(donem) FROM KRY_DD_DEGERLENDIRME WHERE donem < @donem", new { donem });

    [HttpGet("Rapor")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Rapor([FromQuery] string donem, [FromQuery] string pozisyon = null, [FromQuery] string kapsam = null)
    {
        kapsam = KapsamDuz(kapsam);
        using var db = _vt.Baglanti();
        donem ??= _dd.AcikDonem()?.Kod ?? db.ExecuteScalar<string>("SELECT MAX(donem) FROM KRY_DD_DEGERLENDIRME");
        if (donem is null) return Ok(new { donem = (string)null, subeler = Array.Empty<object>() });
        var once = OncekiDonem(db, donem);

        var poz = string.IsNullOrWhiteSpace(pozisyon) ? null : pozisyon.Trim();
        var kayit = db.Query(@"
SELECT d.donem, d.personel_kodu AS kod, d.sube_adi AS sube, d.pozisyon, d.genel_puan AS puan, d.soru_ort AS soruOrt
FROM KRY_DD_DEGERLENDIRME d
WHERE d.donem IN (@donem, @once) AND (@poz IS NULL OR d.pozisyon = @poz)
  AND ISNULL(d.kapsam, N'sube') = @kapsam", new { donem, once, poz, kapsam }).ToList();

        var bu = kayit.Where(x => (string)x.donem == donem).ToList();
        var onceki = kayit.Where(x => (string)x.donem == once).ToList();
        var kadro = SubeKadrolari(kapsam);

        decimal Ort(IEnumerable<dynamic> l) { var a = l.Select(x => (decimal)Convert.ToDecimal(x.puan)).ToList(); return a.Count == 0 ? 0 : Math.Round(a.Average(), 2); }
        decimal? SOrt(IEnumerable<dynamic> l) { var a = l.Where(x => x.soruOrt != null).Select(x => (decimal)Convert.ToDecimal(x.soruOrt)).ToList(); return a.Count == 0 ? null : Math.Round(a.Average(), 2); }

        var subeAdlari = bu.Select(x => ((string)x.sube ?? "").Trim()).Concat(kadro.Where(x => x.Value > 0).Select(x => x.Key))
            .Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase);

        var subeler = subeAdlari.Select(s =>
        {
            var b = bu.Where(x => string.Equals(((string)x.sube ?? "").Trim(), s, StringComparison.OrdinalIgnoreCase)).ToList();
            var o = onceki.Where(x => string.Equals(((string)x.sube ?? "").Trim(), s, StringComparison.OrdinalIgnoreCase)).ToList();
            return new
            {
                sube = s,
                ortalama = b.Count == 0 ? (decimal?)null : Ort(b),
                soruOrt = SOrt(b),
                onceki = o.Count == 0 ? (decimal?)null : Ort(o),
                yapilan = b.Count,
                kadro = Math.Max(kadro.GetValueOrDefault(s), b.Count),
            };
        }).OrderByDescending(x => x.ortalama ?? -1).ThenBy(x => x.sube).ToList();

        /* Soru bazında ortalama: en düşük konular */
        var konular = bu.Count == 0 ? new List<dynamic>() : db.Query(@"
SELECT TOP 5 c.soru_metni AS soru, AVG(CAST(c.puan AS DECIMAL(6,3))) AS ort, COUNT(*) AS adet
FROM KRY_DD_CEVAP c INNER JOIN KRY_DD_DEGERLENDIRME d ON d.id = c.degerlendirme_id
WHERE d.donem = @donem AND c.tur = N'olcek' AND c.puan IS NOT NULL AND (@poz IS NULL OR d.pozisyon = @poz)
  AND ISNULL(d.kapsam, N'sube') = @kapsam
GROUP BY c.soru_metni HAVING COUNT(*) >= 3
ORDER BY AVG(CAST(c.puan AS DECIMAL(6,3)))", new { donem, poz, kapsam }).ToList();

        var pozlar = db.Query<string>(@"SELECT DISTINCT pozisyon FROM KRY_DD_DEGERLENDIRME
WHERE donem = @donem AND pozisyon IS NOT NULL AND ISNULL(kapsam, N'sube') = @kapsam", new { donem, kapsam }).ToList();

        /* Kademe seçici: kayıt ya da açık kademe olanlar */
        var ayar = _dd.AyarOku();
        var kayitliKapsamlar = db.Query<string>("SELECT DISTINCT ISNULL(kapsam, N'sube') FROM KRY_DD_DEGERLENDIRME").ToHashSet();
        var kapsamlar = DonemselDegerlendirmeServisi.KapsamTanimlari
            .Where(t => t.Kod == DonemselDegerlendirmeServisi.KSube || kayitliKapsamlar.Contains(t.Kod) || _dd.KapsamKisileri(t.Kod, ayar).Count > 0)
            .Select(t => new { kod = t.Kod, ad = t.Ad });

        return Ok(new
        {
            donem, donemAdi = DonemselDegerlendirmeServisi.DonemAdi(donem),
            onceki = once, oncekiAdi = DonemselDegerlendirmeServisi.DonemAdi(once),
            acik = _dd.AcikDonem()?.Kod == donem,
            kapsam,
            kapsamlar,
            genel = new
            {
                ortalama = bu.Count == 0 ? (decimal?)null : Ort(bu),
                onceki = onceki.Count == 0 ? (decimal?)null : Ort(onceki),
                soruOrt = SOrt(bu),
                oncekiSoruOrt = SOrt(onceki),
                yapilan = bu.Count,
                kadro = subeler.Sum(x => x.kadro),
            },
            enDusuk = konular.Select(x => new { soru = (string)x.soru, ortalama = Math.Round((decimal)x.ort, 2), adet = (int)x.adet }),
            pozisyonlar = pozlar.OrderBy(x => x),
            subeler,
        });
    }

    /* ==================================================================== */
    /* Panel · rapor ve analiz (24.10.2026)                                  */
    /* ==================================================================== */

    /// <summary>
    /// Rapor sayfası: dönem trendi, şube ve pozisyon kıyası (önceki dönemle),
    /// puan dağılımı, soru bazında değişim, değerlendirici eğilimi, en çok
    /// yükselen/düşen personel ve oryantasyon değerlendirmeleriyle birlikte
    /// yeni personelin dönemsel puanı.
    /// </summary>
    [HttpGet("Rapor/Analiz")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult RaporAnaliz([FromQuery] string donem, [FromQuery] string pozisyon = null, [FromQuery] string kapsam = null)
    {
        kapsam = KapsamDuz(kapsam);
        using var db = _vt.Baglanti();
        donem ??= _dd.AcikDonem()?.Kod ?? db.ExecuteScalar<string>("SELECT MAX(donem) FROM KRY_DD_DEGERLENDIRME");
        if (donem is null) return Ok(new { donem = (string)null });
        var poz = string.IsNullOrWhiteSpace(pozisyon) ? null : pozisyon.Trim();

        var donemler = db.Query<string>(@"SELECT DISTINCT TOP 8 donem FROM KRY_DD_DEGERLENDIRME
WHERE donem <= @donem AND ISNULL(kapsam, N'sube') = @kapsam ORDER BY donem DESC", new { donem, kapsam }).ToList();
        if (!donemler.Contains(donem)) donemler.Insert(0, donem);
        var once = donemler.Where(x => string.CompareOrdinal(x, donem) < 0).OrderByDescending(x => x).FirstOrDefault();

        var kayit = db.Query(@"
SELECT d.id, d.donem, d.personel_kodu AS kod, d.ad_soyad AS adSoyad, d.sube_adi AS sube, d.pozisyon, d.genel_puan AS puan,
       d.soru_ort AS soruOrt, d.degerlendiren_kodu AS dKod, d.degerlendiren_ad AS dAd, d.degerlendiren_gorev AS dGorev
FROM KRY_DD_DEGERLENDIRME d
WHERE d.donem IN @donemler AND (@poz IS NULL OR d.pozisyon = @poz) AND ISNULL(d.kapsam, N'sube') = @kapsam",
            new { donemler, poz, kapsam })
            .Select(x => new Kayit((string)x.donem, K((string)x.kod), (string)x.adSoyad, ((string)x.sube ?? "").Trim(), ((string)x.pozisyon ?? "").Trim(),
                Convert.ToDecimal(x.puan), x.soruOrt == null ? null : (decimal?)Convert.ToDecimal(x.soruOrt), (string)x.dKod, (string)x.dAd, (string)x.dGorev))
            .ToList();

        var bu = kayit.Where(x => x.Donem == donem).ToList();
        var onc = kayit.Where(x => x.Donem == once).ToList();
        static decimal? Ort(IEnumerable<Kayit> l) { var a = l.Select(x => x.Puan).ToList(); return a.Count == 0 ? null : Math.Round(a.Average(), 2); }
        static decimal? SOrt(IEnumerable<Kayit> l) { var a = l.Where(x => x.SoruOrt != null).Select(x => x.SoruOrt.Value).ToList(); return a.Count == 0 ? null : Math.Round(a.Average(), 2); }
        static decimal? Fark(decimal? a, decimal? b) => a is null || b is null ? null : Math.Round(a.Value - b.Value, 2);

        var kadro = SubeKadrolari(kapsam);
        var genelOrt = Ort(bu);

        /* Trend: dönem dönem ortalama ve katılım */
        var trend = donemler.OrderBy(x => x).Select(dn =>
        {
            var l = kayit.Where(x => x.Donem == dn).ToList();
            return new { donem = dn, ad = DonemselDegerlendirmeServisi.DonemAdi(dn), ortalama = Ort(l), soruOrt = SOrt(l), yapilan = l.Count,
                sube = l.Select(x => x.Sube).Distinct(StringComparer.OrdinalIgnoreCase).Count() };
        }).ToList();

        /* Şubeler */
        var subeAdlari = bu.Select(x => x.Sube).Concat(onc.Select(x => x.Sube)).Concat(kadro.Where(x => x.Value > 0).Select(x => x.Key))
            .Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var subeler = subeAdlari.Select(sb =>
        {
            var b = bu.Where(x => x.Sube.Equals(sb, StringComparison.OrdinalIgnoreCase)).ToList();
            var o = onc.Where(x => x.Sube.Equals(sb, StringComparison.OrdinalIgnoreCase)).ToList();
            var k = Math.Max(kadro.GetValueOrDefault(sb), b.Count);
            return new
            {
                sube = sb, ortalama = Ort(b), onceki = Ort(o), fark = Fark(Ort(b), Ort(o)), soruOrt = SOrt(b), oncekiSoruOrt = SOrt(o),
                yapilan = b.Count, kadro = k, tamamlanma = k == 0 ? 0 : (int)Math.Round(b.Count * 100.0 / k),
                dusuk = b.Count(x => x.Puan <= 5), yuksek = b.Count(x => x.Puan >= 9),
            };
        }).OrderByDescending(x => x.ortalama ?? -1).ThenBy(x => x.sube).ToList();

        /* Pozisyonlar */
        var pozisyonlar = bu.Select(x => x.Pozisyon).Concat(onc.Select(x => x.Pozisyon)).Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase).Select(pz =>
            {
                var b = bu.Where(x => x.Pozisyon.Equals(pz, StringComparison.OrdinalIgnoreCase)).ToList();
                var o = onc.Where(x => x.Pozisyon.Equals(pz, StringComparison.OrdinalIgnoreCase)).ToList();
                return new { pozisyon = pz, ortalama = Ort(b), onceki = Ort(o), fark = Fark(Ort(b), Ort(o)), soruOrt = SOrt(b), yapilan = b.Count, oncekiYapilan = o.Count };
            }).OrderByDescending(x => x.yapilan).ThenByDescending(x => x.ortalama ?? -1).ToList();

        /* Puan dağılımı 1–10 */
        var dagilim = Enumerable.Range(1, 10).Select(p => new { puan = p, bu = bu.Count(x => (int)x.Puan == p), onceki = onc.Count(x => (int)x.Puan == p) });

        /* Sorular: bu dönem ve önceki ortalama */
        var soruSatir = db.Query(@"
SELECT d.donem, c.soru_metni AS soru, AVG(CAST(c.puan AS DECIMAL(6,3))) AS ort, COUNT(*) AS adet
FROM KRY_DD_CEVAP c INNER JOIN KRY_DD_DEGERLENDIRME d ON d.id = c.degerlendirme_id
WHERE d.donem IN (@donem, @once) AND c.tur = N'olcek' AND c.puan IS NOT NULL AND (@poz IS NULL OR d.pozisyon = @poz)
  AND ISNULL(d.kapsam, N'sube') = @kapsam
GROUP BY d.donem, c.soru_metni", new { donem, once, poz, kapsam }).ToList();
        var sorular = soruSatir.Where(x => (string)x.donem == donem && (int)x.adet >= 3).Select(x =>
        {
            var o = soruSatir.FirstOrDefault(y => (string)y.donem == once && (string)y.soru == (string)x.soru);
            decimal b = Math.Round((decimal)x.ort, 2);
            decimal? ov = o is null ? null : Math.Round((decimal)o.ort, 2);
            return new { soru = (string)x.soru, ortalama = b, onceki = ov, fark = Fark(b, ov), adet = (int)x.adet };
        }).OrderBy(x => x.ortalama).ToList();

        /* Değerlendirici eğilimi: genel ortalamadan sapma (en az 3 değerlendirme) */
        var degerlendirenler = bu.Where(x => !string.IsNullOrWhiteSpace(x.DKod)).GroupBy(x => K(x.DKod)).Where(g => g.Count() >= 3).Select(g =>
        {
            var o = Ort(g);
            return new
            {
                kod = g.Key, ad = g.First().DAd, gorev = g.First().DGorev,
                sube = g.GroupBy(x => x.Sube).OrderByDescending(x => x.Count()).First().Key,
                adet = g.Count(), ortalama = o, sapma = Fark(o, genelOrt),
                dagilim = g.Select(x => (int)x.Puan).Distinct().Count(),
            };
        }).OrderByDescending(x => Math.Abs(x.sapma ?? 0)).Take(12).ToList();

        /* En çok yükselen / düşen personel (iki dönemde de değerlendirilen) */
        var oncHarita = onc.GroupBy(x => x.Kod).ToDictionary(g => g.Key, g => g.First());
        var degisim = bu.Where(x => oncHarita.ContainsKey(x.Kod)).Select(x => new
        {
            kod = x.Kod, adSoyad = x.AdSoyad, sube = x.Sube, pozisyon = x.Pozisyon,
            puan = (int)x.Puan, onceki = (int)oncHarita[x.Kod].Puan, fark = (int)(x.Puan - oncHarita[x.Kod].Puan),
        }).Where(x => x.fark != 0).ToList();

        /* Oryantasyon: çalışanın kendi anketi ve yöneticinin değerlendirmesi (1–5) */
        var uyum = new List<dynamic>();
        try
        {
            uyum = db.Query(@"
SELECT personel_kodu AS kod, tur, asama, puan, dolduruldu, ad_soyad AS adSoyad, sube_adi AS sube, gorev, giris_tarihi AS giris
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND personel_kodu IS NOT NULL AND dolduruldu IS NOT NULL AND puan IS NOT NULL").ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Oryantasyon verisi okunamadı");
        }
        var asamaSira = new Dictionary<string, int> { ["7g"] = 1, ["2a"] = 2, ["6a"] = 3, ["1y"] = 4 };
        var oryKisi = uyum.GroupBy(x => K((string)x.kod)).ToDictionary(g => g.Key, g =>
        {
            dynamic Son(string tur) => g.Where(x => (string)x.tur == tur)
                .OrderByDescending(x => asamaSira.GetValueOrDefault((string)x.asama)).ThenByDescending(x => (DateTime)x.dolduruldu).FirstOrDefault();
            var c = Son("calisan");
            var y = Son("yonetici");
            var ilk = g.First();
            decimal? cp = c is null ? null : Math.Round((decimal)Convert.ToDecimal(c.puan), 1);
            decimal? yp = y is null ? null : Math.Round((decimal)Convert.ToDecimal(y.puan), 1);
            string asama = c is not null ? (string)c.asama : y is not null ? (string)y.asama : null;
            DateTime? giris = ilk.giris is null ? null : (DateTime?)(DateTime)ilk.giris;
            return new OryKisi(cp, yp, asama, giris);
        });

        var oryantasyon = bu.Where(x => oryKisi.ContainsKey(x.Kod)).Select(x =>
        {
            var o = oryKisi[x.Kod];
            /* Yönetici de çalışan da 1–5; dönemsel 1–10. Kıyas için 1–5'e çevrilir. */
            var dd5 = Math.Round(x.Puan / 2m, 1);
            var ory = o.yonetici ?? o.calisan;
            var durum = ory is null ? "bilinmiyor"
                : ory >= 3.5m && dd5 >= 3.5m ? "uyumlu-iyi"
                : ory < 3m && dd5 < 3m ? "uyumlu-zayif"
                : ory - dd5 >= 1m ? "dustu"
                : dd5 - ory >= 1m ? "yukseldi" : "uyumlu";
            return new
            {
                kod = x.Kod, adSoyad = x.AdSoyad, sube = x.Sube, pozisyon = x.Pozisyon, puan = (int)x.Puan,
                oryCalisan = o.calisan, oryYonetici = o.yonetici,
                asama = o.asama, asamaAdi = o.asama is null ? null : UyumGonderimServisi.AsamaAdi.GetValueOrDefault(o.asama),
                giris = o.giris, durum,
            };
        }).OrderBy(x => x.durum == "dustu" ? 0 : x.durum == "uyumlu-zayif" ? 1 : 2).ThenBy(x => x.puan).ToList();

        var oryKodlar = oryantasyon.Select(x => x.kod).ToHashSet();
        var yeniOrt = Ort(bu.Where(x => oryKodlar.Contains(x.Kod)));
        var digerOrt = Ort(bu.Where(x => !oryKodlar.Contains(x.Kod)));
        var oryOzet = new
        {
            kisi = oryantasyon.Count,
            yeniOrt, digerOrt,
            calisanOrt = oryantasyon.Any(x => x.oryCalisan != null) ? Math.Round(oryantasyon.Where(x => x.oryCalisan != null).Average(x => x.oryCalisan.Value), 2) : (decimal?)null,
            yoneticiOrt = oryantasyon.Any(x => x.oryYonetici != null) ? Math.Round(oryantasyon.Where(x => x.oryYonetici != null).Average(x => x.oryYonetici.Value), 2) : (decimal?)null,
            dustu = oryantasyon.Count(x => x.durum == "dustu"),
            yukseldi = oryantasyon.Count(x => x.durum == "yukseldi"),
            zayif = oryantasyon.Count(x => x.durum == "uyumlu-zayif"),
            subeler = oryantasyon.GroupBy(x => x.sube).Select(g => new
            {
                sube = g.Key, kisi = g.Count(), ddOrt = Math.Round((decimal)g.Average(x => x.puan), 2),
                oryOrt = g.Any(x => (x.oryYonetici ?? x.oryCalisan) != null) ? Math.Round(g.Where(x => (x.oryYonetici ?? x.oryCalisan) != null).Average(x => (x.oryYonetici ?? x.oryCalisan).Value), 2) : (decimal?)null,
            }).OrderByDescending(x => x.kisi).ToList(),
        };

        return Ok(new
        {
            donem, donemAdi = DonemselDegerlendirmeServisi.DonemAdi(donem),
            onceki = once, oncekiAdi = DonemselDegerlendirmeServisi.DonemAdi(once),
            genel = new
            {
                ortalama = genelOrt, onceki = Ort(onc), fark = Fark(genelOrt, Ort(onc)), soruOrt = SOrt(bu), oncekiSoruOrt = SOrt(onc),
                yapilan = bu.Count, oncekiYapilan = onc.Count, kadro = subeler.Sum(x => x.kadro),
                sube = bu.Select(x => x.Sube).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                yukselen = degisim.Count(x => x.fark > 0), dusen = degisim.Count(x => x.fark < 0),
            },
            trend, subeler, pozisyonlar, dagilim, sorular, degerlendirenler,
            yukselenler = degisim.OrderByDescending(x => x.fark).Take(8),
            dusenler = degisim.OrderBy(x => x.fark).Take(8),
            oryantasyon = oryantasyon.Take(200), oryOzet,
        });
    }

    /// <summary>
    /// Rapor ayrıntısı (26.10.2026): rapordaki her alanın arkasındaki
    /// personel listesi. tur: hepsi | bekleyen | sube | pozisyon | puan |
    /// soru | degerlendiren | degisim (deger: art / eks) | dusuk | yuksek.
    /// </summary>
    [HttpGet("Rapor/Liste")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult RaporListe([FromQuery] string donem, [FromQuery] string tur, [FromQuery] string deger = null,
        [FromQuery] string sube = null, [FromQuery] string pozisyon = null, [FromQuery] string kapsam = null)
    {
        kapsam = KapsamDuz(kapsam);
        if (string.IsNullOrWhiteSpace(donem)) return BadRequest(new { hata = "Dönem gerekli." });
        tur = (tur ?? "hepsi").Trim().ToLowerInvariant();
        var poz = string.IsNullOrWhiteSpace(pozisyon) ? null : pozisyon.Trim();
        var sb = string.IsNullOrWhiteSpace(sube) ? null : sube.Trim();
        deger = string.IsNullOrWhiteSpace(deger) ? null : deger.Trim();
        if (tur == "pozisyon") poz = deger;
        if (tur == "sube") sb = deger;

        using var db = _vt.Baglanti();
        var once = OncekiDonem(db, donem);

        var kayit = db.Query(@"
SELECT d.id, d.donem, d.personel_kodu AS kod, d.ad_soyad AS adSoyad, LTRIM(RTRIM(ISNULL(d.sube_adi, N''))) AS sube, d.pozisyon,
       d.genel_puan AS puan, d.soru_ort AS soruOrt, d.degerlendiren_kodu AS dKod, d.degerlendiren_ad AS dAd,
       ISNULL(d.guncelleme, d.olusturma) AS tarih
FROM KRY_DD_DEGERLENDIRME d
WHERE d.donem IN (@donem, @once) AND (@poz IS NULL OR d.pozisyon = @poz) AND (@sb IS NULL OR LTRIM(RTRIM(d.sube_adi)) = @sb)
  AND ISNULL(d.kapsam, N'sube') = @kapsam", new { donem, once, poz, sb, kapsam }).ToList();

        var bu = kayit.Where(x => (string)x.donem == donem).ToList();
        var onc = kayit.Where(x => (string)x.donem == once).ToDictionary(x => K((string)x.kod), x => Convert.ToInt32(x.puan));
        string baslik = DonemselDegerlendirmeServisi.DonemAdi(donem);

        object Satir(dynamic x, int? soruPuan = null)
        {
            var kod = K((string)x.kod);
            int? o = onc.TryGetValue(kod, out var op) ? op : null;
            var p = Convert.ToInt32(x.puan);
            return new
            {
                kod, adSoyad = (string)x.adSoyad, sube = (string)x.sube, pozisyon = (string)x.pozisyon,
                puan = (int?)p, onceki = o, fark = o is null ? (int?)null : p - o.Value,
                soruOrt = x.soruOrt == null ? (decimal?)null : Convert.ToDecimal(x.soruOrt),
                degerlendiren = (string)x.dAd, tarih = (DateTime?)x.tarih, soruPuan, durum = "tamam",
            };
        }

        IEnumerable<object> liste;
        switch (tur)
        {
            case "bekleyen":
            {
                var acik = _dd.AcikDonem()?.Kod == donem;
                var yapilan = bu.Select(x => K((string)x.kod)).ToHashSet();
                liste = !acik ? Array.Empty<object>() : _dd.KapsamKisileri(kapsam)
                    .Where(p => !yapilan.Contains(K(p.PersonelKodu)))
                    .Where(p => poz is null || string.Equals((p.Pozisyon ?? "").Trim(), poz, StringComparison.OrdinalIgnoreCase))
                    .Where(p => sb is null || SubeEsit(p.IsGrubu, sb))
                    .Select(p => (object)new
                    {
                        kod = K(p.PersonelKodu), adSoyad = Ad(p), sube = (p.IsGrubu ?? "").Trim(), pozisyon = p.Pozisyon,
                        puan = (int?)null, onceki = onc.TryGetValue(K(p.PersonelKodu), out var op) ? op : (int?)null, fark = (int?)null,
                        soruOrt = (decimal?)null, degerlendiren = (string)null, tarih = (DateTime?)null, soruPuan = (int?)null, durum = "bekliyor",
                    });
                baslik += " · değerlendirme bekleyenler";
                break;
            }
            case "puan":
            {
                var n = int.TryParse(deger, out var v) ? v : -1;
                liste = bu.Where(x => Convert.ToInt32(x.puan) == n).Select(x => Satir(x));
                baslik += $" · genel puanı {n} olanlar";
                break;
            }
            case "dusuk":
                liste = bu.Where(x => Convert.ToInt32(x.puan) <= 5).Select(x => Satir(x));
                baslik += " · 5 ve altı puan alanlar";
                break;
            case "yuksek":
                liste = bu.Where(x => Convert.ToInt32(x.puan) >= 9).Select(x => Satir(x));
                baslik += " · 9 ve üstü puan alanlar";
                break;
            case "degerlendiren":
                liste = bu.Where(x => K((string)x.dKod) == K(deger) || (string)x.dAd == deger).Select(x => Satir(x));
                baslik += " · " + (bu.FirstOrDefault(x => K((string)x.dKod) == K(deger))?.dAd ?? deger) + " değerlendirdi";
                break;
            case "degisim":
            {
                var l = bu.Where(x => onc.ContainsKey(K((string)x.kod))).Select(x => Satir(x)).Cast<dynamic>();
                l = deger == "art" ? l.Where(x => x.fark > 0) : deger == "eks" ? l.Where(x => x.fark < 0) : l;
                liste = l.Cast<object>();
                baslik += deger == "art" ? " · puanı yükselenler" : deger == "eks" ? " · puanı düşenler" : " · önceki dönemle aynı kişiler";
                break;
            }
            case "soru":
            {
                var cev = bu.Count == 0 || deger is null ? new List<dynamic>() : db.Query(@"
SELECT c.degerlendirme_id AS did, c.puan FROM KRY_DD_CEVAP c
WHERE c.degerlendirme_id IN @idler AND c.soru_metni = @deger AND c.puan IS NOT NULL", new { idler = bu.Select(x => (int)x.id).ToArray(), deger }).ToList();
                var pu = cev.ToDictionary(x => (int)x.did, x => Convert.ToInt32(x.puan));
                liste = bu.Where(x => pu.ContainsKey((int)x.id)).Select(x => Satir(x, pu[(int)x.id]))
                    .OrderBy(x => ((dynamic)x).soruPuan).ToList();
                baslik += " · " + deger;
                break;
            }
            default:
                liste = bu.Select(x => Satir(x));
                baslik += poz is not null ? $" · {poz}" : sb is not null ? $" · {sb}" : " · değerlendirilenler";
                break;
        }

        var tr = StringComparer.Create(new CultureInfo("tr-TR"), true);
        var sonuc = liste.Cast<dynamic>().ToList();
        if (tur != "soru")
            sonuc = sonuc.OrderBy(x => x.puan == null ? 1 : 0).ThenBy(x => (int?)x.puan ?? 0).ThenBy(x => (string)x.adSoyad, tr).ToList();

        return Ok(new
        {
            baslik, tur, donem, donemAdi = DonemselDegerlendirmeServisi.DonemAdi(donem), oncekiAdi = DonemselDegerlendirmeServisi.DonemAdi(once),
            kisiler = sonuc,
        });
    }

    private sealed record OryKisi(decimal? calisan, decimal? yonetici, string asama, DateTime? giris);

    private sealed record Kayit(string Donem, string Kod, string AdSoyad, string Sube, string Pozisyon, decimal Puan, decimal? SoruOrt,
        string DKod, string DAd, string DGorev);

    [HttpGet("Rapor/Sube")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult RaporSube([FromQuery] string donem, [FromQuery] string sube, [FromQuery] string kapsam = null)
    {
        kapsam = KapsamDuz(kapsam);
        if (string.IsNullOrWhiteSpace(donem) || string.IsNullOrWhiteSpace(sube)) return BadRequest(new { hata = "Dönem ve şube gerekli." });
        using var db = _vt.Baglanti();
        var kayit = db.Query(@"
SELECT personel_kodu AS kod, ad_soyad AS adSoyad, pozisyon, genel_puan AS puan, soru_ort AS soruOrt,
       degerlendiren_ad AS degerlendiren, degerlendiren_gorev AS degerlendirenGorev, ISNULL(guncelleme, olusturma) AS tarih
FROM KRY_DD_DEGERLENDIRME WHERE donem = @donem AND sube_adi = @sube AND ISNULL(kapsam, N'sube') = @kapsam",
            new { donem, sube = sube.Trim(), kapsam }).ToList();

        var acik = _dd.AcikDonem()?.Kod == donem;
        var ekip = !acik ? new List<PersonelKaydi>()
            : kapsam == DonemselDegerlendirmeServisi.KSube ? _dd.SubeEkibi(sube)
            : _dd.KapsamKisileri(kapsam).Where(x => string.Equals((x.IsGrubu ?? "").Trim(), sube.Trim(), StringComparison.OrdinalIgnoreCase)).ToList();
        var kodlar = kayit.Select(x => (string)x.kod).Concat(ekip.Select(x => K(x.PersonelKodu))).Distinct().ToArray();

        var oncekiler = kodlar.Length == 0 ? new List<dynamic>() : db.Query(@"
SELECT d.personel_kodu AS kod, d.donem, d.genel_puan AS puan, d.soru_ort AS soruOrt
FROM KRY_DD_DEGERLENDIRME d
WHERE d.personel_kodu IN @kodlar AND d.donem < @donem", new { kodlar, donem }).ToList();

        dynamic Onceki(string k) => oncekiler.Where(x => (string)x.kod == k).OrderByDescending(x => (string)x.donem).FirstOrDefault();

        var satirlar = kayit.Select(x =>
        {
            var o = Onceki((string)x.kod);
            return new
            {
                kod = (string)x.kod, adSoyad = (string)x.adSoyad, pozisyon = (string)x.pozisyon,
                puan = (int?)Convert.ToInt32(x.puan), soruOrt = (decimal?)x.soruOrt,
                degerlendiren = (string)x.degerlendiren, degerlendirenGorev = (string)x.degerlendirenGorev, tarih = (DateTime?)x.tarih,
                oncekiPuan = o is null ? (int?)null : Convert.ToInt32(o.puan),
                oncekiSoruOrt = (decimal?)o?.soruOrt,
                oncekiDonemAdi = o is null ? null : DonemselDegerlendirmeServisi.DonemAdi((string)o.donem),
            };
        }).ToList();

        satirlar.AddRange(ekip.Where(p => !kayit.Any(x => (string)x.kod == K(p.PersonelKodu))).Select(p =>
        {
            var o = Onceki(K(p.PersonelKodu));
            return new
            {
                kod = K(p.PersonelKodu), adSoyad = Ad(p), pozisyon = p.Pozisyon,
                puan = (int?)null, soruOrt = (decimal?)null, degerlendiren = (string)null, degerlendirenGorev = (string)null, tarih = (DateTime?)null,
                oncekiPuan = o is null ? (int?)null : Convert.ToInt32(o.puan),
                oncekiSoruOrt = (decimal?)o?.soruOrt,
                oncekiDonemAdi = o is null ? null : DonemselDegerlendirmeServisi.DonemAdi((string)o.donem),
            };
        }));

        return Ok(new { donem, donemAdi = DonemselDegerlendirmeServisi.DonemAdi(donem), sube, kisiler = satirlar.OrderByDescending(x => x.puan ?? -1) });
    }

    /// <summary>Personelin bütün dönemsel değerlendirmeleri (cevaplarıyla), eskiden yeniye.</summary>
    [HttpGet("Personel/{kod}")]
    [Authorize(Roles = PanelRolleri)]
    public IActionResult Personel(string kod)
    {
        using var db = _vt.Baglanti();
        var l = db.Query(@"
SELECT id, donem, ad_soyad AS adSoyad, pozisyon, sube_adi AS sube, genel_puan AS genelPuan, soru_ort AS soruOrt,
       ISNULL(kapsam, N'sube') AS kapsam,
       genel_aciklama AS genelAciklama,
       degerlendiren_ad AS degerlendiren, degerlendiren_gorev AS degerlendirenGorev, ISNULL(guncelleme, olusturma) AS tarih
FROM KRY_DD_DEGERLENDIRME WHERE personel_kodu = @kod ORDER BY donem", new { kod = K(kod) }).ToList();
        var idler = l.Select(x => (int)x.id).ToArray();
        var cevaplar = idler.Length == 0 ? new List<dynamic>() : db.Query(@"
SELECT degerlendirme_id AS did, soru_id AS soruId, soru_metni AS soru, tur, puan, metin
FROM KRY_DD_CEVAP WHERE degerlendirme_id IN @idler ORDER BY id", new { idler }).ToList();

        return Ok(l.Select(x => new
        {
            donem = (string)x.donem,
            donemAdi = DonemselDegerlendirmeServisi.DonemAdi((string)x.donem),
            adSoyad = (string)x.adSoyad, pozisyon = (string)x.pozisyon, sube = (string)x.sube,
            kapsam = (string)x.kapsam, kapsamAdi = DonemselDegerlendirmeServisi.KapsamAdi((string)x.kapsam),
            genelPuan = Convert.ToInt32(x.genelPuan), soruOrt = (decimal?)x.soruOrt, genelAciklama = (string)x.genelAciklama,
            degerlendiren = (string)x.degerlendiren, degerlendirenGorev = (string)x.degerlendirenGorev, tarih = (DateTime)x.tarih,
            cevaplar = cevaplar.Where(c => (int)c.did == (int)x.id).Select(c => new
            {
                soruId = (int)c.soruId, soru = (string)c.soru, tur = (string)c.tur,
                puan = c.puan is null ? (int?)null : Convert.ToInt32(c.puan), metin = (string)c.metin,
            }),
        }));
    }
}

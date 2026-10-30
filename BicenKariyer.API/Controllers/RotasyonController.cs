using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Rotasyon (şube değişikliği) talebi (07.10.2026).
///
/// <list type="number">
/// <item>Yönetici Biçen360 › Ekibim › personel › "Rotasyon talebi" ile açar:
/// "yönetici isteği / personel isteği" seçimi, zorunlu açıklama ve bir ya da
/// daha çok hedef şube. O pozisyonda norm kadrosu açık olan şubeler öneri
/// olarak önde, diğer şubeler arkada listelenir.</item>
/// <item>Personel talebi yalnızca görür (ana sayfa kartı); işlem yapamaz.</item>
/// <item>Yönetici isteğinde önce şubenin bölge müdürü onaylar (Biçen360 İzin
/// Onayları ya da panel), sonra İK. Personel isteğinde doğrudan İK.</item>
/// <item>İK onaylarken hedef şubelerden birini seçer; şube değişikliği
/// Mikro'da yapılınca talep "Mikro'ya işlendi" olur (elle ya da Mikro
/// değişikliği algılanınca kendiliğinden).</item>
/// </list>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RotasyonController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly IzinOnayKuralServisi _kural;
    private readonly BildirimServisi _bildirim;
    private readonly AyarServisi _ayar;
    private readonly ILogger<RotasyonController> _kayit;
    private readonly AvansOnayZinciri _zincir;

    public RotasyonController(VeritabaniServisi vt, EkipServisi ekip, IzinOnayKuralServisi kural,
        BildirimServisi bildirim, AyarServisi ayar, ILogger<RotasyonController> kayit, AvansOnayZinciri zincir)
    {
        _zincir = zincir;
        _vt = vt;
        _ekip = ekip;
        _kural = kural;
        _bildirim = bildirim;
        _ayar = ayar;
        _kayit = kayit;
    }

    public const string Bolge = "bolge";
    public const string Ik = "ik";
    public const string Onaylandi = "onaylandi";
    public const string Reddedildi = "reddedildi";
    public const string Iptal = "iptal";

    public const string YoneticiIstegi = "yonetici";
    public const string PersonelIstegi = "personel";

    private static readonly Dictionary<string, string> DurumAdlari = new()
    {
        [Bolge] = "Bölge müdürü onayında",
        [Ik] = "İK onayında",
        [Onaylandi] = "Onaylandı",
        [Reddedildi] = "Reddedildi",
        [Iptal] = "İptal edildi",
    };

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
    private bool PersonelMi => User?.IsInRole("Personel") ?? false;

    private bool IkYetkili =>
        !PersonelMi && Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    private bool PanelBolgeMuduru => !PersonelMi && Roller.Temel(Rol) == Roller.BolgeMuduru;

    private string PanelAdi => User?.FindFirst("adSoyad")?.Value ?? User?.Identity?.Name ?? "panel";

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return i < 0 ? govde : govde[..i];
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');
    private static string AdSoyad(PersonelKaydi p) => p is null ? "" : $"{p.Ad} {p.Soyad}".Trim();

    /* ==================================================================== */
    /* Ortak                                                                */
    /* ==================================================================== */

    public sealed class Hedef
    {
        public string Ad { get; set; }
        public string Kod { get; set; }

        /// <summary>Talep anında o pozisyondaki açık kadro (norm − mevcut)</summary>
        public decimal Acik { get; set; }
    }

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
    };

    private static List<Hedef> HedefOku(string ham)
    {
        try { return JsonSerializer.Deserialize<List<Hedef>>(ham ?? "[]", Json) ?? new(); }
        catch { return new(); }
    }

    private const string Secim = @"
SELECT id, personel_kodu, ad_soyad, sube, pozisyon, tur, aciklama, hedefler, durum,
       talep_eden, talep_eden_ad, bolge_kodlari, bolge_kisi, bolge_karar, bolge_not, bolge_tarih,
       ik_kisi, ik_karar, ik_not, ik_tarih, onaylanan_sube, mikro_islendi, mikro_not, olusturma
FROM KRY_ROTASYON_TALEP";

    private static object Disari(dynamic r) => Disari(r, false);

    private static object Disari(dynamic r, bool sirada) => new
    {
        sirada,
        id = (int)r.id,
        sicil = (string)r.personel_kodu,
        adSoyad = (string)r.ad_soyad,
        sube = (string)r.sube,
        pozisyon = (string)r.pozisyon,
        tur = (string)r.tur,
        turAdi = (string)r.tur == PersonelIstegi ? "Personel isteği" : "Yönetici isteği",
        aciklama = (string)r.aciklama,
        hedefler = HedefOku((string)r.hedefler),
        durum = (string)r.durum,
        durumAdi = DurumAdlari.GetValueOrDefault((string)r.durum ?? "", (string)r.durum),
        talepEden = (string)r.talep_eden_ad ?? (string)r.talep_eden,
        bolgeKisi = (string)r.bolge_kisi,
        bolgeKarar = (string)r.bolge_karar,
        bolgeNot = (string)r.bolge_not,
        bolgeTarih = (DateTime?)r.bolge_tarih,
        ikKisi = (string)r.ik_kisi,
        ikKarar = (string)r.ik_karar,
        ikNot = (string)r.ik_not,
        ikTarih = (DateTime?)r.ik_tarih,
        onaylananSube = (string)r.onaylanan_sube,
        mikroIslendi = (DateTime?)r.mikro_islendi,
        mikroNot = (string)r.mikro_not,
        olusturma = (DateTime)r.olusturma,
    };

    /// <summary>
    /// Hedef şube seçenekleri: personelin pozisyonunda norm kadrosu açık
    /// olan şubeler (öneri, açık sayısına göre) ve diğer birimler. Personelin
    /// kendi şubesi listede yok.
    /// </summary>
    private (List<Hedef> Oneriler, List<Hedef> Digerleri, string Bolum) HedefSecenekleri(
        System.Data.IDbConnection db, PersonelKaydi kisi)
    {
        var form = _ayar.FormOku();
        var personelAyar = _ayar.PersonelOku();
        var bolum = PersonelKaynagiServisi.UnvanKarsiligi(personelAyar, kisi.Pozisyon);
        var bolumAnahtari = PersonelKaynagiServisi.MeslekAnahtari(bolum);
        var kendi = (kisi.IsGrubu ?? "").Trim();

        bool Kendisi(string ad) =>
            !string.IsNullOrWhiteSpace(ad)
            && (string.Equals(ad.Trim(), kendi, StringComparison.OrdinalIgnoreCase) || PersonelKaynagiServisi.Benziyor(ad, kendi));

        var acik = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var adlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var k in db.Query(@"
SELECT sube_kodu AS kod, sube_adi AS ad, bolum, ISNULL(norm, 0) AS norm, ISNULL(mevcut, 0) AS mevcut
FROM KRY_KADRO WHERE aktif = 1 AND sube_kodu IS NOT NULL"))
            {
                if (PersonelKaynagiServisi.MeslekAnahtari((string)k.bolum) != bolumAnahtari) continue;

                var fark = Convert.ToDecimal(k.norm) - Convert.ToDecimal(k.mevcut);
                if (fark <= 0) continue;

                var kod = ((string)k.kod ?? "").Trim();
                acik[kod] = acik.GetValueOrDefault(kod) + fark;
                adlar[kod] = (string)k.ad;
            }
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Rotasyon: kadro okunamadı");
        }

        var birimler = (form.Subeler ?? new List<Sube>())
            .Where(b => !string.IsNullOrWhiteSpace(b.Ad) || !string.IsNullOrWhiteSpace(b.Kod))
            .Select(b => new Hedef
            {
                Ad = (string.IsNullOrWhiteSpace(b.Ad) ? b.Kod : b.Ad).Trim(),
                Kod = (b.Kod ?? "").Trim(),
                Acik = acik.GetValueOrDefault((b.Kod ?? "").Trim()),
            })
            .Where(b => !Kendisi(b.Ad))
            .GroupBy(b => b.Ad, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        /* Kadroda olup birimlerde olmayan şube (eski tanım) */
        foreach (var (kod, ad) in adlar)
            if (!birimler.Any(b => string.Equals(b.Kod, kod, StringComparison.OrdinalIgnoreCase)) && !Kendisi(ad))
                birimler.Add(new Hedef { Ad = ad ?? kod, Kod = kod, Acik = acik.GetValueOrDefault(kod) });

        var tr = StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true);

        var oneriler = birimler.Where(b => b.Acik > 0).OrderByDescending(b => b.Acik).ThenBy(b => b.Ad, tr).ToList();
        var digerleri = birimler.Where(b => b.Acik <= 0).OrderBy(b => b.Ad, tr).ToList();

        return (oneriler, digerleri, bolum);
    }

    /// <summary>Panel bölge müdürünün şubeleri (Kullanıcılar › şube hakkı)</summary>
    private UzmanKapsami PanelKapsami(System.Data.IDbConnection db) =>
        UzmanKapsami.Olustur(db, _ayar, Roller.IK, User?.Identity?.Name, null);

    /* ==================================================================== */
    /* Mobil: yönetici                                                       */
    /* ==================================================================== */

    /// <summary>Ekibim › personel: rotasyon talepleri ve açabilir mi.</summary>
    [HttpGet("Mobil/Kisi/{sicil}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilKisi(string sicil)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu) || !_ekip.IslemYapabilir(ben, hedef))
            return Ok(new { acabilir = false });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(Secim + " WHERE personel_kodu = @kod ORDER BY olusturma DESC",
                new { kod = hedef.PersonelKodu.Trim() })
            .Take(10).Select(Disari).ToList();

        return Ok(new { acabilir = true, kayitlar });
    }

    /// <summary>Talep formu: hedef şube seçenekleri (öneriler önde).</summary>
    [HttpGet("Mobil/Secenekler/{sicil}")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilSecenekler(string sicil)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });
        if (!_ekip.IslemYapabilir(ben, hedef)) return StatusCode(403, new { hata = "Bu personel için talep açamazsınız." });

        using var db = _vt.Baglanti();
        var (oneriler, digerleri, bolum) = HedefSecenekleri(db, hedef);

        return Ok(new
        {
            kisi = new { adSoyad = AdSoyad(hedef), sube = hedef.IsGrubu, pozisyon = hedef.Pozisyon },
            bolum,
            oneriler,
            digerleri,
        });
    }

    public class TalepGirdi
    {
        public string Sicil { get; set; }
        public string Tur { get; set; }
        public string Aciklama { get; set; }
        public List<string> Hedefler { get; set; }
    }

    [HttpPost("Mobil")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilOlustur([FromBody] TalepGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(g?.Sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu) || !_ekip.IslemYapabilir(ben, hedef))
            return StatusCode(403, new { hata = "Bu personel için rotasyon talebi açamazsınız." });

        var tur = (g.Tur ?? "").Trim().ToLowerInvariant();
        if (tur is not (YoneticiIstegi or PersonelIstegi))
            return BadRequest(new { hata = "Talebin yönetici isteği mi personel isteği mi olduğunu seçiniz." });

        var aciklama = (g.Aciklama ?? "").Trim();
        if (aciklama.Length < 10) return BadRequest(new { hata = "Rotasyon gerekçesini açıklayınız (en az 10 karakter)." });
        if (aciklama.Length > 1000) aciklama = aciklama[..1000];

        using var db = _vt.Baglanti();

        var (oneriler, digerleri, _) = HedefSecenekleri(db, hedef);
        var secenekler = oneriler.Concat(digerleri).ToList();

        var hedefler = (g.Hedefler ?? new())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(x => secenekler.FirstOrDefault(s =>
                string.Equals(s.Ad, x, StringComparison.OrdinalIgnoreCase)
                || string.Equals(s.Kod, x, StringComparison.OrdinalIgnoreCase)))
            .Where(x => x is not null)
            .Take(5)
            .ToList();

        if (hedefler.Count == 0) return BadRequest(new { hata = "En az bir hedef şube seçiniz." });

        var acikTalep = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_ROTASYON_TALEP WHERE personel_kodu = @kod AND durum IN (N'bolge', N'ik')",
            new { kod = hedef.PersonelKodu.Trim() });

        if (acikTalep > 0)
            return BadRequest(new { hata = "Bu personel için sonuçlanmamış bir rotasyon talebi var." });

        /* Yönetici isteğinde şubenin bölge müdürü onaylar (talebi açan bölge müdürüyse atlanır) */
        var bolgeMudurleri = new List<PersonelKaydi>();

        if (tur == YoneticiIstegi)
        {
            try
            {
                /* 23.10.2026: avans onay tablosundaki sırayla. Talebi açan
                   yönetici kendi adımını onaylamış sayılır; sıradaki kişi
                   adımı onaylar, sonra İK. Ör. kasiyer: mağaza müdürü açar
                   → bölge müdürü → İK. */
                var kademeler = _zincir.IzinKademeleri(hedef.PersonelKodu, hedef.Pozisyon, hedef.IsGrubu);
                var benim = kademeler.FindIndex(x => x.Kisiler.Any(p => K(p.PersonelKodu) == K(ben.PersonelKodu)));
                var kalan = kademeler.Skip(benim + 1).ToList();

                bolgeMudurleri = (kalan.FirstOrDefault().Kisiler ?? new())
                    .Where(x => K(x.PersonelKodu) != K(ben.PersonelKodu))
                    .ToList();
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "Rotasyon: bölge müdürü bulunamadı");
            }
        }

        var durum = bolgeMudurleri.Count > 0 ? Bolge : Ik;
        var bolgeKodlari = bolgeMudurleri.Count > 0
            ? "," + string.Join(",", bolgeMudurleri.Select(x => K(x.PersonelKodu))) + ","
            : null;

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_ROTASYON_TALEP
    (personel_kodu, ad_soyad, sube, pozisyon, tur, aciklama, hedefler, durum,
     talep_eden, talep_eden_ad, bolge_kodlari)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @sube, @poz, @tur, @aciklama, @hedefler, @durum, @talepEden, @talepEdenAd, @bolgeKodlari)",
            new
            {
                kod = hedef.PersonelKodu.Trim(),
                ad = AdSoyad(hedef),
                sube = (hedef.IsGrubu ?? "").Trim(),
                poz = hedef.Pozisyon,
                tur,
                aciklama,
                hedefler = JsonSerializer.Serialize(hedefler, Json),
                durum,
                talepEden = ben.PersonelKodu.Trim(),
                talepEdenAd = AdSoyad(ben),
                bolgeKodlari,
            });

        var hedefMetni = string.Join(", ", hedefler.Select(x => x.Ad));
        var ozet = $"{AdSoyad(hedef)} · {hedef.IsGrubu} → {hedefMetni}";

        try
        {
            /* Personel yalnızca görür: bilgilendirme */
            await _bildirim.Gonder(hedef.PersonelKodu, "Rotasyon talebi oluşturuldu",
                $"Yöneticiniz {AdSoyad(ben)} sizin için şube değişikliği talebi oluşturdu ({hedefMetni}). Süreci ana sayfadan izleyebilirsiniz.",
                "anasayfa");

            if (durum == Bolge)
                await _bildirim.TopluGonder(bolgeMudurleri.Select(x => x.PersonelKodu), "Rotasyon talebi onayınızı bekliyor",
                    $"{ozet} · {AdSoyad(ben)}", "izinonay|rotasyon");
            else
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Yeni rotasyon talebi", ozet, "izintalep");
        }
        catch
        {
            /* bildirim gitmese de talep listede */
        }

        return Ok(new
        {
            id,
            basarili = true,
            durum,
            mesaj = durum == Bolge
                ? $"Talep {string.Join(", ", bolgeMudurleri.Select(AdSoyad))} onayına gönderildi; ardından İnsan Kaynakları değerlendirecek."
                : "Talep İnsan Kaynakları'nın onayına gönderildi.",
        });
    }

    /// <summary>Talebi açan yönetici, sonuçlanmadan geri çekebilir.</summary>
    [HttpPost("Mobil/{id:int}/Iptal")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilIptal(int id)
    {
        var kod = Sicil();
        using var db = _vt.Baglanti();

        var t = db.QueryFirstOrDefault(Secim + " WHERE id = @id", new { id });
        if (t is null || K((string)t.talep_eden) != K(kod)) return NotFound(new { hata = "Talep bulunamadı." });

        var n = db.Execute(@"
UPDATE KRY_ROTASYON_TALEP SET durum = N'iptal', guncelleme = SYSDATETIME()
WHERE id = @id AND durum IN (N'bolge', N'ik')", new { id });

        if (n == 0) return BadRequest(new { hata = "Sonuçlanmış talep geri çekilemez." });

        await _bildirim.Gonder((string)t.personel_kodu, "Rotasyon talebi geri çekildi",
            $"Yöneticiniz şube değişikliği talebini geri çekti.", "anasayfa");

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Mobil: personel (yalnızca görür)                                       */
    /* ==================================================================== */

    /// <summary>Personelin kendisi hakkındaki talepler (sürmekte olanlar ve son 30 gün).</summary>
    [NonAction]
    public static List<object> Benim(System.Data.IDbConnection db, string kod)
    {
        try
        {
            return db.Query(Secim + @"
WHERE personel_kodu = @kod AND durum <> N'iptal'
  AND (durum IN (N'bolge', N'ik') OR ISNULL(ik_tarih, ISNULL(bolge_tarih, olusturma)) >= DATEADD(DAY, -30, SYSDATETIME()))
ORDER BY olusturma DESC", new { kod = (kod ?? "").Trim() })
                .Select(Disari).ToList();
        }
        catch
        {
            return new List<object>();
        }
    }

    [HttpGet("Mobil/Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilBenim()
    {
        using var db = _vt.Baglanti();
        return Ok(new { kayitlar = Benim(db, Sicil()) });
    }

    /* ==================================================================== */
    /* Mobil: bölge müdürü                                                   */
    /* ==================================================================== */

    [HttpGet("Mobil/Onaylar")]
    [Authorize(Roles = "Personel")]
    public IActionResult MobilOnaylar()
    {
        var kod = K(Sicil());
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(Secim + @"
WHERE durum = N'bolge' AND bolge_kodlari LIKE @desen
ORDER BY olusturma", new { desen = $"%,{kod},%" }).Select(Disari).ToList();

        return Ok(new { kayitlar });
    }

    public class KararGirdi
    {
        public bool Onay { get; set; }
        public string Not { get; set; }

        /// <summary>İK onayında: hedef şubelerden seçilen</summary>
        public string Sube { get; set; }
    }

    [HttpPost("Mobil/{id:int}/Karar")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> MobilKarar(int id, [FromBody] KararGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        using var db = _vt.Baglanti();
        var t = db.QueryFirstOrDefault(Secim + " WHERE id = @id", new { id });

        if (t is null) return NotFound(new { hata = "Talep bulunamadı." });
        if ((string)t.durum != Bolge || !((string)t.bolge_kodlari ?? "").Contains($",{K(ben.PersonelKodu)},"))
            return BadRequest(new { hata = "Bu talep sizin onayınızı beklemiyor." });

        return await BolgeKarari(db, t, g, $"{AdSoyad(ben)} (Biçen360)");
    }

    private async Task<IActionResult> BolgeKarari(System.Data.IDbConnection db, dynamic t, KararGirdi g, string kisi)
    {
        var not = (g?.Not ?? "").Trim();
        if (not.Length > 500) not = not[..500];
        var onay = g?.Onay == true;

        if (!onay && not.Length < 3) return BadRequest(new { hata = "Ret sebebini yazınız." });

        int id = t.id;

        var n = db.Execute(@"
UPDATE KRY_ROTASYON_TALEP
SET durum = @durum, bolge_kisi = @kisi, bolge_karar = @karar, bolge_not = @not, bolge_tarih = SYSDATETIME(),
    guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'bolge'",
            new { id, durum = onay ? Ik : Reddedildi, kisi, karar = onay ? "Onaylandı" : "Reddedildi", not = not.Length == 0 ? null : not });

        if (n == 0) return Conflict(new { hata = "Talep bu sırada değişti; listeyi yenileyiniz." });

        var ozet = $"{t.ad_soyad} · {t.sube}";

        try
        {
            if (onay)
                await _bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Rotasyon talebi İK onayında",
                    $"{ozet} · bölge müdürü onayladı", "izintalep");
            else
            {
                await _bildirim.Gonder((string)t.talep_eden, "Rotasyon talebi reddedildi",
                    $"{ozet}: bölge müdürü reddetti · {not}", "ekibim");
                await _bildirim.Gonder((string)t.personel_kodu, "Rotasyon talebi sonuçlandı",
                    "Şube değişikliği talebiniz bölge müdürü tarafından reddedildi.", "anasayfa");
            }
        }
        catch
        {
        }

        return Ok(new { basarili = true, durum = onay ? Ik : Reddedildi });
    }

    /* ==================================================================== */
    /* Panel                                                                */
    /* ==================================================================== */

    [HttpGet("Liste")]
    public IActionResult Liste([FromQuery] string uzman = null)
    {
        if (!IkYetkili && !PanelBolgeMuduru) return Forbid();

        using var db = _vt.Baglanti();

        var kapsam = PanelBolgeMuduru
            ? PanelKapsami(db)
            : UzmanKapsami.Olustur(db, _ayar, Rol, User?.Identity?.Name, uzman);

        var satirlar = db.Query(Secim + @"
ORDER BY CASE durum WHEN N'ik' THEN 0 WHEN N'bolge' THEN 1 WHEN N'onaylandi' THEN 2 ELSE 3 END, olusturma DESC")
            .Where(r => kapsam is null || kapsam.Icinde((string)r.sube))
            .Take(1000)
            .ToList();

        var temel = Roller.Temel(Rol);

        bool Sirada(dynamic r)
        {
            var d = (string)r.durum;
            return (IkYetkili && d == Ik)
                   || (temel is Roller.Admin or Roller.GenelMudurYardimcisi && d == Bolge)
                   || (PanelBolgeMuduru && d == Bolge);
        }

        var kayitlar = satirlar.Select(r => Disari(r, Sirada(r))).ToList();
        var bekleyen = satirlar.Count(r => Sirada(r));

        return Ok(new
        {
            kayitlar,
            bekleyen,
            kapsam = UzmanKapsami.Ozet(kapsam),
            ikYetkili = IkYetkili,
        });
    }

    [HttpGet("Sayac")]
    public IActionResult Sayac([FromQuery] string uzman = null)
    {
        if (!IkYetkili && !PanelBolgeMuduru) return Ok(new { bekleyen = 0 });

        using var db = _vt.Baglanti();

        var kapsam = PanelBolgeMuduru
            ? PanelKapsami(db)
            : UzmanKapsami.Olustur(db, _ayar, Rol, User?.Identity?.Name, uzman);

        var durumlar = IkYetkili
            ? (Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi ? new[] { Ik, Bolge } : new[] { Ik })
            : new[] { Bolge };

        try
        {
            var n = db.Query<string>("SELECT sube FROM KRY_ROTASYON_TALEP WHERE durum IN @durumlar", new { durumlar })
                .Count(x => kapsam is null || kapsam.Icinde(x));
            return Ok(new { bekleyen = n });
        }
        catch
        {
            return Ok(new { bekleyen = 0 });
        }
    }

    [HttpPost("{id:int}/Karar")]
    public async Task<IActionResult> Karar(int id, [FromBody] KararGirdi g)
    {
        if (!IkYetkili && !PanelBolgeMuduru) return Forbid();

        using var db = _vt.Baglanti();
        var t = db.QueryFirstOrDefault(Secim + " WHERE id = @id", new { id });
        if (t is null) return NotFound(new { hata = "Talep bulunamadı." });

        var durum = (string)t.durum;
        var temel = Roller.Temel(Rol);

        /* Bölge aşaması: panelde bölge müdürü (kendi şubeleri) ya da Admin/GMY */
        if (durum == Bolge)
        {
            if (PanelBolgeMuduru)
            {
                var k = PanelKapsami(db);
                if (k is not null && !k.Icinde((string)t.sube))
                    return StatusCode(403, new { hata = "Bu şube sizin bölgenizde değil." });
            }
            else if (temel is not (Roller.Admin or Roller.GenelMudurYardimcisi))
            {
                return BadRequest(new { hata = "Talep bölge müdürü onayında; İK kararı bölge müdürü onayından sonra verilir." });
            }

            return await BolgeKarari(db, t, g, PanelAdi);
        }

        if (durum != Ik) return BadRequest(new { hata = "Bu talep sonuçlanmış." });
        if (!IkYetkili) return StatusCode(403, new { hata = "Talep İK onayında." });

        var not = (g?.Not ?? "").Trim();
        if (not.Length > 500) not = not[..500];
        var onay = g?.Onay == true;

        if (!onay && not.Length < 3) return BadRequest(new { hata = "Ret sebebini yazınız." });

        string sube = null;

        if (onay)
        {
            var hedefler = HedefOku((string)t.hedefler);
            var istenen = (g.Sube ?? "").Trim();

            sube = hedefler.Count == 1 && istenen.Length == 0
                ? hedefler[0].Ad
                : hedefler.FirstOrDefault(x => string.Equals(x.Ad, istenen, StringComparison.OrdinalIgnoreCase))?.Ad;

            if (sube is null) return BadRequest(new { hata = "Personelin gideceği şubeyi seçiniz." });
        }

        var n = db.Execute(@"
UPDATE KRY_ROTASYON_TALEP
SET durum = @durum, ik_kisi = @kisi, ik_karar = @karar, ik_not = @not, ik_tarih = SYSDATETIME(),
    onaylanan_sube = @sube, guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'ik'",
            new { id, durum = onay ? Onaylandi : Reddedildi, kisi = PanelAdi, karar = onay ? "Onaylandı" : "Reddedildi", not = not.Length == 0 ? null : not, sube });

        if (n == 0) return Conflict(new { hata = "Talep bu sırada değişti; listeyi yenileyiniz." });

        try
        {
            var metin = onay
                ? $"{t.ad_soyad} için {sube} şubesine rotasyon onaylandı." + (not.Length > 0 ? $" {not}" : "")
                : $"{t.ad_soyad} için rotasyon talebi reddedildi: {not}";

            await _bildirim.Gonder((string)t.talep_eden, onay ? "Rotasyon onaylandı" : "Rotasyon reddedildi", metin, "ekibim");
            await _bildirim.Gonder((string)t.personel_kodu, onay ? "Şube değişikliğiniz onaylandı" : "Rotasyon talebi sonuçlandı",
                onay
                    ? $"{sube} şubesine geçişiniz onaylandı. Başlangıç tarihi için yöneticiniz ve İnsan Kaynakları sizinle görüşecek."
                    : "Şube değişikliği talebiniz İnsan Kaynakları tarafından reddedildi.",
                "anasayfa");
        }
        catch
        {
        }

        return Ok(new { basarili = true, durum = onay ? Onaylandi : Reddedildi });
    }

    public class MikroGirdi
    {
        public string Not { get; set; }
    }

    /// <summary>Şube değişikliği Mikro'ya işlendi (İK).</summary>
    [HttpPost("{id:int}/MikroIslendi")]
    public IActionResult MikroIslendi(int id, [FromBody] MikroGirdi g)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();
        var n = db.Execute(@"
UPDATE KRY_ROTASYON_TALEP SET mikro_islendi = SYSDATETIME(), mikro_not = @not, guncelleme = SYSDATETIME()
WHERE id = @id AND durum = N'onaylandi' AND mikro_islendi IS NULL",
            new { id, not = $"{PanelAdi}" + (string.IsNullOrWhiteSpace(g?.Not) ? "" : $" · {g.Not.Trim()}") });

        return n > 0 ? Ok(new { basarili = true }) : BadRequest(new { hata = "Yalnızca onaylanmış ve işlenmemiş talep işaretlenebilir." });
    }

    /// <summary>İK talebi iptal eder.</summary>
    [HttpPost("{id:int}/Iptal")]
    public IActionResult IkIptal(int id)
    {
        if (!IkYetkili) return Forbid();

        using var db = _vt.Baglanti();
        var n = db.Execute(@"
UPDATE KRY_ROTASYON_TALEP SET durum = N'iptal', ik_kisi = @kisi, ik_tarih = SYSDATETIME(), guncelleme = SYSDATETIME()
WHERE id = @id AND durum IN (N'bolge', N'ik')", new { id, kisi = PanelAdi });

        return n > 0 ? Ok(new { basarili = true }) : BadRequest(new { hata = "Sonuçlanmış talep iptal edilemez." });
    }

    /// <summary>
    /// Mikro'da şube değişikliği algılandığında (PersonelDegisimServisi):
    /// onaylanmış ve işlenmemiş talebin onaylanan şubesi yeni şubeyle
    /// eşleşiyorsa "Mikro'ya işlendi" olur.
    /// </summary>
    [NonAction]
    public static void MikroDegisikligi(System.Data.IDbConnection db, string kod, string yeniSube, string yapan)
    {
        try
        {
            var adaylar = db.Query(@"
SELECT id, onaylanan_sube FROM KRY_ROTASYON_TALEP
WHERE personel_kodu = @kod AND durum = N'onaylandi' AND mikro_islendi IS NULL",
                new { kod = (kod ?? "").Trim() }).ToList();

            foreach (var a in adaylar)
            {
                var s = (string)a.onaylanan_sube ?? "";
                if (!string.Equals(s.Trim(), (yeniSube ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
                    && !PersonelKaynagiServisi.Benziyor(s, yeniSube ?? ""))
                    continue;

                db.Execute(@"
UPDATE KRY_ROTASYON_TALEP SET mikro_islendi = SYSDATETIME(), mikro_not = @not, guncelleme = SYSDATETIME()
WHERE id = @id", new { id = (int)a.id, not = $"Mikro'da algılandı · {yapan}" });
            }
        }
        catch
        {
            /* tablo yoksa ya da eşleşme yoksa sessiz */
        }
    }
}

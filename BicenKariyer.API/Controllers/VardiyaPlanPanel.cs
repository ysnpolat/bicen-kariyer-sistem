using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İK panelinden vardiya planlaması ve personel kartındaki haftalık plan
/// (06.10.2026).
///
/// <para>
/// Önceden İK paneli planları yalnızca görüyordu; planı mağaza müdürü
/// mobilden kuruyordu. Artık İK da şube personeline gün gün vardiya,
/// haftalık izin ya da boş atayabiliyor, geçen haftayı uygulayıp planı
/// gönderebiliyor. Kurallar mobildekiyle aynı (AtaUygula, GonderUygula,
/// GecenHaftaUygula ortak): onaylı tam gün izinli gün kilitli, dinlenme
/// kuralı uyarı, haftada bir gün haftalık izin zorunlu, gönderilmiş plan
/// değişince "değişti". Yapılan değişiklik müdürün mobil ekranında da
/// görünüyor; kayıtlarda yapanın adının yanında "(İK)" yazıyor.
/// </para>
///
/// <para>
/// Personel kartı (Kisi) planın yanında QR okutma saatlerini de
/// gösteriyor: gün gün ilk ve son okutma, okuttu / okutmadı / izinli /
/// içeride durumu.
/// </para>
/// </summary>
public partial class VardiyaPlanController
{
    /// <summary>Panel kullanıcısının rolü (özel rolde rolün kendi kodu).</summary>
    private string PanelRol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>
    /// Panelden plan düzenleme: yönetici, GMY, İK yöneticisi ve İK.
    /// Bölge müdürü ve koordinatör yalnızca görüntüler.
    /// </summary>
    private bool PanelDuzenleyebilir =>
        Roller.Temel(PanelRol) is Roller.Admin or Roller.GenelMudurYardimcisi
            or Roller.IKYoneticisi or Roller.IK;

    /// <summary>Kayıtlarda yapan: "Ad Soyad (İK)". Sütun 100 karakter.</summary>
    private string PanelYapan
    {
        get
        {
            var ad = User?.FindFirst("adSoyad")?.Value;

            if (string.IsNullOrWhiteSpace(ad)) ad = User?.Identity?.Name ?? "İK";

            var yapan = $"{ad.Trim()} (İK)";

            return yapan.Length > 100 ? yapan[..100] : yapan;
        }
    }

    /// <summary>
    /// Bölge müdürü yalnızca kendi şubelerinin personelini görür
    /// (PersonelController ile aynı yol: hesaptaki şube kodu ayardaki
    /// tanımdan adına çevrilip normalleştirilerek karşılaştırılıyor).
    /// Diğer panel rolleri herkesi görür.
    /// </summary>
    private bool PanelGorebilir(PersonelKaydi kisi)
    {
        if (!Roller.SubeSiniri(PanelRol)) return true;

        var kodlar = (User?.FindFirst("subeler")?.Value ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToList();

        if (kodlar.Count == 0) return false;

        var tanimlar = _ayar.FormOku().Subeler ?? new List<Sube>();

        var adlar = kodlar
            .Select(k => tanimlar.FirstOrDefault(x =>
                    string.Equals(x.Kod, k, StringComparison.OrdinalIgnoreCase))?.Ad ?? k)
            .Select(PersonelKaynagiServisi.BirimAnahtari)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .ToList();

        var birimler = new[] { kisi.Sube, kisi.IsGrubu }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(PersonelKaynagiServisi.BirimAnahtari)
            .ToList();

        return adlar.Any(a => birimler.Any(b => PersonelKaynagiServisi.Benziyor(a, b)));
    }

    /// <summary>Şubenin aktif personeli (Panel ucundaki eşleştirmeyle aynı).</summary>
    private List<PersonelKaydi> SubePersoneli(string sube) =>
        string.IsNullOrWhiteSpace(sube)
            ? new List<PersonelKaydi>()
            : _ekip.Aktifler()
                .Where(x => PersonelKaynagiServisi.Benziyor(sube, x.IsGrubu ?? ""))
                .ToList();

    private ObjectResult Yetkisiz() =>
        StatusCode(403, new { hata = "Vardiya planını düzenleme yetkiniz yok." });

    /* ==================================================================== */
    /* İK paneli — planlama                                                 */
    /* ==================================================================== */

    /// <summary>
    /// İK bir güne vardiya, haftalık izin ya da boş atar. Mobildeki Ata ile
    /// aynı kurallar; yanıtta kişinin güncel haftası da dönüyor ki panel
    /// yalnızca o satırı yenilesin.
    /// </summary>
    [HttpPost("PanelAta")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
    public IActionResult PanelAta([FromBody] AtaGirdi g)
    {
        if (!PanelDuzenleyebilir) return Yetkisiz();
        if (g is null || g.Gun == default) return BadRequest(new { hata = "Gün seçiniz." });

        var hedef = _ekip.Kisi(g.Sicil);

        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı ya da aktif değil." });

        using var db = _vt.Baglanti();

        var sonuc = AtaUygula(db, hedef, g, PanelYapan, "İK gönderilmiş planı değiştirdi");

        if (sonuc.Hata is not null) return BadRequest(sonuc.Hata);

        return Ok(new
        {
            basarili = true,
            uyarilar = sonuc.Uyarilar,
            durum = sonuc.Durum,
            kisi = HaftaOku(db, hedef, HaftaBasi(g.Gun), Sablonlar(db)),
        });
    }

    public class PanelSubeGirdi
    {
        public DateTime Hafta { get; set; }
        public string Sube { get; set; }

        /// <summary>Boşsa şubedeki herkes.</summary>
        public List<string> Siciller { get; set; }
    }

    /// <summary>
    /// Şubenin taslak ve değişmiş planlarını personele gönderir. Haftalık
    /// izin verilmemiş personel atlanıyor ve yanıtta listeleniyor.
    /// </summary>
    [HttpPost("PanelGonder")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
    public async Task<IActionResult> PanelGonder([FromBody] PanelSubeGirdi g)
    {
        if (!PanelDuzenleyebilir) return Yetkisiz();
        if (string.IsNullOrWhiteSpace(g?.Sube)) return BadRequest(new { hata = "Şube seçiniz." });

        var hafta = HaftaBasi(g.Hafta == default ? DateTime.Today : g.Hafta);
        var kisiler = SubePersoneli(g.Sube);

        using var db = _vt.Baglanti();

        var (gonderilen, eksikIzin) = await GonderUygula(db, kisiler, hafta, g.Siciller, PanelYapan,
            "İnsan Kaynakları");

        if (eksikIzin.Count > 0 && gonderilen == 0)
            return BadRequest(new
            {
                hata = "Haftalık izin günü verilmemiş.",
                ayrinti = "Haftada 1 gün izin zorunlu. İzin günü verilmeyen personel: "
                        + string.Join(", ", eksikIzin),
            });

        return Ok(new { basarili = true, gonderilen, eksikIzin });
    }

    /// <summary>Geçen haftanın planını şubenin bu haftasına kopyalar.</summary>
    [HttpPost("PanelGecenHafta")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
    public IActionResult PanelGecenHafta([FromBody] PanelSubeGirdi g)
    {
        if (!PanelDuzenleyebilir) return Yetkisiz();
        if (string.IsNullOrWhiteSpace(g?.Sube)) return BadRequest(new { hata = "Şube seçiniz." });

        var hafta = HaftaBasi(g.Hafta == default ? DateTime.Today : g.Hafta);

        using var db = _vt.Baglanti();

        var (kisi, gun, uyarilar) = GecenHaftaUygula(db, SubePersoneli(g.Sube), hafta, g.Siciller, PanelYapan);

        return Ok(new { basarili = true, kisi, gun, uyarilar = uyarilar.Take(15).ToList() });
    }

    /* ==================================================================== */
    /* İK paneli — personel kartı                                           */
    /* ==================================================================== */

    /// <summary>
    /// Bir personelin haftası: plan, durum ve gün gün QR okutma saatleri.
    ///
    /// <para>
    /// Gün durumu: okuttu · iceride (bugün girmiş, çıkmamış) · okutmadi
    /// (geçmiş çalışma günü, okutma yok) · izinli (haftalık ya da sistemdeki
    /// tam gün izin) · plan (bugün ve sonrası) · bos (geçmiş, plansız).
    /// </para>
    /// </summary>
    [HttpGet("Kisi")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK + ","
                       + Roller.BolgeKoordinatoru + "," + Roller.GenelMudurYardimcisi + "," + Roller.BolgeMuduru)]
    public IActionResult Kisi([FromQuery] string sicil, [FromQuery] DateTime? hafta)
    {
        if (string.IsNullOrWhiteSpace(sicil)) return BadRequest(new { hata = "Sicil giriniz." });

        /* Ayrılmış personelin kartı da açılabiliyor: aktiflerde yoksa
           bütün kayıtlarda aranıyor. */
        var kisi = _ekip.Kisi(sicil)
                   ?? _kaynak.TumPersonelleriGetir()
                       .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
                       .FirstOrDefault(x => K(x.PersonelKodu) == K(sicil));

        if (kisi is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!PanelGorebilir(kisi))
            return StatusCode(403, new { hata = "Bu personelin planını görme yetkiniz yok." });

        var h = HaftaBasi(hafta ?? DateTime.Today);
        var kod = kisi.PersonelKodu.Trim();
        var bugun = DateTime.Today;

        using var db = _vt.Baglanti();

        dynamic plan = HaftaOku(db, kisi, h, Sablonlar(db));

        /* Gün gün ilk / son okutma ve son okutmanın türü (içeride mi) */
        var okutmalar = db.Query(@"
SELECT personel_kodu AS kod, tur, gecis_zamani AS zaman FROM KRY_VARDIYA
WHERE personel_kodu = @kod AND gecis_zamani >= @bas AND gecis_zamani < @son
ORDER BY gecis_zamani",
                new { kod, bas = h, son = h.AddDays(7) })
            .Select(x => (tur: ((string)x.tur ?? "").Trim().ToLowerInvariant(), zaman: (DateTime)x.zaman))
            .GroupBy(x => x.zaman.Date)
            .ToDictionary(x => x.Key, x => x.ToList());

        var gunler = new List<object>();
        int calisma = 0, haftalikIzin = 0, izinli = 0, okuttu = 0, okutmadi = 0;

        foreach (var d in (IEnumerable<dynamic>)plan.gunler)
        {
            var tarih = (DateTime)d.tarih;
            var tur = (string)d.tur;

            okutmalar.TryGetValue(tarih.Date, out var o);

            DateTime? ilk = o is { Count: > 0 } ? o[0].zaman : null;
            DateTime? son = o is { Count: > 1 } ? o[^1].zaman : null;
            var iceride = tarih.Date == bugun && o is { Count: > 0 } && o[^1].tur == "giris";

            var calisir = tur == "vardiya";
            var izinGunu = tur is "izin" or "yillik";

            string gunDurum;

            if (o is { Count: > 0 }) gunDurum = iceride ? "iceride" : "okuttu";
            else if (izinGunu) gunDurum = "izinli";
            else if (tarih.Date >= bugun) gunDurum = calisir ? "plan" : "bos";
            else gunDurum = calisir ? "okutmadi" : "bos";

            if (calisir) calisma++;
            if (tur == "izin") haftalikIzin++;
            if (tur == "yillik") izinli++;
            if (gunDurum is "okuttu" or "iceride") okuttu++;
            if (gunDurum == "okutmadi") okutmadi++;

            gunler.Add(new
            {
                tarih,
                gunAdi = GunAdi(tarih),
                bugun = tarih.Date == bugun,
                tur,
                sablonId = (int?)d.sablonId,
                ad = (string)d.ad,
                tip = (string)d.tip,
                renk = (string)d.renk,
                izinTuru = (string)d.izinTuru,
                izinKisa = (string)d.izinKisa,
                izinAyrinti = (string)d.izinAyrinti,
                izinBekliyor = (bool)d.izinBekliyor,
                kismiIzin = (bool)d.kismiIzin,
                celiski = (bool)d.celiski,
                ilkOkutma = ilk,
                sonOkutma = son,
                okutmaSayisi = o?.Count ?? 0,
                gunDurum,
            });
        }

        return Ok(new
        {
            hafta = h,
            sicil = kisi.PersonelKodu,
            adSoyad = (string)plan.adSoyad,
            sube = kisi.IsGrubu,
            pozisyon = kisi.Pozisyon,
            durum = (string)plan.durum,
            surum = (int)plan.surum,
            gonderen = (string)plan.gonderen,
            gonderme = (DateTime?)plan.gonderme,
            haftalikIzinVar = (bool)plan.haftalikIzinVar,
            uyarilar = plan.uyarilar,
            izinNotlari = plan.izinNotlari,
            ozet = new { calisma, haftalikIzin, izinli, okuttu, okutmadi },
            gunler,
        });
    }
}

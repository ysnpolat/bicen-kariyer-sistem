using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetim → İzin Kuralları (03.10.2026).
///
/// <para>
/// İki kural buradan açılıp kapatılıyor:
/// cumartesi kuralı (pazartesi–çarşamba başlayan izinde cumartesi izinden
/// düşülür) ve mobil izin talebinde vardiya planı denetimi (plan tanımlı
/// değilse talep açılmaz). Ayar KRY_AYARLAR'da <c>IZIN_KURAL</c>
/// anahtarında; form ayarlarından ayrı tutuldu ki iki ekran birbirinin
/// alanını ezmesin.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class IzinKurallariController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinGunuServisi _izinGunu;
    private readonly EkipServisi _ekip;

    public IzinKurallariController(VeritabaniServisi vt, IzinGunuServisi izinGunu, EkipServisi ekip)
    {
        _vt = vt;
        _izinGunu = izinGunu;
        _ekip = ekip;
    }

    [HttpGet]
    public IActionResult Oku()
    {
        var ayar = _izinGunu.KuralOku();

        List<string> turler;

        using (var db = _vt.Baglanti())
        {
            try
            {
                turler = db.Query<string>("SELECT ad FROM KRY_IZIN_TURU WHERE aktif = 1 ORDER BY sira, ad").ToList();
            }
            catch
            {
                turler = new List<string>();
            }
        }

        if (turler.Count == 0) turler.Add("Yıllık İzin");

        var birimler = _ekip.Aktifler()
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => new { ad = g.Key, kisi = g.Count() })
            .OrderBy(x => x.ad)
            .ToList();

        /* Cumartesisi izinli personel seçimi için aktif personel */
        var personeller = _ekip.Aktifler()
            .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .Select(x => new
            {
                sicil = x.PersonelKodu.Trim(),
                ad = $"{x.Ad} {x.Soyad}".Trim(),
                birim = x.IsGrubu,
                pozisyon = x.Pozisyon,
            })
            .OrderBy(x => x.ad)
            .ToList();

        return Ok(new { ayar, turler, birimler, personeller });
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] IzinKuralAyari girdi)
    {
        if (girdi is null) return BadRequest(new { hata = "Ayar okunamadı." });

        girdi.Cumartesi ??= new CumartesiKurali();
        girdi.Vardiya ??= new VardiyaKontrolKurali();

        girdi.Cumartesi.TetikGunleri = (girdi.Cumartesi.TetikGunleri ?? new List<int>())
            .Where(x => x is >= 1 and <= 5)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        if (girdi.Cumartesi.Acik && girdi.Cumartesi.TetikGunleri.Count == 0)
            return BadRequest(new { hata = "Cumartesi kuralı için en az bir başlangıç günü seçiniz." });

        if (girdi.Vardiya.Kapsam is not ("hepsi" or "planKullanan" or "secili"))
            girdi.Vardiya.Kapsam = "hepsi";

        girdi.Vardiya.Turler = Temizle(girdi.Vardiya.Turler);
        girdi.Vardiya.Birimler = Temizle(girdi.Vardiya.Birimler);
        girdi.Vardiya.MuafBirimler = Temizle(girdi.Vardiya.MuafBirimler);
        girdi.Vardiya.FiyatKontrolMuaf = Temizle(girdi.Vardiya.FiyatKontrolMuaf);
        girdi.CumartesiIzinliler = Temizle(girdi.CumartesiIzinliler);

        if (girdi.Vardiya.Turler.Count == 0) girdi.Vardiya.Turler.Add("Yıllık İzin");

        if (girdi.Vardiya.Acik && girdi.Vardiya.Kapsam == "secili" && girdi.Vardiya.Birimler.Count == 0)
            return BadRequest(new { hata = "Seçili birimlerde denetim için en az bir birim seçiniz." });

        _izinGunu.KuralYaz(girdi);

        return Ok(new { basarili = true, ayar = girdi });
    }

    private static List<string> Temizle(List<string> l) =>
        (l ?? new List<string>())
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>
    /// Kuralı bir personel ve tarih aralığında dener: gün sayısı, notlar ve
    /// vardiya planı denetiminin sonucu. Ayar ekranında "bu kural şu kişiye
    /// ne yapar" sorusu için.
    /// </summary>
    [HttpGet("Dene")]
    public IActionResult Dene([FromQuery] string sicil, [FromQuery] DateTime ilk, [FromQuery] DateTime son,
        [FromQuery] string tur = "Yıllık İzin")
    {
        var kisi = _ekip.Kisi(sicil);

        if (kisi is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (son < ilk) return BadRequest(new { hata = "Son gün ilk günden önce olamaz." });

        if ((son - ilk).TotalDays > 120) return BadRequest(new { hata = "En fazla 120 gün denenebilir." });

        var s = _izinGunu.Hesapla(kisi.Pozisyon, ilk.Date, son.Date.AddDays(1), kisi.PersonelKodu);

        var birim = (kisi.IsGrubu ?? "").Trim();
        var birimSicilleri = _ekip.Aktifler()
            .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), birim, StringComparison.OrdinalIgnoreCase))
            .Select(x => x.PersonelKodu.Trim());

        var v = _izinGunu.VardiyaDenetle(kisi, tur, ilk.Date, son.Date, birimSicilleri);

        return Ok(new
        {
            adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
            pozisyon = kisi.Pozisyon,
            birim = kisi.IsGrubu,
            gun = s.Gun,
            takvimGunu = s.TakvimGunu,
            dusulmeyenler = s.Dusulmeyenler,
            cumartesiDusen = s.CumartesiDusen,
            cumartesiIzinli = _izinGunu.KuralOku().CumartesiIzinliMi(kisi.PersonelKodu),
            notlar = s.Notlar,
            vardiya = new { engel = v.Engel, mesaj = v.Hata, ayrinti = v.Ayrinti, eksikGunler = v.EksikGunler },
        });
    }
}

using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Manuel vardiya giriş-çıkışı: yönetici onayı.
///
/// <para>
/// Personel karekodu okutamadığında (uygulama sorunu) ya da okutmayı
/// unuttuğunda Vardiya ekranından manuel giriş ya da çıkış talebi açıyor
/// (<c>Mobil/Itiraz</c>, tablo <c>KRY_VARDIYA_ITIRAZ</c>). Talep doğrudan
/// kayda işlenmiyor; personelin yöneticisine düşüyor. Yönetici saati
/// kontrol edip gerekirse düzelterek onaylıyor; kayıt o saatle
/// <c>KRY_VARDIYA</c>'ya yazılıyor.
/// </para>
///
/// <para>
/// Yönetici kim: vardiya planındakiyle aynı kapsam
/// (<see cref="EkipServisi.SorumluOlduklari"/>). İK paneli de aynı
/// talepleri görüp sonuçlandırabiliyor (<c>Mobil/Itirazlar</c>).
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Personel")]
public class VardiyaDuzeltmeController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<VardiyaDuzeltmeController> _kayit;

    public VardiyaDuzeltmeController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim,
        ILogger<VardiyaDuzeltmeController> kayit)
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

    /// <summary>Yöneticinin onayını bekleyen manuel giriş-çıkış talepleri.</summary>
    [HttpGet("Bekleyenler")]
    public IActionResult Bekleyenler()
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var ekip = _ekip.SorumluOlduklari(ben);

        if (ekip.Count == 0) return Ok(new { kayitlar = new List<object>() });

        var kodlar = ekip.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       tarih, tur, saat, sebep, olusturma
FROM KRY_VARDIYA_ITIRAZ
WHERE durum = N'Bekliyor' AND iptal = 0
ORDER BY olusturma")
            .Where(x => kodlar.Contains(K((string)x.personelKodu)))
            .Select(x =>
            {
                var kod = (string)x.personelKodu;
                var kisi = ekip.FirstOrDefault(e => K(e.PersonelKodu) == K(kod));
                var tarih = (DateTime)x.tarih;

                /* O günün mevcut okutmaları: yönetici saati bunlara bakarak
                   doğruluyor. */
                var okutmalar = db.Query(@"
SELECT tur, gecis_zamani AS zaman FROM KRY_VARDIYA
WHERE personel_kodu = @kod AND CAST(gecis_zamani AS DATE) = @tarih
ORDER BY gecis_zamani", new { kod, tarih = tarih.Date })
                    .Select(o => new { tur = (string)o.tur, saat = ((DateTime)o.zaman).ToString("HH:mm") })
                    .ToList();

                return new
                {
                    id = (int)x.id,
                    personelKodu = kod,
                    adSoyad = (string)x.adSoyad,
                    pozisyon = kisi?.Pozisyon,
                    subeAdi = (string)x.subeAdi,
                    tarih,
                    tur = (string)x.tur,
                    saat = (string)x.saat,
                    sebep = (string)x.sebep,
                    olusturma = (DateTime)x.olusturma,
                    okutmalar,
                };
            })
            .ToList();

        return Ok(new { kayitlar });
    }

    public class KararGirdi
    {
        public int Id { get; set; }
        public bool Onay { get; set; }

        /// <summary>Onaylanan saat, "08:30" biçiminde. Boşsa personelin yazdığı saat.</summary>
        public string Saat { get; set; }

        public string Not { get; set; }
    }

    /// <summary>
    /// Yönetici talebi onaylar (saati yazarak) ya da reddeder.
    ///
    /// Onaylanan saat personelin yazdığından farklı olabilir: yönetici
    /// gerçek giriş-çıkış saatini biliyor, kayıt onun yazdığı saatle
    /// düşüyor.
    /// </summary>
    [HttpPost("Karar")]
    public async Task<IActionResult> Karar([FromBody] KararGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        using var db = _vt.Baglanti();

        var itiraz = db.QueryFirstOrDefault(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, sube_adi AS subeAdi, tarih, tur, saat, durum
FROM KRY_VARDIYA_ITIRAZ WHERE id = @id AND iptal = 0", new { id = g?.Id ?? 0 });

        if (itiraz is null) return NotFound(new { hata = "Talep bulunamadı." });

        if ((string)itiraz.durum != "Bekliyor")
            return BadRequest(new { hata = "Bu talep zaten sonuçlanmış." });

        var kod = ((string)itiraz.kod).Trim();

        if (!_ekip.SorumluOlduklari(ben).Any(x => K(x.PersonelKodu) == K(kod)))
            return StatusCode(403, new { hata = "Bu personelin talebini onaylama yetkiniz yok." });

        var yapan = $"{ben.Ad} {ben.Soyad}".Trim();
        var not = (g.Not ?? "").Trim();
        var tarih = ((DateTime)itiraz.tarih).Date;
        var tur = (string)itiraz.tur;

        if (!g.Onay)
        {
            if (not.Length < 3)
                return BadRequest(new { hata = "Reddetme sebebini yazınız; personel bunu görür." });

            var reddedilen = db.Execute(@"
UPDATE KRY_VARDIYA_ITIRAZ
SET durum = N'Reddedildi', karar_veren = @yapan, karar_notu = @not, karar_tarihi = SYSDATETIME()
WHERE id = @id AND durum = N'Bekliyor'", new { id = (int)itiraz.id, yapan, not = Kirp(not, 500) });

            if (reddedilen == 0)
                return BadRequest(new { hata = "Bu talep az önce başka biri tarafından sonuçlandırıldı." });

            await Bildir(kod, "Manuel giriş-çıkış talebiniz reddedildi",
                $"{tarih:dd.MM} {tur} {itiraz.saat} talebiniz onaylanmadı. {not}");

            return Ok(new { basarili = true });
        }

        var saatMetni = string.IsNullOrWhiteSpace(g.Saat) ? (string)itiraz.saat : g.Saat.Trim();

        if (!MobilController.SaatGecerli(saatMetni, out var saat))
            return BadRequest(new { hata = "Saati 08:30 biçiminde giriniz." });

        var zaman = tarih.Add(saat);

        if (zaman > DateTime.Now)
            return BadRequest(new { hata = "Gelecek bir saat yazılamaz." });

        var duzeltildi = !string.Equals(zaman.ToString("HH:mm"), (string)itiraz.saat, StringComparison.Ordinal);

        /* Önce talep kapanıyor; İK aynı anda panelden onaylarsa yalnızca
           biri geçiyor ve kayıt iki kez yazılmıyor. */
        var onaylanan = db.Execute(@"
UPDATE KRY_VARDIYA_ITIRAZ
SET durum = N'Onaylandı', saat = @saat, karar_veren = @yapan, karar_notu = @not,
    karar_tarihi = SYSDATETIME()
WHERE id = @id AND durum = N'Bekliyor'",
            new
            {
                id = (int)itiraz.id,
                saat = zaman.ToString("HH:mm"),
                yapan,
                not = Kirp(duzeltildi
                    ? $"Saat {itiraz.saat} → {zaman:HH:mm} olarak düzeltildi." + (not.Length > 0 ? " " + not : "")
                    : (not.Length > 0 ? not : null), 500),
            });

        if (onaylanan == 0)
            return BadRequest(new { hata = "Bu talep az önce başka biri tarafından sonuçlandırıldı." });

        /* Aynı gün aynı türde aynı dakikaya ikinci kayıt yazılmıyor:
           yönetici iki kez onaylasa da kayıt tek kalıyor. */
        var varMi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_VARDIYA
WHERE personel_kodu = @kod AND tur = @tur
  AND gecis_zamani >= @bas AND gecis_zamani < @son",
            new { kod, tur, bas = zaman, son = zaman.AddMinutes(1) });

        if (varMi == 0)
            VardiyaKayitYazici.ElleEkle(db, kod, (string)itiraz.adSoyad, (string)itiraz.subeAdi, tur, zaman);

        _kayit.LogInformation("Manuel vardiya onaylandı: {Kod} {Tarih} {Tur} {Saat} ({Yapan})",
            kod, tarih, tur, zaman.ToString("HH:mm"), yapan);

        await Bildir(kod, "Manuel giriş-çıkış onaylandı",
            $"{tarih:dd.MM} {tur} kaydınız {zaman:HH:mm} olarak işlendi"
            + (duzeltildi ? $" (yazdığınız saat {itiraz.saat} idi, yöneticiniz düzeltti)." : "."));

        return Ok(new { basarili = true, saat = zaman.ToString("HH:mm") });
    }

    private static string Kirp(string s, int n) => s is null ? null : s.Length > n ? s[..n] : s;

    private async Task Bildir(string kod, string baslik, string metin)
    {
        try
        {
            await _bildirim.Gonder(kod, baslik, metin, "vardiya");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Manuel vardiya bildirimi gönderilemedi");
        }
    }
}

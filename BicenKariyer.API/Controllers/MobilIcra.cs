using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İcralarım (30.10.2026) — personelin Biçen360'ta KENDİ icra / nafaka
/// dosyalarını görmesi: sıra, alacaklı, toplam / kalan borç, bu ayki
/// kesinti ve geçmiş kesintiler.
/// <para>
/// Güvenlik: sicil yalnız jetondan okunur (PersonelKodu); istemciden gelen
/// sicil parametresi yoktur ve kabul edilmez. Başka personelin verisi hiçbir
/// koşulda dönmez. Net maaş, icra dairesi hesap bilgisi ve İK notları
/// personele gösterilmez; yalnız kendi kesinti tutarları döner.
/// </para>
/// </summary>
public partial class MobilController
{
    /// <summary>Modül listesi için: kişinin herhangi bir icra dosyası var mı (kapananlar dahil).</summary>
    private bool IcraVar(string sicil)
    {
        try
        {
            using var db = _vt.Baglanti();
            return db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_ICRA_DOSYA WHERE sicil = @s", new { s = IcraServisi.K(sicil) }) > 0;
        }
        catch { return false; }
    }

    [HttpGet("Icralarim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Icralarim()
    {
        var p = Kendisi();
        if (p is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        /* Sicil yalnız jetondan; parametre yok */
        var sicil = IcraServisi.K(p.PersonelKodu);
        if (sicil.Length == 0) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var icra = HttpContext.RequestServices.GetRequiredService<IcraServisi>();
        using var db = _vt.Baglanti();

        var dosyalar = icra.Dosyalar(db, sicil);
        var bugun = DateTime.Today;
        var donem = IcraServisi.DonemYaz(bugun.Year, bugun.Month);

        /* Bu ay: kaydedilmişse kayıt, değilse hesap (yalnız tutarlar) */
        var kayitli = db.Query("SELECT dosya_id, tur, tutar, odendi FROM KRY_ICRA_KESINTI WHERE sicil = @sicil AND donem = @donem", new { sicil, donem }).ToList();
        decimal nafaka, icraTutar;
        bool kesin;
        IcraServisi.Hesap h = null;
        if (kayitli.Count > 0)
        {
            nafaka = kayitli.Where(x => (string)x.tur == "nafaka").Sum(x => (decimal)x.tutar);
            icraTutar = kayitli.Where(x => (string)x.tur == "icra").Sum(x => (decimal)x.tutar);
            kesin = true;
        }
        else
        {
            h = icra.Hesapla(db, sicil, donem, dosyalar.Where(d => d.Durum == "acik").ToList());
            nafaka = h.Nafaka;
            icraTutar = h.Icra;
            kesin = false;
        }

        var gecmis = db.Query(@"
SELECT TOP 36 k.donem, k.tur, k.tutar, k.odendi, k.odeme_tarihi, d.dosya_no, d.alacakli
FROM KRY_ICRA_KESINTI k JOIN KRY_ICRA_DOSYA d ON d.id = k.dosya_id
WHERE k.sicil = @sicil ORDER BY k.donem DESC, k.id DESC", new { sicil })
            .Select(k => new
            {
                donem = (string)k.donem, donemAdi = IcraServisi.DonemAdi((string)k.donem), tur = (string)k.tur,
                turAdi = IcraServisi.Turler.GetValueOrDefault((string)k.tur, (string)k.tur), tutar = (decimal)k.tutar,
                odendi = (bool)k.odendi, odemeTarihi = (DateTime?)k.odeme_tarihi, dosyaNo = (string)k.dosya_no, alacakli = (string)k.alacakli,
            }).ToList();

        return Ok(new
        {
            donem, donemAdi = IcraServisi.DonemAdi(donem), oranYuzde = (int)Math.Round(IcraServisi.Oran() * 100),
            buAy = new { nafaka, icra = icraTutar, toplam = nafaka + icraTutar, kesin },
            dosyalar = dosyalar.Select(d => new
            {
                id = d.Id, dosyaNo = d.DosyaNo, tur = d.Tur, turAdi = IcraServisi.Turler.GetValueOrDefault(d.Tur, d.Tur),
                icraDairesi = d.IcraDairesi, esasNo = d.EsasNo, alacakli = d.Alacakli,
                tebligTarihi = d.TebligTarihi, toplamBorc = d.ToplamBorc, odenen = d.Odenen, kesilen = d.Kesilen, kalan = d.Kalan,
                aylikTutar = d.AylikTutar, durum = d.Durum, durumAdi = IcraServisi.Durumlar.GetValueOrDefault(d.Durum, d.Durum), sira = d.Sira,
                buAy = kayitli.Count > 0
                    ? kayitli.Where(x => (int)x.dosya_id == d.Id).Sum(x => (decimal)x.tutar)
                    : h?.Satirlar.Where(x => x.DosyaId == d.Id).Sum(x => x.Tutar),
            }).ToList(),
            gecmis,
            aciklama = "Kesinti sırası tebligatın geliş sırasına göredir; nafaka önceliklidir. Sorularınız için İnsan Kaynakları'na başvurabilirsiniz.",
        });
    }
}

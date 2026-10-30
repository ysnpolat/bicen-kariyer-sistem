using BicenKariyer.API.Servisler;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Sirkülasyon › Turnover (30.10.2026).
///
/// <para>
/// İK'nın elle tuttuğu "TURNOVER RAPORU" Excel'inin panel karşılığı: seçilen
/// yıl ve bir önceki yıl için aylık şube sayısı, dönem başı / dönem sonu
/// çalışan, giriş, çıkış, ortalama ve oranlar. Kaynak Sirkülasyon
/// sekmesiyle aynı: Mikro personel kayıtları (giriş / çıkış tarihi), bölge
/// seçimi uygulanır.
/// </para>
///
/// <list type="bullet">
/// <item><b>Dönem başı</b>: ayın 1'inde çalışan (girişi o günden önce ya da o
/// gün, çıkışı yok ya da o günden sonra).</item>
/// <item><b>Dönem sonu</b>: sonraki ayın 1'indeki sayı; böylece bir ayın sonu
/// ile sonraki ayın başı her zaman aynı.</item>
/// <item><b>Ortalama</b> = (dönem başı + dönem sonu) / 2.</item>
/// <item><b>Aylık oran</b> = çıkış / ortalama.</item>
/// <item><b>Yıllık oran</b> = aylık oran × 12 (Excel'deki "Oran %" satırı;
/// %100 = bir yılda kadronun tamamı kadar çıkış).</item>
/// <item><b>Şube sayısı</b>: ay sonunda en az bir aktif personeli olan mağaza
/// iş grubu (genel merkez ve depo hariç, izin formu kuralıyla).</item>
/// </list>
/// </summary>
public partial class PersonelController
{
    [HttpGet("Turnover")]
    public IActionResult Turnover(
        [FromQuery] int? yil,
        [FromQuery] string kapsam = "tumu",
        [FromServices] IzinFormuServisi izinFormu = null)
    {
        var buYil = yil ?? DateTime.Today.Year;
        var yalnizMagaza = string.Equals(kapsam, "magaza", StringComparison.OrdinalIgnoreCase);

        List<PersonelKaydi> tumu;
        try
        {
            tumu = BolgeyeGoreSuz(PersonelleriGetir());
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Turnover verisi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı.", ayrinti = HataAyrintisi(hata) });
        }

        /* Mağaza / merkez ayrımı iş grubu başına bir kez */
        var form = izinFormu?.FormAyari();
        var magazaOnbellek = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        bool MagazaMi(PersonelKaydi p)
        {
            var anahtar = $"{p.IsGrubu}|{p.Sube}";
            if (magazaOnbellek.TryGetValue(anahtar, out var v)) return v;
            try { v = izinFormu is null || izinFormu.FormHedefi(p, form) == "sube"; }
            catch { v = true; }
            magazaOnbellek[anahtar] = v;
            return v;
        }

        var kisiler = tumu.Where(p => p.GirisTarihi is not null).ToList();
        if (yalnizMagaza) kisiler = kisiler.Where(MagazaMi).ToList();

        bool Calisiyor(PersonelKaydi k, DateTime t) =>
            k.GirisTarihi!.Value.Date <= t && (k.CikisTarihi is null || k.CikisTarihi.Value.Date > t);

        var bugun = DateTime.Today;

        object Yil(int y)
        {
            var aylar = new List<object>();
            var yillikOranlar = new List<double>();

            for (var ay = 1; ay <= 12; ay++)
            {
                var bas = new DateTime(y, ay, 1);
                var sonrakiBas = bas.AddMonths(1);

                /* Henüz başlamamış ay boş döner */
                if (bas > bugun)
                {
                    aylar.Add(new { ay, bos = true });
                    continue;
                }

                var devam = sonrakiBas > bugun;
                var sonTarih = devam ? bugun : sonrakiBas;

                var donemBasi = kisiler.Count(k => Calisiyor(k, bas));
                var donemSonu = devam
                    ? kisiler.Count(k => Calisiyor(k, bugun))
                    : kisiler.Count(k => Calisiyor(k, sonrakiBas));

                var giris = kisiler.Count(k => k.GirisTarihi!.Value.Date >= bas && k.GirisTarihi.Value.Date < sonrakiBas);
                var cikis = kisiler.Count(k => k.CikisTarihi is not null
                                               && k.CikisTarihi.Value.Date >= bas && k.CikisTarihi.Value.Date < sonrakiBas);

                var ortalama = (donemBasi + donemSonu) / 2.0;
                var oran = ortalama > 0 ? cikis * 100.0 / ortalama : 0;
                var yillik = oran * 12;

                var subeSayisi = tumu
                    .Where(k => k.GirisTarihi is not null && Calisiyor(k, devam ? bugun : sonrakiBas.AddDays(-1)))
                    .Where(MagazaMi)
                    .Select(k => (k.IsGrubu ?? "").Trim())
                    .Where(x => x.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count();

                if (!devam) yillikOranlar.Add(yillik);

                aylar.Add(new
                {
                    ay,
                    bos = false,
                    devam,
                    subeSayisi,
                    donemBasi,
                    donemSonu,
                    giris,
                    cikis,
                    ortalama = Math.Round(ortalama, 1),
                    oran = Math.Round(oran, 2),
                    yillikOran = Math.Round(yillik, 1)
                });
            }

            /* Yıl içinde çıkanlar: sebep, birim ve çalışma süresi dağılımı (pasta grafikler) */
            var yilBas = new DateTime(y, 1, 1);
            var yilSon = yilBas.AddYears(1);
            var cikanlar = kisiler.Where(k => k.CikisTarihi is not null
                                              && k.CikisTarihi.Value.Date >= yilBas && k.CikisTarihi.Value.Date < yilSon).ToList();

            static List<object> Dagilim(IEnumerable<string> l, int enFazla)
            {
                var g = l.GroupBy(x => string.IsNullOrWhiteSpace(x) ? "Belirtilmemiş" : x.Trim())
                    .Select(x => (ad: x.Key, adet: x.Count()))
                    .OrderByDescending(x => x.adet)
                    .ToList();
                var ust = g.Take(enFazla).Select(x => (object)new { ad = x.ad, adet = x.adet }).ToList();
                var kalan = g.Skip(enFazla).Sum(x => x.adet);
                if (kalan > 0) ust.Add(new { ad = "Diğer", adet = kalan });
                return ust;
            }

            static string SureDilimi(PersonelKaydi k)
            {
                var gun = (k.CikisTarihi!.Value.Date - k.GirisTarihi!.Value.Date).TotalDays;
                return gun < 30 ? "1 aydan az"
                    : gun < 90 ? "1–3 ay"
                    : gun < 365 ? "3–12 ay"
                    : gun < 365 * 3 ? "1–3 yıl"
                    : "3 yıldan fazla";
            }

            var sureSirasi = new[] { "1 aydan az", "1–3 ay", "3–12 ay", "1–3 yıl", "3 yıldan fazla" };

            return new
            {
                yil = y,
                aylar,
                ortalamaYillikOran = yillikOranlar.Count > 0 ? Math.Round(yillikOranlar.Average(), 1) : (double?)null,
                toplamGiris = kisiler.Count(k => k.GirisTarihi!.Value.Date >= yilBas && k.GirisTarihi.Value.Date < yilSon),
                toplamCikis = cikanlar.Count,
                sebepler = Dagilim(cikanlar.Select(x => x.CikisSebebi), 7),
                birimler = Dagilim(cikanlar.Select(x => x.IsGrubu), 8),
                sureler = sureSirasi
                    .Select(s => new { ad = s, adet = cikanlar.Count(k => SureDilimi(k) == s) })
                    .Where(x => x.adet > 0)
                    .ToList()
            };
        }

        return Ok(new
        {
            kapsam = yalnizMagaza ? "magaza" : "tumu",
            buYil = Yil(buYil),
            gecenYil = Yil(buYil - 1)
        });
    }
}

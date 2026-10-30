using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Sirkülasyon › Turnover (30.10.2026).
///
/// <para>
/// İK'nın elle tuttuğu "TURNOVER RAPORU" Excel'inin panel karşılığı: seçilen
/// yıl ve bir önceki yıl için aylık şube sayısı, dönem başı / dönem sonu
/// çalışan, giriş, çıkış, ortalama ve oranlar.
/// </para>
///
/// <para>
/// <b>Otomatik değerler</b> Mikro personel kayıtlarından (Sirkülasyon
/// sekmesiyle aynı kaynak, bölge seçimi uygulanır):
/// </para>
/// <list type="bullet">
/// <item>Dönem başı: ayın 1'inde çalışan.</item>
/// <item>Dönem sonu: sonraki ayın 1'indeki sayı (süren ayda bugün).</item>
/// <item>Şube sayısı: ay sonunda aktif personeli olan mağaza iş grubu.</item>
/// </list>
///
/// <para>
/// <b>Elle girilen değerler</b> (KRY_TURNOVER_MANUEL): ay ve alan bazında
/// otomatik değerin yerine geçer; boş bırakılan alan otomatik kalır. 2025
/// İK tarafından elle girilir; sonraki yıllar otomatik gelir, gerekirse
/// düzeltilir. Ortalama ve oranlar her zaman ekrandaki (elle ya da
/// otomatik) değerlerden hesaplanır:
/// </para>
/// <list type="bullet">
/// <item>Ortalama = (dönem başı + dönem sonu) / 2</item>
/// <item>Aylık oran = çıkış / ortalama</item>
/// <item>Yıllık oran = aylık oran × 12 (Excel'deki "Oran %")</item>
/// </list>
/// </summary>
public partial class PersonelController
{
    private static readonly string[] TurnoverAlanlari = { "subeSayisi", "donemBasi", "donemSonu", "giris", "cikis" };

    private static readonly string[] SureDilimleri = { "1 aydan az", "1–3 ay", "3–12 ay", "1–3 yıl", "3 yıldan fazla" };

    private bool TurnoverDuzenleyebilir =>
        Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi or Roller.IK;

    private static string SureDilimi(PersonelKaydi k)
    {
        if (k.GirisTarihi is null || k.CikisTarihi is null) return "Belirtilmemiş";
        var gun = (k.CikisTarihi.Value.Date - k.GirisTarihi.Value.Date).TotalDays;
        return gun < 30 ? SureDilimleri[0]
            : gun < 90 ? SureDilimleri[1]
            : gun < 365 ? SureDilimleri[2]
            : gun < 365 * 3 ? SureDilimleri[3]
            : SureDilimleri[4];
    }

    private static bool TurnoverCalisiyor(PersonelKaydi k, DateTime t) =>
        k.GirisTarihi!.Value.Date <= t && (k.CikisTarihi is null || k.CikisTarihi.Value.Date > t);

    private static string Etiket(string x) => string.IsNullOrWhiteSpace(x) ? "Belirtilmemiş" : x.Trim();

    /// <summary>Hesaba giren personel ve mağaza ayrımı (iki uç da aynı kümeyi kullanır).</summary>
    private (List<PersonelKaydi> Kisiler, List<PersonelKaydi> Tumu, Func<PersonelKaydi, bool> MagazaMi) TurnoverKisileri(
        bool yalnizMagaza, IzinFormuServisi izinFormu)
    {
        var tumu = BolgeyeGoreSuz(PersonelleriGetir());

        var form = izinFormu?.FormAyari();
        var onbellek = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        bool MagazaMi(PersonelKaydi p)
        {
            var anahtar = $"{p.IsGrubu}|{p.Sube}";
            if (onbellek.TryGetValue(anahtar, out var v)) return v;
            try { v = izinFormu is null || izinFormu.FormHedefi(p, form) == "sube"; }
            catch { v = true; }
            onbellek[anahtar] = v;
            return v;
        }

        var kisiler = tumu.Where(p => p.GirisTarihi is not null).ToList();
        if (yalnizMagaza) kisiler = kisiler.Where(MagazaMi).ToList();
        return (kisiler, tumu, MagazaMi);
    }

    /* ==================================================================== */
    /* Rapor                                                                */
    /* ==================================================================== */

    [HttpGet("Turnover")]
    public IActionResult Turnover(
        [FromQuery] int? yil,
        [FromQuery] string kapsam = "tumu",
        [FromServices] IzinFormuServisi izinFormu = null)
    {
        var buYil = yil ?? DateTime.Today.Year;
        var kapsamKodu = string.Equals(kapsam, "magaza", StringComparison.OrdinalIgnoreCase) ? "magaza" : "tumu";

        List<PersonelKaydi> kisiler, tumu;
        Func<PersonelKaydi, bool> magazaMi;
        try
        {
            (kisiler, tumu, magazaMi) = TurnoverKisileri(kapsamKodu == "magaza", izinFormu);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Turnover verisi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı.", ayrinti = HataAyrintisi(hata) });
        }

        /* Elle girilen değerler */
        var elle = new Dictionary<(int, int), dynamic>();
        try
        {
            using var db = _vt.Baglanti();
            foreach (var r in db.Query(@"
SELECT yil, ay, sube_sayisi AS subeSayisi, donem_basi AS donemBasi, donem_sonu AS donemSonu,
       giris, cikis, guncelleyen, guncelleme
FROM KRY_TURNOVER_MANUEL WHERE kapsam = @k AND yil IN (@a, @b)",
                         new { k = kapsamKodu, a = buYil, b = buYil - 1 }))
                elle[((int)r.yil, (int)r.ay)] = r;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Turnover elle girilen değerler okunamadı");
        }

        var bugun = DateTime.Today;

        object Yil(int y)
        {
            var aylar = new List<object>();
            var yillikOranlar = new List<double>();

            for (var ay = 1; ay <= 12; ay++)
            {
                var bas = new DateTime(y, ay, 1);
                var sonrakiBas = bas.AddMonths(1);
                elle.TryGetValue((y, ay), out var m);

                /* Henüz başlamamış ay: elle değer yoksa boş */
                if (bas > bugun && m is null)
                {
                    aylar.Add(new { ay, bos = true });
                    continue;
                }

                var devam = bas <= bugun && sonrakiBas > bugun;
                var gelecek = bas > bugun;

                /* Otomatik değerler */
                var sonTarih = devam ? bugun : sonrakiBas;
                var oto = new Dictionary<string, int>
                {
                    ["donemBasi"] = gelecek ? 0 : kisiler.Count(k => TurnoverCalisiyor(k, bas)),
                    ["donemSonu"] = gelecek ? 0 : kisiler.Count(k => TurnoverCalisiyor(k, sonTarih)),
                    ["giris"] = gelecek ? 0 : kisiler.Count(k => k.GirisTarihi!.Value.Date >= bas && k.GirisTarihi.Value.Date < sonrakiBas),
                    ["cikis"] = gelecek ? 0 : kisiler.Count(k => k.CikisTarihi is not null
                                                            && k.CikisTarihi.Value.Date >= bas && k.CikisTarihi.Value.Date < sonrakiBas),
                    ["subeSayisi"] = gelecek ? 0 : tumu
                        .Where(k => k.GirisTarihi is not null && TurnoverCalisiyor(k, devam ? bugun : sonrakiBas.AddDays(-1)))
                        .Where(magazaMi)
                        .Select(k => (k.IsGrubu ?? "").Trim())
                        .Where(x => x.Length > 0)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .Count(),
                };

                /* Elle girilenler yerine geçer */
                var deger = new Dictionary<string, int>(oto);
                var elleAlanlar = new List<string>();
                if (m is not null)
                {
                    var md = (IDictionary<string, object>)m;
                    foreach (var alan in TurnoverAlanlari)
                        if (md.TryGetValue(alan, out var v) && v is not null)
                        {
                            deger[alan] = Convert.ToInt32(v);
                            elleAlanlar.Add(alan);
                        }
                }

                var ortalama = (deger["donemBasi"] + deger["donemSonu"]) / 2.0;
                var oran = ortalama > 0 ? deger["cikis"] * 100.0 / ortalama : 0;
                var yillik = oran * 12;

                /* Süren ay ortalamaya girmez; elle tamamlanmışsa (çıkış ve dönem
                   sonu girilmiş) girer */
                var tamam = !devam && !gelecek || (elleAlanlar.Contains("cikis") && elleAlanlar.Contains("donemSonu"));
                if (tamam && ortalama > 0) yillikOranlar.Add(yillik);

                aylar.Add(new
                {
                    ay,
                    bos = false,
                    devam = devam && !tamam,
                    subeSayisi = deger["subeSayisi"],
                    donemBasi = deger["donemBasi"],
                    donemSonu = deger["donemSonu"],
                    giris = deger["giris"],
                    cikis = deger["cikis"],
                    ortalama = Math.Round(ortalama, 1),
                    oran = Math.Round(oran, 2),
                    yillikOran = Math.Round(yillik, 1),
                    oto,
                    elle = elleAlanlar,
                    elleGuncelleyen = m is null ? null : (string)m.guncelleyen,
                    elleTarih = m is null ? (DateTime?)null : (DateTime)m.guncelleme,
                });
            }

            /* Yıl içinde çıkanlar (pasta grafikler, Mikro kayıtlarından) */
            var yilBas = new DateTime(y, 1, 1);
            var yilSon = yilBas.AddYears(1);
            var cikanlar = kisiler.Where(k => k.CikisTarihi is not null
                                              && k.CikisTarihi.Value.Date >= yilBas && k.CikisTarihi.Value.Date < yilSon).ToList();

            static List<object> Dagilim(IEnumerable<string> l, int enFazla)
            {
                var g = l.GroupBy(Etiket)
                    .Select(x => (ad: x.Key, adet: x.Count()))
                    .OrderByDescending(x => x.adet)
                    .ToList();
                var ust = g.Take(enFazla).Select(x => (object)new { ad = x.ad, adet = x.adet, digerMi = false }).ToList();
                var kalan = g.Skip(enFazla).ToList();
                if (kalan.Count > 0)
                    ust.Add(new { ad = "Diğer", adet = kalan.Sum(x => x.adet), digerMi = true, icindekiler = kalan.Select(x => x.ad).ToList() });
                return ust;
            }

            return new
            {
                yil = y,
                aylar,
                ortalamaYillikOran = yillikOranlar.Count > 0 ? Math.Round(yillikOranlar.Average(), 1) : (double?)null,
                toplamGiris = kisiler.Count(k => k.GirisTarihi!.Value.Date >= yilBas && k.GirisTarihi.Value.Date < yilSon),
                toplamCikis = cikanlar.Count,
                sebepler = Dagilim(cikanlar.Select(x => x.CikisSebebi), 7),
                birimler = Dagilim(cikanlar.Select(x => x.IsGrubu), 8),
                sureler = SureDilimleri
                    .Select(s => new { ad = s, adet = cikanlar.Count(k => SureDilimi(k) == s), digerMi = false })
                    .Where(x => x.adet > 0)
                    .ToList()
            };
        }

        return Ok(new
        {
            kapsam = kapsamKodu,
            duzenleyebilir = TurnoverDuzenleyebilir,
            buYil = Yil(buYil),
            gecenYil = Yil(buYil - 1)
        });
    }

    /* ==================================================================== */
    /* Şube bazında aylık                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Şube (iş grubu) bazında aylık turnover (30.10.2026). Her şube için
    /// ana tablodaki aynı hesap: dönem başı, dönem sonu, giriş, çıkış,
    /// ortalama, aylık ve yıllık oran. Kaynak Mikro kayıtları; personel
    /// bugünkü iş grubuna yazılır (şube değiştirenin geçmişi yeni şubesinde
    /// görünür). Elle girilen değerler şirket geneli içindir, burada yoktur.
    /// </summary>
    [HttpGet("TurnoverSube")]
    public IActionResult TurnoverSube(
        [FromQuery] int? yil,
        [FromQuery] string kapsam = "tumu",
        [FromServices] IzinFormuServisi izinFormu = null)
    {
        var y = yil ?? DateTime.Today.Year;

        List<PersonelKaydi> kisiler;
        try
        {
            (kisiler, _, _) = TurnoverKisileri(string.Equals(kapsam, "magaza", StringComparison.OrdinalIgnoreCase), izinFormu);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Şube turnover verisi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı.", ayrinti = HataAyrintisi(hata) });
        }

        var bugun = DateTime.Today;
        var yilBas = new DateTime(y, 1, 1);
        var yilSon = yilBas.AddYears(1);

        var subeler = kisiler
            .GroupBy(k => Etiket(k.IsGrubu), StringComparer.OrdinalIgnoreCase)
            .Select(g =>
            {
                var l = g.ToList();
                var aylar = new List<object>();
                var oranlar = new List<double>();
                var ortalamalar = new List<double>();

                for (var ay = 1; ay <= 12; ay++)
                {
                    var bas = new DateTime(y, ay, 1);
                    var sonrakiBas = bas.AddMonths(1);
                    if (bas > bugun)
                    {
                        aylar.Add(new { ay, bos = true });
                        continue;
                    }

                    var devam = sonrakiBas > bugun;
                    var sonTarih = devam ? bugun : sonrakiBas;
                    var donemBasi = l.Count(k => TurnoverCalisiyor(k, bas));
                    var donemSonu = l.Count(k => TurnoverCalisiyor(k, sonTarih));
                    var giris = l.Count(k => k.GirisTarihi!.Value.Date >= bas && k.GirisTarihi.Value.Date < sonrakiBas);
                    var cikis = l.Count(k => k.CikisTarihi is not null && k.CikisTarihi.Value.Date >= bas && k.CikisTarihi.Value.Date < sonrakiBas);
                    var ortalama = (donemBasi + donemSonu) / 2.0;
                    var oran = ortalama > 0 ? cikis * 100.0 / ortalama : 0;

                    if (!devam && ortalama > 0)
                    {
                        oranlar.Add(oran * 12);
                        ortalamalar.Add(ortalama);
                    }

                    aylar.Add(new
                    {
                        ay,
                        bos = false,
                        devam,
                        donemBasi,
                        donemSonu,
                        giris,
                        cikis,
                        ortalama = Math.Round(ortalama, 1),
                        oran = Math.Round(oran, 2),
                        yillikOran = Math.Round(oran * 12, 1),
                    });
                }

                var cikisYil = l.Count(k => k.CikisTarihi is not null && k.CikisTarihi.Value.Date >= yilBas && k.CikisTarihi.Value.Date < yilSon);
                var girisYil = l.Count(k => k.GirisTarihi!.Value.Date >= yilBas && k.GirisTarihi.Value.Date < yilSon);

                return new
                {
                    sube = g.Key,
                    aylar,
                    toplamGiris = girisYil,
                    toplamCikis = cikisYil,
                    ortalamaCalisan = ortalamalar.Count > 0 ? Math.Round(ortalamalar.Average(), 1) : (double?)null,
                    ortalamaYillikOran = oranlar.Count > 0 ? Math.Round(oranlar.Average(), 1) : (double?)null,
                    mevcut = l.Count(k => TurnoverCalisiyor(k, bugun)),
                };
            })
            /* Yıl içinde hiç çalışanı olmayan şube listelenmez */
            .Where(x => x.toplamGiris > 0 || x.toplamCikis > 0 || (x.ortalamaCalisan ?? 0) > 0 || x.mevcut > 0)
            .OrderByDescending(x => x.ortalamaYillikOran ?? -1)
            .ToList();

        return Ok(new { yil = y, subeler });
    }

    /* ==================================================================== */
    /* Elle giriş                                                           */
    /* ==================================================================== */

    public sealed class TurnoverElleAy
    {
        public int Ay { get; set; }
        public int? SubeSayisi { get; set; }
        public int? DonemBasi { get; set; }
        public int? DonemSonu { get; set; }
        public int? Giris { get; set; }
        public int? Cikis { get; set; }
    }

    public sealed class TurnoverElleGirdi
    {
        public int Yil { get; set; }
        public string Kapsam { get; set; }
        public List<TurnoverElleAy> Aylar { get; set; }
    }

    /// <summary>
    /// Bir yılın elle girilen değerlerini kaydeder. Gönderilen her ay için
    /// satır yeniden yazılır; bütün alanları boş gelen ayın satırı silinir
    /// (o ay tamamen otomatiğe döner).
    /// </summary>
    [HttpPut("TurnoverManuel")]
    public IActionResult TurnoverManuel([FromBody] TurnoverElleGirdi g)
    {
        if (!TurnoverDuzenleyebilir) return Forbid();
        if (g is null || g.Yil < 2000 || g.Yil > 2100) return BadRequest(new { hata = "Yıl geçersiz." });

        var kapsamKodu = string.Equals(g.Kapsam, "magaza", StringComparison.OrdinalIgnoreCase) ? "magaza" : "tumu";
        var aylar = (g.Aylar ?? new()).Where(a => a.Ay is >= 1 and <= 12).ToList();

        foreach (var a in aylar)
            foreach (var v in new[] { a.SubeSayisi, a.DonemBasi, a.DonemSonu, a.Giris, a.Cikis })
                if (v is < 0 or > 100000)
                    return BadRequest(new { hata = $"{a.Ay}. ay: değerler 0 ile 100.000 arasında olmalı." });

        using var db = _vt.Baglanti();
        db.Open();
        using var islem = db.BeginTransaction();

        foreach (var a in aylar)
        {
            db.Execute("DELETE FROM KRY_TURNOVER_MANUEL WHERE yil = @yil AND ay = @ay AND kapsam = @k",
                new { yil = g.Yil, ay = a.Ay, k = kapsamKodu }, islem);

            if (a.SubeSayisi is null && a.DonemBasi is null && a.DonemSonu is null && a.Giris is null && a.Cikis is null)
                continue;

            db.Execute(@"
INSERT INTO KRY_TURNOVER_MANUEL (yil, ay, kapsam, sube_sayisi, donem_basi, donem_sonu, giris, cikis, guncelleyen)
VALUES (@yil, @ay, @k, @SubeSayisi, @DonemBasi, @DonemSonu, @Giris, @Cikis, @kim)",
                new { yil = g.Yil, ay = a.Ay, k = kapsamKodu, a.SubeSayisi, a.DonemBasi, a.DonemSonu, a.Giris, a.Cikis, kim = Kullanici },
                islem);
        }

        islem.Commit();
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Tıklanınca açılan liste                                              */
    /* ==================================================================== */

    /// <summary>
    /// Bir sayının arkasındaki personel (Mikro kayıtlarından).
    /// <para>
    /// <c>tur</c>: cikis · giris · donemBasi · donemSonu. <c>ay</c> verilmezse
    /// bütün yıl (yalnızca giriş/çıkış). Pasta dilimleri için <c>sebep</c>,
    /// <c>birim</c> ya da <c>sure</c> süzgeci; "Diğer" dilimi için
    /// <c>diger</c>=1 ve <c>haric</c> ilk dilimlerin adları (| ile).
    /// </para>
    /// </summary>
    [HttpGet("TurnoverListe")]
    public IActionResult TurnoverListe(
        [FromQuery] int yil,
        [FromQuery] int? ay,
        [FromQuery] string tur = "cikis",
        [FromQuery] string kapsam = "tumu",
        [FromQuery] string sebep = null,
        [FromQuery] string birim = null,
        [FromQuery] string sure = null,
        [FromQuery] string haric = null,
        [FromServices] IzinFormuServisi izinFormu = null)
    {
        List<PersonelKaydi> kisiler;
        try
        {
            (kisiler, _, _) = TurnoverKisileri(string.Equals(kapsam, "magaza", StringComparison.OrdinalIgnoreCase), izinFormu);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Turnover listesi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı.", ayrinti = HataAyrintisi(hata) });
        }

        var bas = ay is >= 1 and <= 12 ? new DateTime(yil, ay.Value, 1) : new DateTime(yil, 1, 1);
        var son = ay is >= 1 and <= 12 ? bas.AddMonths(1) : bas.AddYears(1);
        var bugun = DateTime.Today;

        IEnumerable<PersonelKaydi> l = (tur ?? "cikis").ToLowerInvariant() switch
        {
            "giris" => kisiler.Where(k => k.GirisTarihi!.Value.Date >= bas && k.GirisTarihi.Value.Date < son),
            "donembasi" => kisiler.Where(k => TurnoverCalisiyor(k, bas)),
            "donemsonu" => kisiler.Where(k => TurnoverCalisiyor(k, son > bugun ? bugun : son)),
            _ => kisiler.Where(k => k.CikisTarihi is not null && k.CikisTarihi.Value.Date >= bas && k.CikisTarihi.Value.Date < son),
        };

        var haricler = (haric ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries).ToHashSet(StringComparer.OrdinalIgnoreCase);
        bool Uyar(string deger, string suzgec) =>
            suzgec is null
            || (suzgec == "__diger__" ? !haricler.Contains(Etiket(deger)) : string.Equals(Etiket(deger), suzgec, StringComparison.OrdinalIgnoreCase));

        l = l.Where(k => Uyar(k.CikisSebebi, sebep) && Uyar(k.IsGrubu, birim) && (sure is null || SureDilimi(k) == sure));

        return Ok(l
            .OrderByDescending(k => tur == "giris" ? k.GirisTarihi : k.CikisTarihi ?? k.GirisTarihi)
            .Select(k => new
            {
                k.PersonelKodu,
                adSoyad = $"{k.Ad} {k.Soyad}".Trim(),
                birim = k.IsGrubu,
                k.Pozisyon,
                k.GirisTarihi,
                k.CikisTarihi,
                k.CikisSebebi,
                sure = k.CikisTarihi is null ? null : SureDilimi(k),
                calismaGun = k.GirisTarihi is null ? (int?)null
                    : (int)((k.CikisTarihi ?? bugun).Date - k.GirisTarihi.Value.Date).TotalDays
            })
            .ToList());
    }
}

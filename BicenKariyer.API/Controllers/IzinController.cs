using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yıllık izin yönetimi.
///
/// <para>
/// Bakiye Mikro'da tutulmuyor. Sistem devreye girerken her personelin o
/// anki kalan günü elle giriliyor; sonrasında izin kaydı girildikçe
/// düşülüyor. Kalan gün = başlangıç − kullanılan.
/// </para>
///
/// <para>
/// Gün sayısı ondalık tutulur: personel öğlen çıkıp yarım gün izin
/// kullanabiliyor. Tarih farkından hesaplanan gün bir öneridir, kullanıcı
/// değiştirebilir — tarih hesabı yarım günü kendiliğinden bilemez.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class IzinController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly ILogger<IzinController> _kayit;
    private readonly YetkiServisi _yetki;
    private readonly IzinGunuServisi _izinGunu;
    private readonly IzinFormuServisi _form;
    private readonly BildirimServisi _bildirim;
    private readonly IServiceScopeFactory _kapsam;

    public IzinController(
        VeritabaniServisi vt,
        PersonelKaynagiServisi personelKaynak,
        IzinGunuServisi izinGunu,
        ILogger<IzinController> kayit,
        YetkiServisi yetki,
        IzinFormuServisi form,
        BildirimServisi bildirim,
        IServiceScopeFactory kapsam)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _kayit = kayit;
        _yetki = yetki;
        _izinGunu = izinGunu;
        _form = form;
        _bildirim = bildirim;
        _kapsam = kapsam;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private string Rol =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>İzin girebilen roller. Görüntüleme daha geniştir.</summary>
    private bool Duzenleyebilir =>
        (Rol is Roller.Admin or Roller.IKYoneticisi or Roller.IK)
        && !_yetki.SaltOkunur(Rol);

    /* ==================================================================== */
    /* Bakiye                                                               */
    /* ==================================================================== */

    /// <summary>
    /// Tüm personelin izin durumu: girilen başlangıç, kullanılan, kalan.
    /// </summary>
    [HttpGet("Durum")]
    /// <param name="tumu">
    /// Çalışan ve ayrılmış personelin tamamı. Excel aktarımında kullanılır:
    /// çizelgede ayrılmış personel de bulunuyor ve bakiyeleri girilebilmeli.
    /// </param>
    public IActionResult Durum([FromQuery] string sube = null,
                               [FromQuery] bool yalnizcaEksik = false,
                               [FromQuery] bool ayrilanlar = false,
                               [FromQuery] bool tumu = false)
    {
        List<PersonelKaydi> personeller;

        try
        {
            var hepsi = _personelKaynak.TumPersonelleriGetir();

            /* tumu=true aktarım içindir: çizelgede ayrılmış personel de
               bulunuyor ve onların bakiyesi de girilebilmeli. Ekranda
               varsayılan yalnızca çalışanlar, ayrılanlar kendi sekmesinde. */
            personeller = tumu
                ? hepsi.ToList()
                : hepsi.Where(x => ayrilanlar ? x.Durum == 0 : x.Durum == 1).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı");
            return Ok(new { kayitlar = new List<object>() });
        }

        if (!string.IsNullOrWhiteSpace(sube))
            personeller = personeller
                .Where(x => string.Equals(x.Sube, sube, StringComparison.OrdinalIgnoreCase))
                .ToList();

        using var db = _vt.Baglanti();

        /* Bakiye hesabı ortak: Yıllık İzin Ücretleri ekranı da aynı
           rakamları kullanıyor (IzinBakiyeHesabi). */
        var bakiyeTablosu = IzinBakiyeHesabi.Oku(db);

        /* Hak ediş (kıdem) tarihi düzeltmeleri */
        var duzeltmeler = IzinHakedis.Hepsi(db);

        /* Yaklaşan izinler: henüz başlamamış planlı izinler */
        var planlananlar = db.Query(@"
SELECT personel_kodu AS kod, MIN(cikis_tarihi) AS cikis,
       MIN(donus_tarihi) AS donus
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi > CAST(SYSDATETIME() AS DATE)
GROUP BY personel_kodu")
            .ToDictionary(x => (string)x.kod, x => x, StringComparer.OrdinalIgnoreCase);

        /* İzinde olanlar: bugün çıkış ile dönüş arasında */
        var izindekiler = db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS cikis, donus_tarihi AS donus,
       baslama_tarihi AS baslama
FROM KRY_IZIN
WHERE iptal = 0
  AND CAST(SYSDATETIME() AS DATE) BETWEEN cikis_tarihi AND donus_tarihi")
            .ToDictionary(x => (string)x.kod, x => x, StringComparer.OrdinalIgnoreCase);

        var kayitlar = personeller.Select(p =>
        {
            var kod = (p.PersonelKodu ?? "").Trim();

            var izinde = izindekiler.GetValueOrDefault(kod);

            /* Hak edilen ve devreden ayrı tutulur: toplam ikisinin
               toplamıdır ama hangisinin nereden geldiği görünmeli. */
            var b = bakiyeTablosu.Hesapla(kod);

            return new
            {
                personelKodu = kod,
                kimlikNo = (p.KimlikNo ?? "").Trim(),
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                ayrildi = p.Durum == 0,
                cikisTarihi = p.CikisTarihi,
                gorev = p.Pozisyon,
                subeAdi = p.Sube,
                girisTarihi = p.GirisTarihi,

                /* Kıdem ve hak ediş bu tarihten hesaplanır */
                hakedisEsas = IzinHakedis.Esas(p.GirisTarihi, duzeltmeler.GetValueOrDefault(kod)),
                hakedisDuzeltme = IzinHakedis.Ozet(duzeltmeler.GetValueOrDefault(kod)),

                /* Bakiye girilmemişse null döner; ekranda 'girilmedi'
                   olarak gösterilir. Sıfır ile boş karıştırılmamalı. */
                hakedilen = b.Hakedilen,
                devir = b.Devir,
                girildiMi = b.Girildi,

                /* Bakiyenin geçerli olduğu tarih (açılış/aktarım günü):
                   bundan önceki izinler kalan güne zaten dahil */
                bakiyeTarihi = b.BakiyeTarihi,
                kullanilan = b.Kullanilan,
                planli = b.Planli,
                kalan = b.Kalan,

                izinde = izinde is not null,

                /* Planlı izni olanlar: gelecekteki ilk izin tarihi */
                planliCikis = planlananlar.TryGetValue(kod, out var pl)
                    ? (DateTime?)pl.cikis : null,
                planliDonus = planlananlar.TryGetValue(kod, out var pl2)
                    ? (DateTime?)pl2.donus : null,

                izinCikis = izinde is null ? (DateTime?)null : (DateTime)izinde.cikis,
                izinDonus = izinde is null ? (DateTime?)null : (DateTime)izinde.donus,
                izinBaslama = izinde is null ? (DateTime?)null : (DateTime?)izinde.baslama
            };
        })
        .Where(x => !yalnizcaEksik || !x.girildiMi)
        .OrderBy(x => x.subeAdi)
        .ThenBy(x => x.adSoyad)
        .ToList();

        return Ok(new
        {
            kayitlar,
            toplam = kayitlar.Count,
            girilen = kayitlar.Count(x => x.girildiMi),
            izindeSayisi = kayitlar.Count(x => x.izinde)
        });
    }

    /* ==================================================================== */
    /* Yıllık çizelge                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Yıllık izin çizelgesi: İK'nın Excel'de tuttuğu yapının aynısı.
    ///
    /// <para>
    /// Çizelgede yıl, 1 Ocak'tan başlayan 7 günlük haftalara bölünür
    /// (ilk hafta 8 gün; Excel'de de "01.Ocak - 08.Ocak" öyle). Her kişi
    /// için her haftaya düşen izin günü hesaplanır; bir izin kaydı iki
    /// haftaya yayılıyorsa gün sayısı takvim günü oranında paylaştırılır.
    /// </para>
    ///
    /// <para>
    /// Aynı uç, Excel'in ÖZET ŞUBELER ve ŞUBELER sayfalarının karşılığını
    /// da döner: şube başına toplamlar ve şube × ay kullanım/plan matrisi.
    /// </para>
    /// </summary>
    [HttpGet("Cizelge")]
    public IActionResult Cizelge([FromQuery] int? yil, [FromQuery] string sube = null,
                                 [FromQuery] bool ayrilanlar = false)
    {
        var y = yil ?? DateTime.Today.Year;
        var yilBas = new DateTime(y, 1, 1);
        var yilSon = new DateTime(y, 12, 31);
        var bugun = DateTime.Today;

        /* Haftalar: ilk hafta 1–8 Ocak (8 gün), sonra 7'şer gün; son hafta
           yıl sonuna kadar uzar. Excel'deki başlıklarla birebir. */
        var haftalar = new List<(int no, DateTime bas, DateTime bit)>();
        var bas = yilBas;
        var no = 1;

        while (bas <= yilSon)
        {
            var bit = no == 1 ? bas.AddDays(7) : bas.AddDays(6);
            if (bit > yilSon) bit = yilSon;
            haftalar.Add((no, bas, bit));
            bas = bit.AddDays(1);
            no++;
        }

        List<PersonelKaydi> personeller;

        try
        {
            var hepsi = _personelKaynak.TumPersonelleriGetir();

            personeller = hepsi
                .Where(x => x.Durum == 1
                            || (ayrilanlar && x.CikisTarihi is not null
                                && x.CikisTarihi.Value >= yilBas))
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı");
            return Ok(new { yil = y, haftalar = new List<object>(), kisiler = new List<object>() });
        }

        if (!string.IsNullOrWhiteSpace(sube))
            personeller = personeller
                .Where(x => string.Equals(x.Sube, sube, StringComparison.OrdinalIgnoreCase))
                .ToList();

        using var db = _vt.Baglanti();

        var bakiyeler = db.Query(@"
SELECT personel_kodu AS kod, baslangic, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE")
            .ToDictionary(x => (string)x.kod, x => x, StringComparer.OrdinalIgnoreCase);

        /* Yıla değen tüm izinler; yıl dışına taşan kısım hafta hesabında
           kendiliğinden düşer */
        var izinler = db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS cikis, donus_tarihi AS donus,
       gun, tur, bakiyeden_duser AS duser
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @son AND donus_tarihi >= @bas",
                new { bas = yilBas, son = yilSon })
            .GroupBy(x => ((string)x.kod ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);

        var duzeltmeler = IzinHakedis.Hepsi(db);

        var kisiler = personeller.Select(p =>
        {
            var kod = (p.PersonelKodu ?? "").Trim();
            bakiyeler.TryGetValue(kod, out var bakiye);
            izinler.TryGetValue(kod, out var kayitlar);

            var haftaGun = new decimal[haftalar.Count];
            var haftaPlan = new bool[haftalar.Count];
            decimal kullanilan = 0, planli = 0;

            foreach (var iz in kayitlar ?? new List<dynamic>())
            {
                if (iz.duser is not null && !(bool)iz.duser) continue;

                DateTime cikis = ((DateTime)iz.cikis).Date;
                DateTime donus = ((DateTime)iz.donus).Date;
                var gun = (decimal)iz.gun;

                /* Takvim günü: çıkış ile dönüş arası (dönüş günü işbaşı).
                   Aynı gün çıkış-dönüş yarım/tek gündür. */
                var takvimGunu = Math.Max(1, (int)(donus - cikis).TotalDays);

                for (var i = 0; i < haftalar.Count; i++)
                {
                    var hb = haftalar[i].bas;
                    var hs = haftalar[i].bit.AddDays(1);

                    var kesBas = cikis > hb ? cikis : hb;
                    var kesSon = donus < hs ? donus : hs;

                    var kesisim = (int)(kesSon - kesBas).TotalDays;

                    if (donus == cikis && cikis >= hb && cikis < hs) kesisim = 1;
                    if (kesisim <= 0) continue;

                    /* İzin günü takvim günüyle birebir değilse (6 gün izin,
                       7 takvim günü) haftaya orantılı pay düşer */
                    var pay = Math.Round(gun * kesisim / takvimGunu, 1);

                    haftaGun[i] += pay;
                    if (cikis > bugun) haftaPlan[i] = true;
                }

                if (cikis <= bugun) kullanilan += gun; else planli += gun;
            }

            var hakedilen = bakiye is null ? (decimal?)null : (decimal)bakiye.baslangic;
            var devir = bakiye is null ? 0m : (decimal)bakiye.devir;
            var aktarilan = bakiye is null ? 0m : (decimal)bakiye.aktarilan;

            kullanilan += aktarilan;

            /* Hak ediş: işe girişin bu yıldaki karşılığı — çizelgedeki
               hesapla aynı */
            DateTime? hakedisTarihi = null;
            int? kidem = null;

            /* Ayrılıp tekrar girenlerde İK'nın düzelttiği esas tarih */
            var esas = IzinHakedis.Esas(p.GirisTarihi, duzeltmeler.GetValueOrDefault(kod));

            if (esas is DateTime g)
            {
                hakedisTarihi = IzinHakedis.YilDonumu(g, y);
                kidem = y - g.Year;
            }

            return new
            {
                personelKodu = kod,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                subeAdi = p.Sube,
                gorev = p.Pozisyon,
                girisTarihi = p.GirisTarihi,
                hakedisEsas = esas,
                ayrildi = p.Durum == 0,
                hakedisTarihi,
                hakedisBitis = hakedisTarihi?.AddYears(1),
                kidem,
                hakedilen,
                devir,
                girildiMi = bakiye is not null,
                kullanilan,
                planli,
                kalan = hakedilen is null ? (decimal?)null
                        : hakedilen + devir - kullanilan - planli,
                haftalar = haftaGun,
                planHaftalari = haftaPlan
            };
        })
        .OrderBy(x => x.subeAdi).ThenBy(x => x.adSoyad)
        .ToList();

        /* Şube özeti — ÖZET ŞUBELER sayfası */
        var subeler = kisiler
            .GroupBy(x => string.IsNullOrWhiteSpace(x.subeAdi) ? "Belirtilmemiş" : x.subeAdi)
            .Select(g =>
            {
                var hak = g.Sum(x => x.hakedilen ?? 0) + g.Sum(x => x.devir);
                var kul = g.Sum(x => x.kullanilan);
                var pla = g.Sum(x => x.planli);

                /* Şube × ay — ŞUBELER sayfası: haftalar ait olduğu aya
                   yazılır (haftanın başladığı ay) */
                var aylar = Enumerable.Range(1, 12).Select(ay => new
                {
                    ay,
                    kullanim = g.Sum(x => haftalar
                        .Select((h, i) => h.bas.Month == ay && !x.planHaftalari[i] ? x.haftalar[i] : 0m)
                        .Sum()),
                    plan = g.Sum(x => haftalar
                        .Select((h, i) => h.bas.Month == ay && x.planHaftalari[i] ? x.haftalar[i] : 0m)
                        .Sum())
                }).ToList();

                return new
                {
                    sube = g.Key,
                    kisi = g.Count(),
                    girilen = g.Count(x => x.girildiMi),
                    toplam = hak,
                    kullanilan = kul,
                    planli = pla,
                    kalan = hak - kul - pla,
                    kullanimOrani = hak == 0 ? (int?)null : (int)Math.Round((kul + pla) * 100 / hak),
                    aylar
                };
            })
            .OrderBy(x => x.sube)
            .ToList();

        return Ok(new
        {
            yil = y,
            bugunHafta = haftalar.FindIndex(h => bugun >= h.bas && bugun <= h.bit),
            haftalar = haftalar.Select(h => new
            {
                h.no,
                bas = h.bas,
                bit = h.bit,
                ay = h.bas.Month,
                baslik = $"{h.bas:dd.MM} - {h.bit:dd.MM}"
            }).ToList(),
            kisiler,
            subeler
        });
    }

    /// <summary>Bir personelin başlangıç bakiyesini yazar.</summary>
    [HttpPost("Bakiye")]
    public IActionResult Bakiye([FromBody] IzinBakiyeGirdi girdi)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.PersonelKodu))
            return BadRequest(new { hata = "Personel belirtiniz." });

        /* Eksi bakiye kabul edilir: fazla (avans) izin kullanmış personel */
        if (girdi.Baslangic < -400 || girdi.Baslangic > 400)
            return BadRequest(new { hata = "Gün sayısı -400 ile 400 arasında olmalı." });

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_IZIN_BAKIYE AS h
USING (SELECT @kod AS kod) AS y ON h.personel_kodu = y.kod
WHEN MATCHED THEN
    UPDATE SET baslangic = @baslangic, devir = @devir, ad_soyad = @adSoyad,
               aciklama = @aciklama, guncelleme = SYSDATETIME(),
               guncelleyen = @kullanici
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, ad_soyad, baslangic, devir, aciklama, giren)
    VALUES (@kod, @adSoyad, @baslangic, @devir, @aciklama, @kullanici);",
            new
            {
                kod = girdi.PersonelKodu.Trim(),
                adSoyad = girdi.AdSoyad,
                baslangic = girdi.Baslangic,
                devir = girdi.Devir,
                aciklama = girdi.Aciklama,
                kullanici = Kullanici
            });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Hak ediş (kıdem) esas tarihini yazar. Ayrılıp tekrar giren
    /// personelde çalışılmayan ara süre ilk girişe eklenir; hesap ekranda
    /// yapılır, burada sonuç tarih ve dayanağı saklanır.
    /// </summary>
    [HttpPost("HakEdisTarihi")]
    public IActionResult HakEdisTarihi([FromBody] IzinHakedisGirdi girdi)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.PersonelKodu))
            return BadRequest(new { hata = "Personel belirtiniz." });

        if (girdi.HakedisTarihi is not DateTime tarih
            || tarih.Year < 1950 || tarih.Date > DateTime.Today.AddYears(1))
            return BadRequest(new { hata = "Geçerli bir hak ediş tarihi giriniz." });

        if (girdi.IlkGiris is DateTime ilk && tarih.Date < ilk.Date)
            return BadRequest(new { hata = "Hak ediş tarihi ilk işe giriş tarihinden önce olamaz." });

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_IZIN_HAKEDIS AS h
USING (SELECT @kod AS kod) AS y ON h.personel_kodu = y.kod
WHEN MATCHED THEN
    UPDATE SET hakedis_tarihi = @tarih, ilk_giris = @ilk, ara_donemler = @ara,
               aciklama = @aciklama, ad_soyad = @adSoyad,
               guncelleyen = @kullanici, guncelleme = SYSDATETIME(), kaynak = N'elle'
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, ad_soyad, hakedis_tarihi, ilk_giris, ara_donemler,
            aciklama, guncelleyen, kaynak)
    VALUES (@kod, @adSoyad, @tarih, @ilk, @ara, @aciklama, @kullanici, N'elle');",
            new
            {
                kod = girdi.PersonelKodu.Trim(),
                adSoyad = girdi.AdSoyad,
                tarih = tarih.Date,
                ilk = girdi.IlkGiris?.Date,
                ara = string.IsNullOrWhiteSpace(girdi.AraDonemler) ? null : girdi.AraDonemler,
                aciklama = string.IsNullOrWhiteSpace(girdi.Aciklama) ? null : girdi.Aciklama.Trim(),
                kullanici = Kullanici
            });

        /* Personel kartındaki kıdem hemen yeni tarihten */
        PersonelKaynagiServisi.KidemiUnut();

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Personelin bordrodaki bütün girişleri (aynı T.C. ile açılmış kartlar)
    /// ve bunlardan hesaplanan hak ediş tarihi. Panelin "Bordrodan getir"
    /// düğmesi.
    /// </summary>
    [HttpGet("KidemBordro/{personelKodu}")]
    public IActionResult KidemBordro(string personelKodu, [FromServices] KidemBordroServisi kidem)
    {
        var p = _personelKaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => string.Equals((x.PersonelKodu ?? "").Trim(), (personelKodu ?? "").Trim(),
                StringComparison.OrdinalIgnoreCase));

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        try
        {
            var h = kidem.KisiHesabi(p);

            if (h is null)
                return Ok(new { bulundu = false, sebep = string.IsNullOrWhiteSpace(p.KimlikNo)
                    ? "Personelin T.C. kimlik numarası yok." : "Bordroda bu T.C. ile kayıt bulunamadı." });

            return Ok(new
            {
                bulundu = true,
                ilkGiris = h.IlkGiris,
                esas = h.Esas,
                bosGun = h.BosGun,
                donemler = h.Donemler.Select(d => new { kod = d.Kod, giris = d.Giris, cikis = d.Cikis }),
                aralar = h.Aralar.Select(a => new { ayrilis = a.Ayrilis, donus = a.Donus, gun = a.Gun }),
            });
        }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Bordro veritabanı okunamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Bütün çalışanların kıdemini bordrodan şimdi eşitler (her sabah kendiliğinden de yapılıyor).</summary>
    [HttpPost("KidemBordroEsitle")]
    public IActionResult KidemBordroEsitle([FromServices] KidemBordroServisi kidem)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        try
        {
            return Ok(kidem.Esitle(Kullanici));
        }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Bordro veritabanı okunamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Düzeltmeyi kaldırır; hak ediş yeniden işe giriş tarihinden hesaplanır.</summary>
    /// <summary>
    /// Düzeltmeyi kaldırır. Kişi bordroda ayrılıp dönmüş görünüyorsa kıdemi
    /// hemen bordrodan yeniden hesaplanır (otomatik kayıt); dönmemişse kıdem
    /// Mikro'daki işe girişten.
    /// </summary>
    [HttpDelete("HakEdisTarihi/{personelKodu}")]
    public IActionResult HakEdisTarihiSil(string personelKodu, [FromServices] KidemBordroServisi kidem)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        using (var db = _vt.Baglanti())
            db.Execute("DELETE FROM KRY_IZIN_HAKEDIS WHERE personel_kodu = @kod",
                new { kod = (personelKodu ?? "").Trim() });

        var bordrodan = false;

        try
        {
            kidem.Esitle(Kullanici);

            using var db2 = _vt.Baglanti();
            bordrodan = db2.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_IZIN_HAKEDIS WHERE personel_kodu = @kod AND kaynak = N'bordro'",
                new { kod = (personelKodu ?? "").Trim() }) > 0;
        }
        catch (Exception hata)
        {
            /* Bordroya ulaşılamazsa ertesi sabahki eşitleme yazar */
            _kayit.LogWarning(hata, "Düzeltme kaldırıldıktan sonra kıdem bordrodan hesaplanamadı");
        }

        PersonelKaynagiServisi.KidemiUnut();

        return Ok(new { basarili = true, bordrodan });
    }

    /// <summary>Toplu bakiye girişi; Excel aktarımı bunu kullanır.</summary>
    [HttpPost("BakiyeToplu")]
    public IActionResult BakiyeToplu([FromBody] List<IzinBakiyeGirdi> girdiler)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        if (girdiler is null || girdiler.Count == 0)
            return BadRequest(new { hata = "Aktarılacak satır yok." });

        using var db = _vt.Baglanti();

        var yazilan = 0;
        var atlanan = new List<string>();

        /* Aynı sicil birden çok kez geçerse ilki alınır: hangisinin doğru
           olduğu bilinemez, sessizce sonuncuyu yazmak yanlış olur. */
        var gorulen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var g in girdiler)
        {
            var kod = (g.PersonelKodu ?? "").Trim();

            if (string.IsNullOrWhiteSpace(kod))
            {
                atlanan.Add("Sicil numarası boş");
                continue;
            }

            if (!gorulen.Add(kod))
            {
                atlanan.Add($"{kod} · aynı sicil birden fazla kez geçiyor");
                continue;
            }

            if (g.Baslangic < -400 || g.Baslangic > 400)
            {
                atlanan.Add($"{kod} · gün sayısı geçersiz ({g.Baslangic})");
                continue;
            }

            db.Execute(@"
MERGE KRY_IZIN_BAKIYE AS h
USING (SELECT @kod AS kod) AS y ON h.personel_kodu = y.kod
WHEN MATCHED THEN
    UPDATE SET baslangic = @baslangic, devir = @devir,
               aktarilan_kullanim = @kullanilan, ad_soyad = @adSoyad,
               /* Aktarılan bakiye bugün itibarıyladır; bundan önceki
                  tarihli izinler geriye dönük girilirken bakiyeden düşülmez */
               baslangic_tarihi = SYSDATETIME(),
               guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, ad_soyad, baslangic, devir,
            aktarilan_kullanim, giren)
    VALUES (@kod, @adSoyad, @baslangic, @devir, @kullanilan, @kullanici);",
                new
                {
                    kod,
                    adSoyad = g.AdSoyad,
                    baslangic = g.Baslangic,
                    devir = g.Devir,
                    /* Tarihli izinler ayrı kayıt olarak yazılıyorsa
                       toplam burada tutulmaz; aksi hâlde aynı izin iki
                       kez düşülürdü. */
                    kullanilan = g.Izinler is { Count: > 0 } ? 0m : g.Kullanilan,
                    kullanici = Kullanici
                });

            /* Çizelgenin haftalık sütunlarından gelen tarihli izinler.

               Önce bu kişinin aktarımdan gelen eski kayıtları silinir;
               aktarım tekrarlanabilir olmalı ve aynı izin iki kez
               yazılmamalı. Elle girilen izinlere dokunulmaz. */
            if (g.Izinler is { Count: > 0 })
            {
                db.Execute(@"
DELETE FROM KRY_IZIN
WHERE personel_kodu = @kod AND giren = N'çizelge'",
                    new { kod });

                foreach (var iz in g.Izinler)
                {
                    if (iz.Gun <= 0) continue;

                    db.Execute(@"
INSERT INTO KRY_IZIN
    (personel_kodu, ad_soyad, sube_adi, gorev, tur, cikis_tarihi, donus_tarihi,
     gun, aciklama, bakiyeden_duser, giren)
VALUES (@kod, @adSoyad, @subeAdi, @gorev, N'Yıllık İzin', @cikis, @donus,
        @gun, N'İzin çizelgesinden aktarıldı', 1, N'çizelge')",
                        new
                        {
                            kod,
                            adSoyad = g.AdSoyad,
                            subeAdi = g.SubeAdi,
                            gorev = g.Gorev,
                            cikis = iz.CikisTarihi.Date,
                            /* Dönüş çıkıştan önce olamaz; bozuk satır
                               olduğu gibi yazılmasın */
                            donus = iz.DonusTarihi.Date < iz.CikisTarihi.Date
                                ? iz.CikisTarihi.Date : iz.DonusTarihi.Date,
                            gun = iz.Gun
                        });
                }
            }

            yazilan++;
        }

        return Ok(new { basarili = true, yazilan, atlanan });
    }

    /* ==================================================================== */
    /* İzin kayıtları                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Aralıkla kesişen tüm izin kayıtları (iptal edilmemiş). Pano bunlardan
    /// günlük izinli sayısını, aylık kullanımı ve aynı şubede aynı anda
    /// izinde olanları hesaplıyor; tek sorguda gelmesi kişi kişi geçmiş
    /// çekmekten çok daha hafif.
    /// </summary>
    [HttpGet("Kayitlar")]
    public IActionResult Kayitlar([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var b1 = (bas ?? new DateTime(DateTime.Today.Year, 1, 1)).Date;
        var b2 = (bit ?? DateTime.Today.AddDays(60)).Date;

        if ((b2 - b1).TotalDays > 800)
            return BadRequest(new { hata = "Aralık en fazla iki yıl olabilir." });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       gorev, tur, cikis_tarihi AS cikisTarihi, donus_tarihi AS donusTarihi,
       baslama_tarihi AS baslamaTarihi, gun, bakiyeden_duser AS bakiyedenDuser,
       giren, olusturma
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @b2 AND donus_tarihi >= @b1
ORDER BY cikis_tarihi", new { b1, b2 }, commandTimeout: 90).ToList();

        return Ok(new { bas = b1, bit = b2, bugun = DateTime.Today, kayitlar });
    }

    /// <summary>Bir personelin izin geçmişi.</summary>
    [HttpGet("Gecmis/{personelKodu}")]
    public IActionResult Gecmis(string personelKodu)
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, tur, cikis_tarihi AS cikisTarihi, donus_tarihi AS donusTarihi,
       baslama_tarihi AS baslamaTarihi, gun, yarim_gun AS yarimGun,
       baslangic_saat AS baslangicSaat, bitis_saat AS bitisSaat, saat,
       aciklama, durum, giren, olusturma, bakiyeden_duser AS bakiyedenDuser
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0
ORDER BY cikis_tarihi DESC", new { kod = (personelKodu ?? "").Trim() }).ToList();

        var bakiye = db.QueryFirstOrDefault(@"
SELECT baslangic AS hakedilen, devir,
       aktarilan_kullanim AS aktarilanKullanim,
       baslangic_tarihi AS tarih, giren, aciklama, guncelleme, guncelleyen
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod",
            new { kod = (personelKodu ?? "").Trim() });

        var hakedis = IzinHakedis.Ozet(IzinHakedis.Getir(db, personelKodu));

        return Ok(new { bakiye, kayitlar, hakedis });
    }

    /// <summary>
    /// Bir tarih aralığında bakiyeden düşülecek gün sayısı.
    ///
    /// <para>
    /// Ekran, tarih seçildiği anda bunu sorup gün kutusunu dolduruyor ve
    /// hangi günlerin düşülmediğini gösteriyor. Sayıyı kullanıcının elle
    /// yazması, resmi tatilleri her seferinde tek tek düşünmesini
    /// gerektiriyordu.
    /// </para>
    /// </summary>
    [HttpGet("GunHesabi")]
    public IActionResult GunHesabi(
        [FromQuery] DateTime cikis,
        [FromQuery] DateTime donus,
        [FromQuery] string pozisyon = null,
        [FromQuery] string personelKodu = null)
    {
        if (donus < cikis)
            return BadRequest(new { hata = "Dönüş tarihi çıkıştan önce olamaz." });

        var s = _izinGunu.Hesapla(pozisyon, cikis, donus, personelKodu);

        return Ok(new
        {
            gun = s.Gun,
            takvimGunu = s.TakvimGunu,
            resmiTatil = s.ResmiTatil,
            haftalikIzin = s.HaftalikIzin,
            dusulmeyenler = s.Dusulmeyenler,

            /* Cumartesi kuralı (Yönetim → İzin Kuralları) */
            cumartesiDusen = s.CumartesiDusen,
            notlar = s.Notlar
        });
    }

    /// <summary>İzin kaydı ekler.</summary>
    [HttpPost]
    public async Task<IActionResult> Ekle([FromBody] IzinGirdi girdi)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.PersonelKodu))
            return BadRequest(new { hata = "Personel belirtiniz." });

        if (girdi.DonusTarihi < girdi.CikisTarihi)
            return BadRequest(new { hata = "Dönüş tarihi çıkıştan önce olamaz." });

        if (girdi.Gun <= 0)
            return BadRequest(new { hata = "İzin günü sıfırdan büyük olmalı." });

        using var db = _vt.Baglanti();

        /* Yıllık izin bakiyeden düşer; mazeret, rapor gibi türler düşmez */
        /* Yalnızca yıllık izin bakiyeden düşer. Saatlik izin, mazeret,
           rapor ve diğerleri kaydedilir ama bakiyeyi etkilemez. */
        var duser = girdi.Tur == "Yıllık İzin" && (girdi.BakiyedenDussun ?? true);

        if (duser)
        {
            var bakiye = db.ExecuteScalar<decimal?>(
                @"SELECT baslangic + devir - aktarilan_kullanim
                  FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod",
                new { kod = girdi.PersonelKodu.Trim() });

            if (bakiye is null)
                return BadRequest(new
                {
                    hata = "Bu personelin izin hak edişi girilmemiş.",
                    ayrinti = "Önce Yıllık İzin ekranından mevcut izin günü giriniz."
                });

            var kullanilan = db.ExecuteScalar<decimal>(@"
SELECT ISNULL(SUM(gun), 0) FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1",
                new { kod = girdi.PersonelKodu.Trim() });

            var kalan = bakiye.Value - kullanilan;

            /* Bakiye aşımı engellenmez, uyarı döner: gerçekte avans izin
               verilebiliyor ve engellemek İK'yı sistemin dışına iter. */
            if (girdi.Gun > kalan)
                _kayit.LogInformation(
                    "İzin bakiyesi aşıldı: {Kod} · kalan {Kalan}, girilen {Gun}",
                    girdi.PersonelKodu, kalan, girdi.Gun);
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IZIN
    (personel_kodu, ad_soyad, sube_adi, gorev, tur,
     cikis_tarihi, donus_tarihi, baslama_tarihi, gun, yarim_gun,
     baslangic_saat, bitis_saat, saat,
     aciklama, bakiyeden_duser, giren)
OUTPUT INSERTED.id
VALUES (@personelKodu, @adSoyad, @subeAdi, @gorev, @tur,
        @cikisTarihi, @donusTarihi, @baslamaTarihi, @gun, @yarimGun,
        @baslangicSaat, @bitisSaat, @saat,
        @aciklama, @duser, @giren)",
            new
            {
                personelKodu = girdi.PersonelKodu.Trim(),
                adSoyad = girdi.AdSoyad,
                subeAdi = girdi.SubeAdi,
                gorev = girdi.Gorev,
                tur = girdi.Tur ?? "Yıllık İzin",
                cikisTarihi = girdi.CikisTarihi,
                donusTarihi = girdi.DonusTarihi,
                baslamaTarihi = girdi.BaslamaTarihi,
                gun = girdi.Gun,
                yarimGun = girdi.YarimGun,
                baslangicSaat = girdi.BaslangicSaat,
                bitisSaat = girdi.BitisSaat,
                saat = girdi.Saat,
                aciklama = girdi.Aciklama,
                duser,
                giren = Kullanici
            });

        /* Personele bildirim ve izin formu (26.10.2026) */
        object bildirim = null;
        if (girdi.Bildir != false)
        {
            try { bildirim = await PersoneleBildir(db, id, girdi); }
            catch (Exception hata) { _kayit.LogWarning(hata, "Panel izin bildirimi yapılamadı: {Id}", id); }
        }

        return Ok(new { basarili = true, id, bildirim });
    }

    /// <summary>
    /// İK panelden izin girdiğinde (26.10.2026): izin formu personelin
    /// şubesine ya da kendi e-postasına gider, personele bildirim düşer
    /// ("şu tarihlerde İK tarafından izin girişi yapılmıştır"). İmzalı formu
    /// ana sayfadaki evrak kartından yükleyebilsin diye onaylı bir talep
    /// kaydı (kaynak = panel) açılır; mobil talep akışıyla aynı kart,
    /// hatırlatma ve evrak takibi kullanılır. Rapor türünde form yok.
    /// </summary>
    private async Task<object> PersoneleBildir(System.Data.IDbConnection db, int izinId, IzinGirdi g)
    {
        var kod = g.PersonelKodu.Trim();
        var p = _personelKaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => (x.PersonelKodu ?? "").Trim().TrimStart('0') == kod.TrimStart('0'));
        var tur = g.Tur ?? "Yıllık İzin";
        var raporlu = IzinEvrak.RaporluMu(tur);
        var adSoyad = g.AdSoyad ?? (p is null ? kod : $"{p.Ad} {p.Soyad}".Trim());
        var girenAd = User?.FindFirst("adSoyad")?.Value ?? Kullanici;

        var tarih = g.CikisTarihi.Date == g.DonusTarihi.Date
            ? $"{g.CikisTarihi:dd.MM.yyyy}"
            : $"{g.CikisTarihi:dd.MM.yyyy} – {g.DonusTarihi:dd.MM.yyyy}";
        if (!string.IsNullOrWhiteSpace(g.BaslangicSaat) && !string.IsNullOrWhiteSpace(g.BitisSaat))
            tarih += $" ({g.BaslangicSaat}–{g.BitisSaat})";

        string hedef = null;
        if (!raporlu && p is not null)
        {
            try { hedef = _form.FormHedefi(p); } catch { hedef = "sube"; }
            if (hedef != "sube")
            {
                string kisisel = null;
                try { kisisel = _form.KisiselEposta(p); } catch { kisisel = null; }
                if (kisisel is not null) hedef = "kisisel";
            }
        }

        var baslik = "İzin girişi yapıldı";
        var metin = $"{tarih} tarihlerinde İnsan Kaynakları tarafından {tur.ToLower(new System.Globalization.CultureInfo("tr-TR"))} girişi yapılmıştır.";
        if (hedef is not null)
        {
            metin += hedef switch
            {
                "kisisel" => " İzin formu e-posta adresinize gönderilmiştir.",
                "merkez" => " İzin formu İnsan Kaynakları'na e-posta ile gönderilmiştir.",
                "depo" => " İzin formu depo müdürünüzün e-postasına gönderilmiştir.",
                _ => " İzin formu mağazanıza e-posta olarak gönderilmiştir.",
            };
            metin += " Formu imzalayıp ana sayfadan sisteme yükleyiniz.";
        }

        /* Onaylı talep kaydı: evrak kartı, form ve hatırlatmalar bunun üzerinden */
        int? talepId = null;
        if (hedef is not null)
        {
            talepId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_IZIN_TALEP
    (personel_kodu, ad_soyad, sube_adi, gorev, tur, cikis_tarihi, donus_tarihi, baslama_tarihi, gun,
     yarim_gun, baslangic_saat, bitis_saat, saat, aciklama, durum,
     magaza_karar, magaza_kisi, magaza_not, magaza_tarih,
     bolge_karar, bolge_kisi, bolge_not, bolge_tarih,
     ik_karar, ik_kisi, ik_tarih, izin_id, form_sarti, form_kisisel, kaynak, mb_son)
OUTPUT INSERTED.id
VALUES (@kod, @adSoyad, @sube, @gorev, @tur, @cikis, @donus, @baslama, @gun,
        @yarimGun, @basSaat, @bitSaat, @saat, @aciklama, N'Onaylandı',
        N'Atlandı', N'Sistem', N'İnsan Kaynakları panelden girdi.', SYSDATETIME(),
        N'Atlandı', N'Sistem', N'İnsan Kaynakları panelden girdi.', SYSDATETIME(),
        N'Onaylandı', @giren, SYSDATETIME(), @izinId, 0, @kisisel, N'panel', DATEADD(DAY, @sure, SYSDATETIME()))",
                new
                {
                    kod, adSoyad, sube = g.SubeAdi ?? p?.Sube, gorev = g.Gorev ?? p?.Pozisyon, tur,
                    cikis = g.CikisTarihi.Date, donus = g.DonusTarihi.Date, baslama = g.BaslamaTarihi?.Date, gun = g.Gun,
                    yarimGun = g.YarimGun, basSaat = g.BaslangicSaat, bitSaat = g.BitisSaat, saat = g.Saat,
                    aciklama = "İK panelden girdi" + (string.IsNullOrWhiteSpace(g.Aciklama) ? "" : $" · {g.Aciklama.Trim()}"),
                    giren = girenAd, izinId, kisisel = hedef == "kisisel", sure = MazeretBelgeGorevi.SureGun,
                });

            IzinHareket.Yaz(db, talepId.Value, IzinHareket.Olusturma, "İK panelden izin girdi",
                $"{tur} · {tarih} · {g.Gun:0.#} gün", girenAd, null, IzinHareket.Panel);

            /* Form maili arka planda: SMTP yavaşsa panel beklemesin */
            var kapsam = _kapsam;
            var kayit = _kayit;
            var tid = talepId.Value;
            _ = Task.Run(async () =>
            {
                try
                {
                    using var k = kapsam.CreateScope();
                    await k.ServiceProvider.GetRequiredService<IzinFormuServisi>().GonderAsync(tid);
                }
                catch (Exception hata) { kayit.LogError(hata, "Panel izin formu gönderilemedi: {Id}", tid); }
            });
        }

        /* Uygulamadaki duyurularda kalıcı, telefona anlık */
        db.Execute("INSERT INTO KRY_MOBIL_DUYURU (baslik, metin, personel_kodu, gonderen) VALUES (@baslik, @metin, @kod, @gonderen)",
            new { baslik, metin, kod, gonderen = girenAd });
        await _bildirim.Gonder(kod, baslik, metin, hedef is not null ? "anasayfa" : "izin");

        if (talepId is int t)
            IzinHareket.Yaz(db, t, IzinHareket.Bildirim, $"Personele bildirildi: {baslik}", metin, "Sistem", adSoyad, IzinHareket.Uygulama);

        return new { metin, hedef, talepId };
    }

    /// <summary>İzin kaydını iptal eder.</summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Duzenleyebilir)
            return StatusCode(403, new { hata = "İzin düzenleme yetkiniz yok." });

        using var db = _vt.Baglanti();

        /* Kayıt silinmez, iptal işaretlenir: kimin ne zaman izin aldığı
           sonradan sorulabiliyor ve silinen kayıt geri getirilemez. */
        db.Execute("UPDATE KRY_IZIN SET iptal = 1 WHERE id = @id", new { id });

        /* Panelden girilen iznin evrak talebi de kapanır (26.10.2026) */
        db.Execute("UPDATE KRY_IZIN_TALEP SET iptal = 1 WHERE izin_id = @id AND kaynak = N'panel'", new { id });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Aynı şubede o tarihlerde izinde olacak personel; çakışma uyarısı için.
    /// </summary>
    [HttpGet("Cakisma")]
    public IActionResult Cakisma(
        [FromQuery] string sube,
        [FromQuery] DateTime bas,
        [FromQuery] DateTime bit,
        [FromQuery] string haric = null)
    {
        if (string.IsNullOrWhiteSpace(sube))
            return Ok(new { kayitlar = new List<object>() });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT ad_soyad AS adSoyad, gorev, cikis_tarihi AS cikisTarihi,
       donus_tarihi AS donusTarihi, gun
FROM KRY_IZIN
WHERE iptal = 0 AND sube_adi = @sube
  AND (@haric IS NULL OR personel_kodu <> @haric)
  AND cikis_tarihi <= @bit AND donus_tarihi >= @bas
ORDER BY cikis_tarihi",
            new { sube, bas, bit, haric }).ToList();

        return Ok(new { kayitlar });
    }
}

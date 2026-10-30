using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Puantaj Çizelgesi ve Ekibim.
///
/// <para>
/// Puantaj: mağaza müdürü kendi ekibinin, bölge müdürü sorumlu olduğu
/// mağazaların vardiya giriş-çıkışını görüyor. Bölge müdürü için her
/// mağaza bir kart: okutma oranı, okutmayan ve izinli sayısı.
/// </para>
///
/// <para>
/// Ekibim: personel ekip arkadaşlarının yalnızca adını ve pozisyonunu
/// görüyor. Yönetici, sorumlu olduğu kişiye dokununca izin durumunu,
/// bakiyesini, planlı izinlerini ve vardiya girişi yapmadığı günleri
/// görüyor. Başkasının izin ve puantaj bilgisi bu kural dışında hiç
/// dönmüyor.
/// </para>
///
/// <para>
/// Kim kimden sorumlu: İK'nın izin onay tablosundan (EkipServisi).
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Personel")]
public class EkipController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly EkibimKurallari _kurallar;

    public EkipController(VeritabaniServisi vt, EkipServisi ekip, EkibimKurallari kurallar)
    {
        _vt = vt;
        _ekip = ekip;
        _kurallar = kurallar;
    }

    /// <summary>
    /// Ayrıntı görüntüleme (yalnızca görüntüleme uçları): yöneticilik ya da
    /// İK'nın Ekibim kuralıyla eklenen kişi; kuralla gizlenen kişi hariç.
    /// </summary>
    private bool AyrintiGorur(PersonelKaydi ben, PersonelKaydi hedef)
    {
        if (K(ben.PersonelKodu) == K(hedef.PersonelKodu)) return true;

        var k = _kurallar.Bul(ben.PersonelKodu);
        if (_kurallar.Gizli(k, hedef)) return false;

        return _ekip.AyrintiGorebilir(ben, hedef) || _kurallar.EkAyrinti(k, ben, hedef, _ekip.Aktifler());
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

    private static string AdSoyad(PersonelKaydi p) => $"{p.Ad} {p.Soyad}".Trim();

    /* ====================================================================== */
    /* Günlük durum                                                           */
    /* ====================================================================== */

    /// <summary>Bir personelin bir gündeki durumu.</summary>
    public sealed record Gun(DateTime Tarih, string Durum, DateTime? Giris, DateTime? Cikis,
                              int Okutma, string IzinTuru)
    {
        public bool DevamsizMi => Durum == "okutmadi" && IzinTuru == Devamsiz;
    }

    /// <summary>Devamsız günün etiketi (izinTuru alanında)</summary>
    public const string Devamsiz = "Devamsız";

    /// <summary>Devamsızlık ekranı için gün durumları (23.10.2026; köprüyle çağrılır)</summary>
    [NonAction]
    public Dictionary<string, List<Gun>> GunDurumlari(List<PersonelKaydi> kisiler, DateTime bas, DateTime son) =>
        Durumlar(kisiler, bas, son);

    /// <summary>
    /// Kişi × gün durumları tek seferde: okutmalar, yıllık izinler,
    /// haftalık izin günleri, resmî tatiller. Öncelik: okuttu → izinli →
    /// haftalık izin → resmî tatil → okutmadı.
    /// </summary>
    private Dictionary<string, List<Gun>> Durumlar(List<PersonelKaydi> kisiler, DateTime bas, DateTime son)
    {
        using var db = _vt.Baglanti();

        var kodlar = kisiler.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        /* Okutmalar: gün bazında ilk ve son; kişi listesi büyük olabildiği
           için IN yerine tarih süzgeci, kişi süzgeci bellekte. */
        var okutmalar = db.Query(@"
SELECT personel_kodu AS kod, CAST(gecis_zamani AS DATE) AS gun,
       MIN(gecis_zamani) AS giris, MAX(gecis_zamani) AS cikis, COUNT(*) AS adet
FROM KRY_VARDIYA
WHERE gecis_zamani >= @bas AND gecis_zamani < @son
GROUP BY personel_kodu, CAST(gecis_zamani AS DATE)",
                new { bas, son = son.AddDays(1) })
            .Where(x => kodlar.Contains(K((string)x.kod)))
            .ToDictionary(x => $"{K((string)x.kod)}|{((DateTime)x.gun):yyyy-MM-dd}", x => x);

        var izinler = db.Query(@"
SELECT personel_kodu AS kod, tur, cikis_tarihi AS cikis,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @son
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @bas", new { bas, son })
            .Where(x => kodlar.Contains(K((string)x.kod)))
            .ToList();

        /* Onay sürecindeki tam gün talepler de izinli görünür (23.10.2026):
           yönetici onaylamadan önce de personelin neden okutmadığı belli olsun */
        try
        {
            izinler.AddRange(db.Query(@"
SELECT personel_kodu AS kod, tur, cikis_tarihi AS cikis, donus_tarihi AS son
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND izin_id IS NULL AND durum <> N'Reddedildi'
  AND cikis_tarihi <= @son AND donus_tarihi >= @bas
  AND (yarim_gun IS NULL OR yarim_gun = N'')
  AND (baslangic_saat IS NULL OR baslangic_saat = N'')", new { bas, son })
                .Where(x => kodlar.Contains(K((string)x.kod))));
        }
        catch
        {
            /* talep tablosu okunamazsa yalnızca kayıtlı izinler */
        }

        /* Devamsızlık (23.10.2026): birim yöneticisinin girdiği gün */
        var devamsiz = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var x in db.Query(@"
SELECT personel_kodu AS kod, tarih FROM KRY_DEVAMSIZLIK
WHERE iptal = 0 AND tarih BETWEEN @bas AND @son", new { bas = bas.Date, son = son.Date }))
                devamsiz.Add($"{K((string)x.kod)}|{((DateTime)x.tarih):yyyy-MM-dd}");
        }
        catch
        {
            /* tablo henüz yoksa devamsızlık yok */
        }

        var haftalik = db.Query(@"
SELECT personel_kodu AS kod, gun FROM KRY_HAFTALIK_IZIN
WHERE gun IS NOT NULL AND durum = N'onaylandi'")
            .Where(x => kodlar.Contains(K((string)x.kod)))
            .ToDictionary(x => K((string)x.kod), x => (int)x.gun);

        /* Vardiya planındaki haftalık izin günleri: yönetici planda veriyor.
           Kişinin o hafta planı varsa sabit gün yerine plan geçerli; aksi
           hâlde plan başka gün verdiğinde iki gün birden izinli sayılırdı. */
        var planSatirlari = db.Query(@"
SELECT personel_kodu AS kod, gun, hafta, tur FROM KRY_VARDIYA_PLAN
WHERE gun BETWEEN @bas AND @son", new { bas = VardiyaPlanController.HaftaBasi(bas), son = son.Date.AddDays(6) })
            .ToList();

        var planIzin = planSatirlari
            .Where(x => (string)x.tur == "izin")
            .Select(x => $"{K((string)x.kod)}|{((DateTime)x.gun):yyyy-MM-dd}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var planliHaftalar = planSatirlari
            .Select(x => $"{K((string)x.kod)}|{((DateTime)x.hafta):yyyy-MM-dd}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var tatiller = db.Query<DateTime>(@"
SELECT tarih FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih BETWEEN @bas AND @son",
                new { bas, son })
            .Select(x => x.Date).ToHashSet();

        /* Personel kartından girilen sağlık raporları (03.10.2026). Rapor
           izinleri yukarıdaki izin kayıtlarından zaten geliyor; burada
           yalnızca kart kayıtları okunuyor. */
        var raporlar = new RaporluServisi(_vt).Kayitlar(bas, son, izinDahil: false)
            .Where(x => kodlar.Contains(K(x.PersonelKodu)))
            .ToList();

        var sonuc = new Dictionary<string, List<Gun>>(StringComparer.OrdinalIgnoreCase);

        foreach (var p in kisiler)
        {
            var kod = K(p.PersonelKodu);
            var liste = new List<Gun>();

            for (var g = bas.Date; g <= son.Date; g = g.AddDays(1))
            {
                if (okutmalar.TryGetValue($"{kod}|{g:yyyy-MM-dd}", out var o))
                {
                    var adet = (int)o.adet;
                    /* Tek okutmada çıkış yok: kişi hâlâ içeride */
                    DateTime? cikis = adet > 1 ? (DateTime)o.cikis : null;

                    liste.Add(new Gun(g, "okuttu", (DateTime)o.giris, cikis, adet, null));
                    continue;
                }

                var izin = izinler.FirstOrDefault(x =>
                    K((string)x.kod) == kod && (DateTime)x.cikis <= g && (DateTime)x.son >= g);

                if (izin is not null)
                    liste.Add(new Gun(g, "izinli", null, null, 0, (string)izin.tur));
                /* Raporlu personel "okutmadı" sayılmaz. Mağazalardaki
                   uygulama yeni bir durum tanımıyor (bilinmeyeni okutmadı
                   diye boyuyor); muaf gibi izinli + "Raporlu" dönüyor,
                   listede "Raporlu" yazıyor ve oranı düşürmüyor. */
                else if (raporlar.Any(x => K(x.PersonelKodu) == kod && x.Kapsar(g)))
                    liste.Add(new Gun(g, "izinli", null, null, 0, RaporluServisi.Etiket));
                else if (planIzin.Contains($"{kod}|{g:yyyy-MM-dd}")
                         || (haftalik.TryGetValue(kod, out var hg) && (DayOfWeek)hg == g.DayOfWeek
                             && !planliHaftalar.Contains($"{kod}|{VardiyaPlanController.HaftaBasi(g):yyyy-MM-dd}")))
                    liste.Add(new Gun(g, "haftalik", null, null, 0, null));
                else if (tatiller.Contains(g))
                    liste.Add(new Gun(g, "tatil", null, null, 0, null));
                /* Okutmadan muaf personel (Okutma Kuralları) "okutmadı"
                   sayılmaz. Mağazalardaki uygulama "muaf" durumunu
                   tanımıyor (bilinmeyeni okutmadı diye boyuyor); bu
                   yüzden izinli + "Muaf" olarak dönüyor, listede "Muaf"
                   yazıyor ve okutma oranını düşürmüyor. */
                else if (OkutmaKurallari.MuafMi(_vt, kod, g))
                    liste.Add(new Gun(g, "izinli", null, null, 0, "Muaf"));
                /* Devamsız: eski uygulama "okutmadı" görür, 1.9 "Devamsız" yazar */
                else if (devamsiz.Contains($"{kod}|{g:yyyy-MM-dd}"))
                    liste.Add(new Gun(g, "okutmadi", null, null, 0, Devamsiz));
                else
                    liste.Add(new Gun(g, "okutmadi", null, null, 0, null));
            }

            sonuc[kod] = liste;
        }

        return sonuc;
    }

    /* ====================================================================== */
    /* Puantaj                                                                */
    /* ====================================================================== */

    /// <summary>
    /// Kullanıcının puantaj kapsamı: bölge (mağaza kartları) ya da ekip
    /// (doğrudan liste). İkisi de değilse modül boş.
    /// </summary>
    [HttpGet("Puantaj/Kapsam")]
    public IActionResult PuantajKapsam()
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        /* Ekibim kuralı (09.10.2026): İK puantajı kapattıysa yalnızca kendi */
        var kural = _kurallar.Bul(ben.PersonelKodu);
        if (kural is { Puantaj: false })
            return Ok(new { tur = "kendi", kisiSayisi = 0, sicil = ben.PersonelKodu });

        var subeler = _ekip.BolgeSubeleri(ben);

        if (subeler.Count > 0)
            return Ok(new { tur = "bolge", subeler, eslesmeyenler = _ekip.EslesmeyenSubeler(ben), sicil = ben.PersonelKodu });

        var ekip = _kurallar.Uygula(kural, ben, _ekip.SorumluOlduklari(ben), _ekip.Aktifler());

        /* Yönetici değilse yalnızca kendi çizelgesi */
        return Ok(new
        {
            tur = ekip.Count > 0 ? "ekip" : "kendi",
            kisiSayisi = ekip.Count,
            sicil = ben.PersonelKodu,
        });
    }

    /// <summary>Bölge müdürü için mağaza kartları: bir gündeki okutma durumu.</summary>
    [HttpGet("Puantaj/Subeler")]
    public IActionResult PuantajSubeler([FromQuery] DateTime? tarih)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        var subeler = _ekip.BolgeSubeleri(ben);
        if (subeler.Count == 0) return Ok(new { kartlar = Array.Empty<object>() });

        var gun = (tarih ?? DateTime.Today).Date;

        var kisiler = _ekip.Aktifler()
            .Where(x => subeler.Any(s => PersonelKaynagiServisi.Benziyor(s, x.IsGrubu ?? "")))
            .ToList();

        var durum = Durumlar(kisiler, gun, gun);

        var kartlar = subeler.Select(s =>
        {
            var burada = kisiler.Where(x => PersonelKaynagiServisi.Benziyor(s, x.IsGrubu ?? "")).ToList();
            var gunler = burada.Select(x => durum[K(x.PersonelKodu)][0]).ToList();

            var okuttu = gunler.Count(x => x.Durum == "okuttu");
            var izinli = gunler.Count(x => x.Durum is "izinli" or "haftalik" or "tatil");
            var beklenen = burada.Count - izinli;

            return new
            {
                sube = s,
                toplam = burada.Count,
                okuttu,
                izinli,
                okutmadi = gunler.Count(x => x.Durum == "okutmadi"),
                muaf = gunler.Count(x => x.IzinTuru == "Muaf"),
                raporlu = gunler.Count(x => x.IzinTuru == RaporluServisi.Etiket),

                /* Oran izinliler çıkarılarak: izin günündeki personel oranı
                   düşürmemeli. */
                oran = beklenen > 0 ? Math.Round(100m * okuttu / beklenen) : 100m,
            };
        })
        .OrderBy(x => x.oran)
        .ToList();

        return Ok(new { tarih = gun, kartlar });
    }

    /// <summary>
    /// Bir gündeki personel listesi: bölge müdürü için seçilen mağaza,
    /// yönetici için kendi ekibi.
    /// </summary>
    [HttpGet("Puantaj/Liste")]
    public IActionResult PuantajListe([FromQuery] DateTime? tarih, [FromQuery] string sube = null)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        var gun = (tarih ?? DateTime.Today).Date;

        var kural = _kurallar.Bul(ben.PersonelKodu);
        if (kural is { Puantaj: false })
            return StatusCode(403, new { hata = "Puantaj çizelgesini görme yetkiniz kapalı." });

        List<PersonelKaydi> kisiler;

        if (!string.IsNullOrWhiteSpace(sube))
        {
            /* Şube yalnızca bölge müdürünün kendi bölgesindeyse */
            var bolge = _ekip.BolgeSubeleri(ben);

            if (!bolge.Any(x => PersonelKaynagiServisi.Benziyor(x, sube)))
                return StatusCode(403, new { hata = "Bu mağaza sorumluluğunuzda değil." });

            kisiler = _ekip.Aktifler()
                .Where(x => PersonelKaynagiServisi.Benziyor(sube, x.IsGrubu ?? ""))
                .ToList();
        }
        else
        {
            kisiler = _kurallar.Uygula(kural, ben, _ekip.SorumluOlduklari(ben), _ekip.Aktifler());

            /* Yönetici kendi satırını da görsün (23.10.2026) */
            if (kisiler.Count > 0 && !kisiler.Any(x => K(x.PersonelKodu) == K(ben.PersonelKodu)))
                kisiler.Insert(0, ben);
        }

        var durum = Durumlar(kisiler, gun, gun);

        var satirlar = kisiler.Select(p =>
        {
            var d = durum[K(p.PersonelKodu)][0];

            return new
            {
                sicil = p.PersonelKodu,
                adSoyad = AdSoyad(p),
                pozisyon = p.Pozisyon,
                sube = p.IsGrubu,
                durum = d.Durum,
                giris = d.Giris,
                cikis = d.Cikis,
                okutma = d.Okutma,
                izinTuru = d.IzinTuru,
            };
        })
        /* Önce okutmayanlar: yöneticinin aradığı onlar */
        .OrderBy(x => x.durum == "okutmadi" ? 0 : x.durum == "okuttu" ? 1 : 2)
        .ThenBy(x => x.adSoyad)
        .ToList();

        var izinli = satirlar.Count(x => x.durum is "izinli" or "haftalik" or "tatil");
        var okuttu = satirlar.Count(x => x.durum == "okuttu");
        var beklenen = satirlar.Count - izinli;

        return Ok(new
        {
            tarih = gun,
            ozet = new
            {
                toplam = satirlar.Count,
                okuttu,
                okutmadi = satirlar.Count(x => x.durum == "okutmadi"),
                izinli,
                muaf = satirlar.Count(x => x.izinTuru == "Muaf"),
                raporlu = satirlar.Count(x => x.izinTuru == RaporluServisi.Etiket),
                oran = beklenen > 0 ? Math.Round(100m * okuttu / beklenen) : 100m,
            },
            satirlar,
        });
    }

    /* ====================================================================== */
    /* Ekibim                                                                 */
    /* ====================================================================== */

    /// <summary>
    /// Ekip arkadaşları: yalnızca ad, pozisyon ve (yöneticiyse) ayrıntı
    /// açılabilir mi bilgisi.
    /// </summary>
    [HttpGet("Ekibim")]
    public IActionResult Ekibim()
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized();

        /* Ekibim kuralı (09.10.2026): İK'nın eklediği / gizlediği kişiler */
        var kural = _kurallar.Bul(ben.PersonelKodu);
        var aktifler = _ekip.Aktifler();

        var kisiler = _kurallar.Uygula(kural, ben, _ekip.EkipArkadaslari(ben), aktifler);
        var sorumlu = _ekip.SorumluOlduklari(ben).Select(x => K(x.PersonelKodu)).ToHashSet();

        if (kural is not null)
        {
            if (kural.Ayrinti)
                foreach (var p in _kurallar.Eklenenler(kural, ben, aktifler)) sorumlu.Add(K(p.PersonelKodu));
            foreach (var g in kural.Gizlenenler) sorumlu.Remove(K(g));
        }

        /* Bölge müdürü (06.10.2026): şubelerindeki bütün personel, şubeye
           göre sıralı; mağaza müdürleri şubesinin başında. Yayındaki
           uygulama (1.5) şubeye göre gruplamıyor: şube adı pozisyonun
           önüne yazılıyor, arama kutusuna şube adı yazınca o şube
           süzülüyor. 1.6 şube kartlarını sube alanından kuruyor. */
        var bolgeSubeleri = _ekip.BolgeSubeleri(ben);

        if (bolgeSubeleri.Count > 0)
        {
            var bolgeKisileri = _ekip.BolgePersoneli(ben);
            var tr = StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true);

            var bolgedeMi = bolgeKisileri.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var k in bolgedeMi) sorumlu.Add(k);

            var sirali = bolgeKisileri
                .OrderBy(x => (x.IsGrubu ?? "").Trim(), tr)
                .ThenBy(x => _ekip.SubeYoneticisiMi(x) ? 0 : PersonelKaynagiServisi.DuzAnahtar(x.Pozisyon).Contains("mudur") ? 1 : 2)
                .ThenBy(x => x.Ad, tr).ThenBy(x => x.Soyad, tr)
                .Concat(kisiler.Where(x => !bolgedeMi.Contains(K(x.PersonelKodu))))
                .ToList();

            /* Bölge listesine de kural: yalnız seçilenlerde bölge listesi boşalıyor */
            if (kural is not null)
            {
                var gizli = kural.Gizlenenler.Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);
                var ekK = _kurallar.Eklenenler(kural, ben, aktifler).Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);
                sirali = sirali.Where(x => !gizli.Contains(K(x.PersonelKodu)) && (!kural.YalnizSecilenler || ekK.Contains(K(x.PersonelKodu)))).ToList();
                foreach (var g in gizli) sorumlu.Remove(g);
            }

            /* 19.10.2026: bölgesi olan yöneticiye İK'nın eklediği kişiler
               (ör. GMY'ye genel merkezden kişiler) bölge dışındaysa
               uygulamada görünmüyordu: uygulama yalnızca "subeler"
               listesindeki kartları gösteriyor. Bölge dışı kişiler kendi
               iş yerleri adıyla ayrı kart olarak eklenir. */
            static string Grup(PersonelKaydi p) =>
                string.IsNullOrWhiteSpace(p.IsGrubu) ? "DİĞER" : p.IsGrubu.Trim();

            var ekGruplar = sirali
                .Where(x => !bolgedeMi.Contains(K(x.PersonelKodu)))
                .GroupBy(Grup, StringComparer.OrdinalIgnoreCase)
                .Where(g => !bolgeSubeleri.Any(s => string.Equals(s.Trim(), g.Key, StringComparison.OrdinalIgnoreCase)))
                .OrderBy(g => g.Key, tr)
                .Select(g => new
                {
                    ad = g.Key,
                    kisi = g.Count(),
                    mudur = (string)null,
                    aciklama = "Ekibinize eklenen kişiler",
                });

            return Ok(new
            {
                yonetici = true,
                bolge = true,
                subeler = bolgeSubeleri.Select(s => new
                {
                    ad = s,
                    kisi = bolgeKisileri.Count(x => string.Equals((x.IsGrubu ?? "").Trim(), s.Trim(), StringComparison.OrdinalIgnoreCase)),
                    mudur = bolgeKisileri
                        .Where(x => string.Equals((x.IsGrubu ?? "").Trim(), s.Trim(), StringComparison.OrdinalIgnoreCase)
                                    && _ekip.SubeYoneticisiMi(x))
                        .Select(AdSoyad)
                        .FirstOrDefault(),
                    aciklama = (string)null,
                }).Concat(ekGruplar),
                kisiler = sirali.Select(p => new
                {
                    sicil = p.PersonelKodu,
                    adSoyad = AdSoyad(p),
                    pozisyon = bolgedeMi.Contains(K(p.PersonelKodu)) && !string.IsNullOrWhiteSpace(p.IsGrubu)
                        ? $"{p.IsGrubu.Trim()} · {p.Pozisyon}"
                        : p.Pozisyon,
                    gorev = p.Pozisyon,
                    sube = bolgedeMi.Contains(K(p.PersonelKodu)) ? p.IsGrubu : Grup(p),
                    yonetici = _ekip.SubeYoneticisiMi(p),
                    ayrinti = sorumlu.Contains(K(p.PersonelKodu)),
                }),
            });
        }

        return Ok(new
        {
            yonetici = sorumlu.Count > 0,
            /* Puantaj ve vardiya planı görünürlüğü (1.7 kullanır; eski sürüm uçtan engelleniyor) */
            puantaj = kural?.Puantaj ?? true,
            vardiyaPlani = kural?.VardiyaPlani ?? true,
            kisiler = kisiler.Select(p => new
            {
                sicil = p.PersonelKodu,
                adSoyad = AdSoyad(p),
                pozisyon = p.Pozisyon,
                sube = p.IsGrubu,

                /* Ayrıntı yalnızca sorumlu olunan kişide açılıyor */
                ayrinti = sorumlu.Contains(K(p.PersonelKodu)),
            }),
        });
    }

    /// <summary>
    /// Bir günün bütün okutmaları: saat saat giriş/çıkış ve kaynağı.
    /// Takvimde güne dokununca açılıyor; "kaça okutmuş" sorusunun cevabı
    /// yalnızca ilk ve son okutmayla verilemiyordu.
    /// </summary>
    [HttpGet("Kisi/{sicil}/Gun")]
    public IActionResult KisiGun(string sicil, [FromQuery] DateTime tarih)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!AyrintiGorur(ben, hedef))
            return StatusCode(403, new { hata = "Bu personelin ayrıntısını görme yetkiniz yok." });

        var gun = tarih.Date;

        using var db = _vt.Baglanti();

        var okutmalar = db.Query(@"
SELECT gecis_zamani AS zaman, tur, ISNULL(kaynak, N'mobil') AS kaynak,
       sube_adi AS subeAdi, konum_dogru AS konumDogru
FROM KRY_VARDIYA
WHERE personel_kodu = @kod AND gecis_zamani >= @gun AND gecis_zamani < @ertesi
ORDER BY gecis_zamani",
                new { kod = hedef.PersonelKodu.Trim(), gun, ertesi = gun.AddDays(1) })
            .Select(x => new
            {
                zaman = (DateTime)x.zaman,
                tur = (string)x.tur,
                kaynak = (string)x.kaynak,
                subeAdi = (string)x.subeAdi,
                konumDogru = (bool)x.konumDogru,
            })
            .ToList();

        var durum = Durumlar(new List<PersonelKaydi> { hedef }, gun, gun)[K(hedef.PersonelKodu)][0];

        /* Toplam süre: ilk ve son okutma arası. Ara çıkışlar (öğle molası)
           düşülmüyor; okutma çiftleri her zaman düzgün gelmiyor. */
        int? dakika = okutmalar.Count > 1
            ? (int)(okutmalar[^1].zaman - okutmalar[0].zaman).TotalMinutes
            : null;

        return Ok(new
        {
            tarih = gun,
            adSoyad = AdSoyad(hedef),
            durum = durum.Durum,
            izinTuru = durum.IzinTuru,
            okutma = okutmalar.Count,
            ilk = okutmalar.Count > 0 ? okutmalar[0].zaman : (DateTime?)null,
            son = okutmalar.Count > 1 ? okutmalar[^1].zaman : (DateTime?)null,
            dakika,
            okutmalar,
        });
    }

    /// <summary>
    /// Yöneticinin gördüğü personel ayrıntısı: bugün izinli mi, bakiye,
    /// planlı izinler, son günlerin puantajı ve okutmadığı günler.
    /// </summary>
    /// <param name="bas">İsteğe bağlı başlangıç (12.10.2026, 1.7): personel
    /// puantajında tarih değiştirerek geçmişe bakabiliyor. Verilmezse son
    /// <paramref name="gun"/> gün.</param>
    /// <param name="bit">İsteğe bağlı bitiş; bugünden ileri olamaz. Aralık en çok 93 gün.</param>
    [HttpGet("Kisi/{sicil}")]
    public IActionResult KisiAyrinti(string sicil, [FromQuery] int gun = 30,
        [FromQuery] DateTime? bas = null, [FromQuery] DateTime? bit = null)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!AyrintiGorur(ben, hedef))
            return StatusCode(403, new { hata = "Bu personelin ayrıntısını görme yetkiniz yok." });

        gun = Math.Clamp(gun, 7, 90);

        DateTime son, ilk;

        if (bas.HasValue || bit.HasValue)
        {
            son = (bit ?? DateTime.Today).Date;
            if (son > DateTime.Today) son = DateTime.Today;

            ilk = (bas ?? son.AddDays(-29)).Date;
            if (ilk > son) ilk = son;
            if ((son - ilk).TotalDays > 92) ilk = son.AddDays(-92);

            /* Çok eskiye gidilmesin: iki yıl */
            var enEski = DateTime.Today.AddYears(-2);
            if (ilk < enEski) ilk = enEski;
            if (son < ilk) son = ilk;
        }
        else
        {
            son = DateTime.Today;
            ilk = son.AddDays(-(gun - 1));
        }

        var kodK = K(hedef.PersonelKodu);
        var gunler = Durumlar(new List<PersonelKaydi> { hedef }, ilk, son)[kodK];

        /* "Bugün" kutusu aralık bugünü içermese de bugünü gösteriyor */
        var bugunGun = son == DateTime.Today
            ? gunler[^1]
            : Durumlar(new List<PersonelKaydi> { hedef }, DateTime.Today, DateTime.Today)[kodK][0];

        using var db = _vt.Baglanti();

        var kod = hedef.PersonelKodu.Trim();

        /* Fazla mesai (12.10.2026, 1.7): personel kendi çizelgesinde yalnızca
           onay süreci tamamlanmış (İK onaylı) fazla mesailerini görüyor;
           yönetici süreçtekileri de görüyor. */
        var kendisi = K(ben.PersonelKodu) == kodK;
        List<FmSatiri> fazlaMesailer;
        try
        {
            fazlaMesailer = db.Query<FmSatiri>(@"
SELECT id AS Id, tarih AS Tarih, baslangic AS Baslangic, bitis AS Bitis, sure_dk AS SureDk,
       aciklama AS Aciklama, durum AS Durum, talep_eden_ad AS Giren, karar_tarihi AS KararTarihi
FROM KRY_FAZLA_MESAI
WHERE LTRIM(RTRIM(personel_kodu)) = @kod AND tarih >= @ilk AND tarih <= @son
  AND durum IN @durumlar
ORDER BY tarih DESC, id DESC",
                new
                {
                    kod,
                    ilk,
                    son,
                    durumlar = kendisi
                        ? new[] { "onaylandi" }
                        : new[] { "onaylandi", "form", "ust", "bekliyor" },
                }).ToList();
        }
        catch
        {
            fazlaMesailer = new();
        }

        var fmGun = fazlaMesailer
            .Where(x => x.Durum == "onaylandi")
            .GroupBy(x => x.Tarih.Date)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.SureDk));

        var bakiye = db.QueryFirstOrDefault(@"
SELECT baslangic AS hakedilen, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod", new { kod });

        var kullanim = db.QueryFirstOrDefault(@"
SELECT
    ISNULL(SUM(CASE WHEN cikis_tarihi <= CAST(SYSDATETIME() AS DATE) THEN gun ELSE 0 END), 0) AS kullanilan,
    ISNULL(SUM(CASE WHEN cikis_tarihi >  CAST(SYSDATETIME() AS DATE) THEN gun ELSE 0 END), 0) AS planli
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1", new { kod });

        decimal hakedilen = bakiye is null ? 0m : (decimal)bakiye.hakedilen;
        decimal devir = bakiye is null ? 0m : (decimal)bakiye.devir;
        decimal aktarilan = bakiye is null ? 0m : (decimal)bakiye.aktarilan;
        decimal kullanilan = aktarilan + (decimal)(kullanim?.kullanilan ?? 0m);
        decimal planli = (decimal)(kullanim?.planli ?? 0m);

        /* Bugün ve ileri tarihli izinler */
        var izinler = db.Query(@"
SELECT tur, cikis_tarihi AS cikis, donus_tarihi AS donus, gun
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND donus_tarihi >= CAST(SYSDATETIME() AS DATE)
ORDER BY cikis_tarihi", new { kod })
            .Select(x => new
            {
                tur = (string)x.tur,
                cikis = (DateTime)x.cikis,
                donus = (DateTime)x.donus,
                gun = (decimal)x.gun,
            })
            .ToList();

        var bugunIzin = izinler.FirstOrDefault(x => x.cikis <= DateTime.Today && x.donus >= DateTime.Today);

        var bekleyen = db.QueryFirstOrDefault(@"
SELECT TOP 1 tur, cikis_tarihi AS cikis, donus_tarihi AS donus, durum
FROM KRY_IZIN_TALEP
WHERE personel_kodu = @kod AND iptal = 0 AND durum NOT IN (N'Onaylandı', N'Reddedildi')
ORDER BY olusturma DESC", new { kod });

        var haftalik = db.ExecuteScalar<int?>(@"
SELECT gun FROM KRY_HAFTALIK_IZIN
WHERE personel_kodu = @kod AND durum = N'onaylandi'", new { kod });

        return Ok(new
        {
            personel = new
            {
                sicil = hedef.PersonelKodu,
                adSoyad = AdSoyad(hedef),
                pozisyon = hedef.Pozisyon,
                sube = hedef.IsGrubu,
                girisTarihi = hedef.GirisTarihi,
                haftalikIzinGunu = haftalik,
            },
            bugun = new
            {
                durum = bugunGun.Durum,
                giris = bugunGun.Giris,
                izin = bugunIzin,
            },
            aralik = new { bas = ilk, bit = son },
            bakiye = new
            {
                hakedilen, devir, kullanilan, planli,
                kalan = hakedilen + devir - kullanilan - planli,
            },
            planliIzinler = izinler.Where(x => x.cikis > DateTime.Today),
            bekleyenTalep = bekleyen,
            gunler = gunler.Select(x => new
            {
                tarih = x.Tarih,
                durum = x.Durum,
                giris = x.Giris,
                cikis = x.Cikis,
                izinTuru = x.IzinTuru,
                fazlaMesaiDk = fmGun.TryGetValue(x.Tarih.Date, out var dk) ? dk : 0,
            }),
            ozet = new
            {
                okuttu = gunler.Count(x => x.Durum == "okuttu"),
                okutmadi = gunler.Count(x => x.Durum == "okutmadi"),
                izinli = gunler.Count(x => x.Durum == "izinli"),
                fazlaMesaiDk = fmGun.Values.Sum(),
            },
            fazlaMesailer = fazlaMesailer.Select(x => new
            {
                id = x.Id,
                tarih = x.Tarih,
                baslangic = x.Baslangic,
                bitis = x.Bitis,
                sureDk = x.SureDk,
                sure = FazlaMesaiAkisi.KisaSure(x.SureDk),
                aciklama = x.Aciklama,
                onayli = x.Durum == "onaylandi",
                durumAdi = x.Durum switch
                {
                    "onaylandi" => "Onaylandı",
                    "form" => "Birim yöneticisi onayında",
                    "ust" => "Üst yönetici onayında",
                    "bekliyor" => "İK onayında",
                    _ => x.Durum,
                },
                giren = x.Giren,
            }),
        });
    }

    private sealed class FmSatiri
    {
        public int Id { get; set; }
        public DateTime Tarih { get; set; }
        public string Baslangic { get; set; }
        public string Bitis { get; set; }
        public int SureDk { get; set; }
        public string Aciklama { get; set; }
        public string Durum { get; set; }
        public string Giren { get; set; }
        public DateTime? KararTarihi { get; set; }
    }
}

using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel kartı › Performans ve değerlendirme (06.10.2026).
///
/// <para>
/// <b>Personel:</b> genel puan = bir önceki ayın performans notu (0–100)
/// ile oryantasyondaki yönetici değerlendirmelerinin ortalamasının
/// (1–5 → ×20) ortalaması. Genel merkez ve Akçaburgaz Depo personelinde
/// aylık performans notu yok: yalnızca oryantasyon. Bölge müdürlerinin
/// performans notu var (Z.MERKEZ BURO satırı).
/// </para>
///
/// <para>
/// <b>Mağaza müdürü / bölge müdürü:</b> genel puan = performans notu ile
/// "ekibinin gözünden" puanının ortalaması. Ekibinin gözünden: sorumlu
/// olduğu personelin oryantasyon (çalışan) formunda yöneticiyle ilgili
/// sorulara ("Yöneticimden memnunum", "Yöneticime güveniyorum"…) verdiği
/// puanların ortalaması. Bir formun hangi yöneticiye ait olduğu aynı kişi
/// ve aşamanın yönetici formunu kimin doldurduğundan; o yoksa formun
/// tarihinde şubenin mağaza müdüründen bulunuyor.
/// </para>
///
/// <para>
/// <b>Yönetici kaynaklı çıkışlar:</b> çıkış mülakatında neden grubu
/// "Yönetici ve iletişim" olanlar, ayrıldığı tarihte şubenin mağaza
/// müdürüne bağlanıyor. O tarihteki müdür aylık performans kayıtlarından
/// (şube + görev, ay ay) okunuyor. Şimdilik genel puana katılmıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DegerlendirmeController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly EkipServisi _ekip;
    private readonly IzinFormuServisi _izinFormu;
    private readonly ILogger<DegerlendirmeController> _kayit;

    public DegerlendirmeController(VeritabaniServisi vt, PersonelKaynagiServisi kaynak, EkipServisi ekip,
        IzinFormuServisi izinFormu, ILogger<DegerlendirmeController> kayit)
    {
        _vt = vt;
        _kaynak = kaynak;
        _ekip = ekip;
        _izinFormu = izinFormu;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string A(string s) => PersonelKaynagiServisi.DuzAnahtar(s);

    private static readonly Dictionary<string, (string Ad, int Sira)> Asamalar = new()
    {
        ["7g"] = ("7. gün", 1),
        ["2a"] = ("2. ay", 2),
        ["6a"] = ("6. ay", 3),
        ["1y"] = ("1. yıl", 4),
    };

    private static string Etiket(decimal p) =>
        p >= 85 ? "Çok iyi" : p >= 70 ? "İyi" : p >= 55 ? "Gelişmeli" : "Zayıf";

    /* ==================================================================== */
    /* Oryantasyon formları (5 dakika bellekte)                             */
    /* ==================================================================== */

    private sealed class FormKaydi
    {
        public string Kod { get; init; }
        public string Asama { get; init; }
        public string Tur { get; init; }
        public DateTime Tarih { get; init; }
        public string Sube { get; init; }
        public string AdSoyad { get; init; }

        /// <summary>Yönetici formunu dolduran (sicil); çalışan formunda null</summary>
        public string YoneticiKodu { get; set; }

        /// <summary>Yönetici formunu dolduranın adı (kayıttaki)</summary>
        public string YoneticiAdi { get; init; }

        public UyumAnaliz.Form Form { get; init; }
    }

    private static (DateTime zaman, List<FormKaydi> liste)? _formBellek;
    private static readonly object _formKilit = new();

    private List<FormKaydi> Formlar()
    {
        lock (_formKilit)
            if (_formBellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromMinutes(5)) return b.liste;

        var sonuc = new List<FormKaydi>();

        using var db = _vt.Baglanti();

        foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, asama, dolduruldu, sube_adi AS sube, ad_soyad AS adSoyad, cevaplar_json AS json
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'calisan' AND dolduruldu IS NOT NULL AND cevaplar_json IS NOT NULL"))
        {
            var form = UyumAnaliz.Formlar((string)r.json).FirstOrDefault();
            if (form is null || string.IsNullOrWhiteSpace((string)r.kod)) continue;

            sonuc.Add(new FormKaydi
            {
                Kod = K((string)r.kod), Asama = (string)r.asama, Tur = "calisan", Tarih = (DateTime)r.dolduruldu,
                Sube = (string)r.sube, AdSoyad = (string)r.adSoyad, Form = form,
            });
        }

        Dictionary<int, string> tahmin;

        try
        {
            tahmin = UyumController.YoneticiKisiTahmini(db);
        }
        catch
        {
            tahmin = new();
        }

        foreach (var r in db.Query(@"
SELECT id, asama, dolduruldu, sube_adi AS sube, ad_soyad AS adSoyad, yonetici_kodu AS yoneticiKodu,
       kanal, cevaplar_json AS json
FROM KRY_UYUM_ANKET
WHERE test_mi = 0 AND tur = 'yonetici' AND dolduruldu IS NOT NULL AND cevaplar_json IS NOT NULL"))
        {
            foreach (var form in UyumAnaliz.Formlar((string)r.json))
            {
                var kod = form.PersonelKodu;

                if (string.IsNullOrWhiteSpace(kod) && tahmin.TryGetValue((int)r.id, out var t)) kod = t;
                if (string.IsNullOrWhiteSpace(kod)) continue;

                sonuc.Add(new FormKaydi
                {
                    Kod = K(kod), Asama = (string)r.asama, Tur = "yonetici", Tarih = (DateTime)r.dolduruldu,
                    Sube = (string)r.sube,
                    YoneticiKodu = string.IsNullOrWhiteSpace((string)r.yoneticiKodu) ? null : K((string)r.yoneticiKodu),
                    /* Uygulama satırında ad_soyad yöneticinin adı; eski SMS satırında da
                       gönderimin muhatabı (mağaza yöneticisi) */
                    YoneticiAdi = (string)r.adSoyad,
                    Form = form,
                });
            }
        }

        /* Aynı kişi + aşama + tür için en son doldurulan */
        sonuc = sonuc
            .GroupBy(x => $"{x.Kod}|{x.Asama}|{x.Tur}")
            .Select(g => g.OrderByDescending(x => x.Tarih).First())
            .ToList();

        lock (_formKilit) _formBellek = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    /// <summary>Çalışan formundaki "yöneticim" sorularının 5'lik ortalaması.</summary>
    private static (double? Puan, string Soru) YoneticiSorusu(UyumAnaliz.Form f)
    {
        var y = f.Yanitlar.Where(x => x.BesTaban is not null && A(x.Soru).Contains("yonetici")).ToList();

        return y.Count == 0 ? (null, null) : (Math.Round(y.Average(x => x.BesTaban.Value), 2), y[0].Soru);
    }

    /* ==================================================================== */
    /* Şubenin o aydaki mağaza müdürü (aylık performans kayıtları)          */
    /* ==================================================================== */

    private sealed record MudurSatiri(int Yil, int Ay, string Sube, string Sicil);

    private static (DateTime zaman, List<MudurSatiri> liste)? _mudurBellek;
    private static readonly object _mudurKilit = new();

    private List<MudurSatiri> Mudurler()
    {
        lock (_mudurKilit)
            if (_mudurBellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromMinutes(30)) return b.liste;

        var sonuc = new List<MudurSatiri>();

        try
        {
            var tum = _kaynak.TumPersonelleriGetir();
            var guidle = tum.Where(x => x.Guid is not null)
                .GroupBy(x => x.Guid.Value.ToString().ToUpperInvariant())
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Durum == 1).First().PersonelKodu);
            var tcyle = tum.Where(x => !string.IsNullOrWhiteSpace(x.KimlikNo))
                .GroupBy(x => x.KimlikNo.Trim())
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Durum == 1).First().PersonelKodu);

            using var db = _vt.PerformansBaglantisi();

            foreach (var r in db.Query(@"
SELECT d.yil, d.ay, d.sube_adi AS sube, p.per_erp_id AS guid, p.per_tckimlik_no AS tc
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari d
    JOIN [biDb].[dbo].Personel p ON p.per_id = d.per_id
WHERE d.yil >= @enEski AND d.gorev_adi LIKE N'MA%AZA M%D%R%' AND d.gorev_adi NOT LIKE N'%YARDIMCI%'",
                         new { enEski = DateTime.Today.Year - 2 }, commandTimeout: 120))
            {
                string sicil = null;
                string g = Convert.ToString((object)r.guid)?.Trim().ToUpperInvariant();
                string tc = Convert.ToString((object)r.tc)?.Trim();

                if (!string.IsNullOrWhiteSpace(g) && guidle.TryGetValue(g, out string s1)) sicil = s1;
                else if (!string.IsNullOrWhiteSpace(tc) && tcyle.TryGetValue(tc, out string s2)) sicil = s2;

                if (sicil is null) continue;

                sonuc.Add(new MudurSatiri((int)r.yil, (int)r.ay, ((string)r.sube ?? "").Trim(), K(sicil)));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Değerlendirme: aylık mağaza müdürü listesi okunamadı");
        }

        lock (_mudurKilit) _mudurBellek = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    /// <summary>Şubenin verilen tarihteki mağaza müdürü (sicil); o ay yoksa önceki iki ay.</summary>
    private string MudurAt(string sube, DateTime tarih)
    {
        if (string.IsNullOrWhiteSpace(sube)) return null;

        var liste = Mudurler();

        for (var i = 0; i <= 2; i++)
        {
            var d = tarih.AddMonths(-i);
            var aday = liste.FirstOrDefault(x => x.Yil == d.Year && x.Ay == d.Month
                                                 && (A(x.Sube) == A(sube) || PersonelKaynagiServisi.Benziyor(x.Sube, sube)));
            if (aday is not null) return aday.Sicil;
        }

        return null;
    }

    /* ==================================================================== */
    /* Performans notu                                                      */
    /* ==================================================================== */

    private object Performans(PersonelKaydi p, out decimal? puan)
    {
        puan = null;

        try
        {
            using var db = _vt.PerformansBaglantisi();

            var perId = db.ExecuteScalar<int?>(@"
SELECT TOP 1 per_id FROM [biDb].[dbo].Personel
WHERE (@guid IS NOT NULL AND per_erp_id = @guid) OR (@tc IS NOT NULL AND per_tckimlik_no = @tc)
ORDER BY CASE WHEN per_erp_id = @guid THEN 0 ELSE 1 END",
                new { guid = p.Guid?.ToString(), tc = string.IsNullOrWhiteSpace(p.KimlikNo) ? null : p.KimlikNo.Trim() });

            if (perId is null) return null;

            var once = DateTime.Today.AddMonths(-1);

            /* Bir önceki ay; o ay henüz hesaplanmadıysa son üç aydaki en yeni dönem */
            var r = db.QueryFirstOrDefault(@"
SELECT TOP 1 yil, ay, [MAĞAZA PERFORMANSI] AS magaza, [YETKİNLİK ÖLÇÜTLERİ TOPLAMI] AS yetkinlik,
       sirket_sirasi AS sirketSirasi, gorev_sirasi AS gorevSirasi, sube_adi AS sube, gorev_adi AS gorev
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
WHERE per_id = @perId AND (yil * 100 + ay) <= @son AND (yil * 100 + ay) >= @ilk
ORDER BY yil DESC, ay DESC",
                new { perId, son = once.Year * 100 + once.Month, ilk = once.AddMonths(-2).Year * 100 + once.AddMonths(-2).Month });

            if (r is null) return null;

            decimal m = r.magaza is null ? 0m : Convert.ToDecimal(r.magaza);
            decimal y = r.yetkinlik is null ? 0m : Convert.ToDecimal(r.yetkinlik);

            puan = Math.Round(m + y, 1);

            var yil = (int)r.yil;
            var ay = (int)r.ay;

            return new
            {
                yil,
                ay,
                birOncekiAy = yil == once.Year && ay == once.Month,
                puan,
                magaza = Math.Round(m, 1),
                yetkinlik = Math.Round(y, 1),
                sirketSirasi = (int?)r.sirketSirasi,
                gorevSirasi = (int?)r.gorevSirasi,
            };
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Değerlendirme: performans notu okunamadı");
            return null;
        }
    }

    /* ==================================================================== */
    /* Uç                                                                   */
    /* ==================================================================== */

    [HttpGet("Personel/{kod}")]
    public IActionResult Personel(string kod)
    {
        if (User.IsInRole("Personel")) return Forbid();

        var tum = _kaynak.TumPersonelleriGetir();
        var p = tum.Where(x => K(x.PersonelKodu) == K(kod))
            .OrderByDescending(x => x.Durum == 1)
            .FirstOrDefault();

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var sicil = K(p.PersonelKodu);

        /* Rol ve birim */
        var bolgeSubeleri = _ekip.BolgeSubeleri(p);
        var bolgeMuduru = bolgeSubeleri.Count > 0 || EkipServisi.BolgeMuduruMu(p.Pozisyon);
        var magazaMuduru = !bolgeMuduru && (_ekip.SubeYoneticisiMi(p) || YoneticiBulucu.MagazaMuduruMu(p.Pozisyon));

        bool merkez;

        try
        {
            merkez = _izinFormu.GenelMerkezMi(p, _izinFormu.FormAyari());
        }
        catch
        {
            merkez = A(p.IsGrubu).Contains("merkez");
        }

        var depo = A(p.IsGrubu).Contains("akcaburgaz") || A(p.IsGrubu).Contains("depo");

        /* Bölge müdürünün notu var; genel merkez ve depo personelinin yok */
        var perfYok = (merkez || depo) && !bolgeMuduru;

        decimal? perfPuan = null;
        var performans = perfYok ? null : Performans(p, out perfPuan);

        /* --------------------------------------------- kendi oryantasyonu */
        var formlar = Formlar();

        var kendi = formlar.Where(x => x.Kod == sicil).ToList();

        var asamalar = Asamalar.OrderBy(x => x.Value.Sira).Select(a =>
        {
            var y = kendi.FirstOrDefault(x => x.Asama == a.Key && x.Tur == "yonetici");
            var c = kendi.FirstOrDefault(x => x.Asama == a.Key && x.Tur == "calisan");

            if (y is null && c is null) return null;

            string degerlendiren = y?.YoneticiAdi;

            if (y?.YoneticiKodu is not null)
            {
                var yk = tum.FirstOrDefault(x => K(x.PersonelKodu) == y.YoneticiKodu);
                if (yk is not null) degerlendiren = $"{yk.Ad} {yk.Soyad}".Trim();
            }

            var (cy, cySoru) = c is null ? (null, null) : YoneticiSorusu(c.Form);

            return new
            {
                asama = a.Key,
                ad = a.Value.Ad,
                yonetici = y is null ? null : new
                {
                    tarih = y.Tarih,
                    puan = y.Form.Ortalama,
                    degerlendiren,
                    maddeler = y.Form.Yanitlar.Where(x => x.Sayi is not null)
                        .Select(x => new { soru = x.Soru, puan = x.Sayi, tur = x.Tur }),
                    secimler = y.Form.Yanitlar.Where(x => x.Sayi is null && x.Tur == "secim" && !string.IsNullOrWhiteSpace(x.Metin))
                        .Select(x => new { soru = x.Soru, yanit = x.Metin, aciklama = x.Aciklama }),
                    acik = y.Form.Yanitlar.Where(x => x.Tur == "acik" && !string.IsNullOrWhiteSpace(x.Metin))
                        .Select(x => new { soru = x.Soru, yanit = x.Metin }),
                },
                calisan = c is null ? null : new
                {
                    tarih = c.Tarih,
                    puan = c.Form.Ortalama,
                    yoneticiSorusu = cySoru,
                    yoneticiyePuan = cy,
                    acik = c.Form.Yanitlar.Where(x => x.Tur == "acik" && !string.IsNullOrWhiteSpace(x.Metin))
                        .Select(x => new { soru = x.Soru, yanit = x.Metin }),
                },
            };
        }).Where(x => x is not null).ToList();

        var yoneticiPuanlari = kendi.Where(x => x.Tur == "yonetici" && x.Form.Ortalama is not null)
            .Select(x => x.Form.Ortalama.Value).ToList();

        decimal? oryOrt5 = yoneticiPuanlari.Count == 0 ? null : (decimal)Math.Round(yoneticiPuanlari.Average(), 2);
        decimal? ory100 = oryOrt5 is null ? null : Math.Round(oryOrt5.Value * 20m, 1);

        /* --------------------------------------------- yönetici: ekibi */
        object ekip = null;
        decimal? ekip100 = null;
        object cikislar = null;

        if (magazaMuduru || bolgeMuduru)
        {
            var bolgeKume = bolgeSubeleri.Select(x => A(x)).ToHashSet();

            /* Formun yöneticisi: aynı kişi + aşamanın yönetici formunu dolduran;
               yoksa formun tarihinde şubenin mağaza müdürü (bölge için: şube bölgede mi) */
            bool Benim(FormKaydi c)
            {
                var y = formlar.FirstOrDefault(x => x.Kod == c.Kod && x.Asama == c.Asama && x.Tur == "yonetici");

                if (y?.YoneticiKodu is not null) return y.YoneticiKodu == sicil;

                if (bolgeMuduru)
                {
                    /* Bölge müdürünü mağaza müdürleri değerlendiriyor */
                    var kisi = tum.FirstOrDefault(x => K(x.PersonelKodu) == c.Kod);
                    var mudurMu = kisi is not null && (_ekip.SubeYoneticisiMi(kisi) || YoneticiBulucu.MagazaMuduruMu(kisi.Pozisyon));
                    return mudurMu && (bolgeKume.Contains(A(c.Sube)) || bolgeSubeleri.Any(s => PersonelKaynagiServisi.Benziyor(s, c.Sube ?? "")));
                }

                return MudurAt(c.Sube, c.Tarih) == sicil;
            }

            var ekipFormlari = formlar
                .Where(x => x.Tur == "calisan" && x.Kod != sicil && x.Tarih >= DateTime.Today.AddYears(-2))
                .Select(x => (f: x, p: YoneticiSorusu(x.Form)))
                .Where(x => x.p.Puan is not null && Benim(x.f))
                .OrderByDescending(x => x.f.Tarih)
                .ToList();

            if (ekipFormlari.Count > 0)
            {
                var ort5 = (decimal)Math.Round(ekipFormlari.Average(x => x.p.Puan.Value), 2);
                ekip100 = Math.Round(ort5 * 20m, 1);

                ekip = new
                {
                    puan5 = ort5,
                    puan = ekip100,
                    formAdet = ekipFormlari.Count,
                    kisiAdet = ekipFormlari.Select(x => x.f.Kod).Distinct().Count(),
                    asamalar = Asamalar.OrderBy(a => a.Value.Sira).Select(a =>
                    {
                        var l = ekipFormlari.Where(x => x.f.Asama == a.Key).ToList();
                        return new
                        {
                            asama = a.Key,
                            ad = a.Value.Ad,
                            soru = l.FirstOrDefault().p.Soru,
                            ort = l.Count == 0 ? (double?)null : Math.Round(l.Average(x => x.p.Puan.Value), 2),
                            adet = l.Count,
                        };
                    }),
                    formlar = ekipFormlari.Take(40).Select(x =>
                    {
                        var acik = x.f.Form.Yanitlar.FirstOrDefault(y => y.Tur == "acik" && !string.IsNullOrWhiteSpace(y.Metin));
                        return new
                        {
                            sicil = x.f.Kod,
                            adSoyad = x.f.AdSoyad ?? x.f.Form.AdSoyad,
                            sube = x.f.Sube,
                            asama = Asamalar.TryGetValue(x.f.Asama ?? "", out var aa) ? aa.Ad : x.f.Asama,
                            tarih = x.f.Tarih,
                            puan = x.p.Puan,
                            not = acik?.Metin,
                        };
                    }),
                };
            }

            /* ---------------------------------- yönetici kaynaklı çıkışlar */
            try
            {
                using var db = _vt.Baglanti();

                var satirlar = db.Query(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, sube_adi AS sube, gorev, giris_tarihi AS giris,
       cikis_tarihi AS cikis, cikis_nedeni AS neden, cikis_nedeni_aciklama AS aciklama, ozet
FROM KRY_CIKIS_MULAKAT
WHERE neden_grubu = N'Yönetici ve iletişim' AND cikis_tarihi >= @sinir
ORDER BY cikis_tarihi DESC", new { sinir = DateTime.Today.AddYears(-1) }).ToList();

                var bagli = satirlar.Select(r =>
                {
                    var cikis = (DateTime)r.cikis;
                    var sube = (string)r.sube;
                    var mudur = MudurAt(sube, cikis);

                    var bende = bolgeMuduru
                        ? bolgeKume.Contains(A(sube)) || bolgeSubeleri.Any(s => PersonelKaynagiServisi.Benziyor(s, sube ?? ""))
                        : mudur == sicil;

                    if (!bende) return null;

                    var mk = mudur is null ? null : tum.FirstOrDefault(x => K(x.PersonelKodu) == mudur);
                    var giris = (DateTime?)r.giris;
                    var gun = giris is DateTime g ? (int)(cikis - g).TotalDays : (int?)null;

                    return new
                    {
                        id = (int)r.id,
                        sicil = (string)r.kod,
                        adSoyad = (string)r.adSoyad,
                        gorev = (string)r.gorev,
                        sube,
                        cikisTarihi = cikis,
                        sure = gun is null ? null : gun >= 365 ? $"{gun / 365} yıl {gun % 365 / 30} ay" : $"{Math.Max(0, gun.Value / 30)} ay",
                        neden = (string)r.neden,
                        aciklama = (string)r.aciklama,
                        ozet = (string)r.ozet,
                        alinti = string.IsNullOrWhiteSpace((string)r.aciklama) ? (string)r.ozet ?? (string)r.neden : (string)r.aciklama,
                        mudur = mk is null ? null : $"{mk.Ad} {mk.Soyad}".Trim(),
                        baglanti = mudur is null
                            ? $"{sube} · {cikis:MMMM yyyy} için mağaza müdürü belirlenemedi"
                            : $"{sube} · {cikis.ToString("MMMM yyyy", new System.Globalization.CultureInfo("tr-TR"))} performans kaydında mağaza müdürü {(mk is null ? mudur : $"{mk.Ad} {mk.Soyad}".Trim())}",
                    };
                }).Where(x => x is not null).ToList();

                /* Oran: aynı şube(ler)den son 12 ayda ayrılan personel */
                var subeler = bolgeMuduru ? bolgeSubeleri : new List<string> { p.IsGrubu ?? "" };
                var toplamCikis = tum.Count(x => x.CikisTarihi is DateTime c && c >= DateTime.Today.AddYears(-1) && c <= DateTime.Today
                                                 && subeler.Any(s => A(s) == A(x.IsGrubu)));

                cikislar = new
                {
                    liste = bagli,
                    adet = bagli.Count,
                    toplamCikis,
                    oran = toplamCikis == 0 ? (decimal?)null : Math.Round(100m * bagli.Count / toplamCikis, 1),
                };
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Değerlendirme: çıkış mülakatları okunamadı");
            }
        }

        /* --------------------------------------------- genel puan */
        var parcalar = new List<(string Ad, decimal Puan)>();

        if (perfPuan is decimal pp) parcalar.Add(("performans notu", pp));

        if (magazaMuduru || bolgeMuduru)
        {
            if (ekip100 is decimal e) parcalar.Add(("ekibinin gözünden", e));
        }
        else if (ory100 is decimal o)
        {
            parcalar.Add(("oryantasyon yönetici değerlendirmesi", o));
        }

        decimal? genel = parcalar.Count == 0 ? null : Math.Round(parcalar.Average(x => x.Puan), 0);

        return Ok(new
        {
            sicil = p.PersonelKodu,
            rol = bolgeMuduru ? "bolgeMuduru" : magazaMuduru ? "magazaMuduru" : "personel",
            birim = merkez ? "merkez" : depo ? "depo" : "magaza",
            performansYok = perfYok,
            performans,
            oryantasyon = new
            {
                asamalar,
                yoneticiOrt5 = oryOrt5,
                yoneticiPuan = ory100,
                genelPuandaMi = !(magazaMuduru || bolgeMuduru),
            },
            ekip,
            cikislar,
            genel = genel is null ? null : new
            {
                puan = genel,
                etiket = Etiket(genel.Value),
                parcalar = parcalar.Select(x => new { ad = x.Ad, puan = x.Puan }),
                formul = parcalar.Count == 1
                    ? $"Yalnızca {parcalar[0].Ad} ({parcalar[0].Puan:0.#})"
                    : $"({string.Join(" + ", parcalar.Select(x => $"{x.Ad} {x.Puan:0.#}"))}) ÷ {parcalar.Count}",
            },
        });
    }
}

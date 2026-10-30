using System.Globalization;
using System.Security.Claims;
using Bicen360.API.Servisler;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Rapor Merkezi: ciro, satış, stok ve şube karşılaştırması.
///
/// <para>
/// Sayfa yetkisi <c>rapormerkezi</c> (Yönetim → Yetkiler). Şubeye kilitli
/// kullanıcı yalnızca kendi şubesini görüyor; kilit sunucuda, her uçta
/// uygulanıyor.
/// </para>
///
/// <para>
/// Uzun süren hesaplar arka planda: cevapta <c>hazirlaniyor = true</c>
/// geliyorsa ekran birkaç saniye sonra aynı isteği tekrarlıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class RaporMerkeziController : ControllerBase
{
    public const string SayfaKodu = "rapormerkezi";

    private readonly RaporMerkeziServisi _rm;
    private readonly YetkiServisi _yetki;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly ILogger<RaporMerkeziController> _kayit;

    public RaporMerkeziController(RaporMerkeziServisi rm, YetkiServisi yetki,
        PanelKullaniciServisi panelKullanici, ILogger<RaporMerkeziController> kayit)
    {
        _rm = rm;
        _yetki = yetki;
        _panelKullanici = panelKullanici;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";

    private string Rol => User.FindFirstValue(ClaimTypes.Role) ?? "";

    private bool Yetkili => _yetki.SayfaAcik(Kullanici, Rol, SayfaKodu);

    private bool Admin => YetkiServisi.Adminmi(Rol);

    private static readonly CultureInfo Tr = new("tr-TR");

    /* ==================================================================== */
    /* Kapsam                                                               */
    /* ==================================================================== */

    private sealed record Kapsam(
        RaporMerkeziServisi.Yapi Yapi,
        RaporMerkeziServisi.Suzgec Suzgec,
        RaporMerkeziServisi.Sube Kilit,
        Dictionary<int, string> Bolgeler,
        Dictionary<int, string> Adlar);

    private Kapsam KapsamKur(string bolge, int? depo, string grup)
    {
        var yapi = _rm.YapiGetir();
        var bilgi = _panelKullanici.Getir(Kullanici);

        RaporMerkeziServisi.Sube kilit = null;
        var izinli = yapi.Subeler.Select(s => s.Depo).ToHashSet();

        if (bilgi.SubeKilitli)
        {
            kilit = yapi.Subeler.FirstOrDefault(s => bilgi.DepoNo is not null && s.Depo == bilgi.DepoNo)
                 ?? yapi.Subeler.FirstOrDefault(s =>
                        string.Equals(s.Kod, bilgi.SubeKodu, StringComparison.OrdinalIgnoreCase));

            izinli = kilit is null ? new HashSet<int>() : new HashSet<int> { kilit.Depo };
        }

        var bolgede = string.IsNullOrWhiteSpace(bolge)
            ? new HashSet<int>(izinli)
            : yapi.Subeler
                .Where(s => izinli.Contains(s.Depo) && string.Equals(s.Bolge, bolge, StringComparison.OrdinalIgnoreCase))
                .Select(s => s.Depo)
                .ToHashSet();

        var s = new RaporMerkeziServisi.Suzgec
        {
            Izinli = izinli,
            Bolgede = bolgede,
            Depo = depo is not null && bolgede.Contains(depo.Value) ? depo : null,
            Grup = string.IsNullOrWhiteSpace(grup) ? null : grup.Trim(),
        };

        return new Kapsam(yapi, s, kilit,
            yapi.Subeler.ToDictionary(x => x.Depo, x => x.Bolge),
            yapi.Subeler.ToDictionary(x => x.Depo, x => x.Ad));
    }

    private static bool Tarih(string s, out DateTime t) =>
        DateTime.TryParseExact(s ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out t);

    /// <summary>Dönem: bitiş en geç dün, en çok 800 gün.</summary>
    private static (DateTime bas, DateTime bit, DateTime? pbas, DateTime? pbit) Donem(
        string bas, string bit, string pbas, string pbit)
    {
        var dun = DateTime.Today.AddDays(-1);

        var b = Tarih(bit, out var x) ? x : dun;
        var a = Tarih(bas, out var y) ? y : b.AddDays(-29);

        if (a > b) (a, b) = (b, a);
        if (b > dun) b = dun;
        if (a > b) a = b;
        if ((b - a).TotalDays > 800) a = b.AddDays(-800);
        if (a.Year < 2015) a = new DateTime(2015, 1, 1);

        DateTime? pa = null, pb = null;

        if (Tarih(pbas, out var p1) && Tarih(pbit, out var p2))
        {
            if (p1 > p2) (p1, p2) = (p2, p1);

            if ((p2 - p1).TotalDays <= 800 && p1.Year >= 2015 && p2 < a)
            {
                pa = p1;
                pb = p2;
            }
        }

        return (a, b, pa, pb);
    }

    private IActionResult Yasak() => StatusCode(403, new { hata = "Rapor Merkezi için yetkiniz yok." });

    private IActionResult Hata(string ne, Exception h)
    {
        _kayit.LogError(h, "Rapor Merkezi: {Ne}", ne);

        return StatusCode(500, new
        {
            hata = "Veri alınamadı.",
            ayrinti = h.Message.Length > 300 ? h.Message[..300] : h.Message,
        });
    }

    /* ==================================================================== */
    /* Seçenekler                                                           */
    /* ==================================================================== */

    [HttpGet("Secenekler")]
    public IActionResult Secenekler([FromQuery] bool yenile = false)
    {
        if (!Yetkili) return Yasak();

        try
        {
            if (yenile) _rm.YapiGetir(true);

            var k = KapsamKur(null, null, null);
            var pos = _rm.PosAyarOku();

            var subeler = k.Yapi.Subeler.Where(s => k.Suzgec.Izinli.Contains(s.Depo)).ToList();

            return Ok(new
            {
                subeler = subeler.Select(s => new { depo = s.Depo, ad = s.Ad, bolge = s.Bolge }),
                bolgeler = subeler.Select(s => s.Bolge).Where(b => b.Length > 0).Distinct()
                    .OrderBy(b => b, StringComparer.Create(Tr, true)).ToList(),
                bolgesiz = subeler.Count(s => s.Bolge.Length == 0),
                gruplar = k.Yapi.Gruplar.Select(g => new { kod = g.Kod, ad = g.Ad }),
                kilit = k.Kilit is null ? null : new { depo = k.Kilit.Depo, ad = k.Kilit.Ad },
                kilitBulunamadi = _panelKullanici.Getir(Kullanici).SubeKilitli && k.Kilit is null,
                admin = Admin,
                dun = DateTime.Today.AddDays(-1).ToString("yyyy-MM-dd"),
                bugun = DateTime.Today.ToString("yyyy-MM-dd"),
                kaynak = new
                {
                    posFis = pos.FisSorgusu.Length > 0,
                    posOdeme = pos.OdemeSorgusu.Length > 0,
                },
            });
        }
        catch (Exception h)
        {
            return Hata("Secenekler", h);
        }
    }

    /* ==================================================================== */
    /* Özet: genel bakış, satış analizi, şube karşılaştırma                 */
    /* ==================================================================== */

    [HttpGet("Ozet")]
    public async Task<IActionResult> Ozet(
        [FromQuery] string bas, [FromQuery] string bit,
        [FromQuery] string pbas, [FromQuery] string pbit,
        [FromQuery] string bolge, [FromQuery] int? depo, [FromQuery] string grup)
    {
        if (!Yetkili) return Yasak();

        try
        {
            var (a, b, pa, pb) = Donem(bas, bit, pbas, pbit);
            var k = KapsamKur(bolge, depo, grup);

            var h1 = await _rm.HazirlaBekle(a, b, TimeSpan.FromSeconds(12));
            var h2 = pa is null ? null : _rm.Hazirla(pa.Value, pb.Value);

            if (!h1.Hazir || (h2 is not null && !h2.Hazir))
            {
                var eksik = h1.Eksik + (h2?.Eksik ?? 0);
                var toplam = h1.Toplam + (h2?.Toplam ?? 0);

                return Ok(new
                {
                    hazirlaniyor = true,
                    eksik,
                    toplam,
                    durum = h1.Durum ?? h2?.Durum,
                    hata = h1.Hata ?? h2?.Hata,
                });
            }

            var oran = _rm.KarOranlari(_rm.Gunler(a, b));

            var A = _rm.Topla(a, b, k.Suzgec, oran, k.Bolgeler);
            var P = pa is null ? null : _rm.Topla(pa.Value, pb.Value, k.Suzgec, oran, k.Bolgeler);

            return Ok(new
            {
                hazirlaniyor = false,
                donem = new
                {
                    bas = a.ToString("yyyy-MM-dd"),
                    bit = b.ToString("yyyy-MM-dd"),
                    pbas = pa?.ToString("yyyy-MM-dd"),
                    pbit = pb?.ToString("yyyy-MM-dd"),
                },
                a = Yaz(A),
                p = P is null ? null : Yaz(P),
                uyarilar = Uyarilar(A),
                kaynak = new { posSaat = A.PosSaat, posOdeme = A.PosOdeme },
            });
        }
        catch (Exception h)
        {
            return Hata("Ozet", h);
        }
    }

    private static object Yaz(RaporMerkeziServisi.Toplam t) => new
    {
        ciro = Math.Round(t.Ciro, 2),
        net = Math.Round(t.Net, 2),
        kar = Math.Round(t.Kar, 2),
        fire = Math.Round(t.Fire, 2),
        fis = Math.Round(t.Fis),
        miktar = Math.Round(t.Miktar, 1),
        gunSayisi = t.GunSayisi,
        gunler = t.Gunler.Select(x => Math.Round(x, 0)),
        kat = t.Kat.Select(x => new
        {
            kod = x.Key,
            ciro = Math.Round(x.Value.Ciro, 0),
            net = Math.Round(x.Value.Net, 0),
            kar = Math.Round(x.Value.Kar, 0),
            fire = Math.Round(x.Value.Fire, 0),
            fis = Math.Round(x.Value.Fis),
        }),
        sube = t.Sube.Select(x => new
        {
            depo = x.Key,
            ciro = Math.Round(x.Value.Ciro, 0),
            net = Math.Round(x.Value.Net, 0),
            kar = Math.Round(x.Value.Kar, 0),
            fire = Math.Round(x.Value.Fire, 0),
            fis = Math.Round(x.Value.Fis),
        }),
        bolge = t.Bolge.Select(x => new { ad = x.Key, ciro = Math.Round(x.Value, 0) }),
        hafta = t.Hafta.Select(x => Math.Round(x, 0)),
        haftaN = t.HaftaN,
        isi = t.Isi.Select(r => r.Select(x => Math.Round(x, 0))),
        saat = t.Saat.Select(x => Math.Round(x, 0)),
        odeme = t.Odeme.Where(x => Math.Abs(x.Value) > 0.5)
            .OrderByDescending(x => x.Value)
            .Select(x => new { tip = x.Key.Length == 0 ? "Diğer" : x.Key, tutar = Math.Round(x.Value, 0) }),
    };

    /// <summary>Verinin nereden geldiğini ve güvenilirliğini ekrana söyleyen notlar.</summary>
    private static List<object> Uyarilar(RaporMerkeziServisi.Toplam a)
    {
        var l = new List<object>();

        if (!a.PosSaat && a.Fis > 0 && a.Ciro / a.Fis > 2500)
            l.Add(new
            {
                tur = "uyari",
                metin = $"Fiş sayısı Mikro evrak sayısından hesaplanıyor ve sepet ortalaması ₺{a.Ciro / a.Fis:N0} çıkıyor: "
                      + "evraklar tek tek fiş değil, kasa/gün toplamı olabilir. Gerçek fiş sayısı için "
                      + "Veri kaynakları → POS fiş sorgusunu tanımlayın.",
            });

        if (!a.PosSaat)
        {
            var toplam = a.Saat.Sum();
            var gece = a.Saat.Take(7).Sum() + a.Saat[23];
            var tepe = a.Saat.Max();

            if (toplam > 0 && (gece / toplam > 0.25 || tepe / toplam > 0.45))
                l.Add(new
                {
                    tur = "uyari",
                    metin = "Saatlik dağılım satırların Mikro'ya aktarıldığı saatten hesaplanıyor ve satışın "
                          + "bir-iki saatte ya da gece toplandığı görülüyor: gerçek satış saatini göstermiyor "
                          + "olabilir. POS fiş sorgusu tanımlandığında kasadaki saat kullanılır.",
                });
        }

        return l;
    }

    /* ==================================================================== */
    /* Bugün                                                                */
    /* ==================================================================== */

    [HttpGet("Bugun")]
    public async Task<IActionResult> Bugun([FromQuery] string bolge, [FromQuery] int? depo,
        [FromQuery] bool yenile = false)
    {
        if (!Yetkili) return Yasak();

        try
        {
            var k = KapsamKur(bolge, depo, null);
            var simdi = DateTime.Now;
            var dun = DateTime.Today.AddDays(-1);

            _rm.Hazirla(dun, dun);

            var r = await _rm.BugunSaatleri(yenile);

            if (r.Veri is null)
                return Ok(new { hazirlaniyor = r.Calisiyor, hata = r.Hata });

            double bugun = 0, fis = 0;

            foreach (var h in r.Veri)
            {
                if (!k.Suzgec.Secili(h.Depo)) continue;

                bugun += h.Ciro;
                fis += h.Fis;
            }

            double? dunAyni = null;
            var dg = _rm.Gunler(dun, dun).FirstOrDefault();

            if (dg is not null)
            {
                var kesir = simdi.Minute / 60d;
                double t = 0;

                foreach (var h in dg.S)
                {
                    if (!k.Suzgec.Secili(h.Depo)) continue;

                    if (h.Saat < simdi.Hour) t += h.Ciro;
                    else if (h.Saat == simdi.Hour) t += h.Ciro * kesir;
                }

                dunAyni = t;
            }

            return Ok(new
            {
                hazirlaniyor = false,
                saat = simdi.ToString("HH:mm"),
                ciro = Math.Round(bugun, 0),
                fis = Math.Round(fis),
                dunAyniSaat = dunAyni is null ? (double?)null : Math.Round(dunAyni.Value, 0),
                zaman = r.Zaman,
                yenileniyor = r.Calisiyor,
            });
        }
        catch (Exception h)
        {
            return Hata("Bugun", h);
        }
    }

    /* ==================================================================== */
    /* Ürün satışları                                                       */
    /* ==================================================================== */

    [HttpGet("Urunler")]
    public async Task<IActionResult> Urunler(
        [FromQuery] string bas, [FromQuery] string bit,
        [FromQuery] string pbas, [FromQuery] string pbit,
        [FromQuery] string bolge, [FromQuery] int? depo, [FromQuery] string grup,
        [FromQuery] bool yenile = false)
    {
        if (!Yetkili) return Yasak();

        try
        {
            var (a, b, pa, pb) = Donem(bas, bit, pbas, pbit);
            var k = KapsamKur(bolge, depo, grup);

            var depolar = k.Suzgec.Bolgede.Where(k.Suzgec.Secili).OrderBy(x => x).ToList();
            var g = k.Suzgec.Grup;

            var anahtar = $"urun:{a:yyyyMMdd}:{b:yyyyMMdd}:{pa:yyyyMMdd}:{pb:yyyyMMdd}:{string.Join(",", depolar)}:{g}";

            var r = await _rm.IsCalistir(anahtar, TimeSpan.FromMinutes(20), yenile, TimeSpan.FromSeconds(15), () =>
            {
                var kartlar = _rm.Kartlar().Kartlar;
                var simdi = _rm.UrunOku(a, b, depolar, g);
                var once = pa is null
                    ? new Dictionary<string, double>()
                    : _rm.UrunOku(pa.Value, pb.Value, depolar, g)
                        .GroupBy(x => x.Kod)
                        .ToDictionary(x => x.Key, x => x.Sum(y => y.Ciro));

                return simdi.Select(x =>
                {
                    kartlar.TryGetValue(x.Kod, out var c);

                    return new
                    {
                        kod = x.Kod,
                        barkod = c?.Barkod ?? "",
                        ad = c?.Ad ?? x.Kod,
                        grup = c?.Grup ?? "",
                        birim = c?.Birim ?? "",
                        miktar = Math.Round(x.Miktar, 2),
                        fiyat = c is null ? 0 : Math.Round(c.Fiyat, 2),
                        ciro = Math.Round(x.Ciro, 2),
                        kar = Math.Round(x.Net - x.Miktar * (c?.Maliyet ?? 0), 2),
                        maliyetTahmini = c?.MaliyetTahmini ?? true,
                        onceki = pa is null ? (double?)null : once.TryGetValue(x.Kod, out var o) ? Math.Round(o, 2) : 0,
                    };
                }).ToList();
            });

            return Ok(new
            {
                hazirlaniyor = r.Veri is null && r.Calisiyor,
                hata = r.Hata,
                zaman = r.Zaman,
                satirlar = r.Veri,
            });
        }
        catch (Exception h)
        {
            return Hata("Urunler", h);
        }
    }

    /* ==================================================================== */
    /* Depo & stok                                                          */
    /* ==================================================================== */

    private static (string ad, string renk) Durum(RaporMerkeziServisi.StokSatir x) =>
        x.Gun < 3 ? ("Kritik", "bad")
        : x.Gun < 7 ? ("Düşük", "warn")
        : x.Gun > 45 ? ("Fazla stok", "info")
        : ("Normal", "good");

    [HttpGet("Stok")]
    public async Task<IActionResult> Stok(
        [FromQuery] string bolge, [FromQuery] int? depo, [FromQuery] string grup,
        [FromQuery] string seg = "all", [FromQuery] string ara = "",
        [FromQuery] string sirala = "gun", [FromQuery] int yon = 1, [FromQuery] int limit = 20,
        [FromQuery] string trDurum = "", [FromQuery] bool yenile = false)
    {
        if (!Yetkili) return Yasak();

        try
        {
            var k = KapsamKur(bolge, depo, grup);
            var s = k.Suzgec;

            var tumu = s.Depo is null && s.Bolgede.Count == s.Izinli.Count && k.Kilit is null;

            bool Kapsamda(int d) =>
                RaporMerkeziServisi.MerkezDepolar.Contains(d) ? tumu : s.Secili(d);

            string Ad(int d) =>
                RaporMerkeziServisi.MerkezDepolar.Contains(d) ? "Merkez Depo"
                : k.Adlar.TryGetValue(d, out var a) ? a : $"Depo {d}";

            var stokIs = _rm.IsCalistir("stok", TimeSpan.FromMinutes(30), yenile, TimeSpan.FromSeconds(12),
                () => _rm.StokPaketOku());
            var merkezIs = _rm.IsCalistir("merkez", TimeSpan.FromMinutes(60), yenile, TimeSpan.FromSeconds(2),
                () => _rm.MerkezOku());
            var sktIs = _rm.IsCalistir("skt", TimeSpan.FromMinutes(30), yenile, TimeSpan.FromSeconds(4),
                () => _rm.SktOku());
            var trIs = _rm.IsCalistir("transfer", TimeSpan.FromMinutes(10), yenile, TimeSpan.FromSeconds(4),
                () => _rm.TransferOku());

            await Task.WhenAll(stokIs, merkezIs, sktIs, trIs);

            var st = stokIs.Result;
            var sk = sktIs.Result;
            var tr = trIs.Result;
            var mz = merkezIs.Result;

            var kartlar = st.Veri?.Kartlar.Kartlar ?? _rm.KartlarHazirsa()?.Kartlar;

            RaporMerkeziServisi.Kart Kart(string kod) =>
                kartlar is not null && kartlar.TryGetValue(kod, out var c) ? c : null;

            bool Grupta(string kod) => s.Grup is null || Kart(kod)?.Grup == s.Grup;

            /* --------------------------------------------------- stok */
            object stok;

            if (st.Veri is null)
            {
                stok = new { hazirlaniyor = st.Calisiyor, hata = st.Hata };
            }
            else
            {
                var v = st.Veri.Stok;

                var S = v.Satirlar
                    .Concat(v.MerkezVar ? Enumerable.Empty<RaporMerkeziServisi.StokSatir>() : mz.Veri ?? new())
                    .Where(x => Kapsamda(x.Depo) && Grupta(x.Kod))
                    .ToList();

                double Maliyet(RaporMerkeziServisi.StokSatir x) => Kart(x.Kod)?.Maliyet ?? 0;
                double Deger(RaporMerkeziServisi.StokSatir x) => x.Miktar * Maliyet(x);

                var toplamDeger = S.Sum(Deger);
                var gunlukDeger = S.Sum(x => x.Gunluk * Maliyet(x));
                var tahmini = S.Where(x => Kart(x.Kod)?.MaliyetTahmini ?? true).Sum(Deger);
                var fazla = S.Where(x => x.Gun > 45).ToList();

                var sayac = new Dictionary<string, int>
                {
                    ["all"] = S.Count, ["Kritik"] = 0, ["Düşük"] = 0, ["Normal"] = 0, ["Fazla stok"] = 0,
                };

                foreach (var x in S) sayac[Durum(x).ad]++;

                var aranan = (ara ?? "").Trim().ToLower(Tr);

                var satirlar = S.Where(x =>
                    (seg is null or "all" || Durum(x).ad == seg) &&
                    (aranan.Length == 0
                     || x.Kod.ToLower(Tr).Contains(aranan)
                     || (Kart(x.Kod)?.Ad ?? "").ToLower(Tr).Contains(aranan)
                     || (Kart(x.Kod)?.Barkod ?? "").Contains(aranan)
                     || Ad(x.Depo).ToLower(Tr).Contains(aranan)));

                Func<RaporMerkeziServisi.StokSatir, object> anahtar = sirala switch
                {
                    "depo" => x => x.Depo,
                    "sube" => x => Ad(x.Depo),
                    "urun" => x => Kart(x.Kod)?.Ad ?? x.Kod,
                    "qty" => x => x.Miktar,
                    "min" => x => x.Gunluk * 3,
                    "daily" => x => x.Gunluk,
                    "deger" => x => Deger(x),
                    "durum" => x => x.Gun,
                    _ => x => x.Gun,
                };

                var karsilastir = StringComparer.Create(Tr, true);
                var liste = satirlar.ToList();
                var sirali = yon >= 0
                    ? liste.OrderBy(anahtar, Comparer<object>.Create((p, q) => Kiyasla(p, q, karsilastir)))
                    : liste.OrderByDescending(anahtar, Comparer<object>.Create((p, q) => Kiyasla(p, q, karsilastir)));

                var adet = liste.Count;

                stok = new
                {
                    hazirlaniyor = false,
                    yenileniyor = st.Calisiyor,
                    zaman = st.Zaman,
                    merkez = v.MerkezVar ? "pusula" : mz.Veri is not null ? "hazir" : mz.Calisiyor ? "hazirlaniyor" : "hata",
                    merkezHata = mz.Hata,
                    kpi = new
                    {
                        deger = Math.Round(toplamDeger, 0),
                        kayit = S.Count,
                        ortGun = gunlukDeger > 0 ? Math.Round(toplamDeger / gunlukDeger, 1) : (double?)null,
                        kritik = sayac["Kritik"],
                        dusuk = sayac["Düşük"],
                        fazlaDeger = Math.Round(fazla.Sum(Deger), 0),
                        fazlaKayit = fazla.Count,
                        tahminiPay = toplamDeger > 0 ? Math.Round(tahmini / toplamDeger, 3) : 0,
                    },
                    depolar = S.GroupBy(x => RaporMerkeziServisi.MerkezDepolar.Contains(x.Depo) ? 100 : x.Depo)
                        .Select(g => new
                        {
                            depo = g.Key,
                            ad = Ad(g.Key),
                            merkez = RaporMerkeziServisi.MerkezDepolar.Contains(g.Key),
                            deger = Math.Round(g.Sum(Deger), 0),
                        })
                        .OrderByDescending(x => x.deger)
                        .Take(12)
                        .ToList(),
                    kategoriGun = S.GroupBy(x => Kart(x.Kod)?.Grup ?? "")
                        .Select(g => new
                        {
                            kod = g.Key,
                            deger = g.Sum(Deger),
                            gunluk = g.Sum(x => x.Gunluk * Maliyet(x)),
                        })
                        .Where(x => x.gunluk > 0 && x.deger > 0)
                        .Select(x => new { x.kod, gun = Math.Round(x.deger / x.gunluk, 1) })
                        .OrderByDescending(x => x.gun)
                        .ToList(),
                    sayac,
                    toplamSatir = adet,
                    satirlar = sirali.Take(Math.Clamp(limit, 1, 2000)).Select(x =>
                    {
                        var c = Kart(x.Kod);
                        var d = Durum(x);

                        return new
                        {
                            depo = x.Depo,
                            sube = Ad(x.Depo),
                            kod = x.Kod,
                            urun = c?.Ad ?? x.Kod,
                            barkod = c?.Barkod ?? "",
                            birim = c?.Birim ?? "",
                            miktar = Math.Round(x.Miktar, 2),
                            esik = Math.Round(x.Gunluk * 3, 2),
                            gunluk = Math.Round(x.Gunluk, 2),
                            gun = Math.Round(x.Gun, 1),
                            deger = Math.Round(Deger(x), 0),
                            durum = d.ad,
                            renk = d.renk,
                            yokSatiyor = x.YokSatiyor,
                        };
                    }).ToList(),
                };
            }

            /* ---------------------------------------------------- SKT */
            object skt;

            if (sk.Veri is null)
            {
                skt = new { hazirlaniyor = sk.Calisiyor, hata = sk.Hata };
            }
            else
            {
                var bugun = DateTime.Today;

                var l = sk.Veri.Satirlar
                    .Where(x => Kapsamda(x.Depo) && Grupta(x.Kod))
                    .Select(x =>
                    {
                        var c = Kart(x.Kod);

                        return new
                        {
                            depo = x.Depo,
                            sube = Ad(x.Depo),
                            kod = x.Kod,
                            urun = c?.Ad ?? x.Kod,
                            birim = c?.Birim ?? "",
                            miktar = Math.Round(x.Miktar, 2),
                            skt = x.Skt.ToString("yyyy-MM-dd"),
                            kalan = (int)(x.Skt - bugun).TotalDays,
                            deger = Math.Round(x.Miktar * (c?.Maliyet ?? 0), 0),
                            parti = x.Parti,
                        };
                    })
                    .OrderBy(x => x.kalan)
                    .ToList();

                skt = new
                {
                    hazirlaniyor = false,
                    kaynak = sk.Veri.Kaynak,
                    mesaj = sk.Veri.Mesaj,
                    adet = l.Count,
                    deger = l.Sum(x => x.deger),
                    acil = l.Count(x => x.kalan <= 1),
                    satirlar = l.Take(300),
                };
            }

            /* ----------------------------------------------- transfer */
            object transfer;

            if (tr.Veri is null)
            {
                transfer = new { hazirlaniyor = tr.Calisiyor, hata = tr.Hata };
            }
            else
            {
                var l = tr.Veri.Where(x => s.Izinli.Contains(x.Depo) && (tumu || s.Secili(x.Depo))).ToList();

                transfer = new
                {
                    hazirlaniyor = false,
                    bekleyen = l.Count(x => x.Durum < 2),
                    yolda = l.Count(x => x.Durum == 1),
                    sayac = new[] { l.Count(x => x.Durum == 0), l.Count(x => x.Durum == 1), l.Count(x => x.Durum == 2) },
                    satirlar = l
                        .Where(x => trDurum is null or "" || x.Durum.ToString() == trDurum)
                        .OrderByDescending(x => x.Tarih)
                        .Take(300)
                        .Select(x => new
                        {
                            belge = x.Belge,
                            depo = x.Depo,
                            sube = Ad(x.Depo),
                            kalem = x.Kalem,
                            tutar = Math.Round(x.Tutar, 0),
                            tarih = x.Tarih.ToString("yyyy-MM-dd"),
                            durum = x.Durum,
                        }),
                };
            }

            return Ok(new { stok, skt, transfer });
        }
        catch (Exception h)
        {
            return Hata("Stok", h);
        }
    }

    private static int Kiyasla(object p, object q, StringComparer metin) =>
        p is string a && q is string b ? metin.Compare(a, b)
        : Comparer<double>.Default.Compare(Convert.ToDouble(p), Convert.ToDouble(q));

    /* ==================================================================== */
    /* Yenile ve veri kaynakları (yönetici)                                 */
    /* ==================================================================== */

    /// <summary>Bugünün verisini ve son günleri tazeler.</summary>
    [HttpPost("Yenile")]
    public async Task<IActionResult> Yenile()
    {
        if (!Yetkili) return Yasak();

        await _rm.BugunSaatleri(true);

        return Ok(new { tamam = true });
    }

    [HttpGet("Kaynak")]
    public IActionResult Kaynak()
    {
        if (!Yetkili) return Yasak();
        if (!Admin) return StatusCode(403, new { hata = "Yalnızca yönetici." });

        var pos = _rm.PosAyarOku();

        return Ok(new
        {
            pos = new
            {
                fisSorgusu = pos.FisSorgusu,
                odemeSorgusu = pos.OdemeSorgusu,
                guncelleyen = pos.Guncelleyen,
                guncelleme = pos.Guncelleme,
            },
            kup = new
            {
                yukluGun = _rm.YukluGun,
                enEski = _rm.EnEskiGun?.ToString("yyyy-MM-dd"),
                kuyruk = _rm.KuyrukUzunlugu,
                yukleniyor = _rm.Yukleniyor,
                sonHata = _rm.SonHata,
                sonYukleme = _rm.SonYukleme,
            },
            ornek = new
            {
                fis = OrnekFis,
                odeme = OrnekOdeme,
            },
        });
    }

    private const string OrnekFis = @"SELECT CAST(f.Tarih AS DATE)      AS gun,
       f.MagazaNo                AS depo,
       DATEPART(hour, f.Tarih)   AS saat,
       COUNT(*)                  AS fis,
       SUM(f.GenelToplam)        AS ciro
FROM dbo.FisBaslik f
WHERE f.Tarih >= @bas AND f.Tarih < @bit
  AND f.Iptal = 0
GROUP BY CAST(f.Tarih AS DATE), f.MagazaNo, DATEPART(hour, f.Tarih)";

    private const string OrnekOdeme = @"SELECT CAST(f.Tarih AS DATE)  AS gun,
       f.MagazaNo            AS depo,
       o.OdemeTipiAdi        AS tip,
       SUM(o.Tutar)          AS tutar
FROM dbo.FisOdeme o
    INNER JOIN dbo.FisBaslik f ON f.Id = o.FisId
WHERE f.Tarih >= @bas AND f.Tarih < @bit
  AND f.Iptal = 0
GROUP BY CAST(f.Tarih AS DATE), f.MagazaNo, o.OdemeTipiAdi";

    public sealed class KaynakGirdi
    {
        public string FisSorgusu { get; set; }
        public string OdemeSorgusu { get; set; }
    }

    [HttpPost("Kaynak")]
    public IActionResult KaynakKaydet([FromBody] KaynakGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (!Admin) return StatusCode(403, new { hata = "Yalnızca yönetici." });

        try
        {
            _rm.PosAyarYaz(new RaporMerkeziServisi.PosAyar
            {
                FisSorgusu = g?.FisSorgusu ?? "",
                OdemeSorgusu = g?.OdemeSorgusu ?? "",
            }, Kullanici);

            return Ok(new { tamam = true });
        }
        catch (ArgumentException h)
        {
            return BadRequest(new { hata = h.Message });
        }
        catch (Exception h)
        {
            return Hata("KaynakKaydet", h);
        }
    }

    public sealed class DeneGirdi
    {
        public string Sql { get; set; }
        public string Tur { get; set; }
    }

    /// <summary>Sorguyu dünün aralığıyla, ilk 50 satır, kaydetmeden dener.</summary>
    [HttpPost("KaynakDene")]
    public IActionResult KaynakDene([FromBody] DeneGirdi g)
    {
        if (!Yetkili) return Yasak();
        if (!Admin) return StatusCode(403, new { hata = "Yalnızca yönetici." });

        var gerekli = g?.Tur == "odeme"
            ? new[] { "gun", "depo", "tip", "tutar" }
            : new[] { "gun", "depo", "saat", "fis", "ciro" };

        try
        {
            var dun = DateTime.Today.AddDays(-1);
            var sure = System.Diagnostics.Stopwatch.StartNew();
            var satirlar = _rm.PosCalistir(g?.Sql ?? "", dun, dun.AddDays(1), 50);

            var sutunlar = satirlar.FirstOrDefault()?.Keys.ToList() ?? new List<string>();
            var eksik = satirlar.Count == 0
                ? new List<string>()
                : gerekli.Where(x => !sutunlar.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList();

            var depolar = _rm.YapiGetir().Subeler.Select(x => x.Depo).ToHashSet();
            var taninmayan = satirlar
                .Select(x => x.TryGetValue("depo", out var d) && d is not null ? Convert.ToString(d) : null)
                .Where(x => x is not null && !(int.TryParse(x, out var n) && depolar.Contains(n)))
                .Distinct()
                .Take(10)
                .ToList();

            return Ok(new
            {
                sure = sure.ElapsedMilliseconds,
                satir = satirlar.Count,
                sutunlar,
                eksik,
                taninmayanDepolar = taninmayan,
                ornek = satirlar.Take(20),
            });
        }
        catch (ArgumentException h)
        {
            return BadRequest(new { hata = h.Message });
        }
        catch (Exception h)
        {
            return BadRequest(new { hata = "Sorgu çalışmadı: " + (h.Message.Length > 400 ? h.Message[..400] : h.Message) });
        }
    }

    [HttpGet("PosTani")]
    public IActionResult PosTani()
    {
        if (!Yetkili) return Yasak();
        if (!Admin) return StatusCode(403, new { hata = "Yalnızca yönetici." });

        try
        {
            return Ok(_rm.PosTani());
        }
        catch (Exception h)
        {
            return BadRequest(new { hata = "PosBack'e ulaşılamadı: " + h.Message });
        }
    }

    [HttpPost("OnbellekTemizle")]
    public IActionResult OnbellekTemizle()
    {
        if (!Yetkili) return Yasak();
        if (!Admin) return StatusCode(403, new { hata = "Yalnızca yönetici." });

        _rm.OnbellegiTemizle();
        _rm.YapiGetir(true);

        return Ok(new { tamam = true });
    }
}

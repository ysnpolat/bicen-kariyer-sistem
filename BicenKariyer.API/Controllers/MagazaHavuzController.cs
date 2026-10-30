using System.Data;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Mağaza havuz sistemi (19.10.2026).
///
/// <para>
/// Satınalma bir ürün için adet (ya da kg) başı tutar belirler, İK
/// kampanyayı buraya girer: ürünün stok kodları, birim tutar, tarih
/// aralığı, varsa bölge payı (%). Şube bazında satış miktarı Mikro'dan
/// (STOK_HAREKETLERI, Ciro bağlantısı, salt okunur) hesaplanır; İK
/// gerekirse şube satırını elle düzeltir ve kampanyayı kesinleştirir.
/// Kesinleşen kampanyaların net tutarı şubenin havuzuna girer.
/// </para>
///
/// <para>
/// Havuz hareketleri: açılış bakiyesi (Excel'den devreden tutar),
/// kullanım (piknik, sinema, alışveriş sepeti…) ve düzeltme. Kalan =
/// kesin hakedişler + açılış ± düzeltme − kullanım.
/// </para>
///
/// <para>
/// Satış tanımı Biçen360 Rapor Merkezi ile aynı: sth_cins 0/1, satış
/// (sth_tip 1, evrak 1/4, iade değil) eksi müşteri iadesi.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class MagazaHavuzController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly ILogger<MagazaHavuzController> _kayit;
    private readonly PersonelKaynagiServisi _personel;

    public MagazaHavuzController(VeritabaniServisi vt, AyarServisi ayar, ILogger<MagazaHavuzController> kayit,
        PersonelKaynagiServisi personel)
    {
        _vt = vt;
        _ayar = ayar;
        _kayit = kayit;
        _personel = personel;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private bool GeriAlabilir => User.IsInRole(Roller.Admin) || User.IsInRole(Roller.IKYoneticisi)
                                 || User.IsInRole(Roller.GenelMudurYardimcisi);

    private static readonly string[] Turler = { "acilis", "kullanim", "duzeltme" };

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    /// <summary>Havuza giren şubeler: birim türü "Şube" olanlar.</summary>
    private List<Sube> Subeler() =>
        (_ayar.FormOku().Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod) && !string.IsNullOrWhiteSpace(x.Ad))
            .Where(x => string.IsNullOrWhiteSpace(x.Tur) || x.Tur.Trim().Equals("Şube", StringComparison.OrdinalIgnoreCase))
            .OrderBy(x => x.Ad, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
            .ToList();

    /* -------------------------------------------------- bölge havuzları
       19.10.2026: kampanyalarda ayrılan bölge payı bölge müdürünün
       havuzuna gider (Excel'deki "MAĞAZA HAVUZ TUTARLARI BÖLGE"). Bölge
       havuzunun kodu "BOLGE:<bölge adı>"; şubeleri Yönetim › Bölgeler'den. */
    public const string BolgeOnek = "BOLGE:";

    private sealed record Bolge(string Kod, string Ad, List<string> SubeKodlari);

    /// <summary>
    /// Şube adı anahtarı: Türkçe harfler sadeleşir, "Şubesi / Mağazası" eki
    /// atılır. Sistemde "Sefaköy Şubesi", Excel'de ve Mikro'da "SEFAKÖY"
    /// yazıyor; ek atılmadan eşleşmiyordu (20.10.2026).
    /// </summary>
    public static string SubeAnahtari(string ad)
    {
        var a = PersonelKaynagiServisi.DuzAnahtar(ad);
        foreach (var ek in new[] { "subesi", "sube", "magazasi", "magaza" })
            if (a.Length > ek.Length + 2 && a.EndsWith(ek, StringComparison.Ordinal)) { a = a[..^ek.Length]; break; }
        return a;
    }

    private static bool AdEs(string a, string b) =>
        !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b)
        && SubeAnahtari(a) == SubeAnahtari(b);

    private List<Bolge> Bolgeler()
    {
        var subeler = Subeler();
        return (_ayar.FormOku().Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => !string.IsNullOrWhiteSpace(b.Ad))
            .Select(b => new Bolge(
                BolgeOnek + b.Ad.Trim(),
                b.Ad.Trim(),
                (b.Subeler ?? new List<string>())
                    .Select(k => subeler.FirstOrDefault(sb =>
                        string.Equals(sb.Kod, k?.Trim(), StringComparison.OrdinalIgnoreCase) || AdEs(sb.Ad, k))?.Kod)
                    .Where(k => k is not null)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList()))
            .ToList();
    }

    /// <summary>Hareket yazılabilecek havuz: şube ya da bölge (kod, ad).</summary>
    private (string Kod, string Ad)? SahipBul(string kod)
    {
        if (string.IsNullOrWhiteSpace(kod)) return null;
        var sb = Subeler().FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));
        if (sb is not null) return (sb.Kod, sb.Ad);
        var b = Bolgeler().FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));
        return b is null ? null : (b.Kod, b.Ad);
    }

    private static List<string> KodlariAyir(string metin) =>
        (metin ?? "")
            .Split(new[] { '\n', '\r', ',', ';', '\t' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>Mikro deposu bu şube mi: depo no = şube kodu, ya da ad eşleşmesi.</summary>
    private static bool DepoSube(int depoNo, string depoAdi, Sube s)
    {
        if (string.Equals(depoNo.ToString(), (s.Kod ?? "").Trim().TrimStart('0'), StringComparison.Ordinal)) return true;
        var a = SubeAnahtari(depoAdi);
        if (a.Length == 0) return false;
        var b = SubeAnahtari(s.Ad);
        return a == b || PersonelKaynagiServisi.Benziyor(depoAdi.Trim(), s.Ad.Trim());
    }

    public sealed class Kampanya
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public string StokKodlari { get; set; }
        public decimal BirimTutar { get; set; }
        public decimal BolgePayi { get; set; }
        public DateTime Bas { get; set; }
        public DateTime Bit { get; set; }
        public string Durum { get; set; }
        public string Aciklama { get; set; }
        public DateTime? Hesaplama { get; set; }
        public string Olusturan { get; set; }
        public DateTime Olusturma { get; set; }
        public string Kesinlestiren { get; set; }
        public DateTime? Kesinlesme { get; set; }
        /// <summary>'satinalma': hakedişi satınalma paneli yazar; İK "Mikro'dan hesapla" kapalı.</summary>
        public string HesapKaynagi { get; set; }
    }

    private const string KampanyaSecim = @"
SELECT id AS Id, ad AS Ad, stok_kodlari AS StokKodlari, birim_tutar AS BirimTutar,
       bolge_payi AS BolgePayi, bas AS Bas, bit AS Bit, durum AS Durum, aciklama AS Aciklama,
       hesaplama AS Hesaplama, olusturan AS Olusturan, olusturma AS Olusturma,
       kesinlestiren AS Kesinlestiren, kesinlesme AS Kesinlesme, hesap_kaynagi AS HesapKaynagi
FROM KRY_HAVUZ_KAMPANYA";

    public sealed class Hakedis
    {
        public int KampanyaId { get; set; }
        public string SubeKodu { get; set; }
        public string SubeAdi { get; set; }
        public decimal Miktar { get; set; }
        public decimal Brut { get; set; }
        public decimal BolgePayi { get; set; }
        public decimal Net { get; set; }
        public bool Elle { get; set; }
    }

    private const string HakedisSecim = @"
SELECT kampanya_id AS KampanyaId, sube_kodu AS SubeKodu, sube_adi AS SubeAdi, miktar AS Miktar,
       brut AS Brut, bolge_payi AS BolgePayi, net AS Net, elle AS Elle
FROM KRY_HAVUZ_HAKEDIS";

    private static (decimal brut, decimal pay, decimal net) Tutarlar(decimal miktar, decimal birim, decimal payYuzde)
    {
        var brut = Math.Round(miktar * birim, 2);
        var pay = Math.Round(brut * payYuzde / 100m, 2);
        return (brut, pay, brut - pay);
    }

    /* ==================================================================== */
    /* Özet: şube havuzları                                                 */
    /* ==================================================================== */

    [HttpGet("Ozet")]
    public IActionResult Ozet()
    {
        using var db = _vt.Baglanti();

        var hakedis = db.Query<(string kod, decimal net, int adet)>(@"
SELECT h.sube_kodu, SUM(h.net), COUNT(*)
FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id AND k.durum = N'kesin'
WHERE h.net <> 0
GROUP BY h.sube_kodu").ToDictionary(x => x.kod, StringComparer.OrdinalIgnoreCase);

        var hareket = db.Query<(string kod, string tur, decimal tutar, DateTime son)>(@"
SELECT sube_kodu, tur, SUM(tutar), MAX(tarih) FROM KRY_HAVUZ_HAREKET GROUP BY sube_kodu, tur").ToList();

        var bekleyen = db.Query<(string kod, decimal net)>(@"
SELECT h.sube_kodu, SUM(h.net)
FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id AND k.durum = N'taslak'
GROUP BY h.sube_kodu").ToDictionary(x => x.kod, x => x.net, StringComparer.OrdinalIgnoreCase);

        /* Biçen Kart'a dağıtım için onay bekleyen puan talepleri */
        var onayda = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var x in db.Query<(string kod, decimal tutar)>(@"
SELECT havuz_kodu, SUM(toplam_puan) FROM KRY_PUAN_TALEP
WHERE havuz_kodu IS NOT NULL AND durum IN (N'bekliyor', N'isleniyor')
GROUP BY havuz_kodu"))
                onayda[x.kod] = x.tutar;
        }
        catch
        {
            /* sütun henüz yoksa */
        }

        decimal H(string kod, string tur) => hareket.Where(x => string.Equals(x.kod, kod, StringComparison.OrdinalIgnoreCase) && x.tur == tur).Sum(x => x.tutar);

        var subeler = Subeler().Select(s =>
        {
            hakedis.TryGetValue(s.Kod, out var hk);
            var acilis = H(s.Kod, "acilis");
            var kullanim = H(s.Kod, "kullanim");
            var duzeltme = H(s.Kod, "duzeltme");
            var sonKullanim = hareket.Where(x => string.Equals(x.kod, s.Kod, StringComparison.OrdinalIgnoreCase) && x.tur == "kullanim")
                .Select(x => (DateTime?)x.son).DefaultIfEmpty(null).Max();
            var toplam = hk.net + acilis + duzeltme;
            return new
            {
                kod = s.Kod,
                ad = s.Ad,
                hakedis = hk.net,
                kampanyaSayisi = hk.adet,
                acilis,
                duzeltme,
                toplam,
                kullanim,
                kalan = toplam - kullanim,
                bekleyen = bekleyen.TryGetValue(s.Kod, out var b) ? b : 0m,
                sonKullanim,
                dagitimOnayda = onayda.GetValueOrDefault(s.Kod),
            };
        }).ToList();

        /* Bölge havuzları: şubelerinin kesin kampanyalarındaki bölge payı */
        var payKesin = db.Query<(string kod, decimal pay, int adet)>(@"
SELECT h.sube_kodu, SUM(h.bolge_payi), COUNT(DISTINCT h.kampanya_id)
FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id AND k.durum = N'kesin'
WHERE h.bolge_payi <> 0
GROUP BY h.sube_kodu").ToDictionary(x => x.kod, StringComparer.OrdinalIgnoreCase);
        var payTaslak = db.Query<(string kod, decimal pay)>(@"
SELECT h.sube_kodu, SUM(h.bolge_payi)
FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id AND k.durum = N'taslak'
GROUP BY h.sube_kodu").ToDictionary(x => x.kod, x => x.pay, StringComparer.OrdinalIgnoreCase);

        var bolgeler = Bolgeler().Select(b =>
        {
            var hakedis = b.SubeKodlari.Sum(k => payKesin.TryGetValue(k, out var x) ? x.pay : 0m);
            var acilis = H(b.Kod, "acilis");
            var kullanim = H(b.Kod, "kullanim");
            var duzeltme = H(b.Kod, "duzeltme");
            var toplam = hakedis + acilis + duzeltme;
            return new
            {
                kod = b.Kod,
                ad = b.Ad,
                subeSayisi = b.SubeKodlari.Count,
                hakedis,
                acilis,
                duzeltme,
                toplam,
                kullanim,
                kalan = toplam - kullanim,
                bekleyen = b.SubeKodlari.Sum(k => payTaslak.TryGetValue(k, out var x) ? x : 0m),
                dagitimOnayda = onayda.GetValueOrDefault(b.Kod),
            };
        })
        .Where(x => x.subeSayisi > 0 || x.toplam != 0 || x.kullanim != 0)
        .ToList();

        return Ok(new
        {
            subeler,
            bolgeler,
            toplam = subeler.Sum(x => x.toplam),
            kullanim = subeler.Sum(x => x.kullanim),
            kalan = subeler.Sum(x => x.kalan),
            bekleyen = subeler.Sum(x => x.bekleyen),
        });
    }

    /// <summary>Şubenin ayrıntısı: kampanya kampanya hakediş ve hareketler.</summary>
    [HttpGet("Sube/{kod}")]
    public IActionResult Sube(string kod)
    {
        using var db = _vt.Baglanti();

        if ((kod ?? "").StartsWith(BolgeOnek, StringComparison.OrdinalIgnoreCase))
        {
            var b = Bolgeler().FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));
            var kodlar = b?.SubeKodlari ?? new List<string>();
            var bk = kodlar.Count == 0 ? new List<dynamic>() : db.Query(@"
SELECT k.id, k.ad, k.bas, k.bit, k.durum, k.birim_tutar AS birimTutar, k.bolge_payi AS bolgePayiYuzde,
       SUM(h.miktar) AS miktar, SUM(h.brut) AS brut, SUM(h.bolge_payi) AS bolgePayi, SUM(h.bolge_payi) AS net
FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id
WHERE h.sube_kodu IN @kodlar AND h.bolge_payi <> 0
GROUP BY k.id, k.ad, k.bas, k.bit, k.durum, k.birim_tutar, k.bolge_payi
ORDER BY k.bit DESC, k.id DESC", new { kodlar }).ToList();
            var bh = db.Query(@"
SELECT id, tarih, tur, tutar, aciklama, kaydeden, kayit
FROM KRY_HAVUZ_HAREKET WHERE sube_kodu = @kod
ORDER BY tarih DESC, id DESC", new { kod }).ToList();
            return Ok(new { kampanyalar = bk, hareketler = bh });
        }

        var kampanyalar = db.Query(@"
SELECT k.id, k.ad, k.bas, k.bit, k.durum, k.birim_tutar AS birimTutar, k.bolge_payi AS bolgePayiYuzde,
       h.miktar, h.brut, h.bolge_payi AS bolgePayi, h.net, h.elle
FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id
WHERE h.sube_kodu = @kod AND h.net <> 0
ORDER BY k.bit DESC, k.id DESC", new { kod }).ToList();

        var hareketler = db.Query(@"
SELECT id, tarih, tur, tutar, aciklama, kaydeden, kayit
FROM KRY_HAVUZ_HAREKET WHERE sube_kodu = @kod
ORDER BY tarih DESC, id DESC", new { kod }).ToList();

        return Ok(new { kampanyalar, hareketler });
    }

    /* ==================================================================== */
    /* Hareketler                                                           */
    /* ==================================================================== */

    public sealed class HareketGirdisi
    {
        public string SubeKodu { get; set; }
        public DateTime? Tarih { get; set; }
        public string Tur { get; set; }
        public decimal Tutar { get; set; }
        public string Aciklama { get; set; }
    }

    [HttpPost("Hareket")]
    public IActionResult HareketEkle([FromBody] HareketGirdisi g)
    {
        var sahip = SahipBul(g?.SubeKodu);
        if (sahip is null) return BadRequest(new { hata = "Şube ya da bölge bulunamadı." });
        if (!Turler.Contains(g.Tur)) return BadRequest(new { hata = "Hareket türü geçersiz." });
        if (g.Tur != "duzeltme" && g.Tutar <= 0) return BadRequest(new { hata = "Tutar sıfırdan büyük olmalı." });
        if (g.Tutar == 0) return BadRequest(new { hata = "Tutar girin." });
        if (Math.Abs(g.Tutar) > 10_000_000m) return BadRequest(new { hata = "Tutar çok büyük." });
        if (g.Tur == "kullanim" && string.IsNullOrWhiteSpace(g.Aciklama))
            return BadRequest(new { hata = "Kullanım için açıklama girin (ör. piknik, sinema)." });

        using var db = _vt.Baglanti();
        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HAVUZ_HAREKET (sube_kodu, sube_adi, tarih, tur, tutar, aciklama, kaydeden)
VALUES (@kod, @ad, @tarih, @tur, @tutar, @aciklama, @kim);
SELECT CAST(SCOPE_IDENTITY() AS INT);",
            new
            {
                kod = sahip.Value.Kod, ad = sahip.Value.Ad, tarih = (g.Tarih ?? DateTime.Today).Date, tur = g.Tur,
                tutar = Math.Round(g.Tutar, 2), aciklama = g.Aciklama?.Trim(), kim = Kullanici,
            });

        return Ok(new { id });
    }

    [HttpDelete("Hareket/{id:int}")]
    public IActionResult HareketSil(int id)
    {
        if (!GeriAlabilir) return StatusCode(403, new { hata = "Hareketi yalnızca İK yöneticisi silebilir." });
        using var db = _vt.Baglanti();
        db.Execute("DELETE FROM KRY_HAVUZ_HAREKET WHERE id = @id", new { id });
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Kampanyalar                                                          */
    /* ==================================================================== */

    [HttpGet("Kampanyalar")]
    public IActionResult Kampanyalar()
    {
        using var db = _vt.Baglanti();
        var liste = db.Query<Kampanya>(KampanyaSecim + " ORDER BY bit DESC, id DESC").ToList();
        var toplamlar = db.Query<(int id, decimal miktar, decimal brut, decimal net, int sube)>(@"
SELECT kampanya_id, SUM(miktar), SUM(brut), SUM(net), SUM(CASE WHEN net <> 0 THEN 1 ELSE 0 END)
FROM KRY_HAVUZ_HAKEDIS GROUP BY kampanya_id").ToDictionary(x => x.id);

        return Ok(liste.Select(k =>
        {
            toplamlar.TryGetValue(k.Id, out var t);
            return new
            {
                k.Id, k.Ad, stokKodlari = KodlariAyir(k.StokKodlari), k.BirimTutar, k.BolgePayi, k.Bas, k.Bit,
                k.Durum, k.Aciklama, k.Hesaplama, k.Olusturan, k.Olusturma, k.Kesinlestiren, k.Kesinlesme, k.HesapKaynagi,
                miktar = t.miktar, brut = t.brut, net = t.net, subeSayisi = t.sube,
            };
        }));
    }

    [HttpGet("Kampanya/{id:int}")]
    public IActionResult KampanyaAyrinti(int id)
    {
        using var db = _vt.Baglanti();
        var k = db.QueryFirstOrDefault<Kampanya>(KampanyaSecim + " WHERE id = @id", new { id });
        if (k is null) return NotFound(new { hata = "Kampanya bulunamadı." });
        var kayitli = db.Query<Hakedis>(HakedisSecim + " WHERE kampanya_id = @id", new { id }).ToList();

        /* Bütün şubeler: hesaplanmamış ya da satışı olmayan şubeye elle miktar girilebilsin */
        var satirlar = Subeler()
            .Select(sb => kayitli.FirstOrDefault(x => string.Equals(x.SubeKodu, sb.Kod, StringComparison.OrdinalIgnoreCase))
                          ?? new Hakedis { KampanyaId = id, SubeKodu = sb.Kod, SubeAdi = sb.Ad })
            .Concat(kayitli.Where(x => !Subeler().Any(sb => string.Equals(sb.Kod, x.SubeKodu, StringComparison.OrdinalIgnoreCase))))
            .OrderByDescending(x => x.Net).ThenBy(x => x.SubeAdi)
            .ToList();

        return Ok(new
        {
            kampanya = new
            {
                k.Id, k.Ad, stokKodlari = KodlariAyir(k.StokKodlari), k.BirimTutar, k.BolgePayi, k.Bas, k.Bit,
                k.Durum, k.Aciklama, k.Hesaplama, k.Olusturan, k.Olusturma, k.Kesinlestiren, k.Kesinlesme, k.HesapKaynagi,
            },
            satirlar,
        });
    }

    public sealed class KampanyaGirdisi
    {
        public string Ad { get; set; }
        public List<string> StokKodlari { get; set; } = new();
        public decimal BirimTutar { get; set; }
        public decimal BolgePayi { get; set; }
        public DateTime Bas { get; set; }
        public DateTime Bit { get; set; }
        public string Aciklama { get; set; }
    }

    private IActionResult Dogrula(KampanyaGirdisi g)
    {
        if (string.IsNullOrWhiteSpace(g?.Ad)) return BadRequest(new { hata = "Kampanya adı girin." });
        if (g.Ad.Trim().Length > 150) return BadRequest(new { hata = "Kampanya adı en fazla 150 karakter." });
        if (g.BirimTutar <= 0 || g.BirimTutar > 100_000m) return BadRequest(new { hata = "Birim tutar sıfırdan büyük olmalı." });
        if (g.BolgePayi < 0 || g.BolgePayi > 100) return BadRequest(new { hata = "Bölge payı 0–100 arasında olmalı." });
        if (g.Bit.Date < g.Bas.Date) return BadRequest(new { hata = "Bitiş tarihi başlangıçtan önce olamaz." });
        if ((g.Bit.Date - g.Bas.Date).TotalDays > 400) return BadRequest(new { hata = "Kampanya en fazla 400 gün olabilir." });
        if ((g.StokKodlari ?? new()).Count > 200) return BadRequest(new { hata = "En fazla 200 stok kodu girilebilir." });
        return null;
    }

    [HttpPost("Kampanya")]
    public IActionResult KampanyaEkle([FromBody] KampanyaGirdisi g)
    {
        if (Dogrula(g) is { } hata) return hata;
        using var db = _vt.Baglanti();
        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HAVUZ_KAMPANYA (ad, stok_kodlari, birim_tutar, bolge_payi, bas, bit, aciklama, olusturan)
VALUES (@ad, @kodlar, @birim, @pay, @bas, @bit, @aciklama, @kim);
SELECT CAST(SCOPE_IDENTITY() AS INT);",
            new
            {
                ad = g.Ad.Trim(), kodlar = string.Join("\n", KodlariAyir(string.Join("\n", g.StokKodlari ?? new()))),
                birim = g.BirimTutar, pay = g.BolgePayi, bas = g.Bas.Date, bit = g.Bit.Date,
                aciklama = g.Aciklama?.Trim(), kim = Kullanici,
            });
        return Ok(new { id });
    }

    [HttpPost("Kampanya/{id:int}")]
    public IActionResult KampanyaGuncelle(int id, [FromBody] KampanyaGirdisi g)
    {
        if (Dogrula(g) is { } hata) return hata;
        using var db = _vt.Baglanti();
        var durum = db.ExecuteScalar<string>("SELECT durum FROM KRY_HAVUZ_KAMPANYA WHERE id = @id", new { id });
        if (durum is null) return NotFound(new { hata = "Kampanya bulunamadı." });
        if (durum == "kesin") return BadRequest(new { hata = "Kesinleşmiş kampanya değiştirilemez; önce kesinleştirmeyi geri alın." });

        db.Execute(@"
UPDATE KRY_HAVUZ_KAMPANYA SET ad = @ad, stok_kodlari = @kodlar, birim_tutar = @birim, bolge_payi = @pay,
       bas = @bas, bit = @bit, aciklama = @aciklama
WHERE id = @id",
            new
            {
                id, ad = g.Ad.Trim(), kodlar = string.Join("\n", KodlariAyir(string.Join("\n", g.StokKodlari ?? new()))),
                birim = g.BirimTutar, pay = g.BolgePayi, bas = g.Bas.Date, bit = g.Bit.Date, aciklama = g.Aciklama?.Trim(),
            });

        /* Birim tutar ya da bölge payı değiştiyse kayıtlı miktarlarla tutarlar yeniden */
        db.Execute(@"
UPDATE KRY_HAVUZ_HAKEDIS
SET brut = ROUND(miktar * @birim, 2),
    bolge_payi = ROUND(ROUND(miktar * @birim, 2) * @pay / 100, 2),
    net = ROUND(miktar * @birim, 2) - ROUND(ROUND(miktar * @birim, 2) * @pay / 100, 2)
WHERE kampanya_id = @id", new { id, birim = g.BirimTutar, pay = g.BolgePayi });

        return Ok(new { id });
    }

    [HttpDelete("Kampanya/{id:int}")]
    public IActionResult KampanyaSil(int id)
    {
        using var db = _vt.Baglanti();
        var durum = db.ExecuteScalar<string>("SELECT durum FROM KRY_HAVUZ_KAMPANYA WHERE id = @id", new { id });
        if (durum is null) return NotFound(new { hata = "Kampanya bulunamadı." });
        if (durum == "kesin") return BadRequest(new { hata = "Kesinleşmiş kampanya silinemez; önce kesinleştirmeyi geri alın." });
        db.Execute("DELETE FROM KRY_HAVUZ_HAKEDIS WHERE kampanya_id = @id; DELETE FROM KRY_HAVUZ_KAMPANYA WHERE id = @id;", new { id });
        return Ok(new { tamam = true });
    }

    /// <summary>
    /// Şube satış miktarlarını Mikro'dan hesaplar ve hakediş satırlarını
    /// yeniler. Elle düzeltilmiş satırlar korunur (tumu = true ise onlar da
    /// yenilenir).
    /// </summary>
    [HttpPost("Kampanya/{id:int}/Hesapla")]
    public IActionResult Hesapla(int id, [FromQuery] bool tumu = false)
    {
        using var db = _vt.Baglanti();
        var k = db.QueryFirstOrDefault<Kampanya>(KampanyaSecim + " WHERE id = @id", new { id });
        if (k is null) return NotFound(new { hata = "Kampanya bulunamadı." });
        if (k.Durum == "kesin") return BadRequest(new { hata = "Kesinleşmiş kampanya yeniden hesaplanamaz." });
        if (string.Equals(k.HesapKaynagi, "satinalma", StringComparison.OrdinalIgnoreCase))
            return Conflict(new { hata = "Bu kampanyanın hakedişini satınalma hesaplıyor; Mikro'dan hesaplama kapalı. Şube satırını elle düzeltebilirsiniz." });

        var kodlar = KodlariAyir(k.StokKodlari);
        if (kodlar.Count == 0) return BadRequest(new { hata = "Kampanyaya stok kodu girilmemiş; miktarları elle girebilirsiniz." });

        List<(int depo, string depoAdi, decimal miktar)> satis;
        try
        {
            using var mikro = _vt.CiroBaglantisi();
            satis = mikro.Query<(int depo, string depoAdi, decimal miktar)>(@"
SELECT x.depo, ISNULL(d.dep_adi, '') AS depoAdi, SUM(x.miktar) AS miktar
FROM (
    SELECT CASE WHEN h.sth_tip = 1 THEN h.sth_cikis_depo_no ELSE h.sth_giris_depo_no END AS depo,
           (CASE WHEN h.sth_tip = 1 THEN 1 ELSE -1 END) * h.sth_miktar AS miktar
    FROM STOK_HAREKETLERI h WITH (NOLOCK)
    WHERE h.sth_tarih >= @bas AND h.sth_tarih < @son
      AND h.sth_stok_kod IN @kodlar
      AND h.sth_cins IN (0,1)
      AND ((h.sth_tip = 1 AND h.sth_normal_iade = 0 AND h.sth_evraktip IN (1,4))
        OR (h.sth_tip = 0 AND h.sth_normal_iade = 1))
) x
LEFT JOIN DEPOLAR d WITH (NOLOCK) ON d.dep_no = x.depo
GROUP BY x.depo, d.dep_adi",
                new { bas = k.Bas.Date, son = k.Bit.Date.AddDays(1), kodlar }, commandTimeout: 240).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Havuz kampanyası Mikro'dan hesaplanamadı: {Id}", id);
            return StatusCode(502, new { hata = "Mikro satış verisi alınamadı.", ayrinti = hata.Message });
        }

        var subeler = Subeler();
        var mevcut = db.Query<Hakedis>(HakedisSecim + " WHERE kampanya_id = @id", new { id })
            .ToDictionary(x => x.SubeKodu, StringComparer.OrdinalIgnoreCase);

        var eslesmeyen = new List<object>();
        var subeMiktar = subeler.ToDictionary(s => s.Kod, _ => 0m, StringComparer.OrdinalIgnoreCase);

        foreach (var s in satis)
        {
            var sube = subeler.FirstOrDefault(x => DepoSube(s.depo, s.depoAdi, x));
            if (sube is null)
            {
                if (s.miktar != 0) eslesmeyen.Add(new { depo = s.depo, ad = s.depoAdi, miktar = s.miktar });
                continue;
            }
            subeMiktar[sube.Kod] += s.miktar;
        }

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var islem = db.BeginTransaction();
        foreach (var s in subeler)
        {
            if (mevcut.TryGetValue(s.Kod, out var m) && m.Elle && !tumu) continue;
            var miktar = Math.Max(0, Math.Round(subeMiktar[s.Kod], 3));
            var (brut, pay, net) = Tutarlar(miktar, k.BirimTutar, k.BolgePayi);

            db.Execute(@"
MERGE KRY_HAVUZ_HAKEDIS AS h
USING (SELECT @id AS kampanya_id, @kod AS sube_kodu) AS y
   ON h.kampanya_id = y.kampanya_id AND h.sube_kodu = y.sube_kodu
WHEN MATCHED THEN UPDATE SET sube_adi = @ad, miktar = @miktar, brut = @brut, bolge_payi = @pay, net = @net, elle = 0
WHEN NOT MATCHED THEN INSERT (kampanya_id, sube_kodu, sube_adi, miktar, brut, bolge_payi, net, elle)
     VALUES (@id, @kod, @ad, @miktar, @brut, @pay, @net, 0);",
                new { id, kod = s.Kod, ad = s.Ad, miktar, brut, pay, net }, islem);
        }
        db.Execute("UPDATE KRY_HAVUZ_KAMPANYA SET hesaplama = SYSDATETIME() WHERE id = @id", new { id }, islem);
        islem.Commit();

        return Ok(new { tamam = true, eslesmeyen });
    }

    public sealed class SatirGirdisi
    {
        public string SubeKodu { get; set; }
        public decimal Miktar { get; set; }
    }

    /// <summary>Şube satırını elle düzeltir (miktar); tutarlar yeniden hesaplanır.</summary>
    [HttpPost("Kampanya/{id:int}/Satir")]
    public IActionResult SatirDuzelt(int id, [FromBody] SatirGirdisi g)
    {
        if (g is null || g.Miktar < 0 || g.Miktar > 100_000_000m) return BadRequest(new { hata = "Miktar geçersiz." });
        using var db = _vt.Baglanti();
        var k = db.QueryFirstOrDefault<Kampanya>(KampanyaSecim + " WHERE id = @id", new { id });
        if (k is null) return NotFound(new { hata = "Kampanya bulunamadı." });
        if (k.Durum == "kesin") return BadRequest(new { hata = "Kesinleşmiş kampanya değiştirilemez." });
        var sube = Subeler().FirstOrDefault(x => string.Equals(x.Kod, g.SubeKodu, StringComparison.OrdinalIgnoreCase));
        if (sube is null) return BadRequest(new { hata = "Şube bulunamadı." });

        var miktar = Math.Round(g.Miktar, 3);
        var (brut, pay, net) = Tutarlar(miktar, k.BirimTutar, k.BolgePayi);
        db.Execute(@"
MERGE KRY_HAVUZ_HAKEDIS AS h
USING (SELECT @id AS kampanya_id, @kod AS sube_kodu) AS y
   ON h.kampanya_id = y.kampanya_id AND h.sube_kodu = y.sube_kodu
WHEN MATCHED THEN UPDATE SET miktar = @miktar, brut = @brut, bolge_payi = @pay, net = @net, elle = 1
WHEN NOT MATCHED THEN INSERT (kampanya_id, sube_kodu, sube_adi, miktar, brut, bolge_payi, net, elle)
     VALUES (@id, @kod, @ad, @miktar, @brut, @pay, @net, 1);",
            new { id, kod = sube.Kod, ad = sube.Ad, miktar, brut, pay, net });
        return Ok(new { miktar, brut, bolgePayi = pay, net });
    }

    public sealed class AktarSatiri
    {
        /// <summary>Excel'deki şube / depo adı</summary>
        public string Ad { get; set; }
        /// <summary>Elle seçilen şube (eşleşmeyen satır için)</summary>
        public string SubeKodu { get; set; }
        public decimal Miktar { get; set; }
    }

    public sealed class AktarGirdisi
    {
        public List<AktarSatiri> Satirlar { get; set; }
        /// <summary>true: yalnızca eşleşmeyi gösterir, yazmaz.</summary>
        public bool Onizleme { get; set; }
    }

    /// <summary>
    /// Excel'den şube satış miktarları (Mikro "şube bazlı satış" raporu ya da
    /// Şube / Miktar listesi). Adlar şubelerle eşleştirilir; eşleşen satırlar
    /// elle girilmiş sayılır (yeniden hesaplamada korunur). Excel'de olmayan
    /// şubelere dokunulmaz.
    /// </summary>
    [HttpPost("Kampanya/{id:int}/MiktarAktar")]
    public IActionResult MiktarAktar(int id, [FromBody] AktarGirdisi g)
    {
        if (g?.Satirlar is not { Count: > 0 }) return BadRequest(new { hata = "Excel'de şube satırı bulunamadı." });
        using var db = _vt.Baglanti();
        var k = db.QueryFirstOrDefault<Kampanya>(KampanyaSecim + " WHERE id = @id", new { id });
        if (k is null) return NotFound(new { hata = "Kampanya bulunamadı." });
        if (k.Durum == "kesin") return BadRequest(new { hata = "Kesinleşmiş kampanya değiştirilemez." });

        var subeler = Subeler();
        var eslesen = new Dictionary<string, (Sube Sube, decimal Miktar, List<string> Adlar)>(StringComparer.OrdinalIgnoreCase);
        var eslesmeyen = new List<object>();

        foreach (var x in g.Satirlar.Where(x => !string.IsNullOrWhiteSpace(x.Ad)))
        {
            var ad = x.Ad.Trim();
            var sb = (string.IsNullOrWhiteSpace(x.SubeKodu) ? null
                         : subeler.FirstOrDefault(s => string.Equals(s.Kod, x.SubeKodu.Trim(), StringComparison.OrdinalIgnoreCase)))
                     ?? subeler.FirstOrDefault(s => AdEs(s.Ad, ad))
                     ?? subeler.FirstOrDefault(s => string.Equals((s.Kod ?? "").Trim(), ad, StringComparison.OrdinalIgnoreCase))
                     ?? subeler.FirstOrDefault(s => PersonelKaynagiServisi.Benziyor(ad, s.Ad.Trim()));
            if (sb is null)
            {
                if (x.Miktar != 0) eslesmeyen.Add(new { ad, miktar = x.Miktar });
                continue;
            }
            eslesen[sb.Kod] = eslesen.TryGetValue(sb.Kod, out var e)
                ? (sb, e.Miktar + x.Miktar, e.Adlar.Append(ad).ToList())
                : (sb, x.Miktar, new List<string> { ad });
        }

        var liste = eslesen.Values
            .Select(e =>
            {
                var m = Math.Round(Math.Max(0, e.Miktar), 3);
                var (brut, pay, net) = Tutarlar(m, k.BirimTutar, k.BolgePayi);
                return new { subeKodu = e.Sube.Kod, subeAdi = e.Sube.Ad, excelAdi = string.Join(", ", e.Adlar), miktar = m, brut, bolgePayi = pay, net };
            })
            .OrderByDescending(x => x.miktar)
            .ToList();

        if (!g.Onizleme)
        {
            if (db.State != System.Data.ConnectionState.Open) db.Open();
            using var tx = db.BeginTransaction();
            foreach (var x in liste)
                db.Execute(@"
MERGE KRY_HAVUZ_HAKEDIS AS h
USING (SELECT @id AS kampanya_id, @kod AS sube_kodu) AS y
   ON h.kampanya_id = y.kampanya_id AND h.sube_kodu = y.sube_kodu
WHEN MATCHED THEN UPDATE SET sube_adi = @ad, miktar = @miktar, brut = @brut, bolge_payi = @pay, net = @net, elle = 1
WHEN NOT MATCHED THEN INSERT (kampanya_id, sube_kodu, sube_adi, miktar, brut, bolge_payi, net, elle)
     VALUES (@id, @kod, @ad, @miktar, @brut, @pay, @net, 1);",
                    new { id, kod = x.subeKodu, ad = x.subeAdi, x.miktar, x.brut, pay = x.bolgePayi, x.net }, tx);
            db.Execute("UPDATE KRY_HAVUZ_KAMPANYA SET hesaplama = SYSDATETIME() WHERE id = @id", new { id }, tx);
            tx.Commit();
        }

        return Ok(new
        {
            satirlar = liste,
            eslesmeyen,
            toplamMiktar = liste.Sum(x => x.miktar),
            toplamNet = liste.Sum(x => x.net),
            yazildi = !g.Onizleme,
        });
    }

    [HttpPost("Kampanya/{id:int}/Kesinlestir")]
    public IActionResult Kesinlestir(int id)
    {
        using var db = _vt.Baglanti();
        var n = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HAVUZ_HAKEDIS WHERE kampanya_id = @id AND net <> 0", new { id });
        if (n == 0) return BadRequest(new { hata = "Hakediş yok: önce Mikro'dan hesaplayın ya da miktarları girin." });
        var etkilenen = db.Execute(@"
UPDATE KRY_HAVUZ_KAMPANYA SET durum = N'kesin', kesinlestiren = @kim, kesinlesme = SYSDATETIME()
WHERE id = @id AND durum = N'taslak'", new { id, kim = Kullanici });
        if (etkilenen == 0) return BadRequest(new { hata = "Kampanya bulunamadı ya da zaten kesin." });
        return Ok(new { tamam = true });
    }

    [HttpPost("Kampanya/{id:int}/GeriAl")]
    public IActionResult GeriAl(int id)
    {
        if (!GeriAlabilir) return StatusCode(403, new { hata = "Kesinleştirmeyi yalnızca İK yöneticisi geri alabilir." });
        using var db = _vt.Baglanti();
        db.Execute(@"UPDATE KRY_HAVUZ_KAMPANYA SET durum = N'taslak', kesinlestiren = NULL, kesinlesme = NULL WHERE id = @id", new { id });
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Excel devri (19.10.2026)                                             */
    /* ==================================================================== */

    /*  "MAĞAZA HAVUZ RAPORU" Excel'i panelde (tarayıcıda) çözülüp buraya
        satırlar olarak gelir:
          - BİRİKEN KAMPANYALAR: her ürün bloğu bir kampanya; şube başına
            satış miktarı, bölge payı ve şubeye kalan tutar Excel'deki gibi
            (yeniden hesaplanmaz).
          - ÖDENENLER: şube adına olanlar şubenin, bölge müdürü adına
            olanlar bölgesinin kullanımı.
          - ÖZET: Excel'in hesapladığı kalan; önizlemede sistemin
            hesabıyla karşılaştırılır.
          - Bölge müdürü ek tutarı (Algida): bölge havuzuna açılış.
        Bölge müdürü adı şubelerinin (Excel'de BÖLGELER sütunu) sistemdeki
        bölgesiyle eşleştirilir. Önizleme hiçbir şey yazmaz.            */

    public sealed class DevirSatiri
    {
        public string Sube { get; set; }
        public decimal Miktar { get; set; }
        public decimal Bolge { get; set; }
        public decimal Net { get; set; }
    }

    public sealed class DevirKampanya
    {
        public string Ad { get; set; }
        public List<DevirSatiri> Satirlar { get; set; } = new();
    }

    public sealed class DevirTutar
    {
        public string Ad { get; set; }
        public decimal Tutar { get; set; }
        public int Satir { get; set; }
    }

    public sealed class DevirSubeBolge
    {
        public string Sube { get; set; }
        public string Mudur { get; set; }
    }

    public sealed class DevirGirdisi
    {
        public DateTime? Tarih { get; set; }
        public List<DevirKampanya> Kampanyalar { get; set; } = new();
        public List<DevirTutar> Odemeler { get; set; } = new();
        public List<DevirTutar> BolgeEk { get; set; } = new();
        public List<DevirTutar> OzetKalan { get; set; } = new();
        public List<DevirTutar> BolgeOzetKalan { get; set; } = new();
        public List<DevirSubeBolge> SubeBolge { get; set; } = new();
        /// <summary>Atlanacak ödeme satırları (Excel satır no)</summary>
        public List<int> AtlananOdemeler { get; set; } = new();
        /// <summary>Kapalı şubeye ait olduğu için kendiliğinden atlanan ama kullanıcının dahil ettiği satırlar</summary>
        public List<int> DahilOdemeler { get; set; } = new();
    }

    /// <summary>Excel şube adını sistem şubesine eşler ("AVCILAR 2" = "AVCILAR-2", "ATAKENT LIFE" = "ATAKENT").</summary>
    private static Sube SubeEsle(string ad, List<Sube> subeler)
    {
        if (string.IsNullOrWhiteSpace(ad)) return null;
        var a = PersonelKaynagiServisi.DuzAnahtar(ad);
        var tam = subeler.FirstOrDefault(s => PersonelKaynagiServisi.DuzAnahtar(s.Ad) == a);
        if (tam is not null) return tam;
        var benzer = subeler.Where(s => PersonelKaynagiServisi.Benziyor(ad.Trim(), s.Ad.Trim())).ToList();
        if (benzer.Count == 1) return benzer[0];
        /* "ATAKENT LIFE" → "ATAKENT": biri ötekinin başıysa ve tek adaysa */
        var bas = subeler.Where(s =>
        {
            var b = PersonelKaynagiServisi.DuzAnahtar(s.Ad);
            return b.Length >= 4 && (a.StartsWith(b) || b.StartsWith(a));
        }).ToList();
        return bas.Count == 1 ? bas[0] : null;
    }

    private static bool KisiEs(string a, string b)
    {
        var x = PersonelKaynagiServisi.DuzAnahtar(a);
        var y = PersonelKaynagiServisi.DuzAnahtar(b);
        if (x.Length == 0 || y.Length == 0) return false;
        if (x == y) return true;
        /* "EMRE ARSLAN" / "EMRE ASLAN": tek harf farkı */
        if (Math.Abs(x.Length - y.Length) > 1) return false;
        int i = 0, j = 0, fark = 0;
        while (i < x.Length && j < y.Length)
        {
            if (x[i] == y[j]) { i++; j++; continue; }
            if (++fark > 1) return false;
            if (x.Length > y.Length) i++;
            else if (y.Length > x.Length) j++;
            else { i++; j++; }
        }
        return fark + (x.Length - i) + (y.Length - j) <= 1;
    }

    [HttpPost("Devir")]
    public IActionResult Devir([FromBody] DevirGirdisi g, [FromQuery] bool onizleme = true)
    {
        if (g is null || g.Kampanyalar.Count == 0)
            return BadRequest(new { hata = "Excel'de kampanya bulunamadı ('BİRİKEN KAMPANYALAR' sayfası)." });
        if (g.Kampanyalar.Count > 200) return BadRequest(new { hata = "Çok fazla kampanya." });

        var tarih = (g.Tarih ?? DateTime.Today).Date;
        var subeler = Subeler();
        var bolgeler = Bolgeler();

        /* ---- şube eşleşmeleri */
        var tumAdlar = g.Kampanyalar.SelectMany(k => k.Satirlar.Select(x => x.Sube))
            .Concat(g.SubeBolge.Select(x => x.Sube))
            .Concat(g.OzetKalan.Select(x => x.Ad))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var subeEs = tumAdlar.ToDictionary(x => x, x => SubeEsle(x, subeler), StringComparer.OrdinalIgnoreCase);

        /* ---- kapalı şubeler (19.10.2026): Excel'de bütün kampanya değerleri
           boş ya da #N/A olan şubeler (ÜÇEVLER, SAKLIHAN). Eşleşmeme uyarısı
           verilmez; adlarına ödeme varsa kendiliğinden atlanır. */
        var veriliSubeler = g.Kampanyalar.SelectMany(k => k.Satirlar)
            .Where(x => x.Miktar != 0 || x.Net != 0 || x.Bolge != 0)
            .Select(x => PersonelKaynagiServisi.DuzAnahtar(x.Sube))
            .ToHashSet();
        var kapaliSubeler = g.SubeBolge.Select(x => x.Sube?.Trim() ?? "")
            .Where(x => x.Length > 0 && !veriliSubeler.Contains(PersonelKaynagiServisi.DuzAnahtar(x)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        bool KapaliMi(string ad) =>
            kapaliSubeler.Any(k => PersonelKaynagiServisi.DuzAnahtar(k) == PersonelKaynagiServisi.DuzAnahtar(ad)
                                   || PersonelKaynagiServisi.Benziyor(k, (ad ?? "").Trim()));

        /* ---- bölge müdürü → sistem bölgesi (şubelerinin çoğunluğu) */
        var mudurler = g.SubeBolge.Where(x => !string.IsNullOrWhiteSpace(x.Mudur))
            .Select(x => x.Mudur.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var mudurBolge = new Dictionary<string, Bolge>(StringComparer.OrdinalIgnoreCase);
        foreach (var m in mudurler)
        {
            var aday = g.SubeBolge
                .Where(x => string.Equals(x.Mudur?.Trim(), m, StringComparison.OrdinalIgnoreCase))
                .Select(x => subeEs.TryGetValue(x.Sube?.Trim() ?? "", out var sb) ? sb : null)
                .Where(x => x is not null)
                .SelectMany(sb => bolgeler.Where(b => b.SubeKodlari.Contains(sb.Kod, StringComparer.OrdinalIgnoreCase)))
                .GroupBy(b => b.Kod)
                .OrderByDescending(x => x.Count())
                .Select(x => x.First())
                .FirstOrDefault();
            aday ??= bolgeler.FirstOrDefault(b => KisiEs(b.Ad, m) || PersonelKaynagiServisi.DuzAnahtar(b.Ad).Contains(PersonelKaynagiServisi.DuzAnahtar(m)));
            if (aday is not null) mudurBolge[m] = aday;
        }
        Bolge MudurBul(string ad) =>
            mudurBolge.TryGetValue(ad?.Trim() ?? "", out var b) ? b
            : mudurBolge.Where(x => KisiEs(x.Key, ad)).Select(x => x.Value).FirstOrDefault();

        /* ---- ödemeler: şube mi bölge müdürü mü */
        var odemeler = g.Odemeler.Where(o => o.Tutar != 0).Select(o =>
        {
            var sb = SubeEsle(o.Ad, subeler);
            var bl = sb is null ? MudurBul(o.Ad) : null;
            var kapali = KapaliMi(o.Ad);
            var atla = g.AtlananOdemeler.Contains(o.Satir) || (kapali && !g.DahilOdemeler.Contains(o.Satir));
            return new
            {
                o.Satir,
                excelAd = o.Ad,
                o.Tutar,
                kod = sb?.Kod ?? bl?.Kod,
                sistemAd = sb?.Ad ?? (bl is null ? null : $"{bl.Ad} (bölge)"),
                bolge = bl is not null,
                atla,
                kapali,
            };
        }).ToList();

        /* ---- sistemde oluşacak kalanlar */
        var subeKalan = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var bolgeKalan = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var k in g.Kampanyalar)
            foreach (var x in k.Satirlar)
                if (subeEs.TryGetValue(x.Sube?.Trim() ?? "", out var sb) && sb is not null)
                {
                    subeKalan[sb.Kod] = subeKalan.GetValueOrDefault(sb.Kod) + x.Net;
                    foreach (var b in bolgeler.Where(b => b.SubeKodlari.Contains(sb.Kod, StringComparer.OrdinalIgnoreCase)))
                        bolgeKalan[b.Kod] = bolgeKalan.GetValueOrDefault(b.Kod) + x.Bolge;
                }
        foreach (var e in g.BolgeEk)
            if (MudurBul(e.Ad) is { } b) bolgeKalan[b.Kod] = bolgeKalan.GetValueOrDefault(b.Kod) + e.Tutar;
        foreach (var o in odemeler.Where(o => o.kod is not null && !o.atla))
            if (o.bolge) bolgeKalan[o.kod] = bolgeKalan.GetValueOrDefault(o.kod) - o.Tutar;
            else subeKalan[o.kod] = subeKalan.GetValueOrDefault(o.kod) - o.Tutar;

        var karsilastirma = g.OzetKalan.Select(o =>
        {
            var sb = subeEs.TryGetValue(o.Ad?.Trim() ?? "", out var x) ? x : SubeEsle(o.Ad, subeler);
            var sistem = sb is null ? (decimal?)null : Math.Round(subeKalan.GetValueOrDefault(sb.Kod), 2);
            return new { excelAd = o.Ad, sistemAd = sb?.Ad, excel = Math.Round(o.Tutar, 2), sistem, fark = sistem is null ? (decimal?)null : sistem - Math.Round(o.Tutar, 2) };
        })
        .Concat(g.BolgeOzetKalan.Select(o =>
        {
            var b = MudurBul(o.Ad);
            var sistem = b is null ? (decimal?)null : Math.Round(bolgeKalan.GetValueOrDefault(b.Kod), 2);
            return new { excelAd = o.Ad, sistemAd = b is null ? null : $"{b.Ad} (bölge)", excel = Math.Round(o.Tutar, 2), sistem, fark = sistem is null ? (decimal?)null : sistem - Math.Round(o.Tutar, 2) };
        }))
        .ToList();

        var eslesmeyenSube = subeEs.Where(x => x.Value is null && !KapaliMi(x.Key)).Select(x => x.Key).OrderBy(x => x).ToList();

        using var db = _vt.Baglanti();
        var oncekiDevir = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HAVUZ_KAMPANYA WHERE aciklama LIKE N'Excel devri%'");

        var kampanyaOzet = g.Kampanyalar.Select(k => new
        {
            ad = k.Ad,
            sube = k.Satirlar.Count(x => x.Miktar != 0 || x.Net != 0),
            miktar = k.Satirlar.Sum(x => x.Miktar),
            bolge = k.Satirlar.Sum(x => x.Bolge),
            net = k.Satirlar.Sum(x => x.Net),
        }).ToList();

        if (onizleme)
            return Ok(new
            {
                oncekiDevir,
                kampanyalar = kampanyaOzet,
                subeEslesme = subeEs.Select(x => new { excelAd = x.Key, sistemAd = x.Value?.Ad }).OrderBy(x => x.excelAd).ToList(),
                eslesmeyenSube,
                kapaliSubeler,
                mudurler = mudurler.Select(m => new { ad = m, bolge = MudurBul(m)?.Ad }).ToList(),
                odemeler,
                karsilastirma,
            });

        if (oncekiDevir > 0)
            return BadRequest(new { hata = "Excel devri daha önce yapılmış. Tekrar aktarmak için önceki devir kampanyalarını silin (önce kesinleştirmeyi geri alın)." });

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var islem = db.BeginTransaction();
        var kampanyaSayisi = 0;
        var hareketSayisi = 0;

        foreach (var k in g.Kampanyalar)
        {
            var satirlar = k.Satirlar
                .Select(x => (x, sb: subeEs.TryGetValue(x.Sube?.Trim() ?? "", out var s) ? s : null))
                .Where(t => t.sb is not null && (t.x.Miktar != 0 || t.x.Net != 0 || t.x.Bolge != 0))
                .GroupBy(t => t.sb.Kod)
                .Select(gr => (sb: gr.First().sb, miktar: gr.Sum(t => t.x.Miktar), bolge: gr.Sum(t => t.x.Bolge), net: gr.Sum(t => t.x.Net)))
                .ToList();
            if (satirlar.Count == 0) continue;

            var miktarT = satirlar.Sum(x => x.miktar);
            var brutT = satirlar.Sum(x => x.bolge + x.net);
            var birim = miktarT > 0 ? Math.Round(brutT / miktarT, 4) : 0m;
            var pay = brutT > 0 ? Math.Round(satirlar.Sum(x => x.bolge) * 100m / brutT, 2) : 0m;

            var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HAVUZ_KAMPANYA (ad, stok_kodlari, birim_tutar, bolge_payi, bas, bit, durum, aciklama, olusturan, kesinlestiren, kesinlesme, hesaplama)
VALUES (@ad, NULL, @birim, @pay, @tarih, @tarih, N'kesin', @aciklama, @kim, @kim, SYSDATETIME(), SYSDATETIME());
SELECT CAST(SCOPE_IDENTITY() AS INT);",
                new { ad = (k.Ad ?? "Kampanya").Trim().Length > 150 ? k.Ad.Trim()[..150] : (k.Ad ?? "Kampanya").Trim(), birim, pay, tarih, aciklama = "Excel devri (MAĞAZA HAVUZ RAPORU)", kim = Kullanici }, islem);

            foreach (var x in satirlar)
                db.Execute(@"
INSERT INTO KRY_HAVUZ_HAKEDIS (kampanya_id, sube_kodu, sube_adi, miktar, brut, bolge_payi, net, elle)
VALUES (@id, @kod, @ad, @miktar, @brut, @bolge, @net, 1)",
                    new { id, kod = x.sb.Kod, ad = x.sb.Ad, miktar = Math.Round(x.miktar, 3), brut = Math.Round(x.bolge + x.net, 2), bolge = Math.Round(x.bolge, 2), net = Math.Round(x.net, 2) }, islem);
            kampanyaSayisi++;
        }

        void Hareket(string kod, string ad, string tur, decimal tutar, string aciklama)
        {
            db.Execute(@"
INSERT INTO KRY_HAVUZ_HAREKET (sube_kodu, sube_adi, tarih, tur, tutar, aciklama, kaydeden)
VALUES (@kod, @ad, @tarih, @tur, @tutar, @aciklama, @kim)",
                new { kod, ad, tarih, tur, tutar = Math.Round(tutar, 2), aciklama, kim = Kullanici }, islem);
            hareketSayisi++;
        }

        foreach (var o in odemeler.Where(o => o.kod is not null && !o.atla))
            Hareket(o.kod, o.sistemAd?.Replace(" (bölge)", ""), "kullanim", o.Tutar,
                $"Excel devri · ödenen ({o.excelAd}, satır {o.Satir})");

        foreach (var e in g.BolgeEk.Where(x => x.Tutar != 0))
            if (MudurBul(e.Ad) is { } b)
                Hareket(b.Kod, b.Ad, "acilis", e.Tutar, $"Excel devri · bölge müdürüne özel ek tutar ({e.Ad})");

        islem.Commit();

        return Ok(new { kampanya = kampanyaSayisi, hareket = hareketSayisi, eslesmeyenSube });
    }

    /* ==================================================================== */
    /* Biçen Kart'a dağıtım (19.10.2026)                                    */
    /* ==================================================================== */

    /*  Havuz, şubenin bugün çalışan bütün personeline eşit bölünüp
        Biçen Kart'larına yüklenir. Puan yükleme talebi olarak açılır
        (Biçen Kart › Puan Yönetimi ile aynı akış): Admin onaylayınca
        kartlara yazılır ve tutar havuzdan kullanım olarak düşer;
        reddedilirse havuz değişmez. Kartı eşleşmemiş personel payı
        almaz (bölüşüme girmez), listede uyarı olarak görünür. Kişi başı
        tutar kuruşa yuvarlanır (aşağı); artan kuruş havuzda kalır.     */

    private sealed record DagitimKisi(string Sicil, string AdSoyad, string Pozisyon, DateTime? Giris, string KartNo, string Sube = null);

    private List<DagitimKisi> SubePersoneli(Sube sube)
    {
        var kisiler = _personel.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .Where(x => AdEs(x.IsGrubu, sube.Ad) || PersonelKaynagiServisi.Benziyor((x.IsGrubu ?? "").Trim(), sube.Ad.Trim()))
            .ToList();
        return KartlariEsle(kisiler, sube.Ad);
    }

    /// <summary>
    /// Bölge havuzunun dağıtımı. 26.10.2026: bölge havuzu bölge müdürünün
    /// hak edişi; yalnız o bölgenin müdürünün Biçen Kart'ına aktarılır.
    /// Bölge, İK ayarında bölge müdürünün adıyla tanımlı ("Emre ARSLAN");
    /// kişi adından bulunur. Şubelerin onay tablosundaki bütün bölge
    /// müdürlerini almak (önceki sürüm) başka bölgenin müdürlerini de
    /// listeye katıyordu.
    /// </summary>
    private List<DagitimKisi> BolgePersoneli(Bolge b)
    {
        var anahtar = PersonelKaynagiServisi.DuzAnahtar(b.Ad);
        var adaylar = _personel.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .Where(x => PersonelKaynagiServisi.DuzAnahtar($"{x.Ad} {x.Soyad}") == anahtar)
            .ToList();

        /* Aynı adda birden çok kişi varsa bölge müdürü pozisyonundaki */
        if (adaylar.Count > 1)
        {
            var mudur = adaylar.Where(x => EkipServisi.BolgeMuduruMu(x.Pozisyon)).ToList();
            if (mudur.Count > 0) adaylar = mudur;
        }

        if (adaylar.Count == 0)
            _kayit.LogWarning("Bölge havuzu için bölge müdürü bulunamadı: {Bolge}", b.Ad);

        return KartlariEsle(adaylar.Take(1).ToList(), $"{b.Ad} · bölge müdürü");
    }

    private List<DagitimKisi> KartlariEsle(List<PersonelKaydi> liste, string sube)
    {
        static string K(string s) => (s ?? "").Trim().TrimStart('0');

        var kisiler = liste
            .GroupBy(x => K(x.PersonelKodu))
            .Select(g => g.First())
            .ToList();

        using var db = _vt.Baglanti();
        var kartlar = db.Query<(string kart, string kod, DateTime es)>(
                "SELECT kart_no, personel_kodu, eslesme FROM KRY_KART_ESLESME")
            .GroupBy(x => K(x.kod))
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.es).First().kart.Trim());

        return kisiler
            .Select(x => new DagitimKisi(x.PersonelKodu.Trim(), $"{x.Ad} {x.Soyad}".Trim(), x.Pozisyon, x.GirisTarihi,
                kartlar.TryGetValue(K(x.PersonelKodu), out var k) ? k : null, sube))
            .OrderBy(x => x.AdSoyad, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
            .ToList();
    }

    /// <summary>Dağıtım yapılabilecek havuz: şube ya da bölge</summary>
    private sealed record DagitimHavuzu(string Kod, string Ad, bool Bolge, Sube SubeKaydi, Bolge BolgeKaydi);

    private DagitimHavuzu DagitimSahibi(string kod)
    {
        var sb = Subeler().FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));
        if (sb is not null) return new DagitimHavuzu(sb.Kod, sb.Ad, false, sb, null);
        var b = Bolgeler().FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase));
        return b is null ? null : new DagitimHavuzu(b.Kod, b.Ad, true, null, b);
    }

    private List<DagitimKisi> HavuzKisileri(DagitimHavuzu h) =>
        h.Bolge ? BolgePersoneli(h.BolgeKaydi) : SubePersoneli(h.SubeKaydi);

    /// <summary>Kartı Posback'te gerçekten var mı.</summary>
    private HashSet<string> VarOlanKartlar(IEnumerable<string> kartlar)
    {
        var liste = kartlar.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        var sonuc = new HashSet<string>();
        if (liste.Count == 0) return sonuc;
        using var pos = _vt.PosBaglantisi();
        foreach (var parca in liste.Chunk(400))
            foreach (var k in pos.Query<string>(
                         "SELECT CONVERT(VARCHAR(50), KartNo) FROM [PosbackPromosyon].[dbo].[MusteriKart] WHERE KartNo IN @parca",
                         new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120))
                sonuc.Add((k ?? "").Trim());
        return sonuc;
    }

    private decimal Kullanilabilir(IDbConnection db, string kod)
    {
        /* Bölge havuzu: şubelerinin kesin kampanyalardaki bölge payı */
        var bolge = (kod ?? "").StartsWith(BolgeOnek, StringComparison.OrdinalIgnoreCase)
            ? Bolgeler().FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))
            : null;
        var hakedis = bolge is not null
            ? (bolge.SubeKodlari.Count == 0 ? 0m : db.ExecuteScalar<decimal?>(@"
SELECT SUM(h.bolge_payi) FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id AND k.durum = N'kesin'
WHERE h.sube_kodu IN @kodlar", new { kodlar = bolge.SubeKodlari }) ?? 0m)
            : db.ExecuteScalar<decimal?>(@"
SELECT SUM(h.net) FROM KRY_HAVUZ_HAKEDIS h
INNER JOIN KRY_HAVUZ_KAMPANYA k ON k.id = h.kampanya_id AND k.durum = N'kesin'
WHERE h.sube_kodu = @kod", new { kod }) ?? 0m;
        var hareket = db.ExecuteScalar<decimal?>(@"
SELECT SUM(CASE WHEN tur = N'kullanim' THEN -tutar ELSE tutar END) FROM KRY_HAVUZ_HAREKET WHERE sube_kodu = @kod",
            new { kod }) ?? 0m;
        decimal onayda = 0;
        try
        {
            onayda = db.ExecuteScalar<decimal?>(@"
SELECT SUM(toplam_puan) FROM KRY_PUAN_TALEP WHERE havuz_kodu = @kod AND durum IN (N'bekliyor', N'isleniyor')",
                new { kod }) ?? 0m;
        }
        catch { }
        return hakedis + hareket - onayda;
    }

    [HttpGet("Dagitim/{kod}")]
    public IActionResult DagitimOnizleme(string kod)
    {
        var sube = DagitimSahibi(kod);
        if (sube is null) return BadRequest(new { hata = "Şube ya da bölge havuzu bulunamadı." });

        List<DagitimKisi> kisiler;
        HashSet<string> varOlan;
        try
        {
            kisiler = HavuzKisileri(sube);
            varOlan = VarOlanKartlar(kisiler.Select(x => x.KartNo));
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Havuz dağıtımı için personel/kart okunamadı");
            return StatusCode(502, new { hata = "Personel ya da kart bilgisi alınamadı.", ayrinti = hata.Message });
        }

        using var db = _vt.Baglanti();
        var bekleyen = db.QueryFirstOrDefault<int?>(@"
SELECT TOP 1 id FROM KRY_PUAN_TALEP WHERE havuz_kodu = @kod AND durum IN (N'bekliyor', N'isleniyor')", new { kod = sube.Kod });

        return Ok(new
        {
            sube = sube.Ad,
            kullanilabilir = Kullanilabilir(db, sube.Kod),
            bekleyenTalep = bekleyen,
            kisiler = kisiler.Select(x => new
            {
                sicil = x.Sicil,
                adSoyad = x.AdSoyad,
                pozisyon = x.Pozisyon,
                giris = x.Giris,
                sube = x.Sube,
                kartNo = x.KartNo,
                kartVar = x.KartNo is not null && varOlan.Contains(x.KartNo),
            }),
        });
    }

    public sealed class DagitimGirdisi
    {
        public decimal Tutar { get; set; }
        public List<string> Haric { get; set; } = new();
        public string Aciklama { get; set; }
    }

    [HttpPost("Dagitim/{kod}")]
    public IActionResult Dagit(string kod, [FromBody] DagitimGirdisi g)
    {
        var sube = DagitimSahibi(kod);
        if (sube is null) return BadRequest(new { hata = "Şube ya da bölge havuzu bulunamadı." });
        if (g is null || g.Tutar <= 0) return BadRequest(new { hata = "Dağıtılacak tutar girin." });

        using var db = _vt.Baglanti();

        if (db.QueryFirstOrDefault<int?>(@"
SELECT TOP 1 id FROM KRY_PUAN_TALEP WHERE havuz_kodu = @kod AND durum IN (N'bekliyor', N'isleniyor')",
                new { kod = sube.Kod }) is { } acik)
            return BadRequest(new { hata = $"Bu havuzun onay bekleyen bir dağıtımı var (puan talebi #{acik}). Önce o sonuçlanmalı." });

        var kullanilabilir = Kullanilabilir(db, sube.Kod);
        if (g.Tutar > kullanilabilir + 0.005m)
            return BadRequest(new { hata = $"Havuzda {kullanilabilir:N2} ₺ var; daha fazlası dağıtılamaz." });

        List<DagitimKisi> alanlar;
        try
        {
            var haric = (g.Haric ?? new()).Select(x => x.Trim().TrimStart('0')).ToHashSet();
            var kisiler = HavuzKisileri(sube).Where(x => !haric.Contains(x.Sicil.TrimStart('0'))).ToList();
            var varOlan = VarOlanKartlar(kisiler.Select(x => x.KartNo));
            alanlar = kisiler.Where(x => x.KartNo is not null && varOlan.Contains(x.KartNo)).ToList();
        }
        catch (Exception hata)
        {
            return StatusCode(502, new { hata = "Personel ya da kart bilgisi alınamadı.", ayrinti = hata.Message });
        }

        if (alanlar.Count == 0)
            return BadRequest(new
            {
                hata = sube.Bolge
                    ? $"{sube.Ad} adında aktif bölge müdürü bulunamadı ya da Biçen Kart'ı tanımlı değil."
                    : "Kartı tanımlı personel yok.",
            });
        if (alanlar.Count > 5000) return BadRequest(new { hata = "Çok fazla kişi." });

        var kisiBasi = Math.Floor(g.Tutar / alanlar.Count * 100m) / 100m;
        if (kisiBasi <= 0) return BadRequest(new { hata = "Kişi başına düşen tutar 0,01 ₺'den az." });
        var toplam = kisiBasi * alanlar.Count;

        var aciklama = string.IsNullOrWhiteSpace(g.Aciklama)
            ? $"{(sube.Bolge ? "Bölge" : "Mağaza")} havuzu · {sube.Ad} · kişi başı {kisiBasi:N2} ₺"
            : g.Aciklama.Trim();
        if (aciklama.Length > 300) aciklama = aciklama[..300];

        var kim = User?.Identity?.Name ?? "panel";
        var ad = User?.Claims.FirstOrDefault(x => x.Type == "adSoyad")?.Value ?? kim;

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        using var tx = db.BeginTransaction();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PUAN_TALEP (tur, aciklama, dosya_adi, son_kullanim, kart_sayisi, toplam_puan, talep_eden, talep_eden_ad, havuz_kodu)
OUTPUT INSERTED.id
VALUES (N'toplu', @aciklama, NULL, @son, @adet, @toplam, @kim, @ad, @havuz)",
            new { aciklama, son = new DateTime(2029, 11, 30), adet = alanlar.Count, toplam, kim, ad, havuz = sube.Kod }, tx);

        db.Execute(@"
INSERT INTO KRY_PUAN_TALEP_SATIR (talep_id, kart_no, sicil, ad_soyad, sube, puan)
VALUES (@id, @kart, @sicil, @adSoyad, @sube, @puan)",
            alanlar.Select(x => new { id, kart = x.KartNo, sicil = x.Sicil, adSoyad = x.AdSoyad, sube = x.Sube ?? sube.Ad, puan = kisiBasi }), tx);

        db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
SELECT kullanici_adi, N'puan_onay', @baslik, @metin
FROM KRY_KULLANICILAR WHERE rol = N'Admin' AND aktif = 1",
            new
            {
                baslik = "Onay bekleyen havuz dağıtımı",
                metin = $"{ad} · {sube.Ad} {(sube.Bolge ? "bölge" : "mağaza")} havuzu · {alanlar.Count} kişi × {kisiBasi:N2} = {toplam:N2} ₺ Biçen Kart'a. "
                        + "Sağ üstteki Bekleyen işler zilinden onaylayabilir ya da reddedebilirsiniz.",
            }, tx);

        tx.Commit();

        _kayit.LogInformation("Havuz dağıtım talebi {Id}: {Sube}, {Adet} kişi × {KisiBasi}", id, sube.Ad, alanlar.Count, kisiBasi);

        return Ok(new { id, kisi = alanlar.Count, kisiBasi, toplam, artan = g.Tutar - toplam });
    }

    /// <summary>Mikro'da stok arama (kod ya da ad), kampanyaya ürün eklemek için.</summary>
    [HttpGet("Stok")]
    public IActionResult StokAra([FromQuery] string q)
    {
        var a = (q ?? "").Trim();
        if (a.Length < 2) return Ok(Array.Empty<object>());
        try
        {
            using var mikro = _vt.CiroBaglantisi();
            var liste = mikro.Query(@"
SELECT TOP 30 LTRIM(RTRIM(sto_kod)) AS kod, sto_isim AS ad, sto_birim1_ad AS birim
FROM STOKLAR WITH (NOLOCK)
WHERE sto_kod LIKE @bas OR sto_isim LIKE @ic
ORDER BY CASE WHEN sto_kod = @tam THEN 0 ELSE 1 END, sto_isim",
                new { bas = a + "%", ic = "%" + a.Replace(" ", "%") + "%", tam = a }, commandTimeout: 30).ToList();
            return Ok(liste);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Havuz stok araması yapılamadı");
            return StatusCode(502, new { hata = "Mikro stok listesine ulaşılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Stok kodlarının adları (kampanya ekranında göstermek için).</summary>
    [HttpPost("StokAdlari")]
    public IActionResult StokAdlari([FromBody] List<string> kodlar)
    {
        var k = (kodlar ?? new()).Select(x => (x ?? "").Trim()).Where(x => x.Length > 0).Distinct().Take(200).ToList();
        if (k.Count == 0) return Ok(Array.Empty<object>());
        try
        {
            using var mikro = _vt.CiroBaglantisi();
            return Ok(mikro.Query(@"
SELECT LTRIM(RTRIM(sto_kod)) AS kod, sto_isim AS ad, sto_birim1_ad AS birim
FROM STOKLAR WITH (NOLOCK) WHERE sto_kod IN @k", new { k }).ToList());
        }
        catch
        {
            return Ok(Array.Empty<object>());
        }
    }
}

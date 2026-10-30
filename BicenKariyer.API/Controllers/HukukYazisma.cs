using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Resmi yazışma (24.10.2026). Mesajlaşma değil, e-posta gibi: her yazının
/// yıla göre sıralı kayıt numarası (BİÇ-HUK-2026/0001), konusu, muhatapları
/// (kime / bilgi), ilgili dosyası, antetli metni, ekleri, okundu bilgisi ve
/// isteğe bağlı cevap süresi var. Ekler dosyanın belgelerine de işlenir.
/// <para>
/// İç ekip tek kutudan yazar ve okur ("ekip" = Biçen İK · Hukuk birimi);
/// danışmana giden yazıda gönderen kurum Biçen'dir, kişi altta imza olarak
/// görünür.
/// </para>
/// </summary>
public partial class HukukController
{
    public const string EkipAdi = "Biçen İK · Hukuk birimi";

    private static string[] KutuAnahtarlari(Kimlik ben) =>
        ben is null ? Array.Empty<string>()
        : ben.Tur == "danisman" ? new[] { ben.Anahtar }
        : new[] { ben.Anahtar, EkipKutusu };

    private bool YaziGorebilir(System.Data.IDbConnection db, Kimlik ben, int yaziId)
    {
        if (ben is null) return false;
        if (ben.Tur != "danisman") return true;
        return db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_YAZI_KUTU WHERE yazi_id = @yaziId AND anahtar = @a",
            new { yaziId, a = ben.Anahtar }) > 0;
    }

    /// <summary>Anahtar → görünen ad ve kurum (ekip, panel kullanıcısı, personel, danışman).</summary>
    private Dictionary<string, (string Ad, string Kurum)> Adlar(System.Data.IDbConnection db, IEnumerable<string> anahtarlar)
    {
        var d = new Dictionary<string, (string, string)>(StringComparer.OrdinalIgnoreCase);
        var l = anahtarlar.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        var u = l.Where(x => x.StartsWith("u:")).Select(x => x[2..]).ToArray();
        var hd = l.Where(x => x.StartsWith(DanismanOnek)).Select(x => x[DanismanOnek.Length..]).ToArray();
        if (u.Length > 0)
            foreach (var x in db.Query("SELECT kullanici_adi AS k, ad_soyad AS a FROM KRY_KULLANICILAR WHERE kullanici_adi IN @u", new { u }))
                d["u:" + (string)x.k] = ((string)x.a, "Biçen · İnsan Kaynakları");
        if (hd.Length > 0)
            foreach (var x in db.Query("SELECT kullanici_adi AS k, ad_soyad AS a, unvan, kurum FROM KRY_HUK_DANISMAN WHERE kullanici_adi IN @hd", new { hd }))
                d[DanismanOnek + (string)x.k] = (string.IsNullOrWhiteSpace((string)x.unvan) ? (string)x.a : $"{(string)x.unvan} {(string)x.a}", (string)x.kurum);
        foreach (var p in l.Where(x => x.StartsWith("p:")))
        {
            var k = _ekip.Kisi(p[2..]);
            d[p] = (k is null ? p[2..] : $"{k.Ad} {k.Soyad}".Trim(), "Biçen · İnsan Kaynakları");
        }
        d[EkipKutusu] = (EkipAdi, "Biçen · İnsan Kaynakları");
        foreach (var x in l.Where(x => !d.ContainsKey(x))) d[x] = (x, null);
        return d;
    }

    private List<object> YaziListesi(System.Data.IDbConnection db, Kimlik ben, string klasor = null, int? dosyaId = null, string q = null)
    {
        if (ben is null) return new();
        var kutu = KutuAnahtarlari(ben);
        var danisman = ben.Tur == "danisman";
        q = string.IsNullOrWhiteSpace(q) ? null : q.Trim();

        /* Klasör: gelen / bekleyen / gonderilen / arsiv; dosyaya göre listede klasör yok */
        var kosul = dosyaId is not null
            ? (danisman ? "y.dosya_id = @dosyaId AND EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu)" : "y.dosya_id = @dosyaId")
            : klasor switch
            {
                "gonderilen" => "EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.rol = N'gonderen' AND k.arsiv = 0)",
                "arsiv" => "EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.arsiv = 1)",
                "bekleyen" => @"y.cevap_suresi IS NOT NULL AND NOT EXISTS (SELECT 1 FROM KRY_HUK_YAZI c WHERE c.yanit_id = y.id)
 AND EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.rol IN (N'kime', N'bilgi') AND k.arsiv = 0)",
                _ => "EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.rol IN (N'kime', N'bilgi') AND k.arsiv = 0)",
            };

        var l = db.Query($@"
SELECT TOP 300 y.id, y.kayit_no, y.dosya_id, y.yanit_id, y.konu, LEFT(y.metin, 200) AS ozet, y.gonderen, y.gonderen_ad, y.gonderen_kurum,
       y.cevap_suresi, y.olusturma, d.dosya_no, d.davaci_ad, d.tur AS dosya_tur,
       (SELECT COUNT(*) FROM KRY_HUK_BELGE b WHERE b.yazi_id = y.id AND b.silindi = 0) AS ek,
       CASE WHEN EXISTS (SELECT 1 FROM KRY_HUK_YAZI c WHERE c.yanit_id = y.id) THEN 1 ELSE 0 END AS yanitlandi
FROM KRY_HUK_YAZI y LEFT JOIN KRY_HUK_DOSYA d ON d.id = y.dosya_id
WHERE {kosul}
  AND (@q IS NULL OR y.konu LIKE N'%' + @q + N'%' OR y.kayit_no LIKE N'%' + @q + N'%' OR y.gonderen_ad LIKE N'%' + @q + N'%' OR d.davaci_ad LIKE N'%' + @q + N'%')
ORDER BY y.id DESC", new { kutu, dosyaId, q }).ToList();

        var idler = l.Select(x => (int)x.id).ToArray();
        var kutular = idler.Length == 0 ? new List<dynamic>() : db.Query("SELECT yazi_id, anahtar, rol, okundu FROM KRY_HUK_YAZI_KUTU WHERE yazi_id IN @idler", new { idler }).ToList();
        var adlar = Adlar(db, kutular.Select(x => (string)x.anahtar));

        return l.Select(x =>
        {
            var k = kutular.Where(z => (int)z.yazi_id == (int)x.id).ToList();
            var benim = k.Where(z => kutu.Contains((string)z.anahtar) && (string)z.rol != "gonderen").ToList();
            var gonderenBen = k.Any(z => kutu.Contains((string)z.anahtar) && (string)z.rol == "gonderen");
            return (object)new
            {
                id = (int)x.id,
                kayitNo = (string)x.kayit_no,
                konu = (string)x.konu,
                ozet = ((string)x.ozet ?? "").Replace("\r", " ").Replace("\n", " "),
                gonderenAd = (string)x.gonderen_ad,
                gonderenKurum = (string)x.gonderen_kurum,
                benGonderdim = gonderenBen,
                kime = k.Where(z => (string)z.rol == "kime").Select(z => adlar.GetValueOrDefault((string)z.anahtar).Ad).ToList(),
                dosyaId = (int?)x.dosya_id,
                dosyaNo = (string)x.dosya_no,
                dosyaTur = (string)x.dosya_tur,
                davaciAd = (string)x.davaci_ad,
                cevapSuresi = (DateTime?)x.cevap_suresi,
                yanitlandi = (int)x.yanitlandi == 1,
                okunmadi = !gonderenBen && benim.Count > 0 && benim.All(z => z.okundu == null),
                okunduAlici = gonderenBen && k.Where(z => (string)z.rol == "kime").All(z => z.okundu != null),
                ek = (int)x.ek,
                tarih = (DateTime)x.olusturma,
            };
        }).ToList();
    }

    [HttpGet("Yazilar")]
    public IActionResult Yazilar([FromQuery] string klasor = "gelen", [FromQuery] int? dosyaId = null, [FromQuery] string q = null)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        if (dosyaId is int did && DosyaHakki(db, ben, did) is null) return NotFound();
        var kutu = KutuAnahtarlari(ben);
        var sayilar = new
        {
            gelen = db.ExecuteScalar<int>(@"SELECT COUNT(DISTINCT yazi_id) FROM KRY_HUK_YAZI_KUTU WHERE anahtar IN @kutu AND rol IN (N'kime', N'bilgi') AND okundu IS NULL AND arsiv = 0", new { kutu }),
            bekleyen = db.ExecuteScalar<int>(@"SELECT COUNT(*) FROM KRY_HUK_YAZI y WHERE y.cevap_suresi IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM KRY_HUK_YAZI c WHERE c.yanit_id = y.id)
AND EXISTS (SELECT 1 FROM KRY_HUK_YAZI_KUTU k WHERE k.yazi_id = y.id AND k.anahtar IN @kutu AND k.rol IN (N'kime', N'bilgi') AND k.arsiv = 0)", new { kutu }),
        };
        return Ok(new { yazilar = YaziListesi(db, ben, klasor, dosyaId, q), sayilar });
    }

    /// <summary>Yazıyı açar ve okundu işler; yazışma zinciri (önceki ve sonraki yazılar) ile döner.</summary>
    [HttpGet("Yazi/{id:int}")]
    public IActionResult Yazi(int id)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (!YaziGorebilir(db, ben, id)) return NotFound(new { hata = "Yazı bulunamadı." });
        var y = db.QueryFirstOrDefault(@"SELECT y.*, d.dosya_no, d.davaci_ad, d.tur AS dosya_tur, d.esas_no, d.mahkeme
FROM KRY_HUK_YAZI y LEFT JOIN KRY_HUK_DOSYA d ON d.id = y.dosya_id WHERE y.id = @id", new { id });
        if (y is null) return NotFound();

        var kutu = KutuAnahtarlari(ben);
        if (ben.Yetki != "okuma" || ben.Tur == "danisman")
            db.Execute(@"UPDATE KRY_HUK_YAZI_KUTU SET okundu = SYSDATETIME(), okuyan_ad = @ad
WHERE yazi_id = @id AND anahtar IN @kutu AND rol IN (N'kime', N'bilgi') AND okundu IS NULL", new { id, kutu, ad = ben.Ad });

        var alicilar = db.Query("SELECT anahtar, rol, okundu, okuyan_ad FROM KRY_HUK_YAZI_KUTU WHERE yazi_id = @id", new { id }).ToList();
        var adlar = Adlar(db, alicilar.Select(x => (string)x.anahtar));
        var ekler = db.Query("SELECT * FROM KRY_HUK_BELGE WHERE yazi_id = @id AND silindi = 0 ORDER BY id", new { id }).Select(BelgeNesne).ToList();

        /* Zincir: köke kadar yukarı, sonra kökten bütün yanıtlar */
        var kok = id;
        for (var i = 0; i < 30; i++)
        {
            var ust = db.ExecuteScalar<int?>("SELECT yanit_id FROM KRY_HUK_YAZI WHERE id = @kok", new { kok });
            if (ust is null) break;
            kok = ust.Value;
        }
        var zincir = new List<int> { kok };
        for (var i = 0; i < zincir.Count && zincir.Count < 60; i++)
            zincir.AddRange(db.Query<int>("SELECT id FROM KRY_HUK_YAZI WHERE yanit_id = @p", new { p = zincir[i] }));
        var zincirYazi = db.Query("SELECT id, kayit_no, konu, gonderen_ad, olusturma FROM KRY_HUK_YAZI WHERE id IN @zincir ORDER BY id", new { zincir })
            .Where(x => YaziGorebilir(db, ben, (int)x.id))
            .Select(x => new { id = (int)x.id, kayitNo = (string)x.kayit_no, konu = (string)x.konu, gonderenAd = (string)x.gonderen_ad, tarih = (DateTime)x.olusturma, bu = (int)x.id == id })
            .ToList();

        Logla(db, ben, "yazi_ac", (int?)y.dosya_id, (string)y.kayit_no);
        var gonderenBen = alicilar.Any(z => kutu.Contains((string)z.anahtar) && (string)z.rol == "gonderen");

        return Ok(new
        {
            id = (int)y.id,
            kayitNo = (string)y.kayit_no,
            konu = (string)y.konu,
            metin = (string)y.metin,
            gonderen = (string)y.gonderen,
            gonderenAd = (string)y.gonderen_ad,
            gonderenKurum = (string)y.gonderen_kurum,
            gonderenIc = !((string)y.gonderen).StartsWith(DanismanOnek),
            benGonderdim = gonderenBen,
            tarih = (DateTime)y.olusturma,
            cevapSuresi = (DateTime?)y.cevap_suresi,
            yanitlandi = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_YAZI WHERE yanit_id = @id", new { id }) > 0,
            yanitId = (int?)y.yanit_id,
            dosya = y.dosya_id is null ? null : new
            {
                id = (int)y.dosya_id, dosyaNo = (string)y.dosya_no, davaciAd = (string)y.davaci_ad,
                turAdi = Turler.GetValueOrDefault((string)y.dosya_tur ?? "", (string)y.dosya_tur), esasNo = (string)y.esas_no, mahkeme = (string)y.mahkeme,
            },
            alicilar = alicilar.Where(z => (string)z.rol != "gonderen").Select(z => new
            {
                anahtar = (string)z.anahtar, rol = (string)z.rol, ad = adlar.GetValueOrDefault((string)z.anahtar).Ad,
                kurum = adlar.GetValueOrDefault((string)z.anahtar).Kurum,
                okundu = (DateTime?)z.okundu, okuyanAd = (string)z.okuyan_ad,
            }),
            ekler,
            zincir = zincirYazi,
        });
    }

    /// <summary>Yazılabilecek muhataplar: iç ekip kutusu, ekip üyeleri, danışmanlar.</summary>
    [HttpGet("Kisiler")]
    public IActionResult Kisiler([FromQuery] int? dosyaId = null)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        var l = new List<object> { new { anahtar = EkipKutusu, ad = EkipAdi, kurum = "Biçen · İnsan Kaynakları", tur = "ekip", erisim = true } };

        var erisenler = dosyaId is int did
            ? db.Query<string>("SELECT anahtar FROM KRY_HUK_ERISIM WHERE dosya_id = @did", new { did }).ToHashSet(StringComparer.OrdinalIgnoreCase)
            : new HashSet<string>();

        var danismanlar = db.Query("SELECT kullanici_adi AS k, ad_soyad AS a, unvan, kurum FROM KRY_HUK_DANISMAN WHERE aktif = 1 ORDER BY ad_soyad").ToList();
        foreach (var d in danismanlar)
        {
            var anahtar = DanismanOnek + (string)d.k;
            if (anahtar == ben.Anahtar) continue;
            /* Danışman yalnız aynı dosyadaki diğer danışmanlara yazabilir */
            if (ben.Tur == "danisman" && (dosyaId is null || !erisenler.Contains(anahtar))) continue;
            l.Add(new
            {
                anahtar,
                ad = string.IsNullOrWhiteSpace((string)d.unvan) ? (string)d.a : $"{(string)d.unvan} {(string)d.a}",
                kurum = (string)d.kurum,
                tur = "danisman",
                erisim = dosyaId is null || erisenler.Contains(anahtar),
            });
        }

        if (ben.Tur != "danisman")
        {
            var ekip = db.Query<string>("SELECT anahtar FROM KRY_HUK_EKIP").ToList();
            var adlar = Adlar(db, ekip);
            foreach (var a in ekip.Where(a => a != ben.Anahtar))
                l.Add(new { anahtar = a, ad = adlar[a].Ad, kurum = "Biçen · İnsan Kaynakları", tur = "ic", erisim = true });
        }
        return Ok(new { kisiler = l });
    }

    private static List<string> Liste(string s) =>
        (s ?? "").Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>
    /// Resmi yazı gönderir (çok parçalı: konu, metin, kime, bilgi, dosyaId,
    /// yanitId, cevapSuresi, ekler). Kayıt numarası yıla göre sıralı verilir.
    /// </summary>
    [HttpPost("Yazi")]
    [RequestSizeLimit(BelgeSiniri + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = BelgeSiniri + 1024 * 1024)]
    public async Task<IActionResult> YaziGonder([FromForm] string konu, [FromForm] string metin, [FromForm] string kime, [FromForm] string bilgi,
        [FromForm] int? dosyaId, [FromForm] int? yanitId, [FromForm] DateTime? cevapSuresi, List<IFormFile> ekler)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (ben is null) return Yasak();
        if (ben.Yetki == "okuma") return StatusCode(403, new { hata = "Okuma yetkisiyle yazı gönderilemez." });

        konu = Kirp(konu, 250);
        metin = (metin ?? "").Trim();
        if (konu is null) return BadRequest(new { hata = "Konuyu yazınız." });
        if (metin.Length < 3) return BadRequest(new { hata = "Yazının metnini yazınız." });
        if (metin.Length > 20000) return BadRequest(new { hata = "Metin çok uzun." });

        var kimeL = Liste(kime);
        var bilgiL = Liste(bilgi).Where(x => !kimeL.Contains(x, StringComparer.OrdinalIgnoreCase)).ToList();
        if (kimeL.Count == 0) return BadRequest(new { hata = "En az bir muhatap seçiniz." });

        if (dosyaId is int did && DosyaHakki(db, ben, did) is null) return BadRequest(new { hata = "Dosya bulunamadı." });
        if (yanitId is int yid && !YaziGorebilir(db, ben, yid)) return BadRequest(new { hata = "Yanıtlanan yazı bulunamadı." });

        /* Muhatap denetimi: danışman yalnız iç ekibe ve aynı dosyadaki danışmanlara;
           iç ekip danışmana ancak o dosyada erişimi varsa (dosyasız yazıda her danışmana) */
        var erisenler = dosyaId is int d2
            ? db.Query<string>("SELECT anahtar FROM KRY_HUK_ERISIM WHERE dosya_id = @d2", new { d2 }).ToHashSet(StringComparer.OrdinalIgnoreCase)
            : null;
        foreach (var a in kimeL.Concat(bilgiL))
        {
            if (a == EkipKutusu) continue;
            if (a.StartsWith(DanismanOnek))
            {
                if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_HUK_DANISMAN WHERE kullanici_adi = @k AND aktif = 1", new { k = a[DanismanOnek.Length..] }) == 0)
                    return BadRequest(new { hata = "Seçilen danışman bulunamadı." });
                if (erisenler is not null && !erisenler.Contains(a))
                    return BadRequest(new { hata = "Seçilen danışmanın bu dosyaya erişimi yok; önce dosya erişimi verin." });
                if (ben.Tur == "danisman" && erisenler is null)
                    return BadRequest(new { hata = "Başka bir danışmana yalnız ortak dosya üzerinden yazabilirsiniz." });
                continue;
            }
            if (ben.Tur == "danisman") return BadRequest(new { hata = "Biçen ekibine 'Biçen İK · Hukuk birimi' kutusundan yazınız." });
            if (!a.StartsWith("u:") && !a.StartsWith("p:")) return BadRequest(new { hata = "Muhatap geçersiz." });
        }

        if (db.State != System.Data.ConnectionState.Open) db.Open();
        int id;
        string no;
        using (var tx = db.BeginTransaction())
        {
            var yil = DateTime.Today.Year;
            var onek = $"BİÇ-HUK-{yil}/";
            var son = db.ExecuteScalar<int?>(@"SELECT MAX(CAST(SUBSTRING(kayit_no, LEN(@onek) + 1, 10) AS INT))
FROM KRY_HUK_YAZI WITH (UPDLOCK, HOLDLOCK) WHERE kayit_no LIKE @desen", new { onek, desen = onek + "%" }, tx) ?? 0;
            no = $"{onek}{son + 1:0000}";
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_HUK_YAZI (kayit_no, dosya_id, yanit_id, konu, metin, gonderen, gonderen_ad, gonderen_kurum, cevap_suresi)
OUTPUT INSERTED.id VALUES (@no, @dosyaId, @yanitId, @konu, @metin, @gonderen, @ad, @kurum, @cevapSuresi)",
                new { no, dosyaId, yanitId, konu, metin, gonderen = ben.Anahtar, ad = ben.Ad, kurum = ben.Kurum, cevapSuresi }, tx);

            var gonderenKutu = ben.Tur == "danisman" ? ben.Anahtar : EkipKutusu;
            db.Execute("INSERT INTO KRY_HUK_YAZI_KUTU (yazi_id, anahtar, rol, okundu) VALUES (@id, @a, N'gonderen', SYSDATETIME())", new { id, a = gonderenKutu }, tx);
            foreach (var a in kimeL.Where(a => a != gonderenKutu))
                db.Execute("INSERT INTO KRY_HUK_YAZI_KUTU (yazi_id, anahtar, rol) VALUES (@id, @a, N'kime')", new { id, a }, tx);
            foreach (var a in bilgiL.Where(a => a != gonderenKutu))
                db.Execute("INSERT INTO KRY_HUK_YAZI_KUTU (yazi_id, anahtar, rol) VALUES (@id, @a, N'bilgi')", new { id, a }, tx);
            tx.Commit();
        }

        if ((ekler == null || ekler.Count == 0) && Request.HasFormContentType) ekler = Request.Form.Files.ToList();
        foreach (var f in (ekler ?? new()).Where(x => x.Length > 0).Take(20))
        {
            if (f.Length > BelgeSiniri) continue;
            await BelgeYaz(db, ben, f, dosyaId, id);
        }

        Logla(db, ben, "yazi_gonder", dosyaId, $"{no} · {konu}");

        var baslik = $"Resmi yazı · {no}";
        var ozet = $"{ben.Ad}: {konu}";
        await Bildir(db, kimeL.Concat(bilgiL).Where(a => a != ben.Anahtar), baslik, ozet);

        return Ok(new { id, kayitNo = no });
    }

    [HttpPost("Yazi/{id:int}/Arsiv")]
    public IActionResult YaziArsiv(int id, [FromQuery] bool geri = false)
    {
        using var db = _vt.Baglanti();
        var ben = Ben(db);
        if (!YaziGorebilir(db, ben, id)) return NotFound();
        db.Execute("UPDATE KRY_HUK_YAZI_KUTU SET arsiv = @a WHERE yazi_id = @id AND anahtar IN @kutu", new { id, a = !geri, kutu = KutuAnahtarlari(ben) });
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Bildirim                                                              */
    /* ==================================================================== */

    /// <summary>"ekip" kutusu ekip üyelerine açılır; panel kullanıcısına panel bildirimi, hepsine telefon bildirimi.</summary>
    internal async Task Bildir(System.Data.IDbConnection db, IEnumerable<string> anahtarlar, string baslik, string metin)
    {
        try
        {
            var l = anahtarlar.ToList();
            if (l.Remove(EkipKutusu)) l.AddRange(db.Query<string>("SELECT anahtar FROM KRY_HUK_EKIP"));
            l = l.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            await HukukBildirim.Gonder(db, _bildirim, l, baslik, metin);
        }
        catch (Exception h) { _kayit.LogWarning(h, "Hukuk bildirimi gönderilemedi"); }
    }
}

/// <summary>Hukuk bildirimleri: hem denetleyiciden hem hatırlatma görevinden.</summary>
public static class HukukBildirim
{
    public static async Task Gonder(System.Data.IDbConnection db, BildirimServisi bildirim, IList<string> anahtarlar, string baslik, string metin)
    {
        var telefon = new List<(string, string, string)>();
        foreach (var a in anahtarlar.Where(x => !string.IsNullOrWhiteSpace(x)))
        {
            if (a.StartsWith("u:"))
            {
                var k = a[2..];
                db.Execute("INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin) VALUES (@k, N'hukuk', @baslik, @metin)",
                    new { k, baslik = baslik.Length > 200 ? baslik[..200] : baslik, metin = metin?.Length > 900 ? metin[..900] : metin });
                var sicil = db.ExecuteScalar<string>("SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi = @k", new { k });
                telefon.Add((string.IsNullOrWhiteSpace(sicil) ? k : sicil.Trim(), baslik, metin));
            }
            else if (a.StartsWith("p:")) telefon.Add((a[2..], baslik, metin));
            else if (a.StartsWith(HukukController.DanismanOnek)) telefon.Add((a, baslik, metin));
        }
        if (telefon.Count > 0) await bildirim.KisiyeOzelGonder(telefon, "hukuk");
    }
}

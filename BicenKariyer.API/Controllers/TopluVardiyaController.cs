using System.Data;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Toplu vardiya girişi (03.10.2026).
///
/// <para>
/// İK seçtiği birimlerin (genel merkez, Akçaburgaz depo, herhangi bir şube)
/// ya da departmanların personeline haftalık bir desen uygular: örneğin
/// pazartesi–cuma sabahçı, cumartesi ve pazar haftalık izin, bir yıl
/// boyunca. Kayıtlar mağaza müdürünün mobilden girdiği planla aynı tabloya
/// (KRY_VARDIYA_PLAN) yazılıyor; plan ekranları, izin gün hesabı ve
/// okutma raporları farkı görmüyor.
/// </para>
///
/// <para>
/// Yazım tek işlemde ve küme olarak yapılıyor: satırlar geçici tabloya
/// 1000'erli çok satırlı VALUES ile yükleniyor, sonra tek UPDATE ve tek
/// INSERT ile plana geçiyor. 1 yıl × 100 kişi ≈ 36.500 satır birkaç
/// saniye sürüyor. STRING_SPLIT ve OPENJSON kullanılmıyor (veritabanı
/// uyumluluk düzeyi 130'un altında).
/// </para>
///
/// <para>
/// Geri alma: her toplu işlem KRY_TOPLU_VARDIYA'ya yazılıyor; üzerine
/// yazılan satırların eski hâli KRY_TOPLU_VARDIYA_YEDEK'te, yayın
/// durumlarının eski hâli KRY_TOPLU_VARDIYA_DURUM_YEDEK'te tutuluyor.
/// İşlemin yazdığı satırlar guncelleyen = işlemin imzası ve guncelleme =
/// işlem zamanı ile işaretli; geri alırken yalnızca hâlâ bu işarette olan
/// satırlara dokunuluyor — sonradan müdürün değiştirdiği gün korunuyor.
/// </para>
///
/// <para>
/// Bildirim: gün başına değil, kişi başına en fazla bir özet bildirim
/// (ya da hiç). Haftada 1 gün izin zorunlu: desende haftalık izin günü
/// yoksa uygulanmıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class TopluVardiyaController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly DepartmanServisi _departman;
    private readonly IServiceScopeFactory _kapsam;
    private readonly ILogger<TopluVardiyaController> _kayit;

    /// <summary>Tek işlemde en fazla gün ve satır.</summary>
    private const int EnFazlaGun = 400;
    private const int EnFazlaSatir = 250_000;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly string[] GunKisa = { "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz" };

    public TopluVardiyaController(VeritabaniServisi vt, EkipServisi ekip, DepartmanServisi departman,
        IServiceScopeFactory kapsam, ILogger<TopluVardiyaController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _departman = departman;
        _kapsam = kapsam;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private string Yapan()
    {
        var ad = User?.FindFirst("adSoyad")?.Value;
        return string.IsNullOrWhiteSpace(ad) ? User?.Identity?.Name ?? "İK" : ad;
    }

    /// <summary>Pazartesi 0 … pazar 6.</summary>
    private static int GunNo(DateTime g) => ((int)g.DayOfWeek + 6) % 7;

    private static DateTime HaftaBasi(DateTime g) => g.Date.AddDays(-GunNo(g));

    /* ==================================================================== */
    /* Seçenekler                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Ekranın ihtiyaç duyduğu her şey: birimler, departmanlar, personel,
    /// vardiya türleri ve kayıtlı haftalık şablonlar.
    /// </summary>
    [HttpGet("Secenekler")]
    public IActionResult Secenekler()
    {
        var aktif = _ekip.Aktifler();
        var harita = _departman.Oku();

        /* Kişinin departmanları: personel olarak bağlı olduğu ve yönettiği */
        List<int> Departmanlari(string kod)
        {
            var k = K(kod);
            var l = new List<int>();

            if (harita.PersonelDepartmani.TryGetValue(k, out var d)) l.Add(d);
            if (harita.YonettigiDepartmanlar.TryGetValue(k, out var ds)) l.AddRange(ds);

            return l.Distinct().ToList();
        }

        var personeller = aktif
            .Select(x => new
            {
                sicil = x.PersonelKodu.Trim(),
                adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                pozisyon = (x.Pozisyon ?? "").Trim(),
                birim = (x.IsGrubu ?? "").Trim(),
                departmanlar = Departmanlari(x.PersonelKodu),
            })
            .OrderBy(x => x.adSoyad, StringComparer.Create(new CultureInfo("tr-TR"), true))
            .ToList();

        /* Genel merkez ve depo başa: toplu giriş en çok onlar için */
        static int Oncelik(string ad)
        {
            var a = (ad ?? "").ToUpperInvariant();
            return a.Contains("MERKEZ") ? 0 : a.Contains("DEPO") ? 1 : 2;
        }

        var birimler = personeller
            .Where(x => x.birim.Length > 0)
            .GroupBy(x => x.birim, StringComparer.OrdinalIgnoreCase)
            .Select(g => new { ad = g.Key, kisi = g.Count() })
            .OrderBy(x => Oncelik(x.ad))
            .ThenBy(x => x.ad)
            .ToList();

        var departmanlar = harita.Departmanlar.Values
            .OrderBy(x => x.Sira).ThenBy(x => x.Ad)
            .Select(d => new
            {
                id = d.Id,
                ad = d.Ad,
                isYeri = d.IsYeri,
                kisi = personeller.Count(p => p.departmanlar.Contains(d.Id)),
            })
            .ToList();

        using var db = _vt.Baglanti();

        var sablonlar = db.Query(@"
SELECT id, ad, renk, tip, aktif FROM KRY_VARDIYA_SABLON WHERE aktif = 1 ORDER BY sira, id")
            .Select(x => new
            {
                id = (int)x.id,
                ad = (string)x.ad,
                renk = (string)x.renk,
                tip = VardiyaPlanController.TipBul((string)x.tip, (string)x.ad),
            })
            .ToList();

        var tatiller = db.Query(@"
SELECT tarih, ad, yarim_gun AS yarimGun FROM KRY_RESMI_TATIL
WHERE aktif = 1 AND tarih >= @bugun ORDER BY tarih", new { bugun = DateTime.Today.AddDays(-31) })
            .Select(x => new { tarih = (DateTime)x.tarih, ad = (string)x.ad, yarimGun = (bool)x.yarimGun })
            .ToList();

        return Ok(new
        {
            birimler,
            departmanlar,
            unvanlar = personeller.Select(x => x.pozisyon).Where(x => x.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(x => x).ToList(),
            personeller,
            sablonlar,
            desenler = Desenler(db),
            tatiller,
        });
    }

    /* ==================================================================== */
    /* Haftalık şablonlar (desen)                                           */
    /* ==================================================================== */

    public class DesenGun
    {
        /// <summary>vardiya · izin (haftalık izin) · off (boş) · atla (dokunma)</summary>
        public string Tur { get; set; }

        public int? SablonId { get; set; }
    }

    public class DesenGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public List<DesenGun> Gunler { get; set; }
    }

    private static List<object> Desenler(IDbConnection db) =>
        db.Query(@"
SELECT id, ad, gunler, olusturan, olusturma FROM KRY_VARDIYA_DESEN
WHERE aktif = 1 ORDER BY ad")
            .Select(x =>
            {
                List<DesenGun> gunler;

                try
                {
                    gunler = JsonSerializer.Deserialize<List<DesenGun>>((string)x.gunler, Json) ?? new();
                }
                catch
                {
                    gunler = new();
                }

                return (object)new
                {
                    id = (int)x.id,
                    ad = (string)x.ad,
                    gunler,
                    olusturan = (string)x.olusturan,
                    olusturma = (DateTime)x.olusturma,
                };
            })
            .ToList();

    [HttpPost("Desen")]
    public IActionResult DesenKaydet([FromBody] DesenGirdi g)
    {
        var ad = (g?.Ad ?? "").Trim();

        if (ad.Length < 2) return BadRequest(new { hata = "Şablona bir ad veriniz." });
        if (ad.Length > 100) ad = ad[..100];

        if (g.Gunler is not { Count: 7 }) return BadRequest(new { hata = "Şablonda yedi gün olmalı." });

        var json = JsonSerializer.Serialize(g.Gunler.Select(x => new DesenGun
        {
            Tur = (x?.Tur ?? "atla").Trim(),
            SablonId = x?.SablonId,
        }), Json);

        using var db = _vt.Baglanti();

        /* Aynı adlı şablon güncellenir: ekranda "kaydet" iki kez basılınca
           çift kayıt oluşmasın. */
        var id = g.Id > 0
            ? g.Id
            : db.ExecuteScalar<int?>("SELECT TOP 1 id FROM KRY_VARDIYA_DESEN WHERE aktif = 1 AND ad = @ad", new { ad }) ?? 0;

        if (id > 0)
            db.Execute(@"
UPDATE KRY_VARDIYA_DESEN SET ad = @ad, gunler = @json, olusturan = @yapan, olusturma = SYSDATETIME()
WHERE id = @id", new { id, ad, json, yapan = Yapan() });
        else
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_VARDIYA_DESEN (ad, gunler, olusturan) OUTPUT INSERTED.id VALUES (@ad, @json, @yapan)",
                new { ad, json, yapan = Yapan() });

        return Ok(new { basarili = true, id, desenler = Desenler(db) });
    }

    [HttpDelete("Desen/{id:int}")]
    public IActionResult DesenSil(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute("UPDATE KRY_VARDIYA_DESEN SET aktif = 0 WHERE id = @id", new { id });

        return Ok(new { basarili = true, desenler = Desenler(db) });
    }

    /* ==================================================================== */
    /* Önizleme ve uygulama                                                 */
    /* ==================================================================== */

    public class TopluGirdi
    {
        public List<string> Siciller { get; set; }

        /// <summary>Yedi gün: 0 pazartesi … 6 pazar.</summary>
        public List<DesenGun> Desen { get; set; }

        public DateTime Bas { get; set; }
        public DateTime Bit { get; set; }

        /// <summary>izinli: resmi tatil haftalık izin yazılır · plan: desene göre.</summary>
        public string ResmiTatil { get; set; } = "izinli";

        /// <summary>Planı olan günlerin üzerine yazılsın mı; hayırsa korunur.</summary>
        public bool UzerineYaz { get; set; }

        /// <summary>Plan personele gönderilmiş sayılsın (uygulamada görünsün).</summary>
        public bool Yayinla { get; set; } = true;

        /// <summary>ozet: kişi başına tek bildirim · yok: bildirim gitmez.</summary>
        public string Bildirim { get; set; } = "ozet";

        /// <summary>Kayıt için: uygulanan şablonun adı ve seçim özeti.</summary>
        public string DesenAd { get; set; }
        public string Kapsam { get; set; }
    }

    private sealed record Satir(string Kod, DateTime Gun, DateTime Hafta, int? SablonId, string Tur, bool Mevcut);

    private sealed record VSablon(int Id, string Ad, string Renk, string Tip);

    private sealed class Hazirlik
    {
        public string Hata;
        public List<PersonelKaydi> Kisiler = new();
        public List<Satir> Yazilacak = new();
        public List<string> Uyarilar = new();
        public List<string> Bilgiler = new();
        public bool Engel;
        public int GunSayisi;
        public int Ayni, Korunan, YillikAtlanan, Atlanan, TatilGunu, Eklenecek, Guncellenecek;
        public Dictionary<DateTime, int[]> Takvim = new();
        public Dictionary<string, int[]> Kisi = new(StringComparer.OrdinalIgnoreCase);
        public List<VSablon> Sablonlar = new();
        public Dictionary<DateTime, string> Tatiller = new();
    }

    /* Takvim hücresi sayaçları */
    private const int TCalisan = 0, TIzinli = 1, TBos = 2, TUzerine = 3, TKorunan = 4, TYillik = 5;

    /* Kişi sayaçları */
    private const int KEkle = 0, KGuncelle = 1, KKorunan = 2, KYillik = 3, KAyni = 4;

    /// <summary>
    /// Desen ve seçimden yazılacak satırları çıkarır. Önizleme ve uygulama
    /// aynı hesabı kullanıyor: ekranda görülen sayı yazılan sayı.
    /// </summary>
    private Hazirlik Hazirla(IDbConnection db, TopluGirdi g)
    {
        var h = new Hazirlik();

        if (g is null) { h.Hata = "Seçim okunamadı."; return h; }

        var bas = g.Bas.Date;
        var bit = g.Bit.Date;

        if (bit < bas) { h.Hata = "Bitiş başlangıçtan önce olamaz."; return h; }

        h.GunSayisi = (bit - bas).Days + 1;

        if (h.GunSayisi > EnFazlaGun)
        {
            h.Hata = $"Tek seferde en fazla {EnFazlaGun} gün girilebilir.";
            return h;
        }

        if (g.Desen is not { Count: 7 }) { h.Hata = "Haftalık desende yedi gün olmalı."; return h; }

        h.Sablonlar = db.Query(@"
SELECT id, ad, renk, tip FROM KRY_VARDIYA_SABLON WHERE aktif = 1 ORDER BY sira, id")
            .Select(x => new VSablon((int)x.id, (string)x.ad, (string)x.renk,
                VardiyaPlanController.TipBul((string)x.tip, (string)x.ad)))
            .ToList();

        /* Desen doğrulama */
        var desen = new (string Tur, int? SablonId)[7];

        for (var i = 0; i < 7; i++)
        {
            var d = g.Desen[i];
            var tur = (d?.Tur ?? "atla").Trim();

            if (tur is not ("vardiya" or "izin" or "off" or "atla"))
            {
                h.Hata = $"{GunKisa[i]}: geçersiz gün türü.";
                return h;
            }

            if (tur == "vardiya" && h.Sablonlar.All(x => x.Id != d.SablonId))
            {
                h.Hata = $"{GunKisa[i]}: vardiya türü seçiniz.";
                return h;
            }

            desen[i] = (tur, tur == "vardiya" ? d.SablonId : null);
        }

        if (desen.All(x => x.Tur == "atla")) { h.Hata = "Desende en az bir gün seçiniz."; return h; }

        /* Kurallar: haftada 1 gün izin zorunlu (engel), akşamcı → ertesi
           gün sabahçı (uyarı; pazar → pazartesi geçişi de) */
        if (!desen.Any(x => x.Tur == "izin"))
        {
            h.Engel = true;
            h.Uyarilar.Add("Haftada 1 gün izin yok: desende haftalık izin günü bulunmuyor. "
                           + "Haftada 1 gün izin zorunlu; bu desen uygulanamaz.");
        }

        for (var i = 0; i < 7; i++)
        {
            var a = desen[i];
            var b = desen[(i + 1) % 7];

            if (a.Tur != "vardiya" || b.Tur != "vardiya") continue;

            var sa = h.Sablonlar.First(x => x.Id == a.SablonId);
            var sb = h.Sablonlar.First(x => x.Id == b.SablonId);

            if (sa.Tip == "aksam" && sb.Tip == "sabah")
                h.Uyarilar.Add($"{GunKisa[i]} {sa.Ad} → {GunKisa[(i + 1) % 7]} {sb.Ad}: "
                               + "akşamcı çalışan ertesi gün sabahçı olmamalı (uyarı, kayıt engellenmez).");
        }

        /* Kişiler: seçilen siciller aktif personelden */
        var istenen = (g.Siciller ?? new List<string>()).Select(K).Where(x => x.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        h.Kisiler = _ekip.Aktifler()
            .Where(x => istenen.Contains(K(x.PersonelKodu)))
            .GroupBy(x => K(x.PersonelKodu))
            .Select(x => x.First())
            .ToList();

        if (h.Kisiler.Count == 0) { h.Hata = "Personel seçiniz."; return h; }

        if ((long)h.Kisiler.Count * h.GunSayisi > EnFazlaSatir)
        {
            h.Hata = $"Tek seferde en fazla {EnFazlaSatir:N0} gün-kişi girilebilir; tarih aralığını ya da seçimi daraltınız.";
            return h;
        }

        var kodlar = h.Kisiler.Select(x => x.PersonelKodu.Trim()).ToList();

        /* Resmi tatiller */
        foreach (var t in db.Query(@"
SELECT tarih, ad FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih BETWEEN @bas AND @bit",
                     new { bas, bit }))
            h.Tatiller[((DateTime)t.tarih).Date] = (string)t.ad;

        /* Mevcut plan satırları ve onaylı tam gün izinler */
        var mevcut = new Dictionary<(string, DateTime), (int? SablonId, string Tur)>();
        var izinli = new HashSet<(string, DateTime)>();

        foreach (var parca in kodlar.Chunk(500))
        {
            foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, gun, sablon_id AS sablonId, tur FROM KRY_VARDIYA_PLAN
WHERE gun BETWEEN @bas AND @bit AND personel_kodu IN @parca", new { bas, bit, parca }))
                mevcut[(K((string)r.kod), ((DateTime)r.gun).Date)] = ((int?)r.sablonId, (string)r.tur);

            foreach (var a in db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son
FROM KRY_IZIN
WHERE iptal = 0 AND personel_kodu IN @parca
  AND (yarim_gun IS NULL OR yarim_gun = N'')
  AND (baslangic_saat IS NULL OR baslangic_saat = N'')
  AND cikis_tarihi <= @bit
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @bas", new { bas, bit, parca }))
            {
                var k = K((string)a.kod);
                var s = ((DateTime)a.son).Date;

                for (var d = ((DateTime)a.bas).Date; d <= s; d = d.AddDays(1))
                    if (d >= bas && d <= bit) izinli.Add((k, d));
            }
        }

        var izinliSayac = 0;

        for (var d = bas; d <= bit; d = d.AddDays(1))
        {
            h.Takvim[d] = new int[6];

            if (h.Tatiller.ContainsKey(d)) h.TatilGunu++;
        }

        foreach (var p in h.Kisiler)
        {
            var kod = p.PersonelKodu.Trim();
            var k = K(kod);
            var sayac = h.Kisi[kod] = new int[5];

            for (var d = bas; d <= bit; d = d.AddDays(1))
            {
                var (tur, sablonId) = desen[GunNo(d)];

                if (h.Tatiller.ContainsKey(d) && (g.ResmiTatil ?? "izinli") == "izinli" && tur != "atla")
                {
                    tur = "izin";
                    sablonId = null;
                }

                if (tur == "atla") { h.Atlanan++; continue; }

                var hucre = h.Takvim[d];

                /* Onaylı tam gün izinli gün (yıllık, raporlu…) planlanamıyor */
                if (izinli.Contains((k, d)))
                {
                    h.YillikAtlanan++;
                    sayac[KYillik]++;
                    hucre[TYillik]++;
                    izinliSayac++;
                    continue;
                }

                var vardi = mevcut.TryGetValue((k, d), out var eski);

                if (vardi && eski.Tur == tur && eski.SablonId == sablonId)
                {
                    h.Ayni++;
                    sayac[KAyni]++;
                    Say(hucre, tur);
                    continue;
                }

                if (vardi && !g.UzerineYaz)
                {
                    h.Korunan++;
                    sayac[KKorunan]++;
                    hucre[TKorunan]++;
                    continue;
                }

                h.Yazilacak.Add(new Satir(kod, d, HaftaBasi(d), sablonId, tur, vardi));
                Say(hucre, tur);

                if (vardi)
                {
                    h.Guncellenecek++;
                    sayac[KGuncelle]++;
                    hucre[TUzerine]++;
                }
                else
                {
                    h.Eklenecek++;
                    sayac[KEkle]++;
                }
            }
        }

        static void Say(int[] hucre, string tur)
        {
            if (tur == "vardiya") hucre[TCalisan]++;
            else if (tur == "izin") hucre[TIzinli]++;
            else hucre[TBos]++;
        }

        /* Bilgi ve uyarılar */
        if (GunNo(bas) != 0 || GunNo(bit) != 6)
        {
            var izinNo = Enumerable.Range(0, 7).Where(i => desen[i].Tur == "izin").ToList();
            var ilkHaftaEksik = GunNo(bas) != 0 && izinNo.All(i => i < GunNo(bas));
            var sonHaftaEksik = GunNo(bit) != 6 && izinNo.All(i => i > GunNo(bit));

            if (ilkHaftaEksik || sonHaftaEksik)
                h.Uyarilar.Add("Haftada 1 gün izin yok: " +
                               (ilkHaftaEksik ? $"ilk hafta ({bas:dd.MM} {GunKisa[GunNo(bas)]} başlıyor)" : "")
                               + (ilkHaftaEksik && sonHaftaEksik ? " ve " : "")
                               + (sonHaftaEksik ? $"son hafta ({bit:dd.MM} {GunKisa[GunNo(bit)]} bitiyor)" : "")
                               + " desenin izin gününü içermiyor. Bu haftaların izin gününü planda kontrol ediniz.");
        }

        if (h.Korunan > 0)
            h.Bilgiler.Add($"{h.Korunan:N0} gün zaten planlı; üzerine yazma kapalı olduğu için korunacak.");

        if (h.Guncellenecek > 0)
            h.Uyarilar.Add($"{h.Guncellenecek:N0} günün mevcut planının üzerine yazılacak "
                           + $"({h.Kisi.Count(x => x.Value[KGuncelle] > 0)} kişi). Geri al ile eski hâline dönebilir.");

        if (h.YillikAtlanan > 0)
            h.Bilgiler.Add($"{h.YillikAtlanan:N0} gün onaylı izinli (yıllık, raporlu…) olduğu için atlanacak "
                           + $"({h.Kisi.Count(x => x.Value[KYillik] > 0)} kişi).");

        if (h.TatilGunu > 0)
            h.Bilgiler.Add((g.ResmiTatil ?? "izinli") == "izinli"
                ? $"Aralıkta {h.TatilGunu} resmi tatil var; bu günler haftalık izin olarak yazılacak."
                : $"Aralıkta {h.TatilGunu} resmi tatil var; bu günler desene göre planlanacak.");

        if (h.Yazilacak.Count == 0 && !h.Engel)
            h.Bilgiler.Add("Yazılacak yeni bir gün yok: seçilen günlerin hepsi zaten aynı planda ya da korunuyor.");

        return h;
    }

    private object Ozet(Hazirlik h, TopluGirdi g) => new
    {
        engel = h.Engel,
        kisiSayisi = h.Kisiler.Count,
        gunSayisi = h.GunSayisi,
        hucre = h.Kisiler.Count * h.GunSayisi,
        yazilacak = h.Yazilacak.Count,
        eklenecek = h.Eklenecek,
        guncellenecek = h.Guncellenecek,
        korunan = h.Korunan,
        ayni = h.Ayni,
        yillikAtlanan = h.YillikAtlanan,
        atlanan = h.Atlanan,
        tatilGunu = h.TatilGunu,
        uyarilar = h.Uyarilar,
        bilgiler = h.Bilgiler,

        /* Isı haritası: gün gün kaç kişi çalışıyor, izinli, üzerine yazılan */
        takvim = h.Takvim.OrderBy(x => x.Key).Select(x => new
        {
            tarih = x.Key,
            calisan = x.Value[TCalisan],
            izinli = x.Value[TIzinli],
            bos = x.Value[TBos],
            uzerine = x.Value[TUzerine],
            korunan = x.Value[TKorunan],
            yillik = x.Value[TYillik],
            tatil = h.Tatiller.TryGetValue(x.Key, out var t) ? t : null,
        }).ToList(),

        kisiler = h.Kisiler
            .Select(p =>
            {
                var s = h.Kisi[p.PersonelKodu.Trim()];
                return new
                {
                    sicil = p.PersonelKodu.Trim(),
                    adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                    pozisyon = p.Pozisyon,
                    birim = p.IsGrubu,
                    eklenecek = s[KEkle],
                    guncellenecek = s[KGuncelle],
                    korunan = s[KKorunan],
                    yillik = s[KYillik],
                    ayni = s[KAyni],
                };
            })
            .OrderByDescending(x => x.guncellenecek + x.korunan + x.yillik)
            .ThenBy(x => x.adSoyad)
            .ToList(),
    };

    [HttpPost("Onizleme")]
    public IActionResult Onizleme([FromBody] TopluGirdi g)
    {
        using var db = _vt.Baglanti();

        var h = Hazirla(db, g);

        if (h.Hata is not null) return BadRequest(new { hata = h.Hata });

        return Ok(Ozet(h, g));
    }

    [HttpPost("Uygula")]
    public IActionResult Uygula([FromBody] TopluGirdi g)
    {
        using var db = _vt.Baglanti();

        /* Geçici tablo oturuma bağlı: bağlantı baştan sona açık kalmalı */
        db.Open();

        var h = Hazirla(db, g);

        if (h.Hata is not null) return BadRequest(new { hata = h.Hata });

        if (h.Engel)
            return BadRequest(new
            {
                hata = "Desen uygulanamaz.",
                ayrinti = string.Join(" ", h.Uyarilar.Take(1)),
            });

        if (h.Yazilacak.Count == 0)
            return BadRequest(new { hata = "Yazılacak gün yok.", ayrinti = string.Join(" ", h.Bilgiler) });

        var yapan = Yapan();
        var desenJson = JsonSerializer.Serialize(g.Desen, Json);
        var siciller = string.Join(",", h.Kisiler.Select(x => x.PersonelKodu.Trim()));
        var bildirim = g.Yayinla && (g.Bildirim ?? "ozet") == "ozet" ? "ozet" : "yok";

        db.Execute(@"
IF OBJECT_ID('tempdb..#tv') IS NOT NULL DROP TABLE #tv;
CREATE TABLE #tv (
    personel_kodu NVARCHAR(30) NOT NULL,
    gun           DATE         NOT NULL,
    hafta         DATE         NOT NULL,
    sablon_id     INT          NULL,
    tur           NVARCHAR(10) NOT NULL,
    PRIMARY KEY (personel_kodu, gun)
);");

        /* Çok satırlı VALUES: SQL Server tek ifadede en fazla 1000 satır
           kabul ediyor. Değerler sayı, tarih ve personel kodu; kod tırnak
           kaçışıyla yazılıyor. */
        foreach (var parca in h.Yazilacak.Chunk(1000))
        {
            var sb = new StringBuilder("INSERT INTO #tv (personel_kodu, gun, hafta, sablon_id, tur) VALUES ");

            for (var i = 0; i < parca.Length; i++)
            {
                var s = parca[i];

                if (i > 0) sb.Append(',');

                sb.Append("(N'").Append(s.Kod.Replace("'", "''")).Append("','")
                  .Append(s.Gun.ToString("yyyyMMdd", CultureInfo.InvariantCulture)).Append("','")
                  .Append(s.Hafta.ToString("yyyyMMdd", CultureInfo.InvariantCulture)).Append("',")
                  .Append(s.SablonId?.ToString(CultureInfo.InvariantCulture) ?? "NULL").Append(",N'")
                  .Append(s.Tur).Append("')");
            }

            db.Execute(sb.ToString(), commandTimeout: 120);
        }

        using var tx = db.BeginTransaction();

        int id;
        int eklenen, guncellenen;

        try
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_TOPLU_VARDIYA
    (yapan, imza, desen_ad, desen, bas, bitis, kapsam, siciller, kisi_sayisi,
     resmi_tatil, uzerine_yaz, yayinla, bildirim, uyarilar)
OUTPUT INSERTED.id
VALUES (@yapan, N'', @desenAd, @desen, @bas, @bit, @kapsam, @siciller, @kisi,
        @resmiTatil, @uzerine, @yayinla, @bildirim, @uyarilar)",
                new
                {
                    yapan = Kes(yapan, 150),
                    desenAd = Kes(string.IsNullOrWhiteSpace(g.DesenAd) ? DesenMetni(g.Desen, h.Sablonlar) : g.DesenAd.Trim(), 100),
                    desen = desenJson,
                    bas = g.Bas.Date,
                    bit = g.Bit.Date,
                    kapsam = Kes(g.Kapsam, 500),
                    siciller,
                    kisi = h.Kisiler.Count,
                    resmiTatil = (g.ResmiTatil ?? "izinli") == "plan" ? "plan" : "izinli",
                    uzerine = g.UzerineYaz,
                    yayinla = g.Yayinla,
                    bildirim,
                    uyarilar = Kes(string.Join(" | ", h.Uyarilar), 1000),
                }, tx);

            /* İmza: satırların guncelleyen alanı. Geri almada yalnızca hâlâ
               bu imza ve işlem zamanıyla duran satırlara dokunuluyor. */
            var imza = Kes($"Toplu #{id} · {yapan}", 100);

            db.Execute("UPDATE KRY_TOPLU_VARDIYA SET imza = @imza WHERE id = @id", new { id, imza }, tx);

            var sonuc = db.QueryFirst(@"
DECLARE @z DATETIME2 = (SELECT zaman FROM KRY_TOPLU_VARDIYA WHERE id = @id);

/* Üzerine yazılacak satırların eski hâli */
INSERT INTO KRY_TOPLU_VARDIYA_YEDEK (islem_id, personel_kodu, gun, hafta, sablon_id, tur, guncelleyen, guncelleme)
SELECT @id, p.personel_kodu, p.gun, p.hafta, p.sablon_id, p.tur, p.guncelleyen, p.guncelleme
FROM KRY_VARDIYA_PLAN p
INNER JOIN #tv t ON t.personel_kodu = p.personel_kodu AND t.gun = p.gun
WHERE @uzerine = 1;

DECLARE @guncellenen INT = 0;

IF @uzerine = 1
BEGIN
    UPDATE p SET sablon_id = t.sablon_id, tur = t.tur, hafta = t.hafta,
                 guncelleyen = @imza, guncelleme = @z
    FROM KRY_VARDIYA_PLAN p
    INNER JOIN #tv t ON t.personel_kodu = p.personel_kodu AND t.gun = p.gun;

    SET @guncellenen = @@ROWCOUNT;
END

INSERT INTO KRY_VARDIYA_PLAN (personel_kodu, gun, hafta, sablon_id, tur, guncelleyen, guncelleme)
SELECT t.personel_kodu, t.gun, t.hafta, t.sablon_id, t.tur, @imza, @z
FROM #tv t
WHERE NOT EXISTS (SELECT 1 FROM KRY_VARDIYA_PLAN p WHERE p.personel_kodu = t.personel_kodu AND p.gun = t.gun);

DECLARE @eklenen INT = @@ROWCOUNT;

/* Kişi-hafta günlüğü: plan ekranındaki süreç geçmişinde görünür */
INSERT INTO KRY_VARDIYA_PLAN_LOG (personel_kodu, hafta, olay, aciklama, yapan)
SELECT DISTINCT t.personel_kodu, t.hafta, N'Toplu vardiya uygulandı (#' + CAST(@id AS NVARCHAR(10)) + N')',
       @aciklama, @yapan
FROM #tv t;

SELECT @eklenen AS eklenen, @guncellenen AS guncellenen;",
                new
                {
                    id,
                    imza,
                    uzerine = g.UzerineYaz,
                    yapan = Kes(yapan, 100),
                    aciklama = Kes($"{DesenMetni(g.Desen, h.Sablonlar)} · {g.Bas:dd.MM.yyyy} – {g.Bit:dd.MM.yyyy}", 500),
                }, tx, commandTimeout: 300);

            eklenen = (int)sonuc.eklenen;
            guncellenen = (int)sonuc.guncellenen;

            /* Yayın: plan personele gönderilmiş sayılır. Önceki durum yedeğe
               alınıyor; geri almada geri konuyor. */
            if (g.Yayinla)
                db.Execute(@"
DECLARE @z DATETIME2 = (SELECT zaman FROM KRY_TOPLU_VARDIYA WHERE id = @id);

SELECT DISTINCT personel_kodu, hafta INTO #th FROM #tv;

INSERT INTO KRY_TOPLU_VARDIYA_DURUM_YEDEK (islem_id, personel_kodu, hafta, vardi, durum, surum, gonderen, gonderme)
SELECT @id, w.personel_kodu, w.hafta,
       CASE WHEN d.personel_kodu IS NULL THEN 0 ELSE 1 END,
       d.durum, d.surum, d.gonderen, d.gonderme
FROM #th w
LEFT JOIN KRY_VARDIYA_PLAN_DURUM d ON d.personel_kodu = w.personel_kodu AND d.hafta = w.hafta;

UPDATE d SET durum = N'gonderildi', surum = d.surum + 1, gonderen = @yapan, gonderme = @z,
             red_neden = NULL, red_gun = NULL, karar = NULL
FROM KRY_VARDIYA_PLAN_DURUM d
INNER JOIN #th w ON w.personel_kodu = d.personel_kodu AND w.hafta = d.hafta;

INSERT INTO KRY_VARDIYA_PLAN_DURUM (personel_kodu, hafta, durum, surum, gonderen, gonderme)
SELECT w.personel_kodu, w.hafta, N'gonderildi', 1, @yapan, @z
FROM #th w
WHERE NOT EXISTS (SELECT 1 FROM KRY_VARDIYA_PLAN_DURUM d
                  WHERE d.personel_kodu = w.personel_kodu AND d.hafta = w.hafta);

DROP TABLE #th;",
                    new { id, yapan = Kes(yapan, 150) }, tx, commandTimeout: 300);

            db.Execute(@"
UPDATE KRY_TOPLU_VARDIYA
SET eklenen = @eklenen, guncellenen = @guncellenen, korunan = @korunan,
    yillik_atlanan = @yillik, bildirim_sayisi = @bildirimSayisi
WHERE id = @id",
                new
                {
                    id,
                    eklenen,
                    guncellenen,
                    korunan = h.Korunan,
                    yillik = h.YillikAtlanan,
                    bildirimSayisi = bildirim == "ozet" ? h.Yazilacak.Select(x => x.Kod).Distinct().Count() : 0,
                }, tx);

            tx.Commit();
        }
        catch (Exception hata)
        {
            try { tx.Rollback(); } catch { /* bağlantı zaten kopmuş olabilir */ }

            _kayit.LogError(hata, "Toplu vardiya yazılamadı");

            return StatusCode(500, new { hata = "Toplu vardiya yazılamadı.", ayrinti = hata.Message });
        }
        finally
        {
            try { db.Execute("IF OBJECT_ID('tempdb..#tv') IS NOT NULL DROP TABLE #tv;"); } catch { }
        }

        /* Bildirim: gün başına değil, kişi başına tek özet. Arka planda:
           yüz kişilik birimde yanıt beklemesin. */
        if (bildirim == "ozet")
        {
            var alicilar = h.Yazilacak.Select(x => x.Kod).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var baslik = "Vardiya planınız tanımlandı";
            var metin = $"{g.Bas:dd.MM.yyyy} – {g.Bit:dd.MM.yyyy} dönemi için vardiya planınız İnsan Kaynakları "
                        + "tarafından tanımlandı. Uygulamadaki Vardiya Planı ekranından görebilirsiniz.";
            var kapsam = _kapsam;
            var kayit = _kayit;

            _ = Task.Run(async () =>
            {
                try
                {
                    using var s = kapsam.CreateScope();
                    var b = s.ServiceProvider.GetRequiredService<BildirimServisi>();

                    foreach (var kod in alicilar)
                        await b.Gonder(kod, baslik, metin, "vardiyaplani");
                }
                catch (Exception hata)
                {
                    kayit.LogWarning(hata, "Toplu vardiya bildirimleri gönderilemedi");
                }
            });
        }

        return Ok(new
        {
            basarili = true,
            id,
            eklenen,
            guncellenen,
            korunan = h.Korunan,
            yillikAtlanan = h.YillikAtlanan,
            kisiSayisi = h.Kisiler.Count,
            bildirim = bildirim == "ozet" ? h.Yazilacak.Select(x => x.Kod).Distinct().Count() : 0,
        });
    }

    private static string Kes(string s, int n) => s is null ? null : s.Length > n ? s[..n] : s;

    private static string DesenMetni(List<DesenGun> desen, List<VSablon> sablonlar)
    {
        if (desen is not { Count: 7 }) return "";

        string Ad(DesenGun d) => (d?.Tur ?? "atla") switch
        {
            "vardiya" => sablonlar.FirstOrDefault(x => x.Id == d.SablonId)?.Ad ?? "Vardiya",
            "izin" => "İzin",
            "off" => "Boş",
            _ => "—",
        };

        /* Ardışık aynı günler birleştiriliyor: "Pzt–Cum Sabahçı · Cmt–Paz İzin" */
        var parcalar = new List<string>();
        var i = 0;

        while (i < 7)
        {
            var j = i;

            while (j + 1 < 7 && Ad(desen[j + 1]) == Ad(desen[i])) j++;

            if (Ad(desen[i]) != "—")
                parcalar.Add((i == j ? GunKisa[i] : $"{GunKisa[i]}–{GunKisa[j]}") + " " + Ad(desen[i]));

            i = j + 1;
        }

        return string.Join(" · ", parcalar);
    }

    /* ==================================================================== */
    /* Geçmiş ve geri alma                                                  */
    /* ==================================================================== */

    [HttpGet("Islemler")]
    public IActionResult Islemler([FromQuery] int adet = 20)
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT TOP (@adet) id, zaman, yapan, desen_ad AS desenAd, bas, bitis AS bit, kapsam, kisi_sayisi AS kisiSayisi,
       eklenen, guncellenen, korunan, yillik_atlanan AS yillikAtlanan, resmi_tatil AS resmiTatil,
       uzerine_yaz AS uzerineYaz, yayinla, bildirim, bildirim_sayisi AS bildirimSayisi,
       geri_alindi AS geriAlindi, geri_alan AS geriAlan, geri_ozet AS geriOzet
FROM KRY_TOPLU_VARDIYA ORDER BY id DESC", new { adet = Math.Clamp(adet, 1, 100) }).ToList();

        return Ok(new { islemler = liste });
    }

    /// <summary>
    /// Toplu işlemi geri alır: işlemin eklediği satırlar silinir, üzerine
    /// yazdıkları eski hâline döner, yayın durumu geri konur. İşlemden
    /// sonra müdürün değiştirdiği günlere dokunulmaz.
    /// </summary>
    [HttpPost("GeriAl/{id:int}")]
    public IActionResult GeriAl(int id)
    {
        using var db = _vt.Baglanti();

        db.Open();

        var islem = db.QueryFirstOrDefault(@"
SELECT id, zaman, imza, bas, bitis AS bit, siciller, eklenen, guncellenen, geri_alindi AS geriAlindi
FROM KRY_TOPLU_VARDIYA WHERE id = @id", new { id });

        if (islem is null) return NotFound(new { hata = "İşlem bulunamadı." });

        if (islem.geriAlindi is not null) return BadRequest(new { hata = "Bu işlem zaten geri alınmış." });

        /* Sıra: aynı kişi ve günlere dokunan daha yeni bir toplu işlem
           geri alınmadan bu işlem geri alınamaz; yoksa yeni işlemin yedeği
           bu işlemin yazdığı değerleri geri getirir. */
        var kodlar = ((string)islem.siciller ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var y in db.Query(@"
SELECT id, siciller FROM KRY_TOPLU_VARDIYA
WHERE id > @id AND geri_alindi IS NULL AND bas <= @bit AND bitis >= @bas",
                     new { id, bas = (DateTime)islem.bas, bit = (DateTime)islem.bit }))
        {
            var ortak = ((string)y.siciller ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Any(x => kodlar.Contains(K(x)));

            if (ortak)
                return BadRequest(new
                {
                    hata = $"Önce daha yeni olan #{(int)y.id} numaralı toplu işlemi geri alınız.",
                    ayrinti = "Aynı personel ve tarihlere dokunan daha yeni bir toplu işlem var.",
                });
        }

        var yapan = Yapan();

        using var tx = db.BeginTransaction();

        try
        {
            var sonuc = db.QueryFirst(@"
DECLARE @z DATETIME2 = (SELECT zaman FROM KRY_TOPLU_VARDIYA WHERE id = @id);

/* Etkilenen kişi-haftalar (günlük için) */
SELECT DISTINCT personel_kodu, hafta INTO #gh
FROM KRY_VARDIYA_PLAN WHERE guncelleyen = @imza AND guncelleme = @z;

/* Üzerine yazılanlar eski hâline */
UPDATE p SET sablon_id = y.sablon_id, tur = y.tur, hafta = y.hafta,
             guncelleyen = y.guncelleyen, guncelleme = y.guncelleme
FROM KRY_VARDIYA_PLAN p
INNER JOIN KRY_TOPLU_VARDIYA_YEDEK y
        ON y.islem_id = @id AND y.personel_kodu = p.personel_kodu AND y.gun = p.gun
WHERE p.guncelleyen = @imza AND p.guncelleme = @z;

DECLARE @donen INT = @@ROWCOUNT;

/* İşlemin eklediği satırlar silinir */
DELETE p FROM KRY_VARDIYA_PLAN p
WHERE p.guncelleyen = @imza AND p.guncelleme = @z
  AND NOT EXISTS (SELECT 1 FROM KRY_TOPLU_VARDIYA_YEDEK y
                  WHERE y.islem_id = @id AND y.personel_kodu = p.personel_kodu AND y.gun = p.gun);

DECLARE @silinen INT = @@ROWCOUNT;

/* Yayın durumu: işlemin bıraktığı hâlde duruyorsa eskiye döner */
UPDATE d SET durum = y.durum, surum = y.surum, gonderen = y.gonderen, gonderme = y.gonderme
FROM KRY_VARDIYA_PLAN_DURUM d
INNER JOIN KRY_TOPLU_VARDIYA_DURUM_YEDEK y
        ON y.islem_id = @id AND y.personel_kodu = d.personel_kodu AND y.hafta = d.hafta AND y.vardi = 1
WHERE d.gonderme = @z;

DELETE d FROM KRY_VARDIYA_PLAN_DURUM d
INNER JOIN KRY_TOPLU_VARDIYA_DURUM_YEDEK y
        ON y.islem_id = @id AND y.personel_kodu = d.personel_kodu AND y.hafta = d.hafta AND y.vardi = 0
WHERE d.gonderme = @z;

INSERT INTO KRY_VARDIYA_PLAN_LOG (personel_kodu, hafta, olay, aciklama, yapan)
SELECT personel_kodu, hafta, N'Toplu vardiya geri alındı (#' + CAST(@id AS NVARCHAR(10)) + N')', NULL, @yapan
FROM #gh;

DROP TABLE #gh;

SELECT @silinen AS silinen, @donen AS donen;",
                new { id, imza = (string)islem.imza, yapan = Kes(yapan, 100) }, tx, commandTimeout: 300);

            var silinen = (int)sonuc.silinen;
            var donen = (int)sonuc.donen;
            var beklenen = ((int?)islem.eklenen ?? 0) + ((int?)islem.guncellenen ?? 0);
            var dokunulmayan = Math.Max(0, beklenen - silinen - donen);

            var ozet = $"{silinen:N0} gün silindi, {donen:N0} gün eski hâline döndü"
                       + (dokunulmayan > 0 ? $", sonradan değiştirilen {dokunulmayan:N0} güne dokunulmadı" : "")
                       + ".";

            db.Execute(@"
UPDATE KRY_TOPLU_VARDIYA SET geri_alindi = SYSDATETIME(), geri_alan = @yapan, geri_ozet = @ozet
WHERE id = @id", new { id, yapan = Kes(yapan, 150), ozet }, tx);

            tx.Commit();

            return Ok(new { basarili = true, silinen, donen, dokunulmayan, ozet });
        }
        catch (Exception hata)
        {
            try { tx.Rollback(); } catch { }

            _kayit.LogError(hata, "Toplu vardiya geri alınamadı");

            return StatusCode(500, new { hata = "Geri alınamadı.", ayrinti = hata.Message });
        }
    }
}

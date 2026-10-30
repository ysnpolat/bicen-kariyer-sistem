using System.Data;
using System.Text.RegularExpressions;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Stok modüllerinin veri katmanı.
///
/// <para>
/// İki kaynak var. Ağır Mikro sorguları (sipariş önerisi, depo durumu,
/// fire, stok kartı, sipariş takibi) <see cref="StokSorgulari"/> içinde
/// depo parametreli şablonlar hâlinde duruyor. Transfer önerisi ve raf
/// denetimi ise Mikro'daki <c>PUSULA</c> görünümünden okunuyor.
/// </para>
///
/// <para>
/// PUSULA şubeleri sütun olarak tutuyor: <c>S_11</c>, <c>SDG_11</c>,
/// <c>MSG_11</c> gibi. Hangi şubelerin bulunduğu sütun adlarından
/// çıkarılıyor; böylece yeni şube açıldığında ya da sütun düzeni
/// değiştiğinde kod elden geçirilmiyor. Sorgular da bu sütunlardan
/// satır üreten bir alt sorguyla yazılıyor.
/// </para>
///
/// <para>
/// Sorguların hepsi ağır; sonuçlar depo bazında 10 dakika bellekte
/// tutuluyor. Ekran her açılışta Mikro'yu yormuyor, "yenile" düğmesi
/// önbelleği atlıyor.
/// </para>
/// </summary>
public class StokServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<StokServisi> _kayit;

    public StokServisi(VeritabaniServisi vt, ILogger<StokServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Önbellek                                                             */
    /* ==================================================================== */

    private static readonly Dictionary<string, (DateTime zaman, object veri)> _bellek = new();
    private static readonly object _kilit = new();

    private static readonly TimeSpan Omur = TimeSpan.FromMinutes(10);

    private T Bellekli<T>(string anahtar, bool yenile, Func<T> uret) where T : class
    {
        if (!yenile)
            lock (_kilit)
                if (_bellek.TryGetValue(anahtar, out var v) && DateTime.UtcNow - v.zaman < Omur)
                    return (T)v.veri;

        var sonuc = uret();

        lock (_kilit) _bellek[anahtar] = (DateTime.UtcNow, sonuc);

        return sonuc;
    }

    /// <summary>Önbellekteki bir deponun verisi ne zaman hesaplandı.</summary>
    public DateTime? SonHesap(string anahtar)
    {
        lock (_kilit)
            return _bellek.TryGetValue(anahtar, out var v) ? v.zaman : null;
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    /// <summary>
    /// Depo numarası sorgu metnine gömülüyor; önce sayı olduğu
    /// doğrulanıyor. Dapper parametresi kullanılamıyor çünkü numara alt
    /// sorguların içinde ve indeks seçimini etkiliyor.
    /// </summary>
    public static int Sayi(int deger, string ad)
    {
        if (deger is < 0 or > 99999)
            throw new ArgumentException($"{ad} geçersiz.");

        return deger;
    }

    private static string Doldur(string sablon, int depo, int? yil = null) =>
        sablon.Replace("{DEPO}", Sayi(depo, "Depo").ToString())
              .Replace("{YIL}", (yil ?? DateTime.Today.Year).ToString());

    /* ==================================================================== */
    /* Depolar                                                              */
    /* ==================================================================== */

    public sealed record Depo(int No, string Ad, string SubeKodu);

    /// <summary>
    /// Seçilebilecek depolar: portaldaki şube-depo eşleşmesi esas,
    /// eşleşmede olmayanlar Mikro'daki depo tanımından tamamlanıyor.
    /// </summary>
    public List<Depo> Depolar(bool yenile = false) => Bellekli("depolar", yenile, () =>
    {
        var sonuc = new List<Depo>();

        try
        {
            using var db = _vt.Baglanti();

            /* Yönetim → Şube ve e-posta sayfasında pasife alınan şubeler
               listeye girmiyor; kapanan mağaza seçilebilir kalmamalı. */
            sonuc = db.Query(@"
SELECT depo_no AS no, sube_adi AS ad, sube_kodu AS subeKodu
FROM B360_SUBE_DEPO WHERE depo_no IS NOT NULL AND aktif = 1 ORDER BY sube_adi")
                .Select(x => new Depo((int)x.no, (string)x.ad ?? "", (string)x.subeKodu ?? ""))
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şube-depo eşleşmesi okunamadı");
        }

        try
        {
            using var mikro = _vt.MikroBaglantisi();

            var mikroDepolar = mikro.Query(@"
SELECT dep_no AS no, LTRIM(RTRIM(dep_adi)) AS ad FROM DEPOLAR WITH (NOLOCK) ORDER BY dep_no")
                .Select(x => new Depo((int)x.no, (string)x.ad ?? "", ""))
                .ToList();

            /* Eşleşmede adı boş kalan depoların adı Mikro'dan */
            sonuc = sonuc
                .Select(d => string.IsNullOrWhiteSpace(d.Ad)
                    ? d with { Ad = mikroDepolar.FirstOrDefault(m => m.No == d.No)?.Ad ?? $"Depo {d.No}" }
                    : d)
                .ToList();

            /* Mikro'daki diğer depolar eklenmiyor: hangi şubenin aktif
               olduğu portalda tanımlı, Mikro'da kapanmış mağazalar da
               duruyor. Yalnızca adı eksik olanlar Mikro'dan tamamlanıyor
               (yukarıda). */
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Mikro depo listesi okunamadı");
        }

        return sonuc.OrderBy(x => x.No).ToList();
    });

    /* ==================================================================== */
    /* PUSULA                                                               */
    /* ==================================================================== */

    /// <summary>PUSULA'daki şube numaraları ve bulunan sütun ekleri.</summary>
    public sealed record PusulaYapi(List<int> Depolar, HashSet<string> Sutunlar);

    public PusulaYapi Pusula(bool yenile = false) => Bellekli("pusula", yenile, () =>
    {
        try
        {
            using var db = _vt.MikroBaglantisi();

            var sutunlar = db.Query<string>(@"
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'PUSULA'")
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            /* S_11, SDG_11, MSG_11 … sütunlarından şube numaraları */
            var depolar = sutunlar
                .Select(x => Regex.Match(x, @"^S_(\d+)$", RegexOptions.IgnoreCase))
                .Where(m => m.Success)
                .Select(m => int.Parse(m.Groups[1].Value))
                .Where(no => sutunlar.Contains($"MSG_{no}"))
                .OrderBy(x => x)
                .ToList();

            _kayit.LogInformation("PUSULA şubeleri: {Depolar}", string.Join(", ", depolar));

            return new PusulaYapi(depolar, sutunlar);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "PUSULA okunamadı");
            return new PusulaYapi(new List<int>(), new HashSet<string>());
        }
    });

    private static string PusulaSutun(PusulaYapi y, string ek, int depo, string varsayilan = "NULL")
    {
        var ad = $"{ek}_{depo}";
        return y.Sutunlar.Contains(ad) ? $"p.[{ad}]" : varsayilan;
    }

    /// <summary>Alt sorgudaki karşı şube bloğu için sütun ("k" takma adı).</summary>
    private static string KarsiSutun(PusulaYapi y, string ek, int depo, string varsayilan)
    {
        var ad = $"{ek}_{depo}";
        return y.Sutunlar.Contains(ad) ? $"k.[{ad}]" : varsayilan;
    }

    private static string PusulaOrtak(PusulaYapi y, string ad, string varsayilan = "NULL") =>
        y.Sutunlar.Contains(ad) ? $"p.[{ad}]" : varsayilan;

    /* ==================================================================== */
    /* Raf denetimi                                                         */
    /* ==================================================================== */

    /// <summary>
    /// Stokta duran, uzun süredir satmayan ama başka mağazalarda iyi
    /// satan ürünler: sorun üründe değil, mağazada demektir.
    /// </summary>
    public List<dynamic> RafDenetimi(int depo, bool yenile = false) =>
        Bellekli($"raf:{depo}", yenile, () =>
        {
            var y = Pusula();

            if (!y.Depolar.Contains(depo)) return new List<dynamic>();

            var sql = $@"
SELECT TOP 300
  p.sto_kod AS stokKod,
  {PusulaOrtak(y, "BARKOD", "''")} AS barkod,
  p.sto_isim AS stokIsim,
  {PusulaOrtak(y, "san_isim", "''")} AS anaGrup,
  {PusulaOrtak(y, "ktg_isim", "''")} AS kategori,
  {PusulaOrtak(y, "koli", "0")} AS koli,
  {PusulaOrtak(y, "paket", "0")} AS paket,
  ROUND({PusulaSutun(y, "S", depo, "0")}, 0) AS stok,
  {PusulaSutun(y, "SKGOG", depo)} AS girisGun,
  {PusulaSutun(y, "SKOS", depo)} AS satisGun,
  {PusulaOrtak(y, "F", "0")} AS magazaSayisi,
  {PusulaSutun(y, "MSG", depo, "''")} AS durum
FROM MikroDB_V15_BICEN.dbo.PUSULA p WITH (NOLOCK)
WHERE {PusulaSutun(y, "MSG", depo, "''")} IN ('ÜS','ÜY','MK')
  AND {PusulaSutun(y, "S", depo, "0")} > 0
  AND {PusulaSutun(y, "SKOS", depo, "0")} > 15
  AND {PusulaOrtak(y, "F", "0")} >= 20
  AND {PusulaSutun(y, "SKGOG", depo, "0")} > 6
ORDER BY {PusulaOrtak(y, "san_isim", "''")}, {PusulaOrtak(y, "ktg_isim", "''")}";

            using var db = _vt.MikroBaglantisi();

            return db.Query(sql, commandTimeout: 180).ToList();
        });

    /* ==================================================================== */
    /* Şubeler arası transfer                                               */
    /* ==================================================================== */

    /// <summary>
    /// Bu şubede yok satan, başka şubede fazla olan ürünler; ve tersi.
    ///
    /// Sorgu iki şube için elle yazılıyordu; burada PUSULA'daki bütün
    /// şubeler taranıyor. Öneri miktarı veren şubenin stoğunun yarısı —
    /// karşı şube açıkta kalmasın.
    /// </summary>
    public List<dynamic> Transfer(int depo, string yon = "gelen", bool yenile = false) =>
        Bellekli($"transfer:{depo}:{yon}", yenile, () =>
        {
            var y = Pusula();

            if (!y.Depolar.Contains(depo)) return new List<dynamic>();

            var digerler = y.Depolar.Where(x => x != depo).ToList();

            if (digerler.Count == 0) return new List<dynamic>();

            /* Karşı şubeler tek tek satıra açılıyor. Her blok kendi
               FROM'unu taşıyor: dış sorgunun "p" takma adı alt sorgunun
               içinde görünmediği için sütunlar bağlanamıyordu. */
            var bloklar = digerler.Select(d => $@"
SELECT k.sto_kod,
       {d} AS karsiDepo,
       {KarsiSutun(y, "S", d, "0")} AS karsiStok,
       {KarsiSutun(y, "SDG", d, "999")} AS karsiSdg,
       {KarsiSutun(y, "MSG", d, "''")} AS karsiDurum
FROM MikroDB_V15_BICEN.dbo.PUSULA k WITH (NOLOCK)");

            var karsi = string.Join("\nUNION ALL", bloklar);

            /* gelen: bende yok satıyor, onda fazla · veren: tersi */
            var kosul = yon == "veren"
                ? $@"{PusulaSutun(y, "MSG", depo, "''")} <> 'YS'
                     AND k.karsiDurum = 'YS'
                     AND (({PusulaSutun(y, "MSG", depo, "''")} IN ('ÜS','ÜY','MK')
                           AND {PusulaSutun(y, "S", depo, "0")} > 3)
                       OR ({PusulaSutun(y, "S", depo, "0")} > 6
                           AND {PusulaSutun(y, "SDG", depo, "0")} > 40
                           AND {PusulaSutun(y, "SDG", depo, "0")} <= 99))"
                : $@"{PusulaSutun(y, "MSG", depo, "''")} = 'YS'
                     AND ((k.karsiDurum IN ('ÜS','ÜY','MK') AND k.karsiStok > 3)
                       OR (k.karsiStok > 6 AND k.karsiSdg > 40 AND k.karsiSdg <= 99))";

            var miktar = yon == "veren"
                ? $"ROUND({PusulaSutun(y, "S", depo, "0")} / 2, 0)"
                : "ROUND(k.karsiStok / 2, 0)";

            var sql = $@"
SELECT TOP 300
  p.sto_kod AS stokKod,
  {PusulaOrtak(y, "BARKOD", "''")} AS barkod,
  p.sto_isim AS stokIsim,
  {PusulaOrtak(y, "san_isim", "''")} AS anaGrup,
  k.karsiDepo AS karsiDepo,
  ROUND({PusulaSutun(y, "S", depo, "0")}, 0) AS stok,
  {PusulaSutun(y, "SDG", depo, "0")} AS sdg,
  {PusulaSutun(y, "MSG", depo, "''")} AS durum,
  ROUND(k.karsiStok, 0) AS karsiStok,
  k.karsiSdg, k.karsiDurum,
  {miktar} AS oneri
FROM MikroDB_V15_BICEN.dbo.PUSULA p WITH (NOLOCK)
  INNER JOIN ({karsi}) k ON k.sto_kod = p.sto_kod
WHERE {kosul}
ORDER BY {miktar} DESC";

            using var db = _vt.MikroBaglantisi();

            return db.Query(sql, commandTimeout: 240).ToList();
        });

    /* ==================================================================== */
    /* Mikro sorguları                                                      */
    /* ==================================================================== */

    public List<dynamic> SiparisOnerisi(int depo, bool yenile = false) =>
        Bellekli($"oneri:{depo}", yenile, () =>
        {
            using var db = _vt.MikroBaglantisi();

            return db.Query(Doldur(StokSorgulari.SiparisOnerisi, depo), commandTimeout: 300).ToList();
        });

    public List<dynamic> DepoDurum(int depo, bool yenile = false) =>
        Bellekli($"depo:{depo}", yenile, () =>
        {
            using var db = _vt.MikroBaglantisi();

            return db.Query(Doldur(StokSorgulari.DepoDurum, depo), commandTimeout: 300).ToList();
        });

    public List<dynamic> Fire(int depo, int yil, bool yenile = false) =>
        Bellekli($"fire:{depo}:{yil}", yenile, () =>
        {
            using var db = _vt.MikroBaglantisi();

            return db.Query(Doldur(StokSorgulari.Fire, depo, yil), commandTimeout: 300).ToList();
        });

    public List<dynamic> StokKarti(string stok, int depo)
    {
        using var db = _vt.MikroBaglantisi();

        return db.Query(Doldur(StokSorgulari.StokKarti, depo),
            new { stok = (stok ?? "").Trim() }, commandTimeout: 180).ToList();
    }

    /// <summary>Bir ürünün o yıldaki fire hareketleri.</summary>
    public List<dynamic> FireDetay(string stok, int depo, int yil)
    {
        using var db = _vt.MikroBaglantisi();

        return db.Query(Doldur(StokSorgulari.FireDetay, depo, yil),
            new { stok = (stok ?? "").Trim() }, commandTimeout: 180).ToList();
    }

    public List<dynamic> MalGirisleri(int depo, int gun)
    {
        using var db = _vt.MikroBaglantisi();

        return db.Query(Doldur(StokSorgulari.MalGirisleri, depo),
            new { gun = Math.Clamp(gun, 1, 90) }, commandTimeout: 180).ToList();
    }

    /// <summary>
    /// Sipariş takibi: Mikro'daki sipariş ve sevk bilgisine OZMerkez'deki
    /// palet durumu ekleniyor. İki veritabanı ayrı sunucuda olduğu için
    /// bağlı sunucu yerine iki sorgu çalıştırılıp burada birleştiriliyor.
    /// </summary>
    /// <summary>
    /// Siparişi sevk hareketine bağlayan sütun Mikro sürümüne göre
    /// STOK_HAREKETLERI ya da STOK_HAREKETLERI_EK tarafında. Hangisinde
    /// olduğu bir kez okunuyor; hiçbirinde yoksa gelen miktar boş
    /// dönüyor ama sipariş listesi yine geliyor.
    /// </summary>
    public string SiparisBagi()
    {
        return Bellekli("siparisBag", false, () =>
        {
            try
            {
                using var db = _vt.MikroBaglantisi();

                var yer = db.Query<string>(@"
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME = 'sth_subesip_recid_recno'
  AND TABLE_NAME IN ('STOK_HAREKETLERI', 'STOK_HAREKETLERI_EK')").ToList();

                if (yer.Contains("STOK_HAREKETLERI_EK")) return "ek.sth_subesip_recid_recno";
                if (yer.Contains("STOK_HAREKETLERI")) return "sth.sth_subesip_recid_recno";

                _kayit.LogWarning("sth_subesip_recid_recno sütunu bulunamadı; "
                                + "sipariş–sevk eşleşmesi yapılamıyor.");

                return "NULL";
            }
            catch
            {
                return "NULL";
            }
        });
    }

    public List<dynamic> SiparisTakibi(int depo, DateTime bas, DateTime bit)
    {
        using var db = _vt.MikroBaglantisi();

        var satirlar = db.Query(
                Doldur(StokSorgulari.SiparisTakibi, depo).Replace("{SIPARIS_BAG}", SiparisBagi()),
                new { bas = bas.Date, bit = bit.Date.AddDays(1).AddSeconds(-1) }, commandTimeout: 240)
            .Cast<IDictionary<string, object>>()
            .ToList();

        if (satirlar.Count == 0) return new List<dynamic>();

        try
        {
            var kayitlar = satirlar
                .Select(x => Convert.ToInt32(x["kayitNo"]))
                .Distinct()
                .ToList();

            using var oz = _vt.OzMerkezBaglantisi();

            var paletler = oz.Query(StokSorgulari.Paletler.Replace("{DEPO}", Sayi(depo, "Depo").ToString()),
                    new { kayitlar }, commandTimeout: 120)
                .ToDictionary(x => (int)x.kayitNo, x => x);

            foreach (var s in satirlar)
            {
                var no = Convert.ToInt32(s["kayitNo"]);

                s["palet"] = paletler.TryGetValue(no, out var p) ? (string)p.palet : null;
                s["paletDurum"] = paletler.TryGetValue(no, out var d) ? (string)d.durum : null;
            }
        }
        catch (Exception hata)
        {
            /* Palet bilgisi alınamazsa sipariş listesi yine dönüyor */
            _kayit.LogWarning(hata, "Palet durumu okunamadı: depo {Depo}", depo);
        }

        return satirlar.Cast<dynamic>().ToList();
    }
}

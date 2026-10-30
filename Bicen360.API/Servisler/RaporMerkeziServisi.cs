using System.Collections.Concurrent;
using System.Data;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;

namespace Bicen360.API.Servisler;

/// <summary>
/// Rapor Merkezi veri katmanı.
///
/// <para>
/// <b>Günlük küp.</b> Satışlar her istekte Mikro'dan toplanmıyor: gün ×
/// depo × ana grup özeti (ciro, net, maliyet, fire, fiş) ve gün × depo ×
/// saat özeti bir kez okunup bellekte tutuluyor. Ekrandaki her süzgeç
/// değişikliği bu küp üzerinde, Mikro'ya gitmeden hesaplanıyor. Bir
/// haftadan eski günler değişmediği için diske de yazılıyor; uygulama
/// yeniden başladığında baştan okunmuyor.
/// </para>
///
/// <para>
/// <b>Arka planda yükleme.</b> Portal IIS'te out-of-process çalışıyor ve
/// istekler iki dakikada kesiliyor. Uzun dönem (yılbaşından beri, 90
/// gün) ilk kez istendiğinde Mikro sorgusu bundan uzun sürebilir. Bu
/// yüzden eksik günler kuyruğa yazılıyor, ekran "hazırlanıyor" cevabı
/// alıp birkaç saniyede bir tekrar soruyor.
/// </para>
///
/// <para>
/// <b>POS kaynağı.</b> Ödeme tipi ve gerçek fiş sayısı Mikro'da yok.
/// PosBack'teki satış tablosunun yapısı kuruma özel; yönetici ekranından
/// iki salt-okuma sorgusu tanımlanabiliyor (fiş/saat ve ödeme). Tanımlı
/// değilse fiş sayısı Mikro evrak sayısından, saat dağılımı satırların
/// oluşturulma zamanından hesaplanıyor ve ekranda belirtiliyor.
/// </para>
/// </summary>
public class RaporMerkeziServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly StokServisi _stok;
    private readonly ILogger<RaporMerkeziServisi> _kayit;
    private readonly string _klasor;

    /// <summary>Bu kadar günden eski günler kesinleşmiş sayılıyor ve diske yazılıyor.</summary>
    private const int KesinGun = 7;

    /// <summary>Merkez depolar: ciro analizinde şube sayılmıyor.</summary>
    public static readonly HashSet<int> MerkezDepolar = new() { 100, 103 };

    public RaporMerkeziServisi(VeritabaniServisi vt, StokServisi stok, IConfiguration yapilandirma,
        ILogger<RaporMerkeziServisi> kayit)
    {
        _vt = vt;
        _stok = stok;
        _kayit = kayit;

        _klasor = yapilandirma["RaporMerkezi:OnbellekKlasoru"] is { Length: > 0 } k
            ? k
            : Path.Combine(Path.GetTempPath(), "bicen360-rapor-merkezi");
    }

    private static DateTime Bugun => DateTime.Today;

    private static string Kisalt(string m) =>
        string.IsNullOrEmpty(m) ? "" : m.Length > 300 ? m[..300] : m;

    /* ==================================================================== */
    /* Yapı: şubeler, bölgeler, ana gruplar                                 */
    /* ==================================================================== */

    public sealed record Sube(int Depo, string Ad, string Kod, string Bolge);

    public sealed record Grup(string Kod, string Ad);

    public sealed record Yapi(List<Sube> Subeler, List<string> Bolgeler, List<Grup> Gruplar, DateTime Zaman);

    private Yapi _yapi;
    private readonly object _yapiKilit = new();

    public Yapi YapiGetir(bool yenile = false)
    {
        lock (_yapiKilit)
            if (!yenile && _yapi is not null && DateTime.Now - _yapi.Zaman < TimeSpan.FromMinutes(10))
                return _yapi;

        var depolar = _stok.Depolar(yenile)
            .Where(d => d.No > 0 && !MerkezDepolar.Contains(d.No))
            .GroupBy(d => d.No)
            .Select(g => g.First())
            .ToList();

        var bolgeler = BolgeEslesmesi();

        var subeler = depolar
            .Select(d => new Sube(d.No, Duzgun(d.Ad), d.SubeKodu ?? "", BolgeBul(bolgeler, d)))
            .OrderBy(s => s.Depo)
            .ToList();

        var gruplar = new List<Grup>();

        try
        {
            using var m = _vt.MikroBaglantisi();

            gruplar = m.Query(RaporMerkeziSorgulari.Gruplar, commandTimeout: 60)
                .Select(x => new Grup(((string)x.kod ?? "").Trim(), Duzgun((string)x.ad)))
                .Where(x => x.Kod.Length > 0)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor Merkezi: ana gruplar okunamadı");
        }

        var yapi = new Yapi(
            subeler,
            subeler.Select(s => s.Bolge).Where(b => b.Length > 0).Distinct().OrderBy(b => b, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true)).ToList(),
            gruplar,
            DateTime.Now);

        lock (_yapiKilit) _yapi = yapi;

        return yapi;
    }

    /// <summary>"ÖZLÜCE ŞUBE" → "Özlüce Şube": Mikro adları büyük harfle duruyor.</summary>
    private static string Duzgun(string ad)
    {
        ad = (ad ?? "").Trim();

        if (ad.Length == 0 || ad.Any(char.IsLower)) return ad;

        var tr = new System.Globalization.CultureInfo("tr-TR");

        return tr.TextInfo.ToTitleCase(ad.ToLower(tr));
    }

    /// <summary>Bölge adı → o bölgedeki şube adları/kodları (normalize).</summary>
    private Dictionary<string, List<string>> BolgeEslesmesi()
    {
        var sonuc = new Dictionary<string, List<string>>();

        try
        {
            using var db = _vt.Baglanti();

            foreach (var s in db.Query(@"
SELECT B.ad AS bolge, S.sube
FROM B360_BOLGE B INNER JOIN B360_BOLGE_SUBE S ON S.bolge_id = B.id
WHERE B.aktif = 1"))
            {
                var b = ((string)s.bolge ?? "").Trim();

                if (b.Length == 0) continue;

                if (!sonuc.TryGetValue(b, out var l)) sonuc[b] = l = new List<string>();

                l.Add(YetkiServisi.Anahtar((string)s.sube));
            }

            if (sonuc.Count > 0) return sonuc;

            /* Portalda bölge tanımı yoksa İK ayarındaki bölgeler */
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = 'FORM'");

            if (!string.IsNullOrWhiteSpace(ham))
            {
                using var j = JsonDocument.Parse(ham);

                var adlar = new Dictionary<string, string>();

                foreach (var p in j.RootElement.EnumerateObject())
                {
                    if (!p.Name.Equals("subeler", StringComparison.OrdinalIgnoreCase) ||
                        p.Value.ValueKind != JsonValueKind.Array) continue;

                    foreach (var x in p.Value.EnumerateArray())
                    {
                        var kod = Ozellik(x, "kod");
                        var ad = Ozellik(x, "ad");

                        if (kod.Length > 0) adlar[kod] = ad;
                    }
                }

                foreach (var p in j.RootElement.EnumerateObject())
                {
                    if (!p.Name.Equals("bolgeler", StringComparison.OrdinalIgnoreCase) ||
                        p.Value.ValueKind != JsonValueKind.Array) continue;

                    foreach (var x in p.Value.EnumerateArray())
                    {
                        var ad = Ozellik(x, "ad");

                        if (ad.Length == 0) continue;

                        var l = new List<string>();

                        foreach (var q in x.EnumerateObject())
                        {
                            if (!q.Name.Equals("subeler", StringComparison.OrdinalIgnoreCase) ||
                                q.Value.ValueKind != JsonValueKind.Array) continue;

                            foreach (var kod in q.Value.EnumerateArray())
                            {
                                var k = kod.ValueKind == JsonValueKind.String ? kod.GetString() ?? "" : kod.ToString();

                                l.Add(YetkiServisi.Anahtar(k));

                                if (adlar.TryGetValue(k, out var sa)) l.Add(YetkiServisi.Anahtar(sa));
                            }
                        }

                        sonuc[ad] = l;
                    }
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor Merkezi: bölge tanımları okunamadı");
        }

        return sonuc;
    }

    private static string Ozellik(JsonElement e, string ad)
    {
        foreach (var p in e.EnumerateObject())
            if (p.Name.Equals(ad, StringComparison.OrdinalIgnoreCase))
                return (p.Value.ValueKind == JsonValueKind.String ? p.Value.GetString() : p.Value.ToString())?.Trim() ?? "";

        return "";
    }

    private static string BolgeBul(Dictionary<string, List<string>> bolgeler, StokServisi.Depo d)
    {
        var ad = YetkiServisi.Anahtar(d.Ad);
        var kod = YetkiServisi.Anahtar(d.SubeKodu);

        /* Önce birebir, sonra içerme: "özlüce" ile "özlüce şube" eşleşsin */
        foreach (var (b, l) in bolgeler)
            if (l.Any(x => x.Length > 0 && (x == ad || x == kod)))
                return b;

        foreach (var (b, l) in bolgeler)
            if (l.Any(x => x.Length >= 4 && ad.Length >= 4 && (x.Contains(ad) || ad.Contains(x))))
                return b;

        return "";
    }

    /* ==================================================================== */
    /* POS kaynak ayarı                                                     */
    /* ==================================================================== */

    public sealed class PosAyar
    {
        /// <summary>@bas, @bit → gun, depo, saat, fis, ciro</summary>
        public string FisSorgusu { get; set; } = "";

        /// <summary>@bas, @bit → gun, depo, tip, tutar</summary>
        public string OdemeSorgusu { get; set; } = "";

        public string Guncelleyen { get; set; }

        public DateTime? Guncelleme { get; set; }
    }

    private const string PosAnahtar = "RAPOR_MERKEZI_POS";

    private PosAyar _pos;
    private DateTime _posZaman;

    public PosAyar PosAyarOku()
    {
        if (_pos is not null && DateTime.Now - _posZaman < TimeSpan.FromMinutes(1)) return _pos;

        var a = new PosAyar();

        try
        {
            using var db = _vt.Baglanti();

            var ham = db.ExecuteScalar<string>("SELECT deger FROM B360_AYAR WHERE anahtar = @PosAnahtar",
                new { PosAnahtar });

            if (!string.IsNullOrWhiteSpace(ham))
                a = JsonSerializer.Deserialize<PosAyar>(ham, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? a;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor Merkezi: POS ayarı okunamadı");
        }

        _pos = a;
        _posZaman = DateTime.Now;

        return a;
    }

    public void PosAyarYaz(PosAyar a, string yapan)
    {
        a.FisSorgusu = (a.FisSorgusu ?? "").Trim();
        a.OdemeSorgusu = (a.OdemeSorgusu ?? "").Trim();
        a.Guncelleyen = yapan;
        a.Guncelleme = DateTime.Now;

        if (a.FisSorgusu.Length > 0) SorguDenetle(a.FisSorgusu);
        if (a.OdemeSorgusu.Length > 0) SorguDenetle(a.OdemeSorgusu);

        using var db = _vt.Baglanti();

        db.Execute(@"
IF EXISTS (SELECT 1 FROM B360_AYAR WHERE anahtar = @anahtar)
    UPDATE B360_AYAR SET deger = @deger, guncelleme = SYSDATETIME() WHERE anahtar = @anahtar
ELSE
    INSERT INTO B360_AYAR (anahtar, deger) VALUES (@anahtar, @deger)",
            new { anahtar = PosAnahtar, deger = JsonSerializer.Serialize(a) });

        _pos = a;
        _posZaman = DateTime.Now;

        /* Kaynak değişti: saat ve ödeme küpü yeniden okunmalı */
        OnbellegiTemizle();
    }

    private static readonly Regex Yasak = new(
        @"\b(insert|update|delete|merge|drop|alter|create|truncate|exec|execute|grant|revoke|deny|backup|restore|shutdown|dbcc|openrowset|opendatasource|xp_\w+|sp_\w+|into)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Yalnızca okuma sorgusuna izin verilir.</summary>
    public static void SorguDenetle(string sql)
    {
        var temiz = Regex.Replace(sql ?? "", @"--[^\n]*|/\*.*?\*/", " ", RegexOptions.Singleline).Trim();

        if (!Regex.IsMatch(temiz, @"^(select|with)\b", RegexOptions.IgnoreCase))
            throw new ArgumentException("Sorgu SELECT ya da WITH ile başlamalı.");

        if (temiz.Contains(';'))
            throw new ArgumentException("Sorguda noktalı virgül olmamalı; tek bir SELECT yazınız.");

        var m = Yasak.Match(temiz);

        if (m.Success)
            throw new ArgumentException($"Sorguda izin verilmeyen ifade var: {m.Value}");
    }

    /// <summary>POS sorgusunu salt okunur çalıştırır: işlem her durumda geri alınıyor.</summary>
    public List<Dictionary<string, object>> PosCalistir(string sql, DateTime bas, DateTime bit, int ust = 0)
    {
        SorguDenetle(sql);

        using var db = (SqlConnection)_vt.PosBaglantisi();
        db.Open();

        using var islem = db.BeginTransaction(IsolationLevel.ReadUncommitted);

        try
        {
            using var komut = db.CreateCommand();

            komut.Transaction = islem;
            komut.CommandTimeout = 600;
            komut.CommandText = ust > 0 ? $"SELECT TOP {ust} * FROM ({sql}) AS t" : sql;
            foreach (var (ad, deger) in new[] { ("@bas", bas), ("@bit", bit) })
            {
                var p = komut.CreateParameter();
                p.ParameterName = ad;
                p.DbType = DbType.DateTime;
                p.Value = deger;
                komut.Parameters.Add(p);
            }

            var sonuc = new List<Dictionary<string, object>>();

            using (var okuyucu = komut.ExecuteReader())
            {
                while (okuyucu.Read())
                {
                    var s = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

                    for (var i = 0; i < okuyucu.FieldCount; i++)
                        s[okuyucu.GetName(i)] = okuyucu.IsDBNull(i) ? null : okuyucu.GetValue(i);

                    sonuc.Add(s);
                }
            }

            return sonuc;
        }
        finally
        {
            try { islem.Rollback(); } catch { /* bağlantı kapanmış olabilir */ }
        }
    }

    /// <summary>
    /// PosBack tanısı: sunucudaki veritabanları ve PosBack'in en kalabalık
    /// tabloları sütunlarıyla. Satış tablosunu bulup sorguyu yazmak için.
    /// </summary>
    public object PosTani()
    {
        using var db = _vt.PosBaglantisi();

        var veritabanlari = db.Query<string>(
            "SELECT name FROM sys.databases WHERE state = 0 ORDER BY name", commandTimeout: 30).ToList();

        var tablolar = db.Query(@"
SELECT TOP 40 s.name AS sema, t.name AS tablo, SUM(p.rows) AS satir
FROM sys.tables t
    INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
    INNER JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY s.name, t.name
ORDER BY SUM(p.rows) DESC", commandTimeout: 60).ToList();

        var sutunlar = db.Query(@"
SELECT TABLE_SCHEMA AS sema, TABLE_NAME AS tablo, COLUMN_NAME AS sutun, DATA_TYPE AS tur
FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION", commandTimeout: 60)
            .ToList();

        var anahtar = tablolar.Select(t => $"{t.sema}.{t.tablo}").ToHashSet();

        return new
        {
            veritabani = db.Database,
            veritabanlari,
            tablolar = tablolar.Select(t => new
            {
                ad = $"{t.sema}.{t.tablo}",
                satir = (long)t.satir,
                sutunlar = sutunlar
                    .Where(c => $"{c.sema}.{c.tablo}" == $"{t.sema}.{t.tablo}")
                    .Select(c => $"{c.sutun} ({c.tur})")
                    .ToList(),
            }).ToList(),
            odemeIpuclari = sutunlar
                .Where(c => Regex.IsMatch((string)c.sutun, "odeme|payment|tender|nakit|kredi|kart|tahsil", RegexOptions.IgnoreCase))
                .Select(c => $"{c.sema}.{c.tablo}.{c.sutun}")
                .Take(80)
                .ToList(),
        };
    }

    private string Imza()
    {
        var p = PosAyarOku();
        var ham = $"v1|{p.FisSorgusu}|{p.OdemeSorgusu}";

        return Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(ham)))[..12];
    }

    /* ==================================================================== */
    /* Günlük küp                                                           */
    /* ==================================================================== */

    public struct GH
    {
        public int Depo;
        public short Grup;
        public float Ciro, Net, NetM, Maliyet, Miktar, Fire;
        public int Fis;
    }

    public struct SH
    {
        public int Depo;
        public byte Saat;
        public float Ciro;
        public int Fis;
    }

    public struct OH
    {
        public int Depo;
        public short Tip;
        public float Tutar;
    }

    public sealed class Gun
    {
        public DateTime Tarih;
        public GH[] G = Array.Empty<GH>();
        public SH[] S = Array.Empty<SH>();
        public OH[] O = Array.Empty<OH>();
        public bool PosSaat;
        public bool PosOdeme;
        public string Imza;
        public DateTime Yuklendi;
    }

    /// <summary>Ana grup kodları ve ödeme tipleri küpte sayıyla tutuluyor.</summary>
    private sealed class Sozluk
    {
        private readonly List<string> _liste = new();
        private readonly Dictionary<string, short> _no = new();

        public short No(string s)
        {
            s ??= "";

            lock (_liste)
            {
                if (_no.TryGetValue(s, out var n)) return n;

                n = (short)_liste.Count;
                _liste.Add(s);
                _no[s] = n;

                return n;
            }
        }

        public string Ad(short n)
        {
            lock (_liste) return n >= 0 && n < _liste.Count ? _liste[n] : "";
        }

        public short? Bul(string s)
        {
            lock (_liste) return _no.TryGetValue(s ?? "", out var n) ? n : null;
        }
    }

    private readonly Sozluk _gruplar = new();
    private readonly Sozluk _tipler = new();

    private readonly ConcurrentDictionary<DateTime, Gun> _gunler = new();
    private readonly ConcurrentDictionary<DateTime, DateTime> _hatalar = new();
    private readonly SortedSet<DateTime> _kuyruk = new();
    private readonly object _kuyrukKilit = new();
    private Task _yukleyici;

    public string Yukleniyor { get; private set; }
    public string SonHata { get; private set; }
    public DateTime? SonYukleme { get; private set; }

    public sealed record Hazirlik(bool Hazir, int Eksik, int Toplam, string Durum, string Hata);

    /// <summary>
    /// Aralıktaki günler hazır mı. Eksik günler kuyruğa yazılıyor; son
    /// bir haftanın bayat günleri hazır sayılıp arkada tazeleniyor.
    /// </summary>
    public Hazirlik Hazirla(DateTime bas, DateTime bit)
    {
        var imza = Imza();
        var eksik = new List<DateTime>();
        var tazele = new List<DateTime>();
        string hata = null;

        for (var d = bas.Date; d <= bit.Date; d = d.AddDays(1))
        {
            if (d >= Bugun) continue;

            if (_gunler.TryGetValue(d, out var g) && g.Imza == imza)
            {
                var yas = DateTime.Now - g.Yuklendi;

                /* Dün ve önceki birkaç gün geç aktarımlarla değişebiliyor */
                if (d >= Bugun.AddDays(-KesinGun) && yas > TimeSpan.FromMinutes(d >= Bugun.AddDays(-1) ? 30 : 120))
                    tazele.Add(d);

                continue;
            }

            if (_hatalar.TryGetValue(d, out var hz) && DateTime.Now - hz < TimeSpan.FromMinutes(3))
            {
                hata = SonHata ?? "Mikro'dan veri okunamadı.";
                eksik.Add(d);
                continue;
            }

            eksik.Add(d);
        }

        var siraya = eksik.Where(d => !_hatalar.TryGetValue(d, out var z) || DateTime.Now - z >= TimeSpan.FromMinutes(3))
            .Concat(tazele)
            .ToList();

        if (siraya.Count > 0) Kuyruga(siraya);

        return new Hazirlik(eksik.Count == 0, eksik.Count, (int)(bit.Date - bas.Date).TotalDays + 1, Yukleniyor, hata);
    }

    public async Task<Hazirlik> HazirlaBekle(DateTime bas, DateTime bit, TimeSpan bekle)
    {
        var son = DateTime.UtcNow + bekle;
        var h = Hazirla(bas, bit);

        while (!h.Hazir && h.Hata is null && DateTime.UtcNow < son)
        {
            await Task.Delay(400);
            h = Hazirla(bas, bit);
        }

        return h;
    }

    private void Kuyruga(IEnumerable<DateTime> gunler)
    {
        lock (_kuyrukKilit)
        {
            foreach (var g in gunler) _kuyruk.Add(g.Date);

            if (_yukleyici is null || _yukleyici.IsCompleted)
                _yukleyici = Task.Run(Dongu);
        }
    }

    public int KuyrukUzunlugu
    {
        get { lock (_kuyrukKilit) return _kuyruk.Count; }
    }

    public int YukluGun => _gunler.Count;

    public DateTime? EnEskiGun => _gunler.IsEmpty ? null : _gunler.Keys.Min();

    /// <summary>Kuyruktaki günleri en yeniden başlayarak 14 günlük parçalarla yükler.</summary>
    private void Dongu()
    {
        SqlConnection db = null;

        try
        {
            while (true)
            {
                DateTime son, ilk;

                lock (_kuyrukKilit)
                {
                    if (_kuyruk.Count == 0)
                    {
                        Yukleniyor = null;
                        return;
                    }

                    son = _kuyruk.Max;
                    ilk = son;

                    while (_kuyruk.Contains(ilk.AddDays(-1)) && (son - ilk).TotalDays < 13)
                        ilk = ilk.AddDays(-1);

                    for (var d = ilk; d <= son; d = d.AddDays(1)) _kuyruk.Remove(d);

                    Yukleniyor = ilk == son
                        ? $"{ilk:dd.MM.yyyy} okunuyor"
                        : $"{ilk:dd.MM.yyyy} – {son:dd.MM.yyyy} okunuyor";
                }

                try
                {
                    if (db is null || db.State != ConnectionState.Open)
                    {
                        db?.Dispose();
                        db = (SqlConnection)_vt.MikroBaglantisi();
                        db.Open();
                        db.Execute(RaporMerkeziSorgulari.GeciciTablolar, commandTimeout: 900);
                    }

                    var sonuc = ParcaYukle(db, ilk, son.AddDays(1));

                    foreach (var g in sonuc)
                    {
                        _gunler[g.Tarih] = g;
                        _hatalar.TryRemove(g.Tarih, out _);
                    }

                    Kaydet(sonuc.Where(g => g.Tarih < Bugun.AddDays(-KesinGun)));

                    SonHata = null;
                    SonYukleme = DateTime.Now;
                }
                catch (Exception hata)
                {
                    _kayit.LogError(hata, "Rapor Merkezi: {Ilk:d} – {Son:d} okunamadı", ilk, son);

                    SonHata = "Mikro'dan satış verisi okunamadı: " + Kisalt(hata.Message);

                    for (var d = ilk; d <= son; d = d.AddDays(1)) _hatalar[d] = DateTime.Now;

                    db?.Dispose();
                    db = null;
                }
            }
        }
        finally
        {
            db?.Dispose();
        }
    }

    /// <summary>Satış küpü satırı (Mikro).</summary>
    private sealed class GrupSatir
    {
        public DateTime gun { get; set; }
        public int depo { get; set; }
        public string grup { get; set; }
        public double net { get; set; }
        public double vergi { get; set; }
        public double netM { get; set; }
        public double maliyet { get; set; }
        public double miktar { get; set; }
        public int fis { get; set; }
    }

    private sealed class FireSatir
    {
        public DateTime gun { get; set; }
        public int depo { get; set; }
        public string grup { get; set; }
        public double fire { get; set; }
    }

    private sealed class SaatSatir
    {
        public DateTime gun { get; set; }
        public int depo { get; set; }
        public int saat { get; set; }
        public double ciro { get; set; }
        public int fis { get; set; }
    }

    /// <summary>[bas, bit) aralığını okur; her gün için (boş da olsa) bir kayıt döner.</summary>
    private List<Gun> ParcaYukle(SqlConnection db, DateTime bas, DateTime bit)
    {
        var p = new { bas, bit };

        var grup = db.Query<GrupSatir>(RaporMerkeziSorgulari.GrupSatis, p, commandTimeout: 900).ToList();
        var fire = db.Query<FireSatir>(RaporMerkeziSorgulari.GrupFire, p, commandTimeout: 900).ToList();

        var pos = PosAyarOku();
        var imza = Imza();

        List<SaatSatir> saat;
        var posSaat = false;

        if (pos.FisSorgusu.Length > 0)
        {
            saat = PosCalistir(pos.FisSorgusu, bas, bit)
                .Select(x => new SaatSatir
                {
                    gun = Convert.ToDateTime(Al(x, "gun")).Date,
                    depo = Convert.ToInt32(Al(x, "depo") ?? 0),
                    saat = Convert.ToInt32(Al(x, "saat") ?? 0),
                    fis = Convert.ToInt32(Al(x, "fis") ?? 0),
                    ciro = Convert.ToDouble(Al(x, "ciro") ?? 0),
                })
                .ToList();
            posSaat = true;
        }
        else
        {
            saat = db.Query<SaatSatir>(RaporMerkeziSorgulari.SaatSatis, p, commandTimeout: 900).ToList();
        }

        var odeme = new List<(DateTime gun, int depo, string tip, double tutar)>();
        var posOdeme = false;

        if (pos.OdemeSorgusu.Length > 0)
        {
            odeme = PosCalistir(pos.OdemeSorgusu, bas, bit)
                .Select(x => (
                    Convert.ToDateTime(Al(x, "gun")).Date,
                    Convert.ToInt32(Al(x, "depo") ?? 0),
                    Convert.ToString(Al(x, "tip"))?.Trim() ?? "",
                    Convert.ToDouble(Al(x, "tutar") ?? 0)))
                .ToList();
            posOdeme = true;
        }

        var simdi = DateTime.Now;
        var sonuc = new List<Gun>();

        for (var d = bas.Date; d < bit.Date; d = d.AddDays(1))
        {
            var gun = d;

            /* Ciro ve fire aynı hücrede: depo + grup anahtarıyla birleşiyor */
            var hucre = new Dictionary<(int, short), GH>();

            foreach (var x in grup.Where(x => x.gun == gun))
            {
                var k = (x.depo, _gruplar.No((x.grup ?? "").Trim()));

                hucre.TryGetValue(k, out var h);

                h.Depo = x.depo;
                h.Grup = k.Item2;
                h.Ciro += (float)(x.net + x.vergi);
                h.Net += (float)x.net;
                h.NetM += (float)x.netM;
                h.Maliyet += (float)x.maliyet;
                h.Miktar += (float)x.miktar;
                h.Fis += x.fis;

                hucre[k] = h;
            }

            foreach (var x in fire.Where(x => x.gun == gun))
            {
                var k = (x.depo, _gruplar.No((x.grup ?? "").Trim()));

                hucre.TryGetValue(k, out var h);

                h.Depo = x.depo;
                h.Grup = k.Item2;
                h.Fire += (float)x.fire;

                hucre[k] = h;
            }

            sonuc.Add(new Gun
            {
                Tarih = gun,
                G = hucre.Values.ToArray(),
                S = saat.Where(x => x.gun == gun)
                    .GroupBy(x => (x.depo, Math.Clamp(x.saat, 0, 23)))
                    .Select(g => new SH
                    {
                        Depo = g.Key.depo,
                        Saat = (byte)g.Key.Item2,
                        Ciro = (float)g.Sum(x => x.ciro),
                        Fis = g.Sum(x => x.fis),
                    })
                    .ToArray(),
                O = odeme.Where(x => x.gun == gun)
                    .GroupBy(x => (x.depo, _tipler.No(x.tip)))
                    .Select(g => new OH { Depo = g.Key.depo, Tip = g.Key.Item2, Tutar = (float)g.Sum(x => x.tutar) })
                    .ToArray(),
                PosSaat = posSaat,
                PosOdeme = posOdeme,
                Imza = imza,
                Yuklendi = simdi,
            });
        }

        return sonuc;
    }

    private static object Al(Dictionary<string, object> s, string ad) =>
        s.TryGetValue(ad, out var v) ? v : null;

    /* ------------------------------------------------------------ disk */

    private sealed class GunDosya
    {
        public string Imza { get; set; }
        public string T { get; set; }
        public bool Ps { get; set; }
        public bool Po { get; set; }
        public List<string> Gr { get; set; }
        public List<string> Tp { get; set; }
        public double[][] G { get; set; }
        public double[][] S { get; set; }
        public double[][] O { get; set; }
    }

    private void Kaydet(IEnumerable<Gun> gunler)
    {
        try
        {
            Directory.CreateDirectory(_klasor);

            foreach (var g in gunler)
            {
                var grs = g.G.Select(x => x.Grup).Distinct().ToList();
                var tps = g.O.Select(x => x.Tip).Distinct().ToList();

                var d = new GunDosya
                {
                    Imza = g.Imza,
                    T = g.Tarih.ToString("yyyy-MM-dd"),
                    Ps = g.PosSaat,
                    Po = g.PosOdeme,
                    Gr = grs.Select(_gruplar.Ad).ToList(),
                    Tp = tps.Select(_tipler.Ad).ToList(),
                    G = g.G.Select(x => new double[]
                    {
                        x.Depo, grs.IndexOf(x.Grup), x.Ciro, x.Net, x.NetM, x.Maliyet, x.Miktar, x.Fire, x.Fis,
                    }).ToArray(),
                    S = g.S.Select(x => new double[] { x.Depo, x.Saat, x.Ciro, x.Fis }).ToArray(),
                    O = g.O.Select(x => new double[] { x.Depo, tps.IndexOf(x.Tip), x.Tutar }).ToArray(),
                };

                var yol = Path.Combine(_klasor, $"gun-{g.Tarih:yyyyMMdd}.json.gz");

                using var dosya = File.Create(yol);
                using var gz = new GZipStream(dosya, CompressionLevel.Fastest);

                JsonSerializer.Serialize(gz, d);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor Merkezi: önbellek diske yazılamadı ({Klasor})", _klasor);
        }
    }

    /// <summary>Diskteki kesin günleri belleğe alır. Açılışta bir kez.</summary>
    public int DiskOku()
    {
        var sayi = 0;

        try
        {
            if (!Directory.Exists(_klasor)) return 0;

            var imza = Imza();

            foreach (var yol in Directory.EnumerateFiles(_klasor, "gun-*.json.gz"))
            {
                try
                {
                    using var dosya = File.OpenRead(yol);
                    using var gz = new GZipStream(dosya, CompressionMode.Decompress);

                    var d = JsonSerializer.Deserialize<GunDosya>(gz);

                    if (d is null || d.Imza != imza) continue;

                    var tarih = DateTime.ParseExact(d.T, "yyyy-MM-dd", null);

                    if (_gunler.ContainsKey(tarih)) continue;

                    var gr = (d.Gr ?? new()).Select(_gruplar.No).ToList();
                    var tp = (d.Tp ?? new()).Select(_tipler.No).ToList();

                    _gunler[tarih] = new Gun
                    {
                        Tarih = tarih,
                        Imza = d.Imza,
                        PosSaat = d.Ps,
                        PosOdeme = d.Po,
                        Yuklendi = File.GetLastWriteTime(yol),
                        G = (d.G ?? Array.Empty<double[]>()).Select(x => new GH
                        {
                            Depo = (int)x[0],
                            Grup = gr[(int)x[1]],
                            Ciro = (float)x[2],
                            Net = (float)x[3],
                            NetM = (float)x[4],
                            Maliyet = (float)x[5],
                            Miktar = (float)x[6],
                            Fire = (float)x[7],
                            Fis = (int)x[8],
                        }).ToArray(),
                        S = (d.S ?? Array.Empty<double[]>()).Select(x => new SH
                        {
                            Depo = (int)x[0],
                            Saat = (byte)x[1],
                            Ciro = (float)x[2],
                            Fis = (int)x[3],
                        }).ToArray(),
                        O = (d.O ?? Array.Empty<double[]>()).Select(x => new OH
                        {
                            Depo = (int)x[0],
                            Tip = tp[(int)x[1]],
                            Tutar = (float)x[2],
                        }).ToArray(),
                    };

                    sayi++;
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Rapor Merkezi: önbellek dosyası okunamadı: {Yol}", yol);
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor Merkezi: önbellek klasörü okunamadı");
        }

        return sayi;
    }

    /// <summary>Bellekteki ve diskteki küpü ve hesaplanmış işleri siler.</summary>
    public void OnbellegiTemizle()
    {
        _gunler.Clear();
        _hatalar.Clear();
        _isler.Clear();

        try
        {
            if (Directory.Exists(_klasor))
                foreach (var f in Directory.EnumerateFiles(_klasor, "gun-*.json.gz"))
                    File.Delete(f);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rapor Merkezi: önbellek dosyaları silinemedi");
        }
    }

    /* ==================================================================== */
    /* Arka plan işleri (stok, ürün, transfer, SKT, bugün)                   */
    /* ==================================================================== */

    private sealed class Is
    {
        public Task Gorev;
        public object Veri;
        public DateTime Zaman;
        public string Hata;
        public DateTime HataZamani;
        public DateTime SonIstek;
    }

    private readonly ConcurrentDictionary<string, Is> _isler = new();
    private readonly SemaphoreSlim _mikroKapisi = new(3);

    public sealed record IsSonucu<T>(T Veri, bool Calisiyor, string Hata, DateTime? Zaman);

    /// <summary>
    /// Ağır bir hesabı arka planda çalıştırır. Taze sonuç varsa hemen,
    /// yoksa en çok <paramref name="bekle"/> kadar bekleyip döner; bitmemişse
    /// eski sonuç (varsa) ve "çalışıyor" işareti gelir.
    /// </summary>
    public async Task<IsSonucu<T>> IsCalistir<T>(string anahtar, TimeSpan omur, bool yenile, TimeSpan bekle,
        Func<T> uret) where T : class
    {
        Temizlik();

        var i = _isler.GetOrAdd(anahtar, _ => new Is());
        Task gorev;

        lock (i)
        {
            i.SonIstek = DateTime.Now;

            var taze = i.Veri is not null && DateTime.Now - i.Zaman < omur && !yenile;
            var calisiyor = i.Gorev is not null && !i.Gorev.IsCompleted;
            var yeniHata = i.Hata is not null && DateTime.Now - i.HataZamani < TimeSpan.FromMinutes(2) && !yenile;

            if (!taze && !calisiyor && !yeniHata)
            {
                i.Gorev = Task.Run(async () =>
                {
                    await _mikroKapisi.WaitAsync();

                    try
                    {
                        var v = uret();

                        lock (i)
                        {
                            i.Veri = v;
                            i.Zaman = DateTime.Now;
                            i.Hata = null;
                        }
                    }
                    catch (Exception hata)
                    {
                        _kayit.LogError(hata, "Rapor Merkezi işi başarısız: {Anahtar}", anahtar);

                        lock (i)
                        {
                            i.Hata = Kisalt(hata.Message);
                            i.HataZamani = DateTime.Now;
                        }
                    }
                    finally
                    {
                        _mikroKapisi.Release();
                    }
                });
            }

            gorev = i.Gorev;
        }

        if (gorev is not null && !gorev.IsCompleted && bekle > TimeSpan.Zero)
            await Task.WhenAny(gorev, Task.Delay(bekle));

        lock (i)
        {
            var calisiyor = i.Gorev is not null && !i.Gorev.IsCompleted;

            return new IsSonucu<T>((T)i.Veri, calisiyor, i.Veri is null ? i.Hata : null,
                i.Veri is null ? null : i.Zaman);
        }
    }

    private DateTime _sonTemizlik = DateTime.Now;

    /// <summary>Bir saattir istenmeyen ürün sorgusu sonuçlarını bırakır.</summary>
    private void Temizlik()
    {
        if (DateTime.Now - _sonTemizlik < TimeSpan.FromMinutes(10)) return;

        _sonTemizlik = DateTime.Now;

        foreach (var (k, v) in _isler)
            if (k.StartsWith("urun:") && DateTime.Now - v.SonIstek > TimeSpan.FromHours(1) &&
                (v.Gorev is null || v.Gorev.IsCompleted))
                _isler.TryRemove(k, out _);
    }

    /* ------------------------------------------------------------ bugün */

    /// <summary>Bugünün saatlik ciro ve fişi (5 dakikada bir).</summary>
    public Task<IsSonucu<SH[]>> BugunSaatleri(bool yenile) =>
        IsCalistir("bugun", TimeSpan.FromMinutes(5), yenile, TimeSpan.FromSeconds(20), () =>
        {
            var bas = Bugun;
            var bit = Bugun.AddDays(1);
            var pos = PosAyarOku();

            IEnumerable<SaatSatir> satirlar;

            if (pos.FisSorgusu.Length > 0)
            {
                satirlar = PosCalistir(pos.FisSorgusu, bas, bit).Select(x => new SaatSatir
                {
                    depo = Convert.ToInt32(Al(x, "depo") ?? 0),
                    saat = Convert.ToInt32(Al(x, "saat") ?? 0),
                    fis = Convert.ToInt32(Al(x, "fis") ?? 0),
                    ciro = Convert.ToDouble(Al(x, "ciro") ?? 0),
                }).ToList();
            }
            else
            {
                using var db = _vt.MikroBaglantisi();

                satirlar = db.Query<SaatSatir>(RaporMerkeziSorgulari.SaatSatis, new { bas, bit },
                    commandTimeout: 180).ToList();
            }

            return satirlar
                .GroupBy(x => (x.depo, Math.Clamp(x.saat, 0, 23)))
                .Select(g => new SH
                {
                    Depo = g.Key.depo,
                    Saat = (byte)g.Key.Item2,
                    Ciro = (float)g.Sum(x => x.ciro),
                    Fis = g.Sum(x => x.fis),
                })
                .ToArray();
        });

    /* ----------------------------------------------------------- kartlar */

    public sealed record Kart(string Kod, string Ad, string Grup, string Birim, string Barkod,
        double Fiyat, double Maliyet, bool MaliyetTahmini);

    public sealed class KartVeri
    {
        public Dictionary<string, Kart> Kartlar = new(StringComparer.OrdinalIgnoreCase);
        public DateTime Zaman;
    }

    private volatile KartVeri _kartlar;
    private readonly object _kartKilit = new();

    /// <summary>
    /// Stok kartları, fiyat ve maliyet. Alış maliyeti bulunamayan ürünün
    /// maliyeti, aynı ana gruptaki ürünlerin maliyet/fiyat oranıyla
    /// tahmin ediliyor (stok değeri ve kâr hesabında).
    /// </summary>
    public KartVeri Kartlar()
    {
        lock (_kartKilit)
        {
            if (_kartlar is not null && DateTime.Now - _kartlar.Zaman < TimeSpan.FromHours(6))
                return _kartlar;

            using var db = (SqlConnection)_vt.MikroBaglantisi();
            db.Open();
            db.Execute(RaporMerkeziSorgulari.GeciciTablolar, commandTimeout: 900);

            var ham = db.Query(RaporMerkeziSorgulari.Kartlar, commandTimeout: 600)
                .Select(x => new
                {
                    kod = ((string)x.kod ?? "").Trim(),
                    ad = ((string)x.ad ?? "").Trim(),
                    grup = ((string)x.grup ?? "").Trim(),
                    birim = ((string)x.birim ?? "").Trim(),
                    barkod = ((string)x.barkod ?? "").Trim(),
                    fiyat = x.fiyat is null ? 0d : Convert.ToDouble(x.fiyat),
                    maliyet = x.maliyet is null ? 0d : Convert.ToDouble(x.maliyet),
                })
                .Where(x => x.kod.Length > 0)
                .ToList();

            var oranlar = ham
                .Where(x => x.fiyat > 0 && x.maliyet > 0)
                .GroupBy(x => x.grup)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.maliyet) / g.Sum(x => x.fiyat));

            var genel = ham.Where(x => x.fiyat > 0 && x.maliyet > 0).ToList() is { Count: > 0 } l
                ? l.Sum(x => x.maliyet) / l.Sum(x => x.fiyat)
                : 0.7;

            var v = new KartVeri { Zaman = DateTime.Now };

            foreach (var x in ham)
            {
                var tahmini = x.maliyet <= 0;
                var maliyet = !tahmini
                    ? x.maliyet
                    : x.fiyat * (oranlar.TryGetValue(x.grup, out var o) ? o : genel);

                v.Kartlar[x.kod] = new Kart(x.kod, x.ad, x.grup, x.birim, x.barkod, x.fiyat, maliyet, tahmini);
            }

            _kartlar = v;

            return v;
        }
    }

    /// <summary>Yüklüyse kartlar; yükleme beklenmez.</summary>
    public KartVeri KartlarHazirsa() => _kartlar;

    /* ------------------------------------------------------------- stok */

    public sealed record StokPaket(KartVeri Kartlar, StokVeri Stok);

    public StokPaket StokPaketOku() => new(Kartlar(), StokOku());

    public struct StokSatir
    {
        public string Kod;
        public int Depo;
        public float Miktar;
        public float Gunluk;
        public float Gun;
        public bool YokSatiyor;
    }

    public sealed class StokVeri
    {
        public List<StokSatir> Satirlar = new();
        public bool MerkezVar;
        public DateTime Zaman;
    }

    /// <summary>
    /// Bütün depoların stoğu: şubeler PUSULA'dan (stok ve stok günü),
    /// merkez depo hareketlerden.
    /// </summary>
    public StokVeri StokOku()
    {
        var y = _stok.Pusula(true);

        if (y.Depolar.Count == 0)
            throw new InvalidOperationException("PUSULA görünümünde şube sütunu bulunamadı.");

        var depolar = y.Depolar.ToList();

        var sec = new StringBuilder("SELECT p.sto_kod");

        foreach (var d in depolar)
        {
            sec.Append($", p.[S_{d}]");
            sec.Append(y.Sutunlar.Contains($"SDG_{d}") ? $", p.[SDG_{d}]" : ", NULL");
            sec.Append(y.Sutunlar.Contains($"MSG_{d}") ? $", p.[MSG_{d}]" : ", NULL");
        }

        sec.Append(" FROM MikroDB_V15_BICEN.dbo.PUSULA p WITH (NOLOCK)");

        var v = new StokVeri { Zaman = DateTime.Now };

        static double Sayi(object o) =>
            o is null or DBNull ? 0 : o switch
            {
                double d => d,
                float f => f,
                decimal m => (double)m,
                int i => i,
                long l => l,
                short s => s,
                _ => double.TryParse(Convert.ToString(o), System.Globalization.NumberStyles.Any,
                    System.Globalization.CultureInfo.InvariantCulture, out var x) ? x : 0,
            };

        using (var db = (SqlConnection)_vt.MikroBaglantisi())
        {
            db.Open();

            using var komut = db.CreateCommand();
            komut.CommandText = sec.ToString();
            komut.CommandTimeout = 600;

            using var r = komut.ExecuteReader();

            while (r.Read())
            {
                var kod = (r.IsDBNull(0) ? "" : Convert.ToString(r.GetValue(0)) ?? "").Trim();

                if (kod.Length == 0) continue;

                for (var i = 0; i < depolar.Count; i++)
                {
                    var o = 1 + i * 3;

                    var s = Sayi(r.GetValue(o));
                    var sdg = Sayi(r.GetValue(o + 1));
                    var msg = r.IsDBNull(o + 2) ? "" : (Convert.ToString(r.GetValue(o + 2)) ?? "").Trim();

                    var ys = msg.Equals("YS", StringComparison.OrdinalIgnoreCase);

                    if (s <= 0.0001 && !ys) continue;

                    var gunluk = s > 0 && sdg > 0 && sdg < 999 ? s / sdg : 0;

                    v.Satirlar.Add(new StokSatir
                    {
                        Kod = kod,
                        Depo = depolar[i],
                        Miktar = (float)Math.Max(0, s),
                        Gunluk = (float)gunluk,
                        Gun = s <= 0 ? 0 : gunluk > 0 ? (float)(s / gunluk) : 999,
                        YokSatiyor = ys,
                    });
                }
            }
        }

        v.MerkezVar = depolar.Any(MerkezDepolar.Contains);

        return v;
    }

    /// <summary>
    /// Merkez depo stoğu (100 + 103) hareketlerden. Ağır bir tarama
    /// olduğu için şube stoğundan ayrı iş: şubeler beklemeden görünsün.
    /// PUSULA'da merkez sütunu varsa boş döner.
    /// </summary>
    public List<StokSatir> MerkezOku()
    {
        var y = _stok.Pusula();

        if (y.Depolar.Any(MerkezDepolar.Contains)) return new List<StokSatir>();

        using var db = _vt.MikroBaglantisi();

        var l = new List<StokSatir>();

        foreach (var x in db.Query(RaporMerkeziSorgulari.MerkezStok, commandTimeout: 900))
        {
            var miktar = x.miktar is null ? 0d : Convert.ToDouble(x.miktar);

            if (miktar <= 0.0001) continue;

            var gunluk = (x.cikis21 is null ? 0d : Convert.ToDouble(x.cikis21)) / 21d;

            l.Add(new StokSatir
            {
                Kod = ((string)x.kod ?? "").Trim(),
                Depo = 100,
                Miktar = (float)miktar,
                Gunluk = (float)gunluk,
                Gun = gunluk > 0 ? (float)(miktar / gunluk) : 999,
            });
        }

        return l;
    }

    /* -------------------------------------------------------- transfer */

    public sealed record Transfer(string Belge, int Depo, DateTime Tarih, int Kalem, double Tutar, int Durum);

    public List<Transfer> TransferOku()
    {
        using var db = (SqlConnection)_vt.MikroBaglantisi();
        db.Open();
        db.Execute(RaporMerkeziSorgulari.GeciciFiyat, commandTimeout: 600);

        var sql = RaporMerkeziSorgulari.Transferler.Replace("{SIPARIS_BAG}", _stok.SiparisBagi());

        return db.Query(sql, commandTimeout: 300)
            .Select(x =>
            {
                var kalem = Convert.ToInt32(x.kalem);
                var sevk = Convert.ToInt32(x.sevk);
                var yolda = Convert.ToInt32(x.yolda);

                return new Transfer(
                    $"{((string)x.seri ?? "").Trim()}-{x.sira}".TrimStart('-'),
                    Convert.ToInt32(x.depo),
                    Convert.ToDateTime(x.tarih),
                    kalem,
                    x.tutar is null ? 0 : Convert.ToDouble(x.tutar),
                    sevk == 0 ? 0 : yolda > 0 ? 1 : 2);
            })
            .ToList();
    }

    /* ------------------------------------------------------------- SKT */

    public sealed record SktSatir(string Kod, int Depo, DateTime Skt, double Miktar, string Parti);

    public sealed class SktVeri
    {
        public bool Kaynak;
        public string Mesaj;
        public List<SktSatir> Satirlar = new();
    }

    public SktVeri SktOku()
    {
        using var db = _vt.MikroBaglantisi();

        var var_ = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
WHERE (TABLE_NAME = 'PARTILOT' AND COLUMN_NAME IN ('pl_son_kullanim_tar','pl_stokkodu','pl_partikodu','pl_lotno'))
   OR (TABLE_NAME = 'STOK_HAREKETLERI' AND COLUMN_NAME IN ('sth_parti_kodu','sth_lot_no'))", commandTimeout: 60);

        if (var_ < 6)
            return new SktVeri
            {
                Kaynak = false,
                Mesaj = "Mikro'da parti/lot (son kullanma tarihi) takibi bulunamadı.",
            };

        var satirlar = db.Query(RaporMerkeziSorgulari.Skt, commandTimeout: 300)
            .Select(x => new SktSatir(
                ((string)x.kod ?? "").Trim(),
                Convert.ToInt32(x.depo),
                Convert.ToDateTime(x.skt).Date,
                Convert.ToDouble(x.miktar),
                $"{((string)x.parti ?? "").Trim()}/{x.lot}"))
            .ToList();

        return new SktVeri
        {
            Kaynak = true,
            Mesaj = satirlar.Count == 0 ? "Önümüzdeki 7 günde son kullanma tarihi dolan parti yok." : null,
            Satirlar = satirlar,
        };
    }

    /* ----------------------------------------------------------- ürün */

    public sealed record UrunSatir(string Kod, double Miktar, double Net, double Ciro);

    public List<UrunSatir> UrunOku(DateTime bas, DateTime bit, IReadOnlyCollection<int> depolar, string grup)
    {
        if (depolar.Count == 0) return new List<UrunSatir>();

        var liste = string.Join(",", depolar.Select(d => StokServisi.Sayi(d, "Depo")));

        using var db = _vt.MikroBaglantisi();

        return db.Query(RaporMerkeziSorgulari.UrunSatis.Replace("{DEPOLAR}", liste),
                new { bas, bit = bit.AddDays(1), grup = string.IsNullOrEmpty(grup) ? null : grup },
                commandTimeout: 900)
            .Select(x => new UrunSatir(
                ((string)x.kod ?? "").Trim(),
                x.miktar is null ? 0 : Convert.ToDouble(x.miktar),
                x.net is null ? 0 : Convert.ToDouble(x.net),
                x.ciro is null ? 0 : Convert.ToDouble(x.ciro)))
            .ToList();
    }

    /* ==================================================================== */
    /* Toplama                                                              */
    /* ==================================================================== */

    public sealed class Suzgec
    {
        /// <summary>Kişinin görebileceği şube depoları.</summary>
        public HashSet<int> Izinli = new();

        /// <summary>Bölge süzgecinden geçen depolar (Izinli'nin alt kümesi).</summary>
        public HashSet<int> Bolgede = new();

        /// <summary>Seçili tek şube; yoksa null.</summary>
        public int? Depo;

        /// <summary>Ana grup kodu; yoksa null.</summary>
        public string Grup;

        public bool Secili(int d) => Bolgede.Contains(d) && (Depo is null || Depo == d);
    }

    public sealed class Kume
    {
        public double Ciro, Net, Kar, Fire, Fis;
    }

    public sealed class Toplam
    {
        public double Ciro, Net, Kar, Fire, Fis, Miktar;
        public int GunSayisi;
        public List<double> Gunler = new();
        public Dictionary<string, Kume> Kat = new();
        public Dictionary<int, Kume> Sube = new();
        public Dictionary<string, double> Bolge = new();
        public double[] Hafta = new double[7];
        public int[] HaftaN = new int[7];
        public double[][] Isi = Enumerable.Range(0, 7).Select(_ => new double[24]).ToArray();
        public double[] Saat = new double[24];
        public Dictionary<string, double> Odeme = new();
        public bool PosSaat, PosOdeme;
    }

    /// <summary>Ana grup başına (net − maliyet) / net: maliyeti bilinmeyen satış için.</summary>
    public Dictionary<short, double> KarOranlari(IEnumerable<Gun> gunler)
    {
        var a = new Dictionary<short, (double k, double n)>();
        double tk = 0, tn = 0;

        foreach (var g in gunler)
        foreach (var h in g.G)
        {
            a.TryGetValue(h.Grup, out var x);
            a[h.Grup] = (x.k + h.NetM - h.Maliyet, x.n + h.NetM);
            tk += h.NetM - h.Maliyet;
            tn += h.NetM;
        }

        var genel = tn > 0 ? tk / tn : 0.2;

        return a.ToDictionary(x => x.Key, x => x.Value.n > 0 ? x.Value.k / x.Value.n : genel);
    }

    public List<Gun> Gunler(DateTime bas, DateTime bit)
    {
        var l = new List<Gun>();

        for (var d = bas.Date; d <= bit.Date; d = d.AddDays(1))
            if (_gunler.TryGetValue(d, out var g)) l.Add(g);

        return l;
    }

    public string GrupKodu(short n) => _gruplar.Ad(n);

    public Toplam Topla(DateTime bas, DateTime bit, Suzgec s, Dictionary<short, double> oran,
        IReadOnlyDictionary<int, string> bolgeler)
    {
        var t = new Toplam { GunSayisi = (int)(bit.Date - bas.Date).TotalDays + 1 };
        short? grup = s.Grup is null ? null : _gruplar.Bul(s.Grup) ?? -2;

        double Kar(GH h) =>
            h.NetM - h.Maliyet + (h.Net - h.NetM) * (oran.TryGetValue(h.Grup, out var o) ? o : 0.2);

        Kume K<TK>(Dictionary<TK, Kume> d, TK k) where TK : notnull
        {
            if (!d.TryGetValue(k, out var x)) d[k] = x = new Kume();
            return x;
        }

        var tumPos = true;
        var tumOdeme = true;

        for (var d = bas.Date; d <= bit.Date; d = d.AddDays(1))
        {
            var hg = (int)d.DayOfWeek;
            t.HaftaN[hg]++;

            if (!_gunler.TryGetValue(d, out var g))
            {
                t.Gunler.Add(0);
                tumPos = false;
                tumOdeme = false;
                continue;
            }

            tumPos &= g.PosSaat;
            tumOdeme &= g.PosOdeme;

            double gunCiro = 0;

            /* Depo başına seçili grubun cirosu ve toplam ciro: saatlik
               dağılımı gruba oranlamak için */
            Dictionary<int, (double grup, double tum)> depoPay = grup is null ? null : new();

            foreach (var h in g.G)
            {
                if (!s.Izinli.Contains(h.Depo)) continue;

                var grupta = grup is null || h.Grup == grup;
                var kar = Kar(h);

                if (depoPay is not null && s.Secili(h.Depo))
                {
                    depoPay.TryGetValue(h.Depo, out var p);
                    depoPay[h.Depo] = (p.grup + (grupta ? h.Ciro : 0), p.tum + h.Ciro);
                }

                /* Kategori kırılımı: seçili şubeler, bütün gruplar */
                if (s.Secili(h.Depo))
                {
                    var k = K(t.Kat, _gruplar.Ad(h.Grup));
                    k.Ciro += h.Ciro;
                    k.Net += h.Net;
                    k.Kar += kar;
                    k.Fire += h.Fire;
                    k.Fis += h.Fis;
                }

                if (!grupta) continue;

                /* Bölge kırılımı: bölge ve şube süzgecinden bağımsız */
                if (bolgeler.TryGetValue(h.Depo, out var b) && b.Length > 0)
                {
                    t.Bolge.TryGetValue(b, out var bc);
                    t.Bolge[b] = bc + h.Ciro;
                }

                /* Şube kırılımı: bölgedeki bütün şubeler */
                if (s.Bolgede.Contains(h.Depo))
                {
                    var k = K(t.Sube, h.Depo);
                    k.Ciro += h.Ciro;
                    k.Net += h.Net;
                    k.Kar += kar;
                    k.Fire += h.Fire;

                    if (grup is not null) k.Fis += h.Fis;
                }

                if (!s.Secili(h.Depo)) continue;

                t.Ciro += h.Ciro;
                t.Net += h.Net;
                t.Kar += kar;
                t.Fire += h.Fire;
                t.Miktar += h.Miktar;
                gunCiro += h.Ciro;

                if (grup is not null) t.Fis += h.Fis;
            }

            foreach (var h in g.S)
            {
                if (!s.Izinli.Contains(h.Depo)) continue;

                if (grup is null && s.Bolgede.Contains(h.Depo))
                    K(t.Sube, h.Depo).Fis += h.Fis;

                if (!s.Secili(h.Depo)) continue;

                double pay = 1;

                if (depoPay is not null)
                    pay = depoPay.TryGetValue(h.Depo, out var p) && p.tum > 0 ? p.grup / p.tum : 0;

                if (grup is null) t.Fis += h.Fis;

                t.Isi[hg][h.Saat] += h.Ciro * pay;
                t.Saat[h.Saat] += h.Ciro * pay;
            }

            foreach (var h in g.O)
            {
                if (!s.Secili(h.Depo)) continue;

                var ad = _tipler.Ad(h.Tip);
                t.Odeme.TryGetValue(ad, out var o);
                t.Odeme[ad] = o + h.Tutar;
            }

            t.Gunler.Add(gunCiro);
            t.Hafta[hg] += gunCiro;
        }

        t.PosSaat = tumPos;
        t.PosOdeme = tumOdeme;

        return t;
    }
}

using System.Data;
using System.Globalization;
using System.Text.RegularExpressions;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Raf etiketi kaydı (26.10.2026).
/// <para>
/// BiŞube her basılan etiket için OZ Merkez'de ETIKET_KAYIT'a bir satır
/// yazar ve kimliği karekoda "ID: …" olarak koyar. Mobil Fiyat Kontrol
/// karekodu okuyunca kayıttaki (etiketin basıldığı andaki) ad, fiyat,
/// indirimli fiyat ve menşei güncel bilgiyle karşılaştırılır; değişen
/// alan söylenir ve aynı ürünün yeni etiketi basılmış mı bakılır.
/// SKT: etikette basılı SKT ve SKT kontrol modülündeki partiler.
/// </para>
/// Ayrıntı: ETIKET-KAREKOD.md, tablo: etiket-kayit.sql
/// </summary>
public class EtiketKayitServisi
{
    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    private readonly VeritabaniServisi _vt;
    private readonly IConfiguration _yap;
    private readonly ILogger<EtiketKayitServisi> _kayit;
    private bool _kuruldu;
    private readonly object _kilit = new();

    /* Mikro'da menşei sütunu (STOKLAR): ayardan ya da adında "mensei"
       geçen sütundan; bir kez bulunur */
    private string _menseiSutunu;
    private bool _menseiBakildi;

    public EtiketKayitServisi(VeritabaniServisi vt, IConfiguration yap, ILogger<EtiketKayitServisi> kayit)
    {
        _vt = vt;
        _yap = yap;
        _kayit = kayit;
    }

    /// <summary>SKT kaç gün kala "yaklaştı" sayılır (Etiket:SktUyariGun, varsayılan 7)</summary>
    public int SktUyariGun => int.TryParse(_yap["Etiket:SktUyariGun"], out var g) && g is > 0 and < 366 ? g : 7;

    public sealed class Kayit
    {
        public long EtiketId { get; set; }
        public int DepoNo { get; set; }
        public string SubeAdi { get; set; }
        public string StokKodu { get; set; }
        public string Barkod { get; set; }
        public string UrunAdi { get; set; }
        public string Birim { get; set; }
        public decimal? Fiyat { get; set; }
        public decimal? IndirimliFiyat { get; set; }
        public string IndirimTuru { get; set; }
        public string BirimFiyat { get; set; }
        public string Mensei { get; set; }
        public string Reyon { get; set; }
        public DateTime? Skt { get; set; }
        public DateTime? FiyatDegisimTarihi { get; set; }
        public DateTime? KampanyaBitis { get; set; }
        public string Sablon { get; set; }
        public int Adet { get; set; }
        public string BasanKullanici { get; set; }
        public DateTime Basim { get; set; }
        public bool Iptal { get; set; }
    }

    /* ------------------------------------------------------------ kurulum */

    private void Kur(IDbConnection oz)
    {
        if (_kuruldu) return;
        lock (_kilit)
        {
            if (_kuruldu) return;
            try
            {
                oz.Execute(@"
IF OBJECT_ID('ETIKET_KAYIT') IS NULL
CREATE TABLE ETIKET_KAYIT (
    etiket_id BIGINT IDENTITY(100001,1) PRIMARY KEY, depo_no INT NOT NULL, sube_adi NVARCHAR(120) NULL,
    stok_kodu NVARCHAR(30) NOT NULL, barkod NVARCHAR(50) NULL, urun_adi NVARCHAR(200) NULL, birim NVARCHAR(20) NULL,
    fiyat DECIMAL(18,2) NULL, indirimli_fiyat DECIMAL(18,2) NULL, indirim_turu NVARCHAR(20) NULL, birim_fiyat NVARCHAR(40) NULL,
    mensei NVARCHAR(60) NULL, reyon NVARCHAR(100) NULL, yer_kodu NVARCHAR(30) NULL, skt DATE NULL,
    fiyat_degisim_tarihi DATE NULL, kampanya_bitis DATE NULL, sablon NVARCHAR(80) NULL, adet INT NOT NULL DEFAULT(1),
    basan_kullanici NVARCHAR(100) NULL, bilgisayar NVARCHAR(60) NULL, kaynak NVARCHAR(30) NULL, rf_kodu NVARCHAR(24) NULL,
    basim DATETIME2 NOT NULL DEFAULT SYSDATETIME(), iptal BIT NOT NULL DEFAULT(0), ek_json NVARCHAR(MAX) NULL);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ETIKET_KAYIT_URUN' AND object_id = OBJECT_ID('ETIKET_KAYIT'))
    CREATE INDEX IX_ETIKET_KAYIT_URUN ON ETIKET_KAYIT(depo_no, stok_kodu, etiket_id DESC);
IF OBJECT_ID('ETIKET_OKUTMA') IS NULL
CREATE TABLE ETIKET_OKUTMA (
    id BIGINT IDENTITY(1,1) PRIMARY KEY, etiket_id BIGINT NOT NULL, depo_no INT NULL, personel_kodu NVARCHAR(30) NULL,
    durum NVARCHAR(20) NOT NULL, degisenler NVARCHAR(400) NULL, okutma DATETIME2 NOT NULL DEFAULT SYSDATETIME());
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ETIKET_OKUTMA' AND object_id = OBJECT_ID('ETIKET_OKUTMA'))
    CREATE INDEX IX_ETIKET_OKUTMA ON ETIKET_OKUTMA(depo_no, okutma DESC);", commandTimeout: 30);
            }
            catch (Exception h)
            {
                /* Yetki yoksa etiket-kayit.sql elle çalıştırılır */
                _kayit.LogWarning(h, "ETIKET_KAYIT tablosu kurulamadı");
            }
            _kuruldu = true;
        }
    }

    private const string Sutunlar = @"
etiket_id AS EtiketId, depo_no AS DepoNo, sube_adi AS SubeAdi, stok_kodu AS StokKodu, barkod AS Barkod,
urun_adi AS UrunAdi, birim AS Birim, fiyat AS Fiyat, indirimli_fiyat AS IndirimliFiyat, indirim_turu AS IndirimTuru,
birim_fiyat AS BirimFiyat, mensei AS Mensei, reyon AS Reyon, skt AS Skt, fiyat_degisim_tarihi AS FiyatDegisimTarihi,
kampanya_bitis AS KampanyaBitis, sablon AS Sablon, adet AS Adet, basan_kullanici AS BasanKullanici, basim AS Basim, iptal AS Iptal";

    /// <summary>Etiket kaydı; yoksa ya da okunamazsa null.</summary>
    public Kayit Oku(long id)
    {
        try
        {
            using var oz = _vt.OzMerkezBaglantisi();
            Kur(oz);
            return oz.QueryFirstOrDefault<Kayit>($"SELECT {Sutunlar} FROM ETIKET_KAYIT WHERE etiket_id = @id", new { id }, commandTimeout: 15);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Etiket kaydı okunamadı: {Id}", id);
            return null;
        }
    }

    /// <summary>Aynı şubede aynı ürün için bu etiketten sonra basılmış en son etiket.</summary>
    public Kayit YeniEtiket(Kayit k)
    {
        try
        {
            using var oz = _vt.OzMerkezBaglantisi();
            return oz.QueryFirstOrDefault<Kayit>($@"
SELECT TOP 1 {Sutunlar} FROM ETIKET_KAYIT
WHERE depo_no = @DepoNo AND stok_kodu = @StokKodu AND etiket_id > @EtiketId AND iptal = 0
ORDER BY etiket_id DESC", k, commandTimeout: 15);
        }
        catch (Exception h)
        {
            _kayit.LogWarning(h, "Yeni etiket aranamadı");
            return null;
        }
    }

    /// <summary>Okutmayı yazar (rapor için); hata işi durdurmaz.</summary>
    public void OkutmaYaz(long etiketId, int? depoNo, string personel, string durum, IEnumerable<string> degisenler)
    {
        try
        {
            using var oz = _vt.OzMerkezBaglantisi();
            var d = string.Join(",", degisenler ?? Array.Empty<string>());
            oz.Execute(@"INSERT INTO ETIKET_OKUTMA (etiket_id, depo_no, personel_kodu, durum, degisenler)
VALUES (@etiketId, @depoNo, @personel, @durum, @d)",
                new { etiketId, depoNo, personel = Kirp(personel, 30), durum, d = Kirp(d, 400) }, commandTimeout: 10);
        }
        catch (Exception h)
        {
            _kayit.LogDebug(h, "Etiket okutması yazılamadı");
        }
    }

    /* ------------------------------------------------------------ menşei */

    /// <summary>Ürünün Mikro'daki güncel menşei; sütun bulunamazsa null.</summary>
    public string Mensei(IDbConnection mikro, string stokKodu)
    {
        try
        {
            if (!_menseiBakildi)
            {
                var ayar = (_yap["Etiket:MenseiSutunu"] ?? "").Trim();
                if (ayar.Length > 0 && Regex.IsMatch(ayar, "^[A-Za-z0-9_]{1,64}$"))
                    _menseiSutunu = mikro.ExecuteScalar<string>(
                        "SELECT TOP 1 name FROM sys.columns WHERE object_id = OBJECT_ID('STOKLAR') AND name = @ayar", new { ayar });
                _menseiSutunu ??= mikro.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM sys.columns
WHERE object_id = OBJECT_ID('STOKLAR') AND (name LIKE '%mensei%' OR name LIKE '%mense%')
ORDER BY CASE WHEN name = 'sto_mensei' THEN 0 ELSE 1 END, name");
                _menseiBakildi = true;
            }
            if (_menseiSutunu is null) return null;

            /* Sütun adı sys.columns'tan geldiği için sorguya yazılabiliyor */
            var v = mikro.ExecuteScalar<object>($"SELECT TOP 1 [{_menseiSutunu}] FROM STOKLAR WITH (NOLOCK) WHERE sto_kod = @stokKodu", new { stokKodu });
            var m = v is null or DBNull ? null : Convert.ToString(v, Tr)?.Trim();
            return string.IsNullOrEmpty(m) ? null : m;
        }
        catch (Exception h)
        {
            _kayit.LogDebug(h, "Menşei okunamadı");
            _menseiBakildi = true;
            return null;
        }
    }

    /* ------------------------------------------------------------ karşılaştırma */

    public static string Para(decimal? d) => d is null ? "—" : d.Value.ToString("N2", Tr) + " TL";

    private static string Duz(string s) =>
        Regex.Replace((s ?? "").Trim().ToUpper(Tr), @"\s+", " ");

    private static bool Esit(decimal? a, decimal? b) =>
        (a is null && b is null) || (a is not null && b is not null && Math.Round(a.Value, 2) == Math.Round(b.Value, 2));

    public sealed record Degisim(string alan, string ad, string eski, string yeni);

    /// <summary>
    /// Etiketin basıldığı andaki bilgi ile güncel bilgi. Değişen alanlar,
    /// yeni etiket basılmış mı ve personele söylenecek uyarı.
    /// </summary>
    public object Karsilastir(Kayit k, string guncelAd, decimal? raf, decimal? bicard, string guncelMensei,
        DateTime? sonFiyatTarihi, string personel)
    {
        var degisenler = new List<Degisim>();

        if (!string.IsNullOrWhiteSpace(k.UrunAdi) && !string.IsNullOrWhiteSpace(guncelAd) && Duz(k.UrunAdi) != Duz(guncelAd))
            degisenler.Add(new("urun_adi", "Ürün adı", k.UrunAdi.Trim(), guncelAd.Trim()));

        if (k.Fiyat is not null && !Esit(k.Fiyat, raf))
            degisenler.Add(new("fiyat", "Fiyat", Para(k.Fiyat), Para(raf)));

        /* İndirimli fiyat: BiCard indirimi güncel BiCard fiyatıyla; kampanya
           indirimi bitiş tarihiyle karşılaştırılır */
        var gBicard = bicard is > 0 ? bicard : null;
        if (string.Equals(k.IndirimTuru, "kampanya", StringComparison.OrdinalIgnoreCase))
        {
            if (k.KampanyaBitis is { } kb && kb.Date < DateTime.Today)
                degisenler.Add(new("kampanya", "Kampanya", $"{Para(k.IndirimliFiyat)} · {kb:dd.MM.yyyy}'e kadar", "Kampanya bitti"));
        }
        else if (k.IndirimliFiyat is not null || gBicard is not null)
        {
            if (!Esit(k.IndirimliFiyat, gBicard))
                degisenler.Add(new("indirimli_fiyat", "İndirimli fiyat",
                    k.IndirimliFiyat is null ? "Yok" : Para(k.IndirimliFiyat),
                    gBicard is null ? "İndirim yok" : Para(gBicard)));
        }

        if (!string.IsNullOrWhiteSpace(k.Mensei) && !string.IsNullOrWhiteSpace(guncelMensei) && Duz(k.Mensei) != Duz(guncelMensei))
            degisenler.Add(new("mensei", "Menşei", k.Mensei.Trim(), guncelMensei.Trim()));

        /* Fiyat aynı ama etiketten sonra fiyat değişikliği girilmiş: bilgi */
        var fdt = k.FiyatDegisimTarihi ?? k.Basim.Date;
        var sonradanDegisiklik = sonFiyatTarihi is { } sft && sft.Date > fdt.Date;

        var yeni = degisenler.Count > 0 || k.Iptal ? YeniEtiket(k) : null;

        string durum, uyari;
        if (k.Iptal)
        {
            durum = "iptal";
            uyari = "Bu etiket sistemde iptal edilmiş. Raftan kaldırınız" + (yeni is null ? " ve yeni etiket çıkartınız." : $"; yeni etiket {yeni.Basim:dd.MM.yyyy} tarihinde basıldı.");
        }
        else if (degisenler.Count == 0)
        {
            durum = "guncel";
            uyari = null;
        }
        else
        {
            var ne = string.Join(", ", degisenler.Select(x => x.ad.ToLower(Tr)));
            if (yeni is not null)
            {
                durum = "yenisi-var";
                uyari = $"Bu ürünün {ne} bilgisi değişti. Yeni etiketi {yeni.Basim:dd.MM.yyyy HH:mm} tarihinde basılmış; raftaki eski etiketi yenisiyle değiştiriniz.";
            }
            else
            {
                durum = "degisti";
                uyari = $"Bu ürünün {ne} bilgisi değişti ve yeni etiketi henüz çıkartılmamış. Etiketi sistemden yeniden çıkartıp değiştiriniz.";
            }
        }

        OkutmaYaz(k.EtiketId, k.DepoNo, personel, durum, degisenler.Select(x => x.alan));

        return new
        {
            id = k.EtiketId,
            durum,
            guncel = durum == "guncel",
            uyari,
            degisenler,
            basim = k.Basim,
            basan = k.BasanKullanici,
            sablon = k.Sablon,
            sube = k.SubeAdi,
            etiket = new
            {
                urunAdi = k.UrunAdi, fiyat = k.Fiyat, indirimliFiyat = k.IndirimliFiyat, indirimTuru = k.IndirimTuru,
                birimFiyat = k.BirimFiyat, mensei = k.Mensei, reyon = k.Reyon, skt = k.Skt,
                fiyatDegisimTarihi = k.FiyatDegisimTarihi, kampanyaBitis = k.KampanyaBitis,
            },
            guncelBilgi = new
            {
                urunAdi = guncelAd, fiyat = raf, indirimliFiyat = gBicard, mensei = guncelMensei, fiyatDegisimTarihi = sonFiyatTarihi,
            },
            sonradanFiyatDegisikligi = sonradanDegisiklik && degisenler.Count == 0,
            yeniEtiket = yeni is null ? null : new { id = yeni.EtiketId, basim = yeni.Basim, basan = yeni.BasanKullanici },
        };
    }

    /* ------------------------------------------------------------ SKT */

    /// <summary>
    /// Ürünün SKT durumu: etikette basılı SKT ve SKT kontrol modülünde bu
    /// şubede girilen, aksiyon alınmamış partiler (son 120 gün).
    /// </summary>
    public object SktDurumu(string subeAdi, string stokKodu, DateTime? etiketSkt)
    {
        var bugun = DateTime.Today;
        var gun = SktUyariGun;
        var partiler = new List<(DateTime skt, int adet, DateTime kontrol)>();

        if (!string.IsNullOrWhiteSpace(subeAdi) && !string.IsNullOrWhiteSpace(stokKodu))
            try
            {
                using var db = _vt.Baglanti();
                partiler = db.Query<(DateTime, int, DateTime)>(@"
IF OBJECT_ID('B360_SKT_PARTI') IS NOT NULL
SELECT p.skt, p.adet, k.olusturma
FROM B360_SKT_PARTI p
    INNER JOIN B360_SKT_KONTROL k ON k.id = p.kontrol_id
WHERE k.silindi = 0 AND k.stok_kod = @stokKodu AND k.sube = @subeAdi
  AND k.olusturma >= DATEADD(DAY, -120, SYSDATETIME())
  AND p.aksiyon IS NULL AND p.skt >= DATEADD(DAY, -30, CAST(SYSDATETIME() AS DATE))
ORDER BY p.skt", new { stokKodu, subeAdi }).ToList();
            }
            catch (Exception h)
            {
                _kayit.LogDebug(h, "SKT partileri okunamadı");
            }

        if (etiketSkt is null && partiler.Count == 0) return null;

        var tarihler = partiler.Select(x => x.skt.Date).ToList();
        if (etiketSkt is { } e) tarihler.Add(e.Date);
        var enYakin = tarihler.Min();
        var kalan = (enYakin - bugun).Days;

        var durum = kalan < 0 ? "gecti" : kalan <= gun ? "yakin" : "normal";
        var uyari = durum switch
        {
            "gecti" => $"Son kullanma tarihi geçmiş ({enYakin:dd.MM.yyyy}, {-kalan} gün önce). Ürünü raftan kaldırınız.",
            "yakin" => kalan == 0
                ? $"Son kullanma tarihi bugün ({enYakin:dd.MM.yyyy})."
                : $"Son kullanma tarihi yaklaşıyor: {enYakin:dd.MM.yyyy} ({kalan} gün kaldı).",
            _ => null,
        };

        return new
        {
            etiketSkt,
            enYakin,
            kalanGun = kalan,
            durum,
            uyari,
            uyariGun = gun,
            partiler = partiler.Select(x => new { skt = x.skt, x.adet, kalanGun = (x.skt.Date - bugun).Days, kontrol = x.kontrol }),
        };
    }

    private static string Kirp(string s, int n) => s is null ? null : s.Length <= n ? s : s[..n];
}

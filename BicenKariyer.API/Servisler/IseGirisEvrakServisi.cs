using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe giriş evraklarının tanımı: İK'nın adaydan istediği her evrak.
/// </summary>
public class EvrakTanimi
{
    /// <summary>Değişmeyen kod; belgeler bu kodla eşleşiyor.</summary>
    public string Kod { get; set; }

    public string Ad { get; set; }

    /// <summary>Nereden alınır: e-Devlet, Halk Eğitim Merkezi…</summary>
    public string Kaynak { get; set; }

    /// <summary>Personel kartında hangi klasöre düşer.</summary>
    public string Kategori { get; set; } = BelgeKategorileri.Ozluk;

    /// <summary>Kaç adet istenir (fotoğraf: 3). Bilgi amaçlı.</summary>
    public int Adet { get; set; } = 1;

    /// <summary>Kısa not: "son üç ay içinde alınmış olmalı".</summary>
    public string Not { get; set; }

    public bool Aktif { get; set; } = true;

    /// <summary>
    /// Kalıcı ayraç numarası (16.10.2026, 1–127): toplu taramada basılı
    /// ayraç sayfası bu numarayı taşır. Bir kez verilir, değişmez ve silinen
    /// evrakın numarası başkasına verilmez; lamine edilmiş eski ayraçlar
    /// hep aynı evrakı gösterir.
    /// </summary>
    public int AyracNo { get; set; }
}

/// <summary>KRY_AYARLAR, ISE_GIRIS_EVRAK anahtarı.</summary>
public class IseGirisEvrakAyari
{
    public const string Anahtar = "ISE_GIRIS_EVRAK";

    public List<EvrakTanimi> Evraklar { get; set; } = new();

    /// <summary>Şimdiye kadar verilen en büyük ayraç numarası (yeniden kullanılmasın)</summary>
    public int SonAyracNo { get; set; }

    public const int EnBuyukAyracNo = 127;

    /// <summary>
    /// Eksik / yinelenen ayraç numaralarını tamamlar. Varsayılan listedeki
    /// evraklar varsayılan numaralarını alır (her kurulumda aynı); diğerleri
    /// sıradaki boş numarayı. Değişiklik olduysa true.
    /// </summary>
    public bool Numarala(IEnumerable<EvrakTanimi> oncekiler = null)
    {
        var degisti = false;
        var eski = (oncekiler ?? Enumerable.Empty<EvrakTanimi>())
            .Where(x => x?.Kod != null && x.AyracNo is > 0 and <= EnBuyukAyracNo)
            .GroupBy(x => x.Kod, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().AyracNo, StringComparer.OrdinalIgnoreCase);
        var varsayilan = Varsayilan().ToDictionary(x => x.Kod, x => x.AyracNo, StringComparer.OrdinalIgnoreCase);

        foreach (var t in Evraklar)
            if (t.AyracNo <= 0 && t.Kod != null && eski.TryGetValue(t.Kod, out var n))
            {
                t.AyracNo = n;
                degisti = true;
            }

        var kullanilan = new HashSet<int>();
        foreach (var t in Evraklar)
            if (t.AyracNo is > 0 and <= EnBuyukAyracNo && !kullanilan.Add(t.AyracNo))
            {
                t.AyracNo = 0; /* yinelenen: yeniden verilecek */
                degisti = true;
            }

        var son = Math.Max(SonAyracNo, Math.Max(varsayilan.Values.DefaultIfEmpty(0).Max(), kullanilan.DefaultIfEmpty(0).Max()));

        foreach (var t in Evraklar.Where(x => x.AyracNo is <= 0 or > EnBuyukAyracNo))
        {
            if (t.Kod != null && varsayilan.TryGetValue(t.Kod, out var v) && !kullanilan.Contains(v))
                t.AyracNo = v;
            else
            {
                var n = son + 1;
                while (kullanilan.Contains(n) && n <= EnBuyukAyracNo) n++;
                if (n > EnBuyukAyracNo)
                    n = Enumerable.Range(1, EnBuyukAyracNo).FirstOrDefault(i => !kullanilan.Contains(i) && !varsayilan.ContainsValue(i));
                t.AyracNo = n;
            }

            kullanilan.Add(t.AyracNo);
            son = Math.Max(son, t.AyracNo);
            degisti = true;
        }

        if (son > SonAyracNo)
        {
            SonAyracNo = Math.Min(son, EnBuyukAyracNo);
            degisti = true;
        }

        return degisti;
    }

    /// <summary>İK'nın kullandığı işe giriş evrak listesi (03.10.2026).</summary>
    public static List<EvrakTanimi> Varsayilan()
    {
        var l = VarsayilanListe();
        for (var i = 0; i < l.Count; i++) l[i].AyracNo = i + 1;
        return l;
    }

    private static List<EvrakTanimi> VarsayilanListe() => new()
    {
        new() { Kod = "ikametgah", Ad = "İkametgâh", Kaynak = "e-Devlet" },
        new() { Kod = "iskur", Ad = "İŞKUR kayıt evrakı", Kaynak = "e-Devlet" },
        new() { Kod = "vukuatli_nufus", Ad = "Vukuatlı nüfus kayıt örneği", Kaynak = "e-Devlet" },
        new() { Kod = "nufus_cuzdani", Ad = "Nüfus cüzdanı fotokopisi" },
        new()
        {
            Kod = "saglik_raporu", Ad = "Sağlık raporu",
            Kaynak = "Devlet hastanesi, sağlık ocağı veya özel hastane",
            Kategori = BelgeKategorileri.Rapor
        },
        new()
        {
            Kod = "sabika", Ad = "Sabıka sicil kaydı", Kaynak = "e-Devlet",
            Not = "Son üç ay içinde alınmış olmalı"
        },
        new() { Kod = "resim", Ad = "Fotoğraf", Adet = 3, Not = "3 adet vesikalık" },
        new() { Kod = "diploma", Ad = "Diploma fotokopisi veya öğrenci belgesi" },
        new()
        {
            Kod = "askerlik", Ad = "Askerlik terhis belgesi", Kaynak = "e-Devlet",
            Not = "Kadın adaylarda ve muaflarda \"Gerekmiyor\" işaretlenir"
        },
        new() { Kod = "hizmet_dokumu", Ad = "SSK hizmet dökümü", Kaynak = "e-Devlet" },
        new() { Kod = "hijyen", Ad = "Hijyen sertifikası", Kaynak = "Halk Eğitim Merkezi" },
        new()
        {
            Kod = "banka", Ad = "Garanti Bankası maaş hesabı",
            Kaynak = "Biçen A.Ş. maaş hesabı"
        },
    };
}

/// <summary>
/// Personel kartındaki belge klasörleri. Kategorisi yazılmamış eski
/// belgeler türünden ve açıklamasından klasöre yerleştiriliyor.
/// </summary>
public static class BelgeKategorileri
{
    public const string Ozluk = "Özlük";
    public const string Izin = "İzin";
    public const string Rapor = "Raporlar";
    public const string Disiplin = "Disiplin";
    public const string Diger = "Diğer";

    public static readonly string[] Tumu = { Ozluk, Izin, Rapor, Disiplin, Diger };

    public static string Bul(string kategori, string tur, string aciklama)
    {
        if (!string.IsNullOrWhiteSpace(kategori) && Tumu.Contains(kategori.Trim()))
            return kategori.Trim();

        var t = (tur ?? "").Trim();

        if (t == "Sağlık Raporu") return Rapor;
        if (t is "Tutanak" or "İhtar" or "Savunma" or "Uyarı") return Disiplin;
        if (t is "Sözleşme" or "İbraname" or "Eğitim Belgesi" or "Özlük Evrakı") return Ozluk;

        /* İzin formları ve izin talebine eklenen evraklar açıklamada
           talep numarasını taşıyor ("İzin talebi #123 …") */
        if (t.Contains("İzin", StringComparison.OrdinalIgnoreCase) ||
            (aciklama ?? "").StartsWith("İzin talebi #", StringComparison.OrdinalIgnoreCase))
            return Izin;

        return Diger;
    }
}

/// <summary>
/// İşe giriş evrak takibi.
///
/// <para>
/// Bir "takip" bir işe girişin evrak listesi: başvurudan işe alımda
/// açılıyor (aday henüz Mikro'da yokken), ya da personel kartından elle
/// başlatılıyor. Evrakın kendisi KRY_PERSONEL_BELGE'de takip_id ve
/// evrak_kodu ile duruyor; kimlik numarası yazıldığı için personel Mikro'ya
/// girildiğinde kartında kendiliğinden görünüyor.
/// </para>
///
/// <para>
/// Eksik evrak işe alımı durdurmuyor; personel kartında "eksik" olarak
/// görünüyor. Askerlik gibi herkese gerekmeyen evraklar "Gerekmiyor"
/// işaretleniyor.
/// </para>
/// </summary>
public class IseGirisEvrakServisi
{
    public const string DurumGerekmiyor = "gerekmiyor";

    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;

    public IseGirisEvrakServisi(VeritabaniServisi vt, AyarServisi ayar)
    {
        _vt = vt;
        _ayar = ayar;
    }

    /// <summary>Tüm tanımlar (pasifler dahil).</summary>
    public List<EvrakTanimi> TumTanimlar()
    {
        try
        {
            var ayar = _ayar.Oku(IseGirisEvrakAyari.Anahtar, new IseGirisEvrakAyari());

            if (ayar?.Evraklar is { Count: > 0 })
            {
                /* Ayraç numarası olmayan eski kayıt: bir kez verilip saklanır */
                if (ayar.Numarala())
                    try
                    {
                        _ayar.Yaz(IseGirisEvrakAyari.Anahtar, ayar);
                    }
                    catch
                    {
                        /* Yazılamasa da bu okumada numaralar aynı kuralla verildi */
                    }

                return ayar.Evraklar;
            }
        }
        catch
        {
            /* Ayar okunamazsa varsayılan liste */
        }

        return IseGirisEvrakAyari.Varsayilan();
    }

    /// <summary>Takipte istenen (aktif) evraklar.</summary>
    public List<EvrakTanimi> Tanimlar() => TumTanimlar().Where(x => x.Aktif).ToList();

    /// <summary>Tanımları yazar; ayraç numaraları önceki kayıttan korunur.</summary>
    public void TanimlariYaz(List<EvrakTanimi> evraklar)
    {
        IseGirisEvrakAyari onceki = null;

        try
        {
            onceki = _ayar.Oku(IseGirisEvrakAyari.Anahtar, new IseGirisEvrakAyari());
        }
        catch
        {
            /* İlk kayıt */
        }

        var yeni = new IseGirisEvrakAyari { Evraklar = evraklar, SonAyracNo = onceki?.SonAyracNo ?? 0 };
        var eskiler = (onceki?.Evraklar is { Count: > 0 } ? onceki.Evraklar : IseGirisEvrakAyari.Varsayilan());
        yeni.SonAyracNo = Math.Max(yeni.SonAyracNo, eskiler.Select(x => x.AyracNo).DefaultIfEmpty(0).Max());
        yeni.Numarala(eskiler);

        _ayar.Yaz(IseGirisEvrakAyari.Anahtar, yeni);
    }

    /// <summary>11 haneli kimlik numarası; değilse null.</summary>
    public static string Kimlik(string deger)
    {
        var r = new string((deger ?? "").Where(char.IsDigit).ToArray());

        return r.Length == 11 ? r : null;
    }

    /* ------------------------------------------------------------ takip */

    public int? BasvuruTakibi(IDbConnection db, int basvuruId) =>
        db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM KRY_ISE_GIRIS_TAKIP
WHERE basvuru_id = @basvuruId AND kapandi = 0
ORDER BY baslama DESC", new { basvuruId });

    public int? KimlikTakibi(IDbConnection db, string kimlik) =>
        Kimlik(kimlik) is not { } k
            ? null
            : db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM KRY_ISE_GIRIS_TAKIP
WHERE kimlik_no = @k AND kapandi = 0
ORDER BY baslama DESC", new { k });

    /// <summary>Başvurunun takibi; yoksa açar.</summary>
    public int BasvuruTakibiAc(IDbConnection db, int basvuruId, string kullanici)
    {
        var mevcut = BasvuruTakibi(db, basvuruId);

        if (mevcut is not null) return mevcut.Value;

        var b = db.QueryFirstOrDefault(
            "SELECT ad_soyad, kimlik_no FROM KRY_BASVURULAR WHERE id = @basvuruId",
            new { basvuruId });

        return Ac(db, Kimlik((string)b?.kimlik_no), basvuruId, (string)b?.ad_soyad, kullanici);
    }

    public int Ac(IDbConnection db, string kimlik, int? basvuruId, string adSoyad, string kullanici) =>
        db.ExecuteScalar<int>(@"
INSERT INTO KRY_ISE_GIRIS_TAKIP (kimlik_no, basvuru_id, ad_soyad, baslatan)
OUTPUT INSERTED.id
VALUES (@kimlik, @basvuruId, @adSoyad, @kullanici)",
            new { kimlik = Kimlik(kimlik), basvuruId, adSoyad, kullanici });

    /* ------------------------------------------------------------ durum */

    /// <summary>Bir takibin evrak listesi; takip yoksa her evrak eksik.</summary>
    public object Durum(IDbConnection db, int? takipId)
    {
        var tanimlar = Tanimlar();

        var belgeler = takipId is null
            ? new List<dynamic>()
            : db.Query(@"
SELECT id, evrak_kodu AS evrakKodu, baslik, ozgun_ad AS ozgunAd, dosya, boyut,
       yukleyen, olusturma
FROM KRY_PERSONEL_BELGE
WHERE silindi = 0 AND takip_id = @takipId
ORDER BY olusturma", new { takipId }).ToList();

        var durumlar = takipId is null
            ? new List<dynamic>()
            : db.Query(@"
SELECT evrak_kodu AS evrakKodu, durum, aciklama, guncelleyen, guncelleme
FROM KRY_ISE_GIRIS_EVRAK_DURUM WHERE takip_id = @takipId", new { takipId }).ToList();

        dynamic takip = takipId is null
            ? null
            : db.QueryFirstOrDefault(@"
SELECT id, basvuru_id AS basvuruId, ad_soyad AS adSoyad, baslatan, baslama
FROM KRY_ISE_GIRIS_TAKIP WHERE id = @takipId", new { takipId });

        var evraklar = tanimlar.Select(t =>
        {
            var dosyalar = belgeler
                .Where(b => string.Equals((string)b.evrakKodu, t.Kod, StringComparison.OrdinalIgnoreCase))
                .Select(b =>
                {
                    var uzanti = Path.GetExtension((string)b.dosya ?? "").ToLowerInvariant();

                    return new
                    {
                        id = (int)b.id,
                        baslik = (string)b.baslik,
                        ozgunAd = (string)b.ozgunAd,
                        boyut = (long)b.boyut,
                        yukleyen = (string)b.yukleyen,
                        olusturma = (DateTime)b.olusturma,
                        uzanti,
                        onizlenebilir = uzanti is ".pdf" or ".jpg" or ".jpeg" or ".png" or ".txt"
                    };
                })
                .ToList();

            var d = durumlar.FirstOrDefault(x =>
                string.Equals((string)x.evrakKodu, t.Kod, StringComparison.OrdinalIgnoreCase));

            var gerekmiyor = d is not null && (string)d.durum == DurumGerekmiyor;

            return new
            {
                kod = t.Kod,
                ad = t.Ad,
                ayracNo = t.AyracNo,
                kaynak = t.Kaynak,
                kategori = t.Kategori,
                adet = t.Adet,
                not = t.Not,
                durum = dosyalar.Count > 0 ? "tamam" : gerekmiyor ? DurumGerekmiyor : "eksik",
                durumAciklama = gerekmiyor ? (string)d.aciklama : null,
                durumYazan = gerekmiyor ? (string)d.guncelleyen : null,
                belgeler = dosyalar
            };
        }).ToList();

        var tamam = evraklar.Count(x => x.durum == "tamam");
        var gerekmeyen = evraklar.Count(x => x.durum == DurumGerekmiyor);

        return new
        {
            takipVar = takipId is not null,
            takip = takip is null
                ? null
                : new
                {
                    id = (int)takip.id,
                    basvuruId = (int?)takip.basvuruId,
                    adSoyad = (string)takip.adSoyad,
                    baslatan = (string)takip.baslatan,
                    baslama = (DateTime)takip.baslama
                },
            evraklar,
            ozet = new
            {
                toplam = evraklar.Count,
                tamam,
                gerekmiyor = gerekmeyen,
                eksik = evraklar.Count - tamam - gerekmeyen,
                eksikler = evraklar.Where(x => x.durum == "eksik").Select(x => x.ad).ToList()
            }
        };
    }

    /// <summary>
    /// Açık takiplerdeki eksik evrak adları, kimlik numarasına göre.
    /// Personel listesi ve kart özeti için tek seferde okunuyor.
    /// Aynı kişinin birden çok takibi varsa en yenisi geçerli.
    /// </summary>
    public Dictionary<string, List<string>> KimlikEksikleri()
    {
        var sonuc = new Dictionary<string, List<string>>();

        try
        {
            using var db = _vt.Baglanti();

            var takipler = db.Query(@"
SELECT id, kimlik_no AS kimlik, baslama FROM KRY_ISE_GIRIS_TAKIP
WHERE kapandi = 0 AND kimlik_no IS NOT NULL
ORDER BY baslama DESC").ToList();

            if (takipler.Count == 0) return sonuc;

            var yuklu = db.Query(@"
SELECT DISTINCT takip_id AS takipId, evrak_kodu AS kod FROM KRY_PERSONEL_BELGE
WHERE silindi = 0 AND takip_id IS NOT NULL AND evrak_kodu IS NOT NULL")
                .Select(x => $"{(int)x.takipId}|{((string)x.kod).ToLowerInvariant()}");

            var gerekmeyen = db.Query(@"
SELECT takip_id AS takipId, evrak_kodu AS kod FROM KRY_ISE_GIRIS_EVRAK_DURUM
WHERE durum = @d", new { d = DurumGerekmiyor })
                .Select(x => $"{(int)x.takipId}|{((string)x.kod).ToLowerInvariant()}");

            var kapali = new HashSet<string>(yuklu.Concat(gerekmeyen));
            var tanimlar = Tanimlar();

            foreach (var t in takipler)
            {
                var kimlik = ((string)t.kimlik).Trim();

                if (sonuc.ContainsKey(kimlik)) continue;   // en yenisi alındı

                sonuc[kimlik] = tanimlar
                    .Where(x => !kapali.Contains($"{(int)t.id}|{x.Kod.ToLowerInvariant()}"))
                    .Select(x => x.Ad)
                    .ToList();
            }
        }
        catch
        {
            /* Tablolar yoksa ya da okunamazsa eksik uyarısı gösterilmez */
        }

        return sonuc;
    }
}

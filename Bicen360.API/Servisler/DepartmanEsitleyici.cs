using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// İK panelindeki departmanları (KRY_DEPARTMAN) portal departmanlarına
/// (B360_DEPARTMAN) eşitler.
///
/// <para>
/// <b>Neden birleştirilmedi.</b> Arıza kayıtları, envanter ve kategoriler
/// B360_DEPARTMAN kimliğine yabancı anahtarla bağlı. Tabloyu KRY_DEPARTMAN
/// ile değiştirmek bütün bu kayıtların taşınmasını gerektirirdi. Bunun
/// yerine İK departmanı portalda bir satırla karşılanıyor ve
/// <c>kry_departman_id</c> ile izleniyor.
/// </para>
///
/// <para>
/// <b>Kurallar.</b>
/// <list type="bullet">
/// <item>İK'da açılan departman portalda yoksa açılır; departmanın
///       yöneticileri ilk açılışta temsilci olarak eklenir.</item>
/// <item>Portalda aynı adla elle açılmış bir departman varsa yenisi
///       açılmaz, o satır İK departmanına bağlanır.</item>
/// <item>Ad İK'da değişirse portalda da değişir; bağlı departmanın adı
///       portaldan değiştirilemez.</item>
/// <item>İK'da kaldırılan departman portalda pasife alınır. Portalda
///       pasife alınan bağlı departman eşitlemede yeniden açılmaz.</item>
/// <item>Temsilciler ve sıra portalda yönetilir; eşitleme onlara
///       ilk açılıştan sonra dokunmaz.</item>
/// </list>
/// </para>
/// </summary>
public class DepartmanEsitleyici
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<DepartmanEsitleyici> _kayit;

    private DateTime _son = DateTime.MinValue;
    private readonly object _kilit = new();

    public DepartmanEsitleyici(VeritabaniServisi vt, ILogger<DepartmanEsitleyici> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>Son eşitlemede oluşan hata; ekranda gösteriliyor.</summary>
    public string SonHata { get; private set; }

    /// <summary>
    /// Eşitler. <paramref name="zorla"/> verilmezse beş dakikada bir
    /// çalışır: departman listesi açılan her ekranda çağrılıyor.
    /// </summary>
    public void Esitle(bool zorla = false)
    {
        lock (_kilit)
        {
            if (!zorla && DateTime.UtcNow - _son < TimeSpan.FromMinutes(5)) return;

            _son = DateTime.UtcNow;

            try
            {
                Calistir();
                SonHata = null;
            }
            catch (Exception hata)
            {
                /* İK tablosu yoksa (Kariyer API henüz kurmadıysa) portal
                   kendi departmanlarıyla çalışmaya devam eder. */
                SonHata = hata.Message;
                _kayit.LogWarning(hata, "İK departmanları eşitlenemedi");
            }
        }
    }

    private sealed class IkDepartman
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public string Aciklama { get; set; }
        public int Sira { get; set; }
        public bool Aktif { get; set; }
    }

    private sealed class PortalDepartman
    {
        public int Id { get; set; }
        public string Ad { get; set; }
        public bool Aktif { get; set; }
        public int? KryId { get; set; }
    }

    private void Calistir()
    {
        using var db = _vt.Baglanti();

        var varMi = db.ExecuteScalar<int>(
            "SELECT CASE WHEN OBJECT_ID('KRY_DEPARTMAN') IS NULL THEN 0 ELSE 1 END") == 1;

        if (!varMi) return;

        var ik = db.Query<IkDepartman>(@"
SELECT id AS Id, ad AS Ad, aciklama AS Aciklama, sira AS Sira, aktif AS Aktif
FROM KRY_DEPARTMAN").ToList();

        var portal = db.Query<PortalDepartman>(@"
SELECT id AS Id, ad AS Ad, aktif AS Aktif, kry_departman_id AS KryId
FROM B360_DEPARTMAN").ToList();

        db.Open();

        foreach (var d in ik)
        {
            var ad = Kirp(d.Ad, 80) ?? "";

            if (ad.Length == 0) continue;

            var bagli = portal.FirstOrDefault(x => x.KryId == d.Id);

            if (!d.Aktif)
            {
                /* İK'da kaldırıldı: bağlı satır pasife */
                if (bagli is { Aktif: true })
                {
                    db.Execute("UPDATE B360_DEPARTMAN SET aktif = 0 WHERE id = @id", new { id = bagli.Id });
                    bagli.Aktif = false;
                }

                continue;
            }

            if (bagli is not null)
            {
                /* Ad değiştiyse güncelle; başka bir satır o adı kullanıyorsa
                   (UNIQUE) dokunma, eski adla kalsın. */
                if (!string.Equals(bagli.Ad, ad, StringComparison.Ordinal) &&
                    !portal.Any(x => x.Id != bagli.Id &&
                                     string.Equals(x.Ad, ad, StringComparison.OrdinalIgnoreCase)))
                {
                    db.Execute("UPDATE B360_DEPARTMAN SET ad = @ad WHERE id = @id",
                        new { ad, id = bagli.Id });
                    bagli.Ad = ad;
                }

                continue;
            }

            /* Aynı adla elle açılmış, henüz bağlanmamış satır varsa bağla */
            var ayniAd = portal.FirstOrDefault(x => x.KryId is null &&
                YetkiServisi.Anahtar(x.Ad) == YetkiServisi.Anahtar(ad));

            if (ayniAd is not null)
            {
                db.Execute("UPDATE B360_DEPARTMAN SET kry_departman_id = @k WHERE id = @id",
                    new { k = d.Id, id = ayniAd.Id });
                ayniAd.KryId = d.Id;
                continue;
            }

            /* Adı başka bir bağlı satırda kullanılıyorsa açılamaz (UNIQUE) */
            if (portal.Any(x => string.Equals(x.Ad, ad, StringComparison.OrdinalIgnoreCase)))
                continue;

            using var islem = db.BeginTransaction();

            var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO B360_DEPARTMAN (ad, aciklama, aktif, sira, kry_departman_id)
VALUES (@ad, @aciklama, 1, @sira, @kry);
SELECT CAST(SCOPE_IDENTITY() AS INT);",
                new { ad, aciklama = Kirp(d.Aciklama, 200), sira = d.Sira, kry = d.Id }, islem);

            /* Departman yöneticileri ilk açılışta temsilci olur: kayıt
               açılınca bildirimin kime gideceği baştan belli olsun. */
            db.Execute(@"
INSERT INTO B360_DEPARTMAN_TEMSILCI (departman_id, personel_kodu)
SELECT DISTINCT @yeniId, LTRIM(RTRIM(personel_kodu))
FROM KRY_DEPARTMAN_UYE
WHERE departman_id = @kry AND rol = N'yonetici'
  AND LTRIM(RTRIM(ISNULL(personel_kodu, ''))) <> ''",
                new { yeniId, kry = d.Id }, islem);

            islem.Commit();

            portal.Add(new PortalDepartman { Id = yeniId, Ad = ad, Aktif = true, KryId = d.Id });

            _kayit.LogInformation("İK departmanı portala eklendi: {Ad}", ad);
        }

        /* İK'dan tamamen silinmiş (satırı kalmamış) departmanlar */
        foreach (var p in portal.Where(x => x.KryId is not null && x.Aktif))
        {
            if (!ik.Any(x => x.Id == p.KryId))
                db.Execute("UPDATE B360_DEPARTMAN SET aktif = 0 WHERE id = @id", new { id = p.Id });
        }
    }

    private static string Kirp(string metin, int uzunluk)
    {
        if (string.IsNullOrWhiteSpace(metin)) return null;

        metin = metin.Trim();

        return metin.Length > uzunluk ? metin[..uzunluk] : metin;
    }
}

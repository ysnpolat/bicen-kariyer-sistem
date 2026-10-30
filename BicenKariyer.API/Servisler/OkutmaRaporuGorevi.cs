using Dapper;
namespace BicenKariyer.API.Servisler;

/// <summary>
/// Her gün saat 10:00'da bir önceki günün okutma raporunu mail atar.
///
/// İki tür gönderim yapılır:
///
///   1. Bölge müdürlerine yalnızca kendi bölgelerinin raporu
///   2. İK ve yönetim adreslerine tüm şubeleri kapsayan rapor
///
/// Gönderim saati ve alıcılar appsettings.json içinden ayarlanır. Aynı gün
/// içinde iki kez gönderilmemesi için son gönderim tarihi saklanır.
/// </summary>
public class OkutmaRaporuGorevi : BackgroundService
{
    private readonly IServiceScopeFactory _kapsamUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<OkutmaRaporuGorevi> _kayit;

    /* Son gönderim veritabanında saklanır. Bellekte tutulursa IIS uygulama
       havuzu geri dönüştüğünde unutulur ve rapor ya hiç gitmez ya iki kez
       gider. */
    private const string SonGonderimAnahtari = "OkutmaRaporuSonGonderim";

    public OkutmaRaporuGorevi(
        IServiceScopeFactory kapsamUretici,
        IConfiguration yapilandirma,
        ILogger<OkutmaRaporuGorevi> kayit)
    {
        _kapsamUretici = kapsamUretici;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private bool Acik => _yapilandirma.GetValue("OkutmaRaporu:Acik", false);

    private int Saat => _yapilandirma.GetValue("OkutmaRaporu:Saat", 10);

    /// <summary>Tüm şubeleri kapsayan raporun gideceği adresler</summary>
    private string[] GenelAlicilar =>
        _yapilandirma.GetSection("OkutmaRaporu:GenelAlicilar").Get<string[]>()
        ?? Array.Empty<string>();

    protected override async Task ExecuteAsync(CancellationToken iptal)
    {
        /* Uygulama açılışında hemen tetiklenmesin */
        await Task.Delay(TimeSpan.FromMinutes(2), iptal);

        while (!iptal.IsCancellationRequested)
        {
            try
            {
                if (Acik)
                {
                    using var kapsam = _kapsamUretici.CreateScope();
                    var vt = kapsam.ServiceProvider
                        .GetRequiredService<VeritabaniServisi>();

                    if (ZamaniGeldiMi(vt))
                        await GonderAsync(iptal);
                }
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Okutma raporu görevi hata verdi");
            }

            /* On dakikada bir denetlenir; saatin kaçırılmaması için yeterli */
            await Task.Delay(TimeSpan.FromMinutes(10), iptal);
        }
    }

    /// <summary>Bugün henüz gönderilmediyse ve saat geldiyse doğru döner.</summary>
    private bool ZamaniGeldiMi(VeritabaniServisi vt)
    {
        var simdi = DateTime.Now;

        if (simdi.Hour < Saat) return false;

        try
        {
            using var db = vt.Baglanti();

            var son = db.ExecuteScalar<DateTime?>(@"
SELECT deger FROM KRY_SISTEM_DURUM WHERE anahtar = @anahtar",
                new { anahtar = SonGonderimAnahtari });

            /* Bugün gönderilmişse tekrar gönderilmez */
            return son?.Date != simdi.Date;
        }
        catch
        {
            /* Durum okunamazsa gönderim denenmez; mükerrer mail riski
               gönderilmemesinden daha kötüdür. */
            return false;
        }
    }

    /// <summary>Gönderim zamanını kalıcı olarak işaretler.</summary>
    private static void GonderimiIsaretle(VeritabaniServisi vt)
    {
        using var db = vt.Baglanti();

        db.Execute(@"
MERGE KRY_SISTEM_DURUM AS h
USING (SELECT @anahtar AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger) VALUES (@anahtar, SYSDATETIME());",
            new { anahtar = SonGonderimAnahtari });
    }

    private async Task GonderAsync(CancellationToken iptal)
    {
        using var kapsam = _kapsamUretici.CreateScope();
        var saglayici = kapsam.ServiceProvider;

        var vt = saglayici.GetRequiredService<VeritabaniServisi>();
        var ayarServisi = saglayici.GetRequiredService<AyarServisi>();
        var mail = saglayici.GetRequiredService<MailServisi>();
        var rapor = saglayici.GetRequiredService<OkutmaRaporuServisi>();
        var gunluk = saglayici.GetRequiredService<GuvenlikGunlugu>();

        var dun = DateTime.Today.AddDays(-1);

        var hazirlayici = new OkutmaVeriHazirlayici(vt, ayarServisi);

        /* ------------------------------------------- genel rapor */
        var genelAlicilar = GenelAlicilar;

        if (genelAlicilar.Length > 0)
        {
            var veri = hazirlayici.Hazirla(dun, dun, null);

            await mail.GonderAsync(
                genelAlicilar,
                rapor.Konu(veri, true),
                rapor.Govde(veri, null, true));

            gunluk.Yaz("OKUTMA RAPORU", "-",
                $"Genel rapor gönderildi: {string.Join(", ", genelAlicilar)}");
        }

        /* --------------------------------- bölge müdürlerine kendi bölgesi */
        var ayar = ayarServisi.FormOku();

        using var db = vt.Baglanti();

        var mudurler = db.Query<Kullanici>(@"
SELECT kullanici_adi AS KullaniciAdi, ad_soyad AS AdSoyad,
       eposta AS Eposta, bolge AS Bolge
FROM KRY_KULLANICILAR
WHERE aktif = 1
  AND eposta IS NOT NULL AND LTRIM(RTRIM(eposta)) <> ''
  AND bolge IS NOT NULL AND LTRIM(RTRIM(bolge)) <> ''").ToList();

        foreach (var mudur in mudurler)
        {
            if (iptal.IsCancellationRequested) break;

            var bolgeler = (mudur.Bolge ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .Where(x => x.Length > 0)
                .ToArray();

            if (bolgeler.Length == 0) continue;

            try
            {
                var veri = hazirlayici.Hazirla(dun, dun, bolgeler);

                if (veri.Magazalar.Count == 0) continue;

                await mail.GonderAsync(
                    new[] { mudur.Eposta },
                    rapor.Konu(veri, false),
                    rapor.Govde(veri, mudur.AdSoyad, false));
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata,
                    "Bölge raporu gönderilemedi: {Kisi}", mudur.Eposta);
            }
        }

        /* ------------------------------------- şubelere kendi raporu */

        /* Her şubeye yalnızca kendi verisi gider. Adresi tanımlı olmayan
           şube atlanır; bir şubenin gönderimi hata verirse diğerleri
           etkilenmez, tek tek denenir. */
        var subeler = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Eposta))
            .ToList();

        var subeGonderim = 0;

        foreach (var sube in subeler)
        {
            if (iptal.IsCancellationRequested) break;

            var adresler = sube.Eposta
                .Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .Where(x => x.Contains('@'))
                .ToArray();

            if (adresler.Length == 0) continue;

            try
            {
                var veri = hazirlayici.Hazirla(dun, dun, null, sube.Ad);

                /* O gün o şubede hiç okutma yoksa mail gönderilmez:
                   her sabah boş rapor almak bildirimi değersizleştirir. */
                if (veri.Magazalar.Count == 0) continue;

                await mail.GonderAsync(
                    adresler,
                    rapor.Konu(veri, false),
                    rapor.Govde(veri, sube.Ad, false, subeSurumu: true));

                subeGonderim++;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata,
                    "Şube raporu gönderilemedi: {Sube} ({Adres})",
                    sube.Ad, sube.Eposta);
            }
        }

        if (subeGonderim > 0)
            gunluk.Yaz("OKUTMA RAPORU", "-",
                $"{subeGonderim} şubeye kendi raporu gönderildi");

        GonderimiIsaretle(vt);

        _kayit.LogInformation(
            "Günlük okutma raporu gönderildi ({Tarih:dd.MM.yyyy}) · {Sube} şube",
            dun, subeGonderim);
    }
}

using System.Collections.Concurrent;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Biçen360 sürüm takibi ve güncelleme hatırlatması (08.10.2026).
///
/// <para>
/// Uygulama mağazadan güncellendiği için sunucu personeli zorla
/// güncelleyemiyor. Bunun yerine her personelin hangi sürümü kullandığı
/// izleniyor: 1.6 ve sonrası her istekte <c>X-Uygulama-Surum</c> başlığını
/// gönderiyor; başlığı olmayan oturum 1.5 ya da öncesi demek. Mağazadaki
/// güncel sürümden (Ayarlar Merkezi) eski olana belirli aralıklarla
/// bildirim ve "Güncelle" bağlantılı kişiye özel duyuru gidiyor (1.5'in
/// duyuru ekranı bağlantı düğmesini gösteriyor; bağlantı telefona göre
/// Play Store ya da App Store'u açıyor).
/// </para>
/// </summary>
public static class UygulamaSurumu
{
    /// <summary>Telefona göre mağazayı açan tek bağlantı</summary>
    public const string Link = UygulamaDavetGorevi.LINK;

    /// <summary>Sürüm bilgisi olmayan (1.5 ve öncesi) oturumun etiketi</summary>
    public const string Eski = "1.5 ya da öncesi";

    /* Her istekte yazılmasın: aynı kişi için sürüm değişmedikçe 30 dakikada bir */
    private static readonly ConcurrentDictionary<string, (string Surum, DateTime Zaman)> Son = new();

    /// <summary>
    /// Ara katman: kimliği doğrulanmış personel oturumunda sürümü kaydeder.
    /// Hata isteği etkilemez.
    /// </summary>
    public static void Kaydet(HttpContext baglam)
    {
        try
        {
            var ad = baglam.User?.Identity?.Name ?? "";
            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return;

            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');
            var kod = (i < 0 ? govde : govde[..i]).Trim();
            if (kod.Length == 0) return;

            var surum = Normal(baglam.Request.Headers["X-Uygulama-Surum"].ToString());
            var simdi = DateTime.Now;

            if (Son.TryGetValue(kod, out var s) && s.Surum == surum && simdi - s.Zaman < TimeSpan.FromMinutes(30))
                return;

            Son[kod] = (surum, simdi);

            var platform = Platform(baglam.Request.Headers.UserAgent.ToString());
            var vt = baglam.RequestServices.GetService<VeritabaniServisi>();
            if (vt is null) return;

            using var db = vt.Baglanti();
            db.Execute(@"
MERGE KRY_UYGULAMA_SURUM AS h
USING (SELECT @kod AS k) AS y ON h.personel_kodu = y.k
WHEN MATCHED THEN
    UPDATE SET son_gorulme = SYSDATETIME(),
               surum_degisim = CASE WHEN ISNULL(h.surum, N'') <> @surum THEN SYSDATETIME() ELSE h.surum_degisim END,
               surum = @surum,
               platform = ISNULL(@platform, h.platform)
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, surum, platform) VALUES (@kod, @surum, @platform);",
                new { kod, surum, platform });
        }
        catch
        {
            /* Sürüm kaydı tutulamazsa istek yine çalışır */
        }
    }

    /// <summary>"1.6.0" → "1.6"; boş ya da okunamayan → "" (1.5 ve öncesi)</summary>
    public static string Normal(string ham)
    {
        ham = (ham ?? "").Trim();
        if (!Version.TryParse(ham.Contains('.') ? ham : ham + ".0", out var v)) return "";
        return v.Build > 0 ? $"{v.Major}.{v.Minor}.{v.Build}" : $"{v.Major}.{v.Minor}";
    }

    /// <summary>a, b'den eski mi. Boş sürüm (1.5 ve öncesi) her sürümden eski.</summary>
    public static bool Eskimi(string a, string b)
    {
        if (!Version.TryParse(Tam(b), out var vb)) return false;
        if (!Version.TryParse(Tam(a), out var va)) return true;
        return va < vb;
    }

    private static string Tam(string s)
    {
        s = (s ?? "").Trim();
        return s.Length == 0 ? "" : s.Contains('.') ? s : s + ".0";
    }

    /// <summary>React Native isteklerinin kullanıcı ajanından işletim sistemi</summary>
    public static string Platform(string ua)
    {
        ua = (ua ?? "").ToLowerInvariant();
        if (ua.Contains("okhttp") || ua.Contains("android")) return "android";
        if (ua.Contains("cfnetwork") || ua.Contains("darwin") || ua.Contains("iphone") || ua.Contains("ios")) return "ios";
        return null;
    }

    /// <summary>Hatırlatma metni (bildirim ve duyuru)</summary>
    public static (string Baslik, string Kisa, string Uzun) Metinler(string guncel) =>
    (
        "Biçen360'ı güncelleyin",
        $"Biçen360'ın yeni sürümü ({guncel}) yayında. Yeni özellikleri kullanabilmek için uygulamayı güncelleyin.",
        $"Biçen360'ın yeni sürümü ({guncel}) Play Store ve App Store'da yayında.\n\n" +
        "Yeni sürümle mazeret izni türleri, imzalı formun uygulamadan yüklenmesi, avans talebi, " +
        "yöneticiler için fazla mesai ve rotasyon talepleri gibi yenilikler geliyor.\n\n" +
        "Aşağıdaki \"Uygulamayı güncelle\" düğmesine dokunun; mağaza açılınca \"Güncelle\"ye basın. " +
        "Telefonunuzda otomatik güncelleme açıksa bundan sonraki sürümler kendiliğinden yüklenir."
    );

    /// <summary>
    /// Bir personele hatırlatma: bildirim + (bu sürüm için ilk kez) kişiye
    /// özel duyuru. Sayaç ve zaman güncellenir.
    /// </summary>
    public static async Task Hatirlat(System.Data.IDbConnection db, BildirimServisi bildirim, string kod,
        string guncel, string gonderen)
    {
        var (baslik, kisa, uzun) = Metinler(guncel);

        var kayit = db.QueryFirstOrDefault(@"
SELECT hatirlatma_hedef AS hedef, duyuru_id AS duyuruId FROM KRY_UYGULAMA_SURUM WHERE personel_kodu = @kod",
            new { kod });

        int? duyuruId = (int?)kayit?.duyuruId;

        /* Duyuru her sürüm için bir kez: her hatırlatmada yeni duyuru birikmesin */
        if ((string)kayit?.hedef != guncel || duyuruId is null)
        {
            duyuruId = DuyuruYazici.Ekle(db, new DuyuruYazici.Kayit
            {
                Baslik = baslik,
                Metin = uzun,
                Hedef = "kisi",
                HedefOzet = "Uygulama güncellemesi",
                PersonelKodu = kod,
                Onemli = true,
                Baglanti = Link,
                BaglantiYazi = "Uygulamayı güncelle",
                Gonderen = gonderen,
                YazanAd = gonderen,
                YazanUnvan = "Biçen360",
            });
        }

        db.Execute(@"
UPDATE KRY_UYGULAMA_SURUM
SET hatirlatma_sayi = CASE WHEN ISNULL(hatirlatma_hedef, N'') = @guncel THEN hatirlatma_sayi + 1 ELSE 1 END,
    hatirlatma_hedef = @guncel, son_hatirlatma = SYSDATETIME(), duyuru_id = @duyuruId
WHERE personel_kodu = @kod", new { kod, guncel, duyuruId });

        /* Bildirime dokununca 1.5'te Duyurular açılır; güncelle düğmesi orada */
        await bildirim.Gonder(kod, baslik, kisa, "duyuru");
    }
}

/// <summary>
/// Günlük güncelleme hatırlatması: güncel sürümden eski kullanan, son 30
/// günde uygulamayı açmış aktif personele; Ayarlar Merkezi'ndeki aralık ve
/// en fazla sayı kadar. Saat: Biçen360 › Güncelleme hatırlatma saati.
/// </summary>
public class UygulamaGuncellemeGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<UygulamaGuncellemeGorevi> _kayit;

    public UygulamaGuncellemeGorevi(IServiceProvider saglayici, ILogger<UygulamaGuncellemeGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(3), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Uygulama güncelleme hatırlatması işlenemedi");
            }

            await Task.Delay(TimeSpan.FromMinutes(15), jeton);
        }
    }

    private async Task Calistir()
    {
        if (!Parametre.Acik("uygulama.hatirlatma")) return;

        var guncel = UygulamaSurumu.Normal(Parametre.Metin("uygulama.guncelSurum"));
        if (guncel.Length == 0) return;

        /* Belirlenen saatten sonra, akşam 20:00'ye kadar; 15 dakikalık
           çalışmalar arasında aynı kişiye ikinci kez gitmez (aralık kuralı) */
        var simdi = DateTime.Now;
        var saat = Parametre.Metin("uygulama.hatirlatmaSaati");
        if (!TimeSpan.TryParse(string.IsNullOrWhiteSpace(saat) ? "11:00" : saat, out var bas)) bas = TimeSpan.FromHours(11);
        if (simdi.TimeOfDay < bas || simdi.Hour >= 20) return;
        if (simdi.DayOfWeek == DayOfWeek.Sunday) return;

        var aralikGun = Math.Max(1, Parametre.Sayi("uygulama.hatirlatmaAraligi"));
        var enFazla = Math.Max(1, Parametre.Sayi("uygulama.hatirlatmaSayisi"));

        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();
        var ekip = kapsam.ServiceProvider.GetRequiredService<EkipServisi>();

        using var db = vt.Baglanti();

        var aktif = ekip.Aktifler()
            .Select(x => OkutmaBeklenmez.K(x.PersonelKodu))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var adaylar = db.Query(@"
SELECT personel_kodu AS kod, surum, hatirlatma_hedef AS hedef, hatirlatma_sayi AS sayi, son_hatirlatma AS son
FROM KRY_UYGULAMA_SURUM
WHERE son_gorulme >= DATEADD(day, -30, SYSDATETIME())")
            .Where(x => UygulamaSurumu.Eskimi((string)x.surum, guncel))
            .Where(x => aktif.Contains(OkutmaBeklenmez.K((string)x.kod)))
            .Where(x =>
            {
                var ayniHedef = (string)x.hedef == guncel;
                if (!ayniHedef) return true;
                if ((int)x.sayi >= enFazla) return false;
                return x.son is not DateTime s || s <= simdi.AddDays(-aralikGun).AddHours(2);
            })
            .Select(x => ((string)x.kod).Trim())
            .ToList();

        var gonderilen = 0;

        foreach (var kod in adaylar)
        {
            try
            {
                await UygulamaSurumu.Hatirlat(db, bildirim, kod, guncel, "Biçen360");
                gonderilen++;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Güncelleme hatırlatması gönderilemedi: {Kod}", kod);
            }
        }

        if (gonderilen > 0)
            _kayit.LogInformation("Uygulama güncelleme hatırlatması: {Adet} kişi ({Surum})", gonderilen, guncel);
    }
}

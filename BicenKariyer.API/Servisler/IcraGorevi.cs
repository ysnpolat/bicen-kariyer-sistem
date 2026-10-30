using Dapper;
using BicenKariyer.API.Controllers;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İcra takibi arka plan görevi (30.10.2026). Her 30 dakikada bir, 08–20
/// arasında:
/// <list type="bullet">
/// <item><b>Tebligat cevap süresi:</b> haciz ihbarnamesine (İİK 89/1)
/// tebliğden itibaren 7 gün (Yönetim'den ayarlanır) içinde cevap gerekir.
/// Cevabı yazılmamış dosyalar için 3 gün kala, 1 gün kala, son gün ve süre
/// geçince (bir kez) hukuk ekibine ve İK yöneticilerine zil bildirimi +
/// e-posta.</item>
/// <item><b>İşten ayrılış:</b> icrası açık personel Mikro'da ayrılmışsa
/// (çıkış tarihi gelmiş ya da pasif) dosyaya "personel ayrıldı" olayı
/// yazılır, zil bildirimi + e-posta gider; panelde hazır "işten ayrıldı"
/// yazısı sunulur. Her dosya için bir kez.</item>
/// </list>
/// Bildirim metinlerinde tutar yazılmaz; dosya numarası ve ad yeterlidir.
/// Günlüğe kişisel veri yazılmaz.
/// </summary>
public class IcraGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<IcraGorevi> _kayit;

    public IcraGorevi(IServiceProvider saglayici, ILogger<IcraGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(4), jeton);
        while (!jeton.IsCancellationRequested)
        {
            try { await Calis(); }
            catch (Exception h) { _kayit.LogWarning(h, "İcra görevi çalışmadı"); }
            await Task.Delay(TimeSpan.FromMinutes(30), jeton);
        }
    }

    /// <summary>Bildirim alacaklar: hukuk ekibi (rol hukuk) + Admin / İK yöneticisi / GMY panel kullanıcıları.</summary>
    private static List<string> Alicilar(System.Data.IDbConnection db)
    {
        var l = db.Query<string>("SELECT anahtar FROM KRY_HUK_EKIP WHERE rol = N'hukuk'").ToList();
        l.AddRange(db.Query<string>("SELECT N'u:' + kullanici_adi FROM KRY_KULLANICILAR WHERE aktif = 1 AND rol IN (N'Admin', N'IKYoneticisi', N'GenelMudurYardimcisi')"));
        return l.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static List<string> Epostalar(System.Data.IDbConnection db, IEnumerable<string> anahtarlar, AyarServisi ayar)
    {
        var l = new List<string>();
        var u = anahtarlar.Where(a => a.StartsWith("u:")).Select(a => a[2..]).ToArray();
        if (u.Length > 0)
            l.AddRange(db.Query<string>("SELECT eposta FROM KRY_KULLANICILAR WHERE kullanici_adi IN @u AND eposta IS NOT NULL AND eposta <> N''", new { u }));
        try { l.AddRange(ayar.MailOku()?.AliciAdresler ?? new List<string>()); } catch { /* ayar okunamazsa yalnız kullanıcı adresleri */ }
        return l.Where(x => x.Contains('@')).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private async Task Calis()
    {
        var simdi = DateTime.Now;
        if (simdi.Hour < 8 || simdi.Hour >= 20) return;

        using var kapsam = _saglayici.CreateScope();
        var sp = kapsam.ServiceProvider;
        var vt = sp.GetRequiredService<VeritabaniServisi>();
        var bildirim = sp.GetRequiredService<BildirimServisi>();
        var mail = sp.GetRequiredService<MailServisi>();
        var ayar = sp.GetRequiredService<AyarServisi>();
        var icra = sp.GetRequiredService<IcraServisi>();
        using var db = vt.Baglanti();
        if (db.ExecuteScalar<int?>("SELECT CASE WHEN OBJECT_ID('KRY_ICRA_DOSYA') IS NULL THEN 0 ELSE 1 END") != 1) return;

        var bugun = DateTime.Today;
        var alicilar = Alicilar(db);
        if (alicilar.Count == 0) return;
        var epostalar = Epostalar(db, alicilar, ayar);

        async Task Gonder(string baslik, string metin, string anahtar)
        {
            if (db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_ICRA_HATIRLATMA WHERE anahtar = @anahtar", new { anahtar }) > 0) return;
            db.Execute("INSERT INTO KRY_ICRA_HATIRLATMA (anahtar) VALUES (@anahtar)", new { anahtar });
            try { await HukukBildirim.Gonder(db, bildirim, alicilar, baslik, metin); }
            catch (Exception h) { _kayit.LogWarning(h, "İcra bildirimi gönderilemedi"); }
            if (epostalar.Count > 0)
            {
                try
                {
                    await mail.GonderAsync(epostalar, $"[Biçen Kariyer] {baslik}",
                        $"<p>{System.Net.WebUtility.HtmlEncode(metin)}</p><p style=\"color:#6f7484;font-size:12px\">Ayrıntı için İK paneli › Hukuk masası › İcra sekmesini açınız. Bu e-posta otomatik gönderilmiştir.</p>");
                }
                catch (Exception h) { _kayit.LogWarning(h, "İcra e-postası gönderilemedi"); }
            }
        }

        /* 1) Cevap süresi */
        var bekleyen = db.Query(@"
SELECT id, dosya_no, personel_ad, icra_dairesi, esas_no, cevap_suresi FROM KRY_ICRA_DOSYA
WHERE durum = N'acik' AND tur = N'icra' AND cevap_tarihi IS NULL AND cevap_suresi IS NOT NULL
  AND cevap_suresi >= DATEADD(DAY, -30, @bugun) AND cevap_suresi <= DATEADD(DAY, 3, @bugun)", new { bugun }).ToList();
        foreach (var d in bekleyen)
        {
            var kalan = (((DateTime)d.cevap_suresi).Date - bugun).Days;
            string ne, anahtar;
            if (kalan is 3 or 1) { ne = $"{kalan} gün kaldı"; anahtar = $"c{(int)d.id}-{kalan}"; }
            else if (kalan == 0) { ne = "son gün (bugün)"; anahtar = $"c{(int)d.id}-0"; }
            else if (kalan < 0) { ne = $"süre {-kalan} gün önce doldu"; anahtar = $"c{(int)d.id}-gecti"; }
            else continue;
            var metin = $"{(string)d.dosya_no} · {(string)d.personel_ad} · {(string)d.icra_dairesi} {(string)d.esas_no} · cevap süresi {(DateTime)d.cevap_suresi:dd.MM.yyyy}. Panelde hazır cevap yazısı var.";
            await Gonder($"Haciz ihbarnamesi cevabı · {ne}", metin, anahtar);
        }

        /* 2) İşten ayrılış */
        var acikSiciller = db.Query<string>("SELECT DISTINCT sicil FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND ayrilis_bildirildi IS NULL").ToList();
        foreach (var sicil in acikSiciller)
        {
            var p = icra.Personel(sicil);
            var ayrildi = p is null || p.Durum != 1 || (p.CikisTarihi is not null && p.CikisTarihi.Value.Date <= bugun);
            if (!ayrildi) continue;
            /* Personel listesi okunamadıysa (p null ve liste boş) yanlış bildirim gitmesin */
            if (p is null && !PersonelListesiVar(icra)) continue;

            var dosyalar = db.Query("SELECT id, dosya_no, personel_ad, icra_dairesi, esas_no FROM KRY_ICRA_DOSYA WHERE sicil = @sicil AND durum = N'acik' AND ayrilis_bildirildi IS NULL", new { sicil }).ToList();
            foreach (var d in dosyalar)
            {
                db.Execute("UPDATE KRY_ICRA_DOSYA SET ayrilis_bildirildi = SYSDATETIME(), guncelleme = SYSDATETIME() WHERE id = @id", new { id = (int)d.id });
                IcraServisi.OlayYaz(db, (int)d.id, "ayrilis", DateTime.Now, "Personel işten ayrıldı",
                    $"Çıkış tarihi {(p?.CikisTarihi?.ToString("dd.MM.yyyy") ?? "bordroda pasif")}. İcra dairesine ayrılış yazısı gönderilmeli; kesinti yapılamaz.", null, "sistem", "Sistem");
                var metin = $"{(string)d.dosya_no} · {(string)d.personel_ad} · {(string)d.icra_dairesi} {(string)d.esas_no}. Personel ayrıldı; icra dairesine hazır 'işten ayrıldı' yazısı panelde.";
                await Gonder("İcrası açık personel işten ayrıldı", metin, $"a{(int)d.id}");
            }
        }
    }

    private static bool PersonelListesiVar(IcraServisi icra)
    {
        try { return icra.Personel("__yok__") is null && icra.PersonelSayisi() > 0; }
        catch { return false; }
    }
}

using System.Collections.Concurrent;
using BicenKariyer.API.Controllers;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>Kritik okutma uyarısındaki satış birimi</summary>
public sealed record PatronKritikBirim(string Kod, string Ad, int Oran, int Okutmadi, string Mudur);

/// <summary>
/// Biçen360 patron bildirimleri (03.10.2026).
///
/// <para>
/// Dört bildirim var; her patron Biçen360 → Bildirim ayarları'ndan
/// açıp kapatıyor (<see cref="PatronBildirimAyari"/>):
/// <list type="bullet">
/// <item>Yeni onay talebi: onay kaydı oluşturulduğu an
/// (<see cref="OnayServisi.Olustur"/> buraya haber veriyor).</item>
/// <item>Etik hatta yeni bildirim: bildirim açıldığı an (EtikController).
/// Yalnızca sayılar; tür, açıklama, şube, bildiren asla.</item>
/// <item>Sabah özeti ve kritik okutma uyarısı: zamanlı, <see cref="PatronBildirimGorevi"/>.</item>
/// </list>
/// </para>
///
/// <para>
/// Anlık olanlar 20 saniye toplanıp tek bildirimde gidiyor: Mikro
/// senkronu ya da toplu norm değişikliği aynı anda birkaç onay
/// oluşturabiliyor; patronun telefonu art arda beş kez çalmasın. Bu kısa
/// pencerede uygulama yeniden başlarsa o toplu bildirim düşer (onay yine
/// listede ve Özet'te görünür).
/// </para>
///
/// <para>
/// Bildirim verisindeki <c>ekran</c> uygulamanın açacağı yer:
/// <c>patron-onaylar</c>, <c>patron-ozet</c>, <c>patron-sube:&lt;ad&gt;</c>,
/// <c>patron-sayfa:&lt;kod&gt;</c>, <c>patron-ik</c> (ek sözleşme 3).
/// </para>
/// </summary>
public class PatronBildirimServisi
{
    /// <summary>Anlık bildirimlerin toplanma süresi</summary>
    private static readonly TimeSpan ToplamaSuresi = TimeSpan.FromSeconds(20);

    private readonly IServiceScopeFactory _kapsamlar;
    private readonly VeritabaniServisi _vt;
    private readonly PatronServisi _patron;
    private readonly ILogger<PatronBildirimServisi> _kayit;

    private readonly Toplayici<(string Tur, string Baslik)> _onaylar;
    private readonly Toplayici<bool> _etikler;

    public PatronBildirimServisi(
        IServiceScopeFactory kapsamlar,
        VeritabaniServisi vt,
        PatronServisi patron,
        ILogger<PatronBildirimServisi> kayit)
    {
        _kapsamlar = kapsamlar;
        _vt = vt;
        _patron = patron;
        _kayit = kayit;

        _onaylar = new Toplayici<(string, string)>(OnaylariBildir, kayit);
        _etikler = new Toplayici<bool>(EtikleriBildir, kayit);
    }

    /* ==================================================================== */
    /* Anlık: onay ve etik                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Yeni onay kaydı oluştu. Hiçbir zaman hata fırlatmaz: onay kaydını
    /// bildirim yüzünden başarısız saymak olmaz.
    /// </summary>
    public void OnayOlustu(string tur, string baslik)
    {
        try
        {
            /* Patron ekranları yeni onayı 30 saniyelik önbelleği beklemeden görsün */
            PatronOnbellegi.Temizle("onay", "ozet");

            _onaylar.Ekle((tur, baslik));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron onay bildirimi sıraya alınamadı");
        }
    }

    /// <summary>Etik hatta yeni bildirim açıldı (içerik bilerek alınmıyor).</summary>
    public void EtikGeldi()
    {
        try
        {
            PatronOnbellegi.Temizle("etik", "ozet");

            _etikler.Ekle(true);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron etik bildirimi sıraya alınamadı");
        }
    }

    private async Task OnaylariBildir(List<(string Tur, string Baslik)> yeniler)
    {
        int bekleyen;

        using (var db = _vt.Baglanti())
        {
            bekleyen = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_ONAY WHERE durum = @d", new { d = OnayDurumu.Bekliyor });
        }

        /* Toplama süresinde karara bağlanmışsa haber vermeye gerek yok */
        if (bekleyen == 0) return;

        var (baslik, metin) = OnayMetni(yeniler, bekleyen);

        await PatronlaraGonder(a => a.Onay, baslik, metin, "patron-onaylar");
    }

    private async Task EtikleriBildir(List<bool> gelenler)
    {
        int yeni, acik;

        using (var db = _vt.Baglanti())
        {
            var sayi = db.QueryFirstOrDefault(@"
SELECT SUM(CASE WHEN durum = N'alindi' THEN 1 ELSE 0 END) AS yeni,
       SUM(CASE WHEN durum IN (N'alindi', N'inceleniyor', N'ek_bilgi') THEN 1 ELSE 0 END) AS acik
FROM KRY_ETIK");

            yeni = (int?)sayi?.yeni ?? 0;
            acik = (int?)sayi?.acik ?? 0;
        }

        var (baslik, metin) = EtikMetni(gelenler.Count, yeni, acik);

        await PatronlaraGonder(a => a.Etik, baslik, metin, "patron-ik");
    }

    /* ==================================================================== */
    /* Metinler (ayar sayfasındaki örnek bildirim de bunları kullanıyor)     */
    /* ==================================================================== */

    public static (string Baslik, string Metin) OnayMetni(
        IReadOnlyList<(string Tur, string Baslik)> yeniler, int bekleyen)
    {
        var toplam = bekleyen > 1 ? $" · toplam {bekleyen} onay bekliyor" : "";

        if (yeniler.Count == 1)
            return ($"Yeni onay talebi · {yeniler[0].Tur}", $"{yeniler[0].Baslik}{toplam}");

        var turler = string.Join(" · ", yeniler
            .GroupBy(x => x.Tur)
            .OrderByDescending(g => g.Count())
            .Select(g => $"{g.Count()} {g.Key}"));

        return ($"{yeniler.Count} yeni onay talebi", $"{turler}{toplam}");
    }

    /// <summary>Yalnızca sayılar: bildirimin türü bile kişiyi ele verebilir.</summary>
    public static (string Baslik, string Metin) EtikMetni(int gelen, int yeni, int acik) =>
        (gelen > 1 ? $"Etik hatta {gelen} yeni bildirim" : "Etik hatta yeni bildirim",
         $"İnceleme bekleyen {yeni} · açık {acik} bildirim. İçerik Etik Kurul ekranında.");

    public static (string Baslik, string Metin, string Ekran) KritikMetni(IReadOnlyList<PatronKritikBirim> birimler)
    {
        if (birimler.Count == 1)
        {
            var b = birimler[0];

            return ($"{b.Ad}: okutma %{b.Oran}",
                    $"{b.Okutmadi} kişi henüz okutmadı" + (string.IsNullOrWhiteSpace(b.Mudur) ? "" : $" · Md. {b.Mudur}"),
                    $"patron-sube:{b.Ad}");
        }

        var liste = string.Join(" · ", birimler.Take(4).Select(b => $"{b.Ad} %{b.Oran}"))
                    + (birimler.Count > 4 ? $" · +{birimler.Count - 4} birim" : "");

        return ($"{birimler.Count} birimde okutma %{PatronBildirimGorevi.KritikSinir}'in altında", liste, "patron-ozet");
    }

    /* ==================================================================== */
    /* Gönderim                                                              */
    /* ==================================================================== */

    /// <summary>
    /// Patronun bildirim jetonunun bağlı olduğu güncel sicil. Patron
    /// listesi kimlik numarasıyla da eşleşiyor (Mikro'da yeni koda geçen
    /// kişi yetkisini kaybetmesin); jeton ise uygulamaya girdiği güncel
    /// sicilde. Kimlikle çalışan bir kayıt bulunursa o, yoksa listedeki kod.
    /// </summary>
    public static string GuncelKod(PatronServisi.PatronKaydi p, IEnumerable<PersonelKaydi> personeller)
    {
        if (!string.IsNullOrWhiteSpace(p.Kimlik))
        {
            var kisi = personeller.FirstOrDefault(x =>
                x.Durum == 1 && string.Equals((x.KimlikNo ?? "").Trim(), p.Kimlik, StringComparison.Ordinal));

            if (kisi is not null && !string.IsNullOrWhiteSpace(kisi.PersonelKodu))
                return kisi.PersonelKodu.Trim();
        }

        return p.Kod;
    }

    /// <summary>Tercihi açık olan bütün patronlara aynı bildirim.</summary>
    public async Task PatronlaraGonder(
        Func<PatronBildirimAyari, bool> secim, string baslik, string metin, string ekran)
    {
        var patronlar = _patron.Aktifler().Where(x => secim(x.Ayar)).ToList();

        if (patronlar.Count == 0) return;

        using var kapsam = _kapsamlar.CreateScope();

        var personeller = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>().TumPersonelleriGetir();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();

        var kodlar = patronlar
            .Select(x => GuncelKod(x, personeller))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        await bildirim.TopluGonder(kodlar, baslik, metin, ekran);

        _kayit.LogInformation("Patron bildirimi ({Ekran}): {Adet} kişi · {Baslik}", ekran, kodlar.Count, baslik);
    }

    /// <summary>
    /// Bir kez gönderilecek bildirimi işaretler. true: bu çağrı işaretledi,
    /// gönderilebilir; false: daha önce gönderilmiş (ya da başka bir örnek
    /// aynı anda işaretledi). Birincil anahtar çakışması "zaten var"
    /// demek; tablo yoksa da false (tekrar riskine karşı hiç göndermemek
    /// daha iyi).
    /// </summary>
    public bool Isaretle(string anahtar)
    {
        try
        {
            using var db = _vt.Baglanti();

            return db.Execute(@"
INSERT INTO KRY_PATRON_BILDIRIM (anahtar)
SELECT @anahtar
WHERE NOT EXISTS (SELECT 1 FROM KRY_PATRON_BILDIRIM WITH (UPDLOCK, HOLDLOCK) WHERE anahtar = @anahtar)",
                new { anahtar }) == 1;
        }
        catch (Exception hata)
        {
            _kayit.LogDebug(hata, "Patron bildirimi işaretlenemedi: {Anahtar}", anahtar);
            return false;
        }
    }

    /// <summary>Verilen anahtarlardan daha önce işaretlenmiş olanlar.</summary>
    public HashSet<string> Isaretliler(IEnumerable<string> anahtarlar)
    {
        var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var liste = anahtarlar.Distinct().ToList();

        if (liste.Count == 0) return sonuc;

        using var db = _vt.Baglanti();

        foreach (var parca in liste.Chunk(1500))
            foreach (var a in db.Query<string>(
                         "SELECT anahtar FROM KRY_PATRON_BILDIRIM WHERE anahtar IN @parca", new { parca }))
                sonuc.Add(a);

        return sonuc;
    }

    /// <summary>İki haftadan eski işaretler siliniyor (günlük anahtarlar).</summary>
    public void EskileriSil()
    {
        try
        {
            using var db = _vt.Baglanti();
            db.Execute("DELETE FROM KRY_PATRON_BILDIRIM WHERE gonderim < DATEADD(day, -14, SYSDATETIME())");
        }
        catch (Exception hata)
        {
            _kayit.LogDebug(hata, "Eski patron bildirim işaretleri silinemedi");
        }
    }

    /* ==================================================================== */

    /// <summary>
    /// Kısa sürede gelen olayları toplayıp tek seferde işler. İlk olay
    /// süreyi başlatır; süre dolunca kuyruk boşaltılır. Bayrak kuyruktan
    /// ÖNCE indiriliyor: arada gelen olay ya bu boşaltmaya girer ya da
    /// yeni bir süre başlatır, hiçbiri kaybolmaz.
    /// </summary>
    private sealed class Toplayici<T>
    {
        private readonly ConcurrentQueue<T> _kuyruk = new();
        private readonly Func<List<T>, Task> _isle;
        private readonly ILogger _kayit;
        private int _bekliyor;

        public Toplayici(Func<List<T>, Task> isle, ILogger kayit)
        {
            _isle = isle;
            _kayit = kayit;
        }

        public void Ekle(T olay)
        {
            _kuyruk.Enqueue(olay);

            if (Interlocked.Exchange(ref _bekliyor, 1) == 0)
                _ = Task.Run(Bosalt);
        }

        private async Task Bosalt()
        {
            await Task.Delay(ToplamaSuresi);

            Interlocked.Exchange(ref _bekliyor, 0);

            var liste = new List<T>();
            while (_kuyruk.TryDequeue(out var x)) liste.Add(x);

            if (liste.Count == 0) return;

            try
            {
                await _isle(liste);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron bildirimi gönderilemedi");
            }
        }
    }
}

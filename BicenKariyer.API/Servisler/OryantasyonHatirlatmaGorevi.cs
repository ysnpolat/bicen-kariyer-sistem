using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Oryantasyon hatırlatmaları (uygulama bildirimi)
/// ---------------------------------------------------------------------------
/// Anketin açılış bildirimi gönderim anında gidiyor (UyumGonderimServisi).
/// Bu görev sonrasını takip ediyor:
///
/// <list type="bullet">
/// <item>Aşama başladı → personelin yöneticilerine "oryantasyon süresi gelen
/// personel var" (uygulamadan değerlendirecekleri için),</item>
/// <item>24 saat kala → personele "anketiniz için 24 saat kaldı" (yalnızca
/// uygulama kanalındakilere), yöneticiye "oryantasyon süresi azalıyor",</item>
/// <item>personel anketi bitirince → yöneticiye "oryantasyonunu tamamladı".</item>
/// </list>
///
/// <para>
/// Yöneticiler: Ekibim'de kişiyi görenler ve İK'nın Biçen360'ta
/// değerlendirmeyi açtığı yönetici (davet satırı, bkz.
/// <c>UyumGonderimServisi.YoneticiyeAc</c>). Davetle birlikte bildirim
/// almış yöneticiye "aşama başladı" ikinci kez gitmez.
/// </para>
///
/// <para>
/// Oryantasyon anketleri yalnızca Biçen360'tan doldurulur; SMS yok.
/// Görev ekranlarını taşıyan sürümü açmamış kişiye giden bildirime
/// güncelleme notu eklenir.
/// </para>
///
/// <para>
/// Her bildirim KRY_GOREV_BILDIRIM'e anahtarla yazılıyor; bir kez gidiyor.
/// 09:00–20:00 arası, yarım saatte bir bakıyor.
/// </para>
/// </summary>
public class OryantasyonHatirlatmaGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<OryantasyonHatirlatmaGorevi> _kayit;

    public OryantasyonHatirlatmaGorevi(IServiceProvider saglayici, ILogger<OryantasyonHatirlatmaGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(5), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                var saat = DateTime.Now.Hour;

                if (saat >= 9 && saat < 20) await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Oryantasyon hatırlatma görevi çalışamadı");
            }

            await Task.Delay(TimeSpan.FromMinutes(30), jeton);
        }
    }

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();
        var ekip = kapsam.ServiceProvider.GetRequiredService<EkipServisi>();
        var departman = kapsam.ServiceProvider.GetRequiredService<DepartmanServisi>();

        using var db = vt.Baglanti();

        /* Son 4 günde açılmış çalışan anketleri: açık olanlar ve son
           6 saatte doldurulanlar */
        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, asama, gecerlilik,
       dolduruldu, kanal, hatirlatma, olusturma
FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND test_mi = 0 AND personel_kodu IS NOT NULL
  AND olusturma >= DATEADD(DAY, -4, SYSDATETIME())").ToList();

        if (kayitlar.Count == 0) return;

        var degerlendirilen = Controllers.GorevController.YoneticiDegerlendirmeleri(db,
            kayitlar.Select(x => (string)x.asama).Distinct().ToList(),
            DateTime.Now.AddDays(-5));

        var simdi = DateTime.Now;

        /* İK'nın Biçen360'ta açtığı yönetici değerlendirmeleri: kişi|aşama →
           (yönetici, açılış). Bildirimi açılışta gittiği için son 12 saatte
           açılmış davetin yöneticisine "aşama başladı" ayrıca gitmez. */
        var davetler = new List<(string anahtar, string yonetici, DateTime acilis)>();

        try
        {
            davetler = db.Query(@"
SELECT personel_kodu AS kod, asama, yonetici_kodu AS yonetici, olusturma
FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND kanal = 'uygulama'
  AND personel_kodu IS NOT NULL AND yonetici_kodu IS NOT NULL
  AND dolduruldu IS NULL AND gecerlilik > SYSDATETIME()")
                .Select(x => ($"{K((string)x.kod)}|{(string)x.asama}", ((string)x.yonetici).Trim(), (DateTime)x.olusturma))
                .ToList();
        }
        catch
        {
            /* Kolon yoksa yalnızca Ekibim yöneticileri */
        }

        foreach (var r in kayitlar)
        {
            int id = r.id;
            string kod = ((string)r.kod).Trim();
            string asama = r.asama;
            string ad = r.adSoyad;
            DateTime son = r.gecerlilik;
            var asamaAdi = UyumGonderimServisi.AsamaAdi.GetValueOrDefault(asama, asama);
            var yoneticiBekliyor = !degerlendirilen.Contains($"{K(kod)}|{asama}");

            var davetAnahtari = $"{K(kod)}|{asama}";

            /* 13.10.2026: aynı aşamanın başka bir satırı bu satırdan sonra
               doldurulduysa bu satır için "doldurmadı" hatırlatması gitmez */
            DateTime satirAcilis = r.olusturma;

            if (r.dolduruldu is null && kayitlar.Any(y =>
                    (int)y.id != id && y.dolduruldu != null && (DateTime)y.dolduruldu >= satirAcilis
                    && K((string)y.kod) == K(kod) && (string)y.asama == asama))
                continue;

            List<string> yoneticiler = null;
            List<string> Yoneticiler() => yoneticiler ??= MazeretBelgeGorevi.Yoneticileri(ekip, departman, kod)
                .Concat(davetler.Where(x => x.anahtar == davetAnahtari).Select(x => x.yonetici))
                .GroupBy(K)
                .Select(g => g.First())
                .ToList();

            /* Davetiyle birlikte yeni bildirim almış yöneticiler */
            var yeniDavetli = davetler
                .Where(x => x.anahtar == davetAnahtari && x.acilis >= simdi.AddHours(-12))
                .Select(x => K(x.yonetici))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            /* Tamamlandı: son 6 saatte doldurduysa yöneticiye haber */
            if (r.dolduruldu is DateTime d)
            {
                if (d >= simdi.AddHours(-6) && MazeretBelgeGorevi.BirKez(db, $"orytamam|{id}"))
                    await bildirim.TopluGonder(Yoneticiler(), $"{ad} oryantasyonunu tamamladı",
                        yoneticiBekliyor && son > simdi
                            ? $"{asamaAdi} anketi doldu. Sizin değerlendirmeniz de bekleniyor."
                            : $"{asamaAdi} anketi İK'ya iletildi.",
                        "ekibim");

                if (!yoneticiBekliyor || son <= simdi) continue;
            }

            if (son <= simdi) continue;

            /* Aşama başladı: yöneticiye bir kez */
            if (yoneticiBekliyor && MazeretBelgeGorevi.BirKez(db, $"orybasla|{id}"))
                await bildirim.TopluGonder(Yoneticiler().Where(x => !yeniDavetli.Contains(K(x))),
                    "Oryantasyon süresi gelen personel var",
                    $"{ad} · {asamaAdi}. Sizin değerlendirmeniz de bekleniyor.", "ekibim");

            if (son - simdi > TimeSpan.FromHours(24)) continue;

            /* 24 saat kala: personel (Biçen360 kanalındaki anketler; eski SMS
               kayıtları hariç) */
            if (r.dolduruldu is null && (string)r.kanal == "uygulama" && r.hatirlatma is null)
            {
                db.Execute("UPDATE KRY_UYUM_ANKET SET hatirlatma = SYSDATETIME() WHERE id = @id", new { id });

                await bildirim.Gonder(kod, "Anketiniz için 24 saat kaldı",
                    $"{asamaAdi} oryantasyon anketinizi tamamlamayı unutmayın."
                    + (UyumGonderimServisi.YeniSurumuAcmis(db, kod) ? "" : UyumGonderimServisi.GuncellemeNotu),
                    "anasayfa");
            }

            /* 24 saat kala: yönetici */
            if ((r.dolduruldu is null || yoneticiBekliyor) && MazeretBelgeGorevi.BirKez(db, $"oryazal|{id}"))
            {
                var metin = r.dolduruldu is null
                    ? $"{ad} henüz anketini doldurmadı · 24 saat kaldı."
                    : $"{ad} için değerlendirmeniz bekleniyor · 24 saat kaldı.";

                if (r.dolduruldu is null && yoneticiBekliyor)
                    metin += " Sizin değerlendirmeniz de bekleniyor.";

                await bildirim.TopluGonder(Yoneticiler(), "Oryantasyon süresi azalıyor", metin, "ekibim");
            }
        }
    }
}

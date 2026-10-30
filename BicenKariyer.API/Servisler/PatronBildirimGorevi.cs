using System.Globalization;
using BicenKariyer.API.Controllers;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Biçen360 patron bildirimlerinin zamanlı olanları (03.10.2026).
///
/// <para>
/// Dakikada bir uyanıyor:
/// <list type="bullet">
/// <item><b>Sabah özeti</b>: tercihi açık her patrona, seçtiği saatte
/// (varsayılan 08:30) bir kez. Saat geçtikten sonraki üç saat içinde
/// gönderiliyor: sunucu 08:25'te yeniden başladıysa özet yine gider, ama
/// öğleden sonra "günaydın" gelmez.</item>
/// <item><b>Kritik okutma</b>: 10:30'dan sonra bir satış biriminde okutma
/// oranı %70'in altındaysa, birim başına günde bir kez. Sabah erken saatte
/// öğle vardiyası henüz gelmediği için her birim düşük görünür (Özet'teki
/// "dikkat" uyarısıyla aynı gerekçe). Akşam 19:00'dan sonra uyarı
/// gönderilmiyor: o saatte yapılacak bir şey yok, gece bildirim rahatsız
/// eder. Okutma hesabı ağır olduğu için beş dakikada bir bakılıyor.</item>
/// </list>
/// </para>
///
/// <para>
/// Gönderilenler KRY_PATRON_BILDIRIM'e anahtarla yazılıyor
/// (<c>sabah|&lt;patron&gt;|&lt;gün&gt;</c>, <c>kritik|&lt;birim&gt;|&lt;gün&gt;</c>);
/// yazma birincil anahtarla tek seferlik. Uygulama yeniden başlasa ya da
/// IIS geri dönüşümünde iki örnek aynı anda çalışsa da aynı bildirim iki
/// kez gitmiyor. İşaret gönderimden önce konuyor: bildirim servisi hata
/// verirse o bildirim tekrar denenmez (iki kez gitmesindense hiç gitmemesi
/// tercih edildi).
/// </para>
///
/// <para>
/// Sayılar patron ekranlarıyla aynı kaynaktan: PatronMobilController'ın
/// hesapları (30 saniyelik paylaşılan önbellek dahil) bir kapsam içinde
/// kurulan örnekle çağrılıyor. Bildirimdeki sayı ile uygulamayı açınca
/// görülen sayı ayrışmasın.
/// </para>
/// </summary>
public class PatronBildirimGorevi : BackgroundService
{
    /// <summary>Kritik okutma sınırı (%)</summary>
    public static int KritikSinir => Parametre.Sayi("okutma.kritikSinir");

    /// <summary>Kritik uyarının başladığı ve bittiği saatler</summary>
    private static readonly TimeSpan KritikBaslangic = new(10, 30, 0);
    private static readonly TimeSpan KritikBitis = new(19, 0, 0);

    private static readonly TimeSpan KritikAraligi = TimeSpan.FromMinutes(5);

    /// <summary>Sabah özeti saatinden sonra bu kadar içinde gönderilir</summary>
    private static readonly TimeSpan SabahPenceresi = TimeSpan.FromHours(3);

    private readonly IServiceProvider _saglayici;
    private readonly ILogger<PatronBildirimGorevi> _kayit;

    private DateTime _sonKritik = DateTime.MinValue;
    private DateTime _sonTemizlik = DateTime.MinValue;

    public PatronBildirimGorevi(IServiceProvider saglayici, ILogger<PatronBildirimGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu ve Mikro önbelleği sürüyor olabilir */
        await Task.Delay(TimeSpan.FromMinutes(2), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Patron bildirimleri işlenemedi");
            }

            /* Bir sonraki dakikanın başına */
            var bekle = TimeSpan.FromSeconds(60 - DateTime.Now.Second);
            await Task.Delay(bekle, jeton);
        }
    }

    private async Task Calistir()
    {
        var servis = _saglayici.GetRequiredService<PatronBildirimServisi>();
        var patronlar = _saglayici.GetRequiredService<PatronServisi>().Aktifler();

        var simdi = DateTime.Now;
        var gun = simdi.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        if (simdi - _sonTemizlik > TimeSpan.FromHours(12))
        {
            _sonTemizlik = simdi;
            servis.EskileriSil();
        }

        if (patronlar.Count == 0) return;

        using var kapsam = _saglayici.CreateScope();

        /* Hesaplar patron ekranlarındakiyle aynı: kapsam içinde kurulan
           controller, HTTP isteği olmadan (yalnızca okuma yöntemleri) */
        PatronMobilController hesap = null;
        PatronMobilController Hesap() =>
            hesap ??= ActivatorUtilities.CreateInstance<PatronMobilController>(kapsam.ServiceProvider);

        /* ---------------------------------------------------- sabah özeti */
        var sabahcilar = patronlar
            .Where(p => p.Ayar.Sabah
                        && PatronBildirimAyari.SaatCoz(p.Ayar.SabahSaat) is TimeSpan saat
                        && simdi.TimeOfDay >= saat
                        && simdi.TimeOfDay < saat + SabahPenceresi)
            .ToList();

        if (sabahcilar.Count > 0)
        {
            string Anahtar(PatronServisi.PatronKaydi p) => $"sabah|{p.Kod}|{gun}";

            var gonderilmis = servis.Isaretliler(sabahcilar.Select(Anahtar));
            var bekleyenler = sabahcilar.Where(p => !gonderilmis.Contains(Anahtar(p))).ToList();

            if (bekleyenler.Count > 0)
            {
                /* Önce özet: hesap hata verirse işaret konmuyor, bir sonraki
                   dakika yeniden deneniyor */
                var (baslik, metin) = Hesap().SabahOzeti();

                var personeller = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>().TumPersonelleriGetir();
                var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();

                foreach (var p in bekleyenler)
                {
                    if (!servis.Isaretle(Anahtar(p))) continue;

                    await bildirim.Gonder(PatronBildirimServisi.GuncelKod(p, personeller), baslik, metin, "patron-ozet");

                    _kayit.LogInformation("Patron sabah özeti gönderildi: {Kod}", p.Kod);
                }
            }
        }

        /* ------------------------------------------------- kritik okutma */
        if (simdi.TimeOfDay >= KritikBaslangic && simdi.TimeOfDay < KritikBitis
            && simdi - _sonKritik >= KritikAraligi
            && patronlar.Any(p => p.Ayar.Kritik))
        {
            _sonKritik = simdi;

            var birimler = Hesap().KritikBirimler(KritikSinir);

            /* Birim başına günde bir kez; o gün daha önce uyarılmış birim
               bu turda yeniden düşük görünse de tekrar gitmiyor */
            var yeniler = birimler
                .Where(b => servis.Isaretle($"kritik|{b.Kod}|{gun}"))
                .ToList();

            if (yeniler.Count > 0)
            {
                var (baslik, metin, ekran) = PatronBildirimServisi.KritikMetni(yeniler);

                await servis.PatronlaraGonder(a => a.Kritik, baslik, metin, ekran);
            }
        }
    }
}

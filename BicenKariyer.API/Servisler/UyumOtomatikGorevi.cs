using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe uyum anketinin günlük otomatik gönderimi.
///
/// <para>
/// Yönetim → Form Ayarları'nda aşama başına açılıp kapatılır
/// (<c>FormAyarlari.UyumOtomatik</c>). Açık aşamalarda, o gün pencereye
/// giren personelin anketi Biçen360'ta açılır, birimin yöneticisinde
/// (mağaza müdürü ya da mağaza müdürü için bölge müdürü) değerlendirme
/// açılır ve yönetici başına tek bildirim gider. Elle gönderimle aynı
/// kayıt ve bildirim yolu kullanılır; SMS gitmez. Daha önce gönderilmiş
/// kişiye ikinci kez gitmez, o yüzden panelden gönderilenle çakışmaz.
/// </para>
///
/// <para>
/// Saatte bir bakar, gönderimi yalnızca 09:00–18:00 arasında yapar; gece
/// bildirim gitmesin.
/// </para>
/// </summary>
public class UyumOtomatikGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<UyumOtomatikGorevi> _kayit;

    public UyumOtomatikGorevi(IServiceProvider saglayici, ILogger<UyumOtomatikGorevi> kayit)
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
                var saat = DateTime.Now.Hour;

                if (saat >= 9 && saat < 18) await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Otomatik uyum anketi gönderilemedi");
            }

            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var saglayici = kapsam.ServiceProvider;
        var vt = saglayici.GetRequiredService<VeritabaniServisi>();
        var ayar = saglayici.GetRequiredService<AyarServisi>();
        var kaynak = saglayici.GetRequiredService<PersonelKaynagiServisi>();
        var gonderim = saglayici.GetRequiredService<UyumGonderimServisi>();

        var formAyari = ayar.FormOku();
        var aralik = UyumGonderimServisi.Pencereler(formAyari);

        var acikAsamalar = (formAyari.UyumOtomatik ?? new())
            .Where(x => x.Value && aralik.ContainsKey(x.Key))
            .Select(x => x.Key)
            .ToList();

        if (acikAsamalar.Count == 0) return;

        /* SMS servisine bakılmaz: anket Biçen360'tan doldurulur. */

        List<PersonelKaydi> personeller;

        try
        {
            personeller = kaynak.TumPersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Otomatik gönderim için personel alınamadı");
            return;
        }

        var calisanlar = personeller
            .Where(x => x.Durum == 1 && x.GirisTarihi is not null
                        && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .ToList();

        using var db = vt.Baglanti();

        foreach (var asama in acikAsamalar)
        {
            var (enAz, enFazla) = aralik[asama];

            /* Pencerenin ilk gününde gönderilir; 7. gün ve 2. ay tek
               günlük olduğu için tam o gün demek. Daha önce gönderilmiş
               olan (elle ya da otomatik) atlanır. */
            var adaylar = calisanlar
                .Where(x =>
                {
                    var gun = UyumAnaliz.KacinciGun(x.GirisTarihi!.Value);

                    return gun >= enAz && gun <= enFazla;
                })
                .ToList();

            if (adaylar.Count == 0) continue;

            var gonderilmis = db.Query<string>(@"
SELECT personel_kodu FROM KRY_UYUM_ANKET
WHERE asama = @asama AND tur = 'calisan' AND test_mi = 0
  AND personel_kodu IS NOT NULL", new { asama })
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var basarili = new List<PersonelKaydi>();

            foreach (var kisi in adaylar)
            {
                if (gonderilmis.Contains(kisi.PersonelKodu.Trim())) continue;

                try
                {
                    var sonuc = await gonderim.CalisanaGonder(db, asama, kisi.PersonelKodu.Trim(),
                                                              $"{kisi.Ad} {kisi.Soyad}".Trim(), kisi.Sube,
                                                              kisi.Pozisyon, kisi.Telefon, kisi.GirisTarihi,
                                                              "otomatik");

                    if (sonuc.Basarili)
                    {
                        basarili.Add(kisi);

                        if (sonuc.GirisYok)
                            _kayit.LogInformation(
                                "Otomatik uyum: {Kod} Biçen360'a giriş yapmamış; anket açıldı, bildirim gitmedi",
                                kisi.PersonelKodu);
                    }
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Otomatik uyum gönderimi başarısız: {Kod}",
                        kisi.PersonelKodu);
                }
            }

            /* Yöneticiler: değerlendirme Biçen360'ta açılır, yönetici başına
               tek bildirim; aynı yöneticiye aynı aşama için günde bir kez
               (elle gönderimle aynı kural) */
            if (basarili.Count > 0)
            {
                try
                {
                    var y = await gonderim.YoneticiyeAc(db, asama, basarili, personeller,
                                                        "otomatik", "oryyonetici");

                    foreach (var ad in y.Bulunamayan)
                        _kayit.LogInformation("Otomatik uyum: {Ad} için yönetici Biçen360'ta bulunamadı", ad);
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Otomatik yönetici bildirimi başarısız: {Asama}", asama);
                }
            }

            if (basarili.Count > 0)
                _kayit.LogInformation("Otomatik uyum anketi: {Asama} için {Adet} kişiye gönderildi",
                    asama, basarili.Count);
        }
    }
}

using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Ayrılan personel kart bağlantılarının süre ve bakiye denetimi (02.10.2026).
///
/// <para>
/// Saatte bir çalışıyor:
/// <list type="number">
/// <item>Süresi dolan bağlantıyı işaretliyor. Sayfa zaten süre dolunca kart
/// numarasını göstermiyor (API denetliyor); burada kart tarafı da
/// kapatılıyor: kişinin bağlantıdan belirlediği şifre kimsenin bilmediği
/// rastgele dört haneye çevriliyor. Kasada puan harcaması kart şifresiyle
/// onaylandığı için numarayı ya da indirdiği görseli bilse bile harcama
/// yapılamıyor. Bakiye SİLİNMİYOR; İK panelden süreyi uzatabilir (kişi
/// TC ile yeni şifre belirler), bakiyeyi silebilir ya da kartı boşa
/// çıkarabilir.</item>
/// <item>Bakiyesi biten bağlantıda da şifre aynı şekilde kilitleniyor:
/// sonradan karta yanlışlıkla puan yüklenirse (aylık toplu yükleme) ayrılmış
/// kişi kullanamasın.</item>
/// <item>Yeni süresi dolanlar için İK'ya (Admin, İK uzmanı, İK yöneticisi)
/// tek bir panel bildirimi.</item>
/// </list>
/// Kart başka bir personele geçmişse ya da kişi yeniden işe girmişse karta
/// dokunulmuyor. "Çalışan" türündeki bağlantılarda (kişi hâlâ çalışıyor,
/// kartı Biçen360'ta) kart şifresine hiç dokunulmuyor; süre dolunca yalnızca
/// bağlantı kapanıyor.
/// </para>
/// </summary>
public class KartAyrilanGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<KartAyrilanGorevi> _kayit;

    public KartAyrilanGorevi(IServiceProvider saglayici, ILogger<KartAyrilanGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu ve Mikro önbelleği sürüyor olabilir */
        await Task.Delay(TimeSpan.FromMinutes(4), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Ayrılan personel kart bağlantıları denetlenemedi");
            }

            /* 27.10.2026: işten ayrılanlara bağlantı SMS'i kendiliğinden */
            try
            {
                await OtomatikGonder();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Ayrılan personele otomatik kart bağlantısı gönderilemedi");
            }

            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private const string AYR = KartAyrilan.TABLO;

    private async Task OtomatikGonder()
    {
        using var kapsam = _saglayici.CreateScope();
        var sp = kapsam.ServiceProvider;

        var kart = ActivatorUtilities.CreateInstance<BicenKariyer.API.Controllers.BicenKartController>(sp);
        kart.ControllerContext = new Microsoft.AspNetCore.Mvc.ControllerContext
        {
            HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext
            {
                RequestServices = sp,
                User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                    new[] { new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, "Sistem (otomatik)") }, "sistem")),
            },
        };

        var (g, a, h) = await kart.OtomatikAyrilanaGonder();
        if (g + h > 0)
            _kayit.LogInformation("Ayrılan personele otomatik kart bağlantısı: {G} SMS, {A} atlandı, {H} hata", g, a, h);
    }

    private void Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        var etkin = db.Query<KartAyrilanSatiri>(
                $"SELECT {KartAyrilan.SUTUNLAR} FROM {AYR} WHERE iptal = 0 AND birakildi IS NULL")
            .ToList();

        if (etkin.Count == 0) return;

        var simdi = DateTime.Now;

        /* Yeniden işe girenler: aynı sicil ya da aynı TC ile çalışan kayıt */
        HashSet<string> calisanSicil = null, calisanTc = null;
        var sicilTc = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            var tumu = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>().TumPersonelleriGetir();

            var calisan = tumu.Where(x => x.Durum == 1 && !(x.CikisTarihi is DateTime c && c.Date <= DateTime.Today)).ToList();

            calisanSicil = calisan.Select(x => (x.PersonelKodu ?? "").Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            calisanTc = calisan.Select(x => KartAyrilan.KimlikNormal(x.KimlikNo)).Where(x => x is not null).ToHashSet();

            foreach (var x in tumu)
            {
                var tc = KartAyrilan.KimlikNormal(x.KimlikNo);
                if (tc is not null) sicilTc[(x.PersonelKodu ?? "").Trim()] = tc;
            }
        }
        catch (Exception hata)
        {
            /* Personel listesi yoksa karta dokunulmuyor: yeniden işe girmiş
               birinin şifresini bozmak, bir tur beklemekten kötü. */
            _kayit.LogWarning(hata, "Kart bağlantı görevi: personel listesi okunamadı; şifre kilidi bu tur yapılmıyor");
        }

        using var pos = vt.PosBaglantisi();

        /* Süresi içindekilerin bakiyesi ve kullanımı (tamamlandı işareti) */
        var surede = etkin.Where(x => x.SonGecerlilik >= simdi).ToList();

        try
        {
            KartAyrilanTazeleme.Tazele(db, pos, surede, simdi);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bağlantı görevi: bakiyeler okunamadı");
            surede.Clear();
        }

        var yeniDolan = 0;
        var kilitlenen = 0;

        foreach (var b in etkin)
        {
            var doldu = b.SonGecerlilik < simdi;
            var bitti = !doldu && b.Tamamlandi is not null;

            if (doldu && b.SuresiDoldu is null)
            {
                db.Execute($"UPDATE {AYR} SET suresi_doldu = SYSDATETIME() WHERE id = @id", new { id = b.Id });
                KartAyrilan.OlayYaz(db, b.Id, "suresi_doldu", $"Bağlantının süresi doldu ({b.SonGecerlilik:dd.MM.yyyy HH:mm})", "sistem");

                /* İK bildirimi şifre kilidiyle ilgili: yalnızca ayrılanlar sayılır */
                if (!b.Calisan) yeniDolan++;
            }

            if (!doldu && !bitti) continue;

            /* Çalışan personel kartını Biçen360'ta kullanıyor: süre dolunca ya
               da bakiye bitince yalnızca bağlantı kapanır (API), kart şifresine
               dokunulmaz, hiçbir şey boşa çıkarılmaz. */
            if (b.Calisan) continue;

            /* Kişinin bildiği şifre zaten kilitlenmişse yeniden yazılmıyor */
            var kilitli = b.SifreGecersiz is not null && (b.SifreTarihi is null || b.SifreTarihi <= b.SifreGecersiz);

            if (kilitli || calisanSicil is null) continue;

            if (calisanSicil.Contains((b.PersonelKodu ?? "").Trim()))
                continue;

            if (!KartAyrilan.KartKisininMi(db, b.KartNo, b.PersonelKodu))
                continue;

            /* Aynı TC ile başka sicilde yeniden işe girmiş: TC tabloda yok,
               personel kaydından bakılıyor */
            if (sicilTc.TryGetValue((b.PersonelKodu ?? "").Trim(), out var kisiTc) && calisanTc.Contains(kisiTc))
                continue;

            try
            {
                var (tamam, hata) = KartAyrilan.SifreyiKilitle(pos, b.KartNo.Trim(), _kayit);

                if (tamam)
                {
                    db.Execute($"UPDATE {AYR} SET sifre_gecersiz = SYSDATETIME() WHERE id = @id", new { id = b.Id });

                    KartAyrilan.OlayYaz(db, b.Id, "sifre_kilit",
                        doldu
                            ? "Süre doldu: kart şifresi rastgeleye çevrildi (bakiye kartta duruyor)"
                            : "Bakiye bitti: kart şifresi rastgeleye çevrildi",
                        "sistem");

                    kilitlenen++;
                }
                else
                {
                    KartAyrilan.OlayYaz(db, b.Id, "sifre_kilit_hata", "Kart şifresi değiştirilemedi: " + hata, "sistem");
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Kart bağlantı görevi: şifre kilitlenemedi ({Id})", b.Id);
            }
        }

        if (kilitlenen > 0 || yeniDolan > 0)
            _kayit.LogInformation("Ayrılan personel kartları: {Dolan} bağlantının süresi doldu, {Kilit} kartta şifre kilitlendi",
                yeniDolan, kilitlenen);

        if (yeniDolan > 0) IkBildir(db, yeniDolan);
    }

    private void IkBildir(System.Data.IDbConnection db, int adet)
    {
        try
        {
            var kullanicilar = db.Query<string>(@"
SELECT kullanici_adi FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN (N'Admin', N'IK', N'IKYoneticisi')").ToList();

            foreach (var k in kullanicilar)
                db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin) VALUES (@k, N'kart_ayrilan', @baslik, @metin)",
                    new
                    {
                        k,
                        baslik = $"{adet} kişinin kart süresi doldu",
                        metin = $"Ayrılan personele gönderilen Biçen Kart bağlantılarından {adet} tanesinin süresi doldu. "
                              + "Kart şifreleri kilitlendi; bakiyeler kartta duruyor. Biçen Kart › Ayrılan Personel "
                              + "sayfasından süreyi uzatabilir, bakiyeyi silebilir ya da kartı boşa çıkarabilirsiniz.",
                    });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart süresi bildirimi yazılamadı");
        }
    }
}

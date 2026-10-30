using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Dönemsel değerlendirme bildirimleri: dönem açıldığında, hatırlatma
/// günlerinde ve son gün, değerlendirmesi biten olmayan müdürlere push
/// gönderir. Gönderilenler KRY_DD_BILDIRIM'de (dönem + anahtar) tutulur;
/// her biri bir kez gider. Saat 09:00'dan önce gönderilmez.
/// </summary>
public class DonemselDegerlendirmeGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<DonemselDegerlendirmeGorevi> _kayit;

    public DonemselDegerlendirmeGorevi(IServiceProvider saglayici, ILogger<DonemselDegerlendirmeGorevi> kayit)
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
            catch (Exception hata) { _kayit.LogWarning(hata, "Dönemsel değerlendirme bildirimi gönderilemedi"); }
            await Task.Delay(TimeSpan.FromMinutes(30), jeton);
        }
    }

    private async Task Calis()
    {
        if (DateTime.Now.Hour < 9 || DateTime.Now.Hour >= 21) return;

        using var kapsam = _saglayici.CreateScope();
        var dd = kapsam.ServiceProvider.GetRequiredService<DonemselDegerlendirmeServisi>();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();

        var donem = dd.AcikDonem();
        if (donem is null) return;
        var ayar = dd.AyarOku();
        var bugun = DateTime.Today;

        string anahtar = null;
        if (bugun == donem.Bit && donem.Bit > donem.Bas) anahtar = "songun";
        else
        {
            var gun = ayar.HatirlatmaGunleri.Where(g => g > 1 && donem.Bas.AddDays(g - 1) <= bugun).DefaultIfEmpty(0).Max();
            anahtar = gun > 0 ? $"hatirlat-{gun}" : "baslangic";
        }

        using var db = vt.Baglanti();
        var gonderildi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_DD_BILDIRIM WHERE donem = @d AND anahtar = @a", new { d = donem.Kod, a = anahtar }) > 0;
        if (gonderildi) return;

        /* Başlangıç bildirimi gitmeden hatırlatma gitmesin: dönem ortasında
           açıldıysa ilk mesaj "başladı" olsun. */
        if (anahtar != "baslangic" && db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_DD_BILDIRIM WHERE donem = @d AND anahtar = N'baslangic'", new { d = donem.Kod }) == 0)
            anahtar = "baslangic";

        var yapilanlar = db.Query<string>("SELECT personel_kodu FROM KRY_DD_DEGERLENDIRME WHERE donem = @d", new { d = donem.Kod })
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var liste = new List<(string, string, string)>();
        var ust = dd.UstKademeAtamalari(ayar);
        foreach (var m in dd.Degerlendirenler())
        {
            /* Şube ekibi + üst kademeler (bölge müdürü → mağaza müdürleri, depo müdürü → depo …) */
            var mk = DonemselDegerlendirmeServisi.K(m.PersonelKodu);
            var ekip = (dd.SubeDegerlendiricisiMi(m, ayar) ? dd.SubeEkibi(m.IsGrubu, ayar, m) : new List<PersonelKaydi>())
                .Concat(ust.Where(x => x.Degerlendirenler.Contains(mk)).Select(x => x.Kisi))
                .GroupBy(x => DonemselDegerlendirmeServisi.K(x.PersonelKodu)).Select(x => x.First()).ToList();
            var kalan = ekip.Count(x => !yapilanlar.Contains(DonemselDegerlendirmeServisi.K(x.PersonelKodu)));
            if (kalan == 0) continue;

            var metin = anahtar switch
            {
                "baslangic" => $"{donem.Ad} değerlendirmesi başladı. Ekibinizden {kalan} kişiyi {donem.Bit:dd.MM} tarihine kadar değerlendiriniz.",
                "songun" => $"Bugün son gün: {kalan} kişinin {donem.Ad} değerlendirmesi bekleniyor.",
                _ => $"{kalan} kişinin {donem.Ad} değerlendirmesi bekleniyor · son gün {donem.Bit:dd.MM}.",
            };
            liste.Add((m.PersonelKodu.Trim(), "Ekibini değerlendir", metin));
        }

        db.Execute("INSERT INTO KRY_DD_BILDIRIM (donem, anahtar) VALUES (@d, @a)", new { d = donem.Kod, a = anahtar });
        if (liste.Count > 0) await bildirim.KisiyeOzelGonder(liste, "ekipdegerlendirme");
        _kayit.LogInformation("Dönemsel değerlendirme bildirimi {Anahtar}: {Adet} kişi", anahtar, liste.Count);
    }
}

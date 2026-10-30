using System.Globalization;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Performans ölçütü bildirimleri.
///
/// <para>
/// Saatte bir son değerlendirme dönemi okunuyor; her personelin her
/// ölçütü için durum (aldı / almadı / az kaldı) bir önceki durumla
/// karşılaştırılıyor. Yalnızca değişen ölçüt için bildirim gidiyor:
/// <list type="bullet">
/// <item>puan kazanıldı: "Ciro ölçütünden puan aldınız, 30 puan eklendi"</item>
/// <item>puan kaybedildi: "Manav firesinde puan kaybedildi"</item>
/// <item>az kaldı: "Et firesinde puana az kaldı, geçerseniz 5 puan"</item>
/// </list>
/// Dönemin ilk hesabında bildirim gönderilmiyor, yalnızca durum
/// kaydediliyor: yeni ay açıldığında herkese toplu bildirim gitmesin.
/// </para>
/// </summary>
public class PerformansBildirimGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<PerformansBildirimGorevi> _kayit;

    private static readonly string[] Olcutler =
    {
        "CİRO", "KARLILIK", "MÜŞTERİ SAYISI", "KİŞİ BAŞI CİRO",
        "TURNOVER", "ÜRÜN YOK SATMA", "GİDER ORANI", "İADE",
        "FİYAT FARKLARI", "KALİTE & HİJYEN",
        "ET FİRE", "BEYAZ ET FİRE", "MANAV FİRE", "TADOLYA FİRE",
        "KASA AÇIKLARI", "MAL KABUL HATASI",
        "FİŞ İPTAL SAYILARI", "SATIR İPTAL SAYILARI",
    };

    public PerformansBildirimGorevi(IServiceProvider saglayici, ILogger<PerformansBildirimGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta bekleme: kurulum ve diğer görevler önce bitsin */
        await Task.Delay(TimeSpan.FromMinutes(7), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Performans bildirimleri hesaplanamadı");
            }

            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    private static string Baslik(string ad) => Tr.TextInfo.ToTitleCase(ad.ToLower(Tr));

    private static string Sayi(decimal? d) =>
        d is null ? "" : d.Value.ToString(Math.Abs(d.Value) < 1 ? "0.####" : "0.##", Tr);

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();
        var s = kapsam.ServiceProvider;

        var vt = s.GetRequiredService<VeritabaniServisi>();
        var kaynak = s.GetRequiredService<PersonelKaynagiServisi>();
        var bildirim = s.GetRequiredService<BildirimServisi>();
        var olcutServisi = s.GetRequiredService<PerformansOlcutServisi>();

        using var pdb = vt.PerformansBaglantisi();

        var donem = pdb.QueryFirstOrDefault(@"
SELECT TOP 1 yil, ay FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari
ORDER BY yil DESC, ay DESC");

        if (donem is null) return;

        int yil = (int)donem.yil, ay = (int)donem.ay;

        var satirlar = pdb.Query(@"
SELECT p1.*, LTRIM(RTRIM(p2.per_tckimlik_no)) AS __tckn
FROM [biDb].[dbo].Personel_Degerlendirme_Sonuclari p1
INNER JOIN [biDb].[dbo].Personel p2 ON p1.per_id = p2.per_id
WHERE p1.yil = @yil AND p1.ay = @ay", new { yil, ay })
            .Cast<IDictionary<string, object>>()
            .ToList();

        if (satirlar.Count == 0) return;

        decimal? Puan(IDictionary<string, object> r, string ad) =>
            r.TryGetValue(ad, out var v) && v is not null
            && decimal.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture),
                NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;

        /* Olası puan: dönemde o ölçütten alınan en yüksek puan */
        var referans = Olcutler.ToDictionary(o => o,
            o => satirlar.Select(r => Puan(r, o) ?? 0).DefaultIfEmpty(0).Max());

        /* TC kimlik → sicil */
        var siciller = kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.KimlikNo))
            .GroupBy(x => new string(x.KimlikNo.Where(char.IsDigit).ToArray()))
            .ToDictionary(g => g.Key, g => g.First().PersonelKodu.Trim());

        using var db = vt.Baglanti();

        var onceki = db.Query(@"
SELECT personel_kodu AS kod, olcut, durum FROM KRY_PERFORMANS_DURUM
WHERE yil = @yil AND ay = @ay", new { yil, ay })
            .ToDictionary(x => $"{(string)x.kod}|{(string)x.olcut}", x => (string)x.durum,
                StringComparer.OrdinalIgnoreCase);

        var ilkHesap = onceki.Count == 0;

        var subeDegerleri = new Dictionary<string, Dictionary<string, PerformansOlcutServisi.Deger>>(
            StringComparer.OrdinalIgnoreCase);

        var gonderilen = 0;

        foreach (var r in satirlar)
        {
            var tckn = r.TryGetValue("__tckn", out var t) ? Convert.ToString(t) ?? "" : "";

            if (!siciller.TryGetValue(tckn, out var kod)) continue;

            var sube = r.TryGetValue("sube_adi", out var sb) ? Convert.ToString(sb) ?? "" : "";

            /* Ciro ve karlılık görevin bölümüne göre (kasap → et, manav → manav…) */
            var gorev = r.TryGetValue("gorev_adi", out var gv) ? Convert.ToString(gv) ?? "" : "";
            var subeAnahtar = sube + "|" + PerformansOlcutServisi.Bolum(gorev);
            if (!subeDegerleri.TryGetValue(subeAnahtar, out var degerler))
                subeDegerleri[subeAnahtar] = degerler = olcutServisi.Degerler(pdb, sube, yil, ay, gorev);

            foreach (var olcut in Olcutler)
            {
                var puan = Puan(r, olcut);
                if (puan is null) continue;

                var aldi = puan > 0;
                degerler.TryGetValue(olcut, out var d);

                var durum = aldi ? "aldi" : PerformansOlcutServisi.AzKaldi(d, false) ? "yakin" : "almadi";
                var anahtar = $"{kod}|{olcut}";

                if (onceki.TryGetValue(anahtar, out var eski) && eski == durum) continue;

                db.Execute(@"
MERGE KRY_PERFORMANS_DURUM AS h
USING (SELECT @kod AS personel_kodu, @yil AS yil, @ay AS ay, @olcut AS olcut) AS k
   ON h.personel_kodu = k.personel_kodu AND h.yil = k.yil AND h.ay = k.ay AND h.olcut = k.olcut
WHEN MATCHED THEN UPDATE SET durum = @durum, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (personel_kodu, yil, ay, olcut, durum) VALUES (@kod, @yil, @ay, @olcut, @durum);",
                    new { kod, yil, ay, olcut, durum });

                /* Önceki durum yoksa (dönemin ilk hesabı ya da yeni ölçüt)
                   yalnızca kaydediliyor */
                if (ilkHesap || eski is null) continue;

                var ad = Baslik(olcut);
                var ref_ = referans[olcut];
                var karsilastirma = d?.Sen is not null && d.Esik is not null
                    ? $" ({Sayi(d.Sen)}; {d.EsikAd?.ToLower(Tr)} {Sayi(d.Esik)})"
                    : "";

                (string baslik, string metin)? mesaj = (eski, durum) switch
                {
                    (_, "aldi") => ($"🎉 {ad} ölçütünden puan aldınız",
                        $"Tebrikler!{karsilastirma} Performansınıza {Sayi(puan)} puan eklendi."),

                    ("aldi", _) => ($"{ad} ölçütünde puan kaybedildi",
                        $"Bu ölçütün {Sayi(ref_)} puanı şu an hesaba katılmıyor.{karsilastirma}"),

                    ("almadi", "yakin") => ($"{ad} ölçütünde puana az kaldı",
                        $"Eşiğe çok yaklaştınız{karsilastirma}. Geçerseniz {Sayi(ref_)} puan kazanırsınız."),

                    _ => null,
                };

                if (mesaj is null) continue;

                try
                {
                    await bildirim.Gonder(kod, mesaj.Value.baslik, mesaj.Value.metin, "performans");
                    gonderilen++;
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Performans bildirimi gönderilemedi: {Kod}", kod);
                }
            }
        }

        if (gonderilen > 0 || ilkHesap)
            _kayit.LogInformation("Performans bildirimleri {Yil}/{Ay}: {Adet} bildirim{Ilk}",
                yil, ay, gonderilen, ilkHesap ? " (dönemin ilk hesabı, yalnızca kayıt)" : "");
    }
}

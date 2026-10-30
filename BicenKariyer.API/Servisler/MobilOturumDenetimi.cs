using System.Data;
using System.Security.Claims;
using Dapper;
using Microsoft.Extensions.Caching.Memory;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mobil (Personel rolü) oturumlarının merkezi denetimi (26.10.2026).
///
/// <para>
/// Mobil jeton 365 gün geçerli; güvenlik süreye değil iki denetime
/// dayanıyor: jetondaki cihaz kayıtlı cihazla eşleşmeli ve
/// <c>KRY_MOBIL_CIHAZ.oturum_acik</c> açık olmalı. Bu denetim yalnız
/// <c>MobilController.Kendisi()</c> içindeydi; başka denetleyicilerdeki
/// mobil uçlar ve Biçen360 API'nin tamamı denetlemiyordu. Ayrıca işten
/// ayrılan personelin jetonu çıkış tarihinden sonra da çalışmaya devam
/// ediyor, panelde "oturum açık" görünüyordu.
/// </para>
///
/// <para>
/// Artık Personel rolündeki her istek bu ara katmandan geçiyor:
/// (a) cihaz / oturum_acik kuralı (cihazsız eski jeton geriye dönük
/// kabul), (b) personel aktif değilse — çıkış tarihi bugün ya da geçmişse
/// (<c>PersonelKaydi.Durum == 0</c>; çıkış günü dahil, Ayrilacak
/// mantığıyla aynı) — 401 ve <c>{ kod: "ayrildi" }</c>. Uygulama 401'de
/// jetonu silip giriş ekranına dönüyor; eski sürümler de 401'i aynı
/// şekilde işlediği için sunucu tarafı tek başına yetiyor.
/// </para>
///
/// <para>
/// Sonuç personel koduna göre kısa süre bellekte tutuluyor; her istek
/// Mikro'ya ve cihaz tablosuna gitmiyor. "Oturum kapalı" sonucu
/// önbelleğe alınmıyor: çıkış yapıp aynı cihazdan hemen yeniden giren
/// personel yeni jetonuyla bekletilmesin. Çıkış, yeniden giriş ve panelden
/// eşleştirme kaldırma <see cref="Unut"/> ile kaydı düşürüyor.
/// </para>
/// </summary>
public class MobilOturumDenetimi
{
    /// <summary>Yanıttaki ayırt edici kod: çıkış tarihi gelmiş personel</summary>
    public const string AyrildiKodu = "ayrildi";

    public const string AyrildiMesaji = "Çıkış tarihiniz geldiği için oturumunuz kapatıldı.";
    public const string OturumMesaji = "Oturumunuz sona erdi. Yeniden giriş yapınız.";

    /// <summary>Mobil jetonun rolü</summary>
    public const string Rol = "Personel";

    /// <summary>Geçerli sonucun bellekte tutulduğu süre</summary>
    private static readonly TimeSpan GecerliSure = TimeSpan.FromMinutes(3);

    /// <summary>Ayrılmış sonucu biraz daha uzun: Mikro'ya gitmeye gerek yok</summary>
    private static readonly TimeSpan AyrildiSure = TimeSpan.FromMinutes(5);

    public enum Sonuc { Gecerli, OturumKapali, Ayrildi }

    private sealed record Kayit(string Cihaz, Sonuc Sonuc);

    private readonly IMemoryCache _bellek;
    private readonly IServiceScopeFactory _kapsam;
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<MobilOturumDenetimi> _kayit;

    public MobilOturumDenetimi(
        IMemoryCache bellek, IServiceScopeFactory kapsam,
        VeritabaniServisi vt, ILogger<MobilOturumDenetimi> kayit)
    {
        _bellek = bellek;
        _kapsam = kapsam;
        _vt = vt;
        _kayit = kayit;
    }

    private static string Anahtar(string kod) => "mobil-oturum:" + kod.Trim().ToUpperInvariant();

    /// <summary>
    /// Jetondan sicil ve cihaz kimliğini ayırır. Biçim:
    /// "personel:14721|cihaz-abc" (MobilController.JetonCoz ile aynı).
    /// </summary>
    public static (string kod, string cihaz) JetonCoz(ClaimsPrincipal kullanici)
    {
        var ad = kullanici?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return ("", "");

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? (govde.Trim(), "") : (govde[..i].Trim(), govde[(i + 1)..].Trim());
    }

    /// <summary>Personel için saklanan sonucu düşürür (çıkış, giriş, eşleştirme kaldırma).</summary>
    public void Unut(string kod)
    {
        if (!string.IsNullOrWhiteSpace(kod)) _bellek.Remove(Anahtar(kod));
    }

    /// <summary>
    /// Personelin aktif olup olmadığı. Listede yoksa null: karar
    /// verilemiyor, çağıran açık bırakır (var olan uç denetimleri sürer).
    /// Aynı sicil birden fazla kayıtla gelirse biri aktifse aktif.
    /// </summary>
    public static bool? Aktif(IEnumerable<PersonelKaydi> liste, string kod)
    {
        var k = (kod ?? "").Trim();
        if (k.Length == 0) return null;

        bool? sonuc = null;

        foreach (var p in liste)
        {
            if (!string.Equals((p.PersonelKodu ?? "").Trim(), k, StringComparison.OrdinalIgnoreCase))
                continue;

            if (p.Durum == 1) return true;
            sonuc = false;
        }

        return sonuc;
    }

    /// <summary>
    /// Verilen personellerin açık oturumlarını kapatır; kapatılan sayısı.
    /// </summary>
    public static int OturumlariKapat(IDbConnection db, IEnumerable<string> kodlar)
    {
        var toplam = 0;

        foreach (var kod in kodlar.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase))
            toplam += db.Execute(@"
UPDATE KRY_MOBIL_CIHAZ SET oturum_acik = 0
WHERE personel_kodu = @kod AND oturum_acik = 1", new { kod = kod.Trim() });

        return toplam;
    }

    /// <summary>
    /// Oturumu denetler. Denetim yapılamazsa (Mikro / veritabanı erişilemez)
    /// geçerli sayar: altyapı arızası personeli uygulamadan atmamalı.
    /// </summary>
    public Sonuc Denetle(string kod, string cihaz)
    {
        if (string.IsNullOrWhiteSpace(kod)) return Sonuc.OturumKapali;

        var anahtar = Anahtar(kod);

        if (_bellek.TryGetValue(anahtar, out Kayit saklanan) && saklanan is not null)
        {
            if (saklanan.Sonuc == Sonuc.Ayrildi) return Sonuc.Ayrildi;

            /* Aynı cihazın jetonu; farklı cihazsa (başka telefondan giriş)
               yeniden bakılır */
            if (string.Equals(saklanan.Cihaz, cihaz, StringComparison.Ordinal)) return Sonuc.Gecerli;
        }

        Sonuc sonuc;

        try
        {
            sonuc = Hesapla(kod, cihaz);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Mobil oturum denetimi yapılamadı; oturum geçerli sayıldı");
            return Sonuc.Gecerli;
        }

        switch (sonuc)
        {
            case Sonuc.Gecerli:
                _bellek.Set(anahtar, new Kayit(cihaz, sonuc), GecerliSure);
                break;

            case Sonuc.Ayrildi:
                _bellek.Set(anahtar, new Kayit(cihaz, sonuc), AyrildiSure);
                break;

            /* OturumKapali saklanmaz */
        }

        return sonuc;
    }

    private Sonuc Hesapla(string kod, string cihaz)
    {
        using var db = _vt.Baglanti();

        /* (a) cihaz / oturum_acik — MobilController.OturumGecerli ile aynı kural.
           Eski jetonlarda cihaz yok; geriye dönük kabul edilir. */
        if (!string.IsNullOrWhiteSpace(cihaz))
        {
            var kayit = db.QueryFirstOrDefault(@"
SELECT cihaz_id AS cihazId, oturum_acik AS oturumAcik
FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod", new { kod });

            if (kayit is not null &&
                (!(bool)kayit.oturumAcik || !CihazKimligi.Uyusuyor(db, kod, (string)kayit.cihazId, cihaz)))
                return Sonuc.OturumKapali;
        }

        /* (b) personel hâlâ çalışıyor mu */
        bool? aktif;

        using (var kapsam = _kapsam.CreateScope())
        {
            var liste = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>().TumPersonelleriGetir();
            aktif = Aktif(liste, kod);
        }

        if (aktif != false) return Sonuc.Gecerli;

        /* Ayrılmış: cihaz kaydındaki oturum da kapatılır; panel açık göstermesin */
        var kapatilan = OturumlariKapat(db, new[] { kod });

        if (kapatilan > 0)
            _kayit.LogInformation("Ayrılan personelin mobil oturumu kapatıldı: {Kod}", kod);

        return Sonuc.Ayrildi;
    }
}

/// <summary>Mobil oturum denetimi ara katmanı</summary>
public static class MobilOturumDenetimiAraKatmani
{
    /// <summary>
    /// Ara katman: kimlik doğrulamadan sonra, Personel rolündeki isteklerde.
    /// Çıkış ucu muaf: ayrılan personel de oturumu kapatabilmeli.
    /// </summary>
    public static IApplicationBuilder UseMobilOturumDenetimi(this IApplicationBuilder uygulama) =>
        uygulama.Use(async (baglam, sonraki) =>
        {
            if (baglam.User?.Identity?.IsAuthenticated == true
                && baglam.User.IsInRole(MobilOturumDenetimi.Rol)
                && !baglam.Request.Path.Equals("/api/Mobil/Cikis", StringComparison.OrdinalIgnoreCase))
            {
                var denetim = baglam.RequestServices.GetRequiredService<MobilOturumDenetimi>();
                var (kod, cihaz) = MobilOturumDenetimi.JetonCoz(baglam.User);

                var sonuc = denetim.Denetle(kod, cihaz);

                if (sonuc != MobilOturumDenetimi.Sonuc.Gecerli)
                {
                    baglam.Response.StatusCode = 401;
                    baglam.Response.Headers.CacheControl = "no-store";

                    await baglam.Response.WriteAsJsonAsync(sonuc == MobilOturumDenetimi.Sonuc.Ayrildi
                        ? new { hata = MobilOturumDenetimi.AyrildiMesaji, kod = MobilOturumDenetimi.AyrildiKodu }
                        : new { hata = MobilOturumDenetimi.OturumMesaji, kod = "oturum" });
                    return;
                }
            }

            await sonraki();
        });
}

/// <summary>
/// Çıkış tarihi gelmiş personelin açık mobil oturumlarını saat başı
/// kapatır (26.10.2026).
///
/// <para>
/// Ara katman yalnız istek geldiğinde çalışıyor; uygulamayı bir daha
/// açmayan ayrılmış personel panelde "oturum açık" görünmeye devam
/// ediyordu. Görev, <c>KRY_MOBIL_CIHAZ</c>'da oturumu açık olup Mikro'da
/// çıkış tarihi bugün ya da geçmiş olanları kapatıyor. Listede hiç
/// bulunmayan sicillere dokunulmuyor: kayıt silinmiş olabilir ama ağ ya da
/// okuma hatasından kaynaklanan eksik bir listeyle kimse kapatılmasın.
/// </para>
/// </summary>
public class AyrilanOturumGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<AyrilanOturumGorevi> _kayit;

    public AyrilanOturumGorevi(IServiceProvider saglayici, ILogger<AyrilanOturumGorevi> kayit)
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
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Ayrılan personel oturumları kapatılamadı");
            }

            /* Saatte bir: gün içinde girilen bir çıkış tarihi de yakalansın */
            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private void Calistir()
    {
        using var kapsam = _saglayici.CreateScope();
        var saglayici = kapsam.ServiceProvider;

        var liste = saglayici.GetRequiredService<PersonelKaynagiServisi>().TumPersonelleriGetir();

        /* Boş liste okuma hatası demektir; bu turda kimse kapatılmaz */
        if (liste is null || liste.Count == 0) return;

        var vt = saglayici.GetRequiredService<VeritabaniServisi>();
        using var db = vt.Baglanti();

        var acikOturumlar = db.Query<string>(
            "SELECT personel_kodu FROM KRY_MOBIL_CIHAZ WHERE oturum_acik = 1").ToList();

        var ayrilanlar = acikOturumlar
            .Where(kod => MobilOturumDenetimi.Aktif(liste, kod) == false)
            .ToList();

        if (ayrilanlar.Count == 0) return;

        var kapatilan = MobilOturumDenetimi.OturumlariKapat(db, ayrilanlar);

        var denetim = saglayici.GetRequiredService<MobilOturumDenetimi>();
        foreach (var kod in ayrilanlar) denetim.Unut(kod);

        _kayit.LogInformation(
            "Çıkış tarihi gelmiş {Adet} personelin mobil oturumu kapatıldı: {Kodlar}",
            kapatilan, string.Join(", ", ayrilanlar.Select(x => x.Trim())));
    }
}

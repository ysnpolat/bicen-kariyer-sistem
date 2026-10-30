using System.Security.Claims;
using Dapper;
using Microsoft.Extensions.Caching.Memory;

namespace Bicen360.API.Servisler;

/// <summary>
/// Mobil (Personel rolü) oturumlarının merkezi denetimi (26.10.2026).
///
/// <para>
/// Mobil uygulama Kariyer API'nin ürettiği jetonla buraya da geliyor; jeton
/// 365 gün geçerli ve bu API'de hiçbir uç cihaz eşleşmesine, oturumun
/// kapatılıp kapatılmadığına ya da personelin hâlâ çalışıp çalışmadığına
/// bakmıyordu. Kariyer API'deki ara katmanın aynısı: Personel rolündeki her
/// istekte <c>biPortal.KRY_MOBIL_CIHAZ</c> (cihaz / oturum_acik; cihazsız
/// eski jeton geriye dönük kabul) ve Mikro'daki çıkış tarihi denetlenir.
/// Çıkış tarihi bugün ya da geçmişse (çıkış günü dahil; Kariyer'deki Durum
/// kuralıyla aynı) 401 ve <c>{ kod: "ayrildi" }</c> döner; uygulama 401'de
/// jetonu silip giriş ekranına döner.
/// </para>
///
/// <para>
/// Sonuç personel koduna göre kısa süre bellekte; "oturum kapalı" sonucu
/// saklanmaz ki çıkış yapıp hemen yeniden giren personel bekletilmesin.
/// Denetim yapılamazsa (veritabanı erişilemez) oturum geçerli sayılır.
/// </para>
/// </summary>
public class MobilOturumDenetimi
{
    public const string AyrildiKodu = "ayrildi";
    public const string AyrildiMesaji = "Çıkış tarihiniz geldiği için oturumunuz kapatıldı.";
    public const string OturumMesaji = "Oturumunuz sona erdi. Yeniden giriş yapınız.";

    /// <summary>Mobil jetonun rolü</summary>
    public const string Rol = "Personel";

    /// <summary>Kariyer'deki CihazKimligi.TasimaSebebi; taşımadan sonra eski jetonun kabul süresi</summary>
    private const string TasimaSebebi = "Kalıcı kimliğe geçiş";
    private const int GecisDakika = 5;

    private static readonly TimeSpan GecerliSure = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan AyrildiSure = TimeSpan.FromMinutes(5);

    public enum Sonuc { Gecerli, OturumKapali, Ayrildi }

    private sealed record Kayit(string Cihaz, Sonuc Sonuc);

    private readonly IMemoryCache _bellek;
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<MobilOturumDenetimi> _kayit;

    public MobilOturumDenetimi(IMemoryCache bellek, VeritabaniServisi vt, ILogger<MobilOturumDenetimi> kayit)
    {
        _bellek = bellek;
        _vt = vt;
        _kayit = kayit;
    }

    private static string Anahtar(string kod) => "mobil-oturum:" + kod.Trim().ToUpperInvariant();

    /// <summary>Jetondan sicil ve cihaz: "personel:14721|cihaz-abc"</summary>
    public static (string kod, string cihaz) JetonCoz(ClaimsPrincipal kullanici)
    {
        var ad = kullanici?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
            return ("", "");

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? (govde.Trim(), "") : (govde[..i].Trim(), govde[(i + 1)..].Trim());
    }

    public void Unut(string kod)
    {
        if (!string.IsNullOrWhiteSpace(kod)) _bellek.Remove(Anahtar(kod));
    }

    public Sonuc Denetle(string kod, string cihaz)
    {
        if (string.IsNullOrWhiteSpace(kod)) return Sonuc.OturumKapali;

        var anahtar = Anahtar(kod);

        if (_bellek.TryGetValue(anahtar, out Kayit saklanan) && saklanan is not null)
        {
            if (saklanan.Sonuc == Sonuc.Ayrildi) return Sonuc.Ayrildi;
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

        if (sonuc == Sonuc.Gecerli) _bellek.Set(anahtar, new Kayit(cihaz, sonuc), GecerliSure);
        else if (sonuc == Sonuc.Ayrildi) _bellek.Set(anahtar, new Kayit(cihaz, sonuc), AyrildiSure);

        return sonuc;
    }

    private Sonuc Hesapla(string kod, string cihaz)
    {
        /* (a) cihaz / oturum_acik — Kariyer'deki OturumGecerli ile aynı kural */
        if (!string.IsNullOrWhiteSpace(cihaz))
        {
            using var db = _vt.Baglanti();

            var kayit = db.QueryFirstOrDefault(@"
SELECT cihaz_id AS cihazId, oturum_acik AS oturumAcik
FROM KRY_MOBIL_CIHAZ WHERE personel_kodu = @kod", new { kod });

            if (kayit is not null)
            {
                if (!(bool)kayit.oturumAcik) return Sonuc.OturumKapali;

                var kayitli = (string)kayit.cihazId;

                if (!string.Equals(kayitli, cihaz, StringComparison.Ordinal))
                {
                    /* Kalıcı kimliğe taşınan kayıtta eski jeton kısa süre kabul edilir */
                    var tasinmis = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_CIHAZ_GECMIS
WHERE personel_kodu = @kod AND sebep = @sebep
  AND eski_cihaz = @eski AND yeni_cihaz = @yeni
  AND tarih > DATEADD(minute, -@dk, SYSDATETIME())",
                        new { kod, sebep = TasimaSebebi, eski = cihaz, yeni = kayitli, dk = GecisDakika }) > 0;

                    if (!tasinmis) return Sonuc.OturumKapali;
                }
            }
        }

        /* (b) personel hâlâ çalışıyor mu: Mikro çıkış tarihi. Boş ya da 1950
           öncesi tarih "yok" demek; ileri tarihli çıkış (ihbar süresi) hâlâ
           çalışıyor. Sicil bulunamazsa karar verilmez, geçerli sayılır. */
        var aktif = Aktif(kod);

        if (aktif != false) return Sonuc.Gecerli;

        try
        {
            using var db = _vt.Baglanti();

            var kapatilan = db.Execute(@"
UPDATE KRY_MOBIL_CIHAZ SET oturum_acik = 0
WHERE personel_kodu = @kod AND oturum_acik = 1", new { kod });

            if (kapatilan > 0)
                _kayit.LogInformation("Ayrılan personelin mobil oturumu kapatıldı: {Kod}", kod);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ayrılan personelin oturum bayrağı kapatılamadı: {Kod}", kod);
        }

        return Sonuc.Ayrildi;
    }

    /// <summary>true çalışıyor, false ayrılmış, null bulunamadı</summary>
    private bool? Aktif(string kod)
    {
        using var db = _vt.PersonelBaglantisi();

        var tarihler = db.Query<DateTime?>(@"
SELECT P.per_cikis_tar
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P WITH (NOLOCK)
WHERE LTRIM(RTRIM(P.per_kod)) = @kod", new { kod = kod.Trim() }).ToList();

        if (tarihler.Count == 0) return null;

        var bugun = DateTime.Today;

        /* Aynı sicil birden fazla kayıtla gelirse biri çalışıyorsa çalışıyor */
        return tarihler.Any(t => !t.HasValue || t.Value.Year <= 1950 || t.Value.Date > bugun);
    }
}

/// <summary>Mobil oturum denetimi ara katmanı</summary>
public static class MobilOturumDenetimiAraKatmani
{
    /// <summary>Ara katman: kimlik doğrulamadan sonra, Personel rolündeki isteklerde.</summary>
    public static IApplicationBuilder UseMobilOturumDenetimi(this IApplicationBuilder uygulama) =>
        uygulama.Use(async (baglam, sonraki) =>
        {
            if (baglam.User?.Identity?.IsAuthenticated == true && baglam.User.IsInRole(MobilOturumDenetimi.Rol))
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

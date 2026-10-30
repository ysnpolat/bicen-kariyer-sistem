using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Engellenen IP adresleri.
///
/// Listedeki adreslerden gelen istekler karşılanmaz. Liste veritabanında
/// tutulur ve panelden yönetilir; her istekte veritabanına gidilmemesi için
/// bellekte bir dakika önbelleklenir.
///
/// Tek adres ("24.133.13.148") veya önek ("24.133.13.") yazılabilir.
/// Önek yazıldığında o aralıktaki tüm adresler engellenir.
/// </summary>
public class KaraListeServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly GuvenlikGunlugu _gunluk;

    private List<string> _liste = new();
    private DateTime _sonOkuma = DateTime.MinValue;
    private readonly object _kilit = new();

    public KaraListeServisi(VeritabaniServisi vt, GuvenlikGunlugu gunluk)
    {
        _vt = vt;
        _gunluk = gunluk;
    }

    /// <summary>Adres engelli mi?</summary>
    public bool Engelli(string adres)
    {
        if (string.IsNullOrWhiteSpace(adres)) return false;

        var liste = Liste();
        if (liste.Count == 0) return false;

        var temiz = adres.Trim();

        foreach (var kayit in liste)
        {
            /* Sonu nokta ile biten kayıtlar önek sayılır */
            if (kayit.EndsWith("."))
            {
                if (temiz.StartsWith(kayit, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            else if (string.Equals(temiz, kayit, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Engellenen isteği günlüğe yazar.</summary>
    public void Kaydet(string adres, string yol)
        => _gunluk.Yaz("ENGELLENDİ", adres, $"İstek: {yol}");

    /// <summary>Önbellekli liste; bir dakikada bir tazelenir.</summary>
    private List<string> Liste()
    {
        lock (_kilit)
        {
            if (DateTime.UtcNow - _sonOkuma < TimeSpan.FromMinutes(1))
                return _liste;

            _sonOkuma = DateTime.UtcNow;

            try
            {
                using var db = _vt.Baglanti();

                _liste = db.Query<string>(@"
SELECT ip FROM KRY_KARA_LISTE WHERE aktif = 1").ToList();
            }
            catch
            {
                // Okunamazsa eldeki liste kullanılmaya devam eder
            }

            return _liste;
        }
    }

    /// <summary>Liste değiştiğinde önbelleği hemen boşaltır.</summary>
    public void OnbellegiBosalt()
    {
        lock (_kilit) _sonOkuma = DateTime.MinValue;
    }
}

/// <summary>
/// Kara listedeki adresleri engelleyen ara katman.
/// İstek işlenmeden önce çalışır.
/// </summary>
public class KaraListeAraKatmani
{
    private readonly RequestDelegate _sonraki;

    public KaraListeAraKatmani(RequestDelegate sonraki) => _sonraki = sonraki;

    public async Task InvokeAsync(HttpContext baglam, KaraListeServisi kara)
    {
        var adres = Adres(baglam);

        if (kara.Engelli(adres))
        {
            kara.Kaydet(adres, baglam.Request.Path);

            baglam.Response.StatusCode = 403;
            await baglam.Response.WriteAsync("Erişim engellendi.");
            return;
        }

        await _sonraki(baglam);
    }

    /// <summary>Gerçek istemci adresi; taklit edilebilir başlığa güvenilmez.</summary>
    private static string Adres(HttpContext baglam) => IstemciAdresi.Bul(baglam);
}

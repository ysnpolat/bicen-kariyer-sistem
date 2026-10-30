namespace BicenKariyer.API.Servisler;

/// <summary>
/// Belge klasörünü çözer.
///
/// <para>
/// Yazma her zaman yapılandırılan klasöre gidiyor. Okumada önce oraya,
/// bulunamazsa uygulamanın kendi altındaki eski klasöre bakılıyor:
/// klasör ayarı sonradan dışarı taşındı ve daha önce yüklenmiş belgeler
/// eski yerde kaldı. Onları bulamamak, personelin kendi belgesini
/// açamamasına yol açıyordu.
/// </para>
///
/// <para>
/// Altı denetleyici aynı mantığı ayrı ayrı tekrarlıyordu; biri
/// değişince diğerlerini unutmak kolaydı.
/// </para>
/// </summary>
public static class BelgeKlasoru
{
    /// <summary>Yazma için: yapılandırılan klasör.</summary>
    public static string Yazma(IConfiguration yapilandirma, IWebHostEnvironment ortam)
    {
        var ayar = yapilandirma["Belge:Klasor"];

        return string.IsNullOrWhiteSpace(ayar) ? Eski(ortam) : ayar.Trim();
    }

    /// <summary>
    /// Okuma için: dosya hangi klasördeyse onun tam yolu, hiçbirinde
    /// yoksa null.
    /// </summary>
    public static string Bul(IConfiguration yapilandirma, IWebHostEnvironment ortam, string dosyaAdi)
    {
        if (string.IsNullOrWhiteSpace(dosyaAdi)) return null;

        foreach (var klasor in new[] { Yazma(yapilandirma, ortam), Eski(ortam) }.Distinct())
        {
            var yol = Path.Combine(klasor, dosyaAdi);

            if (File.Exists(yol)) return yol;
        }

        return null;
    }

    /// <summary>Uygulama klasörünün altındaki eski konum.</summary>
    private static string Eski(IWebHostEnvironment ortam) =>
        Path.Combine(
            string.IsNullOrWhiteSpace(ortam.ContentRootPath)
                ? AppContext.BaseDirectory
                : ortam.ContentRootPath,
            "personel-belge");
}

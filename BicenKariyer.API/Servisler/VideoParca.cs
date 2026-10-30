using System.Text.RegularExpressions;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Parça parça video yükleme (12.10.2026): duyuru videoları ve Biçen'den
/// Haberler gönderi videoları ortak.
///
/// <para>
/// IIS'te istek sınırı 20 MB; videolar parçalarla geliyor. İlk parçada
/// (sira = 0) sunucu 32 haneli rastgele bir anahtar üretiyor; sonraki
/// parçalar sırayla aynı anahtarla geliyor ve dosyanın sonuna ekleniyor.
/// Son parçada boyut doğrulanıp dosya tamamlanıyor. Dosyalar
/// Belge:Klasor/duyuru-video altında; oynatma /api/DuyuruVideo/Dosya/{anahtar}.
/// </para>
/// </summary>
public static class VideoParca
{
    /// <summary>Varsayılan parça (panel); mobil daha küçük parça gönderebilir</summary>
    public const int Parca = 8 * 1024 * 1024;
    public const int EnKucukParca = 512 * 1024;
    public const long EnBuyuk = 1024L * 1024 * 1024;

    public static readonly Dictionary<string, string> Turler = new(StringComparer.OrdinalIgnoreCase)
    {
        [".mp4"] = "video/mp4",
        [".m4v"] = "video/mp4",
        [".mov"] = "video/quicktime",
        [".webm"] = "video/webm",
    };

    public static readonly Regex AnahtarDeseni = new("^[0-9a-f]{32}$", RegexOptions.Compiled);

    public static string Klasor(IConfiguration yapilandirma, IWebHostEnvironment ortam)
    {
        var ayar = yapilandirma["Belge:Klasor"];

        var kok = string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(
                string.IsNullOrWhiteSpace(ortam?.ContentRootPath) ? AppContext.BaseDirectory : ortam.ContentRootPath,
                "personel-belge")
            : ayar.Trim();

        return Path.Combine(kok, "duyuru-video");
    }

    /// <summary>Anahtarın tamamlanmış video dosyası; yoksa null</summary>
    public static string Bul(string klasor, string anahtar)
    {
        if (string.IsNullOrWhiteSpace(anahtar) || !AnahtarDeseni.IsMatch(anahtar)) return null;
        if (!Directory.Exists(klasor)) return null;

        return Turler.Keys
            .Select(u => Path.Combine(klasor, anahtar + u))
            .FirstOrDefault(File.Exists);
    }

    /// <summary>Oynatma adresi (göreli; istemci kendi taban adresini ekler)</summary>
    public static string DosyaYolu(string anahtar) =>
        string.IsNullOrWhiteSpace(anahtar) ? null : $"/api/DuyuruVideo/Dosya/{anahtar}";

    public sealed record Sonuc(int Kod, object Govde, string Anahtar, bool Tamam);

    /// <summary>
    /// Bir parçayı yazar. <paramref name="parcaBoyut"/> 0 ise 8 MB; istemci
    /// bütün parçalarda aynı boyutu göndermeli.
    /// </summary>
    public static async Task<Sonuc> Yaz(string klasor, string anahtar, int sira, int toplam,
        string dosyaAdi, long boyut, IFormFile parca, int parcaBoyut, long enBuyuk, ILogger kayit)
    {
        if (parca is null || parca.Length == 0)
            return new(400, new { hata = "Video parçası gelmedi." }, null, false);

        var uzanti = Path.GetExtension(dosyaAdi ?? "").ToLowerInvariant();
        if (!Turler.ContainsKey(uzanti))
            return new(400, new { hata = "Yalnızca MP4, M4V, MOV ya da WEBM video yüklenebilir. Her telefonda oynaması için MP4 önerilir." }, null, false);

        var sinir = enBuyuk > 0 ? Math.Min(enBuyuk, EnBuyuk) : EnBuyuk;
        if (boyut <= 0 || boyut > sinir)
            return new(400, new { hata = $"Video en çok {sinir / (1024 * 1024)} MB olabilir." }, null, false);

        var p = parcaBoyut <= 0 ? Parca : Math.Clamp(parcaBoyut, EnKucukParca, Parca);
        var beklenenToplam = (int)((boyut + p - 1) / p);

        if (toplam != beklenenToplam || sira < 0 || sira >= toplam || parca.Length > p)
            return new(400, new { hata = "Parça bilgisi tutarsız; yüklemeyi yeniden başlatınız." }, null, false);

        if (sira == 0)
            anahtar = Guid.NewGuid().ToString("N");
        else if (string.IsNullOrWhiteSpace(anahtar) || !AnahtarDeseni.IsMatch(anahtar))
            return new(400, new { hata = "Yükleme anahtarı geçersiz." }, null, false);

        var gecici = Path.Combine(klasor, anahtar + uzanti + ".yukleniyor");

        try
        {
            Directory.CreateDirectory(klasor);

            if (sira > 0)
            {
                /* Parçalar sırayla gelmeli: araya kayıp karışmasın */
                if (!File.Exists(gecici))
                    return new(400, new { hata = "Yükleme bulunamadı; yeniden başlatınız." }, null, false);

                var mevcut = new FileInfo(gecici).Length;
                if (mevcut != (long)sira * p)
                    return new(400, new { hata = "Parça sırası bozuldu; yüklemeyi yeniden başlatınız." }, null, false);
            }

            await using (var akis = new FileStream(gecici, sira == 0 ? FileMode.Create : FileMode.Append, FileAccess.Write))
                await parca.CopyToAsync(akis);

            if (sira < toplam - 1)
                return new(200, new { anahtar, sira, tamam = false }, anahtar, false);

            var son = new FileInfo(gecici).Length;
            if (son != boyut)
            {
                File.Delete(gecici);
                return new(400, new { hata = "Video eksik geldi; yeniden yükleyiniz." }, null, false);
            }

            var hedef = Path.Combine(klasor, anahtar + uzanti);
            File.Move(gecici, hedef, overwrite: true);

            /* Dizin (moov) sondaysa öne alınır: telefon bütün dosyayı
               indirmeden oynamaya başlar (28.10.2026) */
            Mp4HizliBaslat.Duzenle(hedef, kayit);
        }
        catch (Exception hata)
        {
            kayit?.LogError(hata, "Video yazılamadı: {Klasor}", klasor);
            return new(500, new { hata = $"Video sunucuya yazılamadı ({klasor}). Klasöre yazma izni verilmeli." }, null, false);
        }

        return new(200, new { anahtar, tamam = true }, anahtar, true);
    }

    /// <summary>Videoyu siler (gönderiden kaldırılınca)</summary>
    public static void Sil(string klasor, string anahtar)
    {
        try
        {
            var yol = Bul(klasor, anahtar);
            if (yol is not null) File.Delete(yol);
        }
        catch
        {
            /* kalırsa zararı yok */
        }
    }
}

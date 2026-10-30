namespace BicenKariyer.API.Servisler;

/// <summary>
/// Güvenlik olaylarını dosyaya yazar.
///
/// Uygulama IIS altında çalıştığı için konsola yazılan günlükler hiçbir yere
/// ulaşmıyor. Engellenen başvurular, hız sınırı aşımları ve başarısız giriş
/// denemeleri gibi olayların incelenebilmesi için ayrı bir dosya tutulur.
///
/// Dosyalar gün bazında ayrılır ve varsayılan olarak 30 gün saklanır.
/// Yöneticiler bu kayıtları panelden görüntüleyebilir.
/// </summary>
public class GuvenlikGunlugu
{
    private readonly string _klasor;
    private readonly object _kilit = new();

    /// <summary>Kaç günlük kayıt saklanacak</summary>
    private const int SaklamaGunu = 30;

    private DateTime _sonTemizlik = DateTime.MinValue;

    public GuvenlikGunlugu(IWebHostEnvironment ortam)
    {
        _klasor = Path.Combine(ortam.ContentRootPath, "logs");

        try
        {
            Directory.CreateDirectory(_klasor);
        }
        catch
        {
            // Klasör oluşturulamazsa günlükleme sessizce devre dışı kalır;
            // uygulamanın çalışmasını engellememelidir.
        }
    }

    /// <summary>Bir olayı günlüğe yazar.</summary>
    public void Yaz(string olay, string adres, string ayrinti = "")
    {
        try
        {
            EskileriSil();

            var satir = string.Join(" | ", new[]
            {
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
                olay,
                string.IsNullOrWhiteSpace(adres) ? "-" : adres,
                (ayrinti ?? "").Replace("\r", " ").Replace("\n", " ")
            });

            var dosya = Path.Combine(_klasor, $"guvenlik-{DateTime.Now:yyyy-MM-dd}.log");

            lock (_kilit)
            {
                File.AppendAllText(dosya, satir + Environment.NewLine);
            }
        }
        catch
        {
            // Yazılamazsa işlem akışı bozulmamalıdır
        }
    }

    /// <summary>Belirtilen günün kayıtlarını en yeniden başlayarak döndürür.</summary>
    public List<GunlukSatiri> Oku(DateTime? gun = null, int enFazla = 500)
    {
        var sonuc = new List<GunlukSatiri>();

        try
        {
            var tarih = gun?.Date ?? DateTime.Today;
            var dosya = Path.Combine(_klasor, $"guvenlik-{tarih:yyyy-MM-dd}.log");

            if (!File.Exists(dosya)) return sonuc;

            var satirlar = File.ReadAllLines(dosya)
                .Reverse()
                .Take(enFazla);

            foreach (var satir in satirlar)
            {
                var parcalar = satir.Split(" | ");
                if (parcalar.Length < 3) continue;

                sonuc.Add(new GunlukSatiri
                {
                    Zaman = DateTime.TryParse(parcalar[0], out var z) ? z : DateTime.MinValue,
                    Olay = parcalar[1],
                    Adres = parcalar[2],
                    Ayrinti = parcalar.Length > 3 ? parcalar[3] : ""
                });
            }
        }
        catch
        {
            // Okunamazsa boş liste döner
        }

        return sonuc;
    }

    /// <summary>Kayıt bulunan günlerin listesi.</summary>
    public List<string> Gunler()
    {
        try
        {
            return Directory.GetFiles(_klasor, "guvenlik-*.log")
                .Select(x => Path.GetFileNameWithoutExtension(x).Replace("guvenlik-", ""))
                .OrderByDescending(x => x)
                .ToList();
        }
        catch
        {
            return new List<string>();
        }
    }

    /// <summary>Saklama süresini aşan dosyaları siler.</summary>
    private void EskileriSil()
    {
        if (DateTime.Now - _sonTemizlik < TimeSpan.FromHours(6)) return;
        _sonTemizlik = DateTime.Now;

        try
        {
            var sinir = DateTime.Today.AddDays(-SaklamaGunu);

            foreach (var dosya in Directory.GetFiles(_klasor, "guvenlik-*.log"))
            {
                var ad = Path.GetFileNameWithoutExtension(dosya).Replace("guvenlik-", "");

                if (DateTime.TryParse(ad, out var tarih) && tarih < sinir)
                    File.Delete(dosya);
            }
        }
        catch
        {
            // Silinemezse sorun değil
        }
    }
}

/// <summary>Günlük dosyasındaki tek bir satır</summary>
public class GunlukSatiri
{
    public DateTime Zaman { get; set; }
    public string Olay { get; set; }
    public string Adres { get; set; }
    public string Ayrinti { get; set; }
}

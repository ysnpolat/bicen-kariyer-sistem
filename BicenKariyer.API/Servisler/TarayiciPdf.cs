using System.Diagnostics;
using System.Text;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// HTML'den PDF: sunucudaki Chrome ya da Edge'in başsız (headless) yazdırması
/// ---------------------------------------------------------------------------
/// İzin formları A4'e göre hazırlanmış HTML. PDF kütüphanesi (NuGet)
/// eklemek yerine sunucuda zaten kurulu olan tarayıcı kullanılıyor:
/// <c>msedge --headless --print-to-pdf</c>. Windows Server'da Edge, yoksa
/// Chrome aranıyor; yol <c>IzinFormu:TarayiciYolu</c> ayarıyla da
/// verilebilir. Tarayıcı bulunamazsa ya da yazdırma başarısız olursa
/// <c>null</c> döner; çağıran HTML'e düşer — form hiç gitmemekten iyidir.
/// </summary>
public static class TarayiciPdf
{
    private static readonly string[] Adaylar =
    {
        @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        @"C:\Program Files\Google\Chrome\Application\chrome.exe",
        @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        "/usr/bin/microsoft-edge",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
    };

    /// <summary>Kullanılacak tarayıcının yolu; bulunamazsa null.</summary>
    public static string Bul(IConfiguration ayar)
    {
        var tanimli = ayar?["IzinFormu:TarayiciYolu"];

        if (!string.IsNullOrWhiteSpace(tanimli) && File.Exists(tanimli.Trim())) return tanimli.Trim();

        return Adaylar.FirstOrDefault(File.Exists);
    }

    /// <summary>
    /// HTML'i PDF'e çevirir. Sayfa boyutu ve kenar boşluğu HTML'deki
    /// <c>@page</c> kuralından (A4, kenar boşluğu yok) geliyor; üst bilgi ve
    /// alt bilgi (tarih, adres) basılmıyor.
    /// </summary>
    public static async Task<(byte[] Pdf, string Hata)> DonusturAsync(
        string html, IConfiguration ayar, ILogger kayit, int zamanAsimiSaniye = 60)
    {
        var tarayici = Bul(ayar);

        if (tarayici is null)
            return (null, "Sunucuda Edge ya da Chrome bulunamadı (IzinFormu:TarayiciYolu ayarı ile yol verilebilir).");

        var klasor = Path.Combine(Path.GetTempPath(), "bicen-pdf-" + Guid.NewGuid().ToString("N"));

        try
        {
            Directory.CreateDirectory(klasor);

            var htmlYolu = Path.Combine(klasor, "form.html");
            var pdfYolu = Path.Combine(klasor, "form.pdf");
            var profil = Path.Combine(klasor, "profil");

            await File.WriteAllTextAsync(htmlYolu, html, new UTF8Encoding(true));

            var adres = new Uri(htmlYolu).AbsoluteUri;

            var bilgi = new ProcessStartInfo
            {
                FileName = tarayici,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            foreach (var a in new[]
                     {
                         "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
                         "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars",
                         $"--user-data-dir={profil}",
                         "--no-pdf-header-footer", "--print-to-pdf-no-header",
                         /* Logo ve yazı tipi ağdan geliyor: yazdırmadan önce yüklensin */
                         "--virtual-time-budget=8000",
                         $"--print-to-pdf={pdfYolu}",
                         adres,
                     })
                bilgi.ArgumentList.Add(a);

            using var surec = Process.Start(bilgi);

            if (surec is null) return (null, "Tarayıcı başlatılamadı.");

            /* Çıktılar okunmazsa tampon dolup süreç takılabiliyor */
            var cikti = surec.StandardOutput.ReadToEndAsync();
            var hata = surec.StandardError.ReadToEndAsync();

            using var iptal = new CancellationTokenSource(TimeSpan.FromSeconds(zamanAsimiSaniye));

            try
            {
                await surec.WaitForExitAsync(iptal.Token);
            }
            catch (OperationCanceledException)
            {
                try { surec.Kill(true); } catch { /* zaten kapanmış olabilir */ }
                return (null, $"PDF {zamanAsimiSaniye} saniyede oluşturulamadı.");
            }

            if (File.Exists(pdfYolu) && new FileInfo(pdfYolu).Length > 0)
                return (await File.ReadAllBytesAsync(pdfYolu), null);

            var mesaj = (await hata).Trim();

            kayit?.LogWarning("PDF oluşturulamadı ({Kod}): {Mesaj}", surec.ExitCode, mesaj);

            return (null, $"PDF oluşturulamadı (çıkış kodu {surec.ExitCode}).");
        }
        catch (Exception hata)
        {
            kayit?.LogWarning(hata, "PDF oluşturulamadı");
            return (null, "PDF oluşturulamadı: " + hata.Message);
        }
        finally
        {
            /* Profil klasörünü tarayıcı birkaç an tutabiliyor; silinemezse kalır */
            for (var i = 0; i < 3; i++)
            {
                try
                {
                    if (Directory.Exists(klasor)) Directory.Delete(klasor, true);
                    break;
                }
                catch
                {
                    await Task.Delay(500);
                }
            }
        }
    }
}

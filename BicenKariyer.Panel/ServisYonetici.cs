using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;

namespace BicenKariyer.Panel;

/// <summary>Bir servisin çalışma zamanı durumu.</summary>
public class ServisCalisan
{
    public ServisTanimi Tanim { get; init; }
    public Process Surec { get; set; }
    public DateTime? BaslangicZamani { get; set; }

    /// <summary>Kullanıcı tarafından durdurulduysa çökme sayılmaz.</summary>
    public bool ElleDurduruldu { get; set; }

    public readonly ConcurrentQueue<string> Loglar = new();

    public bool Calisiyor
    {
        get
        {
            try
            {
                return Surec is { HasExited: false };
            }
            catch
            {
                return false;
            }
        }
    }

    public int Pid
    {
        get
        {
            try
            {
                return Surec?.Id ?? 0;
            }
            catch
            {
                return 0;
            }
        }
    }

    public void LogEkle(string satir)
    {
        Loglar.Enqueue($"[{DateTime.Now:HH:mm:ss}] {satir}");
        while (Loglar.Count > 3000) Loglar.TryDequeue(out _);
    }

    public IEnumerable<string> SonSatirlar(int adet) => Loglar.TakeLast(adet);
}

/// <summary>
/// Servisleri başlatır, durdurur, çıktılarını toplar ve beklenmeyen
/// kapanmaları bildirir.
/// </summary>
public class ServisYonetici
{
    private readonly PanelAyarlari _ayarlar;
    private readonly Dictionary<string, ServisCalisan> _servisler = new();
    private readonly string _logKlasoru;

    public event Action<string, string> LogGeldi;          // (servisAd, satır)
    public event Action DurumDegisti;
    public event Action<string, int> BeklenmedikKapanma;   // (servisAd, çıkışKodu)

    public ServisYonetici(PanelAyarlari ayarlar)
    {
        _ayarlar = ayarlar;

        _logKlasoru = Path.Combine(AppContext.BaseDirectory, "loglar");
        Directory.CreateDirectory(_logKlasoru);

        foreach (var tanim in _ayarlar.Servisler)
            _servisler[tanim.Ad] = new ServisCalisan { Tanim = tanim };
    }

    public IReadOnlyCollection<ServisCalisan> Servisler => _servisler.Values.ToList();

    public ServisCalisan Getir(string ad) =>
        _servisler.TryGetValue(ad, out var s) ? s : null;

    /* ---------------------------------------------------------------- başlat */

    public void Baslat(string ad)
    {
        var servis = Getir(ad);
        if (servis is null || servis.Calisiyor) return;

        var klasor = _ayarlar.ServisKlasoru(servis.Tanim);

        if (!Directory.Exists(klasor))
        {
            servis.LogEkle($"HATA: Klasör bulunamadı → {klasor}");
            LogGeldi?.Invoke(ad, $"HATA: Klasör bulunamadı → {klasor}");
            return;
        }

        var bilgi = new ProcessStartInfo
        {
            FileName = servis.Tanim.Komut,
            Arguments = servis.Tanim.Argumanlar,
            WorkingDirectory = klasor,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        // Vite ve dotnet çıktılarının renk kodları olmadan gelmesi için
        bilgi.EnvironmentVariables["NO_COLOR"] = "1";
        bilgi.EnvironmentVariables["FORCE_COLOR"] = "0";
        bilgi.EnvironmentVariables["DOTNET_ENVIRONMENT"] = "Production";

        var surec = new Process { StartInfo = bilgi, EnableRaisingEvents = true };

        surec.OutputDataReceived += (_, e) => SatirGeldi(servis, e.Data);
        surec.ErrorDataReceived += (_, e) => SatirGeldi(servis, e.Data);

        surec.Exited += (_, _) =>
        {
            var kod = 0;
            try { kod = surec.ExitCode; } catch { /* erişilemezse 0 */ }

            servis.LogEkle($"--- Servis durdu (çıkış kodu: {kod}) ---");
            LogGeldi?.Invoke(servis.Tanim.Ad, $"--- Servis durdu (çıkış kodu: {kod}) ---");

            var elleydi = servis.ElleDurduruldu;
            servis.BaslangicZamani = null;
            DurumDegisti?.Invoke();

            if (!elleydi || _ayarlar.ElleDurdurmadaMailGonder)
                BeklenmedikKapanma?.Invoke(servis.Tanim.Ad, kod);
        };

        try
        {
            servis.ElleDurduruldu = false;
            surec.Start();
            surec.BeginOutputReadLine();
            surec.BeginErrorReadLine();

            servis.Surec = surec;
            servis.BaslangicZamani = DateTime.Now;
            servis.LogEkle($"--- Servis başlatıldı (PID: {surec.Id}) ---");
            LogGeldi?.Invoke(ad, $"--- Servis başlatıldı (PID: {surec.Id}) ---");
        }
        catch (Exception hata)
        {
            servis.LogEkle($"HATA: Başlatılamadı → {hata.Message}");
            LogGeldi?.Invoke(ad, $"HATA: Başlatılamadı → {hata.Message}");
        }

        DurumDegisti?.Invoke();
    }

    /* --------------------------------------------------------------- durdur */

    public void Durdur(string ad)
    {
        var servis = Getir(ad);
        if (servis is null || !servis.Calisiyor) return;

        servis.ElleDurduruldu = true;

        try
        {
            // npm / cmd alt süreçleri de kapanmalı: süreç ağacını sonlandır
            var pid = servis.Surec.Id;

            var oldur = new ProcessStartInfo("taskkill", $"/PID {pid} /T /F")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            using var islem = Process.Start(oldur);
            islem?.WaitForExit(8000);

            if (!servis.Surec.HasExited)
                servis.Surec.Kill(true);
        }
        catch (Exception hata)
        {
            servis.LogEkle($"HATA: Durdurulamadı → {hata.Message}");
        }

        DurumDegisti?.Invoke();
    }

    public void YenidenBaslat(string ad)
    {
        Durdur(ad);
        Thread.Sleep(1200);
        Baslat(ad);
    }

    public void TumunuBaslat()
    {
        foreach (var servis in _servisler.Values.Where(x => x.Tanim.OtomatikBaslat))
        {
            Baslat(servis.Tanim.Ad);
            Thread.Sleep(1500); // API önce ayağa kalksın
        }
    }

    public void TumunuDurdur()
    {
        foreach (var servis in _servisler.Values)
            Durdur(servis.Tanim.Ad);
    }

    /* -------------------------------------------------------------- yardımcı */

    private void SatirGeldi(ServisCalisan servis, string satir)
    {
        if (string.IsNullOrWhiteSpace(satir)) return;

        servis.LogEkle(satir);
        LogGeldi?.Invoke(servis.Tanim.Ad, satir);
        DosyayaYaz(servis.Tanim.Ad, satir);
    }

    private void DosyayaYaz(string servisAd, string satir)
    {
        try
        {
            var guvenliAd = string.Join("_", servisAd.Split(Path.GetInvalidFileNameChars()));
            var dosya = Path.Combine(_logKlasoru, $"{guvenliAd}_{DateTime.Now:yyyyMMdd}.log");
            File.AppendAllText(dosya, $"[{DateTime.Now:HH:mm:ss}] {satir}{Environment.NewLine}");
        }
        catch
        {
            /* log yazılamıyorsa uygulamayı durdurmaya değmez */
        }
    }

    public string LogKlasoru => _logKlasoru;
}

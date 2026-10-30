using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace BicenKariyer.Panel;

/* ==========================================================================
 * Ayar modelleri
 * ========================================================================== */

public class ServisTanimi
{
    public string Ad { get; set; } = "";
    /// <summary>Kök klasöre göreli veya tam yol</summary>
    public string Klasor { get; set; } = "";
    public string Komut { get; set; } = "";
    public string Argumanlar { get; set; } = "";
    public string Adres { get; set; } = "";
    public bool OtomatikBaslat { get; set; } = true;
}

public class MailAyarlari
{
    public string Sunucu { get; set; } = "";
    public int Port { get; set; } = 465;
    /// <summary>"Otomatik", "SSL", "STARTTLS" veya "Yok"</summary>
    public string SifrelemeTuru { get; set; } = "SSL";
    public string KullaniciAdi { get; set; } = "";
    public string Parola { get; set; } = "";
    public string GonderenAd { get; set; } = "Biçen Kariyer Panel";
    public string GonderenAdres { get; set; } = "";
    public List<string> AliciAdresler { get; set; } = new();
}

public class PanelAyarlari
{
    /// <summary>Boş bırakılırsa panel klasör yapısını kendisi bulur.</summary>
    public string KokKlasor { get; set; } = "";
    public bool OtomatikYenidenBaslat { get; set; } = true;
    public bool ElleDurdurmadaMailGonder { get; set; }
    public MailAyarlari Mail { get; set; } = new();
    public List<ServisTanimi> Servisler { get; set; } = new();

    /* ------------------------------------------------------------- dosya */

    private static readonly JsonSerializerOptions Secenek = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never
    };

    public static string DosyaYolu =>
        Path.Combine(AppContext.BaseDirectory, "ayarlar.json");

    public static PanelAyarlari Yukle()
    {
        try
        {
            if (File.Exists(DosyaYolu))
            {
                var json = File.ReadAllText(DosyaYolu, Encoding.UTF8);
                var ayar = JsonSerializer.Deserialize<PanelAyarlari>(json, Secenek);
                if (ayar is not null) return ayar;
            }
        }
        catch
        {
            /* bozuk dosya: varsayılanlarla devam edilir */
        }

        return new PanelAyarlari();
    }

    public void Kaydet()
    {
        File.WriteAllText(DosyaYolu, JsonSerializer.Serialize(this, Secenek), Encoding.UTF8);
    }

    /// <summary>
    /// Kök klasörü bulur: ayarda yazılı değilse exe konumundan yukarı doğru
    /// "BicenKariyer.API" klasörünü içeren dizini arar.
    /// </summary>
    public string KokKlasoruBul()
    {
        if (!string.IsNullOrWhiteSpace(KokKlasor) && Directory.Exists(KokKlasor))
            return KokKlasor;

        var dizin = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 6 && dizin is not null; i++)
        {
            if (Directory.Exists(Path.Combine(dizin.FullName, "BicenKariyer.API")))
                return dizin.FullName;

            dizin = dizin.Parent;
        }

        return AppContext.BaseDirectory;
    }

    public string ServisKlasoru(ServisTanimi servis)
    {
        if (Path.IsPathRooted(servis.Klasor)) return servis.Klasor;
        return Path.GetFullPath(Path.Combine(KokKlasoruBul(), servis.Klasor));
    }
}

/* ==========================================================================
 * Mail gönderimi
 * ========================================================================== */

public static class MailGonderici
{
    public static async Task<(bool basarili, string hata)> GonderAsync(
        MailAyarlari a, string konu, string govde)
    {
        var hedefler = a.AliciAdresler?
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .ToList() ?? new List<string>();

        if (string.IsNullOrWhiteSpace(a.Sunucu))
            return (false, "SMTP sunucusu tanımlı değil.");

        if (hedefler.Count == 0)
            return (false, "Bildirim gönderilecek adres tanımlı değil.");

        var gonderen = string.IsNullOrWhiteSpace(a.GonderenAdres)
            ? a.KullaniciAdi
            : a.GonderenAdres;

        if (string.IsNullOrWhiteSpace(gonderen))
            return (false, "Gönderen adres tanımlı değil.");

        try
        {
            var ileti = new MimeMessage();
            ileti.From.Add(new MailboxAddress(a.GonderenAd ?? "Biçen Kariyer Panel", gonderen));
            foreach (var hedef in hedefler)
                ileti.To.Add(MailboxAddress.Parse(hedef));

            ileti.Subject = konu;
            ileti.Body = new BodyBuilder { HtmlBody = govde }.ToMessageBody();

            using var istemci = new SmtpClient { Timeout = 20000 };
            istemci.ServerCertificateValidationCallback = (_, _, _, _) => true;

            var secenek = (a.SifrelemeTuru ?? "Otomatik") switch
            {
                "SSL" => SecureSocketOptions.SslOnConnect,
                "STARTTLS" => SecureSocketOptions.StartTls,
                "Yok" => SecureSocketOptions.None,
                _ => a.Port == 465
                    ? SecureSocketOptions.SslOnConnect
                    : SecureSocketOptions.StartTlsWhenAvailable
            };

            await istemci.ConnectAsync(a.Sunucu, a.Port, secenek);

            if (!string.IsNullOrWhiteSpace(a.KullaniciAdi))
                await istemci.AuthenticateAsync(a.KullaniciAdi, a.Parola);

            await istemci.SendAsync(ileti);
            await istemci.DisconnectAsync(true);

            return (true, null);
        }
        catch (Exception hata)
        {
            var mesaj = hata.InnerException is null
                ? hata.Message
                : $"{hata.Message} · {hata.InnerException.Message}";
            return (false, mesaj);
        }
    }

    public static string DurmaGovdesi(string servisAd, int cikisKodu, IEnumerable<string> sonSatirlar)
    {
        var loglar = string.Join("<br/>", sonSatirlar.Select(x =>
            x.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")));

        return $@"
<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1F2933'>
  <h2 style='color:#E8481C;margin:0 0 6px'>Servis durdu: {servisAd}</h2>
  <table style='border-collapse:collapse;margin:10px 0'>
    <tr>
      <td style='padding:6px 10px;border:1px solid #ddd;background:#F5F7F2'>Servis</td>
      <td style='padding:6px 10px;border:1px solid #ddd'><strong>{servisAd}</strong></td>
    </tr>
    <tr>
      <td style='padding:6px 10px;border:1px solid #ddd;background:#F5F7F2'>Zaman</td>
      <td style='padding:6px 10px;border:1px solid #ddd'>{DateTime.Now:dd.MM.yyyy HH:mm:ss}</td>
    </tr>
    <tr>
      <td style='padding:6px 10px;border:1px solid #ddd;background:#F5F7F2'>Çıkış Kodu</td>
      <td style='padding:6px 10px;border:1px solid #ddd'>{cikisKodu}</td>
    </tr>
    <tr>
      <td style='padding:6px 10px;border:1px solid #ddd;background:#F5F7F2'>Sunucu</td>
      <td style='padding:6px 10px;border:1px solid #ddd'>{Environment.MachineName}</td>
    </tr>
  </table>
  <p style='margin:12px 0 4px'><strong>Son kayıtlar:</strong></p>
  <div style='font-family:Consolas,monospace;font-size:12px;background:#F7F8F5;
              border:1px solid #ddd;border-radius:6px;padding:10px'>{loglar}</div>
  <p style='color:#6B7280;margin-top:14px'>Biçen Kariyer Servis Paneli</p>
</div>";
    }
}

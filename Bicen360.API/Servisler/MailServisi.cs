using Dapper;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace Bicen360.API.Servisler;

/// <summary>
/// Mail gönderimi.
///
/// <para>
/// Ayarlar veritabanında (<c>B360_AYAR</c>) tutuluyor, yapılandırma
/// dosyasında değil: sunucudaki dosyayı elle düzenlemek her değişiklikte
/// yayına erişim gerektiriyordu ve yayın betiği o dosyayı koruduğu için
/// yeni ayarlar kendiliğinden gelmiyordu.
/// </para>
///
/// <para>
/// Gönderim başarısız olduğunda istisna yukarı taşınıyor; çağıran taraf
/// kullanıcıya gerçek sebebi gösterebilsin. Sessizce yutmak, mailin
/// gitmediğini kimsenin fark etmemesine yol açıyordu.
/// </para>
/// </summary>
public class MailServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<MailServisi> _kayit;

    public MailServisi(VeritabaniServisi vt, ILogger<MailServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <summary>
    /// İstisna zincirini okunabilir tek metne indirir.
    ///
    /// <para>
    /// SMTP hatalarında dış mesaj hep "Failure sending mail." oluyor;
    /// sunucu adının çözülemediği, portun kapalı olduğu ya da parolanın
    /// reddedildiği bilgisi iç istisnada duruyor. Yalnızca dış mesajı
    /// göstermek, ekrandaki uyarıyı hiçbir şey anlatmayan bir cümleye
    /// çeviriyordu.
    /// </para>
    /// </summary>
    public static string HataMetni(Exception hata)
    {
        var parcalar = new List<string>();

        for (var h = hata; h is not null; h = h.InnerException)
        {
            var metin = h.Message?.Trim();

            if (!string.IsNullOrWhiteSpace(metin) && !parcalar.Contains(metin))
                parcalar.Add(metin);

            /* Sunucunun döndürdüğü kod sebebi tek başına söylüyor:
               kimlik doğrulama reddi başka, kutu bulunamadı bambaşka bir
               ayar demek. */
            if (h is SmtpCommandException komut)
                parcalar.Add($"SMTP yanıtı: {komut.StatusCode} ({komut.ErrorCode})");
            else if (h is AuthenticationException)
                parcalar.Add("Kimlik doğrulanamadı: kullanıcı adı ya da parola hatalı.");
        }

        return string.Join(" — ", parcalar);
    }

    /// <summary>
    /// Okunan ayarlar; parola yerine yalnızca dolu olup olmadığı.
    /// Tanı ekranı için: sunucunun gerçekte neyi okuduğunu görmeden
    /// "ayarları girdim ama gitmiyor" sorusunu çözmek tahmine kalıyordu.
    /// </summary>
    public object Tani()
    {
        var a = Ayarlar();

        return new
        {
            sunucu = a.sunucu,
            port = a.port,
            kullanici = a.kullanici,
            parolaVar = !string.IsNullOrWhiteSpace(a.parola),
            gonderenAd = a.gonderenAd,
            gonderenAdres = a.gonderenAdres,
            ssl = a.ssl,
            hazir = !string.IsNullOrWhiteSpace(a.sunucu)
                 && !string.IsNullOrWhiteSpace(a.gonderenAdres),
        };
    }

    /// <summary>Ayarlar okunabiliyor mu; ekranlarda uyarı için.</summary>
    public bool Hazir()
    {
        var a = Ayarlar();

        return !string.IsNullOrWhiteSpace(a.sunucu)
            && !string.IsNullOrWhiteSpace(a.gonderenAdres);
    }

    /// <summary>Tek alıcıya gönderir.</summary>
    public Task Gonder(string adres, string konu, string govde, string ekYolu = null)
        => Gonder(new[] { adres }, konu, govde, ekYolu);

    /// <summary>
    /// Birden çok alıcıya gönderir.
    ///
    /// Adresler tek tek değil tek iletide: aynı belgeyi üç adrese ayrı
    /// ayrı göndermek, alıcıların birbirini görmemesine ve cevapların
    /// dağılmasına yol açıyordu.
    /// </summary>
    public async Task Gonder(
        IEnumerable<string> adresler,
        string konu,
        string govde,
        string ekYolu = null)
    {
        var a = Ayarlar();

        if (string.IsNullOrWhiteSpace(a.sunucu))
            throw new InvalidOperationException(
                "Mail sunucusu tanımlı değil. Yönetim → Mail Ayarları ekranından giriniz.");

        var hedefler = (adresler ?? Enumerable.Empty<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (hedefler.Count == 0)
            throw new InvalidOperationException("Gönderilecek adres yok.");

        var ileti = new MimeMessage();

        ileti.From.Add(new MailboxAddress(
            string.IsNullOrWhiteSpace(a.gonderenAd) ? a.gonderenAdres : a.gonderenAd,
            a.gonderenAdres));

        foreach (var h in hedefler) ileti.To.Add(MailboxAddress.Parse(h));

        ileti.Subject = konu;

        var kurucu = new BodyBuilder
        {
            HtmlBody = string.IsNullOrWhiteSpace(a.imza)
                ? govde
                : $"{govde}<hr style=\"border:none;border-top:1px solid #e3e6e1;margin:18px 0\">{a.imza}",
        };

        if (!string.IsNullOrWhiteSpace(ekYolu) && File.Exists(ekYolu))
            kurucu.Attachments.Add(ekYolu);

        ileti.Body = kurucu.ToMessageBody();

        using var istemci = new SmtpClient { Timeout = 20000 };

        /* Sunucu sertifikası doğrulanmıyor: kurum içi ve barındırma
           sağlayıcılarının sertifikaları çoğu zaman alan adıyla
           eşleşmiyor ve mail hiç gitmiyordu. */
        istemci.ServerCertificateValidationCallback = (_, _, _, _) => true;

        /* Şifreleme porta göre seçiliyor.

           465 implicit SSL (bağlantı baştan şifreli), 587 ise STARTTLS
           (düz başlayıp şifrelemeye geçiliyor). İkisi aynı şey değil ve
           .NET'in SmtpClient sınıfı yalnızca ikincisini yapabiliyordu:
           465 girildiğinde bağlantı hiç kurulamıyor, mail sessizce
           gitmiyordu. */
        var secenek = !a.ssl
            ? SecureSocketOptions.None
            : a.port == 465
                ? SecureSocketOptions.SslOnConnect
                : SecureSocketOptions.StartTlsWhenAvailable;

        await istemci.ConnectAsync(a.sunucu, a.port, secenek);

        /* Kullanıcı adı boşsa kimlik doğrulaması yapılmıyor: iç ağdaki
           röle sunucuları parola istemiyor ve boş kimlikle bağlanmak
           gönderimi engelliyordu. */
        if (!string.IsNullOrWhiteSpace(a.kullanici))
            await istemci.AuthenticateAsync(a.kullanici, a.parola);

        await istemci.SendAsync(ileti);
        await istemci.DisconnectAsync(true);

        _kayit.LogInformation("Mail gönderildi: {Konu} → {Adres}",
            konu, string.Join(", ", hedefler));
    }

    /* ====================================================================== */

    private (string sunucu, int port, string kullanici, string parola,
             string gonderenAd, string gonderenAdres, bool ssl, string imza) Ayarlar()
    {
        try
        {
            using var db = _vt.Baglanti();

            var d = db.Query<(string anahtar, string deger)>(
                "SELECT anahtar, deger FROM B360_AYAR WHERE anahtar LIKE 'mail%'")
                .ToDictionary(x => x.anahtar, x => x.deger,
                    StringComparer.OrdinalIgnoreCase);

            string Oku(string a) => d.TryGetValue(a, out var v) ? v : "";

            return (
                Oku("mailSunucu"),
                int.TryParse(Oku("mailPort"), out var p) ? p : 587,
                Oku("mailKullanici"),
                Oku("mailParola"),
                Oku("mailGonderenAd"),
                Oku("mailGonderenAdres"),
                Oku("mailSsl") != "false",
                Oku("mailImza"));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Mail ayarları okunamadı");

            return ("", 587, "", "", "", "", true, "");
        }
    }
}

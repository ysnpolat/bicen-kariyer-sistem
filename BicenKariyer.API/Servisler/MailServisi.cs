using System.Text;
using System.Text.Json;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// SMTP üzerinden mail gönderimi ve HTML şablonları.
///
/// Şablonlarda yalnızca satır içi stil ve tablo yerleşimi kullanılır;
/// Outlook dahil tüm istemcilerde bozulmadan görünmesi için gereklidir.
/// </summary>
public class MailServisi
{
    private readonly AyarServisi _ayar;
    private readonly ILogger<MailServisi> _kayit;

    public MailServisi(AyarServisi ayar, ILogger<MailServisi> kayit)
    {
        _ayar = ayar;
        _kayit = kayit;
    }

    /// <summary>Son gönderim denemesinde oluşan hatanın açıklaması.</summary>
    public string SonHataMesaji { get; private set; }

    /* ==================================================================== */
    /* Renkler                                                              */
    /* ==================================================================== */

    private const string Yesil = "#7CB518";
    private const string YesilKoyu = "#5F8C10";
    private const string YesilAcik = "#F2F9E8";
    private const string Turuncu = "#E8481C";
    private const string Siyah = "#1D2126";
    private const string Metin = "#1F2933";
    private const string Pasif = "#6B7280";
    private const string Cizgi = "#E3E6E1";

    /* ==================================================================== */
    /* Gönderim                                                             */
    /* ==================================================================== */

    /* Son gönderim durumu (03.10.2026): Yönetim → Genel bakış'taki
       "Dikkat isteyenler" için. Servis istek başına oluşturulduğundan
       durum süreç geneli tutuluyor; uygulama yeniden başlayınca sıfırlanır.
       Alıcısı olmayan gönderimler (maili tanımsız şube) sunucu hatası
       sayılmıyor, durumu değiştirmiyor. */
    private static readonly object _durumKilidi = new();
    public static DateTime? SonBasariZamani { get; private set; }
    public static DateTime? SonHataZamani { get; private set; }
    public static string SonHataAciklamasi { get; private set; }

    public async Task<bool> GonderAsync(
        IEnumerable<string> alicilar, string konu, string govde, MailAyarlari ayarlar = null,
        IEnumerable<(string Ad, byte[] Veri)> ekler = null)
    {
        var sonuc = await GonderIcAsync(alicilar, konu, govde, ayarlar, ekler);

        if (sonuc || SonHataMesaji != "Alıcı adresi tanımlı değil.")
        {
            lock (_durumKilidi)
            {
                if (sonuc)
                {
                    SonBasariZamani = DateTime.Now;
                }
                else
                {
                    SonHataZamani = DateTime.Now;
                    SonHataAciklamasi = SonHataMesaji;
                }
            }
        }

        return sonuc;
    }

    private async Task<bool> GonderIcAsync(
        IEnumerable<string> alicilar, string konu, string govde, MailAyarlari ayarlar,
        IEnumerable<(string Ad, byte[] Veri)> ekler)
    {
        var a = ayarlar ?? _ayar.MailOku();

        var hedefler = alicilar?
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct()
            .ToList() ?? new List<string>();

        SonHataMesaji = null;

        if (string.IsNullOrWhiteSpace(a.Sunucu))
        {
            SonHataMesaji = "SMTP sunucu adresi tanımlı değil.";
            _kayit.LogWarning(SonHataMesaji);
            return false;
        }

        if (hedefler.Count == 0)
        {
            SonHataMesaji = "Alıcı adresi tanımlı değil.";
            _kayit.LogWarning(SonHataMesaji);
            return false;
        }

        var gonderenAdres = string.IsNullOrWhiteSpace(a.GonderenAdres)
            ? a.KullaniciAdi
            : a.GonderenAdres;

        if (string.IsNullOrWhiteSpace(gonderenAdres))
        {
            SonHataMesaji = "Gönderen adres tanımlı değil.";
            _kayit.LogWarning(SonHataMesaji);
            return false;
        }

        try
        {
            var ileti = new MimeMessage();
            ileti.From.Add(new MailboxAddress(a.GonderenAd ?? "Biçen Kariyer", gonderenAdres));

            foreach (var hedef in hedefler)
                ileti.To.Add(MailboxAddress.Parse(hedef));

            ileti.Subject = konu;
            var govdeYapici = new BodyBuilder { HtmlBody = govde };

            /* Ek dosyalar (örneğin puan yükleme listesi) */
            foreach (var (ad, veri) in ekler ?? Enumerable.Empty<(string, byte[])>())
                if (veri is { Length: > 0 }) govdeYapici.Attachments.Add(ad, veri);

            ileti.Body = govdeYapici.ToMessageBody();

            using var istemci = new SmtpClient();
            istemci.Timeout = 20000;
            istemci.ServerCertificateValidationCallback = (_, _, _, _) => true;

            var secenek = (a.SifrelemeTuru ?? "Otomatik") switch
            {
                "SSL" => SecureSocketOptions.SslOnConnect,
                "STARTTLS" => SecureSocketOptions.StartTls,
                "Yok" => SecureSocketOptions.None,
                _ => a.SslKullan
                    ? (a.Port == 465
                        ? SecureSocketOptions.SslOnConnect
                        : SecureSocketOptions.StartTlsWhenAvailable)
                    : SecureSocketOptions.None
            };

            await istemci.ConnectAsync(a.Sunucu, a.Port, secenek);

            if (!string.IsNullOrWhiteSpace(a.KullaniciAdi))
                await istemci.AuthenticateAsync(a.KullaniciAdi, a.Parola);

            await istemci.SendAsync(ileti);
            await istemci.DisconnectAsync(true);

            return true;
        }
        catch (MailKit.Security.AuthenticationException hata)
        {
            SonHataMesaji =
                "Kimlik doğrulama başarısız. Kullanıcı adı veya parola hatalı. " +
                $"Sunucu yanıtı: {hata.Message}";
            _kayit.LogError(hata, "SMTP kimlik doğrulama hatası");
            return false;
        }
        catch (MailKit.ServiceNotAuthenticatedException hata)
        {
            SonHataMesaji = $"Sunucu kimlik doğrulama istedi ancak kabul etmedi: {hata.Message}";
            _kayit.LogError(hata, "SMTP kimlik doğrulama hatası");
            return false;
        }
        catch (MailKit.Net.Smtp.SmtpCommandException hata)
        {
            SonHataMesaji =
                $"Sunucu isteği reddetti ({hata.StatusCode}). Mesaj: {hata.Message}" +
                (hata.Mailbox != null ? $" · İlgili adres: {hata.Mailbox.Address}" : "");
            _kayit.LogError(hata, "SMTP komut hatası");
            return false;
        }
        catch (MailKit.Net.Smtp.SmtpProtocolException hata)
        {
            SonHataMesaji =
                "Şifreleme uyuşmazlığı olabilir. Port ve şifreleme türünü kontrol ediniz " +
                $"(587 için STARTTLS, 465 için SSL, 25 için Yok). Ayrıntı: {hata.Message}";
            _kayit.LogError(hata, "SMTP protokol hatası");
            return false;
        }
        catch (System.Net.Sockets.SocketException hata)
        {
            SonHataMesaji =
                $"Sunucuya bağlanılamadı ({a.Sunucu}:{a.Port}). Adres, port veya güvenlik " +
                $"duvarı engeli olabilir. Ayrıntı: {hata.Message}";
            _kayit.LogError(hata, "SMTP bağlantı hatası");
            return false;
        }
        catch (Exception hata)
        {
            SonHataMesaji = hata.InnerException is null
                ? hata.Message
                : $"{hata.Message} · {hata.InnerException.Message}";
            _kayit.LogError(hata, "Mail gönderiminde hata oluştu.");
            return false;
        }
    }

    /* ==================================================================== */
    /* Şablon iskeleti                                                      */
    /* ==================================================================== */

    private string SiteAdresi()
    {
        var adres = _ayar.MailOku().SiteAdresi;
        return string.IsNullOrWhiteSpace(adres)
            ? "https://kariyer.bicen.com.tr"
            : adres.TrimEnd('/');
    }

    /// <summary>Ortak dış çerçeve: üst şerit, içerik alanı ve alt bilgi.</summary>
    private string Cerceve(string ustBaslik, string ustRenk, string icerik, string altNot = null)
    {
        var site = SiteAdresi();
        var logo = $"{site}/apiservis/api/Logo";
        var yil = DateTime.Now.Year;
        var siteGorunen = site.Replace("https://", "").Replace("http://", "");

        var altNotHtml = string.IsNullOrWhiteSpace(altNot)
            ? ""
            : $@"<tr><td style=""padding:22px 32px 26px;font-size:12.5px;line-height:1.6;color:{Pasif};text-align:center"">{altNot}</td></tr>";

        return $@"<!doctype html>
<html lang=""tr"">
<head>
<meta charset=""utf-8"" />
<meta name=""viewport"" content=""width=device-width,initial-scale=1"" />
<title>{Kacir(ustBaslik)}</title>
</head>
<body style=""margin:0;padding:0;background:#F4F6F2;"">
<table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
       style=""background:#F4F6F2;padding:28px 12px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;"">
  <tr>
    <td align=""center"">

      <table role=""presentation"" width=""600"" cellpadding=""0"" cellspacing=""0"" border=""0""
             style=""width:600px;max-width:100%;background:#FFFFFF;border-radius:14px;
                    overflow:hidden;box-shadow:0 6px 22px rgba(31,41,51,.08);"">

        <tr><td style=""height:6px;background:{ustRenk};font-size:0;line-height:0;"">&nbsp;</td></tr>

        <tr>
          <td align=""center"" style=""padding:26px 32px 6px;"">
            <img src=""{logo}"" alt=""Biçen Market"" height=""46""
                 style=""height:46px;display:block;border:0;outline:none;text-decoration:none;"" />
          </td>
        </tr>

        <tr>
          <td align=""center"" style=""padding:6px 32px 0;"">
            <div style=""font-size:20px;font-weight:700;color:{Metin};letter-spacing:.2px;"">
              {Kacir(ustBaslik)}
            </div>
            <div style=""width:52px;height:3px;background:{ustRenk};border-radius:3px;margin:12px auto 0;""></div>
          </td>
        </tr>

        {icerik}

        {altNotHtml}

        <tr>
          <td style=""background:{Siyah};padding:22px 32px;text-align:center;"">
            <div style=""color:#FFFFFF;font-size:14px;font-weight:700;letter-spacing:.3px;"">
              BİÇEN MARKET
            </div>
            <div style=""color:#B9C0B4;font-size:12px;margin-top:4px;"">
              İnsan Kaynakları Departmanı
            </div>
            <div style=""color:#8E958A;font-size:11px;margin-top:12px;line-height:1.6;"">
              Bu e-posta {Kacir(siteGorunen)} üzerinden yapılan başvurunuz nedeniyle
              gönderilmiştir.<br />
              &copy; {yil} Biçen Market · Tüm hakları saklıdır.
            </div>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>";
    }

    private static string Paragraf(string metin, string ustBosluk = "18px") =>
        $@"<tr><td style=""padding:{ustBosluk} 32px 0;font-size:14.5px;line-height:1.7;color:{Metin}"">{metin}</td></tr>";

    private static string BilgiTablosu(params (string Etiket, string Deger)[] satirlar)
    {
        var sb = new StringBuilder();
        sb.Append($@"<tr><td style=""padding:20px 32px 0"">
          <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
                 style=""border:1px solid {Cizgi};border-radius:10px;overflow:hidden"">");

        var tek = true;
        foreach (var (etiket, deger) in satirlar)
        {
            if (string.IsNullOrWhiteSpace(deger) || deger.Trim() == "·") continue;

            var zemin = tek ? "#FBFCFA" : "#FFFFFF";
            tek = !tek;

            sb.Append($@"
            <tr>
              <td style=""padding:11px 14px;background:{zemin};font-size:13px;color:{Pasif};
                         width:42%;border-bottom:1px solid {Cizgi}"">{Kacir(etiket)}</td>
              <td style=""padding:11px 14px;background:{zemin};font-size:13.5px;color:{Metin};
                         font-weight:600;border-bottom:1px solid {Cizgi}"">{Kacir(deger)}</td>
            </tr>");
        }

        sb.Append("</table></td></tr>");
        return sb.ToString();
    }

    private static string Dugme(string metin, string adres, string renk) => $@"
        <tr>
          <td align=""center"" style=""padding:24px 32px 0"">
            <a href=""{adres}"" target=""_blank""
               style=""display:inline-block;background:{renk};color:#FFFFFF;text-decoration:none;
                      font-size:14.5px;font-weight:700;padding:13px 30px;border-radius:9px"">
              {Kacir(metin)}
            </a>
          </td>
        </tr>";

    private static string Bosluk(string yukseklik = "28px") =>
        $@"<tr><td style=""height:{yukseklik};font-size:0;line-height:0"">&nbsp;</td></tr>";

    /* ==================================================================== */
    /* 1. Adaya: başvurunuz alındı                                          */
    /* ==================================================================== */

    public async Task<bool> AdayaBilgiAsync(
        string eposta, string adSoyad, string basvuruNo,
        string subeAdi = null, string bolumler = null)
    {
        var a = _ayar.MailOku();
        if (!a.AdayaBilgiMailiGonder || string.IsNullOrWhiteSpace(eposta)) return false;

        return await GonderAsync(
            new[] { eposta },
            $"Başvurunuz alındı · {basvuruNo}",
            BasvuruAlindiGovdesi(adSoyad, basvuruNo, subeAdi, bolumler),
            a);
    }

    public string BasvuruAlindiGovdesi(
        string adSoyad, string basvuruNo, string subeAdi, string bolumler)
    {
        var site = SiteAdresi();
        var icerik = new StringBuilder();

        icerik.Append(Paragraf($"Sayın <strong>{Kacir(adSoyad)}</strong>,", "22px"));

        icerik.Append(Paragraf(
            "Biçen Market'e yaptığınız iş başvurusu tarafımıza ulaşmıştır. " +
            "İlginiz için teşekkür ederiz."));

        icerik.Append($@"
        <tr>
          <td style=""padding:22px 32px 0"">
            <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"">
              <tr>
                <td align=""center"" style=""background:{YesilAcik};border:1px solid #DCEBC4;
                           border-radius:12px;padding:20px"">
                  <div style=""font-size:12px;color:{Pasif};letter-spacing:.8px;
                              text-transform:uppercase"">Başvuru Numaranız</div>
                  <div style=""font-size:24px;font-weight:800;color:{YesilKoyu};
                              margin-top:8px;letter-spacing:.5px"">{Kacir(basvuruNo)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>");

        icerik.Append(BilgiTablosu(
            ("Başvuru Tarihi", DateTime.Now.ToString("dd.MM.yyyy HH:mm")),
            ("Başvurulan Şube", subeAdi),
            ("Başvurulan Bölümler", bolumler)));

        icerik.Append(Paragraf(
            "Başvurunuz İnsan Kaynakları ekibimiz tarafından değerlendirilecektir. " +
            "Profiliniz açık pozisyonlarımızla eşleştiğinde sizinle iletişime geçeceğiz."));

        icerik.Append(Dugme("Başvurumu Görüntüle", $"{site}/#/sorgula", Yesil));

        icerik.Append(Paragraf(
            $@"<span style=""color:{Pasif};font-size:13px"">Başvurunuzu görüntülemek için
               kimlik numaranız ve başvuruda kullandığınız cep telefonunuz yeterlidir.</span>",
            "12px"));

        icerik.Append(Bosluk());

        return Cerceve(
            "Başvurunuz Alındı",
            Yesil,
            icerik.ToString(),
            "Bu mesaj otomatik olarak gönderilmiştir, lütfen yanıtlamayınız.");
    }

    /* ==================================================================== */
    /* 2. Adaya: görüşme daveti                                             */
    /* ==================================================================== */

    public async Task<bool> GorusmeDavetiAsync(
        string eposta, string adSoyad, DateTime tarih, string yer, string aciklama,
        Kullanici yetkili = null, string adres = null, string harita = null)
    {
        if (string.IsNullOrWhiteSpace(eposta)) return false;

        return await GonderAsync(
            new[] { eposta },
            $"Görüşme Daveti · {tarih:dd.MM.yyyy HH:mm} · Biçen Market",
            GorusmeDavetiGovdesi(adSoyad, tarih, yer, aciklama, yetkili, adres, harita));
    }

    private static readonly string[] Gunler =
        { "Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi" };

    private static readonly string[] Aylar =
    {
        "", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
        "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
    };

    public string GorusmeDavetiGovdesi(
        string adSoyad, DateTime tarih, string yer, string aciklama,
        Kullanici yetkili = null, string adres = null, string harita = null)
    {
        var gunAdi = Gunler[(int)tarih.DayOfWeek];
        var tarihMetni = $"{tarih.Day} {Aylar[tarih.Month]} {tarih.Year}";

        var icerik = new StringBuilder();

        icerik.Append(Paragraf($"Sayın <strong>{Kacir(adSoyad)}</strong>,", "22px"));

        icerik.Append(Paragraf(
            "Başvurunuz değerlendirilmiş olup sizinle tanışmak istiyoruz. " +
            "Görüşme bilgileri aşağıda yer almaktadır."));

        icerik.Append($@"
        <tr>
          <td style=""padding:22px 32px 0"">
            <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0""
                   style=""border:2px solid {Yesil};border-radius:12px;overflow:hidden"">
              <tr>
                <td width=""110"" align=""center""
                    style=""background:{Yesil};padding:18px 10px;vertical-align:middle"">
                  <div style=""color:#FFFFFF;font-size:32px;font-weight:800;line-height:1"">
                    {tarih.Day}
                  </div>
                  <div style=""color:#EAF4D8;font-size:13px;font-weight:600;margin-top:4px"">
                    {Aylar[tarih.Month]}
                  </div>
                </td>
                <td style=""padding:16px 18px;background:#FFFFFF"">
                  <div style=""font-size:11.5px;color:{Pasif};letter-spacing:.6px;
                              text-transform:uppercase"">Görüşme Tarihi</div>
                  <div style=""font-size:16.5px;font-weight:700;color:{Metin};margin-top:5px"">
                    {tarihMetni} · {gunAdi}
                  </div>
                  <div style=""font-size:15px;font-weight:700;color:{YesilKoyu};margin-top:6px"">
                    Saat {tarih:HH:mm}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>");

        /* Tüm görüşmeler Genel Müdürlük'te yapılıyor; adres ve konum
           bağlantısı davetin içinde olsun ki aday ayrıca sormasın. */
        var satirlar = new List<(string, string)> { ("Görüşme Yeri", yer) };

        if (!string.IsNullOrWhiteSpace(adres))
            satirlar.Add(("Adres", adres));

        satirlar.Add(("Yanınızda Getiriniz", "Kimlik belgeniz"));

        icerik.Append(BilgiTablosu(satirlar.ToArray()));

        if (!string.IsNullOrWhiteSpace(harita))
        {
            icerik.Append($@"
        <tr>
          <td style=""padding:16px 32px 0"" align=""center"">
            <a href=""{Kacir(harita)}""
               style=""display:inline-block;background:{Yesil};color:#FFFFFF;
                      text-decoration:none;font-size:14px;font-weight:700;
                      padding:12px 26px;border-radius:10px"">
              Konumu haritada aç
            </a>
          </td>
        </tr>");
        }

        if (!string.IsNullOrWhiteSpace(aciklama))
        {
            icerik.Append($@"
        <tr>
          <td style=""padding:20px 32px 0"">
            <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"">
              <tr>
                <td style=""background:#FFF8F2;border-left:3px solid {Turuncu};
                           border-radius:8px;padding:14px 16px"">
                  <div style=""font-size:11.5px;color:{Turuncu};font-weight:700;
                              letter-spacing:.5px;text-transform:uppercase"">Önemli Not</div>
                  <div style=""font-size:13.5px;color:{Metin};line-height:1.6;margin-top:6px"">
                    {Kacir(aciklama)}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>");
        }

        icerik.Append(Dugme("Takvimime Ekle", TakvimAdresi(tarih, yer), Yesil));

        icerik.Append(Paragraf(
            $@"<span style=""color:{Pasif};font-size:13px"">Belirtilen tarihte görüşmeye
               katılamayacaksanız lütfen aşağıdaki numaradan bilgi veriniz.</span>",
            "14px"));

        icerik.Append(YetkiliImzasi(yetkili));
        icerik.Append(Bosluk());

        return Cerceve(
            "Görüşme Daveti",
            Yesil,
            icerik.ToString(),
            "Görüşme ile ilgili değişiklik taleplerinizi İnsan Kaynakları " +
            "departmanımıza iletebilirsiniz.");
    }

    /// <summary>
    /// Görüşmeyi oluşturan İK personelinin imza kartı.
    /// Ünvan ve telefon, kullanıcının kendi profilinden alınır.
    /// </summary>
    private string YetkiliImzasi(Kullanici yetkili)
    {
        if (yetkili is null || string.IsNullOrWhiteSpace(yetkili.AdSoyad))
            return "";

        var unvan = string.IsNullOrWhiteSpace(yetkili.Unvan)
            ? "İnsan Kaynakları"
            : yetkili.Unvan;

        var satirlar = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(yetkili.Telefon))
        {
            satirlar.Append($@"
                  <div style=""font-size:13.5px;color:{Metin};margin-top:8px"">
                    <a href=""tel:{Kacir(yetkili.Telefon.Replace(" ", ""))}""
                       style=""color:{YesilKoyu};text-decoration:none;font-weight:700"">
                      {Kacir(yetkili.Telefon)}
                    </a>
                  </div>");
        }

        if (!string.IsNullOrWhiteSpace(yetkili.Eposta))
        {
            satirlar.Append($@"
                  <div style=""font-size:13px;margin-top:3px"">
                    <a href=""mailto:{Kacir(yetkili.Eposta)}""
                       style=""color:{Pasif};text-decoration:none"">{Kacir(yetkili.Eposta)}</a>
                  </div>");
        }

        return $@"
        <tr>
          <td style=""padding:24px 32px 0"">
            <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" border=""0"">
              <tr>
                <td style=""background:#FBFCFA;border:1px solid {Cizgi};border-left:3px solid {Yesil};
                           border-radius:10px;padding:16px 18px"">
                  <div style=""font-size:11.5px;color:{Pasif};letter-spacing:.5px;
                              text-transform:uppercase"">Görüşmeyi Planlayan</div>
                  <div style=""font-size:15.5px;font-weight:700;color:{Metin};margin-top:6px"">
                    {Kacir(yetkili.AdSoyad)}
                  </div>
                  <div style=""font-size:13px;color:{Pasif};margin-top:2px"">{Kacir(unvan)}</div>
                  {satirlar}
                </td>
              </tr>
            </table>
          </td>
        </tr>";
    }

    /// <summary>Google Takvim'e etkinlik ekleme bağlantısı</summary>
    private static string TakvimAdresi(DateTime tarih, string yer)
    {
        var bas = tarih.ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");
        var bit = tarih.AddHours(1).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'");

        var baslik = Uri.EscapeDataString("Biçen Market - İş Görüşmesi");
        var konum = Uri.EscapeDataString(yer ?? "");

        return "https://calendar.google.com/calendar/render?action=TEMPLATE" +
               $"&text={baslik}&dates={bas}/{bit}&location={konum}";
    }

    /* ==================================================================== */
    /* 3. İK'ya: yeni başvuru bildirimi                                     */
    /* ==================================================================== */

    public async Task<bool> BasvuruBildirAsync(string veriJson, string basvuruNo)
    {
        var a = _ayar.MailOku();
        if (!a.BasvuruMailiGonder || a.AliciAdresler.Count == 0) return false;

        using var belge = JsonDocument.Parse(veriJson);
        var kok = belge.RootElement;

        string Al(string alan) => kok.TryGetProperty(alan, out var d) ? Metinlestir(d) : "";

        var konu = $"Yeni İş Başvurusu: {Al("adayAdSoyad")} ({basvuruNo})";

        return await GonderAsync(a.AliciAdresler, konu, BasvuruBildirimGovdesi(kok, basvuruNo), a);
    }

    public string BasvuruBildirimGovdesi(JsonElement kok, string basvuruNo)
    {
        string Al(string alan) => kok.TryGetProperty(alan, out var d) ? Metinlestir(d) : "";

        var site = SiteAdresi();
        var icerik = new StringBuilder();

        icerik.Append($@"
        <tr>
          <td align=""center"" style=""padding:18px 32px 0"">
            <span style=""display:inline-block;background:{YesilAcik};color:{YesilKoyu};
                         font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:20px"">
              {Kacir(basvuruNo)}
            </span>
          </td>
        </tr>");

        icerik.Append(Paragraf(
            $@"<strong style=""font-size:16px"">{Kacir(Al("adayAdSoyad"))}</strong>
               adlı aday yeni bir iş başvurusu gönderdi.", "16px"));

        var engel = Al("engelDurumuVarMi") == "Evet"
            ? $"Var · %{Al("engelOrani")} · {Al("engelTurleri")}"
            : "Yok";

        icerik.Append(BilgiTablosu(
            ("Uyruk / Kimlik No", $"{Al("uyruk")} · {Al("tcKimlikNo")}"),
            ("Doğum Tarihi / Yeri", $"{Al("dogumTarihi")} · {Al("dogumYeri")}"),
            ("Telefon", Al("cepTel1")),
            ("E-posta", Al("email")),
            ("Adres", $"{Al("mahalle")} · {Al("ilce")} · {Al("il")}"),
            ("Eğitim", $"{Al("egitimSeviyesi")} {Al("mezunOkul")}".Trim()),
            ("Askerlik", Al("askerlikDurumu")),
            ("Engel Durumu", engel),
            ("Başvurulan Şube", Al("subeAdi")),
            ("Başvurulan Bölümler", Al("bolumler")),
            ("Ücret Beklentisi", Al("talepEdilenNetUcret")),
            ("İşe Başlayabileceği Tarih", Al("iseBaslamaTarihi"))));

        icerik.Append(Dugme("Panelde İncele", $"{site}/panel", Siyah));
        icerik.Append(Bosluk());

        return Cerceve(
            "Yeni İş Başvurusu",
            Turuncu,
            icerik.ToString(),
            "Başvurunun tamamını, fotoğrafını ve sertifikalarını İnsan Kaynakları " +
            "panelinden görüntüleyebilirsiniz.");
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    private static string Metinlestir(JsonElement d) => d.ValueKind switch
    {
        JsonValueKind.String => d.GetString(),
        JsonValueKind.Number => d.ToString(),
        JsonValueKind.True => "Evet",
        JsonValueKind.False => "Hayır",
        JsonValueKind.Array => string.Join(", ", d.EnumerateArray().Select(Metinlestir)),
        JsonValueKind.Null or JsonValueKind.Undefined => "",
        _ => d.ToString()
    };

    private static string Kacir(string deger) =>
        (deger ?? "")
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;");
}

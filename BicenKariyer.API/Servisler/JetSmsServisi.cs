using System.Text;
using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// JetSMS HTTP API üzerinden SMS gönderir (bkz. JetSMS "HTTP Yardım
/// Dokümanı", v2.5, 12.06.2026).
///
/// <para>
/// Uç nokta: <c>https://api.jetsms.com.tr/SMS-Web8/HttpSmsSend</c>,
/// POST + URL-encoded form gövdesi. Zorunlu alanlar: <c>Username</c>,
/// <c>Password</c>, <c>Msisdns</c>, <c>Messages</c>, <c>Originator</c>.
/// Yanıt JSON değil, düz metindir: <c>Status=0 MessageIDs=...</c>
/// (Status &lt; 0 ise hata; kodlar dokümanın 2.5 tablosunda).
/// </para>
///
/// <para>
/// Alan adları yine de appsettings.json üzerinden tanımlanır (hesap
/// değişirse kod değişikliği gerekmesin diye), ama varsayılanlar artık
/// gerçek dokümandaki adlarla eşleşiyor.
/// </para>
///
/// <para>
/// Yayınlamadan önce Yönetim panelindeki "SMS Sınama" ile bir test
/// numarasına gönderim deneyip ham yanıtı görebilirsiniz.
/// </para>
/// </summary>
public class JetSmsServisi
{
    private readonly IHttpClientFactory _istemciUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<JetSmsServisi> _kayit;

    public JetSmsServisi(
        IHttpClientFactory istemciUretici,
        IConfiguration yapilandirma,
        ILogger<JetSmsServisi> kayit)
    {
        _istemciUretici = istemciUretici;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    public bool Etkin =>
        _yapilandirma.GetValue("JetSms:Acik", false) &&
        !string.IsNullOrWhiteSpace(_yapilandirma["JetSms:KullaniciAdi"]);

    private string Adres => _yapilandirma["JetSms:Adres"]
        ?? "https://api.jetsms.com.tr/SMS-Web8/HttpSmsSend";

    private string KullaniciAdi => _yapilandirma["JetSms:KullaniciAdi"] ?? "";
    private string Sifre => _yapilandirma["JetSms:Sifre"] ?? "";
    private string Gonderici => _yapilandirma["JetSms:Gonderici"] ?? "";

    /// <summary>
    /// İstek alanlarının adları. Varsayılanlar JetSMS HTTP dokümanındaki
    /// (v2.5) gerçek parametre adlarıdır; hesabınızda farklıysa
    /// appsettings.json → JetSms → Alanlar içinde değiştirin.
    /// </summary>
    private string Alan(string anahtar, string varsayilan) =>
        _yapilandirma[$"JetSms:Alanlar:{anahtar}"] ?? varsayilan;

    /// <summary>Dokümandaki 2.5 Status Kodları tablosu.</summary>
    private static string StatusAciklama(int durum) => durum switch
    {
        0 => "Başarılı",
        -5 => "Login hatası: Username, Password ya da Originator uyuşmuyor.",
        -6 => "Girilen bir kısım veride hata oluştu.",
        -7 => "SendDate bugünden büyük ve geçerli bir tarih olmalıdır.",
        -8 => "En azından bir Msisdn bilgisi verilmelidir.",
        -9 => "En azından bir Message değeri verilmelidir.",
        -10 => "Msisdn ve Message sayıları uyuşmuyor.",
        -15 => "Sağlayıcı tarafında sistem hatası.",
        -99 => "Bilinmeyen hata.",
        _ => $"Bilinmeyen durum kodu ({durum})."
    };

    /// <summary>Gönderim sonucu</summary>
    public record Sonuc(bool Basarili, string Mesaj, string HamYanit);

    /// <summary>
    /// SMS gönderir. <paramref name="gsm"/> herhangi bir yaygın biçimde
    /// verilebilir (5xxxxxxxxx, 05xxxxxxxxx, 905xxxxxxxxx); JetSMS'in
    /// beklediği 12 haneli MSISDN (905xxxxxxxxx) biçimine normalize edilir.
    /// </summary>
    public async Task<Sonuc> Gonder(string gsm, string mesaj)
    {
        if (!Etkin)
            return new Sonuc(false, "SMS servisi kapalı ya da yapılandırılmamış.", null);

        var temizGsm = new string((gsm ?? "").Where(char.IsDigit).ToArray());

        /* Doküman örneği ülke koduyla birlikte 12 haneli MSISDN gösteriyor
           (Msisdns=905057047745). Formdan/aramadan ne gelirse gelsin
           (5xxxxxxxxx, 05xxxxxxxxx, 905xxxxxxxxx) bu forma normalize edilir. */
        if (temizGsm.StartsWith("0") && temizGsm.Length == 11)
            temizGsm = temizGsm[1..];

        if (temizGsm.Length == 10 && temizGsm.StartsWith("5"))
            temizGsm = "90" + temizGsm;

        if (temizGsm.Length != 12 || !temizGsm.StartsWith("905"))
            return new Sonuc(false, "Geçersiz telefon numarası.", null);

        if (string.IsNullOrWhiteSpace(Gonderici))
            return new Sonuc(false,
                "JetSms:Gonderici (Originator) tanımlı değil; bu alan JetSMS " +
                "dokümanına göre zorunludur.", null);

        if (Gonderici.Length > 11 || Gonderici.Any(c => c > 127))
            /* Doküman: Originator en fazla 11 karakter, alfanumerik bir
               başlık. JetSMS panelinde hesaba onaylı başlıkla birebir
               eşleşmesi gerekir; uzun ya da Türkçe karakterli bir değer
               "-5 Login hatası" ile reddedilir. */
            _kayit.LogWarning(
                "JetSms:Gonderici ('{Gonderici}') 11 karakteri aşıyor ya da " +
                "ASCII-dışı karakter içeriyor; JetSMS bunu reddedebilir.",
                Gonderici);

        try
        {
            var istemci = _istemciUretici.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(20);

            var alanlar = new Dictionary<string, string>
            {
                [Alan("Kullanici", "Username")] = KullaniciAdi,
                [Alan("Sifre", "Password")] = Sifre,
                [Alan("Gsm", "Msisdns")] = temizGsm,
                [Alan("Mesaj", "Messages")] = mesaj,
                [Alan("Baslik", "Originator")] = Gonderici,
            };

            using var govde = new FormUrlEncodedContent(alanlar);

            var cevap = await istemci.PostAsync(Adres, govde);
            var metin = await cevap.Content.ReadAsStringAsync();

            if (!cevap.IsSuccessStatusCode)
            {
                _kayit.LogWarning("JetSMS isteği başarısız: {Durum} {Metin}",
                    cevap.StatusCode, metin[..Math.Min(300, metin.Length)]);

                return new Sonuc(false,
                    $"Sağlayıcı hata döndü ({(int)cevap.StatusCode}).", metin);
            }

            /* Yanıt JSON değil, düz metin: "Status=0 MessageIDs=123" gibi.
               Status değerini ayıklayıp dokümandaki 2.5 tablosuna göre
               yorumlarız; ayrıştıramazsak eski sözcük-arama sezgisine düşer. */
            var eslesme = System.Text.RegularExpressions.Regex.Match(
                metin, @"Status\s*=\s*(-?\d+)");

            if (eslesme.Success && int.TryParse(eslesme.Groups[1].Value, out var durum))
            {
                var basarili = durum == 0;

                if (!basarili)
                    _kayit.LogWarning(
                        "JetSMS Status={Durum} ({Aciklama}). Ham yanıt: {Metin}",
                        durum, StatusAciklama(durum), metin[..Math.Min(300, metin.Length)]);

                return new Sonuc(basarili,
                    basarili ? "Gönderildi." : StatusAciklama(durum),
                    metin);
            }

            /* Status= alanı bulunamadıysa (beklenmedik format) eski
               sözcük-arama sezgisine düş. */
            var hataVarMi = metin.Contains("hata", StringComparison.OrdinalIgnoreCase)
                          || metin.Contains("error", StringComparison.OrdinalIgnoreCase)
                          || metin.TrimStart().StartsWith("-");

            _kayit.LogWarning("JetSMS yanıtında Status= alanı bulunamadı: {Metin}",
                metin[..Math.Min(300, metin.Length)]);

            return new Sonuc(!hataVarMi,
                hataVarMi ? "Sağlayıcı yanıtında hata belirtisi var." : "Gönderildi.",
                metin);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "JetSMS gönderimi yapılamadı");
            return new Sonuc(false, hata.Message, null);
        }
    }
}

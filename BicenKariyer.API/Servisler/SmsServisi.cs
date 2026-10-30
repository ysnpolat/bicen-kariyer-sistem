using System.Text;
using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Posta Güvercini OTP SMS servisi üzerinden SMS gönderir.
///
/// <para>
/// Uç nokta: <c>https://otpsms.postaguvercini.com/api_json/v1/Sms/Send_1_N</c>,
/// POST + JSON gövde. Alanlar: <c>Message</c>, <c>Receivers</c> (dizi),
/// <c>Username</c>, <c>Password</c>. Yanıt JSON'dur:
/// <c>{ StatusCode, StatusDescription, Result: [{ MessageId, Receiver }] }</c>
/// — <c>StatusCode</c> 200 dışında bir değerse hata vardır ve sebebi
/// <c>StatusDescription</c> alanında yazar.
/// </para>
///
/// <para>
/// Daha önce JetSMS kullanılıyordu; sağlayıcı Posta Güvercini olarak
/// değiştirildi. Ayarlar <c>appsettings.json → Sms</c> altındadır.
/// Yayınlamadan önce Yönetim panelindeki "SMS Sınama" ile bir test
/// numarasına gönderim deneyip ham yanıtı görebilirsiniz.
/// </para>
/// </summary>
public class SmsServisi
{
    private readonly IHttpClientFactory _istemciUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<SmsServisi> _kayit;

    public SmsServisi(
        IHttpClientFactory istemciUretici,
        IConfiguration yapilandirma,
        ILogger<SmsServisi> kayit)
    {
        _istemciUretici = istemciUretici;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    public bool Etkin =>
        _yapilandirma.GetValue("Sms:Acik", false) &&
        !string.IsNullOrWhiteSpace(_yapilandirma["Sms:KullaniciAdi"]);

    private string Adres => _yapilandirma["Sms:Adres"]
        ?? "https://otpsms.postaguvercini.com/api_json/v1/Sms/Send_1_N";

    private string KullaniciAdi => _yapilandirma["Sms:KullaniciAdi"] ?? "";
    private string Sifre => _yapilandirma["Sms:Sifre"] ?? "";

    public record Sonuc(bool Basarili, string Mesaj, string HamYanit);

    /// <summary>
    /// SMS gönderir. <paramref name="gsm"/> herhangi bir yaygın biçimde
    /// verilebilir (5xxxxxxxxx, 05xxxxxxxxx, 905xxxxxxxxx); sağlayıcının
    /// beklediği 12 haneli biçime (905xxxxxxxxx) normalize edilir.
    /// </summary>
    public async Task<Sonuc> Gonder(string gsm, string mesaj)
    {
        if (!Etkin)
            return new Sonuc(false, "SMS servisi kapalı ya da yapılandırılmamış.", null);

        var temizGsm = new string((gsm ?? "").Where(char.IsDigit).ToArray());

        if (temizGsm.StartsWith("0") && temizGsm.Length == 11)
            temizGsm = temizGsm[1..];

        if (temizGsm.Length == 10 && temizGsm.StartsWith("5"))
            temizGsm = "90" + temizGsm;

        if (temizGsm.Length != 12 || !temizGsm.StartsWith("905"))
            return new Sonuc(false, "Geçersiz telefon numarası.", null);

        if (string.IsNullOrWhiteSpace(mesaj))
            return new Sonuc(false, "Mesaj metni boş olamaz.", null);

        try
        {
            var istemci = _istemciUretici.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(20);

            var istek = new
            {
                Message = mesaj,
                Receivers = new[] { temizGsm },
                Username = KullaniciAdi,
                Password = Sifre
            };

            using var govde = new StringContent(
                JsonSerializer.Serialize(istek), Encoding.UTF8, "application/json");

            var cevap = await istemci.PostAsync(Adres, govde);
            var metin = await cevap.Content.ReadAsStringAsync();

            var kisaltilmis = metin[..Math.Min(300, metin.Length)];

            if (!cevap.IsSuccessStatusCode)
            {
                _kayit.LogWarning("SMS isteği başarısız: {Durum} {Metin}",
                    cevap.StatusCode, kisaltilmis);

                return new Sonuc(false,
                    $"Sağlayıcı hata döndü ({(int)cevap.StatusCode}).", metin);
            }

            /* Yanıt: { 'StatusCode': 200, 'StatusDescription': '...', 'Result': [...] }
               StatusCode 200 dışında bir değerse gönderim yapılmamıştır. */
            try
            {
                using var belge = JsonDocument.Parse(metin);
                var kok = belge.RootElement;

                var durum = kok.TryGetProperty("StatusCode", out var kod)
                            && kod.TryGetInt32(out var sayi)
                    ? sayi
                    : -1;

                var aciklama = kok.TryGetProperty("StatusDescription", out var acik)
                    ? acik.GetString()
                    : null;

                if (durum == 200)
                    return new Sonuc(true, "Gönderildi.", metin);

                _kayit.LogWarning("SMS StatusCode={Durum} ({Aciklama}). Ham yanıt: {Metin}",
                    durum, aciklama, kisaltilmis);

                return new Sonuc(false,
                    string.IsNullOrWhiteSpace(aciklama)
                        ? $"Sağlayıcı {durum} kodu döndürdü."
                        : aciklama,
                    metin);
            }
            catch (JsonException)
            {
                _kayit.LogWarning("SMS yanıtı JSON olarak ayrıştırılamadı: {Metin}", kisaltilmis);
                return new Sonuc(false, "Sağlayıcı yanıtı anlaşılamadı.", metin);
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "SMS gönderimi yapılamadı");
            return new Sonuc(false, hata.Message, null);
        }
    }
}

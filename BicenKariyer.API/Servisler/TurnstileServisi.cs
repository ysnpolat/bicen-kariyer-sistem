using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Cloudflare Turnstile doğrulaması.
///
/// <para>
/// Aday formuna gömülen Turnstile bileşeni, ziyaretçinin gerçek bir tarayıcı
/// kullandığını arka planda doğrular ve bir jeton üretir. Başvuru
/// gönderildiğinde bu jeton sunucuya iletilir; sunucu da jetonu Cloudflare'e
/// sorarak geçerliliğini teyit eder.
/// </para>
///
/// <para>
/// Otomatik araçlar bu jetonu üretemez; gerçek bir tarayıcı motoru
/// çalıştırmaları gerekir. Kimlik numarası üretebilen kararlı saldırganlara
/// karşı en etkili katmandır.
/// </para>
///
/// <para>
/// Ayar yapılmadığında doğrulama devre dışı kalır ve başvurular eskisi gibi
/// alınır; anahtar girilene kadar sistem çalışmaya devam eder.
/// </para>
/// </summary>
public class TurnstileServisi
{
    private const string DogrulamaAdresi =
        "https://challenges.cloudflare.com/turnstile/v0/siteverify";

    private readonly IHttpClientFactory _istemciUretici;
    private readonly IConfiguration _yapilandirma;
    private readonly GuvenlikGunlugu _gunluk;

    public TurnstileServisi(
        IHttpClientFactory istemciUretici,
        IConfiguration yapilandirma,
        GuvenlikGunlugu gunluk)
    {
        _istemciUretici = istemciUretici;
        _yapilandirma = yapilandirma;
        _gunluk = gunluk;
    }

    /// <summary>Sunucu tarafı gizli anahtar</summary>
    private string GizliAnahtar => _yapilandirma["Turnstile:GizliAnahtar"] ?? "";

    /// <summary>Doğrulama etkin mi (anahtar tanımlıysa)</summary>
    public bool Etkin => !string.IsNullOrWhiteSpace(GizliAnahtar);

    /// <summary>Forma gömülecek site anahtarı</summary>
    public string SiteAnahtari => _yapilandirma["Turnstile:SiteAnahtari"] ?? "";

    /// <summary>
    /// Jetonu Cloudflare'e sorar. Doğrulama kapalıysa her zaman geçerli sayar.
    /// </summary>
    public async Task<bool> DogrulaAsync(string jeton, string adres)
    {
        if (!Etkin) return true;

        if (string.IsNullOrWhiteSpace(jeton))
        {
            _gunluk.Yaz("TURNSTILE EKSİK", adres, "Doğrulama jetonu gönderilmedi");
            return false;
        }

        try
        {
            var istemci = _istemciUretici.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(10);

            var govde = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = GizliAnahtar,
                ["response"] = jeton,
                ["remoteip"] = adres ?? ""
            });

            var cevap = await istemci.PostAsync(DogrulamaAdresi, govde);
            var metin = await cevap.Content.ReadAsStringAsync();

            using var belge = JsonDocument.Parse(metin);

            var basarili = belge.RootElement.TryGetProperty("success", out var s) &&
                           s.ValueKind == JsonValueKind.True;

            if (!basarili)
            {
                var sebep = belge.RootElement.TryGetProperty("error-codes", out var h)
                    ? string.Join(", ", h.EnumerateArray().Select(x => x.GetString()))
                    : "bilinmiyor";

                _gunluk.Yaz("TURNSTILE RED", adres, $"Sebep: {sebep}");
            }

            return basarili;
        }
        catch (Exception hata)
        {
            /* Cloudflare'e ulaşılamıyorsa başvurular durmasın: gerçek adayları
               engellemek, birkaç sahte kaydın geçmesinden daha kötüdür.
               Durum günlüğe yazılır. */
            _gunluk.Yaz("TURNSTILE HATA", adres, hata.Message);
            return true;
        }
    }
}

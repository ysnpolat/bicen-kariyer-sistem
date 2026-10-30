using System.Text;
using System.Text.Json;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Bildirim gönderimi.
///
/// <para>
/// Ayrı bir altyapı kurulmadı: panel zilinin okuduğu <c>KRY_BILDIRIM</c> ve
/// mobil bildirim jetonlarının durduğu <c>KRY_MOBIL_JETON</c> zaten
/// biPortal'da ve iki API de aynı veritabanına bakıyor. Buradan yazılan
/// bildirim, Kariyer panelindeki zilde de görünür.
/// </para>
///
/// <para>
/// Gönderim hiçbir zaman asıl işi durdurmaz: bir arıza kaydı, bildirim
/// gitmediği için başarısız sayılmamalı. Hatalar günlüğe yazılır ve akış
/// devam eder.
/// </para>
/// </summary>
public class BildirimServisi
{
    /// <summary>Expo bildirim servisi; Apple ve Google tarafını o üstleniyor.</summary>
    private const string Adres = "https://exp.host/--/api/v2/push/send";

    private readonly VeritabaniServisi _vt;
    private readonly IHttpClientFactory _istemciKaynak;
    private readonly ILogger<BildirimServisi> _kayit;

    public BildirimServisi(
        VeritabaniServisi vt,
        IHttpClientFactory istemciKaynak,
        ILogger<BildirimServisi> kayit)
    {
        _vt = vt;
        _istemciKaynak = istemciKaynak;
        _kayit = kayit;
    }

    /// <summary>
    /// Bir personele mobil bildirim gönderir.
    ///
    /// Jetonu yoksa sessizce geçilir: uygulamayı kurmamış ya da bildirim
    /// izni vermemiş olabilir; bu bir hata değil.
    /// </summary>
    public async Task Gonder(string personelKodu, string baslik, string metin,
                             string ekran = null)
    {
        if (string.IsNullOrWhiteSpace(personelKodu)) return;

        try
        {
            using var db = _vt.Baglanti();

            var jeton = db.ExecuteScalar<string>(
                "SELECT jeton FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod",
                new { kod = personelKodu.Trim() });

            if (string.IsNullOrWhiteSpace(jeton)) return;

            await JetonlaGonder(new[] { jeton }, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bildirim gönderilemedi: {Kod}", personelKodu);
        }
    }

    /// <summary>
    /// Birden çok personele aynı bildirimi gönderir.
    ///
    /// Departman temsilcilerinin hepsine haber vermek için. Tek istekte
    /// gönderilir; Expo çoklu jeton kabul ediyor.
    /// </summary>
    public async Task CokluGonder(IEnumerable<string> personelKodlari,
                                  string baslik, string metin, string ekran = null)
    {
        var kodlar = (personelKodlari ?? Enumerable.Empty<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (kodlar.Count == 0) return;

        try
        {
            using var db = _vt.Baglanti();

            var jetonlar = db.Query<string>(@"
SELECT jeton FROM KRY_MOBIL_JETON WHERE personel_kodu IN @kodlar",
                new { kodlar }).ToArray();

            if (jetonlar.Length == 0) return;

            await JetonlaGonder(jetonlar, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Toplu bildirim gönderilemedi");
        }
    }

    /// <summary>
    /// Panel zilinde görünecek kayıt.
    ///
    /// <paramref name="kullanici"/> panel kullanıcı adı. Mobil bildirimden
    /// ayrı: personelin telefonu olmayabilir ama panele giren biri kaydı
    /// zilde görmeli.
    /// </summary>
    public void PaneleYaz(string kullanici, string tur, string baslik, string metin)
    {
        if (string.IsNullOrWhiteSpace(kullanici)) return;

        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, @tur, @baslik, @metin)",
                new { kullanici = kullanici.Trim(), tur, baslik, metin });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Panel bildirimi yazılamadı: {Kullanici}", kullanici);
        }
    }

    /* ==================================================================== */

    private async Task JetonlaGonder(string[] jetonlar, string baslik,
                                     string metin, string ekran)
    {
        var govde = jetonlar.Select(j => new
        {
            to = j,
            title = baslik,
            body = metin,
            sound = "default",
            data = ekran is null ? null : new { ekran }
        });

        var istemci = _istemciKaynak.CreateClient();
        istemci.Timeout = TimeSpan.FromSeconds(15);

        var icerik = new StringContent(
            JsonSerializer.Serialize(govde), Encoding.UTF8, "application/json");

        var yanit = await istemci.PostAsync(Adres, icerik);

        if (!yanit.IsSuccessStatusCode)
            _kayit.LogWarning("Expo bildirimi reddedildi: {Durum}", yanit.StatusCode);
    }
}

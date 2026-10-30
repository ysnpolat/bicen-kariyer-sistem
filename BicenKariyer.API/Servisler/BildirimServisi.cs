using System.Text;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Anlık bildirim gönderimi.
///
/// <para>
/// Expo'nun bildirim servisi kullanılır: Apple ve Google'ın ayrı ayrı
/// sertifika ve anahtar yönetimini üstlenir, tek uçtan iki platforma da
/// gönderir. Ücretsizdir ve ek bir hesap gerektirmez.
/// </para>
///
/// <para>
/// Bildirim gönderimi hiçbir zaman asıl işi durdurmaz: bir izin onayı,
/// bildirim gitmediği için başarısız sayılmamalı. Hatalar günlüğe
/// yazılır ve akış devam eder.
/// </para>
/// </summary>
public class BildirimServisi
{
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
    /// Bir personele bildirim gönderir.
    ///
    /// Jetonu yoksa sessizce geçilir: uygulamayı kurmamış ya da bildirim
    /// izni vermemiş olabilir; bu bir hata değildir.
    /// </summary>
    public async Task Gonder(
        string personelKodu,
        string baslik,
        string metin,
        string ekran = null)
    {
        if (string.IsNullOrWhiteSpace(personelKodu)) return;

        try
        {
            using var db = _vt.Baglanti();

            var jetonlar = Jetonlar(db, @"
SELECT jeton AS Jeton, CAST(ISNULL(ses, 0) AS BIT) AS Ses
FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod", new { kod = personelKodu.Trim() });

            if (jetonlar.Length == 0) return;

            await JetonlaGonder(jetonlar, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bildirim gönderilemedi: {Kod}", personelKodu);
        }
    }

    /// <summary>
    /// Bir role sahip panel kullanıcılarına bildirim gönderir.
    ///
    /// Onay bekleyen bir talep olduğunda ilgili aşamadaki kişilere haber
    /// vermek için. Panel kullanıcılarının mobil jetonu yoksa gitmez.
    /// </summary>
    public async Task RoleGonder(
        string[] roller,
        string baslik,
        string metin,
        string ekran = null)
    {
        if (roller is null || roller.Length == 0) return;

        try
        {
            using var db = _vt.Baglanti();

            /* Panel kullanıcısının personel kaydıyla eşleşmesi kullanıcı
               adı üzerinden kurulur; eşleşmeyene bildirim gitmez. */
            var jetonlar = Jetonlar(db, @"
SELECT j.jeton AS Jeton, CAST(ISNULL(j.ses, 0) AS BIT) AS Ses
FROM KRY_MOBIL_JETON j
JOIN KRY_KULLANICILAR k ON k.kullanici_adi = j.personel_kodu
WHERE k.rol IN @roller AND k.aktif = 1", new { roller });

            if (jetonlar.Length == 0) return;

            await JetonlaGonder(jetonlar, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Rol bildirimi gönderilemedi");
        }
    }

    /// <summary>
    /// Birden çok personele aynı bildirimi gönderir; duyurular için.
    /// </summary>
    public async Task TopluGonder(
        IEnumerable<string> personelKodlari,
        string baslik,
        string metin,
        string ekran = null)
    {
        var kodlar = (personelKodlari ?? Enumerable.Empty<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct()
            .ToArray();

        if (kodlar.Length == 0) return;

        try
        {
            using var db = _vt.Baglanti();

            var jetonlar = new List<Alici>();

            /* SQL Server parametre sınırı (2100): büyük listeler parça parça */
            foreach (var parca in kodlar.Chunk(1000))
                jetonlar.AddRange(Jetonlar(db, @"
SELECT jeton AS Jeton, CAST(ISNULL(ses, 0) AS BIT) AS Ses
FROM KRY_MOBIL_JETON WHERE personel_kodu IN @parca", new { parca }));

            var tekil = jetonlar.GroupBy(x => x.Jeton).Select(g => g.First()).ToArray();

            if (tekil.Length == 0) return;

            await JetonlaGonder(tekil, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Toplu bildirim gönderilemedi");
        }
    }

    /// <summary>
    /// Her personele kendi metniyle bildirim; Biçen Kart hareketlerinde
    /// (her kişinin tutarı ve bakiyesi farklı). Jetonlar tek sorguda
    /// alınıyor, Expo'ya yüzerlik yığınlarla gidiyor: yüzlerce kişilik
    /// toplu yüklemede de birkaç istekle bitiyor.
    /// </summary>
    public async Task KisiyeOzelGonder(
        IEnumerable<(string PersonelKodu, string Baslik, string Metin)> liste,
        string ekran = null)
    {
        var bildirimler = (liste ?? Enumerable.Empty<(string, string, string)>())
            .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .Select(x => (Kod: x.PersonelKodu.Trim(), x.Baslik, x.Metin))
            .ToList();

        if (bildirimler.Count == 0) return;

        try
        {
            using var db = _vt.Baglanti();

            var kodlar = bildirimler.Select(x => x.Kod).Distinct().ToArray();

            var jetonlar = new Dictionary<string, Alici>();

            const string sorgu =
                "SELECT personel_kodu AS kod, jeton, CAST(ISNULL(ses, 0) AS BIT) AS ses FROM KRY_MOBIL_JETON WHERE personel_kodu IN @parca";

            foreach (var parca in kodlar.Chunk(1000))
            {
                IEnumerable<dynamic> satirlar;

                try
                {
                    satirlar = db.Query(sorgu, new { parca });
                }
                catch (Microsoft.Data.SqlClient.SqlException)
                {
                    satirlar = db.Query(SessizSorgu(sorgu), new { parca });
                }

                foreach (var j in satirlar)
                    if (!string.IsNullOrWhiteSpace((string)j.jeton))
                        jetonlar[((string)j.kod).Trim()] = new Alici((string)j.jeton, (bool)j.ses);
            }

            var mesajlar = bildirimler
                .Where(x => jetonlar.ContainsKey(x.Kod))
                .Select(x => Mesaj(jetonlar[x.Kod], x.Baslik, x.Metin, ekran))
                .ToArray();

            if (mesajlar.Length == 0) return;

            var istemci = _istemciKaynak.CreateClient();
            istemci.Timeout = TimeSpan.FromSeconds(20);

            foreach (var yigin in mesajlar.Chunk(100))
            {
                try
                {
                    var yanit = await istemci.PostAsync(Adres, new StringContent(
                        JsonSerializer.Serialize(yigin), Encoding.UTF8, "application/json"));

                    if (!yanit.IsSuccessStatusCode)
                        _kayit.LogWarning("Bildirim servisi hata döndü: {Kod} · {Metin}",
                            (int)yanit.StatusCode, await yanit.Content.ReadAsStringAsync());
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Bildirim yığını gönderilemedi");
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kişiye özel bildirimler gönderilemedi");
        }
    }

    /// <summary>Tüm personele; genel duyurularda.</summary>
    public async Task HerkeseGonder(string baslik, string metin, string ekran = null)
    {
        try
        {
            using var db = _vt.Baglanti();

            var jetonlar = Jetonlar(db,
                "SELECT jeton AS Jeton, CAST(ISNULL(ses, 0) AS BIT) AS Ses FROM KRY_MOBIL_JETON", null);

            if (jetonlar.Length == 0) return;

            await JetonlaGonder(jetonlar, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Genel bildirim gönderilemedi");
        }
    }

    /* ==================================================================== */

    /// <summary>
    /// Expo servisine gönderir.
    ///
    /// Yüzerlik yığınlar hâlinde: servis tek istekte en fazla 100 bildirim
    /// kabul ediyor ve fazlasını reddediyor.
    /// </summary>
    private async Task JetonlaGonder(
        Alici[] jetonlar,
        string baslik,
        string metin,
        string ekran)
    {
        var istemci = _istemciKaynak.CreateClient();
        istemci.Timeout = TimeSpan.FromSeconds(20);

        foreach (var yigin in jetonlar.Chunk(100))
        {
            var govde = yigin.Select(j => Mesaj(j, baslik, metin, ekran)).ToArray();

            try
            {
                var icerik = new StringContent(
                    JsonSerializer.Serialize(govde),
                    Encoding.UTF8,
                    "application/json");

                var yanit = await istemci.PostAsync(Adres, icerik);

                if (!yanit.IsSuccessStatusCode)
                {
                    var hataMetni = await yanit.Content.ReadAsStringAsync();

                    _kayit.LogWarning(
                        "Bildirim servisi hata döndü: {Kod} · {Metin}",
                        (int)yanit.StatusCode, hataMetni);
                }
            }
            catch (Exception hata)
            {
                /* Bildirim gitmemesi asıl işi durdurmaz */
                _kayit.LogWarning(hata, "Bildirim yığını gönderilemedi");
            }
        }
    }

    /* ==================================================================== */
    /* Biçen bildirim sesleri (1.6, 04.10.2026)                              */
    /* ==================================================================== */

    /// <summary>
    /// Yönetim → Mobil test: seçilen sesle deneme bildirimi. Cihaz 1.6
    /// öncesindeyse varsayılan sesle gider; sonuç bunu söyler.
    /// </summary>
    public async Task<(bool JetonVar, bool Sesli, string Surum)> SesDene(string personelKodu, string tur)
    {
        using var db = _vt.Baglanti();

        dynamic kayit;

        try
        {
            kayit = db.QueryFirstOrDefault(
                "SELECT jeton, CAST(ISNULL(ses, 0) AS BIT) AS ses, surum FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod",
                new { kod = (personelKodu ?? "").Trim() });
        }
        catch (Microsoft.Data.SqlClient.SqlException)
        {
            kayit = db.QueryFirstOrDefault(
                "SELECT jeton, CAST(0 AS BIT) AS ses, CAST(NULL AS NVARCHAR(20)) AS surum FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod",
                new { kod = (personelKodu ?? "").Trim() });
        }

        if (kayit is null || string.IsNullOrWhiteSpace((string)kayit.jeton)) return (false, false, null);

        var alici = new Alici((string)kayit.jeton, (bool)kayit.ses);

        var (baslik, metin, ses) = tur switch
        {
            "onay" => ("İzin talebi onayınızı bekliyor", "Deneme · onay bekleyen işlerin sesi", OnaySesi),
            "genel" => ("Biçen, her zaman taze", "Deneme · duyuruların sesi", GenelSes),
            _ => ("Biçen360", "Deneme · diğer bildirimlerin sesi", KisaSes),
        };

        var m = Mesaj(alici, baslik, metin, null);

        if (alici.Ses)
        {
            m["sound"] = ses.Dosya;
            m["channelId"] = ses.Kanal;
        }

        var istemci = _istemciKaynak.CreateClient();
        istemci.Timeout = TimeSpan.FromSeconds(20);

        var yanit = await istemci.PostAsync(Adres, new StringContent(
            JsonSerializer.Serialize(new[] { m }), Encoding.UTF8, "application/json"));

        if (!yanit.IsSuccessStatusCode)
            throw new InvalidOperationException("Bildirim servisi hata döndü: " + (int)yanit.StatusCode);

        return (true, alici.Ses, (string)kayit.surum);
    }

    /// <summary>Gönderim hedefi: jeton ve cihazdaki uygulamada Biçen sesleri var mı.</summary>
    public sealed record Alici(string Jeton, bool Ses);

    private static Alici[] Jetonlar(System.Data.IDbConnection db, string sql, object parametre)
    {
        IEnumerable<Alici> satirlar;

        try
        {
            satirlar = db.Query<Alici>(sql, parametre);
        }
        catch (Microsoft.Data.SqlClient.SqlException)
        {
            /* ses sütunu eklenememişse bildirim yine gitsin: varsayılan sesle */
            satirlar = db.Query<Alici>(SessizSorgu(sql), parametre);
        }

        return satirlar
            .Where(x => !string.IsNullOrWhiteSpace(x.Jeton))
            .GroupBy(x => x.Jeton)
            .Select(g => g.First())
            .ToArray();
    }

    private static string SessizSorgu(string sql) =>
        sql.Replace("CAST(ISNULL(j.ses, 0) AS BIT)", "CAST(0 AS BIT)")
           .Replace("CAST(ISNULL(ses, 0) AS BIT)", "CAST(0 AS BIT)");

    /// <summary>Ses türü: kanal kimliği (Android) ve ses dosyası (iOS).</summary>
    public sealed record BildirimSesi(string Kanal, string Dosya);

    /// <summary>Onay bekleyen işler: motif soru gibi yukarıda biter.</summary>
    public static readonly BildirimSesi OnaySesi = new("bicen-onay", "bicen_onay_bekliyor.wav");

    /// <summary>Duyuru ve sabah özeti: "Bi-çen, her za-man ta-ze" tam melodi.</summary>
    public static readonly BildirimSesi GenelSes = new("bicen-genel", "bicen_her_zaman_taze.wav");

    /// <summary>Diğer bildirimler: "Bi-çen … ta-ze" kısa imza.</summary>
    public static readonly BildirimSesi KisaSes = new("bicen-kisa", "bicen_taze_kisa.wav");

    /// <summary>
    /// Bildirimin sesi. Onay isteyenler (ekran ya da başlık "onay"
    /// içeriyorsa) onay sesi; duyurular ve patron sabah özeti tam slogan;
    /// geri kalanı kısa imza. Sık gelen bildirimde uzun melodi bıktırır.
    /// </summary>
    public static BildirimSesi SesSec(string ekran, string baslik)
    {
        var e = PersonelKaynagiServisi.DuzAnahtar(ekran);
        var b = PersonelKaynagiServisi.DuzAnahtar(baslik);

        if (e.Contains("onay") || b.Contains("onayinizi") || b.Contains("onaybekl") || b.Contains("onaybekleyen"))
            return OnaySesi;

        if (e is "duyuru" or "duyurular" or "patronozet" || e.StartsWith("patronsayfaduyuru"))
            return GenelSes;

        return KisaSes;
    }

    /// <summary>
    /// Expo mesajı. Biçen sesleri yalnızca 1.6 ve sonrasına (cihaz kaydında
    /// <c>ses = 1</c>): Expo, cihazda bulunmayan kanala gönderilen bildirimi
    /// Android'de hiç göstermiyor. Eski sürümde varsayılan ses ve kanal.
    /// </summary>
    private static Dictionary<string, object> Mesaj(Alici alici, string baslik, string metin, string ekran)
    {
        var m = new Dictionary<string, object>
        {
            ["to"] = alici.Jeton,
            ["title"] = baslik,
            ["body"] = metin,
            ["sound"] = "default",
        };

        /* Uygulama bu veriyle doğru ekranı açar.

           "ekran|p" biçimi (07.10.2026): p, ekrandaki ayrıntıyı seçer
           (ör. "anasayfa|eksik" → 1.6 eksik penceresini açar). Eski sürüm
           yalnızca ekran'a bakıp aynı ekrana gidiyor. */
        string p = null;
        var bol = ekran?.IndexOf('|') ?? -1;
        if (bol > 0)
        {
            p = ekran[(bol + 1)..];
            ekran = ekran[..bol];
        }

        if (!string.IsNullOrWhiteSpace(ekran))
            m["data"] = p is null ? new { ekran } : (object)new { ekran, p };

        if (alici.Ses)
        {
            var ses = SesSec(ekran, baslik);
            m["sound"] = ses.Dosya;
            m["channelId"] = ses.Kanal;
        }

        return m;
    }
}

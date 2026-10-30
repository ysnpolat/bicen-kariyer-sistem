using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Sicilden personel bilgisi.
///
/// <para>
/// Kariyer tarafında bu iş <c>PersonelKaynagiServisi</c> üzerinden
/// yapılıyor: tüm personeli çekip bellekte tutuyor. Burada ihtiyaç
/// duyulan tek şey tek kişinin adı, görevi ve mağazası olduğu için 22
/// KB'lık o servis taşınmadı, doğrudan sorgu yazıldı.
/// </para>
///
/// <para>
/// Mağaza bilgisi iş grubu adından geliyor — Kariyer'de de öyle
/// (<c>kisi.Sube = kisi.IsGrubu</c>). İki sistemin aynı değeri kullanması,
/// arıza kayıtlarının mağaza eşleşmesinin tutması için gerekli.
/// </para>
/// </summary>
public class PersonelServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PersonelServisi> _kayit;

    public PersonelServisi(VeritabaniServisi vt, ILogger<PersonelServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /// <param name="Telefon">
    /// Mikro'daki cep numarası. Arıza kaydına yazılıyor ki teknisyen
    /// kaydı açan kişiye tek dokunuşla ulaşabilsin. Bulunamazsa null;
    /// numara zorunlu değil ve eski kayıtlarda boş olabiliyor.
    /// </param>
    public record Bilgi(string Sicil, string AdSoyad, string Pozisyon, string Sube,
                        string Telefon = null, string Kimlik = null);

    /// <summary>
    /// Tek kişinin kaydı. Bulunamazsa null.
    ///
    /// Sonuç kısa süre önbellekte tutulur: aynı istek içinde hem yetki
    /// denetimi hem kayıt yazımı için soruluyor ve mağaza listesi
    /// ekranlarında art arda çağrılıyor.
    /// </summary>
    public Bilgi Getir(string sicil)
    {
        if (string.IsNullOrWhiteSpace(sicil)) return null;

        var anahtar = sicil.Trim();

        if (_bellek.TryGetValue(anahtar, out var kayitli) &&
            DateTime.UtcNow - kayitli.zaman < TimeSpan.FromMinutes(10))
            return kayitli.bilgi;

        try
        {
            using var db = _vt.PersonelBaglantisi();

            var satir = db.QueryFirstOrDefault(@"
SELECT TOP 1
    P.per_adi                                 AS ad,
    P.per_soyadi                              AS soyad,
    /* İK panelindeki personel kartıyla aynı kaynak: önce meslek alanı,
       boşsa ünvan tanımı. Yalnızca ünvan tanımı okununca portal grupları
       personel kartındaki ünvanla tutmuyordu. */
    ISNULL(NULLIF(LTRIM(RTRIM(CAST(P.per_kim_meslek AS NVARCHAR(200)))), N''), ISNULL(PUT.un_aciklama, N'Belirtilmemiş')) AS pozisyon,
    ISNULL(PIG.ig_adi,      N'Belirtilmemiş') AS sube,
    LTRIM(RTRIM(ISNULL(P.per_tel_cepno, N''))) AS telefon
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI  PUT ON P.per_unvan_kodu    = PUT.un_kod
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
WHERE LTRIM(RTRIM(P.per_kod)) = @anahtar", new { anahtar });

            var bilgi = satir is null
                ? null
                : new Bilgi(
                    anahtar,
                    $"{(string)satir.ad} {(string)satir.soyad}".Trim(),
                    (string)satir.pozisyon,
                    (string)satir.sube,
                    Telefonla((string)satir.telefon));

            _bellek[anahtar] = (bilgi, DateTime.UtcNow);

            return bilgi;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel bilgisi alınamadı: {Sicil}", anahtar);
            return null;
        }
    }

    /// <summary>
    /// Mikro'daki numarayı aranabilir hâle getirir.
    ///
    /// Alan elle dolduruluyor: "0532 111 22 33", "532-111-22-33",
    /// "+90 532 111 2233" hepsi görülüyor. Rakam dışındaki her şey
    /// atılıyor, baştaki 0 ve 90 kırpılıyor; telefon uygulamasına
    /// biçimlenmemiş numara verildiğinde bazı cihazlarda arama hiç
    /// başlamıyordu.
    /// </summary>
    private static string Telefonla(string ham)
    {
        var rakam = new string((ham ?? "").Where(char.IsDigit).ToArray());

        if (rakam.StartsWith("90") && rakam.Length == 12) rakam = rakam[2..];
        if (rakam.StartsWith("0") && rakam.Length == 11) rakam = rakam[1..];

        /* Cep numarası 10 hane (5XXXXXXXXX). Tutmayan değer sabit hat ya da
           yanlış giriş olabilir; olduğu gibi bırakılıyor, aramayı kullanıcı
           denesin. */
        return rakam.Length == 0 ? null : rakam;
    }

    /// <summary>
    /// Çalışan personelin tamamı.
    ///
    /// <para>
    /// Departman temsilcisi seçiminde kullanılıyor. Sicil numarasını elle
    /// yazdırmak hataya açık: yanlış yazılan bir numara sessizce hiçbir
    /// kişiye denk gelmiyor ve o departmana bildirim hiç gitmiyor.
    /// </para>
    ///
    /// <para>
    /// Sonuç kısa süre önbellekte: liste birkaç bin satır ve ekran her
    /// açıldığında Mikro'ya gitmesi gereksiz.
    /// </para>
    /// </summary>
    public List<Bilgi> Liste()
    {
        if (_liste is not null &&
            DateTime.UtcNow - _listeZamani < TimeSpan.FromMinutes(15))
            return _liste;

        try
        {
            using var db = _vt.PersonelBaglantisi();

            /* Satırlar elle eşleniyor.

               Eskiden sonuç doğrudan Bilgi kaydının kurucusuna veriliyordu.
               Dapper kurucuyu sütun türlerine göre seçiyor ve sorgudaki
               "NULL AS Telefon" SQL Server'da int türünde geliyor —
               string parametreyle eşleşmediği için kurucu bulunamıyor,
               hata yakalanıyor ve liste sessizce boş dönüyordu. Temsilci
               seçimi, kişi arama ve yetki ekranı bu yüzden boş kalıyordu. */
            _liste = db.Query(@"
SELECT
    LTRIM(RTRIM(P.per_kod))                            AS sicil,
    LTRIM(RTRIM(P.per_adi + N' ' + P.per_soyadi))      AS adSoyad,
    /* İK panelindeki personel kartıyla aynı kaynak: önce meslek alanı,
       boşsa ünvan tanımı. Yalnızca ünvan tanımı okununca portal grupları
       personel kartındaki ünvanla tutmuyordu. */
    ISNULL(NULLIF(LTRIM(RTRIM(CAST(P.per_kim_meslek AS NVARCHAR(200)))), N''), ISNULL(PUT.un_aciklama, N'Belirtilmemiş')) AS pozisyon,
    ISNULL(PIG.ig_adi,      N'Belirtilmemiş')          AS sube,

    /* Kimlik numarası aramada kullanılıyor: temsilci eklerken sicil
       numarasını bilmeyen kullanıcı adla ya da kimlikle arıyor. */
    CAST(LTRIM(RTRIM(ISNULL(P.Per_TcKimlikNo, N''))) AS NVARCHAR(30)) AS kimlik
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI   PUT ON P.per_unvan_kodu    = PUT.un_kod
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu  = PIG.ig_kod
WHERE LTRIM(RTRIM(ISNULL(P.per_kod, ''))) <> ''
  AND (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) < 1950)",
                commandTimeout: 120)
                .Select(x => new Bilgi(
                    (string)x.sicil,
                    (string)x.adSoyad,
                    (string)x.pozisyon,
                    (string)x.sube,
                    null,
                    (string)x.kimlik))
                .OrderBy(x => x.AdSoyad, StringComparer.Create(
                    new System.Globalization.CultureInfo("tr-TR"), true))
                .ToList();

            _listeZamani = DateTime.UtcNow;
            SonHata = null;

            return _liste;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel listesi alınamadı");

            SonHata = hata.Message;

            /* Liste alınamazsa ekran yine açılsın; temsilci kutusu boş
               kalır ama departman tanımı yapılabilir. */
            return _liste ?? new List<Bilgi>();
        }
    }

    /// <summary>
    /// Listenin son okunamama sebebi. Ekranda gösteriliyor: "personel
    /// bulunamadı" demek sebebi gizliyordu ve boş liste hatasız görünüyordu.
    /// </summary>
    public string SonHata { get; private set; }

    private List<Bilgi> _liste;
    private DateTime _listeZamani;

    private readonly System.Collections.Concurrent.ConcurrentDictionary<
        string, (Bilgi bilgi, DateTime zaman)> _bellek = new();
}

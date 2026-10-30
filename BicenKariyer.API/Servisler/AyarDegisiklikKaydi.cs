using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Ayar değişikliklerinin izi (03.10.2026).
///
/// <para>
/// Yönetim sayfası her ayar bölümünde "son değişiklik: kim, ne zaman"
/// gösteriyor; Genel bakış da son değişiklikleri listeliyor. Ayar uçları
/// çok sayıda denetleyiciye dağılmış durumda (Ayar, Kullanıcı, Departman,
/// Çalışma Düzeni…). Her birine ayrı kayıt satırı eklemek yerine başarılı
/// yazma istekleri tek bir ara katmanda yola göre bölüme eşleniyor.
/// </para>
///
/// <para>
/// Yalnızca bölüm, işlem adı ve kullanıcı adı tutulur; gönderilen ayarın
/// içeriği (parola, metin vb.) yazılmaz.
/// </para>
/// </summary>
public static class AyarDegisiklikKaydi
{
    /// <summary>
    /// Form ayarı tek bir uca (POST api/Ayar/Form) kaydediliyor; panel hangi
    /// bölümden kaydedildiğini <c>?bolum=</c> ile bildiriyor. Yalnızca bu
    /// listedekiler kabul edilir.
    /// </summary>
    public static readonly Dictionary<string, string> FormBolumleri = new(StringComparer.OrdinalIgnoreCase)
    {
        ["birimler"] = "Birimler",
        ["bolgeler"] = "Bölgeler",
        ["birimturleri"] = "Birim türleri ve pozisyonlar",
        ["basvuruformu"] = "Başvuru formu",
        ["kvkk"] = "KVKK metinleri",
        ["gorusme"] = "Görüşme ve davet",
        ["uyumanket"] = "İşe uyum anketi",
        ["yonetici"] = "Yönetici eşleştirmesi",
        ["mobilmetin"] = "Mobil metinler",
        ["izinformu"] = "İzin formu e-postaları",
    };

    /// <summary>
    /// İstek bir ayar değişikliğiyse bölüm ve işlem adını döndürür.
    /// </summary>
    public static (string Bolum, string Islem)? Bul(
        string yontem, string yol, string bolumSorgusu, bool basarili)
    {
        if (HttpMethods.IsGet(yontem) || HttpMethods.IsHead(yontem) || HttpMethods.IsOptions(yontem))
            return null;

        var p = (yol ?? "").Trim('/').Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (p.Length < 2 || !p[0].Equals("api", StringComparison.OrdinalIgnoreCase))
            return null;

        var c = p[1].ToLowerInvariant();
        var a = p.Length > 2 ? p[2].ToLowerInvariant() : "";
        var sil = HttpMethods.IsDelete(yontem);

        /* Mail testi başarısız da olsa yazılır: Genel bakış "son test
           başarısız" uyarısını buradan çıkarıyor. */
        if (c == "ayar" && a == "mailtest")
            return ("mail", basarili ? "Test maili gönderildi" : "Test maili gönderilemedi");

        if (!basarili) return null;

        switch (c)
        {
            case "ayar":
                return a switch
                {
                    "form" when !string.IsNullOrWhiteSpace(bolumSorgusu)
                                && FormBolumleri.TryGetValue(bolumSorgusu, out var ad)
                        => (bolumSorgusu.ToLowerInvariant(), $"{ad} kaydedildi"),
                    "form" => ("form", "Form ayarları kaydedildi"),
                    "mail" => ("mail", "Mail ayarları kaydedildi"),
                    "menusirasi" => ("menu", "Menü sırası kaydedildi"),
                    "roller" => ("rolyetki", "Rol tanımları kaydedildi"),
                    "rolyetkileri" => ("rolyetki", "Rol yetkileri kaydedildi"),
                    "mobiltesttelefon" => ("mobiltest", "Mobil test telefonu değişti"),
                    _ => null
                };

            case "kullanici":
                if (sil) return ("kullanici", "Kullanıcı silindi");
                return a == "kaydet" ? ("kullanici", "Kullanıcı kaydedildi") : null;

            case "karaliste":
                if (a == "kodhavuzu")
                    return ("smskod", sil ? "Kod havuzu temizlendi" : "Kod havuzuna kod yüklendi");
                if (a == "kodsiniri")
                    return ("smskod", "Kod sınırı sıfırlandı");
                return ("gunluk", "Erişim listesi değişti");

            case "panelgorunum":
                return a == "logo"
                    ? ("panelgorunum", sil ? "Panel logosu silindi" : "Panel logosu yüklendi")
                    : ("panelgorunum", "Panel görünümü kaydedildi");

            /* api/Patron ve api/Patron/{id}; api/PatronMobil ayrı denetleyici */
            case "patron":
                return p.Length <= 3
                    ? ("patron", sil ? "Patron görünümünden kişi kaldırıldı" : "Patron görünümüne kişi eklendi")
                    : null;

            case "isegirisevrak":
                return a == "tanimlar" ? ("evrak", "Evrak listesi kaydedildi") : null;

            case "calismaduzeni":
                return ("calisma", a is "tatil" or "tatilvarsayilan"
                    ? "Resmi tatiller güncellendi"
                    : "Pozisyon grupları güncellendi");

            case "departman":
                return ("departman", sil ? "Departman silindi" : "Departman kaydedildi");

            case "yolucreti":
                if (a == "onizleme") return null;
                return ("yolucreti", a == "aktar"
                    ? "Yol ücretleri aktarıldı"
                    : sil ? "Yol ücreti silindi" : "Yol ücreti güncellendi");

            case "izinkurallari":
                return ("izinkurallari", "İzin kuralları kaydedildi");

            case "cikismulakat":
                return a is "ayar" or "sorular"
                    ? ("cikis", "Çıkış mülakatı ayarları kaydedildi")
                    : null;
        }

        return null;
    }

    /// <summary>Ara katman: istek bittikten sonra, yanıtı geciktirmeden yazar.</summary>
    public static IApplicationBuilder UseAyarDegisiklikKaydi(this IApplicationBuilder uygulama) =>
        uygulama.Use(async (baglam, sonraki) =>
        {
            await sonraki();

            try
            {
                if (baglam.User?.Identity?.IsAuthenticated != true) return;

                var kod = baglam.Response.StatusCode;
                var b = Bul(
                    baglam.Request.Method,
                    baglam.Request.Path.Value,
                    baglam.Request.Query["bolum"].ToString(),
                    kod is >= 200 and < 300);

                if (b is null) return;

                /* Yetkisiz denemeler (401/403) iz sayılmaz */
                if (kod is 401 or 403) return;

                var vt = baglam.RequestServices.GetRequiredService<VeritabaniServisi>();
                using var db = vt.Baglanti();

                db.Execute(@"
INSERT INTO KRY_AYAR_DEGISIKLIK (bolum, islem, kullanici, basarili)
VALUES (@bolum, @islem, @kullanici, @basarili)",
                    new
                    {
                        bolum = b.Value.Bolum,
                        islem = b.Value.Islem,
                        kullanici = baglam.User.Identity?.Name ?? "",
                        basarili = kod is >= 200 and < 300
                    });
            }
            catch
            {
                /* İz yazılamazsa ayar yine kaydedilmiş sayılır */
            }
        });
}

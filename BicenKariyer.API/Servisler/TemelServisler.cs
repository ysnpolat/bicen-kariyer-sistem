using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dapper;
using Microsoft.IdentityModel.Tokens;

namespace BicenKariyer.API.Servisler;

/* ==========================================================================
 * Parola
 * ========================================================================== */

public static class ParolaServisi
{
    /// <summary>PBKDF2 (SHA256, 100.000 tur) ile hash üretir.</summary>
    public static (string hash, string salt) Uret(string parola)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Hash(parola, salt);
        return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
    }

    public static bool Dogrula(string parola, string hash, string salt)
    {
        try
        {
            var tuz = Convert.FromBase64String(salt);
            var hesap = Hash(parola, tuz);
            return CryptographicOperations.FixedTimeEquals(
                hesap, Convert.FromBase64String(hash));
        }
        catch
        {
            return false;
        }
    }

    private static byte[] Hash(string parola, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(
            Encoding.UTF8.GetBytes(parola), salt, 100_000, HashAlgorithmName.SHA256, 32);

    /// <summary>
    /// Parolanın yeterince güçlü olup olmadığını denetler.
    /// Sorun varsa açıklaması döner; parola uygunsa null.
    /// </summary>
    public static string GucKontrolu(string parola)
    {
        if (string.IsNullOrWhiteSpace(parola) || parola.Length < 8)
            return "Parola en az 8 karakter olmalıdır.";

        var harf = parola.Any(char.IsLetter);
        var rakam = parola.Any(char.IsDigit);

        if (!harf || !rakam)
            return "Parola hem harf hem rakam içermelidir.";

        /* Sık kullanılan ve kolay tahmin edilen parolalar */
        string[] zayif =
        {
            "123456", "password", "parola", "sifre", "qwerty", "111111",
            "123123", "admin", "bicen", "12345678", "abc123"
        };

        var kucuk = parola.ToLowerInvariant();

        if (zayif.Any(z => kucuk.Contains(z)))
            return "Bu parola kolay tahmin edilebilir. Farklı bir parola seçiniz.";

        /* Aynı karakterin tekrarı: 'aaaaaaaa' */
        if (parola.Distinct().Count() < 4)
            return "Parola en az dört farklı karakter içermelidir.";

        return null;
    }
}

/* ==========================================================================
 * JWT
 * ========================================================================== */

public class JwtServisi
{
    private readonly IConfiguration _yapilandirma;

    public JwtServisi(IConfiguration yapilandirma) => _yapilandirma = yapilandirma;

    /// <summary>
    /// Oturum belirteci üretir.
    ///
    /// <paramref name="taklitEden"/> dolduğunda bu bir "kullanıcı olarak
    /// görüntüleme" oturumudur: yetkili bir kişi başka bir kullanıcının
    /// hesabıyla işlem yapar. Bu durumda oturum kısa süreli olur ve yapılan
    /// işlemlerde gerçek kişinin adı da görünür.
    /// </summary>
    /// <summary>
    /// Jetondan personel sicil numarasını çözer.
    ///
    /// Mobil uygulamada fotoğraf isteği başlık gönderemiyor; jeton sorgu
    /// olarak geliyor ve burada doğrulanıyor. İmza geçersizse null döner,
    /// böylece uydurma bir jetonla fotoğraf alınamaz.
    /// </summary>
    public string PersonelKoduCoz(string jeton)
    {
        if (string.IsNullOrWhiteSpace(jeton)) return null;

        try
        {
            var anahtar = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(_yapilandirma["Jwt:Anahtar"]));

            var sonuc = new JwtSecurityTokenHandler().ValidateToken(
                jeton,
                new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = anahtar,
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ClockSkew = TimeSpan.FromMinutes(1)
                },
                out _);

            var ad = sonuc.Identity?.Name ?? "";

            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
                return null;

            /* Jeton 'personel:14264|cihaz-abc' biçiminde; cihaz kimliği
               ayrılmalı. Ayrılmazsa sicil numarası cihaz kimliğiyle
               birlikte dönüyor ve hiçbir sorguda eşleşmiyor. */
            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');

            return i < 0 ? govde : govde[..i];
        }
        catch
        {
            /* Süresi dolmuş ya da imzası bozuk jeton */
            return null;
        }
    }

    public (string token, DateTime bitis) Uret(
        Kullanici kullanici,
        string taklitEden = null,
        string taklitEdenAdSoyad = null,
        int? saatAsim = null)
    {
        var anahtar = new SymmetricSecurityKey(
            Encoding.UTF8.GetBytes(_yapilandirma["Jwt:Anahtar"]));

        var taklit = !string.IsNullOrWhiteSpace(taklitEden);

        /* Taklit oturumları açık kalmasın diye kısa tutulur.

           saatAsim mobil uygulama için: panelde 12 saat doğru bir süre ama
           telefonda her gün yeniden giriş yaptırmak, personelin karekod
           okutmak için uygulamayı açtığı anda kimlik ve SMS beklemesi
           demekti. Mobilde oturumun geçerliliğini süre değil cihaz
           eşleşmesi ve oturum_acik bayrağı belirliyor; ikisi de her
           istekte denetleniyor. */
        var saat = taklit
            ? 1
            : saatAsim
              ?? (int.TryParse(_yapilandirma["Jwt:GecerlilikSaat"], out var s) ? s : 12);

        var bitis = DateTime.UtcNow.AddHours(saat);

        /* İşlem geçmişinde iz kalması için ad soyad alanına gerçek kişi eklenir */
        var adSoyad = taklit
            ? $"{kullanici.AdSoyad} ({taklitEdenAdSoyad ?? taklitEden} adına)"
            : kullanici.AdSoyad ?? "";

        var haklar = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, kullanici.Id.ToString()),
            new(ClaimTypes.Name, kullanici.KullaniciAdi),
            new(ClaimTypes.Role, kullanici.Rol),
            new("adSoyad", adSoyad),
            new("subeler", kullanici.Subeler ?? "")
        };

        /* Özel rolde ikinci bir rol hakkı: [Authorize(Roles = ...)] süzgeçleri
           sabit rol adlarını arıyor ve panelden açılan bir kod hiçbiriyle
           eşleşmediği için kullanıcı kendi sayfalarına bile giremiyordu.
           Rolün kendisi ilk sırada kalıyor; ekranlarda görünen o. */
        var temelRol = Roller.Temel(kullanici.Rol);

        if (!string.Equals(temelRol, kullanici.Rol, StringComparison.Ordinal)
            && !string.IsNullOrWhiteSpace(temelRol))
            haklar.Add(new Claim(ClaimTypes.Role, temelRol));

        if (taklit)
        {
            haklar.Add(new Claim("taklitEden", taklitEden));
            haklar.Add(new Claim("taklitEdenAdSoyad", taklitEdenAdSoyad ?? taklitEden));
        }

        var jeton = new JwtSecurityToken(
            issuer: _yapilandirma["Jwt:Yayinci"],
            audience: _yapilandirma["Jwt:Yayinci"],
            claims: haklar,
            expires: bitis,
            signingCredentials: new SigningCredentials(anahtar, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(jeton), bitis);
    }
}

/* ==========================================================================
 * Ayarlar
 * ========================================================================== */

public class AyarServisi
{
    private readonly VeritabaniServisi _vt;

    private static readonly JsonSerializerOptions Secenek = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public AyarServisi(VeritabaniServisi vt) => _vt = vt;

    public T Oku<T>(string anahtar, T varsayilan) where T : class
    {
        using var db = _vt.Baglanti();
        var deger = db.ExecuteScalar<string>(
            "SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = anahtar });

        if (string.IsNullOrWhiteSpace(deger)) return varsayilan;

        try
        {
            return JsonSerializer.Deserialize<T>(deger, Secenek) ?? varsayilan;
        }
        catch
        {
            return varsayilan;
        }
    }

    /// <summary>
    /// Gelen alanları mevcut ayarın üzerine yazar, gönderilmeyenlere
    /// dokunmaz.
    ///
    /// <para>
    /// Ayarlar tek bir JSON belgesinde duruyor ve ekranların her biri yalnızca
    /// kendi alanlarını biliyor. Tüm belgeyi yazan bir kaydetme, o ekranda
    /// görünmeyen her alanı sıfırlıyordu: Form Ayarları sekmesinde bir
    /// değişiklik yapıp kaydetmek sol menü sırasını siliyor, kullanıcı da
    /// menüyü her seferinde yeniden diziyordu.
    /// </para>
    ///
    /// <para>
    /// Anahtar eşleşmesi büyük/küçük harfe duyarsız: istemci camelCase
    /// gönderiyor, belge de camelCase yazılıyor ama ikisi ayrı uçlardan
    /// geldiği için biri PascalCase olduğunda alan silinmek yerine ikiye
    /// katlanıyordu.
    /// </para>
    /// </summary>
    /// <returns>Birleştirilmiş ve kaydedilmiş hâli.</returns>
    public T Birlestir<T>(string anahtar, T mevcut, JsonElement gelen) where T : class
    {
        if (gelen.ValueKind != JsonValueKind.Object) return mevcut;

        var belge = JsonSerializer.SerializeToNode(mevcut, Secenek)?.AsObject()
                    ?? new JsonObject();

        foreach (var alan in gelen.EnumerateObject())
        {
            var eskiAd = belge
                .Select(x => x.Key)
                .FirstOrDefault(x => string.Equals(x, alan.Name, StringComparison.OrdinalIgnoreCase));

            if (eskiAd is not null) belge.Remove(eskiAd);

            belge[alan.Name] = JsonNode.Parse(alan.Value.GetRawText());
        }

        var birlesik = belge.Deserialize<T>(Secenek) ?? mevcut;

        Yaz(anahtar, birlesik);

        return birlesik;
    }

    public void Yaz<T>(string anahtar, T deger)
    {
        var json = JsonSerializer.Serialize(deger, Secenek);
        using var db = _vt.Baglanti();
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = anahtar, d = json });
    }

    public MailAyarlari MailOku() => Oku("MAIL", new MailAyarlari());

    /// <summary>Personel kaynağındaki adların sistemdeki karşılıkları</summary>
    public PersonelAyarlari PersonelOku() => Oku("PERSONEL", new PersonelAyarlari());

    public void PersonelYaz(PersonelAyarlari ayar) => Yaz("PERSONEL", ayar);

    /// <summary>
    /// Çıkış mülakatı soruları ve çıkış nedenleri. İlk okumada boşsa
    /// basılı formdaki varsayılanlarla doldurulur; panelden değiştirilebilir.
    /// </summary>
    public CikisMulakatAyari CikisMulakatOku()
    {
        var ayar = Oku("CIKIS_MULAKAT", new CikisMulakatAyari());

        if (ayar.Sorular.Count == 0)
            ayar.Sorular = new List<string>
            {
                "Kendinizi burada iyi hissettiren şeyler nelerdir? Neler daha iyi hissettirir?",
                "Yöneticiniz işinizi kolaylaştıracak iyileştirmeler yaptı mı? Neler yapmasını isterdiniz?",
                "Rakiplerle aramızdaki farklar nelerdir? Neler önerirsiniz?",
                "Yöneticiniz, iş arkadaşlarınız, genel merkez ve müşterilerle iletişiminiz nasıldı?",
                "Yaptığınız işin takdir edildiğini düşünüyor musunuz?",
                "Ayrılma kararınızı etkileyen en önemli üç şey neydi?",
                "Buraya tekrar çalışmaya gelir miydiniz? Neden?",
                "Bir arkadaşınıza burada çalışmayı önerir miydiniz?",
                "İşe başladığınızda beklediğiniz ile karşılaştığınız arasında fark var mıydı?",
                "Ayrılmamanız için ne yapılabilirdi?"
            };

        if (ayar.Puanlamalar.Count == 0)
            ayar.Puanlamalar = new List<string>
            {
                "Mağaza müdürünüzü nasıl değerlendirirsiniz?",
                "Doğrudan yöneticinizi nasıl değerlendirirsiniz?",
                "Çalışma ortamı ve iş arkadaşlığı",
                "İş yükü ve çalışma saatleri",
                "Ücret ve yan hakların yeterliliği",
                "İşe başlarken aldığınız eğitim ve oryantasyon",
                "Genel merkezin size verdiği destek"
            };

        if (ayar.Nedenler.Count == 0)
            ayar.Nedenler = new List<string>
            {
                "Ahlak Kuralları", "Ailevi Nedenler", "Analık", "Askerlik",
                "Başka Yerde İş Bulma", "Çalışma Koşulları", "Devamsızlık",
                "Disiplinsiz Davranışlar Nedeniyle", "Eğitim", "Emeklilik",
                "Evlilik", "Görev Değişikliği (Rotasyon)",
                "İş Arkadaşı ile Anlaşamama", "Kendi İşini Kurma",
                "Kurum Kültürü", "Memlekete Gitme", "Mobbing",
                "Norm Kadro Kısıtlama", "Oryantasyon", "Performans", "Sağlık",
                "Sektör Değişikliği", "Stajer", "Taşınma", "Tutuklanma",
                "Vefat", "Yönetici ile Anlaşamama", "Yönetimsel Sorunlar"
            };

        return ayar;
    }

    public void CikisMulakatYaz(CikisMulakatAyari ayar) => Yaz("CIKIS_MULAKAT", ayar);

    /// <summary>
    /// Sicil kartı eşleştirmeleri. İlk okumada boşsa Mikro'daki mevcut
    /// kayıtlardan çıkarılan baskın değerlerle doldurulur; panelden
    /// düzeltilebilir.
    /// </summary>
    public SicilAyari SicilOku()
    {
        var ayar = Oku("SICIL", new SicilAyari());

        if (ayar.Unvanlar.Count == 0)
            ayar.Unvanlar = VarsayilanUnvanlar();

        if (ayar.Subeler.Count == 0)
            ayar.Subeler = VarsayilanSubeler();

        return ayar;
    }

    public void SicilYaz(SicilAyari ayar) => Yaz("SICIL", ayar);

    /* Aşağıdaki varsayılanlar Mikro'daki aktif personel kayıtlarından
       çıkarıldı: her ünvan/şube için en çok kullanılan değer alındı.
       Az sayıda istisna kayıt olduğu için bunlar öneri niteliğindedir;
       İK panelden doğrulamalıdır. */

    private static List<SicilUnvani> VarsayilanUnvanlar() => new()
    {
        new() { Bolum = "Kasiyer", UnvanKodu = 30, GorevKodu = "700.06", MeslekKodu = "5230.04" },
        new() { Bolum = "Part time Kasiyer", UnvanKodu = 30, GorevKodu = "700.06", MeslekKodu = "5230.04" },
        new() { Bolum = "Manav", UnvanKodu = 39, GorevKodu = "700.08", MeslekKodu = "5221.04" },
        new() { Bolum = "Manav Şefi", UnvanKodu = 40, GorevKodu = "700.07", MeslekKodu = "5221.04" },
        new() { Bolum = "Reyoner", UnvanKodu = 52, GorevKodu = "700.13", MeslekKodu = "5223.58" },
        new() { Bolum = "Reyon Şefi", UnvanKodu = 51, GorevKodu = "700.13", MeslekKodu = "5223.58" },
        new() { Bolum = "Kasap", UnvanKodu = 28, GorevKodu = "700.10", MeslekKodu = "7511.06" },
        new() { Bolum = "Kasap Şefi", UnvanKodu = 29, GorevKodu = "700.09", MeslekKodu = "7511.06" },
        new() { Bolum = "Şarküteri", UnvanKodu = 60, GorevKodu = "700.12", MeslekKodu = "5223.71" },
        new() { Bolum = "Şarküteri Şefi", UnvanKodu = 61, GorevKodu = "700.11", MeslekKodu = "5223.71" },
        new() { Bolum = "Kasa Şefi", UnvanKodu = 27, GorevKodu = "700.05", MeslekKodu = "5230.04" },
        new() { Bolum = "Mağaza Müdürü", UnvanKodu = 37, GorevKodu = "700.01", MeslekKodu = "1420.04" },
        new() { Bolum = "Mağaza Şefi", UnvanKodu = 38, GorevKodu = "700.34", MeslekKodu = "5222.17" },
        new() { Bolum = "Müdür Yardımcısı", UnvanKodu = 49, GorevKodu = "1213.23", MeslekKodu = "5222.17" },
        new() { Bolum = "Temizlik Görevlisi", UnvanKodu = 66, GorevKodu = "700.16", MeslekKodu = "9112.06" },
        new() { Bolum = "Ürün Kabul Görevlisi", UnvanKodu = 68, GorevKodu = "700.03", MeslekKodu = "9333.18" },
        new() { Bolum = "Tadolya", UnvanKodu = 62, GorevKodu = "700.56", MeslekKodu = "5230.04" },
        new() { Bolum = "Tadolya Şefi", UnvanKodu = 63, GorevKodu = "700.56", MeslekKodu = "5230.04" },
        new() { Bolum = "Depo Görevlisi", UnvanKodu = 11, GorevKodu = "800.02", MeslekKodu = "9333.18" },
        new() { Bolum = "Ekmek Şoförü", UnvanKodu = 71, GorevKodu = "700.14", MeslekKodu = "8322.02" },
        new() { Bolum = "Otopark Görevlisi", UnvanKodu = 81, GorevKodu = "700.19", MeslekKodu = "9629.06" }
    };

    private static List<SicilSubesi> VarsayilanSubeler() => new()
    {
        new() { SubeAdi = "Adakent", IsGrubuKodu = 34, IsGrubuAdi = "ADAKENT", BolgeKodu = "B49" },
        new() { SubeAdi = "Akevler", IsGrubuKodu = 30, IsGrubuAdi = "AKEVLER", BolgeKodu = "B46" },
        new() { SubeAdi = "Atakent Life", IsGrubuKodu = 44, IsGrubuAdi = "ATAKENT LIFE", BolgeKodu = "B59" },
        new() { SubeAdi = "Avcılar-1", IsGrubuKodu = 7, IsGrubuAdi = "AVCILAR-1", BolgeKodu = "B7" },
        new() { SubeAdi = "Avcılar-2", IsGrubuKodu = 9, IsGrubuAdi = "AVCILAR-2", BolgeKodu = "B11" },
        new() { SubeAdi = "Avcılar-3", IsGrubuKodu = 24, IsGrubuAdi = "AVCILAR-3", BolgeKodu = "B36" },
        new() { SubeAdi = "Bakırköy-2", IsGrubuKodu = 21, IsGrubuAdi = "BAKIRKÖY-2", BolgeKodu = "B24" },
        new() { SubeAdi = "Bakırköy-3", IsGrubuKodu = 45, IsGrubuAdi = "BAKIRKÖY-3", BolgeKodu = "B58" },
        new() { SubeAdi = "Başakşehir", IsGrubuKodu = 10, IsGrubuAdi = "BAŞAKŞEHİR", BolgeKodu = "B12" },
        new() { SubeAdi = "Bayrampaşa", IsGrubuKodu = 13, IsGrubuAdi = "BAYRAMPAŞA", BolgeKodu = "B15" },
        new() { SubeAdi = "Beykent", IsGrubuKodu = 33, IsGrubuAdi = "BEYKENT", BolgeKodu = "B48" },
        new() { SubeAdi = "Beylicium", IsGrubuKodu = 38, IsGrubuAdi = "BEYLİCİUM", BolgeKodu = "B53" },
        new() { SubeAdi = "Beylikdüzü-1", IsGrubuKodu = 11, IsGrubuAdi = "BEYLİKDÜZÜ-1", BolgeKodu = "B13" },
        new() { SubeAdi = "Beylikdüzü-2", IsGrubuKodu = 19, IsGrubuAdi = "BEYLİKDÜZÜ-2", BolgeKodu = "B21" },
        new() { SubeAdi = "Bizimmahalle", IsGrubuKodu = 42, IsGrubuAdi = "BİZİMMAHALLE", BolgeKodu = "B57" },
        new() { SubeAdi = "Cennet", IsGrubuKodu = 12, IsGrubuAdi = "CENNET", BolgeKodu = "B14" },
        new() { SubeAdi = "İhlasmarmara", IsGrubuKodu = 28, IsGrubuAdi = "İHLASMARMARA", BolgeKodu = "B43" },
        new() { SubeAdi = "İnönü", IsGrubuKodu = 22, IsGrubuAdi = "İNÖNÜ", BolgeKodu = "B32" },
        new() { SubeAdi = "Kavaklı", IsGrubuKodu = 48, IsGrubuAdi = "KAVAKLI", BolgeKodu = "B65" },
        new() { SubeAdi = "Mehterçeşme-1", IsGrubuKodu = 25, IsGrubuAdi = "MEHTERÇEŞME-1", BolgeKodu = "B38" },
        new() { SubeAdi = "Mehterçeşme-2", IsGrubuKodu = 27, IsGrubuAdi = "MEHTERÇEŞME-2", BolgeKodu = "B41" },
        new() { SubeAdi = "Merter", IsGrubuKodu = 23, IsGrubuAdi = "MERTER", BolgeKodu = "B33" },
        new() { SubeAdi = "Mimaroba-1", IsGrubuKodu = 8, IsGrubuAdi = "MİMAROBA-1", BolgeKodu = "B9" },
        new() { SubeAdi = "Mimaroba-2", IsGrubuKodu = 39, IsGrubuAdi = "MİMAROBA-2", BolgeKodu = "B52" },
        new() { SubeAdi = "Sefaköy", IsGrubuKodu = 4, IsGrubuAdi = "SEFAKÖY", BolgeKodu = "B4" },
        new() { SubeAdi = "Silivri", IsGrubuKodu = 46, IsGrubuAdi = "SİLİVRİ", BolgeKodu = "B60" },
        new() { SubeAdi = "Silivri-2", IsGrubuKodu = 49, IsGrubuAdi = "SİLİVRİ-2", BolgeKodu = "B62" },
        new() { SubeAdi = "Soğanlı", IsGrubuKodu = 16, IsGrubuAdi = "SOĞANLI", BolgeKodu = "B18" },
        new() { SubeAdi = "Soğuksu", IsGrubuKodu = 3, IsGrubuAdi = "SOĞUKSU", BolgeKodu = "B3" },
        new() { SubeAdi = "Tepecik", IsGrubuKodu = 43, IsGrubuAdi = "TEPECİK", BolgeKodu = "B58" },
        new() { SubeAdi = "Tepeüstü", IsGrubuKodu = 1, IsGrubuAdi = "TEPEÜSTÜ", BolgeKodu = "B2" },
        new() { SubeAdi = "Tevfikbey", IsGrubuKodu = 26, IsGrubuAdi = "TEVFİKBEY", BolgeKodu = "B42" },
        new() { SubeAdi = "Yakuplu-2", IsGrubuKodu = 47, IsGrubuAdi = "YAKUPLU-2", BolgeKodu = "B61" },
        new() { SubeAdi = "Yenibosna", IsGrubuKodu = 15, IsGrubuAdi = "YENİBOSNA", BolgeKodu = "B17" },
        new() { SubeAdi = "Yeşilova", IsGrubuKodu = 40, IsGrubuAdi = "YEŞİLOVA", BolgeKodu = "B54" },
        new() { SubeAdi = "Akçaburgaz Depo", IsGrubuKodu = 50, IsGrubuAdi = "AKÇABURGAZ DEPO", BolgeKodu = "B64" },
        new() { SubeAdi = "Z.Merkez Büro", IsGrubuKodu = 102, IsGrubuAdi = "Z.MERKEZ BURO", BolgeKodu = "B6" }
    };

    /// <summary>Aday havuzuna özel bölge tanımları</summary>
    public HavuzAyarlari HavuzOku() => Oku("HAVUZ", new HavuzAyarlari());

    public void HavuzYaz(HavuzAyarlari ayar) => Yaz("HAVUZ", ayar);

    /// <summary>Pozisyon bazında maaş skalaları</summary>
    public MaasAyarlari MaasOku() => Oku("MAAS", new MaasAyarlari());

    public void MaasYaz(MaasAyarlari ayar) => Yaz("MAAS", ayar);

    public FormAyarlari FormOku()
    {
        var ayar = Oku("FORM", VeritabaniServisi.VarsayilanForm());

        // Pozisyon listesi birim türlerinden türetilir; tek kaynaktan yönetilir
        if (ayar.BirimTurleri is { Count: > 0 })
        {
            ayar.Bolumler = ayar.BirimTurleri
                .SelectMany(x => x.Bolumler ?? new List<string>())
                .Select(x => (x ?? "").Trim())
                .Where(x => x.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(x => x)
                .ToList();
        }

        /* Özel roller belleğe alınıyor: yetki kuralları statik bir sınıfta
           ve ayar nesnesini göremiyor. Her okumada tazelenmesi, rol
           eklendikten sonra sunucuyu yeniden başlatma gereğini kaldırıyor. */
        Roller.OzelRolleriYukle(ayar.OzelRoller);

        return ayar;
    }
}

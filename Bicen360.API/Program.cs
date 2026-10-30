using System.Text;
using Dapper;
using Bicen360.API.Servisler;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

/* ==========================================================================
 * Biçen360 API
 * --------------------------------------------------------------------------
 * Kariyer sisteminden ayrı bir uygulama, ama tamamen bağımsız değil:
 *
 *   · Kullanıcılar ortak     — biPortal.KRY_KULLANICILAR
 *   · Jeton anahtarı ortak   — mobil uygulama tek jetonla iki API'ye gidiyor
 *   · Yetkiler ayrı          — biPortal.B360_YETKI
 *
 * Yani bir kullanıcı iki panele de aynı parolayla girer; ama İK panelinde
 * gördüğü sayfalarla burada gördüğü sayfaların hiçbir ilgisi yoktur.
 * ========================================================================== */

/* --------------------------------------------------------------------------
   Açılış hatalarının görünmesi
   --------------------------------------------------------------------------
   IIS'te barındırılırken açılışta bir istisna olursa süreç kapanıyor ve
   IIS kendi HTML hata sayfasını döndürüyor (500.30). O sayfa sebebi
   söylemiyor, uygulamanın günlük dosyası da her zaman yazılamıyor —
   sunucuya erişimi olmayan biri için sorun teşhis edilemez hâle geliyordu.

   Bu yüzden açılış bir sarmalayıcı içinde: hata olursa süreç kapanmıyor,
   yerine her isteğe sebebi JSON olarak dönen küçük bir uygulama ayağa
   kalkıyor. Böylece hata tarayıcıda ve mobil uygulamada okunabiliyor.
   -------------------------------------------------------------------------- */

try
{
var kurucu = WebApplication.CreateBuilder(args);

kurucu.Services
    .AddControllers()
    .AddJsonOptions(secenek =>
    {
        secenek.JsonSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;
    });

kurucu.Services.AddSingleton<VeritabaniServisi>();
kurucu.Services.AddSingleton<EtiketKayitServisi>();
kurucu.Services.AddSingleton<PanelKampanyaServisi>();
kurucu.Services.AddSingleton<JwtServisi>();
kurucu.Services.AddSingleton<RolServisi>();
kurucu.Services.AddSingleton<YetkiServisi>();
kurucu.Services.AddSingleton<PersonelServisi>();

/* Stok yönetimi: sipariş önerisi, transfer, raf denetimi, fire */
kurucu.Services.AddSingleton<StokServisi>();
/* Rakip web fiyatları ve ürün eşleştirme (09.10.2026) */
kurucu.Services.AddSingleton<RakipWebServisi>();
kurucu.Services.AddSingleton<BildirimServisi>();
kurucu.Services.AddSingleton<MailServisi>();
kurucu.Services.AddSingleton<RaporKapsami>();
kurucu.Services.AddSingleton<ArizaAkisServisi>();

/* Grup ayarları: sorumluluk, veri kapsamı, onay kademeleri */
kurucu.Services.AddSingleton<KapsamServisi>();

/* Panel kullanıcısının personel bağlantısı ve şube kilidi */
kurucu.Services.AddSingleton<PanelKullaniciServisi>();

/* Arıza kayıtlarına erişim ve görünürlük (arıza ve servis formu) */
kurucu.Services.AddSingleton<ArizaErisimi>();
kurucu.Services.AddSingleton<TanimYetkisi>();

/* Arıza görsellerini süresi dolunca siler */
kurucu.Services.AddHostedService<ArizaTemizlikGorevi>();

/* Rapor Merkezi: satış küpü, stok ve POS kaynakları; açılışta ön yükleme */
kurucu.Services.AddSingleton<RaporMerkeziServisi>();

/* Mobil Fiyat Kontrol: haftalık vardiya planı şartı */
kurucu.Services.AddSingleton<VardiyaPlaniDenetimi>();

/* Mobil oturum denetimi (26.10.2026): Personel rolündeki her istekte
   cihaz / oturum_acik kuralı ve işten ayrılma; sonuç kısa süre bellekte */
kurucu.Services.AddMemoryCache();
kurucu.Services.AddSingleton<MobilOturumDenetimi>();
kurucu.Services.AddHostedService<RaporMerkeziGorevi>();
/* 26.10.2026: SKT aylık planı kategori rotasyonuyla otomatik */
kurucu.Services.AddHostedService<SktOtomatikPlanGorevi>();
/* Pusula'nın biPortal kopyası (30.10.2026): Fiyat Kontrol'de ürün durumu */
kurucu.Services.AddHostedService<PusulaYukleGorevi>();

/* Künye sorgusu hmzYS servisine gidiyor; fabrika olmadan her istekte yeni
   HttpClient açmak soket tüketiyor. */
kurucu.Services.AddHttpClient();

/* ------------------------------------------------------------------- CORS */

var panelAdresleri = kurucu.Configuration
    .GetSection("Panel:Adresler").Get<string[]>() ?? Array.Empty<string>();

kurucu.Services.AddCors(secenek =>
{
    secenek.AddPolicy("BicenPolitika", kural => kural
        .WithOrigins(panelAdresleri)
        .AllowAnyHeader()
        .AllowAnyMethod());
});

/* -------------------------------------------------------------------- JWT */

var jwtAnahtar = kurucu.Configuration["Jwt:Anahtar"];
var jwtYayinci = kurucu.Configuration["Jwt:Yayinci"];

if (string.IsNullOrWhiteSpace(jwtAnahtar) || jwtAnahtar.Length < 32)
{
    Console.WriteLine();
    Console.WriteLine("   JWT anahtarı tanımsız ya da çok kısa.");
    Console.WriteLine("   appsettings.json içindeki Jwt:Anahtar değerini");
    Console.WriteLine("   BicenKariyer.API ile AYNI olacak şekilde yazınız.");
    Console.WriteLine();
}

if (jwtAnahtar?.Contains("LutfenDegistiriniz", StringComparison.OrdinalIgnoreCase) == true)
{
    Console.WriteLine();
    Console.WriteLine("   UYARI: JWT anahtarı hâlâ varsayılan değerde.");
    Console.WriteLine("   Değiştirirken İKİ appsettings.json dosyasını birlikte");
    Console.WriteLine("   güncelleyiniz; yalnızca birini değiştirmek mobil");
    Console.WriteLine("   tarafta yarısı çalışan bir oturuma yol açar.");
    Console.WriteLine();
}

kurucu.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(secenek =>
    {
        secenek.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtYayinci,
            ValidAudience = jwtYayinci,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtAnahtar ?? new string('x', 64))),
            ClockSkew = TimeSpan.FromMinutes(1)
        };

        /* Mobil uygulamada Image bileşeni Authorization başlığı
           gönderemiyor; görsel uçlarında jeton sorgu olarak geliyor ve
           burada normal jeton gibi doğrulanıyor. Yalnızca görsel
           uçlarında kabul edilir: her uçta açık olsaydı jeton adres
           çubuğunda ve sunucu günlüklerinde dolaşırdı. */
        secenek.Events = new JwtBearerEvents
        {
            OnMessageReceived = baglam =>
            {
                var yol = baglam.HttpContext.Request.Path.Value ?? "";

                /* Görsel ve belge uçları yeni sekmede açılıyor; tarayıcı o
                   istekte başlık gönderemediği için jeton sorgudan alınıyor. */
                var gorselUcu = yol.Contains("/Gorsel", StringComparison.OrdinalIgnoreCase)
                             || yol.Contains("/Belge", StringComparison.OrdinalIgnoreCase);

                if (string.IsNullOrEmpty(baglam.Token) && gorselUcu)
                {
                    var belirtec = baglam.Request.Query["j"].ToString();
                    if (!string.IsNullOrWhiteSpace(belirtec)) baglam.Token = belirtec;
                }

                return Task.CompletedTask;
            }
        };
    });

/* Yanıt sıkıştırma (06.10.2026): personel ve kart listeleri yüzlerce satır
   JSON; şubelerde ve mobil veride sıkıştırmasız gidiyordu. Brotli/Gzip,
   en hızlı düzey (sunucuyu yormasın). IIS de sıkıştırıyorsa ikinci kez
   sıkıştırılmaz: yanıt zaten Content-Encoding taşıyor. */
kurucu.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProvider>();
    o.Providers.Add<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProvider>();
});
kurucu.Services.Configure<Microsoft.AspNetCore.ResponseCompression.BrotliCompressionProviderOptions>(
    o => o.Level = System.IO.Compression.CompressionLevel.Fastest);
kurucu.Services.Configure<Microsoft.AspNetCore.ResponseCompression.GzipCompressionProviderOptions>(
    o => o.Level = System.IO.Compression.CompressionLevel.Fastest);

kurucu.Services.AddAuthorization();

var uygulama = kurucu.Build();

/* --------------------------------------------------------------- Kurulum */

using (var kapsam = uygulama.Services.CreateScope())
{
    var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

    vt.Kurulum();

    if (!vt.KullaniciTablosuVar())
    {
        Console.WriteLine();
        Console.WriteLine("   KRY_KULLANICILAR tablosu bulunamadı.");
        Console.WriteLine("   Bu panel Kariyer sistemiyle aynı kullanıcı tablosunu");
        Console.WriteLine("   kullanıyor; bağlantı dizesinin biPortal'ı");
        Console.WriteLine("   gösterdiğinden emin olunuz.");
        Console.WriteLine();
    }
}

/* Sıkıştırma ve yavaş istek kaydı en başta */
uygulama.UseResponseCompression();

/* 2 saniyeyi geçen istekler günlüğe (logs\stdout): hangi sayfanın
   yavaş olduğu ölçülerek görülsün, tahminle değil. */
uygulama.Use(async (baglam, sonraki) =>
{
    var sure = System.Diagnostics.Stopwatch.StartNew();

    await sonraki();

    if (sure.ElapsedMilliseconds >= 2000)
        baglam.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Bicen360.Hiz")
            .LogWarning("YAVAŞ İSTEK {Sn:0.0} sn · {Yontem} {Yol}{Sorgu} · {Durum}",
                sure.ElapsedMilliseconds / 1000.0, baglam.Request.Method, baglam.Request.Path,
                baglam.Request.QueryString, baglam.Response.StatusCode);
});

/* -------------------------------------------------------------- Başlıklar */

uygulama.Use(async (baglam, sonraki) =>
{
    var basliklar = baglam.Response.Headers;

    basliklar["X-Content-Type-Options"] = "nosniff";
    basliklar["X-Frame-Options"] = "DENY";
    basliklar["Referrer-Policy"] = "strict-origin-when-cross-origin";

    await sonraki();
});

/* Yakalanmamış hatalar HTML yerine JSON döner.
   Panel her yanıtta "hata" alanını okuyor; HTML dönen 500'de gövde
   ayrıştırılamadığı için ekranda yalnızca "İşlem tamamlanamadı"
   görünüyordu ve sebep kayboluyordu. */
uygulama.Use(async (baglam, sonraki) =>
{
    try
    {
        await sonraki();
    }
    catch (Exception hata)
    {
        var gunluk = baglam.RequestServices
            .GetRequiredService<ILoggerFactory>()
            .CreateLogger("Bicen360");

        gunluk.LogError(hata, "İstek başarısız: {Yol}", baglam.Request.Path);

        if (baglam.Response.HasStarted) throw;

        baglam.Response.Clear();
        baglam.Response.StatusCode = 500;

        await baglam.Response.WriteAsJsonAsync(new
        {
            hata = "Sunucuda bir sorun oluştu.",
            ayrinti = hata.Message
        });
    }
});

uygulama.UseCors("BicenPolitika");
uygulama.UseAuthentication();
uygulama.UseAuthorization();

/* Mobil oturum denetimi (26.10.2026): Kariyer API'deki ara katmanın aynısı.
   Ayrılan personel 401 ve { kod: "ayrildi" } alır; uygulama jetonu silip
   giriş ekranına döner. Panel rolleri Personel olmadığı için etkilenmez. */
uygulama.UseMobilOturumDenetimi();

/* Biçen360 modül kullanımı (16.10.2026): Kariyer'deki "Uygulama Kullanımı"
   sayfası fiyat kontrol, rakip fiyat ve arıza ekranlarını da görsün */
uygulama.Use(async (baglam, sonraki) =>
{
    Bicen360.API.Servisler.ModulKullanimi.Kaydet(baglam);
    await sonraki();
});

uygulama.MapControllers();

/* Kurum logosu tek bir yerden yayınlanır: wwwroot/logo.png
   Kariyer API'deki uçla aynı; iki panel de kendi sunucusundan alıyor. */
uygulama.MapGet("/api/Logo", (IWebHostEnvironment ortam, HttpContext baglam) =>
{
    // Logo değiştirildiğinde tarayıcı eski görseli göstermesin
    baglam.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
    baglam.Response.Headers.Pragma = "no-cache";

    var klasor = string.IsNullOrWhiteSpace(ortam.WebRootPath)
        ? Path.Combine(AppContext.BaseDirectory, "wwwroot")
        : ortam.WebRootPath;

    foreach (var ad in new[] { "logo.png", "logo.jpg", "logo.jpeg", "logo.svg" })
    {
        var yol = Path.Combine(klasor, ad);
        if (!File.Exists(yol)) continue;

        var tur = Path.GetExtension(ad).ToLowerInvariant() switch
        {
            ".svg" => "image/svg+xml",
            ".jpg" or ".jpeg" => "image/jpeg",
            _ => "image/png"
        };

        return Results.File(yol, tur);
    }

    return Results.NotFound();
});

/* Sunucunun ayakta olduğunu ve veritabanına ulaşabildiğini doğrular.
   Giriş çalışmadığında ilk bakılacak yer burası: sorunun bağlantıda mı,
   eksik tabloda mı olduğunu tek istekte söyler. */
uygulama.MapGet("/api/Durum", (VeritabaniServisi vt) =>
{
    var sonuc = new Dictionary<string, object>
    {
        ["uygulama"] = "Biçen360",
        ["zaman"] = DateTime.Now
    };

    try
    {
        using var db = vt.Baglanti();

        sonuc["veritabani"] = "baglandi";

        foreach (var tablo in new[]
                 {
                     "KRY_KULLANICILAR", "KRY_BILDIRIM", "KRY_MOBIL_JETON",
                     "B360_YETKI", "B360_DEPARTMAN", "B360_DEPARTMAN_TEMSILCI",
                     "B360_ENVANTER", "B360_ARIZA", "B360_ARIZA_TUR"
                 })
        {
            var varMi = db.ExecuteScalar<int>(
                $"SELECT CASE WHEN OBJECT_ID('{tablo}') IS NULL THEN 0 ELSE 1 END") == 1;

            sonuc[tablo] = varMi ? "var" : "YOK";
        }

        sonuc["kullaniciSayisi"] = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_KULLANICILAR WHERE aktif = 1");
    }
    catch (Exception hata)
    {
        sonuc["veritabani"] = "HATA";
        sonuc["ayrinti"] = hata.Message;
    }

    return Results.Ok(sonuc);
});

uygulama.Run();
}
catch (Exception acilisHatasi)
{
    HataylaAyagaKalk(acilisHatasi);
}

/* --------------------------------------------------------------------------
   Yedek uygulama: yalnızca hatayı anlatır
   -------------------------------------------------------------------------- */

static void HataylaAyagaKalk(Exception hata)
{
    var metin = hata.ToString();

    /* Dosyaya da yazılır: uygulama havuzu kimliğinin yazma izni varsa
       sunucuda kalıcı bir iz kalır. İzin yoksa sessizce geçilir, asıl
       amaç zaten yanıtta göstermek. */
    try
    {
        var klasor = Path.Combine(AppContext.BaseDirectory, "logs");

        if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

        File.WriteAllText(
            Path.Combine(klasor, "baslangic-hatasi.txt"),
            $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}\r\n{metin}");
    }
    catch
    {
        /* Yazamadıysak yanıtta göstermeye devam */
    }

    Console.Error.WriteLine("BİÇEN360 AÇILIŞ HATASI:");
    Console.Error.WriteLine(metin);

    var yedek = WebApplication.CreateBuilder().Build();

    yedek.Run(async baglam =>
    {
        baglam.Response.StatusCode = 500;
        baglam.Response.ContentType = "application/json; charset=utf-8";

        await baglam.Response.WriteAsJsonAsync(new
        {
            hata = "Biçen360 açılışta hata verdi.",
            ayrinti = hata.Message,
            tur = hata.GetType().Name,

            /* İç istisna asıl sebebi taşıyor: 'bir hata oluştu' diyen dış
               istisnanın altında genelde bağlantı ya da dosya hatası olur. */
            icHata = hata.InnerException?.Message,
            yigin = metin
        });
    });

    yedek.Run();
}

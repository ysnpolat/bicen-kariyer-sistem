using System.Text;
using BicenKariyer.API;
using BicenKariyer.API.Servisler;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

var kurucu = WebApplication.CreateBuilder(args);

/* ------------------------------------------------------------------ servisler */

/* Personel belgeleri 500 MB'a kadar yüklenebiliyor (tutanak ekleri, taranmış
   sözleşmeler). Varsayılan sınırlar çok daha düşük ve aşıldığında istek
   denetleyiciye hiç ulaşmadan, açıklayıcı bir mesaj olmadan düşüyordu. */
const long BelgeSiniri = 500L * 1024 * 1024;

kurucu.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(secenek =>
{
    secenek.MultipartBodyLengthLimit = BelgeSiniri;
    secenek.ValueLengthLimit = int.MaxValue;
    secenek.MemoryBufferThreshold = int.MaxValue;
});

/* IIS arkasında ayrı bir sınır daha var; ikisi de açılmazsa yükleme
   404.13 ile reddediliyor. web.config içindeki maxAllowedContentLength de
   bununla birlikte artırılmalı. */
kurucu.Services.Configure<Microsoft.AspNetCore.Builder.IISServerOptions>(secenek =>
{
    secenek.MaxRequestBodySize = BelgeSiniri;
});

kurucu.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Core.KestrelServerOptions>(
    secenek => secenek.Limits.MaxRequestBodySize = BelgeSiniri);

kurucu.Services.AddControllers()
    .AddJsonOptions(secenek =>
    {
        secenek.JsonSerializerOptions.PropertyNamingPolicy =
            System.Text.Json.JsonNamingPolicy.CamelCase;
        secenek.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });

kurucu.Services.AddEndpointsApiExplorer();
kurucu.Services.AddSwaggerGen();

kurucu.Services.AddSingleton<VeritabaniServisi>();
kurucu.Services.AddSingleton<HizSiniriServisi>();
kurucu.Services.AddSingleton<GuvenlikGunlugu>();
kurucu.Services.AddSingleton<KaraListeServisi>();
kurucu.Services.AddSingleton<OnayServisi>();

/* Turnstile doğrulaması için dış istek istemcisi */
kurucu.Services.AddHttpClient();
kurucu.Services.AddSingleton<TurnstileServisi>();
kurucu.Services.AddSingleton<UlkeServisi>();
kurucu.Services.AddSingleton<YapayZekaServisi>();
kurucu.Services.AddSingleton<SohbetServisi>();
kurucu.Services.AddScoped<ToplulukDenetimi>();
kurucu.Services.AddSingleton<SmsServisi>();
kurucu.Services.AddSingleton<OkutmaRaporuServisi>();
kurucu.Services.AddScoped<OkutmaVeriHazirlayici>();
kurucu.Services.AddScoped<MikroResimServisi>();
kurucu.Services.AddScoped<YetkiServisi>();
kurucu.Services.AddScoped<BildirimServisi>();

/* Portal yetkileri: haftalık izin onayı gibi Kariyer akışları, Biçen360
   yetki ekranından yönetilebiliyor. Aynı tabloya bağlı olduğu için ayrı
   bir bağlantı gerekmiyor. */
kurucu.Services.AddScoped<PortalYetkiServisi>();

/* Yıllık izin onay zinciri: organizasyon şemasından. Bellek statik,
   servis istek başına; bağımlılıkları da öyle. */
kurucu.Services.AddScoped<IzinOnayKuralServisi>();
kurucu.Services.AddScoped<AvansOnayZinciri>();
/* İzin talebinin onay zinciri (26.10.2026): avans tablosundaki süreç, İK sonda */
kurucu.Services.AddScoped<IzinZincirKurali>();
kurucu.Services.AddScoped<IzinOnayZinciri>();
kurucu.Services.AddScoped<GorevlendirmeServisi>();
kurucu.Services.AddScoped<FazlaMesaiKuralServisi>();
kurucu.Services.AddScoped<FazlaMesaiUcretServisi>();

/* Genel merkez / depo departmanları: ekip ve 1. onay */
kurucu.Services.AddScoped<DepartmanServisi>();

/* İzin talebinin basılı formu: doldurulup şubeye / İK'ya maillenir */
kurucu.Services.AddScoped<IzinFormuServisi>();
kurucu.Services.AddScoped<DevamsizlikTutanakServisi>();

/* Puantaj ve Ekibim: kim kimin ekibinde (izin onay tablosundan) */
kurucu.Services.AddScoped<EkipServisi>();
kurucu.Services.AddSingleton<EkibimKurallari>();

/* Performans ölçütlerinin mağaza değerleri ve bildirimleri */
kurucu.Services.AddSingleton<PerformansOlcutServisi>();

/* Kart geçişlerinin vardiya tablosuna aktarımı */
kurucu.Services.AddScoped<KartGecisAktarimServisi>();
kurucu.Services.AddHostedService<KartGecisGorevi>();
kurucu.Services.AddHostedService<HukukHatirlatmaGorevi>();
/* İcra / maaş haczi (30.10.2026): hesap servisi ve cevap süresi / ayrılış görevi */
kurucu.Services.AddScoped<IcraServisi>();
kurucu.Services.AddHostedService<IcraGorevi>();
kurucu.Services.AddHostedService<MaasOnbellegiGorevi>();
kurucu.Services.AddHostedService<PerformansBildirimGorevi>();
kurucu.Services.AddScoped<OrgOnayServisi>();
kurucu.Services.AddScoped<PersonelKaynagiServisi>();

/* Personel kartından Mikro'ya yazma (02.10.2026) */
kurucu.Services.AddScoped<MikroPersonelYazmaServisi>();
/* İşe Al ekranından Mikro'da sicil kartı açma (09.10.2026) */
kurucu.Services.AddScoped<MikroSicilServisi>();
kurucu.Services.AddScoped<GiftKartServisi>();
kurucu.Services.AddScoped<AyrilacakPersonelServisi>();
kurucu.Services.AddScoped<IzinGunuServisi>();
/* İzin Yönetimi raporu ve şube × ay izin kontenjanı (07.10.2026) */
kurucu.Services.AddScoped<IzinRaporServisi>();
kurucu.Services.AddScoped<IzinKontenjanServisi>();
kurucu.Services.AddScoped<PersonelDegisimServisi>();

/* Raporlu personel: personel kartındaki raporlar + rapor izinleri (03.10.2026) */
kurucu.Services.AddSingleton<RaporluServisi>();
kurucu.Services.AddSingleton<IseGirisEvrakServisi>();
kurucu.Services.AddSingleton<PatronServisi>();

/* Biçen360 patron bildirimleri: yeni onay ve etik bildirimi anında
   (OnayServisi / EtikController haber veriyor), sabah özeti ve kritik
   okutma uyarısı dakikalık görevle (03.10.2026) */
kurucu.Services.AddSingleton<PatronBildirimServisi>();
kurucu.Services.AddHostedService<PatronBildirimGorevi>();

/* Her sabah bir önceki günün okutma raporunu mail atar */
kurucu.Services.AddHostedService<OkutmaRaporuGorevi>();
kurucu.Services.AddHostedService<GiftKartBildirimGorevi>();

/* Kıdem / hak ediş tarihinin bordrodan otomatik hesabı (05.10.2026) */
kurucu.Services.AddScoped<KidemBordroServisi>();
kurucu.Services.AddHostedService<KidemBordroGorevi>();

/* Yıl dönümünde yıllık izin hakkını bakiyeye otomatik yükler (05.10.2026) */
kurucu.Services.AddScoped<IzinHakYuklemeServisi>();
kurucu.Services.AddScoped<DogumTarihiServisi>();
/* Avans üst limiti, Yıllık İzin Ücretleri'nin maaş hesabını kullanıyor */
kurucu.Services.AddTransient<BicenKariyer.API.Controllers.IzinUcretiController>();
kurucu.Services.AddTransient<BicenKariyer.API.Controllers.BicenKartPuanController>();
/* İşe alım kartı görevi kartı panel yolundan bağlıyor (07.10.2026) */
kurucu.Services.AddTransient<BicenKariyer.API.Controllers.BicenKartController>();
kurucu.Services.AddHostedService<BasvuruKartGorevi>();
kurucu.Services.AddHostedService<IzinHakYuklemeGorevi>();

/* Checklist görselleri yedi gün sonra silinir; hacim hızla büyüyor. */
kurucu.Services.AddHostedService<ChecklistTemizlikGorevi>();
kurucu.Services.AddScoped<KazanKazanServisi>();
kurucu.Services.AddHostedService<KazanKazanGorevi>();
kurucu.Services.AddScoped<DonemselDegerlendirmeServisi>();
kurucu.Services.AddHostedService<DonemselDegerlendirmeGorevi>();
kurucu.Services.AddHostedService<BasvuruBayrakGorevi>();
kurucu.Services.AddHostedService<UyumOtomatikGorevi>();
kurucu.Services.AddHostedService<MazeretBelgeGorevi>();
/* İzin talebi 1. aşamada 48 saat beklerse birim yöneticisi adına otomatik onay */
kurucu.Services.AddTransient<BicenKariyer.API.Controllers.IzinTalepController>();
kurucu.Services.AddTransient<BicenKariyer.API.Controllers.AvansController>();
kurucu.Services.AddHostedService<IzinOtomatikOnayGorevi>();
/* Mikro'da işe girişi yapılan personele bir kez Biçen360 kurulum SMS'i */
kurucu.Services.AddHostedService<UygulamaDavetGorevi>();
/* Biçen360 güncelleme hatırlatması (08.10.2026) */
kurucu.Services.AddHostedService<UygulamaGuncellemeGorevi>();
kurucu.Services.AddHostedService<OryantasyonHatirlatmaGorevi>();

/* Takvim notlarının hatırlatmaları */
kurucu.Services.AddHostedService<HatirlatmaGorevi>();

/* Çıkışına bir gün kalan personel için İK'ya uyarı düşürür */
kurucu.Services.AddHostedService<AyrilikUyariGorevi>();

/* Süresi dolan ücret pusulalarını onaylanmış sayar */
kurucu.Services.AddHostedService<PusulaOtomatikGorevi>();

/* Mesai saati geçtiği hâlde vardiya okutmayana hatırlatma gönderir */
kurucu.Services.AddHostedService<VardiyaHatirlatmaGorevi>();
kurucu.Services.AddHostedService<VardiyaOtomatikGonderGorevi>();
kurucu.Services.AddHostedService<BildirimKuyrukGorevi>();
kurucu.Services.AddHostedService<IseAlimTutarlilikGorevi>();

/* Ayrılıştan 48 saat sonra çıkış anketi */
kurucu.Services.AddHostedService<CikisAnketiGorevi>();

/* Ayrılan personelin Biçen Kart bağlantısı: herkese açık sayfanın adres
   bazlı hız sınırı ve süre/bakiye denetimi (süre dolunca kart şifresi
   kilitlenir, İK'ya bildirim düşer). */
kurucu.Services.AddSingleton<KartLinkHizSiniri>();
kurucu.Services.AddHostedService<KartAyrilanGorevi>();
kurucu.Services.AddHostedService<DuyuruPlanGorevi>();
/* Duyuru videoları: 60 gün sonra silinir, kalanlar hızlı başlatmaya çevrilir (28.10.2026) */
kurucu.Services.AddHostedService<DuyuruVideoTemizlikGorevi>();
kurucu.Services.AddSingleton<AyarServisi>();
kurucu.Services.AddSingleton<YoneticiBulucu>();
kurucu.Services.AddSingleton<UyumGonderimServisi>();
kurucu.Services.AddSingleton<JwtServisi>();
kurucu.Services.AddScoped<MailServisi>();

/* Mobil oturum denetimi (26.10.2026): Personel rolündeki her istekte
   cihaz / oturum_acik kuralı ve personelin hâlâ çalışıp çalışmadığı;
   çıkış tarihi gelenin oturumu kapanır. Sonuç kısa süre bellekte. */
kurucu.Services.AddMemoryCache();
kurucu.Services.AddSingleton<MobilOturumDenetimi>();
kurucu.Services.AddHostedService<AyrilanOturumGorevi>();

/* ----------------------------------------------------------------------- CORS */

kurucu.Services.AddCors(secenek =>
{
    /*
     * Tarayıcıdan gelen isteklerde hangi sitelere izin verileceği.
     *
     * Varsayılan olarak yalnızca kendi alan adlarımız kabul edilir; başka
     * bir sitenin sayfası panelin uçlarını çağıramaz. Geliştirme için
     * localhost adresleri de açıktır.
     *
     * Ek adres gerekirse appsettings.json içine yazılır:
     *   'Cors': { 'Adresler': [ 'https://ornek.com' ] }
     */
    var izinliAdresler = kurucu.Configuration
        .GetSection("Cors:Adresler").Get<string[]>() ?? Array.Empty<string>();

    secenek.AddPolicy("BicenPolitika", kural => kural
        .SetIsOriginAllowed(kaynak =>
        {
            if (string.IsNullOrWhiteSpace(kaynak)) return false;

            if (izinliAdresler.Contains(kaynak, StringComparer.OrdinalIgnoreCase))
                return true;

            if (!Uri.TryCreate(kaynak, UriKind.Absolute, out var adres))
                return false;

            var sunucu = adres.Host;

            /* Geliştirme ortamı */
            if (sunucu is "localhost" or "127.0.0.1" or "::1") return true;

            /* Kendi alan adlarımız ve alt alanları */
            return sunucu.Equals("bicen.com.tr", StringComparison.OrdinalIgnoreCase)
                || sunucu.EndsWith(".bicen.com.tr", StringComparison.OrdinalIgnoreCase);
        })
        .AllowAnyHeader()
        .AllowAnyMethod());
});

/* ------------------------------------------------------------------------ JWT */

var jwtAnahtar = kurucu.Configuration["Jwt:Anahtar"];

/* Biçen360 patron fotoğraf bağlantılarının imza anahtarı (04.10.2026) */
BicenKariyer.API.Servisler.FotoImzasi.Ayarla(jwtAnahtar);

/* Varsayılan anahtar canlıda kullanılmamalı: bu anahtarı bilen biri
   kendisine yönetici belirteci üretebilir. Açılışta yüksek sesle uyarılır. */
if (string.IsNullOrWhiteSpace(jwtAnahtar) ||
    jwtAnahtar.Contains("LutfenDegistiriniz", StringComparison.OrdinalIgnoreCase) ||
    jwtAnahtar.Length < 32)
{
    Console.WriteLine();
    Console.WriteLine("  ============================================================");
    Console.WriteLine("   GÜVENLİK UYARISI");
    Console.WriteLine();
    Console.WriteLine("   JWT anahtarı varsayılan değerde veya çok kısa.");
    Console.WriteLine("   Bu anahtarı bilen biri yönetici oturumu üretebilir.");
    Console.WriteLine();
    Console.WriteLine("   appsettings.json içindeki Jwt:Anahtar değerini");
    Console.WriteLine("   en az 64 karakterlik rastgele bir metinle değiştiriniz.");
    Console.WriteLine("  ============================================================");
    Console.WriteLine();
}
var jwtYayinci = kurucu.Configuration["Jwt:Yayinci"];

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
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtAnahtar)),
            ClockSkew = TimeSpan.FromMinutes(2)
        };

        /* Resim gibi doğrudan tarayıcıya verilen adreslerde başlık
           gönderilemediği için belirteç adres satırından da okunur. */
        secenek.Events = new JwtBearerEvents
        {
            OnMessageReceived = baglam =>
            {
                /* Görsel uçlarında belirteç adres satırından okunur;
                   img etiketi istek başlığı gönderemez. */
                var yol = baglam.Request.Path.Value ?? "";

                var gorselUcu =
                    baglam.Request.Path.StartsWithSegments("/api/Personel/Resim")
                    || baglam.Request.Path.StartsWithSegments("/api/Checklist/Gorsel")
                    /* Kazan-Kazan öneri görseli (20.10.2026) */
                    || baglam.Request.Path.StartsWithSegments("/api/KazanKazan/Gorsel")
                    /* Sohbet ekleri (22.10.2026): img / video etiketi başlık gönderemez */
                    || baglam.Request.Path.StartsWithSegments("/api/Mesajlasma/Dosya")

                    /* Belge önizlemesi: iframe ve img etiketi istek başlığı
                       gönderemiyor, mobilde de belge tarayıcıda açılıyor. */
                    || baglam.Request.Path.StartsWithSegments("/api/PersonelBelge/Onizle")
                    || baglam.Request.Path.StartsWithSegments("/api/Mobil/BelgeGoster")
                    || baglam.Request.Path.StartsWithSegments("/api/Mobil/PusulaGoster")
                    || baglam.Request.Path.StartsWithSegments("/api/Egitim/Goster")

                    /* Yardım videosu: telefondaki oynatıcı başlık gönderemiyor */
                    || baglam.Request.Path.StartsWithSegments("/api/YardimVideo/Izle")
                    || baglam.Request.Path.StartsWithSegments("/api/Pusula/Goster")

                    /* Biçen360 patron görünümü fotoğrafları: WebView
                       sayfalarındaki img etiketi başlık gönderemiyor */
                    || baglam.Request.Path.StartsWithSegments("/api/PatronMobil/Foto")
                    /* Talep görselleri: Talep penceresi ve Talepler sayfasındaki img (30.10.2026) */
                    || (yol.StartsWith("/api/Talep/", StringComparison.OrdinalIgnoreCase)
                        && yol.Contains("/Gorsel/", StringComparison.OrdinalIgnoreCase))
                    || (yol.StartsWith("/api/Basvuru/", StringComparison.OrdinalIgnoreCase)
                        && yol.EndsWith("/Fotograf", StringComparison.OrdinalIgnoreCase))

                    /* İzin / fazla mesai formu ve yüklenen imzalı form (09.10.2026):
                       Biçen360 telefon tarayıcısında açıyor, başlık gönderemiyor */
                    || ((yol.StartsWith("/api/IzinTalep/", StringComparison.OrdinalIgnoreCase)
                         || yol.StartsWith("/api/FazlaMesai/", StringComparison.OrdinalIgnoreCase))
                        && (yol.EndsWith("/FormDosya", StringComparison.OrdinalIgnoreCase)
                            || yol.EndsWith("/ImzaliForm", StringComparison.OrdinalIgnoreCase)
                            /* Raporlu izinde rapor (23.10.2026) */
                            || yol.EndsWith("/Rapor", StringComparison.OrdinalIgnoreCase)))
                    /* Hukuk masası belgesi (24.10.2026): tarayıcıda yeni sekmede açılıyor */
                    || yol.StartsWith("/api/Hukuk/Belge/", StringComparison.OrdinalIgnoreCase)
                    /* Denkleştirme formu ve imzalı form (23.10.2026) */
                    || (yol.StartsWith("/api/Denklestirme/", StringComparison.OrdinalIgnoreCase)
                        && (yol.EndsWith("/Form", StringComparison.OrdinalIgnoreCase)
                            || yol.EndsWith("/ImzaliForm", StringComparison.OrdinalIgnoreCase)));

                if (string.IsNullOrEmpty(baglam.Token) && gorselUcu)
                {
                    var belirtec = baglam.Request.Query["t"].ToString();
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

/* Ayarlar Merkezi (07.10.2026): koddaki süreler/sınırlar, seçenek listeleri
   ve avans onay akışı veritabanından okunuyor (60 sn önbellek). */
{
    var vtAyar = uygulama.Services.GetRequiredService<VeritabaniServisi>();
    BicenKariyer.API.Servisler.Parametre.Baslat(vtAyar, uygulama.Configuration);
    BicenKariyer.API.Servisler.SecenekListesi.Baslat(vtAyar);
    BicenKariyer.API.Servisler.KararEtiketi.Baslat(vtAyar);
    BicenKariyer.API.Servisler.AvansAkisi.Baslat(vtAyar);
    BicenKariyer.API.Servisler.MikroKullanicilari.Baslat(vtAyar);
    BicenKariyer.API.Servisler.MikroSicilServisi.Baslat(uygulama.Services.GetRequiredService<ILogger<BicenKariyer.API.Servisler.MikroSicilServisi>>());
}

/* --------------------------------------------------------- veritabanı kurulumu */

var veritabaniHazir = false;
var veritabaniHatasi = "";

try
{
    uygulama.Services.GetRequiredService<VeritabaniServisi>().Baslat();
    veritabaniHazir = true;
    uygulama.Logger.LogInformation("Veritabanı hazır.");

    /* Panelden açılmış roller açılışta belleğe alınıyor: giriş isteği
       ayarları okumadan jeton üretiyor ve özel rollü bir kullanıcı ilk
       girişte temel rol hakkını alamıyordu. */
    using (var kapsam = uygulama.Services.CreateScope())
    {
        var ayarServisi = kapsam.ServiceProvider.GetRequiredService<AyarServisi>();

        Roller.OzelRolleriYukle(ayarServisi.FormOku().OzelRoller);

        uygulama.Logger.LogInformation(
            "Özel rol sayısı: {Adet}", Roller.Ozeller.Count);
    }
}
catch (Exception hata)
{
    veritabaniHatasi = hata.Message;
    uygulama.Logger.LogError("VERİTABANI HATASI: {mesaj}", hata.Message);
    Console.WriteLine();
    Console.WriteLine("=========================================================");
    Console.WriteLine("  VERİTABANI HAZIRLANAMADI");
    Console.WriteLine("=========================================================");
    Console.WriteLine(hata.Message);
    Console.WriteLine("=========================================================");
    Console.WriteLine();
}

/* Güvenlik katmanlarının durumu açılışta bildirilir; bir katmanın sessizce
   devre dışı kalması fark edilmeden geçmesin. */
{
    var turnstileGizli = uygulama.Configuration["Turnstile:GizliAnahtar"];
    var ulkeAcik = uygulama.Configuration.GetValue("UlkeDenetimi:Acik", false);

    Console.WriteLine();
    Console.WriteLine("  Güvenlik katmanları:");
    Console.WriteLine($"    Turnstile     : " +
        (string.IsNullOrWhiteSpace(turnstileGizli) ? "KAPALI (anahtar yok)" : "açık"));
    Console.WriteLine($"    Ülke denetimi : " + (ulkeAcik ? "açık" : "kapalı"));
    Console.WriteLine();
}

/* -------------------------------------------------------------------- ardışık */

if (uygulama.Environment.IsDevelopment())
{
    uygulama.UseSwagger();
    uygulama.UseSwaggerUI();
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
        baglam.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("BicenKariyer.Hiz")
            .LogWarning("YAVAŞ İSTEK {Sn:0.0} sn · {Yontem} {Yol}{Sorgu} · {Durum}",
                sure.ElapsedMilliseconds / 1000.0, baglam.Request.Method, baglam.Request.Path,
                baglam.Request.QueryString, baglam.Response.StatusCode);
});

uygulama.UseCors("BicenPolitika");

/* Kara listedeki adresler daha ilk adımda durdurulur */
uygulama.UseMiddleware<KaraListeAraKatmani>();

/* --------------------------------------------------------- güvenlik başlıkları */
/*
 * Tarayıcıya, sayfanın nasıl yorumlanacağına dair sınırlar bildirilir.
 * Bu başlıklar saldırıyı doğrudan engellemez ama sömürülmesini zorlaştırır.
 */
uygulama.Use(async (baglam, sonraki) =>
{
    var basliklar = baglam.Response.Headers;

    /* Dosya türü tahmin edilmesin; yüklenen bir dosya betik gibi çalışmasın */
    basliklar["X-Content-Type-Options"] = "nosniff";

    /* Sayfa başka bir sitenin çerçevesine gömülmesin (tıklama hırsızlığı).

       Belge önizlemesi istisna: İK paneli PDF'i kendi penceresinde iframe
       ile gösteriyor. DENY bunu da engelliyordu ve önizleme gri, boş bir
       kutu olarak kalıyordu (29.09.2026). Bu uçlarda yalnızca kendi alan
       adlarımızın çerçevesine izin veriliyor; başka site yine gömemez. */
    var onizlemeUcu =
        baglam.Request.Path.StartsWithSegments("/api/PersonelBelge/Onizle")
        || baglam.Request.Path.StartsWithSegments("/api/Pusula/Goster")
        || baglam.Request.Path.StartsWithSegments("/api/Egitim/Goster")
        || baglam.Request.Path.StartsWithSegments("/api/YardimVideo/Izle");

    if (onizlemeUcu)
        basliklar["Content-Security-Policy"] =
            "frame-ancestors 'self' https://bicen.com.tr https://*.bicen.com.tr http://localhost:* http://127.0.0.1:*";
    else
        basliklar["X-Frame-Options"] = "DENY";

    /* Başka sitelere giderken tam adres sızmasın */
    basliklar["Referrer-Policy"] = "strict-origin-when-cross-origin";

    /* Kamera, mikrofon gibi izinler varsayılan olarak kapalı */
    basliklar["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()";

    /* Tarayıcı yalnızca güvenli bağlantı kullansın (bir yıl) */
    if (baglam.Request.IsHttps)
        basliklar["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

    await sonraki();
});

/* Beklenmeyen hatalarda tarayıcıya CORS başlıklarıyla birlikte anlaşılır bir
   JSON yanıt döner; aksi hâlde tarayıcı yalnızca "Failed to fetch" gösterir. */
uygulama.Use(async (baglam, sonraki) =>
{
    try
    {
        await sonraki();
    }
    catch (Microsoft.Data.SqlClient.SqlException hata)
    {
        uygulama.Logger.LogError(hata, "Veritabanı hatası");
        baglam.Response.StatusCode = 500;
        baglam.Response.ContentType = "application/json; charset=utf-8";
        await baglam.Response.WriteAsJsonAsync(new
        {
            hata = hata.Number == 4060
                ? "Veritabanına bağlanılamadı. Kurulum tamamlanmamış olabilir; " +
                  "API penceresindeki açıklamayı kontrol ediniz."
                : $"Veritabanı hatası: {hata.Message}"
        });
    }
    catch (Exception hata)
    {
        uygulama.Logger.LogError(hata, "Beklenmeyen hata");
        baglam.Response.StatusCode = 500;
        baglam.Response.ContentType = "application/json; charset=utf-8";
        await baglam.Response.WriteAsJsonAsync(new { hata = hata.Message });
    }
});

uygulama.UseAuthentication();
uygulama.UseAuthorization();

/* Hukuk danışmanı (24.10.2026): dış avukatın jetonu yalnız Hukuk masası
   uçlarına girer. Birçok uç yalnız [Authorize] ile korunduğu için bu süzgeç
   olmadan danışman personel verisine ulaşabilirdi. */
uygulama.Use(async (baglam, sonraki) =>
{
    if (baglam.User?.Identity?.IsAuthenticated == true
        && baglam.User.IsInRole(BicenKariyer.API.Controllers.HukukController.DanismanRolu)
        && !baglam.Request.Path.StartsWithSegments("/api/Hukuk", StringComparison.OrdinalIgnoreCase)
        && !baglam.Request.Path.StartsWithSegments("/api/Logo", StringComparison.OrdinalIgnoreCase)
        /* Yardım videosu (26.10.2026): yalnız Hukuk masası videosu */
        && !baglam.Request.Path.Equals("/api/YardimVideo/Mobil", StringComparison.OrdinalIgnoreCase)
        && !baglam.Request.Path.Equals("/api/YardimVideo/Izle/Hukuk", StringComparison.OrdinalIgnoreCase)
        /* İcra / maaş haczi (30.10.2026): danışman /api/Hukuk altında olsa da
           icra uçlarına giremez; personelin borç ve maaş bilgisi dışarı çıkmaz */
        || (baglam.User?.Identity?.IsAuthenticated == true
            && baglam.User.IsInRole(BicenKariyer.API.Controllers.HukukController.DanismanRolu)
            && baglam.Request.Path.StartsWithSegments("/api/Hukuk/Icra", StringComparison.OrdinalIgnoreCase)))
    {
        baglam.Response.StatusCode = 403;
        await baglam.Response.WriteAsJsonAsync(new { hata = "Bu alana erişiminiz yok." });
        return;
    }
    await sonraki();
});

/* Mobil oturum denetimi (26.10.2026): Personel rolündeki jetonlarda cihaz /
   oturum_acik kuralı ve işten ayrılma. Ayrılan personel 401 ve
   { kod: "ayrildi" } alır; uygulama jetonu silip giriş ekranına döner.
   Giriş uçları anonim olduğu için etkilenmez; panel ve hukuk danışmanı
   rolleri Personel değildir. */
uygulama.UseMobilOturumDenetimi();

/* Biçen360 sürüm takibi (08.10.2026): personel oturumunun uygulama sürümü */
uygulama.Use(async (baglam, sonraki) =>
{
    BicenKariyer.API.Servisler.UygulamaSurumu.Kaydet(baglam);
    /* Modül kullanımı (16.10.2026): hangi ekran ne sıklıkla açılıyor */
    BicenKariyer.API.Servisler.ModulKullanimi.Kaydet(baglam);
    await sonraki();
});

/* Ayar değişikliklerinin izi (03.10.2026): Yönetim sayfasındaki "son
   değişiklik" bilgisi. Kimlik doğrulamadan sonra; kullanıcı adı gerekli. */
BicenKariyer.API.Servisler.AyarDegisiklikKaydi.UseAyarDegisiklikKaydi(uygulama);

uygulama.MapControllers();

uygulama.MapGet("/", () => Results.Ok(new
{
    uygulama = "Biçen Kariyer API",
    surum = "1.0",
    veritabani = veritabaniHazir ? "hazır" : "HATA",
    veritabaniHatasi = veritabaniHazir ? null : veritabaniHatasi,
    zaman = DateTime.Now
}));

/* Kurum logosu tek bir yerden yayınlanır: wwwroot/logo.png
   Aday sayfası ve İK paneli bu adresi kullanır. */
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

/* Biçen360 patron görünümünün sunucu tanımlı sayfaları (ek sözleşme 2-3):
   uygulama /patron-sayfa/{kod} adresini WebView'da açıyor, jetonu sayfaya
   kendisi veriyor (window.BICEN). Sayfa yalnızca HTML; veri sayfanın
   jetonla çağırdığı api/PatronMobil uçlarından ve yetki orada. Böylece
   yeni bir sayfa ya da düzeltme için mobil güncelleme gerekmiyor —
   önbelleğe alınmaması bu yüzden şart. Kod yalnızca küçük harf, rakam ve
   tire: adres satırından dosya yolu kurulurken klasör dışına çıkılmasın. */
uygulama.MapGet("/patron-sayfa/{kod}", (string kod, IWebHostEnvironment ortam, HttpContext baglam) =>
{
    baglam.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
    baglam.Response.Headers.Pragma = "no-cache";
    baglam.Response.Headers.Expires = "0";

    if (!System.Text.RegularExpressions.Regex.IsMatch(kod ?? "", "^[a-z0-9-]{1,40}$"))
        return Results.NotFound();

    var klasor = string.IsNullOrWhiteSpace(ortam.WebRootPath)
        ? Path.Combine(AppContext.BaseDirectory, "wwwroot")
        : ortam.WebRootPath;

    var yol = Path.Combine(klasor, "patron-sayfa", kod + ".html");

    return File.Exists(yol)
        ? Results.File(yol, "text/html; charset=utf-8")
        : Results.Content(
            "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\">"
            + "<p style=\"font-family:system-ui;padding:24px;color:#4b5563\">Bu sayfa bulunamadı. Uygulamayı güncelleyip yeniden deneyiniz.</p>",
            "text/html; charset=utf-8", System.Text.Encoding.UTF8, 404);
});

uygulama.MapGet("/api/Saglik", () => veritabaniHazir
    ? Results.Ok(new { durum = "çalışıyor", veritabani = "hazır" })
    : Results.Json(new { durum = "hata", hata = veritabaniHatasi }, statusCode: 503));

uygulama.Run();

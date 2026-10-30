using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Çıkışına bir gün kalan personel için İK'ya uyarı düşürür.
///
/// <para>
/// İhbar süresi başlayan personelin çıkış tarihi Mikro'ya haftalar önce
/// yazılıyor ve sonra unutuluyordu: çıkış işlemleri, zimmet teslimi ve
/// yerine alım son güne kalıyordu. Çıkıştan bir gün önce panel çanına
/// bildirim düşüyor.
/// </para>
///
/// <para>
/// Bildirim İK uzmanlarına, İK yöneticilerine ve yöneticiye gidiyor.
/// Uzmanların şube kısıtı varsa yalnızca kendi şubelerindeki personel için
/// gönderiliyor — otuz dört şubenin tamamının çıkışını her uzmanın çanında
/// görmesi, bildirimlerin okunmadan kapatılmasına yol açardı.
/// </para>
///
/// <para>
/// Gönderilen her uyarı <c>KRY_AYRILIK_UYARI</c> tablosuna yazılıyor.
/// Görev günde birkaç kez çalıştığı için bu kayıt olmadan aynı uyarı
/// tekrar tekrar düşüyordu.
/// </para>
/// </summary>
public class AyrilikUyariGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<AyrilikUyariGorevi> _kayit;

    /// <summary>Çıkışa kaç gün kala uyarılacak.</summary>
    private const int UyariGunu = 1;

    public AyrilikUyariGorevi(
        IServiceProvider saglayici, ILogger<AyrilikUyariGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta veritabanı kurulumu ve Mikro önbelleği sürüyor olabilir */
        await Task.Delay(TimeSpan.FromMinutes(3), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Ayrılık uyarıları işlenemedi");
            }

            /* Saatte bir: gün içinde girilen bir çıkış tarihi de yakalansın */
            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private void Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var saglayici = kapsam.ServiceProvider;

        var ayrilacaklar = saglayici
            .GetRequiredService<AyrilacakPersonelServisi>()
            .Listele()
            .Where(x => x.KalanGun == UyariGunu)
            .ToList();

        if (ayrilacaklar.Count == 0) return;

        var vt = saglayici.GetRequiredService<VeritabaniServisi>();
        /* Şube listesi form ayarlarında, iş grubu eşleştirmeleri personel
           ayarlarında duruyor; şube kodunu birim adına bağlamak için
           ikisi de gerekiyor. */
        var ayarServisi = saglayici.GetRequiredService<AyarServisi>();

        var subeler = ayarServisi.FormOku().Subeler ?? new List<Sube>();
        var personelAyari = ayarServisi.PersonelOku();

        using var db = vt.Baglanti();

        /* İK uzmanı, İK yöneticisi ve yönetici. Bölge müdürü ve koordinatör
           dışarıda: özlük işlemlerini onlar yürütmüyor. */
        var kullanicilar = db.Query(@"
SELECT kullanici_adi AS kullaniciAdi, rol, subeler
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN (N'Admin', N'IK', N'IKYoneticisi')").ToList();

        if (kullanicilar.Count == 0) return;

        /* Birikmiş yinelenenleri temizle.

           Kusur giderilene kadar aynı uyarı saat başı yeniden
           gönderilmiş ve bildirim listesi kullanılamaz hâle gelmişti.
           Her kullanıcı ve başlık için en eski kayıt bırakılıyor:
           okundu bilgisi ilk kayıtta duruyor ve tarihi doğru olan o. */
        try
        {
            var silinen = db.Execute(@"
WITH yinelenen AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY kullanici, baslik ORDER BY id) AS sira
    FROM KRY_BILDIRIM
    WHERE tur = 'ayrilik_uyarisi'
)
DELETE FROM yinelenen WHERE sira > 1");

            if (silinen > 0)
                _kayit.LogInformation(
                    "Yinelenen ayrılık bildirimi temizlendi: {Adet}", silinen);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yinelenen bildirimler temizlenemedi");
        }

        var gonderilen = 0;

        foreach (var kisi in ayrilacaklar)
        {
            foreach (var kullanici in kullanicilar)
            {
                var kullaniciAdi = (string)kullanici.kullaniciAdi;

                if (!Ilgilendirir(personelAyari, subeler, (string)kullanici.rol,
                                  (string)kullanici.subeler, kisi.Birim))
                    continue;

                try
                {
                    /* Önce var mı diye ayrı bir sorguyla bakılıyor.

                       Daha önce "IF NOT EXISTS ... INSERT" tek deyimle
                       yazılıyor ve etkilenen satır sayısına bakılıyordu;
                       ama içteki SELECT de sayıya karışıyor ve kayıt
                       eklenmese bile sıfırdan büyük dönüyordu. Sonuç:
                       aynı uyarı görev her çalıştığında yeniden
                       gönderiliyordu. */
                    var girdi = new
                    {
                        kod = kisi.PersonelKodu,
                        cikis = kisi.CikisTarihi.Date,
                        kullanici = kullaniciAdi
                    };

                    var zatenVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_AYRILIK_UYARI
WHERE personel_kodu = @kod AND cikis_tarihi = @cikis
  AND kullanici = @kullanici", girdi) > 0;

                    if (zatenVar) continue;

                    /* Tekil dizin ikinci güvence: iki görev aynı anda
                       çalışırsa ikisi de "yok" görüp eklemeye
                       kalkabilir. */
                    db.Execute(@"
INSERT INTO KRY_AYRILIK_UYARI (personel_kodu, cikis_tarihi, kullanici)
VALUES (@kod, @cikis, @kullanici)", girdi);

                    db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, 'ayrilik_uyarisi', @baslik, @metin)",
                        new
                        {
                            kullanici = kullaniciAdi,
                            baslik = $"Yarın işten ayrılıyor: {kisi.AdSoyad}",
                            metin =
                                $"{kisi.AdSoyad} ({kisi.PersonelKodu}) · {kisi.Birim} · "
                                + $"{kisi.Pozisyon}\n"
                                + $"Çıkış tarihi {kisi.CikisTarihi:dd.MM.yyyy}. "
                                + "Çıkış işlemleri, zimmet teslimi ve çıkış mülakatı "
                                + "planlanmalı."
                        });

                    gonderilen++;
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata,
                        "Ayrılık uyarısı gönderilemedi: {Kod}", kisi.PersonelKodu);
                }
            }
        }

        if (gonderilen > 0)
            _kayit.LogInformation(
                "Ayrılık uyarısı: {Adet} bildirim gönderildi", gonderilen);
    }

    /// <summary>
    /// Bu kullanıcı bu personelin çıkışıyla ilgileniyor mu.
    ///
    /// <para>
    /// Yönetici ve İK yöneticisi her şubeyi görür. İK uzmanına şube listesi
    /// tanımlanmışsa yalnızca kendi şubeleri; tanımlı değilse tamamı —
    /// kısıtsız uzman şu an da bütün şubelerde çalışıyor.
    /// </para>
    ///
    /// <para>
    /// Kullanıcıdaki liste şube <em>kodlarını</em> tutuyor, personeldeki
    /// birim ise Mikro'daki iş grubu <em>adı</em>. İkisi doğrudan
    /// karşılaştırılamaz; ayarlardaki şube tanımı üzerinden, sistemin geri
    /// kalanının kullandığı eşleştirmeyle bağlanıyor.
    /// </para>
    /// </summary>
    private static bool Ilgilendirir(
        PersonelAyarlari ayar, List<Sube> tumSubeler, string rol,
        string subeler, string birim)
    {
        if (rol is Roller.Admin or Roller.IKYoneticisi) return true;

        if (string.IsNullOrWhiteSpace(subeler)) return true;
        if (string.IsNullOrWhiteSpace(birim)) return true;

        var kodlar = subeler
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        return tumSubeler
            .Where(x => kodlar.Contains(x.Kod ?? ""))
            .Any(x => PersonelKaynagiServisi.SubeUyuyor(ayar, birim, x.Ad, x.Kod));
    }
}

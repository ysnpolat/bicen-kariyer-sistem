using BicenKariyer.API.Controllers;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mesai saati geçtiği hâlde vardiya okutmayan personele hatırlatma.
///
/// <para>
/// Personel karekodu okutmayı unuttuğunda bu ancak gün sonunda, okutma
/// raporunda fark ediliyordu; o noktada düzeltmenin yolu İK'ya başvurup
/// elle kayıt açtırmaktan geçiyordu. Mesai başlangıcından bir süre sonra
/// gönderilen tek bir bildirim, sorunun çoğunu personelin kendisine
/// çözdürüyor.
/// </para>
///
/// <para>
/// Hatırlatma mesai saatinde değil, gruba tanımlı gecikme kadar sonra
/// gönderiliyor: tam saatinde gönderilen bildirim, yolda olan ve birazdan
/// okutacak personeli boşuna rahatsız ediyordu.
/// </para>
/// </summary>
public class VardiyaHatirlatmaGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<VardiyaHatirlatmaGorevi> _kayit;

    /// <summary>
    /// Görev on dakikada bir çalışıyor; bir grubun hatırlatma anı bu
    /// pencerenin içine düşerse gönderiliyor.
    /// </summary>
    private static readonly TimeSpan Aralik = TimeSpan.FromMinutes(10);

    public VardiyaHatirlatmaGorevi(
        IServiceProvider saglayici, ILogger<VardiyaHatirlatmaGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(5), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Vardiya hatırlatması işlenemedi");
            }

            await Task.Delay(Aralik, jeton);
        }
    }

    /// <summary>
    /// Vardiya türüne göre hatırlatma (07.10.2026).
    ///
    /// <para>
    /// Eskiden herkese 08:40 ve 13:10'da iki bildirim gidiyordu; sabahçı
    /// öğleden sonra, akşamcı sabah gereksiz bildirim alıyordu. Şimdi
    /// kişinin o günkü vardiya planına bakılıyor: sabahçıya sabah saatinde,
    /// akşamcıya akşam saatinde (14:00), aracıya aracı saatinde (15:00).
    /// Planı olmayan ve genel merkez personeli yalnızca sabah; genel
    /// merkeze öğleden sonra bildirim gitmez. İzinli, raporlu, haftalık
    /// izinli ve okutmadan muaf personele hiç gitmez. Saatler Ayarlar
    /// Merkezi › Süreler ve sınırlar'dan.
    /// </para>
    /// </summary>
    private static readonly (string Sinif, string Parametre, string Varsayilan)[] Oturumlar =
    {
        ("sabah", "vardiya.sabahSaati", "08:40"),
        ("aksam", "vardiya.aksamSaati", "14:00"),
        ("araci", "vardiya.araciSaati", "15:00"),
    };

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();
        var saglayici = kapsam.ServiceProvider;

        var vt = saglayici.GetRequiredService<VeritabaniServisi>();

        var simdi = DateTime.Now;
        var bugun = simdi.Date;

        /* Bu çalıştırmanın penceresine düşen oturum(lar) */
        var tumOturumlar = Oturumlar
            .Select(o => (o.Sinif, Saat: Parametre.Metin(o.Parametre) is { Length: > 0 } x ? x : o.Varsayilan))
            .ToList();

        var oturumlar = tumOturumlar.Where(o => Zamani(o.Saat, 0, simdi)).ToList();

        /* Yöneticiye bildirim (23.10.2026): personele hatırlatma gittikten
           bu kadar dakika sonra hâlâ okutmayanlar birim yöneticisine */
        var yoneticiDk = Parametre.Sayi("devamsizlik.yoneticiDakika");
        var yoneticiOturumlari = yoneticiDk > 0
            ? tumOturumlar.Where(o => Zamani(o.Saat, yoneticiDk, simdi)).ToList()
            : new();

        if (oturumlar.Count == 0 && yoneticiOturumlari.Count == 0) return;

        using var db = vt.Baglanti();

        /* Resmi tatilde hatırlatma gönderilmiyor */
        if (db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih = @bugun",
                new { bugun }) > 0)
            return;

        var kaynak = saglayici.GetRequiredService<PersonelKaynagiServisi>();
        var bildirim = saglayici.GetRequiredService<BildirimServisi>();
        var form = saglayici.GetService<IzinFormuServisi>();
        var formAyari = form?.FormAyari();

        List<PersonelKaydi> personeller;

        try
        {
            personeller = kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Vardiya hatırlatması için personel okunamadı");
            return;
        }

        /* Toplu sorgular: kişi başı ayrı sorgu bin kişide saniyeler sürüyordu.
           Siciller sıfırsız yazımla karşılaştırılıyor (07.10.2026): "0123" ile
           "123" tutmadığı için izinli personele de bildirim gidiyordu. */
        static string K(string x) => OkutmaBeklenmez.K(x);

        var okutanlar = db.Query<string>(@"
SELECT DISTINCT personel_kodu FROM KRY_VARDIYA
WHERE gecis_zamani >= @bugun AND gecis_zamani < @yarin",
                new { bugun, yarin = bugun.AddDays(1) })
            .Select(K)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /* İzinli (kayıt ya da onay sürecindeki talep), raporlu, planda
           haftalık izinli ya da boş: bugün okutma beklenmiyor */
        var beklenmez = OkutmaBeklenmez.Bugun(db, vt, bugun);

        var izinGunleri = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in db.Query(@"
SELECT personel_kodu AS kod, gun FROM KRY_HAFTALIK_IZIN
WHERE gun IS NOT NULL AND durum = N'onaylandi'"))
            izinGunleri[K((string)x.kod)] = (int)x.gun;

        /* Bugünkü vardiyanın sınıfı (sabah · aksam · araci · diger) */
        var siniflar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var x in db.Query(@"
SELECT p.personel_kodu AS kod, s.tip, s.ad
FROM KRY_VARDIYA_PLAN p
LEFT JOIN KRY_VARDIYA_SABLON s ON s.id = p.sablon_id
WHERE p.gun = @bugun AND p.tur = N'vardiya'", new { bugun }))
            siniflar[K((string)x.kod)] = VardiyaPlanController.TipBul((string)x.tip, (string)x.ad);

        var gonderilen = 0;

        foreach (var (sinif, oturum) in oturumlar)
        {
            var oncekiler = db.Query<string>(@"
SELECT personel_kodu FROM KRY_VARDIYA_HATIRLATMA WHERE gun = @bugun AND saat = @oturum",
                    new { bugun, oturum })
                .Select(K)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var p in personeller)
            {
                var kod = (p.PersonelKodu ?? "").Trim();
                var k = K(kod);

                if (kod.Length == 0 || okutanlar.Contains(k) || beklenmez.Contains(k) || oncekiler.Contains(k))
                    continue;

                var planli = siniflar.TryGetValue(k, out var plan);

                /* Sabit haftalık izin günü (planı yoksa) */
                if (!planli && izinGunleri.TryGetValue(k, out var g) && (DayOfWeek)g == bugun.DayOfWeek)
                    continue;

                /* Kişinin bugünkü oturumu: genel merkez ve planı olmayan sabah */
                var merkez = false;
                try { merkez = form?.GenelMerkezMi(p, formAyari) ?? false; } catch { }

                var kisiSinifi = merkez || !planli || plan is not ("aksam" or "araci") ? "sabah" : plan;

                if (kisiSinifi != sinif) continue;

                /* Okutmadan muaf personelden okutma beklenmiyor (Okutma Kuralları) */
                if (OkutmaKurallari.MuafMi(vt, kod, bugun))
                    continue;

                try
                {
                    db.Execute(@"
INSERT INTO KRY_VARDIYA_HATIRLATMA (personel_kodu, gun, saat) VALUES (@kod, @bugun, @oturum)",
                        new { kod, bugun, oturum });
                }
                catch
                {
                    /* Aynı anda iki sunucu örneği çalıştıysa tekillik dizini
                       ikinci kaydı reddediyor; bildirim tek gitsin. */
                    continue;
                }

                var yer = merkez ? "karekodu" : "mağazadaki karekodu";

                try
                {
                    await bildirim.Gonder(
                        kod,
                        "Vardiya girişi yapılmadı",
                        sinif switch
                        {
                            "aksam" => $"Akşam vardiyanız başladı, henüz vardiya girişi yapmadınız. {char.ToUpper(yer[0]) + yer[1..]} okutmayı unutmayın.",
                            "araci" => $"Ara vardiyanız başladı, henüz vardiya girişi yapmadınız. {char.ToUpper(yer[0]) + yer[1..]} okutmayı unutmayın.",
                            _ => $"Günaydın! Bugün henüz vardiya girişi yapmadınız. {char.ToUpper(yer[0]) + yer[1..]} okutmayı unutmayın.",
                        },
                        "vardiya");

                    gonderilen++;
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Vardiya hatırlatması gönderilemedi: {Kod}", kod);
                }
            }
        }

        if (gonderilen > 0)
            _kayit.LogInformation("Vardiya hatırlatması ({Oturum}): {Adet} bildirim",
                string.Join(",", oturumlar.Select(x => x.Saat)), gonderilen);

        foreach (var (_, oturum) in yoneticiOturumlari)
        {
            try
            {
                await YoneticilereBildir(db, saglayici, bildirim, personeller, beklenmez, bugun, oturum);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Yöneticiye okutmayan personel bildirimi gönderilemedi");
            }
        }
    }

    /// <summary>
    /// Hatırlatma aldığı hâlde hâlâ okutmayan personel birim yöneticisine
    /// bildiriliyor (23.10.2026): "X vardiya girişini yapmadı, devamsızlıksa
    /// işleyin". Bildirime dokununca Biçen360'ta o kişinin devamsızlık
    /// ekranı açılıyor (1.9). Yöneticinin üçten fazla kişisi varsa tek
    /// özet bildirim; liste ekranı açılıyor.
    /// </summary>
    private async Task YoneticilereBildir(System.Data.IDbConnection db, IServiceProvider saglayici, BildirimServisi bildirim,
        List<PersonelKaydi> personeller, HashSet<string> beklenmez, DateTime bugun, string oturum)
    {
        static string K(string x) => OkutmaBeklenmez.K(x);

        var isaret = "Y" + oturum.Replace(":", "");
        if (isaret.Length > 5) isaret = isaret[..5];

        var hatirlatilan = db.Query<string>(@"
SELECT personel_kodu FROM KRY_VARDIYA_HATIRLATMA WHERE gun = @bugun AND saat = @oturum",
                new { bugun, oturum })
            .Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (hatirlatilan.Count == 0) return;

        var oncekiler = db.Query<string>(@"
SELECT personel_kodu FROM KRY_VARDIYA_HATIRLATMA WHERE gun = @bugun AND saat = @isaret",
                new { bugun, isaret })
            .Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var okutanlar = db.Query<string>(@"
SELECT DISTINCT personel_kodu FROM KRY_VARDIYA
WHERE gecis_zamani >= @bugun AND gecis_zamani < @yarin",
                new { bugun, yarin = bugun.AddDays(1) })
            .Select(K).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var org = saglayici.GetRequiredService<OrgOnayServisi>();
        var yoneticiye = new Dictionary<string, List<PersonelKaydi>>(StringComparer.OrdinalIgnoreCase);

        foreach (var p in personeller)
        {
            var k = K(p.PersonelKodu);
            if (!hatirlatilan.Contains(k) || oncekiler.Contains(k) || okutanlar.Contains(k) || beklenmez.Contains(k))
                continue;

            List<PersonelKaydi> birim;
            try
            {
                birim = org.Onaylayicilar(p.PersonelKodu, p.Pozisyon, string.IsNullOrWhiteSpace(p.IsGrubu) ? p.Sube : p.IsGrubu).Birim ?? new();
            }
            catch
            {
                birim = new();
            }

            try
            {
                db.Execute("INSERT INTO KRY_VARDIYA_HATIRLATMA (personel_kodu, gun, saat) VALUES (@kod, @bugun, @isaret)",
                    new { kod = (p.PersonelKodu ?? "").Trim(), bugun, isaret });
            }
            catch
            {
                continue;
            }

            foreach (var y in birim.Where(y => K(y.PersonelKodu) != k))
            {
                var yk = (y.PersonelKodu ?? "").Trim();
                if (!yoneticiye.TryGetValue(yk, out var l)) yoneticiye[yk] = l = new();
                l.Add(p);
            }
        }

        var adet = 0;
        var portal = saglayici.GetRequiredService<PortalYetkiServisi>();

        foreach (var (yonetici, kisiler) in yoneticiye)
        {
            string Ad(PersonelKaydi x) => $"{x.Ad} {x.Soyad}".Trim();

            /* Devamsızlık Girişi modülü yöneticide açık değilse bildirim yok
               (portal yetkisi; yeni modül, tanımsızken kapalı) */
            var yKayit = personeller.FirstOrDefault(x => K(x.PersonelKodu) == K(yonetici));
            try { yKayit ??= saglayici.GetRequiredService<EkipServisi>().Kisi(yonetici); } catch { }
            try
            {
                if (!portal.AcikMi(yonetici, (yKayit?.Pozisyon ?? "").Trim(), "devamsizlik")) continue;
            }
            catch
            {
                continue;
            }

            if (kisiler.Count <= 3)
            {
                foreach (var x in kisiler)
                {
                    await bildirim.Gonder(yonetici, "Vardiya girişi yapılmadı",
                        $"{Ad(x)} bugün vardiya girişini yapmadı. Devamsızlık ise devamsızlığını işleyin.",
                        $"devamsizlik|{(x.PersonelKodu ?? "").Trim()}");
                    adet++;
                }
            }
            else
            {
                await bildirim.Gonder(yonetici, $"{kisiler.Count} personel vardiya girişi yapmadı",
                    string.Join(", ", kisiler.Take(4).Select(Ad)) + (kisiler.Count > 4 ? $" ve {kisiler.Count - 4} kişi daha" : "")
                    + " bugün vardiya girişini yapmadı. Devamsızlık ise devamsızlığını işleyin.",
                    "devamsizlik");
                adet++;
            }
        }

        if (adet > 0)
            _kayit.LogInformation("Okutmayan personel yöneticilere bildirildi ({Oturum}): {Adet} bildirim", oturum, adet);
    }

    /// <summary>
    /// Hatırlatma anı şu anki çalıştırma penceresine düşüyor mu.
    ///
    /// Pencere kadar geniş tutuluyor; görev tam o dakikada çalışmadığı için
    /// eşitlik aramak hatırlatmanın hiç gönderilmemesine yol açardı.
    /// </summary>
    private static bool Zamani(string mesai, int gecikme, DateTime simdi)
    {
        var parca = (mesai ?? "").Split(':');

        if (parca.Length != 2 ||
            !int.TryParse(parca[0], out var saat) ||
            !int.TryParse(parca[1], out var dakika))
            return false;

        var hedef = simdi.Date.AddHours(saat).AddMinutes(dakika + gecikme);

        return simdi >= hedef && simdi < hedef.Add(Aralik);
    }
}

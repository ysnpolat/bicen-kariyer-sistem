using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe uyum (oryantasyon) anketi gönderimi: kaydı açar, Biçen360'a bildirim
/// gönderir.
///
/// <para>
/// Panelden elle gönderim (<c>UyumController</c>) ve günlük otomatik
/// gönderim (<c>UyumOtomatikGorevi</c>) aynı kodu kullanır; bildirim metni,
/// geçerlilik süresi ve kayıt biçimi tek yerde durur.
/// </para>
///
/// <para>
/// Oryantasyon anketleri yalnızca Biçen360'tan doldurulur; SMS gitmez.
/// Personelin anketi her zaman açılır (kanal = uygulama) ve Biçen360 ana
/// sayfasında görünür (<c>GorevController.Bekleyenler</c>). Biçen360'a hiç
/// giriş yapmamış kişiye bildirim gidemez; anket giriş yapınca görünür ve
/// panele "Biçen360'a giriş yapmamış" olarak bildirilir. Yönetici
/// değerlendirmesi de uygulamadan yapılır (ana sayfa kartları + Ekibim).
/// SMS yalnızca panelin test penceresinde elle seçilirse kullanılır.
/// </para>
/// </summary>
public class UyumGonderimServisi
{
    private readonly AyarServisi _ayar;
    private readonly IServiceScopeFactory _kapsam;
    private readonly YoneticiBulucu _yonetici;
    private readonly ILogger<UyumGonderimServisi> _kayit;

    public UyumGonderimServisi(AyarServisi ayar, IServiceScopeFactory kapsam,
                               YoneticiBulucu yonetici, ILogger<UyumGonderimServisi> kayit)
    {
        _ayar = ayar;
        _kapsam = kapsam;
        _yonetici = yonetici;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>
    /// Bildirimin sonuna eklenen not: görev ekranlarını taşıyan sürümü
    /// (1.4) henüz açmamış kişi anketi göremeyebilir.
    /// </summary>
    public const string GuncellemeNotu =
        " Görmüyorsanız Biçen360'ı App Store / Google Play'den güncelleyin.";

    /// <summary>
    /// Personel Biçen360 kullanıyor mu: KRY_MOBIL_JETON'da boş olmayan bir
    /// bildirim jetonu var. Herkes Biçen360'a geçtiği için başka şart
    /// aranmıyor (eski iCard kapandı). Tablo okunamazsa false.
    /// </summary>
    public static bool UygulamadaMi(System.Data.IDbConnection db, string personelKodu)
    {
        if (string.IsNullOrWhiteSpace(personelKodu)) return false;

        try
        {
            return db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_JETON
WHERE personel_kodu = @kod AND jeton IS NOT NULL AND jeton <> ''",
                new { kod = personelKodu.Trim() }) > 0;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Görev ekranlarını taşıyan sürümü (1.4) açmış mı: bu sürüm her
    /// açılışta gorev_gorulme'yi işaretliyor. Kolon yoksa ya da hiç
    /// işaretlenmemişse false; bildirime güncelleme notu eklenir.
    /// </summary>
    public static bool YeniSurumuAcmis(System.Data.IDbConnection db, string personelKodu)
    {
        if (string.IsNullOrWhiteSpace(personelKodu)) return false;

        try
        {
            return db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_JETON
WHERE personel_kodu = @kod AND gorev_gorulme IS NOT NULL",
                new { kod = personelKodu.Trim() }) > 0;
        }
        catch
        {
            /* Kolon henüz yok */
            return false;
        }
    }

    /// <summary>
    /// Yönetici telefonundan personel kaydı (sicil): o numaraya sahip aktif
    /// personel. Birden çok kişi aynı numarayı taşıyorsa Biçen360'a giriş
    /// yapmış olan öne alınır. Değerlendirilen kişinin kendisi sayılmaz.
    /// </summary>
    private static PersonelKaydi TelefondanUygulamaKullanicisi(
        System.Data.IDbConnection db, List<PersonelKaydi> personeller, string telefon, string haric = null)
    {
        var tel = YoneticiBulucu.TelefonSadelestir(telefon);

        if (tel is null || personeller is null) return null;

        var adaylar = personeller
            .Where(x => x.Durum == 1
                        && !string.IsNullOrWhiteSpace(x.PersonelKodu)
                        && (haric is null || K(x.PersonelKodu) != K(haric))
                        && YoneticiBulucu.TelefonSadelestir(x.Telefon) == tel)
            .ToList();

        return adaylar.FirstOrDefault(x => UygulamadaMi(db, x.PersonelKodu))
               ?? adaylar.FirstOrDefault();
    }

    private async Task Bildir(string personelKodu, string baslik, string metin, string ekran = "anasayfa")
    {
        try
        {
            using var k = _kapsam.CreateScope();

            await k.ServiceProvider.GetRequiredService<BildirimServisi>()
                .Gonder(personelKodu, baslik, metin, ekran);
        }
        catch (Exception hata)
        {
            /* Bildirim gitmese de anket açık; kişi uygulamayı açınca görür */
            _kayit.LogWarning(hata, "Oryantasyon bildirimi gönderilemedi: {Kod}", personelKodu);
        }
    }

    /// <summary>
    /// Personele "anketiniz bekliyor" bildirimi (İK hatırlatması). Jeton
    /// yoksa gitmez; yeni sürümü açmamışsa güncelleme notu eklenir.
    /// </summary>
    public async Task<UyumGonderimSonucu> PersoneleHatirlat(
        System.Data.IDbConnection db, string personelKodu, string baslik, string metin)
    {
        if (!UygulamadaMi(db, personelKodu))
            return new UyumGonderimSonucu { Basarili = true, GirisYok = true };

        var not = !YeniSurumuAcmis(db, personelKodu);

        await Bildir(personelKodu, baslik, metin + (not ? GuncellemeNotu : ""));

        return new UyumGonderimSonucu { Basarili = true, GuncellemeNotu = not };
    }

    /// <summary>
    /// Aşama pencereleri: işe girişten sonra geçen gün (Personel
    /// Listesi'ndeki "çalışma süresi" ile aynı sayım, giriş günü 0).
    /// 7. gün ve 2. ay anketi tam o gün gider: çalışma süresi 7 gün olana
    /// 7. gün, 55 gün olana 2. ay. 6. ay ve 1. yıl için pencere vardır.
    /// PersonelController.TakipDonemleri ile aynı olmalı.
    /// </summary>
    public static readonly Dictionary<string, (int enAz, int enFazla)> VarsayilanAralik = new()
    {
        ["7g"] = (7, 7),
        ["2a"] = (55, 55),
        ["6a"] = (170, 180),
        ["1y"] = (355, 365)
    };

    /// <summary>Aşama sırası; ekranlar ve raporlar bu sırayla gösterir</summary>
    public static readonly string[] AsamaSirasi = { "7g", "2a", "6a", "1y" };

    /// <summary>
    /// Ayarlardaki pencereler; tanımsız ya da bozuk aşamada varsayılan.
    /// Yönetim → Form Ayarları'ndan düzenlenir.
    /// </summary>
    public static Dictionary<string, (int enAz, int enFazla)> Pencereler(FormAyarlari ayar)
    {
        var sonuc = new Dictionary<string, (int enAz, int enFazla)>();

        foreach (var kod in AsamaSirasi)
        {
            var v = VarsayilanAralik[kod];

            if (ayar?.UyumPencereleri is not null
                && ayar.UyumPencereleri.TryGetValue(kod, out var p)
                && p is not null && p.EnAz >= 0 && p.EnFazla >= p.EnAz && p.EnFazla <= 2000)
                v = (p.EnAz, p.EnFazla);

            sonuc[kod] = v;
        }

        return sonuc;
    }

    /// <summary>Ayarlardaki güncel pencereler.</summary>
    public Dictionary<string, (int enAz, int enFazla)> Pencereler()
    {
        return Pencereler(_ayar.FormOku());
    }

    /// <summary>Bağlantının geçerlilik süresi: 3 gün</summary>
    public static int GecerlilikSaati => Parametre.Sayi("uyum.gecerlilikSaati");

    public static readonly Dictionary<string, string> AsamaAdi = new()
    {
        ["7g"] = "7. gün",
        ["2a"] = "2. ay",
        ["6a"] = "6. ay",
        ["1y"] = "1. yıl"
    };

    /// <summary>
    /// SMS metni: yalnızca panelin test penceresinde SMS elle seçilince
    /// kullanılıyor. Oryantasyon gönderimlerinde SMS gitmiyor.
    /// </summary>
    public string SmsMetni(string tur, string asama, string adSoyad,
                            string sube, string kod)
    {
        var adres = BaglantiAdresi(kod);
        var ayar = _ayar.FormOku();

        /* Önce aşamaya özel metin, yoksa genel metin, o da yoksa
           koddaki varsayılan. Böylece isteyen tek metinle idare eder,
           isteyen her dönem için ayrı yazar. */
        var kalip = (ayar.UyumMesajlari?.GetValueOrDefault($"{tur}{asama}") ?? "").Trim();

        if (kalip.Length == 0)
            kalip = tur == "calisan"
                ? (ayar.UyumCalisanMesaji ?? "").Trim()
                : (ayar.UyumYoneticiMesaji ?? "").Trim();

        if (kalip.Length == 0)
            kalip = tur == "calisan"
                ? "Merhaba {ad}, Biçen'deki {asama} geribildirim formunuz hazır. "
                  + "Görüşleriniz bizim için değerli: {link}"
                : "Merhaba, {sube} mağazasındaki personelin {asama} "
                  + "değerlendirmesi bekliyor. Tek ekrandan tamamlayabilirsiniz: {link}";

        var metin = kalip
            .Replace("{ad}", (adSoyad ?? "").Trim().Split(' ').FirstOrDefault() ?? "")
            .Replace("{asama}", AsamaAdi[asama])
            .Replace("{sube}", sube ?? "")
            .Replace("{link}", adres);

        /* Eski şablonlarda '48 saat' yazıyor; süre değişince şablonu elle
           düzeltmeyi beklemeden doğru sayı gitsin */
        metin = metin.Replace("48 saat", $"{GecerlilikSaati} saat");

        /* Süre bilgisi şablonda yoksa sona eklenir */
        if (!metin.Contains(" saat"))
            metin += $" (bağlantı {GecerlilikSaati} saat geçerlidir)";

        return metin;
    }

    /// <summary>
    /// Personelin anketini açar ve Biçen360'a bildirim gönderir.
    ///
    /// <para>
    /// Kayıt her zaman açılır (kanal = uygulama, <see cref="GecerlilikSaati"/>
    /// saat geçerli); telefon ve SMS servisi aranmaz. Anket Biçen360 ana
    /// sayfasında görünür. Jetonu olmayan (Biçen360'a giriş yapmamış)
    /// kişiye bildirim gidemez; sonuçta <c>GirisYok</c> işaretlenir, anket
    /// giriş yapınca görünür. Görev ekranlarını taşıyan sürümü henüz
    /// açmamış kişiye giden bildirime güncelleme notu eklenir.
    /// </para>
    /// </summary>
    public async Task<UyumGonderimSonucu> CalisanaGonder(
        System.Data.IDbConnection db, string asama,
        string personelKodu, string adSoyad, string subeAdi, string gorev,
        string telefon, DateTime? girisTarihi, string gonderen)
    {
        personelKodu = (personelKodu ?? "").Trim();

        if (personelKodu.Length == 0)
            return new UyumGonderimSonucu { Hata = "Personel kodu yok." };

        /* 13.10.2026: aynı aşamada doldurulmamış, süresi geçmemiş bir anket
           varsa yenisi açılmıyor; süresi uzatılıp yeniden bildiriliyor. Aynı
           kişiye iki satır açılınca biri doldurulduğunda diğeri açık kalıyor
           ve uygulamada anket yeniden çıkıyordu. */
        var acikKod = db.ExecuteScalar<string>(@"
SELECT TOP 1 kod FROM KRY_UYUM_ANKET
WHERE tur = 'calisan' AND test_mi = 0 AND asama = @asama AND personel_kodu = @personelKodu
  AND dolduruldu IS NULL AND gecerlilik > SYSDATETIME()
ORDER BY olusturma DESC", new { asama, personelKodu });

        if (acikKod is not null)
        {
            db.Execute(@"
UPDATE KRY_UYUM_ANKET SET gecerlilik = @gecerlilik
WHERE kod = @acikKod AND gecerlilik < @gecerlilik",
                new { acikKod, gecerlilik = DateTime.Now.AddHours(GecerlilikSaati) });

            if (!UygulamadaMi(db, personelKodu))
                return new UyumGonderimSonucu { Basarili = true, GirisYok = true };

            await Bildir(personelKodu, "Oryantasyon anketiniz bekliyor",
                $"{AsamaAdi[asama]} değerlendirmeniz · yaklaşık 3 dakika. {GecerlilikSaati} saat içinde doldurunuz.");

            return new UyumGonderimSonucu { Basarili = true };
        }

        var kod = BenzersizKod(db);

        db.Execute(@"
INSERT INTO KRY_UYUM_ANKET
    (kod, tur, asama, personel_kodu, ad_soyad, sube_adi, gorev, telefon,
     giris_tarihi, gecerlilik, test_mi, gonderen, kanal)
VALUES (@kod, 'calisan', @asama, @personelKodu, @adSoyad, @subeAdi, @gorev, @telefon,
        @girisTarihi, @gecerlilik, 0, @gonderen, 'uygulama')",
            new
            {
                kod, asama, personelKodu, adSoyad, subeAdi, gorev,
                /* Telefon yalnızca bilgi; gönderim için kullanılmıyor */
                telefon = YoneticiBulucu.TelefonSadelestir(telefon),
                girisTarihi,
                gecerlilik = DateTime.Now.AddHours(GecerlilikSaati),
                gonderen
            });

        if (!UygulamadaMi(db, personelKodu))
            return new UyumGonderimSonucu { Basarili = true, GirisYok = true };

        var not = !YeniSurumuAcmis(db, personelKodu);

        await Bildir(personelKodu, "Oryantasyon anketiniz hazır",
            $"{AsamaAdi[asama]} değerlendirmeniz · yaklaşık 3 dakika. {GecerlilikSaati} saat içinde doldurunuz."
            + (not ? GuncellemeNotu : ""));

        return new UyumGonderimSonucu { Basarili = true, GuncellemeNotu = not };
    }

    /* ------------------------------------------------------------------ */
    /* Yönetici                                                           */
    /* ------------------------------------------------------------------ */

    /// <summary>
    /// Kişiyi kim değerlendirecek: önce paneldeki yönetici kuralı
    /// (<see cref="YoneticiBulucu.Bul"/>: mağaza müdürü, mağaza müdürü için
    /// bölge müdürü, Form Ayarları'ndaki eşleştirmeler) ve o telefonun
    /// sahibi olan aktif personel. Bulunamazsa Ekibim'de kişiyi gören
    /// yöneticiler (izin onay tablosundaki 1. onaylayanlar ve departman
    /// yöneticileri; <c>GorevController</c> ile aynı kaynak).
    /// </summary>
    public List<(string kod, string ad, string telefon)> YoneticiHedefleri(
        System.Data.IDbConnection db, PersonelKaydi kisi, List<PersonelKaydi> personeller)
    {
        var (ad, telefon, _) = _yonetici.Bul(personeller, kisi.Sube, kisi.Pozisyon);

        var eslesen = TelefondanUygulamaKullanicisi(db, personeller, telefon, kisi.PersonelKodu);

        if (eslesen is not null)
            return new List<(string, string, string)>
            {
                (eslesen.PersonelKodu.Trim(), $"{eslesen.Ad} {eslesen.Soyad}".Trim(),
                 YoneticiBulucu.TelefonSadelestir(eslesen.Telefon))
            };

        try
        {
            using var k = _kapsam.CreateScope();

            var ekip = k.ServiceProvider.GetRequiredService<EkipServisi>();
            var departman = k.ServiceProvider.GetRequiredService<DepartmanServisi>();

            return MazeretBelgeGorevi.Yoneticileri(ekip, departman, kisi.PersonelKodu)
                .Select(x => ekip.Kisi(x))
                .Where(x => x is not null)
                .Select(x => (x.PersonelKodu.Trim(), $"{x.Ad} {x.Soyad}".Trim(),
                              YoneticiBulucu.TelefonSadelestir(x.Telefon)))
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ekip yöneticileri bulunamadı: {Kod}", kisi.PersonelKodu);
            return new List<(string, string, string)>();
        }
    }

    /// <summary>
    /// Yöneticinin değerlendirmesini Biçen360'ta açar ve bildirim gönderir.
    ///
    /// <para>
    /// Yöneticinin bekleyen değerlendirmeleri <c>GorevController</c>'da
    /// personelin açık anketinden türetiliyor; anketin süresi dolunca kart
    /// da kayboluyor. Yöneticiye gönderim bu yüzden kişi başına bir
    /// "davet" satırı yazar: tur = yonetici, kanal = uygulama,
    /// yonetici_kodu = yönetici, personel_kodu = değerlendirilecek kişi,
    /// cevaplar_json boş. Satır <see cref="GecerlilikSaati"/> saat açık kalır;
    /// yönetici ana sayfasında ve Ekibim'de kişiyi görür, değerlendirme
    /// (<c>Oryantasyon/Degerlendir</c>) bu satıra yazılır. Aynı yönetici ve
    /// kişi için doldurulmamış davet varsa yenisi açılmaz, süresi baştan
    /// başlar.
    /// </para>
    ///
    /// <para>
    /// Bildirim yönetici başına tektir. <paramref name="gunlukAnahtar"/>
    /// verilirse aynı yöneticiye aynı aşama için günde bir kez gider
    /// (toplu gönderimler, İK hatırlatması); davet yine de açılır. Anahtar
    /// KRY_GOREV_BILDIRIM'e <c>{gunlukAnahtar}|aşama|gün|yönetici</c>
    /// biçiminde yazılır.
    /// </para>
    /// </summary>
    public async Task<UyumYoneticiSonucu> YoneticiyeAc(
        System.Data.IDbConnection db, string asama, IEnumerable<PersonelKaydi> kisiler,
        List<PersonelKaydi> personeller, string gonderen, string gunlukAnahtar = null)
    {
        var sonuc = new UyumYoneticiSonucu();

        var degerlendirilen = Controllers.GorevController.YoneticiDegerlendirmeleri(
            db, new List<string> { asama }, DateTime.Now.AddYears(-2));

        var gecerlilik = DateTime.Now.AddHours(GecerlilikSaati);

        /* yönetici kodu → (ad, değerlendireceği kişilerin adları) */
        var hedefler = new Dictionary<string, (string ad, List<string> kisiler)>(StringComparer.OrdinalIgnoreCase);

        foreach (var kisi in kisiler.Where(x => x is not null && !string.IsNullOrWhiteSpace(x.PersonelKodu)))
        {
            var kisiAdi = $"{kisi.Ad} {kisi.Soyad}".Trim();

            if (degerlendirilen.Contains($"{K(kisi.PersonelKodu)}|{asama}"))
            {
                sonuc.Degerlendirilmis.Add(kisiAdi);
                continue;
            }

            var yoneticiler = YoneticiHedefleri(db, kisi, personeller);

            if (yoneticiler.Count == 0)
            {
                sonuc.Bulunamayan.Add(kisiAdi);
                continue;
            }

            foreach (var (yKod, yAd, yTel) in yoneticiler)
            {
                var acik = db.QueryFirstOrDefault<int?>(@"
SELECT TOP 1 id FROM KRY_UYUM_ANKET
WHERE tur = 'yonetici' AND test_mi = 0 AND kanal = 'uygulama' AND asama = @asama
  AND personel_kodu = @personelKodu AND yonetici_kodu = @yKod AND dolduruldu IS NULL
ORDER BY id DESC",
                    new { asama, personelKodu = kisi.PersonelKodu.Trim(), yKod });

                if (acik is int id)
                    db.Execute(@"
UPDATE KRY_UYUM_ANKET
SET gecerlilik = @gecerlilik, olusturma = SYSDATETIME(), gonderen = @gonderen,
    ad_soyad = @yAd, telefon = @yTel
WHERE id = @id", new { id, gecerlilik, gonderen, yAd, yTel });
                else
                    db.Execute(@"
INSERT INTO KRY_UYUM_ANKET
    (kod, tur, asama, personel_kodu, ad_soyad, sube_adi, gorev, telefon,
     giris_tarihi, gecerlilik, test_mi, gonderen, kanal, yonetici_kodu)
VALUES (@kod, 'yonetici', @asama, @personelKodu, @yAd, @subeAdi, N'uygulama', @yTel,
        @girisTarihi, @gecerlilik, 0, @gonderen, 'uygulama', @yKod)",
                        new
                        {
                            kod = BenzersizKod(db),
                            asama,
                            personelKodu = kisi.PersonelKodu.Trim(),
                            yAd,
                            subeAdi = kisi.Sube,
                            yTel,
                            girisTarihi = kisi.GirisTarihi,
                            gecerlilik,
                            gonderen,
                            yKod
                        });

                if (!hedefler.TryGetValue(yKod, out var h))
                    hedefler[yKod] = h = (yAd, new List<string>());

                if (!h.kisiler.Contains(kisiAdi)) h.kisiler.Add(kisiAdi);
            }

            sonuc.AcilanKisi++;
        }

        foreach (var (yKod, (yAd, adlar)) in hedefler)
        {
            var hedef = new UyumYoneticiHedefi { Kod = yKod, Ad = yAd, Kisiler = adlar };
            sonuc.Hedefler.Add(hedef);

            if (!UygulamadaMi(db, yKod))
            {
                hedef.GirisYok = true;
                continue;
            }

            if (gunlukAnahtar is not null
                && !MazeretBelgeGorevi.BirKez(db, $"{gunlukAnahtar}|{asama}|{DateTime.Today:yyyyMMdd}|{K(yKod)}"))
            {
                hedef.BugunBildirildi = true;
                continue;
            }

            hedef.GuncellemeNotu = !YeniSurumuAcmis(db, yKod);

            var metin = adlar.Count == 1
                ? $"{adlar[0]} ({AsamaAdi[asama]}). Biçen360 ana sayfası ya da Ekibim'den değerlendirebilirsiniz."
                : $"{adlar.Count} personel ({AsamaAdi[asama]}): {string.Join(", ", adlar.Take(4))}"
                  + (adlar.Count > 4 ? $" +{adlar.Count - 4}" : "")
                  + ". Biçen360 ana sayfası ya da Ekibim'den değerlendirebilirsiniz.";

            await Bildir(yKod, "Oryantasyon değerlendirmesi bekleniyor",
                metin + (hedef.GuncellemeNotu ? GuncellemeNotu : ""), "ekibim");

            hedef.Bildirildi = true;
        }

        return sonuc;
    }

    public string BaglantiAdresi(string kod)
    {
        var adres = (_ayar.FormOku().AnketAdresi ?? "").Trim().TrimEnd('/');

        if (string.IsNullOrWhiteSpace(adres))
            adres = "https://kariyer.bicen.com.tr";

        return $"{adres}/#/uyum/{kod}";
    }

    public static string BenzersizKod(System.Data.IDbConnection db)
    {
        for (var i = 0; i < 6; i++)
        {
            var kod = KodUret();

            if (db.ExecuteScalar<int>(
                    "SELECT COUNT(*) FROM KRY_UYUM_ANKET WHERE kod = @kod",
                    new { kod }) == 0) return kod;
        }

        /* Altı denemede benzersiz kod bulunamazsa zaman damgası eklenir */
        return KodUret() + DateTime.Now.Ticks.ToString()[^4..];
    }

    /// <summary>Karışmayan kod: birbirine benzeyen harf ve rakam yok.</summary>
    private static string KodUret()
    {
        const string harfler = "ABCDEFGHJKLMNPRSTUVYZ23456789";

        return new string(Enumerable.Range(0, 8)
            .Select(_ => harfler[Random.Shared.Next(harfler.Length)])
            .ToArray());
    }
}

/// <summary>Personele anket gönderiminin sonucu</summary>
public sealed class UyumGonderimSonucu
{
    /// <summary>Anket açıldı (bildirim gitmemiş olabilir)</summary>
    public bool Basarili { get; init; }

    /// <summary>Biçen360'a giriş yapmamış (jeton yok): anket açık, bildirim gitmedi</summary>
    public bool GirisYok { get; init; }

    /// <summary>Yeni sürümü (1.4) açmamış: bildirime güncelleme notu eklendi</summary>
    public bool GuncellemeNotu { get; init; }

    public string Hata { get; init; }
}

/// <summary>Yönetici değerlendirmesinin açılmasının sonucu</summary>
public sealed class UyumYoneticiSonucu
{
    /// <summary>Değerlendirmesi açılan yöneticiler</summary>
    public List<UyumYoneticiHedefi> Hedefler { get; } = new();

    /// <summary>Yöneticisi Biçen360'ta bulunamayan kişiler (ad soyad)</summary>
    public List<string> Bulunamayan { get; } = new();

    /// <summary>Bu aşamada zaten değerlendirilmiş kişiler (ad soyad)</summary>
    public List<string> Degerlendirilmis { get; } = new();

    /// <summary>En az bir yöneticide değerlendirmesi açılan kişi sayısı</summary>
    public int AcilanKisi { get; set; }
}

public sealed class UyumYoneticiHedefi
{
    public string Kod { get; set; }
    public string Ad { get; set; }
    public List<string> Kisiler { get; set; } = new();

    /// <summary>Bildirim gitti</summary>
    public bool Bildirildi { get; set; }

    /// <summary>Biçen360'a giriş yapmamış: değerlendirme açık, bildirim gitmedi</summary>
    public bool GirisYok { get; set; }

    /// <summary>Aynı gün bu aşama için zaten bildirildi (toplu gönderim)</summary>
    public bool BugunBildirildi { get; set; }

    public bool GuncellemeNotu { get; set; }
}

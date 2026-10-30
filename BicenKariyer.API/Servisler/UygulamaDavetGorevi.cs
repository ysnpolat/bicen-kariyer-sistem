using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>Biçen360 kurulum daveti ayarı (KRY_AYARLAR · UYGULAMA_DAVET)</summary>
public class UygulamaDavetAyari
{
    /// <summary>Otomatik gönderim açık mı</summary>
    public bool Acik { get; set; } = true;

    /// <summary>SMS metni; boşsa varsayılan. {ad} ilk ad, {link} indirme bağlantısı.</summary>
    public string Mesaj { get; set; } = "";

    /// <summary>
    /// Görevin ilk çalıştığı gün. Bu günden önce işe girenlere otomatik
    /// gitmez: görev açıldığında bütün çalışanlara toptan SMS gitmesin.
    /// </summary>
    public DateTime? Baslangic { get; set; }
}

/// <summary>
/// Biçen360 kurulum daveti
/// ---------------------------------------------------------------------------
/// Mikro'da işe girişi yapılmış ve çalışıyor (Durum 1) görünen personele,
/// işe giriş günü geldiğinde bir kez SMS: uygulamanın ne işe yaradığı ve
/// tek indirme bağlantısı (kariyer.bicen.com.tr/indir; iPhone'u App Store'a,
/// diğerlerini Google Play'e yönlendiriyor). Biçen Kart'tan söz edilmiyor.
///
/// <para>Gönderilmeyenler: uygulamaya zaten giriş yapmış olanlar
/// (KRY_MOBIL_CIHAZ), cep telefonu geçersiz olanlar, işe girişi 7 günden
/// eski olanlar ve görevin açıldığı günden önce girenler. Gece SMS gitmesin
/// diye 09:00–20:00 arası.</para>
/// </summary>
public class UygulamaDavetGorevi : BackgroundService
{
    public const string AYAR = "UYGULAMA_DAVET";
    public const string LINK = "https://kariyer.bicen.com.tr/indir";

    /* 3 SMS'e sığacak uzunlukta (Türkçe karakterli SMS parçası 67 karakter) */
    public const string VARSAYILAN_MESAJ =
        "Biçen'e hoş geldiniz {ad}! Vardiya giriş-çıkışı ve planı, izin talebi, puantaj ve duyurular için " +
        "Biçen360 uygulamasını aşağıdaki linke tıklayarak kurabilirsiniz:\n{link}";

    /// <summary>Bundan eski işe girişlere otomatik gitmez (elle gönderilebilir)</summary>
    private static int EnFazlaGun => Parametre.Sayi("davet.enFazlaGun");

    private readonly IServiceProvider _saglayici;
    private readonly ILogger<UygulamaDavetGorevi> _kayit;

    public UygulamaDavetGorevi(IServiceProvider saglayici, ILogger<UygulamaDavetGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    public static UygulamaDavetAyari AyarOku(AyarServisi ayar)
    {
        try
        {
            return ayar.Oku(AYAR, new UygulamaDavetAyari()) ?? new UygulamaDavetAyari();
        }
        catch
        {
            return new UygulamaDavetAyari();
        }
    }

    public static string Telefon(string ham)
    {
        var t = new string((ham ?? "").Where(char.IsDigit).ToArray());

        if (t.StartsWith("90") && t.Length == 12) t = t[2..];
        if (t.StartsWith("0") && t.Length == 11) t = t[1..];

        return t.Length == 10 && t.StartsWith("5") ? t : null;
    }

    public static string Metin(UygulamaDavetAyari a, PersonelKaydi p)
    {
        var kalip = string.IsNullOrWhiteSpace(a?.Mesaj) ? VARSAYILAN_MESAJ : a.Mesaj.Trim();
        var ilkAd = (p?.Ad ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";

        /* Ad Mikro'da büyük harf: "AYŞE" → "Ayşe" */
        var tr = new System.Globalization.CultureInfo("tr-TR");
        ilkAd = ilkAd.Length == 0 ? "" : char.ToUpper(ilkAd[0], tr) + ilkAd[1..].ToLower(tr);

        return kalip.Replace("{ad}", ilkAd).Replace("{link}", LINK).Replace("  ", " ").Trim();
    }

    /// <summary>Tek kişiye gönderir ve kaydeder. Başarılıysa true.</summary>
    public static async Task<(bool Basarili, string Hata)> Gonder(
        System.Data.IDbConnection db, SmsServisi sms, UygulamaDavetAyari a, PersonelKaydi p, string gonderen)
    {
        var tel = Telefon(p.Telefon);

        if (tel is null) return (false, "Cep telefonu geçersiz.");
        if (!sms.Etkin) return (false, "SMS servisi kapalı.");

        var sonuc = await sms.Gonder(tel, Metin(a, p));

        db.Execute(@"
INSERT INTO KRY_UYGULAMA_DAVET (personel_kodu, ad_soyad, sube, gorev, giris_tarihi, telefon, durum, hata, gonderen)
VALUES (@kod, @ad, @sube, @gorev, @giris, @tel, @durum, @hata, @gonderen)",
            new
            {
                kod = (p.PersonelKodu ?? "").Trim(),
                ad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = (p.IsGrubu ?? "").Trim(),
                gorev = p.Pozisyon,
                giris = p.GirisTarihi?.Date,
                tel,
                durum = sonuc.Basarili ? "gonderildi" : "hata",
                hata = sonuc.Basarili ? null : (sonuc.Mesaj ?? "").Length > 400 ? sonuc.Mesaj[..400] : sonuc.Mesaj,
                gonderen,
            });

        return (sonuc.Basarili, sonuc.Basarili ? null : sonuc.Mesaj);
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(6), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                if (Parametre.SaatAraliginda("davet.baslangicSaat", "davet.bitisSaat")) await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Biçen360 kurulum daveti görevi çalışmadı");
            }

            await Task.Delay(TimeSpan.FromMinutes(30), jeton);
        }
    }

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var sms = kapsam.ServiceProvider.GetRequiredService<SmsServisi>();
        var ayar = kapsam.ServiceProvider.GetRequiredService<AyarServisi>();
        var kaynak = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>();

        var a = AyarOku(ayar);

        /* İlk çalışma: başlangıç günü yazılır, o günden önce girenlere gitmez */
        if (a.Baslangic is null)
        {
            a.Baslangic = DateTime.Today;
            ayar.Yaz(AYAR, a);
        }

        if (!a.Acik || !sms.Etkin) return;

        var bugun = DateTime.Today;
        var enErken = new[] { a.Baslangic.Value.Date, bugun.AddDays(-EnFazlaGun) }.Max();

        var adaylar = kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1
                        && x.GirisTarihi is DateTime g && g.Date <= bugun && g.Date >= enErken
                        && (x.CikisTarihi is null || x.CikisTarihi.Value.Date >= bugun)
                        && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .GroupBy(x => x.PersonelKodu.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        if (adaylar.Count == 0) return;

        using var db = vt.Baglanti();

        /* Bu giriş için daha önce denenmiş (başarılı ya da hatalı): otomatik ısrar etmez */
        var gonderilmis = db.Query<(string Kod, DateTime? Giris)>(
                "SELECT personel_kodu, giris_tarihi FROM KRY_UYGULAMA_DAVET WHERE tarih >= @sinir",
                new { sinir = bugun.AddDays(-60) })
            .Select(x => $"{x.Kod?.Trim()}|{x.Giris:yyyy-MM-dd}")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /* Uygulamaya zaten giriş yapmış olanlar */
        var uygulamada = db.Query<string>("SELECT personel_kodu FROM KRY_MOBIL_CIHAZ")
            .Select(x => (x ?? "").Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var adet = 0;

        foreach (var p in adaylar)
        {
            var kod = p.PersonelKodu.Trim();

            if (uygulamada.Contains(kod)) continue;
            if (gonderilmis.Contains($"{kod}|{p.GirisTarihi:yyyy-MM-dd}")) continue;
            if (Telefon(p.Telefon) is null) continue;

            try
            {
                var (ok, hata) = await Gonder(db, sms, a, p, "otomatik");

                if (ok) adet++;
                else _kayit.LogWarning("Biçen360 daveti gitmedi: {Kod} · {Hata}", kod, hata);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Biçen360 daveti gönderilemedi: {Kod}", kod);
            }
        }

        if (adet > 0) _kayit.LogInformation("Biçen360 kurulum daveti: {Adet} yeni personele SMS gitti", adet);
    }
}

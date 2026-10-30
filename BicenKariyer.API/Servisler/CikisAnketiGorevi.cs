using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Çıkış anketini işten ayrılıştan 48 saat sonra kendiliğinden gönderir.
///
/// <para>
/// Neden bekleniyor: ayrılışın hemen ertesinde gönderilen anket hem
/// yanıtsız kalıyor hem rahatsız ediyor. İki gün, kişinin süreci
/// tamamlaması için makul bir aralık.
/// </para>
///
/// <para>
/// Gönderilmeyecek olanlar: çıkış sebebi usulsüzlük, hırsızlık, ihtarname
/// gibi disiplin kaynaklı olanlar; daha önce anket gönderilmiş olanlar;
/// yüz yüze mülakatı yapılmış olanlar; telefonu geçersiz olanlar.
/// </para>
/// </summary>
public class CikisAnketiGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<CikisAnketiGorevi> _kayit;

    /// <summary>Ayrılıştan sonra beklenecek süre</summary>
    private static int BeklemeSaati => Parametre.Sayi("cikis.beklemeSaati");

    /// <summary>
    /// Bu kadar günden eski ayrılışlara gönderilmez.
    ///
    /// Görev ilk kez çalıştığında geçmişteki yüzlerce ayrılana toptan SMS
    /// gitmesini engeller; anlamlı bir pencere dışında kalanlar elle
    /// gönderilebilir.
    /// </summary>
    private const int EnFazlaGecikmeGunu = 15;

    public CikisAnketiGorevi(
        IServiceProvider saglayici,
        IConfiguration yapilandirma,
        ILogger<CikisAnketiGorevi> kayit)
    {
        _saglayici = saglayici;
        _yapilandirma = yapilandirma;
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
                _kayit.LogWarning(hata, "Otomatik çıkış anketi gönderilemedi");
            }

            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    private async Task Calistir()
    {
        /* Ayardan kapatılabilir: canlıya alırken kademeli açmak gerekebilir */
        if (!_yapilandirma.GetValue("CikisAnketi:Otomatik", true)) return;

        using var kapsam = _saglayici.CreateScope();

        var saglayici = kapsam.ServiceProvider;

        var vt = saglayici.GetRequiredService<VeritabaniServisi>();
        var sms = saglayici.GetRequiredService<SmsServisi>();
        var ayar = saglayici.GetRequiredService<AyarServisi>();
        var kaynak = saglayici.GetRequiredService<PersonelKaynagiServisi>();

        if (!sms.Etkin) return;

        var simdi = DateTime.Now;
        var enGec = simdi.AddHours(-BeklemeSaati);
        var enErken = simdi.AddDays(-EnFazlaGecikmeGunu);

        List<PersonelKaydi> ayrilanlar;

        try
        {
            ayrilanlar = kaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 0
                            && x.CikisTarihi is not null
                            && x.CikisTarihi <= enGec
                            && x.CikisTarihi >= enErken)
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ayrılan personel listesi alınamadı");
            return;
        }

        if (ayrilanlar.Count == 0) return;

        using var db = vt.Baglanti();

        /* Daha önce anket gönderilmiş numaralar: aynı kişiye ikinci kez
           otomatik gönderim yapılmaz. İptal edilmiş gönderimler de sayılır;
           SMS ulaşmadıysa elle tekrar denenmeli, görev ısrar etmemeli. */
        var gonderilmis = db.Query<string>(
            "SELECT telefon FROM KRY_CIKIS_ANKET WHERE telefon IS NOT NULL")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        /* Yüz yüze mülakatı yapılmış olanlara da gönderilmez */
        var mulakatlilar = db.Query<string>(
            "SELECT personel_kodu FROM KRY_CIKIS_MULAKAT WHERE personel_kodu IS NOT NULL")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var gonderilen = 0;

        foreach (var kisi in ayrilanlar)
        {
            if (!AnketeUygun(kisi.CikisSebebi)) continue;

            if (!string.IsNullOrWhiteSpace(kisi.PersonelKodu)
                && mulakatlilar.Contains(kisi.PersonelKodu)) continue;

            var telefon = TelefonSadelestir(kisi.Telefon);

            if (telefon is null) continue;
            if (gonderilmis.Contains(telefon)) continue;

            try
            {
                if (await Gonder(db, sms, ayar, kisi, telefon))
                {
                    gonderilmis.Add(telefon);
                    gonderilen++;
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata,
                    "Anket gönderilemedi: {Kod}", kisi.PersonelKodu);
            }
        }

        if (gonderilen > 0)
            _kayit.LogInformation(
                "Otomatik çıkış anketi: {Adet} kişiye gönderildi", gonderilen);
    }

    /// <summary>Tek bir kişiye anket daveti gönderir.</summary>
    private static async Task<bool> Gonder(
        System.Data.IDbConnection db, SmsServisi sms, AyarServisi ayar,
        PersonelKaydi kisi, string telefon)
    {
        var kod = KodUret();

        /* Kod benzersiz olana kadar denenir */
        for (var i = 0; i < 5; i++)
        {
            if (db.ExecuteScalar<int>(
                    "SELECT COUNT(*) FROM KRY_CIKIS_ANKET WHERE kod = @kod",
                    new { kod }) == 0) break;

            kod = KodUret();
        }

        var kimlik = new string((kisi.KimlikNo ?? "").Where(char.IsDigit).ToArray());

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_CIKIS_ANKET
    (kod, personel_kodu, kimlik_no, ad_soyad, telefon, gorev, sube_adi,
     cikis_tarihi, gonderen)
OUTPUT INSERTED.id
VALUES (@kod, @personelKodu, @kimlik, @adSoyad, @telefon, @gorev, @subeAdi,
        @cikisTarihi, @gonderen)",
            new
            {
                kod,
                personelKodu = kisi.PersonelKodu,
                kimlik = kimlik.Length == 11 ? kimlik : null,
                adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                telefon,
                gorev = kisi.Pozisyon,
                subeAdi = kisi.Sube,
                cikisTarihi = kisi.CikisTarihi,
                gonderen = "otomatik"
            });

        var adres = (ayar.FormOku().AnketAdresi ?? "").Trim().TrimEnd('/');

        if (string.IsNullOrWhiteSpace(adres)) adres = "kariyer.bicen.com.tr";
        if (!adres.Contains("#")) adres = $"{adres}/#/anket";

        var kalip = ayar.CikisMulakatOku().AnketMesaji;

        if (string.IsNullOrWhiteSpace(kalip))
            kalip = "Merhaba {ad}, Biçen'deki deneyiminizi değerlendirmeniz "
                  + "bizim için değerli. 2 dakikanızı ayırır mısınız? {link} "
                  + "Yanıtlarınız gizli tutulur, üçüncü kişilerle paylaşılmaz.";

        var mesaj = kalip
            .Replace("{ad}", (kisi.Ad ?? "").Trim().Split(' ')[0])
            .Replace("{link}", $"{adres}/{kod}");

        var sonuc = await sms.Gonder(telefon, mesaj);

        if (!sonuc.Basarili)
        {
            /* Ulaşmayan davet iptal edilir; listede 'gönderildi' görünüp
               aslında gitmemiş olması yanıltıcı olur. */
            db.Execute("UPDATE KRY_CIKIS_ANKET SET iptal = 1 WHERE id = @id",
                new { id });

            return false;
        }

        return true;
    }

    /// <summary>On haneli cep numarası; uygun değilse null.</summary>
    private static string TelefonSadelestir(string ham)
    {
        var t = new string((ham ?? "").Where(char.IsDigit).ToArray());

        if (t.StartsWith("90") && t.Length == 12) t = t[2..];
        if (t.StartsWith("0") && t.Length == 11) t = t[1..];

        return t.Length == 10 && t.StartsWith("5") ? t : null;
    }

    /// <summary>Karışmayan kısa kod: benzer görünen harfler yok.</summary>
    private static string KodUret()
    {
        const string harfler = "ABCDEFGHJKLMNPRSTUVYZ23456789";

        var rastgele = Random.Shared;

        return new string(Enumerable.Range(0, 8)
            .Select(_ => harfler[rastgele.Next(harfler.Length)])
            .ToArray());
    }

    /// <summary>
    /// Disiplin kaynaklı çıkışlara anket gönderilmez.
    ///
    /// Liste CikisAnketController içindekiyle aynı tutulmalı; ikisi
    /// ayrışırsa elle gönderim ile otomatik gönderim farklı davranır.
    /// </summary>
    private static readonly string[] Uygunsuz =
    {
        "usulsüz", "usulsuz", "hırsız", "hirsiz", "disiplin",
        "haklı fesih", "hakli fesih", "iş akdi fesih", "is akdi fesih",
        "devamsız", "devamsiz", "suistimal", "güven", "guven",
        "kod 25", "25/2", "ahlak", "ihtar", "ihtarname", "ihtarnâme"
    };

    private static bool AnketeUygun(string sebep)
    {
        if (string.IsNullOrWhiteSpace(sebep)) return true;

        var kucuk = sebep.ToLowerInvariant();

        return !Uygunsuz.Any(x => kucuk.Contains(x));
    }
}

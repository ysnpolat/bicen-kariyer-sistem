using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Gift kart servisi
/// ---------------------------------------------------------------------------
/// Personele her ay yüklenen puan yazarkasada harcanıyor. Kartlar
/// PosbackPromosyon veritabanındaki MusteriKart tablosunda duruyor.
///
/// <para>
/// Ödeme kodu hiçbir yere yazılmıyor: yazarkasa aynı algoritmayı kendi
/// tarafında çalıştırıp karşılaştırıyor. Bu yüzden algoritmayı birebir
/// aynı tutmak zorunlu — bir basamağı değiştirmek bütün kasalarda
/// ödemeyi bozar.
/// </para>
/// </summary>
public class GiftKartServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<GiftKartServisi> _kayit;

    /// <summary>Kart tablosunun tam adı; bağlantı PosBack'e gidiyor.</summary>
    private const string TABLO = "[PosbackPromosyon].[dbo].[MusteriKart]";

    /// <summary>Mobil uygulama kartlarının grup numarası.</summary>
    public const int MOBIL_GRUP = 608;

    /// <summary>
    /// Kasanın harcamada ne soracağı (05.10.2026):
    /// <list type="bullet">
    /// <item>GrupNo 608 (mobil) → <c>PuanHarcamaSmsSifre = 0</c>: kasa şifre
    /// sormuyor, uygulamadaki günlük ödeme kodunu soruyor.</item>
    /// <item>GrupNo NULL (fiziki) → <c>PuanHarcamaSmsSifre = 1</c>: kasa
    /// kart şifresini soruyor.</item>
    /// </list>
    /// Önceden mobil kartta da 1 yazılıyordu; kasa iki kipte de şifre
    /// soruyor, ödeme kodu hiç kullanılmıyordu.
    /// Yazan yerler: GrupDegistir, KartBagla, panelin KartaYaz'ı ve
    /// BicenKartController.KasaDogrulamaEsitle.
    /// </summary>
    public const int KASA_KOD_ILE = 0, KASA_SIFRE_ILE = 1;

    public GiftKartServisi(VeritabaniServisi vt, ILogger<GiftKartServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /* ---------------------------------------------------------------- kod */

    /// <summary>
    /// Günlük ödeme kodu.
    ///
    /// <para>
    /// Yazarkasadaki algoritmanın birebir aynısı: gün + ay + yıl,
    /// telefonun son dört hanesi ve kart numarasının son dört hanesi
    /// toplanıp yediyle çarpılıyor, sonuç dört haneye indiriliyor.
    /// </para>
    ///
    /// <para>
    /// Kod gün boyunca sabit: kasa tarafı kodu saklamadığı için her
    /// seferinde yeniden hesaplıyor ve iki tarafın aynı sonucu bulması
    /// gerekiyor. Bu, kodun tek kullanımlık olmadığı anlamına geliyor;
    /// güvenlik kart şifresine ve kasadaki doğrulamaya dayanıyor.
    /// </para>
    /// </summary>
    /// <summary>Panelden tanımlanmış kart numarası; yoksa null.</summary>
    private string EslesmisKart(string sicil)
    {
        var kod = (sicil ?? "").Trim();

        if (kod.Length == 0) return null;

        try
        {
            using var db = _vt.Baglanti();

            var kart = db.ExecuteScalar<string>(@"
SELECT TOP 1 kart_no FROM KRY_KART_ESLESME WHERE LTRIM(RTRIM(personel_kodu)) = @kod",
                new { kod });

            return string.IsNullOrWhiteSpace(kart) ? null : kart.Trim();
        }
        catch
        {
            /* Tablo henüz yoksa eski yola düşülüyor */
            return null;
        }
    }

    public static int Kod(string telefon, string kartNo, DateTime? gun = null)
    {
        var t = gun ?? DateTime.Today;

        var tarih = t.Day + t.Month + t.Year;

        var tel = SonDort(telefon);
        var kart = SonDort(kartNo);

        /* Yedi çarpanı basit bir karmaşa ekliyor; aynı gün için sonuç
           değişmiyor. */
        var toplam = (tarih + tel + kart) * 7;

        return (toplam % 9000) + 1000;
    }

    /// <summary>Metnin son dört hanesi; kısaysa tamamı.</summary>
    private static int SonDort(string deger)
    {
        var rakamlar = new string((deger ?? "").Where(char.IsDigit).ToArray());

        if (rakamlar.Length == 0) return 0;

        var parca = rakamlar.Length >= 4
            ? rakamlar[^4..]
            : rakamlar;

        return int.TryParse(parca, out var s) ? s : 0;
    }

    /* -------------------------------------------------------------- bakiye */

    /// <summary>Bakiyenin hesaplandığı puan kodu (Posback'te personel puanı 1).</summary>
    public const int BAKIYE_PUAN_KODU = 1;

    /// <summary>
    /// Kart bakiyesi: Posback'in kendi fonksiyonu <c>dbo.PuanBakiye</c>.
    ///
    /// <para>
    /// Posback bakiyeyi parti usulü tutuyor (29.09.2026'da fonksiyon ve
    /// prosedür incelenerek görüldü). Her kazanma (1), yükleme (3) ve devir
    /// (4) satırı bir parti; satırın EksiPuan'ı o partiden kullanılan
    /// tutar. Bakiye, süresi geçmemiş partilerin (Puan − EksiPuan)
    /// toplamı. Harcama ve silme satırları yalnızca kayıt; asıl düşüm
    /// <c>dbo.EksiPuanIsle</c> ile en eski partiden başlayarak partilerin
    /// EksiPuan'ı artırılarak yapılıyor.
    /// </para>
    ///
    /// <para>
    /// Önceden bakiye hareket tiplerinden (+/−) hesaplanıyordu; Posback'in
    /// gösterdiğiyle tutmuyordu ve panelden yapılan silme Posback'te
    /// görünmüyordu. Artık hesabı Posback'in fonksiyonu yapıyor: panel,
    /// mobil uygulama ve Posback her zaman aynı bakiyeyi gösteriyor.
    /// </para>
    /// </summary>
    public static decimal BakiyeSorgusu(IDbConnection db, string kartNo, int puanKodu = BAKIYE_PUAN_KODU)
    {
        var deger = db.ExecuteScalar<decimal?>(
            "SELECT [PosbackPromosyon].[dbo].[PuanBakiye](@kartNo, @puanKodu)",
            new { kartNo = new DbString { Value = (kartNo ?? "").Trim(), IsAnsi = true, Length = 16 }, puanKodu },
            commandTimeout: 30);

        return deger ?? 0m;
    }

    /// <summary>
    /// Birden çok kartın bakiyesi tek sorguda: <see cref="BakiyeSorgusu"/>
    /// (dbo.PuanBakiye) ile aynı kural, süresi geçmemiş 1/3/4 partilerinde
    /// kalan Puan − EksiPuan. Kart sütununa dönüşüm uygulanmıyor ki dizin
    /// kullanılabilsin. Listede olup sonuçta olmayan kartın bakiyesi sıfır.
    /// </summary>
    public static List<(string KartNo, decimal Bakiye)> TopluBakiye(
        IDbConnection db, IEnumerable<string> kartlar, int puanKodu = BAKIYE_PUAN_KODU)
    {
        var liste = kartlar.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()).Distinct().ToList();
        var sonuc = new List<(string, decimal)>();

        foreach (var parca in liste.Chunk(400))
            sonuc.AddRange(db.Query(@"
SELECT CONVERT(VARCHAR(50), h.KartNo) AS kartNo,
       SUM(ISNULL(h.Puan, 0) - ISNULL(h.EksiPuan, 0)) AS bakiye
FROM [PosbackPromosyon].[dbo].[PuanHareket] h WITH (NOLOCK)
WHERE h.KartNo IN @parca
  AND h.Puan - h.EksiPuan > 0
  AND h.IslemTipi IN (1, 3, 4)
  AND h.SonKullanimTarihi >= GETDATE()
  AND h.PuanKodu = @puanKodu
GROUP BY CONVERT(VARCHAR(50), h.KartNo)", new { parca = PosParametre.Ansi(parca), puanKodu }, commandTimeout: 120)
                .Select(x => (((string)x.kartNo ?? "").Trim(),
                              x.bakiye is null ? 0m : (decimal)Convert.ToDecimal(x.bakiye))));

        return sonuc;
    }

    private (decimal Bakiye, bool Okunabildi) Bakiye(IDbConnection db, string kartNo)
    {
        try
        {
            return (BakiyeSorgusu(db, kartNo), true);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bakiyesi hesaplanamadı");

            return (0m, false);
        }
    }

    /// <summary>Hareket tablosunda aday adlardan var olanı.</summary>
    private string HareketSutunu(IDbConnection db, params string[] adaylar)
    {
        _hareketSutunlari ??= db.Query<string>(@"
SELECT COLUMN_NAME
FROM [PosbackPromosyon].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'PuanHareket'").ToList();

        return adaylar.FirstOrDefault(a => _hareketSutunlari.Any(
            x => string.Equals(x, a, StringComparison.OrdinalIgnoreCase)));
    }

    /* ---------------------------------------------------------------- kart */

    /// <summary>
    /// Personelin kartı. Telefon numarasıyla eşleştiriliyor: personel
    /// kaydıyla kart kaydı arasında başka ortak alan yok.
    /// </summary>
    /// <summary>
    /// Personelin kartı.
    ///
    /// <para>
    /// Önce panelden yapılan eşleşmeye bakılıyor (KRY_KART_ESLESME):
    /// kartı kime verdiğimiz orada yazıyor. Eşleşme yoksa eski yol,
    /// yani POS tarafındaki telefon alanı denetleniyor — böylece
    /// panelden henüz tanımlanmamış kartlar da çalışmaya devam ediyor.
    /// </para>
    /// </summary>
    public GiftKart Getir(string telefon, string sicil = null)
    {
        var rakamlar = new string((telefon ?? "").Where(char.IsDigit).ToArray());
        var son10 = rakamlar.Length >= 10 ? rakamlar[^10..] : null;

        var tanimli = EslesmisKart(sicil);

        if (son10 is null && tanimli is null) return null;

        using var db = _vt.PosBaglantisi();

        if (tanimli is not null)
        {
            var kart = db.QueryFirstOrDefault($@"
SELECT TOP 1
    k.KartNo                       AS kartNo,
    LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
    k.GrupNo                       AS grupNo,
    CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE k.KartNo = CONVERT(VARCHAR(50), @kartNo)",
                new { kartNo = tanimli }, commandTimeout: 30);

            if (kart is not null)
            {
                var no = ((string)kart.kartNo ?? "").Trim();
                var (b, okundu) = Bakiye(db, no);

                return new GiftKart
                {
                    KartNo = no,
                    Ad = ((string)kart.ad ?? "").Trim(),
                    Bakiye = b,

                    /* Kartın gerçek tercihi (GrupNo). Önceden panelden
                       eşleşmiş kartta sabit "mobil" dönüyordu: personel
                       fiziki karta geçip kaydediyor, ayar MusteriKart'a
                       yazılıyor ama ekran yine mobil gösteriyordu
                       (05.10.2026). */
                    MobilKart = kart.grupNo is not null && (int)kart.grupNo == MOBIL_GRUP,
                    SifreVar = (int)kart.sifreVar == 1,
                    BakiyeOkunabildi = okundu,
                };
            }

            _kayit.LogWarning("Eşleşmiş kart POS tarafında bulunamadı: {Kart}", tanimli);
        }

        if (son10 is null) return null;

        /* CepTel bigint: metin işlevleri doğrudan uygulanamıyor, önce
           varchar'a çevriliyor. ISNULL(CepTel, '') yazmak dönüşüm hatası
           veriyor ve sorgu hiç çalışmıyordu. */
        var kayit = db.QueryFirstOrDefault($@"
SELECT TOP 1
    k.KartNo                       AS kartNo,
    LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
    k.GrupNo                       AS grupNo,
    CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {TABLO} k
WHERE (k.CepTel IN (@t10, @t12)
       /* Sayısal olmayan numara (olmamalı) için eski eşleşme */
       OR (@t10 IS NULL AND k.CepTel IS NOT NULL AND RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) = @son10))
ORDER BY CASE WHEN k.GrupNo = @mobil THEN 0 ELSE 1 END, k.KartNo",
            /* CepTel bigint: 5XXXXXXXXX ya da 905XXXXXXXXX. Sütuna işlev
               uygulanınca (RIGHT/CONVERT) dizin kullanılamıyor, tablo baştan
               sona taranıyordu; sayıyla karşılaştırmak arama yapıyor. */
            new
            {
                son10,
                t10 = long.TryParse(son10, out var t) ? t : (long?)null,
                t12 = long.TryParse("90" + son10, out var t2) ? t2 : (long?)null,
                mobil = MOBIL_GRUP
            }, commandTimeout: 30);

        if (kayit is null) return null;

        var kartNo = ((string)kayit.kartNo ?? "").Trim();
        var (bakiye, okunabildi) = Bakiye(db, kartNo);

        return new GiftKart
        {
            KartNo = kartNo,
            Ad = ((string)kayit.ad ?? "").Trim(),
            Bakiye = bakiye,
            MobilKart = kayit.grupNo is not null && (int)kayit.grupNo == MOBIL_GRUP,
            SifreVar = (int)kayit.sifreVar == 1,
            BakiyeOkunabildi = okunabildi,
        };
    }

    /// <summary>
    /// Kart tanısı: yazmanın nereye gittiğini gösterir.
    ///
    /// <para>
    /// "Şifre güncellendi diyor ama veritabanında değişmiyor" gibi
    /// durumların tek sebebi olmuyor: yazma başka bir sunucudaki aynı
    /// adlı veritabanına gidiyor olabiliyor ya da aynı telefona bağlı
    /// ikinci bir karta. İkisini tahminle ayırmak yerine sunucu adı,
    /// veritabanı adı ve o telefona bağlı bütün kartlar birlikte
    /// döndürülüyor.
    /// </para>
    ///
    /// <para>
    /// Yalnızca çağıran kişinin kendi telefonuna bağlı kartlar dönüyor;
    /// şifrenin kendisi değil, dolu olup olmadığı.
    /// </para>
    /// </summary>
    public object Tani(string telefon)
    {
        var rakamlar = new string((telefon ?? "").Where(char.IsDigit).ToArray());

        if (rakamlar.Length < 10)
            return new { hata = "Cep telefonunuz kayıtlı değil." };

        var son10 = rakamlar[^10..];

        using var db = _vt.PosBaglantisi();

        var sunucu = db.QueryFirstOrDefault<string>(
            "SELECT CONVERT(VARCHAR(200), @@SERVERNAME) + N' · ' + DB_NAME()");

        var kartlar = db.Query($@"
SELECT k.KartNo AS kartNo,
       k.GrupNo AS grupNo,
       CASE WHEN k.KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar,
       RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) AS telefon
FROM {TABLO} k
WHERE k.CepTel IS NOT NULL
  AND RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) = @son10
ORDER BY CASE WHEN k.GrupNo = @mobil THEN 0 ELSE 1 END, k.KartNo",
            new { son10, mobil = MOBIL_GRUP }, commandTimeout: 30).ToList();

        var secilen = Getir(telefon);

        return new
        {
            sunucu,
            tablo = TABLO,
            telefon = son10,
            kartSayisi = kartlar.Count,
            kartlar,

            /* Şifre ve tercih bu karta yazılıyor: listede başka kart
               varsa aradaki fark burada görünüyor. */
            yazilanKart = secilen?.KartNo,
        };
    }

    /// <summary>
    /// Kart şifresini değiştirir.
    ///
    /// <para>
    /// Yalnızca mobil karta izin veriliyor: fiziki kartın şifresi kasada
    /// başka bir akışla kullanılıyor ve buradan değiştirmek o akışı
    /// bozardı.
    /// </para>
    /// </summary>
    /// <summary>
    /// Kartın kullanım biçimi.
    ///
    /// <para>
    /// GrupNo 608 mobil ödeme, NULL fiziki kart. Personel hangisini
    /// kullanacağına kendisi karar veriyor; ikisi arasında geçiş kartın
    /// bakiyesini ya da geçmişini etkilemiyor.
    /// </para>
    /// </summary>
    public (bool Basarili, string Hata) GrupDegistir(string kartNo, bool mobil, string yeniSifre = null)
    {
        using var db = _vt.PosBaglantisi();

        var (sifre, sifreHata) = TercihSifresi(db, kartNo, mobil, yeniSifre);
        if (sifreHata is not null) return (false, sifreHata);

        var etkilenen = db.Execute($@"
UPDATE {TABLO}
SET GrupNo = @grup,

    /* Mobil kartta kasa ödeme kodunu, fiziki kartta kart şifresini
       soruyor (bkz. KASA_KOD_ILE) */
    PuanHarcamaSmsSifre = CASE WHEN @grup = 608 THEN 0 ELSE 1 END,

    /* Mobilde şifre silinir; fiziki kartta yeni şifre (verildiyse) */
    KartSifre = CASE WHEN @grup = 608 THEN NULL WHEN @sifre IS NOT NULL THEN @sifre ELSE KartSifre END
WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new { grup = mobil ? (int?)MOBIL_GRUP : null, kartNo, sifre }, commandTimeout: 30);

        if (etkilenen == 0) return (false, "Kart bulunamadı.");

        return SifreDogrula(db, kartNo, mobil, sifre);
    }

    /// <summary>
    /// Alışveriş tercihi değişirken şifre (09.10.2026): mobil uygulama
    /// seçilince kart şifresi silinir (608 → KartSifre NULL); fiziki kart
    /// seçilince personel yeni şifre belirler. Yeni şifre gönderilmediyse
    /// (yayındaki 1.6 sürümü) kartta şifre olması şart: yoksa fiziki karta
    /// geçilmez, önce şifre belirlenmesi istenir.
    /// </summary>
    private (string Sifre, string Hata) TercihSifresi(IDbConnection db, string kartNo, bool mobil, string yeniSifre)
    {
        if (mobil) return (null, null);

        if (!string.IsNullOrWhiteSpace(yeniSifre))
        {
            var kural = SifreKuraliHatasi(yeniSifre);
            return kural is null ? (new string(yeniSifre.Where(char.IsDigit).ToArray()), null) : (null, kural);
        }

        var mevcut = db.ExecuteScalar<string>($@"
SELECT TOP 1 CONVERT(VARCHAR(20), KartSifre) FROM {TABLO} WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new { kartNo }, commandTimeout: 30);

        return string.IsNullOrWhiteSpace(mevcut)
            ? (null, "Fiziki kartla alışverişte kasada kart şifresi sorulur. Önce Kart Şifresi satırındaki "
                     + "BELİRLE ile dört haneli yeni şifrenizi belirleyin, sonra fiziki karta geçin.")
            : (null, null);
    }

    /// <summary>Yazılan şifre geri okunarak doğrulanır (bkz. KartSifresiYaz)</summary>
    private (bool, string) SifreDogrula(IDbConnection db, string kartNo, bool mobil, string sifre)
    {
        if (!mobil && sifre is null) return (true, null);

        var yazilan = db.ExecuteScalar<string>($@"
SELECT TOP 1 CONVERT(VARCHAR(20), KartSifre) FROM {TABLO} WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new { kartNo }, commandTimeout: 30);

        var beklenen = mobil ? "" : sifre;

        if ((yazilan ?? "").Trim() == beklenen) return (true, null);

        _kayit.LogError("Tercih değişiminde kart şifresi yazılamadı: {Kart} · {Kip}", kartNo, mobil ? "mobil" : "fiziki");

        return (false, mobil
            ? "Tercih mobil olarak kaydedildi ama kart şifresi silinemedi; Bilgi İşlem ile görüşünüz."
            : "Tercih fiziki olarak kaydedildi ama yeni şifre yazılamadı; Kart Şifresi satırından tekrar deneyiniz.");
    }

    /// <summary>
    /// Kartı personelin üzerine tanımlar.
    ///
    /// <para>
    /// Uygulamadaki "Kartı güncelle" bunun karşılığı: personel kart
    /// numarasını yazıyor ya da barkodu okutuyor, alışveriş tercihini
    /// seçiyor. Tercih GrupNo'ya yazılıyor — mobil ise <see
    /// cref="MOBIL_GRUP"/>, fiziki ise NULL.
    /// </para>
    ///
    /// <para>
    /// Kart burada oluşturulmuyor. Kartlar basılıp kasa tarafına
    /// giriliyor; buradan yapılan iş var olan bir kaydı personelin cep
    /// telefonuna bağlamak. Başkasının telefonuna bağlı kart
    /// devralınmıyor: iki personelin aynı kartı kullanması bakiyeyi
    /// ortak yapardı.
    /// </para>
    /// </summary>
    public (bool Basarili, string Hata) KartBagla(
        string kartNo, string telefon, string adSoyad, bool mobil, string yeniSifre = null)
    {
        var no = new string((kartNo ?? "").Where(char.IsDigit).ToArray());

        if (no.Length < 8)
            return (false, "Kart numarası eksik. Kartın üzerindeki numaranın tamamını yazınız.");

        var rakamlar = new string((telefon ?? "").Where(char.IsDigit).ToArray());

        if (rakamlar.Length < 10)
            return (false, "Cep telefonunuz sistemde kayıtlı değil. "
                         + "Kart eşleştirmesi telefon numarası üzerinden yapılıyor; "
                         + "İnsan Kaynakları ile görüşünüz.");

        var son10 = rakamlar[^10..];

        using var db = _vt.PosBaglantisi();

        var kayit = db.QueryFirstOrDefault($@"
SELECT TOP 1 RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) AS telefon
FROM {TABLO} k
WHERE k.KartNo = CONVERT(VARCHAR(50), @no)", new { no }, commandTimeout: 30);

        if (kayit is null)
            return (false, "Bu numarada bir Biçen kart bulunamadı. "
                         + "Kartınızı bir kez kasada okutup tekrar deneyiniz.");

        var sahip = ((string)kayit.telefon ?? "").Trim();

        if (sahip.Length > 0 && sahip != son10)
            return (false, "Bu kart başka bir cep telefonuna tanımlı. "
                         + "İnsan Kaynakları ile görüşünüz.");

        /* Ad sütunu otuz hane: uzun değer yazmak sorguyu düşürüyordu,
           kırpılarak yazılıyor. Boş gelirse var olan ad korunuyor. */
        var ad = (adSoyad ?? "").Trim();

        var (sifre, sifreHata) = TercihSifresi(db, no, mobil, yeniSifre);
        if (sifreHata is not null) return (false, sifreHata);

        var etkilenen = db.Execute($@"
UPDATE {TABLO}
SET CepTel = @tel,
    GrupNo = @grup,

    /* Mobil kartta kasa ödeme kodunu, fiziki kartta kart şifresini
       soruyor (bkz. KASA_KOD_ILE) */
    PuanHarcamaSmsSifre = CASE WHEN @grup = 608 THEN 0 ELSE 1 END,

    /* Mobilde şifre silinir; fiziki kartta yeni şifre (verildiyse) */
    KartSifre = CASE WHEN @grup = 608 THEN NULL WHEN @sifre IS NOT NULL THEN @sifre ELSE KartSifre END,

    Ad = CASE WHEN LEN(@ad) = 0 THEN Ad ELSE LEFT(@ad, 30) END
WHERE KartNo = CONVERT(VARCHAR(50), @no)",
            new
            {
                tel = long.Parse(son10),
                grup = mobil ? (int?)MOBIL_GRUP : null,
                sifre,
                ad,
                no,
            },
            commandTimeout: 60);

        if (etkilenen == 0)
            return (false, "Kart güncellenemedi. Tekrar deneyiniz.");

        var (dogru, dogrulamaHata) = SifreDogrula(db, no, mobil, sifre);
        if (!dogru) return (false, dogrulamaHata);

        _kayit.LogInformation(
            "Kart tanımlandı: {Kart} → {Telefon} ({Kip})",
            no, son10, mobil ? "mobil" : "fiziki");

        return (true, null);
    }

    /// <summary>
    /// Kartı personelin üzerinden kaldırır.
    ///
    /// <para>
    /// Panelde eşleşme kaldırılırken telefon korunuyor; burada
    /// silinmek zorunda: kart personele cep telefonuyla bulunuyor,
    /// numara kalırsa kart uygulamada görünmeye devam ederdi.
    /// Puan geçmişi kart numarasında duruyor ve silinmiyor — kart
    /// yeniden tanımlandığında bakiye olduğu gibi geri geliyor.
    /// </para>
    ///
    /// <para>
    /// Yalnızca kendi kartı kaldırılabiliyor: sorgu telefon eşleşmesini
    /// de arıyor, numara tutmazsa hiçbir satır etkilenmiyor.
    /// </para>
    /// </summary>
    public (bool Basarili, string Hata) KartKaldir(string kartNo, string telefon)
    {
        var no = new string((kartNo ?? "").Where(char.IsDigit).ToArray());

        if (no.Length == 0) return (false, "Kart numarası gerekli.");

        var rakamlar = new string((telefon ?? "").Where(char.IsDigit).ToArray());

        if (rakamlar.Length < 10) return (false, "Cep telefonunuz kayıtlı değil.");

        var son10 = rakamlar[^10..];

        using var db = _vt.PosBaglantisi();

        var etkilenen = db.Execute($@"
UPDATE {TABLO}
SET CepTel = NULL,
    GrupNo = NULL
WHERE KartNo = CONVERT(VARCHAR(50), @no)
  AND CepTel IS NOT NULL
  AND RIGHT(CONVERT(VARCHAR(20), CepTel), 10) = @son10",
            new { no, son10 }, commandTimeout: 30);

        if (etkilenen == 0)
            return (false, "Kart bulunamadı ya da size tanımlı değil.");

        _kayit.LogInformation("Kart kaldırıldı: {Kart} ← {Telefon}", no, son10);

        return (true, null);
    }

    /// <summary>
    /// Personelin kendi belirlediği kart şifresinin kuralı: dört rakam;
    /// aynı ya da sıralı rakamlar kabul edilmiyor. Uygun ise null, değilse
    /// gösterilecek hata. Uygulamadaki şifre değişikliği ve ayrılan
    /// personelin SMS bağlantısı (<c>KartLinkController</c>) aynı kuralı
    /// kullanıyor.
    /// </summary>
    public static string SifreKuraliHatasi(string yeniSifre)
    {
        var sifre = new string((yeniSifre ?? "").Where(char.IsDigit).ToArray());

        if (sifre.Length != 4)
            return "Şifre 4 haneli rakam olmalıdır.";

        /* Art arda ya da aynı rakamlar kabul edilmiyor: kart kaybolduğunda
           ilk denenecek şifreler bunlar. */
        if (sifre.Distinct().Count() == 1)
            return "Aynı rakamdan oluşan şifre kullanılamaz.";

        var artan = sifre.Zip(sifre.Skip(1), (a, b) => b - a).All(x => x == 1);
        var azalan = sifre.Zip(sifre.Skip(1), (a, b) => b - a).All(x => x == -1);

        if (artan || azalan)
            return "Sıralı rakamlardan oluşan şifre kullanılamaz.";

        return null;
    }

    /// <summary>
    /// Kart şifresini MusteriKart'a yazar ve geri okuyarak doğrular. Tek
    /// yazma yolu: panelin şifre işlemi (<c>BicenKartController.Sifre</c>),
    /// uygulamadaki şifre değişikliği ve ayrılan personelin SMS bağlantısı
    /// bunu çağırıyor. <paramref name="sifre"/> null ise şifre kaldırılır.
    /// </summary>
    /// <remarks>
    /// Şifre düz dört hane olarak yazılıyor (kasa yazılımı öyle okuyor);
    /// ayrıca <c>PuanHarcamaSmsSifre</c> kartın kendi ayarında kalıyor.
    /// </remarks>
    public static (bool Basarili, string Hata) KartSifresiYaz(
        IDbConnection db, string kartNo, string sifre, ILogger kayit)
    {
        /* Grup kısıtı kaldırıldı: personel kartını fiziki kipe alıp
           şifresini yine değiştirmek isteyebiliyor ve kasadaki akış
           şifreyi her iki kipte de kullanıyor. */
        var etkilenen = db.Execute($@"
UPDATE {TABLO} SET KartSifre = @sifre WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new { sifre, kartNo }, commandTimeout: 30);

        if (etkilenen == 0) return (false, "Kart bulunamadı.");

        /* Yazdıktan sonra geri okunuyor.

           Etkilenen satır sayısına güvenmek yetmiyordu: tabloda tetikleyici
           varsa ya da başka bir süreç değeri hemen geri yazıyorsa sayı
           sıfırdan büyük geliyor, uygulama "kaydedildi" diyor ve şifre
           değişmemiş oluyordu. Sessiz başarısızlık, personelin kasada
           şifresinin tutmadığını öğrenmesi demek. */
        var yazilan = db.QueryFirstOrDefault<string>($@"
SELECT TOP 1 CONVERT(VARCHAR(20), KartSifre) FROM {TABLO} WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)",
            new { kartNo }, commandTimeout: 30);

        if ((yazilan ?? "").Trim() != (sifre ?? ""))
        {
            kayit?.LogError(
                "Kart şifresi yazılamadı: {Kart} · etkilenen {Adet} · okunan {Okunan}",
                kartNo, etkilenen, yazilan is null ? "(boş)" : "(farklı)");

            return (false,
                "Şifre kaydedilemedi. Kart veritabanı değişikliği kabul etmedi; "
                + "Bilgi İşlem ile görüşünüz.");
        }

        return (true, null);
    }

    public (bool Basarili, string Hata) SifreDegistir(string kartNo, string yeniSifre)
    {
        var kural = SifreKuraliHatasi(yeniSifre);

        if (kural is not null) return (false, kural);

        var sifre = new string(yeniSifre.Where(char.IsDigit).ToArray());

        using var db = _vt.PosBaglantisi();

        var (basarili, hata) = KartSifresiYaz(db, kartNo, sifre, _kayit);

        if (!basarili) return (false, hata);

        _kayit.LogInformation("Kart şifresi değiştirildi: {Kart}", kartNo);

        return (true, null);
    }

    /* -------------------------------------------------------------- hareket */

    /// <summary>
    /// İşlem tipinin adı.
    ///
    /// Sayılar yazarkasa tarafının tanımı; listede personelin anlayacağı
    /// karşılıkları gösteriliyor.
    /// </summary>
    public static string IslemAdi(int tip) => tip switch
    {
        1 => "Puan kazanma",
        2 => "Alışveriş",
        3 => "Puan yüklemesi",
        4 => "Devir",
        5 => "Sıfırlama",
        6 => "Silme",
        9 => "Alışveriş iadesi",
        _ => "Hareket",
    };

    /// <summary>
    /// Bakiyeden düşen işlemler.
    ///
    /// Harcama ve sıfırlama/silme bakiyeyi azaltıyor; kazanma, yükleme,
    /// devir ve iade artırıyor.
    /// </summary>
    private static bool Dusuyor(int tip) => tip is 2 or 5 or 6;

    /// <summary>Hareket tablosundaki sütunlar; bir kez okunup saklanıyor.</summary>
    private static List<string> _hareketSutunlari;

    /* ---------------------------------------------------------------- şube */

    /// <summary>Şube kodu ve depo numarası → şube adı.</summary>
    private static Dictionary<string, string> _subeAdlari;
    private static DateTime _subeZamani;

    /// <summary>
    /// Şube adları.
    ///
    /// <para>
    /// Puan hareketinde yalnızca kasa tarafının şube numarası duruyor;
    /// personele "12" yazmak hangi mağazada harcadığını söylemiyordu.
    /// Numara, Biçen360'taki şube–depo eşleşmesinden ada çevriliyor.
    /// </para>
    ///
    /// <para>
    /// Yarım saat bellekte tutuluyor: liste neredeyse hiç değişmiyor ve
    /// her hareket listesinde yeniden sorgulamak boşuna.
    /// </para>
    /// </summary>
    private Dictionary<string, string> SubeAdlari()
    {
        if (_subeAdlari is not null
            && (DateTime.UtcNow - _subeZamani).TotalMinutes < 30)
            return _subeAdlari;

        var harita = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.Baglanti();

            var kayitlar = db.Query(@"
SELECT sube_kodu AS kod, sube_adi AS ad, depo_no AS depo
FROM B360_SUBE_DEPO", commandTimeout: 30).ToList();

            foreach (var x in kayitlar)
            {
                var ad = ((string)x.ad ?? "").Trim();

                if (ad.Length == 0) continue;

                var kod = ((string)x.kod ?? "").Trim();

                if (kod.Length > 0) harita[kod] = ad;

                /* Depo numarası da anahtar: kasa tarafı hangisini yazıyorsa
                   ikisi de tutsun. */
                if (x.depo is not null)
                    harita[Convert.ToString(x.depo)] = ad;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şube adları okunamadı");
        }

        _subeAdlari = harita;
        _subeZamani = DateTime.UtcNow;

        return harita;
    }

    /// <summary>
    /// Hareketteki şube değerini okunabilir ada çevirir.
    ///
    /// Değer zaten ad ise dokunulmuyor; eşleşme bulunamayan numara
    /// "Şube 12" gibi gösteriliyor — numarayı gizlemek, İK'nın kaydı
    /// bulmasını zorlaştırırdı.
    /// </summary>
    /// <summary>Panel için: hareketteki şube değerinin okunabilir adı.</summary>
    public string SubeAdiBul(object deger) => SubeAdi(deger);

    private string SubeAdi(object deger)
    {
        var ham = Convert.ToString(deger)?.Trim();

        if (string.IsNullOrWhiteSpace(ham)) return null;

        if (SubeAdlari().TryGetValue(ham, out var ad)) return ad;

        return ham.All(char.IsDigit) ? $"Şube {ham}" : ham;
    }

    /// <summary>
    /// Kart hareketleri.
    ///
    /// <para>
    /// Tabloyu biz oluşturmadığımız için sütun adları çalışma anında
    /// bulunuyor ve sorgu ona göre kuruluyor. Sabit sütun adı yazmak,
    /// tablo farklıysa bütün listeyi sessizce boş bırakıyordu.
    /// </para>
    /// </summary>
    public List<dynamic> Hareketler(string kartNo, int adet = 20)
    {
        try
        {
            using var db = _vt.PosBaglantisi();

            string Bul(params string[] adaylar) => HareketSutunu(db, adaylar);

            var tarih = Bul("Tarih", "IslemTarihi", "KayitTarihi", "Zaman");
            var tutar = Bul("Puan", "Tutar", "PuanTutar", "Miktar");
            var tip = Bul("IslemTipi", "Tip");
            var sube = Bul("SubeAdi", "Sube", "SubeKodu", "SubeId", "Magaza");

            if (tarih is null || tutar is null) return new List<dynamic>();

            /* EksiPuan: harcama satırlarında tutarın burada tutulduğu
               durumlar var. İkisinden dolu olanı kullanılıyor; yalnızca
               Puan'a bakmak harcamaları sıfır gösteriyordu. */
            var eksi = Bul("EksiPuan");

            var alanlar = $"[{tarih}] AS tarih, [{tutar}] AS tutar"
                + (eksi is null ? ", NULL AS eksi" : $", [{eksi}] AS eksi")
                + (tip is null ? ", NULL AS tip" : $", [{tip}] AS tip")
                + (sube is null ? ", NULL AS subeAdi" : $", [{sube}] AS subeAdi");

            var ham = db.Query($@"
SELECT TOP (@adet) {alanlar}
FROM [PosbackPromosyon].[dbo].[PuanHareket]
WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)
ORDER BY [{tarih}] DESC", new { kartNo, adet }, commandTimeout: 30).ToList();

            /* Tutar tabloda işaretsiz duruyor; yön işlem tipinden
               geliyor. İşaret koymadan listede kazanma ile harcama
               birbirinden ayırt edilmiyordu. */
            return ham.Select(x =>
            {
                var t = x.tip is null ? 0 : Convert.ToInt32(x.tip);

                var d = x.tutar is null ? 0m : Convert.ToDecimal(x.tutar);
                var e = x.eksi is null ? 0m : Convert.ToDecimal(x.eksi);

                /* Harcamada EksiPuan, kazanımda Puan esas alınıyor;
                   ikisi de dolu olabildiği için sıra önemli. */
                d = t == 6
                    ? d /* silmede tutar Puan'da; bakiye de onu düşüyor */
                    : Dusuyor(t)
                        ? (e != 0m ? e : d)
                        : (d != 0m ? d : e);

                return (dynamic)new
                {
                    tarih = x.tarih,
                    subeAdi = SubeAdi(x.subeAdi),
                    tip = t,
                    aciklama = IslemAdi(t),
                    tutar = Dusuyor(t) ? -Math.Abs(d) : Math.Abs(d),
                };
            }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart hareketleri okunamadı");

            return new List<dynamic>();
        }
    }
}

/// <summary>Personelin gift kartı.</summary>
public class GiftKart
{
    public string KartNo { get; set; }
    public string Ad { get; set; }
    public decimal Bakiye { get; set; }

    /// <summary>GrupNo 608 ise mobil kart; null ise fiziki kart.</summary>
    public bool MobilKart { get; set; }

    public bool SifreVar { get; set; }

    /// <summary>Bakiye sütunu bulunabildi mi; bulunamazsa ekranda uyarı.</summary>
    public bool BakiyeOkunabildi { get; set; }
}

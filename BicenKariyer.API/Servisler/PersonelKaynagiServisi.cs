using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mikro'dan personel listesini okuyan ve şube/pozisyon adı karşılaştırma
/// mantığını barındıran tek kaynak.
///
/// <para>
/// Daha önce bu kod yalnızca <c>PersonelController</c> içindeydi.
/// Norm kadro ekranının "mevcut" senkronu da (bkz. <c>HavuzController</c>)
/// artık aynı veriyi ve aynı eşleştirme mantığını kullanıyor — böylece
/// Personeller sayfasında görünen sayı ile norm kadrodaki "mevcut" hiçbir
/// zaman ayrı kaynaklardan gelip birbirinden sapmaz.
/// </para>
///
/// <para>
/// <c>PersonelController</c>'daki özel roller (Bölge Müdürü şube kısıtı,
/// fotoğraf-yalnızca rolü) bu sınıfın dışında, çağıran controller'da
/// uygulanmaya devam ediyor; bu sınıf yalnızca ham, kısıtlanmamış listeyi
/// döndürür.
/// </para>
/// </summary>
public class PersonelKaynagiServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<PersonelKaynagiServisi> _kayit;

    public PersonelKaynagiServisi(VeritabaniServisi vt, ILogger<PersonelKaynagiServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Ham personel listesi                                                  */
    /* ==================================================================== */

    /* -------------------------------------------------------------------- */
    /* Önbellek (03.10.2026)                                                 */
    /*                                                                      */
    /* Liste her istekte Mikro'dan baştan okunuyordu: kolon denetimleri,     */
    /* bütün PERSONELLER tablosu ve fotoğraf tablosuyla birleşim. Biçen360'ın */
    /* hemen her ucu kişiyi bu listeden bulduğu için uygulamadaki her ekran  */
    /* bu okumayı bekliyordu. Liste artık 90 saniye bellekte tutuluyor;      */
    /* süresi geçmişse eskisi hemen verilip arkada yenileniyor (10 dakikaya */
    /* kadar). Panelden Mikro'ya yazılan değişiklikler önbelleği siliyor.   */
    /*                                                                      */
    /* Çağıranlara her seferinde kopya veriliyor: bazı uçlar listedeki      */
    /* kayıtları yerinde değiştiriyor (rol maskelemesi kimlik numarasını    */
    /* siliyor); paylaşılan kayıt bozulsa herkese maskeli veri giderdi.    */
    /* -------------------------------------------------------------------- */

    private static readonly object OnbellekKilidi = new();
    private static List<PersonelKaydi> _onbellek;
    private static DateTime _onbellekZamani;
    private static int _arkadaYenileniyor;

    private static readonly TimeSpan TazeSure = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan EnUzunSure = TimeSpan.FromMinutes(10);

    /// <summary>Önbelleği siler; bir sonraki istek Mikro'dan okur.</summary>
    public static void OnbellegiTemizle()
    {
        lock (OnbellekKilidi)
        {
            _onbellek = null;
        }
    }

    private static HashSet<string> _sonResimliKodlar;

    /// <summary>Fotoğrafı olan personel kodları; okunamazsa son başarılı küme (o da yoksa null).</summary>
    private HashSet<string> ResimliKodlar()
    {
        try
        {
            using var db = _vt.PersonelBaglantisi();

            var kume = new HashSet<string>(
                db.Query<string>(@"
SELECT LTRIM(RTRIM(P.per_kod))
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P WITH (NOLOCK)
WHERE EXISTS (SELECT 1 FROM [MikroDesktop_2004BICEN].dbo.mye_ImageData I WITH (NOLOCK)
              WHERE I.Record_uid = P.per_Guid)", commandTimeout: 180)
                  .Where(x => !string.IsNullOrWhiteSpace(x)),
                StringComparer.OrdinalIgnoreCase);

            _sonResimliKodlar = kume;

            return kume;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fotoğraf listesi alınamadı; son başarılı liste kullanılıyor");

            return _sonResimliKodlar;
        }
    }

    private List<PersonelKaydi> Kopyala(List<PersonelKaydi> liste)
    {
        var kopya = liste.Select(x => x.Kopya()).ToList();
        KidemIsle(kopya);
        return kopya;
    }

    /* ------------------------------------------------------------------ */
    /* Kıdem (05.10.2026)                                                   */
    /* ------------------------------------------------------------------ */

    /* Hak ediş düzeltmeleri (KRY_IZIN_HAKEDIS) ayrı ve kısa süre bellekte:
       personel önbelleği Mikro'dan saniyeler süren bir okuma; bir
       düzeltme kaydedildiğinde onu yenilemek yerine yalnızca bu harita
       silinir (KidemiUnut). */
    private static (DateTime zaman, Dictionary<string, (DateTime Tarih, string Kaynak)> harita)? _hakedis;
    private static readonly object _hakedisKilidi = new();

    /// <summary>Hak ediş düzeltmesi yazıldığında ya da silindiğinde çağrılır.</summary>
    public static void KidemiUnut()
    {
        lock (_hakedisKilidi) _hakedis = null;
    }

    private Dictionary<string, (DateTime Tarih, string Kaynak)> HakedisHaritasi()
    {
        lock (_hakedisKilidi)
        {
            if (_hakedis is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60))
                return b.harita;
        }

        var harita = new Dictionary<string, (DateTime, string)>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var db = _vt.Baglanti();

            IEnumerable<dynamic> satirlar;

            try
            {
                satirlar = db.Query("SELECT personel_kodu AS kod, hakedis_tarihi AS tarih, kaynak FROM KRY_IZIN_HAKEDIS");
            }
            catch (Microsoft.Data.SqlClient.SqlException)
            {
                /* kaynak sütunu henüz yoksa */
                satirlar = db.Query("SELECT personel_kodu AS kod, hakedis_tarihi AS tarih, CAST(NULL AS NVARCHAR(10)) AS kaynak FROM KRY_IZIN_HAKEDIS");
            }

            foreach (var x in satirlar)
                if (x.tarih is DateTime t && !string.IsNullOrWhiteSpace((string)x.kod))
                    harita[((string)x.kod).Trim()] = (t.Date,
                        string.IsNullOrWhiteSpace((string)x.kaynak) ? "elle" : ((string)x.kaynak).Trim());
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Hak ediş düzeltmeleri okunamadı; kıdem işe girişten");
        }

        lock (_hakedisKilidi) _hakedis = (DateTime.UtcNow, harita);

        return harita;
    }

    /// <summary>
    /// Kıdem esas tarihi ve toplam kıdem. Ayrılıp tekrar giren personelde
    /// Mikro kartı yalnızca son girişi biliyor (kartta 4 yıl görünüyordu,
    /// gerçek kıdem 14 yıl); hak ediş düzeltmesi bütün çalışmaları içeriyor.
    /// </summary>
    private void KidemIsle(List<PersonelKaydi> liste)
    {
        var harita = HakedisHaritasi();

        foreach (var kisi in liste)
        {
            var kod = (kisi.PersonelKodu ?? "").Trim();

            if (kod.Length > 0 && harita.TryGetValue(kod, out var h))
            {
                kisi.KidemTarihi = h.Tarih;
                kisi.KidemKaynak = h.Kaynak;
            }
            else
            {
                kisi.KidemTarihi = kisi.GirisTarihi?.Date;
                kisi.KidemKaynak = null;
            }

            if (kisi.KidemTarihi is not DateTime esas)
            {
                kisi.KidemGunu = kisi.CalismaGunu;
                continue;
            }

            var bitis = kisi.Durum == 1 ? DateTime.Today : kisi.CikisTarihi?.Date ?? DateTime.Today;

            kisi.KidemGunu = Math.Max(kisi.CalismaGunu, Math.Max(0, (bitis - esas).Days));
        }
    }

    /// <summary>
    /// Personel kayıtlarını Mikro'dan okur ve en güncel çalışma kaydını alır.
    /// Rol bazlı kısıtlama (ör. Bölge Müdürü) uygulanmaz — çağıran taraf
    /// gerekirse kendi yetki filtresini bu listenin üzerine uygular.
    /// Önbellekten gelir (yukarıdaki not).
    /// </summary>
    public List<PersonelKaydi> TumPersonelleriGetir()
    {
        var liste = _onbellek;
        var yas = DateTime.UtcNow - _onbellekZamani;

        if (liste is not null && yas < TazeSure) return Kopyala(liste);

        /* Süresi geçmiş ama çok eski değil: bekletmeden ver, arkada yenile */
        if (liste is not null && yas < EnUzunSure)
        {
            if (Interlocked.CompareExchange(ref _arkadaYenileniyor, 1, 0) == 0)
            {
                var vt = _vt;
                var kayit = _kayit;

                _ = Task.Run(() =>
                {
                    try
                    {
                        var yeni = new PersonelKaynagiServisi(vt, kayit).MikrodanOku();

                        lock (OnbellekKilidi)
                        {
                            _onbellek = yeni;
                            _onbellekZamani = DateTime.UtcNow;
                        }
                    }
                    catch (Exception hata)
                    {
                        kayit.LogWarning(hata, "Personel önbelleği arkada yenilenemedi");
                    }
                    finally
                    {
                        Interlocked.Exchange(ref _arkadaYenileniyor, 0);
                    }
                });
            }

            return Kopyala(liste);
        }

        /* Önbellek boş ya da çok eski: aynı anda gelen istekler tek okuma
           bekler, her biri ayrı ayrı Mikro'ya gitmez. */
        lock (OnbellekKilidi)
        {
            if (_onbellek is not null && DateTime.UtcNow - _onbellekZamani < TazeSure)
                return Kopyala(_onbellek);

            var yeni = MikrodanOku();

            _onbellek = yeni;
            _onbellekZamani = DateTime.UtcNow;

            return Kopyala(yeni);
        }
    }

    /// <summary>Mikro'dan doğrudan okuma (önbelleksiz).</summary>
    private List<PersonelKaydi> MikrodanOku()
    {
        List<PersonelKaydi> ham;

        {
            using var db = _vt.PersonelBaglantisi();

            /* Çıkış sebebi per_cikis_neden kolonunda tutulur. Kolon farklı
               adlandırılmışsa benzer adlar taranarak bulunur. */
            var sebepKolonu = db.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND (name = 'per_cikis_neden' OR name LIKE '%cikis%neden%'
       OR name LIKE '%ayril%neden%' OR name LIKE '%cikis%sebep%')
ORDER BY CASE WHEN name = 'per_cikis_neden' THEN 0 ELSE 1 END, name");

            var sebepSecimi = string.IsNullOrWhiteSpace(sebepKolonu)
                ? "CAST(NULL AS NVARCHAR(200))"
                : $"CAST(P.[{sebepKolonu}] AS NVARCHAR(200))";

            /* Ücret per_ucret kolonundan okunur. Kolon bulunamazsa
               (farklı sürüm) alan boş geçilir, liste yine de çalışır. */
            var ucretVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND name = 'per_ucret'") > 0;

            var ucretSecimi = ucretVar
                ? "CAST(P.per_ucret AS DECIMAL(18,2))"
                : "CAST(NULL AS DECIMAL(18,2))";

            /* Çıkış nedeni bir kod olabilir; tanım tablosu varsa açıklaması
               kullanılır. Tablo bulunamazsa kodun kendisi gösterilir. */
            var sebepTablosu = db.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM [MikroDesktop_2004BICEN].sys.tables
WHERE name LIKE '%CIKIS%NEDEN%' OR name LIKE '%AYRIL%NEDEN%'
ORDER BY name");

            var sebepKatilim = "";

            if (!string.IsNullOrWhiteSpace(sebepTablosu) &&
                !string.IsNullOrWhiteSpace(sebepKolonu))
            {
                var kodKolonu = db.ExecuteScalar<string>($@"
SELECT TOP 1 c.name FROM [MikroDesktop_2004BICEN].sys.columns c
JOIN [MikroDesktop_2004BICEN].sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.{sebepTablosu}')
  AND t.name IN ('int', 'smallint', 'tinyint')
ORDER BY c.column_id");

                var adKolonu = db.ExecuteScalar<string>($@"
SELECT TOP 1 c.name FROM [MikroDesktop_2004BICEN].sys.columns c
JOIN [MikroDesktop_2004BICEN].sys.types t ON t.user_type_id = c.user_type_id
WHERE c.object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.{sebepTablosu}')
  AND t.name IN ('nvarchar', 'varchar', 'nchar', 'char')
ORDER BY c.max_length DESC");

                if (!string.IsNullOrWhiteSpace(kodKolonu) && !string.IsNullOrWhiteSpace(adKolonu))
                {
                    sebepKatilim =
                        $"LEFT JOIN [MikroDesktop_2004BICEN].dbo.[{sebepTablosu}] CN " +
                        $"ON CN.[{kodKolonu}] = P.[{sebepKolonu}]";

                    sebepSecimi =
                        $"ISNULL(CAST(CN.[{adKolonu}] AS NVARCHAR(200)), " +
                        $"CAST(P.[{sebepKolonu}] AS NVARCHAR(200)))";
                }
            }

            /* Ünvan per_kim_meslek kolonundan okunur. Ünvan tanım
               tablosundaki (PERSONEL_UNVAN_TANIMLARI) karşılık, "Part time"
               gibi çalışma biçimi ayrımlarını taşımıyor; meslek alanı
               taşıyor. Kolon bulunamazsa eski ünvan tanımına düşülür. */
            var meslekVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND name = 'per_kim_meslek'") > 0;

            var pozisyonSecimi = meslekVar
                ? "NULLIF(LTRIM(RTRIM(CAST(P.per_kim_meslek AS NVARCHAR(200)))), '')"
                : "NULL";

            /* Engellilik derecesi: 0 sağlam, 0'dan büyük her değer engelli
               kadrosu sayılır. Kolon yoksa herkes sağlam kabul edilir. */
            var sakatVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND name = 'per_kim_sakat_derece'") > 0;

            var sakatSecimi = sakatVar
                ? "ISNULL(CAST(P.per_kim_sakat_derece AS INT), 0)"
                : "0";

            /* Mikro'nun kendi denetim kolonları. Alan bazlı geçmiş
               tutmuyor ama son değiştiren kullanıcıyı tutuyor; değişikliği
               kime bağlayacağımızı buradan öğreniyoruz. Kolon adları
               sürüme göre değişebildiği için varlığı denetlenir. */
            var denetim = db.Query<string>(@"
SELECT name FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND name IN ('per_lastup_user', 'per_lastup_date',
               'per_create_user', 'per_create_date')")
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var sonKullanici = denetim.Contains("per_lastup_user")
                ? "CAST(P.per_lastup_user AS NVARCHAR(60))"
                : "NULL";

            var sonTarih = denetim.Contains("per_lastup_date")
                ? "P.per_lastup_date"
                : "NULL";

            /* Personel bilgileri Mikro veritabanından okunur.
               Bu kaynakta ayrı bir durum alanı yoktur; personelin çalışıp
               çalışmadığı çıkış tarihinden anlaşılır. */
            ham = db.Query<PersonelKaydi>($@"
SELECT
    LTRIM(RTRIM(P.per_kod)) AS PersonelKodu,
    P.per_adi           AS Ad,
    P.per_soyadi        AS Soyad,
    P.per_tel_cepno     AS Telefon,
    P.Per_TcKimlikNo    AS KimlikNo,
    P.per_giris_tar     AS GirisTarihi,
    P.per_cikis_tar     AS CikisTarihi,
    /* LEFT JOIN sonrası boş kalabilir; ekranda boşluk yerine açıklama */
    ISNULL(PIG.ig_adi, N'Belirtilmemiş')  AS IsGrubu,
    /* Ünvan önce personel kartındaki meslek alanından (per_kim_meslek),
       boşsa ünvan tanım tablosundan. Sıra bir süre tersine çevrilmişti;
       ada göre kurulmuş eşleşmeler (gruplar, izin onay tablosu, şema)
       bozulduğu için geri alındı. */
    ISNULL(ISNULL({pozisyonSecimi}, PUT.un_aciklama), N'Belirtilmemiş') AS Pozisyon,
    P.per_Guid          AS Guid,
    {sebepSecimi}       AS CikisSebebi,
    {ucretSecimi}       AS Ucret,
    {sakatSecimi}       AS SakatDerece,
    {sonKullanici}      AS SonDegistiren,
    {sonTarih}          AS SonDegisiklik
/* LEFT JOIN: iş grubu ya da ünvan kodu tanım tablolarında bulunmayan
   personel listeden tamamen düşüyordu. Eski ve ayrılmış kayıtlarda bu
   sık görülüyor; kişi kaybolmaktansa alanı boş gelsin. */
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
    {sebepKatilim}",
                commandTimeout: 120).ToList();
        }

        /* Mikro'da boş tarihler 1900 öncesi değerlerle tutulabilir;
           gerçek bir çıkış tarihi yoksa personel çalışıyor sayılır. */
        static bool GercekTarih(DateTime? tarih) =>
            tarih.HasValue && tarih.Value.Year > 1950;

        foreach (var kisi in ham)
        {
            if (!GercekTarih(kisi.GirisTarihi)) kisi.GirisTarihi = null;
            if (!GercekTarih(kisi.CikisTarihi)) kisi.CikisTarihi = null;

            /* İhbar süresi başlayan personelin çıkış tarihine ileri bir gün
               yazılıyor. Bu kişi hâlâ işe geliyor, hâlâ vardiya açıyor ve
               norm kadroda yeri duruyor — çıkış tarihi dolu diye "ayrılmış"
               saymak listede, raporlarda ve mevcut sayımında onu yok
               ediyordu. Çıkış günü gelene kadar çalışıyor sayılıyor. */
            kisi.Ayrilacak = kisi.CikisTarihi is DateTime c && c.Date > DateTime.Today;

            kisi.Durum = kisi.CikisTarihi is null || kisi.Ayrilacak ? 1 : 0;
            kisi.Sube = kisi.IsGrubu;

            /* Mikro kullanıcı numarası yerine adı (07.10.2026: "Yapan: 130") */
            if (!string.IsNullOrWhiteSpace(kisi.SonDegistiren))
                kisi.SonDegistiren = MikroKullanicilari.Ad(kisi.SonDegistiren);
        }

        /* Fotoğrafı olan personel kodları tek sorguda alınır; görsellerin
           kendisi çekilmez, yalnızca varlığı işaretlenir. */
        var resimSurumleri = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var yerel = _vt.Baglanti();

            var yuklemeler = yerel.Query(@"
SELECT personel_kodu AS Kod, MAX(olusturma) AS Zaman
FROM KRY_RESIM_YEDEK
WHERE geri_alindi = 0 AND personel_kodu IS NOT NULL
GROUP BY personel_kodu");

            foreach (var y in yuklemeler)
            {
                var kod = ((string)y.Kod)?.Trim();

                if (!string.IsNullOrWhiteSpace(kod))
                    resimSurumleri[kod] = ((DateTime)y.Zaman).Ticks;
            }
        }
        catch
        {
            /* Sürüm bilgisi alınamazsa liste yine çalışır */
        }

        /* Fotoğrafı olan personel (05.10.2026): sorgu EXISTS ile ve uzun
           zaman aşımıyla; görsel tablosu büyüdükçe JOIN + DISTINCT 30
           saniyeyi aşıyor, hata yakalanıp küme boş kalıyordu ve herkes
           "fotoğrafsız" sayılıyordu — patron görünümünde hiçbir fotoğraf
           adresi üretilmiyordu. Okunamazsa son başarılı küme kullanılıyor;
           hiç yoksa herkes "var" sayılıyor (uygulama fotoğraf gelmezse baş
           harfe düşüyor, boş göstermekten iyi). */
        var resimliKodlar = ResimliKodlar();

        foreach (var kisi in ham)
        {
            kisi.ResimVar = !string.IsNullOrWhiteSpace(kisi.PersonelKodu) &&
                            (resimliKodlar is null || resimliKodlar.Contains(kisi.PersonelKodu.Trim()));

            if (!string.IsNullOrWhiteSpace(kisi.PersonelKodu) &&
                resimSurumleri.TryGetValue(kisi.PersonelKodu.Trim(), out var surum))
            {
                kisi.ResimSurumu = surum;
            }
        }

        /* Aynı kişi birden çok kez işe alınmış olabilir; kimlik numarasına
           göre kaç kaydı olduğu sayılır. */
        var kimlikSayaci = ham
            .Where(x => !string.IsNullOrWhiteSpace(x.KimlikNo))
            .GroupBy(x => x.KimlikNo.Trim())
            .ToDictionary(g => g.Key, g => g.Select(x => x.PersonelKodu).Distinct().Count());

        /* Aynı personelin birden çok çalışma kaydı varsa en yenisi alınır */
        var personeller = ham
            .GroupBy(x => string.IsNullOrWhiteSpace(x.PersonelKodu)
                ? x.PersonId.ToString()
                : x.PersonelKodu)
            .Select(g => g
                .OrderByDescending(x => x.GirisTarihi ?? DateTime.MinValue)
                .First())
            .ToList();

        /* Çalışma süresi hesaplanır */
        foreach (var kisi in personeller)
        {
            if (kisi.GirisTarihi is null) continue;

            var bitis = kisi.Durum == 1
                ? DateTime.Today
                : kisi.CikisTarihi ?? DateTime.Today;

            kisi.CalismaGunu = Math.Max(0, (bitis - kisi.GirisTarihi.Value).Days);
        }

        foreach (var kisi in personeller)
        {
            kisi.CalismaSayisi =
                !string.IsNullOrWhiteSpace(kisi.KimlikNo) &&
                kimlikSayaci.TryGetValue(kisi.KimlikNo.Trim(), out var adet)
                    ? adet
                    : 1;
        }

        return personeller;
    }

    /* ==================================================================== */
    /* Birim ve pozisyon eşleştirme                                          */
    /* ==================================================================== */

    private static readonly string[] BirimEkleri =
        { "SUBESI", "ŞUBESI", "SUBE", "ŞUBE", "MAGAZASI", "MAĞAZASI" };

    /// <summary>
    /// Ad karşılaştırmasında yok sayılan çalışma biçimi ekleri.
    /// "Müdür Yardımcısı VKL" ile "Müdür Yardımcısı" aynı pozisyondur.
    /// </summary>
    private static readonly string[] MeslekEkleri =
        { "PART", "TIME", "TAM", "ZAMANLI", "VKL", "VEKIL", "GECICI" };

    /// <summary>
    /// Yalnızca YARI ZAMANLI çalışmayı belirten ekler.
    ///
    /// <para>
    /// Bu liste <see cref="MeslekEkleri"/>'nden ayrıdır ve ondan çok daha
    /// dardır: orası ad karşılaştırmasında yok sayılacak ekleri tutar
    /// (VKL, GEÇİCİ, TAM gibi), burası ise kadronun yarım sayılmasına yol
    /// açan ekleri. Vekil ya da geçici görevli tam kadrodur; ikisi aynı
    /// listeden okunursa "Müdür Yardımcısı VKL" yanlışlıkla 0,5 sayılır.
    /// </para>
    /// </summary>
    private static readonly string[] YarimKadroEkleri =
        { "PART", "YARIM", "YARI" };

    /// <summary>Türkçe karşılaştırma için metni sadeleştirir</summary>
    public static string Sadelestir(string metin)
    {
        var ham = new string((metin ?? "")
            .ToUpper(new System.Globalization.CultureInfo("tr-TR"))
            .Replace('İ', 'I')
            .Select(k => char.IsLetterOrDigit(k) ? k : ' ')
            .ToArray());

        return string.Join(" ",
            ham.Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    /// <summary>"Sefaköy Şubesi" ile "SEFAKÖY" eşleşsin diye ekleri atar</summary>
    public static string BirimAnahtari(string metin)
    {
        var kelimeler = Sadelestir(metin)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(k => !BirimEkleri.Contains(k));

        return string.Join(" ", kelimeler);
    }

    /// <summary>
    /// Arama anahtarı: küçük harf, Türkçe harfler ASCII karşılığıyla, boşluk
    /// ve noktalama yok ("BÖLGE MÜDÜRÜ" → "bolgemuduru", "Z.MERKEZ BURO" →
    /// "zmerkezburo"). "İçinde geçiyor mu" denetimleri için.
    ///
    /// <para>
    /// <see cref="MeslekAnahtari"/> büyük harf ve Türkçe harfleri koruyor;
    /// onun sonucunda <c>Contains("bolgemudur")</c> hiçbir zaman tutmuyordu
    /// (04.10.2026: mağaza müdürünün izni bölge müdürüne değil doğrudan
    /// İK'ya düşüyordu).
    /// </para>
    /// </summary>
    public static string DuzAnahtar(string metin)
    {
        var sb = new System.Text.StringBuilder((metin ?? "").Length);

        foreach (var h in (metin ?? "").ToLower(new System.Globalization.CultureInfo("tr-TR")))
        {
            var c = h switch
            {
                'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'i' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
                'â' => 'a', 'î' => 'i', 'û' => 'u',
                _ => h
            };

            if (char.IsLetterOrDigit(c)) sb.Append(c);
        }

        /* "i̇" gibi birleşik nokta kalıntıları harf değil, yukarıda atıldı */
        return sb.ToString();
    }

    /// <summary>Pozisyon adı bölge müdürü mü ("BÖLGE MÜDÜRÜ", "Bölge Md.", "BÖLGE MÜDÜRÜ VKL")</summary>
    public static bool BolgeMuduruPozisyonu(string pozisyon)
    {
        var a = DuzAnahtar(pozisyon);

        return a.Contains("bolgemudur") || a.Contains("bolgemd");
    }

    /// <summary>Meslek adındaki çalışma biçimi eklerini ayıklar</summary>
    public static string MeslekAnahtari(string metin)
    {
        var kelimeler = Sadelestir(metin)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(k => !MeslekEkleri.Contains(k));

        return string.Join(" ", kelimeler);
    }

    /// <summary>
    /// Metinde yarı zamanlı çalışmayı belirten bir ek var mı ("Part time",
    /// "Yarım gün"). Norm kadroda hem satır ayrımı ("Kasiyer" ile "Part
    /// time Kasiyer") hem de kadronun yarım sayılması bu sonuca bakar.
    ///
    /// <para>
    /// Vekil (VKL), geçici ve tam zamanlı ekleri buraya DAHİL DEĞİLDİR:
    /// bunlar tam kadrodur, yalnızca ad karşılaştırmasında yok sayılır.
    /// </para>
    /// </summary>
    public static bool CalismaBicimiIceriyor(string metin) =>
        Sadelestir(metin)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Any(k => YarimKadroEkleri.Contains(k));

    /// <summary>
    /// Ünvanda engelli çalışan ibaresi var mı. Engelli kadrolar norm
    /// kadroda yarım sayılır (bkz. HavuzController).
    ///
    /// <para>
    /// Bu sözcük <see cref="MeslekAnahtari"/> tarafından ayıklanmaz:
    /// "Part Engelli" gibi tek başına bir bölüm adı, hem "Part" hem
    /// "Engelli" atılırsa boş anahtara inip hiçbir şeyle eşleşemezdi.
    /// </para>
    /// </summary>
    public static bool EngelliIceriyor(string metin) =>
        Sadelestir(metin)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Any(k => k is "ENGELLI");

    /// <summary>Bir birim anahtarının sonundaki numarayı döndürür, yoksa null.
    /// "AVCILAR 2" → "2". Numaralı şube serilerini ayırt etmek için.</summary>
    private static string SonSayi(string anahtar)
    {
        /* Sondaki numara boşlukla da tireyle de yazılabiliyor: "SİLİVRİ 2",
           "SİLİVRİ-2", "SİLİVRİ2". Önceden yalnızca boşluğa bakılıyordu;
           "SİLİVRİ-2" numarasız sayılıp "SİLİVRİ" ile aynı şube kabul
           ediliyordu (29.09.2026). */
        var m = System.Text.RegularExpressions.Regex.Match(anahtar ?? "", @"(\d+)\s*$");

        return m.Success ? m.Groups[1].Value.TrimStart('0') : null;
    }

    /// <summary>
    /// Ünvan karşılaştırması. Yalnızca aynı pozisyonlar eşleşir.
    ///
    /// Burada gevşek kural kullanılamaz: "Kasa Şefi" ile "Manav Şefi"
    /// ortak "Şefi" kelimesi yüzünden birbirine karışırdı. Bu yüzden
    /// çalışma biçimi ekleri ayıklandıktan sonra kelimelerin tamamının
    /// aynı olması aranır.
    /// </summary>
    public static bool UnvanBenziyor(string birinci, string ikinci)
    {
        if (string.IsNullOrWhiteSpace(birinci) || string.IsNullOrWhiteSpace(ikinci))
            return false;

        if (birinci == ikinci) return true;

        var birinciler = birinci.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var ikinciler = ikinci.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return birinciler.Length == ikinciler.Length &&
               birinciler.OrderBy(x => x).SequenceEqual(ikinciler.OrderBy(x => x));
    }

    /// <summary>
    /// Birim adı karşılaştırması. Birim adlarında ek sözcükler bulunabildiği
    /// için ("Genel Müdürlük" ile "GENEL MÜDÜRLÜK BÜRO") daha esnek çalışır.
    /// </summary>
    public static bool Benziyor(string birinci, string ikinci)
    {
        if (string.IsNullOrWhiteSpace(birinci) || string.IsNullOrWhiteSpace(ikinci))
            return false;

        if (birinci == ikinci) return true;

        /* 'Avcılar-1', 'Avcılar-2', 'Avcılar-3' gibi numaralı şube
           serilerinde sondaki numara birimi ayırt eder. Kelime benzerliği
           bu numarayı görmezden gelirse ("AVCILAR" ortak kelimesi
           yüzünden) üç ayrı şube birbirine karışır. Sondaki numaralar
           farklıysa, ya da yalnızca birinde numara varsa, aşağıdaki hiçbir
           kural çalışmadan direkt eşleşmez sayılır. */
        var sayi1 = SonSayi(birinci);
        var sayi2 = SonSayi(ikinci);
        if (sayi1 != sayi2) return false;

        if (birinci.Length > 2 && ikinci.StartsWith(birinci)) return true;
        if (ikinci.Length > 2 && birinci.StartsWith(ikinci)) return true;

        /* Ortak anlamlı kelimeler: en az bir tanesi 4 harften uzun olmalı */
        var birinciler = birinci.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var ikinciler = ikinci.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        var ortak = birinciler.Intersect(ikinciler).Where(k => k.Length >= 4).ToList();

        if (ortak.Count == 0) return false;

        /* Kısa taraf tamamen kapsanıyorsa eşleşmiş sayılır */
        var kisa = birinciler.Length <= ikinciler.Length ? birinciler : ikinciler;
        var uzun = birinciler.Length <= ikinciler.Length ? ikinciler : birinciler;

        return kisa.Count(k => uzun.Contains(k)) >= Math.Max(1, kisa.Length - 1);
    }

    /// <summary>
    /// Bir Mikro iş grubu adının verilen şubeye karşılık gelip gelmediğini
    /// denetler. Ayarlar → Personel Eşleştirmeleri altındaki elle tanımlı
    /// eşleşmeler önceliklidir; oradaki "Hedef" alanı panelde şube KODU
    /// olarak kaydedilir (Personeller.tsx İş Grubu → Birim sekmesi), bu
    /// yüzden önce koda göre birebir karşılaştırılır. Kod verilmemişse ya
    /// da eşleşme yoksa şube adına göre ad benzerliğine bakılır.
    /// </summary>
    public static bool SubeUyuyor(
        PersonelAyarlari ayar, string isGrubu, string subeAdi, string subeKodu = null)
    {
        var esleme = (ayar?.IsGrubuEslemeleri ?? new List<AdEslemesi>())
            .FirstOrDefault(e => Benziyor(BirimAnahtari(e.Kaynak), BirimAnahtari(isGrubu)));

        if (esleme is not null)
        {
            if (!string.IsNullOrWhiteSpace(subeKodu) &&
                string.Equals(esleme.Hedef, subeKodu, StringComparison.OrdinalIgnoreCase))
                return true;

            return Benziyor(BirimAnahtari(esleme.Hedef), BirimAnahtari(subeAdi))
                || string.Equals(esleme.Hedef, subeAdi, StringComparison.OrdinalIgnoreCase);
        }

        return Benziyor(BirimAnahtari(isGrubu), BirimAnahtari(subeAdi));
    }

    /// <summary>
    /// Bir Mikro ünvanının verilen norm kadro bölümüne karşılık gelip
    /// gelmediğini, Ayarlar → Personel Eşleştirmeleri altındaki elle
    /// tanımlı eşleşmeleri önceliklendirerek denetler.
    /// </summary>
    public static bool PozisyonUyuyor(PersonelAyarlari ayar, string mikroPozisyon, string bolum)
    {
        var karsilik = UnvanKarsiligi(ayar, mikroPozisyon);

        if (!UnvanBenziyor(MeslekAnahtari(karsilik), MeslekAnahtari(bolum)))
            return false;

        return CalismaBicimiIceriyor(karsilik) == CalismaBicimiIceriyor(bolum);
    }

    /// <summary>
    /// Bir ünvanın Ayarlar → Personel Eşleştirmeleri'ndeki karşılığını
    /// döndürür; tanımlı eşleşme yoksa ünvanın kendisini verir.
    ///
    /// <para>
    /// Eşleşme aranırken çalışma biçimi eki de gözetilir. Aksi hâlde
    /// <see cref="MeslekAnahtari"/> "PART" ekini ayıkladığı için düz
    /// "KASİYER" ünvanlı bir personel, listede daha önce gelen
    /// "KASİYER PART → Part time Kasiyer" kuralına takılıp yanlış
    /// bölüme yönlendirilirdi.
    /// </para>
    /// </summary>
    public static string UnvanKarsiligi(PersonelAyarlari ayar, string unvan)
    {
        var esleme = (ayar?.UnvanEslemeleri ?? new List<AdEslemesi>())
            .FirstOrDefault(e =>
                UnvanBenziyor(MeslekAnahtari(e.Kaynak), MeslekAnahtari(unvan))
                && CalismaBicimiIceriyor(e.Kaynak) == CalismaBicimiIceriyor(unvan));

        return esleme?.Hedef ?? unvan;
    }
}

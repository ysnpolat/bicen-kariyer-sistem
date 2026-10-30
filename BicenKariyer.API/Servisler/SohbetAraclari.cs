using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Sohbet asistanının araçlarını çalıştırır.
///
/// Her araç, sunucuda tanımlı ve sınanmış bir sorguya karşılık gelir.
/// Model yalnızca hangi aracı hangi parametreyle çağıracağına karar verir;
/// sorgunun kendisini yazamaz.
/// </summary>
public class SohbetAraclari
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly OkutmaVeriHazirlayici _okutma;

    public SohbetAraclari(VeritabaniServisi vt, AyarServisi ayar)
    {
        _vt = vt;
        _ayar = ayar;
        _okutma = new OkutmaVeriHazirlayici(vt, ayar);
    }

    /// <summary>Aracı çalıştırır ve sonucu JSON metni olarak döndürür.</summary>
    public string Calistir(string ad, string girdiJson)
    {
        JsonElement g;

        try
        {
            using var belge = JsonDocument.Parse(
                string.IsNullOrWhiteSpace(girdiJson) ? "{}" : girdiJson);

            g = belge.RootElement.Clone();
        }
        catch
        {
            return Hata("Parametreler okunamadı.");
        }

        try
        {
            return ad switch
            {
                "qr_okutma_gunluk" => QrOkutma(Metin(g, "tarih"), Metin(g, "sube")),
                "personel_bilgi" => PersonelBilgi(Metin(g, "kimlikNo"), Metin(g, "adSoyad")),
                "ciro_verimlilik" => CiroVerimlilik(
                    Metin(g, "bas"), Metin(g, "bit"), Metin(g, "sube")),
                "norm_kadro" => NormKadro(Metin(g, "sube"), Mantik(g, "yalnizcaSorunlu")),
                "basvuru_eski_calisanlar" => EskiCalisanlar(
                    Metin(g, "bas"), Metin(g, "bit"), Metin(g, "durum")),
                "basvuru_ozet" => BasvuruOzet(
                    Metin(g, "bas"), Metin(g, "bit"), Metin(g, "sube")),
                "sube_listesi" => SubeListesi(),
                "sirket_yapisi" => SirketYapisi(),
                _ => Hata($"Bilinmeyen araç: {ad}")
            };
        }
        catch (Exception hata)
        {
            /* Modelin kullanıcıya anlamlı bir şey söyleyebilmesi için
               hatanın kendisi döndürülür, genel bir mesaj değil. */
            return Hata($"{ad} aracı çalışmadı: {hata.Message}");
        }
    }

    /* ==================================================================== */
    /* Araçlar                                                               */
    /* ==================================================================== */

    /// <summary>Bir günün QR okutma durumu</summary>
    private string QrOkutma(string tarihMetni, string sube)
    {
        var tarih = TarihCoz(tarihMetni) ?? DateTime.Today.AddDays(-1);

        var veri = _okutma.Hazirla(tarih, tarih, null);

        var magazalar = veri.Magazalar.AsEnumerable();

        if (!string.IsNullOrWhiteSpace(sube))
            magazalar = magazalar.Where(x => Benziyor(x.Birim, sube));

        var liste = magazalar.OrderBy(x => x.Oran).ToList();

        if (liste.Count == 0)
            return Yanit(new
            {
                tarih = tarih.ToString("yyyy-MM-dd"),
                bulunamadi = true,
                not = string.IsNullOrWhiteSpace(sube)
                    ? "Bu tarihte veri yok."
                    : $"'{sube}' adında mağaza bulunamadı. sube_listesi aracıyla "
                      + "doğru adı öğrenebilirsin."
            });

        /* Tek mağaza soruldu ise kişi listesi de verilir */
        object kisiler = null;

        if (liste.Count == 1)
            kisiler = KisiListesi(liste[0].Birim, tarih);

        return Yanit(new
        {
            tarih = tarih.ToString("yyyy-MM-dd"),
            toplamPersonel = liste.Sum(x => x.Toplam),
            okutan = liste.Sum(x => x.Okutan),
            okutmayan = liste.Sum(x => x.Okutmayan),
            magazalar = liste.Select(x => new
            {
                x.Birim,
                x.Bolge,
                x.Toplam,
                x.Okutan,
                x.Okutmayan,
                oran = x.Oran,
                oncekiGunOran = x.OncekiOran
            }),
            kisiler
        });
    }

    /// <summary>Bir mağazadaki kişilerin okutma durumu</summary>
    private object KisiListesi(string birim, DateTime tarih)
    {
        using var db = _vt.PersonelBaglantisi();

        var personeller = db.Query<PersonelKaydi>(@"
SELECT LTRIM(RTRIM(P.per_kod)) AS PersonelKodu, P.per_adi AS Ad,
       P.per_soyadi AS Soyad,
       LTRIM(RTRIM(P.Per_TcKimlikNo)) AS KimlikNo,
       PIG.ig_adi AS IsGrubu, PUT.un_aciklama AS Pozisyon
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) <= 1950)
  AND PIG.ig_adi = @birim", new { birim }, commandTimeout: 60).ToList();

        HashSet<string> okutanlar;

        try
        {
            using var gecis = _vt.GecisBaglantisi();

            okutanlar = new HashSet<string>(gecis.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(p.RegistrationNumber))
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) = @tarih
  AND p.RegistrationNumber IS NOT NULL", new { tarih = tarih.Date }),
                StringComparer.Ordinal);
        }
        catch
        {
            okutanlar = new HashSet<string>();
        }

        /* Biçen360 uygulamasından okutanlar (sicil ile) */
        var mobil = MobilOkutmaKaynagi.Aralik(_vt, tarih, tarih)
            .Select(x => x.PersonelKodu)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool Okuttu(PersonelKaydi x) =>
            okutanlar.Contains((x.KimlikNo ?? "").Trim())
            || mobil.Contains((x.PersonelKodu ?? "").Trim());

        /* Okutmadan muaf personel okutmayan sayılmıyor (Okutma Kuralları) */
        var muafKodlar = OkutmaKurallari.MuafKodlari(_vt, tarih, tarih);

        /* O gün raporlu olanlar da okutmayan sayılmıyor (personel kartındaki
           raporlar ve rapor izinleri) */
        var raporluKodlar = new RaporluServisi(_vt).Kodlar(tarih);

        bool Raporlu(PersonelKaydi x) =>
            !Okuttu(x) && raporluKodlar.Contains(RaporluServisi.Anahtar(x.PersonelKodu));

        bool Muaf(PersonelKaydi x) =>
            !Okuttu(x) && !Raporlu(x) && muafKodlar.Contains(OkutmaKurallari.Anahtar(x.PersonelKodu));

        return new
        {
            okutanlar = personeller
                .Where(x => Okuttu(x))
                .Select(x => $"{x.Ad} {x.Soyad} ({x.Pozisyon})")
                .ToList(),

            okutmayanlar = personeller
                .Where(x => !Okuttu(x) && !Muaf(x) && !Raporlu(x))
                .Select(x => $"{x.Ad} {x.Soyad} ({x.Pozisyon})")
                .ToList(),

            muaflar = personeller
                .Where(Muaf)
                .Select(x => $"{x.Ad} {x.Soyad} ({x.Pozisyon})")
                .ToList(),

            raporlular = personeller
                .Where(Raporlu)
                .Select(x => $"{x.Ad} {x.Soyad} ({x.Pozisyon})")
                .ToList()
        };
    }

    /// <summary>Personelin geçmişi ve notları</summary>
    private string PersonelBilgi(string kimlikNo, string adSoyad)
    {
        var kimlik = new string((kimlikNo ?? "").Where(char.IsDigit).ToArray());

        if (kimlik.Length != 11 && string.IsNullOrWhiteSpace(adSoyad))
            return Hata("Geçerli bir kimlik numarası ya da ad soyad gerekiyor.");

        var kelimeler = (adSoyad ?? "")
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 1)
            .ToList();

        using var db = _vt.PersonelBaglantisi();

        /* Çıkış sebebi kolonu Mikro sürümüne göre farklı adlandırılabilir;
           varlığı çalışma anında denetlenir. */
        var sebepKolonu = db.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND (name = 'per_cikis_neden' OR name LIKE '%cikis%neden%'
       OR name LIKE '%ayril%neden%' OR name LIKE '%cikis%sebep%')
ORDER BY CASE WHEN name = 'per_cikis_neden' THEN 0 ELSE 1 END, name");

        var sebepSecimi = string.IsNullOrWhiteSpace(sebepKolonu)
            ? "CAST(NULL AS NVARCHAR(200))"
            : $"CAST(P.[{sebepKolonu}] AS NVARCHAR(200))";

        /* Ücret kolonu da sürüme göre bulunmayabilir */
        var ucretVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND name = 'per_ucret'") > 0;

        var ucretSecimi = ucretVar
            ? "CAST(P.per_ucret AS DECIMAL(18,2))"
            : "CAST(NULL AS DECIMAL(18,2))";

        /* Kimlik numarası sabit uzunluklu kolonda boşlukla dolgulanmış
           olabilir; karşılaştırma kırpılarak yapılır. */
        var kayitlar = db.Query($@"
SELECT LTRIM(RTRIM(P.per_kod)) AS personelKodu, P.per_adi AS ad,
       P.per_soyadi AS soyad,
       LTRIM(RTRIM(P.Per_TcKimlikNo)) AS kimlikNo,
       P.per_tel_cepno AS telefon, PIG.ig_adi AS birim,
       PUT.un_aciklama AS pozisyon, P.per_giris_tar AS girisTarihi,
       P.per_cikis_tar AS cikisTarihi,
       {sebepSecimi} AS cikisSebebi,
       {ucretSecimi} AS ucret
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE (@kimlik <> '' AND LTRIM(RTRIM(P.Per_TcKimlikNo)) = @kimlik)
   OR (@tamAd <> '' AND
       LTRIM(RTRIM(P.per_adi)) + ' ' + LTRIM(RTRIM(P.per_soyadi)) = @tamAd)
   OR (@ad1 <> '' AND @ad2 <> '' AND
       LTRIM(RTRIM(P.per_adi)) LIKE @ad1 + '%' AND
       LTRIM(RTRIM(P.per_soyadi)) LIKE @ad2 + '%')
   OR (@ad1 <> '' AND @ad2 = '' AND
       LTRIM(RTRIM(P.per_adi)) + ' ' + LTRIM(RTRIM(P.per_soyadi))
           LIKE '%' + @ad1 + '%')
ORDER BY P.per_giris_tar DESC",
            new
            {
                kimlik,
                /* Ad ve soyad ayrı da aranır: sabit uzunluklu kolonlarda
                   birleştirme araya boşluk dolgusu koyduğu için tek parça
                   arama tutmayabiliyor. */
                /* Tam ad önce denenir; 'Caner Alkan' ararken
                   "Caner Ceylan" gelmesin diye soyad başlangıçtan eşleşir. */
                tamAd = string.Join(" ", kelimeler),
                ad1 = kelimeler.ElementAtOrDefault(0) ?? "",
                ad2 = kelimeler.ElementAtOrDefault(1) ?? ""
            }, commandTimeout: 60).ToList();

        if (kayitlar.Count == 0)
            return Yanit(new { bulunamadi = true, not = "Bu kişi personel kayıtlarında yok." });

        var ilk = kayitlar[0];
        var gercekKimlik = ((string)ilk.kimlikNo ?? "").Trim();

        /* Doğum tarihi, meslek ve adres gibi alanlar Mikro sürümüne göre
           bulunmayabilir. Ana sorguyu bozmamak için kart satırı ayrıca ve
           korumalı biçimde okunur. */
        var ekBilgi = KartEkBilgisi(db, (string)ilk.personelKodu);

        /* Oryantasyon notları ve başvuru geçmişi kendi veritabanımızdan */
        using var yerel = _vt.Baglanti();

        var takipNotlari = yerel.Query(@"
SELECT donem AS donem, durum AS durum, not_metni AS notMetni,
       kullanici AS kullanici, tarih AS tarih
FROM KRY_PERSONEL_TAKIP
WHERE LTRIM(RTRIM(kimlik_no)) = @kimlik
ORDER BY tarih DESC", new { kimlik = gercekKimlik }).ToList();

        var basvurular = yerel.Query(@"
SELECT basvuru_no AS basvuruNo, durum AS durum, sube_adi AS subeAdi,
       bolumler AS bolumler, degerlendirme_notu AS degerlendirmeNotu,
       olusturma AS olusturma
FROM KRY_BASVURULAR
WHERE LTRIM(RTRIM(kimlik_no)) = @kimlik
ORDER BY id DESC", new { kimlik = gercekKimlik }).ToList();

        /* Not metni bu tabloda 'metin' kolonundadır; personel takip
           tablosundaki "not_metni" ile karıştırılmamalı. */
        var basvuruNotlari = yerel.Query(@"
SELECT n.metin AS notMetni,
       ISNULL(n.ad_soyad, n.kullanici) AS kullanici,
       n.tarih AS tarih
FROM KRY_BASVURU_NOT n
    INNER JOIN KRY_BASVURULAR b ON b.id = n.basvuru_id
WHERE LTRIM(RTRIM(b.kimlik_no)) = @kimlik
ORDER BY n.tarih DESC", new { kimlik = gercekKimlik }).ToList();

        return Yanit(new
        {
            /* Panel bu kodla fotoğrafı çekebilsin */
            personelKodu = (string)ilk.personelKodu,

            kisi = new
            {
                adSoyad = $"{((string)ilk.ad ?? "").Trim()} "
                        + $"{((string)ilk.soyad ?? "").Trim()}".Trim(),
                kimlikNo = gercekKimlik,
                telefon = ((string)ilk.telefon ?? "").Trim(),
                dogumTarihi = ekBilgi.DogumTarihi,
                meslek = ekBilgi.Meslek,
                adres = ekBilgi.Adres,
                halenCalisiyor = kayitlar.Any(k => Cikti((DateTime?)k.cikisTarihi) is null)
            },
            calismaGecmisi = kayitlar.Select(k => new
            {
                k.personelKodu,
                magaza = (string)k.birim,
                pozisyon = (string)k.pozisyon,
                girisTarihi = ((DateTime?)k.girisTarihi)?.ToString("yyyy-MM-dd"),
                cikisTarihi = Cikti((DateTime?)k.cikisTarihi)?.ToString("yyyy-MM-dd"),
                cikisSebebi = (string)k.cikisSebebi,
                halenCalisiyor = Cikti((DateTime?)k.cikisTarihi) is null,
                /* Dinamik değer anonim tipe doğrudan atanamaz; tip belirtilir */
                ucret = (decimal?)k.ucret,
                calismaSuresi = SureMetni(
                    (DateTime?)k.girisTarihi, Cikti((DateTime?)k.cikisTarihi))
            }),

            /* QR okutma durumu; son yedi gün */
            qrOkutma = QrOzeti(gercekKimlik),
            oryantasyonNotlari = takipNotlari,
            basvurular,
            basvuruNotlari
        });
    }

    /// <summary>
    /// Personel kartındaki ek alanlar: doğum tarihi, meslek, adres.
    ///
    /// Bu kolonlar Mikro sürümüne göre bulunmayabilir. Kart satırının
    /// tamamı okunup mevcut olanlar ayıklanır; böylece eksik bir kolon
    /// ana sorguyu düşürmez.
    /// </summary>
    private static (string DogumTarihi, string Meslek, string Adres)
        KartEkBilgisi(System.Data.IDbConnection db, string personelKodu)
    {
        try
        {
            var kart = db.QueryFirstOrDefault(@"
SELECT TOP 1 * FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(per_kod)) = @kod", new { kod = personelKodu });

            if (kart is null) return (null, null, null);

            var alanlar = (IDictionary<string, object>)kart;

            string Al(string ad)
            {
                foreach (var a in alanlar)
                {
                    if (!string.Equals(a.Key, ad, StringComparison.OrdinalIgnoreCase))
                        continue;

                    var d = a.Value?.ToString()?.Trim() ?? "";
                    return d == "0" ? "" : d;
                }

                return "";
            }

            /* Doğum tarihi geçerli bir tarihse biçimlendirilir */
            string dogum = null;

            foreach (var a in alanlar)
            {
                if (a.Key.Contains("dogum", StringComparison.OrdinalIgnoreCase) &&
                    a.Key.Contains("tarih", StringComparison.OrdinalIgnoreCase) &&
                    a.Value is DateTime t && t.Year > 1900)
                {
                    dogum = t.ToString("yyyy-MM-dd");
                    break;
                }
            }

            var adresParcalari = new[]
            {
                Al("per_adr_mahalle"), Al("per_adr_ilce"), Al("per_adr_il")
            }.Where(x => x.Length > 0);

            return (dogum, Al("per_kim_meslek"), string.Join(" / ", adresParcalari));
        }
        catch
        {
            /* Ek bilgi alınamazsa kart yine döner */
            return (null, null, null);
        }
    }

    /// <summary>Çalışma süresini okunabilir metne çevirir.</summary>
    private static string SureMetni(DateTime? giris, DateTime? cikis)
    {
        if (giris is null || giris.Value.Year <= 1950) return null;

        var bitis = cikis ?? DateTime.Today;
        var gun = (bitis - giris.Value).Days;

        if (gun < 0) return null;
        if (gun < 30) return $"{gun} gün";

        var ay = gun / 30;

        if (ay < 12) return $"{ay} ay";

        var yil = ay / 12;
        var kalanAy = ay % 12;

        return kalanAy > 0 ? $"{yil} yıl {kalanAy} ay" : $"{yil} yıl";
    }

    /// <summary>Personelin son yedi günlük QR okutma özeti.</summary>
    private object QrOzeti(string kimlik)
    {
        if (string.IsNullOrWhiteSpace(kimlik)) return null;

        try
        {
            using var db = _vt.GecisBaglantisi();

            var kisiId = db.ExecuteScalar<int?>(@"
SELECT TOP 1 PersonId FROM Persons
WHERE LTRIM(RTRIM(RegistrationNumber)) = @kimlik",
                new { kimlik }, commandTimeout: 20);

            if (kisiId is null)
                return new { kayitliDegil = true, not = "Geçiş sisteminde kaydı yok." };

            var gunler = db.Query(@"
SELECT CAST(t.TransitionDate AS DATE) AS tarih,
       MIN(t.TransitionDateTime) AS ilk,
       MAX(t.TransitionDateTime) AS son,
       COUNT(*) AS hareket
FROM Transitions t
WHERE t.PersonId = @kisiId
  AND CAST(t.TransitionDate AS DATE) >= @sinir
GROUP BY CAST(t.TransitionDate AS DATE)
ORDER BY 1 DESC",
                new { kisiId, sinir = DateTime.Today.AddDays(-7) },
                commandTimeout: 30).ToList();

            return new
            {
                sonYediGun = gunler.Select(g => new
                {
                    tarih = ((DateTime)g.tarih).ToString("yyyy-MM-dd"),
                    ilkGiris = ((DateTime)g.ilk).ToString("HH:mm"),
                    sonHareket = ((DateTime)g.son).ToString("HH:mm"),
                    hareketSayisi = (int)g.hareket
                }),
                okutulanGunSayisi = gunler.Count
            };
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Personel başı ciro verimliliği</summary>
    private string CiroVerimlilik(string basMetni, string bitMetni, string sube)
    {
        var bit = TarihCoz(bitMetni) ?? DateTime.Today.AddDays(-1);
        var bas = TarihCoz(basMetni) ?? bit.AddDays(-6);

        if (bit < bas) (bas, bit) = (bit, bas);

        using var ciroDb = _vt.CiroBaglantisi();

        var satirlar = ciroDb.Query(@"
SELECT DEPO AS depo, SUM(Satis_Tutar + Satis_Kdv) AS ciro,
       COUNT(DISTINCT CAST(Tarih AS DATE)) AS gun
FROM [MikroDB_V15_BICEN].[dbo].[hmz_stok_hareket1]
WHERE Tarih BETWEEN @bas AND @bit
GROUP BY DEPO", new { bas, bit }, commandTimeout: 120).ToList();

        using var db = _vt.Baglanti();

        var kadrolar = db.Query(@"
SELECT sube_adi AS subeAdi, ISNULL(SUM(norm), 0) AS norm,
       ISNULL(SUM(mevcut), 0) AS mevcut
FROM KRY_KADRO WHERE aktif = 1
GROUP BY sube_adi").ToList();

        var sonuc = new List<object>();

        foreach (var s in satirlar)
        {
            var depo = ((string)s.depo ?? "").Trim();

            if (!string.IsNullOrWhiteSpace(sube) && !Benziyor(depo, sube)) continue;

            var kadro = kadrolar.FirstOrDefault(k => Benziyor((string)k.subeAdi, depo));

            var gun = (int)s.gun;
            var toplam = (decimal)s.ciro;
            var gunluk = gun > 0 ? toplam / gun : 0m;

            var norm = kadro is null ? 0m : (decimal)kadro.norm;
            var mevcut = kadro is null ? 0m : (decimal)kadro.mevcut;

            sonuc.Add(new
            {
                magaza = depo,
                toplamCiro = Math.Round(toplam, 2),
                gunSayisi = gun,
                gunlukCiro = Math.Round(gunluk, 2),
                norm,
                mevcut,
                fark = mevcut - norm,

                /* Hesaplanmış değerler burada verilir; model kendi
                   hesaplamamalı, yuvarlama hatası yapıyor. */
                normBasiGunluk = norm > 0 ? Math.Round(gunluk / norm, 2) : (decimal?)null,
                mevcutBasiGunluk = mevcut > 0 ? Math.Round(gunluk / mevcut, 2) : (decimal?)null,

                kadroTanimli = kadro is not null,
                not = kadro is null
                    ? "Bu mağaza için norm kadro tanımı bulunamadı; "
                      + "kişi başı değer hesaplanamıyor."
                    : null
            });
        }

        if (sonuc.Count == 0)
            return Yanit(new
            {
                bulunamadi = true,
                not = "Bu dönemde ciro verisi bulunamadı."
            });

        return Yanit(new
        {
            baslangic = bas.ToString("yyyy-MM-dd"),
            bitis = bit.ToString("yyyy-MM-dd"),
            magazalar = sonuc
        });
    }

    /// <summary>Norm kadro durumu</summary>
    private string NormKadro(string sube, bool yalnizcaSorunlu)
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT sube_adi AS subeAdi, bolum AS bolum,
       ISNULL(norm, 0) AS norm, ISNULL(mevcut, 0) AS mevcut,
       ISNULL(mevcut, 0) - ISNULL(norm, 0) AS fark,
       ISNULL(engelli, 0) AS engelli
FROM KRY_KADRO
WHERE aktif = 1 AND (@sube = '' OR sube_adi LIKE '%' + @sube + '%')
ORDER BY sube_adi, bolum", new { sube = sube ?? "" }).ToList();

        if (kayitlar.Count == 0)
            return Yanit(new { bulunamadi = true, not = "Kadro kaydı bulunamadı." });

        var gruplu = kayitlar
            .GroupBy(x => (string)x.subeAdi)
            .Select(g => new
            {
                magaza = g.Key,
                norm = g.Sum(x => (decimal)x.norm),
                mevcut = g.Sum(x => (decimal)x.mevcut),
                fark = g.Sum(x => (decimal)x.fark),
                engelli = g.Sum(x => (decimal)x.engelli),
                eksikler = g.Where(x => (decimal)x.fark < 0)
                    .Select(x => new { bolum = (string)x.bolum, adet = -(decimal)x.fark }),
                fazlalar = g.Where(x => (decimal)x.fark > 0)
                    .Select(x => new { bolum = (string)x.bolum, adet = (decimal)x.fark })
            })
            .Where(x => !yalnizcaSorunlu || x.fark != 0)
            .OrderBy(x => x.fark)
            .ToList();

        return Yanit(new { magazalar = gruplu });
    }

    /// <summary>
    /// Başvuranlar arasında daha önce şirkette çalışmış olanlar.
    ///
    /// Başvurular kendi veritabanımızda, çalışma geçmişi Mikro'da olduğu
    /// için eşleştirme kimlik numarası üzerinden bellekte yapılır.
    /// </summary>
    private string EskiCalisanlar(string basMetni, string bitMetni, string durum)
    {
        var bit = TarihCoz(bitMetni) ?? DateTime.Today;
        var bas = TarihCoz(basMetni) ?? bit.AddDays(-90);

        using var yerel = _vt.Baglanti();

        var basvurular = yerel.Query(@"
SELECT id AS id, ad_soyad AS adSoyad, kimlik_no AS kimlikNo,
       telefon AS telefon, sube_adi AS subeAdi, bolumler AS bolumler,
       durum AS durum, olusturma AS olusturma
FROM KRY_BASVURULAR
WHERE olusturma BETWEEN @bas AND @bit
  AND kimlik_no IS NOT NULL AND LEN(LTRIM(RTRIM(kimlik_no))) = 11
  AND (@durum = '' OR durum = @durum)
ORDER BY id DESC",
            new
            {
                bas = bas.Date,
                bit = bit.Date.AddDays(1).AddSeconds(-1),
                durum = durum ?? ""
            }).ToList();

        if (basvurular.Count == 0)
            return Yanit(new { bulunamadi = true, not = "Bu dönemde başvuru yok." });

        var kimlikler = basvurular
            .Select(x => ((string)x.kimlikNo ?? "").Trim())
            .Where(x => x.Length == 11)
            .Distinct()
            .ToList();

        using var db = _vt.PersonelBaglantisi();

        var sebepKolonu = db.ExecuteScalar<string>(@"
SELECT TOP 1 name FROM [MikroDesktop_2004BICEN].sys.columns
WHERE object_id = OBJECT_ID('[MikroDesktop_2004BICEN].dbo.PERSONELLER')
  AND (name = 'per_cikis_neden' OR name LIKE '%cikis%neden%'
       OR name LIKE '%ayril%neden%' OR name LIKE '%cikis%sebep%')
ORDER BY CASE WHEN name = 'per_cikis_neden' THEN 0 ELSE 1 END, name");

        var sebepSecimi = string.IsNullOrWhiteSpace(sebepKolonu)
            ? "CAST(NULL AS NVARCHAR(200))"
            : $"CAST(P.[{sebepKolonu}] AS NVARCHAR(200))";

        /* Kimlikler parça parça sorgulanır; çok uzun IN listesi sorun çıkarır */
        var gecmis = new List<dynamic>();

        foreach (var parca in Parcala(kimlikler, 400))
        {
            gecmis.AddRange(db.Query($@"
SELECT LTRIM(RTRIM(P.Per_TcKimlikNo)) AS kimlikNo,
       P.per_adi AS ad, P.per_soyadi AS soyad,
       PIG.ig_adi AS magaza, PUT.un_aciklama AS pozisyon,
       P.per_giris_tar AS girisTarihi, P.per_cikis_tar AS cikisTarihi,
       {sebepSecimi} AS cikisSebebi
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE LTRIM(RTRIM(P.Per_TcKimlikNo)) IN @kimlikler",
                new { kimlikler = parca }, commandTimeout: 120));
        }

        var gecmisSozluk = gecmis
            .GroupBy(x => (string)x.kimlikNo)
            .ToDictionary(g => g.Key, g => g.ToList());

        var eslesenler = new List<object>();

        foreach (var b in basvurular)
        {
            var k = ((string)b.kimlikNo ?? "").Trim();

            if (!gecmisSozluk.TryGetValue(k, out var kayitlar)) continue;

            eslesenler.Add(new
            {
                basvuruId = (int)b.id,
                adSoyad = (string)b.adSoyad,
                kimlikNo = k,
                telefon = (string)b.telefon,
                basvurduguSube = (string)b.subeAdi,
                basvurduguPozisyon = (string)b.bolumler,
                basvuruDurumu = (string)b.durum,
                basvuruTarihi = ((DateTime)b.olusturma).ToString("yyyy-MM-dd"),

                oncekiCalismalar = kayitlar.Select(c => new
                {
                    magaza = (string)c.magaza,
                    pozisyon = (string)c.pozisyon,
                    giris = ((DateTime?)c.girisTarihi)?.Year > 1950
                        ? ((DateTime)c.girisTarihi).ToString("yyyy-MM-dd") : null,
                    cikis = ((DateTime?)c.cikisTarihi)?.Year > 1950
                        ? ((DateTime)c.cikisTarihi).ToString("yyyy-MM-dd") : null,
                    cikisSebebi = (string)c.cikisSebebi,
                    halenCalisiyor = !(((DateTime?)c.cikisTarihi)?.Year > 1950),
                    calismaSuresi = SureMetni(
                        (DateTime?)c.girisTarihi, Cikti((DateTime?)c.cikisTarihi))
                })
            });
        }

        return Yanit(new
        {
            baslangic = bas.ToString("yyyy-MM-dd"),
            bitis = bit.ToString("yyyy-MM-dd"),
            toplamBasvuru = basvurular.Count,
            eskiCalisanSayisi = eslesenler.Count,
            eskiCalisanlar = eslesenler
        });
    }

    /// <summary>Listeyi belirtilen boyutta parçalara böler.</summary>
    private static IEnumerable<List<T>> Parcala<T>(List<T> liste, int boyut)
    {
        for (var i = 0; i < liste.Count; i += boyut)
            yield return liste.GetRange(i, Math.Min(boyut, liste.Count - i));
    }

    /// <summary>Başvuru istatistikleri</summary>
    private string BasvuruOzet(string basMetni, string bitMetni, string sube)
    {
        var bit = TarihCoz(bitMetni) ?? DateTime.Today;
        var bas = TarihCoz(basMetni) ?? bit.AddDays(-30);

        using var db = _vt.Baglanti();

        var p = new
        {
            bas = bas.Date,
            bit = bit.Date.AddDays(1).AddSeconds(-1),
            sube = sube ?? ""
        };

        var durumlar = db.Query(@"
SELECT durum AS durum, COUNT(*) AS adet
FROM KRY_BASVURULAR
WHERE olusturma BETWEEN @bas AND @bit
  AND (@sube = '' OR sube_adi LIKE '%' + @sube + '%')
GROUP BY durum", p).ToList();

        var subeler = db.Query(@"
SELECT TOP 15 sube_adi AS subeAdi, COUNT(*) AS adet
FROM KRY_BASVURULAR
WHERE olusturma BETWEEN @bas AND @bit
  AND (@sube = '' OR sube_adi LIKE '%' + @sube + '%')
GROUP BY sube_adi ORDER BY COUNT(*) DESC", p).ToList();

        var toplam = durumlar.Sum(x => (int)x.adet);

        return Yanit(new
        {
            baslangic = bas.ToString("yyyy-MM-dd"),
            bitis = bit.ToString("yyyy-MM-dd"),
            toplamBasvuru = toplam,
            durumDagilimi = durumlar,
            subeDagilimi = subeler
        });
    }

    /// <summary>
    /// Şirketin güncel yapısı: birim sayıları, bölgeler, personel dağılımı.
    ///
    /// Bu bilgiler eskiden sistem yönergesine elle yazılıydı ("yaklaşık 35
    /// mağaza, 850-880 personel") ve zamanla gerçeği yansıtmaz oldu. Artık
    /// her soruda veritabanından okunur.
    /// </summary>
    private string SirketYapisi()
    {
        var ayar = _ayar.FormOku();
        var subeler = ayar.Subeler ?? new List<Sube>();
        var bolgeler = ayar.Bolgeler ?? new List<BolgeTanimi>();

        using var db = _vt.PersonelBaglantisi();

        var personeller = db.Query<PersonelKaydi>(@"
SELECT LTRIM(RTRIM(P.per_kod)) AS PersonelKodu, P.per_adi AS Ad,
       P.per_soyadi AS Soyad,
       PIG.ig_adi AS IsGrubu, PUT.un_aciklama AS Pozisyon
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE (P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) <= 1950)",
            commandTimeout: 60).ToList();

        /* Birim türü mağaza mı merkez mi: şube tanımındaki Tur alanından.
           Tanımsız iş gruplarını ayrıca sayıyoruz ki eksik eşleştirme
           görünür olsun. */
        var turler = subeler
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Tur) ? "Şube" : x.Tur)
            .ToDictionary(g => g.Key, g => g.Count());

        var birimBazinda = personeller
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "Belirtilmemiş" : x.IsGrubu.Trim())
            .Select(g => new { birim = g.Key, kisi = g.Count() })
            .OrderByDescending(x => x.kisi)
            .ToList();

        var tanimliAdlar = new HashSet<string>(
            subeler.Select(x => x.Ad ?? ""), StringComparer.OrdinalIgnoreCase);

        var pozisyonlar = personeller
            .GroupBy(x => string.IsNullOrWhiteSpace(x.Pozisyon) ? "Belirtilmemiş" : x.Pozisyon.Trim())
            .Select(g => new { pozisyon = g.Key, kisi = g.Count() })
            .OrderByDescending(x => x.kisi)
            .ToList();

        return Yanit(new
        {
            toplamPersonel = personeller.Count,
            toplamBirim = subeler.Count,
            birimTurleri = turler.Select(x => new { tur = x.Key, adet = x.Value }),

            bolgeler = bolgeler.Select(b => new
            {
                b.Ad,
                subeSayisi = b.Subeler?.Count ?? 0,
                subeler = b.Subeler ?? new List<string>(),
                kisi = personeller.Count(p => (b.Subeler ?? new List<string>())
                    .Any(s => Benziyor(s, p.IsGrubu)))
            }),

            birimBazindaPersonel = birimBazinda,
            pozisyonDagilimi = pozisyonlar,

            /* Norm kadro raporundaki 'sayılamadı' uyarısının kaynağı */
            tanimsizBirimler = birimBazinda
                .Where(x => !tanimliAdlar.Contains(x.birim))
                .Select(x => new { x.birim, x.kisi })
        });
    }

    /// <summary>Mağaza ve bölge listesi</summary>
    private string SubeListesi()
    {
        var ayar = _ayar.FormOku();

        return Yanit(new
        {
            magazalar = (ayar.Subeler ?? new List<Sube>())
                .Select(x => new { x.Kod, x.Ad, x.Tur }),
            bolgeler = (ayar.Bolgeler ?? new List<BolgeTanimi>())
                .Select(x => new { x.Ad, subeSayisi = x.Subeler?.Count ?? 0 })
        });
    }

    /* ==================================================================== */
    /* Yardımcılar                                                           */
    /* ==================================================================== */

    private static string Metin(JsonElement g, string alan) =>
        g.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
            ? d.GetString() ?? ""
            : "";

    private static bool Mantik(JsonElement g, string alan) =>
        g.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.True;

    private static DateTime? Cikti(DateTime? tarih) =>
        tarih is null || tarih.Value.Year <= 1950 ? null : tarih;

    private static DateTime? TarihCoz(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return null;

        if (DateTime.TryParse(metin, new System.Globalization.CultureInfo("tr-TR"),
                System.Globalization.DateTimeStyles.None, out var t))
            return t.Date;

        return DateTime.TryParse(metin, out var t2) ? t2.Date : null;
    }

    /// <summary>Mağaza adlarını esnek karşılaştırır</summary>
    private static bool Benziyor(string a, string b)
    {
        static string Sade(string m)
        {
            if (string.IsNullOrWhiteSpace(m)) return "";

            var buyuk = m.Trim().ToUpperInvariant();

            foreach (var (k, h) in new[]
            {
                ('İ', 'I'), ('Ş', 'S'), ('Ğ', 'G'),
                ('Ü', 'U'), ('Ö', 'O'), ('Ç', 'C')
            })
            {
                buyuk = buyuk.Replace(k, h);
            }

            var temiz = new string(buyuk.Where(char.IsLetterOrDigit).ToArray());

            foreach (var ek in new[] { "SUBESI", "SUBE", "MAGAZASI", "MAGAZA" })
            {
                if (temiz.EndsWith(ek, StringComparison.Ordinal) && temiz.Length > ek.Length)
                    return temiz[..^ek.Length];
            }

            return temiz;
        }

        var x = Sade(a);
        var y = Sade(b);

        if (x.Length == 0 || y.Length == 0) return false;

        return x == y || x.Contains(y) || y.Contains(x);
    }

    private static string Yanit(object veri) =>
        JsonSerializer.Serialize(veri, new JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder
                .UnsafeRelaxedJsonEscaping
        });

    private static string Hata(string mesaj) => Yanit(new { hata = mesaj });
}

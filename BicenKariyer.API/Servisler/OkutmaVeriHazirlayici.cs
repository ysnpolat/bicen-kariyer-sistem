using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Okutma raporu verisini hazırlar.
///
/// Aynı mantık hem panel ekranında hem günlük mail görevinde kullanıldığı
/// için ayrı bir sınıfa alınmıştır. İki yerde ayrı yazılsaydı biri
/// değiştiğinde diğeri unutulurdu.
/// </summary>
public class OkutmaVeriHazirlayici
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;

    public OkutmaVeriHazirlayici(VeritabaniServisi vt, AyarServisi ayar)
    {
        _vt = vt;
        _ayar = ayar;
    }

    /// <summary>
    /// Belirtilen aralık için rapor verisi üretir.
    /// <paramref name="bolgeler"/> boş bırakılırsa tüm birimler kapsanır.
    /// </summary>
    /// <summary>
    /// Rapor verisini hazırlar.
    /// </summary>
    /// <param name="subeAdi">
    /// Verilirse yalnızca bu şubenin verisi alınır. Şubelere kendi
    /// raporlarını göndermek için kullanılır; bölge süzgecinden bağımsızdır.
    /// </param>
    /// <param name="subeler">
    /// Kullanıcının yetkili olduğu şubeler. Bölge müdüründe bölge seçicisi
    /// olmadığı için kapsam buradan geliyor; istemciden gelen bir değere
    /// güvenilmiyor.
    /// </param>
    public OkutmaRaporuServisi.RaporVerisi Hazirla(
        DateTime bas, DateTime bit, string[] bolgeler, string subeAdi = null,
        string[] subeler = null)
    {
        var ayar = _ayar.FormOku();
        var personeller = PersonelleriAl();

        /* -------------------------------------------------- bölge süzgeci */
        if (bolgeler is { Length: > 0 })
        {
            var adlar = BolgeSubeAdlari(ayar, bolgeler);

            personeller = personeller
                .Where(x => adlar.Any(ad =>
                    Anahtar(ad) == Anahtar(x.IsGrubu)))
                .ToList();
        }

        /* -------------------------------------------------- şube süzgeci */
        if (subeler is { Length: > 0 })
        {
            /* Şube kodu ve adı karışık gelebiliyor; ikisi de deneniyor.
               Personel kaydındaki iş grubu adı şube adını içeriyor. */
            personeller = personeller
                .Where(x => subeler.Any(k =>
                    Anahtar(k) == Anahtar(x.IsGrubu) ||
                    (x.IsGrubu ?? "").Contains(k, StringComparison.OrdinalIgnoreCase)))
                .ToList();
        }

        if (!string.IsNullOrWhiteSpace(subeAdi))
        {
            personeller = personeller
                .Where(x => Anahtar(subeAdi) == Anahtar(x.IsGrubu))
                .ToList();
        }

        /* Rapor aralığının tamamı izinli olan personel dışarıda bırakılıyor.
           Hafta sonu izinli merkez ofis çalışanları cumartesi raporunda
           "okutmadı" diye görünüyor ve listeyi kullanılamaz hâle
           getiriyordu. Aralığın bir günü bile çalışma günüyse kişi
           raporda kalıyor. */
        personeller = IzinliOlmayanlar(personeller, bas, bit);

        /* Okutmadan muaf personel (Vardiya Karekodları → Okutma Kuralları;
           aralığın tamamında muaf olanlar) okutma beklenenlerden ayrılıyor:
           "okutmadı" sayılmıyor, oranı düşürmüyor, raporda "Muaf" olarak
           ayrıca listeleniyor. */
        var muafKodlar = OkutmaKurallari.MuafKodlari(_vt, bas, bit);

        var muaflar = personeller
            .Where(x => muafKodlar.Contains(OkutmaKurallari.Anahtar(x.PersonelKodu)))
            .ToList();

        if (muaflar.Count > 0)
            personeller = personeller.Except(muaflar).ToList();

        var muafGruplari = muaflar
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "TANIMSIZ" : x.IsGrubu)
            .ToDictionary(g => g.Key, g => g.Select(x => $"{x.Ad} {x.Soyad}".Trim()).OrderBy(x => x).ToList());

        /* Raporlu personel (aralığın tamamında; personel kartındaki raporlar
           ve rapor izinleri) muaf gibi ayrılıyor: "okutmadı" sayılmıyor,
           oranı düşürmüyor, raporda "Raporlu" olarak listeleniyor. */
        var raporluKodlar = new RaporluServisi(_vt).AralikKodlari(bas, bit);

        var raporlular = personeller
            .Where(x => raporluKodlar.Contains(RaporluServisi.Anahtar(x.PersonelKodu)))
            .ToList();

        if (raporlular.Count > 0)
            personeller = personeller.Except(raporlular).ToList();

        var raporluGruplari = raporlular
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "TANIMSIZ" : x.IsGrubu)
            .ToDictionary(g => g.Key, g => g.Select(x => $"{x.Ad} {x.Soyad}".Trim()).OrderBy(x => x).ToList());

        var okutanlar = OkutanlarAl(bas, bit, personeller);

        /* Önceki eşit uzunluktaki dönem; kıyas için */
        var gunSayisi = (bit.Date - bas.Date).Days + 1;
        var oncekiBit = bas.Date.AddDays(-1);
        var oncekiBas = oncekiBit.AddDays(-(gunSayisi - 1));

        var oncekiOkutanlar = OkutanlarAl(oncekiBas, oncekiBit, personeller);

        var magazalar = personeller
            .GroupBy(x => string.IsNullOrWhiteSpace(x.IsGrubu) ? "TANIMSIZ" : x.IsGrubu)
            .Select(g =>
            {
                var okutan = g.Count(x => Okuttu(okutanlar, x));
                var oncekiOkutan = g.Count(x => Okuttu(oncekiOkutanlar, x));

                return new OkutmaRaporuServisi.MagazaOzeti
                {
                    Birim = g.Key,
                    Bolge = BolgeBul(ayar, g.Key),
                    Toplam = g.Count(),
                    Okutan = okutan,

                    /* Adlar yalnızca şube sürümünde basılır; veriler zaten
                       elde olduğu için ek sorgu maliyeti yok. */
                    OkutanAdlar = g.Where(x => Okuttu(okutanlar, x))
                        .Select(x => $"{x.Ad} {x.Soyad}".Trim())
                        .OrderBy(x => x)
                        .ToList(),

                    OkutmayanAdlar = g.Where(x => !Okuttu(okutanlar, x))
                        .Select(x => $"{x.Ad} {x.Soyad}".Trim())
                        .OrderBy(x => x)
                        .ToList(),
                    MuafAdlar = muafGruplari.GetValueOrDefault(g.Key) ?? new List<string>(),
                    RaporluAdlar = raporluGruplari.GetValueOrDefault(g.Key) ?? new List<string>(),
                    OncekiOran = g.Count() > 0
                        ? (int)Math.Round(oncekiOkutan * 100.0 / g.Count())
                        : 0,
                    SifirGun = okutan == 0
                        ? SifirGun(
                            g.Select(x => Rakamlar(x.KimlikNo))
                                .Where(x => x.Length == 11)
                                .Distinct()
                                .ToList(),
                            g.Select(x => x.PersonelKodu).ToList(),
                            bas)
                        : 0
                };
            })
            .ToList();

        var oncekiToplam = personeller.Count(x => Okuttu(oncekiOkutanlar, x));

        return new OkutmaRaporuServisi.RaporVerisi
        {
            Tarih = bas.Date,
            BitisTarihi = bas.Date == bit.Date ? null : bit.Date,
            Baslik = bolgeler is { Length: > 0 }
                ? string.Join(", ", bolgeler)
                : $"{magazalar.Count} mağaza",
            Magazalar = magazalar,
            MuafSayisi = muaflar.Count,
            RaporluSayisi = raporlular.Count,
            OncekiOkutan = oncekiToplam,
            OncekiOran = personeller.Count > 0
                ? (int)Math.Round(oncekiToplam * 100.0 / personeller.Count)
                : 0
        };
    }

    /* ==================================================================== */
    /* Yardımcılar                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Çalışan personeli getirir.
    ///
    /// Mikro'da ayrı bir durum alanı yoktur; personelin çalışıp çalışmadığı
    /// çıkış tarihinden anlaşılır. Boş tarihler 1900 öncesi değerlerle
    /// tutulabildiği için yıl denetimi yapılır.
    /// </summary>
    private List<PersonelKaydi> PersonelleriAl()
    {
        using var db = _vt.PersonelBaglantisi();

        return db.Query<PersonelKaydi>(@"
SELECT LTRIM(RTRIM(P.per_kod)) AS PersonelKodu,
       P.per_adi        AS Ad,
       P.per_soyadi     AS Soyad,
       P.Per_TcKimlikNo AS KimlikNo,
       PIG.ig_adi       AS IsGrubu,
       PUT.un_aciklama  AS Pozisyon
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    INNER JOIN PERSONEL_IS_GRUP_TANIMLARI PIG
        ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT
        ON P.per_unvan_kodu = PUT.un_kod
WHERE P.per_cikis_tar IS NULL OR YEAR(P.per_cikis_tar) <= 1950",
            commandTimeout: 120).ToList();
    }

    /// <summary>
    /// Aralığın tamamı izinli olan personeli listeden çıkarır.
    ///
    /// İzin günleri pozisyon grubundan, resmi tatiller tanım tablosundan
    /// geliyor. Tanım yoksa kimse çıkarılmıyor: grup tanımlanmadan
    /// personeli raporun dışına almak, eksik veriyi sessizce gizlemek
    /// olurdu.
    /// </summary>
    /* public (03.10.2026): patron görünümü bugün okutma beklenen kişileri
       (haftalık izin günü, plan izni ve resmî tatil dışındakiler) buradan
       alıyor; okutma raporuyla aynı kural geçerli olsun. */
    public List<PersonelKaydi> IzinliOlmayanlar(
        List<PersonelKaydi> personeller, DateTime bas, DateTime bit)
    {
        /* 09.10.2026: kurallar GunNedenServisi'nde ortak (haftalık izin,
           yıllık ve diğer tam gün izinler, resmî tatil). Önceden yıllık
           izindeki personel burada tanınmıyor, raporda "Okutmadı"
           görünüyordu. Raporlu günler ayrıca sayıldığı için dahil değil. */
        Dictionary<string, Dictionary<DateTime, string>> nedenler;

        try
        {
            nedenler = new GunNedenServisi(_vt).Aralik(personeller, bas, bit, raporDahil: false);
        }
        catch
        {
            return personeller;
        }

        var gunler = new List<DateTime>();
        for (var g = bas.Date; g <= bit.Date; g = g.AddDays(1)) gunler.Add(g);

        /* Kişinin bütün günleri izin ya da tatilse raporda yeri yok */
        return personeller.Where(p =>
        {
            if (!nedenler.TryGetValue(GunNedenServisi.K(p.PersonelKodu), out var kisi)) return true;
            return gunler.Any(g => !kisi.ContainsKey(g));
        }).ToList();
    }

    /// <summary>Seçilen bölgelere bağlı şube adları</summary>
    private static List<string> BolgeSubeAdlari(FormAyarlari ayar, string[] bolgeler)
    {
        var kodlar = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => bolgeler.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        /* Hem şube ADI hem KODU döndürülür.
        
           Eşleştirme Mikro'daki iş grubu adıyla yapılıyor ve bu ad kimi
           şubede tanımdaki ada, kimi şubede koduna denk geliyor. Yalnızca
           ada bakmak, kodu iş grubu adıyla aynı olan şubeleri (Kavaklı
           gibi) bölge raporunun dışında bırakıyordu. */
        var sonuc = new List<string>();

        foreach (var k in kodlar)
        {
            sonuc.Add(k);

            var ad = (ayar.Subeler ?? new List<Sube>())
                .FirstOrDefault(x => string.Equals(x.Kod, k,
                    StringComparison.OrdinalIgnoreCase))?.Ad;

            if (!string.IsNullOrWhiteSpace(ad)) sonuc.Add(ad);
        }

        return sonuc.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>Birimin hangi bölgeye bağlı olduğunu bulur</summary>
    private static string BolgeBul(FormAyarlari ayar, string birim)
    {
        var hedef = Anahtar(birim);

        foreach (var b in ayar.Bolgeler ?? new List<BolgeTanimi>())
        {
            foreach (var kod in b.Subeler ?? new List<string>())
            {
                var ad = (ayar.Subeler ?? new List<Sube>())
                    .FirstOrDefault(x => string.Equals(x.Kod, kod,
                        StringComparison.OrdinalIgnoreCase))?.Ad ?? kod;

                if (Anahtar(ad) == hedef) return b.Ad;
            }
        }

        return "Tanımsız";
    }

    /// <summary>Birim adını karşılaştırılabilir anahtara indirger</summary>
    private static string Anahtar(string metin)
    {
        if (string.IsNullOrWhiteSpace(metin)) return "";

        var buyuk = metin.Trim().ToUpperInvariant();

        foreach (var (k, h) in new[]
        {
            ('İ', 'I'), ('Ş', 'S'), ('Ğ', 'G'),
            ('Ü', 'U'), ('Ö', 'O'), ('Ç', 'C')
        })
        {
            buyuk = buyuk.Replace(k, h);
        }

        var temiz = new string(buyuk.Where(char.IsLetterOrDigit).ToArray());

        foreach (var ek in new[] { "SUBESI", "SUBE", "MAGAZASI", "MAGAZA", "MARKET" })
        {
            if (temiz.EndsWith(ek, StringComparison.Ordinal) && temiz.Length > ek.Length)
                return temiz[..^ek.Length];
        }

        return temiz;
    }

    /// <summary>
    /// Kimlik numarasını karşılaştırılabilir hâle getirir.
    ///
    /// Araya boşluk, tire gibi karakterler karışabildiği için yalnızca
    /// rakamlar bırakılır; biçim farkı eşleşmeyi bozmasın.
    /// </summary>
    private static string Rakamlar(string metin) =>
        new((metin ?? "").Where(char.IsDigit).ToArray());

    /// <summary>
    /// Kişi okutmuş mu.
    ///
    /// Eşleştirme <c>Persons.RegistrationNumber</c> ile Mikro'daki T.C.
    /// kimlik numarası arasında yapılır. iCard'daki <c>PersonId</c> yalnızca
    /// o sistemin kendi iç anahtarıdır, Mikro ile bağı yoktur.
    /// </summary>
    private static bool Okuttu(HashSet<string> okutanlar, PersonelKaydi kisi)
    {
        var kimlik = Rakamlar(kisi.KimlikNo);

        return kimlik.Length == 11 && okutanlar.Contains(kimlik);
    }

    /// <summary>
    /// Aralıkta en az bir kez okutan kimlik numaraları: iCard ve Biçen360
    /// uygulaması birlikte. Uygulama okutmaları sicil ile tutulduğu için
    /// personel listesinden kimlik numarasına çevriliyor.
    /// </summary>
    private HashSet<string> OkutanlarAl(DateTime g1, DateTime g2, List<PersonelKaydi> personeller)
    {
        var sonuc = new HashSet<string>(StringComparer.Ordinal);

        try
        {
            using var db = _vt.GecisBaglantisi();

            var kimlikler = db.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(p.RegistrationNumber))
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE CAST(t.TransitionDate AS DATE) BETWEEN @g1 AND @g2
  AND p.RegistrationNumber IS NOT NULL",
                new { g1 = g1.Date, g2 = g2.Date }, commandTimeout: 120);

            sonuc.UnionWith(kimlikler.Select(Rakamlar).Where(x => x.Length > 0));
        }
        catch
        {
            /* Geçiş sistemi kapalıysa yalnızca uygulama okutmaları sayılır */
        }

        var mobilKodlar = MobilOkutmaKaynagi.Aralik(_vt, g1, g2)
            .Select(x => x.PersonelKodu)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (mobilKodlar.Count > 0)
            sonuc.UnionWith(personeller
                .Where(x => mobilKodlar.Contains((x.PersonelKodu ?? "").Trim()))
                .Select(x => Rakamlar(x.KimlikNo))
                .Where(x => x.Length == 11));

        return sonuc;
    }

    /// <summary>Mağazanın kaç gündür hiç okutmadığı; en fazla 30 gün</summary>
    private int SifirGun(List<string> kimlikler, List<string> kodlar, DateTime baslangic)
    {
        var sinir = baslangic.AddDays(-30);
        DateTime? sonTarih = null;

        if (kimlikler.Count > 0)
        {
            try
            {
                using var db = _vt.GecisBaglantisi();

                sonTarih = db.ExecuteScalar<DateTime?>(@"
SELECT MAX(CAST(t.TransitionDate AS DATE))
FROM Transitions t
    INNER JOIN Persons p ON p.PersonId = t.PersonId
WHERE LTRIM(RTRIM(p.RegistrationNumber)) IN @kimlikler
  AND CAST(t.TransitionDate AS DATE) >= @sinir",
                    new { kimlikler, sinir }, commandTimeout: 60);
            }
            catch
            {
                /* iCard kapalı: uygulama okutmalarına bakılır */
            }
        }

        var mobilSon = MobilOkutmaKaynagi.SonTarih(_vt, kodlar, sinir);

        if (mobilSon is not null && (sonTarih is null || mobilSon > sonTarih)) sonTarih = mobilSon;

        if (sonTarih is null) return kimlikler.Count == 0 ? 0 : 30;

        return Math.Max(0, (baslangic.Date - sonTarih.Value.Date).Days);
    }
}

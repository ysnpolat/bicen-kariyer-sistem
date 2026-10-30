using System.Data;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Arıza soru akışı.
///
/// <para>
/// Personel arıza türünü seçtikten sonra kaydı tek bir serbest metinle
/// bitiriyordu ("kasam çalışmıyor"). Teknisyen mağazaya gidene kadar neyin
/// bozulduğunu bilmiyordu. Akış bunun yerine adım adım soruyor:
/// <c>Yazarkasa › Fiş yazıcı › Silik çıkarıyor</c>.
/// </para>
///
/// <para>
/// Adımlar tek bir ağaçta duruyor. Ayrı bir "donanım" ve ayrı bir "soru"
/// tablosu denendi ve iki seviyeyle sınırlı kalıyordu; oysa teknik işlerde
/// <c>Dolap › Şarküteri › Kapak › Conta</c> gibi istenildiği kadar
/// derinleşen kırılımlar var. Bir düğüm hem seçenek hem de kendi alt
/// seçeneklerinin sorusudur: <c>ad</c> seçenek metnini, <c>soru</c> ise
/// altındakiler sorulurken ekranda yazacak cümleyi tutar.
/// </para>
/// </summary>
public class ArizaAkisServisi
{
    /// <summary>Alt seçeneği olan ama sorusu yazılmamış adım için.</summary>
    public const string VarsayilanSoru = "Hangisi?";

    private static readonly string[] Oncelikler = { "dusuk", "orta", "yuksek", "acil" };

    /* ==================================================================== */
    /* Okuma                                                                */
    /* ==================================================================== */

    /// <summary>Bir arıza türünün bütün adımları; ağaç bellekte kuruluyor.</summary>
    /// <remarks>
    /// Özyinelemeli SQL yerine tek sorgu: bir türün adım sayısı birkaç yüzü
    /// geçmiyor ve her seviye için ayrı gidiş dönüş, mobilde ekran
    /// açılışını gözle görülür yavaşlatıyordu.
    /// </remarks>
    public List<Adim> Adimlar(IDbConnection db, int turId, bool yalnizAktif)
    {
        var liste = db.Query<Adim>(@"
SELECT
    id            AS Id,
    tur_id        AS TurId,
    ust_id        AS UstId,
    ad            AS Ad,
    soru          AS Soru,
    ipucu         AS Ipucu,
    coklu         AS Coklu,
    cihaz_turu    AS CihazTuru,
    aciklama_ister    AS AciklamaIster,
    aciklama_zorunlu  AS AciklamaZorunlu,
    gorsel_ister      AS GorselIster,
    gorsel_zorunlu    AS GorselZorunlu,
    oncelik       AS Oncelik,
    aktif         AS Aktif,
    sira          AS Sira
FROM B360_ARIZA_ADIM
WHERE tur_id = @turId
ORDER BY sira, ad", new { turId }).ToList();

        return yalnizAktif ? liste.Where(x => x.Aktif).ToList() : liste;
    }

    /// <summary>
    /// Adım listesini iç içe ağaca çevirir.
    ///
    /// <paramref name="kullanim"/> verilirse her düğüme kaç kayıtta
    /// kullanıldığı da yazılır; yönetim ekranı silme uyarısını buna göre
    /// gösteriyor.
    /// </summary>
    public List<object> Agac(List<Adim> adimlar, IDictionary<int, int> kullanim = null)
    {
        List<object> Dallar(int? ustId) =>
            adimlar
                .Where(a => a.UstId == ustId)
                .OrderBy(a => a.Sira).ThenBy(a => a.Ad)
                .Select(a => (object)new
                {
                    a.Id,
                    a.UstId,
                    a.Ad,
                    a.Soru,
                    a.Ipucu,
                    a.Coklu,
                    a.CihazTuru,
                    a.AciklamaIster,
                    a.AciklamaZorunlu,
                    a.GorselIster,
                    a.GorselZorunlu,
                    a.Oncelik,
                    a.Aktif,
                    a.Sira,
                    kullanim = kullanim is not null && kullanim.TryGetValue(a.Id, out var s) ? s : 0,
                    cocuklar = Dallar(a.Id)
                })
                .ToList();

        return Dallar(null);
    }

    /// <summary>Bir adımın altında etkin seçenek var mı.</summary>
    public static bool AltiVar(List<Adim> adimlar, int adimId) =>
        adimlar.Any(a => a.UstId == adimId && a.Aktif);

    /* ==================================================================== */
    /* Doğrulama                                                            */
    /* ==================================================================== */

    /// <summary>
    /// Mobilden gelen seçimleri doğrular ve kayda yazılacak hâle getirir.
    ///
    /// <para>
    /// İstemciden yalnızca adım kimlikleri alınıyor; soru ve cevap metinleri
    /// sunucuda tablodan okunuyor. Metne güvenilseydi kayıt geçmişi
    /// istemcinin yazdığı her şeyi kabul ederdi.
    /// </para>
    ///
    /// <para>
    /// Zincir baştan sona yürütülüyor: her seçimin üstü bir önceki seçim
    /// olmalı. Kardeşlerin arka arkaya gelmesine yalnızca üst adım
    /// <c>coklu</c> ise izin var — birden çok belirti işaretlenebilsin diye.
    /// Çoklu seçim yapılan yer son adımdır: hangi dalın altına inileceği
    /// belirsiz kalırdı.
    /// </para>
    /// </summary>
    public Cozum Coz(IDbConnection db, int turId, string turSorusu, bool akisZorunlu,
                     IEnumerable<AkisYanitGirdi> gelen)
    {
        var yanitlar = (gelen ?? Enumerable.Empty<AkisYanitGirdi>())
            .Where(y => y is not null && y.AdimId > 0).ToList();

        var adimlar = Adimlar(db, turId, yalnizAktif: true);

        /* Akış tanımlı değilse eski davranış: serbest başlık ve açıklama.
           Tanımsız bir türü "eksik" saymak, kategori tanımlanmadan kayıt
           açılamaz hâle getirirdi. */
        if (adimlar.Count == 0)
            return yanitlar.Count == 0
                ? Cozum.Bos()
                : Cozum.Hatali("Bu arıza türü için soru akışı tanımlı değil.");

        if (yanitlar.Count == 0)
            return akisZorunlu
                ? Cozum.Hatali("Arıza türü için soruları yanıtlayınız.")
                : Cozum.Bos();

        var sozluk = adimlar.ToDictionary(a => a.Id);

        var cozulmus = new List<AkisYanit>();
        var parcalar = new List<string>();

        int? beklenenUst = null;      /* Bu seviyede seçilecek adımın üstü   */
        Adim onceki = null;           /* Bir önceki seçim                     */
        var seviye = 0;
        var kardesSayisi = 0;

        foreach (var yanit in yanitlar)
        {
            if (!sozluk.TryGetValue(yanit.AdimId, out var adim))
                return Cozum.Hatali("Seçilen adım bulunamadı ya da pasife alınmış.");

            var kardes = onceki is not null && adim.UstId == onceki.UstId;

            if (kardes)
            {
                /* Aynı seviyede ikinci bir seçim: yalnızca üst adım çoklu
                   işaretlenmişse geçerli. */
                var ust = adim.UstId is null ? null : sozluk.GetValueOrDefault(adim.UstId.Value);

                if (ust is null || !ust.Coklu)
                    return Cozum.Hatali("Bu adımda yalnızca bir seçim yapılabilir.");

                kardesSayisi++;
            }
            else
            {
                /* Çoklu seçim yapılan yer son adımdır: iki seçenek
                   işaretlendikten sonra hangisinin altına inileceği
                   belirsiz kalırdı. */
                if (kardesSayisi > 0)
                    return Cozum.Hatali("Birden fazla seçim yapılan adımda alt kırılıma inilemez.");

                if (adim.UstId != beklenenUst)
                    return Cozum.Hatali("Soru akışı sırası bozuk; ekranı yenileyip tekrar deneyiniz.");

                seviye = cozulmus.Count == 0 ? 0 : seviye + 1;
            }

            var aciklama = string.IsNullOrWhiteSpace(yanit.Aciklama) ? null : yanit.Aciklama.Trim();

            if (adim.AciklamaZorunlu && aciklama is null)
                return Cozum.Hatali($"\"{adim.Ad}\" için açıklama giriniz.");

            cozulmus.Add(new AkisYanit(
                adim.Id,
                seviye,
                SoruMetni(adim.UstId is null ? null : sozluk.GetValueOrDefault(adim.UstId.Value), turSorusu),
                adim.Ad,
                adim.AciklamaIster || adim.AciklamaZorunlu ? aciklama : null,
                cozulmus.Count));

            if (kardes)
            {
                /* Aynı seviyedeki seçimler özette yan yana: 'Fiş yazıcı ›
                   Silik çıkarıyor + Kâğıt sıkışıyor" */
                parcalar[^1] = $"{parcalar[^1]} + {adim.Ad}";
            }
            else
            {
                parcalar.Add(adim.Ad);
                beklenenUst = adim.Id;
            }

            onceki = adim;
        }

        /* Yarım bırakılmış akış: alt seçenekleri olan bir adımda durulmuş.
           Türde zorunlu işaretliyse kabul edilmiyor; işaretli değilse
           personel akışı istediği yerde bitirebiliyor.

           Çoklu seçimle biten akış tamam sayılıyor; orada zaten aşağı
           inilmiyor. */
        if (akisZorunlu && kardesSayisi == 0 && onceki is not null &&
            AltiVar(adimlar, onceki.Id))
            return Cozum.Hatali("Soru akışını sonuna kadar tamamlayınız.");

        /* Öncelik en derindeki tanımdan geliyor: 'kasa hiç açılmıyor' gibi
           uç bir seçenek, üstündeki genel kategorinin önceliğini ezmeli. */
        var oncelik = cozulmus
            .Select(y => sozluk[y.AdimId].Oncelik)
            .LastOrDefault(o => !string.IsNullOrWhiteSpace(o) && Oncelikler.Contains(o));

        /* Cihaz türü tersten: en son hangi adımda tanımlıysa o geçerli */
        var cihazTuru = cozulmus
            .Select(y => sozluk[y.AdimId].CihazTuru)
            .LastOrDefault(c => !string.IsNullOrWhiteSpace(c));

        return new Cozum(
            null,
            string.Join(" › ", parcalar),
            oncelik,
            cihazTuru,
            onceki?.Id,
            cozulmus);
    }

    /// <summary>
    /// Bir adımın alt seçenekleri sorulurken ekranda yazacak cümle.
    ///
    /// İlk seviyede tür üzerindeki soru kullanılıyor; o da boşsa genel bir
    /// ifade. Boş bırakılan soruyu ekranda boş göstermek, personelin neye
    /// cevap verdiğini anlamamasına yol açıyordu.
    /// </summary>
    public static string SoruMetni(Adim ust, string turSorusu) =>
        !string.IsNullOrWhiteSpace(ust?.Soru) ? ust.Soru.Trim()
        : ust is null && !string.IsNullOrWhiteSpace(turSorusu) ? turSorusu.Trim()
        : VarsayilanSoru;

    /* ==================================================================== */
    /* Yazma                                                                */
    /* ==================================================================== */

    /// <summary>Çözülmüş yanıtları kayda yazar.</summary>
    /// <remarks>
    /// Soru ve cevap metinleri kayıt anında yazılıyor, sonradan adım
    /// tablosundan okunmuyor: bir seçeneğin adı değiştiğinde ya da pasife
    /// alındığında geçmiş kayıtların ne dediği değişmemeli.
    /// </remarks>
    public void Yaz(IDbConnection db, int arizaId, IEnumerable<AkisYanit> yanitlar,
                    IDbTransaction islem = null)
    {
        foreach (var y in yanitlar)
        {
            db.Execute(@"
INSERT INTO B360_ARIZA_YANIT (ariza_id, adim_id, seviye, soru, cevap, aciklama, sira)
VALUES (@arizaId, @AdimId, @Seviye, @Soru, @Cevap, @Aciklama, @Sira)",
                new { arizaId, y.AdimId, y.Seviye, y.Soru, y.Cevap, y.Aciklama, y.Sira },
                islem);
        }
    }

    /// <summary>Kaydın yanıtları; panel ve mobil ayrıntı ekranı okuyor.</summary>
    public List<dynamic> Yanitlar(IDbConnection db, int arizaId) =>
        db.Query(@"
SELECT adim_id AS adimId, seviye, soru, cevap, aciklama
FROM B360_ARIZA_YANIT WHERE ariza_id = @arizaId ORDER BY sira, id",
            new { arizaId }).ToList();

    /* ==================================================================== */

    public sealed class Adim
    {
        public int Id { get; set; }
        public int TurId { get; set; }
        public int? UstId { get; set; }
        public string Ad { get; set; }

        /// <summary>Alt seçenekler sorulurken ekranda yazacak cümle.</summary>
        public string Soru { get; set; }

        /// <summary>Sorunun altındaki küçük yardım metni.</summary>
        public string Ipucu { get; set; }

        /// <summary>Alt seçeneklerden birden fazlası işaretlenebilir.</summary>
        public bool Coklu { get; set; }

        /// <summary>Seçilince envanterden bu türde cihaz sorulur.</summary>
        public string CihazTuru { get; set; }

        public bool AciklamaIster { get; set; }
        public bool AciklamaZorunlu { get; set; }
        public bool GorselIster { get; set; }
        public bool GorselZorunlu { get; set; }

        /// <summary>Seçilirse kaydın önceliği bu olur.</summary>
        public string Oncelik { get; set; }

        public bool Aktif { get; set; }
        public int Sira { get; set; }
    }

    /// <summary>Kayda yazılacak tek bir yanıt.</summary>
    public sealed record AkisYanit(int AdimId, int Seviye, string Soru, string Cevap,
                                   string Aciklama, int Sira);

    /// <summary>Doğrulama sonucu.</summary>
    public sealed record Cozum(string Hata, string Ozet, string Oncelik, string CihazTuru,
                               int? SonAdimId, List<AkisYanit> Yanitlar)
    {
        public bool Gecerli => Hata is null;
        public bool Dolu => Yanitlar is { Count: > 0 };

        public static Cozum Bos() => new(null, null, null, null, null, new List<AkisYanit>());

        public static Cozum Hatali(string hata) =>
            new(hata, null, null, null, null, new List<AkisYanit>());
    }
}

/// <summary>Mobilden gelen tek seçim.</summary>
public class AkisYanitGirdi
{
    public int AdimId { get; set; }

    /// <summary>Adımda açıklama isteniyorsa personelin yazdığı metin.</summary>
    public string Aciklama { get; set; }
}

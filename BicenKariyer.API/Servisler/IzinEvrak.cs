using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebinin evrak durumu
/// ---------------------------------------------------------------------------
/// Akış:
/// <list type="number">
/// <item>Talep açılınca form otomatik doldurulup şubeye ya da İK'ya
/// gönderilir; personelin ana sayfasına "İzin evrakınızı yükleyin" kartı
/// düşer. Süre 3 gün (<c>mb_son</c>).</item>
/// <item>Personel imzalı formu (kalem <c>form</c>) ve belge istenen
/// türlerde (mazeret, rapor) destekleyici belgeyi (<c>destek</c>) yükler.
/// Hepsi gelince <c>mb_yukleme</c> dolar.</item>
/// <item>Personel ıslak imzalı aslını İK'ya gönderdiğini işaretler
/// (<c>asil_gonderim</c>).</item>
/// <item>İK aslı gelince imzalayıp yükler (<c>ik</c>, talebin
/// <c>belge_id</c>'si) ve onaylar; ya da onaylayıp evrakı sonraya bırakır
/// (<c>evrak_sonra</c>): talep "İK evrakı bekleniyor" olarak kalır.</item>
/// </list>
/// </summary>
public static class IzinEvrak
{
    public const string Form = "form";
    public const string Destek = "destek";
    public const string Ik = "ik";

    /// <summary>Personelin yüklemesi gereken kalemler.</summary>
    public static List<(string Kalem, string Ad)> Gerekenler(bool belgeGerekli, string destekAdi = null)
    {
        var l = new List<(string, string)> { (Form, "İmzalı izin formu") };

        if (belgeGerekli)
            l.Add((Destek, string.IsNullOrWhiteSpace(destekAdi)
                ? "Destekleyici belge (rapor, doğum, evlilik, ölüm belgesi…)"
                : destekAdi));

        return l;
    }

    /* -------------------------------------------- mazeret türü (07.10.2026) */

    /// <summary>Seçenek listesi (Ayarlar Merkezi): mazeret izninin alt türleri</summary>
    public const string MazeretListesi = "mazeretTurleri";

    /// <summary>
    /// Raporlu izin (23.10.2026): adında "rapor" geçen tür. Rapor belgesi
    /// talep ekranında yükleniyor; imzalı form ve mail yok, onaylayanlar
    /// raporu görüp onaylıyor.
    /// </summary>
    public static bool RaporluMu(string tur) =>
        (tur ?? "").ToLower(new System.Globalization.CultureInfo("tr-TR")).Contains("rapor");

    /// <summary>Raporlu talepte yüklenen raporun evrak türü</summary>
    public const string RaporEvrakTuru = "Rapor";

    /// <summary>Alt türü sorulan izin türü (adında "mazeret" geçen)</summary>
    public static bool MazeretMi(string tur) =>
        (tur ?? "").ToLower(new System.Globalization.CultureInfo("tr-TR")).Contains("mazeret");

    /// <summary>
    /// Talepte destekleyici belge isteniyor mu. Mazeret türü seçildiyse
    /// listedeki "belge istenir" işareti (raporlu: evet, okul işleri: hayır);
    /// seçilmediyse (1.5) izin türünün ayarı.
    /// </summary>
    public static bool TalepBelgeGerekli(HashSet<string> gerekliTurler, string tur, string altTur)
    {
        if (!string.IsNullOrWhiteSpace(altTur))
        {
            var oge = SecenekListesi.Tumu(MazeretListesi)
                .FirstOrDefault(x => string.Equals(x.Ad, altTur.Trim(), StringComparison.OrdinalIgnoreCase));

            if (oge is not null) return oge.BelgeGerekli;
        }

        return gerekliTurler.Contains((tur ?? "").Trim());
    }

    /// <summary>Destekleyici belgenin ekranda görünen adı</summary>
    public static string DestekAdi(string tur, string altTur)
    {
        var tr = new System.Globalization.CultureInfo("tr-TR");
        var metin = $"{tur} {altTur}".ToLower(tr);

        if (metin.Contains("rapor")) return "Rapor belgesi";
        if (!string.IsNullOrWhiteSpace(altTur)) return $"Destekleyici belge ({altTur.Trim()})";
        return null;
    }

    /// <summary>İmzalı form yüklendi mi</summary>
    public static bool FormYuklendi(List<Kayit> evraklar) => (evraklar ?? new()).Any(e => e.Kalem == Form);

    /// <summary>İlk imzalı formun yüklendiği an (otomatik onay süresi bundan başlar)</summary>
    public static DateTime? FormZamani(IDbConnection db, int talepId)
    {
        try
        {
            return db.ExecuteScalar<DateTime?>(@"
SELECT MIN(e.olusturma) FROM KRY_IZIN_TALEP_EVRAK e
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = e.belge_id AND b.silindi = 0
WHERE e.talep_id = @talepId AND e.kalem = N'form'", new { talepId });
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Türlere göre belge istenip istenmediği (İzin Türleri → belge istenir).</summary>
    public static HashSet<string> BelgeGerekliTurler(IDbConnection db)
    {
        try
        {
            return db.Query<string>("SELECT ad FROM KRY_IZIN_TURU WHERE belge_gerekli = 1")
                .Select(x => (x ?? "").Trim())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    public sealed record Kayit(int Id, int TalepId, int BelgeId, string Kalem, string Tur,
                               string Yukleyen, DateTime Olusturma, string Baslik, string OzgunAd);

    /// <summary>Taleplerin evrakları (silinmemiş belgeler), talep kimliğine göre.</summary>
    public static Dictionary<int, List<Kayit>> Evraklar(IDbConnection db, IEnumerable<int> talepIdleri)
    {
        var idler = talepIdleri.Distinct().ToList();
        var sonuc = new Dictionary<int, List<Kayit>>();

        if (idler.Count == 0) return sonuc;

        try
        {
            foreach (var parca in idler.Chunk(1500))
                foreach (var r in db.Query(@"
SELECT e.id, e.talep_id AS talepId, e.belge_id AS belgeId, e.kalem, e.tur, e.yukleyen, e.olusturma,
       b.baslik, b.ozgun_ad AS ozgunAd
FROM KRY_IZIN_TALEP_EVRAK e
INNER JOIN KRY_PERSONEL_BELGE b ON b.id = e.belge_id AND b.silindi = 0
WHERE e.talep_id IN @parca
ORDER BY e.olusturma", new { parca }))
                {
                    var k = new Kayit((int)r.id, (int)r.talepId, (int)r.belgeId, (string)r.kalem,
                        (string)r.tur, (string)r.yukleyen, (DateTime)r.olusturma, (string)r.baslik, (string)r.ozgunAd);

                    if (!sonuc.TryGetValue(k.TalepId, out var l)) sonuc[k.TalepId] = l = new List<Kayit>();
                    l.Add(k);
                }
        }
        catch
        {
            /* Tablo henüz yoksa boş */
        }

        return sonuc;
    }

    /// <summary>Personelin yüklemesi gereken kalemlerin hepsi geldi mi.</summary>
    public static bool PersonelTamam(bool belgeGerekli, List<Kayit> evraklar) =>
        Gerekenler(belgeGerekli).All(g => (evraklar ?? new()).Any(e => e.Kalem == g.Kalem));

    /// <summary>Ekrana giden özet.</summary>
    public static object Ozet(dynamic talep, bool belgeGerekli, List<Kayit> evraklar,
        string destekAdi = null, bool formSarti = false)
    {
        evraklar ??= new List<Kayit>();

        DateTime? son = talep.mb_son as DateTime?;
        var personelTamam = PersonelTamam(belgeGerekli, evraklar);
        var ikVar = talep.belge_id is not null;

        return new
        {
            son,
            gecikti = !personelTamam && son is DateTime s && s < DateTime.Now,
            kalanSaat = son is DateTime s2 ? Math.Round((s2 - DateTime.Now).TotalHours, 1) : (double?)null,
            /* Şube personeli: imzalı form yüklenmeden birim yöneticisi onaylayamaz */
            formSarti,
            formBekleniyor = formSarti && !FormYuklendi(evraklar),
            gerekenler = Gerekenler(belgeGerekli, destekAdi).Select(g => new
            {
                kalem = g.Kalem,
                ad = g.Ad,
                yuklendi = evraklar.Any(e => e.Kalem == g.Kalem),
            }),
            personelTamam,
            personelYukleme = (DateTime?)(talep.mb_yukleme as DateTime?),
            asilGonderim = (DateTime?)(talep.asil_gonderim as DateTime?),
            ikVar,
            evrakSonra = talep.evrak_sonra == true,
            dosyalar = evraklar.Select(e => new
            {
                e.Id, e.BelgeId, e.Kalem, e.Tur, e.Yukleyen, e.Olusturma, e.OzgunAd
            }),
        };
    }
}

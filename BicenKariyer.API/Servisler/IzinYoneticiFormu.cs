using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebinde imzalı formu birim yöneticisi yükler (09.10.2026).
///
/// <para>
/// Form şartlı taleplerde (şube personeli, <c>form_sarti</c>) form şube
/// mailine gider; çıktı imzalanır ve 1. onaylayıcı (birim yöneticisi)
/// imzalı formu Biçen360'tan yükler. Form yüklenmeden onaylayamaz. Bölge
/// müdürü formu görerek onaylar, sonra İK (aslı ve kendi imzalı formuyla).
/// Zincirli talepte (26.10.2026) zincirdeki her kişi adımı (bölge müdürü,
/// GMY) formu görerek onaylar.
/// Personel formu yüklemez; mazeret / rapor gibi destekleyici belgeyi
/// yüklemeye devam eder.
/// </para>
///
/// <para>
/// Yayındaki 1.6'da İzin Onayları kartında yükleme düğmesi yok: yöneticinin
/// ana sayfasına "İzin formunu yükleyin" kartı açılır, kartın evrak
/// penceresi talebin kendi kimliğiyle MazeretBelge'ye yükler. 1.7 aynı
/// ucu İzin Onayları kartından çağırır.
/// </para>
/// </summary>
public static class IzinYoneticiFormu
{
    public const string Kaynak = "sistem:izinform";

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    public static string FormYolu(int id) => $"/api/IzinTalep/{id}/ImzaliForm";

    /// <summary>Bu kişi talebin birim yöneticisi (1. aşama onaylayıcısı) mı</summary>
    public static bool BirimYoneticisiMi(OrgOnayServisi org, PersonelKaydi kisi, dynamic t)
    {
        if (kisi is null || t is null) return false;
        if (K((string)t.personel_kodu) == K(kisi.PersonelKodu)) return false;

        /* Zincirli talep (26.10.2026): zincirin ilk adımındaki onaylayan */
        if (IzinOnayZinciri.Talepten((object)t) is { } zt)
            return IzinOnayZinciri.SicilYetkili(zt.Zincir.Adimlar[0], kisi.PersonelKodu);

        try
        {
            return org.KararVerebilir(kisi.PersonelKodu, (string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi, 1);
        }
        catch
        {
            return false;
        }
    }

    private static string AdAnahtari(string s) =>
        System.Text.RegularExpressions.Regex.Replace((s ?? "").Replace("(Biçen360)", ""), @"\s+", " ")
            .Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));

    /// <summary>
    /// Bu kişi talepte daha önce karar vermiş mi (26.10.2026): mobil karar
    /// magaza_kisi / bolge_kisi alanlarına ve zincir adımlarına "Ad Soyad"
    /// olarak yazılıyor. Onayladıktan sonra organizasyon şeması ya da onay
    /// tablosu değişse de yönetici kendi karar verdiği talebin evrakını
    /// yeniden açabilsin.
    /// </summary>
    public static bool KararVermisMi(PersonelKaydi kisi, dynamic t)
    {
        if (kisi is null || t is null) return false;

        var ad = AdAnahtari($"{kisi.Ad} {kisi.Soyad}");
        if (ad.Length == 0) return false;

        try
        {
            if (t is IDictionary<string, object> s)
            {
                if (s.TryGetValue("magaza_kisi", out var m) && AdAnahtari(m as string) == ad) return true;
                if (s.TryGetValue("bolge_kisi", out var b) && AdAnahtari(b as string) == ad) return true;
            }

            if (IzinOnayZinciri.Talepten((object)t) is { } zt)
                return zt.Zincir.Adimlar.Any(a => a.Tur == IzinOnayZinciri.TurKisi && AdAnahtari(a.Kim) == ad);
        }
        catch
        {
            /* alan yoksa karar vermemiş sayılır */
        }

        return false;
    }

    /// <summary>
    /// Formu / evrakı görebilir mi: personelin kendisi, birim yöneticisi ya
    /// da bölge müdürü (onay sırasında ve sonrasında), zincirdeki kişi
    /// adımlarının onaylayanları ya da talepte karar vermiş yönetici.
    /// Karar verildikten sonra da açılabiliyor (26.10.2026): yönetici
    /// onayladığı talebin evrakını yeniden görüntüleyemiyordu.
    /// </summary>
    public static bool FormGorebilir(OrgOnayServisi org, PersonelKaydi kisi, dynamic t)
    {
        if (kisi is null || t is null) return false;
        if (K((string)t.personel_kodu) == K(kisi.PersonelKodu)) return true;

        /* Zincirli talep (26.10.2026): zincirin herhangi bir kişi adımındaki
           onaylayan (birim yöneticisi, bölge müdürü, GMY) formu görür */
        if (IzinOnayZinciri.Talepten((object)t) is { } zt && IzinOnayZinciri.ZincirdeMi(zt.Zincir, kisi.PersonelKodu))
            return true;

        if (KararVermisMi(kisi, t)) return true;

        try
        {
            return org.KararVerebilir(kisi.PersonelKodu, (string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi, 1)
                || org.KararVerebilir(kisi.PersonelKodu, (string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi, 2);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Mobil kart için talebin evrak listesi (26.10.2026): imzalı form,
    /// rapor / mazeret belgesi. İK'nın kendi evrakı (kalem "ik") yöneticiye
    /// gitmiyor. Yol <c>{id}/Evrak/{belgeId}</c>: yetki orada FormGorebilir ile.
    /// </summary>
    public static List<object> EvrakListesi(int talepId, List<IzinEvrak.Kayit> evraklar) =>
        (evraklar ?? new())
            .Where(e => e.Kalem != IzinEvrak.Ik)
            .Select(e => (object)new
            {
                belgeId = e.BelgeId,
                kalem = e.Kalem,
                ad = e.Kalem == IzinEvrak.Form ? "İmzalı izin formu"
                    : string.IsNullOrWhiteSpace(e.Tur) ? (e.Baslik ?? "Belge") : e.Tur,
                dosya = e.OzgunAd,
                tarih = e.Olusturma,
                yol = $"/api/IzinTalep/{talepId}/Evrak/{e.BelgeId}",
            })
            .ToList();

    /// <summary>
    /// Kişinin yüklemesi gereken izin formları için ana sayfa kartları:
    /// birim yöneticisi aşamasında bekleyen, form şartlı, formu gelmemiş
    /// talepler. Aşaması geçenlerin ya da formu gelenlerin kartı kapanır.
    /// </summary>
    public static void KartlariHazirla(IDbConnection db, OrgOnayServisi org, PersonelKaydi kisi)
    {
        if (kisi is null || org is null) return;

        try
        {
            db.Execute(@"
UPDATE e SET durum = N'kapandi', kapandi = SYSDATETIME(), kapatan = N'Biçen360', kapanis_notu = N'Aşama geçti'
FROM KRY_TALEP_EKSIK e
INNER JOIN KRY_IZIN_TALEP t ON t.id = e.talep_id
WHERE e.tur = N'izin' AND e.gonderen = @kaynak AND e.durum <> N'kapandi'
  AND (t.iptal = 1 OR t.durum <> N'Bekliyor'
       OR EXISTS (SELECT 1 FROM KRY_IZIN_TALEP_EVRAK x
                  INNER JOIN KRY_PERSONEL_BELGE b ON b.id = x.belge_id AND b.silindi = 0
                  WHERE x.talep_id = t.id AND x.kalem = N'form'))", new { kaynak = Kaynak });

            var adaylar = db.Query(@"
SELECT t.* FROM KRY_IZIN_TALEP t
WHERE t.iptal = 0 AND t.durum = N'Bekliyor' AND t.form_sarti = 1
  AND t.olusturma >= DATEADD(DAY, -60, SYSDATETIME())
  AND NOT EXISTS (SELECT 1 FROM KRY_IZIN_TALEP_EVRAK x
                  INNER JOIN KRY_PERSONEL_BELGE b ON b.id = x.belge_id AND b.silindi = 0
                  WHERE x.talep_id = t.id AND x.kalem = N'form')
  AND NOT EXISTS (SELECT 1 FROM KRY_TALEP_EKSIK e
                  WHERE e.tur = N'izin' AND e.talep_id = t.id AND e.gonderen = @kaynak
                    AND LTRIM(RTRIM(e.hedef_kodu)) = @kod)", new { kaynak = Kaynak, kod = kisi.PersonelKodu.Trim() }).ToList();

            foreach (var t in adaylar)
            {
                if (!BirimYoneticisiMi(org, kisi, t)) continue;

                var ozet = $"{t.ad_soyad} · {t.tur} · {((DateTime)t.cikis_tarihi):dd.MM} – {((DateTime)t.donus_tarihi):dd.MM.yyyy}";

                db.Execute(@"
INSERT INTO KRY_TALEP_EKSIK (tur, talep_id, personel_kodu, ad_soyad, hedef_kodu, hedef_ad, talep_ozet, maddeler,
                             aciklama, son_tarih, gonderen, gonderen_ad, jeton_var)
VALUES (N'izin', @id, @pkod, @pad, @kod, @ad, @ozet, @madde, @aciklama, @son, @kaynak, N'Biçen360', 1)",
                    new
                    {
                        id = (int)t.id,
                        pkod = ((string)t.personel_kodu ?? "").Trim(),
                        pad = (string)t.ad_soyad,
                        kod = kisi.PersonelKodu.Trim(),
                        ad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                        ozet = ozet.Length > 200 ? ozet[..200] : ozet,
                        madde = "Personelin ve sizin imzaladığınız izin formu",
                        aciklama = "Şubeye maille gelen izin formunu personele imzalatın, siz de imzalayın. \"Evrakı yükle\" › \"İmzalı formu yükleyin\" ile formun fotoğrafını çekin. " +
                                   "Sonra İzin Onayları'ndan onaylayın; talep bölge müdürüne, ardından İnsan Kaynakları'na geçer. Islak imzalı aslını İK'ya gönderin.",
                        son = ((DateTime)t.olusturma).Date.AddDays(3),
                        kaynak = Kaynak,
                    });
            }
        }
        catch
        {
            /* tablo yoksa kart açılmaz; onay ekranındaki not yine yol gösterir */
        }
    }

    public static void KartlariKapat(IDbConnection db, int talepId, string not)
    {
        try
        {
            db.Execute(@"
UPDATE KRY_TALEP_EKSIK
SET durum = N'kapandi', kapandi = SYSDATETIME(), tamamlandi = COALESCE(tamamlandi, SYSDATETIME()),
    kapatan = N'Biçen360', kapanis_notu = @not
WHERE tur = N'izin' AND talep_id = @talepId AND gonderen = @kaynak AND durum <> N'kapandi'",
                new { talepId, not, kaynak = Kaynak });
        }
        catch
        {
            /* tablo yoksa geçilir */
        }
    }

    /// <summary>1.6 evrak penceresinin nesnesi (yöneticinin kartı): yalnızca imzalı form</summary>
    public static object EvrakNesnesi(IDbConnection db, int talepId)
    {
        var t = db.QueryFirstOrDefault(@"
SELECT id, ad_soyad, tur, alt_tur, cikis_tarihi, donus_tarihi, olusturma, durum, iptal
FROM KRY_IZIN_TALEP WHERE id = @talepId", new { talepId });
        if (t is null || t.iptal == true || (string)t.durum != "Bekliyor") return null;

        var yuklendi = IzinEvrak.FormYuklendi(IzinEvrak.Evraklar(db, new[] { talepId }).GetValueOrDefault(talepId));
        var son = ((DateTime)t.olusturma).Date.AddDays(3);

        return new
        {
            id = talepId,
            tur = $"{t.tur} · {t.ad_soyad}",
            altTur = (string)null,
            formBekleniyor = false,
            cikis = (DateTime)t.cikis_tarihi,
            donus = (DateTime)t.donus_tarihi,
            son,
            kalanSaat = (int)Math.Max(0, Math.Floor((son - DateTime.Now).TotalHours)),
            gecikti = false,
            tamam = yuklendi,
            belgeGerekli = false,
            asilGonderildi = true,
            gerekenler = new[]
            {
                new { kalem = IzinEvrak.Form, ad = "İmzalı izin formu", yuklendi, dosyalar = new List<string>() },
            },
        };
    }
}

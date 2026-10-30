using System.Data;
using System.Globalization;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Yöneticinin eksik bildirmesi (26.10.2026, Biçen360 2.0).
///
/// <para>
/// Onay sırasındaki yönetici (birim yöneticisi, bölge müdürü, GMY) talebi
/// reddetmek yerine "Eksik bildir" diyor: kısa bir açıklama yazıyor, talep
/// reddedilmiyor ve aynı adımda bekliyor; personel İK'nın eksik
/// bildirimindeki mekanizmayla (<see cref="TalepEksik"/>, KRY_TALEP_EKSIK,
/// ana sayfadaki turuncu kart, kişiye özel duyuru, anlık bildirim) eksiği
/// görüyor, evrakı yükleyip ya da "Tamamladım" deyip yöneticiye geri
/// bildiriyor. Yönetici sonra aynı karttan onaylıyor ya da reddediyor.
/// </para>
///
/// <para>
/// Kayıt İK'nınkinden <c>gonderen</c> ile ayrılıyor: <c>yonetici:SICIL</c>.
/// Personel tamamlayınca bildirim İK'ya değil bu sicile gidiyor; yönetici
/// karar verince kayıt kendiliğinden kapanıyor. İK panelinde kayıt yine
/// görünüyor (gönderen adıyla), İK isterse kapatabiliyor.
/// </para>
/// </summary>
public static class YoneticiEksik
{
    public const string OnEk = "yonetici:";

    private static readonly CultureInfo Tr = new("tr-TR");

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Kayıt bir yöneticiden mi (İK'dan ya da sistemden değil)</summary>
    public static bool YoneticidenMi(string gonderen) =>
        (gonderen ?? "").StartsWith(OnEk, StringComparison.OrdinalIgnoreCase);

    /// <summary>Bildiren yöneticinin sicili</summary>
    public static string Sicil(string gonderen) =>
        YoneticidenMi(gonderen) ? gonderen[OnEk.Length..].Trim() : null;

    /// <summary>Bildirimden açılacak ekran: Yönetici İşlemleri'nin ilgili kategorisi</summary>
    public static string Ekran(string tur) => tur == TalepEksik.Avans ? "izinonay|avans" : "izinonay|izin";

    /// <summary>Bekleyen kartı için açık / tamamlanmış kayıt</summary>
    public sealed class Kayit
    {
        public int Id { get; set; }
        public int TalepId { get; set; }
        public string Durum { get; set; }
        public string Aciklama { get; set; }
        public DateTime Tarih { get; set; }
        public DateTime? Goruldu { get; set; }
        public DateTime? Tamamlandi { get; set; }
        public string PersonelNotu { get; set; }
        public string Gonderen { get; set; }
        public string GonderenAd { get; set; }
        public bool JetonVar { get; set; }
    }

    /// <summary>Mobil karta giden biçim</summary>
    public static object Disari(Kayit k) => k is null ? null : new
    {
        id = k.Id,
        durum = k.Durum,
        aciklama = k.Aciklama,
        tarih = k.Tarih,
        goruldu = k.Goruldu,
        tamamlandi = k.Tamamlandi,
        personelNotu = k.PersonelNotu,
        bildiren = k.GonderenAd,
        jetonVar = k.JetonVar,
        durumAdi = k.Durum == TalepEksik.Tamamlandi
            ? "Personel eksiği tamamladığını bildirdi"
            : k.Goruldu is null ? "Eksik bildirildi · personel henüz görmedi" : "Eksik bildirildi · personelin düzeltmesi bekleniyor",
    };

    /// <summary>
    /// Taleplerin kapanmamış yönetici kayıtları (talep başına en yenisi).
    /// Bekleyen kartında "eksik bildirildi / personel tamamladı" şeridi için.
    /// </summary>
    public static Dictionary<int, Kayit> Acikler(IDbConnection db, string tur, IEnumerable<int> talepIdleri)
    {
        var idler = (talepIdleri ?? Enumerable.Empty<int>()).Distinct().ToList();
        var sonuc = new Dictionary<int, Kayit>();
        if (idler.Count == 0) return sonuc;

        try
        {
            var satirlar = db.Query<Kayit>(@"
SELECT id AS Id, talep_id AS TalepId, durum AS Durum, aciklama AS Aciklama, tarih AS Tarih, goruldu AS Goruldu,
       tamamlandi AS Tamamlandi, personel_notu AS PersonelNotu, gonderen AS Gonderen, gonderen_ad AS GonderenAd,
       CAST(ISNULL(jeton_var, 0) AS BIT) AS JetonVar
FROM KRY_TALEP_EKSIK
WHERE tur = @tur AND talep_id IN @idler AND durum <> N'kapandi' AND gonderen LIKE N'yonetici:%'
ORDER BY tarih DESC", new { tur, idler }).ToList();

            foreach (var s in satirlar)
                if (!sonuc.ContainsKey(s.TalepId)) sonuc[s.TalepId] = s;
        }
        catch
        {
            /* tablo yoksa şerit çıkmaz */
        }

        return sonuc;
    }

    /// <summary>Talebin açık yönetici kayıtları (personel tamamlayınca kime haber gidecek)</summary>
    public static List<Kayit> AcikYoneticiKayitlari(IDbConnection db, string tur, int talepId)
    {
        try
        {
            return db.Query<Kayit>(@"
SELECT id AS Id, talep_id AS TalepId, durum AS Durum, aciklama AS Aciklama, tarih AS Tarih, goruldu AS Goruldu,
       tamamlandi AS Tamamlandi, personel_notu AS PersonelNotu, gonderen AS Gonderen, gonderen_ad AS GonderenAd,
       CAST(ISNULL(jeton_var, 0) AS BIT) AS JetonVar
FROM KRY_TALEP_EKSIK
WHERE tur = @tur AND talep_id = @talepId AND durum = N'acik' AND gonderen LIKE N'yonetici:%'", new { tur, talepId }).ToList();
        }
        catch
        {
            return new List<Kayit>();
        }
    }

    /// <summary>
    /// Yönetici eksik bildirir: önceki açık kayıt kapanır, kişiye özel
    /// duyuru yazılır (1.5 bunu görür), kayıt açılır, anlık bildirim gider.
    /// Kaydın kimliği ve personelin bildirim jetonu olup olmadığı döner.
    /// </summary>
    public static async Task<(int Id, bool JetonVar)> Bildir(IDbConnection db, BildirimServisi bildirim, ILogger kayit,
        string tur, int talepId, PersonelKaydi yonetici, string unvan,
        string personelKodu, string personelAd, string ozet, string aciklama)
    {
        var yoneticiAd = $"{yonetici.Ad} {yonetici.Soyad}".Trim();
        var bildiren = string.IsNullOrWhiteSpace(unvan) ? yoneticiAd : $"{yoneticiAd} ({unvan})";
        if (bildiren.Length > 120) bildiren = bildiren[..120];

        var hedefKod = (personelKodu ?? "").Trim();
        aciklama = (aciklama ?? "").Trim();
        if (aciklama.Length > 600) aciklama = aciklama[..600];
        if (ozet is { Length: > 200 }) ozet = ozet[..200];

        var jetonVar = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod", new { kod = hedefKod }) > 0;

        var baslik = TalepEksik.Baslik(tur);
        var kisa = $"{ozet}: {bildiren} eksik bildirdi. {aciklama}";
        if (kisa.Length > 240) kisa = kisa[..237] + "…";

        /* Önceki açık kayıt (İK'nın ya da bu yöneticinin) yerini yenisine bırakıyor:
           personelin karşısına iki ayrı kart çıkmasın */
        db.Execute(@"
UPDATE KRY_TALEP_EKSIK SET durum = N'kapandi', kapandi = SYSDATETIME(), kapatan = @kim,
       kapanis_notu = N'Yeni eksik bildirimiyle yenilendi'
WHERE tur = @tur AND talep_id = @id AND durum <> N'kapandi'
  AND ISNULL(gonderen, N'') NOT IN (N'sistem:fmform', N'sistem:izinform', N'sistem:belge')",
            new { tur, id = talepId, kim = bildiren });

        /* 1.5'in göreceği yer: kişiye özel duyuru */
        int? duyuruId = null;
        try
        {
            var uzun = string.Join("\n", new[]
            {
                $"{ozet} için yöneticiniz {bildiren} bir eksik bildirdi:",
                $"• {aciklama}",
                "",
                tur == TalepEksik.Izin
                    ? "Eksiği giderip evrakı Biçen360 ana sayfasındaki karttan yükleyebilir ya da \"Tamamladım\" diyebilirsiniz; yöneticinize bildirim gider ve talebiniz aynı adımdan devam eder."
                    : "Eksiği giderip Biçen360 ana sayfasındaki karttan \"Tamamladım\" diyebilirsiniz; yöneticinize bildirim gider ve talebiniz aynı adımdan devam eder.",
            });

            duyuruId = DuyuruYazici.Ekle(db, new DuyuruYazici.Kayit
            {
                Baslik = baslik,
                Metin = uzun,
                Hedef = "kisi",
                HedefOzet = personelAd,
                PersonelKodu = hedefKod,
                Onemli = true,
                Gonderen = bildiren,
                YazanAd = yoneticiAd,
                YazanUnvan = unvan,
            });
        }
        catch (Exception h)
        {
            kayit?.LogWarning(h, "Yönetici eksik duyurusu yazılamadı: {Tur} {Id}", tur, talepId);
        }

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_TALEP_EKSIK
    (tur, talep_id, personel_kodu, ad_soyad, hedef_kodu, hedef_ad, talep_ozet, maddeler, aciklama,
     son_tarih, gonderen, gonderen_ad, duyuru_id, jeton_var)
OUTPUT INSERTED.id
VALUES (@tur, @talepId, @kod, @ad, @kod, @ad, @ozet, NULL, @aciklama,
        NULL, @gonderen, @gonderenAd, @duyuruId, @jetonVar)",
            new
            {
                tur,
                talepId,
                kod = hedefKod,
                ad = personelAd is { Length: > 120 } ? personelAd[..120] : personelAd,
                ozet,
                aciklama,
                gonderen = OnEk + (yonetici.PersonelKodu ?? "").Trim(),
                gonderenAd = bildiren,
                duyuruId,
                jetonVar,
            });

        await bildirim.Gonder(hedefKod, baslik, kisa, "anasayfa|eksik");

        return (id, jetonVar);
    }

    /// <summary>
    /// Personel eksiği tamamladı (evrak yükledi ya da "Tamamladım" dedi):
    /// bildiren yöneticiye haber gider. Yönetici kaydı yoksa false döner;
    /// çağıran o zaman İK'ya haber verir.
    /// </summary>
    public static async Task<bool> YoneticiyeHaberVer(IDbConnection db, BildirimServisi bildirim,
        string tur, int talepId, string personelAd, string ozet, string not, List<Kayit> acikKayitlar = null)
    {
        var kayitlar = acikKayitlar ?? AcikYoneticiKayitlari(db, tur, talepId);
        if (kayitlar.Count == 0) return false;

        var metin = $"{personelAd} · {ozet}: {not}";
        if (metin.Length > 240) metin = metin[..237] + "…";

        foreach (var sicil in kayitlar.Select(k => Sicil(k.Gonderen)).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct())
            await bildirim.Gonder(sicil, "Eksik tamamlandı · onayınızı bekliyor", metin, Ekran(tur));

        return true;
    }

    /// <summary>Yönetici karar verince (onay / ret) açık kaydı kapanır: kart personelin ana sayfasından kalkar</summary>
    public static void Kapat(IDbConnection db, string tur, int talepId, string not)
    {
        try
        {
            if (not is { Length: > 300 }) not = not[..300];

            db.Execute(@"
UPDATE KRY_TALEP_EKSIK
SET durum = N'kapandi', kapandi = SYSDATETIME(), tamamlandi = COALESCE(tamamlandi, SYSDATETIME()),
    kapatan = N'Biçen360', kapanis_notu = @not
WHERE tur = @tur AND talep_id = @talepId AND durum <> N'kapandi' AND gonderen LIKE N'yonetici:%'",
                new { tur, talepId, not });
        }
        catch
        {
            /* tablo yoksa geçilir */
        }
    }

    /// <summary>Avans hareket günlüğü (AvansController.Hareket özel; aynı tablo)</summary>
    public static void AvansHareket(IDbConnection db, int avansId, string olay, string aciklama, string yapan)
    {
        try
        {
            if (olay is { Length: > 200 }) olay = olay[..200];
            if (aciklama is { Length: > 500 }) aciklama = aciklama[..500];

            db.Execute(@"
INSERT INTO KRY_AVANS_HAREKET (avans_id, olay, aciklama, yapan) VALUES (@id, @olay, @aciklama, @yapan)",
                new { id = avansId, olay, aciklama, yapan });
        }
        catch
        {
            /* günlük asıl işi durdurmaz */
        }
    }

    /// <summary>Talep özeti (bildirim ve kart için)</summary>
    public static string IzinOzeti(dynamic t)
    {
        DateTime c = t.cikis_tarihi, d = t.donus_tarihi;
        var aralik = c.Date == d.Date
            ? c.ToString("d MMMM", Tr)
            : $"{c.ToString("d MMM", Tr)} – {d.ToString("d MMM", Tr)}";
        return $"{t.tur} {aralik}";
    }

    public static string AvansOzeti(decimal tutar, int taksit, DateTime olusturma) =>
        $"Avans {tutar.ToString("N0", Tr)} TL" + (taksit > 1 ? $", {taksit} taksit" : "")
        + $" ({olusturma.ToString("d MMMM", Tr)} talebi)";
}

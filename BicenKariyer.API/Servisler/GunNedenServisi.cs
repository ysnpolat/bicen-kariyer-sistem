using System.Globalization;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Okutma beklenmeyen günün sebebi (09.10.2026).
///
/// <para>
/// Panelin Günlük QR Okutma Raporu haftalık izindeki ve raporlu personeli
/// "İzinli" diye tek etikette topluyor, yıllık izindekileri hiç tanımıyor
/// ve "Okutmadı" gösteriyordu. Biçen360 Ekibim ekranındaki kurallar
/// (EkipController.Durumlar) buraya ortak hâle getirildi:
/// </para>
/// <list type="number">
///   <item>Raporlu: personel kartındaki raporlar ve rapor izinleri.</item>
///   <item>İzin kaydı (KRY_IZIN) ya da onaylanmış ama izin kaydına dönmemiş
///   talep, tam gün: "Yıllık izin", "Mazeret izni"… Kısmi (saatlik,
///   yarım gün) izin sayılmaz: kişi o gün yine okutur.</item>
///   <item>Haftalık izin: vardiya planındaki izin günü; o hafta planı
///   yoksa onaylı sabit izin günü ya da pozisyon grubunun izin günleri.</item>
///   <item>Resmî tatil (tam gün).</item>
/// </list>
/// <para>Sicil yazım farkı ("0123" / "123") gözetilir.</para>
/// </summary>
public sealed class GunNedenServisi
{
    public const string Raporlu = "Raporlu";
    public const string YillikIzin = "Yıllık izin";
    public const string HaftalikIzin = "Haftalık izin";
    public const string ResmiTatil = "Resmî tatil";

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    private readonly VeritabaniServisi _vt;

    public GunNedenServisi(VeritabaniServisi vt) => _vt = vt;

    public static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>İzin türünün raporda görünen adı</summary>
    public static string IzinAdi(string tur)
    {
        var t = (tur ?? "").Trim();
        var k = t.ToLower(Tr);

        if (k.Contains("rapor")) return Raporlu;
        if (k.StartsWith("yıllık") || k.StartsWith("yillik")) return YillikIzin;
        if (t.Length == 0) return "İzinli";

        return char.ToUpper(t[0], Tr) + t[1..].ToLower(Tr);
    }

    /// <summary>
    /// Kişi (K(kod)) → gün → sebep. Sebebi olmayan gün sözlükte yok.
    /// </summary>
    /// <param name="raporDahil">false: raporlu günler (kart raporu ve rapor
    /// izni) dahil edilmez; okutma oranı hesabı raporluyu ayrıca sayıyor.</param>
    public Dictionary<string, Dictionary<DateTime, string>> Aralik(
        IEnumerable<PersonelKaydi> kisiler, DateTime bas, DateTime bit, bool raporDahil = true)
    {
        bas = bas.Date;
        bit = bit.Date;

        var liste = kisiler.Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu)).ToList();
        var kodlar = liste.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var sonuc = new Dictionary<string, Dictionary<DateTime, string>>(StringComparer.OrdinalIgnoreCase);

        if (kodlar.Count == 0) return sonuc;

        void Yaz(string kod, DateTime g, string neden, bool ustune = false)
        {
            if (g < bas || g > bit || !kodlar.Contains(kod)) return;
            if (!sonuc.TryGetValue(kod, out var gunler)) sonuc[kod] = gunler = new Dictionary<DateTime, string>();
            if (ustune || !gunler.ContainsKey(g)) gunler[g] = neden;
        }

        using var db = _vt.Baglanti();

        /* ------------------------------------------- 1. raporlu (öncelikli) */
        if (raporDahil)
        {
            try
            {
                foreach (var r in new RaporluServisi(_vt).Kayitlar(bas, bit, izinDahil: true))
                    for (var g = r.Baslangic.Date; g <= r.Bitis.Date; g = g.AddDays(1))
                        Yaz(K(r.PersonelKodu), g, Raporlu, ustune: true);
            }
            catch
            {
                /* Rapor tablosu yoksa izinlerle devam */
            }
        }

        /* --------------------------------------- 2. izin kayıtları (tam gün) */
        static bool Kismi(dynamic x) =>
            !string.IsNullOrWhiteSpace((string)x.basSaat) || !string.IsNullOrWhiteSpace((string)x.yarim);

        void IzinYaz(dynamic x, DateTime ilk, DateTime son)
        {
            if (Kismi(x)) return;

            var ad = IzinAdi((string)x.tur);
            if (ad == Raporlu && !raporDahil) return;

            for (var g = ilk.Date; g <= son.Date; g = g.AddDays(1))
                Yaz(K((string)x.kod), g, ad);
        }

        try
        {
            foreach (var x in db.Query(@"
SELECT personel_kodu AS kod, tur, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi) ELSE donus_tarihi END AS son,
       yarim_gun AS yarim, baslangic_saat AS basSaat
FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @bit
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi) ELSE donus_tarihi END) >= @bas",
                         new { bas, bit }))
                IzinYaz(x, (DateTime)x.bas, (DateTime)x.son);
        }
        catch
        {
            /* izin tablosu okunamadı */
        }

        try
        {
            /* Onaylanmış ama izin kaydına dönmemiş talep: seçilen aralık izinli günlerin kendisi */
            foreach (var x in db.Query(@"
SELECT personel_kodu AS kod, tur, cikis_tarihi AS bas, donus_tarihi AS son,
       yarim_gun AS yarim, baslangic_saat AS basSaat
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND izin_id IS NULL AND durum = N'Onaylandı'
  AND cikis_tarihi <= @bit AND donus_tarihi >= @bas", new { bas, bit }))
                IzinYaz(x, (DateTime)x.bas, (DateTime)x.son);
        }
        catch
        {
            /* talep tablosu okunamadı */
        }

        /* ---------------------------------------------------- 3. haftalık izin */
        try
        {
            var haftaBas = BicenKariyer.API.Controllers.VardiyaPlanController.HaftaBasi(bas);
            var plan = db.Query(@"
SELECT personel_kodu AS kod, gun, tur FROM KRY_VARDIYA_PLAN
WHERE gun BETWEEN @haftaBas AND @son", new { haftaBas, son = bit.AddDays(6) }).ToList();

            /* Kişinin o hafta planı varsa sabit gün yerine plan geçerli */
            var planliHaftalar = plan
                .Select(x => $"{K((string)x.kod)}|{BicenKariyer.API.Controllers.VardiyaPlanController.HaftaBasi((DateTime)x.gun):yyyy-MM-dd}")
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var x in plan.Where(x => (string)x.tur == "izin"))
                Yaz(K((string)x.kod), ((DateTime)x.gun).Date, HaftalikIzin);

            var kisisel = db.Query(@"
SELECT personel_kodu AS kod, gun FROM KRY_HAFTALIK_IZIN
WHERE gun IS NOT NULL AND durum = N'onaylandi'")
                .GroupBy(x => K((string)x.kod), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => (DayOfWeek)(int)g.First().gun, StringComparer.OrdinalIgnoreCase);

            var gruplar = new Dictionary<string, HashSet<DayOfWeek>>(StringComparer.OrdinalIgnoreCase);

            foreach (var g in db.Query("SELECT pozisyonlar, izin_gunleri AS izinGunleri FROM KRY_POZISYON_GRUBU WHERE aktif = 1"))
            {
                var gunler = ((string)g.izinGunleri ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(p => int.TryParse(p, out var n) && n is >= 0 and <= 6 ? (DayOfWeek?)n : null)
                    .Where(x => x is not null).Select(x => x!.Value).ToHashSet();

                if (gunler.Count == 0) continue;

                foreach (var poz in ((string)g.pozisyonlar ?? "")
                             .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    gruplar[PersonelKaynagiServisi.MeslekAnahtari(poz)] = gunler;
            }

            foreach (var p in liste)
            {
                var kod = K(p.PersonelKodu);
                kisisel.TryGetValue(kod, out var kg);
                var kisiselVar = kisisel.ContainsKey(kod);
                var grup = gruplar.GetValueOrDefault(PersonelKaynagiServisi.MeslekAnahtari(p.Pozisyon ?? ""));

                for (var g = bas; g <= bit; g = g.AddDays(1))
                {
                    if (planliHaftalar.Contains($"{kod}|{BicenKariyer.API.Controllers.VardiyaPlanController.HaftaBasi(g):yyyy-MM-dd}")) continue;

                    if ((kisiselVar && kg == g.DayOfWeek) || (grup is not null && grup.Contains(g.DayOfWeek)))
                        Yaz(kod, g, HaftalikIzin);
                }
            }
        }
        catch
        {
            /* plan / haftalık izin tabloları okunamadı */
        }

        /* ------------------------------------------------------ 4. resmî tatil */
        try
        {
            var tatiller = db.Query<DateTime>(@"
SELECT tarih FROM KRY_RESMI_TATIL WHERE aktif = 1 AND yarim_gun = 0 AND tarih BETWEEN @bas AND @bit",
                new { bas, bit }).Select(x => x.Date).ToList();

            foreach (var t in tatiller)
                foreach (var kod in kodlar)
                    Yaz(kod, t, ResmiTatil);
        }
        catch
        {
            /* tatil tablosu okunamadı */
        }

        return sonuc;
    }

    /// <summary>Tek gün: K(kod) → sebep</summary>
    public Dictionary<string, string> Gun(IEnumerable<PersonelKaydi> kisiler, DateTime gun, bool raporDahil = true) =>
        Aralik(kisiler, gun, gun, raporDahil)
            .Where(x => x.Value.ContainsKey(gun.Date))
            .ToDictionary(x => x.Key, x => x.Value[gun.Date], StringComparer.OrdinalIgnoreCase);
}

using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Vardiya planı: vardiya türleri, haftalık plan, bildirim ve özel durum.
///
/// <para>
/// Vardiya türlerini (Sabahçı, Akşamcı, Aracı…) İK paneli tanımlıyor;
/// türlerde saat tutulmuyor, çünkü her mağazanın açılış kapanış saati
/// farklı. Mağaza müdürü hangi gün hangi türde çalışılacağını seçiyor.
/// </para>
///
/// <para>
/// Dinlenme kuralı artık engel değil, uyarı: akşamcı çalışan personele
/// ertesi gün sabahçı verildiğinde yönetici uyarılıyor ama kayıt yapılıyor.
/// </para>
///
/// <para>
/// Akış (28.09.2026): müdür planı kurar (taslak) → gönderir (gonderildi).
/// Personel onaylamıyor ya da reddetmiyor; plan ona bildirim olarak düşüyor.
/// Müdür gönderdiği planı düzenleyebiliyor (degisti) ve yeniden
/// gönderdiğinde personele "planınız güncellendi" bildirimi gidiyor.
/// Haftada en az bir haftalık izin günü zorunlu. Personel yalnızca
/// yöneticinin verdiği haftalık izin günü için özel durum bildirebiliyor;
/// yönetici kabul ederse izin günü istenen güne taşınıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public partial class VardiyaPlanController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly BildirimServisi _bildirim;
    private readonly ILogger<VardiyaPlanController> _kayit;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly AyarServisi _ayar;

    public VardiyaPlanController(VeritabaniServisi vt, EkipServisi ekip, BildirimServisi bildirim,
        ILogger<VardiyaPlanController> kayit, PersonelKaynagiServisi kaynak, AyarServisi ayar)
    {
        _vt = vt;
        _ekip = ekip;
        _bildirim = bildirim;
        _kayit = kayit;
        _kaynak = kaynak;
        _ayar = ayar;
    }

    /* ==================================================================== */
    /* Ortak                                                                */
    /* ==================================================================== */

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";

        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";

        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');

        return i < 0 ? govde : govde[..i];
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Haftanın pazartesisi; plan hep haftaya bağlı.</summary>
    public static DateTime HaftaBasi(DateTime g)
    {
        var fark = ((int)g.DayOfWeek + 6) % 7;
        return g.Date.AddDays(-fark);
    }

    private int DinlenmeSaati(IDbConnection db)
    {
        var d = db.ExecuteScalar<string>(
            "SELECT deger FROM KRY_AYARLAR WHERE anahtar = N'vardiyaDinlenmeSaati'");

        return int.TryParse(d, out var s) && s is >= 0 and <= 24 ? s : 11;
    }

    /// <summary>
    /// Sistemdeki izin bilgisi: bir güne düşen izin kaydı ya da onay
    /// bekleyen izin talebi.
    /// </summary>
    /// <param name="Tur">KRY_IZIN.tur: Yıllık İzin, Raporlu, Mazeret İzni, Saatlik İzin…</param>
    /// <param name="TamGun">Bütün gün izinli; kısmi (saatlik, yarım gün) değil.</param>
    /// <param name="Ayrinti">Kısmi izinde saat aralığı ya da yarım gün bilgisi.</param>
    /// <param name="Bekliyor">Onaylanmamış talep; plan yine yapılabilir.</param>
    private sealed record SistemIzin(string Tur, bool TamGun, string Ayrinti, bool Bekliyor);

    /// <summary>
    /// Haftadaki izinler, gün gün (29.09.2026).
    ///
    /// <para>
    /// Önceden bütün izin kayıtları "Yıllık izin" diye gösteriliyordu:
    /// raporlu personel de yıllık izinli görünüyor, saatlik izin bütün
    /// günü kapatıyordu. Artık her gün kaydın kendi türüyle geliyor.
    /// Tam gün izin (yıllık, raporlu, mazeret, ücretsiz…) günü kapatıyor;
    /// saatlik ve yarım gün izinde vardiya yine atanabiliyor, yönetici
    /// saati görüp planı ona göre yapıyor. Onay bekleyen talepler günü
    /// kapatmıyor, bilgi olarak geliyor.
    /// </para>
    /// </summary>
    private static Dictionary<DateTime, SistemIzin> SistemIzinleri(IDbConnection db, string kod, DateTime hafta,
        PersonelKaydi kisi = null)
    {
        var sonuc = new Dictionary<DateTime, SistemIzin>();
        var haftaSon = hafta.AddDays(6);

        static string KismiAyrinti(dynamic x)
        {
            var bas = (string)x.basSaat;
            var bit = (string)x.bitSaat;

            if (!string.IsNullOrWhiteSpace(bas))
                return string.IsNullOrWhiteSpace(bit) ? bas : $"{bas}–{bit}";

            var yarim = (string)x.yarim;

            return string.IsNullOrWhiteSpace(yarim) ? null : $"yarım gün ({yarim})";
        }

        static bool Kismi(dynamic x) =>
            !string.IsNullOrWhiteSpace((string)x.basSaat) || !string.IsNullOrWhiteSpace((string)x.yarim);

        void Yaz(DateTime g, SistemIzin yeni)
        {
            if (g < hafta || g > haftaSon) return;

            /* Öncelik: onaylı tam gün > onaylı kısmi > bekleyen talep */
            static int Derece(SistemIzin z) => z.Bekliyor ? 0 : z.TamGun ? 2 : 1;

            if (!sonuc.TryGetValue(g, out var eski) || Derece(yeni) > Derece(eski))
                sonuc[g] = yeni;
        }

        foreach (var a in db.Query(@"
SELECT tur, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son,
       yarim_gun AS yarim, baslangic_saat AS basSaat, bitis_saat AS bitSaat
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0
  AND cikis_tarihi <= @haftaSon
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @haftaBas",
                     new { kod, haftaBas = hafta, haftaSon }))
        {
            var kismi = Kismi(a);
            var bas = ((DateTime)a.bas).Date;
            var son = ((DateTime)a.son).Date;

            /* Kısmi izin tek güne ait; dönüş tarihi aynı gün ya da ertesi gün girilmiş olabilir */
            if (kismi) son = bas;

            for (var g = bas; g <= son; g = g.AddDays(1))
                Yaz(g, new SistemIzin(((string)a.tur ?? "İzin").Trim(), !kismi, kismi ? KismiAyrinti(a) : null, false));
        }

        /* Personel kartından girilen sağlık raporları (07.10.2026): izin
           kaydı olmasa da o günler planda "Rapor" görünüyor ve vardiya
           atanamıyor. Raporlu gün yıllık izinli güne de baskın (rapor izni
           keser). Sicil yazımı kaynaklar arasında farklı olabiliyor ("0123"). */
        try
        {
            var kodlar = new[] { kod.Trim(), K(kod), "0" + K(kod), "00" + K(kod) }.Distinct().ToArray();

            foreach (var r in db.Query(@"
SELECT baslangic AS bas, bitis AS son, rapor_turu AS tur
FROM KRY_PERSONEL_RAPOR
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) IN @kodlar
  AND baslangic <= @haftaSon AND bitis >= @haftaBas",
                         new { kodlar, haftaBas = hafta, haftaSon }))
            {
                for (var g = ((DateTime)r.bas).Date; g <= ((DateTime)r.son).Date; g = g.AddDays(1))
                    if (g >= hafta && g <= haftaSon)
                        sonuc[g] = new SistemIzin(RaporluServisi.Etiket, true, (string)r.tur, false);
            }
        }
        catch
        {
            /* Rapor tablosu yoksa yalnızca izinler */
        }

        /* Onay bekleyen talepler: mobilde seçilen aralık izinli günlerin
           kendisi (son gün dahil). */
        try
        {
            foreach (var t in db.Query(@"
SELECT tur, cikis_tarihi AS bas, donus_tarihi AS son,
       yarim_gun AS yarim, baslangic_saat AS basSaat, bitis_saat AS bitSaat
FROM KRY_IZIN_TALEP
WHERE personel_kodu = @kod AND iptal = 0 AND izin_id IS NULL
  AND durum NOT IN (N'Onaylandı', N'Reddedildi')
  AND cikis_tarihi <= @haftaSon AND donus_tarihi >= @haftaBas",
                         new { kod, haftaBas = hafta, haftaSon }))
            {
                var kismi = Kismi(t);
                var bas = ((DateTime)t.bas).Date;
                var son = kismi ? bas : ((DateTime)t.son).Date;

                for (var g = bas; g <= son; g = g.AddDays(1))
                    Yaz(g, new SistemIzin(((string)t.tur ?? "İzin").Trim(), !kismi, kismi ? KismiAyrinti(t) : null, true));
            }
        }
        catch
        {
            /* Talep tablosu okunamazsa yalnızca kayıtlı izinler gösterilir */
        }

        /* İşe girişten önceki ve çıkıştan sonraki günler (09.10.2026):
           personel o gün şirkette değil; gün kilitli ("Başlamadı" /
           "Ayrıldı"), vardiya atanmaz ve haftalık izin şartı aranmaz. */
        if (kisi is not null)
            foreach (var (g, tur) in IstihdamDisiGunler(kisi, hafta))
                sonuc[g] = new SistemIzin(tur, true,
                    tur == GirisOncesi ? $"işe giriş {kisi.GirisTarihi:dd.MM.yyyy}" : $"çıkış {kisi.CikisTarihi:dd.MM.yyyy}",
                    false);

        return sonuc;
    }

    private const string GirisOncesi = "İşe giriş öncesi";
    private const string CikisSonrasi = "İşten çıkış sonrası";

    /// <summary>
    /// Haftanın, personelin şirkette olmadığı günleri: işe giriş tarihinden
    /// önceki ve çıkış tarihinden sonraki günler (09.10.2026). Cuma işe
    /// giren personelin haftası 3 gün; Pazartesi–Perşembe planlanmaz,
    /// o hafta haftalık izin de zorunlu değil.
    /// </summary>
    private static List<(DateTime gun, string tur)> IstihdamDisiGunler(PersonelKaydi kisi, DateTime hafta)
    {
        var l = new List<(DateTime, string)>();
        if (kisi is null) return l;

        var giris = kisi.GirisTarihi?.Date;
        var cikis = kisi.CikisTarihi?.Date;

        /* Mikro'da boş tarih 1899/1900 gelebiliyor */
        if (giris is { Year: < 1950 }) giris = null;
        if (cikis is { Year: < 1950 }) cikis = null;

        for (var i = 0; i < 7; i++)
        {
            var g = hafta.AddDays(i).Date;
            if (giris is not null && g < giris) l.Add((g, GirisOncesi));
            else if (cikis is not null && g > cikis) l.Add((g, CikisSonrasi));
        }

        return l;
    }

    /// <summary>Haftada şirkette olmadığı gün var mı (giriş/çıkış haftası)</summary>
    private static bool KismiHafta(PersonelKaydi kisi, DateTime hafta) => IstihdamDisiGunler(kisi, hafta).Count > 0;

    /// <summary>
    /// Haftadaki tam gün izinli günler (onaylı kayıt): vardiya atanamaz,
    /// haftalık izin zorunluluğunda sayılır.
    /// </summary>
    private static HashSet<DateTime> YillikIzinGunleri(IDbConnection db, string kod, DateTime hafta,
        PersonelKaydi kisi = null) =>
        SistemIzinleri(db, kod, hafta, kisi)
            .Where(x => x.Value.TamGun && !x.Value.Bekliyor)
            .Select(x => x.Key)
            .ToHashSet();

    /// <summary>Hücrede görünen kısa ad: "Yıllık İzin" → "Yıllık", rapor → "Raporlu" (08.10.2026).</summary>
    private static string IzinKisaAdi(string tur)
    {
        var t = (tur ?? "").Trim();
        var k = t.ToLower(new System.Globalization.CultureInfo("tr-TR"));

        if (k.StartsWith("yıllık")) return "Yıllık";
        if (k.StartsWith("işe giriş")) return "Başlamadı";
        if (k.StartsWith("işten çıkış")) return "Ayrıldı";

        /* "Hastalık İzni (Rapor)" da rapor: istemciler "Rapor" ile başlayanı kırmızı boyuyor */
        if (k.StartsWith("rapor") || k.Contains("rapor")) return "Raporlu";
        if (k.StartsWith("mazeret")) return "Mazeret";
        if (k.StartsWith("ücretsiz")) return "Ücretsiz";
        if (k.StartsWith("saatlik")) return "Saatlik";
        if (k.StartsWith("yarım")) return "Yarım gün";
        if (k.StartsWith("doğum")) return "Doğum";
        if (k.StartsWith("evlilik")) return "Evlilik";
        if (k.StartsWith("ölüm")) return "Ölüm";

        var ilk = t.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "İzin";
        return ilk.Length > 9 ? ilk[..9] : ilk;
    }

    private static string GunAdi(DateTime g) => g.DayOfWeek switch
    {
        DayOfWeek.Monday => "Pazartesi",
        DayOfWeek.Tuesday => "Salı",
        DayOfWeek.Wednesday => "Çarşamba",
        DayOfWeek.Thursday => "Perşembe",
        DayOfWeek.Friday => "Cuma",
        DayOfWeek.Saturday => "Cumartesi",
        _ => "Pazar",
    };

    private sealed record Sablon(int Id, string Ad, string Renk, string Tip);

    /// <summary>
    /// Vardiya türünün sınıfı: sabah · aksam · araci · diger.
    ///
    /// Dinlenme uyarısı buna bakıyor. Tür tanımında seçilmemişse addan
    /// çıkarılıyor ("Sabahçı" → sabah, "Akşamcı" → aksam, "Aracı" → araci).
    /// </summary>
    public static string TipBul(string tip, string ad)
    {
        var t = (tip ?? "").Trim().ToLowerInvariant();

        if (t is "sabah" or "aksam" or "araci" or "diger") return t;

        var a = (ad ?? "").Trim().ToLower(new System.Globalization.CultureInfo("tr-TR"));

        if (a.Contains("sabah")) return "sabah";
        if (a.Contains("akşam") || a.Contains("aksam")) return "aksam";
        if (a.StartsWith("ara")) return "araci";

        return "diger";
    }

    private List<Sablon> Sablonlar(IDbConnection db) =>
        db.Query(@"
SELECT id, ad, renk, tip FROM KRY_VARDIYA_SABLON
WHERE aktif = 1 ORDER BY sira, id")
            .Select(x => new Sablon((int)x.id, (string)x.ad, (string)x.renk,
                TipBul((string)x.tip, (string)x.ad)))
            .ToList();

    /// <summary>
    /// Durumun güncel adı. Eski onay akışından kalan kayıtlar da okunuyor:
    /// bekliyor/onay gönderilmiş, red ise gönderildikten sonra değişmiş
    /// sayılıyor.
    /// </summary>
    /// <summary>
    /// Haftanın 7 günü sistemdeki izin/rapor kaydıyla dolu ve yönetici
    /// plan girmemişse (08.10.2026): planlanacak bir şey yok, personel
    /// haftayı "Raporlu"/"İzinli" olarak görür. "Taslak" kalıp "Planı gönder"
    /// sayısına girmesin, personelin planı da gizlenmesin diye gönderilmiş
    /// sayılıyor.
    /// </summary>
    private static string TamHaftaIzinli(string durum, int sistemIzinGunu, int planSatiri) =>
        durum == "taslak" && sistemIzinGunu >= 7 && planSatiri == 0 ? "gonderildi" : durum;

    /// <summary>
    /// Haftanın tamamı tek bir izin ya da rapor kaydıyla kapanan personel
    /// (toplu: İK paneli şube kartları). Sicil sıfırsız.
    /// </summary>
    private static HashSet<string> TamHaftaIzinliler(IDbConnection db, DateTime hafta)
    {
        var kume = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var son = hafta.AddDays(6);

        try
        {
            foreach (var k in db.Query<string>(@"
SELECT personel_kodu FROM KRY_IZIN
WHERE iptal = 0 AND cikis_tarihi <= @hafta
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi) ELSE donus_tarihi END) >= @son
  AND (yarim_gun IS NULL OR yarim_gun = N'') AND (baslangic_saat IS NULL OR baslangic_saat = N'')",
                         new { hafta, son }))
                kume.Add(K(k));
        }
        catch
        {
        }

        try
        {
            foreach (var k in db.Query<string>(@"
SELECT personel_kodu FROM KRY_PERSONEL_RAPOR
WHERE iptal = 0 AND baslangic <= @hafta AND bitis >= @son", new { hafta, son }))
                kume.Add(K(k));
        }
        catch
        {
            /* Rapor tablosu yoksa yalnızca izinler */
        }

        return kume;
    }

    private static string DurumNormal(string d) => d switch
    {
        null or "" => "taslak",
        "bekliyor" or "onay" => "gonderildi",
        "red" => "degisti",
        _ => d,
    };

    /// <summary>
    /// Verilen günün vardiyası komşu günlerle dinlenme kuralına uyuyor mu.
    ///
    /// Kural artık engel değil: "bugün akşamcı çalışan yarın sabahçı
    /// çalışamaz" durumu yöneticiye uyarı olarak gösteriliyor, kayıt yine
    /// yapılıyor. Saat tutulmadığı için tür sınıfına bakılıyor.
    /// </summary>
    private List<string> DinlenmeUyarilari(IDbConnection db, string kod, DateTime gun, Sablon yeni,
        List<Sablon> sablonlar)
    {
        var uyarilar = new List<string>();

        if (yeni is null) return uyarilar;

        var komsular = db.Query(@"
SELECT gun, sablon_id AS sablonId FROM KRY_VARDIYA_PLAN
WHERE personel_kodu = @kod AND gun IN (@onceki, @sonraki)
  AND tur = N'vardiya' AND sablon_id IS NOT NULL",
                new { kod, onceki = gun.AddDays(-1), sonraki = gun.AddDays(1) })
            .Select(x => (gun: ((DateTime)x.gun).Date, sablonId: (int)x.sablonId))
            .ToList();

        foreach (var k in komsular)
        {
            var ks = sablonlar.FirstOrDefault(x => x.Id == k.sablonId);

            if (ks is null) continue;

            var (once, sonra, onceGun, sonraGun) = k.gun < gun.Date
                ? (ks, yeni, k.gun, gun.Date)
                : (yeni, ks, gun.Date, k.gun);

            if (once.Tip == "aksam" && sonra.Tip == "sabah")
                uyarilar.Add($"{GunAdi(onceGun)} {once.Ad} çalışan personel {GunAdi(sonraGun)} "
                             + $"{sonra.Ad} çalışıyor. Akşamcı çalışan ertesi gün sabahçı olmamalı; "
                             + "dinlenme süresini kontrol ediniz.");
        }

        return uyarilar;
    }

    private static void PlanYaz(IDbConnection db, string kod, DateTime gun, int? sablonId, string tur, string yapan) =>
        db.Execute(@"
MERGE KRY_VARDIYA_PLAN AS h
USING (SELECT @kod AS personel_kodu, @gun AS gun) AS k
   ON h.personel_kodu = k.personel_kodu AND h.gun = k.gun
WHEN MATCHED THEN UPDATE SET sablon_id = @sablonId, tur = @tur, hafta = @hafta,
    guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (personel_kodu, gun, hafta, sablon_id, tur, guncelleyen)
VALUES (@kod, @gun, @hafta, @sablonId, @tur, @yapan);",
            new { kod, gun = gun.Date, hafta = HaftaBasi(gun), sablonId, tur, yapan });

    private static void Log(IDbConnection db, string kod, DateTime hafta, string olay,
        string aciklama, string yapan)
    {
        if (aciklama is { Length: > 500 }) aciklama = aciklama[..500];
        if (olay is { Length: > 200 }) olay = olay[..200];

        db.Execute(@"
INSERT INTO KRY_VARDIYA_PLAN_LOG (personel_kodu, hafta, olay, aciklama, yapan)
VALUES (@kod, @hafta, @olay, @aciklama, @yapan)",
            new { kod, hafta, olay, aciklama, yapan });
    }

    private static void DurumYaz(IDbConnection db, string kod, DateTime hafta, string durum,
        string neden = null, bool surumArtir = false, string gonderen = null, DateTime? redGun = null)
    {
        db.Execute(@"
MERGE KRY_VARDIYA_PLAN_DURUM AS h
USING (SELECT @kod AS personel_kodu, @hafta AS hafta) AS k
   ON h.personel_kodu = k.personel_kodu AND h.hafta = k.hafta
WHEN MATCHED THEN UPDATE SET
    durum = @durum,
    red_neden = NULL,
    red_gun = NULL,
    surum = surum + CASE WHEN @artir = 1 THEN 1 ELSE 0 END,
    gonderen = COALESCE(@gonderen, gonderen),
    gonderme = CASE WHEN @artir = 1 THEN SYSDATETIME() ELSE gonderme END,
    karar = NULL
WHEN NOT MATCHED THEN INSERT (personel_kodu, hafta, durum, surum, red_neden, red_gun, gonderen, gonderme)
VALUES (@kod, @hafta, @durum, CASE WHEN @artir = 1 THEN 1 ELSE 0 END, @neden, @redGun, @gonderen,
        CASE WHEN @artir = 1 THEN SYSDATETIME() ELSE NULL END);",
            new { kod, hafta, durum, neden, artir = surumArtir, gonderen, redGun });
    }

    /// <summary>Bir kişinin haftalık planı: gün gün vardiya ve durum.</summary>
    private object HaftaOku(IDbConnection db, PersonelKaydi kisi, DateTime hafta, List<Sablon> sablonlar,
        bool subeEki = false)
    {
        var kod = kisi.PersonelKodu.Trim();

        var satirlar = db.Query(@"
SELECT gun, sablon_id AS sablonId, tur FROM KRY_VARDIYA_PLAN
WHERE personel_kodu = @kod AND hafta = @hafta", new { kod, hafta })
            .ToDictionary(x => ((DateTime)x.gun).Date, x => (sablonId: (int?)x.sablonId, tur: (string)x.tur));

        var durum = db.QueryFirstOrDefault(@"
SELECT durum, surum, red_neden AS redNeden, red_gun AS redGun, gonderen, gonderme, karar
FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @hafta", new { kod, hafta });

        var izinler = SistemIzinleri(db, kod, hafta, kisi);
        var yillikGunler = izinler
            .Where(x => x.Value.TamGun && !x.Value.Bekliyor)
            .Select(x => x.Key)
            .ToHashSet();

        /* Haftalık izin gününde okutma yapılmışsa işaretleniyor: plan ile
           gerçek çalışma tutmuyor demektir, yöneticinin görmesi gerekiyor. */
        var okutmalar = db.Query<DateTime>(@"
SELECT DISTINCT CAST(gecis_zamani AS DATE) FROM KRY_VARDIYA
WHERE personel_kodu = @kod AND gecis_zamani >= @bas AND gecis_zamani < @son",
                new { kod, bas = hafta, son = hafta.AddDays(7) })
            .Select(x => x.Date)
            .ToHashSet();

        /* Devamsızlık (23.10.2026): birim yöneticisinin girdiği günler */
        var devamsizGunler = new HashSet<DateTime>();
        try
        {
            devamsizGunler = db.Query<DateTime>(@"
SELECT tarih FROM KRY_DEVAMSIZLIK
WHERE iptal = 0 AND LTRIM(RTRIM(personel_kodu)) = @kod AND tarih >= @bas AND tarih < @son",
                    new { kod, bas = hafta, son = hafta.AddDays(7) })
                .Select(x => x.Date).ToHashSet();
        }
        catch
        {
            /* tablo yoksa devamsızlık yok */
        }

        var gunler = Enumerable.Range(0, 7).Select(i =>
        {
            var g = hafta.AddDays(i);

            satirlar.TryGetValue(g, out var p);

            var s = p.sablonId is null ? null : sablonlar.FirstOrDefault(x => x.Id == p.sablonId);

            /* Sistemdeki izin planlanmıyor, okunuyor: tam gün izinli
               günde (yıllık, raporlu, mazeret…) "yillik" türü geliyor ve
               vardiya atanamıyor. Kısmi ya da bekleyen izin yalnızca
               bilgi: vardiya yine atanabiliyor. */
            izinler.TryGetValue(g, out var izin);
            var yillikMi = yillikGunler.Contains(g);
            var tur = yillikMi ? "yillik" : p.tur ?? "off";

            return new
            {
                tarih = g,
                tur,
                sablonId = yillikMi ? null : s?.Id,
                ad = yillikMi ? izin.Tur : s?.Ad ?? (p.tur == "izin" ? "Haftalık izin" : "Boş"),
                /* Türlerde saat yok: her mağazanın saati farklı */
                baslangic = (string)null,
                bitis = (string)null,
                tip = yillikMi ? null : s?.Tip,
                renk = yillikMi ? "yesil" : s?.Renk,
                okutmaVar = okutmalar.Contains(g),
                reddedildi = false,

                /* Sistemdeki izin: tam gün, kısmi ya da onay bekleyen */
                izinTuru = izin?.Tur,
                izinKisa = izin is null ? null : IzinKisaAdi(izin.Tur),
                izinAyrinti = izin?.Ayrinti,
                izinBekliyor = izin?.Bekliyor ?? false,
                kismiIzin = izin is not null && !izin.TamGun,

                /* Çalışma yokken okutma yapılmış: uyarı */
                celiski = okutmalar.Contains(g) && (yillikMi || tur is "izin" or "off"),

                /* 23.10.2026: geçmiş vardiya gününde okutma yok / devamsızlık girildi */
                devamsiz = devamsizGunler.Contains(g),
                okutmadi = g < DateTime.Today && tur == "vardiya" && !okutmalar.Contains(g) && !devamsizGunler.Contains(g)
                           && izin is null,
            };
        }).ToList();

        /* Özel durum: bekleyen varsa o, yoksa haftanın son kaydı */
        var ozel = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, izin_gun AS izinGun, talep_gun AS talepGun, aciklama, durum,
       karar_veren AS kararVeren, karar_notu AS kararNotu, karar_tarihi AS kararTarihi,
       olusturma
FROM KRY_VARDIYA_OZEL_DURUM
WHERE personel_kodu = @kod AND hafta = @hafta
ORDER BY CASE WHEN durum = N'bekliyor' THEN 0 ELSE 1 END, id DESC", new { kod, hafta });

        /* Dinlenme uyarıları: haftanın içindeki akşamcı → sabahçı geçişleri */
        var uyarilar = new List<string>();

        for (var i = 0; i < gunler.Count - 1; i++)
        {
            var a = gunler[i];
            var b = gunler[i + 1];

            if (a.tur == "vardiya" && b.tur == "vardiya" && a.tip == "aksam" && b.tip == "sabah")
                uyarilar.Add($"{GunAdi(a.tarih)} {a.ad} → {GunAdi(b.tarih)} {b.ad}: "
                             + "akşamcı çalışan ertesi gün sabahçı olmamalı.");
        }

        var izinSayisi = gunler.Count(x => x.tur == "izin");

        /* Planı etkileyen izin bilgileri: yönetici vardiyayı buna göre yapar */
        var izinNotlari = gunler
            .Where(x => x.izinTuru is not null && (x.kismiIzin || x.izinBekliyor))
            .Select(x => $"{GunAdi(x.tarih)}: {x.izinTuru}"
                         + (x.izinAyrinti is null ? "" : $" {x.izinAyrinti}")
                         + (x.izinBekliyor ? " · talep onay bekliyor" : " · vardiya atanabilir"))
            .ToList();

        return new
        {
            sicil = kisi.PersonelKodu,
            adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),

            /* Bölge müdürü görünümünde şube adı pozisyonun önünde: yayındaki
               uygulama (1.5) şubeye göre gruplamıyor, kartta şube böyle
               okunuyor. 1.6 gruplamayı sube alanıyla yapıyor, gorev'i yazıyor. */
            pozisyon = subeEki && !string.IsNullOrWhiteSpace(kisi.IsGrubu)
                ? $"{kisi.IsGrubu.Trim()} · {kisi.Pozisyon}"
                : kisi.Pozisyon,
            gorev = kisi.Pozisyon,
            sube = kisi.IsGrubu,
            durum = TamHaftaIzinli(DurumNormal((string)durum?.durum), yillikGunler.Count, satirlar.Count),
            /* Giriş/çıkış haftasında haftalık izin şartı yok (09.10.2026) */
            haftalikIzinVar = izinSayisi > 0 || yillikGunler.Count >= 7 || KismiHafta(kisi, hafta),
            haftalikIzinSayisi = izinSayisi,
            celiskiliGun = gunler.Count(x => x.celiski),
            devamsizGun = gunler.Count(x => x.devamsiz),
            surum = (int?)durum?.surum ?? 0,
            redNeden = (string)null,
            redGun = (DateTime?)null,
            gonderen = (string)durum?.gonderen,
            gonderme = (DateTime?)durum?.gonderme,
            uyarilar,
            izinNotlari,
            ozelDurum = ozel is null ? null : new
            {
                id = (int)ozel.id,
                izinGun = (DateTime)ozel.izinGun,
                talepGun = (DateTime?)ozel.talepGun,
                aciklama = (string)ozel.aciklama,
                durum = (string)ozel.durum,
                kararVeren = (string)ozel.kararVeren,
                kararNotu = (string)ozel.kararNotu,
                kararTarihi = (DateTime?)ozel.kararTarihi,
                olusturma = (DateTime)ozel.olusturma,
            },
            gunler,
        };
    }

    /* ==================================================================== */
    /* Şablonlar (İK paneli)                                                */
    /* ==================================================================== */

    [HttpGet("Sablonlar")]
    public IActionResult SablonListe()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT id, ad, renk, sira, aktif, tip FROM KRY_VARDIYA_SABLON ORDER BY sira, id")
            .Select(x => new
            {
                id = (int)x.id,
                ad = (string)x.ad,
                renk = (string)x.renk,
                sira = (int)x.sira,
                aktif = (bool)x.aktif,
                tip = TipBul((string)x.tip, (string)x.ad),
            })
            .ToList();

        return Ok(new { sablonlar = liste });
    }

    public class SablonGirdi
    {
        public int Id { get; set; }
        public string Ad { get; set; }

        /// <summary>sabah · aksam · araci · diger — dinlenme uyarısı buna bakar.</summary>
        public string Tip { get; set; }
        public string Renk { get; set; }
        public int Sira { get; set; }
        public bool Aktif { get; set; } = true;
    }

    /// <summary>
    /// Vardiya türü kaydı. Saat alınmıyor: her mağazanın açılış kapanış
    /// saati farklı, tür yalnızca "sabahçı / akşamcı / aracı" bilgisini
    /// taşıyor.
    /// </summary>
    [HttpPost("Sablon")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
    public IActionResult SablonKaydet([FromBody] SablonGirdi g)
    {
        if (string.IsNullOrWhiteSpace(g?.Ad)) return BadRequest(new { hata = "Vardiya türünün adını giriniz." });

        var tip = TipBul(g.Tip, g.Ad);

        using var db = _vt.Baglanti();

        if (g.Id > 0)
            db.Execute(@"
UPDATE KRY_VARDIYA_SABLON
SET ad = @ad, tip = @tip, renk = @renk, sira = @sira, aktif = @aktif,
    guncelleyen = @yapan, guncelleme = SYSDATETIME()
WHERE id = @id",
                new { id = g.Id, ad = g.Ad.Trim(), tip, renk = g.Renk ?? "mavi", sira = g.Sira,
                      aktif = g.Aktif, yapan = User?.Identity?.Name });
        else
            db.Execute(@"
INSERT INTO KRY_VARDIYA_SABLON (ad, tip, renk, sira, aktif, guncelleyen)
VALUES (@ad, @tip, @renk, @sira, @aktif, @yapan)",
                new { ad = g.Ad.Trim(), tip, renk = g.Renk ?? "mavi", sira = g.Sira,
                      aktif = g.Aktif, yapan = User?.Identity?.Name });

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Mobil — müdür                                                        */
    /* ==================================================================== */

    /// <summary>Müdürün ekibinin haftalık planı.</summary>
    [HttpGet("Ekip")]
    [Authorize(Roles = "Personel")]
    public IActionResult Ekip([FromQuery] DateTime? hafta)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var h = HaftaBasi(hafta ?? DateTime.Today);
        var ekip = _ekip.VardiyaKapsami(ben);

        /* Bölge müdürü: şubeler → mağaza müdürleri (06.10.2026) */
        var bolgeSubeleri = _ekip.BolgeSubeleri(ben);
        var bolge = bolgeSubeleri.Count > 0;

        using var db = _vt.Baglanti();

        var sablonlar = Sablonlar(db);

        return Ok(new
        {
            hafta = h,
            yonetici = ekip.Count > 0 || bolge,
            bolge,
            subeler = bolgeSubeleri,
            sablonlar = sablonlar.Select(s => new { s.Id, s.Ad, s.Renk, s.Tip }),
            /* ToList şart: tembel bırakılan liste, bağlantı kapandıktan
               sonra JSON'a çevrilirken okunuyor ve "ConnectionString has
               not been initialized" hatası veriyordu. */
            kisiler = ekip.Select(k => HaftaOku(db, k, h, sablonlar, bolge)).ToList(),
        });
    }

    public class AtaGirdi
    {
        public string Sicil { get; set; }
        public DateTime Gun { get; set; }

        /// <summary>Şablon kimliği; boşsa tür izin ya da boş.</summary>
        public int? SablonId { get; set; }

        /// <summary>vardiya | izin | off</summary>
        public string Tur { get; set; }

        /// <summary>Aynı vardiya haftanın çalışma günlerine uygulansın mı.</summary>
        public bool Haftaya { get; set; }
    }

    /// <summary>
    /// Bir güne vardiya, haftalık izin ya da boş atar.
    ///
    /// Dinlenme kuralı engel değil: akşamcı → sabahçı geçişi yanıttaki
    /// <c>uyarilar</c> listesinde dönüyor, kayıt yapılıyor. Gönderilmiş
    /// plan değişince "değişti" durumuna geçiyor; yönetici yeniden
    /// gönderdiğinde personele güncelleme bildirimi gidiyor.
    /// </summary>
    [HttpPost("Ata")]
    [Authorize(Roles = "Personel")]
    public IActionResult Ata([FromBody] AtaGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(g?.Sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        if (!_ekip.VardiyaKapsami(ben).Any(x => K(x.PersonelKodu) == K(hedef.PersonelKodu)))
            return StatusCode(403, new { hata = "Bu personelin planını düzenleme yetkiniz yok." });

        using var db = _vt.Baglanti();

        var sonuc = AtaUygula(db, hedef, g, $"{ben.Ad} {ben.Soyad}".Trim(),
            "Yönetici gönderilmiş planı değiştirdi");

        if (sonuc.Hata is not null) return BadRequest(sonuc.Hata);

        return Ok(new
        {
            basarili = true,
            uyarilar = sonuc.Uyarilar,
            durum = sonuc.Durum,

            /* Eski sürüm mobil uygulama bu alanı okuyor; artık hiçbir gün
               kendiliğinden boşaltılmıyor. */
            temizlenen = new List<string>(),
        });
    }

    /// <summary>Atamanın sonucu: hata varsa yalnızca o dolu.</summary>
    private sealed record AtaSonucu(object Hata, List<string> Uyarilar, string Durum);

    /// <summary>
    /// Atamanın kendisi: mobildeki müdür (Ata) ve İK paneli (PanelAta)
    /// aynı kuralları buradan uyguluyor. Yetki denetimi çağıranda.
    /// </summary>
    /// <param name="degistiOlayi">Gönderilmiş plan değiştiğinde süreç kaydına yazılan olay.</param>
    private AtaSonucu AtaUygula(IDbConnection db, PersonelKaydi hedef, AtaGirdi g, string yapan,
        string degistiOlayi)
    {
        var sablonlar = Sablonlar(db);
        var kod = hedef.PersonelKodu.Trim();
        var hafta = HaftaBasi(g.Gun);

        AtaSonucu Hata(object h) => new(h, new List<string>(), null);

        var tur = string.IsNullOrWhiteSpace(g.Tur) ? (g.SablonId is null ? "off" : "vardiya") : g.Tur;

        if (tur is not ("vardiya" or "izin" or "off"))
            return Hata(new { hata = "Geçersiz gün türü." });

        var sablon = g.SablonId is null ? null : sablonlar.FirstOrDefault(x => x.Id == g.SablonId);

        if (tur == "vardiya" && sablon is null)
            return Hata(new { hata = "Vardiya türü bulunamadı." });

        var gunler = g.Haftaya
            ? Enumerable.Range(0, 7).Select(i => hafta.AddDays(i)).ToList()
            : new List<DateTime> { g.Gun.Date };

        var yillikGunler = YillikIzinGunleri(db, kod, hafta, hedef);
        var uyarilar = new List<string>();

        foreach (var gun in gunler)
        {
            /* Yıllık izinli gün planlanamıyor: izin talebi onaylandığında
               o gün zaten yıllık izin olarak görünüyor. */
            if (yillikGunler.Contains(gun.Date))
            {
                if (g.Haftaya) continue;

                var izinTuru = SistemIzinleri(db, kod, hafta, hedef).TryGetValue(gun.Date, out var iz) ? iz.Tur : "İzin";
                var raporlu = IzinKisaAdi(izinTuru) == "Raporlu";

                if (izinTuru is GirisOncesi or CikisSonrasi)
                    return Hata(new
                    {
                        hata = izinTuru == GirisOncesi ? "Personel bu tarihte henüz işe başlamamış." : "Personel bu tarihte işten ayrılmış.",
                        ayrinti = izinTuru == GirisOncesi
                            ? $"İşe giriş tarihi {hedef.GirisTarihi:dd.MM.yyyy}. Önceki günler planlanmaz; bu hafta haftalık izin de zorunlu değil."
                            : $"Çıkış tarihi {hedef.CikisTarihi:dd.MM.yyyy}.",
                    });

                return Hata(new
                {
                    hata = raporlu ? "Personel bu gün raporlu." : "Personel bu gün izinli.",
                    ayrinti = $"{GunAdi(gun)}: {izinTuru}. Sistemde izin ya da rapor kaydı olan güne vardiya atanamaz; "
                              + "plan bu günü kendiliğinden gösterir.",
                });
            }

            /* Haftaya uygularken izin günleri korunuyor */
            if (g.Haftaya)
            {
                var mevcut = db.ExecuteScalar<string>(
                    "SELECT tur FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND gun = @gun",
                    new { kod, gun });

                if (mevcut == "izin") continue;
            }

            PlanYaz(db, kod, gun, sablon?.Id, tur, yapan);
        }

        if (tur == "vardiya" && sablon is not null)
            foreach (var gun in gunler.Where(x => !yillikGunler.Contains(x.Date)))
                uyarilar.AddRange(DinlenmeUyarilari(db, kod, gun, sablon, sablonlar));

        /* Haftada bir gün haftalık izin zorunlu: hafta dolduğunda izin
           verilmemişse yönetici uyarılıyor (gönderim bu durumda yapılmıyor). */
        var izinSayisi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND hafta = @hafta AND tur = N'izin'",
            new { kod, hafta });

        var doluGun = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND hafta = @hafta",
            new { kod, hafta }) + yillikGunler.Count;

        if (izinSayisi == 0 && doluGun >= 7 && yillikGunler.Count < 7 && !KismiHafta(hedef, hafta))
            uyarilar.Add("Bu hafta haftalık izin günü verilmedi. Haftada 1 gün izin zorunlu; "
                         + "izin günü verilmeden plan gönderilemez.");

        /* Gönderilmiş plan değişti: personel yeniden gönderilene kadar
           eski hâlini görüyor sayılır; yönetici "Planı gönder" ile
           güncellemeyi bildiriyor. */
        var oncekiDurum = DurumNormal(db.ExecuteScalar<string>(
            "SELECT durum FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @hafta",
            new { kod, hafta }));

        if (oncekiDurum == "gonderildi")
        {
            DurumYaz(db, kod, hafta, "degisti");
            Log(db, kod, hafta, degistiOlayi, null, yapan);
        }

        return new AtaSonucu(null, uyarilar.Distinct().ToList(),
            oncekiDurum == "gonderildi" ? "degisti" : oncekiDurum);
    }

    public class GonderGirdi
    {
        public DateTime Hafta { get; set; }

        /// <summary>Boşsa taslak ve değişmiş planı olan herkes.</summary>
        public List<string> Siciller { get; set; }
    }

    /// <summary>
    /// Planı personele bildirir. Onay beklenmiyor; plan bildirim olarak
    /// düşüyor ve personel uygulamadan görüyor.
    /// </summary>
    [HttpPost("Gonder")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> Gonder([FromBody] GonderGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized();

        var hafta = HaftaBasi(g?.Hafta ?? DateTime.Today);
        var ekip = _ekip.VardiyaKapsami(ben);
        var yapan = $"{ben.Ad} {ben.Soyad}".Trim();

        using var db = _vt.Baglanti();

        var (gonderilen, eksikIzin) = await GonderUygula(db, ekip, hafta, g?.Siciller, yapan, "yöneticiniz");

        if (eksikIzin.Count > 0 && gonderilen == 0)
            return BadRequest(new
            {
                hata = "Haftalık izin günü verilmemiş.",
                ayrinti = "Haftada 1 gün izin zorunlu. İzin günü verilmeyen personel: "
                        + string.Join(", ", eksikIzin),
            });

        return Ok(new { basarili = true, gonderilen, eksikIzin });
    }

    /// <summary>
    /// Gönderimin kendisi: taslak ya da değişmiş planları gönderir,
    /// personele bildirim düşer. Mobil (Gonder) ve İK paneli (PanelGonder)
    /// ortak kullanıyor; kapsam çağıranda belirleniyor.
    /// </summary>
    /// <param name="kimden">Bildirim metninde planı paylaşan: "yöneticiniz", "İnsan Kaynakları".</param>
    private async Task<(int gonderilen, List<string> eksikIzin)> GonderUygula(IDbConnection db,
        IEnumerable<PersonelKaydi> kisiler, DateTime hafta, List<string> siciller, string yapan, string kimden)
    {
        var gonderilen = 0;
        var eksikIzin = new List<string>();

        foreach (var k in kisiler)
        {
            var kod = k.PersonelKodu.Trim();

            if (siciller is { Count: > 0 } && !siciller.Any(x => K(x) == K(kod))) continue;

            var durum = DurumNormal(db.ExecuteScalar<string>(
                "SELECT durum FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @hafta",
                new { kod, hafta }));

            /* Değişmemiş, gönderilmiş plan yeniden gönderilmiyor:
               personel boş yere rahatsız edilmesin. */
            if (durum == "gonderildi") continue;

            var doluGun = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND hafta = @hafta",
                new { kod, hafta });

            if (doluGun == 0) continue;

            /* Haftada bir gün haftalık izin zorunlu. Yıllık izinle
               haftası tamamen dolu olan personel bunun dışında. */
            var izinGun = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND hafta = @hafta AND tur = N'izin'",
                new { kod, hafta });

            var yillikGun = YillikIzinGunleri(db, kod, hafta, k).Count;

            /* İşe girdiği (ya da çıktığı) hafta tam değil: haftalık izin
               şartı aranmıyor (09.10.2026). Cuma giren personel Cuma–Pazar
               çalışıp Pazartesi izin kullanabiliyor. */
            if (izinGun == 0 && yillikGun < 7 && !KismiHafta(k, hafta))
            {
                eksikIzin.Add($"{k.Ad} {k.Soyad}".Trim());
                continue;
            }

            var guncelleme = durum == "degisti";

            DurumYaz(db, kod, hafta, "gonderildi", surumArtir: true, gonderen: yapan);

            var surum = db.ExecuteScalar<int>(
                "SELECT surum FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @hafta",
                new { kod, hafta });

            Log(db, kod, hafta, guncelleme ? $"Güncel plan gönderildi ({surum}. sürüm)" : "Plan gönderildi",
                null, yapan);

            try
            {
                await _bildirim.Gonder(kod,
                    guncelleme ? "Vardiya planınız güncellendi" : "Vardiya planınız hazır",
                    $"{hafta:dd.MM} – {hafta.AddDays(6):dd.MM} haftasının planı "
                    + (guncelleme ? $"{kimden} tarafından güncellendi." : $"{kimden} tarafından paylaşıldı.")
                    + " Uygulamadaki Vardiya Planı ekranından görebilirsiniz.",
                    "vardiyaplani");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Vardiya planı bildirimi gönderilemedi");
            }

            gonderilen++;
        }

        return (gonderilen, eksikIzin);
    }

    /// <summary>
    /// Geçen haftanın planını bu haftaya kopyalar.
    ///
    /// Yıllık izinli günler atlanıyor. Dinlenme kuralı artık engel değil;
    /// akşamcı → sabahçı geçişleri uyarı olarak dönüyor.
    /// </summary>
    [HttpPost("GecenHafta")]
    [Authorize(Roles = "Personel")]
    public IActionResult GecenHafta([FromBody] GonderGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized();

        var hafta = HaftaBasi(g?.Hafta ?? DateTime.Today);
        var ekip = _ekip.VardiyaKapsami(ben);
        var yapan = $"{ben.Ad} {ben.Soyad}".Trim();

        using var db = _vt.Baglanti();

        var (kisi, gunSayisi, uyarilar) = GecenHaftaUygula(db, ekip, hafta, g?.Siciller, yapan);

        return Ok(new
        {
            basarili = true,
            kisi,
            gun = gunSayisi,
            uyarilar = uyarilar.Take(15),

            /* Eski sürüm mobil uygulama için: artık gün atlanmıyor */
            atlanan = new List<string>(),
        });
    }

    /// <summary>
    /// Geçen haftanın kopyalanması: mobil (GecenHafta) ve İK paneli
    /// (PanelGecenHafta) ortak kullanıyor; kapsam çağıranda belirleniyor.
    /// </summary>
    private (int kisi, int gun, List<string> uyarilar) GecenHaftaUygula(IDbConnection db,
        IEnumerable<PersonelKaydi> kisiler, DateTime hafta, List<string> siciller, string yapan)
    {
        var onceki = hafta.AddDays(-7);
        var sablonlar = Sablonlar(db);

        int kisi = 0, gunSayisi = 0;
        var uyarilar = new List<string>();

        foreach (var k in kisiler)
        {
            var kod = k.PersonelKodu.Trim();

            if (siciller is { Count: > 0 } && !siciller.Any(x => K(x) == K(kod))) continue;

            var eski = db.Query(@"
SELECT gun, sablon_id AS sablonId, tur FROM KRY_VARDIYA_PLAN
WHERE personel_kodu = @kod AND hafta = @onceki", new { kod, onceki })
                .Select(x => (gun: (DateTime)x.gun, sablonId: (int?)x.sablonId, tur: (string)x.tur))
                .ToList();

            if (eski.Count == 0) continue;

            var yillik = YillikIzinGunleri(db, kod, hafta, k);
            var degisti = false;

            foreach (var e in eski)
            {
                var yeniGun = e.gun.AddDays(7);

                if (yeniGun < hafta || yeniGun > hafta.AddDays(6)) continue;
                if (yillik.Contains(yeniGun.Date)) continue;

                var sablon = e.sablonId is null ? null : sablonlar.FirstOrDefault(x => x.Id == e.sablonId);

                PlanYaz(db, kod, yeniGun, sablon?.Id, sablon is null && e.tur == "vardiya" ? "off" : e.tur, yapan);

                gunSayisi++;
                degisti = true;
            }

            if (degisti)
            {
                kisi++;

                var plan = HaftaOku(db, k, hafta, sablonlar) as dynamic;

                foreach (string u in plan.uyarilar)
                    uyarilar.Add($"{k.Ad} {k.Soyad}".Trim() + " · " + u);

                var durum = DurumNormal(db.ExecuteScalar<string>(
                    "SELECT durum FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @hafta",
                    new { kod, hafta }));

                if (durum == "gonderildi") DurumYaz(db, kod, hafta, "degisti");

                Log(db, kod, hafta, "Geçen haftanın planı kopyalandı", null, yapan);
            }
        }

        return (kisi, gunSayisi, uyarilar);
    }

    /* ==================================================================== */
    /* Mobil — personel                                                     */
    /* ==================================================================== */

    [HttpGet("Benim")]
    [Authorize(Roles = "Personel")]
    public IActionResult Benim([FromQuery] DateTime? hafta)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var h = HaftaBasi(hafta ?? DateTime.Today);

        using var db = _vt.Baglanti();

        var sablonlar = Sablonlar(db);
        var durum = DurumNormal(db.ExecuteScalar<string>(
            "SELECT durum FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @h",
            new { kod = ben.PersonelKodu.Trim(), h }));

        /* Gönderilmemiş plan personele gösterilmiyor: yönetici henüz
           kurarken yarım plan görünmesin. Haftası tamamen raporlu/izinli
           olan personel (plan girilmemiş) haftasını yine görür. */
        if (durum == "taslak")
            durum = TamHaftaIzinli(durum, YillikIzinGunleri(db, ben.PersonelKodu.Trim(), h, ben).Count,
                db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND hafta = @h",
                    new { kod = ben.PersonelKodu.Trim(), h }));

        var yayinlandi = durum is "gonderildi" or "degisti";

        return Ok(new { hafta = h, plan = yayinlandi ? HaftaOku(db, ben, h, sablonlar) : null, yayinlandi });
    }

    /// <summary>
    /// Eski onay ucu. Personel onayı kaldırıldı; eski sürüm uygulamalar
    /// çağırırsa açıklayıcı bir mesaj dönüyor.
    /// </summary>
    [HttpPost("Karar")]
    [Authorize(Roles = "Personel")]
    public IActionResult Karar() =>
        BadRequest(new
        {
            hata = "Vardiya planı artık onay gerektirmiyor.",
            ayrinti = "Plan size bildirim olarak gönderilir. Haftalık izin gününüz için özel "
                      + "bir durum varsa Vardiya Planı ekranından bildirebilirsiniz.",
        });

    /* ==================================================================== */
    /* Haftalık izin · özel durum                                           */
    /* ==================================================================== */

    public class OzelDurumGirdi
    {
        /// <summary>Yöneticinin verdiği haftalık izin günü.</summary>
        public DateTime IzinGun { get; set; }

        /// <summary>İzin olarak istenen gün (aynı hafta). Boşsa yönetici belirler.</summary>
        public DateTime? TalepGun { get; set; }

        public string Aciklama { get; set; }
    }

    /// <summary>
    /// Personel, yöneticinin verdiği haftalık izin günü için özel durum
    /// bildirir.
    ///
    /// Yalnızca planda haftalık izin olarak işaretli gün için açılabiliyor:
    /// personel izin gününü kendisi seçmiyor, yöneticinin belirlediği günü
    /// değiştirmek için gerekçe yazıyor. Yönetici kabul ederse izin günü
    /// istenen güne taşınır.
    /// </summary>
    [HttpPost("OzelDurum")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> OzelDurum([FromBody] OzelDurumGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var aciklama = (g?.Aciklama ?? "").Trim();

        if (aciklama.Length < 5)
            return BadRequest(new { hata = "Özel durumu kısaca açıklayınız (en az 5 karakter)." });

        if (aciklama.Length > 450)
            return BadRequest(new { hata = "Açıklama en fazla 450 karakter olabilir." });

        var izinGun = g.IzinGun.Date;
        var hafta = HaftaBasi(izinGun);
        var kod = ben.PersonelKodu.Trim();

        if (izinGun < DateTime.Today)
            return BadRequest(new { hata = "Geçmiş bir gün için özel durum bildirilemez." });

        using var db = _vt.Baglanti();

        var durum = DurumNormal(db.ExecuteScalar<string>(
            "SELECT durum FROM KRY_VARDIYA_PLAN_DURUM WHERE personel_kodu = @kod AND hafta = @hafta",
            new { kod, hafta }));

        if (durum == "taslak")
            return BadRequest(new { hata = "Bu haftanın planı henüz size gönderilmedi." });

        var tur = db.ExecuteScalar<string>(
            "SELECT tur FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND gun = @izinGun",
            new { kod, izinGun });

        if (tur != "izin")
            return BadRequest(new
            {
                hata = "Yalnızca yöneticinizin verdiği haftalık izin günü için özel durum bildirebilirsiniz.",
            });

        DateTime? talepGun = g.TalepGun?.Date;

        if (talepGun is not null)
        {
            if (talepGun < hafta || talepGun > hafta.AddDays(6) || talepGun == izinGun)
                return BadRequest(new { hata = "İstediğiniz gün aynı haftada ve izin gününüzden farklı olmalı." });

            if (talepGun < DateTime.Today)
                return BadRequest(new { hata = "Geçmiş bir gün seçilemez." });

            if (YillikIzinGunleri(db, kod, hafta).Contains(talepGun.Value))
                return BadRequest(new { hata = "Seçtiğiniz gün zaten yıllık izinli." });
        }

        var bekleyen = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_VARDIYA_OZEL_DURUM
WHERE personel_kodu = @kod AND hafta = @hafta AND durum = N'bekliyor'", new { kod, hafta });

        if (bekleyen > 0)
            return BadRequest(new { hata = "Bu hafta için yöneticinizin yanıtını bekleyen bir bildiriminiz var." });

        var ad = $"{ben.Ad} {ben.Soyad}".Trim();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_VARDIYA_OZEL_DURUM
    (personel_kodu, ad_soyad, sube_adi, hafta, izin_gun, talep_gun, aciklama)
OUTPUT INSERTED.id
VALUES (@kod, @ad, @sube, @hafta, @izinGun, @talepGun, @aciklama)",
            new { kod, ad, sube = ben.IsGrubu, hafta, izinGun, talepGun, aciklama });

        Log(db, kod, hafta, "Haftalık izin için özel durum bildirdi",
            (talepGun is null ? "" : $"İstenen gün: {GunAdi(talepGun.Value)} · ") + aciklama, ad);

        var yoneticiler = new HashSet<string>(_ekip.Yoneticiler().TryGetValue(K(kod), out var liste)
            ? liste : new HashSet<string>(), StringComparer.OrdinalIgnoreCase);

        /* Müdür yardımcıları da şubenin planını yapıyor (09.10.2026) */
        if (!_ekip.SubeYoneticisiMi(ben))
            foreach (var my in _ekip.SubeMudurYardimcilari(ben.IsGrubu))
                if (K(my.PersonelKodu) != K(kod)) yoneticiler.Add(my.PersonelKodu.Trim());

        foreach (var y in yoneticiler)
        {
            try
            {
                await _bildirim.Gonder(y, "Haftalık izin · özel durum",
                    $"{ad}, {GunAdi(izinGun)} ({izinGun:dd.MM}) izin günü için özel durum bildirdi"
                    + (talepGun is null ? "" : $"; {GunAdi(talepGun.Value)} günü izin istiyor")
                    + $": {aciklama}",
                    "vardiyaplani");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Özel durum bildirimi gönderilemedi");
            }
        }

        return Ok(new { basarili = true, id });
    }

    /// <summary>Yöneticinin yanıt bekleyen özel durum bildirimleri.</summary>
    [HttpGet("OzelDurumlar")]
    [Authorize(Roles = "Personel")]
    public IActionResult OzelDurumlar()
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        var ekip = _ekip.VardiyaKapsami(ben);

        if (ekip.Count == 0) return Ok(new { kayitlar = new List<object>() });

        var kodlar = ekip.Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase);

        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT id, personel_kodu AS personelKodu, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       hafta, izin_gun AS izinGun, talep_gun AS talepGun, aciklama, durum, olusturma
FROM KRY_VARDIYA_OZEL_DURUM
WHERE durum = N'bekliyor' ORDER BY olusturma")
            .Where(x => kodlar.Contains(K((string)x.personelKodu)))
            .Select(x => new
            {
                id = (int)x.id,
                personelKodu = (string)x.personelKodu,
                adSoyad = (string)x.adSoyad,
                pozisyon = ekip.FirstOrDefault(e => K(e.PersonelKodu) == K((string)x.personelKodu))?.Pozisyon,
                hafta = (DateTime)x.hafta,
                izinGun = (DateTime)x.izinGun,
                izinGunAdi = GunAdi((DateTime)x.izinGun),
                talepGun = (DateTime?)x.talepGun,
                talepGunAdi = x.talepGun is null ? null : GunAdi((DateTime)x.talepGun),
                aciklama = (string)x.aciklama,
                olusturma = (DateTime)x.olusturma,
            })
            .ToList();

        return Ok(new { kayitlar });
    }

    public class OzelDurumKararGirdi
    {
        public int Id { get; set; }
        public bool Kabul { get; set; }

        /// <summary>Yeni haftalık izin günü; boşsa personelin istediği gün.</summary>
        public DateTime? YeniGun { get; set; }

        public string Not { get; set; }
    }

    /// <summary>
    /// Yönetici özel durumu kabul eder ya da reddeder.
    ///
    /// Kabulde izin günü yeni güne taşınır; yeni günün vardiyası eski izin
    /// gününe geçer (günler yer değiştirir). Böylece haftada bir gün izin
    /// kuralı bozulmaz.
    /// </summary>
    [HttpPost("OzelDurumKarar")]
    [Authorize(Roles = "Personel")]
    public async Task<IActionResult> OzelDurumKarar([FromBody] OzelDurumKararGirdi g)
    {
        var ben = _ekip.Kisi(Sicil());

        if (ben is null) return Unauthorized();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, hafta, izin_gun AS izinGun,
       talep_gun AS talepGun, durum
FROM KRY_VARDIYA_OZEL_DURUM WHERE id = @id", new { id = g?.Id ?? 0 });

        if (kayit is null) return NotFound(new { hata = "Bildirim bulunamadı." });

        if ((string)kayit.durum != "bekliyor")
            return BadRequest(new { hata = "Bu bildirim zaten yanıtlanmış." });

        var kod = ((string)kayit.kod).Trim();

        if (!_ekip.VardiyaKapsami(ben).Any(x => K(x.PersonelKodu) == K(kod)))
            return StatusCode(403, new { hata = "Bu personelin planını düzenleme yetkiniz yok." });

        var yapan = $"{ben.Ad} {ben.Soyad}".Trim();
        var hafta = ((DateTime)kayit.hafta).Date;
        var izinGun = ((DateTime)kayit.izinGun).Date;
        var not = (g.Not ?? "").Trim();
        var uyarilar = new List<string>();

        if (not.Length > 480) not = not[..480];

        if (!g.Kabul)
        {
            if (not.Length < 3)
                return BadRequest(new { hata = "Reddetme sebebini yazınız." });

            db.Execute(@"
UPDATE KRY_VARDIYA_OZEL_DURUM
SET durum = N'red', karar_veren = @yapan, karar_notu = @not, karar_tarihi = SYSDATETIME()
WHERE id = @id", new { id = (int)kayit.id, yapan, not });

            Log(db, kod, hafta, "Özel durum reddedildi", not, yapan);

            await BildirimGonder(kod, "Özel durum bildiriminiz reddedildi",
                $"{GunAdi(izinGun)} izin gününüz değişmedi. {not}");

            return Ok(new { basarili = true });
        }

        var yeniGun = (g.YeniGun ?? (DateTime?)kayit.talepGun)?.Date;

        if (yeniGun is null)
            return BadRequest(new { hata = "Yeni haftalık izin gününü seçiniz." });

        /* Geçmiş günler değiştirilmiyor: geçmiş izin günü vardiyaya
           çevrilirse personel raporda "okutmadı" görünür. */
        if (izinGun < DateTime.Today || yeniGun < DateTime.Today)
            return BadRequest(new
            {
                hata = "Geçmiş bir gün için izin değiştirilemez.",
                ayrinti = "İzin günü ya da yeni gün geçmişte kaldı; bildirimi reddedip planı elle düzenleyebilirsiniz.",
            });

        if (yeniGun < hafta || yeniGun > hafta.AddDays(6) || yeniGun == izinGun)
            return BadRequest(new { hata = "Yeni gün aynı haftada ve mevcut izin gününden farklı olmalı." });

        if (YillikIzinGunleri(db, kod, hafta).Contains(yeniGun.Value))
            return BadRequest(new { hata = "Seçilen gün yıllık izinli." });

        var mevcutIzin = db.ExecuteScalar<string>(
            "SELECT tur FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND gun = @izinGun",
            new { kod, izinGun });

        if (mevcutIzin != "izin")
            return BadRequest(new { hata = "Personelin izin günü bu arada değiştirilmiş; planı kontrol ediniz." });

        /* Günler yer değiştiriyor: yeni günün vardiyası eski izin gününe */
        var yeniSatir = db.QueryFirstOrDefault(@"
SELECT sablon_id AS sablonId, tur FROM KRY_VARDIYA_PLAN
WHERE personel_kodu = @kod AND gun = @yeniGun", new { kod, yeniGun });

        var tasinanTur = (string)yeniSatir?.tur;
        int? tasinanSablon = (int?)yeniSatir?.sablonId;

        if (tasinanTur is null or "izin") { tasinanTur = "off"; tasinanSablon = null; }

        PlanYaz(db, kod, izinGun, tasinanSablon, tasinanTur, yapan);
        PlanYaz(db, kod, yeniGun.Value, null, "izin", yapan);

        var sablonlar = Sablonlar(db);
        var tasinan = tasinanSablon is null ? null : sablonlar.FirstOrDefault(x => x.Id == tasinanSablon);

        if (tasinan is not null)
            uyarilar.AddRange(DinlenmeUyarilari(db, kod, izinGun, tasinan, sablonlar));

        db.Execute(@"
UPDATE KRY_VARDIYA_OZEL_DURUM
SET durum = N'kabul', karar_veren = @yapan, karar_notu = @not, karar_tarihi = SYSDATETIME(),
    talep_gun = @yeniGun
WHERE id = @id", new { id = (int)kayit.id, yapan, not = not.Length > 0 ? not : null, yeniGun });

        Log(db, kod, hafta, "Özel durum kabul edildi",
            $"Haftalık izin {GunAdi(izinGun)} → {GunAdi(yeniGun.Value)}", yapan);

        await BildirimGonder(kod, "Haftalık izin gününüz değişti",
            $"Özel durum bildiriminiz kabul edildi. Bu hafta izin gününüz {GunAdi(yeniGun.Value)} "
            + $"({yeniGun:dd.MM}) olarak güncellendi."
            + (tasinan is not null ? $" {GunAdi(izinGun)} günü {tasinan.Ad} çalışacaksınız." : ""));

        return Ok(new { basarili = true, uyarilar });
    }

    private async Task BildirimGonder(string kod, string baslik, string metin)
    {
        try
        {
            await _bildirim.Gonder(kod, baslik, metin, "vardiyaplani");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Vardiya bildirimi gönderilemedi");
        }
    }

    /// <summary>
    /// Ekip arkadaşının haftalık vardiyası: yalnızca gün ve saat.
    ///
    /// Ekibim ekranında herkes birbirinin vardiyasını görebiliyor —
    /// kimin ne zaman çalıştığını bilmek günlük işin parçası. İzin,
    /// bakiye ve puantaj ayrıntısı burada dönmüyor; onu yalnızca
    /// yönetici görüyor.
    /// </summary>
    [HttpGet("Arkadas")]
    [Authorize(Roles = "Personel")]
    public IActionResult Arkadas([FromQuery] string sicil, [FromQuery] DateTime? hafta)
    {
        var ben = _ekip.Kisi(Sicil());
        var hedef = _ekip.Kisi(sicil);

        if (ben is null) return Unauthorized();
        if (hedef is null) return NotFound(new { hata = "Personel bulunamadı." });

        var ayniEkip = _ekip.EkipArkadaslari(ben)
            .Any(x => K(x.PersonelKodu) == K(hedef.PersonelKodu));

        if (!ayniEkip && K(ben.PersonelKodu) != K(hedef.PersonelKodu))
            return StatusCode(403, new { hata = "Bu personel ekibinizde değil." });

        var h = HaftaBasi(hafta ?? DateTime.Today);

        using var db = _vt.Baglanti();

        var plan = HaftaOku(db, hedef, h, Sablonlar(db)) as dynamic;

        /* Yöneticinin henüz göndermediği plan ekip arkadaşlarına da
           gösterilmiyor. */
        var yayinlandi = (string)plan.durum is "gonderildi" or "degisti";

        return Ok(new
        {
            hafta = h,
            sicil = hedef.PersonelKodu,
            adSoyad = $"{hedef.Ad} {hedef.Soyad}".Trim(),
            pozisyon = hedef.Pozisyon,
            yayinlandi,

            /* İznin türü kişisel (raporlu gibi): ekip arkadaşı yalnızca
               "İzinli" görüyor. */
            gunler = yayinlandi
                ? ((IEnumerable<dynamic>)plan.gunler).Select(g => (object)new
                {
                    tarih = (DateTime)g.tarih,
                    tur = (string)g.tur,
                    ad = (string)g.tur == "yillik" ? "İzinli" : (string)g.ad,
                    sablonId = (int?)g.sablonId,
                    tip = (string)g.tip,
                    renk = (string)g.renk,
                }).ToList()
                : new List<object>(),
        });
    }

    /* ==================================================================== */
    /* İK paneli                                                            */
    /* ==================================================================== */

    /// <summary>Bölge ve şube bazında haftalık planların durumu.</summary>
    [HttpGet("Panel")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK
                       + "," + Roller.BolgeKoordinatoru + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult Panel([FromQuery] DateTime? hafta, [FromQuery] string sube = null)
    {
        var h = HaftaBasi(hafta ?? DateTime.Today);

        using var db = _vt.Baglanti();

        var sablonlar = Sablonlar(db);
        var personel = _ekip.Aktifler();

        var durumlar = db.Query(@"
SELECT personel_kodu AS kod, durum, surum, red_neden AS redNeden, gonderen
FROM KRY_VARDIYA_PLAN_DURUM WHERE hafta = @h", new { h })
            .ToDictionary(x => ((string)x.kod ?? "").Trim(),
                x => (durum: (string)x.durum, surum: (int)x.surum, red: (string)x.redNeden,
                      gonderen: (string)x.gonderen),
                StringComparer.OrdinalIgnoreCase);

        /* Haftası tamamen raporlu/izinli olanlar planlanmamış sayılmıyor */
        var tamHafta = TamHaftaIzinliler(db, h);

        /* Şube kartları: onay oranı ve bekleyen/red/planlanmamış sayısı */
        var kartlar = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.IsGrubu))
            .GroupBy(x => x.IsGrubu.Trim())
            .Select(grup =>
            {
                string D(PersonelKaydi p)
                {
                    var d = DurumNormal(durumlar.TryGetValue(p.PersonelKodu.Trim(), out var x) ? x.durum : null);
                    return d == "taslak" && tamHafta.Contains(K(p.PersonelKodu)) ? "gonderildi" : d;
                }

                var toplam = grup.Count();
                var gonderildi = grup.Count(x => D(x) == "gonderildi");

                return new
                {
                    sube = grup.Key,
                    toplam,
                    /* Eski alan adları korunuyor: onay = personele gönderilmiş,
                       red = gönderildikten sonra değişmiş (yeniden gönderilmeli) */
                    onay = gonderildi,
                    gonderildi,
                    bekliyor = 0,
                    red = grup.Count(x => D(x) == "degisti"),
                    degisti = grup.Count(x => D(x) == "degisti"),
                    planlanmadi = grup.Count(x => D(x) == "taslak"),
                    oran = toplam > 0 ? Math.Round(100m * gonderildi / toplam) : 0m,
                };
            })
            .OrderBy(x => x.oran)
            .ToList();

        var satirlar = string.IsNullOrWhiteSpace(sube)
            ? new List<object>()
            : personel
                .Where(x => PersonelKaynagiServisi.Benziyor(sube, x.IsGrubu ?? ""))
                .OrderBy(x => x.Ad)
                .Select(x => HaftaOku(db, x, h, sablonlar))
                .ToList();

        /* İK paneli planı düzenleyebiliyor mu (PanelAta, PanelGonder…) */
        return Ok(new { hafta = h, kartlar, satirlar, duzenleyebilir = PanelDuzenleyebilir });
    }

    /// <summary>Bir personelin haftasının süreç geçmişi.</summary>
    [HttpGet("Gecmis")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK
                       + "," + Roller.BolgeKoordinatoru + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult Gecmis([FromQuery] string sicil, [FromQuery] DateTime hafta)
    {
        using var db = _vt.Baglanti();

        var h = HaftaBasi(hafta);

        var kayitlar = db.Query(@"
SELECT olay, aciklama, yapan, olusturma FROM KRY_VARDIYA_PLAN_LOG
WHERE personel_kodu = @sicil AND hafta = @h ORDER BY id",
            new { sicil = (sicil ?? "").Trim(), h }).ToList();

        return Ok(new { kayitlar });
    }
}

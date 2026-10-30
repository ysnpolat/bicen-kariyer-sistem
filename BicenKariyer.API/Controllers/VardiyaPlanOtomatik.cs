using System.Data;
using Dapper;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Vardiya planı otomatik gönderim (21.10.2026).
///
/// <para>
/// Yöneticiler vardiyaları girip "Planı gönder"e basmayı unutuyordu; plan
/// taslakta kalıyor, personel göremiyordu. Atama zaten hücre hücre
/// kaydediliyor; eksik olan yalnızca gönderim. Haftanın 7 günü dolu
/// (vardiya, haftalık izin, onaylı yıllık izin ya da işe giriş/çıkış dışı
/// gün) ve son değişiklikten bu yana vardiya.otomatikGonderDakika geçmiş
/// planlar gönderilir. Yarım bırakılmış plan gönderilmez; haftalık izin
/// şartı da aynen aranır (GonderUygula).
/// </para>
/// </summary>
public partial class VardiyaPlanController
{
    public async Task<int> OtomatikGonder(int sessizDakika)
    {
        if (sessizDakika <= 0) return 0;

        using var db = _vt.Baglanti();

        var buHafta = HaftaBasi(DateTime.Today);

        var adaylar = db.Query(@"
SELECT p.personel_kodu AS kod, p.hafta, COUNT(*) AS gun, MAX(p.guncelleme) AS son,
       (SELECT TOP 1 x.guncelleyen FROM KRY_VARDIYA_PLAN x
         WHERE x.personel_kodu = p.personel_kodu AND x.hafta = p.hafta
         ORDER BY x.guncelleme DESC) AS yapan,
       d.durum
FROM KRY_VARDIYA_PLAN p
LEFT JOIN KRY_VARDIYA_PLAN_DURUM d ON d.personel_kodu = p.personel_kodu AND d.hafta = p.hafta
WHERE p.hafta >= @buHafta
GROUP BY p.personel_kodu, p.hafta, d.durum
HAVING MAX(p.guncelleme) < DATEADD(MINUTE, -@dk, SYSDATETIME())",
            new { buHafta, dk = sessizDakika }).ToList();

        var toplam = 0;

        foreach (var a in adaylar)
        {
            var durum = DurumNormal((string)a.durum);
            if (durum is not ("taslak" or "degisti")) continue;

            string kod = ((string)a.kod).Trim();
            DateTime hafta = ((DateTime)a.hafta).Date;

            var kisi = _ekip.Kisi(kod);
            if (kisi is null) continue;

            /* Yarım plan gönderilmez: dolu + yıllık izin + istihdam dışı günler 7 olmalı */
            var gunler = db.Query<DateTime>(
                "SELECT gun FROM KRY_VARDIYA_PLAN WHERE personel_kodu = @kod AND hafta = @hafta",
                new { kod, hafta }).Select(x => x.Date).ToHashSet();

            gunler.UnionWith(YillikIzinGunleri(db, kod, hafta, kisi));
            gunler.UnionWith(IstihdamDisiGunler(kisi, hafta).Select(x => x.gun.Date));

            if (gunler.Count(g => g >= hafta && g < hafta.AddDays(7)) < 7) continue;

            var yapan = $"{((string)a.yapan ?? "").Trim()} (otomatik gönderim)".Trim();

            var (gonderilen, _) = await GonderUygula(db, new[] { kisi }, hafta, null, yapan, "yöneticiniz");
            toplam += gonderilen;
        }

        return toplam;
    }
}

using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Data;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Aday havuzu: durumu "Olumlu" olan başvurular, kadro planındaki açık
/// pozisyonlara göre gruplanır. Böylece hangi bölümde hedefin ne kadarının
/// karşılandığı görülür.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class HavuzController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly OnayServisi _onay;
    private readonly ILogger<HavuzController> _kayit;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly AyrilacakPersonelServisi _ayrilacak;

    public HavuzController(
        VeritabaniServisi vt, AyarServisi ayar, OnayServisi onay,
        ILogger<HavuzController> kayit, PersonelKaynagiServisi personelKaynak,
        AyrilacakPersonelServisi ayrilacak)
    {
        _vt = vt;
        _ayar = ayar;
        _onay = onay;
        _kayit = kayit;
        _personelKaynak = personelKaynak;
        _ayrilacak = ayrilacak;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private string AdSoyad =>
        User?.FindFirst("adSoyad")?.Value ?? Kullanici;

    /// <summary>Şube kodundan bölge adını bulur</summary>
    private static string BolgeBul(string subeKodu, FormAyarlari ayar)
    {
        if (string.IsNullOrWhiteSpace(subeKodu)) return "Bölgesiz";

        var bolge = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .FirstOrDefault(b => (b.Subeler ?? new List<string>())
                .Any(k => string.Equals(k, subeKodu, StringComparison.OrdinalIgnoreCase)));

        return bolge?.Ad ?? "Bölgesiz";
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>
    /// 1 numaralı kullanıcı: sistem yöneticisi. Norm kadro değişikliği
    /// onay beklemeden uygulanabilen tek hesap.
    /// </summary>
    private bool SistemYoneticisi =>
        int.TryParse(
            User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
            out var id) && id == 1;
    private bool SubeSiniri => Roller.SubeSiniri(Rol);

    private string[] YetkiliSubeler()
    {
        var ham = User?.FindFirst("subeler")?.Value ?? "";
        var liste = ham.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        return liste.Length > 0 ? liste : new[] { "__TANIMSIZ__" };
    }

    /// <summary>
    /// Sağ üstteki bölge seçicisinde seçilen bölgelerin şube kodları.
    /// Seçim yoksa null döner ve süzme uygulanmaz.
    /// </summary>
    private string[] SecilenBolgeSubeleri()
    {
        if (!Roller.BolgeSecici(Rol)) return null;

        var secim = Request.Headers["X-Bolge"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(secim)) return null;

        var bolgeAdlari = secim
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => Uri.UnescapeDataString(x.Trim()))
            .Where(x => x.Length > 0)
            .ToArray();

        if (bolgeAdlari.Length == 0) return null;

        var ayar = _ayar.FormOku();

        var kodlar = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => bolgeAdlari.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return kodlar.Length > 0 ? kodlar : new[] { "__TANIMSIZ__" };
    }

    /// <summary>Bölge seçimi etkin mi</summary>
    private bool BolgeSuzgeci => SecilenBolgeSubeleri() is not null;

    /// <summary>Süzmede kullanılacak şube listesi</summary>
    private string[] SuzmeSubeleri() =>
        SecilenBolgeSubeleri() ?? YetkiliSubeler();

    /// <summary>Şube süzmesi uygulanacak mı (yetki veya bölge seçimi)</summary>
    private bool SubeSuzmesi => SubeSiniri || BolgeSuzgeci;

    /// <summary>
    /// Yetkili şubelerin KOD kümesi.
    ///
    /// <para>
    /// Bölge tanımında şubeler kimi yerde kod, kimi yerde ad ile yazılmış.
    /// Doğrudan kod karşılaştırması yapılınca adla yazılmış şubeler hiçbir
    /// koda denk gelmiyor, süzgeç boş küme üretiyor ve sonrasındaki
    /// "tanımsız kodu geri ekle" mantığı bütün şubeleri geri getiriyordu:
    /// bölge müdürü şube raporunda 37 şubenin tamamını görüyordu.
    /// </para>
    ///
    /// <para>
    /// Bu yüzden her iki yazım da koda çevriliyor.
    /// </para>
    /// </summary>
    private HashSet<string> YetkiliKodlar()
    {
        var tanimlar = _ayar.FormOku().Subeler ?? new List<Sube>();

        var kodlar = SuzmeSubeleri()
            .Select(y =>
                tanimlar.FirstOrDefault(x =>
                    string.Equals(x.Kod, y, StringComparison.OrdinalIgnoreCase))?.Kod
                ?? tanimlar.FirstOrDefault(x =>
                    string.Equals(x.Ad, y, StringComparison.OrdinalIgnoreCase))?.Kod
                ?? y)
            .Where(x => !string.IsNullOrWhiteSpace(x));

        return kodlar.ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    /* ====================================================================== */
    /* Kadro planı                                                            */
    /* ====================================================================== */

    [HttpGet("Kadro")]
    public IActionResult KadroListe()
    {
        using var db = _vt.Baglanti();

        /* 'Mevcut' değerleri burada da tazelenir. Bu uç, Kadro Düzenleme
           sekmesini besler; senkron yalnızca NormRapor'da çalıştığında bu
           ekran son rapor açılışından kalma eski sayıları gösteriyordu ve
           pozisyona tıklayınca çıkan canlı listeyle çelişiyordu. */
        MikrodanMevcutGuncelle(db);

        var liste = db.Query<Kadro>(@"
SELECT id AS Id, bolum AS Bolum, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       ISNULL(norm, 0) AS Norm, ISNULL(mevcut, 0) AS Mevcut,
       ISNULL(engelli, 0) AS Engelli, eksik_baslangic AS EksikBaslangic,
       fazla_baslangic AS FazlaBaslangic,
       hedef AS Hedef, aciklama AS Aciklama, aktif AS Aktif, olusturma AS Olusturma,
       CASE WHEN eksik_baslangic IS NULL THEN 0
            ELSE DATEDIFF(day, eksik_baslangic, SYSDATETIME()) END AS EksikGun,
       CASE WHEN fazla_baslangic IS NULL THEN 0
            ELSE DATEDIFF(day, fazla_baslangic, SYSDATETIME()) END AS FazlaGun,
       CASE WHEN ISNULL(mevcut, 0) > ISNULL(norm, 0)
            THEN ISNULL(mevcut, 0) - ISNULL(norm, 0) ELSE 0 END AS Fazla
FROM KRY_KADRO
ORDER BY sube_adi, bolum").ToList();

        /* Bugün raporlu çalışanlar pozisyon satırlarına (kişi sayısı;
           mevcuda dahil, yalnızca bilgi) */
        RaporlulariDagit(liste, RaporluDagilimi(db, DateTime.Today));

        /* Şube süzmesi burada uygulanmıyordu: bölge müdürü kendi
           şubelerinin değil, tüm şubelerin kadrosunu görüyordu. Diğer
           uçlarda kullanılan aynı yardımcılar burada da geçerli. */
        if (SubeSuzmesi)
        {
            var izinli = YetkiliKodlar();

            liste = liste.Where(k => izinli.Contains(k.SubeKodu ?? "")).ToList();
        }

        /* Yönetim → Şubeler'de 'Norm raporunda gizle' işaretli birimler
           norm kadro ekranlarının hiçbirinde görünmez. Kadro kayıtları ve
           personel sayımı yerinde durur, yalnızca listelenmez. */
        var gizliKodlar = (_ayar.FormOku().Subeler ?? new List<Sube>())
            .Where(x => x.NormRaporundaGizle && !string.IsNullOrWhiteSpace(x.Kod))
            .Select(x => x.Kod)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (gizliKodlar.Count > 0)
        {
            liste = liste
                .Where(k => !gizliKodlar.Contains(k.SubeKodu ?? ""))
                .ToList();
        }

        /* Bölge seçimi veya şube yetkisi varsa liste daraltılır.
           Şubesiz (tüm birimler) kadrolar her zaman görünür. */
        if (SubeSuzmesi)
        {
            var izinli = YetkiliKodlar();

            liste = liste
                .Where(k => string.IsNullOrWhiteSpace(k.SubeKodu) ||
                            izinli.Contains(k.SubeKodu))
                .ToList();
        }

        return Ok(liste);
    }

    [HttpPost("Kadro")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult KadroKaydet([FromBody] Kadro girdi)
    {
        if (girdi is null)
            return BadRequest(new { hata = "Kadro bilgisi okunamadı." });

        if (string.IsNullOrWhiteSpace(girdi.Bolum))
            return BadRequest(new { hata = "Bölüm seçiniz." });

        if (girdi.Norm < 0) girdi.Norm = 0;

        /* 'Mevcut' artık elle girilmez; Personeller sayfasındaki gerçek
           sayıdan otomatik hesaplanır (bkz. MikrodanMevcutGuncelle, norm
           kadro ekranı her açıldığında çalışır). Buradan gelen değer
           yoksayılır — yeni kayıtta 0'dan başlar, düzenlemede DB'deki
           son senkron değeri korunur; bir sonraki ekran açılışında zaten
           doğru sayıya güncellenir. */

        using var db = _vt.Baglanti();

        var mevcutDegeri = girdi.Id > 0
            ? db.ExecuteScalar<decimal?>(
                "SELECT mevcut FROM KRY_KADRO WHERE id = @id", new { id = girdi.Id }) ?? 0
            : 0;

        /* 'Engelli' de elle girilmez; personel kaydındaki engellilik
           derecesinden otomatik hesaplanır (bkz. MikrodanMevcutGuncelle). */
        girdi.Engelli = girdi.Id > 0
            ? db.ExecuteScalar<decimal?>(
                "SELECT engelli FROM KRY_KADRO WHERE id = @id", new { id = girdi.Id }) ?? 0
            : 0;

        // Norm kadro girildiyse ihtiyaç otomatik hesaplanır
        if (girdi.Norm > 0) girdi.Hedef = Math.Max(0, girdi.Norm - mevcutDegeri);
        if (girdi.Hedef < 0) girdi.Hedef = 0;

        if (girdi.Engelli < 0) girdi.Engelli = 0;

        /* Eksik varsa başlangıç tarihi korunur, yoksa sıfırlanır */
        DateTime? eksikBaslangic = girdi.EksikBaslangic;

        if (girdi.Hedef > 0 && eksikBaslangic is null)
            eksikBaslangic = DateTime.Now;
        else if (girdi.Hedef == 0)
            eksikBaslangic = null;

        /* Norm üstü personel varsa fazlalık tarihi tutulur */
        DateTime? fazlaBaslangic = girdi.FazlaBaslangic;
        var fazlaVar = mevcutDegeri > girdi.Norm;

        if (fazlaVar && fazlaBaslangic is null) fazlaBaslangic = DateTime.Now;
        else if (!fazlaVar) fazlaBaslangic = null;

        var parametre = new
        {
            id = girdi.Id,
            engelli = girdi.Engelli,
            eksikBaslangic,
            fazlaBaslangic,
            bolum = girdi.Bolum.Trim(),
            subeKodu = string.IsNullOrWhiteSpace(girdi.SubeKodu) ? null : girdi.SubeKodu.Trim(),
            subeAdi = string.IsNullOrWhiteSpace(girdi.SubeAdi) ? null : girdi.SubeAdi.Trim(),
            norm = girdi.Norm,
            mevcut = mevcutDegeri,
            hedef = girdi.Hedef,
            aciklama = girdi.Aciklama,
            aktif = girdi.Aktif
        };

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_KADRO
SET bolum = @bolum, sube_kodu = @subeKodu, sube_adi = @subeAdi,
    norm = @norm, hedef = @hedef, engelli = @engelli,
    eksik_baslangic = @eksikBaslangic, fazla_baslangic = @fazlaBaslangic,
    aciklama = @aciklama, aktif = @aktif
WHERE id = @id", parametre);

            return Ok(new { basarili = true, id = girdi.Id });
        }

        /* Aynı pozisyon ve şube için kayıt varsa yenisi açılmaz, mevcut
           olan güncellenir. Aksi hâlde mükerrer satırlar birikir ve
           raporlarda toplam yanlış çıkar. */
        var eskiId = db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM KRY_KADRO
WHERE bolum = @bolum AND ISNULL(sube_kodu, '') = ISNULL(@subeKodu, '')
ORDER BY id",
            new { bolum = girdi.Bolum?.Trim(), subeKodu = girdi.SubeKodu });

        if (eskiId is not null)
        {
            db.Execute(@"
UPDATE KRY_KADRO
SET sube_adi = @subeAdi, norm = @norm, hedef = @hedef,
    engelli = @engelli, eksik_baslangic = @eksikBaslangic,
    fazla_baslangic = @fazlaBaslangic, aciklama = @aciklama, aktif = @aktif
WHERE id = @id", new
            {
                id = eskiId,
                subeAdi = girdi.SubeAdi,
                norm = parametre.norm,
                hedef = parametre.hedef,
                engelli = parametre.engelli,
                eksikBaslangic = parametre.eksikBaslangic,
                fazlaBaslangic = parametre.fazlaBaslangic,
                aciklama = girdi.Aciklama,
                aktif = girdi.Aktif
            });

            return Ok(new { basarili = true, id = eskiId.Value, guncellendi = true });
        }

        var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_KADRO
    (bolum, sube_kodu, sube_adi, norm, mevcut, hedef, engelli,
     eksik_baslangic, fazla_baslangic, aciklama, aktif)
OUTPUT INSERTED.id
VALUES (@bolum, @subeKodu, @subeAdi, @norm, @mevcut, @hedef, @engelli,
        @eksikBaslangic, @fazlaBaslangic, @aciklama, @aktif)", parametre);

        return Ok(new { basarili = true, id = yeniId });
    }

    /// <summary>
    /// Bir birim için tüm pozisyonların norm sayılarını topluca kaydeder.
    /// "Mevcut" artık buradan girilmez, Personeller sayfasından otomatik
    /// senkronlanır. Norm sıfırsa (ve mevcut/engelli de sıfırsa) kayıt
    /// silinir.
    /// </summary>
    [HttpPost("KadroToplu")]
    [Authorize]
    public IActionResult KadroToplu([FromBody] List<Kadro> girdiler)
    {
        /* Norm kadroya yalnızca sistem yöneticisi (1 numaralı kullanıcı)
           ve İK Yöneticisi dokunabilir. Norm, işe alım bütçesinin
           kendisidir; yetkinin dar tutulması gerekir. */
        if (!SistemYoneticisi && Rol != Roller.IKYoneticisi)
            return StatusCode(403, new
            {
                hata = "Norm kadro düzenleme yetkiniz yok.",
                ayrinti = "Bu işlem sistem yöneticisi ve İK Yöneticisi ile sınırlıdır."
            });

        if (girdiler is null || girdiler.Count == 0)
            return BadRequest(new { hata = "Kaydedilecek satır yok." });

        using var db = _vt.Baglanti();

        /* Sistem yöneticisi dışındaki değişiklikler UYGULANMAZ, onaya
           gönderilir. Önceki davranış tersineydi: değişiklik hemen
           uygulanıp reddedilirse geri alınıyordu. Bu, onay verilmeden
           norm kadronun değişmiş olması demekti; onaylayan kişi karar
           verene kadar rapor ve ihtiyaç hesapları yeni değerlere göre
           çalışıyordu. */
        if (!SistemYoneticisi)
        {
            var beklemedekiler = new List<object>();
            var ozet = new List<string>();

            foreach (var g in girdiler)
            {
                if (string.IsNullOrWhiteSpace(g.Bolum)) continue;

                var subeKodu = string.IsNullOrWhiteSpace(g.SubeKodu)
                    ? null : g.SubeKodu.Trim();

                /* Aynı pozisyon için birden fazla kayıt olabiliyor; rapor ve
                   panel toplamı gösteriyor. Önceden sırasız TOP 1 alınıyor,
                   panelde görünenden farklı bir kaydın normuyla
                   karşılaştırılıp değişmeyen pozisyon "değişti" sayılıyordu. */
                var mevcutNorm = db.ExecuteScalar<decimal?>(@"
SELECT SUM(ISNULL(norm, 0)) FROM KRY_KADRO
WHERE LTRIM(RTRIM(bolum)) = @bolum AND ISNULL(sube_kodu, '') = ISNULL(@subeKodu, '')",
                    new { bolum = g.Bolum.Trim(), subeKodu }) ?? 0;

                var yeniNorm = Math.Max(0m, g.Norm);

                if (mevcutNorm == yeniNorm) continue;

                beklemedekiler.Add(new
                {
                    bolum = g.Bolum.Trim(),
                    subeKodu,
                    subeAdi = g.SubeAdi,
                    eskiNorm = mevcutNorm,
                    yeniNorm,
                    aciklama = g.Aciklama
                });

                ozet.Add($"{g.Bolum}: {mevcutNorm:0.#} → {yeniNorm:0.#}");
            }

            if (beklemedekiler.Count == 0)
                return Ok(new { basarili = true, degisiklikYok = true });

            var birimAdi = girdiler.FirstOrDefault()?.SubeAdi ?? "Tüm Birimler";

            var onayId = _onay.Olustur(
                OnayTuru.NormKadro,
                $"{birimAdi} · norm kadro değişikliği",
                $"NORM KADRO onayınıza sunuldu · {birimAdi} · "
                    + string.Join(" · ", ozet.Take(6))
                    + (ozet.Count > 6 ? $" · +{ozet.Count - 6} değişiklik daha" : ""),
                new { degisiklikler = beklemedekiler },
                Kullanici,
                subeKodu: girdiler.FirstOrDefault()?.SubeKodu,
                subeAdi: birimAdi);

            return Ok(new
            {
                basarili = true,
                onayaGonderildi = beklemedekiler.Count,
                onayId,
                mesaj = "Değişiklikler onaya gönderildi. Onaylanana kadar "
                        + "norm kadro güncellenmez."
            });
        }

        var eklenen = 0;
        var guncellenen = 0;
        var silinen = 0;

        /* Reddedilirse geri dönebilmek için eski değerler saklanır */
        var eskiDegerler = new List<object>();
        var degisiklikOzeti = new List<string>();

        foreach (var girdi in girdiler)
        {
            if (string.IsNullOrWhiteSpace(girdi.Bolum)) continue;

            var norm = Math.Max(0m, girdi.Norm);

            /* Engelli de otomatik hesaplanır; gelen değer yoksayılır ve
               veritabanındaki son senkron değeri korunur. */
            var engelli = 0m;

            var subeKodu = string.IsNullOrWhiteSpace(girdi.SubeKodu)
                ? null
                : girdi.SubeKodu.Trim();

            /* Aynı pozisyon ve şube için birden fazla satır oluşmuş olabilir.
               Bu durumda yalnızca birini güncellemek yetmez; rapor hepsini
               topladığı için değişiklik ekrana yansımaz. En eski kayıt
               güncellenir, fazlalıklar silinir. */
            var mevcutIdler = db.Query<int>(@"
SELECT id FROM KRY_KADRO
WHERE bolum = @bolum AND ISNULL(sube_kodu, '') = ISNULL(@subeKodu, '')
ORDER BY id",
                new { bolum = girdi.Bolum.Trim(), subeKodu }).ToList();

            int? mevcutId = mevcutIdler.Count > 0 ? mevcutIdler[0] : null;

            /* 'Mevcut' artık elle girilmez; Personeller sayfasından otomatik
               senkronlanır (bkz. MikrodanMevcutGuncelle). Buradan gelen
               girdi.Mevcut yoksayılır — DB'deki son senkron değeri korunur;
               yeni satır için 0'dan başlar, bir sonraki ekran açılışında
               zaten doğru sayıya güncellenir. */
            var mevcut = 0m;

            /* Değişiklik öncesi değerler not edilir */
            if (mevcutIdler.Count > 0)
            {
                var onceki = db.QuerySingleOrDefault(@"
SELECT id, bolum, sube_adi, norm, mevcut, engelli
FROM KRY_KADRO WHERE id = @id", new { id = mevcutIdler[0] });

                if (onceki is not null)
                {
                    mevcut = (decimal)onceki.mevcut;
                    engelli = (decimal)onceki.engelli;
                    var eskiNorm = (decimal)onceki.norm;

                    eskiDegerler.Add(new
                    {
                        id = (int)onceki.id,
                        norm = eskiNorm,
                        mevcut,
                        engelli = (decimal)onceki.engelli
                    });

                    if (eskiNorm != norm)
                    {
                        degisiklikOzeti.Add(
                            $"{onceki.bolum}: norm {eskiNorm:0.#} → {norm:0.#}");

                        /* Geriye dönük raporlarda o tarihteki norm kullanılsın
                           diye değişiklik tarihiyle saklanır. */
                        db.Execute(@"
INSERT INTO KRY_KADRO_GECMIS
    (sube_kodu, sube_adi, bolum, eski_norm, yeni_norm,
     eski_mevcut, yeni_mevcut, gecerli_tarih, kullanici)
VALUES (@subeKodu, @subeAdi, @bolum, @eskiNorm, @yeniNorm,
        @eskiMevcut, @yeniMevcut, CAST(SYSDATETIME() AS DATE), @kullanici)",
                            new
                            {
                                subeKodu,
                                subeAdi = (string)onceki.sube_adi,
                                bolum = (string)onceki.bolum,
                                eskiNorm,
                                yeniNorm = norm,
                                eskiMevcut = mevcut,
                                yeniMevcut = mevcut
                            , kullanici = Kullanici
                            });
                    }
                }
            }

            var hedef = Math.Max(0m, norm - mevcut);

            if (mevcutIdler.Count > 1)
            {
                db.Execute("DELETE FROM KRY_KADRO WHERE id IN @idler",
                    new { idler = mevcutIdler.Skip(1).ToArray() });

                silinen += mevcutIdler.Count - 1;
            }

            /* Tamamen boş satırlar kaydedilmez, varsa silinir */
            if (norm == 0 && mevcut == 0 && engelli == 0)
            {
                if (mevcutId is not null)
                {
                    db.Execute("DELETE FROM KRY_KADRO WHERE id = @id", new { id = mevcutId });
                    silinen++;
                }
                continue;
            }

            if (mevcutId is null)
            {
                db.Execute(@"
INSERT INTO KRY_KADRO
    (bolum, sube_kodu, sube_adi, norm, mevcut, hedef, engelli,
     eksik_baslangic, fazla_baslangic, aciklama, aktif)
VALUES (@bolum, @subeKodu, @subeAdi, @norm, @mevcut, @hedef, @engelli,
        @eksikBaslangic, @fazlaBaslangic, @aciklama, 1)",
                    new
                    {
                        bolum = girdi.Bolum.Trim(),
                        subeKodu,
                        subeAdi = girdi.SubeAdi,
                        norm,
                        mevcut,
                        hedef,
                        engelli,
                        eksikBaslangic = hedef > 0 ? DateTime.Now : (DateTime?)null,
                        fazlaBaslangic = mevcut > norm ? DateTime.Now : (DateTime?)null,
                        aciklama = girdi.Aciklama
                    });

                eklenen++;
            }
            else
            {
                db.Execute(@"
UPDATE KRY_KADRO
SET sube_adi = @subeAdi, norm = @norm, hedef = @hedef,
    engelli = @engelli, aciklama = @aciklama, aktif = 1,
    eksik_baslangic = CASE
        WHEN @hedef = 0 THEN NULL
        WHEN eksik_baslangic IS NULL THEN SYSDATETIME()
        ELSE eksik_baslangic END,
    fazla_baslangic = CASE
        WHEN @mevcut <= @norm THEN NULL
        WHEN fazla_baslangic IS NULL THEN SYSDATETIME()
        ELSE fazla_baslangic END
WHERE id = @id",
                    new
                    {
                        id = mevcutId,
                        subeAdi = girdi.SubeAdi,
                        norm,
                        mevcut,
                        hedef,
                        engelli,
                        aciklama = girdi.Aciklama
                    });

                guncellenen++;
            }
        }

        /* Norm değişiklikleri yetkili onayına gönderilir. Değişiklik hemen
           uygulanır; reddedilirse eski değerlere dönülür. */
        /* Genel müdür yardımcısı ve yönetici doğrudan uygular; İK yöneticisinin
           değişiklikleri onaya gider. */
        if (degisiklikOzeti.Count > 0 && Roller.KadroOnerme(Rol))
        {
            var birim = girdiler.FirstOrDefault()?.SubeAdi ?? "Tüm Birimler";

            _onay.Olustur(
                OnayTuru.NormKadro,
                $"{birim} · norm kadro değişikliği",
                string.Join(" · ", degisiklikOzeti.Take(6)) +
                    (degisiklikOzeti.Count > 6
                        ? $" · +{degisiklikOzeti.Count - 6} değişiklik daha"
                        : ""),
                new { eskiler = eskiDegerler },
                Kullanici,
                subeKodu: girdiler.FirstOrDefault()?.SubeKodu,
                subeAdi: birim);
        }

        return Ok(new
        {
            basarili = true,
            eklenen,
            guncellenen,
            silinen,
            onayaGonderildi = degisiklikOzeti.Count
        });
    }

    /* ====================================================================== */
    /* Şube norm raporu                                                       */
    /* ====================================================================== */

    /// <summary>
    /// Şube bazında norm kadro tablosu: norm, mevcut, fark, engelli çalışan,
    /// eksik ve fazla pozisyon listeleri.
    /// </summary>
    [HttpGet("NormRapor")]
    public IActionResult NormRapor([FromQuery] DateTime? gun = null)
    {
        /* İşe alınanlar yalnızca seçilen günü gösterir; varsayılan bugündür.
           Böylece rapor her gün o günün alımlarıyla başlar. */
        var seciliGun = gun?.Date ?? DateTime.Today;
        var ayar = _ayar.FormOku();

        /* İş grubu eşleştirmeleri personel ayarlarında: Mikro'daki birim
           adını şube tanımına bağlamak için gerekiyor. */
        var personelAyari = _ayar.PersonelOku();

        using var db = _vt.Baglanti();

        /* Ekran her açıldığında 'mevcut' sayıları Mikro'daki gerçek aktif
           personel sayısına göre güncellenir. Mikro'ya ulaşılamazsa ya da
           bir satır güvenle eşleştirilemezse dokunulmaz. */
        var mikroSenkron = MikrodanMevcutGuncelle(db);

        var kadrolar = db.Query<Kadro>(@"
SELECT id AS Id, bolum AS Bolum, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       ISNULL(norm, 0) AS Norm, ISNULL(mevcut, 0) AS Mevcut,
       ISNULL(engelli, 0) AS Engelli, hedef AS Hedef, aciklama AS Aciklama,
       CASE WHEN eksik_baslangic IS NULL THEN 0
            ELSE DATEDIFF(day, eksik_baslangic, SYSDATETIME()) END AS EksikGun,
       CASE WHEN fazla_baslangic IS NULL THEN 0
            ELSE DATEDIFF(day, fazla_baslangic, SYSDATETIME()) END AS FazlaGun,
       CASE WHEN ISNULL(mevcut, 0) > ISNULL(norm, 0)
            THEN ISNULL(mevcut, 0) - ISNULL(norm, 0) ELSE 0 END AS Fazla
FROM KRY_KADRO
WHERE aktif = 1").ToList();

        /* Havuzdaki ve evrak aşamasındaki adaylar her zaman görünür.
           İşe alınanlar ise yalnızca seçilen güne aittir. */
        var adaylar = db.Query<BasvuruOzet>(@"
SELECT id AS Id, ad_soyad AS AdSoyad, sube_kodu AS SubeKodu, durum AS Durum,
       ise_giris_bolum AS IseGirisBolum, bolumler AS Bolumler
FROM KRY_BASVURULAR
WHERE durum IN (N'Olumlu', N'Evrak Hazırlanıyor')
   OR (durum = N'İşe Alındı'
       AND CAST(ise_giris_tarihi AS DATE) = @gun)",
            new { gun = seciliGun }).ToList();

        /* Rotasyon sayıları: birim değişikliği yapılan başvurular */
        var rotasyonlar = db.Query<BasvuruOzet>(@"
SELECT DISTINCT b.id AS Id, b.sube_kodu AS SubeKodu
FROM KRY_BASVURULAR b
JOIN KRY_BASVURU_HAREKET h ON h.basvuru_id = b.id
WHERE h.aciklama LIKE N'Birim değişikliği%'").ToList();

        var subeler = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .ToList();

        /* Ayarlarda 'Norm raporunda gizle' işaretli birimler rapordan
           tamamen çıkarılır: satırları görünmez, toplamlara katılmaz.
           Kadro kayıtları ve personel sayımı yerinde durur. */
        var gizliSubeler = subeler.Where(x => x.NormRaporundaGizle).ToList();

        var gizliKodlar = gizliSubeler
            .Select(x => x.Kod)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (gizliKodlar.Count > 0)
        {
            subeler = subeler.Where(x => !x.NormRaporundaGizle).ToList();

            kadrolar = kadrolar
                .Where(k => !gizliKodlar.Contains(k.SubeKodu ?? ""))
                .ToList();
        }

        /* Bölge seçimi veya şube yetkisi varsa liste daraltılır.
           Kadro kayıtları da süzülüyor: yalnızca şube listesini daraltmak
           yetmiyordu, aşağıdaki "tanımsız kodu geri ekle" mantığı süzülen
           şubeleri kadro kayıtlarından yeniden üretiyordu. */
        if (SubeSuzmesi)
        {
            var izinli = YetkiliKodlar();

            subeler = subeler.Where(x => izinli.Contains(x.Kod)).ToList();

            kadrolar = kadrolar
                .Where(k => izinli.Contains(k.SubeKodu ?? ""))
                .ToList();
        }

        /* Ayarlarda tanımlı olmayan bir birim koduyla kadro girilmişse
           veri kaybolmasın diye o kod da listeye eklenir. */
        var tanimsizKodlar = kadrolar
            .Select(k => k.SubeKodu)
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .Where(k => !subeler.Any(x =>
                string.Equals(x.Kod, k, StringComparison.OrdinalIgnoreCase)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var kod in tanimsizKodlar)
        {
            var ad = kadrolar.First(k =>
                string.Equals(k.SubeKodu, kod, StringComparison.OrdinalIgnoreCase)).SubeAdi;

            subeler.Add(new Sube
            {
                Kod = kod,
                Ad = string.IsNullOrWhiteSpace(ad) ? kod : ad,
                Tur = "Tanımsız"
            });
        }

        subeler = subeler.OrderBy(x => x.Ad).ToList();

        /* Çıkış tarihi ileri bir güne yazılmış personel. Mevcut sayısına
           dahil olmaya devam ediyorlar — çıkış gününe kadar çalışıyorlar —
           ama şubenin kaç kişiyi kaybedeceği ayrıca görünmeli: norm tutuyor
           görünen bir şube iki hafta sonra üç kişi eksik kalabiliyordu. */
        var ayrilacaklar = _ayrilacak.Listele();

        /* Gizli birimlerdeki personel bu listeden de çıkarılıyor. Merkez
           büro ve depo gibi birimler norm raporunda hiç görünmesin diye
           işaretleniyor; aynı raporun bir köşesinde çıkmaları tutarsız
           olurdu. Bu kişiler Personeller ekranında ve kendi kartlarında
           yine "ayrılacak" olarak görünüyor. */
        if (gizliSubeler.Count > 0)
            ayrilacaklar = ayrilacaklar
                .Where(a => !gizliSubeler.Any(g =>
                    PersonelKaynagiServisi.SubeUyuyor(personelAyari, a.Birim, g.Ad, g.Kod)))
                .ToList();

        /* Rapor gününde raporlu olan çalışanlar (şube gözüne). Mevcuttan
           düşülmüyor: engelli sütunu gibi bilgi amaçlı. */
        var raporlular = RaporluDagilimi(db, seciliGun);

        var rapor = new List<SubeNormRaporu>();
        var sira = 1;

        foreach (var sube in subeler)
        {
            /* Personeldeki birim Mikro'daki iş grubu adı; şube tanımıyla
               sistemin geri kalanının kullandığı eşleştirmeden bağlanıyor. */
            var subeAyrilacaklari = ayrilacaklar
                .Where(a => PersonelKaynagiServisi.SubeUyuyor(
                    personelAyari, a.Birim, sube.Ad, sube.Kod))
                .ToList();

            var kendi = kadrolar
                .Where(k => string.Equals(k.SubeKodu, sube.Kod, StringComparison.OrdinalIgnoreCase))
                .ToList();

            var subeAdaylari = adaylar
                .Where(a => string.Equals(a.SubeKodu, sube.Kod, StringComparison.OrdinalIgnoreCase))
                .ToList();

            var satir = new SubeNormRaporu
            {
                Sira = sira++,
                SubeKodu = sube.Kod,
                SubeAdi = sube.Ad,
                BirimTuru = sube.Tur ?? "Şube",
                Bolge = BolgeBul(sube.Kod, ayar),
                Norm = kendi.Sum(x => x.Norm),
                Mevcut = kendi.Sum(x => x.Mevcut),
                EngelliCalisan = kendi.Sum(x => x.Engelli),
                Ayrilacak = subeAyrilacaklari.Count,
                Ayrilacaklar = subeAyrilacaklari
                    .Select(a => $"{a.AdSoyad} · {a.Pozisyon} · {a.CikisTarihi:dd.MM.yyyy}")
                    .ToList()
            };

            var subeRaporlulari = raporlular
                .Where(r => string.Equals(r.SubeKodu, sube.Kod, StringComparison.OrdinalIgnoreCase))
                .OrderBy(r => r.Bitis)
                .ToList();

            satir.Raporlu = subeRaporlulari.Count;
            satir.Raporlular = subeRaporlulari.Select(r => r.Metin).ToList();

            satir.Fark = satir.Mevcut - satir.Norm;

            /* Norm girilmemiş pozisyonlarda eksik/fazla ölçülmez: ölçüt
               yoktur. Aksi hâlde senkronun kendiliğinden açtığı norm=0
               satırlarındaki herkes "fazla", boş olanlar "eksik" sayılıp
               gerçekte olmayan rakamlar çıkıyordu. */
            /* Eksik, fazla ile aynı farktan türetilir; veritabanındaki
               "hedef" kolonu son senkronda yazılmış olabileceği için
               kullanılmaz. Norm 0 ise bu koşul zaten sağlanmaz. */
            satir.Eksikler = kendi
                .Where(x => x.Norm > x.Mevcut)
                .OrderByDescending(x => x.EksikGun)
                .Select(x => new KadroSatiri
                {
                    Bolum = x.Bolum,
                    Adet = x.Norm - x.Mevcut,
                    Gun = x.EksikGun,
                    Aciklama = x.Aciklama
                })
                .ToList();

            /* Normu GİRİLMEMİŞ bir pozisyonda çalışan varsa o da fazladır:
               kadro tanımlanmamış bir yerde personel duruyor demektir.
               Bunları elemek, şube satırındaki "Fark" ile bu listeyi
               çelişkiye düşürüyordu — fark +0,5 gösterip liste boş kalıyordu. */
            satir.Fazlalar = kendi
                .Where(x => x.Fazla > 0)
                .OrderByDescending(x => x.FazlaGun)
                .Select(x => new KadroSatiri
                {
                    Bolum = x.Bolum,
                    Adet = x.Fazla,
                    Gun = x.FazlaGun,
                    Aciklama = x.Aciklama
                })
                .ToList();

            /* Gün süzgeci SORGUDA yapılıyor (ise_giris_tarihi = @gun);
               burada yalnızca durum bakılır. Tarihi C# tarafında yeniden
               süzmek işe yaramaz: sorgu IseGirisTarihi sütununu seçmediği
               için alan boş gelir ve herkes elenir. */
            satir.IseAlinanlar = subeAdaylari
                .Where(a => a.Durum == Durumlar.IseAlindi)
                .Select(a => string.IsNullOrWhiteSpace(a.IseGirisBolum)
                    ? a.AdSoyad
                    : $"{a.IseGirisBolum} · {a.AdSoyad}")
                .ToList();

            satir.EvrakTamamlayanlar = subeAdaylari
                .Where(a => a.Durum == Durumlar.EvrakHazirlaniyor)
                .Select(a => string.IsNullOrWhiteSpace(a.Bolumler)
                    ? a.AdSoyad
                    : $"{a.Bolumler.Split(',')[0].Trim()} · {a.AdSoyad}")
                .ToList();

            satir.Rotasyon = rotasyonlar.Count(r =>
                string.Equals(r.SubeKodu, sube.Kod, StringComparison.OrdinalIgnoreCase));

            satir.HavuzdakiAday = subeAdaylari.Count(a => a.Durum == Durumlar.Olumlu);

            rapor.Add(satir);
        }

        /* Belirli bir birime bağlı olmayan ('Tüm Birimler') kadrolar */
        var genel = kadrolar.Where(k => string.IsNullOrWhiteSpace(k.SubeKodu)).ToList();

        if (genel.Count > 0)
        {
            rapor.Add(new SubeNormRaporu
            {
                Sira = sira,
                SubeKodu = "",
                SubeAdi = "Tüm Birimler (genel)",
                BirimTuru = "Genel",
                Bolge = "",
                Norm = genel.Sum(x => x.Norm),
                Mevcut = genel.Sum(x => x.Mevcut),
                Fark = genel.Sum(x => x.Mevcut) - genel.Sum(x => x.Norm),
                EngelliCalisan = genel.Sum(x => x.Engelli),
                Eksikler = genel
                    .Where(x => x.Norm > x.Mevcut)
                    .Select(x => new KadroSatiri
                    {
                        Bolum = x.Bolum,
                        Adet = x.Norm - x.Mevcut,
                        Gun = x.EksikGun,
                        Aciklama = x.Aciklama
                    })
                    .ToList(),
                Fazlalar = genel
                    .Where(x => x.Fazla > 0)
                    .Select(x => new KadroSatiri
                    {
                        Bolum = x.Bolum,
                        Adet = x.Fazla,
                        Gun = x.FazlaGun,
                        Aciklama = x.Aciklama
                    })
                    .ToList()
            });
        }

        return Ok(new
        {
            toplamNorm = rapor.Sum(x => x.Norm),
            toplamMevcut = rapor.Sum(x => x.Mevcut),
            toplamFark = rapor.Sum(x => x.Fark),
            toplamEngelli = rapor.Sum(x => x.EngelliCalisan),
            /* Rapor gününde raporlu çalışan (kişi); mevcuda dahil */
            toplamRaporlu = rapor.Sum(x => x.Raporlu),
            /* Kartlar, ekrandaki 'Eksik Personel' ve 'Fazla Personel'
               sütunlarında görünen rozetlerin toplamıdır. Şube net farkı
               kullanılırsa bir şubedeki fazla, aynı şubedeki eksiği
               götürüyor ve kartlar sütunlarla tutmuyordu. */
            toplamEksik = rapor.Sum(x => x.Eksikler.Sum(e => e.Adet)),
            toplamFazla = rapor.Sum(x => x.Fazlalar.Sum(e => e.Adet)),
            toplamAlinan = rapor.Sum(x => x.IseAlinanlar.Count),
            /// Hangi güne ait alımların gösterildiği
            gun = seciliGun,
            toplamEvrak = rapor.Sum(x => x.EvrakTamamlayanlar.Count),
            toplamRotasyon = rapor.Sum(x => x.Rotasyon),
            toplamHavuz = rapor.Sum(x => x.HavuzdakiAday),

            /* Ayrılacaklar iki ayrı sayı olarak veriliyor.

               Satırlardan toplanan sayı yalnızca raporda görünen şubeleri
               kapsıyor; merkez büro ve depo gibi "norm raporunda gizle"
               işaretli birimler ile hiçbir şubeye eşleşmeyen birimler
               dışarıda kalıyor. Oysa çıkışı planlanmış bir personelin
               hiçbir yerde görünmemesi, İK'nın onu tamamen kaçırması
               demek. Kart bu yüzden tam listeyi sayıyor. */
            toplamAyrilacak = ayrilacaklar.Count,

            ayrilacakListesi = ayrilacaklar.Select(a => new
            {
                a.PersonelKodu,
                a.AdSoyad,
                a.Birim,
                a.Pozisyon,
                a.CikisTarihi,
                a.KalanGun
            }),

            satirlar = rapor,
            mikroSenkron = mikroSenkron
        });
    }

    /* ====================================================================== */
    /* Mikro'dan otomatik 'mevcut' senkronu                                  */
    /* ====================================================================== */

    /// <summary>
    /// Norm kadro ekranı her açıldığında çağrılır. Personeller sayfasıyla
    /// birebir aynı kaynağı (PersonelKaynagiServisi) kullanarak şube ve
    /// pozisyon bazında aktif personel sayısını sayıp KRY_KADRO.mevcut
    /// alanına yazar. Eşleştirme, Ayarlar → Personel Eşleştirmeleri
    /// altındaki elle tanımlı eşleşmeleri önceliklendirir, yoksa ad
    /// benzerliğine bakar — Personeller sayfasındaki "Birim" uç noktasıyla
    /// aynı mantık.
    ///
    /// Personel listesine ulaşılamazsa ya da bir satır güvenle
    /// eşleştirilemezse o satıra dokunulmaz; ekrandaki değer olduğu gibi
    /// kalır. "Norm" hiç değiştirilmez, yalnızca "mevcut" ve ona bağlı
    /// "hedef"/eksik-fazla başlangıç tarihleri güncellenir. Şubesiz
    /// ("Tüm Birimler") satırların Mikro tarafında karşılığı olmadığı
    /// için onlara hiç dokunulmaz.
    /// </summary>
    private MikroSenkronSonucu MikrodanMevcutGuncelle(IDbConnection db)
    {
        var sonuc = new MikroSenkronSonucu();

        List<PersonelKaydi> tumu;

        try
        {
            /* Kaynak, Personeller sayfasının kullandığı kaynakla birebir
               aynı: PersonelKaynagiServisi. Norm kadrodaki "mevcut", o
               sayfadaki Şube ve Ünvan sütunlarından hesaplanır. */
            tumu = AktifPersonel();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Norm kadro: personel listesi alınamadı");
            sonuc.Hata = "Personel listesine ulaşılamadı; sayılar son bilinen hâliyle gösteriliyor.";
            return sonuc;
        }

        var personelAyar = _ayar.PersonelOku();

        var kadrolar = db.Query<Kadro>(@"
SELECT id AS Id, bolum AS Bolum, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       ISNULL(norm, 0) AS Norm, ISNULL(mevcut, 0) AS Mevcut,
       ISNULL(engelli, 0) AS Engelli
FROM KRY_KADRO
WHERE aktif = 1 AND sube_kodu IS NOT NULL AND sube_kodu <> ''").ToList();

        /* ------------------------------------------------------------------
           Yön: PERSONEL → KADRO.

           Her personelin kendi şubesi ve ünvanı esas alınır; o kişi hangi
           kadro satırına düşüyorsa oraya sayılır. (Önceki sürüm tersini
           yapıyor, kadro satırından yola çıkıp personel arıyordu; eşleşme
           tutmayınca kişiler hiç sayılmıyordu.)

           Eşleştirme, adları sadeleştirip birebir karşılaştırmaya dayanır:
           "Avcılar-1 Şubesi" ile "AVCILAR-1", "Merter Şubesi Şubesi" ile
           "MERTER" aynı anahtara iner. Bu, önceki bulanık benzerlik
           mantığındaki belirsizlikleri tamamen ortadan kaldırır.
           ------------------------------------------------------------------ */

        /* Personelin iş grubundan kadro şube koduna (raporlu dağılımı da
           aynı çözücüyü kullanıyor; bkz. SubeKoduCozucu). */
        var SubeKoduBul = SubeKoduCozucu(kadrolar, personelAyar);

        /* Elle tanımlı ünvan eşleştirmeleri: kaynağı hedef bölüm adına
           çevirir. Çalışma biçimi ekini de gözetir — bkz. UnvanKarsiligi. */
        string BolumAdiBul(string unvan) =>
            PersonelKaynagiServisi.UnvanKarsiligi(personelAyar, unvan);

        /* ---- Her personel, kendi şube + bölüm gözüne sayılır ----
           Yarı zamanlı (Part time / Vekil gibi) çalışanlar norm kadroda
           yarım kadro sayılır: 1 değil 0,5. Kadro alanları ondalıklı
           olduğu için (24,5 gibi) bu doğrudan yazılabilir. */
        var sayimlar = new Dictionary<(string Kod, string Bolum, bool Part), decimal>();
        var engelliler = new Dictionary<(string Kod, string Bolum, bool Part), decimal>();
        /* Yerleşemeyenler kişileriyle birlikte tutulur: yalnızca sayı
           yazmak, hangi personelin sayım dışında kaldığını bulmayı
           imkânsız kılıyordu. */
        var yerlesemeyen = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var kisi in tumu)
        {
            var subeKodu = SubeKoduBul(kisi.IsGrubu);

            if (subeKodu is null)
            {
                var etiket = $"{kisi.IsGrubu} (şube norm kadroda tanımlı değil)";

                var kim = $"{kisi.Ad} {kisi.Soyad}".Trim();

                if (!string.IsNullOrWhiteSpace(kisi.PersonelKodu))
                    kim += $" ({kisi.PersonelKodu.Trim()})";

                if (!string.IsNullOrWhiteSpace(kisi.Pozisyon))
                    kim += $" · {kisi.Pozisyon.Trim()}";

                if (!yerlesemeyen.TryGetValue(etiket, out var liste))
                    yerlesemeyen[etiket] = liste = new List<string>();

                liste.Add(kim.Length > 0 ? kim : "adı okunamayan personel");
                continue;
            }

            var bolumAdi = PersonelKaynagiServisi.MeslekAnahtari(BolumAdiBul(kisi.Pozisyon));

            var partMi = PersonelKaynagiServisi.CalismaBicimiIceriyor(kisi.Pozisyon);

            /* Bir kişinin kaç kadro saydığı sırasıyla şuradan belirlenir:

               1) ENGELLİ kadro (per_kim_sakat_derece > 0) ise her zaman
                  0,5. Bu kural pozisyondan bağımsızdır ve elle tanımlanan
                  ağırlığı da geçersiz kılar: engellilik kişiye bağlıdır,
                  pozisyona değil.
               2) Pozisyon için Ayarlar → Kadro Ağırlıkları'nda elle
                  tanımlanmış bir değer varsa o.
               3) Ünvanında Part/Yarım eki varsa 0,5.
               4) Aksi hâlde 1. */
            var hedefBolum = BolumAdiBul(kisi.Pozisyon);

            var tanimliAgirlik = (personelAyar?.Agirliklar ?? new List<KadroAgirligi>())
                .FirstOrDefault(a => string.Equals(
                    PersonelKaynagiServisi.MeslekAnahtari(a.Bolum),
                    PersonelKaynagiServisi.MeslekAnahtari(hedefBolum),
                    StringComparison.OrdinalIgnoreCase)
                    && PersonelKaynagiServisi.CalismaBicimiIceriyor(a.Bolum) == partMi);

            var katki =
                kisi.Engelli ? 0.5m :
                tanimliAgirlik is not null ? tanimliAgirlik.Agirlik :
                partMi ? 0.5m : 1m;

            var anahtar = (subeKodu, bolumAdi, partMi);
            sayimlar[anahtar] = sayimlar.GetValueOrDefault(anahtar) + katki;

            /* Engelli sütunu da otomatik dolar; aynı ağırlıkla sayılır. */
            if (kisi.Engelli)
                engelliler[anahtar] = engelliler.GetValueOrDefault(anahtar) + katki;
        }

        /* ---- Sayımlar kadro satırlarına yazılır ----
           Aynı sadeleştirilmiş bölüm adına birden fazla kadro satırı denk
           gelebilir ("Kasiyer" ve "Part time Kasiyer" ikisi de KASIYER'e
           iner). Ünvan artık per_kim_meslek'ten okunduğu için kimin yarı
           zamanlı olduğu bellidir: tam zamanlılar eksiz satıra, yarı
           zamanlılar "Part time" satırına yazılır. Karşılığı olan satır
           yoksa sayı eksiz satırda toplanır (yarım kadro değeriyle). */
        foreach (var kadroGrubu in kadrolar.GroupBy(k =>
            (Kod: k.SubeKodu, Bolum: PersonelKaynagiServisi.MeslekAnahtari(k.Bolum))))
        {
            var tamSatir = kadroGrubu.FirstOrDefault(
                k => !PersonelKaynagiServisi.CalismaBicimiIceriyor(k.Bolum));

            var partSatir = kadroGrubu.FirstOrDefault(
                k => PersonelKaynagiServisi.CalismaBicimiIceriyor(k.Bolum));

            var tamSayi = sayimlar.GetValueOrDefault(
                (kadroGrubu.Key.Kod, kadroGrubu.Key.Bolum, false));

            var partSayi = sayimlar.GetValueOrDefault(
                (kadroGrubu.Key.Kod, kadroGrubu.Key.Bolum, true));

            var tamEngelli = engelliler.GetValueOrDefault(
                (kadroGrubu.Key.Kod, kadroGrubu.Key.Bolum, false));

            var partEngelli = engelliler.GetValueOrDefault(
                (kadroGrubu.Key.Kod, kadroGrubu.Key.Bolum, true));

            /* Ayrı bir part satırı yoksa yarı zamanlılar da eksiz satıra
               eklenir; 0,5 katkıları korunur. */
            if (partSatir is null)
            {
                tamSayi += partSayi;
                partSayi = 0m;
                tamEngelli += partEngelli;
                partEngelli = 0m;
            }
            else if (tamSatir is null)
            {
                partSayi += tamSayi;
                tamSayi = 0m;
                partEngelli += tamEngelli;
                tamEngelli = 0m;
            }

            foreach (var kadro in kadroGrubu)
            {
                var yeniMevcut =
                    ReferenceEquals(kadro, tamSatir) ? tamSayi :
                    ReferenceEquals(kadro, partSatir) ? partSayi : 0m;

                var yeniEngelli =
                    ReferenceEquals(kadro, tamSatir) ? tamEngelli :
                    ReferenceEquals(kadro, partSatir) ? partEngelli : 0m;

                if (yeniMevcut == kadro.Mevcut && yeniEngelli == kadro.Engelli)
                    continue;

                var yeniHedef = Math.Max(0m, kadro.Norm - yeniMevcut);

                db.Execute(@"
UPDATE KRY_KADRO
SET mevcut = @mevcut, hedef = @hedef, engelli = @engelli,
    eksik_baslangic = CASE
        WHEN @hedef = 0 THEN NULL
        WHEN eksik_baslangic IS NULL THEN SYSDATETIME()
        ELSE eksik_baslangic END,
    fazla_baslangic = CASE
        WHEN @mevcut <= norm THEN NULL
        WHEN fazla_baslangic IS NULL THEN SYSDATETIME()
        ELSE fazla_baslangic END
WHERE id = @id",
                    new
                    {
                        id = kadro.Id,
                        mevcut = yeniMevcut,
                        hedef = yeniHedef,
                        engelli = yeniEngelli
                    });

                sonuc.Guncellenen++;
            }
        }

        /* ---- Kadroda yeri olmayan bölümler otomatik açılır ----
           Personel listesinde bir şubede bir ünvanda çalışan varsa ama
           norm kadroda o bölüm satırı yoksa, satır norm=0 ile kendiliğinden
           oluşturulur. Böylece hiç kimse sayım dışında kalmaz ve yeni açılan
           bir şubede pozisyonları elle tek tek eklemek gerekmez; norm
           sayısını sonradan Kadro Planı'ndan girersiniz. */
        var kadrodaOlmayanBolumler = sayimlar
            .Where(x => x.Value > 0 && !kadrolar.Any(k =>
                string.Equals(k.SubeKodu, x.Key.Kod, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(PersonelKaynagiServisi.MeslekAnahtari(k.Bolum), x.Key.Bolum,
                    StringComparison.OrdinalIgnoreCase) &&
                PersonelKaynagiServisi.CalismaBicimiIceriyor(k.Bolum) == x.Key.Part))
            .ToList();

        foreach (var eksik in kadrodaOlmayanBolumler)
        {
            /* Bölüm adı için personelin kendi ünvanı kullanılır; anahtar
               sadeleştirilmiş hâli olduğu için okunabilir aslını buluruz.
               Yarı zamanlı gözü için, ünvanında çalışma biçimi eki olan
               bir personelin ünvanı seçilir ki satır "Part time ..." adıyla
               açılsın. */
            var okunurBolum = tumu
                .Where(p => PersonelKaynagiServisi.MeslekAnahtari(BolumAdiBul(p.Pozisyon))
                                == eksik.Key.Bolum
                         && PersonelKaynagiServisi.CalismaBicimiIceriyor(p.Pozisyon)
                                == eksik.Key.Part)
                .Select(p => BolumAdiBul(p.Pozisyon))
                .FirstOrDefault() ?? eksik.Key.Bolum;

            var subeAdi = kadrolar
                .FirstOrDefault(k => string.Equals(
                    k.SubeKodu, eksik.Key.Kod, StringComparison.OrdinalIgnoreCase))?.SubeAdi;

            db.Execute(@"
INSERT INTO KRY_KADRO
    (bolum, sube_kodu, sube_adi, norm, mevcut, hedef, engelli,
     fazla_baslangic, aktif)
VALUES (@bolum, @subeKodu, @subeAdi, 0, @mevcut, 0, 0, SYSDATETIME(), 1)",
                new
                {
                    bolum = okunurBolum,
                    subeKodu = eksik.Key.Kod,
                    subeAdi,
                    mevcut = eksik.Value
                });

            sonuc.Eklenen++;
        }

        foreach (var eksik in yerlesemeyen)
        {
            /* Uzun listeler uyarıyı okunmaz hâle getirdiği için ilk on
               kişi yazılır, kalanı sayıyla belirtilir. */
            var kisiler = string.Join(", ", eksik.Value.Take(10));

            if (eksik.Value.Count > 10)
                kisiler += $" ve {eksik.Value.Count - 10} kişi daha";

            sonuc.Eslesemeyen.Add(
                $"{eksik.Key} — {eksik.Value.Count} kişi sayılamadı: {kisiler}. " +
                "Personel Eşleştirmeleri'nden İş Grubu → Birim eşleştirmesi ekleyin.");
        }

        /* Sayilan: kadroya yerleştirilebilen KİŞİ sayısı (kadro değeri değil —
           yarı zamanlılar kadroda 0,5 sayılır ama burada 1 kişidir). */
        sonuc.Sayilan = tumu.Count - yerlesemeyen.Sum(x => x.Value.Count);
        sonuc.ToplamAktif = tumu.Count;

        return sonuc;
    }



    /// <summary>
    /// Personelin iş grubunu kadro şube koduna çeviren işlev.
    ///
    /// <para>
    /// Kadro şubeleri: sadeleştirilmiş ad → şube kodu. Şube kodu da ayrıca
    /// anahtar olarak eklenir; elle yapılan eşleştirmelerde hedef, şube
    /// kodu olarak kaydedilir. Elle tanımlı iş grubu eşleştirmeleri
    /// kaynağı hedefe çevirir; hedef şube kodu ya da adı olabilir.
    /// </para>
    ///
    /// <para>
    /// Mevcut senkronu ile raporlu dağılımı aynı eşleştirmeyi kullansın diye
    /// ayrı: ikisi farklılaşırsa raporlu kişi "mevcut"unda sayılmadığı bir
    /// şubede görünürdü.
    /// </para>
    /// </summary>
    /* internal (03.10.2026): patron görünümü personeli şubelere bu
       eşleştirmeyle dağıtıyor; şube satırındaki okutma sayısı ile norm
       kadronun "mevcut"u aynı kişileri saysın. */
    internal static Func<string, string> SubeKoduCozucu(
        IEnumerable<Kadro> kadrolar, PersonelAyarlari personelAyar)
    {
        var subeAnahtari = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var k in kadrolar)
        {
            var ad = PersonelKaynagiServisi.BirimAnahtari(k.SubeAdi);

            if (!string.IsNullOrWhiteSpace(ad))
                subeAnahtari[ad] = k.SubeKodu;

            if (!string.IsNullOrWhiteSpace(k.SubeKodu))
                subeAnahtari[k.SubeKodu] = k.SubeKodu;
        }

        return isGrubu =>
        {
            var esleme = (personelAyar?.IsGrubuEslemeleri ?? new List<AdEslemesi>())
                .FirstOrDefault(e => string.Equals(
                    PersonelKaynagiServisi.BirimAnahtari(e.Kaynak),
                    PersonelKaynagiServisi.BirimAnahtari(isGrubu),
                    StringComparison.OrdinalIgnoreCase));

            if (esleme is not null)
            {
                if (subeAnahtari.TryGetValue(esleme.Hedef ?? "", out var kodDogrudan))
                    return kodDogrudan;

                if (subeAnahtari.TryGetValue(
                        PersonelKaynagiServisi.BirimAnahtari(esleme.Hedef), out var kodAd))
                    return kodAd;
            }

            return subeAnahtari.TryGetValue(
                PersonelKaynagiServisi.BirimAnahtari(isGrubu), out var kod) ? kod : null;
        };
    }

    /* ====================================================================== */
    /* Raporlu personel (03.10.2026)                                          */
    /* ====================================================================== */

    /// <summary>İstek boyunca bir kez okunan aktif personel (Mikro)</summary>
    private List<PersonelKaydi> _aktifPersonel;

    /// <summary>
    /// Aktif personel; aynı istekte mevcut senkronu, raporlu dağılımı ve
    /// part-time sayımı Mikro'yu ayrı ayrı sorgulamasın.
    /// </summary>
    private List<PersonelKaydi> AktifPersonel() =>
        _aktifPersonel ??= _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1)
            .ToList();

    /// <summary>Raporlu bir çalışanın kadrodaki yeri</summary>
    private sealed record RaporluKisi(
        string SubeKodu, string BolumAnahtari, bool Part, string AdSoyad, string Pozisyon, DateTime Bitis)
    {
        /// <summary>"Ad Soyad · Ünvan · 12.10.2026" (Ayrılacaklar ile aynı biçim)</summary>
        public string Metin => $"{AdSoyad} · {Pozisyon} · {Bitis:dd.MM.yyyy}";
    }

    /// <summary>
    /// Verilen günde raporlu olan çalışanların şube ve pozisyon gözü.
    ///
    /// <para>
    /// Kişi, "mevcut" sayımındaki (MikrodanMevcutGuncelle) eşleştirmeyle
    /// aynı şubeye ve bölüme yerleştiriliyor. Raporlu personel mevcuttan
    /// düşülmüyor; bu yalnızca bilgi (engelli sütunu gibi). Sayı KİŞİ
    /// sayısıdır, kadro ağırlığı değil. Okunamazsa boş liste.
    /// </para>
    /// </summary>
    private List<RaporluKisi> RaporluDagilimi(IDbConnection db, DateTime gun)
    {
        var sonuc = new List<RaporluKisi>();

        try
        {
            var raporlu = new RaporluServisi(_vt).Bugun(gun);

            if (raporlu.Count == 0) return sonuc;

            var kisiler = AktifPersonel()
                .Where(x => raporlu.ContainsKey(RaporluServisi.Anahtar(x.PersonelKodu)))
                .ToList();

            if (kisiler.Count == 0) return sonuc;

            var personelAyar = _ayar.PersonelOku();

            var kadrolar = db.Query<Kadro>(@"
SELECT bolum AS Bolum, sube_kodu AS SubeKodu, sube_adi AS SubeAdi
FROM KRY_KADRO
WHERE aktif = 1 AND sube_kodu IS NOT NULL AND sube_kodu <> ''").ToList();

            var subeKoduBul = SubeKoduCozucu(kadrolar, personelAyar);

            foreach (var kisi in kisiler)
            {
                var subeKodu = subeKoduBul(kisi.IsGrubu);

                if (subeKodu is null) continue;

                var durum = raporlu[RaporluServisi.Anahtar(kisi.PersonelKodu)];

                sonuc.Add(new RaporluKisi(
                    subeKodu,
                    PersonelKaynagiServisi.MeslekAnahtari(
                        PersonelKaynagiServisi.UnvanKarsiligi(personelAyar, kisi.Pozisyon)),
                    PersonelKaynagiServisi.CalismaBicimiIceriyor(kisi.Pozisyon),
                    $"{kisi.Ad} {kisi.Soyad}".Trim(),
                    (kisi.Pozisyon ?? "").Trim(),
                    durum.Bitis));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Norm kadro: raporlu personel okunamadı");
        }

        return sonuc;
    }

    /// <summary>
    /// Raporlu kişileri kadro satırlarına (şube × pozisyon) dağıtır; mevcut
    /// senkronundaki tam/yarı zamanlı satır kuralıyla aynı: ayrı "Part
    /// time" satırı yoksa yarı zamanlılar eksiz satıra, eksiz satır yoksa
    /// tam zamanlılar part satırına yazılır.
    /// </summary>
    private static void RaporlulariDagit(IEnumerable<Kadro> kadrolar, List<RaporluKisi> raporlular)
    {
        if (raporlular.Count == 0) return;

        foreach (var grup in kadrolar
                     .Where(k => k.Aktif && !string.IsNullOrWhiteSpace(k.SubeKodu))
                     .GroupBy(k => (Kod: k.SubeKodu.ToUpperInvariant(),
                                    Bolum: PersonelKaynagiServisi.MeslekAnahtari(k.Bolum))))
        {
            var tamSatir = grup.FirstOrDefault(k => !PersonelKaynagiServisi.CalismaBicimiIceriyor(k.Bolum));
            var partSatir = grup.FirstOrDefault(k => PersonelKaynagiServisi.CalismaBicimiIceriyor(k.Bolum));

            foreach (var r in raporlular.Where(x =>
                         string.Equals(x.SubeKodu, grup.Key.Kod, StringComparison.OrdinalIgnoreCase) &&
                         string.Equals(x.BolumAnahtari, grup.Key.Bolum, StringComparison.OrdinalIgnoreCase)))
            {
                var hedef = r.Part ? partSatir ?? tamSatir : tamSatir ?? partSatir;

                if (hedef is null) continue;

                hedef.Raporlu++;
                hedef.Raporlular.Add(r.Metin);
            }
        }
    }

    /// <summary>
    /// Bölge ve birim türü bazında norm kadro özeti ile günlük bilgilendirme
    /// mesajı için gereken dökümler.
    /// </summary>
    [HttpGet("BolgeRapor")]
    public IActionResult BolgeRapor([FromQuery] DateTime? gun = null)
    {
        var ayar = _ayar.FormOku();
        var raporGunu = gun?.Date ?? DateTime.Today;

        using var db = _vt.Baglanti();

        var kadrolar = db.Query<Kadro>(@"
SELECT bolum AS Bolum, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       ISNULL(norm, 0) AS Norm, ISNULL(mevcut, 0) AS Mevcut,
       ISNULL(engelli, 0) AS Engelli, hedef AS Hedef, aciklama AS Aciklama,
       CASE WHEN ISNULL(mevcut, 0) > ISNULL(norm, 0)
            THEN ISNULL(mevcut, 0) - ISNULL(norm, 0) ELSE 0 END AS Fazla
FROM KRY_KADRO
WHERE aktif = 1").ToList();

        /* Norm raporunda gizlenen birimler bölge toplamlarına da girmez. */
        var gizliKodlar = (ayar.Subeler ?? new List<Sube>())
            .Where(x => x.NormRaporundaGizle && !string.IsNullOrWhiteSpace(x.Kod))
            .Select(x => x.Kod)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (gizliKodlar.Count > 0)
        {
            kadrolar = kadrolar
                .Where(k => !gizliKodlar.Contains(k.SubeKodu ?? ""))
                .ToList();
        }

        /* Bölge seçimi varsa yalnızca o bölgelerin kadroları değerlendirilir */
        if (SubeSuzmesi)
        {
            var izinli = YetkiliKodlar();

            kadrolar = kadrolar
                .Where(k => string.IsNullOrWhiteSpace(k.SubeKodu) ||
                            izinli.Contains(k.SubeKodu))
                .ToList();
        }

        /* Bölge sorumluları: kullanıcı kayıtlarındaki bölge alanından */
        var sorumlular = db.Query<Kullanici>(@"
SELECT ad_soyad AS AdSoyad, ISNULL(bolge, '') AS Bolge, rol AS Rol
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND bolge IS NOT NULL AND LTRIM(RTRIM(bolge)) <> ''").ToList();

        var subeler = ayar.Subeler ?? new List<Sube>();

        string TurBul(string subeKodu) =>
            subeler.FirstOrDefault(x =>
                string.Equals(x.Kod, subeKodu, StringComparison.OrdinalIgnoreCase))?.Tur
            ?? "Şube";

        string SubeAdiBul(string subeKodu) =>
            subeler.FirstOrDefault(x =>
                string.Equals(x.Kod, subeKodu, StringComparison.OrdinalIgnoreCase))?.Ad
            ?? subeKodu;

        /* Raporlu çalışanlar: yalnızca bu raporda görünen (gizli olmayan,
           yetki ve bölge süzgecinden geçen) birimlerdekiler sayılır. */
        var gorunenKodlar = kadrolar
            .Select(k => k.SubeKodu)
            .Where(k => !string.IsNullOrWhiteSpace(k))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var raporlular = RaporluDagilimi(db, raporGunu)
            .Where(r => gorunenKodlar.Contains(r.SubeKodu))
            .ToList();

        /* ------------------------------------------------ birim türü satırları */

        var turSatirlari = kadrolar
            .Where(k => !string.IsNullOrWhiteSpace(k.SubeKodu))
            .GroupBy(k => TurBul(k.SubeKodu))
            .Select(g => new BolgeNormSatiri
            {
                Ad = g.Key,
                Tur = "tur",
                Norm = g.Sum(x => x.Norm),
                Mevcut = g.Sum(x => x.Mevcut),
                Eksik = g.Sum(x => x.Hedef),
                Fazla = g.Sum(x => x.Fazla),
                Engelli = g.Sum(x => x.Engelli),
                Raporlu = raporlular.Count(r => TurBul(r.SubeKodu) == g.Key),
                BirimSayisi = g.Select(x => x.SubeKodu)
                    .Distinct(StringComparer.OrdinalIgnoreCase).Count()
            })
            .OrderByDescending(x => x.Norm)
            .ToList();

        /* ----------------------------------------------------- bölge satırları */

        var bolgeSatirlari = new List<BolgeNormSatiri>();

        foreach (var bolge in ayar.Bolgeler ?? new List<BolgeTanimi>())
        {
            if (string.IsNullOrWhiteSpace(bolge.Ad)) continue;

            var kodlar = bolge.Subeler ?? new List<string>();

            var kendi = kadrolar
                .Where(k => kodlar.Any(x =>
                    string.Equals(x, k.SubeKodu, StringComparison.OrdinalIgnoreCase)))
                .ToList();

            bolgeSatirlari.Add(new BolgeNormSatiri
            {
                Ad = bolge.Ad,
                Tur = "bolge",
                Sorumlular = sorumlular
                    .Where(u => (u.Bolge ?? "")
                        .Split(',', StringSplitOptions.RemoveEmptyEntries)
                        .Any(b => string.Equals(b.Trim(), bolge.Ad,
                            StringComparison.OrdinalIgnoreCase)))
                    .Select(u => u.AdSoyad)
                    .Distinct()
                    .ToList(),
                Norm = kendi.Sum(x => x.Norm),
                Mevcut = kendi.Sum(x => x.Mevcut),
                Eksik = kendi.Sum(x => x.Hedef),
                Fazla = kendi.Sum(x => x.Fazla),
                Engelli = kendi.Sum(x => x.Engelli),
                Raporlu = raporlular.Count(r => kodlar.Any(x =>
                    string.Equals(x, r.SubeKodu, StringComparison.OrdinalIgnoreCase))),
                BirimSayisi = kodlar.Count
            });
        }

        /* ------------------------------------------- fazla personel dökümü */

        var fazlaDetay = kadrolar
            .Where(k => k.Fazla > 0 && !string.IsNullOrWhiteSpace(k.SubeKodu))
            .GroupBy(k => SubeAdiBul(k.SubeKodu))
            .Select(g => new FazlaDetay
            {
                Sube = g.Key,
                Pozisyonlar = string.Join(" + ", g.Select(x =>
                    string.IsNullOrWhiteSpace(x.Aciklama)
                        ? x.Bolum
                        : x.Aciklama))
            })
            .OrderBy(x => x.Sube)
            .ToList();

        /* Yarı zamanlı ve engelli personel, doğrudan personel listesinden
           KİŞİ olarak sayılır.

           Önceki hesap kadro satırının bölüm adında "part" arıyordu ve
           mevcut değerini topluyordu. İki hatası vardı: part-time bilgisi
           artık personelin kendi ünvanında (per_kim_meslek) tutuluyor,
           kadro adında olması şart değil; ve "mevcut" yarımlanmış kadro
           değeridir, kişi sayısı değil. İki part-time kişi mevcutta 1
           görünür, mesajda ise "1 part time çalışan" yazardı. */
        var partTime = 0;

        try
        {
            var aktifler = AktifPersonel();

            partTime = aktifler.Count(x =>
                PersonelKaynagiServisi.CalismaBicimiIceriyor(x.Pozisyon) || x.Engelli);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Part time personel sayılamadı");
        }

        return Ok(new
        {
            turSatirlari,
            bolgeSatirlari,
            fazlaDetay,
            toplam = new
            {
                norm = kadrolar.Sum(x => x.Norm),
                mevcut = kadrolar.Sum(x => x.Mevcut),
                /* Eksik, 'hedef' kolonundan değil norm ile mevcut farkından
                   hesaplanır: hedef son senkronda yazılmış bir değerdir ve
                   norm elle değiştirildiğinde güncellenmemiş kalabiliyor.
                   Diğer üç ekran bu farkı kullanıyor; günlük mesajdaki
                   "27 eksik" ile karttaki 19,5 arasındaki fark buydu. */
                eksik = kadrolar.Sum(x => Math.Max(0, x.Norm - x.Mevcut)),
                fazla = kadrolar.Sum(x => Math.Max(0, x.Mevcut - x.Norm)),
                engelli = kadrolar.Sum(x => x.Engelli),
                /* Bugün raporlu çalışan (kişi); mevcuda dahil */
                raporlu = raporlular.Count,
                partTime,
                birimSayisi = kadrolar
                    .Select(x => x.SubeKodu)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count()
            }
        });
    }

    [HttpDelete("Kadro/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult KadroSil(int id)
    {
        using var db = _vt.Baglanti();
        db.Execute("DELETE FROM KRY_KADRO WHERE id = @id", new { id });
        return Ok(new { basarili = true });
    }

    /* ====================================================================== */
    /* Havuz                                                                  */
    /* ====================================================================== */

    [HttpGet]
    public IActionResult Havuz([FromQuery] int gun = 90)
    {
        var ayar = _ayar.FormOku();

        using var db = _vt.Baglanti();

        /* Havuz ihtiyaçları Norm Kadro'dan bağımsızdır; kendi tablosunda tutulur */
        var ihtiyaclar = db.Query<HavuzIhtiyac>(@"
SELECT id AS Id, bolge AS Bolge, bolum AS Bolum,
       ihtiyac AS Ihtiyac, aciklama AS Aciklama
FROM KRY_HAVUZ_IHTIYAC
ORDER BY bolum, bolge").ToList();

        var adaylar = db.Query<HavuzAdayi>(@"
SELECT id AS Id, basvuru_no AS BasvuruNo, ad_soyad AS AdSoyad, telefon AS Telefon,
       eposta AS Eposta, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       bolumler AS Bolumler, ilce AS Ilce, mahalle AS Mahalle,
       gorusme_tarihi AS GorusmeTarihi, olusturma AS Olusturma,
       kimlik_no AS KimlikNo,
       /* Engel bayrağı kayıt girişinde yazılır; eski kayıtlar arka planda
          tamamlanır. veri_json burada okunmaz: fotoğrafın base64'ünü
          taşıdığı için her satırda taranması havuzu dakikalara ve zaman
          aşımına götürüyordu. */
       ISNULL(engel_var, 0) AS EngelVar
FROM KRY_BASVURULAR
WHERE durum = @durum
  /* Havuzdan çıkarılanlar listede görünmez; durumları Olumlu kalır ki
     geçmiş bozulmasın, ama doluluk oranını şişirmezler. */
  AND havuz_cikis_tarih IS NULL
  AND (@subeSiniri = 0 OR sube_kodu IN @yetkiliSubeler)
ORDER BY olusturma DESC",
            new
            {
                durum = Durumlar.Olumlu,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        /* Eski çalışan işareti: kimlik numaraları Mikro'da ayrılmış
           personelle eşleştirilir. Havuzdan alım yapan uzman bu kişinin
           daha önce çalışıp ayrıldığını görmeli. Kimlik numarası yanıta
           konmaz, yalnızca eşleştirme için kullanılır. */
        try
        {
            var kimlikler = adaylar
                .Select(x => new string((x.KimlikNo ?? "").Where(char.IsDigit).ToArray()))
                .Where(x => x.Length == 11)
                .Distinct()
                .ToList();

            if (kimlikler.Count > 0)
            {
                using var pdb = _vt.PersonelBaglantisi();

                var ayrilanlar = pdb.Query<string>(@"
SELECT DISTINCT LTRIM(RTRIM(Per_TcKimlikNo))
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER
WHERE LTRIM(RTRIM(Per_TcKimlikNo)) IN @kimlikler
  AND per_cikis_tar IS NOT NULL AND YEAR(per_cikis_tar) > 1950",
                    new { kimlikler }, commandTimeout: 30)
                    .ToHashSet(StringComparer.Ordinal);

                foreach (var a in adaylar)
                {
                    var k = new string((a.KimlikNo ?? "").Where(char.IsDigit).ToArray());

                    a.EskiCalisan = k.Length == 11 && ayrilanlar.Contains(k);
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Eski çalışan eşleştirmesi yapılamadı");
        }

        /* Kimlik numarası panele gönderilmez; yalnızca eşleştirme içindi. */
        foreach (var a in adaylar) a.KimlikNo = null;

        /* Havuzdan işe alınanlar: bekleyen aday sayısının yanında,
           o pozisyona kaç kişi alındığı da gösterilir. */
        var iseAlinanlar = db.Query<HavuzAdayi>(@"
SELECT id AS Id, ad_soyad AS AdSoyad, sube_kodu AS SubeKodu,
       bolumler AS Bolumler,
       ISNULL(NULLIF(ise_giris_bolum, N''), bolumler) AS IseGirisBolum,
       ise_giris_tarihi AS Olusturma
FROM KRY_BASVURULAR
WHERE durum = @durum
  AND ise_giris_tarihi IS NOT NULL
  AND ise_giris_tarihi >= @bas
  AND (@subeSiniri = 0 OR sube_kodu IN @yetkiliSubeler)",
            new
            {
                durum = Durumlar.IseAlindi,
                /* Alım penceresi çağrıdan gelir; varsayılan 90 gün */
                bas = DateTime.Today.AddDays(-Math.Clamp(gun, 7, 730)),
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        /* Notlar tek sorguda alınıp adaylara dağıtılır */
        if (adaylar.Count > 0)
        {
            var idler = adaylar.Select(x => x.Id).ToArray();

            var notlar = db.Query<BasvuruNotu>(@"
SELECT id AS Id, basvuru_id AS BasvuruId, metin AS Metin,
       kullanici AS Kullanici, ad_soyad AS AdSoyad, tarih AS Tarih
FROM KRY_BASVURU_NOT
WHERE basvuru_id IN @idler
ORDER BY id DESC", new { idler }).ToList();

            foreach (var aday in adaylar)
                aday.Notlar = notlar.Where(n => n.BasvuruId == aday.Id).ToList();
        }

        /* Havuz yalnızca kendi bölge tanımlarını kullanır.
           Şirketin yönetsel bölgeleri (Form Ayarları) buraya karışmaz. */
        var havuzAyar = _ayar.HavuzOku();
        var bolgeler = havuzAyar.Bolgeler ?? new List<BolgeTanimi>();

        /* Havuz bölge merkezli sunulur: her bölgenin altında pozisyonlar
           listelenir. Hedef, o pozisyonda havuzda beklemesi istenen aday
           sayısıdır; işe alım hedefi değildir. */
        var bolgeKartlari = new List<HavuzBolgeKarti>();
        var eslesenler = new HashSet<int>();

        foreach (var bolgeGrubu in ihtiyaclar.GroupBy(x => x.Bolge,
                     StringComparer.OrdinalIgnoreCase))
        {
            var tanim = bolgeler.FirstOrDefault(b =>
                string.Equals(b.Ad, bolgeGrubu.Key, StringComparison.OrdinalIgnoreCase));

            var subeKodlari = tanim?.Subeler ?? new List<string>();

            var subeAdlari = subeKodlari
                .Select(k => (ayar.Subeler ?? new List<Sube>())
                    .FirstOrDefault(x => string.Equals(x.Kod, k,
                        StringComparison.OrdinalIgnoreCase))?.Ad ?? k)
                .ToList();

            var kart = new HavuzBolgeKarti
            {
                Bolge = bolgeGrubu.Key,
                Subeler = subeAdlari
            };

            foreach (var satir in bolgeGrubu.OrderByDescending(x => x.Ihtiyac)
                         .ThenBy(x => x.Bolum))
            {
                var uyanlar = adaylar
                    .Where(a => BolumIceriyorMu(a.Bolumler, satir.Bolum))
                    .Where(a => subeKodlari.Any(k => string.Equals(k, a.SubeKodu,
                        StringComparison.OrdinalIgnoreCase)))
                    .ToList();

                foreach (var a in uyanlar) eslesenler.Add(a.Id);

                /* Bu bölge ve pozisyondan işe alınanlar ayrıca sayılır */
                var alinan = iseAlinanlar.Count(a =>
                    BolumIceriyorMu(
                        string.IsNullOrWhiteSpace(a.IseGirisBolum) ? a.Bolumler : a.IseGirisBolum,
                        satir.Bolum) &&
                    subeKodlari.Any(k => string.Equals(k, a.SubeKodu,
                        StringComparison.OrdinalIgnoreCase)));

                kart.Pozisyonlar.Add(new HavuzPozisyonSatiri
                {
                    Bolum = satir.Bolum,
                    Hedef = satir.Ihtiyac,
                    Adaylar = uyanlar,
                    IseAlinan = alinan
                });
            }

            kart.ToplamHedef = kart.Pozisyonlar.Sum(x => x.Hedef);
            kart.ToplamAday = kart.Pozisyonlar
                .SelectMany(x => x.Adaylar)
                .Select(x => x.Id)
                .Distinct()
                .Count();

            kart.IseAlinan = kart.Pozisyonlar.Sum(x => x.IseAlinan);

            bolgeKartlari.Add(kart);
        }

        /* Hedefi tanımlanmamış pozisyonlar.
           Aday olumlu değerlendirilmiş ama o pozisyon için havuz hedefi
           girilmemişse kayıp gitmesin diye bölge kartına eklenir; hedefi
           sıfır olur ve "hedef tanımsız" olarak işaretlenir. */
        foreach (var bolge in bolgeler)
        {
            var subeKodlari = bolge.Subeler ?? new List<string>();

            var bolgeAdaylari = adaylar
                .Where(a => !eslesenler.Contains(a.Id))
                .Where(a => subeKodlari.Any(k => string.Equals(k, a.SubeKodu,
                    StringComparison.OrdinalIgnoreCase)))
                .ToList();

            if (bolgeAdaylari.Count == 0) continue;

            /* Adayların seçtiği pozisyonlar ayrıştırılır */
            var pozisyonlar = bolgeAdaylari
                .SelectMany(a => (a.Bolumler ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(x => x.Trim())
                    .Where(x => x.Length > 0))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (pozisyonlar.Count == 0) continue;

            var kart = bolgeKartlari.FirstOrDefault(x =>
                string.Equals(x.Bolge, bolge.Ad, StringComparison.OrdinalIgnoreCase));

            if (kart is null)
            {
                kart = new HavuzBolgeKarti
                {
                    Bolge = bolge.Ad,
                    Subeler = subeKodlari
                        .Select(k => (ayar.Subeler ?? new List<Sube>())
                            .FirstOrDefault(x => string.Equals(x.Kod, k,
                                StringComparison.OrdinalIgnoreCase))?.Ad ?? k)
                        .ToList()
                };

                bolgeKartlari.Add(kart);
            }

            foreach (var pozisyon in pozisyonlar)
            {
                /* Bu pozisyon zaten tanımlıysa atlanır */
                if (kart.Pozisyonlar.Any(p =>
                        string.Equals(p.Bolum, pozisyon, StringComparison.OrdinalIgnoreCase)))
                    continue;

                var uyanlar = bolgeAdaylari
                    .Where(a => BolumIceriyorMu(a.Bolumler, pozisyon))
                    .ToList();

                if (uyanlar.Count == 0) continue;

                foreach (var a in uyanlar) eslesenler.Add(a.Id);

                kart.Pozisyonlar.Add(new HavuzPozisyonSatiri
                {
                    Bolum = pozisyon,
                    Hedef = 0,
                    HedefTanimsiz = true,
                    Adaylar = uyanlar,
                    IseAlinan = 0
                });
            }

            kart.ToplamAday = kart.Pozisyonlar
                .SelectMany(x => x.Adaylar)
                .Select(x => x.Id)
                .Distinct()
                .Count();
        }

        bolgeKartlari = bolgeKartlari
            .OrderByDescending(x => x.ToplamHedef)
            .ThenBy(x => x.Bolge)
            .ToList();

        var digerleri = adaylar.Where(a => !eslesenler.Contains(a.Id)).ToList();

        return Ok(new
        {
            toplamOlumlu = adaylar.Count,
            toplamHedef = ihtiyaclar.Sum(x => x.Ihtiyac),
            /// Havuz bölgesi tanımlı değilse arayüzde yönlendirme gösterilir
            bolgeTanimiVar = bolgeler.Count > 0,
            toplamIseAlinan = bolgeKartlari.Sum(x => x.IseAlinan),
            bolgeler = bolgeKartlari,
            digerleri
        });
    }

    /* ====================================================================== */
    /* Havuz ihtiyaç tanımları                                                */
    /* ====================================================================== */

    /// <summary>Havuza özel bölge tanımlarını döndürür.</summary>
    /// <summary>
    /// Açık pozisyonlar için öneri üretir.
    ///
    /// <para>
    /// İki kaynak taranır. Birincisi aday havuzu: o pozisyona başvurmuş ve
    /// hâlâ havuzda olan adaylar. İkincisi rotasyon: AYNI BÖLGEDE başka bir
    /// mağazada aynı pozisyonda fazla personel varsa, işe alım yapmadan
    /// kaydırma önerilir.
    /// </para>
    ///
    /// <para>
    /// Öneri karar değil, hatırlatmadır: uzmanın her açık pozisyon için
    /// havuzu ve komşu mağazaları elle taraması gerekmesin diye.
    /// </para>
    /// </summary>
    [HttpGet("Oneriler")]
    [Authorize]
    public IActionResult Oneriler()
    {
        using var db = _vt.Baglanti();

        var kadrolar = db.Query(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, bolum,
       ISNULL(norm, 0) AS norm, ISNULL(mevcut, 0) AS mevcut
FROM KRY_KADRO
WHERE aktif = 1").ToList();

        var eksikler = kadrolar
            .Where(x => Convert.ToDecimal(x.mevcut) < Convert.ToDecimal(x.norm))
            .ToList();

        if (eksikler.Count == 0)
            return Ok(new { oneriler = new List<object>() });

        /* Fazlası olan kadrolar: rotasyon önerisinin kaynağı */
        var fazlalar = kadrolar
            .Where(x => Convert.ToDecimal(x.mevcut) > Convert.ToDecimal(x.norm))
            .ToList();

        var ayar = _ayar.FormOku();
        var bolgeler = ayar.Bolgeler ?? new List<BolgeTanimi>();
        var gruplar = ayar.OneriGruplari ?? new List<OneriGrubu>();

        string BolgeBul(string subeKodu) =>
            bolgeler.FirstOrDefault(b => (b.Subeler ?? new List<string>())
                .Any(x => string.Equals(x?.Trim(), (subeKodu ?? "").Trim(),
                                        StringComparison.OrdinalIgnoreCase)))?.Ad;

        /* Öneri kapsamı yalnızca öneri grubu (13.10.2026).

           Bölge yönetsel bir yapı, öneri ise ulaşım meselesi. Önceden grup
           tanımlı değilse bölgeye düşülüyordu ve adaylar kapsama bakılmadan
           seçildiği için başka bölgeden öneri geliyordu. Artık yalnızca aynı
           mağaza ve aynı öneri grubundaki mağazalar önerilir; gruba
           alınmamış mağaza yalnızca kendi adaylarını görür. */
        string KapsamBul(string subeKodu)
        {
            var grup = gruplar.FirstOrDefault(g => (g.Subeler ?? new List<string>())
                .Any(x => string.Equals(x?.Trim(), (subeKodu ?? "").Trim(),
                                        StringComparison.OrdinalIgnoreCase)));

            return grup is not null ? "G:" + grup.Ad : null;
        }

        bool AyniKapsam(string a, string b)
        {
            var ka = KapsamBul(a);
            return ka is not null && ka == KapsamBul(b);
        }

        /* Havuzdaki adaylar: olumlu işaretli ve havuzdan çıkarılmamış */
        var adaylar = db.Query(@"
SELECT id, ad_soyad AS adSoyad, telefon, sube_kodu AS subeKodu,
       sube_adi AS subeAdi, bolumler, ilce, olusturma
FROM KRY_BASVURULAR
WHERE durum = @durum AND havuz_cikis_tarih IS NULL",
            new { durum = Durumlar.Olumlu }).ToList();

        var oneriler = eksikler.Select(e =>
        {
            var subeKodu = (string)e.subeKodu ?? "";
            var bolum = ((string)e.bolum ?? "").Trim();
            var bolge = BolgeBul(subeKodu);
            var kapsam = KapsamBul(subeKodu);

            var acik = Convert.ToDecimal(e.norm) - Convert.ToDecimal(e.mevcut);

            /* Aday eşleşmesi: başvurudaki bölümler alanı çoklu olabildiği
               için içerik araması yapılır. Aynı şubeye başvuranlar önce,
               sonra aynı öneri grubundakiler; başkası önerilmez. */
            var uygunAdaylar = adaylar
                .Where(a => ((string)a.bolumler ?? "")
                    .Contains(bolum, StringComparison.OrdinalIgnoreCase))
                .Select(a => new
                {
                    a.id,
                    adSoyad = (string)a.adSoyad,
                    telefon = (string)a.telefon,
                    subeAdi = (string)a.subeAdi,
                    ilce = (string)a.ilce,
                    olusturma = (DateTime)a.olusturma,
                    ayniSube = string.Equals((string)a.subeKodu, subeKodu,
                                             StringComparison.OrdinalIgnoreCase),
                    ayniBolge = AyniKapsam((string)a.subeKodu, subeKodu)
                })
                /* Yalnızca aynı mağaza ya da aynı öneri grubu */
                .Where(a => a.ayniSube || a.ayniBolge)
                .OrderByDescending(a => a.ayniSube)
                .ThenByDescending(a => a.ayniBolge)
                .ThenByDescending(a => a.olusturma)
                .Take(5)
                .ToList();

            /* Rotasyon: aynı öneri grubunda, aynı pozisyonda fazlası olan mağaza */
            var rotasyon = fazlalar
                .Where(f => ((string)f.bolum ?? "").Trim()
                            .Equals(bolum, StringComparison.OrdinalIgnoreCase))
                .Where(f => !string.Equals((string)f.subeKodu, subeKodu,
                                           StringComparison.OrdinalIgnoreCase))
                .Where(f => AyniKapsam((string)f.subeKodu, subeKodu))
                .Select(f => new
                {
                    subeAdi = (string)f.subeAdi,
                    fazla = Convert.ToDecimal(f.mevcut) - Convert.ToDecimal(f.norm)
                })
                .OrderByDescending(x => x.fazla)
                .Take(3)
                .ToList();

            return new
            {
                subeKodu,
                subeAdi = (string)e.subeAdi,
                bolge,
                bolum,
                acik,
                norm = Convert.ToDecimal(e.norm),
                mevcut = Convert.ToDecimal(e.mevcut),
                adaylar = uygunAdaylar,
                rotasyon
            };
        })
        /* Önerisi olmayan açık pozisyonlar listeyi şişirmesin */
        .Where(x => x.adaylar.Count > 0 || x.rotasyon.Count > 0)
        .OrderByDescending(x => x.acik)
        .ToList();

        return Ok(new { oneriler });
    }

    [HttpGet("Bolgeler")]
    public IActionResult BolgeOku()
    {
        var havuz = _ayar.HavuzOku();
        var form = _ayar.FormOku();

        return Ok(new
        {
            bolgeler = havuz.Bolgeler ?? new List<BolgeTanimi>(),
            /// Havuza özel tanım yoksa şirket bölgeleri kullanılıyor demektir
            ozelTanimVar = havuz.Bolgeler?.Count > 0,
            sirketBolgeleri = form.Bolgeler ?? new List<BolgeTanimi>()
        });
    }

    /// <summary>Havuz bölgelerini kaydeder (yalnızca yönetici).</summary>
    [HttpPost("Bolgeler")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult BolgeKaydet([FromBody] List<BolgeTanimi> girdiler)
    {
        var temiz = (girdiler ?? new List<BolgeTanimi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Ad))
            .Select(x => new BolgeTanimi
            {
                Ad = x.Ad.Trim(),
                Subeler = (x.Subeler ?? new List<string>())
                    .Select(k => (k ?? "").Trim())
                    .Where(k => k.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList()
            })
            .ToList();

        _ayar.HavuzYaz(new HavuzAyarlari { Bolgeler = temiz });

        return Ok(new { basarili = true, adet = temiz.Count });
    }

    /// <summary>
    /// Adayı havuzdan çıkarır ve başvurulara seçilen durumla döndürür.
    ///
    /// <para>
    /// Durum değişir (Olumlu'dan seçilen duruma); aday havuz listesinden
    /// düşer ve Başvurular sayfasında "havuzdan döndü" rozetiyle görünür ki
    /// onu olumlu bulan uzman neden geri geldiğini bilsin. Not zorunlu.
    /// Yalnızca İK yöneticisi ve yönetici yapabilir.
    /// </para>
    /// </summary>
    [HttpPost("Cikar/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult HavuzdanCikar(int id, [FromBody] HavuzCikisGirdi girdi)
    {
        var not = (girdi?.Not ?? "").Trim();
        var durum = (girdi?.Durum ?? "").Trim();

        if (not.Length < 3)
            return BadRequest(new { hata = "Havuzdan çıkarma notu zorunludur." });

        /* Olumlu'ya 'dönmek' havuzda kalmak demek; İşe Alındı ise ayrı
           bir akış (İşe Al). İkisi burada seçilemez. */
        if (!Durumlar.Tumu.Contains(durum) || durum == Durumlar.Olumlu
            || durum == Durumlar.IseAlindi)
            return BadRequest(new { hata = "Döneceği durumu seçiniz." });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum,
    havuz_cikis_sebep = N'Başvurulara döndü', havuz_cikis_not = @not,
    havuz_cikis_tarih = SYSDATETIME(), havuz_cikaran = @kim,
    guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id AND durum = @olumlu AND havuz_cikis_tarih IS NULL",
            new
            {
                id,
                durum,
                not,
                kim = AdSoyad,
                kullanici = Kullanici,
                olumlu = Durumlar.Olumlu
            });

        if (etkilenen == 0)
            return NotFound(new { hata = "Aday havuzda bulunamadı." });

        /* Hareket geçmişine de yazılır: başvuru detayında zaman çizgisinde
           görünsün, uzman neden geri geldiğini oradan da okusun */
        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new
            {
                id,
                durum,
                aciklama = "Havuzdan çıkarıldı: " + not,
                kullanici = Kullanici
            });

        return Ok(new { basarili = true });
    }

    /// <summary>Adayı havuza geri alır.</summary>
    [HttpPost("GeriAl/{id:int}")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IK + "," + Roller.IKYoneticisi
                     + "," + Roller.GenelMudurYardimcisi)]
    public IActionResult HavuzaGeriAl(int id)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_BASVURULAR
SET havuz_cikis_sebep = NULL, havuz_cikis_not = NULL,
    havuz_cikis_tarih = NULL, havuz_cikaran = NULL
WHERE id = @id", new { id });

        return etkilenen == 0
            ? NotFound(new { hata = "Aday bulunamadı." })
            : Ok(new { basarili = true });
    }

    /// <summary>Havuzdan çıkarılmış adaylar; sebep dağılımıyla birlikte.</summary>
    [HttpGet("Cikanlar")]
    public IActionResult Cikanlar()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT id, basvuru_no AS basvuruNo, ad_soyad AS adSoyad, telefon,
       sube_adi AS subeAdi, bolumler,
       havuz_cikis_sebep AS sebep, havuz_cikis_not AS cikisNotu,
       havuz_cikis_tarih AS cikisTarihi, havuz_cikaran AS cikaran
FROM KRY_BASVURULAR
WHERE durum = @durum AND havuz_cikis_tarih IS NOT NULL
  AND (@subeSiniri = 0 OR sube_kodu IN @yetkiliSubeler)
ORDER BY havuz_cikis_tarih DESC",
            new
            {
                durum = Durumlar.Olumlu,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        var sebepler = liste
            .GroupBy(x => (string)x.sebep)
            .Select(g => new { sebep = g.Key, adet = g.Count() })
            .OrderByDescending(x => x.adet)
            .ToList();

        return Ok(new { liste, sebepler });
    }

    [HttpGet("Ihtiyac")]
    public IActionResult IhtiyacListe()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query<HavuzIhtiyac>(@"
SELECT id AS Id, bolge AS Bolge, bolum AS Bolum,
       ihtiyac AS Ihtiyac, aciklama AS Aciklama
FROM KRY_HAVUZ_IHTIYAC
ORDER BY bolum, bolge").ToList();

        return Ok(liste);
    }

    /// <summary>Havuz ihtiyaçlarını topluca kaydeder (yalnızca yönetici).</summary>
    /// <summary>
    /// Bir bölgenin havuz hedeflerini başka bölgelere kopyalar.
    ///
    /// Aynı pozisyon yapısı birden çok bölgede geçerli olduğunda hedefleri
    /// tek tek girmek zaman alır. Bu uç, kaynak bölgedeki tüm pozisyon
    /// hedeflerini seçilen bölgelere aktarır.
    ///
    /// <paramref name="girdi"/> içindeki <c>Uzerine</c> alanı, hedef bölgede
    /// zaten tanımlı olan pozisyonların ne olacağını belirler:
    /// true ise güncellenir, false ise dokunulmaz.
    /// </summary>
    [HttpPost("IhtiyacKopyala")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult IhtiyacKopyala([FromBody] IhtiyacKopyalaGirdi girdi)
    {
        if (girdi is null || string.IsNullOrWhiteSpace(girdi.KaynakBolge))
            return BadRequest(new { hata = "Kaynak bölge seçilmelidir." });

        var hedefler = (girdi.HedefBolgeler ?? new List<string>())
            .Select(x => x?.Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Where(x => !string.Equals(x, girdi.KaynakBolge,
                StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (hedefler.Count == 0)
            return BadRequest(new { hata = "En az bir hedef bölge seçiniz." });

        using var db = _vt.Baglanti();

        var kaynak = db.Query<HavuzIhtiyac>(@"
SELECT bolum AS Bolum, ihtiyac AS Ihtiyac, aciklama AS Aciklama
FROM KRY_HAVUZ_IHTIYAC
WHERE bolge = @bolge AND ihtiyac > 0",
            new { bolge = girdi.KaynakBolge.Trim() }).ToList();

        if (kaynak.Count == 0)
            return BadRequest(new
            {
                hata = "Kaynak bölgede tanımlı hedef bulunmuyor."
            });

        var eklenen = 0;
        var guncellenen = 0;
        var atlanan = 0;

        foreach (var bolge in hedefler)
        {
            foreach (var satir in kaynak)
            {
                var varMi = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_HAVUZ_IHTIYAC
WHERE bolge = @bolge AND bolum = @bolum",
                    new { bolge, bolum = satir.Bolum });

                if (varMi > 0)
                {
                    /* Üzerine yazma kapalıysa mevcut değer korunur */
                    if (!girdi.Uzerine)
                    {
                        atlanan++;
                        continue;
                    }

                    db.Execute(@"
UPDATE KRY_HAVUZ_IHTIYAC
SET ihtiyac = @ihtiyac, guncelleme = SYSDATETIME()
WHERE bolge = @bolge AND bolum = @bolum",
                        new
                        {
                            bolge,
                            bolum = satir.Bolum,
                            ihtiyac = satir.Ihtiyac
                        });

                    guncellenen++;
                }
                else
                {
                    db.Execute(@"
INSERT INTO KRY_HAVUZ_IHTIYAC (bolge, bolum, ihtiyac, aciklama)
VALUES (@bolge, @bolum, @ihtiyac, @aciklama)",
                        new
                        {
                            bolge,
                            bolum = satir.Bolum,
                            ihtiyac = satir.Ihtiyac,
                            aciklama = satir.Aciklama
                        });

                    eklenen++;
                }
            }
        }

        return Ok(new
        {
            basarili = true,
            eklenen,
            guncellenen,
            atlanan,
            bolgeSayisi = hedefler.Count,
            pozisyonSayisi = kaynak.Count
        });
    }

    [HttpPost("Ihtiyac")]
    [Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi
                     + "," + Roller.IKYoneticisi)]
    public IActionResult IhtiyacKaydet([FromBody] List<HavuzIhtiyac> girdiler)
    {
        girdiler ??= new List<HavuzIhtiyac>();

        using var db = _vt.Baglanti();

        // Tanımlar bütün olarak yenilenir; ekranda ne varsa o geçerlidir
        db.Execute("DELETE FROM KRY_HAVUZ_IHTIYAC");

        var eklenen = 0;

        foreach (var g in girdiler)
        {
            if (string.IsNullOrWhiteSpace(g.Bolge) || string.IsNullOrWhiteSpace(g.Bolum))
                continue;

            db.Execute(@"
INSERT INTO KRY_HAVUZ_IHTIYAC (bolge, bolum, ihtiyac, aciklama)
VALUES (@bolge, @bolum, @ihtiyac, @aciklama)",
                new
                {
                    bolge = g.Bolge.Trim(),
                    bolum = g.Bolum.Trim(),
                    ihtiyac = Math.Max(0, g.Ihtiyac),
                    aciklama = g.Aciklama
                });

            eklenen++;
        }

        return Ok(new { basarili = true, eklenen });
    }

    /* --------------------------------------------------------------- yardımcı */

    /// <summary>
    /// Adayın seçtiği bölümler arasında verilen bölüm var mı?
    /// "Kasap" ararken "Kasap Şefi" eşleşmesin diye tam parça karşılaştırılır.
    /// </summary>
    private static bool BolumIceriyorMu(string bolumler, string aranan)
    {
        if (string.IsNullOrWhiteSpace(bolumler) || string.IsNullOrWhiteSpace(aranan))
            return false;

        return bolumler
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Any(x => string.Equals(x, aranan.Trim(), StringComparison.OrdinalIgnoreCase));
    }
}

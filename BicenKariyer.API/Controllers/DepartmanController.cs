using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Genel merkez ve depo departmanları (Yönetim → Departmanlar).
///
/// <para>
/// Departmana yönetici ve personel atanır. Personelin izin / haftalık izin
/// talebinin 1. onayı departman yöneticisine gider, mobilde Ekibim yalnızca
/// departmanı gösterir. Ayrıntı: <see cref="DepartmanServisi"/>.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class DepartmanController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly DepartmanServisi _departman;
    private readonly IzinOnayKuralServisi _kural;
    private readonly EkipServisi _ekip;

    public DepartmanController(VeritabaniServisi vt, DepartmanServisi departman,
        IzinOnayKuralServisi kural, EkipServisi ekip)
    {
        _vt = vt;
        _departman = departman;
        _kural = kural;
        _ekip = ekip;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    private static string K(string s) => DepartmanServisi.K(s);

    private static object Kisi(PersonelKaydi p) => new
    {
        sicil = (p.PersonelKodu ?? "").Trim(),
        adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
        pozisyon = p.Pozisyon,
        isYeri = p.IsGrubu
    };

    /// <summary>Departmanlar, üyeleri ve atanabilecek personel (merkez + depo).</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        var harita = _departman.Oku();
        var aktif = _ekip.Aktifler();
        var kisiler = aktif.ToDictionary(x => K(x.PersonelKodu), x => x, StringComparer.OrdinalIgnoreCase);

        /* Departmanlar yalnızca genel merkez ve depo için: mağazalarda ekip
           iş yerinden geliyor. İş yerleri onay tablosundaki ŞUBE dışı
           iş yerleri. */
        var isYerleri = _kural.Kurallar()
            .Select(k => k.IsYeri)
            .Where(x => !string.Equals(x, IzinOnayKuralServisi.Sube, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var personel = aktif
            .Where(x => !string.Equals(_kural.IsYeriBul(x.IsGrubu), IzinOnayKuralServisi.Sube,
                            StringComparison.OrdinalIgnoreCase)
                        || harita.Tanimli(x.PersonelKodu))
            .OrderBy(x => x.Ad).ThenBy(x => x.Soyad)
            .Select(x =>
            {
                var k = K(x.PersonelKodu);
                return new
                {
                    sicil = (x.PersonelKodu ?? "").Trim(),
                    adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    pozisyon = x.Pozisyon,
                    isYeri = x.IsGrubu,
                    isYeriTuru = _kural.IsYeriBul(x.IsGrubu),
                    departmanId = harita.PersonelDepartmani.TryGetValue(k, out var d) ? d : (int?)null,
                    yonettigi = harita.YonettigiDepartmanlar.TryGetValue(k, out var ys)
                        ? ys.ToList() : new List<int>()
                };
            })
            .ToList();

        /* Ayrılmış personel üyelikte kalmış olabilir: sayıda gösterilir */
        List<object> Uyeler(HashSet<string> kodlar) =>
            (kodlar ?? new HashSet<string>())
                .Select(k => kisiler.TryGetValue(k, out var p)
                    ? (ad: $"{p.Ad} {p.Soyad}".Trim(), kisi: Kisi(p))
                    : (ad: $"{k} (aktif değil)",
                       kisi: (object)new { sicil = k, adSoyad = $"{k} (aktif değil)", pozisyon = (string)null, isYeri = (string)null }))
                .OrderBy(x => x.ad)
                .Select(x => x.kisi)
                .ToList();

        var departmanlar = harita.Departmanlar.Values
            .OrderBy(d => d.IsYeri).ThenBy(d => d.Sira).ThenBy(d => d.Ad)
            .Select(d => new
            {
                id = d.Id,
                ad = d.Ad,
                isYeri = d.IsYeri,
                aciklama = d.Aciklama,
                sira = d.Sira,
                yoneticiler = Uyeler(harita.Yoneticiler.GetValueOrDefault(d.Id)),
                personeller = Uyeler(harita.Personeller.GetValueOrDefault(d.Id))
            })
            .ToList();

        return Ok(new { departmanlar, isYerleri, personel });
    }

    /// <summary>Departman ekler ya da günceller; üyeler baştan yazılır.</summary>
    [HttpPost]
    public IActionResult Kaydet([FromBody] DepartmanGirdi g)
    {
        if (g is null || string.IsNullOrWhiteSpace(g.Ad))
            return BadRequest(new { hata = "Departman adı giriniz." });

        var ad = g.Ad.Trim();
        var yoneticiler = (g.Yoneticiler ?? new()).Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var personeller = (g.Personeller ?? new()).Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var ikisi = yoneticiler.Where(y => personeller.Any(p => K(p) == K(y))).ToList();

        if (ikisi.Count > 0)
            return BadRequest(new { hata = "Aynı kişi hem yönetici hem personel seçilmiş: " + string.Join(", ", ikisi) });

        using var db = _vt.Baglanti();
        db.Open();
        using var islem = db.BeginTransaction();

        var ayniAd = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_DEPARTMAN
WHERE aktif = 1 AND ad = @ad AND id <> @id", new { ad, id = g.Id ?? 0 }, islem);

        if (ayniAd > 0)
            return BadRequest(new { hata = $"\"{ad}\" adında bir departman zaten var." });

        int id;

        if (g.Id is int mevcut && mevcut > 0)
        {
            var adet = db.Execute(@"
UPDATE KRY_DEPARTMAN SET ad = @ad, is_yeri = @isYeri, aciklama = @aciklama, sira = @sira,
       guncelleyen = @kullanici, guncelleme = SYSDATETIME()
WHERE id = @id AND aktif = 1",
                new { id = mevcut, ad, isYeri = g.IsYeri, aciklama = g.Aciklama, sira = g.Sira, kullanici = Kullanici },
                islem);

            if (adet == 0) return NotFound(new { hata = "Departman bulunamadı." });

            id = mevcut;
        }
        else
        {
            id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_DEPARTMAN (ad, is_yeri, aciklama, sira, olusturan)
OUTPUT INSERTED.id
VALUES (@ad, @isYeri, @aciklama, @sira, @kullanici)",
                new { ad, isYeri = g.IsYeri, aciklama = g.Aciklama, sira = g.Sira, kullanici = Kullanici },
                islem);
        }

        db.Execute("DELETE FROM KRY_DEPARTMAN_UYE WHERE departman_id = @id", new { id }, islem);

        /* Bir kişi tek departmanda personel olabilir: başka departmanda
           personel olarak duranlar buraya taşınır. */
        var tasinan = 0;

        foreach (var p in personeller)
        {
            tasinan += db.Execute(@"
DELETE FROM KRY_DEPARTMAN_UYE
WHERE departman_id <> @id AND rol = N'personel'
  AND LTRIM(RTRIM(personel_kodu)) IN (@kod, @kodSifirsiz, @kodSifirli)",
                new { id, kod = p, kodSifirsiz = K(p), kodSifirli = "0" + K(p) }, islem);
        }

        foreach (var y in yoneticiler)
            db.Execute(@"
INSERT INTO KRY_DEPARTMAN_UYE (departman_id, personel_kodu, rol, ekleyen)
VALUES (@id, @kod, N'yonetici', @kullanici)", new { id, kod = y, kullanici = Kullanici }, islem);

        foreach (var p in personeller)
            db.Execute(@"
INSERT INTO KRY_DEPARTMAN_UYE (departman_id, personel_kodu, rol, ekleyen)
VALUES (@id, @kod, N'personel', @kullanici)", new { id, kod = p, kullanici = Kullanici }, islem);

        islem.Commit();

        DepartmanServisi.Unut();
        EkipServisi.Unut();

        return Ok(new { basarili = true, id, tasinan });
    }

    /// <summary>Departmanı kaldırır; üyeleri eski kurala (onay tablosu) döner.</summary>
    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_DEPARTMAN SET aktif = 0, guncelleyen = @kullanici, guncelleme = SYSDATETIME() WHERE id = @id;
DELETE FROM KRY_DEPARTMAN_UYE WHERE departman_id = @id;", new { id, kullanici = Kullanici });

        DepartmanServisi.Unut();
        EkipServisi.Unut();

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Bir personel için sonuç: izni kime gider, mobilde Ekibim'de kimler
    /// görünür, kimden sorumlu. Kaydettikten sonra kontrol etmek için.
    /// </summary>
    [HttpGet("Onizleme")]
    public IActionResult Onizleme([FromQuery] string sicil)
    {
        var p = _ekip.Kisi(sicil);

        if (p is null) return NotFound(new { hata = "Aktif personel bulunamadı." });

        var harita = _departman.Oku();
        var k = K(p.PersonelKodu);

        var (onaylayanlar, unvan) = _kural.Onaylayanlar(p.PersonelKodu, p.Pozisyon, p.IsGrubu);

        string Ad(int id) => harita.Departmanlar.TryGetValue(id, out var d) ? d.Ad : null;

        return Ok(new
        {
            kisi = Kisi(p),
            departman = harita.PersonelDepartmani.TryGetValue(k, out var dep) ? Ad(dep) : null,
            yonettigi = harita.YonettigiDepartmanlar.TryGetValue(k, out var ys)
                ? ys.Select(Ad).Where(x => x is not null).ToList() : new List<string>(),
            kaynak = harita.Yoneticileri(k).Count > 0 ? "departman" : "tablo",
            onayUnvan = unvan,
            onaylayanlar = onaylayanlar.Select(Kisi),
            ekip = _ekip.EkipArkadaslari(p).Select(Kisi),
            sorumlu = _ekip.SorumluOlduklari(p).Select(Kisi)
        });
    }
}

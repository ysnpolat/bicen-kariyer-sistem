using System.Data;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İzin talebi onay süreci tablosu (27.10.2026): iş yeri + pozisyon → 1.–5. onay.
///
/// <para>
/// İK'nın "İZİN TALEP ONAY SÜRECİ" Excel'i ilk açılışta buraya yüklendi
/// (<see cref="IzinZincirKurali"/>); düzenleme panelden, Excel'den toplu
/// yükleme de var. Değişiklik yeni taleplere uygulanıyor; bekleyen
/// talepler İzin › "Bekleyenleri tabloya uydur" ile taşınıyor
/// (IzinTalepController.ZincirDuzelt). Kişiye özel satır: pozisyon "SİCİL 13276".
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class IzinZincirKuralController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinZincirKurali _tablo;
    private readonly IzinOnayZinciri _zincir;
    private readonly PersonelKaynagiServisi _kaynak;

    public IzinZincirKuralController(VeritabaniServisi vt, IzinZincirKurali tablo, IzinOnayZinciri zincir, PersonelKaynagiServisi kaynak)
    {
        _vt = vt;
        _tablo = tablo;
        _zincir = zincir;
        _kaynak = kaynak;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>İK uzmanı görüntüler; değiştirme Admin, GMY, İK yöneticisi</summary>
    private bool Yazabilir => Roller.Temel(Rol) is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi;

    private string Kim => User?.FindFirst("adSoyad")?.Value is { Length: > 0 } ad ? ad : User?.Identity?.Name ?? "";

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    private void Iz(IDbConnection db, string islem)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_AYAR_DEGISIKLIK (bolum, islem, kullanici, basarili)
VALUES (N'izinakis', @islem, @kullanici, 1)",
                new { islem = islem.Length > 200 ? islem[..197] + "…" : islem, kullanici = User?.Identity?.Name ?? "" });
        }
        catch
        {
            /* iz yazılamasa da kayıt geçerli */
        }
    }

    private static string Ozet(IEnumerable<AvansOnayZinciri.KuralAdimi> l) =>
        string.Join(" → ", l.Select(x => AvansOnayZinciri.IkMi(x.Onay) ? "İK" : x.Sicil is null ? x.Onay : $"{x.Onay} ({x.Sicil})"));

    [HttpGet]
    public IActionResult Liste()
    {
        var kurallar = _tablo.Kurallar();
        var personel = _kaynak.TumPersonelleriGetir().Where(x => x.Durum == 1).ToList();

        var pozisyonlar = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .GroupBy(x => x.Pozisyon.Trim())
            .Select(g => new { pozisyon = g.Key, kisi = g.Count() })
            .OrderBy(x => x.pozisyon)
            .ToList();

        /* Kuralı olmayanlar varsayılan sırayla gidiyor; tamamlanabilsin diye listeleniyor */
        var eksikler = personel
            .Where(x => !string.IsNullOrWhiteSpace(x.Pozisyon))
            .Where(x => _tablo.KuralBul(x.Pozisyon, x.IsGrubu, x.PersonelKodu).Kural is null)
            .GroupBy(x => x.Pozisyon.Trim())
            .Select(g => new
            {
                pozisyon = g.Key,
                kisi = g.Count(),
                isYerleri = g.Select(x => x.IsGrubu).Distinct().Take(5).ToList(),
            })
            .OrderByDescending(x => x.kisi)
            .ToList();

        var isYerleri = kurallar.Select(k => k.IsYeri)
            .Append(AvansOnayZinciri.Sube)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        var gmySicil = Parametre.Metin("avans.gmySicil");
        var gmy = personel.FirstOrDefault(x => IzinOnayKuralServisi.AyniSicil(x.PersonelKodu, gmySicil));

        /* Sicil → ad: tabloda sicille yazılan kişilerin adları */
        var siciller = kurallar.SelectMany(k => k.Adimlar).Where(x => x.Sicil is not null)
            .Select(x => x.Sicil).Distinct().ToList();
        var kisiAdlari = siciller.ToDictionary(s => s, s =>
        {
            var p = personel.FirstOrDefault(x => IzinOnayKuralServisi.AyniSicil(x.PersonelKodu, s));
            return p is null ? null : $"{p.Ad} {p.Soyad}".Trim();
        });

        using var db = _vt.Baglanti();
        var bekleyen = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_IZIN_TALEP WHERE iptal = 0 AND durum IN (N'Bekliyor', N'Mağaza Onayladı', N'Bölge Onayladı')");

        return Ok(new
        {
            yazabilir = Yazabilir,
            kurallar,
            pozisyonlar,
            eksikler,
            isYerleri,
            kisiAdlari,
            gmy = new { sicil = gmySicil, adSoyad = gmy is null ? null : $"{gmy.Ad} {gmy.Soyad}".Trim() },
            varsayilanSube = IzinZincirKurali.Varsayilan(true),
            varsayilanDiger = IzinZincirKurali.Varsayilan(false),
            bekleyen,
        });
    }

    public class KuralGirdi
    {
        public int Id { get; set; }
        public string IsYeri { get; set; }
        public string Pozisyon { get; set; }
        public List<AvansOnayZinciri.KuralAdimi> Adimlar { get; set; }
    }

    private static string Denetle(string yer, string poz, List<AvansOnayZinciri.KuralAdimi> adimlar)
    {
        if (yer.Length == 0 || poz.Length == 0) return "İş yeri ve pozisyon zorunlu.";
        if (adimlar.Count == 0) return $"{yer} · {poz}: en az bir onay seçiniz.";
        if (adimlar.Any(x => !AvansOnayZinciri.IkMi(x.Onay) && x.Sicil is null && A(x.Onay) == A(poz)))
            return $"{yer} · {poz}: bir pozisyon kendi talebini onaylayamaz; belirli kişi ise sicilini yazınız.";
        return null;
    }

    [HttpPost]
    public IActionResult Kaydet([FromBody] KuralGirdi g)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu tabloyu değiştirme yetkiniz yok." });

        var yer = (g?.IsYeri ?? "").Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));
        var poz = (g?.Pozisyon ?? "").Trim();
        var adimlar = AvansOnayZinciri.Temizle(g?.Adimlar);

        if (Denetle(yer, poz, adimlar) is string hata) return BadRequest(new { hata });

        using var db = _vt.Baglanti();

        var cakisan = db.Query("SELECT id, is_yeri, pozisyon FROM KRY_IZIN_ZINCIR_KURAL WHERE aktif = 1 AND id <> @id",
                new { id = g.Id })
            .Any(x => A((string)x.is_yeri) == A(yer) && A((string)x.pozisyon) == A(poz));

        if (cakisan) return BadRequest(new { hata = $"{yer} · {poz} için zaten bir satır var." });

        var json = AvansOnayZinciri.AdimlariYaz(adimlar);

        if (g.Id > 0)
            db.Execute(@"
UPDATE KRY_IZIN_ZINCIR_KURAL SET is_yeri = @yer, pozisyon = @poz, adimlar = @json,
       guncelleyen = @kim, guncelleme = SYSDATETIME()
WHERE id = @id", new { id = g.Id, yer, poz, json, kim = Kim });
        else
            db.Execute(@"
INSERT INTO KRY_IZIN_ZINCIR_KURAL (is_yeri, pozisyon, adimlar, guncelleyen) VALUES (@yer, @poz, @json, @kim)",
                new { yer, poz, json, kim = Kim });

        IzinZincirKurali.Unut();
        Iz(db, $"{yer} · {poz}: {Ozet(adimlar)}");

        return Ok(new { basarili = true });
    }

    [HttpDelete("{id:int}")]
    public IActionResult Sil(int id)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu tabloyu değiştirme yetkiniz yok." });

        using var db = _vt.Baglanti();
        var satir = db.QueryFirstOrDefault("SELECT is_yeri, pozisyon FROM KRY_IZIN_ZINCIR_KURAL WHERE id = @id", new { id });

        db.Execute("UPDATE KRY_IZIN_ZINCIR_KURAL SET aktif = 0, guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE id = @id",
            new { id, kim = Kim });

        IzinZincirKurali.Unut();
        if (satir is not null) Iz(db, $"{satir.is_yeri} · {satir.pozisyon} satırı silindi");

        return Ok(new { basarili = true });
    }

    public class TopluGirdi
    {
        public List<KuralGirdi> Kurallar { get; set; }
    }

    /// <summary>Excel'den yükleme: tablo baştan yazılıyor (eskiler pasif)</summary>
    [HttpPost("Toplu")]
    public IActionResult Toplu([FromBody] TopluGirdi g)
    {
        if (!Yazabilir) return StatusCode(403, new { hata = "Bu tabloyu değiştirme yetkiniz yok." });

        var tr = new System.Globalization.CultureInfo("tr-TR");
        var satirlar = (g?.Kurallar ?? new())
            .Select(x => (yer: (x.IsYeri ?? "").Trim().ToUpper(tr), poz: (x.Pozisyon ?? "").Trim(),
                adimlar: AvansOnayZinciri.Temizle(x.Adimlar)))
            .Where(x => x.yer.Length > 0 || x.poz.Length > 0)
            .ToList();

        if (satirlar.Count == 0) return BadRequest(new { hata = "Dosyada satır bulunamadı." });
        if (satirlar.Count > 2000) return BadRequest(new { hata = "En fazla 2000 satır yüklenebilir." });

        foreach (var x in satirlar)
            if (Denetle(x.yer, x.poz, x.adimlar) is string hata) return BadRequest(new { hata });

        var tekrar = satirlar.GroupBy(x => (A(x.yer), A(x.poz))).FirstOrDefault(x => x.Count() > 1);
        if (tekrar is not null)
            return BadRequest(new { hata = $"{tekrar.First().yer} · {tekrar.First().poz} dosyada birden çok kez var." });

        using var db = _vt.Baglanti();
        if (db.State != ConnectionState.Open) db.Open();

        using (var islem = db.BeginTransaction())
        {
            db.Execute("UPDATE KRY_IZIN_ZINCIR_KURAL SET aktif = 0, guncelleyen = @kim, guncelleme = SYSDATETIME() WHERE aktif = 1",
                new { kim = Kim }, islem);

            foreach (var x in satirlar)
                db.Execute(@"
INSERT INTO KRY_IZIN_ZINCIR_KURAL (is_yeri, pozisyon, adimlar, guncelleyen) VALUES (@yer, @poz, @json, @kim)",
                    new { x.yer, x.poz, json = AvansOnayZinciri.AdimlariYaz(x.adimlar), kim = Kim }, islem);

            islem.Commit();
        }

        IzinZincirKurali.Unut();
        Iz(db, $"İzin onay süreci tablosu Excel'den yüklendi: {satirlar.Count} satır");

        return Ok(new { basarili = true, sayi = satirlar.Count });
    }

    /// <summary>Bir personelin izin talebi kimlerden geçer (tabloyu değiştirmeden önce görmek için)</summary>
    [HttpGet("Dene")]
    public IActionResult Dene([FromQuery] string sicil)
    {
        var p = _kaynak.TumPersonelleriGetir()
            .FirstOrDefault(x => IzinOnayKuralServisi.AyniSicil(x.PersonelKodu, sicil));

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var z = _zincir.Olustur(p);
        var ilk = _zincir.Ilerle(z, -1, p.PersonelKodu, p.IsGrubu);

        /* Önizleme: ilk adımdan sonrakiler de çözülmüş hâliyle */
        foreach (var a in z.Adimlar.Skip((ilk ?? 0) + 1)) _zincir.Coz(a, p.PersonelKodu, p.IsGrubu, z);

        return Ok(new
        {
            personel = new { adSoyad = $"{p.Ad} {p.Soyad}".Trim(), p.Pozisyon, isYeri = p.IsGrubu },
            kural = z.Kural,
            isYeri = z.IsYeri,
            ilkAdim = ilk,
            adimlar = IzinOnayZinciri.Ozet(z),
        });
    }
}

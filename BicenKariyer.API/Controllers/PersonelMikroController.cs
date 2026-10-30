using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel kartından bilgi düzenleme (02.10.2026).
///
/// <para>
/// Kimlik, iletişim, görev ve adres bilgileri doğrudan Mikro'ya yazılır
/// (<see cref="MikroPersonelYazmaServisi"/>); yol ücreti Mikro'da değil
/// kariyer veritabanında tutulur ve <c>YolUcretiController</c> üzerinden
/// kaydedilir. İki tarafın değişiklikleri aynı kayıt tablosunda
/// (KRY_PERSONEL_MIKRO_DEGISIKLIK) birlikte görünür.
/// </para>
///
/// <para>
/// Yetki: Admin, İK Yöneticisi, İK Uzmanı ve bunları temel alan özel
/// roller. Özel rolün jetonunda temel rol ikinci bir rol hakkı olarak
/// bulunduğu için [Authorize] süzgeci onları da geçirir; ayrıca rol
/// yetkisinde "yalnızca görüntüleyebilir" işaretliyse yazma reddedilir.
/// </para>
/// </summary>
[ApiController]
[Route("api/Personel")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class PersonelMikroController : ControllerBase
{
    private readonly MikroPersonelYazmaServisi _mikro;
    private readonly YetkiServisi _yetki;
    private readonly VeritabaniServisi _vt;

    public PersonelMikroController(
        MikroPersonelYazmaServisi mikro, YetkiServisi yetki, VeritabaniServisi vt)
    {
        _mikro = mikro;
        _yetki = yetki;
        _vt = vt;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>Değişiklik kaydında görünen ad: "Ad Soyad (kullanıcı)".</summary>
    private string Yapan
    {
        get
        {
            var ad = User?.FindFirst("adSoyad")?.Value;
            return string.IsNullOrWhiteSpace(ad) ? Kullanici : $"{ad} ({Kullanici})";
        }
    }

    /// <summary>
    /// Sunucu tarafı yetki: rolün temeli Admin / İK Yöneticisi / İK Uzmanı
    /// ve rol salt okunur değil. Personel kartındaki düğme de buna bakar.
    /// </summary>
    public static bool Duzenleyebilir(string rol, YetkiServisi yetki) =>
        Roller.Temel(rol) is Roller.Admin or Roller.IKYoneticisi or Roller.IK
        && !yetki.SaltOkunur(rol);

    private IActionResult Yanit(MikroPersonelYazmaServisi.Sonuc s) =>
        s.Basarili
            ? Ok(new { mesaj = s.Mesaj, veri = s.Veri })
            : StatusCode(s.Durum, new { hata = s.Mesaj });

    /// <summary>
    /// Düzenleme formu: Mikro'daki güncel değerler, iş grubu tanımları,
    /// yol ücreti ve son değişiklikler.
    /// </summary>
    [HttpGet("{kod}/Mikro")]
    public IActionResult Form(string kod)
    {
        if (!Duzenleyebilir(Rol, _yetki))
            return StatusCode(403, new { hata = "Personel bilgilerini düzenleme yetkiniz yok." });

        var sonuc = _mikro.FormOku(kod, alan => _yetki.Gizli(Rol, alan));

        if (!sonuc.Basarili) return StatusCode(sonuc.Durum, new { hata = sonuc.Mesaj });

        /* Yol ücreti kariyer veritabanında; ücret gizli rolde gösterilmez */
        var ucretGizli = _yetki.Gizli(Rol, YetkiServisi.Ucret);
        object yol = null;

        if (!ucretGizli)
        {
            try
            {
                using var db = _vt.Baglanti();

                /* Sicil karşılaştırması YolUcretiController ile aynı:
                   baştaki sıfırlar ve boşluklar yok sayılır. */
                static string K(string s) => (s ?? "").Trim().TrimStart('0');

                var aranan = K(kod);

                yol = db.Query(@"
SELECT personel_kodu AS personelKodu, tutar, aciklama, guncelleyen, guncelleme
FROM KRY_PERSONEL_YOL")
                    .FirstOrDefault(x => aranan.Length > 0 && K((string)x.personelKodu) == aranan);
            }
            catch
            {
                /* Yol ücreti okunamazsa form yine açılır */
            }
        }

        return Ok(new
        {
            personelKodu = (kod ?? "").Trim(),
            mikro = sonuc.Veri,
            yol,
            yolGizli = ucretGizli,
            gecmis = Maskele(_mikro.Gecmis(kod))
        });
    }

    /// <summary>Düzenleme isteği.</summary>
    public sealed class DuzenlemeIstegi
    {
        /// <summary>anahtar → yeni değer (yalnızca değişen alanlar)</summary>
        public Dictionary<string, string> Degerler { get; set; }

        /// <summary>anahtar → form açıldığında görülen değer</summary>
        public Dictionary<string, string> Onceki { get; set; }
    }

    /// <summary>
    /// Değişen alanları Mikro'ya yazar. PUT asıl yöntem; IIS'te WebDAV PUT'u
    /// yakalarsa diye panel aynı adrese POST gönderiyor.
    /// </summary>
    [HttpPut("{kod}/Mikro")]
    [HttpPost("{kod}/Mikro")]
    public IActionResult Kaydet(string kod, [FromBody] DuzenlemeIstegi istek)
    {
        if (!Duzenleyebilir(Rol, _yetki))
            return StatusCode(403, new { hata = "Personel bilgilerini düzenleme yetkiniz yok." });

        if (istek?.Degerler is null)
            return BadRequest(new { hata = "Değişiklik yok." });

        return Yanit(_mikro.Yaz(kod, istek.Degerler, istek.Onceki, Yapan,
            alan => _yetki.Gizli(Rol, alan), Kullanici));
    }

    /// <summary>Personelin son değişiklikleri (Mikro ve yol ücreti).</summary>
    [HttpGet("{kod}/MikroGecmis")]
    public IActionResult Gecmis(string kod) =>
        Ok(new { gecmis = Maskele(_mikro.Gecmis(kod, 50)) });

    /// <summary>
    /// Değişiklik geçmişinde rolden gizli alanların değerleri gösterilmez:
    /// ücret gizliyse yol ücreti, telefon ya da adres gizliyse onlar.
    /// </summary>
    private List<object> Maskele(List<dynamic> satirlar)
    {
        var ucret = _yetki.Gizli(Rol, YetkiServisi.Ucret);
        var telefon = _yetki.Gizli(Rol, YetkiServisi.Telefon);
        var adres = _yetki.Gizli(Rol, YetkiServisi.Adres);

        var adresEtiketleri = MikroPersonelYazmaServisi.Alanlar
            .Where(a => a.YetkiAlani == YetkiServisi.Adres)
            .Select(a => a.Etiket)
            .ToHashSet();

        return satirlar.Select(r =>
        {
            string alan = r.alan;
            string hedef = r.hedef;

            var gizli = (ucret && hedef == "KARIYER")
                        || (telefon && alan == "Cep telefonu")
                        || (adres && adresEtiketleri.Contains(alan ?? ""));

            return (object)new
            {
                id = (int)r.id,
                alan,
                eski = gizli ? "•••" : (string)r.eski,
                yeni = gizli ? "•••" : (string)r.yeni,
                yapan = (string)r.yapan,
                zaman = (DateTime)r.zaman,
                hedef,
                durum = (string)r.durum
            };
        }).ToList();
    }
}

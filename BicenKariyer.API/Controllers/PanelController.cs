using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Panel kabuğunun küçük yardımcı uçları.
///
/// <para>
/// <b>MenuSayilari:</b> kenar menüdeki rozetler. Panel bunu dakikada bir ve
/// pencere odağa geldiğinde çağırıyor; bu yüzden her sayı tek bir COUNT
/// sorgusu ve her biri kendi try/catch'inde — bir tablonun sorunu diğer
/// rozetleri götürmesin. Sayılamayan değer <c>null</c> döner ve panel o
/// rozeti hiç göstermez.
/// </para>
///
/// <para>
/// Sayılar, ilgili sayfanın kendi listesiyle aynı kuralı izler (aynı şube
/// süzmesi, aynı aşama kuralı). Rozet "4" deyip sayfa 3 kayıt gösterirse
/// rozet güven kaybeder.
/// </para>
///
/// <para>
/// Veritabanı uyumluluk düzeyi 130'un altında: STRING_SPLIT / OPENJSON
/// kullanılmıyor; listeler Dapper'ın IN genişletmesiyle gidiyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class PanelController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly YetkiServisi _yetki;
    private readonly ILogger<PanelController> _kayit;

    public PanelController(
        VeritabaniServisi vt,
        AyarServisi ayar,
        YetkiServisi yetki,
        ILogger<PanelController> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _yetki = yetki;
        _kayit = kayit;
    }

    private string Kullanici => User?.Identity?.Name ?? "";

    /// <summary>
    /// İlk rol hakkı: kullanıcının kendi rolü (özel rolde rol kodu). Diğer
    /// denetleyicilerle aynı okuma; izin listesindeki aşama kuralı da bunu
    /// kullanıyor.
    /// </summary>
    private string Rol =>
        User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /* Durum adları ilgili denetleyicilerle aynı yazılmalı */
    private const string IzinBekliyor = "Bekliyor";
    private const string IzinMagazaOnayli = "Mağaza Onayladı";
    private const string IzinBolgeOnayli = "Bölge Onayladı";

    /// <summary>
    /// Kenar menü rozetleri.
    ///
    /// <list type="bullet">
    /// <item><c>basvurular</c>: "Yeni" durumundaki başvurular. Liste
    /// ekranının varsayılan tabanı (arşiv dışı, kimlik başına en yeni kayıt,
    /// bölge müdüründe kendi şubeleri, bölge seçicisindeki seçim). Özet
    /// ekranı gören rolde (bölge müdürü) sayılmaz.</item>
    /// <item><c>izintalep</c>: rolün karar aşamasında bekleyen izin
    /// talepleri — İzin Talepleri ekranındaki "sırada" sayısı.</item>
    /// <item><c>isemri</c>: bana atanmış, bitmemiş ve iptal edilmemiş iş
    /// emirleri.</item>
    /// <item><c>etik</c>: henüz ele alınmamış ("alindi") etik bildirimleri;
    /// yalnızca etik kurul yetkisinde.</item>
    /// <item><c>takvim</c>: bugünkü görüşmeler — görüşme talebindeki
    /// başvurular ve elle oluşturulan görüşmeler.</item>
    /// </list>
    /// </summary>
    [HttpGet("MenuSayilari")]
    public IActionResult MenuSayilari()
    {
        var rol = Rol;

        /* Mobil personel oturumu panel menüsü görmez */
        if (string.IsNullOrWhiteSpace(rol) || rol == "Personel") return Forbid();

        using var db = _vt.Baglanti();

        int? basvurular = null, izintalep = null, isemri = null, etik = null, takvim = null;

        /* ---------------------------------------------------- başvurular */
        if (!Roller.OzetEkrani(rol) && _yetki.MenuAcik(rol, "basvurular"))
        {
            basvurular = Say("basvurular", () => db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM KRY_BASVURULAR b
WHERE b.durum = @durum
  AND ISNULL(b.arsiv, 0) = 0
  AND (b.kimlik_no IS NULL OR b.id = " + BasvuruTabani.TemsilciId("b") + @")
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)",
                new
                {
                    durum = Durumlar.Yeni,
                    subeSiniri = SubeSuzmesi(rol) ? 1 : 0,
                    yetkiliSubeler = SuzmeSubeleri(rol)
                }));
        }

        /* ----------------------------------------------- izin talepleri */
        var izinDurumlari = AsamaDurumlari(rol);

        if (izinDurumlari.Length > 0 && _yetki.MenuAcik(rol, "izintalep"))
        {
            izintalep = Say("izintalep", () => db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum IN @durumlar",
                new { durumlar = izinDurumlari }));
        }

        /* -------------------------------------------------- iş emirleri */
        isemri = Say("isemri", () => db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM KRY_IS_EMRI
WHERE atanan_tur = 'panel' AND atanan_kod = @kod
  AND durum NOT IN (N'Bitti', N'İptal')",
            new { kod = Kullanici }));

        /* ----------------------------------------------------- etik hat */
        /* EtikController'daki kurul kuralı: yönetici ya da etik menüsü
           açık rol. Diğer roller bildirim sayısını bile görmemeli. */
        if (rol == Roller.Admin || _yetki.MenuAcik(rol, "etik"))
        {
            etik = Say("etik", () => db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_ETIK WHERE durum = N'alindi'"));
        }

        /* ------------------------------------------------ görüşme takvimi */
        if (Roller.IslemYetkisi(rol) && _yetki.MenuAcik(rol, "takvim"))
        {
            takvim = Say("takvim", () =>
            {
                var bugun = DateTime.Today;
                var yarin = bugun.AddDays(1);

                var basvuru = db.ExecuteScalar<int>(@"
SELECT COUNT(*)
FROM KRY_BASVURULAR b
WHERE b.durum = @durum
  AND b.gorusme_tarihi >= @bugun AND b.gorusme_tarihi < @yarin
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)",
                    new
                    {
                        durum = Durumlar.GorusmeTalebi,
                        bugun,
                        yarin,
                        subeSiniri = SubeSuzmesi(rol) ? 1 : 0,
                        yetkiliSubeler = SuzmeSubeleri(rol)
                    });

                /* Elle görüşme tablosu eski kurulumlarda olmayabilir */
                var elle = 0;

                try
                {
                    elle = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MANUEL_GORUSME
WHERE gorusme_tarihi >= @bugun AND gorusme_tarihi < @yarin
  AND ISNULL(durum, N'') NOT IN (N'İptal', N'Iptal')",
                        new { bugun, yarin });
                }
                catch (Exception hata)
                {
                    _kayit.LogDebug(hata, "Elle görüşme sayısı okunamadı");
                }

                return basvuru + elle;
            });
        }

        return Ok(new { basvurular, izintalep, isemri, etik, takvim });
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    /// <summary>Tek bir sayıyı korumalı hesaplar; hata olursa null.</summary>
    private int? Say(string ad, Func<int> hesap)
    {
        try
        {
            return hesap();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Menü sayısı hesaplanamadı: {Ad}", ad);
            return null;
        }
    }

    /// <summary>
    /// Rolün karar verebildiği izin durumları — IzinTalepController'daki
    /// AsamaRolu ve "sırada" kuralının aynısı.
    /// </summary>
    /// <summary>
    /// Bildirim merkezi › Bekleyen işler › Personel talepleri (07.10.2026):
    /// kullanıcının karar sırasında olduğu izin, avans, fazla mesai,
    /// rotasyon ve vardiya düzeltme talepleri. İK uzmanında yalnızca kendi
    /// şubeleri (Personel Talepleri sayfasındaki varsayılanla aynı).
    /// </summary>
    [HttpGet("BekleyenTalepler")]
    public IActionResult BekleyenTalepler()
    {
        var rol = Rol;
        if (string.IsNullOrWhiteSpace(rol) || rol == "Personel") return Forbid();

        var temel = Roller.Temel(rol);
        var ik = temel is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi or Roller.IK;

        using var db = _vt.Baglanti();

        var kapsam = UzmanKapsami.Olustur(db, _ayar, rol, Kullanici, null);
        bool Icinde(string sube) => kapsam is null || kapsam.Icinde(sube);

        int? Guvenli(Func<int> f)
        {
            try { return f(); }
            catch (Exception h) { _kayit.LogDebug(h, "Bekleyen talep sayısı okunamadı"); return null; }
        }

        var izinDurumlari = AsamaDurumlari(temel);

        int? izin = izinDurumlari.Length == 0 || !_yetki.MenuAcik(rol, "izintalep") ? null : Guvenli(() =>
            db.Query<string>("SELECT sube_adi FROM KRY_IZIN_TALEP WHERE iptal = 0 AND durum IN @d", new { d = izinDurumlari })
                .Count(Icinde));

        int? avans = !ik ? null : Guvenli(() =>
        {
            var akis = AvansAkisi.Gecerli();
            var adimlar = akis.Adimlar.Select((x, i) => (x, i)).Where(t => AvansAkisi.PanelYetkili(t.x, temel)).Select(t => t.i).ToList();
            if (adimlar.Count == 0) return 0;
            return db.Query<string>("SELECT sube FROM KRY_AVANS WHERE durum = N'bekliyor' AND ISNULL(asama, 0) IN @a", new { a = adimlar })
                .Count(Icinde);
        });

        int? fazlamesai = !ik ? null : Guvenli(() =>
            db.Query<string>("SELECT sube FROM KRY_FAZLA_MESAI WHERE durum = N'bekliyor'").Count(Icinde));

        int? rotasyon = !(ik || temel == Roller.BolgeMuduru) ? null : Guvenli(() =>
        {
            var durumlar = temel == Roller.BolgeMuduru ? new[] { "bolge" }
                : temel is Roller.Admin or Roller.GenelMudurYardimcisi ? new[] { "ik", "bolge" }
                : new[] { "ik" };
            var k = temel == Roller.BolgeMuduru ? UzmanKapsami.Olustur(db, _ayar, Roller.IK, Kullanici, null) : kapsam;
            return db.Query<string>("SELECT sube FROM KRY_ROTASYON_TALEP WHERE durum IN @d", new { d = durumlar })
                .Count(x => k is null || k.Icinde(x));
        });

        int? itiraz = !(temel is Roller.Admin or Roller.GenelMudurYardimcisi or Roller.IKYoneticisi or Roller.IK) ? null : Guvenli(() =>
            db.Query<string>("SELECT sube_adi FROM KRY_VARDIYA_ITIRAZ WHERE iptal = 0 AND durum = N'Bekliyor'").Count(Icinde));

        var toplam = (izin ?? 0) + (avans ?? 0) + (fazlamesai ?? 0) + (rotasyon ?? 0) + (itiraz ?? 0);

        return Ok(new
        {
            izin, avans, fazlamesai, rotasyon, itiraz, toplam,
            kapsam = UzmanKapsami.Ozet(kapsam),
        });
    }

    /// <summary>
    /// Sırası İK'da olan personel talepleri, tek tek (30.10.2026).
    ///
    /// <para>
    /// Panel bu listeyi dakikada bir okur; daha önce görmediği bir anahtar
    /// gelince ekranın sağ altında sesli bir kart açar ("onayınızı bekleyen
    /// yeni talep"). Yalnızca İK Uzmanı / İK Yöneticisi (ve onları temel alan
    /// roller) için dolu döner; kapsam uzmanın kendi şubeleridir, Bekleyen
    /// işler çekmecesindeki sayılarla aynı kural.
    /// </para>
    /// </summary>
    [HttpGet("IkSiradakiTalepler")]
    public IActionResult IkSiradakiTalepler()
    {
        var rol = Rol;
        var temel = Roller.Temel(rol);
        if (temel is not (Roller.IK or Roller.IKYoneticisi))
            return Ok(new { aktif = false, talepler = Array.Empty<object>() });

        using var db = _vt.Baglanti();
        var kapsam = UzmanKapsami.Olustur(db, _ayar, rol, Kullanici, null);
        bool Icinde(string sube) => kapsam is null || kapsam.Icinde(sube);

        var liste = new List<(string anahtar, string tur, string sekme, string adSoyad, string sube, string ozet, DateTime? zaman)>();

        void Ekle(Action a)
        {
            try { a(); }
            catch (Exception h) { _kayit.LogDebug(h, "İK sıradaki talepler okunamadı"); }
        }

        var tr = new System.Globalization.CultureInfo("tr-TR");

        if (_yetki.MenuAcik(rol, "izintalep"))
            Ekle(() =>
            {
                foreach (var t in db.Query(@"
SELECT id, ad_soyad AS adSoyad, sube_adi AS sube, tur, gun, saat, cikis_tarihi AS cikis,
       COALESCE(bolge_tarih, magaza_tarih, olusturma) AS zaman
FROM KRY_IZIN_TALEP WHERE iptal = 0 AND durum = @d", new { d = IzinBolgeOnayli }))
                {
                    if (!Icinde((string)t.sube)) continue;
                    var sure = t.saat is not null && (decimal)t.saat > 0
                        ? $"{((decimal)t.saat).ToString("0.##", tr)} saat"
                        : $"{((decimal)t.gun).ToString("0.#", tr)} gün";
                    var cikis = t.cikis is null ? "" : $" · {((DateTime)t.cikis):dd.MM}";
                    liste.Add(($"izin:{t.id}", "İzin", "izin", (string)t.adSoyad, (string)t.sube,
                        $"{t.tur} · {sure}{cikis}", (DateTime?)t.zaman));
                }
            });

        Ekle(() =>
        {
            var akis = AvansAkisi.Gecerli();
            var adimlar = akis.Adimlar.Select((x, i) => (x, i)).Where(t => AvansAkisi.PanelYetkili(t.x, temel)).Select(t => t.i).ToList();
            if (adimlar.Count == 0) return;
            foreach (var t in db.Query(@"
SELECT id, ad_soyad AS adSoyad, sube, tutar, ISNULL(guncelleme, olusturma) AS zaman
FROM KRY_AVANS WHERE durum = N'bekliyor' AND ISNULL(asama, 0) IN @a", new { a = adimlar }))
            {
                if (!Icinde((string)t.sube)) continue;
                liste.Add(($"avans:{t.id}", "Avans", "avans", (string)t.adSoyad, (string)t.sube,
                    $"{((decimal)t.tutar).ToString("N0", tr)} ₺", (DateTime?)t.zaman));
            }
        });

        Ekle(() =>
        {
            foreach (var t in db.Query(@"
SELECT id, ad_soyad AS adSoyad, sube, tarih, sure_dk AS dk
FROM KRY_FAZLA_MESAI WHERE durum = N'bekliyor'"))
            {
                if (!Icinde((string)t.sube)) continue;
                int dk = t.dk is null ? 0 : Convert.ToInt32((object)t.dk);
                var sure = dk >= 60 ? $"{dk / 60} sa{(dk % 60 > 0 ? $" {dk % 60} dk" : "")}" : $"{dk} dk";
                liste.Add(($"fazlamesai:{t.id}", "Fazla mesai", "fazlamesai", (string)t.adSoyad, (string)t.sube,
                    $"{((DateTime)t.tarih):dd.MM} · {sure}", (DateTime?)t.tarih));
            }
        });

        Ekle(() =>
        {
            foreach (var t in db.Query(@"
SELECT id, ad_soyad AS adSoyad, sube, bolge_tarih AS zaman
FROM KRY_ROTASYON_TALEP WHERE durum = N'ik'"))
            {
                if (!Icinde((string)t.sube)) continue;
                liste.Add(($"rotasyon:{t.id}", "Rotasyon", "rotasyon", (string)t.adSoyad, (string)t.sube,
                    "Şube değişikliği", (DateTime?)t.zaman));
            }
        });

        Ekle(() =>
        {
            foreach (var t in db.Query(@"
SELECT id, ad_soyad AS adSoyad, sube_adi AS sube, tarih, tur, olusturma AS zaman
FROM KRY_VARDIYA_ITIRAZ WHERE iptal = 0 AND durum = N'Bekliyor'"))
            {
                if (!Icinde((string)t.sube)) continue;
                liste.Add(($"itiraz:{t.id}", "Vardiya düzeltme", "itiraz", (string)t.adSoyad, (string)t.sube,
                    $"{t.tur} · {((DateTime)t.tarih):dd.MM}", (DateTime?)t.zaman));
            }
        });

        return Ok(new
        {
            aktif = true,
            talepler = liste
                .OrderByDescending(x => x.zaman)
                .Select(x => new { x.anahtar, x.tur, x.sekme, x.adSoyad, x.sube, x.ozet, x.zaman })
        });
    }

    private static string[] AsamaDurumlari(string rol) => rol switch
    {
        Roller.Admin or Roller.GenelMudurYardimcisi =>
            new[] { IzinBekliyor, IzinMagazaOnayli, IzinBolgeOnayli },
        Roller.IK or Roller.IKYoneticisi => new[] { IzinBolgeOnayli },
        Roller.BolgeMuduru => new[] { IzinBekliyor },
        Roller.BolgeKoordinatoru => new[] { IzinMagazaOnayli },
        _ => Array.Empty<string>(),
    };

    /* Şube süzmesi: BasvuruController'daki kuralların aynısı (bölge
       müdürü kendi şubeleri; bölge seçicisi olan rolde X-Bolge başlığı). */

    private string[] YetkiliSubeler()
    {
        var ham = User?.FindFirst("subeler")?.Value ?? "";

        var liste = ham.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        return liste.Length > 0 ? liste : new[] { "__TANIMSIZ__" };
    }

    private string[] SecilenBolgeSubeleri(string rol)
    {
        if (!Roller.BolgeSecici(rol)) return null;

        var secim = Request.Headers["X-Bolge"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(secim)) return null;

        var bolgeAdlari = secim
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => Uri.UnescapeDataString(x.Trim()))
            .Where(x => x.Length > 0)
            .ToArray();

        if (bolgeAdlari.Length == 0) return null;

        var kodlar = (_ayar.FormOku()?.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => bolgeAdlari.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return kodlar.Length > 0 ? kodlar : new[] { "__TANIMSIZ__" };
    }

    private bool SubeSuzmesi(string rol) =>
        Roller.SubeSiniri(rol) || SecilenBolgeSubeleri(rol) is not null;

    private string[] SuzmeSubeleri(string rol) =>
        SecilenBolgeSubeleri(rol) ?? YetkiliSubeler();
}

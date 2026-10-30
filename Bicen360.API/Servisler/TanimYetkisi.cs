using System.Security.Claims;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Departmanın kendi tanımları (13.10.2026): arıza türleri (soru akışıyla)
/// ve envanter kategorileri.
///
/// <para>
/// Yönetim sayfası açık olan her şeyi düzenler. Diğerleri yalnızca kendi
/// departmanlarının tanımlarını: sayfada "yönetir / düzenler" yetkisi
/// varsa rolünün ve temsilcisi olduğu departmanlar, yoksa yalnızca
/// temsilcisi olduğu departmanlar. Departmanı boş (genel) tanımları yalnızca
/// bütün departmanları yönetebilen düzenler. Şube kullanıcısı tanım
/// düzenlemez.
/// </para>
/// </summary>
public class TanimYetkisi
{
    private readonly YetkiServisi _yetki;
    private readonly RaporKapsami _kapsam;
    private readonly PanelKullaniciServisi _panel;
    private readonly RolServisi _roller;
    private readonly PersonelServisi _personel;

    public TanimYetkisi(YetkiServisi yetki, RaporKapsami kapsam, PanelKullaniciServisi panel,
        RolServisi roller, PersonelServisi personel)
    {
        _yetki = yetki;
        _kapsam = kapsam;
        _panel = panel;
        _roller = roller;
        _personel = personel;
    }

    public sealed record Kapsam(bool Hepsi, List<int> Departmanlar)
    {
        public bool Var => Hepsi || Departmanlar.Count > 0;
        public bool Acik(int? departmanId) => Hepsi || (departmanId is int d && Departmanlar.Contains(d));
    }

    private static readonly Kapsam Yok = new(false, new List<int>());

    /// <param name="sayfa">"ariza" ya da "envanter"</param>
    public Kapsam Al(ClaimsPrincipal u, string sayfa)
    {
        var ad = u?.Identity?.Name ?? "";
        var rol = u?.FindFirstValue(ClaimTypes.Role) ?? "";

        if (ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return Yok;

        if (YetkiServisi.Adminmi(rol) || _yetki.SayfaAcik(ad, rol, "yonetim"))
            return new Kapsam(true, new List<int>());

        if (_panel.Getir(ad).SubeKilitli) return Yok;
        if (!_yetki.SayfaAcik(ad, rol, sayfa)) return Yok;

        if (_yetki.SayfaYonetir(ad, rol, sayfa))
        {
            var k = _kapsam.Panel(ad, rol);
            return k.TumunuGorur ? new Kapsam(true, new List<int>()) : new Kapsam(false, k.Departmanlar);
        }

        return new Kapsam(false, _kapsam.PanelTemsilcilikleri(ad));
    }

    /// <summary>Bir departmanda iş alabilecek kişiler: temsilciler ve rol kullanıcıları</summary>
    public List<(int DepartmanId, string Sicil, string AdSoyad, string Pozisyon)> Adaylar(
        System.Data.IDbConnection db, IEnumerable<int> departmanlar, string sayfa = "ariza")
    {
        var deps = departmanlar.Distinct().ToList();
        var sonuc = new List<(int, string, string, string)>();
        if (deps.Count == 0) return sonuc;

        foreach (var t in db.Query<(int Dep, string Sicil)>(
                     "SELECT departman_id, personel_kodu FROM B360_DEPARTMAN_TEMSILCI WHERE departman_id IN @deps", new { deps }))
        {
            var p = _personel.Getir((t.Sicil ?? "").Trim());
            sonuc.Add((t.Dep, (t.Sicil ?? "").Trim(), p?.AdSoyad ?? t.Sicil, p?.Pozisyon));
        }

        foreach (var r in _roller.Tumu().Where(r => r.Seviye(sayfa) > 0))
        {
            var kullanicilar = _roller.Kullanicilari(r.Id);
            if (kullanicilar.Count == 0) continue;

            var sicilller = db.Query<string>(
                "SELECT sicil FROM KRY_KULLANICILAR WHERE kullanici_adi IN @kullanicilar AND sicil IS NOT NULL AND sicil <> ''",
                new { kullanicilar }).Select(x => x.Trim()).ToList();

            foreach (var d in deps.Where(d => r.TumDepartmanlar || r.Departmanlar.Contains(d)))
                foreach (var s in sicilller)
                {
                    if (sonuc.Any(x => x.Item1 == d && string.Equals(x.Item2, s, StringComparison.OrdinalIgnoreCase))) continue;
                    var p = _personel.Getir(s);
                    sonuc.Add((d, s, p?.AdSoyad ?? s, p?.Pozisyon));
                }
        }

        return sonuc;
    }
}

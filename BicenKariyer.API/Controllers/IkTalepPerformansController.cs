using System.Globalization;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İK Performans › Personel talepleri (21.10.2026)
/// ---------------------------------------------------------------------------
/// İK uzmanlarının Personel Talepleri sayfasındaki işleri: izin kararları
/// ve karar süresi, İK evrakı yükleme ve oranı, eksik bildirimleri, fazla
/// mesai / avans / rotasyon / vardiya düzeltme kararları; şubelerinde şu an
/// bekleyen izin ve evrak.
///
/// <para>
/// Modüller yapanı farklı biçimde yazıyor: izin, eksik ve vardiya düzeltme
/// kullanıcı adını; fazla mesai, avans ve rotasyon ad soyadı ("Ad Soyad
/// (X adına)" olabilir). Satırlar bellekte iki biçimle de kişiye eşlenir.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi)]
public class IkTalepPerformansController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;

    public IkTalepPerformansController(VeritabaniServisi vt, AyarServisi ayar)
    {
        _vt = vt;
        _ayar = ayar;
    }

    private sealed class Kisi
    {
        public string KullaniciAdi { get; set; }
        public string AdSoyad { get; set; }
        public string Rol { get; set; }
        public string Unvan { get; set; }
        public string Bolge { get; set; }

        public int IzinOnay, IzinRed, IzinDigerAsama;
        public List<double> IzinSure = new();
        public int IkEvrak, FmEvrak, OnayBelgeli, EvrakSonraBekleyen, PersonelBelgeGerekli, PersonelBelgeYuklendi;
        public int Eksik, EksikTamamlanan, EksikKapatma;
        public int FmOnay, FmRed;
        public List<double> FmSure = new();
        public int AvansKarar, AvansOdeme, Rotasyon, VardiyaDuzeltme;
        public int BekleyenIzin, AcikEksik, KapsamEvrakSonra;
        public double? EnEskiBekleyenGun;
        public DateTime? SonIslem;

        public void Islem(DateTime? t)
        {
            if (t is DateTime z && (SonIslem is null || z > SonIslem)) SonIslem = z;
        }
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    private static string Anahtar(string s)
    {
        var a = (s ?? "").Trim();
        var i = a.IndexOf(" (", StringComparison.Ordinal);
        if (i > 0 && a.EndsWith("adına)", StringComparison.OrdinalIgnoreCase)) a = a[..i];
        return a.ToLower(Tr);
    }

    [HttpGet]
    public IActionResult Getir([FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var b0 = bas?.Date ?? new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var b1 = (bit?.Date ?? DateTime.Today).AddDays(1).AddTicks(-1);
        var p = new { bas = b0, bit = b1 };

        using var db = _vt.Baglanti();

        var kisiler = db.Query<Kisi>(@"
SELECT kullanici_adi AS KullaniciAdi, ad_soyad AS AdSoyad, rol AS Rol, unvan AS Unvan, bolge AS Bolge
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND id <> 1").ToList();

        /* Yalnızca aktif İK uzmanı ve İK yöneticisi (panelden açılan ve bu
           rolleri temel alan özel roller dahil); Admin ve GMY listelenmez. */
        kisiler = kisiler
            .Where(k => Roller.Temel(k.Rol) is Roller.IK or Roller.IKYoneticisi)
            .ToList();

        var harita = new Dictionary<string, Kisi>();
        foreach (var k in kisiler)
        {
            if (!string.IsNullOrWhiteSpace(k.KullaniciAdi)) harita[Anahtar(k.KullaniciAdi)] = k;
            if (!string.IsNullOrWhiteSpace(k.AdSoyad)) harita.TryAdd(Anahtar(k.AdSoyad), k);
        }
        Kisi Bul(string s) => string.IsNullOrWhiteSpace(s) ? null : harita.GetValueOrDefault(Anahtar(s));

        /* ------------------------------------------------ izin talepleri */
        foreach (var t in db.Query(@"
SELECT olusturma, magaza_kisi AS mk, magaza_karar AS mkr, magaza_tarih AS mt,
       bolge_kisi AS bk, bolge_karar AS bkr, bolge_tarih AS bt,
       ik_kisi AS ik, ik_karar AS ikr, ik_tarih AS it,
       belge_id AS belge, evrak_sonra AS evrakSonra, mb_son AS mbSon, mb_yukleme AS mbYukleme
FROM KRY_IZIN_TALEP
WHERE (ik_tarih BETWEEN @bas AND @bit) OR (magaza_tarih BETWEEN @bas AND @bit) OR (bolge_tarih BETWEEN @bas AND @bit)", p))
        {
            DateTime? it = t.it, bt = t.bt, mt = t.mt;
            if (it is DateTime ikt && ikt >= b0 && ikt <= b1 && (string)t.ikr is "Onaylandı" or "Reddedildi" && Bul((string)t.ik) is { } k)
            {
                if ((string)t.ikr == "Onaylandı")
                {
                    k.IzinOnay++;
                    if (t.belge != null) k.OnayBelgeli++;
                    else if (t.evrakSonra is true) k.EvrakSonraBekleyen++;
                    if (t.mbSon != null)
                    {
                        k.PersonelBelgeGerekli++;
                        if (t.mbYukleme != null) k.PersonelBelgeYuklendi++;
                    }
                }
                else k.IzinRed++;
                var gelis = bt ?? mt ?? (DateTime)t.olusturma;
                var saat = (ikt - gelis).TotalHours;
                if (saat >= 0) k.IzinSure.Add(saat);
                k.Islem(ikt);
            }
            foreach (var (kisi, karar, tarih) in new[] { ((string)t.mk, (string)t.mkr, mt), ((string)t.bk, (string)t.bkr, bt) })
                if (tarih is DateTime z && z >= b0 && z <= b1 && karar is "Onaylandı" or "Reddedildi" && Bul(kisi) is { } k2)
                {
                    k2.IzinDigerAsama++;
                    k2.Islem(z);
                }
        }

        /* ------------------------------------------------ İK evrakı */
        foreach (var e in db.Query("SELECT yukleyen, olusturma FROM KRY_IZIN_TALEP_EVRAK WHERE kalem = N'ik' AND olusturma BETWEEN @bas AND @bit", p))
            if (Bul((string)e.yukleyen) is { } k) { k.IkEvrak++; k.Islem((DateTime?)e.olusturma); }

        foreach (var e in db.Query("SELECT belge_yukleyen AS y, belge_tarihi AS t FROM KRY_FAZLA_MESAI WHERE belge_tarihi BETWEEN @bas AND @bit", p))
            if (Bul((string)e.y) is { } k) { k.FmEvrak++; k.Islem((DateTime?)e.t); }

        /* ------------------------------------------------ eksik bildirimi */
        foreach (var e in db.Query(@"
SELECT gonderen, durum, tarih, tamamlandi FROM KRY_TALEP_EKSIK
WHERE tarih BETWEEN @bas AND @bit AND gonderen NOT LIKE N'sistem:%'", p))
            if (Bul((string)e.gonderen) is { } k)
            {
                k.Eksik++;
                if (e.tamamlandi != null || (string)e.durum is "tamamlandi") k.EksikTamamlanan++;
                k.Islem((DateTime?)e.tarih);
            }

        foreach (var e in db.Query(@"
SELECT kapatan, kapandi FROM KRY_TALEP_EKSIK
WHERE kapandi BETWEEN @bas AND @bit AND ISNULL(kapanis_notu, N'') <> N'Yeni eksik bildirimiyle yenilendi'", p))
            if (Bul((string)e.kapatan) is { } k) { k.EksikKapatma++; k.Islem((DateTime?)e.kapandi); }

        /* ------------------------------------------------ fazla mesai */
        foreach (var e in db.Query(@"
SELECT karar_veren AS kv, karar_tarihi AS kt, durum, olusturma, ust_tarih AS ut FROM KRY_FAZLA_MESAI
WHERE karar_tarihi BETWEEN @bas AND @bit AND durum IN (N'onaylandi', N'reddedildi')", p))
            if (Bul((string)e.kv) is { } k)
            {
                if ((string)e.durum == "onaylandi") k.FmOnay++; else k.FmRed++;
                var gelis = (DateTime?)e.ut ?? (DateTime)e.olusturma;
                var saat = ((DateTime)e.kt - gelis).TotalHours;
                if (saat >= 0) k.FmSure.Add(saat);
                k.Islem((DateTime?)e.kt);
            }

        /* ------------------------------------------------ avans */
        foreach (var e in db.Query("SELECT karar_veren AS kv, karar_tarihi AS kt FROM KRY_AVANS WHERE karar_tarihi BETWEEN @bas AND @bit", p))
            if (Bul((string)e.kv) is { } k) { k.AvansKarar++; k.Islem((DateTime?)e.kt); }
        foreach (var e in db.Query("SELECT odeyen, odeme_tarihi AS t FROM KRY_AVANS WHERE odeme_tarihi BETWEEN @bas AND @bit", p))
            if (Bul((string)e.odeyen) is { } k) { k.AvansOdeme++; k.Islem((DateTime?)e.t); }

        /* ------------------------------------------------ rotasyon, vardiya düzeltme */
        foreach (var e in db.Query("SELECT ik_kisi AS kisi, ik_tarih AS t FROM KRY_ROTASYON_TALEP WHERE ik_tarih BETWEEN @bas AND @bit", p))
            if (Bul((string)e.kisi) is { } k) { k.Rotasyon++; k.Islem((DateTime?)e.t); }
        foreach (var e in db.Query(@"
SELECT karar_veren AS kv, karar_tarihi AS t FROM KRY_VARDIYA_ITIRAZ
WHERE karar_tarihi BETWEEN @bas AND @bit AND durum IN (N'Onaylandı', N'Reddedildi')", p))
            if (Bul((string)e.kv) is { } k) { k.VardiyaDuzeltme++; k.Islem((DateTime?)e.t); }

        /* ------------------------------------------------ şu an bekleyenler (uzmanın şubeleri) */
        var bekleyen = db.Query(@"
SELECT sube_adi AS sube, ISNULL(bolge_tarih, ISNULL(magaza_tarih, olusturma)) AS gelis
FROM KRY_IZIN_TALEP
WHERE ISNULL(iptal, 0) = 0 AND ik_karar IS NULL AND durum NOT IN (N'Onaylandı', N'Reddedildi')
  AND bolge_karar IS NOT NULL").ToList();
        var evrakSonra = db.Query<string>(@"
SELECT sube_adi FROM KRY_IZIN_TALEP
WHERE ISNULL(iptal, 0) = 0 AND durum = N'Onaylandı' AND evrak_sonra = 1 AND belge_id IS NULL").ToList();
        var acikEksik = db.Query<string>("SELECT gonderen FROM KRY_TALEP_EKSIK WHERE durum = N'acik' AND gonderen NOT LIKE N'sistem:%'").ToList();
        foreach (var g in acikEksik)
            if (Bul(g) is { } k) k.AcikEksik++;

        foreach (var k in kisiler.Where(x => Roller.Temel(x.Rol) is Roller.IK or Roller.IKYoneticisi))
        {
            var kapsam = UzmanKapsami.Olustur(db, _ayar, k.Rol, k.KullaniciAdi, null);
            if (kapsam is null) continue;
            var bu = bekleyen.Where(x => kapsam.Icinde((string)x.sube)).ToList();
            k.BekleyenIzin = bu.Count;
            if (bu.Count > 0) k.EnEskiBekleyenGun = Math.Round(bu.Max(x => (DateTime.Now - (DateTime)x.gelis).TotalDays), 1);
            k.KapsamEvrakSonra = evrakSonra.Count(kapsam.Icinde);
        }

        static double? Ort(List<double> l) => l.Count == 0 ? null : Math.Round(l.Average(), 1);
        static double? Medyan(List<double> l)
        {
            if (l.Count == 0) return null;
            var s = l.OrderBy(x => x).ToList();
            return Math.Round(s.Count % 2 == 1 ? s[s.Count / 2] : (s[s.Count / 2 - 1] + s[s.Count / 2]) / 2, 1);
        }

        var uzmanlar = kisiler.Select(k => new
        {
            kullaniciAdi = k.KullaniciAdi,
            adSoyad = k.AdSoyad,
            rol = k.Rol,
            unvan = k.Unvan,
            bolge = k.Bolge,
            izinOnay = k.IzinOnay,
            izinRed = k.IzinRed,
            izinDigerAsama = k.IzinDigerAsama,
            izinOrtSaat = Ort(k.IzinSure),
            izinMedyanSaat = Medyan(k.IzinSure),
            izinEnUzunSaat = k.IzinSure.Count == 0 ? (double?)null : Math.Round(k.IzinSure.Max(), 1),
            izin24 = k.IzinSure.Count(x => x <= 24),
            ikEvrak = k.IkEvrak,
            fmEvrak = k.FmEvrak,
            onayBelgeli = k.OnayBelgeli,
            evrakSonraBekleyen = k.EvrakSonraBekleyen,
            personelBelgeGerekli = k.PersonelBelgeGerekli,
            personelBelgeYuklendi = k.PersonelBelgeYuklendi,
            eksik = k.Eksik,
            eksikTamamlanan = k.EksikTamamlanan,
            eksikKapatma = k.EksikKapatma,
            fmOnay = k.FmOnay,
            fmRed = k.FmRed,
            fmOrtSaat = Ort(k.FmSure),
            avansKarar = k.AvansKarar,
            avansOdeme = k.AvansOdeme,
            rotasyon = k.Rotasyon,
            vardiyaDuzeltme = k.VardiyaDuzeltme,
            bekleyenIzin = k.BekleyenIzin,
            enEskiBekleyenGun = k.EnEskiBekleyenGun,
            kapsamEvrakSonra = k.KapsamEvrakSonra,
            acikEksik = k.AcikEksik,
            toplam = k.IzinOnay + k.IzinRed + k.IzinDigerAsama + k.IkEvrak + k.FmEvrak + k.Eksik + k.EksikKapatma
                     + k.FmOnay + k.FmRed + k.AvansKarar + k.AvansOdeme + k.Rotasyon + k.VardiyaDuzeltme,
            sonIslem = k.SonIslem,
        })
        .OrderByDescending(x => x.toplam)
        .ToList();

        var tumSure = kisiler.SelectMany(k => k.IzinSure).ToList();
        return Ok(new
        {
            bas = b0,
            bit = b1.Date,
            genel = new
            {
                izinKarar = uzmanlar.Sum(x => x.izinOnay + x.izinRed),
                izinOrtSaat = Ort(tumSure),
                izinMedyanSaat = Medyan(tumSure),
                izin24Oran = tumSure.Count == 0 ? (double?)null : Math.Round(tumSure.Count(x => x <= 24) * 100.0 / tumSure.Count, 0),
                ikEvrak = uzmanlar.Sum(x => x.ikEvrak + x.fmEvrak),
                izinOnay = uzmanlar.Sum(x => x.izinOnay),
                onayBelgeli = uzmanlar.Sum(x => x.onayBelgeli),
                personelBelgeGerekli = uzmanlar.Sum(x => x.personelBelgeGerekli),
                personelBelgeYuklendi = uzmanlar.Sum(x => x.personelBelgeYuklendi),
                eksik = uzmanlar.Sum(x => x.eksik),
                eksikTamamlanan = uzmanlar.Sum(x => x.eksikTamamlanan),
                fmKarar = uzmanlar.Sum(x => x.fmOnay + x.fmRed),
                digerKarar = uzmanlar.Sum(x => x.avansKarar + x.avansOdeme + x.rotasyon + x.vardiyaDuzeltme),
                bekleyenIzin = bekleyen.Count,
                evrakSonraBekleyen = evrakSonra.Count,
                acikEksik = acikEksik.Count,
            },
            uzmanlar,
        });
    }
}

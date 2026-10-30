using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetici İşlemleri (12.10.2026, uygulama 1.7).
///
/// <para>
/// İzin Onayları ekranı Yönetici İşlemleri oldu: onay bekleyenlerin yanında
/// yöneticinin dahil olduğu bütün talepler süreçleriyle görünüyor. Önce
/// yönetici girdiği fazla mesaiyi bir daha göremiyordu: onay kimde, İK
/// onayladı mı, reddedildiyse neden — hiçbiri görünmüyordu.
/// </para>
///
/// <para>
/// Onay bekleyen listeleri değişmedi (İzinTalep/Mobil/Bekleyenler,
/// HaftalikIzin/Bekleyenler, Rotasyon/Mobil/Onaylar); burası yalnızca
/// süreç: kategori kategori (izin, fazla mesai, avans) son günlerin
/// talepleri ve her talebin adımları.
/// </para>
///
/// <para>
/// Kapsam: fazla mesaide yöneticinin girdiği ya da birim/üst yöneticisi
/// olduğu kayıtlar; izinde birim ya da üst yöneticisi olduğu talepler;
/// avansta onay zincirinde adı geçtiği talepler. Kişinin kendi talepleri
/// burada değil, kendi ekranlarında.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "Personel")]
public class YoneticiIslemController : ControllerBase
{
    private const string IzinBekliyor = "Bekliyor";
    private const string IzinMagaza = "Mağaza Onayladı";
    private const string IzinBolge = "Bölge Onayladı";
    private const string IzinOnaylandi = "Onaylandı";
    private const string IzinReddedildi = "Reddedildi";

    private readonly VeritabaniServisi _vt;
    private readonly EkipServisi _ekip;
    private readonly OrgOnayServisi _org;
    private readonly ILogger<YoneticiIslemController> _kayit;

    public YoneticiIslemController(VeritabaniServisi vt, EkipServisi ekip, OrgOnayServisi org,
        ILogger<YoneticiIslemController> kayit)
    {
        _vt = vt;
        _ekip = ekip;
        _org = org;
        _kayit = kayit;
    }

    private string Sicil()
    {
        var ad = User?.Identity?.Name ?? "";
        if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return "";
        var govde = ad["personel:".Length..];
        var i = govde.IndexOf('|');
        return i < 0 ? govde : govde[..i];
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /* İstek içinde onaylayıcı önbelleği: aynı kişinin birden çok talebi
       için onay tablosu yeniden çözülmesin */
    private readonly Dictionary<string, (HashSet<string> Birim, HashSet<string> Ust)> _onaylayan = new();

    private (HashSet<string> Birim, HashSet<string> Ust) Onaylayanlar(string sicil, string gorev, string sube)
    {
        var anahtar = $"{K(sicil)}|{gorev}|{sube}";
        if (_onaylayan.TryGetValue(anahtar, out var v)) return v;

        try
        {
            var o = _org.Onaylayicilar(sicil, gorev, sube);
            v = ((o.Birim ?? new()).Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase),
                 (o.Ust ?? new()).Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase));
        }
        catch
        {
            v = (new HashSet<string>(), new HashSet<string>());
        }

        _onaylayan[anahtar] = v;
        return v;
    }

    /// <summary>Adım: ad, durum (tamam · bekliyor · red · atlandi · sirada), kim, tarih, not</summary>
    private static object Adim(string ad, string durum, string kim = null, DateTime? tarih = null, string not = null) =>
        new { ad, durum, kim, tarih, not };

    private static string KararDurumu(string karar) =>
        string.IsNullOrWhiteSpace(karar) ? null
        : karar.StartsWith("Red", StringComparison.OrdinalIgnoreCase) ? "red"
        : karar.StartsWith("Atla", StringComparison.OrdinalIgnoreCase) ? "atlandi"
        : "tamam";

    /// <summary>
    /// Yöneticinin dahil olduğu talepler ve süreçleri.
    /// </summary>
    /// <param name="gun">Kaç gün geriye (7–180). Süren talepler tarihten bağımsız gelir.</param>
    [HttpGet("Mobil/Surec")]
    public IActionResult Surec([FromQuery] int gun = 60)
    {
        var ben = _ekip.Kisi(Sicil());
        if (ben is null) return Unauthorized(new { hata = "Oturumunuz sona erdi." });

        gun = Math.Clamp(gun, 7, 180);
        var sinir = DateTime.Today.AddDays(-gun);

        using var db = _vt.Baglanti();

        return Ok(new
        {
            gun,
            fazlaMesai = Guvenli(() => FazlaMesailer(db, ben, sinir), "fazla mesai"),
            izin = Guvenli(() => Izinler(db, ben, sinir), "izin"),
            avans = Guvenli(() => Avanslar(db, ben, sinir), "avans"),
        });
    }

    private List<object> Guvenli(Func<List<object>> f, string ad)
    {
        try
        {
            return f();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yönetici işlemleri: {Ad} süreci alınamadı", ad);
            return new List<object>();
        }
    }

    /* ==================================================================== */
    /* Fazla mesai                                                          */
    /* ==================================================================== */

    private static readonly Dictionary<string, string> FmDurum = new()
    {
        ["form"] = "Birim yöneticisinin imzalı formu ve onayı bekleniyor",
        ["ust"] = "Üst yönetici onayında",
        ["bekliyor"] = "İnsan Kaynakları onayında",
        ["onaylandi"] = "Onaylandı",
        ["reddedildi"] = "Reddedildi",
        ["iptal"] = "İptal edildi",
    };

    private List<object> FazlaMesailer(System.Data.IDbConnection db, PersonelKaydi ben, DateTime sinir)
    {
        var benK = K(ben.PersonelKodu);

        var adaylar = db.Query(@"
SELECT TOP 400 * FROM KRY_FAZLA_MESAI
WHERE olusturma >= @sinir OR durum IN (N'form', N'ust', N'bekliyor')
ORDER BY olusturma DESC", new { sinir }).ToList();

        var sonuc = new List<object>();

        foreach (var r in adaylar)
        {
            if (K((string)r.personel_kodu) == benK) continue;

            var girdigim = K((string)r.talep_eden) == benK;
            var o = girdigim ? default : Onaylayanlar((string)r.personel_kodu, (string)r.gorev, (string)r.onay_sube ?? (string)r.sube);

            /* 14.10.2026: fazla mesaide üst aşama şubede her zaman bölge müdürü */
            if (!girdigim)
                try
                {
                    o = (o.Birim, _org.FazlaMesaiUst((string)r.personel_kodu, (string)r.gorev, (string)r.onay_sube ?? (string)r.sube, (string)r.sube)
                        .Select(x => K(x.PersonelKodu)).ToHashSet(StringComparer.OrdinalIgnoreCase));
                }
                catch { /* eski liste */ }
            var birim = !girdigim && o.Birim.Contains(benK);
            /* 14.10.2026: kurallı kayıtta adımların onaylayanları */
            var kAkis = FazlaMesaiKuralServisi.Oku((string)r.akis);
            var ust = !girdigim && !birim && (kAkis is not null
                ? kAkis.Adimlar.Any(a => (a.Siciller ?? new()).Contains(benK, StringComparer.OrdinalIgnoreCase))
                : o.Ust.Contains(benK));

            if (!girdigim && !birim && !ust) continue;

            string durum = (string)r.durum;
            string ustKarar = (string)r.ust_karar;
            var formVar = r.bolge_belge_id is not null;
            var asilVar = r.belge_id is not null;

            /* Adımlar: girildi → birim yöneticisi (imzalı form + onay) →
               üst yönetici → İnsan Kaynakları */
            var adimlar = new List<object>
            {
                Adim("Girildi", "tamam", (string)r.talep_eden_ad ?? (string)r.talep_eden, (DateTime)r.olusturma),
            };

            /* Birim aşaması */
            if (durum == "form")
                adimlar.Add(Adim("Birim yöneticisi", "bekliyor", null, null,
                    formVar ? "İmzalı form yüklendi, onay bekleniyor" : "İmzalı form yüklenmedi"));
            else if (durum == "reddedildi" && r.birim_onay is null && ustKarar is null)
                adimlar.Add(Adim("Birim yöneticisi", "red", (string)r.karar_veren, (DateTime?)r.karar_tarihi, (string)r.karar_notu));
            else if (durum == "iptal" && r.birim_onay is null && ustKarar is null)
                adimlar.Add(Adim("Birim yöneticisi", "sirada"));
            else
                adimlar.Add(Adim("Birim yöneticisi", "tamam", (string)r.birim_onay, (DateTime?)r.birim_onay_tarihi,
                    formVar ? "İmzalı form yüklendi" : null));

            /* Üst yönetici */
            var ustDurum = durum == "ust" ? "bekliyor" : KararDurumu(ustKarar) ?? "sirada";

            if (kAkis is not null)
            {
                /* Kurallı kayıt: kuraldaki her adım ayrı */
                for (var i = 0; i < kAkis.Adimlar.Count; i++)
                {
                    var a = kAkis.Adimlar[i];
                    var ad = a.Karar switch
                    {
                        "onay" => "tamam",
                        "red" => "red",
                        "atlandi" => "atlandi",
                        _ => durum == "ust" && i == kAkis.Asama ? "bekliyor" : "sirada",
                    };
                    adimlar.Add(Adim(a.Ad, ad, a.Kim ?? (a.Adlar is { Count: > 0 } ? string.Join(", ", a.Adlar.Take(2)) : null), a.Tarih, a.Not));
                }

                if (kAkis.Adimlar.Count > 0 && kAkis.Adimlar.All(a => a.Karar is "onay" or "atlandi")) ustDurum = "tamam";
            }
            else
                adimlar.Add(Adim("Üst yönetici", ustDurum, (string)r.ust_kisi, (DateTime?)r.ust_tarih, (string)r.ust_not));

            /* İK */
            var ikDurum = durum switch
            {
                "bekliyor" => "bekliyor",
                "onaylandi" => "tamam",
                "reddedildi" when ustDurum is "tamam" or "atlandi" => "red",
                _ => "sirada",
            };
            adimlar.Add(Adim("İnsan Kaynakları", ikDurum,
                ikDurum is "tamam" or "red" ? KararEtiketi.Kisi("İnsan Kaynakları", "ik", (string)r.karar_veren) : null,
                ikDurum is "tamam" or "red" ? (DateTime?)r.karar_tarihi : null,
                ikDurum == "bekliyor"
                    ? asilVar ? "Islak imzalı form İK'ya ulaştı" : "Islak imzalı formun aslı bekleniyor"
                    : ikDurum is "tamam" or "red" ? (string)r.karar_notu : null));

            int dk = (int)r.sure_dk;

            sonuc.Add(new
            {
                tip = "fazlamesai",
                id = (int)r.id,
                sicil = ((string)r.personel_kodu ?? "").Trim(),
                adSoyad = (string)r.ad_soyad,
                sube = (string)r.sube,
                gorev = (string)r.gorev,
                tarih = (DateTime)r.tarih,
                baslangic = (string)r.baslangic,
                bitis = (string)r.bitis,
                sureDk = dk,
                sure = FazlaMesaiAkisi.KisaSure(dk),
                aciklama = (string)r.aciklama,
                durum = durum switch
                {
                    "onaylandi" => "onaylandi",
                    "reddedildi" => "reddedildi",
                    "iptal" => "iptal",
                    _ => "surecte",
                },
                durumAdi = FmDurum.TryGetValue(durum ?? "", out var d) ? d : durum,
                girdigim,
                rol = girdigim ? "Siz girdiniz" : birim ? "Birim yöneticisisiniz" : "Üst yöneticisisiniz",
                giren = (string)r.talep_eden_ad,
                olusturma = (DateTime)r.olusturma,
                adimlar,
            });
        }

        return sonuc;
    }

    /* ==================================================================== */
    /* İzin                                                                 */
    /* ==================================================================== */

    private List<object> Izinler(System.Data.IDbConnection db, PersonelKaydi ben, DateTime sinir)
    {
        var benK = K(ben.PersonelKodu);

        var adaylar = db.Query(@"
SELECT TOP 500 * FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND (olusturma >= @sinir OR durum IN (@b, @m, @bo))
ORDER BY olusturma DESC", new { sinir, b = IzinBekliyor, m = IzinMagaza, bo = IzinBolge }).ToList();

        var sonuc = new List<object>();

        /* 26.10.2026: evrak bağlantıları (karar verdikten sonra da açılabilsin) */
        var evraklar = IzinEvrak.Evraklar(db, adaylar.Select(t => (int)t.id));

        foreach (var t in adaylar)
        {
            if (K((string)t.personel_kodu) == benK) continue;

            var o = Onaylayanlar((string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi);
            var birim = o.Birim.Contains(benK);
            var ust = !birim && o.Ust.Contains(benK);

            /* Zincirli talep (26.10.2026): zincirin kişi adımlarındaki onaylayan
               (bölge müdürü, GMY…) ya da talepte karar vermiş yönetici de görür */
            var zt = IzinOnayZinciri.Talepten((object)t);
            var zincirde = zt is { } z0 && IzinOnayZinciri.ZincirdeMi(z0.Zincir, ben.PersonelKodu);
            var kararVermis = IzinYoneticiFormu.KararVermisMi(ben, t);

            if (!birim && !ust && !zincirde && !kararVermis) continue;

            string durum = (string)t.durum;

            string Asama(string karar, bool sirasi) =>
                KararDurumu(karar) ?? (sirasi ? "bekliyor" : "sirada");

            List<object> adimlar;
            bool bende;
            string durumAdi;
            string rol;

            if (zt is { } z)
            {
                /* Zincirdeki gerçek adımlar */
                var bitti = durum is IzinOnaylandi or IzinReddedildi;
                adimlar = new List<object> { Adim("Talep", "tamam", (string)t.ad_soyad, (DateTime)t.olusturma) };

                for (var i = 0; i < z.Zincir.Adimlar.Count; i++)
                {
                    var a = z.Zincir.Adimlar[i];
                    var d = a.Karar == IzinOnayZinciri.KararOnay ? "tamam"
                        : a.Karar == IzinOnayZinciri.KararRed ? "red"
                        : a.Karar == IzinOnayZinciri.KararAtlandi ? "atlandi"
                        : !bitti && i == z.Asama ? "bekliyor"
                        : "sirada";
                    adimlar.Add(Adim(a.Ad, d, a.Kim is null ? null : KararEtiketi.Kisi(a.Ad, a.Tur, a.Kim), a.Tarih,
                        a.Karar == IzinOnayZinciri.KararAtlandi ? null : a.Not));
                }

                var sirada = bitti ? null : IzinOnayZinciri.AdimAl(z.Zincir, z.Asama);
                bende = sirada is not null && IzinOnayZinciri.KararVerebilir(z.Zincir, z.Asama, ben.PersonelKodu);
                durumAdi = sirada is null ? durum : $"{sirada.Ad} onayında";
                var benimAdimim = z.Zincir.Adimlar.FirstOrDefault(a => IzinOnayZinciri.SicilYetkili(a, ben.PersonelKodu));
                rol = benimAdimim is not null ? $"{benimAdimim.Ad} adımındasınız" : kararVermis ? "Karar verdiniz" : birim ? "Birim yöneticisisiniz" : "Üst yöneticisisiniz";
            }
            else
            {
                adimlar = new List<object>
                {
                    Adim("Talep", "tamam", (string)t.ad_soyad, (DateTime)t.olusturma),
                    Adim("Birim yöneticisi", Asama((string)t.magaza_karar, durum == IzinBekliyor),
                        (string)t.magaza_kisi, (DateTime?)t.magaza_tarih, (string)t.magaza_not),
                    Adim("Üst yönetici", Asama((string)t.bolge_karar, durum == IzinMagaza),
                        (string)t.bolge_kisi, (DateTime?)t.bolge_tarih, (string)t.bolge_not),
                    Adim("İnsan Kaynakları", Asama((string)t.ik_karar, durum == IzinBolge),
                        t.ik_kisi is null ? null : KararEtiketi.Kisi("İnsan Kaynakları", "ik", (string)t.ik_kisi), (DateTime?)t.ik_tarih, (string)t.ik_not),
                };

                /* Ret bir aşamada olduysa sonrakiler "sırada" değil, kapalı */
                var bekleyenAsama = durum == IzinBekliyor ? 1 : durum == IzinMagaza ? 2 : durum == IzinBolge ? 3 : 0;

                bende = (bekleyenAsama == 1 && birim) || (bekleyenAsama == 2 && ust);
                durumAdi = bekleyenAsama switch
                {
                    1 => "Birim yöneticisi onayında",
                    2 => "Üst yönetici onayında",
                    3 => "İnsan Kaynakları onayında",
                    _ => durum,
                };
                rol = birim ? "Birim yöneticisisiniz" : ust ? "Üst yöneticisisiniz" : "Karar verdiniz";
            }

            var ev = evraklar.GetValueOrDefault((int)t.id) ?? new List<IzinEvrak.Kayit>();
            var formBelgeId = ev.Where(e => e.Kalem == IzinEvrak.Form).Select(e => (int?)e.BelgeId).LastOrDefault();
            var raporMu = IzinEvrak.RaporluMu((string)t.tur) && ev.Any(e => e.Kalem == IzinEvrak.Destek);

            sonuc.Add(new
            {
                tip = "izin",
                id = (int)t.id,
                sicil = ((string)t.personel_kodu ?? "").Trim(),
                adSoyad = (string)t.ad_soyad,
                sube = (string)t.sube_adi,
                gorev = (string)t.gorev,
                tur = (string)t.tur,
                altTur = (string)t.alt_tur,
                cikisTarihi = (DateTime)t.cikis_tarihi,
                donusTarihi = (DateTime)t.donus_tarihi,
                gun = (decimal)t.gun,
                aciklama = (string)t.aciklama,
                durum = durum == IzinOnaylandi ? "onaylandi" : durum == IzinReddedildi ? "reddedildi" : "surecte",
                durumAdi,
                /* Benim onayımı mı bekliyor: kart "Onay bekleyenler"de de var */
                bende,
                rol,
                olusturma = (DateTime)t.olusturma,
                adimlar,

                /* 2.0 (26.10.2026): karar verildikten sonra da imzalı form / rapor /
                   evrak açılabilsin. Yetki uçlarda (FormGorebilir). */
                formVar = formBelgeId is not null || raporMu,
                formYolu = raporMu ? $"/api/IzinTalep/{(int)t.id}/Rapor"
                    : formBelgeId is not null ? IzinYoneticiFormu.FormYolu((int)t.id) : null,
                rapor = raporMu,
                evraklar = IzinYoneticiFormu.EvrakListesi((int)t.id, ev),
            });
        }

        return sonuc;
    }

    /* ==================================================================== */
    /* Avans                                                                */
    /* ==================================================================== */

    private List<object> Avanslar(System.Data.IDbConnection db, PersonelKaydi ben, DateTime sinir)
    {
        var benK = K(ben.PersonelKodu);

        var adaylar = db.Query(@"
SELECT TOP 400 id, personel_kodu, ad_soyad, sube, pozisyon, tutar, taksit, onay_tutar, onay_taksit,
       neden, olusturma, ISNULL(asama, 0) AS asama, zincir, durum
FROM KRY_AVANS
WHERE zincir IS NOT NULL AND (olusturma >= @sinir OR durum IN (N'bekliyor', N'belge'))
ORDER BY olusturma DESC", new { sinir }).ToList();

        var sonuc = new List<object>();

        /* 26.10.2026: belgeler (zincirdeki yönetici karar verdikten sonra da açar) */
        var belgeler = AvansOnayZinciri.Belgeler(db, adaylar.Select(a => (int)a.id));

        foreach (var a in adaylar)
        {
            if (K((string)a.personel_kodu) == benK) continue;

            var z = AvansOnayZinciri.Oku((string)a.zincir);
            if (z?.Adimlar is null || z.Adimlar.Count == 0) continue;
            if (!z.Adimlar.Any(x => AvansOnayZinciri.SicilYetkili(x, ben.PersonelKodu))) continue;

            string durum = (string)a.durum;
            int asama = (int)a.asama;

            var adimlar = new List<object>
            {
                Adim("Talep", "tamam", (string)a.ad_soyad, (DateTime)a.olusturma),
            };

            for (var i = 0; i < z.Adimlar.Count; i++)
            {
                var x = z.Adimlar[i];
                var d = x.Karar switch
                {
                    "onay" => "tamam",
                    "red" => "red",
                    "atlandi" => "atlandi",
                    _ => durum == "bekliyor" && i == asama ? "bekliyor" : "sirada",
                };
                adimlar.Add(Adim(x.Ad, d, (x.Kim ?? "").Replace(" (Biçen360)", "").Trim() is { Length: > 0 } kim ? KararEtiketi.Kisi(x.Ad, x.Tur, kim) : null, x.Tarih, x.Not));
            }

            var gecerli = durum == "bekliyor" && asama >= 0 && asama < z.Adimlar.Count ? z.Adimlar[asama] : null;

            sonuc.Add(new
            {
                tip = "avans",
                id = (int)a.id,
                sicil = ((string)a.personel_kodu ?? "").Trim(),
                adSoyad = (string)a.ad_soyad,
                sube = (string)a.sube,
                gorev = (string)a.pozisyon,
                tutar = (decimal?)a.onay_tutar ?? (decimal)a.tutar,
                talepTutar = (decimal)a.tutar,
                taksit = (int?)a.onay_taksit ?? (int)a.taksit,
                neden = (string)a.neden,
                durum = durum switch
                {
                    "onaylandi" or "odendi" => "onaylandi",
                    "reddedildi" => "reddedildi",
                    "iptal" => "iptal",
                    _ => "surecte",
                },
                durumAdi = durum switch
                {
                    "bekliyor" => gecerli is null ? "Onayda" : $"{gecerli.Ad} onayında",
                    "belge" => "Personelin belgesi bekleniyor",
                    "onaylandi" => "Onaylandı · ödeme bekliyor",
                    "odendi" => "Ödendi",
                    "reddedildi" => "Reddedildi",
                    "iptal" => "İptal edildi",
                    _ => durum,
                },
                bende = gecerli is not null && AvansOnayZinciri.SicilYetkili(gecerli, ben.PersonelKodu),
                olusturma = (DateTime)a.olusturma,
                adimlar,
                evraklar = belgeler.GetValueOrDefault((int)a.id) ?? new List<object>(),
            });
        }

        return sonuc;
    }
}

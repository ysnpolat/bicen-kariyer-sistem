using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Fazla mesai onay akışı (08.10.2026; 09.10.2026 sadeleştirildi).
///
/// <list type="number">
/// <item><b>form</b>: yönetici fazla mesaiyi girer; form şube mailine gider.
/// Çıktı imzalanır, birim yöneticisi imzalı formu Biçen360'tan yükler ve
/// İzin Onayları'ndan onaylar (form yüklenmeden onaylayamaz).</item>
/// <item><b>ust</b>: bölge müdürü (üst yönetici) formu görerek onaylar ya da
/// reddeder. Üst yönetici yoksa ya da formu o yüklediyse aşama atlanır.</item>
/// <item><b>bekliyor</b>: İK ıslak imzalı aslını alınca imzalayıp yükler ve
/// onaylar.</item>
/// </list>
///
/// Eski açıklama: yıllık izin talepleriyle aynı.
///
/// <para>
/// Onay zinciri izin talebindeki gibi organizasyon şemasından
/// (<see cref="OrgOnayServisi"/>): personelin birim yöneticisi (1. aşama),
/// üst yöneticisi (2. aşama, şubelerde bölge müdürü), son onay İnsan
/// Kaynakları.
/// </para>
///
/// <list type="bullet">
/// <item>Fazla mesaiyi yönetici giriyor: girmesi 1. aşamanın onayı sayılıyor.</item>
/// <item>Üst yönetici varsa kayıt "ust" durumunda onu bekliyor; Biçen360'ta
/// İzin Onayları ekranında izin talepleriyle birlikte görünüyor ve onaylıyor
/// ya da reddediyor. Giren zaten üst yöneticiyse ya da üst yönetici yoksa
/// aşama atlanıyor (izindeki gibi, kayda yazılıyor).</item>
/// <item>Ardından "bekliyor": İK ıslak imzalı formu yükleyip onaylıyor.</item>
/// </list>
///
/// <para>
/// Yayındaki uygulama (1.6) fazla mesai onay kartını tanımıyor: kayıt izin
/// talebi listesine eksi kimlikle ve izin kartının alanlarıyla ekleniyor
/// (tür "Fazla Mesai", saatler türün yanında, açıklamada süre ve neden).
/// Karar aynı uçtan geliyor; eksi kimlik buraya yönlendiriliyor.
/// </para>
/// </summary>
public static class FazlaMesaiAkisi
{
    public const string FormBekliyor = "form";
    public const string UstBekliyor = "ust";
    public const string IkBekliyor = "bekliyor";

    /// <summary>Mobil izin listesinde fazla mesai kimliği: -(1.000.000 + id)</summary>
    private const int Taban = 1_000_000;

    public static int MobilKimlik(int id) => -(Taban + id);

    public static int? KayitKimligi(int mobilKimlik) =>
        mobilKimlik <= -Taban && mobilKimlik > -AvansOnayZinciri.MobilTaban ? -mobilKimlik - Taban : null;

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string Ad(PersonelKaydi p) => $"{p.Ad} {p.Soyad}".Trim();

    /// <summary>Kaydın onaylayıcıları (izin talebiyle aynı kural)</summary>
    public static (List<PersonelKaydi> Birim, List<PersonelKaydi> Ust) Onaylayicilar(
        OrgOnayServisi org, string kod, string gorev, string sube, string isGrubu = null)
    {
        var (birim, _, _, _) = org.Onaylayicilar(kod, gorev, sube);
        /* 14.10.2026: üst aşama şubede her zaman bölge müdürü */
        var ust = org.FazlaMesaiUst(kod, gorev, sube, isGrubu);
        return (birim ?? new(), ust ?? new());
    }

    /// <summary>
    /// Yeni kaydın başlangıç aşaması. Giren 1. aşamayı (birim yöneticisi)
    /// onaylamış sayılır; üst yönetici yoksa ya da giren üst yöneticiyse
    /// doğrudan İK.
    /// </summary>
    public static (string Durum, string UstKarar, string UstNot, List<PersonelKaydi> Ust) Baslangic(
        OrgOnayServisi org, PersonelKaydi giren, PersonelKaydi hedef)
    {
        List<PersonelKaydi> ust;
        try
        {
            ust = Onaylayicilar(org, hedef.PersonelKodu, hedef.Pozisyon, hedef.Sube, hedef.IsGrubu).Ust
                .Where(x => K(x.PersonelKodu) != K(hedef.PersonelKodu))
                .ToList();
        }
        catch
        {
            ust = new();
        }

        if (ust.Any(x => K(x.PersonelKodu) == K(giren.PersonelKodu)))
            return (IkBekliyor, "Onaylandı", "Fazla mesaiyi üst yönetici girdi; aşama onaylı sayıldı.", ust);

        if (ust.Count == 0)
            return (IkBekliyor, "Atlandı", "Organizasyon şemasında üst yönetici yok; aşama atlandı.", ust);

        return (UstBekliyor, null, null, ust);
    }

    /// <summary>Üst yöneticilere "onayınızı bekliyor" bildirimi</summary>
    public static async Task UsteHaberVer(BildirimServisi bildirim, IEnumerable<PersonelKaydi> ust, string metin)
    {
        foreach (var x in ust)
        {
            try
            {
                await bildirim.Gonder((x.PersonelKodu ?? "").Trim(), "Fazla mesai onayınızı bekliyor", metin, "izinonay|fazlamesai");
            }
            catch
            {
                /* bildirim gitmese de kayıt İzin Onayları'nda */
            }
        }
    }

    public static string SureMetni(int dk) => IzinFormuServisi.SureMetni(dk);

    /// <summary>"3 sa 30 dk"</summary>
    public static string KisaSure(int dk) =>
        dk % 60 == 0 ? $"{dk / 60} sa" : dk < 60 ? $"{dk} dk" : $"{dk / 60} sa {dk % 60} dk";

    /// <summary>Birim yöneticisi aşamasında karar verebilir / form yükleyebilir: giren ya da onay tablosundaki birim yöneticisi</summary>
    public static bool BirimYoneticisiMi(OrgOnayServisi org, PersonelKaydi kisi, dynamic r)
    {
        if (kisi is null || r is null) return false;
        if (K((string)r.personel_kodu) == K(kisi.PersonelKodu)) return false;
        if (K((string)r.talep_eden) == K(kisi.PersonelKodu)) return true;
        try
        {
            string sube = (string)r.onay_sube ?? (string)r.sube;
            return org.KararVerebilir(kisi.PersonelKodu, (string)r.personel_kodu, (string)r.gorev, sube, 1);
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Üst yönetici aşamasında karar verebilir</summary>
    public static bool UstYoneticiMi(OrgOnayServisi org, PersonelKaydi kisi, dynamic r)
    {
        if (kisi is null || r is null) return false;
        if (K((string)r.personel_kodu) == K(kisi.PersonelKodu)) return false;

        /* 14.10.2026: kurallı kayıtta bekleyen adımın onaylayanları */
        if (FazlaMesaiKuralServisi.Oku((string)r.akis) is { } akis)
            return FazlaMesaiKuralServisi.Yetkili(akis, kisi.PersonelKodu);

        try
        {
            string sube = (string)r.onay_sube ?? (string)r.sube;
            return org.FazlaMesaiUst((string)r.personel_kodu, (string)r.gorev, sube, (string)r.sube)
                .Any(x => K(x.PersonelKodu) == K(kisi.PersonelKodu));
        }
        catch
        {
            return false;
        }
    }

    /// <summary>Mobilde yüklenen imzalı formu açma yolu (1.7 "Formu gör")</summary>
    public static string FormYolu(int id) => $"/api/FazlaMesai/{id}/ImzaliForm";

    /// <summary>
    /// Mobil İzin Onayları listesine eklenecek, bu kişinin işini bekleyen
    /// fazla mesailer: birim yöneticisi aşamasında (form yükle + onayla) ve
    /// üst yönetici aşamasında (formu gör + onayla). 1.6 izin kartı
    /// alanlarıyla; 1.7 "tip" alanına bakıp fazla mesai kartı gösteriyor.
    /// </summary>
    public static List<object> MobilBekleyenler(IDbConnection db, OrgOnayServisi org, PersonelKaydi kisi)
    {
        var sonuc = new List<object>();

        List<dynamic> adaylar;
        try
        {
            adaylar = db.Query(@"
SELECT id, personel_kodu, ad_soyad, sube, onay_sube, gorev, tarih, baslangic, bitis, sure_dk, aciklama,
       talep_eden, talep_eden_ad, olusturma, durum, bolge_belge_id, bolge_belge_yukleyen, akis
FROM KRY_FAZLA_MESAI WHERE durum IN (@f, @u) ORDER BY olusturma", new { f = FormBekliyor, u = UstBekliyor }).ToList();
        }
        catch
        {
            return sonuc;
        }

        foreach (var r in adaylar)
        {
            var formAsamasi = (string)r.durum == FormBekliyor;

            if (formAsamasi ? !BirimYoneticisiMi(org, kisi, r) : !UstYoneticiMi(org, kisi, r)) continue;

            var sure = SureMetni((int)r.sure_dk);
            var saat = $"{r.baslangic}–{r.bitis}";
            var formVar = r.bolge_belge_id is not null;
            var akis = FazlaMesaiKuralServisi.Oku((string)r.akis);

            var not = formAsamasi
                ? formVar
                    ? akis is not null
                        ? "✓ İmzalı form yüklendi; onaylayınca sıradaki onaya geçer. "
                        : "✓ İmzalı form yüklendi; onaylayınca bölge müdürüne geçer. "
                    : "⚠️ Önce imzalı formu yükleyin (Ana sayfa › \"Fazla mesai formunu yükleyin\" kartı › Evrakı yükle), sonra onaylayın. "
                : formVar
                    ? $"✓ İmzalı form yüklendi ({r.bolge_belge_yukleyen}). "
                    : "";

            sonuc.Add(new
            {
                id = MobilKimlik((int)r.id),
                personelKodu = (string)r.personel_kodu,
                adSoyad = (string)r.ad_soyad,
                subeAdi = (string)r.sube,
                gorev = (string)r.gorev,
                tur = "Fazla Mesai",
                altTur = (string)null,
                cikisTarihi = (DateTime)r.tarih,
                donusTarihi = (DateTime)r.tarih,
                gun = 1m,
                aciklama = not + $"{sure} fazla mesai ({saat}). Neden: {r.aciklama}",
                olusturma = (DateTime)r.olusturma,
                asama = formAsamasi ? 1 : 2,
                formBekleniyor = false,
                formBelgeId = (int?)null,
                magazaKisi = (string)r.talep_eden_ad ?? (string)r.talep_eden,
                magazaNot = formAsamasi ? "Fazla mesaiyi girdi" : "Girdi, imzalı formu yükleyip onayladı",
                magazaTarih = (DateTime?)r.olusturma,

                /* 1.7 */
                tip = "fazlamesai",
                fazlaMesaiId = (int)r.id,
                tarih = (DateTime)r.tarih,
                baslangic = (string)r.baslangic,
                bitis = (string)r.bitis,
                sure,
                sureKisa = KisaSure((int)r.sure_dk),
                neden = (string)r.aciklama,
                giren = (string)r.talep_eden_ad,
                /* Form (09.10.2026): birim aşamasında yükle, üst aşamada gör */
                formYukle = formAsamasi && !formVar,
                formYuklendi = formVar,
                formVar,
                formYolu = formVar ? FormYolu((int)r.id) : null,
                formYukleKimlik = MobilKimlik((int)r.id),
                asamaAdi = formAsamasi ? "Birim yöneticisi" : akis?.Gecerli?.Ad ?? "Bölge müdürü",
            });
        }

        return sonuc;
    }

    /// <summary>
    /// Mobil karar. Birim yöneticisi aşamasında form yüklenmeden onay yok;
    /// onayda kayıt üst yöneticiye (yoksa İK'ya) geçer. Üst yönetici
    /// aşamasında onay İK'ya geçirir. Ret kaydı kapatır.
    /// </summary>
    public static async Task<(int Kod, object Govde)> UstKarar(IDbConnection db, OrgOnayServisi org,
        BildirimServisi bildirim, PersonelKaydi kisi, int id, bool onay, string not, FazlaMesaiKuralServisi fmk = null)
    {
        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });

        if (r is null) return (404, new { hata = "Fazla mesai kaydı bulunamadı." });

        not = (not ?? "").Trim();
        if (!onay && not.Length < 3) return (400, new { hata = "Reddetme sebebini yazınız." });

        if ((string)r.durum == FormBekliyor)
        {
            if (!BirimYoneticisiMi(org, kisi, r)) return (403, new { hata = "Bu fazla mesai sizin onayınızı beklemiyor." });
            return await BirimKarari(db, org, bildirim, kisi, r, onay, not, fmk);
        }

        if ((string)r.durum != UstBekliyor || !UstYoneticiMi(org, kisi, r))
            return (400, new { hata = "Bu fazla mesai sizin onayınızı beklemiyor." });

        return await UstKararUygula(db, bildirim, id, onay, not, Ad(kisi), fmk, kisi.PersonelKodu);
    }

    /// <summary>Hedef personel (kayıttan)</summary>
    private static PersonelKaydi Hedef(dynamic r) => new()
    {
        PersonelKodu = ((string)r.personel_kodu ?? "").Trim(),
        Pozisyon = (string)r.gorev,
        Sube = (string)r.onay_sube ?? (string)r.sube,
        IsGrubu = (string)r.sube,
    };

    /// <summary>Kurallı kayıtta onaylamış siciller: giren, birim onaylayanı ve onaylanan adımlar</summary>
    private static List<string> Onaylamislar(dynamic r, FazlaMesaiKuralServisi.Akis akis, string ekSicil)
    {
        var l = new List<string> { (string)r.talep_eden, ekSicil };
        foreach (var a in akis.Adimlar.Where(x => x.Karar == "onay"))
            l.AddRange(a.Siciller ?? new());
        return l.Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
    }

    /// <summary>Bekleyen adımın onaylayanlarına "onayınızı bekliyor"</summary>
    private static async Task AdimaHaberVer(BildirimServisi bildirim, AvansOnayZinciri.Adim a, string metin)
    {
        foreach (var s in a?.Siciller ?? new())
        {
            try
            {
                await bildirim.Gonder(s, "Fazla mesai onayınızı bekliyor", metin, "izinonay|fazlamesai");
            }
            catch
            {
                /* kayıt İzin Onayları'nda */
            }
        }
    }

    /// <summary>Kurallı kayıtta birim yöneticisinin onayı: kuraldaki ilk adıma ya da İK'ya</summary>
    private static async Task<(int Kod, object Govde)> KuralliBirimOnayi(IDbConnection db, BildirimServisi bildirim,
        PersonelKaydi kisi, dynamic r, PersonelKaydi hedef, FazlaMesaiKuralServisi.Akis akis,
        FazlaMesaiKuralServisi fmk, string kim, string ozet)
    {
        int id = (int)r.id;

        int? j = fmk?.Ilerle(akis, hedef, Onaylamislar(r, akis, kisi.PersonelKodu));
        akis.Asama = j ?? akis.Adimlar.Count;
        var durum = j is null ? IkBekliyor : UstBekliyor;

        var etkilenen = db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET durum = @durum, akis = @akis,
    ust_karar = @karar, ust_kisi = @ustKisi, ust_tarih = CASE WHEN @karar IS NULL THEN NULL ELSE SYSDATETIME() END, ust_not = @ustNot,
    birim_onay = @kim, birim_onay_tarihi = SYSDATETIME()
WHERE id = @id AND durum = @f",
            new
            {
                id,
                durum,
                akis = FazlaMesaiKuralServisi.Json(akis),
                karar = j is null ? "Atlandı" : null,
                ustKisi = j is null ? "Sistem" : null,
                ustNot = j is null ? $"Kurala göre ara onay yok ({akis.Kural}); İK onayına geçti." : null,
                kim = kim.Length > 100 ? kim[..100] : kim,
                f = FormBekliyor,
            });

        if (etkilenen == 0) return (400, new { hata = "Bu fazla mesai zaten sonuçlanmış." });

        FormKartlariniKapat(db, id, "Birim yöneticisi onayladı");

        try
        {
            if (j is null)
                await bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Fazla mesai İK onayında",
                    $"{ozet} · {kim} onayladı", "fazlamesai");
            else
                await AdimaHaberVer(bildirim, akis.Gecerli, $"{ozet} · {kim} imzalı formu yükleyip onayladı");
        }
        catch { /* karar kayıtlı */ }

        var sonraki = j is null
            ? "İnsan Kaynakları onayına geçti"
            : $"{akis.Gecerli.Ad}{(akis.Gecerli.Adlar.Count > 0 ? $" ({string.Join(", ", akis.Gecerli.Adlar.Take(2))})" : "")} onayına geçti";

        return (200, new { basarili = true, durum = "Onaylandı", mesaj = $"Onaylandı; fazla mesai {sonraki}. Islak imzalı aslını İK'ya gönderin." });
    }

    /// <summary>Birim yöneticisinin kararı: onayda üst yöneticiye ya da İK'ya geçer</summary>
    private static async Task<(int Kod, object Govde)> BirimKarari(IDbConnection db, OrgOnayServisi org,
        BildirimServisi bildirim, PersonelKaydi kisi, dynamic r, bool onay, string not, FazlaMesaiKuralServisi fmk)
    {
        int id = (int)r.id;
        var kim = Ad(kisi);
        var ozet = $"{r.ad_soyad} · {((DateTime)r.tarih):dd.MM.yyyy} · {r.baslangic}–{r.bitis} ({SureMetni((int)r.sure_dk)})";

        if (!onay)
        {
            var n = db.Execute(@"
UPDATE KRY_FAZLA_MESAI SET durum = N'reddedildi', karar_veren = @kim, karar_tarihi = SYSDATETIME(), karar_notu = @not
WHERE id = @id AND durum = @f", new { id, kim, not = not.Length > 500 ? not[..500] : not, f = FormBekliyor });
            if (n == 0) return (400, new { hata = "Bu fazla mesai zaten sonuçlanmış." });

            FormKartlariniKapat(db, id, "Birim yöneticisi reddetti");

            try
            {
                if (K((string)r.talep_eden) != K(kisi.PersonelKodu))
                    await bildirim.Gonder((string)r.talep_eden, "Fazla mesai reddedildi", $"{ozet} · {kim}: {not}", "izinonay|fazlamesai");
            }
            catch { /* karar kayıtlı */ }

            return (200, new { basarili = true, durum = "Reddedildi", mesaj = "Fazla mesai reddedildi." });
        }

        if (r.bolge_belge_id is null)
            return (400, new
            {
                hata = "Önce imzalı fazla mesai formunu yükleyin. Ana sayfanızdaki \"Fazla mesai formunu yükleyin\" kartına dokunun, " +
                       "\"Evrakı yükle\" ile formun fotoğrafını çekin; sonra buradan onaylayın.",
            });

        var hedef = new PersonelKaydi
        {
            PersonelKodu = ((string)r.personel_kodu ?? "").Trim(),
            Pozisyon = (string)r.gorev,
            Sube = (string)r.onay_sube ?? (string)r.sube,
            IsGrubu = (string)r.sube,
        };

        /* 14.10.2026: kurallı kayıt kuraldaki adımlarla ilerler */
        if (FazlaMesaiKuralServisi.Oku((string)r.akis) is { } kAkis)
            return await KuralliBirimOnayi(db, bildirim, kisi, r, hedef, kAkis, fmk, kim, ozet);

        var akis = Baslangic(org, kisi, hedef);

        var etkilenen = db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET durum = @durum, ust_karar = @karar, ust_kisi = @ustKisi,
    ust_tarih = CASE WHEN @karar IS NULL THEN NULL ELSE SYSDATETIME() END, ust_not = @ustNot,
    birim_onay = @kim, birim_onay_tarihi = SYSDATETIME()
WHERE id = @id AND durum = @f",
            new
            {
                id,
                durum = akis.Durum,
                karar = akis.UstKarar,
                ustKisi = akis.UstKarar == "Onaylandı" ? kim : akis.UstKarar is null ? null : "Sistem",
                ustNot = akis.UstNot,
                kim = kim.Length > 100 ? kim[..100] : kim,
                f = FormBekliyor,
            });

        if (etkilenen == 0) return (400, new { hata = "Bu fazla mesai zaten sonuçlanmış." });

        FormKartlariniKapat(db, id, "Birim yöneticisi onayladı");

        try
        {
            if (akis.Durum == UstBekliyor)
                await UsteHaberVer(bildirim, akis.Ust, $"{ozet} · {kim} imzalı formu yükleyip onayladı");
            else
                await bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Fazla mesai İK onayında",
                    $"{ozet} · {kim} onayladı", "fazlamesai");
        }
        catch { /* karar kayıtlı */ }

        var sonraki = akis.Durum == UstBekliyor
            ? $"{string.Join(", ", akis.Ust.Take(2).Select(Ad))} onayına geçti"
            : "İnsan Kaynakları onayına geçti";

        return (200, new { basarili = true, durum = "Onaylandı", mesaj = $"Onaylandı; fazla mesai {sonraki}. Islak imzalı aslını İK'ya gönderin." });
    }

    /// <summary>Üst yönetici aşamasının kararı (mobil ya da panelde yönetici rolü)</summary>
    public static async Task<(int Kod, object Govde)> UstKararUygula(IDbConnection db, BildirimServisi bildirim,
        int id, bool onay, string not, string kim, FazlaMesaiKuralServisi fmk = null, string kimSicil = null)
    {
        var r = db.QueryFirstOrDefault(@"
SELECT id, ad_soyad, tarih, baslangic, bitis, sure_dk, talep_eden, personel_kodu, gorev, sube, onay_sube, akis, durum
FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
        if (r is null) return (404, new { hata = "Fazla mesai kaydı bulunamadı." });

        /* 14.10.2026: kurallı kayıtta adım adım */
        string akisJson = null;
        var kAkis = FazlaMesaiKuralServisi.Oku((string)r.akis);

        if (kAkis is not null && (string)r.durum == UstBekliyor)
        {
            var g = kAkis.Gecerli;

            if (g is not null)
            {
                g.Karar = onay ? "onay" : "red";
                g.Kim = kim;
                g.Tarih = DateTime.Now;
                g.Not = string.IsNullOrWhiteSpace(not) ? null : not;
            }

            if (onay)
            {
                var hedef = Hedef(r);
                int? j = fmk?.Ilerle(kAkis, hedef, Onaylamislar(r, kAkis, kimSicil));

                if (j is int sonraki)
                {
                    kAkis.Asama = sonraki;

                    var n = db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET akis = @akis, ust_karar = N'Onaylandı', ust_kisi = @kim, ust_tarih = SYSDATETIME(), ust_not = @not
WHERE id = @id AND durum = @ust",
                        new
                        {
                            id,
                            akis = FazlaMesaiKuralServisi.Json(kAkis),
                            kim = kim is { Length: > 100 } ? kim[..100] : kim,
                            not = string.IsNullOrWhiteSpace(not) ? null : (not.Length > 500 ? not[..500] : not),
                            ust = UstBekliyor,
                        });

                    if (n == 0) return (400, new { hata = "Bu fazla mesai zaten sonuçlanmış." });

                    var oz = $"{r.ad_soyad} · {((DateTime)r.tarih):dd.MM.yyyy} · {r.baslangic}–{r.bitis} ({SureMetni((int)r.sure_dk)})";
                    try
                    {
                        await AdimaHaberVer(bildirim, kAkis.Gecerli, $"{oz} · {kim} onayladı");
                    }
                    catch { /* karar kayıtlı */ }

                    return (200, new
                    {
                        basarili = true,
                        durum = "Onaylandı",
                        mesaj = $"Onaylandı; fazla mesai {kAkis.Gecerli.Ad} onayına geçti.",
                    });
                }

                kAkis.Asama = kAkis.Adimlar.Count;
            }

            akisJson = FazlaMesaiKuralServisi.Json(kAkis);
        }

        var etkilenen = db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET durum = @durum, ust_karar = @karar, ust_kisi = @kim, ust_tarih = SYSDATETIME(), ust_not = @not,
    akis = COALESCE(@akis, akis),
    karar_veren = CASE WHEN @onay = 1 THEN karar_veren ELSE @kim END,
    karar_tarihi = CASE WHEN @onay = 1 THEN karar_tarihi ELSE SYSDATETIME() END,
    karar_notu = CASE WHEN @onay = 1 THEN karar_notu ELSE @not END
WHERE id = @id AND durum = @ust",
            new
            {
                id,
                durum = onay ? IkBekliyor : "reddedildi",
                karar = onay ? "Onaylandı" : "Reddedildi",
                kim = kim is { Length: > 100 } ? kim[..100] : kim,
                not = string.IsNullOrWhiteSpace(not) ? null : (not.Length > 500 ? not[..500] : not),
                onay = onay ? 1 : 0,
                ust = UstBekliyor,
                akis = akisJson,
            });

        if (etkilenen == 0) return (400, new { hata = "Bu fazla mesai zaten sonuçlanmış." });

        FormKartlariniKapat(db, id, onay ? "Üst yönetici onayladı" : "Üst yönetici reddetti");

        var ozet = $"{r.ad_soyad} · {((DateTime)r.tarih):dd.MM.yyyy} · {r.baslangic}–{r.bitis} ({SureMetni((int)r.sure_dk)})";

        try
        {
            if (onay)
            {
                await bildirim.RoleGonder(new[] { Roller.IK, Roller.IKYoneticisi }, "Fazla mesai İK onayında", $"{ozet} · {kim} onayladı", "fazlamesai");
                if (!string.IsNullOrWhiteSpace((string)r.talep_eden))
                    await bildirim.Gonder((string)r.talep_eden, "Fazla mesai üst yönetici onayından geçti",
                        $"{ozet} · {kim} onayladı; İnsan Kaynakları onayında. Islak imzalı formu İK'ya göndermeyi unutmayın.", "izinonay|fazlamesai");
            }
            else if (!string.IsNullOrWhiteSpace((string)r.talep_eden))
                await bildirim.Gonder((string)r.talep_eden, "Fazla mesai reddedildi",
                    $"{ozet} · {kim}: {not}", "izinonay|fazlamesai");
        }
        catch
        {
            /* bildirim gitmese de karar kayıtlı */
        }

        return (200, new { basarili = true, durum = onay ? "Bölge Onayladı" : "Reddedildi" });
    }

    /* ================================================================== */
    /* İmzalı form: birim yöneticisi yükler (09.10.2026)                   */
    /* ================================================================== */

    /// <summary>Ana sayfa kartının kaynağı (KRY_TALEP_EKSIK.gonderen)</summary>
    public const string FormKaynak = "sistem:fmform";

    /// <summary>
    /// Birim yöneticisi aşamasında formu yüklenmemiş fazla mesailer için ana
    /// sayfada "Fazla mesai formunu yükleyin" kartı (yoksa açılır). Yayındaki
    /// 1.6 bu kartın evrak penceresiyle yüklüyor. Aşaması geçmiş kayıtların
    /// kartları kapatılır.
    /// </summary>
    public static void FormKartlariniHazirla(IDbConnection db, OrgOnayServisi org, PersonelKaydi kisi)
    {
        if (kisi is null || org is null) return;

        try
        {
            db.Execute(@"
UPDATE e SET durum = N'kapandi', kapandi = SYSDATETIME(), kapatan = N'Biçen360', kapanis_notu = N'Aşama geçti'
FROM KRY_TALEP_EKSIK e
INNER JOIN KRY_FAZLA_MESAI f ON f.id = e.talep_id
WHERE e.tur = N'fazlamesai' AND e.gonderen = @kaynak AND e.durum <> N'kapandi'
  AND (f.durum <> @f OR f.bolge_belge_id IS NOT NULL)", new { kaynak = FormKaynak, f = FormBekliyor });

            var adaylar = db.Query(@"
SELECT f.* FROM KRY_FAZLA_MESAI f
WHERE f.durum = @f AND f.bolge_belge_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM KRY_TALEP_EKSIK e
                  WHERE e.tur = N'fazlamesai' AND e.talep_id = f.id AND e.gonderen = @kaynak
                    AND LTRIM(RTRIM(e.hedef_kodu)) = @kod)", new { f = FormBekliyor, kaynak = FormKaynak, kod = kisi.PersonelKodu.Trim() }).ToList();

            foreach (var r in adaylar)
            {
                if (!BirimYoneticisiMi(org, kisi, r)) continue;

                var ozet = $"{r.ad_soyad} · {((DateTime)r.tarih):dd.MM.yyyy} · {r.baslangic}–{r.bitis} ({SureMetni((int)r.sure_dk)})";

                db.Execute(@"
INSERT INTO KRY_TALEP_EKSIK (tur, talep_id, personel_kodu, ad_soyad, hedef_kodu, hedef_ad, talep_ozet, maddeler,
                             aciklama, son_tarih, gonderen, gonderen_ad, jeton_var)
VALUES (N'fazlamesai', @id, @pkod, @pad, @kod, @ad, @ozet, @madde, @aciklama, @son, @kaynak, N'Biçen360', 1)",
                    new
                    {
                        id = (int)r.id,
                        pkod = ((string)r.personel_kodu ?? "").Trim(),
                        pad = (string)r.ad_soyad,
                        kod = kisi.PersonelKodu.Trim(),
                        ad = Ad(kisi),
                        ozet = ozet.Length > 200 ? ozet[..200] : ozet,
                        madde = "Çalışan, birim yöneticisi ve bölge müdürü imzalı fazla mesai formu",
                        aciklama = "Şubeye maille gelen formu çalışana ve bölge müdürüne imzalatın, siz de imzalayın. \"Evrakı yükle\" › \"İmzalı formu yükleyin\" ile formun fotoğrafını çekin. " +
                                   "Sonra İzin Onayları'ndan onaylayın; kayıt bölge müdürüne, ardından İnsan Kaynakları'na geçer. Islak imzalı aslını İK'ya gönderin.",
                        son = ((DateTime)r.tarih).Date.AddDays(3),
                        kaynak = FormKaynak,
                    });
            }
        }
        catch
        {
            /* tablo yoksa kart açılmaz; onay ekranındaki not yine yol gösterir */
        }
    }

    public static void FormKartlariniKapat(IDbConnection db, int id, string not)
    {
        try
        {
            db.Execute(@"
UPDATE KRY_TALEP_EKSIK
SET durum = N'kapandi', kapandi = SYSDATETIME(), tamamlandi = COALESCE(tamamlandi, SYSDATETIME()),
    kapatan = N'Biçen360', kapanis_notu = @not
WHERE tur = N'fazlamesai' AND talep_id = @id AND gonderen = @kaynak AND durum <> N'kapandi'",
                new { id, not, kaynak = FormKaynak });
        }
        catch
        {
            /* tablo yoksa geçilir */
        }
    }

    /// <summary>Bu kişi kaydın imzalı formunu yükleyebilir mi (birim yöneticisi aşamasında)</summary>
    public static bool FormYukleyebilir(OrgOnayServisi org, PersonelKaydi kisi, dynamic r) =>
        r is not null && (string)r.durum == FormBekliyor && BirimYoneticisiMi(org, kisi, r);

    /// <summary>Formu görebilir mi: giren, birim yöneticisi ya da üst yönetici</summary>
    public static bool FormGorebilir(OrgOnayServisi org, PersonelKaydi kisi, dynamic r) =>
        r is not null && kisi is not null &&
        (K((string)r.talep_eden) == K(kisi.PersonelKodu) || BirimYoneticisiMi(org, kisi, r) || UstYoneticiMi(org, kisi, r));

    /// <summary>
    /// 1.6 evrak penceresinin beklediği nesne (ana sayfadaki eksik kartı).
    /// Kimlik eksi (MobilKimlik): yükleme ve "Formu aç" izin uçlarına gidiyor,
    /// oradan fazla mesaiye yönleniyor.
    /// </summary>
    public static object EvrakNesnesi(IDbConnection db, int id)
    {
        var r = db.QueryFirstOrDefault(@"
SELECT id, ad_soyad, tarih, durum, bolge_belge_id FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
        if (r is null || (string)r.durum != FormBekliyor) return null;

        var son = ((DateTime)r.tarih).Date.AddDays(3);
        var yuklendi = r.bolge_belge_id is not null;

        return new
        {
            id = MobilKimlik(id),
            tur = "Fazla Mesai",
            altTur = (string)r.ad_soyad,
            formBekleniyor = false,
            cikis = (DateTime)r.tarih,
            donus = (DateTime)r.tarih,
            son,
            kalanSaat = (int)Math.Max(0, Math.Floor((son - DateTime.Now).TotalHours)),
            gecikti = false,
            tamam = yuklendi,
            belgeGerekli = false,
            /* Aslının gönderimi ayrıca işaretlenmiyor: son adım tamam görünsün */
            asilGonderildi = true,
            gerekenler = new[]
            {
                new { kalem = "form", ad = "İmzalı fazla mesai formu", yuklendi, dosyalar = new List<string>() },
            },
        };
    }
}

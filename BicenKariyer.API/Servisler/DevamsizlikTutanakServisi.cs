using System.Globalization;
using System.Net;
using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Devamsızlık tutanağı (26.10.2026).
///
/// <para>
/// Birim yöneticisi Biçen360'tan devamsızlık girerken açıklama yazıp iki
/// şahit personel seçiyor. Kayıt hemen işleniyor (puantaj, rapor); tutanak
/// ayrıca üretilip izin formundaki kurala göre mail gidiyor (şube personeli
/// → şube maili, genel merkez → İK, kişisel adres tanımlıysa girenin
/// kendisi). Giren imzalı tutanağı uygulamadan yüklüyor; şahitler
/// uygulamadan "Onaylıyorum / Onaylamıyorum" diyor. Durum
/// (<see cref="Durum"/>) kayıtta ve İK panelinde görünüyor.
/// </para>
///
/// <para>
/// Form A4 HTML; mail eki olarak sunucudaki tarayıcıyla PDF'e çevriliyor
/// (TarayiciPdf), olmazsa HTML gidiyor. PDF personelin belgelerine
/// "Devamsızlık Tutanağı" olarak da yazılıyor.
/// </para>
/// </summary>
public class DevamsizlikTutanakServisi
{
    public const string BelgeTuru = "Devamsızlık Tutanağı";

    public const string SahitBekliyor = "bekliyor";
    public const string SahitOnayladi = "onayladi";
    public const string SahitReddetti = "reddetti";

    /// <summary>Tutanak durumları</summary>
    public const string DurumBelge = "belge";      /* imzalı tutanak bekleniyor */
    public const string DurumSahit = "sahit";      /* şahit onayı bekleniyor */
    public const string DurumItiraz = "itiraz";    /* bir şahit onaylamadı */
    public const string DurumTamam = "tamam";

    public static readonly Dictionary<string, string> DurumAdlari = new()
    {
        [DurumBelge] = "İmzalı tutanak bekleniyor",
        [DurumSahit] = "Şahit onayı bekleniyor",
        [DurumItiraz] = "Şahit onaylamadı",
        [DurumTamam] = "Tamamlandı",
    };

    private readonly VeritabaniServisi _vt;
    private readonly IzinFormuServisi _izinFormu;
    private readonly MailServisi _mail;
    private readonly BildirimServisi _bildirim;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<DevamsizlikTutanakServisi> _kayit;

    public DevamsizlikTutanakServisi(VeritabaniServisi vt, IzinFormuServisi izinFormu, MailServisi mail,
        BildirimServisi bildirim, IConfiguration yapilandirma, IWebHostEnvironment ortam,
        ILogger<DevamsizlikTutanakServisi> kayit)
    {
        _vt = vt;
        _izinFormu = izinFormu;
        _mail = mail;
        _bildirim = bildirim;
        _yapilandirma = yapilandirma;
        _ortam = ortam;
        _kayit = kayit;
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    private static string H(object v) => WebUtility.HtmlEncode(Convert.ToString(v, Tr) ?? "");

    public static string TutanakNo(int id, DateTime olusturma) => $"DVM-{olusturma:yyyy}-{id:0000}";

    /* ================================================================== */
    /* Durum                                                              */
    /* ================================================================== */

    /// <summary>
    /// Tutanağın durumu: önce şahit itirazı, sonra imzalı belge, sonra
    /// şahit onayı; ikisi de tamamsa "tamam". Belge ve şahit onayı
    /// birbirinden bağımsız; sıra yalnızca ekranda ne gösterileceğini seçer.
    /// </summary>
    public static string Durum(dynamic t)
    {
        string s1 = t.sahit1_durum ?? SahitBekliyor, s2 = t.sahit2_durum ?? SahitBekliyor;
        if (s1 == SahitReddetti || s2 == SahitReddetti) return DurumItiraz;
        var belgeVar = !string.IsNullOrWhiteSpace((string)t.belge_dosya);
        if (!belgeVar) return DurumBelge;
        if (s1 != SahitOnayladi || s2 != SahitOnayladi) return DurumSahit;
        return DurumTamam;
    }

    /// <summary>Mobil ve panel için ortak çıktı</summary>
    public static object Nesne(dynamic t)
    {
        string durum = Durum(t);
        return new
        {
            id = (int)t.id,
            no = TutanakNo((int)t.id, (DateTime)t.olusturma),
            personelKodu = ((string)t.personel_kodu ?? "").Trim(),
            adSoyad = (string)t.ad_soyad,
            sube = (string)t.sube,
            pozisyon = (string)t.pozisyon,
            tarihBas = (DateTime)t.tarih_bas,
            tarihBit = (DateTime)t.tarih_bit,
            tarihler = (string)t.tarihler,
            aciklama = (string)t.aciklama,
            giren = ((string)t.giren ?? "").Trim(),
            girenAd = (string)t.giren_ad,
            girenPozisyon = (string)t.giren_pozisyon,
            sahitler = new[]
            {
                new { sira = 1, kod = ((string)t.sahit1_kodu ?? "").Trim(), adSoyad = (string)t.sahit1_ad, pozisyon = (string)t.sahit1_pozisyon, durum = (string)t.sahit1_durum, tarih = (DateTime?)t.sahit1_tarih, not = (string)t.sahit1_not },
                new { sira = 2, kod = ((string)t.sahit2_kodu ?? "").Trim(), adSoyad = (string)t.sahit2_ad, pozisyon = (string)t.sahit2_pozisyon, durum = (string)t.sahit2_durum, tarih = (DateTime?)t.sahit2_tarih, not = (string)t.sahit2_not },
            },
            formEposta = (string)t.form_eposta,
            formGonderim = (DateTime?)t.form_gonderim,
            formHata = (string)t.form_hata,
            belgeVar = !string.IsNullOrWhiteSpace((string)t.belge_dosya),
            belgeTarihi = (DateTime?)t.belge_tarihi,
            belgeYukleyen = (string)t.belge_yukleyen,
            durum,
            durumAdi = DurumAdlari.GetValueOrDefault(durum, durum),
            iptal = (bool)t.iptal,
            olusturma = (DateTime)t.olusturma,
        };
    }

    /* ================================================================== */
    /* Gönderim                                                           */
    /* ================================================================== */

    /// <summary>
    /// Tutanağı doldurup mail gönderir; sonucu tutanağa yazar. Hata
    /// fırlatmaz: devamsızlık kaydı tutanak gitmese de geçerlidir.
    /// </summary>
    public async Task<(bool Basarili, string Adres, string Hata)> GonderAsync(int tutanakId, PersonelKaydi personel)
    {
        dynamic t;
        try
        {
            using var db = _vt.Baglanti();
            t = db.QueryFirstOrDefault("SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK WHERE id = @id", new { id = tutanakId });
            if (t is null) return (false, null, "Tutanak bulunamadı.");
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Devamsızlık tutanağı okunamadı: {Id}", tutanakId);
            return (false, null, hata.Message);
        }

        var (adresler, aciklama) = _izinFormu.Alicilar(personel);
        var adres = string.Join(", ", adresler);

        string hataMetni = null;
        var basarili = false;

        try
        {
            string form = FormHtml(t);
            string govde = MailGovdesi(t, aciklama);
            string no = TutanakNo((int)t.id, (DateTime)t.olusturma);
            string konu = $"Devamsızlık tutanağı · {(string)t.ad_soyad} · {(string)t.tarihler}";
            string dosyaKoku = $"Devamsizlik-Tutanagi-{no}";

            var (pdf, pdfHata) = await TarayiciPdf.DonusturAsync(form, _yapilandirma, _kayit);

            var ek = pdf is not null
                ? ($"{dosyaKoku}.pdf", pdf)
                : ($"{dosyaKoku}.html", Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(form)).ToArray());

            basarili = await _mail.GonderAsync(adresler, konu, govde, ekler: new[] { ek });

            if (!basarili) hataMetni = _mail.SonHataMesaji ?? "Mail gönderilemedi.";
            else if (pdf is null) hataMetni = $"Tutanak HTML olarak gönderildi: {pdfHata}";

            if (pdf is not null) BelgeyeKaydet(t, personel, pdf, $"{dosyaKoku}.pdf");
        }
        catch (Exception hata)
        {
            hataMetni = hata.Message;
            _kayit.LogError(hata, "Devamsızlık tutanağı gönderilemedi: {Id}", tutanakId);
        }

        try
        {
            using var db = _vt.Baglanti();
            db.Execute(@"
UPDATE KRY_DEVAMSIZLIK_TUTANAK
SET form_eposta = @adres,
    form_gonderim = CASE WHEN @basarili = 1 THEN SYSDATETIME() ELSE form_gonderim END,
    form_hata = @hata
WHERE id = @id",
                new
                {
                    id = tutanakId,
                    adres = adres.Length > 400 ? adres[..400] : adres,
                    basarili,
                    hata = hataMetni is null ? null : (hataMetni.Length > 500 ? hataMetni[..500] : hataMetni),
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Tutanak gönderim sonucu yazılamadı: {Id}", tutanakId);
        }

        return (basarili, adres, hataMetni);
    }

    /// <summary>
    /// Doldurulmuş tutanağı devamsız personelin belgelerine yazar
    /// (personele kapalı). Aynı tutanağın önceki kopyası silinmiş sayılır.
    /// </summary>
    private void BelgeyeKaydet(dynamic t, PersonelKaydi p, byte[] pdf, string ozgunAd)
    {
        try
        {
            int id = (int)t.id;
            var kod = ((string)t.personel_kodu ?? "").Trim();
            var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
            var diskAdi = $"{kod}_dvmtutanak{id}_{Guid.NewGuid():N}.pdf";

            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);
            File.WriteAllBytes(Path.Combine(klasor, diskAdi), pdf);

            var aciklama = $"Devamsızlık tutanağı #{id} · otomatik doldurulan form";

            using var db = _vt.Baglanti();

            db.Execute(@"
UPDATE KRY_PERSONEL_BELGE SET silindi = 1, silen = N'sistem', silme_tarihi = SYSDATETIME()
WHERE personel_kodu = @kod AND aciklama = @aciklama AND silindi = 0", new { kod, aciklama });

            db.Execute(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama, dosya, ozgun_ad, boyut, yukleyen, personele_acik)
VALUES (@kod, @kimlik, @adSoyad, @tur, @baslik, @aciklama, @diskAdi, @ozgunAd, @boyut, N'sistem', 0)",
                new
                {
                    kod,
                    kimlik = string.IsNullOrWhiteSpace(p?.KimlikNo) ? null : p.KimlikNo.Trim(),
                    adSoyad = (string)t.ad_soyad,
                    tur = BelgeTuru,
                    baslik = $"Devamsızlık tutanağı · {(string)t.tarihler}",
                    aciklama,
                    diskAdi,
                    ozgunAd,
                    boyut = pdf.LongLength,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Devamsızlık tutanağı belgelere kaydedilemedi");
        }
    }

    /// <summary>İmzalı tutanağı personel kartına belge olarak ekler (personele kapalı).</summary>
    public void ImzaliBelgeyeKaydet(dynamic t, string diskAdi, string ozgunAd, long boyut, string yukleyen)
    {
        try
        {
            using var db = _vt.Baglanti();
            db.Execute(@"
INSERT INTO KRY_PERSONEL_BELGE (personel_kodu, ad_soyad, tur, baslik, aciklama, dosya, ozgun_ad, boyut, yukleyen, personele_acik)
VALUES (@kod, @ad, @tur, @baslik, @aciklama, @diskAdi, @ozgun, @boyut, @yukleyen, 0)",
                new
                {
                    kod = ((string)t.personel_kodu ?? "").Trim(),
                    ad = (string)t.ad_soyad,
                    tur = BelgeTuru,
                    baslik = $"İmzalı devamsızlık tutanağı · {(string)t.tarihler}",
                    aciklama = $"Devamsızlık tutanağı #{(int)t.id} · imzalı",
                    diskAdi,
                    ozgun = ozgunAd,
                    boyut,
                    yukleyen,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İmzalı tutanak personel belgelerine eklenemedi");
        }
    }

    /// <summary>Şahitlere Biçen360 bildirimi ve uygulama içi duyuru</summary>
    public async Task SahitlereBildir(dynamic t)
    {
        int id = (int)t.id;
        string baslik = "Devamsızlık tutanağı · şahitlik onayı";
        string metin = $"{(string)t.ad_soyad} · {(string)t.tarihler} · {(string)t.giren_ad} sizi şahit olarak seçti. Tutanağı inceleyip onaylayın.";

        var kodlar = new[] { ((string)t.sahit1_kodu ?? "").Trim(), ((string)t.sahit2_kodu ?? "").Trim() }
            .Where(x => x.Length > 0).Distinct().ToList();

        try
        {
            await _bildirim.KisiyeOzelGonder(kodlar.Select(k => (k, baslik, metin)), $"devamsizliktutanak|{id}");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şahit bildirimi gönderilemedi: {Id}", id);
        }

        /* Uygulama içi: duyurularda da dursun; bildirimi kaçıran görür */
        try
        {
            using var db = _vt.Baglanti();
            foreach (var k in kodlar)
                db.Execute(@"
INSERT INTO KRY_MOBIL_DUYURU (baslik, metin, personel_kodu, gonderen)
VALUES (@baslik, @metin, @kod, @gonderen)", new { baslik, metin, kod = k, gonderen = (string)t.giren_ad ?? "sistem" });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şahit duyurusu yazılamadı: {Id}", id);
        }
    }

    /* ================================================================== */
    /* Mail gövdesi                                                       */
    /* ================================================================== */

    private string MailGovdesi(dynamic t, string aliciAciklama)
    {
        string Satir(string ad, string deger) => string.IsNullOrWhiteSpace(deger) ? "" : $"""
<tr><td style="padding:7px 12px;border-bottom:1px solid #E3E6E1;color:#6B7280;font-size:13px;width:150px">{H(ad)}</td>
<td style="padding:7px 12px;border-bottom:1px solid #E3E6E1;color:#1F2933;font-size:13px;font-weight:600">{H(deger)}</td></tr>
""";

        string no = TutanakNo((int)t.id, (DateTime)t.olusturma);

        return $"""
<!doctype html><html lang="tr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F4F6F2;font-family:'Segoe UI',Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E3E6E1;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:3px solid #b42318">
<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#b42318">İNSAN KAYNAKLARI · DEVAMSIZLIK TUTANAĞI</div>
<div style="font-size:20px;font-weight:800;color:#1F2933;margin-top:4px">{H((string)t.ad_soyad)} · {H((string)t.tarihler)}</div>
<p style="font-size:14px;line-height:1.6;color:#374151;margin:10px 0 0">
Biçen360 uygulamasından devamsızlık girildi. Doldurulmuş tutanak ektedir: <b>ekteki dosyayı yazdırın</b>,
devamsızlığı giren yönetici ve iki şahit imzalasın. İmzalı tutanağın fotoğrafını ya da taramasını
<b>devamsızlığı giren yönetici Biçen360 ana sayfasındaki "İmzalı tutanağı yükleyin" kartından</b> yükler;
şahitler ayrıca uygulamadan onaylar.
</p>
</td></tr>
<tr><td style="padding:14px 24px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E6E1;border-radius:8px">
{Satir("Personel", (string)t.ad_soyad)}
{Satir("Şube / Görev", $"{(string)t.sube} · {(string)t.pozisyon}")}
{Satir("Devamsız günler", (string)t.tarihler)}
{Satir("Açıklama", (string)t.aciklama)}
{Satir("Giren yönetici", $"{(string)t.giren_ad} · {(string)t.giren_pozisyon}")}
{Satir("1. şahit", $"{(string)t.sahit1_ad} · {(string)t.sahit1_pozisyon}")}
{Satir("2. şahit", $"{(string)t.sahit2_ad} · {(string)t.sahit2_pozisyon}")}
{Satir("Tutanak no", $"{no} · {(DateTime)t.olusturma:dd.MM.yyyy HH:mm}")}
</table>
</td></tr>
<tr><td style="padding:12px 24px 22px;font-size:12px;color:#6B7280;line-height:1.6">
Bu mail otomatik gönderildi · {H(aliciAciklama)}.<br>
Ek açılmazsa tutanağı İK panelinde Personel Talepleri › Devamsızlık › kişi ayrıntısından da yazdırabilirsiniz.
</td></tr>
</table>
</td></tr>
</table>
</body></html>
""";
    }

    /* ================================================================== */
    /* A4 tutanak                                                         */
    /* ================================================================== */

    /// <summary>Panelden ve mobilden görüntüleme için tutanağın kendisi.</summary>
    public string FormHtmlGetir(int id)
    {
        using var db = _vt.Baglanti();
        var t = db.QueryFirstOrDefault("SELECT * FROM KRY_DEVAMSIZLIK_TUTANAK WHERE id = @id", new { id });
        return t is null ? null : FormHtml(t);
    }

    private static string SahitDurumu(string durum, DateTime? tarih) => durum switch
    {
        SahitOnayladi => $"Uygulamadan onayladı · {tarih:dd.MM.yyyy HH:mm}",
        SahitReddetti => $"Uygulamadan onaylamadı · {tarih:dd.MM.yyyy HH:mm}",
        _ => "Uygulama onayı bekleniyor",
    };

    /// <summary>Doldurulmuş A4 tutanak</summary>
    public static string FormHtml(dynamic t)
    {
        int id = (int)t.id;
        DateTime olusturma = (DateTime)t.olusturma;
        string no = TutanakNo(id, olusturma);
        DateTime bas = (DateTime)t.tarih_bas, bit = (DateTime)t.tarih_bit;
        int gunSayisi = ((string)t.tarihler ?? "").Split(',').Count(x => x.Trim().Length > 0);

        string ImzaKutusu(string baslik, string ad, string pozisyon, string alt) => $"""
<div class="imza"><b>{H(baslik)}</b><div class="ad">{H(ad)}</div><div class="poz">{H(pozisyon)}</div>
<div class="alt">{H(alt)}</div><div class="cizgi"><span>İmza</span></div><div class="cizgi"><span>Tarih</span></div></div>
""";

        return $$"""
<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{H(no)}} · Devamsızlık Tutanağı</title>
<style>
@page{size:A4;margin:14mm}
body{font-family:"Segoe UI",Arial,sans-serif;color:#111;margin:0;background:#f3f4f1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.a4{max-width:794px;margin:16px auto;background:#fff;padding:36px 42px;font-size:13px;box-shadow:0 6px 30px #0002}
.bas{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px}
.logo{font-weight:900;font-size:22px;letter-spacing:.5px;color:#4a6e0c}
h1{font-size:18px;margin:16px 0 4px;text-align:center;letter-spacing:.04em}
.altb{text-align:center;color:#555;font-size:11.5px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;margin:8px 0 14px}
td,th{border:1px solid #333;padding:7px 9px;text-align:left;vertical-align:top}
th{background:#f1f3ee;width:30%;font-weight:700}
.beyan{border:1px solid #333;padding:10px 12px;font-size:12.5px;line-height:1.6;margin-bottom:16px;background:#fafbf8}
.imzalar{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.imza{border:1px solid #333;min-height:150px;padding:8px 10px;display:flex;flex-direction:column;gap:3px;font-size:11.5px}
.imza b{font-size:11px;letter-spacing:.04em;color:#4a6e0c}
.imza .ad{font-weight:800;font-size:13px}
.imza .poz{color:#555}
.imza .alt{color:#777;font-size:10.5px;margin-top:2px}
.cizgi{margin-top:auto;border-bottom:1px solid #333;padding-top:22px;font-size:10.5px;color:#555}
.cizgi+.cizgi{padding-top:14px}
.dip{margin-top:12px;font-size:10.5px;color:#666;display:flex;justify-content:space-between;gap:10px}
.yazdir{display:block;margin:12px auto 0;padding:10px 22px;border:0;border-radius:10px;background:#5f8c10;color:#fff;font-weight:700;font-size:15px}
@media print{body{background:#fff}.a4{box-shadow:none;margin:0;padding:0;max-width:none}.yazdir{display:none} }
</style></head><body>
<button class="yazdir" onclick="window.print()">Yazdır</button>
<div class="a4">
<div class="bas"><div class="logo">BİÇEN</div><div style="text-align:right;font-size:11.5px">Tutanak no: <b>{{H(no)}}</b><br>Düzenleme: {{olusturma:dd.MM.yyyy HH:mm}}</div></div>
<h1>DEVAMSIZLIK TUTANAĞI</h1>
<div class="altb">İşe gelmeyen personel hakkında birim yöneticisi ve iki şahit huzurunda düzenlenmiştir</div>

<table>
<tr><th>Adı Soyadı</th><td>{{H((string)t.ad_soyad)}}</td></tr>
<tr><th>Sicil No</th><td>{{H(((string)t.personel_kodu ?? "").Trim())}}</td></tr>
<tr><th>Şube / Birim</th><td>{{H((string)t.sube)}}</td></tr>
<tr><th>Görevi</th><td>{{H((string)t.pozisyon)}}</td></tr>
<tr><th>Devamsız gün(ler)</th><td><b>{{H((string)t.tarihler)}}</b> ({{gunSayisi}} gün{{(bas != bit ? $" · {bas:dd.MM.yyyy} – {bit:dd.MM.yyyy}" : "")}})</td></tr>
<tr><th>Açıklama</th><td>{{H((string)t.aciklama)}}</td></tr>
</table>

<div class="beyan">
Yukarıda kimliği yazılı personel, belirtilen gün(ler)de iş yerine gelmemiş, vardiya girişi yapmamış ve
devamsızlığına ilişkin iş yerine önceden bilgi vermemiş ya da geçerli bir mazeret bildirmemiştir.
Durum, aşağıda adı yazılı birim yöneticisi tarafından tespit edilmiş ve şahitler huzurunda iş bu tutanak
düzenlenmiştir. Tutanak, 4857 sayılı İş Kanunu kapsamındaki devamsızlık işlemlerine esas olmak üzere
personel özlük dosyasına konulacaktır.
</div>

<div class="imzalar">
{{ImzaKutusu("TUTANAĞI DÜZENLEYEN", (string)t.giren_ad, (string)t.giren_pozisyon, "Biçen360'tan devamsızlığı giren yönetici")}}
{{ImzaKutusu("1. ŞAHİT", (string)t.sahit1_ad, (string)t.sahit1_pozisyon, SahitDurumu((string)t.sahit1_durum, (DateTime?)t.sahit1_tarih))}}
{{ImzaKutusu("2. ŞAHİT", (string)t.sahit2_ad, (string)t.sahit2_pozisyon, SahitDurumu((string)t.sahit2_durum, (DateTime?)t.sahit2_tarih))}}
</div>

<div class="dip"><span>İmzalı tutanak Biçen360'tan yüklenir; şahitler ayrıca uygulamadan onaylar.</span><span>{{H(no)}}</span></div>
</div>
</body></html>
""";
    }
}

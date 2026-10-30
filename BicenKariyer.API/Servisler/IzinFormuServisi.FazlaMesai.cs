using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>Fazla mesai formunun verisi (FazlaMesaiController / gönderim doldurur).</summary>
public sealed class FazlaMesaiFormVerisi
{
    public int Id { get; set; }
    public DateTime Olusturma { get; set; }

    public string AdSoyad { get; set; }
    public string Tc { get; set; }
    public string Gorev { get; set; }
    public string Sube { get; set; }

    public DateTime Tarih { get; set; }
    public string Baslangic { get; set; }
    public string Bitis { get; set; }
    public int SureDk { get; set; }
    public string Aciklama { get; set; }

    /// <summary>Formu dolduran (mobilde giren) yönetici</summary>
    public string TalepEden { get; set; }

    /// <summary>Onay kutularına basılan adlar (imza boş kalır)</summary>
    public string BirimYoneticisi { get; set; }
    public string BolgeMuduru { get; set; }
    public string IkOnaylayan { get; set; }
    public DateTime? KararTarihi { get; set; }
}

/// <summary>
/// Fazla Mesai Formu (İK-FM-01, 06.10.2026): İK'nın Word formunun
/// alanları, yıllık izin formuyla aynı A4 düzen ve stil. Yönetici
/// mobilde girince form doldurulup şubenin izin formu adresine PDF
/// olarak gidiyor; çalışan, birim yöneticisi ve bölge müdürü imzalayıp
/// ıslak imzalı formu İK'ya fiziki gönderiyor.
/// </summary>
public partial class IzinFormuServisi
{
    public static string SureMetni(int dk) =>
        dk % 60 == 0 ? $"{dk / 60} saat" : dk < 60 ? $"{dk} dakika" : $"{dk / 60} saat {dk % 60} dakika";

    /// <summary>Doldurulmuş A4 fazla mesai formu.</summary>
    public string FazlaMesaiFormHtml(FazlaMesaiFormVerisi v)
    {
        var geceyeTasiyor = string.CompareOrdinal(v.Bitis, v.Baslangic) <= 0;

        var g = $"""
<header>
<img src="{H(FormLogo())}" alt="Biçen">
<div class="bas"><small>BİÇEN MAĞAZACILIK · İNSAN KAYNAKLARI</small><h1>Fazla Mesai Formu</h1><span>Form No: İK-FM-01</span>
<em>Talep #FM-{v.Id} · {v.Olusturma:dd.MM.yyyy HH:mm}</em></div>
</header>
""";

        g += Bolum(1, "ÇALIŞAN BİLGİLERİ",
            Izgara("minmax(0,1fr) 300px", Alan("Adı Soyadı", v.AdSoyad), Tc(v.Tc)) +
            Izgara("repeat(3,minmax(0,1fr))",
                Alan("Görevi", v.Gorev ?? ""),
                Alan("Şube", v.Sube ?? ""),
                Alan("Fazla Mesai Tarihi", v.Tarih.ToString("dd.MM.yyyy") + " · " + v.Tarih.ToString("dddd", Tr))));

        g += Bolum(2, "FAZLA MESAİ BİLGİLERİ",
            Izgara("repeat(3,minmax(0,1fr))",
                Alan("Fazla Mesainin Başlangıç Saati", v.Baslangic),
                Alan("Fazla Mesainin Bitiş Saati", v.Bitis + (geceyeTasiyor ? " (ertesi gün)" : "")),
                Alan("Toplam Fazla Mesai Süresi", SureMetni(v.SureDk))) +
            $"""
<div><p class="etk">Fazla Mesainin Nedeni / Açıklama</p>
<div class="talep" style="min-height:70px;line-height:1.55;font-size:13px;padding:10px 14px;font-weight:600">{H(string.IsNullOrWhiteSpace(v.Aciklama) ? "" : v.Aciklama)}</div></div>
""");

        g += Bolum(3, "ÇALIŞAN BEYANI", """
<div class="talep" style="line-height:1.6;font-size:12.5px;padding:10px 14px">
Yukarıda belirtilen fazla mesai bilgilerinin doğru olduğunu, fazla mesai karşılığında belirtilen izin uygulamasının
şirket prosedürleri ve ilgili mevzuat çerçevesinde gerçekleştirileceğini kabul ederim.</div>
""");

        string Kutu(string ad, string kisi, DateTime? tarih = null) =>
            $"<div class=\"onay\"><b>{H(ad)}</b><div>"
            + $"<div class=\"satir\"><span>Adı Soyadı</span><div>{H(kisi ?? "")}</div></div>"
            + $"<div class=\"satir\"><span>Tarih</span><div>{(tarih is DateTime t ? t.ToString("dd.MM.yyyy") : "")}</div></div>"
            + "<span class=\"imz\">İmza</span><div style=\"height:34px\"></div></div></div>";

        g += Bolum(4, "ONAY BÖLÜMÜ",
            Izgara("repeat(4,minmax(0,1fr))",
                Kutu("ÇALIŞAN", v.AdSoyad),
                Kutu("BİRİM YÖNETİCİSİ", v.BirimYoneticisi),
                Kutu("BÖLGE MÜDÜRÜ", v.BolgeMuduru),
                Kutu("İNSAN KAYNAKLARI", v.IkOnaylayan, v.KararTarihi)),
            alta: true);

        g += $"""
<footer><ul>
<li>Form çalışan, birim yöneticisi ve bölge müdürü tarafından imzalanıp aslı İnsan Kaynakları'na fiziki olarak gönderilir.</li>
<li>Islak imzalı form İnsan Kaynakları'na ulaşmadan fazla mesai onaylanmaz.</li>
<li>Formu Biçen360'tan {H(v.TalepEden ?? "birim yöneticisi")} doldurdu · {v.Olusturma:dd.MM.yyyy HH:mm}.</li>
</ul></footer>
""";

        return Sayfa($"Fazla Mesai Formu · {v.AdSoyad}", g);
    }

    private string FazlaMesaiMailGovdesi(FazlaMesaiFormVerisi v, string aliciAciklama)
    {
        string Satir(string ad, string deger) => string.IsNullOrWhiteSpace(deger) ? "" : $"""
<tr><td style="padding:7px 12px;border-bottom:1px solid #E3E6E1;color:#6B7280;font-size:13px;width:150px">{H(ad)}</td>
<td style="padding:7px 12px;border-bottom:1px solid #E3E6E1;color:#1F2933;font-size:13px;font-weight:600">{H(deger)}</td></tr>
""";

        return $"""
<!doctype html><html lang="tr"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F4F6F2;font-family:'Segoe UI',Tahoma,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6F2;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #E3E6E1;border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:3px solid #7CB518">
<img src="{H(LogoAdresi())}" alt="Biçen" height="40" style="display:block;height:40px">
</td></tr>
<tr><td style="padding:22px 24px 6px">
<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#5F8C10">İNSAN KAYNAKLARI · FAZLA MESAİ FORMU</div>
<div style="font-size:20px;font-weight:800;color:#1F2933;margin-top:4px">{H(v.AdSoyad)} · {v.Tarih:dd.MM.yyyy}</div>
<p style="font-size:14px;line-height:1.6;color:#374151;margin:10px 0 0">
{H(v.TalepEden ?? "Birim yöneticisi")} Biçen360'tan fazla mesai girdi. Doldurulmuş form ektedir:
{(aliciAciklama == KisiselAciklama
    ? "<b>çıktısını alıp imzalayın ve yöneticinize imzalatın.</b> İmzalı formu fazla mesaiyi giren yöneticiniz Biçen360'tan yükler; İK'ya ayrıca göndermeniz gerekmez."
    : "<b>çıktısını alıp çalışana, birim yöneticisine ve bölge müdürüne imzalatın; ıslak imzalı formu İnsan Kaynakları'na fiziki olarak gönderin.</b> Form İK'ya ulaşmadan fazla mesai onaylanmaz.")}</p>
</td></tr>
<tr><td style="padding:14px 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E6E1;border-radius:8px">
{Satir("Personel", v.AdSoyad)}
{Satir("Görev / Şube", $"{v.Gorev} · {v.Sube}")}
{Satir("Tarih", v.Tarih.ToString("dd.MM.yyyy dddd", Tr))}
{Satir("Saat", $"{v.Baslangic} – {v.Bitis}")}
{Satir("Süre", SureMetni(v.SureDk))}
{Satir("Neden", v.Aciklama)}
</table>
</td></tr>
<tr><td style="padding:6px 24px 20px;font-size:12px;color:#6B7280">{H(aliciAciklama)} · Talep #FM-{v.Id}</td></tr>
</table></td></tr></table></body></html>
""";
    }

    /// <summary>Kayıttan form verisi: personel (TC) Mikro'dan, onaylayıcılar onay tablosundan.</summary>
    public FazlaMesaiFormVerisi FazlaMesaiVerisi(dynamic r)
    {
        var p = Personel((string)r.personel_kodu);

        /* Onay kutularındaki adlar kayıt anında yazıldı (FazlaMesaiController) */
        var birim = (string)r.birim_yonetici;
        var bolge = (string)r.bolge_muduru;

        return new FazlaMesaiFormVerisi
        {
            Id = (int)r.id,
            Olusturma = (DateTime)r.olusturma,
            AdSoyad = ((string)r.ad_soyad ?? "").ToUpper(Tr),
            Tc = p?.KimlikNo,
            Gorev = (string)r.gorev ?? p?.Pozisyon,
            Sube = (string)r.sube ?? p?.IsGrubu,
            Tarih = (DateTime)r.tarih,
            Baslangic = (string)r.baslangic,
            Bitis = (string)r.bitis,
            SureDk = (int)r.sure_dk,
            Aciklama = (string)r.aciklama,
            TalepEden = (string)r.talep_eden_ad,
            BirimYoneticisi = birim?.ToUpper(Tr) ?? ((string)r.talep_eden_ad)?.ToUpper(Tr),
            BolgeMuduru = bolge?.ToUpper(Tr),
            IkOnaylayan = (string)r.durum == "onaylandi" ? (string)r.karar_veren : null,
            KararTarihi = (string)r.durum == "onaylandi" ? (DateTime?)r.karar_tarihi : null,
        };
    }

    public string FazlaMesaiFormHtmlGetir(int id)
    {
        using var db = _vt.Baglanti();
        var r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });
        return r is null ? null : FazlaMesaiFormHtml(FazlaMesaiVerisi(r));
    }

    /// <summary>
    /// Formu doldurup birimin izin formu adresine (şube maili; genel merkezde
    /// İK) gönderir, PDF'i personelin belgelerine kaydeder, sonucu kayda yazar.
    /// Hata fırlatmaz.
    /// </summary>
    public async Task<(bool Basarili, string Adres, string Hata)> FazlaMesaiGonderAsync(int id)
    {
        dynamic r;

        using (var db = _vt.Baglanti())
            r = db.QueryFirstOrDefault("SELECT * FROM KRY_FAZLA_MESAI WHERE id = @id", new { id });

        if (r is null) return (false, null, "Kayıt bulunamadı.");

        var p = Personel((string)r.personel_kodu);
        var (adresler, aciklama) = Alicilar(p);

        /* 14.10.2026: Fazla mesai akışı kuralında form alıcısı yazılıysa o */
        if (FazlaMesaiKuralServisi.Oku((string)r.akis) is { Eposta.Count: > 0 } kAkis)
            (adresler, aciklama) = (kAkis.Eposta, kAkis.EpostaAciklama ?? "Fazla mesai kuralı");

        var adres = string.Join(", ", adresler);

        string hataMetni = null;
        var basarili = false;

        try
        {
            FazlaMesaiFormVerisi v = FazlaMesaiVerisi(r);
            var form = FazlaMesaiFormHtml(v);
            var konu = $"Fazla mesai formu · {v.AdSoyad} · {v.Tarih:dd.MM.yyyy} · {SureMetni(v.SureDk)}";
            var dosyaKoku = $"Fazla-Mesai-{Dosya(v.AdSoyad)}-{v.Tarih:yyyyMMdd}";

            var (pdf, pdfHata) = await TarayiciPdf.DonusturAsync(form, _yapilandirma, _kayit);

            var ek = pdf is not null
                ? ($"{dosyaKoku}.pdf", pdf)
                : ($"{dosyaKoku}.html", Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(form)).ToArray());

            basarili = await _mail.GonderAsync(adresler, konu, FazlaMesaiMailGovdesi(v, aciklama), ekler: new[] { ek });

            if (!basarili) hataMetni = _mail.SonHataMesaji ?? "Mail gönderilemedi.";
            else if (pdf is null) hataMetni = $"Form HTML olarak gönderildi: {pdfHata}";

            if (pdf is not null) FazlaMesaiBelgeyeKaydet(r, p, pdf, $"{dosyaKoku}.pdf");
        }
        catch (Exception hata)
        {
            hataMetni = hata.Message;
            _kayit.LogError(hata, "Fazla mesai formu gönderilemedi: {Id}", id);
        }

        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
UPDATE KRY_FAZLA_MESAI
SET form_eposta = @adres,
    form_gonderim = CASE WHEN @basarili = 1 THEN SYSDATETIME() ELSE form_gonderim END,
    form_hata = @hata,
    form_kisisel = CASE WHEN @kisisel = 1 THEN 1 ELSE form_kisisel END
WHERE id = @id",
                new
                {
                    id,
                    kisisel = aciklama == KisiselAciklama,
                    adres = adres.Length > 400 ? adres[..400] : adres,
                    basarili,
                    hata = hataMetni is null ? null : hataMetni.Length > 500 ? hataMetni[..500] : hataMetni,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fazla mesai gönderim sonucu yazılamadı: {Id}", id);
        }

        return (basarili, adres, hataMetni);
    }

    private void FazlaMesaiBelgeyeKaydet(dynamic r, PersonelKaydi p, byte[] pdf, string ozgunAd)
    {
        try
        {
            int id = (int)r.id;
            var kod = ((string)r.personel_kodu ?? "").Trim();
            var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
            var diskAdi = $"{kod}_fazlamesai{id}_{Guid.NewGuid():N}.pdf";

            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            File.WriteAllBytes(Path.Combine(klasor, diskAdi), pdf);

            var aciklama = $"Fazla mesai #{id} · otomatik doldurulan form";

            using var db = _vt.Baglanti();

            db.Execute(@"
UPDATE KRY_PERSONEL_BELGE SET silindi = 1, silen = N'sistem', silme_tarihi = SYSDATETIME()
WHERE personel_kodu = @kod AND aciklama = @aciklama AND silindi = 0", new { kod, aciklama });

            db.Execute(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama,
     dosya, ozgun_ad, boyut, yukleyen, personele_acik)
VALUES (@kod, @kimlik, @adSoyad, N'Fazla Mesai Formu', @baslik, @aciklama,
        @diskAdi, @ozgunAd, @boyut, N'sistem', 0)",
                new
                {
                    kod,
                    kimlik = string.IsNullOrWhiteSpace(p?.KimlikNo) ? null : p.KimlikNo.Trim(),
                    adSoyad = (string)r.ad_soyad,
                    baslik = $"Fazla mesai · {((DateTime)r.tarih):dd.MM.yyyy} · {SureMetni((int)r.sure_dk)}",
                    aciklama,
                    diskAdi,
                    ozgunAd,
                    boyut = pdf.LongLength,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fazla mesai formu belgelere kaydedilemedi");
        }
    }
}

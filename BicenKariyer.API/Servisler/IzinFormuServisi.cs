using System.Globalization;
using System.Net;
using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebinin basılı formu: talep gelince otomatik doldurulur ve mail
/// olarak gönderilir.
///
/// <para>
/// Personel uygulamadan izin talep ettiğinde form (yıllık, ücretsiz,
/// mazeret ya da saatlik) talep, personel ve bakiye bilgileriyle
/// doldurulur. Şube personelinin formu şubenin e-posta adresine
/// (portal → Şube ve depo), genel merkez personelininki İK'ya gider.
/// Şubede ya da İK'da çıktısı alınıp çalışana ve yerine bakacak kişiye
/// imzalatılır; imzalı form İK panelinde son onayda yüklenir.
/// </para>
///
/// <para>
/// Form A4'e göre hazırlanmış HTML; mail eki olarak sunucudaki Edge/Chrome
/// ile PDF'e çevriliyor (TarayiciPdf). PDF oluşturulamazsa HTML gidiyor.
/// PDF personelin belgelerine de "İzin Formu" olarak kaydoluyor; panelde
/// personel kartında görünüyor.
/// </para>
/// </summary>
public partial class IzinFormuServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly IzinOnayKuralServisi _kural;
    private readonly MailServisi _mail;
    private readonly AyarServisi _ayar;
    private readonly IConfiguration _yapilandirma;
    private readonly IWebHostEnvironment _ortam;
    private readonly ILogger<IzinFormuServisi> _kayit;

    public IzinFormuServisi(VeritabaniServisi vt, PersonelKaynagiServisi kaynak,
        IzinOnayKuralServisi kural, MailServisi mail, AyarServisi ayar,
        IConfiguration yapilandirma, IWebHostEnvironment ortam, ILogger<IzinFormuServisi> kayit)
    {
        _ortam = ortam;
        _vt = vt;
        _kaynak = kaynak;
        _kural = kural;
        _mail = mail;
        _ayar = ayar;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    private static readonly CultureInfo Tr = new("tr-TR");

    /// <summary>
    /// Genel merkez personelinin ve eşleşmeyen şubelerin formu buraya gider.
    /// Önce Yönetim → İzin formu e-postaları, sonra appsettings.
    /// </summary>
    public string IkAdresi
    {
        get
        {
            try
            {
                var panel = _ayar.FormOku()?.IzinFormuIkEposta;
                if (!string.IsNullOrWhiteSpace(panel)) return panel.Trim();
            }
            catch
            {
                /* Ayar okunamazsa yapılandırmadaki adres */
            }

            return string.IsNullOrWhiteSpace(_yapilandirma["IzinFormu:IkEposta"])
                ? "ik@bicen.com.tr"
                : _yapilandirma["IzinFormu:IkEposta"].Trim();
        }
    }

    private List<string> IkAdresleri() => Ayir(IkAdresi);

    private static List<string> Ayir(string metin) =>
        (metin ?? "")
            .Split(new[] { ';', ',', ' ' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Contains('@'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string H(object v) => WebUtility.HtmlEncode(Convert.ToString(v, Tr) ?? "");

    private static string Sayi(decimal? v) =>
        v is null ? "" : v.Value == Math.Floor(v.Value)
            ? v.Value.ToString("0", Tr)
            : v.Value.ToString("0.#", Tr);

    /* ================================================================== */
    /* Alıcı                                                              */
    /* ================================================================== */

    /// <summary>
    /// Formun gideceği adresler (04.10.2026, Yönetim → İzin formu e-postaları):
    /// <list type="number">
    /// <item>Birimin panelde yazılı izin formu adresi (şubede şubenin maili,
    /// Akçaburgaz depoda depo müdürünün maili).</item>
    /// <item>Genel merkez personeli: İK.</item>
    /// <item>Portalda şubeye yazılan e-posta (eski kaynak).</item>
    /// <item>Hiçbiri yoksa İK — form hiç gitmemekten iyidir; açıklama bunu söyler.</item>
    /// </list>
    /// </summary>
    public (List<string> Adresler, string Aciklama) Alicilar(PersonelKaydi p)
    {
        /* 0. Genel merkez / depo personelinin kendi e-postası (13.10.2026):
           bilgisayarlı personel formu kendisi alır, imzalatıp uygulamadan
           yükler; İK'ya iş düşmez. Şube personeli bu kuraldan etkilenmez. */
        var kisisel = KisiselEposta(p);

        if (kisisel is not null)
            return (new List<string> { kisisel }, KisiselAciklama);

        var adaylar = new[] { p?.IsGrubu, p?.Sube }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        FormAyarlari form = null;

        try
        {
            form = _ayar.FormOku();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Form ayarı okunamadı (izin formu alıcısı)");
        }

        /* 1. Panelde birime yazılı adres */
        var birim = BirimBul(form, adaylar);

        if (birim is not null)
        {
            var adresler = Ayir(birim.IzinFormuEposta);

            if (adresler.Count > 0)
                return (adresler, $"Birimin izin formu adresi · {(string.IsNullOrWhiteSpace(birim.Ad) ? birim.Kod : birim.Ad)}");
        }

        /* 2. Genel merkez: İK. Birim türü "Genel Müdürlük" ya da onay
           tablosundaki iş yeri merkez. (Eski denetim büyük harfli anahtarda
           küçük harfle "merkez" arıyordu ve hiç tutmuyordu.) */
        var yer = _kural.IsYeriBul(p?.IsGrubu);

        var merkez = PersonelKaynagiServisi.DuzAnahtar(yer).Contains("merkez")
                     || (birim is not null && PersonelKaynagiServisi.DuzAnahtar(birim.Tur).Contains("genelmudurluk"));

        if (merkez)
            return (IkAdresleri(), "Genel merkez personeli · İK");

        /* 3. Portaldaki şube e-postası */
        try
        {
            using var db = _vt.Baglanti();

            var subeler = db.Query(@"
SELECT sube_adi AS ad, eposta FROM B360_SUBE_DEPO
WHERE aktif = 1 AND eposta IS NOT NULL AND LTRIM(RTRIM(eposta)) <> ''").ToList();

            foreach (var aday in adaylar)
            {
                var an = PersonelKaynagiServisi.BirimAnahtari(aday);

                var s = subeler.FirstOrDefault(x =>
                    string.Equals(((string)x.ad ?? "").Trim(), aday, StringComparison.OrdinalIgnoreCase))
                    ?? subeler.FirstOrDefault(x => an.Length > 0 && PersonelKaynagiServisi.BirimAnahtari((string)x.ad) == an)
                    ?? subeler.FirstOrDefault(x => an.Length > 0
                        && PersonelKaynagiServisi.Benziyor(PersonelKaynagiServisi.BirimAnahtari((string)x.ad), an));

                if (s is null) continue;

                var adresler = Ayir((string)s.eposta);

                if (adresler.Count > 0)
                    return (adresler, $"Portaldaki şube e-postası · {(string)s.ad}");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şube e-postaları okunamadı");
        }

        return (IkAdresleri(),
            $"{p?.IsGrubu ?? "Birim"} için izin formu adresi tanımlı değil · İK'ya gönderildi");
    }

    /// <summary>Alıcı açıklaması: form personelin kendi adresine gitti</summary>
    public const string KisiselAciklama = "Personelin kendi e-postası";

    /// <summary>
    /// Personelin kendi e-postası (13.10.2026, Yönetim → İzin formu
    /// e-postaları → Personel e-postaları). Yalnızca şube dışındaki
    /// (genel merkez, depo) personelde kullanılır; şubede ya da adres
    /// girilmemişse null.
    /// </summary>
    public string KisiselEposta(PersonelKaydi p)
    {
        if (p is null || string.IsNullOrWhiteSpace(p.PersonelKodu)) return null;

        try
        {
            if (FormHedefi(p) == "sube") return null;

            using var db = _vt.Baglanti();
            var adres = PersonelEposta.Oku(db, p.PersonelKodu);

            return string.IsNullOrWhiteSpace(adres) ? null : adres.Trim();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel e-postası okunamadı: {Kod}", p.PersonelKodu);
            return null;
        }
    }

    /// <summary>Personelin iş yeri, Yönetim → Birimler'deki hangi birim (kod ya da ad).</summary>
    /// <summary>
    /// Genel merkez personeli mi (05.10.2026): izin formu alıcısındaki
    /// kuralın aynısı — onay tablosundaki iş yeri "merkez" ya da panelde
    /// birim türü "Genel Müdürlük". Yıllık İzin Ücretleri maaş kaynağını
    /// buna göre seçiyor.
    /// </summary>
    public bool GenelMerkezMi(PersonelKaydi p, FormAyarlari form = null)
    {
        if (p is null) return false;

        var adaylar = new[] { p.IsGrubu, p.Sube }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (form is null)
        {
            try { form = _ayar.FormOku(); }
            catch { /* form okunamazsa yalnızca iş yeri kuralı */ }
        }

        var birim = BirimBul(form, adaylar);

        if (birim is not null && PersonelKaynagiServisi.DuzAnahtar(birim.Tur).Contains("genelmudurluk"))
            return true;

        var yer = PersonelKaynagiServisi.DuzAnahtar(_kural.IsYeriBul(p.IsGrubu));

        return yer.Contains("merkez") && !yer.Contains("depo");
    }

    /// <summary>
    /// İzin formunun gittiği yer (07.10.2026): "merkez" (İK), "depo" (depo
    /// müdürü) ya da "sube" (şube maili). Talep sonrası mesaj ve şube
    /// personelinde imzalı form şartı buna bakıyor.
    /// </summary>
    public string FormHedefi(PersonelKaydi p, FormAyarlari form = null)
    {
        if (p is null) return "sube";

        /* Toplu listede (personel e-postaları) ayar bir kez okunup veriliyor */
        form ??= FormAyari();
        if (GenelMerkezMi(p, form)) return "merkez";

        var adaylar = new[] { p.IsGrubu, p.Sube }
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var birim = BirimBul(form, adaylar);
        var tur = PersonelKaynagiServisi.DuzAnahtar(birim?.Tur);
        var yer = PersonelKaynagiServisi.DuzAnahtar(_kural.IsYeriBul(p.IsGrubu));
        var ad = PersonelKaynagiServisi.DuzAnahtar(p.IsGrubu);

        if (tur.Contains("depo") || yer.Contains("depo") || ad.Contains("depo")) return "depo";
        if (tur.Contains("genelmudurluk") || yer.Contains("merkez")) return "merkez";

        return "sube";
    }

    /// <summary>Panel form ayarı (birim türleri); toplu denetimde bir kez okumak için.</summary>
    public FormAyarlari FormAyari()
    {
        try { return _ayar.FormOku(); }
        catch { return null; }
    }

    private static Sube BirimBul(FormAyarlari form, List<string> adaylar)
    {
        var birimler = form?.Subeler ?? new List<Sube>();

        foreach (var aday in adaylar)
        {
            /* 09.10.2026: anahtarlar sadeleştirilerek karşılaştırılıyor.
               Önceden ham ad karşılaştırılıyordu: Mikro'daki "SİLİVRİ-2" ile
               paneldeki "Silivri-2 Şubesi" (büyük/küçük harf, İ/I, "Şubesi"
               eki) eşleşmiyor, adres yazılı olduğu hâlde form İK'ya gidiyordu. */
            var a = PersonelKaynagiServisi.BirimAnahtari(aday);

            var b = birimler.FirstOrDefault(x =>
                        string.Equals((x.Ad ?? "").Trim(), aday, StringComparison.OrdinalIgnoreCase)
                        || string.Equals((x.Kod ?? "").Trim(), aday, StringComparison.OrdinalIgnoreCase))
                    ?? birimler.FirstOrDefault(x => a.Length > 0
                        && (PersonelKaynagiServisi.BirimAnahtari(x.Kod) == a
                            || PersonelKaynagiServisi.BirimAnahtari(x.Ad) == a))
                    ?? birimler.FirstOrDefault(x => a.Length > 0
                        && (PersonelKaynagiServisi.Benziyor(PersonelKaynagiServisi.BirimAnahtari(x.Ad), a)
                            || PersonelKaynagiServisi.Benziyor(PersonelKaynagiServisi.BirimAnahtari(x.Kod), a)));

            if (b is not null) return b;
        }

        return null;
    }

    /* ================================================================== */
    /* Gönderim                                                           */
    /* ================================================================== */

    /// <summary>
    /// Talebin formunu doldurup gönderir; sonucu talebe yazar (adres,
    /// zaman ya da hata). Hata fırlatmaz: talep formsuz da geçerlidir.
    /// </summary>
    /// <param name="talepId">Talep</param>
    /// <param name="gonderen">Elle gönderen panel kullanıcısı; boşsa otomatik gönderim (sistem)</param>
    public async Task<(bool Basarili, string Adres, string Hata)> GonderAsync(int talepId, string gonderen = null)
    {
        dynamic talep;
        PersonelKaydi p;

        try
        {
            using var db = _vt.Baglanti();

            talep = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id", new { id = talepId });

            if (talep is null) return (false, null, "Talep bulunamadı.");

            p = Personel((string)talep.personel_kodu);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "İzin formu hazırlanamadı: {Id}", talepId);
            return (false, null, hata.Message);
        }

        var (adresler, aciklama) = Alicilar(p);
        var adres = string.Join(", ", adresler);

        string hataMetni = null;
        var basarili = false;

        try
        {
            string form = FormHtml(talep, p);
            string govde = MailGovdesi(talep, p, aciklama);

            var konu = $"İzin formu · {(string)talep.ad_soyad} · {(string)talep.tur} · "
                       + $"{((DateTime)talep.cikis_tarihi):dd.MM.yyyy}";

            var dosyaKoku = $"Izin-Formu-{Dosya((string)talep.ad_soyad)}-{((DateTime)talep.cikis_tarihi):yyyyMMdd}";

            /* PDF: sunucudaki tarayıcı ile. Olmazsa HTML ek gider. */
            var (pdf, pdfHata) = await TarayiciPdf.DonusturAsync(form, _yapilandirma, _kayit);

            var ek = pdf is not null
                ? ($"{dosyaKoku}.pdf", pdf)
                : ($"{dosyaKoku}.html", Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(form)).ToArray());

            basarili = await _mail.GonderAsync(adresler, konu, govde, ekler: new[] { ek });

            if (!basarili) hataMetni = _mail.SonHataMesaji ?? "Mail gönderilemedi.";
            else if (pdf is null) hataMetni = $"Form HTML olarak gönderildi: {pdfHata}";

            /* Personel kartındaki belgelere: mail gitmese de form kayıtlı olsun */
            if (pdf is not null) BelgeyeKaydet(talep, p, pdf, $"{dosyaKoku}.pdf");
        }
        catch (Exception hata)
        {
            hataMetni = hata.Message;
            _kayit.LogError(hata, "İzin formu gönderilemedi: {Id}", talepId);
        }

        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
UPDATE KRY_IZIN_TALEP
SET form_eposta = @adres,
    form_gonderim = CASE WHEN @basarili = 1 THEN SYSDATETIME() ELSE form_gonderim END,
    form_hata = @hata,
    form_kisisel = CASE WHEN @kisisel = 1 THEN 1 ELSE form_kisisel END
WHERE id = @id",
                new
                {
                    id = talepId,
                    kisisel = aciklama == KisiselAciklama,
                    adres = adres.Length > 400 ? adres[..400] : adres,
                    basarili,
                    hata = hataMetni is null ? null : (hataMetni.Length > 500 ? hataMetni[..500] : hataMetni)
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Form gönderim sonucu yazılamadı: {Id}", talepId);
        }

        /* Hareket günlüğü: formun kime gittiği (ya da neden gitmediği) */
        IzinHareket.Yaz(_vt, talepId, IzinHareket.Form,
            basarili
                ? (string.IsNullOrWhiteSpace(gonderen) ? "İzin formu e-postayla gönderildi" : "İzin formu yeniden gönderildi")
                : "İzin formu gönderilemedi",
            hataMetni is null ? aciklama : $"{hataMetni} · {aciklama}",
            string.IsNullOrWhiteSpace(gonderen) ? "Sistem" : gonderen,
            adres, IzinHareket.Eposta);

        return (basarili, adres, hataMetni);
    }

    /// <summary>
    /// Doldurulmuş formu personelin belgelerine (KRY_PERSONEL_BELGE, tür
    /// "İzin Formu") yazar. Aynı talebin önceki otomatik formu silinmiş
    /// sayılır: yeniden gönderimde kartta iki kopya birikmesin.
    /// </summary>
    private void BelgeyeKaydet(dynamic talep, PersonelKaydi p, byte[] pdf, string ozgunAd)
    {
        try
        {
            int id = (int)talep.id;
            var kod = ((string)talep.personel_kodu ?? "").Trim();
            var klasor = BelgeKlasoru.Yazma(_yapilandirma, _ortam);
            var diskAdi = $"{kod}_izinformu{id}_{Guid.NewGuid():N}.pdf";

            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            File.WriteAllBytes(Path.Combine(klasor, diskAdi), pdf);

            var cikis = (DateTime)talep.cikis_tarihi;
            var donus = (DateTime)talep.donus_tarihi;
            var aciklama = $"İzin talebi #{id} · otomatik doldurulan form";

            using var db = _vt.Baglanti();

            db.Execute(@"
UPDATE KRY_PERSONEL_BELGE SET silindi = 1, silen = N'sistem', silme_tarihi = SYSDATETIME()
WHERE personel_kodu = @kod AND aciklama = @aciklama AND silindi = 0", new { kod, aciklama });

            db.Execute(@"
INSERT INTO KRY_PERSONEL_BELGE
    (personel_kodu, kimlik_no, ad_soyad, tur, baslik, aciklama,
     dosya, ozgun_ad, boyut, yukleyen, personele_acik)
VALUES (@kod, @kimlik, @adSoyad, N'İzin Formu', @baslik, @aciklama,
        @diskAdi, @ozgunAd, @boyut, N'sistem', 0)",
                new
                {
                    kod,
                    kimlik = string.IsNullOrWhiteSpace(p?.KimlikNo) ? null : p.KimlikNo.Trim(),
                    adSoyad = (string)talep.ad_soyad,
                    baslik = $"{(string)talep.tur} formu · {cikis:dd.MM.yyyy}"
                             + (donus.Date != cikis.Date ? $" – {donus:dd.MM.yyyy}" : ""),
                    aciklama,
                    diskAdi,
                    ozgunAd,
                    boyut = pdf.LongLength,
                });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin formu belgelere kaydedilemedi");
        }
    }

    /// <summary>Panelden görüntüleme ve yazdırma için formun kendisi.</summary>
    public string FormHtmlGetir(int talepId)
    {
        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault("SELECT * FROM KRY_IZIN_TALEP WHERE id = @id", new { id = talepId });

        if (talep is null) return null;

        string html = FormHtml(talep, Personel((string)talep.personel_kodu));
        return html;
    }

    private PersonelKaydi Personel(string kod) =>
        _kaynak.TumPersonelleriGetir().FirstOrDefault(x => K(x.PersonelKodu) == K(kod));

    private static string Dosya(string ad)
    {
        var harita = new Dictionary<char, string>
        {
            ['ç'] = "c", ['Ç'] = "C", ['ğ'] = "g", ['Ğ'] = "G", ['ı'] = "i", ['İ'] = "I",
            ['ö'] = "o", ['Ö'] = "O", ['ş'] = "s", ['Ş'] = "S", ['ü'] = "u", ['Ü'] = "U"
        };

        var sb = new StringBuilder();

        foreach (var c in (ad ?? "personel").Trim())
        {
            if (harita.TryGetValue(c, out var r)) sb.Append(r);
            else if (char.IsLetterOrDigit(c) && c < 128) sb.Append(c);
            else if (c == ' ' || c == '-') sb.Append('-');
        }

        return sb.Length == 0 ? "personel" : sb.ToString();
    }

    /* ================================================================== */
    /* Form verisi                                                        */
    /* ================================================================== */

    /// <summary>Form türü: talebin türünden.</summary>
    public static string FormTuru(string tur, string baslangicSaat)
    {
        var a = (tur ?? "").ToLower(Tr);

        if (a.Contains("yıllık")) return "yillik";
        if (a.Contains("ücretsiz")) return "ucretsiz";
        if (a.Contains("saat") || !string.IsNullOrWhiteSpace(baslangicSaat)) return "saatlik";

        return "mazeret";
    }

    private sealed class Veri
    {
        public int Id;
        public DateTime Olusturma;
        public string Tur;
        public string AdSoyad, Tc, Sube, Gorev, Telefon, Kidem;
        public DateTime Cikis, Donus, Baslama;
        public decimal Gun;
        public string BasSaat, BitSaat;
        public decimal? Saat;
        public string YarimGun;
        public string Aciklama;
        public string Yerine;
        public decimal? Devir, HakEdilen, Kalan;
        public DateTime? HakEdis, KullanimSonu;

        /// <summary>
        /// Birim yöneticisi / mağaza yöneticisi: izin onay tablosundaki 1.
        /// onaylayan. Genel merkez ve depoda departman yöneticisi, şubede
        /// mağaza müdürü.
        /// </summary>
        public string Yonetici;
    }

    private static string AltTurlu(string tur, string alt) =>
        string.IsNullOrWhiteSpace(alt) ? tur : $"{tur} · {alt.Trim()}";

    private Veri Hazirla(dynamic t, PersonelKaydi p)
    {
        var v = new Veri
        {
            Id = (int)t.id,
            Olusturma = (DateTime)t.olusturma,
            /* Mazeret türü (07.10.2026): "Mazeret İzni · Raporlu" — formda
               ilgili kutu işaretlenir, diğerlerinde "Diğer" yanına yazılır */
            Tur = AltTurlu((string)t.tur, t is IDictionary<string, object> sat && sat.TryGetValue("alt_tur", out var alt) ? alt as string : null),
            AdSoyad = (string)t.ad_soyad ?? $"{p?.Ad} {p?.Soyad}".Trim(),
            Tc = (p?.KimlikNo ?? "").Trim(),
            Sube = p?.IsGrubu ?? (string)t.sube_adi,
            Gorev = (string)t.gorev ?? p?.Pozisyon,
            Telefon = p?.Telefon,
            Cikis = ((DateTime)t.cikis_tarihi).Date,
            Donus = ((DateTime)t.donus_tarihi).Date,
            Gun = (decimal)t.gun,
            BasSaat = (string)t.baslangic_saat,
            BitSaat = (string)t.bitis_saat,
            Saat = (decimal?)t.saat,
            YarimGun = (string)t.yarim_gun,
            Aciklama = (string)t.aciklama,
            Yerine = (string)t.yerine_ad,
        };

        /* Talepteki bitiş tarihi son izin günü; işbaşı ertesi gün.
           Talepte ayrıca yazılmışsa o. */
        v.Baslama = t.baslama_tarihi is DateTime b ? b.Date : v.Donus.AddDays(1);

        try
        {
            if (p is not null)
            {
                var (yoneticiler, _) = _kural.Onaylayanlar(p.PersonelKodu, p.Pozisyon, p.IsGrubu);

                v.Yonetici = string.Join(" / ", yoneticiler
                    .Select(x => $"{x.Ad} {x.Soyad}".Trim())
                    .Where(x => x.Length > 0)
                    .Distinct()
                    .Take(2));
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin formu için birim yöneticisi bulunamadı");
        }

        var kod = (string)t.personel_kodu;

        /* Hak ediş düzeltmesi (ayrılıp dönenler); okunamazsa işe giriş tarihi */
        dynamic duzeltme = null;

        try
        {
            using var dbd = _vt.Baglanti();
            duzeltme = IzinHakedis.Getir(dbd, kod);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Hak ediş düzeltmesi okunamadı");
        }

        {
            /* Kıdem: hak ediş esas tarihinden (ayrılıp dönenlerde düzeltilmiş) */
            DateTime? esas = p is null ? null : IzinHakedis.Esas(p.GirisTarihi, (object)duzeltme);

            if (esas is DateTime e)
            {
                var ay = (DateTime.Today.Year - e.Year) * 12 + DateTime.Today.Month - e.Month
                         - (DateTime.Today.Day < e.Day ? 1 : 0);
                ay = Math.Max(0, ay);
                v.Kidem = ay >= 12 ? $"{ay / 12} yıl {ay % 12} ay" : $"{ay} ay";

                /* İznin düştüğü hak ediş dönemi: izin başlangıcından önceki son
                   yıl dönümü; ilk yılını doldurmamışsa ilk yıl dönümü. Kullanım
                   süresi bir sonraki yıl dönümünün bir gün öncesine kadar. */
                var hd = IzinHakedis.YilDonumu(e, v.Cikis.Year);
                if (hd > v.Cikis) hd = IzinHakedis.YilDonumu(e, v.Cikis.Year - 1);
                if (hd.Year <= e.Year) hd = IzinHakedis.YilDonumu(e, e.Year + 1);
                v.HakEdis = hd;
                v.KullanimSonu = IzinHakedis.YilDonumu(e, hd.Year + 1).AddDays(-1);
            }
        }

        try
        {
            using var db = _vt.Baglanti();

            var bakiye = db.QueryFirstOrDefault(@"
SELECT baslangic, devir, aktarilan_kullanim AS aktarilan
FROM KRY_IZIN_BAKIYE WHERE personel_kodu = @kod", new { kod });

            if (bakiye is not null)
            {
                v.HakEdilen = (decimal)bakiye.baslangic;
                v.Devir = (decimal)bakiye.devir;

                var kullanilan = db.ExecuteScalar<decimal>(@"
SELECT ISNULL(SUM(gun), 0) FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0 AND bakiyeden_duser = 1", new { kod });

                /* Onaylanmış talebin izni zaten kullanılanda: iki kez düşülmez */
                var buTalep = t.izin_id is null && FormTuru(v.Tur, v.BasSaat) == "yillik" ? v.Gun : 0m;

                v.Kalan = v.HakEdilen + v.Devir - (decimal)bakiye.aktarilan - kullanilan - buTalep;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İzin formu bakiyesi okunamadı");
        }

        return v;
    }

    /* ================================================================== */
    /* Mail gövdesi                                                       */
    /* ================================================================== */

    private string LogoAdresi()
    {
        string site = null;

        try
        {
            site = _ayar.MailOku().SiteAdresi;
        }
        catch
        {
            /* Ayar okunamazsa varsayılan site */
        }

        site = string.IsNullOrWhiteSpace(site) ? "https://kariyer.bicen.com.tr" : site.TrimEnd('/');
        return $"{site}/apiservis/api/Logo";
    }

    /// <summary>
    /// Formdaki logo: wwwroot'taki dosya gömülü (data URI) olarak. PDF'i
    /// yazdıran tarayıcı ve formu açan kişi sunucuya ulaşamasa da logo
    /// görünür. Dosya yoksa adres.
    /// </summary>
    private string FormLogo()
    {
        try
        {
            var klasor = string.IsNullOrWhiteSpace(_ortam?.WebRootPath)
                ? Path.Combine(AppContext.BaseDirectory, "wwwroot")
                : _ortam.WebRootPath;

            foreach (var (ad, tur) in new[] { ("logo.png", "image/png"), ("logo.jpg", "image/jpeg"), ("logo.jpeg", "image/jpeg"), ("logo.svg", "image/svg+xml") })
            {
                var yol = Path.Combine(klasor, ad);

                if (File.Exists(yol) && new FileInfo(yol).Length < 1_500_000)
                    return $"data:{tur};base64,{Convert.ToBase64String(File.ReadAllBytes(yol))}";
            }
        }
        catch
        {
            /* Okunamazsa adres kullanılır */
        }

        return LogoAdresi();
    }

    private string MailGovdesi(dynamic t, PersonelKaydi p, string aliciAciklama)
    {
        Veri v = Hazirla(t, p);

        var tarih = !string.IsNullOrWhiteSpace(v.BasSaat)
            ? $"{v.Cikis:dd.MM.yyyy} · {v.BasSaat} – {v.BitSaat}"
            : v.Cikis == v.Donus
                ? $"{v.Cikis:dd.MM.yyyy}{(string.IsNullOrWhiteSpace(v.YarimGun) ? "" : $" · {v.YarimGun}")}"
                : $"{v.Cikis:dd.MM.yyyy} – {v.Donus:dd.MM.yyyy}";

        var sure = !string.IsNullOrWhiteSpace(v.BasSaat) ? $"{Sayi(v.Saat)} saat" : $"{Sayi(v.Gun)} gün";

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
<div style="font-size:12px;font-weight:700;letter-spacing:1.5px;color:#5F8C10">İNSAN KAYNAKLARI · İZİN FORMU</div>
<div style="font-size:20px;font-weight:800;color:#1F2933;margin-top:4px">{H(v.AdSoyad)} · {H(v.Tur)}</div>
<p style="font-size:14px;line-height:1.6;color:#374151;margin:10px 0 0">
Biçen360 uygulamasından yeni bir izin talebi geldi. Doldurulmuş form ektedir:
{(aliciAciklama == KisiselAciklama
    ? $"<b>ekteki dosyayı yazdırın</b>, imzalayın{(string.IsNullOrWhiteSpace(v.Yerine) ? "" : ", yerinize bakacak kişiye")} ve yöneticinize imzalatın. İmzalı formun fotoğrafını ya da taramasını <b>Biçen360 uygulamasında ana sayfadaki izin formu kartından</b> {MazeretBelgeGorevi.SureGun} gün içinde yükleyin; İK'ya ayrıca göndermeniz gerekmez."
    : $"<b>ekteki dosyayı açıp yazdırın</b>, çalışana{(string.IsNullOrWhiteSpace(v.Yerine) ? "" : " ve yerine bakacak kişiye")} imzalatın. İmzalı form İnsan Kaynakları'na ulaştırılmalıdır; izin, imzalı form İK panelinde yüklendikten sonra onaylanır.")}
</p>
</td></tr>
<tr><td style="padding:14px 24px 6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E3E6E1;border-radius:8px">
{Satir("Personel", v.AdSoyad)}
{Satir("Şube / Görev", $"{v.Sube} · {v.Gorev}")}
{Satir("İzin türü", v.Tur)}
{Satir("Tarih", tarih)}
{Satir("Süre", sure)}
{Satir("Yerine bakacak", v.Yerine)}
{Satir("Açıklama", v.Aciklama)}
{Satir("Talep no", $"#{v.Id} · {v.Olusturma:dd.MM.yyyy HH:mm}")}
</table>
</td></tr>
<tr><td style="padding:12px 24px 22px;font-size:12px;color:#6B7280;line-height:1.6">
Bu mail otomatik gönderildi · {H(aliciAciklama)}.<br>
Ek açılmazsa formu İK panelinde İzin Talepleri › talep ayrıntısından da yazdırabilirsiniz.
</td></tr>
</table>
</td></tr>
</table>
</body></html>
""";
    }

    /* ================================================================== */
    /* A4 form                                                            */
    /* ================================================================== */

    private const string Css = """
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:#e9ece6;font-family:'Plus Jakarta Sans','Segoe UI',Tahoma,Arial,sans-serif;color:#1c2419;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.arac{position:sticky;top:0;z-index:2;display:flex;justify-content:center;gap:10px;padding:10px;background:#1c2419}
.arac button{font:inherit;font-weight:700;font-size:14px;border:0;border-radius:8px;padding:9px 18px;background:#7cb518;color:#fff;cursor:pointer}
.arac span{color:#d5dbcf;font-size:13px;align-self:center}
.sayfa{width:794px;height:1123px;margin:18px auto;background:#fff;padding:36px 44px 30px;display:flex;flex-direction:column;gap:12px;overflow:hidden;box-shadow:0 2px 14px rgba(0,0,0,.12)}
@page{size:A4;margin:0}
@media print{body{background:#fff}.arac{display:none}.sayfa{margin:0;box-shadow:none}}
header{display:flex;align-items:center;justify-content:space-between;gap:24px;padding-bottom:14px;border-bottom:2px solid #1c2419}
header img{height:64px;width:auto;display:block}
.bas{display:flex;flex-direction:column;align-items:flex-end;text-align:right;gap:2px}
.bas small{font-size:12px;font-weight:700;letter-spacing:.16em;color:#4a6e0b}
.bas h1{margin:0;font-size:30px;line-height:1.1;font-weight:800;letter-spacing:-.01em}
.bas span{font-size:13px;font-weight:600;color:#4b5563}
.bas em{font-style:normal;font-size:12px;color:#6b7280}
section{display:flex;flex-direction:column;gap:10px}
.sb{display:flex;align-items:center;gap:10px}
.sb i{width:22px;height:22px;border-radius:50%;background:#4a6e0b;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center;font-style:normal;flex-shrink:0}
.sb h2{margin:0;font-size:14px;font-weight:800;letter-spacing:.02em}
.sb div{flex-grow:1;border-top:1px solid #d5dbcf}
.g{display:grid;gap:10px 14px}
.etk{font-size:12px;font-weight:600;color:#4b5563;line-height:1.2;margin:0 0 5px}
.kutu{min-height:32px;border:1px solid #bfc6b8;border-radius:6px;background:#fff;padding:6px 10px;font-size:14px;font-weight:700;display:flex;align-items:center;justify-content:space-between;gap:8px;overflow:hidden}
.kutu u{text-decoration:none;font-size:12px;font-weight:600;color:#6b7280;margin-left:auto}
.cok{align-items:flex-start;font-weight:600;font-size:13px;line-height:1.45}
.hucreler{display:flex;gap:3px}
.hucre{width:24px;height:32px;border:1px solid #bfc6b8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700}
.tarihler{display:grid;gap:14px;border:1px solid #d5dbcf;border-radius:10px;padding:12px 14px}
.tarih{display:flex;align-items:flex-start;gap:3px}
.tarih .grup{display:flex;flex-direction:column;align-items:center;gap:3px}
.tarih .grup>div{display:flex;gap:2px}
.tarih .hucre{width:19px;height:28px;font-size:14px}
.tarih .nokta{font-size:16px;font-weight:800;color:#6b7280;line-height:24px}
.ipucu{font-size:12px;line-height:1;color:#6b7280;letter-spacing:.04em}
.bant{display:flex;gap:14px;background:#eef5e2;border-radius:10px;padding:10px 12px}
.bant>div:first-child{width:120px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;font-size:12px}
.imzakutu{border:1px solid #bfc6b8;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.imzakutu b{font-size:12px;font-weight:800}
.satir{display:flex;align-items:flex-end;gap:8px}
.satir span{font-size:12px;color:#4b5563;flex-shrink:0;width:64px}
.satir div{flex-grow:1;border-bottom:1px solid #bfc6b8;min-height:18px;font-size:13px;font-weight:700;padding-bottom:1px}
.onay{border:1px solid #bfc6b8;border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.onay>b{background:#eef5e2;padding:8px 12px;font-size:12px;font-weight:800;letter-spacing:.04em;border-bottom:1px solid #bfc6b8}
.onay>div{padding:8px 12px 10px;display:flex;flex-direction:column;gap:8px}
.onay .imz{font-size:12px;color:#4b5563}
.secimler{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 16px;border:1px solid #d5dbcf;border-radius:10px;padding:14px 16px}
.secim{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600}
.secim small{display:block;font-size:12px;color:#6b7280;font-weight:500}
.isaret{width:16px;height:16px;border:1.5px solid #8a9480;border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.isaret.on{background:#4a6e0b;border-color:#4a6e0b}
.talep{background:#eef5e2;border-radius:10px;padding:16px 18px;font-size:14px;line-height:2.1}
.talep b{display:inline-block;min-width:60px;border-bottom:1px solid #8a9480;padding:0 6px;line-height:1.5;text-align:center}
footer{margin-top:auto;display:flex;gap:12px;border-top:1px solid #d5dbcf;padding-top:12px}
footer ul{margin:0;padding-left:16px;display:flex;flex-direction:column;gap:3px;font-size:12px;line-height:1.45;color:#2f3a2a}
.ust-oto{flex-grow:1}
.ust-oto>.g{flex-grow:1}
.ust-oto .onay>div{flex-grow:1}
.ust-oto .onay>div>div:last-child{flex-grow:1}
.onay>div.gm{display:grid;grid-template-columns:1.3fr .8fr 1fr;gap:16px;align-items:end;flex-direction:row;padding:10px 14px;height:56px}
.gm .satir span{width:auto}
""";

    private const string Ok = """<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a9480" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-top:26px;margin-left:auto;flex-shrink:0"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>""";

    private const string Tik = """<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>""";

    private static string Bolum(int no, string ad, string ic, bool alta = false) => $"""
<section{(alta ? " class=\"ust-oto\"" : "")}>
<div class="sb"><i>{no}</i><h2>{H(ad)}</h2><div></div></div>
{ic}
</section>
""";

    private static string Alan(string etiket, string deger, string birim = null, string ek = "") => $"""
<div><p class="etk">{H(etiket)}</p><div class="kutu{ek}"><span>{H(deger)}</span>{(birim is null ? "" : $"<u>{H(birim)}</u>")}</div></div>
""";

    private static string Izgara(string kolon, params string[] ic) =>
        $"<div class=\"g\" style=\"grid-template-columns:{kolon}\">{string.Concat(ic)}</div>";

    private static string Tc(string tc)
    {
        var sb = new StringBuilder("<div><p class=\"etk\">T.C. Kimlik Numarası</p><div class=\"hucreler\">");
        var r = (tc ?? "").Where(char.IsDigit).ToArray();

        for (var i = 0; i < 11; i++)
            sb.Append($"<div class=\"hucre\">{(i < r.Length ? r[i].ToString() : "")}</div>");

        return sb.Append("</div></div>").ToString();
    }

    private static string Tarih(string etiket, DateTime? t, bool ok = false)
    {
        var s = t?.ToString("ddMMyyyy") ?? "";

        string Grup(int bas, int adet, string ad)
        {
            var g = new StringBuilder("<div class=\"grup\"><div>");
            for (var i = bas; i < bas + adet; i++)
                g.Append($"<div class=\"hucre\">{(s.Length > i ? s[i].ToString() : "")}</div>");
            return g.Append($"</div><span class=\"ipucu\">{ad}</span></div>").ToString();
        }

        return $"""
<div style="display:flex;align-items:flex-start;gap:6px;min-width:0"><div style="min-width:0">
<p class="etk">{H(etiket)}</p>
<div class="tarih">{Grup(0, 2, "GG")}<span class="nokta">.</span>{Grup(2, 2, "AA")}<span class="nokta">.</span>{Grup(4, 4, "YYYY")}</div>
</div>{(ok ? Ok : "")}</div>
""";
    }

    private static string SaatAlani(string etiket, string saat)
    {
        var s = (saat ?? "").Replace(":", "");
        string H2(int b) => $"<div class=\"grup\"><div><div class=\"hucre\">{(s.Length > b ? s[b].ToString() : "")}</div><div class=\"hucre\">{(s.Length > b + 1 ? s[b + 1].ToString() : "")}</div></div><span class=\"ipucu\">{(b == 0 ? "SS" : "DK")}</span></div>";
        return $"""<div style="min-width:0"><p class="etk">{H(etiket)}</p><div class="tarih">{H2(0)}<span class="nokta">:</span>{H2(2)}</div></div>""";
    }

    private static string Secim(string ad, bool secili, string alt = null) =>
        $"<div class=\"secim\"><div class=\"isaret{(secili ? " on" : "")}\">{(secili ? Tik : "")}</div><div>{H(ad)}{(alt is null ? "" : $"<small>{H(alt)}</small>")}</div></div>";

    /// <summary>Onay kutusu; ilk satır (Adı Soyadı) önceden doldurulmuş.</summary>
    private static string OnayKutusuDolu(string ad, int imzaH, string adSoyad, params string[] satirlar) =>
        $"<div class=\"onay\"><b>{H(ad)}</b><div><div class=\"satir\"><span>Adı Soyadı</span><div>{H(adSoyad)}</div></div>{string.Concat(satirlar.Select(x => $"<div class=\"satir\"><span>{H(x)}</span><div></div></div>"))}<span class=\"imz\">İmza</span><div style=\"height:{imzaH}px\"></div></div></div>";

    private static string OnayKutusu(string ad, int imzaH, params string[] satirlar) =>
        $"<div class=\"onay\"><b>{H(ad)}</b><div>{string.Concat(satirlar.Select(x => $"<div class=\"satir\"><span>{H(x)}</span><div></div></div>"))}<span class=\"imz\">İmza</span><div style=\"height:{imzaH}px\"></div></div></div>";

    private static string YerineKutusu(string yerine) => $"""
<div class="imzakutu"><b>İzin Döneminde Yerine Destek Verecek Kişi</b>
<div class="satir"><span>Adı Soyadı</span><div>{H(yerine)}</div></div>
<div class="satir"><span>İmza</span><div style="min-height:22px"></div></div></div>
""";

    private string Ust(string baslik, string alt, Veri v) => $"""
<header>
<img src="{H(FormLogo())}" alt="Biçen">
<div class="bas"><small>İNSAN KAYNAKLARI</small><h1>{H(baslik)}</h1><span>{H(alt)}</span>
<em>Talep #{v.Id} · {v.Olusturma:dd.MM.yyyy HH:mm}</em></div>
</header>
""";

    private string Sayfa(string baslik, string govde) => $$"""
<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>{{H(baslik)}}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">
<style>{{Css}}</style></head>
<body>
<div class="arac"><button onclick="window.print()">Yazdır</button><span>A4 · kenar boşluğu “yok”, ölçek %100</span></div>
<div class="sayfa">
{{govde}}
</div>
</body></html>
""";

    /// <summary>Talebin türüne göre doldurulmuş A4 formu.</summary>
    public string FormHtml(dynamic t, PersonelKaydi p)
    {
        Veri v = Hazirla(t, p);

        return FormTuru(v.Tur, v.BasSaat) switch
        {
            "yillik" => Yillik(v),
            "ucretsiz" => Ucretsiz(v),
            "saatlik" => Saatlik(v),
            _ => Mazeret(v),
        };
    }

    private const string Uc = "repeat(3,minmax(0,1fr))";

    private string CalisanBolumu(Veri v, bool telefon) =>
        Bolum(1, "ÇALIŞAN BİLGİLERİ",
            Izgara("minmax(0,1fr) 300px", Alan("Adı Soyadı", v.AdSoyad), Tc(v.Tc)) +
            Izgara(Uc, Alan("Şube", v.Sube), Alan("Görev", v.Gorev),
                telefon ? Alan("Telefon Numarası", v.Telefon) : Alan("Biçen'de Çalışma Süresi", v.Kidem)));

    private string Yillik(Veri v)
    {
        var g = Ust("Yıllık İzin Formu", $"Ücretli izin · {v.Cikis.Year}", v);

        g += Bolum(1, "İZİN TALEBİNDE BULUNAN ÇALIŞAN",
            Izgara("minmax(0,1fr) 300px", Alan("Adı Soyadı", v.AdSoyad), Tc(v.Tc)) +
            Izgara(Uc, Alan("Şube", v.Sube), Alan("Görev", v.Gorev), Alan("Biçen'de Çalışma Süresi", v.Kidem)) +
            $"""
<div class="bant"><div><b>İzin hakkı</b><span style="color:#4b5563">Hak ettiği izni son kullanım tarihine kadar kullanır</span></div>
<div class="g" style="flex-grow:1;grid-template-columns:repeat(4,minmax(0,1fr))">
{Alan("Hak Ediş Tarihi", v.HakEdis?.ToString("dd.MM.yyyy"))}
{Alan("Son Kullanım Tarihi", v.KullanimSonu?.ToString("dd.MM.yyyy"))}
{Alan("Devreden İzin", Sayi(v.Devir), "gün")}
{Alan("Hak Kazanılan İzin", Sayi(v.HakEdilen), "gün")}
</div></div>
""");

        g += Bolum(2, "KULLANILACAK İZİN",
            $"<div class=\"tarihler\" style=\"grid-template-columns:{Uc}\">"
            + Tarih("İzin Başlangıç Tarihi", v.Cikis, true)
            + Tarih("İzin Bitiş Tarihi", v.Donus, true)
            + Tarih("Göreve Başlayacağı Tarih", v.Baslama) + "</div>"
            + Izgara(Uc,
                Alan("Kullanılacak İzin Süresi", Sayi(v.Gun) + (string.IsNullOrWhiteSpace(v.YarimGun) ? "" : $" · {v.YarimGun}"), "gün"),
                Alan("Geriye Kalan İzin Süresi", Sayi(v.Kalan), "gün"),
                Alan("Telefon Numarası", v.Telefon)));

        g += Bolum(3, "ÇALIŞAN VE YERİNE BAKACAK KİŞİ",
            Izgara("repeat(2,minmax(0,1fr))",
                "<div class=\"imzakutu\" style=\"height:84px\"><b>Çalışan İmza</b></div>",
                YerineKutusu(v.Yerine)));

        g += Bolum(4, "ONAY",
            Izgara(Uc,
                OnayKutusuDolu("BİRİM YÖNETİCİSİ / MAĞAZA YÖNETİCİSİ", 22, v.Yonetici, "Tarih"),
                OnayKutusu("BÖLGE MÜDÜRÜ", 22, "Adı Soyadı", "Tarih"),
                OnayKutusu("İNSAN KAYNAKLARI", 22, "Adı Soyadı", "Tarih")) +
            """
<div class="onay" style="flex-direction:row"><b style="width:170px;flex-shrink:0;display:flex;align-items:center;border-bottom:0;border-right:1px solid #bfc6b8;line-height:1.35">GENEL MÜDÜR /<br>GENEL MÜDÜR YARDIMCISI</b>
<div class="gm" style="flex-grow:1">
<div class="satir"><span>Adı Soyadı</span><div></div></div>
<div class="satir"><span>Tarih</span><div></div></div>
<div class="satir"><span>İmza</span><div></div></div></div></div>
""");

        g += """
<footer><ul>
<li>Yıllık izin formunu dolduran çalışanlar izne ayrılmadan önce mutlaka genel müdürlüğe gelerek resmi izin formunu imzalamakla sorumludur.</li>
<li>Farklı tarihleri kapsayan her izin dönemi için ayrı ayrı izin formu kullanılması gerekir.</li>
<li>Denkleştirme (fazla çalışma) için verilen izinler bu formda yer almamalıdır.</li>
</ul></footer>
""";

        return Sayfa($"Yıllık İzin Formu · {v.AdSoyad}", g);
    }

    private string Ucretsiz(Veri v)
    {
        var g = Ust("Ücretsiz İzin Formu", v.Cikis.Year.ToString(), v);

        g += Bolum(1, "ÇALIŞAN BİLGİLERİ",
            Izgara("minmax(0,1fr) 300px", Alan("Adı Soyadı", v.AdSoyad), Tc(v.Tc)) +
            Izgara("minmax(0,1fr) minmax(0,1fr)", Alan("Branşı ve Görevi", v.Gorev), Alan("Şube", v.Sube)) +
            Izgara("1fr", Alan("İkametgâh Adresi", "", ek: " cok\" style=\"height:56px")));

        g += Bolum(2, "İZİN BİLGİLERİ",
            $"<div class=\"tarihler\" style=\"grid-template-columns:{Uc}\">"
            + Tarih("İzin Başlama Tarihi", v.Cikis, true)
            + Tarih("İzin Sonrası İşbaşı Tarihi", v.Baslama)
            + $"<div style=\"min-width:0\"><p class=\"etk\">İzinli Olacağı Gün Sayısı</p><div class=\"kutu\"><span>{Sayi(v.Gun)}</span><u>gün</u></div></div>"
            + "</div>");

        /* Personelin yazdığı sebep; sonunda "dolayı / nedeniyle" varsa tekrarlanmaz */
        var sebep = System.Text.RegularExpressions.Regex.Replace((v.Aciklama ?? "").Trim(),
            @"[\s.,]*(dolay[ıi]|nedeniyle|sebebiyle)[\s.]*$", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var neden = string.IsNullOrWhiteSpace(sebep) ? "&nbsp;" : H(sebep);

        g += Bolum(3, "TALEP", $"""
<div class="talep">
<b style="min-width:220px">{neden}</b> dolayı <b>{v.Cikis:dd.MM.yyyy}</b> tarihinden <b>{v.Donus:dd.MM.yyyy}</b> tarihine kadar
<b style="min-width:36px">{Sayi(v.Gun)}</b> gün süreyle ücretsiz izne ayrılmak istiyorum.
<div style="font-weight:700;margin-top:6px;line-height:1.4">Gereğini arz ederim.</div>
</div>
<div class="g" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
<div style="display:flex;flex-direction:column;gap:14px;justify-content:flex-end">
<div class="satir"><span>Tarih</span><div>{v.Olusturma:dd.MM.yyyy}</div></div>
<div class="satir"><span style="width:auto">Yerine bakacak</span><div>{H(v.Yerine)}</div></div>
</div>
<div class="imzakutu" style="height:90px"><b>Çalışan İmza</b></div>
</div>
""");

        g += Bolum(4, "İŞVEREN ONAYI", """
<p style="margin:0;font-size:13px;font-weight:700;line-height:1.5">Yukarıda belirtilen tarihler arası ücretsiz izin kullanılması işyerimizce uygun görülmüştür.</p>
<div class="g" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
<div style="display:flex;flex-direction:column;gap:16px;justify-content:center">
<div class="satir"><span style="width:120px">Adı Soyadı / Ünvanı</span><div></div></div>
<div class="satir"><span style="width:120px">Tarih</span><div></div></div>
</div>
<div class="imzakutu" style="min-height:120px"><b>Kaşe / İmza</b></div>
</div>
""", alta: true);

        return Sayfa($"Ücretsiz İzin Formu · {v.AdSoyad}", g);
    }

    private static string ImzaOnay(Veri v) =>
        Izgara(Uc,
            OnayKutusu("ÇALIŞAN", 52, "Tarih"),
            OnayKutusuDolu("BİRİM YÖNETİCİSİ / MAĞAZA YÖNETİCİSİ", 28, v.Yonetici, "Tarih"),
            OnayKutusu("İNSAN KAYNAKLARI", 28, "Adı Soyadı", "Tarih"));

    private string Mazeret(Veri v)
    {
        var a = (v.Tur ?? "").ToLower(Tr);

        bool Var(params string[] k) => k.Any(a.Contains);

        var evlilik = Var("evlil", "evlen", "nikah");
        var dogum = Var("doğum", "babal");
        var olum = Var("ölüm", "vefat", "cenaze");
        var evlat = Var("evlat");
        var rapor = Var("rapor", "sağlık", "hastal");
        var diger = !(evlilik || dogum || olum || evlat || rapor);

        var g = Ust("Mazeret İzni Formu", "Evlilik · Doğum · Vefat ve diğer mazeretler", v);

        g += CalisanBolumu(v, telefon: true);

        g += Bolum(2, "İZİN TÜRÜ", "<div class=\"secimler\">"
            + Secim("Evlilik izni", evlilik)
            + Secim("Doğum / Babalık izni", dogum)
            + Secim("Ölüm izni", olum, "Yakınlık: ……………………")
            + Secim("Evlat edinme izni", evlat)
            + Secim("Raporlu / sağlık", rapor)
            + Secim("Diğer", diger, diger ? v.Tur : "……………………………………")
            + "</div>");

        g += Bolum(3, "İZİN TARİHLERİ",
            $"<div class=\"tarihler\" style=\"grid-template-columns:{Uc}\">"
            + Tarih("İzin Başlangıç Tarihi", v.Cikis, true)
            + Tarih("İzin Bitiş Tarihi", v.Donus, true)
            + Tarih("Göreve Başlayacağı Tarih", v.Baslama) + "</div>"
            + Izgara("200px minmax(0,1fr)",
                Alan("İzin Süresi", Sayi(v.Gun), "gün"),
                Alan("Eklenen Belge (evlilik cüzdanı, doğum / ölüm belgesi vb.)", ""))
            + Izgara("minmax(0,1.4fr) minmax(0,1fr)",
                Alan("Açıklama", v.Aciklama, ek: " cok\" style=\"height:52px"),
                Alan("Yerine Bakacak Kişi", v.Yerine)));

        g += Bolum(4, "İMZA VE ONAY", ImzaOnay(v), alta: true);

        return Sayfa($"Mazeret İzni Formu · {v.AdSoyad}", g);
    }

    private string Saatlik(Veri v)
    {
        var g = Ust("Saatlik İzin Formu", "Gün içinde kısa süreli izin", v);

        g += CalisanBolumu(v, telefon: true);

        g += Bolum(2, "İZİN ZAMANI",
            "<div class=\"tarihler\" style=\"grid-template-columns:1.25fr .8fr .8fr .9fr;align-items:start\">"
            + Tarih("İzin Tarihi", v.Cikis)
            + SaatAlani("Çıkış Saati", v.BasSaat)
            + SaatAlani("Dönüş Saati", v.BitSaat)
            + $"<div style=\"min-width:0\"><p class=\"etk\">Toplam Süre</p><div class=\"kutu\"><span>{Sayi(v.Saat)}</span><u>saat</u></div></div>"
            + "</div>");

        g += Bolum(3, "İZİN NEDENİ", "<div class=\"secimler\">"
            + Secim("Sağlık / hastane", false) + Secim("Resmi işlem", false) + Secim("Okul / çocuk", false)
            + Secim("Ailevi", false) + Secim("Banka / kişisel işlem", false) + Secim("Diğer", false)
            + "</div>"
            + Izgara("minmax(0,1.4fr) minmax(0,1fr)",
                Alan("Açıklama", v.Aciklama, ek: " cok\" style=\"height:64px"),
                Alan("Yerine Bakacak Kişi", v.Yerine)));

        g += Bolum(4, "İMZA VE ONAY", ImzaOnay(v), alta: true);

        return Sayfa($"Saatlik İzin Formu · {v.AdSoyad}", g);
    }
}

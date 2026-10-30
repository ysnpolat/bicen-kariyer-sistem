using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// İcra / maaş haczi takibi (30.10.2026) — /api/Hukuk/Icra/…
/// ---------------------------------------------------------------------------
/// <para>
/// Personele gelen haciz ihbarnameleri ve nafaka dosyaları: sıra, aylık
/// kesinti hesabı (IcraServisi), ödeme ve dekont, tebligat cevap yazısı,
/// işten ayrılış yazısı, zaman çizelgesi, belgeler ve dönem listesi (Excel
/// panelde üretilir).
/// </para>
/// <para>
/// Yetki: hukuk masası "tam" (Admin, İK yöneticisi, GMY, ekip rolü hukuk)
/// her şeyi yapar; hukuk "okuma" yalnız görür; İK uzmanı rolüne Rol
/// Yetkileri'nden "icra" sayfası açıkça verilmişse tam yetki. Dış danışman
/// (hd:) bu uçlara HİÇBİR koşulda giremez: hem burada hem Program.cs'teki
/// süzgeçte kapalı. Günlüğe ad / tutar yazılmaz, yalnız dosya numarası.
/// </para>
/// </summary>
public partial class HukukController
{
    private IcraServisi Icra => HttpContext.RequestServices.GetRequiredService<IcraServisi>();

    /// <summary>Kişi ve icra hakkı: "tam" / "okuma"; erişimi yoksa (danışman dahil) null.</summary>
    private (Kimlik Ben, string Hak) IcraKimlik(System.Data.IDbConnection db)
    {
        var ad = User?.Identity?.Name ?? "";
        var rol = User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";
        if (rol == DanismanRolu || ad.StartsWith(DanismanOnek)) return (null, null);

        var ben = Ben(db);
        if (ben is not null && ben.Tur != "danisman")
            return (ben, ben.Yetki == "tam" ? "tam" : ben.Yetki == "okuma" ? "okuma" : null);

        /* Hukuk ekibinde olmayan İK kullanıcısı: rolüne "icra" sayfası
           açıkça verilmişse (boş liste = hepsi kuralı burada GEÇMEZ) */
        if (ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return (null, null);
        var temel = Roller.Temel(rol);
        if (temel is not (Roller.IK or Roller.IKYoneticisi)) return (null, null);
        var yetki = HttpContext.RequestServices.GetService<YetkiServisi>()?.Oku(rol);
        if (yetki?.Menuler is null || !yetki.Menuler.Contains("icra")) return (null, null);
        var adSoyad = User?.FindFirst("adSoyad")?.Value ?? ad;
        return (new Kimlik("u:" + ad.Trim(), adSoyad, "Biçen · İnsan Kaynakları", "ic", "tam", null), yetki.SaltOkunur ? "okuma" : "tam");
    }

    private IActionResult IcraYasak() => StatusCode(403, new { hata = "İcra takibine erişiminiz yok." });

    private void IcraLogla(System.Data.IDbConnection db, Kimlik ben, string islem, int? dosyaId, string hedef = null)
    {
        try
        {
            db.Execute("INSERT INTO KRY_ICRA_LOG (anahtar, ad, islem, dosya_id, hedef, ip) VALUES (@a, @ad, @islem, @dosyaId, @hedef, @ip)",
                new { a = ben?.Anahtar, ad = ben?.Ad, islem, dosyaId, hedef = hedef is { Length: > 300 } ? hedef[..300] : hedef, ip = IstemciAdresi.Bul(HttpContext) });
        }
        catch (Exception h) { _kayit.LogWarning(h, "İcra günlüğü yazılamadı"); }
    }

    private static object DosyaNesnesi(IcraServisi.DosyaOzeti d, dynamic x = null) => new
    {
        id = d.Id, dosyaNo = d.DosyaNo, sicil = d.Sicil, personelAd = d.PersonelAd, tur = d.Tur, turAdi = IcraServisi.Turler.GetValueOrDefault(d.Tur, d.Tur),
        icraDairesi = d.IcraDairesi, esasNo = d.EsasNo, alacakli = d.Alacakli, odemeHesabi = d.OdemeHesabi,
        tebligTarihi = d.TebligTarihi, gelisTarihi = d.GelisTarihi, baslangic = d.Baslangic,
        toplamBorc = d.ToplamBorc, kesilen = d.Kesilen, odenen = d.Odenen, kalan = d.Kalan, aylikTutar = d.AylikTutar,
        durum = d.Durum, durumAdi = IcraServisi.Durumlar.GetValueOrDefault(d.Durum, d.Durum), sira = d.Sira, siraElle = d.SiraElle,
        /* Ayrıntı alanları (listede de gelsin diye dinamik satırdan) */
        alacakliVekili = x is null ? null : (string)x.alacakli_vekili,
        cevapSuresi = x is null ? null : (DateTime?)x.cevap_suresi,
        cevapTarihi = x is null ? null : (DateTime?)x.cevap_tarihi,
        asilAlacak = x is null ? null : (decimal?)x.asil_alacak,
        faiz = x is null ? null : (decimal?)x.faiz,
        masraf = x is null ? null : (decimal?)x.masraf,
        siraNotu = x is null ? null : (string)x.sira_notu,
        notlar = x is null ? null : (string)x.notlar,
        kapanisTarihi = x is null ? null : (DateTime?)x.kapanis_tarihi,
        ayrilisBildirildi = x is null ? null : (DateTime?)x.ayrilis_bildirildi,
        olusturma = d.Olusturma,
    };

    /// <summary>Oturumdaki kişinin icra hakkı, oran ve sözlükler.</summary>
    [HttpGet("Icra/Ben")]
    public IActionResult IcraBen()
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak is null) return Ok(new { yetkili = false });
        return Ok(new
        {
            yetkili = true, hak, ad = ben.Ad,
            oran = IcraServisi.Oran(), cevapGun = IcraServisi.CevapGun(),
            turler = IcraServisi.Turler.Select(x => new { kod = x.Key, ad = x.Value }),
            durumlar = IcraServisi.Durumlar.Select(x => new { kod = x.Key, ad = x.Value }),
            olayTurleri = IcraServisi.OlayTurleri.Select(x => new { kod = x.Key, ad = x.Value }),
        });
    }

    /// <summary>Masa panosu için özet sayılar.</summary>
    [HttpGet("Icra/Ozet")]
    public IActionResult IcraOzet()
    {
        using var db = _vt.Baglanti();
        var (_, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        var bugun = DateTime.Today;
        var donem = IcraServisi.DonemYaz(bugun.Year, bugun.Month);
        var o = db.QueryFirstOrDefault(@"
SELECT
  (SELECT COUNT(*) FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND tur = N'icra') AS icra,
  (SELECT COUNT(*) FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND tur = N'nafaka') AS nafaka,
  (SELECT COUNT(DISTINCT sicil) FROM KRY_ICRA_DOSYA WHERE durum = N'acik') AS personel,
  (SELECT COUNT(*) FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND cevap_tarihi IS NULL AND cevap_suresi IS NOT NULL AND cevap_suresi >= @bugun AND cevap_suresi < DATEADD(DAY, 3, @bugun)) AS cevapYakin,
  (SELECT COUNT(*) FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND cevap_tarihi IS NULL AND cevap_suresi IS NOT NULL AND cevap_suresi < @bugun) AS cevapGecti,
  (SELECT COUNT(*) FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND ayrilis_bildirildi IS NOT NULL) AS ayrilan,
  (SELECT ISNULL(SUM(tutar), 0) FROM KRY_ICRA_KESINTI WHERE donem = @donem) AS buAyKesinti,
  (SELECT COUNT(*) FROM KRY_ICRA_KESINTI WHERE donem = @donem AND odendi = 0) AS buAyOdenmemis,
  (SELECT ISNULL(SUM(toplam_borc), 0) FROM KRY_ICRA_DOSYA WHERE durum = N'acik' AND tur = N'icra') AS toplamBorc", new { bugun, donem });
        return Ok(new
        {
            icra = (int)o.icra, nafaka = (int)o.nafaka, personel = (int)o.personel, cevapYakin = (int)o.cevapYakin, cevapGecti = (int)o.cevapGecti,
            ayrilan = (int)o.ayrilan, buAyKesinti = Convert.ToDecimal(o.buAyKesinti), buAyOdenmemis = (int)o.buAyOdenmemis, toplamBorc = Convert.ToDecimal(o.toplamBorc), donem,
        });
    }

    /* ==================================================================== */
    /* Dosyalar                                                              */
    /* ==================================================================== */

    [HttpGet("Icra/Dosyalar")]
    public IActionResult IcraDosyalar([FromQuery] string durum = "acik", [FromQuery] string tur = null, [FromQuery] string q = null, [FromQuery] string sicil = null)
    {
        using var db = _vt.Baglanti();
        var (_, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        q = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        var l = db.Query(@"
SELECT d.*,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id), 0) AS kesilen,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id AND k.odendi = 1), 0) AS odenen
FROM KRY_ICRA_DOSYA d
WHERE (@durum = N'hepsi' OR (@durum = N'kapandi' AND d.durum IN (N'kapandi', N'feragat', N'iptal')) OR (@durum NOT IN (N'hepsi', N'kapandi') AND d.durum = @durum))
  AND (@tur IS NULL OR d.tur = @tur)
  AND (@sicil IS NULL OR d.sicil = @sicil)
  AND (@q IS NULL OR d.personel_ad LIKE N'%' + @q + N'%' OR d.sicil LIKE N'%' + @q + N'%' OR d.alacakli LIKE N'%' + @q + N'%'
       OR d.esas_no LIKE N'%' + @q + N'%' OR d.icra_dairesi LIKE N'%' + @q + N'%' OR d.dosya_no LIKE N'%' + @q + N'%')
ORDER BY d.sicil, d.id DESC",
            new { durum = durum ?? "acik", tur = string.IsNullOrWhiteSpace(tur) ? null : tur, sicil = string.IsNullOrWhiteSpace(sicil) ? null : IcraServisi.K(sicil), q }).ToList();

        /* Sıra kişinin BÜTÜN açık dosyalarına göre hesaplanır (süzgeç dar olsa da) */
        var siciller = l.Select(x => (string)x.sicil).Distinct().ToList();
        var siralar = new Dictionary<int, int>();
        foreach (var s in siciller)
            foreach (var d in Icra.Dosyalar(db, s, yalnizAcik: true)) siralar[d.Id] = d.Sira;

        var dosyalar = l.Select(x =>
        {
            var d = IcraServisi.Ozet((object)x);
            d.Sira = siralar.GetValueOrDefault(d.Id);
            return DosyaNesnesi(d, x);
        }).ToList();
        var sayilar = db.Query<(string d, int n)>("SELECT durum, COUNT(*) FROM KRY_ICRA_DOSYA GROUP BY durum").ToDictionary(x => x.d, x => x.n);
        return Ok(new
        {
            dosyalar,
            sayilar = new { acik = sayilar.GetValueOrDefault("acik"), askida = sayilar.GetValueOrDefault("askida"),
                kapandi = sayilar.GetValueOrDefault("kapandi") + sayilar.GetValueOrDefault("feragat") + sayilar.GetValueOrDefault("iptal") },
        });
    }

    private object IcraBelgeNesne(dynamic b) => new
    {
        id = (int)b.id, ad = (string)b.ad, tur = (string)b.icerik_turu, boyut = (long)b.boyut,
        uzanti = Path.GetExtension((string)b.ad ?? "").TrimStart('.').ToUpperInvariant(),
        yukleyenAd = (string)b.yukleyen_ad, tarih = (DateTime)b.olusturma, kesintiId = (int?)b.kesinti_id, dosyaId = (int)b.dosya_id,
    };

    [HttpGet("Icra/Dosya/{id:int}")]
    public IActionResult IcraDosya(int id)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        var x = db.QueryFirstOrDefault(@"
SELECT d.*,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id), 0) AS kesilen,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id AND k.odendi = 1), 0) AS odenen
FROM KRY_ICRA_DOSYA d WHERE d.id = @id", new { id });
        if (x is null) return NotFound(new { hata = "Dosya bulunamadı." });
        var d = IcraServisi.Ozet((object)x);
        var kisininDosyalari = Icra.Dosyalar(db, d.Sicil);
        d.Sira = kisininDosyalari.FirstOrDefault(k => k.Id == id)?.Sira ?? 0;
        IcraLogla(db, ben, "dosya_ac", id, d.DosyaNo);

        var olaylar = db.Query("SELECT * FROM KRY_ICRA_OLAY WHERE dosya_id = @id ORDER BY tarih DESC, id DESC", new { id })
            .Select(o => new
            {
                id = (int)o.id, tur = (string)o.tur, turAdi = IcraServisi.OlayTurleri.GetValueOrDefault((string)o.tur, (string)o.tur),
                tarih = (DateTime)o.tarih, baslik = (string)o.baslik, aciklama = (string)o.aciklama, tutar = (decimal?)o.tutar, ekleyenAd = (string)o.ekleyen_ad,
            }).ToList();
        var belgeler = db.Query("SELECT * FROM KRY_ICRA_BELGE WHERE dosya_id = @id AND silindi = 0 ORDER BY id DESC", new { id }).Select(IcraBelgeNesne).ToList();
        var kesintiler = db.Query(@"
SELECT k.*, b.ad AS dekont_ad FROM KRY_ICRA_KESINTI k LEFT JOIN KRY_ICRA_BELGE b ON b.id = k.dekont_id AND b.silindi = 0
WHERE k.dosya_id = @id ORDER BY k.donem DESC, k.id DESC", new { id })
            .Select(KesintiNesne).ToList();

        var p = Icra.Personel(d.Sicil);
        var bugun = DateTime.Today;
        var donem = IcraServisi.DonemYaz(bugun.Year, bugun.Month);
        var hesap = d.Durum == "acik" ? Icra.Hesapla(db, d.Sicil, donem, kisininDosyalari.Where(k => k.Durum == "acik").ToList()) : null;

        return Ok(new
        {
            hak,
            dosya = DosyaNesnesi(d, x),
            personel = p is null ? null : new
            {
                ad = $"{p.Ad} {p.Soyad}".Trim(), pozisyon = p.Pozisyon, sube = p.IsGrubu, giris = p.GirisTarihi, cikis = p.CikisTarihi,
                aktif = p.Durum == 1 && (p.CikisTarihi is null || p.CikisTarihi > bugun),
            },
            digerDosyalar = kisininDosyalari.Where(k => k.Id != id).Select(k => DosyaNesnesi(k)).ToList(),
            olaylar, belgeler, kesintiler,
            buAy = hesap is null ? null : HesapNesne(hesap),
        });
    }

    private static object KesintiNesne(dynamic k) => new
    {
        id = (int)k.id, dosyaId = (int)k.dosya_id, sicil = (string)k.sicil, donem = (string)k.donem, donemAdi = IcraServisi.DonemAdi((string)k.donem),
        tur = (string)k.tur, tutar = (decimal)k.tutar, netMaas = (decimal?)k.net_maas, maasKaynak = (string)k.maas_kaynak, sira = (int?)k.sira,
        odendi = (bool)k.odendi, odemeTarihi = (DateTime?)k.odeme_tarihi, dekontId = (int?)k.dekont_id, dekontAd = (string)k.dekont_ad, aciklama = (string)k.aciklama,
    };

    private static object HesapNesne(IcraServisi.Hesap h) => new
    {
        h.Sicil, h.PersonelAd, h.Donem, donemAdi = IcraServisi.DonemAdi(h.Donem), h.NetMaas, h.MaasKaynak, h.Oran, h.OranPayi, h.Nafaka, h.Icra, h.Toplam, h.Kaydedildi,
        satirlar = h.Satirlar.Select(s => new { s.DosyaId, s.DosyaNo, s.Tur, s.Sira, s.Tutar, s.Alacakli, s.IcraDairesi, s.EsasNo, s.OdemeHesabi, s.ToplamBorc, s.KalanSonra, s.Kapanir }),
        uyarilar = h.Uyarilar,
    };

    public sealed class IcraDosyaGirdisi
    {
        public string Sicil { get; set; }
        public string Tur { get; set; }
        public string IcraDairesi { get; set; }
        public string EsasNo { get; set; }
        public string Alacakli { get; set; }
        public string AlacakliVekili { get; set; }
        public DateTime? TebligTarihi { get; set; }
        public DateTime? GelisTarihi { get; set; }
        public decimal? AsilAlacak { get; set; }
        public decimal? Faiz { get; set; }
        public decimal? Masraf { get; set; }
        public decimal? ToplamBorc { get; set; }
        public decimal? AylikTutar { get; set; }
        public DateTime? Baslangic { get; set; }
        public string OdemeHesabi { get; set; }
        public string Notlar { get; set; }
        /// <summary>Borç güncellemesinin gerekçesi (ek haciz, faiz güncellemesi…)</summary>
        public string GuncellemeNotu { get; set; }
    }

    /// <summary>Yeni icra / nafaka dosyası ya da güncelleme. Borç değişirse olay yazılır.</summary>
    [HttpPost("Icra/Dosya")]
    [HttpPost("Icra/Dosya/{id:int}")]
    public IActionResult IcraDosyaKaydet(int? id, [FromBody] IcraDosyaGirdisi g)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        if (hak != "tam") return StatusCode(403, new { hata = "Okuma yetkisiyle dosya kaydedilemez." });
        if (g is null || !IcraServisi.Turler.ContainsKey(g.Tur ?? "")) return BadRequest(new { hata = "Dosya türünü seçiniz." });
        var sicil = IcraServisi.K(g.Sicil);
        if (sicil.Length == 0) return BadRequest(new { hata = "Personel sicilini giriniz." });
        var p = Icra.Personel(sicil);
        if (id is null && p is null) return BadRequest(new { hata = "Bu sicilde personel bulunamadı." });
        if (g.Tur == "nafaka" && (g.AylikTutar ?? 0) <= 0) return BadRequest(new { hata = "Nafaka için aylık tutarı giriniz." });

        var toplam = g.ToplamBorc ?? ((g.AsilAlacak ?? 0) + (g.Faiz ?? 0) + (g.Masraf ?? 0));
        if (g.Tur == "icra" && toplam <= 0) return BadRequest(new { hata = "Toplam borcu giriniz (asıl alacak + faiz + masraf)." });
        if (toplam < 0 || toplam > 99_999_999) return BadRequest(new { hata = "Tutar geçersiz." });

        var teblig = g.TebligTarihi?.Date;
        var cevapSuresi = teblig?.AddDays(IcraServisi.CevapGun());
        var prm = new
        {
            sicil, ad = p is null ? null : $"{p.Ad} {p.Soyad}".Trim(), tur = g.Tur, daire = Kirp(g.IcraDairesi, 200), esas = Kirp(g.EsasNo, 60),
            alacakli = Kirp(g.Alacakli, 200), vekil = Kirp(g.AlacakliVekili, 200), teblig, gelis = g.GelisTarihi?.Date ?? teblig, cevapSuresi,
            asil = g.AsilAlacak, faiz = g.Faiz, masraf = g.Masraf, toplam, aylik = g.Tur == "nafaka" ? g.AylikTutar : null,
            baslangic = g.Baslangic?.Date, hesap = Kirp(g.OdemeHesabi, 300), notlar = Kirp(g.Notlar, 2000), kim = ben.Anahtar,
        };

        if (id is null)
        {
            if (db.State != System.Data.ConnectionState.Open) db.Open();
            using var tx = db.BeginTransaction();
            var yil = DateTime.Today.Year;
            var son = db.ExecuteScalar<int?>(@"SELECT MAX(CAST(SUBSTRING(dosya_no, 9, 10) AS INT)) FROM KRY_ICRA_DOSYA WITH (UPDLOCK, HOLDLOCK)
WHERE dosya_no LIKE @onek", new { onek = $"İC-{yil}-%" }, tx) ?? 0;
            var no = $"İC-{yil}-{son + 1:000}";
            var yeni = db.ExecuteScalar<int>(@"
INSERT INTO KRY_ICRA_DOSYA (dosya_no, sicil, personel_ad, tur, icra_dairesi, esas_no, alacakli, alacakli_vekili, teblig_tarihi, gelis_tarihi, cevap_suresi,
    asil_alacak, faiz, masraf, toplam_borc, aylik_tutar, baslangic, odeme_hesabi, notlar, olusturan)
OUTPUT INSERTED.id
VALUES (@no, @sicil, @ad, @tur, @daire, @esas, @alacakli, @vekil, @teblig, @gelis, @cevapSuresi, @asil, @faiz, @masraf, @toplam, @aylik, @baslangic, @hesap, @notlar, @kim)",
                new { no, prm.sicil, prm.ad, prm.tur, prm.daire, prm.esas, prm.alacakli, prm.vekil, prm.teblig, prm.gelis, prm.cevapSuresi, prm.asil, prm.faiz, prm.masraf, prm.toplam, prm.aylik, prm.baslangic, prm.hesap, prm.notlar, prm.kim }, tx);
            db.Execute(@"INSERT INTO KRY_ICRA_OLAY (dosya_id, tur, tarih, baslik, aciklama, tutar, ekleyen, ekleyen_ad) VALUES (@id, N'tebligat', @t, @b, @a, @tutar, @kim, @ad)",
                new { id = yeni, t = (prm.teblig ?? DateTime.Today).AddHours(9), b = g.Tur == "nafaka" ? "Nafaka kararı / tebligat geldi" : "Haciz ihbarnamesi tebliğ edildi",
                      a = g.Tur == "nafaka" ? $"Aylık nafaka {prm.aylik:N2} ₺" : $"Toplam borç {toplam:N2} ₺{(cevapSuresi is null ? "" : $" · cevap süresi {cevapSuresi:dd.MM.yyyy}")}",
                      tutar = g.Tur == "nafaka" ? prm.aylik : toplam, kim = ben.Anahtar, ad = ben.Ad }, tx);
            tx.Commit();
            IcraLogla(db, ben, "dosya_ac_yeni", yeni, no);
            return Ok(new { id = yeni, dosyaNo = no });
        }

        var eski = db.QueryFirstOrDefault("SELECT toplam_borc, aylik_tutar, dosya_no, teblig_tarihi, cevap_tarihi FROM KRY_ICRA_DOSYA WHERE id = @id", new { id });
        if (eski is null) return NotFound(new { hata = "Dosya bulunamadı." });
        /* Cevap süresi: tebliğ değişmediyse eski değer korunur */
        var tebligDegisti = (DateTime?)eski.teblig_tarihi != teblig;
        db.Execute(@"
UPDATE KRY_ICRA_DOSYA SET sicil = @sicil, personel_ad = ISNULL(@ad, personel_ad), tur = @tur, icra_dairesi = @daire, esas_no = @esas, alacakli = @alacakli,
    alacakli_vekili = @vekil, teblig_tarihi = @teblig, gelis_tarihi = @gelis, cevap_suresi = CASE WHEN @tebligDegisti = 1 THEN @cevapSuresi ELSE cevap_suresi END,
    asil_alacak = @asil, faiz = @faiz, masraf = @masraf, toplam_borc = @toplam, aylik_tutar = @aylik, baslangic = @baslangic, odeme_hesabi = @hesap,
    notlar = @notlar, guncelleme = SYSDATETIME()
WHERE id = @id",
            new { id, prm.sicil, prm.ad, prm.tur, prm.daire, prm.esas, prm.alacakli, prm.vekil, prm.teblig, prm.gelis, prm.cevapSuresi, tebligDegisti = tebligDegisti ? 1 : 0,
                  prm.asil, prm.faiz, prm.masraf, prm.toplam, prm.aylik, prm.baslangic, prm.hesap, prm.notlar });
        if ((decimal)eski.toplam_borc != toplam || (decimal?)eski.aylik_tutar != prm.aylik)
        {
            var aciklama = Kirp(g.GuncellemeNotu, 900);
            var metin = (decimal)eski.toplam_borc != toplam
                ? $"Toplam borç {(decimal)eski.toplam_borc:N2} ₺ → {toplam:N2} ₺"
                : $"Aylık nafaka {(decimal?)eski.aylik_tutar:N2} ₺ → {prm.aylik:N2} ₺";
            IcraServisi.OlayYaz(db, id.Value, "borc", DateTime.Now, "Borç güncellendi", aciklama is null ? metin : $"{metin}\n{aciklama}", toplam, ben.Anahtar, ben.Ad);
        }
        IcraLogla(db, ben, "dosya_guncelle", id, (string)eski.dosya_no);
        return Ok(new { id });
    }

    public sealed class IcraDurumGirdisi
    {
        /// <summary>acik / askida / kapandi / feragat / iptal</summary>
        public string Durum { get; set; }
        public string Not { get; set; }
    }

    [HttpPost("Icra/Dosya/{id:int}/Durum")]
    public IActionResult IcraDurum(int id, [FromBody] IcraDurumGirdisi g)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        if (g is null || !IcraServisi.Durumlar.ContainsKey(g.Durum ?? "")) return BadRequest(new { hata = "Durum geçersiz." });
        var no = db.ExecuteScalar<string>("SELECT dosya_no FROM KRY_ICRA_DOSYA WHERE id = @id", new { id });
        if (no is null) return NotFound();
        var kapanis = g.Durum is "kapandi" or "feragat" or "iptal";
        db.Execute(@"UPDATE KRY_ICRA_DOSYA SET durum = @d, kapanis_tarihi = CASE WHEN @kapanis = 1 THEN CAST(GETDATE() AS DATE) ELSE NULL END, guncelleme = SYSDATETIME() WHERE id = @id",
            new { id, d = g.Durum, kapanis = kapanis ? 1 : 0 });
        var olayTur = g.Durum switch { "kapandi" => "kapandi", "feragat" or "iptal" => "feragat", "askida" => "askiya", _ => "not" };
        var baslik = g.Durum switch { "kapandi" => "Dosya kapatıldı", "feragat" => "Alacaklı feragat etti", "iptal" => "Dosya iptal edildi", "askida" => "Askıya alındı", _ => "Dosya yeniden açıldı" };
        IcraServisi.OlayYaz(db, id, olayTur, DateTime.Now, baslik, Kirp(g.Not, 1000), null, ben.Anahtar, ben.Ad);
        IcraLogla(db, ben, "durum_" + g.Durum, id, no);
        return Ok(new { tamam = true });
    }

    public sealed class IcraSiraGirdisi
    {
        /// <summary>Boş = otomatik sıraya dön</summary>
        public int? Sira { get; set; }
        public string Not { get; set; }
    }

    /// <summary>İK elle sıra verir; gerekçe notu zorunlu, olay yazılır.</summary>
    [HttpPost("Icra/Dosya/{id:int}/Sira")]
    public IActionResult IcraSira(int id, [FromBody] IcraSiraGirdisi g)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var not = Kirp(g?.Not, 300);
        if (not is null) return BadRequest(new { hata = "Sıra değişikliğinin gerekçesini yazınız." });
        if (g.Sira is < 1 or > 99) return BadRequest(new { hata = "Sıra 1–99 arası olmalı." });
        var no = db.ExecuteScalar<string>("SELECT dosya_no FROM KRY_ICRA_DOSYA WHERE id = @id", new { id });
        if (no is null) return NotFound();
        db.Execute("UPDATE KRY_ICRA_DOSYA SET sira = @s, sira_notu = @n, guncelleme = SYSDATETIME() WHERE id = @id", new { id, s = g.Sira, n = not });
        IcraServisi.OlayYaz(db, id, "sira", DateTime.Now, g.Sira is null ? "Sıra otomatiğe döndü" : $"Sıra elle {g.Sira} yapıldı", not, null, ben.Anahtar, ben.Ad);
        IcraLogla(db, ben, "sira", id, no);
        return Ok(new { tamam = true });
    }

    public sealed class IcraOlayGirdisi
    {
        public string Tur { get; set; }
        public DateTime? Tarih { get; set; }
        public string Baslik { get; set; }
        public string Aciklama { get; set; }
        public decimal? Tutar { get; set; }
    }

    /// <summary>Zaman çizelgesine olay: ek haciz, faiz güncellemesi, feragat yazısı, not…</summary>
    [HttpPost("Icra/Dosya/{id:int}/Olay")]
    public IActionResult IcraOlayEkle(int id, [FromBody] IcraOlayGirdisi g)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        if (g is null || !IcraServisi.OlayTurleri.ContainsKey(g.Tur ?? "")) return BadRequest(new { hata = "Olay türünü seçiniz." });
        var no = db.ExecuteScalar<string>("SELECT dosya_no FROM KRY_ICRA_DOSYA WHERE id = @id", new { id });
        if (no is null) return NotFound();
        var baslik = Kirp(g.Baslik, 200) ?? IcraServisi.OlayTurleri[g.Tur];
        IcraServisi.OlayYaz(db, id, g.Tur, g.Tarih ?? DateTime.Now, baslik, Kirp(g.Aciklama, 1000), g.Tutar, ben.Anahtar, ben.Ad);
        if (g.Tur == "cevap")
            db.Execute("UPDATE KRY_ICRA_DOSYA SET cevap_tarihi = @t, guncelleme = SYSDATETIME() WHERE id = @id", new { id, t = (g.Tarih ?? DateTime.Now).Date });
        IcraLogla(db, ben, "olay_ekle", id, $"{no} · {IcraServisi.OlayTurleri[g.Tur]}");
        return Ok(new { tamam = true });
    }

    [HttpDelete("Icra/Olay/{oid:int}")]
    public IActionResult IcraOlaySil(int oid)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var o = db.QueryFirstOrDefault("SELECT dosya_id, tur FROM KRY_ICRA_OLAY WHERE id = @oid", new { oid });
        if (o is null) return NotFound();
        if ((string)o.tur is "kesinti" or "odeme" or "kapandi") return BadRequest(new { hata = "Sistemin yazdığı kesinti, ödeme ve kapanış kayıtları silinemez." });
        db.Execute("DELETE FROM KRY_ICRA_OLAY WHERE id = @oid", new { oid });
        IcraLogla(db, ben, "olay_sil", (int)o.dosya_id);
        return Ok(new { tamam = true });
    }

    /* ==================================================================== */
    /* Hazır yazılar                                                         */
    /* ==================================================================== */

    /// <summary>Haciz ihbarnamesine cevap yazısı taslağı (kopyalanabilir metin).</summary>
    [HttpGet("Icra/Dosya/{id:int}/Cevap")]
    public IActionResult IcraCevap(int id, [FromQuery] string donem = null)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        var x = db.QueryFirstOrDefault("SELECT d.*, 0 AS kesilen, 0 AS odenen FROM KRY_ICRA_DOSYA d WHERE d.id = @id", new { id });
        if (x is null) return NotFound();
        var d = IcraServisi.Ozet((object)x);
        var dosyalar = Icra.Dosyalar(db, d.Sicil);
        var tam = dosyalar.FirstOrDefault(k => k.Id == id) ?? d;
        var bugun = DateTime.Today;
        donem ??= IcraServisi.DonemYaz(bugun.Year, bugun.Month);
        IcraLogla(db, ben, "cevap_yazisi", id, d.DosyaNo);
        return Ok(new { metin = Icra.CevapYazisi(db, tam, donem), cevapSuresi = (DateTime?)x.cevap_suresi, cevapTarihi = (DateTime?)x.cevap_tarihi });
    }

    /// <summary>İşten ayrılış bildirimi yazısı taslağı.</summary>
    [HttpGet("Icra/Dosya/{id:int}/AyrilisYazisi")]
    public IActionResult IcraAyrilisYazisi(int id)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        var x = db.QueryFirstOrDefault("SELECT d.sicil FROM KRY_ICRA_DOSYA d WHERE d.id = @id", new { id });
        if (x is null) return NotFound();
        var d = Icra.Dosyalar(db, (string)x.sicil).FirstOrDefault(k => k.Id == id);
        if (d is null) return NotFound();
        IcraLogla(db, ben, "ayrilis_yazisi", id, d.DosyaNo);
        return Ok(new { metin = Icra.AyrilisYazisi(d) });
    }

    /* ==================================================================== */
    /* Kesinti: hesap, dönem listesi, net maaş, ödeme ve dekont               */
    /* ==================================================================== */

    /// <summary>Bir personelin bir dönemdeki kesinti hesabı (önizleme).</summary>
    [HttpGet("Icra/Hesap")]
    public IActionResult IcraHesap([FromQuery] string sicil, [FromQuery] string donem = null)
    {
        using var db = _vt.Baglanti();
        var (_, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        if (string.IsNullOrWhiteSpace(sicil)) return BadRequest(new { hata = "Sicil gerekli." });
        var bugun = DateTime.Today;
        donem ??= IcraServisi.DonemYaz(bugun.Year, bugun.Month);
        return Ok(HesapNesne(Icra.Hesapla(db, sicil, donem)));
    }

    /// <summary>
    /// Dönem listesi: icrası açık herkesin kesintisi (kaydedilmişse kayıt,
    /// değilse hesap). Panel bundan Excel üretir (nafaka/icra ayrı, dosya no,
    /// icra dairesi, ödeme hesabı).
    /// </summary>
    [HttpGet("Icra/Donem")]
    public IActionResult IcraDonem([FromQuery] string donem = null)
    {
        using var db = _vt.Baglanti();
        var (_, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        var bugun = DateTime.Today;
        donem ??= IcraServisi.DonemYaz(bugun.Year, bugun.Month);
        var (y, a) = IcraServisi.DonemCoz(donem);
        donem = IcraServisi.DonemYaz(y, a);

        var siciller = db.Query<string>(@"
SELECT DISTINCT sicil FROM KRY_ICRA_DOSYA WHERE durum = N'acik'
UNION SELECT DISTINCT sicil FROM KRY_ICRA_KESINTI WHERE donem = @donem", new { donem }).ToList();
        var kayitli = db.Query(@"
SELECT k.*, b.ad AS dekont_ad, d.dosya_no, d.alacakli, d.icra_dairesi, d.esas_no, d.odeme_hesabi, d.personel_ad
FROM KRY_ICRA_KESINTI k JOIN KRY_ICRA_DOSYA d ON d.id = k.dosya_id LEFT JOIN KRY_ICRA_BELGE b ON b.id = k.dekont_id AND b.silindi = 0
WHERE k.donem = @donem ORDER BY k.sicil, k.tur DESC, k.sira", new { donem }).ToList();

        var kisiler = new List<object>();
        foreach (var s in siciller.OrderBy(x => x))
        {
            var kayit = kayitli.Where(k => (string)k.sicil == s).ToList();
            if (kayit.Count > 0)
            {
                var net = kayit.Select(k => (decimal?)k.net_maas).FirstOrDefault(v => v is not null);
                kisiler.Add(new
                {
                    sicil = s, personelAd = (string)kayit[0].personel_ad, donem, kaydedildi = true, netMaas = net, maasKaynak = (string)kayit[0].maas_kaynak,
                    nafaka = kayit.Where(k => (string)k.tur == "nafaka").Sum(k => (decimal)k.tutar),
                    icra = kayit.Where(k => (string)k.tur == "icra").Sum(k => (decimal)k.tutar),
                    toplam = kayit.Sum(k => (decimal)k.tutar),
                    uyarilar = Array.Empty<string>(),
                    satirlar = kayit.Select(k => new
                    {
                        kesintiId = (int)k.id, dosyaId = (int)k.dosya_id, dosyaNo = (string)k.dosya_no, tur = (string)k.tur, sira = (int?)k.sira ?? 0, tutar = (decimal)k.tutar,
                        alacakli = (string)k.alacakli, icraDairesi = (string)k.icra_dairesi, esasNo = (string)k.esas_no, odemeHesabi = (string)k.odeme_hesabi,
                        odendi = (bool)k.odendi, odemeTarihi = (DateTime?)k.odeme_tarihi, dekontId = (int?)k.dekont_id, dekontAd = (string)k.dekont_ad,
                    }).ToList(),
                });
            }
            else
            {
                var h = Icra.Hesapla(db, s, donem);
                var p = h.PersonelAd ?? (Icra.Personel(s) is { } pk ? $"{pk.Ad} {pk.Soyad}".Trim() : s);
                kisiler.Add(new
                {
                    sicil = s, personelAd = p, donem, kaydedildi = false, netMaas = h.NetMaas, maasKaynak = h.MaasKaynak,
                    nafaka = h.Nafaka, icra = h.Icra, toplam = h.Toplam, uyarilar = h.Uyarilar,
                    satirlar = h.Satirlar.Select(x => new
                    {
                        kesintiId = (int?)null, x.DosyaId, x.DosyaNo, x.Tur, x.Sira, x.Tutar, x.Alacakli, x.IcraDairesi, x.EsasNo, x.OdemeHesabi,
                        odendi = false, odemeTarihi = (DateTime?)null, dekontId = (int?)null, dekontAd = (string)null,
                    }).ToList(),
                });
            }
        }
        return Ok(new { donem, donemAdi = IcraServisi.DonemAdi(donem), oran = IcraServisi.Oran(), kisiler });
    }

    /// <summary>Dönem hesabını kaydeder (tek personel ya da herkes).</summary>
    [HttpPost("Icra/Donem/Kaydet")]
    public IActionResult IcraDonemKaydet([FromQuery] string donem, [FromQuery] string sicil = null)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var (y, a) = IcraServisi.DonemCoz(donem);
        donem = IcraServisi.DonemYaz(y, a);
        var siciller = string.IsNullOrWhiteSpace(sicil)
            ? db.Query<string>("SELECT DISTINCT sicil FROM KRY_ICRA_DOSYA WHERE durum = N'acik'").ToList()
            : new List<string> { IcraServisi.K(sicil) };
        var eksik = new List<string>();
        var kaydedilen = 0;
        foreach (var s in siciller)
        {
            var h = Icra.Kaydet(db, s, donem, ben.Anahtar, ben.Ad);
            if (h.Kaydedildi) kaydedilen++; else eksik.Add(s);
        }
        IcraLogla(db, ben, "donem_kaydet", null, $"{donem} · {kaydedilen} kişi");
        return Ok(new { kaydedilen, eksik, uyari = eksik.Count > 0 ? $"{eksik.Count} personelin net maaşı bulunamadı; elle giriniz." : null });
    }

    public sealed class IcraMaasGirdisi
    {
        public string Sicil { get; set; }
        public string Donem { get; set; }
        /// <summary>Boş = elle değeri kaldır (bordroya dön)</summary>
        public decimal? NetMaas { get; set; }
    }

    /// <summary>O ay için net maaşı elle düzeltir (bordro okunamadığında ya da farklıysa).</summary>
    [HttpPost("Icra/Maas")]
    public IActionResult IcraMaas([FromBody] IcraMaasGirdisi g)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var s = IcraServisi.K(g?.Sicil);
        if (s.Length == 0) return BadRequest(new { hata = "Sicil gerekli." });
        var (y, a) = IcraServisi.DonemCoz(g.Donem);
        var donem = IcraServisi.DonemYaz(y, a);
        if (g.NetMaas is null)
            db.Execute("DELETE FROM KRY_ICRA_MAAS WHERE sicil = @s AND donem = @donem", new { s, donem });
        else
        {
            if (g.NetMaas <= 0 || g.NetMaas > 9_999_999) return BadRequest(new { hata = "Net maaş geçersiz." });
            db.Execute(@"MERGE KRY_ICRA_MAAS AS h USING (SELECT @s AS s, @donem AS d) AS y ON h.sicil = y.s AND h.donem = y.d
WHEN MATCHED THEN UPDATE SET net_maas = @net, guncelleyen = @kim, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (sicil, donem, net_maas, guncelleyen) VALUES (@s, @donem, @net, @kim);", new { s, donem, net = g.NetMaas, kim = ben.Anahtar });
        }
        IcraLogla(db, ben, g.NetMaas is null ? "maas_elle_sil" : "maas_elle", null, donem);
        return Ok(HesapNesne(Icra.Hesapla(db, s, donem)));
    }

    public sealed class IcraOdemeGirdisi
    {
        public bool Odendi { get; set; } = true;
        public DateTime? OdemeTarihi { get; set; }
        public string Aciklama { get; set; }
    }

    /// <summary>Kesintinin icra dairesine ödendiğini işaretler; borç bitince dosya kapanır.</summary>
    [HttpPost("Icra/Kesinti/{kid:int}/Odendi")]
    public IActionResult IcraOdendi(int kid, [FromBody] IcraOdemeGirdisi g)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var k = db.QueryFirstOrDefault("SELECT k.*, d.dosya_no FROM KRY_ICRA_KESINTI k JOIN KRY_ICRA_DOSYA d ON d.id = k.dosya_id WHERE k.id = @kid", new { kid });
        if (k is null) return NotFound();
        var odendi = g?.Odendi != false;
        db.Execute("UPDATE KRY_ICRA_KESINTI SET odendi = @o, odeme_tarihi = @t, aciklama = ISNULL(@a, aciklama) WHERE id = @kid",
            new { kid, o = odendi, t = odendi ? (g?.OdemeTarihi?.Date ?? DateTime.Today) : (DateTime?)null, a = Kirp(g?.Aciklama, 300) });
        if (odendi && !(bool)k.odendi)
            IcraServisi.OlayYaz(db, (int)k.dosya_id, "odeme", (g?.OdemeTarihi ?? DateTime.Today).AddHours(12),
                $"Ödeme yapıldı · {IcraServisi.DonemAdi((string)k.donem)}", Kirp(g?.Aciklama, 300), (decimal)k.tutar, ben.Anahtar, ben.Ad);
        var kapandi = odendi && Icra.GerekirseKapat(db, (int)k.dosya_id, ben.Anahtar, ben.Ad);
        IcraLogla(db, ben, odendi ? "odendi" : "odendi_geri", (int)k.dosya_id, (string)k.dosya_no);
        return Ok(new { tamam = true, kapandi });
    }

    /* ==================================================================== */
    /* Belgeler: tebligat taraması, dekont                                   */
    /* ==================================================================== */

    private static readonly HashSet<string> IcraUzantilar = new(StringComparer.OrdinalIgnoreCase)
    { ".pdf", ".jpg", ".jpeg", ".png", ".heic", ".webp", ".tif", ".tiff", ".udf", ".doc", ".docx", ".xls", ".xlsx" };
    private const long IcraBelgeSiniri = 25L * 1024 * 1024;

    private async Task<int> IcraBelgeYaz(System.Data.IDbConnection db, Kimlik ben, IFormFile f, int dosyaId, int? kesintiId)
    {
        var ad = Path.GetFileName(f.FileName ?? "belge");
        if (ad.Length > 240) ad = ad[^240..];
        var uz = Path.GetExtension(ad).ToLowerInvariant();
        var yol = Path.Combine(Klasor(Path.Combine("icra", dosyaId.ToString())), Guid.NewGuid().ToString("N") + uz);
        await using (var akis = System.IO.File.Create(yol)) await f.CopyToAsync(akis);
        return db.ExecuteScalar<int>(@"
INSERT INTO KRY_ICRA_BELGE (dosya_id, kesinti_id, ad, yol, icerik_turu, boyut, yukleyen, yukleyen_ad)
OUTPUT INSERTED.id VALUES (@dosyaId, @kesintiId, @ad, @yol, @ct, @boyut, @kim, @kimAd)",
            new { dosyaId, kesintiId, ad, yol, ct = string.IsNullOrWhiteSpace(f.ContentType) ? "application/octet-stream" : f.ContentType, boyut = f.Length, kim = ben.Anahtar, kimAd = ben.Ad });
    }

    private string IcraBelgeDenetle(IFormFile f)
    {
        if (f.Length <= 0) return "Boş dosya.";
        if (f.Length > IcraBelgeSiniri) return $"{f.FileName}: en fazla 25 MB.";
        if (!IcraUzantilar.Contains(Path.GetExtension(f.FileName ?? ""))) return $"{f.FileName}: yalnız PDF, görsel, UDF, Word ve Excel yüklenebilir.";
        return null;
    }

    /// <summary>Dosya belgesi (tebligat taraması vb.); çok parçalı "dosyalar".</summary>
    [HttpPost("Icra/Dosya/{id:int}/Belge")]
    [RequestSizeLimit(IcraBelgeSiniri * 4)]
    [RequestFormLimits(MultipartBodyLengthLimit = IcraBelgeSiniri * 4)]
    public async Task<IActionResult> IcraBelgeYukle(int id, List<IFormFile> dosyalar)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var no = db.ExecuteScalar<string>("SELECT dosya_no FROM KRY_ICRA_DOSYA WHERE id = @id", new { id });
        if (no is null) return NotFound();
        if ((dosyalar == null || dosyalar.Count == 0) && Request.HasFormContentType) dosyalar = Request.Form.Files.ToList();
        if (dosyalar is null || dosyalar.Count == 0) return BadRequest(new { hata = "Dosya seçiniz." });
        var idler = new List<int>();
        foreach (var f in dosyalar)
        {
            if (IcraBelgeDenetle(f) is { } hata) return BadRequest(new { hata });
            idler.Add(await IcraBelgeYaz(db, ben, f, id, null));
        }
        IcraLogla(db, ben, "belge_yukle", id, $"{no} · {idler.Count} belge");
        return Ok(new { idler });
    }

    /// <summary>Ödeme dekontu: kesinti kaydına eklenir, yüklenince kesinti ödendi sayılır.</summary>
    [HttpPost("Icra/Kesinti/{kid:int}/Dekont")]
    [RequestSizeLimit(IcraBelgeSiniri * 2)]
    [RequestFormLimits(MultipartBodyLengthLimit = IcraBelgeSiniri * 2)]
    public async Task<IActionResult> IcraDekontYukle(int kid, [FromQuery] DateTime? odemeTarihi, List<IFormFile> dosyalar)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var k = db.QueryFirstOrDefault("SELECT k.*, d.dosya_no FROM KRY_ICRA_KESINTI k JOIN KRY_ICRA_DOSYA d ON d.id = k.dosya_id WHERE k.id = @kid", new { kid });
        if (k is null) return NotFound();
        if ((dosyalar == null || dosyalar.Count == 0) && Request.HasFormContentType) dosyalar = Request.Form.Files.ToList();
        var f = dosyalar?.FirstOrDefault();
        if (f is null) return BadRequest(new { hata = "Dekont seçiniz." });
        if (IcraBelgeDenetle(f) is { } hata) return BadRequest(new { hata });
        var bid = await IcraBelgeYaz(db, ben, f, (int)k.dosya_id, kid);
        db.Execute("UPDATE KRY_ICRA_KESINTI SET dekont_id = @bid, odendi = 1, odeme_tarihi = ISNULL(odeme_tarihi, @t) WHERE id = @kid",
            new { kid, bid, t = odemeTarihi?.Date ?? DateTime.Today });
        if (!(bool)k.odendi)
            IcraServisi.OlayYaz(db, (int)k.dosya_id, "odeme", (odemeTarihi ?? DateTime.Today).AddHours(12),
                $"Ödeme yapıldı · {IcraServisi.DonemAdi((string)k.donem)}", "Dekont yüklendi", (decimal)k.tutar, ben.Anahtar, ben.Ad);
        var kapandi = Icra.GerekirseKapat(db, (int)k.dosya_id, ben.Anahtar, ben.Ad);
        IcraLogla(db, ben, "dekont_yukle", (int)k.dosya_id, (string)k.dosya_no);
        return Ok(new { id = bid, kapandi });
    }

    [HttpGet("Icra/Belge/{bid:int}")]
    public IActionResult IcraBelgeGetir(int bid, [FromQuery] bool indir = false)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak is null) return IcraYasak();
        var b = db.QueryFirstOrDefault("SELECT * FROM KRY_ICRA_BELGE WHERE id = @bid AND silindi = 0", new { bid });
        if (b is null || !System.IO.File.Exists((string)b.yol)) return NotFound();
        IcraLogla(db, ben, "belge_ac", (int)b.dosya_id);
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var akis = System.IO.File.OpenRead((string)b.yol);
        var goster = !indir && Gosterilir.Contains(Path.GetExtension((string)b.ad ?? ""));
        return goster
            ? File(akis, (string)b.icerik_turu ?? "application/octet-stream", enableRangeProcessing: true)
            : File(akis, "application/octet-stream", (string)b.ad, enableRangeProcessing: true);
    }

    [HttpDelete("Icra/Belge/{bid:int}")]
    public IActionResult IcraBelgeSil(int bid)
    {
        using var db = _vt.Baglanti();
        var (ben, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var b = db.QueryFirstOrDefault("SELECT dosya_id, kesinti_id FROM KRY_ICRA_BELGE WHERE id = @bid AND silindi = 0", new { bid });
        if (b is null) return NotFound();
        db.Execute("UPDATE KRY_ICRA_BELGE SET silindi = 1 WHERE id = @bid", new { bid });
        if (b.kesinti_id is int kid) db.Execute("UPDATE KRY_ICRA_KESINTI SET dekont_id = NULL WHERE id = @kid AND dekont_id = @bid", new { kid, bid });
        IcraLogla(db, ben, "belge_sil", (int)b.dosya_id);
        return Ok(new { tamam = true });
    }

    /// <summary>Yeni dosya açarken personel arama (yalnız aktifler; ad, sicil, pozisyon, şube).</summary>
    [HttpGet("Icra/Personel")]
    public IActionResult IcraPersonelAra([FromQuery] string q = null)
    {
        using var db = _vt.Baglanti();
        var (_, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        q = (q ?? "").Trim();
        if (q.Length < 2) return Ok(new { personeller = Array.Empty<object>() });
        var l = _ekip.Aktifler()
            .Where(p => IcraServisi.K(p.PersonelKodu).Contains(IcraServisi.K(q)) || $"{p.Ad} {p.Soyad}".Contains(q, StringComparison.CurrentCultureIgnoreCase))
            .Take(20)
            .Select(p => new { sicil = IcraServisi.K(p.PersonelKodu), ad = $"{p.Ad} {p.Soyad}".Trim(), pozisyon = p.Pozisyon, sube = p.IsGrubu });
        return Ok(new { personeller = l });
    }

    /// <summary>Dosyanın işlem günlüğü (kim ne zaman açtı, yükledi).</summary>
    [HttpGet("Icra/Dosya/{id:int}/Gunluk")]
    public IActionResult IcraGunluk(int id)
    {
        using var db = _vt.Baglanti();
        var (_, hak) = IcraKimlik(db);
        if (hak != "tam") return IcraYasak();
        var l = db.Query("SELECT TOP 300 ad, islem, hedef, zaman FROM KRY_ICRA_LOG WHERE dosya_id = @id ORDER BY id DESC", new { id })
            .Select(x => new { ad = (string)x.ad, islem = (string)x.islem, hedef = (string)x.hedef, zaman = (DateTime)x.zaman });
        return Ok(new { gunluk = l });
    }
}

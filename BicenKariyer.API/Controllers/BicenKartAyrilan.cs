using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen Kart › Ayrılan Personel (02.10.2026)
/// ---------------------------------------------------------------------------
/// Personele fiziki kart gönderilmedi; kartlar Biçen360'ta kullanılıyor. İşten
/// ayrılan kişi uygulamaya giremiyor ama kartı ve bakiyesi duruyor. Bu uçlar
/// seçilen ayda ayrılan personeli listeler, SMS ile kişiye özel kart
/// bağlantısı gönderir (<see cref="KartAyrilan"/>, sayfa: <c>KartLinkController</c>)
/// ve bağlantının akıbetini izler.
///
/// <para>
/// Yetki sınıftaki ile aynı: Biçen Kart sayfasını ve Puan Yönetimi'ni
/// kullanan roller (Admin, İK uzmanı, İK yöneticisi, GMY).
/// </para>
///
/// <para>
/// Kurallar: bağlantı ilk başarılı SMS'ten itibaren ayardaki gün kadar
/// (varsayılan 30) geçerli. Gönderilmiş ve süresi içindeki kişiye ikinci
/// kez gönderilmez; "Tekrar gönder" aynı bağlantıyı yeniden yollar ve süreyi
/// UZATMAZ — süre yalnızca "Süreyi uzat" ile uzar. Her adım bağlantı
/// geçmişine (KRY_KART_AYRILAN_OLAY) yazılır.
/// </para>
///
/// <para>
/// Bağlantı hâlâ çalışan personele de gönderilebilir (tur = "calisan",
/// Gönderim › Çalışan personel). Çalışanda süre dolunca ya da bakiye bitince
/// kart şifresine dokunulmaz; yalnızca bağlantı kartı göstermez. Kişi daha
/// sonra ayrılırsa "ayrılan" olarak yeni bağlantı gönderilir ve eski açık
/// bağlantı iptal edilir.
/// </para>
/// </summary>
public partial class BicenKartController
{
    private const string AYR = KartAyrilan.TABLO;

    private static string SicilAnahtari(string s) => (s ?? "").Trim();

    /// <summary>Cep telefonu: 10 hane ve 5 ile başlıyor (SMS gidebilir).</summary>
    private static bool CepGecerli(string tel) => tel.Length == 10 && tel[0] == '5';

    private string Yapan => User?.Identity?.Name ?? "panel";

    private string IstekAdresi => IstemciAdresi.Bul(HttpContext);

    /// <summary>
    /// Ayrılmış kişi aynı TC ile yeni sicille yeniden işe girdiyse kartını
    /// uygulamadan kullanıyor; ona bağlantı gönderilmez.
    /// </summary>
    private static bool YenidenCalisiyor(PersonelKaydi p, IEnumerable<PersonelKaydi> tumu)
    {
        var tc = KartAyrilan.KimlikNormal(p.KimlikNo);

        if (tc is null) return false;

        return tumu.Any(x => x.Durum == 1
                             && !string.Equals(SicilAnahtari(x.PersonelKodu), SicilAnahtari(p.PersonelKodu),
                                               StringComparison.OrdinalIgnoreCase)
                             && KartAyrilan.KimlikNormal(x.KimlikNo) == tc
                             && !(x.CikisTarihi is DateTime c && c.Date <= DateTime.Today));
    }

    /// <summary>Sicillerin en son bağlantı satırı (iptal ya da bırakılmış olabilir).</summary>
    private Dictionary<string, KartAyrilanSatiri> SonBaglantilar(System.Data.IDbConnection db, IEnumerable<string> siciller,
                                                                 string tur = null)
    {
        var sonuc = new Dictionary<string, KartAyrilanSatiri>(StringComparer.OrdinalIgnoreCase);

        foreach (var parca in siciller.Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Chunk(500))
            foreach (var s in db.Query<KartAyrilanSatiri>(
                         $"SELECT {KartAyrilan.SUTUNLAR} FROM {AYR} WHERE personel_kodu IN @parca AND (@tur IS NULL OR tur = @tur)",
                         new { parca, tur }))
            {
                var k = SicilAnahtari(s.PersonelKodu);

                if (!sonuc.TryGetValue(k, out var onceki) || onceki.Id < s.Id) sonuc[k] = s;
            }

        return sonuc;
    }

    private List<KartAyrilanSatiri> BaglantilariAl(System.Data.IDbConnection db, IEnumerable<int> idler) =>
        idler.Distinct().Chunk(500)
            .SelectMany(parca => db.Query<KartAyrilanSatiri>(
                $"SELECT {KartAyrilan.SUTUNLAR} FROM {AYR} WHERE id IN @parca", new { parca }))
            .ToList();

    private static int KalanGun(DateTime son, DateTime simdi) =>
        son <= simdi ? 0 : (int)Math.Ceiling((son - simdi).TotalDays);

    private static (DateTime Baslangic, DateTime Bitis, string Ay) Donem(int? yil, int? ay)
    {
        var bugun = DateTime.Today;
        var y = yil ?? bugun.Year;
        var a = ay ?? bugun.Month;

        if (y is < 2020 or > 2100 || a is < 1 or > 12) throw new ArgumentException("Geçersiz dönem.");

        var bas = new DateTime(y, a, 1);

        return (bas, bas.AddMonths(1), $"{y:0000}-{a:00}");
    }

    /// <summary>Panelde gösterilen bağlantı özeti (gönderim ve takip listesi ortak).</summary>
    private object BaglantiOzeti(KartAyrilanSatiri b, decimal? bakiye, DateTime simdi, KartAyrilanAyari ayar)
    {
        var durum = KartAyrilan.Durum(b, bakiye, simdi);
        var gb = b.GonderimBakiye ?? 0m;
        var harcanan = b.Harcanan ?? 0m;

        return new
        {
            id = b.Id,
            kod = b.Kod,
            tur = b.Calisan ? KartAyrilan.TUR_CALISAN : KartAyrilan.TUR_AYRILAN,
            adres = KartAyrilan.Adres(_ayar, b.Kod, ayar),
            ay = b.Ay,
            sicil = SicilAnahtari(b.PersonelKodu),
            adSoyad = b.AdSoyad,
            sube = b.Sube,
            pozisyon = b.Pozisyon,
            cikisTarihi = b.CikisTarihi,
            telefon = b.Telefon,
            kartNo = (b.KartNo ?? "").Trim(),
            kartSon4 = KartAyrilan.SonDort(b.KartNo),
            gonderim = b.Gonderim,
            smsIlk = b.SmsIlk,
            smsSon = b.SmsSon,
            smsSayisi = b.SmsSayisi,
            smsDurum = b.SmsDurum,
            smsHata = b.SmsHata,
            gonderen = b.Gonderen,
            sonGonderen = b.SonGonderen,
            sonGecerlilik = b.SonGecerlilik,
            kalanGun = KalanGun(b.SonGecerlilik, simdi),
            suresiDoldu = b.SonGecerlilik < simdi,
            ilkAcilis = b.IlkAcilis,
            sonAcilis = b.SonAcilis,
            acilisSayisi = b.AcilisSayisi,
            kimlikDogrulama = b.KimlikDogrulama,
            sifreTarihi = b.SifreTarihi,
            sifreGecerli = b.SifreGecerli,
            sifreGecersiz = b.SifreGecersiz,
            gonderimBakiye = b.GonderimBakiye,
            bakiye = bakiye ?? b.SonBakiye,
            bakiyeCanli = bakiye.HasValue,
            harcanan,
            silinen = b.Silinen ?? 0m,
            kullanimYuzde = gb > 0m ? Math.Min(100, (int)Math.Round(harcanan / gb * 100m)) : 0,
            ilkKullanim = b.IlkKullanim,
            sonKullanim = b.SonKullanim,
            tamamlandi = b.Tamamlandi,
            hataliDeneme = b.HataliDeneme,
            kilitBitis = b.KilitBitis,
            kilitli = b.KilitBitis is DateTime k && k > simdi,
            iptal = b.Iptal,
            iptalTarihi = b.IptalTarihi,
            iptalEden = b.IptalEden,
            birakildi = b.Birakildi,
            birakan = b.Birakan,
            indirmeSayisi = b.IndirmeSayisi,
            gorselIndirme = b.GorselIndirme,
            uzatmaSayisi = b.UzatmaSayisi,
            durum,
            durumAdi = KartAyrilan.DurumAdi.TryGetValue(durum, out var ad) ? ad : durum,
        };
    }

    /* ==================================================================== */
    /* Gönderim listesi                                                     */
    /* ==================================================================== */

    /// <summary>
    /// Seçilen ayda çıkışı olan (çıkış tarihi bugün ya da geçmiş) personel:
    /// kart (son dört hane), canlı bakiye, telefon, bağlantı durumu. Kart
    /// eşleşmesi olmayanlar da listede, gönderilemez olarak.
    /// </summary>
    [HttpGet("Ayrilan/Liste")]
    public IActionResult AyrilanListe([FromQuery] int? yil, [FromQuery] int? ay)
    {
        (DateTime Baslangic, DateTime Bitis, string Ay) donem;

        try
        {
            donem = Donem(yil, ay);
        }
        catch (ArgumentException h)
        {
            return BadRequest(new { hata = h.Message });
        }

        List<PersonelKaydi> tumu;

        try
        {
            tumu = _personelKaynak.TumPersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Ayrılan personel okunamadı");
            return StatusCode(503, new { hata = "Personel listesi okunamadı.", ayrinti = hata.Message });
        }

        var bugun = DateTime.Today;
        var simdi = DateTime.Now;
        var ayar = KartAyrilan.Ayar(_ayar);

        /* Dönemde çıkışı olan, çıkışı gelmiş; aynı sicil birden çok gelirse en son çıkış */
        var ayrilanlar = tumu
            .Where(x => x.CikisTarihi is DateTime c && c.Date >= donem.Baslangic && c.Date < donem.Bitis
                        && c.Date <= bugun && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .GroupBy(x => SicilAnahtari(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => x.CikisTarihi).First())
            .ToList();

        var eslesmeler = Eslesmeler();

        Dictionary<string, KartAyrilanSatiri> baglantilar;

        using var db = _vt.Baglanti();

        try
        {
            /* Yalnızca "ayrılan" bağlantılar: çalışırken gönderilmiş bağlantı
               ayrılınca yeni bağlantının önünde durmasın */
            baglantilar = SonBaglantilar(db, ayrilanlar.Select(x => SicilAnahtari(x.PersonelKodu)), KartAyrilan.TUR_AYRILAN);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart bağlantıları okunamadı");
            return StatusCode(503, new { hata = "Bağlantı kayıtları okunamadı.", ayrinti = hata.Message });
        }

        string KartiNe(PersonelKaydi p) =>
            eslesmeler.TryGetValue(SicilAnahtari(p.PersonelKodu), out var e) && !string.IsNullOrWhiteSpace(e.KartNo)
                ? e.KartNo.Trim()
                : null;

        var kartNolari = ayrilanlar.Select(KartiNe).Where(x => x is not null)
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var kartVar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var bakiyeler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        string posHatasi = null;

        try
        {
            using var pos = _vt.PosBaglantisi();

            foreach (var parca in kartNolari.Chunk(400))
                foreach (var no in pos.Query<string>(
                             $"SELECT CONVERT(VARCHAR(50), k.KartNo) FROM {TABLO} k WHERE k.KartNo IN @parca",
                             new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120))
                    kartVar.Add((no ?? "").Trim());

            foreach (var (no, tutar) in GiftKartServisi.TopluBakiye(pos, kartNolari))
                bakiyeler[no] = tutar;

            foreach (var (no, tutar) in KartAyrilanTazeleme.Tazele(db, pos, baglantilar.Values.ToList(), simdi))
                bakiyeler[no] = tutar;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ayrılan personel kart bilgileri okunamadı");
            posHatasi = hata.Message;
        }

        var satirlar = ayrilanlar.Select(p =>
        {
            var sicil = SicilAnahtari(p.PersonelKodu);
            var tel = Telefon(p.Telefon);
            var kartNo = KartiNe(p);

            baglantilar.TryGetValue(sicil, out var b);

            decimal? bakiye = kartNo is not null && posHatasi is null
                ? (bakiyeler.TryGetValue(kartNo, out var bb) ? bb : 0m)
                : null;

            /* Bağlantı bu kart için mi: kart değişmişse eski bağlantı geçmişte kalır */
            var bagli = b is not null && kartNo is not null
                        && string.Equals((b.KartNo ?? "").Trim(), kartNo, StringComparison.OrdinalIgnoreCase);

            var yeniden = YenidenCalisiyor(p, tumu);
            var tcVar = KartAyrilan.KimlikNormal(p.KimlikNo) is not null;

            /* Gönderilemezlik sebebi; null ise seçilebilir */
            string engel =
                kartNo is null ? "kart eşleşmesi yok"
                : yeniden ? "yeniden işe girmiş; kartı uygulamada"
                : posHatasi is null && !kartVar.Contains(kartNo) ? "kart MusteriKart'ta yok"
                : !CepGecerli(tel) ? "cep telefonu geçersiz"
                : !tcVar ? "TC kimlik no kayıtlı değil"
                : (!bagli || !b.Etkin) && bakiye is not null && bakiye <= 0m ? "bakiye 0"
                : null;

            return new
            {
                sicil,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = (p.IsGrubu ?? "").Trim(),
                pozisyon = p.Pozisyon,
                cikisTarihi = p.CikisTarihi.Value.Date,
                telefon = tel.Length == 10 ? tel : null,
                telefonGecerli = CepGecerli(tel),
                tcVar,
                kartNo,
                kartSon4 = kartNo is null ? null : KartAyrilan.SonDort(kartNo),
                eslesmeYok = kartNo is null,
                bakiye,
                yenidenCalisiyor = yeniden,
                engel,
                link = bagli ? BaglantiOzeti(b, bakiye, simdi, ayar) : null,
            };
        })
        .OrderBy(x => x.engel is null ? 0 : 1)
        .ThenBy(x => x.cikisTarihi)
        .ThenBy(x => x.adSoyad)
        .ToList();

        return Ok(new
        {
            ay = donem.Ay,
            baslangic = donem.Baslangic,
            bitis = donem.Bitis.AddDays(-1),
            personel = satirlar,
            posHatasi,
            smsEtkin = _sms.Etkin,

            /* Kartı olmayan ayrılan personele kart tanımlama: yalnızca Yönetici (Admin) */
            kartTanimlayabilir = AyrilanaKartYetkisi,
            ayar = new { ayar.SmsSablonu, ayar.CalisanSmsSablonu, ayar.GecerlilikGunu, ayar.BaglantiAdresi },
            ornekAdres = KartAyrilan.Adres(_ayar, "ABCD23456789", ayar),
        });
    }

    /* ==================================================================== */
    /* Ayrılan personele kart tanımlama ekranı (06.10.2026)                  */
    /* ==================================================================== */

    /// <summary>
    /// Ayrılan personel arama (ad, sicil, TC son 4): ay seçmeden kart
    /// tanımlanacak kişiyi bulmak için. Son iki yılda ayrılanlar, en yeni önce.
    /// </summary>
    [HttpGet("Ayrilan/PersonelAra")]
    public IActionResult AyrilanPersonelAra([FromQuery] string q)
    {
        var ara = (q ?? "").Trim();

        if (ara.Length < 2) return Ok(new { kayitlar = new List<object>() });

        var tr = new System.Globalization.CultureInfo("tr-TR");
        var aranan = ara.ToUpper(tr);
        var bugun = DateTime.Today;
        var eslesmeler = Eslesmeler();

        var kayitlar = _personelKaynak.TumPersonelleriGetir()
            .Where(x => x.CikisTarihi is DateTime c && c.Date <= bugun && c.Date >= bugun.AddYears(-2)
                        && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .GroupBy(x => SicilAnahtari(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(x => x.CikisTarihi).First())
            .Where(x => $"{x.Ad} {x.Soyad}".ToUpper(tr).Contains(aranan)
                        || SicilAnahtari(x.PersonelKodu).Contains(ara, StringComparison.OrdinalIgnoreCase)
                        || (ara.Length == 4 && (x.KimlikNo ?? "").Trim().EndsWith(ara)))
            .OrderByDescending(x => x.CikisTarihi)
            .Take(15)
            .Select(x =>
            {
                var sicil = SicilAnahtari(x.PersonelKodu);
                eslesmeler.TryGetValue(sicil, out var e);

                return new
                {
                    sicil,
                    adSoyad = $"{x.Ad} {x.Soyad}".Trim(),
                    sube = (x.IsGrubu ?? "").Trim(),
                    pozisyon = x.Pozisyon,
                    cikisTarihi = x.CikisTarihi?.Date,
                    kartNo = string.IsNullOrWhiteSpace(e.KartNo) ? null : e.KartNo.Trim(),
                    kartSon4 = string.IsNullOrWhiteSpace(e.KartNo) ? null : KartAyrilan.SonDort(e.KartNo),
                };
            })
            .ToList();

        return Ok(new { kayitlar });
    }

    /// <summary>
    /// Bir personelin kart durumu: tanımlı kart (POS'ta var mı, kartın
    /// üstündeki ad, telefon, bakiye), daha önceki kartları (eşleşme geçmişi
    /// ve gönderilen bağlantılar) ve kart tanımlanabilir mi.
    /// </summary>
    [HttpGet("Ayrilan/KartDurumu/{sicil}")]
    public IActionResult AyrilanKartDurumu(string sicil)
    {
        var anahtar = SicilAnahtari(sicil);
        var tumu = _personelKaynak.TumPersonelleriGetir();

        var p = tumu
            .Where(x => SicilAnahtari(x.PersonelKodu) == anahtar)
            .OrderByDescending(x => x.Durum == 1)
            .ThenByDescending(x => x.CikisTarihi ?? DateTime.MaxValue)
            .FirstOrDefault();

        if (p is null) return NotFound(new { hata = "Personel bulunamadı." });

        var tel = Telefon(p.Telefon);
        var ayrildi = p.Durum != 1 || (p.CikisTarihi is DateTime c && c.Date <= DateTime.Today);

        Eslesmeler().TryGetValue(anahtar, out var e);
        var kartNo = string.IsNullOrWhiteSpace(e.KartNo) ? null : e.KartNo.Trim();

        object kart = null;
        string posHatasi = null;

        if (kartNo is not null)
        {
            try
            {
                using var pos = _vt.PosBaglantisi();

                var k = pos.QueryFirstOrDefault($@"
SELECT LTRIM(RTRIM(ISNULL(k.Ad, N'') + N' ' + ISNULL(k.Soyad, N''))) AS ad,
       CASE WHEN k.CepTel IS NULL OR k.CepTel = 0 THEN NULL
            ELSE RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) END AS telefon,
       k.GrupNo AS grupNo
FROM {TABLO} k WHERE k.KartNo = CONVERT(VARCHAR(50), @kartNo)", new { kartNo }, commandTimeout: 30);

                var bakiye = k is null ? (decimal?)null : GiftKartServisi.BakiyeSorgusu(pos, kartNo);

                kart = new
                {
                    kartNo,
                    son4 = KartAyrilan.SonDort(kartNo),
                    posta = k is not null,
                    kartAdi = (string)k?.ad,
                    kartTelefon = (string)k?.telefon,
                    mobil = k?.grupNo is not null && (int)k.grupNo == MOBIL,
                    bakiye,
                };
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Kart durumu okunamadı: {Sicil}", anahtar);
                posHatasi = hata.Message;
                kart = new { kartNo, son4 = KartAyrilan.SonDort(kartNo), posta = (bool?)null, kartAdi = (string)null,
                             kartTelefon = (string)null, mobil = false, bakiye = (decimal?)null };
            }
        }

        /* Geçmiş: eşleşme geçmişi + gönderilen bağlantılar + şimdiki eşleşmenin tarihi */
        var gecmis = new List<(DateTime Tarih, string KartNo, string Olay, string Ayrinti, string Yapan)>();

        using (var db = _vt.Baglanti())
        {
            try
            {
                foreach (var g in db.Query(@"
SELECT TOP 30 kart_no AS kartNo, islem, aciklama, yapan, tarih
FROM KRY_KART_ESLESME_GECMIS WHERE personel_kodu = @anahtar ORDER BY tarih DESC", new { anahtar }))
                {
                    var olay = (string)g.islem switch
                    {
                        "tanimlandi" => "Kart tanımlandı",
                        "degistirildi" => "Kart değiştirildi",
                        "birakildi" => "Kart bırakıldı",
                        "kaldirildi" => "Kart kaldırıldı",
                        "alindi" => "Kart başkasına verildi",
                        var x => x,
                    };
                    gecmis.Add(((DateTime)g.tarih, (string)g.kartNo, olay, (string)g.aciklama, (string)g.yapan));
                }
            }
            catch
            {
                /* geçmiş tablosu henüz yoksa */
            }

            try
            {
                foreach (var b in db.Query(@"
SELECT TOP 10 kart_no AS kartNo, gonderim, tur, gonderen
FROM KRY_KART_AYRILAN_BAGLANTI WHERE personel_kodu = @anahtar ORDER BY gonderim DESC", new { anahtar }))
                    gecmis.Add(((DateTime)b.gonderim, (string)b.kartNo,
                        (string)b.tur == KartAyrilan.TUR_AYRILAN ? "Ayrılan kart bağlantısı gönderildi" : "Kart bağlantısı gönderildi",
                        null, (string)b.gonderen));
            }
            catch
            {
                /* bağlantı tablosu yoksa */
            }

            if (kartNo is not null && !gecmis.Any(x => string.Equals(x.KartNo?.Trim(), kartNo, StringComparison.OrdinalIgnoreCase)))
            {
                var es = db.QueryFirstOrDefault(
                    "SELECT eslesme, eslestiren FROM KRY_KART_ESLESME WHERE kart_no = @kartNo", new { kartNo });

                if (es is not null)
                    gecmis.Add(((DateTime)es.eslesme, kartNo, "Kart tanımlandı", null, (string)es.eslestiren));
            }
        }

        return Ok(new
        {
            personel = new
            {
                sicil = anahtar,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = (p.IsGrubu ?? "").Trim(),
                pozisyon = p.Pozisyon,
                cikisTarihi = p.CikisTarihi?.Date,
                ayrildi,
                yenidenCalisiyor = YenidenCalisiyor(p, tumu),
                telefon = tel.Length == 10 ? tel : null,
                telefonGecerli = CepGecerli(tel),
                tcVar = KartAyrilan.KimlikNormal(p.KimlikNo) is not null,
            },
            kart,
            posHatasi,
            gecmis = gecmis
                .OrderByDescending(x => x.Tarih)
                .Select(x => new
                {
                    tarih = x.Tarih,
                    kartNo = string.IsNullOrWhiteSpace(x.KartNo) ? null : x.KartNo.Trim(),
                    kartSon4 = string.IsNullOrWhiteSpace(x.KartNo) ? null : KartAyrilan.SonDort(x.KartNo.Trim()),
                    olay = x.Olay,
                    ayrinti = x.Ayrinti,
                    yapan = x.Yapan,
                })
                .ToList(),
            /* Ayrılan personele tanımlama ve kaldırma yalnızca Yönetici (Admin) */
            kartTanimlayabilir = !ayrildi || AyrilanaKartYetkisi,
        });
    }

    /* ==================================================================== */
    /* Gönderim listesi: çalışan personel                                   */
    /* ==================================================================== */

    /// <summary>
    /// Çalışan personel (Durum 1, çıkışı gelmemiş) arasından kart eşleşmesi
    /// olanlar: kart (son dört hane), canlı bakiye, bağlantı durumu ("çalışan"
    /// türündeki son bağlantı). Şube süzgeci istemcide; liste şubeleri de döner.
    /// </summary>
    [HttpGet("Ayrilan/Calisan")]
    public IActionResult AyrilanCalisan([FromQuery] string sube = null)
    {
        List<PersonelKaydi> tumu;

        try
        {
            tumu = _personelKaynak.TumPersonelleriGetir();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Çalışan personel okunamadı");
            return StatusCode(503, new { hata = "Personel listesi okunamadı.", ayrinti = hata.Message });
        }

        var bugun = DateTime.Today;
        var simdi = DateTime.Now;
        var ayar = KartAyrilan.Ayar(_ayar);
        var eslesmeler = Eslesmeler();

        var calisanlar = tumu
            .Where(x => x.Durum == 1 && !(x.CikisTarihi is DateTime c && c.Date <= bugun)
                        && !string.IsNullOrWhiteSpace(x.PersonelKodu)
                        && eslesmeler.TryGetValue(SicilAnahtari(x.PersonelKodu), out var e)
                        && !string.IsNullOrWhiteSpace(e.KartNo))
            .Where(x => string.IsNullOrWhiteSpace(sube) || AyniSube(sube, x.IsGrubu))
            .GroupBy(x => SicilAnahtari(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        string KartiNe(PersonelKaydi p) => eslesmeler[SicilAnahtari(p.PersonelKodu)].KartNo.Trim();

        using var db = _vt.Baglanti();

        Dictionary<string, KartAyrilanSatiri> baglantilar;

        try
        {
            baglantilar = SonBaglantilar(db, calisanlar.Select(x => SicilAnahtari(x.PersonelKodu)), KartAyrilan.TUR_CALISAN);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart bağlantıları okunamadı");
            return StatusCode(503, new { hata = "Bağlantı kayıtları okunamadı.", ayrinti = hata.Message });
        }

        var kartNolari = calisanlar.Select(KartiNe).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var kartVar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var bakiyeler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        string posHatasi = null;

        try
        {
            using var pos = _vt.PosBaglantisi();

            foreach (var parca in kartNolari.Chunk(400))
                foreach (var no in pos.Query<string>(
                             $"SELECT CONVERT(VARCHAR(50), k.KartNo) FROM {TABLO} k WHERE k.KartNo IN @parca",
                             new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120))
                    kartVar.Add((no ?? "").Trim());

            foreach (var (no, tutar) in GiftKartServisi.TopluBakiye(pos, kartNolari))
                bakiyeler[no] = tutar;

            foreach (var (no, tutar) in KartAyrilanTazeleme.Tazele(db, pos, baglantilar.Values.ToList(), simdi))
                bakiyeler[no] = tutar;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Çalışan personel kart bilgileri okunamadı");
            posHatasi = hata.Message;
        }

        var satirlar = calisanlar.Select(p =>
        {
            var sicil = SicilAnahtari(p.PersonelKodu);
            var tel = Telefon(p.Telefon);
            var kartNo = KartiNe(p);

            baglantilar.TryGetValue(sicil, out var b);

            decimal? bakiye = posHatasi is null ? (bakiyeler.TryGetValue(kartNo, out var bb) ? bb : 0m) : null;

            var bagli = b is not null
                        && string.Equals((b.KartNo ?? "").Trim(), kartNo, StringComparison.OrdinalIgnoreCase);

            var tcVar = KartAyrilan.KimlikNormal(p.KimlikNo) is not null;

            string engel =
                posHatasi is null && !kartVar.Contains(kartNo) ? "kart MusteriKart'ta yok"
                : !CepGecerli(tel) ? "cep telefonu geçersiz"
                : !tcVar ? "TC kimlik no kayıtlı değil"
                : (!bagli || !b.Etkin) && bakiye is not null && bakiye <= 0m ? "bakiye 0"
                : null;

            return new
            {
                sicil,
                adSoyad = $"{p.Ad} {p.Soyad}".Trim(),
                sube = (p.IsGrubu ?? "").Trim(),
                pozisyon = p.Pozisyon,
                cikisTarihi = (DateTime?)null,
                telefon = tel.Length == 10 ? tel : null,
                telefonGecerli = CepGecerli(tel),
                tcVar,
                kartNo,
                kartSon4 = KartAyrilan.SonDort(kartNo),
                eslesmeYok = false,
                bakiye,
                yenidenCalisiyor = false,
                engel,
                link = bagli ? BaglantiOzeti(b, bakiye, simdi, ayar) : null,
            };
        })
        .OrderBy(x => x.engel is null ? 0 : 1)
        .ThenBy(x => x.sube)
        .ThenBy(x => x.adSoyad)
        .ToList();

        return Ok(new
        {
            ay = $"{simdi:yyyy-MM}",
            personel = satirlar,
            subeler = satirlar.Select(x => x.sube).Where(x => x.Length > 0).Distinct().OrderBy(x => x).ToList(),
            posHatasi,
            smsEtkin = _sms.Etkin,
            ayar = new { ayar.SmsSablonu, ayar.CalisanSmsSablonu, ayar.GecerlilikGunu, ayar.BaglantiAdresi },
            ornekAdres = KartAyrilan.Adres(_ayar, "ABCD23456789", ayar),
        });
    }

    /* ==================================================================== */
    /* Takip                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Gönderilmiş bağlantılar ve akıbetleri. Ay verilirse o ayın (çıkış ayı)
    /// bağlantıları, verilmezse hepsi. Kişi başına en son bağlantı.
    /// </summary>
    [HttpGet("Ayrilan/Takip")]
    public IActionResult AyrilanTakip([FromQuery] int? yil, [FromQuery] int? ay, [FromQuery] string tur = null)
    {
        string donemAy = null;

        if (yil.HasValue && ay.HasValue)
        {
            try
            {
                donemAy = Donem(yil, ay).Ay;
            }
            catch (ArgumentException h)
            {
                return BadRequest(new { hata = h.Message });
            }
        }

        var simdi = DateTime.Now;
        var ayar = KartAyrilan.Ayar(_ayar);

        using var db = _vt.Baglanti();

        var hepsi = db.Query<KartAyrilanSatiri>(
                $"SELECT {KartAyrilan.SUTUNLAR} FROM {AYR} WHERE (@ay IS NULL OR ay = @ay)",
                new { ay = donemAy })
            .ToList();

        /* Kişi ve tür başına en son bağlantı: çalışırken gönderilip ayrılınca
           yeniden gönderilen kişinin iki satırı da görünür */
        var turBasina = hepsi
            .GroupBy(x => (SicilAnahtari(x.PersonelKodu).ToUpperInvariant(), x.Calisan))
            .Select(g => g.OrderByDescending(x => x.Id).First())
            .ToList();

        var turSayilari = new
        {
            tumu = turBasina.Count,
            ayrilan = turBasina.Count(x => !x.Calisan),
            calisan = turBasina.Count(x => x.Calisan),
        };

        var turSuz = string.IsNullOrWhiteSpace(tur) || tur == "tumu" ? null : KartAyrilan.TurTemizle(tur);

        var satirlar = turBasina
            .Where(x => turSuz is null || (turSuz == KartAyrilan.TUR_CALISAN) == x.Calisan)
            .ToList();

        var bakiyeler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        string posHatasi = null;

        try
        {
            using var pos = _vt.PosBaglantisi();
            bakiyeler = KartAyrilanTazeleme.Tazele(db, pos, satirlar, simdi);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bağlantılarının bakiyesi okunamadı");
            posHatasi = hata.Message;
        }

        var liste = satirlar.Select(b =>
        {
            decimal? bakiye = b.Etkin && posHatasi is null
                ? (bakiyeler.TryGetValue((b.KartNo ?? "").Trim(), out var x) ? x : 0m)
                : null;

            return (Satir: b, Durum: KartAyrilan.Durum(b, bakiye, simdi), Ozet: BaglantiOzeti(b, bakiye, simdi, ayar));
        })
        .OrderByDescending(x => x.Satir.Gonderim)
        .ToList();

        bool Gitti(KartAyrilanSatiri b) => b.SmsIlk is not null || b.AcilisSayisi > 0;

        var sayilan = liste.Where(x => !x.Satir.Iptal).ToList();

        var ozet = new
        {
            toplam = liste.Count,
            gonderildi = sayilan.Count(x => x.Satir.SmsIlk is not null),
            acildi = sayilan.Count(x => x.Satir.AcilisSayisi > 0),
            sifreBelirledi = sayilan.Count(x => x.Satir.SifreTarihi is not null),
            kullanmayaBasladi = sayilan.Count(x => (x.Satir.Harcanan ?? 0m) > 0m),
            tamamlandi = sayilan.Count(x => x.Durum == "tamamlandi"),
            suresiDoldu = sayilan.Count(x => x.Durum is "sureDoldu" or "sureDolduKismen"),
            kullanmadi = sayilan.Count(x => Gitti(x.Satir) && (x.Satir.Harcanan ?? 0m) <= 0m
                                            && x.Durum is not ("tamamlandi" or "silindi")),
            gonderilenBakiye = sayilan.Where(x => Gitti(x.Satir)).Sum(x => x.Satir.GonderimBakiye ?? 0m),
            harcanan = sayilan.Sum(x => x.Satir.Harcanan ?? 0m),
            kalanBakiye = sayilan.Where(x => x.Satir.Etkin).Sum(x => x.Satir.SonBakiye ?? 0m),
        };

        return Ok(new
        {
            ay = donemAy,
            tur = turSuz ?? "tumu",
            turSayilari,
            baglantilar = liste.Select(x => x.Ozet).ToList(),
            ozet,
            durumlar = liste.GroupBy(x => x.Durum).ToDictionary(g => g.Key, g => g.Count()),
            durumAdlari = KartAyrilan.DurumAdi,
            posHatasi,
        });
    }

    /// <summary>Bağlantının geçmişi (SMS, açılma, TC denemeleri, işlemler).</summary>
    [HttpGet("Ayrilan/{id:int}/Gecmis")]
    public IActionResult AyrilanGecmis(int id)
    {
        using var db = _vt.Baglanti();

        var olaylar = db.Query($@"
SELECT TOP 300 zaman, tur, aciklama, yapan, ip
FROM {KartAyrilan.OLAY} WHERE baglanti_id = @id ORDER BY zaman DESC, id DESC", new { id }).ToList();

        var cihazlar = db.Query($@"
SELECT olusturma, gecerlilik, dogrulama, son_kullanim AS sonKullanim, kullanim_sayisi AS kullanimSayisi,
       ip, tarayici, iptal
FROM {KartAyrilan.CIHAZ} WHERE baglanti_id = @id ORDER BY id DESC", new { id }).ToList();

        return Ok(new { olaylar, cihazlar });
    }

    /* ==================================================================== */
    /* Gönderim                                                             */
    /* ==================================================================== */

    public class AyrilanGonderGirdi
    {
        public List<string> Siciller { get; set; } = new();

        /// <summary>
        /// Gönderilmiş ve süresi içindeki bağlantıyı yeniden yolla. Süre
        /// uzamaz; süresi dolmuş bağlantı yeniden gönderilmez.
        /// </summary>
        public bool Tekrar { get; set; }

        /// <summary>"ayrilan" (varsayılan) ya da "calisan".</summary>
        public string Tur { get; set; }
    }

    /// <summary>
    /// Seçilen ayrılmış personele bağlantı oluşturur ve SMS gönderir.
    /// Kart eşleşmesi, geçerli cep telefonu, TC kaydı ve bakiyesi olmayan,
    /// henüz ayrılmamış ya da yeniden işe girmiş kişi atlanır ve sebebi
    /// bildirilir.
    /// </summary>
    [HttpPost("Ayrilan/Gonder")]
    public async Task<IActionResult> AyrilanGonder([FromBody] AyrilanGonderGirdi girdi)
    {
        var siciller = (girdi?.Siciller ?? new List<string>())
            .Select(SicilAnahtari)
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (siciller.Count == 0) return BadRequest(new { hata = "Personel seçiniz." });
        if (siciller.Count > 300) return BadRequest(new { hata = "Bir seferde en fazla 300 kişiye gönderilebilir." });

        byte[] anahtar;

        try
        {
            anahtar = KartAyrilan.Anahtar(HttpContext.RequestServices.GetRequiredService<IConfiguration>());
        }
        catch (Exception hata)
        {
            _kayit.LogError("Kart bağlantısı anahtarı yok: {Mesaj}", hata.Message);
            return StatusCode(503, new { hata = "Sunucu anahtarı tanımlı değil; Bilgi İşlem ile görüşünüz." });
        }

        var ayar = KartAyrilan.Ayar(_ayar);
        var tumu = _personelKaynak.TumPersonelleriGetir();
        var eslesmeler = Eslesmeler();
        var bugun = DateTime.Today;
        var tur = KartAyrilan.TurTemizle(girdi.Tur);
        var calisanMi = tur == KartAyrilan.TUR_CALISAN;

        var gonderilen = new List<object>();
        var atlanan = new List<object>();
        var hatalar = new List<object>();

        var hedefler = new List<(PersonelKaydi P, string Kart, string Tel, string Tc)>();

        foreach (var sicil in siciller)
        {
            var p = calisanMi
                ? tumu.FirstOrDefault(x => string.Equals(SicilAnahtari(x.PersonelKodu), sicil, StringComparison.OrdinalIgnoreCase)
                                           && x.Durum == 1 && !(x.CikisTarihi is DateTime c && c.Date <= bugun))
                : tumu
                    .Where(x => string.Equals(SicilAnahtari(x.PersonelKodu), sicil, StringComparison.OrdinalIgnoreCase)
                                && x.CikisTarihi.HasValue)
                    .OrderByDescending(x => x.CikisTarihi)
                    .FirstOrDefault();

            void Atla(string sebep) => atlanan.Add(new
            {
                sicil,
                adSoyad = p is null ? sicil : $"{p.Ad} {p.Soyad}".Trim(),
                sebep,
            });

            if (p is null) { Atla(calisanMi ? "çalışan personel kaydı bulunamadı" : "çıkış kaydı bulunamadı"); continue; }

            if (!calisanMi)
            {
                if (p.CikisTarihi.Value.Date > bugun)
                {
                    Atla($"henüz ayrılmadı (çıkış {p.CikisTarihi:dd.MM.yyyy}); \"Çalışan personel\" olarak gönderiniz");
                    continue;
                }

                if (YenidenCalisiyor(p, tumu)) { Atla("yeniden işe girmiş; kartı uygulamada"); continue; }
            }

            if (!eslesmeler.TryGetValue(sicil, out var e) || string.IsNullOrWhiteSpace(e.KartNo))
            {
                Atla("kart eşleşmesi yok");
                continue;
            }

            var tel = Telefon(p.Telefon);

            if (!CepGecerli(tel)) { Atla("cep telefonu geçersiz"); continue; }

            var tc = KartAyrilan.KimlikNormal(p.KimlikNo);

            if (tc is null) { Atla("TC kimlik no kayıtlı değil; kimlik doğrulaması yapılamaz"); continue; }

            hedefler.Add((p, e.KartNo.Trim(), tel, tc));
        }

        /* Kart kaydı ve bakiye tek sorguda; sıfır bakiyeye bağlantı gönderilmiyor */
        var bakiyeler = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var kartVar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (hedefler.Count > 0)
            try
            {
                using var pos = _vt.PosBaglantisi();

                var kartlar = hedefler.Select(x => x.Kart).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

                foreach (var parca in kartlar.Chunk(400))
                    foreach (var no in pos.Query<string>(
                                 $"SELECT CONVERT(VARCHAR(50), k.KartNo) FROM {TABLO} k WHERE k.KartNo IN @parca",
                                 new { parca = PosParametre.Ansi(parca) }, commandTimeout: 60))
                        kartVar.Add((no ?? "").Trim());

                foreach (var (no, tutar) in GiftKartServisi.TopluBakiye(pos, kartlar))
                    bakiyeler[no] = tutar;
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Kart bağlantısı: bakiyeler okunamadı");
                return StatusCode(503, new { hata = "Kart veritabanına ulaşılamıyor.", ayrinti = hata.Message });
            }

        using var db = _vt.Baglanti();

        foreach (var (p, kart, tel, tc) in hedefler)
        {
            var sicil = SicilAnahtari(p.PersonelKodu);
            var adSoyad = $"{p.Ad} {p.Soyad}".Trim();
            DateTime? cikis = p.CikisTarihi?.Date;

            if (!kartVar.Contains(kart))
            {
                atlanan.Add(new { sicil, adSoyad, sebep = "kart MusteriKart'ta bulunamadı" });
                continue;
            }

            var bakiye = bakiyeler.TryGetValue(kart, out var bk) ? bk : 0m;

            try
            {
                var mevcut = db.QueryFirstOrDefault<KartAyrilanSatiri>($@"
SELECT TOP 1 {KartAyrilan.SUTUNLAR}
FROM {AYR}
WHERE personel_kodu = @sicil AND kart_no = @kart AND iptal = 0 AND birakildi IS NULL AND tur = @tur
ORDER BY id DESC", new { sicil, kart, tur });

                var simdi = DateTime.Now;

                if (mevcut is not null && mevcut.SonGecerlilik < simdi)
                {
                    atlanan.Add(new
                    {
                        sicil, adSoyad,
                        sebep = $"bağlantının süresi {mevcut.SonGecerlilik:dd.MM.yyyy} tarihinde doldu; önce \"Süreyi uzat\"",
                    });
                    continue;
                }

                if (mevcut is not null && mevcut.SmsIlk is not null && !girdi.Tekrar)
                {
                    atlanan.Add(new
                    {
                        sicil, adSoyad,
                        sebep = $"zaten gönderildi ({mevcut.SmsIlk:dd.MM.yyyy HH:mm}); yeniden yollamak için \"Tekrar gönder\"",
                    });
                    continue;
                }

                if (bakiye <= 0m)
                {
                    atlanan.Add(new { sicil, adSoyad, sebep = mevcut is null ? "bakiye 0" : "bakiye 0; bağlantı tamamlandı" });
                    continue;
                }

                string kod;
                int id;
                DateTime sonGecerlilik;

                if (mevcut is null)
                {
                    /* Kişinin başka etkin bağlantısı (ör. çalışırken gönderilmiş,
                       şimdi ayrıldı) iptal ediliyor: aynı kişide iki açık bağlantı
                       olmasın. Kart şifresine dokunulmuyor. */
                    foreach (var eski in db.Query<int>($@"
SELECT id FROM {AYR} WHERE personel_kodu = @sicil AND iptal = 0 AND birakildi IS NULL", new { sicil }).ToList())
                    {
                        db.Execute($@"
UPDATE {AYR} SET iptal = 1, iptal_tarihi = SYSDATETIME(), iptal_eden = @yapan WHERE id = @id;
UPDATE {KartAyrilan.CIHAZ} SET iptal = 1 WHERE baglanti_id = @id;", new { id = eski, yapan = Yapan });

                        KartAyrilan.OlayYaz(db, eski, "iptal",
                            calisanMi ? "Yeni (çalışan) bağlantı oluşturulduğu için iptal edildi"
                                      : "Kişi ayrıldı; yeni (ayrılan) bağlantı oluşturulduğu için iptal edildi",
                            Yapan, IstekAdresi);
                    }

                    kod = KartAyrilan.BenzersizKod(db);
                    sonGecerlilik = simdi.AddDays(ayar.GecerlilikGunu);

                    id = db.ExecuteScalar<int>($@"
INSERT INTO {AYR} (kod, ay, personel_kodu, ad_soyad, sube, pozisyon, cikis_tarihi, telefon, kart_no,
                   kimlik_hash, gonderim, son_gecerlilik, gonderim_bakiye, gonderen, tur)
OUTPUT INSERTED.id
VALUES (@kod, @ay, @sicil, @adSoyad, @sube, @pozisyon, @cikis, @tel, @kart,
        @hash, @simdi, @sonGecerlilik, @bakiye, @yapan, @tur)",
                        new
                        {
                            kod,
                            /* Ayrılanda çıkış ayı, çalışanda gönderim ayı */
                            ay = calisanMi || cikis is null ? $"{simdi:yyyy-MM}" : $"{cikis:yyyy-MM}",
                            tur,
                            sicil,
                            adSoyad = KartAyrilan.Kisalt(adSoyad, 120),
                            sube = KartAyrilan.Kisalt((p.IsGrubu ?? "").Trim(), 120),
                            pozisyon = KartAyrilan.Kisalt(p.Pozisyon, 120),
                            cikis,
                            tel,
                            kart,
                            hash = KartAyrilan.KimlikOzeti(anahtar, kod, tc),
                            simdi,
                            sonGecerlilik,
                            bakiye,
                            yapan = Yapan,
                        });

                    KartAyrilan.OlayYaz(db, id, "olusturuldu",
                        $"Bağlantı oluşturuldu ({(calisanMi ? "çalışan" : "ayrılan")}) · bakiye {KartAyrilan.Tutar(bakiye)} TL · son geçerlilik {sonGecerlilik:dd.MM.yyyy}",
                        Yapan, IstekAdresi);

                    /* 27.10.2026: ayrılan personelin kartındaki eski şifre sıfırlanıyor
                       (kimsenin bilmediği rastgele dört hane). Kişi bağlantıdan TC ile
                       doğrulayıp yeni şifresini belirliyor; kasada geçerli olan o şifre.
                       Çalışırken belirlediği / bilinen eski şifre artık işlemiyor. */
                    if (!calisanMi)
                        try
                        {
                            using var posS = _vt.PosBaglantisi();
                            var (sifirlandi, sHata) = KartAyrilan.SifreyiKilitle(posS, kart, _kayit);
                            KartAyrilan.OlayYaz(db, id, sifirlandi ? "sifre_sifirlandi" : "sifre_sifirlanamadi",
                                sifirlandi ? "Kartın eski şifresi sıfırlandı; kişi bağlantıdan yeni şifre belirleyecek"
                                           : "Kartın eski şifresi sıfırlanamadı: " + sHata,
                                Yapan, IstekAdresi);
                        }
                        catch (Exception sh)
                        {
                            _kayit.LogWarning(sh, "Ayrılan kart şifresi sıfırlanamadı: {Sicil}", sicil);
                        }
                }
                else
                {
                    kod = mevcut.Kod;
                    id = mevcut.Id;
                    sonGecerlilik = mevcut.SonGecerlilik;

                    /* Telefon, şube ve TC özeti personel kaydından tazeleniyor
                       (anahtar değiştiyse eski özet tutmazdı). Süre değişmiyor. */
                    db.Execute($@"
UPDATE {AYR} SET ad_soyad = @adSoyad, telefon = @tel, sube = @sube, cikis_tarihi = @cikis, kimlik_hash = @hash
WHERE id = @id",
                        new
                        {
                            id,
                            adSoyad = KartAyrilan.Kisalt(adSoyad, 120),
                            tel,
                            sube = KartAyrilan.Kisalt((p.IsGrubu ?? "").Trim(), 120),
                            cikis,
                            hash = KartAyrilan.KimlikOzeti(anahtar, kod, tc),
                        });
                }

                var adres = KartAyrilan.Adres(_ayar, kod, ayar);

                /* İlk başarılı SMS'te süre o andan başlıyor: önceki deneme
                   başarısız olduysa kişi günlerini kaybetmesin. Tekrar
                   gönderimde süre değişmiyor. */
                var ilkSms = mevcut is null || (mevcut.SmsIlk is null && mevcut.AcilisSayisi == 0 && mevcut.UzatmaSayisi == 0);
                var smsSonGecerlilik = ilkSms ? simdi.AddDays(ayar.GecerlilikGunu) : sonGecerlilik;

                var metin = KartAyrilan.SmsMetni(ayar.Sablon(tur), adSoyad, bakiye, adres,
                    KalanGun(smsSonGecerlilik, simdi), smsSonGecerlilik);

                var sonuc = await _sms.Gonder(tel, metin);

                if (sonuc.Basarili)
                {
                    db.Execute($@"
UPDATE {AYR}
SET sms_durum = @tamam, sms_hata = NULL,
    son_gecerlilik = CASE WHEN sms_ilk IS NULL AND acilis_sayisi = 0 AND uzatma_sayisi = 0
                          THEN @smsSonGecerlilik ELSE son_gecerlilik END,
    sms_ilk = COALESCE(sms_ilk, SYSDATETIME()),
    sms_son = SYSDATETIME(),
    sms_sayisi = sms_sayisi + 1,
    son_gonderen = @yapan,
    gonderim_bakiye = CASE WHEN sms_ilk IS NULL THEN @bakiye ELSE gonderim_bakiye END
WHERE id = @id",
                        new { id, tamam = KartAyrilan.SMS_TAMAM, yapan = Yapan, bakiye, smsSonGecerlilik });

                    KartAyrilan.OlayYaz(db, id, mevcut?.SmsIlk is null ? "sms" : "sms_tekrar",
                        $"SMS gönderildi · {tel[..3]}*****{tel[^2..]}", Yapan, IstekAdresi);

                    gonderilen.Add(new { sicil, adSoyad, id, adres, bakiye, tekrar = mevcut?.SmsIlk is not null });
                }
                else
                {
                    var hataMetni = (sonuc.Mesaj ?? "gönderilemedi").Trim();

                    /* Daha önce başarıyla gitmişse durum korunuyor, son hata ayrıca yazılıyor */
                    db.Execute($@"
UPDATE {AYR}
SET sms_durum = CASE WHEN sms_durum = @tamam THEN sms_durum ELSE @hataDurumu END,
    sms_hata = @hata, son_gonderen = @yapan
WHERE id = @id",
                        new
                        {
                            id,
                            tamam = KartAyrilan.SMS_TAMAM,
                            hataDurumu = KartAyrilan.SMS_HATA,
                            hata = KartAyrilan.Kisalt(hataMetni, 400),
                            yapan = Yapan,
                        });

                    KartAyrilan.OlayYaz(db, id, "sms_hata", "SMS gönderilemedi: " + hataMetni, Yapan, IstekAdresi);

                    hatalar.Add(new { sicil, adSoyad, id, adres, hata = hataMetni });
                }
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Kart bağlantısı gönderilemedi: {Sicil}", sicil);
                hatalar.Add(new { sicil, adSoyad, hata = hata.Message });
            }
        }

        _kayit.LogInformation(
            "Ayrılan personel kart bağlantısı: {Gonderilen} SMS, {Atlanan} atlandı, {Hata} hata ({Yapan})",
            gonderilen.Count, atlanan.Count, hatalar.Count, Yapan);

        return Ok(new { gonderilen, atlanan, hatalar, smsEtkin = _sms.Etkin, tur });
    }

    /// <summary>
    /// Prim yüklemesi onaylanınca (BicenKartPuanController): işten ayrılmış
    /// olanlara kart bağlantısı. Süresi dolmuş açık bağlantı ayardaki gün
    /// kadar uzatılır; açık bağlantısı olana SMS tekrar gider (yeni bakiye).
    /// Çalışan ya da yeniden işe girmiş personel atlanır. Kısa özet döner.
    /// </summary>
    [NonAction]
    public async Task<string> PrimIcinAyrilanaGonder(List<string> siciller)
    {
        var tumu = _personelKaynak.TumPersonelleriGetir();
        var bugun = DateTime.Today;

        var ayrilan = siciller.Select(SicilAnahtari).Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Where(s =>
            {
                var k = tumu.Where(x => string.Equals(SicilAnahtari(x.PersonelKodu), s, StringComparison.OrdinalIgnoreCase)).ToList();
                var calisiyor = k.Any(x => x.Durum == 1 && !(x.CikisTarihi is DateTime c && c.Date <= bugun));
                return !calisiyor && k.Any(x => x.CikisTarihi is DateTime c && c.Date <= bugun);
            })
            .ToList();

        if (ayrilan.Count == 0) return null;

        var ayar = KartAyrilan.Ayar(_ayar);

        using (var db = _vt.Baglanti())
        {
            var dolmus = db.Query<int>($@"
SELECT id FROM {AYR}
WHERE personel_kodu IN @ayrilan AND tur = @tur AND iptal = 0 AND birakildi IS NULL AND son_gecerlilik < SYSDATETIME()",
                new { ayrilan, tur = KartAyrilan.TUR_AYRILAN }).ToList();

            if (dolmus.Count > 0)
                AyrilanUzat(new AyrilanIdGirdi { Idler = dolmus, Gun = Math.Clamp(ayar.GecerlilikGunu, 1, 90) });
        }

        int gonderilen = 0, atlanan = 0, hata = 0;

        foreach (var parca in ayrilan.Chunk(300))
        {
            var sonuc = await AyrilanGonder(new AyrilanGonderGirdi
            {
                Siciller = parca.ToList(),
                Tekrar = true,
                Tur = KartAyrilan.TUR_AYRILAN,
            });

            if (sonuc is ObjectResult { Value: not null } o)
            {
                var v = o.Value;
                int Say(string ad) => v.GetType().GetProperty(ad)?.GetValue(v) is System.Collections.ICollection c ? c.Count : 0;
                gonderilen += Say("gonderilen");
                atlanan += Say("atlanan");
                hata += Say("hatalar");
            }
        }

        return $"{ayrilan.Count} ayrılan personel: {gonderilen} SMS gitti"
               + (atlanan > 0 ? $", {atlanan} atlandı" : "")
               + (hata > 0 ? $", {hata} hata" : "")
               + " (ayrıntı Biçen Kart › Ayrılan personel › Takip)";
    }

    /// <summary>
    /// Otomatik gönderim (27.10.2026, KartAyrilanGorevi saat başı): çıkış
    /// tarihi son N gün içinde (bugün dahil) olan, yeniden işe girmemiş ve
    /// adına hiç "ayrılan" bağlantısı açılmamış (iptal edilmiş olan da
    /// sayılır: İK iptal ettiyse yeniden gönderilmez) personele elle
    /// gönderimle aynı kod. Kart / telefon / TC / bakiye eksikse atlanır
    /// ve sonraki turda yeniden denenir (bakiye sonradan yüklenebilir).
    /// SMS hatasında kayıt oluştuğu için yeniden denenmez; Takip'te görünür.
    /// </summary>
    [NonAction]
    public async Task<(int Gonderilen, int Atlanan, int Hata)> OtomatikAyrilanaGonder()
    {
        var ayar = KartAyrilan.Ayar(_ayar);
        if (!ayar.OtomatikGonder || !_sms.Etkin) return (0, 0, 0);

        var saat = DateTime.Now.Hour;
        if (saat < ayar.OtomatikSaatBas || saat >= ayar.OtomatikSaatBit) return (0, 0, 0);

        var bugun = DateTime.Today;
        var ilk = bugun.AddDays(-ayar.OtomatikGeriGun);
        var tumu = _personelKaynak.TumPersonelleriGetir();

        var adaylar = tumu
            .Where(x => x.CikisTarihi is DateTime c && c.Date <= bugun && c.Date >= ilk)
            .Where(x => !YenidenCalisiyor(x, tumu))
            .Select(x => SicilAnahtari(x.PersonelKodu))
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (adaylar.Count == 0) return (0, 0, 0);

        using (var db = _vt.Baglanti())
        {
            var olanlar = new HashSet<string>(db.Query<string>($@"
SELECT DISTINCT personel_kodu FROM {AYR} WHERE tur = @tur AND personel_kodu IN @adaylar",
                new { tur = KartAyrilan.TUR_AYRILAN, adaylar }), StringComparer.OrdinalIgnoreCase);
            adaylar = adaylar.Where(x => !olanlar.Contains(x)).ToList();
        }

        if (adaylar.Count == 0) return (0, 0, 0);

        int gonderilen = 0, atlanan = 0, hata = 0;

        foreach (var parca in adaylar.Chunk(300))
        {
            var sonuc = await AyrilanGonder(new AyrilanGonderGirdi
            {
                Siciller = parca.ToList(),
                Tekrar = false,
                Tur = KartAyrilan.TUR_AYRILAN,
            });

            if (sonuc is ObjectResult { Value: not null } o)
            {
                var v = o.Value;
                int Say(string ad) => v.GetType().GetProperty(ad)?.GetValue(v) is System.Collections.ICollection c ? c.Count : 0;
                gonderilen += Say("gonderilen");
                atlanan += Say("atlanan");
                hata += Say("hatalar");
            }
        }

        return (gonderilen, atlanan, hata);
    }

    /* ==================================================================== */
    /* Satır işlemleri                                                      */
    /* ==================================================================== */

    public class AyrilanIdGirdi
    {
        public List<int> Idler { get; set; } = new();

        /// <summary>Süreyi uzat: eklenecek gün.</summary>
        public int Gun { get; set; }

        /// <summary>İptal: kart şifresi de geçersiz kılınsın (varsayılan evet).</summary>
        public bool SifreSifirla { get; set; } = true;

        /// <summary>Bakiyeyi sil: sebep (Puan Yönetimi'ndeki gibi zorunlu).</summary>
        public string Sebep { get; set; }
    }

    private static List<int> Idler(AyrilanIdGirdi g) =>
        (g?.Idler ?? new List<int>()).Where(x => x > 0).Distinct().Take(500).ToList();

    /// <summary>
    /// Süreyi uzatır: yeni son geçerlilik = (bitmemişse eski bitiş, bitmişse
    /// şimdi) + N gün. Kart şifresi süre dolunca kilitlendiyse kişi bağlantıdan
    /// TC ile yeni şifre belirler.
    /// </summary>
    [HttpPost("Ayrilan/Uzat")]
    public IActionResult AyrilanUzat([FromBody] AyrilanIdGirdi girdi)
    {
        var idler = Idler(girdi);

        if (idler.Count == 0) return BadRequest(new { hata = "Bağlantı seçiniz." });
        if (girdi.Gun is < 1 or > 90) return BadRequest(new { hata = "Uzatma 1–90 gün arasında olmalıdır." });

        using var db = _vt.Baglanti();

        var uzatilan = 0;
        var atlanan = new List<object>();

        foreach (var b in BaglantilariAl(db, idler))
        {
            if (!b.Etkin)
            {
                atlanan.Add(new { id = b.Id, b.AdSoyad, sebep = b.Iptal ? "bağlantı iptal" : "kart boşa çıkarılmış" });
                continue;
            }

            var taban = b.SonGecerlilik > DateTime.Now ? b.SonGecerlilik : DateTime.Now;
            var yeni = taban.AddDays(girdi.Gun);

            db.Execute($@"
UPDATE {AYR} SET son_gecerlilik = @yeni, suresi_doldu = NULL, uzatma_sayisi = uzatma_sayisi + 1 WHERE id = @id",
                new { id = b.Id, yeni });

            KartAyrilan.OlayYaz(db, b.Id, "uzatildi",
                $"Süre {girdi.Gun} gün uzatıldı · {b.SonGecerlilik:dd.MM.yyyy} → {yeni:dd.MM.yyyy}", Yapan, IstekAdresi);

            uzatilan++;
        }

        _kayit.LogInformation("Kart bağlantısı uzatıldı: {Adet} bağlantı, {Gun} gün ({Yapan})", uzatilan, girdi.Gun, Yapan);

        return Ok(new { uzatilan, atlanan });
    }

    /// <summary>
    /// Bağlantıyı iptal eder: sayfa "bağlantı iptal edildi" der, tanınan
    /// cihazlar düşer. İstenirse (varsayılan) kart şifresi de rastgeleye
    /// çevrilir ki kişi numarayı bilse bile kasada harcama onaylanamasın.
    /// </summary>
    [HttpPost("Ayrilan/Iptal")]
    public IActionResult AyrilanIptal([FromBody] AyrilanIdGirdi girdi)
    {
        var idler = Idler(girdi);

        if (idler.Count == 0) return BadRequest(new { hata = "Bağlantı seçiniz." });

        using var db = _vt.Baglanti();

        var iptal = 0;
        var sifreKilit = 0;
        var uyarilar = new List<object>();

        System.Data.IDbConnection pos = null;

        try
        {
            foreach (var b in BaglantilariAl(db, idler).Where(x => !x.Iptal))
            {
                db.Execute($@"
UPDATE {AYR} SET iptal = 1, iptal_tarihi = SYSDATETIME(), iptal_eden = @yapan WHERE id = @id;
UPDATE {KartAyrilan.CIHAZ} SET iptal = 1 WHERE baglanti_id = @id;", new { id = b.Id, yapan = Yapan });

                KartAyrilan.OlayYaz(db, b.Id, "iptal", "Bağlantı iptal edildi", Yapan, IstekAdresi);
                iptal++;

                if (!girdi.SifreSifirla || b.Birakildi is not null) continue;

                /* Çalışan personel kartını Biçen360'ta kullanıyor: şifresine dokunulmaz */
                if (b.Calisan)
                {
                    uyarilar.Add(new { id = b.Id, b.AdSoyad, uyari = "personel hâlâ çalışıyor; kart şifresine dokunulmadı" });
                    continue;
                }

                if (!KartAyrilan.KartKisininMi(db, b.KartNo, b.PersonelKodu))
                {
                    uyarilar.Add(new { id = b.Id, b.AdSoyad, uyari = "kart artık bu kişide değil; şifreye dokunulmadı" });
                    continue;
                }

                try
                {
                    pos ??= _vt.PosBaglantisi();

                    var (tamam, hata) = KartAyrilan.SifreyiKilitle(pos, b.KartNo.Trim(), _kayit);

                    if (tamam)
                    {
                        db.Execute($"UPDATE {AYR} SET sifre_gecersiz = SYSDATETIME() WHERE id = @id", new { id = b.Id });
                        KartAyrilan.OlayYaz(db, b.Id, "sifre_kilit", "Kart şifresi rastgeleye çevrildi (iptal)", Yapan);
                        sifreKilit++;
                    }
                    else
                    {
                        uyarilar.Add(new { id = b.Id, b.AdSoyad, uyari = hata });
                    }
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "İptalde kart şifresi kilitlenemedi: {Id}", b.Id);
                    uyarilar.Add(new { id = b.Id, b.AdSoyad, uyari = "kart şifresi değiştirilemedi: " + hata.Message });
                }
            }
        }
        finally
        {
            pos?.Dispose();
        }

        _kayit.LogInformation("Kart bağlantısı iptal: {Adet} ({Sifre} şifre kilidi) ({Yapan})", iptal, sifreKilit, Yapan);

        return Ok(new { iptal, sifreKilit, uyarilar });
    }

    /// <summary>Hatalı TC denemeleriyle kilitlenen bağlantıyı açar.</summary>
    [HttpPost("Ayrilan/KilitAc")]
    public IActionResult AyrilanKilitAc([FromBody] AyrilanIdGirdi girdi)
    {
        var idler = Idler(girdi);

        if (idler.Count == 0) return BadRequest(new { hata = "Bağlantı seçiniz." });

        using var db = _vt.Baglanti();

        var acilan = 0;

        foreach (var id in idler)
        {
            var n = db.Execute($@"
UPDATE {AYR} SET kilit_bitis = NULL, hatali_deneme = 0, kilit_sayisi = 0
WHERE id = @id AND (kilit_bitis IS NOT NULL OR hatali_deneme > 0)", new { id });

            if (n == 0) continue;

            KartAyrilan.OlayYaz(db, id, "kilit_acildi", "Kilit panelden açıldı", Yapan, IstekAdresi);
            acilan++;
        }

        return Ok(new { acilan });
    }

    /// <summary>
    /// Kartı boşa çıkarır: eşleşme kaldırma ile aynı iş (MusteriKart'ta ad
    /// "BİÇEN KART", telefon ve şifre boş; KRY_KART_ESLESME silinir). Bakiye
    /// ve hareketler kartta kalır. Bağlantı "kart boşa çıkarıldı" olur.
    /// Kart başka birine geçmişse dokunulmaz.
    /// </summary>
    [HttpPost("Ayrilan/KartBirak")]
    public IActionResult AyrilanKartBirak([FromBody] AyrilanIdGirdi girdi)
    {
        var idler = Idler(girdi);

        if (idler.Count == 0) return BadRequest(new { hata = "Bağlantı seçiniz." });

        using var db = _vt.Baglanti();

        var birakilan = new List<object>();
        var atlanan = new List<object>();
        var hatalar = new List<object>();

        var hedefler = BaglantilariAl(db, idler).Where(x => x.Birakildi is null).ToList();

        if (hedefler.Count == 0) return Ok(new { birakilan, atlanan, hatalar });

        try
        {
            using var pos = _vt.PosBaglantisi();

            var bakiyeler = GiftKartServisi.TopluBakiye(pos, hedefler.Select(x => x.KartNo))
                .ToDictionary(x => x.KartNo, x => x.Bakiye, StringComparer.OrdinalIgnoreCase);

            foreach (var b in hedefler)
            {
                var kart = (b.KartNo ?? "").Trim();
                var sicil = SicilAnahtari(b.PersonelKodu);

                if (!KartAyrilan.KartKisininMi(db, kart, sicil))
                {
                    atlanan.Add(new { id = b.Id, b.AdSoyad, sebep = "kart artık bu kişiye eşli değil" });
                    continue;
                }

                try
                {
                    KartiBirak(pos, kart);

                    db.Execute(@"
DELETE FROM KRY_KART_ESLESME WHERE kart_no = @kart AND LTRIM(RTRIM(personel_kodu)) = @sicil",
                        new { kart, sicil });

                    db.Execute($@"
UPDATE {AYR} SET birakildi = SYSDATETIME(), birakan = @yapan
WHERE personel_kodu = @sicil AND kart_no = @kart AND birakildi IS NULL;
UPDATE {KartAyrilan.CIHAZ} SET iptal = 1 WHERE baglanti_id = @id;",
                        new { id = b.Id, sicil, kart, yapan = Yapan });

                    var kalan = bakiyeler.TryGetValue(kart, out var bb) ? bb : 0m;

                    KartAyrilan.OlayYaz(db, b.Id, "kart_birakildi",
                        $"Kart boşa çıkarıldı · kartta kalan bakiye {KartAyrilan.Tutar(kalan)} TL", Yapan, IstekAdresi);

                    _kayit.LogInformation(
                        "Ayrılan personelin kartı boşa çıkarıldı: {Kart} ← {Sicil}, kalan bakiye {Bakiye} ({Yapan})",
                        kart, sicil, kalan, Yapan);

                    birakilan.Add(new { id = b.Id, b.AdSoyad, bakiye = kalan });
                }
                catch (Exception hata)
                {
                    _kayit.LogError(hata, "Kart boşa çıkarılamadı: {Kart}", kart);
                    hatalar.Add(new { id = b.Id, b.AdSoyad, hata = hata.Message });
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Kart veritabanına ulaşılamadı");
            return StatusCode(503, new { hata = "Kart veritabanına ulaşılamıyor.", ayrinti = hata.Message });
        }

        return Ok(new { birakilan, atlanan, hatalar });
    }

    /// <summary>
    /// Kartta kalan bakiyeyi siler. İş Puan Yönetimi'nin silmesiyle birebir
    /// aynı uçtan yapılıyor (<see cref="BicenKartPuanController.Sil"/>):
    /// PuanHareket'e 6 satırı + dbo.EksiPuanIsle, KRY_PUAN_ISLEM kaydı ve
    /// aynı yetki/oturum bilgisiyle. Kart başka birine geçmişse dokunulmaz.
    /// </summary>
    [HttpPost("Ayrilan/BakiyeSil")]
    public async Task<IActionResult> AyrilanBakiyeSil([FromBody] AyrilanIdGirdi girdi)
    {
        var idler = Idler(girdi);
        var sebep = (girdi?.Sebep ?? "").Trim();

        if (idler.Count == 0) return BadRequest(new { hata = "Bağlantı seçiniz." });
        if (sebep.Length < 3) return BadRequest(new { hata = "Silme sebebini yazınız." });

        using var db = _vt.Baglanti();

        var silinen = new List<object>();
        var atlanan = new List<object>();
        var hatalar = new List<object>();

        foreach (var b in BaglantilariAl(db, idler))
        {
            var kart = (b.KartNo ?? "").Trim();

            if (b.Birakildi is null && !KartAyrilan.KartKisininMi(db, kart, b.PersonelKodu))
            {
                atlanan.Add(new { id = b.Id, b.AdSoyad, sebep = "kart artık bu kişiye eşli değil" });
                continue;
            }

            if (b.Birakildi is not null)
            {
                atlanan.Add(new { id = b.Id, b.AdSoyad, sebep = "kart boşa çıkarılmış; Puan Yönetimi'nden siliniz" });
                continue;
            }

            /* Puan Yönetimi'nin denetleyicisi bu isteğin oturumuyla kuruluyor */
            var puan = ActivatorUtilities.CreateInstance<BicenKartPuanController>(HttpContext.RequestServices);
            puan.ControllerContext = ControllerContext;

            IActionResult cevap;

            try
            {
                cevap = await puan.Sil(new BicenKartPuanController.SilGirdi
                {
                    KartNo = kart,
                    Tamami = true,
                    Sebep = $"Ayrılan personel kartı ({b.AdSoyad}): {sebep}",
                });
            }
            catch (Exception hata)
            {
                hatalar.Add(new { id = b.Id, b.AdSoyad, hata = hata.Message });
                continue;
            }

            if (cevap is OkObjectResult ok)
            {
                var tutar = ok.Value?.GetType().GetProperty("tutar")?.GetValue(ok.Value) as decimal? ?? 0m;

                KartAyrilan.OlayYaz(db, b.Id, "bakiye_silindi",
                    $"Bakiye silindi · {KartAyrilan.Tutar(tutar)} TL · {sebep}", Yapan, IstekAdresi);

                silinen.Add(new { id = b.Id, b.AdSoyad, tutar });
                continue;
            }

            var mesaj = cevap is ObjectResult o && o.Value is not null
                ? o.Value.GetType().GetProperty("hata")?.GetValue(o.Value) as string
                : null;

            /* "Silinecek puan yok" hata değil, atlama */
            if (cevap is BadRequestObjectResult)
                atlanan.Add(new { id = b.Id, b.AdSoyad, sebep = mesaj ?? "silinemedi" });
            else
                hatalar.Add(new { id = b.Id, b.AdSoyad, hata = mesaj ?? "silinemedi" });
        }

        return Ok(new { silinen, atlanan, hatalar });
    }

    /* ==================================================================== */
    /* Ayar                                                                 */
    /* ==================================================================== */

    [HttpGet("Ayrilan/Ayar")]
    public IActionResult AyrilanAyar()
    {
        var a = KartAyrilan.Ayar(_ayar);

        return Ok(new
        {
            a.SmsSablonu,
            a.CalisanSmsSablonu,
            a.GecerlilikGunu,
            a.BaglantiAdresi,
            a.OtomatikGonder,
            a.OtomatikGeriGun,
            a.OtomatikSaatBas,
            a.OtomatikSaatBit,
            varsayilanSablon = KartAyrilanAyari.VarsayilanSablon,
            varsayilanCalisanSablon = KartAyrilanAyari.VarsayilanCalisanSablon,
            ornekAdres = KartAyrilan.Adres(_ayar, "ABCD23456789", a),
            smsEtkin = _sms.Etkin,
        });
    }

    public class AyrilanAyarGirdi
    {
        public string SmsSablonu { get; set; }
        public string CalisanSmsSablonu { get; set; }
        public int GecerlilikGunu { get; set; }
        public string BaglantiAdresi { get; set; }

        /* 27.10.2026: otomatik gönderim; gönderilmezse (eski panel) mevcut değer korunur */
        public bool? OtomatikGonder { get; set; }
        public int? OtomatikGeriGun { get; set; }
        public int? OtomatikSaatBas { get; set; }
        public int? OtomatikSaatBit { get; set; }
    }

    [HttpPost("Ayrilan/Ayar")]
    public IActionResult AyrilanAyarKaydet([FromBody] AyrilanAyarGirdi girdi)
    {
        var sablon = (girdi?.SmsSablonu ?? "").Trim();

        if (sablon.Length == 0) sablon = KartAyrilanAyari.VarsayilanSablon;
        if (sablon.Length > 480) return BadRequest(new { hata = "SMS metni en fazla 480 karakter olabilir." });
        if (!sablon.Contains("{link}")) return BadRequest(new { hata = "SMS metninde {link} yer tutucusu bulunmalıdır." });

        var calisanSablon = (girdi.CalisanSmsSablonu ?? "").Trim();

        if (calisanSablon.Length == 0) calisanSablon = KartAyrilanAyari.VarsayilanCalisanSablon;
        if (calisanSablon.Length > 480) return BadRequest(new { hata = "Çalışan SMS metni en fazla 480 karakter olabilir." });
        if (!calisanSablon.Contains("{link}")) return BadRequest(new { hata = "Çalışan SMS metninde {link} yer tutucusu bulunmalıdır." });
        if (girdi.GecerlilikGunu is < 1 or > 365) return BadRequest(new { hata = "Geçerlilik 1–365 gün olmalıdır." });

        var adres = (girdi.BaglantiAdresi ?? "").Trim();

        if (adres.Length > 0 && !Uri.TryCreate(adres.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? adres : "https://" + adres,
                UriKind.Absolute, out _))
            return BadRequest(new { hata = "Bağlantı adresi geçersiz." });

        var eski = KartAyrilan.Ayar(_ayar);
        var a = new KartAyrilanAyari
        {
            SmsSablonu = sablon,
            CalisanSmsSablonu = calisanSablon,
            GecerlilikGunu = girdi.GecerlilikGunu,
            BaglantiAdresi = adres,
            OtomatikGonder = girdi.OtomatikGonder ?? eski.OtomatikGonder,
            OtomatikGeriGun = Math.Clamp(girdi.OtomatikGeriGun ?? eski.OtomatikGeriGun, 1, 30),
            OtomatikSaatBas = Math.Clamp(girdi.OtomatikSaatBas ?? eski.OtomatikSaatBas, 0, 23),
            OtomatikSaatBit = Math.Clamp(girdi.OtomatikSaatBit ?? eski.OtomatikSaatBit, 1, 24),
        };
        if (a.OtomatikSaatBit <= a.OtomatikSaatBas) return BadRequest(new { hata = "Otomatik gönderim saat aralığı geçersiz." });

        _ayar.Yaz(KartAyrilan.AYAR, a);

        _kayit.LogInformation("Ayrılan personel kart ayarı değişti: {Gun} gün ({Yapan})", a.GecerlilikGunu, Yapan);

        return Ok(new
        {
            a.SmsSablonu, a.CalisanSmsSablonu, a.GecerlilikGunu, a.BaglantiAdresi,
            a.OtomatikGonder, a.OtomatikGeriGun, a.OtomatikSaatBas, a.OtomatikSaatBit,
            ornekAdres = KartAyrilan.Adres(_ayar, "ABCD23456789", a),
        });
    }

    /// <summary>
    /// Tanı: MusteriKart'ın sütunları (ad, tür). Kasada kartı engelleyen bir
    /// aktif/pasif sütunu olup olmadığını görmek için; yalnızca Admin.
    /// </summary>
    [HttpGet("Ayrilan/KartSutunlari")]
    [Authorize(Roles = Roller.Admin)]
    public IActionResult AyrilanKartSutunlari()
    {
        try
        {
            using var pos = _vt.PosBaglantisi();

            var sutunlar = pos.Query(@"
SELECT COLUMN_NAME AS ad, DATA_TYPE AS tur, CHARACTER_MAXIMUM_LENGTH AS uzunluk, IS_NULLABLE AS bos
FROM [PosbackPromosyon].INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'MusteriKart'
ORDER BY ORDINAL_POSITION", commandTimeout: 30).ToList();

            return Ok(new { sutunlar });
        }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Kart veritabanına ulaşılamıyor.", ayrinti = hata.Message });
        }
    }
}

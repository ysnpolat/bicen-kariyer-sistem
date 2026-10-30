using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Fiyat kontrol.
///
/// <para>
/// Barkod okutulduğunda ürünün üç fiyatı, yer kodu ve şubedeki eldeki
/// stoğu dönüyor. Her ikisi de merkezdeki Mikro veritabanından: şubelerin
/// kendi OzSube veritabanlarına sunucudan erişilemiyor.
/// </para>
///
/// <para>
/// Şubeye özel fiyat, merkezde depo bazlı tutulan fiyat değişikliklerinden
/// çıkarılıyor: her fiyat numarası için o depoya ait en son değişiklik, o
/// şubede geçerli olan fiyat. Depoya özel kayıt yoksa genel kayda
/// düşülüyor.
/// </para>
///
/// <para>
/// Hangi şubenin sorgulanacağı personelin kendi şubesinden geliyor.
/// Merkez ofisten sorgulayan kişi bir şube seçiyor ve seçim
/// değiştirilene kadar saklanıyor; her sorguda yeniden seçmek,
/// otuz dört şube arasından her seferinde arama yapmak demekti.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FiyatKontrolController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelServisi _personel;
    private readonly IConfiguration _yapilandirma;
    private readonly MailServisi _mail;
    private readonly PanelKullaniciServisi _panelKullanici;
    private readonly VardiyaPlaniDenetimi _vardiya;
    private readonly YetkiServisi _yetki;
    private readonly EtiketKayitServisi _etiketKayit;
    private readonly PanelKampanyaServisi _panelKampanya;
    private readonly ILogger<FiyatKontrolController> _kayit;

    public FiyatKontrolController(
        VeritabaniServisi vt,
        PersonelServisi personel,
        IConfiguration yapilandirma,
        MailServisi mail,
        PanelKullaniciServisi panelKullanici,
        VardiyaPlaniDenetimi vardiya,
        YetkiServisi yetki,
        EtiketKayitServisi etiketKayit,
        PanelKampanyaServisi panelKampanya,
        ILogger<FiyatKontrolController> kayit)
    {
        _panelKampanya = panelKampanya;
        _etiketKayit = etiketKayit;
        _yetki = yetki;
        _vardiya = vardiya;
        _panelKullanici = panelKullanici;
        _vt = vt;
        _personel = personel;
        _yapilandirma = yapilandirma;
        _mail = mail;
        _kayit = kayit;
    }

    private string Kullanici => User.Identity?.Name ?? "";

    /// <summary>
    /// Jetondaki sicil.
    ///
    /// Mobil oturumda kullanıcı adı "personel:14721|cihaz-kimliği"
    /// biçiminde geliyor; olduğu gibi kullanmak hem personel kaydını
    /// bulamıyor hem de kısa sütunlara sığmıyordu. Panel oturumunda
    /// kullanıcı adının kendisi dönüyor.
    /// </summary>
    private string Sicil
    {
        get
        {
            var ad = Kullanici;

            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase))
                return ad;

            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');

            return i < 0 ? govde : govde[..i];
        }
    }

    /// <summary>
    /// Mobil personelin bu hafta vardiya planı yoksa engel cevabı (409).
    /// 403 kullanılmıyor: uygulama 403'te sabit "yetkiniz yok" metni
    /// gösteriyor; 409'da sunucunun metnini olduğu gibi gösteriyor.
    /// Panel kullanıcısı denetlenmiyor.
    /// </summary>
    private IActionResult VardiyaEngeli()
    {
        var mesaj = VardiyaMesaji();

        return mesaj is null ? null : StatusCode(409, new { hata = mesaj, kod = "vardiyaPlaniYok" });
    }

    private bool Mobil => Kullanici.StartsWith("personel:", StringComparison.OrdinalIgnoreCase);

    /// <summary>Mobil personelin bu hafta vardiya planı yoksa uyarı metni.</summary>
    private string VardiyaMesaji() => Mobil ? _vardiya.FiyatKontrolEngeli(Sicil) : null;

    /// <summary>Metni sütun genişliğine kırpar; taşan değer kaydı düşürüyordu.</summary>
    private static string Kirp(string deger, int uzunluk)
    {
        var d = (deger ?? "").Trim();

        return d.Length <= uzunluk ? d : d[..uzunluk];
    }

    /* ====================================================================== */

    /// <summary>
    /// Sorgulanacak şube ve seçilebilecek şubeler.
    ///
    /// <para>
    /// Şube personeli (06.10.2026) yalnızca kendi şubesini görüyor: liste
    /// tek şubeye iniyor ve seçim kilitleniyor. Kendi şubesi personel
    /// kaydındaki iş grubundan bulunuyor; iş grubu bir şubeyle
    /// eşleşmeyen (genel merkez, depo, hal) personel eskisi gibi seçiyor.
    /// </para>
    ///
    /// <para>
    /// Vardiya planı yoksa sayfa açılır açılmaz uyarı görünsün diye
    /// <c>vardiyaEngeli</c> dönüyor. Yayındaki uygulama (1.5) bu alanı
    /// tanımıyor; onda uyarı, ekranın en üstündeki şube satırında şube adı
    /// yerine yazılıyor. Sorgu ve liste gönderimi zaten 409 ile kapalı.
    /// </para>
    /// </summary>
    [HttpGet("Sube")]
    public IActionResult Sube()
    {
        using var db = _vt.Baglanti();

        var kendi = KendiSubesi();
        var engel = VardiyaMesaji();

        var secilen = kendi is null
            ? db.ExecuteScalar<string>(
                "SELECT sube_kodu FROM B360_SUBE_SECIM WHERE kullanici = @Kullanici",
                new { Kullanici })
            : (string)kendi.subeKodu;

        var subeler = kendi is null
            ? db.Query(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo,
       eposta, CASE WHEN baglanti IS NULL THEN 0 ELSE 1 END AS kendiVeritabani
FROM B360_SUBE_DEPO WHERE aktif = 1 ORDER BY sube_adi, sube_kodu").ToList()
            : new List<dynamic> { kendi };

        /* Eski uygulama için: uyarı şube satırında okunuyor */
        if (engel is not null)
        {
            secilen = (string)kendi?.subeKodu ?? "-";

            subeler = new List<dynamic>
            {
                new
                {
                    subeKodu = secilen,
                    subeAdi = "⚠ Bu hafta vardiya planınız yok. Fiyat Kontrol kullanılamaz.",
                    depoNo = (int?)kendi?.depoNo,
                    eposta = (string)null,
                    kendiVeritabani = 0,
                },
            };
        }

        return Ok(new
        {
            secilen,
            subeler,
            kilitli = kendi is not null,
            vardiyaEngeli = engel,

            /* Tanım yoksa sorgu çalışmaz; ekranda açık bir uyarı
               gösterilebilsin diye ayrıca bildiriliyor. */
            tanimliMi = subeler.Count > 0
        });
    }

    /// <summary>
    /// Fiyat listesi adları.
    ///
    /// Adlar Mikro'da tanımlı ve değişebiliyor; ekrana "Fiyat 1" yerine
    /// "Raf Fiyatı" yazmak için koda gömmek yerine buradan okunuyor.
    /// </summary>
    [HttpGet("Listeler")]
    public IActionResult Listeler()
    {
        try
        {
            using var mikro = _vt.MikroBaglantisi();

            var listeler = mikro.Query(@"
SELECT sfl_sirano AS sira, sfl_aciklama AS ad, sfl_kdvdahil AS kdvDahil
FROM STOK_SATIS_FIYAT_LISTE_TANIMLARI WITH (NOLOCK)
WHERE sfl_iptal = 0 AND sfl_sirano BETWEEN 1 AND 3
ORDER BY sfl_sirano").ToList();

            return Ok(new { listeler });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fiyat listesi adları okunamadı");

            /* Adlar alınamazsa ekran sayıyla devam etsin; sorgunun
               kendisi bundan etkilenmiyor. */
            return Ok(new { listeler = new List<object>() });
        }
    }

    /// <summary>Sorgulanacak şubeyi seçer.</summary>
    [HttpPost("Sube")]
    public IActionResult SubeSec([FromBody] SubeSecimGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.SubeKodu))
            return BadRequest(new { hata = "Şube seçiniz." });

        if (VardiyaEngeli() is { } engel) return engel;

        /* Şube kullanıcısı ve şube personeli başka şubeye geçemiyor.
           409: uygulama 403'te kendi "yetkiniz yok" metnini gösteriyor. */
        var kendi = KendiSubesi();

        if (kendi is not null)
        {
            if (string.Equals(girdi.SubeKodu.Trim(), (string)kendi.subeKodu, StringComparison.OrdinalIgnoreCase))
                return Ok(new { basarili = true });

            return StatusCode(409, new
            {
                hata = $"Yalnızca kendi şubeniz ({(string)kendi.subeAdi ?? (string)kendi.subeKodu}) için fiyat sorgulayabilirsiniz."
            });
        }

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE B360_SUBE_SECIM AS h
USING (SELECT @Kullanici AS kullanici) AS k ON h.kullanici = k.kullanici
WHEN MATCHED THEN UPDATE SET sube_kodu = @subeKodu, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (kullanici, sube_kodu)
     VALUES (@Kullanici, @subeKodu);",
            new { Kullanici, subeKodu = girdi.SubeKodu.Trim() });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Barkodu sorgular.
    ///
    /// Ürün bulunamazsa stok sorgusu hiç çalıştırılmıyor: ikinci sorgu
    /// birincinin stok koduna bağlı ve boşuna bağlantı açmanın anlamı yok.
    /// </summary>
    /// <summary>
    /// Okunan değerden sorgulanacak barkod adaylarını çıkarır (13.10.2026).
    /// İlk aday her zaman değerin kendisi; düz barkodda davranış değişmez.
    /// </summary>
    public static List<string> KarekodAdaylari(string deger)
    {
        var liste = new List<string>();
        void Ekle(string x)
        {
            x = (x ?? "").Trim();
            if (x.Length == 0 || x.Length > 50 || liste.Contains(x)) return;
            liste.Add(x);
            /* GTIN-14 başındaki 0 atılınca EAN-13 olur */
            if (x.Length == 14 && x[0] == '0' && x.All(char.IsDigit)) Ekle(x.Substring(1));
            /* EAN-13 başında 0 varsa UPC-A (12) de denenir */
            if (x.Length == 13 && x[0] == '0' && x.All(char.IsDigit)) Ekle(x.Substring(1));
        }

        var d = (deger ?? "").Trim().Replace("\u001d", "|");
        Ekle(d);

        /* Raf etiketi karekodu (BARKOD: … satırları): yalnızca etiketteki
           barkod denenir; içindeki tarih ve fiyat rakamları barkod sanılmasın */
        if (EtiketKarekodu.Coz(d) is { } etiket)
        {
            if (etiket.Barkod is not null) Ekle(etiket.Barkod);
            return liste;
        }

        /* URL: barkod/barcode/gtin/ean/kod parametresi ya da GS1 Digital Link /01/<gtin> */
        if (Uri.TryCreate(d, UriKind.Absolute, out var uri) && (uri.Scheme == "http" || uri.Scheme == "https"))
        {
            foreach (var parca in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
            {
                var kv = parca.Split('=', 2);
                if (kv.Length != 2) continue;
                var ad = Uri.UnescapeDataString(kv[0]).ToLowerInvariant();
                if (ad is "barkod" or "barcode" or "gtin" or "ean" or "kod" or "code" or "b")
                    Ekle(Uri.UnescapeDataString(kv[1]));
            }
            var yol = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            for (var i = 0; i + 1 < yol.Length; i++)
                if (yol[i] == "01" || yol[i] == "gtin") Ekle(yol[i + 1]);
        }

        /* GS1 eleman dizisi: (01)08690000000000(17)... ya da 0108690000000000... */
        var gs1 = System.Text.RegularExpressions.Regex.Match(d, @"\(01\)(\d{14})");
        if (gs1.Success) Ekle(gs1.Groups[1].Value);
        else
        {
            var duz = System.Text.RegularExpressions.Regex.Match(d, @"^\]?[A-Za-z]?\d?(?:01)(\d{14})");
            if (duz.Success) Ekle(duz.Groups[1].Value);
        }

        /* Son çare: içindeki 8-14 haneli sayılar, uzundan kısaya */
        foreach (var m in System.Text.RegularExpressions.Regex.Matches(d, @"\d{8,14}")
                     .Cast<System.Text.RegularExpressions.Match>()
                     .Select(x => x.Value).OrderByDescending(x => x.Length))
            Ekle(m);

        return liste.Take(8).ToList();
    }

    [HttpGet("Sorgula")]
    public IActionResult Sorgula([FromQuery] string barkod, [FromQuery] int g = 0)
    {
        if (VardiyaEngeli() is { } engel) return engel;

        if (string.IsNullOrWhiteSpace(barkod))
            return BadRequest(new { hata = "Barkod giriniz." });

        var sube = SubeBul();

        if (sube is null)
            return BadRequest(new
            {
                hata = "Sorgulanacak şube belirlenemedi. Şube seçiniz."
            });

        dynamic urun;
        var etiket = EtiketKarekodu.Coz(barkod);

        /* 26.10.2026: karekodda etiket kimliği varsa basıldığı andaki bilgi */
        var etiketKaydi = etiket?.Id is long etiketId ? _etiketKayit.Oku(etiketId) : null;
        string mensei = null;

        try
        {
            using var mikro = _vt.MikroBaglantisi();

            /* Ürün bilgisi ve üç fiyat merkezden okunuyor.

               Şubelerin kendi OzSube veritabanlarına sunucudan
               erişilemiyor. Fiyatlar merkezde STOK_FIYAT_DEGISIKLIKLERI
               içinde depo bazlı tutuluyor: her fiyat numarası için o
               depoya ait en son değişiklik, o şubedeki geçerli fiyat.

               Depoya özel kayıt yoksa depo numarası verilmemiş (genel)
               kayda düşülüyor; şubeye özel fiyat tanımlanmamış ürünlerde
               merkez fiyatı geçerli oluyor. */

            /* 13.10.2026: karekod (QR / DataMatrix) içeriği de kabul ediliyor.
               Okunan değer olduğu gibi denenir; bulunamazsa içinden çıkan
               barkod adayları sırayla denenir (GS1 Digital Link, (01) GTIN,
               barkod=… parametresi, içindeki 8-14 haneli sayı). */
            urun = null;

            /* Etiketteki barkod bulunamazsa (barkod değişmiş) stok koduyla */
            var denemeler = KarekodAdaylari(barkod).Select(x => (aday: x, stokAday: (string)null)).ToList();
            if (etiket?.Stok is { Length: > 0 } etiketStok) denemeler.Add((null, etiketStok));
            if (etiketKaydi?.Barkod is { Length: > 0 } kayitBarkod) denemeler.Add((kayitBarkod, null));
            if (etiketKaydi?.StokKodu is { Length: > 0 } kayitStok) denemeler.Add((null, kayitStok));
            if (etiket?.Id is not null && etiket.Barkod is null && etiket.Stok is null && etiketKaydi is null)
                return NotFound(new { hata = "Bu etiketin kaydı bulunamadı. Ürünün barkodunu okutunuz." });

            foreach (var (aday, stokAday) in denemeler)
            {
            urun = mikro.QueryFirstOrDefault(@"
SELECT TOP 1
    s.sto_kod       AS stokKodu,
    s.sto_isim      AS urunAdi,
    s.sto_birim1_ad AS birim,
    s.sto_yer_kod   AS yerKodu,
    b.bar_kodu      AS barkod,

    /* Liste numaraları STOK_SATIS_FIYAT_LISTE_TANIMLARI'ndan:
         1 → Raf Fiyatı
         2 → Bicard Fiyatı
         3 → Trendyol Fiyatı
       Üçü de KDV dahil tanımlı (sfl_kdvdahil = 1).

       Depoya özel fiyat varsa o, yoksa depo ayrımı olmayan (0) satır
       alınıyor: şubeye özel fiyat tanımlanmamış üründe merkez fiyatı
       geçerli oluyor. */
    (SELECT TOP 1 f.sfiyat_fiyati
       FROM STOK_SATIS_FIYAT_LISTELERI f WITH (NOLOCK)
      WHERE f.sfiyat_stokkod = s.sto_kod AND f.sfiyat_listesirano = 1
        AND f.sfiyat_iptal = 0
        AND (f.sfiyat_deposirano = @depo OR f.sfiyat_deposirano = 0)
      ORDER BY CASE WHEN f.sfiyat_deposirano = @depo THEN 0 ELSE 1 END) AS fiyat1,

    (SELECT TOP 1 f.sfiyat_fiyati
       FROM STOK_SATIS_FIYAT_LISTELERI f WITH (NOLOCK)
      WHERE f.sfiyat_stokkod = s.sto_kod AND f.sfiyat_listesirano = 2
        AND f.sfiyat_iptal = 0
        AND (f.sfiyat_deposirano = @depo OR f.sfiyat_deposirano = 0)
      ORDER BY CASE WHEN f.sfiyat_deposirano = @depo THEN 0 ELSE 1 END) AS fiyat2,

    (SELECT TOP 1 f.sfiyat_fiyati
       FROM STOK_SATIS_FIYAT_LISTELERI f WITH (NOLOCK)
      WHERE f.sfiyat_stokkod = s.sto_kod AND f.sfiyat_listesirano = 3
        AND f.sfiyat_iptal = 0
        AND (f.sfiyat_deposirano = @depo OR f.sfiyat_deposirano = 0)
      ORDER BY CASE WHEN f.sfiyat_deposirano = @depo THEN 0 ELSE 1 END) AS fiyat3,

    /* Son fiyat değişikliği: etiketin ne zamandır geçerli olduğunu
       görmek, eski etiketi ayıklamaya yarıyor. */
    (SELECT TOP 1 d.fid_tarih
       FROM STOK_FIYAT_DEGISIKLIKLERI d WITH (NOLOCK)
      WHERE d.fid_stok_kod = s.sto_kod AND d.fid_iptal = 0
        AND (d.fid_depo_no = @depo OR d.fid_depo_no = 0)
      ORDER BY d.fid_tarih DESC, d.fid_RECno DESC) AS sonFiyatTarihi,

    s.sto_perakende_vergi AS kdv,
    s.sto_pasif_fl        AS pasif,
    s.sto_satis_dursun    AS satisDursun
FROM STOKLAR s WITH (NOLOCK)
    INNER JOIN BARKOD_TANIMLARI b WITH (NOLOCK) ON b.bar_stokkodu = s.sto_kod
WHERE " + (stokAday is null ? "b.bar_kodu = @barkod" : "s.sto_kod = @stok"),
                new { barkod = aday, stok = stokAday, depo = sube.depoNo });
                if (urun is not null) break;
            }

            if (urun is not null) mensei = _etiketKayit.Mensei(mikro, (string)urun.stokKodu);
        }
        catch (Exception hata)
        {
            /* Şube kodu metne çevriliyor: dinamik bir değer günlük
               çağrısını da dinamik dağıtıma sokuyor ve genişletme
               metotları böyle çağrılamıyor. */
            _kayit.LogError(hata, "Ürün sorgusu başarısız: {Sube}",
                (string)sube.subeKodu);

            return StatusCode(500, new
            {
                hata = $"Ürün bilgisi alınamadı. {hata.Message}"
            });
        }

        if (urun is null)
            return NotFound(new { hata = "Bu barkodla ürün bulunamadı." });

        /* Geçerli fiyat (09.10.2026): BiCard fiyatı 0'dan büyükse o, değilse
           raf fiyatı. Ayrı alanlar yeni ekranlar için; g=2 gönderen istemci
           (portal, uygulama 1.7) fiyat1/fiyat2/fiyat3'ü olduğu gibi alıyor.

           Yayındaki uygulama (1.6) büyük kutuda fiyat1'i gösteriyor ve
           kutunun başlığı uygulamaya gömülü. Güncelleme beklemeden doğru
           fiyat görünsün diye ona fiyat1 olarak geçerli fiyat gidiyor; BiCard
           fiyatı uygulanıyorsa raf fiyatı künye satırında (birim alanının
           yanında) yazıyor. */
        var satir = (IDictionary<string, object>)urun;

        static decimal? Ondalik(object d) => d is null or DBNull ? null : Convert.ToDecimal(d);

        var raf = Ondalik(satir["fiyat1"]);
        var bicard = Ondalik(satir["fiyat2"]);
        var etkin = SatisFiyati.Etkin(raf, bicard);
        var tur = SatisFiyati.Tur(raf, bicard);

        satir["rafFiyat"] = raf;
        satir["bicardFiyat"] = bicard;
        satir["trendyolFiyat"] = Ondalik(satir["fiyat3"]);
        satir["satisFiyati"] = etkin;
        satir["fiyatTuru"] = tur;
        satir["fiyatTuruAdi"] = SatisFiyati.TurAdi(tur);

        if (g < 2)
        {
            satir["fiyat1"] = etkin;

            if (tur == "bicard" && raf is not null)
                satir["birim"] = $"{satir["birim"]} · Raf fiyatı {SatisFiyati.Yaz(raf)}";
        }

        decimal stok = 0;

        if (sube.depoNo is int depo)
            try
            {
                using var mikro = _vt.MikroBaglantisi();

                stok = mikro.ExecuteScalar<decimal>(@"
SELECT ISNULL(SUM(
    CASE
        WHEN sth_tip = 0 AND sth_giris_depo_no = @depo THEN  sth_miktar
        WHEN sth_tip = 1 AND sth_cikis_depo_no = @depo THEN -sth_miktar
        WHEN sth_tip = 2 AND sth_giris_depo_no = @depo THEN  sth_miktar
        WHEN sth_tip = 2 AND sth_cikis_depo_no = @depo THEN -sth_miktar
        ELSE 0
    END), 0)
FROM STOK_HAREKETLERI WITH (NOLOCK)
WHERE sth_stok_kod = @stok
  AND sth_cins NOT IN (9, 15)
  AND (sth_giris_depo_no = @depo OR sth_cikis_depo_no = @depo)",
                    new { stok = (string)urun.stokKodu, depo });
            }
            catch (Exception hata)
            {
                /* Stok alınamazsa fiyat yine gösteriliyor: personelin asıl
                   sorduğu fiyat ve etiketi ona göre basıyor. */
                _kayit.LogWarning(hata, "Stok sorgusu başarısız");
            }

        /* Ürün görseli: personel ürünü adından değil görüntüsünden
           tanıyor ve etiketi doğru ürüne takmak bununla kolaylaşıyor. */
        int? gorselId = null;

        try
        {
            using var db = _vt.Baglanti();

            gorselId = db.ExecuteScalar<int?>(@"
SELECT TOP 1 id FROM B360_URUN_GORSEL
WHERE stok_kodu = @stok ORDER BY kapak DESC, id",
                new { stok = (string)urun.stokKodu });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Ürün görseli okunamadı");
        }

        DateTime? sonFiyatTarihi = satir.TryGetValue("sonFiyatTarihi", out var sft) && sft is DateTime sftT ? sftT : null;

        /* 26.10.2026: etiket kaydıyla karşılaştırma ve SKT */
        object etiketDenetimi = null;
        if (etiketKaydi is not null)
        {
            etiketDenetimi = _etiketKayit.Karsilastir(etiketKaydi, (string)urun.urunAdi, raf, bicard, mensei, sonFiyatTarihi, Sicil);
        }
        var skt = _etiketKayit.SktDurumu((string)sube.subeAdi, (string)urun.stokKodu, etiket?.Skt ?? etiketKaydi?.Skt);

        return Ok(new
        {
            sube = new { sube.subeKodu, sube.subeAdi, sube.depoNo },
            urun,
            stok,
            mensei,
            /* 13.10.2026: raf etiketinin karekodu okunduysa etiket denetimi
               (1.8 gösteriyor; eski sürümler alanı yok sayıyor). Etiket
               kaydı varsa eski sürüm de yeni karşılaştırmanın uyarısını
               gösterir. */
            etiket = etiketDenetimi is not null
                ? new
                {
                    fiyat = etiketKaydi.Fiyat,
                    fdt = etiketKaydi.FiyatDegisimTarihi,
                    basim = (DateTime?)etiketKaydi.Basim,
                    guncel = ((dynamic)etiketDenetimi).guncel,
                    uyari = (string)((dynamic)etiketDenetimi).uyari,
                }
                : etiket?.Denetle(raf, etkin, sonFiyatTarihi),
            /* 26.10.2026: etiket kaydı (değişen alanlar, yeni etiket) ve SKT */
            etiketKaydi = etiketDenetimi,
            skt,
            gorselId,
            gorselAdresi = gorselId is null ? null : $"/api/FiyatKontrol/Gorsel/{gorselId}"
        });
    }

    /* ==================================================================== */
    /* İnsert ürünleri (26.10.2026)                                          */
    /* ==================================================================== */

    private static bool _ayrintiSutunu;
    private static DateTime _ayrintiBakis = DateTime.MinValue;

    /// <summary>
    /// ETIKET_GONDERIM'de tur/ayrinti sütunları var mı. Şema değişikliği
    /// istek yolunda yapılmaz (en az yetki): sütunlar etiket-gonderim.sql
    /// ile eklenir. Yoksa 10 dakikada bir yeniden bakılır.
    /// </summary>
    private bool AyrintiSutunu(System.Data.IDbConnection oz)
    {
        if (_ayrintiSutunu || DateTime.UtcNow - _ayrintiBakis < TimeSpan.FromMinutes(10)) return _ayrintiSutunu;
        _ayrintiBakis = DateTime.UtcNow;
        try
        {
            _ayrintiSutunu = oz.ExecuteScalar<int>(
                "SELECT CASE WHEN COL_LENGTH('ETIKET_GONDERIM', 'ayrinti') IS NOT NULL AND COL_LENGTH('ETIKET_GONDERIM', 'tur') IS NOT NULL THEN 1 ELSE 0 END") == 1;
            if (!_ayrintiSutunu)
                _kayit.LogWarning("ETIKET_GONDERIM tur/ayrinti sütunları yok; etiket-gonderim.sql çalıştırılmalı");
        }
        catch { _ayrintiSutunu = false; }
        return _ayrintiSutunu;
    }

    /// <summary>
    /// Şubenin insert kampanya ürünleri. Panel OZ Merkez'deki
    /// PANEL_INSERT_URUNLERI tablosuna yazar (15 dakikada bir); burası
    /// yalnız okur, mağazanın depo numarasıyla. NOLOCK yok: panel silip
    /// yeniden ekliyor, yarım tablo okunmasın.
    /// </summary>
    [HttpGet("Insert")]
    public IActionResult Insert()
    {
        if (VardiyaEngeli() is { } engel) return engel;

        var sube = SubeBul();
        if (sube is null) return BadRequest(new { hata = "Şube belirlenemedi. Şube seçiniz." });
        if (sube.depoNo is not int depo)
            return BadRequest(new { hata = $"{(string)sube.subeAdi} şubesinin depo numarası tanımlı değil." });

        List<dynamic> satirlar;

        /* 26.10.2026: Biçen Panel bağlantısı tanımlıysa kampanyalar
           doğrudan panelden (yalnız okuma); değilse OZ Merkez tablosu */
        if (_panelKampanya.Tanimli)
        {
            try
            {
                satirlar = _panelKampanya.Oku(depo).Select(x => (dynamic)new
                {
                    kampanyaNo = x.KampanyaNo, kampanyaAdi = x.KampanyaAdi, kampanyaTuru = x.KampanyaTuru,
                    baslangic = x.Baslangic, bitis = x.Bitis, durum = x.Durum, kare = x.Kare, grupAdi = x.GrupAdi,
                    stokKod = x.StokKod, urunAdi = x.UrunAdi, barkod = x.Barkod, rafFiyati = x.RafFiyati,
                    insertFiyati = x.InsertFiyati, indirimYuzde = x.IndirimYuzde, guncelleme = x.Guncelleme,
                }).ToList();
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Kampanyalar Biçen Panel'den okunamadı");
                return StatusCode(500, new { hata = "Kampanyalar okunamadı (Biçen Panel bağlantısı)." });
            }
        }
        else
        try
        {
            using var oz = _vt.OzMerkezBaglantisi();

            /* Tablo adı ayardan (Kampanya:Tablo); panel başka veritabanına
               yazıyorsa "OzMerkez.dbo.PANEL_INSERT_URUNLERI" verilebilir.
               OBJECT_ID, okuma izni olmayan kullanıcıya da NULL döndüğü için
               "tablo yok" ile "izin yok" ayrılamıyor; ikisi birlikte söylenir. */
            var tablo = (_yapilandirma["Kampanya:Tablo"] ?? "").Trim();
            if (tablo.Length == 0 || !System.Text.RegularExpressions.Regex.IsMatch(tablo, @"^[A-Za-z0-9_\.\[\]]{3,128}$"))
                tablo = "dbo.PANEL_INSERT_URUNLERI";

            if (oz.ExecuteScalar<int>("SELECT CASE WHEN OBJECT_ID(@tablo) IS NULL THEN 0 ELSE 1 END", new { tablo }) == 0)
            {
                var vtAdi = oz.ExecuteScalar<string>("SELECT DB_NAME()");
                _kayit.LogWarning("Kampanya tablosu okunamıyor: {Tablo} ({Vt})", tablo, vtAdi);
                return Ok(new
                {
                    hazir = false,
                    sube = new { sube.subeKodu, sube.subeAdi, sube.depoNo },
                    mesaj = "Kampanya listesi şu an alınamıyor. Bilgi İşlem'e bildiriniz.",
                    kampanyalar = Array.Empty<object>(),
                });
            }

            satirlar = oz.Query($@"
SELECT kampanya_no AS kampanyaNo, kampanya_adi AS kampanyaAdi, kampanya_turu AS kampanyaTuru,
       baslangic, bitis, durum, kare, grup_adi AS grupAdi, stok_kod AS stokKod, urun_adi AS urunAdi,
       barkod, raf_fiyati AS rafFiyati, insert_fiyati AS insertFiyati, indirim_yuzde AS indirimYuzde, guncelleme
FROM {tablo}
WHERE depo = @depo
ORDER BY baslangic, kampanya_no, kare, grup_adi, urun_adi", new { depo }, commandTimeout: 30).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "İnsert ürünleri okunamadı");
            return StatusCode(500, new { hata = "Kampanyalar okunamadı. Bilgi İşlem'e bildiriniz." });
        }

        static string Tur(string t)
        {
            var bilinen = new[] { "Normal İnsert", "Mağaza Özel İnsert", "İndirim Broşürü", "Mağaza İçi Aktivite", "Pazar Delisi", "Haftanın Ürünü", "Tamamla Kazan", "Diğer" };
            return bilinen.Contains((t ?? "").Trim()) ? t.Trim() : "Diğer";
        }

        var kampanyalar = satirlar
            .GroupBy(x => (int)x.kampanyaNo)
            .Select(g =>
            {
                var f = g.First();
                return new
                {
                    kampanyaNo = g.Key,
                    kampanyaAdi = (string)f.kampanyaAdi,
                    kampanyaTuru = Tur((string)f.kampanyaTuru),
                    baslangic = (DateTime?)f.baslangic,
                    bitis = (DateTime?)f.bitis,
                    durum = (string)f.durum,
                    guncelleme = g.Max(x => (DateTime?)x.guncelleme),
                    urunler = g.Select(x =>
                    {
                        decimal? raf = x.rafFiyati, ins = x.insertFiyati;
                        return new
                        {
                            kare = (int?)x.kare,
                            grupAdi = (string)x.grupAdi,
                            stokKod = ((string)x.stokKod ?? "").Trim(),
                            urunAdi = (string)x.urunAdi,
                            barkod = ((string)x.barkod ?? "").Trim(),
                            rafFiyati = raf,
                            insertFiyati = ins,
                            indirimYuzde = (int?)x.indirimYuzde,
                            /* Panelde de hata: raf boş ya da insert ≥ raf */
                            sorunlu = raf is null || ins is null || ins >= raf,
                        };
                    }).ToList(),
                };
            })
            .OrderBy(x => x.durum == "Sürüyor" ? 0 : x.durum == "Planlı" ? 1 : 2)
            .ThenBy(x => x.baslangic)
            .ToList();

        return Ok(new
        {
            hazir = true,
            sube = new { sube.subeKodu, sube.subeAdi, sube.depoNo },
            kampanyalar,
        });
    }

    /// <summary>
    /// Etiket listesini şubeye mail olarak gönderir.
    ///
    /// Barkodlar alt alta gönderiliyor: şube bu listeyi olduğu gibi
    /// etiket programına yapıştırıyor ve araya açıklama girmek listeyi
    /// kullanılamaz hâle getiriyordu.
    /// </summary>
    [HttpPost("ListeGonder")]
    public async Task<IActionResult> ListeGonder([FromBody] EtiketListesiGirdi girdi)
    {
        if (VardiyaEngeli() is { } engel) return engel;

        /* Adres zorunlu değil.

           Liste artık OZ Merkez'e kaydediliyor ve şube etiket
           programındaki "Mobilden" düğmesinden alıyor. Mail ikinci yol;
           adres tanımlı değilse gönderim reddedilmemeli — personelin
           okuttuğu barkodlar yüzüne kapanıyordu. */
        /* İnsert ürünleri (26.10.2026): satırlar ayrıntılı gelir; barkod
           listesi eski etiket programı için yine yazılır (adet kadar) */
        var urunler = (girdi?.Urunler ?? new List<EtiketSatiri>())
            .Where(x => !string.IsNullOrWhiteSpace(x?.Barkod) || !string.IsNullOrWhiteSpace(x?.StokKod))
            .ToList();
        if (urunler.Count > 0 && girdi is not null)
            girdi.Barkodlar = urunler.SelectMany(x => Enumerable.Repeat(
                (string.IsNullOrWhiteSpace(x.Barkod) ? x.StokKod : x.Barkod).Trim(), Math.Clamp(x.Adet, 1, 99))).ToList();

        var barkodlar = (girdi?.Barkodlar ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Select(x => x.Trim())
            .ToList();

        if (barkodlar.Count == 0)
            return BadRequest(new { hata = "Listede ürün yok." });

        var duz = string.Join("\n", barkodlar);

        /* Gönderim önce kaydediliyor, mail sonra.

           Liste eskiden yalnızca mail olarak gidiyordu ve mail düşünce
           personelin okuttuğu bütün barkodlar kayboluyordu. Kayıt OZ
           Merkez veritabanına yazılıyor; şubedeki etiket programı zaten
           oraya bağlı ve listeyi "Mobilden" düğmesiyle doğrudan okuyor. */
        var subeKodu = (girdi.SubeKodu ?? "").Trim();

        /* Şube personelinin listesi her zaman kendi şubesine gider */
        if (KendiSubesi() is { } kendiSube)
            subeKodu = (string)kendiSube.subeKodu;

        if (subeKodu.Length == 0)
            subeKodu = (string)(SubeBul()?.subeKodu ?? "");

        /* Depo numarası şubeyi masaüstü tarafta bulan tek alan: etiket
           programı kendi şubesini depo numarasıyla tanıyor, şube adıyla
           değil. */
        int? depoNo = null;
        var subeAdi = subeKodu;

        try
        {
            using var db = _vt.Baglanti();

            var sb = db.QueryFirstOrDefault(
                "SELECT depo_no AS depoNo, sube_adi AS subeAdi "
                + "FROM B360_SUBE_DEPO WHERE sube_kodu = @subeKodu",
                new { subeKodu });

            if (sb is not null)
            {
                depoNo = (int?)sb.depoNo;
                subeAdi = (string)sb.subeAdi ?? subeKodu;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şube depo numarası okunamadı");
        }

        if (depoNo is null)
            return BadRequest(new
            {
                hata = $"{subeAdi} şubesinin depo numarası tanımlı değil. "
                     + "Portaldan Şube ve Depo ekranından tanımlanmalı."
            });

        /* Gönderen adı listede görünüyor: şube "bu listeyi kim yolladı"
           diye aramak zorunda kalmasın. */
        var gonderenAdi = Sicil;

        try
        {
            var kisi = _personel.Getir(Sicil);

            /* Kayıt tek alanda: Bilgi kaydında ad ve soyad ayrı tutulmuyor. */
            if (!string.IsNullOrWhiteSpace(kisi?.AdSoyad))
                gonderenAdi = kisi.AdSoyad.Trim();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Gönderen adı okunamadı");
        }

        var rfKodu = "";

        try
        {
            using var oz = _vt.OzMerkezBaglantisi();

            /* 26.10.2026: tur ve ayrinti sütunları (insert etiketleri);
               sütunlar yoksa eklenir, eklenemezse eski biçimde yazılır */
            var ayrintiVar = AyrintiSutunu(oz);
            var ayrinti = urunler.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(urunler.Select(x => new
            {
                barkod = x.Barkod, stok_kod = x.StokKod, urun_adi = x.UrunAdi,
                raf_fiyati = x.RafFiyati, insert_fiyati = x.InsertFiyati, indirim_yuzde = x.IndirimYuzde,
                baslangic = x.Baslangic?.ToString("yyyy-MM-dd"), bitis = x.Bitis?.ToString("yyyy-MM-dd"),
                kampanya_no = x.KampanyaNo, kampanya_adi = x.KampanyaAdi, kampanya_turu = x.KampanyaTuru,
                grup_adi = x.GrupAdi, kare = x.Kare, adet = Math.Clamp(x.Adet, 1, 99),
            }));
            var tur = string.IsNullOrWhiteSpace(girdi.Tur) ? null : Kirp(girdi.Tur.Trim(), 20);

            var id = oz.ExecuteScalar<int>(ayrintiVar ? @"
INSERT INTO ETIKET_GONDERIM
    (rf_kodu, depo_no, sube_adi, gonderen_kodu, gonderen_adi,
     aciklama, adet, barkodlar, tur, ayrinti)
OUTPUT INSERTED.id
VALUES ('', @depoNo, @subeAdi, @kod, @ad, @aciklama, @adet, @barkodlar, @tur, @ayrinti)" : @"
INSERT INTO ETIKET_GONDERIM
    (rf_kodu, depo_no, sube_adi, gonderen_kodu, gonderen_adi,
     aciklama, adet, barkodlar)
OUTPUT INSERTED.id
VALUES ('', @depoNo, @subeAdi, @kod, @ad, @aciklama, @adet, @barkodlar)",
                new
                {
                    depoNo,

                    /* Sütun genişliklerine kırpılıyor: taşan tek bir değer
                       bütün kaydı düşürüyor ve personel listesini
                       kaybediyordu. */
                    subeAdi = Kirp(subeAdi, 120),
                    kod = Kirp(Sicil, 30),
                    ad = Kirp(gonderenAdi, 200),
                    aciklama = Kirp(girdi.Not, 400),
                    adet = barkodlar.Count,
                    barkodlar = duz,
                    tur,
                    ayrinti,
                }, commandTimeout: 30);

            /* Kod kayıttan sonra üretiliyor: sıra numarası kimliğin
               kendisi, ayrı bir sayaç tutmak iki kaynağı ayrı düşürürdü. */
            rfKodu = $"RF-{DateTime.Now:yyMMdd}-{id:D4}";

            oz.Execute("UPDATE ETIKET_GONDERIM SET rf_kodu = @rf WHERE id = @id",
                new { rf = rfKodu, id });

            /* Gönderilen liste taslaktan çıkıyor (insert gönderimi taslağı
               etkilemez: okutulan liste ayrı) */
            if (urunler.Count == 0)
            try
            {
                using var db = _vt.Baglanti();
                db.Execute("DELETE FROM B360_ETIKET_TASLAK WHERE kullanici = @k", new { k = Kirp(Sicil, 60) });
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Etiket taslağı silinemedi");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Etiket gönderimi OZ Merkez'e yazılamadı");

            return StatusCode(500, new
            {
                hata = "Liste kaydedilemedi. " + MailServisi.HataMetni(hata)
            });
        }

        var govde =
            $"<p>Aşağıdaki ürünlerin raf etiketleri güncellenecektir.</p>" +
            (string.IsNullOrWhiteSpace(rfKodu)
                ? ""
                : $"<p><b>Liste kodu:</b> {rfKodu} · <b>Gönderen:</b> "
                  + $"{System.Net.WebUtility.HtmlEncode(gonderenAdi)}<br>"
                  + "<span style=\"color:#6b7280;font-size:12px\">Bu listeyi etiket "
                  + "programındaki <b>Mobilden</b> düğmesinden de açabilirsiniz; "
                  + "dosyayı kaydetmeniz gerekmez.</span></p>") +
            (string.IsNullOrWhiteSpace(girdi.Not)
                ? ""
                : $"<p><b>Not:</b> {System.Net.WebUtility.HtmlEncode(girdi.Not)}</p>") +
            $"<p><b>{barkodlar.Count} ürün</b></p>" +
            $"<pre style=\"font-family:monospace;font-size:13px\">{System.Net.WebUtility.HtmlEncode(duz)}</pre>";

        var adres = (girdi.Adres ?? "").Trim();

        if (adres.Length == 0)
            return Ok(new
            {
                basarili = true,
                adet = barkodlar.Count,
                rfKodu,
                mailGitti = false,
                uyari = $"Liste {subeAdi} şubesine iletildi. Şubenin e-posta "
                      + "adresi tanımlı olmadığı için mail gönderilmedi; "
                      + "liste etiket programındaki Mobilden düğmesinden "
                      + "açılabilir.",
            });

        try
        {
            await _mail.Gonder(
                adres,
                $"Etiket listesi · {barkodlar.Count} ürün",
                govde);

            return Ok(new { basarili = true, adet = barkodlar.Count, rfKodu });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Etiket listesi gönderilemedi");

            /* Liste kaydı durduğu için gönderim kaybolmuyor: şube listeyi
               "Mobilden" düğmesinden yine alabiliyor. */
            return Ok(new
            {
                basarili = true,
                adet = barkodlar.Count,
                rfKodu,
                mailGitti = false,
                /* Sebep açılarak veriliyor: SMTP hatalarında dış mesaj hep
                   aynı ve telefonda "gönderilemedi" demek, sorunu arayan
                   kişiye hiçbir şey söylemiyordu. */
                uyari = "Liste şubeye iletildi ancak mail gönderilemedi: "
                      + MailServisi.HataMetni(hata)
                      + $" Şube, etiket programındaki Mobilden düğmesinden "
                      + $"{rfKodu} kodlu listeyi açabilir.",
            });
        }
    }

    /* ====================================================================== */
    /* Etiket listesi taslağı ve son listeler (11.10.2026)                   */
    /* ====================================================================== */

    /// <summary>Kişinin henüz göndermediği etiket listesi.</summary>
    [HttpGet("Taslak")]
    public IActionResult Taslak()
    {
        using var db = _vt.Baglanti();

        var icerik = db.ExecuteScalar<string>(
            "SELECT icerik FROM B360_ETIKET_TASLAK WHERE kullanici = @k", new { k = Kirp(Sicil, 60) });

        List<EtiketKalemi> kalemler;

        try
        {
            kalemler = string.IsNullOrWhiteSpace(icerik)
                ? new List<EtiketKalemi>()
                : System.Text.Json.JsonSerializer.Deserialize<List<EtiketKalemi>>(icerik) ?? new List<EtiketKalemi>();
        }
        catch (System.Text.Json.JsonException)
        {
            kalemler = new List<EtiketKalemi>();
        }

        return Ok(new { kalemler });
    }

    /// <summary>Taslağı olduğu gibi yazar; boş liste taslağı siler.</summary>
    [HttpPut("Taslak")]
    public IActionResult TaslakYaz([FromBody] EtiketTaslakGirdi girdi)
    {
        var kalemler = (girdi?.Kalemler ?? new List<EtiketKalemi>())
            .Where(x => !string.IsNullOrWhiteSpace(x?.Barkod))
            .Take(500)
            .Select(x => new EtiketKalemi
            {
                Barkod = Kirp(x.Barkod, 40),
                UrunAdi = Kirp(x.UrunAdi, 200),
                Adet = Math.Clamp(x.Adet, 1, 99),
                Fiyat = x.Fiyat,
            })
            .ToList();

        using var db = _vt.Baglanti();
        var k = Kirp(Sicil, 60);

        if (kalemler.Count == 0)
        {
            db.Execute("DELETE FROM B360_ETIKET_TASLAK WHERE kullanici = @k", new { k });
            return Ok(new { adet = 0 });
        }

        var icerik = System.Text.Json.JsonSerializer.Serialize(kalemler);

        db.Execute(@"
MERGE B360_ETIKET_TASLAK AS h
USING (SELECT @k AS kullanici) AS y ON h.kullanici = y.kullanici
WHEN MATCHED THEN UPDATE SET icerik = @icerik, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (kullanici, icerik) VALUES (@k, @icerik);", new { k, icerik });

        return Ok(new { adet = kalemler.Count });
    }

    /// <summary>
    /// Kişinin son gönderdiği 10 etiket listesi: kod, şube, şubenin alıp
    /// almadığı ve barkodlar (ürün adlarıyla, adet birleştirilmiş). Uygulama
    /// bir listeyi yeniden etiket listesine alabiliyor.
    /// </summary>
    [HttpGet("SonListeler")]
    public IActionResult SonListeler()
    {
        List<dynamic> listeler;

        try
        {
            using var oz = _vt.OzMerkezBaglantisi();

            listeler = oz.Query(@"
SELECT TOP 10 id, rf_kodu AS rfKodu, sube_adi AS subeAdi, adet, aciklama,
       barkodlar, alindi, olusturma
FROM ETIKET_GONDERIM
WHERE gonderen_kodu = @kod
ORDER BY id DESC", new { kod = Kirp(Sicil, 30) }).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Son etiket listeleri okunamadı");
            return Ok(new { listeler = new List<object>() });
        }

        var satirlar = listeler.Select(x => new
        {
            Liste = x,
            Barkodlar = ((string)x.barkodlar ?? "")
                .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .ToList()
        }).ToList();

        /* Ürün adları tek sorguda */
        var adlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var tumu = satirlar.SelectMany(x => x.Barkodlar).Distinct().Take(2000).ToList();

        if (tumu.Count > 0)
            try
            {
                using var mikro = _vt.MikroBaglantisi();

                foreach (var parca in tumu.Chunk(800))
                    foreach (var r in mikro.Query(@"
SELECT B.bar_kodu AS barkod, S.sto_isim AS ad
FROM BARKOD_TANIMLARI B WITH (NOLOCK)
    INNER JOIN STOKLAR S WITH (NOLOCK) ON S.sto_kod = B.bar_stokkodu
WHERE B.bar_kodu IN @parca", new { parca }))
                        adlar[(string)r.barkod] = (string)r.ad;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Etiket listesi ürün adları okunamadı");
            }

        return Ok(new
        {
            listeler = satirlar.Select(x => new
            {
                id = (int)x.Liste.id,
                rfKodu = (string)x.Liste.rfKodu,
                subeAdi = (string)x.Liste.subeAdi,
                adet = (int)x.Liste.adet,
                aciklama = (string)x.Liste.aciklama,
                alindi = (bool)x.Liste.alindi,
                olusturma = (DateTime)x.Liste.olusturma,
                kalemler = x.Barkodlar
                    .GroupBy(b => b)
                    .Select(g => new
                    {
                        barkod = g.Key,
                        urunAdi = adlar.TryGetValue(g.Key, out var ad) ? ad : null,
                        adet = g.Count()
                    })
                    .ToList()
            })
        });
    }

    /* ====================================================================== */
    /* Ürün görselleri                                                       */
    /* ====================================================================== */

    /// <summary>Görseli döndürür.</summary>
    [HttpGet("Gorsel/{gorselId:int}")]
    [AllowAnonymous]
    public IActionResult Gorsel(int gorselId)
    {
        using var db = _vt.Baglanti();

        var dosyaAdi = db.ExecuteScalar<string>(
            "SELECT dosya FROM B360_URUN_GORSEL WHERE id = @gorselId",
            new { gorselId });

        if (string.IsNullOrWhiteSpace(dosyaAdi)) return NotFound();

        if (dosyaAdi.Contains('/') || dosyaAdi.Contains('\\') || dosyaAdi.Contains(".."))
            return BadRequest();

        var yol = Path.Combine(Klasor(), dosyaAdi);

        if (!System.IO.File.Exists(yol)) return NotFound();

        var tur = Path.GetExtension(dosyaAdi).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "image/jpeg"
        };

        return PhysicalFile(yol, tur);
    }

    /// <summary>
    /// Ürüne görsel yükler.
    ///
    /// Stok koduna bağlanıyor, barkoda değil: aynı ürünün birden çok
    /// barkodu olabiliyor ve her barkod için ayrı fotoğraf yüklemek
    /// gereksiz tekrar demekti.
    /// </summary>
    [HttpPost("Gorsel")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> GorselYukle([FromForm] string stokKodu, IFormFile dosya)
    {
        if (dosya is null && Request.HasFormContentType)
            dosya = Request.Form.Files.FirstOrDefault();

        if (string.IsNullOrWhiteSpace(stokKodu))
            return BadRequest(new { hata = "Stok kodu belirtilmedi." });

        if (dosya is null || dosya.Length == 0)
            return BadRequest(new { hata = "Görsel seçilmedi." });

        var sonuc = await GorselYaz(stokKodu.Trim(), dosya);

        return sonuc.basarili
            ? Ok(new { id = sonuc.id, adres = $"/api/FiyatKontrol/Gorsel/{sonuc.id}" })
            : StatusCode(500, new { hata = sonuc.hata });
    }

    /// <summary>
    /// Toplu görsel yükleme.
    ///
    /// <para>
    /// Dosya adı ürünü belirliyor: <c>8691415451.jpg</c> gibi bir barkod
    /// ya da doğrudan stok kodu. Binlerce ürünün fotoğrafını tek tek
    /// eşleştirmek günler sürerdi; klasörü olduğu gibi göndermek
    /// yeterli oluyor.
    /// </para>
    ///
    /// <para>
    /// Eşleşmeyen dosyalar atlanıyor ve adlarıyla birlikte bildiriliyor;
    /// sessizce yutmak, hangi ürünlerin eksik kaldığını
    /// bulunamaz hâle getiriyordu.
    /// </para>
    /// </summary>
    [HttpPost("GorselToplu")]
    [RequestSizeLimit(524_288_000)]
    public async Task<IActionResult> GorselToplu()
    {
        if (!Request.HasFormContentType)
            return BadRequest(new { hata = "Dosya gönderilmedi." });

        var eklenen = 0;
        var atlanan = new List<string>();

        foreach (var dosya in Request.Form.Files)
        {
            if (dosya.Length == 0) continue;

            var ad = Path.GetFileNameWithoutExtension(dosya.FileName ?? "").Trim();

            if (ad.Length == 0)
            {
                atlanan.Add(dosya.FileName ?? "adsız");
                continue;
            }

            var stok = StokKoduBul(ad);

            if (stok is null)
            {
                atlanan.Add($"{dosya.FileName} (ürün bulunamadı)");
                continue;
            }

            var sonuc = await GorselYaz(stok, dosya);

            if (sonuc.basarili) eklenen++;
            else atlanan.Add($"{dosya.FileName} ({sonuc.hata})");
        }

        return Ok(new { eklenen, atlanan, toplam = Request.Form.Files.Count });
    }

    /// <summary>Bir ürünün görselleri.</summary>
    [HttpGet("Gorseller")]
    public IActionResult Gorseller([FromQuery] string stokKodu)
    {
        if (string.IsNullOrWhiteSpace(stokKodu))
            return BadRequest(new { hata = "Stok kodu belirtilmedi." });

        using var db = _vt.Baglanti();

        var gorseller = db.Query(@"
SELECT id, ozgun_ad AS ozgunAd, kapak, olusturma
FROM B360_URUN_GORSEL WHERE stok_kodu = @stokKodu
ORDER BY kapak DESC, id", new { stokKodu = stokKodu.Trim() }).ToList();

        return Ok(new { gorseller });
    }

    /// <summary>
    /// Yüklenmiş ürün görsellerinin dökümü.
    ///
    /// Ürün adı Mikro'dan ekleniyor: yalnızca stok koduyla listelemek,
    /// hangi ürüne ait olduğunu anlamayı imkânsız kılıyordu.
    /// </summary>
    [HttpGet("GorselDokum")]
    public IActionResult GorselDokum([FromQuery] string ara = null)
    {
        using var db = _vt.Baglanti();

        var kalip = string.IsNullOrWhiteSpace(ara) ? null : $"%{ara.Trim()}%";

        var kayitlar = db.Query(@"
SELECT g.id, g.stok_kodu AS stokKodu, g.ozgun_ad AS ozgunAd, g.kapak,
       g.yukleyen, g.olusturma
FROM B360_URUN_GORSEL g
WHERE (@kalip IS NULL OR g.stok_kodu LIKE @kalip OR g.ozgun_ad LIKE @kalip)
ORDER BY g.olusturma DESC", new { kalip }).ToList();

        /* Ürün adları tek sorguda: görsel başına Mikro'ya gitmek, iki yüz
           görselde iki yüz sorgu demekti. */
        var adlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var kodlar = kayitlar
            .Select(x => (string)x.stokKodu)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .ToList();

        if (kodlar.Count > 0)
            try
            {
                using var mikro = _vt.MikroBaglantisi();

                foreach (var u in mikro.Query(@"
SELECT sto_kod AS kod, sto_isim AS ad FROM STOKLAR WITH (NOLOCK)
WHERE sto_kod IN @kodlar", new { kodlar }))
                    adlar[(string)u.kod] = (string)u.ad;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Ürün adları okunamadı");
            }

        var sonuc = kayitlar.Select(x => new
        {
            id = (int)x.id,
            stokKodu = (string)x.stokKodu,
            urunAdi = adlar.TryGetValue((string)x.stokKodu ?? "", out var ad) ? ad : null,
            ozgunAd = (string)x.ozgunAd,
            kapak = (bool)x.kapak,
            yukleyen = (string)x.yukleyen,
            olusturma = (DateTime)x.olusturma
        });

        return Ok(new { kayitlar = sonuc, toplam = kayitlar.Count });
    }

    [HttpDelete("Gorsel/{gorselId:int}")]
    public IActionResult GorselSil(int gorselId)
    {
        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(
            "DELETE FROM B360_URUN_GORSEL WHERE id = @gorselId", new { gorselId });

        if (etkilenen == 0) return NotFound(new { hata = "Görsel bulunamadı." });

        return Ok(new { basarili = true });
    }

    /* ====================================================================== */

    /// <summary>Barkod ya da stok kodundan stok kodunu bulur.</summary>
    private string StokKoduBul(string deger)
    {
        try
        {
            using var mikro = _vt.MikroBaglantisi();

            /* Önce stok kodu olarak deneniyor: dosya adları çoğunlukla
               stok koduyla veriliyor ve barkod araması gereksiz bir
               birleştirme yapıyordu. */
            var stok = mikro.ExecuteScalar<string>(
                "SELECT TOP 1 sto_kod FROM STOKLAR WITH (NOLOCK) WHERE sto_kod = @deger",
                new { deger });

            if (!string.IsNullOrWhiteSpace(stok)) return stok;

            return mikro.ExecuteScalar<string>(@"
SELECT TOP 1 bar_stokkodu FROM BARKOD_TANIMLARI WITH (NOLOCK)
WHERE bar_kodu = @deger", new { deger });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Stok kodu aranamadı: {Deger}", deger);
            return null;
        }
    }

    /// <summary>Dosyayı diske ve künyeyi tabloya yazar.</summary>
    private async Task<(bool basarili, int id, string hata)> GorselYaz(
        string stokKodu, IFormFile dosya)
    {
        var uzanti = Path.GetExtension(dosya.FileName ?? "").ToLowerInvariant();

        if (uzanti is not (".jpg" or ".jpeg" or ".png" or ".webp"))
            return (false, 0, "desteklenmeyen dosya türü");

        var diskAdi = $"urun_{Guid.NewGuid():N}{uzanti}";
        var klasor = Klasor();

        try
        {
            if (!Directory.Exists(klasor)) Directory.CreateDirectory(klasor);

            await using var akis = new FileStream(
                Path.Combine(klasor, diskAdi), FileMode.Create);

            await dosya.CopyToAsync(akis);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Ürün görseli yazılamadı");
            return (false, 0, hata.Message);
        }

        using var db = _vt.Baglanti();

        /* İlk görsel kapak: kapağı olmayan ürün sorgu ekranında boş
           kutuyla görünüyordu. */
        var ilkMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM B360_URUN_GORSEL WHERE stok_kodu = @stokKodu",
            new { stokKodu }) == 0;

        var id = db.ExecuteScalar<int>(@"
INSERT INTO B360_URUN_GORSEL (stok_kodu, dosya, ozgun_ad, kapak, yukleyen)
OUTPUT INSERTED.id VALUES (@stokKodu, @diskAdi, @ozgunAd, @ilkMi, @Kullanici)",
            new { stokKodu, diskAdi, ozgunAd = dosya.FileName, ilkMi, Kullanici });

        return (true, id, null);
    }

    /// <summary>Ürün görsellerinin klasörü; portal görselleriyle aynı kök.</summary>
    private string Klasor()
    {
        var ayar = _yapilandirma["Portal:GorselKlasor"];

        var kok = string.IsNullOrWhiteSpace(ayar)
            ? Path.Combine(AppContext.BaseDirectory, "portal-gorsel")
            : ayar.Trim();

        return Path.Combine(kok, "urun");
    }

    /// <summary>Kilitliyse kendi şubesi; değilse seçili ya da personel kaydındaki şube.</summary>
    private dynamic SubeBul()
    {
        if (KendiSubesi() is { } kendi) return kendi;

        using var db = _vt.Baglanti();

        var kod = db.ExecuteScalar<string>(
            "SELECT sube_kodu FROM B360_SUBE_SECIM WHERE kullanici = @Kullanici",
            new { Kullanici });

        if (!string.IsNullOrWhiteSpace(kod))
        {
            var secili = db.QueryFirstOrDefault(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo, baglanti, eposta
FROM B360_SUBE_DEPO WHERE sube_kodu = @kod AND aktif = 1", new { kod });

            if (secili is not null) return secili;
        }

        /* Seçim yoksa personel kaydındaki şube. Eskiden burada jetondaki
           tam ad ("personel:…|cihaz") aranıyordu ve mobilde hiç bulunmuyordu. */
        return PersonelSubesi(Sicil);
    }

    /// <summary>
    /// Kişinin kilitli olduğu şube; yoksa null.
    /// Panel kullanıcısında hesabın şube modu, mobil personelde iş grubu.
    /// </summary>
    private dynamic KendiSubesi()
    {
        if (_kendiOkundu) return _kendi;

        _kendiOkundu = true;

        if (Mobil)
        {
            /* "Fiyat Kontrol · yönetici" yetkisi (Biçen360 → Yetkiler) şube
               sınırını kaldırıyor: bölge müdürü gibi şubeleri gezen kişi
               iş grubu bir şube olsa da bütün şubeleri seçebiliyor. */
            try
            {
                var kisi = _personel.Getir(Sicil);

                if (_yetki.Modulleri(Sicil, kisi?.Pozisyon ?? "").Contains("fiyatkontrol-yonetici"))
                    return null;
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Fiyat Kontrol yönetici yetkisi okunamadı");
            }

            _kendi = PersonelSubesi(Sicil);
            return _kendi;
        }

        var kilit = _panelKullanici.Getir(Kullanici);

        if (!kilit.SubeKilitli) return null;

        using var db = _vt.Baglanti();

        _kendi = db.QueryFirstOrDefault(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo, baglanti, eposta
FROM B360_SUBE_DEPO WHERE sube_kodu = @kod", new { kod = kilit.SubeKodu });

        return _kendi;
    }

    private bool _kendiOkundu;
    private dynamic _kendi;

    /// <summary>
    /// Personelin iş grubundan aktif şube kaydı. Önce şube kodu ya da adıyla
    /// birebir (Türkçe harf ve boşluk farkı gözetmeden), olmazsa tek bir
    /// şube adını içeriyorsa o. Merkez birimleri eşleştirilmiyor; eşleşme
    /// yoksa null (kişi şube seçebilir).
    /// </summary>
    private dynamic PersonelSubesi(string sicil)
    {
        string birim;

        try
        {
            birim = _personel.Getir(sicil)?.Sube;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel şubesi okunamadı: {Sicil}", sicil);
            return null;
        }

        var a = YetkiServisi.Anahtar(birim);

        /* Genel merkez personeli bütün şubeleri sorgulayabiliyor */
        if (a.Length < 3 || a.Contains("merkez") || a.Contains("belirtilmemis")) return null;

        using var db = _vt.Baglanti();

        var subeler = db.Query(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, depo_no AS depoNo, baglanti, eposta
FROM B360_SUBE_DEPO WHERE aktif = 1").ToList();

        var tam = subeler.FirstOrDefault(x =>
            YetkiServisi.Anahtar((string)x.subeKodu) == a || YetkiServisi.Anahtar((string)x.subeAdi) == a);

        if (tam is not null) return tam;

        var icerik = subeler.Where(x =>
        {
            foreach (var k in new[] { YetkiServisi.Anahtar((string)x.subeKodu), YetkiServisi.Anahtar((string)x.subeAdi) })
                if (k.Length >= 4 && (a.Contains(k) || k.Contains(a)))
                    return true;

            return false;
        }).ToList();

        if (icerik.Count == 1) return icerik[0];

        _kayit.LogInformation("Fiyat Kontrol: {Sicil} personelinin birimi ({Birim}) bir şubeyle eşleşmedi; şube seçimi açık.",
            sicil, birim);

        return null;
    }

}

/* ========================================================================== */

public class SubeSecimGirdi
{
    public string SubeKodu { get; set; }
}

public class EtiketKalemi
{
    public string Barkod { get; set; }
    public string UrunAdi { get; set; }
    public int Adet { get; set; } = 1;
    public decimal? Fiyat { get; set; }
}

public class EtiketTaslakGirdi
{
    public List<EtiketKalemi> Kalemler { get; set; } = new();
}

public class EtiketListesiGirdi
{
    public string Adres { get; set; }
    public string SubeKodu { get; set; }
    public string Not { get; set; }
    public List<string> Barkodlar { get; set; } = new();

    /// <summary>"insert": İnsert ürünleri ekranından (26.10.2026)</summary>
    public string Tur { get; set; }

    /// <summary>Etiket ayrıntısı (insert fiyatı, çizili fiyat, tarihler); ETIKET_GONDERIM.ayrinti'ye JSON</summary>
    public List<EtiketSatiri> Urunler { get; set; }
}

public class EtiketSatiri
{
    public string Barkod { get; set; }
    public string StokKod { get; set; }
    public string UrunAdi { get; set; }
    public decimal? RafFiyati { get; set; }
    public decimal? InsertFiyati { get; set; }
    public int? IndirimYuzde { get; set; }
    public DateTime? Baslangic { get; set; }
    public DateTime? Bitis { get; set; }
    public int? KampanyaNo { get; set; }
    public string KampanyaAdi { get; set; }
    public string KampanyaTuru { get; set; }
    public string GrupAdi { get; set; }
    public int? Kare { get; set; }
    public int Adet { get; set; } = 1;
}

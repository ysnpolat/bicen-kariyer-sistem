using System.Data;
using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class BasvuruController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly MailServisi _mail;
    private readonly AyarServisi _ayar;
    private readonly HizSiniriServisi _hiz;
    private readonly GuvenlikGunlugu _gunluk;
    private readonly YetkiServisi _yetki;
    private readonly OnayServisi _onay;
    private readonly TurnstileServisi _turnstile;
    private readonly UlkeServisi _ulke;
    private readonly YapayZekaServisi _zeka;
    private readonly ILogger<BasvuruController> _kayit;
    private readonly IConfiguration _yapilandirma;
    private readonly ToplulukDenetimi _topluluk;
    private readonly PersonelKaynagiServisi _personelKaynak;

    public BasvuruController(
        VeritabaniServisi vt,
        MailServisi mail,
        AyarServisi ayar,
        HizSiniriServisi hiz,
        GuvenlikGunlugu gunluk,
        YetkiServisi yetki,
        OnayServisi onay,
        TurnstileServisi turnstile,
        UlkeServisi ulke,
        YapayZekaServisi zeka,
        IConfiguration yapilandirma,
        ToplulukDenetimi topluluk,
        PersonelKaynagiServisi personelKaynak,
        ILogger<BasvuruController> kayit)
    {
        _personelKaynak = personelKaynak;
        _ulke = ulke;
        _zeka = zeka;
        _kayit = kayit;
        _yapilandirma = yapilandirma;
        _topluluk = topluluk;
        _vt = vt;
        _mail = mail;
        _ayar = ayar;
        _hiz = hiz;
        _gunluk = gunluk;
        _yetki = yetki;
        _onay = onay;
        _turnstile = turnstile;
    }

    /// <summary>İsteğin geldiği adres. Vekil sunucu arkasındaysa iletilen adres kullanılır.</summary>
    private string GonderenAdres() => IstemciAdresi.Bul(HttpContext);

    /// <summary>
    /// Başvuruda bulunması gereken alanları denetler.
    ///
    /// Aday formu bu kuralları zaten uygular; buradaki denetim formu
    /// atlayarak doğrudan istek gönderen araçlara karşıdır. Eksik varsa
    /// açıklaması döner, her şey yolundaysa null.
    /// </summary>
    private static string ZorunluAlanlariDenetle(JsonElement govde)
    {
        string Metin(string alan) =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
                ? d.GetString() ?? ""
                : "";

        bool Onay(string alan) =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.True;

        /* Fotoğraf gerçek bir görsel olmalı; dolu olması yetmez */
        var fotografSorunu = FotografDenetle(govde);

        if (fotografSorunu is not null) return fotografSorunu;

        if (string.IsNullOrWhiteSpace(Metin("adayAdSoyad")))
            return "Ad soyad zorunludur.";

        /* Ad soyad en az iki kelime olmalı */
        if (Metin("adayAdSoyad").Trim().Split(' ',
                StringSplitOptions.RemoveEmptyEntries).Length < 2)
            return "Ad ve soyadınızı eksiksiz yazınız.";

        if (string.IsNullOrWhiteSpace(Metin("subeKodu")))
            return "Başvurulacak birim seçilmelidir.";

        /* Pozisyon listesi dizi olarak gelir */
        var pozisyonVar = govde.TryGetProperty("bolumler", out var boluml) &&
                          ((boluml.ValueKind == JsonValueKind.Array &&
                            boluml.GetArrayLength() > 0) ||
                           (boluml.ValueKind == JsonValueKind.String &&
                            !string.IsNullOrWhiteSpace(boluml.GetString())));

        if (!pozisyonVar) return "Pozisyon seçilmelidir.";

        if (!Onay("kvkkOnay") || !Onay("aydinlatmaOnay") || !Onay("taahhutOnay"))
            return "Onay kutularını işaretlemeniz gerekmektedir.";

        return null;
    }

    /// <summary>
    /// Fotoğrafın gerçek bir görsel olup olmadığını denetler.
    ///
    /// Yalnızca "base64 alanı dolu mu" bakmak yetmiyor: otomatik gönderimler
    /// rastgele metin ya da tek renk küçük bir görsel koyabiliyor. Burada
    /// dosyanın imzası (JPEG/PNG/WEBP başlığı) ve boyutu denetlenir.
    /// </summary>
    private static string FotografDenetle(JsonElement govde)
    {
        if (!govde.TryGetProperty("fotograf", out var foto) ||
            foto.ValueKind != JsonValueKind.Object ||
            !foto.TryGetProperty("base64", out var veri) ||
            veri.ValueKind != JsonValueKind.String)
        {
            return "Fotoğraf eklemeniz gerekmektedir.";
        }

        var metin = veri.GetString() ?? "";

        /* 'data:image/jpeg;base64,...' önekini ayır */
        var virgul = metin.IndexOf(',');
        var govdeMetni = virgul > 0 && virgul < 100 ? metin[(virgul + 1)..] : metin;

        if (govdeMetni.Length < 3000)
            return "Fotoğraf çok küçük. Lütfen net bir vesikalık yükleyiniz.";

        byte[] bayt;

        try
        {
            bayt = Convert.FromBase64String(govdeMetni);
        }
        catch
        {
            return "Fotoğraf okunamadı. Lütfen tekrar yükleyiniz.";
        }

        /* Gerçek bir görselin dosya imzası olmalıdır */
        var gecerliTur =
            /* JPEG */
            (bayt.Length > 3 && bayt[0] == 0xFF && bayt[1] == 0xD8 && bayt[2] == 0xFF)
            /* PNG */
            || (bayt.Length > 8 && bayt[0] == 0x89 && bayt[1] == 0x50 &&
                bayt[2] == 0x4E && bayt[3] == 0x47)
            /* WEBP */
            || (bayt.Length > 12 && bayt[0] == 0x52 && bayt[1] == 0x49 &&
                bayt[8] == 0x57 && bayt[9] == 0x45);

        if (!gecerliTur)
            return "Geçerli bir fotoğraf yükleyiniz (JPEG veya PNG).";

        /* Gerçek bir vesikalık en az birkaç kilobayttır */
        if (bayt.Length < 4000)
            return "Fotoğraf çok küçük. Lütfen net bir vesikalık yükleyiniz.";

        return null;
    }

    /// <summary>
    /// Formun "parmak izi": aday tarafından doldurulması beklenen ama
    /// otomatik gönderimlerde sabit kalan alanların birleşimi.
    ///
    /// Gerçek adaylarda bu alanların hepsinin aynı olması neredeyse
    /// imkânsızdır; bot ise aynı şablonu tekrar kullanır.
    /// </summary>
    private static string FormIzi(JsonElement govde)
    {
        string Al(string alan) =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
                ? (d.GetString() ?? "").Trim().ToLowerInvariant()
                : "";

        var parcalar = new[]
        {
            Al("ilce"), Al("mahalle"), Al("caddeSokak"),
            Al("binaNo"), Al("daireNo"),
            Al("kanGrubu"), Al("dogumYeri"),
            Al("egitimSeviyesi"), Al("askerlikDurumu"),
            Al("iseBaslamaTarihi")
        };

        /* Alanların çoğu boşsa iz üretilmez; yanlış eşleşme olmasın */
        if (parcalar.Count(x => x.Length > 0) < 7) return null;

        using var ozetleyici = System.Security.Cryptography.SHA256.Create();

        var ozet = ozetleyici.ComputeHash(
            System.Text.Encoding.UTF8.GetBytes(string.Join("|", parcalar)));

        return Convert.ToHexString(ozet);
    }

    /// <summary>
    /// Sahte başvuruyu siler ve izlerini kalıcı kara listeye alır.
    ///
    /// Doğrudan SQL ile silmek yerine bu uç kullanılmalıdır: silme sırasında
    /// fotoğraf özeti ve form şablonu kara listeye geçer, böylece aynı kalıp
    /// tekrar kullanılamaz.
    /// </summary>
    /// <summary>
    /// Başvuruyu arşivler ya da arşivden çıkarır. Arşivlenen başvuru
    /// listelerde görünmez ama kaydı silinmez; her an geri alınabilir.
    /// Silme yerine bunun kullanılması önerilir.
    /// </summary>
    [HttpPost("{id:int}/Arsiv")]
    [Authorize]
    public IActionResult Arsivle(int id, [FromQuery] bool geriAl = false)
    {
        /* Arşivleme de silme gibi tek bir kullanıcıda: arşivlenen başvuru
           listeden kaybolduğu için, yetkiyi dağıtmak "kayıt nereye gitti"
           sorusunu geri getirir. */
        if (!IncelemeYetkisi)
            return StatusCode(403, new
            {
                hata = "Arşivleme yetkiniz yok.",
                ayrinti = "Bu işlem yalnızca sistem yöneticisinde açıktır."
            });

        using var db = _vt.Baglanti();

        var etkilenen = db.Execute(@"
UPDATE KRY_BASVURULAR
SET arsiv = @arsiv,
    arsiv_tarihi = CASE WHEN @arsiv = 1 THEN SYSDATETIME() ELSE NULL END,
    arsivleyen = CASE WHEN @arsiv = 1 THEN @kullanici ELSE NULL END
WHERE id = @id",
            new { id, arsiv = geriAl ? 0 : 1, kullanici = Kullanici });

        if (etkilenen == 0) return NotFound(new { hata = "Başvuru bulunamadı." });

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
SELECT @id, durum, @aciklama, @kullanici FROM KRY_BASVURULAR WHERE id = @id",
            new
            {
                id,
                aciklama = geriAl ? "Arşivden çıkarıldı" : "Arşive alındı",
                kullanici = Kullanici
            });

        return Ok(new { basarili = true, arsiv = !geriAl });
    }

    [HttpDelete("{id:int}/Sahte")]
    [Authorize]
    public IActionResult SahteSil(int id)
    {
        /* Kalıcı silme yalnızca 1 numaralı kullanıcıda: silinen başvuru geri
           getirilemiyor ve bir kaydın nereye gittiği sonradan araştırılamaz
           hâle geliyor. Diğer kullanıcılar arşivleme kullanır. */
        if (!IncelemeYetkisi)
            return StatusCode(403, new
            {
                hata = "Başvuru silme yetkiniz yok.",
                ayrinti = "Bunun yerine arşivleyebilirsiniz; arşivlenen başvuru "
                          + "listede görünmez ama kaydı korunur."
            });

        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT ad_soyad AS AdSoyad, kimlik_no AS KimlikNo,
       fotograf_ozeti AS FotografOzeti, form_izi AS FormIzi,
       gonderen_ip AS GonderenIp
FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        var izler = 0;

        /* İzler silinmeden önce kalıcı listeye alınır */
        if (!string.IsNullOrWhiteSpace((string)kayit.FotografOzeti))
        {
            IzKaydet(db, "FOTOGRAF", (string)kayit.FotografOzeti,
                $"Sahte başvurudan alındı: {kayit.AdSoyad}");
            izler++;
        }

        if (!string.IsNullOrWhiteSpace((string)kayit.FormIzi))
        {
            IzKaydet(db, "SABLON", (string)kayit.FormIzi,
                $"Sahte başvurudan alındı: {kayit.AdSoyad}");
            izler++;
        }

        /* Bağlı kayıtlar da temizlenir */
        db.Execute("DELETE FROM KRY_BASVURU_NOT WHERE basvuru_id = @id", new { id });
        db.Execute("DELETE FROM KRY_REFERANS WHERE basvuru_id = @id", new { id });
        db.Execute("DELETE FROM KRY_BASVURULAR WHERE id = @id", new { id });

        _gunluk.Yaz("SAHTE BAŞVURU SİLİNDİ",
            (string)kayit.GonderenIp ?? "-",
            $"{kayit.AdSoyad} ({kayit.KimlikNo}) · {izler} iz kara listeye alındı");

        return Ok(new { basarili = true, izler });
    }

    /// <summary>
    /// Mevcut başvurulardaki tekrar eden izleri toplu olarak kara listeye alır.
    ///
    /// Aynı fotoğrafı veya form şablonunu birden fazla kimlikle kullanan
    /// kayıtlar taranır. Geçmişte biriken sahte başvurular silinmeden önce
    /// bir kez çalıştırılması yeterlidir.
    /// </summary>
    [HttpPost("IzleriTara")]
    [Authorize]
    public IActionResult IzleriTara()
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        /* Önce mevcut başvurulardaki izler geçmiş tablosuna aktarılır */
        var aktarilan = db.Execute(@"
INSERT INTO KRY_IZ_GECMIS (tur, iz, kimlik_no)
SELECT DISTINCT 'FOTOGRAF', b.fotograf_ozeti, ISNULL(b.kimlik_no, '')
FROM KRY_BASVURULAR b
WHERE b.fotograf_ozeti IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM KRY_IZ_GECMIS g
      WHERE g.tur = 'FOTOGRAF' AND g.iz = b.fotograf_ozeti
        AND g.kimlik_no = ISNULL(b.kimlik_no, ''));

INSERT INTO KRY_IZ_GECMIS (tur, iz, kimlik_no)
SELECT DISTINCT 'SABLON', b.form_izi, ISNULL(b.kimlik_no, '')
FROM KRY_BASVURULAR b
WHERE b.form_izi IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM KRY_IZ_GECMIS g
      WHERE g.tur = 'SABLON' AND g.iz = b.form_izi
        AND g.kimlik_no = ISNULL(b.kimlik_no, ''));", commandTimeout: 120);

        /* Aynı fotoğrafı iki veya daha fazla kimlikle kullananlar */
        var fotograflar = db.Query<string>(@"
SELECT fotograf_ozeti
FROM KRY_BASVURULAR
WHERE fotograf_ozeti IS NOT NULL
GROUP BY fotograf_ozeti
HAVING COUNT(DISTINCT kimlik_no) >= 2").ToList();

        foreach (var iz in fotograflar)
            IzKaydet(db, "FOTOGRAF", iz, "Toplu taramada bulundu");

        /* Aynı şablonu üç veya daha fazla kimlikle kullananlar */
        var sablonlar = db.Query<string>(@"
SELECT form_izi
FROM KRY_BASVURULAR
WHERE form_izi IS NOT NULL
GROUP BY form_izi
HAVING COUNT(DISTINCT kimlik_no) >= 3").ToList();

        foreach (var iz in sablonlar)
            IzKaydet(db, "SABLON", iz, "Toplu taramada bulundu");

        _gunluk.Yaz("İZ TARAMASI", "-",
            $"{fotograflar.Count} fotoğraf, {sablonlar.Count} şablon izi eklendi");

        return Ok(new
        {
            basarili = true,
            aktarilan,
            fotograf = fotograflar.Count,
            sablon = sablonlar.Count
        });
    }

    /* ==================================================================== */
    /* Yapay zekânın engellediği başvurular                                  */
    /* ==================================================================== */

    /// <summary>
    /// İnceleme ekranı yalnızca sistem yöneticisine açıktır.
    ///
    /// Engellenen başvurularda aday fotoğrafı ve tüm form verisi bulunur;
    /// bunlar normal iş akışının parçası değildir, teknik bir inceleme
    /// alanıdır. Bu yüzden erişim tek kullanıcıyla sınırlandırılmıştır.
    /// </summary>
    private bool IncelemeYetkisi =>
        int.TryParse(
            User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value,
            out var id) && id == 1;

    /// <summary>
    /// Elle eklendiği anlaşılan başvuruları inceleme listesine taşır.
    ///
    /// Tetikleyici yeni eklemeleri zaten reddediyor; bu denetim, tetikleyici
    /// devre dışı bırakılmış ya da veri başka bir yoldan girmişse
    /// yakalamak için var. İnceleme ekranı her açıldığında çalışır.
    /// </summary>
    private void ElleEklenenleriTasi(IDbConnection db)
    {
        try
        {
            var adet = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BASVURULAR
WHERE DATEPART(nanosecond, olusturma) = 0");

            if (adet == 0) return;

            db.Execute(@"
INSERT INTO KRY_AI_ENGELLENEN
    (basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
     bolumler, il, ilce, mahalle, veri_json,
     ai_sonuc, ai_gerekce, ai_guven, gonderen_ip, olusturma)
SELECT basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
       bolumler, il, ilce, mahalle, veri_json,
       N'Şüpheli',
       N'Oluşturma tarihinin kesirli saniyesi sıfır: kayıt uygulama üzerinden değil, veritabanına elle eklenmiş görünüyor.',
       0, gonderen_ip, olusturma
FROM KRY_BASVURULAR
WHERE DATEPART(nanosecond, olusturma) = 0;

DELETE FROM KRY_BASVURULAR
WHERE DATEPART(nanosecond, olusturma) = 0;", commandTimeout: 120);

            _gunluk.Yaz("ELLE EKLENEN BAŞVURU", "-",
                $"{adet} kayıt incelemeye taşındı");
        }
        catch (Exception hata)
        {
            /* Denetim başarısız olursa inceleme ekranı yine açılmalı */
            _gunluk.Yaz("ELLE EKLENEN DENETİMİ HATASI", "-", hata.Message);
        }
    }

    /// <summary>
    /// Veritabanı erişim denetimi: kim nereden bağlanmış, ne yapmış.
    ///
    /// <para>
    /// SQL Server geçmişi kendiliğinden tutmaz; bu uç <b>şu an bağlı</b>
    /// oturumları gösterir. Bağlantı kapandığında kayıt kaybolur. Kalıcı
    /// geçmiş için sunucu denetimi (SQL Server Audit) gerekir.
    /// </para>
    ///
    /// <para>
    /// Kalıcı olan tek şey, uygulamanın kendi tuttuğu engellenen ekleme
    /// kayıtları ve elle eklendiği anlaşılıp incelemeye taşınan
    /// başvurulardır; ikisi de burada döner.
    /// </para>
    /// </summary>
    [HttpGet("ErisimDenetimi")]
    [Authorize]
    public IActionResult ErisimDenetimi()
    {
        if (!IncelemeYetkisi)
            return StatusCode(403, new { hata = "Bu ekran sistem yöneticisine açıktır." });

        using var db = _vt.Baglanti();

        var oturumlar = new List<object>();
        string oturumHatasi = null;

        try
        {
            oturumlar = db.Query(@"
SELECT
    s.session_id                                    AS oturum,
    s.login_name                                    AS kullanici,
    NULLIF(s.nt_domain + '' + s.nt_user_name, '') AS windowsHesabi,
    c.client_net_address                            AS ip,
    c.client_tcp_port                               AS port,
    s.host_name                                     AS bilgisayar,
    s.program_name                                  AS uygulama,
    c.net_transport                                 AS protokol,
    c.auth_scheme                                   AS kimlikDogrulama,
    CASE WHEN s.program_name = N'BicenKariyerAPI' THEN 1 ELSE 0 END AS panelMi,
    CASE
        WHEN t.text LIKE '%DROP %'    THEN N'DROP'
        WHEN t.text LIKE '%TRUNCATE%' THEN N'TRUNCATE'
        WHEN t.text LIKE '%ALTER %'   THEN N'ALTER'
        WHEN t.text LIKE '%DELETE %'  THEN N'DELETE'
        WHEN t.text LIKE '%UPDATE %'  THEN N'UPDATE'
        WHEN t.text LIKE '%INSERT %'  THEN N'INSERT'
        WHEN t.text LIKE '%SELECT %'  THEN N'SELECT'
        ELSE N'-'
    END                                             AS islem,
    CASE
        WHEN t.text LIKE '%KRY_BASVURULAR%'   THEN N'KRY_BASVURULAR'
        WHEN t.text LIKE '%KRY_KADRO%'        THEN N'KRY_KADRO'
        WHEN t.text LIKE '%KRY_KULLANICILAR%' THEN N'KRY_KULLANICILAR'
        WHEN t.text LIKE '%KRY_CIKIS%'        THEN N'KRY_CIKIS_*'
        WHEN t.text LIKE '%KRY_%'             THEN N'diğer KRY'
        ELSE NULL
    END                                             AS hedefTablo,
    s.row_count                                     AS etkilenenSatir,
    s.login_time                                    AS baglandi,
    s.last_request_end_time                         AS sonIslem,
    (SELECT COUNT(*) FROM sys.dm_tran_session_transactions x
     WHERE x.session_id = s.session_id)             AS acikIslem,
    LTRIM(RTRIM(REPLACE(REPLACE(REPLACE(
        LEFT(t.text, 1200), CHAR(13), ' '), CHAR(10), ' '), CHAR(9), ' ')))
                                                    AS sorgu
FROM sys.dm_exec_sessions s
LEFT JOIN sys.dm_exec_connections c ON c.session_id = s.session_id
LEFT JOIN sys.dm_exec_requests    r ON r.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(
    COALESCE(r.sql_handle, c.most_recent_sql_handle)) t
WHERE s.is_user_process = 1
  AND s.session_id <> @@SPID
  AND DB_NAME(s.database_id) = DB_NAME()
ORDER BY
    CASE WHEN s.program_name = N'BicenKariyerAPI' THEN 1 ELSE 0 END,
    s.last_request_end_time DESC").Cast<object>().ToList();
        }
        catch (Exception hata)
        {
            /* Oturum görüntüleri VIEW SERVER STATE yetkisi ister; yoksa
               ekranın geri kalanı yine çalışmalı. */
            oturumHatasi = hata.Message;
        }

        /* Engellenen ekleme denemeleri: tetikleyicinin tuttuğu kalıcı kayıt */
        var engellenenler = new List<object>();

        try
        {
            engellenenler = db.Query(@"
SELECT TOP 200 tablo, uygulama, kullanici, makine, tarih
FROM KRY_ENGELLENEN_EKLEME
ORDER BY tarih DESC").Cast<object>().ToList();
        }
        catch { /* tablo henüz oluşmamış olabilir */ }

        /* Elle eklendiği anlaşılıp incelemeye taşınan başvurular */
        var supheliler = db.Query(@"
SELECT TOP 200 id, basvuru_no AS basvuruNo, ad_soyad AS adSoyad,
       kimlik_no AS kimlikNo, sube_adi AS subeAdi, gonderen_ip AS gonderenIp,
       olusturma, incelendi
FROM KRY_AI_ENGELLENEN
WHERE ai_gerekce LIKE N'%kesirli saniye%'
ORDER BY olusturma DESC").Cast<object>().ToList();

        /* Başvuruların kaynağı: kesirli saniye sıfırsa elle girilmiş */
        var ozet = db.QueryFirstOrDefault(@"
SELECT
    COUNT(*)                                                    AS toplam,
    SUM(CASE WHEN DATEPART(nanosecond, olusturma) = 0
             THEN 1 ELSE 0 END)                                 AS elleGirilen,
    SUM(CASE WHEN DATEPART(nanosecond, olusturma) <> 0
             THEN 1 ELSE 0 END)                                 AS panelden
FROM KRY_BASVURULAR");

        /* Koruma tetikleyicisi yerinde mi */
        var korumaVar = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM sys.triggers
WHERE name = 'TRG_KRY_BASVURULAR_Koruma' AND is_disabled = 0") > 0;

        return Ok(new
        {
            oturumlar,
            oturumHatasi,
            engellenenler,
            supheliler,
            ozet,
            korumaVar
        });
    }

    /// <summary>Engellenen başvurular; incelenmemişler önce gelir.</summary>
    [HttpGet("Engellenenler")]
    [Authorize]
    public IActionResult Engellenenler([FromQuery] bool tumu = false)
    {
        if (!IncelemeYetkisi)
            return StatusCode(403, new { hata = "Bu sayfaya erişim yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        using var denetimDb = _vt.Baglanti();
        ElleEklenenleriTasi(denetimDb);

        var kosul = tumu ? "" : "WHERE incelendi = 0";

        var liste = db.Query<EngellenenBasvuru>($@"
SELECT TOP 300 id AS Id, basvuru_no AS BasvuruNo, ad_soyad AS AdSoyad,
       kimlik_no AS KimlikNo, telefon AS Telefon, eposta AS Eposta,
       sube_adi AS SubeAdi, bolumler AS Bolumler,
       il AS Il, ilce AS Ilce, mahalle AS Mahalle,
       ai_sonuc AS AiSonuc, ai_gerekce AS AiGerekce, ai_guven AS AiGuven,
       gonderen_ip AS GonderenIp, incelendi AS Incelendi,
       aktarildi AS Aktarildi, aktarilan_id AS AktarilanId,
       inceleyen AS Inceleyen, olusturma AS Olusturma
FROM KRY_AI_ENGELLENEN
{kosul}
ORDER BY id DESC").ToList();

        var bekleyen = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_AI_ENGELLENEN WHERE incelendi = 0");

        return Ok(new { bekleyen, kayitlar = liste });
    }

    /// <summary>Engellenen başvurunun fotoğrafı</summary>
    [HttpGet("Engellenen/{id:int}/Fotograf")]
    [Authorize]
    public IActionResult EngellenenFotograf(int id)
    {
        if (!IncelemeYetkisi)
            return StatusCode(403, new { hata = "Bu sayfaya erişim yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var json = db.ExecuteScalar<string>(
            "SELECT veri_json FROM KRY_AI_ENGELLENEN WHERE id = @id", new { id });

        if (string.IsNullOrWhiteSpace(json)) return NotFound();

        try
        {
            using var belge = JsonDocument.Parse(json);

            if (!belge.RootElement.TryGetProperty("fotograf", out var foto) ||
                !foto.TryGetProperty("base64", out var b64))
            {
                return NotFound();
            }

            var metin = b64.GetString() ?? "";
            var virgul = metin.IndexOf(',');

            if (virgul > 0 && virgul < 100) metin = metin[(virgul + 1)..];

            Response.Headers["Cache-Control"] = "private, max-age=3600";

            return File(Convert.FromBase64String(metin), "image/jpeg");
        }
        catch
        {
            return NotFound();
        }
    }

    /// <summary>Engellenen başvurunun form verisi; önizleme için.</summary>
    [HttpGet("Engellenen/{id:int}/Form")]
    [Authorize]
    public IActionResult EngellenenForm(int id)
    {
        if (!IncelemeYetkisi)
            return StatusCode(403, new { hata = "Bu sayfaya erişim yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT veri_json AS VeriJson, ai_sonuc AS AiSonuc,
       ai_gerekce AS AiGerekce, ai_guven AS AiGuven,
       gonderen_ip AS GonderenIp, tarayici AS Tarayici,
       olusturma AS Olusturma
FROM KRY_AI_ENGELLENEN WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        return Ok(new
        {
            veriJson = (string)kayit.VeriJson,
            aiSonuc = (string)kayit.AiSonuc,
            aiGerekce = (string)kayit.AiGerekce,
            aiGuven = kayit.AiGuven,
            gonderenIp = (string)kayit.GonderenIp,
            tarayici = (string)kayit.Tarayici,
            olusturma = kayit.Olusturma
        });
    }

    /// <summary>
    /// Engellenen başvuruyu gerçek başvurulara aktarır.
    /// Yapay zekâ yanlış karar verdiyse kullanılır.
    /// </summary>
    [HttpPost("Engellenen/{id:int}/Aktar")]
    [Authorize]
    public IActionResult EngellenenAktar(int id)
    {
        if (!IncelemeYetkisi)
            return StatusCode(403, new { hata = "Bu sayfaya erişim yetkiniz bulunmuyor." });

        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT * FROM KRY_AI_ENGELLENEN WHERE id = @id AND aktarildi = 0", new { id });

        if (kayit is null)
            return NotFound(new { hata = "Kayıt bulunamadı ya da zaten aktarılmış." });

        var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_BASVURULAR
    (basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
     bolumler, birim_turu, il, ilce, mahalle, durum, veri_json,
     kaynak, kaynak_detay,
     gonderen_ip, tarayici, fotograf_ozeti, form_izi)
VALUES (@basvuruNo, @adSoyad, @kimlik, @telefon, @eposta, @subeKodu, @subeAdi,
        @bolumler, @birimTuru, @il, @ilce, @mahalle, @durum, @json,
        @kaynak, @kaynakDetay,
        @adres, @tarayici, @fotoOzeti, @formIzi);

/* Tetikleyicisi olan tabloda OUTPUT ... INTO olmadan kullanilamaz;
   kimlik SCOPE_IDENTITY ile alinir. */
SELECT CAST(SCOPE_IDENTITY() AS INT);",
            new
            {
                basvuruNo = (string)kayit.basvuru_no,
                adSoyad = (string)kayit.ad_soyad,
                kimlik = (string)kayit.kimlik_no,
                telefon = (string)kayit.telefon,
                eposta = (string)kayit.eposta,
                subeKodu = (string)kayit.sube_kodu,
                subeAdi = (string)kayit.sube_adi,
                bolumler = (string)kayit.bolumler,
                birimTuru = (string)kayit.birim_turu,
                il = (string)kayit.il,
                ilce = (string)kayit.ilce,
                mahalle = (string)kayit.mahalle,
                durum = Durumlar.Yeni,
                json = (string)kayit.veri_json,

                /* Engellenen kayıtlar aktarılırken kaynak bilgisi yok:
                   o tabloda bu alanlar tutulmuyor. */
                kaynak = (string)null,
                kaynakDetay = (string)null,

                adres = (string)kayit.gonderen_ip,
                tarayici = (string)kayit.tarayici,
                fotoOzeti = (string)kayit.fotograf_ozeti,
                formIzi = (string)kayit.form_izi
            });

        db.Execute(@"
UPDATE KRY_AI_ENGELLENEN
SET incelendi = 1, aktarildi = 1, aktarilan_id = @yeniId,
    inceleyen = @kullanici, inceleme_tarihi = SYSDATETIME()
WHERE id = @id", new { id, yeniId, kullanici = Kullanici });

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@yeniId, @durum, @aciklama, @kullanici)",
            new
            {
                yeniId,
                durum = Durumlar.Yeni,
                aciklama = "Yapay zekâ incelemesinden aktarıldı",
                kullanici = Kullanici
            });

        _gunluk.Yaz("İNCELEMEDEN AKTARILDI", (string)kayit.gonderen_ip ?? "-",
            $"{kayit.ad_soyad} · {Kullanici}");

        return Ok(new { basarili = true, id = yeniId });
    }

    /// <summary>Engellenen başvuruyu sahte olarak işaretler.</summary>
    [HttpPost("Engellenen/{id:int}/Sahte")]
    [Authorize]
    public IActionResult EngellenenSahte(int id)
    {
        if (!IncelemeYetkisi)
            return StatusCode(403, new { hata = "Bu sayfaya erişim yetkiniz bulunmuyor." });

        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT fotograf_ozeti AS FotografOzeti, form_izi AS FormIzi, ad_soyad AS AdSoyad
FROM KRY_AI_ENGELLENEN WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Kayıt bulunamadı." });

        /* İzler kalıcı kara listeye alınır */
        if (!string.IsNullOrWhiteSpace((string)kayit.FotografOzeti))
            IzKaydet(db, "FOTOGRAF", (string)kayit.FotografOzeti,
                $"İncelemede sahte onaylandı: {kayit.AdSoyad}");

        if (!string.IsNullOrWhiteSpace((string)kayit.FormIzi))
            IzKaydet(db, "SABLON", (string)kayit.FormIzi,
                $"İncelemede sahte onaylandı: {kayit.AdSoyad}");

        db.Execute(@"
UPDATE KRY_AI_ENGELLENEN
SET incelendi = 1, inceleyen = @kullanici, inceleme_tarihi = SYSDATETIME()
WHERE id = @id", new { id, kullanici = Kullanici });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Mevcut başvuruların fotoğraf özetlerini yeni yönteme göre yeniden
    /// hesaplar.
    ///
    /// Eski özetler dosya baytları üzerinden alınmıştı; meta veri değişince
    /// farklı çıkıyordu. Yeni yöntem yalnızca görüntü verisini özetler.
    /// Bir kez çalıştırılması yeterlidir.
    /// </summary>
    [HttpPost("OzetleriYenile")]
    [Authorize]
    public IActionResult OzetleriYenile()
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var kayitlar = db.Query<(int Id, string Json)>(@"
SELECT id, veri_json FROM KRY_BASVURULAR
WHERE veri_json IS NOT NULL AND CHARINDEX('base64', veri_json) > 0",
            commandTimeout: 300).ToList();

        var guncellenen = 0;
        var degisen = 0;

        foreach (var (id, json) in kayitlar)
        {
            string yeniOzet;

            try
            {
                using var belge = JsonDocument.Parse(json);
                yeniOzet = FotografOzeti(belge.RootElement);
            }
            catch
            {
                continue;
            }

            if (string.IsNullOrWhiteSpace(yeniOzet)) continue;

            var eski = db.ExecuteScalar<string>(
                "SELECT fotograf_ozeti FROM KRY_BASVURULAR WHERE id = @id",
                new { id });

            if (eski == yeniOzet) continue;

            db.Execute(@"
UPDATE KRY_BASVURULAR SET fotograf_ozeti = @ozet WHERE id = @id",
                new { id, ozet = yeniOzet });

            /* İz geçmişi de yeni özetle güncellenir */
            var kimlik = db.ExecuteScalar<string>(
                "SELECT LTRIM(RTRIM(kimlik_no)) FROM KRY_BASVURULAR WHERE id = @id",
                new { id });

            if (!string.IsNullOrWhiteSpace(kimlik))
                IzGecmisiYaz(db, "FOTOGRAF", yeniOzet, kimlik);

            guncellenen++;

            if (!string.IsNullOrWhiteSpace(eski)) degisen++;
        }

        _gunluk.Yaz("ÖZET YENİLEME", "-",
            $"{kayitlar.Count} kayıt tarandı, {guncellenen} özet güncellendi");

        return Ok(new
        {
            basarili = true,
            taranan = kayitlar.Count,
            guncellenen,
            degisen
        });
    }

    /// <summary>Toplu gönderim koruması durumu</summary>
    [HttpGet("KorumaDurumu")]
    [Authorize]
    public IActionResult KorumaDurumu() => Ok(_topluluk.Durum());

    /// <summary>Korumalı kipi elle kapatır.</summary>
    [HttpPost("KorumayiKapat")]
    [Authorize]
    public IActionResult KorumayiKapat()
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        _topluluk.KorumayiKapat();

        _gunluk.Yaz("KORUMA KAPATILDI", "-", Kullanici);

        return Ok(new { basarili = true });
    }

    /// <summary>Kalıcı iz kara listesi</summary>
    [HttpGet("IzListesi")]
    [Authorize]
    public IActionResult IzListesi()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT TOP 200 id AS id, tur AS tur, LEFT(iz, 16) AS izKisa,
       gorulme AS gorulme, sebep AS sebep,
       son_gorulme AS sonGorulme, olusturma AS olusturma
FROM KRY_IZ_KARA_LISTE
ORDER BY gorulme DESC, id DESC").ToList();

        return Ok(liste);
    }

    /// <summary>
    /// Form verisinin özeti; yapay zekâya fotoğrafla birlikte verilir.
    ///
    /// Hassas alanlar (kimlik numarası, referans telefonları) dışarıda
    /// bırakılır; modelin karar vermesi için gerekli değiller.
    /// </summary>
    private static string FormOzeti(JsonElement govde)
    {
        string Al(string alan) =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
                ? (d.GetString() ?? "").Trim()
                : "";

        var satirlar = new List<string>();

        void Ekle(string etiket, string deger)
        {
            if (!string.IsNullOrWhiteSpace(deger))
                satirlar.Add($"- {etiket}: {deger}");
        }

        Ekle("Ad Soyad", Al("adayAdSoyad"));
        Ekle("Doğum tarihi", Al("dogumTarihi"));
        Ekle("Doğum yeri", Al("dogumYeri"));
        Ekle("Cinsiyet", Al("cinsiyet"));
        Ekle("Medeni durum", Al("medeniDurum"));
        Ekle("Askerlik", Al("askerlikDurumu"));
        Ekle("Eğitim", Al("egitimSeviyesi"));
        Ekle("Mezun olduğu okul", Al("mezunOkul"));
        Ekle("Başvurulan şube", Al("subeAdi"));
        Ekle("Başvurulan pozisyon", BolumMetni(govde));
        Ekle("Adres", string.Join(", ", new[]
        {
            Al("mahalle"), Al("caddeSokak"), Al("ilce"), Al("il")
        }.Where(x => x.Length > 0)));
        Ekle("İşe başlama tarihi", Al("iseBaslamaTarihi"));
        Ekle("Talep edilen ücret", Al("talepEdilenNetUcret"));

        return satirlar.Count > 0
            ? string.Join("\n", satirlar)
            : "(form bilgisi okunamadı)";
    }

    /// <summary>Seçilen bölümleri tek metne çevirir.</summary>
    private static string BolumMetni(JsonElement govde) =>
        govde.TryGetProperty("bolumler", out var b) && b.ValueKind == JsonValueKind.Array
            ? string.Join(", ", b.EnumerateArray().Select(x => x.GetString()))
            : "";

    /// <summary>
    /// Yapay zekânın reddettiği başvuruyu incelemeye alır.
    /// Kayıt silinmez; yanlış ret olursa panelden aktarılabilir.
    /// </summary>
    private void IncelemeyeAl(
        JsonElement govde, string json, string adres,
        string fotoOzeti, string formIzi,
        YapayZekaServisi.Karar karar,
        string basvuruNo, string kimlik, string telefon)
    {
        string Al(string alan) =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
                ? d.GetString()
                : "";

        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
INSERT INTO KRY_AI_ENGELLENEN
    (basvuru_no, ad_soyad, kimlik_no, telefon, eposta,
     sube_kodu, sube_adi, bolumler, il, ilce, mahalle, birim_turu,
     veri_json, ai_sonuc, ai_gerekce, ai_guven,
     gonderen_ip, tarayici, fotograf_ozeti, form_izi)
VALUES (@basvuruNo, @adSoyad, @kimlik, @telefon, @eposta,
        @subeKodu, @subeAdi, @bolumler, @il, @ilce, @mahalle, @birimTuru,
        @json, @sonuc, @gerekce, @guven,
        @adres, @tarayici, @fotoOzeti, @formIzi);

/* Tetikleyicisi olan tabloda OUTPUT ... INTO olmadan kullanilamaz;
   kimlik SCOPE_IDENTITY ile alinir. */
SELECT CAST(SCOPE_IDENTITY() AS INT);",
                new
                {
                    basvuruNo,
                    /* Alan adları gerçek kayıtla aynı olmalı; form
                       "adayAdSoyad" ve "subeAdi" gönderiyor. */
                    adSoyad = Al("adayAdSoyad"),
                    kimlik = Sadelestir(kimlik),
                    telefon = SonOnHane(telefon),
                    eposta = Al("email"),
                    subeKodu = Al("subeKodu"),
                    subeAdi = Al("subeAdi"),
                    bolumler = BolumMetni(govde),
                    il = Al("il"),
                    ilce = Al("ilce"),
                    mahalle = Al("mahalle"),
                    birimTuru = Al("birimTuru"),
                    json,
                    sonuc = karar.Sonuc,
                    gerekce = karar.Gerekce,
                    guven = karar.Guven,
                    adres,
                    tarayici = TarayiciBilgisi(),
                    fotoOzeti,
                    formIzi
                });
        }
        catch (Exception hata)
        {
            _gunluk.Yaz("İNCELEME KAYDI HATASI", adres, hata.Message);
        }
    }

    /// <summary>
    /// Görülen izi geçmiş tablosuna yazar. Aynı kimlik aynı izle tekrar
    /// başvurursa yeni satır açılmaz.
    /// </summary>
    private static void IzGecmisiYaz(IDbConnection db, string tur, string iz, string kimlik)
    {
        db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_IZ_GECMIS
               WHERE tur = @tur AND iz = @iz AND kimlik_no = @kimlik)
    INSERT INTO KRY_IZ_GECMIS (tur, iz, kimlik_no)
    VALUES (@tur, @iz, @kimlik);",
            new { tur, iz, kimlik = kimlik ?? "" });
    }

    /// <summary>
    /// Bir izi kalıcı kara listeye alır; zaten varsa görülme sayacını artırır.
    ///
    /// Başvuru kaydı silinse bile iz burada kalır. Sahte başvuruları
    /// temizlemek botun izini kaybettirmemelidir.
    /// </summary>
    private static void IzKaydet(IDbConnection db, string tur, string iz, string sebep)
    {
        try
        {
            db.Execute(@"
MERGE KRY_IZ_KARA_LISTE AS h
USING (SELECT @tur AS tur, @iz AS iz) AS k
    ON h.tur = k.tur AND h.iz = k.iz
WHEN MATCHED THEN
    UPDATE SET gorulme = h.gorulme + 1, son_gorulme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (tur, iz, sebep, ekleyen, son_gorulme)
    VALUES (@tur, @iz, @sebep, 'sistem', SYSDATETIME());",
                new { tur, iz, sebep });
        }
        catch
        {
            /* İz kaydedilemezse başvuru akışı yine de sürer */
        }
    }

    /* ==================================================================== */
    /* E-posta doğrulama                                                     */
    /* ==================================================================== */

    /// <summary>
    /// İsteğin başvuru sayfasından gelip gelmediğini denetler.
    ///
    /// <para>
    /// Tarayıcı, sayfadan yapılan isteklere <c>Origin</c> başlığı ekler.
    /// Doğrudan araçla (curl, betik) gönderilen isteklerde bu başlık ya yok
    /// ya da farklıdır.
    /// </para>
    ///
    /// <para>
    /// <b>Bu kesin bir koruma değildir</b> — başlık taklit edilebilir. Ama
    /// hazır araçlarla yapılan basit denemeleri eler ve saldırganın işini
    /// bir adım daha zorlaştırır.
    /// </para>
    /// </summary>
    private (bool Uygun, string Sebep) KaynakUygun()
    {
        /* Varsayılan kapalıdır: adayların çoğu başvuru bağlantısını
           Instagram, Facebook ya da TikTok uygulaması içindeki tarayıcıdan
           açıyor; bu tarayıcılar gizlilik ayarları nedeniyle Origin ve
           Referer başlıklarını sıklıkla göndermez. Açılırsa gerçek
           adayların bir kısmı da incelemeye düşer. */
        if (!_yapilandirma.GetValue("KaynakDenetimi:Acik", false))
            return (true, null);

        var izinli = _yapilandirma
            .GetSection("KaynakDenetimi:Adresler").Get<string[]>()
            ?? Array.Empty<string>();

        if (izinli.Length == 0) return (true, null);

        var kaynak = Request.Headers["Origin"].ToString();

        /* Origin yoksa Referer'a bakılır; bazı tarayıcılar Origin
           göndermez ama Referer gönderir. */
        if (string.IsNullOrWhiteSpace(kaynak))
        {
            var yonlendiren = Request.Headers["Referer"].ToString();

            if (!string.IsNullOrWhiteSpace(yonlendiren) &&
                Uri.TryCreate(yonlendiren, UriKind.Absolute, out var u))
            {
                kaynak = u.GetLeftPart(UriPartial.Authority);
            }
        }

        if (string.IsNullOrWhiteSpace(kaynak))
            return (false, "İstek başvuru sayfasından gelmiyor");

        var uygun = izinli.Any(x =>
            !string.IsNullOrWhiteSpace(x) &&
            kaynak.TrimEnd('/').Equals(x.TrimEnd('/'),
                StringComparison.OrdinalIgnoreCase));

        return uygun ? (true, null) : (false, $"Beklenmeyen kaynak: {kaynak}");
    }

    /// <summary>Telefon (SMS) doğrulaması zorunlu mu</summary>
    /// <summary>
    /// SMS doğrulaması açık mı.
    ///
    /// <para>
    /// appsettings.json içinde "TelefonDogrulama": { "Acik": false }
    /// yazılırsa form bu adımı hiç göstermez ve sunucu kod istemez.
    /// Eski "ZorunluDegil": true anahtarı da aynı etkiyi sürdürür.
    /// </para>
    ///
    /// <para>
    /// Kapatmak, doğrulanmamış başvuruların kabul edilmesi demektir:
    /// telefon numarasının gerçekliği denetlenmez.
    /// </para>
    /// </summary>
    private bool TelefonDogrulamaAcik =>
        /* Başvuru formunda SMS doğrulaması KALDIRILDI.

           Form artık bu adımı hiç göstermiyor; sunucunun kod istemesi de
           başvuruyu kabul edilemez hâle getirirdi. SMS servisi kapatılmadı,
           mobil giriş ve çıkış anketi için kullanılmaya devam ediyor.

           Geri açmak gerekirse: appsettings.json'a
           "TelefonDogrulama": { "Acik": true } yazıp buradaki false
           değerini o ayarı okuyan koşulla değiştirmek yeterli. */
        false;

    /// <summary>
    /// Adresin alan adı kabul ediliyor mu.
    ///
    /// <para>
    /// İzinli alan listesinde kayıt varsa <b>yalnızca</b> o alanlar kabul
    /// edilir; diğerleri reddedilir. Liste boşsa kısıt uygulanmaz.
    /// </para>
    ///
    /// <para>
    /// Bu, engelli listesinden farklı bir yaklaşımdır: engelli listesi
    /// bilinen kötüleri kapatır, izinli liste bilinmeyenleri kapatır.
    /// İkincisi daha güvenlidir ama gerçek adayları da kesebilir; yalnızca
    /// yaygın sağlayıcılar açık bırakılmalıdır.
    /// </para>
    /// </summary>
    private (bool Kabul, string Sebep) AlanKabulEdilir(string eposta)
    {
        var at = (eposta ?? "").LastIndexOf('@');

        if (at < 0 || at == eposta.Length - 1)
            return (false, "Geçerli bir e-posta adresi giriniz.");

        var alan = eposta[(at + 1)..].Trim().ToLowerInvariant();

        try
        {
            using var db = _vt.Baglanti();

            var izinliler = db.Query<string>(
                "SELECT alan FROM KRY_IZINLI_ALAN WHERE aktif = 1").ToList();

            if (izinliler.Count > 0)
            {
                var uygun = izinliler.Any(x =>
                {
                    var e = (x ?? "").Trim().ToLowerInvariant().TrimStart('@');
                    return e.Length > 0 &&
                           (alan == e ||
                            alan.EndsWith("." + e, StringComparison.Ordinal));
                });

                if (!uygun)
                {
                    return (false,
                        "Bu e-posta sağlayıcısı kabul edilmiyor. "
                        + "Lütfen " + string.Join(", ",
                            izinliler.Take(4).Select(x => "@" + x))
                        + " gibi bir adres kullanınız.");
                }
            }
        }
        catch
        {
            /* Liste okunamazsa kısıt uygulanmaz */
        }

        return AlanEngelli(eposta)
            ? (false, "Bu e-posta sağlayıcısı kabul edilmiyor.")
            : (true, null);
    }

    /// <summary>
    /// Adresin alan adı engelli listesinde mi.
    ///
    /// Liste veritabanından okunur (panelden yönetilir). Alt alan adları da
    /// kapsanır: protonmail.com engelliyse posta.protonmail.com da engellidir.
    /// Engellendiğinde sayaç artırılır; hangi alanın ne kadar iş gördüğü
    /// panelde görünür.
    /// </summary>
    private bool AlanEngelli(string eposta)
    {
        var at = (eposta ?? "").LastIndexOf('@');

        if (at < 0 || at == eposta.Length - 1) return false;

        var alan = eposta[(at + 1)..].Trim().ToLowerInvariant();

        try
        {
            using var db = _vt.Baglanti();

            var kayitlar = db.Query<(int Id, string Alan)>(@"
SELECT id, alan FROM KRY_ENGELLI_ALAN WHERE aktif = 1").ToList();

            foreach (var (id, engelli) in kayitlar)
            {
                var e = (engelli ?? "").Trim().ToLowerInvariant().TrimStart('@');

                if (e.Length == 0) continue;

                if (alan == e || alan.EndsWith("." + e, StringComparison.Ordinal))
                {
                    db.Execute(@"
UPDATE KRY_ENGELLI_ALAN
SET engelleme = engelleme + 1, son_deneme = SYSDATETIME()
WHERE id = @id", new { id });

                    return true;
                }
            }
        }
        catch
        {
            /* Liste okunamazsa başvuru engellenmez */
        }

        return false;
    }

    /// <summary>
    /// Adayın telefon numarasına SMS ile doğrulama kodu gönderir.
    ///
    /// Kod doğrulanmadan başvuru kaydedilmez. Otomatik gönderimlerin her
    /// başvuru için gerçek bir telefon hattına erişmesi gerekir; e-posta
    /// doğrulamasından daha güçlü bir engeldir çünkü geçici telefon hattı
    /// edinmek geçici posta adresinden daha zor ve maliyetlidir.
    /// </summary>
    [HttpPost("KodGonder")]
    [AllowAnonymous]
    public async Task<IActionResult> KodGonder(
        [FromBody] KodGonderGirdi girdi,
        [FromServices] SmsServisi sms)
    {
        var adres = IstemciAdresi.Bul(HttpContext);

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.Telefon))
            return BadRequest(new { hata = "Telefon numarası gereklidir." });

        var telefon = new string(girdi.Telefon.Where(char.IsDigit).ToArray());

        if (telefon.StartsWith("90") && telefon.Length == 12)
            telefon = telefon[2..];

        if (telefon.StartsWith("0") && telefon.Length == 11)
            telefon = telefon[1..];

        if (telefon.Length != 10 || !telefon.StartsWith("5"))
            return BadRequest(new
            {
                hata = "Geçerli bir telefon numarası giriniz.",
                ayrinti = "Örnek: 5xxxxxxxxx"
            });

        if (!sms.Etkin)
        {
            _gunluk.Yaz("SMS SERVİSİ KAPALI", adres, telefon);

            return StatusCode(503, new
            {
                hata = "SMS doğrulama servisi şu anda kullanılamıyor.",
                ayrinti = "Lütfen daha sonra tekrar deneyiniz."
            });
        }

        using var db = _vt.Baglanti();

        /* Aynı numaraya ard arda kod istenmesini sınırla */
        var sonIstek = db.ExecuteScalar<DateTime?>(@"
SELECT MAX(olusturma) FROM KRY_TELEFON_DOGRULAMA WHERE telefon = @telefon",
            new { telefon });

        if (sonIstek is not null &&
            (DateTime.Now - sonIstek.Value).TotalSeconds < 60)
        {
            return BadRequest(new
            {
                hata = "Çok sık kod istediniz.",
                ayrinti = "Yeni kod için bir dakika bekleyiniz."
            });
        }

        /* Aynı numaradan günlük istek sayısı */
        var gunlukIstek = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_TELEFON_DOGRULAMA
WHERE telefon = @telefon AND olusturma > DATEADD(day, -1, SYSDATETIME())",
            new { telefon });

        if (gunlukIstek >= 5)
        {
            _gunluk.Yaz("KOD SINIRI", adres, $"{telefon} · günlük sınır aşıldı");

            return BadRequest(new
            {
                hata = "Bu numara için günlük kod sınırına ulaşıldı.",
                ayrinti = "Lütfen yarın tekrar deneyiniz."
            });
        }

        /* Adres bazında da sınır; tek makineden çok numara denenmesin */
        var adresIstegi = db.ExecuteScalar<int>(@"
SELECT COUNT(DISTINCT telefon) FROM KRY_TELEFON_DOGRULAMA
WHERE gonderen_ip = @adres AND olusturma > DATEADD(hour, -1, SYSDATETIME())",
            new { adres });

        if (adresIstegi >= 5)
        {
            _gunluk.Yaz("KOD SINIRI", adres, "Saatlik farklı numara sınırı aşıldı");
            _hiz.BasarisizKaydet();

            return BadRequest(new
            {
                hata = "Çok fazla deneme yapıldı.",
                ayrinti = "Lütfen bir süre sonra tekrar deneyiniz."
            });
        }

        /* Bu numaradan bugün onaylanmış bir başvuru varsa yeni kod
           gönderilmez; aynı numarayla günde tek başvuru yapılabilir.
           Denetim burada da yapılır ki aday, kodu aldıktan sonra formu
           doldurup en sonda reddedilmesin. */
        var bugunkuBasvuru = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BASVURULAR
WHERE telefon = @telefon
  AND CAST(olusturma AS DATE) = CAST(SYSDATETIME() AS DATE)",
            new { telefon });

        if (bugunkuBasvuru > 0)
        {
            return BadRequest(new
            {
                hata = "Bu numarayla bugün zaten başvuru yapılmış.",
                ayrinti = "Aynı numarayla günde bir başvuru yapılabilir. "
                          + "Lütfen yarın tekrar deneyiniz."
            });
        }

        /* Kod, yönetim panelinden TXT ile yüklenen havuzdan alınır;
           sistem kendisi kod üretmez. Alınan kod havuzdan silinir, böylece
           aynı kod ikinci kez gönderilemez. Silme ve okuma tek deyimde
           (OUTPUT ile) yapılır: iki aday aynı anda kod isterse ikisine de
           aynı kodun verilmesi bu sayede engellenir. */
        var kod = db.ExecuteScalar<string>(@"
DELETE FROM KRY_KOD_HAVUZU
OUTPUT DELETED.kod
WHERE id = (
    SELECT TOP 1 id FROM KRY_KOD_HAVUZU WITH (UPDLOCK, READPAST)
    ORDER BY id)");

        if (string.IsNullOrWhiteSpace(kod))
        {
            _gunluk.Yaz("KOD HAVUZU BOŞ", adres, telefon);

            return StatusCode(503, new
            {
                hata = "Doğrulama kodu gönderilemiyor.",
                ayrinti = "Lütfen daha sonra tekrar deneyiniz."
            });
        }

        db.Execute(@"
INSERT INTO KRY_TELEFON_DOGRULAMA (telefon, kod, gecerlilik, gonderen_ip, havuz)
VALUES (@telefon, @kod, DATEADD(minute, 15, SYSDATETIME()), @adres, 1)",
            new { telefon, kod, adres });

        var sonuc = await sms.Gonder(telefon,
            $"Bicen Market basvuru dogrulama kodunuz: {kod}");

        if (!sonuc.Basarili)
        {
            _gunluk.Yaz("SMS GÖNDERİLEMEDİ", adres,
                $"{telefon} · {sonuc.Mesaj}");

            /* Kod adaya ulaşmadı: havuzdan boşa harcanmasın diye geri
               konur ve bekleyen doğrulama kaydı silinir. */
            db.Execute(@"
DELETE FROM KRY_TELEFON_DOGRULAMA
WHERE kod = @kod AND telefon = @telefon AND dogrulandi = 0;

IF NOT EXISTS (SELECT 1 FROM KRY_KOD_HAVUZU WHERE kod = @kod)
    INSERT INTO KRY_KOD_HAVUZU (kod, yukleyen) VALUES (@kod, N'iade');",
                new { kod, telefon });

            return StatusCode(502, new
            {
                hata = "Kod gönderilemedi.",
                ayrinti = "Lütfen numaranızı kontrol edip tekrar deneyiniz."
            });
        }

        return Ok(new
        {
            basarili = true,
            mesaj = "Doğrulama kodu telefonunuza gönderildi.",
            gecerlilikDakika = 15
        });
    }

    /// <summary>
    /// Kodu doğrular ve başvuruda kullanılacak jetonu döndürür.
    /// </summary>
    [HttpPost("KodDogrula")]
    [AllowAnonymous]
    public IActionResult KodDogrula([FromBody] KodDogrulaGirdi girdi)
    {
        var adres = IstemciAdresi.Bul(HttpContext);

        if (girdi is null ||
            string.IsNullOrWhiteSpace(girdi.Telefon) ||
            string.IsNullOrWhiteSpace(girdi.Kod))
        {
            return BadRequest(new { hata = "Telefon ve kod gereklidir." });
        }

        var telefon = new string(girdi.Telefon.Where(char.IsDigit).ToArray());

        if (telefon.StartsWith("90") && telefon.Length == 12)
            telefon = telefon[2..];

        if (telefon.StartsWith("0") && telefon.Length == 11)
            telefon = telefon[1..];

        /* Kod dört rakam iki harf; boşluk ve tire temizlenir, harfler
           büyütülür. Aday küçük yazsa da kabul edilir. */
        var kod = new string(girdi.Kod
            .Where(char.IsLetterOrDigit)
            .ToArray())
            .ToUpperInvariant();

        using var db = _vt.Baglanti();

        var kayit = db.QueryFirstOrDefault(@"
SELECT TOP 1 id AS id, kod AS kod, gecerlilik AS gecerlilik,
       dogrulandi AS dogrulandi, deneme AS deneme
FROM KRY_TELEFON_DOGRULAMA
WHERE telefon = @telefon
ORDER BY id DESC", new { telefon });

        if (kayit is null)
            return BadRequest(new { hata = "Önce kod isteyiniz." });

        if ((DateTime)kayit.gecerlilik < DateTime.Now)
            return BadRequest(new
            {
                hata = "Kodun süresi doldu.",
                ayrinti = "Yeni kod isteyiniz."
            });

        /* Deneme sınırı: kod tahmin edilerek geçilmesin */
        if ((int)kayit.deneme >= 5)
        {
            _gunluk.Yaz("KOD DENEME SINIRI", adres, telefon);

            return BadRequest(new
            {
                hata = "Çok fazla yanlış deneme yapıldı.",
                ayrinti = "Yeni kod isteyiniz."
            });
        }

        if ((string)kayit.kod != kod)
        {
            db.Execute(@"
UPDATE KRY_TELEFON_DOGRULAMA SET deneme = deneme + 1 WHERE id = @id",
                new { id = (int)kayit.id });

            _hiz.BasarisizKaydet();

            return BadRequest(new
            {
                hata = "Kod hatalı.",
                kalanDeneme = 4 - (int)kayit.deneme
            });
        }

        /* Doğrulandı; başvuruda kullanılacak jeton üretilir */
        var jeton = Convert.ToHexString(
            System.Security.Cryptography.RandomNumberGenerator.GetBytes(24));

        db.Execute(@"
UPDATE KRY_TELEFON_DOGRULAMA
SET dogrulandi = 1, dogrulanma = SYSDATETIME(), jeton = @jeton
WHERE id = @id", new { id = (int)kayit.id, jeton });

        return Ok(new { basarili = true, jeton });
    }


    /// <summary>Fotoğrafın özetini üretir; tekrar kullanımı yakalamak için.</summary>
    private static string FotografOzeti(JsonElement govde)
    {
        if (!govde.TryGetProperty("fotograf", out var foto) ||
            foto.ValueKind != JsonValueKind.Object ||
            !foto.TryGetProperty("base64", out var veri) ||
            veri.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        var metin = veri.GetString() ?? "";
        if (metin.Length < 100) return null;

        /* 'data:image/jpeg;base64,' öneki varsa ayrılır */
        var virgul = metin.IndexOf(',');
        if (virgul > 0 && virgul < 100) metin = metin[(virgul + 1)..];

        byte[] bayt;

        try
        {
            bayt = Convert.FromBase64String(metin);
        }
        catch
        {
            /* Çözülemezse metin üzerinden özet alınır */
            using var yedek = System.Security.Cryptography.SHA256.Create();

            return Convert.ToHexString(
                yedek.ComputeHash(System.Text.Encoding.UTF8.GetBytes(metin)));
        }

        return GoruntuOzeti(bayt);
    }

    /// <summary>
    /// Görüntü verisinin özetini üretir; meta veriyi yok sayar.
    ///
    /// <para>
    /// Otomatik gönderimlerde aynı fotoğraf her seferinde farklı bir JPEG
    /// yorumuyla gönderilerek dosya özeti değiştiriliyor. Piksel verisi
    /// aynı olduğu hâlde özet farklı çıkıyor ve tekrar denetimi işlemiyor.
    /// </para>
    ///
    /// <para>
    /// Bu yüzden yorum (FFFE) ve uygulama (FFE0-FFEF) bölümleri atlanır;
    /// yalnızca görüntüyü tanımlayan bölümler özetlenir. Böylece meta veri
    /// değişse de özet sabit kalır.
    /// </para>
    /// </summary>
    private static string GoruntuOzeti(byte[] bayt)
    {
        using var ozetleyici = System.Security.Cryptography.IncrementalHash
            .CreateHash(System.Security.Cryptography.HashAlgorithmName.SHA256);

        /* JPEG değilse ham veri özetlenir */
        if (bayt.Length < 4 || bayt[0] != 0xFF || bayt[1] != 0xD8)
        {
            ozetleyici.AppendData(bayt);
            return Convert.ToHexString(ozetleyici.GetHashAndReset());
        }

        var i = 2;

        while (i < bayt.Length - 1)
        {
            if (bayt[i] != 0xFF)
            {
                i++;
                continue;
            }

            var isaret = bayt[i + 1];

            /* Görüntü verisi başlangıcı; buradan sonrası tamamen özetlenir */
            if (isaret == 0xDA)
            {
                ozetleyici.AppendData(bayt, i, bayt.Length - i);
                break;
            }

            /* Uzunluk taşımayan işaretler */
            if (isaret is 0xD8 or 0xD9 || (isaret >= 0xD0 && isaret <= 0xD7))
            {
                i += 2;
                continue;
            }

            if (i + 4 > bayt.Length) break;

            var uzunluk = (bayt[i + 2] << 8) | bayt[i + 3];

            if (uzunluk < 2 || i + 2 + uzunluk > bayt.Length) break;

            /* Yorum ve uygulama bölümleri atlanır */
            var atla = isaret == 0xFE || (isaret >= 0xE0 && isaret <= 0xEF);

            if (!atla)
                ozetleyici.AppendData(bayt, i, 2 + uzunluk);

            i += 2 + uzunluk;
        }

        return Convert.ToHexString(ozetleyici.GetHashAndReset());
    }

    /// <summary>
    /// T.C. kimlik numarası doğrulaması.
    ///
    /// Resmî algoritma: 11 hane, ilk hane sıfır olamaz, 10. ve 11. haneler
    /// önceki hanelerden hesaplanan sağlama rakamlarıdır.
    /// </summary>
    private static bool KimlikGecerliMi(string kimlik)
    {
        var temiz = new string((kimlik ?? "").Where(char.IsDigit).ToArray());

        if (temiz.Length != 11 || temiz[0] == '0') return false;

        var h = temiz.Select(x => x - '0').ToArray();

        /* Aynı rakamın tekrarı (11111111110 gibi) kabul edilmez */
        if (h.Take(10).Distinct().Count() == 1) return false;

        var tek = h[0] + h[2] + h[4] + h[6] + h[8];
        var cift = h[1] + h[3] + h[5] + h[7];

        var onuncu = (tek * 7 - cift) % 10;
        if (onuncu < 0) onuncu += 10;

        if (onuncu != h[9]) return false;

        var toplam = h.Take(10).Sum();

        return toplam % 10 == h[10];
    }

    /// <summary>Cep telefonu biçimi denetimi</summary>
    private static bool TelefonGecerliMi(string telefon)
    {
        var temiz = new string((telefon ?? "").Where(char.IsDigit).ToArray());

        /* Başındaki 0 veya 90 atılır */
        if (temiz.StartsWith("90") && temiz.Length == 12) temiz = temiz[2..];
        if (temiz.StartsWith("0") && temiz.Length == 11) temiz = temiz[1..];

        /* Türkiye cep numaraları 5 ile başlar ve 10 hanedir */
        return temiz.Length == 10 && temiz[0] == '5';
    }

    /// <summary>İsteği yapan tarayıcı bilgisi (en fazla 300 karakter saklanır).</summary>
    /// <summary>
    /// Kaynak değerini ayarlardaki listeye göre doğrular.
    ///
    /// Listede olmayan değer kaydedilmiyor: form istemciden geldiği için
    /// elle değiştirilebiliyor ve rapor kırılımı uydurma değerlerle
    /// kirlenirdi.
    /// </summary>
    private string KaynakDogrula(string deger)
    {
        var gelen = (deger ?? "").Trim();

        if (gelen.Length == 0) return null;

        try
        {
            var liste = _ayar.FormOku()?.BasvuruKaynaklari ?? new List<string>();

            if (liste.Any(x => string.Equals(x?.Trim(), gelen, StringComparison.OrdinalIgnoreCase)))
                return gelen;

            /* "Diğer" her zaman geçerli: listede tanımlı olmasa da formda
               gösteriliyor ve açıklama alanı ona bağlı. */
            if (string.Equals(gelen, "Diğer", StringComparison.OrdinalIgnoreCase))
                return gelen;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kaynak listesi okunamadı");
        }

        return null;
    }

    private static string Kisalt(string deger, int enFazla)
    {
        var d = (deger ?? "").Trim();

        return d.Length == 0 ? null : d.Length <= enFazla ? d : d[..enFazla];
    }

    private string TarayiciBilgisi()
    {
        var deger = Request.Headers.UserAgent.ToString() ?? "";
        return deger.Length > 300 ? deger[..300] : deger;
    }

    private string Kullanici => User?.Identity?.Name ?? "sistem";
    private string KullaniciAdSoyad => User?.FindFirst("adSoyad")?.Value ?? Kullanici;
    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /// <summary>Bölge müdürü yalnızca kendi şubelerini görür.</summary>
    private bool SubeSiniri => Roller.SubeSiniri(Rol);

    private string[] YetkiliSubeler()
    {
        var ham = User?.FindFirst("subeler")?.Value ?? "";
        var liste = ham.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        // Şube tanımlanmamışsa hiçbir kayıt görünmesin
        return liste.Length > 0 ? liste : new[] { "__TANIMSIZ__" };
    }

    /// <summary>
    /// Sağ üstteki bölge seçicisinde seçilen bölgelerin şube kodları.
    /// Seçim yoksa null döner ve süzme uygulanmaz.
    /// </summary>
    private string[] SecilenBolgeSubeleri()
    {
        if (!Roller.BolgeSecici(Rol)) return null;

        var secim = Request.Headers["X-Bolge"].FirstOrDefault();

        if (string.IsNullOrWhiteSpace(secim)) return null;

        var bolgeAdlari = secim
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => Uri.UnescapeDataString(x.Trim()))
            .Where(x => x.Length > 0)
            .ToArray();

        if (bolgeAdlari.Length == 0) return null;

        var ayar = _ayar.FormOku();

        var kodlar = (ayar.Bolgeler ?? new List<BolgeTanimi>())
            .Where(b => bolgeAdlari.Contains(b.Ad, StringComparer.OrdinalIgnoreCase))
            .SelectMany(b => b.Subeler ?? new List<string>())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        /* Seçilen bölgede şube yoksa hiçbir kayıt dönmemeli */
        return kodlar.Length > 0 ? kodlar : new[] { "__TANIMSIZ__" };
    }

    /// <summary>Bölge seçimi etkin mi</summary>
    private bool BolgeSuzgeci => SecilenBolgeSubeleri() is not null;

    /// <summary>Süzmede kullanılacak şube listesi</summary>
    private string[] SuzmeSubeleri() =>
        SecilenBolgeSubeleri() ?? YetkiliSubeler();

    /// <summary>Şube süzmesi uygulanacak mı (yetki veya bölge seçimi)</summary>
    private bool SubeSuzmesi => SubeSiniri || BolgeSuzgeci;

    /// <summary>Durum değiştirme, işe alım ve rotasyon yetkisi</summary>
    /// <summary>
    /// Kayıt ekleyip değiştirebilir mi.
    ///
    /// Rol yetkilerinde "yalnızca görüntüleyebilir" işaretliyse koddaki
    /// izin geçersiz olur. Denetim burada tek noktada yapılır; panelde
    /// düğme gizlemek yeterli değil, istek doğrudan da gönderilebiliyor.
    /// </summary>
    private bool IslemYapabilir =>
        Roller.IslemYetkisi(Rol) && !_yetki.SaltOkunur(Rol);

    /// <summary>
    /// İK uzmanı yalnızca kendi şubelerine ait bildirimleri alır.
    /// Yöneticiler ve üstü tüm şubeleri görür.
    /// </summary>
    private bool UzmanSiniri => Rol == Roller.IK;

    /// <summary>Adayın kimlik bilgilerini görebilir mi</summary>
    private bool OzelVeriGorebilir => Roller.OzelVeriGorme(Rol);

    /// <summary>
    /// Kimlik numarası gibi özel alanları yetkisiz kullanıcıdan gizler.
    /// Tamamen silmek yerine son hanelerini gösterir; kayıt eşleştirme
    /// gerektiğinde işe yarar.
    /// </summary>
    private string OzelAlan(string deger)
    {
        if (OzelVeriGorebilir || string.IsNullOrWhiteSpace(deger)) return deger;

        var temiz = deger.Trim();

        return temiz.Length <= 4
            ? new string('*', temiz.Length)
            : new string('*', temiz.Length - 4) + temiz[^4..];
    }

    /* ====================================================================== */
    /* GENEL ERİŞİM                                                           */
    /* ====================================================================== */

    /// <summary>Aday formundan gelen başvuruyu kaydeder ve mail bildirimini yapar.</summary>
    [HttpPost("Kaydet")]
    [AllowAnonymous]
    public async Task<IActionResult> Kaydet([FromBody] JsonElement govde)
    {
        var json = govde.GetRawText();

        /* Aşırı büyük gönderiler veritabanını şişirir ve sunucuyu yorar.
           Fotoğrafla birlikte bir başvuru normalde 1 MB'ı geçmez. */
        if (json.Length > 4_000_000)
        {
            _gunluk.Yaz("BÜYÜK GÖNDERİ", IstemciAdresi.Bul(HttpContext),
                $"Boyut: {json.Length / 1024} KB");

            return BadRequest(new
            {
                hata = "Gönderdiğiniz veri çok büyük. Fotoğrafınızı küçültüp "
                     + "tekrar deneyiniz."
            });
        }

        string Al(string alan) =>
            govde.TryGetProperty(alan, out var d) && d.ValueKind == JsonValueKind.String
                ? d.GetString()
                : "";

        var basvuruNo = Al("basvuruNo");
        if (string.IsNullOrWhiteSpace(basvuruNo))
            basvuruNo = $"BSV-{DateTime.Now:yyyyMMdd}-{Random.Shared.Next(1000, 9999)}";

        var kimlik = Al("tcKimlikNo");
        var telefon = Al("cepTel1");

        if (string.IsNullOrWhiteSpace(kimlik) || string.IsNullOrWhiteSpace(telefon))
            return BadRequest(new { hata = "Kimlik numarası ve telefon zorunludur." });

        var adres = IstemciAdresi.Bul(HttpContext);

        /* Kısa sürede çok sayıda başarısız deneme varsa form geçici kapanır.
           Dağıtık bir saldırıda her istek farklı adresten gelir; adres bazlı
           sınır işe yaramaz, bu sayaç işe yarar. */
        if (_hiz.BasarisizYogunlugu(out var yogunlukSebebi))
        {
            _gunluk.Yaz("YOĞUNLUK", adres, "Başarısız istek eşiği aşıldı");
            return StatusCode(429, new { hata = yogunlukSebebi });
        }

        /* Başvurular yalnızca Türkiye'den kabul edilir.
           Ülke tespit edilemezse istek engellenmez; gerçek adayları
           kesmemek önceliklidir. */
        if (!await _ulke.IzinliMi(adres))
        {
            _hiz.BasarisizKaydet();

            return StatusCode(403, new
            {
                hata = "Başvurular yalnızca Türkiye'den kabul edilmektedir.",
                ayrinti = "Yurt dışındaysanız İnsan Kaynakları ile iletişime geçiniz."
            });
        }

        /* ---------------------------------------------- güvenlik doğrulaması

           Cloudflare Turnstile kaldırıldı. Gerçek adayları da engelliyordu:
           doğrulama yüklenmediğinde ya da takıldığında başvuru hiç
           gönderilemiyor, aday da sebebini anlamıyordu — İK'ya "form
           çalışmıyor" diye telefon geliyordu.

           Otomatik gönderimlere karşı kalan denetimler yerinde duruyor:
           istek hızı sınırı, ülke kısıtı, kimlik numarası algoritması,
           fotoğraf zorunluluğu ve aynı kimlikle tekrar başvuru engeli.
           Bunların hepsi aday tarafında görünmez çalışıyor. */

        /* Kimlik numarası algoritmaya uymuyorsa kayıt açılmaz.
           Otomatik gönderimlerde rastgele sayı kullanıldığı için bu kontrol
           sahte başvuruların büyük bölümünü daha en başta eler. */
        if (!KimlikGecerliMi(kimlik))
        {
            _gunluk.Yaz("GEÇERSİZ KİMLİK", IstemciAdresi.Bul(HttpContext),
                $"Kimlik: {kimlik}");

            _hiz.BasarisizKaydet();
            return BadRequest(new { hata = "Geçerli bir T.C. kimlik numarası giriniz." });
        }

        if (!TelefonGecerliMi(telefon))
        {
            _gunluk.Yaz("GEÇERSİZ TELEFON", IstemciAdresi.Bul(HttpContext),
                $"Telefon: {telefon}");

            return BadRequest(new { hata = "Geçerli bir cep telefonu numarası giriniz." });
        }

        /* Formdaki zorunlu alanlar sunucuda da denetlenir.
           Otomatik gönderimler formu kullanmadığı için buradaki kontroller
           tek gerçek engeldir. */
        var eksik = ZorunluAlanlariDenetle(govde);

        if (eksik is not null)
        {
            _gunluk.Yaz("EKSİK BAŞVURU", adres, eksik);
            _hiz.BasarisizKaydet();

            return BadRequest(new { hata = eksik });
        }

        /* Zorunlu referans (21.10.2026): pozisyona göre gereken sayıda
           ad soyad + telefonlu referans yoksa başvuru alınmaz. */
        var refHata = FormReferansDenetle(govde);
        if (refHata is not null) return BadRequest(new { hata = refHata });

        /* E-posta alanı: yalnızca izinli/engelli sağlayıcı denetimi.
           Doğrulama kodu gerektirmez; adres biçiminin geçerli olması ve
           kabul edilen bir sağlayıcıdan olması yeterlidir. */
        var epostaAdresi = (Al("email") ?? "").Trim().ToLowerInvariant();

        if (!string.IsNullOrWhiteSpace(epostaAdresi))
        {
            var epostaKarar = AlanKabulEdilir(epostaAdresi);

            if (!epostaKarar.Kabul)
            {
                _gunluk.Yaz("ALAN REDDİ", adres, epostaAdresi);
                return BadRequest(new { hata = epostaKarar.Sebep });
            }
        }

        /* Telefon doğrulaması: kod doğrulanmadan başvuru kaydedilmez.
           Jeton tek başvuru içindir; kullanıldıktan sonra geçersiz olur. */
        /* Formun ne kadar sürede doldurulduğu denetlenir. Bir insanın
           formu doldurması dakikalar sürer; saniyeler içinde gelen
           gönderimler otomatik araç işaretidir. Süre istemciden gelir ve
           taklit edilebilir, ama bunu taklit etmek için saldırganın formu
           incelemesi gerekir — basit gönderim araçlarını eler.

           Eşik appsettings.json → FormSuresi:EnAzSaniye ile ayarlanır;
           0 yazılırsa denetim kapanır. */
        var enAzSaniye = _yapilandirma.GetValue("FormSuresi:EnAzSaniye", 20);

        if (enAzSaniye > 0)
        {
            var acilisMetni = Al("formAcilisZamani");

            if (string.IsNullOrWhiteSpace(acilisMetni) ||
                !DateTime.TryParse(acilisMetni,
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.RoundtripKind,
                    out var acilis))
            {
                _gunluk.Yaz("FORM SÜRESİ YOK", adres, telefon);

                return BadRequest(new
                {
                    hata = "Başvuru alınamadı.",
                    ayrinti = "Lütfen sayfayı yenileyip formu yeniden doldurunuz."
                });
            }

            var gecenSaniye = (DateTime.UtcNow - acilis.ToUniversalTime()).TotalSeconds;

            if (gecenSaniye < enAzSaniye)
            {
                _gunluk.Yaz("FORM ÇOK HIZLI DOLDURULDU", adres,
                    $"{telefon} · {gecenSaniye:0} sn");

                return BadRequest(new
                {
                    hata = "Başvuru alınamadı.",
                    ayrinti = "Form beklenenden hızlı gönderildi. "
                              + "Lütfen bilgilerinizi kontrol edip tekrar deneyiniz."
                });
            }
        }

        if (TelefonDogrulamaAcik)
        {
            /* Adı 'jeton' olamaz: Turnstile jetonu aynı kapsamda tanımlı */
            var telefonJetonu = Al("dogrulamaJetonu");

            var telefonSade = new string(
                telefon.Where(char.IsDigit).ToArray());

            if (telefonSade.StartsWith("90") && telefonSade.Length == 12)
                telefonSade = telefonSade[2..];

            if (telefonSade.StartsWith("0") && telefonSade.Length == 11)
                telefonSade = telefonSade[1..];

            if (string.IsNullOrWhiteSpace(telefonJetonu))
            {
                return BadRequest(new
                {
                    hata = "SMS doğrulaması gerekiyor.",
                    ayrinti = "Lütfen telefonunuza gönderilen kodu giriniz.",
                    dogrulamaGerekli = true
                });
            }

            using var jetonDb = _vt.Baglanti();

            /* havuz = 1 koşulu: yalnızca yönetim panelinden yüklenen kod
               havuzundan çıkmış bir kodla yapılan doğrulama kabul edilir.
               Havuz sistemine geçmeden önce sistemin kendi ürettiği
               kodlarla doğrulanmış, henüz kullanılmamış kayıtlar varsa
               onlarla başvuru gönderilemez. */
            var dogrulama = jetonDb.QueryFirstOrDefault(@"
SELECT TOP 1 id AS id, telefon AS telefon, kullanildi AS kullanildi,
       dogrulanma AS dogrulanma
FROM KRY_TELEFON_DOGRULAMA
WHERE jeton = @jeton AND dogrulandi = 1 AND havuz = 1",
                new { jeton = telefonJetonu });

            if (dogrulama is null)
            {
                _gunluk.Yaz("GEÇERSİZ JETON", adres, $"{Al("adayAdSoyad")}");
                _hiz.BasarisizKaydet();

                return BadRequest(new
                {
                    hata = "Doğrulama geçersiz.",
                    ayrinti = "Lütfen kodu yeniden isteyiniz.",
                    dogrulamaGerekli = true
                });
            }

            if ((bool)dogrulama.kullanildi)
            {
                return BadRequest(new
                {
                    hata = "Bu doğrulama daha önce kullanılmış.",
                    ayrinti = "Yeni başvuru için kodu yeniden isteyiniz.",
                    dogrulamaGerekli = true
                });
            }

            /* Doğrulanan numarayla formdaki numara aynı olmalı */
            if ((string)dogrulama.telefon != telefonSade)
            {
                _gunluk.Yaz("JETON NUMARA UYUŞMAZLIĞI", adres,
                    $"Doğrulanan: {dogrulama.telefon}, formdaki: {telefonSade}");

                return BadRequest(new
                {
                    hata = "Doğrulanan numara ile form numarası farklı.",
                    dogrulamaGerekli = true
                });
            }

            /* Doğrulama üzerinden çok zaman geçmişse yenilenir */
            var gecen = DateTime.Now - (DateTime)dogrulama.dogrulanma;

            if (gecen.TotalHours > 3)
            {
                return BadRequest(new
                {
                    hata = "Doğrulamanın süresi doldu.",
                    ayrinti = "Lütfen kodu yeniden isteyiniz.",
                    dogrulamaGerekli = true
                });
            }

            /* Aynı numarayla günde tek başvuru. Kod isteme adımında da
               denetleniyor; burada tekrar bakılır çünkü aday kodu dünden
               almış ya da iki sekmede aynı anda göndermiş olabilir. */
            var bugunku = jetonDb.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BASVURULAR
WHERE telefon = @telefon
  AND CAST(olusturma AS DATE) = CAST(SYSDATETIME() AS DATE)",
                new { telefon = telefonSade });

            if (bugunku > 0)
            {
                return BadRequest(new
                {
                    hata = "Bu numarayla bugün zaten başvuru yapılmış.",
                    ayrinti = "Aynı numarayla günde bir başvuru yapılabilir."
                });
            }

            jetonDb.Execute(@"
UPDATE KRY_TELEFON_DOGRULAMA SET kullanildi = 1 WHERE id = @id",
                new { id = (int)dogrulama.id });
        }

        var fotoOzeti = FotografOzeti(govde);
        var formIzi = FormIzi(govde);
        var kimlikSade = Sadelestir(kimlik);

        /* İz denetimi KRY_IZ_GECMIS tablosundan yapılır, başvuru kaydından
           değil. Sahte başvurular silinse bile iz kalır; ayrıca kimlik
           biçimi ya da NULL değerler sonucu bozmaz. */
        using (var izDb = _vt.Baglanti())
        {
            /* ------------------------------------------------- fotoğraf */
            if (!string.IsNullOrWhiteSpace(fotoOzeti))
            {
                var karada = izDb.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_IZ_KARA_LISTE
WHERE tur = 'FOTOGRAF' AND iz = @iz", new { iz = fotoOzeti });

                /* Bu fotoğrafla daha önce başka kimlikler başvurmuş mu */
                var baskaKimlik = izDb.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_IZ_GECMIS
WHERE tur = 'FOTOGRAF' AND iz = @iz
  AND ISNULL(kimlik_no, '') <> @kimlik", new { iz = fotoOzeti, kimlik = kimlikSade });

                if (karada > 0 || baskaKimlik > 0)
                {
                    IzKaydet(izDb, "FOTOGRAF", fotoOzeti,
                        "Aynı fotoğraf farklı kimliklerle kullanıldı");

                    _gunluk.Yaz("TEKRAR FOTOĞRAF", adres,
                        $"Özet {fotoOzeti[..12]} · kara liste: {karada}, "
                        + $"önceki kimlik: {baskaKimlik}");

                    _hiz.BasarisizKaydet();

                    return BadRequest(new
                    {
                        hata = "Bu fotoğraf başka bir başvuruda kullanılmış.",
                        ayrinti = "Lütfen kendi fotoğrafınızı yükleyiniz."
                    });
                }
            }

            /* -------------------------------------------------- şablon */
            if (!string.IsNullOrWhiteSpace(formIzi))
            {
                var sablonKarada = izDb.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_IZ_KARA_LISTE
WHERE tur = 'SABLON' AND iz = @iz", new { iz = formIzi });

                var sablonKimlik = izDb.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_IZ_GECMIS
WHERE tur = 'SABLON' AND iz = @iz
  AND ISNULL(kimlik_no, '') <> @kimlik", new { iz = formIzi, kimlik = kimlikSade });

                if (sablonKarada > 0 || sablonKimlik >= 2)
                {
                    IzKaydet(izDb, "SABLON", formIzi,
                        "Aynı form şablonu farklı kimliklerle kullanıldı");

                    _gunluk.Yaz("ŞABLON TEKRARI", adres,
                        $"İz {formIzi[..12]} · kara liste: {sablonKarada}, "
                        + $"önceki kimlik: {sablonKimlik}");

                    _hiz.BasarisizKaydet();

                    return BadRequest(new
                    {
                        hata = "Başvurunuz alınamadı.",
                        ayrinti = "Lütfen İnsan Kaynakları ile iletişime geçiniz."
                    });
                }
            }
        }

        /* İstek başvuru sayfasından mı geliyor */
        var kaynakKarar = KaynakUygun();

        if (!kaynakKarar.Uygun)
        {
            var kaynakKarari = new YapayZekaServisi.Karar(
                false, "KAYNAK UYUŞMAZLIĞI", kaynakKarar.Sebep, 100, true);

            IncelemeyeAl(govde, json, adres, fotoOzeti, formIzi, kaynakKarari,
                basvuruNo, kimlik, telefon);

            _gunluk.Yaz("KAYNAK UYUŞMAZLIĞI", adres, kaynakKarar.Sebep);
            _hiz.BasarisizKaydet();

            return Ok(new
            {
                basarili = true,
                basvuruNo,
                mesaj = "Başvurunuz alınmıştır."
            });
        }

        /* Peş peşe gelen başvurular: eşik aşılmışsa korumalı kipe geçilir
           ve yeni başvurular doğrudan kayda geçmeyip incelemeye alınır. */
        var toplulukSonuc = _topluluk.Denetle(adres);

        if (toplulukSonuc.KorumaliKip)
        {
            var toplukarar = new YapayZekaServisi.Karar(
                false, "TOPLU GÖNDERİM",
                toplulukSonuc.Gerekce ?? "Kısa sürede çok sayıda başvuru", 100, true);

            IncelemeyeAl(govde, json, adres, fotoOzeti, formIzi, toplukarar,
                basvuruNo, kimlik, telefon);

            _gunluk.Yaz("KORUMALI KİP", adres,
                $"{Al("adayAdSoyad")} incelemeye alındı · {toplulukSonuc.Gerekce}");

            /* Aday hata görmez; gerçek bir başvuruysa İK aktarır */
            return Ok(new
            {
                basarili = true,
                basvuruNo,
                mesaj = "Başvurunuz alınmıştır."
            });
        }

        /* Fotoğrafın gerçek bir kişiye ait olup olmadığı görsel modelle
           incelenir. Reddedilen başvuru silinmez; incelemeye alınır. */
        /* KVKK (08.10.2026): başvuru yapay zekâya gönderilmiyor; ayrıntı
           YapayZekaServisi.BasvuruIncelemesiKapali. */
        if (!YapayZekaServisi.BasvuruIncelemesiKapali && _zeka.Etkin)
        {
            var fotoVerisi = govde.TryGetProperty("fotograf", out var fotoAlan) &&
                             fotoAlan.ValueKind == JsonValueKind.Object &&
                             fotoAlan.TryGetProperty("base64", out var b64Alan)
                ? b64Alan.GetString()
                : null;

            if (!string.IsNullOrWhiteSpace(fotoVerisi))
            {
                /* Fotoğraf tek başına yetmiyor; form verisiyle birlikte
                   incelenince tutarsızlıklar ortaya çıkıyor. */
                var karar = await _zeka.BasvuruIncele(fotoVerisi, FormOzeti(govde));

                if (karar.Denetlendi && !karar.Gecerli)
                {
                    IncelemeyeAl(govde, json, adres, fotoOzeti, formIzi, karar,
                        basvuruNo, kimlik, telefon);

                    _gunluk.Yaz("YAPAY ZEKÂ RET", adres,
                        $"{Al("adSoyad")} · {karar.Gerekce} (güven %{karar.Guven})");

                    _hiz.BasarisizKaydet();

                    /* Aday hata görmez: sahte başvuru sahibine hangi
                       denetime takıldığı bildirilmez. Gerçek bir aday
                       yanlışlıkla engellenirse İK panelden aktarır. */
                    return Ok(new
                    {
                        basarili = true,
                        basvuruNo,
                        mesaj = "Başvurunuz alınmıştır."
                    });
                }
            }
        }

        /* Bal küpü: formda gizli bir alan bulunur. Gerçek kullanıcı bu alanı
           göremez, otomatik araçlar ise doldurur. Doluysa istek sessizce
           başarılı sayılır ama kayıt oluşturulmaz. */
        if (!string.IsNullOrWhiteSpace(Al("form_alan_dogrula")))
        {
            /* Kayıt atılmaz, incelemeye alınır: gerçek bir tarayıcı
               eklentisi alanı doldurmuş olabilir ve gerçek adayı
               kaybetmek istemeyiz. Gönderene başarı mesajı döner. */
            var balKarar = new YapayZekaServisi.Karar(
                false, "BAL KÜPÜ",
                "Gizli alan doldurulmuş; insan kullanıcı bu alanı göremez",
                100, true);

            IncelemeyeAl(govde, json, adres, FotografOzeti(govde),
                FormIzi(govde), balKarar, basvuruNo, kimlik, telefon);

            _gunluk.Yaz("BAL KÜPÜ", adres,
                $"{Al("adayAdSoyad")} incelemeye alındı · {TarayiciBilgisi()}");

            _hiz.BasarisizKaydet();

            return Ok(new
            {
                basarili = true,
                basvuruNo,
                mesaj = "Başvurunuz alınmıştır."
            });
        }

        /* Kısa sürede çok sayıda başvuru gönderilmesi engellenir */
        if (!_hiz.KabulEdilir(adres, kimlik, out var redSebebi))
        {
            _gunluk.Yaz("HIZ SINIRI", adres,
                $"{redSebebi} Kimlik: {Sadelestir(kimlik)}");

            return StatusCode(429, new { hata = redSebebi });
        }

        var bolumler = govde.TryGetProperty("bolumler", out var b) && b.ValueKind == JsonValueKind.Array
            ? string.Join(", ", b.EnumerateArray().Select(x => x.GetString()))
            : "";

        using var db = _vt.Baglanti();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_BASVURULAR
    (basvuru_no, ad_soyad, kimlik_no, telefon, eposta, sube_kodu, sube_adi,
     bolumler, birim_turu, il, ilce, mahalle, durum, veri_json,
     kaynak, kaynak_detay,
     gonderen_ip, tarayici, fotograf_ozeti, form_izi, engel_var, fotograf_var)
VALUES
    (@no, @ad, @kimlik, @tel, @eposta, @subeKod, @subeAd, @bolumler,
     @birimTuru, @il, @ilce, @mahalle, @durum, @json,
     @kaynak, @kaynakDetay,
     @adres, @tarayici, @fotoOzeti, @formIzi, @engelVar, @fotografVar);

/* Tetikleyicisi olan tabloda OUTPUT ... INTO olmadan kullanilamaz;
   kimlik SCOPE_IDENTITY ile alinir. */
SELECT CAST(SCOPE_IDENTITY() AS INT);",
            new
            {
                no = basvuruNo,
                adres,
                fotoOzeti,
                formIzi,

                /* Adayın bizi nereden duyduğu. Seçenek listesi ayarlarda
                   tanımlı; listede olmayan bir değer gelirse kaydedilmiyor
                   ki rapor kırılımı uydurma değerlerle kirlenmesin. */
                kaynak = KaynakDogrula(Al("kaynak")),
                kaynakDetay = Kisalt(Al("kaynakDetay"), 300),
                /* Liste sorguları veri_json'a bakmasın diye bayraklar
                   girişte hesaplanır */
                engelVar = Al("engelDurumuVarMi").Trim()
                    .Equals("Evet", StringComparison.OrdinalIgnoreCase) ? 1 : 0,
                fotografVar = !string.IsNullOrWhiteSpace(fotoOzeti)
                              || json.Contains("base64", StringComparison.Ordinal) ? 1 : 0,
                tarayici = TarayiciBilgisi(),
                ad = Al("adayAdSoyad"),
                kimlik = Sadelestir(kimlik),
                tel = SonOnHane(telefon),
                eposta = Al("email"),
                subeKod = Al("subeKodu"),
                subeAd = Al("subeAdi"),
                bolumler,
                birimTuru = Al("birimTuru"),
                il = Al("il"),
                ilce = Al("ilce"),
                mahalle = Al("mahalle"),
                durum = Durumlar.Yeni,
                json
            });

        /* İzler ayrı tabloya yazılır; başvuru silinse bile denetim sürer.
           Yazma başarısız olsa da başvuru kaydı korunur. */
        try
        {
            if (!string.IsNullOrWhiteSpace(fotoOzeti))
                IzGecmisiYaz(db, "FOTOGRAF", fotoOzeti, kimlikSade);

            if (!string.IsNullOrWhiteSpace(formIzi))
                IzGecmisiYaz(db, "SABLON", formIzi, kimlikSade);
        }
        catch (Exception hata)
        {
            _gunluk.Yaz("İZ YAZILAMADI", adres, hata.Message);
        }

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new
            {
                id,
                durum = Durumlar.Yeni,
                aciklama = "Başvuru alındı.",
                kullanici = "aday"
            });

        // Kabul edilen başvuru hız sınırı sayaçlarına işlenir
        _hiz.Kaydet(adres, kimlik);

        var gonderildi = await _mail.BasvuruBildirAsync(json, basvuruNo);
        if (gonderildi)
        {
            db.Execute("UPDATE KRY_BASVURULAR SET mail_gonderildi = 1 WHERE id = @id", new { id });
        }
        else if (!string.IsNullOrWhiteSpace(_mail.SonHataMesaji))
        {
            // Başvuru kaydı tamamlanmıştır; mail hatası kayda düşülür,
            // İK panelinden tekrar gönderilebilir.
            db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, 'sistem')",
                new
                {
                    id,
                    durum = Durumlar.Yeni,
                    aciklama = $"Bildirim maili gönderilemedi: {_mail.SonHataMesaji}"
                });
        }

        var adayEposta = Al("email");
        if (!string.IsNullOrWhiteSpace(adayEposta))
        {
            await _mail.AdayaBilgiAsync(
                adayEposta, Al("adayAdSoyad"), basvuruNo, Al("subeAdi"), bolumler);
        }

        return Ok(new { id, basvuruNo, mailGonderildi = gonderildi });
    }

    /// <summary>Aday kendi başvurularını kimlik no ve telefon ile sorgular.</summary>
    [HttpPost("Sorgula")]
    [AllowAnonymous]
    public IActionResult Sorgula([FromBody] SorgulaGirdi girdi)
    {
        if (girdi is null ||
            string.IsNullOrWhiteSpace(girdi.KimlikNo) ||
            string.IsNullOrWhiteSpace(girdi.Telefon))
        {
            return BadRequest(new { hata = "Kimlik numarası ve telefon zorunludur." });
        }

        /* Deneme yanılmayla başkalarının başvurusuna ulaşılmasını önler */
        var sorguAdres = IstemciAdresi.Bul(HttpContext);

        if (!_hiz.SorgulamaKabulEdilir(sorguAdres, out var sorguRed))
        {
            _gunluk.Yaz("SORGULAMA SINIRI", sorguAdres,
                $"Kimlik: {girdi.KimlikNo}");

            return StatusCode(429, new { hata = sorguRed });
        }

        using var db = _vt.Baglanti();

        var kayitlar = db.Query<string>(@"
SELECT veri_json FROM KRY_BASVURULAR
WHERE kimlik_no = @kimlik AND telefon = @tel
ORDER BY id DESC",
            new
            {
                kimlik = Sadelestir(girdi.KimlikNo),
                tel = SonOnHane(girdi.Telefon)
            }).ToList();

        var liste = kayitlar
            .Select(x => JsonSerializer.Deserialize<JsonElement>(x))
            .ToList();

        return Ok(liste);
    }

    /* ====================================================================== */
    /* İK / ADMİN                                                             */
    /* ====================================================================== */

    [HttpGet("Liste")]
    [Authorize]
    public IActionResult Liste(
        [FromQuery] string durum = null,
        /// <summary>Birden fazla birim virgülle ayrılarak verilebilir</summary>
        [FromQuery] string subeKodu = null,
        [FromQuery] string ilce = null,
        [FromQuery] string mahalle = null,
        [FromQuery] string bolum = null,
        [FromQuery] string birimTuru = null,
        [FromQuery] string arama = null,
        [FromQuery] bool arsiv = false,
        [FromQuery] int sayfa = 1,
        [FromQuery] int adet = 20,
        /// <summary>Aynı adayın eski başvuruları da ayrı satır olarak gelsin mi?</summary>
        [FromQuery] bool tekrarlariGoster = false,
        /// <summary>İK uzmanı kullanıcı adı: yalnızca ona tanımlı şubeler</summary>
        [FromQuery] string uzman = null,
        /// <summary>
        /// Başvuru tarihi aralığı. Verildiğinde durum gizleme kuralı
        /// kalkar: o tarihlerdeki BÜTÜN başvurular (sonuçlananlar dahil)
        /// listelenir; aralıkta ne olduğunu görmek için kullanılır.
        /// </summary>
        [FromQuery] DateTime? tarihBas = null,
        [FromQuery] DateTime? tarihBit = null,
        /// <summary>Yalnızca 7 günden uzun süredir bekleyen başvurular</summary>
        [FromQuery] bool gecikmis = false,
        /// <summary>Yalnızca bildirim maili gönderilememiş başvurular</summary>
        [FromQuery] bool mailGitmedi = false,
        /// <summary>Yalnızca daha önce Biçen'de çalışıp ayrılmış adaylar</summary>
        [FromQuery] bool eskiCalisan = false)
    {
        if (sayfa < 1) sayfa = 1;
        // Sınır dışı değerlerde en yakın geçerli değere çekilir
        if (adet < 1) adet = 25;
        if (adet > 1000) adet = 1000;

        using var db = _vt.Baglanti();

        var subeKodlari = (subeKodu ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToArray();

        /* Uzman süzgeci: seçilen kullanıcıya tanımlı şubelerle sınırlar.
           Kullanıcı hakkı şube kodu olarak tutulur. */
        var uzmanSubeleri = UzmanSubeleri(db, uzman);

        /* "Daha önce çalışmış" süzgeci: ekrandaki "Eski çalışan" rozetiyle
           aynı kural (Mikro'da çıkışı yapılmış kaydı olan kimlik). Personel
           kaynağı yalnızca süzgeç seçiliyken okunur. Kimlik sayısı SQL
           parametre sınırını aşabildiği için tek metin olarak gönderilip
           sunucuda virgüllü listede aranır. */
        var eskiKimlikler = "";

        if (eskiCalisan)
        {
            try
            {
                eskiKimlikler = string.Join(",", _personelKaynak.TumPersonelleriGetir()
                    .Where(x => x.Durum != 1 && !string.IsNullOrWhiteSpace(x.KimlikNo))
                    .Select(x => x.KimlikNo.Trim())
                    .Distinct());
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Eski çalışan süzgeci için personel okunamadı");
                return StatusCode(502, new
                {
                    hata = "Personel kayıtlarına ulaşılamadı; \"Daha önce çalışmış\" süzgeci şu an uygulanamıyor."
                });
            }
        }

        // Durum filtresi seçilmemişse sonuçlanmış başvurular listede
        // gösterilmez: Olumlu olanlar Havuz ekranında, Olumsuz olanlar ise
        // durum filtresinden seçilerek görüntülenir.
        //
        // ARAMA YAPILDIĞINDA bu gizleme uygulanmaz. Aranan kişi olumsuz ya
        // da işe alınmış olabilir; arama kutusuna ad yazan kullanıcı o kaydı
        // bulmayı bekler, "durum filtresini de seç" demek zorunda kalmamalı.
        var kosul = @"
WHERE (@durum   IS NULL OR durum = @durum)
  AND (@durum   IS NOT NULL OR @arama IS NOT NULL OR @tarihBas IS NOT NULL OR
       durum NOT IN (N'Olumlu', N'İşe Alındı', N'Olumsuz'))
  /* Tarih aralığı: başvuru tarihi gün bazında */
  AND (@tarihBas IS NULL OR olusturma >= @tarihBas)
  AND (@tarihBit IS NULL OR olusturma < @tarihBit)
  /* Arşivlenenler listede görünmez; kayıt korunur */
  AND (@arsiv = 1 OR ISNULL(arsiv, 0) = 0)
  AND (@subeVar = 0 OR sube_kodu IN @subeKodlari)
  /* Aynı kimlik numarasıyla yapılmış eski başvurular listeyi doldurmasın;
     yalnızca en yeni kayıt gösterilir. */
  AND (@tekrarlar = 1 OR kimlik_no IS NULL OR id = " + BasvuruTabani.TemsilciId("KRY_BASVURULAR") + @")
  AND (@ilce    IS NULL OR ilce = @ilce)
  AND (@mahalle IS NULL OR mahalle = @mahalle)
  AND (@bolum   IS NULL OR bolumler LIKE @bolumKalip)
  AND (@birimTuru IS NULL OR ISNULL(birim_turu, N'Şube') = @birimTuru)
  AND (@subeSiniri = 0 OR sube_kodu IN @yetkiliSubeler)
  /* Uzman süzgeci: seçilen uzmana tanımlı şubeler. Kullanıcı hakkında
     şube KODU tutuluyor; ad ile karşılaştırmak hiçbir kaydı eşleştirmez. */
  AND (@uzmanSiniri = 0 OR sube_kodu IN @uzmanSubeleri)
  /* Hızlı süzgeçler (liste üstündeki çipler) */
  AND (@gecikmis = 0 OR DATEDIFF(day, olusturma, SYSDATETIME()) > 7)
  AND (@mailGitmedi = 0 OR ISNULL(mail_gonderildi, 0) = 0)
  /* STRING_SPLIT kullanılmıyor: veritabanı uyumluluk düzeyi 130'un
     altında (Invalid object name STRING_SPLIT, 02.10.2026).
     Virgüllü listede virgül-kimlik-virgül araması her sürümde çalışıyor. */
  AND (@eskiCalisan = 0 OR LTRIM(RTRIM(ISNULL(kimlik_no, ''))) <> ''
       AND CHARINDEX(N',' + LTRIM(RTRIM(kimlik_no)) + N',', N',' + @eskiKimlikler + N',') > 0)
  /* Arama yalnızca adayı tanımlayan alanlarda yapılır. Form verisinin
     tamamı (veri_json) taranmaz: aranan kelime referans adı, eski işyeri
     ya da bir e-posta adresinin içinde geçtiğinde alakasız başvurular
     çıkıyordu. */
  AND (@arama   IS NULL OR ad_soyad LIKE @kalip OR kimlik_no LIKE @kalip
       OR telefon LIKE @kalip OR basvuru_no LIKE @kalip
       OR eposta LIKE @kalip
       OR bolumler LIKE @kalip OR sube_adi LIKE @kalip
       OR mahalle LIKE @kalip OR ilce LIKE @kalip)";

        var parametre = new
        {
            uzmanSiniri = uzmanSubeleri.Length > 0 ? 1 : 0,
            uzmanSubeleri = uzmanSubeleri.Length > 0
                ? uzmanSubeleri
                : new[] { "__yok__" },
            durum = string.IsNullOrWhiteSpace(durum) ? null : durum,
            tarihBas = tarihBas?.Date,
            /* Bitiş günü dahil: ertesi günün başına kadar */
            tarihBit = tarihBit?.Date.AddDays(1),
            subeVar = subeKodlari.Length > 0 ? 1 : 0,
            subeKodlari = subeKodlari.Length > 0 ? subeKodlari : new[] { "__YOK__" },
            tekrarlar = tekrarlariGoster ? 1 : 0,
            ilce = string.IsNullOrWhiteSpace(ilce) ? null : ilce,
            mahalle = string.IsNullOrWhiteSpace(mahalle) ? null : mahalle,
            bolum = string.IsNullOrWhiteSpace(bolum) ? null : bolum,
            bolumKalip = $"%{bolum}%",
            birimTuru = string.IsNullOrWhiteSpace(birimTuru) ? null : birimTuru,
            subeSiniri = SubeSuzmesi ? 1 : 0,
            yetkiliSubeler = SuzmeSubeleri(),
            arama = string.IsNullOrWhiteSpace(arama) ? null : arama,
            kalip = $"%{arama}%",
            arsiv = arsiv ? 1 : 0,
            gecikmis = gecikmis ? 1 : 0,
            mailGitmedi = mailGitmedi ? 1 : 0,
            eskiCalisan = eskiCalisan ? 1 : 0,
            eskiKimlikler,
            atla = (sayfa - 1) * adet,
            adet
        };

        var toplam = db.ExecuteScalar<int>($"SELECT COUNT(*) FROM KRY_BASVURULAR {kosul}", parametre);

        var kayitlar = db.Query<BasvuruOzet>($@"
SELECT id, basvuru_no AS BasvuruNo, ad_soyad AS AdSoyad, kimlik_no AS KimlikNo,
       telefon AS Telefon, eposta AS Eposta, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       bolumler AS Bolumler, birim_turu AS BirimTuru,
       il AS Il, ilce AS Ilce, mahalle AS Mahalle,
       /* Adayın başvuruya nasıl yöneldiği; ayrıntıda gösteriliyor */
       kaynak AS Kaynak, kaynak_detay AS KaynakDetay,
       durum AS Durum, degerlendirme_notu AS DegerlendirmeNotu,
       kaynak AS Kaynak, kaynak_detay AS KaynakDetay,
       /* Havuzdan döndü rozeti: çıkış tarihi dolu ve durum artık Olumlu değil */
       CASE WHEN havuz_cikis_tarih IS NOT NULL AND durum <> N'Olumlu'
            THEN havuz_cikis_tarih END AS HavuzdanDonusTarihi,
       CASE WHEN havuz_cikis_tarih IS NOT NULL AND durum <> N'Olumlu'
            THEN havuz_cikis_not END AS HavuzdanDonusNotu,
       CASE WHEN havuz_cikis_tarih IS NOT NULL AND durum <> N'Olumlu'
            THEN havuz_cikaran END AS HavuzdanCikaran,
       gorusme_tarihi AS GorusmeTarihi, gorusme_yeri AS GorusmeYeri,
       ise_giris_tarihi AS IseGirisTarihi, ise_giris_bolum AS IseGirisBolum,
       doldurma_gun AS DoldurmaGun, doldurma_dakika AS DoldurmaDakika,
       gonderen_ip AS GonderenIp, tarayici AS Tarayici,
       anlasilan_ucret AS AnlasilanUcret, yol_ucreti AS YolUcreti,
       olusturma AS Olusturma, guncelleme AS Guncelleme, guncelleyen AS Guncelleyen,
       mail_gonderildi AS MailGonderildi, test_kaydi AS TestKaydi,
       /* Fotoğraf ve engel bayrakları kayıt girişinde yazılır, eski
          kayıtlar arka planda tamamlanır. veri_json listede okunmaz:
          fotoğrafın base64'ünü taşıdığı için satır başına yüzlerce KB. */
       ISNULL(fotograf_var,
              CASE WHEN fotograf_ozeti IS NOT NULL THEN 1 ELSE 0 END) AS FotografVar,
       ISNULL(engel_var, 0) AS EngelVar,
       (SELECT COUNT(*) FROM KRY_BASVURU_NOT n WHERE n.basvuru_id = KRY_BASVURULAR.id)
           AS NotSayisi,
       (SELECT COUNT(*) FROM KRY_BASVURULAR o
         WHERE o.kimlik_no = KRY_BASVURULAR.kimlik_no AND o.id <> KRY_BASVURULAR.id)
           AS OncekiBasvuruSayisi,
       JSON_VALUE(veri_json, '$.talepEdilenNetUcret')                 AS TalepUcret,
       DATEDIFF(day, olusturma, SYSDATETIME())                        AS BekleyenGun,
       (SELECT TOP 1 r.puan FROM KRY_REFERANS r
         WHERE r.basvuru_id = KRY_BASVURULAR.id AND r.puan IS NOT NULL
         ORDER BY r.olusturma DESC)                                   AS ReferansPuani,
       /* Mevcut duruma ne zaman geçildiği: son durum işlemi esas alınır */
       DATEDIFF(day, ISNULL((
           SELECT MAX(h.tarih) FROM KRY_BASVURU_HAREKET h
           WHERE h.basvuru_id = KRY_BASVURULAR.id AND h.durum = KRY_BASVURULAR.durum
       ), olusturma), SYSDATETIME())                                   AS DurumGun,
       DATEDIFF(day, ISNULL(guncelleme, olusturma), SYSDATETIME())    AS IslemsizGun
FROM KRY_BASVURULAR
{kosul}
ORDER BY id DESC
OFFSET @atla ROWS FETCH NEXT @adet ROWS ONLY", parametre).ToList();

        /* Hâlihazırda çalışan adaylar işaretlenir. Eşleştirme kimlik
           numarasıyla ve MASKELEMEDEN ÖNCE yapılır; maskelenmiş numara
           eşleşmezdi. */
        CalisanlariIsaretle(kayitlar);

        /* Açık norm kadro pozisyonlarına uygunluk */
        OnerileriIsaretle(db, kayitlar);

        /* İşe alındı işaretli ama Mikro'da aktif kaydı olmayanlar:
           girişi yapılmamış demektir. CalisanlariIsaretle zaten aktif
           personelle eşleştirdiği için burada ek sorgu gerekmiyor. */
        foreach (var k in kayitlar)
        {
            /* Ayrılmış olanlar ayrı rozet alıyor; ikisini tek rozette
               toplamak İK'yı olmayan bir işi aramaya itiyordu. */
            if (k.Durum == Durumlar.IseAlindi && !k.CalisiyorMu && !k.MikrodaAyrildi)
                k.MikroBekliyor = true;
        }

        /* Yetkisi olmayan kullanıcılarda kimlik numarası maskelenir */
        if (!OzelVeriGorebilir)
        {
            foreach (var kayit in kayitlar)
                kayit.KimlikNo = OzelAlan(kayit.KimlikNo);
        }

        return Ok(new { toplam, sayfa, adet, kayitlar });
    }

    /// <summary>
    /// Bir İK uzmanına tanımlı şube adları.
    ///
    /// Yönetim - Kullanicilar ekranındaki şube hakkından okunur; boşsa
    /// süzme uygulanmaz (uzmanın tüm şubeleri görmesi kastedilmiştir).
    /// </summary>
    private string[] UzmanSubeleri(System.Data.IDbConnection db, string kullanici)
    {
        /* Birden çok uzman seçilebilir; şubeleri birleştirilir.
        
           Oturumu açan kişi İK uzmanıysa KENDİ şubeleri her zaman
           listeye girer: uzman önce kendi verisini görmeli, seçtiği
           uzmanlarınki bunun üzerine eklenmeli. */
        var kodlar = (kullanici ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToList();

        var kendiKapsami = Rol is Roller.IK or Roller.IKYoneticisi;

        if (kendiKapsami && !kodlar.Contains(Kullanici, StringComparer.OrdinalIgnoreCase))
            kodlar.Add(Kullanici);

        if (kodlar.Count == 0) return Array.Empty<string>();

        var tanimlar = db.Query<string>(
            "SELECT subeler FROM KRY_KULLANICILAR WHERE kullanici_adi IN @k",
            new { k = kodlar }).ToList();

        var subeler = tanimlar
            .SelectMany(x => (x ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        /* Uzmanın şubesi tanımlı değilse kısıt uygulanmaz; aksi hâlde
           tanım yapılana kadar hiçbir başvuru göremezdi. */
        return subeler;
    }

    /// <summary>
    /// Adayın başvurduğu pozisyonlarda açık kadro var mı.
    ///
    /// <para>
    /// Kapsam yalnızca öneri grubuyla belirlenir; grupta olmayan şube
    /// yalnızca kendi açığıyla eşleşir (13.10.2026, başka bölgeden öneri
    /// gelmesin). Adayın başvurduğu şubenin kapsamındaki mağazalarda o
    /// pozisyon eksikse rozet gösterilir.
    /// </para>
    /// </summary>
    private void OnerileriIsaretle(System.Data.IDbConnection db, List<BasvuruOzet> kayitlar)
    {
        if (kayitlar.Count == 0) return;

        try
        {
            var acik = db.Query(@"
SELECT sube_kodu AS subeKodu, sube_adi AS subeAdi, bolum,
       ISNULL(norm, 0) - ISNULL(mevcut, 0) AS eksik
FROM KRY_KADRO
WHERE aktif = 1 AND ISNULL(mevcut, 0) < ISNULL(norm, 0)").ToList();

            if (acik.Count == 0) return;

            var ayar = _ayar.FormOku();
            var gruplar = ayar.OneriGruplari ?? new List<OneriGrubu>();
            var bolgeler = ayar.Bolgeler ?? new List<BolgeTanimi>();

            string Kapsam(string subeKodu)
            {
                var kod = (subeKodu ?? "").Trim();

                var g = gruplar.FirstOrDefault(x => (x.Subeler ?? new List<string>())
                    .Any(y => string.Equals(y?.Trim(), kod, StringComparison.OrdinalIgnoreCase)));

                /* Yalnızca öneri grubu (13.10.2026): gruba alınmamış şube
                   yalnızca kendisiyle eşleşir, bölgeye düşülmez. */
                return g is not null ? "G:" + g.Ad : "S:" + kod.ToUpperInvariant();
            }

            foreach (var k in kayitlar)
            {
                var bolumler = (k.Bolumler ?? "")
                    .Split(',', StringSplitOptions.RemoveEmptyEntries)
                    .Select(x => x.Trim())
                    .Where(x => x.Length > 0)
                    .ToList();

                if (bolumler.Count == 0) continue;

                var kapsam = Kapsam(k.SubeKodu);

                var uyanlar = acik
                    .Where(a => Kapsam((string)a.subeKodu) == kapsam)
                    .Where(a => bolumler.Any(b => string.Equals(b, (string)a.bolum,
                                                  StringComparison.OrdinalIgnoreCase)))
                    .ToList();

                if (uyanlar.Count == 0) continue;

                k.OneriVar = true;

                k.OneriMetni = string.Join(" · ", uyanlar
                    .Take(3)
                    .Select(a => $"{a.subeAdi}: {a.bolum}"))
                    + (uyanlar.Count > 3 ? $" · +{uyanlar.Count - 3}" : "");
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Öneri işaretlemesi yapılamadı");
        }
    }

    /// <summary>
    /// Başvuru listesindeki adaylardan hangileri şu an çalışıyor.
    ///
    /// Mikro'daki personel kayıtları kimlik numarasıyla eşleştirilir.
    /// Personel kaynağına ulaşılamazsa liste yine döner; rozet gösterilmez.
    /// </summary>
    /// <summary>
    /// Çıkış tarihi dolu mu.
    ///
    /// Mikro boş tarihi 1899-12-30 ya da 1899-12-31 olarak yazıyor;
    /// null denetimi tek başına yetmiyor.
    /// </summary>
    private static bool Aktif(object cikis) =>
        cikis is not DateTime t || t.Year <= 1950;

    private void CalisanlariIsaretle(List<BasvuruOzet> kayitlar)
    {
        if (kayitlar.Count == 0) return;

        /* Yalnızca bu sayfadaki adayların kimlikleri sorulur. Önceden tüm
           personel listesi (860 kayıt, birkaç meta sorgu) her istekte
           yeniden çekiliyordu; ilk çağrıda yavaş kalıp zaman aşımına
           düşüyor ve rozetler ancak ikinci istekte görünüyordu. */
        var kimlikler = kayitlar
            .Select(x => new string((x.KimlikNo ?? "").Where(char.IsDigit).ToArray()))
            .Where(x => x.Length == 11)
            .Distinct()
            .ToList();

        if (kimlikler.Count == 0) return;

        try
        {
            using var pdb = _vt.PersonelBaglantisi();

            var calisanlar = pdb.Query(@"
SELECT LTRIM(RTRIM(P.Per_TcKimlikNo)) AS kimlik,
       LTRIM(RTRIM(P.per_kod)) AS kod,
       PIG.ig_adi        AS sube,
       PUT.un_aciklama   AS unvan,
       P.per_cikis_tar   AS cikis,
       P.per_cikis_neden AS cikisNeden
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    /* Dış birleştirme: iş grubu kodu tanım tablosunda bulunmayan ya da
       boş olan personel iç birleştirmede tamamen düşüyor ve girişi
       yapılmış olmasına rağmen 'Mikro girişi yok' görünüyordu. Şube adı
       gelmese de kişinin kayıtlı olduğu bilgisi doğru. */
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
    LEFT JOIN PERSONEL_UNVAN_TANIMLARI PUT ON P.per_unvan_kodu = PUT.un_kod
WHERE LTRIM(RTRIM(P.Per_TcKimlikNo)) IN @kimlikler",
                new { kimlikler }, commandTimeout: 30)
                .GroupBy(x => (string)x.kimlik)

                /* Aynı kişinin birden çok kaydı olabiliyor (yeniden işe
                   alım). Aktif olan öne alınıyor; hepsi kapalıysa en son
                   çıkan esas alınıyor. */
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderByDescending(x => Aktif(x.cikis))
                          .ThenByDescending(x => (DateTime?)x.cikis)
                          .First());

            foreach (var k in kayitlar)
            {
                var kimlik = new string((k.KimlikNo ?? "").Where(char.IsDigit).ToArray());

                if (!calisanlar.TryGetValue(kimlik, out var kisi)) continue;

                /* 26.10.2026: başvuru detayından personel kartı açılabilsin
                   (eski ya da şu an çalışan) */
                k.PersonelKodu = (string)kisi.kod;

                if (Aktif(kisi.cikis))
                {
                    k.CalisiyorMu = true;

                    /* Şube ve ünvan yalnızca aktif kayıtta yazılıyor:
                       ayrılmış kişinin eski şubesini göstermek hâlâ orada
                       çalıştığı izlenimi veriyordu. */
                    k.CalistigiSube = (string)kisi.sube;
                    k.CalistigiUnvan = (string)kisi.unvan;
                }
                else if (k.Durum == Durumlar.IseAlindi)
                {
                    /* Yalnızca işe alınmış başvurularda: kaydı var ama
                       çıkışı yapılmış demek. "Girişi yapılmamış" demek
                       yanlış olurdu ve İK boşuna Mikro'da giriş arıyordu.

                       Başka durumlardaki başvurularda gösterilmiyor;
                       daha önce çalışıp yeniden başvuran adayı zaten
                       "Eski çalışan" rozeti anlatıyor ve iki rozet aynı
                       şeyi söyleyip satırı kalabalıklaştırıyordu. */
                    k.MikrodaAyrildi = true;
                    k.MikroCikisTarihi = (DateTime?)kisi.cikis;
                    k.MikroCikisNedeni = ((string)kisi.cikisNeden ?? "").Trim();
                }
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Çalışan eşleştirmesi yapılamadı");
        }
    }

    [HttpGet("Ozet")]
    [Authorize]
    public IActionResult Ozet(
        [FromQuery] string uzman = null,
        /// <summary>Listeyle aynı tarih aralığı; kartlar da ona göre sayılır</summary>
        [FromQuery] DateTime? tarihBas = null,
        [FromQuery] DateTime? tarihBit = null)
    {
        using var db = _vt.Baglanti();

        /* Uzman seçiliyse kartlar da onun şubeleriyle sınırlanır; liste
           süzülüp sayaçlar tüm şirketi göstermeye devam ederse ekran
           kendi içinde çelişir. */
        var uzmanSubeleri = UzmanSubeleri(db, uzman);

        /* Kartlar, liste ile aynı tabanı saymalı. Liste arşivlenenleri
           gizler ve aynı kimlik numarasıyla yapılmış eski başvuruları
           düşürüp yalnızca en yenisini gösterir; kartlar bütün satırları
           sayınca "Yeni 21 yazıyor, listede 14 var" oluyordu. */
        var uzmanSuz = uzmanSubeleri.Length > 0 ? " AND b.sube_kodu IN @subeler" : "";

        /* Taban kuralı BasvuruTabani'nda; Raporlar sayfası da aynısını
           kullanıyor (03.10.2026). */
        var taban = $@"
FROM KRY_BASVURULAR b
WHERE {BasvuruTabani.Kosul("b")}{uzmanSuz}
  AND (@tarihBas IS NULL OR b.olusturma >= @tarihBas)
  AND (@tarihBit IS NULL OR b.olusturma < @tarihBit)";

        var p = new
        {
            subeler = uzmanSubeleri,
            tarihBas = tarihBas?.Date,
            tarihBit = tarihBit?.Date.AddDays(1)
        };

        var durumlar = db.Query<DurumSayisi>($@"
SELECT b.durum AS Durum, COUNT(*) AS Adet
{taban}
GROUP BY b.durum", p).ToList();

        var bugun = db.ExecuteScalar<int>($@"
SELECT COUNT(*)
{taban}
  AND CAST(b.olusturma AS DATE) = CAST(SYSDATETIME() AS DATE)", p);

        /* Toplam, durum sayılarının toplamıdır; ayrı sayılırsa şerit
           parçaları toplamı tutmaz */
        var toplam = durumlar.Sum(x => x.Adet);

        /* Süreçteki durumlarda 7 günden uzun süredir aynı durumda bekleyenler
           ("gecikmiş"). Listedeki "N gündür bu durumda" bilgisiyle aynı
           hesap: son durum işlemi, yoksa başvuru tarihi. Yalnızca süreçteki
           (sonuçlanmamış) kayıtlar için hesaplanır; sayıları az. */
        var gecikmisler = db.Query<DurumSayisi>($@"
SELECT b.durum AS Durum, COUNT(*) AS Adet
{taban}
  AND b.durum NOT IN (N'Olumlu', N'İşe Alındı', N'Olumsuz')
  AND DATEDIFF(day, ISNULL((
        SELECT MAX(h.tarih) FROM KRY_BASVURU_HAREKET h
        WHERE h.basvuru_id = b.id AND h.durum = b.durum
      ), b.olusturma), SYSDATETIME()) > 7
GROUP BY b.durum", p).ToList();

        /* Süreçte olup başvurusunun üzerinden 7 günden fazla geçenler;
           listedeki "7+ gün bekleyen" süzgeciyle aynı kural. */
        var uzunBekleyen = db.ExecuteScalar<int>($@"
SELECT COUNT(*)
{taban}
  AND b.durum NOT IN (N'Olumlu', N'İşe Alındı', N'Olumsuz')
  AND DATEDIFF(day, b.olusturma, SYSDATETIME()) > 7", p);

        /* Bu haftaki (pazartesi-pazar) görüşmeler. Başvuru tarihi aralığı
           uygulanmaz: geçen ay gelen adayın bu haftaki görüşmesi de bu
           haftanın işidir. */
        var bugunTarih = DateTime.Today;
        var haftaBas = bugunTarih.AddDays(-(((int)bugunTarih.DayOfWeek + 6) % 7));

        var buHaftaGorusme = db.ExecuteScalar<int>($@"
SELECT COUNT(*)
{taban}
  AND b.gorusme_tarihi >= @haftaBas AND b.gorusme_tarihi < @haftaBit",
            new
            {
                subeler = uzmanSubeleri,
                tarihBas = (DateTime?)null,
                tarihBit = (DateTime?)null,
                haftaBas,
                haftaBit = haftaBas.AddDays(7)
            });

        return Ok(new { toplam, bugun, durumlar, gecikmisler, uzunBekleyen, buHaftaGorusme });
    }

    /// <summary>
    /// Dağılım penceresi: şubelere ve pozisyonlara göre başvuru sayıları ile
    /// ortalama süreler. Özet kartlarıyla aynı tabanı sayar (arşiv ve eski
    /// tekrar başvurular hariç, uzman ve tarih süzgeçleri uygulanır). Yalnızca
    /// pencere açıldığında çağrılır.
    /// </summary>
    [HttpGet("Dagilim")]
    [Authorize]
    public IActionResult Dagilim(
        [FromQuery] string uzman = null,
        [FromQuery] DateTime? tarihBas = null,
        [FromQuery] DateTime? tarihBit = null,
        /* Raporlar sayfası birim türü seçiliyken süreleri de o türle
           alıyor (03.10.2026); Başvurular sayfası göndermez. */
        [FromQuery] string birimTuru = null)
    {
        using var db = _vt.Baglanti();

        var uzmanSubeleri = UzmanSubeleri(db, uzman);
        var uzmanSuz = uzmanSubeleri.Length > 0 ? " AND b.sube_kodu IN @subeler" : "";

        /* Bölge kısıtlı roller yalnızca kendi şubelerinin dağılımını görür */
        var subeSuz = SubeSuzmesi ? " AND b.sube_kodu IN @yetkiliSubeler" : "";

        var taban = $@"
FROM KRY_BASVURULAR b
WHERE {BasvuruTabani.Kosul("b")}{uzmanSuz}{subeSuz}
  AND (@tarihBas IS NULL OR b.olusturma >= @tarihBas)
  AND (@tarihBit IS NULL OR b.olusturma < @tarihBit)
  AND (@birimTuru IS NULL OR ISNULL(b.birim_turu, N'Şube') = @birimTuru)";

        var p = new
        {
            subeler = uzmanSubeleri.Length > 0 ? uzmanSubeleri : new[] { "__yok__" },
            yetkiliSubeler = SubeSuzmesi ? SuzmeSubeleri() : new[] { "__yok__" },
            tarihBas = tarihBas?.Date,
            tarihBit = tarihBit?.Date.AddDays(1),
            birimTuru = string.IsNullOrWhiteSpace(birimTuru) || birimTuru == "Tümü"
                ? null : birimTuru
        };

        var subeler = db.Query<DagilimSatiri>($@"
SELECT ISNULL(NULLIF(LTRIM(RTRIM(b.sube_adi)), ''), ISNULL(b.sube_kodu, N'Belirtilmemiş')) AS Ad,
       COUNT(*) AS Adet
{taban}
GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(b.sube_adi)), ''), ISNULL(b.sube_kodu, N'Belirtilmemiş'))
ORDER BY Adet DESC", p).ToList();

        /* Bölümler tek alanda virgülle tutuluyor; birden çok pozisyona
           başvuran aday her pozisyonda bir kez sayılır. */
        /* Virgülle ayırma uygulamada yapılıyor: STRING_SPLIT eski
           uyumluluk düzeyindeki veritabanında yok. */
        var pozisyonlar = db.Query<DagilimSatiri>($@"
SELECT b.bolumler AS Ad, COUNT(*) AS Adet
{taban}
GROUP BY b.bolumler", p)
            .SelectMany(x => (x.Ad ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(ad => (ad, x.Adet)))
            .GroupBy(x => x.ad, StringComparer.CurrentCultureIgnoreCase)
            .Select(g => new DagilimSatiri { Ad = g.First().ad, Adet = g.Sum(x => x.Adet) })
            .OrderByDescending(x => x.Adet)
            .ToList();

        /* Ortalama süreler durum geçmişinden: başvurudan sonraki ilk durum
           işlemine, ilk görüşme talebine ve işe alındı kaydına kadar geçen
           gün. Pozisyon doldurma süresi işe alımda yazılan doldurma_gun. */
        var sure = db.QuerySingleOrDefault<OrtalamaSureler>($@"
WITH t AS (SELECT b.id, b.olusturma, b.doldurma_gun {taban}),
h AS (
    SELECT h.basvuru_id,
           MIN(CASE WHEN h.durum <> N'Yeni' THEN h.tarih END)            AS ilkIslem,
           MIN(CASE WHEN h.durum = N'Görüşme Talebi' THEN h.tarih END)   AS gorusme,
           MIN(CASE WHEN h.durum = N'İşe Alındı' THEN h.tarih END)       AS iseAlim
    FROM KRY_BASVURU_HAREKET h
    WHERE h.basvuru_id IN (SELECT id FROM t)
    GROUP BY h.basvuru_id)
SELECT
  AVG(CASE WHEN h.ilkIslem >= t.olusturma
           THEN DATEDIFF(minute, t.olusturma, h.ilkIslem) / 1440.0 END) AS IlkIslemGun,
  COUNT(CASE WHEN h.ilkIslem >= t.olusturma THEN 1 END)                  AS IlkIslemAdet,
  AVG(CASE WHEN h.gorusme >= t.olusturma
           THEN DATEDIFF(minute, t.olusturma, h.gorusme) / 1440.0 END)  AS GorusmeGun,
  COUNT(CASE WHEN h.gorusme >= t.olusturma THEN 1 END)                   AS GorusmeAdet,
  AVG(CASE WHEN h.iseAlim >= t.olusturma
           THEN DATEDIFF(minute, t.olusturma, h.iseAlim) / 1440.0 END)  AS IseAlimGun,
  COUNT(CASE WHEN h.iseAlim >= t.olusturma THEN 1 END)                   AS IseAlimAdet,
  AVG(CAST(t.doldurma_gun AS DECIMAL(10, 2)))                            AS DoldurmaGun,
  COUNT(t.doldurma_gun)                                                  AS DoldurmaAdet
FROM t LEFT JOIN h ON h.basvuru_id = t.id", p) ?? new OrtalamaSureler();

        return Ok(new { subeler, pozisyonlar, sureler = sure });
    }

    /// <summary>Filtre kutuları için başvurularda geçen ilçe ve mahalleler.</summary>
    [HttpGet("Filtreler")]
    [Authorize]
    public IActionResult Filtreler()
    {
        using var db = _vt.Baglanti();

        var ilceler = db.Query<string>(@"
SELECT DISTINCT ilce FROM KRY_BASVURULAR
WHERE ilce IS NOT NULL AND LTRIM(RTRIM(ilce)) <> '' ORDER BY ilce").ToList();

        var mahalleler = db.Query<MahalleSecenek>(@"
SELECT DISTINCT ISNULL(ilce, '') AS Ilce, mahalle AS Mahalle
FROM KRY_BASVURULAR
WHERE mahalle IS NOT NULL AND LTRIM(RTRIM(mahalle)) <> ''
ORDER BY mahalle").ToList();

        var subeler = db.Query<SubeSecenek>(@"
SELECT DISTINCT sube_kodu AS Kod, ISNULL(sube_adi, sube_kodu) AS Ad
FROM KRY_BASVURULAR
WHERE sube_kodu IS NOT NULL AND LTRIM(RTRIM(sube_kodu)) <> ''
ORDER BY Ad").ToList();

        // Bölümler tek alanda virgülle saklanır; ayrıştırıp benzersiz liste üretilir
        var bolumSatirlari = db.Query<string>(@"
SELECT bolumler FROM KRY_BASVURULAR
WHERE bolumler IS NOT NULL AND LTRIM(RTRIM(bolumler)) <> ''").ToList();

        var bolumler = bolumSatirlari
            .SelectMany(x => x.Split(',', StringSplitOptions.RemoveEmptyEntries))
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToList();

        // Ayarlarda tanımlı şube ve bölümler de listeye eklenir; böylece henüz
        // başvuru gelmemiş bir şube de filtrede seçilebilir.
        var ayar = _ayar.FormOku();

        var tumSubeler = (ayar.Subeler ?? new List<Sube>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Kod))
            .Select(x => new SubeSecenek
            {
                Kod = x.Kod.Trim(),
                Ad = string.IsNullOrWhiteSpace(x.Ad) ? x.Kod.Trim() : x.Ad.Trim()
            })
            .Concat(subeler)
            .GroupBy(x => x.Kod, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .OrderBy(x => x.Ad)
            .ToList();

        var tumBolumler = (ayar.Bolumler ?? new List<string>())
            .Concat(bolumler)
            .Select(x => (x ?? "").Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(x => x)
            .ToList();

        return Ok(new
        {
            ilceler,
            mahalleler,
            subeler = tumSubeler,
            bolumler = tumBolumler
        });
    }

    [HttpGet("{id:int}")]
    [Authorize]
    public IActionResult Getir(int id)
    {
        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault<BasvuruDetay>(@"
SELECT id, basvuru_no AS BasvuruNo, ad_soyad AS AdSoyad, kimlik_no AS KimlikNo,
       telefon AS Telefon, eposta AS Eposta, sube_kodu AS SubeKodu, sube_adi AS SubeAdi,
       bolumler AS Bolumler, birim_turu AS BirimTuru,
       il AS Il, ilce AS Ilce, mahalle AS Mahalle,
       durum AS Durum, degerlendirme_notu AS DegerlendirmeNotu,
       /* Havuzdan döndü rozeti: çıkış tarihi dolu ve durum artık Olumlu değil */
       CASE WHEN havuz_cikis_tarih IS NOT NULL AND durum <> N'Olumlu'
            THEN havuz_cikis_tarih END AS HavuzdanDonusTarihi,
       CASE WHEN havuz_cikis_tarih IS NOT NULL AND durum <> N'Olumlu'
            THEN havuz_cikis_not END AS HavuzdanDonusNotu,
       CASE WHEN havuz_cikis_tarih IS NOT NULL AND durum <> N'Olumlu'
            THEN havuz_cikaran END AS HavuzdanCikaran,
       gorusme_tarihi AS GorusmeTarihi, gorusme_yeri AS GorusmeYeri,
       ise_giris_tarihi AS IseGirisTarihi, ise_giris_bolum AS IseGirisBolum,
       doldurma_gun AS DoldurmaGun, doldurma_dakika AS DoldurmaDakika,
       gonderen_ip AS GonderenIp, tarayici AS Tarayici,
       anlasilan_ucret AS AnlasilanUcret, yol_ucreti AS YolUcreti,
       olusturma AS Olusturma, guncelleme AS Guncelleme, guncelleyen AS Guncelleyen,
       mail_gonderildi AS MailGonderildi, test_kaydi AS TestKaydi,
       ISNULL(arsiv, 0)                                            AS Arsiv,
       JSON_VALUE(veri_json, '$.talepEdilenNetUcret')              AS TalepUcret,
       DATEDIFF(day, olusturma, SYSDATETIME())                     AS BekleyenGun,
       DATEDIFF(day, ISNULL((
           SELECT MAX(h.tarih) FROM KRY_BASVURU_HAREKET h
           WHERE h.basvuru_id = KRY_BASVURULAR.id AND h.durum = KRY_BASVURULAR.durum
       ), olusturma), SYSDATETIME())                                AS DurumGun,
       DATEDIFF(day, ISNULL(guncelleme, olusturma), SYSDATETIME()) AS IslemsizGun,
       veri_json AS VeriJson
FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        // Bölge müdürü yalnızca kendi şubelerinin başvurusunu açabilir
        if (SubeSiniri && !YetkiliSubeler().Contains(kayit.SubeKodu ?? "",
                StringComparer.OrdinalIgnoreCase))
        {
            return StatusCode(403, new { hata = "Bu başvuruyu görme yetkiniz yok." });
        }

        kayit.Hareketler = db.Query<Hareket>(@"
SELECT id, durum AS Durum, aciklama AS Aciklama, kullanici AS Kullanici, tarih AS Tarih
FROM KRY_BASVURU_HAREKET WHERE basvuru_id = @id ORDER BY id DESC", new { id }).ToList();

        /* Bölge müdürü yalnızca kendi eklediği notları görür;
           İK ve yönetici tüm notları görür. */
        kayit.Notlar = db.Query<BasvuruNotu>(@"
SELECT id AS Id, basvuru_id AS BasvuruId, metin AS Metin,
       kullanici AS Kullanici, ad_soyad AS AdSoyad, tarih AS Tarih
FROM KRY_BASVURU_NOT
WHERE basvuru_id = @id
  AND (@sinir = 0 OR kullanici = @kullanici)
ORDER BY id DESC",
            new { id, sinir = SubeSiniri ? 1 : 0, kullanici = Kullanici }).ToList();

        /* Aynı kimlik numarasıyla yapılmış diğer başvurular ve notları */
        kayit.OncekiBasvurular = db.Query<OncekiBasvuru>(@"
SELECT id AS Id, basvuru_no AS BasvuruNo, durum AS Durum,
       degerlendirme_notu AS DegerlendirmeNotu, sube_adi AS SubeAdi,
       bolumler AS Bolumler, olusturma AS Olusturma,
       ise_giris_tarihi AS IseGirisTarihi,
       anlasilan_ucret AS AnlasilanUcret,
       veri_json AS VeriJson
FROM KRY_BASVURULAR
WHERE kimlik_no = @kimlik AND id <> @id
ORDER BY id DESC", new { kimlik = kayit.KimlikNo, id }).ToList();

        /* Yetkisi olmayan kullanıcılarda eski formların özel alanları da
           temizlenir; güncel başvuruda uygulanan kural burada da geçerli. */
        if (!OzelVeriGorebilir)
        {
            foreach (var eski in kayit.OncekiBasvurular)
                eski.VeriJson = OzelVerileriAyikla(eski.VeriJson);
        }

        /* Anlaşılan ücret de ücret bilgisidir ve rolün ücret gizliliğine
           tabidir. Yalnızca form içindeki alanlar temizleniyordu; işe alım
           bölümündeki anlaşılan ücret açıkta kalıyordu. */
        if (_yetki.Gizli(Rol, YetkiServisi.Ucret))
        {
            kayit.AnlasilanUcret = null;
            kayit.YolUcreti = null;

            foreach (var eski in kayit.OncekiBasvurular)
                eski.AnlasilanUcret = null;
        }

        if (kayit.OncekiBasvurular.Count > 0)
        {
            var idler = kayit.OncekiBasvurular.Select(x => x.Id).ToArray();

            var eskiNotlar = db.Query<BasvuruNotu>(@"
SELECT id AS Id, basvuru_id AS BasvuruId, metin AS Metin,
       kullanici AS Kullanici, ad_soyad AS AdSoyad, tarih AS Tarih
FROM KRY_BASVURU_NOT WHERE basvuru_id IN @idler ORDER BY id DESC",
                new { idler }).ToList();

            foreach (var eski in kayit.OncekiBasvurular)
                eski.Notlar = eskiNotlar.Where(n => n.BasvuruId == eski.Id).ToList();
        }

        /* Yetkisi olmayan kullanıcılarda kimlik bilgileri gizlenir.
           Form önizlemesindeki özel alanlar da temizlenir. */
        /* Aday daha önce çalışıp ayrıldıysa çıkış mülakatı aranır.

           Yeniden işe alım kararında en çok işe yarayan bilgi budur:
           kişi neden ayrılmış, o zaman ne söylemiş. Kimlik numarasıyla
           eşleştirilir; anketten gelen kayıtlar da dahildir. */
        try
        {
            if (!string.IsNullOrWhiteSpace(kayit.KimlikNo))
            {
                /* Mikro ile kariyer veritabanı ayrı sunucularda; tek sorguda
                   JOIN yapılamıyor ("Invalid object name ...PERSONELLER",
                   güvenlik günlüğünü dolduruyordu). Kimlik → personel kodu
                   eşlemesi personel kaynağından (önbellekli) alınır, mülakat
                   yalnızca kariyer veritabanında aranır. */
                var kimlik = kayit.KimlikNo.Trim();

                List<string> personelKodlari;

                try
                {
                    personelKodlari = _personelKaynak.TumPersonelleriGetir()
                        .Where(x => string.Equals((x.KimlikNo ?? "").Trim(), kimlik,
                                                  StringComparison.Ordinal)
                                    && !string.IsNullOrWhiteSpace(x.PersonelKodu))
                        .Select(x => x.PersonelKodu.Trim())
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                }
                catch
                {
                    /* Mikro kapalıysa kimlikle eşleşen anket kayıtlarına düşülür */
                    personelKodlari = new List<string>();
                }

                kayit.CikisMulakatlari = personelKodlari.Count == 0
                    ? new List<object>()
                    : db.Query(@"
SELECT m.id, m.ad_soyad AS adSoyad, m.sube_adi AS subeAdi, m.gorev,
       m.cikis_tarihi AS cikisTarihi, m.cikis_nedeni AS cikisNedeni,
       m.ozet, m.uzman_yorumu AS uzmanYorumu, m.uzman_adi AS uzmanAdi,
       m.sorular_json AS sorularJson, m.olusturma
FROM KRY_CIKIS_MULAKAT m
WHERE LTRIM(RTRIM(m.personel_kodu)) IN @kodlar
ORDER BY m.olusturma DESC", new { kodlar = personelKodlari })
                        .Cast<object>()
                        .ToList();

                /* Personel kodu eşleşmeyen kayıtlar için ada göre de bakılır;
                   anketten gelenlerde personel kodu boş olabiliyor. */
                if (kayit.CikisMulakatlari.Count == 0)
                {
                    kayit.CikisMulakatlari = db.Query(@"
SELECT m.id, m.ad_soyad AS adSoyad, m.sube_adi AS subeAdi, m.gorev,
       m.cikis_tarihi AS cikisTarihi, m.cikis_nedeni AS cikisNedeni,
       m.ozet, m.uzman_yorumu AS uzmanYorumu, m.uzman_adi AS uzmanAdi,
       m.sorular_json AS sorularJson, m.olusturma
FROM KRY_CIKIS_MULAKAT m
JOIN KRY_CIKIS_ANKET a ON a.mulakat_id = m.id
WHERE a.kimlik_no = @kimlik
ORDER BY m.olusturma DESC", new { kimlik = kayit.KimlikNo.Trim() })
                        .Cast<object>()
                        .ToList();
                }
            }
        }
        catch (Exception hata)
        {
            /* Mikro kapalıysa başvuru yine açılmalı */
            _gunluk.Yaz("ÇIKIŞ MÜLAKATI OKUNAMADI", "-", hata.Message);
        }

        /* Alan maskeleme sunucuda yapılır. Panelde gizlemek yeterli
           değil: tarayıcının ağ sekmesine bakan biri veriyi yine görür. */
        kayit.KimlikNo = _yetki.KimlikMaskele(Rol, kayit.KimlikNo);
        kayit.Telefon = _yetki.TelefonMaskele(Rol, kayit.Telefon);

        if (!OzelVeriGorebilir || _yetki.Gizli(Rol, YetkiServisi.Adres))
            kayit.VeriJson = OzelVerileriAyikla(kayit.VeriJson);

        return Ok(kayit);
    }

    [HttpPost("{id:int}/Durum")]
    [Authorize]
    public IActionResult DurumDegistir(int id, [FromBody] DurumGirdi girdi)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (girdi is null || !Durumlar.Tumu.Contains(girdi.Durum))
            return BadRequest(new { hata = "Geçersiz durum." });

        if (girdi.Durum == Durumlar.Olumsuz && string.IsNullOrWhiteSpace(girdi.Aciklama))
            return BadRequest(new { hata = "Olumsuz durumu için açıklama girilmesi zorunludur." });

        /* Olumlu karar verilirken hangi pozisyon için olumlu olunduğu
           seçilmelidir. Aday birden çok pozisyona başvurmuş olabilir;
           havuzda ve raporlarda tek bir pozisyonla görünmesi gerekir. */
        if (girdi.Durum == Durumlar.Olumlu && string.IsNullOrWhiteSpace(girdi.Bolum))
            return BadRequest(new { hata = "Olumlu için pozisyon seçiniz." });

        using var db = _vt.Baglanti();

        if (girdi.Durum == Durumlar.IseAlindi)
        {
            var (g, m) = ReferansGereksinimi(db, id, null, null);
            if (m < g)
                return BadRequest(new { hata = $"Bu pozisyon için en az {g} referans gerekli; kayıtlı {m}.", referansGereken = g, referansMevcut = m });
        }

        /* Olumlu kararında seçilen pozisyon başvuruya yazılır: aday bundan
           sonra havuzda, raporlarda ve listelerde yalnızca bu pozisyonla
           görünür. Diğer durumlarda bolumler alanına dokunulmaz. */
        var etkilenen = db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum,
    bolumler = CASE WHEN @bolum IS NULL THEN bolumler ELSE @bolum END,
    ise_giris_bolum = CASE WHEN @bolum IS NULL THEN ise_giris_bolum ELSE @bolum END,
    degerlendirme_notu = COALESCE(@not, degerlendirme_notu),
    /* Yeniden Olumlu olan aday havuza geri girer; eski çıkış izi
       silinmezse havuz listesi onu göstermez */
    havuz_cikis_tarih = CASE WHEN @durum = N'Olumlu' THEN NULL ELSE havuz_cikis_tarih END,
    havuz_cikis_sebep = CASE WHEN @durum = N'Olumlu' THEN NULL ELSE havuz_cikis_sebep END,
    havuz_cikis_not   = CASE WHEN @durum = N'Olumlu' THEN NULL ELSE havuz_cikis_not END,
    havuz_cikaran     = CASE WHEN @durum = N'Olumlu' THEN NULL ELSE havuz_cikaran END,
    guncelleme = SYSDATETIME(),
    guncelleyen = @kullanici
WHERE id = @id",
            new
            {
                id,
                durum = girdi.Durum,
                bolum = girdi.Durum == Durumlar.Olumlu && !string.IsNullOrWhiteSpace(girdi.Bolum)
                    ? girdi.Bolum.Trim()
                    : null,
                not = girdi.Aciklama,
                kullanici = Kullanici
            });

        if (etkilenen == 0) return NotFound(new { hata = "Başvuru bulunamadı." });

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new
            {
                id,
                durum = girdi.Durum,
                aciklama = girdi.Durum == Durumlar.Olumlu
                           && !string.IsNullOrWhiteSpace(girdi.Bolum)
                    ? $"Pozisyon: {girdi.Bolum.Trim()}"
                      + (string.IsNullOrWhiteSpace(girdi.Aciklama)
                          ? "" : $" · {girdi.Aciklama}")
                    : girdi.Aciklama,
                kullanici = Kullanici
            });

        return Ok(new { basarili = true });
    }

    [HttpPost("{id:int}/Gorusme")]
    [Authorize]
    public async Task<IActionResult> GorusmeTalebi(int id, [FromBody] GorusmeGirdi girdi)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (girdi is null) return BadRequest(new { hata = "Görüşme bilgileri eksik." });

        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault<BasvuruOzet>(@"
SELECT id, ad_soyad AS AdSoyad, eposta AS Eposta FROM KRY_BASVURULAR WHERE id = @id",
            new { id });

        if (kayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum, gorusme_tarihi = @tarih, gorusme_yeri = @yer,
    guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id",
            new
            {
                id,
                durum = Durumlar.GorusmeTalebi,
                tarih = girdi.GorusmeTarihi,
                yer = girdi.GorusmeYeri,
                kullanici = Kullanici
            });

        var aciklama =
            $"Görüşme: {girdi.GorusmeTarihi:dd.MM.yyyy HH:mm} · {girdi.GorusmeYeri}" +
            (string.IsNullOrWhiteSpace(girdi.Aciklama) ? "" : $" · {girdi.Aciklama}");

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new { id, durum = Durumlar.GorusmeTalebi, aciklama, kullanici = Kullanici });

        var mailGitti = false;
        if (girdi.AdayaMailGonder && !string.IsNullOrWhiteSpace(kayit.Eposta))
        {
            // Görüşmeyi oluşturan personelin bilgileri mailde imza olarak yer alır
            var yetkili = db.QuerySingleOrDefault<Kullanici>(@"
SELECT ad_soyad AS AdSoyad, unvan AS Unvan, telefon AS Telefon, eposta AS Eposta
FROM KRY_KULLANICILAR WHERE kullanici_adi = @k", new { k = Kullanici });

            /* Tüm görüşmeler Genel Müdürlük'te yapılıyor; adres ve konum
               bağlantısı davetin içine konur ki aday nereye geleceğini
               ayrıca sormasın. */
            var davetAyar = _ayar.FormOku();

            mailGitti = await _mail.GorusmeDavetiAsync(
                kayit.Eposta, kayit.AdSoyad, girdi.GorusmeTarihi,
                girdi.GorusmeYeri, girdi.Aciklama, yetkili,
                davetAyar.GorusmeAdresi, davetAyar.GorusmeHaritaAdresi);
        }

        return Ok(new { basarili = true, mailGonderildi = mailGitti });
    }

    /// <summary>
    /// Adayın başvurduğu birimi değiştirir (rotasyon).
    /// Örneğin Atakent şubesine başvuran aday Halkalı şubesine yönlendirilebilir.
    /// </summary>
    [HttpPost("{id:int}/Birim")]
    [Authorize]
    public IActionResult BirimDegistir(int id, [FromBody] SubeDegistirGirdi girdi)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (string.IsNullOrWhiteSpace(girdi?.SubeKodu))
            return BadRequest(new { hata = "Birim seçiniz." });

        var ayar = _ayar.FormOku();
        var yeniBirim = ayar.Subeler?.FirstOrDefault(x =>
            string.Equals(x.Kod, girdi.SubeKodu, StringComparison.OrdinalIgnoreCase));

        if (yeniBirim is null)
            return BadRequest(new { hata = "Seçilen birim tanımlı değil." });

        using var db = _vt.Baglanti();

        var oncekiKayit = db.QuerySingleOrDefault(@"
SELECT sube_adi, sube_kodu, ad_soyad, durum FROM KRY_BASVURULAR WHERE id = @id",
            new { id });

        if (oncekiKayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        var eski = (string)oncekiKayit.sube_adi;
        var eskiKod = (string)oncekiKayit.sube_kodu;
        var durum = (string)oncekiKayit.durum;

        /* İşe al dendikten sonra (onay bekliyor ya da işe alındı) birim
           değişikliği rotasyon sayılmıyor (13.10.2026): kişi henüz o
           birimde çalışmaya başlamadı, yapılan iş işe alım biriminin
           düzeltilmesi. Rotasyon onayı açılmıyor; bekleyen işe alım onayı
           varsa onun birimi güncelleniyor ki onaylayan doğru birimi görsün. */
        var iseAlimSonrasi = durum == Durumlar.OnayBekliyor || durum == Durumlar.IseAlindi;

        db.Execute(@"
UPDATE KRY_BASVURULAR
SET sube_kodu = @kod, sube_adi = @ad, birim_turu = @tur,
    guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id",
            new
            {
                id,
                kod = yeniBirim.Kod,
                ad = yeniBirim.Ad,
                tur = yeniBirim.Tur ?? "Şube",
                kullanici = Kullanici
            });

        var aciklama = (iseAlimSonrasi ? "İşe alım birimi değişti" : "Birim değişikliği") +
                       $": {eski} → {yeniBirim.Ad}" +
                       (string.IsNullOrWhiteSpace(girdi.Aciklama) ? "" : $" · {girdi.Aciklama}");

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
SELECT @id, durum, @aciklama, @kullanici FROM KRY_BASVURULAR WHERE id = @id",
            new { id, aciklama, kullanici = Kullanici });

        if (iseAlimSonrasi)
        {
            /* Bekleyen işe alım onayının birimi ve özeti */
            db.Execute(@"
UPDATE KRY_ONAY
SET sube_kodu = @kod, sube_adi = @ad,
    ozet = CASE WHEN ozet IS NULL THEN NULL
                ELSE LEFT(REPLACE(ozet, N'Birim: ' + @eski, N'Birim: ' + @ad), 900) END
WHERE tur = @tur AND basvuru_id = @id AND durum = @bekliyor",
                new
                {
                    id,
                    kod = yeniBirim.Kod,
                    ad = yeniBirim.Ad,
                    eski = eski ?? "",
                    tur = OnayTuru.IseAlim,
                    bekliyor = OnayDurumu.Bekliyor
                });

            /* Daha önce yanlışlıkla açılmış bekleyen rotasyon isteği varsa kapanır */
            _onay.EskiBekleyenleriKapat(OnayTuru.Rotasyon, id);

            return Ok(new { basarili = true, subeAdi = yeniBirim.Ad, onayBekliyor = false });
        }

        /* Rotasyon yetkili onayına gönderilir. İşlem hemen uygulanır;
           reddedilirse aday eski birimine geri alınır. */
        _onay.EskiBekleyenleriKapat(OnayTuru.Rotasyon, id);

        _onay.Olustur(
            OnayTuru.Rotasyon,
            $"{oncekiKayit.ad_soyad} · birim değişikliği",
            $"{eski} → {yeniBirim.Ad}" +
                (string.IsNullOrWhiteSpace(girdi.Aciklama) ? "" : $" · {girdi.Aciklama}"),
            new
            {
                eskiSubeKodu = eskiKod,
                eskiSubeAdi = eski,
                yeniSubeKodu = yeniBirim.Kod,
                yeniSubeAdi = yeniBirim.Ad
            },
            Kullanici,
            basvuruId: id,
            subeKodu: yeniBirim.Kod,
            subeAdi: yeniBirim.Ad);

        return Ok(new
        {
            basarili = true,
            subeAdi = yeniBirim.Ad,
            onayBekliyor = true
        });
    }

    /// <summary>
    /// Adayı işe alınmış olarak işaretler. İşe giriş tarihi kaydedilir,
    /// istenirse aynı anda birim değişikliği (rotasyon) da yapılır.
    /// </summary>
    /// <summary>Dakika cinsinden süreyi okunur biçimde yazar</summary>
    private static string SureMetni(int dakika)
    {
        if (dakika < 60) return $"{Math.Max(1, dakika)} dakika";
        if (dakika < 1440) return $"{dakika / 60} saat";

        var gun = dakika / 1440;
        var saat = (dakika % 1440) / 60;

        return saat > 0 ? $"{gun} gün {saat} saat" : $"{gun} gün";
    }

    [HttpPost("{id:int}/IseAl")]
    [Authorize]
    public IActionResult IseAl(int id, [FromBody] IseAlGirdi girdi)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (girdi is null || girdi.IseGirisTarihi == default)
            return BadRequest(new { hata = "İşe giriş tarihi giriniz." });

        if (string.IsNullOrWhiteSpace(girdi.Aciklama))
            return BadRequest(new { hata = "Açıklama alanı zorunludur." });

        /* Pozisyon zorunludur: aday birden çok pozisyona başvurmuş olabilir,
           hangisine alındığı belirtilmezse norm kadro sayımı ve raporlar
           yanlış pozisyona işler. */
        if (string.IsNullOrWhiteSpace(girdi.Bolum))
            return BadRequest(new { hata = "İşe alınacağı pozisyonu seçiniz." });

        /* Biçen Kart zorunlu (07.10.2026): işe alınan herkese kart verilir.
           Kart başka bir çalışana bağlıysa ya da başka bir adayın işe
           alımında bekliyorsa kabul edilmez. */
        var kartNo = new string((girdi.KartNo ?? "").Where(char.IsDigit).ToArray());

        if (kartNo.Length < 6)
            return BadRequest(new { hata = "Personele verilecek Biçen Kart numarasını giriniz." });

        using var db = _vt.Baglanti();

        var kartHata = BasvuruKart.Denetle(db, HttpContext.RequestServices.GetRequiredService<PersonelKaynagiServisi>(), kartNo, id);
        if (kartHata is not null) return BadRequest(new { hata = kartHata });

        /* Kimlik numarası da okunuyor: işe alım onayındaki "yeni alım /
           rotasyon / eski çalışan" ayrımı ona göre yapılıyor. Önceden
           okunmuyordu; boş numara Mikro'da kimliği boş olan ayrılmış bir
           kayıtla eşleşiyor ve herkes "eski çalışan" görünüyordu. */
        var kayit = db.QuerySingleOrDefault<BasvuruOzet>(@"
SELECT id AS Id, ad_soyad AS AdSoyad, sube_adi AS SubeAdi, kimlik_no AS KimlikNo
FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        /* Zorunlu referans (21.10.2026): şef ve üstünde 2, depo / genel
           merkez ve diğer pozisyonlarda 1; şubede kasiyer, reyoner,
           tandolya, temizlik muaf. Eksikse İK referansı eklemeden işe alamaz. */
        var (refGereken, refMevcut) = ReferansGereksinimi(db, id, girdi.Bolum, girdi.SubeKodu);
        if (refMevcut < refGereken)
            return BadRequest(new
            {
                hata = $"Bu pozisyon için en az {refGereken} referans (ad soyad ve telefon) gerekli; kayıtlı {refMevcut}. Referans ekleyip tekrar deneyiniz.",
                referansGereken = refGereken,
                referansMevcut = refMevcut
            });

        /* Mikro sicil kartı (09.10.2026): bilgiler şimdi doğrulanır, kart
           işe alım onaylanınca açılır. Hata varsa işe alım da kaydedilmez. */
        var sicilServisi = HttpContext.RequestServices.GetRequiredService<MikroSicilServisi>();

        if (girdi.MikroSicil is not null)
        {
            var sicilHata = MikroSicilServisi.Dogrula(girdi.MikroSicil);
            if (sicilHata is not null) return BadRequest(new { hata = sicilHata });

            if (girdi.IseGirisTarihi.Date < DateTime.Today.AddDays(-60) || girdi.IseGirisTarihi.Date > DateTime.Today.AddDays(180))
                return BadRequest(new { hata = "Mikro sicil: işe giriş tarihi bugünden en fazla 60 gün önce ya da 180 gün sonra olabilir." });

            if (sicilServisi.MikroKullanici(Kullanici).No is null)
                return BadRequest(new { hata = "Mikro'da sicil açabilmek için Yönetim › Kullanıcılar'da Mikro kullanıcı numaranızın tanımlı olması gerekir." });
        }

        var birimAdi = kayit.SubeAdi;

        /* Rotasyon istendiyse birim de güncellenir */
        if (!string.IsNullOrWhiteSpace(girdi.SubeKodu))
        {
            var ayar = _ayar.FormOku();
            var yeniBirim = ayar.Subeler?.FirstOrDefault(x =>
                string.Equals(x.Kod, girdi.SubeKodu, StringComparison.OrdinalIgnoreCase));

            if (yeniBirim is not null)
            {
                db.Execute(@"
UPDATE KRY_BASVURULAR
SET sube_kodu = @kod, sube_adi = @ad, birim_turu = @tur
WHERE id = @id",
                    new
                    {
                        id,
                        kod = yeniBirim.Kod,
                        ad = yeniBirim.Ad,
                        tur = yeniBirim.Tur ?? "Şube"
                    });

                birimAdi = yeniBirim.Ad;
            }
        }

        /* Bu pozisyon ne kadar süredir açıktı? Norm kadrodaki eksik başlangıç
           tarihi ile işe giriş arasındaki gün sayısı kaydedilir. */
        int? doldurmaGun = null;
        int? doldurmaDakika = null;

        if (!string.IsNullOrWhiteSpace(girdi.Bolum))
        {
            var eksikBaslangic = db.ExecuteScalar<DateTime?>(@"
SELECT TOP 1 eksik_baslangic FROM KRY_KADRO
WHERE aktif = 1 AND bolum = @bolum
  AND ISNULL(sube_kodu, '') = ISNULL(@sube, '')
  AND eksik_baslangic IS NOT NULL",
                new { bolum = girdi.Bolum.Trim(), sube = girdi.SubeKodu });

            if (eksikBaslangic is not null)
            {
                doldurmaGun = Math.Max(0,
                    (int)(girdi.IseGirisTarihi.Date - eksikBaslangic.Value.Date).TotalDays);

                /* Aynı gün içinde doldurulan pozisyonlar '0 gün' görünmesin
                   diye süre dakika cinsinden de saklanır. */
                doldurmaDakika = Math.Max(0,
                    (int)(DateTime.Now - eksikBaslangic.Value).TotalMinutes);
            }
        }

        db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum, ise_giris_tarihi = @tarih, ise_giris_bolum = @bolum,
    doldurma_gun = @doldurmaGun, doldurma_dakika = @doldurmaDakika,
    anlasilan_ucret = @anlasilanUcret,
    yol_ucreti = @yolUcreti,
    guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id",
            new
            {
                id,
                /* İşe alım bilgileri kaydedilir ancak durum doğrudan
                   "İşe Alındı" olmaz: yetkili onayı beklenir. */
                durum = Durumlar.OnayBekliyor,
                tarih = girdi.IseGirisTarihi,
                bolum = string.IsNullOrWhiteSpace(girdi.Bolum) ? null : girdi.Bolum.Trim(),
                doldurmaGun,
                doldurmaDakika,
                anlasilanUcret = girdi.AnlasilanUcret,
                yolUcreti = girdi.YolUcreti,
                kullanici = Kullanici
            });

        /* Biçen Kart başvuruya bağlanıyor; Mikro'ya işlenince sicile bağlanır */
        BasvuruKart.Kaydet(db, id, kayit.KimlikNo, kayit.AdSoyad, kartNo, Kullanici);

        /* Mikro sicil isteği: onayda açılacak. Tiksiz yeniden gönderimde
           önceki bekleyen istek kapanır. */
        var sicilNotu = "";

        if (girdi.MikroSicil is not null)
        {
            var sakla = sicilServisi.Sakla(db, id, girdi.MikroSicil, girdi.IseGirisTarihi, Kullanici);
            sicilNotu = sakla is null ? " · Onaylanınca Mikro'da sicil kartı açılacak" : "";
        }
        else
        {
            sicilServisi.Kapat(db, id, "İşe alım Mikro sicil seçeneği olmadan yeniden gönderildi.");
        }

        /* İşe giriş evrak takibi açılıyor (03.10.2026): hiç evrak
           yüklenmemiş olsa da personel kartında eksikler görünsün. */
        try
        {
            HttpContext?.RequestServices.GetService<IseGirisEvrakServisi>()
                ?.BasvuruTakibiAc(db, id, Kullanici);
        }
        catch (Exception hata)
        {
            _gunluk.Yaz("EVRAK TAKIP HATASI", "-", hata.Message);
        }

        /* Önceki onay bilgileri temizlenir (yeniden gönderim olabilir) */
        db.Execute(@"
UPDATE KRY_BASVURULAR
SET onay_durumu = N'Bekliyor', onaylayan = NULL,
    onay_tarihi = NULL, onay_notu = NULL
WHERE id = @id", new { id });

        var pozisyon = string.IsNullOrWhiteSpace(girdi.Bolum)
            ? ""
            : $" · Pozisyon: {girdi.Bolum.Trim()}";

        var sure = doldurmaDakika is null
            ? ""
            : $" · Pozisyon {SureMetni(doldurmaDakika.Value)} sonra dolduruldu";

        var ucret = girdi.AnlasilanUcret is null
            ? ""
            : $" · Anlaşılan ücret: {girdi.AnlasilanUcret:N0} TL";

        var yol = girdi.YolUcreti is null or 0
            ? ""
            : $" · Yol: {girdi.YolUcreti:N0} TL";

        var aciklama =
            $"İşe alım onaya gönderildi · Giriş tarihi: {girdi.IseGirisTarihi:dd.MM.yyyy} · " +
            $"Birim: {birimAdi}{pozisyon}{ucret}{yol}{sure} · Biçen Kart: {kartNo}{sicilNotu} · {girdi.Aciklama.Trim()}";

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new { id, durum = Durumlar.OnayBekliyor, aciklama, kullanici = Kullanici });

        /* Onay kuyruğuna eklenir; aynı başvurunun eski istekleri iptal olur */
        _onay.EskiBekleyenleriKapat(OnayTuru.IseAlim, id);

        /* Bu kişi daha önce şirkette çalışmış mı? Onaylayanın rotasyon ile
           yeni alımı ayırt edebilmesi için bildirime yazılır. */
        var kaynak = "Yeni başvuru";

        /* Geçerli (11 haneli) kimlik yoksa Mikro'ya hiç sorulmuyor */
        var kimlik = Sadelestir(kayit.KimlikNo);

        if (kimlik.Length == 11 && kimlik.All(char.IsDigit))
        try
        {
            using var mikro = _vt.PersonelBaglantisi();

            var oncekiKayit = mikro.QueryFirstOrDefault(@"
SELECT TOP 1 PIG.ig_adi AS birim, P.per_cikis_tar AS cikis
FROM [MikroDesktop_2004BICEN].dbo.PERSONELLER P
    /* Dış birleştirme: iş grubu tanımsız olan kayıtlar iç birleştirmede
       düşüyor ve kişi 'daha önce çalışmamış' sayılıyordu. */
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI PIG ON P.per_is_grup_kodu = PIG.ig_kod
WHERE LTRIM(RTRIM(P.Per_TcKimlikNo)) = @kimlik
ORDER BY P.per_giris_tar DESC",
                new { kimlik }, commandTimeout: 30);

            if (oncekiKayit is not null)
            {
                var cikis = (DateTime?)oncekiKayit.cikis;
                var halenCalisiyor = cikis is null || cikis.Value.Year <= 1950;

                kaynak = halenCalisiyor
                    ? $"ROTASYON · hâlen {oncekiKayit.birim} biriminde çalışıyor"
                    : $"Eski çalışan · {oncekiKayit.birim} "
                      + $"({cikis:dd.MM.yyyy} ayrıldı)";
            }
        }
        catch (Exception hata)
        {
            _gunluk.Yaz("ONAY KAYNAK HATASI", "-", hata.Message);
        }

        /* Başvurunun ne kadar süredir beklediği: onaylayan kişi 'aynı gün
           gelmiş ve hemen işe alınıyor" ile "üç haftadır bekliyordu" arasını
           ayırt edebilmeli. */
        var basvuruTarihi = db.ExecuteScalar<DateTime?>(
            "SELECT olusturma FROM KRY_BASVURULAR WHERE id = @id", new { id });

        var bekleme = "";

        if (basvuruTarihi is not null)
        {
            var gun = (int)(DateTime.Now.Date - basvuruTarihi.Value.Date).TotalDays;

            bekleme = gun switch
            {
                <= 0 => " · Başvuru AYNI GÜN geldi",
                1 => " · Başvuru dün geldi",
                < 7 => $" · Başvuru {gun} gün önce geldi",
                < 30 => $" · Başvuru {gun / 7} hafta önce geldi",
                _ => $" · Başvuru {gun} gün önce geldi"
            };
        }

        /* Onaylayanın ne onayladığını tek bakışta görmesi için işlem türü
           başa yazılır: yeni alım mı, rotasyon mu, eski çalışanın dönüşü mü. */
        var islem = kaynak.StartsWith("ROTASYON", StringComparison.OrdinalIgnoreCase)
            ? "ROTASYON"
            : kaynak.StartsWith("Eski çalışan", StringComparison.OrdinalIgnoreCase)
                ? "ESKİ ÇALIŞAN DÖNÜŞÜ"
                : "YENİ İŞE ALIM";

        _onay.Olustur(
            OnayTuru.IseAlim,
            $"{kayit.AdSoyad} · {islem}",
            $"{islem} onayınıza sunuldu · {kaynak} · {birimAdi}{pozisyon} · "
                + $"Giriş {girdi.IseGirisTarihi:dd.MM.yyyy}{ucret}{bekleme}{sicilNotu}",
            new
            {
                iseGirisTarihi = girdi.IseGirisTarihi,
                bolum = girdi.Bolum,
                anlasilanUcret = girdi.AnlasilanUcret,
                yolUcreti = girdi.YolUcreti
            },
            Kullanici,
            basvuruId: id,
            subeKodu: girdi.SubeKodu,
            subeAdi: birimAdi);

        return Ok(new
        {
            basarili = true,
            subeAdi = birimAdi,
            onayBekliyor = true,
            mikroSicil = sicilNotu.Length > 0,
            mesaj = "İşe alım bilgileri kaydedildi, yetkili onayına gönderildi."
                    + (sicilNotu.Length > 0 ? " Onaylanınca Mikro'da sicil kartı açılacak." : "")
        });
    }

    /* ==================================================================== */
    /* İşe alım onayı                                                        */
    /* ==================================================================== */

    /// <summary>Kullanıcının işe alım onayı verme yetkisi var mı?</summary>
    private bool OnayYetkisi
    {
        get
        {
            /* Genel müdür yardımcısı ve yönetici her zaman onaylayabilir;
               diğer roller için kullanıcı bazında yetki verilebilir. */
            if (Roller.OnayYetkisi(Rol)) return true;

            using var db = _vt.Baglanti();

            return db.ExecuteScalar<bool>(@"
SELECT ISNULL(onay_yetkisi, 0) FROM KRY_KULLANICILAR
WHERE kullanici_adi = @k", new { k = Kullanici });
        }
    }


    /* ------------------------------------------------ onay yazışması */

    private void OnayMesajYaz(System.Data.IDbConnection db, int onayId, string tur, string metin)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_ONAY_MESAJ (onay_id, tur, metin, kullanici, ad_soyad)
VALUES (@onayId, @tur, @metin, @kullanici,
        (SELECT TOP 1 ad_soyad FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici))",
                new { onayId, tur, metin = metin.Length > 1000 ? metin[..1000] : metin, kullanici = Kullanici });
        }
        catch
        {
            /* Tablo yoksa yazışma tutulmaz; onay akışı etkilenmez */
        }
    }

    /// <summary>
    /// Onayların yazışması: soru (onaylayan) ve yanıt (isteyen). Tablodan
    /// önceki yanıt bekleyen isteklerde soru onay_notu'ndan gelir.
    /// </summary>
    private Dictionary<int, List<object>> OnayMesajlari(System.Data.IDbConnection db, IEnumerable<int> idler)
    {
        var liste = idler.Distinct().ToList();
        var sonuc = new Dictionary<int, List<object>>();
        if (liste.Count == 0) return sonuc;

        try
        {
            foreach (var parca in liste.Chunk(500))
                foreach (var m in db.Query(@"
SELECT onay_id AS onayId, tur, metin, ISNULL(ad_soyad, kullanici) AS kim, tarih
FROM KRY_ONAY_MESAJ WHERE onay_id IN @parca ORDER BY id", new { parca }))
                {
                    int id = m.onayId;
                    if (!sonuc.TryGetValue(id, out var l)) sonuc[id] = l = new List<object>();
                    l.Add(new { tur = (string)m.tur, metin = (string)m.metin, kim = (string)m.kim, tarih = (DateTime)m.tarih });
                }
        }
        catch
        {
            /* tablo yoksa boş */
        }

        return sonuc;
    }

    /// <summary>
    /// Onay bekleyen tüm istekler: işe alım, norm kadro ve rotasyon.
    /// Bildirim alanı bu ucu kullanır.
    /// </summary>
    [HttpGet("OnayBekleyenler")]
    [Authorize]
    public IActionResult OnayBekleyenler()
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT o.id AS id, o.tur AS tur, o.baslik AS baslik, o.ozet AS ozet,
       o.veri_json AS veriJson, o.basvuru_id AS basvuruId,
       o.sube_adi AS subeAdi, o.istek_tarihi AS istekTarihi,
       o.isteyen AS isteyen,
       ISNULL(k.ad_soyad, o.isteyen) AS isteyenAdSoyad,
       b.ad_soyad AS adSoyad, b.telefon AS telefon,
       b.basvuru_no AS basvuruNo,
       b.ise_giris_tarihi AS iseGirisTarihi,
       b.anlasilan_ucret AS anlasilanUcret, b.yol_ucreti AS yolUcreti,
       JSON_VALUE(b.veri_json, '$.talepEdilenNetUcret') AS talepUcret,
       ISNULL(NULLIF(b.ise_giris_bolum, N''), b.bolumler) AS bolum
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.isteyen
LEFT JOIN KRY_BASVURULAR b ON b.id = o.basvuru_id
WHERE o.durum = @bekliyor
  AND (@subeSiniri = 0 OR o.sube_kodu IS NULL OR o.sube_kodu IN @yetkiliSubeler)
ORDER BY o.istek_tarihi",
            new
            {
                bekliyor = OnayDurumu.Bekliyor,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        /* Türlere göre sayılar; bildirim alanında gruplama için */
        var turler = kayitlar
            .GroupBy(x => (string)x.tur)
            .Select(g => new { tur = g.Key, adet = g.Count() })
            .ToList();

        /* Kullanıcının gönderdiği ve sonuçlanmış istekler.
           Sonucu görene kadar bildirim olarak durur. */
        var sonuclar = db.Query(@"
SELECT o.id AS id, o.tur AS tur, o.baslik AS baslik, o.ozet AS ozet,
       o.durum AS durum, o.onay_notu AS onayNotu,
       o.onay_tarihi AS onayTarihi,
       ISNULL(k.ad_soyad, o.onaylayan) AS onaylayanAdSoyad
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.onaylayan
WHERE o.isteyen = @kullanici
  AND o.durum IN (N'Onaylandı', N'Reddedildi')
  AND ISNULL(o.bildirim_okundu, 0) = 0
ORDER BY o.onay_tarihi DESC",
            new { kullanici = Kullanici }).ToList();

        /* Yanıt bekleyen istekler (21.10.2026): isteyen düzeltip yeniden
           gönderebilsin, onay yetkilisi de takip edip karar verebilsin.
           Önceden hiçbir ekranda görünmüyordu. */
        var yetkili = OnayYetkisi;
        var yanitBekleyenler = db.Query(@"
SELECT o.id AS id, o.tur AS tur, o.baslik AS baslik, o.ozet AS ozet,
       o.onay_notu AS onayNotu, o.onay_tarihi AS onayTarihi, o.basvuru_id AS basvuruId,
       o.isteyen AS isteyen, ISNULL(ki.ad_soyad, o.isteyen) AS isteyenAdSoyad,
       ISNULL(k.ad_soyad, o.onaylayan) AS onaylayanAdSoyad
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.onaylayan
LEFT JOIN KRY_KULLANICILAR ki ON ki.kullanici_adi = o.isteyen
WHERE o.durum = @yanit AND (o.isteyen = @kullanici OR @yetkili = 1)
  AND (@subeSiniri = 0 OR o.sube_kodu IS NULL OR o.sube_kodu IN @yetkiliSubeler)
ORDER BY o.onay_tarihi",
            new
            {
                yanit = OnayDurumu.YanitBekliyor,
                kullanici = Kullanici,
                yetkili = yetkili ? 1 : 0,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        /* Yazışma: soru ve yanıtlar her iki listede de görünsün (22.10.2026) */
        var mesajlar = OnayMesajlari(db,
            kayitlar.Select(x => (int)x.id).Concat(yanitBekleyenler.Select(x => (int)x.id)));

        object Ekle(dynamic x)
        {
            var d = (IDictionary<string, object>)x;
            var l = mesajlar.TryGetValue((int)x.id, out var m) ? m : new List<object>();

            /* Tablodan önceki istek: soru onay_notu'nda */
            if (l.Count == 0 && d.TryGetValue("onayNotu", out var not) && not is string n && n.Length > 0)
                l = new List<object> { new { tur = "soru", metin = n, kim = d.TryGetValue("onaylayanAdSoyad", out var k) ? k : null, tarih = d.TryGetValue("onayTarihi", out var t) ? t : null } };

            d["mesajlar"] = l;
            return d;
        }

        return Ok(new
        {
            adet = kayitlar.Count,
            yetkim = yetkili,
            turler,
            kayitlar = kayitlar.Select(Ekle).ToList(),
            sonuclar,
            yanitBekleyenler = yanitBekleyenler.Select(Ekle).ToList()
        });
    }

    /// <summary>Sonuç bildirimini okundu olarak işaretler.</summary>
    [HttpPost("Onay/{onayId:int}/Okundu")]
    [Authorize]
    public IActionResult OnaySonucuOkundu(int onayId)
    {
        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_ONAY SET bildirim_okundu = 1
WHERE id = @onayId AND isteyen = @kullanici",
            new { onayId, kullanici = Kullanici });

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// Bir onay isteğini sonuçlandırır.
    ///
    /// İşe alımda onay verilince başvuru "İşe Alındı" olur, reddedilince
    /// "Evrak Hazırlanıyor" durumuna döner. Norm kadro ve rotasyon
    /// işlemleri zaten uygulanmıştır; reddedilirse eski değere dönülür.
    /// </summary>
    /// <summary>
    /// Görüşmeyi başka bir İK uzmanına yönlendirir.
    ///
    /// Görüşmeyi planlayan kişi ya da onay yetkisi olan biri, görüşmenin
    /// sorumlusunu değiştirebilir. Yeni sorumluya bildirim düşer.
    /// </summary>
    [HttpPost("{id:int}/GorusmeYonlendir")]
    [Authorize]
    public IActionResult GorusmeYonlendir(int id, [FromBody] YonlendirGirdi girdi)
    {
        if (string.IsNullOrWhiteSpace(girdi?.Kullanici))
            return BadRequest(new { hata = "Yönlendirilecek kişiyi seçiniz." });

        using var db = _vt.Baglanti();

        var basvuru = db.QuerySingleOrDefault(@"
SELECT id, ad_soyad AS adSoyad, sube_adi AS subeAdi,
       gorusme_tarihi AS gorusmeTarihi, guncelleyen
FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (basvuru is null)
            return NotFound(new { hata = "Başvuru bulunamadı." });

        /* Yalnızca görüşmeyi planlayan ya da onay yetkisi olan kişi
           yönlendirebilir: rastgele bir uzmanın başkasının görüşmesini
           devretmesi karışıklık yaratır. */
        var planlayan = (string)basvuru.guncelleyen ?? "";

        if (!OnayYetkisi &&
            !string.Equals(planlayan, Kullanici, StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new
            {
                hata = "Bu görüşmeyi yalnızca planlayan kişi ya da yönetici yönlendirebilir."
            });

        var hedef = db.QuerySingleOrDefault(@"
SELECT kullanici_adi AS kullaniciAdi, ad_soyad AS adSoyad
FROM KRY_KULLANICILAR WHERE kullanici_adi = @kullanici",
            new { kullanici = girdi.Kullanici.Trim() });

        if (hedef is null)
            return BadRequest(new { hata = "Seçilen kullanıcı bulunamadı." });

        db.Execute(@"
UPDATE KRY_BASVURULAR
SET guncelleyen = @yeni, guncelleme = SYSDATETIME()
WHERE id = @id", new { id, yeni = (string)hedef.kullaniciAdi });

        var aciklama = string.IsNullOrWhiteSpace(girdi.Not)
            ? $"Görüşme {hedef.adSoyad} adlı uzmana yönlendirildi."
            : $"Görüşme {hedef.adSoyad} adlı uzmana yönlendirildi · {girdi.Not.Trim()}";

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
SELECT @id, durum, @aciklama, @kullanici
FROM KRY_BASVURULAR WHERE id = @id",
            new { id, aciklama, kullanici = Kullanici });

        db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin, basvuru_id)
VALUES (@kullanici, N'GorusmeYonlendirme', @baslik, @metin, @id)",
            new
            {
                kullanici = (string)hedef.kullaniciAdi,
                baslik = $"Görüşme size yönlendirildi · {basvuru.adSoyad}",
                metin = basvuru.gorusmeTarihi is null
                    ? $"{basvuru.subeAdi}{(string.IsNullOrWhiteSpace(girdi.Not) ? "" : " · " + girdi.Not.Trim())}"
                    : $"{((DateTime)basvuru.gorusmeTarihi):dd.MM.yyyy HH:mm} · {basvuru.subeAdi}"
                      + (string.IsNullOrWhiteSpace(girdi.Not) ? "" : " · " + girdi.Not.Trim()),
                id
            });

        return Ok(new { basarili = true, adSoyad = (string)hedef.adSoyad });
    }

    /// <summary>
    /// Onaylayan, isteği reddetmeden geri gönderir.
    ///
    /// <para>
    /// Ret ile aynı şey değildir: ret kesin bir karardır, bu ise
    /// "şunu düzelt ve tekrar gönder" demektir. İstek "Yanıt Bekliyor"
    /// durumuna geçer ve isteyen kişiye bildirim düşer.
    /// </para>
    /// </summary>
    [HttpPost("Onay/{onayId:int}/Yanit")]
    [Authorize]
    public IActionResult OnayYaniti(int onayId, [FromBody] OnayGirdi girdi)
    {
        if (!OnayYetkisi)
            return StatusCode(403, new { hata = "Onaylama yetkiniz bulunmuyor." });

        if (string.IsNullOrWhiteSpace(girdi?.Not))
            return BadRequest(new { hata = "Açıklama yazınız." });

        using var db = _vt.Baglanti();

        var onay = db.QuerySingleOrDefault(@"
SELECT id, baslik, durum, isteyen FROM KRY_ONAY WHERE id = @onayId",
            new { onayId });

        if (onay is null) return NotFound(new { hata = "Onay kaydı bulunamadı." });

        if ((string)onay.durum != OnayDurumu.Bekliyor)
            return BadRequest(new { hata = "Bu istek zaten sonuçlandırılmış." });

        db.Execute(@"
UPDATE KRY_ONAY
SET durum = @durum, onay_notu = @not, onaylayan = @kullanici,
    onay_tarihi = SYSDATETIME(), bildirim_okundu = 0
WHERE id = @onayId",
            new
            {
                onayId,
                durum = OnayDurumu.YanitBekliyor,
                not = girdi.Not.Trim(),
                kullanici = Kullanici
            });

        OnayMesajYaz(db, onayId, "soru", girdi.Not.Trim());

        var isteyen = (string)onay.isteyen;

        if (!string.IsNullOrWhiteSpace(isteyen) &&
            !string.Equals(isteyen, Kullanici, StringComparison.OrdinalIgnoreCase))
        {
            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
VALUES (@kullanici, N'OnayYaniti', @baslik, @metin)",
                new
                {
                    kullanici = isteyen,
                    baslik = $"{(string)onay.baslik} · YANIT BEKLİYOR",
                    metin = $"{girdi.Not.Trim()} — Düzeltip yeniden onaya "
                            + "gönderebilirsiniz."
                });
        }

        return Ok(new { basarili = true });
    }

    /// <summary>
    /// İsteyen, yanıt aldıktan sonra düzeltip yeniden onaya sunar.
    /// </summary>
    [HttpPost("Onay/{onayId:int}/TekrarGonder")]
    [Authorize]
    public IActionResult OnayTekrarGonder(int onayId, [FromBody] OnayGirdi girdi)
    {
        using var db = _vt.Baglanti();

        var onay = db.QuerySingleOrDefault(@"
SELECT id, baslik, durum, isteyen FROM KRY_ONAY WHERE id = @onayId",
            new { onayId });

        if (onay is null) return NotFound(new { hata = "Onay kaydı bulunamadı." });

        if ((string)onay.durum != OnayDurumu.YanitBekliyor)
            return BadRequest(new { hata = "Bu istek yanıt bekliyor durumunda değil." });

        /* Yalnızca isteği açan kişi ya da yönetici tekrar gönderebilir */
        if (!string.Equals((string)onay.isteyen, Kullanici,
                StringComparison.OrdinalIgnoreCase) && !OnayYetkisi)
            return StatusCode(403, new { hata = "Bu isteği yalnızca açan kişi gönderebilir." });

        /* Yanıt zorunlu (22.10.2026): onaylayan sorusunun cevabını görmeli */
        if (string.IsNullOrWhiteSpace(girdi?.Not) || girdi.Not.Trim().Length < 3)
            return BadRequest(new { hata = "Onaylayanın sorusuna yanıt yazınız." });

        var ek = $" · Yanıt: {girdi.Not.Trim()}";

        /* Yazışma tablosundan önceki istek: soruyu onay_notu'ndan aktar ki kaybolmasın */
        try
        {
            db.Execute(@"
INSERT INTO KRY_ONAY_MESAJ (onay_id, tur, metin, kullanici, ad_soyad, tarih)
SELECT o.id, N'soru', o.onay_notu, o.onaylayan, k.ad_soyad, ISNULL(o.onay_tarihi, SYSDATETIME())
FROM KRY_ONAY o
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = o.onaylayan
WHERE o.id = @onayId AND ISNULL(o.onay_notu, N'') <> N''
  AND NOT EXISTS (SELECT 1 FROM KRY_ONAY_MESAJ m WHERE m.onay_id = o.id)", new { onayId });
        }
        catch
        {
            /* tablo yoksa geç */
        }

        OnayMesajYaz(db, onayId, "yanit", girdi.Not.Trim());

        db.Execute(@"
UPDATE KRY_ONAY
SET durum = @durum, onay_notu = NULL, onaylayan = NULL,
    onay_tarihi = NULL, bildirim_okundu = 0,
    ozet = CONCAT(ozet, @ek)
WHERE id = @onayId",
            new { onayId, durum = OnayDurumu.Bekliyor, ek });

        return Ok(new { basarili = true });
    }

    [HttpPost("Onay/{onayId:int}")]
    [Authorize]
    public IActionResult OnayKarari(int onayId, [FromBody] OnayGirdi girdi)
    {
        if (!OnayYetkisi)
            return StatusCode(403, new { hata = "Onaylama yetkiniz bulunmuyor." });

        /* Kararın kendisi OnayKarariServisi'nde (03.10.2026): Biçen360 patron
           görünümü de aynı kodu çağırıyor, iki yerde ayrı tutulmasın. Yetki
           denetimi burada kalıyor; davranış, mesajlar ve sıra aynı. */
        var sonuc = OnayKarariServisi.Uygula(
            _vt, onayId, girdi?.Onaylandi ?? false, girdi?.Not, Kullanici, KullaniciAdSoyad);

        return sonuc.Kod switch
        {
            404 => NotFound(new { hata = sonuc.Hata }),
            400 => BadRequest(new { hata = sonuc.Hata }),
            409 => Conflict(new { hata = sonuc.Hata }),
            _ => Ok(new { basarili = true, onaylandi = sonuc.Onaylandi })
        };
    }

    /// <summary>
    /// Form verisinden özel alanları çıkarır.
    ///
    /// Bölge müdürü ve koordinatör adayın kimlik numarası, doğum bilgileri,
    /// adresi ve referans kişilerinin bilgilerini göremez. Ad soyad, telefon,
    /// başvurduğu birim, pozisyon ve ücret talebi görünmeye devam eder.
    /// </summary>
    private static string OzelVerileriAyikla(string veriJson)
    {
        if (string.IsNullOrWhiteSpace(veriJson)) return veriJson;

        string[] gizlenecek =
        {
            "kimlikNo", "tcKimlikNo", "dogumTarihi", "dogumYeri",
            "anneAdi", "babaAdi", "kanGrubu", "medeniHal",
            "adres", "acikAdres", "mahalle", "sokak", "binaNo", "daireNo",
            "referanslar", "acilDurumKisi", "acilDurumTelefon",
            "sabikaKaydi", "saglikDurumu", "engelDurumu",
            "esBilgileri", "cocuklar", "askerlikDurumu",
            "iban", "bankaHesap"
        };

        try
        {
            using var belge = JsonDocument.Parse(veriJson);

            var sonuc = new Dictionary<string, object>();

            foreach (var alan in belge.RootElement.EnumerateObject())
            {
                if (gizlenecek.Contains(alan.Name, StringComparer.OrdinalIgnoreCase))
                    continue;

                sonuc[alan.Name] = alan.Value.Clone();
            }

            return JsonSerializer.Serialize(sonuc);
        }
        catch
        {
            /* Çözümlenemezse tamamı gizlenir: sızıntı riskine girilmez */
            return "{}";
        }
    }

    /* ==================================================================== */
    /* Görüşme takibi                                                        */
    /* ==================================================================== */

    /// <summary>
    /// Görüşme zamanı geçmiş ve yaklaşan adaylar.
    ///
    /// Zamanı geçenler için panelde uyarı penceresi açılır ve işlem yapılması
    /// beklenir. Yaklaşanlar hatırlatma olarak gösterilir.
    /// </summary>
    [HttpGet("GorusmeTakibi")]
    [Authorize]
    public IActionResult GorusmeTakibi()
    {
        using var db = _vt.Baglanti();

        var kayitlar = db.Query(@"
SELECT b.id AS id, b.basvuru_no AS basvuruNo, b.ad_soyad AS adSoyad,
       b.telefon AS telefon, b.sube_adi AS subeAdi,
       b.bolumler AS bolumler,
       b.gorusme_tarihi AS gorusmeTarihi, b.gorusme_yeri AS gorusmeYeri,
       b.guncelleyen AS sorumlu,
       ISNULL(k.ad_soyad, b.guncelleyen) AS sorumluAdSoyad,
       DATEDIFF(minute, b.gorusme_tarihi, SYSDATETIME()) AS gecenDakika
FROM KRY_BASVURULAR b
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = b.guncelleyen
WHERE b.durum = @durum
  AND b.gorusme_tarihi IS NOT NULL
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY b.gorusme_tarihi",
            new
            {
                durum = Durumlar.GorusmeTalebi,
                /* İK uzmanı yalnızca kendi şubelerinin görüşmelerini görür;
                   yönetici ve üstü tüm şubeleri görür. */
                subeSiniri = UzmanSiniri || SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = UzmanSiniri ? YetkiliSubeler() : SuzmeSubeleri()
            }).ToList();

        /* Zamanı geçenler: görüşme saatinin üzerinden 2 saat geçmiş olanlar.
           Kısa gecikmelerde uyarı çıkarmamak için tolerans bırakılır. */
        var gecenler = kayitlar
            .Where(x => (int)x.gecenDakika >= 120)
            .ToList();

        /* Yaklaşanlar: önümüzdeki 24 saat içindekiler */
        var yaklasanlar = kayitlar
            .Where(x => (int)x.gecenDakika < 0 && (int)x.gecenDakika > -1440)
            .ToList();

        return Ok(new
        {
            gecenAdet = gecenler.Count,
            yaklasanAdet = yaklasanlar.Count,
            gecenler,
            yaklasanlar
        });
    }

    /// <summary>
    /// Zamanı geçmiş bir görüşmeyi sonuçlandırır.
    ///
    /// "ertele" seçildiğinde yeni görüşme tarihi kaydedilir, aday görüşme
    /// talebi durumunda kalır. Diğer seçeneklerde durum değişir.
    /// </summary>
    [HttpPost("{id:int}/GorusmeSonuc")]
    [Authorize]
    public IActionResult GorusmeSonuc(int id, [FromBody] GorusmeSonucGirdi girdi)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (string.IsNullOrWhiteSpace(girdi?.Aciklama))
            return BadRequest(new { hata = "Açıklama zorunludur." });

        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault<BasvuruOzet>(
            "SELECT id, ad_soyad AS AdSoyad FROM KRY_BASVURULAR WHERE id = @id",
            new { id });

        if (kayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        var secim = (girdi.Secim ?? "").Trim();

        /* -------------------------------------------------------- erteleme */
        if (secim == "ertele")
        {
            if (girdi.YeniTarih is null)
                return BadRequest(new { hata = "Yeni görüşme tarihini seçiniz." });

            db.Execute(@"
UPDATE KRY_BASVURULAR
SET gorusme_tarihi = @tarih, guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id",
                new { id, tarih = girdi.YeniTarih, kullanici = Kullanici });

            db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
                new
                {
                    id,
                    durum = Durumlar.GorusmeTalebi,
                    aciklama = $"Görüşme ertelendi · Yeni tarih: " +
                               $"{girdi.YeniTarih:dd.MM.yyyy HH:mm} · {girdi.Aciklama.Trim()}",
                    kullanici = Kullanici
                });

            return Ok(new { basarili = true, durum = Durumlar.GorusmeTalebi });
        }

        /* --------------------------------------------- diğer sonuç seçimleri */
        /* 'gelmedi' ve 'ertele' ayrı seçimlerdir: aday gelmediyse görüşme
           kapanır ve değerlendirmeye düşer; erteleme ise yeni tarih ister
           ve aday görüşme talebi durumunda kalır. */
        var yeniDurum = secim switch
        {
            "olumlu" => Durumlar.Olumlu,
            "olumsuz" => Durumlar.Olumsuz,
            "gelmedi" => Durumlar.Degerlendirmede,
            "degerlendirmede" => Durumlar.Degerlendirmede,
            _ => null
        };

        if (yeniDurum is null)
            return BadRequest(new { hata = "Geçersiz seçim." });

        var onEk = secim switch
        {
            "olumlu" => "Görüşme yapıldı, olumlu",
            "olumsuz" => "Görüşme sonucu olumsuz",
            "gelmedi" => "ADAY GÖRÜŞMEYE GELMEDİ",
            _ => "Görüşme değerlendirmeye alındı"
        };

        db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum, guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id",
            new { id, durum = yeniDurum, kullanici = Kullanici });

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new
            {
                id,
                durum = yeniDurum,
                aciklama = $"{onEk} · {girdi.Aciklama.Trim()}",
                kullanici = Kullanici
            });

        return Ok(new { basarili = true, durum = yeniDurum });
    }

    /// <summary>
    /// Aday fotoğrafını görsel olarak döndürür.
    ///
    /// Liste ekranında her satır için ayrı istek yapılır; tarayıcı
    /// önbelleklediği için sayfa değiştikçe tekrar indirilmez.
    /// Belirteç adres satırından da okunabilir (img etiketi başlık gönderemez).
    /// </summary>
    [HttpGet("{id:int}/Fotograf")]
    [Authorize]
    public IActionResult Fotograf(int id)
    {
        using var db = _vt.Baglanti();

        var bayt = FotografBaytlari(db, id);

        if (bayt is null) return NotFound();

        /* Fotoğraf değişmediği için uzun süre önbelleklenebilir */
        Response.Headers["Cache-Control"] = "private, max-age=86400";

        return File(bayt, "image/jpeg");
    }

    /// <summary>
    /// Başvuru formundaki fotoğraf (yoksa ya da bozuksa null). Biçen360
    /// patron görünümü de buradan alıyor (03.10.2026).
    /// </summary>
    public static byte[] FotografBaytlari(System.Data.IDbConnection db, int id)
    {
        /* JSON_VALUE uzun değerlerde null döndürür; tüm gövde okunup
           sunucu tarafında ayrıştırılır. */
        var json = db.ExecuteScalar<string>(
            "SELECT veri_json FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (string.IsNullOrWhiteSpace(json)) return null;

        string veri = null;

        try
        {
            using var belge = JsonDocument.Parse(json);

            if (belge.RootElement.TryGetProperty("fotograf", out var foto) &&
                foto.ValueKind == JsonValueKind.Object &&
                foto.TryGetProperty("base64", out var b64) &&
                b64.ValueKind == JsonValueKind.String)
            {
                veri = b64.GetString();
            }
        }
        catch
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(veri)) return null;

        /* 'data:image/jpeg;base64,...' öneki varsa ayrılır */
        var virgul = veri.IndexOf(',');
        var govde = virgul > 0 && virgul < 100 ? veri[(virgul + 1)..] : veri;

        try
        {
            return Convert.FromBase64String(govde);
        }
        catch
        {
            return null;
        }
    }

    /* ==================================================================== */
    /* İK referansları                                                       */
    /* ==================================================================== */

    /// <summary>Başvuruya ait İK referansları ve görüşme notları.</summary>
    [HttpGet("{id:int}/Referanslar")]
    [Authorize]
    public IActionResult Referanslar(int id)
    {
        using var db = _vt.Baglanti();

        var liste = ReferansListesi(db, id);

        if (FormReferanslariniAktar(db, id, liste))
            liste = ReferansListesi(db, id);

        return Ok(liste);
    }

    private static List<IkReferansi> ReferansListesi(System.Data.IDbConnection db, int id) =>
        db.Query<IkReferansi>(@"
SELECT r.id AS Id, r.basvuru_id AS BasvuruId, r.ad_soyad AS AdSoyad,
       r.calistigi_yer AS CalistigiYer, r.gorev AS Gorev,
       r.telefon AS Telefon, r.yakinlik AS Yakinlik,
       r.gorusuldu_mu AS GorusulduMu, r.gorusme_tarihi AS GorusmeTarihi,
       r.gorusme_sonucu AS GorusmeSonucu, r.gorusme_notu AS GorusmeNotu,
       r.puan AS Puan,
       r.kullanici AS Kullanici, r.olusturma AS Olusturma,
       ISNULL(k.ad_soyad, r.kullanici) AS KullaniciAdSoyad
FROM KRY_REFERANS r
LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = r.kullanici
WHERE r.basvuru_id = @id
ORDER BY r.id", new { id }).ToList();

    /// <summary>
    /// Adayın formda yazdığı referanslar İK listesinde yoksa bir kez
    /// kopyalanır (aynı ad soyad tekrar eklenmez). Ekleme olduysa true.
    /// </summary>
    private static bool FormReferanslariniAktar(System.Data.IDbConnection db, int id, List<IkReferansi> liste)
    {
        var formJson = db.ExecuteScalar<string>(
            "SELECT veri_json FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (string.IsNullOrWhiteSpace(formJson)) return false;

        try
        {
            using var belge = JsonDocument.Parse(formJson);

            if (!belge.RootElement.TryGetProperty("referanslar", out var dizi) ||
                dizi.ValueKind != JsonValueKind.Array)
                return false;

            var eklendi = false;

            foreach (var r in dizi.EnumerateArray())
            {
                var ad = Metin(r, "adSoyad");
                if (string.IsNullOrWhiteSpace(ad)) continue;

                if (liste.Any(x => string.Equals((x.AdSoyad ?? "").Trim(), ad.Trim(),
                        StringComparison.OrdinalIgnoreCase)))
                    continue;

                db.Execute(@"
INSERT INTO KRY_REFERANS
    (basvuru_id, ad_soyad, calistigi_yer, gorev, telefon, yakinlik,
     gorusuldu_mu, kullanici)
VALUES (@id, @adSoyad, @calistigiYer, @gorev, @telefon, @yakinlik, 0, N'form')",
                    new
                    {
                        id,
                        adSoyad = ad.Trim(),
                        calistigiYer = Metin(r, "calistigiYer"),
                        gorev = Metin(r, "gorev"),
                        telefon = Metin(r, "telefon"),
                        yakinlik = Metin(r, "yakinlik")
                    });

                liste.Add(new IkReferansi { AdSoyad = ad.Trim() });
                eklendi = true;
            }

            return eklendi;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    /// <summary>Aday formundaki referansları kurala göre denetler.</summary>
    private string FormReferansDenetle(JsonElement govde)
    {
        var form = _ayar.FormOku();
        var kural = form.ReferansKurali ?? new ReferansKurali();
        if (!kural.Acik) return null;

        var bolumler = new List<string>();
        if (govde.TryGetProperty("bolumler", out var b) && b.ValueKind == JsonValueKind.Array)
            bolumler.AddRange(b.EnumerateArray().Where(x => x.ValueKind == JsonValueKind.String).Select(x => x.GetString()));

        var subeKodu = Metin(govde, "subeKodu");
        var tur = form.Subeler?.FirstOrDefault(x => string.Equals(x.Kod, subeKodu, StringComparison.OrdinalIgnoreCase))?.Tur
                  ?? Metin(govde, "birimTuru");

        var gereken = kural.Gereken(tur, bolumler);
        if (gereken == 0) return null;

        var gecerli = 0;
        if (govde.TryGetProperty("referanslar", out var r) && r.ValueKind == JsonValueKind.Array)
            gecerli = r.EnumerateArray()
                .Where(x => x.ValueKind == JsonValueKind.Object)
                .Count(x => ReferansKurali.GecerliMi(Metin(x, "adSoyad"), Metin(x, "telefon")));

        return gecerli >= gereken
            ? null
            : $"Başvurduğunuz pozisyon için en az {gereken} referans (ad soyad ve telefon) girmeniz gerekiyor.";
    }

    /// <summary>İşe alım için referans gereksinimi ve mevcut geçerli sayı.</summary>
    private (int Gereken, int Mevcut) ReferansGereksinimi(System.Data.IDbConnection db, int id, string bolum, string subeKodu)
    {
        var form = _ayar.FormOku();
        var kural = form.ReferansKurali ?? new ReferansKurali();

        var b = db.QuerySingleOrDefault<RefBasvuru>(@"
SELECT COALESCE(ise_giris_bolum, bolumler) AS Bolum, birim_turu AS Tur, sube_kodu AS Kod, olusturma AS Olusturma
FROM KRY_BASVURULAR WHERE id = @id", new { id }) ?? new RefBasvuru();

        /* Kural yürürlüğe girmeden önce gelen başvuruda referans aranmaz */
        if (kural.GecerlilikBaslangic is DateTime gb && b.Olusturma is DateTime ol && ol < gb.Date)
            return (0, 0);

        var kod = string.IsNullOrWhiteSpace(subeKodu) ? b.Kod : subeKodu;
        var tur = form.Subeler?.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))?.Tur ?? b.Tur;
        var poz = string.IsNullOrWhiteSpace(bolum) ? b.Bolum : bolum;

        var gereken = kural.Gereken(tur, (poz ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        if (gereken == 0) return (0, 0);

        var liste = ReferansListesi(db, id);
        if (FormReferanslariniAktar(db, id, liste)) liste = ReferansListesi(db, id);

        return (gereken, liste.Count(x => ReferansKurali.GecerliMi(x.AdSoyad, x.Telefon)));
    }

    private sealed class RefBasvuru { public string Bolum { get; set; } public string Tur { get; set; } public string Kod { get; set; } public DateTime? Olusturma { get; set; } }

    /// <summary>İşe al penceresi için: bu pozisyonda kaç referans gerekli, kaçı var.</summary>
    [HttpGet("{id:int}/ReferansDurumu")]
    [Authorize]
    public IActionResult ReferansDurumu(int id, [FromQuery] string bolum, [FromQuery] string subeKodu)
    {
        using var db = _vt.Baglanti();
        var (gereken, mevcut) = ReferansGereksinimi(db, id, bolum, subeKodu);
        return Ok(new { gereken, mevcut, eksik = Math.Max(0, gereken - mevcut) });
    }

    /// <summary>JSON alanını güvenli biçimde metin olarak okur.</summary>
    private static string Metin(JsonElement kok, string alan) =>
        kok.TryGetProperty(alan, out var deger) && deger.ValueKind == JsonValueKind.String
            ? deger.GetString()
            : null;

    /// <summary>Referans ekler veya günceller.</summary>
    [HttpPost("{id:int}/Referans")]
    [Authorize]
    public IActionResult ReferansKaydet(int id, [FromBody] IkReferansi girdi)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        if (girdi is null || string.IsNullOrWhiteSpace(girdi.AdSoyad))
            return BadRequest(new { hata = "Referansın adı soyadı zorunludur." });

        if (girdi.Puan is < 1 or > 10)
            return BadRequest(new { hata = "Puan 1 ile 10 arasında olmalıdır." });

        using var db = _vt.Baglanti();

        /* Görüşüldü işaretlenmişse tarih kendiliğinden atanır */
        var gorusmeTarihi = girdi.GorusulduMu
            ? girdi.GorusmeTarihi ?? DateTime.Now
            : (DateTime?)null;

        if (girdi.Id > 0)
        {
            db.Execute(@"
UPDATE KRY_REFERANS
SET ad_soyad = @adSoyad, calistigi_yer = @calistigiYer, gorev = @gorev,
    telefon = @telefon, yakinlik = @yakinlik,
    gorusuldu_mu = @gorusulduMu, gorusme_tarihi = @gorusmeTarihi,
    gorusme_sonucu = @gorusmeSonucu, gorusme_notu = @gorusmeNotu,
    puan = @puan, guncelleme = SYSDATETIME()
WHERE id = @id AND basvuru_id = @basvuruId",
                new
                {
                    id = girdi.Id,
                    basvuruId = id,
                    adSoyad = girdi.AdSoyad.Trim(),
                    calistigiYer = girdi.CalistigiYer,
                    gorev = girdi.Gorev,
                    telefon = girdi.Telefon,
                    yakinlik = girdi.Yakinlik,
                    gorusulduMu = girdi.GorusulduMu,
                    gorusmeTarihi,
                    gorusmeSonucu = girdi.GorusmeSonucu,
                    gorusmeNotu = girdi.GorusmeNotu,
                    puan = girdi.Puan
                });

            PuanaGoreOlumsuzYap(db, id, girdi.Puan);

            return Ok(new { basarili = true, id = girdi.Id });
        }

        var yeniId = db.ExecuteScalar<int>(@"
INSERT INTO KRY_REFERANS
    (basvuru_id, ad_soyad, calistigi_yer, gorev, telefon, yakinlik,
     gorusuldu_mu, gorusme_tarihi, gorusme_sonucu, gorusme_notu, puan, kullanici)
OUTPUT INSERTED.id
VALUES (@basvuruId, @adSoyad, @calistigiYer, @gorev, @telefon, @yakinlik,
        @gorusulduMu, @gorusmeTarihi, @gorusmeSonucu, @gorusmeNotu, @puan, @kullanici)",
            new
            {
                basvuruId = id,
                adSoyad = girdi.AdSoyad.Trim(),
                calistigiYer = girdi.CalistigiYer,
                gorev = girdi.Gorev,
                telefon = girdi.Telefon,
                yakinlik = girdi.Yakinlik,
                gorusulduMu = girdi.GorusulduMu,
                gorusmeTarihi,
                gorusmeSonucu = girdi.GorusmeSonucu,
                gorusmeNotu = girdi.GorusmeNotu,
                puan = girdi.Puan,
                kullanici = Kullanici
            });

        PuanaGoreOlumsuzYap(db, id, girdi.Puan);

        return Ok(new { basarili = true, id = yeniId });
    }

    /// <summary>
    /// Referans görüşmesi puanı 5'in altındaysa başvuruyu otomatik olarak
    /// "Olumsuz" durumuna çeker. Aday zaten işe alınmışsa ya da evrak
    /// süreci başlamışsa dokunulmaz — o karar artık geri alınabilir bir
    /// durum değildir, elle değerlendirilmesi gerekir.
    /// </summary>
    private void PuanaGoreOlumsuzYap(IDbConnection db, int basvuruId, int? puan)
    {
        if (puan is null || puan >= 5) return;

        var mevcutDurum = db.ExecuteScalar<string>(
            "SELECT durum FROM KRY_BASVURULAR WHERE id = @id", new { id = basvuruId });

        if (mevcutDurum is Durumlar.IseAlindi or Durumlar.EvrakHazirlaniyor
                        or Durumlar.Olumsuz)
            return;

        db.Execute(@"
UPDATE KRY_BASVURULAR
SET durum = @durum, guncelleme = SYSDATETIME(), guncelleyen = @kullanici
WHERE id = @id",
            new { id = basvuruId, durum = Durumlar.Olumsuz, kullanici = Kullanici });

        var aciklama = $"Referans görüşmesi puanı {puan}/10 (otomatik olumsuz).";

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, @aciklama, @kullanici)",
            new { id = basvuruId, durum = Durumlar.Olumsuz, aciklama, kullanici = Kullanici });
    }

    /// <summary>Referansı siler.</summary>
    [HttpDelete("{id:int}/Referans/{referansId:int}")]
    [Authorize]
    public IActionResult ReferansSil(int id, int referansId)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        db.Execute("DELETE FROM KRY_REFERANS WHERE id = @referansId AND basvuru_id = @id",
            new { referansId, id });

        return Ok(new { basarili = true });
    }

    /* ---------------------------------------------------------------- notlar */

    /// <summary>
    /// Başvuruya dahili not ekler. Notlar yalnızca panel kullanıcılarına
    /// gösterilir; adayın sorgulama ekranında görünmez.
    /// </summary>
    /* ==================================================================== */
    /* Bildirimler                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Oturum sahibinin bildirimleri. Panel bunu düzenli aralıkla çağırır:
    /// <c>yeniler</c> henüz ekranda gösterilmemiş olanlardır ve gösterildikten
    /// sonra <c>Gosterildi</c> ile işaretlenir; böylece aynı bildirim iki kez
    /// ekrana düşmez ama bildirim listesinde kalmaya devam eder.
    /// </summary>
    [HttpGet("Bildirimler")]
    [Authorize]
    public IActionResult Bildirimler()
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT TOP 100
       id         AS id,
       tur        AS tur,
       baslik     AS baslik,
       metin      AS metin,
       basvuru_id AS basvuruId,
       okundu     AS okundu,
       gosterildi AS gosterildi,
       olusturma  AS olusturma
FROM KRY_BILDIRIM
WHERE kullanici = @kullanici
ORDER BY olusturma DESC", new { kullanici = Kullanici }).ToList();

        var okunmamis = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BILDIRIM
WHERE kullanici = @kullanici AND okundu = 0", new { kullanici = Kullanici });

        return Ok(new { liste, okunmamis });
    }

    /// <summary>Ekranda gösterilen bildirimleri işaretler.</summary>
    [HttpPost("Bildirimler/Gosterildi")]
    [Authorize]
    public IActionResult BildirimGosterildi([FromBody] int[] idler)
    {
        if (idler is null || idler.Length == 0) return Ok(new { basarili = true });

        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_BILDIRIM SET gosterildi = 1
WHERE kullanici = @kullanici AND id IN @idler",
            new { kullanici = Kullanici, idler });

        return Ok(new { basarili = true });
    }

    /// <summary>Bildirimleri okundu olarak işaretler. Boş gönderilirse hepsi.</summary>
    [HttpPost("Bildirimler/Okundu")]
    [Authorize]
    public IActionResult BildirimOkundu([FromBody] int[] idler)
    {
        using var db = _vt.Baglanti();

        if (idler is null || idler.Length == 0)
        {
            db.Execute(@"
UPDATE KRY_BILDIRIM SET okundu = 1, gosterildi = 1
WHERE kullanici = @kullanici AND okundu = 0", new { kullanici = Kullanici });
        }
        else
        {
            db.Execute(@"
UPDATE KRY_BILDIRIM SET okundu = 1, gosterildi = 1
WHERE kullanici = @kullanici AND id IN @idler",
                new { kullanici = Kullanici, idler });
        }

        return Ok(new { basarili = true });
    }

    /* ==================================================================== */
    /* Görüşme takvimi                                                       */
    /* ==================================================================== */

    /// <summary>
    /// Verilen tarih aralığındaki görüşme taleplerini döndürür.
    ///
    /// Takvim ekranı bunu kullanır: İK uzmanı oluşturduğu görüşmeleri
    /// gün gün görür, üzerine tıklayıp not ekleyebilir. Notlar başvurunun
    /// kendi not listesine yazılır, ayrı bir yerde tutulmaz — böylece
    /// başvuru detayında ve İK performans ekranında da görünürler.
    /// </summary>
    [HttpGet("GorusmeTakvimi")]
    [Authorize]
    public IActionResult GorusmeTakvimi(
        [FromQuery] DateTime? bas, [FromQuery] DateTime? bit)
    {
        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-30);
        var bitis = (bit?.Date ?? DateTime.Today.AddDays(60)).AddDays(1).AddSeconds(-1);

        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT b.id                AS id,
       b.basvuru_no        AS basvuruNo,
       b.ad_soyad          AS adSoyad,
       b.telefon           AS telefon,
       b.sube_kodu         AS subeKodu,
       b.sube_adi          AS subeAdi,
       b.bolumler          AS bolumler,
       b.durum             AS durum,
       b.gorusme_tarihi    AS gorusmeTarihi,
       b.gorusme_yeri      AS gorusmeYeri,
       (SELECT COUNT(*) FROM KRY_BASVURU_NOT n WHERE n.basvuru_id = b.id) AS notSayisi,
       /* Görüşmeyi kim oluşturdu. Kullanıcı adı yerine ad soyad
          gösterilir; takvimde kullanıcı adı değil tam ad okunsun. */
       /* Hareket kaydı yoksa (eski görüşmeler, başka akıştan
          oluşturulanlar) başvurudaki guncelleyen alanına düşülür;
          alan boş kalıp kimin oluşturduğu kaybolmasın. */
       ISNULL(
         (SELECT TOP 1 ISNULL(k.ad_soyad, h.kullanici)
          FROM KRY_BASVURU_HAREKET h
              LEFT JOIN KRY_KULLANICILAR k ON k.kullanici_adi = h.kullanici
           WHERE h.basvuru_id = b.id AND h.durum = N'Görüşme Talebi'
           ORDER BY h.tarih DESC),
         (SELECT TOP 1 ISNULL(k2.ad_soyad, b.guncelleyen)
          FROM KRY_KULLANICILAR k2
          WHERE k2.kullanici_adi = b.guncelleyen)
       ) AS olusturan
FROM KRY_BASVURULAR b
WHERE b.gorusme_tarihi IS NOT NULL
  AND b.gorusme_tarihi BETWEEN @bas AND @bit
  AND (@subeSiniri = 0 OR b.sube_kodu IN @yetkiliSubeler)
ORDER BY b.gorusme_tarihi",
            new
            {
                bas = baslangic,
                bit = bitis,
                subeSiniri = SubeSuzmesi ? 1 : 0,
                yetkiliSubeler = SuzmeSubeleri()
            }).ToList();

        return Ok(liste);
    }

    [HttpPost("{id:int}/Not")]
    [Authorize]
    public IActionResult NotEkle(int id, [FromBody] NotGirdi girdi)
    {
        var metin = (girdi?.Metin ?? "").Trim();

        if (string.IsNullOrWhiteSpace(metin))
            return BadRequest(new { hata = "Not metni boş olamaz." });

        if (metin.Length > 4000)
            return BadRequest(new { hata = "Not en fazla 4000 karakter olabilir." });

        using var db = _vt.Baglanti();

        var varMi = db.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (varMi == 0) return NotFound(new { hata = "Başvuru bulunamadı." });

        var yeniId = NotYaz(db, id, metin, Kullanici, KullaniciAdSoyad);

        return Ok(new { basarili = true, id = yeniId });
    }

    /// <summary>
    /// Başvuruya not yazar (03.10.2026'da ayrıldı): Biçen360 patron
    /// görünümünden yazılan not da panelde aynı tabloda, aynı biçimde
    /// görünsün. Doğrulama çağıranda.
    /// </summary>
    internal static int NotYaz(IDbConnection db, int id, string metin, string kullanici, string adSoyad) =>
        db.ExecuteScalar<int>(@"
INSERT INTO KRY_BASVURU_NOT (basvuru_id, metin, kullanici, ad_soyad)
OUTPUT INSERTED.id
VALUES (@id, @metin, @kullanici, @adSoyad)",
            new { id, metin, kullanici, adSoyad });

    /// <summary>Notu siler. Kullanıcı yalnızca kendi notunu silebilir; yönetici hepsini.</summary>
    [HttpDelete("Not/{notId:int}")]
    [Authorize]
    public IActionResult NotSil(int notId)
    {
        using var db = _vt.Baglanti();

        var sahibi = db.ExecuteScalar<string>(
            "SELECT kullanici FROM KRY_BASVURU_NOT WHERE id = @notId", new { notId });

        if (sahibi is null) return NotFound(new { hata = "Not bulunamadı." });

        var yonetici = User.IsInRole(Roller.Admin);

        if (!yonetici && !string.Equals(sahibi, Kullanici, StringComparison.OrdinalIgnoreCase))
            return StatusCode(403, new { hata = "Yalnızca kendi notunuzu silebilirsiniz." });

        db.Execute("DELETE FROM KRY_BASVURU_NOT WHERE id = @notId", new { notId });

        return Ok(new { basarili = true });
    }

    /// <summary>Bildirim mailini yeniden gönderir.</summary>
    [HttpPost("{id:int}/MailTekrar")]
    [Authorize]
    public async Task<IActionResult> MailTekrar(int id)
    {
        if (!IslemYapabilir)
            return StatusCode(403, new { hata = "Bu işlem için yetkiniz bulunmuyor." });

        using var db = _vt.Baglanti();

        var kayit = db.QuerySingleOrDefault(@"
SELECT basvuru_no, veri_json FROM KRY_BASVURULAR WHERE id = @id", new { id });

        if (kayit is null) return NotFound(new { hata = "Başvuru bulunamadı." });

        var gonderildi = await _mail.BasvuruBildirAsync(
            (string)kayit.veri_json, (string)kayit.basvuru_no);

        if (!gonderildi)
        {
            return BadRequest(new
            {
                hata = string.IsNullOrWhiteSpace(_mail.SonHataMesaji)
                    ? "Mail gönderilemedi. Mail ayarlarını kontrol ediniz."
                    : _mail.SonHataMesaji
            });
        }

        db.Execute("UPDATE KRY_BASVURULAR SET mail_gonderildi = 1 WHERE id = @id", new { id });

        db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
SELECT @id, durum, 'Bildirim maili yeniden gönderildi.', @kullanici
FROM KRY_BASVURULAR WHERE id = @id",
            new { id, kullanici = Kullanici });

        return Ok(new { basarili = true });
    }

    /* --------------------------------------------------------------- yardımcı */

    private static string Sadelestir(string deger) =>
        new(( deger ?? "").Where(char.IsLetterOrDigit).ToArray());

    private static string SonOnHane(string deger)
    {
        var rakam = new string((deger ?? "").Where(char.IsDigit).ToArray());
        return rakam.Length <= 10 ? rakam : rakam[^10..];
    }
}

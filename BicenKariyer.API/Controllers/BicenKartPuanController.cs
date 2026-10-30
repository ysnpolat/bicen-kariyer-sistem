using System.Data;
using System.Text;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using BicenKariyer.API.Servisler;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen Kart puan yönetimi (29.09.2026).
///
/// <para>
/// Puan yükleme (tek kart ya da Excel ile toplu) önce talep olarak
/// kaydediliyor; Admin onaylayınca <c>PuanHareket</c>'e yazılıyor.
/// Reddedilen talepte puan yatmıyor. İki durumda da talep edene panel
/// bildirimi düşüyor; onaydan sonra ayarlı adrese (varsayılan
/// ulas.bicen@bicen.com.tr) ayrıntılı e-posta gidiyor.
/// </para>
///
/// <para>
/// Satırlar Posback'in yazdığı biçimle aynı: Id yeni GUID, BelgeNo 0,
/// FirmaId 48, KasaId 0, PromosyonTanimId B1D413A6-…, PuanKodu 1, SubeId 0,
/// PosbackId sıfır GUID. İşlem tipleri: 1 kazanma, 2 harcama, 3 yükleme,
/// 4 devir, 5 sıfırlama, 6 silme, 9 harcama iade.
/// </para>
///
/// <para>
/// Bakiye Posback'in kendi hesabı (dbo.PuanBakiye): kazanma (1), yükleme
/// (3) ve devir (4) satırları birer parti, EksiPuan partiden kullanılan
/// tutar; bakiye süresi geçmemiş partilerde kalanların toplamı. Yükleme
/// yeni bir parti yazıyor (EksiPuan 0). Silme Posback'in yaptığı gibi:
/// 6 kayıt satırı + dbo.EksiPuanIsle ile tutarın en eski partilerden
/// düşülmesi. Transfer: kaynaktan silme gibi düşülüyor, hedefe 4 (devir)
/// partisi yazılıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IK + "," + Roller.IKYoneticisi
                 + "," + Roller.GenelMudurYardimcisi)]
public class BicenKartPuanController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly MailServisi _mail;
    private readonly BildirimServisi _bildirim;
    private readonly IConfiguration _yapilandirma;
    private readonly ILogger<BicenKartPuanController> _kayit;
    private readonly IServiceProvider _saglayici;

    private const string HAREKET = "[PosbackPromosyon].[dbo].[PuanHareket]";
    private const string KART = "[PosbackPromosyon].[dbo].[MusteriKart]";

    private const int YUKLEME = 3, DEVIR = 4, SILME = 6;

    /// <summary>Tek talepteki en fazla satır ve kart başına en fazla puan.</summary>
    private const int EN_COK_SATIR = 5000;
    private const decimal EN_COK_PUAN = 100000m;

    public BicenKartPuanController(VeritabaniServisi vt, PersonelKaynagiServisi personelKaynak,
        MailServisi mail, BildirimServisi bildirim, IConfiguration yapilandirma,
        ILogger<BicenKartPuanController> kayit, IServiceProvider saglayici)
    {
        _saglayici = saglayici;
        _bildirim = bildirim;
        _vt = vt;
        _personelKaynak = personelKaynak;
        _mail = mail;
        _yapilandirma = yapilandirma;
        _kayit = kayit;
    }

    /* ------------------------------------------------------------ ayarlar */

    private int FirmaId => int.TryParse(_yapilandirma["BicenKart:FirmaId"], out var f) ? f : 48;

    private Guid PromosyonTanimId =>
        Guid.TryParse(_yapilandirma["BicenKart:PromosyonTanimId"], out var g)
            ? g
            : Guid.Parse("B1D413A6-F004-4385-ACDE-73679726BA9D");

    private int PuanKodu => int.TryParse(_yapilandirma["BicenKart:PuanKodu"], out var k) ? k : 1;

    /// <summary>Onaydan sonra e-posta gidecek adresler (virgülle birden çok).</summary>
    private List<string> EpostaAlicilari =>
        (_yapilandirma["BicenKart:PuanEposta"] ?? "ulas.bicen@bicen.com.tr")
        .Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        .ToList();

    /// <summary>Transfer ve silmede yazılan satırların son kullanma tarihi (hesapta kullanılmıyor).</summary>
    private static readonly DateTime VarsayilanSonKullanim = new(2029, 11, 30);

    /* Biçen360 patron onayında (PatronMobilController) karar veren dışarıdan veriliyor */
    private string _disKullanici, _disAd;

    private string Kullanici => _disKullanici ?? User?.Identity?.Name ?? "panel";

    private string AdSoyad =>
        _disAd ?? User?.Claims.FirstOrDefault(x => x.Type == "adSoyad")?.Value ?? Kullanici;

    private bool Admin => User?.IsInRole(Roller.Admin) == true;

    private static string Temizle(string kartNo) => new((kartNo ?? "").Where(char.IsDigit).ToArray());

    private static string Tl(decimal d) => d.ToString("N2", new System.Globalization.CultureInfo("tr-TR"));

    private IDbConnection AcikPos()
    {
        var db = _vt.PosBaglantisi();
        db.Open();
        return db;
    }

    /* ---------------------------------------------------------- kart bilgisi */

    private sealed record KartBilgi(bool Var, string KartAdi, string Sicil, string AdSoyad, string Sube);

    /// <summary>Kartlar MusteriKart'ta var mı, kimde (eşleşme) — toplu.</summary>
    private Dictionary<string, KartBilgi> KartBilgileri(IEnumerable<string> kartlar)
    {
        var liste = kartlar.Where(x => x.Length > 0).Distinct().ToList();
        var sonuc = new Dictionary<string, KartBilgi>();

        if (liste.Count == 0) return sonuc;

        var adlar = new Dictionary<string, string>();

        using (var pos = _vt.PosBaglantisi())
        {
            foreach (var parca in liste.Chunk(400))
                foreach (var k in pos.Query($@"
SELECT CONVERT(VARCHAR(50), KartNo) AS kartNo, LTRIM(RTRIM(ISNULL(Ad, N''))) AS ad
FROM {KART} WHERE KartNo IN @parca", new { parca = PosParametre.Ansi(parca) }, commandTimeout: 120))
                    adlar[((string)k.kartNo ?? "").Trim()] = (string)k.ad;
        }

        var eslesme = new Dictionary<string, string>();

        using (var db = _vt.Baglanti())
        {
            foreach (var parca in liste.Chunk(400))
                foreach (var e in db.Query(
                    "SELECT kart_no AS kartNo, personel_kodu AS sicil FROM KRY_KART_ESLESME WHERE kart_no IN @parca",
                    new { parca }))
                    eslesme[((string)e.kartNo ?? "").Trim()] = ((string)e.sicil ?? "").Trim();
        }

        var personel = eslesme.Count == 0
            ? new Dictionary<string, PersonelKaydi>()
            : _personelKaynak.TumPersonelleriGetir()
                .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
                .GroupBy(x => x.PersonelKodu.Trim())
                .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Durum == 1).First());

        foreach (var k in liste)
        {
            var var = adlar.TryGetValue(k, out var ad);
            eslesme.TryGetValue(k, out var sicil);
            PersonelKaydi p = null;
            if (sicil is not null) personel.TryGetValue(sicil, out p);

            sonuc[k] = new KartBilgi(var, ad, sicil,
                p is null ? null : $"{p.Ad} {p.Soyad}".Trim(),
                p?.IsGrubu?.Trim());
        }

        return sonuc;
    }

    /// <summary>Tek kart: sahibi ve bakiyesi (ekranda kart numarası girilince).</summary>
    [HttpGet("Kart")]
    public IActionResult Kart([FromQuery] string kartNo)
    {
        var no = Temizle(kartNo);

        if (no.Length < 6) return BadRequest(new { hata = "Kart numarasını giriniz." });

        try
        {
            var b = KartBilgileri(new[] { no })[no];

            if (!b.Var) return NotFound(new { hata = "Bu numarayla kart bulunamadı." });

            using var pos = _vt.PosBaglantisi();

            return Ok(new
            {
                kartNo = no,
                kartAdi = b.KartAdi,
                sicil = b.Sicil,
                adSoyad = b.AdSoyad ?? b.KartAdi,
                sube = b.Sube,
                bakiye = GiftKartServisi.BakiyeSorgusu(pos, no, PuanKodu),
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Kart bilgisi okunamadı: {Kart}", no);
            return StatusCode(502, new { hata = "Kart sunucusuna ulaşılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Personeller sayfası: personelin Biçen Kartı ve bakiyesi.</summary>
    [HttpGet("Personel/{sicil}")]
    public IActionResult Personel(string sicil)
    {
        var kod = (sicil ?? "").Trim();

        using var db = _vt.Baglanti();

        var kart = db.ExecuteScalar<string>(
            "SELECT TOP 1 kart_no FROM KRY_KART_ESLESME WHERE personel_kodu = @kod", new { kod });

        if (string.IsNullOrWhiteSpace(kart)) return Ok(new { kartNo = (string)null });

        kart = kart.Trim();

        try
        {
            using var pos = _vt.PosBaglantisi();

            var k = pos.QueryFirstOrDefault($@"
SELECT GrupNo AS grupNo, CASE WHEN KartSifre IS NULL THEN 0 ELSE 1 END AS sifreVar
FROM {KART} WHERE KartNo = CONVERT(VARCHAR(50), @kart)", new { kart });

            return Ok(new
            {
                kartNo = kart,
                bakiye = GiftKartServisi.BakiyeSorgusu(pos, kart, PuanKodu),
                mobil = k is not null && k.grupNo is not null && (int)k.grupNo == 608,
                sifreVar = k is not null && (int)k.sifreVar == 1,
                kartBulunamadi = k is null,
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Personel kartı okunamadı: {Kod}", kod);
            return Ok(new { kartNo = kart, bakiye = (decimal?)null, hata = "Bakiye okunamadı." });
        }
    }

    /* -------------------------------------------------------------- özet */

    [HttpGet("Ozet")]
    public IActionResult Ozet()
    {
        using var db = _vt.Baglanti();

        var ayBasi = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);

        var islem = db.Query(@"
SELECT tur, COUNT(*) AS adet, COUNT(DISTINCT kart_no) AS kart, ISNULL(SUM(puan), 0) AS puan
FROM KRY_PUAN_ISLEM WHERE tarih >= @ayBasi GROUP BY tur", new { ayBasi })
            .ToDictionary(x => (string)x.tur, x => x);

        var toplu = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_PUAN_TALEP WHERE durum = N'onaylandi' AND tur = N'toplu' AND karar_tarihi >= @ayBasi",
            new { ayBasi });

        var bekleyen = db.QueryFirst(@"
SELECT COUNT(*) AS adet, ISNULL(SUM(kart_sayisi), 0) AS kart, ISNULL(SUM(toplam_puan), 0) AS puan
FROM KRY_PUAN_TALEP WHERE durum = N'bekliyor'");

        object Kutu(string tur) => islem.TryGetValue(tur, out var x)
            ? new { adet = (int)x.adet, kart = (int)x.kart, puan = (decimal)x.puan }
            : new { adet = 0, kart = 0, puan = 0m };

        return Ok(new
        {
            yukleme = Kutu("yukleme"),
            topluYukleme = toplu,
            transfer = Kutu("transfer"),
            silme = Kutu("silme"),
            bekleyen = new { adet = (int)bekleyen.adet, kart = (int)bekleyen.kart, puan = (decimal)bekleyen.puan },
            admin = Admin,
        });
    }

    /* ------------------------------------------------------ talep oluşturma */

    public class SatirGirdi
    {
        public string KartNo { get; set; }
        public decimal Puan { get; set; }

        /// <summary>Prim yüklemesinde personel kodu: kart eşleşmesi silinmişse sicil buradan</summary>
        public string Sicil { get; set; }
    }

    public class KontrolGirdi
    {
        public List<SatirGirdi> Satirlar { get; set; } = new();
    }

    /// <summary>Excel satırlarının denetimi: kart var mı, kimde, tekrar eden var mı.</summary>
    [HttpPost("Kontrol")]
    public IActionResult Kontrol([FromBody] KontrolGirdi g)
    {
        var satirlar = g?.Satirlar ?? new List<SatirGirdi>();

        if (satirlar.Count == 0) return BadRequest(new { hata = "Satır yok." });
        if (satirlar.Count > EN_COK_SATIR)
            return BadRequest(new { hata = $"Tek seferde en fazla {EN_COK_SATIR} satır yüklenebilir." });

        Dictionary<string, KartBilgi> bilgi;

        try
        {
            bilgi = KartBilgileri(satirlar.Select(x => Temizle(x.KartNo)));
        }
        catch (Exception hata)
        {
            return StatusCode(502, new { hata = "Kart sunucusuna ulaşılamadı.", ayrinti = hata.Message });
        }

        var gorulen = new HashSet<string>();

        var sonuc = satirlar.Select((x, i) =>
        {
            var no = Temizle(x.KartNo);
            string durum;

            if (no.Length < 6) durum = "gecersiz";
            else if (x.Puan <= 0 || x.Puan > EN_COK_PUAN) durum = "puan";
            else if (!gorulen.Add(no)) durum = "tekrar";
            else if (!bilgi.TryGetValue(no, out var b) || !b.Var) durum = "yok";
            else durum = "hazir";

            bilgi.TryGetValue(no, out var k);

            return new
            {
                sira = i + 1,
                kartNo = no,
                puan = x.Puan,
                durum,
                adSoyad = k?.AdSoyad ?? k?.KartAdi,
                sicil = k?.Sicil,
                sube = k?.Sube,
            };
        }).ToList();

        var hazir = sonuc.Where(x => x.durum == "hazir").ToList();

        return Ok(new
        {
            satirlar = sonuc,
            hazir = hazir.Count,
            toplam = hazir.Sum(x => x.puan),
        });
    }

    public class TalepGirdi
    {
        /// <summary>tek | toplu</summary>
        public string Tur { get; set; }
        public string Aciklama { get; set; }
        public string DosyaAdi { get; set; }
        public DateTime? SonKullanim { get; set; }
        public List<SatirGirdi> Satirlar { get; set; } = new();

        /// <summary>"prim": Prim hak edişi sekmesinden (21.10.2026)</summary>
        public string Kaynak { get; set; }

        /// <summary>Prim dönemi yyyy-MM (hangi ayın primi)</summary>
        public string Donem { get; set; }

        /// <summary>Onayda işten ayrılmış personele kart bağlantısı SMS'i gitsin</summary>
        public bool AyrilanLink { get; set; }

        /// <summary>Aynı dönem için daha önce yükleme varsa yine de gönder</summary>
        public bool Tekrar { get; set; }
    }

    /// <summary>Yükleme talebi: puan yatmıyor, Admin onayına düşüyor.</summary>
    [HttpPost("Talep")]
    public IActionResult Talep([FromBody] TalepGirdi g)
    {
        var aciklama = (g?.Aciklama ?? "").Trim();

        if (aciklama.Length < 3) return BadRequest(new { hata = "Açıklama giriniz; onayda ve e-postada görünür." });
        if (aciklama.Length > 300) aciklama = aciklama[..300];

        var son = (g.SonKullanim ?? VarsayilanSonKullanim).Date;

        if (son <= DateTime.Today) return BadRequest(new { hata = "Son kullanma tarihi bugünden sonra olmalı." });

        var satirlar = (g.Satirlar ?? new List<SatirGirdi>())
            .Select(x => new SatirGirdi { KartNo = Temizle(x.KartNo), Puan = Math.Round(x.Puan, 2), Sicil = (x.Sicil ?? "").Trim() })
            .ToList();

        if (satirlar.Count == 0) return BadRequest(new { hata = "Yüklenecek kart yok." });
        if (satirlar.Count > EN_COK_SATIR) return BadRequest(new { hata = $"En fazla {EN_COK_SATIR} satır." });

        if (satirlar.Any(x => x.Puan <= 0 || x.Puan > EN_COK_PUAN))
            return BadRequest(new { hata = $"Puan 0'dan büyük ve en fazla {EN_COK_PUAN:N0} olmalı." });

        var tekrar = satirlar.GroupBy(x => x.KartNo).Where(x => x.Count() > 1).Select(x => x.Key).ToList();
        if (tekrar.Count > 0)
            return BadRequest(new { hata = "Aynı kart birden çok satırda var.", ayrinti = string.Join(", ", tekrar.Take(10)) });

        Dictionary<string, KartBilgi> bilgi;

        try
        {
            bilgi = KartBilgileri(satirlar.Select(x => x.KartNo));
        }
        catch (Exception hata)
        {
            return StatusCode(502, new { hata = "Kart sunucusuna ulaşılamadı.", ayrinti = hata.Message });
        }

        var yok = satirlar.Where(x => !bilgi.TryGetValue(x.KartNo, out var b) || !b.Var).Select(x => x.KartNo).ToList();
        if (yok.Count > 0)
            return BadRequest(new { hata = "Bazı kartlar bulunamadı.", ayrinti = string.Join(", ", yok.Take(10)) });

        var tur = g.Tur == "toplu" ? "toplu" : "tek";

        var kaynak = g.Kaynak == "prim" ? "prim" : null;
        var donem = kaynak is null ? null : (g.Donem ?? "").Trim();

        if (kaynak is not null && aciklama.ToLower(new System.Globalization.CultureInfo("tr-TR")).Contains("prim"))
            return BadRequest(new { hata = "Açıklama personelin bildiriminde görünür; \"prim\" kelimesi geçmemeli." });

        if (kaynak is not null && !System.Text.RegularExpressions.Regex.IsMatch(donem ?? "", @"^\d{4}-(0[1-9]|1[0-2])$"))
            return BadRequest(new { hata = "Prim dönemi (ay) seçiniz." });

        using var db = _vt.Baglanti();
        db.Open();

        /* Aynı ayın primi iki kez yatmasın: bekleyen ya da onaylanmış talep varsa uyarılır */
        if (kaynak is not null && !g.Tekrar)
        {
            var onceki = db.QueryFirstOrDefault(@"
SELECT TOP 1 id, durum, olusturma FROM KRY_PUAN_TALEP
WHERE kaynak = N'prim' AND donem = @donem AND durum IN (N'bekliyor', N'isleniyor', N'onaylandi')
ORDER BY id DESC", new { donem });

            if (onceki is not null)
                return StatusCode(409, new
                {
                    hata = $"{donem} dönemi primi için #{onceki.id} numaralı talep zaten var ({onceki.durum}).",
                    ayrinti = "Yalnızca eksik kalan personeli yüklemek istiyorsanız onları seçip yine de gönderebilirsiniz.",
                    talepId = (int)onceki.id,
                });
        }

        using var tx = db.BeginTransaction();

        var id = db.ExecuteScalar<int>(@"
INSERT INTO KRY_PUAN_TALEP (tur, aciklama, dosya_adi, son_kullanim, kart_sayisi, toplam_puan, talep_eden, talep_eden_ad,
                            kaynak, donem, ayrilan_link)
OUTPUT INSERTED.id
VALUES (@tur, @aciklama, @dosya, @son, @adet, @toplam, @kullanici, @ad, @kaynak, @donem, @ayrilanLink)",
            new
            {
                tur,
                aciklama,
                dosya = string.IsNullOrWhiteSpace(g.DosyaAdi) ? null : g.DosyaAdi.Trim(),
                son,
                adet = satirlar.Count,
                toplam = satirlar.Sum(x => x.Puan),
                kullanici = Kullanici,
                ad = AdSoyad,
                kaynak,
                donem,
                ayrilanLink = kaynak is not null && g.AyrilanLink,
            }, tx);

        db.Execute(@"
INSERT INTO KRY_PUAN_TALEP_SATIR (talep_id, kart_no, sicil, ad_soyad, sube, puan)
VALUES (@id, @kartNo, @sicil, @adSoyad, @sube, @puan)",
            satirlar.Select(x =>
            {
                var b = bilgi[x.KartNo];
                return new { id, x.KartNo, sicil = b.Sicil ?? (kaynak is not null && x.Sicil.Length > 0 ? x.Sicil : null), adSoyad = b.AdSoyad ?? b.KartAdi, sube = b.Sube, x.Puan };
            }), tx);

        /* Admin'lere bildirim: onay bekleyen yükleme */
        db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
SELECT kullanici_adi, N'puan_onay', @baslik, @metin
FROM KRY_KULLANICILAR WHERE rol = N'Admin' AND aktif = 1",
            new
            {
                baslik = "Onay bekleyen puan yüklemesi",
                metin = $"{AdSoyad} · {aciklama} · {satirlar.Count} kart · {Tl(satirlar.Sum(x => x.Puan))} puan. "
                        + "Sağ üstteki Bekleyen işler zilinden onaylayabilir ya da reddedebilirsiniz.",
            }, tx);

        tx.Commit();

        _kayit.LogInformation("Puan yükleme talebi {Id}: {Adet} kart, {Toplam} puan ({Kullanici})",
            id, satirlar.Count, satirlar.Sum(x => x.Puan), Kullanici);

        return Ok(new { id, basarili = true });
    }

    /* ------------------------------------------------------------ talepler */

    /// <summary>
    /// Taleplerin şube dağılımı (23.10.2026): "ŞUBE A (12 · 1.200 ₺), ŞUBE B (8 · 800 ₺)".
    /// Biçen Kart sayfasında yüklemenin hangi şubelere gittiği görünsün.
    /// </summary>
    private static Dictionary<int, (string Metin, List<object> Liste, string Havuz)> SubeOzetleri(System.Data.IDbConnection db, IEnumerable<int> idler)
    {
        var d = new Dictionary<int, (string, List<object>, string)>();
        var l = idler.Distinct().ToArray();
        if (l.Length == 0) return d;
        var satirlar = db.Query(@"
SELECT talep_id AS id, ISNULL(NULLIF(LTRIM(RTRIM(sube)), N''), N'Şubesi yok') AS sube, COUNT(*) AS adet, SUM(puan) AS toplam
FROM KRY_PUAN_TALEP_SATIR WHERE talep_id IN @l GROUP BY talep_id, ISNULL(NULLIF(LTRIM(RTRIM(sube)), N''), N'Şubesi yok')", new { l }).ToList();
        var havuzlar = db.Query("SELECT id, havuz_kodu AS h FROM KRY_PUAN_TALEP WHERE id IN @l", new { l })
            .ToDictionary(x => (int)x.id, x => (string)x.h);
        foreach (var g in satirlar.GroupBy(x => (int)x.id))
        {
            var sirali = g.OrderByDescending(x => (int)x.adet).ToList();
            var metin = string.Join(", ", sirali.Take(4).Select(x => $"{(string)x.sube} ({(int)x.adet})"))
                        + (sirali.Count > 4 ? $" +{sirali.Count - 4} şube" : "");
            d[g.Key] = (metin, sirali.Select(x => (object)new { sube = (string)x.sube, kisi = (int)x.adet, toplam = (decimal)x.toplam }).ToList(),
                havuzlar.GetValueOrDefault(g.Key));
        }
        return d;
    }

    [HttpGet("Talepler")]
    public IActionResult Talepler([FromQuery] string durum = null)
    {
        using var db = _vt.Baglanti();

        var liste = db.Query(@"
SELECT TOP 200 t.id, t.tur, t.aciklama, t.dosya_adi AS dosyaAdi, t.son_kullanim AS sonKullanim,
       t.kart_sayisi AS kartSayisi, t.toplam_puan AS toplamPuan, t.durum,
       t.talep_eden AS talepEden, t.talep_eden_ad AS talepEdenAd, t.olusturma,
       t.karar_veren AS kararVeren, t.karar_veren_ad AS kararVerenAd, t.karar_tarihi AS kararTarihi,
       t.red_sebebi AS redSebebi, t.hata,
       (SELECT MIN(puan) FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS enAz,
       (SELECT MAX(puan) FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS enCok,
       (SELECT TOP 1 ad_soyad FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS ilkKisi,
       (SELECT TOP 1 kart_no FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS ilkKart
FROM KRY_PUAN_TALEP t
WHERE (@durum IS NULL OR t.durum = @durum)
ORDER BY CASE WHEN t.durum = N'bekliyor' THEN 0 ELSE 1 END, t.olusturma DESC",
            new { durum = string.IsNullOrWhiteSpace(durum) ? null : durum }).ToList();

        var subeler = SubeOzetleri(db, liste.Select(x => (int)x.id));
        var sonuc = liste.Select(x =>
        {
            var d = (IDictionary<string, object>)x;
            var o = new Dictionary<string, object>(d);
            if (subeler.TryGetValue((int)x.id, out var s))
            {
                o["subeler"] = s.Metin;
                o["subeListesi"] = s.Liste;
                o["havuz"] = s.Havuz;
            }
            return o;
        }).ToList();

        return Ok(new { talepler = sonuc, admin = Admin });
    }

    [HttpGet("Talep/{id:int}")]
    public IActionResult TalepAyrinti(int id)
    {
        using var db = _vt.Baglanti();

        var satirlar = db.Query(@"
SELECT kart_no AS kartNo, sicil, ad_soyad AS adSoyad, sube, puan
FROM KRY_PUAN_TALEP_SATIR WHERE talep_id = @id ORDER BY ad_soyad", new { id }).ToList();

        return Ok(new { satirlar });
    }

    public class KararGirdi
    {
        public bool Onay { get; set; }
        public string Sebep { get; set; }
    }

    /// <summary>
    /// Admin kararı. Onayda satırlar tek işlemde PuanHareket'e yazılıyor;
    /// yazım başarısız olursa hiçbiri yazılmıyor ve talep beklemeye dönüyor.
    /// </summary>
    [HttpPost("Talep/{id:int}/Karar")]
    [Authorize(Roles = Roller.Admin)]
    public async Task<IActionResult> Karar(int id, [FromBody] KararGirdi g)
    {
        using var db = _vt.Baglanti();

        var talep = db.QueryFirstOrDefault(@"
SELECT id, tur, aciklama, dosya_adi AS dosyaAdi, son_kullanim AS sonKullanim, kart_sayisi AS kartSayisi,
       toplam_puan AS toplamPuan, durum, talep_eden AS talepEden, talep_eden_ad AS talepEdenAd, olusturma,
       havuz_kodu AS havuzKodu, kaynak, donem, ayrilan_link AS ayrilanLink
FROM KRY_PUAN_TALEP WHERE id = @id", new { id });

        if (talep is null) return NotFound(new { hata = "Talep bulunamadı." });
        if ((string)talep.durum != "bekliyor") return BadRequest(new { hata = "Bu talep zaten sonuçlanmış." });

        if (!(g?.Onay ?? false))
        {
            var sebep = (g?.Sebep ?? "").Trim();

            if (sebep.Length < 3) return BadRequest(new { hata = "Reddetme sebebini yazınız; talep eden bunu görür." });

            var n = db.Execute(@"
UPDATE KRY_PUAN_TALEP
SET durum = N'reddedildi', karar_veren = @k, karar_veren_ad = @ad, karar_tarihi = SYSDATETIME(), red_sebebi = @sebep
WHERE id = @id AND durum = N'bekliyor'",
                new { id, k = Kullanici, ad = AdSoyad, sebep = sebep.Length > 500 ? sebep[..500] : sebep });

            if (n == 0) return BadRequest(new { hata = "Talep az önce sonuçlandırıldı." });

            Bildir(db, (string)talep.talepEden, "Puan yükleme talebiniz reddedildi",
                $"{talep.aciklama} · {talep.kartSayisi} kart · {Tl((decimal)talep.toplamPuan)} puan yüklenmedi. "
                + $"Sebep: \"{sebep}\" · {AdSoyad}");

            return Ok(new { basarili = true, durum = "reddedildi" });
        }

        /* Önce talep kilitleniyor: iki Admin aynı anda onaylarsa puan iki kez yatmasın */
        var kilit = db.Execute(
            "UPDATE KRY_PUAN_TALEP SET durum = N'isleniyor' WHERE id = @id AND durum = N'bekliyor'", new { id });

        if (kilit == 0) return BadRequest(new { hata = "Talep az önce sonuçlandırıldı." });

        var satirlar = db.Query(@"
SELECT kart_no AS kartNo, sicil, ad_soyad AS adSoyad, sube, puan
FROM KRY_PUAN_TALEP_SATIR WHERE talep_id = @id ORDER BY ad_soyad", new { id }).ToList();

        try
        {
            using var pos = AcikPos();
            using var tx = pos.BeginTransaction();

            foreach (var s in satirlar)
                HareketYaz(pos, tx, (string)s.kartNo, YUKLEME, (decimal)s.puan, 0m, (DateTime)talep.sonKullanim, 0);

            tx.Commit();
            GiftKartOnbellek.KartDegisti(satirlar.Select(x => (string)x.kartNo));
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Puan yüklemesi yazılamadı: talep {Id}", id);

            db.Execute("UPDATE KRY_PUAN_TALEP SET durum = N'bekliyor', hata = @h WHERE id = @id",
                new { id, h = Kisalt(hata.Message, 1000) });

            return StatusCode(502, new
            {
                hata = "Puanlar yazılamadı; hiçbir karta yüklenmedi.",
                ayrinti = hata.Message,
            });
        }

        db.Execute(@"
UPDATE KRY_PUAN_TALEP
SET durum = N'onaylandi', karar_veren = @k, karar_veren_ad = @ad, karar_tarihi = SYSDATETIME(), hata = NULL
WHERE id = @id", new { id, k = Kullanici, ad = AdSoyad });

        YazilanlariIsaretle(db);

        /* 19.10.2026: Mağaza Havuzu'ndan gelen dağıtım onaylanınca tutar
           havuzdan kullanım olarak düşülür (reddedilirse havuz değişmez). */
        if (talep.havuzKodu is string havuz && !string.IsNullOrWhiteSpace(havuz))
        {
            try
            {
                db.Execute(@"
INSERT INTO KRY_HAVUZ_HAREKET (sube_kodu, sube_adi, tarih, tur, tutar, aciklama, kaydeden)
VALUES (@havuz, (SELECT TOP 1 sube FROM KRY_PUAN_TALEP_SATIR WHERE talep_id = @id),
        CAST(GETDATE() AS DATE), N'kullanim', @tutar, @aciklama, @kim)",
                    new
                    {
                        havuz,
                        id,
                        tutar = (decimal)talep.toplamPuan,
                        aciklama = $"Biçen Kart'a dağıtım · {talep.kartSayisi} kişi · puan talebi #{id}",
                        kim = (string)talep.talepEden,
                    });
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Havuz dağıtımı havuzdan düşülemedi: talep {Id}", id);
            }
        }

        /* Kartına yükleme yapılan personelin telefonuna */
        await PersoneleBildir(satirlar.Select(s => (
            (string)s.kartNo,
            "Biçen Kartınıza bakiye yüklendi",
            $"Kartınıza {Para((decimal)s.puan)} yüklendi ({talep.aciklama}).")).ToList());

        db.Execute(@"
INSERT INTO KRY_PUAN_ISLEM (tur, kart_no, puan, aciklama, talep_id, yapan, yapan_ad)
VALUES (N'yukleme', @kartNo, @puan, @aciklama, @id, @yapan, @yapanAd)",
            satirlar.Select(s => new
            {
                kartNo = (string)s.kartNo,
                puan = (decimal)s.puan,
                aciklama = (string)talep.aciklama + (talep.dosyaAdi is null ? "" : $" · {talep.dosyaAdi}"),
                id,
                yapan = (string)talep.talepEden,
                yapanAd = (string)talep.talepEdenAd,
            }));

        /* Prim yüklemesi: işten ayrılmış personele kart bağlantısı SMS'i
           (süresi dolmuş bağlantı uzatılır, açık olana tekrar gider) */
        if ((string)talep.kaynak == "prim" && (bool)talep.ayrilanLink)
        {
            var linkOzet = await PrimAyrilanBaglantisi(satirlar.Select(s => (string)s.sicil).Where(s => !string.IsNullOrWhiteSpace(s)).ToList());
            db.Execute("UPDATE KRY_PUAN_TALEP SET ayrilan_link_sonuc = @o WHERE id = @id", new { id, o = Kisalt(linkOzet, 500) });

            if (!string.IsNullOrWhiteSpace(linkOzet))
                Bildir(db, (string)talep.talepEden, "Ayrılan personele kart bağlantısı", $"{talep.aciklama} · {linkOzet}");
        }

        Bildir(db, (string)talep.talepEden, "Puan yükleme talebiniz onaylandı",
            $"{talep.aciklama} · {talep.kartSayisi} kart · {Tl((decimal)talep.toplamPuan)} puan kartlara yüklendi. "
            + $"Onaylayan: {AdSoyad}");

        /* E-posta: onay sonucu bozulmasın, gönderilemezse talepte not düşülür */
        var epostaDurumu = await EpostaGonder(talep, satirlar);

        db.Execute("UPDATE KRY_PUAN_TALEP SET eposta = @e WHERE id = @id", new { id, e = Kisalt(epostaDurumu, 300) });

        _kayit.LogInformation("Puan yüklemesi onaylandı: talep {Id}, {Adet} kart, {Toplam} ({Kullanici})",
            id, satirlar.Count, (decimal)talep.toplamPuan, Kullanici);

        return Ok(new { basarili = true, durum = "onaylandi", eposta = epostaDurumu });
    }

    /// <summary>
    /// Biçen360 patron Onaylar sayfasından karar: panelde Admin'in verdiği
    /// kararla aynı kod (kilit, POS'a yazım, bildirim, e-posta). Yetkiyi
    /// çağıran denetliyor.
    /// </summary>
    /// <summary>Onaylanan prim yüklemesinden sonra ayrılan personele bağlantı (BicenKartController).</summary>
    private async Task<string> PrimAyrilanBaglantisi(List<string> siciller)
    {
        if (siciller.Count == 0) return null;

        try
        {
            var sp = HttpContext?.RequestServices ?? _saglayici;
            var kart = ActivatorUtilities.CreateInstance<BicenKartController>(sp);

            kart.ControllerContext = HttpContext is not null
                ? ControllerContext
                : new ControllerContext
                {
                    HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext
                    {
                        RequestServices = sp,
                        User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
                            new[] { new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, Kullanici) }, "dis")),
                    },
                };

            return await kart.PrimIcinAyrilanaGonder(siciller);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Prim sonrası ayrılan bağlantısı gönderilemedi");
            return "bağlantı gönderilemedi: " + hata.Message;
        }
    }

    /// <summary>Prim sekmesi: dönemin talepleri ve talepteki kartlar (kim yüklendi).</summary>
    [HttpGet("PrimDurumu")]
    public IActionResult PrimDurumu([FromQuery] string donem)
    {
        using var db = _vt.Baglanti();

        var talepler = db.Query(@"
SELECT id, durum, aciklama, kart_sayisi AS kartSayisi, toplam_puan AS toplamPuan, olusturma,
       talep_eden_ad AS talepEdenAd, karar_veren_ad AS kararVerenAd, karar_tarihi AS kararTarihi,
       red_sebebi AS redSebebi, ayrilan_link AS ayrilanLink, ayrilan_link_sonuc AS ayrilanLinkSonuc
FROM KRY_PUAN_TALEP WHERE kaynak = N'prim' AND donem = @donem ORDER BY id DESC", new { donem }).ToList();

        var kartlar = db.Query(@"
SELECT s.kart_no AS kartNo, s.puan, t.durum, t.id AS talepId
FROM KRY_PUAN_TALEP_SATIR s JOIN KRY_PUAN_TALEP t ON t.id = s.talep_id
WHERE t.kaynak = N'prim' AND t.donem = @donem AND t.durum IN (N'bekliyor', N'isleniyor', N'onaylandi')",
            new { donem }).ToList();

        return Ok(new { talepler, kartlar });
    }

    [NonAction]
    public Task<IActionResult> DisaridanKarar(int id, bool onay, string sebep, string kullanici, string adSoyad)
    {
        _disKullanici = kullanici;
        _disAd = adSoyad;
        return Karar(id, new KararGirdi { Onay = onay, Sebep = sebep });
    }

    private async Task<string> EpostaGonder(dynamic talep, List<dynamic> satirlar)
    {
        try
        {
            var alicilar = EpostaAlicilari;

            if (alicilar.Count == 0) return "e-posta adresi tanımlı değil";

            string E(object x) => System.Net.WebUtility.HtmlEncode(x?.ToString() ?? "");

            var govde = new StringBuilder();
            govde.Append("<div style=\"font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2933\">");
            govde.Append($"<p><b>{E(talep.aciklama)}</b> puan yüklemesi onaylanıp kartlara yüklendi.</p>");
            govde.Append("<table style=\"border-collapse:collapse;min-width:420px\">");

            void Satir(string a, string d) =>
                govde.Append($"<tr><td style=\"padding:6px 10px;border-bottom:1px solid #e3e6e1;color:#6b7280\">{a}</td>"
                             + $"<td style=\"padding:6px 10px;border-bottom:1px solid #e3e6e1\">{d}</td></tr>");

            Satir("Talep eden", $"{E(talep.talepEdenAd ?? talep.talepEden)} · {((DateTime)talep.olusturma):dd.MM.yyyy HH:mm}");
            Satir("Onaylayan", $"{E(AdSoyad)} · {DateTime.Now:dd.MM.yyyy HH:mm}");
            Satir("Kişi / kart", satirlar.Count.ToString());
            Satir("Toplam puan", Tl((decimal)talep.toplamPuan));
            Satir("Puan türü", $"Yükleme (işlem tipi 3) · promosyon {PromosyonTanimId.ToString()[..8].ToUpper()} · puan kodu {PuanKodu}");
            Satir("Son kullanma", ((DateTime)talep.sonKullanim).ToString("dd.MM.yyyy"));
            if (talep.dosyaAdi is not null) Satir("Kaynak dosya", E(talep.dosyaAdi));
            govde.Append("</table>");

            govde.Append("<p style=\"margin-top:16px\"><b>Yüklenen kartlar</b></p>");
            govde.Append("<table style=\"border-collapse:collapse;font-size:13px\"><tr>");
            foreach (var b in new[] { "Personel", "Sicil", "Şube", "Kart no", "Puan" })
                govde.Append($"<th style=\"text-align:left;padding:5px 8px;background:#f4f6f2\">{b}</th>");
            govde.Append("</tr>");
            foreach (var s in satirlar.Take(1000))
                govde.Append($"<tr><td style=\"padding:4px 8px;border-bottom:1px solid #eee\">{E(s.adSoyad)}</td>"
                             + $"<td style=\"padding:4px 8px;border-bottom:1px solid #eee\">{E(s.sicil)}</td>"
                             + $"<td style=\"padding:4px 8px;border-bottom:1px solid #eee\">{E(s.sube)}</td>"
                             + $"<td style=\"padding:4px 8px;border-bottom:1px solid #eee;font-family:Consolas,monospace\">{E(s.kartNo)}</td>"
                             + $"<td style=\"padding:4px 8px;border-bottom:1px solid #eee;text-align:right\">{Tl((decimal)s.puan)}</td></tr>");
            govde.Append("</table>");
            if (satirlar.Count > 1000) govde.Append($"<p>… ve {satirlar.Count - 1000} kart daha (tamamı ekteki dosyada).</p>");
            govde.Append("<p style=\"color:#6b7280;font-size:12px\">Biçen İK paneli · Biçen Kart › Puan Yönetimi</p></div>");

            /* Ek: Excel'in doğrudan açtığı CSV (UTF-8 BOM, noktalı virgül) */
            var csv = new StringBuilder();
            csv.AppendLine("Personel;Sicil;Şube;Kart No;Puan");
            foreach (var s in satirlar)
                csv.AppendLine($"{Csv(s.adSoyad)};{Csv(s.sicil)};{Csv(s.sube)};=\"{s.kartNo}\";{((decimal)s.puan).ToString("0.##", new System.Globalization.CultureInfo("tr-TR"))}");

            var ek = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(csv.ToString())).ToArray();

            var konu = $"Biçen Kart puan yüklemesi yapıldı · {satirlar.Count} kişi · {Tl((decimal)talep.toplamPuan)} puan";

            var tamam = await _mail.GonderAsync(alicilar, konu, govde.ToString(), null,
                new[] { ($"puan-yukleme-{DateTime.Now:ddMMyyyy-HHmm}.csv", ek) });

            return tamam ? $"gönderildi: {string.Join(", ", alicilar)}" : $"gönderilemedi: {_mail.SonHataMesaji}";
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Puan yükleme e-postası gönderilemedi");
            return $"gönderilemedi: {hata.Message}";
        }
    }

    private static string Csv(object x)
    {
        var t = x?.ToString() ?? "";
        return t.Contains(';') || t.Contains('"') ? $"\"{t.Replace("\"", "\"\"")}\"" : t;
    }

    private void Bildir(IDbConnection db, string kullanici, string baslik, string metin)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin) VALUES (@kullanici, N'puan', @baslik, @metin)",
                new { kullanici, baslik, metin = Kisalt(metin, 900) });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Puan bildirimi yazılamadı");
        }
    }

    private static string Kisalt(string s, int n) => s is null ? null : s.Length > n ? s[..n] : s;

    /* ------------------------------------------------------ PuanHareket yazımı */

    /// <param name="ekSaniye">Aynı işlemdeki sonraki satır için; sıfırlamadan sonra sayılsın diye.</param>
    /// <param name="sonKullanim">Boşsa işlem günü (Posback'in silme satırındaki gibi).</param>
    /// <param name="promosyon">Boşsa ayardaki promosyon tanımı.</param>
    private void HareketYaz(IDbConnection pos, IDbTransaction tx, string kartNo, int islemTipi,
        decimal puan, decimal eksiPuan, DateTime? sonKullanim, int ekSaniye, Guid? promosyon = null)
    {
        var id = Guid.NewGuid();
        _yazilanlar.Add(id);

        pos.Execute($@"
INSERT INTO {HAREKET}
    (Id, BelgeNo, FirmaId, IslemTipi, KartNo, KasaId, PromosyonTanimId, Puan, PuanKodu,
     SubeId, Tarih, SonKullanimTarihi, EksiPuan, PosbackId)
VALUES
    (@id, 0, @firma, @islemTipi, @kartNo, 0, @promosyon, @puan, @puanKodu,
     0, DATEADD(SECOND, @ekSaniye, GETDATE()), COALESCE(@sonKullanim, CAST(CAST(GETDATE() AS DATE) AS DATETIME)), @eksiPuan, '00000000-0000-0000-0000-000000000000')",
            new
            {
                id,
                firma = FirmaId,
                islemTipi,
                kartNo,
                promosyon = promosyon ?? PromosyonTanimId,
                puan,
                puanKodu = PuanKodu,
                ekSaniye,
                sonKullanim,
                eksiPuan,
            }, tx, commandTimeout: 60);
    }

    /// <summary>
    /// Karttan tutar düşer, Posback'in kendi silmesiyle aynı iki adımda:
    /// <list type="number">
    /// <item>Kayıt satırı: 6 (silme), tutar Puan'da, EksiPuan 0,
    /// PromosyonTanimId 00000000-…, son kullanma işlem günü.</item>
    /// <item><c>dbo.EksiPuanIsle</c>: tutar, karttaki en eski partiden
    /// başlanarak partilerin EksiPuan'ına işleniyor. Bakiyeyi asıl düşen
    /// adım bu; yalnızca kayıt satırı yazılınca Posback bakiyeyi hiç
    /// düşmüyordu (29.09.2026).</item>
    /// </list>
    /// </summary>
    private void Dus(IDbConnection pos, IDbTransaction tx, string kartNo, decimal tutar)
    {
        HareketYaz(pos, tx, kartNo, SILME, tutar, 0m, null, 0, Guid.Empty);

        pos.Execute("[PosbackPromosyon].[dbo].[EksiPuanIsle]",
            new
            {
                P_KARTNO = new DbString { Value = kartNo, IsAnsi = true, Length = 16 },
                P_PUANKODU = PuanKodu,
                P_PUAN = tutar,
            }, tx, commandTimeout: 60, commandType: CommandType.StoredProcedure);
    }

    /* ------------------------------------------------- personele bildirim */

    /// <summary>Bu istekte PuanHareket'e yazılan satırlar.</summary>
    private readonly List<Guid> _yazilanlar = new();

    /// <summary>
    /// Panelin yazdığı satırlar "bildirildi" sayılıyor: personele buradan,
    /// doğru tutar ve açıklamayla bildiriliyor. Kart hareketlerini izleyen
    /// görev (GiftKartBildirimGorevi) bunları yeniden bildirmesin; transferin
    /// kaynağına "silindi" değil "aktarıldı" gitmeli.
    /// </summary>
    private void YazilanlariIsaretle(IDbConnection db)
    {
        try
        {
            foreach (var parca in _yazilanlar.Chunk(500))
                db.Execute("INSERT INTO KRY_KART_BILDIRILEN (hareket_id) VALUES (@id)", parca.Select(id => new { id }));
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Yazılan puan hareketleri işaretlenemedi");
        }

        _yazilanlar.Clear();
    }

    /// <summary>Kartların sahibi (panel eşleşmesi): kart no → sicil.</summary>
    private static Dictionary<string, string> KartSahipleri(IDbConnection db, IEnumerable<string> kartlar)
    {
        var sonuc = new Dictionary<string, string>();

        foreach (var parca in kartlar.Distinct().Chunk(1000))
            foreach (var x in db.Query("SELECT kart_no AS kart, personel_kodu AS kod FROM KRY_KART_ESLESME WHERE kart_no IN @parca",
                         new { parca }))
                sonuc[((string)x.kart).Trim()] = ((string)x.kod ?? "").Trim();

        return sonuc;
    }

    private static string Para(decimal d) => Tl(d) + " ₺";

    /// <summary>Güncel bakiyeler (bildirim metni için); okunamazsa boş.</summary>
    private Dictionary<string, decimal> Bakiyeler(IEnumerable<string> kartlar)
    {
        var sonuc = new Dictionary<string, decimal>();

        try
        {
            using var pos = AcikPos();

            foreach (var k in kartlar.Distinct())
                sonuc[k] = GiftKartServisi.BakiyeSorgusu(pos, k, PuanKodu);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Bildirim için bakiye okunamadı");
        }

        return sonuc;
    }

    private async Task PersoneleBildir(List<(string Kart, string Baslik, string Metin)> liste)
    {
        try
        {
            using var db = _vt.Baglanti();

            var sahipler = KartSahipleri(db, liste.Select(x => x.Kart));

            /* Toplu yükleme (21.10.2026): yüzlerce kişi aynı anda uygulamayı
               açıp sunucuyu yormasın; bildirimler dakikaya yayılarak kuyruktan gider */
            var esik = Math.Max(10, Parametre.Sayi("bildirim.topluEsik"));
            if (liste.Count > esik)
            {
                BildirimKuyrugu.Ekle(db,
                    liste.Where(x => sahipler.ContainsKey(x.Kart)).Select(x => (sahipler[x.Kart], x.Baslik, x.Metin)),
                    "giftkart");
                return;
            }

            /* Toplu yüklemede bakiye yüzlerce kart için ayrı ayrı hesaplanmıyor */
            var bakiye = liste.Count <= 200 ? Bakiyeler(liste.Select(x => x.Kart)) : new Dictionary<string, decimal>();

            await _bildirim.KisiyeOzelGonder(
                liste.Where(x => sahipler.ContainsKey(x.Kart))
                    .Select(x => (
                        sahipler[x.Kart],
                        x.Baslik,
                        bakiye.TryGetValue(x.Kart, out var b) ? $"{x.Metin} Güncel bakiyeniz: {Para(b)}" : x.Metin)),
                "giftkart");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Biçen Kart bildirimi personele gönderilemedi");
        }
    }

    /* ------------------------------------------------------------ transfer */

    public class TransferGirdi
    {
        public string Kaynak { get; set; }
        public string Hedef { get; set; }
        public decimal Puan { get; set; }
        public bool Tamami { get; set; }
        public string Aciklama { get; set; }
    }

    [HttpPost("Transfer")]
    public async Task<IActionResult> Transfer([FromBody] TransferGirdi g)
    {
        var kaynak = Temizle(g?.Kaynak);
        var hedef = Temizle(g?.Hedef);

        if (kaynak.Length < 6 || hedef.Length < 6) return BadRequest(new { hata = "İki kart numarasını da giriniz." });
        if (kaynak == hedef) return BadRequest(new { hata = "Kaynak ve hedef kart aynı olamaz." });

        var bilgi = KartBilgileri(new[] { kaynak, hedef });

        if (!bilgi[kaynak].Var) return BadRequest(new { hata = "Kaynak kart bulunamadı." });
        if (!bilgi[hedef].Var) return BadRequest(new { hata = "Hedef kart bulunamadı." });

        decimal tutar, bakiye;

        try
        {
            using var pos = AcikPos();
            using var tx = pos.BeginTransaction(IsolationLevel.Serializable);

            bakiye = BakiyeTx(pos, tx, kaynak);
            tutar = g.Tamami ? bakiye : Math.Round(g.Puan, 2);

            if (tutar <= 0) return BadRequest(new { hata = "Aktarılacak puan yok." });
            if (tutar > bakiye) return BadRequest(new { hata = $"Kaynak kartın bakiyesi {Tl(bakiye)}; daha fazlası aktarılamaz." });

            Dus(pos, tx, kaynak, tutar);
            HareketYaz(pos, tx, hedef, DEVIR, tutar, 0m, VarsayilanSonKullanim, 0);

            tx.Commit();
            GiftKartOnbellek.KartDegisti(new[] { kaynak, hedef });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Puan transferi yazılamadı: {Kaynak} → {Hedef}", kaynak, hedef);
            return StatusCode(502, new { hata = "Transfer yapılamadı; hiçbir kart değişmedi.", ayrinti = hata.Message });
        }

        using var db = _vt.Baglanti();

        db.Execute(@"
INSERT INTO KRY_PUAN_ISLEM (tur, kart_no, hedef_kart, puan, aciklama, yapan, yapan_ad)
VALUES (N'transfer', @kaynak, @hedef, @tutar, @aciklama, @yapan, @ad)",
            new { kaynak, hedef, tutar, aciklama = Kisalt((g.Aciklama ?? "").Trim(), 500), yapan = Kullanici, ad = AdSoyad });

        YazilanlariIsaretle(db);

        await PersoneleBildir(new()
        {
            (kaynak, "Biçen Kartınızdan bakiye aktarıldı", $"Kartınızdan {Para(tutar)} başka bir karta aktarıldı."),
            (hedef, "Biçen Kartınıza bakiye aktarıldı", $"Kartınıza {Para(tutar)} aktarıldı."),
        });

        _kayit.LogInformation("Puan transferi: {Kaynak} → {Hedef} {Tutar} ({Kullanici})", kaynak, hedef, tutar, Kullanici);

        return Ok(new { basarili = true, tutar, kaynakBakiye = bakiye - tutar });
    }

    /* --------------------------------------------------------------- silme */

    public class SilGirdi
    {
        public string KartNo { get; set; }
        public decimal Puan { get; set; }
        public bool Tamami { get; set; }
        public string Sebep { get; set; }
    }

    [HttpPost("Sil")]
    public async Task<IActionResult> Sil([FromBody] SilGirdi g)
    {
        var kart = Temizle(g?.KartNo);
        var sebep = (g?.Sebep ?? "").Trim();

        if (kart.Length < 6) return BadRequest(new { hata = "Kart numarasını giriniz." });
        if (sebep.Length < 3) return BadRequest(new { hata = "Silme sebebini yazınız." });

        if (!KartBilgileri(new[] { kart })[kart].Var) return BadRequest(new { hata = "Kart bulunamadı." });

        decimal tutar, bakiye;

        try
        {
            using var pos = AcikPos();
            using var tx = pos.BeginTransaction(IsolationLevel.Serializable);

            bakiye = BakiyeTx(pos, tx, kart);
            tutar = g.Tamami ? bakiye : Math.Round(g.Puan, 2);

            if (tutar <= 0) return BadRequest(new { hata = "Silinecek puan yok." });
            if (tutar > bakiye) return BadRequest(new { hata = $"Kartın bakiyesi {Tl(bakiye)}; daha fazlası silinemez." });

            Dus(pos, tx, kart, tutar);

            tx.Commit();
            GiftKartOnbellek.KartDegisti(new[] { kart });
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Bakiye silinemedi: {Kart}", kart);
            return StatusCode(502, new { hata = "Bakiye silinemedi; kart değişmedi.", ayrinti = hata.Message });
        }

        using var db = _vt.Baglanti();

        db.Execute(@"
INSERT INTO KRY_PUAN_ISLEM (tur, kart_no, puan, aciklama, yapan, yapan_ad)
VALUES (N'silme', @kart, @tutar, @sebep, @yapan, @ad)",
            new { kart, tutar, sebep = Kisalt(sebep, 500), yapan = Kullanici, ad = AdSoyad });

        YazilanlariIsaretle(db);

        await PersoneleBildir(new()
        {
            (kart, "Biçen Kartınızdan bakiye silindi", $"Kartınızdan {Para(tutar)} silindi."),
        });

        _kayit.LogInformation("Bakiye silindi: {Kart} {Tutar} ({Kullanici}) · {Sebep}", kart, tutar, Kullanici, sebep);

        return Ok(new { basarili = true, tutar, bakiye = bakiye - tutar });
    }

    /// <summary>
    /// İşlem içindeki bakiye: Posback'in dbo.PuanBakiye fonksiyonuyla aynı
    /// hesap, ama partiler kilitlenerek okunuyor (UPDLOCK): iki kişi aynı
    /// anda aynı karttan düşerse ikincisi birincinin bitmesini bekliyor.
    /// </summary>
    private decimal BakiyeTx(IDbConnection pos, IDbTransaction tx, string kartNo) =>
        pos.ExecuteScalar<decimal?>($@"
SELECT SUM(ISNULL(Puan, 0) - ISNULL(EksiPuan, 0))
FROM {HAREKET} WITH (UPDLOCK, HOLDLOCK)
WHERE KartNo = CONVERT(VARCHAR(50), @kartNo)
  AND Puan - EksiPuan > 0
  AND IslemTipi IN (1, 3, 4)
  AND SonKullanimTarihi >= GETDATE()
  AND PuanKodu = @puanKodu",
            new { kartNo, puanKodu = PuanKodu }, tx, commandTimeout: 30) ?? 0m;

    /* ------------------------------------------------------------ geçmiş */

    /// <summary>Son işlemler: yükleme talepleri (durumlarıyla), transfer ve silmeler.</summary>
    [HttpGet("Islemler")]
    public IActionResult Islemler()
    {
        using var db = _vt.Baglanti();

        var talepler = db.Query(@"
SELECT TOP 100 t.id, t.tur, t.aciklama, t.dosya_adi AS dosyaAdi, t.kart_sayisi AS kartSayisi,
       t.toplam_puan AS puan, t.durum, t.talep_eden AS yapan, t.talep_eden_ad AS yapanAd, t.olusturma AS tarih,
       t.karar_veren_ad AS kararVerenAd, t.karar_tarihi AS kararTarihi, t.red_sebebi AS redSebebi,
       (SELECT TOP 1 ad_soyad FROM KRY_PUAN_TALEP_SATIR s WHERE s.talep_id = t.id) AS ilkKisi
FROM KRY_PUAN_TALEP t ORDER BY t.olusturma DESC").ToList();
        var talepSubeleri = SubeOzetleri(db, talepler.Select(x => (int)x.id));

        var talepSatirlari = talepler
            .Select(x => (object)new
            {
                anahtar = $"t{x.id}",
                talepId = (int)x.id,
                subeler = talepSubeleri.TryGetValue((int)x.id, out var ts) ? ts.Metin : null,
                havuz = talepSubeleri.TryGetValue((int)x.id, out var th) ? th.Havuz : null,
                tur = "yukleme",
                durum = (string)x.durum,
                tarih = (DateTime)x.tarih,
                puan = (decimal)x.puan,
                kisi = (int)x.kartSayisi == 1 ? (string)x.ilkKisi : $"{x.kartSayisi} kart",
                aciklama = (string)x.aciklama + (x.dosyaAdi is null ? "" : $" · {x.dosyaAdi}"),
                yapan = (string)(x.yapanAd ?? x.yapan),
                kararVerenAd = (string)x.kararVerenAd,
                kararTarihi = (DateTime?)x.kararTarihi,
                redSebebi = (string)x.redSebebi,
                sirala = (DateTime)x.tarih,
            });

        var islemler = db.Query(@"
SELECT TOP 100 id, tur, kart_no AS kartNo, hedef_kart AS hedefKart, puan, aciklama, yapan, yapan_ad AS yapanAd, tarih
FROM KRY_PUAN_ISLEM WHERE tur <> N'yukleme' ORDER BY tarih DESC").ToList();

        var kartlar = KisiAdlari(islemler.SelectMany(x => new[] { (string)x.kartNo, (string)x.hedefKart }));

        var digerleri = islemler.Select(x => (object)new
        {
            anahtar = $"i{x.id}",
            tur = (string)x.tur,
            durum = "tamam",
            tarih = (DateTime)x.tarih,
            puan = (decimal)x.puan,
            kisi = (string)x.tur == "transfer"
                ? $"{Ad(kartlar, (string)x.kartNo)} → {Ad(kartlar, (string)x.hedefKart)}"
                : Ad(kartlar, (string)x.kartNo),
            aciklama = (string)x.aciklama,
            yapan = (string)(x.yapanAd ?? x.yapan),
            kararVerenAd = (string)null,
            kararTarihi = (DateTime?)null,
            redSebebi = (string)null,
            sirala = (DateTime)x.tarih,
        });

        var liste = talepSatirlari.Concat(digerleri)
            .OrderByDescending(x => ((dynamic)x).sirala)
            .Take(150)
            .ToList();

        return Ok(new { islemler = liste });
    }

    /// <summary>Bir kartın panelden yapılan puan işlemleri (kişi ayrıntısı).</summary>
    [HttpGet("KartIslemleri")]
    public IActionResult KartIslemleri([FromQuery] string kartNo)
    {
        var kart = Temizle(kartNo);

        using var db = _vt.Baglanti();

        var islemler = db.Query(@"
SELECT TOP 100 i.tur, i.kart_no AS kartNo, i.hedef_kart AS hedefKart, i.puan, i.aciklama,
       i.yapan, i.yapan_ad AS yapanAd, i.tarih, t.karar_veren_ad AS onaylayan
FROM KRY_PUAN_ISLEM i
LEFT JOIN KRY_PUAN_TALEP t ON t.id = i.talep_id
WHERE i.kart_no = @kart OR i.hedef_kart = @kart
ORDER BY i.tarih DESC", new { kart }).ToList();

        var bekleyen = db.Query(@"
SELECT t.id, t.aciklama, s.puan, t.talep_eden_ad AS yapanAd, t.talep_eden AS yapan, t.olusturma AS tarih
FROM KRY_PUAN_TALEP_SATIR s JOIN KRY_PUAN_TALEP t ON t.id = s.talep_id
WHERE s.kart_no = @kart AND t.durum = N'bekliyor'
ORDER BY t.olusturma DESC", new { kart }).ToList();

        var adlar = KisiAdlari(islemler.SelectMany(x => new[] { (string)x.kartNo, (string)x.hedefKart }));

        return Ok(new
        {
            islemler = islemler.Select(x =>
            {
                string tur = x.tur;
                string yon = tur == "transfer" ? ((string)x.kartNo == kart ? "cikti" : "geldi") : null;

                return new
                {
                    tur,
                    yon,
                    puan = (decimal)x.puan,
                    eksi = tur == "silme" || yon == "cikti",
                    karsiKisi = tur != "transfer" ? null
                        : yon == "cikti" ? Ad(adlar, (string)x.hedefKart) : Ad(adlar, (string)x.kartNo),
                    aciklama = (string)x.aciklama,
                    yapan = (string)(x.yapanAd ?? x.yapan),
                    onaylayan = (string)x.onaylayan,
                    tarih = (DateTime)x.tarih,
                };
            }),
            bekleyen,
        });
    }

    private Dictionary<string, string> KisiAdlari(IEnumerable<string> kartlar)
    {
        try
        {
            return KartBilgileri(kartlar.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()))
                .ToDictionary(x => x.Key, x => x.Value.AdSoyad ?? x.Value.KartAdi);
        }
        catch
        {
            return new Dictionary<string, string>();
        }
    }

    private static string Ad(Dictionary<string, string> adlar, string kart) =>
        kart is not null && adlar.TryGetValue(kart.Trim(), out var a) && !string.IsNullOrWhiteSpace(a) ? a : kart;
}

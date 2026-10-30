using Bicen360.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Bicen360.API.Controllers;

/// <summary>
/// Teknik servis formu.
///
/// <para>
/// Arıza çözüldüğünde ne yapıldığı hiçbir yerde kalmıyordu: "çözüldü"
/// yazan bir kayıt, aynı arıza tekrarladığında hiçbir şey anlatmıyor ve
/// maliyet toplanmıyordu. Form, müdahale biçimini, yapılan işi, değişen
/// parçaları ve maliyeti kayıt altına alıyor.
/// </para>
///
/// <para>
/// Arızada cihaz seçilmişse form o cihaza da bağlanıyor; cihazın geçmişi
/// böylece tek yerde toplanıyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ServisFormuController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly ArizaErisimi _erisim;
    private readonly RaporKapsami _kapsam;
    private readonly ILogger<ServisFormuController> _kayit;

    public ServisFormuController(
        VeritabaniServisi vt,
        ArizaErisimi erisim,
        RaporKapsami kapsam,
        ILogger<ServisFormuController> kayit)
    {
        _kapsam = kapsam;
        _vt = vt;
        _erisim = erisim;
        _kayit = kayit;
    }

    /* Mobilde "personel:sicil|cihaz" jetonu: kaydı yazan sicil, ad personel kartından */
    private string Kullanici => ArizaErisimi.Yapan(User);
    private string AdSoyad => _erisim.YapanAdi(User);

    /* Arıza modülü açık olan (panel ya da Biçen360). Önceden yalnızca
       panel sayfa yetkisine bakılıyordu ve Biçen360'taki temsilci formu
       kaydedemediği için kaydı çözüldü / kapandı yapamıyordu. */
    private bool Yetkili() => _erisim.Yetkili(User);

    /* Maliyet raporu ve cihaz geçmişi yalnızca panelde */
    private bool PanelYetkili() => _erisim.PanelYetkili(User);

    private string Rol => User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    /* Panelde tutarları görür mü (13.10.2026): şube kullanıcısı ve
       portal rolünde "maliyet" kapalı olan göremez. Biçen360'taki temsilci
       formu dolduruyor; orada davranış değişmedi. */
    private bool TutarGorur() =>
        ArizaErisimi.MobilMi(User) || _kapsam.MaliyetGorur(User.Identity?.Name ?? "", Rol);

    /// <summary>
    /// Maliyet kapsamı (08.10.2026): şube kullanıcısı tutar görmez (null);
    /// diğerleri temsilcisi olduğu departmanları, Admin ve "Tüm
    /// departmanlar" hepsini.
    /// </summary>
    private (bool tumu, List<int> deps)? MaliyetKapsami()
    {
        var k = _kapsam.Panel(User.Identity?.Name ?? "",
            User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "");

        if (k.Sube is not null) return null;
        if (!TutarGorur()) return null;

        return (k.TumunuGorur, k.Departmanlar.Count > 0 ? k.Departmanlar : new List<int> { 0 });
    }

    /* ====================================================================== */

    /// <summary>Bir arızanın servis formu.</summary>
    [HttpGet("Ariza/{arizaId:int}")]
    public IActionResult ArizaFormu(int arizaId)
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        /* Biçen360'ta formu yalnızca kaydı yönetebilen (departman temsilcisi) açar */
        var kayit = db.QueryFirstOrDefault(
            "SELECT departman_id AS dep, sube_kodu AS sube, acan_kodu AS acan FROM B360_ARIZA WHERE id = @arizaId", new { arizaId });

        if (kayit is null) return NotFound(new { hata = "Arıza kaydı bulunamadı." });

        if (ArizaErisimi.MobilMi(User) && !_erisim.Yonetir(User, (int?)kayit.dep))
            return Forbid();

        /* Panel: kapsamı dışındaki kaydın formu açılmaz (13.10.2026) */
        if (!ArizaErisimi.MobilMi(User) && !_erisim.Gorur(User, (int?)kayit.dep, (string)kayit.sube, (string)kayit.acan))
            return NotFound(new { hata = "Arıza kaydı bulunamadı." });

        var form = db.QueryFirstOrDefault(@"
SELECT id, form_no AS formNo, ariza_id AS arizaId, envanter_id AS envanterId,
       mudahale, tespit, yapilan_islem AS yapilanIslem,
       parca_degisti AS parcaDegisti, cihaz_degisti AS cihazDegisti,
       yeni_cihaz AS yeniCihaz, parca_tutari AS parcaTutari, iscilik, toplam,
       servis_firma AS servisFirma, teknisyen, baslangic, bitis,
       belge, mail_gitti AS mailGitti, mail_adres AS mailAdres,
       olusturan_adi AS olusturanAdi, olusturma
FROM B360_SERVIS_FORM WHERE ariza_id = @arizaId", new { arizaId });

        if (form is null) return Ok(new { form = (object)null, parcalar = new List<object>() });

        var parcalar = db.Query(@"
SELECT id, ad, kod, adet, birim_fiyat AS birimFiyat, tutar, notu
FROM B360_SERVIS_PARCA WHERE form_id = @id ORDER BY id",
            new { id = (int)form.id }).ToList();

        if (!TutarGorur())
        {
            var f = (IDictionary<string, object>)form;
            f["parcaTutari"] = null;
            f["iscilik"] = null;
            f["toplam"] = null;

            foreach (IDictionary<string, object> p in parcalar)
            {
                p["birimFiyat"] = null;
                p["tutar"] = null;
            }
        }

        return Ok(new { form, parcalar, tutarGorur = TutarGorur() });
    }

    /// <summary>
    /// Formu kaydeder ve arızanın maliyetini günceller.
    ///
    /// <para>
    /// Aynı arızaya ikinci form açılmıyor; var olan güncelleniyor. İki
    /// form, maliyetin hangisinden okunacağını belirsiz bırakıyordu.
    /// </para>
    /// </summary>
    [HttpPost]
    public IActionResult Kaydet([FromBody] ServisFormuGirdi girdi)
    {
        if (!Yetkili()) return Forbid();

        if (girdi is null || girdi.ArizaId <= 0)
            return BadRequest(new { hata = "Arıza kaydı belirtilmedi." });

        if (string.IsNullOrWhiteSpace(girdi.YapilanIslem))
            return BadRequest(new { hata = "Yapılan işlemi yazınız." });

        using var db = _vt.Baglanti();

        var ariza = db.QueryFirstOrDefault(@"
SELECT id, envanter_id AS envanterId, sube_kodu AS subeKodu, baslik,
       departman_id AS departmanId
FROM B360_ARIZA WHERE id = @ArizaId", new { girdi.ArizaId });

        if (ariza is null) return NotFound(new { hata = "Arıza kaydı bulunamadı." });

        /* Biçen360'tan: kaydın departmanının temsilcisi (durumu da o değiştirebiliyor) */
        /* Formu kaydın departmanını yöneten kaydeder: Biçen360'ta temsilci,
           panelde arızayı yönetebilen (13.10.2026; panel daha önce
           denetlenmiyordu). */
        if (!_erisim.Yonetir(User, (int?)ariza.departmanId))
            return StatusCode(403, new { hata = "Bu kaydı yönetme yetkiniz yok." });

        /* Parça tutarları sunucuda hesaplanıyor: istemciden gelen toplama
           güvenmek, elle değiştirilmiş bir rakamın raporlara girmesi
           demekti. */
        var parcalar = (girdi.Parcalar ?? new List<ServisParcaGirdi>())
            .Where(x => !string.IsNullOrWhiteSpace(x.Ad))
            .Select(x => new
            {
                ad = x.Ad.Trim(),
                kod = x.Kod,
                adet = x.Adet <= 0 ? 1 : x.Adet,
                birimFiyat = x.BirimFiyat < 0 ? 0 : x.BirimFiyat,
                tutar = (x.Adet <= 0 ? 1 : x.Adet) * (x.BirimFiyat < 0 ? 0 : x.BirimFiyat),
                notu = x.Notu
            })
            .ToList();

        /* Tutar yetkisi olmayan kaydediyorsa önceki tutarlar korunuyor:
           ekranda boş görünen fiyatlar sıfır olarak yazılmasın. */
        if (!TutarGorur())
        {
            var eski = db.Query<(string Ad, decimal Fiyat)>(@"
SELECT P.ad, P.birim_fiyat FROM B360_SERVIS_PARCA P
    JOIN B360_SERVIS_FORM F ON F.id = P.form_id
WHERE F.ariza_id = @ArizaId", new { girdi.ArizaId })
                .GroupBy(x => (x.Ad ?? "").Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Fiyat, StringComparer.OrdinalIgnoreCase);

            parcalar = parcalar.Select(x =>
            {
                var fiyat = eski.GetValueOrDefault(x.ad, 0m);
                return new { x.ad, x.kod, x.adet, birimFiyat = fiyat, tutar = x.adet * fiyat, x.notu };
            }).ToList();

            girdi.Iscilik = db.ExecuteScalar<decimal?>(
                "SELECT iscilik FROM B360_SERVIS_FORM WHERE ariza_id = @ArizaId", new { girdi.ArizaId }) ?? 0m;
        }

        var parcaTutari = parcalar.Sum(x => x.tutar);
        var iscilik = girdi.Iscilik < 0 ? 0 : girdi.Iscilik;
        var toplam = parcaTutari + iscilik;

        var mevcut = db.ExecuteScalar<int?>(
            "SELECT id FROM B360_SERVIS_FORM WHERE ariza_id = @ArizaId",
            new { girdi.ArizaId });

        int formId;
        string formNo;

        if (mevcut is int varOlan)
        {
            formId = varOlan;

            formNo = db.ExecuteScalar<string>(
                "SELECT form_no FROM B360_SERVIS_FORM WHERE id = @formId",
                new { formId });

            db.Execute(@"
UPDATE B360_SERVIS_FORM
SET envanter_id = @envanterId, mudahale = @mudahale, tespit = @tespit,
    yapilan_islem = @yapilanIslem, parca_degisti = @parcaDegisti,
    cihaz_degisti = @cihazDegisti, yeni_cihaz = @yeniCihaz,
    parca_tutari = @parcaTutari, iscilik = @iscilik, toplam = @toplam,
    servis_firma = @servisFirma, teknisyen = @teknisyen,
    baslangic = @baslangic, bitis = @bitis
WHERE id = @formId",
                new
                {
                    formId,
                    envanterId = girdi.EnvanterId ?? (int?)ariza.envanterId,
                    mudahale = Mudahale(girdi.Mudahale),
                    tespit = girdi.Tespit,
                    yapilanIslem = girdi.YapilanIslem.Trim(),
                    parcaDegisti = parcalar.Count > 0,
                    cihazDegisti = girdi.CihazDegisti,
                    yeniCihaz = girdi.YeniCihaz,
                    parcaTutari,
                    iscilik,
                    toplam,
                    servisFirma = girdi.ServisFirma,
                    teknisyen = girdi.Teknisyen,
                    baslangic = girdi.Baslangic,
                    bitis = girdi.Bitis
                });

            db.Execute("DELETE FROM B360_SERVIS_PARCA WHERE form_id = @formId",
                new { formId });
        }
        else
        {
            formNo = NumaraUret(db);

            formId = db.ExecuteScalar<int>(@"
INSERT INTO B360_SERVIS_FORM
    (form_no, ariza_id, envanter_id, mudahale, tespit, yapilan_islem,
     parca_degisti, cihaz_degisti, yeni_cihaz, parca_tutari, iscilik, toplam,
     servis_firma, teknisyen, baslangic, bitis, olusturan, olusturan_adi)
OUTPUT INSERTED.id
VALUES (@formNo, @arizaId, @envanterId, @mudahale, @tespit, @yapilanIslem,
        @parcaDegisti, @cihazDegisti, @yeniCihaz, @parcaTutari, @iscilik,
        @toplam, @servisFirma, @teknisyen, @baslangic, @bitis, @olusturan,
        @olusturanAdi)",
                new
                {
                    formNo,
                    arizaId = girdi.ArizaId,
                    envanterId = girdi.EnvanterId ?? (int?)ariza.envanterId,
                    mudahale = Mudahale(girdi.Mudahale),
                    tespit = girdi.Tespit,
                    yapilanIslem = girdi.YapilanIslem.Trim(),
                    parcaDegisti = parcalar.Count > 0,
                    cihazDegisti = girdi.CihazDegisti,
                    yeniCihaz = girdi.YeniCihaz,
                    parcaTutari,
                    iscilik,
                    toplam,
                    servisFirma = girdi.ServisFirma,
                    teknisyen = girdi.Teknisyen,
                    baslangic = girdi.Baslangic,
                    bitis = girdi.Bitis,
                    olusturan = Kullanici,
                    olusturanAdi = AdSoyad
                });
        }

        foreach (var p in parcalar)
            db.Execute(@"
INSERT INTO B360_SERVIS_PARCA (form_id, ad, kod, adet, birim_fiyat, tutar, notu)
VALUES (@formId, @ad, @kod, @adet, @birimFiyat, @tutar, @notu)",
                new { formId, p.ad, p.kod, p.adet, p.birimFiyat, p.tutar, p.notu });

        /* Maliyet arıza kaydına da işleniyor: raporlar arıza üzerinden
           alınıyor ve her seferinde forma bağlanmak sorguları
           ağırlaştırıyordu. */
        try
        {
            db.Execute(@"
IF COL_LENGTH('B360_ARIZA', 'maliyet') IS NOT NULL
    UPDATE B360_ARIZA SET maliyet = @toplam WHERE id = @arizaId",
                new { toplam, arizaId = girdi.ArizaId });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Arıza maliyeti güncellenemedi");
        }

        return TutarGorur()
            ? Ok(new { id = formId, formNo, parcaTutari, iscilik, toplam })
            : Ok(new { id = formId, formNo, parcaTutari = (decimal?)null, iscilik = (decimal?)null, toplam = (decimal?)null });
    }

    /// <summary>
    /// Servis formunun yazdırılabilir belgesi.
    ///
    /// <para>
    /// A4 ve A5 destekleniyor: A4 dosyaya, A5 mağazada imzalatılıp cihaza
    /// iliştirilen kopyaya. Sayfa boyutu yazdırma kuralıyla veriliyor;
    /// iki ayrı şablon tutmak aynı düzeni iki kez sürdürmek olurdu.
    /// </para>
    ///
    /// <para>
    /// Tarayıcı yeni sekmede açarken başlık gönderemediği için jeton
    /// sorgudan kabul ediliyor (<c>j</c>).
    /// </para>
    /// </summary>
    [HttpGet("{id:int}/Belge")]
    public IActionResult Belge(int id, [FromQuery] string boyut = "a4")
    {
        if (!Yetkili()) return Forbid();

        using var db = _vt.Baglanti();

        var f = db.QueryFirstOrDefault(@"
SELECT f.*, a.baslik AS arizaBaslik, a.aciklama AS arizaAciklama,
       a.sube_kodu AS subeKodu, a.acan_adi AS acanAdi, a.olusturma AS arizaTarihi,
       a.oncelik, d.ad AS departman,
       e.tur AS cihazTuru, e.marka, e.model, e.seri_no AS seriNo, e.sicil_no AS sicilNo
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
    LEFT JOIN B360_DEPARTMAN d ON d.id = a.departman_id
    LEFT JOIN B360_ENVANTER e ON e.id = f.envanter_id
WHERE f.id = @id", new { id });

        if (f is null) return NotFound(new { hata = "Form bulunamadı." });

        var parcalar = db.Query(@"
SELECT ad, kod, adet, birim_fiyat AS birimFiyat, tutar, notu
FROM B360_SERVIS_PARCA WHERE form_id = @id ORDER BY id", new { id }).ToList();

        var firma = db.ExecuteScalar<string>(
            "SELECT deger FROM B360_AYAR WHERE anahtar = 'baslik'") ?? "Biçen Market";

        var a5 = string.Equals(boyut, "a5", StringComparison.OrdinalIgnoreCase);

        string H(object d) => System.Net.WebUtility.HtmlEncode(d?.ToString() ?? "");
        string T(object d) => d is DateTime t ? t.ToString("dd.MM.yyyy HH:mm") : "";
        var tutarGorur = TutarGorur();
        string P(object d) => d is null || !tutarGorur ? "—" : Convert.ToDecimal(d).ToString("N2") + " ₺";

        var mudahale = ((string)f.mudahale) switch
        {
            "uzaktan" => "Uzaktan",
            "merkezde" => "Merkezde (cihaz getirildi)",
            _ => "Yerinde"
        };

        var cihaz = string.Join(" ", new[] { (string)f.cihazTuru, (string)f.marka, (string)f.model }
            .Where(x => !string.IsNullOrWhiteSpace(x)));

        var parcaSatirlari = parcalar.Count == 0
            ? "<tr><td colspan=\"5\" class=\"bos\">Parça kullanılmadı</td></tr>"
            : string.Join("", parcalar.Select(p =>
                $"<tr><td>{H(p.ad)}</td><td>{H(p.kod)}</td><td class=\"sag\">{Convert.ToDecimal(p.adet):N2}</td>" +
                $"<td class=\"sag\">{P(p.birimFiyat)}</td><td class=\"sag\">{P(p.tutar)}</td></tr>"));

        var html = $@"<!doctype html>
<html lang=""tr"">
<head>
<meta charset=""utf-8"">
<title>Servis Formu {H(f.form_no)}</title>
<style>
  @page {{ size: {(a5 ? "A5" : "A4")}; margin: {(a5 ? "8mm" : "14mm")}; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: Segoe UI, Arial, sans-serif; color: #1f2933; margin: 0; padding: {(a5 ? "8mm" : "14mm")};
         font-size: {(a5 ? "10.5px" : "12.5px")}; }}
  .ust {{ display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 3px solid #7cb518; padding-bottom: {(a5 ? "5px" : "9px")}; margin-bottom: {(a5 ? "8px" : "14px")}; }}
  .firma {{ font-size: {(a5 ? "15px" : "19px")}; font-weight: 800; color: #5f8c10; }}
  .belge {{ font-size: {(a5 ? "11px" : "13px")}; font-weight: 700; }}
  .no {{ text-align: right; }}
  .no b {{ font-size: {(a5 ? "12px" : "15px")}; display: block; }}
  .no span {{ color: #6b7280; font-size: {(a5 ? "9.5px" : "11px")}; }}
  h2 {{ font-size: {(a5 ? "10.5px" : "12px")}; margin: {(a5 ? "8px 0 4px" : "14px 0 6px")}; color: #5f8c10;
        text-transform: uppercase; letter-spacing: .4px; border-bottom: 1px solid #e3e6e1; padding-bottom: 2px; }}
  table {{ width: 100%; border-collapse: collapse; }}
  .kunye td {{ padding: {(a5 ? "2px 4px" : "4px 6px")}; vertical-align: top; }}
  .kunye td:first-child {{ color: #6b7280; width: 28%; }}
  .kunye td:nth-child(3) {{ color: #6b7280; width: 22%; }}
  .parca th, .parca td {{ border: 1px solid #d9dcd5; padding: {(a5 ? "3px 5px" : "5px 8px")}; }}
  .parca th {{ background: #f2f9e8; text-align: left; font-weight: 700; }}
  .sag {{ text-align: right; }}
  .bos {{ color: #9aa3af; text-align: center; font-style: italic; }}
  .metin {{ white-space: pre-wrap; border: 1px solid #e3e6e1; border-radius: 4px;
            padding: {(a5 ? "4px 6px" : "7px 9px")}; min-height: {(a5 ? "26px" : "40px")}; background: #fafbf8; }}
  .toplam {{ margin-top: {(a5 ? "6px" : "10px")}; margin-left: auto; width: {(a5 ? "55%" : "42%")}; }}
  .toplam td {{ padding: {(a5 ? "2px 6px" : "4px 8px")}; }}
  .toplam tr:last-child td {{ border-top: 2px solid #7cb518; font-weight: 800; font-size: {(a5 ? "12px" : "15px")}; color: #5f8c10; }}
  .imza {{ display: flex; gap: {(a5 ? "12px" : "24px")}; margin-top: {(a5 ? "16px" : "30px")}; }}
  .imza div {{ flex: 1; border-top: 1px solid #1f2933; padding-top: 4px; font-size: {(a5 ? "9px" : "11px")}; color: #6b7280; }}
  .dip {{ margin-top: {(a5 ? "8px" : "16px")}; font-size: {(a5 ? "8.5px" : "10px")}; color: #9aa3af; }}
  .araclar {{ position: fixed; top: 10px; right: 10px; display: flex; gap: 6px; }}
  .araclar a, .araclar button {{ font: inherit; font-size: 12px; padding: 6px 12px; border: 1px solid #d9dcd5;
                                  background: #fff; border-radius: 6px; cursor: pointer; text-decoration: none; color: #1f2933; }}
  .araclar .ana {{ background: #7cb518; color: #fff; border-color: #7cb518; }}
  @media print {{ .araclar {{ display: none; }} body {{ padding: 0; }} }}
</style>
</head>
<body>
<div class=""araclar"">
  <a href=""?boyut=a4&j={H(Request.Query["j"])}"" class=""{(a5 ? "" : "ana")}"">A4</a>
  <a href=""?boyut=a5&j={H(Request.Query["j"])}"" class=""{(a5 ? "ana" : "")}"">A5</a>
  <button onclick=""window.print()"">Yazdır</button>
</div>

<div class=""ust"">
  <div>
    <div class=""firma"">{H(firma)}</div>
    <div class=""belge"">TEKNİK SERVİS FORMU</div>
  </div>
  <div class=""no"">
    <b>{H(f.form_no)}</b>
    <span>{T(f.olusturma)}</span>
  </div>
</div>

<h2>Arıza</h2>
<table class=""kunye"">
  <tr><td>Kayıt no</td><td>#{H(f.ariza_id)}</td><td>Şube</td><td>{H(f.subeKodu)}</td></tr>
  <tr><td>Başlık</td><td>{H(f.arizaBaslik)}</td><td>Departman</td><td>{H(f.departman)}</td></tr>
  <tr><td>Bildiren</td><td>{H(f.acanAdi)}</td><td>Bildirim</td><td>{T(f.arizaTarihi)}</td></tr>
</table>

<h2>Cihaz</h2>
<table class=""kunye"">
  <tr><td>Cihaz</td><td>{H(string.IsNullOrWhiteSpace(cihaz) ? "—" : cihaz)}</td><td>Seri no</td><td>{H(f.seriNo)}</td></tr>
  <tr><td>Sicil no</td><td>{H(f.sicilNo)}</td><td>Cihaz değişti</td><td>{((bool)f.cihaz_degisti ? "Evet — " + H(f.yeni_cihaz) : "Hayır")}</td></tr>
</table>

<h2>Müdahale</h2>
<table class=""kunye"">
  <tr><td>Biçim</td><td>{mudahale}</td><td>Teknisyen</td><td>{H(f.teknisyen)}</td></tr>
  <tr><td>Servis firması</td><td>{H(string.IsNullOrWhiteSpace((string)f.servis_firma) ? "Kendi ekibimiz" : f.servis_firma)}</td>
      <td>Başlangıç / bitiş</td><td>{T(f.baslangic)}{((f.baslangic is not null && f.bitis is not null) ? " – " : "")}{T(f.bitis)}</td></tr>
</table>

<h2>Tespit</h2>
<div class=""metin"">{H(f.tespit)}</div>

<h2>Yapılan işlem</h2>
<div class=""metin"">{H(f.yapilan_islem)}</div>

<h2>Kullanılan parçalar</h2>
<table class=""parca"">
  <tr><th>Parça</th><th>Kod</th><th class=""sag"">Adet</th><th class=""sag"">Birim</th><th class=""sag"">Tutar</th></tr>
  {parcaSatirlari}
</table>

<table class=""toplam"">
  <tr><td>Parça toplamı</td><td class=""sag"">{P(f.parca_tutari)}</td></tr>
  <tr><td>İşçilik / servis</td><td class=""sag"">{P(f.iscilik)}</td></tr>
  <tr><td>Genel toplam</td><td class=""sag"">{P(f.toplam)}</td></tr>
</table>

<div class=""imza"">
  <div>Servisi yapan<br><br>{H(f.teknisyen)}</div>
  <div>Teslim alan (mağaza)<br><br>&nbsp;</div>
</div>

<div class=""dip"">Bu belge Biçen360 portalından {DateTime.Now:dd.MM.yyyy HH:mm} tarihinde üretilmiştir. Düzenleyen: {H(f.olusturan_adi)}</div>
</body>
</html>";

        return Content(html, "text/html; charset=utf-8");
    }

    /* ====================================================================== */
    /* Raporlama                                                             */
    /* ====================================================================== */

    /// <summary>
    /// Servis maliyeti raporu.
    ///
    /// Günlük, haftalık ve aylık kırılım aynı uçtan: üç ayrı uç yazmak,
    /// aynı süzgeç mantığını üç kez sürdürmek demekti.
    /// </summary>
    [HttpGet("Rapor")]
    public IActionResult Rapor(
        [FromQuery] DateTime? bas = null,
        [FromQuery] DateTime? bit = null,
        [FromQuery] string kirilim = "gun",
        [FromQuery] string sube = null)
    {
        if (!PanelYetkili()) return Forbid();
        if (MaliyetKapsami() is not { } mk) return Forbid();

        var baslangic = bas?.Date ?? DateTime.Today.AddDays(-29);
        var bitis = (bit?.Date ?? DateTime.Today).AddDays(1);

        using var db = _vt.Baglanti();

        var gruplama = kirilim?.ToLowerInvariant() switch
        {
            "ay" => "FORMAT(f.olusturma, 'yyyy-MM')",
            "hafta" => "CONCAT(YEAR(f.olusturma), '-H', DATEPART(week, f.olusturma))",
            _ => "CONVERT(NVARCHAR(10), f.olusturma, 23)"
        };

        var donemler = db.Query($@"
SELECT {gruplama} AS donem,
       COUNT(*) AS adet,
       SUM(f.parca_tutari) AS parca,
       SUM(f.iscilik) AS iscilik,
       SUM(f.toplam) AS toplam
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@tumu = 1 OR a.departman_id IN @deps)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
GROUP BY {gruplama}
ORDER BY donem", new { baslangic, bitis, sube, tumu = mk.tumu, deps = mk.deps }).ToList();

        var subeler = db.Query(@"
SELECT ISNULL(a.sube_kodu, N'—') AS sube, COUNT(*) AS adet,
       SUM(f.toplam) AS toplam
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@tumu = 1 OR a.departman_id IN @deps)
GROUP BY a.sube_kodu
ORDER BY toplam DESC", new { baslangic, bitis, tumu = mk.tumu, deps = mk.deps }).ToList();

        /* En çok değişen parçalar: stok ve tedarik kararını bu besliyor */
        var parcalar = db.Query(@"
SELECT TOP 20 p.ad, SUM(p.adet) AS adet, SUM(p.tutar) AS tutar
FROM B360_SERVIS_PARCA p
    JOIN B360_SERVIS_FORM f ON f.id = p.form_id
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@tumu = 1 OR a.departman_id IN @deps)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
GROUP BY p.ad
ORDER BY tutar DESC", new { baslangic, bitis, sube, tumu = mk.tumu, deps = mk.deps }).ToList();

        var mudahaleler = db.Query(@"
SELECT f.mudahale, COUNT(*) AS adet, SUM(f.toplam) AS toplam
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@tumu = 1 OR a.departman_id IN @deps)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
GROUP BY f.mudahale", new { baslangic, bitis, sube, tumu = mk.tumu, deps = mk.deps }).ToList();

        var kayitlar = db.Query(@"
SELECT f.id, f.form_no AS formNo, f.olusturma, f.mudahale, f.toplam,
       f.parca_tutari AS parcaTutari, f.iscilik, f.teknisyen,
       a.id AS arizaId, a.baslik, a.sube_kodu AS subeKodu,
       e.marka, e.model, e.tur AS cihazTuru
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
    LEFT JOIN B360_ENVANTER e ON e.id = f.envanter_id
WHERE f.olusturma >= @baslangic AND f.olusturma < @bitis
  AND (@tumu = 1 OR a.departman_id IN @deps)
  AND (@sube IS NULL OR a.sube_kodu = @sube)
ORDER BY f.olusturma DESC", new { baslangic, bitis, sube, tumu = mk.tumu, deps = mk.deps }).ToList();

        return Ok(new
        {
            baslangic,
            bitis = bitis.AddDays(-1),
            kirilim,
            donemler,
            subeler,
            parcalar,
            mudahaleler,
            kayitlar,

            ozet = new
            {
                adet = kayitlar.Count,
                toplam = kayitlar.Sum(x => (decimal)(x.toplam ?? 0m)),
                parca = kayitlar.Sum(x => (decimal)(x.parcaTutari ?? 0m)),
                iscilik = kayitlar.Sum(x => (decimal)(x.iscilik ?? 0m))
            }
        });
    }

    /// <summary>Bir cihazın servis geçmişi.</summary>
    [HttpGet("Cihaz/{envanterId:int}")]
    public IActionResult CihazGecmisi(int envanterId)
    {
        if (!PanelYetkili()) return Forbid();
        if (MaliyetKapsami() is not { } mk) return Forbid();

        using var db = _vt.Baglanti();

        if (!mk.tumu && !mk.deps.Contains(db.ExecuteScalar<int?>(
                "SELECT departman_id FROM B360_ENVANTER WHERE id = @envanterId", new { envanterId }) ?? -1))
            return NotFound(new { hata = "Cihaz bulunamadı." });

        var kayitlar = db.Query(@"
SELECT f.id, f.form_no AS formNo, f.olusturma, f.mudahale, f.toplam,
       f.yapilan_islem AS yapilanIslem, f.teknisyen,
       a.id AS arizaId, a.baslik
FROM B360_SERVIS_FORM f
    LEFT JOIN B360_ARIZA a ON a.id = f.ariza_id
WHERE f.envanter_id = @envanterId
ORDER BY f.olusturma DESC", new { envanterId }).ToList();

        return Ok(new
        {
            kayitlar,
            toplamMaliyet = kayitlar.Sum(x => (decimal)(x.toplam ?? 0m))
        });
    }

    /* ====================================================================== */

    private static string Mudahale(string deger)
    {
        var d = (deger ?? "").Trim().ToLowerInvariant();

        return d is "uzaktan" or "yerinde" or "merkezde" ? d : "yerinde";
    }

    /// <summary>
    /// SRV-2026-000184 biçiminde form numarası.
    ///
    /// Mağazaya giden belgede bu numara var; kayıt kimliğini doğrudan
    /// vermek toplam servis sayısını dışarıya söylerdi.
    /// </summary>
    private static string NumaraUret(System.Data.IDbConnection db)
    {
        var yil = DateTime.Today.Year;

        var sonuncu = db.ExecuteScalar<string>(@"
SELECT TOP 1 form_no FROM B360_SERVIS_FORM
WHERE form_no LIKE @kalip ORDER BY form_no DESC",
            new { kalip = $"SRV-{yil}-%" });

        var sira = 1;

        if (!string.IsNullOrWhiteSpace(sonuncu))
        {
            var parca = sonuncu.Split('-');

            if (parca.Length == 3 && int.TryParse(parca[2], out var son)) sira = son + 1;
        }

        return $"SRV-{yil}-{sira:000000}";
    }
}

/* ========================================================================== */

public class ServisFormuGirdi
{
    public int ArizaId { get; set; }
    public int? EnvanterId { get; set; }

    /// <summary>uzaktan · yerinde · merkezde</summary>
    public string Mudahale { get; set; }

    public string Tespit { get; set; }
    public string YapilanIslem { get; set; }

    public bool CihazDegisti { get; set; }
    public string YeniCihaz { get; set; }

    public decimal Iscilik { get; set; }

    public string ServisFirma { get; set; }
    public string Teknisyen { get; set; }

    public DateTime? Baslangic { get; set; }
    public DateTime? Bitis { get; set; }

    public List<ServisParcaGirdi> Parcalar { get; set; } = new();
}

public class ServisParcaGirdi
{
    public string Ad { get; set; }
    public string Kod { get; set; }
    public decimal Adet { get; set; } = 1;
    public decimal BirimFiyat { get; set; }
    public string Notu { get; set; }
}

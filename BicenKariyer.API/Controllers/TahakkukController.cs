using System.Text.RegularExpressions;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Ücret hesap pusulası (tahakkuk makbuzu).
///
/// <para>
/// Veri Mikro'daki bordro veritabanından (MikroDesktop_BICEN) gelir;
/// personel listesinin okunduğu MikroDesktop_2004BICEN'den farklıdır.
/// Bağlantı <c>ConnectionStrings:Tahakkuk</c>, yoksa personel
/// bağlantısının veritabanı adı değiştirilerek kurulur. Bu tablonun
/// yüzlerce sütunu var ve adları sürümden sürüme değişebiliyor; bu yüzden
/// pusuladaki her alan bir Mikro sütununa <b>eşlenir</b>. Eşleme Form
/// Ayarları'nda saklanır (<c>FormAyarlari.TahakkukEslesme</c>); boşsa sütun
/// adına göre otomatik tahmin yapılır ve panelde "Sütun eşleme" ekranından
/// düzeltilebilir. Pusula PDF'i panelde üretilir; buradan yalnızca veri döner.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.GenelMudurYardimcisi)]
public class TahakkukController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly ILogger<TahakkukController> _kayit;

    public TahakkukController(VeritabaniServisi vt, AyarServisi ayar,
                              ILogger<TahakkukController> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Pusula alanları                                                      */
    /* ==================================================================== */

    /// <summary>
    /// Pusuladaki alanlar. Kod, ekranda ve eşlemede anahtar; etiket
    /// pusulada görünen ad; tahmin, Mikro sütun adında aranan parçalar
    /// (hepsi geçmeli; "|" ile alternatifler).
    /// </summary>
    /// <summary>
    /// Pusula alanı: kod, grup, varsayılan etiket, tür ve Mikro sütunu.
    ///
    /// <para>
    /// Mikro tahakkuk tablosu yuvalıdır: kazanç 1–7, ek kazanç 1–11,
    /// sosyal yardım 1–32, özel kesinti 1–24. Etiketler firmaya göre
    /// tanımlanır; buradaki adlar Biçen'in makbuzundaki sıradır ve
    /// Yönetim → Tahakkuk'tan değiştirilebilir. Sütunlar sabittir,
    /// gerekirse Sütun eşleme ekranından değiştirilir.
    /// </para>
    /// </summary>
    public sealed record PusulaAlani(string Kod, string Grup, string Etiket, string Tur, string Sutun);

    public static readonly PusulaAlani[] Alanlar = BuildAlanlar();

    private static PusulaAlani[] BuildAlanlar()
    {
        var liste = new List<PusulaAlani>();

        var kazancAdlari = new[] { "Normal", "Hafta tatili", "Genel tatil", "Ücretli izin", "Mazeret izni", "Hasta", "Kısa çalışma" };
        for (var i = 0; i < kazancAdlari.Length; i++)
        {
            var n = i + 1;
            liste.Add(new($"kazanc{n}Gun", "kazanc", kazancAdlari[i], "gun", $"pt_kazanc{n}_tkgun"));
            liste.Add(new($"kazanc{n}Saat", "kazanc", kazancAdlari[i], "saat", $"pt_kazanc{n}_tksaat"));
            liste.Add(new($"kazanc{n}Tutar", "kazanc", kazancAdlari[i], "tutar", $"pt_kazanc{n}_tktutar"));
        }

        var ekAdlari = new[] { "Tatil mes.", "Fazla mes. 1.", "Fazla mes. 2.", "Fazla mes. 3.", "Fazla mes. 4.", "Gece mes.", "Dig.Kazanç 1.", "Genel tatil", "Dig.Kazanç 2.", "Dig.Kazanç 3.", "Dig.Kazanç 4." };
        for (var i = 0; i < ekAdlari.Length; i++)
        {
            var n = i + 1;
            liste.Add(new($"ekKazanc{n}Saat", "ekKazanc", ekAdlari[i], "saat", $"pt_ekkazanc{n}_tksaat"));
            liste.Add(new($"ekKazanc{n}Tutar", "ekKazanc", ekAdlari[i], "tutar", $"pt_ekkazanc{n}_tktutar"));
            liste.Add(new($"ekKazanc{n}Carpan", "carpan", ekAdlari[i], "carpan", $"pt_EkKazancBNCarpan{n}"));
        }

        liste.Add(new("kazancCarpan", "carpan", "Kazanç çarpanı", "carpan", "pt_KazancBNCarpan"));

        var sosyalAdlari = new[] { "Çocuk", "Okul öncesi", "İlk okul", "Orta okul", "Lise", "Yüksek", "Yol", "Yemek", "Yakacak", "Bayram", "Aile yardımı", "Prim", "İkramiye", "İzin", "Kasa tazminatı", "İhbar tazminatı", "Giyim yardımı", "Doğum yardımı", "Askerlik yardımı", "Evlenme yardımı", "Ölüm yardımı", "Tahsil", "Kıdem tazminatı", "İzin parası", "Kumanya", "Yol yardımı", "Sosyal yardım 27", "Sosyal yardım 28", "Sosyal yardım 29", "Sosyal yardım 30", "Sosyal yardım 31", "Sosyal yardım 32" };
        for (var i = 0; i < sosyalAdlari.Length; i++)
        {
            liste.Add(new($"sosyal{i + 1}", "sosyal", sosyalAdlari[i], "tutar", $"pt_sosyrdm{i + 1}"));
            /* Brütleştirme çarpanı: Mikro pusulada tutarı çarpanla gösterir */
            liste.Add(new($"sosyal{i + 1}Carpan", "carpan", sosyalAdlari[i], "carpan", $"pt_SosYardBNCarpan{i + 1}"));
        }

        var ozelAdlari = new[] { "Sendika aidatı", "Borç taksidi", "İcra taksidi", "Kredi taksidi", "Avans", "İzin avansı", "İkramiye avansı", "Yakacak avansı", "Bayram avansı", "Yardım sandığı", "Fon kesintisi", "Trafik cezası", "Geçen yuvarlama", "Ters bakiye", "Diğer 1", "Diğer 2", "Diğer 3", "Askerlik borç", "Kasa kesintisi", "İcra kesintisi", "Özel kesinti 21", "Özel kesinti 22", "Özel kesinti 23", "Özel kesinti 24" };
        for (var i = 0; i < ozelAdlari.Length; i++)
            liste.Add(new($"ozel{i + 1}", "ozelKesinti", ozelAdlari[i], "tutar", $"pt_ozksnt{i + 1}"));

        liste.Add(new("sgkGunu", "yasal", "SGK günü", "gun", "pt_sskgunu"));
        liste.Add(new("oncekiAyDevirToplamSgk", "yasal", "Ön.Ay.Dev.Top. SGK", "tutar", "pt_gecenaylardankullanilanssk"));
        liste.Add(new("oncekiAyDevirEkleSgk", "yasal", "Ön.Ay.Dev.Ekle.SGK", "tutar", "pt_sskkonutfonukad"));
        liste.Add(new("oncekiTahDevirSgkMatrah", "yasal", "Ön.Tah.Dev.SGK Matr", "tutar", "pt_devsskmatrah"));
        liste.Add(new("sgkMatrahi", "yasal", "SGK matrahı", "tutar", "pt_sskbrutmatrah"));
        liste.Add(new("sgkMuafIndirimi", "yasal", "SGK Muaf İnd.", "tutar", "pt_digverindssk"));
        liste.Add(new("sgkPrimi", "yasal", "SGK Primi", "tutar", "pt_sskprimi"));
        liste.Add(new("sonrakiAyDevirSgkMatrah", "yasal", "Snr.ay.Dev.SGK.Matr", "tutar", "pt_sonrayadevredensskmatrahi"));
        liste.Add(new("devirGvMatrahi", "yasal", "Dev. GV Matr.", "tutar", "pt_devgvmatrah"));
        liste.Add(new("toplamGvMatrahi", "yasal", "Toplam GV Matr", "tutar", "pt_gvbrut"));
        liste.Add(new("ozelIndirim", "yasal", "Özel İnd.", "tutar", "pt_verind"));
        liste.Add(new("gocmenIndirimi", "yasal", "Göçmen İnd.", "tutar", "pt_gocverind"));
        liste.Add(new("sakatlikIndirimi", "yasal", "Sakatlık İnd.", "tutar", "pt_sakverind"));
        liste.Add(new("ozelSigortaIndirimi", "yasal", "Özel sig. İnd.", "tutar", "pt_hayatsigortasi"));
        liste.Add(new("gvMuafIndirimi", "yasal", "GV Muaf İnd.", "tutar", "pt_digverindgv"));
        liste.Add(new("toplamIndirim", "yasal", "TOPlam İnd.", "tutar", "pt_toplamind"));
        liste.Add(new("otomatikBes", "yasal", "Otomatik BES", "tutar", "pt_otobes_tutari"));
        liste.Add(new("gvMatrahi", "yasal", "GV matrahı", "tutar", "pt_gvmatrah"));
        liste.Add(new("dvMatrahi", "yasal", "DV matrahı", "tutar", "pt_dvmatrah"));
        liste.Add(new("gv", "yasal", "GV", "tutar", "pt_gv"));
        liste.Add(new("gvIstisnaOncesi", "yasal", "GV(İstisna öncesi)", "tutar", "pt_sanalgv"));
        liste.Add(new("dv", "yasal", "DV", "tutar", "pt_dv"));
        liste.Add(new("issizlikSigortasi", "yasal", "İşsizlik Sig.", "tutar", "pt_iszlksigperpayi"));
        liste.Add(new("gvIstisnasi", "yasal", "GV İstisnası", "tutar", "pt_asgariucret_gvindirimi"));
        liste.Add(new("dvIstisnasi", "yasal", "DV İstisnası", "tutar", "pt_asgariucret_dvindirimi"));

        /* Mikro'da sütunu olmayan, makbuzda türetilen satırlar. Sütun adı
           "hesap:" ile başlıyor ki eşleme ekranında "eşlenmedi" diye
           görünmesinler: eşlenecek bir şey yok, değer hesaplanıyor. */
        liste.Add(new("netIstisnaOncesi", "yasal", "Net(İstisna öncesi)", "tutar",
            "hesap:net - GV istisnası - DV istisnası"));

        liste.Add(new("kesintiIstisnaOncesi", "yasal", "Toplam(İstisna önc)", "tutar",
            "hesap:toplam kesinti + GV istisnası"));

        liste.Add(new("toplamKazanc", "toplam", "Toplam kazanç", "tutar", "pt_kazanc"));
        liste.Add(new("toplamKesinti", "toplam", "Toplam kesinti", "tutar", "pt_kesinti"));
        liste.Add(new("yuvarlamaFarki", "toplam", "Yuvarlama farkı", "tutar", "pt_yuvfarki"));
        liste.Add(new("netOdenecek", "toplam", "Net ödenecek", "tutar", "pt_net"));

        return liste.ToArray();
    }

    /* ==================================================================== */
    /* İşyeri bilgileri (Mikro)                                             */
    /* ==================================================================== */

    /// <summary>
    /// SGK şubelerinin ünvan, adres ve işyeri sicil bilgisi.
    ///
    /// <para>
    /// Bu bilgiler eskiden panelden elle giriliyordu ve tek bir adres
    /// bütün şubelere yazılıyordu. Oysa her SGK işyerinin kendi ünvanı,
    /// adresi ve sicil numarası var; pusulanın üst bloğu yanlış işyerini
    /// gösteriyordu. Artık <c>PERSONEL_SSK_TANIMLARI</c> tablosundan
    /// okunuyor — Mikro'da ne yazıyorsa pusulada o.
    /// </para>
    ///
    /// <para>
    /// Kolon adları sürümden sürüme değişebildiği için satır tümüyle
    /// okunup alanlar adla aranıyor; bulunamayan alan sessizce boş kalıyor
    /// ve panelden girilen değer devreye giriyor.
    /// </para>
    /// </summary>
    private Dictionary<int, TahakkukIsyeri> IsyerleriOku(System.Data.IDbConnection db)
    {
        var sonuc = new Dictionary<int, TahakkukIsyeri>();

        try
        {
            var satirlar = Satirlar(db.Query(
                "SELECT * FROM PERSONEL_SSK_TANIMLARI WITH (NOLOCK)"));

            foreach (var r in satirlar)
            {
                /* Sayi ondalık döndürüyor; sözlük anahtarı SGK şube
                   numarası, yani tam sayı. */
                var no = Sayi(Al(r, "ssk_Sira_No")) is decimal d ? (int)d : (int?)null;

                if (no is null) continue;

                var unvan = Metin(Al(r, "ssk_FirmaUnvani"));
                var unvan2 = Metin(Al(r, "ssk_FirmaUnvani2"));

                /* Adres üç satıra bölünüyor: pusulanın üst bloğu üç satır
                   yüksekliğinde ve tek satıra sığdırılan adres kesiliyordu. */
                var satir1 = Birlestir(
                    Metin(Al(r, "ssk_mahalle")),
                    Metin(Al(r, "ssk_cadde")),
                    Metin(Al(r, "ssk_sokak")));

                var satir2 = Birlestir(
                    Metin(Al(r, "ssk_Apt_No")) is { Length: > 0 } ap ? $"No: {ap}" : null,
                    Metin(Al(r, "ssk_Daire_No")) is { Length: > 0 } da ? $"Daire: {da}" : null,
                    Metin(Al(r, "ssk_Adr_Semt")) ?? Metin(Al(r, "ssk_Semt")));

                var ilce = Metin(Al(r, "ssk_ilce"));
                var il = Metin(Al(r, "ssk_il"));

                var satir3 = string.IsNullOrWhiteSpace(ilce) || string.IsNullOrWhiteSpace(il)
                    ? Birlestir(ilce, il)
                    : $"{ilce}/{il}";

                sonuc[no.Value] = new TahakkukIsyeri
                {
                    Unvan = string.IsNullOrWhiteSpace(unvan2) ? unvan : $"{unvan} {unvan2}".Trim(),
                    Adres1 = satir1,
                    Adres2 = satir2,
                    Adres3 = satir3,
                    TicSicilNo = Metin(Al(r, "ssk_Ticaret_Sicil_No")),

                    /* Telefon, faks ve web Mikro'nun bu tablosunda yok;
                       panelden girilen kurum geneli değerler kullanılıyor. */
                    Telefon = null,
                    Faks = null,
                    Web = null
                };
            }
        }
        catch (Exception hata)
        {
            /* Tablo yoksa ya da erişilemezse panelden girilen bilgilerle
               devam ediliyor; pusulanın hiç üretilememesindense. */
            _kayit.LogWarning(hata, "İşyeri bilgileri Mikro'dan okunamadı");
        }

        return sonuc;
    }

    /// <summary>SGK şubelerinin Mikro'daki adları.</summary>
    private Dictionary<int, string> IsyeriAdlari(System.Data.IDbConnection db)
    {
        var sonuc = new Dictionary<int, string>();

        try
        {
            foreach (var r in Satirlar(db.Query(
                "SELECT ssk_Sira_No, ssk_ismi FROM PERSONEL_SSK_TANIMLARI WITH (NOLOCK)")))
            {
                var no = Sayi(Al(r, "ssk_Sira_No")) is decimal d ? (int)d : (int?)null;
                var ad = Metin(Al(r, "ssk_ismi"));

                if (no is not null && !string.IsNullOrWhiteSpace(ad)) sonuc[no.Value] = ad;
            }
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "SGK şube adları okunamadı");
        }

        return sonuc;
    }

    /// <summary>Boş olmayan parçaları boşlukla birleştirir.</summary>
    private static string Birlestir(params string[] parcalar) =>
        string.Join(" ", parcalar.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim()));

    /// <summary>
    /// Panelden girilen genel bilgiyle Mikro'daki işyerini birleştirir.
    ///
    /// Mikro'da dolu olan alan üstün: pusulada görünen ünvan ve adres
    /// bordronun bağlı olduğu işyerinin kendisi olmalı. Telefon, faks ve
    /// web Mikro'da tutulmadığı için panelden geliyor.
    /// </summary>
    private static TahakkukIsyeri IsyeriBirlestir(TahakkukIsyeri panel, TahakkukIsyeri mikro)
    {
        if (mikro is null) return panel;

        string Sec(string m, string p) => string.IsNullOrWhiteSpace(m) ? p : m;

        return new TahakkukIsyeri
        {
            Unvan = Sec(mikro.Unvan, panel?.Unvan),
            Adres1 = Sec(mikro.Adres1, panel?.Adres1),
            Adres2 = Sec(mikro.Adres2, panel?.Adres2),
            Adres3 = Sec(mikro.Adres3, panel?.Adres3),
            TicSicilNo = Sec(mikro.TicSicilNo, panel?.TicSicilNo),
            Telefon = panel?.Telefon,
            Faks = panel?.Faks,
            Web = panel?.Web
        };
    }

    /* ==================================================================== */
    /* Yardımcılar                                                          */
    /* ==================================================================== */

    /// <summary>Eşlenecek anahtarlar.</summary>
    public static IEnumerable<string> AlanAnahtarlari() => Alanlar.Select(a => a.Kod);

    /// <summary>
    /// Panelin kullandığı alan tanımları. Etiket ayarda değiştirilmişse o
    /// kullanılır (Mikro'da yuva adları firmaya göre tanımlanır).
    /// </summary>
    private IEnumerable<object> AlanTanimlari()
    {
        var etiketler = _ayar.FormOku().TahakkukEtiketler ?? new Dictionary<string, string>();

        return Alanlar.Select(a =>
        {
            /* Gün/saat/tutar aynı yuvanın parçaları: etiket yuva bazında */
            var temel = a.Kod.EndsWith("Gun") ? a.Kod[..^3]
                      : a.Kod.EndsWith("Saat") ? a.Kod[..^4]
                      : a.Kod.EndsWith("Tutar") ? a.Kod[..^5]
                      : a.Kod;

            return (object)new
            {
                kod = a.Kod,
                temel,
                grup = a.Grup,
                etiket = etiketler.TryGetValue(temel, out var e) && !string.IsNullOrWhiteSpace(e) ? e : a.Etiket,
                tur = a.Tur,

                /* Hesaplanan alanlarda sütun yerine formül gösteriliyor;
                   panel bunu "eşlenmedi" diye değil "hesaplanıyor" diye
                   yazsın. */
                hesaplanan = (a.Sutun ?? "").StartsWith("hesap:", StringComparison.OrdinalIgnoreCase),
                sutun = (a.Sutun ?? "").StartsWith("hesap:", StringComparison.OrdinalIgnoreCase)
                    ? a.Sutun[6..]
                    : a.Sutun,
            };
        });
    }

    private static string Sade(string metin)
    {
        var kaynak = "ÇĞİIÖŞÜçğıiöşü";
        var karsilik = "cgiiosucgiiosu";
        var kutu = new System.Text.StringBuilder();

        foreach (var h in metin ?? "")
        {
            var yer = kaynak.IndexOf(h);
            kutu.Append(yer >= 0 ? karsilik[yer] : char.ToLowerInvariant(h));
        }

        return kutu.ToString();
    }

    /// <summary>Sütun adı, tahmin parçalarının hepsini içeriyor mu.</summary>
    private static bool Uyuyor(string sutun, string[] parcalar)
    {
        var s = Sade(sutun);

        foreach (var p in parcalar)
        {
            var secenekler = p.Split('|');

            if (!secenekler.Any(x => s.Contains(x))) return false;
        }

        return true;
    }

    /// <summary>
    /// Kayıtlı eşleme + otomatik tahmin. Kayıtlı olan önce; tahminde en
    /// kısa (en az fazladan parça içeren) sütun adı seçilir.
    /// </summary>
    private Dictionary<string, string> Eslesme(IEnumerable<string> sutunlar)
    {
        var kayitli = _ayar.FormOku().TahakkukEslesme ?? new Dictionary<string, string>();
        var liste = sutunlar.ToList();
        var sonuc = new Dictionary<string, string>();

        foreach (var a in Alanlar)
        {
            /* Kayıtlı eşleme her zaman üstün; yoksa sabit Mikro sütunu */
            var aday = kayitli.TryGetValue(a.Kod, out var k) && !string.IsNullOrWhiteSpace(k)
                ? k : a.Sutun;

            /* Hesaplanan alanlar: sütunu yok ya da 'hesap:' ile işaretli.
               Sütun listesinde aranırsa hiçbir zaman bulunamaz ve boşuna
               "eşlenmedi" görünürler. */
            if (string.IsNullOrWhiteSpace(aday) ||
                aday.StartsWith("hesap:", StringComparison.OrdinalIgnoreCase))
                continue;

            var gercek = liste.FirstOrDefault(x => string.Equals(x, aday, StringComparison.OrdinalIgnoreCase));

            if (gercek is not null) sonuc[a.Kod] = gercek;
        }

        return sonuc;
    }

    private static decimal? Sayi(object v)
    {
        if (v is null || v is DBNull) return null;

        try { return Convert.ToDecimal(v); }
        catch { return null; }
    }

    private static string Metin(object v) => v is null || v is DBNull ? null : Convert.ToString(v)?.Trim();

    /// <summary>
    /// Dapper satırlarını sözlük olarak okur.
    ///
    /// <para>
    /// <c>Query</c> <c>IEnumerable&lt;dynamic&gt;</c> döndürüyor; üzerinde
    /// <c>Select(x =&gt; ...)</c> çağrılırsa çağrı dinamik dağıtıma düşüyor
    /// ve sonucun tipi kayboluyor (CS1977/CS8197). <c>Cast</c> ile statik
    /// tipe alınır: DapperRow zaten IDictionary&lt;string, object&gt;.
    /// </para>
    /// </summary>
    private static List<IDictionary<string, object>> Satirlar(IEnumerable<dynamic> sorgu) =>
        sorgu.Cast<IDictionary<string, object>>().ToList();

    private static object Al(IDictionary<string, object> satir, string sutun)
    {
        if (sutun is null) return null;

        foreach (var k in satir.Keys)
            if (string.Equals(k, sutun, StringComparison.OrdinalIgnoreCase)) return satir[k];

        return null;
    }

    /// <summary>Bir sözlükte ada göre ilk sütunu bulur (parçalar geçmeli).</summary>
    private static object Bul(IDictionary<string, object> satir, params string[] parcalar)
    {
        foreach (var k in satir.Keys)
            if (Uyuyor(k, parcalar)) return satir[k];

        return null;
    }

    /* ==================================================================== */
    /* Uçlar                                                                */
    /* ==================================================================== */

    /// <summary>Dönemde tahakkuku olan SGK şubeleri ve personel sayıları.</summary>
    [HttpGet("Subeler")]
    public IActionResult Subeler([FromQuery] int yil, [FromQuery] int ay)
    {
        try
        {
            using var db = _vt.TahakkukBaglantisi();

            /* SGK şubesinin adı: o şubedeki personelin en çok bağlı olduğu
               iş grubu (mağaza). Böylece "016 SGK şubesi" yerine mağaza adı
               görünür; ayarda elle ad verilmişse o üstün gelir. */
            var liste = Satirlar(db.Query(@"
WITH t AS (
    SELECT p.per_ucr_PSSK_sube AS sskNo,
           ISNULL(pig.ig_adi, N'') AS birim
    FROM PERSONEL_TAHAKKUKLARI k WITH (NOLOCK)
    JOIN PERSONELLER p WITH (NOLOCK) ON p.per_kod = k.pt_pkod
    LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI pig WITH (NOLOCK)
           ON pig.ig_kod = p.per_is_grup_kodu
    WHERE k.pt_maliyil = @yil AND k.pt_tah_ay = @ay
)
SELECT sskNo,
       COUNT(*) AS adet,
       (SELECT TOP 1 birim FROM t x
        WHERE x.sskNo = t.sskNo AND LTRIM(RTRIM(x.birim)) <> N''
        GROUP BY x.birim ORDER BY COUNT(*) DESC) AS birim
FROM t
GROUP BY sskNo
ORDER BY sskNo", new { yil, ay }));

            /* Şube adı ve işyeri sicil no ayarlardan: Mikro'daki
               PERSONEL_SSK_TANIMLARI sütun adları sürüme göre değişiyor ve
               tahmin adres gibi yanlış alanları getiriyordu. */
            var subeAyari = _ayar.FormOku().TahakkukSubeler ?? new Dictionary<string, TahakkukSube>();

            /* Şube adı Mikro'daki işyeri tanımından; ayarda elle yazılmış
               bir ad varsa o üstün gelir. Önceden ad bulunamadığında liste
               "adsız şube" diye doluyordu. */
            var mikroAdlari = IsyeriAdlari(db);

            var sonuc = liste.Select(x =>
            {
                var no = Convert.ToInt32(Al(x, "sskNo"));
                subeAyari.TryGetValue(no.ToString(), out var ayar);

                var birim = Metin(Al(x, "birim"));
                var mikroAdi = mikroAdlari.GetValueOrDefault(no);

                var ad = !string.IsNullOrWhiteSpace(ayar?.Ad) ? ayar.Ad
                       : !string.IsNullOrWhiteSpace(mikroAdi) ? mikroAdi
                       : birim;

                return new
                {
                    sskNo = no,
                    adet = Convert.ToInt32(Al(x, "adet")),
                    ad,
                    adKaynagi = !string.IsNullOrWhiteSpace(ayar?.Ad) ? "ayar"
                              : !string.IsNullOrWhiteSpace(mikroAdi) ? "mikro"
                              : string.IsNullOrWhiteSpace(birim) ? "yok" : "birim",
                    sicilNo = ayar?.SicilNo,
                };
            }).ToList();

            return Ok(sonuc);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Tahakkuk şubeleri alınamadı");
            return StatusCode(503, new { hata = "Mikro'ya ulaşılamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>
    /// Bir dönemde bir SGK şubesindeki personelin pusula verisi. Her kişi
    /// için eşlenmiş alanlar ve ham tahakkuk satırı (eşleme denetimi için).
    /// </summary>
    [HttpGet("Pusula")]
    public IActionResult Pusula([FromQuery] int yil, [FromQuery] int ay, [FromQuery] int sskNo,
                                [FromQuery] string personelKodu = null)
    {
        try
        {
            using var db = _vt.TahakkukBaglantisi();

            var ayarlar = _ayar.FormOku();

            /* İşyeri bilgisi bordronun bağlı olduğu SGK şubesinden geliyor;
               panelden girilen değerler yalnızca Mikro'da boş kalan alanlar
               için yedek. */
            var isyeri = IsyeriBirlestir(
                ayarlar.TahakkukIsyeriBilgisi ?? new TahakkukIsyeri(),
                IsyerleriOku(db).GetValueOrDefault(sskNo));
            (ayarlar.TahakkukSubeler ?? new Dictionary<string, TahakkukSube>())
                .TryGetValue(sskNo.ToString(), out var subeAyari);

            /* Ad ayarda yoksa şubedeki personelin bağlı olduğu birimden */
            var subeBirimi = subeAyari is not null && !string.IsNullOrWhiteSpace(subeAyari.Ad)
                ? subeAyari.Ad
                : db.Query<string>(@"
SELECT TOP 1 ISNULL(pig.ig_adi, N'')
FROM PERSONELLER p WITH (NOLOCK)
LEFT JOIN PERSONEL_IS_GRUP_TANIMLARI pig WITH (NOLOCK) ON pig.ig_kod = p.per_is_grup_kodu
WHERE p.per_ucr_PSSK_sube = @sskNo AND ISNULL(pig.ig_adi, N'') <> N''
GROUP BY pig.ig_adi
ORDER BY COUNT(*) DESC", new { sskNo }).FirstOrDefault();

            var personeller = Satirlar(db.Query(@"
SELECT p.*
FROM PERSONELLER p WITH (NOLOCK)
WHERE p.per_ucr_PSSK_sube = @sskNo
  AND (@kod IS NULL OR p.per_kod = @kod)
  AND EXISTS (SELECT 1 FROM PERSONEL_TAHAKKUKLARI t WITH (NOLOCK)
              WHERE t.pt_pkod = p.per_kod AND t.pt_maliyil = @yil AND t.pt_tah_ay = @ay)
ORDER BY p.per_adi, p.per_soyadi", new { yil, ay, sskNo, kod = personelKodu }));

            /* Ünvan adı: Mikro pusulasında 'Görevi' sütunu meslek kodu ile
               ünvanı birlikte yazar (5230.04-KASİYER). Ünvan tanımları
               personel listesinde de bu tablodan okunuyor. */
            var unvanlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            try
            {
                foreach (var u in db.Query("SELECT un_kod AS kod, un_aciklama AS ad FROM PERSONEL_UNVAN_TANIMLARI WITH (NOLOCK)"))
                {
                    var kod = Metin(((IDictionary<string, object>)u)["kod"]);
                    var ad = Metin(((IDictionary<string, object>)u)["ad"]);
                    if (!string.IsNullOrWhiteSpace(kod) && ad is not null) unvanlar[kod] = ad;
                }
            }
            catch { /* ünvan tablosu okunamazsa ad boş kalır */ }

            Dictionary<string, string> eslesme = null;
            var sonuc = new List<object>();

            foreach (var p in personeller)
            {
                var kod = Metin(Al(p, "per_kod"));

                /* Aynı dönemde birden çok tahakkuk (pt_tahno) olabilir; ilki
                   asıl bordro, sonrakiler ek tahakkuk. Kanun modu 0 asıl. */
                var tahakkuk = Satirlar(db.Query(@"
SELECT * FROM PERSONEL_TAHAKKUKLARI WITH (NOLOCK)
WHERE pt_pkod = @kod AND pt_maliyil = @yil AND pt_tah_ay = @ay
ORDER BY pt_tahno, pt_kanun_modu", new { kod, yil, ay })).FirstOrDefault();

                if (tahakkuk is null) continue;

                eslesme ??= Eslesme(tahakkuk.Keys);

                var alanlar = new Dictionary<string, object>();

                foreach (var anahtar in AlanAnahtarlari())
                    alanlar[anahtar] = eslesme.TryGetValue(anahtar, out var sutun)
                        ? Sayi(Al(tahakkuk, sutun)) : null;

                /* Sosyal yardımlar Mikro'da NET tutulur; makbuzda brüt
                   gösterilir. Brüt = net × pt_SosYardBNCarpan{n}. Çarpan
                   yoksa ya da 0 ise net değer olduğu gibi kalır. */
                for (var n = 1; n <= 32; n++)
                {
                    var carpan = Sayi(Al(tahakkuk, $"pt_SosYardBNCarpan{n}"));

                    if (carpan is null || carpan <= 0) continue;

                    if (alanlar.TryGetValue($"sosyal{n}", out var d) && d is decimal net)
                        alanlar[$"sosyal{n}"] = Math.Round(net * carpan.Value, 2);
                }

                /* Kazanç ve ek kazançta da aynı çarpan mantığı var */
                var kazancCarpan = Sayi(Al(tahakkuk, "pt_KazancBNCarpan"));

                if (kazancCarpan is > 0 and not 1)
                    for (var n = 1; n <= 7; n++)
                        if (alanlar.TryGetValue($"kazanc{n}Tutar", out var d) && d is decimal net)
                            alanlar[$"kazanc{n}Tutar"] = Math.Round(net * kazancCarpan.Value, 2);

                for (var n = 1; n <= 11; n++)
                {
                    var carpan = Sayi(Al(tahakkuk, $"pt_EkKazancBNCarpan{n}"));

                    if (carpan is null || carpan <= 0 || carpan == 1) continue;

                    if (alanlar.TryGetValue($"ekKazanc{n}Tutar", out var d) && d is decimal net)
                        alanlar[$"ekKazanc{n}Tutar"] = Math.Round(net * carpan.Value, 2);
                }

                /* İstisna öncesi satırları Mikro'da ayrı sütun değil; makbuzda
                   türetilerek gösteriliyor:
                     Net (istisna öncesi)    = net − GV istisnası − DV istisnası
                     Toplam (istisna öncesi) = toplam kesinti + GV istisnası */
                decimal? D(string k) => alanlar.TryGetValue(k, out var v) && v is decimal x ? x : null;

                var gvIst = D("gvIstisnasi") ?? 0;
                var dvIst = D("dvIstisnasi") ?? 0;

                if (D("netOdenecek") is decimal netOd)
                    alanlar["netIstisnaOncesi"] = Math.Round(netOd - gvIst - dvIst, 2);

                if (D("toplamKesinti") is decimal topKes)
                    alanlar["kesintiIstisnaOncesi"] = Math.Round(topKes + gvIst, 2);

                var meslekKodu = Metin(Al(p, "per_meslek_kodu")) ?? Metin(Bul(p, "meslek", "kod"));
                var unvanKodu = Metin(Al(p, "per_unvan_kodu"));

                /* Anonim nesne içinde 'out var' kullanılmaz; önce çözülür */
                string meslekAdi = null;
                if (unvanKodu is not null) unvanlar.TryGetValue(unvanKodu, out meslekAdi);

                var ucretTipiSayisi = Sayi(Al(p, "per_ucr_tip"));

                sonuc.Add(new
                {
                    personelKodu = kod,
                    adSoyad = $"{Metin(Al(p, "per_adi"))} {Metin(Al(p, "per_soyadi"))}".Trim(),
                    kimlikNo = Metin(Al(p, "per_sicil_no")),
                    sgkSicilNo = Metin(Al(p, "per_ssk_sicil_no")) ?? Metin(Bul(p, "ssk", "sicil")),
                    girisTarihi = Al(p, "per_giris_tar") is DateTime g && g.Year > 1900 ? g : (DateTime?)null,
                    cikisTarihi = Al(p, "per_cikis_tar") is DateTime c && c.Year > 1900 ? c : (DateTime?)null,
                    gorevKodu = unvanKodu,
                    meslekKodu,
                    meslekAdi,
                    gorevAdi = meslekKodu is not null && meslekAdi is not null
                        ? $"{meslekKodu}-{meslekAdi}" : meslekKodu ?? meslekAdi,
                    ucretTipi = ucretTipiSayisi is null ? "Aylık" : ucretTipiSayisi == 0 ? "Aylık" : "Günlük",
                    ucret = Sayi(Al(p, "per_ucret")) ?? Sayi(Bul(p, "ucret", "tut|net|brut")),
                    doviz = Metin(Al(p, "per_ucr_doviz_cinsi")),
                    alanlar,
                    /* Ham satır: eşleme ekranında sütun adları ve değerleri */
                    ham = personelKodu is null ? null : tahakkuk.ToDictionary(k => k.Key, k => k.Value is DBNull ? null : k.Value),
                });
            }

            return Ok(new
            {
                donem = new { yil, ay },
                isyeri,
                sube = new { sskNo, ad = subeBirimi, sicilNo = subeAyari?.SicilNo },
                eslesme,
                alanTanimlari = AlanTanimlari(),
                kisiler = sonuc,
            });
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Pusula verisi alınamadı");
            return StatusCode(503, new { hata = "Pusula verisi alınamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Eşleme ekranı için: tahakkuk tablosunun sütunları ve örnek değerler.</summary>
    [HttpGet("Sutunlar")]
    public IActionResult Sutunlar([FromQuery] int yil, [FromQuery] int ay, [FromQuery] string personelKodu = null)
    {
        try
        {
            using var db = _vt.TahakkukBaglantisi();

            var satir = Satirlar(db.Query(@"
SELECT TOP 1 * FROM PERSONEL_TAHAKKUKLARI WITH (NOLOCK)
WHERE pt_maliyil = @yil AND pt_tah_ay = @ay AND (@kod IS NULL OR pt_pkod = @kod)
ORDER BY pt_pkod, pt_tahno", new { yil, ay, kod = personelKodu })).FirstOrDefault();

            if (satir is null)
                return NotFound(new { hata = "Bu dönemde tahakkuk kaydı bulunamadı." });

            var eslesme = Eslesme(satir.Keys);

            return Ok(new
            {
                personelKodu = Metin(Al(satir, "pt_pkod")),
                sutunlar = satir.Select(k => new
                {
                    ad = k.Key,
                    deger = k.Value is DBNull ? null : k.Value,
                    tip = k.Value?.GetType().Name,
                }),
                eslesme,
                kayitli = _ayar.FormOku().TahakkukEslesme ?? new Dictionary<string, string>(),
                alanTanimlari = AlanTanimlari(),
            });
        }
        catch (Exception hata)
        {
            return StatusCode(503, new { hata = "Sütunlar alınamadı.", ayrinti = hata.Message });
        }
    }

    /// <summary>Pusula üst bilgileri: işyeri ve SGK şubeleri.</summary>
    [HttpGet("Ayar")]
    public IActionResult Ayar()
    {
        var a = _ayar.FormOku();

        /* Mikro'daki işyeri bilgileri panelde önizleme olarak gösteriliyor:
           kullanıcı hangi şubede ne yazdığını elle girmeden görsün. */
        var mikroIsyerleri = new List<object>();

        try
        {
            using var db = _vt.TahakkukBaglantisi();

            var adlar = IsyeriAdlari(db);

            mikroIsyerleri = IsyerleriOku(db)
                .OrderBy(x => x.Key)
                .Select(x => (object)new
                {
                    sskNo = x.Key,
                    ad = adlar.GetValueOrDefault(x.Key),
                    x.Value.Unvan,
                    x.Value.Adres1,
                    x.Value.Adres2,
                    x.Value.Adres3,
                    x.Value.TicSicilNo
                })
                .ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "İşyeri önizlemesi alınamadı");
        }

        return Ok(new
        {
            isyeri = a.TahakkukIsyeriBilgisi ?? new TahakkukIsyeri(),
            mikroIsyerleri,
            subeler = a.TahakkukSubeler ?? new Dictionary<string, TahakkukSube>(),
            etiketler = a.TahakkukEtiketler ?? new Dictionary<string, string>(),
            /* Yuva listesi: etiketi düzenlenebilen alanlar */
            yuvalar = Alanlar
                .Select(x => new
                {
                    temel = x.Kod.EndsWith("Gun") ? x.Kod[..^3]
                          : x.Kod.EndsWith("Saat") ? x.Kod[..^4]
                          : x.Kod.EndsWith("Tutar") ? x.Kod[..^5] : x.Kod,
                    x.Grup,
                    varsayilan = x.Etiket,
                })
                .GroupBy(x => x.temel)
                .Select(g => new { temel = g.Key, grup = g.First().Grup, varsayilan = g.First().varsayilan }),
        });
    }

    public class TahakkukAyarGirdi
    {
        public TahakkukIsyeri Isyeri { get; set; }
        public Dictionary<string, TahakkukSube> Subeler { get; set; }
        public Dictionary<string, string> Etiketler { get; set; }
    }

    [HttpPost("Ayar")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult AyarKaydet([FromBody] TahakkukAyarGirdi girdi)
    {
        var a = _ayar.FormOku();

        if (girdi?.Isyeri is not null) a.TahakkukIsyeriBilgisi = girdi.Isyeri;
        if (girdi?.Subeler is not null) a.TahakkukSubeler = girdi.Subeler;
        if (girdi?.Etiketler is not null) a.TahakkukEtiketler = girdi.Etiketler;

        _ayar.Yaz("FORM", a);

        return Ok(new { basarili = true });
    }

    /// <summary>Sütun eşlemesini kaydeder (alan kodu → Mikro sütunu).</summary>
    [HttpPost("Eslesme")]
    [Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi)]
    public IActionResult EslesmeKaydet([FromBody] Dictionary<string, string> eslesme)
    {
        var ayar = _ayar.FormOku();

        var gecerli = AlanAnahtarlari().ToHashSet(StringComparer.Ordinal);

        ayar.TahakkukEslesme = (eslesme ?? new Dictionary<string, string>())
            .Where(x => gecerli.Contains(x.Key))
            .ToDictionary(x => x.Key, x => (x.Value ?? "").Trim());

        _ayar.Yaz("FORM", ayar);

        return Ok(new { basarili = true, adet = ayar.TahakkukEslesme.Count });
    }
}

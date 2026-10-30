using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Yönetim → Genel bakış (03.10.2026).
///
/// <para>
/// Ayar merkezinin açılış ekranı için tek uç: bölüm başına son değişiklik,
/// son değişiklikler listesi, kategori kartlarındaki sayılar ve dikkat
/// isteyen durumlar (mail gönderilemiyor, kod havuzu azalıyor, bölgeye
/// bağlı olmayan şube…). Her parça ayrı korunuyor; biri okunamazsa
/// ekranın geri kalanı gelir.
/// </para>
///
/// <para>
/// Yönetim sayfasını görebilen herkese açık (Admin, GMY, İK yöneticisi,
/// İK). İçerikte ayarın kendisi yok, yalnızca sayı ve başlık var; panel
/// her kullanıcıya yalnızca göremediği bölümleri gizleyerek gösteriyor.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.GenelMudurYardimcisi + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class AyarOzetController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly IseGirisEvrakServisi _evrak;

    public AyarOzetController(VeritabaniServisi vt, AyarServisi ayar, IseGirisEvrakServisi evrak)
    {
        _vt = vt;
        _ayar = ayar;
        _evrak = evrak;
    }

    private sealed class DegisiklikSatiri
    {
        public string Bolum { get; set; }
        public string Islem { get; set; }
        public string Kullanici { get; set; }
        public bool Basarili { get; set; }
        public DateTime Tarih { get; set; }
    }

    private sealed record DikkatSatiri(string Seviye, string Baslik, string Aciklama, string Bolum);

    [HttpGet]
    public IActionResult Ozet()
    {
        using var db = _vt.Baglanti();

        var sayilar = new Dictionary<string, object>();
        var dikkat = new List<DikkatSatiri>();

        void Dikkat(string seviye, string baslik, string aciklama, string bolum) =>
            dikkat.Add(new DikkatSatiri(seviye, baslik, aciklama, bolum));

        /* ---------------------------------------------------- değişiklikler */
        var sonDegisiklikler = new List<DegisiklikSatiri>();
        var bolumSon = new Dictionary<string, DegisiklikSatiri>();

        try
        {
            sonDegisiklikler = db.Query<DegisiklikSatiri>(@"
SELECT TOP 15 bolum AS Bolum, islem AS Islem, kullanici AS Kullanici,
       basarili AS Basarili, tarih AS Tarih
FROM KRY_AYAR_DEGISIKLIK
ORDER BY tarih DESC, id DESC").ToList();

            /* Bölüm başına en son başarılı değişiklik */
            foreach (var x in db.Query<DegisiklikSatiri>(@"
SELECT bolum AS Bolum, islem AS Islem, kullanici AS Kullanici,
       basarili AS Basarili, tarih AS Tarih
FROM (
    SELECT bolum, islem, kullanici, basarili, tarih,
           ROW_NUMBER() OVER (PARTITION BY bolum ORDER BY tarih DESC, id DESC) AS sira
    FROM KRY_AYAR_DEGISIKLIK
    WHERE basarili = 1
) t
WHERE sira = 1"))
                bolumSon[x.Bolum] = x;
        }
        catch
        {
            /* Tablo yoksa son değişiklik bilgisi boş kalır */
        }

        /* ---------------------------------------------------- form ayarı */
        try
        {
            var form = _ayar.FormOku();
            var subeler = form.Subeler ?? new List<Sube>();
            var bolgeler = form.Bolgeler ?? new List<BolgeTanimi>();

            sayilar["birimler"] = subeler.Count;
            sayilar["bolgeler"] = bolgeler.Count;
            sayilar["birimturleri"] = form.BirimTurleri?.Count ?? 0;
            sayilar["ozelRol"] = form.OzelRoller?.Count ?? 0;
            sayilar["basvuruKaynagi"] = form.BasvuruKaynaklari?.Count ?? 0;
            sayilar["yoneticiEslesme"] = form.UyumYoneticiEslesme?.Count ?? 0;
            sayilar["uyumOtomatik"] = form.UyumOtomatik?.Count(x => x.Value) ?? 0;

            /* Bölgeye bağlı olmayan şubeler: bölgesi seçilen kullanıcılar
               yetkili şubelerini bölgeden alıyor, bu şubeleri görmezler. */
            if (bolgeler.Count > 0)
            {
                var bagli = new HashSet<string>(
                    bolgeler.SelectMany(b => b.Subeler ?? new List<string>()),
                    StringComparer.OrdinalIgnoreCase);

                var bolgesiz = subeler
                    .Where(s => !string.IsNullOrWhiteSpace(s.Kod)
                                && string.Equals(s.Tur ?? "Şube", "Şube", StringComparison.OrdinalIgnoreCase)
                                && !bagli.Contains(s.Kod))
                    .Select(s => string.IsNullOrWhiteSpace(s.Ad) ? s.Kod : s.Ad)
                    .ToList();

                if (bolgesiz.Count > 0)
                    Dikkat("uyari",
                        $"{bolgesiz.Count} şube bir bölgeye bağlı değil",
                        string.Join(", ", bolgesiz.Take(4)) + (bolgesiz.Count > 4 ? " …" : "") +
                        " · bölgesine göre yetki alan kullanıcılar bu şubeleri görmez",
                        "bolgeler");
            }

            /* Rapor maili olmayan şubeler: günlük okutma raporu gitmez */
            var mailsiz = subeler
                .Where(s => !string.IsNullOrWhiteSpace(s.Kod)
                            && string.Equals(s.Tur ?? "Şube", "Şube", StringComparison.OrdinalIgnoreCase)
                            && !s.NormRaporundaGizle
                            && string.IsNullOrWhiteSpace(s.Eposta))
                .Select(s => string.IsNullOrWhiteSpace(s.Ad) ? s.Kod : s.Ad)
                .ToList();

            if (mailsiz.Count > 0)
                Dikkat("bilgi",
                    $"{mailsiz.Count} şubenin rapor maili yok",
                    string.Join(", ", mailsiz.Take(4)) + (mailsiz.Count > 4 ? " …" : "") +
                    " · günlük okutma raporu bu şubelere gitmez",
                    "birimler");

            if (string.IsNullOrWhiteSpace(form.GorusmeAdresi))
                Dikkat("bilgi", "Görüşme adresi boş",
                    "Davet mesajlarında adaya nereye geleceği yazmaz", "gorusme");
        }
        catch
        {
            /* Form ayarı okunamazsa sayılar boş kalır */
        }

        /* ---------------------------------------------------- mail */
        try
        {
            var mail = _ayar.MailOku();

            if (string.IsNullOrWhiteSpace(mail.Sunucu))
            {
                Dikkat("hata", "Mail sunucusu tanımlı değil",
                    "Başvuru bildirimleri ve günlük raporlar gönderilemez", "mail");
            }
            else
            {
                var hata = MailServisi.SonHataZamani;
                var basari = MailServisi.SonBasariZamani;

                if (hata.HasValue && (!basari.HasValue || hata > basari))
                {
                    var neden = MailServisi.SonHataAciklamasi ?? "";
                    if (neden.Length > 140) neden = neden[..140] + "…";

                    Dikkat("hata", "Son mail gönderilemedi",
                        $"{hata:dd.MM HH:mm} · {neden}", "mail");
                }
                else if (bolumSon.TryGetValue("mail", out _))
                {
                    /* Sunucu yeniden başladıysa bellekteki durum yok;
                       son test sonucuna bakılır. */
                    var sonTest = db.QueryFirstOrDefault<DegisiklikSatiri>(@"
SELECT TOP 1 bolum AS Bolum, islem AS Islem, kullanici AS Kullanici,
       basarili AS Basarili, tarih AS Tarih
FROM KRY_AYAR_DEGISIKLIK
WHERE bolum = 'mail'
ORDER BY tarih DESC, id DESC");

                    if (sonTest is { Basarili: false } && !basari.HasValue)
                        Dikkat("hata", "Son mail testi başarısız",
                            $"{sonTest.Tarih:dd.MM HH:mm} · {sonTest.Kullanici}", "mail");
                }

                if (mail.BasvuruMailiGonder && (mail.AliciAdresler?.Count ?? 0) == 0)
                    Dikkat("uyari", "Başvuru bildirimi için alıcı yok",
                        "Yeni başvurular kimseye mail olarak gitmiyor", "mail");
            }

            sayilar["mailSunucu"] = string.IsNullOrWhiteSpace(mail.Sunucu) ? "" : mail.Sunucu;
        }
        catch
        {
        }

        /* ---------------------------------------------------- kod havuzu */
        try
        {
            var adet = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_KOD_HAVUZU");
            sayilar["smskod"] = adet;

            /* Her başvuruda bir kod harcanıyor: son 14 günün ortalaması */
            var son14 = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_BASVURULAR WHERE olusturma >= DATEADD(DAY, -14, SYSDATETIME())");
            var gunluk = Math.Max(1.0, son14 / 14.0);
            var gun = (int)Math.Floor(adet / gunluk);
            sayilar["smskodGun"] = gun;

            if (adet == 0)
                Dikkat("hata", "SMS kod havuzu boş",
                    "Adaylar doğrulama kodu alamaz, başvuru yapılamaz", "smskod");
            else if (gun < 14)
                Dikkat("uyari", "SMS kod havuzu azalıyor",
                    $"{adet:N0} kod kaldı · yaklaşık {gun} günlük", "smskod");
        }
        catch
        {
        }

        /* ---------------------------------------------------- diğer sayılar */
        try
        {
            var k = db.QueryFirstOrDefault(@"
SELECT SUM(CASE WHEN aktif = 1 THEN 1 ELSE 0 END) AS aktif,
       SUM(CASE WHEN aktif = 1 THEN 0 ELSE 1 END) AS pasif
FROM KRY_KULLANICILAR");
            sayilar["kullanici"] = (int)(k?.aktif ?? 0);
            sayilar["kullaniciPasif"] = (int)(k?.pasif ?? 0);
        }
        catch
        {
        }

        try
        {
            sayilar["patron"] = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_PATRON WHERE aktif = 1");
        }
        catch
        {
        }

        try
        {
            sayilar["departman"] = db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_DEPARTMAN WHERE aktif = 1");
        }
        catch
        {
        }

        try
        {
            sayilar["evrak"] = _evrak.Tanimlar().Count;
        }
        catch
        {
        }

        var sira = new Dictionary<string, int> { ["hata"] = 0, ["uyari"] = 1, ["bilgi"] = 2 };

        return Ok(new
        {
            bolumSon = bolumSon.ToDictionary(
                x => x.Key,
                x => new { kullanici = x.Value.Kullanici, tarih = x.Value.Tarih, islem = x.Value.Islem }),
            sonDegisiklikler = sonDegisiklikler.Select(x => new
            {
                bolum = x.Bolum,
                islem = x.Islem,
                kullanici = x.Kullanici,
                basarili = x.Basarili,
                tarih = x.Tarih
            }),
            sayilar,
            dikkat = dikkat.OrderBy(x => sira.GetValueOrDefault(x.Seviye, 3)).ToList()
        });
    }
}

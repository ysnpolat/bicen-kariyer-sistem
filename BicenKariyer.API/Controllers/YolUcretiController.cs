using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Personel yol ücretleri (Yönetim → Yol Ücretleri).
///
/// <para>
/// Yol ücretleri Mikro'da tutulmuyor; İK elindeki Excel listesini panelden
/// toplu olarak aktarıyor ve kayıt <c>KRY_PERSONEL_YOL</c> tablosunda
/// personel koduna bağlı duruyor. Excel dosyası panelde (tarayıcıda)
/// çözümleniyor, buraya yalnızca satırlar geliyor.
/// </para>
///
/// <para>
/// Akış iki adımlı: önce <c>Onizleme</c> her satırı personelle eşleştirip
/// sonucu gösterir (eşleşti / bulunamadı / tutar hatalı / tekrar), kullanıcı
/// onaylayınca <c>Aktar</c> aynı eşleştirmeyi sunucuda yeniden yapıp
/// eşleşen satırları yazar. Önizlemenin sonucu panelden geri alınmıyor;
/// tarayıcıdan gelen eşleşmeye güvenmek yerine iş baştan yapılıyor.
/// </para>
///
/// <para>
/// Eşleştirme önce sicille (baştaki sıfırlar ve boşluklar yok sayılır),
/// sicil yoksa ya da bulunamazsa TC kimlik numarasıyla yapılır. Ada
/// bakılmaz: aynı adda iki çalışan olabilir.
/// </para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = Roller.Admin + "," + Roller.IKYoneticisi + "," + Roller.IK)]
public class YolUcretiController : ControllerBase
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelKaynagiServisi _personelKaynak;
    private readonly YetkiServisi _yetki;
    private readonly ILogger<YolUcretiController> _kayit;
    private readonly MikroPersonelYazmaServisi _degisiklik;

    /// <summary>Tek satırda kabul edilen en yüksek tutar; yanlış sütun okunmasına karşı.</summary>
    private const decimal UST_SINIR = 1_000_000m;

    public YolUcretiController(VeritabaniServisi vt, PersonelKaynagiServisi personelKaynak,
        YetkiServisi yetki, ILogger<YolUcretiController> kayit,
        MikroPersonelYazmaServisi degisiklik)
    {
        _vt = vt;
        _personelKaynak = personelKaynak;
        _yetki = yetki;
        _kayit = kayit;
        _degisiklik = degisiklik;
    }

    private string Rol => User?.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? "";

    private string Kullanici => User?.Identity?.Name ?? "sistem";

    /// <summary>Sicil karşılaştırma anahtarı: boşluk ve baştaki sıfırlar yok sayılır.</summary>
    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>TC kimlik numarasının yalnızca rakamları.</summary>
    private static string Tc(string s) => new string((s ?? "").Where(char.IsDigit).ToArray());

    /// <summary>
    /// Ücret bu rolden gizli mi. Yol ücreti de ücret sayılır: maaşı
    /// göremeyen rol yol ücretini de görmez (rol yetkileri ayarı).
    /// </summary>
    private bool UcretGizli => _yetki.Gizli(Rol, YetkiServisi.Ucret);

    /* ==================================================================== */
    /* Personel dizinleri                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Sicil ve TC'ye göre personel dizinleri.
    ///
    /// <para>
    /// Aynı TC birden çok sicilde olabilir (yeniden işe alınanlar). O
    /// durumda çalışan kayıt, o da yoksa en son işe girilen kayıt alınır.
    /// </para>
    /// </summary>
    private sealed class Dizin
    {
        public Dictionary<string, PersonelKaydi> Sicil { get; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, PersonelKaydi> Tc { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private Dizin DizinKur()
    {
        var d = new Dizin();

        var sirali = _personelKaynak.TumPersonelleriGetir()
            .Where(x => !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .OrderByDescending(x => x.Durum == 1)
            .ThenByDescending(x => x.GirisTarihi ?? DateTime.MinValue);

        foreach (var p in sirali)
        {
            /* Sıralama öncelikli kaydı başa aldı; ilk yazılan kalır */
            d.Sicil.TryAdd(K(p.PersonelKodu), p);

            var tc = Tc(p.KimlikNo);
            if (tc.Length >= 10) d.Tc.TryAdd(tc, p);
        }

        return d;
    }

    /// <summary>Kayıtlı yol ücretleri: personel kodu → (tutar, açıklama, güncelleyen, zaman).</summary>
    private Dictionary<string, YolKaydi> Kayitlar()
    {
        using var db = _vt.Baglanti();

        return db.Query<YolKaydi>(@"
SELECT personel_kodu AS PersonelKodu, tutar AS Tutar, aciklama AS Aciklama,
       guncelleyen AS Guncelleyen, guncelleme AS Guncelleme
FROM KRY_PERSONEL_YOL")
            .GroupBy(x => K(x.PersonelKodu))
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
    }

    private sealed class YolKaydi
    {
        public string PersonelKodu { get; set; }
        public decimal Tutar { get; set; }
        public string Aciklama { get; set; }
        public string Guncelleyen { get; set; }
        public DateTime Guncelleme { get; set; }
    }

    /* ==================================================================== */
    /* Liste                                                                */
    /* ==================================================================== */

    /// <summary>Kayıtlı yol ücretleri, personel bilgileriyle.</summary>
    [HttpGet]
    public IActionResult Liste()
    {
        Dizin dizin;

        try
        {
            dizin = DizinKur();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Yol ücretleri: personel listesi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı." });
        }

        var gizli = UcretGizli;

        var kayitlar = Kayitlar().Values
            .Select(k =>
            {
                dizin.Sicil.TryGetValue(K(k.PersonelKodu), out var p);

                return new
                {
                    sicil = (k.PersonelKodu ?? "").Trim(),
                    adSoyad = p is null ? null : $"{p.Ad} {p.Soyad}".Trim(),
                    tc = p is null ? null : _yetki.KimlikMaskele(Rol, p.KimlikNo?.Trim()),
                    sube = p?.Sube,
                    pozisyon = p?.Pozisyon,
                    /* Personel listesinde yoksa (silinmiş sicil) panelde ayrıca işaretlenir */
                    bulundu = p is not null,
                    calisiyor = p?.Durum == 1,
                    tutar = gizli ? (decimal?)null : k.Tutar,
                    aciklama = k.Aciklama,
                    guncelleyen = k.Guncelleyen,
                    guncelleme = k.Guncelleme
                };
            })
            .OrderBy(x => x.sube ?? "￿")
            .ThenBy(x => x.adSoyad ?? x.sicil)
            .ToList();

        return Ok(new
        {
            ucretGizli = gizli,
            toplam = kayitlar.Count,
            toplamTutar = gizli ? (decimal?)null : kayitlar.Sum(x => x.tutar ?? 0),
            kayitlar
        });
    }

    /* ==================================================================== */
    /* Önizleme ve aktarım                                                  */
    /* ==================================================================== */

    /// <summary>Bir satırın eşleştirme sonucu.</summary>
    private sealed class Sonuc
    {
        public int Sira { get; set; }
        public YolUcretiSatiri Girdi { get; set; }
        public PersonelKaydi Kisi { get; set; }
        /// <summary>eslesti · bulunamadi · tutarHatali · tekrar</summary>
        public string Durum { get; set; }
        public string Mesaj { get; set; }
        public bool Gecerli => Durum == "eslesti";
    }

    /// <summary>
    /// Satırları personelle eşleştirir. Önizleme ve aktarım aynı kuralı
    /// kullansın diye tek yerde.
    /// </summary>
    private List<Sonuc> Eslestir(List<YolUcretiSatiri> satirlar, Dizin dizin)
    {
        var sonuclar = new List<Sonuc>();
        var gorulen = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < satirlar.Count; i++)
        {
            var s = satirlar[i] ?? new YolUcretiSatiri();
            var sonuc = new Sonuc { Sira = s.Sira > 0 ? s.Sira : i + 1, Girdi = s };

            var sicil = K(s.Sicil);
            var tc = Tc(s.Tc);

            PersonelKaydi kisi = null;

            if (sicil.Length > 0) dizin.Sicil.TryGetValue(sicil, out kisi);

            /* Sicil yoksa ya da bulunamadıysa TC ile */
            if (kisi is null && tc.Length > 0) dizin.Tc.TryGetValue(tc, out kisi);

            sonuc.Kisi = kisi;

            if (kisi is null)
            {
                sonuc.Durum = "bulunamadi";
                sonuc.Mesaj = sicil.Length == 0 && tc.Length == 0
                    ? "Sicil ya da TC kimlik no yok."
                    : "Personel bulunamadı.";
            }
            else if (s.Tutar is null || s.Tutar < 0 || s.Tutar > UST_SINIR)
            {
                sonuc.Durum = "tutarHatali";
                sonuc.Mesaj = s.Tutar is null
                    ? "Tutar okunamadı."
                    : s.Tutar < 0 ? "Tutar eksi olamaz." : "Tutar çok yüksek.";
            }
            else if (gorulen.TryGetValue(K(kisi.PersonelKodu), out var ilk))
            {
                /* Aynı kişi dosyada iki kez: ilk satır geçerli, sonrakiler atlanır */
                sonuc.Durum = "tekrar";
                sonuc.Mesaj = $"Bu personel {ilk}. satırda da var; bu satır atlanır.";
            }
            else
            {
                sonuc.Durum = "eslesti";
                gorulen[K(kisi.PersonelKodu)] = sonuc.Sira;

                /* Sicil ile TC farklı kişileri gösteriyorsa uyarı: sicil esas alındı */
                if (sicil.Length > 0 && tc.Length > 0 &&
                    dizin.Tc.TryGetValue(tc, out var tcKisi) &&
                    !string.Equals(K(tcKisi.PersonelKodu), K(kisi.PersonelKodu), StringComparison.OrdinalIgnoreCase))
                {
                    sonuc.Mesaj = "TC başka bir sicile ait; sicil esas alındı.";
                }
                else if (kisi.Durum != 1)
                {
                    sonuc.Mesaj = "Personel işten ayrılmış.";
                }
            }

            sonuclar.Add(sonuc);
        }

        return sonuclar;
    }

    /// <summary>
    /// Excel'den okunan satırları eşleştirir; hiçbir şey yazmaz. Her satır
    /// için durum ve mevcut tutar (fark görünsün diye) döner.
    /// </summary>
    [HttpPost("Onizleme")]
    public IActionResult Onizleme([FromBody] List<YolUcretiSatiri> satirlar)
    {
        if (satirlar is null || satirlar.Count == 0)
            return BadRequest(new { hata = "Satır yok." });

        if (satirlar.Count > 20000)
            return BadRequest(new { hata = "Bir seferde en fazla 20.000 satır aktarılabilir." });

        Dizin dizin;

        try
        {
            dizin = DizinKur();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Yol ücreti önizleme: personel listesi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı." });
        }

        var mevcut = Kayitlar();
        var gizli = UcretGizli;

        var sonuc = Eslestir(satirlar, dizin)
            .Select(x =>
            {
                var p = x.Kisi;
                decimal? eski = p is not null && mevcut.TryGetValue(K(p.PersonelKodu), out var m)
                    ? m.Tutar : null;

                /* Değişim: yeni kayıt, tutar değişti ya da aynı */
                var degisim = !x.Gecerli ? null
                    : eski is null ? "yeni"
                    : eski == x.Girdi.Tutar ? "ayni"
                    : "degisti";

                return new
                {
                    sira = x.Sira,
                    durum = x.Durum,
                    mesaj = x.Mesaj,

                    /* Dosyada yazan */
                    dosyaSicil = x.Girdi.Sicil,
                    dosyaTc = _yetki.KimlikMaskele(Rol, x.Girdi.Tc),
                    dosyaAdSoyad = x.Girdi.AdSoyad,

                    /* Eşleşen personel */
                    sicil = p?.PersonelKodu?.Trim(),
                    adSoyad = p is null ? null : $"{p.Ad} {p.Soyad}".Trim(),
                    tc = p is null ? null : _yetki.KimlikMaskele(Rol, p.KimlikNo?.Trim()),
                    sube = p?.Sube,
                    pozisyon = p?.Pozisyon,
                    calisiyor = p?.Durum == 1,

                    tutar = x.Girdi.Tutar,
                    mevcut = gizli ? null : eski,
                    degisim
                };
            })
            .ToList();

        return Ok(new
        {
            toplam = sonuc.Count,
            eslesen = sonuc.Count(x => x.durum == "eslesti"),
            bulunamayan = sonuc.Count(x => x.durum == "bulunamadi"),
            tutarHatali = sonuc.Count(x => x.durum == "tutarHatali"),
            tekrar = sonuc.Count(x => x.durum == "tekrar"),
            yeni = sonuc.Count(x => x.degisim == "yeni"),
            degisen = sonuc.Count(x => x.degisim == "degisti"),
            ayni = sonuc.Count(x => x.degisim == "ayni"),
            satirlar = sonuc
        });
    }

    /// <summary>
    /// Eşleşen satırları yazar (varsa günceller, yoksa ekler). Eşleşmeyen,
    /// tutarı hatalı ve tekrarlanan satırlar atlanır. Dosyada olmayan
    /// personelin kaydına dokunulmaz.
    /// </summary>
    [HttpPost("Aktar")]
    public IActionResult Aktar([FromBody] List<YolUcretiSatiri> satirlar)
    {
        if (satirlar is null || satirlar.Count == 0)
            return BadRequest(new { hata = "Satır yok." });

        if (satirlar.Count > 20000)
            return BadRequest(new { hata = "Bir seferde en fazla 20.000 satır aktarılabilir." });

        Dizin dizin;

        try
        {
            dizin = DizinKur();
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Yol ücreti aktarımı: personel listesi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı." });
        }

        var sonuclar = Eslestir(satirlar, dizin);
        var gecerli = sonuclar.Where(x => x.Gecerli).ToList();

        if (gecerli.Count == 0)
            return BadRequest(new { hata = "Aktarılabilecek satır yok." });

        var mevcut = Kayitlar();

        var yeni = 0;
        var guncellenen = 0;
        var ayni = 0;

        var parametreler = gecerli.Select(x =>
        {
            var kod = x.Kisi.PersonelKodu.Trim();

            if (!mevcut.TryGetValue(K(kod), out var m)) yeni++;
            else if (m.Tutar == x.Girdi.Tutar) ayni++;
            else guncellenen++;

            var aciklama = string.IsNullOrWhiteSpace(x.Girdi.Aciklama) ? null : x.Girdi.Aciklama.Trim();
            if (aciklama is { Length: > 200 }) aciklama = aciklama[..200];

            return new
            {
                /* Eski kayıt sıfırları farklı yazılmış bir sicille duruyorsa
                   o satır güncellensin; yeni satır ikinci kez eklenmesin */
                kod = m?.PersonelKodu?.Trim() ?? kod,
                tutar = Math.Round(x.Girdi.Tutar!.Value, 2),
                aciklama,
                kullanici = Kullanici
            };
        }).ToList();

        using (var db = _vt.Baglanti())
        {
            db.Open();
            using var islem = db.BeginTransaction();

            /* Açıklama sütunu boşsa eski açıklama korunur */
            db.Execute(@"
MERGE KRY_PERSONEL_YOL AS h
USING (SELECT @kod AS personel_kodu) AS k
    ON h.personel_kodu = k.personel_kodu
WHEN MATCHED THEN
    UPDATE SET tutar = @tutar,
               aciklama = COALESCE(@aciklama, h.aciklama),
               guncelleyen = @kullanici,
               guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, tutar, aciklama, guncelleyen, guncelleme)
    VALUES (@kod, @tutar, @aciklama, @kullanici, SYSDATETIME());", parametreler, islem, commandTimeout: 120);

            islem.Commit();
        }

        _kayit.LogInformation("Yol ücreti aktarıldı: {Adet} satır ({Yeni} yeni, {Guncel} güncellendi) — {Kullanici}",
            gecerli.Count, yeni, guncellenen, Kullanici);

        return Ok(new
        {
            yazilan = gecerli.Count,
            yeni,
            guncellenen,
            ayni,
            atlanan = sonuclar.Count - gecerli.Count
        });
    }

    /* ==================================================================== */
    /* Personel kartından tek kayıt (02.10.2026)                            */
    /* ==================================================================== */

    /// <summary>Personel kartındaki düzenleme formundan gelen yol ücreti.</summary>
    public sealed class TekKayitIstegi
    {
        /// <summary>Boş gönderilirse personelin yol ücreti kaydı silinir.</summary>
        public decimal? Tutar { get; set; }

        public string Aciklama { get; set; }
    }

    /// <summary>
    /// Bir personelin yol ücretini yazar (varsa günceller, yoksa ekler; tutar
    /// boşsa siler). Yol ücreti Mikro'da tutulmuyor: yalnızca
    /// KRY_PERSONEL_YOL'a yazılır. Değişiklik, personel kartındaki Mikro
    /// değişiklikleriyle aynı geçmiş tablosuna da işlenir.
    /// </summary>
    [HttpPost("Personel/{sicil}")]
    public IActionResult TekKaydet(string sicil, [FromBody] TekKayitIstegi istek)
    {
        if (_yetki.SaltOkunur(Rol))
            return StatusCode(403, new { hata = "Rolünüz yalnızca görüntüleyebilir." });

        if (UcretGizli)
            return StatusCode(403, new { hata = "Ücret bilgisi rolünüzden gizli; yol ücretini değiştiremezsiniz." });

        if (string.IsNullOrWhiteSpace(sicil))
            return BadRequest(new { hata = "Sicil yok." });

        istek ??= new TekKayitIstegi();

        if (istek.Tutar is < 0)
            return BadRequest(new { hata = "Yol ücreti eksi olamaz." });

        if (istek.Tutar > UST_SINIR)
            return BadRequest(new { hata = "Yol ücreti çok yüksek." });

        var aciklama = string.IsNullOrWhiteSpace(istek.Aciklama) ? null : istek.Aciklama.Trim();

        if (aciklama is { Length: > 200 })
            return BadRequest(new { hata = "Açıklama en fazla 200 karakter olabilir." });

        PersonelKaydi kisi;

        try
        {
            DizinKur().Sicil.TryGetValue(K(sicil), out kisi);
        }
        catch (Exception hata)
        {
            _kayit.LogError(hata, "Yol ücreti: personel listesi alınamadı");
            return StatusCode(502, new { hata = "Personel veritabanına ulaşılamadı; yol ücreti kaydedilmedi." });
        }

        if (kisi is null)
            return NotFound(new { hata = "Personel bulunamadı." });

        var mevcut = Kayitlar().GetValueOrDefault(K(kisi.PersonelKodu));

        /* Eski kayıt sıfırları farklı yazılmış bir sicille duruyorsa o satır
           güncellenir; ikinci satır eklenmez (Aktar ile aynı kural). */
        var kod = mevcut?.PersonelKodu?.Trim() ?? kisi.PersonelKodu.Trim();
        var tutar = istek.Tutar is null ? (decimal?)null : Math.Round(istek.Tutar.Value, 2);

        static string Para(decimal? t) =>
            t is null ? null : t.Value.ToString("N2", new System.Globalization.CultureInfo("tr-TR")) + " TL";

        var tutarDegisti = mevcut?.Tutar != tutar;
        var aciklamaDegisti = tutar is not null &&
                              !string.Equals(mevcut?.Aciklama ?? "", aciklama ?? "", StringComparison.Ordinal);

        if (!tutarDegisti && !aciklamaDegisti)
            return Ok(new { mesaj = "Değişiklik yok.", tutar, aciklama });

        var yapan = User?.FindFirst("adSoyad")?.Value is { Length: > 0 } ad
            ? $"{ad} ({Kullanici})"
            : Kullanici;

        using (var db = _vt.Baglanti())
        {
            db.Open();
            using var islem = db.BeginTransaction();

            if (tutar is null)
            {
                db.Execute("DELETE FROM KRY_PERSONEL_YOL WHERE personel_kodu = @kod", new { kod }, islem);
            }
            else
            {
                db.Execute(@"
MERGE KRY_PERSONEL_YOL AS h
USING (SELECT @kod AS personel_kodu) AS k
    ON h.personel_kodu = k.personel_kodu
WHEN MATCHED THEN
    UPDATE SET tutar = @tutar, aciklama = @aciklama,
               guncelleyen = @kullanici, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN
    INSERT (personel_kodu, tutar, aciklama, guncelleyen, guncelleme)
    VALUES (@kod, @tutar, @aciklama, @kullanici, SYSDATETIME());",
                    new { kod, tutar, aciklama, kullanici = Kullanici }, islem);
            }

            /* Geçmiş kaydı aynı işlemde: yazılamazsa yol ücreti de yazılmaz */
            if (tutarDegisti)
                _degisiklik.KariyerDegisikligiYaz(db, islem, kisi.PersonelKodu.Trim(),
                    "Yol ücreti", Para(mevcut?.Tutar), Para(tutar), yapan);

            if (aciklamaDegisti)
                _degisiklik.KariyerDegisikligiYaz(db, islem, kisi.PersonelKodu.Trim(),
                    "Yol ücreti açıklaması", mevcut?.Aciklama, aciklama, yapan);

            islem.Commit();
        }

        _kayit.LogInformation("Yol ücreti personel kartından kaydedildi: {Sicil} {Eski} → {Yeni} — {Kullanici}",
            kod, mevcut?.Tutar, tutar, Kullanici);

        return Ok(new
        {
            mesaj = tutar is null ? "Yol ücreti kaydı silindi" : "Yol ücreti kaydedildi",
            tutar,
            aciklama
        });
    }

    /* ==================================================================== */
    /* Silme                                                                */
    /* ==================================================================== */

    /// <summary>Bir personelin yol ücreti kaydını siler.</summary>
    [HttpDelete("{sicil}")]
    public IActionResult Sil(string sicil)
    {
        if (string.IsNullOrWhiteSpace(sicil))
            return BadRequest(new { hata = "Sicil yok." });

        using var db = _vt.Baglanti();

        var silinen = db.Execute(
            "DELETE FROM KRY_PERSONEL_YOL WHERE personel_kodu = @sicil",
            new { sicil = sicil.Trim() });

        if (silinen == 0) return NotFound(new { hata = "Kayıt bulunamadı." });

        _kayit.LogInformation("Yol ücreti silindi: {Sicil} — {Kullanici}", sicil.Trim(), Kullanici);

        return Ok(new { basarili = true });
    }
}

/// <summary>Excel'den okunan bir yol ücreti satırı (panel çözümler).</summary>
public class YolUcretiSatiri
{
    /// <summary>Dosyadaki satır numarası; önizlemede kullanıcıya gösterilir.</summary>
    public int Sira { get; set; }

    /// <summary>Sicil / personel kodu</summary>
    public string Sicil { get; set; }

    /// <summary>TC kimlik numarası</summary>
    public string Tc { get; set; }

    /// <summary>Dosyadaki ad soyad; yalnızca gösterim, eşleştirmede kullanılmaz.</summary>
    public string AdSoyad { get; set; }

    /// <summary>Panelde Türkçe biçimden ("1.250,50") sayıya çevrilmiş tutar; okunamadıysa boş.</summary>
    public decimal? Tutar { get; set; }

    /// <summary>İsteğe bağlı açıklama</summary>
    public string Aciklama { get; set; }
}

using System.Globalization;
using System.Text.Json;
using BicenKariyer.API.Servisler;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Biçen360 patron görünümü · ek sözleşme (1.5 son derleme, 03.10.2026).
///
/// <para>
/// Amaç: bundan sonra patron tarafında yeni sayfa ya da değişiklik için
/// mobil güncelleme gerekmesin. İki parça:
/// <list type="number">
/// <item>Fotoğraflar sunucudan adresle (<c>fotoUrl</c>); uçlar burada.</item>
/// <item>Sunucu tanımlı sayfalar: <c>Ozet.sayfalar</c> listesi
/// (<see cref="SayfaTanimlari"/>), sayfanın kendisi
/// <c>wwwroot/patron-sayfa/{kod}.html</c> (Program.cs <c>/patron-sayfa/{kod}</c>
/// adresinden önbelleksiz sunuyor), verisi buradaki uçlardan.</item>
/// </list>
/// </para>
///
/// <para>
/// İlk üç sayfa: çıkış mülakatları, duyuru gönder, bildirim ayarları.
/// Kimlik doğrulama ve patron denetimi asıl dosyadakiyle aynı
/// (<see cref="Yetki"/>); sayfalar uçları uygulamanın verdiği jetonla
/// çağırıyor.
/// </para>
/// </summary>
public partial class PatronMobilController
{
    /* ==================================================================== */
    /* Fotoğraflar                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Mikro personel fotoğrafı (panelin api/Personel/Resim kaynağı).
    ///
    /// <para>
    /// İki yoldan açılır: adresteki imza (<c>g</c>, <c>s</c>; yalnızca
    /// yetkili patrona verilen yanıtta üretiliyor, bkz. <see cref="FotoImzasi"/>)
    /// ya da oturum jetonu (başlıkta veya <c>?t=</c>). İmza yolu, uygulamanın
    /// görüntüleyicisi jetonu iletmediğinde de fotoğrafın gelmesi için.
    /// </para>
    /// </summary>
    [HttpGet("Foto/Personel/{kod}")]
    [AllowAnonymous]
    public IActionResult FotoPersonel(string kod, [FromQuery] string g, [FromQuery] string s)
    {
        var red = FotoYetkisi("P", K(kod), g, s);
        if (red is not null) return red;

        return Gorsel(PersonelController.ResimBaytlari(_vt, kod, _kayit), "personel", kod);
    }

    /// <summary>Başvuru formundaki aday fotoğrafı (panelin api/Basvuru/{id}/Fotograf kaynağı).</summary>
    [HttpGet("Foto/Basvuru/{id:int}")]
    [AllowAnonymous]
    public IActionResult FotoBasvuru(int id, [FromQuery] string g, [FromQuery] string s)
    {
        var red = FotoYetkisi("B", id.ToString(CultureInfo.InvariantCulture), g, s);
        if (red is not null) return red;

        using var db = _vt.Baglanti();

        return Gorsel(BasvuruController.FotografBaytlari(db, id), "basvuru", id.ToString(CultureInfo.InvariantCulture));
    }

    /* Reddedilen fotoğraf isteği güvenlik günlüğüne en çok beş dakikada bir
       yazılıyor: liste ekranı aynı anda onlarca fotoğraf istiyor. */
    private static DateTime _sonFotoRedKaydi = DateTime.MinValue;
    private static DateTime _sonFotoYokKaydi = DateTime.MinValue;

    /// <summary>İmza geçerliyse null; değilse oturum ve patron denetimi.</summary>
    private IActionResult FotoYetkisi(string tur, string kimlik, string g, string s)
    {
        if (FotoImzasi.Gecerli(tur, kimlik, g, s)) return null;

        if (User?.Identity?.IsAuthenticated == true && User.IsInRole("Personel"))
        {
            var (_, red) = Yetki();
            if (red is null) return null;

            FotoRedYaz(tur, g, s, "oturum/patron denetimi");
            return red;
        }

        FotoRedYaz(tur, g, s, "jeton yok");
        return Unauthorized(new { hata = "Oturumunuz sona erdi." });
    }

    private void FotoRedYaz(string tur, string g, string s, string neden)
    {
        if ((DateTime.Now - _sonFotoRedKaydi).TotalMinutes < 5) return;
        _sonFotoRedKaydi = DateTime.Now;

        try
        {
            _gunluk.Yaz("PATRON FOTO RED", IstemciAdresi.Bul(HttpContext),
                $"{(tur == "P" ? "Personel" : "Başvuru")} · {neden} · imza " +
                (string.IsNullOrWhiteSpace(s) ? "yok" : $"geçersiz ({g})") +
                $" · jeton {(string.IsNullOrWhiteSpace(Request.Query["t"]) && string.IsNullOrWhiteSpace(Request.Headers.Authorization) ? "yok" : "var")}");
        }
        catch
        {
        }
    }

    /// <summary>
    /// Görsel yanıtı. Panel uçları her şeyi image/jpeg diye veriyor; adaylar
    /// PNG de yükleyebiliyor. Uygulamanın görüntüleyicisi türe daha
    /// titiz, tür ilk baytlardan bulunuyor.
    /// </summary>
    private IActionResult Gorsel(byte[] bayt, string tur = null, string kimlik = null)
    {
        if (bayt is not { Length: > 0 })
        {
            /* Listede fotoğrafı var görünüp kaynağı boş dönen: tanı için */
            if ((DateTime.Now - _sonFotoYokKaydi).TotalMinutes >= 5)
            {
                _sonFotoYokKaydi = DateTime.Now;
                _kayit.LogWarning("Patron fotoğrafı bulunamadı: {Tur} {Kimlik}", tur, kimlik);
            }

            return NotFound();
        }

        Response.Headers.CacheControl = "private, max-age=86400";

        return File(bayt, GorselTuru(bayt));
    }

    private static string GorselTuru(byte[] b)
    {
        if (b.Length >= 4 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length >= 3 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return "image/gif";
        if (b.Length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46
            && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return "image/webp";

        return "image/jpeg";
    }

    /* ==================================================================== */
    /* Sunucu tanımlı sayfalar (Ozet.sayfalar)                               */
    /* ==================================================================== */

    private sealed record SayfaTanimi(
        string Kod, string Baslik, string Ikon, string Ton, string[] Yer,
        Func<PatronMobilController, PersonelKaydi, (string Alt, int? Rozet)> Durum);

    /// <summary>
    /// Uygulamada WebView ile açılan sayfalar. Yeni sayfa eklemek için:
    /// <c>wwwroot/patron-sayfa/&lt;kod&gt;.html</c> + buraya bir satır (+ gerekiyorsa
    /// uçları). <c>ikon</c>: uygulamanın patron ikon setinden ad (bilinmeyen
    /// ad uygulamada "belge" olur); <c>ton</c>: yesil|turuncu|mavi|mor|erik|sari|gri;
    /// <c>yer</c>: "ozet" (Özet → hızlı erişim) ve/veya "ik" (İK sekmesi).
    /// <c>Durum</c> kartın alt satırı ve rozeti; hata verirse sayfa yine
    /// listelenir, alt satırı boş kalır.
    /// </summary>
    private static readonly SayfaTanimi[] SayfaTanimlari =
    {
        new("cikis-mulakat", "Çıkış mülakatları", "cikis", "turuncu", new[] { "ik" },
            (c, _) => c.MulakatSayfaDurumu()),

        new("duyuru", "Duyuru gönder", "megafon", "erik", new[] { "ik", "ozet" },
            (c, _) => c.DuyuruSayfaDurumu()),

        new("bildirim", "Bildirim ayarları", "zil", "mavi", new[] { "ik" },
            (c, p) => c.BildirimSayfaDurumu(p)),
    };

    /// <summary>Kişinin sayfa listesi (alt satırlar kişiye özel olabildiği için anahtar kişi başına).</summary>
    private List<object> Sayfalar(PersonelKaydi p) =>
        PatronOnbellegi.Al($"sayfalar|{K(p.PersonelKodu)}", () => SayfaTanimlari
            .Select(t =>
            {
                string alt = null;
                int? rozet = null;

                try
                {
                    (alt, rozet) = t.Durum(this, p);
                }
                catch (Exception hata)
                {
                    _kayit.LogWarning(hata, "Patron sayfası durumu hazırlanamadı: {Kod}", t.Kod);
                }

                return (object)new
                {
                    kod = t.Kod,
                    baslik = t.Baslik,
                    alt,
                    ikon = t.Ikon,
                    ton = t.Ton,
                    yer = t.Yer,
                    rozet
                };
            })
            .ToList());

    private (string, int?) MulakatSayfaDurumu()
    {
        var tum = Mulakatlar();
        var ayBas = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1);
        var buAy = tum.Count(x => x.Tarih >= ayBas);

        return (buAy > 0 ? $"Bu ay {buAy} mülakat" : $"Bu ay mülakat yok · 12 ayda {tum.Count}", null);
    }

    private (string, int?) DuyuruSayfaDurumu()
    {
        var son = PatronDuyurulari().FirstOrDefault();

        return (son is null
            ? "Tüm personele, bölgeye ya da şubeye"
            : $"Son duyuru {GunSaat(son.Tarih)} · {son.Okuyan} okudu", null);
    }

    /// <summary>Telefonda bildirim izni yoksa rozet: ayarlar işe yaramıyor demek.</summary>
    private (string, int?) BildirimSayfaDurumu(PersonelKaydi p)
    {
        if (!JetonVar(p.PersonelKodu)) return ("Telefonda bildirim izni kapalı", 1);

        var a = _patron.Bul(p.PersonelKodu, p.KimlikNo)?.Ayar ?? new PatronBildirimAyari();
        var acik = new[] { a.Sabah, a.Onay, a.Kritik, a.Etik }.Count(x => x);

        if (acik == 0) return ("Tüm bildirimler kapalı", null);

        return (a.Sabah ? $"Sabah özeti {a.SabahSaat} · {acik}/4 açık" : $"{acik}/4 bildirim açık", null);
    }

    /// <summary>Kişinin telefonu anlık bildirim için kayıtlı mı (KRY_MOBIL_JETON)</summary>
    private bool JetonVar(string kod)
    {
        using var db = _vt.Baglanti();

        return db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_JETON
WHERE personel_kodu = @kod AND jeton IS NOT NULL AND jeton <> ''", new { kod = K(kod) }) > 0;
    }

    /* ==================================================================== */
    /* Sayfa: çıkış mülakatları                                              */
    /* ==================================================================== */

    private sealed class MulakatOzu
    {
        public int Id;
        public string Kod;
        public string Ad;
        public string Sube;
        public string Gorev;
        public DateTime? Cikis;

        /// <summary>Mülakat tarihi (panel listesi ve dönem süzgeci bunu kullanıyor)</summary>
        public DateTime Tarih;
        public string Neden;
        public string Grup;
        public string Ozet;
        public bool? Tekrar;
        public int? Tavsiye;
        public string Kaynak;
    }

    /// <summary>Alanı hem camelCase hem PascalCase adıyla arar (eski kayıtlar PascalCase).</summary>
    private static bool JsonAl(JsonElement kok, string ad, out JsonElement d)
    {
        d = default;

        return kok.ValueKind == JsonValueKind.Object
               && (kok.TryGetProperty(ad, out d)
                   || kok.TryGetProperty(char.ToUpperInvariant(ad[0]) + ad[1..], out d));
    }

    /// <summary>
    /// "Tekrar çalışır mı" ve tavsiye puanı sorular_json içinde (ayrı sütun
    /// yok); panelin şube özetindeki okumayla aynı.
    /// </summary>
    private static (bool? Tekrar, int? Tavsiye) MulakatYanitlari(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return (null, null);

        try
        {
            using var belge = JsonDocument.Parse(json);

            bool? tekrar = JsonAl(belge.RootElement, "tekrarCalisir", out var t)
                           && t.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? t.GetBoolean()
                : null;

            int? tavsiye = JsonAl(belge.RootElement, "tavsiyePuani", out var tp)
                           && tp.ValueKind == JsonValueKind.Number && tp.TryGetInt32(out var n) && n > 0
                ? n
                : null;

            return (tekrar, tavsiye);
        }
        catch (JsonException)
        {
            return (null, null);
        }
    }

    /// <summary>
    /// Son 12 takvim ayının (bu ay dahil) mülakatları. Kayıtlar panelin
    /// Çıkış Mülakatları listesinin ucundan (CikisMulakatController.Liste,
    /// mülakat tarihine göre); neden grubu panel raporundaki kural: yapay
    /// zekânın yazdığı grup, yoksa anahtar kelime sınıflandırması.
    /// </summary>
    private List<MulakatOzu> Mulakatlar() => PatronOnbellegi.Al("mulakat", () =>
    {
        var bugun = DateTime.Today;
        var bas = new DateTime(bugun.Year, bugun.Month, 1).AddMonths(-11);

        return MulakatListesi(bas, bugun);
    });

    /// <summary>
    /// Panelin Çıkış Mülakatları listesi (mülakat tarihine göre), sayfanın
    /// biçiminde. <see cref="Mulakatlar"/> son 12 ayı saklıyor; daha eski bir
    /// aralık (1.6) doğrudan buradan okunuyor.
    /// </summary>
    private List<MulakatOzu> MulakatListesi(DateTime bas, DateTime bit)
    {
        var bugun = DateTime.Today;

        var liste = Cagir<CikisMulakatController>(c => c.Liste(bas, bit, null, null))
                    ?? throw new InvalidOperationException("Çıkış mülakatları alınamadı.");

        return Dizi(liste)
            .Select(x =>
            {
                var (tekrar, tavsiye) = MulakatYanitlari(Alan(x, "sorularJson") as string);
                var neden = K(Alan(x, "cikisNedeni") as string);

                return new MulakatOzu
                {
                    Id = Tam(Alan(x, "id")),
                    Kod = K(Alan(x, "personelKodu") as string),
                    Ad = K(Alan(x, "adSoyad") as string),
                    Sube = K(Alan(x, "subeAdi") as string),
                    Gorev = K(Alan(x, "gorev") as string),
                    Cikis = Alan(x, "cikisTarihi") as DateTime?,
                    Tarih = Alan(x, "olusturma") as DateTime? ?? bugun,
                    Neden = neden.Length > 0 ? neden : null,
                    Grup = (Alan(x, "nedenGrubu") as string) is { Length: > 0 } g
                        ? g
                        : CikisAnalizi.AnahtarlaSinifla(neden),
                    Ozet = K(Alan(x, "ozet") as string) is { Length: > 0 } o ? o : null,
                    Tekrar = tekrar,
                    Tavsiye = tavsiye,
                    Kaynak = Alan(x, "kaynak") as string
                };
            })
            .ToList();
    }

    /// <summary>
    /// Çıkış mülakatları sayfası. <c>ay</c>: dönem, takvim ayı olarak
    /// (1 = bu ay, 3 = bu ay ve önceki iki ay … en çok 12). Sayılar (bu ay,
    /// 12 ay, aylık seri) dönemden bağımsız; neden grupları, yeniden çalışır
    /// oranı, tavsiye ortalaması ve liste seçilen dönemden.
    /// <para>
    /// <c>bas</c>/<c>bit</c> (yyyy-MM-dd, sayfanın tarih süzgeci, 06.10.2026)
    /// verilirse dönem o aralık ve <c>ay</c> yok sayılıyor; 12 aydan eski
    /// aralık panel ucundan ayrıca okunuyor. Yanıtta <c>aralik</c>.
    /// </para>
    /// </summary>
    [HttpGet("CikisMulakatlari")]
    public IActionResult CikisMulakatlari([FromQuery] int ay = 12,
        [FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        ay = Math.Clamp(ay, 1, 12);

        var bugun = DateTime.Today;
        var ayBas = new DateTime(bugun.Year, bugun.Month, 1);
        var donemBas = aralik?.Bas ?? ayBas.AddMonths(-(ay - 1));
        var donemSonrasi = aralik?.BitSonrasi ?? DateTime.MaxValue;
        var donemAdi = aralik is not null
            ? aralik.Ad
            : ay == 1 ? $"{Tr.DateTimeFormat.GetMonthName(bugun.Month)} {bugun.Year}" : $"Son {ay} ay";

        var tum = Guvenli("çıkış mülakatları", Mulakatlar);

        if (tum is null)
            return Ok(new
            {
                ay, donem = donemAdi, buAy = (int?)null, gecenAy = (int?)null, son12 = (int?)null,
                aylik = new List<object>(), adet = (int?)null, nedenler = new List<object>(),
                tekrar = (object)null, tavsiye = (double?)null, liste = new List<object>()
            });

        /* 12 aylık kümenin dışına taşan aralık panelden ayrıca (aralık en çok bir yıl) */
        var donem = aralik is not null && aralik.Bas < ayBas.AddMonths(-11)
            ? Guvenli("çıkış mülakatları (aralık)", () => PatronOnbellegi.Al($"mulakatA|{aralik.Anahtar}", aralik.Omur,
                  () => MulakatListesi(aralik.Bas, aralik.Bit))) ?? new List<MulakatOzu>()
            : tum.Where(x => x.Tarih >= donemBas && x.Tarih < donemSonrasi).ToList();

        var personelIle = Guvenli("personel", () => _kaynak.TumPersonelleriGetir()
                              .GroupBy(x => K(x.PersonelKodu), StringComparer.OrdinalIgnoreCase)
                              .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.Durum == 1).First(),
                                  StringComparer.OrdinalIgnoreCase))
                          ?? new Dictionary<string, PersonelKaydi>();

        var evet = donem.Count(x => x.Tekrar == true);
        var hayir = donem.Count(x => x.Tekrar == false);
        var tavsiyeler = donem.Where(x => x.Tavsiye.HasValue).Select(x => x.Tavsiye.Value).ToList();

        var yanit = new
        {
            ay,
            donem = donemAdi,
            buAy = tum.Count(x => x.Tarih >= ayBas),
            gecenAy = tum.Count(x => x.Tarih >= ayBas.AddMonths(-1) && x.Tarih < ayBas),
            son12 = tum.Count,
            aylik = Enumerable.Range(0, 12)
                .Select(i => ayBas.AddMonths(-11 + i))
                .Select(a => new
                {
                    ay = AyKisa[a.Month - 1],
                    adet = tum.Count(x => x.Tarih >= a && x.Tarih < a.AddMonths(1))
                })
                .ToList(),
            adet = donem.Count,
            nedenler = donem
                .GroupBy(x => x.Grup ?? CikisAnalizi.BELIRTILMEMIS)
                .Select(g => new
                {
                    grup = g.Key,
                    adet = g.Count(),
                    oran = (int)Math.Round(g.Count() * 100.0 / donem.Count)
                })
                .OrderByDescending(x => x.adet)
                .ToList(),
            tekrar = evet + hayir > 0
                ? new { evet, hayir, oran = (int)Math.Round(evet * 100.0 / (evet + hayir)) }
                : null,
            tavsiye = tavsiyeler.Count > 0 ? Math.Round(tavsiyeler.Average(), 1) : (double?)null,
            liste = donem
                .OrderByDescending(x => x.Tarih)
                .ThenByDescending(x => x.Id)
                .Take(ListeSiniri)
                .Select(x => new
                {
                    id = x.Id,
                    ad = x.Ad,
                    sube = x.Sube,
                    poz = x.Gorev,
                    cikis = Iso(x.Cikis),
                    tarih = Iso(x.Tarih),
                    neden = x.Neden,
                    grup = x.Grup,
                    ozet = x.Ozet is { Length: > 220 } u ? u[..220].TrimEnd() + "…" : x.Ozet,
                    tekrarCalisir = x.Tekrar,
                    tavsiye = x.Tavsiye,
                    fotoUrl = x.Kod.Length > 0 && personelIle.TryGetValue(x.Kod, out var kisi) ? PersonelFoto(kisi) : null
                })
                .ToList()
        };

        if (aralik is null) return Ok(yanit);

        var ek = yanit.GetType().GetProperties().ToDictionary(x => x.Name, x => x.GetValue(yanit));
        ek["aralik"] = aralik.Disari();

        return Ok(ek);
    }

    private sealed class MulakatAyrinti
    {
        public int Id { get; set; }
        public string Kod { get; set; }
        public string Ad { get; set; }
        public string Sube { get; set; }
        public string Gorev { get; set; }
        public DateTime? Giris { get; set; }
        public DateTime? Cikis { get; set; }
        public string Neden { get; set; }
        public string NedenAciklama { get; set; }
        public string Grup { get; set; }
        public string Ozet { get; set; }
        public string UzmanYorumu { get; set; }
        public string YoneticiYorumu { get; set; }
        public string Uzman { get; set; }
        public string Kaynak { get; set; }
        public DateTime Olusturma { get; set; }
        public string SorularJson { get; set; }
    }

    /// <summary>
    /// Tek mülakat: soru-cevaplar, puanlar, yorumlar. Personelin telefonu
    /// (sorular_json'da duruyor) dönülmüyor.
    /// </summary>
    [HttpGet("CikisMulakati/{id:int}")]
    public IActionResult CikisMulakati(int id)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        MulakatAyrinti m;

        using (var db = _vt.Baglanti())
        {
            m = db.QueryFirstOrDefault<MulakatAyrinti>(@"
SELECT id AS Id, LTRIM(RTRIM(personel_kodu)) AS Kod, ad_soyad AS Ad, sube_adi AS Sube, gorev AS Gorev,
       giris_tarihi AS Giris, cikis_tarihi AS Cikis, cikis_nedeni AS Neden,
       cikis_nedeni_aciklama AS NedenAciklama, neden_grubu AS Grup, ozet AS Ozet,
       uzman_yorumu AS UzmanYorumu, yonetici_yorumu AS YoneticiYorumu, uzman_adi AS Uzman,
       kaynak AS Kaynak, olusturma AS Olusturma, sorular_json AS SorularJson
FROM KRY_CIKIS_MULAKAT WHERE id = @id", new { id });
        }

        if (m is null) return NotFound(new { hata = "Mülakat bulunamadı." });

        var sorular = new List<object>();
        var puanlar = new List<object>();

        if (!string.IsNullOrWhiteSpace(m.SorularJson))
        {
            try
            {
                using var belge = JsonDocument.Parse(m.SorularJson);

                if (JsonAl(belge.RootElement, "sorular", out var sd) && sd.ValueKind == JsonValueKind.Array)
                    foreach (var s in sd.EnumerateArray())
                    {
                        var cevap = JsonAl(s, "cevap", out var c) && c.ValueKind == JsonValueKind.String ? K(c.GetString()) : "";
                        if (cevap.Length == 0) continue;

                        var soru = JsonAl(s, "soru", out var q) && q.ValueKind == JsonValueKind.String ? K(q.GetString()) : "";
                        sorular.Add(new { soru, cevap });
                    }

                if (JsonAl(belge.RootElement, "puanlar", out var pd) && pd.ValueKind == JsonValueKind.Array)
                    foreach (var pu in pd.EnumerateArray())
                    {
                        var puan = JsonAl(pu, "puan", out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var n) ? n : 0;
                        if (puan <= 0) continue;

                        var baslik = JsonAl(pu, "baslik", out var b) && b.ValueKind == JsonValueKind.String ? K(b.GetString()) : "";
                        puanlar.Add(new { baslik, puan });
                    }
            }
            catch (JsonException)
            {
                /* Bozuk kayıt: soru-cevap bölümü boş kalır */
            }
        }

        var (tekrar, tavsiye) = MulakatYanitlari(m.SorularJson);

        PersonelKaydi kisi = null;

        if (!string.IsNullOrWhiteSpace(m.Kod))
            kisi = Guvenli("personel", () => _kaynak.TumPersonelleriGetir()
                .Where(x => Esit(x.PersonelKodu, m.Kod))
                .OrderByDescending(x => x.Durum == 1)
                .FirstOrDefault());

        var neden = K(m.Neden);

        return Ok(new
        {
            id = m.Id,
            ad = K(m.Ad),
            sube = K(m.Sube),
            poz = K(m.Gorev),
            giris = Iso(m.Giris),
            cikis = Iso(m.Cikis),
            calismaGun = m.Giris is DateTime g && m.Cikis is DateTime c2 && c2 >= g ? (int?)(c2.Date - g.Date).Days : null,
            neden = neden.Length > 0 ? neden : null,
            nedenAciklama = string.IsNullOrWhiteSpace(m.NedenAciklama) ? null : K(m.NedenAciklama),
            grup = string.IsNullOrWhiteSpace(m.Grup) ? CikisAnalizi.AnahtarlaSinifla(neden) : m.Grup,
            ozet = string.IsNullOrWhiteSpace(m.Ozet) ? null : K(m.Ozet),
            uzmanYorumu = string.IsNullOrWhiteSpace(m.UzmanYorumu) ? null : K(m.UzmanYorumu),
            yoneticiYorumu = string.IsNullOrWhiteSpace(m.YoneticiYorumu) ? null : K(m.YoneticiYorumu),
            uzman = string.IsNullOrWhiteSpace(m.Uzman) ? null : K(m.Uzman),
            kaynak = m.Kaynak,
            tarih = Iso(m.Olusturma),
            tekrarCalisir = tekrar,
            tavsiye,
            sorular,
            puanlar,
            fotoUrl = PersonelFoto(kisi)
        });
    }

    /* ==================================================================== */
    /* Sayfa: duyuru gönder                                                  */
    /* ==================================================================== */

    /// <summary>
    /// Patron duyurularının gönderen alanındaki ek. Panelden gönderilen
    /// duyurularda gonderen kullanıcı adı (boşluksuz); " (Yönetim)" ile
    /// bitenler Biçen360 patron görünümünden gelmiş.
    /// </summary>
    private const string DuyuruEki = " (Yönetim)";

    private sealed class DuyuruSatiri
    {
        public int Id { get; set; }
        public string Baslik { get; set; }
        public string Metin { get; set; }
        public string HedefTur { get; set; }
        public string HedefOzet { get; set; }
        public string Baglanti { get; set; }
        public string Yazan { get; set; }
        public DateTime Tarih { get; set; }
        public int Okuyan { get; set; }
        public int Alici { get; set; }
    }

    /// <summary>Patronların gönderdiği son 20 duyuru, okunma sayısıyla.</summary>
    private List<DuyuruSatiri> PatronDuyurulari() => PatronOnbellegi.Al("duyuru|son", () => DuyuruListesi(null));

    /// <summary>Patron duyuruları; aralık verilirse o aralıkta gönderilenler (en çok 100, 1.6).</summary>
    private List<DuyuruSatiri> DuyuruListesi(Aralik aralik)
    {
        using var db = _vt.Baglanti();

        return db.Query<DuyuruSatiri>($@"
SELECT TOP {(aralik is null ? 20 : 100)} d.id AS Id, d.baslik AS Baslik, d.metin AS Metin,
       d.hedef_tur AS HedefTur, d.hedef_ozet AS HedefOzet, d.baglanti AS Baglanti,
       ISNULL(d.yazan_ad, d.gonderen) AS Yazan, d.olusturma AS Tarih,
       (SELECT COUNT(*) FROM KRY_MOBIL_DUYURU_OKUMA o WHERE o.duyuru_id = d.id) AS Okuyan,
       (SELECT COUNT(*) FROM KRY_MOBIL_DUYURU_ALICI a WHERE a.duyuru_id = d.id) AS Alici
FROM KRY_MOBIL_DUYURU d
WHERE d.iptal = 0 AND d.gonderen LIKE @ek
  AND (@bas IS NULL OR (d.olusturma >= @bas AND d.olusturma < @bitSonra))
ORDER BY d.olusturma DESC", new { ek = "%" + DuyuruEki, bas = aralik?.Bas, bitSonra = aralik?.BitSonrasi }).ToList();
    }

    private List<PersonelKaydi> Calisanlar() =>
        _kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.PersonelKodu))
            .ToList();

    /// <summary>
    /// Satış birimlerinin müdürleri (şube satırındaki müdür; Sube ekranında
    /// görünen kişi). Bir kişi birden çok şubenin müdürüyse bir kez.
    /// </summary>
    private List<string> MudurKodlari() =>
        SubeSatirlari()
            .Where(x => x.T.Satis && !string.IsNullOrWhiteSpace(x.MudurKodu))
            .Select(x => x.MudurKodu)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

    /// <summary>Hedef seçenekleri ve kişi sayıları (sayfadaki "N kişiye gidecek").</summary>
    private object DuyuruHedefleri() => PatronOnbellegi.Al("duyuru|hedef", () =>
    {
        var birim = Birimler();
        var calisanlar = Calisanlar();

        var subeKisi = calisanlar
            .Select(p => birim.KodBul(p.Sube))
            .Where(k => k is not null)
            .GroupBy(k => k, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

        var subeler = birim.Subeler
            .Where(s => subeKisi.ContainsKey(s.Kod))
            .Select(s => new { ad = s.Ad, bolge = s.Bolge, kisi = subeKisi[s.Kod], satis = s.Satis })
            .ToList();

        return (object)new
        {
            tumu = calisanlar.Count,
            mudurler = Guvenli("şube müdürleri", () => (object)MudurKodlari().Count) as int?,
            bolgeler = birim.Bolgeler
                .Select(b => new { ad = b, kisi = subeler.Where(s => Esit(s.bolge, b)).Sum(s => s.kisi) })
                .Where(b => b.kisi > 0)
                .ToList(),
            subeler
        };
    });

    /// <summary>
    /// Duyuru sayfası: hedefler ve son duyurular. <c>bas</c>/<c>bit</c>
    /// verilirse (sayfanın tarih süzgeci) liste o aralıkta gönderilenler.
    /// </summary>
    [HttpGet("Duyurular")]
    public IActionResult Duyurular([FromQuery] string bas = null, [FromQuery] string bit = null)
    {
        var (_, red) = Yetki();
        if (red is not null) return red;

        var (aralik, aralikHatasi) = AralikAl(bas, bit);
        if (aralikHatasi is not null) return aralikHatasi;

        var hedefler = Guvenli("duyuru hedefleri", DuyuruHedefleri);
        var son = (aralik is null
                      ? Guvenli("patron duyuruları", PatronDuyurulari)
                      : Guvenli("patron duyuruları (aralık)", () => PatronOnbellegi.Al($"duyuru|A|{aralik.Anahtar}",
                          aralik.Omur, () => DuyuruListesi(aralik))))
                  ?? new List<DuyuruSatiri>();
        var tumu = Alan(hedefler, "tumu") as int?;

        var yanit = new
        {
            hedefler,
            son = son.Select(d =>
            {
                /* Hedef büyüklüğü panel listesindeki gibi: seçili hedefte
                   alıcı tablosu, "herkes"te bugünkü çalışan sayısı */
                int? hedefSayisi = d.HedefTur == "secili" ? d.Alici : tumu;

                return new
                {
                    id = d.Id,
                    baslik = d.Baslik,
                    metin = d.Metin,
                    hedef = string.IsNullOrWhiteSpace(d.HedefOzet) ? "Tüm personel" : d.HedefOzet,
                    gonderen = d.Yazan,
                    baglanti = d.Baglanti,
                    tarih = Iso(d.Tarih),
                    zaman = GunSaat(d.Tarih),
                    okuyan = d.Okuyan,
                    hedefSayisi,
                    oran = hedefSayisi > 0 ? (int?)Math.Min(100, (int)Math.Round(d.Okuyan * 100.0 / hedefSayisi.Value)) : null
                };
            }).ToList()
        };

        /* Aralıksız yanıt eskisiyle birebir; aralıkta "aralik" ekleniyor */
        if (aralik is null) return Ok(yanit);

        var ek = yanit.GetType().GetProperties().ToDictionary(x => x.Name, x => x.GetValue(yanit));
        ek["aralik"] = aralik.Disari();

        return Ok(ek);
    }

    /// <summary>
    /// Duyuru gönderir: panelin duyuru altyapısı (KRY_MOBIL_DUYURU,
    /// <see cref="DuyuruYazici"/>; alıcılar; anlık bildirim). Hedef:
    /// <c>tumu</c> (uygulamadaki "herkes", sonradan gelen de görür),
    /// <c>bolge</c>/<c>sube</c> (<c>deger</c> = ad), <c>mudurler</c> (satış
    /// birimlerinin müdürleri). Bölge, şube ve müdürler "secili" hedef
    /// olarak yazılıyor: şube eşleştirmesi patron ekranlarındaki kuralla
    /// (Mikro birim adı ↔ şube tanımı) yapılıyor, uygulamanın ada göre
    /// süzdüğü "sube" hedefi Mikro'daki yazımla birebir aynı ad istiyordu.
    /// Gönderen "Ad Soyad (Yönetim)".
    /// </summary>
    [HttpPost("Duyuru")]
    public async Task<IActionResult> DuyuruGonder(
        [FromBody] PatronDuyuruGirdi girdi, [FromServices] BildirimServisi bildirim)
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        var baslik = K(girdi?.Baslik);
        var metin = K(girdi?.Metin);
        var baglanti = K(girdi?.Baglanti);
        var baglantiYazi = K(girdi?.BaglantiYazi);

        if (baslik.Length == 0) return BadRequest(new { hata = "Başlık yazınız." });
        if (baslik.Length > 160) return BadRequest(new { hata = "Başlık en fazla 160 karakter olabilir." });
        if (metin.Length == 0) return BadRequest(new { hata = "Duyuru metnini yazınız." });
        if (metin.Length > 2000) return BadRequest(new { hata = "Duyuru metni en fazla 2000 karakter olabilir." });

        /* Panelle aynı kural: tıklanamayan bir bağlantı duyuruyu güvenilmez gösteriyor */
        if (baglanti.Length > 0
            && (!Uri.TryCreate(baglanti, UriKind.Absolute, out var adres)
                || adres.Scheme is not ("https" or "http")))
            return BadRequest(new { hata = "Bağlantı geçersiz. https:// ile başlayan tam adres giriniz." });

        if (baglantiYazi.Length > 40) baglantiYazi = baglantiYazi[..40];

        /* ------------------------------------------------------- hedef */
        var hedef = Kucuk(girdi?.Hedef);
        var deger = K(girdi?.Deger);

        string tur;
        string ozet;
        List<string> kodlar;

        var calisanlar = Calisanlar();

        switch (hedef)
        {
            case "tumu":
            case "herkes":
                tur = "herkes";
                ozet = null;
                kodlar = calisanlar.Select(x => K(x.PersonelKodu)).ToList();
                break;

            case "bolge":
            {
                var birim = Birimler();
                var bolge = birim.Bolgeler.FirstOrDefault(b => Esit(b, deger));

                if (bolge is null) return BadRequest(new { hata = "Bölge seçiniz." });

                tur = "secili";
                ozet = $"Bölge: {bolge}";
                kodlar = calisanlar
                    .Where(x => Esit(birim.Tanim(birim.KodBul(x.Sube))?.Bolge, bolge))
                    .Select(x => K(x.PersonelKodu))
                    .ToList();
                break;
            }

            case "sube":
            {
                var birim = Birimler();
                var sube = birim.Subeler.FirstOrDefault(s => Ust(s.Ad) == Ust(deger))
                           ?? birim.Subeler.FirstOrDefault(s => Esit(s.Kod, deger));

                if (sube is null) return BadRequest(new { hata = "Şube seçiniz." });

                tur = "secili";
                ozet = $"Şube: {sube.Ad}";
                kodlar = calisanlar
                    .Where(x => Esit(birim.KodBul(x.Sube), sube.Kod))
                    .Select(x => K(x.PersonelKodu))
                    .ToList();
                break;
            }

            case "mudurler":
                tur = "secili";
                ozet = "Şube müdürleri";
                kodlar = MudurKodlari();
                break;

            default:
                return BadRequest(new { hata = "Duyurunun kime gideceğini seçiniz." });
        }

        kodlar = kodlar.Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        if (kodlar.Count == 0) return BadRequest(new { hata = "Seçilen hedefte çalışan bulunamadı." });

        /* ------------------------------------------------------- kayıt */
        var imza = Imza(p, DuyuruEki, 60);
        var unvan = _patron.Bul(p.PersonelKodu, p.KimlikNo)?.Unvan;

        int id;

        using (var db = _vt.Baglanti())
        {
            /* WebView'da çift dokunuş ya da yavaş bağlantıda yeniden gönderim
               aynı duyuruyu iki kez herkese göndermesin */
            var ayni = db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_MOBIL_DUYURU
WHERE iptal = 0 AND gonderen = @imza AND baslik = @baslik
  AND olusturma > DATEADD(minute, -2, SYSDATETIME())", new { imza, baslik });

            if (ayni > 0) return Conflict(new { hata = "Bu duyuru az önce gönderildi." });

            id = DuyuruYazici.Ekle(db, new DuyuruYazici.Kayit
                {
                    Baslik = baslik,
                    Metin = metin,
                    Hedef = tur,
                    HedefOzet = ozet,
                    Baglanti = baglanti.Length > 0 ? baglanti : null,
                    BaglantiYazi = baglanti.Length > 0 && baglantiYazi.Length > 0 ? baglantiYazi : null,
                    Gonderen = imza,
                    YazanAd = imza,
                    YazanUnvan = string.IsNullOrWhiteSpace(unvan) ? null : K(unvan)
                },
                tur == "secili" ? kodlar : null);
        }

        /* Bildirim: panelin duyurusundaki yollar ("duyuru" ekranı). Gitmemesi
           duyurunun kaydını geçersiz kılmaz. */
        try
        {
            if (tur == "herkes")
                await bildirim.HerkeseGonder(baslik, metin, "duyuru");
            else
                foreach (var parca in kodlar.Chunk(1500))
                    await bildirim.TopluGonder(parca, baslik, metin, "duyuru");
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Patron duyurusu bildirimi gönderilemedi: #{Id}", id);
        }

        _gunluk.Yaz("PATRON DUYURU", IstemciAdresi.Bul(HttpContext),
            $"{imza} ({K(p.PersonelKodu)}) → #{id} {ozet ?? "Tüm personel"} · {kodlar.Count} kişi");

        PatronOnbellegi.Temizle("duyuru|", "sayfalar|");

        return Ok(new
        {
            basarili = true,
            id,
            aliciSayisi = kodlar.Count,
            mesaj = $"Duyuru {kodlar.Count.ToString("N0", Tr)} kişiye gönderildi."
        });
    }

    /* ==================================================================== */
    /* Sayfa: bildirim ayarları                                              */
    /* ==================================================================== */

    /// <summary>Sayfada seçilebilen sabah özeti saatleri</summary>
    private static readonly string[] SabahSaatleri =
        { "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00" };

    /// <summary>
    /// Örnek bildirimler: arka plan görevinin göndereceği metnin aynısı,
    /// bugünkü verilerle (metinler PatronBildirimServisi'nde ve
    /// <see cref="SabahOzeti"/>'nde tek yerde).
    /// </summary>
    private object OrnekBildirimler() => PatronOnbellegi.Al("bildirimOrnek", () =>
    {
        static object Ornek((string Baslik, string Metin) x) => new { baslik = x.Baslik, metin = x.Metin };

        var sabah = Guvenli("sabah özeti", () => (object)SabahOzeti()) is ValueTuple<string, string> s
            ? s
            : ("Günaydın · Şirket özeti", "Mağazadaki kişi sayısı, bekleyen onaylar ve dünkü başvurular.");

        /* En son bekleyen onay; yoksa biçim örneği */
        var onay = Guvenli("onay örneği", () =>
        {
            using var db = _vt.Baglanti();

            var son = db.QueryFirstOrDefault<(string Tur, string Baslik)>(@"
SELECT TOP 1 tur, baslik FROM KRY_ONAY WHERE durum = @d ORDER BY istek_tarihi DESC",
                new { d = OnayDurumu.Bekliyor });

            var bekleyen = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_ONAY WHERE durum = @d",
                new { d = OnayDurumu.Bekliyor });

            return son.Tur is null
                ? null
                : (object)PatronBildirimServisi.OnayMetni(new[] { (son.Tur, son.Baslik) }, bekleyen);
        }) is ValueTuple<string, string> o
            ? o
            : PatronBildirimServisi.OnayMetni(new[] { (OnayTuru.IseAlim, "Ad Soyad · YENİ İŞE ALIM") }, 1);

        /* Şu an sınırın altında bir birim varsa o; yoksa biçim örneği */
        var birim = Guvenli("kritik örneği", () => KritikBirimler(PatronBildirimGorevi.KritikSinir))?.FirstOrDefault()
                    ?? new PatronKritikBirim("", "ŞUBE ADI", 64, 5, null);

        var (kb, km, _) = PatronBildirimServisi.KritikMetni(new[] { birim });

        var etik = Guvenli("etik hat", Etik);

        return (object)new
        {
            sabah = Ornek(sabah),
            onay = Ornek(onay),
            kritik = Ornek((kb, km)),
            etik = Ornek(PatronBildirimServisi.EtikMetni(1, Math.Max(1, etik?.Yeni ?? 1), Math.Max(1, etik?.Acik ?? 1)))
        };
    });

    private object AyarYaniti(PersonelKaydi p, PatronBildirimAyari a, string mesaj = null) => new
    {
        sabah = a.Sabah,
        sabahSaat = a.SabahSaat,
        onay = a.Onay,
        kritik = a.Kritik,
        etik = a.Etik,
        saatler = SabahSaatleri.Contains(a.SabahSaat) ? SabahSaatleri : SabahSaatleri.Append(a.SabahSaat).OrderBy(x => x).ToArray(),
        bildirimIzni = Guvenli("bildirim jetonu", () => (object)JetonVar(p.PersonelKodu)) as bool? ?? true,
        kritikSinir = PatronBildirimGorevi.KritikSinir,
        ornekler = Guvenli("örnek bildirimler", OrnekBildirimler),
        mesaj
    };

    [HttpGet("BildirimAyar")]
    public IActionResult BildirimAyarOku()
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        var a = _patron.Bul(p.PersonelKodu, p.KimlikNo)?.Ayar ?? new PatronBildirimAyari();

        return Ok(AyarYaniti(p, a));
    }

    /// <summary>
    /// Ayarları kaydeder. Yalnızca gönderilen alanlar değişiyor (sayfa tek
    /// anahtarı değiştirince tamamını göndermek zorunda kalmasın; eski bir
    /// sayfa yeni bir tercihi bilmeden varsayılana çevirmesin).
    /// </summary>
    [HttpPost("BildirimAyar")]
    public IActionResult BildirimAyarYaz([FromBody] JsonElement govde)
    {
        var (p, red) = Yetki();
        if (red is not null) return red;

        if (govde.ValueKind != JsonValueKind.Object) return BadRequest(new { hata = "Ayarlar okunamadı." });

        var a = _patron.Bul(p.PersonelKodu, p.KimlikNo)?.Ayar ?? new PatronBildirimAyari();

        bool? Anahtar(string ad) =>
            JsonAl(govde, ad, out var d) && d.ValueKind is JsonValueKind.True or JsonValueKind.False ? d.GetBoolean() : null;

        a.Sabah = Anahtar("sabah") ?? a.Sabah;
        a.Onay = Anahtar("onay") ?? a.Onay;
        a.Kritik = Anahtar("kritik") ?? a.Kritik;
        a.Etik = Anahtar("etik") ?? a.Etik;

        if (JsonAl(govde, "sabahSaat", out var saat) && saat.ValueKind == JsonValueKind.String)
        {
            if (PatronBildirimAyari.SaatCoz(saat.GetString()) is not TimeSpan t)
                return BadRequest(new { hata = "Saat SS:dd biçiminde olmalı (ör. 08:30)." });

            a.SabahSaat = t.ToString(@"hh\:mm", CultureInfo.InvariantCulture);
        }

        _patron.AyarYaz(p.PersonelKodu, p.KimlikNo, a);

        PatronOnbellegi.Temizle($"sayfalar|{K(p.PersonelKodu)}");

        return Ok(AyarYaniti(p, a, "Bildirim ayarları kaydedildi."));
    }

    /* ==================================================================== */
    /* Zamanlı bildirimlerin hesapları (PatronBildirimGorevi)                */
    /* ==================================================================== */

    /// <summary>
    /// Sabah özetinin metni, patron ekranlarının sayılarıyla. Hiçbir bölüm
    /// okunamazsa hata: görev işaret koymaz, bir sonraki dakika yeniden dener.
    /// </summary>
    internal (string Baslik, string Metin) SabahOzeti()
    {
        var canli = Guvenli("canlı okutma", Canli);
        var onay = Guvenli("onaylar", Onaylar);
        var basvuru = Guvenli("başvurular", Basvurular);

        var parcalar = new List<string>();

        if (canli is not null)
            parcalar.Add($"{Topla(canli.Kisiler, canli.PlanVar).Iceride.ToString("N0", Tr)} kişi mağazada");

        if (onay is not null)
        {
            var toplam = onay.Turler.Sum(x => x.Adet);
            parcalar.Add(toplam > 0 ? $"{toplam} onay bekliyor" : "bekleyen onay yok");
        }

        if (basvuru is not null)
        {
            parcalar.Add($"dün {basvuru.Gun(DateTime.Today.AddDays(-1))} başvuru geldi");

            if (basvuru.Islemsiz > 0)
                parcalar.Add($"{basvuru.Islemsiz} başvuru {IslemsizGun}+ gündür işlemsiz");
        }

        if (parcalar.Count == 0) throw new InvalidOperationException("Sabah özeti için veri alınamadı.");

        var metin = string.Join(", ", parcalar) + ".";
        metin = char.ToUpper(metin[0], Tr) + metin[1..];

        return (DateTime.Now.Hour < 12 ? "Günaydın · Şirket özeti" : "Şirket özeti", metin);
    }

    /// <summary>
    /// Okutma oranı sınırın altındaki satış birimleri, en düşük önce. Özet'teki
    /// "dikkat" uyarısıyla aynı koşul (en az 3 beklenen kişi), yalnızca sınır farklı.
    /// </summary>
    internal List<PatronKritikBirim> KritikBirimler(int sinir) =>
        SubeSatirlari()
            .Where(x => x.T.Satis && x.Canli is { Beklenen: >= 3 } && x.Canli.Oran < sinir)
            .OrderBy(x => x.Canli.Oran)
            .Select(x => new PatronKritikBirim(x.T.Kod, x.T.Ad, x.Canli.Oran ?? 0, x.Canli.Okutmadi, x.Mudur))
            .ToList();
}

/// <summary>POST Duyuru gövdesi</summary>
public class PatronDuyuruGirdi
{
    /// <summary>tumu · bolge · sube · mudurler</summary>
    public string Hedef { get; set; }

    /// <summary>bolge/sube hedefinde ad</summary>
    public string Deger { get; set; }

    public string Baslik { get; set; }
    public string Metin { get; set; }
    public string Baglanti { get; set; }
    public string BaglantiYazi { get; set; }
}

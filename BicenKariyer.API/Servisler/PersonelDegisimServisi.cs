using System.Data;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Personel kayıtlarındaki değişiklikleri izler.
///
/// <para>
/// Mikro alan bazlı geçmiş tutmuyor: bir personelin ücreti değiştiğinde
/// eski değer kayboluyor, yalnızca "son değiştiren kullanıcı" kalıyor.
/// Bu yüzden değişiklikleri kendimiz izliyoruz: her taramada verinin
/// anlık kopyası saklanır, bir sonraki taramada karşılaştırılır ve
/// değişen alanlar geçmişe yazılır.
/// </para>
///
/// <para>
/// <b>Sınırı açıkça bilinmeli:</b> iki tarama arasında yapılıp geri alınan
/// bir değişiklik görünmez, ve ilk taramadan önceki geçmiş yoktur. Tarama
/// personel listesi her açıldığında (en fazla saatte bir) çalışır.
/// </para>
/// </summary>
public class PersonelDegisimServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly OnayServisi _onay;
    private readonly MikroResimServisi _resim;
    private readonly ILogger<PersonelDegisimServisi> _kayit;

    /* Tarama sıklığı: personel listesi sık açılıyor, her açılışta
       karşılaştırma yapmak gereksiz yük olur. */
    private static DateTime _sonTarama = DateTime.MinValue;
    private static readonly object _kilit = new();
    private const int AralikDakika = 60;

    /* Fotoğraf aktarımının kendi zamanlaması var.

       Önceden değişiklik taramasının içindeydi ve aynı saatlik aralığa
       takılıyordu: bir personel işe alındıktan sonra fotoğrafı bir sonraki
       taramaya kadar aktarılmıyor, çoğu zaman hiç fark edilmiyordu.
       Ayrı ve daha sık çalışır. */
    private static DateTime _sonFotograf = DateTime.MinValue;
    private static readonly object _fotografKilit = new();
    private const int FotografAralikDakika = 5;

    public PersonelDegisimServisi(
        VeritabaniServisi vt,
        OnayServisi onay,
        MikroResimServisi resim,
        ILogger<PersonelDegisimServisi> kayit)
    {
        _vt = vt;
        _onay = onay;
        _resim = resim;
        _kayit = kayit;
    }

    /// <summary>
    /// Onay gerektiren alanlar. Bir personelin şubesi değiştiğinde ya da
    /// işe girişi yapıldığında yetkili haberdar edilmeli: bunlar norm
    /// kadroyu doğrudan etkiler ve Mikro'da sistemin dışında yapılıyor.
    /// </summary>
    private static readonly string[] OnayGerektiren =
        { "Şube / iş grubu", "İşe giriş tarihi" };

    /// <summary>İzlenen alanlar ve ekranda görünecek adları.</summary>
    private static readonly (string Anahtar, string Ad)[] Alanlar =
    {
        ("isGrubu", "Şube / iş grubu"),
        ("pozisyon", "Ünvan"),
        ("telefon", "Telefon"),
        ("girisTarihi", "İşe giriş tarihi"),
        ("cikisTarihi", "İşten çıkış tarihi"),
        ("cikisSebebi", "Çıkış sebebi"),
        ("ucret", "Ücret"),
        ("sakatDerece", "Engellilik derecesi")
    };

    /// <summary>
    /// Verilen listeyi son anlık kopyayla karşılaştırır, değişenleri
    /// geçmişe yazar ve kopyayı tazeler. Sık çağrılabilir; aralık
    /// dolmadıysa hiçbir şey yapmaz.
    /// </summary>
    public void Tara(List<PersonelKaydi> liste, bool zorla = false)
    {
        lock (_kilit)
        {
            if (!zorla && (DateTime.Now - _sonTarama).TotalMinutes < AralikDakika)
                return;

            _sonTarama = DateTime.Now;
        }

        try
        {
            using var db = _vt.Baglanti();

            var eskiler = db.Query<(string Kod, string Json)>(
                "SELECT personel_kodu AS Kod, veri_json AS Json FROM KRY_PERSONEL_ANLIK")
                .ToDictionary(x => x.Kod, x => x.Json, StringComparer.OrdinalIgnoreCase);

            var degisiklik = 0;

            /* Eski kayıtlardaki Mikro kullanıcı numaralarını ada çevir */
            MikroKullanicilari.EskiKayitlariDuzelt(db);

            foreach (var kisi in liste)
            {
                if (string.IsNullOrWhiteSpace(kisi.PersonelKodu)) continue;

                var kod = kisi.PersonelKodu.Trim();
                var yeni = Ozet(kisi);
                var yeniJson = JsonSerializer.Serialize(yeni);

                if (!eskiler.TryGetValue(kod, out var eskiJson))
                {
                    /* İlk görülüş: yalnızca kopya saklanır. Geçmişe 'yeni
                       kayıt" diye satır yazılmaz; ilk taramada bütün
                       personel için satır üretmek geçmişi kullanılmaz
                       hâle getirirdi. */
                    db.Execute(@"
INSERT INTO KRY_PERSONEL_ANLIK (personel_kodu, veri_json)
VALUES (@kod, @json)", new { kod, json = yeniJson });

                    continue;
                }

                if (eskiJson == yeniJson) continue;

                Dictionary<string, string> eski;

                try
                {
                    eski = JsonSerializer.Deserialize<Dictionary<string, string>>(eskiJson)
                           ?? new Dictionary<string, string>();
                }
                catch (JsonException)
                {
                    eski = new Dictionary<string, string>();
                }

                foreach (var (anahtar, ad) in Alanlar)
                {
                    var e = eski.GetValueOrDefault(anahtar);
                    var y = yeni.GetValueOrDefault(anahtar);

                    if (string.Equals(e ?? "", y ?? "", StringComparison.Ordinal))
                        continue;

                    db.Execute(@"
INSERT INTO KRY_PERSONEL_DEGISIM
    (personel_kodu, ad_soyad, alan, eski_deger, yeni_deger, mikro_kullanici)
VALUES (@kod, @adSoyad, @alan, @eski, @yeni, @kullanici)",
                        new
                        {
                            kod,
                            adSoyad = $"{kisi.Ad} {kisi.Soyad}".Trim(),
                            alan = ad,
                            eski = Kirp(e),
                            yeni = Kirp(y),
                            kullanici = kisi.SonDegistiren
                        });

                    degisiklik++;

                    /* Onaylanmış rotasyon talebi Mikro'ya işlendi mi (07.10.2026) */
                    if (anahtar == "isGrubu" && !string.IsNullOrWhiteSpace(y))
                        BicenKariyer.API.Controllers.RotasyonController.MikroDegisikligi(db, kod, y, kisi.SonDegistiren);

                    /* Şube değişikliği ve işe giriş yetkili onayına
                       düşürülür. Değişiklik Mikro'da zaten yapılmıştır;
                       onay burada geriye dönük bir bilgilendirme ve
                       kayıt işlevi görür, işlemi geri almaz. */
                    if (OnayGerektiren.Contains(ad))
                    {
                        try
                        {
                            var kimAd = $"{kisi.Ad} {kisi.Soyad}".Trim();

                            /* İşe giriş, panelde zaten 'İşe Alındı' olarak
                               kapanmış bir başvuruya karşılık geliyorsa
                               onay istenmez: süreç buradan yürümüş ve
                               yetkili zaten onaylamıştır. Yalnızca
                               bilgilendirme bildirimi gönderilir.

                               Panelde karşılığı yoksa ya da başvuru başka
                               bir durumdaysa, personel sistemin dışından
                               işe alınmış demektir; bu onaya düşer. */
                            var panelde = ad == "İşe giriş tarihi"
                                && !string.IsNullOrWhiteSpace(kisi.KimlikNo)
                                && db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_BASVURULAR
WHERE kimlik_no = @kimlik AND durum = N'İşe Alındı'",
                                    new { kimlik = kisi.KimlikNo.Trim() }) > 0;

                            var (baslik, ozet) = AciklamaYaz(ad, kimAd, e, y, kisi);

                            if (panelde)
                            {
                                /* Bilgilendirme: onay yetkisi olan
                                   kullanıcılara bildirim düşer, onay
                                   kaydı açılmaz. */
                                db.Execute(@"
INSERT INTO KRY_BILDIRIM (kullanici, tur, baslik, metin)
SELECT kullanici_adi, N'MikroBilgi', @baslik, @metin
FROM KRY_KULLANICILAR
WHERE aktif = 1 AND rol IN (N'Admin', N'GenelMudurYardimcisi')",
                                    new
                                    {
                                        baslik = $"{kimAd} · işe girişi Mikro'ya işlendi",
                                        metin = ozet + " · Başvurusu panelde "
                                                + "işe alındı olarak kapanmıştı, onay gerekmiyor."
                                    });
                            }
                            else
                            {
                                _onay.Olustur(
                                    OnayTuru.Rotasyon,
                                    baslik,
                                    ozet,
                                    new
                                    {
                                        kaynak = "Mikro",
                                        personelKodu = kod,
                                        alan = ad,
                                        eski = e,
                                        yeni = y
                                    },
                                    kisi.SonDegistiren ?? "mikro",
                                    subeAdi: kisi.Sube);
                            }
                        }
                        catch (Exception hata)
                        {
                            _kayit.LogWarning(hata,
                                "Mikro değişikliği işlenemedi: {Kod}", kod);
                        }
                    }
                }

                db.Execute(@"
UPDATE KRY_PERSONEL_ANLIK
SET veri_json = @json, guncelleme = SYSDATETIME()
WHERE personel_kodu = @kod", new { kod, json = yeniJson });
            }

            if (degisiklik > 0)
                _kayit.LogInformation("Personel değişikliği kaydedildi: {Adet}", degisiklik);
        }
        catch (Exception hata)
        {
            /* İzleme başarısız olursa personel listesi yine çalışmalı:
               geçmiş yardımcı bir özellik, listenin ön koşulu değil. */
            _kayit.LogWarning(hata, "Personel değişiklikleri taranamadı");
        }
    }

    /// <summary>
    /// Onay kartının başlığı ve açıklaması (21.10.2026). Önceki metin
    /// ("Mikro'da yapıldı · İşe giriş tarihi: 20.10 → 21.10") ne olduğunu
    /// anlatmıyordu: yeni işe alım mı, tarih düzeltmesi mi, yeniden giriş mi
    /// belli değildi.
    /// </summary>
    private static (string Baslik, string Ozet) AciklamaYaz(string alan, string kimAd, string eski, string yeni, PersonelKaydi k)
    {
        var yapan = string.IsNullOrWhiteSpace(k.SonDegistiren) ? "" : $" İşlemi Mikro'da {k.SonDegistiren} yaptı.";
        var kim = $"{kimAd}{(string.IsNullOrWhiteSpace(k.Pozisyon) ? "" : $" ({k.Pozisyon.Trim()})")}";
        var yer = string.IsNullOrWhiteSpace(k.IsGrubu) ? "" : $" {k.IsGrubu.Trim()}";
        const string not = " Değişiklik Mikro'da zaten yapıldı; onay kaydı bilgilendirme ve kayıt içindir, Mikro'daki işlemi geri almaz.";

        static DateTime? Tarih(string v) =>
            DateTime.TryParse(v, new System.Globalization.CultureInfo("tr-TR"), System.Globalization.DateTimeStyles.None, out var t) ? t
            : DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out t) ? t
            : null;
        static string T(string v) => Tarih(v) is DateTime t ? t.ToString("dd.MM.yyyy") : (string.IsNullOrWhiteSpace(v) ? "boş" : v);

        if (alan == "İşe giriş tarihi")
        {
            if (string.IsNullOrWhiteSpace(eski))
                return ($"{kimAd} · Yeni işe giriş (panel dışından)",
                    $"{kim},{yer} şubesinde {T(yeni)} tarihiyle Mikro'da işe başlatıldı. "
                    + "Bu kişinin İK panelinde 'İşe Alındı' başvurusu yok; işe alım panel dışından yapılmış." + yapan + not);

            var e = Tarih(eski);
            var y = Tarih(yeni);
            if (e is not null && y is not null && (y.Value - e.Value).TotalDays > 30)
                return ($"{kimAd} · Yeniden işe giriş",
                    $"{kim} için Mikro'da yeni bir işe giriş tarihi girildi: {T(eski)} yerine {T(yeni)}. "
                    + "Daha önce çalışıp ayrılan kişi yeniden işe alınmış olabilir." + yapan + not);

            return ($"{kimAd} · İşe giriş tarihi düzeltildi",
                $"{kim}{(yer.Length > 0 ? $" ·{yer}" : "")}: Mikro'daki işe giriş tarihi {T(eski)} iken {T(yeni)} olarak değiştirildi. "
                + "Yeni bir işe alım değil, tarih düzeltmesi." + yapan + not);
        }

        if (string.IsNullOrWhiteSpace(eski))
            return ($"{kimAd} · Şube atandı",
                $"{kim} Mikro'da{yer} şubesine atandı (önceden şube boştu)." + yapan + not);

        return ($"{kimAd} · Şube değişikliği (onaylı talep yok)",
            $"{kim} Mikro'da {eski.Trim()} şubesinden {(yeni ?? "").Trim()} şubesine alındı. "
            + "Bu değişiklik için Biçen360'ta onaylanmış bir rotasyon talebi bulunmuyor." + yapan + not);
    }

    /// <summary>
    /// Başvuru fotoğraflarını Mikro'ya aktarır.
    ///
    /// <para>
    /// İşe alınan adayın fotoğrafı zaten sistemde duruyor; personel
    /// kartında yeniden çekmek gereksiz iş. Mikro'da fotoğrafı olmayan
    /// aktif personel için, kimlik numarasına göre eşleşen başvurudaki
    /// fotoğraf yazılır.
    /// </para>
    ///
    /// <para>
    /// Her taramada en fazla birkaç kişi işlenir: fotoğraf yazımı Mikro'ya
    /// gidiyor ve toplu işlem hem yavaş hem riskli olur. Zaten fotoğrafı
    /// olan personele dokunulmaz — elle yüklenmiş bir fotoğrafın üzerine
    /// yazmak, İK'nın seçtiği görseli kaybettirir.
    /// </para>
    /// </summary>
    public void FotograflariAktar(List<PersonelKaydi> liste, bool zorla = false)
    {
        lock (_fotografKilit)
        {
            if (!zorla &&
                (DateTime.Now - _sonFotograf).TotalMinutes < FotografAralikDakika)
                return;

            _sonFotograf = DateTime.Now;
        }

        using var db = _vt.Baglanti();

        /* Bir turda işlenecek en fazla kişi. Elle çalıştırıldığında sınır
           yükselir: kullanıcı sonucu beklemeyi göze almıştır. */
        var sinir = zorla ? 50 : 10;

        var adaylar = liste
            .Where(x => x.Durum == 1
                     && !x.ResimVar
                     && !string.IsNullOrWhiteSpace(x.KimlikNo)
                     && x.Guid is not null && x.Guid != Guid.Empty)
            .Take(zorla ? 300 : 60)
            .ToList();

        if (adaylar.Count == 0) return;

        var aktarilan = 0;

        foreach (var kisi in adaylar)
        {
            if (aktarilan >= sinir) break;

            try
            {
                var json = db.ExecuteScalar<string>(@"
SELECT TOP 1 veri_json FROM KRY_BASVURULAR
WHERE kimlik_no = @kimlik AND durum = N'İşe Alındı'
ORDER BY olusturma DESC", new { kimlik = kisi.KimlikNo.Trim() });

                if (string.IsNullOrWhiteSpace(json)) continue;

                using var belge = JsonDocument.Parse(json);

                if (!belge.RootElement.TryGetProperty("fotograf", out var foto) ||
                    !foto.TryGetProperty("base64", out var b64))
                    continue;

                var metin = b64.GetString() ?? "";
                var virgul = metin.IndexOf(',');

                if (virgul > 0 && virgul < 100) metin = metin[(virgul + 1)..];

                if (metin.Length < 100) continue;

                var sonuc = _resim.Yaz(
                    kisi.Guid!.Value,
                    kisi.PersonelKodu,
                    $"{kisi.Ad} {kisi.Soyad}".Trim(),
                    Convert.FromBase64String(metin),
                    "başvuru");

                if (sonuc.Basarili)
                {
                    aktarilan++;

                    _kayit.LogInformation(
                        "Başvuru fotoğrafı Mikro'ya aktarıldı: {Kod}",
                        kisi.PersonelKodu);
                }
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata,
                    "Başvuru fotoğrafı aktarılamadı: {Kod}", kisi.PersonelKodu);
            }
        }
    }

    /// <summary>Karşılaştırılacak alanların metin hâli.</summary>
    private static Dictionary<string, string> Ozet(PersonelKaydi k) => new()
    {
        ["isGrubu"] = k.IsGrubu ?? "",
        ["pozisyon"] = k.Pozisyon ?? "",
        ["telefon"] = k.Telefon ?? "",
        ["girisTarihi"] = k.GirisTarihi?.ToString("dd.MM.yyyy") ?? "",
        ["cikisTarihi"] = k.CikisTarihi?.ToString("dd.MM.yyyy") ?? "",
        ["cikisSebebi"] = k.CikisSebebi ?? "",
        ["ucret"] = k.Ucret?.ToString("0.##") ?? "",
        ["sakatDerece"] = k.SakatDerece.ToString()
    };

    private static string Kirp(string d) =>
        string.IsNullOrWhiteSpace(d) ? null
        : d.Length > 290 ? d[..290] : d;
}

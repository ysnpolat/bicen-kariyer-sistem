using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin gün sayısı hesabı.
///
/// <para>
/// Yıllık izin bakiyesinden yalnızca gerçekten çalışılacak günler
/// düşülmeli. Önceden çıkış ile dönüş arasındaki bütün takvim günleri
/// sayılıyordu: 1 Mayıs'a ya da kurban bayramına denk gelen bir izin,
/// personelin bakiyesinden hak etmediği günler yiyordu. Haftalık izin
/// günleri de aynı şekilde düşüyordu — mağaza personelinin haftalık izni
/// yıllık izninden gidiyordu.
/// </para>
///
/// <para>
/// Hesap iki kaynağa bakıyor: <c>KRY_RESMI_TATIL</c> ve personelin
/// haftalık izin günü. Grup bulunamazsa hiçbir gün düşülmüyor — tanım
/// eksikken personelin aleyhine davranmak yanlış olurdu.
/// </para>
///
/// <para>
/// Haftalık izin günü (29.09.2026): mağaza personelinin izin günü pazar
/// değil, kişiden kişiye ve haftadan haftaya değişiyor. Sıra şöyle:
/// o haftanın vardiya planı varsa plandaki haftalık izin günü; plan yoksa
/// personelin onaylı sabit haftalık izin günü (<c>KRY_HAFTALIK_IZIN</c>);
/// o da yoksa pozisyon grubunun izin günleri (ofis personeli için pazar).
/// </para>
///
/// <para>
/// Cumartesi kuralı (03.10.2026): hesabın kendisi
/// <see cref="IzinGunuHesabi.Say"/> içinde; buradan mobil önizleme, talep
/// oluşturma ve panel gün hesabı aynı sonucu alıyor. İzin formu ve bakiye
/// talebe yazılan sayıyı kullandığı için onlar da aynı kuralla çalışıyor.
/// </para>
/// </summary>
public class IzinGunuServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly ILogger<IzinGunuServisi> _kayit;

    private static readonly JsonSerializerOptions JsonSecenek = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public IzinGunuServisi(VeritabaniServisi vt, ILogger<IzinGunuServisi> kayit)
    {
        _vt = vt;
        _kayit = kayit;
    }

    /* ==================================================================== */
    /* Kurallar                                                             */
    /* ==================================================================== */

    /// <summary>İzin kuralları; kayıt yoksa ya da okunamazsa varsayılanlar.</summary>
    public static IzinKuralAyari KuralOku(System.Data.IDbConnection db)
    {
        try
        {
            var json = db.ExecuteScalar<string>(
                "SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = IzinKuralAyari.Anahtar });

            if (string.IsNullOrWhiteSpace(json)) return new IzinKuralAyari();

            var ayar = JsonSerializer.Deserialize<IzinKuralAyari>(json, JsonSecenek) ?? new IzinKuralAyari();

            ayar.Cumartesi ??= new CumartesiKurali();
            ayar.Vardiya ??= new VardiyaKontrolKurali();
            ayar.CumartesiIzinliler ??= new List<string>();

            return ayar;
        }
        catch
        {
            return new IzinKuralAyari();
        }
    }

    public IzinKuralAyari KuralOku()
    {
        using var db = _vt.Baglanti();
        return KuralOku(db);
    }

    public void KuralYaz(IzinKuralAyari ayar)
    {
        var json = JsonSerializer.Serialize(ayar, JsonSecenek);

        using var db = _vt.Baglanti();

        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = IzinKuralAyari.Anahtar, d = json });
    }

    /* ==================================================================== */
    /* Gün hesabı                                                           */
    /* ==================================================================== */

    /// <summary>
    /// Çıkış ve dönüş tarihi arasında bakiyeden düşülecek gün sayısı.
    ///
    /// <para>
    /// Dönüş tarihi personelin işe döndüğü gün: o gün izinli sayılmaz.
    /// Aralık çıkıştan dönüşün bir öncesine kadar.
    /// </para>
    /// </summary>
    public IzinGunuHesabi.Sonuc Hesapla(string pozisyon, DateTime cikis, DateTime donus, string personelKodu = null)
    {
        var bas = cikis.Date;
        var bit = donus.Date.AddDays(-1);

        if (bit < bas) return new IzinGunuHesabi.Sonuc(0, 0, 0, 0, new List<string>());

        var takvim = (decimal)((bit - bas).Days + 1);

        /* Cumartesi kuralı aralığın son haftasının hafta sonuna bakıyor
           (cuma biten izinde ertesi cumartesi, pazarın izinli olup
           olmadığı): tanımlar o haftanın sonuna kadar okunuyor. */
        var okumaSonu = HaftaBasi(bit).AddDays(6);

        var tatiller = new Dictionary<DateTime, (string Ad, bool Yarim)>();
        var izinGunleri = new HashSet<DayOfWeek>();

        /* Kişiye özel haftalık izin: plan haftaları ve plandaki izin günleri */
        DayOfWeek? sabitGun = null;
        var planHaftalari = new HashSet<DateTime>();
        var planIzinGunleri = new HashSet<DateTime>();

        IzinKuralAyari kural;

        try
        {
            using var db = _vt.Baglanti();

            foreach (var t in db.Query(@"
SELECT tarih, ad, yarim_gun AS yarimGun FROM KRY_RESMI_TATIL
WHERE aktif = 1 AND tarih BETWEEN @bas AND @bit", new { bas, bit = okumaSonu }))
            {
                tatiller[((DateTime)t.tarih).Date] = ((string)t.ad, (bool)t.yarimGun);
            }

            izinGunleri = GrupIzinGunleri(db, pozisyon);

            var kod = (personelKodu ?? "").Trim();

            if (kod.Length > 0)
            {
                var gunNo = db.ExecuteScalar<int?>(@"
SELECT TOP 1 gun FROM KRY_HAFTALIK_IZIN
WHERE personel_kodu = @kod AND gun IS NOT NULL AND durum = N'onaylandi'
ORDER BY id DESC", new { kod });

                if (gunNo is >= 0 and <= 6) sabitGun = (DayOfWeek)gunNo.Value;

                foreach (var r in db.Query(@"
SELECT gun, tur FROM KRY_VARDIYA_PLAN
WHERE personel_kodu = @kod AND gun BETWEEN @bas AND @son",
                             new { kod, bas = HaftaBasi(bas), son = okumaSonu }))
                {
                    var g = ((DateTime)r.gun).Date;

                    planHaftalari.Add(HaftaBasi(g));

                    if ((string)r.tur == "izin") planIzinGunleri.Add(g);
                }
            }

            kural = KuralOku(db);
        }
        catch (Exception hata)
        {
            /* Tanımlar okunamazsa eski davranışa dönülüyor: izin kaydının
               hiç açılamamasındansa takvim günü sayılsın. */
            _kayit.LogWarning(hata, "İzin günü hesabı için tanımlar okunamadı");

            return new IzinGunuHesabi.Sonuc(takvim, takvim, 0, 0, new List<string>());
        }

        /* Plan varsa plandaki izin günü, yoksa kişinin sabit günü,
           o da yoksa pozisyon grubunun günleri */
        bool HaftalikMi(DateTime g) =>
            planHaftalari.Contains(HaftaBasi(g))
                ? planIzinGunleri.Contains(g)
                : sabitGun.HasValue
                    ? g.DayOfWeek == sabitGun.Value
                    : izinGunleri.Contains(g.DayOfWeek);

        /* Cumartesisi izinli personel (Yönetim → İzin Kuralları): cumartesi
           her hafta pazar gibi haftalık izin; cumartesi kuralı uygulanmaz. */
        if (kural.CumartesiIzinliMi(personelKodu))
            return IzinGunuHesabi.Say(bas, bit, tatiller,
                g => g.DayOfWeek == DayOfWeek.Saturday || HaftalikMi(g), null);

        return IzinGunuHesabi.Say(bas, bit, tatiller, HaftalikMi, kural.Cumartesi);
    }

    /// <summary>Tarihin bulunduğu haftanın pazartesisi.</summary>
    private static DateTime HaftaBasi(DateTime g) => IzinGunuHesabi.HaftaBasi(g);

    /// <summary>
    /// Bir ünvanın bağlı olduğu grubun izin günleri.
    ///
    /// Ünvan birden çok grupta geçiyorsa ilk eşleşen alınıyor; gruplar
    /// çakışmayacak biçimde tanımlanmalı.
    /// </summary>
    public HashSet<DayOfWeek> GrupIzinGunleri(System.Data.IDbConnection db, string pozisyon)
    {
        var sonuc = new HashSet<DayOfWeek>();

        if (string.IsNullOrWhiteSpace(pozisyon)) return sonuc;

        var hedef = PersonelKaynagiServisi.MeslekAnahtari(pozisyon);

        foreach (var g in db.Query(@"
SELECT pozisyonlar, izin_gunleri AS izinGunleri
FROM KRY_POZISYON_GRUBU WHERE aktif = 1 ORDER BY sira, ad"))
        {
            var pozisyonlar = ((string)g.pozisyonlar ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            var uyuyor = pozisyonlar.Any(x =>
                PersonelKaynagiServisi.MeslekAnahtari(x) == hedef);

            if (!uyuyor) continue;

            foreach (var parca in ((string)g.izinGunleri ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (int.TryParse(parca, out var no) && no is >= 0 and <= 6)
                    sonuc.Add((DayOfWeek)no);
            }

            break;
        }

        return sonuc;
    }

    /* ==================================================================== */
    /* Vardiya planı denetimi (mobil izin talebi)                           */
    /* ==================================================================== */

    /// <summary>
    /// Vardiya planı denetiminin sonucu.
    /// </summary>
    /// <param name="Engel">Talep açılmamalı.</param>
    /// <param name="EksikGunler">Planı tanımlı olmayan günler.</param>
    /// <param name="Hata">Uygulamanın başlık olarak gösterdiği metin.</param>
    /// <param name="Ayrinti">Hangi günlerde plan olmadığı.</param>
    public sealed record VardiyaDenetimi(bool Engel, List<DateTime> EksikGunler, string Hata, string Ayrinti)
    {
        public static readonly VardiyaDenetimi Yok = new(false, new List<DateTime>(), null, null);
    }

    public const string VardiyaEksikMesaji =
        "İzin talep ettiğiniz tarihlerde vardiya planınız tanımlı değil. "
        + "Önce yöneticinizin vardiya planınızı tanımlaması gerekiyor.";

    /// <summary>Bu izin türü vardiya denetimine giriyor mu.</summary>
    public static bool DenetlenenTur(VardiyaKontrolKurali k, string tur)
    {
        var t = (tur ?? "").Trim();
        var turler = k?.Turler is { Count: > 0 } ? k.Turler : new List<string> { "Yıllık İzin" };

        return turler.Any(x => string.Equals((x ?? "").Trim(), t, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Talep edilen günlerde kişinin vardiya planı tanımlı mı.
    ///
    /// <para>
    /// "Tanımlı" (03.10.2026): aralıktaki her gün için planda bir satır
    /// olmalı — vardiya (sabahçı, akşamcı, aracı…) ya da haftalık izin.
    /// "Boş" işaretli gün tanımsız sayılıyor; yönetici günü boşaltmış
    /// demektir. Resmi tatil günleri ve onaylı tam gün izinli günler
    /// (yıllık, raporlu…) aranmıyor: bu günlere plan zaten yapılamıyor.
    /// Planın personele gönderilmiş olması aranmıyor; yöneticinin taslak
    /// olarak kurduğu plan da tanımlı sayılıyor.
    /// </para>
    /// </summary>
    /// <param name="birimSicilleri">
    /// Kişinin birimindeki personel; "planKullanan" kapsamında birimde plan
    /// olup olmadığına bakmak için. Boşsa yalnızca kişinin kendisi.
    /// </param>
    public VardiyaDenetimi VardiyaDenetle(PersonelKaydi kisi, string tur, DateTime ilk, DateTime son,
        IEnumerable<string> birimSicilleri = null)
    {
        if (kisi is null || string.IsNullOrWhiteSpace(kisi.PersonelKodu)) return VardiyaDenetimi.Yok;

        var bas = ilk.Date;
        var bit = son.Date;

        if (bit < bas) return VardiyaDenetimi.Yok;

        try
        {
            using var db = _vt.Baglanti();

            var k = KuralOku(db).Vardiya;

            if (k is not { Acik: true }) return VardiyaDenetimi.Yok;

            /* tur null: önizleme türü bilmiyor; denetim yine yapılıyor,
               sonucu uygulama türe göre gösterir. */
            if (tur is not null && !DenetlenenTur(k, tur)) return VardiyaDenetimi.Yok;

            var birim = (kisi.IsGrubu ?? "").Trim();

            bool Eslesir(IEnumerable<string> liste) =>
                (liste ?? Enumerable.Empty<string>()).Any(x =>
                    !string.IsNullOrWhiteSpace(x)
                    && (string.Equals(x.Trim(), birim, StringComparison.OrdinalIgnoreCase)
                        || PersonelKaynagiServisi.Benziyor(x.Trim(), birim)));

            if (birim.Length > 0 && Eslesir(k.MuafBirimler)) return VardiyaDenetimi.Yok;

            var kod = kisi.PersonelKodu.Trim();

            switch ((k.Kapsam ?? "hepsi").Trim())
            {
                case "secili":
                    if (!Eslesir(k.Birimler)) return VardiyaDenetimi.Yok;
                    break;

                case "planKullanan":
                {
                    var kodlar = (birimSicilleri ?? Enumerable.Empty<string>())
                        .Select(x => (x ?? "").Trim())
                        .Where(x => x.Length > 0)
                        .Append(kod)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();

                    var kullaniyor = false;

                    foreach (var parca in kodlar.Chunk(500))
                    {
                        kullaniyor = db.ExecuteScalar<int>(@"
SELECT CASE WHEN EXISTS (
    SELECT 1 FROM KRY_VARDIYA_PLAN
    WHERE gun >= @sinir AND personel_kodu IN @parca AND tur IN (N'vardiya', N'izin')
) THEN 1 ELSE 0 END", new { sinir = DateTime.Today.AddDays(-60), parca }) == 1;

                        if (kullaniyor) break;
                    }

                    if (!kullaniyor) return VardiyaDenetimi.Yok;
                    break;
                }
            }

            var tanimli = db.Query<DateTime>(@"
SELECT gun FROM KRY_VARDIYA_PLAN
WHERE personel_kodu = @kod AND gun BETWEEN @bas AND @bit AND tur IN (N'vardiya', N'izin')",
                    new { kod, bas, bit })
                .Select(x => x.Date)
                .ToHashSet();

            var tatiller = db.Query<DateTime>(@"
SELECT tarih FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih BETWEEN @bas AND @bit",
                    new { bas, bit })
                .Select(x => x.Date)
                .ToHashSet();

            /* Onaylı tam gün izin (kısmi değil): plan yapılamayan günler */
            var izinli = new HashSet<DateTime>();

            foreach (var a in db.Query(@"
SELECT cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son
FROM KRY_IZIN
WHERE personel_kodu = @kod AND iptal = 0
  AND (yarim_gun IS NULL OR yarim_gun = N'')
  AND (baslangic_saat IS NULL OR baslangic_saat = N'')
  AND cikis_tarihi <= @bit
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @bas", new { kod, bas, bit }))
            {
                for (var g = ((DateTime)a.bas).Date; g <= ((DateTime)a.son).Date; g = g.AddDays(1))
                    izinli.Add(g);
            }

            var eksik = new List<DateTime>();

            for (var g = bas; g <= bit; g = g.AddDays(1))
            {
                if (tanimli.Contains(g) || tatiller.Contains(g) || izinli.Contains(g)) continue;

                eksik.Add(g);
            }

            if (eksik.Count == 0) return VardiyaDenetimi.Yok;

            return new VardiyaDenetimi(true, eksik, VardiyaEksikMesaji, EksikAyrinti(eksik));
        }
        catch (Exception hata)
        {
            /* Denetim yapılamazsa talep engellenmiyor: tanım okunamadı diye
               personelin izin isteyememesi daha kötü sonuç. */
            _kayit.LogWarning(hata, "Vardiya planı denetimi yapılamadı");

            return VardiyaDenetimi.Yok;
        }
    }

    public const string SubeHaftasiMesaji =
        "Bu haftanın vardiya planı şubenizde henüz tamamlanmadığı için yıllık izin talebi oluşturamazsınız. "
        + "Yöneticiniz bu haftanın planını tamamlayınca (ileri tarihler için de) talep edebilirsiniz.";

    /// <summary>
    /// Şube haftası denetimi (07.10.2026): içinde bulunulan haftada
    /// personelin birimindeki herkesin planı tam mı.
    ///
    /// <para>
    /// "Tam": haftanın her günü için vardiya ya da haftalık izin satırı var;
    /// resmi tatil, onaylı tam gün izin ve personel kartındaki rapor günleri
    /// aranmıyor. Hafta içinde işe giren kişide giriş gününden öncesi
    /// aranmıyor. Talep edilen tarih ileride olsa da denetlenen hafta bu
    /// hafta: kural personelin yöneticisini haftalık planı zamanında
    /// girmeye zorluyor. Kural ve kapsam İzin Kuralları'ndaki vardiya
    /// denetimiyle aynı (kapalıysa ya da birim muafsa denetlenmiyor).
    /// Denetim yapılamazsa talep engellenmiyor.
    /// </para>
    /// </summary>
    public VardiyaDenetimi SubeHaftaDenetle(PersonelKaydi kisi, string tur, IEnumerable<PersonelKaydi> birimdekiler,
        DateTime? bugun = null)
    {
        if (kisi is null || string.IsNullOrWhiteSpace(kisi.PersonelKodu)) return VardiyaDenetimi.Yok;

        try
        {
            using var db = _vt.Baglanti();

            var k = KuralOku(db).Vardiya;

            if (k is not { Acik: true, SubeHaftasi: true }) return VardiyaDenetimi.Yok;
            if (tur is not null && !DenetlenenTur(k, tur)) return VardiyaDenetimi.Yok;

            var birim = (kisi.IsGrubu ?? "").Trim();

            if (birim.Length == 0) return VardiyaDenetimi.Yok;

            bool Eslesir(IEnumerable<string> liste) =>
                (liste ?? Enumerable.Empty<string>()).Any(x =>
                    !string.IsNullOrWhiteSpace(x)
                    && (string.Equals(x.Trim(), birim, StringComparison.OrdinalIgnoreCase)
                        || PersonelKaynagiServisi.Benziyor(x.Trim(), birim)));

            if (Eslesir(k.MuafBirimler)) return VardiyaDenetimi.Yok;
            if ((k.Kapsam ?? "") == "secili" && !Eslesir(k.Birimler)) return VardiyaDenetimi.Yok;

            var kisiler = (birimdekiler ?? Enumerable.Empty<PersonelKaydi>())
                .Append(kisi)
                .Where(x => !string.IsNullOrWhiteSpace(x?.PersonelKodu))
                .GroupBy(x => x.PersonelKodu.Trim(), StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .ToList();

            var kodlar = kisiler.Select(x => x.PersonelKodu.Trim()).ToList();

            var gun0 = (bugun ?? DateTime.Today).Date;
            var hafta = gun0.AddDays(-(((int)gun0.DayOfWeek + 6) % 7));
            var haftaSon = hafta.AddDays(6);

            /* Birim planı hiç kullanmıyorsa (genel merkez gibi) denetlenmiyor */
            if ((k.Kapsam ?? "planKullanan") != "hepsi")
            {
                var kullaniyor = false;

                foreach (var parca in kodlar.Chunk(500))
                {
                    kullaniyor = db.ExecuteScalar<int>(@"
SELECT CASE WHEN EXISTS (
    SELECT 1 FROM KRY_VARDIYA_PLAN
    WHERE gun >= @sinir AND personel_kodu IN @parca AND tur IN (N'vardiya', N'izin')
) THEN 1 ELSE 0 END", new { sinir = gun0.AddDays(-60), parca }) == 1;

                    if (kullaniyor) break;
                }

                if (!kullaniyor) return VardiyaDenetimi.Yok;
            }

            /* Haftanın tanımlı günleri, kişi kişi */
            var tanimli = new Dictionary<string, HashSet<DateTime>>(StringComparer.OrdinalIgnoreCase);

            void Ekle(string kod, DateTime g)
            {
                kod = (kod ?? "").Trim();
                if (!tanimli.TryGetValue(kod, out var h)) tanimli[kod] = h = new HashSet<DateTime>();
                h.Add(g.Date);
            }

            foreach (var parca in kodlar.Chunk(500))
            {
                foreach (var r in db.Query(@"
SELECT personel_kodu AS kod, gun FROM KRY_VARDIYA_PLAN
WHERE gun BETWEEN @hafta AND @haftaSon AND personel_kodu IN @parca AND tur IN (N'vardiya', N'izin')",
                             new { hafta, haftaSon, parca }))
                    Ekle((string)r.kod, (DateTime)r.gun);

                /* Onaylı tam gün izinler */
                foreach (var a in db.Query(@"
SELECT personel_kodu AS kod, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son
FROM KRY_IZIN
WHERE iptal = 0 AND personel_kodu IN @parca
  AND (yarim_gun IS NULL OR yarim_gun = N'')
  AND (baslangic_saat IS NULL OR baslangic_saat = N'')
  AND cikis_tarihi <= @haftaSon
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @hafta", new { hafta, haftaSon, parca }))
                {
                    for (var g = ((DateTime)a.bas).Date; g <= ((DateTime)a.son).Date; g = g.AddDays(1))
                        Ekle((string)a.kod, g);
                }

                /* Personel kartındaki raporlar */
                try
                {
                    foreach (var r in db.Query(@"
SELECT LTRIM(RTRIM(personel_kodu)) AS kod, baslangic AS bas, bitis AS son
FROM KRY_PERSONEL_RAPOR
WHERE iptal = 0 AND personel_kodu IN @parca AND baslangic <= @haftaSon AND bitis >= @hafta",
                                 new { hafta, haftaSon, parca }))
                    {
                        for (var g = ((DateTime)r.bas).Date; g <= ((DateTime)r.son).Date; g = g.AddDays(1))
                            Ekle((string)r.kod, g);
                    }
                }
                catch
                {
                    /* Rapor tablosu yoksa geçilir */
                }
            }

            var tatiller = db.Query<DateTime>(@"
SELECT tarih FROM KRY_RESMI_TATIL WHERE aktif = 1 AND tarih BETWEEN @hafta AND @haftaSon",
                    new { hafta, haftaSon })
                .Select(x => x.Date)
                .ToHashSet();

            var eksikler = new List<(string Ad, int Gun)>();

            foreach (var p in kisiler)
            {
                var kod = p.PersonelKodu.Trim();
                tanimli.TryGetValue(kod, out var dolu);

                var ilkGun = p.GirisTarihi is DateTime gt && gt.Date > hafta ? gt.Date : hafta;
                var eksik = 0;

                for (var g = ilkGun; g <= haftaSon; g = g.AddDays(1))
                {
                    if (tatiller.Contains(g)) continue;
                    if (dolu is not null && dolu.Contains(g)) continue;
                    eksik++;
                }

                if (eksik > 0) eksikler.Add(($"{p.Ad} {p.Soyad}".Trim(), eksik));
            }

            if (eksikler.Count == 0) return VardiyaDenetimi.Yok;

            var sirali = eksikler.OrderByDescending(x => x.Gun).ThenBy(x => x.Ad).ToList();
            var adlar = string.Join(", ", sirali.Take(5).Select(x => $"{x.Ad} ({x.Gun} gün)"));
            if (sirali.Count > 5) adlar += $" ve {sirali.Count - 5} kişi daha";

            var ayrinti = $"{hafta:dd.MM} – {haftaSon:dd.MM} haftasında planı eksik olan {sirali.Count} kişi: {adlar}.";

            return new VardiyaDenetimi(true, new List<DateTime>(), SubeHaftasiMesaji, ayrinti);
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Şube haftası denetimi yapılamadı");
            return VardiyaDenetimi.Yok;
        }
    }

    /// <summary>"Planı olmayan günler: 12.10 Pzt, 13.10 Sal … (9 gün)"</summary>
    public static string EksikAyrinti(List<DateTime> eksik)
    {
        if (eksik is not { Count: > 0 }) return null;

        string[] kisa = { "Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt" };

        /* Ardışık günler aralık olarak: "12.10 Pzt – 16.10 Cum" */
        var parcalar = new List<string>();
        var i = 0;

        while (i < eksik.Count)
        {
            var j = i;

            while (j + 1 < eksik.Count && eksik[j + 1] == eksik[j].AddDays(1)) j++;

            var a = eksik[i];
            var b = eksik[j];

            parcalar.Add(i == j
                ? $"{a:dd.MM} {kisa[(int)a.DayOfWeek]}"
                : $"{a:dd.MM} {kisa[(int)a.DayOfWeek]} – {b:dd.MM} {kisa[(int)b.DayOfWeek]}");

            i = j + 1;
        }

        var liste = parcalar.Count > 4
            ? string.Join(", ", parcalar.Take(4)) + $" ve {parcalar.Count - 4} aralık daha"
            : string.Join(", ", parcalar);

        return $"Planı olmayan günler: {liste} ({eksik.Count} gün). "
               + "Planınız tanımlandıktan sonra talebinizi yeniden gönderebilirsiniz.";
    }
}

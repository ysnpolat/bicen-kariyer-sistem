using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Vardiya okutma kuralları (03.10.2026).
///
/// <para>
/// Okutma ucu sıcak: her vardiya giriş-çıkışında çağrılıyor. Kurallar,
/// özel konumlar ve yarıçap ayarları kısa süreli (90 saniye) bellekte
/// tutuluyor; panelden yapılan her değişiklik önbelleği hemen boşaltıyor.
/// Tablolar henüz kurulmamışsa ya da okunamıyorsa eski davranış sürüyor:
/// kural yok, yarıçap 150 metre.
/// </para>
///
/// <para>
/// Üç kural türü var:
/// <list type="bullet">
/// <item><b>saha</b> — her şubenin karekodunu okutabilir (mesafe denetimi
/// okutulan yere göre yine yapılır).</item>
/// <item><b>konum</b> — Hal gibi özel konum personeli; yalnızca kendisine
/// atanmış özel konum(lar)da, isteğe bağlı olarak kendi şubesinde de
/// okutabilir.</item>
/// <item><b>muaf</b> — okutma beklenmez; raporlarda "okutmadı" yerine
/// "Muaf" görünür. Okutursa kayıt normal düşer.</item>
/// </list>
/// </para>
///
/// <para>
/// Mobil uygulama (Biçen360) değişmedi: uygulama karekodu ve konumu
/// gönderiyor, bütün kurallar sunucuda uygulanıyor.
/// </para>
/// </summary>
public static class OkutmaKurallari
{
    public const string Saha = "saha";
    public const string KonumTuru = "konum";
    public const string Muaf = "muaf";

    /// <summary>
    /// Her yerden (21.10.2026): kendi şubesinde normal okutur; ayrıca tek bir
    /// "her yerden karekodu"nu konum sınırı olmadan okutabilir.
    /// </summary>
    public const string Serbest = "serbest";

    /// <summary>KRY_AYARLAR: her yerden karekodunun metni</summary>
    public const string AyarSerbestKod = "okutmaSerbestKod";

    /// <summary>Her yerden okutmalarında KRY_VARDIYA.sube_kodu</summary>
    public const string SerbestSubeKodu = "SERBEST";

    /// <summary>Kod tanımlı değilse geçerli olan sınır.</summary>
    public const int VarsayilanSinir = 150;

    /// <summary>KRY_AYARLAR anahtarları</summary>
    public const string AyarYaricap = "okutmaYaricap";
    public const string AyarKendiSube = "okutmaKendiSube";

    /// <summary>Özel konum okutmalarında KRY_VARDIYA.sube_kodu öneki.</summary>
    public const string KonumOneki = "KONUM:";

    private static readonly TimeSpan Omur = TimeSpan.FromSeconds(90);

    public sealed record Kural(
        int Id, string PersonelKodu, string AdSoyad, string Sube, string Tur,
        bool KendiSubesi, DateTime? Baslangic, DateTime? Bitis, string Aciklama,
        IReadOnlyList<int> KonumIdleri)
    {
        /// <summary>Kural verilen günde geçerli mi</summary>
        public bool Gecerli(DateTime gun) =>
            (Baslangic is null || Baslangic.Value.Date <= gun.Date)
            && (Bitis is null || Bitis.Value.Date >= gun.Date);
    }

    public sealed record Konum(
        int Id, string Ad, double Enlem, double Boylam, int? Yaricap, string QrKod, bool Aktif);

    private sealed class Onbellek
    {
        public DateTime Zaman;
        public int VarsayilanYaricap = VarsayilanSinir;
        public bool KendiSubeZorunlu;
        public string SerbestKod;
        public Dictionary<string, Kural> Kurallar = new(StringComparer.OrdinalIgnoreCase);
        public List<Konum> Konumlar = new();
        public Dictionary<string, Konum> KonumQr = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, int> SubeYaricap = new(StringComparer.OrdinalIgnoreCase);
    }

    private static Onbellek _onbellek;
    private static readonly object _kilit = new();

    /// <summary>Panelden değişiklik yapıldığında çağrılır.</summary>
    public static void Temizle()
    {
        lock (_kilit) _onbellek = null;
    }

    /// <summary>Personel kodunu karşılaştırılabilir hâle getirir ("00123" = "123").</summary>
    public static string Anahtar(string kod)
    {
        var t = (kod ?? "").Trim();
        var s = t.TrimStart('0');
        return s.Length == 0 ? t : s;
    }

    private static Onbellek Al(VeritabaniServisi vt)
    {
        var o = _onbellek;

        if (o is not null && DateTime.UtcNow - o.Zaman < Omur) return o;

        lock (_kilit)
        {
            o = _onbellek;
            if (o is not null && DateTime.UtcNow - o.Zaman < Omur) return o;

            o = Yukle(vt);
            _onbellek = o;
            return o;
        }
    }

    private static Onbellek Yukle(VeritabaniServisi vt)
    {
        var o = new Onbellek { Zaman = DateTime.UtcNow };

        try
        {
            using var db = vt.Baglanti();

            var ayarlar = db.Query(@"
SELECT anahtar, deger FROM KRY_AYARLAR WHERE anahtar IN (@a1, @a2, @a3)",
                    new { a1 = AyarYaricap, a2 = AyarKendiSube, a3 = AyarSerbestKod })
                .ToDictionary(x => (string)x.anahtar, x => (string)x.deger, StringComparer.OrdinalIgnoreCase);

            if (ayarlar.TryGetValue(AyarYaricap, out var y) && int.TryParse(y, out var yi) && yi >= 10)
                o.VarsayilanYaricap = yi;

            o.KendiSubeZorunlu = ayarlar.TryGetValue(AyarKendiSube, out var k) && k == "1";
            o.SerbestKod = ayarlar.TryGetValue(AyarSerbestKod, out var sk) && !string.IsNullOrWhiteSpace(sk) ? sk.Trim() : null;

            var baglar = db.Query("SELECT kural_id AS kuralId, konum_id AS konumId FROM KRY_OKUTMA_KURAL_KONUM")
                .GroupBy(x => (int)x.kuralId)
                .ToDictionary(g => g.Key, g => (IReadOnlyList<int>)g.Select(x => (int)x.konumId).ToList());

            foreach (var r in db.Query(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, sube, tur, kendi_subesi AS kendiSubesi,
       baslangic, bitis, aciklama
FROM KRY_OKUTMA_KURAL"))
            {
                var kural = new Kural(
                    (int)r.id, ((string)r.kod ?? "").Trim(), (string)r.adSoyad, (string)r.sube,
                    ((string)r.tur ?? "").Trim().ToLowerInvariant(), (bool)r.kendiSubesi,
                    (DateTime?)r.baslangic, (DateTime?)r.bitis, (string)r.aciklama,
                    baglar.GetValueOrDefault((int)r.id) ?? Array.Empty<int>());

                o.Kurallar[Anahtar(kural.PersonelKodu)] = kural;
            }

            o.Konumlar = db.Query(@"
SELECT id, ad, enlem, boylam, yaricap_metre AS yaricap, qr_kod AS qrKod, aktif
FROM KRY_OKUTMA_KONUM")
                .Select(x => new Konum((int)x.id, (string)x.ad, (double)x.enlem, (double)x.boylam,
                    (int?)x.yaricap, ((string)x.qrKod ?? "").Trim().ToLowerInvariant(), (bool)x.aktif))
                .ToList();

            foreach (var k2 in o.Konumlar.Where(x => x.QrKod.Length > 0))
                o.KonumQr[k2.QrKod] = k2;

            foreach (var s in db.Query("SELECT sube_kodu AS kod, yaricap_metre AS y FROM KRY_OKUTMA_KONUM_AYAR"))
                o.SubeYaricap[((string)s.kod ?? "").Trim()] = (int)s.y;
        }
        catch
        {
            /* Tablolar yoksa eski davranış: kural yok, 150 metre */
        }

        return o;
    }

    /* ==================================================================== */
    /* Sorgular                                                              */
    /* ==================================================================== */

    public static int VarsayilanYaricap(VeritabaniServisi vt) => Al(vt).VarsayilanYaricap;

    public static bool KendiSubeZorunlu(VeritabaniServisi vt) => Al(vt).KendiSubeZorunlu;

    /// <summary>Tanımlı her yerden karekodu (yoksa null).</summary>
    public static string SerbestKod(VeritabaniServisi vt) => Al(vt).SerbestKod;

    /// <summary>Okunan metin her yerden karekodu mu</summary>
    public static bool SerbestKodMu(VeritabaniServisi vt, string okunan)
    {
        var k = Al(vt).SerbestKod;
        return k is not null && string.Equals((okunan ?? "").Trim(), k, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Şubenin geçerli yarıçapı: şubeye özel değer, yoksa genel ayar.</summary>
    public static int SubeYaricapi(VeritabaniServisi vt, string subeKodu)
    {
        var o = Al(vt);
        return o.SubeYaricap.TryGetValue((subeKodu ?? "").Trim(), out var y) ? y : o.VarsayilanYaricap;
    }

    /// <summary>Özel konumun geçerli yarıçapı.</summary>
    public static int KonumYaricapi(VeritabaniServisi vt, Konum k) =>
        k?.Yaricap ?? Al(vt).VarsayilanYaricap;

    /// <summary>Kişinin o gün geçerli kuralı; yoksa null.</summary>
    public static Kural KuralBul(VeritabaniServisi vt, string personelKodu, DateTime gun)
    {
        var k = Al(vt).Kurallar.GetValueOrDefault(Anahtar(personelKodu));
        return k is not null && k.Gecerli(gun) ? k : null;
    }

    /// <summary>Kişi o gün okutmadan muaf mı.</summary>
    public static bool MuafMi(VeritabaniServisi vt, string personelKodu, DateTime gun) =>
        KuralBul(vt, personelKodu, gun)?.Tur == Muaf;

    /// <summary>
    /// Aralığın TAMAMINDA muaf olan personelin kodları (Anahtar biçiminde).
    /// Aralığın bir günü bile muafiyet dışındaysa kişi okutma beklenen
    /// sayılır; "izinli olmayanlar" süzgeciyle aynı mantık.
    /// </summary>
    public static HashSet<string> MuafKodlari(VeritabaniServisi vt, DateTime bas, DateTime bit)
    {
        if (bit < bas) (bas, bit) = (bit, bas);

        return Al(vt).Kurallar.Values
            .Where(k => k.Tur == Muaf
                        && (k.Baslangic is null || k.Baslangic.Value.Date <= bas.Date)
                        && (k.Bitis is null || k.Bitis.Value.Date >= bit.Date))
            .Select(k => Anahtar(k.PersonelKodu))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Okunan metindeki GUID'e karşılık gelen özel konum (pasifler dahil).</summary>
    public static Konum KonumBul(VeritabaniServisi vt, string okunan)
    {
        var m = System.Text.RegularExpressions.Regex.Match(okunan ?? "",
            @"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

        if (!m.Success) return null;

        return Al(vt).KonumQr.GetValueOrDefault(m.Value.ToLowerInvariant());
    }

    public static Konum KonumGetir(VeritabaniServisi vt, int id) =>
        Al(vt).Konumlar.FirstOrDefault(x => x.Id == id);

    /* ==================================================================== */
    /* Yetki kararı                                                          */
    /* ==================================================================== */

    public sealed record Karar(bool Izin, string Hata = null, string Ayrinti = null, string Sebep = null);

    /// <summary>
    /// Personel kayıtlı şubesinde mi okutuyor. Mikro'daki iş grubu adı ve
    /// "Personel Eşleştirmeleri"ndeki elle tanımlı karşılıklar dikkate
    /// alınıyor.
    /// </summary>
    public static bool KendiSubesiMi(PersonelAyarlari ayar, PersonelKaydi p, string subeKodu, string subeAdi)
    {
        if (p is null) return false;

        foreach (var birim in new[] { p.IsGrubu, p.Sube })
        {
            if (string.IsNullOrWhiteSpace(birim)) continue;

            if (PersonelKaynagiServisi.SubeUyuyor(ayar, birim, subeAdi ?? "", subeKodu)) return true;

            if (!string.IsNullOrWhiteSpace(subeKodu) &&
                string.Equals(birim.Trim(), subeKodu.Trim(), StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    /// <summary>Personelin şubesi tanımlı şubelerden birine eşleşiyor mu.</summary>
    public static bool SubesiBelli(PersonelAyarlari ayar, IEnumerable<Sube> subeler, PersonelKaydi p) =>
        (subeler ?? Enumerable.Empty<Sube>())
            .Any(s => !string.IsNullOrWhiteSpace(s.Kod) && KendiSubesiMi(ayar, p, s.Kod, s.Ad));

    /// <summary>
    /// Personel bu yerde okutabilir mi. Mesafe denetimi bundan sonra ayrıca
    /// yapılır (konum kuralları yeri, mesafe sınırı yakınlığı belirler).
    /// </summary>
    /// <param name="ozel">Okutulan özel konum; şube karekodunda null.</param>
    /// <param name="personelAyarOku">Yalnızca şube eşleştirmesi gerektiğinde okunur (sıcak uç).</param>
    public static Karar YetkiDenetle(
        VeritabaniServisi vt, Func<PersonelAyarlari> personelAyarOku, Func<IEnumerable<Sube>> subelerOku,
        PersonelKaydi p, string subeKodu, string subeAdi, Konum ozel, DateTime gun)
    {
        var kural = KuralBul(vt, p?.PersonelKodu, gun);

        PersonelAyarlari personelAyar = null;
        PersonelAyarlari PersonelAyar() => personelAyar ??= personelAyarOku?.Invoke() ?? new PersonelAyarlari();

        string KonumAdlari() =>
            kural is null ? "" : string.Join(", ", kural.KonumIdleri
                .Select(id => KonumGetir(vt, id))
                .Where(x => x is not null && x.Aktif)
                .Select(x => x.Ad));

        /* ------------------------------------------------ özel konum */
        if (ozel is not null)
        {
            if (kural?.Tur == Saha) return new Karar(true);

            if (kural?.Tur == KonumTuru && kural.KonumIdleri.Contains(ozel.Id)) return new Karar(true);

            return new Karar(false,
                "Bu konumda okutma yetkiniz yok.",
                $"{ozel.Ad} karekodu yalnızca bu konuma tanımlanmış personel içindir. "
                + (kural?.Tur == KonumTuru && KonumAdlari().Length > 0
                    ? $"Okutmanızı {KonumAdlari()} konumunda yapınız."
                    : "Okutmanızı kendi şubenizde yapınız."),
                "yetki");
        }

        /* ------------------------------------------------ şube karekodu */
        if (kural?.Tur == Saha) return new Karar(true);

        if (kural?.Tur == KonumTuru)
        {
            if (kural.KendiSubesi && KendiSubesiMi(PersonelAyar(), p, subeKodu, subeAdi))
                return new Karar(true);

            var adlar = KonumAdlari();

            return new Karar(false,
                "Bu şubede okutma yetkiniz yok.",
                adlar.Length > 0
                    ? $"Vardiya okutmanızı {adlar} konumunda yapmanız tanımlanmış."
                    : "Okutma konumunuz İnsan Kaynakları tarafından tanımlanmış. Bilgi için İK ile görüşünüz.",
                "yetki");
        }

        /* Kural yok ya da muaf: genel ayar açıksa yalnızca kendi şubesi.
           Personelin şubesi tanımlı şubelerden hiçbirine eşleşmiyorsa
           (genel müdürlük gibi) denetim yapılamıyor ve okutma geçiyor;
           aksi hâlde bu kişiler hiçbir yerde okutamazdı. */
        if (KendiSubeZorunlu(vt)
            && !KendiSubesiMi(PersonelAyar(), p, subeKodu, subeAdi)
            && SubesiBelli(PersonelAyar(), subelerOku?.Invoke(), p))
        {
            return new Karar(false,
                "Kendi şubeniz dışında okutma yapamazsınız.",
                $"Okuttuğunuz karekod {subeAdi} şubesine ait; kayıtlı şubeniz {p.IsGrubu ?? p.Sube}. "
                + "Başka şubede çalışıyorsanız İnsan Kaynakları'na bildiriniz.",
                "sube");
        }

        return new Karar(true);
    }

    /* ==================================================================== */
    /* Kayıtlar                                                              */
    /* ==================================================================== */

    /// <summary>Reddedilen okutmayı kaydeder; hata okutma akışını etkilemez.</summary>
    public static void RedYaz(VeritabaniServisi vt, PersonelKaydi p, string yerKodu, string yerAdi,
        string sebep, int? mesafe, int? sinir, double? enlem, double? boylam, string ayrinti = null)
    {
        try
        {
            using var db = vt.Baglanti();

            db.Execute(@"
INSERT INTO KRY_OKUTMA_RED
    (personel_kodu, ad_soyad, sube, yer_kodu, yer_adi, sebep, mesafe_metre, sinir_metre, enlem, boylam, ayrinti)
VALUES (@kod, @adSoyad, @sube, @yerKodu, @yerAdi, @sebep, @mesafe, @sinir, @enlem, @boylam, @ayrinti)",
                new
                {
                    kod = (p?.PersonelKodu ?? "").Trim(),
                    adSoyad = $"{p?.Ad} {p?.Soyad}".Trim(),
                    sube = p?.IsGrubu ?? p?.Sube,
                    yerKodu = yerKodu?.Length > 60 ? yerKodu[..60] : yerKodu,
                    yerAdi = yerAdi?.Length > 120 ? yerAdi[..120] : yerAdi,
                    sebep,
                    mesafe,
                    sinir,
                    enlem,
                    boylam,
                    ayrinti = ayrinti?.Length > 300 ? ayrinti[..300] : ayrinti
                });
        }
        catch
        {
            /* Tablo yoksa ya da yazılamazsa okutma cevabı yine döner */
        }
    }

    /// <summary>Kural ve ayar değişikliklerinin denetim kaydı.</summary>
    public static void GunlukYaz(System.Data.IDbConnection db, string islem, string personelKodu,
        string adSoyad, string ayrinti, string yapan)
    {
        try
        {
            db.Execute(@"
INSERT INTO KRY_OKUTMA_KURAL_GUNLUK (islem, personel_kodu, ad_soyad, ayrinti, yapan)
VALUES (@islem, @personelKodu, @adSoyad, @ayrinti, @yapan)",
                new
                {
                    islem,
                    personelKodu,
                    adSoyad,
                    ayrinti = ayrinti?.Length > 1000 ? ayrinti[..1000] : ayrinti,
                    yapan
                });
        }
        catch
        {
            /* Denetim kaydı yazılamazsa asıl işlem geri alınmıyor */
        }
    }
}

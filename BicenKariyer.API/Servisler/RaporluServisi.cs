using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Raporlu personel (03.10.2026).
///
/// <para>
/// Bir personel bir günde iki kaynaktan raporlu sayılır:
/// <list type="bullet">
/// <item>Personel kartından girilen sağlık raporları (KRY_PERSONEL_RAPOR,
/// iptal edilmemiş).</item>
/// <item>Türünde "Rapor" geçen izinler: onaylanan "Hastalık İzni (Rapor)"
/// talepleri izin kaydına (KRY_IZIN) dönüşüyor; İK'nın elle girdiği rapor
/// izinleri de orada. Onaylanmış ama izin kaydı oluşmamış talepler de
/// ayrıca okunuyor.</item>
/// </list>
/// Aynı kişi iki kaynakta da varsa tek kişi sayılır.
/// </para>
///
/// <para>
/// Personel listesi, norm kadro raporları ve okutma ekranları aynı günü
/// arka arkaya soruyor; sonuç gün başına kısa süre (60 saniye) bellekte
/// tutuluyor. Rapor eklenince ya da değişince önbellek hemen boşaltılıyor.
/// Tablo henüz kurulmamışsa ya da okunamıyorsa kimse raporlu sayılmaz:
/// ekranlar eski hâliyle çalışmaya devam eder.
/// </para>
///
/// <para>
/// Raporlu personel "mevcut"tan düşülmez. Engelli sütunu gibi bilgi
/// amaçlıdır: kişi kadroda, yalnızca o gün çalışmıyor.
/// </para>
/// </summary>
public class RaporluServisi
{
    /// <summary>Kaynak adları</summary>
    public const string KaynakRapor = "rapor";
    public const string KaynakIzin = "izin";
    public const string KaynakTalep = "talep";

    /// <summary>Okutma ekranlarında kullanılan etiket</summary>
    public const string Etiket = "Raporlu";

    /// <summary>Rapor türleri</summary>
    /// <para>Ayarlar Merkezi › Seçenek listeleri (raporTurleri).</para>
    public static string[] Turler => SecenekListesi.Acik("raporTurleri");

    /// <summary>Bir rapor kaydı (her iki kaynaktan)</summary>
    public sealed record Kayit(
        int Id, string PersonelKodu, DateTime Baslangic, DateTime Bitis, string Tur, string Kaynak)
    {
        public bool Kapsar(DateTime gun) => Baslangic.Date <= gun.Date && Bitis.Date >= gun.Date;
    }

    /// <summary>
    /// Kişinin o gün raporlu olduğu bilgisi. <see cref="Bitis"/> art arda
    /// gelen raporlar birleştirilerek bulunur: 1–5 ve 6–10 tarihli iki
    /// rapor varsa kişi "10'una kadar" raporludur.
    /// </summary>
    public sealed record Durum(
        string PersonelKodu, DateTime Baslangic, DateTime Bitis, string Tur, string Kaynak);

    private static readonly TimeSpan Omur = TimeSpan.FromSeconds(60);
    private static readonly object _kilit = new();
    private static readonly Dictionary<DateTime, (DateTime Zaman, Dictionary<string, Durum> Veri)> _onbellek = new();

    private readonly VeritabaniServisi _vt;

    public RaporluServisi(VeritabaniServisi vt) => _vt = vt;

    /// <summary>Rapor eklendiğinde, değiştiğinde ya da kaldırıldığında</summary>
    public static void Temizle()
    {
        lock (_kilit) _onbellek.Clear();
    }

    /// <summary>Personel kodunu karşılaştırılabilir hâle getirir ("00123" = "123").</summary>
    public static string Anahtar(string kod) => OkutmaKurallari.Anahtar(kod);

    /* ==================================================================== */
    /* Gün                                                                   */
    /* ==================================================================== */

    /// <summary>
    /// Verilen günde raporlu olan personel: anahtar (<see cref="Anahtar"/>)
    /// → durum. Okunamazsa boş sözlük.
    /// </summary>
    public IReadOnlyDictionary<string, Durum> Bugun(DateTime gun)
    {
        gun = gun.Date;

        lock (_kilit)
        {
            if (_onbellek.TryGetValue(gun, out var o) && DateTime.UtcNow - o.Zaman < Omur)
                return o.Veri;
        }

        var veri = Hesapla(gun);

        lock (_kilit)
        {
            /* Birkaç günden fazlası tutulmuyor: rapor tarihi seçicisi her
               gün için ayrı kayıt bırakıp belleği şişirmesin. */
            if (_onbellek.Count > 8) _onbellek.Clear();

            _onbellek[gun] = (DateTime.UtcNow, veri);
        }

        return veri;
    }

    /// <summary>Verilen günde raporlu personelin kodları (Anahtar biçiminde)</summary>
    public HashSet<string> Kodlar(DateTime gun) =>
        Bugun(gun).Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>Kişi o gün raporlu mu</summary>
    public bool RaporluMu(string personelKodu, DateTime gun) =>
        Bugun(gun).ContainsKey(Anahtar(personelKodu));

    /// <summary>Kişinin o günkü rapor durumu; raporlu değilse null</summary>
    public Durum Bul(string personelKodu, DateTime gun) =>
        Bugun(gun).GetValueOrDefault(Anahtar(personelKodu));

    private Dictionary<string, Durum> Hesapla(DateTime gun)
    {
        var sonuc = new Dictionary<string, Durum>(StringComparer.OrdinalIgnoreCase);

        /* Bitişi bugünden önce olmayan bütün kayıtlar: bugünü kapsayanlar
           ve art arda gelen sonraki raporlar (bitiş tarihini uzatmak için). */
        var kayitlar = Kayitlar(gun, DateTime.MaxValue.Date, izinDahil: true);

        foreach (var g in kayitlar.GroupBy(x => Anahtar(x.PersonelKodu), StringComparer.OrdinalIgnoreCase))
        {
            var bugunku = g.Where(x => x.Kapsar(gun)).ToList();

            if (bugunku.Count == 0) continue;

            /* Kendi rapor kaydı izinden önce gelir: türü daha açıklayıcı */
            var esas = bugunku
                .OrderBy(x => x.Kaynak == KaynakRapor ? 0 : 1)
                .ThenByDescending(x => x.Bitis)
                .First();

            var bas = bugunku.Min(x => x.Baslangic).Date;
            var bit = bugunku.Max(x => x.Bitis).Date;

            /* Art arda ya da üst üste binen sonraki raporlarla uzat */
            bool uzadi;

            do
            {
                uzadi = false;

                foreach (var k in g)
                {
                    if (k.Baslangic.Date <= bit.AddDays(1) && k.Bitis.Date > bit)
                    {
                        bit = k.Bitis.Date;
                        uzadi = true;
                    }
                }
            } while (uzadi);

            sonuc[g.Key] = new Durum(esas.PersonelKodu, bas, bit, esas.Tur, esas.Kaynak);
        }

        return sonuc;
    }

    /* ==================================================================== */
    /* Aralık                                                                */
    /* ==================================================================== */

    /// <summary>
    /// Aralıkla kesişen rapor kayıtları.
    /// </summary>
    /// <param name="izinDahil">
    /// Türünde "Rapor" geçen izinler de gelsin mi. Okutma çizelgesi izinleri
    /// zaten kendi tablosundan okuyor; orada yalnızca rapor kayıtları
    /// isteniyor.
    /// </param>
    public List<Kayit> Kayitlar(DateTime bas, DateTime bit, bool izinDahil = true)
    {
        if (bit < bas) (bas, bit) = (bit, bas);

        var liste = new List<Kayit>();

        try
        {
            using var db = _vt.Baglanti();

            liste.AddRange(db.Query(@"
SELECT id, personel_kodu AS kod, baslangic, bitis, rapor_turu AS tur
FROM KRY_PERSONEL_RAPOR
WHERE iptal = 0 AND baslangic <= @bit AND bitis >= @bas",
                    new { bas = bas.Date, bit = bit.Date })
                .Select(x => new Kayit((int)x.id, ((string)x.kod ?? "").Trim(),
                    (DateTime)x.baslangic, (DateTime)x.bitis, (string)x.tur, KaynakRapor)));
        }
        catch
        {
            /* Tablo yoksa yalnızca izin kaynağı */
        }

        if (!izinDahil) return liste;

        try
        {
            using var db = _vt.Baglanti();

            /* Son gün okutma ekranlarıyla aynı kuralla: işe başlama tarihi
               girilmişse ondan bir önceki gün, yoksa dönüş tarihi. */
            liste.AddRange(db.Query(@"
SELECT id, personel_kodu AS kod, cikis_tarihi AS bas,
       CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END AS son,
       tur
FROM KRY_IZIN
WHERE iptal = 0 AND tur LIKE N'%Rapor%'
  AND cikis_tarihi <= @bit
  AND (CASE WHEN baslama_tarihi IS NOT NULL THEN DATEADD(day, -1, baslama_tarihi)
            ELSE donus_tarihi END) >= @bas",
                    new { bas = bas.Date, bit = bit.Date })
                .Select(x => new Kayit((int)x.id, ((string)x.kod ?? "").Trim(),
                    (DateTime)x.bas, (DateTime)x.son, (string)x.tur, KaynakIzin)));

            /* Onaylanmış ama izin kaydı oluşmamış talepler (eski kayıtlar) */
            liste.AddRange(db.Query(@"
SELECT id, personel_kodu AS kod, cikis_tarihi AS bas, donus_tarihi AS son, tur
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum = N'Onaylandı' AND izin_id IS NULL AND tur LIKE N'%Rapor%'
  AND cikis_tarihi <= @bit AND donus_tarihi >= @bas",
                    new { bas = bas.Date, bit = bit.Date })
                .Select(x => new Kayit((int)x.id, ((string)x.kod ?? "").Trim(),
                    (DateTime)x.bas, (DateTime)x.son, (string)x.tur, KaynakTalep)));
        }
        catch
        {
            /* İzin tabloları okunamazsa yalnızca rapor kayıtları */
        }

        return liste;
    }

    /// <summary>
    /// Aralığın TAMAMINDA raporlu olan personelin kodları (Anahtar
    /// biçiminde). Aralığın bir günü bile rapor dışındaysa kişi okutma
    /// beklenen sayılır; muafiyetle aynı mantık.
    /// </summary>
    public HashSet<string> AralikKodlari(DateTime bas, DateTime bit, bool izinDahil = true)
    {
        if (bit < bas) (bas, bit) = (bit, bas);

        var sonuc = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var g in Kayitlar(bas, bit, izinDahil)
                     .GroupBy(x => Anahtar(x.PersonelKodu), StringComparer.OrdinalIgnoreCase))
        {
            var hepsi = true;

            for (var gun = bas.Date; gun <= bit.Date; gun = gun.AddDays(1))
            {
                if (!g.Any(x => x.Kapsar(gun)))
                {
                    hepsi = false;
                    break;
                }
            }

            if (hepsi) sonuc.Add(g.Key);
        }

        return sonuc;
    }
}

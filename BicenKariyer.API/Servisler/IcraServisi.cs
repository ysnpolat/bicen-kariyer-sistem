using System.Data;
using System.Globalization;
using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İcra / maaş haczi hesabı (30.10.2026)
/// ---------------------------------------------------------------------------
/// <para>
/// GMY'nin tarifi: her personele gelen icra tebligatı geliş sırasına göre
/// 1, 2, 3… sıra alır; maaştan ¼ kesilip 1. sıraya ödenir, bitince 2. sıraya
/// geçilir. Nafaka önceliklidir ve aylık nafaka tutarının tamamı kesilir.
/// </para>
/// <para>
/// Kural (İK ile netleşen):
/// <list type="bullet">
/// <item>Kesinti = açık nafaka dosyalarının aylık tutarlarının TAMAMI
/// + net maaş × oran (varsayılan %25, Yönetim › Süreler ve sınırlar ›
/// İcra). Oran net maaş üzerinden, nafaka düşülmeden hesaplanır.</item>
/// <item>Oran payı sıradaki ilk açık icra dosyasına gider; dosyanın kalan
/// borcu paydan azsa artan kısım aynı ay bir sonraki dosyaya devreder.</item>
/// <item>Toplam kesinti net maaşı aşamaz; aşarsa icra payı kırpılır ve
/// uyarı yazılır.</item>
/// <item>Sıra tebliğ (yoksa geliş) tarihine göre otomatik; İK gerekçe
/// notuyla elle sıra verebilir (elle verilenler önce, sonra otomatikler).
/// Kapanan dosya sıradan düşer.</item>
/// <item>Net maaş: önce İK'nın o ay için elle girdiği değer
/// (KRY_ICRA_MAAS), yoksa Mikro bordrosu (PERSONEL_TAHAKKUKLARI, "Net
/// ödenecek" alanının eşlendiği sütun; varsayılan pt_net). İkisi de yoksa
/// hesap yapılmaz, elle giriş istenir.</item>
/// </list>
/// Bu kurallar hukuki tavsiye değildir; hukuk danışmanına kontrol
/// ettirilmelidir.
/// </para>
/// </summary>
public class IcraServisi
{
    public static readonly Dictionary<string, string> Turler = new()
    {
        ["icra"] = "İcra (maaş haczi)",
        ["nafaka"] = "Nafaka",
    };

    public static readonly Dictionary<string, string> Durumlar = new()
    {
        ["acik"] = "Açık",
        ["askida"] = "Askıda",
        ["kapandi"] = "Kapandı",
        ["feragat"] = "Feragat",
        ["iptal"] = "İptal",
    };

    public static readonly Dictionary<string, string> OlayTurleri = new()
    {
        ["tebligat"] = "Tebligat geldi",
        ["cevap"] = "Cevap yazıldı",
        ["kesinti"] = "Kesinti başladı",
        ["odeme"] = "Ödeme yapıldı",
        ["borc"] = "Borç güncellendi",
        ["sira"] = "Sıra değişti",
        ["askiya"] = "Askıya alındı",
        ["kapandi"] = "Kapandı",
        ["feragat"] = "Feragat / iptal",
        ["ayrilis"] = "Personel ayrıldı",
        ["not"] = "Not",
    };

    private static readonly CultureInfo Tr = new("tr-TR");

    private readonly VeritabaniServisi _vt;
    private readonly AyarServisi _ayar;
    private readonly PersonelKaynagiServisi _kaynak;
    private readonly ILogger<IcraServisi> _kayit;

    public IcraServisi(VeritabaniServisi vt, AyarServisi ayar, PersonelKaynagiServisi kaynak, ILogger<IcraServisi> kayit)
    {
        _vt = vt;
        _ayar = ayar;
        _kaynak = kaynak;
        _kayit = kayit;
    }

    public static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Kesinti oranı (0,25 = ¼); Yönetim'den değiştirilebilir.</summary>
    public static decimal Oran()
    {
        var y = Parametre.Sayi("icra.kesintiYuzde");
        if (y < 1 || y > 100) y = 25;
        return y / 100m;
    }

    public static int CevapGun()
    {
        var g = Parametre.Sayi("icra.cevapGun");
        return g is < 1 or > 60 ? 7 : g;
    }

    /// <summary>"2026-11" → (2026, 11); geçersizse bugünün ayı.</summary>
    public static (int Yil, int Ay) DonemCoz(string donem)
    {
        if (!string.IsNullOrWhiteSpace(donem) && donem.Length == 7 && int.TryParse(donem[..4], out var y) && int.TryParse(donem[5..], out var a) && a is >= 1 and <= 12)
            return (y, a);
        return (DateTime.Today.Year, DateTime.Today.Month);
    }

    public static string DonemYaz(int yil, int ay) => $"{yil:0000}-{ay:00}";

    public static string DonemAdi(string donem)
    {
        var (y, a) = DonemCoz(donem);
        return new DateTime(y, a, 1).ToString("MMMM yyyy", Tr);
    }

    /* ==================================================================== */
    /* Dosya ve sıra                                                         */
    /* ==================================================================== */

    public sealed class DosyaOzeti
    {
        public int Id { get; set; }
        public string DosyaNo { get; set; }
        public string Sicil { get; set; }
        public string PersonelAd { get; set; }
        public string Tur { get; set; }
        public string IcraDairesi { get; set; }
        public string EsasNo { get; set; }
        public string Alacakli { get; set; }
        public string OdemeHesabi { get; set; }
        public DateTime? TebligTarihi { get; set; }
        public DateTime? GelisTarihi { get; set; }
        public DateTime? Baslangic { get; set; }
        public decimal ToplamBorc { get; set; }
        /// <summary>Kaydedilmiş kesintilerin toplamı (ödendi işareti beklenmez)</summary>
        public decimal Kesilen { get; set; }
        public decimal Odenen { get; set; }
        public decimal Kalan => Math.Max(0, ToplamBorc - Kesilen);
        public decimal? AylikTutar { get; set; }
        public string Durum { get; set; }
        /// <summary>İK'nın elle verdiği sıra; null = otomatik</summary>
        public int? SiraElle { get; set; }
        /// <summary>Hesaplanan sıra (nafaka 0 = öncelikli)</summary>
        public int Sira { get; set; }
        public DateTime Olusturma { get; set; }
    }

    /// <summary>Bir personelin dosyaları (hepsi); açık olanlar sıralanmış, kapananlarda sıra 0.</summary>
    public List<DosyaOzeti> Dosyalar(IDbConnection db, string sicil, bool yalnizAcik = false)
    {
        var l = db.Query(@"
SELECT d.*,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id), 0) AS kesilen,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id AND k.odendi = 1), 0) AS odenen
FROM KRY_ICRA_DOSYA d
WHERE d.sicil = @sicil AND (@hepsi = 1 OR d.durum = N'acik')
ORDER BY d.id", new { sicil = K(sicil), hepsi = yalnizAcik ? 0 : 1 })
            .Select(Ozet).ToList();
        Sirala(l);
        return l;
    }

    public static DosyaOzeti Ozet(dynamic d) => new()
    {
        Id = (int)d.id, DosyaNo = (string)d.dosya_no, Sicil = (string)d.sicil, PersonelAd = (string)d.personel_ad, Tur = (string)d.tur,
        IcraDairesi = (string)d.icra_dairesi, EsasNo = (string)d.esas_no, Alacakli = (string)d.alacakli, OdemeHesabi = (string)d.odeme_hesabi,
        TebligTarihi = (DateTime?)d.teblig_tarihi, GelisTarihi = (DateTime?)d.gelis_tarihi, Baslangic = (DateTime?)d.baslangic,
        ToplamBorc = (decimal)d.toplam_borc, Kesilen = Convert.ToDecimal(d.kesilen), Odenen = Convert.ToDecimal(d.odenen),
        AylikTutar = (decimal?)d.aylik_tutar, Durum = (string)d.durum, SiraElle = (int?)d.sira, Olusturma = (DateTime)d.olusturma,
    };

    /// <summary>
    /// Sıra: yalnız açık icra dosyaları 1, 2, 3… alır. Elle sıra verilenler
    /// kendi sırasına göre önce; sonra otomatikler tebliğ (yoksa geliş, yoksa
    /// açılış) tarihine göre. Nafaka hep 0 (öncelikli), kapananlar 0.
    /// </summary>
    public static void Sirala(List<DosyaOzeti> l)
    {
        foreach (var d in l) d.Sira = 0;
        var acik = l.Where(x => x.Durum == "acik" && x.Tur == "icra")
            .OrderBy(x => x.SiraElle is null ? 1 : 0)
            .ThenBy(x => x.SiraElle ?? 0)
            .ThenBy(x => x.TebligTarihi ?? x.GelisTarihi ?? x.Olusturma)
            .ThenBy(x => x.Id)
            .ToList();
        for (var i = 0; i < acik.Count; i++) acik[i].Sira = i + 1;
    }

    /* ==================================================================== */
    /* Net maaş                                                              */
    /* ==================================================================== */

    /// <summary>
    /// O ayın net maaşı: önce İK'nın elle girdiği değer, yoksa Mikro
    /// bordrosu. Kaynak "elle" / "bordro" / null (bulunamadı).
    /// </summary>
    public (decimal? Net, string Kaynak) NetMaas(IDbConnection db, string sicil, string donem)
    {
        var elle = db.ExecuteScalar<decimal?>("SELECT net_maas FROM KRY_ICRA_MAAS WHERE sicil = @s AND donem = @d", new { s = K(sicil), d = donem });
        if (elle is not null) return (elle, "elle");
        var (yil, ay) = DonemCoz(donem);
        var bordro = BordroNet(sicil, yil, ay);
        return bordro is null ? (null, null) : (bordro, "bordro");
    }

    /// <summary>
    /// Mikro tahakkukundan net ödenecek. Ücret Pusulaları'ndaki sütun
    /// eşlemesi (Yönetim › Tahakkuk › "Net ödenecek") kullanılır; eşleme
    /// yoksa pt_net. Aynı dönemde birden çok tahakkuk varsa ilki (asıl
    /// bordro) alınır. Bordro okunamazsa null (elle giriş istenir).
    /// </summary>
    public decimal? BordroNet(string sicil, int yil, int ay)
    {
        try
        {
            var eslesme = _ayar.FormOku().TahakkukEslesme ?? new Dictionary<string, string>();
            var sutun = eslesme.TryGetValue("netOdenecek", out var s) && !string.IsNullOrWhiteSpace(s) ? s.Trim() : "pt_net";
            if (sutun.Any(c => !char.IsLetterOrDigit(c) && c != '_')) sutun = "pt_net";

            using var db = _vt.TahakkukBaglantisi();
            var kod = K(sicil);
            var deger = db.ExecuteScalar<object>($@"
SELECT TOP 1 [{sutun}] FROM PERSONEL_TAHAKKUKLARI WITH (NOLOCK)
WHERE (LTRIM(RTRIM(pt_pkod)) = @kod OR TRY_CAST(pt_pkod AS BIGINT) = TRY_CAST(@kod AS BIGINT))
  AND pt_maliyil = @yil AND pt_tah_ay = @ay
ORDER BY pt_tahno, pt_kanun_modu", new { kod, yil, ay }, commandTimeout: 30);
            if (deger is null || deger is DBNull) return null;
            var net = Convert.ToDecimal(deger, CultureInfo.InvariantCulture);
            return net > 0 ? Math.Round(net, 2) : null;
        }
        catch (Exception h)
        {
            /* Kişisel veri yazılmaz; yalnız dönem */
            _kayit.LogWarning(h, "İcra: bordro net maaşı okunamadı ({Yil}/{Ay})", yil, ay);
            return null;
        }
    }

    /* ==================================================================== */
    /* Kesinti hesabı                                                        */
    /* ==================================================================== */

    public sealed class HesapSatiri
    {
        public int DosyaId { get; set; }
        public string DosyaNo { get; set; }
        public string Tur { get; set; }
        public int Sira { get; set; }
        public decimal Tutar { get; set; }
        public string Alacakli { get; set; }
        public string IcraDairesi { get; set; }
        public string EsasNo { get; set; }
        public string OdemeHesabi { get; set; }
        public decimal ToplamBorc { get; set; }
        /// <summary>Bu kesintiden sonra kalan borç (nafakada 0)</summary>
        public decimal KalanSonra { get; set; }
        public bool Kapanir { get; set; }
    }

    public sealed class Hesap
    {
        public string Sicil { get; set; }
        public string PersonelAd { get; set; }
        public string Donem { get; set; }
        public decimal? NetMaas { get; set; }
        public string MaasKaynak { get; set; }
        public decimal Oran { get; set; }
        public decimal OranPayi { get; set; }
        public decimal Nafaka { get; set; }
        public decimal Icra { get; set; }
        public decimal Toplam => Nafaka + Icra;
        public List<HesapSatiri> Satirlar { get; set; } = new();
        public List<string> Uyarilar { get; set; } = new();
        /// <summary>Bu dönem için kaydedilmiş kesinti satırı var mı</summary>
        public bool Kaydedildi { get; set; }
    }

    /// <summary>
    /// Bir personelin bir dönemdeki kesintisi. Daha önce kaydedilmiş
    /// satırlar borçtan düşülmüş sayılır; bu dönemin kaydedilmemiş satırları
    /// yeniden hesaplanırken dikkate alınmaz (Kaydet, önce onları siler).
    /// </summary>
    public Hesap Hesapla(IDbConnection db, string sicil, string donem, List<DosyaOzeti> dosyalar = null)
    {
        sicil = K(sicil);
        dosyalar ??= Dosyalar(db, sicil, yalnizAcik: true);
        var (net, kaynak) = NetMaas(db, sicil, donem);
        var oran = Oran();
        var h = new Hesap { Sicil = sicil, Donem = donem, NetMaas = net, MaasKaynak = kaynak, Oran = oran, PersonelAd = dosyalar.FirstOrDefault()?.PersonelAd };

        /* Bu dönemin kaydedilmiş satırları: ödenmemiş olanlar yeniden
           hesaplanacak, bu yüzden "kesilen"den geri eklenir */
        var buDonem = db.Query("SELECT dosya_id, tutar, odendi FROM KRY_ICRA_KESINTI WHERE sicil = @sicil AND donem = @donem", new { sicil, donem }).ToList();
        h.Kaydedildi = buDonem.Count > 0;
        var kalanlar = dosyalar.ToDictionary(d => d.Id, d =>
            Math.Max(0, d.ToplamBorc - d.Kesilen + buDonem.Where(x => (int)x.dosya_id == d.Id && !(bool)x.odendi).Sum(x => (decimal)x.tutar)));

        var (yil, ay) = DonemCoz(donem);
        var donemSonu = new DateTime(yil, ay, DateTime.DaysInMonth(yil, ay));

        /* 1) Nafaka: aylık tutarın tamamı, başlangıcı bu dönemi geçmeyenler */
        foreach (var d in dosyalar.Where(x => x.Durum == "acik" && x.Tur == "nafaka" && (x.AylikTutar ?? 0) > 0 && (x.Baslangic is null || x.Baslangic <= donemSonu)))
        {
            h.Satirlar.Add(new HesapSatiri
            {
                DosyaId = d.Id, DosyaNo = d.DosyaNo, Tur = "nafaka", Sira = 0, Tutar = Math.Round(d.AylikTutar!.Value, 2),
                Alacakli = d.Alacakli, IcraDairesi = d.IcraDairesi, EsasNo = d.EsasNo, OdemeHesabi = d.OdemeHesabi, ToplamBorc = d.ToplamBorc, KalanSonra = 0,
            });
        }
        h.Nafaka = h.Satirlar.Sum(x => x.Tutar);

        /* 2) Oran payı sıradaki icra dosyalarına; artan aynı ay devreder */
        var sirali = dosyalar.Where(x => x.Durum == "acik" && x.Tur == "icra" && x.Sira > 0).OrderBy(x => x.Sira).ToList();
        if (sirali.Count > 0)
        {
            if (net is null)
            {
                h.Uyarilar.Add("Net maaş bulunamadı: bordro okunamadı ya da bu dönemin tahakkuku yok. Net maaşı elle giriniz.");
            }
            else
            {
                h.OranPayi = Math.Round(net.Value * oran, 2);
                var pay = h.OranPayi;
                var tavan = Math.Max(0, net.Value - h.Nafaka);
                if (pay > tavan)
                {
                    h.Uyarilar.Add($"Nafaka ile birlikte kesinti net maaşı aşıyor; icra payı {pay.ToString("N2", Tr)} ₺ yerine {tavan.ToString("N2", Tr)} ₺ olarak kırpıldı.");
                    pay = tavan;
                }
                foreach (var d in sirali)
                {
                    if (pay <= 0) break;
                    var kalan = kalanlar[d.Id];
                    if (kalan <= 0) continue;
                    var kes = Math.Min(kalan, pay);
                    h.Satirlar.Add(new HesapSatiri
                    {
                        DosyaId = d.Id, DosyaNo = d.DosyaNo, Tur = "icra", Sira = d.Sira, Tutar = kes,
                        Alacakli = d.Alacakli, IcraDairesi = d.IcraDairesi, EsasNo = d.EsasNo, OdemeHesabi = d.OdemeHesabi,
                        ToplamBorc = d.ToplamBorc, KalanSonra = kalan - kes, Kapanir = kalan - kes <= 0,
                    });
                    pay -= kes;
                }
                h.Icra = h.Satirlar.Where(x => x.Tur == "icra").Sum(x => x.Tutar);
                if (h.Icra < h.OranPayi && pay > 0 && h.OranPayi <= tavan)
                    h.Uyarilar.Add("Sıradaki dosyaların kalan borcu oran payından az; kalan pay kesilmez.");
            }
        }
        if (net is not null && h.Nafaka > net)
            h.Uyarilar.Add("Nafaka tutarı net maaşı aşıyor; hukuk danışmanına danışınız.");

        return h;
    }

    /// <summary>
    /// Dönem hesabını kaydeder: o dönemin ödenmemiş satırları silinir, yeni
    /// satırlar yazılır; ödenmiş satırlara dokunulmaz. Kapanan dosya
    /// (kalan 0) kapatılır ve olay yazılır.
    /// </summary>
    public Hesap Kaydet(IDbConnection db, string sicil, string donem, string kim, string kimAd)
    {
        sicil = K(sicil);
        var h = Hesapla(db, sicil, donem);
        if (h.NetMaas is null && h.Satirlar.Any(x => x.Tur == "icra")) return h;

        var odenmis = db.Query<int>("SELECT dosya_id FROM KRY_ICRA_KESINTI WHERE sicil = @sicil AND donem = @donem AND odendi = 1", new { sicil, donem }).ToHashSet();
        db.Execute("DELETE FROM KRY_ICRA_KESINTI WHERE sicil = @sicil AND donem = @donem AND odendi = 0", new { sicil, donem });

        foreach (var s in h.Satirlar)
        {
            /* Aynı dosya için bu dönemde ödenmiş satır varsa yeniden yazılmaz */
            if (odenmis.Contains(s.DosyaId)) continue;
            db.Execute(@"
INSERT INTO KRY_ICRA_KESINTI (dosya_id, sicil, donem, tur, tutar, net_maas, maas_kaynak, sira, olusturan)
VALUES (@DosyaId, @sicil, @donem, @Tur, @Tutar, @net, @kaynak, @Sira, @kim)",
                new { s.DosyaId, sicil, donem, s.Tur, s.Tutar, net = h.NetMaas, kaynak = h.MaasKaynak, s.Sira, kim });

            var ilk = db.ExecuteScalar<int>("SELECT COUNT(*) FROM KRY_ICRA_OLAY WHERE dosya_id = @id AND tur = N'kesinti'", new { id = s.DosyaId }) == 0;
            if (ilk)
                OlayYaz(db, s.DosyaId, "kesinti", DateTime.Now, $"Kesinti başladı · {DonemAdi(donem)}", null, s.Tutar, kim, kimAd);
        }
        h.Kaydedildi = true;
        return h;
    }

    public static void OlayYaz(IDbConnection db, int dosyaId, string tur, DateTime tarih, string baslik, string aciklama, decimal? tutar, string kim, string kimAd)
    {
        db.Execute(@"
INSERT INTO KRY_ICRA_OLAY (dosya_id, tur, tarih, baslik, aciklama, tutar, ekleyen, ekleyen_ad)
VALUES (@dosyaId, @tur, @tarih, @baslik, @aciklama, @tutar, @kim, @kimAd)",
            new { dosyaId, tur, tarih, baslik = baslik is { Length: > 200 } ? baslik[..200] : baslik, aciklama = aciklama is { Length: > 1000 } ? aciklama[..1000] : aciklama, tutar, kim, kimAd });
    }

    /// <summary>Kalan borcu bitmiş açık icra dosyasını kapatır; kapandıysa true.</summary>
    public bool GerekirseKapat(IDbConnection db, int dosyaId, string kim, string kimAd)
    {
        var d = db.QueryFirstOrDefault(@"
SELECT d.id, d.tur, d.durum, d.toplam_borc,
       ISNULL((SELECT SUM(k.tutar) FROM KRY_ICRA_KESINTI k WHERE k.dosya_id = d.id AND k.odendi = 1), 0) AS odenen
FROM KRY_ICRA_DOSYA d WHERE d.id = @dosyaId", new { dosyaId });
        if (d is null || (string)d.durum != "acik" || (string)d.tur != "icra") return false;
        if ((decimal)d.toplam_borc <= 0 || Convert.ToDecimal(d.odenen) < (decimal)d.toplam_borc) return false;
        db.Execute("UPDATE KRY_ICRA_DOSYA SET durum = N'kapandi', kapanis_tarihi = CAST(GETDATE() AS DATE), guncelleme = SYSDATETIME() WHERE id = @dosyaId", new { dosyaId });
        OlayYaz(db, dosyaId, "kapandi", DateTime.Now, "Borç tamamlandı, dosya kapandı", "Ödemelerin toplamı borcu karşıladı; sıra bir sonraki dosyaya geçti.", null, kim, kimAd);
        return true;
    }

    /* ==================================================================== */
    /* Hazır yazılar (kopyalanabilir metin; hukuki tavsiye değildir)         */
    /* ==================================================================== */

    public PersonelKaydi Personel(string sicil)
    {
        try
        {
            return _kaynak.TumPersonelleriGetir().FirstOrDefault(x => K(x.PersonelKodu) == K(sicil));
        }
        catch { return null; }
    }

    /// <summary>Personel listesi okunabiliyor mu (ayrılış denetimi yanlış tetiklenmesin diye)</summary>
    public int PersonelSayisi()
    {
        try { return _kaynak.TumPersonelleriGetir().Count; }
        catch { return 0; }
    }

    private static string Para(decimal? v) => v is null ? "—" : v.Value.ToString("N2", Tr) + " TL";
    private static string Tarih(DateTime? t) => t is null ? "…/…/……" : t.Value.ToString("dd.MM.yyyy");

    /// <summary>
    /// Haciz ihbarnamesine (İİK 89/1) cevap yazısı taslağı: personel
    /// çalışıyorsa maaşı, mevcut haciz sırası ve kesinti bilgisi; ayrılmışsa
    /// ayrılış bildirimi. Panelde kopyalanır / yazdırılır.
    /// </summary>
    public string CevapYazisi(IDbConnection db, DosyaOzeti dosya, string donem)
    {
        var p = Personel(dosya.Sicil);
        var ad = p is null ? dosya.PersonelAd ?? dosya.Sicil : $"{p.Ad} {p.Soyad}".Trim();
        var calisiyor = p is not null && p.Durum == 1 && (p.CikisTarihi is null || p.CikisTarihi > DateTime.Today);
        var sb = new StringBuilder();
        sb.AppendLine($"{(dosya.IcraDairesi ?? "…………… İCRA DAİRESİ MÜDÜRLÜĞÜ'NE").ToUpper(Tr)}");
        sb.AppendLine();
        sb.AppendLine($"DOSYA NO : {dosya.EsasNo ?? "…"}");
        sb.AppendLine($"KONU     : {Tarih(dosya.TebligTarihi)} tarihinde tebliğ edilen haciz ihbarnamesine (İİK m. 89/1) cevabımızdır.");
        sb.AppendLine($"BORÇLU   : {ad}");
        sb.AppendLine();
        if (!calisiyor)
        {
            var cikis = p?.CikisTarihi;
            sb.AppendLine($"Müdürlüğünüzün yukarıda numarası yazılı dosyasından gönderilen haciz ihbarnamesi tarafımıza {Tarih(dosya.TebligTarihi)} tarihinde tebliğ edilmiştir.");
            sb.AppendLine();
            sb.AppendLine($"Borçlu {ad}, şirketimizde {Tarih(p?.GirisTarihi)} – {Tarih(cikis)} tarihleri arasında çalışmış olup {Tarih(cikis)} tarihi itibarıyla iş akdi sona ermiştir. Bu tarihten sonra adı geçene herhangi bir ücret, alacak ya da hak ediş tahakkuk etmemektedir; şirketimiz nezdinde haczi kabil bir alacağı bulunmamaktadır.");
            sb.AppendLine();
            sb.AppendLine("Bilgilerinize arz ederiz.");
        }
        else
        {
            var acik = Dosyalar(db, dosya.Sicil, yalnizAcik: true);
            var (net, _) = NetMaas(db, dosya.Sicil, donem);
            var oncekiler = acik.Where(x => x.Tur == "icra" && x.Sira > 0 && x.Sira < dosya.Sira).OrderBy(x => x.Sira).ToList();
            var nafakalar = acik.Where(x => x.Tur == "nafaka").ToList();
            sb.AppendLine($"Müdürlüğünüzün yukarıda numarası yazılı dosyasından gönderilen haciz ihbarnamesi tarafımıza {Tarih(dosya.TebligTarihi)} tarihinde tebliğ edilmiştir.");
            sb.AppendLine();
            sb.AppendLine($"Borçlu {ad}, şirketimizde {Tarih(p?.GirisTarihi)} tarihinden bu yana {p?.Pozisyon ?? "personel"} olarak çalışmakta olup aylık net ücreti {Para(net)}'dir.");
            if (nafakalar.Count > 0)
                sb.AppendLine($"Adı geçenin ücretinden, öncelikli olarak {string.Join(", ", nafakalar.Select(x => $"{x.IcraDairesi} {x.EsasNo} sayılı dosyası"))} kapsamında aylık nafaka kesintisi yapılmaktadır.");
            if (oncekiler.Count > 0)
            {
                sb.AppendLine($"Ayrıca ücretinin ¼'ü, daha önce tebliğ edilen {string.Join("; ", oncekiler.Select(x => $"{x.IcraDairesi} {x.EsasNo} sayılı dosyası ({x.Sira}. sıra, kalan borç {Para(x.Kalan)})"))} için kesilmekte ve ilgili dosyaya ödenmektedir.");
                sb.AppendLine($"Dosyanız {dosya.Sira}. sıraya kaydedilmiş olup önceki haciz dosyaları kapandığında kesinti dosyanıza aktarılacaktır.");
            }
            else
            {
                sb.AppendLine($"Adı geçenin ücreti üzerinde daha önce konulmuş başka bir haciz bulunmamaktadır. Dosyanız 1. sıraya kaydedilmiş olup aylık net ücretin ¼'ü ({Para(net is null ? null : Math.Round(net.Value * Oran(), 2))}) her ay kesilerek dosyanıza ödenecektir.");
            }
            sb.AppendLine();
            sb.AppendLine("Borçlunun şirketimiz nezdinde ücret dışında haczi kabil başka bir alacağı bulunmamaktadır. Bilgilerinize arz ederiz.");
        }
        sb.AppendLine();
        sb.AppendLine("BİÇEN MARKET");
        sb.AppendLine("İnsan Kaynakları");
        sb.AppendLine(DateTime.Today.ToString("dd.MM.yyyy"));
        return sb.ToString();
    }

    /// <summary>Personel işten ayrıldığında icra dairesine bildirim yazısı taslağı.</summary>
    public string AyrilisYazisi(DosyaOzeti dosya)
    {
        var p = Personel(dosya.Sicil);
        var ad = p is null ? dosya.PersonelAd ?? dosya.Sicil : $"{p.Ad} {p.Soyad}".Trim();
        var sb = new StringBuilder();
        sb.AppendLine($"{(dosya.IcraDairesi ?? "…………… İCRA DAİRESİ MÜDÜRLÜĞÜ'NE").ToUpper(Tr)}");
        sb.AppendLine();
        sb.AppendLine($"DOSYA NO : {dosya.EsasNo ?? "…"}");
        sb.AppendLine($"KONU     : Borçlu {ad} hakkındaki maaş haczi · işten ayrılış bildirimi");
        sb.AppendLine();
        sb.AppendLine($"Müdürlüğünüzün yukarıda numarası yazılı dosyası kapsamında ücretinden kesinti yapılmakta olan {ad}'ın şirketimizdeki iş akdi {Tarih(p?.CikisTarihi)} tarihi itibarıyla sona ermiştir.");
        sb.AppendLine();
        sb.AppendLine($"Ayrılış tarihine kadar yapılan kesintiler dosyanıza ödenmiş olup toplam {Para(dosya.Odenen)} ödeme yapılmıştır; kalan borç {Para(dosya.Kalan)}'dir. Bu tarihten sonra adı geçene ücret tahakkuk etmeyeceğinden kesinti yapılamayacaktır.");
        sb.AppendLine();
        sb.AppendLine("Bilgilerinize arz ederiz.");
        sb.AppendLine();
        sb.AppendLine("BİÇEN MARKET");
        sb.AppendLine("İnsan Kaynakları");
        sb.AppendLine(DateTime.Today.ToString("dd.MM.yyyy"));
        return sb.ToString();
    }
}

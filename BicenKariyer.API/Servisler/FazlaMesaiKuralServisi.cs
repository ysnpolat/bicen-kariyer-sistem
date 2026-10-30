using System.Data;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Fazla mesai onay akışı ve form maili kuralları (14.10.2026,
/// Yönetim › Fazla mesai akışı).
///
/// <para>
/// Kural: iş yeri / birim + personelin pozisyonu + fazla mesaiyi GİREN
/// (pozisyon ya da belirli kişi) → ara onaylar (sırayla, en fazla 4) ve
/// formun gideceği adres. Son onay her zaman İnsan Kaynakları. Örnek:
/// <list type="bullet">
/// <item>Genel merkez · girer: GENEL MÜDÜR YARDIMCISI → ara onay yok, doğrudan İK.</item>
/// <item>Genel merkez · girer: herkes → GENEL MÜDÜR YARDIMCISI, sonra İK.</item>
/// </list>
/// </para>
///
/// <para>
/// Hiçbir kural tutmazsa eski akış aynen çalışır (organizasyon şemasındaki
/// üst yönetici → İK; form birimin izin formu adresine). Kural tutarsa kayda
/// akış JSON olarak yazılır (KRY_FAZLA_MESAI.akis): kural sonradan değişse de
/// bekleyen kayıt kendi sırasıyla ilerler. Birim yöneticisinin imzalı form
/// aşaması değişmez; ondan sonraki "üst yönetici" aşaması kuraldaki adımlar
/// olur.
/// </para>
/// </summary>
public class FazlaMesaiKuralServisi
{
    private readonly VeritabaniServisi _vt;
    private readonly IzinOnayKuralServisi _izinKural;
    private readonly OrgOnayServisi _org;
    private readonly ILogger<FazlaMesaiKuralServisi> _kayit;
    private readonly AvansOnayZinciri _zincir;

    public FazlaMesaiKuralServisi(VeritabaniServisi vt, IzinOnayKuralServisi izinKural, OrgOnayServisi org,
        ILogger<FazlaMesaiKuralServisi> kayit, AvansOnayZinciri zincir)
    {
        _zincir = zincir;
        _vt = vt;
        _izinKural = izinKural;
        _org = org;
        _kayit = kayit;
    }

    public const string Hepsi = "*";

    /// <summary>Adım: organizasyon şemasındaki üst yönetici (eski akıştaki aşama)</summary>
    public const string SemaUst = "ŞEMA: ÜST YÖNETİCİ";

    public const string TurSema = "sema";

    public const string EpostaVarsayilan = "varsayilan";
    public const string EpostaGiren = "giren";
    public const string EpostaAdres = "adres";

    public const int EnFazlaAdim = 4;

    /* -------------------------------------------------------------- model */

    public sealed class Kural
    {
        public int Id { get; set; }
        public int Sira { get; set; }
        public string Ad { get; set; }

        /// <summary>İş yeri (izin onay tablosundaki: ŞUBE, Z.MERKEZ BURO…) ya da birim adı; "*" hepsi</summary>
        public string IsYeri { get; set; } = Hepsi;

        /// <summary>Fazla mesai yapan personelin pozisyonu; "*" hepsi</summary>
        public string Pozisyon { get; set; } = Hepsi;

        /// <summary>Fazla mesaiyi giren kişinin pozisyonu; "*" herkes</summary>
        public string Giren { get; set; } = Hepsi;

        /// <summary>Giren belirli bir kişi (pozisyondan önce bakılır)</summary>
        public string GirenSicil { get; set; }

        /// <summary>İK'dan önceki onaylar (İK eklenmez, en sonda kendiliğinden)</summary>
        public List<AvansOnayZinciri.KuralAdimi> Adimlar { get; set; } = new();

        public string EpostaMod { get; set; } = EpostaVarsayilan;
        public string Eposta { get; set; }
        public bool Aktif { get; set; } = true;
    }

    /// <summary>Kayda yazılan akış</summary>
    public sealed class Akis
    {
        public int KuralId { get; set; }
        public string Kural { get; set; }
        public bool SubeKurali { get; set; }

        /// <summary>İK'dan önceki adımlar</summary>
        public List<AvansOnayZinciri.Adim> Adimlar { get; set; } = new();

        /// <summary>Bekleyen adım; -1 birim yöneticisi aşaması</summary>
        public int Asama { get; set; } = -1;

        /// <summary>Formun gideceği adresler (boşsa varsayılan alıcı)</summary>
        public List<string> Eposta { get; set; } = new();
        public string EpostaAciklama { get; set; }

        public AvansOnayZinciri.Adim Gecerli =>
            Asama >= 0 && Asama < Adimlar.Count ? Adimlar[Asama] : null;
    }

    private static readonly JsonSerializerOptions Secenek = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string Json(Akis a) => JsonSerializer.Serialize(a, Secenek);

    public static Akis Oku(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<Akis>(json, Secenek);
        }
        catch
        {
            return null;
        }
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    private static string A(string s) => PersonelKaynagiServisi.MeslekAnahtari(s ?? "");

    private static bool HepsiMi(string s) => string.IsNullOrWhiteSpace(s) || s.Trim() == Hepsi;

    public static bool SemaMi(string onay) => A(onay) == A(SemaUst);

    /* ---------------------------------------------------------- kurallar */

    private static (DateTime zaman, List<Kural> kurallar)? _bellek;
    private static readonly object _kilit = new();

    public static void Unut()
    {
        lock (_kilit) _bellek = null;
    }

    public List<Kural> Kurallar(bool pasifDahil = false)
    {
        List<Kural> liste;

        lock (_kilit)
            liste = _bellek is { } b && DateTime.UtcNow - b.zaman < TimeSpan.FromSeconds(60) ? b.kurallar : null;

        if (liste is null)
        {
            try
            {
                using var db = _vt.Baglanti();
                liste = db.Query(@"
SELECT id, sira, ad, is_yeri, pozisyon, giren, giren_sicil, adimlar, eposta_mod, eposta, aktif
FROM KRY_FM_AKIS_KURAL ORDER BY sira, id")
                    .Select(x => new Kural
                    {
                        Id = (int)x.id,
                        Sira = (int)x.sira,
                        Ad = (string)x.ad,
                        IsYeri = (string)x.is_yeri ?? Hepsi,
                        Pozisyon = (string)x.pozisyon ?? Hepsi,
                        Giren = (string)x.giren ?? Hepsi,
                        GirenSicil = (string)x.giren_sicil,
                        Adimlar = AdimlariCoz((string)x.adimlar),
                        EpostaMod = (string)x.eposta_mod ?? EpostaVarsayilan,
                        Eposta = (string)x.eposta,
                        Aktif = (bool)x.aktif,
                    })
                    .ToList();
            }
            catch (Exception hata)
            {
                /* tablo yoksa kural yok: eski akış */
                _kayit.LogWarning(hata, "Fazla mesai akış kuralları okunamadı");
                liste = new();
            }

            lock (_kilit) _bellek = (DateTime.UtcNow, liste);
        }

        return pasifDahil ? liste : liste.Where(x => x.Aktif).ToList();
    }

    public static List<AvansOnayZinciri.KuralAdimi> AdimlariCoz(string json)
    {
        try
        {
            return Temizle(JsonSerializer.Deserialize<List<AvansOnayZinciri.KuralAdimi>>(json ?? "[]", Secenek));
        }
        catch
        {
            return new();
        }
    }

    public static string AdimlariYaz(List<AvansOnayZinciri.KuralAdimi> l) => JsonSerializer.Serialize(Temizle(l), Secenek);

    /// <summary>İK adımları atılır (İK hep sonda), boşlar ve art arda tekrarlar atılır</summary>
    public static List<AvansOnayZinciri.KuralAdimi> Temizle(List<AvansOnayZinciri.KuralAdimi> l) =>
        AvansOnayZinciri.Temizle((l ?? new()).Where(x => x is not null && !AvansOnayZinciri.IkMi(x.Onay)).ToList())
            .Select(x => SemaMi(x.Onay) ? new AvansOnayZinciri.KuralAdimi { Onay = SemaUst } : x)
            .Take(EnFazlaAdim)
            .ToList();

    /* ------------------------------------------------------------ eşleşme */

    /// <summary>Personelin iş yeri (izin onay tablosundaki ad)</summary>
    public string IsYeri(PersonelKaydi p)
    {
        try
        {
            return _izinKural.IsYeriBul(p?.IsGrubu);
        }
        catch
        {
            return IzinOnayKuralServisi.Sube;
        }
    }

    private bool YerTutar(Kural k, PersonelKaydi hedef, string yer) =>
        HepsiMi(k.IsYeri)
        || A(k.IsYeri) == A(yer)
        || A(k.IsYeri) == A(hedef?.IsGrubu)
        || A(k.IsYeri) == A(hedef?.Sube);

    /// <summary>Kaydın kuralı: sıraya göre ilk tutan; yoksa null (eski akış)</summary>
    public Kural Bul(PersonelKaydi giren, PersonelKaydi hedef)
    {
        if (giren is null || hedef is null) return null;

        var yer = IsYeri(hedef);

        return Kurallar().FirstOrDefault(k =>
            YerTutar(k, hedef, yer)
            && (HepsiMi(k.Pozisyon) || A(k.Pozisyon) == A(hedef.Pozisyon))
            && (!string.IsNullOrWhiteSpace(k.GirenSicil)
                ? K(k.GirenSicil) == K(giren.PersonelKodu)
                : HepsiMi(k.Giren) || A(k.Giren) == A(giren.Pozisyon)));
    }

    private static string GmySicil()
    {
        var s = Parametre.Metin("avans.gmySicil");
        return string.IsNullOrWhiteSpace(s) ? "10664" : s.Trim();
    }

    /// <summary>Yeni kaydın akışı; kural yoksa null. Adımların kişileri sıraları gelince bulunur.</summary>
    public Akis Olustur(PersonelKaydi giren, PersonelKaydi hedef)
    {
        var k = Bul(giren, hedef);
        if (k is null) return null;

        var a = new Akis
        {
            KuralId = k.Id,
            Kural = string.IsNullOrWhiteSpace(k.Ad) ? $"Kural #{k.Id}" : k.Ad,
            SubeKurali = A(IsYeri(hedef)) == A(IzinOnayKuralServisi.Sube),
        };

        /* 23.10.2026: onay adımları avans onay tablosundan (izinle aynı);
           kuraldan yalnızca form e-postası alınıyor. Tablonun 1. adımı
           birim yöneticisinin imzalı form aşaması, kalanları buraya. */
        List<AvansOnayZinciri.KuralAdimi> adimlar;
        try
        {
            adimlar = _zincir.IkOncesiAdimlar(hedef.Pozisyon, hedef.IsGrubu ?? hedef.Sube).Skip(1).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fazla mesai: avans tablosu okunamadı, kural adımları kullanılıyor");
            adimlar = k.Adimlar;
        }

        foreach (var x in adimlar)
        {
            var sema = SemaMi(x.Onay);
            var sicil = string.Equals(x.Sicil, "gmy", StringComparison.OrdinalIgnoreCase) ? GmySicil() : x.Sicil;

            a.Adimlar.Add(new AvansOnayZinciri.Adim
            {
                Ad = sema ? "Üst yönetici" : IzinOnayKuralServisi.BasHarf(x.Onay),
                Tur = sema ? TurSema : AvansOnayZinciri.TurKisi,
                Onay = x.Onay,
                Sicil = sema ? null : sicil,
                /* GMY adımı panelde GMY hesabıyla da onaylanabilir */
                Roller = sicil is not null && K(sicil) == K(GmySicil()) ? new() { Roller.GenelMudurYardimcisi } : new(),
            });
        }

        (a.Eposta, a.EpostaAciklama) = Alici(k, giren);

        return a;
    }

    /// <summary>Kuralın form alıcısı; varsayılansa boş liste</summary>
    private (List<string>, string) Alici(Kural k, PersonelKaydi giren)
    {
        if (k.EpostaMod == EpostaAdres)
        {
            var l = Ayir(k.Eposta);
            if (l.Count > 0) return (l, $"Fazla mesai kuralı · {k.Ad ?? $"#{k.Id}"}");
        }
        else if (k.EpostaMod == EpostaGiren)
        {
            try
            {
                using var db = _vt.Baglanti();
                var adres = PersonelEposta.Oku(db, giren.PersonelKodu);
                if (!string.IsNullOrWhiteSpace(adres))
                    return (new List<string> { adres.Trim() }, "Fazla mesaiyi girenin e-postası");
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Girenin e-postası okunamadı: {Kod}", giren.PersonelKodu);
            }
        }

        return (new List<string>(), null);
    }

    public static List<string> Ayir(string metin) =>
        (metin ?? "")
            .Split(new[] { ';', ',', ' ', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(PersonelEposta.Gecerli)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(10)
            .ToList();

    /* ------------------------------------------------------------ ilerleme */

    /// <summary>Adımın onaylayanları (fazla mesai yapan hariç)</summary>
    public void Coz(AvansOnayZinciri.Adim a, PersonelKaydi hedef, bool subeKurali)
    {
        try
        {
            List<PersonelKaydi> kisiler;

            if (a.Tur == TurSema)
                kisiler = _org.FazlaMesaiUst(hedef.PersonelKodu, hedef.Pozisyon, hedef.Sube, hedef.IsGrubu);
            else
                kisiler = _izinKural.KisileriBul(a.Onay, a.Sicil, hedef.PersonelKodu, hedef.IsGrubu ?? hedef.Sube, false, subeKurali);

            kisiler = kisiler
                .Where(x => K(x.PersonelKodu) != K(hedef.PersonelKodu))
                .GroupBy(x => K(x.PersonelKodu)).Select(g => g.First())
                .Take(20)
                .ToList();

            a.Siciller = kisiler.Select(x => K(x.PersonelKodu)).ToList();
            a.Adlar = kisiler.Select(x => $"{x.Ad} {x.Soyad}".Trim()).ToList();
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fazla mesai onaylayanı bulunamadı: {Onay}", a.Onay);
        }
    }

    /// <summary>
    /// Sıradaki adım. Onaylayan yeniden bulunur; kimse yoksa, adımın
    /// onaylayanı zaten onaylamışsa (giren, birim yöneticisi ya da önceki
    /// adım) adım "atlandi". Kalan yoksa null (İK).
    /// </summary>
    public int? Ilerle(Akis akis, PersonelKaydi hedef, IEnumerable<string> onaylamislar)
    {
        var onayli = new HashSet<string>((onaylamislar ?? Array.Empty<string>()).Select(K).Where(x => x.Length > 0),
            StringComparer.OrdinalIgnoreCase);

        for (var j = akis.Asama + 1; j < akis.Adimlar.Count; j++)
        {
            var a = akis.Adimlar[j];

            Coz(a, hedef, akis.SubeKurali);

            if (a.Siciller.Count == 0)
            {
                Atla(a, "Onaylayacak kişi bulunamadı");
                continue;
            }

            if (a.Siciller.Any(onayli.Contains))
            {
                Atla(a, "Onaylayan bu kaydı zaten onayladı (girdi ya da önceki adımda onayladı)");
                foreach (var s in a.Siciller) onayli.Add(s);
                continue;
            }

            return j;
        }

        return null;
    }

    private static void Atla(AvansOnayZinciri.Adim a, string not)
    {
        a.Karar = "atlandi";
        a.Not = not;
        a.Tarih = DateTime.Now;
    }

    /// <summary>Bu kişi bekleyen adımda karar verebilir mi</summary>
    public static bool Yetkili(Akis akis, string sicil) =>
        akis?.Gecerli is { } g && g.Karar is null && (g.Siciller ?? new()).Contains(K(sicil), StringComparer.OrdinalIgnoreCase);

    /// <summary>Panel önizlemesi: adımlar ve onaylayanları (kayıt açmadan)</summary>
    public object Onizle(PersonelKaydi giren, PersonelKaydi hedef)
    {
        var akis = Olustur(giren, hedef);
        if (akis is null) return null;

        var onayli = new List<string> { giren.PersonelKodu };
        var adimlar = new List<object>();

        while (true)
        {
            var j = Ilerle(akis, hedef, onayli);
            if (j is null) break;
            var a = akis.Adimlar[j.Value];
            onayli.AddRange(a.Siciller);
            akis.Asama = j.Value;
        }

        foreach (var a in akis.Adimlar)
            adimlar.Add(new { ad = a.Ad, kisiler = a.Adlar, atlandi = a.Karar == "atlandi", not = a.Not });

        return new
        {
            kural = akis.Kural,
            kuralId = akis.KuralId,
            adimlar,
            eposta = akis.Eposta,
            epostaAciklama = akis.EpostaAciklama,
        };
    }
}

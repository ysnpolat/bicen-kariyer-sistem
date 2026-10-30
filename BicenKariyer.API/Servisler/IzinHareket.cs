using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebinin hareket günlüğü
/// ---------------------------------------------------------------------------
/// Talebin başına gelen her şey tek tabloda (KRY_IZIN_TALEP_HAREKET):
/// oluşturma, aşama kararları, kime hangi bildirimin gittiği, evrak
/// yüklemeleri, hatırlatmalar, form e-postası, aslının gönderilmesi ve
/// iptal. Panelde talebin "Geçmiş &amp; Bildirimler" sekmesi ve sayfanın
/// "Son bildirimler" akışı buradan beslenir.
///
/// <para>
/// Günlük yazımı asıl işi hiçbir zaman durdurmaz: tablo yoksa ya da yazım
/// başarısız olursa sessizce geçilir. Onay, bildirim gitmedi diye
/// bozulmamalı; günlük yazılamadı diye hiç bozulmamalı.
/// </para>
///
/// <para>
/// Tablo devreye girmeden önce açılmış talepler için geçmiş, talebin kendi
/// kolonlarından (karar, kişi, not, tarih; form gönderimi; evrak
/// kayıtları; hatırlatma zamanları) yeniden kuruluyor
/// (<see cref="Sentezle"/>). Günlükte aynı türden yakın zamanlı kayıt
/// varsa kurulan olay atlanıyor (<see cref="Birlestir"/>).
/// </para>
/// </summary>
public static class IzinHareket
{
    /* Türler: ekranda simge ve renk buna göre seçiliyor */
    public const string Olusturma = "olusturma";
    public const string Karar = "karar";
    public const string Bildirim = "bildirim";
    public const string Evrak = "evrak";
    public const string Hatirlatma = "hatirlatma";
    public const string Form = "form";
    public const string Asil = "asil";
    public const string Iptal = "iptal";

    /* Kanallar */
    public const string Uygulama = "uygulama";
    public const string Sms = "sms";
    public const string Eposta = "eposta";
    public const string Panel = "panel";

    /// <summary>Ekrana giden tek hareket (günlükten ya da talepten kurulmuş).</summary>
    public sealed class Kayit
    {
        public int? Id { get; set; }
        public int TalepId { get; set; }
        public DateTime Zaman { get; set; }
        public string Tur { get; set; }
        public string Baslik { get; set; }
        public string Metin { get; set; }
        public string Kisi { get; set; }
        public string Hedef { get; set; }
        public string Kanal { get; set; }

        /// <summary>"kayit": günlükten · "talep": talebin kolonlarından kuruldu</summary>
        public string Kaynak { get; set; }

        /// <summary>Evrak olayında açılabilecek dosya</summary>
        public int? BelgeId { get; set; }
    }

    private static string Kes(string s, int n)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;

        s = s.Trim();

        return s.Length > n ? s[..n] : s;
    }

    /// <summary>
    /// Günlüğe bir hareket yazar. Hata fırlatmaz.
    /// </summary>
    public static void Yaz(
        IDbConnection db, int talepId, string tur, string baslik,
        string metin = null, string kisi = null, string hedef = null, string kanal = null)
    {
        if (db is null || talepId <= 0) return;

        try
        {
            db.Execute(@"
INSERT INTO KRY_IZIN_TALEP_HAREKET (talep_id, tur, baslik, metin, kisi, hedef, kanal)
VALUES (@talepId, @tur, @baslik, @metin, @kisi, @hedef, @kanal)",
                new
                {
                    talepId,
                    tur = Kes(tur, 30) ?? Bildirim,
                    baslik = Kes(baslik, 200) ?? "",
                    metin = Kes(metin, 900),
                    kisi = Kes(kisi, 150),
                    hedef = Kes(hedef, 300),
                    kanal = Kes(kanal, 30),
                });
        }
        catch
        {
            /* Günlük asıl işi durdurmaz (tablo henüz kurulmamış olabilir) */
        }
    }

    /// <summary>Kendi bağlantısını açarak yazar (bağlantısı olmayan yerler için).</summary>
    public static void Yaz(
        VeritabaniServisi vt, int talepId, string tur, string baslik,
        string metin = null, string kisi = null, string hedef = null, string kanal = null)
    {
        try
        {
            using var db = vt.Baglanti();
            Yaz(db, talepId, tur, baslik, metin, kisi, hedef, kanal);
        }
        catch
        {
            /* Bağlantı açılamadıysa da geçilir */
        }
    }

    /// <summary>
    /// Personelin uygulaması bildirim alabiliyor mu (jetonu kayıtlı mı).
    /// Jeton yoksa anlık bildirim gitmiyor; günlükte bu da görünsün.
    /// </summary>
    public static bool JetonVar(IDbConnection db, string personelKodu)
    {
        if (string.IsNullOrWhiteSpace(personelKodu)) return false;

        try
        {
            return db.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM KRY_MOBIL_JETON WHERE personel_kodu = @kod AND jeton IS NOT NULL AND jeton <> ''",
                new { kod = personelKodu.Trim() }) > 0;
        }
        catch
        {
            return true;
        }
    }

    /// <summary>Uygulamaya giden kişisel bildirimin notu (jeton yoksa).</summary>
    public static string UlasmadiNotu(IDbConnection db, string personelKodu) =>
        JetonVar(db, personelKodu) ? null : "Uygulamada bildirim izni yok; anlık bildirim ulaşmamış olabilir.";

    /// <summary>Bir talebin günlük kayıtları.</summary>
    public static List<Kayit> Oku(IDbConnection db, int talepId)
    {
        try
        {
            return db.Query<Kayit>(@"
SELECT id AS Id, talep_id AS TalepId, zaman AS Zaman, tur AS Tur, baslik AS Baslik,
       metin AS Metin, kisi AS Kisi, hedef AS Hedef, kanal AS Kanal, 'kayit' AS Kaynak
FROM KRY_IZIN_TALEP_HAREKET WHERE talep_id = @talepId
ORDER BY zaman, id", new { talepId }).ToList();
        }
        catch
        {
            return new List<Kayit>();
        }
    }

    private static readonly (string Alan, string Ad)[] Asamalar =
    {
        ("magaza", "Birim yöneticisi"),
        ("bolge", "Bölge müdürü"),
        ("ik", "İnsan Kaynakları"),
    };

    /// <summary>Karar olayının başlığı: "Bölge müdürü onayladı".</summary>
    public static string KararBasligi(string alan, string karar) => KararBasligi(alan, karar, false);

    /// <summary>
    /// Zincirli talepte (26.10.2026) adım adıyla: "Genel Müdür Yardımcısı onayladı".
    /// <paramref name="adimAdi"/> true ise ilk parametre kolon öneki değil adım adı.
    /// </summary>
    public static string KararBasligi(string alan, string karar, bool adimAdi)
    {
        var ad = adimAdi
            ? (string.IsNullOrWhiteSpace(alan) ? "Onaylayan" : alan)
            : Asamalar.FirstOrDefault(x => x.Alan == alan).Ad ?? "Onaylayan";

        return karar switch
        {
            "Onaylandı" => $"{ad} onayladı",
            "Reddedildi" => $"{ad} reddetti",
            "Atlandı" => $"{ad} aşaması atlandı",
            _ => $"{ad}: {karar}",
        };
    }

    private static DateTime? Tarih(object v) => v as DateTime?;

    private static object Alan(IDictionary<string, object> s, string ad) =>
        s.TryGetValue(ad, out var v) ? v : null;

    /// <summary>
    /// Talebin kendi kolonlarından geçmişi kurar. Günlük tablosu devreye
    /// girmeden önceki talepler de tam bir zaman çizelgesi göstersin diye.
    /// </summary>
    /// <param name="talep">KRY_IZIN_TALEP satırı (SELECT *)</param>
    /// <param name="evraklar">Talebin KRY_IZIN_TALEP_EVRAK kayıtları</param>
    /// <param name="duyurular">Personele giden uygulama duyuruları (baslik, olusturma)</param>
    public static List<Kayit> Sentezle(object talep, List<IzinEvrak.Kayit> evraklar, List<dynamic> duyurular = null)
    {
        var l = new List<Kayit>();

        if (talep is not IDictionary<string, object> s) return l;

        var id = Convert.ToInt32(Alan(s, "id"));
        var adSoyad = Alan(s, "ad_soyad") as string;

        void Ekle(DateTime? zaman, string tur, string baslik, string metin = null,
                  string kisi = null, string hedef = null, string kanal = null, int? belgeId = null)
        {
            if (zaman is not DateTime z) return;

            l.Add(new Kayit
            {
                TalepId = id, Zaman = z, Tur = tur, Baslik = baslik, Metin = metin,
                Kisi = kisi, Hedef = hedef, Kanal = kanal, Kaynak = "talep", BelgeId = belgeId,
            });
        }

        var olusturma = Tarih(Alan(s, "olusturma"));

        Ekle(olusturma, Olusturma, "Talep oluşturuldu",
            $"{Alan(s, "tur")} · {Tarih(Alan(s, "cikis_tarihi")):dd.MM.yyyy} – {Tarih(Alan(s, "donus_tarihi")):dd.MM.yyyy}",
            adSoyad, null, Uygulama);

        /* Aşama kararları */
        var kararZamanlari = new List<DateTime>();

        foreach (var (alan, _) in Asamalar)
        {
            var karar = Alan(s, $"{alan}_karar") as string;

            if (string.IsNullOrWhiteSpace(karar)) continue;

            var zaman = Tarih(Alan(s, $"{alan}_tarih"));

            Ekle(zaman, Karar, KararBasligi(alan, karar), Alan(s, $"{alan}_not") as string,
                Alan(s, $"{alan}_kisi") as string);

            if (zaman is DateTime z && karar != "Atlandı") kararZamanlari.Add(z);
        }

        /* Karar anında personele uygulamada duyuru düşüyor: karar zamanına
           yakın olanlar "personele bildirildi" olarak gösteriliyor */
        foreach (var d in duyurular ?? new List<dynamic>())
        {
            if (d is not IDictionary<string, object> dd) continue;

            var z = Tarih(Alan(dd, "olusturma"));

            if (z is not DateTime dz) continue;

            if (!kararZamanlari.Any(k => Math.Abs((k - dz).TotalMinutes) <= 3)) continue;

            Ekle(dz, Bildirim, "Personele bildirim gönderildi",
                $"{Alan(dd, "baslik")}{(Alan(dd, "metin") is string m && m.Length > 0 ? " · " + m : "")}",
                "Sistem", adSoyad, Uygulama);
        }

        /* İzin formu e-postası */
        var formGonderim = Tarih(Alan(s, "form_gonderim"));
        var formHata = Alan(s, "form_hata") as string;
        var formEposta = Alan(s, "form_eposta") as string;

        if (formGonderim is not null)
            Ekle(formGonderim, Form, "İzin formu e-postayla gönderildi", formHata, "Sistem", formEposta, Eposta);
        else if (!string.IsNullOrWhiteSpace(formHata))
            Ekle(olusturma?.AddSeconds(5), Form, "İzin formu gönderilemedi", formHata, "Sistem", formEposta, Eposta);

        /* Evrak kayıtları */
        foreach (var e in evraklar ?? new List<IzinEvrak.Kayit>())
        {
            var ik = e.Kalem == IzinEvrak.Ik;

            Ekle(e.Olusturma, Evrak,
                ik ? $"İK evrakı yüklendi: {e.Tur}" : $"Personel evrakı yüklendi: {e.Tur}",
                e.OzgunAd, ik ? e.Yukleyen : (e.Yukleyen ?? adSoyad), null, ik ? Panel : Uygulama, e.BelgeId);
        }

        /* Eski talepler: evrak kaydı yok ama mazeret belgesi var */
        if ((evraklar ?? new()).Count == 0 && Tarih(Alan(s, "mb_yukleme")) is DateTime mb)
            Ekle(mb, Evrak, "Personel evrakı yüklendi", Alan(s, "mb_belge_id") is null ? null : "Mazeret belgesi",
                adSoyad, null, Uygulama, Alan(s, "mb_belge_id") is int mbId ? mbId : null);

        Ekle(Tarih(Alan(s, "asil_gonderim")), Asil, "Islak imzalı aslı İK'ya gönderildi",
            "Personel gönderdiğini uygulamadan bildirdi.", adSoyad, "İnsan Kaynakları", Uygulama);

        /* Evrak görevinin bildirimleri (zamanları talepte tutuluyor) */
        Ekle(Tarih(Alan(s, "mb_son_gun_bildirim")), Hatirlatma, "Evrak için son gün hatırlatması",
            "İzin evrakınız için son gün", "Sistem", adSoyad, Uygulama);

        Ekle(Tarih(Alan(s, "mb_yonetici_bildirim")), Bildirim, "Yöneticiye evrak eksik bildirildi",
            "Evrak yüklemesi beklenen personel var", "Sistem", "Personelin yöneticileri", Uygulama);

        Ekle(Tarih(Alan(s, "mb_hatirlatma")), Hatirlatma, "Evrak hatırlatması (son)",
            "İzin evrakınız hâlâ bekleniyor", "Sistem", adSoyad, Uygulama);

        return l;
    }

    /// <summary>
    /// Günlük ile kurulmuş olayları birleştirir. Günlükte aynı türden ±2
    /// dakika içinde kayıt varsa kurulan olay atlanır (günlük daha
    /// ayrıntılı: hedef, kanal). Atlanan olayın dosya bağlantısı günlükteki
    /// kayda taşınır.
    /// </summary>
    public static List<Kayit> Birlestir(List<Kayit> kayitli, List<Kayit> kurulan)
    {
        var sonuc = new List<Kayit>(kayitli ?? new List<Kayit>());

        foreach (var k in kurulan ?? new List<Kayit>())
        {
            var es = sonuc.FirstOrDefault(x =>
                x.Kaynak == "kayit" && x.TalepId == k.TalepId && x.Tur == k.Tur
                && Math.Abs((x.Zaman - k.Zaman).TotalMinutes) <= 2
                && (k.BelgeId is null || x.BelgeId is null));

            if (es is not null)
            {
                es.BelgeId ??= k.BelgeId;
                continue;
            }

            sonuc.Add(k);
        }

        return sonuc.OrderBy(x => x.Zaman).ThenBy(x => x.Id ?? int.MaxValue).ToList();
    }
}

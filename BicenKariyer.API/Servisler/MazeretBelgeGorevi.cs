using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mazeret izni belgesi takibi
/// ---------------------------------------------------------------------------
/// Belge istenen türde (İzin Türleri'nde "belge istenir" işaretli: mazeret,
/// rapor) izin onaylanınca personelin 3 günü var (<c>mb_son</c>). Görev:
///
/// <list type="bullet">
/// <item>son 24 saate girince personele "son gün" bildirimi,</item>
/// <item>süre dolunca yöneticilerine "belge yüklemesi beklenen personel var",</item>
/// <item>sonrasında yükleyene kadar personele günde bir hatırlatma (14 gün).</item>
/// </list>
///
/// <para>
/// Her bildirim talebin kendi alanına yazılıyor (mb_son_gun_bildirim,
/// mb_yonetici_bildirim, mb_hatirlatma); sunucu yeniden başlasa da ikinci
/// kez gitmiyor. Gece bildirim gitmesin diye 08:00–21:00 arası çalışıyor.
/// </para>
/// </summary>
public class MazeretBelgeGorevi : BackgroundService
{
    /// <summary>Belgenin yüklenmesi için tanınan süre (gün)</summary>
    public static int SureGun => Parametre.Sayi("izin.mazeretBelgeGun");

    /// <summary>Süre dolduktan sonra günlük hatırlatmanın süreceği gün sayısı</summary>
    private static int HatirlatmaGun => Parametre.Sayi("izin.mazeretTakipGun");

    private readonly IServiceProvider _saglayici;
    private readonly ILogger<MazeretBelgeGorevi> _kayit;

    public MazeretBelgeGorevi(IServiceProvider saglayici, ILogger<MazeretBelgeGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>
    /// Bir kez gidecek bildirimin kaydı. Kayıt eklendiyse true (ilk kez),
    /// zaten varsa false.
    /// </summary>
    public static bool BirKez(System.Data.IDbConnection db, string anahtar)
    {
        anahtar = anahtar.Length > 160 ? anahtar[..160] : anahtar;

        return db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_GOREV_BILDIRIM WHERE anahtar = @anahtar)
    INSERT INTO KRY_GOREV_BILDIRIM (anahtar) VALUES (@anahtar)", new { anahtar }) > 0;
    }

    /// <summary>
    /// Personelin yöneticileri (bildirim gidecek siciller, Mikro'daki
    /// yazımıyla): izin onay tablosundaki 1. onaylayanları ve departman
    /// yöneticileri. Ekibim'de onu "sorumlu olduğunuz" altında görenler.
    /// </summary>
    public static List<string> Yoneticileri(EkipServisi ekip, DepartmanServisi departman, string kod)
    {
        var kumeler = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (ekip.Yoneticiler().TryGetValue(K(kod), out var y))
            kumeler.UnionWith(y);

        kumeler.UnionWith(departman.Oku().Yoneticileri(kod).Select(K));

        kumeler.Remove(K(kod));

        return ekip.Aktifler()
            .Where(x => kumeler.Contains(K(x.PersonelKodu)))
            .Select(x => x.PersonelKodu.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Sicillerin ad soyadları (hareket günlüğünde "kime gitti").</summary>
    private static string Adlar(EkipServisi ekip, List<string> kodlar)
    {
        var adlar = kodlar
            .Select(k => ekip.Kisi(k) is { } x ? $"{x.Ad} {x.Soyad}".Trim() : k)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .ToList();

        return string.Join(", ", adlar.Take(6)) + (adlar.Count > 6 ? $" +{adlar.Count - 6}" : "");
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(4), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                if (Parametre.SaatAraliginda("gorev.baslangicSaat", "gorev.bitisSaat")) await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "Mazeret belgesi görevi çalışamadı");
            }

            await Task.Delay(TimeSpan.FromMinutes(30), jeton);
        }
    }

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();
        var ekip = kapsam.ServiceProvider.GetRequiredService<EkipServisi>();
        var departman = kapsam.ServiceProvider.GetRequiredService<DepartmanServisi>();

        using var db = vt.Baglanti();

        var bekleyenler = db.Query(@"
SELECT id, personel_kodu AS kod, ad_soyad AS adSoyad, tur, mb_son AS son,
       mb_son_gun_bildirim AS sonGun, mb_yonetici_bildirim AS yonetici,
       mb_hatirlatma AS hatirlatma
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum <> N'Reddedildi' AND mb_son IS NOT NULL AND mb_yukleme IS NULL
  AND mb_son >= DATEADD(DAY, -@gun, SYSDATETIME())",
            new { gun = HatirlatmaGun }).ToList();

        var simdi = DateTime.Now;
        var tr = new System.Globalization.CultureInfo("tr-TR");

        foreach (var t in bekleyenler)
        {
            int id = t.id;
            string kod = t.kod;
            DateTime son = t.son;
            string turAdi = ((string)t.tur ?? "izin").ToLower(tr);

            /* 1. Son gün: kalan süre 24 saatin altına indi */
            if (son > simdi && son - simdi <= TimeSpan.FromHours(24) && t.sonGun is null)
            {
                db.Execute("UPDATE KRY_IZIN_TALEP SET mb_son_gun_bildirim = SYSDATETIME() WHERE id = @id", new { id });

                string sonGunMetni = $"{t.tur} evrakınızı {son:dd.MM HH:mm}'e kadar Biçen360'tan yükleyiniz.";

                await bildirim.Gonder(kod, "İzin evrakınız için son gün", sonGunMetni, "anasayfa");

                IzinHareket.Yaz(db, id, IzinHareket.Hatirlatma, "Evrak için son gün hatırlatması",
                    sonGunMetni + (IzinHareket.UlasmadiNotu(db, kod) is string n1 ? $" ({n1})" : ""),
                    "Sistem", (string)t.adSoyad, IzinHareket.Uygulama);
            }

            if (son > simdi) continue;

            /* 2. Süre doldu: yöneticilere bir kez */
            if (t.yonetici is null)
            {
                db.Execute("UPDATE KRY_IZIN_TALEP SET mb_yonetici_bildirim = SYSDATETIME() WHERE id = @id", new { id });

                var yoneticiler = Yoneticileri(ekip, departman, kod);

                string yoneticiMetni = $"{t.adSoyad} {turAdi} evrakını {SureGun} gün içinde yüklemedi.";

                await bildirim.TopluGonder(yoneticiler,
                    "Evrak yüklemesi beklenen personel var",
                    yoneticiMetni, "anasayfa");

                IzinHareket.Yaz(db, id, IzinHareket.Bildirim, "Yöneticiye evrak eksik bildirildi",
                    yoneticiMetni, "Sistem",
                    yoneticiler.Count == 0 ? "Yönetici bulunamadı" : Adlar(ekip, yoneticiler),
                    IzinHareket.Uygulama);

                _kayit.LogInformation("Mazeret belgesi gecikti: talep {Id}, {Adet} yöneticiye bildirildi",
                    id, yoneticiler.Count);
            }

            /* 3. Personele günde bir hatırlatma (sabah 09:00 sonrası) */
            if (simdi.Hour >= 9 && (t.hatirlatma is null || ((DateTime)t.hatirlatma).Date < simdi.Date))
            {
                db.Execute("UPDATE KRY_IZIN_TALEP SET mb_hatirlatma = SYSDATETIME() WHERE id = @id", new { id });

                string hatirlatmaMetni = $"{t.tur} evrakınızı Biçen360 ana sayfasından yükleyebilirsiniz.";

                await bildirim.Gonder(kod, "İzin evrakınız hâlâ bekleniyor", hatirlatmaMetni, "anasayfa");

                IzinHareket.Yaz(db, id, IzinHareket.Hatirlatma, "Günlük evrak hatırlatması",
                    hatirlatmaMetni + (IzinHareket.UlasmadiNotu(db, kod) is string n2 ? $" ({n2})" : ""),
                    "Sistem", (string)t.adSoyad, IzinHareket.Uygulama);
            }
        }
    }
}

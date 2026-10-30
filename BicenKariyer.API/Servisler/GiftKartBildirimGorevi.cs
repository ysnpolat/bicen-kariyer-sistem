using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Biçen Kart hareket bildirimleri
/// ---------------------------------------------------------------------------
/// Personelin kartına bakiye yüklendiğinde, kartla harcama yapıldığında ya
/// da karttan bakiye silindiğinde telefonuna bildirim gönderir.
///
/// <para>
/// Yazarkasa tarafı bize haber vermiyor; PuanHareket belirli aralıklarla
/// yokleniyor. 29.09.2026'ya kadar "son işlenen kimlik" tutuluyordu, ama
/// PuanHareket.Id bir GUID: sırası yok, MAX alınamıyor, sayıyla
/// karşılaştırılamıyor. Görev bu yüzden hiç bildirim gönderemiyordu.
/// Artık son bir günün hareketlerine bakılıyor ve bildirilen satırların
/// kimliği kendi veritabanımızda (KRY_KART_BILDIRILEN) tutuluyor. Mağaza
/// kasası merkeze geç aktarsa da (satırın Tarih'i geriden gelse de)
/// bir gün içinde gelen hareket kaçmıyor.
/// </para>
///
/// <para>
/// Panelden yapılan yükleme, transfer ve silmeler burada bildirilmiyor:
/// panel onları yazdığı anda açıklamasıyla kendisi bildiriyor ve
/// satırları "bildirildi" olarak işaretliyor (transferde kaynak kart
/// için "başka karta aktarıldı" yazıyor; buradan "silindi" giderdi).
/// </para>
///
/// <para>
/// Kart sahibi önce paneldeki kart eşleşmesinden (KRY_KART_ESLESME),
/// yoksa mobil kartın telefon numarasından bulunuyor.
/// </para>
///
/// <para>
/// İlk çalıştırmada geçmiş hareketler bildirilmiyor; yalnızca o andan
/// sonrası. Aksi halde herkese bir günlük birikmiş bildirim giderdi.
/// </para>
/// </summary>
public class GiftKartBildirimGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<GiftKartBildirimGorevi> _kayit;

    /// <summary>
    /// Yoklama aralığı. Kasadaki işlem anında bildirime dönüşmüyor ama
    /// üç dakika, alışverişten çıkarken haberdar olmak için yeterli.
    /// </summary>
    private static readonly TimeSpan Aralik = TimeSpan.FromMinutes(3);

    /// <summary>Geriye bakılan süre; kasaların merkeze geç aktarımı için.</summary>
    private const int GERI_SAAT = 24;

    private const string HAREKET = "[PosbackPromosyon].[dbo].[PuanHareket]";
    private const string KART = "[PosbackPromosyon].[dbo].[MusteriKart]";

    public GiftKartBildirimGorevi(
        IServiceProvider saglayici,
        ILogger<GiftKartBildirimGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        /* Açılışta bekleme: uygulama daha yeni ayağa kalkmışken
           yazarkasa veritabanına yüklenmek gereksiz. */
        await Task.Delay(TimeSpan.FromMinutes(2), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogError(hata, "Biçen Kart bildirim görevi çalışamadı");
            }

            await Task.Delay(Aralik, jeton);
        }
    }

    private sealed record Hareket(Guid Id, string KartNo, int Tip, decimal Tutar, DateTime Tarih, string Telefon);

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();
        var personelKaynak = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>();

        using var db = vt.Baglanti();
        using var pos = vt.PosBaglantisi();
        pos.Open();

        var posSimdi = pos.ExecuteScalar<DateTime>("SELECT GETDATE()");

        /* İlk çalıştırma: başlangıç anı işaretleniyor, geçmiş bildirilmiyor */
        var baslangic = db.ExecuteScalar<DateTime?>(
            "SELECT TOP 1 baslangic FROM KRY_KART_BILDIRIM_DURUM ORDER BY id");

        if (baslangic is null)
        {
            db.Execute("INSERT INTO KRY_KART_BILDIRIM_DURUM (baslangic) VALUES (@posSimdi)", new { posSimdi });

            _kayit.LogInformation("Biçen Kart bildirimleri başlatıldı; {Tarih} sonrası izlenecek", posSimdi);

            return;
        }

        var bas = baslangic.Value > posSimdi.AddHours(-GERI_SAAT) ? baslangic.Value : posSimdi.AddHours(-GERI_SAAT);

        /* Eşleşmiş kartlar kart no → sicil; sorguya XML listesi olarak
           gidiyor (kart numaraları yalnızca rakam). */
        var eslesme = db.Query("SELECT kart_no AS kart, personel_kodu AS kod FROM KRY_KART_ESLESME")
            .Select(x => (Kart: ((string)x.kart ?? "").Trim(), Kod: ((string)x.kod ?? "").Trim()))
            .Where(x => x.Kart.Length > 0 && x.Kart.All(char.IsDigit))
            .GroupBy(x => x.Kart)
            .ToDictionary(g => g.Key, g => g.First().Kod);

        var kartXml = "<a>" + string.Join("</a><a>", eslesme.Keys) + "</a>";

        /* Son iki dakikadaki satırlar bekletiliyor: panel ya da kasa yazmayı
           bitirmemiş olabilir. */
        var satirlar = pos.Query($@"
DECLARE @x XML = @kartXml;

SELECT
    h.Id                                              AS id,
    CONVERT(VARCHAR(50), h.KartNo)                    AS kartNo,
    h.IslemTipi                                       AS tip,
    h.Tarih                                           AS tarih,
    CASE WHEN h.IslemTipi = 2
              THEN ABS(COALESCE(NULLIF(h.EksiPuan, 0), h.Puan, 0))
         WHEN h.IslemTipi = 6
              THEN ABS(ISNULL(h.Puan, 0))
         ELSE ABS(COALESCE(NULLIF(h.Puan, 0), h.EksiPuan, 0)) END AS tutar,
    CASE WHEN k.GrupNo = 608 THEN RIGHT(CONVERT(VARCHAR(20), k.CepTel), 10) END AS telefon
FROM {HAREKET} h
    LEFT JOIN {KART} k ON k.KartNo = h.KartNo
WHERE h.Tarih >= @bas
  AND h.Tarih < DATEADD(MINUTE, -2, GETDATE())
  AND h.IslemTipi IN (1, 2, 3, 4, 5, 6, 9)
  AND (CONVERT(VARCHAR(50), h.KartNo) COLLATE DATABASE_DEFAULT IN (SELECT n.value('.', 'VARCHAR(50)') FROM @x.nodes('/a') t(n))
       OR (k.GrupNo = 608 AND k.CepTel IS NOT NULL))
ORDER BY h.Tarih",
                new { kartXml, bas }, commandTimeout: 90)
            .Select(x => new Hareket(
                (Guid)x.id,
                ((string)x.kartNo ?? "").Trim(),
                Convert.ToInt32(x.tip),
                x.tutar is null ? 0m : Convert.ToDecimal(x.tutar),
                (DateTime)x.tarih,
                (string)x.telefon))
            .ToList();

        if (satirlar.Count == 0) return;

        /* Daha önce bildirilen ya da panelin kendisi bildirdiği satırlar */
        var bilinen = new HashSet<Guid>(db.Query<Guid>(
            "SELECT hareket_id FROM KRY_KART_BILDIRILEN WHERE tarih >= DATEADD(HOUR, @saat, SYSDATETIME())",
            new { saat = -(GERI_SAAT + 48) }));

        var yeni = satirlar.Where(x => !bilinen.Contains(x.Id)).ToList();

        if (yeni.Count == 0) return;

        /* Telefonla eşleşme yalnızca panelde eşleşmesi olmayan mobil kartlar için */
        Dictionary<string, string> telefonla = null;

        string Sahip(Hareket h)
        {
            if (eslesme.TryGetValue(h.KartNo, out var kod)) return kod;
            if (string.IsNullOrWhiteSpace(h.Telefon)) return null;

            telefonla ??= personelKaynak.TumPersonelleriGetir()
                .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.Telefon))
                .GroupBy(x =>
                {
                    var t = new string(x.Telefon.Where(char.IsDigit).ToArray());
                    return t.Length >= 10 ? t[^10..] : t;
                })
                .ToDictionary(g => g.Key, g => g.First().PersonelKodu);

            return telefonla.TryGetValue(h.Telefon, out var k) ? k : null;
        }

        var giden = new List<(string Kod, string Kart, string Baslik, string Metin)>();

        /* Kart kart, tarih sırasıyla. Silme (6) Puan kadar düşüyor
           (Posback'in hesabı); sıfırlama (5) bakiyeyi sıfırlıyor. */
        foreach (var kart in yeni.GroupBy(x => x.KartNo))
        {
            var kod = Sahip(kart.First());

            if (kod is null) continue;

            foreach (var h in kart.OrderBy(x => x.Tarih))
            {
                string baslik = null, metin = null;

                switch (h.Tip)
                {
                    case 2:
                        baslik = "Biçen Kart harcaması";
                        metin = $"Kartınızla {Para(h.Tutar)} harcama yapıldı.";
                        break;

                    case 1:
                        baslik = "Biçen Kart puanı kazandınız";
                        metin = $"Kartınıza {Para(h.Tutar)} puan eklendi.";
                        break;

                    case 3:
                        baslik = "Biçen Kartınıza bakiye yüklendi";
                        metin = $"Kartınıza {Para(h.Tutar)} yüklendi.";
                        break;

                    case 9:
                        baslik = "Biçen Kart harcama iadesi";
                        metin = $"{Para(h.Tutar)} harcama iadesi kartınıza geri yüklendi.";
                        break;

                    case 4:
                        baslik = "Biçen Kartınıza bakiye aktarıldı";
                        metin = $"Kartınıza {Para(h.Tutar)} aktarıldı.";
                        break;

                    case 6:
                        baslik = "Biçen Kartınızdan bakiye silindi";
                        metin = $"Kartınızdan {Para(h.Tutar)} silindi.";
                        break;

                    case 5:
                        baslik = "Biçen Kart bakiyeniz sıfırlandı";
                        metin = "Kartınızdaki bakiye sıfırlandı.";
                        break;
                }

                if (baslik is null || (h.Tutar == 0m && h.Tip != 5)) continue;

                giden.Add((kod, h.KartNo, baslik, metin));
            }
        }

        /* Güncel bakiye metne ekleniyor; kart başına bir kez hesaplanıyor */
        var bakiyeler = new Dictionary<string, decimal?>();

        foreach (var kart in giden.Select(x => x.Kart).Distinct())
        {
            try { bakiyeler[kart] = GiftKartServisi.BakiyeSorgusu(pos, kart); }
            catch { bakiyeler[kart] = null; }
        }

        var bildirimler = giden.Select(x => (
            x.Kod,
            x.Baslik,
            bakiyeler[x.Kart] is decimal b ? $"{x.Metin} Güncel bakiyeniz: {Para(b)}" : x.Metin)).ToList();

        await bildirim.KisiyeOzelGonder(bildirimler, "giftkart");

        /* Bakılan bütün yeni satırlar işaretleniyor (bildirilmeyenler de):
           bir sonraki turda yeniden ele alınmasın. */
        foreach (var parca in yeni.Chunk(500))
            db.Execute(@"
IF NOT EXISTS (SELECT 1 FROM KRY_KART_BILDIRILEN WHERE hareket_id = @Id)
    INSERT INTO KRY_KART_BILDIRILEN (hareket_id) VALUES (@Id)", parca.Select(x => new { x.Id }));

        db.Execute("DELETE FROM KRY_KART_BILDIRILEN WHERE tarih < DATEADD(DAY, -4, SYSDATETIME())");

        if (bildirimler.Count > 0)
            _kayit.LogInformation("Biçen Kart: {Adet} hareket bildirimi gönderildi", bildirimler.Count);
    }

    private static string Para(decimal d) =>
        d.ToString("N2", new System.Globalization.CultureInfo("tr-TR")) + " ₺";
}

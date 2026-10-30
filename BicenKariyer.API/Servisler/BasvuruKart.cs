using System.Data;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe alımda tanımlanan Biçen Kart (07.10.2026).
///
/// <para>
/// İK "İşe al" derken personele verilecek kartın numarasını girmek zorunda.
/// Adayın henüz Mikro sicili yok: kart başvuruya bağlı bekler
/// (KRY_BASVURU_KART). Aday Mikro'ya kimlik numarasıyla çalışan olarak
/// işlenince <see cref="BasvuruKartGorevi"/> kartı sicile bağlar (Biçen Kart
/// sayfasındaki "Kart tanımla" ile aynı yol: MusteriKart'a ad ve telefon
/// yazılır, eşleşme kaydı ve geçmiş tutulur).
/// </para>
/// </summary>
public static class BasvuruKart
{
    private static string Rakam(string s) => new((s ?? "").Where(char.IsDigit).ToArray());
    private static string K(string s) => (s ?? "").Trim().TrimStart('0');

    /// <summary>Kart verilebilir mi; değilse hata metni.</summary>
    public static string Denetle(IDbConnection db, PersonelKaynagiServisi kaynak, string kartNo, int basvuruId)
    {
        kartNo = Rakam(kartNo);

        try
        {
            var sahip = db.QueryFirstOrDefault<string>(
                "SELECT TOP 1 personel_kodu FROM KRY_KART_ESLESME WHERE kart_no = @kartNo", new { kartNo });

            if (!string.IsNullOrWhiteSpace(sahip))
            {
                var p = kaynak.TumPersonelleriGetir()
                    .FirstOrDefault(x => x.Durum == 1 && K(x.PersonelKodu) == K(sahip));

                if (p is not null)
                {
                    /* Kart bu adayın kendisinde (08.10.2026): işe alımı daha önce
                       yapılmış, Mikro'ya işlenmiş ve kart sicile bağlanmış;
                       açılan başvuru yeni (tekrar) başvurusu. */
                    var adayKimlik = db.ExecuteScalar<string>(
                        "SELECT kimlik_no FROM KRY_BASVURULAR WHERE id = @basvuruId", new { basvuruId });

                    if (Rakam(adayKimlik).Length == 11 && Rakam(adayKimlik) == Rakam(p.KimlikNo))
                        return $"Bu kişi zaten çalışıyor: {p.Ad} {p.Soyad} ({p.PersonelKodu?.Trim()}, {p.IsGrubu?.Trim()}) "
                               + "ve bu kart kendisine tanımlı. İşe alımı daha önce yapılmış; açık olan başvuru yeni bir "
                               + "başvurusu. Tekrar işe alım gerekmiyor; başvuruyu arşivleyebilirsiniz.";

                    return $"Bu kart çalışan bir personelde: {p.Ad} {p.Soyad} ({p.PersonelKodu?.Trim()}). Başka bir kart girin.";
                }
            }
        }
        catch
        {
            /* Eşleşme tablosu okunamazsa yalnızca bekleyenler denetlenir */
        }

        try
        {
            var bekleyen = db.QueryFirstOrDefault(@"
SELECT TOP 1 basvuru_id AS id, ad_soyad AS ad FROM KRY_BASVURU_KART
WHERE kart_no = @kartNo AND basvuru_id <> @basvuruId AND personel_kodu IS NULL", new { kartNo, basvuruId });

            if (bekleyen is not null)
                return $"Bu kart başka bir işe alımda bekliyor: {bekleyen.ad} (başvuru #{bekleyen.id}).";
        }
        catch
        {
            /* Tablo henüz yoksa denetlenmez */
        }

        return null;
    }

    public static void Kaydet(IDbConnection db, int basvuruId, string kimlikNo, string adSoyad, string kartNo, string giren)
    {
        db.Execute(@"
MERGE KRY_BASVURU_KART AS h
USING (SELECT @basvuruId AS basvuru_id) AS k ON h.basvuru_id = k.basvuru_id
WHEN MATCHED THEN UPDATE SET kart_no = @kartNo, kimlik_no = @kimlik, ad_soyad = @ad, giren = @giren,
     tarih = SYSDATETIME(), personel_kodu = NULL, baglanti = NULL, hata = NULL
WHEN NOT MATCHED THEN INSERT (basvuru_id, kimlik_no, ad_soyad, kart_no, giren)
     VALUES (@basvuruId, @kimlik, @ad, @kartNo, @giren);",
            new
            {
                basvuruId,
                kimlik = Rakam(kimlikNo),
                ad = adSoyad is { Length: > 120 } ? adSoyad[..120] : adSoyad,
                kartNo = Rakam(kartNo),
                giren = giren is { Length: > 120 } ? giren[..120] : giren,
            });
    }

    /// <summary>Başvurunun kartı ve bağlanma durumu (detay ekranı)</summary>
    public static object Oku(IDbConnection db, int basvuruId)
    {
        try
        {
            var r = db.QueryFirstOrDefault(@"
SELECT kart_no, personel_kodu, baglanti, hata, tarih, giren FROM KRY_BASVURU_KART WHERE basvuru_id = @basvuruId",
                new { basvuruId });

            return r is null ? null : new
            {
                kartNo = (string)r.kart_no,
                sicil = (string)r.personel_kodu,
                baglanti = (DateTime?)r.baglanti,
                hata = (string)r.hata,
                tarih = (DateTime)r.tarih,
                giren = (string)r.giren,
            };
        }
        catch
        {
            return null;
        }
    }
}

/// <summary>
/// İşe alımda girilen kartları Mikro'ya işlenen personele bağlar. Her 15
/// dakikada bir; kimlik numarası Mikro'daki çalışan kaydıyla eşleşen
/// bekleyen kart <c>BicenKartController.DisaridanEsle</c> ile bağlanır.
/// </summary>
public class BasvuruKartGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<BasvuruKartGorevi> _kayit;

    public BasvuruKartGorevi(IServiceProvider saglayici, ILogger<BasvuruKartGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken iptal)
    {
        try { await Task.Delay(TimeSpan.FromMinutes(2), iptal); } catch { return; }

        while (!iptal.IsCancellationRequested)
        {
            try
            {
                Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İşe alım kartları bağlanamadı");
            }

            try { await Task.Delay(TimeSpan.FromMinutes(15), iptal); } catch { return; }
        }
    }

    private void Calistir()
    {
        using var kapsam = _saglayici.CreateScope();
        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();

        using var db = vt.Baglanti();

        List<dynamic> bekleyenler;

        try
        {
            bekleyenler = db.Query(@"
SELECT basvuru_id, kimlik_no, kart_no FROM KRY_BASVURU_KART
WHERE personel_kodu IS NULL AND tarih >= DATEADD(DAY, -120, SYSDATETIME())").ToList();
        }
        catch
        {
            return;
        }

        if (bekleyenler.Count == 0) return;

        var kaynak = kapsam.ServiceProvider.GetRequiredService<PersonelKaynagiServisi>();

        var calisanlar = kaynak.TumPersonelleriGetir()
            .Where(x => x.Durum == 1 && !string.IsNullOrWhiteSpace(x.KimlikNo))
            .GroupBy(x => new string(x.KimlikNo.Where(char.IsDigit).ToArray()))
            .Where(g => g.Key.Length == 11)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(x => x.GirisTarihi ?? DateTime.MinValue).First());

        var kart = kapsam.ServiceProvider.GetRequiredService<Controllers.BicenKartController>();

        foreach (var b in bekleyenler)
        {
            var kimlik = (string)b.kimlik_no ?? "";
            if (!calisanlar.TryGetValue(kimlik, out var p)) continue;

            var sicil = (p.PersonelKodu ?? "").Trim();
            var hata = kart.DisaridanEsle(sicil, (string)b.kart_no, "Sistem · işe alım kartı");

            db.Execute(hata is null
                ? "UPDATE KRY_BASVURU_KART SET personel_kodu = @sicil, baglanti = SYSDATETIME(), hata = NULL WHERE basvuru_id = @id"
                : "UPDATE KRY_BASVURU_KART SET hata = @hata WHERE basvuru_id = @id",
                new { sicil, id = (int)b.basvuru_id, hata = hata is { Length: > 300 } ? hata[..300] : hata });

            if (hata is null)
                _kayit.LogInformation("İşe alım kartı bağlandı: {Kart} → {Sicil}", (string)b.kart_no, sicil);
            else
                _kayit.LogWarning("İşe alım kartı bağlanamadı: {Kart} → {Sicil}: {Hata}", (string)b.kart_no, sicil, hata);
        }
    }
}

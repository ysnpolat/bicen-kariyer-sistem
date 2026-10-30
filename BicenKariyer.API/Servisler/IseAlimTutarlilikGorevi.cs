using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İşe alım onay tutarlılığı (21.10.2026).
///
/// <para>
/// "Onay Bekliyor"daki bir başvurunun açık (Bekliyor / Yanıt Bekliyor) bir
/// İşe Alım onayı olmalı. Olmadığında başvuru haftalarca bekliyor ama hiçbir
/// onay listesinde görünmüyordu. Görev 30 dakikada bir bakar:
/// <list type="bullet">
/// <item>son onay <b>Onaylandı</b> ise başvuru "İşe Alındı" yapılır;</item>
/// <item>son onay <b>Reddedildi</b> ise "Evrak Hazırlanıyor"a döner;</item>
/// <item>onay <b>iptal</b> olmuş ya da hiç yoksa son kayıttan yeni bir onay
/// açılır ve onay listesine düşer.</item>
/// </list>
/// Her düzeltme başvuru geçmişine yazılır.
/// </para>
/// </summary>
public class IseAlimTutarlilikGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<IseAlimTutarlilikGorevi> _kayit;

    public IseAlimTutarlilikGorevi(IServiceProvider saglayici, ILogger<IseAlimTutarlilikGorevi> kayit)
    {
        _saglayici = saglayici;
        _kayit = kayit;
    }

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(2), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                using var kapsam = _saglayici.CreateScope();
                var adet = Calistir(kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>(),
                    kapsam.ServiceProvider.GetRequiredService<OnayServisi>());
                if (adet > 0) _kayit.LogInformation("İşe alım tutarlılığı: {Adet} başvuru düzeltildi", adet);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İşe alım tutarlılık görevi çalışmadı");
            }

            await Task.Delay(TimeSpan.FromMinutes(30), jeton);
        }
    }

    public static int Calistir(VeritabaniServisi vt, OnayServisi onay)
    {
        using var db = vt.Baglanti();

        var liste = db.Query(@"
SELECT b.id, b.ad_soyad AS adSoyad, b.sube_kodu AS subeKodu, b.sube_adi AS subeAdi, b.guncelleyen,
       o.id AS onayId, o.durum AS onayDurum, o.baslik, o.ozet, o.veri_json AS veri, o.isteyen,
       o.sube_kodu AS oSube, o.sube_adi AS oSubeAdi
FROM KRY_BASVURULAR b
OUTER APPLY (SELECT TOP 1 * FROM KRY_ONAY x
             WHERE x.basvuru_id = b.id AND x.tur = @tur ORDER BY x.id DESC) o
WHERE b.durum = @onayBekliyor",
            new { tur = OnayTuru.IseAlim, onayBekliyor = Durumlar.OnayBekliyor }).ToList();

        var duzeltilen = 0;

        foreach (var r in liste)
        {
            var durum = (string)r.onayDurum;
            int id = r.id;

            if (durum == OnayDurumu.Bekliyor || durum == OnayDurumu.YanitBekliyor) continue;

            string yeni = null, aciklama;

            if (durum == OnayDurumu.Onaylandi)
            {
                yeni = Durumlar.IseAlindi;
                aciklama = "Onay kaydı onaylanmıştı; başvuru durumu düzeltildi (sistem).";
            }
            else if (durum == OnayDurumu.Reddedildi)
            {
                yeni = Durumlar.EvrakHazirlaniyor;
                aciklama = "Onay reddedilmişti; başvuru durumu düzeltildi (sistem).";
            }
            else
            {
                /* İptal ya da hiç yok: yeniden onaya sun */
                onay.Olustur(
                    OnayTuru.IseAlim,
                    (string)r.baslik ?? $"{(string)r.adSoyad} · YENİ İŞE ALIM",
                    "Yeniden onaya sunuldu (açık onay kaydı yoktu) · " + ((string)r.ozet ?? ""),
                    r.veri is string v && v.Length > 0 ? System.Text.Json.JsonSerializer.Deserialize<object>(v) : null,
                    (string)r.isteyen ?? (string)r.guncelleyen ?? "sistem",
                    basvuruId: id,
                    subeKodu: (string)r.oSube ?? (string)r.subeKodu,
                    subeAdi: (string)r.oSubeAdi ?? (string)r.subeAdi);

                db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @durum, N'Açık onay kaydı bulunamadı; yeniden onaya sunuldu (sistem).', N'sistem')",
                    new { id, durum = Durumlar.OnayBekliyor });

                duzeltilen++;
                continue;
            }

            var n = db.Execute(@"
UPDATE KRY_BASVURULAR SET durum = @yeni, guncelleme = SYSDATETIME(), guncelleyen = N'sistem'
WHERE id = @id AND durum = @onayBekliyor",
                new { id, yeni, onayBekliyor = Durumlar.OnayBekliyor });

            if (n > 0)
            {
                db.Execute(@"
INSERT INTO KRY_BASVURU_HAREKET (basvuru_id, durum, aciklama, kullanici)
VALUES (@id, @yeni, @aciklama, N'sistem')", new { id, yeni, aciklama });
                duzeltilen++;
            }
        }

        return duzeltilen;
    }
}

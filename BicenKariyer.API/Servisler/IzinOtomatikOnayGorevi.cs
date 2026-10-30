using Dapper;
using BicenKariyer.API.Controllers;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// İzin talebi: birim yöneticisi süresinde karar vermezse otomatik onay
/// ---------------------------------------------------------------------------
/// Talep 1. aşamada (birim yöneticisi, durum "Bekliyor") <see cref="SureSaat"/>
/// saatten uzun beklerse sistem birim yöneticisi adına onaylıyor ve talep
/// bir sonraki aşamaya (üst yönetici ya da İK) geçiyor. Onay, panel ve
/// mobildeki kararla aynı yordamdan geçiyor (IzinTalepController.KararIsle):
/// hareket kaydı, personele bildirim, sonraki aşamaya haber.
///
/// <para>
/// Süre dolmadan 24 saat önce birim yöneticilerine bir kez "yarın otomatik
/// onaylanacak" hatırlatması gidiyor. Yalnızca 1. aşama: üst yönetici ve
/// İK aşamaları otomatik geçmiyor. Bildirim gece gitmesin diye 08:00–21:00
/// arası çalışıyor; gece dolan süre sabah işleniyor.
/// </para>
///
/// <para>Süre appsettings'te <c>IzinTalep:OtomatikOnaySaat</c> (varsayılan 48; 0 kapalı).</para>
/// </summary>
public class IzinOtomatikOnayGorevi : BackgroundService
{
    private readonly IServiceProvider _saglayici;
    private readonly ILogger<IzinOtomatikOnayGorevi> _kayit;
    private readonly IConfiguration _yapilandirma;

    public IzinOtomatikOnayGorevi(IServiceProvider saglayici, ILogger<IzinOtomatikOnayGorevi> kayit,
        IConfiguration yapilandirma)
    {
        _saglayici = saglayici;
        _kayit = kayit;
        _yapilandirma = yapilandirma;
    }

    private int SureSaat =>
        Parametre.Sayi("izin.otomatikOnaySaat"); /* Ayarlar Merkezi; appsettings yedek */

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(5), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                if (SureSaat > 0 && Parametre.SaatAraliginda("gorev.baslangicSaat", "gorev.bitisSaat"))
                    await Calistir();
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İzin otomatik onay görevi çalışmadı");
            }

            await Task.Delay(TimeSpan.FromMinutes(20), jeton);
        }
    }

    private async Task Calistir()
    {
        using var kapsam = _saglayici.CreateScope();

        var vt = kapsam.ServiceProvider.GetRequiredService<VeritabaniServisi>();
        var orgOnay = kapsam.ServiceProvider.GetRequiredService<OrgOnayServisi>();
        var bildirim = kapsam.ServiceProvider.GetRequiredService<BildirimServisi>();

        var sure = SureSaat;
        var simdi = DateTime.Now;

        List<dynamic> bekleyenler;

        using (var db = vt.Baglanti())
        {
            bekleyenler = db.Query(@"
SELECT id, personel_kodu, ad_soyad, gorev, sube_adi, tur, cikis_tarihi, donus_tarihi, olusturma,
       CAST(ISNULL(form_sarti, 0) AS BIT) AS formSarti, zincir, asama
FROM KRY_IZIN_TALEP
WHERE iptal = 0 AND durum = N'Bekliyor' AND olusturma <= @sinir
ORDER BY olusturma",
                new { sinir = simdi.AddHours(-(sure - 24)) }).ToList();
        }

        foreach (var t in bekleyenler)
        {
            var id = (int)t.id;
            var olusturma = (DateTime)t.olusturma;

            /* Şube personeli: imzalı form yüklenmeden onay yok; süre formun
               yüklendiği andan başlıyor (07.10.2026) */
            if (t.formSarti == true)
            {
                using var dbf = vt.Baglanti();
                if (IzinEvrak.FormZamani(dbf, id) is not DateTime fz) continue;
                if (fz > olusturma) olusturma = fz;
                if (olusturma.AddHours(sure - 24) > simdi) continue;
            }
            var dolus = olusturma.AddHours(sure);

            try
            {
                if (dolus <= simdi)
                {
                    /* Süre doldu: birim yöneticisi adına onay */
                    var talepler = kapsam.ServiceProvider.GetRequiredService<IzinTalepController>();
                    var sonuc = await talepler.OtomatikOnayla(id, sure);

                    _kayit.LogInformation("İzin talebi {Id} {Saat} saat beklediği için otomatik onaylandı: {Sonuc}",
                        id, sure, sonuc);
                    continue;
                }

                /* Son 24 saat: birim yöneticilerine bir kez hatırlatma */
                using var db = vt.Baglanti();

                if (!MazeretBelgeGorevi.BirKez(db, $"izin-otomatik-uyari|{id}")) continue;

                /* Zincirli talepte (26.10.2026) ilk adımın onaylayanları zincirden */
                List<PersonelKaydi> birim;

                if (IzinOnayZinciri.Talepten((object)t) is { } zt)
                {
                    var ekip = kapsam.ServiceProvider.GetRequiredService<EkipServisi>();
                    birim = zt.Zincir.Adimlar[0].Kodlar.Select(k => ekip.Kisi(k)).Where(x => x is not null).ToList();
                }
                else
                {
                    (birim, _, _, _) = orgOnay.Onaylayicilar(
                        (string)t.personel_kodu, (string)t.gorev, (string)t.sube_adi);
                }

                var metin = $"{t.ad_soyad} · {t.tur} · {((DateTime)t.cikis_tarihi):dd.MM} – {((DateTime)t.donus_tarihi):dd.MM}. "
                            + $"{dolus:dd.MM HH:mm}'e kadar karar vermezseniz sistem otomatik onaylayacak.";

                foreach (var y in birim)
                    await bildirim.Gonder((y.PersonelKodu ?? "").Trim(), "İzin talebi onayınızı bekliyor", metin, "izinonay|izin");

                if (birim.Count > 0)
                    IzinHareket.Yaz(db, id, IzinHareket.Hatirlatma, "Birim yöneticisine otomatik onay hatırlatması",
                        metin, "Sistem",
                        string.Join(", ", birim.Take(6).Select(x => $"{x.Ad} {x.Soyad}".Trim())),
                        IzinHareket.Uygulama);
            }
            catch (Exception hata)
            {
                _kayit.LogWarning(hata, "İzin talebi {Id} otomatik onay/hatırlatma işlenemedi", id);
            }
        }
    }
}

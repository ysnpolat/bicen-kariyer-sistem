using Dapper;
using Bicen360.API.Controllers;

namespace Bicen360.API.Servisler;

/// <summary>
/// SKT aylık planı otomatik (26.10.2026).
/// <para>
/// Her ay her şubeye bir kategori düşüyor; bir sonraki ay o kategoriyi
/// listedeki sonraki şube kontrol ediyor. Eskiden portalda "… planını
/// oluştur" düğmesine basılıyordu. Görev saatte bir bakar:
/// </para>
/// <list type="bullet">
/// <item>Ayın <c>Skt:OtomatikGun</c>'ünden (varsayılan 25) itibaren gelecek
/// ayın planı yoksa bu ayın planı kaydırılarak oluşturulur.</item>
/// <item>Ayın ilk günlerinde bu ayın planı hiç yoksa (sunucu kapalı kalmış
/// ya da plan silinmiş) geçen ayınkinden oluşturulur.</item>
/// </list>
/// <para>
/// Planı elle kurulmuş (Excel, elle ekleme) ay atlanır; var olan plana
/// dokunulmaz. Oluşturan "otomatik" yazılır. Kapatmak için
/// <c>Skt:OtomatikPlan = false</c>.
/// </para>
/// </summary>
public class SktOtomatikPlanGorevi : BackgroundService
{
    private readonly VeritabaniServisi _vt;
    private readonly IConfiguration _yap;
    private readonly ILogger<SktOtomatikPlanGorevi> _kayit;

    public SktOtomatikPlanGorevi(VeritabaniServisi vt, IConfiguration yap, ILogger<SktOtomatikPlanGorevi> kayit)
    {
        _vt = vt;
        _yap = yap;
        _kayit = kayit;
    }

    public static bool Acik(IConfiguration y) => !string.Equals(y["Skt:OtomatikPlan"], "false", StringComparison.OrdinalIgnoreCase);

    public static int Gun(IConfiguration y) => int.TryParse(y["Skt:OtomatikGun"], out var g) && g is >= 1 and <= 28 ? g : 25;

    private static string Ay(DateTime t) => t.ToString("yyyy-MM");

    protected override async Task ExecuteAsync(CancellationToken jeton)
    {
        await Task.Delay(TimeSpan.FromMinutes(4), jeton);

        while (!jeton.IsCancellationRequested)
        {
            try
            {
                if (Acik(_yap)) Calis(DateTime.Today);
            }
            catch (Exception h)
            {
                _kayit.LogWarning(h, "SKT otomatik plan oluşturulamadı");
            }

            await Task.Delay(TimeSpan.FromHours(1), jeton);
        }
    }

    public void Calis(DateTime bugun)
    {
        using var db = _vt.Baglanti();
        if (db.ExecuteScalar<int>("SELECT CASE WHEN OBJECT_ID('B360_SKT_PLAN') IS NULL THEN 0 ELSE 1 END") == 0) return;

        int Say(string ay) => db.ExecuteScalar<int>("SELECT COUNT(*) FROM B360_SKT_PLAN WHERE silindi = 0 AND ay = @ay", new { ay });

        var buAy = Ay(bugun);
        var gecenAy = Ay(bugun.AddMonths(-1));
        var gelecekAy = Ay(bugun.AddMonths(1));

        /* 26.10.2026: kaynak Mikro stok ana grupları (varsayılan). Skt:Kaynak
           = "kaydir" verilirse eski yol: geçen ayın planı kaydırılır. */
        var anaGrup = !string.Equals(_yap["Skt:Kaynak"], "kaydir", StringComparison.OrdinalIgnoreCase);

        void Kur(string ay, string kaynakAy)
        {
            if (anaGrup)
            {
                var (p, u) = SktController.AnaGruplardanOlustur(_vt, _yap, ay, "otomatik", false);
                _kayit.LogInformation("SKT planı ana gruplardan oluşturuldu: {Ay} ({Plan} şube, {Urun} ürün)", ay, p, u);
            }
            else if (Say(kaynakAy) > 0)
            {
                var n = SktController.KaydirIc(db, kaynakAy, ay, 1, "otomatik", false);
                _kayit.LogInformation("SKT planı otomatik oluşturuldu: {Ay} ({Adet} şube, {Kaynak} kaydırıldı)", ay, n, kaynakAy);
            }
        }

        /* Bu ay planı yoksa */
        if (Say(buAy) == 0) Kur(buAy, gecenAy);

        /* Ayın belirli gününden itibaren gelecek ay */
        if (bugun.Day >= Gun(_yap) && Say(gelecekAy) == 0) Kur(gelecekAy, buAy);
    }
}

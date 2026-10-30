using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Biçen360 modül kullanımı (16.10.2026): personel uygulamada hangi
/// ekranı ne sıklıkla açıyor.
///
/// <para>
/// Uygulama güncellemesi gerekmesin diye sunucuda tutuluyor: her ekranın
/// açılırken çağırdığı, yalnızca o ekrana özgü uç bir modüle eşleniyor.
/// Aynı kişinin aynı modülü 15 dakika içinde tekrar açması tek kullanım
/// sayılıyor (ekran yenilemeleri, sayfa içi istekler sayıyı şişirmesin).
/// Ana sayfanın kendisi de duyuru ve Biçen Kart çağırdığı için bu ikisi
/// ana sayfadan hemen sonra geldiyse sayılmıyor.
/// </para>
///
/// <para>
/// Günlük satır: KRY_MOBIL_MODUL_KULLANIM (tarih, personel, modül, sayı).
/// İki API (Kariyer ve Biçen360) aynı tabloya yazıyor. Yazma isteğin
/// yanıtı gönderildikten sonra yapılıyor; hata isteği etkilemiyor.
/// </para>
/// </summary>
public static class ModulKullanimi
{
    /// <summary>(yöntem, yol deseni, modül). İlk eşleşen geçerli.</summary>
    private static readonly (string Yontem, Regex Yol, string Modul)[] Kurallar = new[]
    {
        K("GET", "/api/FiyatKontrol/(Sorgula|Sube)", "fiyatkontrol"),
        K("POST", "/api/FiyatKontrol/ListeGonder", "fiyatkontrol"),
        K("GET", "/api/RakipFiyat/(Form|Sorgula|Son|Bugun)", "rakipfiyat"),
        K("GET", "/api/Ariza/(Form|Kayitlarim|[0-9]+)", "ariza"),
        K("POST", "/api/Ariza", "ariza"),
        K("GET", "/api/Mobil/(Envanterim|EnvanterBul|EnvanterSubeleri)", "envanter"),
        K("GET", "/api/ServisFormu(/.*)?", "servisformu"),
        K("POST", "/api/ServisFormu(/.*)?", "servisformu"),
    };

    private static (string, Regex, string) K(string yontem, string desen, string modul) =>
        (yontem, new Regex("^" + desen + "$", RegexOptions.IgnoreCase | RegexOptions.Compiled), modul);

    private static readonly TimeSpan Pencere = TimeSpan.FromMinutes(15);
    private static readonly ConcurrentDictionary<string, DateTime> Son = new();
    private static readonly ConcurrentDictionary<string, DateTime> AnaSayfa = new();
    private static int _tablo; /* 0 bilinmiyor, 1 var */

    /// <summary>Ara katman: modülü bulup yanıt sonrası sayar.</summary>
    public static void Kaydet(HttpContext baglam)
    {
        try
        {
            var ad = baglam.User?.Identity?.Name ?? "";
            if (!ad.StartsWith("personel:", StringComparison.OrdinalIgnoreCase)) return;

            var govde = ad["personel:".Length..];
            var i = govde.IndexOf('|');
            var kod = (i < 0 ? govde : govde[..i]).Trim();
            if (kod.Length == 0) return;

            var yol = baglam.Request.Path.Value ?? "";
            var yontem = baglam.Request.Method;
            var sorgu = baglam.Request.QueryString.Value ?? "";
            var simdi = DateTime.Now;

            string modul = null;
            foreach (var (y, r, m) in Kurallar)
                if ((y == "*" || string.Equals(y, yontem, StringComparison.OrdinalIgnoreCase)) && r.IsMatch(yol))
                {
                    modul = m;
                    break;
                }

            if (modul is null) return;

            if (modul == "anasayfa") AnaSayfa[kod] = simdi;

            /* Ana sayfanın kendi çağrıları */
            if (modul is "duyuru" or "bicenkart" && AnaSayfa.TryGetValue(kod, out var a) && simdi - a < TimeSpan.FromSeconds(8))
                return;
            if (modul == "ariza" && yontem == "GET" && yol.EndsWith("/Kayitlarim", StringComparison.OrdinalIgnoreCase)
                && sorgu.Equals("?kapsam=benim", StringComparison.OrdinalIgnoreCase))
                return;

            var anahtar = kod + "|" + modul;
            if (Son.TryGetValue(anahtar, out var s) && simdi - s < Pencere) return;
            Son[anahtar] = simdi;

            if (Son.Count > 50000) Son.Clear();

            var vt = baglam.RequestServices.GetService<VeritabaniServisi>();
            if (vt is null) return;

            baglam.Response.OnCompleted(() =>
            {
                if (baglam.Response.StatusCode >= 400) return Task.CompletedTask;

                try
                {
                    using var db = vt.Baglanti();
                    TabloKur(db);
                    db.Execute(@"
UPDATE KRY_MOBIL_MODUL_KULLANIM SET sayi = sayi + 1, son = SYSDATETIME()
WHERE tarih = CAST(GETDATE() AS DATE) AND personel_kodu = @kod AND modul = @modul;
IF @@ROWCOUNT = 0
    INSERT INTO KRY_MOBIL_MODUL_KULLANIM (tarih, personel_kodu, modul, sayi, ilk, son)
    VALUES (CAST(GETDATE() AS DATE), @kod, @modul, 1, SYSDATETIME(), SYSDATETIME());",
                        new { kod, modul });
                }
                catch
                {
                    /* Kullanım kaydı tutulamazsa bir şey olmaz */
                }

                return Task.CompletedTask;
            });
        }
        catch
        {
            /* İstek etkilenmez */
        }
    }

    public static void TabloKur(System.Data.IDbConnection db)
    {
        if (_tablo == 1) return;

        db.Execute(@"
IF OBJECT_ID('KRY_MOBIL_MODUL_KULLANIM') IS NULL
BEGIN
    CREATE TABLE KRY_MOBIL_MODUL_KULLANIM (
        tarih          DATE          NOT NULL,
        personel_kodu  NVARCHAR(20)  NOT NULL,
        modul          NVARCHAR(30)  NOT NULL,
        sayi           INT           NOT NULL DEFAULT 1,
        ilk            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        son            DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
        CONSTRAINT PK_KRY_MOBIL_MODUL_KULLANIM PRIMARY KEY (tarih, personel_kodu, modul)
    );
    CREATE INDEX IX_KRY_MOBIL_MODUL_KULLANIM_MODUL ON KRY_MOBIL_MODUL_KULLANIM (modul, tarih);
END");
        _tablo = 1;
    }
}

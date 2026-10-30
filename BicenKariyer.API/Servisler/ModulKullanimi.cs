using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Dapper;

namespace BicenKariyer.API.Servisler;

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
        K("GET", "/api/Mobil/Ozet", "anasayfa"),
        K("GET", "/api/Mobil/Vardiya", "vardiya"),
        K("POST", "/api/Mobil/VardiyaOkut", "okutma"),
        K("POST", "/api/Mobil/Itiraz", "manuelgiris"),
        K("GET", "/api/Mobil/Izin", "izin"),
        K("POST", "/api/IzinTalep", "izintalebi"),
        K("GET", "/api/Avans/Benim", "avans"),
        K("POST", "/api/Avans/Talep", "avanstalebi"),
        K("GET", "/api/YoneticiIslem/Mobil/Surec", "yonetici"),
        K("POST", "/api/IzinTalep/Mobil/[0-9]+/Karar", "onay"),
        K("POST", "/api/HaftalikIzin/Onay/.*", "onay"),
        K("GET", "/api/Ekip/Ekibim", "ekibim"),
        K("POST", "/api/FazlaMesai/Mobil", "fazlamesai"),
        K("POST", "/api/Rotasyon/Mobil", "rotasyon"),
        K("GET", "/api/Ekip/Puantaj/Kapsam", "puantaj"),
        K("GET", "/api/VardiyaPlan/Ekip", "vardiyaplani"),
        K("GET", "/api/VardiyaPlan/Benim", "vardiyaplani"),
        K("GET", "/api/Mobil/Duyurular", "duyuru"),
        K("GET", "/api/Mobil/Performans", "performans"),
        K("GET", "/api/Mobil/Prim", "prim"),
        K("GET", "/api/Haber/Akis", "haberler"),
        K("GET", "/api/Mobil/Checklistlerim", "checklist"),
        K("POST", "/api/Mobil/(IsEmriGordum|IsEmriDoldur|IsEmriBitir|IsEmriAta)(/.*)?", "isemri"),
        K("GET", "/api/Mobil/IsAtanabilecekler", "isemri"),
        K("GET", "/api/Mobil/(Belgelerim|Pusulalarim)", "bilgilerim"),
        K("GET", "/api/Mobil/GiftKart", "bicenkart"),
        K("GET", "/api/Etik/Secenekler", "etik"),
        K("GET", "/api/KazanKazan/Ozet", "kazankazan"),
        K("GET", "/api/DonemselDegerlendirme/Mobil/Ekip", "ekipdegerlendirme"),
        K("GET", "/api/Mobil/(Rapor|IKRapor)", "raporlar"),
        K("GET", "/api/Kunye/Oku", "kunye"),
        K("GET", "/api/PatronMobil/(?!Foto).*", "patron"),
        K("GET", "/api/Egitim/Benim", "egitim"),
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

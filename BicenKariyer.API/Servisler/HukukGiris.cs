using System.Security.Cryptography;
using System.Text;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Dış hukuk danışmanının kimlik numarası + telefon + SMS koduyla girişi
/// (24.10.2026). Kimlik numarası saklanmaz: yalnız HMAC özeti ve son iki
/// hanesi (panelde ayırt etmek için) tutulur. Mobil giriş ekranı
/// (/api/Mobil/KodIste, KodDogrula) ve panel (/api/Hukuk/Giris) aynı
/// yardımcıyı kullanır.
/// </summary>
public static class HukukGiris
{
    public const int KodDakika = 3;

    private static byte[] Anahtar(IConfiguration y)
    {
        var ham = y["Jwt:Anahtar"];
        if (string.IsNullOrWhiteSpace(ham) || ham.Trim().Length < 16)
            throw new InvalidOperationException("Hukuk girişi için sunucu anahtarı (Jwt:Anahtar) yok.");
        return HMACSHA256.HashData(Encoding.UTF8.GetBytes(ham.Trim()), Encoding.UTF8.GetBytes("bicen-hukuk-tc-v1"));
    }

    /// <summary>11 haneli kimlik numarası; değilse null.</summary>
    public static string KimlikNormal(string s)
    {
        var r = new string((s ?? "").Where(char.IsDigit).ToArray());
        return r.Length == 11 && r[0] != '0' ? r : null;
    }

    public static string KimlikOzeti(IConfiguration y, string tc) =>
        Convert.ToHexString(HMACSHA256.HashData(Anahtar(y), Encoding.UTF8.GetBytes("huk-tc:" + tc)));

    public static string TelefonNormal(string s)
    {
        var r = new string((s ?? "").Where(char.IsDigit).ToArray());
        return r.Length >= 10 ? r[^10..] : r;
    }

    /// <summary>Kimlik numarasıyla aktif danışman; yoksa null.</summary>
    public static dynamic Bul(System.Data.IDbConnection db, IConfiguration y, string tc)
    {
        var n = KimlikNormal(tc);
        if (n is null) return null;
        return db.QueryFirstOrDefault("SELECT * FROM KRY_HUK_DANISMAN WHERE tc_ozet = @o AND aktif = 1", new { o = KimlikOzeti(y, n) });
    }

    public static bool TelefonEsit(dynamic d, string telefon)
    {
        var k = TelefonNormal((string)d.telefon);
        var t = TelefonNormal(telefon);
        return k.Length == 10 && t.Length == 10 && k == t;
    }

    /// <summary>Yeni kod üretir (öncekiler geçersiz), SMS'i gönderir. Hata metni döner; başarıda null.</summary>
    public static async Task<(string Hata, string Gecici)> KodGonder(System.Data.IDbConnection db, SmsServisi sms, dynamic d)
    {
        var son = db.ExecuteScalar<DateTime?>("SELECT MAX(olusturma) FROM KRY_HUK_DANISMAN_KOD WHERE danisman_id = @id AND kullanildi = 0",
            new { id = (int)d.id });
        if (son is not null && (DateTime.Now - son.Value).TotalSeconds < 60)
            return ($"Yeni kod için {60 - (int)(DateTime.Now - son.Value).TotalSeconds} saniye bekleyiniz.", null);
        if (!sms.Etkin) return ("SMS servisi kapalı; giriş kodu gönderilemiyor.", null);

        var gecici = Guid.NewGuid().ToString("N");
        var kod = RandomNumberGenerator.GetInt32(100000, 1_000_000).ToString();
        db.Execute(@"DELETE FROM KRY_HUK_DANISMAN_KOD WHERE danisman_id = @id OR gecerlilik < DATEADD(DAY, -1, SYSDATETIME());
INSERT INTO KRY_HUK_DANISMAN_KOD (gecici, danisman_id, kod, gecerlilik) VALUES (@gecici, @id, @kod, DATEADD(MINUTE, @dk, SYSDATETIME()))",
            new { gecici, id = (int)d.id, kod, dk = KodDakika });
        var r = await sms.Gonder(TelefonNormal((string)d.telefon), $"Bicen Hukuk Masasi giris kodunuz: {kod}. Kodu kimseyle paylasmayiniz.");
        return r.Basarili ? (null, gecici) : ("Doğrulama kodu gönderilemedi. Biçen İK ile iletişime geçiniz.", null);
    }

    /// <summary>Kodu doğrular. Başarıda danışman kaydı, değilse hata metni.</summary>
    public static (dynamic Danisman, string Hata) KodDogrula(System.Data.IDbConnection db, int danismanId, string kod, string gecici = null)
    {
        var k = db.QueryFirstOrDefault(@"SELECT TOP 1 * FROM KRY_HUK_DANISMAN_KOD
WHERE danisman_id = @id AND kullanildi = 0 AND gecerlilik > SYSDATETIME() AND (@g IS NULL OR gecici = @g)
ORDER BY olusturma DESC", new { id = danismanId, g = gecici });
        if (k is null) return (null, "Kodun süresi doldu; yeni kod isteyiniz.");
        if ((string)k.kod != (kod ?? "").Trim())
        {
            db.Execute("UPDATE KRY_HUK_DANISMAN_KOD SET deneme = deneme + 1, kullanildi = CASE WHEN deneme >= 4 THEN 1 ELSE 0 END WHERE gecici = @g",
                new { g = (string)k.gecici });
            return (null, (int)k.deneme >= 4 ? "Çok fazla hatalı deneme. Yeni kod isteyiniz." : "Kod hatalı ya da süresi dolmuş.");
        }
        db.Execute("UPDATE KRY_HUK_DANISMAN_KOD SET kullanildi = 1 WHERE gecici = @g", new { g = (string)k.gecici });
        var d = db.QueryFirstOrDefault("SELECT * FROM KRY_HUK_DANISMAN WHERE id = @id AND aktif = 1", new { id = danismanId });
        return d is null ? (null, "Hesap pasif.") : (d, null);
    }

    public static string TamAd(dynamic d) =>
        string.IsNullOrWhiteSpace((string)d.unvan) ? (string)d.ad_soyad : $"{(string)d.unvan} {(string)d.ad_soyad}";

    /// <summary>Danışman oturum belirteci (mobil 30 gün, panel 12 saat).</summary>
    public static (string Token, DateTime Bitis) Belirtec(JwtServisi jwt, dynamic d, bool mobil) =>
        jwt.Uret(new BicenKariyer.API.Kullanici
        {
            Id = (int)d.id,
            KullaniciAdi = "hd:" + (string)d.kullanici_adi,
            AdSoyad = TamAd(d),
            Rol = "HukukDanisman",
        }, saatAsim: mobil ? 24 * 30 : 12);
}

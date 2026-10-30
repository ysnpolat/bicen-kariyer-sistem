using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Mikro kullanıcı numarası → ad (07.10.2026).
///
/// <para>
/// Mikro, personel kartını son değiştireni kullanıcı numarasıyla tutuyor
/// (per_lastup_user, ör. 130). Panelde "Yapan: 130" yazıyordu. Ad, Mikro
/// sunucusundaki Mikro* veritabanlarının KULLANICILAR tablosundan
/// bulunuyor (tablo ve kolon adları sürüme göre değiştiği için aranıyor).
/// Bulunamayan ya da yanlış görünen numaralar Yönetim › Mikro kullanıcı
/// adları ekranından elle yazılabiliyor; elle yazılan önce gelir.
/// </para>
/// </summary>
public static class MikroKullanicilari
{
    public const string Anahtar = "MIKRO_KULLANICI";

    private static VeritabaniServisi _vt;
    private static Dictionary<string, string> _bulunan = new(StringComparer.OrdinalIgnoreCase);
    private static Dictionary<string, string> _elle = new(StringComparer.OrdinalIgnoreCase);
    private static string _kaynak;
    private static string _hata;
    private static DateTime _okunma = DateTime.MinValue;
    private static readonly object Kilit = new();

    public static void Baslat(VeritabaniServisi vt) => _vt = vt;

    public static string Kaynak => _kaynak;
    public static string Hata => _hata;

    public static IReadOnlyDictionary<string, string> Bulunan { get { Yenile(); return _bulunan; } }
    public static IReadOnlyDictionary<string, string> Elle { get { Yenile(); return _elle; } }

    public static void OnbellekTemizle() => _okunma = DateTime.MinValue;

    private static readonly Regex GuvenliAd = new("^[A-Za-z0-9_]+$", RegexOptions.Compiled);

    private static void Yenile()
    {
        if (DateTime.Now - _okunma < TimeSpan.FromMinutes(60) || _vt is null) return;

        lock (Kilit)
        {
            if (DateTime.Now - _okunma < TimeSpan.FromMinutes(60)) return;
            _okunma = DateTime.Now;

            /* Elle yazılanlar */
            try
            {
                using var db = _vt.Baglanti();
                var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = Anahtar });
                var d = string.IsNullOrWhiteSpace(ham) ? null : JsonSerializer.Deserialize<Dictionary<string, string>>(ham);
                _elle = new Dictionary<string, string>(d ?? new(), StringComparer.OrdinalIgnoreCase);
            }
            catch
            {
                /* ayar okunamazsa önceki */
            }

            /* Mikro'daki tablo */
            try
            {
                using var m = _vt.PersonelBaglantisi();

                var dbler = m.Query<string>(
                        "SELECT name FROM sys.databases WHERE name LIKE N'Mikro%' AND state = 0 ORDER BY name")
                    .Where(x => GuvenliAd.IsMatch(x ?? ""))
                    .ToList();

                foreach (var veritabani in dbler)
                {
                    List<string> kolonlar;

                    try
                    {
                        kolonlar = m.Query<string>($@"
SELECT name FROM [{veritabani}].sys.columns
WHERE object_id = OBJECT_ID(N'[{veritabani}].dbo.KULLANICILAR')").ToList();
                    }
                    catch
                    {
                        continue;
                    }

                    if (kolonlar.Count == 0) continue;

                    string Bul(params string[] adaylar) =>
                        adaylar.Select(a => kolonlar.FirstOrDefault(k => string.Equals(k, a, StringComparison.OrdinalIgnoreCase)))
                            .FirstOrDefault(x => x is not null);

                    var no = Bul("User_no", "kul_no", "KullaniciNo", "no");
                    var uzun = Bul("User_LongName", "kul_tam_adi", "kul_uzun_adi", "AdSoyad");
                    var kisa = Bul("User_name", "kul_adi", "KullaniciAdi", "ad");

                    if (no is null || (uzun is null && kisa is null)) continue;
                    if (!GuvenliAd.IsMatch(no) || (uzun is not null && !GuvenliAd.IsMatch(uzun)) || (kisa is not null && !GuvenliAd.IsMatch(kisa)))
                        continue;

                    var adSecimi = uzun is not null && kisa is not null
                        ? $"ISNULL(NULLIF(LTRIM(RTRIM(CAST([{uzun}] AS NVARCHAR(100)))), N''), CAST([{kisa}] AS NVARCHAR(100)))"
                        : $"CAST([{uzun ?? kisa}] AS NVARCHAR(100))";

                    var satirlar = m.Query<(string No, string Ad)>($@"
SELECT CAST([{no}] AS NVARCHAR(20)), {adSecimi}
FROM [{veritabani}].dbo.KULLANICILAR").ToList();

                    var sozluk = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var (n, a) in satirlar)
                        if (!string.IsNullOrWhiteSpace(n) && !string.IsNullOrWhiteSpace(a))
                            sozluk[n.Trim()] = a.Trim();

                    if (sozluk.Count == 0) continue;

                    _bulunan = sozluk;
                    _kaynak = $"{veritabani}.dbo.KULLANICILAR";
                    _hata = null;
                    return;
                }

                _hata = "Mikro sunucusunda KULLANICILAR tablosu bulunamadı.";
            }
            catch (Exception h)
            {
                _hata = h.Message.Length > 200 ? h.Message[..200] : h.Message;
            }
        }
    }

    /// <summary>"130" → "Ayşe Kaya"; bulunamazsa "Mikro kullanıcısı 130"; sayı değilse olduğu gibi</summary>
    public static string Ad(string no)
    {
        var n = (no ?? "").Trim();
        if (n.Length == 0) return no;
        if (!n.All(char.IsDigit)) return no;

        Yenile();

        if (_elle.TryGetValue(n, out var e) && !string.IsNullOrWhiteSpace(e)) return e.Trim();
        if (_bulunan.TryGetValue(n, out var b) && !string.IsNullOrWhiteSpace(b)) return b.Trim();

        return $"Mikro kullanıcısı {n}";
    }

    /// <summary>Elle yazılan adları kaydeder</summary>
    public static void ElleYaz(System.Data.IDbConnection db, Dictionary<string, string> sozluk)
    {
        var temiz = (sozluk ?? new())
            .Where(x => !string.IsNullOrWhiteSpace(x.Key) && x.Key.Trim().All(char.IsDigit) && !string.IsNullOrWhiteSpace(x.Value))
            .Take(500)
            .ToDictionary(x => x.Key.Trim(), x => x.Value.Trim().Length > 80 ? x.Value.Trim()[..80] : x.Value.Trim());

        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @a AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@a, @d, SYSDATETIME());",
            new { a = Anahtar, d = JsonSerializer.Serialize(temiz) });

        OnbellekTemizle();
    }

    /// <summary>
    /// Eski kayıtlarda kalan numaraları ada çevirir (değişiklik günlüğü,
    /// onay kayıtları). Personel değişim görevi her çalıştığında çağırır;
    /// çevrilecek kayıt kalmayınca bir şey yapmaz.
    /// </summary>
    public static void EskiKayitlariDuzelt(System.Data.IDbConnection db)
    {
        try
        {
            var numaralar = db.Query<string>(@"
SELECT DISTINCT mikro_kullanici FROM KRY_PERSONEL_DEGISIM
WHERE mikro_kullanici IS NOT NULL AND mikro_kullanici NOT LIKE N'%[^0-9]%'
UNION
SELECT DISTINCT isteyen FROM KRY_ONAY
WHERE isteyen IS NOT NULL AND isteyen NOT LIKE N'%[^0-9]%' AND LEN(isteyen) BETWEEN 1 AND 6").ToList();

            foreach (var no in numaralar.Where(x => !string.IsNullOrWhiteSpace(x)))
            {
                var ad = Ad(no);
                if (ad.StartsWith("Mikro kullanıcısı", StringComparison.Ordinal)) continue;

                db.Execute("UPDATE KRY_PERSONEL_DEGISIM SET mikro_kullanici = @ad WHERE mikro_kullanici = @no",
                    new { no, ad = ad.Length > 60 ? ad[..60] : ad });

                db.Execute(@"
UPDATE KRY_ONAY SET isteyen = @kisa,
       ozet = CASE WHEN ozet LIKE @desen AND LEN(ozet) + LEN(@ad) < 890
                   THEN LEFT(ozet, LEN(ozet) - LEN(@no)) + @ad ELSE ozet END
WHERE isteyen = @no", new { no, ad, kisa = ad.Length > 60 ? ad[..60] : ad, desen = $"%Yapan: {no}" });
            }
        }
        catch
        {
            /* tablolar yoksa ya da yetki yoksa sessiz */
        }
    }
}

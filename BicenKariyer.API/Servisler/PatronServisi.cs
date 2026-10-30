using System.Globalization;
using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Patron görünümü yetkisi (03.10.2026).
///
/// <para>
/// Biçen360'ta şirket geneli yönetim ekranlarını (canlı okutma, norm
/// kadro, başvurular, onaylar, Biçen Kart) görecek kişiler. Liste Yönetim →
/// Patron Görünümü'nden tutuluyor; mobil ve web uçları kişinin bu listede
/// olup olmadığını buradan soruyor.
/// </para>
///
/// <para>
/// Personel kodu ve kimlik numarasıyla eşleşiyor: kişi Mikro'da yeni bir
/// koda geçerse (geri dönüş, şirket değişikliği) yetkisi düşmesin.
/// </para>
/// </summary>
public class PatronServisi
{
    private readonly VeritabaniServisi _vt;

    public PatronServisi(VeritabaniServisi vt) => _vt = vt;

    /// <summary>Kişi patron listesinde mi?</summary>
    public bool PatronMu(string personelKodu, string kimlikNo = null)
    {
        var kod = (personelKodu ?? "").Trim();
        var kimlik = (kimlikNo ?? "").Trim();

        if (kod.Length == 0 && kimlik.Length == 0) return false;

        try
        {
            using var db = _vt.Baglanti();

            return db.ExecuteScalar<int>(@"
SELECT COUNT(*) FROM KRY_PATRON
WHERE aktif = 1
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))", new { kod, kimlik }) > 0;
        }
        catch
        {
            /* Tablo yoksa kimse patron değil */
            return false;
        }
    }

    /// <summary>KRY_PATRON'daki etkin kayıt (bildirim ayarlarıyla)</summary>
    public sealed record PatronKaydi(string Kod, string Kimlik, string Ad, string Unvan, PatronBildirimAyari Ayar);

    /// <summary>
    /// Listedeki etkin kişiler. Bildirim görevi her dakika soruyor; tablo
    /// küçük (birkaç kişi). Ayar sütunu henüz eklenmemişse (kurulum
    /// yarım kaldıysa) varsayılan ayarlarla döner.
    /// </summary>
    public List<PatronKaydi> Aktifler()
    {
        try
        {
            using var db = _vt.Baglanti();

            List<(string Kod, string Kimlik, string Ad, string Unvan, string Ayar)> satirlar;

            try
            {
                satirlar = db.Query<(string, string, string, string, string)>(@"
SELECT LTRIM(RTRIM(personel_kodu)), LTRIM(RTRIM(ISNULL(kimlik_no, ''))), ad_soyad, unvan, bildirim_ayar
FROM KRY_PATRON WHERE aktif = 1").ToList();
            }
            catch
            {
                satirlar = db.Query<(string, string, string, string, string)>(@"
SELECT LTRIM(RTRIM(personel_kodu)), LTRIM(RTRIM(ISNULL(kimlik_no, ''))), ad_soyad, unvan, CAST(NULL AS NVARCHAR(400))
FROM KRY_PATRON WHERE aktif = 1").ToList();
            }

            return satirlar
                .Select(x => new PatronKaydi(x.Kod, x.Kimlik, x.Ad, x.Unvan, PatronBildirimAyari.Oku(x.Ayar)))
                .ToList();
        }
        catch
        {
            return new List<PatronKaydi>();
        }
    }

    /// <summary>Kişinin patron kaydı (PatronMu ile aynı eşleşme); yoksa null.</summary>
    public PatronKaydi Bul(string personelKodu, string kimlikNo = null)
    {
        var kod = (personelKodu ?? "").Trim();
        var kimlik = (kimlikNo ?? "").Trim();

        var liste = Aktifler();

        return liste.FirstOrDefault(x => string.Equals(x.Kod, kod, StringComparison.OrdinalIgnoreCase))
               ?? (kimlik.Length > 0 ? liste.FirstOrDefault(x => x.Kimlik == kimlik) : null);
    }

    /// <summary>
    /// Bildirim ayarlarını yazar (Biçen360 → Bildirim ayarları). Kişinin
    /// bütün etkin satırlarına: PatronMu kod ya da kimlikle eşleştiği için
    /// ayar da aynı kümeye yazılıyor.
    /// </summary>
    public void AyarYaz(string personelKodu, string kimlikNo, PatronBildirimAyari ayar)
    {
        using var db = _vt.Baglanti();

        db.Execute(@"
UPDATE KRY_PATRON SET bildirim_ayar = @json
WHERE aktif = 1
  AND (LTRIM(RTRIM(personel_kodu)) = @kod
       OR (@kimlik <> '' AND kimlik_no = @kimlik))",
            new
            {
                json = ayar.Json(),
                kod = (personelKodu ?? "").Trim(),
                kimlik = (kimlikNo ?? "").Trim()
            });
    }

    /// <summary>Patron görünümünü açtığında son giriş zamanı yazılır.</summary>
    public void GirisYaz(string personelKodu)
    {
        try
        {
            using var db = _vt.Baglanti();

            db.Execute(@"
UPDATE KRY_PATRON SET son_giris = SYSDATETIME()
WHERE aktif = 1 AND LTRIM(RTRIM(personel_kodu)) = @kod",
                new { kod = (personelKodu ?? "").Trim() });
        }
        catch
        {
            /* İz yazılamazsa görünüm yine açılır */
        }
    }
}

/// <summary>
/// Patronun Biçen360 bildirim tercihleri (03.10.2026). KRY_PATRON.bildirim_ayar
/// sütununda düz JSON: <c>{"sabah":true,"sabahSaat":"08:30","onay":true,
/// "kritik":true,"etik":true}</c> — gerekirse SQL'de JSON_VALUE ile de
/// okunabiliyor. Hiç kaydedilmemişse hepsi açık: patron görünümü bu
/// bildirimler için tasarlandı, kişi isterse kapatıyor.
/// </summary>
public class PatronBildirimAyari
{
    public const string VarsayilanSaat = "08:30";

    /// <summary>Sabah özeti</summary>
    public bool Sabah { get; set; } = true;

    /// <summary>Sabah özetinin saati, "SS:dd"</summary>
    public string SabahSaat { get; set; } = VarsayilanSaat;

    /// <summary>Yeni onay talebi</summary>
    public bool Onay { get; set; } = true;

    /// <summary>Kritik okutma uyarısı</summary>
    public bool Kritik { get; set; } = true;

    /// <summary>Etik hatta yeni bildirim</summary>
    public bool Etik { get; set; } = true;

    private static readonly JsonSerializerOptions Secenek = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    public string Json() => JsonSerializer.Serialize(this, Secenek);

    /// <summary>Kayıtlı JSON'u okur; boş ya da bozuksa varsayılan.</summary>
    public static PatronBildirimAyari Oku(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new PatronBildirimAyari();

        try
        {
            var a = JsonSerializer.Deserialize<PatronBildirimAyari>(json, Secenek) ?? new PatronBildirimAyari();
            if (SaatCoz(a.SabahSaat) is null) a.SabahSaat = VarsayilanSaat;
            return a;
        }
        catch
        {
            return new PatronBildirimAyari();
        }
    }

    /// <summary>"08:30" → 08:30; geçersizse null.</summary>
    public static TimeSpan? SaatCoz(string saat) =>
        TimeSpan.TryParseExact((saat ?? "").Trim(), @"hh\:mm", CultureInfo.InvariantCulture, out var t)
        && t >= TimeSpan.Zero && t < TimeSpan.FromDays(1)
            ? t
            : null;
}

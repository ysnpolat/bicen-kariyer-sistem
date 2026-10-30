using System.Text.Json;
using Dapper;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Avans onay akışı (07.10.2026, Ayarlar Merkezi › Onay akışları).
///
/// <para>
/// Eskiden avans talebini yalnızca İnsan Kaynakları sonuçlandırıyordu;
/// İK reddedince talep kapanıyordu. Şimdi akış adımlardan oluşuyor ve her
/// adım için "onaylarsa" ve "reddederse" ne olacağı seçiliyor: sonuçlandır
/// ya da sonraki adıma gönder. Varsayılan: İK onaylarsa onaylanır, İK
/// reddederse genel müdür yardımcısına gider; GMY'nin kararı kesindir.
/// Yani İK reddetse de GMY onaylayabilir, ikisi de reddederse talep
/// reddedilir.
/// </para>
///
/// <para>
/// Talep sonuçlanana kadar durum "bekliyor"; hangi adımda olduğu
/// KRY_AVANS.asama'da (0 ilk adım). Ara kararlar hareket geçmişine
/// yazılıyor; personel ara reddi görmez, "… onayında" görür.
/// </para>
/// </summary>
public static class AvansAkisi
{
    public const string Anahtar = "AVANS_AKIS";
    public const string Bitir = "bitir";
    public const string Sonraki = "sonraki";

    public sealed class Adim
    {
        public string Ad { get; set; }

        /// <summary>Panelde karar verebilecek roller</summary>
        public List<string> Roller { get; set; } = new();

        /// <summary>Biçen360'tan (patron ekranı) karar verebilecek siciller; "gmy" GMY sicili parametresi</summary>
        public List<string> Siciller { get; set; } = new();

        public string Onaylarsa { get; set; } = Bitir;
        public string Reddederse { get; set; } = Bitir;
    }

    public sealed class Ayar
    {
        public List<Adim> Adimlar { get; set; } = new();

        /// <summary>Ara retten sonra personele "talebiniz değerlendirmede" bildirimi</summary>
        public bool AraKarardaBildir { get; set; }
    }

    public static Ayar Varsayilan() => new()
    {
        Adimlar = new List<Adim>
        {
            new()
            {
                Ad = "İnsan Kaynakları",
                Roller = new() { Roller.IK, Roller.IKYoneticisi },
                Onaylarsa = Bitir,
                Reddederse = Sonraki,
            },
            new()
            {
                Ad = "Genel Müdür Yardımcısı",
                Roller = new() { Roller.GenelMudurYardimcisi },
                Siciller = new() { "gmy" },
                Onaylarsa = Bitir,
                Reddederse = Bitir,
            },
        },
    };

    private static readonly JsonSerializerOptions Secenek = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static VeritabaniServisi _vt;
    private static Ayar _onbellek;
    private static DateTime _okunma = DateTime.MinValue;

    public static void Baslat(VeritabaniServisi vt) => _vt = vt;

    /// <summary>Geçerli akış (60 sn önbellek)</summary>
    public static Ayar Gecerli()
    {
        if (_onbellek is not null && DateTime.Now - _okunma < TimeSpan.FromSeconds(60)) return _onbellek;

        try
        {
            if (_vt is null) return Temizle(Varsayilan());
            using var db = _vt.Baglanti();
            _onbellek = Oku(db);
            _okunma = DateTime.Now;
        }
        catch
        {
            _onbellek ??= Temizle(Varsayilan());
        }

        return _onbellek;
    }

    public static void Yaz(System.Data.IDbConnection db, Ayar a)
    {
        var json = JsonSerializer.Serialize(Temizle(a), Secenek);
        db.Execute(@"
MERGE KRY_AYARLAR AS h
USING (SELECT @k AS anahtar) AS k ON h.anahtar = k.anahtar
WHEN MATCHED THEN UPDATE SET deger = @d, guncelleme = SYSDATETIME()
WHEN NOT MATCHED THEN INSERT (anahtar, deger, guncelleme) VALUES (@k, @d, SYSDATETIME());",
            new { k = Anahtar, d = json });
        _okunma = DateTime.MinValue;
    }

    public static Ayar Oku(System.Data.IDbConnection db)
    {
        try
        {
            var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = @a", new { a = Anahtar });
            if (!string.IsNullOrWhiteSpace(ham))
            {
                var a = JsonSerializer.Deserialize<Ayar>(ham, Secenek);
                if (a?.Adimlar is { Count: > 0 }) return Temizle(a);
            }
        }
        catch
        {
        }

        return Temizle(Varsayilan());
    }

    /// <summary>Son adımın kararları her zaman kesin; boş ad ve tekrar eden rol temizlenir</summary>
    public static Ayar Temizle(Ayar a)
    {
        a.Adimlar = (a.Adimlar ?? new()).Where(x => x is not null).Take(5).ToList();

        for (var i = 0; i < a.Adimlar.Count; i++)
        {
            var x = a.Adimlar[i];
            x.Ad = string.IsNullOrWhiteSpace(x.Ad) ? $"{i + 1}. adım" : x.Ad.Trim();
            if (x.Ad.Length > 60) x.Ad = x.Ad[..60];
            x.Roller = (x.Roller ?? new()).Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            x.Siciller = (x.Siciller ?? new()).Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase).Take(10).ToList();
            x.Onaylarsa = x.Onaylarsa == Sonraki ? Sonraki : Bitir;
            x.Reddederse = x.Reddederse == Sonraki ? Sonraki : Bitir;

            if (i == a.Adimlar.Count - 1)
            {
                x.Onaylarsa = Bitir;
                x.Reddederse = Bitir;
            }
        }

        return a;
    }

    public static string Denetle(Ayar a)
    {
        if (a?.Adimlar is not { Count: > 0 }) return "En az bir adım olmalı.";
        if (a.Adimlar.Count > 5) return "En fazla 5 adım olabilir.";

        foreach (var x in a.Adimlar)
            if ((x.Roller?.Count ?? 0) == 0 && (x.Siciller?.Count ?? 0) == 0)
                return $"\"{x.Ad}\" adımında karar verecek rol ya da kişi seçiniz.";

        return null;
    }

    /// <summary>"gmy" yerine parametredeki sicil</summary>
    public static IEnumerable<string> Siciller(Adim x) =>
        (x.Siciller ?? new()).Select(s => string.Equals(s, "gmy", StringComparison.OrdinalIgnoreCase)
            ? Parametre.Metin("avans.gmySicil") : s)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s.Trim().TrimStart('0'));

    public static Adim AdimAl(Ayar a, int? asama)
    {
        var i = Math.Clamp(asama ?? 0, 0, a.Adimlar.Count - 1);
        return a.Adimlar[i];
    }

    public static bool SonAdim(Ayar a, int? asama) => (asama ?? 0) >= a.Adimlar.Count - 1;

    /// <summary>Panel kullanıcısı bu adımda karar verebilir mi (Admin her adımda)</summary>
    public static bool PanelYetkili(Adim x, string temelRol) =>
        temelRol == Roller.Admin
        || (x.Roller ?? new()).Contains(temelRol, StringComparer.OrdinalIgnoreCase);

    /// <summary>Biçen360 kullanıcısı (sicil) bu adımda karar verebilir mi</summary>
    public static bool SicilYetkili(Adim x, string sicil) =>
        Siciller(x).Contains((sicil ?? "").Trim().TrimStart('0'), StringComparer.OrdinalIgnoreCase);
}

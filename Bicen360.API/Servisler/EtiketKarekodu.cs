using System.Globalization;

namespace Bicen360.API.Servisler;

/// <summary>
/// Raf etiketindeki karekod (13.10.2026, A4minietiket32LICIZGILI).
/// İçerik düz metin, satır satır "ANAHTAR: değer"; büyük harf ve ASCII:
/// <code>
/// BARKOD: 8690504020025
/// STOK: 153.01.0042
/// REYON: BISKUVI-KEK
/// FIYAT: 84,50 TL
/// FDT: 08.10.2026
/// BASIM: 13.10.2026
/// </code>
/// Bu biçim değilse <see cref="Coz"/> null döner ve okunan değer düz
/// barkod gibi işlenir.
/// <para>
/// 26.10.2026: "ID: 100245" satırı etiketin OZ Merkez'deki kaydını
/// (ETIKET_KAYIT) gösterir; basıldığı andaki ad, fiyat, indirimli fiyat,
/// menşei ve SKT oradan okunup güncel bilgiyle karşılaştırılır. Yalnız ID
/// satırı olan karekod da geçerlidir. Ayrıntı: ETIKET-KAREKOD.md
/// </para>
/// </summary>
public sealed class EtiketKarekodu
{
    public long? Id { get; init; }
    public string Barkod { get; init; }
    public decimal? Indirimli { get; init; }
    public DateTime? Skt { get; init; }
    public string Stok { get; init; }
    public decimal? Fiyat { get; init; }
    public DateTime? Fdt { get; init; }
    public DateTime? Basim { get; init; }

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    public static EtiketKarekodu Coz(string deger)
    {
        if (string.IsNullOrWhiteSpace(deger) || deger.Length > 2000) return null;

        var alanlar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var satir in deger.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var i = satir.IndexOf(':');
            if (i <= 0) continue;
            var ad = satir[..i].Trim().ToUpperInvariant();
            var v = satir[(i + 1)..].Trim();
            if (ad.Length > 0 && !alanlar.ContainsKey(ad)) alanlar[ad] = v;
        }

        /* Etiket olduğunu ID, BARKOD ya da STOK satırı söylüyor */
        alanlar.TryGetValue("BARKOD", out var barkod);
        alanlar.TryGetValue("STOK", out var stok);
        long? id = alanlar.TryGetValue("ID", out var ids)
                   && long.TryParse(new string((ids ?? "").Where(char.IsDigit).ToArray()), out var idv) && idv > 0
            ? idv : null;
        if (id is null && string.IsNullOrWhiteSpace(barkod) && string.IsNullOrWhiteSpace(stok)) return null;

        return new EtiketKarekodu
        {
            Id = id,
            Indirimli = alanlar.TryGetValue("IND", out var ind) ? Para(ind) : null,
            Skt = alanlar.TryGetValue("SKT", out var skt) ? Tarih(skt) : null,
            Barkod = string.IsNullOrWhiteSpace(barkod) ? null : barkod.Trim(),
            Stok = string.IsNullOrWhiteSpace(stok) ? null : stok.Trim(),
            Fiyat = alanlar.TryGetValue("FIYAT", out var f) ? Para(f) : null,
            Fdt = alanlar.TryGetValue("FDT", out var fdt) ? Tarih(fdt) : null,
            Basim = alanlar.TryGetValue("BASIM", out var b) ? Tarih(b) : null,
        };
    }

    private static decimal? Para(string s)
    {
        s = (s ?? "").ToUpperInvariant().Replace("TL", "").Replace("₺", "").Trim();
        return decimal.TryParse(s, NumberStyles.Number, Tr, out var d) ? d : null;
    }

    private static DateTime? Tarih(string s) =>
        DateTime.TryParseExact((s ?? "").Trim(), new[] { "dd.MM.yyyy", "d.M.yyyy", "dd.MM.yy" }, Tr, DateTimeStyles.None, out var t)
            ? t.Date
            : null;

    /// <summary>
    /// Etiket güncel mi: basılı fiyat raf ya da geçerli fiyattan biriyle
    /// aynıysa ve etiketten sonra fiyat değişmemişse güncel.
    /// </summary>
    public object Denetle(decimal? raf, decimal? gecerli, DateTime? sonFiyatTarihi)
    {
        static bool Ayni(decimal? a, decimal? b) => a is not null && b is not null && Math.Round(a.Value, 2) == Math.Round(b.Value, 2);

        bool? fiyatTutuyor = Fiyat is null ? null : Ayni(Fiyat, raf) || Ayni(Fiyat, gecerli);

        var referans = Fdt ?? Basim;
        bool? sonradanDegisti = referans is null || sonFiyatTarihi is null ? null : sonFiyatTarihi.Value.Date > referans.Value;

        string uyari = null;
        if (fiyatTutuyor == false)
            uyari = $"Etiketteki fiyat ({Fiyat.Value.ToString("N2", Tr)} TL) güncel fiyattan farklı. Etiketi yenileyiniz.";
        else if (sonradanDegisti == true)
            uyari = $"Etiket basıldıktan sonra fiyat değişmiş (son değişiklik {sonFiyatTarihi:dd.MM.yyyy}). Etiketi kontrol ediniz.";

        return new
        {
            fiyat = Fiyat,
            fdt = Fdt,
            basim = Basim,
            guncel = uyari is null,
            uyari,
        };
    }
}

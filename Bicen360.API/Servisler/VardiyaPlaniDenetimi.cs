using System.Collections.Concurrent;
using System.Text.Json;
using Dapper;

namespace Bicen360.API.Servisler;

/// <summary>
/// Mobil Fiyat Kontrol için vardiya planı şartı.
///
/// <para>
/// Personelin içinde bulunulan haftada (pazartesi–pazar) vardiya planında
/// hiç kaydı (vardiya ya da haftalık izin) yoksa fiyat sorgusu ve etiket
/// listesi gönderimi açılmıyor. Amaç şubelerin haftalık vardiya planını
/// kurmasını sağlamak; izin talebindeki denetimle aynı tablo
/// (<c>KRY_VARDIYA_PLAN</c>) okunuyor.
/// </para>
///
/// <para>
/// Ayar İK paneli → İzin Kuralları → vardiya planı denetimi kartında
/// (<c>KRY_AYARLAR · IZIN_KURAL</c> içinde <c>vardiya.fiyatKontrol</c>).
/// Tanımlı değilse açık sayılıyor. Muaf birimler: izin denetimindeki muaf
/// birimler ve Fiyat Kontrol için ayrıca seçilenler (genel merkez gibi).
/// </para>
///
/// <para>
/// Uygulama güncellemesi gerekmiyor: sunucu 409 ve <c>hata</c> metni
/// dönüyor, yayındaki uygulama bu metni barkod alanının altında ya da
/// liste gönderim penceresinde gösteriyor. Okuma hatasında engel
/// konmuyor; altyapı sorunu personelin işini durdurmamalı.
/// </para>
/// </summary>
public class VardiyaPlaniDenetimi
{
    private readonly VeritabaniServisi _vt;
    private readonly PersonelServisi _personel;
    private readonly ILogger<VardiyaPlaniDenetimi> _kayit;

    public const string FiyatKontrolMesaji =
        "Bu hafta için vardiya planınız tanımlı olmadığından Fiyat Kontrol'ü kullanamazsınız. "
        + "Mağaza müdürünüzden bu haftanın vardiya planını oluşturmasını isteyiniz.";

    public VardiyaPlaniDenetimi(VeritabaniServisi vt, PersonelServisi personel,
        ILogger<VardiyaPlaniDenetimi> kayit)
    {
        _vt = vt;
        _personel = personel;
        _kayit = kayit;
    }

    private readonly ConcurrentDictionary<string, (bool engel, DateTime zaman)> _bellek =
        new(StringComparer.OrdinalIgnoreCase);

    private sealed record Ayar(bool Acik, List<string> Muaf);

    private Ayar _ayar;
    private DateTime _ayarZamani;

    private Ayar AyarOku(System.Data.IDbConnection db)
    {
        if (_ayar is not null && DateTime.Now - _ayarZamani < TimeSpan.FromMinutes(1)) return _ayar;

        var acik = true;
        var muaf = new List<string>();

        var ham = db.ExecuteScalar<string>("SELECT deger FROM KRY_AYARLAR WHERE anahtar = 'IZIN_KURAL'");

        if (!string.IsNullOrWhiteSpace(ham))
        {
            using var j = JsonDocument.Parse(ham);

            var vardiya = Ozellik(j.RootElement, "vardiya");

            if (vardiya is { ValueKind: JsonValueKind.Object } v)
            {
                if (Ozellik(v, "fiyatKontrol") is { } fk && fk.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    acik = fk.GetBoolean();

                foreach (var ad in new[] { "muafBirimler", "fiyatKontrolMuaf" })
                    if (Ozellik(v, ad) is { ValueKind: JsonValueKind.Array } liste)
                        muaf.AddRange(liste.EnumerateArray()
                            .Where(x => x.ValueKind == JsonValueKind.String)
                            .Select(x => YetkiServisi.Anahtar(x.GetString()))
                            .Where(x => x.Length > 0));
            }
        }

        _ayar = new Ayar(acik, muaf.Distinct().ToList());
        _ayarZamani = DateTime.Now;

        return _ayar;
    }

    private static JsonElement? Ozellik(JsonElement e, string ad)
    {
        if (e.ValueKind != JsonValueKind.Object) return null;

        foreach (var p in e.EnumerateObject())
            if (p.Name.Equals(ad, StringComparison.OrdinalIgnoreCase))
                return p.Value;

        return null;
    }

    /// <summary>Engel varsa kullanıcıya gösterilecek metin, yoksa null.</summary>
    public string FiyatKontrolEngeli(string sicil)
    {
        sicil = (sicil ?? "").Trim();

        if (sicil.Length == 0) return null;

        if (_bellek.TryGetValue(sicil, out var b) &&
            DateTime.Now - b.zaman < (b.engel ? TimeSpan.FromMinutes(1) : TimeSpan.FromMinutes(10)))
            return b.engel ? FiyatKontrolMesaji : null;

        try
        {
            using var db = _vt.Baglanti();

            var ayar = AyarOku(db);

            var engel = false;

            if (ayar.Acik && !Muaf(ayar, sicil))
            {
                var bugun = DateTime.Today;
                var pzt = bugun.AddDays(-(((int)bugun.DayOfWeek + 6) % 7));

                var kodlar = new[] { sicil, sicil.TrimStart('0') }
                    .Where(x => x.Length > 0)
                    .Distinct()
                    .ToList();

                engel = db.ExecuteScalar<int>(@"
SELECT CASE WHEN EXISTS (
    SELECT 1 FROM KRY_VARDIYA_PLAN
    WHERE personel_kodu IN @kodlar AND gun BETWEEN @pzt AND @paz AND tur IN (N'vardiya', N'izin')
) THEN 0 ELSE 1 END", new { kodlar, pzt, paz = pzt.AddDays(6) }) == 1;
            }

            _bellek[sicil] = (engel, DateTime.Now);

            return engel ? FiyatKontrolMesaji : null;
        }
        catch (Exception hata)
        {
            _kayit.LogWarning(hata, "Fiyat Kontrol vardiya denetimi yapılamadı: {Sicil}", sicil);
            return null;
        }
    }

    private bool Muaf(Ayar ayar, string sicil)
    {
        if (ayar.Muaf.Count == 0) return false;

        var birim = YetkiServisi.Anahtar(_personel.Getir(sicil)?.Sube);

        if (birim.Length == 0) return false;

        return ayar.Muaf.Any(m => m == birim
            || (m.Length >= 4 && birim.Length >= 4 && (m.Contains(birim) || birim.Contains(m))));
    }
}

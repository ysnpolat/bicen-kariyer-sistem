using System.Globalization;
using System.Text.Json;
using BicenKariyer.API.Servisler;
using Microsoft.AspNetCore.Mvc;

namespace BicenKariyer.API.Controllers;

/// <summary>
/// Patron görünümünde personel talepleri (09.10.2026).
///
/// <para>
/// Genel müdüre bağlı personelin izin talebi ve fazla mesaisi yalnızca
/// personel görünümündeki İzin Onayları'nda görünüyordu. Aynı liste
/// (IzinTalepController.MobilBekleyenler: organizasyon şemasına göre bu
/// kişinin kararını bekleyenler) patron Onaylar sekmesine kart olarak
/// ekleniyor; karar da aynı uçtan (MobilKarar) veriliyor, kurallar (imzalı
/// form şartı, sıra, bildirimler) aynen geçerli. Avans zaten ayrıca geliyor.
/// </para>
///
/// <para>
/// Kimlik: izin -(1,2e9 + talep), fazla mesai -(1,4e9 + kayıt). Yayındaki
/// 1.6 "izin" türünü tanıyor; fazla mesai "mesai" türüyle geliyor, 1.6'da
/// genel "Onay" kartı olarak görünüyor.
/// </para>
/// </summary>
public partial class PatronMobilController
{
    internal const int IzinKimlik = 1_200_000_000;
    internal const int MesaiKimlik = 1_400_000_000;

    private static readonly JsonSerializerOptions TalepJson = new(JsonSerializerDefaults.Web);

    private IzinTalepController IzinKoprusu()
    {
        var c = ActivatorUtilities.CreateInstance<IzinTalepController>(HttpContext.RequestServices);
        c.ControllerContext = ControllerContext;
        return c;
    }

    private static string Al(JsonElement e, string ad) =>
        e.TryGetProperty(ad, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTime? Tarih(JsonElement e, string ad) =>
        e.TryGetProperty(ad, out var v) && v.ValueKind == JsonValueKind.String && v.TryGetDateTime(out var t) ? t : null;

    private static bool Dogru(JsonElement e, string ad) =>
        e.TryGetProperty(ad, out var v) && v.ValueKind == JsonValueKind.True;

    private static int? Sayi(JsonElement e, string ad) =>
        e.TryGetProperty(ad, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt32(out var i) ? i : null;

    /// <summary>Bu kişinin kararını bekleyen izin talepleri ve fazla mesailer (patron kartı biçiminde)</summary>
    private List<(DateTime Tarih, object Kayit)> PersonelTalepOnaylari(PersonelKaydi p)
    {
        var sonuc = new List<(DateTime, object)>();

        /* 26.10.2026: MobilBekleyenler zincirde takılanları ilerletirken bildirim
           gönderdiği için async; buradaki eşzamanlı çağrı zincirinde bekleniyor */
        if (IzinKoprusu().MobilBekleyenler().GetAwaiter().GetResult() is not ObjectResult or || or.Value is null) return sonuc;

        var kok = JsonSerializer.SerializeToElement(or.Value, TalepJson);
        if (!kok.TryGetProperty("talepler", out var liste) || liste.ValueKind != JsonValueKind.Array) return sonuc;

        foreach (var t in liste.EnumerateArray())
        {
            var tip = Al(t, "tip");
            if (tip == "avans") continue; /* avans patron listesine ayrıca geliyor */

            var id = Sayi(t, "id") ?? 0;
            var olusturma = Tarih(t, "olusturma") ?? DateTime.Now;
            var asama = Sayi(t, "asama") ?? 1;
            var bilgi = new List<string[]>();

            int kimlik;
            string tur, alt, not;

            if (tip == "fazlamesai")
            {
                var fmId = Sayi(t, "fazlaMesaiId") ?? 0;
                if (fmId <= 0) continue;

                kimlik = -(MesaiKimlik + fmId);
                tur = "mesai";
                alt = $"Fazla mesai · {Al(t, "sure")}";
                if (Tarih(t, "tarih") is DateTime g)
                    bilgi.Add(new[] { "Tarih", $"{g.ToString("dd.MM.yyyy ddd", Tr)} · {Al(t, "baslangic")}–{Al(t, "bitis")}" });
                if (!string.IsNullOrWhiteSpace(Al(t, "giren"))) bilgi.Add(new[] { "Giren", K(Al(t, "giren")) });
                not = K(Al(t, "neden"));
            }
            else
            {
                if (id <= 0) continue;

                kimlik = -(IzinKimlik + id);
                tur = "izin";
                var gun = t.TryGetProperty("gun", out var gv) && gv.ValueKind == JsonValueKind.Number ? gv.GetDecimal() : 0m;
                var tr = K(Al(t, "tur"));
                var altTur = K(Al(t, "altTur"));
                alt = $"{tr}{(altTur.Length > 0 && !tr.Contains(altTur) ? $" · {altTur}" : "")} · {gun.ToString("0.#", Tr)} gün";

                var c = Tarih(t, "cikisTarihi");
                var d = Tarih(t, "donusTarihi");
                if (c is not null)
                    bilgi.Add(new[] { "Tarih", d is not null && d.Value.Date != c.Value.Date
                        ? $"{c.Value:dd.MM} – {d.Value:dd.MM.yyyy}"
                        : $"{c.Value:dd.MM.yyyy}" });
                not = K(Al(t, "aciklama"));
            }

            if (!string.IsNullOrWhiteSpace(Al(t, "subeAdi"))) bilgi.Add(new[] { "Birim", K(Al(t, "subeAdi")) });
            if (!string.IsNullOrWhiteSpace(Al(t, "gorev"))) bilgi.Add(new[] { "Pozisyon", K(Al(t, "gorev")) });
            bilgi.Add(new[] { "Aşama", asama == 1 ? "Birim yöneticisi onayı" : "Bölge / üst yönetici onayı" });
            if (asama == 2 && !string.IsNullOrWhiteSpace(Al(t, "magazaKisi")))
                bilgi.Add(new[] { "Önceki onay", K(Al(t, "magazaKisi")) });

            var uyari = Dogru(t, "formYukle")
                ? "İmzalı form yüklenmeden onaylanamaz. Formu personel görünümünde İzin Onayları'ndaki karttan yükleyin."
                : Dogru(t, "formVar") ? "İmzalı form yüklendi; personel görünümünde İzin Onayları'ndan açılabilir." : null;

            sonuc.Add((olusturma, new
            {
                id = kimlik,
                tur,
                baslik = K(Al(t, "adSoyad")),
                alt,
                bilgi,
                uyari,
                not = string.IsNullOrWhiteSpace(not) ? null : not,
                sure = Sure(olusturma),
                basvuruId = (int?)null,
                olusturma = Iso(olusturma),
                fotoUrl = (string)null,
            }));
        }

        return sonuc;
    }

    /// <summary>İzin / fazla mesai kararı: personel görünümündeki İzin Onayları ile aynı uç</summary>
    private async Task<IActionResult> PersonelTalepKarari(int id, bool onay, string not, PersonelKaydi p)
    {
        int mobilId = id <= -MesaiKimlik
            ? FazlaMesaiAkisi.MobilKimlik(-id - MesaiKimlik)
            : -id - IzinKimlik;

        if (!onay && not.Length < 3) return BadRequest(new { hata = "Reddetme sebebini yazınız; personel bunu görür." });

        var sonuc = await IzinKoprusu().MobilKarar(mobilId, new IzinKararGirdi { Onay = onay, Not = not.Length == 0 ? null : not });

        PatronOnbellegi.Temizle("onay", "verilen|", "ozet");

        if (sonuc is ObjectResult or && (or.StatusCode ?? 200) >= 400)
        {
            var hata = or.Value?.GetType().GetProperty("hata")?.GetValue(or.Value) as string ?? "Karar kaydedilemedi.";
            return StatusCode(or.StatusCode ?? 400, new { hata });
        }

        _gunluk.Yaz("PATRON TALEP KARARI", IstemciAdresi.Bul(HttpContext),
            $"{Imza(p)} ({K(p.PersonelKodu)}) → {(id <= -MesaiKimlik ? "fazla mesai" : "izin")} #{mobilId} · {(onay ? "onay" : "red")}");

        string mesaj = null;
        if (sonuc is ObjectResult ok && ok.Value is not null)
            mesaj = ok.Value.GetType().GetProperty("mesaj")?.GetValue(ok.Value) as string;

        return Ok(new { basarili = true, mesaj = mesaj ?? (onay ? "Onaylandı; talep sıradaki onaya geçti." : "Reddedildi; talep edene bildirildi.") });
    }
}

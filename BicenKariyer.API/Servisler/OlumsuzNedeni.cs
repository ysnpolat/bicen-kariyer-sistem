using System.Globalization;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Olumsuz değerlendirme gerekçesini (serbest metin) bir gruba ayırır.
///
/// <para>
/// İK uzmanları gerekçeyi kendi cümleleriyle yazıyor: "tecrübesi yok",
/// "maaş beklentisi yüksek", "telefonu açmadı" gibi. "En sık olumsuz sebebi
/// ne?" sorusu metinlerle cevaplanamıyor; anahtar kelimelerle gruplanıyor.
/// Sıra önemli: "ulaşılamadı" ulaşım değil, aday iletişimi.
/// </para>
/// </summary>
public static class OlumsuzNedeni
{
    private static readonly (string Grup, string[] Kelimeler)[] Kurallar =
    {
        ("Adaya ulaşılamadı / gelmedi", new[] { "ulaşılamadı", "ulasilamadi", "ulaşamadı", "ulasamadi", "açmadı", "acmadi", "gelmedi", "katılmadı", "katilmadi", "dönüş yapmadı", "donus yapmadi", "dönüş alınamadı", "cevap vermedi", "yanıt vermedi", "meşgul", "kapalı" }),
        ("Aday vazgeçti", new[] { "vazgeçti", "vazgecti", "istemedi", "istemiyor", "kabul etmedi", "başka iş", "baska is", "başka yerde", "iş buldu", "is buldu", "teklifi reddetti", "düşünmüyor" }),
        ("Ücret beklentisi yüksek", new[] { "ücret", "ucret", "maaş", "maas", "beklenti", "talep yüksek", "para" }),
        ("Mesai / çalışma saatleri", new[] { "mesai", "vardiya", "saat", "hafta sonu", "haftasonu", "gece", "pazar", "part", "yarı zamanlı" }),
        ("Ulaşım / mesafe", new[] { "ulaşım", "ulasim", "uzak", "mesafe", "servis", "yol", "ikamet" }),
        ("Tecrübe / yetkinlik yetersiz", new[] { "tecrübe", "tecrube", "deneyim", "yetersiz", "yetkin", "bilgi", "beceri", "uygun değil", "uygun degil", "vasıf", "nitelik" }),
        ("Kadro dolu / ihtiyaç yok", new[] { "kadro", "ihtiyaç", "ihtiyac", "dolu", "norm", "alım yok", "pozisyon kapandı" }),
        ("Tutum / iletişim", new[] { "tutum", "davranış", "davranis", "iletişim", "iletisim", "özen", "motivasyon", "istekli değil", "ilgisiz" }),
        ("Belge / sağlık / askerlik", new[] { "sabıka", "sabika", "adli sicil", "sağlık", "saglik", "rapor", "askerlik", "belge", "evrak" }),
        ("Yaş / fiziksel uygunluk", new[] { "yaş", "yas ", "fiziksel", "ağır iş" }),
        ("Daha önce çalışmış / tekrar alınmaz", new[] { "eski çalışan", "daha önce çalış", "tekrar alınmaz", "işten çıkarıl", "kara liste" }),
    };

    private static readonly CultureInfo Tr = new("tr-TR");

    public static string Grupla(string gerekce)
    {
        if (string.IsNullOrWhiteSpace(gerekce)) return "Gerekçe yazılmamış";

        var metin = gerekce.ToLower(Tr);

        foreach (var (grup, kelimeler) in Kurallar)
            if (kelimeler.Any(k => metin.Contains(k)))
                return grup;

        return "Diğer";
    }
}

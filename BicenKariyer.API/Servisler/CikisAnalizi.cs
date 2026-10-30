using System.Text;
using System.Text.Json;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Çıkış mülakatı ve çıkış anketi analizi (29.09.2026)
/// ---------------------------------------------------------------------------
/// Her kayıt için tek cümlelik özet ve ayrılma nedeninin ana grubu.
///
/// <para>
/// Grup önceden panelde anahtar kelimeyle bulunuyordu: "hastaydım ve
/// çalışamadığım 1 gün içeride olan günümü istedim" gibi cümleler hiçbir
/// kelimeye uymuyor, rapor "Sınıflandırılmamış" satırıyla doluyordu.
/// Artık özetle aynı yapay zekâ çağrısında grup da seçiliyor ve kayda
/// yazılıyor (neden_grubu). Yapay zekâ kapalıysa ya da cevap vermezse
/// anahtar kelime sınıflandırması yedek olarak kullanılıyor.
/// </para>
///
/// <para>
/// Grup listesi sabit: rapor yıllar boyunca karşılaştırılabilsin. Liste
/// değişirse panel (CikisMulakati.tsx, NEDEN_GRUPLARI) da güncellenmeli.
/// </para>
/// </summary>
public static class CikisAnalizi
{
    public const string BELIRTILMEMIS = "Belirtilmemiş";
    public const string DIGER = "Diğer";

    /// <summary>Gruplar, yapay zekâya verilen tanım ve yedek anahtar kelimeler.</summary>
    public static readonly (string Ad, string Tanim, string[] Anahtarlar)[] GRUPLAR =
    {
        ("İşveren kaynaklı çıkış",
            "işten çıkarıldı, kovuldu, sözleşmesi feshedildi, kod 25/29, performans nedeniyle çıkarıldı",
            new[] { "çıkart", "cikart", "işten çıkar", "isten cikar", "kovul", "kovdu", "fesih", "kod 25", "kod 29",
                    "performans düşük", "performans dusuk", "çıkışımı verdi", "cikisimi verdi" }),

        ("Yönetici ve iletişim",
            "müdür, şef, yönetici ya da amirle sorun; kaba davranış, mobbing, baskı, değer görmeme, iletişimsizlik, adaletsizlik",
            new[] { "müdür", "mudur", "yönetici", "yonetici", "amir", "şef", "sef", "muhatap", "kaba", "saygı", "saygi",
                    "baskı", "baski", "mobbing", "değer görmedim", "deger gormedim", "dışlan", "dislan", "iletişim", "iletisim" }),

        ("Ücret ve yan haklar",
            "maaş, ücret, prim, zam yetersizliği; yan haklar; geçim sıkıntısı",
            new[] { "ücret", "ucret", "maaş", "maas", "para", "zam", "prim", "ekonomik", "geçim", "gecim", "yan hak" }),

        ("Çalışma koşulları ve saatler",
            "çalışma saatleri, vardiya, mesai, izin verilmemesi, iş yükü, eleman eksikliği, yorucu tempo, fiziksel koşullar",
            new[] { "çalışma koşul", "calisma kosul", "koşullar", "kosullar", "mesai", "saat", "vardiya", "yoğun", "yogun",
                    "ağır", "agir", "izin", "tatil", "yorucu", "iş yükü", "is yuku", "eleman" }),

        ("Başka iş / kariyer",
            "başka bir işe geçti, daha iyi teklif, kariyer ve terfi beklentisi, sektör değişikliği",
            new[] { "başka iş", "baska is", "yeni iş", "yeni is", "iş buldum", "is buldum", "kariyer", "terfi", "gelişme", "gelisme" }),

        ("Eğitim ve okul",
            "okula başlama ya da devam, sınav, üniversite, staj dönemi bitişi",
            new[] { "okul", "eğitim", "egitim", "üniversite", "universite", "sınav", "sinav", "öğrenci", "ogrenci", "staj" }),

        ("Görev değişikliği ve rotasyon",
            "başka şube ya da göreve geçiş, rotasyon, birim değişikliği",
            new[] { "rotasyon", "görev değişik", "gorev degisik", "birim değişik", "şube değişik", "sube degisik", "yer değişik" }),

        ("Sağlık",
            "kendi ya da yakınının sağlık sorunu, hastalık, ameliyat, hamilelik, doğum",
            new[] { "sağlık", "saglik", "hastalık", "hastalik", "hasta", "rahatsız", "rahatsiz", "ameliyat", "doğum", "dogum", "hamile" }),

        ("Taşınma ve ulaşım",
            "şehir değişikliği, taşınma, uzaklık, ulaşım ve servis sorunu",
            new[] { "taşın", "tasin", "ulaşım", "ulasim", "servis", "uzak", "mesafe", "yol", "şehir değiş", "sehir degis", "memleket" }),

        ("Ailevi ve kişisel",
            "ailevi nedenler, evlilik, çocuk bakımı, askerlik, kişisel nedenler",
            new[] { "ailevi", "aile", "kişisel", "kisisel", "askerlik", "asker", "evlilik", "evlen", "çocuk", "cocuk" }),

        ("Uyum sağlayamama",
            "işe ya da ekibe uyum sağlayamama, işi beklediği gibi bulmama, işin kendisine uymaması",
            new[] { "uyum", "yetersiz", "zorland", "ağır geldi", "agir geldi", "beklediğim gibi değil", "bekledigim gibi degil" }),

        (DIGER, "yukarıdakilerin hiçbirine uymayan açık bir neden", Array.Empty<string>()),
    };

    public static readonly string[] GRUP_ADLARI =
        GRUPLAR.Select(x => x.Ad).Append(BELIRTILMEMIS).ToArray();

    /// <summary>Anahtar kelimeyle grup (yapay zekâ yoksa yedek).</summary>
    public static string AnahtarlaSinifla(string neden)
    {
        var metin = (neden ?? "").Trim();

        if (metin.Length == 0 || metin.Equals(BELIRTILMEMIS, StringComparison.OrdinalIgnoreCase))
            return BELIRTILMEMIS;

        var kucuk = metin.ToLower(new System.Globalization.CultureInfo("tr-TR"));

        foreach (var g in GRUPLAR)
            if (g.Anahtarlar.Any(a => kucuk.Contains(a)))
                return g.Ad;

        return DIGER;
    }

    /// <summary>Gelen grup adını listedeki ada eşler (büyük/küçük harf, boşluk farkı).</summary>
    public static string GrupEsle(string ad)
    {
        var a = (ad ?? "").Trim().Trim('"', '.', ' ');

        if (a.Length == 0) return null;

        return GRUP_ADLARI.FirstOrDefault(x =>
            string.Equals(x, a, StringComparison.CurrentCultureIgnoreCase));
    }

    /// <summary>
    /// Kayıttan modele gidecek metin: çıkış nedeni, sorular ve cevaplar,
    /// puanlar, tavsiye, yorumlar. Hiçbir içerik yoksa boş.
    /// </summary>
    public static string Metin(string sorularJson, string cikisNedeni, string nedenAciklama,
        string uzmanYorumu, string yoneticiYorumu = null)
    {
        var yazi = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(cikisNedeni))
            yazi.AppendLine($"Ayrılma nedeni: {cikisNedeni.Trim()}"
                            + (string.IsNullOrWhiteSpace(nedenAciklama) ? "" : $" — {nedenAciklama.Trim()}"));

        try
        {
            using var kok = JsonDocument.Parse(string.IsNullOrWhiteSpace(sorularJson) ? "{}" : sorularJson);
            var k = kok.RootElement;

            var sorular = k.ValueKind == JsonValueKind.Array ? k : Bul(k, "sorular");

            if (sorular.ValueKind == JsonValueKind.Array)
                foreach (var s in sorular.EnumerateArray())
                {
                    var cevap = Yazi(s, "cevap");
                    if (string.IsNullOrWhiteSpace(cevap)) continue;
                    yazi.AppendLine($"S: {Yazi(s, "soru")}\nC: {cevap}");
                }

            if (k.ValueKind == JsonValueKind.Object)
            {
                var puanlar = Bul(k, "puanlar");

                if (puanlar.ValueKind == JsonValueKind.Array)
                    foreach (var p in puanlar.EnumerateArray())
                    {
                        var puan = Bul(p, "puan");
                        if (puan.ValueKind == JsonValueKind.Number && puan.TryGetInt32(out var n) && n > 0)
                            yazi.AppendLine($"{Yazi(p, "baslik")}: {n}/5");
                    }

                var tekrar = Bul(k, "tekrarCalisir");
                if (tekrar.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    yazi.AppendLine($"Tekrar çalışır mı: {(tekrar.GetBoolean() ? "Evet" : "Hayır")}");

                var tavsiye = Bul(k, "tavsiyePuani");
                if (tavsiye.ValueKind == JsonValueKind.Number)
                    yazi.AppendLine($"Tavsiye puanı: {tavsiye.GetInt32()}/10");
            }
        }
        catch (JsonException)
        {
            /* Bozuk JSON: yalnızca neden ve yorumlarla devam */
        }

        if (!string.IsNullOrWhiteSpace(uzmanYorumu)) yazi.AppendLine($"İK yorumu: {uzmanYorumu.Trim()}");
        if (!string.IsNullOrWhiteSpace(yoneticiYorumu)) yazi.AppendLine($"Yönetici yorumu: {yoneticiYorumu.Trim()}");

        return yazi.ToString().Trim();
    }

    public sealed record Sonuc(string Ozet, string Grup, string Hata);

    /// <summary>
    /// Özet ve grup tek çağrıda. Yapay zekâ cevap vermezse Ozet boş,
    /// Grup anahtar kelimeden, Hata dolu döner.
    /// </summary>
    public static async Task<Sonuc> Analiz(YapayZekaServisi yz, string metin, string cikisNedeni)
    {
        var yedekGrup = AnahtarlaSinifla(cikisNedeni);

        if (string.IsNullOrWhiteSpace(metin))
            return new Sonuc(null, BELIRTILMEMIS, null);

        var liste = string.Join("\n", GRUPLAR.Select(g => $"- {g.Ad}: {g.Tanim}"));

        var cevap = await yz.MetinOzetle(metin, $$"""
            Bir personelin işten ayrılırken verdiği çıkış mülakatı ya da çıkış
            anketi kaydını okuyacaksın. İki şey üret.

            1) ozet: kaydı TEK CÜMLEDE özetle (en fazla 20 kelime). Kişi neden
               ayrıldı ve şirketten memnun muydu? Örnek: "Çalışmaktan memnundu,
               taşındığı için ayrılıyor." Metinde olmayanı uydurma, kişi adı
               yazma, tırnak ya da madde işareti kullanma.

            2) grup: ayrılmanın ANA nedenini aşağıdaki listeden TAM OLARAK BİR
               başlık seçerek yaz (yazımı birebir aynı olsun):
            {{liste}}
            - {{BELIRTILMEMIS}}: kayıtta ayrılma nedeni hiç anlaşılmıyorsa

               Birden fazla neden varsa kişinin en çok vurguladığını seç.
               "Hastaydım, izin vermediler" gibi durumda asıl şikâyet izin
               verilmemesi olduğundan Çalışma koşulları ve saatler seçilir;
               "müdür beni çıkardı" İşveren kaynaklı çıkıştır.

            YALNIZCA şu biçimde JSON döndür, başka hiçbir şey yazma:
            {"ozet": "...", "grup": "..."}
            """);

        if (string.IsNullOrWhiteSpace(cevap)
            || cevap.StartsWith("Özet alınamadı", StringComparison.OrdinalIgnoreCase)
            || cevap.StartsWith("Özet çıkarılamadı", StringComparison.OrdinalIgnoreCase)
            || cevap.StartsWith("Yapay zekâ servisi kapalı", StringComparison.OrdinalIgnoreCase)
            || cevap.StartsWith("Özetlenecek metin", StringComparison.OrdinalIgnoreCase))
            return new Sonuc(null, yedekGrup, string.IsNullOrWhiteSpace(cevap) ? "Yapay zekâ boş cevap döndü." : cevap);

        try
        {
            var bas = cevap.IndexOf('{');
            var bit = cevap.LastIndexOf('}');

            if (bas < 0 || bit <= bas) throw new JsonException("JSON yok");

            using var belge = JsonDocument.Parse(cevap[bas..(bit + 1)]);

            var ozet = Yazi(belge.RootElement, "ozet")?.Trim();
            var grup = GrupEsle(Yazi(belge.RootElement, "grup")) ?? yedekGrup;

            if (!string.IsNullOrWhiteSpace(ozet) && ozet.Length > 380) ozet = ozet[..380];

            return new Sonuc(string.IsNullOrWhiteSpace(ozet) ? null : ozet, grup, null);
        }
        catch (JsonException)
        {
            /* Model JSON yerine düz cümle döndürdüyse cümle özet sayılıyor */
            var duz = cevap.Trim();
            return new Sonuc(duz.Length > 380 ? duz[..380] : duz, yedekGrup, null);
        }
    }

    /* ------------------------------------------------------------ yardımcı */

    private static JsonElement Bul(JsonElement kok, string ad)
    {
        if (kok.ValueKind != JsonValueKind.Object) return default;
        if (kok.TryGetProperty(ad, out var d)) return d;

        var buyuk = char.ToUpperInvariant(ad[0]) + ad[1..];
        return kok.TryGetProperty(buyuk, out var b) ? b : default;
    }

    private static string Yazi(JsonElement kok, string ad)
    {
        var d = Bul(kok, ad);
        return d.ValueKind == JsonValueKind.String ? d.GetString() : null;
    }
}

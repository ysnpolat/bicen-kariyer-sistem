using System.Text;

namespace BicenKariyer.API.Servisler;

/// <summary>Avans talep formunun verisi (AvansController doldurur).</summary>
public sealed class AvansFormVerisi
{
    public int Id { get; set; }
    public DateTime Olusturma { get; set; }

    public string AdSoyad { get; set; }
    public string Tc { get; set; }
    public string Sube { get; set; }
    public string Gorev { get; set; }
    public string Kidem { get; set; }
    public string Telefon { get; set; }

    public decimal Tutar { get; set; }
    public int Taksit { get; set; }
    public DateTime IlkKesinti { get; set; }
    public string Aciklama { get; set; }
    public string Neden { get; set; }

    /// <summary>İK tutarı/taksiti değiştirdiyse onaylanan değerler (yoksa null)</summary>
    public decimal? OnayTutar { get; set; }
    public int? OnayTaksit { get; set; }
    public DateTime? OnayIlkKesinti { get; set; }

    public List<(int Sira, DateTime Tarih, decimal Tutar)> Plan { get; set; } = new();

    public int BuYilAdet { get; set; }
    public int YillikHak { get; set; }
    public DateTime? SonAvans { get; set; }
    public bool DevamEdenVar { get; set; }
    public decimal KalanBorc { get; set; }

    public string Yonetici { get; set; }

    /// <summary>Genel müdür yardımcısının adı (onay kutusunda yazılı)</summary>
    public string Gmy { get; set; }

    public string IkOnaylayan { get; set; }
    public DateTime? KararTarihi { get; set; }
    public int KesintiGunu { get; set; } = 5;
}

/// <summary>
/// Avans talep formu (06.10.2026): yıllık izin formuyla aynı A4 düzen,
/// aynı stil ve yardımcılar. Maaş ve üst limit formda yok — formu personel
/// de imzalıyor, mobilde olduğu gibi bu bilgiler gizli.
/// </summary>
public partial class IzinFormuServisi
{
    private const string AvansCss = """
.plan{width:100%;border-collapse:collapse;font-size:13px}
.plan th{background:#eef5e2;text-align:left;font-size:11.5px;font-weight:800;letter-spacing:.04em;padding:6px 10px;border:1px solid #bfc6b8}
.plan td{padding:5px 10px;border:1px solid #bfc6b8;font-weight:700}
.plan .r{text-align:right}
.ikdz{border:1.5px dashed #8a9480;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.ikdz>b{font-size:12px;font-weight:800;letter-spacing:.04em}
""";

    private static readonly string[] AyAdlari =
        { "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık" };

    private static string Lira(decimal v) => "₺" + v.ToString("N2", Tr);

    /// <summary>Kesintinin yapıldığı bordro dönemi: kesinti ayından önceki ayın maaşı.</summary>
    private static string BordroDonemi(DateTime kesinti)
    {
        var d = kesinti.AddMonths(-1);
        return $"{AyAdlari[d.Month - 1]} {d.Year} maaşı";
    }

    /// <summary>Tutarı Türkçe yazıyla (lira ve varsa kuruş).</summary>
    public static string Yaziyla(decimal tutar)
    {
        var lira = (long)Math.Floor(tutar);
        var kurus = (int)Math.Round((tutar - lira) * 100m);
        var yazi = SayiYazi(lira);
        var s = (yazi.Length == 0 ? "Sıfır" : char.ToUpper(yazi[0], Tr) + yazi[1..]) + " Türk lirası";
        return kurus > 0 ? $"{s} {SayiYazi(kurus)} kuruş" : s;
    }

    private static string SayiYazi(long n)
    {
        if (n == 0) return "";

        string[] birler = { "", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz" };
        string[] onlar = { "", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan" };

        string Uc(int x)
        {
            var y = x / 100;
            var o = x % 100 / 10;
            var b = x % 10;
            var p = new List<string>();
            if (y > 0) p.Add(y == 1 ? "yüz" : birler[y] + " yüz");
            if (o > 0) p.Add(onlar[o]);
            if (b > 0) p.Add(birler[b]);
            return string.Join(" ", p);
        }

        var parcalar = new List<string>();
        var milyar = n / 1_000_000_000;
        var milyon = n / 1_000_000 % 1000;
        var bin = n / 1000 % 1000;
        var kalan = (int)(n % 1000);

        if (milyar > 0) parcalar.Add(Uc((int)milyar) + " milyar");
        if (milyon > 0) parcalar.Add(Uc((int)milyon) + " milyon");
        if (bin > 0) parcalar.Add(bin == 1 ? "bin" : Uc((int)bin) + " bin");
        if (kalan > 0) parcalar.Add(Uc(kalan));

        return string.Join(" ", parcalar);
    }

    /// <summary>Neden + açıklama: "Sağlık giderleri — ameliyat" ya da yalnızca açıklama (1.5)</summary>
    private static string NedenMetni(AvansFormVerisi v)
    {
        var n = (v.Neden ?? "").Trim();
        var a = (v.Aciklama ?? "").Trim();

        if (n.Length == 0) return a.Length == 0 ? "—" : a;
        return a.Length == 0 ? n : $"{n} — {a}";
    }

    /// <summary>Doldurulmuş A4 avans talep formu.</summary>
    public string AvansFormHtml(AvansFormVerisi v)
    {
        var tutar = v.OnayTutar ?? v.Tutar;
        var taksit = v.OnayTaksit ?? v.Taksit;
        var ilk = v.OnayIlkKesinti ?? v.IlkKesinti;
        var son = v.Plan.Count > 0 ? v.Plan[^1].Tarih : ilk.AddMonths(Math.Max(0, taksit - 1));
        var aylik = v.Plan.Count > 0 ? v.Plan[0].Tutar : Math.Round(tutar / Math.Max(1, taksit), 2);
        var degisti = v.OnayTutar is not null &&
                      (v.OnayTutar != v.Tutar || v.OnayTaksit != v.Taksit || v.OnayIlkKesinti?.Date != v.IlkKesinti.Date);

        var g = $"""
<header>
<img src="{H(FormLogo())}" alt="Biçen">
<div class="bas"><small>İNSAN KAYNAKLARI</small><h1>Avans Talep Formu</h1><span>Maaş avansı · {v.Olusturma.Year}</span>
<em>Talep #A-{v.Id} · {v.Olusturma:dd.MM.yyyy HH:mm}</em></div>
</header>
""";

        g += Bolum(1, "AVANS TALEBİNDE BULUNAN ÇALIŞAN",
            Izgara("minmax(0,1fr) 300px", Alan("Adı Soyadı", v.AdSoyad), Tc(v.Tc)) +
            Izgara("repeat(4,minmax(0,1fr))", Alan("Şube", v.Sube), Alan("Görev", v.Gorev),
                Alan("Biçen'de Çalışma Süresi", v.Kidem), Alan("Telefon Numarası", v.Telefon)) +
            $"""
<div class="bant"><div><b>Avans geçmişi</b><span style="color:#4b5563">Bu yıl ve devam eden avans</span></div>
<div class="g" style="flex-grow:1;grid-template-columns:repeat(4,minmax(0,1fr))">
{Alan("Bu Yıl Alınan Avans", $"{v.BuYilAdet} / {v.YillikHak}", "adet")}
{Alan("Son Avans Tarihi", v.SonAvans?.ToString("dd.MM.yyyy") ?? "—")}
{Alan("Devam Eden Avans", v.DevamEdenVar ? "Var" : "Yok")}
{Alan("Kalan Avans Borcu", v.KalanBorc.ToString("N2", Tr), "₺")}
</div></div>
""");

        var plan = new StringBuilder("""<table class="plan"><thead><tr><th style="width:70px">TAKSİT</th><th>KESİNTİ TARİHİ</th><th>BORDRO DÖNEMİ</th><th class="r">TUTAR</th><th class="r">KALAN</th></tr></thead><tbody>""");
        var kalan = tutar;

        foreach (var p in v.Plan)
        {
            kalan -= p.Tutar;
            plan.Append($"<tr><td>{p.Sira}</td><td>{p.Tarih:dd.MM.yyyy}</td><td>{H(BordroDonemi(p.Tarih))}</td><td class=\"r\">{H(Lira(p.Tutar))}</td><td class=\"r\">{H(Lira(Math.Max(0, kalan)))}</td></tr>");
        }

        plan.Append("</tbody></table>");

        g += Bolum(2, "AVANS TALEBİ",
            Izgara("repeat(4,minmax(0,1fr))",
                Alan("Talep Edilen Tutar", tutar.ToString("N2", Tr), "₺"),
                Alan("Taksit Sayısı", taksit.ToString(Tr), "taksit"),
                Alan("İlk Kesinti Tarihi", ilk.ToString("dd.MM.yyyy")),
                Alan("Aylık Kesinti Tutarı", aylik.ToString("N2", Tr), "₺")) +
            Izgara("minmax(0,1fr) minmax(0,1fr)",
                Alan("Yazıyla", Yaziyla(tutar)),
                Alan("Avans Talep Nedeni", NedenMetni(v))) +
            plan);

        g += Bolum(3, "ÇALIŞAN TAAHHÜDÜ", $"""
<div class="g" style="grid-template-columns:minmax(0,1fr) 210px">
<div class="talep" style="line-height:1.6;font-size:12.5px;padding:10px 14px">
Yukarıda belirtilen <b>{H(Lira(tutar))}</b> tutarındaki avansın <b>{ilk:dd.MM.yyyy}</b> tarihinden itibaren <b style="min-width:26px">{taksit}</b> eşit taksitle
maaşımdan kesilmesini kabul ediyorum. İş sözleşmemin herhangi bir nedenle sona ermesi hâlinde ödenmemiş avans bakiyesinin
ücret ve diğer alacaklarımdan mahsup edilmesine onay veriyorum. <span style="font-weight:700">Gereğini arz ederim.</span></div>
<div class="imzakutu"><b>Çalışan İmza</b><div style="flex-grow:1"></div>
<div class="satir"><span style="width:auto">Tarih</span><div>{v.Olusturma:dd.MM.yyyy}</div></div></div></div>
""");

        var ikDz = degisti
            ? $"""
<div class="ikdz"><b>İK DÜZENLEMESİ <span style="font-weight:600;color:#6b7280;letter-spacing:0">· personelin talebi: {H(Lira(v.Tutar))}, {v.Taksit} taksit, ilk kesinti {v.IlkKesinti:dd.MM.yyyy}</span></b>
<div class="g" style="grid-template-columns:repeat(3,minmax(0,1fr))">
<div class="satir"><span style="width:auto">Onaylanan tutar ₺</span><div>{H(tutar.ToString("N2", Tr))}</div></div>
<div class="satir"><span style="width:auto">Taksit sayısı</span><div>{taksit}</div></div>
<div class="satir"><span style="width:auto">İlk kesinti</span><div>{ilk:dd.MM.yyyy}</div></div></div></div>
"""
            : """
<div class="ikdz"><b>İK DÜZENLEMESİ <span style="font-weight:600;color:#6b7280;letter-spacing:0">· tutar veya taksit değiştirildiyse doldurulur</span></b>
<div class="g" style="grid-template-columns:repeat(3,minmax(0,1fr))">
<div class="satir"><span style="width:auto">Onaylanan tutar ₺</span><div></div></div>
<div class="satir"><span style="width:auto">Taksit sayısı</span><div></div></div>
<div class="satir"><span style="width:auto">İlk kesinti</span><div></div></div></div></div>
""";

        var ikKutu = string.IsNullOrWhiteSpace(v.IkOnaylayan)
            ? OnayKutusu("İNSAN KAYNAKLARI", 4, "Adı Soyadı", "Tarih")
            : $"<div class=\"onay\"><b>İNSAN KAYNAKLARI</b><div><div class=\"satir\"><span>Adı Soyadı</span><div>{H(v.IkOnaylayan)}</div></div><div class=\"satir\"><span>Tarih</span><div>{v.KararTarihi:dd.MM.yyyy}</div></div><span class=\"imz\">İmza</span><div style=\"height:4px\"></div></div></div>";

        g += Bolum(4, "ONAY",
            Izgara(Uc,
                string.IsNullOrWhiteSpace(v.Yonetici)
                    ? OnayKutusu("BİRİM YÖNETİCİSİ", 4, "Adı Soyadı", "Tarih")
                    : OnayKutusuDolu("BİRİM YÖNETİCİSİ", 4, v.Yonetici, "Tarih"),
                ikKutu,
                string.IsNullOrWhiteSpace(v.Gmy)
                    ? OnayKutusu("GENEL MÜDÜR YARDIMCISI", 4, "Adı Soyadı", "Tarih")
                    : OnayKutusuDolu("GENEL MÜDÜR YARDIMCISI", 4, v.Gmy, "Tarih")) + ikDz,
            alta: true);

        g += $"""
<footer><ul>
<li>Avans kesintileri her ayın {v.KesintiGunu}'inde, bir önceki ayın maaşından yapılır.</li>
<li>Ödemesi devam eden avansı bulunan çalışan, son taksit kesilmeden yeni avans talep edemez.</li>
<li>Bu form çalışan ve İnsan Kaynakları tarafından imzalanmadan avans ödemesi yapılmaz.</li>
</ul></footer>
""";

        return Sayfa($"Avans Talep Formu · {v.AdSoyad}", g).Replace("</style>", AvansCss + "</style>");
    }
}

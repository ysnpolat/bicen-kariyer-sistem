using System.Text;

namespace BicenKariyer.API.Servisler;

/// <summary>
/// Günlük QR okutma raporunun mail gövdesini üretir.
///
/// İki sürüm vardır: bölge müdürüne giden (yalnızca kendi mağazaları) ve
/// İK/yönetime giden (tüm bölgeler). İkisi de aynı yapıyı kullanır.
///
/// Rapor devamsızlık değil <b>okutma alışkanlığını</b> ölçer; mail metni de
/// bunu açıkça belirtir.
/// </summary>
public class OkutmaRaporuServisi
{
    /// <summary>Ulaşılması hedeflenen okutma oranı</summary>
    public static int HedefOran => Parametre.Sayi("okutma.hedefOran");

    private readonly VeritabaniServisi _vt;

    public OkutmaRaporuServisi(VeritabaniServisi vt) => _vt = vt;

    /* ==================================================================== */
    /* Veri                                                                  */
    /* ==================================================================== */

    /// <summary>Bir mağazanın günlük okutma özeti</summary>
    public class MagazaOzeti
    {
        public string Birim { get; set; }
        public string Bolge { get; set; }
        public int Toplam { get; set; }
        public int Okutan { get; set; }
        public int Okutmayan => Toplam - Okutan;
        public int Oran => Toplam > 0 ? (int)Math.Round(Okutan * 100.0 / Toplam) : 0;

        /// <summary>Önceki günün oranı; kıyas için</summary>
        public int OncekiOran { get; set; }
        public int Degisim => Oran - OncekiOran;

        /// <summary>Kaç gündür hiç okutma yok</summary>
        public int SifirGun { get; set; }

        /// <summary>
        /// Okutan ve okutmayan personelin adları.
        ///
        /// Yalnızca şubeye giden sürümde listelenir. Bölge müdürü onlarca
        /// mağazanın personelini tek mailde göremez; ona sayılar gider.
        /// </summary>
        public List<string> OkutanAdlar { get; set; } = new();
        public List<string> OkutmayanAdlar { get; set; } = new();

        /// <summary>
        /// Okutmadan muaf personel (Okutma Kuralları). Toplam'a ve
        /// okutmayanlara girmez; raporda ayrıca "Muaf" olarak yazılır.
        /// </summary>
        public List<string> MuafAdlar { get; set; } = new();
        public int Muaf => MuafAdlar.Count;

        /// <summary>
        /// Raporlu personel (personel kartındaki raporlar ve rapor izinleri).
        /// Muaf gibi Toplam'a ve okutmayanlara girmez; ayrıca "Raporlu"
        /// olarak yazılır.
        /// </summary>
        public List<string> RaporluAdlar { get; set; } = new();
        public int Raporlu => RaporluAdlar.Count;
    }

    /// <summary>Rapor gövdesi</summary>
    public class RaporVerisi
    {
        public DateTime Tarih { get; set; }
        public DateTime? BitisTarihi { get; set; }
        public string Baslik { get; set; }
        public List<MagazaOzeti> Magazalar { get; set; } = new();

        public int Toplam => Magazalar.Sum(x => x.Toplam);
        public int Okutan => Magazalar.Sum(x => x.Okutan);
        public int Okutmayan => Toplam - Okutan;
        public int Oran => Toplam > 0 ? (int)Math.Round(Okutan * 100.0 / Toplam) : 0;

        public int OncekiOkutan { get; set; }
        public int OncekiOran { get; set; }

        /// <summary>Kapsamdaki okutmadan muaf personel sayısı (Toplam'a dahil değil).</summary>
        public int MuafSayisi { get; set; }

        /// <summary>Kapsamdaki raporlu personel sayısı (Toplam'a dahil değil).</summary>
        public int RaporluSayisi { get; set; }
    }

    /* ==================================================================== */
    /* HTML üretimi                                                          */
    /* ==================================================================== */

    /// <summary>Orana göre renk</summary>
    private static string Renk(int oran) =>
        oran >= 80 ? "#389e0d" : oran >= 50 ? "#7cb305"
        : oran >= 25 ? "#d48806" : "#cf1322";

    /// <summary>Değişim rozeti</summary>
    private static string Degisim(int fark)
    {
        if (fark > 0)
            return $"<span style='color:#389e0d;font-weight:700'>&#9650; {fark} puan</span>";

        if (fark < 0)
            return $"<span style='color:#cf1322;font-weight:700'>&#9660; {Math.Abs(fark)} puan</span>";

        return "<span style='color:#9aa3af'>&#8212;</span>";
    }

    /// <summary>Mağaza satırı</summary>
    private static string Satir(MagazaOzeti m, int sira, bool bolgeGoster)
    {
        var zemin = m.Oran == 0 ? "#fff5f5"
            : m.Oran >= 60 ? "#f8fdf4" : "#ffffff";

        var etiket = "";

        if (m.Oran == 0)
            etiket = "<span style='background:#fff1f0;color:#cf1322;font-size:11px;"
                   + "padding:2px 8px;border-radius:20px;margin-left:6px'>hiç okutmadı</span>";

        return $@"
<tr style='background:{zemin}'>
  <td style='padding:9px 10px;border:1px solid #eef0ec;color:#9aa3af;font-size:12px'>{sira}</td>
  <td style='padding:9px 10px;border:1px solid #eef0ec;font-weight:600'>{m.Birim}{etiket}
    {(bolgeGoster ? $"<div style='font-size:11px;color:#8a8f98;font-weight:400'>{m.Bolge}</div>" : "")}
  </td>
  <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right'>{m.Okutan} / {m.Toplam}</td>
  <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right;white-space:nowrap'>
    <b style='color:{Renk(m.Oran)};font-size:14px'>%{m.Oran}</b>
  </td>
  <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right;font-size:12px'>{Degisim(m.Degisim)}</td>
</tr>";
    }

    /// <summary>Rapor HTML'i üretir.</summary>
    /// <param name="subeSurumu">
    /// Alıcı bir şubeyse true. Şube müdürü kendi personeliyle konuşur;
    /// "bölgeniz" ve "mağaza müdürleriyle görüşün" ifadeleri bölge
    /// müdürüne yazılmış metinlerdir ve şubede yanlış durur.
    /// </param>
    public string Govde(RaporVerisi veri, string alici, bool genelSurum,
                        bool subeSurumu = false)
    {
        var s = new StringBuilder();

        var siraliMagazalar = veri.Magazalar
            .OrderBy(x => x.Oran)
            .ThenBy(x => x.Birim)
            .ToList();

        var hicOkutmayanlar = siraliMagazalar.Where(x => x.Oran == 0).ToList();

        var enCokGelisen = veri.Magazalar
            .Where(x => x.Degisim > 0)
            .OrderByDescending(x => x.Degisim)
            .Take(3)
            .ToList();

        var tarihMetni = veri.BitisTarihi is null
            ? veri.Tarih.ToString("dd MMMM yyyy, dddd",
                new System.Globalization.CultureInfo("tr-TR"))
            : $"{veri.Tarih:dd.MM.yyyy} – {veri.BitisTarihi:dd.MM.yyyy}";

        /* Outlook gradient desteklemez; düz renk kullanılır */
        var ustRenkDuz = veri.Oran >= HedefOran ? "#7CB518" : "#E8481C";

        /* Mail istemcileri için tablo tabanlı düzen; div ve flex Outlook'ta
           dağılıyor. Genişlik sabit, hizalama hücre özellikleriyle yapılıyor. */
        s.Append($@"
<table width='100%' cellpadding='0' cellspacing='0' border='0'
       style='background:#eef1ea;padding:20px 0'>
<tr><td align='center'>

<table width='680' cellpadding='0' cellspacing='0' border='0'
       style=""max-width:680px;background:#ffffff;border-radius:12px;
              font-family:'Segoe UI',Arial,sans-serif;color:#1f2933"">

  <tr>
    <td style='padding:22px 24px 18px;background:{ustRenkDuz};color:#ffffff;
               border-radius:12px 12px 0 0'>
      <div style='font-size:19px;font-weight:700;margin-bottom:4px'>
        Günlük QR Okutma Raporu</div>
      <div style='font-size:13.5px'>{tarihMetni} · {veri.Baslik}</div>
    </td>
  </tr>

  <tr><td style='padding:20px 24px'>

    <p style='font-size:14px;line-height:1.65;margin:0 0 18px'>
      {(string.IsNullOrWhiteSpace(alici) ? "" : $"Sayın <b>{alici}</b>,<br>")}
      {(genelSurum ? "Şirket genelinde" : subeSurumu ? "Şubenizde" : "Bölgenizde")}
      <b>{veri.Toplam} personelden {veri.Okutan}'i</b> giriş çıkış okuttu.
      {(veri.MuafSayisi > 0 ? $"{veri.MuafSayisi} personel okutmadan muaf olduğu için hesaba katılmadı. " : "")}
      {(veri.RaporluSayisi > 0 ? $"{veri.RaporluSayisi} personel raporlu olduğu için hesaba katılmadı. " : "")}
      {(veri.Oran >= HedefOran
        ? "Okutma oranı hedefin üzerinde; emeğiniz için teşekkür ederiz."
        : subeSurumu
          ? "Okutma oranı hedefin altında; okutmayan personelinizle görüşmenizi rica ederiz."
          : "Okutma oranı hedefin altında; ilgili mağaza müdürleriyle görüşmenizi rica ederiz.")}
    </p>

    <table width='100%' cellpadding='0' cellspacing='6' border='0'
           style='margin-bottom:18px'>
      <tr>
        <td style='padding:12px 10px;border:1px solid #e6ebe0;border-radius:10px;
                   background:#fbfcfa;text-align:center;width:33%'>
          <div style='font-size:11px;color:#6b7280;margin-bottom:3px'>Çalışan personel</div>
          <div style='font-size:22px;font-weight:800'>{veri.Toplam}</div>
        </td>
        <td style='padding:12px 10px;border:1px solid #e6ebe0;border-radius:10px;
                   background:#fbfcfa;text-align:center;width:33%'>
          <div style='font-size:11px;color:#6b7280;margin-bottom:3px'>Okutan</div>
          <div style='font-size:22px;font-weight:800;color:#389e0d'>{veri.Okutan}</div>
          <div style='font-size:11px;color:#8a8f98'>dün {veri.OncekiOkutan}</div>
        </td>
        <td style='padding:12px 10px;border:1px solid #e6ebe0;border-radius:10px;
                   background:#fbfcfa;text-align:center;width:33%'>
          <div style='font-size:11px;color:#6b7280;margin-bottom:3px'>Okutmayan</div>
          <div style='font-size:22px;font-weight:800;color:#cf1322'>{veri.Okutmayan}</div>
        </td>
      </tr>
    </table>

    <table width='100%' cellpadding='0' cellspacing='0' border='0'
           style='margin-bottom:6px'>
      <tr>
        <td style='font-size:13px;font-weight:700'>
          {(genelSurum ? "Şirket geneli" : "Bölge")} okutma oranı</td>
        <td align='right' style='font-size:16px;font-weight:700;color:{Renk(veri.Oran)}'>
          %{veri.Oran}</td>
      </tr>
    </table>

    <table width='100%' cellpadding='0' cellspacing='0' border='0'
           style='margin-bottom:6px;background:#eef0ec;border-radius:6px'>
      <tr>
        <td width='{Math.Min(100, veri.Oran)}%'
            style='height:12px;background:{Renk(veri.Oran)};border-radius:6px;
                   font-size:0;line-height:0'>&nbsp;</td>
        <td style='height:12px;font-size:0;line-height:0'>&nbsp;</td>
      </tr>
    </table>
    <p style='font-size:11.5px;color:#6b7280;margin:0 0 20px'>
      Hedef %{HedefOran} · dünkü oran %{veri.OncekiOran} · {Degisim(veri.Oran - veri.OncekiOran)}
    </p>");

        /* ------------------------------------------- hiç okutmayan mağazalar */
        if (hicOkutmayanlar.Count > 0)
        {
            s.Append(@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                border-bottom:2px solid #E8481C'>Hiç Okutmayan Mağazalar</div>
    <p style='font-size:12px;color:#6b7280;margin:0 0 12px'>
      Tek bir personelin bile okutmadığı mağazalar.</p>

    <table style='width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px'>
      <tr>
        <th style='text-align:left;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Mağaza</th>
        <th style='text-align:right;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Personel</th>
        <th style='text-align:right;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Kaç gündür</th>
      </tr>");

            foreach (var m in hicOkutmayanlar.OrderByDescending(x => x.SifirGun))
            {
                var vurgu = m.SifirGun >= 5
                    ? "color:#cf1322;font-weight:700"
                    : "";

                s.Append($@"
      <tr style='background:#fff5f5'>
        <td style='padding:9px 10px;border:1px solid #eef0ec;font-weight:600'>{m.Birim}
          <div style='font-size:11px;color:#8a8f98;font-weight:400'>{m.Bolge}</div></td>
        <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right'>{m.Toplam}</td>
        <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right;{vurgu}'>
          {(m.SifirGun > 0 ? $"{m.SifirGun} gün" : "bugün")}</td>
      </tr>");
            }

            s.Append("</table>");
        }

        /* ------------------------------------------------- tüm mağaza listesi */
        s.Append($@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                border-bottom:2px solid #7CB518'>
      {(genelSurum ? "Tüm Mağazalar" : subeSurumu ? "Şubeniz" : "Bölgenizdeki Mağazalar")}</div>
    <p style='font-size:12px;color:#6b7280;margin:0 0 12px'>
      Okutma oranına göre sıralanmıştır.</p>

    <table style='width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px'>
      <tr>
        <th style='padding:8px 10px;background:#f4f7f0;border:1px solid #dfe5d6'></th>
        <th style='text-align:left;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Mağaza</th>
        <th style='text-align:right;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Okutan</th>
        <th style='text-align:right;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Oran</th>
        <th style='text-align:right;padding:8px 10px;background:#f4f7f0;
                   border:1px solid #dfe5d6;font-size:12px'>Değişim</th>
      </tr>");

        var sira = 1;

        foreach (var m in siraliMagazalar.OrderByDescending(x => x.Oran))
            s.Append(Satir(m, sira++, genelSurum));

        s.Append("</table>");

        /* ------------------------------------------------- personel listesi
           Yalnızca şubeye giden sürümde. Şube müdürü kimin okutup kimin
           okutmadığını görmeli; bölge müdürüne onlarca mağazanın personel
           listesi gitseydi mail okunmaz hâle gelirdi. */
        if (subeSurumu)
        {
            foreach (var m in siraliMagazalar)
            {
                if (m.OkutmayanAdlar.Count > 0)
                    s.Append($@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                margin-bottom:12px;border-bottom:2px solid #E8481C'>
      Okutmayan Personel ({m.OkutmayanAdlar.Count})</div>
    <div style='font-size:13px;line-height:1.9;margin-bottom:20px;color:#1f2933'>
      {string.Join(" &middot; ", m.OkutmayanAdlar)}</div>");

                if (m.OkutanAdlar.Count > 0)
                    s.Append($@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                margin-bottom:12px;border-bottom:2px solid #7CB518'>
      Okutan Personel ({m.OkutanAdlar.Count})</div>
    <div style='font-size:13px;line-height:1.9;margin-bottom:20px;color:#5b6470'>
      {string.Join(" &middot; ", m.OkutanAdlar)}</div>");

                if (m.MuafAdlar.Count > 0)
                    s.Append($@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                margin-bottom:12px;border-bottom:2px solid #9aa3af'>
      Muaf ({m.MuafAdlar.Count})</div>
    <div style='font-size:13px;line-height:1.9;margin-bottom:20px;color:#8a8f98'>
      {string.Join(" &middot; ", m.MuafAdlar)}
      <div style='font-size:11.5px;margin-top:4px'>Okutmadan muaf tutulan personel; okutma oranına katılmaz.</div></div>");

                if (m.RaporluAdlar.Count > 0)
                    s.Append($@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                margin-bottom:12px;border-bottom:2px solid #9254de'>
      Raporlu ({m.RaporluAdlar.Count})</div>
    <div style='font-size:13px;line-height:1.9;margin-bottom:20px;color:#8a8f98'>
      {string.Join(" &middot; ", m.RaporluAdlar)}
      <div style='font-size:11.5px;margin-top:4px'>Sağlık raporlu personel; okutma oranına katılmaz.</div></div>");
            }
        }

        /* ------------------------------------------------ öne çıkan gelişme */
        if (enCokGelisen.Count > 0)
        {
            s.Append(@"
    <div style='font-size:15px;font-weight:700;padding-bottom:8px;
                margin-bottom:12px;border-bottom:2px solid #7CB518'>
      En Çok Gelişen Mağazalar</div>
    <table style='width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px'>");

            foreach (var m in enCokGelisen)
                s.Append($@"
      <tr style='background:#f8fdf4'>
        <td style='padding:9px 10px;border:1px solid #eef0ec;font-weight:600'>{m.Birim}</td>
        <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right'>
          <b style='color:{Renk(m.Oran)}'>%{m.Oran}</b></td>
        <td style='padding:9px 10px;border:1px solid #eef0ec;text-align:right'>{Degisim(m.Degisim)}</td>
      </tr>");

            s.Append("</table>");
        }

        s.Append($@"
    <table width='100%' cellpadding='0' cellspacing='0' border='0'
           style='margin-top:18px'>
      <tr>
        <td width='3' style='background:#7CB518;font-size:0'>&nbsp;</td>
        <td style='padding:12px 14px;background:#f6f8f3;font-size:12.5px;
                   line-height:1.6;color:#4a5560'>
          <b>Not:</b> Okutma kaydı bulunmayan her personel devamsız değildir;
          izinli olabilir ya da okutmayı atlamış olabilir. Bu rapor devamsızlık
          değil <b>okutma alışkanlığını</b> ölçer. Personel adlarının tamamı
          panelde yer alır.
        </td>
      </tr>
    </table>

  </td></tr>

  <tr>
    <td style='padding:16px 24px;background:#fafbf8;border-top:1px solid #e6ebe0;
               font-size:11.5px;color:#8a8f98;line-height:1.6;
               border-radius:0 0 12px 12px'>
      Bu ileti Biçen Market İnsan Kaynakları sisteminden otomatik
      gönderilmiştir. Her gün saat 10:00'da bir önceki günün raporunu içerir.<br>
      Sorularınız için: ik@bicen.com.tr
    </td>
  </tr>

</table>

</td></tr>
</table>");

        return s.ToString();
    }

    /// <summary>Mail konusu</summary>
    public string Konu(RaporVerisi veri, bool genelSurum)
    {
        var hic = veri.Magazalar.Count(x => x.Oran == 0);

        var tarih = veri.BitisTarihi is null
            ? veri.Tarih.ToString("dd.MM")
            : $"{veri.Tarih:dd.MM}-{veri.BitisTarihi:dd.MM}";

        var kapsam = genelSurum ? "Şirket geneli" : "Bölgeniz";

        return hic > 0
            ? $"{tarih} Okutma Raporu · {kapsam} %{veri.Oran} · {hic} mağaza hiç okutmadı"
            : $"{tarih} Okutma Raporu · {kapsam} %{veri.Oran}";
    }
}

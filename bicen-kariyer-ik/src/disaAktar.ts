/**
 * ---------------------------------------------------------------------------
 * Dışa Aktarma Yardımcıları
 * ---------------------------------------------------------------------------
 * Üç biçim desteklenir:
 *
 *   Excel  → Biçimlendirmeyi koruyan HTML tablosu (.xls). Excel bu dosyayı
 *            açtığında renkler, kenarlıklar ve hizalamalar korunur; düz CSV
 *            ile bu mümkün değildir.
 *   PDF    → Ekrandaki alan görüntüye çevrilip A4 yatay sayfaya yerleştirilir
 *            ve doğrudan indirilir; yazdırma penceresi açılmaz.
 *   Görsel → Aynı görüntü PNG olarak indirilir.
 * ---------------------------------------------------------------------------
 */

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/** Tarayıcıda dosya indirmeyi başlatır */
const indir = (veri: Blob | string, dosyaAdi: string) => {
  const bag = document.createElement("a");

  bag.href = typeof veri === "string" ? veri : URL.createObjectURL(veri);
  bag.download = dosyaAdi;

  document.body.appendChild(bag);
  bag.click();
  document.body.removeChild(bag);

  if (typeof veri !== "string") URL.revokeObjectURL(bag.href);
};

/** Dosya adına eklenecek tarih damgası */
export const tarihDamgasi = (): string =>
  new Date().toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/* Excel                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Bir HTML tablosunu biçimlendirmesiyle birlikte Excel dosyası olarak indirir.
 *
 * Ekrandaki tablo kopyalanır ve hesaplanmış stiller (arka plan, yazı rengi,
 * kalınlık, hizalama) satır içi yazılır. Excel bu bilgileri okuduğu için
 * çıktı ekrandakiyle aynı görünür.
 */
export const excelOlarakIndir = (
  kaynak: HTMLElement,
  dosyaAdi: string,
  baslik?: string
) => {
  /* Biçimli .xlsx: raporExcel.htmlTabloIndir. Eski HTML→.xls yolu
     Excel'de "biçim uzantıyla eşleşmiyor" uyarısı veriyordu. */
  const tabloEl = kaynak instanceof HTMLTableElement
    ? kaynak
    : (kaynak.querySelector("table") as HTMLElement | null) ?? kaynak;

  import("./raporExcel").then(({ htmlTabloIndir }) =>
    htmlTabloIndir(tabloEl, dosyaAdi, baslik ?? "Rapor")
  );
};

/* -------------------------------------------------------------------------- */
/* PDF ve görsel                                                               */
/* -------------------------------------------------------------------------- */

/** Alanı yüksek çözünürlüklü bir görüntüye çevirir */
const goruntuAl = (kaynak: HTMLElement) =>
  html2canvas(kaynak, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });

/**
 * Alanı A4 yatay bir PDF olarak indirir.
 * Genişlik sayfaya sığdırılır; taşan yükseklik ek sayfalara bölünür.
 */
export const pdfOlarakIndir = async (
  kaynak: HTMLElement,
  dosyaAdi: string,
  baslik?: string
) => {
  const tuval = await goruntuAl(kaynak);

  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  const kenar = 8;
  const sayfaGenislik = pdf.internal.pageSize.getWidth();
  const sayfaYukseklik = pdf.internal.pageSize.getHeight();

  let ustBosluk = kenar;

  if (baslik) {
    pdf.setFontSize(12);
    pdf.text(baslik, kenar, kenar + 4);
    ustBosluk = kenar + 9;
  }

  const alanGenislik = sayfaGenislik - kenar * 2;
  const oran = alanGenislik / tuval.width;
  const tamYukseklik = tuval.height * oran;
  const sayfaAlani = sayfaYukseklik - ustBosluk - kenar;

  const gorsel = tuval.toDataURL("image/png");

  if (tamYukseklik <= sayfaAlani) {
    pdf.addImage(gorsel, "PNG", kenar, ustBosluk, alanGenislik, tamYukseklik);
  } else {
    /* Uzun tablolar sayfalara bölünür */
    let kalan = tamYukseklik;
    let kaydirma = 0;

    while (kalan > 0) {
      pdf.addImage(
        gorsel,
        "PNG",
        kenar,
        ustBosluk - kaydirma,
        alanGenislik,
        tamYukseklik
      );

      kalan -= sayfaAlani;
      kaydirma += sayfaAlani;

      if (kalan > 0) {
        pdf.addPage();
        ustBosluk = kenar;
      }
    }
  }

  pdf.save(`${dosyaAdi}.pdf`);
};

/** Alanı PNG görsel olarak indirir */
export const gorselOlarakIndir = async (
  kaynak: HTMLElement,
  dosyaAdi: string
) => {
  const tuval = await goruntuAl(kaynak);
  indir(tuval.toDataURL("image/png"), `${dosyaAdi}.png`);
};

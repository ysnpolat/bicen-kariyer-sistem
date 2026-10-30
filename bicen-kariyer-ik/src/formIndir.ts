/**
 * ---------------------------------------------------------------------------
 * İndirme İşlemleri
 * ---------------------------------------------------------------------------
 * - formuIndir  : Başvuru formunu tek başına açılabilen HTML dosyası olarak
 *                 indirir. Logo dosyanın içine gömülür, dış bağlantı kalmaz.
 * - listeyiIndir: Başvuru listesini Excel ile açılabilen CSV dosyasına aktarır.
 * ---------------------------------------------------------------------------
 */

import { LOGO_ADRESI } from "./api";
import { ONIZLEME_STIL } from "./onizlemeStil";

/* -------------------------------------------------------------------------- */
/* Ortak                                                                       */
/* -------------------------------------------------------------------------- */

export const dosyaIndir = (icerik: Blob, dosyaAdi: string): void => {
  const adres = URL.createObjectURL(icerik);
  const bag = document.createElement("a");
  bag.href = adres;
  bag.download = dosyaAdi;
  document.body.appendChild(bag);
  bag.click();
  document.body.removeChild(bag);
  setTimeout(() => URL.revokeObjectURL(adres), 1000);
};

/** Dosya adında kullanılamayacak karakterleri temizler */
const dosyaAdiTemizle = (metin: string): string =>
  (metin || "basvuru")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);

/** Kurum logosunu base64'e çevirir (indirilen dosyaya gömmek için) */
const logoBase64 = async (): Promise<string> => {
  try {
    const cevap = await fetch(LOGO_ADRESI);
    if (!cevap.ok) return "";
    const veri = await cevap.blob();
    return await new Promise<string>((coz) => {
      const okuyucu = new FileReader();
      okuyucu.onload = () => coz(String(okuyucu.result));
      okuyucu.onerror = () => coz("");
      okuyucu.readAsDataURL(veri);
    });
  } catch {
    return "";
  }
};

/* -------------------------------------------------------------------------- */
/* Başvuru formu                                                               */
/* -------------------------------------------------------------------------- */

export const formuIndir = async (
  belge: HTMLElement | null,
  basvuruNo: string,
  adSoyad: string
): Promise<void> => {
  if (!belge) throw new Error("Form içeriği bulunamadı.");

  const logo = await logoBase64();

  let govde = belge.outerHTML;
  if (logo) {
    // Dış bağlantı kalmaması için logo dosyanın içine gömülür
    govde = govde.split(LOGO_ADRESI).join(logo);
  } else {
    // Logo alınamadıysa kırık görsel yerine hiç gösterilmez
    govde = govde.replace(/<img[^>]*class="on-logo"[^>]*>/g, "");
  }

  const baslik = `${basvuruNo} - ${adSoyad}`;

  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${baslik}</title>
<style>
  body {
    margin: 0;
    padding: 18px;
    background: #fff;
    font-family: 'Segoe UI', Arial, sans-serif;
    color: #1f2933;
  }
  .sarmal { max-width: 900px; margin: 0 auto; }
  .yazdir-cubugu {
    max-width: 900px;
    margin: 0 auto 14px;
    display: flex;
    justify-content: flex-end;
  }
  .yazdir-cubugu button {
    border: 1px solid #7cb518;
    background: #7cb518;
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
  }
  @media print {
    @page { size: A4; margin: 10mm; }
    body { padding: 0; }
    .yazdir-cubugu { display: none; }
  }
${ONIZLEME_STIL}
</style>
</head>
<body>
  <div class="yazdir-cubugu">
    <button onclick="window.print()">Yazdır / PDF olarak kaydet</button>
  </div>
  <div class="sarmal">${govde}</div>
</body>
</html>`;

  dosyaIndir(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `${dosyaAdiTemizle(basvuruNo)}_${dosyaAdiTemizle(adSoyad)}.html`
  );
};

/* -------------------------------------------------------------------------- */
/* Liste (CSV)                                                                 */
/* -------------------------------------------------------------------------- */

const csvAlan = (deger: unknown): string => {
  const metin = deger === null || deger === undefined ? "" : String(deger);
  return `"${metin.replace(/"/g, '""')}"`;
};

export const listeyiIndir = (kayitlar: any[], dosyaAdi = "basvurular"): void => {
  /* Biçimli .xlsx: raporExcel.tabloIndir. Döngüsel içe aktarım olmasın
     diye dinamik yüklenir. */
  import("./raporExcel").then(({ tabloIndir }) =>
    tabloIndir({
      baslik: "Başvurular",
      altBaslik: `${kayitlar.length} kayıt`,
      sayfaAdi: "Başvurular",
      dosyaAdi,
      grupSutunu: 5,
      genelToplam: true,
      sutunlar: [
        { ad: "Başvuru No", genislik: 20 },
        { ad: "Ad Soyad", genislik: 26 },
        { ad: "Kimlik No", genislik: 14 },
        { ad: "Telefon", genislik: 13 },
        { ad: "E-posta", genislik: 24 },
        { ad: "Şube", genislik: 22 },
        { ad: "İlçe", genislik: 14 },
        { ad: "Mahalle", genislik: 18 },
        { ad: "Bölümler", genislik: 26 },
        { ad: "Durum", genislik: 16 },
        { ad: "Görüşme Tarihi", tip: "tarihSaat" },
        { ad: "Başvuru Tarihi", tip: "tarihSaat" },
        { ad: "Ücret Beklentisi", tip: "sayi", toplam: false },
        { ad: "Mail Durumu", genislik: 11 },
        { ad: "Not Sayısı", tip: "sayi" },
        { ad: "Değerlendirme Notu", genislik: 40 },
      ],
      satirlar: kayitlar.map((k) => [
        k.basvuruNo, k.adSoyad, k.kimlikNo, k.telefon, k.eposta, k.subeAdi, k.ilce, k.mahalle,
        k.bolumler, k.durum, k.gorusmeTarihi ?? null, k.olusturma ?? null,
        k.talepUcret ?? null, k.mailGonderildi ? "Gitti" : "Gitmedi", k.notSayisi ?? 0,
        k.degerlendirmeNotu,
      ]),
    })
  );
};

export const kirilimIndir = (
  kayitlar: {
    ad: string;
    toplam: number;
    gorusme: number;
    olumlu: number;
    olumsuz: number;
    hedef?: number;
  }[],
  adBasligi: string,
  dosyaAdi: string
): void => {
  import("./raporExcel").then(({ tabloIndir }) =>
    tabloIndir({
      baslik: `${adBasligi} Bazında Başvurular`,
      altBaslik: `${kayitlar.length} ${adBasligi.toLocaleLowerCase("tr")}`,
      sayfaAdi: adBasligi,
      dosyaAdi,
      genelToplam: true,
      sutunlar: [
        { ad: adBasligi, genislik: 30 },
        { ad: "Başvuru", tip: "sayi", veriCubugu: true },
        { ad: "Görüşme", tip: "sayi" },
        { ad: "Olumlu", tip: "sayi" },
        { ad: "Olumsuz", tip: "sayi" },
        { ad: "Hedef", tip: "ondalik", toplam: false },
        { ad: "Olumlu Oranı", tip: "yuzde", renkOlcegi: true },
      ],
      satirlar: kayitlar.map((k) => [
        k.ad, k.toplam, k.gorusme, k.olumlu, k.olumsuz, k.hedef ?? null,
        k.toplam > 0 ? k.olumlu / k.toplam : 0,
      ]),
    })
  );
};

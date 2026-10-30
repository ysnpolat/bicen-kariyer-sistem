import dayjs, { Dayjs } from "dayjs";

/** T.C. Kimlik Numarası algoritma kontrolü */
export const tcKimlikGecerliMi = (deger: string): boolean => {
  if (!/^[1-9][0-9]{10}$/.test(deger)) return false;
  const h = deger.split("").map(Number);
  const tekToplam = h[0] + h[2] + h[4] + h[6] + h[8];
  const ciftToplam = h[1] + h[3] + h[5] + h[7];
  const onuncu = (((tekToplam * 7 - ciftToplam) % 10) + 10) % 10;
  if (onuncu !== h[9]) return false;
  const ilkOnToplam = h.slice(0, 10).reduce((a, b) => a + b, 0);
  return ilkOnToplam % 10 === h[10];
};

/** Dayjs değerini GG.AA.YYYY metnine çevirir */
export const tarihMetin = (d?: Dayjs | null): string =>
  d ? d.format("DD.MM.YYYY") : "";

/** Dayjs değerini AA.YYYY metnine çevirir */
export const ayMetin = (d?: Dayjs | null): string =>
  d ? d.format("MM.YYYY") : "";

/** Başvuru referans numarası: BSV-20260727-4821 */
export const basvuruNoUret = (): string => {
  const rastgele = Math.floor(1000 + Math.random() * 9000);
  return `BSV-${dayjs().format("YYYYMMDD")}-${rastgele}`;
};

/** Sadece rakam girişine izin verir */
export const sadeceRakam = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (!/[0-9]/.test(e.key)) e.preventDefault();
};

/** Metni güvenli biçimde kırpar */
export const kirp = (deger?: string | null): string => (deger ?? "").trim();

/* -------------------------------------------------------------------------- */
/* Görsel işlemleri                                                            */
/* -------------------------------------------------------------------------- */

import { SERTIFIKA_AYARLARI } from "./sabitler";
import type { SertifikaGorseli } from "./tipler";

/** Dosyayı base64 metnine çevirir (data URL öneki olmadan) */
const base64Cevir = (dosya: File): Promise<string> =>
  new Promise((coz, reddet) => {
    const okuyucu = new FileReader();
    okuyucu.onload = () => coz(String(okuyucu.result).split(",")[1] ?? "");
    okuyucu.onerror = () => reddet(new Error("Dosya okunamadı."));
    okuyucu.readAsDataURL(dosya);
  });

/** Dosyayı data URL olarak okur */
const dataUrlCevir = (dosya: File): Promise<string> =>
  new Promise((coz, reddet) => {
    const okuyucu = new FileReader();
    okuyucu.onload = () => coz(String(okuyucu.result));
    okuyucu.onerror = () => reddet(new Error("Dosya okunamadı."));
    okuyucu.readAsDataURL(dosya);
  });

/**
 * Görseli çizilebilir bir kaynağa çevirir.
 * Önce createImageBitmap denenir (daha hızlıdır ve daha çok biçimi tanır),
 * desteklenmiyorsa klasik Image nesnesine düşülür.
 */
const gorseliCoz = async (
  dosya: File
): Promise<{ kaynak: CanvasImageSource; genislik: number; yukseklik: number }> => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(dosya);
      return { kaynak: bitmap, genislik: bitmap.width, yukseklik: bitmap.height };
    } catch {
      /* desteklenmiyorsa aşağıdaki yönteme geçilir */
    }
  }

  const dataUrl = await dataUrlCevir(dosya);

  const resim = await new Promise<HTMLImageElement>((coz, reddet) => {
    const r = new Image();
    r.onload = () => coz(r);
    r.onerror = () => reddet(new Error("Görsel açılamadı."));
    r.src = dataUrl;
  });

  return { kaynak: resim, genislik: resim.width, yukseklik: resim.height };
};

/**
 * Seçilen görseli tarayıcı tarafında küçültüp JPEG olarak sıkıştırır.
 *
 * Görsel çözülemezse (örneğin iPhone'un HEIC biçimi bazı tarayıcılarda
 * açılamaz) dosya olduğu gibi kullanılır; aday başvurusu bu yüzden
 * yarıda kalmaz.
 */
export const gorselKucult = async (
  dosya: File,
  enBuyukKenar: number = SERTIFIKA_AYARLARI.enBuyukKenar,
  kalite: number = SERTIFIKA_AYARLARI.kalite
): Promise<SertifikaGorseli> => {
  try {
    const { kaynak, genislik, yukseklik } = await gorseliCoz(dosya);

    if (!genislik || !yukseklik) throw new Error("Görsel boyutu okunamadı.");

    let g = genislik;
    let y = yukseklik;

    if (g > enBuyukKenar || y > enBuyukKenar) {
      const oran = Math.min(enBuyukKenar / g, enBuyukKenar / y);
      g = Math.round(g * oran);
      y = Math.round(y * oran);
    }

    const tuval = document.createElement("canvas");
    tuval.width = g;
    tuval.height = y;

    const ctx = tuval.getContext("2d");
    if (!ctx) throw new Error("Görsel işlenemedi.");

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, g, y);
    ctx.drawImage(kaynak, 0, 0, g, y);

    const dataUrl = tuval.toDataURL("image/jpeg", kalite);
    const base64 = dataUrl.split(",")[1] ?? "";

    if (!base64) throw new Error("Görsel dönüştürülemedi.");

    // Bitmap kullanıldıysa belleği serbest bırak
    if (typeof ImageBitmap !== "undefined" && kaynak instanceof ImageBitmap) {
      kaynak.close();
    }

    return { ad: dosya.name, tur: "image/jpeg", base64 };
  } catch (hata) {
    console.warn("Görsel küçültülemedi, dosya olduğu gibi kullanılıyor:", hata);

    // Küçültme yapılamadıysa dosyayı doğrudan kullan
    if (dosya.size <= 6 * 1024 * 1024) {
      const base64 = await base64Cevir(dosya);
      if (base64) {
        return {
          ad: dosya.name,
          tur: dosya.type || "image/jpeg",
          base64,
        };
      }
    }

    throw new Error(
      "Bu fotoğraf işlenemedi. Lütfen JPG veya PNG biçiminde, 6 MB'tan küçük " +
        "bir dosya seçiniz. (iPhone kullanıyorsanız Ayarlar → Kamera → Biçimler " +
        "bölümünden \"En Uyumlu\" seçeneğini işaretleyebilirsiniz.)"
    );
  }
};

/** Görseli <img src> içinde kullanılabilir hâle getirir */
export const gorselAdresi = (gorsel?: SertifikaGorseli | null): string =>
  gorsel ? `data:${gorsel.tur};base64,${gorsel.base64}` : "";

/** Başında http/https olmayan adreslere https ekler */
export const adresiDuzelt = (adres: string): string => {
  const temiz = adres.trim();
  if (temiz === "") return "";
  return /^https?:\/\//i.test(temiz) ? temiz : `https://${temiz}`;
};

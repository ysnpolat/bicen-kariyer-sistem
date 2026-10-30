/**
 * Galeri / kamera / dosya seçici (09.10.2026)
 * ---------------------------------------------------------------------------
 * Android'de expo-image-picker bazen "Attempting to launch an unregistered
 * ActivityResultLauncher" hatasıyla açılmıyor: uygulama arka plandayken ya da
 * kamera açıkken telefon (özellikle Xiaomi) uygulamanın ekranını kapatıp
 * yeniden kurmuşsa seçici eski ekrana bağlı kalıyor. Personel "Yüklenemedi"
 * diye Java hatası görüyordu.
 *
 * Burada:
 *  1. Kısa bir bekleyişle bir kez yeniden denenir (ekran geçişindeyse açılır).
 *  2. Galeri yine açılmazsa sistemin dosya seçicisi (expo-document-picker)
 *     resim + PDF ile açılır; o ayrı yoldan çalışır.
 *  3. Hiçbiri olmazsa anlaşılır bir mesaj: uygulamayı kapatıp açın.
 */
const modulAl = (m, islev) => (m?.[islev] ? m : m?.default?.[islev] ? m.default : null);

let ImagePicker = null;
let DocumentPicker = null;

try {
  ImagePicker = modulAl(require("expo-image-picker"), "launchImageLibraryAsync");
} catch {
  ImagePicker = null;
}

try {
  DocumentPicker = modulAl(require("expo-document-picker"), "getDocumentAsync");
} catch {
  DocumentPicker = null;
}

export const resimSeciciVar = () => !!ImagePicker;
export const dosyaSeciciVar = () => !!DocumentPicker;
export const resimSecici = () => ImagePicker;

/** Seçicinin ekrana bağlanamadığı Android hatası */
export const kayitHatasi = (h) =>
  /ActivityResultLauncher|unregistered|registered before calling launch/i.test(String(h?.message ?? h ?? ""));

export const YENIDEN_AC_MESAJI =
  "Telefon seçiciyi açamadı. Biçen360'ı tamamen kapatıp (son uygulamalardan kaydırarak) yeniden açın ve tekrar deneyin. " +
  "Olmazsa \"Dosya / PDF\" seçeneğiyle yükleyebilirsiniz.";

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Bir kez yeniden dener; ikinci hatayı fırlatır */
async function tekrarla(islem) {
  try {
    return await islem();
  } catch (h) {
    if (!kayitHatasi(h)) throw h;
    await bekle(600);
    return await islem();
  }
}

/** Sistem dosya seçicisi: resim ya da PDF. Seçilen varlık listesi ya da null. */
async function dosyaSeciciyleAl(turler, coklu) {
  if (!DocumentPicker) return null;

  const sonuc = await DocumentPicker.getDocumentAsync({
    type: turler,
    copyToCacheDirectory: true,
    multiple: !!coklu,
  });

  if (sonuc?.canceled) return { canceled: true, assets: [] };

  return {
    canceled: false,
    assets: (sonuc?.assets ?? []).map((a) => ({
      uri: a.uri,
      fileName: a.name,
      mimeType: a.mimeType,
    })),
  };
}

/**
 * Galeriden seç. expo-image-picker sonucu biçiminde döner
 * ({ canceled, assets: [{ uri, fileName, mimeType }] }).
 * @param pdfDahil yedek dosya seçicide PDF de seçilebilsin
 */
export async function galeridenSec(secenekler = {}, { pdfDahil = false } = {}) {
  if (!ImagePicker) throw new Error("Galeri bu sürümde yok; uygulamayı güncelleyin.");

  try {
    return await tekrarla(() => ImagePicker.launchImageLibraryAsync(secenekler));
  } catch (h) {
    if (!kayitHatasi(h)) throw h;

    try {
      const videoMu = (secenekler.mediaTypes ?? []).includes?.("videos");
      const yedek = await dosyaSeciciyleAl(
        videoMu ? ["video/*"] : pdfDahil ? ["image/*", "application/pdf"] : ["image/*"],
        secenekler.allowsMultipleSelection
      );
      if (yedek) return yedek;
    } catch (h2) {
      if (!kayitHatasi(h2)) throw h2;
    }

    throw new Error(YENIDEN_AC_MESAJI);
  }
}

/** Kamerayla çek */
export async function kameradanCek(secenekler = {}) {
  if (!ImagePicker) throw new Error("Kamera bu sürümde yok; uygulamayı güncelleyin.");

  try {
    return await tekrarla(() => ImagePicker.launchCameraAsync(secenekler));
  } catch (h) {
    if (kayitHatasi(h)) throw new Error(YENIDEN_AC_MESAJI.replace("seçiciyi", "kamerayı"));
    throw h;
  }
}

/** Dosya / PDF seçici */
export async function dosyaSec(secenekler) {
  if (!DocumentPicker) throw new Error("Dosya seçimi bu sürümde yok; uygulamayı güncelleyin.");

  try {
    return await tekrarla(() => DocumentPicker.getDocumentAsync(secenekler));
  } catch (h) {
    if (kayitHatasi(h)) throw new Error(YENIDEN_AC_MESAJI);
    throw h;
  }
}

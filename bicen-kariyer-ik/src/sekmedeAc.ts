import { API_TABAN, oturumOku } from "./api";

/**
 * Oturumla korunan bir adresi (form, belge) yeni sekmede açar. Sekme
 * tıklama anında açılıyor: istek bittikten sonra açılan pencereyi
 * tarayıcılar engelliyor.
 */
export const sekmedeAc = async (yol: string) => {
  const pencere = window.open("", "_blank");
  const oturum = oturumOku();

  try {
    const cevap = await fetch(`${API_TABAN}${yol}`, {
      headers: oturum ? { Authorization: `Bearer ${oturum.token}` } : {},
    });

    if (!cevap.ok) {
      const metin = await cevap.text();
      let hata = `Açılamadı (${cevap.status})`;
      try {
        hata = JSON.parse(metin)?.hata ?? hata;
      } catch {
        /* düz metin */
      }
      throw new Error(hata);
    }

    const adres = URL.createObjectURL(await cevap.blob());

    if (pencere) pencere.location.href = adres;
    else window.open(adres, "_blank");
  } catch (h: any) {
    pencere?.close();
    throw h;
  }
};


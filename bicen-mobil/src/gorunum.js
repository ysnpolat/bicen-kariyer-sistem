/**
 * Görünüm seçimi (patron / personel)
 * ---------------------------------------------------------------------------
 * Patron olarak tanımlanan kişi uygulamayı iki şekilde kullanabiliyor:
 * yönetim ekranı (patron görünümü) ya da herkesin gördüğü personel
 * uygulaması. Son seçim cihazda tutuluyor: her açılışta personel
 * ekranından patron ekranına geçmek zorunda kalmak, günde onlarca kez
 * açılan uygulamada can sıkıcı olurdu.
 *
 * Patron yetkisi de saklanıyor. Açılışta sunucuyu beklemeden doğru
 * ekranla başlamak için: yetki sorgusu her açılışta bir istek daha demek
 * ve personel ekranının bir an görünüp kaybolmasına yol açıyordu. Yetki
 * her açılışta arka planda yeniden doğrulanıyor (App.js), kaldırıldıysa
 * bir sonraki açılış personel ekranıyla başlıyor.
 *
 * SecureStore kullanılıyor: jeton da orada, yeni bir depolama paketi
 * eklemeye gerek yok.
 */

import * as SecureStore from "expo-secure-store";

const SECIM_ANAHTARI = "bicen_gorunum";
const YETKI_ANAHTARI = "bicen_patron";
/* Dış hukuk danışmanı oturumu (24.10.2026): uygulama yalnız hukuk masasıyla açılır */
const HUKUK_ANAHTARI = "bicen_hukuk";
let hukuk = undefined;

export const hukukMu = async () => {
  try {
    if (hukuk === undefined) hukuk = (await SecureStore.getItemAsync(HUKUK_ANAHTARI)) === "1";
  } catch {
    hukuk = false;
  }
  return !!hukuk;
};

export const hukukYaz = async (deger) => {
  hukuk = !!deger;
  try {
    if (deger) await SecureStore.setItemAsync(HUKUK_ANAHTARI, "1");
    else await SecureStore.deleteItemAsync(HUKUK_ANAHTARI);
  } catch {
    /* Saklanamazsa bu açılış boyunca geçerli */
  }
};

/* Bellekte de tutuluyor: Diğer ekranı ve App.js aynı açılışta birkaç kez
   soruyor, her seferinde şifreli alana gitmeye gerek yok. */
let secim = undefined;
let yetki = undefined;

/**
 * Saklanan görünüm.
 *
 * @returns {{ patron: boolean|null, secim: "patron"|"personel"|null }}
 *          patron: son bilinen yetki (hiç sorulmadıysa null)
 */
export const gorunumOku = async () => {
  try {
    if (secim === undefined) secim = (await SecureStore.getItemAsync(SECIM_ANAHTARI)) || null;
    if (yetki === undefined) {
      const y = await SecureStore.getItemAsync(YETKI_ANAHTARI);
      yetki = y === "1" ? true : y === "0" ? false : null;
    }
  } catch {
    /* Okunamazsa personel ekranıyla açılır; sunucu sorgusu düzeltir */
    secim = secim ?? null;
    yetki = yetki ?? null;
  }

  return { patron: yetki ?? null, secim: secim ?? null };
};

/** Açılış ekranı: patron yetkisi biliniyor ve personel seçilmemişse patron */
export const patronlaAcilsinMi = (g) => g?.patron === true && g?.secim !== "personel";

/** Kişinin son seçtiği görünüm */
export const gorunumYaz = async (deger) => {
  secim = deger;

  try {
    if (deger) await SecureStore.setItemAsync(SECIM_ANAHTARI, deger);
    else await SecureStore.deleteItemAsync(SECIM_ANAHTARI);
  } catch {
    /* Saklanamazsa seçim yalnızca bu açılış boyunca geçerli */
  }
};

/** Sunucudan gelen patron bayrağı */
export const patronYetkisiYaz = async (deger) => {
  const yeni = !!deger;
  if (yetki === yeni) return;

  yetki = yeni;

  try {
    await SecureStore.setItemAsync(YETKI_ANAHTARI, yeni ? "1" : "0");
  } catch {
    /* Saklanamazsa bir sonraki açılışta yeniden sorulur */
  }
};

/**
 * Çıkışta temizlenir: aynı telefonda başka biri oturum açarsa önceki
 * kişinin yetkisiyle patron ekranı açılmamalı.
 */
export const gorunumTemizle = async () => {
  secim = null;
  yetki = null;
  hukuk = false;

  try {
    await SecureStore.deleteItemAsync(SECIM_ANAHTARI);
    await SecureStore.deleteItemAsync(YETKI_ANAHTARI);
    await SecureStore.deleteItemAsync(HUKUK_ANAHTARI);
  } catch {
    /* Silinemezse sunucu sorgusu yetkiyi zaten yeniden yazıyor */
  }
};

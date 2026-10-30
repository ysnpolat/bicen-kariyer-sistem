/**
 * Ana sayfa kısayol tercihi (1.8)
 * ---------------------------------------------------------------------------
 * Kişinin seçtiği kısayollar ve sırası cihazda saklanır (SecureStore; jeton
 * da orada, yeni paket gerekmiyor). Hiç düzenlenmediyse null döner ve ana
 * sayfa varsayılan sırayı kullanır; yeni açılan modül de kendiliğinden
 * kısayola girer.
 */

import * as SecureStore from "expo-secure-store";

const anahtar = (sicil) => `bicen_kisayol_${String(sicil ?? "").replace(/[^0-9A-Za-z]/g, "") || "kisi"}`;

export const kisayolOku = async (sicil) => {
  try {
    const d = await SecureStore.getItemAsync(anahtar(sicil));
    const l = d ? JSON.parse(d) : null;
    return Array.isArray(l) ? l.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
};

export const kisayolYaz = async (sicil, liste) => {
  try {
    if (liste == null) await SecureStore.deleteItemAsync(anahtar(sicil));
    else await SecureStore.setItemAsync(anahtar(sicil), JSON.stringify(liste));
  } catch {
    /* saklanamazsa bu açılışta geçerli kalır */
  }
};

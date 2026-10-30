/**
 * Klavye durumu (20.10.2026)
 * ---------------------------------------------------------------------------
 * Ekranın altına sabitlenen düğmeler klavye açılınca altında kalıyordu.
 * iOS'ta klavye ekranın üstüne biniyor (yüksekliği kadar yukarı almak
 * gerekiyor); Android'de pencere klavye kadar kısalıyor (adjustResize),
 * düğmenin alttan küçük bir boşlukla durması yetiyor.
 */

import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKlavye() {
  const [durum, setDurum] = useState({ acik: false, yukseklik: 0 });

  useEffect(() => {
    const ac = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const kapa = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const a = Keyboard.addListener(ac, (e) => setDurum({ acik: true, yukseklik: e?.endCoordinates?.height ?? 0 }));
    const k = Keyboard.addListener(kapa, () => setDurum({ acik: false, yukseklik: 0 }));
    return () => {
      a.remove();
      k.remove();
    };
  }, []);

  return durum;
}

/** Alta sabit düğme çubuğunun alttan uzaklığı: klavye kapalıyken yüzen menünün üstü */
export const altBosluk = (klavye, menuUstu = 88) =>
  !klavye.acik ? menuUstu : Platform.OS === "ios" ? klavye.yukseklik + 8 : 8;

/**
 * Klavye açıkken ekranın kullanılabilir alanı: iOS'ta klavye yüksekliği
 * kadar alttan boşluk (Android'de pencere zaten kısalıyor).
 */
export const klavyePayi = (klavye) => (klavye.acik && Platform.OS === "ios" ? klavye.yukseklik : 0);

/**
 * AltSayfa
 * ---------------------------------------------------------------------------
 * Alttan açılan pencere (reddetme sebebi, not yazma gibi). Klavyeyle
 * birlikte doğru çalışır:
 *
 *   - Klavye açılınca pencere klavyenin üstüne kalkar; düğmeler klavyenin
 *     altında kalmaz. İçerik sığmazsa kaydırılır.
 *   - Pencerenin boş bir yerine dokunmak klavyeyi kapatır.
 *   - Klavye açıkken karartılmış alana dokunmak önce klavyeyi kapatır,
 *     pencereyi kapatmaz (yazılan sebep kaybolmasın).
 *
 * Önceden pencere Modal + TouchableOpacity ile kuruluydu; klavye açılınca
 * altta kalıyor, personel "Reddet" düğmesine ulaşamıyor ve klavyeyi
 * kapatmanın bir yolu bulunmuyordu.
 *
 * KULLANIM
 *   <AltSayfa gorunur={!!karar} kapat={() => setKarar(null)}
 *             perdeStil={s.perde} sayfaStil={s.sayfa}>
 *     ...
 *   </AltSayfa>
 *
 * Metin kutularında returnKeyType="done" ve submitBehavior="blurAndSubmit"
 * verildiğinde klavyedeki "Bitti" tuşu da klavyeyi kapatır.
 */

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Pressable,
  ScrollView,
  Keyboard,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function AltSayfa({ gorunur, kapat, perdeStil, sayfaStil, children }) {
  const { height: ekranYuksekligi } = useWindowDimensions();
  const ic = useSafeAreaInsets();

  /* Klavyenin pencereyle çakışan yüksekliği. Ölçülerek bulunuyor:
     Android'de pencere bazen klavyeye göre zaten küçülüyor, bazen
     küçülmüyor (kenardan kenara ekran). Klavye yüksekliğini körü körüne
     eklemek küçülen pencerede boşluğu iki katına çıkarırdı. */
  const [alt, setAlt] = useState(0);
  const [perdeYuksekligi, setPerdeYuksekligi] = useState(0);
  const klavyeUst = useRef(null);
  const perde = useRef(null);

  const olc = () => {
    if (klavyeUst.current == null || !perde.current) {
      setAlt(0);
      return;
    }

    perde.current.measureInWindow((_x, y, _g, h) => {
      const cakisma = Math.max(0, y + h - klavyeUst.current);
      setAlt(cakisma);
    });
  };

  useEffect(() => {
    if (!gorunur) return undefined;

    const acilis = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const kapanis = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const a = Keyboard.addListener(acilis, (e) => {
      klavyeUst.current = e?.endCoordinates?.screenY ?? null;
      olc();
    });

    const k = Keyboard.addListener(kapanis, () => {
      klavyeUst.current = null;
      setAlt(0);
    });

    return () => {
      a.remove();
      k.remove();
      klavyeUst.current = null;
      setAlt(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gorunur]);

  const perdeyeDokun = () => {
    /* Klavye açıkken dışarı dokunmak yalnızca klavyeyi kapatır */
    if (alt > 0 || Keyboard.isVisible?.()) {
      Keyboard.dismiss();
      return;
    }
    kapat?.();
  };

  /* Pencere ekrana sığsın: üstte durum çubuğu kadar pay bırakılır */
  const kullanilabilir = (perdeYuksekligi || ekranYuksekligi) - alt - Math.max(ic.top, 20) - 12;

  return (
    /* Android'de pencere tam ekran (durum ve gezinme çubuğunun altı
       dahil) açılır: klavye ölçümü ekran koordinatlarıyla birebir tutsun.
       Gezinme çubuğu payı aşağıda pencerenin içine eklenir. */
    <Modal
      visible={!!gorunur}
      transparent
      animationType="slide"
      onRequestClose={kapat}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View
        ref={perde}
        style={[{ flex: 1 }, perdeStil, { paddingBottom: alt }]}
        onLayout={(e) => {
          setPerdeYuksekligi(e.nativeEvent.layout.height);
          /* Pencere klavyeye göre küçüldüyse çakışma yeniden ölçülür */
          if (klavyeUst.current != null) olc();
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={perdeyeDokun} />

        <View style={[sayfaStil, { maxHeight: Math.max(220, kullanilabilir) }]}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={Keyboard.dismiss} accessible={false}>
              {children}
            </Pressable>
          </ScrollView>

          {/* Klavye kapalıyken gezinme çubuğu / ana ekran çizgisi payı */}
          <View style={{ height: alt > 0 ? 0 : ic.bottom }} />
        </View>
      </View>
    </Modal>
  );
}

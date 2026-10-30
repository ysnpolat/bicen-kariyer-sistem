/**
 * ModalAlani
 * ---------------------------------------------------------------------------
 * Tam ekran pencerelerin (Modal) güvenli alanı.
 *
 * Sorun: Modal, Android'de ayrı bir pencere. Uygulamanın kökündeki
 * SafeAreaProvider bu pencereyi ölçmüyor; pencere içindeki SafeAreaView
 * bazı telefonlarda üst boşluğu 0 alıyordu. Pencere durum çubuğunun altına
 * çizildiği için "Kapat" / "✕" düğmeleri saatin ve pil simgesinin altında
 * kalıyor, dokunulamıyordu. Videoyu tam ekrana alıp çıkınca yerleşim
 * yeniden hesaplandığı için düğme düzeliyordu.
 *
 * Çözüm:
 *   - Pencerenin içine ayrı bir SafeAreaProvider konuyor; boşluk pencerenin
 *     kendisinden ölçülüyor.
 *   - Android'de ölçüm yine 0 gelirse durum çubuğu yüksekliği ve uygulama
 *     açılışındaki alt boşluk kullanılıyor.
 *   - Pencereler Android'de her telefonda aynı davransın diye durum ve
 *     gezinme çubuğunun altına çiziliyor (modalTamEkran); boşluk buradan
 *     veriliyor.
 *
 * KULLANIM
 *   <Modal visible {...modalTamEkran} ...>
 *     <ModalAlani style={s.sayfa} edges={["top", "bottom"]}>
 *       ...
 *     </ModalAlani>
 *   </Modal>
 *
 * Kendi yerleşimini kuran pencerelerde (görsel gösterici gibi):
 *   <SafeAreaProvider> ... useModalBosluk() ... </SafeAreaProvider>
 */

import { View, Platform, StatusBar, StyleSheet } from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowMetrics,
} from "react-native-safe-area-context";

/** Android'de pencereyi durum ve gezinme çubuğunun altına çizer (iOS'ta etkisiz). */
export const modalTamEkran = {
  statusBarTranslucent: true,
  navigationBarTranslucent: true,
};

/** SafeAreaProvider içinde kullanılır: pencerenin dört kenar boşluğu. */
export function useModalBosluk() {
  const ic = useSafeAreaInsets();

  if (Platform.OS !== "android") return ic;

  const ilk = initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };

  return {
    top: Math.max(ic.top, StatusBar.currentHeight ?? 0, ilk.top ?? 0),
    bottom: Math.max(ic.bottom, ilk.bottom ?? 0),
    left: ic.left,
    right: ic.right,
  };
}

function Ic({ style, edges, children }) {
  const b = useModalBosluk();
  const k = new Set(edges ?? ["top", "bottom"]);

  /* SafeAreaView gibi: stildeki iç boşluğun üzerine eklenir */
  const d = StyleSheet.flatten(style) ?? {};
  const ic = (kenar, eksen) => d[kenar] ?? d[eksen] ?? d.padding ?? 0;

  return (
    <View
      style={[
        { flex: 1 },
        style,
        {
          paddingTop: ic("paddingTop", "paddingVertical") + (k.has("top") ? b.top : 0),
          paddingBottom: ic("paddingBottom", "paddingVertical") + (k.has("bottom") ? b.bottom : 0),
          paddingLeft: ic("paddingLeft", "paddingHorizontal") + b.left,
          paddingRight: ic("paddingRight", "paddingHorizontal") + b.right,
        },
      ]}
    >
      {children}
    </View>
  );
}

export default function ModalAlani({ style, edges, children }) {
  return (
    <SafeAreaProvider>
      <Ic style={style} edges={edges}>
        {children}
      </Ic>
    </SafeAreaProvider>
  );
}

/**
 * Yeşil alan deseni
 * ---------------------------------------------------------------------------
 * Koyu yeşil başlıklar düz bir renk bloğu olarak duruyordu. Bu katman
 * üstlerine çok soluk daireler koyuyor: alan tek renk kalmıyor ama
 * üzerindeki yazının okunurluğunu düşürmüyor.
 *
 * Konumlandırma `position: absolute`; desen düzeni etkilemiyor, yalnızca
 * zemine ekleniyor.
 */

import { View, StyleSheet } from "react-native";
import Svg, { Circle, Defs, ClipPath, Rect, G } from "react-native-svg";

export default function Desen({ renkli = "#ffffff", yogunluk = 0.07 }) {
  return (
    <View style={s.katman} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 390 220">
        <Defs>
          <ClipPath id="alan">
            <Rect x="0" y="0" width="390" height="220" />
          </ClipPath>
        </Defs>

        <G clipPath="url(#alan)">
          {/* Sağ üstte büyük daire: köşeyi yumuşatıyor */}
          <Circle cx={352} cy={-18} r={112} fill={renkli} opacity={yogunluk} />

          {/* İçe geçen ikinci daire, derinlik veriyor */}
          <Circle
            cx={352}
            cy={-18}
            r={74}
            fill="none"
            stroke={renkli}
            strokeWidth={1.4}
            opacity={yogunluk * 1.6}
          />

          {/* Sol altta küçük daire: desen tek köşede kalmasın */}
          <Circle cx={-24} cy={196} r={86} fill={renkli} opacity={yogunluk * 0.8} />

          <Circle
            cx={128}
            cy={232}
            r={54}
            fill="none"
            stroke={renkli}
            strokeWidth={1.2}
            opacity={yogunluk * 1.3}
          />
        </G>
      </Svg>
    </View>
  );
}

const s = StyleSheet.create({
  katman: { ...StyleSheet.absoluteFillObject },
});

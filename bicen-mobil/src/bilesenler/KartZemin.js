/**
 * Kart zemini
 * ---------------------------------------------------------------------------
 * Eğimli renk geçişi, yumuşak kavisler ve sol üstten inen bir ışık. Biçen
 * kartının yüzünde kullanılıyor; ana sayfadaki yeşil tepe ile bakiye şeridi
 * de aynı deseni taşıyor ki üç alan aynı aileden görünsün.
 *
 * <p>
 * Ölçü yerleşimden alınıyor: eğriler alanın gerçek en-boyuna göre
 * hesaplanmazsa geniş ekranda eziliyor, dar ekranda kayboluyordu. Ölçü
 * gelene kadar düz renk duruyor — bir kare boyunca görünen boşluk,
 * yanlış ölçekli bir desenden iyi.
 * </p>
 */

import { useId, useState } from "react";
import { View, StyleSheet } from "react-native";

import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle } from "react-native-svg";

/**
 * @param renkler  Üçlü renk geçişi: [açık, orta, koyu]
 * @param yuvarlak Köşe yarıçapı; alttan yuvarlak tepe için 0 verilebilir
 * @param stil     Dış görünümün ek biçimi (boşluk, gölge, yön)
 */
export default function KartZemin({
  renkler = ["#ff8a3a", "#f15a22", "#bf3a0d"],
  yuvarlak = 22,
  stil,
  children,
  ...kalan
}) {
  const [olcu, setOlcu] = useState({ en: 0, boy: 0 });

  /* Tanımlayıcılar benzersiz: aynı ekranda iki zemin olduğunda ikisi de
     aynı "zemin" kimliğini kullanıyor ve ikincisi birincinin rengini
     alıyordu. */
  const kimlik = useId().replace(/[^a-zA-Z0-9]/g, "");

  const zeminId = `z${kimlik}`;
  const parlakId = `p${kimlik}`;

  const { en, boy } = olcu;

  return (
    <View
      style={[{ overflow: "hidden", backgroundColor: renkler[1] }, stil]}
      onLayout={(e) =>
        setOlcu({
          en: e.nativeEvent.layout.width,
          boy: e.nativeEvent.layout.height,
        })
      }
      {...kalan}
    >
      {en > 0 && boy > 0 ? (
        <Svg
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          width={en}
          height={boy}
          viewBox={`0 0 ${en} ${boy}`}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id={zeminId} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={renkler[0]} />
              <Stop offset="0.45" stopColor={renkler[1]} />
              <Stop offset="1" stopColor={renkler[2]} />
            </LinearGradient>

            <LinearGradient id={parlakId} x1="0" y1="0" x2="0.7" y2="1">
              <Stop offset="0" stopColor="#ffffff" stopOpacity="0.26" />
              <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </LinearGradient>
          </Defs>

          <Rect
            x="0"
            y="0"
            width={en}
            height={boy}
            rx={yuvarlak}
            fill={`url(#${zeminId})`}
          />

          {/* Kavisler: tek renk yüzey bastırılmış bir dikdörtgen gibi
              duruyordu, kartlarda hep bir doku oluyor. */}
          <Path
            d={`M ${-en * 0.1} ${boy * 0.66} C ${en * 0.28} ${boy * 0.34}, ${
              en * 0.6
            } ${boy * 1.02}, ${en * 1.1} ${boy * 0.42}`}
            stroke="#ffffff"
            strokeOpacity="0.1"
            strokeWidth={boy * 0.14}
            fill="none"
          />

          <Path
            d={`M ${-en * 0.1} ${boy * 0.88} C ${en * 0.3} ${boy * 0.56}, ${
              en * 0.62
            } ${boy * 1.2}, ${en * 1.1} ${boy * 0.62}`}
            stroke="#ffffff"
            strokeOpacity="0.07"
            strokeWidth={boy * 0.1}
            fill="none"
          />

          <Circle
            cx={en * 0.96}
            cy={-boy * 0.08}
            r={boy * 0.42}
            fill="#ffffff"
            fillOpacity="0.07"
          />

          <Path
            d={`M 0 0 L ${en * 0.62} 0 L 0 ${boy * 0.8} Z`}
            fill={`url(#${parlakId})`}
          />
        </Svg>
      ) : null}

      {children}
    </View>
  );
}

/** Kart yüzü ve bakiye şeridi turuncu, ana sayfanın tepesi yeşil. */
export const TURUNCU = ["#ff8a3a", "#f15a22", "#bf3a0d"];
export const YESIL = ["#93cc31", "#6fa514", "#456d09"];

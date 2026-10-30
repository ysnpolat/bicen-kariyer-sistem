/**
 * Doğum günü kutlaması
 * ---------------------------------------------------------------------------
 * Personel doğum gününde uygulamayı açtığında çıkan kutlama penceresi.
 *
 * Balonlar yukarı doğru süzülüyor. Süsün kendisi işin bir parçası: sade bir
 * "doğum gününüz kutlu olsun" satırı, kurumun tebriğinden çok bir sistem
 * bildirimi gibi duruyordu.
 *
 * Aynı gün bir kez gösteriliyor ve bu bilgi cihazda tutuluyor; sunucuda
 * "gösterildi" işaretlemek, uygulamayı kapatıp açan personelin kutlamayı
 * hiç görmemesine yol açabilirdi.
 */

import { useEffect, useRef } from "react";
import {
  View,
  Text,
  Modal,
  Animated,
  Easing,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";

import { renk } from "../tema";

const { width: EKRAN } = Dimensions.get("window");

const BALON_RENKLERI = [
  "#7cb518",
  "#e8481c",
  "#1a4d80",
  "#f2a03d",
  "#722ed1",
  "#eb2f96",
];

/** Tek bir balon; kendi hızında ve kendi yolunda yükseliyor. */
function Balon({ sira }) {
  const ilerleme = useRef(new Animated.Value(0)).current;

  /* Her balonun konumu ve hızı sabit: her çizimde yeniden rastgele
     hesaplansa balonlar animasyon sırasında zıplıyordu. */
  const ayar = useRef({
    x: 10 + ((sira * 37) % (EKRAN - 60)),
    boyut: 26 + ((sira * 13) % 22),
    sure: 4200 + ((sira * 431) % 2600),
    gecikme: (sira * 260) % 1800,
    renk: BALON_RENKLERI[sira % BALON_RENKLERI.length],
    kayma: ((sira % 2 === 0 ? 1 : -1) * (12 + (sira * 7) % 20)),
  }).current;

  useEffect(() => {
    const hareket = Animated.loop(
      Animated.timing(ilerleme, {
        toValue: 1,
        duration: ayar.sure,
        delay: ayar.gecikme,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    hareket.start();

    return () => hareket.stop();
  }, [ilerleme, ayar]);

  const yukselme = ilerleme.interpolate({
    inputRange: [0, 1],
    outputRange: [140, -520],
  });

  const yanaKayma = ilerleme.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, ayar.kayma, 0],
  });

  /* Sonuna doğru sönümleniyor; ekranın üstünde aniden kaybolmak yerine */
  const saydamlik = ilerleme.interpolate({
    inputRange: [0, 0.1, 0.8, 1],
    outputRange: [0, 0.9, 0.9, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: ayar.x,
        bottom: 0,
        opacity: saydamlik,
        transform: [{ translateY: yukselme }, { translateX: yanaKayma }],
      }}
    >
      {/* Gövde: alta doğru hafif daralan oval. Tam daire balondan çok
          topa benziyordu. */}
      <View
        style={{
          width: ayar.boyut,
          height: ayar.boyut * 1.25,
          borderBottomLeftRadius: ayar.boyut * 0.45,
          borderBottomRightRadius: ayar.boyut * 0.45,
          borderTopLeftRadius: ayar.boyut * 0.5,
          borderTopRightRadius: ayar.boyut * 0.5,
          backgroundColor: ayar.renk,
          overflow: "hidden",
        }}
      >
        {/* Sol üstte ışık yansıması; hacim hissini bu veriyor */}
        <View
          style={{
            position: "absolute",
            top: ayar.boyut * 0.16,
            left: ayar.boyut * 0.18,
            width: ayar.boyut * 0.22,
            height: ayar.boyut * 0.32,
            borderRadius: ayar.boyut * 0.16,
            backgroundColor: "rgba(255,255,255,.45)",
            transform: [{ rotate: "-18deg" }],
          }}
        />
      </View>

      {/* Ağız düğümü */}
      <View
        style={{
          width: 0,
          height: 0,
          alignSelf: "center",
          borderLeftWidth: 3.5,
          borderRightWidth: 3.5,
          borderTopWidth: 5,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: ayar.renk,
        }}
      />

      {/* İp */}
      <View
        style={{
          width: 1.2,
          height: ayar.boyut * 0.9,
          backgroundColor: "rgba(255,255,255,.45)",
          alignSelf: "center",
        }}
      />
    </Animated.View>
  );
}

/**
 * Tek bir konfeti parçası.
 *
 * Yukarı fırlayıp yere süzülüyor ve dönüyor. Balonlarla aynı anda
 * başlarsa ekran karışıyor; konfeti kısa sürüyor, balonlar devam ediyor.
 */
function Konfeti({ sira }) {
  const ilerleme = useRef(new Animated.Value(0)).current;

  const ayar = useRef({
    x: (sira * 53) % EKRAN,
    boyut: 6 + ((sira * 11) % 7),
    sure: 1800 + ((sira * 317) % 1400),
    gecikme: (sira * 47) % 500,
    renk: BALON_RENKLERI[(sira + 2) % BALON_RENKLERI.length],
    donus: ((sira % 2 === 0 ? 1 : -1) * (360 + (sira * 37) % 540)),
    kayma: ((sira % 3) - 1) * (30 + (sira * 13) % 60),
    yukselis: 120 + ((sira * 29) % 220),
  }).current;

  useEffect(() => {
    Animated.timing(ilerleme, {
      toValue: 1,
      duration: ayar.sure,
      delay: ayar.gecikme,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [ilerleme, ayar]);

  /* Önce yukarı, sonra aşağı: patlama hissi tek yönlü düşüşte oluşmuyor */
  const dikey = ilerleme.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, -ayar.yukselis, 620],
  });

  const yatay = ilerleme.interpolate({
    inputRange: [0, 1],
    outputRange: [0, ayar.kayma],
  });

  const donus = ilerleme.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", `${ayar.donus}deg`],
  });

  const saydamlik = ilerleme.interpolate({
    inputRange: [0, 0.75, 1],
    outputRange: [1, 1, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: ayar.x,
        top: "38%",
        opacity: saydamlik,
        transform: [
          { translateY: dikey },
          { translateX: yatay },
          { rotate: donus },
        ],
      }}
    >
      <View
        style={{
          width: ayar.boyut,
          height: ayar.boyut * 1.8,
          backgroundColor: ayar.renk,
          borderRadius: 1.5,
        }}
      />
    </Animated.View>
  );
}

export default function DogumGunu({ veri, kapat }) {
  const olcek = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (!veri) return;

    Animated.spring(olcek, {
      toValue: 1,
      friction: 5,
      tension: 80,
      useNativeDriver: true,
    }).start();
  }, [veri, olcek]);

  if (!veri) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={kapat}>
      <View style={s.perde}>
        {Array.from({ length: 14 }).map((_, i) => (
          <Balon key={`b${i}`} sira={i} />
        ))}

        {Array.from({ length: 40 }).map((_, i) => (
          <Konfeti key={`k${i}`} sira={i} />
        ))}

        <Animated.View style={[s.kutu, { transform: [{ scale: olcek }] }]}>
          <Text style={s.pasta}>🎂</Text>

          <Text style={s.baslik}>{veri.baslik}</Text>

          <Text style={s.metin}>{veri.metin}</Text>

          <Text style={s.imza}>Biçen Market ailesi</Text>

          <TouchableOpacity style={s.dugme} activeOpacity={0.8} onPress={kapat}>
            <Text style={s.dugmeYazi}>Teşekkürler</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: {
    flex: 1,
    backgroundColor: "rgba(18, 24, 16, 0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 26,
    overflow: "hidden",
  },

  kutu: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: renk.beyaz,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",

    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },

  pasta: { fontSize: 54, marginBottom: 6 },

  baslik: {
    fontSize: 21,
    fontWeight: "800",
    color: renk.yesilKoyu,
    textAlign: "center",
    lineHeight: 28,
  },

  metin: {
    fontSize: 14.5,
    color: renk.metin,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 10,
  },

  imza: {
    fontSize: 12.5,
    color: renk.pasif,
    marginTop: 14,
    fontStyle: "italic",
  },

  dugme: {
    marginTop: 20,
    alignSelf: "stretch",
    backgroundColor: renk.yesil,
    paddingVertical: 13,
    borderRadius: 13,
    alignItems: "center",
  },

  dugmeYazi: { fontSize: 15.5, fontWeight: "700", color: renk.beyaz },
});

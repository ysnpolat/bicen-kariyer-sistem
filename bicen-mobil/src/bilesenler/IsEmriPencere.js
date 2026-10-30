/**
 * İş Emri Penceresi
 * ---------------------------------------------------------------------------
 * Uygulama açılışında, görülmemiş iş emri varsa ekranın ortasında belirir.
 *
 * Kapatıldığında kaybolup gitmiyor: kart küçülerek alt menüdeki Diğer
 * sekmesine doğru uçuyor. Amaç personelin "işim nereye gitti" diye
 * aramaması — gözü kartı takip edince işlerin orada olduğunu öğreniyor.
 */

import { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  ScrollView,
} from "react-native";

import { renk } from "../tema";
import Simge from "../bilesenler/Simge";

const { width: EN, height: BOY } = Dimensions.get("window");

/* Diğer sekmesi alt menüde beşinci ve son sırada; kartın uçacağı nokta
   ekranın sağ altı. Sekme genişliği menü genişliğinin beşte biri. */
const HEDEF_X = EN * 0.32;
const HEDEF_Y = BOY * 0.38;

export default function IsEmriPencere({ acik, isler, onKapat, onAc }) {
  const olcek = useRef(new Animated.Value(0.9)).current;
  const saydam = useRef(new Animated.Value(0)).current;
  const tasima = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  /* Açılışta yumuşak giriş */
  useEffect(() => {
    if (!acik) return;

    olcek.setValue(0.9);
    saydam.setValue(0);
    tasima.setValue({ x: 0, y: 0 });

    Animated.parallel([
      Animated.spring(olcek, {
        toValue: 1,
        useNativeDriver: true,
        friction: 7,
        tension: 60,
      }),
      Animated.timing(saydam, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [acik, olcek, saydam, tasima]);

  /** Kartı Diğer sekmesine doğru uçurup pencereyi kapatır */
  const ucur = (sonra) => {
    Animated.parallel([
      Animated.timing(tasima, {
        toValue: { x: HEDEF_X, y: HEDEF_Y },
        duration: 520,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(olcek, {
        toValue: 0.12,
        duration: 520,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }),
      Animated.timing(saydam, {
        toValue: 0,
        duration: 480,
        delay: 40,
        useNativeDriver: true,
      }),
    ]).start(() => sonra?.());
  };

  const adet = isler?.length ?? 0;

  return (
    <Modal visible={acik} transparent animationType="none" onRequestClose={() => ucur(onKapat)}>
      <Animated.View style={[s.perde, { opacity: saydam }]}>
        <Animated.View
          style={[
            s.kart,
            {
              opacity: saydam,
              transform: [
                { translateX: tasima.x },
                { translateY: tasima.y },
                { scale: olcek },
              ],
            },
          ]}
        >
          <View style={s.simgeKutu}>
            <Simge ad="liste" renkli={renk.yesilKoyu} boyut={26} />
          </View>

          <Text style={s.baslik}>
            {adet === 1 ? "Yeni bir işiniz var" : `${adet} yeni işiniz var`}
          </Text>

          <Text style={s.altYazi}>
            Size atanan işleri Diğer menüsündeki İşlerim bölümünde
            bulabilirsiniz.
          </Text>

          <ScrollView style={s.liste} showsVerticalScrollIndicator={false}>
            {(isler ?? []).slice(0, 4).map((x) => (
              <View key={x.id} style={s.satir}>
                <View style={s.nokta} />

                <View style={{ flex: 1 }}>
                  <Text style={s.isBaslik} numberOfLines={2}>
                    {x.baslik}
                  </Text>
                  <Text style={s.atayan}>{x.atayanAd}</Text>
                </View>

                {x.oncelik === "Acil" ? (
                  <Text style={s.acil}>Acil</Text>
                ) : null}
              </View>
            ))}

            {adet > 4 ? (
              <Text style={s.dahaFazla}>ve {adet - 4} iş daha</Text>
            ) : null}
          </ScrollView>

          <TouchableOpacity
            style={s.birincil}
            activeOpacity={0.85}
            onPress={() => ucur(onAc)}
          >
            <Text style={s.birincilYazi}>İşlerimi aç</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.ikincil}
            activeOpacity={0.7}
            onPress={() => ucur(onKapat)}
          >
            <Text style={s.ikincilYazi}>Daha sonra</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  perde: {
    flex: 1,
    backgroundColor: "rgba(20, 26, 22, 0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 26,
  },

  kart: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 22,
  },

  simgeKutu: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: renk.yesilAcik,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },

  baslik: {
    fontSize: 20,
    fontWeight: "800",
    color: renk.metin,
    letterSpacing: -0.3,
  },

  altYazi: {
    fontSize: 13,
    color: renk.pasif,
    lineHeight: 19,
    marginTop: 6,
  },

  liste: { maxHeight: 190, marginTop: 14 },

  satir: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: renk.cizgi,
  },

  nokta: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: renk.yesil,
  },

  isBaslik: { fontSize: 14, fontWeight: "600", color: renk.metin },
  atayan: { fontSize: 11.5, color: renk.pasif, marginTop: 2 },

  acil: { fontSize: 11, fontWeight: "800", color: renk.turuncu },

  dahaFazla: {
    fontSize: 12,
    color: renk.pasif,
    textAlign: "center",
    paddingVertical: 10,
  },

  birincil: {
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 13,
    backgroundColor: renk.yesil,
    alignItems: "center",
  },

  birincilYazi: { fontSize: 14.5, fontWeight: "700", color: "#fff" },

  ikincil: { marginTop: 8, paddingVertical: 11, alignItems: "center" },
  ikincilYazi: { fontSize: 13.5, fontWeight: "600", color: renk.pasif },
});

/**
 * Sayfa yardım düğmesi
 * ---------------------------------------------------------------------------
 * Başlığın köşesinde duran küçük, hareketli Biçen çiçeği. Dokununca o
 * sayfanın nasıl kullanıldığını anlatan video açılıyor.
 *
 * Videolar sunucuda (İK paneli › Eğitim Dokümanları › Uygulama yardım
 * videoları). Hangi sayfanın videosu olduğu uygulama açılışında bir kez
 * soruluyor; videosu olmayan sayfada düğme hiç görünmüyor.
 *
 * Hareket "selam": çiçek çoğu zaman duruyor, birkaç saniyede bir kısaca
 * sallanıp merkezi büyüyor. Sürekli dönen bir simge içerik okunurken göz
 * yoruyordu. Telefonda "hareketi azalt" açıksa çiçek hiç kıpırdamıyor.
 *
 * Oynatıcı expo-video. Uygulamanın eski bir derlemesinde modül yoksa
 * video telefonun kendi oynatıcısında (tarayıcıda) açılıyor.
 */

import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  Modal,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ModalAlani, { modalTamEkran } from "./ModalAlani";
import Svg, { Circle } from "react-native-svg";

import { yardimVideolariAl, yardimVideoAdresi } from "../api";

let Video = null;
try {
  // eslint-disable-next-line global-require
  Video = require("expo-video");
  if (!Video?.VideoView || !Video?.useVideoPlayer) Video = null;
} catch {
  Video = null;
}

/* ------------------------------------------------------------ liste */

let videolar = null; // { kod: sürüm }
let yukleniyor = null;
let sonHata = 0;
const dinleyiciler = new Set();

const listeyiGetir = () => {
  if (videolar || yukleniyor) return;
  /* Hata sonrası kısa bir süre beklenir: her ekran geçişinde yeniden
     sormasın, ama sunucu yeni yayınlandıysa uygulamayı kapatıp açmadan
     çiçekler gelsin. */
  if (Date.now() - sonHata < 15000) return;

  yukleniyor = yardimVideolariAl()
    .then((c) => {
      videolar = c?.videolar ?? {};
    })
    .catch(() => {
      sonHata = Date.now();
    })
    .finally(() => {
      yukleniyor = null;
      dinleyiciler.forEach((f) => f());
    });
};

/**
 * Liste sunucudan taze alınıyor (düğmeye dokunulunca). Uygulama açıkken
 * sunucuda video değişirse eski sürüm numarasıyla eski video
 * gösteriliyordu; oynatıcı adresi önbellekten açıyordu.
 */
const listeyiTazele = () =>
  Promise.race([
    yardimVideolariAl().then((c) => {
      videolar = c?.videolar ?? videolar ?? {};
      dinleyiciler.forEach((f) => f());
    }),
    new Promise((z) => setTimeout(z, 2500)),
  ]).catch(() => {});

/** Oturum değişince (çıkış-giriş) liste yeniden sorulsun */
export const yardimListesiniSifirla = () => {
  videolar = null;
};

const useVideolar = () => {
  const [, yenile] = useState(0);

  useEffect(() => {
    const f = () => yenile((x) => x + 1);
    dinleyiciler.add(f);
    listeyiGetir();
    return () => dinleyiciler.delete(f);
  }, []);

  return videolar;
};

/* ------------------------------------------------------------ çiçek */

const TURUNCU = "#ef633f";
const YESIL = "#82c458";

/** Biçen çiçeği; merkez ayrı katmanda, çünkü ayrı hareket ediyor */
function Cicek({ boyut, t }) {
  const don = t
    ? t.interpolate({
        inputRange: [0, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 1],
        outputRange: ["0deg", "0deg", "-14deg", "12deg", "-8deg", "5deg", "0deg", "0deg"],
      })
    : "0deg";
  const olcek = t
    ? t.interpolate({
        inputRange: [0, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92, 1],
        outputRange: [1, 1, 1.08, 1.08, 1.04, 1.02, 1, 1],
      })
    : 1;
  const merkez = t
    ? t.interpolate({ inputRange: [0, 0.64, 0.72, 0.84, 1], outputRange: [1, 1, 1.25, 0.92, 1] })
    : 1;

  const m = boyut * 0.25; // merkez çapı

  return (
    <Animated.View style={{ width: boyut, height: boyut, transform: [{ rotate: don }, { scale: olcek }] }}>
      <Svg width={boyut} height={boyut} viewBox="0 0 100 100">
        <Circle cx="46.5" cy="21" r="22" fill={TURUNCU} />
        <Circle cx="77.5" cy="37" r="22" fill={TURUNCU} />
        <Circle cx="71" cy="72" r="22" fill={TURUNCU} />
        <Circle cx="35" cy="77.5" r="22" fill={TURUNCU} />
        <Circle cx="21.5" cy="45" r="22" fill={TURUNCU} />
        <Circle cx="50" cy="50" r="30" fill={TURUNCU} />
        <Circle cx="50" cy="50" r="20" fill="#fff" />
      </Svg>
      <Animated.View
        style={{
          position: "absolute",
          left: (boyut - m) / 2,
          top: (boyut - m) / 2,
          width: m,
          height: m,
          borderRadius: m / 2,
          backgroundColor: YESIL,
          transform: [{ scale: merkez }],
        }}
      />
    </Animated.View>
  );
}

/* ---------------------------------------------------------- oynatıcı */

function Oynatici({ adres }) {
  const oynatici = Video.useVideoPlayer({ uri: adres }, (o) => {
    o.play();
  });

  return (
    <Video.VideoView
      player={oynatici}
      style={s.video}
      contentFit="contain"
      nativeControls
      allowsFullscreen
    />
  );
}

/* ------------------------------------------------------------ düğme */

/**
 * @param kod    Sayfanın video kodu (rota adı; yönetici ekranında
 *               "VardiyaPlani.yonetici" gibi)
 * @param ad     Oynatıcı başlığında görünen sayfa adı
 * @param boyut  Çiçeğin çapı
 * @param kutu   Koyu/renkli zeminde beyaz kutu içinde çizilsin (ana sayfa).
 *               Kutu düğmenin parçası: video yoksa kutu da görünmüyor.
 */
export default function YardimDugmesi({ kod, ad, boyut = 26, kutu = false }) {
  const liste = useVideolar();
  const t = useRef(new Animated.Value(0)).current;
  const [hareket, setHareket] = useState(false);
  const [acik, setAcik] = useState(false);
  const [acilanAdres, setAcilanAdres] = useState(null);

  const surum = kod ? liste?.[kod] : undefined;
  const var_ = surum !== undefined;

  useEffect(() => {
    if (!var_) return undefined;

    let dongu = null;
    let iptal = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((azalt) => {
        if (iptal || azalt) return;
        setHareket(true);
        dongu = Animated.loop(
          Animated.timing(t, {
            toValue: 1,
            duration: 3600,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        );
        dongu.start();
      });

    return () => {
      iptal = true;
      dongu?.stop();
    };
  }, [var_, t]);

  if (!var_) return null;

  const adres = yardimVideoAdresi(kod, surum);

  const ac = async () => {
    /* Önce güncel sürüm soruluyor; video yenilendiyse yeni adresle açılsın */
    await listeyiTazele();
    const guncel = yardimVideoAdresi(kod, videolar?.[kod] ?? surum);
    if (!guncel) return;
    setAcilanAdres(guncel);
    if (Video) setAcik(true);
    else Linking.openURL(guncel).catch(() => {});
  };

  return (
    <>
      <TouchableOpacity
        onPress={ac}
        activeOpacity={0.7}
        /* Çiçek küçük; dokunma alanı 44 noktaya genişletiliyor */
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={`${ad ?? "Bu sayfa"} nasıl kullanılır, videoyu izle`}
        style={[s.dugme, kutu && s.kutu]}
      >
        <Cicek boyut={boyut} t={hareket ? t : null} />
      </TouchableOpacity>

      {acik && Video ? (
        <Modal {...modalTamEkran} visible animationType="fade" onRequestClose={() => setAcik(false)} supportedOrientations={["portrait"]}>
          <StatusBar barStyle="light-content" />
          <ModalAlani style={s.sayfa} edges={["top", "bottom"]}>
            <View style={s.ust}>
              <Cicek boyut={22} t={null} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.ustKucuk}>Nasıl kullanılır?</Text>
                <Text style={s.ustAd} numberOfLines={1}>
                  {ad ?? "Bu sayfa"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setAcik(false)} hitSlop={12} style={s.kapat}>
                <Text style={s.kapatYazi}>Kapat</Text>
              </TouchableOpacity>
            </View>
            <Oynatici adres={acilanAdres ?? adres} />
          </ModalAlani>
        </Modal>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  dugme: { alignItems: "center", justifyContent: "center" },
  kutu: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,.92)",
    marginRight: 8,
  },

  sayfa: { flex: 1, backgroundColor: "#0d0f0b" },
  ust: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  ustKucuk: { color: "rgba(255,255,255,.6)", fontSize: 11.5, fontWeight: "700" },
  ustAd: { color: "#fff", fontSize: 16, fontWeight: "800" },
  kapat: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: "rgba(255,255,255,.14)" },
  kapatYazi: { color: "#fff", fontWeight: "800", fontSize: 13.5 },
  video: { flex: 1, backgroundColor: "#000" },
});
